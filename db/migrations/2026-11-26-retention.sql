-- Workstream: production readiness. Additive: one new table for each restaurant's own retention period.
-- Applied by npm run migrate; the app also creates it on first use (src/retention.js).
CREATE TABLE IF NOT EXISTS restaurant_privacy_settings (
 restaurant_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
 message_retention_days SMALLINT UNSIGNED NULL,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB;
