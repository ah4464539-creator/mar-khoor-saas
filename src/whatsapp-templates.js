// WhatsApp template messages. Outside Meta's 24-hour customer service window a business may only
// send pre-approved templates. Templates are created and approved in Meta WhatsApp Manager; we only
// reference them by name + language and fill the body parameters.
import { postWhatsAppMessage } from './whatsapp-orders.js';
import { isOptedOut } from './whatsapp-reliability.js';

const NAME = /^[a-z0-9_]{1,512}$/;
const LANG = /^[a-z]{2,3}(_[A-Z]{2})?$/;

/** Validates a template request. Returns { value } or { error }. */
export function validateTemplate({ name, language = 'en', params = [] } = {}) {
  if (typeof name !== 'string' || !NAME.test(name)) return { error: 'Template name: lowercase letters, numbers and _ only (as approved in Meta)' };
  if (typeof language !== 'string' || !LANG.test(language)) return { error: 'Template language code, e.g. en, ur, ar or en_US' };
  if (!Array.isArray(params) || params.length > 10 || params.some(p => (typeof p !== 'string' && typeof p !== 'number') || String(p).length > 300 || /[\n\t]|\s{5,}/.test(String(p))))
    return { error: 'Up to 10 template values, each one line of at most 300 characters' };
  return { value: { name, language, params: params.map(String) } };
}

export function templatePayload(to, { name, language, params }) {
  const template = { name, language: { code: language } };
  if (params.length) template.components = [{ type: 'body', parameters: params.map(text => ({ type: 'text', text })) }];
  return { to, type: 'template', template };
}

/** True while the customer wrote to this number in the last 23 hours (a safe margin inside 24h). */
export async function insideServiceWindow(pool, restaurantId, phoneId, customer) {
  const [rows] = await pool.execute('SELECT 1 FROM whatsapp_inbound_messages WHERE restaurant_id=? AND phone_number_id=? AND sender=? AND received_at>=NOW()-INTERVAL 23 HOUR LIMIT 1', [restaurantId, phoneId, customer]);
  return rows.length > 0;
}

/**
 * Sends an approved template and records it in outbound history. Customers who opted out
 * (STOP / band karo) are never messaged. Returns { sent, id } or { sent: false, reason }.
 */
export async function sendTemplateMessage(pool, { restaurantId, phoneId, customer, template, token, fetcher = fetch, env = process.env }) {
  const checked = validateTemplate(template);
  if (checked.error) return { sent: false, reason: 'invalid', error: checked.error };
  if (await isOptedOut(pool, restaurantId, customer)) return { sent: false, reason: 'opted_out' };
  const id = await postWhatsAppMessage(fetcher, env, token, phoneId, templatePayload(customer, checked.value));
  const shown = '[Template ' + checked.value.name + '] ' + checked.value.params.join(' · ');
  await pool.execute('INSERT INTO whatsapp_outbound_messages(message_id,restaurant_id,phone_number_id,recipient,text_body) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE message_id=message_id', [id, restaurantId, phoneId, customer, shown.slice(0, 1000)]);
  return { sent: true, id };
}

/** Order-status template from env (WHATSAPP_ORDER_STATUS_TEMPLATE / _LANG); body: 1 = order number, 2 = status. */
export function orderStatusTemplate(orderId, statusLabel, env = process.env) {
  const name = String(env.WHATSAPP_ORDER_STATUS_TEMPLATE || '').trim();
  if (!name) return null;
  const checked = validateTemplate({ name, language: String(env.WHATSAPP_ORDER_STATUS_TEMPLATE_LANG || 'en').trim(), params: ['#' + orderId, statusLabel] });
  return checked.value || null;
}
