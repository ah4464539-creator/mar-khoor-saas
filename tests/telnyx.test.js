import assert from 'node:assert/strict';
import test from 'node:test';
import { telnyxNumbers } from '../src/telnyx.js';

test('Telnyx adapter scopes inventory, submits the chosen number and reads provider status', async () => {
  const calls = [];
  const phone = '+12025550123';
  const orderId = '01234567-abcd-abcd-abcd-0123456789ab';
  const client = telnyxNumbers('test-key', async (url, options) => {
    calls.push({ url: new URL(url), options });
    const data = url.includes('available_phone_numbers')
      ? [{ phone_number: phone, cost_information: { monthly_cost: '1.00' } }, { phone_number: '+12025550124', best_effort: true }]
      : { id: orderId, status: 'pending' };
    return new Response(JSON.stringify({ data }));
  });

  assert.deepEqual(await client.search('US', phone), [{ phone_number: phone, cost_information: { monthly_cost: '1.00' } }]);
  assert.equal(calls[0].url.searchParams.get('filter[country_code]'), 'US');
  assert.equal(calls[0].url.searchParams.get('filter[phone_number]'), phone);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-key');
  assert.equal((await client.order(phone, 'attempt-1')).id, orderId);
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    phone_numbers: [{ phone_number: phone }], customer_reference: 'attempt-1',
  });
  assert.equal((await client.status(orderId)).status, 'pending');
  assert.equal(calls[2].url.pathname, '/v2/number_orders/' + orderId);
});

test('Telnyx adapter performs only one purchase request on an uncertain outcome', async () => {
  let submissions = 0;
  const client = telnyxNumbers('test-key', async () => {
    submissions++;
    throw new Error('Timeout');
  });
  await assert.rejects(client.order('+12025550123', 'attempt-2'), /Timeout/);
  assert.equal(submissions, 1);
});
