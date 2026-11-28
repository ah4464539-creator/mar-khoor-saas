import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cleanEmail, requestLogin, completeLogin, customerFromSession, syncOrders, linkBooking, listBookings, logout } from '../src/customer-accounts.js';
import { hashTrackingToken } from '../src/order-tracking.js';

const env = { DATA_ENCRYPTION_KEY: 'k'.repeat(64) };
const sha = v => crypto.createHash('sha256').update(String(v)).digest('hex');

// Small in-memory stand-in for the tables this module uses.
function fakePool() {
  const db = { links: [], accounts: [], sessions: [], orders: [], tracking: [], custOrders: [], custBookings: [], bookings: [] };
  let accountId = 1;
  const pool = {
    db,
    async query() { return [[]]; },
    async execute(sql, p = []) {
      if (/COUNT\(\*\) AS n FROM customer_login_links/.test(sql)) return [[{ n: db.links.filter(l => l.email === p[0]).length }]];
      if (/INSERT INTO customer_login_links/.test(sql)) { db.links.push({ token_hash: p[0], email: p[1], used: false, expired: false }); return [{}]; }
      if (/UPDATE customer_login_links SET used_at/.test(sql)) { const l = db.links.find(x => x.token_hash === p[0] && !x.used && !x.expired); if (l) l.used = true; return [{ affectedRows: l ? 1 : 0 }]; }
      if (/SELECT email FROM customer_login_links/.test(sql)) return [[db.links.find(x => x.token_hash === p[0])]];
      if (/INSERT INTO customer_accounts/.test(sql)) { if (!db.accounts.some(a => a.email === p[0])) db.accounts.push({ id: accountId++, email: p[0] }); return [{}]; }
      if (/SELECT id,email FROM customer_accounts/.test(sql)) return [[db.accounts.find(a => a.email === p[0])]];
      if (/INSERT INTO customer_sessions/.test(sql)) { db.sessions.push({ token_hash: p[0], account_id: p[1] }); return [{}]; }
      if (/FROM customer_sessions s JOIN customer_accounts/.test(sql)) { const s = db.sessions.find(x => x.token_hash === p[0]); return [[s && db.accounts.find(a => a.id === s.account_id)].filter(Boolean)]; }
      if (/DELETE FROM customer_sessions/.test(sql)) { db.sessions = db.sessions.filter(s => s.token_hash !== p[0]); return [{}]; }
      if (/SELECT order_id FROM order_tracking/.test(sql)) return [db.tracking.filter(t => t.order_id === p[0] && t.token_hash === p[1])];
      if (/INSERT INTO customer_orders/.test(sql)) { if (!db.custOrders.some(c => c.account_id === p[0] && c.order_id === p[1])) db.custOrders.push({ account_id: p[0], order_id: p[1], token_enc: p[2] }); return [{}]; }
      if (/FROM customer_orders c/.test(sql)) return [db.custOrders.filter(c => c.account_id === p[0]).map(c => ({ ...c, restaurant: 'Urban Cafe', slug: 'urban-cafe', currency: 'PKR', total_minor: 180000, created_at: new Date('2026-11-28T10:00:00Z') }))];
      if (/INSERT INTO customer_bookings/.test(sql)) { db.custBookings.push({ account_id: p[0], booking_id: p[1], restaurant_id: p[2] }); return [{}]; }
      if (/FROM customer_bookings c/.test(sql)) return [db.custBookings.filter(c => c.account_id === p[0]).map(c => ({ id: c.booking_id, start_at: '2026-11-29 17:00', end_at: '2026-11-29 17:30', status: 'confirmed', guests: 1, price_minor: 250000, business: 'Cheema Clinic', slug: 'cheema-clinic', currency: 'PKR', service: 'Checkup' }))];
      throw new Error('unexpected SQL: ' + sql);
    },
  };
  return pool;
}

async function signIn(pool, email = 'Ali@Example.com') {
  const mails = [];
  const r = await requestLogin(pool, { email }, { sendMail: async m => mails.push(m), origin: 'https://mar-khoor.com' });
  assert.equal(r.status, 200);
  const token = mails[0].text.match(/#login=([a-f0-9]{64})/)[1];
  const done = await completeLogin(pool, { token });
  assert.equal(done.status, 200);
  return { session: done.body.session, token, mails };
}

test('email sign-in link: one use, lower-cased email, no password', async () => {
  assert.equal(cleanEmail(' Ali@Example.COM '), 'ali@example.com');
  assert.equal(cleanEmail('not-an-email'), null);
  const pool = fakePool();
  const { session, token, mails } = await signIn(pool);
  assert.match(mails[0].text, /https:\/\/mar-khoor\.com\/account\.html#login=/);
  assert.equal(mails[0].to, 'ali@example.com');
  assert.ok(!pool.db.links.some(l => l.token_hash === token), 'only the hash is stored');
  assert.equal((await completeLogin(pool, { token })).status, 410, 'a link works once');
  assert.deepEqual(await customerFromSession(pool, session), { id: 1, email: 'ali@example.com' });
  assert.equal(await customerFromSession(pool, 'x'.repeat(64)), null);
  await logout(pool, session);
  assert.equal(await customerFromSession(pool, session), null);
});

test('sign-in requests never reveal accounts and are limited per email', async () => {
  const pool = fakePool();
  const sendMail = async () => {};
  assert.equal((await requestLogin(pool, { email: 'bad' }, { sendMail, origin: 'https://mar-khoor.com' })).status, 400);
  assert.equal((await requestLogin(pool, { email: 'a@b.co' }, { sendMail: null, origin: 'https://mar-khoor.com' })).status, 503);
  for (let i = 0; i < 5; i++) assert.deepEqual((await requestLogin(pool, { email: 'a@b.co' }, { sendMail, origin: 'https://mar-khoor.com' })).body, { sent: true });
  assert.equal(pool.db.links.length, 3, 'at most 3 links per 15 minutes');
});

test('orders from this phone are added only with their tracking token, and come back on another phone', async () => {
  const pool = fakePool();
  const good = 'c'.repeat(48);
  pool.db.tracking.push({ order_id: 7, token_hash: hashTrackingToken(good) });
  const { session } = await signIn(pool);
  const account = await customerFromSession(pool, session);
  await syncOrders(pool, account, { orders: [{ id: 7, token: good }, { id: 8, token: 'd'.repeat(48) }, { id: 'x', token: good }] }, env);
  assert.equal(pool.db.custOrders.length, 1, 'order 8 has no valid token');
  assert.notEqual(pool.db.custOrders[0].token_enc, good, 'tracking token stored encrypted');
  const other = await syncOrders(pool, account, { orders: [] }, env);
  assert.deepEqual(other.body.orders, [{ id: 7, token: good, restaurant: 'Urban Cafe', slug: 'urban-cafe', currency: 'PKR', totalMinor: 180000, placedAt: '2026-11-28T10:00:00.000Z' }]);
});

test('bookings made while signed in are listed in the account', async () => {
  const pool = fakePool();
  const { session } = await signIn(pool);
  const account = await customerFromSession(pool, session);
  await linkBooking(pool, null, 3, 5);
  await linkBooking(pool, account, 3, 5);
  const { body } = await listBookings(pool, account);
  assert.equal(body.bookings.length, 1);
  assert.deepEqual([body.bookings[0].service, body.bookings[0].url, body.bookings[0].status], ['Checkup', '/r/cheema-clinic', 'confirmed']);
});

test('wiring: routes, booking link, app pages and migration', () => {
  const server = readFileSync('src/server.js', 'utf8');
  assert.match(server, /app\.use\(customerAccountRouter\(pool\)\)/);
  assert.match(readFileSync('src/bookings-routes.js', 'utf8'), /linkBooking\(pool, account, req\.business\.id, result\.booking\.id\)/);
  assert.match(readFileSync('public/account.js', 'utf8'), /history\.replaceState\(null, '', location\.pathname\)/);
  assert.match(readFileSync('public/book.js', 'utf8'), /'X-Customer-Session': session/);
  assert.match(readFileSync('db/migrations/2026-11-28-customer-accounts.sql', 'utf8'), /CREATE TABLE IF NOT EXISTS customer_sessions/);
  assert.ok(!/innerHTML/.test(readFileSync('public/account.js', 'utf8')));
});
