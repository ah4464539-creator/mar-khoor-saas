import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { splitPhone, cleanDisplayName, friendly, platformWaba, startNumber, verifyNumber } from '../src/whatsapp-number-onboarding.js';

test('phone numbers split into country code and number', () => {
  assert.deepEqual(splitPhone('+92 300 1234567'), { cc: '92', number: '3001234567', e164: '+923001234567' });
  assert.deepEqual(splitPhone('+1 (555) 156-0265'), { cc: '1', number: '5551560265', e164: '+15551560265' });
  assert.deepEqual(splitPhone('+971 50 123 4567'), { cc: '971', number: '501234567', e164: '+971501234567' });
  assert.deepEqual(splitPhone('0030 694 123 4567'), { cc: '30', number: '6941234567', e164: '+306941234567' });
  assert.equal(splitPhone('12345'), null);
  assert.equal(splitPhone('call me'), null);
});

test('display names follow Meta basics', () => {
  assert.equal(cleanDisplayName('  Urban   Cafe ').value, 'Urban Cafe');
  for (const bad of ['ab', 'www.cafe.com', 'Cafe WhatsApp', '12345']) assert.ok(cleanDisplayName(bad).error, bad);
});

test('Meta errors become plain advice', () => {
  assert.match(friendly({ message: 'Phone number is already registered with WhatsApp' }), /Delete account/);
  assert.match(friendly({ code: 136025, message: 'x' }), /code is not correct/);
  assert.match(friendly({ message: 'Too many requests' }), /wait a few minutes/);
});

test('platform WABA: env first, else from the token scopes', async () => {
  assert.equal(await platformWaba({ env: { WHATSAPP_WABA_ID: '2191752318117550' } }), '2191752318117550');
  const fetcher = async url => { assert.match(url, /debug_token/); return { ok: true, json: async () => ({ data: { granular_scopes: [{ scope: 'whatsapp_business_management', target_ids: ['555666777'] }] } }) }; };
  assert.equal(await platformWaba({ env: { WHATSAPP_ACCESS_TOKEN: 't' }, fetcher }), '555666777');
});

function memoryPool() {
  const rows = [], numbers = [], log = [];
  return { rows, numbers, log, async query() { return [[]]; }, async execute(sql, p) {
    log.push(sql.slice(0, 40));
    if (sql.startsWith('SELECT w.restaurant_id FROM whatsapp_numbers w JOIN')) return [[]];
    if (sql.startsWith('SELECT restaurant_id FROM whatsapp_numbers')) return [numbers.filter(n => n.id === p[0])];
    if (sql.startsWith('INSERT INTO whatsapp_number_onboarding')) { rows.push({ id: 1, restaurant_id: p[0], phone_number_id: p[1], display_phone: p[3], display_name: p[4], status: 'code_sent', attempts: 0 }); return [{}]; }
    if (sql.startsWith('SELECT id,phone_number_id,display_phone')) return [rows.filter(r => r.restaurant_id === p[0] && ['code_sent', 'verified'].includes(r.status))];
    if (sql.startsWith("UPDATE whatsapp_number_onboarding SET status='verified'")) { rows[0].status = 'verified'; return [{}]; }
    if (sql.startsWith("UPDATE whatsapp_number_onboarding SET status='registered'")) { rows[0].status = 'registered'; return [{}]; }
    if (sql.startsWith('UPDATE whatsapp_number_onboarding SET attempts')) { rows[0].attempts++; return [{}]; }
    if (sql.startsWith('INSERT INTO whatsapp_numbers')) { numbers.push({ id: p[0], restaurant_id: p[1] }); return [{}]; }
    return [{}];
  } };
}

test('number + code: add to WABA, send code, verify, register, link with AI on', async () => {
  const env = { WHATSAPP_ACCESS_TOKEN: 't', WHATSAPP_WABA_ID: '999888777', DATA_ENCRYPTION_KEY: 'k' };
  const calls = [];
  let codeOk = false;
  const fetcher = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null; calls.push({ url, body });
    if (url.endsWith('/999888777/phone_numbers')) return { ok: true, json: async () => ({ id: '123456789' }) };
    if (url.endsWith('/verify_code')) return codeOk ? { ok: true, json: async () => ({ success: true }) } : { ok: false, json: async () => ({ error: { code: 136025, message: 'invalid code' } }) };
    return { ok: true, json: async () => ({ success: true }) };
  };
  const pool = memoryPool();
  const start = await startNumber(pool, 4, { phone: '+92 300 1234567', display_name: 'Urban Cafe', method: 'SMS' }, { env, fetcher });
  assert.equal(start.status, 200);
  assert.deepEqual(calls[0].body, { cc: '92', phone_number: '3001234567', verified_name: 'Urban Cafe' });
  assert.deepEqual(calls[1].body, { code_method: 'SMS', language: 'en_US' });
  assert.equal((await verifyNumber(pool, 4, { code: '12' }, { env, fetcher })).status, 400);
  const wrong = await verifyNumber(pool, 4, { code: '123456' }, { env, fetcher });
  assert.match(wrong.body.error, /not correct/);
  assert.equal(pool.rows[0].attempts, 1);
  codeOk = true;
  const ok = await verifyNumber(pool, 4, { code: '123456' }, { env, fetcher });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.phone, '+923001234567');
  assert.ok(calls.some(c => c.url.endsWith('/123456789/register') && /^[0-9]{6}$/.test(c.body.pin)));
  assert.deepEqual(pool.numbers, [{ id: '123456789', restaurant_id: 4 }]);
  assert.ok(pool.log.some(l => l.startsWith('INSERT INTO whatsapp_ai_settings')));
  assert.equal((await startNumber(pool, 5, { phone: '+92 300 1234567', display_name: 'Other' }, { env, fetcher })).status, 409, 'cannot take another restaurant number');
});

test('setup and inbox boxes show the number + code form', () => {
  const js = readFileSync('public/whatsapp-connect.js', 'utf8');
  assert.match(js, /whatsapp\/number\/start/);
  assert.match(js, /whatsapp\/number\/verify/);
  assert.match(js, /one-time-code/);
  assert.match(readFileSync('src/operations.js', 'utf8'), /number_code:\{available/);
});
