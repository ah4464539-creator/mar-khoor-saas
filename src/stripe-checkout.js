// Stripe integration is prepared but intentionally disabled until an account is connected.
// Never mark an order paid from a redirect alone; require a verified webhook.
import crypto from 'node:crypto';

export function stripeReady(env = process.env) {
  return env.STRIPE_CHECKOUT_ENABLED === '1' &&
    Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);
}

export async function createStripeCheckout({orderId, restaurantId, currency, totalMinor, successUrl, cancelUrl}, env = process.env, fetchImpl = fetch) {
  if (!stripeReady(env)) throw new Error('Stripe checkout is not configured');
  if (!Number.isSafeInteger(orderId) || orderId < 1 || !Number.isSafeInteger(restaurantId) || restaurantId < 1 || !Number.isSafeInteger(totalMinor) || totalMinor < 1 ||
      !/^[a-z]{3}$/.test(currency) || !/^https:\/\//.test(successUrl) || !/^https:\/\//.test(cancelUrl))
    throw new Error('Invalid checkout details');
  const params = new URLSearchParams({
    mode:'payment',success_url:successUrl,cancel_url:cancelUrl,
    'line_items[0][price_data][currency]':currency,
    'line_items[0][price_data][unit_amount]':String(totalMinor),
    'line_items[0][price_data][product_data][name]':'Restaurant order #'+orderId,
    'line_items[0][quantity]':'1',
    'metadata[order_id]':String(orderId),
    'metadata[restaurant_id]':String(restaurantId),
    client_reference_id:restaurantId+'-'+orderId,
  });
  const response = await fetchImpl('https://api.stripe.com/v1/checkout/sessions',{
    method:'POST',headers:{Authorization:'Bearer '+env.STRIPE_SECRET_KEY,
      'Content-Type':'application/x-www-form-urlencoded',
      'Idempotency-Key':'restaurant-'+restaurantId+'-order-'+orderId},body:params.toString(),
  });
  if (!response.ok) throw new Error('Payment provider unavailable');
  const data = await response.json();
  if (!/^https:\/\//.test(data?.url || '') || !/^cs_/.test(data?.id || ''))
    throw new Error('Invalid payment session');
  return {sessionId:data.id,url:data.url};
}

export function verifyStripeWebhook(rawBody, signatureHeader, env = process.env, now = Date.now()) {
  if (!stripeReady(env) || !Buffer.isBuffer(rawBody) || typeof signatureHeader !== 'string') return null;
  const timestamp = signatureHeader.match(/(?:^|,)t=(\d+)/)?.[1];
  const signatures = [...signatureHeader.matchAll(/(?:^|,)v1=([a-f0-9]{64})/g)].map(x=>x[1]);
  if (!timestamp || !signatures.length || Math.abs(now/1000-Number(timestamp))>300) return null;
  const digest = crypto.createHmac('sha256',env.STRIPE_WEBHOOK_SECRET)
    .update(timestamp+'.').update(rawBody).digest('hex');
  if (!signatures.some(sig=>crypto.timingSafeEqual(Buffer.from(sig,'hex'),Buffer.from(digest,'hex')))) return null;
  try { return JSON.parse(rawBody.toString('utf8')); } catch { return null; }
}

const PAID_EVENTS = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded']);

/**
 * Applies a webhook event that verifyStripeWebhook already authenticated.
 * Marks an order paid only when the session, restaurant, amount and currency all match the
 * server-side order. The conditional UPDATE makes webhook replays and duplicates harmless.
 * Not routed yet: wire it to a raw-body webhook route only when Stripe is enabled and tested.
 */
export async function applyVerifiedStripeEvent(pool, event) {
  if (!event || typeof event.type !== 'string') return {result:'rejected', reason:'malformed'};
  if (!PAID_EVENTS.has(event.type)) return {result:'ignored', reason:'event_type'};
  const session = event.data?.object;
  if (!session || session.payment_status !== 'paid') return {result:'ignored', reason:'not_paid'};
  const orderId = Number(session.metadata?.order_id);
  const restaurantId = Number(session.metadata?.restaurant_id);
  if (!Number.isSafeInteger(orderId) || orderId < 1 || !Number.isSafeInteger(restaurantId) || restaurantId < 1 ||
      typeof session.id !== 'string' || !/^cs_/.test(session.id))
    return {result:'rejected', reason:'metadata'};
  const [rows] = await pool.execute(
    'SELECT o.total_minor,r.currency,f.payment_method,f.payment_status,f.stripe_checkout_session_id FROM orders o JOIN restaurants r ON r.id=o.restaurant_id JOIN order_fulfillment f ON f.order_id=o.id AND f.restaurant_id=o.restaurant_id WHERE o.id=? AND o.restaurant_id=? LIMIT 1',
    [orderId, restaurantId]);
  const order = rows[0];
  if (!order) return {result:'rejected', reason:'order_not_found'};
  if (order.payment_method !== 'stripe' || order.stripe_checkout_session_id !== session.id) return {result:'rejected', reason:'session_mismatch'};
  if (Number(session.amount_total) !== Number(order.total_minor) ||
      String(session.currency || '').toLowerCase() !== String(order.currency || '').toLowerCase())
    return {result:'rejected', reason:'amount_mismatch'};
  if (order.payment_status === 'paid') return {result:'duplicate'};
  const [update] = await pool.execute(
    "UPDATE order_fulfillment SET payment_status='paid' WHERE order_id=? AND restaurant_id=? AND payment_method='stripe' AND stripe_checkout_session_id=? AND payment_status IN ('unpaid','pending')",
    [orderId, restaurantId, session.id]);
  return update.affectedRows ? {result:'paid'} : {result:'duplicate'};
}
