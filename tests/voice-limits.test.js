import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createVoiceCalls, callIdFrom, maxMinutes, minutesLeft } from '../src/voice-limits.js';

const usagePool = () => {
  const recorded = [];
  return { recorded, async execute(sql, params) {
    if (sql.startsWith('INSERT INTO usage_counters')) recorded.push(params[3]);
    return [[]];
  } };
};

test('call id comes from the Location header', () => {
  assert.equal(callIdFrom('/v1/realtime/calls/rtc_abc123XYZ'), 'rtc_abc123XYZ');
  assert.equal(callIdFrom(null), null);
  assert.equal(maxMinutes({}), 5);
  assert.equal(maxMinutes({ WEBSITE_VOICE_MAX_MINUTES: '3' }), 3);
  assert.equal(maxMinutes({ WEBSITE_VOICE_MAX_MINUTES: '999' }), 5);
});

test('a call counts its minutes once and is hung up at the limit', async () => {
  const pool = usagePool(); let clock = 0; const timers = []; const hangups = [];
  const calls = createVoiceCalls({ pool, env: { OPENAI_API_KEY: 'k' }, now: () => clock,
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return { unref() {} }; }, clearTimer() {},
    fetcher: async url => { hangups.push(url.split('/calls/')[1]); return { ok: true }; }, log: { log() {} } });
  await calls.start('rtc_short1', 4);
  clock = 150000; // 2.5 minutes
  assert.equal(await calls.end('rtc_short1', 4), 3);
  assert.deepEqual(pool.recorded, [1, 2], '1 at start + 2 more = 3 minutes');
  assert.equal(await calls.end('rtc_short1', 4), null, 'counted once');
  await calls.start('rtc_long1', 4);
  assert.equal(timers.at(-1).ms, 5 * 60000);
  clock = 150000 + 20 * 60000;
  timers.at(-1).fn(); await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(pool.recorded, [1, 2, 1, 4], 'capped at 5 minutes');
  assert.deepEqual(hangups, ['rtc_short1/hangup', 'rtc_long1/hangup']);
  assert.equal(await calls.end('rtc_other', 9), null);
});

test('another restaurant cannot end a call it does not own', async () => {
  const pool = usagePool();
  const calls = createVoiceCalls({ pool, env: {}, setTimer: () => ({}), clearTimer() {}, fetcher: async () => ({ ok: true }) });
  await calls.start('rtc_mine01', 4);
  assert.equal(await calls.end('rtc_mine01', 5), null);
  assert.equal(calls.size(), 1);
});

test('minutes left: plan minutes, small allowance without a plan, never blocks on errors', async () => {
  const pool = (sub, used) => ({ async execute(sql) {
    if (sql.startsWith('SELECT plan_key')) return [sub ? [{ plan_key: 'starter', billing_cycle: 'monthly', status: 'active', limits: JSON.stringify({ ai_call_minutes: 100 }), currency: 'USD', price_minor: 3900 }] : []];
    if (sql.startsWith('SELECT metric,used')) return [[{ metric: 'ai_call_minutes', used }]];
    return [[]];
  } });
  assert.equal(await minutesLeft(pool(true, 40), 4), 60);
  assert.equal(await minutesLeft(pool(true, 140), 4), 0);
  assert.equal(await minutesLeft(pool(false, 10), 4, { env: {} }), 20);
  assert.equal(await minutesLeft({ async execute() { throw Error('db down'); } }, 4), null);
});

test('route refuses voice when minutes are used up; client stops at the limit', () => {
  const src = readFileSync('src/sites.js', 'utf8');
  assert.match(src, /if \(left === 0\) return res\.set\('X-Voice-Error', 'minutes_used_up'\)\.sendStatus\(429\)/);
  assert.match(src, /assistant\/voice\/end/);
  const client = readFileSync('public/restaurant-assistant-voice.js', 'utf8');
  assert.match(client, /X-Voice-Max-Minutes/);
  assert.match(client, /sendBeacon/);
  assert.match(client, /minutes_used_up/);
});
