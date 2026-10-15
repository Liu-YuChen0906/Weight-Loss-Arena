import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

// Independent of the business snapshot. Contains identifiers, never phone/body values.
export function openDeletionJournal(path, expectedId, { readOnly = false } = {}) {
  const memory = path === ':memory:';
  if (expectedId && !memory && !existsSync(path)) throw new Error('Deletion journal missing; recovery must provide the latest independent journal');
  if (!memory && !readOnly) mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path, { readOnly, timeout: 5000 });
  try {
    if (expectedId && (!db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='identity'").get() || !db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='events'").get() || db.prepare('SELECT id FROM identity').get()?.id !== expectedId)) throw new Error('Deletion journal identity mismatch');
    if (!readOnly) {
      db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS identity (id TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, user_id TEXT NOT NULL, created_at TEXT NOT NULL);');
      if (!db.prepare('SELECT id FROM identity').get()) db.prepare('INSERT INTO identity VALUES(?)').run(expectedId || randomUUID());
      if (!memory) chmodSync(path, 0o600);
    }
    const identity = db.prepare('SELECT id FROM identity').get()?.id;
    if (!identity || (expectedId && identity !== expectedId) || db.prepare('SELECT count(*) n FROM identity').get().n !== 1) throw new Error('Deletion journal identity mismatch');
    if (Object.values(db.prepare('PRAGMA integrity_check').get())[0] !== 'ok') throw new Error('Deletion journal integrity failure');
    return {
      id: identity,
      events: () => db.prepare('SELECT sequence,id,user_id,created_at FROM events ORDER BY sequence').all(),
      append(userId, createdAt) {
        if (readOnly) throw new Error('Read-only recovery cannot accept privacy writes');
        const eventId = randomUUID();
        db.prepare('INSERT INTO events(id,user_id,created_at) VALUES(?,?,?)').run(eventId, userId, createdAt);
        return db.prepare('SELECT sequence,id,user_id,created_at FROM events WHERE id=?').get(eventId);
      },
      close: () => db.close()
    };
  } catch (error) { db.close(); throw error; }
}
