// Post-registration setup box: Business WhatsApp, AI Caller number and Website.
// Every step is optional. "Finish" connects what can be connected automatically and reports
// an honest status per item: connected, pending (with the next action) or skipped.
// No express import: testable with mock pools.
import { normalizePhone } from './order-fulfillment.js';

export const KINDS = Object.freeze(['whatsapp', 'ai_caller', 'website']);
export const MODES = Object.freeze({
  whatsapp: ['meta_signup'],
  ai_caller: ['forward', 'import', 'new'],
  website: ['builder', 'domain', 'embed'],
});
const PLATFORM_HOSTS = /(^|\.)mar-khoor\.com$/;
const HOSTNAME = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function normalizeDomain(value) {
  if (typeof value !== 'string') return null;
  let host = value.trim().toLowerCase();
  host = host.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
  if (!HOSTNAME.test(host) || PLATFORM_HOSTS.test(host)) return null;
  return host;
}

/** Validates the setup box submission. Unknown kinds are rejected; missing kinds stay unchanged. */
export function validateSetup(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Invalid setup' };
  const out = {};
  for (const [kind, entry] of Object.entries(body)) {
    if (!KINDS.includes(kind)) return { error: 'Unknown setup item' };
    if (!entry || typeof entry !== 'object') return { error: 'Invalid setup item' };
    if (entry.skip === true) { out[kind] = { mode: null, value: null, skipped: true }; continue; }
    if (!MODES[kind].includes(entry.mode)) return { error: 'Choose how to connect ' + label(kind) };
    let value = null;
    if (kind === 'whatsapp' || kind === 'ai_caller') {
      value = normalizePhone(entry.value);
      if (!value) return { error: 'Enter a valid ' + label(kind) + ' number' };
    } else if (entry.mode !== 'builder') {
      value = normalizeDomain(entry.value);
      if (!value) return { error: 'Enter your website domain, for example myrestaurant.com' };
    }
    out[kind] = { mode: entry.mode, value, skipped: false };
  }
  return { value: out };
}

const label = kind => ({ whatsapp: 'Business WhatsApp', ai_caller: 'AI Caller', website: 'website' })[kind];

export async function getIntegrations(pool, restaurantId) {
  const [rows] = await pool.execute('SELECT kind,mode,value,status,detail,updated_at FROM restaurant_integrations WHERE restaurant_id=?', [restaurantId]);
  const byKind = Object.fromEntries(rows.map(row => [row.kind, row]));
  return KINDS.map(kind => byKind[kind]
    ? { kind, mode: byKind[kind].mode, value: byKind[kind].value, status: byKind[kind].status, detail: byKind[kind].detail, updated_at: byKind[kind].updated_at }
    : { kind, mode: null, value: null, status: 'not_started', detail: null, updated_at: null });
}

export async function saveSetup(pool, restaurantId, body) {
  const parsed = validateSetup(body);
  if (parsed.error) return { status: 400, body: { error: parsed.error } };
  try {
    for (const [kind, entry] of Object.entries(parsed.value)) {
      await pool.execute(
        'INSERT INTO restaurant_integrations(restaurant_id,kind,mode,value,status,detail) VALUES (?,?,?,?,?,NULL) '
        + 'ON DUPLICATE KEY UPDATE mode=VALUES(mode),value=VALUES(value),status=VALUES(status),detail=NULL',
        [restaurantId, kind, entry.mode, entry.value, entry.skipped ? 'skipped' : 'pending']);
    }
    return { status: 200, body: { integrations: await getIntegrations(pool, restaurantId) } };
  } catch {
    return { status: 503, body: { error: 'Setup unavailable' } };
  }
}

// Individual connectors: each returns {status, detail}. They read only this restaurant's rows.

async function connectWhatsApp(pool, restaurantId, entry) {
  const [numbers] = await pool.execute('SELECT phone_number_id FROM whatsapp_numbers WHERE restaurant_id=? AND active=1 LIMIT 1', [restaurantId]);
  if (numbers.length) {
    await pool.execute('INSERT INTO whatsapp_ai_settings(restaurant_id,enabled) VALUES (?,TRUE) ON DUPLICATE KEY UPDATE enabled=TRUE', [restaurantId]);
    return { status: 'connected', detail: 'WhatsApp ' + entry.value + ' is linked to your AI Assistant.' };
  }
  return { status: 'pending', detail: 'Verify ' + entry.value + ' with "Connect with Facebook" (Meta requires the business owner to confirm the number by code). AI replies start right after.' };
}

async function activeVoiceNumber(pool, restaurantId) {
  const [inventory] = await pool.execute('SELECT phone_number FROM registration_voice_inventory WHERE restaurant_id=? LIMIT 1', [restaurantId]);
  if (inventory.length) return inventory[0].phone_number;
  const [numbers] = await pool.execute("SELECT phone_number FROM restaurant_numbers WHERE restaurant_id=? AND status='active' LIMIT 1", [restaurantId]);
  return numbers[0]?.phone_number ?? null;
}

async function connectAiCaller(pool, restaurantId, entry, deps) {
  let number = await activeVoiceNumber(pool, restaurantId);
  if (!number && entry.mode === 'forward' && deps.assignVoiceNumber) {
    const [restaurants] = await pool.execute('SELECT country_code FROM restaurants WHERE id=? LIMIT 1', [restaurantId]);
    if (restaurants.length) {
      const assigned = await deps.assignVoiceNumber(pool, restaurantId, restaurants[0].country_code);
      if (assigned?.status === 'active') number = assigned.number;
    }
  }
  if (number && entry.mode === 'forward')
    return { status: 'connected', detail: 'Your AI Caller number is ' + number + '. Forward calls from ' + entry.value + ' to it (ask your phone provider for "call forwarding").' };
  if (number) return { status: 'connected', detail: 'AI Caller is answering on ' + number + '.' };
  if (entry.mode === 'forward') return { status: 'pending', detail: 'No AI Caller number is free in your country yet. We will assign one and show it here.' };
  if (entry.mode === 'import') return { status: 'pending', detail: 'Our team will connect ' + entry.value + ' through a phone provider (Twilio, Vonage or Telnyx) and confirm here.' };
  return { status: 'pending', detail: 'A new local number will be bought for you after your plan payment is confirmed.' };
}

async function connectWebsite(pool, restaurantId, entry, deps) {
  const [sites] = await pool.execute('SELECT published FROM restaurant_sites WHERE restaurant_id=? LIMIT 1', [restaurantId]);
  const [restaurants] = await pool.execute('SELECT slug FROM restaurants WHERE id=? LIMIT 1', [restaurantId]);
  const slug = restaurants[0]?.slug;
  const siteUrl = (deps.baseUrl || 'https://mar-khoor.com') + '/r/' + slug;
  if (entry.mode === 'builder') {
    if (sites[0]?.published) return { status: 'connected', detail: 'Your website is live at ' + siteUrl + ' with the AI Assistant, WhatsApp and AI Caller.' };
    return { status: 'pending', detail: 'Open "My Website", write it with AI and press Publish. It goes live at ' + siteUrl + '.' };
  }
  if (entry.mode === 'domain')
    return { status: 'pending', detail: 'Domain ' + entry.value + ' saved. Domain verification and SSL are the next step; we will show the DNS record to add here.' };
  return { status: 'pending', detail: 'Saved ' + entry.value + '. The embed code for your own website (AI Assistant, WhatsApp button and AI Caller number) will appear here.' };
}

const CONNECTORS = { whatsapp: connectWhatsApp, ai_caller: connectAiCaller, website: connectWebsite };

/** Runs every saved, non-skipped item. One failing item never blocks the others. */
export async function finishSetup(pool, restaurantId, deps = {}) {
  let saved;
  try { saved = await getIntegrations(pool, restaurantId); }
  catch { return { status: 503, body: { error: 'Setup unavailable' } }; }
  for (const item of saved) {
    if (item.status === 'not_started' || item.status === 'skipped' || !item.mode) continue;
    let result;
    try { result = await CONNECTORS[item.kind](pool, restaurantId, item, deps); }
    catch { result = { status: 'failed', detail: 'Could not connect right now. Press Finish again in a few minutes.' }; }
    try {
      await pool.execute('UPDATE restaurant_integrations SET status=?,detail=? WHERE restaurant_id=? AND kind=?', [result.status, result.detail.slice(0, 500), restaurantId, item.kind]);
    } catch { /* reported below from the fresh read */ }
  }
  try {
    await pool.execute("INSERT INTO restaurant_setup(restaurant_id,selected_services,skipped) VALUES (?,'[]',FALSE) ON DUPLICATE KEY UPDATE skipped=FALSE", [restaurantId]);
    return { status: 200, body: { integrations: await getIntegrations(pool, restaurantId) } };
  } catch {
    return { status: 503, body: { error: 'Setup unavailable' } };
  }
}
