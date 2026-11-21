import express from 'express';
import { requireAuth } from './auth.js';

// Read-only, tenant-aggregated operational analytics for the V2 platform UI.
// Mounted only under /api/platform/v2; legacy dashboard endpoints are untouched.
export function platformDashboardV2Router(pool) {
  const router = express.Router();
  router.use(requireAuth, (req, res, next) => {
    if (req.user?.platformRole !== 'super_admin') return res.status(403).json({ error: 'Forbidden' });
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.get('/overview', async (req, res) => {
    const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
    const dateWindow = 'DATE_SUB(CURRENT_DATE(), INTERVAL ' + (days - 1) + ' DAY)';
    try {
      const [
        restaurants, users, ordersTotal, subscriptions, sites, assistants, pending,
        ordersSeries, restaurantsSeries, callsSeries, whatsappSeries, siteViews,
        recentOrders, recentRestaurants, revenue, orderStatuses
      ] = await Promise.all([
        pool.query('SELECT COUNT(*) AS n FROM restaurants'),
        pool.query('SELECT COUNT(*) AS n FROM users'),
        pool.query('SELECT COUNT(*) AS n FROM orders'),
        pool.query("SELECT COUNT(*) AS n FROM restaurant_subscriptions WHERE status='active'"),
        pool.query('SELECT COUNT(*) AS n FROM restaurant_sites WHERE published=1'),
        pool.query('SELECT COUNT(*) AS n FROM voice_assistants WHERE active=1'),
        pool.query("SELECT COUNT(*) AS n FROM orders WHERE status IN ('pending','accepted','preparing','ready')"),
        pool.query("SELECT DATE_FORMAT(created_at,'%Y-%m-%d') AS day,COUNT(*) AS n FROM orders WHERE created_at >= " + dateWindow + ' GROUP BY DATE(created_at) ORDER BY day'),
        pool.query("SELECT DATE_FORMAT(created_at,'%Y-%m-%d') AS day,COUNT(*) AS n FROM restaurants WHERE created_at >= " + dateWindow + ' GROUP BY DATE(created_at) ORDER BY day'),
        pool.query("SELECT DATE_FORMAT(started_at,'%Y-%m-%d') AS day,COUNT(*) AS n FROM voice_calls WHERE started_at >= " + dateWindow + ' GROUP BY DATE(started_at) ORDER BY day'),
        pool.query("SELECT DATE_FORMAT(received_at,'%Y-%m-%d') AS day,COUNT(*) AS n FROM whatsapp_inbound_messages WHERE received_at >= " + dateWindow + ' GROUP BY DATE(received_at) ORDER BY day'),
        pool.query("SELECT COALESCE(SUM(page_views),0) AS page_views,COALESCE(SUM(menu_views),0) AS menu_views FROM restaurant_site_daily WHERE day >= " + dateWindow),
        pool.query("SELECT o.id,o.status,o.total_minor,o.created_at,r.name AS restaurant_name,r.currency FROM orders o JOIN restaurants r ON r.id=o.restaurant_id ORDER BY o.created_at DESC,o.id DESC LIMIT 12"),
        pool.query("SELECT id,name,slug,country_code,currency,created_at FROM restaurants ORDER BY created_at DESC,id DESC LIMIT 12"),
        pool.query("SELECT r.currency,COALESCE(SUM(o.total_minor),0) AS total_minor,COUNT(*) AS order_count FROM orders o JOIN restaurants r ON r.id=o.restaurant_id WHERE o.status='completed' AND o.created_at >= " + dateWindow + ' GROUP BY r.currency ORDER BY total_minor DESC LIMIT 12'),
        pool.query('SELECT status,COUNT(*) AS n FROM orders GROUP BY status')
      ]);
      const number = value => Number(value) || 0;
      const normalize = rows => rows[0].map(row => ({ day: row.day, count: number(row.n) }));
      const seriesMap = new Map();
      for (const [name, result] of [
        ['orders', ordersSeries], ['registrations', restaurantsSeries],
        ['calls', callsSeries], ['messages', whatsappSeries]
      ]) {
        for (const row of normalize(result)) {
          const day = seriesMap.get(row.day) || { day: row.day, orders: 0, registrations: 0, calls: 0, messages: 0 };
          day[name] = row.count;
          seriesMap.set(row.day, day);
        }
      }
      const series = [...seriesMap.values()].sort((a, b) => a.day.localeCompare(b.day));
      res.json({
        period_days: days,
        updated_at: new Date().toISOString(),
        refresh_seconds: 15,
        kpis: {
          restaurants: number(restaurants[0][0]?.n),
          users: number(users[0][0]?.n),
          orders: number(ordersTotal[0][0]?.n),
          active_subscriptions: number(subscriptions[0][0]?.n),
          published_sites: number(sites[0][0]?.n),
          active_assistants: number(assistants[0][0]?.n),
          open_orders: number(pending[0][0]?.n),
          page_views: number(siteViews[0][0]?.page_views),
          menu_views: number(siteViews[0][0]?.menu_views)
        },
        period_totals: {
          orders: number(ordersSeries[0].reduce((s, x) => s + number(x.n), 0)),
          registrations: number(restaurantsSeries[0].reduce((s, x) => s + number(x.n), 0)),
          calls: number(callsSeries[0].reduce((s, x) => s + number(x.n), 0)),
          messages: number(whatsappSeries[0].reduce((s, x) => s + number(x.n), 0))
        },
        series,
        order_statuses: orderStatuses[0].map(r => ({ status: r.status, count: number(r.n) })),
        revenue_by_currency: revenue[0].map(r => ({
          currency: r.currency, total_minor: Number(r.total_minor) || 0, orders: number(r.order_count)
        })),
        recent_orders: recentOrders[0].map(r => ({
          id: r.id, restaurant_name: r.restaurant_name, status: r.status,
          total_minor: Number(r.total_minor) || 0, currency: r.currency, created_at: r.created_at
        })),
        recent_restaurants: recentRestaurants[0]
      });
    } catch (error) {
      console.warn('Platform dashboard V2 overview failed:', error?.code || 'UNKNOWN');
      res.status(503).json({ error: 'Platform dashboard data unavailable' });
    }
  });
  return router;
}
