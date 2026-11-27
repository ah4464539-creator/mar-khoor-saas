import test from 'node:test';
process.env.VOICE_AUTOPROVISION_ENABLED = '1'; // these tests cover selling new numbers (switched on here)
import assert from 'node:assert/strict';
import { toolCatalog, validateToolChoice, toolCartLines, numberCostUsd } from '../src/tools.js';
import { applyBillingEvent, toolsCheckoutParams } from '../src/stripe-billing.js';

test('approved single-tool prices; AI Calling number at real cost; yearly = 10 months', () => {
  const us = toolCatalog('USD', 'US');
  assert.deepEqual(us.map(t => [t.key, t.price_minor.monthly, t.price_minor.yearly]), [['website', 1200, 12000], ['whatsapp', 1900, 19000], ['calling', 2900, 29000]]);
  const calling = us.find(t => t.key === 'calling');
  assert.equal(calling.number.price_minor.monthly, 100);
  assert.equal(calling.extra_minute_minor, 25);
  const pk = toolCatalog('PKR', 'PK', { fx: { rates: { PKR: 280 } } }).find(t => t.key === 'calling');
  assert.equal(pk.currency, 'PKR');
  assert.equal(pk.number.recommend_own, true, 'Pakistan: own spare number is recommended');
  assert.equal(numberCostUsd('PK'), 4250);
  assert.equal(numberCostUsd('DE', {}), null);
  assert.equal(toolCatalog('EUR', 'DE', { fx: null })[2].number.available, false, 'unknown cost: own number only');
});

test('cart lines come from the server catalog only', () => {
  const catalog = toolCatalog('USD', 'PK');
  assert.ok(validateToolChoice({ tools: [] }).error);
  const choice = validateToolChoice({ tools: ['calling', 'website', 'calling', 'evil'], billing_cycle: 'monthly', call_number: 'new', price: 1 }).value;
  assert.deepEqual(choice, { tools: ['calling', 'website'], cycle: 'monthly', numberMode: 'new' });
  const cart = toolCartLines(catalog, choice);
  assert.deepEqual(cart.lines.map(l => [l.key, l.amount_minor]), [['calling', 2900], ['website', 1200], ['number', 4250]]);
  assert.equal(cart.total_minor, 8350);
  assert.ok(toolCartLines(toolCatalog('EUR', 'DE'), { tools: ['calling'], cycle: 'monthly', numberMode: 'new' }).error);
});

test('paid tools checkout activates exactly the tools that were paid for', async () => {
  const catalog = toolCatalog('USD', 'PK');
  const cart = toolCartLines(catalog, { tools: ['calling', 'whatsapp'], cycle: 'monthly', numberMode: 'new' });
  const params = toolsCheckoutParams({ restaurant: { id: 7 }, cart, cycle: 'monthly', numberMode: 'new', baseUrl: 'https://mar-khoor.com' });
  assert.equal(params['line_items[2][price_data][unit_amount]'], '4250');
  assert.equal(params['metadata[kind]'], 'tools');
  const meta = Object.fromEntries(Object.entries(params).filter(([k]) => k.startsWith('metadata[')).map(([k, v]) => [k.slice(9, -1), v]));
  const writes = [];
  const pool = { query: async () => [[]], execute: async (sql, args) => { writes.push([sql, args]); return /SELECT/.test(sql) ? [[]] : [{ affectedRows: 1 }]; } };
  const event = (id, total) => ({ id, type: 'checkout.session.completed', data: { object: { mode: 'subscription', payment_status: 'paid', amount_subtotal: total, amount_total: total, currency: 'usd', customer: 'cus_1', subscription: 'sub_t', metadata: meta } } });
  assert.equal((await applyBillingEvent(pool, event('e1', 100))).result, 'amount_mismatch');
  const ok = await applyBillingEvent(pool, event('e2', 2900 + 1900 + 4250));
  assert.equal(ok.result, 'tools_activated');
  assert.equal(ok.activated, true, 'new number gets provisioned');
  const inserts = writes.filter(([sql]) => /INSERT INTO restaurant_tools/.test(sql)).map(([, a]) => [a[1], a[3], a[5]]);
  assert.deepEqual(inserts, [['calling', 'new', 7150], ['whatsapp', null, 1900]]);
  assert.ok(!writes.some(([sql]) => /restaurant_subscriptions/.test(sql)), 'tools never touch the plan');
});
