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
  assert.match(side, /href="#payment-methods"/);
});

test('payment methods have their own page in the left menu', () => {
  const html = readFileSync('public/restaurant.html', 'utf8');
  assert.match(html, /<a data-admin-only href="#payment-methods">/);
  const page = html.slice(html.indexOf('id="payment-methods"'), html.indexOf('id="menu-management"'));
  for (const id of ['pay-form', 'pay-cash', 'pay-card', 'pay-transfers', 'pay-add', 'pay-preview', 'pay-note']) assert.match(page, new RegExp('id="' + id + '"'), id);
});

test('order cards show items, source, contact links and map', () => {
  const js = readFileSync('public/restaurant.js', 'utf8');
  for (const bit of ["'order-items'", 'ORDER_SOURCES', "'tel:'", "'https://wa.me/'", 'google.com/maps/search', 'function ownerAgo']) assert.ok(js.includes(bit), bit);
  const api = readFileSync('src/operations.js', 'utf8');
  assert.match(api, /const withDetails=async orders=>/);
  assert.match(api, /JOIN orders o ON o\.id=i\.order_id AND o\.restaurant_id=\?/);
});

test('order cards are compact (3 lines) and open on tap', () => {
  const js = readFileSync('public/restaurant.js', 'utf8');
  for (const bit of ["'oc-top'", "'oc-mid'", "'oc-bot'", "'order-details'", 'ownerOpenOrders', "aria-expanded"]) assert.ok(js.includes(bit), bit);
  assert.match(readFileSync('public/owner.css', 'utf8'), /\.order-card\.open \.order-details\{display:grid\}/);
});

test('new owners land on Plans & billing; paid tools show their setup', () => {
  const js = readFileSync('public/restaurant.js', 'utf8');
  assert.match(js, /goToCart\(remembered\?\.plan \|\| null, remembered\?\.cycle \|\| null, billingWelcome\)/);
  for (const bit of ['function renderPlanIntegrations', 'PLAN_INTEGRATIONS', "'#whatsapp-inbox-view'", "'#site-widget'"]) assert.ok(js.includes(bit), bit);
  assert.match(readFileSync('public/restaurant.html', 'utf8'), /id="plan-integrations"/);
});
