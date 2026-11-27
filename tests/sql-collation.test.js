import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import mysql from 'mysql2/promise';

// Production MariaDB rejects comparing a bound value with a string literal when the client and
// connection collations differ ("Illegal mix of collations"). Decide such conditions in JavaScript.
const PATTERN = /\?\s*(=|<>|!=)\s*'[^']*'|'[^']*'\s*(=|<>|!=)\s*\?|\?\s+IN\s*\(\s*'/;

test('no SQL compares a bound value with a string literal', () => {
  const files = ['src', 'src/payments'].flatMap(dir => readdirSync(dir).filter(f => f.endsWith('.js')).map(f => dir + '/' + f));
  const hits = [];
  for (const file of files) readFileSync(file, 'utf8').split('\n').forEach((line, i) => { if (PATTERN.test(line)) hits.push(file + ':' + (i + 1)); });
  assert.deepEqual(hits, []);
});

const enabled = process.env.DB_INTEGRATION_TEST === '1';
test('Vapi status updates work with mismatched collations (as on production)', { skip: !enabled }, async () => {
  const { processVapiEvent } = await import('../src/vapi-events.js');
  const pool = mysql.createPool({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectionLimit: 1, charset: 'UTF8MB4_UNICODE_CI' });
  pool.pool.on('connection', c => c.query("SET collation_connection='utf8mb4_general_ci'"));
  const tag = 'coll' + process.pid + Date.now(), assistant = 'asst-' + tag, call = 'call-' + tag;
  let restaurantId;
  try {
    // The old query fails here exactly like production did.
    await assert.rejects(pool.execute("SELECT IF(?='ended',1,0)", ['ended']), { code: 'ER_CANT_AGGREGATE_2COLLATIONS' });
    const [r] = await pool.execute("INSERT INTO restaurants(name,slug,country_code,currency,locale) VALUES ('Coll Cafe',?,'PK','PKR','en')", [tag]);
    restaurantId = r.insertId;
    await pool.execute('INSERT INTO voice_assistants(assistant_id,restaurant_id,active) VALUES (?,?,1)', [assistant, restaurantId]);
    for (const status of ['in-progress', 'ended', 'in-progress'])
      assert.deepEqual(await processVapiEvent(pool, { message: { type: 'status-update', status, call: { id: call, assistantId: assistant } } }), { processed: true });
    const [[row]] = await pool.execute('SELECT status,ended_at FROM voice_calls WHERE call_id=?', [call]);
    assert.equal(row.status, 'ended', 'an ended call never moves back');
    assert.ok(row.ended_at);
  } finally {
    if (restaurantId) {
      await pool.execute('DELETE FROM voice_calls WHERE restaurant_id=?', [restaurantId]).catch(() => {});
      await pool.execute('DELETE FROM voice_assistants WHERE restaurant_id=?', [restaurantId]).catch(() => {});
      await pool.execute('DELETE FROM restaurants WHERE id=?', [restaurantId]).catch(() => {});
    }
    await pool.end();
  }
});
