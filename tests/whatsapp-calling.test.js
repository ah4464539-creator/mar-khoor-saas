import test from 'node:test';
import assert from 'node:assert/strict';
import { enableCalling, disableCalling, metaCallingSettings, vapiSipHost, getCallingState, callingDiagnostics, callingStatus } from '../src/whatsapp-calling.js';

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
    if (url.endsWith('/phone-number/pn-456') && init.method === 'GET') return reply(true, { id: 'pn-456', sipUri: 'sip:+15551560265@sip.vapi.ai', assistantId: 'asst_1' });
    if (url.endsWith('/settings?fields=calling')) return reply(true, { calling: { status: 'ENABLED', sip: { status: 'ENABLED', servers: [{ hostname: 'sip.vapi.ai' }] } } });
    if (url.endsWith('/settings')) return failMeta ? reply(false, { error: { message: 'Calling not allowed' } }) : reply(true, { success: true });
    return reply(true, {});
  };
  return { calls, fetcher };
}
const env = { VAPI_API_KEY: 'vk', WHATSAPP_ACCESS_TOKEN: 'wt' };
const quiet = { log() {}, error() {} };
const resolve4 = async () => ['57.144.10.20', '157.240.1.2'];

test('settings send calls to the Vapi SIP host over TLS with SDES', () => {
  assert.equal(vapiSipHost('cred-123'), 'cred-123.sip.vapi.ai');
  assert.deepEqual(metaCallingSettings('h.example').calling.sip.servers, [{ hostname: 'h.example', port: 5061 }]);
  assert.equal(metaCallingSettings('h').calling.srtp_key_exchange_protocol, 'SDES');
});

test('enable: Vapi SIP number on the assistant, then Meta settings; state saved', async () => {
  const pool = fakePool(), { calls, fetcher } = fakeFetch();
  const result = await enableCalling(pool, 4, { env, fetcher, log: quiet, resolve4 });
  assert.equal(result.sip_host, 'sip.vapi.ai');
  assert.equal(result.number, '+15551560265');
  assert.equal(calls.some(c => c.url.endsWith('/credential')), false, 'no IP-filtered trunk');
  const phone = calls.find(c => c.url.endsWith('/phone-number'));
  assert.deepEqual([phone.body.provider, phone.body.sipUri, phone.body.assistantId], ['vapi', 'sip:+15551560265@sip.vapi.ai', 'asst_1']);
  const meta = calls.find(c => c.url.endsWith('/1488585814336543/settings'));
  assert.equal(meta.body.calling.sip.servers[0].hostname, 'sip.vapi.ai');
  assert.equal((await getCallingState(pool))[4].vapi_phone_number_id, 'pn-456');
});

test('enable rolls back the Vapi trunk and number when Meta refuses', async () => {
  const pool = fakePool(), { calls, fetcher } = fakeFetch({ failMeta: true });
  await assert.rejects(enableCalling(pool, 4, { env, fetcher, log: quiet, resolve4 }), /Calling not allowed/);
  const deletes = calls.filter(c => c.method === 'DELETE').map(c => c.url);
  assert.deepEqual(deletes, ['https://api.vapi.ai/phone-number/pn-456']);
  assert.deepEqual(await getCallingState(pool), {});
});

test('disable turns Meta calling off and removes the Vapi pieces', async () => {
  const pool = fakePool(), { calls, fetcher } = fakeFetch();
  await enableCalling(pool, 4, { env, fetcher, log: quiet, resolve4 });
  calls.length = 0;
  await disableCalling(pool, 4, { env, fetcher });
  assert.equal(calls[0].body.calling.status, 'DISABLED');
  assert.equal(calls.filter(c => c.method === 'DELETE').length, 1);
  assert.deepEqual(await getCallingState(pool), {});
});

test('no WhatsApp number or no Vapi key gives a clear error', async () => {
  await assert.rejects(enableCalling(fakePool(), 4, { env: {}, fetcher: fakeFetch().fetcher, log: quiet }), /VAPI_API_KEY/);
});

test('Vapi refuses "+" in the SIP user: retries with digits only', async () => {
  const uris = [];
  const fetcher = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    if (url.endsWith('/phone-number') && init.method === 'POST') { uris.push(body.sipUri); return uris.length < 2 ? { ok: false, status: 400, json: async () => ({ message: 'sipUri invalid' }) } : { ok: true, status: 200, json: async () => ({ id: 'pn-2' }) }; }
    if (url.includes('?fields=display_phone_number')) return { ok: true, status: 200, json: async () => ({ display_phone_number: '15551560265' }) };
    return { ok: true, status: 200, json: async () => ({ success: true }) };
  };
  await enableCalling(fakePool(), 4, { env, fetcher, log: quiet, resolve4 });
  assert.deepEqual(uris, ['sip:+15551560265@sip.vapi.ai', 'sip:15551560265@sip.vapi.ai']);
});

test('diagnostics inspect the current Vapi SIP phone number, not an undefined trunk credential', async () => {
  const pool = fakePool(), stub = fakeFetch();
  await enableCalling(pool, 4, { env, fetcher: stub.fetcher, log: quiet });
  stub.calls.length = 0;
  const fetcher = async (url, init) => {
    if (url.includes('/call?')) return { ok: true, status: 200, json: async () =>
      [{ createdAt: 't', status: 'ended', endedReason: 'no-answer', type: 'inboundPhoneCall' }] };
    return stub.fetcher(url, init);
  };
  const [report] = await callingDiagnostics(pool, { env, fetcher });
  assert.equal(report.vapi_phone_registered, true);
  assert.equal(report.vapi_sip_uri_matches, true);
  assert.equal(report.vapi_assistant_matches, true);
  assert.equal(report.calls[0].ended, 'no-answer');
  assert.ok(stub.calls.some(c => c.url.endsWith('/phone-number/pn-456')));
  assert.ok(stub.calls.every(c => !c.url.includes('/credential/undefined')), 'no obsolete undefined credentials lookup');
  assert.equal('gateways' in report, false, 'new SIP-URI pilot has no trunk credential');
});

test('super-admin calling status checks both Meta and Vapi without claiming a real call succeeded', async () => {
  const pool = fakePool(), stub = fakeFetch();
  await enableCalling(pool, 4, { env, fetcher: stub.fetcher, log: quiet });
  const status = await callingStatus(pool, 4, { env, fetcher: stub.fetcher });
  assert.equal(status.on, true);
  assert.equal(status.meta.status, 'ENABLED');
  assert.equal(status.vapi.registered, true);
  assert.equal(status.vapi.sip_uri_matches, true);
  assert.equal(status.config_checks_passed, true);
  assert.equal('call_answered' in status, false, 'configuration checks do not verify live inbound call delivery');
});

test('super-admin status detects missing Vapi registration even if Meta calling is enabled', async () => {
  const pool = fakePool(), stub = fakeFetch();
  await enableCalling(pool, 4, { env, fetcher: stub.fetcher, log: quiet });
  const fetcher = async (url, init) => {
    if (url.endsWith('/phone-number/pn-456')) return { ok: false, status: 404, json: async () => ({ message: 'Not found' }) };
    return stub.fetcher(url, init);
  };
  const status = await callingStatus(pool, 4, { env, fetcher });
  assert.equal(status.on, true);
  assert.equal(status.vapi.registered, false);
  assert.equal(status.config_checks_passed, false);
  assert.match(status.vapi.error, /Not found/);
});
