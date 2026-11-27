// Female voice for every AI Caller (owner's choice, 27 Nov 2026): ElevenLabs "Jessica" on Eleven v4 Turbo,
// which speaks Urdu, English and Arabic with real-time latency (~100 ms). Flash v2.5 has no Urdu and
// Eleven v3 is not a real-time model, so v4 Turbo is used everywhere. Speech is generated per whole
// sentence (chunkPlan) so it is not cut mid-sentence. If ElevenLabs is unavailable Vapi falls back to
// Azure female voices. VAPI_VOICE_JSON ({"PK":{...},"default":{...}}) can replace them without a code change.
export const ELEVEN_FEMALE = 'cgSgspJ2msm6clMCkdW9'; // ElevenLabs "Jessica"
export const SENTENCE_CHUNKS = Object.freeze({ enabled: true, minCharacters: 60, punctuationBoundaries: ['.', '!', '?', '۔'] });
const JESSICA = { provider: '11labs', voiceId: ELEVEN_FEMALE, model: 'eleven_v4_turbo', stability: 0.45, similarityBoost: 0.8, chunkPlan: SENTENCE_CHUNKS };
const BUILT_IN = {
  PK: { ...JESSICA, fallback: { provider: 'azure', voiceId: 'ur-PK-UzmaNeural' } },
  default: { ...JESSICA, fallback: { provider: 'azure', voiceId: 'en-US-JennyMultilingualNeural' } },
};
export const SECOND_CHOICE_VOICE = 'coral';
export const VOICE_SETTINGS_SQL = `CREATE TABLE IF NOT EXISTS app_settings (
 setting_key VARCHAR(80) NOT NULL PRIMARY KEY,
 setting_value TEXT NULL,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
const MARKER = 'vapi_female_voice_v4_elevenlabs_jessica_v4turbo';

function table(env = process.env) {
  try {
    const custom = JSON.parse(env.VAPI_VOICE_JSON || 'null');
    if (custom && typeof custom === 'object') return { ...BUILT_IN, ...custom };
  } catch { /* keep built-in */ }
  return BUILT_IN;
}

/** Vapi voice block for a restaurant country. */
export function femaleVoice(country, env = process.env) {
  const voices = table(env);
  const { fallback, ...pick } = voices[String(country || '').toUpperCase()] || voices.default;
  return { ...pick, fallbackPlan: { voices: [fallback || { provider: 'azure', voiceId: 'en-US-JennyNeural' }] } };
}

async function patchVoice(fetcher, apiKey, id, voice) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw Error('bad assistant id');
  const response = await fetcher('https://api.vapi.ai/assistant/' + id, {
    method: 'PATCH', redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ voice }),
  });
  if (!response.ok) throw Error('Vapi ' + response.status);
}

/** One-time switch of the template and every existing restaurant assistant to the female voice. */
export async function ensureFemaleVoices(pool, { env = process.env, fetcher = fetch, log = console } = {}) {
  const apiKey = env.VAPI_API_KEY;
  if (!apiKey) return { skipped: 'no key' };
  await pool.query(VOICE_SETTINGS_SQL);
  const [done] = await pool.query('SELECT setting_value FROM app_settings WHERE setting_key=?', [MARKER]);
  if (done.length) return { skipped: 'done', result: String(done[0].setting_value || '').slice(0, 200) };
  const targets = [];
  if (env.VAPI_TEMPLATE_ASSISTANT_ID) targets.push([env.VAPI_TEMPLATE_ASSISTANT_ID, 'PK']);
  try {
    const [rows] = await pool.query('SELECT va.assistant_id, r.country_code FROM voice_assistants va JOIN restaurants r ON r.id=va.restaurant_id');
    for (const row of rows) targets.push([row.assistant_id, row.country_code]);
  } catch { /* table missing: template only */ }
  let ok = 0, failed = 0, secondChoice = 0;
  for (const [id, country] of targets) {
    const voice = femaleVoice(country, env);
    try { await patchVoice(fetcher, apiKey, id, voice); ok++; }
    catch (error) {
      // Vapi may only allow marin with realtime models: retry once with the next best voice.
      if (voice.provider === 'openai' && voice.voiceId === 'marin') {
        try { await patchVoice(fetcher, apiKey, id, { ...voice, voiceId: SECOND_CHOICE_VOICE }); ok++; secondChoice++; continue; } catch {}
      }
      failed++; log.warn?.('AI Caller voice update failed for ' + String(id).slice(0, 8) + '…: ' + error.message);
    }
  }
  log.log?.(`AI Caller female voice (ElevenLabs Jessica): ${ok} assistant(s) updated, ${failed} failed`);
  if (!failed) await pool.query('INSERT IGNORE INTO app_settings (setting_key,setting_value) VALUES (?,?)', [MARKER, JSON.stringify({ ok, at: new Date().toISOString() })]);
  return { ok, failed, secondChoice };
}

/** One-time: add the Urdu speech rules to the template and every restaurant assistant's prompt. */
export async function ensureSpeechRules(pool, { env = process.env, fetcher = fetch, log = console } = {}) {
  const { withSpeechRules } = await import('./speech-rules.js');
  const apiKey = env.VAPI_API_KEY;
  if (!apiKey) return { skipped: 'no key' };
  await pool.query(VOICE_SETTINGS_SQL);
  const key = 'vapi_speech_rules_v1';
  const [done] = await pool.query('SELECT setting_value FROM app_settings WHERE setting_key=?', [key]);
  if (done.length) return { skipped: 'done' };
  const ids = [];
  if (env.VAPI_TEMPLATE_ASSISTANT_ID) ids.push(env.VAPI_TEMPLATE_ASSISTANT_ID);
  try { const [rows] = await pool.query('SELECT assistant_id FROM voice_assistants'); for (const r of rows) ids.push(r.assistant_id); } catch {}
  let ok = 0, failed = 0;
  for (const id of [...new Set(ids)]) {
    try {
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw Error('bad id');
      const headers = { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' };
      const got = await fetcher('https://api.vapi.ai/assistant/' + id, { headers, redirect: 'error', signal: AbortSignal.timeout(20000) });
      if (!got.ok) throw Error('Vapi ' + got.status);
      const assistant = await got.json();
      if (!assistant?.model) { ok++; continue; }
      const model = withSpeechRules(assistant.model);
      if (model === assistant.model) { ok++; continue; }
      const res = await fetcher('https://api.vapi.ai/assistant/' + id, { method: 'PATCH', headers, redirect: 'error', signal: AbortSignal.timeout(20000), body: JSON.stringify({ model }) });
      if (!res.ok) throw Error('Vapi ' + res.status);
      ok++;
    } catch (error) { failed++; log.warn?.('AI Caller speech rules failed for ' + String(id).slice(0, 8) + '…: ' + error.message); }
  }
  log.log?.(`AI Caller Urdu speech rules: ${ok} assistant(s) ready, ${failed} failed`);
  if (!failed) await pool.query('INSERT IGNORE INTO app_settings (setting_key,setting_value) VALUES (?,?)', [key, JSON.stringify({ ok, at: new Date().toISOString() })]);
  return { ok, failed };
}
