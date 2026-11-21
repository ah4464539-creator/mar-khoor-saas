import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateContent, slugify, bodyToHtml, blogListHtml, articleHtml, createContent, updateContent, siteLinks, draftPost, publishedItem } from '../src/site-content.js';
import { renderSitePage } from '../src/site-builder.js';

const restaurant = { id: 4, name: 'Urban Cafe', slug: 'urban-cafe', currency: 'PKR', locale: 'en' };

test('validation: title and text required, safe slug, kind-specific fields', () => {
  assert.match(validateContent({ body: 'x' }, 'post').error, /Title/);
  assert.match(validateContent({ title: 'x' }, 'post').error, /text/);
  assert.match(validateContent({ title: 'x', body: 'y' }, 'other').error, /Unknown/);
  const post = validateContent({ title: 'Winter Soups Are Back!', body: 'Hot.', category: 'News', status: 'published', show_in_nav: true }, 'post').value;
  assert.deepEqual([post.slug, post.category, post.status, post.show_in_nav], ['winter-soups-are-back', 'News', 'published', 0]);
  const page = validateContent({ title: 'About us', body: 'Hi', category: 'x', show_in_nav: true, slug: '../etc' }, 'page').value;
  assert.deepEqual([page.slug, page.category, page.show_in_nav, page.status], ['about-us', null, 1, 'draft']);
  assert.match(slugify('ہمارے بارے میں'), /^item-/);
});

test('body becomes escaped paragraphs, headings and lists', () => {
  const html = bodyToHtml('## Menu <b>\n\nFirst <script>alert(1)</script>\n\n- one\n- two');
  assert.equal(html, '<h2>Menu &lt;b&gt;</h2><p>First &lt;script&gt;alert(1)&lt;/script&gt;</p><ul><li>one</li><li>two</li></ul>');
});

test('blog list and article markup link inside the restaurant site', () => {
  const posts = [{ kind: 'post', slug: 'soups', title: 'Soups', category: 'News', excerpt: 'Hot <i>', body: 'x', published_at: '2026-11-20T00:00:00Z' }];
  const list = blogListHtml(restaurant, posts, { categories: ['News', 'Offers'] });
  assert.match(list, /href="\/r\/urban-cafe\/blog\/soups"/);
  assert.match(list, /\?category=Offers/);
  assert.match(list, /Hot &lt;i&gt;/);
  assert.match(articleHtml(restaurant, posts[0]), /All posts/);
});

test('website renders header/footer links and page mode; foreign links dropped', () => {
  const site = { restaurant, config: {}, items: [] };
  const links = { nav: [{ href: '/r/urban-cafe/blog', label: 'Blog' }, { href: 'javascript:alert(1)', label: 'x' }, { href: 'https://evil.example', label: 'y' }], footer: [{ href: '/r/urban-cafe/p/about-us', label: 'About us' }] };
  const home = renderSitePage(site, { links });
  assert.match(home, /<a href="\/r\/urban-cafe\/blog">Blog<\/a>/);
  assert.match(home, /footer-links.*\/r\/urban-cafe\/p\/about-us/);
  assert.doesNotMatch(home, /javascript:|evil\.example/);
  const page = renderSitePage(site, { links, page: { title: 'About <us>', html: '<article>ok</article>' } });
  assert.match(page, /<title>About &lt;us&gt; · URBAN CAFE<\/title>/);
  assert.match(page, /<main class="wrap"><article>ok<\/article><\/main>/);
  assert.doesNotMatch(page, /class="hero"/);
  assert.match(page, /class="wordmark" href="\/r\/urban-cafe"/);
});

function memoryPool() {
  const rows = []; let id = 0;
  return { rows, async query() { return [[]]; }, async execute(sql, p) {
    if (sql.startsWith('SELECT COUNT(*)')) return [[{ n: rows.filter(r => r.restaurant_id === p[0] && r.kind === p[1]).length }]];
    if (sql.startsWith('SELECT id FROM site_content WHERE restaurant_id=? AND kind=? AND slug=?')) return [rows.filter(r => r.restaurant_id === p[0] && r.kind === p[1] && r.slug === p[2] && r.id !== p[3])];
    if (sql.startsWith('INSERT INTO site_content')) { rows.push({ id: ++id, restaurant_id: p[0], kind: p[1], slug: p[2], title: p[3], category: p[4], excerpt: p[5], body: p[6], status: p[7], show_in_nav: p[8], published_at: p[7] === 'published' ? 'now' : null }); return [{ insertId: id }]; }
    if (sql.startsWith('UPDATE site_content')) { const r = rows.find(x => x.id === p[8] && x.restaurant_id === p[9] && x.kind === p[10]); if (!r) return [{ affectedRows: 0 }]; Object.assign(r, { slug: p[0], title: p[1], status: p[5], show_in_nav: p[6] }); return [{ affectedRows: 1 }]; }
    if (sql.startsWith('SELECT kind,slug,title,show_in_nav')) return [rows.filter(r => r.restaurant_id === p[0] && r.status === 'published')];
    if (sql.includes("AND slug=? AND status='published'")) return [rows.filter(r => r.restaurant_id === p[0] && r.kind === p[1] && r.slug === p[2] && r.status === 'published')];
    return [[]];
  } };
}

test('create gives unique slugs; update keeps owner scope; links list published only', async () => {
  const pool = memoryPool();
  assert.equal((await createContent(pool, 4, 'post', { title: 'Soups', body: 'a', status: 'published' })).body.slug, 'soups');
  assert.equal((await createContent(pool, 4, 'post', { title: 'Soups', body: 'b' })).body.slug, 'soups-2');
  await createContent(pool, 4, 'page', { title: 'About us', body: 'c', status: 'published', show_in_nav: true });
  await createContent(pool, 4, 'page', { title: 'Privacy', body: 'd', status: 'published' });
  assert.equal((await updateContent(pool, 5, 'post', 1, { title: 'Hack', body: 'x' })).status, 404, 'other restaurant cannot edit');
  const links = await siteLinks(pool, restaurant);
  assert.deepEqual(links.nav.map(l => l.href), ['/r/urban-cafe/blog', '/r/urban-cafe/p/about-us']);
  assert.deepEqual(links.footer.map(l => l.label), ['About us', 'Privacy']);
  assert.equal((await publishedItem(pool, 4, 'post', 'soups-2')), null, 'drafts are hidden');
  assert.equal((await publishedItem(pool, 4, 'post', 'soups')).title, 'Soups');
});

test('AI draft: cleaned JSON, errors are friendly, no key = 503', async () => {
  const fetcher = async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.match(body.messages[1].content, /Karahi/);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ title: 'Winter <Soups>', category: 'News', excerpt: 'Warm', body: 'Para one.\n\nPara two.' }) } }] }) };
  };
  const ok = await draftPost({ restaurant, topic: 'winter soups', menuItems: [{ name: 'Karahi' }] }, { fetcher, apiKey: 'k' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.title, 'Winter <Soups>', 'stored as text; escaped when rendered');
  assert.equal((await draftPost({ restaurant, topic: '' }, { fetcher, apiKey: 'k' })).status, 400);
  assert.equal((await draftPost({ restaurant, topic: 'x' }, { fetcher, apiKey: '' })).status, 503);
});

test('dashboard has the Blog & pages view and routes are wired', () => {
  const html = readFileSync('public/restaurant.html', 'utf8');
  assert.match(html, /href="#blog-pages"/);
  assert.match(html, /id="blog-pages"/);
  assert.match(html, /\/site-content\.js\?v=/);
  const routes = readFileSync('src/sites.js', 'utf8');
  for (const r of ["'/r/:slug/blog'", "'/r/:slug/blog/:post'", "'/r/:slug/p/:page'", "'/api/restaurants/:restaurantId/site/content'"]) assert.ok(routes.includes(r), r);
});
