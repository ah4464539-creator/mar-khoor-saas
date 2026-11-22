// Web Push for the restaurant dashboard app: "New order" alerts on the owner's phone, even when
// the app is closed. Implemented with Node's crypto (RFC 8291 aes128gcm payload encryption and
// RFC 8292 VAPID), so no extra package is needed. Keys live in app_settings (private key sealed).
// Additive table only. No express import.
import crypto from 'node:crypto';
import { seal, open as unseal } from './whatsapp-signup-core.js';
import { VOICE_SETTINGS_SQL } from './vapi-voice.js';

export const PUSH_SQL = `CREATE TABLE IF NOT EXISTS push_subscriptions (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 restaurant_id BIGINT UNSIGNED NOT NULL,
 user_id BIGINT UNSIGNED NULL,
 endpoint VARCHAR(700) NOT NULL,
 endpoint_hash CHAR(64) NOT NULL,
 p256dh VARCHAR(200) NOT NULL,
 auth VARCHAR(64) NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 last_ok_at TIMESTAMP NULL,
 UNIQUE KEY uq_push_endpoint (endpoint_hash),
 KEY ix_push_restaurant (restaurant_id),
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB`;

const b64u = buf => Buffer.from(buf).toString('base64url');
const unb64u = str => Buffer.from(String(str), 'base64url');

// Only real browser push services (no requests to arbitrary hosts).
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^[a-z0-9-]+\.push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /^[a-z0-9.-]+\.push\.apple\.com$/, /^[a-z0-9.-]+\.notify\.windows\.com$/];
export function validSubscription(sub) {
  try {
    const url = new URL(String(sub?.endpoint || ''));
    if (url.protocol !== 'https:' || url.port || url.username || !PUSH_HOSTS.some(re => re.test(url.hostname)) || url.href.length > 700) return null;
    const p256dh = unb64u(sub?.keys?.p256dh || ''), auth = unb64u(sub?.keys?.auth || '');
    if (p256dh.length !== 65 || p256dh[0] !== 4 || auth.length !== 16) return null;
    return { endpoint: url.href, p256dh: b64u(p256dh), auth: b64u(auth) };
  } catch { return null; }
}

/** VAPID key pair, created once and kept in app_settings. */
export async function vapidKeys(pool, env = process.env) {
  await pool.query(VOICE_SETTINGS_SQL);
  const [rows] = await pool.query("SELECT setting_value FROM app_settings WHERE setting_key='web_push_vapid'");
  if (rows[0]?.setting_value) {
    try { const v = JSON.parse(rows[0].setting_value); return { publicKey: v.publicKey, privateKey: unseal(v.privateKey, env) }; } catch { /* regenerate below */ }
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pub = publicKey.export({ format: 'jwk' }), priv = privateKey.export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from([4]), unb64u(pub.x), unb64u(pub.y)]);
  const value = { publicKey: b64u(raw), privateKey: priv.d };
  await pool.query("INSERT INTO app_settings (setting_key,setting_value) VALUES ('web_push_vapid',?) ON DUPLICATE KEY UPDATE setting_value=setting_value", [JSON.stringify({ publicKey: value.publicKey, privateKey: seal(value.privateKey, env) })]);
  // If two servers raced, use whatever was stored first.
  const [again] = await pool.query("SELECT setting_value FROM app_settings WHERE setting_key='web_push_vapid'");
  const stored = JSON.parse(again[0].setting_value);
  return { publicKey: stored.publicKey, privateKey: unseal(stored.privateKey, env) };
}

function privateKeyObject(publicKey, d) {
  const raw = unb64u(publicKey);
  return crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(raw.subarray(1, 33)), y: b64u(raw.subarray(33, 65)), d }, format: 'jwk' });
}
/** RFC 8292 VAPID Authorization header for one push service origin. */
export function vapidHeader(endpoint, keys, subject = 'mailto:support@mar-khoor.com', now = Date.now()) {
  const aud = new URL(endpoint).origin;
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject }));
  const sig = crypto.sign('sha256', Buffer.from(head + '.' + body), { key: privateKeyObject(keys.publicKey, keys.privateKey), dsaEncoding: 'ieee-p1363' });
  return 'vapid t=' + head + '.' + body + '.' + b64u(sig) + ', k=' + keys.publicKey;
}

/** RFC 8291 aes128gcm encryption of one push message. */
export function encryptPayload(payload, sub, { salt = crypto.randomBytes(16), ecdh = crypto.createECDH('prime256v1') } = {}) {
  if (!ecdh.getPublicKey) throw Error('bad ecdh');
  try { ecdh.getPrivateKey(); } catch { ecdh.generateKeys(); }
  const uaPublic = unb64u(sub.p256dh), authSecret = unb64u(sub.auth);
  const asPublic = ecdh.getPublicKey();
  const secret = ecdh.computeSecret(uaPublic);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', secret, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21); salt.copy(header, 0); header.writeUInt32BE(4096, 16); header[20] = 65;
  return Buffer.concat([header, asPublic, body]);
}

export async function saveSubscription(pool, restaurantId, userId, input) {
  const sub = validSubscription(input);
  if (!sub) return { status: 400, body: { error: 'This browser did not give a valid push subscription' } };
  await pool.query(PUSH_SQL);
  const hash = crypto.createHash('sha256').update(sub.endpoint).digest('hex');
  await pool.execute('INSERT INTO push_subscriptions(restaurant_id,user_id,endpoint,endpoint_hash,p256dh,auth) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE restaurant_id=VALUES(restaurant_id),user_id=VALUES(user_id),p256dh=VALUES(p256dh),auth=VALUES(auth)',
    [restaurantId, userId || null, sub.endpoint, hash, sub.p256dh, sub.auth]);
  const [[count]] = await pool.execute('SELECT COUNT(*) AS n FROM push_subscriptions WHERE restaurant_id=?', [restaurantId]);
  return { status: 200, body: { subscribed: true, devices: Number(count?.n || 1) } };
}
export async function removeSubscription(pool, restaurantId, endpoint) {
  await pool.query(PUSH_SQL);
  const hash = crypto.createHash('sha256').update(String(endpoint || '')).digest('hex');
  await pool.execute('DELETE FROM push_subscriptions WHERE endpoint_hash=? AND restaurant_id=?', [hash, restaurantId]);
  return { status: 200, body: { subscribed: false } };
}
export async function deviceCount(pool, restaurantId) {
  try { await pool.query(PUSH_SQL); const [[r]] = await pool.execute('SELECT COUNT(*) AS n FROM push_subscriptions WHERE restaurant_id=?', [restaurantId]); return Number(r?.n || 0); } catch { return 0; }
}

/** Sends a notification to every device of a restaurant. Removes dead subscriptions. Never throws. */
export async function pushToRestaurant(pool, restaurantId, message, { fetcher = fetch, env = process.env, log = console } = {}) {
  try {
    await pool.query(PUSH_SQL);
    const [subs] = await pool.execute('SELECT id,endpoint,p256dh,auth FROM push_subscriptions WHERE restaurant_id=? ORDER BY id DESC LIMIT 20', [restaurantId]);
    if (!subs.length) return { sent: 0 };
    const keys = await vapidKeys(pool, env);
    const payload = JSON.stringify({ title: String(message.title || 'Mar-Khoor').slice(0, 80), body: String(message.body || '').slice(0, 200), url: String(message.url || '/restaurant.html#order-desk').slice(0, 200), tag: String(message.tag || 'mk').slice(0, 64) });
    let sent = 0;
    await Promise.all(subs.map(async sub => {
      try {
        if (!validSubscription({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } })) return;
        const r = await fetcher(sub.endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), body: encryptPayload(payload, sub),
          headers: { TTL: '3600', Urgency: 'high', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', Authorization: vapidHeader(sub.endpoint, keys) } });
        if (r.status === 404 || r.status === 410) await pool.execute('DELETE FROM push_subscriptions WHERE id=?', [sub.id]);
        else if (r.ok) { sent++; await pool.execute('UPDATE push_subscriptions SET last_ok_at=CURRENT_TIMESTAMP WHERE id=?', [sub.id]); }
        else log.warn?.('Push failed (' + r.status + ') for restaurant #' + restaurantId);
      } catch (error) { log.warn?.('Push error for restaurant #' + restaurantId + ': ' + String(error.message).slice(0, 120)); }
    }));
    return { sent };
  } catch (error) { log.warn?.('Push unavailable: ' + String(error.message).slice(0, 120)); return { sent: 0 }; }
}

const money = (minor, currency) => (/^[A-Z]{3}$/.test(String(currency || '')) ? currency + ' ' : '') + (Number(minor) / 100).toLocaleString('en', { maximumFractionDigits: 2 });
/** "New order #123 · PKR 1,800 · WhatsApp" on every device of the restaurant. Fire and forget. */
export async function notifyNewOrder(pool, { restaurantId, orderId, totalMinor, currency, source }, options) {
  if (!currency) { try { const [r] = await pool.execute('SELECT currency FROM restaurants WHERE id=? LIMIT 1', [restaurantId]); currency = r[0]?.currency; } catch { currency = ''; } }
  return pushToRestaurant(pool, restaurantId, { title: '🛎️ New order #' + orderId, body: [money(totalMinor, currency), source].filter(Boolean).join(' · ') + ' — tap to open', url: '/restaurant.html#order-desk', tag: 'order-' + orderId }, options)
    .catch(() => ({ sent: 0 }));
}

// ---- Activity alerts (besides new orders): WhatsApp messages, AI calls, payment references ----
export const PREFS_SQL = `CREATE TABLE IF NOT EXISTS push_preferences (
 restaurant_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
 whatsapp TINYINT(1) NOT NULL DEFAULT 1,
 calls TINYINT(1) NOT NULL DEFAULT 1,
 payments TINYINT(1) NOT NULL DEFAULT 1,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB`;
export const ACTIVITY_KINDS = ['whatsapp', 'calls', 'payments'];
export async function getPreferences(pool, restaurantId) {
  const prefs = { whatsapp: true, calls: true, payments: true };
  try {
    await pool.query(PREFS_SQL);
    const [rows] = await pool.execute('SELECT whatsapp,calls,payments FROM push_preferences WHERE restaurant_id=? LIMIT 1', [restaurantId]);
    if (rows[0]) for (const k of ACTIVITY_KINDS) prefs[k] = Number(rows[0][k]) === 1;
  } catch { /* defaults */ }
  return prefs;
}
export async function savePreferences(pool, restaurantId, input) {
  const p = await getPreferences(pool, restaurantId);
  for (const k of ACTIVITY_KINDS) if (typeof input?.[k] === 'boolean') p[k] = input[k];
  await pool.query(PREFS_SQL);
  await pool.execute('INSERT INTO push_preferences(restaurant_id,whatsapp,calls,payments) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE whatsapp=VALUES(whatsapp),calls=VALUES(calls),payments=VALUES(payments)',
    [restaurantId, p.whatsapp ? 1 : 0, p.calls ? 1 : 0, p.payments ? 1 : 0]);
  return p;
}

// One WhatsApp alert per customer per 10 minutes, so a chat does not ring on every message.
const lastWhatsAppAlert = new Map();
export function shouldAlertWhatsApp(restaurantId, sender, now = Date.now()) {
  const key = restaurantId + '|' + sender, last = lastWhatsAppAlert.get(key);
  if (last && now - last < 10 * 60000) return false;
  if (lastWhatsAppAlert.size > 20000) lastWhatsAppAlert.clear();
  lastWhatsAppAlert.set(key, now);
  return true;
}
const masked = phone => { const d = String(phone || '').replace(/\D/g, ''); return d.length > 6 ? '+' + d.slice(0, 2) + ' ••• ' + d.slice(-4) : (d ? '+' + d : 'Customer'); };

/** Never throws; respects the restaurant's alert preferences. */
export async function notifyActivity(pool, restaurantId, kind, message, options) {
  try {
    if (!ACTIVITY_KINDS.includes(kind)) return { sent: 0 };
    const prefs = await getPreferences(pool, restaurantId);
    if (!prefs[kind]) return { sent: 0, reason: 'off' };
    return await pushToRestaurant(pool, restaurantId, message, options);
  } catch { return { sent: 0 }; }
}
export function notifyWhatsAppMessage(pool, { restaurantId, sender, type, text }, options) {
  if (type === 'interactive' || type === 'button' || !shouldAlertWhatsApp(restaurantId, sender)) return Promise.resolve({ sent: 0 });
  const preview = type === 'audio' ? '🎤 Voice note' : String(text || '').replace(/\s+/g, ' ').trim().slice(0, 90) || 'New message';
  return notifyActivity(pool, restaurantId, 'whatsapp', { title: '💬 WhatsApp · ' + masked(sender), body: preview, url: '/restaurant.html#whatsapp-inbox-view', tag: 'wa-' + String(sender).slice(-12) }, options);
}
export function notifyCallEnded(pool, { restaurantId, callId, reason }, options) {
  const missed = /no-answer|failed|error|busy/i.test(String(reason || ''));
  return notifyActivity(pool, restaurantId, 'calls', { title: missed ? '📞 AI call could not finish' : '📞 AI call finished', body: missed ? 'Reason: ' + String(reason).slice(0, 60) : 'Tap to see the call and any order it took.', url: '/restaurant.html#order-desk', tag: 'call-' + String(callId).slice(-24) }, options);
}
export async function notifyPaymentReference(pool, { orderId }, options) {
  try {
    const [rows] = await pool.execute('SELECT restaurant_id FROM orders WHERE id=? LIMIT 1', [orderId]);
    if (!rows.length) return { sent: 0 };
    return notifyActivity(pool, rows[0].restaurant_id, 'payments', { title: '💳 Payment reference received', body: 'Order #' + orderId + ' — check the transaction ID and confirm the payment.', url: '/restaurant.html#order-desk', tag: 'pay-' + orderId }, options);
  } catch { return { sent: 0 }; }
}
