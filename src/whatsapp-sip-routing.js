import { getCallingState } from './whatsapp-calling.js';
import { normalizeBusinessPhone, parseBusinessSipUri, safeCallIdentifier } from './whatsapp-sip-identifiers.js';

// Vapi's phone-number resource ID is the entry point for SIP inbound tenant resolution.
// Assistant names, customer numbers, and tenant IDs in the provider envelope are never trusted.
export async function resolveIncomingWhatsAppSip(pool, { call, assistantId }) {
  const state = await getCallingState(pool);
  const entries = Object.entries(state);
  const topId = safeCallIdentifier(call?.phoneNumberId);
  const nestedId = safeCallIdentifier(call?.phoneNumber?.id);
  const phoneNumberId = topId || nestedId;
  const uri = call?.phoneNumber?.sipUri || call?.sipUri || null;
  const matches = entries.filter(([, e]) => e?.vapi_phone_number_id === phoneNumberId && Boolean(phoneNumberId));
  const tiedAssistant = entries.some(([, e]) => e?.assistant_id === assistantId);
  // Unknown inbound phone resources must not fall back to an assistant-name lookup.
  // Explicit PSTN providers and Vapi PSTN objects with a public number remain outside SIP.
  const provider = call?.phoneNumber?.provider;
  const knownPstn = ['telnyx', 'twilio', 'vonage'].includes(provider)
    || (provider === 'vapi' && Boolean(call?.phoneNumber?.number) && !uri);
  const ambiguousInbound = !knownPstn && (
    call?.type === 'inboundPhoneCall' ||
    (Boolean(phoneNumberId) && call?.type !== 'webCall' && call?.type !== 'outboundPhoneCall')
  );
  const sipHint = Boolean(uri) || (provider === 'vapi' && !knownPstn) || matches.length > 0
    || (tiedAssistant && !knownPstn && call?.type !== 'webCall' && call?.type !== 'outboundPhoneCall')
    || ambiguousInbound;

  if (!sipHint) return { scope: 'other' }; // Web calls and normal unrelated PSTN integrations.
  const deny = (reason, entry = null) => ({
    scope: 'rejected', reason,
    tenantId: null, businessNumber: entry?.number || null,
    vapiPhoneNumberId: phoneNumberId || null, assistantId,
  });

  if (topId && nestedId && topId !== nestedId) return deny('phone_resource_conflict');
  if (!phoneNumberId) return deny('missing_phone_resource');
  if (matches.length !== 1) return deny(matches.length ? 'duplicate_phone_resource' : 'unknown_phone_resource');

  const [rawTenantId, entry] = matches[0];
  const tenantId = Number(rawTenantId);
  const number = normalizeBusinessPhone(entry.number);
  const configured = parseBusinessSipUri('sip:' + entry.sip_user + '@' + entry.sip_host);
  const incoming = uri ? parseBusinessSipUri(uri) : null;
  if (!Number.isSafeInteger(tenantId) || tenantId < 1 ||
      !number || !configured || configured.digits !== number ||
      !entry.phone_number_id || !safeCallIdentifier(String(entry.phone_number_id))) {
    return deny('invalid_sip_configuration', entry);
  }
  if (incoming && (incoming.digits !== number || incoming.host !== configured.host)) {
    return deny('sip_destination_mismatch', entry);
  }
  if (uri && !incoming) return deny('invalid_sip_destination', entry);
  // +E.164 and digits-only URIs represent the same number. Reject collisions even
  // when Meta phone IDs or Vapi resource IDs differ.
  const collisions = entries.filter(([, other]) =>
    other?.phone_number_id === entry.phone_number_id ||
    other?.vapi_phone_number_id === entry.vapi_phone_number_id ||
    normalizeBusinessPhone(other?.number) === number
  );
  if (collisions.length !== 1) return deny('duplicate_normalized_number', entry);
  if (!safeCallIdentifier(assistantId) || assistantId !== entry.assistant_id) {
    return deny('assistant_mismatch', entry);
  }
  // The authoritative restaurant is the active Meta phone ownership row, NOT the
  // Vapi assistant's name, business label, or any client-supplied restaurant ID.
  const [numbers] = await pool.execute(
    'SELECT restaurant_id FROM whatsapp_numbers WHERE phone_number_id=? AND active=1 LIMIT 2',
    [entry.phone_number_id]
  );
  if (numbers.length !== 1 || Number(numbers[0].restaurant_id) !== tenantId) {
    return deny('phone_tenant_mismatch', entry);
  }
  const [assistants] = await pool.execute(
    'SELECT restaurant_id FROM voice_assistants WHERE assistant_id=? AND active=1 LIMIT 2',
    [assistantId]
  );
  if (assistants.length !== 1 || Number(assistants[0].restaurant_id) !== tenantId) {
    return deny('assistant_tenant_mismatch', entry);
  }
  return {
    scope: 'validated', tenantId,
    businessNumber: '+' + number, vapiPhoneNumberId: phoneNumberId,
    assistantId, metaPhoneNumberId: String(entry.phone_number_id),
  };
}
