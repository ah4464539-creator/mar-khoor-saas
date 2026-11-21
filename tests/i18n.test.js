import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractStrings, buildAllowlist, translateStrings, pickLanguage, hashText, LANGUAGES, I18N_SQL } from '../src/i18n-core.js';

const fakePool = () => {
  const rows = new Map(); const queries = [];
  return { rows, queries, async query(sql, params = []) {
    queries.push(sql);
    if (sql.startsWith('SELECT')) { const [lang, ...hashes] = params; return [hashes.filter(h => rows.has(lang + h)).map(h => ({ src_hash: h, translation: rows.get(lang + h) }))]; }
    if (sql.startsWith('INSERT')) { for (let i = 0; i < params.length; i += 3) rows.set(params[i] + params[i + 1], params[i + 2]); }
    return [[]];
  } };
};

test('extracts interface text, placeholders and JS labels, not code', () => {
  const html = [...extractStrings('<h1>Live orders</h1><input placeholder="Search menu"><script>let x="<b>"</script>', 'html')];
  assert.ok(html.includes('Live orders') && html.includes('Search menu'));
  const js = [...extractStrings("show('Payment received'); el.className = 'btn-dark';", 'js')];
  assert.ok(js.includes('Payment received'));
  assert.ok(!js.includes('btn-dark'));
});

test('allowlist covers the landing page, register and dashboard', () => {
  const allow = buildAllowlist('public');
  for (const text of ['Live orders', 'Checkout & pay', 'How customers can pay']) assert.ok(allow.has(hashText(text)), text);
});

test('only allowlisted text is translated, then served from cache', async () => {
  const pool = fakePool(); let calls = 0;
  const allow = new Map([[hashText('Live orders'), 'Live orders']]);
  const translator = async (strings) => { calls++; return Object.fromEntries(strings.map(s => [s, 'لائیو آرڈرز'])); };
  const first = await translateStrings(pool, allow, 'ur', ['Live orders', 'Ali Khan, House 12'], { translator });
  assert.deepEqual(first, { 'Live orders': 'لائیو آرڈرز' });
  const again = await translateStrings(pool, allow, 'ur', ['Live orders'], { translator });
  assert.deepEqual(again, first);
  assert.equal(calls, 1);
  assert.deepEqual(await translateStrings(pool, allow, 'en', ['Live orders'], { translator }), {});
  assert.deepEqual(await translateStrings(pool, allow, 'xx', ['Live orders'], { translator }), {});
});

test('a translation failure leaves the text in English', async () => {
  const allow = new Map([[hashText('Menu'), 'Menu']]);
  assert.deepEqual(await translateStrings(fakePool(), allow, 'ar', ['Menu'], { translator: async () => { throw new Error('down'); } }), {});
});

test('picks the browser language, falls back to English', () => {
  assert.equal(pickLanguage('ur-PK,ur;q=0.9,en;q=0.8'), 'ur');
  assert.equal(pickLanguage('ar-AE'), 'ar');
  assert.equal(pickLanguage('ja-JP'), 'en');
  assert.equal(pickLanguage(''), 'en');
  for (const code of ['en', 'ur', 'ar', 'hi']) assert.ok(LANGUAGES.some(l => l.code === code));
  assert.ok(LANGUAGES.find(l => l.code === 'ur').rtl);
});

test('schema is additive and pages load the switcher', () => {
  assert.match(I18N_SQL, /CREATE TABLE IF NOT EXISTS i18n_strings/);
  assert.match(readFileSync('db/schema.sql', 'utf8'), /CREATE TABLE IF NOT EXISTS i18n_strings/);
  for (const page of ['index', 'register', 'restaurant']) assert.match(readFileSync(`public/${page}.html`, 'utf8'), /\/i18n\.js\?v=/);
  const client = readFileSync('public/i18n.js', 'utf8');
  assert.match(client, /translate="no"/);
  assert.match(client, /dir = RTL\.has\(lang\)/);
  assert.ok(!/innerHTML/.test(client));
});
