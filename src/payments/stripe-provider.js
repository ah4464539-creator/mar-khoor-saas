// Stripe adapter for the payment interface (src/payments/provider.js), for customer order payments.
// Charges are made directly on the restaurant's own connected Stripe account (Stripe Connect,
// "direct charges"): the money goes to the restaurant, Mar-Khoor never holds it. An optional platform
// fee (PAYMENTS_PLATFORM_FEE_BPS, basis points) is taken by Stripe as an application fee.
//
// Plan / tool subscriptions keep using src/stripe-billing.js (platform account, /webhooks/stripe).
// Configuration (test mode first): STRIPE_SECRET_KEY (sk_test_...), STRIPE_CONNECT_WEBHOOK_SECRET
// (from a Connect webhook endpoint "listening to events on connected accounts").
import { verifyStripeSignature, stripeAmount } from '../stripe-billing.js';

const ACCOUNT = /^acct_[A-Za-z0-9]{6,64}$/;
const API = 'https://api.stripe.com/v1/';

export function stripePaymentsConfig(env = process.env) {
  const secretKey = env.STRIPE_SECRET_KEY, webhookSecret = env.STRIPE_CONNECT_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret || !/^(sk|rk)_(live|test)_/.test(secretKey) || env.ORDER_PAYMENTS_ENABLED === '0') return null;
  const fee = Number(env.PAYMENTS_PLATFORM_FEE_BPS ?? 0);
  return { secretKey, webhookSecret, live: /_live_/.test(secretKey), feeBps: Number.isInteger(fee) && fee >= 0 && fee <= 3000 ? fee : 0 };
}

// Stripe amount (smallest currency unit) back to Mar-Khoor minor units (always × 100).
const ZERO_DECIMAL = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
export function fromStripeAmount(amount, currency) {
  const n = Number(amount);
  if (!Number.isSafeInteger(n) || n < 0) return null;
  return ZERO_DECIMAL.has(String(currency).toUpperCase()) ? n * 100 : n;
}

export function createStripeProvider(config, { fetcher = fetch } = {}) {
  if (!config) return null;
  async function call(method, path, params, { account = null, idempotencyKey = null } = {}) {
    const headers = { Authorization: 'Bearer ' + config.secretKey, 'Stripe-Version': '2024-06-20' };
    if (params) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    if (account) headers['Stripe-Account'] = account;
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const response = await fetcher(API + path, { method, headers, body: params ? new URLSearchParams(params).toString() : undefined, signal: AbortSignal.timeout(20000) });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(data?.error?.message || 'Payment provider unavailable');
      error.status = response.status; error.code = data?.error?.code;
      throw error;
    }
    return data;
  }

  return {
    name: 'stripe',
    live: config.live,

    async createCheckout({ kind = 'order', orderId, restaurantId, amountMinor, currency, description, successUrl, cancelUrl, account, idempotencyKey }) {
      const amount = stripeAmount(amountMinor, currency);
      if (kind !== 'order' || !Number.isSafeInteger(orderId) || orderId < 1 || !Number.isSafeInteger(restaurantId) || restaurantId < 1 || !amount
        || !/^https:\/\//.test(successUrl) || !/^https:\/\//.test(cancelUrl) || !ACCOUNT.test(account || '')) throw new TypeError('Invalid checkout details');
      const params = {
        mode: 'payment', success_url: successUrl, cancel_url: cancelUrl,
        'line_items[0][price_data][currency]': currency.toLowerCase(),
        'line_items[0][price_data][unit_amount]': String(amount),
        'line_items[0][price_data][product_data][name]': String(description || 'Order #' + orderId).slice(0, 120),
        'line_items[0][quantity]': '1',
        'metadata[kind]': 'order', 'metadata[order_id]': String(orderId), 'metadata[restaurant_id]': String(restaurantId),
        'payment_intent_data[metadata][order_id]': String(orderId), 'payment_intent_data[metadata][restaurant_id]': String(restaurantId),
        client_reference_id: restaurantId + '-' + orderId,
        expires_at: String(Math.floor(Date.now() / 1000) + 60 * 60),
      };
      const fee = Math.floor(amount * config.feeBps / 10000);
      if (fee > 0) params['payment_intent_data[application_fee_amount]'] = String(fee);
      const session = await call('POST', 'checkout/sessions', params, { account, idempotencyKey });
      if (!/^cs_/.test(session?.id || '') || !/^https:\/\/checkout\.stripe\.com\//.test(session?.url || '')) throw new Error('Invalid payment session');
      return { provider: 'stripe', sessionId: session.id, url: session.url, feeMinor: fromStripeAmount(fee, currency) || 0 };
    },

    verifyWebhook(rawBody, headers) {
      return verifyStripeSignature(rawBody, headers?.get?.('stripe-signature') ?? '', config.webhookSecret);
    },

    handlePaymentEvent(event) {
      if (!event?.id || typeof event.type !== 'string') return null;
      const object = event.data?.object ?? {};
      const account = ACCOUNT.test(event.account || '') ? event.account : null;
      const base = { provider: 'stripe', eventId: String(event.id).slice(0, 80), account };
      if (event.type.startsWith('checkout.session.')) {
        if (object.mode !== 'payment' || object.metadata?.kind !== 'order') return null;
        const type = { 'checkout.session.completed': object.payment_status === 'paid' ? 'paid' : null, 'checkout.session.async_payment_succeeded': 'paid',
          'checkout.session.async_payment_failed': 'failed', 'checkout.session.expired': 'expired' }[event.type];
        if (!type) return null;
        return { ...base, type, kind: 'order', restaurantId: Number(object.metadata.restaurant_id), orderId: Number(object.metadata.order_id),
          sessionId: String(object.id || ''), paymentRef: typeof object.payment_intent === 'string' ? object.payment_intent : null,
          amountMinor: fromStripeAmount(object.amount_total, object.currency), currency: String(object.currency || '').toUpperCase(), refundedMinor: 0 };
      }
      if (event.type === 'charge.refunded') {
        const orderId = Number(object.metadata?.order_id), restaurantId = Number(object.metadata?.restaurant_id);
        if (!orderId || !restaurantId) return null;
        return { ...base, type: 'refunded', kind: 'order', restaurantId, orderId, sessionId: null,
          paymentRef: typeof object.payment_intent === 'string' ? object.payment_intent : null,
          amountMinor: fromStripeAmount(object.amount, object.currency), currency: String(object.currency || '').toUpperCase(),
          refundedMinor: fromStripeAmount(object.amount_refunded, object.currency) };
      }
      return null;
    },

    async refund({ paymentRef, amountMinor = null, currency, account, idempotencyKey }) {
      if (!/^pi_[A-Za-z0-9]{6,64}$/.test(paymentRef || '') || !ACCOUNT.test(account || '')) throw new TypeError('Invalid refund details');
      const params = { payment_intent: paymentRef };
      if (amountMinor !== null) {
        const amount = stripeAmount(amountMinor, currency);
        if (!amount) throw new TypeError('Invalid refund amount');
        params.amount = String(amount);
      }
      const refund = await call('POST', 'refunds', params, { account, idempotencyKey });
      return { refundId: String(refund?.id || ''), status: String(refund?.status || 'pending') };
    },

    // ---- Stripe Connect onboarding (Stripe-specific extras, not part of the interface) ----
    async createAccount({ country, email, restaurantId }) {
      const params = { type: 'express', 'capabilities[card_payments][requested]': 'true', 'capabilities[transfers][requested]': 'true', 'metadata[restaurant_id]': String(restaurantId) };
      if (/^[A-Z]{2}$/.test(country || '')) params.country = country;
      if (email) params.email = email;
      const account = await call('POST', 'accounts', params, { idempotencyKey: 'mk-connect-account-' + restaurantId });
      if (!ACCOUNT.test(account?.id || '')) throw new Error('Invalid account');
      return { accountId: account.id };
    },
    async onboardingLink({ account, refreshUrl, returnUrl }) {
      const link = await call('POST', 'account_links', { account, refresh_url: refreshUrl, return_url: returnUrl, type: 'account_onboarding' });
      if (!/^https:\/\/connect\.stripe\.com\//.test(link?.url || '')) throw new Error('Invalid onboarding link');
      return { url: link.url };
    },
    async accountStatus(account) {
      const data = await call('GET', 'accounts/' + encodeURIComponent(account));
      return { chargesEnabled: Boolean(data?.charges_enabled), detailsSubmitted: Boolean(data?.details_submitted) };
    },
  };
}
