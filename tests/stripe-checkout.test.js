import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { stripeReady, createStripeCheckout, verifyStripeWebhook, applyVerifiedStripeEvent } from '../src/stripe-checkout.js';

const env = { STRIPE_CHECKOUT_ENABLED: '1', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_test' };
const sign = (body, secret = env.STRIPE_WEBHOOK_SECRET, t = Math.floor(Date.now() / 1000)) =>
  't=' + t + ',v1=' + crypto.createHmac('sha256', secret).update(t + '.' + body).digest('hex');

test('Stripe is disabled unless explicitly enabled and both secrets are configured', () => {
  assert.equal(stripeReady({}), false);
  assert.equal(stripeReady({ STRIPE_SECRET_KEY: 'a', STRIPE_WEBHOOK_SECRET: 'b' }), false);
  assert.equal(stripeReady({ ...env, STRIPE_CHECKOUT_ENABLED: '0' }), false);
  assert.equal(stripeReady({ ...env, STRIPE_WEBHOOK_SECRET: '' }), false);
  assert.equal(stripeReady(env), true);
});

test('checkout session is never created while Stripe is unconfigured', async () => {
  let called = false;
  await assert.rejects(createStripeCheckout({ orderId: 1, restaurantId: 1, currency: 'pkr', totalMinor: 100, successUrl: 'https://a', cancelUrl: 'https://b' }, {}, () => { called = true; }), /not configured/);
  assert.equal(called, false);
});

test('checkout session carries restaurant and order metadata with a tenant-scoped idempotency key', async () => {
  let request;
  const fakeFetch = async (url, init) => { request = { url, init }; return { ok: true, json: async () => ({ id: 'cs_test_1', url: 'https://checkout.stripe.com/x' }) }; };
  const session = await createStripeCheckout({ orderId: 7, restaurantId: 3, currency: 'pkr', totalMinor: 2598, successUrl: 'https://a', cancelUrl: 'https://b' }, env, fakeFetch);
  assert.deepEqual(session, { sessionId: 'cs_test_1', url: 'https://checkout.stripe.com/x' });
  const params = new URLSearchParams(request.init.body);
  assert.equal(params.get('metadata[order_id]'), '7');
  assert.equal(params.get('metadata[restaurant_id]'), '3');
  assert.equal(params.get('line_items[0][price_data][unit_amount]'), '2598');
  assert.equal(request.init.headers['Idempotency-Key'], 'restaurant-3-order-7');
  await assert.rejects(createStripeCheckout({ orderId: 7, currency: 'pkr', totalMinor: 1, successUrl: 'https://a', cancelUrl: 'https://b' }, env, fakeFetch), /Invalid/);
});

test('valid webhook signature is accepted', () => {
  const body = JSON.stringify({ type: 'checkout.session.completed' });
  assert.deepEqual(verifyStripeWebhook(Buffer.from(body), sign(body), env), { type: 'checkout.session.completed' });
});

test('invalid, stale, or unsigned webhooks are rejected', () => {
  const body = JSON.stringify({ type: 'checkout.session.completed' });
  assert.equal(verifyStripeWebhook(Buffer.from(body), sign(body, 'whsec_wrong'), env), null);
  assert.equal(verifyStripeWebhook(Buffer.from(body + ' '), sign(body), env), null);
  assert.equal(verifyStripeWebhook(Buffer.from(body), sign(body, env.STRIPE_WEBHOOK_SECRET, Math.floor(Date.now() / 1000) - 600), env), null);
  assert.equal(verifyStripeWebhook(Buffer.from(body), 't=1', env), null);
  assert.equal(verifyStripeWebhook(Buffer.from(body), undefined, env), null);
  assert.equal(verifyStripeWebhook(body, sign(body), env), null);
  assert.equal(verifyStripeWebhook(Buffer.from(body), sign(body), {}), null, 'disabled Stripe accepts nothing');
});

function pool(row) {
  const state = { updates: 0, row };
  return { state, async execute(sql, args) {
    if (sql.startsWith('SELECT')) {
      // Tenant isolation: the lookup must filter by both order and restaurant.
      return [state.row && args[0] === state.row.order_id && args[1] === state.row.restaurant_id ? [state.row] : []];
    }
    if (sql.startsWith('UPDATE')) {
      if (state.row.payment_status === 'paid') return [{ affectedRows: 0 }];
      state.row.payment_status = 'paid'; state.updates++; return [{ affectedRows: 1 }];
    }
    throw Error('unexpected ' + sql);
  } };
}
const order = () => ({ order_id: 7, restaurant_id: 3, total_minor: 2598, currency: 'PKR', payment_method: 'stripe', payment_status: 'pending', stripe_checkout_session_id: 'cs_test_1' });
const event = (over = {}) => ({ type: 'checkout.session.completed', data: { object: { id: 'cs_test_1', payment_status: 'paid', amount_total: 2598, currency: 'pkr', metadata: { order_id: '7', restaurant_id: '3' }, ...over } } });

test('verified paid event marks the order paid once; replays are harmless', async () => {
  const p = pool(order());
  assert.deepEqual(await applyVerifiedStripeEvent(p, event()), { result: 'paid' });
  assert.deepEqual(await applyVerifiedStripeEvent(p, event()), { result: 'duplicate' });
  assert.equal(p.state.updates, 1);
});

test('amount, currency, session and restaurant mismatches never mark paid', async () => {
  for (const [over, reason] of [
    [{ amount_total: 1 }, 'amount_mismatch'],
    [{ currency: 'usd' }, 'amount_mismatch'],
    [{ id: 'cs_other' }, 'session_mismatch'],
    [{ metadata: { order_id: '7', restaurant_id: '4' } }, 'order_not_found'],
    [{ metadata: { order_id: '7' } }, 'metadata'],
  ]) {
    const p = pool(order());
    assert.deepEqual(await applyVerifiedStripeEvent(p, event(over)), { result: 'rejected', reason });
    assert.equal(p.state.updates, 0);
  }
});

test('unpaid sessions and unrelated events are ignored', async () => {
  const p = pool(order());
  assert.equal((await applyVerifiedStripeEvent(p, event({ payment_status: 'unpaid' }))).result, 'ignored');
  assert.equal((await applyVerifiedStripeEvent(p, { type: 'charge.refunded', data: { object: {} } })).result, 'ignored');
  assert.equal(p.state.updates, 0);
});

test('cash orders can never be marked paid by a Stripe event', async () => {
  const p = pool({ ...order(), payment_method: 'cod', payment_status: 'unpaid' });
  assert.deepEqual(await applyVerifiedStripeEvent(p, event()), { result: 'rejected', reason: 'session_mismatch' });
});
