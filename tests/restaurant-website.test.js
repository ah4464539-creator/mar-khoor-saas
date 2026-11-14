import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { addPublicWebsiteRoute, addWebsiteSettingsRoutes } from '../src/restaurant-website.js';

test('a restaurant publishes validated settings and the storefront is scoped to its slug', async t => {
  const restaurant = { name: 'Cafe & Kitchen', slug: 'cafe', locale: 'en' };
  const settings = { headline: 'Cafe & Kitchen', description: 'Food & drinks', theme: 'midnight' };
  let published;
  const pool = {
    async execute(sql, args) {
      if (sql.startsWith('SELECT name')) return [[restaurant]];
      if (sql.startsWith('INSERT INTO restaurant_websites')) {
        assert.equal(args[0], 7);
        published = settings;
      }
      if (sql.startsWith('INSERT INTO audit_logs')) assert.deepEqual(args, [2, 7, 'website.publish']);
      if (sql.includes('JOIN restaurant_websites')) return [published && args[0] === restaurant.slug ? [{ ...restaurant, ...published }] : []];
      return [[]];
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/restaurants/:restaurantId', (req, res, next) => {
    if (req.params.restaurantId !== '7') return res.sendStatus(403);
    req.restaurantId = 7;
    req.user = { id: 2 };
    next();
  });
  addWebsiteSettingsRoutes(app, pool);
  addPublicWebsiteRoute(app, pool);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const base = 'http://127.0.0.1:' + server.address().port;
  const put = (id, body) => fetch(base + '/restaurants/' + id + '/website', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

  assert.equal((await fetch(base + '/r/cafe')).status, 404);
  assert.equal((await put(8, settings)).status, 403);
  assert.equal((await put(7, { ...settings, html: '<b>Menu</b>' })).status, 400);
  assert.equal((await put(7, settings)).status, 200);
  assert.equal((await fetch(base + '/r/other-cafe')).status, 404);
  const page = await fetch(base + '/r/cafe');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  const html = await page.text();
  assert.match(html, /<h1>Cafe &amp; Kitchen<\/h1>/);
  assert.match(html, /data-restaurant="cafe"/);
  assert.match(html, /src="\/menu.js"/);
});
