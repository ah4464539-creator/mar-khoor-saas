// Imports a Telnyx number into Vapi and attaches it to an assistant (POST https://api.vapi.ai/phone-number).
// Not yet exercised against the live Vapi API.
export async function importTelnyxNumber({ apiKey, credentialId, number, assistantId, name, fetcher = fetch }) {
  const response = await fetcher('https://api.vapi.ai/phone-number', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'telnyx', number, credentialId, assistantId, name: String(name).slice(0, 40) }),
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
  });
  let data = null;
  try { data = await response.json(); } catch { /* ignore */ }
  if (!response.ok) throw Error(String(data?.message ?? 'Vapi import failed').slice(0, 200));
  if (typeof data?.id !== 'string') throw Error('Vapi returned no phone number id');
  return { id: data.id.slice(0, 64) };
}
