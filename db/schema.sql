-- MariaDB 10.6+ schema. Run against an empty markhoor_saas database.
CREATE TABLE IF NOT EXISTS users (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 email VARCHAR(254) NOT NULL UNIQUE,
 password_hash VARCHAR(255) NOT NULL,
 platform_role ENUM('super_admin','user') NOT NULL DEFAULT 'user',
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS restaurants (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 name VARCHAR(160) NOT NULL,
 slug VARCHAR(160) NOT NULL UNIQUE,
 country_code CHAR(2) NOT NULL,
 currency CHAR(3) NOT NULL,
 locale VARCHAR(20) NOT NULL DEFAULT 'en',
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS restaurant_members (
 restaurant_id BIGINT UNSIGNED NOT NULL,
 user_id BIGINT UNSIGNED NOT NULL,
 role ENUM('admin','staff') NOT NULL,
 PRIMARY KEY (restaurant_id,user_id),
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS menu_items (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 restaurant_id BIGINT UNSIGNED NOT NULL,
 name VARCHAR(180) NOT NULL,
 description TEXT,
 price_minor BIGINT UNSIGNED NOT NULL,
 active BOOLEAN NOT NULL DEFAULT TRUE,
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
 INDEX (restaurant_id,active)
);
CREATE TABLE IF NOT EXISTS orders (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 restaurant_id BIGINT UNSIGNED NOT NULL,
 customer_name VARCHAR(160),
 status ENUM('pending','accepted','preparing','ready','completed','cancelled') NOT NULL DEFAULT 'pending',
 total_minor BIGINT UNSIGNED NOT NULL DEFAULT 0,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id),
 INDEX (restaurant_id,created_at)
);
CREATE TABLE IF NOT EXISTS order_items (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 order_id BIGINT UNSIGNED NOT NULL,
 menu_item_id BIGINT UNSIGNED NULL,
 name_snapshot VARCHAR(180) NOT NULL,
 quantity INT UNSIGNED NOT NULL,
 unit_price_minor BIGINT UNSIGNED NOT NULL,
 FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
 FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS audit_logs (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 actor_user_id BIGINT UNSIGNED NULL,
 restaurant_id BIGINT UNSIGNED NULL,
 action VARCHAR(120) NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE SET NULL
);

-- Explicit, server-managed Vapi assistant to restaurant mapping.
CREATE TABLE IF NOT EXISTS voice_assistants (
 assistant_id VARCHAR(128) NOT NULL PRIMARY KEY,
 restaurant_id BIGINT UNSIGNED NOT NULL,
 active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
 INDEX (restaurant_id,active)
);

CREATE TABLE IF NOT EXISTS voice_order_requests (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 assistant_id VARCHAR(128) NOT NULL,
 call_id VARCHAR(128) NOT NULL,
 restaurant_id BIGINT UNSIGNED NOT NULL,
 order_id BIGINT UNSIGNED NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_voice_call (assistant_id,call_id),
 FOREIGN KEY (assistant_id) REFERENCES voice_assistants(assistant_id),
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id),
 FOREIGN KEY (order_id) REFERENCES orders(id)
);

-- Map each Meta WhatsApp phone number ID to exactly one restaurant.
CREATE TABLE IF NOT EXISTS whatsapp_numbers (
 phone_number_id VARCHAR(64) NOT NULL PRIMARY KEY,
 restaurant_id BIGINT UNSIGNED NOT NULL,
 active BOOLEAN NOT NULL DEFAULT TRUE,
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS whatsapp_inbound_messages (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 message_id VARCHAR(255) NOT NULL UNIQUE,
 restaurant_id BIGINT UNSIGNED NOT NULL,
 phone_number_id VARCHAR(64) NOT NULL,
 sender VARCHAR(64) NOT NULL,
 message_type VARCHAR(32) NOT NULL,
 text_body TEXT NULL,
 received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
 INDEX (restaurant_id,received_at)
);

-- Outgoing WhatsApp replies and their latest Meta delivery state.
CREATE TABLE IF NOT EXISTS whatsapp_outbound_messages (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 message_id VARCHAR(255) NOT NULL UNIQUE,
 restaurant_id BIGINT UNSIGNED NOT NULL,
 phone_number_id VARCHAR(64) NOT NULL,
 recipient VARCHAR(64) NOT NULL,
 text_body TEXT NOT NULL,
 status ENUM('accepted','sent','delivered','read','failed') NOT NULL DEFAULT 'accepted',
 sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 status_at TIMESTAMP NULL DEFAULT NULL,
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
 INDEX (restaurant_id,id)
);

-- AI auto-reply is disabled by default for every restaurant.
CREATE TABLE IF NOT EXISTS whatsapp_ai_settings (
 restaurant_id BIGINT UNSIGNED PRIMARY KEY,
 enabled BOOLEAN NOT NULL DEFAULT FALSE,
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS whatsapp_ai_jobs (
 inbound_message_id VARCHAR(255) PRIMARY KEY,
 restaurant_id BIGINT UNSIGNED NOT NULL,
 status ENUM('pending','processing','sent','failed') NOT NULL DEFAULT 'pending',
 last_error VARCHAR(255) NULL,
 outbound_message_id VARCHAR(255) NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
);


CREATE TABLE IF NOT EXISTS restaurant_public_phones (
 restaurant_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
 phone VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS restaurant_voice_routes (
 restaurant_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
 phone_number_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
 ai_phone VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 staff_phone VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
);

-- Written by the billing integration after confirming an active paid voice plan.
CREATE TABLE IF NOT EXISTS restaurant_paid_voice_access (
 restaurant_id BIGINT UNSIGNED PRIMARY KEY,
 paid_until DATETIME NOT NULL,
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
);

-- Add only provider-activated lines already attached to their dedicated Vapi assistants.
CREATE TABLE IF NOT EXISTS regional_voice_lines (
 phone_number_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 assistant_id VARCHAR(128) NOT NULL UNIQUE,
 phone VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
 country_code CHAR(2) NOT NULL,
 restaurant_id BIGINT UNSIGNED UNIQUE,
 INDEX (country_code,restaurant_id,phone_number_id),
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id)
);

CREATE TABLE IF NOT EXISTS restaurant_chat_profiles (
 restaurant_id BIGINT UNSIGNED PRIMARY KEY,
 display_name VARCHAR(100) NOT NULL,
 greeting VARCHAR(300) NOT NULL,
 web_enabled BOOLEAN NOT NULL DEFAULT TRUE,
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
);
