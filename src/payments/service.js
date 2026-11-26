// Payments service: provider-agnostic database side of online payments.
// - restaurant_payment_accounts: a restaurant's own account at a provider (Stripe connected account),
//   and whether online payment is offered to its customers (off by default; cash stays the default).
// - payment_transactions: every online payment (customer orders) and every plan/tool invoice, for
//   refunds and the super-admin revenue report.
// - payment_events: provider event ids already applied (webhook replays are harmless).
// Additive tables only (db/migrations/2026-11-26-payments.sql); also created on first use.
import { registerProvider, getProvider } from './provider.js';
import { createStripeProvider, stripePaymentsConfig, fromStripeAmount } from './stripe-provider.js';

registerProvider('stripe', env => createStripeProvider(stripePaymentsConfig(env)));
// registerProvider('jazzcash', env => createJazzCashProvider(...));   // future adapters
// registerProvider('easypaisa', env => createEasypaisaProvider(...));

export const PAYMENTS_SQL = [
  `CREATE TABLE IF NOT EXISTS restaurant_payment_accounts (
 restaurant_id BIGINT UNSIGNED NOT NULL,
 provider VARCHAR(20) NOT NULL,
 account_id VARCHAR(80) NOT NULL,
 charges_enabled TINYINT(1) NOT NULL DEFAULT 0,
 online_enabled TINYINT(1) NOT NULL DEFAULT 0,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 PRIMARY KEY (restaurant_id, provider),
 UNIQUE KEY uq_payment_account (provider, account_id),
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS payment_transactions (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 provider VARCHAR(20) NOT NULL,
 kind VARCHAR(20) NOT NULL,
 restaurant_id BIGINT UNSIGNED NULL,
 order_id BIGINT UNSIGNED NULL,
 provider_ref VARCHAR(120) NOT NULL,
 payment_ref VARCHAR(120) NULL,
 account_id VARCHAR(80) NULL,
 amount_minor BIGINT UNSIGNED NOT NULL,
 currency CHAR(3) NOT NULL,
 fee_minor BIGINT UNSIGNED NOT NULL DEFAULT 0,
 refunded_minor BIGINT UNSIGNED NOT NULL DEFAULT 0,
 status VARCHAR(20) NOT NULL DEFAULT 'pending',
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uq_payment_ref (provider, provider_ref),
 INDEX (restaurant_id, order_id),
 INDEX (kind, status, created_at),
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE SET NULL
) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS payment_events (
 provider VARCHAR(20) NOT NULL,
 event_id VARCHAR(80) NOT NULL,
 type VARCHAR(40) NOT NULL,
 result VARCHAR(40) NOT NULL,
 received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (provider, event_id)
) ENGINE=InnoDB`,
];

const ready = new WeakMap();
export function ensurePaymentsTables(pool) {
  if (typeof pool?.query !== 'function') return Promise.resolve();
  if (!ready.has(pool)) ready.set(pool, (async () => { for (const sql of PAYMENTS_SQL) await pool.query(sql); })().catch(error => { ready.delete(pool); throw error; }));
  return ready.get(pool);
}

export const DEFAULT_PROVIDER = 'stripe';
export const orderProvider = (env = process.env) => getProvider(DEFAULT_PROVIDER, env);

/** The restaurant's account at a provider, or null. Never throws. */
export async function paymentAccount(pool, restaurantId, provider = DEFAULT_PROVIDER) {
  try {
    await ensurePaymentsTables(pool);
    const [rows] = await pool.execute('SELECT account_id,charges_enabled,online_enabled FROM restaurant_payment_accounts WHERE restaurant_id=? AND provider=? LIMIT 1', [restaurantId, provider]);
    if (!rows.length) return null;
    return { accountId: rows[0].account_id, chargesEnabled: Number(rows[0].charges_enabled) === 1, onlineEnabled: Number(rows[0].online_enabled) === 1 };
  } catch { return null; }
}

/** True when customers of this restaurant may pay online right now. */
export async function onlinePaymentsAvailable(pool, restaurantId, env = process.env) {
  if (!orderProvider(env)) return false;
  const account = await paymentAccount(pool, restaurantId);
  return Boolean(account?.chargesEnabled && account.onlineEnabled);
}

export async function saveAccount(pool, restaurantId, { accountId, chargesEnabled = null, onlineEnabled = null }, provider = DEFAULT_PROVIDER) {
  await ensurePaymentsTables(pool);
  // One provider account belongs to one restaurant: never let an upsert touch another restaurant's row.
  const [owners] = await pool.execute('SELECT restaurant_id FROM restaurant_payment_accounts WHERE provider=? AND account_id=? LIMIT 1', [provider, accountId]);
  if (owners.length && Number(owners[0].restaurant_id) !== Number(restaurantId)) throw Object.assign(new Error('This payment account is linked to another restaurant'), { code: 'ACCOUNT_IN_USE' });
  await pool.execute(
    'INSERT INTO restaurant_payment_accounts(restaurant_id,provider,account_id,charges_enabled,online_enabled) VALUES (?,?,?,?,?) '
    + 'ON DUPLICATE KEY UPDATE account_id=VALUES(account_id),charges_enabled=COALESCE(?,charges_enabled),online_enabled=COALESCE(?,online_enabled)',
    [restaurantId, provider, accountId, chargesEnabled ? 1 : 0, onlineEnabled ? 1 : 0, chargesEnabled === null ? null : chargesEnabled ? 1 : 0, onlineEnabled === null ? null : onlineEnabled ? 1 : 0]);
}

/**
 * Starts online payment for an order that was just created. Amount and currency come from the
 * database, never from the customer. Returns { url } or { error }.
 */
export async function startOrderCheckout(pool, { restaurantId, orderId, trackingToken, baseUrl, provider = orderProvider() }) {
  if (!provider) return { error: 'Online payment is not configured' };
  const account = await paymentAccount(pool, restaurantId, provider.name);
  if (!account?.chargesEnabled || !account.onlineEnabled) return { error: 'This restaurant does not take online payment' };
  const [rows] = await pool.execute('SELECT o.total_minor,r.currency,r.name,r.slug FROM orders o JOIN restaurants r ON r.id=o.restaurant_id WHERE o.id=? AND o.restaurant_id=? LIMIT 1', [orderId, restaurantId]);
  if (!rows.length) return { error: 'Order not found' };
  const order = rows[0];
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const track = base + '/track.html?order=' + orderId + (trackingToken ? '&token=' + encodeURIComponent(trackingToken) : '');
  const session = await provider.createCheckout({
    kind: 'order', orderId, restaurantId, amountMinor: Number(order.total_minor), currency: String(order.currency).toUpperCase(),
    description: order.name + ' · Order #' + orderId, successUrl: track + '&paid=1', cancelUrl: base + '/menu.html?r=' + encodeURIComponent(order.slug) + '&payment=cancelled',
    account: account.accountId, idempotencyKey: 'mk-order-' + restaurantId + '-' + orderId,
  });
  await pool.execute('INSERT INTO payment_transactions(provider,kind,restaurant_id,order_id,provider_ref,account_id,amount_minor,currency,fee_minor,status) VALUES (?,?,?,?,?,?,?,?,?,\'pending\') ON DUPLICATE KEY UPDATE status=status',
    [provider.name, 'order', restaurantId, orderId, session.sessionId, account.accountId, Number(order.total_minor), String(order.currency).toUpperCase(), Number(session.feeMinor) || 0]);
  // Existing COD/Stripe column on order_fulfillment (payment_method 'stripe') stays in sync for staff screens.
  await pool.execute("UPDATE order_fulfillment SET stripe_checkout_session_id=? WHERE order_id=? AND restaurant_id=? AND payment_method='stripe'", [session.sessionId, orderId, restaurantId]).catch(() => {});
  return { url: session.url, sessionId: session.sessionId };
}

async function firstTime(pool, provider, event) {
  const [result] = await pool.execute('INSERT IGNORE INTO payment_events(provider,event_id,type,result) VALUES (?,?,?,?)', [provider, event.eventId, event.type, 'received']);
  return result.affectedRows === 1;
}
const setResult = (pool, provider, eventId, result) => pool.execute('UPDATE payment_events SET result=? WHERE provider=? AND event_id=?', [String(result).slice(0, 40), provider, eventId]);

/**
 * Applies a normalised payment event (provider.handlePaymentEvent output) to the database.
 * The order is marked paid only when the restaurant, account, session, amount and currency all match
 * what we created. Returns { result }.
 */
export async function applyPaymentEvent(pool, event) {
  if (!event || !event.eventId || !['paid', 'failed', 'expired', 'refunded'].includes(event.type)) return { result: 'ignored' };
  if (!Number.isSafeInteger(event.restaurantId) || event.restaurantId < 1 || !Number.isSafeInteger(event.orderId) || event.orderId < 1) return { result: 'rejected' };
  await ensurePaymentsTables(pool);
  if (!await firstTime(pool, event.provider, event)) return { result: 'duplicate' };
  const where = event.type === 'refunded' ? ['payment_ref=?', event.paymentRef] : ['provider_ref=?', event.sessionId];
  const [rows] = await pool.execute('SELECT id,amount_minor,currency,account_id,status,refunded_minor FROM payment_transactions WHERE provider=? AND kind=\'order\' AND restaurant_id=? AND order_id=? AND ' + where[0] + ' LIMIT 1',
    [event.provider, event.restaurantId, event.orderId, where[1]]);
  const tx = rows[0];
  let result;
  if (!tx) result = 'unknown_payment';
  else if (event.account && tx.account_id && event.account !== tx.account_id) result = 'account_mismatch';
  else if (event.type === 'paid') {
    if (Number(event.amountMinor) !== Number(tx.amount_minor) || event.currency !== tx.currency) result = 'amount_mismatch';
    else {
      await pool.execute("UPDATE payment_transactions SET status='paid',payment_ref=COALESCE(?,payment_ref) WHERE id=? AND status IN ('pending','failed','expired')", [event.paymentRef, tx.id]);
      await pool.execute("UPDATE order_fulfillment SET payment_status='paid' WHERE order_id=? AND restaurant_id=? AND payment_status IN ('unpaid','pending','failed')", [event.orderId, event.restaurantId]).catch(() => {});
      result = 'paid';
    }
  } else if (event.type === 'refunded') {
    const refunded = Math.min(Number(event.refundedMinor) || 0, Number(tx.amount_minor));
    const status = refunded >= Number(tx.amount_minor) ? 'refunded' : 'partially_refunded';
    await pool.execute('UPDATE payment_transactions SET refunded_minor=GREATEST(refunded_minor,?),status=? WHERE id=?', [refunded, status, tx.id]);
    if (status === 'refunded') await pool.execute("UPDATE order_fulfillment SET payment_status='refunded' WHERE order_id=? AND restaurant_id=?", [event.orderId, event.restaurantId]).catch(() => {});
    result = status;
  } else {
    await pool.execute("UPDATE payment_transactions SET status=? WHERE id=? AND status='pending'", [event.type, tx.id]);
    // The customer did not pay online: the order stays, payable in cash like any other.
    await pool.execute("UPDATE order_fulfillment SET payment_status='failed' WHERE order_id=? AND restaurant_id=? AND payment_status IN ('unpaid','pending')", [event.orderId, event.restaurantId]).catch(() => {});
    result = event.type;
  }
  await setResult(pool, event.provider, event.eventId, result);
  return { result };
}

/** Owner-initiated refund of an online order payment (full when amountMinor is null). */
export async function refundOrder(pool, { restaurantId, orderId, amountMinor = null, provider = orderProvider() }) {
  if (!provider) return { status: 503, body: { error: 'Online payment is not configured' } };
  await ensurePaymentsTables(pool);
  const [rows] = await pool.execute("SELECT id,payment_ref,account_id,amount_minor,refunded_minor,currency,status FROM payment_transactions WHERE provider=? AND kind='order' AND restaurant_id=? AND order_id=? AND status IN ('paid','partially_refunded') ORDER BY id DESC LIMIT 1",
    [provider.name, restaurantId, orderId]);
  const tx = rows[0];
  if (!tx || !tx.payment_ref) return { status: 409, body: { error: 'This order has no online payment to refund' } };
  const left = Number(tx.amount_minor) - Number(tx.refunded_minor);
  const amount = amountMinor === null ? left : amountMinor;
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > left) return { status: 400, body: { error: 'Refund amount must be between 1 and the amount still paid' } };
  const refund = await provider.refund({ paymentRef: tx.payment_ref, amountMinor: amount, currency: tx.currency, account: tx.account_id, idempotencyKey: 'mk-refund-' + tx.id + '-' + (Number(tx.refunded_minor) + amount) });
  const total = Number(tx.refunded_minor) + amount;
  const status = total >= Number(tx.amount_minor) ? 'refunded' : 'partially_refunded';
  await pool.execute('UPDATE payment_transactions SET refunded_minor=?,status=? WHERE id=?', [total, status, tx.id]);
  if (status === 'refunded') await pool.execute("UPDATE order_fulfillment SET payment_status='refunded' WHERE order_id=? AND restaurant_id=?", [orderId, restaurantId]).catch(() => {});
  return { status: 200, body: { refunded_minor: amount, total_refunded_minor: total, status, refund_id: refund.refundId } };
}

/** Records a paid plan / tool invoice from the platform Stripe webhook, for the revenue report. Never throws. */
export async function recordInvoice(pool, event, outcome) {
  try {
    if (event?.type !== 'invoice.paid') return false;
    const invoice = event.data?.object ?? {};
    const currency = String(invoice.currency || '').toUpperCase();
    const amount = fromStripeAmount(invoice.amount_paid, currency);
    if (!/^in_/.test(invoice.id || '') || !/^[A-Z]{3}$/.test(currency) || !amount) return false;
    await ensurePaymentsTables(pool);
    const kind = String(outcome?.result || '').startsWith('tools_') ? 'tool' : 'subscription';
    await pool.execute("INSERT IGNORE INTO payment_transactions(provider,kind,restaurant_id,provider_ref,payment_ref,amount_minor,currency,status) VALUES ('stripe',?,?,?,?,?,?,'paid')",
      [kind, outcome?.restaurantId || null, invoice.id, typeof invoice.payment_intent === 'string' ? invoice.payment_intent : null, amount, currency]);
    return true;
  } catch { return false; }
}

/**
 * Super-admin revenue report: monthly recurring revenue from active plans and tools, invoices paid
 * per month, and customer order payments processed (money of the restaurants, not Mar-Khoor's).
 * Amounts are per currency; nothing is converted.
 */
export async function revenueReport(pool, { months = 12 } = {}) {
  await ensurePaymentsTables(pool);
  const span = Math.min(Math.max(Number(months) || 12, 1), 36);
  const [plans] = await pool.query("SELECT plan_key,billing_cycle,currency,COUNT(*) AS subscriptions,SUM(CASE WHEN billing_cycle='yearly' THEN price_minor/12 ELSE price_minor END) AS mrr_minor FROM restaurant_subscriptions WHERE status='active' AND price_minor IS NOT NULL GROUP BY plan_key,billing_cycle,currency");
  let tools = [];
  try { [tools] = await pool.query("SELECT tool_key,billing_cycle,currency,COUNT(*) AS subscriptions,SUM(CASE WHEN billing_cycle='yearly' THEN price_minor/12 ELSE price_minor END) AS mrr_minor FROM restaurant_tools WHERE status='active' GROUP BY tool_key,billing_cycle,currency"); } catch { tools = []; }
  const [statuses] = await pool.query('SELECT status,COUNT(*) AS count FROM restaurant_subscriptions GROUP BY status');
  const [monthly] = await pool.query("SELECT DATE_FORMAT(created_at,'%Y-%m') AS month,kind,currency,COUNT(*) AS payments,SUM(amount_minor) AS amount_minor,SUM(refunded_minor) AS refunded_minor,SUM(fee_minor) AS fee_minor FROM payment_transactions WHERE status IN ('paid','refunded','partially_refunded') AND created_at>=DATE_FORMAT(NOW()-INTERVAL ? MONTH,'%Y-%m-01') GROUP BY month,kind,currency ORDER BY month DESC,kind", [span - 1]);
  const num = rows => rows.map(row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'string' && /_minor$|^subscriptions$|^payments$|^count$/.test(k) ? Math.round(Number(v)) : typeof v === 'bigint' ? Number(v) : v])));
  const mrr = {};
  for (const row of [...plans, ...tools]) mrr[row.currency] = (mrr[row.currency] || 0) + Math.round(Number(row.mrr_minor) || 0);
  return { mrr_minor_by_currency: mrr, plans: num(plans), tools: num(tools), subscription_statuses: num(statuses), monthly: num(monthly) };
}
