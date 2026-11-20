import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { securityHeaders } from '../src/security.js';
import { sitesRouter } from '../src/sites.js';
import { widgetRouter } from '../src/widget.js';

test('embed widget: public config and chat frame for a widget-only restaurant', async () => {
  const saved = process.env.REGISTRATION_WEBSITE_ASSISTANT_ENABLED;
  delete process.env.REGISTRATION_WEBSITE_ASSISTANT_ENABLED;
  const widget = JSON.stringify({ enabled: true, assistant: true, whatsapp: true, call: false, color: '#1d6b4f', origins: ['lahoregrill.pk'], greeting: '<b>Salaam</b>' });
  const queries = [];
  const pool = {
    async query() { return [[]]; },
    async execute(sql, args = []) {
      queries.push(sql);
      if (/s\.published=1/.test(sql)) return [[]]; // no published Mar-Khoor website
      if (/JOIN restaurant_widget w ON w\.restaurant_id=r\.id LEFT JOIN/.test(sql)) return args[0] === 'grill' ? [[{ id: 3, name: 'Grill', slug: 'grill', currency: 'PKR', website_assistant_provisioned: 1, config: null, widget }]] : [[]];
      if (/FROM restaurants r JOIN restaurant_widget/.test(sql)) return args[0] === 'grill' ? [[{ id: 3, slug: 'grill', website_assistant_provisioned: 1, config: widget }]] : [[]];
      if (/SELECT config FROM restaurant_widget/.test(sql)) return [[{ config: widget }]];
      if (/FROM menu_items/.test(sql)) return [[{ id: 9, name: 'Tikka', price_minor: 50000 }]];
      if (/restaurant_integrations/.test(sql)) return [[{ kind: 'whatsapp', value: '+923001112222' }]];
      if (/restaurant_numbers/.test(sql)) return [[]];
      if (/restaurant_site_daily/.test(sql)) return [{}];
      throw Error('Unexpected SQL: ' + sql);
    },
  };
  const app = express(); app.use(securityHeaders); app.use(express.json()); app.use(widgetRouter(pool)); app.use(sitesRouter(pool));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const config = await fetch(base + '/embed/grill/config.json');
    assert.equal(config.status, 200);
    assert.equal(config.headers.get('access-control-allow-origin'), '*');
    assert.deepEqual(await config.json(), { enabled: true, color: '#1d6b4f', position: 'right', label: 'Order with AI', tools: { assistant: true, whatsapp: '923001112222', call: '' } });
    assert.equal((await fetch(base + '/embed/nobody/config.json')).status, 404);

    const frame = await fetch(base + '/embed/grill/chat');
    assert.equal(frame.status, 200);
    assert.equal(frame.headers.get('x-frame-options'), null);
    assert.match(frame.headers.get('content-security-policy'), /frame-ancestors https:\/\/lahoregrill\.pk(;|$)/);
    const html = await frame.text();
    assert.match(html, /action="\/r\/grill\/assistant"/);
    assert.match(html, />bSalaam\/b</, "owner text is stripped of markup");
    assert.ok(!html.includes("<b>"));
    assert.match(html, /\/embed-frame\.js/);

    // The website itself stays unpublished and unframeable.
    const page = await fetch(base + '/r/grill');
    assert.equal(page.status, 404);
    assert.equal(page.headers.get('x-frame-options'), 'DENY');
    const status = await fetch(base + '/r/grill/assistant/status');
    assert.equal(status.status, 200, 'assistant API works for the widget');

    assert.equal((await fetch(base + '/api/restaurants/3/widget')).status, 401);
    assert.ok(queries.every(sql => !/INSERT|UPDATE|DELETE/i.test(sql) || /restaurant_site_daily/.test(sql)));
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (saved === undefined) delete process.env.REGISTRATION_WEBSITE_ASSISTANT_ENABLED; else process.env.REGISTRATION_WEBSITE_ASSISTANT_ENABLED = saved;
  }
});
