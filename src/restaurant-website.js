import { readFileSync } from 'node:fs';
import { audit, rateLimit } from './security.js';

const template = readFileSync(new URL('../public/menu.html', import.meta.url), 'utf8');
const themes = ['classic', 'midnight'];
const slugPattern = /^[a-z0-9-]{1,160}$/;
const textLimits = { headline: 120, description: 500 };

export function websiteSettings(input) {
  if (!input || Object.keys(input).length !== 3 || !themes.includes(input.theme)) return null;
  const settings = { theme: input.theme };
  for (const [key, limit] of Object.entries(textLimits)) {
    const value = input[key];
    if (typeof value !== 'string' || value.length > limit || /[<>]/.test(value)) return null;
    settings[key] = value.trim();
  }
  return settings.headline ? settings : null;
}

const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => entities[character]);

export function renderWebsite(restaurant, settings) {
  const replacements = new Map([
    ['<html lang="en">', '<html lang="' + escapeHtml(restaurant.locale) + '" dir="auto">'],
    ['Customer Menu | MAR-KHOOR AI', escapeHtml(restaurant.name) + ' | MAR-KHOOR AI'],
    ['class="storefront"', 'class="storefront site-' + settings.theme + '"'],
    ['<h1 id="store-name">Discover the menu</h1>', '<h1>' + escapeHtml(settings.headline) + '</h1><p id="store-name" hidden></p>'],
    ['Browse currently available items from a restaurant.', escapeHtml(settings.description)],
    ['<form id="lookup" class="lookup">', '<form id="lookup" class="lookup" hidden data-restaurant="' + escapeHtml(restaurant.slug) + '">'],
  ]);
  const markers = [...replacements.keys()].map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return template.replace(new RegExp(markers.join('|'), 'g'), marker => replacements.get(marker));
}

async function suggestWebsite(restaurant, brief) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      model: process.env.WEBSITE_AI_MODEL || 'gpt-4o-mini',
      max_completion_tokens: 450,
      messages: [
        { role: 'system', content: 'Suggest plain-text storefront settings in the restaurant locale. Headline limit 120 characters and description limit 500. Use only the supplied restaurant facts. Do not invent menu items, prices, hours, awards or services. Do not include markup, code, or links.' },
        { role: 'user', content: JSON.stringify({ name: restaurant.name, locale: restaurant.locale, brief }) },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'restaurant_website_settings', strict: true,
          schema: {
            type: 'object', additionalProperties: false, required: ['headline', 'description', 'theme'],
            properties: { headline: { type: 'string' }, description: { type: 'string' }, theme: { type: 'string', enum: themes } },
          },
        },
      },
    }),
  });
  if (!response.ok) throw new Error('Website AI unavailable');
  const data = await response.json();
  const settings = websiteSettings(JSON.parse(data.choices?.[0]?.message?.content));
  if (!settings) throw new Error('Invalid AI settings');
  return settings;
}

export function addWebsiteSettingsRoutes(router, pool) {
  const route = '/restaurants/:restaurantId/website';
  const getRestaurant = async id => {
    const [rows] = await pool.execute('SELECT name, slug, locale FROM restaurants WHERE id=?', [id]);
    return rows[0];
  };
  const aiAvailable = () => Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'replace_with_api_key');

  router.get(route, async (req, res, next) => {
    try {
      const restaurant = await getRestaurant(req.restaurantId);
      if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });
      const [rows] = await pool.execute('SELECT headline, description, theme FROM restaurant_websites WHERE restaurant_id=?', [req.restaurantId]);
      res.set('Cache-Control', 'no-store').json({
        settings: rows[0] || { headline: restaurant.name, description: '', theme: 'classic' },
        url: '/r/' + encodeURIComponent(restaurant.slug),
        published: Boolean(rows[0]),
        ai_available: aiAvailable(),
      });
    } catch (error) { next(error); }
  });

  router.post(route + '/suggest', rateLimit({ windowMs: 600000, max: 10, name: 'website_ai' }), async (req, res, next) => {
    if (!aiAvailable()) return res.status(503).json({ error: 'Website AI is not configured' });
    const brief = req.body?.brief;
    if (typeof brief !== 'string' || brief.length > 1500) return res.status(400).json({ error: 'Invalid website brief' });
    try {
      const restaurant = await getRestaurant(req.restaurantId);
      if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });
      try {
        res.json({ settings: await suggestWebsite(restaurant, brief.trim()) });
      } catch {
        console.warn(JSON.stringify({ event: 'website_ai_failed' }));
        res.status(502).json({ error: 'Website AI could not generate settings. Try again or edit the settings directly.' });
      }
    } catch (error) { next(error); }
  });

  router.put(route, async (req, res, next) => {
    const settings = websiteSettings(req.body);
    if (!settings) return res.status(400).json({ error: 'Invalid website settings. Enter a headline and plain text.' });
    try {
      const restaurant = await getRestaurant(req.restaurantId);
      if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });
      await pool.execute(
        'INSERT INTO restaurant_websites (restaurant_id,headline,description,theme) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE headline=VALUES(headline),description=VALUES(description),theme=VALUES(theme)',
        [req.restaurantId, settings.headline, settings.description, settings.theme],
      );
      await audit(pool, { actorUserId: req.user.id, restaurantId: req.restaurantId, action: 'website.publish' });
      res.json({ settings, url: '/r/' + encodeURIComponent(restaurant.slug), published: true });
    } catch (error) { next(error); }
  });
}

export function addPublicWebsiteRoute(app, pool) {
  app.get('/r/:slug', rateLimit({ windowMs: 60000, max: 120, name: 'restaurant_website' }), async (req, res, next) => {
    if (!slugPattern.test(req.params.slug)) return res.sendStatus(404);
    try {
      const [rows] = await pool.execute(
        'SELECT r.name,r.slug,r.locale,w.headline,w.description,w.theme FROM restaurants r JOIN restaurant_websites w ON w.restaurant_id=r.id WHERE r.slug=? LIMIT 1',
        [req.params.slug],
      );
      if (!rows.length) return res.sendStatus(404);
      const restaurant = rows[0];
      const settings = websiteSettings({ headline: restaurant.headline, description: restaurant.description, theme: restaurant.theme });
      if (!settings) return res.sendStatus(503);
      res.set('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
      res.set('Cache-Control', 'no-store').send(renderWebsite(restaurant, settings));
    } catch (error) { next(error); }
  });
}
