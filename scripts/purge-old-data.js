// Retention job: run daily (hPanel cron) with `npm run purge-old-data`.
// - voice call transcripts older than TRANSCRIPT_RETENTION_DAYS (default 30) are blanked (the call row stays)
// - expired login sessions are deleted
// - audit log rows older than AUDIT_RETENTION_DAYS (default 365) are deleted
import 'dotenv/config';
import mysql from 'mysql2/promise';
const days = (name, fallback) => { const v = Number(process.env[name] ?? fallback); return Number.isInteger(v) && v >= 1 && v <= 3650 ? v : fallback; };
if (!process.env.DB_USER || !process.env.DB_NAME) throw Error('DB_USER and DB_NAME required');
const pool = mysql.createPool({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
try {
  const [transcripts] = await pool.execute('UPDATE voice_calls SET transcript=NULL WHERE transcript IS NOT NULL AND started_at < NOW() - INTERVAL ? DAY', [days('TRANSCRIPT_RETENTION_DAYS', 30)]);
  const [sessions] = await pool.execute('DELETE FROM sessions WHERE expires_at < NOW()');
  const [audits] = await pool.execute('DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL ? DAY', [days('AUDIT_RETENTION_DAYS', 365)]);
  console.log(JSON.stringify({ transcripts_cleared: transcripts.affectedRows, sessions_deleted: sessions.affectedRows, audit_rows_deleted: audits.affectedRows }));
} finally { await pool.end(); }
