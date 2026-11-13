// Vapi server-message (webhook) processing: call lifecycle tracking.
//
// Supported message types (per Vapi's server events documentation):
//   status-update       { message: { type, call, status } }
//   end-of-call-report  { message: { type, endedReason, call, artifact: { transcript } } }
// Anything else is acknowledged and ignored. Tool calls are handled by the
// separate /integrations/vapi/tools adapter, never here.
//
// Tenant identity is never taken from the payload: the restaurant is resolved
// from the server-side voice_assistants mapping.

const ASSISTANT_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const CALL_ID = /^[-a-zA-Z0-9_:]{1,128}$/;
const STATUSES = new Set(['scheduled', 'queued', 'ringing', 'in-progress', 'forwarding', 'ended']);
const MAX_TRANSCRIPT = 100000;
const MAX_REASON = 128;

// Pure function: validate and normalise a webhook payload.
// Returns { kind: 'ignored', reason } or { kind: 'status-update' | 'end-of-call-report', ... }.
export function parseVapiEvent(payload) {
  const message = payload?.message;
  if (!message || typeof message !== 'object' || Array.isArray(message)) return { kind: 'ignored', reason: 'no_message' };
  const type = message.type;
  if (type !== 'status-update' && type !== 'end-of-call-report') return { kind: 'ignored', reason: 'unsupported_type' };

  const assistantId = message.assistant?.id || message.assistantId || message.call?.assistantId || message.call?.assistant?.id;
  const callId = message.call?.id;
  if (typeof assistantId !== 'string' || !ASSISTANT_ID.test(assistantId)) return { kind: 'ignored', reason: 'invalid_assistant' };
  if (typeof callId !== 'string' || !CALL_ID.test(callId)) return { kind: 'ignored', reason: 'invalid_call' };

  if (type === 'status-update') {
    if (typeof message.status !== 'string' || !STATUSES.has(message.status)) return { kind: 'ignored', reason: 'invalid_status' };
    return { kind: 'status-update', assistantId, callId, status: message.status };
  }

  const reason = typeof message.endedReason === 'string' && message.endedReason ? message.endedReason.slice(0, MAX_REASON) : null;
  const rawTranscript = typeof message.artifact?.transcript === 'string' ? message.artifact.transcript
    : typeof message.transcript === 'string' ? message.transcript : null;
  const transcript = rawTranscript ? rawTranscript.slice(0, MAX_TRANSCRIPT) : null;
  return { kind: 'end-of-call-report', assistantId, callId, status: 'ended', endedReason: reason, transcript };
}

// Persists the event. Idempotent: replays and retries are safe, and a call that
// has already ended is never moved back to an earlier status by a late event.
// Returns { processed: boolean, reason?: string }.
export async function processVapiEvent(pool, payload) {
  const event = parseVapiEvent(payload);
  if (event.kind === 'ignored') return { processed: false, reason: event.reason };

  const [mapped] = await pool.execute(
    'SELECT restaurant_id FROM voice_assistants WHERE assistant_id=? AND active=1 LIMIT 1',
    [event.assistantId]
  );
  if (!mapped.length) return { processed: false, reason: 'assistant_not_mapped' };
  const restaurantId = mapped[0].restaurant_id;

  if (event.kind === 'status-update') {
    await pool.execute(
      "INSERT INTO voice_calls(assistant_id,call_id,restaurant_id,status,ended_at) VALUES (?,?,?,?,IF(?='ended',NOW(),NULL)) " +
      "ON DUPLICATE KEY UPDATE status=IF(status='ended',status,VALUES(status)),ended_at=IF(ended_at IS NULL AND VALUES(status)='ended',NOW(),ended_at)",
      [event.assistantId, event.callId, restaurantId, event.status, event.status]
    );
    return { processed: true };
  }

  await pool.execute(
    "INSERT INTO voice_calls(assistant_id,call_id,restaurant_id,status,ended_reason,transcript,ended_at) VALUES (?,?,?,'ended',?,?,NOW()) " +
    "ON DUPLICATE KEY UPDATE status='ended',ended_reason=COALESCE(VALUES(ended_reason),ended_reason),transcript=COALESCE(VALUES(transcript),transcript),ended_at=COALESCE(ended_at,NOW())",
    [event.assistantId, event.callId, restaurantId, event.endedReason, event.transcript]
  );
  return { processed: true };
}
