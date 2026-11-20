import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(path.join(root, 'public', file), 'utf8');

test('public SEO pages have unique canonical URLs', () => {
  for (const [file, url] of [['index.html', 'https://mar-khoor.com/'], ['build-plan.html', 'https://mar-khoor.com/build-plan.html'], ['privacy.html', 'https://mar-khoor.com/privacy.html']]) {
    const html = read(file);
    assert.match(html, /name="description"/);
    assert.ok(html.includes('rel="canonical" href="' + url + '"'), file);
    assert.ok(!html.includes('content="noindex'), file);
  }
});

test('account, ordering, and tracking screens are noindex', () => {
  for (const file of ['register.html', 'restaurant.html', 'track.html', 'orders.html', 'menu.html']) {
    assert.match(read(file), /name="robots" content="noindex[^\"]*"/, file);
  }
});

test('sitemap lists only canonical public platform pages', () => {
  const map = read('sitemap.xml');
  assert.match(map, /<urlset/);
  for (const url of ['https://mar-khoor.com/', 'https://mar-khoor.com/build-plan.html', 'https://mar-khoor.com/privacy.html']) assert.ok(map.includes('<loc>' + url + '</loc>'));
  assert.doesNotMatch(map, /restaurant\.html|register\.html|track\.html|orders\.html|menu\.html|super-admin/);
  assert.match(read('robots.txt'), /Sitemap: https:\/\/mar-khoor\.com\/sitemap\.xml/);
});

test('home page has parseable organization and software JSON-LD', () => {
  const html = read('index.html');
  const json = html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/);
  assert.ok(json);
  const data = JSON.parse(json[1]);
  assert.equal(data['@context'], 'https://schema.org');
  assert.ok(data['@graph'].some(item => item['@type'] === 'SoftwareApplication'));
  assert.ok(data['@graph'].some(item => item['@type'] === 'Organization'));
});
