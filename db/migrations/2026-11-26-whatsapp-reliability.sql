-- Workstream: WhatsApp AI reliability. Additive: two new tables (job state for send lock / retries /
-- dead-letter, and customer consent). Nothing existing is changed. Applied by npm run migrate; the app
-- also creates them on first use (src/whatsapp-reliability.js).
CREATE TABLE IF NOT EXISTS whatsapp_job_state (
 inbound_message_id VARCHAR(255) NOT NULL PRIMARY KEY,
 restaurant_id BIGINT UNSIGNED NOT NULL,
 attempts INT UNSIGNED NOT NULL DEFAULT 0,
 claimed_at TIMESTAMP NULL DEFAULT NULL,
 next_attempt_at TIMESTAMP NULL DEFAULT NULL,
 send_started_at TIMESTAMP NULL DEFAULT NULL,
 dead_letter TINYINT(1) NOT NULL DEFAULT 0,
 last_error VARCHAR(255) NULL,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
 INDEX (restaurant_id, dead_letter),
 INDEX (next_attempt_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS whatsapp_contacts (
 restaurant_id BIGINT UNSIGNED NOT NULL,
 customer VARCHAR(64) NOT NULL,
 opted_out TINYINT(1) NOT NULL DEFAULT 0,
 opted_out_at TIMESTAMP NULL DEFAULT NULL,
 opted_in_at TIMESTAMP NULL DEFAULT NULL,
 language VARCHAR(10) NULL,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 PRIMARY KEY (restaurant_id, customer),
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB;
