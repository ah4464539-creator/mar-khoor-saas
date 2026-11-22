// AI booking on WhatsApp and AI calls: the AI checks free times and proposes a booking; the system
// re-checks everything and creates it. Additive tables only. No express import.
import { BUSINESS_TYPES, getProfile, listServices, listResources, availability, createBooking, localNow, ensureBookingTables, isDate, addDays } from './bookings.js';
import { LANGS, lang, money, sendText } from './whatsapp-orders.js';

export const BOOKING_CHAT_SQL = [
  `CREATE TABLE IF NOT EXISTS whatsapp_booking_drafts (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 restaurant_id BIGINT UNSIGNED NOT NULL,
 phone_number_id VARCHAR(64) NOT NULL,
 customer VARCHAR(32) NOT NULL,
 payload TEXT NOT NULL,
 language VARCHAR(8) NOT NULL DEFAULT 'en',
 status VARCHAR(16) NOT NULL DEFAULT 'awaiting',
 booking_id BIGINT UNSIGNED NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY ix_wa_booking_drafts (restaurant_id, phone_number_id, customer, status),
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS whatsapp_bookings (
 booking_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
 restaurant_id BIGINT UNSIGNED NOT NULL,
 phone_number_id VARCHAR(64) NOT NULL,
 customer VARCHAR(32) NOT NULL,
 language VARCHAR(8) NOT NULL DEFAULT 'en',
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY ix_wa_bookings (restaurant_id),
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB`,
];
const ready = new WeakMap();
export function ensureBookingChatTables(pool) {
  if (!ready.has(pool)) ready.set(pool, (async () => { await ensureBookingTables(pool); for (const sql of BOOKING_CHAT_SQL) await pool.query(sql); })().catch(e => { ready.delete(pool); throw e; }));
  return ready.get(pool);
}

/** What the AI needs to take bookings, or null when this business takes none. */
export async function bookingContext(pool, restaurantId) {
  try {
    const profile = await getProfile(pool, restaurantId);
    if (!profile) return null;
    const services = profile.bookings_enabled ? await listServices(pool, restaurantId, { activeOnly: true }) : [];
    const ready = Boolean(profile.bookings_enabled && services.length);
    // Restaurants without table bookings keep the plain food-ordering assistant.
    if (profile.category === 'restaurant' && !ready) return null;
    const resources = ready ? await listResources(pool, restaurantId, { activeOnly: true }) : [];
    return { profile, services, resources, ready, today: localNow(profile.timezone).slice(0, 10), now: localNow(profile.timezone) };
  } catch { return null; }
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const hm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
export function hoursText(hours) {
  return DAYS.map((d, i) => d + ' ' + ((hours[i] || []).map(([a, b]) => hm(a) + '-' + hm(b)).join(', ') || 'closed')).join('; ');
}

/** System prompt part describing the business and how to book. */
export function bookingPrompt(ctx, currency) {
  const type = BUSINESS_TYPES[ctx.profile.category];
  if (!ctx.ready) return 'Online booking is not set up yet. Answer politely, take the customer name and what they need, and say the business will contact them to fix a time. Never promise a time.';
  const night = type.booking === 'night';
  const services = ctx.services.map(s => ({ id: s.id, name: s.name, description: s.description || undefined, price: money(s.price_minor, currency) + (night ? ' per night' : ''), duration_minutes: night ? undefined : s.duration_min, category: s.category || undefined, staff: s.resource_ids.length ? ctx.resources.filter(r => s.resource_ids.includes(r.id)).map(r => ({ id: r.id, name: r.name, specialty: r.specialty || undefined })) : undefined }));
  return 'Bookings: this business takes ' + (night ? 'room reservations (check-in and check-out dates)' : type.unit + 's at set times') + '. '
    + type.services + ' JSON: ' + JSON.stringify(services) + '. '
    + (night ? '' : 'Opening hours: ' + hoursText(ctx.profile.hours) + '. ')
    + 'Today is ' + ctx.today + ' (' + DAYS[new Date(ctx.today + 'T00:00:00Z').getUTCDay()] + '), time now ' + ctx.now.slice(11) + ' local. '
    + 'To book: find out which ' + type.service.toLowerCase() + ', which day' + (night ? ' and check-out day' : ' and a preferred time') + ', then call check_availability. '
    + 'Offer at most 3 free times from its answer, never times it did not return. Then ask the customer name (and number of people if relevant). '
    + 'When the customer has chosen, call propose_booking; the system sends a summary with Confirm/Change buttons. Never say a booking is confirmed yourself. '
    + 'Convert words like "tomorrow" or "next Monday" to YYYY-MM-DD dates.';
}

export const CHECK_AVAILABILITY_TOOL = { type: 'function', function: {
  name: 'check_availability',
  description: 'Free times (or rooms) for one service on a date. Call before offering any time.',
  parameters: { type: 'object', additionalProperties: false, required: ['service_id', 'date'], properties: {
    service_id: { type: 'integer' },
    date: { type: 'string', description: 'YYYY-MM-DD (check-in date for rooms)' },
    check_out: { type: 'string', description: 'YYYY-MM-DD check-out date, rooms only' },
    staff_id: { type: 'integer', description: 'Only when the customer asked for a specific person' },
  } },
} };
export const PROPOSE_BOOKING_TOOL = { type: 'function', function: {
  name: 'propose_booking',
  description: 'Call ONLY when the customer chose the service, the date, a free time from check_availability (rooms: check-in and check-out), and gave their name. The system then sends an exact summary with Confirm/Change buttons.',
  parameters: { type: 'object', additionalProperties: false, required: ['service_id', 'date', 'customer_name', 'language'], properties: {
    service_id: { type: 'integer' },
    date: { type: 'string', description: 'YYYY-MM-DD' },
    time: { type: 'string', description: 'HH:MM, from check_availability (not for rooms)' },
    check_out: { type: 'string', description: 'YYYY-MM-DD, rooms only' },
    staff_id: { type: 'integer' },
    customer_name: { type: 'string' },
    guests: { type: 'integer', minimum: 1, maximum: 50 },
    note: { type: 'string' },
    language: { type: 'string', enum: LANGS, description: 'Language the customer writes in: en, roman (Roman Urdu), ur (Urdu script), ar.' },
  } },
} };

/** Runs check_availability for the AI; returns a small JSON-able answer. */
export async function runAvailability(pool, restaurantId, args) {
  if (!isDate(args?.date)) return { error: 'date must be YYYY-MM-DD' };
  const result = await availability(pool, restaurantId, { serviceId: args.service_id, date: args.date, checkOut: args.check_out || (isDate(args.date) ? addDays(args.date, 1) : '') });
  if (result.error) return { error: result.error };
  if (result.kind === 'night') return { rooms_left: result.rooms_left, nights: result.nights, total: result.total_minor };
  let slots = result.slots;
  if (args.staff_id) slots = slots.filter(s => s.resource_id === Number(args.staff_id));
  return { date: args.date, free_times: slots.slice(0, 24).map(s => s.time), more: slots.length > 24 };
}

/** Checks the AI's proposal against real availability. Returns { value } or { error }. */
export async function buildBookingDraft(pool, restaurantId, args) {
  const name = String(args?.customer_name || '').trim().slice(0, 120);
  if (!name) return { error: 'Ask the customer name first' };
  if (!isDate(args?.date)) return { error: 'date must be YYYY-MM-DD' };
  const result = await availability(pool, restaurantId, { serviceId: args.service_id, date: args.date, checkOut: args.check_out });
  if (result.error) return { error: result.error };
  const value = { service_id: result.service.id, service: result.service.name, date: args.date, customer_name: name, guests: Math.min(50, Math.max(1, Number(args.guests) || 1)), note: String(args.note || '').slice(0, 300), language: lang(args.language) };
  if (result.kind === 'night') {
    if (result.rooms_left < 1) return { error: 'No rooms free for those dates; ask for other dates' };
    Object.assign(value, { check_out: args.check_out, nights: result.nights, price_minor: result.total_minor });
  } else {
    const time = String(args.time || '').slice(0, 5);
    const slot = result.slots.find(s => s.time === time && (!args.staff_id || s.resource_id === Number(args.staff_id)));
    if (!slot) return { error: 'That time is not free; call check_availability again and offer the free times' };
    Object.assign(value, { time, staff_id: args.staff_id ? Number(args.staff_id) : null, price_minor: result.service.price_minor });
  }
  return { value };
}

const BT = {
  en: { rescheduled: (id, when) => 'Your booking #' + id + ' has been moved to ' + when + '.', reminder: (id, when, name) => 'Reminder: your booking #' + id + ' at ' + name + ' is on ' + when + '. Reply here if you need to change it.', title: 'Please check your booking:', name: 'Name', when: 'When', stay: 'Stay', price: 'Price', confirm: 'Confirm', change: 'Change', nights: n => n + ' night' + (n > 1 ? 's' : ''), done: id => 'Booking received ✅ (#' + id + '). We will confirm it shortly.', changeAsk: 'Sure, what would you like to change?', expired: 'This summary has expired or the time was taken. Please tell me again what you would like to book.', confirmed: id => 'Your booking #' + id + ' is confirmed ✅. See you then!', cancelled: id => 'Sorry, booking #' + id + ' has been cancelled. Reply here to choose another time.', completed: id => 'Thank you for visiting! (booking #' + id + ')' },
  roman: { rescheduled: (id, when) => 'Aap ki booking #' + id + ' ka waqt ab ' + when + ' hai.', reminder: (id, when, name) => 'Yaad dihani: ' + name + ' mein aap ki booking #' + id + ' ' + when + ' ko hai. Tabdeeli ke liye yahan reply karein.', title: 'Apni booking check karein:', name: 'Naam', when: 'Waqt', stay: 'Qayam', price: 'Qeemat', confirm: 'Confirm', change: 'Tabdeel', nights: n => n + ' raat', done: id => 'Booking mil gayi ✅ (#' + id + '). Hum jald confirm karenge.', changeAsk: 'Ji zaroor, kya tabdeel karna hai?', expired: 'Yeh summary purani ho gayi ya waqt kisi aur ne le liya. Dobara batayein kya book karna hai.', confirmed: id => 'Aap ki booking #' + id + ' confirm ho gayi ✅. Shukriya!', cancelled: id => 'Maazrat, booking #' + id + ' cancel ho gayi hai. Naya waqt chunne ke liye yahan reply karein.', completed: id => 'Aane ka shukriya! (booking #' + id + ')' },
  ur: { rescheduled: (id, when) => 'آپ کی بکنگ #' + id + ' کا وقت اب ' + when + ' ہے۔', reminder: (id, when, name) => 'یاد دہانی: ' + name + ' میں آپ کی بکنگ #' + id + ' ' + when + ' کو ہے۔', title: 'براہ کرم اپنی بکنگ دیکھ لیں:', name: 'نام', when: 'وقت', stay: 'قیام', price: 'قیمت', confirm: 'تصدیق', change: 'تبدیلی', nights: n => n + ' رات', done: id => 'بکنگ موصول ہو گئی ✅ (#' + id + ')۔ ہم جلد تصدیق کریں گے۔', changeAsk: 'جی ضرور، کیا تبدیل کرنا ہے؟', expired: 'یہ خلاصہ پرانا ہو گیا یا وقت لے لیا گیا۔ دوبارہ بتائیں کیا بک کرنا ہے۔', confirmed: id => 'آپ کی بکنگ #' + id + ' کی تصدیق ہو گئی ✅۔ شکریہ!', cancelled: id => 'معذرت، بکنگ #' + id + ' منسوخ ہو گئی ہے۔ نیا وقت چننے کے لیے یہاں جواب دیں۔', completed: id => 'آنے کا شکریہ! (بکنگ #' + id + ')' },
  ar: { rescheduled: (id, when) => 'تم نقل حجزك #' + id + ' إلى ' + when + '.', reminder: (id, when, name) => 'تذكير: حجزك #' + id + ' في ' + name + ' بتاريخ ' + when + '.', title: 'يرجى مراجعة حجزك:', name: 'الاسم', when: 'الموعد', stay: 'الإقامة', price: 'السعر', confirm: 'تأكيد', change: 'تعديل', nights: n => n + ' ليلة', done: id => 'تم استلام الحجز ✅ (#' + id + '). سنؤكده قريباً.', changeAsk: 'بالتأكيد، ماذا تريد أن تغير؟', expired: 'انتهت صلاحية هذا الملخص أو حُجز الموعد. أخبرني مرة أخرى بما تريد حجزه.', confirmed: id => 'تم تأكيد حجزك #' + id + ' ✅. نراك قريباً!', cancelled: id => 'عذراً، تم إلغاء الحجز #' + id + '. رد هنا لاختيار موعد آخر.', completed: id => 'شكراً لزيارتك! (الحجز #' + id + ')' },
};
const bt = l => BT[lang(l)] || BT.en;

export function bookingSummary(draft, currency) {
  const t = bt(draft.language);
  const lines = [t.title, '• ' + draft.service, '• ' + t.name + ': ' + draft.customer_name];
  lines.push(draft.check_out ? '• ' + t.stay + ': ' + draft.date + ' → ' + draft.check_out + ' (' + t.nights(draft.nights) + ')' : '• ' + t.when + ': ' + draft.date + ' ' + draft.time);
  if (draft.guests > 1) lines.push('• 👥 ' + draft.guests);
  if (draft.price_minor) lines.push('• ' + t.price + ': ' + money(draft.price_minor, currency));
  return lines.join('\n');
}
export const bookingButtons = (draftId, language) => [{ type: 'reply', reply: { id: 'mk_bconfirm:' + draftId, title: bt(language).confirm.slice(0, 20) } }, { type: 'reply', reply: { id: 'mk_bchange:' + draftId, title: bt(language).change.slice(0, 20) } }];
export const bookingChangeText = l => bt(l).changeAsk;
export const bookingExpiredText = l => bt(l).expired;
export function parseBookingReply(text) {
  const m = /^mk_b(confirm|change):(\d{1,12})$/.exec(String(text || '').trim());
  return m ? { action: m[1], draftId: Number(m[2]) } : null;
}

export async function saveBookingDraft(pool, job, draft) {
  await ensureBookingChatTables(pool);
  await pool.execute("UPDATE whatsapp_booking_drafts SET status='changed' WHERE restaurant_id=? AND phone_number_id=? AND customer=? AND status='awaiting'", [job.restaurant_id, job.phone_number_id, job.sender]);
  const [r] = await pool.execute('INSERT INTO whatsapp_booking_drafts(restaurant_id,phone_number_id,customer,payload,language) VALUES (?,?,?,?,?)', [job.restaurant_id, job.phone_number_id, job.sender, JSON.stringify(draft), draft.language]);
  return Number(r.insertId);
}
/** The draft a button points to, or (typed "yes") the latest awaiting one from the last 30 minutes. */
export async function findBookingDraft(pool, job, draftId = null) {
  try {
    await ensureBookingChatTables(pool);
    const [rows] = draftId
      ? await pool.execute('SELECT *, created_at>=NOW()-INTERVAL 30 MINUTE AS fresh FROM whatsapp_booking_drafts WHERE id=? AND restaurant_id=? AND phone_number_id=? AND customer=? LIMIT 1', [draftId, job.restaurant_id, job.phone_number_id, job.sender])
      : await pool.execute("SELECT *, 1 AS fresh FROM whatsapp_booking_drafts WHERE restaurant_id=? AND phone_number_id=? AND customer=? AND status='awaiting' AND created_at>=NOW()-INTERVAL 30 MINUTE ORDER BY id DESC LIMIT 1", [job.restaurant_id, job.phone_number_id, job.sender]);
    if (!rows.length) return null;
    const row = rows[0];
    return { id: Number(row.id), status: row.status, fresh: Boolean(Number(row.fresh)), booking_id: row.booking_id == null ? null : Number(row.booking_id), language: row.language, draft: JSON.parse(row.payload) };
  } catch { return null; }
}
export async function markBookingDraft(pool, id, status) {
  await pool.execute('UPDATE whatsapp_booking_drafts SET status=? WHERE id=?', [status, id]);
}

/** Confirm tap: create the booking (re-checked), link it to WhatsApp. Idempotent per draft. */
export async function placeBooking(pool, job, found) {
  if (found.status === 'confirmed' && found.booking_id) return { booking_id: found.booking_id, repeat: true };
  if (found.status !== 'awaiting' || !found.fresh) return { error: 'expired' };
  const d = found.draft;
  const phone = '+' + String(job.sender).replace(/\D/g, '');
  const result = await createBooking(pool, job.restaurant_id, { service_id: d.service_id, date: d.date, time: d.time, check_out: d.check_out, resource_id: d.staff_id, customer_name: d.customer_name, customer_phone: phone, guests: d.guests, note: d.note, source: 'whatsapp' });
  if (result.error) { await markBookingDraft(pool, found.id, 'expired'); return { error: 'taken' }; }
  const id = result.booking.id;
  await pool.execute("UPDATE whatsapp_booking_drafts SET status='confirmed',booking_id=? WHERE id=?", [id, found.id]);
  await pool.execute('INSERT INTO whatsapp_bookings(booking_id,restaurant_id,phone_number_id,customer,language) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE booking_id=booking_id', [id, job.restaurant_id, job.phone_number_id, job.sender, found.language]);
  return { booking_id: id, booking: result.booking };
}
export const bookingReceivedText = (id, language) => bt(language).done(id);

/** Owner changed a booking's status: tell a WhatsApp customer (only inside the 24-hour window). */
export async function notifyBookingStatus(pool, restaurantId, bookingId, status, { fetcher = fetch, env = process.env, tokenFor = null, log = console, when = '' } = {}) {
  try {
    await ensureBookingChatTables(pool);
    const [rows] = await pool.execute('SELECT phone_number_id,customer,language FROM whatsapp_bookings WHERE booking_id=? AND restaurant_id=? LIMIT 1', [bookingId, restaurantId]);
    if (!rows.length) return { sent: false, reason: 'not_whatsapp' };
    const o = rows[0], t = bt(o.language);
    const text = status === 'confirmed' ? t.confirmed(bookingId) : status === 'cancelled' ? t.cancelled(bookingId) : status === 'completed' ? t.completed(bookingId) : status === 'rescheduled' && when ? t.rescheduled(bookingId, when) : '';
    if (!text) return { sent: false, reason: 'no_message' };
    const [recent] = await pool.execute('SELECT 1 FROM whatsapp_inbound_messages WHERE restaurant_id=? AND phone_number_id=? AND sender=? AND received_at>=NOW()-INTERVAL 23 HOUR LIMIT 1', [restaurantId, o.phone_number_id, o.customer]);
    if (!recent.length) { log.log?.('WhatsApp booking status not sent (24h window closed) for booking #' + bookingId); return { sent: false, reason: 'window_closed' }; }
    const token = (tokenFor ? await tokenFor(o.phone_number_id) : null) || env.WHATSAPP_ACCESS_TOKEN;
    if (!token) return { sent: false, reason: 'no_token' };
    const id = await sendText(fetcher, env, token, o.phone_number_id, o.customer, text);
    await pool.execute('INSERT INTO whatsapp_outbound_messages(message_id,restaurant_id,phone_number_id,recipient,text_body) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE message_id=message_id', [id, restaurantId, o.phone_number_id, o.customer, text]);
    return { sent: true, id };
  } catch (error) {
    log.warn?.('WhatsApp booking status failed for #' + bookingId + ': ' + String(error.message || error).slice(0, 160));
    return { sent: false, reason: 'error' };
  }
}
