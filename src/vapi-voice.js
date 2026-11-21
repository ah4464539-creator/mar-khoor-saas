// Female voice for every AI Caller (owner's choice). Pakistan gets Azure's Pakistani Urdu
// voice; everyone else a multilingual female voice. VAPI_VOICE_JSON ({"PK":{...},"default":{...}})
// can replace them without a code change.
const FALLBACK = { provider: 'azure', voiceId: 'en-US-JennyNeural' };
const BUILT_IN = {
  PK: { provider: 'azure', voiceId: 'ur-PK-UzmaNeural' },
  default: { provider: 'azure', voiceId: 'en-US-JennyMultilingualNeural' },
};
export const VOICE_SETTINGS_SQL = `CREATE TABLE IF NOT EXISTS app_settings (
 setting_key VARCHAR(80) NOT NULL PRIMARY KEY,
 setting_value TEXT NULL,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
const MARKER = 'vapi_female_voice_v1';

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
  const pick = voices[String(country || '').toUpperCase()] || voices.default;
  return { ...pick, fallbackPlan: { voices: [FALLBACK] } };
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
  if (done.length) return { skipped: 'done' };
  const targets = [];
  if (env.VAPI_TEMPLATE_ASSISTANT_ID) targets.push([env.VAPI_TEMPLATE_ASSISTANT_ID, 'PK']);
  try {
    const [rows] = await pool.query('SELECT va.assistant_id, r.country_code FROM voice_assistants va JOIN restaurants r ON r.id=va.restaurant_id');
    for (const row of rows) targets.push([row.assistant_id, row.country_code]);
  } catch { /* table missing: template only */ }
  let ok = 0, failed = 0;
  for (const [id, country] of targets) {
    try { await patchVoice(fetcher, apiKey, id, femaleVoice(country, env)); ok++; } catch (error) { failed++; log.warn?.('AI Caller voice update failed for ' + String(id).slice(0, 8) + '…: ' + error.message); }
  }
  log.log?.(`AI Caller female voice: ${ok} assistant(s) updated, ${failed} failed`);
  if (!failed) await pool.query('INSERT IGNORE INTO app_settings (setting_key,setting_value) VALUES (?,?)', [MARKER, JSON.stringify({ ok, at: new Date().toISOString() })]);
  return { ok, failed };
}
