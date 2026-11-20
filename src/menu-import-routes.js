import express from 'express';
import { requireAuth } from './auth.js';
import { rateLimit, audit } from './security.js';
import { extractMenu, MenuImportError, MAX_IMPORT_BYTES, MAX_IMPORT_ITEMS } from './menu-import.js';
import { isAllowedImageRef } from './media-store.js';

export function menuImportRouter(pool, { fetcher = fetch } = {}) {
  const router = express.Router();
  const restaurantAdmin = async (req, res, next) => {
    const id = Number(req.params.restaurantId);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid restaurant' });
    try {
      if (req.user.platformRole !== 'super_admin') {
        const [rows] = await pool.execute("SELECT role FROM restaurant_members WHERE restaurant_id=? AND user_id=? AND role='admin' LIMIT 1", [id, req.user.id]);
        if (!rows.length) return res.status(403).json({ error: 'Forbidden' });
      }
      const [restaurants] = await pool.execute('SELECT id,currency FROM restaurants WHERE id=? LIMIT 1', [id]);
      if (!restaurants.length) return res.status(404).json({ error: 'Restaurant not found' });
      req.restaurant = restaurants[0];
      next();
    } catch { res.status(503).json({ error: 'Database unavailable' }); }
  };

  // Read a menu with AI. Returns a draft only; nothing is saved.
  router.post('/api/restaurants/:restaurantId/menu/import',
    rateLimit({ windowMs: 60 * 60 * 1000, max: 15, name: 'menu-import' }),
    requireAuth, restaurantAdmin,
    express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], limit: MAX_IMPORT_BYTES }),
    async (req, res) => {
      res.set('Cache-Control', 'no-store');
      const type = (req.get('content-type') || '').split(';')[0].trim();
      let source;
      if (Buffer.isBuffer(req.body)) source = type === 'application/pdf' ? { kind: 'pdf', buffer: req.body } : { kind: 'image', mime: type, buffer: req.body };
      else if (typeof req.body?.url === 'string') source = { kind: 'url', url: req.body.url.trim().slice(0, 2048) };
      else if (typeof req.body?.text === 'string') source = { kind: 'text', text: req.body.text.slice(0, 60000) };
      else return res.status(400).json({ error: 'Choose a photo, PDF, link or text' });
      try {
        const result = await extractMenu(source, { fetcher, currency: req.restaurant.currency });
        res.json({ items: result.items, source: source.kind });
      } catch (error) {
        if (error instanceof MenuImportError) return res.status(error.status).json({ error: error.message });
        console.warn(JSON.stringify({ event: 'menu_import_failed', name: error?.name }));
        res.status(503).json({ error: 'Menu import is unavailable right now' });
      }
    });

  // Add many reviewed items at once (all or nothing).
  router.post('/api/restaurants/:restaurantId/menu/bulk', requireAuth, restaurantAdmin, async (req, res) => {
    const items = req.body?.items;
    if (!Array.isArray(items) || !items.length || items.length > MAX_IMPORT_ITEMS) return res.status(400).json({ error: 'Send between 1 and ' + MAX_IMPORT_ITEMS + ' items' });
    const rows = [];
    for (const item of items) {
      const name = typeof item?.name === 'string' ? item.name.trim() : '';
      const description = typeof item?.description === 'string' ? item.description.trim() : '';
      const category = typeof item?.category === 'string' ? item.category.trim() : '';
      const imageUrl = typeof item?.image_url === 'string' ? item.image_url.trim() : '';
      if (!name || name.length > 180 || description.length > 10000 || category.length > 80 || !Number.isSafeInteger(item?.price_minor) || item.price_minor < 0 || item.price_minor > 1000000000 || (imageUrl && !isAllowedImageRef(imageUrl)))
        return res.status(400).json({ error: 'Check item "' + (name || '?').slice(0, 40) + '": it needs a name and a price' });
      rows.push([req.restaurant.id, name, description, item.price_minor, category, imageUrl]);
    }
    let connection;
    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();
      for (const row of rows) await connection.execute('INSERT INTO menu_items (restaurant_id,name,description,price_minor,category,image_url) VALUES (?,?,?,?,?,?)', row);
      await connection.commit();
      audit(pool, { actorUserId: req.user.id, restaurantId: req.restaurant.id, action: 'menu.bulk_add' }).catch?.(() => {});
      res.status(201).json({ added: rows.length });
    } catch {
      if (connection) await connection.rollback().catch(() => {});
      res.status(503).json({ error: 'Database unavailable' });
    } finally { connection?.release(); }
  });

  router.use('/api/restaurants/:restaurantId/menu/import', (error, _req, res, next) => {
    if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'Files must be 8 MB or smaller' });
    next(error);
  });
  return router;
}
