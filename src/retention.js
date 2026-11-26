// Data retention: customer message bodies, call transcripts and old logs are removed automatically.
//
// Defaults (platform, env):  MESSAGE_RETENTION_DAYS 90     WhatsApp message text (inbound + outbound)
//                            TRANSCRIPT_RETENTION_DAYS 30  call transcripts, transcript lines, call summaries
//                            AUDIT_RETENTION_DAYS 365      audit log rows
// Each restaurant may set its own period (7-365 days) in Dashboard → AI receptionist → Privacy; it then
// applies to that restaurant's messages and transcripts. Rows stay (dates, status, order links); only
// the personal text is cleared. Runs daily inside the Node service only when RETENTION_WORKER_ENABLED=1
// (opt-in: Hostinger PR previews share the production database and must never purge it), and on demand
// with `npm run purge-old-data`. Additive table: db/migrations/2026-11-26-retention.sql.
import { heartbeat, registerWorker, workerDisabled, log } from './observability.js';

export const RETENTION_SQL = `CREATE TABLE IF NOT EXISTS restaurant_privacy_settings (
 restaurant_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
 message_retention_days SMALLINT UNSIGNED NULL,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB`;

const ready = new WeakMap();
export function ensureRetentionTable(pool) {
  if (typeof pool?.query !== 'function') return Promise.resolve();
  if (!ready.has(pool)) ready.set(pool, Promise.resolve().then(() => pool.query(RETENTION_SQL)).catch(error => { ready.delete(pool); throw error; }));
  return ready.get(pool);
}

export const RESTAURANT_MIN_DAYS = 7, RESTAURANT_MAX_DAYS = 365;
const days = (env, name, fallback) => { const v = Number(env[name] ?? fallback); return Number.isInteger(v) && v >= 1 && v <= 3650 ? v : fallback; };
export function retentionConfig(env = process.env) {
  return { messages: days(env, 'MESSAGE_RETENTION_DAYS', 90), transcripts: days(env, 'TRANSCRIPT_RETENTION_DAYS', 30), audit: days(env, 'AUDIT_RETENTION_DAYS', 365) };
}

/** Validates an owner's retention choice: null (platform default) or 7-365 days. */
export function validRetentionDays(value) {
  if (value === null) return { value: null };
  return Number.isInteger(value) && value >= RESTAURANT_MIN_DAYS && value <= RESTAURANT_MAX_DAYS ? { value } : { error: 'Choose between ' + RESTAURANT_MIN_DAYS + ' and ' + RESTAURANT_MAX_DAYS + ' days, or the default' };
}
export async function getRetention(pool, restaurantId) {
  await ensureRetentionTable(pool);
  const [rows] = await pool.execute('SELECT message_retention_days FROM restaurant_privacy_settings WHERE restaurant_id=? LIMIT 1', [restaurantId]);
  return rows[0]?.message_retention_days == null ? null : Number(rows[0].message_retention_days);
}
export async function setRetention(pool, restaurantId, value) {
  await ensureRetentionTable(pool);
  await pool.execute('INSERT INTO restaurant_privacy_settings(restaurant_id,message_retention_days) VALUES (?,?) ON DUPLICATE KEY UPDATE message_retention_days=VALUES(message_retention_days)', [restaurantId, value]);
}

// Each step is independent: a table that does not exist yet (feature not deployed) is skipped.
const own = fallback => 'INTERVAL COALESCE(p.message_retention_days,' + Number(fallback) + ') DAY';
export function purgeStatements(config) {
  return [
    ['whatsapp_inbound_text', 'UPDATE whatsapp_inbound_messages m LEFT JOIN restaurant_privacy_settings p ON p.restaurant_id=m.restaurant_id SET m.text_body=NULL WHERE m.text_body IS NOT NULL AND m.received_at < NOW() - ' + own(config.messages)],
    ['whatsapp_outbound_text', "UPDATE whatsapp_outbound_messages o LEFT JOIN restaurant_privacy_settings p ON p.restaurant_id=o.restaurant_id SET o.text_body='' WHERE o.text_body<>'' AND o.sent_at < NOW() - " + own(config.messages)],
    ['call_transcripts', 'UPDATE voice_calls c LEFT JOIN restaurant_privacy_settings p ON p.restaurant_id=c.restaurant_id SET c.transcript=NULL WHERE c.transcript IS NOT NULL AND c.started_at < NOW() - ' + own(config.transcripts)],
    ['call_transcript_lines', 'DELETE l FROM voice_call_transcript_lines l LEFT JOIN restaurant_privacy_settings p ON p.restaurant_id=l.restaurant_id WHERE l.created_at < NOW() - ' + own(config.transcripts)],
    ['call_summaries', 'UPDATE voice_call_details d LEFT JOIN restaurant_privacy_settings p ON p.restaurant_id=d.restaurant_id SET d.summary=NULL,d.recording_url=NULL WHERE (d.summary IS NOT NULL OR d.recording_url IS NOT NULL) AND d.updated_at < NOW() - ' + own(config.transcripts)],
    ['expired_sessions', 'DELETE FROM sessions WHERE expires_at < NOW()'],
    ['expired_reset_links', 'DELETE FROM password_resets WHERE expires_at < NOW() - INTERVAL 1 DAY'],
    ['audit_logs', 'DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL ' + Number(config.audit) + ' DAY'],
  ];
}

/** Runs every retention step. Returns { step: affectedRows | 'skipped' }. Never throws for a missing table. */
export async function purgeOldData(pool, { env = process.env, logger = log } = {}) {
  await ensureRetentionTable(pool);
  const result = {};
  for (const [step, sql] of purgeStatements(retentionConfig(env))) {
    try { const [r] = await pool.query(sql); result[step] = r.affectedRows; }
    catch (error) {
      if (error?.code === 'ER_NO_SUCH_TABLE') { result[step] = 'skipped'; continue; }
      throw Object.assign(error, { step });
    }
  }
  logger.info('retention_purge', result);
  return result;
}

/** Daily purge inside the Node service (first run 10 minutes after start). */
export function startRetentionWorker(pool, { env = process.env, intervalMs = 24 * 60 * 60 * 1000 } = {}) {
  if (String(env.RETENTION_WORKER_ENABLED ?? '').trim() !== '1') { workerDisabled('retention', 'set RETENTION_WORKER_ENABLED=1 on production to run the daily clean-up'); return null; }
  registerWorker('retention', { intervalMs });
  const run = () => purgeOldData(pool, { env }).then(() => heartbeat('retention')).catch(error => { log.warn('retention_purge_failed', { step: error?.step, code: error?.code }); heartbeat('retention', { ok: false, error }); });
  setTimeout(run, 10 * 60 * 1000).unref?.();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return timer;
}
