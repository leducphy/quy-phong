import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { amount, money } from './worker.js';

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
