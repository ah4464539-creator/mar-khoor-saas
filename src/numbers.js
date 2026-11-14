import express from 'express';
import { requireAuth } from './auth.js';
import { listCandidates, purchaseNumber, retryNumber } from './provisioning.js';
import { audit } from './security.js';

export function numbersRouter(pool) {
 const router = express.Router();
 const superOnly = (req, res, next) => req.user.platformRole === 'super_admin' ? next() : res.status(403).json({ error: 'Forbidden' });
 const send = (res, result) => res.status(result.status).json(result.body);
 const guard = fn => async (req, res) => { try { await fn(req, res); } catch { res.status(503).json({ error: 'Number service unavailable' }); } };

 router.get('/platform/plan-orders/:orderId/number-candidates', requireAuth, superOnly, guard(async (req, res) => send(res, await listCandidates(pool, Number(req.params.orderId)))));
 router.post('/platform/plan-orders/:orderId/number', requireAuth, superOnly, guard(async (req, res) => {
  const result = await purchaseNumber(pool, Number(req.params.orderId), req.body?.phone_number);
  await audit(pool, { actorUserId: req.user.id, action: 'number.purchase:' + Number(req.params.orderId) + ':' + result.status });
  send(res, result);
 }));
 router.post('/platform/numbers/:numberId/retry', requireAuth, superOnly, guard(async (req, res) => {
  const result = await retryNumber(pool, Number(req.params.numberId));
  await audit(pool, { actorUserId: req.user.id, action: 'number.retry:' + Number(req.params.numberId) + ':' + result.status });
  send(res, result);
 }));
 router.get('/platform/numbers', requireAuth, superOnly, guard(async (_req, res) => {
  const [numbers] = await pool.query('SELECT n.id,n.restaurant_id,r.name AS restaurant_name,n.plan_order_id,n.country_code,n.phone_number,n.status,n.last_error,n.created_at FROM restaurant_numbers n JOIN restaurants r ON r.id=n.restaurant_id ORDER BY n.id DESC LIMIT 200');
  res.json({ numbers });
 }));
 // A restaurant admin sees only its own active numbers.
 router.get('/restaurants/:restaurantId/numbers', requireAuth, guard(async (req, res) => {
  const id = Number(req.params.restaurantId);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid restaurant' });
  if (req.user.platformRole !== 'super_admin') {
   const [rows] = await pool.execute("SELECT role FROM restaurant_members WHERE restaurant_id=? AND user_id=? AND role='admin' LIMIT 1", [id, req.user.id]);
   if (!rows.length) return res.status(403).json({ error: 'Forbidden' });
  }
  const [numbers] = await pool.execute("SELECT phone_number,country_code FROM restaurant_numbers WHERE restaurant_id=? AND status='active' ORDER BY id", [id]);
  res.json({ numbers });
 }));
 return router;
}
