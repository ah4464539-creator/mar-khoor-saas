import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { provisionSubscriptionNumber, retryPendingSubscriptionNumbers, pickNumber, includesNumber, missingConfig } from '../src/voice-autoprovision.js';
import { assistantCopy } from '../src/providers/vapi-assistants.js';
import { findTelnyxCredential } from '../src/providers/vapi-numbers.js';
import { resetDiscoveredCredential } from '../src/voice-autoprovision.js';
import { plansRouter } from '../src/plans.js';

const deps = fetcher => ({
  fetcher, telnyxKey: 'tk', vapiKey: 'vk', credentialId: 'cred', templateAssistantId: 'tmpl-1',
  maxMonthlyUsd: 15, maxUpfrontUsd: 15, requirementGroup: () => undefined,
});

// In-memory stand-in for the tables this flow touches.
function fakeDb({ plan = 'premium', status = 'active', country = 'US', route = { provider: 'telnyx', mode: 'manual' }, assistants = [], numbers = [] } = {}) {
  const db = { sub: { plan_key: plan, status }, assistants: [...assistants], numbers: [...numbers], integrations: [], log: [] };
  db.pool = {
    async execute(sql, args = []) {
      db.log.push(sql.split(' ').slice(0, 3).join(' '));
      if (sql.startsWith('SELECT plan_key,status FROM restaurant_subscriptions')) return [db.sub ? [db.sub] : []];
      if (sql.startsWith('SELECT id,name,country_code FROM restaurants')) return [[{ id: args[0], name: 'Cheema Grill', country_code: country }]];
      if (sql.startsWith('SELECT phone_number FROM registration_voice_inventory')) return [[]];
      if (sql.startsWith("SELECT id,phone_number,status FROM restaurant_numbers WHERE restaurant_id=?")) return [db.numbers.filter(n => n.status !== 'failed').slice(-1)];
      if (sql.startsWith('SELECT provider,mode FROM number_routes')) return [route ? [route] : []];
      if (sql.startsWith('SELECT assistant_id FROM voice_assistants')) return [db.assistants.map(id => ({ assistant_id: id }))];
      if (sql.startsWith('INSERT INTO voice_assistants')) { db.assistants.push(args[0]); return [{}]; }
      if (sql.startsWith('INSERT INTO restaurant_numbers')) {
        if (db.numbers.some(n => n.subscription_restaurant_id === args[1])) throw Object.assign(Error('dup'), { code: 'ER_DUP_ENTRY' });
        const row = { id: db.numbers.length + 1, restaurant_id: args[0], subscription_restaurant_id: args[1], phone_number: args[3], status: 'ordering' };
        db.numbers.push(row); return [{ insertId: row.id }];
      }
      const row = db.numbers.find(n => n.id === args.at(-1));
      if (sql.startsWith('UPDATE restaurant_numbers SET provider_order_id')) { row.provider_order_id = args[0]; return [{}]; }
      if (sql.startsWith("UPDATE restaurant_numbers SET status='pending_provider'")) { row.status = 'pending_provider'; return [{}]; }
      if (sql.startsWith("UPDATE restaurant_numbers SET status='active'")) { row.status = 'active'; row.vapi_phone_id = args[0]; return [{}]; }
      if (sql.startsWith("UPDATE restaurant_numbers SET status='failed'")) { row.status = 'failed'; row.subscription_restaurant_id = null; return [{}]; }
      if (sql.startsWith("UPDATE restaurant_numbers SET status='import_failed'")) { row.status = 'import_failed'; return [{}]; }
      if (sql.startsWith('UPDATE restaurant_numbers SET last_error')) { row.last_error = args[0]; return [{}]; }
      if (sql.startsWith('UPDATE restaurant_integrations')) { db.integrations.push(args[0]); return [{}]; }
      if (sql.startsWith('SELECT id,restaurant_id,plan_order_id,phone_number,provider_order_id,status FROM restaurant_numbers WHERE id=?')) return [db.numbers.filter(n => n.id === args[0]).map(n => ({ ...n, plan_order_id: null }))];
      if (sql.includes('FROM restaurant_numbers WHERE subscription_restaurant_id IS NOT NULL')) return [db.numbers.filter(n => n.subscription_restaurant_id && ['pending_provider', 'import_failed'].includes(n.status))];
      if (sql.startsWith('UPDATE plan_orders')) return [{}];
      throw Error('unexpected SQL: ' + sql);
    },
  };
  return db;
}

function fakeProviders({ numbers = [{ phone_number: '+12025550123', features: [{ name: 'voice' }], cost_information: { monthly_cost: '1.00', upfront_cost: '1.00', currency: 'USD' } }], orderStatus = 'success', orderFails = false, laterStatus = 'success' } = {}) {
  const calls = [];
  const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  const fetcher = async (url, init = {}) => {
    calls.push((init.method || 'GET') + ' ' + url.replace(/\?.*/, ''));
    if (url.startsWith('https://api.vapi.ai/assistant/tmpl-1')) return json({ id: 'tmpl-1', orgId: 'o', createdAt: 'x', name: 'Template', model: { provider: 'openai' }, voice: { provider: 'vapi' }, server: { url: 'https://mar-khoor.com/integrations/vapi/tools' } });
    if (url === 'https://api.vapi.ai/assistant') { const body = JSON.parse(init.body); assert.equal(body.id, undefined); assert.equal(body.orgId, undefined); return json({ id: 'asst-new', ...body }); }
    if (url.startsWith('https://api.telnyx.com/v2/available_phone_numbers')) return json({ data: numbers });
    if (url === 'https://api.telnyx.com/v2/number_orders') return orderFails ? json({ errors: [{ detail: 'not available' }] }, 422) : json({ data: { id: 'ord-1', status: orderStatus } });
    if (url.startsWith('https://api.telnyx.com/v2/number_orders/')) return json({ data: { id: 'ord-1', status: laterStatus } });
    if (url === 'https://api.vapi.ai/phone-number') { const body = JSON.parse(init.body); assert.equal(body.assistantId, 'asst-new'); assert.equal(body.provider, 'telnyx'); return json({ id: 'phone-1' }); }
    throw Error('unexpected URL ' + url);
  };
  return { fetcher, calls };
}

test('only Premium and Enterprise include a number; config gaps are reported by name', () => {
  assert.equal(includesNumber('starter'), false);
  assert.equal(includesNumber('premium'), true);
  assert.equal(includesNumber('enterprise'), true);
  assert.deepEqual(missingConfig({ telnyxKey: 'x' }), ['VAPI_API_KEY', 'VAPI_TEMPLATE_ASSISTANT_ID']);
});

test('number choice skips unknown or expensive costs', () => {
  const caps = { maxMonthlyUsd: 5, maxUpfrontUsd: 5 };
  assert.equal(pickNumber([{ phone_number: '+12025550100', monthly_cost: null, upfront_cost: '1', currency: 'USD' }], caps), null);
  assert.equal(pickNumber([{ phone_number: '+12025550100', monthly_cost: '9', upfront_cost: '1', currency: 'USD' }], caps), null);
  assert.equal(pickNumber([{ phone_number: '+12025550100', monthly_cost: '1', upfront_cost: '1', currency: 'EUR' }], caps), null);
  assert.equal(pickNumber([{ phone_number: '+12025550100', monthly_cost: '9', currency: 'USD' }, { phone_number: '+12025550101', monthly_cost: '2', upfront_cost: '0', currency: 'USD' }], caps).phone_number, '+12025550101');
});

test('paid Premium subscription: creates assistant, buys one Telnyx number and connects it', async () => {
  const db = fakeDb();
  const { fetcher, calls } = fakeProviders();
  const outcome = await provisionSubscriptionNumber(db.pool, 7, deps(fetcher));
  assert.equal(outcome.status, 'active', outcome.detail);
  assert.equal(outcome.phone_number, '+12025550123');
  assert.deepEqual(db.assistants, ['asst-new']);
  assert.equal(db.numbers.length, 1);
  assert.equal(db.numbers[0].status, 'active');
  assert.equal(db.numbers[0].subscription_restaurant_id, 7);
  assert.equal(db.integrations.at(-1), 'connected');
  assert.deepEqual(calls, ['GET https://api.vapi.ai/assistant/tmpl-1', 'POST https://api.vapi.ai/assistant', 'GET https://api.telnyx.com/v2/available_phone_numbers', 'POST https://api.telnyx.com/v2/number_orders', 'POST https://api.vapi.ai/phone-number']);
  // Running again never buys a second number.
  const again = await provisionSubscriptionNumber(db.pool, 7, deps(fetcher));
  assert.equal(again.status, 'active');
  assert.equal(calls.filter(c => c.includes('number_orders')).length, 1);
});

test('nothing is bought without payment, for Starter, without a route or without config', async () => {
  for (const [options, expected] of [[{ status: 'pending_payment' }, 'skipped'], [{ plan: 'starter' }, 'skipped'], [{ route: null }, 'unavailable'], [{ route: { provider: 'telnyx', mode: 'unavailable' } }, 'unavailable']]) {
    const db = fakeDb(options);
    const { fetcher, calls } = fakeProviders();
    const outcome = await provisionSubscriptionNumber(db.pool, 7, deps(fetcher));
    assert.equal(outcome.status, expected, JSON.stringify(options));
    assert.ok(!calls.some(c => c.includes('number_orders')));
  }
  const outcome = await provisionSubscriptionNumber(fakeDb().pool, 7, { ...deps(async () => { throw Error('no network'); }), vapiKey: '' });
  assert.equal(outcome.status, 'not_configured');
  assert.match(outcome.detail, /VAPI_API_KEY/);
});

test('too-expensive numbers are not bought; a refused order frees the slot', async () => {
  const pricey = fakeProviders({ numbers: [{ phone_number: '+12025550123', cost_information: { monthly_cost: '40.00', upfront_cost: '0', currency: 'USD' } }] });
  const db1 = fakeDb();
  assert.equal((await provisionSubscriptionNumber(db1.pool, 7, deps(pricey.fetcher))).status, 'unavailable');
  assert.equal(db1.numbers.length, 0);
  const refused = fakeProviders({ orderFails: true });
  const db2 = fakeDb();
  const outcome = await provisionSubscriptionNumber(db2.pool, 7, deps(refused.fetcher));
  assert.equal(outcome.status, 'failed');
  assert.equal(db2.numbers[0].status, 'failed');
  assert.equal(db2.numbers[0].subscription_restaurant_id, null, 'a later run may try again');
});

test('numbers waiting on documents finish later through the retry job', async () => {
  const db = fakeDb({ assistants: ['asst-new'] });
  const first = fakeProviders({ orderStatus: 'pending', laterStatus: 'pending' });
  const outcome = await provisionSubscriptionNumber(db.pool, 7, deps(first.fetcher));
  assert.equal(outcome.status, 'pending_provider');
  assert.equal(db.integrations.at(-1), 'pending');
  assert.deepEqual(await retryPendingSubscriptionNumbers(db.pool, deps(first.fetcher)).then(list => list.map(o => o.status)), ['pending_provider']);
  const later = fakeProviders({ laterStatus: 'success' });
  const done = await retryPendingSubscriptionNumbers(db.pool, deps(later.fetcher));
  assert.equal(done[0].status, 'active');
  assert.equal(db.numbers[0].status, 'active');
  assert.ok(!later.calls.some(c => c.startsWith('POST https://api.telnyx.com/v2/number_orders')), 'retry never buys');
});

test('assistant copy drops read-only fields and tags the restaurant', () => {
  const copy = assistantCopy({ id: 'a', orgId: 'o', createdAt: 'c', updatedAt: 'u', isServerUrlSecretSet: true, model: { m: 1 }, metadata: { keep: 'yes' } }, { name: 'MarKhoor 7 A very long restaurant name that goes on', restaurantId: 7 });
  assert.deepEqual(Object.keys(copy).sort(), ['metadata', 'model', 'name']);
  assert.equal(copy.name.length, 40);
  assert.deepEqual(copy.metadata, { keep: 'yes', markhoorRestaurantId: '7' });
});

test('super admin confirms payment and the AI number starts automatically', async () => {
  const { hashPassword, authRouter, useSessionStore } = await import('../src/auth.js');
  const { createMemorySessionStore, hashToken } = await import('../src/sessions.js');
  const store = createMemorySessionStore();
  await store.create(hashToken('f'.repeat(64)), { id: 1, email: 'admin@x.y', platformRole: 'super_admin' }, 3600);
  await store.create(hashToken('e'.repeat(64)), { id: 2, email: 'owner@x.y', platformRole: 'user' }, 3600);
  useSessionStore(store);
  process.env.SUPER_ADMIN_OWNER_EMAIL = 'admin@x.y';
  let status = 'pending_payment';
  const provisioned = [];
  const pool = { async execute(sql, args) {
    if (sql.startsWith('SELECT status FROM restaurant_subscriptions')) return [[{ status }]];
    if (sql.startsWith('UPDATE restaurant_subscriptions')) { if (args[2] !== status) return [{ affectedRows: 0 }]; status = args[0]; return [{ affectedRows: 1 }]; }
    return [{}];
  } };
  const app = express(); app.use(express.json());
  app.use('/api', plansRouter(pool, { provision: async (_pool, id) => { provisioned.push(id); return { status: 'active', detail: 'ok' }; } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const put = (token, body) => fetch(base + '/api/platform/subscriptions/7/status', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
  try {
    assert.equal((await put('e'.repeat(64), { status: 'active' })).status, 403, 'restaurant owners cannot confirm payment');
    assert.equal((await put('f'.repeat(64), { status: 'bogus' })).status, 400);
    const ok = await put('f'.repeat(64), { status: 'active' });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).voice.status, 'active');
    assert.deepEqual(provisioned, [7]);
    assert.equal((await put('f'.repeat(64), { status: 'active' })).status, 409, 'already active');
    assert.equal((await put('f'.repeat(64), { status: 'cancelled' })).status, 200);
    assert.deepEqual(provisioned, [7], 'cancelling buys nothing');
  } finally {
    await new Promise(r => server.close(r));
    useSessionStore(createMemorySessionStore());
    delete process.env.SUPER_ADMIN_OWNER_EMAIL;
    void hashPassword; void authRouter;
  }
});

test('the Telnyx credential is found in Vapi when VAPI_TELNYX_CREDENTIAL_ID is not set', async () => {
  const fetcher = async url => {
    assert.equal(url, 'https://api.vapi.ai/credential');
    return { ok: true, json: async () => [{ id: 'c-old', provider: 'telnyx', createdAt: '2026-01-01' }, { id: 'c-openai', provider: 'openai' }, { id: 'c-new', provider: 'telnyx', createdAt: '2026-11-19' }] };
  };
  assert.equal(await findTelnyxCredential({ apiKey: 'k', fetcher }), 'c-new');
  await assert.rejects(findTelnyxCredential({ apiKey: 'k', fetcher: async () => ({ ok: true, json: async () => [] }) }), /No Telnyx credential/);

  resetDiscoveredCredential();
  const db = fakeDb();
  const providers = fakeProviders();
  const lookups = [];
  const outcome = await provisionSubscriptionNumber(db.pool, 7, { ...deps(async (url, init) => {
    if (url === 'https://api.vapi.ai/credential') { lookups.push(url); return { ok: true, json: async () => [{ id: 'cred-found', provider: 'telnyx' }] }; }
    if (url === 'https://api.vapi.ai/phone-number') assert.equal(JSON.parse(init.body).credentialId, 'cred-found');
    return providers.fetcher(url, init);
  }), credentialId: undefined });
  assert.equal(outcome.status, 'active', outcome.detail);
  assert.equal(lookups.length, 1);
  resetDiscoveredCredential();
});
