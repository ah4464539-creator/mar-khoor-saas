// Bookings on AI phone calls (Vapi). The adapter answers three tools; the business identity always
// comes from the server-side assistant mapping, never from the model. Additive table only.
import { getProfile, ensureBookingTables, createBooking, notifyNewBooking, BUSINESS_TYPES } from './bookings.js';
import { bookingContext, bookingPrompt, runAvailability, buildBookingDraft } from './booking-assistant.js';

export const VOICE_BOOKING_SQL = `CREATE TABLE IF NOT EXISTS voice_booking_requests (
 assistant_id VARCHAR(128) NOT NULL,
 call_id VARCHAR(128) NOT NULL,
 restaurant_id BIGINT UNSIGNED NOT NULL,
 booking_id BIGINT UNSIGNED NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (assistant_id, call_id),
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB`;

export const VOICE_BOOKING_TOOLS = ['get_business_info', 'check_availability', 'book_appointment'];

async function mappedBusiness(pool, assistantId) {
  const [rows] = await pool.execute('SELECT r.id,r.name,r.currency FROM voice_assistants v JOIN restaurants r ON r.id=v.restaurant_id WHERE v.assistant_id=? AND v.active=1 LIMIT 1', [assistantId]);
  return rows[0] || null;
}
const phoneOf = message => {
  const n = String(message?.call?.customer?.number || message?.customer?.number || '').replace(/[^\d+]/g, '');
  return /^\+?\d{7,16}$/.test(n) ? n : '';
};

/** Runs one booking tool for a call. Returns a plain result object (or { error }). */
export async function runVoiceBookingTool(pool, { assistantId, name, args, message }) {
  const business = await mappedBusiness(pool, assistantId);
  if (!business) return { error: 'Assistant not mapped' };
  const ctx = await bookingContext(pool, business.id);
  if (!ctx?.ready) return { error: 'This business does not take bookings by phone yet. Take the caller name and need, and say the business will call back.' };
  if (name === 'get_business_info') return { business: business.name, kind: BUSINESS_TYPES[ctx.profile.category].label, instructions: bookingPrompt(ctx, business.currency) };
  if (name === 'check_availability') return runAvailability(pool, business.id, args || {});
  if (name !== 'book_appointment') return { error: 'Unsupported tool' };
  if (args?.confirmed !== true) return { error: 'Read the booking back to the caller and get a clear yes, then call again with confirmed true' };
  const callId = message?.call?.id;
  if (typeof callId !== 'string' || !/^[-a-zA-Z0-9_:]{1,128}$/.test(callId)) return { error: 'Missing call ID' };
  const phone = phoneOf(message) || String(args?.phone || '').replace(/[^\d+]/g, '');
  if (!/^\+?\d{7,16}$/.test(phone)) return { error: 'Ask the caller for a phone number' };
  const built = await buildBookingDraft(pool, business.id, { ...args, language: 'en' });
  if (built.error) return { error: built.error };
  await ensureBookingTables(pool);
  await pool.query(VOICE_BOOKING_SQL);
  // One booking per call (a repeated tool call returns the same booking).
  const [claim] = await pool.execute('INSERT IGNORE INTO voice_booking_requests(assistant_id,call_id,restaurant_id) VALUES (?,?,?)', [assistantId, callId, business.id]);
  if (!claim.affectedRows) {
    const [existing] = await pool.execute('SELECT booking_id FROM voice_booking_requests WHERE assistant_id=? AND call_id=?', [assistantId, callId]);
    return existing[0]?.booking_id ? { booking_id: Number(existing[0].booking_id), status: 'already_received' } : { error: 'Booking already processing' };
  }
  const d = built.value;
  const result = await createBooking(pool, business.id, { service_id: d.service_id, date: d.date, time: d.time, check_out: d.check_out, resource_id: d.staff_id, customer_name: d.customer_name, customer_phone: phone, guests: d.guests, note: d.note, source: 'call' });
  if (result.error) { await pool.execute('DELETE FROM voice_booking_requests WHERE assistant_id=? AND call_id=? AND booking_id IS NULL', [assistantId, callId]); return { error: result.error }; }
  await pool.execute('UPDATE voice_booking_requests SET booking_id=? WHERE assistant_id=? AND call_id=?', [result.booking.id, assistantId, callId]);
  notifyNewBooking(pool, business.id, result.booking, 'Phone call');
  return { booking_id: result.booking.id, status: 'received', service: result.booking.service, start: result.booking.start_at, say: 'Tell the caller the booking is received and the business will confirm it.' };
}

// ---- Add the booking tools to a business's Vapi assistant (when its owner turns bookings on) ----
const TOOL_SCHEMAS = {
  get_business_info: { description: 'Services, prices, staff, opening hours and today\'s date for booking. Call at the start when the caller wants an appointment or a room.', parameters: { type: 'object', properties: {} } },
  check_availability: { description: 'Free times (or rooms) for one service on a date. Call before offering any time.', parameters: { type: 'object', required: ['service_id', 'date'], properties: { service_id: { type: 'integer' }, date: { type: 'string', description: 'YYYY-MM-DD' }, check_out: { type: 'string', description: 'YYYY-MM-DD, rooms only' }, staff_id: { type: 'integer' } } } },
  book_appointment: { description: 'Create the booking after reading it back and the caller clearly said yes.', parameters: { type: 'object', required: ['service_id', 'date', 'customer_name', 'confirmed'], properties: { service_id: { type: 'integer' }, date: { type: 'string' }, time: { type: 'string', description: 'HH:MM from check_availability' }, check_out: { type: 'string' }, staff_id: { type: 'integer' }, customer_name: { type: 'string' }, guests: { type: 'integer' }, note: { type: 'string' }, confirmed: { type: 'boolean' } } } },
};
export const BOOKING_CALL_RULE = 'BOOKINGS: when the caller wants an appointment, a table or a room, call get_business_info, then check_availability, offer at most 3 free times, ask the name, read the booking back and only after a clear yes call book_appointment with confirmed true. Never invent times.';
const START = '[[MK-BUSINESS]]', END = '[[/MK-BUSINESS]]';
/** The call rule for this business type (kept between markers so a later type change replaces it). */
export function businessCallRule(category, name) {
  const type = BUSINESS_TYPES[category] || BUSINESS_TYPES.restaurant;
  const lines = [BOOKING_CALL_RULE];
  if (category !== 'restaurant') lines.push('This business is ' + (name ? '"' + name + '", ' : '') + 'a ' + type.label.toLowerCase() + ', not a restaurant. Greet callers as its reception, never offer a menu or food orders, and help them book ' + (type.booking === 'night' ? 'rooms' : type.unit + 's') + ' with the booking tools. Do not give medical, legal or financial advice.');
  return START + '\n' + lines.join('\n') + '\n' + END;
}

/** Adds the three booking tools (same server settings as the existing place_order tool) and the type rule. */
export function withBookingTools(model, server, rule = businessCallRule('restaurant')) {
  if (!model || typeof model !== 'object') return model;
  const tools = Array.isArray(model.tools) ? model.tools : [];
  const have = new Set(tools.map(t => t?.function?.name));
  const extra = VOICE_BOOKING_TOOLS.filter(n => !have.has(n)).map(name => ({ type: 'function', function: { name, ...TOOL_SCHEMAS[name] }, ...(server ? { server } : {}) }));
  const messages = Array.isArray(model.messages) ? model.messages : [];
  const i = messages.findIndex(m => m?.role === 'system');
  const current = i >= 0 ? String(messages[i].content || '') : '';
  const a = current.indexOf(START), b = current.indexOf(END);
  const base = a >= 0 && b > a ? (current.slice(0, a) + current.slice(b + END.length)).trimEnd() : current;
  const content = (base ? base + '\n\n' : '') + rule;
  if (!extra.length && content === current) return model;
  const next = { ...model, tools: [...tools, ...extra] };
  next.messages = i >= 0 ? messages.map((m, k) => k === i ? { ...m, content } : m) : [{ role: 'system', content: rule }, ...messages];
  return next;
}

export async function syncCallBookingTools(pool, restaurantId, { env = process.env, fetcher = fetch, log = console } = {}) {
  const apiKey = env.VAPI_API_KEY;
  if (!apiKey) return { skipped: 'no key' };
  const profile = await getProfile(pool, restaurantId);
  if (!profile?.bookings_enabled) return { skipped: 'bookings off' };
  let name = '';
  try { const [[r]] = await pool.execute('SELECT name FROM restaurants WHERE id=?', [restaurantId]); name = r?.name || ''; } catch {}
  const rule = businessCallRule(profile.category, name);
  let rows = [];
  try { [rows] = await pool.execute('SELECT assistant_id FROM voice_assistants WHERE restaurant_id=? AND active=1', [restaurantId]); } catch { return { skipped: 'no assistant' }; }
  const headers = { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' };
  let updated = 0, failed = 0;
  for (const { assistant_id: id } of rows) {
    try {
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw Error('bad id');
      const got = await fetcher('https://api.vapi.ai/assistant/' + id, { headers, redirect: 'error', signal: AbortSignal.timeout(20000) });
      if (!got.ok) throw Error('Vapi ' + got.status);
      const assistant = await got.json();
      if (!assistant?.model) continue;
      // Reuse the server (URL + secret) of the existing order tool, inline or saved as a Vapi tool.
      let server = (assistant.model.tools || []).find(t => t?.function?.name === 'place_order' || t?.function?.name === 'get_menu')?.server || assistant.server || null;
      if (!server && Array.isArray(assistant.model.toolIds)) {
        for (const toolId of assistant.model.toolIds.slice(0, 10)) {
          if (!/^[a-zA-Z0-9_-]{1,128}$/.test(toolId)) continue;
          const t = await fetcher('https://api.vapi.ai/tool/' + toolId, { headers, redirect: 'error', signal: AbortSignal.timeout(20000) });
          if (!t.ok) continue;
          const tool = await t.json();
          if (['place_order', 'get_menu'].includes(tool?.function?.name) && tool.server) { server = tool.server; break; }
        }
      }
      if (!server?.url) throw Error('order tool server not found');
      const model = withBookingTools(assistant.model, server, rule);
      if (model === assistant.model) continue;
      const res = await fetcher('https://api.vapi.ai/assistant/' + id, { method: 'PATCH', headers, redirect: 'error', signal: AbortSignal.timeout(20000), body: JSON.stringify({ model }) });
      if (!res.ok) throw Error('Vapi ' + res.status);
      updated++;
    } catch (error) { failed++; log.warn?.('AI Caller booking tools for business #' + restaurantId + ' failed: ' + String(error.message).slice(0, 120)); }
  }
  log.log?.('AI Caller booking tools for business #' + restaurantId + ': ' + updated + ' updated, ' + failed + ' failed');
  return { updated, failed };
}
