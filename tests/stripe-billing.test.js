import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { stripeAmount, verifyStripeSignature, checkoutParams, applyBillingEvent, billingConfig, createStripeClient, addonPeriodMinor, hasNumberAddon } from '../src/stripe-billing.js';

const sign = (body, secret, t = Math.floor(Date.now() / 1000)) => 't=' + t + ',v1=' + crypto.createHmac('sha256', secret).update(t + '.' + body).digest('hex');

function billingPool({ billing = null, subscription = null } = {}) {
  const state = { billing, subscription, events: new Set(), sql: [] };
  return {
    state,
    query: async () => [[]],
    execute: async (sql, args = []) => {
      state.sql.push([sql, args]);
      if (/SELECT event_id FROM stripe_events/.test(sql)) return [state.events.has(args[0]) ? [{ event_id: args[0] }] : []];
      if (/INSERT IGNORE INTO stripe_events/.test(sql)) { state.events.add(args[0]); return [{}]; }
      if (/SELECT stripe_subscription_id FROM restaurant_billing/.test(sql)) return [state.billing ? [state.billing] : []];
      if (/SELECT restaurant_id FROM restaurant_billing WHERE stripe_subscription_id/.test(sql)) return [state.billing?.stripe_subscription_id === args[0] ? [{ restaurant_id: 7 }] : []];
      if (/INSERT INTO restaurant_billing/.test(sql)) { state.billing = { stripe_customer_id: args[1], stripe_subscription_id: args[2], stripe_status: 'active' }; return [{}]; }
      if (/UPDATE restaurant_billing/.test(sql)) { state.billing.stripe_status = args[0]; return [{}]; }
      if (/SELECT status FROM restaurant_subscriptions/.test(sql)) return [state.subscription ? [state.subscription] : []];
      if (/INSERT INTO restaurant_subscriptions/.test(sql)) { state.subscription = { plan: args[1], cycle: args[2], status: 'active', currency: args[4], price: args[5] }; return [{}]; }
      if (/INSERT INTO restaurant_addons/.test(sql)) { state.addon = args[1]; return [{}]; }
      if (/UPDATE restaurant_subscriptions SET status/.test(sql)) { state.subscription.status = args[0]; return [{ affectedRows: 1 }]; }
      throw new Error('Unexpected SQL ' + sql);
    },
  };
}
const paidSession = (overrides = {}) => ({ id: 'evt_1', type: 'checkout.session.completed', data: { object: {
  mode: 'subscription', payment_status: 'paid', amount_total: 1092000, currency: 'pkr', customer: 'cus_1', subscription: 'sub_1',
  metadata: { restaurant_id: '7', plan: 'starter', cycle: 'monthly', price_minor: '1092000', currency: 'PKR' }, ...overrides } } });

test('amounts, signatures and config', () => {
  assert.equal(stripeAmount(1092000, 'PKR'), 1092000);
  assert.equal(stripeAmount(580000, 'JPY'), 5800, 'zero-decimal currencies');
  assert.equal(stripeAmount(0, 'USD'), null);
  const body = JSON.stringify({ id: 'evt_x', type: 'x' });
  assert.equal(verifyStripeSignature(Buffer.from(body), sign(body, 'whsec_a'), 'whsec_a').id, 'evt_x');
  assert.equal(verifyStripeSignature(Buffer.from(body), sign(body, 'whsec_b'), 'whsec_a'), null);
  assert.equal(verifyStripeSignature(Buffer.from(body), sign(body, 'whsec_a', 1000), 'whsec_a'), null, 'old timestamps rejected');
  assert.equal(billingConfig({}), null);
  assert.equal(billingConfig({ STRIPE_SECRET_KEY: 'sk_test_1', STRIPE_WEBHOOK_SECRET: 'whsec_1' }).live, false);
  assert.equal(billingConfig({ STRIPE_SECRET_KEY: 'pk_live_1', STRIPE_WEBHOOK_SECRET: 'whsec_1' }), null, 'publishable key is not a secret key');
});

test('checkout uses the server price as a monthly or yearly subscription', () => {
  const params = checkoutParams({ restaurant: { id: 7, name: 'Lahore Grill' }, subscription: { plan: 'premium', billing_cycle: 'yearly', currency: 'PKR', price_minor: 55720000 },
    plan: { name: 'Premium' }, email: 'o@x.pk', baseUrl: 'https://mar-khoor.com' });
  assert.equal(params.mode, 'subscription');
  assert.equal(params['line_items[0][price_data][unit_amount]'], '55720000');
  assert.equal(params['line_items[0][price_data][currency]'], 'pkr');
  assert.equal(params['line_items[0][price_data][recurring][interval]'], 'year');
  assert.equal(params['subscription_data[metadata][restaurant_id]'], '7');
  assert.equal(params.customer_email, 'o@x.pk');
  assert.equal(params.success_url, 'https://mar-khoor.com/restaurant.html?billing=success#plan');
});

test('paid checkout activates the plan once; mismatched amounts never do', async () => {
  const pool = billingPool({ subscription: { status: 'pending_payment' } });
  assert.equal((await applyBillingEvent(pool, paidSession({ amount_total: 100 }))).result, 'amount_mismatch');
  assert.equal(pool.state.subscription.status, 'pending_payment');
  assert.equal((await applyBillingEvent(pool, { ...paidSession({ payment_status: 'unpaid' }), id: 'evt_2' })).result, 'not_paid');
  const first = await applyBillingEvent(pool, { ...paidSession(), id: 'evt_3' });
  assert.deepEqual([first.result, first.activated, first.restaurantId], ['activated', true, 7]);
  assert.equal(pool.state.subscription.status, 'active');
  assert.equal(pool.state.billing.stripe_subscription_id, 'sub_1');
  assert.equal((await applyBillingEvent(pool, { ...paidSession(), id: 'evt_3' })).result, 'duplicate');
});

test('renewal failures, recovery and cancellation follow Stripe', async () => {
  const pool = billingPool({ billing: { stripe_subscription_id: 'sub_1' }, subscription: { status: 'active' } });
  assert.equal((await applyBillingEvent(pool, { id: 'e1', type: 'invoice.payment_failed', data: { object: { subscription: 'sub_1' } } })).result, 'status_past_due');
  assert.equal(pool.state.subscription.status, 'past_due');
  assert.equal((await applyBillingEvent(pool, { id: 'e2', type: 'invoice.paid', data: { object: { subscription: 'sub_1' } } })).result, 'status_active');
  assert.equal((await applyBillingEvent(pool, { id: 'e3', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', status: 'canceled' } } })).result, 'status_cancelled');
  assert.equal(pool.state.subscription.status, 'cancelled');
  assert.equal((await applyBillingEvent(pool, { id: 'e4', type: 'invoice.paid', data: { object: { subscription: 'sub_other' } } })).result, 'unknown_subscription');
});

test('a plan change cancels the previous Stripe subscription', async () => {
  const pool = billingPool({ billing: { stripe_subscription_id: 'sub_old' }, subscription: { status: 'active' } });
  const cancelled = [];
  const out = await applyBillingEvent(pool, { ...paidSession(), id: 'evt_9' }, { stripe: { cancel: async id => cancelled.push(id) } });
  assert.equal(out.activated, true);
  assert.deepEqual(cancelled, ['sub_old']);
});

test('Stripe client sends form data with the secret key only to api.stripe.com', async () => {
  const calls = [];
  const client = createStripeClient({ secretKey: 'sk_test_1' }, { fetcher: async (url, init) => { calls.push({ url, ...init }); return { ok: true, json: async () => ({ url: 'https://checkout.stripe.com/c/1' }) }; } });
  await client.checkout({ mode: 'subscription' }, 'k1');
  assert.equal(calls[0].url, 'https://api.stripe.com/v1/checkout/sessions');
  assert.equal(calls[0].headers.Authorization, 'Bearer sk_test_1');
  assert.equal(calls[0].headers['Idempotency-Key'], 'k1');
  assert.equal(calls[0].body, 'mode=subscription');
  const server = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.ok(server.indexOf('billingWebhookRouter(pool)') < server.indexOf('express.json('), 'webhook gets the raw body');
  const front = readFileSync(new URL('../public/restaurant.js', import.meta.url), 'utf8');
  assert.ok(!/sk_(live|test)_/.test(front));
});

test('Starter with a dedicated number: cart total = plan + add-on, both recurring', async () => {
  const starter = { name: 'Starter', dedicated_number: { included: false, addon_price_minor: 1372000 } };
  assert.equal(addonPeriodMinor(starter, 'monthly'), 1372000);
  assert.equal(addonPeriodMinor(starter, 'yearly'), 1372000 * 12);
  assert.equal(addonPeriodMinor({ dedicated_number: { included: true, addon_price_minor: null } }, 'monthly'), null);
  const params = checkoutParams({ restaurant: { id: 7, name: 'Grill' }, subscription: { plan: 'starter', billing_cycle: 'monthly', currency: 'PKR', price_minor: 1092000 },
    plan: starter, baseUrl: 'https://mar-khoor.com', addonMinor: 1372000, tools: ['website', 'whatsapp'] });
  assert.equal(params['line_items[1][price_data][unit_amount]'], '1372000');
  assert.equal(params['line_items[1][price_data][recurring][interval]'], 'month');
  assert.equal(params['metadata[tools]'], 'website,whatsapp');
  const pool = billingPool({ subscription: { status: 'pending_payment' } });
  const event = paidSession({ amount_total: 1092000, amount_subtotal: 1092000 });
  event.data.object.metadata = { ...event.data.object.metadata, number_addon: '1', addon_minor: '1372000' };
  assert.equal((await applyBillingEvent(pool, event)).result, 'amount_mismatch', 'add-on must be paid too');
  event.id = 'evt_addon'; event.data.object.amount_subtotal = 1092000 + 1372000; event.data.object.amount_total = 2000000;
  assert.equal((await applyBillingEvent(pool, event)).result, 'activated', 'promotion codes lower the total, not the subtotal');
  assert.equal(pool.state.addon, 1);
  assert.equal(await hasNumberAddon({ execute: async () => [[{ dedicated_number: 1 }]] }, 7), true);
  assert.equal(await hasNumberAddon({ execute: async () => { throw new Error('no table'); } }, 7), false);
});
