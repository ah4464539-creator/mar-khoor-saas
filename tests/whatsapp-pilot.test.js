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
