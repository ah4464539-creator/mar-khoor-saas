// FREE_TOOLS_FOR_TESTING: listed tools are switched on without payment; everything else still pays.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { useSessionStore } from '../src/auth.js';
import { createMemorySessionStore, hashToken } from '../src/sessions.js';
import { billingRouter } from '../src/billing.js';
import { freeTestTools, toolCatalog } from '../src/tools.js';

const OWNER = 'c'.repeat(64), STRANGER = 'd'.repeat(64);

test('free test tools come only from the env list of real tool keys', () => {
  assert.deepEqual([...freeTestTools({})], []);
  assert.deepEqual([...freeTestTools({ FREE_TOOLS_FOR_TESTING: ' whatsapp , bogus,calling' })], ['whatsapp', 'calling']);
  const catalog = toolCatalog('USD', 'PK', { env: { FREE_TOOLS_FOR_TESTING: 'whatsapp' } });
  assert.equal(catalog.find(t => t.key === 'whatsapp').free_test, true);
  assert.equal(catalog.find(t => t.key === 'calling').free_test, false);
  assert.equal(catalog.find(t => t.key === 'whatsapp').price_minor.monthly, 1900, 'the real price is kept');
});

test('a free test tool is activated without Stripe; paid tools and strangers are refused', async () => {
  const old = process.env.FREE_TOOLS_FOR_TESTING;
  process.env.FREE_TOOLS_FOR_TESTING = 'whatsapp';
  const store = createMemorySessionStore();
  useSessionStore(store);
  await store.create(hashToken(OWNER), { id: 5, email: 'owner@x.pk', platformRole: 'user' }, 3600);
  await store.create(hashToken(STRANGER), { id: 6, email: 's@x.pk', platformRole: 'user' }, 3600);
  const tools = new Map(), audits = [];
  const pool = {
    query: async () => [[]],
    execute: async (sql, args = []) => {
      if (/FROM restaurant_members/.test(sql)) return [args[1] === 5 ? [{ role: 'admin' }] : []];
      if (/SELECT id,name,currency,country_code FROM restaurants/.test(sql)) return [[{ id: 7, name: 'Test Cafe', currency: 'PKR', country_code: 'PK' }]];
      if (/SELECT tool_key,billing_cycle,status,number_mode FROM restaurant_tools/.test(sql)) return [[...tools.values()]];
      if (/INSERT INTO restaurant_tools/.test(sql)) { assert.match(sql, /'free_test','active'/); tools.set(args[1], { tool_key: args[1], billing_cycle: 'free_test', status: 'active', number_mode: args[2] }); return [{ affectedRows: 1 }]; }
      if (/audit_logs/.test(sql)) { audits.push(args); return [{}]; }
      return [[]];
    },
  };
  let stripeCalls = 0;
  const stripe = { checkout: async () => { stripeCalls++; return { url: 'https://checkout.stripe.com/c/pay/x' }; }, portal: async () => ({}), cancel: async () => {} };
  const app = express();
  app.use(express.json());
  // No Stripe config at all: free activation must still work.
  app.use(billingRouter(pool, { config: null, stripe, loadRates: async () => null }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = (token, body) => fetch(base + '/api/restaurants/7/billing/tools-checkout', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await post(STRANGER, { tools: ['whatsapp'] })).status, 403);
    assert.equal((await post(OWNER, { tools: ['whatsapp', 'website'] })).status, 409, 'free and paid tools cannot be mixed');
    assert.equal((await post(OWNER, { tools: ['website'] })).status, 503, 'paid tools still need online payment');
    const ok = await post(OWNER, { tools: ['whatsapp'], billing_cycle: 'monthly' });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { activated: ['whatsapp'], free_test: true });
    assert.equal(tools.get('whatsapp').status, 'active');
    assert.equal(stripeCalls, 0);
    assert.ok(audits.some(a => a.includes('billing.tools_free_test:whatsapp')));
    assert.equal((await post(OWNER, { tools: ['whatsapp'] })).status, 409, 'already active');
  } finally {
    server.close();
    if (old === undefined) delete process.env.FREE_TOOLS_FOR_TESTING; else process.env.FREE_TOOLS_FOR_TESTING = old;
  }
});
