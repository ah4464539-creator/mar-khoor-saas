// WhatsApp Business Calling pilot: a customer taps "call" in the restaurant's WhatsApp chat and
// the restaurant's own Vapi voice assistant answers. No media server of ours is involved:
//   Meta (SIP over TLS, SDES-SRTP) -> <vapi credential id>.sip.vapi.ai -> the restaurant's assistant.
// Steps (all reversible with disableCalling):
//   1. Vapi "byo-sip-trunk" credential that accepts calls from Meta (wa.meta.vc).
//   2. Vapi "byo-phone-number" with the WhatsApp number, attached to the restaurant's assistant.
//   3. Meta calling settings on the number: calling ON, SIP server = the Vapi credential host.
// State is kept in the additive app_settings table (key whatsapp_calling). No express import.
import { VOICE_SETTINGS_SQL, femaleVoice } from './vapi-voice.js';
import { tokenForNumber } from './whatsapp-signup-core.js';
import { cloneAssistant } from './providers/vapi-assistants.js';
import { promises as dns } from 'node:dns';

// Vapi only accepts inbound calls from numeric IPv4 gateways. Meta's SIP servers sit in its own
// ranges (wa.meta.vc resolves to e.g. 57.144.x.x), so each resolved address is allowed with its /16.
const KNOWN_META_SIP_IPS = ['57.144.153.157'];
export async function metaSipNetworks({ resolve4 = host => dns.resolve4(host) } = {}) {
  let ips = [];
  try { ips = await resolve4(META_SIP_HOST); } catch { /* DNS unavailable: use known address */ }
  const nets = new Set([...ips, ...KNOWN_META_SIP_IPS].filter(ip => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)).map(ip => ip.split('.').slice(0, 2).join('.') + '.0.0'));
  return [...nets].slice(0, 10);
}

const KEY = 'whatsapp_calling';
const VAPI = 'https://api.vapi.ai';
const META_SIP_HOST = 'wa.meta.vc';
const graphVersion = env => (/^v\d+\.\d+$/.test(env.WHATSAPP_GRAPH_VERSION || '') ? env.WHATSAPP_GRAPH_VERSION : 'v23.0');
const errorText = (data, fallback) => String(data?.error?.message || data?.message || fallback).slice(0, 300);

async function call(fetcher, url, { method = 'GET', token, body } = {}) {
  const response = await fetcher(url, {
    method, redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  try { data = await response.json(); } catch { /* empty body */ }
  return { ok: response.ok, status: response.status, data };
}

export async function getCallingState(pool) {
  try {
    const [rows] = await pool.query('SELECT setting_value FROM app_settings WHERE setting_key=?', [KEY]);
    const value = JSON.parse(rows[0]?.setting_value || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}
async function saveCallingState(pool, state) {
  await pool.query(VOICE_SETTINGS_SQL);
  await pool.query('INSERT INTO app_settings (setting_key,setting_value) VALUES (?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)', [KEY, JSON.stringify(state)]);
}

/** Meta settings body that sends the number's WhatsApp calls to a SIP host. */
export function metaCallingSettings(sipHost) {
  return { calling: { status: 'ENABLED', call_icon_visibility: 'DEFAULT', srtp_key_exchange_protocol: 'SDES',
    sip: { status: 'ENABLED', servers: [{ hostname: sipHost, port: 5061 }] } } };
}
export const vapiSipHost = credentialId => credentialId + '.sip.vapi.ai';

async function restaurantNumber(pool, restaurantId) {
  const [rows] = await pool.execute('SELECT phone_number_id FROM whatsapp_numbers WHERE restaurant_id=? AND active=1 ORDER BY phone_number_id LIMIT 1', [restaurantId]);
  return rows[0]?.phone_number_id ? String(rows[0].phone_number_id) : null;
}

async function ensureAssistant(pool, restaurantId, { env, fetcher }) {
  const [rows] = await pool.execute('SELECT assistant_id FROM voice_assistants WHERE restaurant_id=? AND active=1 LIMIT 1', [restaurantId]);
  if (rows.length) return rows[0].assistant_id;
  if (!env.VAPI_TEMPLATE_ASSISTANT_ID) throw Object.assign(Error('This restaurant has no voice assistant and VAPI_TEMPLATE_ASSISTANT_ID is not set'), { status: 409 });
  const [restaurants] = await pool.execute('SELECT id,name,country_code FROM restaurants WHERE id=? LIMIT 1', [restaurantId]);
  const r = restaurants[0];
  const created = await cloneAssistant({ apiKey: env.VAPI_API_KEY, templateId: env.VAPI_TEMPLATE_ASSISTANT_ID, name: 'MarKhoor ' + r.id + ' ' + r.name,
    restaurantId: r.id, restaurantName: r.name, voice: femaleVoice(r.country_code), fetcher });
  await pool.execute('INSERT INTO voice_assistants(assistant_id,restaurant_id,active) VALUES (?,?,TRUE)', [created.id, restaurantId]);
  return created.id;
}

async function createCredential(fetcher, apiKey, restaurantId, networks) {
  const name = ('WhatsApp calls ' + restaurantId).slice(0, 40);
  // Widest range Vapi accepts first; fall back to narrower ones if it refuses the netmask.
  const attempts = [16, 24, null];
  let result;
  for (const netmask of attempts) {
    const gateways = networks.map(ip => ({ ip, inboundEnabled: true, outboundEnabled: false, ...(netmask ? { netmask } : {}) }));
    result = await call(fetcher, VAPI + '/credential', { method: 'POST', token: apiKey, body: { provider: 'byo-sip-trunk', name, gateways } });
    if (result.ok && typeof result.data?.id === 'string') return result.data.id;
    if (!(result.status === 400 && /netmask/i.test(JSON.stringify(result.data || '')))) break;
  }
  throw Object.assign(Error('Vapi SIP trunk: ' + errorText(result.data, 'HTTP ' + result.status)), { status: 502 });
}

async function removeVapi(fetcher, apiKey, { vapi_phone_number_id: phoneId, vapi_credential_id: credentialId }) {
  if (phoneId) await call(fetcher, VAPI + '/phone-number/' + encodeURIComponent(phoneId), { method: 'DELETE', token: apiKey }).catch(() => {});
  if (credentialId) await call(fetcher, VAPI + '/credential/' + encodeURIComponent(credentialId), { method: 'DELETE', token: apiKey }).catch(() => {});
}

/** Turns WhatsApp calling on for a restaurant's connected number. Rolls back what it created on failure. */
export async function enableCalling(pool, restaurantId, { env = process.env, fetcher = fetch, log = console, resolve4 } = {}) {
  const resolveOptions = resolve4 ? { resolve4 } : {};
  if (!env.VAPI_API_KEY) throw Object.assign(Error('VAPI_API_KEY is not set'), { status: 503 });
  const phoneNumberId = await restaurantNumber(pool, restaurantId);
  if (!phoneNumberId) throw Object.assign(Error('This restaurant has no active WhatsApp number'), { status: 409 });
  const token = await tokenForNumber(pool, phoneNumberId, env);
  if (!token) throw Object.assign(Error('No WhatsApp token for this number'), { status: 503 });
  const graph = 'https://graph.facebook.com/' + graphVersion(env) + '/' + phoneNumberId;
  const info = await call(fetcher, graph + '?fields=display_phone_number', { token });
  const number = String(info.data?.display_phone_number || '').replace(/\D/g, '');
  if (!info.ok || number.length < 8) throw Object.assign(Error('Could not read the WhatsApp number: ' + errorText(info.data, 'HTTP ' + info.status)), { status: 502 });

  const assistantId = await ensureAssistant(pool, restaurantId, { env, fetcher });
  const created = {};
  try {
    created.vapi_credential_id = await createCredential(fetcher, env.VAPI_API_KEY, restaurantId, await metaSipNetworks(resolveOptions));
    const phone = await call(fetcher, VAPI + '/phone-number', { method: 'POST', token: env.VAPI_API_KEY, body: {
      provider: 'byo-phone-number', name: ('WhatsApp ' + restaurantId).slice(0, 40), number, numberE164CheckEnabled: false,
      credentialId: created.vapi_credential_id, assistantId } });
    if (!phone.ok || typeof phone.data?.id !== 'string') throw Object.assign(Error('Vapi number: ' + errorText(phone.data, 'HTTP ' + phone.status)), { status: 502 });
    created.vapi_phone_number_id = phone.data.id;
    const sipHost = vapiSipHost(created.vapi_credential_id);
    const settings = await call(fetcher, graph + '/settings', { method: 'POST', token, body: metaCallingSettings(sipHost) });
    if (!settings.ok) throw Object.assign(Error('Meta calling settings: ' + errorText(settings.data, 'HTTP ' + settings.status)), { status: 502 });
    const state = await getCallingState(pool);
    const previous = state[restaurantId];
    state[restaurantId] = { phone_number_id: phoneNumberId, number, assistant_id: assistantId, ...created, sip_host: sipHost, enabled_at: new Date().toISOString() };
    await saveCallingState(pool, state);
    if (previous) await removeVapi(fetcher, env.VAPI_API_KEY, previous); // replaced an older setup
    log.log?.('WhatsApp calling on', JSON.stringify({ restaurantId, phoneNumberId, sipHost }));
    return { restaurant_id: restaurantId, on: true, number: '+' + number, sip_host: sipHost, assistant_id: assistantId };
  } catch (error) {
    await removeVapi(fetcher, env.VAPI_API_KEY, created);
    log.error?.('WhatsApp calling failed', String(error.message).slice(0, 300));
    throw error;
  }
}

/** Turns WhatsApp calling off and removes the Vapi trunk and number created for it. */
export async function disableCalling(pool, restaurantId, { env = process.env, fetcher = fetch } = {}) {
  const state = await getCallingState(pool);
  const entry = state[restaurantId];
  const phoneNumberId = entry?.phone_number_id || await restaurantNumber(pool, restaurantId);
  if (phoneNumberId) {
    const token = await tokenForNumber(pool, phoneNumberId, env);
    if (token) {
      const result = await call(fetcher, 'https://graph.facebook.com/' + graphVersion(env) + '/' + phoneNumberId + '/settings', { method: 'POST', token,
        body: { calling: { status: 'DISABLED', sip: { status: 'DISABLED' } } } });
      if (!result.ok) throw Object.assign(Error('Meta calling settings: ' + errorText(result.data, 'HTTP ' + result.status)), { status: 502 });
    }
  }
  if (entry && env.VAPI_API_KEY) await removeVapi(fetcher, env.VAPI_API_KEY, entry);
  delete state[restaurantId];
  await saveCallingState(pool, state);
  return { restaurant_id: restaurantId, on: false };
}

/** Meta's current calling settings for the restaurant's number (no SIP password requested). */
export async function callingStatus(pool, restaurantId, { env = process.env, fetcher = fetch } = {}) {
  const entry = (await getCallingState(pool))[restaurantId] || null;
  const phoneNumberId = entry?.phone_number_id || await restaurantNumber(pool, restaurantId);
  if (!phoneNumberId) return { on: false, error: 'No active WhatsApp number' };
  const token = await tokenForNumber(pool, phoneNumberId, env);
  if (!token) return { on: Boolean(entry), error: 'No WhatsApp token' };
  const result = await call(fetcher, 'https://graph.facebook.com/' + graphVersion(env) + '/' + phoneNumberId + '/settings?fields=calling', { token });
  const calling = result.data?.calling || null;
  return { on: Boolean(entry), setup: entry ? { number: '+' + entry.number, sip_host: entry.sip_host, enabled_at: entry.enabled_at } : null,
    meta: calling ? { status: calling.status || null, srtp: calling.srtp_key_exchange_protocol || null, sip_status: calling.sip?.status || null,
      sip_hosts: (calling.sip?.servers || []).map(s => s.hostname).filter(Boolean) } : null,
    ...(result.ok ? {} : { error: errorText(result.data, 'Meta ' + result.status) }) };
}

/**
 * Read-only check for the pilot: what Vapi saw for each WhatsApp-calling number (recent calls and
 * how they ended) and the trunk's gateways. Logged so failed calls can be diagnosed from runtime logs.
 */
export async function callingDiagnostics(pool, { env = process.env, fetcher = fetch } = {}) {
  if (!env.VAPI_API_KEY) return [];
  const state = await getCallingState(pool);
  const out = [];
  for (const [restaurantId, entry] of Object.entries(state)) {
    const calls = await call(fetcher, VAPI + '/call?limit=5&phoneNumberId=' + encodeURIComponent(entry.vapi_phone_number_id), { token: env.VAPI_API_KEY }).catch(() => null);
    const credential = await call(fetcher, VAPI + '/credential/' + encodeURIComponent(entry.vapi_credential_id), { token: env.VAPI_API_KEY }).catch(() => null);
    const list = Array.isArray(calls?.data) ? calls.data : Array.isArray(calls?.data?.results) ? calls.data.results : [];
    out.push({ restaurantId: Number(restaurantId), sip_host: entry.sip_host,
      gateways: (credential?.data?.gateways || []).map(g => g.ip + (g.netmask ? '/' + g.netmask : '')),
      calls: list.slice(0, 5).map(c => ({ at: c.createdAt, status: c.status, ended: c.endedReason, type: c.type })),
      ...(calls && !calls.ok ? { calls_error: errorText(calls.data, 'HTTP ' + calls.status) } : {}) });
  }
  return out;
}
