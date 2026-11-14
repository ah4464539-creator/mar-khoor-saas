import express from 'express';
import { requireAuth } from './auth.js';
import { generateSiteConfig, renderSitePage, SITE_CSP } from './site-builder.js';
import { loadRestaurant, loadSite, saveSite, canPublish, setPublished, loadPublicSite } from './site-store.js';
import { audit } from './security.js';

const notFound = '<!doctype html><meta charset="utf-8"><title>Not found</title><p>This restaurant website is not available.</p>';

export function sitesRouter(pool) {
 const router = express.Router();
 const restaurantAdmin = async (req, res, next) => {
  const id = Number(req.params.restaurantId);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid restaurant' });
  try {
   if (req.user.platformRole !== 'super_admin') {
    const [rows] = await pool.execute("SELECT role FROM restaurant_members WHERE restaurant_id=? AND user_id=? AND role='admin' LIMIT 1", [id, req.user.id]);
    if (!rows.length) return res.status(403).json({ error: 'Forbidden' });
   }
   req.restaurant = await loadRestaurant(pool, id);
   if (!req.restaurant) return res.status(404).json({ error: 'Restaurant not found' });
   next();
  } catch { res.status(503).json({ error: 'Database unavailable' }); }
 };

 // Public website. Fixed template, strict CSP, no scripts.
 router.get('/r/:slug', async (req, res) => {
  res.set('Content-Security-Policy', SITE_CSP);
  try {
   const site = await loadPublicSite(pool, req.params.slug);
   if (!site) return res.status(404).type('html').send(notFound);
   res.set('Cache-Control', 'public, max-age=60');
   res.type('html').send(renderSitePage(site));
  } catch { res.status(503).type('html').send(notFound); }
 });

 router.get('/api/restaurants/:restaurantId/site', requireAuth, restaurantAdmin, async (req, res) => {
  try { res.json({ slug: req.restaurant.slug, ...(await loadSite(pool, req.restaurant)) }); }
  catch { res.status(503).json({ error: 'Website unavailable' }); }
 });
 router.post('/api/restaurants/:restaurantId/site/generate', requireAuth, restaurantAdmin, async (req, res) => {
  try {
   const current = await loadSite(pool, req.restaurant);
   const description = typeof req.body?.description === 'string' ? req.body.description : current.description;
   const [menuItems] = await pool.execute('SELECT name FROM menu_items WHERE restaurant_id=? AND active=1 ORDER BY id LIMIT 30', [req.restaurant.id]);
   const generated = await generateSiteConfig({ restaurant: req.restaurant, menuItems, description, current: current.config });
   const saved = await saveSite(pool, req.restaurant, { config: generated.config, description });
   res.json({ ...saved, source: generated.source, published: current.published });
  } catch { res.status(503).json({ error: 'Website unavailable' }); }
 });
 router.put('/api/restaurants/:restaurantId/site', requireAuth, restaurantAdmin, async (req, res) => {
  if (!req.body || typeof req.body.config !== 'object' || req.body.config === null) return res.status(400).json({ error: 'Invalid website settings' });
  try {
   const saved = await saveSite(pool, req.restaurant, { config: req.body.config, description: req.body.description });
   res.json(saved);
  } catch { res.status(503).json({ error: 'Website unavailable' }); }
 });
 router.post('/api/restaurants/:restaurantId/site/publish', requireAuth, restaurantAdmin, async (req, res) => {
  const published = req.body?.published;
  if (typeof published !== 'boolean') return res.status(400).json({ error: 'published must be true or false' });
  try {
   if (published && !(await canPublish(pool, req.restaurant.id, { superAdmin: req.user.platformRole === 'super_admin' })))
    return res.status(403).json({ error: 'Publishing needs an active plan that includes the Website Builder' });
   await setPublished(pool, req.restaurant, published);
   await audit(pool, { actorUserId: req.user.id, restaurantId: req.restaurant.id, action: published ? 'site.publish' : 'site.unpublish' });
   res.json({ published, url: '/r/' + req.restaurant.slug });
  } catch { res.status(503).json({ error: 'Website unavailable' }); }
 });
 return router;
}
