import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { withSpeechRules, URDU_SPEECH_RULES, SPEECH_RULES_MARKER } from '../src/speech-rules.js';
import { assistantCopy } from '../src/providers/vapi-assistants.js';
import { ensureSpeechRules } from '../src/vapi-voice.js';

test('rules tell the AI to write Chicken/Total in English and mark short vowels', () => {
  assert.match(URDU_SPEECH_RULES, /Chicken/);
  assert.match(URDU_SPEECH_RULES, /Never write کل for a total/);
  assert.match(URDU_SPEECH_RULES, /zer, zabar or pesh/);
});

test('rules are appended once to the system prompt', () => {
  const model = { provider: 'openai', model: 'gpt-4o', messages: [{ role: 'system', content: 'You take orders.' }] };
  const once = withSpeechRules(model);
  assert.match(once.messages[0].content, /^You take orders\.\n\n\[Mar-Khoor speech rules v1\]/);
  assert.equal(withSpeechRules(once), once);
  assert.equal(model.messages[0].content, 'You take orders.', 'input not mutated');
  assert.equal(withSpeechRules({ messages: [] }).messages[0].role, 'system');
  const copy = assistantCopy({ model, voice: { voiceId: 'x' } }, { name: 'A', restaurantId: 1 });
  assert.ok(copy.model.messages[0].content.includes(SPEECH_RULES_MARKER));
});

test('one-time job patches template and assistants with the rules', async () => {
  let marker = false; const patched = [];
  const pool = { async query(sql) {
    if (sql.startsWith('SELECT setting_value')) return [marker ? [{}] : []];
    if (sql.startsWith('SELECT assistant_id')) return [[{ assistant_id: 'a1' }]];
    if (sql.startsWith('INSERT IGNORE')) marker = true;
    return [[]];
  } };
  const fetcher = async (url, opt = {}) => {
    if (opt.method === 'PATCH') { patched.push([url.split('/').pop(), JSON.parse(opt.body).model.messages[0].content.includes(SPEECH_RULES_MARKER)]); return { ok: true }; }
    return { ok: true, json: async () => ({ model: { messages: [{ role: 'system', content: 'Prompt' }] } }) };
  };
  const result = await ensureSpeechRules(pool, { env: { VAPI_API_KEY: 'k', VAPI_TEMPLATE_ASSISTANT_ID: 't1' }, fetcher, log: { log() {}, warn() {} } });
  assert.deepEqual(result, { ok: 2, failed: 0, missing: 0 });
  assert.deepEqual(patched, [['t1', true], ['a1', true]]);
  assert.deepEqual(await ensureSpeechRules(pool, { env: { VAPI_API_KEY: 'k' }, fetcher }), { skipped: 'done' });
});

test('website live voice uses the rules too', () => {
  assert.match(readFileSync('src/sites.js', 'utf8'), /instructions: URDU_SPEECH_RULES \+/);
});
