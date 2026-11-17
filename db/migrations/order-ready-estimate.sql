-- Run once on existing MariaDB databases before deploying the ETA backend.
-- Epoch seconds avoid ambiguities between restaurant and database time zones.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS estimated_ready_epoch BIGINT UNSIGNED NULL DEFAULT NULL;
