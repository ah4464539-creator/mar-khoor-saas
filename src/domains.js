import express from 'express';
import { randomBytes } from 'node:crypto';
import dns from 'node:dns/promises';
import { requireAuth } from './auth.js';
import { audit, rateLimit } from './security.js';
import { ensureDomainsTable, primaryHosts, normalizeDomain, dnsRecords, verifyDomain, platformAddresses } from './domain-core.js';
export { customDomainRouting } from './domain-core.js';

export function domainsRouter(pool, { resolver = dns, env = process.env } = {}) {
  const router = express.Router();
  const hosts = primaryHosts(env);
  const restaurantAdmin = async (req, res, next) => {
    const id = Number(req.params.restaurantId);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid restaurant' });
    try {
      if (req.user.platformRole !== 'super_admin') {
        const [rows] = await pool.execute("SELECT role FROM restaurant_members WHERE restaurant_id=? AND user_id=? AND role='admin' LIMIT 1", [id, req.user.id]);
        if (!rows.length) return res.status(403).json({ error: 'Forbidden' });
      }
      req.restaurantId = id;
      await ensureDomainsTable(pool);
      next();
    } catch { res.status(503).json({ error: 'Database unavailable' }); }
  };
  const superOnly = (req, res, next) => req.user.platformRole === 'super_admin' ? next() : res.status(403).json({ error: 'Forbidden' });
  const view = async row => row ? ({
    domain: row.domain, status: row.status, points_here: Boolean(row.points_here), last_error: row.last_error,
    checked_at: row.checked_at, records: dnsRecords(row, await platformAddresses(resolver, env)),
  }) : { domain: null, status: null, records: [] };
  const load = async id => (await pool.execute('SELECT * FROM restaurant_domains WHERE restaurant_id=? LIMIT 1', [id]))[0][0] ?? null;

  router.get('/api/restaurants/:restaurantId/site/domain', requireAuth, restaurantAdmin, async (req, res) => {
    try { res.json(await view(await load(req.restaurantId))); } catch { res.status(503).json({ error: 'Domain settings unavailable' }); }
  });
  router.put('/api/restaurants/:restaurantId/site/domain', requireAuth, restaurantAdmin, async (req, res) => {
    const domain = normalizeDomain(req.body?.domain, hosts);
    if (!domain) return res.status(400).json({ error: 'Enter a domain you own, for example myrestaurant.com' });
    try {
      const current = await load(req.restaurantId);
      if (current?.domain === domain) return res.json(await view(current));
      const token = randomBytes(16).toString('hex');
      await pool.execute(
        "INSERT INTO restaurant_domains (restaurant_id,domain,token,status) VALUES (?,?,?,'pending') ON DUPLICATE KEY UPDATE domain=VALUES(domain),token=VALUES(token),status='pending',points_here=0,last_error=NULL,checked_at=NULL,verified_at=NULL,connected_at=NULL",
        [req.restaurantId, domain, token]);
      await audit(pool, { actorUserId: req.user.id, restaurantId: req.restaurantId, action: 'site.domain_set' });
      res.json(await view(await load(req.restaurantId)));
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That domain is already connected to another restaurant' });
      res.status(503).json({ error: 'Domain settings unavailable' });
    }
  });
  router.delete('/api/restaurants/:restaurantId/site/domain', requireAuth, restaurantAdmin, async (req, res) => {
    try {
      await pool.execute('DELETE FROM restaurant_domains WHERE restaurant_id=?', [req.restaurantId]);
      await audit(pool, { actorUserId: req.user.id, restaurantId: req.restaurantId, action: 'site.domain_removed' });
      res.json({ domain: null, status: null, records: [] });
    } catch { res.status(503).json({ error: 'Domain settings unavailable' }); }
  });
  router.post('/api/restaurants/:restaurantId/site/domain/verify', rateLimit({ windowMs: 10 * 60 * 1000, max: 20, name: 'domain-verify' }), requireAuth, restaurantAdmin, async (req, res) => {
    try {
      const row = await load(req.restaurantId);
      if (!row) return res.status(404).json({ error: 'Add a domain first' });
      await verifyDomain(pool, row, { resolver, env });
      res.json(await view(await load(req.restaurantId)));
    } catch { res.status(503).json({ error: 'Verification is unavailable right now' }); }
  });

  router.get('/api/platform/domains', requireAuth, superOnly, async (_req, res) => {
    try {
      await ensureDomainsTable(pool);
      const [rows] = await pool.execute('SELECT d.restaurant_id,d.domain,d.status,d.points_here,d.last_error,d.checked_at,r.name,r.slug FROM restaurant_domains d JOIN restaurants r ON r.id=d.restaurant_id ORDER BY d.created_at DESC LIMIT 500');
      res.json({ domains: rows.map(row => ({ ...row, points_here: Boolean(row.points_here) })) });
    } catch { res.status(503).json({ error: 'Domains unavailable' }); }
  });
  router.put('/api/platform/domains/:restaurantId/status', requireAuth, superOnly, async (req, res) => {
    const id = Number(req.params.restaurantId);
    const status = req.body?.status;
    if (!Number.isSafeInteger(id) || !['verified', 'connected'].includes(status)) return res.status(400).json({ error: 'Invalid request' });
    try {
      await ensureDomainsTable(pool);
      const [result] = await pool.execute("UPDATE restaurant_domains SET status=?,connected_at=IF(?='connected',CURRENT_TIMESTAMP,NULL) WHERE restaurant_id=? AND status IN ('verified','connected')", [status, status, id]);
      if (!result.affectedRows) return res.status(409).json({ error: 'Only a verified domain can be marked connected' });
      await audit(pool, { actorUserId: req.user.id, restaurantId: id, action: 'site.domain_' + status });
      res.json({ status });
    } catch { res.status(503).json({ error: 'Domains unavailable' }); }
  });
  return router;
}
