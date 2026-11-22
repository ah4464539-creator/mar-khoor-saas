// HTTP routes for business type and bookings: owner management + public booking.
import express from 'express';
import { requireAuth, hashPassword } from './auth.js';
import { rateLimit, audit } from './security.js';
import {
  BUSINESS_TYPES, getProfile, saveProfile, listServices, listResources, saveService, saveResource,
  cleanService, cleanResource, availability, createBooking, listBookings, setBookingStatus, isDate, notifyNewBooking,
  rescheduleBooking, deleteService, deleteResource, setRoomStatus, listCustomers, customerBookings, bookingEvents, toCsv,
  listDiscounts, saveDiscount, toggleDiscount, bookingReport,
} from './bookings.js';
import { notifyBookingStatus } from './booking-assistant.js';
import { syncCallBookingTools } from './voice-bookings.js';
import { bookingPayments, recordPayment, decidePayment, bookingToken, customerPaymentReference, listHandovers, endHandover, getTransferPhone, setTransferPhone } from './booking-extras.js';
import { loadPaymentSettings, publicPaymentOptions } from './payment-options.js';
import { tokenForNumber } from './whatsapp-signup-core.js';

const idParam = v => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : 0; };

const STAFF_PATHS = [/^\/?$/, /^\/bookings(\.csv)?$/, /^\/bookings\/\d+(\/(reschedule|history|payments(\/\d+)?))?$/, /^\/availability$/, /^\/customers(\.csv|\/[^/]+)?$/, /^\/handovers(\/[^/]+)?$/, /^\/resources\/\d+\/room-status$/];
function staffAllowed(req) {
  const path = req.path.replace(/^\/api\/restaurants\/\d+\/business/, '');
  if (!STAFF_PATHS.some(rx => rx.test(path))) return false;
  if (req.method === 'POST' && /\/payments$/.test(path) && req.body?.kind === 'refund') return false; // refunds: owner only
  return true;
}

export function bookingsRouter(pool) {
  const router = express.Router();
  const access = async (req, res, next) => {
    const id = idParam(req.params.restaurantId);
    if (!id) return res.status(400).json({ error: 'Invalid business' });
    try {
      if (req.user.platformRole !== 'super_admin') {
        const [rows] = await pool.execute('SELECT role FROM restaurant_members WHERE restaurant_id=? AND user_id=? LIMIT 1', [id, req.user.id]);
        if (!rows.length) return res.status(403).json({ error: 'Forbidden' });
        // Staff work the front desk: bookings, customers, payments in, housekeeping. Settings stay admin-only.
        if (rows[0].role !== 'admin' && !staffAllowed(req)) return res.status(403).json({ error: 'Only the owner can change this' });
        req.memberRole = rows[0].role;
      }
      req.restaurantId = id; next();
    } catch { res.status(503).json({ error: 'Database unavailable' }); }
  };
  const base = '/api/restaurants/:restaurantId/business';
  router.use(base, requireAuth, access);
  const fail = (res, error) => { console.warn('bookings:', error?.code || error?.message); res.status(503).json({ error: 'Bookings unavailable' }); };

  router.get(base, async (req, res) => {
    try {
      const [profile, services, resources] = await Promise.all([getProfile(pool, req.restaurantId), listServices(pool, req.restaurantId), listResources(pool, req.restaurantId)]);
      res.json({ profile, services, resources, types: BUSINESS_TYPES, transfer_phone: await getTransferPhone(pool, req.restaurantId) });
    } catch (e) { fail(res, e); }
  });
  router.put(base + '/profile', async (req, res) => {
    try {
      const profile = await saveProfile(pool, req.restaurantId, req.body || {});
      if (profile.bookings_enabled) syncCallBookingTools(pool, req.restaurantId).catch(() => {});
      await audit(pool, { actorUserId: req.user.id, restaurantId: req.restaurantId, action: 'business.profile' }).catch(() => {});
      res.json({ profile });
    } catch (e) { fail(res, e); }
  });
  router.post(base + '/services', async (req, res) => saveServiceRoute(req, res, 0));
  router.put(base + '/services/:id', async (req, res) => saveServiceRoute(req, res, idParam(req.params.id)));
  async function saveServiceRoute(req, res, id) {
    try {
      const profile = await getProfile(pool, req.restaurantId);
      const parsed = cleanService(req.body, profile.category);
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      const saved = await saveService(pool, req.restaurantId, id, parsed.value);
      if (!saved) return res.status(id ? 404 : 400).json({ error: id ? 'Not found' : 'Too many services' });
      if (!id) syncCallBookingTools(pool, req.restaurantId).catch(() => {});
      res.json({ id: saved, services: await listServices(pool, req.restaurantId) });
    } catch (e) { fail(res, e); }
  }
  router.post(base + '/resources', async (req, res) => saveResourceRoute(req, res, 0));
  router.put(base + '/resources/:id', async (req, res) => saveResourceRoute(req, res, idParam(req.params.id)));
  async function saveResourceRoute(req, res, id) {
    try {
      const parsed = cleanResource(req.body);
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      const saved = await saveResource(pool, req.restaurantId, id, parsed.value);
      if (!saved) return res.status(id ? 404 : 400).json({ error: id ? 'Not found' : 'Too many entries' });
      res.json({ id: saved, resources: await listResources(pool, req.restaurantId) });
    } catch (e) { fail(res, e); }
  }
  router.get(base + '/bookings', async (req, res) => {
    try { res.json({ bookings: await listBookings(pool, req.restaurantId, { from: req.query.from, to: req.query.to, status: req.query.status, q: req.query.q }) }); }
    catch (e) { fail(res, e); }
  });
  router.get(base + '/availability', async (req, res) => {
    try {
      const result = await availability(pool, req.restaurantId, { serviceId: req.query.service_id, date: req.query.date, checkOut: req.query.check_out, resourceId: idParam(req.query.resource_id) || null, excludeId: idParam(req.query.exclude) || null });
      if (result.error) return res.status(400).json(result);
      res.json(result);
    } catch (e) { fail(res, e); }
  });
  router.post(base + '/bookings', async (req, res) => {
    try {
      const result = await createBooking(pool, req.restaurantId, { ...req.body, source: 'owner', status: 'confirmed' });
      if (result.error) return res.status(409).json(result);
      res.status(201).json(result);
    } catch (e) { fail(res, e); }
  });
  router.patch(base + '/bookings/:id', async (req, res) => {
    try {
      const id = idParam(req.params.id), status = req.body?.status;
      const ok = await setBookingStatus(pool, req.restaurantId, id, status, 'owner:' + req.user.id);
      if (!ok) return res.status(400).json({ error: 'Could not update booking' });
      notifyBookingStatus(pool, req.restaurantId, id, status, { tokenFor: phoneId => tokenForNumber(pool, phoneId) }).catch(() => {});
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  router.get(base + '/report', async (req, res) => {
    try { res.json({ report: await bookingReport(pool, req.restaurantId, Number(req.query.days) || 30) }); } catch (e) { fail(res, e); }
  });
  router.get(base + '/discounts', async (req, res) => {
    try { res.json({ discounts: await listDiscounts(pool, req.restaurantId) }); } catch (e) { fail(res, e); }
  });
  router.post(base + '/discounts', async (req, res) => {
    try { const r = await saveDiscount(pool, req.restaurantId, req.body || {}); if (r.error) return res.status(400).json(r); res.status(201).json(r); } catch (e) { fail(res, e); }
  });
  router.patch(base + '/discounts/:id', async (req, res) => {
    try { res.json(await toggleDiscount(pool, req.restaurantId, idParam(req.params.id), req.body?.active === true)); } catch (e) { fail(res, e); }
  });
  router.get(base + '/team', async (req, res) => {
    try {
      const [rows] = await pool.execute("SELECT u.id,u.email,m.role FROM restaurant_members m JOIN users u ON u.id=m.user_id WHERE m.restaurant_id=? ORDER BY m.role, u.id", [req.restaurantId]);
      res.json({ team: rows.map(r => ({ id: Number(r.id), email: r.email, role: r.role })) });
    } catch (e) { fail(res, e); }
  });
  router.post(base + '/team', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase(), password = String(req.body?.password || '');
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: 'Enter a valid email' });
    try {
      const [[existing]] = await pool.execute('SELECT id FROM users WHERE email=? LIMIT 1', [email]);
      let userId = existing?.id;
      if (!userId) {
        if (password.length < 12 || password.length > 1024) return res.status(400).json({ error: 'Give the new staff member a password of at least 12 characters' });
        const [u] = await pool.execute('INSERT INTO users(email,password_hash) VALUES (?,?)', [email, await hashPassword(password)]);
        userId = u.insertId;
      }
      const [[member]] = await pool.execute('SELECT role FROM restaurant_members WHERE restaurant_id=? AND user_id=?', [req.restaurantId, userId]);
      if (member) return res.status(409).json({ error: 'This person is already on your team' });
      await pool.execute("INSERT INTO restaurant_members(restaurant_id,user_id,role) VALUES (?,?,'staff')", [req.restaurantId, userId]);
      await audit(pool, { actorUserId: req.user.id, restaurantId: req.restaurantId, action: 'team.add_staff' }).catch(() => {});
      res.status(201).json({ ok: true, existing: Boolean(existing) });
    } catch (e) { fail(res, e); }
  });
  router.delete(base + '/team/:userId', async (req, res) => {
    try {
      const [r] = await pool.execute("DELETE FROM restaurant_members WHERE restaurant_id=? AND user_id=? AND role='staff'", [req.restaurantId, idParam(req.params.userId)]);
      if (r.affectedRows) await audit(pool, { actorUserId: req.user.id, restaurantId: req.restaurantId, action: 'team.remove_staff' }).catch(() => {});
      res.json({ removed: r.affectedRows > 0 });
    } catch (e) { fail(res, e); }
  });
  router.put(base + '/contacts', async (req, res) => {
    try {
      const result = await setTransferPhone(pool, req.restaurantId, req.body?.transfer_phone);
      if (result.error) return res.status(400).json(result);
      syncCallBookingTools(pool, req.restaurantId).catch(() => {});
      res.json(result);
    } catch (e) { fail(res, e); }
  });
  router.get(base + '/bookings/:id/payments', async (req, res) => {
    try { res.json({ payments: await bookingPayments(pool, req.restaurantId, idParam(req.params.id)) }); } catch (e) { fail(res, e); }
  });
  router.post(base + '/bookings/:id/payments', async (req, res) => {
    try {
      const result = await recordPayment(pool, req.restaurantId, idParam(req.params.id), req.body || {}, 'owner:' + req.user.id);
      if (result.error) return res.status(400).json(result);
      res.status(201).json(result);
    } catch (e) { fail(res, e); }
  });
  router.patch(base + '/bookings/:id/payments/:pid', async (req, res) => {
    try {
      const result = await decidePayment(pool, req.restaurantId, idParam(req.params.id), idParam(req.params.pid), req.body?.status, 'owner:' + req.user.id);
      if (result.error) return res.status(400).json(result);
      res.json(result);
    } catch (e) { fail(res, e); }
  });
  router.get(base + '/handovers', async (req, res) => {
    try { res.json({ handovers: await listHandovers(pool, req.restaurantId) }); } catch (e) { fail(res, e); }
  });
  router.delete(base + '/handovers/:customer', async (req, res) => {
    try { res.json({ ended: await endHandover(pool, req.restaurantId, req.params.customer) }); } catch (e) { fail(res, e); }
  });
  router.delete(base + '/services/:id', async (req, res) => {
    try {
      const done = await deleteService(pool, req.restaurantId, idParam(req.params.id));
      if (!done) return res.status(404).json({ error: 'Not found' });
      res.json({ result: done, services: await listServices(pool, req.restaurantId) });
    } catch (e) { fail(res, e); }
  });
  router.delete(base + '/resources/:id', async (req, res) => {
    try {
      const done = await deleteResource(pool, req.restaurantId, idParam(req.params.id));
      if (!done) return res.status(404).json({ error: 'Not found' });
      res.json({ result: done, resources: await listResources(pool, req.restaurantId) });
    } catch (e) { fail(res, e); }
  });
  router.patch(base + '/resources/:id/room-status', async (req, res) => {
    try {
      if (!await setRoomStatus(pool, req.restaurantId, idParam(req.params.id), req.body?.status)) return res.status(400).json({ error: 'Could not update room' });
      res.json({ resources: await listResources(pool, req.restaurantId) });
    } catch (e) { fail(res, e); }
  });
  router.put(base + '/bookings/:id/reschedule', async (req, res) => {
    try {
      const id = idParam(req.params.id);
      const result = await rescheduleBooking(pool, req.restaurantId, id, req.body || {}, 'owner:' + req.user.id);
      if (result.error) return res.status(409).json(result);
      notifyBookingStatus(pool, req.restaurantId, id, 'rescheduled', { tokenFor: phoneId => tokenForNumber(pool, phoneId), when: result.booking.start_at }).catch(() => {});
      res.json(result);
    } catch (e) { fail(res, e); }
  });
  router.get(base + '/bookings/:id/history', async (req, res) => {
    try { res.json({ events: await bookingEvents(pool, req.restaurantId, idParam(req.params.id)) }); } catch (e) { fail(res, e); }
  });
  router.get(base + '/bookings.csv', async (req, res) => {
    try {
      const rows = await listBookings(pool, req.restaurantId, { from: req.query.from, to: req.query.to, status: req.query.status, q: req.query.q });
      res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="bookings.csv"', 'Cache-Control': 'no-store' });
      res.send('\ufeff' + toCsv(rows, [['id', 'Booking'], ['start_at', 'Start'], ['end_at', 'End'], ['service', 'Service'], ['resource', 'Staff / room'], ['customer_name', 'Name'], ['customer_phone', 'Phone'], ['guests', 'People'], ['status', 'Status'], ['source', 'Source'], ['price_minor', 'Price (x100)'], ['note', 'Note']]));
    } catch (e) { fail(res, e); }
  });
  router.get(base + '/customers', async (req, res) => {
    try { res.json({ customers: await listCustomers(pool, req.restaurantId, { q: req.query.q }) }); } catch (e) { fail(res, e); }
  });
  router.get(base + '/customers.csv', async (req, res) => {
    try {
      const rows = await listCustomers(pool, req.restaurantId, { q: req.query.q });
      res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="customers.csv"', 'Cache-Control': 'no-store' });
      res.send('\ufeff' + toCsv(rows, [['name', 'Name'], ['phone', 'Phone'], ['bookings', 'Bookings'], ['visits', 'Visits'], ['missed', 'Cancelled / no-show'], ['spent_minor', 'Spent (x100)'], ['last_at', 'Last visit'], ['next_at', 'Next booking']]));
    } catch (e) { fail(res, e); }
  });
  router.get(base + '/customers/:phone', async (req, res) => {
    const phone = String(req.params.phone || '');
    if (!/^\+?\d{7,16}$/.test(phone)) return res.status(400).json({ error: 'Invalid phone' });
    try { res.json({ bookings: await customerBookings(pool, req.restaurantId, phone) }); } catch (e) { fail(res, e); }
  });

  // ---- Public booking (website) ----
  router.get('/r/:slug/book', (req, res) => {
    if (!/^[a-z0-9-]{1,160}$/.test(req.params.slug)) return res.status(404).end();
    res.redirect(302, '/book.html?b=' + req.params.slug);
  });
  const pub = '/api/public/book/:slug';
  const bySlug = async (req, res, next) => {
    if (!/^[a-z0-9-]{1,160}$/.test(req.params.slug)) return res.status(400).json({ error: 'Invalid address' });
    try {
      const [rows] = await pool.execute('SELECT id,name,slug,currency FROM restaurants WHERE slug=? LIMIT 1', [req.params.slug]);
      if (!rows.length) return res.status(404).json({ error: 'Not found' });
      req.business = rows[0];
      req.profile = await getProfile(pool, rows[0].id);
      if (!req.profile.bookings_enabled) return res.status(404).json({ error: 'Online booking is off' });
      next();
    } catch (e) { fail(res, e); }
  };
  router.get(pub, bySlug, async (req, res) => {
    try {
      const [services, resources] = await Promise.all([listServices(pool, req.business.id, { activeOnly: true }), listResources(pool, req.business.id, { activeOnly: true })]);
      res.set('Cache-Control', 'no-store');
      res.json({ business: { name: req.business.name, slug: req.business.slug, currency: req.business.currency }, category: req.profile.category, type: req.profile.type, hours: req.profile.hours, services, resources: resources.map(r => ({ id: r.id, name: r.name, specialty: r.specialty || null })) });
    } catch (e) { fail(res, e); }
  });
  router.get(pub + '/availability', bySlug, async (req, res) => {
    try {
      const result = await availability(pool, req.business.id, { serviceId: req.query.service_id, date: req.query.date, checkOut: req.query.check_out, resourceId: idParam(req.query.resource_id) || null });
      if (result.error) return res.status(400).json({ error: result.error });
      res.set('Cache-Control', 'no-store');
      res.json(result.kind === 'night' ? { kind: 'night', nights: result.nights, rooms_left: result.rooms_left, total_minor: result.total_minor } : { kind: 'slot', slots: result.slots });
    } catch (e) { fail(res, e); }
  });
  router.post(pub + '/bookings', rateLimit({ windowMs: 10 * 60 * 1000, max: 10, methods: ['POST'], name: 'public-booking' }), bySlug, async (req, res) => {
    try {
      const b = req.body || {};
      if (!isDate(b.date)) return res.status(400).json({ error: 'Choose a date' });
      const result = await createBooking(pool, req.business.id, { service_id: b.service_id, date: b.date, time: b.time, check_out: b.check_out, resource_id: b.resource_id, customer_name: b.customer_name, customer_phone: b.customer_phone, guests: b.guests, note: b.note, discount_code: b.discount_code, source: 'website' });
      if (result.error) return res.status(409).json({ error: result.error });
      notifyNewBooking(pool, req.business.id, result.booking, 'Website');
      const token = await bookingToken(pool, req.business.id, result.booking.id);
      const svc = (await listServices(pool, req.business.id, { activeOnly: true })).find(x => x.id === Number(b.service_id));
      const pay = publicPaymentOptions(await loadPaymentSettings(pool, req.business.id)).filter(o => o.type !== 'cash' && o.type !== 'card_on_delivery');
      res.status(201).json({ booking: { id: result.booking.id, service: result.booking.service, start_at: result.booking.start_at, end_at: result.booking.end_at, price_minor: result.booking.price_minor, status: result.booking.status }, token, deposit_minor: svc?.deposit_minor || 0, pay_options: pay });
    } catch (e) { fail(res, e); }
  });
  router.post(pub + '/bookings/:id/payment', rateLimit({ windowMs: 10 * 60 * 1000, max: 10, methods: ['POST'], name: 'public-booking-pay' }), bySlug, async (req, res) => {
    try {
      const result = await customerPaymentReference(pool, req.business.id, idParam(req.params.id), req.body?.token, req.body || {});
      if (result.error) return res.status(400).json(result);
      res.json(result);
    } catch (e) { fail(res, e); }
  });
  return router;
}
