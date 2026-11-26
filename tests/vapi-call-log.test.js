import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import { callDetails, billableMinutes, transcriptLine, CALL_LOG_SQL, callExtras } from '../src/vapi-call-log.js';
import { parseVapiEvent, processVapiEvent } from '../src/vapi-events.js';
import { integrationRouter } from '../src/integrations.js';
import { withBookingTools, transferOnlyRule } from '../src/voice-bookings.js';
import { TOOL_ALIASES } from '../src/vapi-tool-runner.js';

const call = { id: 'call-1', assistantId: 'asst-1' };

// A mock MariaDB pool: records every statement and answers by SQL prefix.
function mockPool({ transferPhone = '', claimMinutes = true } = {}) {
  const queries = [];
  const pool = {
    queries,
    async query(sql, args) { queries.push({ sql, args }); return [[]]; },
    async execute(sql, args = []) {
      queries.push({ sql, args });
      if (sql.includes('FROM voice_assistants')) return [[{ restaurant_id: 42, id: 42, name: 'Cafe', currency: 'PKR', locale: 'ur' }]];
      if (sql.startsWith('SELECT transfer_phone')) return [[transferPhone ? { transfer_phone: transferPhone } : undefined].filter(Boolean)];
      if (sql.startsWith('SELECT id,name,description,price_minor FROM menu_items')) return [[{ id: 1, name: 'Biryani', description: '', price_minor: 50000 }]];
      if (sql.startsWith('UPDATE voice_call_details SET minutes_recorded')) return [{ affectedRows: claimMinutes ? 1 : 0 }];
      return [{ affectedRows: 1 }];
    },
  };
  return pool;
}

test('callDetails reads caller, duration, summary and an https recording only', () => {
  const d = callDetails({ type: 'end-of-call-report', call: { ...call, customer: { number: '+92 300 1234567' } }, durationSeconds: 125.4,
    analysis: { summary: '  Ordered 2 biryani.  ' }, artifact: { recordingUrl: 'https://storage.vapi.ai/rec.wav' } });
  assert.deepEqual(d, { callerNumber: '+923001234567', durationSeconds: 125, summary: 'Ordered 2 biryani.', recordingUrl: 'https://storage.vapi.ai/rec.wav' });
  assert.equal(callDetails({ durationMs: 61000 }).durationSeconds, 61);
  assert.equal(callDetails({ startedAt: '2026-11-26T10:00:00Z', endedAt: '2026-11-26T10:01:30Z' }).durationSeconds, 90);
  assert.equal(callDetails({ artifact: { recordingUrl: 'http://insecure.example/rec.wav' } }).recordingUrl, null);
  assert.equal(callDetails({ artifact: { recordingUrl: 'javascript:alert(1)' } }).recordingUrl, null);
  assert.equal(callDetails({ customer: { number: 'not a number' } }).callerNumber, null);
  assert.equal(callDetails({ durationSeconds: -5 }).durationSeconds, null);
});

test('billableMinutes rounds every started minute up and ignores unconnected calls', () => {
  assert.equal(billableMinutes(null), 0);
  assert.equal(billableMinutes(0), 0);
  assert.equal(billableMinutes(1), 1);
  assert.equal(billableMinutes(60), 1);
  assert.equal(billableMinutes(61), 2);
});

test('only final transcript lines are kept', () => {
  assert.deepEqual(transcriptLine({ type: 'transcript', transcriptType: 'final', role: 'user', transcript: ' Salam ' }), { role: 'user', text: 'Salam' });
  assert.deepEqual(transcriptLine({ type: 'transcript[transcriptType="final"]', role: 'assistant', transcript: 'Ji' }), { role: 'assistant', text: 'Ji' });
  assert.equal(transcriptLine({ type: 'transcript', transcriptType: 'partial', role: 'user', transcript: 'Sal' }), null);
  assert.equal(transcriptLine({ type: 'transcript', transcriptType: 'final', role: 'system', transcript: 'x' }), null);
  assert.equal(parseVapiEvent({ message: { type: 'transcript', transcriptType: 'final', role: 'user', transcript: 'hi', call } }).kind, 'transcript');
});

test('end-of-call report stores details and meters call minutes exactly once', async () => {
  const pool = mockPool();
  const report = { message: { type: 'end-of-call-report', endedReason: 'customer-ended-call', call, durationSeconds: 130, customer: { number: '+923001234567' } } };
  assert.deepEqual(await processVapiEvent(pool, report), { processed: true });
  const usage = pool.queries.filter(q => q.sql.startsWith('INSERT INTO usage_counters'));
  assert.equal(usage.length, 1);
  assert.deepEqual([usage[0].args[0], usage[0].args[2], usage[0].args[3]], [42, 'ai_call_minutes', 3]);
  const details = pool.queries.find(q => q.sql.startsWith('INSERT INTO voice_call_details'));
  assert.deepEqual(details.args.slice(0, 5), ['asst-1', 'call-1', 42, '+923001234567', 130]);

  const replay = mockPool({ claimMinutes: false });
  await processVapiEvent(replay, report);
  assert.equal(replay.queries.filter(q => q.sql.startsWith('INSERT INTO usage_counters')).length, 0);
});

test('final transcript lines are stored for the mapped restaurant', async () => {
  const pool = mockPool();
  const result = await processVapiEvent(pool, { message: { type: 'transcript', transcriptType: 'final', role: 'user', transcript: 'Do biryani', call, restaurant_id: 999 } });
  assert.deepEqual(result, { processed: true });
  const insert = pool.queries.find(q => q.sql.startsWith('INSERT INTO voice_call_transcript_lines'));
  assert.deepEqual(insert.args, ['asst-1', 'call-1', 42, 'user', 'Do biryani']);
});

async function withWebhook(pool, fn) {
  const previous = process.env.VAPI_WEBHOOK_SECRET;
  process.env.VAPI_WEBHOOK_SECRET = 'webhook-test-secret';
  const app = express(); app.use('/integrations', integrationRouter(pool));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const url = 'http://127.0.0.1:' + server.address().port + '/integrations/webhooks/vapi';
  const send = (body, auth = 'Bearer webhook-test-secret') => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth }, body: JSON.stringify(body) });
  try { await fn(send); }
  finally {
    await new Promise(r => server.close(r));
    if (previous === undefined) delete process.env.VAPI_WEBHOOK_SECRET; else process.env.VAPI_WEBHOOK_SECRET = previous;
  }
}

test('webhook answers tool-calls with the restaurant menu from the server-side mapping', async () => {
  const pool = mockPool();
  await withWebhook(pool, async send => {
    assert.equal((await send({ message: { type: 'tool-calls', call, toolCallList: [{ id: 't1', function: { name: 'get_menu' } }] } }, 'Bearer nope')).status, 401);
    const response = await send({ message: { type: 'tool-calls', call, toolCallList: [{ id: 't1', function: { name: 'get_menu', arguments: '{"restaurant_id":999}' } }, { id: 't2', function: { name: 'delete_everything' } }] } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.results[0].toolCallId, 't1');
    assert.equal(JSON.parse(body.results[0].result).items[0].name, 'Biryani');
    assert.deepEqual(body.results[1], { toolCallId: 't2', error: 'Unsupported tool' });
    assert.ok(!pool.queries.some(q => (q.args || []).includes(999)));
    assert.equal((await send({ message: { type: 'tool-calls', call, toolCallList: [] } })).status, 400);
  });
});

test('create_order and create_table_booking are aliases of the existing order and booking tools', () => {
  assert.equal(TOOL_ALIASES.create_order, 'place_order');
  assert.equal(TOOL_ALIASES.create_table_booking, 'book_appointment');
});

test('transfer requests go to the restaurant reception number, or explain there is none', async () => {
  await withWebhook(mockPool({ transferPhone: '+923001112223' }), async send => {
    const response = await send({ message: { type: 'transfer-destination-request', call } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { destination: { type: 'number', number: '+923001112223', message: 'Connecting you to our staff now.' } });
  });
  await withWebhook(mockPool(), async send => {
    const body = await (await send({ message: { type: 'transfer-destination-request', call } })).json();
    assert.match(body.error, /No staff number/);
    const bad = await (await send({ message: { type: 'transfer-destination-request', call: { id: 'bad id!', assistantId: 'asst-1' } } })).json();
    assert.deepEqual(bad, { error: 'Invalid call' });
  });
});

test('restaurants without bookings get only the transfer tool, never the booking tools', () => {
  const model = { tools: [{ type: 'function', function: { name: 'place_order' } }], messages: [{ role: 'system', content: 'You take orders.' }] };
  const next = withBookingTools(model, null, transferOnlyRule('+923001112223'), '+923001112223', { bookings: false });
  assert.deepEqual(next.tools.map(t => t.type === 'transferCall' ? 'transferCall' : t.function.name), ['place_order', 'transferCall']);
  assert.match(next.messages[0].content, /transferCall/);
  assert.doesNotMatch(next.messages[0].content, /BOOKINGS/);
});

test('call extras are scoped to the restaurant and never fail the dashboard', async () => {
  const pool = mockPool();
  const extras = await callExtras(pool, 42, { assistantId: 'asst-1', callId: 'call-1' });
  assert.deepEqual(extras.lines, []);
  assert.ok(pool.queries.filter(q => q.sql.startsWith('SELECT')).every(q => q.args.includes(42)));
  const broken = { async query() { throw Object.assign(Error('down'), { code: 'ECONNREFUSED' }); }, async execute() { throw Error('down'); } };
  assert.deepEqual(await callExtras(broken, 42, { assistantId: 'a', callId: 'c' }), { lines: [] });
});

test('the migration file creates the same tables the app creates on first use', () => {
  const sql = readFileSync('db/migrations/2026-11-26-vapi-call-log.sql', 'utf8');
  for (const statement of CALL_LOG_SQL) assert.ok(sql.includes(statement));
});

test('dashboard shows AI call history with text-only rendering', () => {
  const html = readFileSync('public/restaurant.html', 'utf8');
  assert.match(html, /href="#call-history"/);
  assert.match(html, /id="call-history"/);
  assert.match(html, /\/call-history\.js\?v=/);
  const js = readFileSync('public/call-history.js', 'utf8');
  assert.doesNotMatch(js, /innerHTML/);
  assert.match(readFileSync('public/restaurant.js', 'utf8'), /mkCallHistory\?\.init/);
});
