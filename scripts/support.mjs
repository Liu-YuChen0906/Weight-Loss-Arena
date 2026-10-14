import { openStore } from '../apps/api/store.mjs';
const store = openStore(process.env.DATABASE_PATH || './var/development.sqlite');
try {
  const [command = 'list', requestId] = process.argv.slice(2);
  if (command === 'list') console.log(JSON.stringify(store.all('SELECT id,message,status,created_at FROM support_requests ORDER BY created_at DESC'), null, 2));
  else if (command === 'resolve' && requestId) { const result = store.run("UPDATE support_requests SET status='RESOLVED' WHERE id=?", requestId); console.log(`Updated ${result.changes} request(s).`); }
  else throw new Error('Usage: node scripts/support.mjs [list|resolve <request-id>]');
} finally { store.close(); }
