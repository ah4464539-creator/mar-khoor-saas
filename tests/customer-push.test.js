import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { subscribeOrder, orderStatusMessage, pushToCustomer, notifyCustomerOrderStatus } from '../src/customer-push.js';
import { hashTrackingToken } from '../src/order-tracking.js';

const TOKEN = 'a'.repeat(48);
const browserSub = () => {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  return { endpoint: 'https://fcm.googleapis.com/fcm/send/abc' + crypto.randomBytes(4).toString('hex'), keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } };
};

function fakePool({ orders = [{ id: 12, restaurant_id: 3, token_hash: hashTrackingToken(TOKEN) }] } = {}) {
  const subs = [];
  const settings = new Map();
  let nextId = 1;
  return {
    subs,
    async query(sql, params) {
      if (/SELECT setting_value FROM app_settings/.test(sql)) return [settings.has('web_push_vapid') ? [{ setting_value: settings.get('web_push_vapid') }] : []];
      if (/INSERT INTO app_settings/.test(sql)) { if (!settings.has(params[0] ?? 'web_push_vapid')) settings.set('web_push_vapid', params[0]); return [{}]; }
      return [[]];
    },
    async execute(sql, params) {
      if (/FROM orders o JOIN order_tracking/.test(sql)) return [orders.filter(o => o.id === params[0] && o.token_hash === params[1]).map(o => ({ restaurant_id: o.restaurant_id }))];
      if (/SELECT COUNT\(\*\) AS n FROM customer_push_subscriptions WHERE kind='order' AND ref_id=\? AND endpoint_hash/.test(sql)) return [[{ n: subs.filter(s => s.ref_id === params[0] && s.endpoint_hash === params[1]).length }]];
      if (/SELECT COUNT\(\*\) AS n FROM customer_push_subscriptions/.test(sql)) return [[{ n: subs.filter(s => s.ref_id === params[0]).length }]];
      if (/INSERT INTO customer_push_subscriptions/.test(sql)) {
        const [restaurant_id, ref_id, endpoint, endpoint_hash, p256dh, auth] = params;
        const same = subs.find(s => s.ref_id === ref_id && s.endpoint_hash === endpoint_hash);
        if (same) Object.assign(same, { p256dh, auth }); else subs.push({ id: nextId++, restaurant_id, kind: 'order', ref_id, endpoint, endpoint_hash, p256dh, auth });
        return [{ affectedRows: 1 }];
      }
      if (/SELECT id,endpoint,p256dh,auth FROM customer_push_subscriptions/.test(sql)) return [subs.filter(s => s.kind === params[0] && s.ref_id === params[1])];
      if (/DELETE FROM customer_push_subscriptions/.test(sql)) { const i = subs.findIndex(s => s.id === params[0]); if (i >= 0) subs.splice(i, 1); return [{}]; }
      if (/SELECT name FROM restaurants/.test(sql)) return [[{ name: 'Urban Cafe' }]];
      return [[]];
    },
  };
}
const env = { DATA_ENCRYPTION_KEY: 'k'.repeat(64) };

test('only the person holding the tracking token can turn on notifications for an order', async () => {
  const pool = fakePool();
  assert.equal((await subscribeOrder(pool, 12, 'b'.repeat(48), browserSub())).status, 404);
  assert.equal((await subscribeOrder(pool, 12, 'short', browserSub())).status, 404);
  assert.equal((await subscribeOrder(pool, 12, TOKEN, { endpoint: 'https://evil.example/x', keys: {} })).status, 400);
  const sub = browserSub();
  assert.equal((await subscribeOrder(pool, 12, TOKEN, sub)).status, 200);
  assert.equal((await subscribeOrder(pool, 12, TOKEN, sub)).status, 200, 'same device again is fine');
  assert.equal(pool.subs.length, 1);
  assert.equal(pool.subs[0].restaurant_id, 3);
  for (let i = 0; i < 4; i++) await subscribeOrder(pool, 12, TOKEN, browserSub());
  assert.equal((await subscribeOrder(pool, 12, TOKEN, browserSub())).status, 409, 'at most 5 devices per order');
});

test('status messages name the order and the business, and open My orders', () => {
  assert.deepEqual(orderStatusMessage(12, 'ready', 'Urban Cafe'), { title: '🛍️ Order #12 is ready', body: 'Your order from Urban Cafe is ready.', url: '/orders.html', tag: 'mk-order-12' });
  assert.equal(orderStatusMessage(12, 'pending', 'X'), null);
  assert.match(orderStatusMessage(5, 'cancelled', 'X').title, /cancelled/);
});

test('a status change is pushed (encrypted) to the order\'s devices; gone devices are removed', async () => {
  const pool = fakePool();
  await subscribeOrder(pool, 12, TOKEN, browserSub());
  await subscribeOrder(pool, 12, TOKEN, browserSub());
  const calls = [];
  let n = 0;
  const fetcher = async (url, options) => { calls.push({ url, options }); return { ok: n++ === 0, status: n === 1 ? 201 : 410 }; };
  const result = await notifyCustomerOrderStatus(pool, 3, 12, 'ready', { fetcher, env, log: { warn() {} } });
  assert.equal(result.sent, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers['Content-Encoding'], 'aes128gcm');
  assert.match(calls[0].options.headers.Authorization, /^vapid t=/);
  assert.ok(!Buffer.from(calls[0].options.body).toString().includes('ready'), 'payload is encrypted');
  assert.equal(pool.subs.length, 1, 'the 410 device was removed');
  assert.deepEqual(await pushToCustomer(pool, 'order', 99, { title: 'x' }, { fetcher, env, log: { warn() {} } }), { sent: 0 });
});

test('owner status change notifies customers; tracking page offers "Notify me"', () => {
  assert.match(readFileSync('src/operations.js', 'utf8'), /notifyCustomerOrderStatus\(pool,req\.restaurantId,id,status\)/);
  assert.match(readFileSync('public/track.html', 'utf8'), /id="track-notify-btn"/);
  const js = readFileSync('public/track.js', 'utf8');
  assert.match(js, /\/api\/public\/orders\/' \+ id \+ '\/notifications/);
  assert.match(js, /'X-Tracking-Token': token/);
  assert.match(readFileSync('db/migrations/2026-11-28-customer-push.sql', 'utf8'), /CREATE TABLE IF NOT EXISTS customer_push_subscriptions/);
});
