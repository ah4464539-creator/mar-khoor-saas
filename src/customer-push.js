// Notifications for customers: "Your order #12 is ready", even when the app or browser is closed.
// A customer turns them on from the order tracking page. The subscription is tied to that one
// order, proven by the order's tracking token, so no account is needed. Separate table from the
// owners' devices, so a customer never receives a business's alerts. Additive table only.
import crypto from 'node:crypto';
import { vapidKeys, validSubscription, encryptPayload, vapidHeader } from './web-push.js';
import { hashTrackingToken } from './order-tracking.js';

export const CUSTOMER_PUSH_SQL = `CREATE TABLE IF NOT EXISTS customer_push_subscriptions (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 restaurant_id BIGINT UNSIGNED NOT NULL,
 kind VARCHAR(10) NOT NULL,
 ref_id BIGINT UNSIGNED NOT NULL,
 endpoint VARCHAR(700) NOT NULL,
 endpoint_hash CHAR(64) NOT NULL,
 p256dh VARCHAR(200) NOT NULL,
 auth VARCHAR(64) NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_customer_push (kind, ref_id, endpoint_hash),
 KEY ix_customer_push_restaurant (restaurant_id),
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB`;

const ready = new WeakMap();
export function ensureCustomerPushTable(pool) {
  if (typeof pool?.query !== 'function') return Promise.resolve();
  if (!ready.has(pool)) ready.set(pool, Promise.resolve().then(() => pool.query(CUSTOMER_PUSH_SQL)).catch(error => { ready.delete(pool); throw error; }));
  return ready.get(pool);
}

const TOKEN = /^[a-f0-9]{48}$/;
const MAX_DEVICES = 5;

/** Turns on notifications for one order. The tracking token proves the caller placed it. */
export async function subscribeOrder(pool, orderId, token, input) {
  if (!Number.isSafeInteger(orderId) || orderId < 1 || typeof token !== 'string' || !TOKEN.test(token)) return { status: 404, body: { error: 'Order not found' } };
  const sub = validSubscription(input);
  if (!sub) return { status: 400, body: { error: 'This browser did not give a valid notification subscription' } };
  const [rows] = await pool.execute('SELECT o.restaurant_id FROM orders o JOIN order_tracking t ON t.order_id=o.id WHERE o.id=? AND t.token_hash=? LIMIT 1', [orderId, hashTrackingToken(token)]);
  if (!rows.length) return { status: 404, body: { error: 'Order not found' } };
  await ensureCustomerPushTable(pool);
  const [[count]] = await pool.execute("SELECT COUNT(*) AS n FROM customer_push_subscriptions WHERE kind='order' AND ref_id=?", [orderId]);
  const hash = crypto.createHash('sha256').update(sub.endpoint).digest('hex');
  if (Number(count?.n || 0) >= MAX_DEVICES) {
    const [[same]] = await pool.execute("SELECT COUNT(*) AS n FROM customer_push_subscriptions WHERE kind='order' AND ref_id=? AND endpoint_hash=?", [orderId, hash]);
    if (!Number(same?.n)) return { status: 409, body: { error: 'Notifications are already on for this order on other phones' } };
  }
  await pool.execute("INSERT INTO customer_push_subscriptions(restaurant_id,kind,ref_id,endpoint,endpoint_hash,p256dh,auth) VALUES (?,'order',?,?,?,?,?) "
    + 'ON DUPLICATE KEY UPDATE p256dh=VALUES(p256dh),auth=VALUES(auth)', [rows[0].restaurant_id, orderId, sub.endpoint, hash, sub.p256dh, sub.auth]);
  return { status: 200, body: { subscribed: true } };
}

const ORDER_TEXT = {
  accepted: ['✅ Order #{id} accepted', '{biz} has accepted your order.'],
  preparing: ['👩‍🍳 Order #{id} is being prepared', '{biz} is preparing your order.'],
  ready: ['🛍️ Order #{id} is ready', 'Your order from {biz} is ready.'],
  completed: ['🎉 Order #{id} completed', 'Thank you for ordering from {biz}.'],
  cancelled: ['❌ Order #{id} was cancelled', '{biz} cancelled your order. Open the app for details.'],
};
export function orderStatusMessage(orderId, status, businessName) {
  const text = ORDER_TEXT[status];
  if (!text) return null;
  const fill = s => s.replace('{id}', String(orderId)).replace('{biz}', String(businessName || 'The business').slice(0, 60));
  // The link opens "My orders" on the customer's own phone, where the tracking link is kept.
  return { title: fill(text[0]), body: fill(text[1]), url: '/orders.html', tag: 'mk-order-' + orderId };
}

/** Sends to every device subscribed to one order or booking. Removes dead subscriptions. Never throws. */
export async function pushToCustomer(pool, kind, refId, message, { fetcher = fetch, env = process.env, log = console } = {}) {
  try {
    await ensureCustomerPushTable(pool);
    const [subs] = await pool.execute('SELECT id,endpoint,p256dh,auth FROM customer_push_subscriptions WHERE kind=? AND ref_id=? ORDER BY id DESC LIMIT ' + MAX_DEVICES, [kind, refId]);
    if (!subs.length) return { sent: 0 };
    const keys = await vapidKeys(pool, env);
    const payload = JSON.stringify({ title: String(message.title).slice(0, 80), body: String(message.body || '').slice(0, 200), url: String(message.url || '/orders.html').slice(0, 200), tag: String(message.tag || 'mk-customer').slice(0, 60) });
    let sent = 0;
    await Promise.all(subs.map(async sub => {
      try {
        if (!validSubscription({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } })) return;
        const r = await fetcher(sub.endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), body: encryptPayload(payload, sub),
          headers: { TTL: '3600', Urgency: 'high', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', Authorization: vapidHeader(sub.endpoint, keys) } });
        if (r.status === 404 || r.status === 410) await pool.execute('DELETE FROM customer_push_subscriptions WHERE id=?', [sub.id]);
        else if (r.ok) sent++;
        else log.warn?.('Customer push failed (' + r.status + ') for ' + kind + ' #' + refId);
      } catch (error) { log.warn?.('Customer push error for ' + kind + ' #' + refId + ': ' + String(error.message).slice(0, 120)); }
    }));
    return { sent };
  } catch (error) { log.warn?.('Customer push unavailable: ' + String(error.message).slice(0, 120)); return { sent: 0 }; }
}

/** After an owner changes an order's status. Fire and forget. */
export async function notifyCustomerOrderStatus(pool, restaurantId, orderId, status, options) {
  try {
    const [[r]] = await pool.execute('SELECT name FROM restaurants WHERE id=? LIMIT 1', [restaurantId]);
    const message = orderStatusMessage(orderId, status, r?.name);
    if (!message) return { sent: 0 };
    return await pushToCustomer(pool, 'order', orderId, message, options);
  } catch { return { sent: 0 }; }
}
