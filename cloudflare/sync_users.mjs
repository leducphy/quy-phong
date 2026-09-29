import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const directory = dirname(fileURLToPath(import.meta.url));
const lines = readFileSync(resolve(directory, '../.env'), 'utf8').split(/\r?\n/);
const names = {};
for (const line of lines) {
  if (!line || line.startsWith('#') || !line.includes('=')) continue;
  const [key, ...rest] = line.split('=');
  if (key === 'PHI_USERNAME' || key === 'AN_USERNAME') names[key] = rest.join('=').trim().replace(/^['"]|['"]$/g, '');
}
const valid = /^@[A-Za-z0-9_]{5,32}$/;
if (!valid.test(names.PHI_USERNAME || '') || !valid.test(names.AN_USERNAME || '') || names.PHI_USERNAME.toLowerCase() === names.AN_USERNAME.toLowerCase()) {
  throw new Error('Cần hai username Telegram khác nhau trong .env: PHI_USERNAME và AN_USERNAME.');
}
const result = spawnSync(join(directory, 'node_modules/.bin/wrangler'), ['secret', 'bulk'], {
  cwd: directory,
  env: { ...process.env, XDG_CONFIG_HOME: join(directory, '.local/config'), WRANGLER_SEND_METRICS: 'false' },
  input: JSON.stringify(names),
  encoding: 'utf8'
});
if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || 'Không cập nhật được Cloudflare Secrets.\n');
  process.exit(result.status || 1);
}
process.stdout.write('Đã cập nhật hai username trên Cloudflare.\n');
