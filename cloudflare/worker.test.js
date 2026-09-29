import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker, { amount, money, allowedMember, handle } from './worker.js';

const env = { PHI_USERNAME: '@leducphi', AN_USERNAME: '@CallMeAnTe', TELEGRAM_BOT_TOKEN: 'test', TELEGRAM_WEBHOOK_SECRET: 'secret' };
const phi = { id: 101, username: 'leducphi' };
const an = { id: 202, username: 'CallMeAnTe' };
const event = (from, action, text) => ({ from, chat: { id: from.id, type: 'private' }, action, text });
function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const db = {
    prepare(query) {
      const prepared = sqlite.prepare(query);
      return {
        bind(...args) {
          return {
            first: async () => prepared.get(...args) || null,
            all: async () => ({ results: prepared.all(...args) }),
            run: async () => prepared.run(...args)
          };
        }
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        for (const statement of statements) await statement.run();
        sqlite.exec('COMMIT');
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    }
  };
  return { db, sqlite };
}
async function startBoth(db) {
  await handle(db, env, event(phi, null, '/start'), 1);
  await handle(db, env, event(an, null, '/start'), 2);
}
function reply(from, prompt, text) {
  return { from, chat: { id: from.id, type: 'private' }, text, reply_to_message: { from: { is_bot: true }, text: prompt } };
}

test('Vietnamese money formats and username allowlist', () => {
  assert.equal(amount('50k'), 50000);
  assert.equal(amount('1,5tr'), 1500000);
  assert.equal(amount('1.000.000'), 1000000);
  assert.throws(() => amount('1,2345k'));
  assert.equal(money(449000), '449.000đ');
  assert.equal(allowedMember(env, { username: 'CALLMEANTE' }), 'An');
  assert.equal(allowedMember(env, { username: 'stranger' }), null);
});

test('webhook rejects requests without Telegram secret', async () => {
  const response = await worker.fetch(new Request('https://example.workers.dev/telegram', { method: 'POST' }), env);
  assert.equal(response.status, 403);
});

test('only configured usernames and pinned Telegram IDs can use buttons', async () => {
  const { db } = database();
  const denied = await handle(db, env, event({ id: 303, username: 'stranger' }, 'm'), 1);
  assert.match(denied.reply, /chỉ dành cho/);
  await startBoth(db);
  const menu = await handle(db, env, event(phi, 'm'), 3);
  assert.equal(menu.markup.inline_keyboard[0][0].callback_data, 'new:contribution');
  const impersonator = await handle(db, env, event({ id: 404, username: 'leducphi' }, 'm'), 4);
  assert.match(impersonator.reply, /chỉ dành cho/);
  const oldCommand = await handle(db, env, event(phi, null, '/thu 100k test'), 5);
  assert.match(oldCommand.reply, /Bấm ☰ Menu/);
});

test('every new transaction waits for the other person; An completes reimbursement directly', async () => {
  const { db, sqlite } = database();
  await startBoth(db);
  const contribution = await handle(db, env, reply(phi, 'Nhập khoản góp\nGửi số tiền và nội dung', '1000k góp quỹ'), 3);
  assert.match(contribution.reply, /Đã gửi An duyệt/);
  assert.equal(sqlite.prepare('SELECT status FROM transactions WHERE id=1').get().status, 'pending');
  assert.equal((await handle(db, env, event(phi, 'balance'), 4)).reply.includes('Quỹ còn: 0đ'), true);
  await assert.rejects(() => handle(db, env, event(phi, 'approve:1'), 5), /tự duyệt/);
  await handle(db, env, event(an, 'approve:1'), 6);
  assert.equal((await handle(db, env, event(phi, 'balance'), 7)).reply.includes('Quỹ còn: 1.000.000đ'), true);

  await handle(db, env, reply(phi, 'Nhập khoản ứng\nGửi số tiền và nội dung', '20k mua rau'), 8);
  assert.equal((await handle(db, env, event(phi, 'balance'), 9)).reply.includes('Quỹ còn: 1.000.000đ'), true);
  await handle(db, env, event(an, 'approve:2'), 10);
  let balance = (await handle(db, env, event(phi, 'balance'), 11)).reply;
  assert.match(balance, /Quỹ còn: 980.000đ/);
  assert.match(balance, /Cần hoàn ứng: 20.000đ/);
  await assert.rejects(() => handle(db, env, event(phi, 'reimburse:2'), 12), /Chỉ An/);
  await handle(db, env, event(an, 'reimburse:2'), 13);
  balance = (await handle(db, env, event(phi, 'balance'), 14)).reply;
  assert.match(balance, /Quỹ còn: 980.000đ/);
  assert.match(balance, /Cần hoàn ứng: 0đ/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name='reimbursement_requests'").get().count, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM audit WHERE action='reimburse'").get().count, 1);
});

test('confirmed edits wait for peer approval and preserve old value until then', async () => {
  const { db, sqlite } = database();
  await startBoth(db);
  await handle(db, env, reply(phi, 'Nhập khoản chi\nGửi số tiền và nội dung', '50k mua nước'), 3);
  await handle(db, env, event(an, 'approve:1'), 4);
  const proposed = await handle(db, env, reply(phi, 'Sửa #1 · Số tiền\nNhập giá trị mới', '60k'), 5);
  assert.match(proposed.reply, /Giao dịch hiện tại chưa đổi/);
  assert.equal(sqlite.prepare('SELECT amount_vnd FROM transactions WHERE id=1').get().amount_vnd, 50000);
  await assert.rejects(() => handle(db, env, event(phi, 'change:approve:1'), 6), /tự duyệt/);
  await handle(db, env, event(an, 'change:approve:1'), 7);
  assert.equal(sqlite.prepare('SELECT amount_vnd FROM transactions WHERE id=1').get().amount_vnd, 60000);
});

test('An also needs Phi approval; rejected expenses never reduce the fund', async () => {
  const { db, sqlite } = database();
  await startBoth(db);
  await handle(db, env, reply(an, 'Nhập khoản chi\nGửi số tiền và nội dung', '40k tiền phòng'), 3);
  assert.equal(sqlite.prepare('SELECT status FROM transactions WHERE id=1').get().status, 'pending');
  await assert.rejects(() => handle(db, env, event(an, 'approve:1'), 4), /tự duyệt/);
  await handle(db, env, event(phi, 'reject:1'), 5);
  assert.equal((await handle(db, env, event(an, 'balance'), 6)).reply.includes('Quỹ còn: 0đ'), true);
  assert.ok(sqlite.prepare('SELECT deleted_at FROM transactions WHERE id=1').get().deleted_at);
});

test('due shows full total and An can reimburse all without reducing fund twice', async () => {
  const { db, sqlite } = database();
  await startBoth(db);
  await handle(db, env, reply(phi, 'Nhập khoản ứng\nGửi số tiền và nội dung', '20k rau'), 3);
  await handle(db, env, event(an, 'approve:1'), 4);
  await handle(db, env, reply(phi, 'Nhập khoản ứng\nGửi số tiền và nội dung', '6k muối'), 5);
  await handle(db, env, event(an, 'approve:2'), 6);
  const due = await handle(db, env, event(an, 'due'), 7);
  assert.match(due.reply, /26.000đ/);
  assert.deepEqual(due.markup.inline_keyboard.slice(0, 2).map(row => row[0].callback_data), ['tx:2', 'tx:1']);
  assert.equal(due.markup.inline_keyboard[2][0].callback_data, 'reimburse:all');
  assert.equal((await handle(db, env, event(phi, 'due'), 8)).markup.inline_keyboard.some(row => row[0].callback_data === 'reimburse:all'), false);
  await assert.rejects(() => handle(db, env, event(phi, 'reimburse:all:yes:2:26000'), 9), /Chỉ An/);
  const confirm = await handle(db, env, event(an, 'reimburse:all'), 10);
  assert.match(confirm.reply, /26.000đ/);
  const confirmAction = confirm.markup.inline_keyboard[0][0].callback_data;
  assert.equal(confirmAction, 'reimburse:all:yes:2:26000');
  await handle(db, env, event(an, confirmAction), 11);
  assert.deepEqual(sqlite.prepare('SELECT reimbursed_vnd FROM transactions ORDER BY id').all().map(row => row.reimbursed_vnd), [20000, 6000]);
  const menu = await handle(db, env, event(phi, 'm'), 12);
  assert.match(menu.reply, /Quỹ còn: -26.000đ/);
  assert.match(menu.reply, /Cần hoàn ứng: 0đ/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM audit WHERE action='reimburse'").get().count, 2);
  await assert.rejects(() => handle(db, env, event(an, confirmAction), 13), /đã thay đổi/);
});

test('menu totals come from confirmed transactions and history uses creation time', async () => {
  const { db, sqlite } = database();
  await startBoth(db);
  sqlite.exec("INSERT INTO transactions(occurred_on,kind,amount_vnd,description,member,status,created_at) VALUES ('2026-09-01','contribution',11908001,'Phi góp','Phi','confirmed','2026-09-01 00:00:00'),('2026-08-01','contribution',11908000,'An góp','An','confirmed','2026-09-03 00:00:00'),('2026-09-02','expense',23368001,'Chi','An','confirmed','2026-09-02 00:00:00'),('2026-09-01','expense',6000,'Phi ứng',NULL,'confirmed','2026-09-04 00:00:00')");
  sqlite.exec("UPDATE transactions SET paid_by='Phi' WHERE id=4");
  const menu = await handle(db, env, event(phi, 'm'), 3);
  assert.match(menu.reply, /Quỹ còn: 442.000đ/);
  assert.match(menu.reply, /Phi đã góp: 11.908.001đ/);
  assert.match(menu.reply, /An đã góp: 11.908.000đ/);
  assert.match(menu.reply, /Tổng chi: 23.374.001đ/);
  assert.match(menu.reply, /Cần hoàn ứng: 6.000đ/);
  const history = await handle(db, env, event(phi, 'history'), 4);
  assert.deepEqual(history.markup.inline_keyboard.slice(0, 4).map(row => row[0].callback_data), ['tx:4', 'tx:2', 'tx:3', 'tx:1']);
});

test('due order follows creation time', async () => {
  const { db, sqlite } = database();
  await startBoth(db);
  sqlite.exec("INSERT INTO transactions(occurred_on,kind,amount_vnd,description,paid_by,status,created_at) VALUES ('2026-09-29','expense',6000,'Mới theo ID','Phi','confirmed','2026-09-01 00:00:00'),('2026-09-01','expense',20000,'Mới theo ngày thêm','Phi','confirmed','2026-09-03 00:00:00')");
  const due = await handle(db, env, event(an, 'due'), 3);
  assert.deepEqual(due.markup.inline_keyboard.slice(0, 2).map(row => row[0].callback_data), ['tx:2', 'tx:1']);
  await handle(db, env, event(an, 'reimburse:1'), 4);
  assert.equal(sqlite.prepare('SELECT reimbursed_vnd FROM transactions WHERE id=1').get().reimbursed_vnd, 6000);
});

test('webhook sends action buttons to the other member after a new entry', async () => {
  const { db } = database();
  await startBoth(db);
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ method: String(url).split('/').pop(), body: JSON.parse(options.body) });
    return Response.json({ ok: true, result: true });
  };
  try {
    const request = new Request('https://example.workers.dev/telegram', {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': 'secret' },
      body: JSON.stringify({
        update_id: 3,
        message: { ...reply(phi, 'Nhập khoản góp\nGửi số tiền và nội dung', '100k góp quỹ'), message_id: 55 }
      })
    });
    const response = await worker.fetch(request, { ...env, DB: db });
    assert.equal(response.status, 200);
    const notice = calls.find(call => call.method === 'sendMessage' && call.body.chat_id === an.id);
    assert.equal(notice.body.reply_markup.inline_keyboard[0][0].callback_data, 'approve:1');
  } finally { globalThis.fetch = original; }
});

test('webhook handles button approval and acknowledges Telegram callback', async () => {
  const { db, sqlite } = database();
  await startBoth(db);
  await handle(db, env, reply(phi, 'Nhập khoản góp\nGửi số tiền và nội dung', '100k góp quỹ'), 3);
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ method: String(url).split('/').pop(), body: JSON.parse(options.body) });
    return Response.json({ ok: true, result: true });
  };
  try {
    const request = new Request('https://example.workers.dev/telegram', {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': 'secret' },
      body: JSON.stringify({ update_id: 4, callback_query: { id: 'tap-1', data: 'approve:1', from: an, message: { chat: { id: an.id, type: 'private' } } } })
    });
    const response = await worker.fetch(request, { ...env, DB: db });
    assert.equal(response.status, 200);
    assert.equal(sqlite.prepare('SELECT status FROM transactions WHERE id=1').get().status, 'confirmed');
    assert.ok(calls.some(call => call.method === 'answerCallbackQuery' && call.body.callback_query_id === 'tap-1'));
    assert.ok(calls.some(call => call.method === 'sendMessage' && call.body.chat_id === phi.id && /đã được duyệt/.test(call.body.text)));
  } finally { globalThis.fetch = original; }
});

test('returning to menu removes the previous screen and the Menu tap', async () => {
  const { db, sqlite } = database();
  await startBoth(db);
  sqlite.exec("UPDATE users SET last_ui_message_id=50 WHERE member='Phi'");
  const calls = [];
  let nextMessageId = 200;
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const method = String(url).split('/').pop();
    const body = JSON.parse(options.body);
    calls.push({ method, body });
    return Response.json({ ok: true, result: method === 'sendMessage' ? { message_id: nextMessageId++ } : true });
  };
  try {
    const callback = new Request('https://example.workers.dev/telegram', {
      method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'secret' },
      body: JSON.stringify({ update_id: 3, callback_query: { id: 'menu-1', data: 'm', from: phi, message: { message_id: 50, chat: { id: phi.id, type: 'private' } } } })
    });
    assert.equal((await worker.fetch(callback, { ...env, DB: db })).status, 200);
    assert.deepEqual(calls.filter(call => call.method === 'deleteMessage').map(call => call.body.message_id), [50]);
    assert.equal(sqlite.prepare("SELECT last_ui_message_id FROM users WHERE member='Phi'").get().last_ui_message_id, 200);

    const keyboardTap = new Request('https://example.workers.dev/telegram', {
      method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'secret' },
      body: JSON.stringify({ update_id: 4, message: { message_id: 51, from: phi, chat: { id: phi.id, type: 'private' }, text: '☰ Menu' } })
    });
    assert.equal((await worker.fetch(keyboardTap, { ...env, DB: db })).status, 200);
    assert.deepEqual(calls.filter(call => call.method === 'deleteMessage').map(call => call.body.message_id), [50, 200, 51]);
    assert.equal(sqlite.prepare("SELECT last_ui_message_id FROM users WHERE member='Phi'").get().last_ui_message_id, 201);
  } finally { globalThis.fetch = original; }
});

test('pending approval messages survive Menu and are removed after approval', async () => {
  const { db, sqlite } = database();
  await startBoth(db);
  sqlite.exec("INSERT INTO transactions(occurred_on,kind,amount_vnd,description,member,status,created_by) VALUES ('2026-09-29','contribution',100000,'Góp quỹ','Phi','pending',101)");
  const approvalMarkup = { inline_keyboard: [[{ text: 'Duyệt', callback_data: 'approve:1' }, { text: 'Từ chối', callback_data: 'reject:1' }], [{ text: 'Chi tiết', callback_data: 'tx:1' }]] };
  const calls = [];
  let nextMessageId = 300;
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const method = String(url).split('/').pop();
    const body = JSON.parse(options.body);
    calls.push({ method, body });
    return Response.json({ ok: true, result: method === 'sendMessage' ? { message_id: nextMessageId++ } : true });
  };
  const press = (updateId, action, messageId, replyMarkup, from = an) => new Request('https://example.workers.dev/telegram', {
    method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'secret' },
    body: JSON.stringify({ update_id: updateId, callback_query: { id: 'tap-' + updateId, data: action, from, message: { message_id: messageId, chat: { id: from.id, type: 'private' }, reply_markup: replyMarkup } } })
  });
  try {
    assert.equal((await worker.fetch(press(3, 'tx:1', 80, approvalMarkup), { ...env, DB: db })).status, 200);
    assert.equal(calls.some(call => call.method === 'deleteMessage' && call.body.message_id === 80), false);
    assert.equal(sqlite.prepare('SELECT COUNT(*) count FROM approval_messages WHERE reference_id=1').get().count, 1);
    const detailMarkup = calls.find(call => call.method === 'sendMessage').body.reply_markup;
    assert.equal((await worker.fetch(press(4, 'm', 300, detailMarkup), { ...env, DB: db })).status, 200);
    assert.equal(calls.some(call => call.method === 'deleteMessage' && call.body.message_id === 300), false);
    assert.equal(sqlite.prepare('SELECT COUNT(*) count FROM approval_messages WHERE reference_id=1').get().count, 1);
    assert.equal((await worker.fetch(press(5, 'approve:1', 81, approvalMarkup, phi), { ...env, DB: db })).status, 200);
    assert.equal(calls.filter(call => call.method === 'deleteMessage').length, 0);
    assert.equal((await worker.fetch(press(6, 'approve:1', 80, approvalMarkup), { ...env, DB: db })).status, 200);
    assert.deepEqual(calls.filter(call => call.method === 'deleteMessage').map(call => call.body.message_id).sort((a, b) => a - b), [80, 300]);
    assert.equal(sqlite.prepare('SELECT COUNT(*) count FROM approval_messages WHERE reference_id=1').get().count, 0);
    assert.equal(sqlite.prepare('SELECT status FROM transactions WHERE id=1').get().status, 'confirmed');
  } finally { globalThis.fetch = original; }
});

test('old approval message loses its buttons when Telegram refuses deletion', async () => {
  const { db, sqlite } = database();
  await startBoth(db);
  sqlite.exec("INSERT INTO transactions(occurred_on,kind,amount_vnd,description,member,status,created_by) VALUES ('2026-09-29','contribution',100000,'Góp quỹ','Phi','pending',101)");
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const method = String(url).split('/').pop();
    const body = JSON.parse(options.body);
    calls.push({ method, body });
    if (method === 'deleteMessage') return Response.json({ ok: false, description: 'message is too old' });
    return Response.json({ ok: true, result: method === 'sendMessage' ? { message_id: 400 } : true });
  };
  const oldWarn = console.warn;
  console.warn = () => {};
  try {
    const request = new Request('https://example.workers.dev/telegram', {
      method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'secret' },
      body: JSON.stringify({ update_id: 3, callback_query: { id: 'old-approval', data: 'approve:1', from: an, message: { message_id: 80, chat: { id: an.id, type: 'private' }, reply_markup: { inline_keyboard: [[{ text: 'Duyệt', callback_data: 'approve:1' }]] } } } })
    });
    assert.equal((await worker.fetch(request, { ...env, DB: db })).status, 200);
    assert.ok(calls.some(call => call.method === 'editMessageReplyMarkup' && call.body.message_id === 80 && call.body.reply_markup.inline_keyboard.length === 0));
    assert.equal(sqlite.prepare('SELECT status FROM transactions WHERE id=1').get().status, 'confirmed');
  } finally { globalThis.fetch = original; console.warn = oldWarn; }
});
