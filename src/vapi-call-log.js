// Richer AI call logs (Vapi): caller number, duration, summary, recording link, live transcript
// lines and call-minute metering. Additive tables only (db/migrations/2026-11-26-vapi-call-log.sql);
// they are also created on first use, because Hostinger deploys do not run migrations.
//
// Tenant identity is never read from the payload: callers pass the restaurant already resolved
// from the server-side voice_assistants mapping.
import { recordUsage } from './subscriptions.js';

export const CALL_LOG_SQL = [
  `CREATE TABLE IF NOT EXISTS voice_call_details (
 assistant_id VARCHAR(128) NOT NULL,
 call_id VARCHAR(128) NOT NULL,
 restaurant_id BIGINT UNSIGNED NOT NULL,
 caller_number VARCHAR(32) NULL,
 duration_seconds INT UNSIGNED NULL,
 summary TEXT NULL,
 recording_url VARCHAR(500) NULL,
 transferred_to VARCHAR(32) NULL,
 minutes_recorded TINYINT(1) NOT NULL DEFAULT 0,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 PRIMARY KEY (assistant_id, call_id),
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
 INDEX (restaurant_id)
) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS voice_call_transcript_lines (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 assistant_id VARCHAR(128) NOT NULL,
 call_id VARCHAR(128) NOT NULL,
 restaurant_id BIGINT UNSIGNED NOT NULL,
 role VARCHAR(16) NOT NULL,
 text TEXT NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
 INDEX (assistant_id, call_id, id),
 INDEX (restaurant_id, created_at)
) ENGINE=InnoDB`,
];

const ready = new WeakMap();
export function ensureCallLogTables(pool) {
  if (typeof pool?.query !== 'function') return Promise.resolve();
  if (!ready.has(pool)) ready.set(pool, (async () => { for (const sql of CALL_LOG_SQL) await pool.query(sql); })().catch(error => { ready.delete(pool); throw error; }));
  return ready.get(pool);
}

const MAX_SUMMARY = 4000;
const MAX_LINE = 2000;
const phone = value => {
  const n = String(value ?? '').replace(/[^\d+]/g, '');
  return /^\+?\d{6,16}$/.test(n) ? n.slice(0, 32) : null;
};
const httpsUrl = value => {
  try { const u = new URL(String(value)); return u.protocol === 'https:' && !u.username && !u.password ? u.href.slice(0, 500) : null; } catch { return null; }
};
const epoch = value => { const t = Date.parse(value); return Number.isFinite(t) ? t : null; };

/** Caller, duration, summary and recording from an end-of-call-report message. Pure. */
export function callDetails(message) {
  const call = message?.call ?? {};
  const callerNumber = phone(message?.customer?.number ?? call.customer?.number);
  let duration = Number(message?.durationSeconds);
  if (!Number.isFinite(duration) && Number.isFinite(Number(message?.durationMs))) duration = Number(message.durationMs) / 1000;
  if (!Number.isFinite(duration)) {
    const start = epoch(message?.startedAt ?? call.startedAt), end = epoch(message?.endedAt ?? call.endedAt);
    if (start !== null && end !== null && end >= start) duration = (end - start) / 1000;
  }
  const durationSeconds = Number.isFinite(duration) && duration >= 0 && duration < 86400 ? Math.round(duration) : null;
  const rawSummary = message?.analysis?.summary ?? message?.summary;
  const summary = typeof rawSummary === 'string' && rawSummary.trim() ? rawSummary.trim().slice(0, MAX_SUMMARY) : null;
  const recordingUrl = httpsUrl(message?.artifact?.recordingUrl ?? message?.recordingUrl ?? message?.artifact?.recording?.mono?.combinedUrl ?? message?.artifact?.recording?.stereoUrl);
  return { callerNumber, durationSeconds, summary, recordingUrl };
}

/** Whole minutes to bill for a call: any started minute counts, a call that never connected is 0. */
export function billableMinutes(durationSeconds) {
  if (!Number.isSafeInteger(durationSeconds) || durationSeconds <= 0) return 0;
  return Math.min(Math.ceil(durationSeconds / 60), 600);
}

/**
 * Stores the end-of-call details and meters the call minutes exactly once per call
 * (minutes_recorded flips 0 -> 1 in one conditional UPDATE, so webhook replays never double count).
 */
export async function saveCallDetails(pool, { assistantId, callId, restaurantId, details }) {
  await ensureCallLogTables(pool);
  await pool.execute(
    'INSERT INTO voice_call_details(assistant_id,call_id,restaurant_id,caller_number,duration_seconds,summary,recording_url) VALUES (?,?,?,?,?,?,?) '
    + 'ON DUPLICATE KEY UPDATE caller_number=COALESCE(VALUES(caller_number),caller_number),duration_seconds=COALESCE(VALUES(duration_seconds),duration_seconds),'
    + 'summary=COALESCE(VALUES(summary),summary),recording_url=COALESCE(VALUES(recording_url),recording_url)',
    [assistantId, callId, restaurantId, details.callerNumber, details.durationSeconds, details.summary, details.recordingUrl]);
  const minutes = billableMinutes(details.durationSeconds);
  if (!minutes) return { minutes: 0 };
  const [claim] = await pool.execute('UPDATE voice_call_details SET minutes_recorded=1 WHERE assistant_id=? AND call_id=? AND minutes_recorded=0', [assistantId, callId]);
  if (!claim.affectedRows) return { minutes: 0, duplicate: true };
  await recordUsage(pool, Number(restaurantId), 'ai_call_minutes', minutes);
  return { minutes };
}

/** Final transcript line from a `transcript` message, or null (partials are ignored). Pure. */
export function transcriptLine(message) {
  const type = String(message?.type ?? '');
  const final = message?.transcriptType === 'final' || /transcriptType="?final"?/.test(type);
  if (!type.startsWith('transcript') || !final) return null;
  const role = message.role === 'assistant' || message.role === 'bot' ? 'assistant' : message.role === 'user' ? 'user' : null;
  const text = typeof message.transcript === 'string' ? message.transcript.trim() : '';
  if (!role || !text) return null;
  return { role, text: text.slice(0, MAX_LINE) };
}

export async function saveTranscriptLine(pool, { assistantId, callId, restaurantId, line }) {
  await ensureCallLogTables(pool);
  await pool.execute('INSERT INTO voice_call_transcript_lines(assistant_id,call_id,restaurant_id,role,text) VALUES (?,?,?,?,?)',
    [assistantId, callId, restaurantId, line.role, line.text]);
}

export async function recordTransfer(pool, { assistantId, callId, restaurantId, number }) {
  await ensureCallLogTables(pool);
  await pool.execute('INSERT INTO voice_call_details(assistant_id,call_id,restaurant_id,transferred_to) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE transferred_to=VALUES(transferred_to)',
    [assistantId, callId, restaurantId, phone(number)]);
}

/** Dashboard: the extra details and transcript lines of one call. Missing tables mean "no extras". */
export async function callExtras(pool, restaurantId, { assistantId, callId }) {
  try {
    await ensureCallLogTables(pool);
    const [[details]] = await pool.execute('SELECT caller_number,duration_seconds,summary,recording_url,transferred_to FROM voice_call_details WHERE assistant_id=? AND call_id=? AND restaurant_id=? LIMIT 1', [assistantId, callId, restaurantId]);
    const [lines] = await pool.execute('SELECT role,text,created_at FROM voice_call_transcript_lines WHERE assistant_id=? AND call_id=? AND restaurant_id=? ORDER BY id LIMIT 500', [assistantId, callId, restaurantId]);
    return { ...(details ?? {}), lines };
  } catch { return { lines: [] }; }
}

/** Dashboard list: details for many calls at once, keyed by call_id. */
export async function callListExtras(pool, restaurantId, callIds) {
  if (!callIds.length) return new Map();
  try {
    await ensureCallLogTables(pool);
    const [rows] = await pool.query('SELECT call_id,caller_number,duration_seconds,summary,transferred_to FROM voice_call_details WHERE restaurant_id=? AND call_id IN (' + callIds.map(() => '?').join(',') + ')', [restaurantId, ...callIds]);
    return new Map(rows.map(row => [row.call_id, row]));
  } catch { return new Map(); }
}
