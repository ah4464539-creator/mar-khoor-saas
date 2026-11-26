import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import mysql from 'mysql2/promise';
import { createLogger, redact, maskText, requestId, reportError, resetErrorThrottle, registerWorker, workerDisabled, heartbeat, workerHealth, resetWorkers, errorTrackingUrl } from '../src/observability.js';
import { securityHeaders, inspectJson, jsonGuard } from '../src/security.js';
import { retentionConfig, validRetentionDays, purgeStatements, purgeOldData, RETENTION_SQL } from '../src/retention.js';

test('structured logs are JSON lines with secrets redacted and numbers masked', () => {
  const lines = [];
  const sink = { log: l => lines.push(['log', l]), warn: l => lines.push(['warn', l]), error: l => lines.push(['error', l]) };
  const logger = createLogger({ sink, base: { service: 'api' }, now: () => new Date('2026-11-26T10:00:00Z') });
  logger.info('order_paid', { order_id: 12, customer: 'call +92 300 1234567', authorization: 'Bearer abc', nested: { api_key: 'sk_live_x' } });
  logger.debug('hidden');
  logger.error('boom', { message: 'Bearer secret-token failed' });
  assert.equal(lines.length, 2);
  const first = JSON.parse(lines[0][1]);
  assert.deepEqual(first, { level: 'info', event: 'order_paid', time: '2026-11-26T10:00:00.000Z', service: 'api', order_id: 12, customer: 'call [number]', authorization: '[redacted]', nested: { api_key: '[redacted]' } });
  assert.equal(lines[1][0], 'error');
  assert.match(JSON.parse(lines[1][1]).message, /Bearer \[redacted\]/);
  assert.equal(maskText('card 4242 4242 4242 4242'), 'card [number]');
  assert.deepEqual(redact({ password: 'x', ok: true }), { password: '[redacted]', ok: true });
  assert.deepEqual(redact({ request_id: 'fd123456-4be0-8fb3-d123456789ab', order_id: 1234567, note: '+923001234567' }), { request_id: 'fd123456-4be0-8fb3-d123456789ab', order_id: 1234567, note: '[number]' });
  assert.deepEqual(redact({ expired_reset_links: 3, passed: 2 }), { expired_reset_links: 3, passed: 2 });
});

test('every request gets a safe request id', () => {
  const run = incoming => { const headers = {}; const req = { get: () => incoming }; requestId(req, { set: (k, v) => { headers[k] = v; } }, () => {}); return [req.id, headers['X-Request-Id']]; };
  assert.deepEqual(run('abc-123-def-456'), ['abc-123-def-456', 'abc-123-def-456']);
  const [generated] = run('<script>');
  assert.match(generated, /^[0-9a-f-]{36}$/);
});

test('error tracking posts to an https webhook only, masked and throttled', async () => {
  resetErrorThrottle();
  const sent = [];
  const fetcher = async (url, options) => { sent.push({ url, body: JSON.parse(options.body) }); return { ok: true }; };
  assert.equal(await reportError(new Error('x'), {}, { env: {}, fetcher }), false);
  assert.equal(errorTrackingUrl({ ERROR_TRACKING_WEBHOOK_URL: 'http://insecure.example/hook' }), null);
  const env = { ERROR_TRACKING_WEBHOOK_URL: 'https://hooks.example.com/abc', APP_RELEASE: 'v1' };
  assert.equal(await reportError(new Error('Customer +923001234567 failed'), { path: '/api/x', method: 'POST', token: 'secret' }, { env, fetcher, now: 1000 }), true);
  assert.equal(await reportError(new Error('Customer +923001234567 failed'), { path: '/api/x', method: 'POST' }, { env, fetcher, now: 2000 }), false, 'same error within a minute is not repeated');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.message, 'Customer [number] failed');
  assert.equal(sent[0].body.token, '[redacted]');
  assert.equal(sent[0].body.release, 'v1');
  assert.match(sent[0].body.text, /^\[mar-khoor\] Error: Customer \[number\] failed/);
  resetErrorThrottle();
  assert.equal(await reportError(new Error('down'), {}, { env, fetcher: async () => { throw Error('network'); } }), false, 'never throws');
});

test('worker health: ok, failing, stale, starting and disabled', () => {
  resetWorkers();
  const now = Date.now();
  registerWorker('ok_worker', { intervalMs: 60000 }); heartbeat('ok_worker', { now });
  registerWorker('failing_worker', { intervalMs: 60000 }); heartbeat('failing_worker', { ok: false, error: Object.assign(Error('x'), { code: 'ECONNREFUSED' }), now });
  registerWorker('stale_worker', { intervalMs: 60000 }); heartbeat('stale_worker', { now: now - 10 * 60000 });
  registerWorker('new_worker', { intervalMs: 60000 });
  workerDisabled('off_worker', 'missing key');
  const health = workerHealth(now);
  const status = Object.fromEntries(health.workers.map(w => [w.name, w.status]));
  assert.deepEqual(status, { ok_worker: 'ok', failing_worker: 'failing', stale_worker: 'stale', new_worker: 'starting', off_worker: 'disabled' });
  assert.equal(health.status, 'degraded');
  assert.equal(health.workers.find(w => w.name === 'failing_worker').last_error, 'ECONNREFUSED');
  resetWorkers();
  registerWorker('ok_worker', { intervalMs: 60000 }); heartbeat('ok_worker', { now });
  assert.equal(workerHealth(now).status, 'ok');
  resetWorkers();
});

test('security headers and JSON guard', async () => {
  const headers = {};
  securityHeaders({ secure: true }, { set: (k, v) => { headers[k] = v; } }, () => {});
  assert.equal(headers['Content-Security-Policy'], "object-src 'none'; base-uri 'self'");
  assert.equal(headers['X-Permitted-Cross-Domain-Policies'], 'none');
  assert.equal(headers['Strict-Transport-Security'], 'max-age=15552000');
  assert.equal(inspectJson(JSON.parse('{"a":{"__proto__":{"admin":true}}}')), 'forbidden key');
  assert.equal(inspectJson({ constructor: { prototype: {} } }), 'forbidden key');
  let deep = {}; for (let i = 0; i < 30; i++) deep = { d: deep };
  assert.equal(inspectJson(deep), 'too deep');
  assert.equal(inspectJson({ items: [{ menu_item_id: 1, quantity: 2 }] }), null);
  const app = express(); app.use(express.json()); app.use(jsonGuard); app.post('/x', (req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const url = 'http://127.0.0.1:' + server.address().port + '/x';
  try {
    assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"__proto__":{"isAdmin":true}}' })).status, 400);
    assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":"Ali"}' })).status, 200);
  } finally { await new Promise(r => server.close(r)); }
});

test('server wires request ids, logs, limits, JSON guard, worker health and retention', () => {
  const server = readFileSync('src/server.js', 'utf8');
  for (const text of ['app.use(requestId)', 'app.use(requestLog())', 'installProcessHandlers()', "name: 'webhooks'", "name: 'baseline'", 'app.use(jsonGuard)', "app.get('/health/workers'", 'app.get(\'/health/database\'', 'startRetentionWorker(pool)', 'privacyRouter(pool)'])
    assert.ok(server.includes(text), text);
  assert.ok(server.indexOf("name: 'webhooks'") < server.indexOf("app.use('/integrations', integrationRouter(pool))"), 'webhook limit before the webhook routes');
  assert.ok(server.indexOf('express.static(') < server.indexOf("name: 'baseline'"), 'static files are not counted by the baseline limit');
});

test('retention settings: defaults, owner range, every step defined', () => {
  assert.deepEqual(retentionConfig({}), { messages: 90, transcripts: 30, audit: 365 });
  assert.deepEqual(retentionConfig({ MESSAGE_RETENTION_DAYS: '14', TRANSCRIPT_RETENTION_DAYS: 'x' }), { messages: 14, transcripts: 30, audit: 365 });
  assert.deepEqual(validRetentionDays(30), { value: 30 });
  assert.deepEqual(validRetentionDays(null), { value: null });
  for (const bad of [3, 400, 7.5, '30']) assert.ok(validRetentionDays(bad).error, String(bad));
  const steps = purgeStatements(retentionConfig({})).map(([step]) => step);
  assert.deepEqual(steps, ['whatsapp_inbound_text', 'whatsapp_outbound_text', 'call_transcripts', 'call_transcript_lines', 'call_summaries', 'expired_sessions', 'expired_reset_links', 'audit_logs']);
  assert.ok(readFileSync('db/migrations/2026-11-26-retention.sql', 'utf8').includes(RETENTION_SQL));
  assert.match(readFileSync('scripts/purge-old-data.js', 'utf8'), /purgeOldData/);
});

test('retention skips tables that do not exist yet', async () => {
  const pool = { async query(sql) { if (/voice_call_(transcript_lines|details)/.test(sql)) throw Object.assign(Error('missing'), { code: 'ER_NO_SUCH_TABLE' }); return [{ affectedRows: 1 }]; } };
  const quiet = { info() {} };
  const result = await purgeOldData(pool, { env: {}, logger: quiet });
  assert.equal(result.call_transcript_lines, 'skipped');
  assert.equal(result.call_summaries, 'skipped');
  assert.equal(result.whatsapp_inbound_text, 1);
  const broken = { async query(sql) { if (sql.startsWith('CREATE')) return [{}]; throw Object.assign(Error('down'), { code: 'ECONNREFUSED' }); } };
  await assert.rejects(purgeOldData(broken, { env: {}, logger: quiet }), /down/);
});

test('privacy page states the real retention periods and processors', () => {
  const html = readFileSync('public/privacy.html', 'utf8');
  for (const text of ['90 days', '30 days', 'between 7 and 365 days', 'OpenAI', 'Meta', 'Vapi', 'Stripe', 'Hostinger', 'STOP']) assert.ok(html.includes(text), text);
});

const enabled = process.env.DB_INTEGRATION_TEST === '1';
test('retention on MariaDB clears old message text, honours the restaurant setting, keeps rows', { skip: !enabled }, async () => {
  const pool = mysql.createPool({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectionLimit: 2 });
  const tag = 'ret' + process.pid + Date.now();
  const ids = [];
  try {
    for (const name of ['A', 'B']) {
      const [r] = await pool.execute("INSERT INTO restaurants(name,slug,country_code,currency,locale) VALUES (?,?,'PK','PKR','en')", ['Ret ' + name, tag + name]);
      ids.push(r.insertId);
    }
    const [a, b] = ids;
    const message = (rid, suffix, daysOld) => pool.execute("INSERT INTO whatsapp_inbound_messages(message_id,restaurant_id,phone_number_id,sender,message_type,text_body,received_at) VALUES (?,?,'1','923001234567','text','hello',NOW()-INTERVAL ? DAY)", ['wamid.' + tag + suffix, rid, daysOld]);
    await message(a, 'a-old', 100); await message(a, 'a-new', 10); await message(b, 'b-mid', 20);
    await purgeOldData(pool, { env: {}, logger: { info() {} } });
    const text = async suffix => (await pool.execute('SELECT text_body FROM whatsapp_inbound_messages WHERE message_id=?', ['wamid.' + tag + suffix]))[0][0];
    assert.equal((await text('a-old')).text_body, null, 'older than 90 days: text removed, row kept');
    assert.equal((await text('a-new')).text_body, 'hello');
    assert.equal((await text('b-mid')).text_body, 'hello');
    const { setRetention } = await import('../src/retention.js');
    await setRetention(pool, b, 14);
    await purgeOldData(pool, { env: {}, logger: { info() {} } });
    assert.equal((await text('b-mid')).text_body, null, "restaurant's own 14-day setting applies");
    assert.equal((await text('a-new')).text_body, 'hello', 'other restaurants keep the default');
  } finally {
    for (const id of ids) await pool.execute('DELETE FROM restaurants WHERE id=?', [id]).catch(() => {});
    await pool.end();
  }
});
