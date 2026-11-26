// Automatic custom-domain connection through the Hostinger API.
// One step per call (safe to run from a timer):
//   ownership → parking (domain added to the mar-khoor.com website, i.e. our hosting)
//   → dns (records written when DNS is in our Hostinger account, otherwise waiting for the owner)
//   → ssl (certificate requested once, then polled) → live
import { registerWorker, workerDisabled, heartbeat } from './observability.js';
import dns from 'node:dns/promises';
import { ensureDomainsTable } from './domain-core.js';

export const DOMAIN_SETUP_SQL = `CREATE TABLE IF NOT EXISTS restaurant_domain_setup (
 restaurant_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
 domain VARCHAR(253) NOT NULL,
 managed TINYINT(1) NOT NULL DEFAULT 0,
 stage ENUM('ownership','parking','dns','ssl','live','error') NOT NULL DEFAULT 'ownership',
 ownership_txt VARCHAR(255) NULL,
 nameservers VARCHAR(255) NULL,
 targets TEXT NULL,
 ssl_status VARCHAR(32) NULL,
 ssl_requested_at TIMESTAMP NULL DEFAULT NULL,
 attempts INT UNSIGNED NOT NULL DEFAULT 0,
 next_check_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 last_error VARCHAR(255) NULL,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 KEY restaurant_domain_setup_due (stage, next_check_at),
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB`;

export const DOMAIN_REQUESTS_SQL = `CREATE TABLE IF NOT EXISTS restaurant_domain_requests (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 restaurant_id BIGINT UNSIGNED NOT NULL,
 domain VARCHAR(253) NOT NULL,
 item_id VARCHAR(100) NULL,
 price_cents INT UNSIGNED NULL,
 currency CHAR(3) NULL,
 status ENUM('requested','purchasing','purchased','failed','rejected') NOT NULL DEFAULT 'requested',
 error VARCHAR(255) NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 KEY restaurant_domain_requests_restaurant (restaurant_id),
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB`;

const ensured = new WeakMap();
export function ensureDomainSetupTables(pool) {
  if (!ensured.has(pool)) ensured.set(pool, (async () => { await ensureDomainsTable(pool); await pool.query(DOMAIN_SETUP_SQL); await pool.query(DOMAIN_REQUESTS_SQL); })().catch(error => { ensured.delete(pool); throw error; }));
  return ensured.get(pool);
}

const MINUTE = 60000;
const DELAYS = { ownership: 5, parking: 2, dns: 10, ssl: 5 };
const list = value => Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : [];
const short = error => String(error?.message || error || 'Unknown error').slice(0, 240);

// Web records (@ and www) from a Hostinger zone, or a fallback to the hosting server IP.
export function webTargets(zone, domain, serverIp) {
  const records = list(zone);
  const pick = (name, types) => records.filter(record => record.name === name && types.includes(record.type))
    .flatMap(record => (record.records ?? []).filter(entry => !entry.is_disabled).map(entry => ({ type: record.type, name: name === '@' ? domain : name + '.' + domain, value: String(entry.content).replace(/\.$/, '') })));
  const apex = pick('@', ['A', 'ALIAS', 'CNAME']);
  const www = pick('www', ['CNAME', 'A', 'ALIAS']);
  const targets = [...apex, ...www];
  if (!apex.length && serverIp) targets.unshift({ type: 'A', name: domain, value: serverIp });
  if (!www.length) targets.push({ type: 'CNAME', name: 'www.' + domain, value: domain });
  return targets;
}

// Records to add to a zone we control (Hostinger DNS) when @ or www is missing. Never overwrites.
export function missingWebRecords(zone, serverIp) {
  const records = list(zone);
  const has = (name, types) => records.some(record => record.name === name && types.includes(record.type));
  const add = [];
  if (!has('@', ['A', 'ALIAS', 'CNAME']) && serverIp) add.push({ name: '@', type: 'A', ttl: 300, records: [{ content: serverIp }] });
  if (!has('www', ['CNAME', 'A', 'ALIAS'])) add.push({ name: 'www', type: 'CNAME', ttl: 300, records: [{ content: '@' }] });
  return add;
}

// Does the public DNS send this domain to our hosting yet?
export async function pointsToHosting(domain, targets, { resolver = dns } = {}) {
  try {
    const ns = await resolver.resolveNs(domain).catch(() => []);
    const apex = targets.filter(target => target.name === domain);
    const actual = new Set(await resolver.resolve4(domain).catch(() => []));
    if (!actual.size) return false;
    for (const target of apex) {
      if (target.type === 'A' && actual.has(target.value)) return true;
      if (target.type !== 'A') {
        const expected = await resolver.resolve4(target.value).catch(() => []);
        if (expected.some(address => actual.has(address))) return true;
      }
    }
    return ns.some(server => /dns-parking\.com\.?$/i.test(server)) && apex.length === 0;
  } catch { return false; }
}

async function save(pool, row, changes) {
  const next = { ...row, ...changes };
  await pool.execute(
    'UPDATE restaurant_domain_setup SET managed=?,stage=?,ownership_txt=?,nameservers=?,targets=?,ssl_status=?,ssl_requested_at=?,attempts=?,next_check_at=?,last_error=? WHERE restaurant_id=? AND domain=?',
    [next.managed ? 1 : 0, next.stage, next.ownership_txt ?? null, next.nameservers ?? null, next.targets ?? null, next.ssl_status ?? null, next.ssl_requested_at ?? null, next.attempts ?? 0,
      next.next_check_at ?? new Date(), next.last_error ?? null, row.restaurant_id, row.domain]);
  return next;
}
const later = minutes => new Date(Date.now() + minutes * MINUTE);

export async function startDomainSetup(pool, client, restaurantId, domain) {
  await ensureDomainSetupTables(pool);
  let managed = false;
  try { managed = Boolean(await client.portfolioDomain(domain)); } catch {}
  await pool.execute(
    "INSERT INTO restaurant_domain_setup (restaurant_id,domain,managed,stage,next_check_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE domain=VALUES(domain),managed=VALUES(managed),stage=VALUES(stage),ownership_txt=NULL,nameservers=NULL,targets=NULL,ssl_status=NULL,ssl_requested_at=NULL,attempts=0,next_check_at=CURRENT_TIMESTAMP,last_error=NULL",
    [restaurantId, domain, managed ? 1 : 0, managed ? 'parking' : 'ownership']);
  const [rows] = await pool.execute('SELECT * FROM restaurant_domain_setup WHERE restaurant_id=?', [restaurantId]);
  return advanceDomainSetup(pool, client, rows[0]);
}

export async function advanceDomainSetup(pool, client, row, { resolver = dns } = {}) {
  const attempts = (row.attempts || 0) + 1;
  try {
    if (row.stage === 'ownership') {
      const result = await client.verifyOwnership(row.domain);
      if (!result?.is_accessible) return save(pool, row, { ownership_txt: result?.txt_to_verify ?? row.ownership_txt, attempts, next_check_at: later(DELAYS.ownership), last_error: null });
      row = await save(pool, row, { stage: 'parking', attempts: 0, last_error: null });
    }
    if (row.stage === 'parking') {
      const parked = list(await client.listParked()).some(item => String(item.domain).toLowerCase() === row.domain);
      if (!parked) await client.park(row.domain);
      const zone = await client.zone(row.domain);
      if (row.managed && zone) {
        const add = missingWebRecords(zone, client.config.serverIp);
        if (add.length) await client.addRecords(row.domain, add);
      }
      const portfolio = row.managed ? await client.portfolioDomain(row.domain).catch(() => null) : null;
      const ns = portfolio?.name_servers ? Object.values(portfolio.name_servers).filter(Boolean).join(',') : null;
      row = await save(pool, row, { stage: 'dns', targets: JSON.stringify(webTargets(row.managed ? await client.zone(row.domain) : zone, row.domain, client.config.serverIp)), nameservers: ns, attempts: 0, last_error: null, next_check_at: new Date() });
    }
    if (row.stage === 'dns') {
      const targets = JSON.parse(row.targets || '[]');
      if (!(await pointsToHosting(row.domain, targets, { resolver }))) {
        return save(pool, row, { attempts, next_check_at: later(Math.min(60, DELAYS.dns * Math.ceil(attempts / 6))), last_error: row.managed ? 'DNS is updating (can take up to a few hours)' : 'Waiting for the DNS records below' });
      }
      await pool.execute("UPDATE restaurant_domains SET status=IF(status='connected','connected','verified'),points_here=1,last_error=NULL,checked_at=CURRENT_TIMESTAMP,verified_at=COALESCE(verified_at,CURRENT_TIMESTAMP) WHERE restaurant_id=? AND domain=?", [row.restaurant_id, row.domain]);
      row = await save(pool, row, { stage: 'ssl', attempts: 0, last_error: null, next_check_at: new Date() });
    }
    if (row.stage === 'ssl') {
      if (!row.ssl_requested_at) {
        await client.sslInstall(row.domain);
        return save(pool, row, { ssl_requested_at: new Date(), ssl_status: 'installing', attempts, next_check_at: later(DELAYS.ssl) });
      }
      const status = await client.sslStatus(row.domain).catch(() => null);
      const state = status?.status || status?.ssl?.status || null;
      if (state === 'active') {
        await pool.execute("UPDATE restaurant_domains SET status='connected',connected_at=CURRENT_TIMESTAMP WHERE restaurant_id=? AND domain=?", [row.restaurant_id, row.domain]);
        return save(pool, row, { stage: 'live', ssl_status: 'active', attempts: 0, last_error: null, next_check_at: later(24 * 60) });
      }
      if (state === 'failed') {
        // Certificate setups are limited per week: retry once a day, never in a loop.
        return save(pool, row, { ssl_status: 'failed', ssl_requested_at: null, attempts, next_check_at: later(24 * 60), last_error: 'SSL setup failed: ' + String(status?.last_error || status?.ssl?.last_error || 'will retry in 24 hours').slice(0, 180) });
      }
      return save(pool, row, { ssl_status: state || 'installing', attempts, next_check_at: later(DELAYS.ssl) });
    }
    return row;
  } catch (error) {
    const hard = error?.status === 401 || error?.status === 403;
    return save(pool, row, { attempts, last_error: short(error), next_check_at: later(hard ? 60 : Math.min(60, 5 * attempts)), ...(attempts > 30 && row.stage === 'parking' ? { stage: 'error' } : {}) });
  }
}

export async function runDueDomainSetups(pool, client, { limit = 5 } = {}) {
  await ensureDomainSetupTables(pool);
  const [rows] = await pool.execute("SELECT * FROM restaurant_domain_setup WHERE stage IN ('ownership','parking','dns','ssl') AND next_check_at<=CURRENT_TIMESTAMP ORDER BY next_check_at LIMIT " + Number(limit));
  for (const row of rows) await advanceDomainSetup(pool, client, row);
  return rows.length;
}

export function startDomainWorker(pool, client, { intervalMs = 3 * MINUTE } = {}) {
  if (!client) { workerDisabled('domains', 'Hostinger API not configured'); return null; }
  registerWorker('domains', { intervalMs });
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runDueDomainSetups(pool, client); heartbeat('domains'); }
    catch (error) { console.warn(JSON.stringify({ event: 'domain_worker_failed', message: short(error) })); heartbeat('domains', { ok: false, error }); }
    finally { running = false; }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  setTimeout(tick, 15000).unref?.();
  return timer;
}

// What the owner sees for each stage.
export function describeSetup(row) {
  if (!row) return null;
  const targets = (() => { try { return JSON.parse(row.targets || '[]'); } catch { return []; } })();
  const steps = [
    { key: 'ownership', label: 'Domain ownership confirmed' },
    { key: 'parking', label: 'Hosting connected (Mar-Khoor)' },
    { key: 'dns', label: 'DNS pointing to Mar-Khoor' },
    { key: 'ssl', label: 'Secure HTTPS certificate' },
    { key: 'live', label: 'Website live on your domain' },
  ];
  const index = steps.findIndex(step => step.key === row.stage);
  const records = [];
  if (row.stage === 'ownership' && row.ownership_txt) records.push({ type: 'TXT', name: row.domain, value: row.ownership_txt, purpose: 'Proves you own the domain (keep your other records)' });
  if (row.stage === 'dns' && !row.managed) records.push(...targets.map(target => ({ ...target, purpose: target.name === row.domain ? 'Sends visitors to your Mar-Khoor website' : 'Makes www work too' })));
  return {
    automatic: true, managed: Boolean(row.managed), stage: row.stage, last_error: row.last_error, ssl_status: row.ssl_status,
    nameservers: row.nameservers ? row.nameservers.split(',') : [],
    steps: steps.map((step, i) => ({ ...step, state: row.stage === 'live' || i < index ? 'done' : i === index ? 'current' : 'todo' })),
    records,
  };
}
