CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, phone TEXT UNIQUE NOT NULL, nickname TEXT NOT NULL,
 consent_version TEXT, consent_at TEXT, current_room_id TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 csrf TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS otp (
 phone TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL,
 sent_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS rooms (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, intro TEXT NOT NULL, days INTEGER NOT NULL CHECK(days BETWEEN 14 AND 90),
 intensity TEXT NOT NULL CHECK(intensity IN ('低','中','高','极高')), status TEXT NOT NULL CHECK(status IN ('LOBBY','ACTIVE','ENDED','CANCELLED')),
 owner_id TEXT NOT NULL, invite_code TEXT UNIQUE NOT NULL, version INTEGER NOT NULL DEFAULT 1,
 start_date TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
 joined_order INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, room_id TEXT NOT NULL REFERENCES rooms(id),
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, state TEXT NOT NULL DEFAULT 'JOINED',
 ready INTEGER NOT NULL DEFAULT 0, height REAL, start_weight REAL, target REAL,
 algorithm TEXT, join_date TEXT, joined_at TEXT NOT NULL, consent_version TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS one_membership ON members(room_id,user_id) WHERE state='JOINED';
CREATE INDEX IF NOT EXISTS room_members ON members(room_id,state);
CREATE TABLE IF NOT EXISTS records (
 room_id TEXT NOT NULL REFERENCES rooms(id), user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 date TEXT NOT NULL, weight REAL NOT NULL CHECK(weight BETWEEN 20 AND 300), version INTEGER NOT NULL DEFAULT 1,
 updated_at TEXT NOT NULL, PRIMARY KEY(room_id,user_id,date)
);
CREATE TABLE IF NOT EXISTS idempotency (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, key TEXT NOT NULL, operation TEXT NOT NULL,
 body_hash TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(user_id,key)
);
CREATE TABLE IF NOT EXISTS reminder_receipts (
 room_id TEXT NOT NULL, recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE, round TEXT NOT NULL, stage INTEGER NOT NULL, shown_date TEXT NOT NULL,
 PRIMARY KEY(room_id,recipient_id,member_id,round,stage), UNIQUE(room_id,recipient_id,member_id,shown_date)
);
CREATE TABLE IF NOT EXISTS support_requests (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL);
PRAGMA user_version=1;
