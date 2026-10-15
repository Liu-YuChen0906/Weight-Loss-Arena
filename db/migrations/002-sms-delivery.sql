-- Old OTPs have no verified dispatch state and must be requested again.
DELETE FROM otp;
ALTER TABLE otp ADD COLUMN delivery_state TEXT NOT NULL DEFAULT 'PENDING'
 CHECK(delivery_state IN ('PENDING','ACCEPTED','FAILED','UNKNOWN','DEVELOPMENT'));
ALTER TABLE otp ADD COLUMN dispatch_id TEXT;
CREATE TABLE privacy_meta (id INTEGER PRIMARY KEY CHECK(id=1), journal_id TEXT NOT NULL, last_sequence INTEGER NOT NULL DEFAULT 0);
PRAGMA user_version=2;
