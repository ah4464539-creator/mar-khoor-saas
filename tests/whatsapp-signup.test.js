import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { seal, open, completeSignup, tokenForNumber, saveSignupConfig, getSignupConfig } from '../src/whatsapp-signup-core.js';

const env = { META_APP_SECRET: 'app-secret-123', WHATSAPP_GRAPH_VERSION: 'v23.0', WHATSAPP_ACCESS_TOKEN: 'platform-token' };

const fakePool = (taken = []) => {
  const calls = []; const tokens = new Map(); const settings = new Map();
  const run = async (sql, params = []) => {
    calls.push([sql.slice(0, 60), params]);
    if (sql.startsWith('SELECT restaurant_id FROM whatsapp_numbers')) return [taken];
    if (sql.startsWith('INSERT INTO whatsapp_business_tokens')) tokens.set(params[0], params[3]);
    if (sql.startsWith('SELECT token_enc')) return [tokens.has(params[0]) ? [{ token_enc: tokens.get(params[0]) }] : []];
    if (sql.startsWith('INSERT INTO app_settings')) settings.set(params[0], params[1]);
    if (sql.startsWith('SELECT setting_value')) return [settings.has(params[0]) ? [{ setting_value: settings.get(params[0]) }] : []];
    return [[]];
  };
  return { calls, tokens, query: run, execute: run };
};

test('tokens are encrypted at rest and can be read back', () => {
  const sealed = seal('EAAG-secret-token', env);
  assert.ok(!sealed.includes('EAAG'));
  assert.equal(open(sealed, env), 'EAAG-secret-token');
  assert.throws(() => open(sealed, { META_APP_SECRET: 'other' }));
});

test('signup: exchange code, subscribe WABA, register number, link to restaurant', async () => {
  const pool = fakePool();
  const urls = [];
  const fetcher = async (url, options = {}) => {
    urls.push([options.method || 'GET', url.replace(/client_secret=[^&]+/, 'client_secret=***'), options.headers?.Authorization || '']);
    const body = url.includes('oauth/access_token') ? { access_token: 'EAAG-business-token-xyz' }
      : url.includes('?fields=') ? { display_phone_number: '+92 300 1234567', verified_name: 'Urban Cafe' } : { success: true };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
  const result = await completeSignup(pool, 4, { code: 'AQBcode-1234567890', waba_id: '2191752318117550', phone_number_id: '1488585814336543' }, { env, fetcher, config: { app_id: '1150293877653737', config_id: '99999' } });
  assert.deepEqual(result, { connected: true, registered: true, register_error: null, display_phone_number: '+92 300 1234567', verified_name: 'Urban Cafe' });
  assert.match(urls[0][1], /oauth\/access_token\?client_id=1150293877653737&client_secret=\*\*\*&code=AQBcode/);
  assert.deepEqual(urls.slice(1).map(u => [u[0], u[1].split('/v23.0/')[1], u[2]]), [
    ['POST', '2191752318117550/subscribed_apps', 'Bearer EAAG-business-token-xyz'],
    ['POST', '1488585814336543/register', 'Bearer EAAG-business-token-xyz'],
    ['GET', '1488585814336543?fields=display_phone_number,verified_name', 'Bearer EAAG-business-token-xyz'],
  ]);
  assert.ok(pool.calls.some(c => c[0].startsWith('INSERT INTO whatsapp_numbers') && c[1][1] === 4));
  assert.ok(pool.calls.some(c => c[0].startsWith('INSERT INTO whatsapp_ai_settings')));
  assert.equal(await tokenForNumber(pool, '1488585814336543', env), 'EAAG-business-token-xyz');
  assert.equal(await tokenForNumber(pool, '555', env), 'platform-token');
});

test('signup refuses a number that belongs to another restaurant, and bad input', async () => {
  const fetcher = async () => { throw Error('must not call Meta'); };
  await assert.rejects(completeSignup(fakePool([{ restaurant_id: 9 }]), 4, { code: 'AQBcode-1234567890', waba_id: '12345', phone_number_id: '67890' }, { env, fetcher, config: { app_id: '11111' } }), /another restaurant/);
  await assert.rejects(completeSignup(fakePool(), 4, { code: 'x', waba_id: '12345', phone_number_id: '67890' }, { env, fetcher, config: { app_id: '11111' } }), /try again/);
});

test('super admin saves the public launch settings; dashboard has the button', async () => {
  const pool = fakePool();
  await assert.rejects(saveSignupConfig(pool, { app_id: 'abc', config_id: '1' }), /must be numbers/);
  assert.deepEqual(await saveSignupConfig(pool, { app_id: '1150293877653737', config_id: '123456789' }), { app_id: '1150293877653737', config_id: '123456789' });
  assert.deepEqual(await getSignupConfig(pool), { app_id: '1150293877653737', config_id: '123456789' });
  const page = readFileSync('public/restaurant.html', 'utf8');
  assert.equal((page.match(/data-wa-connect/g) || []).length, 2);
  assert.match(page, /\/whatsapp-connect\.js\?v=/);
  const client = readFileSync('public/whatsapp-connect.js', 'utf8');
  assert.match(client, /response_type: 'code', override_default_response_type: true/);
  assert.match(client, /WA_EMBEDDED_SIGNUP/);
  assert.match(client, /facebook\\\.com\$/);
  assert.ok(!/innerHTML/.test(client));
});
