import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { readFileSync } from 'node:fs';
import { sitesRouter } from '../src/sites.js';

const restaurants = {
  'urban-cafe': { id: 10, name: 'Urban Cafe', slug: 'urban-cafe', country_code: 'PK', currency: 'PKR', locale: 'en', website_assistant_provisioned: 1, config: '{}' },
  'legacy-cafe': { id: 20, name: 'Legacy Cafe', slug: 'legacy-cafe', country_code: 'PK', currency: 'PKR', locale: 'en', website_assistant_provisioned: 0, config: '{}' },
};
const pool = {
  async execute(sql, args) {
    if (sql.includes('FROM restaurants r JOIN restaurant_sites')) return [restaurants[args[0]] ? [restaurants[args[0]]] : []];
    if (sql.includes('FROM menu_items WHERE restaurant_id=')) return [[{ name: 'Cappuccino', price_minor: 42000, description: 'Coffee', category: 'Drinks' }]];
    throw Error('Unexpected query');
  },
};
const names = ['RESTAURANT_WEBSITE_VOICE_ENABLED', 'REGISTRATION_WEBSITE_ASSISTANT_ENABLED',
  'RESTAURANT_WEBSITE_ASSISTANT_ENABLED', 'OPENAI_API_KEY'];
const post = (base, slug, body) => fetch(base + '/r/' + slug + '/assistant/voice',
  { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body });
async function withServer(voiceFetch, fn) {
  const prev = names.map(k => [k, process.env[k]]);
  process.env.RESTAURANT_WEBSITE_VOICE_ENABLED = 'true';
  delete process.env.REGISTRATION_WEBSITE_ASSISTANT_ENABLED;
  delete process.env.RESTAURANT_WEBSITE_ASSISTANT_ENABLED;
  process.env.OPENAI_API_KEY = 'fake-test-key';
  const app = express(); app.use(sitesRouter(pool, { voiceFetch }));
  const server = app.listen(0);
  try {
    await new Promise(resolve => server.once('listening', resolve));
    await fn('http://127.0.0.1:' + server.address().port);
  } finally {
    await new Promise(resolve => server.close(resolve));
    for (const [k,v] of prev) { if (v===undefined) delete process.env[k]; else process.env[k]=v; }
  }
}
test('voice SDP session uses current restaurant menu and returns WebRTC SDP answer', async () => {
  let calls = 0;
  await withServer(async (url, config) => {
    calls++;
    assert.equal(url, 'https://api.openai.com/v1/realtime/calls');
    assert.equal(config.method, 'POST');
    assert.equal(config.body.get('sdp'), 'v=0\r\n');
    const session = JSON.parse(config.body.get('session'));
    assert.equal(session.type, 'realtime');
    assert.match(session.instructions, /Urban Cafe|Cappuccino/);
    assert.equal(session.audio.input.transcription.model,'gpt-4o-mini-transcribe');
    assert.deepEqual(session.tools.map(tool=>tool.name),['prepare_order','submit_order']);
    assert.equal(session.tools[0].type,'function');
    assert.doesNotMatch(session.instructions, /Legacy Cafe/);
    return { ok: true, text: async () => 'v=0\r\na=answer\r\n' };
  }, async base => {
    const reply = await post(base, 'urban-cafe', 'v=0\r\n');
    assert.equal(reply.status, 200);
    assert.match(reply.headers.get('content-type'), /application\/sdp/);
    assert.match(await reply.text(), /^v=0/);
    assert.equal(calls, 1);
    assert.equal((await post(base, 'legacy-cafe', 'v=0\r\n')).status, 404);
    assert.equal(calls, 1);
  });
});

test('voice provider errors expose only a safe failure category and no keys or provider messages', async () => {
  await withServer(async () => ({
    ok: false, status: 429,
    json: async () => ({error:{code:'insufficient_quota',message:'SECRET upstream data'}}),
  }), async base => {
    const response = await post(base,'urban-cafe','v=0\r\n');
    assert.equal(response.status, 502);
    assert.equal(response.headers.get('x-voice-error'),'quota_unavailable');
    assert.doesNotMatch(await response.text(),/SECRET|fake-test-key/);
  });
});

test('voice route validates microphone offer, API key and owner-side feature flags', async () => {
  let calls = 0;
  await withServer(async () => {calls++;throw Error('Not expected')}, async base => {
    assert.equal((await post(base,'urban-cafe','wrong')).status, 400);
    delete process.env.OPENAI_API_KEY;
    const absentKey = await post(base,'urban-cafe','v=0\r\n');
    assert.equal(absentKey.status,503);
    assert.equal(absentKey.headers.get('x-voice-error'),'missing_key');
    process.env.RESTAURANT_WEBSITE_VOICE_ENABLED='false';
    assert.equal((await post(base,'urban-cafe','v=0\r\n')).status,404);
    assert.equal(calls,0);
  });
});

test('browser waits for ICE, negotiates data channel, and requires consent for local recordings', () => {
  const js=readFileSync(new URL('../public/restaurant-assistant-voice.js',import.meta.url),'utf8');
  const sites=readFileSync(new URL('../src/sites.js',import.meta.url),'utf8');
  assert.match(js, /createDataChannel\('oai-events'\)/);
  assert.match(js,/waitForIceGathering\(/);
  assert.match(js,/connectionTimeout/);
  assert.match(js,/voiceFailure\(response.status/);
  assert.match(js,/!consent.checked/);
  assert.match(js,/current\.peer\.connectionState !== 'connected'/);
  assert.match(js,/recorder\.onstop/);
  assert.match(js,/blob\.size > 0/);
  assert.doesNotMatch(sites,/id=\\"assistant-voice-orb\\"/);
  assert.doesNotMatch(sites,/id=\\"start-recording\\"/);
});

test('voice frontend has transcript mirroring, backend-receipt gated close, and recording consent',()=>{
 const js=readFileSync(new URL('../public/restaurant-assistant-voice.js',import.meta.url),'utf8');
 const page=readFileSync(new URL('../public/restaurant-assistant-panel.js',import.meta.url),'utf8');
 assert.match(js,/conversation\.item\.input_audio_transcription\.completed/);
 assert.match(js,/response\.output_audio_transcript\.delta/);
 assert.match(js,/function_call_output/);
 assert.match(js,/response\.create/);
 assert.match(js,/response\.status === 201|response\.status !== 201/);
 assert.match(js,/current\.confirmedSinceDraft/);
 assert.match(js,/order_id:result\.order_id/);
 assert.match(js,/output_audio_buffer\.stopped/);
 assert.match(page,/X-Tracking-Token/);
 assert.match(page,/estimated_ready_epoch/);
 assert.match(page,/sessionStorage\.setItem/);
 assert.match(page,/SpeechSynthesisUtterance/);
 assert.match(page,/SpeechRecognition/);
 const style=readFileSync(new URL('../src/site-builder.js',import.meta.url),'utf8');
 assert.match(style,/restaurant-assistant/);
 assert.match(style,/prefers-reduced-motion/);
});
