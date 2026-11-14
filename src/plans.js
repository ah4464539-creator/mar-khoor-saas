import express from 'express';
import { requireAuth } from './auth.js';
import { normalizeRoute } from './number-routes.js';
import { createPlanOrder, listPlanOrders, changeOrderStatus } from './plan-orders.js';
import { audit } from './security.js';

export function plansRouter(pool) {
 const router = express.Router();
 const superOnly = (req, res, next) => req.user.platformRole === 'super_admin' ? next() : res.status(403).json({ error: 'Forbidden' });
 const restaurantAdmin = async (req, res, next) => {
  const id = Number(req.params.restaurantId);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid restaurant' });
  try {
   if (req.user.platformRole !== 'super_admin') {
    const [rows] = await pool.execute("SELECT role FROM restaurant_members WHERE restaurant_id=? AND user_id=? AND role='admin' LIMIT 1", [id, req.user.id]);
    if (!rows.length) return res.status(403).json({ error: 'Forbidden' });
   }
   req.restaurantId = id;
   next();
  } catch { res.status(503).json({ error: 'Database unavailable' }); }
 };

 // Super admin: country-wise number routes.
 router.get('/platform/number-routes', requireAuth, superOnly, async (_req, res) => {
  try {
   const [routes] = await pool.query('SELECT country_code,provider,mode,monthly_minor,setup_minor,requirements FROM number_routes ORDER BY country_code');
   res.json({ routes });
  } catch { res.status(503).json({ error: 'Routes unavailable' }); }
 });
 router.put('/platform/number-routes/:country', requireAuth, superOnly, async (req, res) => {
  const { route, error } = normalizeRoute(req.params.country, req.body);
  if (error) return res.status(400).json({ error });
  try {
   await pool.execute(
    'INSERT INTO number_routes(country_code,provider,mode,monthly_minor,setup_minor,requirements) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE provider=VALUES(provider),mode=VALUES(mode),monthly_minor=VALUES(monthly_minor),setup_minor=VALUES(setup_minor),requirements=VALUES(requirements)',
    [route.country_code, route.provider, route.mode, route.monthly_minor, route.setup_minor, route.requirements]
   );
   await audit(pool, { actorUserId: req.user.id, action: 'number_route.set:' + route.country_code + ':' + route.provider + ':' + route.mode });
   res.json({ route });
  } catch { res.status(503).json({ error: 'Routes unavailable' }); }
 });

 // Super admin: all orders and manual status changes (payment is confirmed by hand for now).
 router.get('/platform/plan-orders', requireAuth, superOnly, async (_req, res) => {
  try { res.json({ orders: await listPlanOrders(pool) }); } catch { res.status(503).json({ error: 'Orders unavailable' }); }
 });
 router.put('/platform/plan-orders/:orderId/status', requireAuth, superOnly, async (req, res) => {
  const result = await changeOrderStatus(pool, Number(req.params.orderId), req.body?.status);
  if (result.status === 200) await audit(pool, { actorUserId: req.user.id, action: 'plan_order.status:' + Number(req.params.orderId) + ':' + String(req.body?.status) });
  res.status(result.status).json(result.body);
 });

 // Restaurant admin: own cart.
 router.get('/restaurants/:restaurantId/plan-orders', requireAuth, restaurantAdmin, async (req, res) => {
  try { res.json({ orders: await listPlanOrders(pool, { restaurantId: req.restaurantId }) }); } catch { res.status(503).json({ error: 'Orders unavailable' }); }
 });
 router.post('/restaurants/:restaurantId/plan-orders', requireAuth, restaurantAdmin, async (req, res) => {
  const result = await createPlanOrder(pool, req.restaurantId, req.body);
  if (result.status === 201) await audit(pool, { actorUserId: req.user.id, restaurantId: req.restaurantId, action: 'plan_order.create' });
  res.status(result.status).json(result.body);
 });
 router.post('/restaurants/:restaurantId/plan-orders/:orderId/cancel', requireAuth, restaurantAdmin, async (req, res) => {
  const orderId = Number(req.params.orderId);
  // A restaurant may cancel only before payment; later changes go through the super admin.
  const current = await changeOrderStatus(pool, orderId, 'cancelled', { restaurantId: req.restaurantId, onlyFrom: 'pending_payment' });
  if (current.status === 200) await audit(pool, { actorUserId: req.user.id, restaurantId: req.restaurantId, action: 'plan_order.cancel:' + orderId });
  res.status(current.status).json(current.body);
 });
 return router;
}
