// Blog posts and content pages (About, Privacy, Terms...) for restaurant websites.
// One additive table (CREATE TABLE IF NOT EXISTS); no changes to existing tables. No express import.
// Body text is plain text with a tiny safe format: blank line = new paragraph, "## " = heading,
// "- " = list item. Everything is escaped when rendered, so owners cannot inject HTML or scripts.
import { escapeHtml, CONTENT_CSS } from './site-builder.js';
export { CONTENT_CSS };

export const CONTENT_SQL = `CREATE TABLE IF NOT EXISTS site_content (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 restaurant_id BIGINT UNSIGNED NOT NULL,
 kind ENUM('post','page') NOT NULL,
 slug VARCHAR(80) NOT NULL,
 title VARCHAR(160) NOT NULL,
 category VARCHAR(60) NULL,
 excerpt VARCHAR(300) NULL,
 body MEDIUMTEXT NOT NULL,
 status ENUM('draft','published') NOT NULL DEFAULT 'draft',
 show_in_nav TINYINT(1) NOT NULL DEFAULT 0,
 published_at TIMESTAMP NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uq_site_content (restaurant_id, kind, slug),
 KEY ix_site_content_list (restaurant_id, kind, status, published_at),
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB`;

const ready = new WeakMap();
export function ensureContentTable(pool) {
  if (!ready.has(pool)) ready.set(pool, Promise.resolve().then(() => pool.query(CONTENT_SQL)).catch(error => { ready.delete(pool); throw error; }));
  return ready.get(pool);
}

export const KINDS = ['post', 'page'];
export const MAX_ITEMS = { post: 500, page: 20 };
const text = (value, max) => (typeof value === 'string' ? value : '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
const line = (value, max) => text(value, max).replace(/\s+/g, ' ');

/** URL slug from a title: latin letters and digits; other scripts fall back to a short id. */
export function slugify(value) {
  const s = String(value || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70).replace(/-+$/, '');
  return s || 'item-' + Date.now().toString(36);
}

/** Validates owner input. Returns { value } or { error }. */
export function validateContent(input, kind) {
  if (!KINDS.includes(kind)) return { error: 'Unknown content type' };
  const body = input && typeof input === 'object' ? input : {};
  const title = line(body.title, 160);
  if (!title) return { error: 'Title is required' };
  const content = text(body.body, 20000);
  if (!content) return { error: 'Write some text first' };
  const slug = typeof body.slug === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(body.slug) ? body.slug : slugify(title);
  const status = body.status === 'published' ? 'published' : 'draft';
  return { value: {
    title, slug, body: content, status,
    category: kind === 'post' ? (line(body.category, 60) || null) : null,
    excerpt: kind === 'post' ? (line(body.excerpt, 300) || null) : null,
    show_in_nav: kind === 'page' && body.show_in_nav === true ? 1 : 0,
  } };
}

const row = r => ({ id: Number(r.id), kind: r.kind, slug: r.slug, title: r.title, category: r.category || null, excerpt: r.excerpt || null,
  body: r.body, status: r.status, show_in_nav: Boolean(r.show_in_nav), published_at: r.published_at || null, updated_at: r.updated_at || null });

export async function listContent(pool, restaurantId, kind) {
  await ensureContentTable(pool);
  const [rows] = await pool.execute('SELECT id,kind,slug,title,category,excerpt,body,status,show_in_nav,published_at,updated_at FROM site_content WHERE restaurant_id=? AND kind=? ORDER BY COALESCE(published_at,created_at) DESC, id DESC LIMIT 500', [restaurantId, kind]);
  return rows.map(row);
}

async function uniqueSlug(pool, restaurantId, kind, slug, exceptId = 0) {
  for (let n = 1; n < 50; n++) {
    const candidate = n === 1 ? slug : (slug.slice(0, 74) + '-' + n);
    const [rows] = await pool.execute('SELECT id FROM site_content WHERE restaurant_id=? AND kind=? AND slug=? AND id<>? LIMIT 1', [restaurantId, kind, candidate, exceptId]);
    if (!rows.length) return candidate;
  }
  return slug.slice(0, 60) + '-' + Date.now().toString(36);
}

export async function createContent(pool, restaurantId, kind, input) {
  const checked = validateContent(input, kind);
  if (checked.error) return { status: 400, body: { error: checked.error } };
  await ensureContentTable(pool);
  const [[count]] = await pool.execute('SELECT COUNT(*) AS n FROM site_content WHERE restaurant_id=? AND kind=?', [restaurantId, kind]);
  if (Number(count?.n || 0) >= MAX_ITEMS[kind]) return { status: 409, body: { error: 'Limit reached: delete an old one first' } };
  const v = checked.value;
  v.slug = await uniqueSlug(pool, restaurantId, kind, v.slug);
  const [result] = await pool.execute(
    'INSERT INTO site_content(restaurant_id,kind,slug,title,category,excerpt,body,status,show_in_nav,published_at) VALUES (?,?,?,?,?,?,?,?,?,' + (v.status === 'published' ? 'CURRENT_TIMESTAMP' : 'NULL') + ')',
    [restaurantId, kind, v.slug, v.title, v.category, v.excerpt, v.body, v.status, v.show_in_nav]);
  return { status: 201, body: { id: Number(result.insertId), ...v } };
}

export async function updateContent(pool, restaurantId, kind, id, input) {
  if (!Number.isSafeInteger(id) || id < 1) return { status: 400, body: { error: 'Invalid id' } };
  const checked = validateContent(input, kind);
  if (checked.error) return { status: 400, body: { error: checked.error } };
  await ensureContentTable(pool);
  const v = checked.value;
  v.slug = await uniqueSlug(pool, restaurantId, kind, v.slug, id);
  const [result] = await pool.execute(
    'UPDATE site_content SET slug=?,title=?,category=?,excerpt=?,body=?,status=?,show_in_nav=?,'
    // Decided in JS: comparing a bound value with a literal fails on production MariaDB (mixed collations).
    + 'published_at=' + (v.status === 'published' ? 'COALESCE(published_at,CURRENT_TIMESTAMP)' : 'NULL') + ' WHERE id=? AND restaurant_id=? AND kind=?',
    [v.slug, v.title, v.category, v.excerpt, v.body, v.status, v.show_in_nav, id, restaurantId, kind]);
  if (!result.affectedRows) return { status: 404, body: { error: 'Not found' } };
  return { status: 200, body: { id, ...v } };
}

export async function deleteContent(pool, restaurantId, kind, id) {
  if (!Number.isSafeInteger(id) || id < 1) return { status: 400, body: { error: 'Invalid id' } };
  await ensureContentTable(pool);
  const [result] = await pool.execute('DELETE FROM site_content WHERE id=? AND restaurant_id=? AND kind=?', [id, restaurantId, kind]);
  return result.affectedRows ? { status: 200, body: { deleted: id } } : { status: 404, body: { error: 'Not found' } };
}

// Public reads: published only. Never throw: a missing table just means no content yet.
export async function publishedList(pool, restaurantId, kind, { category = null, limit = 50 } = {}) {
  try {
    await ensureContentTable(pool);
    const params = [restaurantId, kind];
    let sql = "SELECT id,kind,slug,title,category,excerpt,body,status,show_in_nav,published_at,updated_at FROM site_content WHERE restaurant_id=? AND kind=? AND status='published'";
    if (category) { sql += ' AND category=?'; params.push(category); }
    sql += ' ORDER BY published_at DESC, id DESC LIMIT ' + Math.min(Math.max(Number(limit) || 50, 1), 100);
    const [rows] = await pool.execute(sql, params);
    return rows.map(row);
  } catch { return []; }
}
export async function publishedItem(pool, restaurantId, kind, slug) {
  if (typeof slug !== 'string' || !/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  try {
    await ensureContentTable(pool);
    const [rows] = await pool.execute("SELECT id,kind,slug,title,category,excerpt,body,status,show_in_nav,published_at,updated_at FROM site_content WHERE restaurant_id=? AND kind=? AND slug=? AND status='published' LIMIT 1", [restaurantId, kind, slug]);
    return rows.length ? row(rows[0]) : null;
  } catch { return null; }
}

/** Links for the website header and footer: the blog (if it has posts) and pages marked for the menu. */
export async function siteLinks(pool, restaurant) {
  try {
    await ensureContentTable(pool);
    const [rows] = await pool.execute("SELECT kind,slug,title,show_in_nav FROM site_content WHERE restaurant_id=? AND status='published' ORDER BY kind, id LIMIT 200", [restaurant.id]);
    const base = '/r/' + restaurant.slug;
    const links = [];
    if (rows.some(r => r.kind === 'post')) links.push({ href: base + '/blog', label: 'Blog' });
    for (const r of rows) if (r.kind === 'page' && Number(r.show_in_nav) === 1) links.push({ href: base + '/p/' + r.slug, label: r.title.slice(0, 40) });
    const footer = rows.filter(r => r.kind === 'page').map(r => ({ href: base + '/p/' + r.slug, label: r.title.slice(0, 40) }));
    return { nav: links.slice(0, 8), footer: footer.slice(0, 20) };
  } catch { return { nav: [], footer: [] }; }
}

/** Safe HTML for a body: paragraphs, "## " headings, "- " lists. All text escaped. */
export function bodyToHtml(body) {
  const out = [];
  for (const block of String(body || '').split(/\n\s*\n/)) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    if (lines.every(l => /^[-*•]\s+/.test(l))) { out.push('<ul>' + lines.map(l => '<li>' + escapeHtml(l.replace(/^[-*•]\s+/, '')) + '</li>').join('') + '</ul>'); continue; }
    for (const l of lines) {
      if (/^##\s+/.test(l)) out.push('<h2>' + escapeHtml(l.replace(/^##\s+/, '')) + '</h2>');
      else if (/^#\s+/.test(l)) out.push('<h2>' + escapeHtml(l.replace(/^#\s+/, '')) + '</h2>');
      else out.push('<p>' + escapeHtml(l) + '</p>');
    }
  }
  return out.join('');
}

const dateText = value => { try { return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return ''; } };
const summary = post => post.excerpt || String(post.body || '').replace(/^#+\s+/gm, '').replace(/\s+/g, ' ').slice(0, 180) + (String(post.body || '').length > 180 ? '…' : '');

/** Main area of the blog list page. */
export function blogListHtml(restaurant, posts, { category = null, categories = [] } = {}) {
  const base = '/r/' + restaurant.slug + '/blog';
  const chips = categories.length > 1 ? '<nav class="category-nav" aria-label="Blog categories"><a href="' + base + '"' + (category ? '' : ' aria-current="page"') + '>All</a>'
    + categories.map(c => '<a href="' + base + '?category=' + encodeURIComponent(c) + '"' + (c === category ? ' aria-current="page"' : '') + '>' + escapeHtml(c) + '</a>').join('') + '</nav>' : '';
  const cards = posts.map(p => '<li class="dish blog-card"><span class="blog-meta">' + escapeHtml([p.category, dateText(p.published_at)].filter(Boolean).join(' · ')) + '</span>'
    + '<h3><a href="' + base + '/' + p.slug + '">' + escapeHtml(p.title) + '</a></h3><p>' + escapeHtml(summary(p)) + '</p>'
    + '<div class="dish-footer"><a href="' + base + '/' + p.slug + '">Read more</a></div></li>').join('');
  return '<section><div class="section-heading"><h2>' + (category ? escapeHtml(category) : 'Blog') + '</h2></div>' + chips
    + (cards ? '<ul class="menu-grid">' + cards + '</ul>' : '<p>No posts yet.</p>') + '</section>';
}

/** Main area of one post or page. */
export function articleHtml(restaurant, item) {
  const back = item.kind === 'post' ? '<p><a href="/r/' + restaurant.slug + '/blog">← All posts</a></p>' : '';
  const meta = item.kind === 'post' ? '<p class="blog-meta">' + escapeHtml([item.category, dateText(item.published_at)].filter(Boolean).join(' · ')) + '</p>' : '';
  return '<article class="info-card site-article">' + back + '<h1>' + escapeHtml(item.title) + '</h1>' + meta + bodyToHtml(item.body) + '</article>';
}


/** AI draft of a blog post from a short topic, using the restaurant's menu for facts. */
export async function draftPost({ restaurant, topic, menuItems = [], language = 'en' }, { fetcher = fetch, apiKey = process.env.OPENAI_API_KEY, model = process.env.SITE_AI_MODEL || 'gpt-4o-mini' } = {}) {
  const subject = line(topic, 300);
  if (!subject) return { status: 400, body: { error: 'Write a topic first' } };
  if (!apiKey) return { status: 503, body: { error: 'AI writing is not set up' } };
  const menu = menuItems.slice(0, 40).map(i => '- ' + line(i.name, 80) + (i.category ? ' (' + line(i.category, 40) + ')' : '')).join('\n');
  const response = await fetcher('https://api.openai.com/v1/chat/completions', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45000),
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, temperature: 0.7, response_format: { type: 'json_object' }, messages: [
      { role: 'system', content: 'You write short, warm blog posts for a restaurant website. Reply with JSON {"title","category","excerpt","body"}. '
        + 'body: 250-450 words, plain text only; separate paragraphs with a blank line; use "## " for at most 3 subheadings and "- " for list items. '
        + 'No HTML, no markdown links, no made-up prices, discounts, awards or facts not given. Category: one or two words (e.g. News, Recipes, Offers, Events). '
        + 'Write in language code: ' + (/^[a-z]{2}$/.test(language) ? language : 'en') + '.' },
      { role: 'user', content: 'Restaurant: ' + line(restaurant.name, 160) + '\nTopic: ' + subject + (menu ? '\nMenu items you may mention:\n' + menu : '') },
    ] }),
  });
  let data = null;
  try { data = await response.json(); } catch { /* ignore */ }
  if (!response.ok) return { status: 502, body: { error: 'AI writing failed, try again' } };
  let draft = {};
  try { draft = JSON.parse(data?.choices?.[0]?.message?.content || '{}'); } catch { draft = {}; }
  const out = { title: line(draft.title, 160), category: line(draft.category, 60), excerpt: line(draft.excerpt, 300), body: text(draft.body, 20000) };
  if (!out.title || !out.body) return { status: 502, body: { error: 'AI writing failed, try again' } };
  return { status: 200, body: out };
}
