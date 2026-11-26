// Provider-agnostic payment interface. Every payment provider adapter (Stripe today; JazzCash,
// Easypaisa, Safepay later) is a plain object with these four methods:
//
//   createCheckout({ kind, orderId, restaurantId, amountMinor, currency, description, successUrl,
//                    cancelUrl, account, idempotencyKey })
//       -> { provider, sessionId, url, feeMinor }   (redirect the customer to url; feeMinor = platform fee)
//   verifyWebhook(rawBody: Buffer, headers: { get(name) })
//       -> provider event object, or null when the signature is invalid
//   handlePaymentEvent(event)
//       -> normalised event (see below) or null when the event is not about a payment we care about
//   refund({ paymentRef, amountMinor, account, idempotencyKey })
//       -> { refundId, status }
//
// Normalised payment event (what the shared service in service.js applies to the database):
//   { provider, eventId, type: 'paid' | 'failed' | 'expired' | 'refunded',
//     kind: 'order', restaurantId, orderId, sessionId, paymentRef, amountMinor, currency,
//     refundedMinor, account }
//
// Amounts are always in Mar-Khoor minor units (price × 100), whatever the provider uses internally.
// Adapters never touch the database; the service never talks to a provider's HTTP API directly.
// To add a provider: write an adapter with the four methods, then registerProvider('name', factory).

export const PROVIDER_METHODS = Object.freeze(['createCheckout', 'verifyWebhook', 'handlePaymentEvent', 'refund']);
export const EVENT_TYPES = Object.freeze(['paid', 'failed', 'expired', 'refunded']);

export function assertProvider(provider) {
  if (!provider || typeof provider !== 'object') throw new TypeError('Payment provider must be an object');
  for (const method of PROVIDER_METHODS) if (typeof provider[method] !== 'function') throw new TypeError('Payment provider is missing ' + method + '()');
  if (typeof provider.name !== 'string' || !/^[a-z][a-z0-9_]{1,30}$/.test(provider.name)) throw new TypeError('Payment provider needs a lowercase name');
  return provider;
}

const factories = new Map();
/** factory(env) returns a provider, or null when that provider is not configured. */
export function registerProvider(name, factory) {
  if (!/^[a-z][a-z0-9_]{1,30}$/.test(name) || typeof factory !== 'function') throw new TypeError('Invalid payment provider registration');
  factories.set(name, factory);
}
export function providerNames() { return [...factories.keys()]; }
export function getProvider(name, env = process.env) {
  const factory = factories.get(name);
  if (!factory) return null;
  const provider = factory(env);
  return provider ? assertProvider(provider) : null;
}
