import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import mysql from 'mysql2/promise';
import { normalizeLineNumber, newCredentials, forwardingCodes, connectOwnLine, ownLineConfig, OWN_LINE_SQL } from '../src/own-line.js';
import { processVapiEvent } from '../src/vapi-events.js';

test('any country number with its country code is accepted', () => {
  assert.equal(normalizeLineNumber('+92 300 1234567'), '+923001234567');
  assert.equal(normalizeLineNumber('00971 50 123 4567'), '+971501234567');
  assert.equal(normalizeLineNumber('+1 (415) 555-0100'), '+14155550100');
  assert.equal(normalizeLineNumber('+44 20 7946 0958'), '+442079460958');
  for (const bad of ['03001234567', '+0123', 'abc', '', null, '+1234567890123456']) assert.equal(normalizeLineNumber(bad), null, String(bad));
});

test('SIP credentials meet Vapi rules (20-40 characters, letters and digits only)', () => {
  const c = newCredentials(12345);
  assert.match(c.sipUser, /^mk12345line[a-z0-9]{10}$/);
  for (const v of [c.username, c.password]) { assert.ok(v.length >= 20 && v.length <= 40, v); assert.match(v, /^[A-Za-z0-9]+$/); }
  assert.notEqual(newCredentials(1).password, newCredentials(1).password);
});

test('forwarding codes point other phones to the business line', () => {
  assert.deepEqual(forwardingCodes('+923001234567'), { all: '**21*+923001234567#', busy: '**67*+923001234567#', no_answer: '**61*+923001234567#', unreachable: '**62*+923001234567#', off: '##21#', us_alternative: '*72+923001234567' });
  assert.equal(forwardingCodes('+14155550100').us_alternative, '*724155550100');
  assert.equal(forwardingCodes('nope'), null);
});

test('connect validates input and refuses when the server is not configured', async () => {
  const pool = { async execute() { throw Error('no DB needed'); } };
  assert.equal((await connectOwnLine(pool, 1, { phone_number: '0300', line_type: 'sim' }, { env: {} })).status, 400);
  assert.equal((await connectOwnLine(pool, 1, { phone_number: '+923001234567', line_type: 'fax' }, { env: {} })).status, 400);
  const missing = await connectOwnLine(pool, 1, { phone_number: '+923001234567', line_type: 'sim' }, { env: {} });
  assert.equal(missing.status, 503);
  assert.match(missing.body.error, /VAPI_API_KEY/);
  assert.deepEqual(ownLineConfig({ VAPI_API_KEY: 'k', VAPI_TEMPLATE_ASSISTANT_ID: 't', META_APP_SECRET: 's' }).missing, []);
});

test('dashboard card, routes and migration are wired', () => {
  assert.match(readFileSync('public/restaurant.html', 'utf8'), /id="own-line-card"/);
  assert.match(readFileSync('public/restaurant.js', 'utf8'), /mkOwnLine\?\.init/);
  assert.doesNotMatch(readFileSync('public/own-line.js', 'utf8'), /innerHTML/);
  assert.match(readFileSync('src/server.js', 'utf8'), /app\.use\(ownLineRouter\(pool\)\)/);
  assert.ok(readFileSync('db/migrations/2026-11-27-own-line.sql', 'utf8').includes(OWN_LINE_SQL));
});

const enabled = process.env.DB_INTEGRATION_TEST === '1';
test('own line on MariaDB: create on Vapi, password sealed, first call connects, reset, remove', { skip: !enabled }, async () => {
  const pool = mysql.createPool({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectionLimit: 3 });
  const env = { VAPI_API_KEY: 'vapi-test', VAPI_TEMPLATE_ASSISTANT_ID: 'tmpl-1', META_APP_SECRET: 'seal-test-secret' };
  const tag = 'own' + process.pid + Date.now(), assistant = 'asst-' + tag;
  const calls = [];
  const fetcher = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    if (options.method === 'POST' && url.endsWith('/phone-number')) return { ok: true, json: async () => ({ id: 'pn-' + tag }) };
    return { ok: true, json: async () => ({}) };
  };
  let restaurantId;
  try {
    const [r] = await pool.execute("INSERT INTO restaurants(name,slug,country_code,currency,locale) VALUES ('Own Line Cafe',?,'AE','AED','en')", [tag]);
    restaurantId = r.insertId;
    await pool.execute('INSERT INTO voice_assistants(assistant_id,restaurant_id,active) VALUES (?,?,1)', [assistant, restaurantId]);

    const created = await connectOwnLine(pool, restaurantId, { phone_number: '+971 50 123 4567', line_type: 'sim' }, { env, fetcher });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const post = calls.find(c => c.method === 'POST');
    assert.equal(post.body.provider, 'vapi');
    assert.equal(post.body.assistantId, assistant);
    assert.match(post.body.sipUri, new RegExp('^sip:mk' + restaurantId + 'line[a-z0-9]{10}@sip\\.vapi\\.ai$'));
    assert.ok(post.body.authentication.username.length >= 20 && post.body.authentication.password.length >= 20, 'always password-protected');
    const line = created.body.line;
    assert.equal(line.status, 'waiting_call');
    assert.equal(line.settings.password, post.body.authentication.password, 'owner sees the password for the device');
    assert.equal(line.forwarding.all, '**21*+971501234567#');
    const [[row]] = await pool.execute('SELECT sip_password_enc FROM restaurant_own_lines WHERE restaurant_id=?', [restaurantId]);
    assert.ok(!row.sip_password_enc.includes(post.body.authentication.password), 'password is stored encrypted');

    // Changing the number keeps the same SIP address and password (no second Vapi line).
    calls.length = 0;
    const updated = await connectOwnLine(pool, restaurantId, { phone_number: '+971501234568', line_type: 'landline' }, { env, fetcher });
    assert.equal(updated.status, 200);
    assert.deepEqual(calls.map(c => c.method), ['PATCH']);
    assert.equal(updated.body.line.settings.password, line.settings.password);
    assert.equal(updated.body.line.line_type, 'landline');

    // The first call on the line (Vapi event with its phoneNumberId) marks it connected.
    await processVapiEvent(pool, { message: { type: 'status-update', status: 'in-progress', call: { id: 'call-' + tag, assistantId: assistant, phoneNumberId: 'pn-' + tag } } });
    const [[after]] = await pool.execute('SELECT status,first_call_at FROM restaurant_own_lines WHERE restaurant_id=?', [restaurantId]);
    assert.equal(after.status, 'connected');
    assert.ok(after.first_call_at);

    const { resetOwnLinePassword, removeOwnLine } = await import('../src/own-line.js');
    calls.length = 0;
    const reset = await resetOwnLinePassword(pool, restaurantId, { env, fetcher });
    assert.notEqual(reset.body.line.settings.password, line.settings.password);
    assert.equal(calls[0].body.authentication.password, reset.body.line.settings.password);
    assert.equal(reset.body.line.settings.username, line.settings.username, 'username stays the same on a password reset');
    assert.equal(calls[0].body.authentication.username, line.settings.username);
    calls.length = 0;
    assert.deepEqual((await removeOwnLine(pool, restaurantId, { env, fetcher })).body, { removed: true });
    assert.deepEqual(calls.map(c => c.method + ' ' + c.url.replace('https://api.vapi.ai', '')), ['DELETE /phone-number/pn-' + tag]);
  } finally {
    if (restaurantId) {
      for (const sql of ['DELETE FROM voice_calls WHERE restaurant_id=?', 'DELETE FROM restaurant_own_lines WHERE restaurant_id=?', 'DELETE FROM voice_assistants WHERE restaurant_id=?', 'DELETE FROM restaurants WHERE id=?'])
        await pool.execute(sql, [restaurantId]).catch(() => {});
    }
    await pool.end();
  }
});
