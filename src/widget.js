// Routes for the website widget (Mar-Khoor tools on an owner's existing website).
import express from 'express';
import { requireAuth } from './auth.js';
import { audit, rateLimit } from './security.js';
import { loadAssistantSite } from './site-store.js';
import { ensureWidgetTable, parseWidgetConfig, sanitizeWidgetConfig, connectedNumbers, publicWidget, embedSnippet, assistantAllowed, DEFAULT_WIDGET } from './widget-core.js';

export function widgetRouter(pool, { baseUrl = process.env.PUBLIC_BASE_URL || 'https://mar-khoor.com' } = {}) {
  baseUrl = String(baseUrl).replace(/\/+$/, '');
  const router = express.Router();
  const restaurantAdmin = async (req, res, next) => {
    const id = Number(req.params.restaurantId);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid restaurant' });
    try {
      if (req.user.platformRole !== 'super_admin') {
        const [rows] = await pool.execute("SELECT role FROM restaurant_members WHERE restaurant_id=? AND user_id=? AND role='admin' LIMIT 1", [id, req.user.id]);
        if (!rows.length) return res.status(403).json({ error: 'Forbidden' });
      }
      const [restaurants] = await pool.execute('SELECT id,slug,website_assistant_provisioned FROM restaurants WHERE id=? LIMIT 1', [id]);
      if (!restaurants.length) return res.status(404).json({ error: 'Restaurant not found' });
      req.restaurant = { id, slug: restaurants[0].slug, websiteAssistantProvisioned: Number(restaurants[0].website_assistant_provisioned) === 1 };
      await ensureWidgetTable(pool);
      next();
    } catch { res.status(503).json({ error: 'Database unavailable' }); }
  };
  const load = async id => {
    const [rows] = await pool.execute('SELECT config FROM restaurant_widget WHERE restaurant_id=? LIMIT 1', [id]);
    return rows.length ? parseWidgetConfig(rows[0].config) : sanitizeWidgetConfig(DEFAULT_WIDGET);
  };
  const view = async restaurant => {
    const config = await load(restaurant.id);
    const numbers = await connectedNumbers(pool, restaurant.id);
    const [menu] = await pool.execute('SELECT COUNT(*) AS n FROM menu_items WHERE restaurant_id=? AND active=1', [restaurant.id]);
    return {
      config, connected_numbers: numbers,
      assistant_available: assistantAllowed(restaurant),
      menu_items: Number(menu[0]?.n ?? 0),
      snippet: embedSnippet(baseUrl, restaurant.slug),
      preview_url: baseUrl + '/embed/' + restaurant.slug + '/chat',
    };
  };

  router.get('/api/restaurants/:restaurantId/widget', requireAuth, restaurantAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store, private');
    try { res.json(await view(req.restaurant)); } catch { res.status(503).json({ error: 'Widget settings unavailable' }); }
  });

  router.put('/api/restaurants/:restaurantId/widget', requireAuth, restaurantAdmin, async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    for (const key of ['whatsapp_number', 'call_number']) {
      if (typeof body[key] === 'string' && body[key].trim() && !sanitizeWidgetConfig({ [key]: body[key] })[key])
        return res.status(400).json({ error: 'Enter the ' + (key === 'call_number' ? 'call' : 'WhatsApp') + ' number with country code, for example +923001234567' });
    }
    const config = sanitizeWidgetConfig(body);
    try {
      await pool.execute('INSERT INTO restaurant_widget(restaurant_id,config) VALUES (?,?) ON DUPLICATE KEY UPDATE config=VALUES(config)', [req.restaurant.id, JSON.stringify(config)]);
      audit(pool, { actorUserId: req.user.id, restaurantId: req.restaurant.id, action: 'widget.update' + (config.enabled ? '.on' : '.off') });
      res.json(await view(req.restaurant));
    } catch { res.status(503).json({ error: 'Widget settings unavailable' }); }
  });

  // Public, read by embed.js on any website. Contains only what the buttons show.
  router.get('/embed/:slug/config.json', rateLimit({ windowMs: 60000, max: 120, name: 'widget-config' }), async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    res.set('Cache-Control', 'public, max-age=60');
    const slug = req.params.slug;
    if (!/^[a-z0-9-]{1,160}$/.test(slug)) return res.status(404).json({ enabled: false });
    try {
      await ensureWidgetTable(pool);
      const [rows] = await pool.execute('SELECT r.id,r.slug,r.website_assistant_provisioned,w.config FROM restaurants r JOIN restaurant_widget w ON w.restaurant_id=r.id WHERE r.slug=? LIMIT 1', [slug]);
      if (!rows.length) return res.status(404).json({ enabled: false });
      const config = parseWidgetConfig(rows[0].config);
      if (!config.enabled) return res.json({ enabled: false });
      const restaurant = { id: rows[0].id, slug: rows[0].slug, websiteAssistantProvisioned: Number(rows[0].website_assistant_provisioned) === 1 };
      const site = config.assistant ? await loadAssistantSite(pool, slug) : null;
      res.json(publicWidget(config, await connectedNumbers(pool, restaurant.id), { assistantAvailable: Boolean(site) && assistantAllowed(restaurant) }));
    } catch { res.status(503).json({ enabled: false }); }
  });

  return router;
}

