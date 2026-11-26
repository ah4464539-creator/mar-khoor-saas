-- Workstream: Vapi AI calling. Additive: two new tables, nothing existing is changed.
-- Applied by npm run migrate; the app also creates them on first use (src/vapi-call-log.js).
CREATE TABLE IF NOT EXISTS voice_call_details (
 assistant_id VARCHAR(128) NOT NULL,
 call_id VARCHAR(128) NOT NULL,
 restaurant_id BIGINT UNSIGNED NOT NULL,
 caller_number VARCHAR(32) NULL,
 duration_seconds INT UNSIGNED NULL,
 summary TEXT NULL,
 recording_url VARCHAR(500) NULL,
 transferred_to VARCHAR(32) NULL,
 minutes_recorded TINYINT(1) NOT NULL DEFAULT 0,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 PRIMARY KEY (assistant_id, call_id),
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
 INDEX (restaurant_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS voice_call_transcript_lines (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 assistant_id VARCHAR(128) NOT NULL,
 call_id VARCHAR(128) NOT NULL,
 restaurant_id BIGINT UNSIGNED NOT NULL,
 role VARCHAR(16) NOT NULL,
 text TEXT NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
 INDEX (assistant_id, call_id, id),
 INDEX (restaurant_id, created_at)
) ENGINE=InnoDB;
