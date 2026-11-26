// Reliable WhatsApp AI replies: send lock, retries with exponential backoff, dead-letter, and
// customer consent (opt-out). Additive tables only (db/migrations/2026-11-26-whatsapp-reliability.sql);
// also created on first use because Hostinger deploys do not run migrations.
//
// Never-twice guarantee: right before calling Meta the worker takes a send lock
// (whatsapp_job_state.send_started_at, set once with a conditional UPDATE). A job whose lock is already
// taken is never sent again automatically, even after a crash: it goes to the dead-letter list for a
// person to check. The lock is released only when Meta answered with an error, i.e. it definitely did
// not accept the message.

export const RELIABILITY_SQL = [
  `CREATE TABLE IF NOT EXISTS whatsapp_job_state (
 inbound_message_id VARCHAR(255) NOT NULL PRIMARY KEY,
 restaurant_id BIGINT UNSIGNED NOT NULL,
 attempts INT UNSIGNED NOT NULL DEFAULT 0,
 claimed_at TIMESTAMP NULL DEFAULT NULL,
 next_attempt_at TIMESTAMP NULL DEFAULT NULL,
 send_started_at TIMESTAMP NULL DEFAULT NULL,
 dead_letter TINYINT(1) NOT NULL DEFAULT 0,
 last_error VARCHAR(255) NULL,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
 INDEX (restaurant_id, dead_letter),
 INDEX (next_attempt_at)
) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS whatsapp_contacts (
 restaurant_id BIGINT UNSIGNED NOT NULL,
 customer VARCHAR(64) NOT NULL,
 opted_out TINYINT(1) NOT NULL DEFAULT 0,
 opted_out_at TIMESTAMP NULL DEFAULT NULL,
 opted_in_at TIMESTAMP NULL DEFAULT NULL,
 language VARCHAR(10) NULL,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 PRIMARY KEY (restaurant_id, customer),
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB`,
];

const ready = new WeakMap();
export function ensureReliabilityTables(pool) {
  if (typeof pool?.query !== 'function') return Promise.resolve();
  if (!ready.has(pool)) ready.set(pool, (async () => { for (const sql of RELIABILITY_SQL) await pool.query(sql); })().catch(error => { ready.delete(pool); throw error; }));
  return ready.get(pool);
}

const int = (value, fallback, min, max) => { const n = Number(value); return Number.isInteger(n) && n >= min && n <= max ? n : fallback; };
export function retryConfig(env = process.env) {
  return {
    maxAttempts: int(env.WHATSAPP_AI_MAX_ATTEMPTS, 5, 1, 20),
    baseSeconds: int(env.WHATSAPP_AI_RETRY_BASE_SECONDS, 30, 5, 3600),
    maxSeconds: int(env.WHATSAPP_AI_RETRY_MAX_SECONDS, 900, 30, 21600),
    staleMinutes: 10,
  };
}
/** Delay before attempt n+1 after attempt n failed: base, 2×base, 4×base ... capped. */
export function backoffSeconds(attempt, config = retryConfig()) {
  const n = Math.max(1, Math.min(attempt, 30));
  return Math.min(config.maxSeconds, config.baseSeconds * 2 ** (n - 1));
}

// Errors that will fail the same way next time: no retry.
const PERMANENT = [/^Empty message$/, /^AI disabled, number unlinked or reply window expired$/, /^Invalid Graph version$/, /^Missing AI or WhatsApp credentials$/];
/**
 * What to do with a failed attempt.
 *   sendStarted: the send lock was taken in this attempt (Meta may have been called).
 * Returns 'retry' | 'dead'. Meta error replies (HTTP status known) mean Meta did NOT accept the message:
 * 429/5xx are retried, other 4xx (bad number, policy, template needed) are permanent. A send error
 * without a Meta status (timeout, network, missing message id) is unknown, so it is never retried.
 */
export function classifyFailure(error, { sendStarted }) {
  const message = String(error?.message ?? '');
  if (sendStarted) {
    const status = Number(error?.metaStatus);
    if (!Number.isInteger(status)) return 'dead';
    return status === 429 || status >= 500 ? 'retry' : 'dead';
  }
  return PERMANENT.some(re => re.test(message)) ? 'dead' : 'retry';
}

/** Counts this attempt. Returns the attempt number (1 for the first try). */
export async function markClaimed(pool, job) {
  await pool.execute('INSERT INTO whatsapp_job_state(inbound_message_id,restaurant_id,attempts,claimed_at) VALUES (?,?,1,NOW()) ON DUPLICATE KEY UPDATE attempts=attempts+1,claimed_at=NOW(),next_attempt_at=NULL',
    [job.inbound_message_id, job.restaurant_id]);
  const [rows] = await pool.execute('SELECT attempts FROM whatsapp_job_state WHERE inbound_message_id=? LIMIT 1', [job.inbound_message_id]);
  return Number(rows[0]?.attempts || 1);
}

/** Takes the send lock. False means an earlier attempt already started sending: do not send. */
export async function acquireSendLock(pool, job) {
  const [result] = await pool.execute('UPDATE whatsapp_job_state SET send_started_at=NOW() WHERE inbound_message_id=? AND restaurant_id=? AND send_started_at IS NULL', [job.inbound_message_id, job.restaurant_id]);
  return result.affectedRows === 1;
}

export async function releaseSendLock(pool, job) {
  await pool.execute('UPDATE whatsapp_job_state SET send_started_at=NULL WHERE inbound_message_id=? AND restaurant_id=?', [job.inbound_message_id, job.restaurant_id]);
}

const clip = text => String(text ?? 'Failed').slice(0, 255);
export async function scheduleRetry(pool, job, attempt, error, config = retryConfig()) {
  if (attempt >= config.maxAttempts) return deadLetter(pool, job, 'Gave up after ' + attempt + ' attempts: ' + String(error?.message ?? error));
  const delay = backoffSeconds(attempt, config);
  await pool.execute('UPDATE whatsapp_job_state SET next_attempt_at=NOW()+INTERVAL ? SECOND,last_error=? WHERE inbound_message_id=? AND restaurant_id=?', [delay, clip(error?.message ?? error), job.inbound_message_id, job.restaurant_id]);
  await pool.execute("UPDATE whatsapp_ai_jobs SET status='pending',last_error=? WHERE inbound_message_id=? AND restaurant_id=?", [clip('Retry ' + (attempt + 1) + ' in ' + delay + 's: ' + (error?.message ?? error)), job.inbound_message_id, job.restaurant_id]);
  return { retry: true, delay };
}

export async function deadLetter(pool, job, reason, outboundId = null) {
  await pool.execute('UPDATE whatsapp_job_state SET dead_letter=1,next_attempt_at=NULL,last_error=? WHERE inbound_message_id=? AND restaurant_id=?', [clip(reason), job.inbound_message_id, job.restaurant_id]);
  await pool.execute("UPDATE whatsapp_ai_jobs SET status='failed',last_error=?,outbound_message_id=COALESCE(?,outbound_message_id) WHERE inbound_message_id=? AND restaurant_id=?", [clip('Dead letter: ' + reason), outboundId, job.inbound_message_id, job.restaurant_id]);
  return { retry: false, dead: true };
}

/**
 * Jobs stuck in `processing` (the worker crashed or restarted mid-job). If the send lock was never
 * taken, Meta was never called and the job is safely put back in the queue. Otherwise Meta may have
 * sent the reply, so it goes to the dead-letter list instead of being sent twice.
 */
export async function recoverStaleJobs(pool, config = retryConfig()) {
  const stale = "j.status='processing' AND COALESCE(st.claimed_at,j.created_at)<NOW()-INTERVAL " + Number(config.staleMinutes) + ' MINUTE';
  const [requeued] = await pool.execute("UPDATE whatsapp_ai_jobs j LEFT JOIN whatsapp_job_state st ON st.inbound_message_id=j.inbound_message_id SET j.status='pending',j.last_error='Requeued after worker restart (never sent)' WHERE " + stale + ' AND st.send_started_at IS NULL');
  const [dead] = await pool.execute("UPDATE whatsapp_ai_jobs j JOIN whatsapp_job_state st ON st.inbound_message_id=j.inbound_message_id SET j.status='failed',j.last_error='Dead letter: worker stopped while sending; check outbound history before replying',st.dead_letter=1 WHERE " + stale + ' AND st.send_started_at IS NOT NULL');
  return { requeued: requeued.affectedRows, dead_lettered: dead.affectedRows };
}

/** SQL condition for the worker's job query: skip jobs waiting for their retry time or dead-lettered. */
export const READY_FILTER = ' AND NOT EXISTS (SELECT 1 FROM whatsapp_job_state st WHERE st.inbound_message_id=j.inbound_message_id AND (st.dead_letter=1 OR st.next_attempt_at>NOW()))';

// ---- Consent ----
export async function isOptedOut(pool, restaurantId, customer) {
  try {
    await ensureReliabilityTables(pool);
    const [rows] = await pool.execute('SELECT opted_out FROM whatsapp_contacts WHERE restaurant_id=? AND customer=? LIMIT 1', [restaurantId, String(customer)]);
    return Number(rows[0]?.opted_out) === 1;
  } catch { return false; }
}
export async function setConsent(pool, restaurantId, customer, optedOut, language = null) {
  await ensureReliabilityTables(pool);
  await pool.execute(
    'INSERT INTO whatsapp_contacts(restaurant_id,customer,opted_out,opted_out_at,opted_in_at,language) VALUES (?,?,?,IF(?=1,NOW(),NULL),IF(?=0,NOW(),NULL),?) '
    + 'ON DUPLICATE KEY UPDATE opted_out=VALUES(opted_out),opted_out_at=IF(VALUES(opted_out)=1,NOW(),opted_out_at),opted_in_at=IF(VALUES(opted_out)=0,NOW(),opted_in_at),language=COALESCE(VALUES(language),language)',
    [restaurantId, String(customer), optedOut ? 1 : 0, optedOut ? 1 : 0, optedOut ? 1 : 0, language]);
}

/** Monitoring numbers for super admin (no message text). */
export async function reliabilityCounts(pool) {
  try {
    await ensureReliabilityTables(pool);
    const [[row]] = await pool.query('SELECT SUM(dead_letter=1) AS dead_letter, SUM(dead_letter=0 AND next_attempt_at>NOW()) AS waiting_retry FROM whatsapp_job_state');
    const [[optOut]] = await pool.query('SELECT COUNT(*) AS opted_out FROM whatsapp_contacts WHERE opted_out=1');
    return { dead_letter: Number(row?.dead_letter || 0), waiting_retry: Number(row?.waiting_retry || 0), opted_out_contacts: Number(optOut?.opted_out || 0) };
  } catch { return null; }
}
