// Stripe billing for Mar-Khoor plans (Starter / Premium / Enterprise), monthly or yearly.
// No express import: testable with a mock pool and fetch.
//
// Flow: owner picks a plan → Stripe Checkout (subscription mode, price built from the server-side
// plan snapshot) → Stripe webhook (signature verified) activates the plan. A redirect alone never
// activates anything. Renewals, failed payments and cancellations arrive as webhooks too.
import crypto from 'node:crypto';
import { planCatalog } from './subscriptions.js';

export const BILLING_SQL = [
  `CREATE TABLE IF NOT EXISTS restaurant_billing (
 restaurant_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
 stripe_customer_id VARCHAR(64) NULL,
 stripe_subscription_id VARCHAR(64) NULL,
 stripe_status VARCHAR(32) NULL,
 current_period_end TIMESTAMP NULL,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uq_billing_subscription (stripe_subscription_id),
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS stripe_events (
 event_id VARCHAR(80) NOT NULL PRIMARY KEY,
 type VARCHAR(80) NOT NULL,
 restaurant_id BIGINT UNSIGNED NULL,
 result VARCHAR(40) NOT NULL,
 received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB`,
];

const ensured = new WeakMap();
export function ensureBillingTables(pool) {
  if (!ensured.has(pool)) ensured.set(pool, (async () => { for (const sql of BILLING_SQL) await pool.query(sql); })()
    .catch(error => { ensured.delete(pool); throw error; }));
  return ensured.get(pool);
}

export function billingConfig(env = process.env) {
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET || env.STRIPE_BILLING_ENABLED === '0') return null;
  if (!/^(sk|rk)_(live|test)_/.test(env.STRIPE_SECRET_KEY)) return null;
  return { secretKey: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET, live: /_live_/.test(env.STRIPE_SECRET_KEY) };
}

// Stripe amounts are in the currency's smallest unit. Our prices are always stored with two
// decimals, so zero-decimal currencies are divided by 100 (and must be whole units).
const ZERO_DECIMAL = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
export function stripeAmount(minor, currency) {
  if (!Number.isSafeInteger(minor) || minor < 1 || !/^[A-Z]{3}$/.test(currency)) return null;
  if (!ZERO_DECIMAL.has(currency)) return minor;
  return Math.round(minor / 100) || null;
}

export function verifyStripeSignature(rawBody, header, secret, now = Date.now()) {
  if (!Buffer.isBuffer(rawBody) || typeof header !== 'string' || !secret) return null;
  const timestamp = header.match(/(?:^|,)t=(\d+)/)?.[1];
  const signatures = [...header.matchAll(/(?:^|,)v1=([a-f0-9]{64})/g)].map(match => match[1]);
  if (!timestamp || !signatures.length || Math.abs(now / 1000 - Number(timestamp)) > 300) return null;
  const digest = crypto.createHmac('sha256', secret).update(timestamp + '.').update(rawBody).digest('hex');
  if (!signatures.some(sig => crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(digest, 'hex')))) return null;
  try { return JSON.parse(rawBody.toString('utf8')); } catch { return null; }
}

export function createStripeClient(config, { fetcher = fetch } = {}) {
  if (!config) return null;
  async function call(method, path, params = null, idempotencyKey = null) {
    const headers = { Authorization: 'Bearer ' + config.secretKey, 'Stripe-Version': '2024-06-20' };
    if (params) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const response = await fetcher('https://api.stripe.com/v1/' + path, { method, headers, body: params ? new URLSearchParams(params).toString() : undefined, signal: AbortSignal.timeout(20000) });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(data?.error?.message || 'Payment provider unavailable');
      error.status = response.status; error.code = data?.error?.code;
      throw error;
    }
    return data;
  }
  return {
    config,
    checkout: (params, key) => call('POST', 'checkout/sessions', params, key),
    portal: params => call('POST', 'billing_portal/sessions', params),
    subscription: id => call('GET', 'subscriptions/' + encodeURIComponent(id)),
    cancel: id => call('DELETE', 'subscriptions/' + encodeURIComponent(id) + '?invoice_now=true&prorate=true'),
  };
}

/** Checkout parameters for a plan, built only from server data. */
export function checkoutParams({ restaurant, subscription, plan, email, customerId, baseUrl }) {
  const amount = stripeAmount(subscription.price_minor, subscription.currency);
  if (!amount) return null;
  const meta = {
    restaurant_id: String(restaurant.id), plan: subscription.plan, cycle: subscription.billing_cycle,
    price_minor: String(subscription.price_minor), currency: subscription.currency,
  };
  const params = {
    mode: 'subscription',
    success_url: baseUrl + '/restaurant.html?billing=success#plan',
    cancel_url: baseUrl + '/restaurant.html?billing=cancelled#plan',
    client_reference_id: 'restaurant-' + restaurant.id,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': subscription.currency.toLowerCase(),
    'line_items[0][price_data][unit_amount]': String(amount),
    'line_items[0][price_data][recurring][interval]': subscription.billing_cycle === 'yearly' ? 'year' : 'month',
    'line_items[0][price_data][product_data][name]': 'Mar-Khoor ' + plan.name + ' plan (' + subscription.billing_cycle + ')',
    'line_items[0][price_data][product_data][description]': restaurant.name.slice(0, 200),
    allow_promotion_codes: 'true',
  };
  for (const [key, value] of Object.entries(meta)) {
    params['metadata[' + key + ']'] = value;
    params['subscription_data[metadata][' + key + ']'] = value;
  }
  if (customerId) params.customer = customerId;
  else if (email) params.customer_email = email;
  return params;
}

const STATUS = { active: 'active', trialing: 'active', past_due: 'past_due', unpaid: 'past_due', canceled: 'cancelled', incomplete_expired: 'cancelled' };
const toDate = seconds => Number.isSafeInteger(seconds) && seconds > 0 ? new Date(seconds * 1000) : null;

/**
 * Applies a verified Stripe event. Returns { result, restaurantId, activated }.
 * Duplicate deliveries are recorded once (stripe_events) and ignored afterwards.
 */
export async function applyBillingEvent(pool, event, { stripe = null } = {}) {
  if (!event?.id || typeof event.type !== 'string') return { result: 'rejected' };
  await ensureBillingTables(pool);
  const object = event.data?.object ?? {};
  let outcome = { result: 'ignored', restaurantId: null, activated: false };

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    if (object.mode !== 'subscription') return record(pool, event, outcome);
    const meta = object.metadata ?? {};
    const restaurantId = Number(meta.restaurant_id);
    outcome.restaurantId = Number.isSafeInteger(restaurantId) && restaurantId > 0 ? restaurantId : null;
    if (!outcome.restaurantId) return record(pool, event, { ...outcome, result: 'rejected' });
    const price = Number(meta.price_minor);
    const currency = String(meta.currency || '');
    // Never trust metadata alone: the paid amount and currency must be what we asked for.
    const expected = stripeAmount(price, currency);
    if (!expected || object.amount_total !== expected || String(object.currency).toUpperCase() !== currency)
      return record(pool, event, { ...outcome, result: 'amount_mismatch' });
    if (object.payment_status !== 'paid' && object.payment_status !== 'no_payment_required')
      return record(pool, event, { ...outcome, result: 'not_paid' });
    const plan = planCatalog(currency).find(entry => entry.key === meta.plan);
    if (!plan || !['monthly', 'yearly'].includes(meta.cycle)) return record(pool, event, { ...outcome, result: 'rejected' });
    if (await seen(pool, event.id)) return { ...outcome, result: 'duplicate' };

    const [before] = await pool.execute('SELECT stripe_subscription_id FROM restaurant_billing WHERE restaurant_id=? LIMIT 1', [outcome.restaurantId]);
    const previous = before[0]?.stripe_subscription_id;
    await pool.execute(
      'INSERT INTO restaurant_billing(restaurant_id,stripe_customer_id,stripe_subscription_id,stripe_status) VALUES (?,?,?,\'active\') '
      + 'ON DUPLICATE KEY UPDATE stripe_customer_id=VALUES(stripe_customer_id),stripe_subscription_id=VALUES(stripe_subscription_id),stripe_status=\'active\'',
      [outcome.restaurantId, object.customer || null, object.subscription || null]);
    const [current] = await pool.execute('SELECT status FROM restaurant_subscriptions WHERE restaurant_id=? LIMIT 1', [outcome.restaurantId]);
    await pool.execute(
      "INSERT INTO restaurant_subscriptions(restaurant_id,plan_key,billing_cycle,status,limits,currency,price_minor) VALUES (?,?,?,'active',?,?,?) "
      + "ON DUPLICATE KEY UPDATE plan_key=VALUES(plan_key),billing_cycle=VALUES(billing_cycle),status='active',limits=VALUES(limits),currency=VALUES(currency),price_minor=VALUES(price_minor)",
      [outcome.restaurantId, plan.key, meta.cycle, JSON.stringify(plan.limits), currency, price]);
    // A plan change creates a new Stripe subscription; end the old one (unused time is credited).
    if (previous && previous !== object.subscription && stripe) await stripe.cancel(previous).catch(() => {});
    outcome = { ...outcome, result: 'activated', activated: current[0]?.status !== 'active' || Boolean(previous && previous !== object.subscription) };
    return record(pool, event, outcome, true);
  }

  const subscriptionId = event.type.startsWith('invoice.') ? object.subscription ?? object.parent?.subscription_details?.subscription : object.id;
  if (!['invoice.paid', 'invoice.payment_failed', 'customer.subscription.updated', 'customer.subscription.deleted'].includes(event.type) || typeof subscriptionId !== 'string')
    return record(pool, event, outcome);
  if (await seen(pool, event.id)) return { ...outcome, result: 'duplicate' };
  const [rows] = await pool.execute('SELECT restaurant_id FROM restaurant_billing WHERE stripe_subscription_id=? LIMIT 1', [subscriptionId]);
  if (!rows.length) return record(pool, event, { ...outcome, result: 'unknown_subscription' }, true);
  outcome.restaurantId = Number(rows[0].restaurant_id);

  let stripeStatus = null, periodEnd = null;
  if (event.type === 'invoice.paid') stripeStatus = 'active';
  if (event.type === 'invoice.payment_failed') stripeStatus = 'past_due';
  if (event.type === 'customer.subscription.deleted') stripeStatus = 'canceled';
  if (event.type === 'customer.subscription.updated') stripeStatus = object.status;
  periodEnd = toDate(object.current_period_end ?? object.items?.data?.[0]?.current_period_end ?? object.lines?.data?.[0]?.period?.end);
  const ours = STATUS[stripeStatus];
  await pool.execute('UPDATE restaurant_billing SET stripe_status=?,current_period_end=COALESCE(?,current_period_end) WHERE restaurant_id=? AND stripe_subscription_id=?',
    [String(stripeStatus || '').slice(0, 32) || null, periodEnd, outcome.restaurantId, subscriptionId]);
  if (ours) {
    await pool.execute('UPDATE restaurant_subscriptions SET status=? WHERE restaurant_id=? AND status<>?', [ours, outcome.restaurantId, ours]);
    outcome.result = 'status_' + ours;
  } else outcome.result = 'recorded';
  return record(pool, event, outcome, true);
}

async function seen(pool, eventId) {
  const [rows] = await pool.execute('SELECT event_id FROM stripe_events WHERE event_id=? LIMIT 1', [eventId]);
  return rows.length > 0;
}
async function record(pool, event, outcome, important = false) {
  if (important || outcome.result !== 'ignored') {
    await pool.execute('INSERT IGNORE INTO stripe_events(event_id,type,restaurant_id,result) VALUES (?,?,?,?)',
      [String(event.id).slice(0, 80), event.type.slice(0, 80), outcome.restaurantId, outcome.result.slice(0, 40)]);
  }
  return outcome;
}
