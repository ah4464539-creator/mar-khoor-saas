-- Customer accounts for the Mar-Khoor app (email sign-in link, orders and bookings on every phone). Also created on first use.
CREATE TABLE IF NOT EXISTS customer_accounts (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 email VARCHAR(254) NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 last_login_at TIMESTAMP NULL DEFAULT NULL,
 UNIQUE KEY uq_customer_email (email)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS customer_login_links (
 token_hash CHAR(64) NOT NULL PRIMARY KEY,
 email VARCHAR(254) NOT NULL,
 expires_at DATETIME NOT NULL,
 used_at DATETIME NULL DEFAULT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY ix_customer_login_email (email)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS customer_sessions (
 token_hash CHAR(64) NOT NULL PRIMARY KEY,
 account_id BIGINT UNSIGNED NOT NULL,
 expires_at DATETIME NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY ix_customer_sessions_account (account_id),
 FOREIGN KEY (account_id) REFERENCES customer_accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS customer_orders (
 account_id BIGINT UNSIGNED NOT NULL,
 order_id BIGINT UNSIGNED NOT NULL,
 token_enc TEXT NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (account_id, order_id),
 FOREIGN KEY (account_id) REFERENCES customer_accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS customer_bookings (
 account_id BIGINT UNSIGNED NOT NULL,
 booking_id BIGINT UNSIGNED NOT NULL,
 restaurant_id BIGINT UNSIGNED NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (account_id, booking_id),
 FOREIGN KEY (account_id) REFERENCES customer_accounts(id) ON DELETE CASCADE,
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB;
