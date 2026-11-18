import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFulfillment, normalizePhone, isMissingFulfillmentSchema } from '../src/order-fulfillment.js';

const delivery = { customer_phone: '0300 1234567', order_type: 'delivery', delivery_address: 'House 5, Street 2, Gulberg, Lahore', payment_method: 'cod' };
const pickup = { customer_phone: '+923001234567', order_type: 'pickup', payment_method: 'cash_pickup' };

test('valid Pakistani and international phone numbers are accepted', () => {
  for (const phone of ['03001234567', '+923001234567', '0300-1234567', '(042) 3576 1234', '+1 415 555 0100'])
    assert.ok(normalizePhone(phone), phone);
});

test('invalid phone numbers are rejected', () => {
  for (const phone of ['', '12345', 'abc1234567', '++923001234567', '0300123456789012345', '\\0300123456', 42, null])
    assert.equal(normalizePhone(phone), null, String(phone));
});

test('legacy website checkout without fulfilment details stays supported', () => {
  assert.deepEqual(validateFulfillment({ customer_name: 'A', items: [] }), { ok: true, present: false });
});

test('successful COD delivery order is unpaid with address and instructions', () => {
  const result = validateFulfillment({ ...delivery, delivery_instructions: ' Near the mosque ' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    order_type: 'delivery', customer_phone: '0300 1234567',
    delivery_address: 'House 5, Street 2, Gulberg, Lahore', delivery_instructions: 'Near the mosque',
    payment_method: 'cod', payment_status: 'unpaid',
  });
});

test('successful cash pickup order ignores address fields and is unpaid', () => {
  const result = validateFulfillment({ ...pickup, delivery_address: 'ignored', delivery_instructions: 'ignored' });
  assert.equal(result.ok, true);
  assert.equal(result.value.delivery_address, null);
  assert.equal(result.value.delivery_instructions, null);
  assert.equal(result.value.payment_method, 'cash_pickup');
  assert.equal(result.value.payment_status, 'unpaid');
});

test('missing phone number is rejected', () => {
  const { customer_phone, ...rest } = delivery;
  const result = validateFulfillment(rest);
  assert.equal(result.ok, false);
  assert.match(result.error, /phone number is required/i);
});

test('invalid phone number is rejected', () => {
  const result = validateFulfillment({ ...delivery, customer_phone: '12ab' });
  assert.equal(result.ok, false);
  assert.match(result.error, /valid phone/i);
});

test('missing or blank delivery address is rejected', () => {
  for (const address of [undefined, '', '   ', 'abc']) {
    const result = validateFulfillment({ ...delivery, delivery_address: address });
    assert.equal(result.ok, false, String(address));
    assert.match(result.error, /address/i);
  }
});

test('payment method must match the order type', () => {
  assert.equal(validateFulfillment({ ...delivery, payment_method: 'cash_pickup' }).ok, false);
  assert.equal(validateFulfillment({ ...pickup, payment_method: 'cod' }).ok, false);
  assert.equal(validateFulfillment({ ...pickup, order_type: 'dine_in' }).ok, false);
});

test('online payment is refused while Stripe is not enabled', () => {
  const result = validateFulfillment({ ...delivery, payment_method: 'stripe' });
  assert.equal(result.ok, false);
  assert.match(result.error, /online payment is not available/i);
});

test('client cannot force a paid status', () => {
  const result = validateFulfillment({ ...delivery, payment_status: 'paid' });
  assert.equal(result.value.payment_status, 'unpaid');
});

test('overlong address and instructions are rejected', () => {
  assert.equal(validateFulfillment({ ...delivery, delivery_address: 'x'.repeat(501) }).ok, false);
  assert.equal(validateFulfillment({ ...delivery, delivery_instructions: 'x'.repeat(501) }).ok, false);
  assert.equal(validateFulfillment({ ...delivery, delivery_instructions: 7 }).ok, false);
});

test('missing schema errors are recognised for safe fallback', () => {
  assert.equal(isMissingFulfillmentSchema({ code: 'ER_NO_SUCH_TABLE' }), true);
  assert.equal(isMissingFulfillmentSchema({ code: 'ER_BAD_FIELD_ERROR' }), true);
  assert.equal(isMissingFulfillmentSchema({ code: 'ECONNREFUSED' }), false);
});
