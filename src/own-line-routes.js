// Owner API for "use your own number" (see src/own-line.js). Restaurant admins only.
//   GET    /api/restaurants/:restaurantId/own-line                 { available, missing, line, line_types }
//   PUT    /api/restaurants/:restaurantId/own-line                 { phone_number, line_type }
//   POST   /api/restaurants/:restaurantId/own-line/reset-password
//   DELETE /api/restaurants/:restaurantId/own-line
import express from 'express';
import { requireAuth } from './auth.js';
import { audit, rateLimit } from './security.js';
import { LINE_TYPES, ownLineConfig, getOwnLine, ownLineView, connectOwnLine, resetOwnLinePassword, removeOwnLine, ensureOwnLineTable } from './own-line.js';

export function ownLineRouter(pool, { env = process.env, fetcher = fetch } = {}) {
  ensureOwnLineTable(pool).catch(() => {});
  const router = express.Router();
  const admin = async (req, res, next) => {
    const id = Number(req.params.restaurantId);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid business' });
    try {
      if (req.user.platformRole !== 'super_admin') {
        const [rows] = await pool.execute("SELECT 1 FROM restaurant_members WHERE restaurant_id=? AND user_id=? AND role='admin' LIMIT 1", [id, req.user.id]);
        if (!rows.length) return res.status(403).json({ error: 'Only admins can change the AI Caller line' });
      }
      req.restaurantId = id;
      next();
    } catch { res.status(503).json({ error: 'Database unavailable' }); }
  };
  const base = '/api/restaurants/:restaurantId/own-line';
  const fail = (res, error, what) => {
    console.error(JSON.stringify({ event: 'own_line_failed', what, status: error?.providerStatus, message: String(error?.message || '').slice(0, 160) }));
    res.status(502).json({ error: 'The AI line could not be updated right now. Please try again in a minute.' });
  };

  router.get(base, requireAuth, admin, async (req, res) => {
    res.set('Cache-Control', 'no-store, private');
    try {
      const config = ownLineConfig(env);
      res.json({ available: config.ready, missing: config.missing, line_types: LINE_TYPES, line: ownLineView(await getOwnLine(pool, req.restaurantId), env) });
    } catch { res.status(503).json({ error: 'AI line unavailable' }); }
  });
  router.put(base, requireAuth, admin, rateLimit({ windowMs: 60000, max: 6, name: 'own-line' }), express.json({ limit: '4kb' }), async (req, res) => {
    try {
      const result = await connectOwnLine(pool, req.restaurantId, req.body, { env, fetcher });
      if (result.status < 300) await audit(pool, { actorUserId: req.user.id, restaurantId: req.restaurantId, action: 'ai_caller.own_line:' + req.body?.line_type });
      res.status(result.status).json(result.body);
    } catch (error) { fail(res, error, 'connect'); }
  });
  router.post(base + '/reset-password', requireAuth, admin, rateLimit({ windowMs: 60000, max: 3, name: 'own-line-reset' }), async (req, res) => {
    try {
      const result = await resetOwnLinePassword(pool, req.restaurantId, { env, fetcher });
      if (result.status === 200) await audit(pool, { actorUserId: req.user.id, restaurantId: req.restaurantId, action: 'ai_caller.own_line_password_reset' });
      res.status(result.status).json(result.body);
    } catch (error) { fail(res, error, 'reset'); }
  });
  router.delete(base, requireAuth, admin, async (req, res) => {
    try {
      const result = await removeOwnLine(pool, req.restaurantId, { env, fetcher });
      if (result.body.removed) await audit(pool, { actorUserId: req.user.id, restaurantId: req.restaurantId, action: 'ai_caller.own_line_removed' });
      res.status(result.status).json(result.body);
    } catch (error) { fail(res, error, 'remove'); }
  });
  return router;
}
