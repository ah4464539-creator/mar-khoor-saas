// Database access for restaurant websites (no express, testable with a mock pool).
import { defaultSiteConfig, sanitizeSiteConfig } from './site-builder.js';

const parse = (text, restaurant) => { try { return sanitizeSiteConfig(JSON.parse(text), restaurant); } catch { return defaultSiteConfig(restaurant); } };

export async function loadRestaurant(pool, restaurantId) {
  const [rows] = await pool.execute('SELECT id,name,slug,country_code,currency,locale FROM restaurants WHERE id=? LIMIT 1', [restaurantId]);
  return rows[0] ?? null;
}

export async function loadSite(pool, restaurant) {
  const [rows] = await pool.execute('SELECT config,description,published FROM restaurant_sites WHERE restaurant_id=? LIMIT 1', [restaurant.id]);
  if (!rows.length) return { config: defaultSiteConfig(restaurant), description: '', published: false };
  return { config: parse(rows[0].config, restaurant), description: rows[0].description ?? '', published: Boolean(rows[0].published) };
}

// Saving never changes the published flag, so editing a live site cannot accidentally unpublish or publish it.
export async function saveSite(pool, restaurant, { config, description }) {
  const clean = sanitizeSiteConfig(config, restaurant);
  const text = typeof description === 'string' ? description.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim().slice(0, 500) : '';
  await pool.execute(
    'INSERT INTO restaurant_sites(restaurant_id,config,description) VALUES (?,?,?) ON DUPLICATE KEY UPDATE config=VALUES(config),description=VALUES(description)',
    [restaurant.id, JSON.stringify(clean), text]
  );
  return { config: clean, description: text };
}

// Publishing needs an active plan order that includes the website service, unless the platform
// owner is acting or SITE_PUBLISH_FREE=1 is set (for pilots). Unpublishing is always allowed.
export async function canPublish(pool, restaurantId, { superAdmin = false, free = process.env.SITE_PUBLISH_FREE === '1' } = {}) {
  if (superAdmin || free) return true;
  const [rows] = await pool.execute("SELECT id FROM plan_orders WHERE restaurant_id=? AND status='active' AND FIND_IN_SET('website',features) LIMIT 1", [restaurantId]);
  return rows.length > 0;
}

export async function setPublished(pool, restaurant, published) {
  await pool.execute(
    'INSERT INTO restaurant_sites(restaurant_id,config,published) VALUES (?,?,?) ON DUPLICATE KEY UPDATE published=VALUES(published)',
    [restaurant.id, JSON.stringify(defaultSiteConfig(restaurant)), published ? 1 : 0]
  );
}

// Public page data: only a published site of an existing restaurant, only active menu items.
export async function loadPublicSite(pool, slug) {
  if (typeof slug !== 'string' || !/^[a-z0-9-]{1,160}$/.test(slug)) return null;
  const [rows] = await pool.execute(
    'SELECT r.id,r.name,r.slug,r.country_code,r.currency,r.locale,r.website_assistant_provisioned,s.config FROM restaurants r JOIN restaurant_sites s ON s.restaurant_id=r.id AND s.published=1 WHERE r.slug=? LIMIT 1', [slug]);
  if (!rows.length) return null;
  const restaurant = { id: rows[0].id, name: rows[0].name, slug: rows[0].slug, country_code: rows[0].country_code, currency: rows[0].currency, locale: rows[0].locale, websiteAssistantProvisioned: Number(rows[0].website_assistant_provisioned) === 1 };
  const [items] = await pool.execute('SELECT id,name,description,price_minor,category,image_url FROM menu_items WHERE restaurant_id=? AND active=1 ORDER BY id LIMIT 100', [restaurant.id]);
  return { restaurant, config: parse(rows[0].config, restaurant), items };
}

// Restaurants that run the AI Assistant on their own website through the embed widget,
// without publishing a Mar-Khoor website. Returns null unless the widget and its assistant are on.
export async function loadWidgetSite(pool, slug) {
  if (typeof slug !== 'string' || !/^[a-z0-9-]{1,160}$/.test(slug)) return null;
  let rows;
  try {
    [rows] = await pool.execute(
      'SELECT r.id,r.name,r.slug,r.country_code,r.currency,r.locale,r.website_assistant_provisioned,s.config,w.config AS widget FROM restaurants r JOIN restaurant_widget w ON w.restaurant_id=r.id LEFT JOIN restaurant_sites s ON s.restaurant_id=r.id WHERE r.slug=? LIMIT 1', [slug]);
  } catch { return null; }
  if (!rows.length) return null;
  let widget;
  try { widget = JSON.parse(rows[0].widget); } catch { return null; }
  if (widget?.enabled !== true || widget?.assistant === false) return null;
  const restaurant = { id: rows[0].id, name: rows[0].name, slug: rows[0].slug, country_code: rows[0].country_code, currency: rows[0].currency, locale: rows[0].locale, websiteAssistantProvisioned: Number(rows[0].website_assistant_provisioned) === 1 };
  const [items] = await pool.execute('SELECT id,name,description,price_minor,category,image_url FROM menu_items WHERE restaurant_id=? AND active=1 ORDER BY id LIMIT 100', [restaurant.id]);
  return { restaurant, config: rows[0].config ? parse(rows[0].config, restaurant) : defaultSiteConfig(restaurant), items };
}

/** Site used by the AI Assistant endpoints: the published website, or else the embed widget. */
export async function loadAssistantSite(pool, slug) {
  return (await loadPublicSite(pool, slug)) ?? (await loadWidgetSite(pool, slug));
}
