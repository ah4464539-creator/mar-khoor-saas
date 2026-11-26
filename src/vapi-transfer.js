// Transfer to a human on AI calls. Vapi asks the server URL for a destination
// (`transfer-destination-request`) when the assistant's transferCall tool has no fixed number;
// we answer with the restaurant's reception phone (Dashboard → AI receptionist → reception phone).
// The restaurant is resolved from the server-side assistant mapping, never from the payload.
import { getTransferPhone } from './booking-extras.js';
import { recordTransfer } from './vapi-call-log.js';

const ASSISTANT = /^[a-zA-Z0-9_-]{1,128}$/;
const CALL = /^[-a-zA-Z0-9_:]{1,128}$/;
export const TRANSFER_MESSAGE = 'Connecting you to our staff now.';
export const NO_TRANSFER_SAY = 'No staff number is set. Apologise, take the caller name and number, and say the restaurant will call back.';

/** Vapi response body for a transfer-destination-request. Never throws for bad input. */
export async function transferDestination(pool, payload, { resolve, assistantId }) {
  const callId = payload?.message?.call?.id;
  if (typeof assistantId !== 'string' || !ASSISTANT.test(assistantId) || typeof callId !== 'string' || !CALL.test(callId))
    return { error: 'Invalid call' };
  const resolved = await resolve(pool, payload, { assistantId, callId, status: 'forwarding' });
  if (resolved.reason) return { error: 'Call not mapped' };
  const number = await getTransferPhone(pool, Number(resolved.restaurantId));
  if (!/^\+\d{8,15}$/.test(number)) return { error: NO_TRANSFER_SAY };
  try { await recordTransfer(pool, { assistantId, callId, restaurantId: resolved.restaurantId, number }); } catch {}
  console.log(JSON.stringify({ event: 'vapi_transfer', restaurant_id: Number(resolved.restaurantId) }));
  return { destination: { type: 'number', number, message: TRANSFER_MESSAGE } };
}
