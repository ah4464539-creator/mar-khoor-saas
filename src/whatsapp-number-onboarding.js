// "Number + code" WhatsApp activation: the restaurant types its number, Meta sends a code by SMS or
// call, the restaurant types the code, and the number is registered on Mar-Khoor's WhatsApp
// Business Account and linked to the restaurant (AI replies on). No Facebook login needed.
//
// Meta rules that still apply (shown to owners): the number must not be active in the WhatsApp or
// WhatsApp Business app; the display name is reviewed by Meta; an unverified business can have
// only a couple of numbers. Additive table only. No express import.
import crypto from 'node:crypto';
import { seal, graphVersion } from './whatsapp-signup-core.js';

export const ONBOARDING_SQL = `CREATE TABLE IF NOT EXISTS whatsapp_number_onboarding (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 restaurant_id BIGINT UNSIGNED NOT NULL,
 phone_number_id VARCHAR(64) NOT NULL,
 waba_id VARCHAR(64) NOT NULL,
 display_phone VARCHAR(40) NOT NULL,
 display_name VARCHAR(200) NOT NULL,
 status ENUM('code_sent','verified','registered','failed') NOT NULL DEFAULT 'code_sent',
 pin_enc VARCHAR(255) NULL,
 attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
 last_error VARCHAR(255) NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uq_wno_number (phone_number_id),
 KEY ix_wno_restaurant (restaurant_id, status),
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB`;

// ITU country calling codes are prefix-free: +1 and +7 are one digit, these are two digits,
// everything else is three digits.
const TWO_DIGIT = new Set(['20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44', '45', '46', '47', '48', '49', '51', '52', '53', '54', '55', '56', '57', '58', '60', '61', '62', '63', '64', '65', '66', '81', '82', '84', '86', '90', '91', '92', '93', '94', '95', '98']);
/** "+92 300 1234567" -> { cc: '92', number: '3001234567', e164: '+923001234567' } or null. */
export function splitPhone(value) {
  const raw = String(value || '').trim();
  if (!/^\+?[0-9 ()-]{8,32}$/.test(raw)) return null;
  let digits = raw.replace(/\D/g, '');
  if (raw.startsWith('00')) digits = digits.slice(2);
  if (digits.length < 8 || digits.length > 15) return null;
  const len = digits[0] === '1' || digits[0] === '7' ? 1 : TWO_DIGIT.has(digits.slice(0, 2)) ? 2 : 3;
  const cc = digits.slice(0, len), number = digits.slice(len).replace(/^0+/, '');
  if (number.length < 6) return null;
  return { cc, number, e164: '+' + cc + number };
}

/** Display names Meta is likely to accept: 3-120 chars, no links, not just a number, no "WhatsApp". */
export function cleanDisplayName(value) {
  const name = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (name.length < 3) return { error: 'Enter your restaurant name as customers should see it (at least 3 letters)' };
  if (/https?:|www\.|\.com\b/i.test(name)) return { error: 'The display name cannot contain a web address' };
  if (/whats\s*app/i.test(name)) return { error: 'The display name cannot contain the word WhatsApp' };
  if (!/\p{L}/u.test(name)) return { error: 'The display name needs letters, not only numbers' };
  return { value: name };
}

async function graph(fetcher, url, { method = 'GET', token, body } = {}) {
  const r = await fetcher(url, { method, redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(Error(friendly(data?.error)), { status: 502, meta: data?.error });
  return data;
}
// Meta's messages, said plainly for restaurant owners.
export function friendly(error) {
  const msg = String(error?.error_user_msg || error?.message || 'Meta did not accept the request');
  const code = Number(error?.code), sub = Number(error?.error_subcode);
  if (/already.*(registered|in use|exists)|account.*exists/i.test(msg) || sub === 2388001) return 'This number is still active on WhatsApp. Open WhatsApp on that phone → Settings → Account → Delete account (or use a new SIM), then try again.';
  if (/limit|maximum number of phone numbers/i.test(msg)) return 'Mar-Khoor has reached Meta\'s limit of WhatsApp numbers for now. Our team has been told; please try again later.';
  if (/code.*(invalid|incorrect|expired)|verification code/i.test(msg) || code === 136025) return 'That code is not correct or has expired. Check the SMS/call and try again, or ask for a new code.';
  if (/too many|rate/i.test(msg) || code === 136024) return 'Too many code requests. Please wait a few minutes and try again.';
  if (/display name|verified_name/i.test(msg)) return 'Meta did not accept this display name. Use your restaurant name exactly as on your signboard.';
  return msg.slice(0, 220);
}

/** Mar-Khoor's own WhatsApp Business Account: WHATSAPP_WABA_ID, else the one the platform token can manage. */
export async function platformWaba({ env = process.env, fetcher = fetch } = {}) {
  if (/^[0-9]{5,64}$/.test(env.WHATSAPP_WABA_ID || '')) return env.WHATSAPP_WABA_ID;
  const token = env.WHATSAPP_ACCESS_TOKEN;
  if (!token) return null;
  try {
    const data = await graph(fetcher, 'https://graph.facebook.com/' + graphVersion(env) + '/debug_token?' + new URLSearchParams({ input_token: token }), { token });
    const scope = (data?.data?.granular_scopes || []).find(s => s.scope === 'whatsapp_business_management');
    const ids = (scope?.target_ids || []).filter(id => /^[0-9]{5,64}$/.test(id));
    return ids.length === 1 ? ids[0] : (ids[0] || null);
  } catch { return null; }
}

const base = env => 'https://graph.facebook.com/' + graphVersion(env) + '/';

/** Step 1: add the number to Mar-Khoor's WABA (or find it there) and ask Meta to send a code. */
export async function startNumber(pool, restaurantId, input, { env = process.env, fetcher = fetch } = {}) {
  const phone = splitPhone(input?.phone);
  if (!phone) return { status: 400, body: { error: 'Enter the full number with country code, e.g. +92 300 1234567' } };
  const name = cleanDisplayName(input?.display_name);
  if (name.error) return { status: 400, body: { error: name.error } };
  const method = input?.method === 'VOICE' ? 'VOICE' : 'SMS';
  const token = env.WHATSAPP_ACCESS_TOKEN;
  if (!token) return { status: 503, body: { error: 'WhatsApp is not set up on the server yet' } };
  const waba = await platformWaba({ env, fetcher });
  if (!waba) return { status: 503, body: { error: 'Mar-Khoor WhatsApp account not found. Please contact support.' } };
  await pool.query(ONBOARDING_SQL);
  try {
    // Already connected somewhere?
    const [mapped] = await pool.execute('SELECT w.restaurant_id FROM whatsapp_numbers w JOIN whatsapp_number_onboarding o ON o.phone_number_id=w.phone_number_id WHERE o.display_phone=? AND w.active=1 LIMIT 1', [phone.e164]);
    if (mapped.length && Number(mapped[0].restaurant_id) !== Number(restaurantId)) return { status: 409, body: { error: 'This number is already connected to another restaurant.' } };
    let phoneNumberId = null;
    try {
      const added = await graph(fetcher, base(env) + waba + '/phone_numbers', { method: 'POST', token, body: { cc: phone.cc, phone_number: phone.number, verified_name: name.value } });
      phoneNumberId = String(added?.id || '');
    } catch (error) {
      // The number may already be in our WABA (an earlier attempt): find it and continue.
      const list = await graph(fetcher, base(env) + waba + '/phone_numbers?fields=id,display_phone_number&limit=100', { token }).catch(() => null);
      const found = (list?.data || []).find(n => String(n.display_phone_number || '').replace(/\D/g, '') === phone.cc + phone.number);
      if (!found) throw error;
      phoneNumberId = String(found.id);
    }
    if (!/^[0-9]{5,64}$/.test(phoneNumberId)) throw Object.assign(Error('Meta did not return the number ID'), { status: 502 });
    const [other] = await pool.execute('SELECT restaurant_id FROM whatsapp_numbers WHERE phone_number_id=? AND active=1 LIMIT 1', [phoneNumberId]);
    if (other.length && Number(other[0].restaurant_id) !== Number(restaurantId)) return { status: 409, body: { error: 'This number is already connected to another restaurant.' } };
    await graph(fetcher, base(env) + phoneNumberId + '/request_code', { method: 'POST', token, body: { code_method: method, language: 'en_US' } });
    await pool.execute('INSERT INTO whatsapp_number_onboarding(restaurant_id,phone_number_id,waba_id,display_phone,display_name,status,attempts,last_error) VALUES (?,?,?,?,?,\'code_sent\',0,NULL) ON DUPLICATE KEY UPDATE restaurant_id=VALUES(restaurant_id),waba_id=VALUES(waba_id),display_phone=VALUES(display_phone),display_name=VALUES(display_name),status=IF(status=\'registered\',status,\'code_sent\'),attempts=0,last_error=NULL',
      [restaurantId, phoneNumberId, waba, phone.e164, name.value]);
    return { status: 200, body: { step: 'code_sent', phone: phone.e164, method } };
  } catch (error) {
    return { status: error.status || 502, body: { error: error.status ? error.message : 'Could not reach Meta. Please try again.' } };
  }
}

/** Step 2: check the code, register the number (with a PIN we keep encrypted) and link it. */
export async function verifyNumber(pool, restaurantId, input, { env = process.env, fetcher = fetch } = {}) {
  const code = String(input?.code || '').replace(/\D/g, '');
  if (!/^[0-9]{6}$/.test(code)) return { status: 400, body: { error: 'Enter the 6-digit code from the SMS or call' } };
  const token = env.WHATSAPP_ACCESS_TOKEN;
  if (!token) return { status: 503, body: { error: 'WhatsApp is not set up on the server yet' } };
  await pool.query(ONBOARDING_SQL);
  const [rows] = await pool.execute("SELECT id,phone_number_id,display_phone,display_name,status,attempts FROM whatsapp_number_onboarding WHERE restaurant_id=? AND status IN ('code_sent','verified') ORDER BY updated_at DESC LIMIT 1", [restaurantId]);
  if (!rows.length) return { status: 404, body: { error: 'Ask for a code first' } };
  const row = rows[0];
  if (Number(row.attempts) >= 5) return { status: 429, body: { error: 'Too many wrong codes. Ask for a new code.' } };
  try {
    if (row.status === 'code_sent') {
      try { await graph(fetcher, base(env) + row.phone_number_id + '/verify_code', { method: 'POST', token, body: { code } }); }
      catch (error) { await pool.execute('UPDATE whatsapp_number_onboarding SET attempts=attempts+1,last_error=? WHERE id=?', [String(error.message).slice(0, 255), row.id]); throw error; }
      await pool.execute("UPDATE whatsapp_number_onboarding SET status='verified' WHERE id=?", [row.id]);
    }
    const pin = String(crypto.randomInt(100000, 1000000));
    await graph(fetcher, base(env) + row.phone_number_id + '/register', { method: 'POST', token, body: { messaging_product: 'whatsapp', pin } });
    let pinEnc = null; try { pinEnc = seal(pin, env); } catch { pinEnc = null; }
    await pool.execute("UPDATE whatsapp_number_onboarding SET status='registered',pin_enc=?,last_error=NULL WHERE id=?", [pinEnc, row.id]);
    await pool.execute('INSERT INTO whatsapp_numbers(phone_number_id,restaurant_id,active) VALUES (?,?,1) ON DUPLICATE KEY UPDATE restaurant_id=VALUES(restaurant_id),active=1', [row.phone_number_id, restaurantId]);
    await pool.execute('INSERT INTO whatsapp_ai_settings(restaurant_id,enabled) VALUES (?,TRUE) ON DUPLICATE KEY UPDATE enabled=TRUE', [restaurantId]);
    return { status: 200, body: { connected: true, phone: row.display_phone, display_name: row.display_name, phone_number_id: row.phone_number_id } };
  } catch (error) {
    return { status: error.status || 502, body: { error: error.status ? error.message : 'Could not reach Meta. Please try again.' } };
  }
}

/** What the owner's screen should show. */
export async function onboardingStatus(pool, restaurantId) {
  try {
    await pool.query(ONBOARDING_SQL);
    const [rows] = await pool.execute('SELECT display_phone,display_name,status,updated_at FROM whatsapp_number_onboarding WHERE restaurant_id=? ORDER BY updated_at DESC LIMIT 1', [restaurantId]);
    return rows[0] ? { phone: rows[0].display_phone, display_name: rows[0].display_name, status: rows[0].status } : null;
  } catch { return null; }
}
