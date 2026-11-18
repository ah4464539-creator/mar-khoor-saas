import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { onboardingRouter } from '../src/onboarding.js';
import { authRouter, hashPassword } from '../src/auth.js';

test('onboarding API requires login, enforces restaurant membership and scopes every query', async () => {
  const password = 'onboarding-test-password', hash = await hashPassword(password), queries = [];
  const subs = new Map(), integrations = new Map();
  const pool = {
    async execute(sql, args) {
      queries.push({ sql, args });
      if (sql.includes('FROM users WHERE email=?')) return [[{ id: 3, email: 'owner@example.com', password_hash: hash, platform_role: 'user' }]];
      if (sql.includes('FROM restaurant_members')) return args[0] === 9 ? [[{ role: 'admin' }]] : [[]];
      if (sql.startsWith('SELECT currency FROM restaurants')) return [[{ currency: 'PKR' }]];
      if (sql.startsWith('INSERT INTO restaurant_subscriptions')) { subs.set(args[0], { plan_key: args[1], billing_cycle: args[2], status: 'pending_payment', limits: args[3], currency: args[4], price_minor: args[5] }); return [{}]; }
      if (sql.startsWith('SELECT plan_key')) return [subs.has(args[0]) ? [subs.get(args[0])] : []];
      if (sql.startsWith('SELECT metric,used')) return [[]];
      if (sql.startsWith('INSERT INTO restaurant_integrations')) { integrations.set(args[1], { kind: args[1], mode: args[2], value: args[3], status: args[4], detail: null }); return [{}]; }
      if (sql.startsWith('SELECT kind,mode')) return [[...integrations.values()]];
      if (sql.startsWith('UPDATE restaurant_integrations')) { Object.assign(integrations.get(args[3]), { status: args[0], detail: args[1] }); return [{}]; }
      if (sql.startsWith('SELECT published FROM restaurant_sites')) return [[]];
      if (sql.startsWith('SELECT phone_number_id FROM whatsapp_numbers')) return [[]];
      if (sql.startsWith('SELECT slug FROM restaurants')) return [[{ slug: 'cafe-nine' }]];
      if (sql.startsWith('INSERT INTO restaurant_setup') || sql.startsWith('INSERT INTO audit_logs')) return [{}];
      throw Error('Unexpected SQL: ' + sql);
    },
  };
  const app = express(); app.use(express.json()); app.use('/auth', authRouter(pool)); app.use('/api', onboardingRouter(pool, { assignVoiceNumber: async () => ({ status: 'pending' }) }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const json = (method, body) => ({ method, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let headers = {};
  try {
    assert.equal((await fetch(base + '/api/restaurants/9/subscription')).status, 401);
    const login = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'owner@example.com', password }) });
    headers = { Authorization: 'Bearer ' + (await login.json()).token };

    for (const path of ['/subscription', '/usage', '/integrations']) assert.equal((await fetch(base + '/api/restaurants/10' + path, { headers })).status, 403);
    assert.equal((await fetch(base + '/api/restaurants/10/subscription', json('PUT', { plan: 'starter', billing_cycle: 'monthly' }))).status, 403);
    assert.equal((await fetch(base + '/api/restaurants/10/integrations/finish', { method: 'POST', headers })).status, 403);

    const plans = await (await fetch(base + '/api/restaurants/9/subscription', { headers })).json();
    assert.deepEqual(plans.plans.map(p => p.key), ['starter', 'premium', 'enterprise']);
    assert.equal(plans.subscription, null);

    const chosen = await fetch(base + '/api/restaurants/9/subscription', json('PUT', { plan: 'premium', billing_cycle: 'yearly' }));
    assert.equal(chosen.status, 200);
    assert.equal((await chosen.json()).subscription.plan, 'premium');
    assert.equal((await fetch(base + '/api/restaurants/9/subscription', json('PUT', { plan: 'free', billing_cycle: 'yearly' }))).status, 400);

    const usage = await (await fetch(base + '/api/restaurants/9/usage', { headers })).json();
    assert.equal(usage.usage.length, 3);

    assert.equal((await fetch(base + '/api/restaurants/9/integrations', json('PUT', { whatsapp: { mode: 'meta_signup', value: 'bad' } }))).status, 400);
    assert.equal((await fetch(base + '/api/restaurants/9/integrations', json('PUT', { whatsapp: { mode: 'meta_signup', value: '+923001234567' }, ai_caller: { skip: true }, website: { mode: 'builder' } }))).status, 200);
    const finished = await (await fetch(base + '/api/restaurants/9/integrations/finish', { method: 'POST', headers })).json();
    assert.deepEqual(finished.integrations.map(i => [i.kind, i.status]), [['whatsapp', 'pending'], ['ai_caller', 'skipped'], ['website', 'pending']]);

    const scoped = queries.filter(q => /restaurant_subscriptions|usage_counters|restaurant_integrations/.test(q.sql));
    assert.ok(scoped.length > 0);
    for (const q of scoped) assert.ok(q.args.includes(9) && !q.args.includes(10), q.sql);
  } finally { await new Promise(r => server.close(r)); }
});
