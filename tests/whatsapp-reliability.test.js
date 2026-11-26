import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import mysql from 'mysql2/promise';
import { detectLanguage, languageRule, consentCommand, asksForHuman, fixedReply } from '../src/whatsapp-language.js';
import { backoffSeconds, classifyFailure, retryConfig, RELIABILITY_SQL } from '../src/whatsapp-reliability.js';
import { validateTemplate, templatePayload, orderStatusTemplate } from '../src/whatsapp-templates.js';
import { processWhatsAppAIJobs } from '../src/whatsapp-ai-worker.js';

test('replies match the customer language: Urdu, Roman Urdu, English, Arabic', () => {
  assert.equal(detectLanguage('مجھے دو بریانی چاہیے'), 'ur');
  assert.equal(detectLanguage('السلام عليكم، أريد بيتزا كبيرة'), 'ar');
  assert.equal(detectLanguage('mujhe 2 biryani chahiye'), 'roman_ur');
  assert.equal(detectLanguage('Kitne ka hai?'), 'roman_ur');
  assert.equal(detectLanguage('I want the main course, do you deliver?'), 'en');
  assert.equal(detectLanguage('👍'), null);
  assert.match(languageRule('roman_ur'), /Roman Urdu/);
  assert.equal(languageRule(null), '');
});

test('only an exact STOP / band karo keyword changes consent', () => {
  for (const t of ['STOP', 'stop.', 'Band karo', 'band kar do', 'بند کرو', 'إيقاف', 'unsubscribe']) assert.equal(consentCommand(t), 'stop', t);
  for (const t of ['START', 'shuru karo', 'ابدأ']) assert.equal(consentCommand(t), 'start', t);
  for (const t of ['stop the onions please', 'bus stop ke paas delivery', 'start my order']) assert.equal(consentCommand(t), null, t);
  assert.match(fixedReply('stop', 'roman_ur'), /START/);
  assert.match(fixedReply('stop', 'xx'), /START/);
});

test('asking for a person is recognised in all four languages', () => {
  for (const t of ['Can I talk to a human?', 'mujhe kisi insaan se baat karni hai', 'manager se baat karao', 'مجھے کسی انسان سے بات کرنی ہے', 'أريد التحدث مع موظف'])
    assert.equal(asksForHuman(t), true, t);
  assert.equal(asksForHuman('2 zinger burger chahiye'), false);
});

test('backoff doubles and is capped; only safe failures are retried', () => {
  const config = { ...retryConfig({}), baseSeconds: 30, maxSeconds: 900 };
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(n => backoffSeconds(n, config)), [30, 60, 120, 240, 480, 900, 900]);
  assert.equal(retryConfig({ WHATSAPP_AI_MAX_ATTEMPTS: '3' }).maxAttempts, 3);
  assert.equal(retryConfig({ WHATSAPP_AI_MAX_ATTEMPTS: 'lots' }).maxAttempts, 5);
  // Before the send lock: anything temporary is retried.
  assert.equal(classifyFailure(Error('AI provider unavailable (OpenAI 503)'), { sendStarted: false }), 'retry');
  assert.equal(classifyFailure(Error('Empty message'), { sendStarted: false }), 'dead');
  // After the send lock: only a Meta error reply that is temporary.
  assert.equal(classifyFailure(Object.assign(Error('x'), { metaStatus: 503 }), { sendStarted: true }), 'retry');
  assert.equal(classifyFailure(Object.assign(Error('x'), { metaStatus: 429 }), { sendStarted: true }), 'retry');
  assert.equal(classifyFailure(Object.assign(Error('x'), { metaStatus: 400 }), { sendStarted: true }), 'dead');
  assert.equal(classifyFailure(Error('The operation was aborted due to timeout'), { sendStarted: true }), 'dead');
});

test('templates are validated before anything is sent', () => {
  assert.deepEqual(validateTemplate({ name: 'order_update', language: 'ur', params: ['#12', 'ready'] }).value, { name: 'order_update', language: 'ur', params: ['#12', 'ready'] });
  assert.ok(validateTemplate({ name: 'Order Update' }).error);
  assert.ok(validateTemplate({ name: 'ok', language: 'urdu' }).error);
  assert.ok(validateTemplate({ name: 'ok', params: ['line\nbreak'] }).error);
  assert.deepEqual(templatePayload('923001234567', { name: 'order_update', language: 'en', params: ['#1'] }),
    { to: '923001234567', type: 'template', template: { name: 'order_update', language: { code: 'en' }, components: [{ type: 'body', parameters: [{ type: 'text', text: '#1' }] }] } });
  assert.equal(orderStatusTemplate(5, 'ready', {}), null);
  assert.equal(orderStatusTemplate(5, 'ready', { WHATSAPP_ORDER_STATUS_TEMPLATE: 'order_update' }).params[0], '#5');
});

test('the migration file creates the same tables the app creates on first use', () => {
  const sql = readFileSync('db/migrations/2026-11-26-whatsapp-reliability.sql', 'utf8');
  for (const statement of RELIABILITY_SQL) assert.ok(sql.includes(statement));
});

// ---- Real database: the worker never sends twice, retries safely, honours STOP ----
const enabled = process.env.DB_INTEGRATION_TEST === '1';
test('worker on MariaDB: retry with backoff, never twice, crash recovery, dead-letter, STOP', { skip: !enabled }, async () => {
  const pool = mysql.createPool({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectionLimit: 4 });
  const env = { OPENAI_API_KEY: process.env.OPENAI_API_KEY, WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN };
  process.env.OPENAI_API_KEY = 'test-ai-key'; process.env.WHATSAPP_ACCESS_TOKEN = 'test-meta-token';
  const tag = 'rel' + process.pid + Date.now();
  const phoneId = String(Date.now()).slice(-12);
  let restaurantId;
  try {
    const [r] = await pool.execute("INSERT INTO restaurants(name,slug,country_code,currency,locale) VALUES ('Rel Cafe',?,'PK','PKR','en')", [tag]);
    restaurantId = r.insertId;
    await pool.execute('INSERT INTO whatsapp_numbers(phone_number_id,restaurant_id,active) VALUES (?,?,1)', [phoneId, restaurantId]);
    await pool.execute('INSERT INTO whatsapp_ai_settings(restaurant_id,enabled) VALUES (?,1)', [restaurantId]);
    await pool.execute("INSERT INTO menu_items(restaurant_id,name,price_minor) VALUES (?,'Biryani',50000)", [restaurantId]);
    let n = 0;
    const inbound = async (text, sender = '923001234567') => {
      const id = 'wamid.' + tag + '-' + (++n);
      await pool.execute("INSERT INTO whatsapp_inbound_messages(message_id,restaurant_id,phone_number_id,sender,message_type,text_body) VALUES (?,?,?,?,'text',?)", [id, restaurantId, phoneId, sender, text]);
      await pool.execute('INSERT INTO whatsapp_ai_jobs(inbound_message_id,restaurant_id) VALUES (?,?)', [id, restaurantId]);
      return id;
    };
    const job = async id => (await pool.execute('SELECT j.status,j.last_error,st.attempts,st.dead_letter,st.send_started_at,st.next_attempt_at FROM whatsapp_ai_jobs j LEFT JOIN whatsapp_job_state st ON st.inbound_message_id=j.inbound_message_id WHERE j.inbound_message_id=?', [id]))[0][0];
    let metaStatus = 500, metaCalls = 0, aiCalls = 0, lastAi = null;
    const fetcher = async (url, options) => {
      if (url.includes('api.openai.com')) { aiCalls++; lastAi = JSON.parse(options.body); return { ok: true, json: async () => ({ choices: [{ message: { content: 'Ji, Biryani Rs 500 hai.' } }] }) }; }
      metaCalls++;
      if (metaStatus !== 200) return { ok: false, status: metaStatus, json: async () => ({ error: { message: 'temporary' } }) };
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.out-' + tag + '-' + metaCalls }] }) };
    };
    const run = () => processWhatsAppAIJobs(pool, { fetcher, restaurantId });

    // 1) Meta answers 500: not accepted, so the lock is released and the job retries later.
    const first = await inbound('Biryani kitne ki hai?');
    await run();
    let state = await job(first);
    assert.equal(state.status, 'pending');
    assert.equal(state.attempts, 1);
    assert.equal(state.send_started_at, null);
    assert.ok(state.next_attempt_at, 'retry is scheduled');
    assert.match(lastAi.messages[0].content, /Roman Urdu/, 'language rule in the prompt');
    await run();
    assert.equal(metaCalls, 1, 'not retried before its backoff time');
    await pool.execute('UPDATE whatsapp_job_state SET next_attempt_at=NOW()-INTERVAL 1 SECOND WHERE inbound_message_id=?', [first]);
    metaStatus = 200;
    await run();
    state = await job(first);
    assert.equal(state.status, 'sent');
    assert.equal(state.attempts, 2);
    const [[usage]] = await pool.execute("SELECT used FROM usage_counters WHERE restaurant_id=? AND metric='whatsapp_messages'", [restaurantId]);
    assert.equal(Number(usage.used), 1, 'AI replies are metered');

    // 2) Crash while sending: the lock is taken but the job is stuck in processing. Never sent again.
    const crashed = await inbound('Aur kya hai menu mein?');
    await pool.execute("UPDATE whatsapp_ai_jobs SET status='processing' WHERE inbound_message_id=?", [crashed]);
    await pool.execute('INSERT INTO whatsapp_job_state(inbound_message_id,restaurant_id,attempts,claimed_at,send_started_at) VALUES (?,?,1,NOW()-INTERVAL 20 MINUTE,NOW()-INTERVAL 20 MINUTE)', [crashed, restaurantId]);
    const before = metaCalls;
    await run();
    state = await job(crashed);
    assert.equal(state.status, 'failed');
    assert.equal(state.dead_letter, 1);
    assert.equal(metaCalls, before, 'a possibly-sent reply is never sent twice');

    // 3) Crash before sending (no lock): safely requeued and answered.
    const requeue = await inbound('Delivery hoti hai?');
    await pool.execute("UPDATE whatsapp_ai_jobs SET status='processing' WHERE inbound_message_id=?", [requeue]);
    await pool.execute('INSERT INTO whatsapp_job_state(inbound_message_id,restaurant_id,attempts,claimed_at) VALUES (?,?,1,NOW()-INTERVAL 20 MINUTE)', [requeue, restaurantId]);
    await run();
    assert.equal((await job(requeue)).status, 'sent');

    // 4) Permanent Meta rejection (400): dead-letter, no retry.
    metaStatus = 400;
    const rejected = await inbound('Hello?', '923009999999');
    await run();
    state = await job(rejected);
    assert.equal(state.status, 'failed');
    assert.equal(state.dead_letter, 1);
    metaStatus = 200;

    // 5) STOP: confirmation, then silence (no AI call, no Meta call) until START.
    const stop = await inbound('band karo', '923007777777');
    const aiBefore = aiCalls;
    await run();
    assert.equal((await job(stop)).status, 'sent');
    assert.equal(aiCalls, aiBefore, 'STOP is answered without the AI');
    const [[contact]] = await pool.execute('SELECT opted_out FROM whatsapp_contacts WHERE restaurant_id=? AND customer=?', [restaurantId, '923007777777']);
    assert.equal(contact.opted_out, 1);
    const quiet = await inbound('menu?', '923007777777');
    const metaBefore = metaCalls;
    await run();
    assert.equal(metaCalls, metaBefore, 'opted-out customer gets no automatic reply');
    assert.match((await job(quiet)).last_error, /opted out/);
    await inbound('START', '923007777777');
    await run();
    assert.equal(metaCalls, metaBefore + 1);
    const [[again]] = await pool.execute('SELECT opted_out FROM whatsapp_contacts WHERE restaurant_id=? AND customer=?', [restaurantId, '923007777777']);
    assert.equal(again.opted_out, 0);

    // 6) Asking for a person: handover without the AI, then the AI stays quiet.
    const aiBeforeHuman = aiCalls;
    await inbound('mujhe kisi insaan se baat karni hai', '923006666666');
    await run();
    assert.equal(aiCalls, aiBeforeHuman);
    const [handover] = await pool.execute('SELECT 1 FROM whatsapp_handover WHERE restaurant_id=? AND customer=?', [restaurantId, '923006666666']);
    assert.equal(handover.length, 1);
  } finally {
    if (restaurantId) await pool.execute('DELETE FROM restaurants WHERE id=?', [restaurantId]).catch(() => {});
    for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await pool.end();
  }
});
