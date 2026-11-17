-- Run once on existing MariaDB databases before deploying the ETA backend.
-- Epoch seconds avoid ambiguities between restaurant and database time zones.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS estimated_ready_epoch BIGINT UNSIGNED NULL DEFAULT NULL;

-- Optional per-restaurant UUID blocks duplicate voice submissions.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_request_id CHAR(36) NULL DEFAULT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_order_request ON orders (restaurant_id,client_request_id);
