// Runs Vapi tool calls (function tools) for one call. Shared by the dedicated tool URL
// (/integrations/vapi/tools) and the main Vapi webhook (`tool-calls` server messages), so an
// assistant can point every tool at either URL.
//
// Tools: get_menu, place_order (alias create_order), the booking tools from voice-bookings.js
// (create_table_booking is an alias of book_appointment). Orders are created as `pending`; staff
// confirm them on the dashboard. Tenant identity comes from the server-side assistant mapping only.
import { createVoiceOrderHandler } from './voice-tools.js';
import { VOICE_BOOKING_TOOLS, runVoiceBookingTool } from './voice-bookings.js';
import { resolveIncomingWhatsAppSip } from './whatsapp-sip-routing.js';
import { emitWhatsAppCallLog, sipFailClosedEnabled } from './whatsapp-sip-identifiers.js';

export const TOOL_ALIASES = Object.freeze({ create_order: 'place_order', create_table_booking: 'book_appointment' });
const ASSISTANT = /^[a-zA-Z0-9_-]{1,128}$/;
const CALL = /^[-a-zA-Z0-9_:]{1,128}$/;

export const assistantIdOf = message => message?.assistant?.id || message?.assistantId || message?.call?.assistantId || message?.call?.assistant?.id;

function parseArgs(raw) {
  let args = raw;
  if (typeof args === 'string') { try { args = JSON.parse(args); } catch { return null; } }
  return args && typeof args === 'object' && !Array.isArray(args) ? args : null;
}

async function getMenu(pool, assistantId) {
  const [mapped] = await pool.execute('SELECT r.id,r.name,r.currency,r.locale FROM voice_assistants v JOIN restaurants r ON r.id=v.restaurant_id WHERE v.assistant_id=? AND v.active=1 LIMIT 1', [assistantId]);
  if (!mapped.length) return { error: 'Assistant not mapped' };
  const restaurant = mapped[0];
  const [items] = await pool.execute('SELECT id,name,description,price_minor FROM menu_items WHERE restaurant_id=? AND active=1 ORDER BY id', [restaurant.id]);
  return { restaurant: { name: restaurant.name, currency: restaurant.currency, locale: restaurant.locale }, items };
}

async function placeOrder(pool, assistantId, message, args) {
  // The provider call identifier is read from the message envelope, never from model arguments.
  const callId = message?.call?.id;
  if (typeof callId !== 'string' || !CALL.test(callId)) return { error: 'Missing call ID' };
  const payload = { customer_name: args.customer_name, confirmed: args.confirmed, items: args.items, call_id: callId };
  const response = await new Promise(resolve => {
    const mockRes = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { resolve({ status: this.statusCode, body }); return this; } };
    Promise.resolve(createVoiceOrderHandler(pool)({ params: { assistantId }, body: payload }, mockRes)).catch(() => resolve({ status: 503, body: { error: 'Order unavailable' } }));
  });
  return response.body;
}

/**
 * Validates the envelope and runs every tool call. Returns { status, body } where a 200 body is
 * Vapi's expected { results: [{ toolCallId, result | error }] }.
 */
export async function runVapiToolCalls(pool, message, { log = console } = {}) {
  const calls = message?.toolCallList ?? message?.toolCalls;
  const assistantId = assistantIdOf(message);
  if (!Array.isArray(calls) || calls.length < 1 || calls.length > 10 || typeof assistantId !== 'string' || !ASSISTANT.test(assistantId))
    return { status: 400, body: { error: 'Invalid tool call envelope' } };
  if (new Set(calls.map(c => c?.id)).size !== calls.length) return { status: 400, body: { error: 'Duplicate tool call ID' } };
  let route = { scope: 'other' };
  try { if (sipFailClosedEnabled()) route = await resolveIncomingWhatsAppSip(pool, { call: message?.call, assistantId }); }
  catch { return { status: 503, body: { error: 'Calling route unavailable' } }; }
  if (route.scope === 'rejected' || route.scope === 'validated') {
    emitWhatsAppCallLog(log, { source: 'vapi-tools', vapiCallId: message?.call?.id,
      vapiPhoneNumberId: route.vapiPhoneNumberId, businessNumber: route.businessNumber,
      tenantId: route.scope === 'validated' ? route.tenantId : undefined, assistantId,
      sipStatus: message?.call?.status, sipResponse: message?.call?.sip?.responseCode,
      decision: route.scope === 'validated' ? 'allow' : route.reason });
    if (route.scope === 'rejected') return { status: 403, body: { error: 'WhatsApp SIP routing mismatch' } };
  }
  const results = [];
  for (const call of calls) {
    const id = call?.id;
    if (typeof id !== 'string' || !id || id.length > 128) return { status: 400, body: { error: 'Invalid tool call ID' } };
    const requested = call?.function?.name;
    const name = TOOL_ALIASES[requested] ?? requested;
    let result;
    try {
      if (name === 'get_menu') result = await getMenu(pool, assistantId);
      else if (name === 'place_order') {
        const args = parseArgs(call?.function?.arguments);
        result = args ? await placeOrder(pool, assistantId, message, args) : { error: 'Invalid arguments' };
      } else if (VOICE_BOOKING_TOOLS.includes(name)) {
        result = await runVoiceBookingTool(pool, { assistantId, name, args: parseArgs(call?.function?.arguments) ?? {}, message });
      } else result = { error: 'Unsupported tool' };
    } catch {
      result = { error: name === 'get_menu' ? 'Menu unavailable' : VOICE_BOOKING_TOOLS.includes(name) ? 'Booking unavailable' : 'Order unavailable' };
    }
    results.push(result?.error ? { toolCallId: id, error: result.error } : { toolCallId: id, result: JSON.stringify(result) });
  }
  return { status: 200, body: { results } };
}
