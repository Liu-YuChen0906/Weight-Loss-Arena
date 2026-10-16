import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadSmsAdapter } from './sms.mjs';
export function validatePublicOrigin(publicOrigin) {
  const origin = new URL(publicOrigin);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('PUBLIC_ORIGIN must be an exact HTTPS origin.');
  return origin.origin;
}
export function validateTestConfig(publicOrigin, accounts) {
  const origin = validatePublicOrigin(publicOrigin);
  if (!Array.isArray(accounts) || accounts.length < 2 || accounts.length > 8) throw new Error('Test mode needs 2–8 issued accounts.');
  const ids = new Set(), hashes = new Set();
  for (const a of accounts) {
    if (!/^[a-z0-9-]{1,32}$/.test(a.id) || !/^[a-f0-9]{64}$/.test(a.codeHash) || typeof a.nickname !== 'string' || !a.nickname || [...a.nickname].length > 20 || ids.has(a.id) || hashes.has(a.codeHash)) throw new Error('Invalid test account configuration.');
    ids.add(a.id); hashes.add(a.codeHash);
  }
  return origin;
}
export function loadRuntime(env = process.env, smsDependencies) {
  const mode = env.APP_MODE || 'local', host = env.HOST || '127.0.0.1';
  if (mode === 'local') {
    if (!['127.0.0.1', 'localhost', '::1'].includes(host) || env.NODE_ENV === 'production' || (env.SMS_MODE && env.SMS_MODE !== 'development')) throw new Error('Local mode cannot be exposed publicly. Use the isolated synthetic test environment.');
    return { mode, host, databasePath: env.DATABASE_PATH || resolve('var/development.sqlite'), deletionJournalPath: env.DELETION_JOURNAL_PATH };
  }
  if (mode === 'sms-trial') {
    const databasePath = env.DATABASE_PATH, smsDailyLimit = Number(env.SMS_DAILY_LIMIT);
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('SMS trial must use a loopback HTTPS reverse proxy.');
    if (!databasePath || databasePath === ':memory:' || ['var/development.sqlite', '/var/lib/payathon-test/test.sqlite'].some(path => resolve(path) === resolve(databasePath))) throw new Error('SMS trial requires a separate persistent database.');
    if (env.SMS_MODE !== 'provider' || env.SMS_PROVIDER !== 'aliyun-pnvs') throw new Error('SMS trial requires the PNVS provider, never development codes.');
    if (!Number.isInteger(smsDailyLimit) || smsDailyLimit < 1 || smsDailyLimit > 20) throw new Error('SMS trial requires SMS_DAILY_LIMIT between 1 and 20.');
    return { mode, host, databasePath, deletionJournalPath: env.DELETION_JOURNAL_PATH, publicOrigin: validatePublicOrigin(env.PUBLIC_ORIGIN), smsMode: 'provider', smsDailyLimit, deliverCode: loadSmsAdapter(env, smsDependencies) };
  }
  if (mode !== 'test') throw new Error('Real-data production launch is not enabled.');
  const databasePath = env.DATABASE_PATH;
  if (!databasePath || databasePath === ':memory:' || resolve(databasePath) === resolve('var/development.sqlite')) throw new Error('Test mode requires a separate persistent database.');
  if (!env.TEST_ACCOUNTS_PATH) throw new Error('Issue test accounts before startup.');
  const testAccounts = JSON.parse(readFileSync(env.TEST_ACCOUNTS_PATH, 'utf8'));
  const publicOrigin = validateTestConfig(env.PUBLIC_ORIGIN, testAccounts);
  return { mode, host, databasePath, publicOrigin, testAccounts, deletionJournalPath: env.DELETION_JOURNAL_PATH };
}
