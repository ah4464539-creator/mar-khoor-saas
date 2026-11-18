-- Additive migration: subscription plans, usage counters and the post-registration setup box.
-- Creates three new tables only. Safe to re-run. Apply to staging first, then production before deploying.
-- Rollback (only with owner approval, before any restaurant uses them): DROP TABLE restaurant_integrations, usage_counters, restaurant_subscriptions;
CREATE TABLE IF NOT EXISTS restaurant_subscriptions (
 restaurant_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
 plan_key ENUM('starter','premium','enterprise') NOT NULL,
 billing_cycle ENUM('monthly','yearly') NOT NULL,
 status ENUM('pending_payment','active','past_due','cancelled') NOT NULL DEFAULT 'pending_payment',
 limits JSON NOT NULL,
 currency CHAR(3) NOT NULL,
 price_minor BIGINT UNSIGNED NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS usage_counters (
 restaurant_id BIGINT UNSIGNED NOT NULL,
 period CHAR(7) NOT NULL,
 metric ENUM('ai_chats','whatsapp_messages','ai_call_minutes') NOT NULL,
 used BIGINT UNSIGNED NOT NULL DEFAULT 0,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 PRIMARY KEY (restaurant_id,period,metric),
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS restaurant_integrations (
 restaurant_id BIGINT UNSIGNED NOT NULL,
 kind ENUM('whatsapp','ai_caller','website') NOT NULL,
 mode VARCHAR(20) NULL,
 value VARCHAR(253) NULL,
 status ENUM('not_started','pending','connected','failed','skipped') NOT NULL DEFAULT 'pending',
 detail VARCHAR(500) NULL,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 PRIMARY KEY (restaurant_id,kind),
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB;
