import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freeSlots, roomsLeft, cleanService, cleanHours, cleanPhone, localNow, BUSINESS_TYPES, BOOKING_SQL, isBusinessType } from '../src/bookings.js';

test('time slots skip booked times and the past', () => {
  const hours = { 1: [[540, 660]] }; // Monday 09:00-11:00
  const service = { id: 1, duration_min: 30, capacity: 1, resource_ids: [] };
  const slots = freeSlots({ date: '2026-11-23', hours, step: 30, service, bookings: [{ service_id: 1, start_at: '2026-11-23 09:30:00', end_at: '2026-11-23 10:00:00' }] });
  assert.deepEqual(slots.map(s => s.time), ['09:00', '10:00', '10:30']);
  assert.deepEqual(freeSlots({ date: '2026-11-23', hours, step: 30, service, now: '2026-11-23 10:00' }).map(s => s.time), ['10:30']);
  assert.deepEqual(freeSlots({ date: '2026-11-22', hours, step: 30, service }), []); // Sunday closed
});

test('staff: a slot is free while any chosen staff member is free', () => {
  const service = { id: 1, duration_min: 60, resource_ids: [5, 6] };
  const slots = freeSlots({ date: '2026-11-23', hours: { 1: [[540, 660]] }, step: 30, service, bookings: [{ resource_id: 5, start_at: '2026-11-23 09:00', end_at: '2026-11-23 10:00' }, { resource_id: 6, start_at: '2026-11-23 09:30', end_at: '2026-11-23 10:30' }] });
  assert.deepEqual(slots, [{ time: '10:00', resource_id: 5 }]);
});

test('hotel rooms left counts overlapping stays only', () => {
  const service = { id: 2, capacity: 2 };
  const bookings = [{ service_id: 2, start_at: '2026-11-24 14:00', end_at: '2026-11-26 12:00' }, { service_id: 2, start_at: '2026-11-20 14:00', end_at: '2026-11-23 12:00' }];
  assert.equal(roomsLeft({ service, checkIn: '2026-11-23', checkOut: '2026-11-25', bookings }), 1);
  assert.equal(roomsLeft({ service, checkIn: '2026-11-26', checkOut: '2026-11-27', bookings }), 2);
});

test('validation', () => {
  assert.equal(cleanService({ name: '' }, 'clinic').error, 'Enter a name');
  assert.equal(cleanService({ name: 'Room', price: 50 }, 'hotel').value.duration_min, 1440);
  assert.equal(cleanService({ name: 'Cut', price: 12.5, duration_min: 45 }, 'salon').value.price_minor, 1250);
  assert.deepEqual(cleanHours({ 1: [[600, 500], [540, 600]] })[1], [[540, 600]]);
  assert.equal(cleanPhone('+92 300-1234567'), '+923001234567');
  assert.equal(cleanPhone('abc'), '');
  assert.match(localNow('Asia/Karachi'), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.ok(['restaurant', 'clinic', 'hotel', 'salon'].every(isBusinessType));
  assert.ok(!isBusinessType('toString'));
  assert.equal(BUSINESS_TYPES.hotel.booking, 'night');
});

test('booking tables are additive only', () => {
  for (const sql of BOOKING_SQL) assert.match(sql, /^CREATE TABLE IF NOT EXISTS /);
  const src = readFileSync('src/bookings.js', 'utf8');
  assert.doesNotMatch(src, /ALTER TABLE|DROP TABLE|TRUNCATE/i);
});

test('dashboard adapts to the business type; public booking page exists', () => {
  const html = readFileSync('public/restaurant.html', 'utf8');
  for (const id of ['id="bookings"', 'id="booking-setup"', 'id="bk-dialog"', 'data-food-only', 'data-biz-only', 'bookings.js']) assert.ok(html.includes(id), id);
  const reg = readFileSync('public/register.html', 'utf8');
  for (const v of ['restaurant', 'clinic', 'hotel', 'salon']) assert.match(reg, new RegExp('name="business_type" value="' + v + '"'));
  assert.match(readFileSync('public/register.js', 'utf8'), /business_type:/);
  assert.match(readFileSync('src/registration.js', 'utf8'), /saveProfile\(pool, result\.body\.restaurant_id, \{ category \}\)/);
  const book = readFileSync('public/book.js', 'utf8');
  assert.doesNotMatch(book + readFileSync('public/bookings.js', 'utf8'), /innerHTML/);
  assert.match(readFileSync('src/server.js', 'utf8'), /app\.use\(bookingsRouter\(pool\)\)/);
});

test('onboarding follows the business type', async () => {
  const reg = readFileSync('public/register.html', 'utf8');
  assert.match(reg, /name="business_type" value="restaurant" required>/);
  assert.doesNotMatch(reg, /name="business_type" value="[a-z]+" checked/);
  assert.match(readFileSync('public/register.js', 'utf8'), /Please choose your type of business first/);
  assert.match(readFileSync('src/registration.js', 'utf8'), /if \(category !== 'restaurant'\) syncCallBookingTools/);
  assert.match(readFileSync('src/voice-autoprovision.js', 'utf8'), /syncCallBookingTools\(pool, restaurant\.id\)/);
  const js = readFileSync('public/restaurant.js', 'utf8');
  assert.match(js, /cat==='restaurant'\?'menu':'services'/);
  // first save: clinics take bookings by default, restaurants opt in
  const { saveProfile } = await import('../src/bookings.js');
  const writes = [];
  const pool = { async query() { return [[]]; }, async execute(sql, args) {
    if (sql.startsWith('SELECT r.country_code')) return [[{ country_code: 'PK', category: writes.length ? 'clinic' : null, timezone: null, hours_json: null, slot_minutes: null, bookings_enabled: writes.length ? 1 : null }]];
    writes.push(args); return [{ affectedRows: 1 }];
  } };
  await saveProfile(pool, 7, { category: 'clinic' });
  assert.equal(writes[0][5], 1);
});

import { toCsv, BOOKING_STATUSES } from '../src/bookings.js';
import { dueForReminder, REMINDER_SQL } from '../src/booking-reminders.js';

test('each doctor works their own hours; a booking can be moved without clashing with itself', () => {
  const service = { id: 1, duration_min: 30, resource_ids: [5, 6] };
  const hours = { 1: [[540, 600]] }; // business 09:00-10:00
  const resourceHours = { 6: { 1: [[600, 660]] } }; // doctor 6 works 10:00-11:00
  const slots = freeSlots({ date: '2026-11-23', hours, step: 30, service, resourceHours });
  assert.deepEqual(slots, [{ time: '09:00', resource_id: 5 }, { time: '09:30', resource_id: 5 }, { time: '10:00', resource_id: 6 }, { time: '10:30', resource_id: 6 }]);
  const mine = [{ id: 9, resource_id: 5, start_at: '2026-11-23 09:00', end_at: '2026-11-23 09:30' }];
  assert.equal(freeSlots({ date: '2026-11-23', hours, step: 30, service: { ...service, resource_ids: [5] }, bookings: mine }).length, 1);
  assert.equal(freeSlots({ date: '2026-11-23', hours, step: 30, service: { ...service, resource_ids: [5] }, bookings: mine, excludeId: 9 }).length, 2);
});

test('csv export neutralises formulas; reminders only 2-26 hours ahead; arrived status exists', () => {
  const csv = toCsv([{ a: '=HYPERLINK("x")', b: 'Ali, "Khan"' }], [['a', 'A'], ['b', 'B']]);
  assert.match(csv, /"'=HYPERLINK\(""x""\)"/);
  assert.match(csv, /"Ali, ""Khan"""/);
  assert.ok(dueForReminder('2026-11-23 10:00', '2026-11-22 12:00'));
  assert.ok(!dueForReminder('2026-11-23 10:00', '2026-11-23 09:00'));
  assert.ok(!dueForReminder('2026-11-25 10:00', '2026-11-22 12:00'));
  assert.match(REMINDER_SQL, /^CREATE TABLE IF NOT EXISTS/);
  assert.ok(BOOKING_STATUSES.includes('checked_in'));
  const ui = readFileSync('public/bookings.js', 'utf8');
  for (const bit of ['Reschedule', 'renderWeek', 'loadCustomers', 'exportCsv', 'deleteItem', 'readHourRows']) assert.ok(ui.includes(bit), bit);
  const routes = readFileSync('src/bookings-routes.js', 'utf8');
  for (const bit of ["/reschedule'", "/customers.csv'", "/bookings.csv'", "router.delete(base + '/services/:id'", "/history'"]) assert.ok(routes.includes(bit), bit);
});

import { roomsLeft as roomsLeft2, freeRoom } from '../src/bookings.js';
import { EXTRA_SQL, recordPayment, customerPaymentReference, setTransferPhone } from '../src/booking-extras.js';
import { withBookingTools as withTools, businessCallRule as rule } from '../src/voice-bookings.js';

test('hotel: individual rooms are assigned and counted per stay', () => {
  const bookings = [{ service_id: 2, resource_id: 101, start_at: '2026-11-24 14:00', end_at: '2026-11-26 12:00' }];
  assert.equal(roomsLeft2({ service: { id: 2 }, checkIn: '2026-11-25', checkOut: '2026-11-27', bookings, rooms: [101, 102] }), 1);
  assert.equal(freeRoom({ checkIn: '2026-11-25', checkOut: '2026-11-27', bookings, rooms: [101, 102] }), 102);
  assert.equal(freeRoom({ checkIn: '2026-11-26', checkOut: '2026-11-27', bookings, rooms: [101, 102] }), 101);
});

test('payments: refunds cannot exceed paid; customer reference needs the booking secret; transfer number format', async () => {
  for (const sql of EXTRA_SQL) assert.match(sql, /^CREATE TABLE IF NOT EXISTS /);
  const pool = { async query() { return [[]]; }, async execute(sql) {
    if (sql.startsWith('SELECT id,price_minor,status FROM bookings')) return [[{ id: 5, price_minor: 100000, status: 'confirmed' }]];
    if (sql.startsWith('SELECT id,kind,amount_minor')) return [[{ id: 1, kind: 'payment', amount_minor: 50000, method: 'cash', reference: null, status: 'confirmed', actor: 'owner', created_at: '2026-11-22 10:00:00' }]];
    if (sql.startsWith('SELECT token FROM booking_access')) return [[{ token: 'a'.repeat(32) }]];
    return [{ affectedRows: 1, insertId: 1 }];
  } };
  assert.match((await recordPayment(pool, 4, 5, { kind: 'refund', amount: 600, method: 'cash' }, 'owner')).error, /cannot be more/);
  assert.ok((await recordPayment(pool, 4, 5, { kind: 'refund', amount: 200, method: 'cash' }, 'owner')).payments);
  assert.equal((await customerPaymentReference(pool, 4, 5, 'b'.repeat(32), { reference: 'TX12345' })).error, 'Invalid link');
  assert.match((await setTransferPhone(pool, 4, '0300')).error, /country code/);
});

test('calls: transfer tool added and removed with the reception number', () => {
  const model = { messages: [{ role: 'system', content: 'Host.' }], tools: [{ type: 'function', function: { name: 'place_order' } }] };
  const withT = withTools(model, { url: 'https://x' }, rule('clinic', 'C', '+923001234567'), '+923001234567');
  assert.ok(withT.tools.some(t => t.type === 'transferCall' && t.destinations[0].number === '+923001234567'));
  assert.match(withT.messages[0].content, /transferCall/);
  const without = withTools(withT, { url: 'https://x' }, rule('clinic', 'C', ''), '');
  assert.ok(!without.tools.some(t => t.type === 'transferCall'));
  const ui = readFileSync('public/bookings.js', 'utf8');
  for (const bit of ['renderHousekeeping', 'openPayments', 'loadHandovers', 'saveTransfer']) assert.ok(ui.includes(bit), bit);
  const worker = readFileSync('src/whatsapp-ai-worker.js', 'utf8');
  for (const bit of ['handoverActive(pool,job)', "name==='cancel_booking'", "name==='reschedule_booking'", "name==='talk_to_staff'"]) assert.ok(worker.includes(bit), bit);
});

test('batch C: website booking button, discounts, reports, staff role', async () => {
  const { renderSitePage } = await import('../src/site-builder.js');
  const html = renderSitePage({ restaurant: { id: 1, name: 'City Clinic', slug: 'city-clinic', currency: 'PKR' }, config: {}, items: [] }, { booking: { category: 'clinic', label: 'Book an appointment', title: 'Our services', services: [{ name: 'Check-up', price_minor: 150000, duration_min: 30 }] } });
  assert.match(html, /href="\/book\.html\?b=city-clinic">Book an appointment/);
  assert.match(html, /Check-up/);
  assert.doesNotMatch(html, /Track order/);
  const plain = renderSitePage({ restaurant: { id: 1, name: 'Cafe', slug: 'cafe', currency: 'PKR' }, config: {}, items: [] });
  assert.match(plain, /Track order/);
  const src = readFileSync('src/bookings.js', 'utf8');
  for (const bit of ['booking_discounts', 'export async function bookingReport', "'Code ' + d.code"]) assert.ok(src.includes(bit), bit);
  const routes = readFileSync('src/bookings-routes.js', 'utf8');
  assert.match(routes, /STAFF_PATHS/);
  assert.match(routes, /kind === 'refund'\) return false/);
  assert.match(readFileSync('src/operations.js', 'utf8'), /staffOk=rows\[0\]\?\.role==='staff'/);
  assert.match(readFileSync('public/owner.css', 'utf8'), /\[data-role="staff"\] \[data-admin-only\]\{display:none!important\}/);
});

test('multinational: payment links, global time zones, more website languages', async () => {
  const { sanitizePaymentSettings, cleanPayLink } = await import('../src/payment-options.js');
  const s = sanitizePaymentSettings({ transfers: [{ type: 'link', label: 'Card / PayPal', account_number: 'https://buy.stripe.com/test_123' }, { type: 'link', account_title: 'x', account_number: 'javascript:alert(1)' }, { type: 'upi', account_title: 'Shop', account_number: 'shop@upi' }] });
  assert.equal(s.transfers.length, 2);
  assert.equal(s.transfers[0].account_number, 'https://buy.stripe.com/test_123');
  assert.equal(cleanPayLink('http://x.com'), '');
  const { isTimezone, timezoneFor } = await import('../src/bookings.js');
  assert.ok(isTimezone('America/New_York') && isTimezone('Europe/Athens'));
  assert.ok(!isTimezone('Mars/Base') && !isTimezone("'; DROP"));
  assert.equal(timezoneFor('BR'), 'America/Sao_Paulo');
  const { templatesFor } = await import('../src/site-builder.js');
  assert.equal(templatesFor('clinic')[0], 'care');
  assert.equal(templatesFor('hotel')[0], 'resort');
  assert.equal(templatesFor('restaurant')[0], 'classic');
});

test('super admin: one page per type of business', () => {
  const html = readFileSync('src/views/super-admin.html', 'utf8');
  for (const t of ['restaurant', 'clinic', 'hotel', 'salon']) assert.match(html, new RegExp('href="#biz-' + t + '"'));
  assert.match(html, /id="biz-page"/);
  const js = readFileSync('public/platform.js', 'utf8');
  assert.ok(js.includes('window.mkBizPage') && !js.includes('innerHTML'));
  const api = readFileSync('src/api.js', 'utf8');
  assert.match(api, /category:cats\.get\(id\)\|\|'restaurant'/);
});
