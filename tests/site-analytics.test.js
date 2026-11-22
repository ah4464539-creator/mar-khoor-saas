import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recordSiteEvent, loadSiteAnalytics, isLikelyBot, SITE_DAILY_SQL } from '../src/site-analytics.js';
import { sanitizeSiteConfig, renderSitePage, SITE_LANGUAGES, generateSiteConfig } from '../src/site-builder.js';

const browser = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
const req = (ua = browser, method = 'GET') => ({ method, get: name => (name === 'user-agent' ? ua : undefined) });

function mockPool(rows = [], orders = []) {
  const calls = [];
  return { calls, query: async sql => { calls.push(['query', sql]); return [[]]; },
    execute: async (sql, params) => { calls.push([sql, params]); if (sql.includes('FROM restaurant_site_daily')) return [rows]; if (sql.includes('FROM orders')) return [orders]; return [{ affectedRows: 1 }]; } };
}

test('counts real visits only, without personal data', async () => {
  const pool = mockPool();
  assert.equal(await recordSiteEvent(pool, 7, 'page_views', req()), true);
  const insert = pool.calls.find(([sql]) => String(sql).startsWith('INSERT'));
  assert.match(insert[0], /ON DUPLICATE KEY UPDATE page_views=page_views\+1/);
  assert.deepEqual(insert[1], [7]);
  assert.equal(await recordSiteEvent(pool, 7, 'page_views', req('Googlebot/2.1')), false);
  assert.equal(await recordSiteEvent(pool, 7, 'page_views', req('WhatsApp/2.23')), false);
  assert.equal(await recordSiteEvent(pool, 7, 'page_views', req(browser, 'HEAD')), false);
  assert.equal(await recordSiteEvent(pool, 7, 'orders; DROP TABLE x', req()), false);
  assert.ok(isLikelyBot(''));
  assert.ok(!/ip|user_agent|cookie/i.test(SITE_DAILY_SQL));
});

test('analytics fills 30 days and computes totals and menu open rate', async () => {
  const now = new Date('2026-11-20T10:00:00Z');
  const pool = mockPool([{ day: '2026-11-20', page_views: 40, menu_views: 10 }, { day: new Date('2026-11-19T00:00:00Z'), page_views: 10, menu_views: 5 }], [{ day: '2026-11-20', orders: 3 }]);
  const result = await loadSiteAnalytics(pool, 7, 30, now);
  assert.equal(result.days.length, 30);
  assert.equal(result.days.at(-1).day, '2026-11-20');
  assert.deepEqual(result.totals, { page_views: 50, menu_views: 15, orders: 3 });
  assert.equal(result.menu_open_rate, 30);
});

test('website language changes labels, lang and direction; unknown languages are ignored', () => {
  const restaurant = { name: 'Cheema Cafe', slug: 'cheema-cafe', currency: 'PKR', locale: 'en' };
  const items = [{ name: 'Tea', price_minor: 100 }];
  assert.deepEqual(Object.keys(SITE_LANGUAGES), ['en', 'ur', 'roman', 'ar', 'es', 'fr', 'de', 'tr', 'hi']);
  assert.ok(!('language' in sanitizeSiteConfig({ language: 'en' }, restaurant)));
  assert.ok(!('language' in sanitizeSiteConfig({ language: '"><script>' }, restaurant)));
  const urdu = renderSitePage({ restaurant, config: sanitizeSiteConfig({ language: 'ur', hours: '12-1' }, restaurant), items });
  assert.match(urdu, /<html lang="ur" dir="rtl">/);
  assert.ok(urdu.includes('اوقاتِ کار') && !urdu.includes('Opening hours'));
  const arabic = renderSitePage({ restaurant, config: sanitizeSiteConfig({ language: 'ar' }, restaurant), items });
  assert.match(arabic, /<html lang="ar" dir="rtl">/);
  assert.match(renderSitePage({ restaurant, config: sanitizeSiteConfig({ language: 'roman' }, restaurant), items }), /<html lang="ur-Latn" dir="ltr">/);
});

test('AI writes in the chosen website language', async () => {
  let body;
  const fetcher = async (_url, init) => { body = JSON.parse(init.body); return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ headline: 'خوش آمدید', tagline: 't', about: 'a', theme: 'gold', sections: ['menu'] }) } }] }) }; };
  const result = await generateSiteConfig({ restaurant: { name: 'R' }, current: { language: 'ur' } }, { fetcher, apiKey: 'k' });
  assert.equal(result.source, 'ai');
  assert.equal(result.config.language, 'ur');
  assert.match(JSON.parse(body.messages[1].content).language, /Urdu/);
});

test('site and public menu record analytics, owners can read them', () => {
  const sites = readFileSync(new URL('../src/sites.js', import.meta.url), 'utf8');
  assert.match(sites, /trackSiteEvent\(pool, site\.restaurant\.id, 'page_views', req\)/);
  assert.match(sites, /site\/analytics', requireAuth, restaurantAdmin/);
  assert.match(readFileSync(new URL('../src/api.js', import.meta.url), 'utf8'), /trackSiteEvent\(pool,restaurant\.id,'menu_views',req\)/);
});
