import express from 'express';
import { randomBytes } from 'node:crypto';
import dns from 'node:dns/promises';
import { requireAuth } from './auth.js';
import { audit, rateLimit } from './security.js';
import { ensureDomainsTable, primaryHosts, normalizeDomain, dnsRecords, verifyDomain, platformAddresses } from './domain-core.js';
import { ensureDomainSetupTables, startDomainSetup, advanceDomainSetup, describeSetup } from './domain-automation.js';
import { yearlyDomainPrice } from './hostinger-client.js';
export { customDomainRouting } from './domain-core.js';

export function domainsRouter(pool, { resolver = dns, env = process.env, client = null } = {}) {
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
  const setupFor = async id => {
    if (!client) return null;
    await ensureDomainSetupTables(pool);
    return (await pool.execute('SELECT * FROM restaurant_domain_setup WHERE restaurant_id=? LIMIT 1', [id]))[0][0] ?? null;
  };
  const view = async row => {
    if (!row) return { domain: null, status: null, records: [], automatic: Boolean(client) };
    const setup = await setupFor(row.restaurant_id);
    if (setup && setup.domain === row.domain) return { domain: row.domain, status: row.status, ...describeSetup(setup) };
    return { domain: row.domain, status: row.status, points_here: Boolean(row.points_here), last_error: row.last_error, checked_at: row.checked_at, automatic: false, records: dnsRecords(row, await platformAddresses(resolver, env)) };
  };
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
      if (client) await startDomainSetup(pool, client, req.restaurantId, domain).catch(error => console.warn(JSON.stringify({ event: 'domain_setup_start_failed', message: String(error?.message).slice(0, 200) })));
      res.json(await view(await load(req.restaurantId)));
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That domain is already connected to another restaurant' });
      res.status(503).json({ error: 'Domain settings unavailable' });
    }
  });
  router.delete('/api/restaurants/:restaurantId/site/domain', requireAuth, restaurantAdmin, async (req, res) => {
    try {
      const current = await load(req.restaurantId);
      await pool.execute('DELETE FROM restaurant_domains WHERE restaurant_id=?', [req.restaurantId]);
      if (client) {
        await ensureDomainSetupTables(pool);
        await pool.execute('DELETE FROM restaurant_domain_setup WHERE restaurant_id=?', [req.restaurantId]);
        // Best effort: stop serving it from our hosting.
        if (current) client.request('DELETE', '/api/hosting/v1/accounts/' + encodeURIComponent(client.config.username) + '/websites/' + encodeURIComponent(client.config.website) + '/parked-domains/' + encodeURIComponent(current.domain)).catch(() => {});
      }
      await audit(pool, { actorUserId: req.user.id, restaurantId: req.restaurantId, action: 'site.domain_removed' });
      res.json({ domain: null, status: null, records: [] });
    } catch { res.status(503).json({ error: 'Domain settings unavailable' }); }
  });
  router.post('/api/restaurants/:restaurantId/site/domain/verify', rateLimit({ windowMs: 10 * 60 * 1000, max: 20, name: 'domain-verify' }), requireAuth, restaurantAdmin, async (req, res) => {
    try {
      const row = await load(req.restaurantId);
      if (!row) return res.status(404).json({ error: 'Add a domain first' });
      const setup = await setupFor(req.restaurantId);
      if (setup && setup.domain === row.domain) await advanceDomainSetup(pool, client, setup, { resolver });
      else await verifyDomain(pool, row, { resolver, env });
      res.json(await view(await load(req.restaurantId)));
    } catch { res.status(503).json({ error: 'Verification is unavailable right now' }); }
  });

  // Find a new domain the platform can register for the restaurant (bought from our Hostinger account).
  const priceCache = new Map();
  const TLDS = ['com', 'net', 'online', 'store', 'shop', 'site', 'co'];
  async function priceFor(tld) {
    const hit = priceCache.get(tld);
    if (hit && hit.until > Date.now()) return hit.value;
    const value = yearlyDomainPrice(await client.catalog('.' + tld.toUpperCase() + '*').catch(() => []), tld);
    priceCache.set(tld, { value, until: Date.now() + 6 * 3600000 });
    return value;
  }
  router.get('/api/restaurants/:restaurantId/site/domain/search', rateLimit({ windowMs: 60 * 1000, max: 20, name: 'domain-search' }), requireAuth, restaurantAdmin, async (req, res) => {
    if (!client) return res.status(503).json({ error: 'Buying a domain is not enabled yet' });
    const name = String(req.query.name || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('.')[0].replace(/[^a-z0-9-]/g, '').slice(0, 63);
    if (name.length < 2) return res.status(400).json({ error: 'Type the name you want, for example lahoregrill' });
    try {
      const results = await client.availability(name, TLDS);
      const options = [];
      for (const item of (Array.isArray(results) ? results : results?.data ?? [])) {
        if (!item?.is_available || item.is_premium) continue;
        const domain = String(item.domain || '').toLowerCase();
        const tld = domain.split('.').slice(1).join('.');
        const price = await priceFor(tld);
        if (price) options.push({ domain, price_cents: price.price_cents, renewal_cents: price.renewal_cents, currency: price.currency });
      }
      res.json({ options });
    } catch { res.status(503).json({ error: 'Domain search is unavailable right now' }); }
  });
  router.post('/api/restaurants/:restaurantId/site/domain/request', requireAuth, restaurantAdmin, async (req, res) => {
    if (!client) return res.status(503).json({ error: 'Buying a domain is not enabled yet' });
    const domain = normalizeDomain(req.body?.domain, hosts);
    if (!domain) return res.status(400).json({ error: 'Choose a domain from the list' });
    try {
      await ensureDomainSetupTables(pool);
      const [open] = await pool.execute("SELECT id FROM restaurant_domain_requests WHERE restaurant_id=? AND status IN ('requested','purchasing') LIMIT 1", [req.restaurantId]);
      if (open.length) return res.status(409).json({ error: 'You already have a domain request waiting' });
      const [available] = [await client.availability(domain.split('.')[0], [domain.split('.').slice(1).join('.')])];
      const hit = (Array.isArray(available) ? available : available?.data ?? []).find(item => String(item.domain).toLowerCase() === domain);
      if (!hit?.is_available || hit.is_premium) return res.status(409).json({ error: 'That domain is no longer available' });
      const price = await priceFor(domain.split('.').slice(1).join('.'));
      if (!price) return res.status(409).json({ error: 'That domain ending cannot be bought here' });
      await pool.execute('INSERT INTO restaurant_domain_requests (restaurant_id,domain,item_id,price_cents,currency) VALUES (?,?,?,?,?)', [req.restaurantId, domain, price.item_id, price.price_cents, price.currency]);
      await audit(pool, { actorUserId: req.user.id, restaurantId: req.restaurantId, action: 'site.domain_requested' });
      res.status(201).json({ requested: domain });
    } catch { res.status(503).json({ error: 'Domain request is unavailable right now' }); }
  });
  router.get('/api/restaurants/:restaurantId/site/domain/requests', requireAuth, restaurantAdmin, async (req, res) => {
    if (!client) return res.json({ requests: [] });
    try { await ensureDomainSetupTables(pool); const [rows] = await pool.execute('SELECT id,domain,price_cents,currency,status,error,created_at FROM restaurant_domain_requests WHERE restaurant_id=? ORDER BY id DESC LIMIT 5', [req.restaurantId]); res.json({ requests: rows }); }
    catch { res.status(503).json({ error: 'Domain requests unavailable' }); }
  });
  router.get('/api/platform/domain-requests', requireAuth, superOnly, async (_req, res) => {
    try { await ensureDomainSetupTables(pool); const [rows] = await pool.execute('SELECT q.id,q.restaurant_id,q.domain,q.price_cents,q.currency,q.status,q.error,q.created_at,r.name FROM restaurant_domain_requests q JOIN restaurants r ON r.id=q.restaurant_id ORDER BY q.id DESC LIMIT 200'); res.json({ requests: rows, enabled: Boolean(client) }); }
    catch { res.status(503).json({ error: 'Domain requests unavailable' }); }
  });
  // Spends real money from the platform's Hostinger account. Super admin only, one click per request.
  router.post('/api/platform/domain-requests/:id/purchase', requireAuth, superOnly, async (req, res) => {
    if (!client) return res.status(503).json({ error: 'HOSTINGER_API_TOKEN is not configured' });
    const id = Number(req.params.id);
    try {
      await ensureDomainSetupTables(pool);
      const [claimed] = await pool.execute("UPDATE restaurant_domain_requests SET status='purchasing',error=NULL WHERE id=? AND status IN ('requested','failed')", [id]);
      if (!claimed.affectedRows) return res.status(409).json({ error: 'This request is not waiting for purchase' });
      const [[request]] = await pool.execute('SELECT * FROM restaurant_domain_requests WHERE id=?', [id]);
      try { await client.purchase(request.domain, request.item_id); }
      catch (error) {
        await pool.execute("UPDATE restaurant_domain_requests SET status='failed',error=? WHERE id=?", [String(error.message).slice(0, 240), id]);
        return res.status(502).json({ error: 'Purchase failed: ' + error.message });
      }
      await pool.execute("UPDATE restaurant_domain_requests SET status='purchased' WHERE id=?", [id]);
      await pool.execute("INSERT INTO restaurant_domains (restaurant_id,domain,token,status) VALUES (?,?,?,'pending') ON DUPLICATE KEY UPDATE domain=VALUES(domain),token=VALUES(token),status='pending',points_here=0,last_error=NULL,verified_at=NULL,connected_at=NULL",
        [request.restaurant_id, request.domain, randomBytes(16).toString('hex')]);
      await startDomainSetup(pool, client, request.restaurant_id, request.domain).catch(() => {});
      await audit(pool, { actorUserId: req.user.id, restaurantId: request.restaurant_id, action: 'site.domain_purchased' });
      res.json({ purchased: request.domain });
    } catch { res.status(503).json({ error: 'Domain purchase unavailable' }); }
  });
  router.put('/api/platform/domain-requests/:id/reject', requireAuth, superOnly, async (req, res) => {
    try { await ensureDomainSetupTables(pool); await pool.execute("UPDATE restaurant_domain_requests SET status='rejected' WHERE id=? AND status IN ('requested','failed')", [Number(req.params.id)]); res.json({ status: 'rejected' }); }
    catch { res.status(503).json({ error: 'Domain requests unavailable' }); }
  });
  router.post('/api/platform/domains/:restaurantId/check', requireAuth, superOnly, async (req, res) => {
    if (!client) return res.status(503).json({ error: 'HOSTINGER_API_TOKEN is not configured' });
    try { const setup = await setupFor(Number(req.params.restaurantId)); if (!setup) return res.status(404).json({ error: 'No automatic setup for this domain' }); const next = await advanceDomainSetup(pool, client, setup, { resolver }); res.json({ stage: next.stage, last_error: next.last_error }); }
    catch { res.status(503).json({ error: 'Check failed' }); }
  });

  router.get('/api/platform/domains', requireAuth, superOnly, async (_req, res) => {
    try {
      await ensureDomainsTable(pool);
      const [rows] = await pool.execute('SELECT d.restaurant_id,d.domain,d.status,d.points_here,d.last_error,d.checked_at,r.name,r.slug FROM restaurant_domains d JOIN restaurants r ON r.id=d.restaurant_id ORDER BY d.created_at DESC LIMIT 500');
      let stages = new Map();
      if (client) { await ensureDomainSetupTables(pool); const [setup] = await pool.execute('SELECT restaurant_id,domain,stage,last_error,ssl_status FROM restaurant_domain_setup'); stages = new Map(setup.map(item => [item.restaurant_id + '|' + item.domain, item])); }
      res.json({ automatic: Boolean(client), domains: rows.map(row => { const setup = stages.get(row.restaurant_id + '|' + row.domain); return { ...row, points_here: Boolean(row.points_here), stage: setup?.stage ?? null, setup_error: setup?.last_error ?? null, ssl_status: setup?.ssl_status ?? null }; }) });
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
