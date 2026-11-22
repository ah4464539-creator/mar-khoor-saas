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
