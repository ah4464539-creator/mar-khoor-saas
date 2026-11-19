-- Additive: lets a dedicated number belong to a paid subscription instead of a plan order.
-- Back up the database first. Run once, after plans-setup.sql. Existing rows are unchanged.
ALTER TABLE restaurant_numbers MODIFY plan_order_id BIGINT UNSIGNED NULL;
ALTER TABLE restaurant_numbers ADD COLUMN subscription_restaurant_id BIGINT UNSIGNED NULL AFTER plan_order_id;
ALTER TABLE restaurant_numbers ADD UNIQUE KEY uq_number_subscription (subscription_restaurant_id);
