// Limits for the restaurant website's live voice assistant (OpenAI Realtime), which costs about
// as much per minute as a phone call:
// - each conversation is hung up by the server after WEBSITE_VOICE_MAX_MINUTES (default 5);
// - its minutes have their OWN monthly limit, separate from phone-call minutes, kept in the
//   additive table website_voice_usage; once used up voice is refused (text chat keeps working).
import { getSubscription } from './subscriptions.js';

export const VOICE_USAGE_SQL = `CREATE TABLE IF NOT EXISTS website_voice_usage (
 restaurant_id BIGINT UNSIGNED NOT NULL,
 period CHAR(7) NOT NULL,
 minutes INT UNSIGNED NOT NULL DEFAULT 0,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 PRIMARY KEY (restaurant_id, period),
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB`;
const period = (date = new Date()) => date.toISOString().slice(0, 7);

// Live-voice minutes per plan; a plan's own limits.ai_voice_minutes wins, and
// WEBSITE_VOICE_PLAN_MINUTES_JSON ({"starter":1000}) overrides without a code change.
const VOICE_MINUTES_BY_PLAN = { starter: 100, premium: 400, enterprise: 1200 };
export function planVoiceMinutes(subscription, env = process.env) {
  let overrides = {};
  try { overrides = JSON.parse(env.WEBSITE_VOICE_PLAN_MINUTES_JSON || '{}') || {}; } catch { overrides = {}; }
  const own = Number(subscription?.limits?.ai_voice_minutes);
  if (Number.isInteger(own) && own >= 0) return own;
  const value = Number(overrides[subscription?.plan] ?? VOICE_MINUTES_BY_PLAN[subscription?.plan]);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

const ready = new WeakMap(); // pool -> promise: the table is created once per pool
function ensureTable(pool) {
  if (!ready.has(pool)) ready.set(pool, Promise.resolve().then(() => pool.query(VOICE_USAGE_SQL)).catch(error => { ready.delete(pool); throw error; }));
  return ready.get(pool);
}

/** Adds live-voice minutes for this month. Never throws. */
export async function recordVoiceMinutes(pool, restaurantId, minutes, date = new Date()) {
  if (!Number.isSafeInteger(restaurantId) || restaurantId < 1 || !Number.isSafeInteger(minutes) || minutes < 1 || minutes > 1000) return false;
  try {
    await ensureTable(pool);
    await pool.execute('INSERT INTO website_voice_usage(restaurant_id,period,minutes) VALUES (?,?,?) ON DUPLICATE KEY UPDATE minutes=minutes+VALUES(minutes)', [restaurantId, period(date), minutes]);
    return true;
  } catch { return false; }
}

export async function voiceMinutesUsed(pool, restaurantId, date = new Date()) {
  await ensureTable(pool);
  const [rows] = await pool.execute('SELECT minutes FROM website_voice_usage WHERE restaurant_id=? AND period=? LIMIT 1', [restaurantId, period(date)]);
  return Number(rows[0]?.minutes || 0);
}

export const maxMinutes = (env = process.env) => {
  const n = Number(env.WEBSITE_VOICE_MAX_MINUTES);
  return Number.isInteger(n) && n >= 1 && n <= 30 ? n : 5;
};
// Restaurants with no plan that still have the assistant (a website tool, a demo) get a small allowance.
const allowanceWithoutPlan = (env = process.env) => {
  const n = Number(env.WEBSITE_VOICE_FREE_MINUTES);
  return Number.isInteger(n) && n >= 0 && n <= 10000 ? n : 30;
};

/** Live-voice minutes this restaurant may still use this month, or null if unknown (never blocks on errors). */
export async function minutesLeft(pool, restaurantId, { env = process.env, now = new Date() } = {}) {
  try {
    const subscription = await getSubscription(pool, restaurantId);
    const planMinutes = subscription?.status === 'active' ? planVoiceMinutes(subscription, env) : null;
    const limit = planMinutes ?? allowanceWithoutPlan(env);
    return Math.max(0, limit - await voiceMinutesUsed(pool, restaurantId, now));
  } catch { return null; }
}

/** Tracks live calls so they can be counted and hung up. */
export function createVoiceCalls({ pool, env = process.env, fetcher = fetch, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout, log = console } = {}) {
  const calls = new Map(); // callId -> { restaurantId, startedAt, counted, timer }

  async function hangup(callId) {
    if (!/^rtc_[A-Za-z0-9_-]{4,120}$/.test(callId)) return;
    try {
      await fetcher('https://api.openai.com/v1/realtime/calls/' + callId + '/hangup', {
        method: 'POST', headers: { Authorization: 'Bearer ' + env.OPENAI_API_KEY }, redirect: 'error', signal: AbortSignal.timeout(10000),
      });
    } catch { /* the call may already be over */ }
  }

  // Counts whole minutes talked (at least 1, at most the cap), once per call.
  async function close(callId, reason) {
    const call = calls.get(callId);
    if (!call) return null;
    calls.delete(callId);
    clearTimer(call.timer);
    const minutes = Math.min(maxMinutes(env), Math.max(1, Math.ceil((now() - call.startedAt) / 60000)));
    const extra = minutes - call.counted;
    if (extra > 0) await recordVoiceMinutes(pool, call.restaurantId, extra);
    if (reason === 'limit') { await hangup(callId); log.log?.('Website voice call hung up at the ' + maxMinutes(env) + '-minute limit (restaurant #' + call.restaurantId + ')'); }
    else await hangup(callId);
    return minutes;
  }

  return {
    /** A new call: count its first minute now, hang it up at the limit. */
    async start(callId, restaurantId) {
      if (!callId) return;
      await recordVoiceMinutes(pool, restaurantId, 1);
      const timer = setTimer(() => { void close(callId, 'limit'); }, maxMinutes(env) * 60000);
      timer?.unref?.();
      calls.set(callId, { restaurantId, startedAt: now(), counted: 1, timer });
    },
    /** The visitor ended it (or the page closed): count the minutes and hang up. */
    async end(callId, restaurantId) {
      const call = calls.get(callId);
      if (!call || call.restaurantId !== restaurantId) return null;
      return close(callId, 'ended');
    },
    size: () => calls.size,
  };
}

/** "Location: /v1/realtime/calls/rtc_…" → "rtc_…" */
export function callIdFrom(location) {
  const match = String(location || '').match(/\/realtime\/calls\/(rtc_[A-Za-z0-9_-]{4,120})/);
  return match ? match[1] : null;
}

/** Dashboard row for website live-voice minutes, shown apart from phone-call minutes. Null on errors. */
export async function voiceUsageEntry(pool, restaurantId, subscription, { env = process.env, now = new Date() } = {}) {
  try {
    const limit = (subscription?.status === 'active' ? planVoiceMinutes(subscription, env) : null) ?? allowanceWithoutPlan(env);
    const used = await voiceMinutesUsed(pool, restaurantId, now);
    const percent = limit > 0 ? Math.min(999, Math.round((used / limit) * 100)) : 0;
    return { metric: 'ai_voice_minutes', used, limit, percent, warning: percent >= 100 ? 100 : percent >= 90 ? 90 : percent >= 75 ? 75 : 0, overage: 0, suggestion: null, stops_at_limit: true };
  } catch { return null; }
}
