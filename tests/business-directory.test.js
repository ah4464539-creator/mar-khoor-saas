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
  assert.deepEqual(Object.keys(list[0]).sort(), ['category', 'country', 'logo', 'name', 'slug', 'tagline', 'url']);
  assert.ok(!JSON.stringify(list).includes('+923001234567'), 'no private config fields');
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
  assert.match(readFileSync('src/server.js', 'utf8'), /app\.get\('\/app'/);
});
