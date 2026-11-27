-- AI Caller on the business's own number (SIM gateway, landline adapter or phone system). Additive: one new table.
-- Applied by npm run migrate; the app also creates it on first use (src/own-line.js).
CREATE TABLE IF NOT EXISTS restaurant_own_lines (
 restaurant_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
 phone_number VARCHAR(20) NOT NULL,
 line_type VARCHAR(12) NOT NULL,
 sip_user VARCHAR(40) NOT NULL,
 sip_username VARCHAR(40) NOT NULL,
 sip_password_enc TEXT NOT NULL,
 vapi_phone_id VARCHAR(64) NULL,
 status VARCHAR(20) NOT NULL DEFAULT 'waiting_call',
 first_call_at TIMESTAMP NULL DEFAULT NULL,
 last_call_at TIMESTAMP NULL DEFAULT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uq_own_line_sip (sip_user),
 UNIQUE KEY uq_own_line_vapi (vapi_phone_id),
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB;
