// Cookie-free website analytics: daily counters per restaurant, no personal data stored.
// Counts are best-effort (fire-and-forget) and never slow down or break a page.

export const SITE_DAILY_SQL = `CREATE TABLE IF NOT EXISTS restaurant_site_daily (
 restaurant_id BIGINT UNSIGNED NOT NULL,
 day DATE NOT NULL,
 page_views INT UNSIGNED NOT NULL DEFAULT 0,
 menu_views INT UNSIGNED NOT NULL DEFAULT 0,
 PRIMARY KEY (restaurant_id, day),
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB`;

const ensured = new WeakMap();
export function ensureSiteAnalyticsTable(pool) {
  if (!ensured.has(pool)) ensured.set(pool, pool.query(SITE_DAILY_SQL).catch(error => { ensured.delete(pool); throw error; }));
  return ensured.get(pool);
}

const BOTS = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|curl|wget|python|headless|lighthouse|monitor|uptime|axios|node-fetch/i;
export const isLikelyBot = userAgent => !userAgent || BOTS.test(userAgent);

const FIELDS = new Set(['page_views', 'menu_views']);

export async function recordSiteEvent(pool, restaurantId, field, req) {
  if (!FIELDS.has(field) || !Number.isSafeInteger(Number(restaurantId))) return false;
  if (req && (req.method !== 'GET' || isLikelyBot(req.get?.('user-agent')) || req.get?.('purpose') === 'prefetch')) return false;
  await ensureSiteAnalyticsTable(pool);
  await pool.execute(
    `INSERT INTO restaurant_site_daily (restaurant_id, day, ${field}) VALUES (?, CURRENT_DATE, 1) ON DUPLICATE KEY UPDATE ${field}=${field}+1`,
    [Number(restaurantId)]);
  return true;
}

// Never let analytics affect the response.
export function trackSiteEvent(pool, restaurantId, field, req) {
  recordSiteEvent(pool, restaurantId, field, req).catch(error => console.warn(JSON.stringify({ event: 'site_analytics_failed', code: error?.code })));
}

const isoDay = value => (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10);

export async function loadSiteAnalytics(pool, restaurantId, days = 30, now = new Date()) {
  await ensureSiteAnalyticsTable(pool);
  const [rows] = await pool.execute(
    'SELECT day,page_views,menu_views FROM restaurant_site_daily WHERE restaurant_id=? AND day>=CURRENT_DATE - INTERVAL 29 DAY ORDER BY day', [restaurantId]);
  const [orders] = await pool.execute(
    'SELECT DATE(created_at) AS day,COUNT(*) AS orders FROM orders WHERE restaurant_id=? AND created_at>=CURRENT_DATE - INTERVAL 29 DAY GROUP BY DATE(created_at)', [restaurantId]);
  const byDay = new Map(rows.map(row => [isoDay(row.day), row]));
  const ordersByDay = new Map(orders.map(row => [isoDay(row.day), Number(row.orders) || 0]));
  const series = [];
  for (let offset = days - 1; offset >= 0; offset--) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset)).toISOString().slice(0, 10);
    const row = byDay.get(date);
    series.push({ day: date, page_views: Number(row?.page_views) || 0, menu_views: Number(row?.menu_views) || 0, orders: ordersByDay.get(date) || 0 });
  }
  const totals = series.reduce((sum, day) => ({ page_views: sum.page_views + day.page_views, menu_views: sum.menu_views + day.menu_views, orders: sum.orders + day.orders }), { page_views: 0, menu_views: 0, orders: 0 });
  return { days: series, totals, menu_open_rate: totals.page_views ? Math.round(totals.menu_views / totals.page_views * 100) : null };
}
