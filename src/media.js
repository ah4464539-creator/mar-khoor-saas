import express from 'express';
import { requireAuth } from './auth.js';
import { rateLimit } from './security.js';
import { saveMedia, loadMedia, MediaError, MAX_IMAGE_BYTES, MEDIA_KINDS } from './media-store.js';

export function mediaRouter(pool) {
  const router = express.Router();

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

  router.post('/api/restaurants/:restaurantId/media',
    rateLimit({ windowMs: 10 * 60 * 1000, max: 60, name: 'media-upload' }),
    requireAuth, restaurantAdmin,
    express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: MAX_IMAGE_BYTES }),
    async (req, res) => {
      res.set('Cache-Control', 'no-store');
      const kind = String(req.query.kind || 'menu');
      if (!MEDIA_KINDS.includes(kind)) return res.status(400).json({ error: 'Unknown image type' });
      if (!Buffer.isBuffer(req.body)) return res.status(415).json({ error: 'Use a JPG, PNG or WebP image' });
      try {
        const saved = await saveMedia(pool, { restaurantId: req.restaurantId, kind, buffer: req.body, userId: req.user.id });
        res.status(201).json(saved);
      } catch (error) {
        if (error instanceof MediaError) return res.status(error.status).json({ error: error.message });
        console.warn(JSON.stringify({ event: 'media_upload_failed', code: error?.code }));
        res.status(503).json({ error: 'Image upload is unavailable right now' });
      }
    });

  // Public image delivery. Unguessable token in the path; content never changes, so cache for a year.
  router.get('/media/:file', async (req, res) => {
    try {
      const media = await loadMedia(pool, '/media/' + req.params.file);
      if (!media) return res.status(404).type('text/plain').send('Not found');
      res.set({
        'Content-Type': media.mime,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Content-Disposition': 'inline',
      });
      res.send(media.data);
    } catch { res.status(503).type('text/plain').send('Unavailable'); }
  });

  // Uploads that exceed the size limit or use another format get a clear JSON answer.
  router.use('/api/restaurants/:restaurantId/media', (error, _req, res, next) => {
    if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'Images must be 5 MB or smaller' });
    next(error);
  });
  return router;
}
