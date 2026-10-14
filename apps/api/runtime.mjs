import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
export function validateTestConfig(publicOrigin, accounts) {
  const origin = new URL(publicOrigin);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Test PUBLIC_ORIGIN must be an exact HTTPS origin.');
  if (!Array.isArray(accounts) || accounts.length < 2 || accounts.length > 8) throw new Error('Test mode needs 2–8 issued accounts.');
  const ids = new Set(), hashes = new Set();
  for (const a of accounts) {
    if (!/^[a-z0-9-]{1,32}$/.test(a.id) || !/^[a-f0-9]{64}$/.test(a.codeHash) || typeof a.nickname !== 'string' || !a.nickname || [...a.nickname].length > 20 || ids.has(a.id) || hashes.has(a.codeHash)) throw new Error('Invalid test account configuration.');
    ids.add(a.id); hashes.add(a.codeHash);
  }
  return origin.origin;
}
export function loadRuntime(env = process.env) {
  const mode = env.APP_MODE || 'local', host = env.HOST || '127.0.0.1';
  if (mode === 'local') {
    if (!['127.0.0.1', 'localhost', '::1'].includes(host) || env.NODE_ENV === 'production' || (env.SMS_MODE && env.SMS_MODE !== 'development')) throw new Error('Local mode cannot be exposed publicly. Use the isolated synthetic test environment.');
    return { mode, host, databasePath: env.DATABASE_PATH || resolve('var/development.sqlite') };
  }
  if (mode !== 'test') throw new Error('Real-data production launch is not enabled.');
  const databasePath = env.DATABASE_PATH;
  if (!databasePath || databasePath === ':memory:' || resolve(databasePath) === resolve('var/development.sqlite')) throw new Error('Test mode requires a separate persistent database.');
  if (!env.TEST_ACCOUNTS_PATH) throw new Error('Issue test accounts before startup.');
  const testAccounts = JSON.parse(readFileSync(env.TEST_ACCOUNTS_PATH, 'utf8'));
  const publicOrigin = validateTestConfig(env.PUBLIC_ORIGIN, testAccounts);
  return { mode, host, databasePath, publicOrigin, testAccounts };
}
