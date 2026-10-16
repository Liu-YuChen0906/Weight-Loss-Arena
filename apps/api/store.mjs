import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync, chmodSync, existsSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { openDeletionJournal } from './deletion-journal.mjs';
export function openStore(path = ':memory:', { deletionJournalPath, readOnlyJournal = false } = {}) {
  if (path !== ':memory:' && deletionJournalPath === ':memory:') throw new Error('Persistent data requires a persistent deletion journal');
  if (path !== ':memory:' && deletionJournalPath && (resolve(path) === resolve(deletionJournalPath) || (existsSync(path) && existsSync(deletionJournalPath) && realpathSync(path) === realpathSync(deletionJournalPath)))) throw new Error('Deletion journal must be separate from the business database');
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path, { timeout: 5000 });
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  if (path !== ':memory:') chmodSync(path, 0o600);
  try {
    db.exec('BEGIN IMMEDIATE');
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (version > 3) throw new Error('Unsupported database version');
    if (version < 1) db.exec(readFileSync(new URL('../../db/migrations/001-initial.sql', import.meta.url), 'utf8'));
    if (version < 2) db.exec(readFileSync(new URL('../../db/migrations/002-sms-delivery.sql', import.meta.url), 'utf8'));
    if (version < 3) db.exec(readFileSync(new URL('../../db/migrations/003-profile-avatar.sql', import.meta.url), 'utf8'));
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  let journal;
  try {
    const meta = db.prepare('SELECT * FROM privacy_meta WHERE id=1').get();
    journal = openDeletionJournal(deletionJournalPath || (path === ':memory:' ? ':memory:' : path + '.deletions.sqlite'), meta?.journal_id, { readOnly: readOnlyJournal });
    if (!meta) db.prepare('INSERT INTO privacy_meta(id,journal_id) VALUES(1,?)').run(journal.id);
    const events = journal.events(), sequence = db.prepare('SELECT last_sequence FROM privacy_meta WHERE id=1').get().last_sequence;
    if (sequence > (events.at(-1)?.sequence || 0)) throw new Error('Deletion journal is older than the business database');
  } catch (error) { journal?.close(); db.close(); throw error; }
  return {
    db, journal, get: (sql, ...args) => db.prepare(sql).get(...args),
    all: (sql, ...args) => db.prepare(sql).all(...args),
    run: (sql, ...args) => db.prepare(sql).run(...args),
    transaction(fn) { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; } },
    close() { journal.close(); db.close(); }
  };
}
