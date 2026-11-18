-- Additive migration for COD / cash-on-pickup checkout (PR #46).
-- Safe to re-run: creates one new table only; never alters, drops or truncates existing tables.
-- Apply to a STAGING copy first, then to production BEFORE deploying the code that writes to it.
--
-- Pre-checks (run first, note the numbers):
--   SELECT COUNT(*) FROM orders; SELECT COUNT(*) FROM order_items; SELECT COUNT(*) FROM order_tracking;
--   SHOW CREATE TABLE orders;   -- id must be BIGINT UNSIGNED, engine InnoDB
--   SHOW CREATE TABLE restaurants;
CREATE TABLE IF NOT EXISTS order_fulfillment (
 order_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
 restaurant_id BIGINT UNSIGNED NOT NULL,
 order_type ENUM('delivery','pickup') NOT NULL,
 customer_phone VARCHAR(32) NOT NULL,
 delivery_address VARCHAR(500) NULL,
 delivery_instructions VARCHAR(500) NULL,
 payment_method ENUM('cod','cash_pickup','stripe') NOT NULL,
 payment_status ENUM('unpaid','pending','paid','failed','refunded') NOT NULL DEFAULT 'unpaid',
 stripe_checkout_session_id VARCHAR(255) NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_fulfillment_stripe_session (stripe_checkout_session_id),
 FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
 INDEX (restaurant_id,payment_status)
) ENGINE=InnoDB;
-- Post-checks: the three COUNT(*) values above must be unchanged, and
--   SELECT COUNT(*) FROM order_fulfillment;  -- 0 right after migration
-- Rollback (only if the new code is rolled back AND no COD orders exist yet):
--   DROP TABLE order_fulfillment;   -- requires explicit owner approval
