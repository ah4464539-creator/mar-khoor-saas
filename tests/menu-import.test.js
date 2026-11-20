import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractMenu, sanitizeImportedItems, MenuImportError } from '../src/menu-import.js';
import { isPrivateAddress, assertPublicUrl, safeFetchText, htmlToText, SafeFetchError } from '../src/safe-fetch.js';

const aiReply = items => async (_url, init) => ({ ok: true, json: async () => ({ output: [{ content: [{ type: 'output_text', text: JSON.stringify({ items }) }] }] }), _body: init.body });
const publicDns = async () => [{ address: '93.184.216.34' }];

test('imported items are cleaned, deduplicated, capped and converted to price_minor', () => {
  const items = sanitizeImportedItems({ items: [
    { name: '  Chicken Karahi ', description: 'Half kg', category: 'Karahi', price: 1600 },
    { name: 'Chicken Karahi', category: 'Karahi', price: 1600 },
    { name: 'Lassi', category: 'Drinks', price: 'Rs. 350' },
    { name: 'Mystery', price: -5 },
    { name: '', price: 10 },
    { name: 'x'.repeat(300), price: 1.5 },
  ] });
  assert.deepEqual(items.map(item => [item.name.slice(0, 20), item.price_minor]), [['Chicken Karahi', 160000], ['Lassi', 35000], ['Mystery', null], ['x'.repeat(20), 150]]);
  assert.equal(items[3].name.length, 180);
  assert.equal(sanitizeImportedItems({ items: Array.from({ length: 400 }, (_, i) => ({ name: 'Item ' + i, price: 1 })) }).length, 150);
});

test('photo, PDF and text are sent to the AI as a draft request with a strict schema', async () => {
  let request;
  const fetcher = async (url, init) => { request = { url, body: JSON.parse(init.body) }; return aiReply([{ name: 'Tea', description: '', category: 'Drinks', price: 100 }])(url, init); };
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(20)]);
  const result = await extractMenu({ kind: 'image', mime: 'image/png', buffer: png }, { fetcher, apiKey: 'k', currency: 'PKR' });
  assert.deepEqual(result.items, [{ name: 'Tea', description: '', category: 'Drinks', price_minor: 10000 }]);
  assert.equal(request.url, 'https://api.openai.com/v1/responses');
  assert.equal(request.body.store, false);
  assert.equal(request.body.text.format.type, 'json_schema');
  assert.match(request.body.input[0].content[0].image_url, /^data:image\/png;base64,/);
  assert.match(request.body.instructions, /Never invent items or prices/);
  await extractMenu({ kind: 'pdf', buffer: Buffer.from('%PDF-1.7 test') }, { fetcher, apiKey: 'k' });
  assert.equal(request.body.input[0].content[0].type, 'input_file');
  await assert.rejects(extractMenu({ kind: 'pdf', buffer: Buffer.from('<html>') }, { fetcher, apiKey: 'k' }), e => e.status === 415);
  await extractMenu({ kind: 'text', text: 'Tea 100' }, { fetcher, apiKey: 'k' });
  assert.match(request.body.input[0].content[0].text, /Tea 100/);
});

test('import fails clearly without a key, on provider errors and when nothing is found', async () => {
  await assert.rejects(extractMenu({ kind: 'text', text: 'Tea 100' }, { apiKey: '' }), e => e instanceof MenuImportError && e.status === 503);
  await assert.rejects(extractMenu({ kind: 'text', text: 'Tea 100' }, { apiKey: 'k', fetcher: async () => ({ ok: false, status: 429 }) }), e => /busy or out of quota/.test(e.message));
  await assert.rejects(extractMenu({ kind: 'text', text: 'Tea 100' }, { apiKey: 'k', fetcher: aiReply([]) }), e => e.status === 422);
});

test('link import blocks private addresses and non-web content (SSRF protection)', async () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) assert.ok(isPrivateAddress(address), address);
  assert.ok(!isPrivateAddress('93.184.216.34'));
  for (const bad of ['file:///etc/passwd', 'ftp://x.com', 'http://localhost/menu', 'https://user:pw@x.com', 'https://x.com:8080/', 'http://169.254.169.254/latest'])
    await assert.rejects(assertPublicUrl(bad, { resolve: publicDns }), SafeFetchError, bad);
  await assert.rejects(assertPublicUrl('https://internal.example.com', { resolve: async () => [{ address: '10.0.0.5' }] }), SafeFetchError);
  // A redirect to a private address is refused.
  const redirecting = async () => ({ status: 302, headers: new Headers({ location: 'http://127.0.0.1/admin' }) });
  await assert.rejects(safeFetchText('https://menu.example.com', { fetcher: redirecting, resolve: publicDns }), SafeFetchError);
  const pdf = async () => ({ status: 200, ok: true, headers: new Headers({ 'content-type': 'application/pdf' }), body: null, text: async () => '' });
  await assert.rejects(safeFetchText('https://menu.example.com', { fetcher: pdf, resolve: publicDns }), /not a web page/);
  const html = async () => ({ status: 200, ok: true, headers: new Headers({ 'content-type': 'text/html' }), body: null, text: async () => '<h1>Menu</h1><script>x()</script><p>Tea &amp; cake – 100</p>' });
  const page = await safeFetchText('https://menu.example.com', { fetcher: html, resolve: publicDns });
  assert.equal(htmlToText(page.text), 'Menu\nTea & cake – 100');
});

test('import and bulk-add routes are admin only, rate limited and never auto-save', () => {
  const src = readFileSync(new URL('../src/menu-import-routes.js', import.meta.url), 'utf8');
  assert.match(src, /rateLimit\(\{ windowMs: 60 \* 60 \* 1000, max: 15/);
  assert.match(src, /requireAuth, restaurantAdmin/);
  assert.match(src, /role='admin'/);
  const importRoute = src.slice(src.indexOf("menu/import'"), src.indexOf("menu/bulk'"));
  assert.ok(!/INSERT/.test(importRoute), 'import returns a draft only');
  assert.match(src, /beginTransaction/);
  assert.ok(readFileSync(new URL('../src/server.js', import.meta.url), 'utf8').includes('app.use(menuImportRouter(pool));'));
});
