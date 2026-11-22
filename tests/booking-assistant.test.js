import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { processWhatsAppAIJobs } from '../src/whatsapp-ai-worker.js';
import { bookingSummary, bookingButtons, parseBookingReply, hoursText, BOOKING_CHAT_SQL } from '../src/booking-assistant.js';
import { withBookingTools, BOOKING_CALL_RULE, VOICE_BOOKING_SQL, businessCallRule } from '../src/voice-bookings.js';

const allDay = JSON.stringify(Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map(d => [d, [[540, 1020]]])));
function clinicPool(job) {
  const queries = [];
  return { queries, async query() { return [[]]; }, async execute(sql, args = []) {
    queries.push({ sql, args });
    if (sql.startsWith('SELECT j.inbound_message_id')) return [[job]];
    if (sql.startsWith('UPDATE whatsapp_ai_jobs j JOIN')) return [{ affectedRows: 1 }];
    if (sql.startsWith('SELECT id,name,description')) return [[]];
    if (sql.startsWith('SELECT s.enabled FROM whatsapp_ai_settings')) return [[{ enabled: 1 }]];
    if (sql.startsWith('SELECT role,text_body')) return [[]];
    if (sql.startsWith('SELECT r.country_code,b.category')) return [[{ country_code: 'PK', category: 'clinic', timezone: null, hours_json: allDay, slot_minutes: 30, bookings_enabled: 1 }]];
    if (sql.startsWith('SELECT s.*,m.category')) return [[{ id: 9, name: 'Check-up', description: null, duration_min: 30, price_minor: 150000, capacity: 1, resource_ids: '[]', active: 1 }]];
    if (sql.startsWith('SELECT x.id,x.name')) return [[]];
    if (sql.startsWith('SELECT id,service_id,resource_id,start_at')) return [[]];
    if (sql.startsWith('INSERT INTO whatsapp_booking_drafts')) return [{ insertId: 55, affectedRows: 1 }];
    return [{ affectedRows: 1, insertId: 31 }];
  } };
}
async function withKeys(fn) {
  const a = process.env.OPENAI_API_KEY, b = process.env.WHATSAPP_ACCESS_TOKEN;
  process.env.OPENAI_API_KEY = 'k'; process.env.WHATSAPP_ACCESS_TOKEN = 't';
  try { await fn(); } finally { if (a === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = a; if (b === undefined) delete process.env.WHATSAPP_ACCESS_TOKEN; else process.env.WHATSAPP_ACCESS_TOKEN = b; }
}

test('clinic on WhatsApp: AI checks free times, proposes, customer gets a booking summary with buttons', () => withKeys(async () => {
  const job = { inbound_message_id: 'wamid.b1', restaurant_id: 12, phone_number_id: '148', sender: '923001234567', message_type: 'text', text_body: 'Kal subah check-up ka time? Naam Sara', name: 'City Clinic', locale: 'en', currency: 'PKR' };
  const pool = clinicPool(job);
  let calls = 0; const sent = [];
  const fetcher = async (url, init) => {
    const body = JSON.parse(init.body);
    if (url.includes('openai')) {
      calls++;
      if (calls === 1) {
        const names = body.tools.map(t => t.function.name);
        assert.deepEqual(names, ['check_availability', 'propose_booking', 'my_bookings', 'cancel_booking', 'reschedule_booking', 'talk_to_staff']);
        assert.match(body.messages[0].content, /clinic/);
        assert.match(body.messages[0].content, /Check-up/);
        return { ok: true, json: async () => ({ choices: [{ message: { content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'check_availability', arguments: JSON.stringify({ service_id: 9, date: '2030-01-07' }) } }] } }] }) };
      }
      const free = JSON.parse(body.messages.at(-1).content);
      assert.equal(free.free_times[0], '09:00');
      return { ok: true, json: async () => ({ choices: [{ message: { content: null, tool_calls: [{ id: 't2', type: 'function', function: { name: 'propose_booking', arguments: JSON.stringify({ service_id: 9, date: '2030-01-07', time: free.free_times[1], customer_name: 'Sara', language: 'roman' }) } }] } }] }) };
    }
    sent.push(body); return { ok: true, json: async () => ({ messages: [{ id: 'wamid.out' }] }) };
  };
  assert.deepEqual(await processWhatsAppAIJobs(pool, { fetcher }), { claimed: 1, sent: 1, failed: 0 });
  assert.equal(calls, 2);
  assert.equal(sent[0].type, 'interactive');
  assert.match(sent[0].interactive.body.text, /Check-up/);
  assert.match(sent[0].interactive.body.text, /2030-01-07 09:30/);
  assert.deepEqual(sent[0].interactive.action.buttons.map(b => b.reply.id), ['mk_bconfirm:55', 'mk_bchange:55']);
}));

test('booking texts, buttons and replies', () => {
  const text = bookingSummary({ service: 'Deluxe room', customer_name: 'Ali', date: '2030-01-07', check_out: '2030-01-09', nights: 2, guests: 2, price_minor: 2000000, language: 'en' }, 'PKR');
  assert.match(text, /2030-01-07 → 2030-01-09 \(2 nights\)/);
  assert.deepEqual(bookingButtons(4, 'ur').map(b => b.reply.id), ['mk_bconfirm:4', 'mk_bchange:4']);
  assert.deepEqual(parseBookingReply('mk_bconfirm:4'), { action: 'confirm', draftId: 4 });
  assert.equal(parseBookingReply('mk_confirm:4'), null);
  assert.match(hoursText({ 1: [[540, 1020]] }), /Mon 09:00-17:00; Tue closed/);
  for (const sql of [...BOOKING_CHAT_SQL, VOICE_BOOKING_SQL]) assert.match(sql, /^CREATE TABLE IF NOT EXISTS /);
});

test('calls: booking tools added once, with the order tool server and the booking rule', () => {
  const server = { url: 'https://mar-khoor.com/integrations/vapi/tools' };
  const model = { messages: [{ role: 'system', content: 'You are a host.' }], tools: [{ type: 'function', function: { name: 'place_order' }, server }] };
  const next = withBookingTools(model, server);
  assert.deepEqual(next.tools.map(t => t.function.name), ['place_order', 'get_business_info', 'check_availability', 'book_appointment', 'my_bookings', 'cancel_booking', 'reschedule_booking']);
  assert.ok(next.tools.every(t => t.server === server));
  assert.ok(next.messages[0].content.includes(BOOKING_CALL_RULE));
  assert.equal(withBookingTools(next, server), next);
  // Changing the type replaces the rule instead of adding a second one.
  const clinic = withBookingTools(next, server, businessCallRule('clinic', 'City Clinic'));
  assert.match(clinic.messages[0].content, /not a restaurant/);
  assert.equal(clinic.messages[0].content.split('[[MK-BUSINESS]]').length, 2);
  assert.ok(clinic.messages[0].content.startsWith('You are a host.'));
  assert.equal(clinic.tools.length, 7);
  const adapter = readFileSync('src/vapi-adapter.js', 'utf8');
  assert.match(adapter, /VOICE_BOOKING_TOOLS\.includes\(name\)/);
  assert.match(readFileSync('src/integrations.js', 'utf8'), /bconfirm\|bchange/);
});
