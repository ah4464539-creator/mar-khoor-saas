// "Use your own number" for the AI Caller, in any country, without buying a number.
//
// The business keeps its own line: a spare SIM in a GSM gateway, a landline through a phone adapter
// (FXO gateway), or an office phone system / VoIP number (PBX, SIP trunk). Mar-Khoor creates a free SIP
// address on Vapi for the business's AI assistant, protected with its own username and password, and
// shows the settings to type into the device. Calls to the business number then reach the AI over the
// internet. Other numbers (a personal mobile) can forward to that line with the usual dial codes.
// The first call that arrives marks the line "connected".
//
// Additive table only (db/migrations/2026-11-27-own-line.sql); also created on first use.
import crypto from 'node:crypto';
import { seal, open } from './whatsapp-signup-core.js';
import { ensureAssistant } from './voice-autoprovision.js';
import { createSipLine, updateSipLine, deleteSipLine } from './providers/vapi-numbers.js';

export const OWN_LINE_SQL = `CREATE TABLE IF NOT EXISTS restaurant_own_lines (
 restaurant_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
 phone_number VARCHAR(20) NOT NULL,
 line_type VARCHAR(12) NOT NULL,
 sip_user VARCHAR(40) NOT NULL,
 sip_username VARCHAR(40) NOT NULL,
 sip_password_enc TEXT NOT NULL,
 vapi_phone_id VARCHAR(64) NULL,
 status VARCHAR(20) NOT NULL DEFAULT 'waiting_call',
 first_call_at TIMESTAMP NULL DEFAULT NULL,
 last_call_at TIMESTAMP NULL DEFAULT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uq_own_line_sip (sip_user),
 UNIQUE KEY uq_own_line_vapi (vapi_phone_id),
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB`;

const ready = new WeakMap();
export function ensureOwnLineTable(pool) {
  if (typeof pool?.query !== 'function') return Promise.resolve();
  if (!ready.has(pool)) ready.set(pool, Promise.resolve().then(() => pool.query(OWN_LINE_SQL)).catch(error => { ready.delete(pool); throw error; }));
  return ready.get(pool);
}

export const LINE_TYPES = Object.freeze({
  sim: 'Spare SIM in a GSM gateway',
  landline: 'Landline through a phone adapter (FXO gateway)',
  pbx: 'Office phone system or VoIP number (PBX / SIP trunk)',
});
export const SIP_SERVER = 'sip.vapi.ai';

/** "+923001234567" style international number, or null. */
export function normalizeLineNumber(value) {
  const raw = String(value ?? '').trim();
  const digits = raw.replace(/[\s().-]/g, '').replace(/^00/, '+');
  return /^\+[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

// Letters and digits only (some gateways reject symbols). Vapi wants 20-40 characters.
const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function randomToken(length, random = crypto.randomBytes) {
  const bytes = random(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}
export function newCredentials(restaurantId, random = crypto.randomBytes) {
  const id = String(restaurantId);
  return {
    sipUser: ('mk' + id + 'line' + randomToken(10, random).toLowerCase()).slice(0, 40),
    username: ('mk' + id + 'u' + randomToken(24, random)).slice(0, 32),
    password: randomToken(32, random),
  };
}

/** What the owner types into the gateway / phone system. */
export function deviceSettings(row, password) {
  return {
    sip_server: SIP_SERVER,
    port: '5060 (UDP or TCP), or 5061 for TLS',
    username: row.sip_username,
    password,
    destination: row.sip_user,
    sip_uri: 'sip:' + row.sip_user + '@' + SIP_SERVER,
  };
}

/** Standard GSM forwarding codes (most countries). Some US carriers use *72 instead. */
export function forwardingCodes(target) {
  const to = normalizeLineNumber(target);
  if (!to) return null;
  return { all: '**21*' + to + '#', busy: '**67*' + to + '#', no_answer: '**61*' + to + '#', unreachable: '**62*' + to + '#', off: '##21#', us_alternative: '*72' + to.replace(/^\+1/, '') };
}

export async function getOwnLine(pool, restaurantId) {
  await ensureOwnLineTable(pool);
  const [rows] = await pool.execute('SELECT restaurant_id,phone_number,line_type,sip_user,sip_username,sip_password_enc,vapi_phone_id,status,first_call_at,last_call_at FROM restaurant_own_lines WHERE restaurant_id=? LIMIT 1', [restaurantId]);
  return rows[0] || null;
}

/** Public view for the owner (includes the device password: owners need it to set up their gateway). */
export function ownLineView(row, env = process.env) {
  if (!row) return null;
  let password = null;
  try { password = open(row.sip_password_enc, env); } catch { password = null; }
  return {
    phone_number: row.phone_number, line_type: row.line_type, line_type_label: LINE_TYPES[row.line_type] || row.line_type,
    status: row.status, first_call_at: row.first_call_at, last_call_at: row.last_call_at,
    settings: deviceSettings(row, password), forwarding: forwardingCodes(row.phone_number),
  };
}

export function ownLineConfig(env = process.env) {
  const missing = ['VAPI_API_KEY', 'VAPI_TEMPLATE_ASSISTANT_ID'].filter(name => !env[name]);
  if (!env.DATA_ENCRYPTION_KEY && !env.META_APP_SECRET) missing.push('DATA_ENCRYPTION_KEY');
  return { ready: missing.length === 0, missing, vapiKey: env.VAPI_API_KEY, templateAssistantId: env.VAPI_TEMPLATE_ASSISTANT_ID };
}

/**
 * Connects (or updates) a business's own line. Creates the restaurant's AI assistant if it has none,
 * then a password-protected SIP address on Vapi for it. Changing only the number or type keeps the
 * same SIP address and password, so a configured gateway keeps working.
 */
export async function connectOwnLine(pool, restaurantId, body, { env = process.env, fetcher = fetch } = {}) {
  const phone = normalizeLineNumber(body?.phone_number);
  const type = String(body?.line_type || '');
  if (!phone) return { status: 400, body: { error: 'Enter the number with its country code, e.g. +923001234567 or +971501234567' } };
  if (!LINE_TYPES[type]) return { status: 400, body: { error: 'Choose how the number is connected' } };
  const config = ownLineConfig(env);
  if (!config.ready) return { status: 503, body: { error: 'Own-number connection is not set up on the server yet (' + config.missing.join(', ') + ').' } };
  const [restaurants] = await pool.execute('SELECT id,name,country_code FROM restaurants WHERE id=? LIMIT 1', [restaurantId]);
  if (!restaurants.length) return { status: 404, body: { error: 'Business not found' } };
  const deps = { vapiKey: config.vapiKey, templateAssistantId: config.templateAssistantId, fetcher };
  let assistantId;
  try { assistantId = await ensureAssistant(pool, restaurants[0], deps); }
  catch (error) { return { status: error.needsReview ? 409 : 502, body: { error: 'Could not prepare your AI assistant: ' + String(error.message).slice(0, 160) } }; }

  const existing = await getOwnLine(pool, restaurantId);
  if (existing?.vapi_phone_id) {
    // Same SIP address: just point it at the current assistant and save the new number / type.
    await updateSipLine({ apiKey: config.vapiKey, id: existing.vapi_phone_id, assistantId, fetcher });
    await pool.execute('UPDATE restaurant_own_lines SET phone_number=?,line_type=? WHERE restaurant_id=?', [phone, type, restaurantId]);
    return { status: 200, body: { line: ownLineView(await getOwnLine(pool, restaurantId), env) } };
  }
  const creds = newCredentials(restaurantId);
  const sealed = seal(creds.password, env);
  // Saved first (without the Vapi id) so a retry after a timeout never creates a second address.
  await pool.execute(
    "INSERT INTO restaurant_own_lines(restaurant_id,phone_number,line_type,sip_user,sip_username,sip_password_enc,status) VALUES (?,?,?,?,?,?,'creating') "
    + "ON DUPLICATE KEY UPDATE phone_number=VALUES(phone_number),line_type=VALUES(line_type),sip_user=VALUES(sip_user),sip_username=VALUES(sip_username),sip_password_enc=VALUES(sip_password_enc),status='creating'",
    [restaurantId, phone, type, creds.sipUser, creds.username, sealed]);
  let created;
  try { created = await createSipLine({ apiKey: config.vapiKey, sipUser: creds.sipUser, username: creds.username, password: creds.password, assistantId, name: 'MarKhoor ' + restaurantId + ' own line', fetcher }); }
  catch (error) {
    await pool.execute("UPDATE restaurant_own_lines SET status='failed' WHERE restaurant_id=?", [restaurantId]).catch(() => {});
    return { status: 502, body: { error: 'Could not create the AI line: ' + String(error.message).slice(0, 160) } };
  }
  await pool.execute("UPDATE restaurant_own_lines SET vapi_phone_id=?,status='waiting_call' WHERE restaurant_id=?", [created.id, restaurantId]);
  return { status: 201, body: { line: ownLineView(await getOwnLine(pool, restaurantId), env) } };
}

/** New device password (e.g. it was shared by mistake). The username stays the same, so only the
 *  password has to be changed on the device afterwards. */
export async function resetOwnLinePassword(pool, restaurantId, { env = process.env, fetcher = fetch } = {}) {
  const row = await getOwnLine(pool, restaurantId);
  if (!row?.vapi_phone_id) return { status: 404, body: { error: 'No own line connected' } };
  const config = ownLineConfig(env);
  if (!config.ready) return { status: 503, body: { error: 'Not set up on the server' } };
  const username = row.sip_username;
  const { password } = newCredentials(restaurantId);
  await updateSipLine({ apiKey: config.vapiKey, id: row.vapi_phone_id, username, password, fetcher });
  await pool.execute("UPDATE restaurant_own_lines SET sip_password_enc=?,status='waiting_call' WHERE restaurant_id=?", [seal(password, env), restaurantId]);
  return { status: 200, body: { line: ownLineView(await getOwnLine(pool, restaurantId), env) } };
}

export async function removeOwnLine(pool, restaurantId, { env = process.env, fetcher = fetch } = {}) {
  const row = await getOwnLine(pool, restaurantId);
  if (!row) return { status: 200, body: { removed: false } };
  if (row.vapi_phone_id) {
    const config = ownLineConfig(env);
    if (!config.vapiKey) return { status: 503, body: { error: 'Not set up on the server' } };
    await deleteSipLine({ apiKey: config.vapiKey, id: row.vapi_phone_id, fetcher });
  }
  await pool.execute('DELETE FROM restaurant_own_lines WHERE restaurant_id=?', [restaurantId]);
  return { status: 200, body: { removed: true } };
}

/** Called for every Vapi call event: a call on the line proves the gateway works. Never throws. */
export async function markOwnLineCall(pool, restaurantId, phoneNumberId) {
  if (typeof phoneNumberId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(phoneNumberId)) return false;
  try {
    const [result] = await pool.execute("UPDATE restaurant_own_lines SET status='connected',first_call_at=COALESCE(first_call_at,NOW()),last_call_at=NOW() WHERE restaurant_id=? AND vapi_phone_id=?", [restaurantId, phoneNumberId]);
    return result.affectedRows > 0;
  } catch { return false; }
}
