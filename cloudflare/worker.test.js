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
  sqlite.exec(readFileSync(new URL('./migrations/0001_button_workflow.sql', import.meta.url), 'utf8'));
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

test('every new transaction waits for the other person; reimbursement needs two steps', async () => {
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
  await handle(db, env, event(an, 'send:2'), 12);
  balance = (await handle(db, env, event(phi, 'balance'), 13)).reply;
  assert.match(balance, /Cần hoàn ứng: 20.000đ/);
  await assert.rejects(() => handle(db, env, event(an, 'receive:1'), 14), /Chỉ Phi/);
  await handle(db, env, event(phi, 'receive:1'), 15);
  balance = (await handle(db, env, event(phi, 'balance'), 16)).reply;
  assert.match(balance, /Quỹ còn: 980.000đ/);
  assert.match(balance, /Cần hoàn ứng: 0đ/);
  assert.equal(sqlite.prepare('SELECT status FROM reimbursement_requests WHERE id=1').get().status, 'received');
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

test('not received keeps reimbursement outstanding so An can resend', async () => {
  const { db, sqlite } = database();
  await startBoth(db);
  await handle(db, env, reply(phi, 'Nhập khoản ứng\nGửi số tiền và nội dung', '20k rau'), 3);
  await handle(db, env, event(an, 'approve:1'), 4);
  await handle(db, env, event(an, 'send:1'), 5);
  await handle(db, env, event(phi, 'not_received:1'), 6);
  assert.equal(sqlite.prepare('SELECT reimbursed_vnd FROM transactions WHERE id=1').get().reimbursed_vnd, 0);
  assert.equal(sqlite.prepare('SELECT status FROM reimbursement_requests WHERE id=1').get().status, 'cancelled');
  await handle(db, env, event(an, 'send:1'), 7);
  assert.equal(sqlite.prepare('SELECT status FROM reimbursement_requests WHERE id=2').get().status, 'sent');
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
