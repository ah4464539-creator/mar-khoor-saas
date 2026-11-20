import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sanitizeWidgetConfig, normalizeOrigin, frameAncestors, publicWidget, embedSnippet, assistantAllowed, inkOn, connectedNumbers } from '../src/widget-core.js';
import { loadWidgetSite } from '../src/site-store.js';

test('widget settings are sanitized: numbers, colour, origins, text', () => {
  const c = sanitizeWidgetConfig({ enabled: true, whatsapp_number: '0092 300 1234567', call_number: 'abc', color: 'red', position: 'top',
    label: '<b>Order</b>', origins: 'https://LahoreGrill.pk/menu, *.lahoregrill.pk, javascript:alert(1), not a host' });
  assert.equal(c.enabled, true);
  assert.equal(c.whatsapp_number, '+923001234567');
  assert.equal(c.call_number, '');
  assert.equal(sanitizeWidgetConfig({ call_number: '0300 1234567' }).call_number, '', 'local numbers need the country code');
  assert.equal(c.color, '#ff952f');
  assert.equal(c.position, 'right');
  assert.equal(c.label, 'bOrder/b');
  assert.deepEqual(c.origins, ['https://lahoregrill.pk', 'https://*.lahoregrill.pk']);
  assert.equal(sanitizeWidgetConfig({}).enabled, false, 'off until the owner turns it on');
  assert.equal(normalizeOrigin('http://localhost:3000'), 'http://localhost:3000');
  assert.equal(frameAncestors(c), 'https://lahoregrill.pk https://*.lahoregrill.pk');
  assert.equal(frameAncestors(sanitizeWidgetConfig({})), 'https:');
});

test('public widget config exposes only enabled buttons and falls back to connected numbers', () => {
  const config = sanitizeWidgetConfig({ enabled: true, call: false });
  const out = publicWidget(config, { whatsapp: '+923001112222', call: '+15550001111' }, { assistantAvailable: true });
  assert.deepEqual(out.tools, { assistant: true, whatsapp: '923001112222', call: '' });
  assert.equal(publicWidget(sanitizeWidgetConfig({ enabled: false }), { whatsapp: '+923001112222' }, { assistantAvailable: true }).tools.whatsapp, '');
  assert.equal(publicWidget(config, {}, { assistantAvailable: false }).tools.assistant, false, 'plan without assistant shows no chat');
  assert.equal(embedSnippet('https://mar-khoor.com', 'urban-cafe'), '<script src="https://mar-khoor.com/embed.js" data-restaurant="urban-cafe" async></script>');
  assert.equal(inkOn('#ffffff'), '#190d05');
  assert.equal(inkOn('#1a237e'), '#ffffff');
  assert.equal(assistantAllowed({ slug: 'x', websiteAssistantProvisioned: true }, {}), true);
  assert.equal(assistantAllowed({ slug: 'x', websiteAssistantProvisioned: true }, { REGISTRATION_WEBSITE_ASSISTANT_ENABLED: 'false' }), false);
});

test('connected numbers prefer the active AI Caller number', async () => {
  const pool = { execute: async sql => /restaurant_integrations/.test(sql)
    ? [[{ kind: 'whatsapp', value: '+923001112222' }, { kind: 'ai_caller', value: '+923004445555' }]]
    : [[{ phone_number: '+15550001111' }]] };
  assert.deepEqual(await connectedNumbers(pool, 1), { whatsapp: '+923001112222', call: '+15550001111' });
});

test('assistant works for widget-only restaurants without a published website', async () => {
  const widget = JSON.stringify({ enabled: true, assistant: true });
  const pool = { execute: async sql => /restaurant_widget/.test(sql)
    ? [[{ id: 3, name: 'Grill', slug: 'grill', currency: 'PKR', website_assistant_provisioned: 1, config: null, widget }]]
    : [[{ id: 9, name: 'Tikka', price_minor: 50000 }]] };
  const site = await loadWidgetSite(pool, 'grill');
  assert.equal(site.restaurant.id, 3);
  assert.equal(site.items.length, 1);
  const off = { execute: async () => [[{ id: 3, slug: 'grill', widget: JSON.stringify({ enabled: false }) }]] };
  assert.equal(await loadWidgetSite(off, 'grill'), null);
  assert.equal(await loadWidgetSite({ execute: async () => { throw new Error('no table'); } }, 'grill'), null);
});

test('only the chat frame can be framed, and only by the listed sites', () => {
  const sites = readFileSync(new URL('../src/sites.js', import.meta.url), 'utf8');
  const frame = sites.slice(sites.indexOf("router.get('/embed/:slug/chat'"), sites.indexOf('// Public website.'));
  assert.match(frame, /removeHeader\('X-Frame-Options'\)/);
  assert.match(frame, /frame-ancestors ' \+ frameAncestors\(widget\)/);
  assert.match(frame, /if \(!widget\?\.enabled \|\| !widget\.assistant\)/);
  assert.equal(sites.match(/removeHeader\('X-Frame-Options'\)/g).length, 1);
  const embed = readFileSync(new URL('../public/embed.js', import.meta.url), 'utf8');
  assert.match(embed, /attachShadow/, 'widget styles never leak into the owner site');
  assert.match(embed, /event\.origin === base/, 'messages accepted only from Mar-Khoor');
  assert.ok(!/innerHTML = [^;]*config\.label/.test(embed), 'owner text is set with textContent');
  const widget = readFileSync(new URL('../src/widget.js', import.meta.url), 'utf8');
  assert.match(widget, /widget', requireAuth, restaurantAdmin/);
});
