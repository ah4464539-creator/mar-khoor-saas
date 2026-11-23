// Canonical comparison only: the public SIP URI may contain a leading "+", but
// that formatting cannot establish a different business-number identity.
// Feature flag is OFF by default; deployment alone must not change live routing.
export const sipFailClosedEnabled = (env = process.env) => env.WHATSAPP_SIP_FAIL_CLOSED_ENABLED === '1';

export function normalizeBusinessPhone(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const raw = String(value).trim();
  if (!/^\+?[\d\s().-]{8,30}$/.test(raw)) return null;
  const digits = raw.replace(/\D/g, '');
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

export function parseBusinessSipUri(value) {
  if (typeof value !== 'string') return null;
  const match = /^sip:(\+?[1-9]\d{7,14})@([a-z0-9.-]+)(?::5061)?$/i.exec(value.trim());
  if (!match) return null;
  const digits = normalizeBusinessPhone(match[1]);
  return digits ? { digits, host: match[2].toLowerCase() } : null;
}

export const safeCallIdentifier = value =>
  typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value) ? value : null;

export function emitWhatsAppCallLog(logger, details = {}) {
  // No caller MSISDN, headers, SDP, transcript, bearer token, or raw provider error.
  const digits = normalizeBusinessPhone(details.businessNumber);
  const tenantId = Number(details.tenantId);
  const response = Number(details.sipResponse);
  const record = {
    event: 'whatsapp_ai_call_route',
    source: ['meta', 'vapi', 'vapi-tools'].includes(details.source) ? details.source : 'unknown',
    meta_call_id: safeCallIdentifier(details.metaCallId),
    vapi_call_id: safeCallIdentifier(details.vapiCallId),
    normalized_phone_number: digits ? '+' + digits : null, // business number only
    tenant_id: Number.isSafeInteger(tenantId) && tenantId > 0 ? tenantId : null,
    vapi_phone_number_resource: safeCallIdentifier(details.vapiPhoneNumberId),
    selected_assistant: safeCallIdentifier(details.assistantId),
    sip_status: typeof details.sipStatus === 'string' && /^[a-z0-9_-]{1,40}$/i.test(details.sipStatus)
      ? details.sipStatus : null,
    sip_response: Number.isInteger(response) && response >= 100 && response <= 699 ? response : null,
    decision: typeof details.decision === 'string' && /^[a-z0-9_-]{1,48}$/.test(details.decision)
      ? details.decision : 'unknown',
  };
  logger?.log?.(JSON.stringify(record));
  return record;
}
