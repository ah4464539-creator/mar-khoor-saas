import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SITE_TEMPLATES, TEMPLATE_INFO, sanitizeSiteConfig, renderSitePage, generateSiteConfig, defaultSiteConfig } from '../src/site-builder.js';

const restaurant = { id: 4, name: 'Urban Cafe', slug: 'urban-cafe', currency: 'PKR', locale: 'en' };

test('11 templates, each with gallery info and its own CSS', () => {
  assert.equal(Object.keys(SITE_TEMPLATES).length, 11);
  for (const id of Object.keys(SITE_TEMPLATES)) {
    assert.ok(TEMPLATE_INFO[id]?.blurb && TEMPLATE_INFO[id].colors.length === 3, id);
    const html = renderSitePage({ restaurant, config: { template: id }, items: [] });
    assert.match(html, new RegExp('class="site-template-' + id + '"'));
    if (id !== 'classic') assert.match(html, new RegExp('body\\.site-template-' + id + '\\{'), id + ' css');
  }
});

test('existing sites keep their four sections; new fields are cleaned and limited', () => {
  assert.deepEqual(defaultSiteConfig(restaurant).sections, ['about', 'menu', 'hours', 'contact']);
  const c = sanitizeSiteConfig({
    sections: ['map', 'offers', 'bogus', 'menu', 'map'], banner: '  Eid\nsale  ', whatsapp: 'call me',
    offers: Array.from({ length: 9 }, (_, i) => ({ title: 'Deal ' + i, text: 'x', price: 'Rs ' + i })).concat([{ title: '' }]),
    reviews: [{ name: 'Ali', text: 'Great food' }, { name: 'Empty', text: '' }],
  }, restaurant);
  assert.deepEqual(c.sections, ['map', 'offers', 'menu']);
  assert.equal(c.banner, 'Eid sale');
  assert.equal(c.whatsapp, undefined, 'invalid number dropped');
  assert.equal(c.offers.length, 6);
  assert.deepEqual(c.reviews, [{ name: 'Ali', text: 'Great food' }]);
  assert.equal(sanitizeSiteConfig({ whatsapp: '+92 300 1234567' }, restaurant).whatsapp, '+92 300 1234567');
});

test('new sections render in the chosen order, escaped, with safe links', () => {
  const html = renderSitePage({ restaurant, items: [], config: {
    template: 'street', banner: 'Free <b>delivery</b>', sections: ['whatsapp', 'offers', 'reviews', 'map'],
    offers: [{ title: 'Combo <i>', text: 'Burger + fries', price: 'Rs 999' }], reviews: [{ name: 'Sara', text: '"Best" <script>' }],
    whatsapp: '+92 300 1234567', address: 'MM Alam Road, Lahore & more',
  } });
  assert.match(html, /<div class="site-banner">Free &lt;b&gt;delivery&lt;\/b&gt;<\/div>/);
  assert.match(html, /href="https:\/\/wa\.me\/923001234567"/);
  assert.match(html, /Combo &lt;i&gt;/);
  assert.match(html, /&quot;Best&quot; &lt;script&gt;/);
  assert.match(html, /google\.com\/maps\/search\/\?api=1&amp;query=MM%20Alam%20Road%2C%20Lahore%20%26%20more/);
  const order = ['id="whatsapp"', 'id="offers"', 'id="reviews"', 'id="map"'].map(x => html.indexOf(x));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.doesNotMatch(html, /<script>/);
});

test('AI rewrite keeps owner sections, offers, reviews and WhatsApp', async () => {
  const fetcher = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ headline: 'H', tagline: 'T', about: 'A', theme: 'gold', sections: ['menu', 'about', 'reviews', 'offers'] }) } }] }) });
  const current = { sections: ['menu', 'offers', 'whatsapp'], offers: [{ title: 'Deal' }], reviews: [{ text: 'Nice' }], whatsapp: '+923001234567', banner: 'Hi' };
  const { config } = await generateSiteConfig({ restaurant, current }, { fetcher, apiKey: 'k' });
  assert.deepEqual(config.sections, ['menu', 'about', 'offers', 'whatsapp']);
  assert.deepEqual([config.offers[0].title, config.reviews[0].text, config.whatsapp, config.banner], ['Deal', 'Nice', '+923001234567', 'Hi']);
});

test('dashboard has gallery, sections editor, live preview and live-site buttons', () => {
  const html = readFileSync('public/restaurant.html', 'utf8');
  for (const id of ['owner-live-site', 'site-live-open', 'quick-live-site', 'site-section-list', 'site-offers-editor', 'site-reviews-editor', 'template-dialog', 'preview-stage', 'site-builder']) assert.match(html, new RegExp('id="' + id + '"'), id);
  const js = readFileSync('public/restaurant.js', 'utf8');
  assert.match(js, /function updateLiveButtons/);
  assert.match(js, /function buildTemplateGallery/);
  assert.match(js, /function scheduleLivePreview/);
});
