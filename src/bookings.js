// Business types and bookings (clinics, salons, hotels; restaurants can take table bookings too).
// Additive tables only (CREATE TABLE IF NOT EXISTS); existing tables are never changed. No express import.
import { pushToRestaurant } from './web-push.js';
// Times are stored as the business's local wall-clock time ('YYYY-MM-DD HH:MM:00') in its own time zone.

export const BUSINESS_TYPES = {
  restaurant: { label: 'Restaurant / cafe', booking: 'slot', resource: 'Table', resources: 'Tables', service: 'Booking type', services: 'Booking types', unit: 'visit' },
  clinic: { label: 'Clinic / doctor', booking: 'slot', resource: 'Doctor', resources: 'Doctors', service: 'Service', services: 'Services', unit: 'appointment' },
  salon: { label: 'Salon / beauty / services', booking: 'slot', resource: 'Staff member', resources: 'Staff', service: 'Service', services: 'Services', unit: 'appointment' },
  hotel: { label: 'Hotel / guest house', booking: 'night', resource: 'Room', resources: 'Rooms', service: 'Room type', services: 'Room types', unit: 'night' },
};
export const isBusinessType = value => Object.hasOwn(BUSINESS_TYPES, value);

const TZ = { PK: 'Asia/Karachi', AE: 'Asia/Dubai', SA: 'Asia/Riyadh', QA: 'Asia/Qatar', KW: 'Asia/Kuwait', BH: 'Asia/Bahrain', OM: 'Asia/Muscat', GB: 'Europe/London', IN: 'Asia/Kolkata', BD: 'Asia/Dhaka', MY: 'Asia/Kuala_Lumpur', SG: 'Asia/Singapore', TR: 'Europe/Istanbul', US: 'America/New_York', DE: 'Europe/Berlin', FR: 'Europe/Paris', GR: 'Europe/Athens' };
export const timezoneFor = country => TZ[country] || 'UTC';

export const BOOKING_SQL = [
  `CREATE TABLE IF NOT EXISTS business_profiles (
 restaurant_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
 category VARCHAR(20) NOT NULL DEFAULT 'restaurant',
 timezone VARCHAR(60) NULL,
 hours_json TEXT NULL,
 slot_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 30,
 bookings_enabled TINYINT(1) NOT NULL DEFAULT 1,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS booking_services (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 restaurant_id BIGINT UNSIGNED NOT NULL,
 name VARCHAR(120) NOT NULL,
 description VARCHAR(400) NULL,
 duration_min SMALLINT UNSIGNED NOT NULL DEFAULT 30,
 price_minor BIGINT UNSIGNED NOT NULL DEFAULT 0,
 capacity SMALLINT UNSIGNED NOT NULL DEFAULT 1,
 resource_ids VARCHAR(400) NULL,
 active TINYINT(1) NOT NULL DEFAULT 1,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY ix_booking_services (restaurant_id, active),
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS booking_resources (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 restaurant_id BIGINT UNSIGNED NOT NULL,
 name VARCHAR(120) NOT NULL,
 note VARCHAR(200) NULL,
 active TINYINT(1) NOT NULL DEFAULT 1,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY ix_booking_resources (restaurant_id, active),
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS bookings (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 restaurant_id BIGINT UNSIGNED NOT NULL,
 service_id BIGINT UNSIGNED NULL,
 resource_id BIGINT UNSIGNED NULL,
 customer_name VARCHAR(120) NOT NULL,
 customer_phone VARCHAR(32) NOT NULL,
 start_at DATETIME NOT NULL,
 end_at DATETIME NOT NULL,
 guests SMALLINT UNSIGNED NOT NULL DEFAULT 1,
 price_minor BIGINT UNSIGNED NOT NULL DEFAULT 0,
 status VARCHAR(20) NOT NULL DEFAULT 'pending',
 source VARCHAR(20) NOT NULL DEFAULT 'owner',
 note VARCHAR(500) NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 KEY ix_bookings_time (restaurant_id, start_at),
 KEY ix_bookings_status (restaurant_id, status),
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB`,
];

const ready = new WeakMap();
export function ensureBookingTables(pool) {
  if (!ready.has(pool)) ready.set(pool, (async () => { for (const sql of BOOKING_SQL) await pool.query(sql); })().catch(error => { ready.delete(pool); throw error; }));
  return ready.get(pool);
}

const text = (value, max) => (typeof value === 'string' ? value : '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const int = (value, min, max, fallback) => { const n = Number(value); return Number.isInteger(n) && n >= min && n <= max ? n : fallback; };

// ---- Opening hours: { "0": [[540, 1020]], ... } minutes from midnight, 0 = Sunday ----
export const DEFAULT_HOURS = { 0: [], 1: [[540, 1080]], 2: [[540, 1080]], 3: [[540, 1080]], 4: [[540, 1080]], 5: [[540, 1080]], 6: [[600, 1020]] };
export function cleanHours(value) {
  const out = {};
  for (let d = 0; d < 7; d++) {
    const list = Array.isArray(value?.[d]) ? value[d] : [];
    out[d] = list.map(r => [int(r?.[0], 0, 1440, -1), int(r?.[1], 0, 1440, -1)]).filter(([a, b]) => a >= 0 && b > a).slice(0, 3);
  }
  return out;
}

// ---- Dates (local wall clock, no time zone maths) ----
export const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
export const isDateTime = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/.test(s.slice(0, 16)) && isDate(s.slice(0, 10));
const pad = n => String(n).padStart(2, '0');
export const minutesToTime = m => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
export const weekday = date => new Date(date + 'T00:00:00Z').getUTCDay();
export function addDays(date, days) { const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
export const nightsBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
/** 'YYYY-MM-DD HH:MM' now in the business's time zone. */
export function localNow(timezone, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type, p.value]));
  return parts.year + '-' + parts.month + '-' + parts.day + ' ' + parts.hour + ':' + parts.minute;
}
const toMin = dt => Number(dt.slice(11, 13)) * 60 + Number(dt.slice(14, 16));
const stamp = (date, minutes) => date + ' ' + minutesToTime(minutes);
const norm = v => (v instanceof Date ? v.toISOString().replace('T', ' ') : String(v)).slice(0, 16);
const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

/**
 * Free start times for a time-slot service on one date.
 * service: { duration_min, capacity, resource_ids:[...] }; bookings: [{start_at,end_at,resource_id,service_id}] (not cancelled)
 * Returns [{ time:'HH:MM', resource_id|null }].
 */
export function freeSlots({ date, hours, step = 30, service, bookings = [], now = '' }) {
  if (!isDate(date)) return [];
  const ranges = cleanHours(hours)[weekday(date)] || [];
  const duration = Math.max(5, service.duration_min || 30);
  const resources = service.resource_ids?.length ? service.resource_ids : null;
  const sameDay = bookings.map(b => ({ s: norm(b.start_at), e: norm(b.end_at), r: b.resource_id == null ? null : Number(b.resource_id), sv: b.service_id == null ? null : Number(b.service_id) }));
  const out = [];
  for (const [open, close] of ranges) {
    for (let m = open; m + duration <= close; m += Math.max(5, step)) {
      const s = stamp(date, m), e = stamp(date, m + duration);
      if (now && s <= now) continue;
      const busy = sameDay.filter(b => overlaps(s, e, b.s, b.e));
      if (resources) {
        const free = resources.find(id => !busy.some(b => b.r === Number(id)));
        if (free != null) out.push({ time: minutesToTime(m), resource_id: Number(free) });
      } else if (busy.filter(b => b.sv === Number(service.id)).length < Math.max(1, service.capacity || 1)) {
        out.push({ time: minutesToTime(m), resource_id: null });
      }
    }
  }
  return out;
}

/** Rooms left of a room type for check-in..check-out (nights). */
export function roomsLeft({ service, checkIn, checkOut, bookings = [] }) {
  const s = checkIn + ' 14:00', e = checkOut + ' 12:00';
  const taken = bookings.filter(b => Number(b.service_id) === Number(service.id) && overlaps(s, e, norm(b.start_at), norm(b.end_at))).length;
  return Math.max(0, Math.max(1, service.capacity || 1) - taken);
}

// ---- Validation ----
export function cleanService(body, type) {
  const name = text(body?.name, 120);
  if (!name) return { error: 'Enter a name' };
  const night = BUSINESS_TYPES[type]?.booking === 'night';
  const price = Math.round(Number(body?.price ?? 0) * 100);
  if (!Number.isFinite(price) || price < 0 || price > 1e11) return { error: 'Enter a valid price' };
  const resourceIds = Array.isArray(body?.resource_ids) ? [...new Set(body.resource_ids.map(Number).filter(n => Number.isSafeInteger(n) && n > 0))].slice(0, 30) : [];
  return { value: {
    name, description: text(body?.description, 400) || null,
    duration_min: night ? 1440 : int(body?.duration_min, 5, 720, 30),
    price_minor: price,
    capacity: int(body?.capacity, 1, 500, 1),
    resource_ids: night ? [] : resourceIds,
    active: body?.active === false ? 0 : 1,
  } };
}
export function cleanResource(body) {
  const name = text(body?.name, 120);
  if (!name) return { error: 'Enter a name' };
  return { value: { name, note: text(body?.note, 200) || null, active: body?.active === false ? 0 : 1 } };
}
export const BOOKING_STATUSES = ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'];
export const BOOKING_SOURCES = ['owner', 'website', 'whatsapp', 'call'];
export function cleanPhone(value) {
  const raw = text(value, 40).replace(/[\s()-]/g, '');
  return /^\+?\d{7,16}$/.test(raw) ? raw : '';
}

// ---- Database helpers ----
const parseIds = v => { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a.map(Number).filter(Boolean) : []; } catch { return []; } };
const serviceRow = r => ({ id: Number(r.id), name: r.name, description: r.description, duration_min: Number(r.duration_min), price_minor: Number(r.price_minor), capacity: Number(r.capacity), resource_ids: parseIds(r.resource_ids), active: Boolean(r.active) });

export async function getProfile(pool, restaurantId) {
  await ensureBookingTables(pool);
  const [[r]] = await pool.execute('SELECT r.country_code,b.category,b.timezone,b.hours_json,b.slot_minutes,b.bookings_enabled FROM restaurants r LEFT JOIN business_profiles b ON b.restaurant_id=r.id WHERE r.id=?', [restaurantId]);
  if (!r) return null;
  let hours = DEFAULT_HOURS;
  try { if (r.hours_json) hours = cleanHours(JSON.parse(r.hours_json)); } catch {}
  const category = isBusinessType(r.category) ? r.category : 'restaurant';
  return { category, type: BUSINESS_TYPES[category], timezone: r.timezone || timezoneFor(r.country_code), hours, slot_minutes: Number(r.slot_minutes) || 30, bookings_enabled: r.bookings_enabled == null ? category !== 'restaurant' : Boolean(r.bookings_enabled) };
}
export async function saveProfile(pool, restaurantId, body = {}) {
  await ensureBookingTables(pool);
  const current = await getProfile(pool, restaurantId);
  const category = isBusinessType(body.category) ? body.category : current?.category || 'restaurant';
  const hours = body.hours ? cleanHours(body.hours) : current?.hours || DEFAULT_HOURS;
  const slot = int(body.slot_minutes, 5, 240, current?.slot_minutes || 30);
  const enabled = typeof body.bookings_enabled === 'boolean' ? body.bookings_enabled : current?.bookings_enabled ?? category !== 'restaurant';
  await pool.execute('INSERT INTO business_profiles(restaurant_id,category,hours_json,slot_minutes,bookings_enabled) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE category=VALUES(category),hours_json=VALUES(hours_json),slot_minutes=VALUES(slot_minutes),bookings_enabled=VALUES(bookings_enabled)',
    [restaurantId, category, JSON.stringify(hours), slot, enabled ? 1 : 0]);
  return getProfile(pool, restaurantId);
}
/** Categories for many restaurants at once; missing = restaurant. Never throws. */
export async function categoriesFor(pool, ids) {
  const out = new Map(ids.map(id => [Number(id), 'restaurant']));
  if (!ids.length) return out;
  try {
    await ensureBookingTables(pool);
    const [rows] = await pool.query('SELECT restaurant_id,category FROM business_profiles WHERE restaurant_id IN (?)', [ids]);
    for (const r of rows) if (isBusinessType(r.category)) out.set(Number(r.restaurant_id), r.category);
  } catch {}
  return out;
}

export async function listServices(pool, restaurantId, { activeOnly = false } = {}) {
  await ensureBookingTables(pool);
  const [rows] = await pool.execute('SELECT * FROM booking_services WHERE restaurant_id=?' + (activeOnly ? ' AND active=1' : '') + ' ORDER BY id', [restaurantId]);
  return rows.map(serviceRow);
}
export async function listResources(pool, restaurantId, { activeOnly = false } = {}) {
  await ensureBookingTables(pool);
  const [rows] = await pool.execute('SELECT id,name,note,active FROM booking_resources WHERE restaurant_id=?' + (activeOnly ? ' AND active=1' : '') + ' ORDER BY id', [restaurantId]);
  return rows.map(r => ({ id: Number(r.id), name: r.name, note: r.note, active: Boolean(r.active) }));
}
export async function saveService(pool, restaurantId, id, value) {
  await ensureBookingTables(pool);
  const resources = await listResources(pool, restaurantId);
  const allowed = new Set(resources.map(r => r.id));
  const ids = JSON.stringify(value.resource_ids.filter(x => allowed.has(x)));
  if (id) {
    const [r] = await pool.execute('UPDATE booking_services SET name=?,description=?,duration_min=?,price_minor=?,capacity=?,resource_ids=?,active=? WHERE id=? AND restaurant_id=?', [value.name, value.description, value.duration_min, value.price_minor, value.capacity, ids, value.active, id, restaurantId]);
    return r.affectedRows ? id : null;
  }
  const [count] = await pool.execute('SELECT COUNT(*) n FROM booking_services WHERE restaurant_id=?', [restaurantId]);
  if (Number(count[0].n) >= 100) return null;
  const [r] = await pool.execute('INSERT INTO booking_services(restaurant_id,name,description,duration_min,price_minor,capacity,resource_ids,active) VALUES (?,?,?,?,?,?,?,?)', [restaurantId, value.name, value.description, value.duration_min, value.price_minor, value.capacity, ids, value.active]);
  return Number(r.insertId);
}
export async function saveResource(pool, restaurantId, id, value) {
  await ensureBookingTables(pool);
  if (id) {
    const [r] = await pool.execute('UPDATE booking_resources SET name=?,note=?,active=? WHERE id=? AND restaurant_id=?', [value.name, value.note, value.active, id, restaurantId]);
    return r.affectedRows ? id : null;
  }
  const [count] = await pool.execute('SELECT COUNT(*) n FROM booking_resources WHERE restaurant_id=?', [restaurantId]);
  if (Number(count[0].n) >= 100) return null;
  const [r] = await pool.execute('INSERT INTO booking_resources(restaurant_id,name,note,active) VALUES (?,?,?,?)', [restaurantId, value.name, value.note, value.active]);
  return Number(r.insertId);
}

async function busyBetween(pool, restaurantId, from, to) {
  const [rows] = await pool.execute("SELECT id,service_id,resource_id,start_at,end_at FROM bookings WHERE restaurant_id=? AND status NOT IN ('cancelled','no_show') AND start_at<? AND end_at>?", [restaurantId, to, from]);
  return rows;
}

/** Availability for a service: slots for a date, or rooms left for a stay. */
export async function availability(pool, restaurantId, { serviceId, date, checkOut }) {
  const profile = await getProfile(pool, restaurantId);
  const service = (await listServices(pool, restaurantId, { activeOnly: true })).find(s => s.id === Number(serviceId));
  if (!profile || !service) return { error: 'Service not found' };
  const now = localNow(profile.timezone);
  if (profile.type.booking === 'night') {
    if (!isDate(date) || !isDate(checkOut) || nightsBetween(date, checkOut) < 1 || nightsBetween(date, checkOut) > 60) return { error: 'Choose check-in and check-out dates' };
    if (date < now.slice(0, 10)) return { error: 'Choose a date from today' };
    const busy = await busyBetween(pool, restaurantId, date + ' 00:00', checkOut + ' 23:59');
    const left = roomsLeft({ service, checkIn: date, checkOut, bookings: busy });
    return { kind: 'night', service, nights: nightsBetween(date, checkOut), rooms_left: left, total_minor: service.price_minor * nightsBetween(date, checkOut) };
  }
  if (!isDate(date)) return { error: 'Choose a date' };
  const busy = await busyBetween(pool, restaurantId, date + ' 00:00', addDays(date, 1) + ' 00:00');
  return { kind: 'slot', service, slots: freeSlots({ date, hours: profile.hours, step: profile.slot_minutes, service, bookings: busy, now }) };
}

/**
 * Create a booking after re-checking availability (never trusts the client's time or price).
 * input: { service_id, date, time?, check_out?, resource_id?, customer_name, customer_phone, guests?, note?, source, status? }
 */
export async function createBooking(pool, restaurantId, input) {
  const name = text(input.customer_name, 120), phone = cleanPhone(input.customer_phone);
  if (!name) return { error: 'Enter the customer name' };
  if (!phone) return { error: 'Enter a valid phone number' };
  const source = BOOKING_SOURCES.includes(input.source) ? input.source : 'owner';
  const avail = await availability(pool, restaurantId, { serviceId: input.service_id, date: input.date, checkOut: input.check_out });
  if (avail.error) return avail;
  const service = avail.service;
  let start, end, resourceId = null, price;
  if (avail.kind === 'night') {
    if (avail.rooms_left < 1) return { error: 'No rooms of this type are free for those dates' };
    start = input.date + ' 14:00'; end = input.check_out + ' 12:00'; price = avail.total_minor;
  } else {
    const time = typeof input.time === 'string' ? input.time.slice(0, 5) : '';
    const wanted = input.resource_id ? Number(input.resource_id) : null;
    const slot = avail.slots.find(s => s.time === time && (!wanted || !service.resource_ids.length || s.resource_id === wanted));
    let chosen = slot;
    if (!chosen && wanted && service.resource_ids.includes(wanted)) {
      // the first free resource for that time was someone else; check the wanted one directly
      const profile = await getProfile(pool, restaurantId);
      const busy = await busyBetween(pool, restaurantId, input.date + ' 00:00', addDays(input.date, 1) + ' 00:00');
      const only = freeSlots({ date: input.date, hours: profile.hours, step: profile.slot_minutes, service: { ...service, resource_ids: [wanted] }, bookings: busy, now: localNow(profile.timezone) });
      chosen = only.find(s => s.time === time);
    }
    if (!chosen) return { error: 'That time is no longer free. Pick another time.' };
    const startMin = toMin(input.date + ' ' + time);
    start = input.date + ' ' + time; end = stamp(input.date, startMin + service.duration_min); resourceId = chosen.resource_id; price = service.price_minor;
  }
  const status = input.status === 'confirmed' ? 'confirmed' : 'pending';
  const [r] = await pool.execute('INSERT INTO bookings(restaurant_id,service_id,resource_id,customer_name,customer_phone,start_at,end_at,guests,price_minor,status,source,note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    [restaurantId, service.id, resourceId, name, phone, start + ':00', end + ':00', int(input.guests, 1, 50, 1), price, status, source, text(input.note, 500) || null]);
  return { booking: { id: Number(r.insertId), service: service.name, start_at: start, end_at: end, resource_id: resourceId, price_minor: price, status } };
}

export async function listBookings(pool, restaurantId, { from, to, status } = {}) {
  await ensureBookingTables(pool);
  const args = [restaurantId];
  let where = 'b.restaurant_id=?';
  if (isDate(from)) { where += ' AND b.end_at>=?'; args.push(from + ' 00:00:00'); }
  if (isDate(to)) { where += ' AND b.start_at<?'; args.push(addDays(to, 1) + ' 00:00:00'); }
  if (BOOKING_STATUSES.includes(status)) { where += ' AND b.status=?'; args.push(status); }
  const [rows] = await pool.execute('SELECT b.*,s.name service_name,x.name resource_name FROM bookings b LEFT JOIN booking_services s ON s.id=b.service_id AND s.restaurant_id=b.restaurant_id LEFT JOIN booking_resources x ON x.id=b.resource_id AND x.restaurant_id=b.restaurant_id WHERE ' + where + ' ORDER BY b.start_at LIMIT 500', args);
  return rows.map(b => ({ id: Number(b.id), service_id: b.service_id == null ? null : Number(b.service_id), service: b.service_name, resource: b.resource_name, resource_id: b.resource_id == null ? null : Number(b.resource_id), customer_name: b.customer_name, customer_phone: b.customer_phone, start_at: norm(b.start_at), end_at: norm(b.end_at), guests: Number(b.guests), price_minor: Number(b.price_minor), status: b.status, source: b.source, note: b.note }));
}
export async function setBookingStatus(pool, restaurantId, id, status) {
  if (!BOOKING_STATUSES.includes(status)) return false;
  await ensureBookingTables(pool);
  const [r] = await pool.execute('UPDATE bookings SET status=? WHERE id=? AND restaurant_id=?', [status, id, restaurantId]);
  return r.affectedRows > 0;
}

/** Push alert to the owner's devices for a new booking. Never throws. */
export async function notifyNewBooking(pool, restaurantId, booking, source) {
  const when = String(booking.start_at || '').replace(' ', ' at ');
  return pushToRestaurant(pool, restaurantId, { title: '📅 New booking #' + booking.id, body: [booking.service, when, source].filter(Boolean).join(' · '), url: '/restaurant.html#bookings', tag: 'booking-' + booking.id }).catch(() => ({ sent: 0 }));
}
