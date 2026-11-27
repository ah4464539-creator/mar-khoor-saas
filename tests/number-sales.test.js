// New phone numbers are not sold while VOICE_AUTOPROVISION_ENABLED is not '1': every business uses
// its own number for AI calling. Nothing may offer, charge for or buy a number in that state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { numberSalesEnabled } from '../src/number-sales.js';
import { planCatalog } from '../src/subscriptions.js';
import { toolCatalog, toolCartLines } from '../src/tools.js';
import { createPlanOrder } from '../src/plan-orders.js';
import { validateSetup } from '../src/setup-integrations.js';
import { purchaseNumber } from '../src/provisioning.js';

delete process.env.VOICE_AUTOPROVISION_ENABLED;

test('number sales are off unless VOICE_AUTOPROVISION_ENABLED is exactly 1', () => {
  for (const value of [undefined, '', '0', 'true', 'on']) assert.equal(numberSalesEnabled({ VOICE_AUTOPROVISION_ENABLED: value }), false);
  assert.equal(numberSalesEnabled({ VOICE_AUTOPROVISION_ENABLED: '1' }), true);
  assert.equal(numberSalesEnabled(), false);
});

test('plans neither include nor offer a number while sales are off', () => {
  for (const plan of planCatalog('USD')) {
    assert.deepEqual(plan.dedicated_number, { available: false, included: false, addon_price_minor: null, addon_base_price_minor: null });
  }
  const on = planCatalog('USD', { numberSales: true });
  assert.equal(on.find(plan => plan.key === 'premium').dedicated_number.included, true);
  assert.equal(on.find(plan => plan.key === 'starter').dedicated_number.addon_price_minor, 4900);
});

test('the single-tool cart has no new-number option and refuses one', () => {
  for (const country of ['US', 'PK', 'AE']) {
    const catalog = toolCatalog('USD', country, { env: {} });
    const calling = catalog.find(tool => tool.key === 'calling');
    assert.equal(calling.number.available, false);
    assert.equal(calling.number.price_minor, null);
    assert.match(toolCartLines(catalog, { tools: ['calling'], cycle: 'monthly', numberMode: 'new' }).error, /own number/);
    assert.equal(toolCartLines(catalog, { tools: ['calling'], cycle: 'monthly', numberMode: 'own' }).lines.length, 1);
  }
  assert.equal(toolCatalog('USD', 'US', { env: { VOICE_AUTOPROVISION_ENABLED: '1' } }).find(tool => tool.key === 'calling').number.available, true);
});

test('a plan order asking for a new number is refused before any database work', async () => {
  const pool = { execute: async () => { throw new Error('must not touch the database'); }, query: async () => { throw new Error('must not touch the database'); } };
  const result = await createPlanOrder(pool, 4, { features: ['voice'], numberMode: 'new' }, { env: {} });
  assert.equal(result.status, 409);
  assert.match(result.body.error, /own number/);
});

test('setup cannot ask for a new number; own number and forwarding still work', () => {
  assert.match(validateSetup({ ai_caller: { mode: 'new', value: '+923001234567' } }, {}).error, /own number/);
  assert.equal(validateSetup({ ai_caller: { mode: 'import', value: '+923001234567' } }, {}).error, undefined);
  assert.equal(validateSetup({ ai_caller: { mode: 'forward', value: '+923001234567' } }, {}).error, undefined);
  assert.equal(validateSetup({ ai_caller: { mode: 'new', value: '+923001234567' } }, { VOICE_AUTOPROVISION_ENABLED: '1' }).error, undefined);
});

test('the super admin purchase refuses without calling Telnyx or the database', async () => {
  let called = false;
  const pool = { execute: async () => { called = true; return [[]]; } };
  const fetcher = async () => { called = true; throw new Error('no network'); };
  const result = await purchaseNumber(pool, 5, '+971400000001', { telnyxKey: 'T', vapiKey: 'V', credentialId: 'c', fetcher });
  assert.equal(result.status, 403);
  assert.equal(called, false);
});
