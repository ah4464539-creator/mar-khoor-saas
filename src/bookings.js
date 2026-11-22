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

const TZ = { PK: 'Asia/Karachi', AE: 'Asia/Dubai', SA: 'Asia/Riyadh', QA: 'Asia/Qatar', KW: 'Asia/Kuwait', BH: 'Asia/Bahrain', OM: 'Asia/Muscat', GB: 'Europe/London', IE: 'Europe/Dublin', IN: 'Asia/Kolkata', BD: 'Asia/Dhaka', LK: 'Asia/Colombo', NP: 'Asia/Kathmandu', MY: 'Asia/Kuala_Lumpur', SG: 'Asia/Singapore', ID: 'Asia/Jakarta', PH: 'Asia/Manila', TH: 'Asia/Bangkok', VN: 'Asia/Ho_Chi_Minh', CN: 'Asia/Shanghai', HK: 'Asia/Hong_Kong', JP: 'Asia/Tokyo', KR: 'Asia/Seoul', TR: 'Europe/Istanbul', EG: 'Africa/Cairo', MA: 'Africa/Casablanca', NG: 'Africa/Lagos', KE: 'Africa/Nairobi', ZA: 'Africa/Johannesburg', DE: 'Europe/Berlin', FR: 'Europe/Paris', ES: 'Europe/Madrid', IT: 'Europe/Rome', NL: 'Europe/Amsterdam', BE: 'Europe/Brussels', CH: 'Europe/Zurich', AT: 'Europe/Vienna', SE: 'Europe/Stockholm', NO: 'Europe/Oslo', DK: 'Europe/Copenhagen', FI: 'Europe/Helsinki', PL: 'Europe/Warsaw', CZ: 'Europe/Prague', GR: 'Europe/Athens', PT: 'Europe/Lisbon', US: 'America/New_York', CA: 'America/Toronto', MX: 'America/Mexico_City', BR: 'America/Sao_Paulo', AR: 'America/Argentina/Buenos_Aires', AU: 'Australia/Sydney', NZ: 'Pacific/Auckland' };
export const timezoneFor = country => TZ[country] || 'UTC';
export function isTimezone(value) { if (typeof value !== 'string' || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(value)) return false; try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }

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
  `CREATE TABLE IF NOT EXISTS booking_service_meta (
 service_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
 restaurant_id BIGINT UNSIGNED NOT NULL,
 category VARCHAR(80) NULL,
 deposit_minor BIGINT UNSIGNED NOT NULL DEFAULT 0,
 KEY ix_booking_service_meta (restaurant_id),
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS booking_resource_meta (
 resource_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
 restaurant_id BIGINT UNSIGNED NOT NULL,
 specialty VARCHAR(80) NULL,
 hours_json TEXT NULL,
 room_status VARCHAR(20) NULL,
 KEY ix_booking_resource_meta (restaurant_id),
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS booking_events (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 restaurant_id BIGINT UNSIGNED NOT NULL,
 booking_id BIGINT UNSIGNED NOT NULL,
 action VARCHAR(30) NOT NULL,
 detail VARCHAR(300) NULL,
 actor VARCHAR(40) NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY ix_booking_events (restaurant_id, booking_id),
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS booking_payments (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 restaurant_id BIGINT UNSIGNED NOT NULL,
 booking_id BIGINT UNSIGNED NOT NULL,
 kind VARCHAR(10) NOT NULL DEFAULT 'payment',
 amount_minor BIGINT UNSIGNED NOT NULL,
 method VARCHAR(40) NULL,
 reference VARCHAR(80) NULL,
 status VARCHAR(12) NOT NULL DEFAULT 'confirmed',
 actor VARCHAR(40) NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY ix_booking_payments (restaurant_id, booking_id),
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS booking_access (
 booking_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
 restaurant_id BIGINT UNSIGNED NOT NULL,
 token CHAR(32) NOT NULL,
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS booking_discounts (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 restaurant_id BIGINT UNSIGNED NOT NULL,
 code VARCHAR(30) NOT NULL,
 percent TINYINT UNSIGNED NOT NULL,
 valid_to DATE NULL,
 active TINYINT(1) NOT NULL DEFAULT 1,
 uses INT UNSIGNED NOT NULL DEFAULT 0,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_booking_discount (restaurant_id, code),
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
export function freeSlots({ date, hours, step = 30, service, bookings = [], now = '', resourceHours = {}, excludeId = null }) {
  if (!isDate(date)) return [];
  const wd = weekday(date);
  const ranges = cleanHours(hours)[wd] || [];
  const duration = Math.max(5, service.duration_min || 30);
  const resources = service.resource_ids?.length ? service.resource_ids.map(Number) : null;
  const sameDay = bookings.filter(b => excludeId == null || Number(b.id) !== Number(excludeId)).map(b => ({ s: norm(b.start_at), e: norm(b.end_at), r: b.resource_id == null ? null : Number(b.resource_id), sv: b.service_id == null ? null : Number(b.service_id) }));
  const stepMin = Math.max(5, step);
  if (!resources) {
    const out = [];
    for (const [open, close] of ranges) {
      for (let m = open; m + duration <= close; m += stepMin) {
        const s = stamp(date, m), e = stamp(date, m + duration);
        if (now && s <= now) continue;
        if (sameDay.filter(b => b.sv === Number(service.id) && overlaps(s, e, b.s, b.e)).length < Math.max(1, service.capacity || 1)) out.push({ time: minutesToTime(m), resource_id: null });
      }
    }
    return out;
  }
  // Each doctor / staff member works their own hours (or the business hours); first free one wins.
  const byTime = new Map();
  for (const id of resources) {
    const own = resourceHours[id] ? (cleanHours(resourceHours[id])[wd] || []) : ranges;
    for (const [open, close] of own) {
      for (let m = open; m + duration <= close; m += stepMin) {
        if (byTime.has(m)) continue;
        const s = stamp(date, m), e = stamp(date, m + duration);
        if (now && s <= now) continue;
        if (!sameDay.some(b => b.r === id && overlaps(s, e, b.s, b.e))) byTime.set(m, id);
      }
    }
  }
  return [...byTime].sort((a, b) => a[0] - b[0]).map(([m, id]) => ({ time: minutesToTime(m), resource_id: id }));
}

/** Rooms left of a room type for check-in..check-out (nights). */
export function roomsLeft({ service, checkIn, checkOut, bookings = [], rooms = null }) {
  const s = checkIn + ' 14:00', e = checkOut + ' 12:00';
  const clash = bookings.filter(b => overlaps(s, e, norm(b.start_at), norm(b.end_at)));
  if (rooms && rooms.length) return rooms.filter(id => !clash.some(b => Number(b.resource_id) === Number(id))).length;
  const taken = clash.filter(b => Number(b.service_id) === Number(service.id)).length;
  return Math.max(0, Math.max(1, service.capacity || 1) - taken);
}
/** First free room of this type for the stay, or null. */
export function freeRoom({ checkIn, checkOut, bookings = [], rooms = [] }) {
  const s = checkIn + ' 14:00', e = checkOut + ' 12:00';
  const clash = bookings.filter(b => overlaps(s, e, norm(b.start_at), norm(b.end_at)));
  return rooms.find(id => !clash.some(b => Number(b.resource_id) === Number(id))) ?? null;
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
    resource_ids: resourceIds,
    active: body?.active === false ? 0 : 1,
    category: text(body?.category, 80) || null,
    deposit_minor: Math.max(0, Math.min(price || 1e11, Math.round(Number(body?.deposit ?? 0) * 100) || 0)),
  } };
}
export const ROOM_STATUSES = ['clean', 'dirty', 'cleaning', 'occupied', 'out_of_order'];
export function cleanResource(body) {
  const name = text(body?.name, 120);
  if (!name) return { error: 'Enter a name' };
  const hours = body?.hours && typeof body.hours === 'object' ? cleanHours(body.hours) : null;
  return { value: { name, note: text(body?.note, 200) || null, active: body?.active === false ? 0 : 1, specialty: text(body?.specialty, 80) || null, hours, room_status: ROOM_STATUSES.includes(body?.room_status) ? body.room_status : null } };
}
export const BOOKING_STATUSES = ['pending', 'confirmed', 'checked_in', 'completed', 'cancelled', 'no_show'];
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
  return { exists: r.category != null, category, type: BUSINESS_TYPES[category], timezone: r.timezone || timezoneFor(r.country_code), hours, slot_minutes: Number(r.slot_minutes) || 30, bookings_enabled: r.bookings_enabled == null ? category !== 'restaurant' : Boolean(r.bookings_enabled) };
}
export async function saveProfile(pool, restaurantId, body = {}) {
  await ensureBookingTables(pool);
  const current = await getProfile(pool, restaurantId);
  const category = isBusinessType(body.category) ? body.category : current?.category || 'restaurant';
  const hours = body.hours ? cleanHours(body.hours) : current?.hours || DEFAULT_HOURS;
  const slot = int(body.slot_minutes, 5, 240, current?.slot_minutes || 30);
  // First save (registration): clinics, salons and hotels take bookings from day one; restaurants opt in.
  const timezone = isTimezone(body.timezone) ? body.timezone : current?.exists ? (await rawTimezone(pool, restaurantId)) : null;
  const enabled = typeof body.bookings_enabled === 'boolean' ? body.bookings_enabled : current?.exists ? current.bookings_enabled : category !== 'restaurant';
  await pool.execute('INSERT INTO business_profiles(restaurant_id,category,timezone,hours_json,slot_minutes,bookings_enabled) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE category=VALUES(category),timezone=VALUES(timezone),hours_json=VALUES(hours_json),slot_minutes=VALUES(slot_minutes),bookings_enabled=VALUES(bookings_enabled)',
    [restaurantId, category, timezone, JSON.stringify(hours), slot, enabled ? 1 : 0]);
  return getProfile(pool, restaurantId);
}
async function rawTimezone(pool, restaurantId) { try { const [[r]] = await pool.execute('SELECT timezone FROM business_profiles WHERE restaurant_id=?', [restaurantId]); return r?.timezone || null; } catch { return null; } }
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
  const [rows] = await pool.execute('SELECT s.*,m.category,m.deposit_minor FROM booking_services s LEFT JOIN booking_service_meta m ON m.service_id=s.id AND m.restaurant_id=s.restaurant_id WHERE s.restaurant_id=?' + (activeOnly ? ' AND s.active=1' : '') + ' ORDER BY s.id', [restaurantId]);
  return rows.map(r => ({ ...serviceRow(r), category: r.category || null, deposit_minor: Number(r.deposit_minor || 0) }));
}
export async function listResources(pool, restaurantId, { activeOnly = false } = {}) {
  await ensureBookingTables(pool);
  const [rows] = await pool.execute('SELECT x.id,x.name,x.note,x.active,m.specialty,m.hours_json,m.room_status FROM booking_resources x LEFT JOIN booking_resource_meta m ON m.resource_id=x.id AND m.restaurant_id=x.restaurant_id WHERE x.restaurant_id=?' + (activeOnly ? ' AND x.active=1' : '') + ' ORDER BY x.id', [restaurantId]);
  return rows.map(r => { let hours = null; try { hours = r.hours_json ? cleanHours(JSON.parse(r.hours_json)) : null; } catch {} return { id: Number(r.id), name: r.name, note: r.note, active: Boolean(r.active), specialty: r.specialty || null, hours, room_status: r.room_status || null }; });
}
export async function saveService(pool, restaurantId, id, value) {
  await ensureBookingTables(pool);
  const resources = await listResources(pool, restaurantId);
  const allowed = new Set(resources.map(r => r.id));
  const ids = JSON.stringify(value.resource_ids.filter(x => allowed.has(x)));
  if (id) {
    const [r] = await pool.execute('UPDATE booking_services SET name=?,description=?,duration_min=?,price_minor=?,capacity=?,resource_ids=?,active=? WHERE id=? AND restaurant_id=?', [value.name, value.description, value.duration_min, value.price_minor, value.capacity, ids, value.active, id, restaurantId]);
    if (!r.affectedRows) return null;
    await saveServiceMeta(pool, restaurantId, id, value);
    return id;
  }
  const [count] = await pool.execute('SELECT COUNT(*) n FROM booking_services WHERE restaurant_id=?', [restaurantId]);
  if (Number(count[0].n) >= 100) return null;
  const [r] = await pool.execute('INSERT INTO booking_services(restaurant_id,name,description,duration_min,price_minor,capacity,resource_ids,active) VALUES (?,?,?,?,?,?,?,?)', [restaurantId, value.name, value.description, value.duration_min, value.price_minor, value.capacity, ids, value.active]);
  await saveServiceMeta(pool, restaurantId, Number(r.insertId), value);
  return Number(r.insertId);
}
async function saveServiceMeta(pool, restaurantId, id, value) {
  await pool.execute('INSERT INTO booking_service_meta(service_id,restaurant_id,category,deposit_minor) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE category=VALUES(category),deposit_minor=VALUES(deposit_minor)', [id, restaurantId, value.category ?? null, value.deposit_minor || 0]);
}
async function saveResourceMeta(pool, restaurantId, id, value) {
  await pool.execute('INSERT INTO booking_resource_meta(resource_id,restaurant_id,specialty,hours_json,room_status) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE specialty=VALUES(specialty),hours_json=VALUES(hours_json),room_status=COALESCE(VALUES(room_status),room_status)', [id, restaurantId, value.specialty ?? null, value.hours ? JSON.stringify(value.hours) : null, value.room_status ?? null]);
}
/** Delete a service / staff member; one with bookings is switched off instead so history stays. */
export async function deleteService(pool, restaurantId, id) {
  await ensureBookingTables(pool);
  const [[used]] = await pool.execute('SELECT COUNT(*) n FROM bookings WHERE restaurant_id=? AND service_id=?', [restaurantId, id]);
  if (Number(used.n)) { const [r] = await pool.execute('UPDATE booking_services SET active=0 WHERE id=? AND restaurant_id=?', [id, restaurantId]); return r.affectedRows ? 'archived' : null; }
  const [r] = await pool.execute('DELETE FROM booking_services WHERE id=? AND restaurant_id=?', [id, restaurantId]);
  if (r.affectedRows) await pool.execute('DELETE FROM booking_service_meta WHERE service_id=? AND restaurant_id=?', [id, restaurantId]);
  return r.affectedRows ? 'deleted' : null;
}
export async function deleteResource(pool, restaurantId, id) {
  await ensureBookingTables(pool);
  const [[used]] = await pool.execute('SELECT COUNT(*) n FROM bookings WHERE restaurant_id=? AND resource_id=?', [restaurantId, id]);
  if (Number(used.n)) { const [r] = await pool.execute('UPDATE booking_resources SET active=0 WHERE id=? AND restaurant_id=?', [id, restaurantId]); return r.affectedRows ? 'archived' : null; }
  const [r] = await pool.execute('DELETE FROM booking_resources WHERE id=? AND restaurant_id=?', [id, restaurantId]);
  if (r.affectedRows) await pool.execute('DELETE FROM booking_resource_meta WHERE resource_id=? AND restaurant_id=?', [id, restaurantId]);
  return r.affectedRows ? 'deleted' : null;
}
export async function setRoomStatus(pool, restaurantId, id, status) {
  if (!ROOM_STATUSES.includes(status)) return false;
  await ensureBookingTables(pool);
  const [[own]] = await pool.execute('SELECT COUNT(*) n FROM booking_resources WHERE id=? AND restaurant_id=?', [id, restaurantId]);
  if (!Number(own.n)) return false;
  await pool.execute('INSERT INTO booking_resource_meta(resource_id,restaurant_id,room_status) VALUES (?,?,?) ON DUPLICATE KEY UPDATE room_status=VALUES(room_status)', [id, restaurantId, status]);
  return true;
}
export async function saveResource(pool, restaurantId, id, value) {
  await ensureBookingTables(pool);
  if (id) {
    const [r] = await pool.execute('UPDATE booking_resources SET name=?,note=?,active=? WHERE id=? AND restaurant_id=?', [value.name, value.note, value.active, id, restaurantId]);
    if (!r.affectedRows) return null;
    await saveResourceMeta(pool, restaurantId, id, value);
    return id;
  }
  const [count] = await pool.execute('SELECT COUNT(*) n FROM booking_resources WHERE restaurant_id=?', [restaurantId]);
  if (Number(count[0].n) >= 100) return null;
  const [r] = await pool.execute('INSERT INTO booking_resources(restaurant_id,name,note,active) VALUES (?,?,?,?)', [restaurantId, value.name, value.note, value.active]);
  await saveResourceMeta(pool, restaurantId, Number(r.insertId), value);
  return Number(r.insertId);
}

async function busyBetween(pool, restaurantId, from, to) {
  const [rows] = await pool.execute("SELECT id,service_id,resource_id,start_at,end_at FROM bookings WHERE restaurant_id=? AND status NOT IN ('cancelled','no_show') AND start_at<? AND end_at>?", [restaurantId, to, from]);
  return rows;
}

/** Availability for a service: slots for a date, or rooms left for a stay. */
export async function availability(pool, restaurantId, { serviceId, date, checkOut, resourceId = null, excludeId = null }) {
  const profile = await getProfile(pool, restaurantId);
  const service = (await listServices(pool, restaurantId, { activeOnly: true })).find(s => s.id === Number(serviceId));
  if (!profile || !service) return { error: 'Service not found' };
  const now = localNow(profile.timezone);
  if (profile.type.booking === 'night') {
    if (!isDate(date) || !isDate(checkOut) || nightsBetween(date, checkOut) < 1 || nightsBetween(date, checkOut) > 60) return { error: 'Choose check-in and check-out dates' };
    if (date < now.slice(0, 10)) return { error: 'Choose a date from today' };
    const busy = (await busyBetween(pool, restaurantId, date + ' 00:00', checkOut + ' 23:59')).filter(b => excludeId == null || Number(b.id) !== Number(excludeId));
    let rooms = null;
    if (service.resource_ids.length) {
      const usable = new Set((await listResources(pool, restaurantId, { activeOnly: true })).filter(r => r.room_status !== 'out_of_order').map(r => r.id));
      rooms = service.resource_ids.filter(id => usable.has(id));
    }
    const left = roomsLeft({ service, checkIn: date, checkOut, bookings: busy, rooms });
    const room = rooms ? freeRoom({ checkIn: date, checkOut, bookings: busy, rooms }) : null;
    return { kind: 'night', service, nights: nightsBetween(date, checkOut), rooms_left: left, room_id: room, total_minor: service.price_minor * nightsBetween(date, checkOut) };
  }
  if (!isDate(date)) return { error: 'Choose a date' };
  if (date < now.slice(0, 10)) return { error: 'Choose a date from today' };
  const busy = await busyBetween(pool, restaurantId, date + ' 00:00', addDays(date, 1) + ' 00:00');
  const resourceHours = {};
  let useService = service;
  if (service.resource_ids.length) {
    const active = await listResources(pool, restaurantId, { activeOnly: true });
    for (const r of active) if (r.hours) resourceHours[r.id] = r.hours;
    const ids = new Set(active.map(r => r.id));
    useService = { ...service, resource_ids: service.resource_ids.filter(id => ids.has(id)) };
  }
  const wanted = resourceId ? Number(resourceId) : null;
  if (wanted && useService.resource_ids.length) useService = { ...useService, resource_ids: useService.resource_ids.filter(id => id === wanted) };
  if (service.resource_ids.length && !useService.resource_ids.length) return { kind: 'slot', service, slots: [] };
  return { kind: 'slot', service, slots: freeSlots({ date, hours: profile.hours, step: profile.slot_minutes, service: useService, bookings: busy, now, resourceHours, excludeId }) };
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
  const wantedResource = input.resource_id ? Number(input.resource_id) : null;
  const avail = await availability(pool, restaurantId, { serviceId: input.service_id, date: input.date, checkOut: input.check_out, resourceId: wantedResource });
  if (avail.error) return avail;
  const service = avail.service;
  let start, end, resourceId = null, price;
  if (avail.kind === 'night') {
    if (avail.rooms_left < 1) return { error: 'No rooms of this type are free for those dates' };
    start = input.date + ' 14:00'; end = input.check_out + ' 12:00'; price = avail.total_minor; resourceId = avail.room_id ?? null;
  } else {
    const time = typeof input.time === 'string' ? input.time.slice(0, 5) : '';
    const chosen = avail.slots.find(s => s.time === time);
    if (!chosen) return { error: 'That time is no longer free. Pick another time.' };
    const startMin = toMin(input.date + ' ' + time);
    start = input.date + ' ' + time; end = stamp(input.date, startMin + service.duration_min); resourceId = chosen.resource_id; price = service.price_minor;
  }
  let note = text(input.note, 500) || null;
  const code = text(input.discount_code, 30).toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (code) {
    const d = await findDiscount(pool, restaurantId, code);
    if (!d) return { error: 'That discount code is not valid' };
    price = Math.round(price * (100 - d.percent) / 100);
    note = ((note ? note + ' · ' : '') + 'Code ' + d.code + ' −' + d.percent + '%').slice(0, 500);
    await pool.execute('UPDATE booking_discounts SET uses=uses+1 WHERE id=?', [d.id]);
  }
  const status = input.status === 'confirmed' ? 'confirmed' : 'pending';
  const [r] = await pool.execute('INSERT INTO bookings(restaurant_id,service_id,resource_id,customer_name,customer_phone,start_at,end_at,guests,price_minor,status,source,note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    [restaurantId, service.id, resourceId, name, phone, start + ':00', end + ':00', int(input.guests, 1, 50, 1), price, status, source, note]);
  await logEvent(pool, restaurantId, Number(r.insertId), 'created', source);
  return { booking: { id: Number(r.insertId), service: service.name, start_at: start, end_at: end, resource_id: resourceId, price_minor: price, status } };
}

export async function logEvent(pool, restaurantId, bookingId, action, detail = null, actor = null) {
  try { await pool.execute('INSERT INTO booking_events(restaurant_id,booking_id,action,detail,actor) VALUES (?,?,?,?,?)', [restaurantId, bookingId, String(action).slice(0, 30), detail ? String(detail).slice(0, 300) : null, actor ? String(actor).slice(0, 40) : null]); } catch {}
}
export async function bookingEvents(pool, restaurantId, bookingId) {
  await ensureBookingTables(pool);
  const [rows] = await pool.execute('SELECT action,detail,actor,created_at FROM booking_events WHERE restaurant_id=? AND booking_id=? ORDER BY id LIMIT 50', [restaurantId, bookingId]);
  return rows.map(r => ({ action: r.action, detail: r.detail, actor: r.actor, at: norm(r.created_at) }));
}

/** Move a booking to a new date/time (or stay dates), re-checked against everyone else. */
export async function rescheduleBooking(pool, restaurantId, id, input, actor = 'owner') {
  await ensureBookingTables(pool);
  const [[b]] = await pool.execute('SELECT * FROM bookings WHERE id=? AND restaurant_id=?', [id, restaurantId]);
  if (!b) return { error: 'Booking not found' };
  if (['cancelled', 'completed', 'no_show'].includes(b.status)) return { error: 'This booking is closed' };
  const resourceId = input.resource_id ? Number(input.resource_id) : null;
  const avail = await availability(pool, restaurantId, { serviceId: input.service_id || b.service_id, date: input.date, checkOut: input.check_out, resourceId, excludeId: id });
  if (avail.error) return avail;
  let start, end, res = null, price;
  if (avail.kind === 'night') {
    if (avail.rooms_left < 1) return { error: 'No rooms of this type are free for those dates' };
    start = input.date + ' 14:00'; end = input.check_out + ' 12:00'; price = avail.total_minor; res = avail.room_id ?? null;
  } else {
    const time = String(input.time || '').slice(0, 5);
    const chosen = avail.slots.find(s => s.time === time);
    if (!chosen) return { error: 'That time is not free. Pick another time.' };
    start = input.date + ' ' + time; end = stamp(input.date, toMin(start) + avail.service.duration_min); res = chosen.resource_id; price = avail.service.price_minor;
  }
  await pool.execute('UPDATE bookings SET service_id=?,resource_id=?,start_at=?,end_at=?,price_minor=? WHERE id=? AND restaurant_id=?', [avail.service.id, res, start + ':00', end + ':00', price, id, restaurantId]);
  await logEvent(pool, restaurantId, id, 'rescheduled', norm(b.start_at) + ' → ' + start, actor);
  return { booking: { id, service: avail.service.name, start_at: start, end_at: end, resource_id: res, price_minor: price, status: b.status } };
}

/** Patients / clients / guests: everyone who booked, grouped by phone number. */
export async function listCustomers(pool, restaurantId, { q = '' } = {}) {
  await ensureBookingTables(pool);
  const args = [restaurantId];
  let where = 'restaurant_id=?';
  const term = text(q, 60);
  if (term) { where += ' AND (customer_name LIKE ? OR customer_phone LIKE ?)'; args.push('%' + term + '%', '%' + term.replace(/[^\d+]/g, '') + '%'); }
  const [rows] = await pool.execute("SELECT customer_phone phone, MAX(customer_name) name, COUNT(*) bookings, SUM(status='completed') visits, SUM(status IN ('cancelled','no_show')) missed, SUM(CASE WHEN status='completed' THEN price_minor ELSE 0 END) spent_minor, MAX(CASE WHEN start_at<NOW() THEN start_at END) last_at, MIN(CASE WHEN start_at>=NOW() AND status NOT IN ('cancelled','no_show') THEN start_at END) next_at FROM bookings WHERE " + where + ' GROUP BY customer_phone ORDER BY MAX(start_at) DESC LIMIT 500', args);
  return rows.map(r => ({ phone: r.phone, name: r.name, bookings: Number(r.bookings), visits: Number(r.visits || 0), missed: Number(r.missed || 0), spent_minor: Number(r.spent_minor || 0), last_at: r.last_at ? norm(r.last_at) : null, next_at: r.next_at ? norm(r.next_at) : null }));
}
export async function customerBookings(pool, restaurantId, phone) {
  await ensureBookingTables(pool);
  const [rows] = await pool.execute('SELECT b.id,b.start_at,b.end_at,b.status,b.price_minor,b.note,s.name service FROM bookings b LEFT JOIN booking_services s ON s.id=b.service_id AND s.restaurant_id=b.restaurant_id WHERE b.restaurant_id=? AND b.customer_phone=? ORDER BY b.start_at DESC LIMIT 100', [restaurantId, phone]);
  return rows.map(r => ({ id: Number(r.id), service: r.service, start_at: norm(r.start_at), end_at: norm(r.end_at), status: r.status, price_minor: Number(r.price_minor), note: r.note }));
}
/** CSV text (Excel-safe: formulas neutralised). */
export function toCsv(rows, columns) {
  const cell = v => { let t = v == null ? '' : String(v); if (/^[=+\-@]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };
  return [columns.map(c => cell(c[1])).join(','), ...rows.map(r => columns.map(c => cell(r[c[0]])).join(','))].join('\r\n') + '\r\n';
}

export async function listBookings(pool, restaurantId, { from, to, status, q } = {}) {
  await ensureBookingTables(pool);
  const args = [restaurantId];
  let where = 'b.restaurant_id=?';
  if (isDate(from)) { where += ' AND b.end_at>=?'; args.push(from + ' 00:00:00'); }
  if (isDate(to)) { where += ' AND b.start_at<?'; args.push(addDays(to, 1) + ' 00:00:00'); }
  if (BOOKING_STATUSES.includes(status)) { where += ' AND b.status=?'; args.push(status); }
  const term = text(q, 60);
  if (term) { where += ' AND (b.customer_name LIKE ? OR b.customer_phone LIKE ? OR b.id=?)'; args.push('%' + term + '%', '%' + term.replace(/[^\d+]/g, '') + '%', Number(term.replace(/\D/g, '')) || 0); }
  const [rows] = await pool.execute('SELECT b.*,s.name service_name,x.name resource_name,(SELECT COALESCE(SUM(CASE WHEN p.kind=\'payment\' AND p.status=\'confirmed\' THEN p.amount_minor WHEN p.kind=\'refund\' AND p.status=\'confirmed\' THEN -CAST(p.amount_minor AS SIGNED) ELSE 0 END),0) FROM booking_payments p WHERE p.booking_id=b.id AND p.restaurant_id=b.restaurant_id) paid_minor,(SELECT COUNT(*) FROM booking_payments p WHERE p.booking_id=b.id AND p.restaurant_id=b.restaurant_id AND p.status=\'pending\') pending_payments FROM bookings b LEFT JOIN booking_services s ON s.id=b.service_id AND s.restaurant_id=b.restaurant_id LEFT JOIN booking_resources x ON x.id=b.resource_id AND x.restaurant_id=b.restaurant_id WHERE ' + where + ' ORDER BY b.start_at LIMIT 500', args);
  return rows.map(b => ({ id: Number(b.id), service_id: b.service_id == null ? null : Number(b.service_id), service: b.service_name, resource: b.resource_name, resource_id: b.resource_id == null ? null : Number(b.resource_id), customer_name: b.customer_name, customer_phone: b.customer_phone, start_at: norm(b.start_at), end_at: norm(b.end_at), guests: Number(b.guests), price_minor: Number(b.price_minor), status: b.status, source: b.source, note: b.note, paid_minor: Number(b.paid_minor || 0), pending_payments: Number(b.pending_payments || 0) }));
}
export async function setBookingStatus(pool, restaurantId, id, status, actor = 'owner') {
  if (!BOOKING_STATUSES.includes(status)) return false;
  await ensureBookingTables(pool);
  const [r] = await pool.execute('UPDATE bookings SET status=? WHERE id=? AND restaurant_id=?', [status, id, restaurantId]);
  if (r.affectedRows) {
    await logEvent(pool, restaurantId, id, status, null, actor);
    // Hotels: a guest checking in makes the room occupied; checking out leaves it to be cleaned.
    if (status === 'checked_in' || status === 'completed') {
      try {
        const [[b]] = await pool.execute('SELECT resource_id FROM bookings WHERE id=? AND restaurant_id=?', [id, restaurantId]);
        const profile = await getProfile(pool, restaurantId);
        if (b?.resource_id && profile?.type.booking === 'night') await setRoomStatus(pool, restaurantId, Number(b.resource_id), status === 'checked_in' ? 'occupied' : 'dirty');
      } catch {}
    }
  }
  return r.affectedRows > 0;
}

/** Push alert to the owner's devices for a new booking. Never throws. */
export async function notifyNewBooking(pool, restaurantId, booking, source) {
  const when = String(booking.start_at || '').replace(' ', ' at ');
  return pushToRestaurant(pool, restaurantId, { title: '📅 New booking #' + booking.id, body: [booking.service, when, source].filter(Boolean).join(' · '), url: '/restaurant.html#bookings', tag: 'booking-' + booking.id }).catch(() => ({ sent: 0 }));
}

// ---- Discount codes ----
export async function findDiscount(pool, restaurantId, code) {
  await ensureBookingTables(pool);
  const [[d]] = await pool.execute('SELECT id,code,percent,valid_to FROM booking_discounts WHERE restaurant_id=? AND code=? AND active=1 AND (valid_to IS NULL OR valid_to>=CURDATE()) LIMIT 1', [restaurantId, code]);
  return d ? { id: Number(d.id), code: d.code, percent: Number(d.percent) } : null;
}
export async function listDiscounts(pool, restaurantId) {
  await ensureBookingTables(pool);
  const [rows] = await pool.execute('SELECT id,code,percent,valid_to,active,uses FROM booking_discounts WHERE restaurant_id=? ORDER BY id DESC LIMIT 100', [restaurantId]);
  return rows.map(d => ({ id: Number(d.id), code: d.code, percent: Number(d.percent), valid_to: d.valid_to ? norm(d.valid_to).slice(0, 10) : null, active: Boolean(d.active), uses: Number(d.uses) }));
}
export async function saveDiscount(pool, restaurantId, body) {
  await ensureBookingTables(pool);
  const code = text(body?.code, 30).toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const percent = int(body?.percent, 1, 90, 0);
  if (code.length < 3) return { error: 'Code needs at least 3 letters or numbers' };
  if (!percent) return { error: 'Discount must be 1–90%' };
  const validTo = isDate(body?.valid_to) ? body.valid_to : null;
  try { await pool.execute('INSERT INTO booking_discounts(restaurant_id,code,percent,valid_to) VALUES (?,?,?,?)', [restaurantId, code, percent, validTo]); }
  catch (e) { if (e?.code === 'ER_DUP_ENTRY') return { error: 'That code already exists' }; throw e; }
  return { discounts: await listDiscounts(pool, restaurantId) };
}
export async function toggleDiscount(pool, restaurantId, id, active) {
  await ensureBookingTables(pool);
  await pool.execute('UPDATE booking_discounts SET active=? WHERE id=? AND restaurant_id=?', [active ? 1 : 0, id, restaurantId]);
  return { discounts: await listDiscounts(pool, restaurantId) };
}

// ---- Reports ----
export async function bookingReport(pool, restaurantId, days = 30) {
  await ensureBookingTables(pool);
  const n = int(days, 1, 366, 30);
  // Bookings made in the period (also those for future dates), counted when they were received.
  const since = "created_at>=CURDATE()-INTERVAL " + n + " DAY";
  const [[t]] = await pool.execute("SELECT COUNT(*) total, SUM(status='completed') done, SUM(status='cancelled') cancelled, SUM(status='no_show') no_show, SUM(CASE WHEN status='completed' THEN price_minor ELSE 0 END) revenue FROM bookings WHERE restaurant_id=? AND " + since, [restaurantId]);
  const [[p]] = await pool.execute("SELECT COALESCE(SUM(CASE WHEN kind='payment' THEN amount_minor ELSE 0 END),0) paid, COALESCE(SUM(CASE WHEN kind='refund' THEN amount_minor ELSE 0 END),0) refunded FROM booking_payments WHERE restaurant_id=? AND status='confirmed' AND created_at>=CURDATE()-INTERVAL " + n + " DAY", [restaurantId]);
  const [services] = await pool.execute("SELECT COALESCE(s.name,'—') name, COUNT(*) n, SUM(CASE WHEN b.status='completed' THEN b.price_minor ELSE 0 END) revenue FROM bookings b LEFT JOIN booking_services s ON s.id=b.service_id AND s.restaurant_id=b.restaurant_id WHERE b.restaurant_id=? AND " + since.replace(/created_at/g, 'b.created_at') + " GROUP BY s.name ORDER BY n DESC LIMIT 8", [restaurantId]);
  const [sources] = await pool.execute("SELECT source, COUNT(*) n FROM bookings WHERE restaurant_id=? AND " + since + " GROUP BY source", [restaurantId]);
  const [weekdays] = await pool.execute("SELECT DAYOFWEEK(start_at) d, COUNT(*) n FROM bookings WHERE restaurant_id=? AND " + since + " AND status NOT IN ('cancelled') GROUP BY DAYOFWEEK(start_at)", [restaurantId]);
  const total = Number(t.total || 0);
  return {
    days: n, total, done: Number(t.done || 0), cancelled: Number(t.cancelled || 0), no_show: Number(t.no_show || 0),
    no_show_rate: total ? Math.round(Number(t.no_show || 0) * 100 / total) : 0,
    revenue_minor: Number(t.revenue || 0), paid_minor: Number(p.paid || 0), refunded_minor: Number(p.refunded || 0),
    services: services.map(r => ({ name: r.name, count: Number(r.n), revenue_minor: Number(r.revenue || 0) })),
    sources: Object.fromEntries(sources.map(r => [r.source, Number(r.n)])),
    weekdays: Array.from({ length: 7 }, (_, i) => Number(weekdays.find(w => Number(w.d) === i + 1)?.n || 0)),
  };
}
