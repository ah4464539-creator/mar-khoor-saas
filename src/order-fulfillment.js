// Fulfilment and cash-payment validation for public checkout.
// Kept dependency-free so it can be unit tested and shared by every order channel.

// Phone: optional leading +, then digits with optional spaces, dashes or brackets.
// 7-15 digits in total (E.164 maximum is 15).
const PHONE_SHAPE = /^\+?[0-9 ()-]{7,32}$/;

export function normalizePhone(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!PHONE_SHAPE.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return trimmed;
}

export const CASH_METHOD_FOR = Object.freeze({ delivery: 'cod', pickup: 'cash_pickup' });

/**
 * Validates optional fulfilment details on a public checkout body.
 * Returns {ok:true, present:false} for legacy website checkouts without details,
 * {ok:true, present:true, value} for valid cash orders, or {ok:false, error}.
 * Online (Stripe) payment is rejected here until it is explicitly enabled and routed.
 */
export function validateFulfillment(body = {}) {
  const { customer_phone, order_type, payment_method } = body;
  let { delivery_address = '', delivery_instructions = '' } = body;
  const present = customer_phone !== undefined || order_type !== undefined || payment_method !== undefined;
  if (!present) return { ok: true, present: false };

  if (!Object.hasOwn(CASH_METHOD_FOR, order_type ?? '')) return { ok: false, error: 'Choose delivery or pickup' };
  if (payment_method === 'stripe') return { ok: false, error: 'Online payment is not available yet. Please choose cash.' };
  if (payment_method !== CASH_METHOD_FOR[order_type]) return { ok: false, error: 'Payment method does not match the order type' };
  const phone = normalizePhone(customer_phone);
  if (!phone) return { ok: false, error: customer_phone === undefined || customer_phone === '' ? 'Phone number is required' : 'Enter a valid phone number' };
  if (delivery_address === null) delivery_address = '';
  if (delivery_instructions === null) delivery_instructions = '';
  if (typeof delivery_address !== 'string' || delivery_address.length > 500) return { ok: false, error: 'Delivery address is too long' };
  if (typeof delivery_instructions !== 'string' || delivery_instructions.length > 500) return { ok: false, error: 'Delivery instructions are too long' };
  const address = delivery_address.trim();
  if (order_type === 'delivery' && address.length < 5) return { ok: false, error: 'Complete delivery address is required' };

  return {
    ok: true,
    present: true,
    value: {
      order_type,
      customer_phone: phone,
      delivery_address: order_type === 'delivery' ? address : null,
      delivery_instructions: order_type === 'delivery' ? (delivery_instructions.trim() || null) : null,
      payment_method,
      payment_status: 'unpaid', // Cash is never paid at placement or acceptance.
    },
  };
}

// MariaDB errors that mean the additive order_fulfillment migration has not been applied yet.
export const isMissingFulfillmentSchema = error =>
  error?.code === 'ER_NO_SUCH_TABLE' || error?.code === 'ER_BAD_FIELD_ERROR';
