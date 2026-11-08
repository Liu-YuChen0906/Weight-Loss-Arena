CREATE DATABASE IF NOT EXISTS shangcheng_java_journal CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
-- The entrypoint creates the business database and app user first. Grant only the separate journal schema here.
GRANT ALL ON shangcheng_java_journal.* TO 'shangcheng'@'%';
USE shangcheng_java_journal;
CREATE TABLE IF NOT EXISTS identity (id INT PRIMARY KEY,journal_id VARCHAR(36) NOT NULL);
INSERT IGNORE INTO identity VALUES(1,UUID());
CREATE TABLE IF NOT EXISTS events (
 sequence BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,event_id VARCHAR(36) NOT NULL UNIQUE,
 user_id VARCHAR(36) NOT NULL,created_at TIMESTAMP(6) NOT NULL
) ENGINE=InnoDB;
