// Retention job (also runs daily inside the Node service; see src/retention.js).
// Run on demand or from an hPanel cron: `npm run purge-old-data`.
// - WhatsApp message text older than MESSAGE_RETENTION_DAYS (default 90, or the restaurant's own setting)
// - call transcripts / transcript lines / summaries older than TRANSCRIPT_RETENTION_DAYS (default 30, or the restaurant's setting)
// - expired login sessions and password reset links
// - audit log rows older than AUDIT_RETENTION_DAYS (default 365)
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { purgeOldData } from '../src/retention.js';
if (!process.env.DB_USER || !process.env.DB_NAME) throw Error('DB_USER and DB_NAME required');
const pool = mysql.createPool({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
try { await purgeOldData(pool); } finally { await pool.end(); }
