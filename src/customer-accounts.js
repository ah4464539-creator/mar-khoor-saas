// Customer accounts for the Mar-Khoor customer app: sign in with an email link (no password),
// then the customer's orders and bookings show on every phone they sign in on.
// Separate from business staff accounts (users / sessions), so a customer can never reach a
// dashboard. Tokens are random and stored only as SHA-256 hashes; order tracking tokens are kept
// encrypted so the account can reopen tracking links. Additive tables only. No express import.
import crypto from 'node:crypto';
import { seal, open as unseal } from './whatsapp-signup-core.js';
import { hashTrackingToken } from './order-tracking.js';

export const CUSTOMER_ACCOUNT_SQL = [
  `CREATE TABLE IF NOT EXISTS customer_accounts (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 email VARCHAR(254) NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 last_login_at TIMESTAMP NULL DEFAULT NULL,
 UNIQUE KEY uq_customer_email (email)
) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS customer_login_links (
 token_hash CHAR(64) NOT NULL PRIMARY KEY,
 email VARCHAR(254) NOT NULL,
 expires_at DATETIME NOT NULL,
 used_at DATETIME NULL DEFAULT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY ix_customer_login_email (email)
) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS customer_sessions (
 token_hash CHAR(64) NOT NULL PRIMARY KEY,
 account_id BIGINT UNSIGNED NOT NULL,
 expires_at DATETIME NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY ix_customer_sessions_account (account_id),
 FOREIGN KEY (account_id) REFERENCES customer_accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS customer_orders (
 account_id BIGINT UNSIGNED NOT NULL,
 order_id BIGINT UNSIGNED NOT NULL,
 token_enc TEXT NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (account_id, order_id),
 FOREIGN KEY (account_id) REFERENCES customer_accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS customer_bookings (
 account_id BIGINT UNSIGNED NOT NULL,
 booking_id BIGINT UNSIGNED NOT NULL,
 restaurant_id BIGINT UNSIGNED NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (account_id, booking_id),
 FOREIGN KEY (account_id) REFERENCES customer_accounts(id) ON DELETE CASCADE,
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB`,
];

const ready = new WeakMap();
export function ensureCustomerAccountTables(pool) {
  if (typeof pool?.query !== 'function') return Promise.resolve();
  if (!ready.has(pool)) ready.set(pool, (async () => { for (const sql of CUSTOMER_ACCOUNT_SQL) await pool.query(sql); })().catch(error => { ready.delete(pool); throw error; }));
  return ready.get(pool);
}

const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const EMAIL = /^[^\s@<>"',;]{1,64}@[^\s@<>"',;]{1,190}\.[a-z]{2,24}$/i;
const LINK_TOKEN = /^[a-f0-9]{64}$/;
const SESSION = /^[a-f0-9]{64}$/;
const ORDER_TOKEN = /^[a-f0-9]{48}$/;
export const LINK_MINUTES = 20;
export const SESSION_DAYS = 90;

export function cleanEmail(value) {
  const email = String(value ?? '').trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}

export function loginEmail(link) {
  return {
    subject: 'Your Mar-Khoor sign-in link',
    text: 'Open this link to sign in to Mar-Khoor and see your orders and bookings on this phone:\n\n' + link
      + '\n\nThe link works once and expires in ' + LINK_MINUTES + ' minutes. If you did not ask for it, ignore this email.',
    html: '<p>Open this link to sign in to Mar-Khoor and see your orders and bookings on this phone:</p><p><a href="' + link + '">Sign in to Mar-Khoor</a></p>'
      + '<p>The link works once and expires in ' + LINK_MINUTES + ' minutes. If you did not ask for it, ignore this email.</p>',
  };
}

/** Emails a one-time sign-in link. Always answers the same way, so it never reveals who has an account. */
export async function requestLogin(pool, input, { sendMail, origin, log = console } = {}) {
  const email = cleanEmail(input?.email);
  if (!email) return { status: 400, body: { error: 'Enter a valid email address' } };
  if (!sendMail || !/^https:\/\/[a-z0-9.-]+$/i.test(String(origin || ''))) return { status: 503, body: { error: 'Sign-in by email is not available right now' } };
  await ensureCustomerAccountTables(pool);
  const [[recent]] = await pool.execute('SELECT COUNT(*) AS n FROM customer_login_links WHERE email=? AND created_at>=NOW()-INTERVAL 15 MINUTE', [email]);
  if (Number(recent?.n || 0) >= 3) return { status: 200, body: { sent: true } };
  const token = crypto.randomBytes(32).toString('hex');
  await pool.execute('INSERT INTO customer_login_links(token_hash,email,expires_at) VALUES (?,?,NOW()+INTERVAL ' + LINK_MINUTES + ' MINUTE)', [hash(token), email]);
  try { await sendMail({ to: email, ...loginEmail(origin + '/account.html#login=' + token) }); }
  catch (error) { log.warn?.(JSON.stringify({ event: 'customer_login_mail_failed', code: error?.code || null })); return { status: 503, body: { error: 'Could not send the email. Please try again.' } }; }
  return { status: 200, body: { sent: true } };
}

/** Opens the emailed link: creates the account on first use and returns a session token. */
export async function completeLogin(pool, input) {
  const token = String(input?.token ?? '');
  if (!LINK_TOKEN.test(token)) return { status: 400, body: { error: 'This sign-in link is not valid' } };
  await ensureCustomerAccountTables(pool);
  const [used] = await pool.execute('UPDATE customer_login_links SET used_at=NOW() WHERE token_hash=? AND used_at IS NULL AND expires_at>NOW()', [hash(token)]);
  if (!used.affectedRows) return { status: 410, body: { error: 'This sign-in link has expired or was already used. Ask for a new one.' } };
  const [[link]] = await pool.execute('SELECT email FROM customer_login_links WHERE token_hash=? LIMIT 1', [hash(token)]);
  await pool.execute('INSERT INTO customer_accounts(email,last_login_at) VALUES (?,NOW()) ON DUPLICATE KEY UPDATE last_login_at=NOW()', [link.email]);
  const [[account]] = await pool.execute('SELECT id,email FROM customer_accounts WHERE email=? LIMIT 1', [link.email]);
  const session = crypto.randomBytes(32).toString('hex');
  await pool.execute('INSERT INTO customer_sessions(token_hash,account_id,expires_at) VALUES (?,?,NOW()+INTERVAL ' + SESSION_DAYS + ' DAY)', [hash(session), account.id]);
  return { status: 200, body: { session, email: account.email } };
}

/** The signed-in customer for an X-Customer-Session header, or null. Never throws. */
export async function customerFromSession(pool, header) {
  const session = String(header ?? '');
  if (!SESSION.test(session)) return null;
  try {
    await ensureCustomerAccountTables(pool);
    const [[row]] = await pool.execute('SELECT a.id,a.email FROM customer_sessions s JOIN customer_accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>NOW() LIMIT 1', [hash(session)]);
    return row ? { id: Number(row.id), email: row.email } : null;
  } catch { return null; }
}

export async function logout(pool, header) {
  const session = String(header ?? '');
  if (SESSION.test(session)) { await ensureCustomerAccountTables(pool); await pool.execute('DELETE FROM customer_sessions WHERE token_hash=?', [hash(session)]); }
  return { status: 200, body: { signed_out: true } };
}

/**
 * Adds the orders saved on this phone to the account (each proven by its tracking token) and
 * returns every order of the account, so the phone can show them all.
 */
export async function syncOrders(pool, account, input, env = process.env) {
  const list = Array.isArray(input?.orders) ? input.orders.slice(0, 40) : [];
  for (const o of list) {
    const id = Number(o?.id), token = String(o?.token ?? '');
    if (!Number.isSafeInteger(id) || id < 1 || !ORDER_TOKEN.test(token)) continue;
    const [rows] = await pool.execute('SELECT order_id FROM order_tracking WHERE order_id=? AND token_hash=? LIMIT 1', [id, hashTrackingToken(token)]);
    if (!rows.length) continue;
    await pool.execute('INSERT INTO customer_orders(account_id,order_id,token_enc) VALUES (?,?,?) ON DUPLICATE KEY UPDATE account_id=account_id', [account.id, id, seal(token, env)]);
  }
  const [mine] = await pool.execute('SELECT c.order_id,c.token_enc,r.name AS restaurant,r.slug,r.currency,o.total_minor,o.created_at FROM customer_orders c '
    + 'JOIN orders o ON o.id=c.order_id JOIN restaurants r ON r.id=o.restaurant_id WHERE c.account_id=? ORDER BY c.order_id DESC LIMIT 100', [account.id]);
  const orders = [];
  for (const row of mine) {
    try {
      const token = unseal(row.token_enc, env);
      if (!ORDER_TOKEN.test(token)) continue;
      const placed = row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at).replace(' ', 'T') + 'Z');
      orders.push({ id: Number(row.order_id), token, restaurant: row.restaurant, slug: row.slug, currency: row.currency, totalMinor: Number(row.total_minor), placedAt: Number.isNaN(placed.getTime()) ? null : placed.toISOString() });
    } catch { /* encryption key changed: skip */ }
  }
  return { status: 200, body: { orders } };
}

/** A booking made while signed in is added to the account. */
export async function linkBooking(pool, account, restaurantId, bookingId) {
  if (!account || !Number.isSafeInteger(Number(bookingId))) return;
  await ensureCustomerAccountTables(pool);
  await pool.execute('INSERT INTO customer_bookings(account_id,booking_id,restaurant_id) VALUES (?,?,?) ON DUPLICATE KEY UPDATE account_id=account_id', [account.id, bookingId, restaurantId]);
}

export async function listBookings(pool, account) {
  const [rows] = await pool.execute(
    "SELECT b.id,DATE_FORMAT(b.start_at,'%Y-%m-%d %H:%i') AS start_at,DATE_FORMAT(b.end_at,'%Y-%m-%d %H:%i') AS end_at,b.status," + 'b.guests,b.price_minor,r.name AS business,r.slug,r.currency,s.name AS service FROM customer_bookings c '
    + 'JOIN bookings b ON b.id=c.booking_id AND b.restaurant_id=c.restaurant_id JOIN restaurants r ON r.id=c.restaurant_id '
    + 'LEFT JOIN booking_services s ON s.id=b.service_id AND s.restaurant_id=b.restaurant_id WHERE c.account_id=? ORDER BY b.start_at DESC LIMIT 100', [account.id]);
  return { status: 200, body: { bookings: rows.map(r => ({ id: Number(r.id), business: r.business, url: /^[a-z0-9-]{1,160}$/.test(r.slug) ? '/r/' + r.slug : null,
    service: r.service || null, start_at: String(r.start_at), end_at: String(r.end_at), status: r.status, guests: Number(r.guests), price_minor: Number(r.price_minor), currency: r.currency })) } };
}
