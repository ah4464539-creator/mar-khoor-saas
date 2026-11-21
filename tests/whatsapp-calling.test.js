import test from 'node:test';
import assert from 'node:assert/strict';
import { enableCalling, disableCalling, metaCallingSettings, vapiSipHost, getCallingState } from '../src/whatsapp-calling.js';

function fakePool({ assistant = 'asst_1' } = {}) {
  const settings = new Map();
  return { settings,
    async query(sql, params) {
      if (sql.startsWith('SELECT setting_value')) return [settings.has(params[0]) ? [{ setting_value: settings.get(params[0]) }] : []];
      if (sql.startsWith('INSERT INTO app_settings')) settings.set(params[0], params[1]);
      return [[]];
    },
    async execute(sql) {
      if (sql.startsWith('SELECT phone_number_id FROM whatsapp_numbers')) return [[{ phone_number_id: '1488585814336543' }]];
      if (sql.startsWith('SELECT token_enc')) return [[]];
      if (sql.startsWith('SELECT assistant_id')) return [assistant ? [{ assistant_id: assistant }] : []];
      return [[]];
    } };
}
function fakeFetch({ failMeta = false } = {}) {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, method: init.method || 'GET', body });
    const reply = (ok, data, status = ok ? 200 : 400) => ({ ok, status, json: async () => data });
    if (url.includes('?fields=display_phone_number')) return reply(true, { display_phone_number: '+1 555-156-0265' });
    if (url.endsWith('/credential') && init.method === 'POST') return reply(true, { id: 'cred-123' });
    if (url.endsWith('/phone-number') && init.method === 'POST') return reply(true, { id: 'pn-456' });
    if (url.endsWith('/settings')) return failMeta ? reply(false, { error: { message: 'Calling not allowed' } }) : reply(true, { success: true });
    return reply(true, {});
  };
  return { calls, fetcher };
}
const env = { VAPI_API_KEY: 'vk', WHATSAPP_ACCESS_TOKEN: 'wt' };
const quiet = { log() {}, error() {} };

test('settings send calls to the Vapi SIP host over TLS with SDES', () => {
  assert.equal(vapiSipHost('cred-123'), 'cred-123.sip.vapi.ai');
  assert.deepEqual(metaCallingSettings('h.example').calling.sip.servers, [{ hostname: 'h.example', port: 5061 }]);
  assert.equal(metaCallingSettings('h').calling.srtp_key_exchange_protocol, 'SDES');
});

test('enable: Vapi trunk + number on the assistant, then Meta settings; state saved', async () => {
  const pool = fakePool(), { calls, fetcher } = fakeFetch();
  const result = await enableCalling(pool, 4, { env, fetcher, log: quiet });
  assert.equal(result.sip_host, 'cred-123.sip.vapi.ai');
  assert.equal(result.number, '+15551560265');
  const credential = calls.find(c => c.url.endsWith('/credential'));
  assert.equal(credential.body.provider, 'byo-sip-trunk');
  assert.equal(credential.body.gateways[0].ip, 'wa.meta.vc');
  const phone = calls.find(c => c.url.endsWith('/phone-number'));
  assert.deepEqual([phone.body.number, phone.body.assistantId, phone.body.credentialId], ['15551560265', 'asst_1', 'cred-123']);
  const meta = calls.find(c => c.url.endsWith('/1488585814336543/settings'));
  assert.equal(meta.body.calling.sip.servers[0].hostname, 'cred-123.sip.vapi.ai');
  assert.equal((await getCallingState(pool))[4].vapi_phone_number_id, 'pn-456');
});

test('enable rolls back the Vapi trunk and number when Meta refuses', async () => {
  const pool = fakePool(), { calls, fetcher } = fakeFetch({ failMeta: true });
  await assert.rejects(enableCalling(pool, 4, { env, fetcher, log: quiet }), /Calling not allowed/);
  const deletes = calls.filter(c => c.method === 'DELETE').map(c => c.url);
  assert.deepEqual(deletes, ['https://api.vapi.ai/phone-number/pn-456', 'https://api.vapi.ai/credential/cred-123']);
  assert.deepEqual(await getCallingState(pool), {});
});

test('disable turns Meta calling off and removes the Vapi pieces', async () => {
  const pool = fakePool(), { calls, fetcher } = fakeFetch();
  await enableCalling(pool, 4, { env, fetcher, log: quiet });
  calls.length = 0;
  await disableCalling(pool, 4, { env, fetcher });
  assert.equal(calls[0].body.calling.status, 'DISABLED');
  assert.equal(calls.filter(c => c.method === 'DELETE').length, 2);
  assert.deepEqual(await getCallingState(pool), {});
});

test('no WhatsApp number or no Vapi key gives a clear error', async () => {
  await assert.rejects(enableCalling(fakePool(), 4, { env: {}, fetcher: fakeFetch().fetcher, log: quiet }), /VAPI_API_KEY/);
});
