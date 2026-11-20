import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sanitizePaymentSettings, publicPaymentOptions, resolvePaymentOption, normalizeReference, paymentView, loadPaymentSettings } from '../src/payment-options.js';

const settings = sanitizePaymentSettings({ cash: true, card_on_delivery: true, transfers: [
  { id: 'abcd1234', type: 'jazzcash', account_title: 'Lahore Grill', account_number: '0300 1234567', instructions: '<b>Add order no.</b>' },
  { type: 'bank', label: 'Meezan Bank', account_title: '', account_number: 'PK00' },
] });

test('settings are cleaned; incomplete accounts are dropped; never zero methods', () => {
  assert.equal(settings.transfers.length, 1);
  assert.equal(settings.transfers[0].label, 'JazzCash');
  assert.ok(!settings.transfers[0].instructions.includes('<'));
  assert.equal(sanitizePaymentSettings({ cash: false }).cash, true);
  assert.deepEqual(publicPaymentOptions(settings).map(o => o.key), ['cash', 'card', 'transfer:abcd1234']);
});

test('checkout choices resolve only to what the restaurant offers', () => {
  assert.equal(resolvePaymentOption(settings, 'cash'), null);
  assert.equal(resolvePaymentOption(settings, undefined), null);
  assert.equal(resolvePaymentOption(settings, 'card').method_type, 'card_on_delivery');
  assert.equal(resolvePaymentOption(settings, 'transfer:abcd1234').method_label, 'JazzCash');
  assert.ok(resolvePaymentOption(settings, 'transfer:zzzz9999').error);
  assert.ok(resolvePaymentOption(sanitizePaymentSettings({ cash: false, card_on_delivery: true }), 'cash').error);
  assert.ok(resolvePaymentOption(sanitizePaymentSettings({}), 'card').error);
});

test('transaction IDs and the customer view', async () => {
  assert.deepEqual(normalizeReference(' TXN 123456 '), { ok: true, value: 'TXN 123456' });
  assert.equal(normalizeReference('<script>').ok, false);
  assert.deepEqual(normalizeReference(''), { ok: true, value: null });
  const view = paymentView({ option_key: 'transfer:abcd1234', method_type: 'jazzcash', method_label: 'JazzCash', reference: null, status: 'awaiting' }, settings);
  assert.equal(view.account_number, '0300 1234567');
  assert.equal(paymentView({ option_key: 'transfer:abcd1234', method_type: 'jazzcash', method_label: 'JazzCash', reference: 'x', status: 'confirmed' }, settings).account_number, undefined);
  assert.equal((await loadPaymentSettings({ execute: async () => { throw new Error('no table'); } }, 1)).cash, true);
});

test('routes: owner-only settings, token-checked reference, paid only on confirm', () => {
  const ops = readFileSync(new URL('../src/operations.js', import.meta.url), 'utf8');
  assert.match(ops, /router\.use\('\/restaurants\/:restaurantId',requireAuth,access\)/);
  assert.match(ops, /payment_status=\? WHERE order_id=\? AND restaurant_id=\?/);
  const checkout = readFileSync(new URL('../src/checkout.js', import.meta.url), 'utf8');
  assert.match(checkout, /JOIN order_tracking t ON t\.order_id=p\.order_id SET p\.reference=\?,p\.status='submitted' WHERE p\.order_id=\? AND t\.token_hash=\?/);
  assert.ok(!/payment_status='paid'/.test(checkout), 'a customer can never mark an order paid');
});
