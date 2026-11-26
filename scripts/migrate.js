// Applies db/schema.sql, then every date-prefixed migration in db/migrations
// (YYYY-MM-DD-name.sql) in name order. Date-prefixed migrations must be idempotent and additive
// (CREATE TABLE IF NOT EXISTS ...), so running this again is always safe. Older, undated files in
// db/migrations are one-off manual migrations and are never run here.
import 'dotenv/config';
import fs from 'node:fs/promises';
import mysql from 'mysql2/promise';
import { pathToFileURL } from 'node:url';

export const DATED_MIGRATION = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.sql$/;
export function datedMigrations(names) {
  return names.filter(name => DATED_MIGRATION.test(name)).sort();
}

async function main() {
  const required = ['DB_USER', 'DB_NAME'];
  for (const key of required) if (!process.env[key]) throw Error('Missing ' + key);
  const conn = await mysql.createConnection({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, multipleStatements: true });
  try {
    await conn.query(await fs.readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
    console.log('MariaDB schema applied successfully');
    const dir = new URL('../db/migrations/', import.meta.url);
    for (const name of datedMigrations(await fs.readdir(dir))) {
      await conn.query(await fs.readFile(new URL(name, dir), 'utf8'));
      console.log('Migration applied: ' + name);
    }
  } finally { await conn.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
