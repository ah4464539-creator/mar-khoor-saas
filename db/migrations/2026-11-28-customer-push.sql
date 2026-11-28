-- Customer notifications ("your order is ready"), one row per device per order. Also created on first use.
CREATE TABLE IF NOT EXISTS customer_push_subscriptions (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 restaurant_id BIGINT UNSIGNED NOT NULL,
 kind VARCHAR(10) NOT NULL,
 ref_id BIGINT UNSIGNED NOT NULL,
 endpoint VARCHAR(700) NOT NULL,
 endpoint_hash CHAR(64) NOT NULL,
 p256dh VARCHAR(200) NOT NULL,
 auth VARCHAR(64) NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_customer_push (kind, ref_id, endpoint_hash),
 KEY ix_customer_push_restaurant (restaurant_id),
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB;
