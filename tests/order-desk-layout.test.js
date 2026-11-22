import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Live orders: board left, side panel with payment methods and app alerts', () => {
  const html = readFileSync('public/restaurant.html', 'utf8');
  const desk = html.slice(html.indexOf('id="order-desk"'), html.indexOf('id="menu-management"'));
  assert.ok(desk.indexOf('class="order-main"') < desk.indexOf('class="order-side"'));
  const side = desk.slice(desk.indexOf('class="order-side"'));
  assert.match(side, /id="pay-settings"/);
  assert.match(side, /id="app-alerts"/);
  assert.match(desk, /id="order-summary"/);
});

test('order cards show items, source, contact links and map', () => {
  const js = readFileSync('public/restaurant.js', 'utf8');
  for (const bit of ["'order-items'", 'ORDER_SOURCES', "'tel:'", "'https://wa.me/'", 'google.com/maps/search', 'function ownerAgo']) assert.ok(js.includes(bit), bit);
  const api = readFileSync('src/operations.js', 'utf8');
  assert.match(api, /const withDetails=async orders=>/);
  assert.match(api, /JOIN orders o ON o\.id=i\.order_id AND o\.restaurant_id=\?/);
});
