// Stable, non-secret reasons for failed provider requests. Never include upstream messages,
 // API tokens, model access details, response bodies or request payloads in public replies.
export function classifyAssistantProviderFailure(status, code) {
  const safeCode = typeof code === 'string' ? code : '';
  if (status === 401 || safeCode === 'invalid_api_key') return 'invalid_credentials';
  if (safeCode === 'insufficient_quota' ||
      safeCode === 'credit_balance_exhausted' ||
      safeCode === 'organization_spend_limit_exceeded' ||
      safeCode === 'project_spend_limit_exceeded') return 'quota_unavailable';
  if (status === 429) return 'rate_limited';
  if (safeCode === 'model_not_found' || safeCode === 'invalid_model' ||
      safeCode === 'model_not_available' || safeCode === 'model_access_denied') return 'model_unavailable';
  if (status === 403) return 'permission_denied';
  if (status === 400 || status === 422) return 'request_rejected';
  if (status === null || status === undefined) return 'connection_failed';
  if (status >= 500) return 'provider_unavailable';
  return 'provider_unavailable';
}
