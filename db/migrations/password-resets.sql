-- Additive: adds the password_resets table only. Safe to run more than once.
-- Also applied automatically by `npm run migrate` (db/schema.sql).
-- Self-service password reset links. Only a SHA-256 hash of the emailed token is stored.
CREATE TABLE IF NOT EXISTS password_resets (
 token_hash CHAR(64) NOT NULL PRIMARY KEY,
 user_id BIGINT UNSIGNED NOT NULL,
 expires_at DATETIME NOT NULL,
 used_at DATETIME NULL DEFAULT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
 INDEX (user_id),
 INDEX (expires_at)
);
