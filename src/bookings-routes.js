// HTTP routes for business type and bookings: owner management + public booking.
import express from 'express';
import { requireAuth } from './auth.js';
import { rateLimit, audit } from './security.js';
import { pushToRestaurant } from './web-push.js';
import {
  BUSINESS_TYPES, getProfile, saveProfile, listServices, listResources, saveService, saveResource,
  cleanService, cleanResource, availability, createBooking, listBookings, setBookingStatus, isDate,
} from './bookings.js';

const idParam = v => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : 0; };

export async function notifyNewBooking(pool, restaurantId, booking, source) {
  const when = booking.start_at.replace(' ', ' at ');
  return pushToRestaurant(pool, restaurantId, { title: '📅 New booking #' + booking.id, body: [booking.service, when, source].filter(Boolean).join(' · '), url: '/restaurant.html#bookings', tag: 'booking-' + booking.id }).catch(() => ({ sent: 0 }));
}

export function bookingsRouter(pool) {
  const router = express.Router();
  const access = async (req, res, next) => {
    const id = idParam(req.params.restaurantId);
    if (!id) return res.status(400).json({ error: 'Invalid business' });
    try {
      if (req.user.platformRole !== 'super_admin') {
        const [rows] = await pool.execute("SELECT 1 FROM restaurant_members WHERE restaurant_id=? AND user_id=? AND role='admin' LIMIT 1", [id, req.user.id]);
        if (!rows.length) return res.status(403).json({ error: 'Forbidden' });
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
      res.json({ profile, services, resources, types: BUSINESS_TYPES });
    } catch (e) { fail(res, e); }
  });
  router.put(base + '/profile', async (req, res) => {
    try {
      const profile = await saveProfile(pool, req.restaurantId, req.body || {});
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
    try { res.json({ bookings: await listBookings(pool, req.restaurantId, { from: req.query.from, to: req.query.to, status: req.query.status }) }); }
    catch (e) { fail(res, e); }
  });
  router.get(base + '/availability', async (req, res) => {
    try {
      const result = await availability(pool, req.restaurantId, { serviceId: req.query.service_id, date: req.query.date, checkOut: req.query.check_out });
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
      const ok = await setBookingStatus(pool, req.restaurantId, idParam(req.params.id), req.body?.status);
      if (!ok) return res.status(400).json({ error: 'Could not update booking' });
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
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
      res.json({ business: { name: req.business.name, slug: req.business.slug, currency: req.business.currency }, category: req.profile.category, type: req.profile.type, hours: req.profile.hours, services, resources: resources.map(r => ({ id: r.id, name: r.name })) });
    } catch (e) { fail(res, e); }
  });
  router.get(pub + '/availability', bySlug, async (req, res) => {
    try {
      const result = await availability(pool, req.business.id, { serviceId: req.query.service_id, date: req.query.date, checkOut: req.query.check_out });
      if (result.error) return res.status(400).json({ error: result.error });
      res.set('Cache-Control', 'no-store');
      res.json(result.kind === 'night' ? { kind: 'night', nights: result.nights, rooms_left: result.rooms_left, total_minor: result.total_minor } : { kind: 'slot', slots: result.slots });
    } catch (e) { fail(res, e); }
  });
  router.post(pub + '/bookings', rateLimit({ windowMs: 10 * 60 * 1000, max: 10, methods: ['POST'], name: 'public-booking' }), bySlug, async (req, res) => {
    try {
      const b = req.body || {};
      if (!isDate(b.date)) return res.status(400).json({ error: 'Choose a date' });
      const result = await createBooking(pool, req.business.id, { service_id: b.service_id, date: b.date, time: b.time, check_out: b.check_out, resource_id: b.resource_id, customer_name: b.customer_name, customer_phone: b.customer_phone, guests: b.guests, note: b.note, source: 'website' });
      if (result.error) return res.status(409).json({ error: result.error });
      notifyNewBooking(pool, req.business.id, result.booking, 'Website');
      res.status(201).json({ booking: { id: result.booking.id, service: result.booking.service, start_at: result.booking.start_at, end_at: result.booking.end_at, price_minor: result.booking.price_minor, status: result.booking.status } });
    } catch (e) { fail(res, e); }
  });
  return router;
}
