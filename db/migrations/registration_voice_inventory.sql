CREATE TABLE IF NOT EXISTS registration_voice_inventory (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  country_code CHAR(2) NOT NULL,
  phone_number VARCHAR(20) NOT NULL UNIQUE,
  vapi_phone_id VARCHAR(64) NOT NULL UNIQUE,
  assistant_id VARCHAR(128) NOT NULL UNIQUE,
  restaurant_id BIGINT UNSIGNED NULL UNIQUE,
  INDEX (country_code, restaurant_id, id),
  FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE RESTRICT
);
