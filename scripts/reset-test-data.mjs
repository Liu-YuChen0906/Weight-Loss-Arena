import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '../apps/api/store.mjs';
import { createService } from '../apps/api/service.mjs';

// Reset only the legacy synthetic environment, never a phone-login database.
export function resetSyntheticData(databasePath) {
  const store = openStore(databasePath);
  try {
    const users = store.all('SELECT id,phone FROM users');
    if (users.some(user => !user.phone.startsWith('test:'))) throw new Error('RESET_REQUIRES_SYNTHETIC_ACCOUNTS');
    const service = createService(store);
    for (const user of users) service.deleteAccount(user, { confirm: '注销并删除我的数据' });
    store.transaction(() => {
      store.run('DELETE FROM rooms'); store.run('DELETE FROM otp'); store.run('DELETE FROM rate_limits');
    });
    const tables = ['users', 'sessions', 'rooms', 'members', 'records', 'idempotency', 'reminder_receipts', 'support_requests', 'otp', 'rate_limits'];
    const remaining = Object.fromEntries(tables.map(table => [table, store.get('SELECT count(*) n FROM ' + table).n]));
    if (Object.values(remaining).some(Boolean)) throw new Error('RESET_INCOMPLETE');
    store.db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM;');
    return { deletedAccounts: users.length, remaining, deletionEvents: store.journal.events().length };
  } finally { store.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== '--reset-legacy-test' || process.env.DATABASE_PATH !== '/var/lib/payathon-test/test.sqlite') throw new Error('Explicit legacy test reset required');
  console.log(JSON.stringify(resetSyntheticData(process.env.DATABASE_PATH)));
}
