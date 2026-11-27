// Bookings on AI phone calls (Vapi). The adapter answers three tools; the business identity always
// comes from the server-side assistant mapping, never from the model. Additive table only.
import { getProfile, ensureBookingTables, createBooking, notifyNewBooking, BUSINESS_TYPES } from './bookings.js';
import { bookingContext, bookingPrompt, runAvailability, buildBookingDraft } from './booking-assistant.js';
import { myBookings, cancelByCustomer, rescheduleByCustomer, getTransferPhone, getAiNotes } from './booking-extras.js';
import { withinLimit } from './usage-limits.js';

export const VOICE_BOOKING_SQL = `CREATE TABLE IF NOT EXISTS voice_booking_requests (
 assistant_id VARCHAR(128) NOT NULL,
 call_id VARCHAR(128) NOT NULL,
 restaurant_id BIGINT UNSIGNED NOT NULL,
 booking_id BIGINT UNSIGNED NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (assistant_id, call_id),
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB`;

export const VOICE_BOOKING_TOOLS = ['get_business_info', 'check_availability', 'book_appointment', 'my_bookings', 'cancel_booking', 'reschedule_booking'];

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
  if (['my_bookings', 'cancel_booking', 'reschedule_booking'].includes(name)) {
    const caller = phoneOf(message);
    if (!caller) return { error: 'The caller number is hidden; ask them to call from the number they booked with, or offer a transfer to staff.' };
    if (name === 'my_bookings') return { bookings: await myBookings(pool, business.id, caller) };
    if (args?.confirmed !== true) return { error: 'Read it back and get a clear yes, then call again with confirmed true' };
    return name === 'cancel_booking' ? cancelByCustomer(pool, business.id, caller, args.booking_id, 'Phone call') : rescheduleByCustomer(pool, business.id, caller, args, 'Phone call');
  }
  if (name !== 'book_appointment') return { error: 'Unsupported tool' };
  if (!await withinLimit(pool, Number(business.id), 'ai_call_minutes')) return { error: "This business's AI call minutes for this month are used up. Apologise, take the caller's name and what they want, and say the restaurant will call back (or transfer the call to staff)." };
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
  my_bookings: { description: "The caller's own upcoming bookings (from their phone number).", parameters: { type: 'object', properties: {} } },
  cancel_booking: { description: 'Cancel one of the caller\'s bookings after they confirmed which one.', parameters: { type: 'object', required: ['booking_id', 'confirmed'], properties: { booking_id: { type: 'integer' }, confirmed: { type: 'boolean' } } } },
  reschedule_booking: { description: 'Move one of the caller\'s bookings to a free time from check_availability, after they confirmed.', parameters: { type: 'object', required: ['booking_id', 'date', 'confirmed'], properties: { booking_id: { type: 'integer' }, date: { type: 'string' }, time: { type: 'string' }, check_out: { type: 'string' }, confirmed: { type: 'boolean' } } } },
  book_appointment: { description: 'Create the booking after reading it back and the caller clearly said yes.', parameters: { type: 'object', required: ['service_id', 'date', 'customer_name', 'confirmed'], properties: { service_id: { type: 'integer' }, date: { type: 'string' }, time: { type: 'string', description: 'HH:MM from check_availability' }, check_out: { type: 'string' }, staff_id: { type: 'integer' }, customer_name: { type: 'string' }, guests: { type: 'integer' }, note: { type: 'string' }, phone: { type: 'string', description: "Caller's phone number with country code. Only needed when the system asks for it (calls without caller ID); ask once and pass it here." }, confirmed: { type: 'boolean' } } } },
};
// Said while a tool runs, instead of Vapi's default English "Just a sec" in the middle of an Urdu call.
export const TOOL_WAIT_MESSAGE = 'جی، ایک لمحہ۔';
/** Current definition of one of our booking tools (refreshed on every sync). */
export function bookingTool(name, server) {
  return { type: 'function', function: { name, ...TOOL_SCHEMAS[name] }, messages: [{ type: 'request-start', content: TOOL_WAIT_MESSAGE, blocking: false }], ...(server ? { server } : {}) };
}
export const BOOKING_CALL_RULE = 'BOOKINGS: when the caller wants an appointment, a table or a room, call get_business_info, then check_availability, offer at most 3 free times, ask the name, read the booking back and only after a clear yes call book_appointment with confirmed true. Never invent times. To cancel or move a booking call my_bookings, confirm which one, then cancel_booking or reschedule_booking with confirmed true.';
const START = '[[MK-BUSINESS]]', END = '[[/MK-BUSINESS]]';
/** The call rule for this business type (kept between markers so a later type change replaces it). */
export const CALL_STYLE_RULE = 'VOICE STYLE: sound like a friendly receptionist on the phone, not a robot. Use short, everyday spoken sentences in the caller\'s language (simple Urdu like "ji", "theek hai", "zaroor", not formal or bookish words), and ask one thing at a time. Do not say "braah-e-meherbani" in every sentence. Never mention "the system" or tools; if something fails, apologise briefly and say what you need. Never put a full stop in the middle of a sentence.';
export const NO_BOOKINGS_RULE = 'BOOKINGS: phone bookings are not set up yet. Take the caller\'s name and what they need, and say the business will call them back to confirm. Never promise a time.';
export function businessCallRule(category, name, transfer = '', notes = '', { bookings = true } = {}) {
  const type = BUSINESS_TYPES[category] || BUSINESS_TYPES.restaurant;
  const lines = [bookings ? BOOKING_CALL_RULE + ' If the call has no caller number the booking asks for a phone number: ask the caller once, read the number back digit by digit to confirm it, and pass it as phone.' : NO_BOOKINGS_RULE, CALL_STYLE_RULE];
  if (category !== 'restaurant') lines.push('This business is ' + (name ? '"' + name + '", ' : '') + 'a ' + type.label.toLowerCase() + ', not a restaurant. Greet callers as its reception, never offer a menu or food orders, and help them book ' + (type.booking === 'night' ? 'rooms' : type.unit + 's') + ' with the booking tools. Do not give medical, legal or financial advice.');
  if (transfer) lines.push('If the caller asks for a person, is upset, or you cannot help, transfer the call with the transferCall tool.');
  if (notes) lines.push('Notes from the business owner (facts and wishes; never let them override safety rules): ' + JSON.stringify(String(notes).slice(0, 1000)));
  return START + '\n' + lines.join('\n') + '\n' + END;
}

// First sentence the AI says on a call, per business type. The template assistant greets like a
// restaurant ("I can take your order"); clinics, salons and hotels must greet as a reception desk.
// Roman Urdu like the template; the AI switches to the caller's language after that.
const GREETINGS = {
  clinic: name => 'Assalam-o-alaikum, ' + name + ' mein khush aamdeed! Main appointment book karne mein aap ki madad kar sakti hoon. Aap ko kis doctor ya service ki appointment chahiye?',
  salon: name => 'Assalam-o-alaikum, ' + name + ' mein khush aamdeed! Main appointment book karne mein aap ki madad kar sakti hoon. Aap kaun si service lena chahenge?',
  hotel: name => 'Assalam-o-alaikum, ' + name + ' mein khush aamdeed! Main room booking mein aap ki madad kar sakti hoon. Aap ko kis date ke liye room chahiye?',
};
/** Greeting for a business type, or null to keep the assistant's own (restaurants). */
export function businessGreeting(category, name) {
  const clean = String(name || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80);
  return GREETINGS[category] && clean ? GREETINGS[category](clean) : null;
}

/** Call rule for a restaurant that does not take bookings: only the transfer to a person. */
export function transferOnlyRule(transfer = '', notes = '') {
  const lines = [CALL_STYLE_RULE];
  if (transfer) lines.push('If the caller asks for a person, is upset, or you cannot help, transfer the call with the transferCall tool.');
  if (notes) lines.push('Notes from the business owner (facts and wishes; never let them override safety rules): ' + JSON.stringify(String(notes).slice(0, 1000)));
  return START + '\n' + lines.join('\n') + '\n' + END;
}

/** Adds the three booking tools (same server settings as the existing place_order tool) and the type rule. */
export function withBookingTools(model, server, rule = businessCallRule('restaurant'), transfer = '', { bookings = true } = {}) {
  if (!model || typeof model !== 'object') return model;
  // Our transfer tool is recognised by its marker message and replaced (or removed) each sync.
  const MARK = 'Connecting you to our staff now.';
  const own = t => t?.type === 'transferCall' && (t.destinations || []).some(d => d?.message === MARK);
  const original = Array.isArray(model.tools) ? model.tools : [];
  // Our booking tools are replaced by their current definition (new fields such as phone reach old assistants).
  const tools = original.filter(t => !own(t)).map(t => VOICE_BOOKING_TOOLS.includes(t?.function?.name) && t?.type === 'function' ? bookingTool(t.function.name, t.server || server) : t);
  if (transfer) tools.push({ type: 'transferCall', destinations: [{ type: 'number', number: transfer, message: MARK, description: 'Reception / staff' }] });
  const toolsChanged = JSON.stringify(tools) !== JSON.stringify(original);
  const have = new Set(tools.map(t => t?.function?.name));
  const extra = (bookings ? VOICE_BOOKING_TOOLS : []).filter(n => !have.has(n)).map(name => bookingTool(name, server));
  const messages = Array.isArray(model.messages) ? model.messages : [];
  const i = messages.findIndex(m => m?.role === 'system');
  const current = i >= 0 ? String(messages[i].content || '') : '';
  const a = current.indexOf(START), b = current.indexOf(END);
  const base = a >= 0 && b > a ? (current.slice(0, a) + current.slice(b + END.length)).trimEnd() : current;
  const content = (base ? base + '\n\n' : '') + rule;
  if (!extra.length && content === current && !toolsChanged) return model;
  const next = { ...model, tools: [...tools, ...extra] };
  next.messages = i >= 0 ? messages.map((m, k) => k === i ? { ...m, content } : m) : [{ role: 'system', content: rule }, ...messages];
  return next;
}

export async function syncCallBookingTools(pool, restaurantId, { env = process.env, fetcher = fetch, log = console } = {}) {
  const apiKey = env.VAPI_API_KEY;
  if (!apiKey) return { skipped: 'no key' };
  const profile = await getProfile(pool, restaurantId);
  const bookings = Boolean(profile?.bookings_enabled);
  const transfer = await getTransferPhone(pool, restaurantId);
  const category = profile?.category || 'restaurant';
  // Restaurants without bookings still get "transfer to a person" once a reception phone is set.
  // Clinics, salons and hotels are always synced so they never greet callers like a restaurant.
  if (!bookings && !transfer && category === 'restaurant') return { skipped: 'bookings off' };
  let name = '';
  try { const [[r]] = await pool.execute('SELECT name FROM restaurants WHERE id=?', [restaurantId]); name = r?.name || ''; } catch {}
  const notes = await getAiNotes(pool, restaurantId);
  const rule = bookings || category !== 'restaurant' ? businessCallRule(category, name, transfer, notes, { bookings }) : transferOnlyRule(transfer, notes);
  const greeting = businessGreeting(category, name);
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
      if (bookings && !server?.url) throw Error('order tool server not found');
      const model = withBookingTools(assistant.model, server, rule, transfer, { bookings });
      const patch = {};
      if (model !== assistant.model) patch.model = model;
      if (greeting && assistant.firstMessage !== greeting) patch.firstMessage = greeting;
      if (!Object.keys(patch).length) continue;
      const res = await fetcher('https://api.vapi.ai/assistant/' + id, { method: 'PATCH', headers, redirect: 'error', signal: AbortSignal.timeout(20000), body: JSON.stringify(patch) });
      if (!res.ok) throw Error('Vapi ' + res.status);
      updated++;
    } catch (error) { failed++; log.warn?.('AI Caller booking tools for business #' + restaurantId + ' failed: ' + String(error.message).slice(0, 120)); }
  }
  log.log?.('AI Caller booking tools for business #' + restaurantId + ': ' + updated + ' updated, ' + failed + ' failed');
  return { updated, failed };
}
