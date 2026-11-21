// Creates a restaurant's own Vapi assistant by copying a template assistant
// (GET/POST https://api.vapi.ai/assistant). The template holds the model, voice, transcriber
// and the tool server settings that point at Mar-Khoor; the restaurant is identified on every
// tool call by the new assistant's id (voice_assistants mapping), so nothing restaurant-specific
// needs to be written into the copy. Built from Vapi's published API; verify on the first live run.
const BASE = 'https://api.vapi.ai';
// Fields Vapi sets itself; sending them back on create is rejected.
const READ_ONLY = new Set(['id', 'orgId', 'createdAt', 'updatedAt', 'isServerUrlSecretSet']);

async function call(fetcher, apiKey, path, options = {}) {
  const response = await fetcher(BASE + path, {
    ...options,
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
  });
  let data = null;
  try { data = await response.json(); } catch { /* ignore */ }
  if (!response.ok) {
    const message = Array.isArray(data?.message) ? data.message.join('; ') : data?.message;
    throw Object.assign(Error(String(message ?? 'Vapi request failed').slice(0, 200)), { providerStatus: response.status });
  }
  return data;
}

// Text in the template may say [RESTAURANT_NAME]; each copy gets the restaurant's real name there
// (system prompt, first message, end-call message and so on).
const PLACEHOLDER = /\[RESTAURANT_NAME\]/g;
function fillName(value, restaurantName) {
  if (typeof value === 'string') return value.replace(PLACEHOLDER, restaurantName);
  if (Array.isArray(value)) return value.map(item => fillName(item, restaurantName));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillName(v, restaurantName)]));
  return value;
}

export function assistantCopy(template, { name, restaurantId, restaurantName = '', voice = null }) {
  const copy = {};
  const safeName = String(restaurantName).replace(/[\u0000-\u001f]/g, ' ').slice(0, 160);
  for (const [key, value] of Object.entries(template || {})) if (!READ_ONLY.has(key)) copy[key] = safeName ? fillName(value, safeName) : value;
  if (voice) copy.voice = voice;
  copy.name = String(name).slice(0, 40);
  copy.metadata = { ...(template?.metadata && typeof template.metadata === 'object' ? template.metadata : {}), markhoorRestaurantId: String(restaurantId) };
  return copy;
}

export async function cloneAssistant({ apiKey, templateId, name, restaurantId, restaurantName, voice = null, fetcher = fetch }) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(templateId || '')) throw Error('Invalid template assistant id');
  const template = await call(fetcher, apiKey, '/assistant/' + templateId);
  const created = await call(fetcher, apiKey, '/assistant', { method: 'POST', body: JSON.stringify(assistantCopy(template, { name, restaurantId, restaurantName, voice })) });
  if (typeof created?.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(created.id)) throw Error('Vapi returned no assistant id');
  return { id: created.id };
}
