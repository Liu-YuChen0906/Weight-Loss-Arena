CREATE TABLE users (
 id VARCHAR(36) PRIMARY KEY,
 phone VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
 nickname VARCHAR(80) NOT NULL, avatar VARCHAR(8) NOT NULL DEFAULT '🌱',
 consent_version VARCHAR(40), consent_at TIMESTAMP(6) NULL, created_at TIMESTAMP(6) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE rooms (
 id VARCHAR(36) PRIMARY KEY,
 name VARCHAR(96) NOT NULL, intro VARCHAR(800) NOT NULL, days INT NOT NULL,
 intensity ENUM('低','中','高','极高') NOT NULL, status ENUM('LOBBY','ACTIVE','ENDED','CANCELLED') NOT NULL,
 owner_id VARCHAR(36) NOT NULL, invite_code CHAR(12) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
 version INT NOT NULL DEFAULT 1, start_date DATE, created_at TIMESTAMP(6) NOT NULL,
 CONSTRAINT room_days CHECK (days BETWEEN 14 AND 90), INDEX room_expiry(status,start_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE members (
 id VARCHAR(36) PRIMARY KEY, room_id VARCHAR(36) NOT NULL,
 user_id VARCHAR(36) NOT NULL, state ENUM('JOINED','LEFT') NOT NULL DEFAULT 'JOINED', ready BOOLEAN NOT NULL DEFAULT FALSE,
 height DECIMAL(18,8), start_weight DECIMAL(18,8), target DECIMAL(8,2), algorithm VARCHAR(50),
 join_date DATE NOT NULL, joined_at TIMESTAMP(6) NOT NULL, joined_order BIGINT NOT NULL AUTO_INCREMENT UNIQUE,
 joined_user VARCHAR(36) GENERATED ALWAYS AS (CASE WHEN state='JOINED' THEN user_id ELSE NULL END) STORED,
 UNIQUE KEY member_active(room_id,joined_user), INDEX member_room(room_id,state), INDEX member_user(user_id,state),
 FOREIGN KEY(room_id) REFERENCES rooms(id), FOREIGN KEY(user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE active_memberships (
 user_id VARCHAR(36) PRIMARY KEY, room_id VARCHAR(36) NOT NULL, member_id VARCHAR(36) NOT NULL UNIQUE,
 FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(room_id) REFERENCES rooms(id), FOREIGN KEY(member_id) REFERENCES members(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE records (
 room_id VARCHAR(36) NOT NULL,user_id VARCHAR(36) NOT NULL,business_date DATE NOT NULL,
 weight DECIMAL(8,2) NOT NULL,version INT NOT NULL,updated_at TIMESTAMP(6) NOT NULL,
 PRIMARY KEY(room_id,user_id,business_date), INDEX record_user(user_id,business_date),
 CONSTRAINT record_weight CHECK(weight BETWEEN 20 AND 300), FOREIGN KEY(room_id) REFERENCES rooms(id), FOREIGN KEY(user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE idempotency (
 user_id VARCHAR(36) NOT NULL, request_key VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 operation VARCHAR(100) NOT NULL,body_hash CHAR(64) NOT NULL,result_json JSON NOT NULL,created_at TIMESTAMP(6) NOT NULL,
 PRIMARY KEY(user_id,request_key), FOREIGN KEY(user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE otp_dispatches (
 phone VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,credential_marker VARCHAR(255) NOT NULL,
 dispatch_id VARCHAR(36) NOT NULL, method VARCHAR(20) NOT NULL,delivery_state VARCHAR(20) NOT NULL,
 expires_at TIMESTAMP(6) NOT NULL,sent_at TIMESTAMP(6) NOT NULL,attempts INT NOT NULL DEFAULT 0,
 verify_lease_token VARCHAR(36),verify_lease_until TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE rate_limits (rate_key VARCHAR(180) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY, count INT NOT NULL, reset_at TIMESTAMP(6) NOT NULL) ENGINE=InnoDB;
CREATE TABLE sms_daily_usage (business_date DATE PRIMARY KEY,count INT NOT NULL) ENGINE=InnoDB;
CREATE TABLE reminder_receipts (
 room_id VARCHAR(36) NOT NULL, recipient_id VARCHAR(36) NOT NULL, member_id VARCHAR(36) NOT NULL,
 round_date DATE NOT NULL,stage INT NOT NULL,shown_date DATE NOT NULL,
 PRIMARY KEY(room_id,recipient_id,member_id,round_date,stage),UNIQUE KEY reminder_daily(room_id,recipient_id,member_id,shown_date)
) ENGINE=InnoDB;
CREATE TABLE support_requests (
 id VARCHAR(36) PRIMARY KEY,user_id VARCHAR(36) NOT NULL,message VARCHAR(4000) NOT NULL,
 status ENUM('OPEN','RESOLVED') NOT NULL DEFAULT 'OPEN',created_at TIMESTAMP(6) NOT NULL,resolved_at TIMESTAMP(6),resolved_by VARCHAR(100),
 INDEX support_user(user_id,created_at),FOREIGN KEY(user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE privacy_meta (id INT PRIMARY KEY,journal_id VARCHAR(36) NOT NULL,last_sequence BIGINT NOT NULL) ENGINE=InnoDB;
CREATE TABLE start_previews (room_id VARCHAR(36) PRIMARY KEY,user_id VARCHAR(36) NOT NULL,version INT NOT NULL,business_date DATE NOT NULL,expires_at BIGINT NOT NULL) ENGINE=InnoDB;
