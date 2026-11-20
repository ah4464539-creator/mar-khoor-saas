// Custom domains for restaurant websites.
// Flow: owner adds a domain → adds a TXT record that proves ownership + an A/CNAME record that
// points to Mar-Khoor → presses Verify → platform owner attaches the domain in Hostinger (SSL)
// and marks it connected. Requests for a verified domain's home page serve that restaurant's site.
import { randomBytes } from 'node:crypto';
import dns from 'node:dns/promises';

export const DOMAINS_SQL = `CREATE TABLE IF NOT EXISTS restaurant_domains (
 restaurant_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
 domain VARCHAR(253) NOT NULL UNIQUE,
 token CHAR(32) NOT NULL,
 status ENUM('pending','verified','connected') NOT NULL DEFAULT 'pending',
 points_here TINYINT(1) NOT NULL DEFAULT 0,
 last_error VARCHAR(255) NULL,
 checked_at TIMESTAMP NULL DEFAULT NULL,
 verified_at TIMESTAMP NULL DEFAULT NULL,
 connected_at TIMESTAMP NULL DEFAULT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB`;

const ensured = new WeakMap();
export function ensureDomainsTable(pool) {
  if (!ensured.has(pool)) ensured.set(pool, pool.query(DOMAINS_SQL).catch(error => { ensured.delete(pool); throw error; }));
  return ensured.get(pool);
}

export function primaryHosts(env = process.env) {
  const hosts = new Set(['mar-khoor.com', 'www.mar-khoor.com', 'localhost', '127.0.0.1', '::1']);
  try { if (env.PUBLIC_BASE_URL) { const host = new URL(env.PUBLIC_BASE_URL).hostname.toLowerCase(); hosts.add(host); hosts.add(host.replace(/^www\./, '')); hosts.add('www.' + host.replace(/^www\./, '')); } } catch {}
  for (const host of String(env.PRIMARY_HOSTS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean)) hosts.add(host);
  return hosts;
}
const isPlatformHost = (host, hosts) => hosts.has(host) || host.endsWith('.hostingersite.com') || host.endsWith('.mar-khoor.com');

// Accepts "https://www.MyRestaurant.pk/menu" and returns "myrestaurant.pk". null when invalid.
export function normalizeDomain(input, hosts = primaryHosts()) {
  if (typeof input !== 'string') return null;
  let value = input.trim().toLowerCase();
  if (!value || value.length > 300) return null;
  value = value.replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0].replace(/:\d+$/, '').replace(/\.$/, '').replace(/^www\./, '');
  if (value.length > 253 || !/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/.test(value)) return null;
  if (/^\d+(\.\d+){3}$/.test(value) || isPlatformHost(value, hosts) || isPlatformHost('www.' + value, hosts)) return null;
  return value;
}

export const txtName = domain => '_mar-khoor.' + domain;
export const txtValue = token => 'mar-khoor-verify=' + token;

export async function platformAddresses(resolver, env) {
  const host = (() => { try { return new URL(env.PUBLIC_BASE_URL || 'https://mar-khoor.com').hostname; } catch { return 'mar-khoor.com'; } })();
  return resolver.resolve4(host).catch(() => []);
}

export function dnsRecords(row, addresses) {
  return [
    { type: 'TXT', name: txtName(row.domain), value: txtValue(row.token), purpose: 'Proves you own the domain' },
    ...(addresses.length ? [{ type: 'A', name: row.domain, value: addresses[0], purpose: 'Sends visitors to your Mar-Khoor website' }] : []),
    { type: 'CNAME', name: 'www.' + row.domain, value: 'mar-khoor.com', purpose: 'Makes www work too' },
  ];
}

export async function verifyDomain(pool, row, { resolver = dns, env = process.env } = {}) {
  let verified = false, pointsHere = false, error = null;
  try {
    const records = await resolver.resolveTxt(txtName(row.domain));
    verified = records.some(parts => parts.join('') === txtValue(row.token));
    if (!verified) error = 'TXT record found but the value does not match yet';
  } catch (dnsError) {
    error = dnsError?.code === 'ENOTFOUND' || dnsError?.code === 'ENODATA' ? 'TXT record not found yet (DNS changes can take up to a few hours)' : 'DNS lookup failed, try again';
  }
  try {
    const [mine, theirs] = await Promise.all([platformAddresses(resolver, env), resolver.resolve4(row.domain).catch(() => [])]);
    pointsHere = theirs.length > 0 && theirs.every(address => mine.includes(address));
  } catch {}
  const status = row.status === 'connected' && verified ? 'connected' : verified ? 'verified' : 'pending';
  await pool.execute(
    'UPDATE restaurant_domains SET status=?,points_here=?,last_error=?,checked_at=CURRENT_TIMESTAMP,verified_at=IF(?,COALESCE(verified_at,CURRENT_TIMESTAMP),NULL) WHERE restaurant_id=? AND token=?',
    [status, pointsHere ? 1 : 0, verified ? null : error, verified ? 1 : 0, row.restaurant_id, row.token]);
  return { status, points_here: pointsHere, last_error: verified ? null : error };
}

// Host-header routing: serve a verified custom domain's restaurant site at "/".
export function customDomainRouting(pool, { env = process.env, ttlMs = 60000 } = {}) {
  const hosts = primaryHosts(env);
  const cache = new Map();
  async function slugFor(host) {
    const now = Date.now();
    const hit = cache.get(host);
    if (hit && hit.until > now) return hit.slug;
    let slug = null;
    try {
      await ensureDomainsTable(pool);
      const [rows] = await pool.execute("SELECT r.slug FROM restaurant_domains d JOIN restaurants r ON r.id=d.restaurant_id WHERE d.domain=? AND d.status IN ('verified','connected') LIMIT 1", [host]);
      slug = rows[0]?.slug ?? null;
    } catch {}
    if (cache.size > 5000) cache.clear();
    cache.set(host, { slug, until: now + ttlMs });
    return slug;
  }
  return async function customDomain(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const host = String(req.hostname || '').toLowerCase().replace(/^www\./, '');
    if (!host || isPlatformHost(host, hosts) || isPlatformHost('www.' + host, hosts)) return next();
    if (req.path !== '/' && req.path !== '/index.html') return next();
    const slug = await slugFor(host);
    if (!slug || !/^[a-z0-9-]{1,160}$/.test(slug)) return next();
    req.url = '/r/' + slug;
    next();
  };
}

