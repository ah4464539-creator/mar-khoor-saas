import test from 'node:test';
import assert from 'node:assert/strict';
import { femaleVoice, ensureFemaleVoices } from '../src/vapi-voice.js';
import { assistantCopy } from '../src/providers/vapi-assistants.js';

test('AI Caller voices are female: Urdu for Pakistan, multilingual elsewhere', () => {
  assert.equal(femaleVoice('PK', {}).voiceId, 'ur-PK-UzmaNeural');
  assert.equal(femaleVoice('ae', {}).voiceId, 'en-US-JennyMultilingualNeural');
  assert.equal(femaleVoice('PK', {}).fallbackPlan.voices[0].voiceId, 'en-US-JennyNeural');
  assert.equal(femaleVoice('AE', { VAPI_VOICE_JSON: '{"AE":{"provider":"azure","voiceId":"ar-AE-FatimaNeural"}}' }).voiceId, 'ar-AE-FatimaNeural');
  const copy = assistantCopy({ id: 'x', voice: { provider: 'vapi', voiceId: 'Elliot' }, firstMessage: 'Hi' }, { name: 'A', restaurantId: 1, voice: femaleVoice('PK', {}) });
  assert.equal(copy.voice.voiceId, 'ur-PK-UzmaNeural');
  assert.equal(assistantCopy({ voice: { voiceId: 'Elliot' } }, { name: 'A', restaurantId: 1 }).voice.voiceId, 'Elliot');
});

test('existing assistants are switched once, and only the voice is sent', async () => {
  const queries = []; let marker = false;
  const pool = { async query(sql, params) {
    queries.push(sql);
    if (sql.startsWith('SELECT setting_value')) return [marker ? [{ setting_value: '{}' }] : []];
    if (sql.startsWith('SELECT va.assistant_id')) return [[{ assistant_id: 'asst-pk', country_code: 'PK' }, { assistant_id: 'asst-us', country_code: 'US' }]];
    if (sql.startsWith('INSERT IGNORE INTO app_settings')) marker = true;
    return [[]];
  } };
  const sent = [];
  const fetcher = async (url, options) => { sent.push([url, JSON.parse(options.body), options.method]); return { ok: true }; };
  const log = { log() {}, warn() {} };
  const result = await ensureFemaleVoices(pool, { env: { VAPI_API_KEY: 'k', VAPI_TEMPLATE_ASSISTANT_ID: 'tmpl-1' }, fetcher, log });
  assert.deepEqual(result, { ok: 3, failed: 0 });
  assert.deepEqual(sent.map(s => [s[0].split('/').pop(), s[2], Object.keys(s[1]), s[1].voice.voiceId]), [
    ['tmpl-1', 'PATCH', ['voice'], 'ur-PK-UzmaNeural'], ['asst-pk', 'PATCH', ['voice'], 'ur-PK-UzmaNeural'], ['asst-us', 'PATCH', ['voice'], 'en-US-JennyMultilingualNeural']]);
  assert.deepEqual(await ensureFemaleVoices(pool, { env: { VAPI_API_KEY: 'k' }, fetcher, log }), { skipped: 'done' });
  assert.ok(queries[0].startsWith('CREATE TABLE IF NOT EXISTS app_settings'));
});

test('a failed update is retried on the next start', async () => {
  let inserted = false;
  const pool = { async query(sql) { if (sql.startsWith('INSERT')) inserted = true; return [[]]; } };
  const result = await ensureFemaleVoices(pool, { env: { VAPI_API_KEY: 'k', VAPI_TEMPLATE_ASSISTANT_ID: 't' }, fetcher: async () => ({ ok: false, status: 400 }), log: { log() {}, warn() {} } });
  assert.deepEqual(result, { ok: 0, failed: 1 });
  assert.equal(inserted, false);
});
