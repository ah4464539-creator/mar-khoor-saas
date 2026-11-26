-- Workstream: payments. Additive: three new tables (restaurant payment accounts, payment transactions,
-- payment events). Nothing existing is changed. Applied by npm run migrate; the app also creates them on
-- first use (src/payments/service.js).
CREATE TABLE IF NOT EXISTS restaurant_payment_accounts (
 restaurant_id BIGINT UNSIGNED NOT NULL,
 provider VARCHAR(20) NOT NULL,
 account_id VARCHAR(80) NOT NULL,
 charges_enabled TINYINT(1) NOT NULL DEFAULT 0,
 online_enabled TINYINT(1) NOT NULL DEFAULT 0,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 PRIMARY KEY (restaurant_id, provider),
 UNIQUE KEY uq_payment_account (provider, account_id),
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS payment_transactions (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 provider VARCHAR(20) NOT NULL,
 kind VARCHAR(20) NOT NULL,
 restaurant_id BIGINT UNSIGNED NULL,
 order_id BIGINT UNSIGNED NULL,
 provider_ref VARCHAR(120) NOT NULL,
 payment_ref VARCHAR(120) NULL,
 account_id VARCHAR(80) NULL,
 amount_minor BIGINT UNSIGNED NOT NULL,
 currency CHAR(3) NOT NULL,
 fee_minor BIGINT UNSIGNED NOT NULL DEFAULT 0,
 refunded_minor BIGINT UNSIGNED NOT NULL DEFAULT 0,
 status VARCHAR(20) NOT NULL DEFAULT 'pending',
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uq_payment_ref (provider, provider_ref),
 INDEX (restaurant_id, order_id),
 INDEX (kind, status, created_at),
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE SET NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS payment_events (
 provider VARCHAR(20) NOT NULL,
 event_id VARCHAR(80) NOT NULL,
 type VARCHAR(40) NOT NULL,
 result VARCHAR(40) NOT NULL,
 received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (provider, event_id)
) ENGINE=InnoDB;
