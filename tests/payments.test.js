import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import express from 'express';
import mysql from 'mysql2/promise';
import { assertProvider, getProvider, PROVIDER_METHODS } from '../src/payments/provider.js';
import { createStripeProvider, stripePaymentsConfig, fromStripeAmount } from '../src/payments/stripe-provider.js';
import { PAYMENTS_SQL, applyPaymentEvent, refundOrder, revenueReport, saveAccount, recordInvoice } from '../src/payments/service.js';
import { paymentsWebhookRouter } from '../src/payments/routes.js';
import { checkQuota, limitPolicy } from '../src/usage-limits.js';

const config = { secretKey: 'sk_test_123', webhookSecret: 'whsec_test', live: false, feeBps: 200 };
const sign = (body, secret = 'whsec_test', t = Math.floor(Date.now() / 1000)) => 't=' + t + ',v1=' + crypto.createHmac('sha256', secret).update(t + '.' + body).digest('hex');

test('the Stripe adapter implements the provider-agnostic interface', () => {
  const provider = assertProvider(createStripeProvider(config));
  for (const method of PROVIDER_METHODS) assert.equal(typeof provider[method], 'function');
  assert.throws(() => assertProvider({ name: 'x', createCheckout() {} }), /missing verifyWebhook/);
  assert.equal(getProvider('stripe', {}), null, 'not configured without keys');
  assert.equal(getProvider('stripe', { STRIPE_SECRET_KEY: 'sk_test_1', STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_1' }).name, 'stripe');
  assert.equal(getProvider('jazzcash', {}), null, 'unknown providers are simply unavailable');
  assert.equal(stripePaymentsConfig({ STRIPE_SECRET_KEY: 'sk_test_1', STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_1', ORDER_PAYMENTS_ENABLED: '0' }), null);
  assert.equal(stripePaymentsConfig({ STRIPE_SECRET_KEY: 'sk_test_1', STRIPE_CONNECT_WEBHOOK_SECRET: 'w', PAYMENTS_PLATFORM_FEE_BPS: '99999' }).feeBps, 0);
});

test('checkout is a direct charge on the restaurant account, with server amounts and the platform fee', async () => {
  const calls = [];
  const fetcher = async (url, options) => { calls.push({ url, options, params: new URLSearchParams(options.body) }); return { ok: true, json: async () => ({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }) }; };
  const provider = createStripeProvider(config, { fetcher });
  const session = await provider.createCheckout({ orderId: 12, restaurantId: 4, amountMinor: 150000, currency: 'PKR', description: 'Cafe · Order #12', successUrl: 'https://mar-khoor.com/track.html?order=12', cancelUrl: 'https://mar-khoor.com/menu.html', account: 'acct_1ABCdef', idempotencyKey: 'mk-order-4-12' });
  assert.deepEqual(session, { provider: 'stripe', sessionId: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1', feeMinor: 3000 });
  const { options, params } = calls[0];
  assert.equal(options.headers['Stripe-Account'], 'acct_1ABCdef');
  assert.equal(options.headers['Idempotency-Key'], 'mk-order-4-12');
  assert.equal(params.get('line_items[0][price_data][unit_amount]'), '150000');
  assert.equal(params.get('payment_intent_data[application_fee_amount]'), '3000');
  assert.equal(params.get('metadata[kind]'), 'order');
  await assert.rejects(provider.createCheckout({ orderId: 12, restaurantId: 4, amountMinor: 100, currency: 'PKR', successUrl: 'https://a', cancelUrl: 'https://b', account: null }), /Invalid checkout/);
  await assert.rejects(provider.createCheckout({ orderId: 12, restaurantId: 4, amountMinor: 100, currency: 'PKR', successUrl: 'http://a', cancelUrl: 'https://b', account: 'acct_1ABCdef' }), /Invalid checkout/);
});

test('webhook signatures are verified and events are normalised', () => {
  const provider = createStripeProvider(config);
  const event = { id: 'evt_1', type: 'checkout.session.completed', account: 'acct_1ABCdef', data: { object: { id: 'cs_test_1', mode: 'payment', payment_status: 'paid', payment_intent: 'pi_123456', amount_total: 150000, currency: 'pkr', metadata: { kind: 'order', order_id: '12', restaurant_id: '4' } } } };
  const body = JSON.stringify(event);
  assert.equal(provider.verifyWebhook(Buffer.from(body), { get: () => sign(body, 'wrong') }), null);
  assert.equal(provider.verifyWebhook(Buffer.from(body), { get: () => sign(body, 'whsec_test', 1000) }), null, 'stale timestamp');
  const verified = provider.verifyWebhook(Buffer.from(body), { get: () => sign(body) });
  assert.deepEqual(provider.handlePaymentEvent(verified), { provider: 'stripe', eventId: 'evt_1', account: 'acct_1ABCdef', type: 'paid', kind: 'order', restaurantId: 4, orderId: 12, sessionId: 'cs_test_1', paymentRef: 'pi_123456', amountMinor: 150000, currency: 'PKR', refundedMinor: 0 });
  assert.equal(provider.handlePaymentEvent({ ...event, data: { object: { ...event.data.object, mode: 'subscription' } } }), null, 'plan billing is not handled here');
  assert.equal(provider.handlePaymentEvent({ ...event, type: 'checkout.session.expired' }).type, 'expired');
  const refund = provider.handlePaymentEvent({ id: 'evt_2', type: 'charge.refunded', data: { object: { payment_intent: 'pi_123456', amount: 150000, amount_refunded: 50000, currency: 'pkr', metadata: { order_id: '12', restaurant_id: '4' } } } });
  assert.equal(refund.refundedMinor, 50000);
  assert.equal(fromStripeAmount(1500, 'JPY'), 150000, 'zero-decimal currencies are converted back to ×100');
});

test('refunds go to the restaurant account with a fixed idempotency key', async () => {
  const calls = [];
  const provider = createStripeProvider(config, { fetcher: async (url, options) => { calls.push({ url, options, params: new URLSearchParams(options.body) }); return { ok: true, json: async () => ({ id: 're_1', status: 'succeeded' }) }; } });
  assert.deepEqual(await provider.refund({ paymentRef: 'pi_123456', amountMinor: 50000, currency: 'PKR', account: 'acct_1ABCdef', idempotencyKey: 'k' }), { refundId: 're_1', status: 'succeeded' });
  assert.match(calls[0].url, /\/v1\/refunds$/);
  assert.equal(calls[0].options.headers['Stripe-Account'], 'acct_1ABCdef');
  assert.equal(calls[0].params.get('amount'), '50000');
  await assert.rejects(provider.refund({ paymentRef: 'ch_x', account: 'acct_1ABCdef' }), /Invalid refund/);
});

function quotaPool({ limits = null, tool = false, used = 0, fail = false }) {
  return { async execute(sql) {
    if (fail) throw Error('db down');
    if (sql.includes('FROM restaurant_subscriptions')) return [limits ? [{ limits: JSON.stringify(limits) }] : []];
    if (sql.includes('FROM restaurant_tools')) return [tool ? [{ 1: 1 }] : []];
    if (sql.includes('FROM usage_counters')) return [[{ used }]];
    throw Error('Unexpected SQL ' + sql);
  } };
}

test('usage limits: plan limit plus 10% grace in hard mode, never in soft mode, fail open', async () => {
  assert.deepEqual(limitPolicy({}), { mode: 'hard', gracePercent: 10 });
  const hard = {};
  assert.equal((await checkQuota(quotaPool({ limits: { whatsapp_messages: 1000 }, used: 1099 }), 1, 'whatsapp_messages', { env: hard })).allowed, true);
  const over = await checkQuota(quotaPool({ limits: { whatsapp_messages: 1000 }, used: 1100 }), 1, 'whatsapp_messages', { env: hard });
  assert.deepEqual([over.allowed, over.limit, over.stopAt], [false, 1000, 1100]);
  assert.equal((await checkQuota(quotaPool({ limits: { whatsapp_messages: 1000 }, used: 5000 }), 1, 'whatsapp_messages', { env: { USAGE_LIMIT_MODE: 'soft' } })).allowed, true);
  assert.equal((await checkQuota(quotaPool({ limits: { ai_chats: 10 }, used: 10 }), 1, 'ai_chats', { env: { USAGE_LIMIT_GRACE_PERCENT: '0' } })).allowed, false);
  // Single tool without a plan: the tool's own limit (WhatsApp tool = 1,000 replies).
  assert.equal((await checkQuota(quotaPool({ tool: true, used: 1100 }), 1, 'whatsapp_messages', { env: hard })).allowed, false);
  // Pilot / demo restaurants without plan or tool: no limit.
  assert.deepEqual(await checkQuota(quotaPool({ used: 99999 }), 1, 'whatsapp_messages', { env: hard }), { allowed: true, used: null, limit: null, stopAt: null });
  assert.equal((await checkQuota(quotaPool({ fail: true }), 1, 'ai_chats', { env: hard })).allowed, true);
});

test('limits are enforced at every AI entry point', () => {
  assert.match(readFileSync('src/integrations.js', 'utf8'), /withinLimit\(pool,Number\(mapped\[0\]\.restaurant_id\),'whatsapp_messages'\)/);
  assert.match(readFileSync('src/sites.js', 'utf8'), /withinLimit\(pool, Number\(site\.restaurant\.id\), 'ai_chats'\)/);
  assert.match(readFileSync('src/voice-tools.js', 'utf8'), /withinLimit\(pool,Number\(restaurantId\),'ai_call_minutes'\)/);
  assert.match(readFileSync('src/voice-bookings.js', 'utf8'), /withinLimit\(pool, Number\(business\.id\), 'ai_call_minutes'\)/);
});

test('the migration file creates the same tables the app creates on first use', () => {
  const sql = readFileSync('db/migrations/2026-11-26-payments.sql', 'utf8');
  for (const statement of PAYMENTS_SQL) assert.ok(sql.includes(statement));
});

test('payment webhook route rejects unknown providers and bad signatures before touching the database', async () => {
  const touched = [];
  const pool = { async execute(sql) { touched.push(sql); return [[]]; }, async query(sql) { touched.push(sql); return [[]]; } };
  const app = express();
  app.use(paymentsWebhookRouter(pool, { providerFor: name => name === 'stripe' ? createStripeProvider(config) : null }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const url = 'http://127.0.0.1:' + server.address().port + '/webhooks/payments/';
  try {
    assert.equal((await fetch(url + 'jazzcash', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 404);
    assert.equal((await fetch(url + 'stripe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': sign('{}', 'nope') }, body: '{}' })).status, 400);
    assert.equal(touched.length, 0);
  } finally { await new Promise(r => server.close(r)); }
});

// ---- Real database: order paid by verified webhook, replay-safe, refund, revenue ----
const enabled = process.env.DB_INTEGRATION_TEST === '1';
test('payments on MariaDB: online order → verified webhook → paid → refund → revenue', { skip: !enabled }, async () => {
  const pool = mysql.createPool({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectionLimit: 4 });
  const saved = { k: process.env.STRIPE_SECRET_KEY, w: process.env.STRIPE_CONNECT_WEBHOOK_SECRET };
  process.env.STRIPE_SECRET_KEY = 'sk_test_ci'; process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_test';
  const realFetch = globalThis.fetch;
  const stripeCalls = [];
  const run = String(process.pid) + Date.now();
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('https://api.stripe.com/')) {
      stripeCalls.push({ url: String(url), options });
      if (String(url).endsWith('/checkout/sessions')) return { ok: true, json: async () => ({ id: 'cs_test_ci' + run + '_' + stripeCalls.length, url: 'https://checkout.stripe.com/c/pay/cs_test_ci' }) };
      if (String(url).endsWith('/refunds')) return { ok: true, json: async () => ({ id: 're_ci', status: 'succeeded' }) };
    }
    return realFetch(url, options);
  };
  const tag = 'pay' + process.pid + Date.now();
  const account = 'acct_1CI' + tag;
  let restaurantId, server;
  try {
    const [r] = await pool.execute("INSERT INTO restaurants(name,slug,country_code,currency,locale) VALUES ('Pay Cafe',?,'PK','PKR','en')", [tag]);
    restaurantId = r.insertId;
    const [m] = await pool.execute("INSERT INTO menu_items(restaurant_id,name,price_minor) VALUES (?,'Biryani',50000)", [restaurantId]);
    await saveAccount(pool, restaurantId, { accountId: account, chargesEnabled: true, onlineEnabled: true });
    const { checkoutRouter } = await import('../src/checkout.js');
    const app = express();
    app.use(paymentsWebhookRouter(pool));
    app.use(express.json());
    app.use('/api', checkoutRouter(pool));
    server = app.listen(0, '127.0.0.1'); await new Promise(res => server.once('listening', res));
    const base = 'http://127.0.0.1:' + server.address().port;
    const order = await realFetch(base + '/api/public/restaurants/' + tag + '/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      customer_name: 'Ali', items: [{ menu_item_id: m.insertId, quantity: 3 }], order_type: 'pickup', payment_method: 'cash_pickup', payment_option: 'online', customer_phone: '+923001234567' }) });
    const receipt = await order.json();
    assert.equal(order.status, 201, JSON.stringify(receipt));
    assert.equal(receipt.payment_url, 'https://checkout.stripe.com/c/pay/cs_test_ci');
    assert.equal(new URLSearchParams(stripeCalls[0].options.body).get('line_items[0][price_data][unit_amount]'), '150000', 'amount from the database');
    const [[tx]] = await pool.execute('SELECT provider_ref,status,amount_minor FROM payment_transactions WHERE order_id=?', [receipt.order_id]);
    assert.deepEqual([tx.status, Number(tx.amount_minor)], ['pending', 150000]);
    const [[f]] = await pool.execute('SELECT payment_method,payment_status FROM order_fulfillment WHERE order_id=?', [receipt.order_id]);
    assert.deepEqual([f.payment_method, f.payment_status], ['stripe', 'pending']);

    const event = (id, amount = 150000) => ({ id, type: 'checkout.session.completed', account: account, data: { object: { id: tx.provider_ref, mode: 'payment', payment_status: 'paid', payment_intent: 'pi_ci123456', amount_total: amount, currency: 'pkr', metadata: { kind: 'order', order_id: String(receipt.order_id), restaurant_id: String(restaurantId) } } } });
    const deliver = async e => { const body = JSON.stringify(e); return (await realFetch(base + '/webhooks/payments/stripe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': sign(body) }, body })).json(); };
    assert.equal((await deliver(event('evt_ci_bad_' + tag, 100))).result, 'amount_mismatch', 'a tampered amount never marks the order paid');
    assert.equal((await deliver(event('evt_ci_' + tag))).result, 'paid');
    assert.equal((await deliver(event('evt_ci_' + tag))).result, 'duplicate', 'replays are harmless');
    const [[paid]] = await pool.execute('SELECT payment_status FROM order_fulfillment WHERE order_id=?', [receipt.order_id]);
    assert.equal(paid.payment_status, 'paid');

    const refunded = await refundOrder(pool, { restaurantId, orderId: receipt.order_id, amountMinor: 50000, provider: getProvider('stripe') });
    assert.deepEqual([refunded.status, refunded.body.status], [200, 'partially_refunded']);
    assert.equal((await refundOrder(pool, { restaurantId, orderId: receipt.order_id, amountMinor: 999999, provider: getProvider('stripe') })).status, 400);
    const full = await refundOrder(pool, { restaurantId, orderId: receipt.order_id, provider: getProvider('stripe') });
    assert.equal(full.body.status, 'refunded');
    assert.equal(new URLSearchParams(stripeCalls.at(-1).options.body).get('amount'), '100000');

    assert.equal(await recordInvoice(pool, { type: 'invoice.paid', data: { object: { id: 'in_ci_' + tag, amount_paid: 3900, currency: 'usd' } } }, { restaurantId, result: 'status_active' }), true);
    const report = await revenueReport(pool);
    assert.ok(report.monthly.some(row => row.kind === 'subscription' && row.currency === 'USD'));
    assert.ok(report.monthly.some(row => row.kind === 'order' && row.currency === 'PKR' && Number(row.refunded_minor) >= 150000));

    // Online payment switched off: the option is refused, cash keeps working.
    await saveAccount(pool, restaurantId, { accountId: account, onlineEnabled: false });
    const refused = await realFetch(base + '/api/public/restaurants/' + tag + '/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      customer_name: 'Ali', items: [{ menu_item_id: m.insertId, quantity: 1 }], order_type: 'pickup', payment_method: 'cash_pickup', payment_option: 'online', customer_phone: '+923001234567' }) });
    assert.equal(refused.status, 409);
    const cash = await realFetch(base + '/api/public/restaurants/' + tag + '/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      customer_name: 'Ali', items: [{ menu_item_id: m.insertId, quantity: 1 }], order_type: 'pickup', payment_method: 'cash_pickup', customer_phone: '+923001234567' }) });
    assert.equal(cash.status, 201);
  } finally {
    globalThis.fetch = realFetch;
    if (server) await new Promise(res => server.close(res));
    if (restaurantId) {
      await pool.execute('DELETE FROM orders WHERE restaurant_id=?', [restaurantId]).catch(() => {});
      await pool.execute('DELETE FROM restaurants WHERE id=?', [restaurantId]).catch(() => {});
    }
    if (saved.k === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = saved.k;
    if (saved.w === undefined) delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET; else process.env.STRIPE_CONNECT_WEBHOOK_SECRET = saved.w;
    await pool.end();
  }
});
