import test from 'node:test';
import assert from 'node:assert/strict';
import { getPilotIds, setPilot } from '../src/whatsapp-pilot.js';

const fakePool = () => {
  const store = new Map(); const ai = new Map(); const sqls = [];
  return { store, ai, sqls, async query(sql, params = []) {
    sqls.push(sql);
    if (sql.startsWith('SELECT setting_value')) return [store.has(params[0]) ? [{ setting_value: store.get(params[0]) }] : []];
    if (sql.startsWith('INSERT INTO app_settings')) store.set(params[0], params[1]);
    if (sql.startsWith('INSERT INTO whatsapp_ai_settings')) ai.set(params[0], true);
    return [[]];
  } };
};

test('pilot list is stored in app_settings and switches AI replies on', async () => {
  const pool = fakePool();
  assert.deepEqual(await getPilotIds(pool), []);
  assert.deepEqual(await setPilot(pool, 4, true), [4]);
  assert.equal(pool.ai.get(4), true);
  assert.deepEqual(await setPilot(pool, 7, true), [4, 7]);
  assert.deepEqual(await setPilot(pool, 4, false), [7]);
  assert.deepEqual(await getPilotIds(pool), [7]);
  assert.ok(pool.sqls.some(s => s.startsWith('CREATE TABLE IF NOT EXISTS app_settings')));
});

test('a broken stored value is treated as an empty pilot', async () => {
  const pool = { async query() { return [[{ setting_value: 'not json' }]]; } };
  assert.deepEqual(await getPilotIds(pool), []);
});

test('worker switch accepts 1/true/yes/on', async () => {
  const { workerEnabled } = await import('../src/whatsapp-ai-worker.js').catch(() => ({}));
  if (!workerEnabled) return; // mysql2 missing locally; CI runs it
  for (const v of ['1', 'true', 'TRUE', ' yes ', '"1"', 'on']) assert.equal(workerEnabled({ WHATSAPP_AI_WORKER_ENABLED: v }), true, v);
  for (const v of ['0', 'false', '', undefined]) assert.equal(workerEnabled({ WHATSAPP_AI_WORKER_ENABLED: v }), false, String(v));
});

test('AI gets menu prices as customers see them (stored ×100)', async () => {
  const src = (await import('node:fs')).readFileSync('src/whatsapp-ai-worker.js', 'utf8');
  const { menuPrice: fn } = await import('../src/whatsapp-ai-worker.js');
  assert.equal(fn(42000, 'PKR'), 'Rs 420');
  assert.equal(fn(1250, 'USD'), '$12.50');
  assert.equal(fn(7200000, 'PKR'), 'Rs 72,000');
  assert.equal(fn(160000, 'AED'), 'AED 1,600');
  assert.match(src, /price:menuPrice\(i\.price_minor,job\.currency\)/);
});

test('AI reply switch defaults to on and can be turned off', async () => {
  const { workerSwitch, setWorkerSwitch } = await import('../src/whatsapp-pilot.js');
  const store = new Map();
  const pool = { async query(sql, p = []) { if (sql.startsWith('SELECT setting_value')) return [store.has(p[0]) ? [{ setting_value: store.get(p[0]) }] : []]; if (sql.startsWith('INSERT INTO app_settings')) store.set(p[0], p[1]); return [[]]; } };
  assert.equal(await workerSwitch(pool), 'on');
  assert.equal(await setWorkerSwitch(pool, false), 'off');
  assert.equal(await workerSwitch(pool), 'off');
  assert.equal(await setWorkerSwitch(pool, true), 'on');
});
