import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { amount, money, callbackCommand, promptAction, handle } from './worker.js';

test('Vietnamese amount formats and invalid fractions', () => {
  assert.equal(amount('50k'), 50000);
  assert.equal(amount('1,5tr'), 1500000);
  assert.equal(amount('1.000.000'), 1000000);
  assert.throws(() => amount('1,2345k'));
  assert.equal(money(449000), '449.000đ');
});

test('webhook rejects requests without Telegram secret', async () => {
  const request = new Request('https://example.workers.dev/telegram', { method: 'POST' });
  const response = await worker.fetch(request, { TELEGRAM_BOT_TOKEN: 'test', TELEGRAM_WEBHOOK_SECRET: 'secret' });
  assert.equal(response.status, 403);
});

test('buttons map to existing commands and reply prompts preserve transaction context', () => {
  assert.equal(callbackCommand('new:thu:An'), '/nhapthu An');
  assert.equal(callbackCommand('confirm:42'), '/xacnhan 42');
  assert.equal(callbackCommand('ask:42:noi_dung'), '/nhapsua 42 noi_dung');
  assert.equal(callbackCommand('delete_yes:42'), '/xoa 42');
  assert.equal(callbackCommand('confirm:42 /xoa 1'), '/menu');
  const reply = text => ({ text: '50k mua nước', reply_to_message: { from: { is_bot: true }, text } });
  assert.equal(promptAction(reply('Ghi chi từ quỹ\nNhập số tiền và nội dung')), '/chi 50k mua nước');
  assert.equal(promptAction(reply('Sửa #42 · Nội dung\nNhập giá trị mới')), '/sua 42 noi_dung 50k mua nước');
  assert.equal(promptAction({ ...reply('Ghi chi từ quỹ\nNhập'), reply_to_message: { from: { is_bot: false }, text: 'Ghi chi từ quỹ\nNhập' } }), null);
});

test('registered member sees button menu and unknown user cannot use it', async () => {
  const db = { prepare(query) { return { bind(userId) { return { async first() { return query.includes('FROM users') && userId === 123 ? { member: 'Phi' } : null; } }; } }; } };
  const msg = userId => ({ text: '☰ Menu', chat: { id: 123, type: 'private' }, from: { id: userId } });
  const allowed = await handle(db, msg(123), 1);
  assert.match(allowed.reply, /Bạn muốn làm gì/);
  assert.equal(allowed.markup.inline_keyboard[0][0].callback_data, 'q');
  const denied = await handle(db, msg(456), 2);
  assert.match(denied.reply, /chỉ dành cho Phi và An/);
  assert.equal(denied.markup, undefined);
});

test('webhook acknowledges button taps and sends an inline menu', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ method: String(url).split('/').pop(), body: JSON.parse(options.body) });
    return Response.json({ ok: true, result: true });
  };
  try {
    const db = { prepare(query) { return { bind() { return {
      async first() { return query.includes('FROM users') ? { member: 'Phi' } : null; },
      async run() { return {}; }
    }; } }; } };
    const request = new Request('https://example.workers.dev/telegram', {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': 'secret' },
      body: JSON.stringify({ update_id: 10, callback_query: { id: 'button-1', data: 'm', from: { id: 123 }, message: { chat: { id: 123, type: 'private' } } } })
    });
    const response = await worker.fetch(request, { DB: db, TELEGRAM_BOT_TOKEN: 'test', TELEGRAM_WEBHOOK_SECRET: 'secret' });
    assert.equal(response.status, 200);
    assert.equal(calls[0].method, 'answerCallbackQuery');
    assert.equal(calls[0].body.callback_query_id, 'button-1');
    assert.equal(calls[1].method, 'sendMessage');
    assert.equal(calls[1].body.reply_markup.inline_keyboard[0][0].callback_data, 'q');
  } finally { globalThis.fetch = originalFetch; }
});
