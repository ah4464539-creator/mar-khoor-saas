import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { datedMigrations, DATED_MIGRATION } from '../scripts/migrate.js';

test('only date-prefixed migrations run automatically, in name order', () => {
  assert.deepEqual(datedMigrations(['plans-setup.sql', '2026-12-01-b.sql', '2026-11-26-a.sql', 'notes.txt', '2026-11-26-A.sql']),
    ['2026-11-26-a.sql', '2026-12-01-b.sql']);
});

test('every dated migration is additive and safe to run again', () => {
  for (const name of readdirSync('db/migrations').filter(n => DATED_MIGRATION.test(n))) {
    const sql = readFileSync('db/migrations/' + name, 'utf8').replace(/--.*$/gm, '');
    assert.doesNotMatch(sql, /\b(DROP|TRUNCATE|DELETE\s+FROM|RENAME|MODIFY|CHANGE\s+COLUMN)\b/i, name + ' must be additive');
    for (const statement of sql.split(';').map(s => s.trim()).filter(Boolean))
      assert.match(statement, /^(CREATE TABLE IF NOT EXISTS|CREATE (UNIQUE )?INDEX IF NOT EXISTS|ALTER TABLE \w+ ADD COLUMN IF NOT EXISTS|INSERT IGNORE INTO)/i, name + ': ' + statement.slice(0, 60));
  }
});
