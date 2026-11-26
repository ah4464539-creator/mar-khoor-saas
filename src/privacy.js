// Restaurant privacy settings: how long customer messages and call transcripts are kept.
//   GET /api/restaurants/:restaurantId/privacy   { message_retention_days, default_days, min_days, max_days }
//   PUT /api/restaurants/:restaurantId/privacy   { message_retention_days: 7-365 | null (platform default) }
import express from 'express';
import { requireAuth } from './auth.js';
import { audit } from './security.js';
import { getRetention, setRetention, validRetentionDays, retentionConfig, ensureRetentionTable, RESTAURANT_MIN_DAYS, RESTAURANT_MAX_DAYS } from './retention.js';

export function privacyRouter(pool) {
  ensureRetentionTable(pool).catch(() => {});
  const router = express.Router();
  const admin = async (req, res, next) => {
    const id = Number(req.params.restaurantId);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid restaurant' });
    try {
      if (req.user.platformRole !== 'super_admin') {
        const [rows] = await pool.execute("SELECT 1 FROM restaurant_members WHERE restaurant_id=? AND user_id=? AND role='admin' LIMIT 1", [id, req.user.id]);
        if (!rows.length) return res.status(403).json({ error: 'Only restaurant admins can change privacy settings' });
      }
      req.restaurantId = id;
      next();
    } catch { res.status(503).json({ error: 'Database unavailable' }); }
  };
  const view = async id => {
    const config = retentionConfig();
    return { message_retention_days: await getRetention(pool, id), default_days: { messages: config.messages, transcripts: config.transcripts }, min_days: RESTAURANT_MIN_DAYS, max_days: RESTAURANT_MAX_DAYS };
  };
  router.get('/api/restaurants/:restaurantId/privacy', requireAuth, admin, async (req, res) => {
    try { res.set('Cache-Control', 'no-store, private').json(await view(req.restaurantId)); } catch { res.status(503).json({ error: 'Privacy settings unavailable' }); }
  });
  router.put('/api/restaurants/:restaurantId/privacy', requireAuth, admin, async (req, res) => {
    const raw = req.body?.message_retention_days;
    const checked = validRetentionDays(raw === undefined ? undefined : raw);
    if (checked.error || raw === undefined) return res.status(400).json({ error: checked.error || 'message_retention_days is required' });
    try {
      await setRetention(pool, req.restaurantId, checked.value);
      await audit(pool, { actorUserId: req.user.id, restaurantId: req.restaurantId, action: 'privacy.retention:' + (checked.value ?? 'default') });
      res.json(await view(req.restaurantId));
    } catch { res.status(503).json({ error: 'Privacy settings unavailable' }); }
  });
  return router;
}
