import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { listBusinesses, cleanQuery } from '../src/business-directory.js';

const fakePool = rows => {
  const calls = [];
  return { calls, execute: async (sql, params) => { calls.push({ sql, params }); return [rows]; } };
};

test('only published sites are listed, with public fields only', async () => {
  const pool = fakePool([
    { id: 1, name: 'Urban Cafe', slug: 'urban-cafe', country_code: 'PK', config: JSON.stringify({ tagline: 'Best chai', logo: '/media/1-0123456789abcdef.png', phone: '+923001234567' }), category: null },
    { id: 2, name: 'Cheema Clinic', slug: 'cheema-clinic', country_code: 'PK', config: '{}', category: 'clinic' },
    { id: 3, name: 'Bad', slug: 'Bad Slug!', country_code: 'PK', config: '{}', category: 'salon' },
  ]);
  const list = await listBusinesses(pool);
  assert.match(pool.calls[0].sql, /s\.published=1/);
  assert.deepEqual(list.map(b => [b.slug, b.category, b.url]), [['urban-cafe', 'restaurant', '/r/urban-cafe'], ['cheema-clinic', 'clinic', '/r/cheema-clinic']]);
  assert.equal(list[0].tagline, 'Best chai');
  assert.equal(list[0].logo, '/media/1-0123456789abcdef.png');
  assert.deepEqual(Object.keys(list[0]).sort(), ['address', 'ai_chat', 'ai_voice', 'category', 'country', 'logo', 'name', 'phone', 'slug', 'tagline', 'url', 'whatsapp']);
  assert.equal(list[0].phone, '+923001234567', 'the phone the business shows on its own website');
  assert.ok(!('template' in list[0]) && !('sections' in list[0]), 'no other site settings');
});

test('search, category and country become bound parameters; no "?=\'\'" in SQL', async () => {
  const pool = fakePool([]);
  await listBusinesses(pool, { q: "Cheema's 100%_ <script>", category: 'clinic', country: 'PK' });
  const { sql, params } = pool.calls[0];
  assert.ok(!/\?\s*=\s*''/.test(sql));
  assert.deepEqual(params, ["%Cheema's 100 script%", 'PK', 'clinic']);
  await listBusinesses(pool, { category: 'restaurant' });
  assert.match(pool.calls[1].sql, /p\.category IS NULL OR p\.category='restaurant'/);
  await listBusinesses(pool, { category: 'drop table', country: 'pak' });
  assert.deepEqual(pool.calls[2].params, []);
});

test('query cleaning keeps letters in any script', () => {
  assert.equal(cleanQuery('  چیمہ   کلینک '), 'چیمہ کلینک');
  assert.equal(cleanQuery('a'.repeat(100)).length, 60);
  assert.equal(cleanQuery(null), '');
});

test('customer app page and manifest point at /app and use no inline script', () => {
  const html = readFileSync('public/app.html', 'utf8');
  assert.match(html, /<link rel="manifest" href="\/customer\.webmanifest">/);
  assert.ok(!/<script>(?!<\/script>)/.test(html) && !/\son[a-z]+="/.test(html));
  const manifest = JSON.parse(readFileSync('public/customer.webmanifest', 'utf8'));
  assert.equal(manifest.start_url, '/app');
  const js = readFileSync('public/customer-app.js', 'utf8');
  assert.ok(!/innerHTML/.test(js), 'text only, no HTML injection');
  assert.match(readFileSync('src/server.js', 'utf8'), /app\.get\(\['\/app', '\/businesses'\]/);
});

test('contact buttons: phone and WhatsApp the business already shows on its website', async () => {
  const { phoneDigits, waNumber } = await import('../src/business-directory.js');
  assert.equal(phoneDigits('+92 300 1234567'), '+923001234567');
  assert.equal(phoneDigits('0300-1234567'), '03001234567');
  assert.equal(phoneDigits('12'), null);
  assert.equal(waNumber('+92 300 1234567'), '923001234567');
  assert.equal(waNumber('0300 1234567'), null, 'wa.me needs the international number');
  const pool = fakePool([{ id: 1, name: 'Cafe', slug: 'cafe', country_code: 'PK', config: JSON.stringify({ phone: '+92 42 1234567', whatsapp: '+92 300 1234567', address: 'Gulberg, Lahore' }), category: null }]);
  const [b] = await listBusinesses(pool);
  assert.deepEqual([b.phone, b.whatsapp, b.address], ['+92421234567', '923001234567', 'Gulberg, Lahore']);
});

test('directory page groups by category and links from the home page', () => {
  const js = readFileSync('public/customer-app.js', 'utf8');
  assert.match(js, /ORDER = \['restaurant', 'clinic', 'salon', 'hotel'\]/);
  assert.match(js, /'tel:' \+ b\.phone/);
  assert.match(js, /'https:\/\/wa\.me\/' \+ b\.whatsapp/);
  assert.match(readFileSync('public/index.html', 'utf8'), /href="\/businesses">Find a business<\/a>/);
});

test('customers can chat or talk with the business AI inside the app', async () => {
  const row = { id: 1, name: 'Cafe', slug: 'cafe', country_code: 'PK', config: '{}', category: null, website_assistant_provisioned: 1 };
  const on = await listBusinesses(fakePool([row]), {}, { RESTAURANT_WEBSITE_VOICE_ENABLED: 'true' });
  assert.deepEqual([on[0].ai_chat, on[0].ai_voice], [true, true]);
  const noVoice = await listBusinesses(fakePool([row]), {}, {});
  assert.deepEqual([noVoice[0].ai_chat, noVoice[0].ai_voice], [true, false]);
  const off = await listBusinesses(fakePool([{ ...row, website_assistant_provisioned: 0 }]), {}, { RESTAURANT_WEBSITE_VOICE_ENABLED: 'true' });
  assert.deepEqual([off[0].ai_chat, off[0].ai_voice], [false, false]);
  const js = readFileSync('public/customer-app.js', 'utf8');
  assert.match(js, /url \+ '#assistant'/);
  assert.match(js, /url \+ '#assistant-talk'/);
  assert.match(readFileSync('public/restaurant-assistant-panel.js', 'utf8'), /location\.hash === '#assistant-talk'/);
});

test('directory shows a booking line for clinics instead of the old food default', async () => {
  const pool = fakePool([{ id: 2, name: 'Cheema Clinic', slug: 'cheema-clinic', country_code: 'PK', config: JSON.stringify({ tagline: 'Order online from Cheema Clinic' }), category: 'clinic' }]);
  const [b] = await listBusinesses(pool);
  assert.equal(b.tagline, 'Book an appointment at Cheema Clinic');
});

test('test businesses and hidden slugs stay off the public directory', async () => {
  const { listed } = await import('../src/business-directory.js');
  assert.equal(listed('mkqa-bistro-20261123', {}), false);
  assert.equal(listed('mar-khoor-qa-check-fde298', {}), false);
  assert.equal(listed('urban-cafe', {}), true);
  assert.equal(listed('urban-cafe', { DIRECTORY_HIDDEN_SLUGS: 'x, urban-cafe' }), false);
  assert.equal(listed('mkqa-bistro-20261123', { DIRECTORY_SHOW_TEST: '1' }), true);
  const pool = fakePool([{ id: 1, name: 'QA', slug: 'mkqa-clinic-1', country_code: 'PK', config: '{}', category: 'clinic' }, { id: 2, name: 'Real', slug: 'real-cafe', country_code: 'PK', config: '{}', category: null }]);
  assert.deepEqual((await listBusinesses(pool, {}, {})).map(b => b.slug), ['real-cafe']);
});
