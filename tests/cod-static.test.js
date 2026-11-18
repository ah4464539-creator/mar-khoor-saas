import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('dashboard fulfilment join is scoped to the requesting restaurant', () => {
  const ops = read('src/operations.js');
  assert.match(ops, /LEFT JOIN order_fulfillment f ON f\.order_id=o\.id AND f\.restaurant_id=o\.restaurant_id WHERE o\.restaurant_id=\?/);
});

test('assistant checkout never asks for card details and has no escaped newline bug', () => {
  const panel = read('public/restaurant-assistant-panel.js');
  assert.doesNotMatch(panel, /'\\\\n/);
  assert.doesNotMatch(panel, /\/\^\\\\\+\?/, 'phone regex must not require a literal backslash');
  assert.doesNotMatch(panel, /enter your (card|cvv)/i);
  assert.match(panel, /never share card details/i);
  assert.match(panel, /check Order History before ordering again/);
});

test('Stripe webhook is not routed while integration is pending', () => {
  for (const file of ['src/server.js', 'src/checkout.js']) assert.doesNotMatch(read(file), /from '.\/stripe-checkout\.js'/);
});

test('migration is additive only', () => {
  const sql = read('db/migrations/order-fulfillment.sql').split('\n').filter(line => !line.trim().startsWith('--')).join('\n');
  assert.doesNotMatch(sql.replace(/ON DELETE CASCADE/g, ""), /\b(DROP|TRUNCATE|DELETE|ALTER)\b/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS order_fulfillment/);
});
