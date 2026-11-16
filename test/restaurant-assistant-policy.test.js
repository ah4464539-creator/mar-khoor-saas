import test from 'node:test';
import assert from 'node:assert/strict';
import { restaurantAssistantInstructions, mayRecordConversation, RESTAURANT_SCOPE_REFUSAL } from '../src/restaurant-assistant-policy.js';

test('verified restaurant name required', () => {
  assert.throws(() => restaurantAssistantInstructions(''), TypeError);
  assert.throws(() => restaurantAssistantInstructions(null), TypeError);
});

test('restaurant policy scopes answers and order confirmation', () => {
  const instructions = restaurantAssistantInstructions('Test Cafe');
  assert.match(instructions, /Current restaurant: Test Cafe/);
  assert.ok(instructions.includes(RESTAURANT_SCOPE_REFUSAL));
  assert.match(instructions, /explicit customer approval/);
  assert.match(instructions, /successful server-side order result/);
});

test('recording requires owner toggle and customer consent without revocation', () => {
  for (const ownerEnabled of [true, false]) for (const customerConsented of [true, false]) for (const consentRevoked of [true, false]) {
    assert.equal(mayRecordConversation({ ownerEnabled, customerConsented, consentRevoked }), ownerEnabled && customerConsented && !consentRevoked);
  }
  assert.equal(mayRecordConversation({}), false);
});
