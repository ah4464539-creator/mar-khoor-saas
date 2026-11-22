// Booking payments (deposits, refunds), customer self-service (my bookings, cancel, reschedule),
// hand-over to staff on WhatsApp, and the reception phone for call transfers. Additive tables only.
import crypto from 'node:crypto';
import { ensureBookingTables, setBookingStatus, rescheduleBooking, logEvent, getProfile, localNow, isDate } from './bookings.js';
import { pushToRestaurant } from './web-push.js';

export const EXTRA_SQL = [
  `CREATE TABLE IF NOT EXISTS whatsapp_handover (
 restaurant_id BIGINT UNSIGNED NOT NULL,
 phone_number_id VARCHAR(64) NOT NULL,
 customer VARCHAR(32) NOT NULL,
 reason VARCHAR(200) NULL,
 until_at DATETIME NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (restaurant_id, phone_number_id, customer),
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS business_contacts (
 restaurant_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
 transfer_phone VARCHAR(32) NULL,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB`,
];
const ready = new WeakMap();
export function ensureExtraTables(pool) {
  if (!ready.has(pool)) ready.set(pool, (async () => { await ensureBookingTables(pool); for (const sql of EXTRA_SQL) await pool.query(sql); })().catch(e => { ready.delete(pool); throw e; }));
  return ready.get(pool);
}
const digits = v => String(v || '').replace(/\D/g, '');
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

// ---------- Payments ----------
export const PAY_METHODS = ['cash', 'card', 'bank', 'wallet', 'link', 'paypal', 'upi', 'jazzcash', 'easypaisa', 'raast', 'other'];
export async function bookingPayments(pool, restaurantId, bookingId) {
  await ensureBookingTables(pool);
  const [rows] = await pool.execute('SELECT id,kind,amount_minor,method,reference,status,actor,created_at FROM booking_payments WHERE restaurant_id=? AND booking_id=? ORDER BY id', [restaurantId, bookingId]);
  return rows.map(r => ({ id: Number(r.id), kind: r.kind, amount_minor: Number(r.amount_minor), method: r.method, reference: r.reference, status: r.status, actor: r.actor, at: String(r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at).slice(0, 16).replace('T', ' ') }));
}
async function bookingRow(pool, restaurantId, bookingId) {
  const [[b]] = await pool.execute('SELECT id,price_minor,status FROM bookings WHERE id=? AND restaurant_id=?', [bookingId, restaurantId]);
  return b || null;
}
/** Owner records a payment or a refund (confirmed). Refunds never exceed what was paid. */
export async function recordPayment(pool, restaurantId, bookingId, body, actor) {
  await ensureBookingTables(pool);
  const b = await bookingRow(pool, restaurantId, bookingId);
  if (!b) return { error: 'Booking not found' };
  const kind = body?.kind === 'refund' ? 'refund' : 'payment';
  const amount = Math.round(Number(body?.amount) * 100);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1e11) return { error: 'Enter a valid amount' };
  const method = PAY_METHODS.includes(body?.method) ? body.method : 'other';
  if (kind === 'refund') {
    const paid = (await bookingPayments(pool, restaurantId, bookingId)).filter(p => p.status === 'confirmed').reduce((t, p) => t + (p.kind === 'payment' ? p.amount_minor : -p.amount_minor), 0);
    if (amount > paid) return { error: 'A refund cannot be more than what was paid' };
  }
  await pool.execute('INSERT INTO booking_payments(restaurant_id,booking_id,kind,amount_minor,method,reference,status,actor) VALUES (?,?,?,?,?,?,?,?)', [restaurantId, bookingId, kind, amount, method, clean(body?.reference, 80) || null, 'confirmed', actor]);
  await logEvent(pool, restaurantId, bookingId, kind === 'refund' ? 'refunded' : 'paid', (amount / 100) + ' ' + method, actor);
  return { payments: await bookingPayments(pool, restaurantId, bookingId) };
}
export async function decidePayment(pool, restaurantId, bookingId, paymentId, decision, actor) {
  if (!['confirmed', 'rejected'].includes(decision)) return { error: 'Invalid decision' };
  await ensureBookingTables(pool);
  const [r] = await pool.execute("UPDATE booking_payments SET status=?,actor=? WHERE id=? AND booking_id=? AND restaurant_id=? AND status='pending'", [decision, actor, paymentId, bookingId, restaurantId]);
  if (!r.affectedRows) return { error: 'Payment not found' };
  await logEvent(pool, restaurantId, bookingId, decision === 'confirmed' ? 'payment_ok' : 'payment_rejected', null, actor);
  return { payments: await bookingPayments(pool, restaurantId, bookingId) };
}
/** A secret per booking so only the customer who booked can send a payment reference. */
export async function bookingToken(pool, restaurantId, bookingId) {
  await ensureBookingTables(pool);
  const token = crypto.randomBytes(16).toString('hex');
  await pool.execute('INSERT INTO booking_access(booking_id,restaurant_id,token) VALUES (?,?,?) ON DUPLICATE KEY UPDATE booking_id=booking_id', [bookingId, restaurantId, token]);
  const [[row]] = await pool.execute('SELECT token FROM booking_access WHERE booking_id=? AND restaurant_id=?', [bookingId, restaurantId]);
  return row?.token || token;
}
export async function customerPaymentReference(pool, restaurantId, bookingId, token, body) {
  await ensureBookingTables(pool);
  if (!/^[a-f0-9]{32}$/.test(String(token || ''))) return { error: 'Invalid link' };
  const [[row]] = await pool.execute('SELECT token FROM booking_access WHERE booking_id=? AND restaurant_id=?', [bookingId, restaurantId]);
  if (!row || !crypto.timingSafeEqual(Buffer.from(row.token), Buffer.from(String(token)))) return { error: 'Invalid link' };
  const reference = clean(body?.reference, 80).replace(/\s+/g, '');
  if (!/^[A-Za-z0-9-]{4,40}$/.test(reference)) return { error: 'Enter the transaction ID from your payment app' };
  const b = await bookingRow(pool, restaurantId, bookingId);
  if (!b) return { error: 'Booking not found' };
  const [[pending]] = await pool.execute("SELECT COUNT(*) n FROM booking_payments WHERE booking_id=? AND restaurant_id=? AND status='pending'", [bookingId, restaurantId]);
  if (Number(pending.n) >= 3) return { error: 'We already have your payment reference' };
  const amount = Math.max(1, Math.round(Number(body?.amount) * 100) || Number(b.price_minor) || 1);
  const method = PAY_METHODS.includes(body?.method) ? body.method : 'other';
  await pool.execute("INSERT INTO booking_payments(restaurant_id,booking_id,kind,amount_minor,method,reference,status,actor) VALUES (?,?,'payment',?,?,?,'pending','customer')", [restaurantId, bookingId, Math.min(amount, 1e11), method, reference]);
  await logEvent(pool, restaurantId, bookingId, 'payment_sent', method + ' ' + reference, 'customer');
  pushToRestaurant(pool, restaurantId, { title: '💳 Payment to check · booking #' + bookingId, body: method + ' · ' + reference, url: '/restaurant.html#bookings', tag: 'bpay-' + bookingId }).catch(() => {});
  return { ok: true };
}

// ---------- Customer self-service (WhatsApp / calls): only their own bookings ----------
export async function myBookings(pool, restaurantId, phone) {
  await ensureBookingTables(pool);
  const d = digits(phone).slice(-10);
  if (d.length < 7) return [];
  const profile = await getProfile(pool, restaurantId);
  const now = localNow(profile?.timezone || 'UTC');
  const [rows] = await pool.execute("SELECT b.id,b.start_at,b.end_at,b.status,b.service_id,s.name service FROM bookings b LEFT JOIN booking_services s ON s.id=b.service_id AND s.restaurant_id=b.restaurant_id WHERE b.restaurant_id=? AND b.status IN ('pending','confirmed') AND REPLACE(REPLACE(b.customer_phone,'+',''),' ','') LIKE ? ORDER BY b.start_at LIMIT 10", [restaurantId, '%' + d]);
  const norm = v => String(v instanceof Date ? v.toISOString().replace('T', ' ') : v).slice(0, 16);
  return rows.filter(r => norm(r.end_at) >= now).map(r => ({ booking_id: Number(r.id), service: r.service, start: norm(r.start_at), end: norm(r.end_at), status: r.status, service_id: r.service_id == null ? null : Number(r.service_id) }));
}
async function ownBooking(pool, restaurantId, phone, bookingId) {
  return (await myBookings(pool, restaurantId, phone)).find(b => b.booking_id === Number(bookingId)) || null;
}
export async function cancelByCustomer(pool, restaurantId, phone, bookingId, source) {
  const own = await ownBooking(pool, restaurantId, phone, bookingId);
  if (!own) return { error: 'No open booking with that number for this phone' };
  await setBookingStatus(pool, restaurantId, own.booking_id, 'cancelled', 'customer:' + source);
  pushToRestaurant(pool, restaurantId, { title: '❌ Booking #' + own.booking_id + ' cancelled by the customer', body: [own.service, own.start, source].filter(Boolean).join(' · '), url: '/restaurant.html#bookings', tag: 'booking-' + own.booking_id }).catch(() => {});
  return { cancelled: own.booking_id };
}
export async function rescheduleByCustomer(pool, restaurantId, phone, args, source) {
  const own = await ownBooking(pool, restaurantId, phone, args?.booking_id);
  if (!own) return { error: 'No open booking with that number for this phone' };
  if (!isDate(args?.date)) return { error: 'date must be YYYY-MM-DD' };
  const result = await rescheduleBooking(pool, restaurantId, own.booking_id, { service_id: own.service_id, date: args.date, time: args.time, check_out: args.check_out }, 'customer:' + source);
  if (result.error) return { error: result.error + ' Call check_availability and offer free times.' };
  pushToRestaurant(pool, restaurantId, { title: '🔁 Booking #' + own.booking_id + ' moved by the customer', body: own.start + ' → ' + result.booking.start_at + ' · ' + source, url: '/restaurant.html#bookings', tag: 'booking-' + own.booking_id }).catch(() => {});
  return { booking_id: own.booking_id, new_start: result.booking.start_at };
}

// ---------- Hand-over to staff on WhatsApp ----------
export async function startHandover(pool, job, reason) {
  await ensureExtraTables(pool);
  await pool.execute('INSERT INTO whatsapp_handover(restaurant_id,phone_number_id,customer,reason,until_at) VALUES (?,?,?,?,NOW()+INTERVAL 2 HOUR) ON DUPLICATE KEY UPDATE reason=VALUES(reason),until_at=VALUES(until_at)', [job.restaurant_id, job.phone_number_id, job.sender, clean(reason, 200) || null]);
  pushToRestaurant(pool, job.restaurant_id, { title: '🙋 A customer wants to talk to a person', body: '+' + digits(job.sender) + (reason ? ' · ' + clean(reason, 80) : '') + ' — reply in WhatsApp', url: '/restaurant.html#whatsapp-inbox-view', tag: 'handover-' + job.sender }).catch(() => {});
}
export async function handoverActive(pool, job) {
  try {
    await ensureExtraTables(pool);
    const [rows] = await pool.execute('SELECT 1 FROM whatsapp_handover WHERE restaurant_id=? AND phone_number_id=? AND customer=? AND until_at>NOW() LIMIT 1', [job.restaurant_id, job.phone_number_id, job.sender]);
    return rows.length > 0;
  } catch { return false; }
}
export async function listHandovers(pool, restaurantId) {
  await ensureExtraTables(pool);
  const [rows] = await pool.execute('SELECT phone_number_id,customer,reason,until_at FROM whatsapp_handover WHERE restaurant_id=? AND until_at>NOW() ORDER BY created_at DESC LIMIT 50', [restaurantId]);
  return rows.map(r => ({ phone_number_id: r.phone_number_id, customer: r.customer, reason: r.reason, until: String(r.until_at instanceof Date ? r.until_at.toISOString() : r.until_at).slice(0, 16).replace('T', ' ') }));
}
export async function endHandover(pool, restaurantId, customer) {
  await ensureExtraTables(pool);
  const [r] = await pool.execute('DELETE FROM whatsapp_handover WHERE restaurant_id=? AND customer=?', [restaurantId, digits(customer)]);
  return r.affectedRows > 0;
}

// ---------- Reception phone for call transfers ----------
export async function getTransferPhone(pool, restaurantId) {
  try { await ensureExtraTables(pool); const [[r]] = await pool.execute('SELECT transfer_phone FROM business_contacts WHERE restaurant_id=?', [restaurantId]); return r?.transfer_phone || ''; } catch { return ''; }
}
export async function setTransferPhone(pool, restaurantId, phone) {
  await ensureExtraTables(pool);
  const p = String(phone || '').replace(/[\s()-]/g, '');
  if (p && !/^\+\d{8,15}$/.test(p)) return { error: 'Enter the number with country code, e.g. +923001234567' };
  await pool.execute('INSERT INTO business_contacts(restaurant_id,transfer_phone) VALUES (?,?) ON DUPLICATE KEY UPDATE transfer_phone=VALUES(transfer_phone)', [restaurantId, p || null]);
  return { transfer_phone: p };
}
