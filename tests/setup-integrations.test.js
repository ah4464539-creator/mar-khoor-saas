import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSetup, normalizeDomain, saveSetup, finishSetup, getIntegrations } from '../src/setup-integrations.js';

test('domains are normalised and platform domains rejected', () => {
  assert.equal(normalizeDomain('https://www.MyCafe.pk/menu'), 'www.mycafe.pk');
  assert.equal(normalizeDomain('mycafe.com.'), 'mycafe.com');
  for (const bad of ['', 'localhost', 'mar-khoor.com', 'shop.mar-khoor.com', 'bad_domain.com', 'a..com', 42]) assert.equal(normalizeDomain(bad), null, String(bad));
});

test('setup validation: everything optional, values checked when given', () => {
  assert.deepEqual(validateSetup({}).value, {});
  assert.deepEqual(validateSetup({ whatsapp: { skip: true } }).value.whatsapp, { mode: null, value: null, skipped: true });
  assert.equal(validateSetup({ whatsapp: { mode: 'meta_signup', value: '0300 1234567' } }).value.whatsapp.value, '0300 1234567');
  assert.match(validateSetup({ whatsapp: { mode: 'meta_signup', value: '12' } }).error, /valid Business WhatsApp/);
  assert.match(validateSetup({ ai_caller: { mode: 'teleport', value: '03001234567' } }).error, /how to connect/);
  assert.equal(validateSetup({ website: { mode: 'builder', value: 'ignored' } }).value.website.value, null);
  assert.match(validateSetup({ website: { mode: 'domain', value: 'nope' } }).error, /domain/);
  assert.match(validateSetup({ billing: { skip: true } }).error, /Unknown/);
  assert.ok(validateSetup([]).error);
});

function fakePool(seed = {}) {
  const s = { rows: new Map(), whatsapp: [], inventory: [], numbers: [], sites: [], aiSettings: new Map(), setup: null, country: 'PK', slug: 'urban-cafe', ...seed };
  return { s, async execute(sql, a) {
    if (sql.startsWith('INSERT INTO restaurant_integrations')) { s.rows.set(a[0] + '|' + a[1], { restaurant_id: a[0], kind: a[1], mode: a[2], value: a[3], status: a[4], detail: null }); return [{}]; }
    if (sql.startsWith('SELECT kind,mode')) return [[...s.rows.values()].filter(r => r.restaurant_id === a[0])];
    if (sql.startsWith('UPDATE restaurant_integrations')) { const r = s.rows.get(a[2] + '|' + a[3]); if (r) Object.assign(r, { status: a[0], detail: a[1] }); return [{ affectedRows: r ? 1 : 0 }]; }
    if (sql.startsWith('SELECT phone_number_id FROM whatsapp_numbers')) return [s.whatsapp.filter(w => w.restaurant_id === a[0])];
    if (sql.startsWith('INSERT INTO whatsapp_ai_settings')) { s.aiSettings.set(a[0], true); return [{}]; }
    if (sql.startsWith('SELECT phone_number FROM registration_voice_inventory')) return [s.inventory.filter(i => i.restaurant_id === a[0])];
    if (sql.startsWith('SELECT phone_number FROM restaurant_numbers')) return [s.numbers.filter(n => n.restaurant_id === a[0])];
    if (sql.startsWith('SELECT country_code FROM restaurants')) return [[{ country_code: s.country }]];
    if (sql.startsWith('SELECT published FROM restaurant_sites')) return [s.sites.filter(x => x.restaurant_id === a[0])];
    if (sql.startsWith('SELECT slug FROM restaurants')) return [[{ slug: s.slug }]];
    if (sql.startsWith('INSERT INTO restaurant_setup')) { s.setup = a[0]; return [{}]; }
    throw Error('unexpected ' + sql);
  } };
}

test('unsaved items report not_started', async () => {
  const items = await getIntegrations(fakePool(), 4);
  assert.deepEqual(items.map(i => [i.kind, i.status]), [['whatsapp', 'not_started'], ['ai_caller', 'not_started'], ['website', 'not_started']]);
});

test('finish connects what is possible and reports honest pending steps', async () => {
  const pool = fakePool();
  const assigned = [];
  const assignVoiceNumber = async (_p, id, country) => { assigned.push([id, country]); return { status: 'active', number: '+924212345678' }; };
  assert.equal((await saveSetup(pool, 4, { whatsapp: { mode: 'meta_signup', value: '+923001234567' }, ai_caller: { mode: 'forward', value: '04235761234' }, website: { mode: 'builder' } })).status, 200);
  const result = await finishSetup(pool, 4, { assignVoiceNumber, baseUrl: 'https://mar-khoor.com' });
  assert.equal(result.status, 200);
  const by = Object.fromEntries(result.body.integrations.map(i => [i.kind, i]));
  assert.equal(by.whatsapp.status, 'pending');
  assert.match(by.whatsapp.detail, /Connect with Facebook/);
  assert.equal(by.ai_caller.status, 'connected');
  assert.match(by.ai_caller.detail, /\+924212345678.*Forward calls from 04235761234/);
  assert.deepEqual(assigned, [[4, 'PK']]);
  assert.equal(by.website.status, 'pending');
  assert.match(by.website.detail, /https:\/\/mar-khoor.com\/r\/urban-cafe/);
  assert.equal(pool.s.setup, 4);
});

test('already linked WhatsApp, active number and published site are connected; AI replies switched on', async () => {
  const pool = fakePool({ whatsapp: [{ restaurant_id: 4, phone_number_id: '123' }], numbers: [{ restaurant_id: 4, phone_number: '+15550001' }], sites: [{ restaurant_id: 4, published: 1 }] });
  await saveSetup(pool, 4, { whatsapp: { mode: 'meta_signup', value: '+923001234567' }, ai_caller: { mode: 'import', value: '+923001234567' }, website: { mode: 'builder' } });
  const by = Object.fromEntries((await finishSetup(pool, 4, {})).body.integrations.map(i => [i.kind, i.status]));
  assert.deepEqual(by, { whatsapp: 'connected', ai_caller: 'connected', website: 'connected' });
  assert.equal(pool.s.aiSettings.get(4), true);
});

test('tenant isolation: another restaurant\'s numbers and site never connect this one', async () => {
  const pool = fakePool({ whatsapp: [{ restaurant_id: 9, phone_number_id: '9' }], inventory: [{ restaurant_id: 9, phone_number: '+1999' }], sites: [{ restaurant_id: 9, published: 1 }] });
  await saveSetup(pool, 4, { whatsapp: { mode: 'meta_signup', value: '+923001234567' }, ai_caller: { mode: 'import', value: '+923001234567' }, website: { mode: 'builder' } });
  const by = Object.fromEntries((await finishSetup(pool, 4, {})).body.integrations.map(i => [i.kind, i.status]));
  assert.deepEqual(by, { whatsapp: 'pending', ai_caller: 'pending', website: 'pending' });
  assert.equal(pool.s.aiSettings.has(4), false);
});

test('skipped items stay skipped and one failing connector does not block the others', async () => {
  const pool = fakePool();
  await saveSetup(pool, 4, { whatsapp: { skip: true }, ai_caller: { mode: 'forward', value: '03001234567' }, website: { mode: 'domain', value: 'mycafe.pk' } });
  const result = await finishSetup(pool, 4, { assignVoiceNumber: async () => { throw Error('provider down'); } });
  const by = Object.fromEntries(result.body.integrations.map(i => [i.kind, i]));
  assert.equal(by.whatsapp.status, 'skipped');
  assert.equal(by.ai_caller.status, 'failed');
  assert.equal(by.website.status, 'pending');
  assert.match(by.website.detail, /mycafe.pk/);
});

test('no free AI number gives a clear pending message', async () => {
  const pool = fakePool();
  await saveSetup(pool, 4, { ai_caller: { mode: 'forward', value: '03001234567' } });
  const result = await finishSetup(pool, 4, { assignVoiceNumber: async () => ({ status: 'pending' }) });
  const caller = result.body.integrations.find(i => i.kind === 'ai_caller');
  assert.equal(caller.status, 'pending');
  assert.match(caller.detail, /No AI Caller number is free/);
});

test('invalid setup is rejected before touching the database; database errors are 503', async () => {
  const pool = { execute: async () => { throw Error('must not be called'); } };
  assert.equal((await saveSetup(pool, 4, { whatsapp: { mode: 'meta_signup', value: 'x' } })).status, 400);
  assert.equal((await saveSetup(pool, 4, { website: { mode: 'builder' } })).status, 503);
  assert.equal((await finishSetup(pool, 4, {})).status, 503);
});
