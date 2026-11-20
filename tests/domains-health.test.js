import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeDomain, verifyDomain, customDomainRouting, dnsRecords, txtValue } from '../src/domain-core.js';
import { configStatus, summarize } from '../src/integration-health-core.js';

test('domains are normalised and platform or invalid hosts are refused', () => {
  assert.equal(normalizeDomain('https://www.MyRestaurant.pk/menu?x=1'), 'myrestaurant.pk');
  assert.equal(normalizeDomain('order.cafe-lahore.com.'), 'order.cafe-lahore.com');
  for (const bad of ['', 'localhost', 'mar-khoor.com', 'www.mar-khoor.com', 'shop.mar-khoor.com', 'site.hostingersite.com', '10.0.0.1', 'no_dots', '-bad-.com', 'a'.repeat(260) + '.com', '<script>.com', null])
    assert.equal(normalizeDomain(bad), null, String(bad));
});

test('DNS verification needs the exact TXT token; status only advances when it matches', async () => {
  const updates = [];
  const pool = { execute: async (sql, params) => { updates.push(params); return [{ affectedRows: 1 }]; } };
  const row = { restaurant_id: 7, domain: 'myrestaurant.pk', token: 'a'.repeat(32), status: 'pending' };
  const resolver = (txt, a) => ({ resolveTxt: async () => txt, resolve4: async host => host === 'myrestaurant.pk' ? a : ['1.2.3.4'] });
  let result = await verifyDomain(pool, row, { resolver: resolver([['mar-khoor-verify=wrong']], ['1.2.3.4']), env: {} });
  assert.equal(result.status, 'pending');
  assert.match(result.last_error, /does not match/);
  result = await verifyDomain(pool, row, { resolver: resolver([[txtValue(row.token)]], ['1.2.3.4']), env: {} });
  assert.deepEqual(result, { status: 'verified', points_here: true, last_error: null });
  result = await verifyDomain(pool, { ...row, status: 'connected' }, { resolver: resolver([[txtValue(row.token)]], ['9.9.9.9']), env: {} });
  assert.equal(result.status, 'connected');
  assert.equal(result.points_here, false);
  assert.equal(updates.at(-1).at(-1), row.token, 'update is bound to the token, so a changed domain is not marked verified');
  const records = dnsRecords(row, ['1.2.3.4']);
  assert.deepEqual(records.map(record => [record.type, record.name]), [['TXT', '_mar-khoor.myrestaurant.pk'], ['A', 'myrestaurant.pk'], ['CNAME', 'www.myrestaurant.pk']]);
});

test('a verified custom domain shows that restaurant site at "/" only; platform hosts are untouched', async () => {
  const pool = { query: async () => [[]], execute: async (_sql, [host]) => [[...(host === 'myrestaurant.pk' ? [{ slug: 'lahore-grill' }] : [])]] };
  const route = customDomainRouting(pool, { env: {} });
  const run = async (hostname, path = '/') => { const req = { method: 'GET', hostname, path, url: path }; await route(req, {}, () => {}); return req.url; };
  assert.equal(await run('myrestaurant.pk'), '/r/lahore-grill');
  assert.equal(await run('www.myrestaurant.pk'), '/r/lahore-grill');
  assert.equal(await run('myrestaurant.pk', '/menu.html'), '/menu.html');
  assert.equal(await run('mar-khoor.com'), '/');
  assert.equal(await run('unknown.example'), '/');
});

test('integration health reports names of missing settings only, and payments as off by design', () => {
  const env = { OPENAI_API_KEY: 'sk-secret-value', META_APP_SECRET: 'x', WHATSAPP_VERIFY_TOKEN: 'y', WHATSAPP_ACCESS_TOKEN: 'z', VAPI_API_KEY: 'v' };
  const channels = summarize(configStatus(env), { inbound: { last_at: new Date(), week: 5 }, outbound: { delivered_week: 4, failed_week: 0 }, jobs: { pending: 0 }, calls: { last_at: null, week: 0 }, orders: { last_at: new Date(), today: 2 }, cash: { week: 3 } });
  assert.equal(channels.whatsapp.status, 'live');
  assert.equal(channels.ai.status, 'configured');
  assert.equal(channels.voice.status, 'missing');
  assert.ok(channels.voice.missing.includes('VAPI_TOOL_SECRET'));
  assert.equal(channels.payments.status, 'deferred');
  assert.match(channels.payments.note, /3 cash orders/);
  assert.ok(!JSON.stringify(channels).includes('sk-secret-value'), 'never exposes values');
});

test('domain and health routes are wired with the right guards', () => {
  const domains = readFileSync(new URL('../src/domains.js', import.meta.url), 'utf8');
  assert.match(domains, /site\/domain', requireAuth, restaurantAdmin/);
  assert.match(domains, /platform\/domains', requireAuth, superOnly/);
  assert.match(domains, /role='admin'/);
  const health = readFileSync(new URL('../src/integration-health.js', import.meta.url), 'utf8');
  assert.match(health, /integrations\/health', requireAuth, superOnly/);
  const server = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.ok(server.indexOf('customDomainRouting(pool)') < server.indexOf('express.static'), 'domain routing runs before static files');
  assert.ok(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8').includes('CREATE TABLE IF NOT EXISTS restaurant_domains'));
});
