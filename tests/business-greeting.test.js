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

import { withBookingTools, bookingTool, CALL_STYLE_RULE, TOOL_WAIT_MESSAGE, transferOnlyRule } from '../src/voice-bookings.js';

test('book_appointment can carry the phone number the caller says (calls without caller ID)', () => {
  const tool = bookingTool('book_appointment', { url: 'https://x' });
  assert.ok(tool.function.parameters.properties.phone, 'phone field exists');
  assert.ok(!tool.function.parameters.required.includes('phone'), 'phone stays optional (caller ID is used when present)');
  assert.deepEqual(tool.messages, [{ type: 'request-start', content: TOOL_WAIT_MESSAGE, blocking: false }]);
});

test('old assistants get the current booking tool definitions on the next sync, once', () => {
  const server = { url: 'https://mar-khoor.com/integrations/webhooks/vapi' };
  const oldTool = { type: 'function', function: { name: 'book_appointment', description: 'old', parameters: { type: 'object', properties: { date: { type: 'string' } } } }, server };
  const model = { messages: [{ role: 'system', content: 'Host.' }], tools: [oldTool, { type: 'function', function: { name: 'place_order' }, server }] };
  const next = withBookingTools(model, server);
  const book = next.tools.find(t => t.function?.name === 'book_appointment');
  assert.ok(book.function.parameters.properties.phone, 'refreshed with the phone field');
  assert.equal(next.tools.filter(t => t.function?.name === 'book_appointment').length, 1);
  assert.equal(next.tools.find(t => t.function?.name === 'place_order').function.name, 'place_order', 'other tools untouched');
  assert.equal(withBookingTools(next, server), next, 'no change the second time');
});

test('every call rule asks for a natural, friendly phone style', () => {
  assert.match(CALL_STYLE_RULE, /not a robot/);
  assert.ok(withBookingTools({ messages: [{ role: 'system', content: 'Host.' }], tools: [] }, { url: 'https://x' }).messages[0].content.includes(CALL_STYLE_RULE));
  assert.ok(transferOnlyRule('+923001234567').includes(CALL_STYLE_RULE));
});
