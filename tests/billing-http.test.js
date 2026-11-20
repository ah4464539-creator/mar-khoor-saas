import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { useSessionStore } from '../src/auth.js';
import { createMemorySessionStore, hashToken } from '../src/sessions.js';
import { billingRouter, billingWebhookRouter } from '../src/billing.js';

const OWNER = 'a'.repeat(64), STRANGER = 'b'.repeat(64);

test('plan checkout and Stripe webhook over HTTP', async () => {
  const store = createMemorySessionStore();
  useSessionStore(store);
  await store.create(hashToken(OWNER), { id: 5, email: 'owner@x.pk', platformRole: 'user' }, 3600);
  await store.create(hashToken(STRANGER), { id: 6, email: 's@x.pk', platformRole: 'user' }, 3600);
  const writes = [];
  let status = 'pending_payment';
  const pool = {
    query: async () => [[]],
    execute: async (sql, args = []) => {
      if (/FROM restaurant_members/.test(sql)) return [args[1] === 5 ? [{ role: 'admin' }] : []];
      if (/SELECT id,name,currency FROM restaurants/.test(sql)) return [[{ id: 7, name: 'Lahore Grill', currency: 'USD' }]];
      if (/SELECT currency FROM restaurants/.test(sql)) return [[{ currency: 'USD' }]];
      if (/FROM restaurant_subscriptions/.test(sql)) return [[{ plan_key: 'starter', billing_cycle: 'monthly', status, limits: '{}', currency: 'USD', price_minor: 3900 }]];
      if (/FROM restaurant_billing/.test(sql)) return [[]];
      if (/FROM stripe_events/.test(sql)) return [[]];
      if (/audit_logs/.test(sql)) return [{}];
      writes.push(sql);
      if (/INSERT INTO restaurant_subscriptions/.test(sql) && /VALUES \(\?,\?,\?,'active'/.test(sql)) status = 'active';
      return [{ affectedRows: 1 }];
    },
  };
  const sessions = [];
  const stripe = { checkout: async (params, key) => { sessions.push({ params, key }); return { url: 'https://checkout.stripe.com/c/pay/cs_test_1' }; }, portal: async () => ({}), cancel: async () => {} };
  const config = { secretKey: 'sk_test_1', webhookSecret: 'whsec_test', live: false };
  const provisioned = [];
  const app = express();
  app.use(billingWebhookRouter(pool, { config, stripe, provision: async (_p, id) => provisioned.push(id) }));
  app.use(express.json());
  app.use(billingRouter(pool, { config, stripe, loadRates: async () => null, baseUrl: 'https://mar-khoor.com/' }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = (path, token, body) => fetch(base + path, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await post('/api/restaurants/7/billing/checkout', STRANGER, { plan: 'starter', billing_cycle: 'monthly' })).status, 403);
    assert.equal((await post('/api/restaurants/7/billing/checkout', OWNER, { plan: 'gold', billing_cycle: 'monthly' })).status, 400);
    const ok = await post('/api/restaurants/7/billing/checkout', OWNER, { plan: 'starter', billing_cycle: 'monthly', price_minor: 1 });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).url, 'https://checkout.stripe.com/c/pay/cs_test_1');
    assert.equal(sessions[0].params['line_items[0][price_data][unit_amount]'], '3900', 'client price is ignored');
    assert.equal(sessions[0].params.customer_email, 'owner@x.pk');
    assert.equal(sessions[0].params.cancel_url, 'https://mar-khoor.com/restaurant.html?billing=cancelled#plan');
    assert.equal(status, 'pending_payment', 'nothing is activated by starting checkout');

    const event = JSON.stringify({ id: 'evt_http', type: 'checkout.session.completed', data: { object: { mode: 'subscription', payment_status: 'paid', amount_total: 3900, currency: 'usd', customer: 'cus_1', subscription: 'sub_1',
      metadata: { restaurant_id: '7', plan: 'starter', cycle: 'monthly', price_minor: '3900', currency: 'USD' } } } });
    const forged = await fetch(base + '/webhooks/stripe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': 't=1,v1=' + '0'.repeat(64) }, body: event });
    assert.equal(forged.status, 400);
    assert.equal(status, 'pending_payment');
    const t = Math.floor(Date.now() / 1000);
    const signature = 't=' + t + ',v1=' + crypto.createHmac('sha256', 'whsec_test').update(t + '.' + event).digest('hex');
    const real = await fetch(base + '/webhooks/stripe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signature }, body: event });
    assert.equal(real.status, 200);
    assert.equal((await real.json()).result, 'activated');
    assert.equal(status, 'active');
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(provisioned, [7]);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
