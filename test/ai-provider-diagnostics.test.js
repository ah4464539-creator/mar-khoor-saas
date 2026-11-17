import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyAssistantProviderFailure as classify } from '../src/ai-provider-diagnostics.js';

test('assistant provider diagnostics distinguish actionable errors without upstream messages', () => {
  assert.equal(classify(401, 'invalid_api_key'), 'invalid_credentials');
  assert.equal(classify(429, 'insufficient_quota'), 'quota_unavailable');
  assert.equal(classify(429, 'credit_balance_exhausted'), 'quota_unavailable');
  assert.equal(classify(429, 'rate_limit_exceeded'), 'rate_limited');
  assert.equal(classify(400, 'model_not_found'), 'model_unavailable');
  assert.equal(classify(403, 'somecode'), 'permission_denied');
  assert.equal(classify(400, null), 'request_rejected');
  assert.equal(classify(503, null), 'provider_unavailable');
  assert.equal(classify(null, null), 'connection_failed');
  assert.equal(classify(200, 'foo'), 'provider_unavailable');
});
