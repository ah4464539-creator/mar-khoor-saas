// Stripe integration is prepared but intentionally disabled until an account is connected.
// Never mark an order paid from a redirect alone; require a verified webhook.
import crypto from 'node:crypto';

export function stripeReady(env = process.env) {
  return env.STRIPE_CHECKOUT_ENABLED === '1' &&
    Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);
}

export async function createStripeCheckout({orderId, currency, totalMinor, successUrl, cancelUrl}, env = process.env, fetchImpl = fetch) {
  if (!stripeReady(env)) throw new Error('Stripe checkout is not configured');
  if (!Number.isSafeInteger(orderId) || orderId < 1 || !Number.isSafeInteger(totalMinor) || totalMinor < 1 ||
      !/^[a-z]{3}$/.test(currency) || !/^https:\/\//.test(successUrl) || !/^https:\/\//.test(cancelUrl))
    throw new Error('Invalid checkout details');
  const params = new URLSearchParams({
    mode:'payment',success_url:successUrl,cancel_url:cancelUrl,
    'line_items[0][price_data][currency]':currency,
    'line_items[0][price_data][unit_amount]':String(totalMinor),
    'line_items[0][price_data][product_data][name]':'Restaurant order #'+orderId,
    'line_items[0][quantity]':'1',
    'metadata[order_id]':String(orderId),
  });
  const response = await fetchImpl('https://api.stripe.com/v1/checkout/sessions',{
    method:'POST',headers:{Authorization:'Bearer '+env.STRIPE_SECRET_KEY,
      'Content-Type':'application/x-www-form-urlencoded',
      'Idempotency-Key':'restaurant-order-'+orderId},body:params.toString(),
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
