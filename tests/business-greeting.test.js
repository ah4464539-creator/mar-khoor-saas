import test from 'node:test';
import assert from 'node:assert/strict';
import { businessGreeting, businessCallRule, syncCallBookingTools, NO_BOOKINGS_RULE, BOOKING_CALL_RULE } from '../src/voice-bookings.js';

test('clinics, salons and hotels greet as a reception desk; restaurants keep their own greeting', () => {
  assert.match(businessGreeting('clinic', 'Cheema clinic'), /^Assalam-o-alaikum, Cheema clinic mein khush aamdeed! .*appointment/);
  assert.match(businessGreeting('salon', 'Glow Salon'), /service/);
  assert.match(businessGreeting('hotel', 'Test Hotel'), /room booking/);
  for (const g of ['clinic', 'salon', 'hotel'].map(c => businessGreeting(c, 'X'))) assert.doesNotMatch(g, /order|mangwana/i);
  assert.equal(businessGreeting('restaurant', 'Urban Cafe'), null);
  assert.equal(businessGreeting('clinic', ''), null, 'no name, no greeting change');
});

test('without phone bookings the AI takes a callback instead of using missing booking tools', () => {
  const off = businessCallRule('clinic', 'Cheema clinic', '', '', { bookings: false });
  assert.ok(off.includes(NO_BOOKINGS_RULE));
  assert.ok(!off.includes(BOOKING_CALL_RULE));
  assert.match(off, /not a restaurant/);
  assert.ok(businessCallRule('clinic', 'Cheema clinic').includes(BOOKING_CALL_RULE));
});

function fakes(category, { bookings = 0, firstMessage = 'Assalam-o-alaikum, Cheema clinic mein khush aamdeed! Main aap ka order le sakti hoon. Aap kya mangwana chahenge?' } = {}) {
  const pool = {
    async query() { return [[]]; },
    async execute(sql) {
      if (sql.includes('FROM restaurants r LEFT JOIN business_profiles')) return [[{ country_code: 'PK', category, timezone: null, hours_json: null, slot_minutes: 30, bookings_enabled: bookings }]];
      if (sql.startsWith('SELECT name FROM restaurants')) return [[{ name: category === 'restaurant' ? 'Urban Cafe' : 'Cheema clinic' }]];
      if (sql.includes('FROM voice_assistants')) return [[{ assistant_id: 'asst-1' }]];
      return [[]];
    },
  };
  const patches = [];
  const fetcher = async (url, options = {}) => {
    if (options.method === 'PATCH') { patches.push(JSON.parse(options.body)); return { ok: true, json: async () => ({}) }; }
    return { ok: true, json: async () => ({ firstMessage, server: { url: 'https://mar-khoor.com/integrations/webhooks/vapi' }, model: { messages: [{ role: 'system', content: 'You take orders.' }], tools: [] } }) };
  };
  return { pool, fetcher, patches };
}
const quiet = { log() {}, warn() {} };

test('sync fixes a clinic that greets like a restaurant, even before bookings are switched on', async () => {
  const { pool, fetcher, patches } = fakes('clinic', { bookings: 0 });
  const result = await syncCallBookingTools(pool, 8, { env: { VAPI_API_KEY: 'k' }, fetcher, log: quiet });
  assert.deepEqual(result, { updated: 1, failed: 0 });
  assert.match(patches[0].firstMessage, /Cheema clinic mein khush aamdeed! Main appointment book/);
  assert.match(patches[0].model.messages[0].content, /phone bookings are not set up yet/);
});

test('sync never changes a restaurant greeting and skips restaurants without bookings or transfer', async () => {
  const { pool, fetcher, patches } = fakes('restaurant', { bookings: 0 });
  assert.deepEqual(await syncCallBookingTools(pool, 4, { env: { VAPI_API_KEY: 'k' }, fetcher, log: quiet }), { skipped: 'bookings off' });
  assert.equal(patches.length, 0);
});

test('a clinic that already greets correctly is not patched again', async () => {
  const { pool, fetcher, patches } = fakes('clinic', { bookings: 0 });
  await syncCallBookingTools(pool, 8, { env: { VAPI_API_KEY: 'k' }, fetcher, log: quiet });
  const greeted = fakes('clinic', { bookings: 0, firstMessage: patches[0].firstMessage });
  const fetch2 = async (url, options = {}) => {
    if (options.method === 'PATCH') { greeted.patches.push(JSON.parse(options.body)); return { ok: true, json: async () => ({}) }; }
    return { ok: true, json: async () => ({ firstMessage: patches[0].firstMessage, server: { url: 'https://x' }, model: patches[0].model }) };
  };
  await syncCallBookingTools(greeted.pool, 8, { env: { VAPI_API_KEY: 'k' }, fetcher: fetch2, log: quiet });
  assert.equal(greeted.patches.length, 0);
});
