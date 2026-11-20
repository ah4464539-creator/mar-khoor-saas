import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { advanceDomainSetup, webTargets, missingWebRecords, describeSetup, pointsToHosting } from '../src/domain-automation.js';
import { createHostingerClient, yearlyDomainPrice, hostingerConfig } from '../src/hostinger-client.js';

function fakePool() {
  const sql = [];
  return { sql, query: async q => { sql.push([q]); return [[]]; }, execute: async (q, p) => { sql.push([q, p]); return [{ affectedRows: 1 }]; } };
}
function fakeClient({ accessible = false, zone = null, sslState = 'installing' } = {}) {
  const calls = [];
  return {
    calls, config: { serverIp: '145.79.9.104', username: 'u1', website: 'mar-khoor.com' },
    verifyOwnership: async domain => { calls.push(['verify', domain]); return { domain, is_accessible: accessible, txt_to_verify: 'abc123' }; },
    listParked: async () => { calls.push(['listParked']); return []; },
    park: async domain => { calls.push(['park', domain]); return {}; },
    zone: async domain => { calls.push(['zone', domain]); return zone; },
    addRecords: async (domain, records) => { calls.push(['addRecords', domain, records]); return {}; },
    portfolioDomain: async () => ({ name_servers: { ns1: 'aurora.dns-parking.com', ns2: 'nebula.dns-parking.com' } }),
    sslInstall: async domain => { calls.push(['sslInstall', domain]); return {}; },
    sslStatus: async () => ({ status: sslState }),
  };
}
const base = { restaurant_id: 7, domain: 'lahoregrill.pk', managed: 0, stage: 'ownership', attempts: 0 };
const resolverTo = ips => ({ resolve4: async host => host === 'lahoregrill.pk' ? ips : ['145.79.9.104'], resolveNs: async () => ['ns1.other.com'] });

test('external domain: waits for ownership TXT, then parks on our hosting and gives DNS targets', async () => {
  const pool = fakePool();
  let client = fakeClient();
  let row = await advanceDomainSetup(pool, client, { ...base });
  assert.equal(row.stage, 'ownership');
  assert.equal(row.ownership_txt, 'abc123');
  assert.equal(describeSetup(row).records[0].type, 'TXT');
  assert.ok(!client.calls.some(([name]) => name === 'park'));
  client = fakeClient({ accessible: true, zone: [{ name: '@', type: 'ALIAS', records: [{ content: 'lahoregrill.pk.cdn.hstgr.net.' }] }] });
  row = await advanceDomainSetup(pool, client, { ...base }, { resolver: resolverTo([]) });
  assert.ok(client.calls.some(([name, domain]) => name === 'park' && domain === 'lahoregrill.pk'));
  assert.ok(!client.calls.some(([name]) => name === 'addRecords'), 'never writes DNS we do not manage');
  assert.equal(row.stage, 'dns');
  const shown = describeSetup(row).records;
  assert.deepEqual(shown.map(record => [record.type, record.value]), [['ALIAS', 'lahoregrill.pk.cdn.hstgr.net'], ['CNAME', 'lahoregrill.pk']]);
});

test('DNS pointing to hosting → routing turned on, SSL requested once, then live', async () => {
  const pool = fakePool();
  const client = fakeClient({ sslState: 'installing' });
  const targets = JSON.stringify([{ type: 'A', name: 'lahoregrill.pk', value: '145.79.9.104' }]);
  let row = await advanceDomainSetup(pool, client, { ...base, stage: 'dns', targets }, { resolver: resolverTo(['1.1.1.1']) });
  assert.equal(row.stage, 'dns');
  row = await advanceDomainSetup(pool, client, { ...base, stage: 'dns', targets }, { resolver: resolverTo(['145.79.9.104']) });
  assert.equal(row.stage, 'ssl');
  assert.ok(pool.sql.some(([q]) => /UPDATE restaurant_domains SET status=IF/.test(q)), 'domain becomes verified so it is routed');
  assert.equal(client.calls.filter(([name]) => name === 'sslInstall').length, 1);
  row = await advanceDomainSetup(pool, client, row);
  assert.equal(client.calls.filter(([name]) => name === 'sslInstall').length, 1, 'no repeated certificate requests');
  row = await advanceDomainSetup(pool, fakeClient({ sslState: 'active' }), row);
  assert.equal(row.stage, 'live');
  assert.ok(pool.sql.some(([q]) => /status='connected'/.test(q)));
});

test('domain in our Hostinger account: ownership skipped, only missing web records added, never overwrite', async () => {
  const pool = fakePool();
  const zone = [{ name: '@', type: 'MX', records: [{ content: '5 mx1.hostinger.com.' }] }, { name: '@', type: 'TXT', records: [{ content: 'v=spf1' }] }];
  const client = fakeClient({ zone });
  const row = await advanceDomainSetup(pool, client, { ...base, managed: 1, stage: 'parking' }, { resolver: resolverTo([]) });
  const add = client.calls.find(([name]) => name === 'addRecords');
  assert.deepEqual(add[2].map(record => [record.name, record.type]), [['@', 'A'], ['www', 'CNAME']]);
  assert.equal(row.nameservers, 'aurora.dns-parking.com,nebula.dns-parking.com');
  assert.deepEqual(missingWebRecords([{ name: '@', type: 'A', records: [] }, { name: 'www', type: 'CNAME', records: [] }], '1.2.3.4'), []);
});

test('Hostinger client uses the documented endpoints, never overwrites DNS and keeps the token server-side', async () => {
  const requests = [];
  const fetcher = async (url, init) => { requests.push({ url, ...init, body: init.body && JSON.parse(init.body) }); return { ok: true, status: 200, text: async () => '{}' }; };
  const client = createHostingerClient({ token: 't0k', username: 'u927386692', website: 'mar-khoor.com' }, { fetcher });
  await client.park('lahoregrill.pk');
  await client.addRecords('lahoregrill.pk', [{ name: '@', type: 'A', records: [{ content: '1.2.3.4' }] }]);
  await client.verifyOwnership('lahoregrill.pk');
  await client.sslInstall('lahoregrill.pk');
  assert.equal(requests[0].url, 'https://developers.hostinger.com/api/hosting/v1/accounts/u927386692/websites/mar-khoor.com/parked-domains');
  assert.deepEqual(requests[0].body, { parked_domain: 'lahoregrill.pk' });
  assert.equal(requests[1].method, 'PUT');
  assert.equal(requests[1].body.overwrite, false);
  assert.equal(requests[2].url, 'https://developers.hostinger.com/api/hosting/v1/domains/verify-ownership');
  assert.match(requests[3].url, /websites\/lahoregrill\.pk\/ssl\/setup$/);
  assert.equal(requests[0].headers.Authorization, 'Bearer t0k');
  assert.equal(hostingerConfig({}), null);
  assert.deepEqual(yearlyDomainPrice([{ name: '.COM Domain', prices: [{ id: 'hostingercom-domain-com-usd-1y', period: 1, period_unit: 'year', price: 999, currency: 'USD' }] }], 'com'),
    { item_id: 'hostingercom-domain-com-usd-1y', price_cents: 999, currency: 'USD', renewal_cents: 999 });
});

test('domain purchase spends money only from a super admin click; owners can only request', () => {
  const src = readFileSync(new URL('../src/domains.js', import.meta.url), 'utf8');
  assert.match(src, /domain-requests\/:id\/purchase', requireAuth, superOnly/);
  const ownerRequest = src.slice(src.indexOf("site/domain/request'"), src.indexOf("site/domain/requests'"));
  assert.ok(!ownerRequest.includes('client.purchase'), 'owners never trigger a purchase');
  assert.match(src, /status IN \('requested','failed'\)/, 'purchase claim is single-use');
  const server = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.match(server, /startDomainWorker\(pool, hostinger\)/);
});

test('webTargets falls back to the server IP when the zone has no apex record', async () => {
  assert.deepEqual(webTargets(null, 'x.pk', '145.79.9.104'), [{ type: 'A', name: 'x.pk', value: '145.79.9.104' }, { type: 'CNAME', name: 'www.x.pk', value: 'x.pk' }]);
  assert.equal(await pointsToHosting('x.pk', [{ type: 'ALIAS', name: 'x.pk', value: 'x.pk.cdn.hstgr.net' }], { resolver: { resolveNs: async () => [], resolve4: async host => host === 'x.pk' ? ['2.2.2.2'] : ['2.2.2.2', '3.3.3.3'] } }), true);
});
