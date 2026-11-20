// How customers can pay a restaurant for food orders. Each restaurant chooses its own methods.
// Stage 1 (this file): cash, card on delivery, and manual transfers (bank, JazzCash, Easypaisa,
// Raast) where the customer pays the restaurant's own account and the restaurant confirms it.
// Online gateways (Stripe Connect, Safepay) plug in later as further option types.
// No express import: testable with mock pools.

export const PAYMENT_SQL = [
  `CREATE TABLE IF NOT EXISTS restaurant_payment_settings (
 restaurant_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
 config TEXT NOT NULL,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS order_payments (
 order_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
 restaurant_id BIGINT UNSIGNED NOT NULL,
 option_key VARCHAR(40) NOT NULL,
 method_type VARCHAR(20) NOT NULL,
 method_label VARCHAR(80) NOT NULL,
 reference VARCHAR(80) NULL,
 status ENUM('awaiting','submitted','confirmed','rejected') NOT NULL DEFAULT 'awaiting',
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
 INDEX (restaurant_id,status)
) ENGINE=InnoDB`,
];

const ensured = new WeakMap();
export function ensurePaymentTables(pool) {
  if (!ensured.has(pool)) ensured.set(pool, (async () => { for (const sql of PAYMENT_SQL) await pool.query(sql); })()
    .catch(error => { ensured.delete(pool); throw error; }));
  return ensured.get(pool);
}

export const TRANSFER_TYPES = Object.freeze({
  bank: 'Bank transfer', jazzcash: 'JazzCash', easypaisa: 'Easypaisa', raast: 'Raast', other: 'Transfer',
});
export const DEFAULT_PAYMENT_SETTINGS = Object.freeze({ cash: true, card_on_delivery: false, transfers: [] });

const clean = (value, max) => typeof value === 'string' ? value.replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';

export function sanitizePaymentSettings(source = {}) {
  const s = source && typeof source === 'object' ? source : {};
  const transfers = [];
  const ids = new Set();
  for (const raw of Array.isArray(s.transfers) ? s.transfers.slice(0, 5) : []) {
    const type = Object.hasOwn(TRANSFER_TYPES, raw?.type) ? raw.type : 'other';
    const account_number = clean(raw?.account_number, 40);
    const account_title = clean(raw?.account_title, 80);
    if (!account_number || !account_title) continue;
    let id = /^[a-z0-9]{4,12}$/.test(raw?.id) ? raw.id : Math.random().toString(36).slice(2, 10);
    while (ids.has(id)) id = Math.random().toString(36).slice(2, 10);
    ids.add(id);
    transfers.push({ id, type, label: clean(raw?.label, 60) || TRANSFER_TYPES[type], account_title, account_number, instructions: clean(raw?.instructions, 200) });
  }
  const settings = { cash: s.cash !== false, card_on_delivery: s.card_on_delivery === true, transfers };
  if (!settings.cash && !settings.card_on_delivery && !transfers.length) settings.cash = true; // never zero ways to pay
  return settings;
}

export function parsePaymentSettings(text) {
  try { return sanitizePaymentSettings(JSON.parse(text)); } catch { return sanitizePaymentSettings(DEFAULT_PAYMENT_SETTINGS); }
}

export async function loadPaymentSettings(db, restaurantId) {
  try {
    const [rows] = await db.execute('SELECT config FROM restaurant_payment_settings WHERE restaurant_id=? LIMIT 1', [restaurantId]);
    return rows.length ? parsePaymentSettings(rows[0].config) : sanitizePaymentSettings(DEFAULT_PAYMENT_SETTINGS);
  } catch { return sanitizePaymentSettings(DEFAULT_PAYMENT_SETTINGS); }
}

/** What customers see at checkout. Account details are shown because the restaurant chose to. */
export function publicPaymentOptions(settings) {
  const out = [];
  if (settings.cash) out.push({ key: 'cash', type: 'cash', label: 'Cash' });
  if (settings.card_on_delivery) out.push({ key: 'card', type: 'card_on_delivery', label: 'Card on delivery / at counter' });
  for (const t of settings.transfers) out.push({ key: 'transfer:' + t.id, type: t.type, label: t.label, account_title: t.account_title, account_number: t.account_number, instructions: t.instructions });
  return out;
}

export function normalizeReference(value) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false };
  const ref = value.trim().replace(/\s+/g, ' ');
  if (!/^[A-Za-z0-9 ._/#-]{4,60}$/.test(ref)) return { ok: false };
  return { ok: true, value: ref };
}

/**
 * Resolves the option a customer picked. Returns null for plain cash (no extra record),
 * { method_type, method_label, option_key } for others, or { error }.
 */
export function resolvePaymentOption(settings, key) {
  if (key === undefined || key === null || key === 'cash') {
    if (!settings.cash) return { error: 'This restaurant does not take cash. Choose another payment method.' };
    return null;
  }
  if (key === 'card') return settings.card_on_delivery ? { option_key: 'card', method_type: 'card_on_delivery', method_label: 'Card on delivery' } : { error: 'Choose a valid payment method' };
  const match = typeof key === 'string' && /^transfer:([a-z0-9]{4,12})$/.exec(key);
  const transfer = match && settings.transfers.find(t => t.id === match[1]);
  if (!transfer) return { error: 'Choose a valid payment method' };
  return { option_key: key, method_type: transfer.type, method_label: transfer.label, transfer };
}

/** Customer-facing payment state for tracking and receipts. */
export function paymentView(row, settings) {
  if (!row) return null;
  const view = { method_type: row.method_type, method_label: row.method_label, status: row.status, reference_submitted: Boolean(row.reference) };
  if (row.option_key.startsWith('transfer:') && row.status !== 'confirmed') {
    const transfer = settings?.transfers.find(t => 'transfer:' + t.id === row.option_key);
    if (transfer) Object.assign(view, { account_title: transfer.account_title, account_number: transfer.account_number, instructions: transfer.instructions });
  }
  return view;
}
