// WhatsApp Embedded Signup (Tech Provider flow): a restaurant clicks "Connect WhatsApp", finishes
// Meta's popup, and the server exchanges the code, subscribes the WABA, registers the number,
// keeps the customer's business token (encrypted) and links the number to the restaurant.
import crypto from 'node:crypto';
import { VOICE_SETTINGS_SQL } from './vapi-voice.js';

export const SIGNUP_SQL = `CREATE TABLE IF NOT EXISTS whatsapp_business_tokens (
 phone_number_id VARCHAR(64) NOT NULL PRIMARY KEY,
 restaurant_id BIGINT UNSIGNED NOT NULL,
 waba_id VARCHAR(64) NOT NULL,
 token_enc TEXT NOT NULL,
 pin_enc VARCHAR(255) NULL,
 display_phone_number VARCHAR(40) NULL,
 verified_name VARCHAR(200) NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 KEY idx_wbt_restaurant (restaurant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

const CONFIG_KEY = 'whatsapp_signup';
const ID = /^[0-9]{5,64}$/;

export const graphVersion = (env = process.env) => /^v\d{1,2}\.\d{1,2}$/.test(env.WHATSAPP_GRAPH_VERSION || '') ? env.WHATSAPP_GRAPH_VERSION : 'v23.0';

// Tokens are encrypted with DATA_ENCRYPTION_KEY, or a key derived from META_APP_SECRET.
function key(env = process.env) {
  const base = env.DATA_ENCRYPTION_KEY || env.META_APP_SECRET;
  if (!base) throw Error('No encryption key');
  return crypto.createHash('sha256').update('mk-whatsapp-token:' + base).digest();
}
export function seal(text, env = process.env) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(env), iv);
  const body = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join(':');
}
export function open(sealed, env = process.env) {
  const [v, iv, tag, body] = String(sealed || '').split(':');
  if (v !== 'v1') throw Error('Unknown token format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(env), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8');
}

/** Public (non-secret) launch settings, saved by the super admin. */
export async function getSignupConfig(pool) {
  try {
    const [rows] = await pool.query('SELECT setting_value FROM app_settings WHERE setting_key=?', [CONFIG_KEY]);
    const c = JSON.parse(rows[0]?.setting_value || '{}');
    return { app_id: ID.test(c.app_id || '') ? c.app_id : '', config_id: ID.test(c.config_id || '') ? c.config_id : '' };
  } catch { return { app_id: '', config_id: '' }; }
}
export async function saveSignupConfig(pool, { app_id, config_id }) {
  if (!ID.test(String(app_id || '')) || !ID.test(String(config_id || ''))) throw Object.assign(Error('App ID and Configuration ID must be numbers'), { status: 400 });
  await pool.query(VOICE_SETTINGS_SQL);
  await pool.query('INSERT INTO app_settings (setting_key,setting_value) VALUES (?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)', [CONFIG_KEY, JSON.stringify({ app_id: String(app_id), config_id: String(config_id) })]);
  return getSignupConfig(pool);
}

async function graph(fetcher, url, options = {}) {
  const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(15000), ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = String(data?.error?.error_user_msg || data?.error?.message || ('Meta ' + response.status)).slice(0, 240);
    throw Object.assign(Error(message), { status: 502 });
  }
  return data;
}

/**
 * Finish onboarding for one restaurant. Steps follow Meta's Tech Provider guide:
 * exchange code → subscribe WABA → register number (PIN) → read number → save.
 */
export async function completeSignup(pool, restaurantId, { code, waba_id, phone_number_id }, { env = process.env, fetcher = fetch, config } = {}) {
  if (typeof code !== 'string' || code.length < 10 || code.length > 2048 || !ID.test(String(waba_id || '')) || !ID.test(String(phone_number_id || ''))) {
    throw Object.assign(Error('Signup did not return the WhatsApp details. Please try again.'), { status: 400 });
  }
  const settings = config || await getSignupConfig(pool);
  if (!settings.app_id || !env.META_APP_SECRET) throw Object.assign(Error('WhatsApp signup is not configured yet'), { status: 503 });
  const v = graphVersion(env), base = 'https://graph.facebook.com/' + v + '/';

  // The same number may not be linked to another restaurant.
  const [taken] = await pool.execute('SELECT restaurant_id FROM whatsapp_numbers WHERE phone_number_id=? LIMIT 1', [phone_number_id]);
  if (taken.length && Number(taken[0].restaurant_id) !== Number(restaurantId)) throw Object.assign(Error('This WhatsApp number is already connected to another restaurant.'), { status: 409 });

  // Meta answers {"access_token": "..."}; accept a bare token string as well.
  const exchangeResponse = await fetcher(base + 'oauth/access_token?' + new URLSearchParams({ client_id: settings.app_id, client_secret: env.META_APP_SECRET, code }), { redirect: 'error', signal: AbortSignal.timeout(15000) });
  const raw = await exchangeResponse.text();
  let exchange = null; try { exchange = JSON.parse(raw); } catch {}
  if (!exchangeResponse.ok) throw Object.assign(Error(String(exchange?.error?.message || 'Meta could not confirm the signup (code expired?). Please try again.').slice(0, 240)), { status: 502 });
  const token = typeof exchange?.access_token === 'string' ? exchange.access_token : (/^[A-Za-z0-9_-]{20,}$/.test(raw.trim()) ? raw.trim() : null);
  if (typeof token !== 'string' || token.length < 20) throw Object.assign(Error('Meta did not return an access token'), { status: 502 });
  const auth = { Authorization: 'Bearer ' + token };

  await graph(fetcher, base + waba_id + '/subscribed_apps', { method: 'POST', headers: auth });

  const pin = String(crypto.randomInt(100000, 1000000));
  let registered = true, registerError = null;
  try {
    await graph(fetcher, base + phone_number_id + '/register', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', pin }) });
  } catch (error) { registered = false; registerError = error.message; }

  let number = {};
  try { number = await graph(fetcher, base + phone_number_id + '?fields=display_phone_number,verified_name', { headers: auth }); } catch {}

  await pool.query(SIGNUP_SQL);
  await pool.execute(
    'INSERT INTO whatsapp_business_tokens(phone_number_id,restaurant_id,waba_id,token_enc,pin_enc,display_phone_number,verified_name) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE restaurant_id=VALUES(restaurant_id),waba_id=VALUES(waba_id),token_enc=VALUES(token_enc),pin_enc=IF(?,VALUES(pin_enc),pin_enc),display_phone_number=VALUES(display_phone_number),verified_name=VALUES(verified_name)',
    [phone_number_id, restaurantId, waba_id, seal(token, env), registered ? seal(pin, env) : null, String(number.display_phone_number || '').slice(0, 40) || null, String(number.verified_name || '').slice(0, 200) || null, registered]
  );
  await pool.execute('INSERT INTO whatsapp_numbers(phone_number_id,restaurant_id,active) VALUES (?,?,1) ON DUPLICATE KEY UPDATE restaurant_id=VALUES(restaurant_id),active=1', [phone_number_id, restaurantId]);
  await pool.execute('INSERT INTO whatsapp_ai_settings(restaurant_id,enabled) VALUES (?,TRUE) ON DUPLICATE KEY UPDATE enabled=TRUE', [restaurantId]);
  return { connected: true, registered, register_error: registerError, display_phone_number: number.display_phone_number || null, verified_name: number.verified_name || null };
}

/** The token to send with for a phone number: the restaurant's own business token, else the platform token. */
export async function tokenForNumber(pool, phoneNumberId, env = process.env) {
  try {
    const [rows] = await pool.execute('SELECT token_enc FROM whatsapp_business_tokens WHERE phone_number_id=? LIMIT 1', [phoneNumberId]);
    if (rows.length) return open(rows[0].token_enc, env);
  } catch { /* table missing or key changed: fall back */ }
  return env.WHATSAPP_ACCESS_TOKEN || null;
}

export async function connectionStatus(pool, restaurantId) {
  try {
    const [rows] = await pool.execute('SELECT phone_number_id,display_phone_number,verified_name,created_at FROM whatsapp_business_tokens WHERE restaurant_id=? ORDER BY updated_at DESC LIMIT 5', [restaurantId]);
    return rows.map(r => ({ phone_number_id: r.phone_number_id, display_phone_number: r.display_phone_number, verified_name: r.verified_name, connected_at: r.created_at }));
  } catch { return []; }
}
