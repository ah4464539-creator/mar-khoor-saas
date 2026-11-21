// Limits for the restaurant website's live voice assistant (OpenAI Realtime), which costs about
// as much per minute as a phone call:
// - each conversation is hung up by the server after WEBSITE_VOICE_MAX_MINUTES (default 5);
// - its minutes count as "ai_call_minutes" in the restaurant's plan, and once the month's minutes
//   are used up voice is refused (text chat keeps working).
import { getSubscription, getUsage, recordUsage } from './subscriptions.js';

export const maxMinutes = (env = process.env) => {
  const n = Number(env.WEBSITE_VOICE_MAX_MINUTES);
  return Number.isInteger(n) && n >= 1 && n <= 30 ? n : 5;
};
// Restaurants with no plan that still have the assistant (a website tool, a demo) get a small allowance.
const allowanceWithoutPlan = (env = process.env) => {
  const n = Number(env.WEBSITE_VOICE_FREE_MINUTES);
  return Number.isInteger(n) && n >= 0 && n <= 10000 ? n : 30;
};

/** Minutes this restaurant may still talk this month, or null if unknown (never blocks on errors). */
export async function minutesLeft(pool, restaurantId, { env = process.env, now = new Date() } = {}) {
  try {
    const subscription = await getSubscription(pool, restaurantId);
    const planMinutes = subscription?.status === 'active' ? Number(subscription.limits?.ai_call_minutes) : NaN;
    const limit = Number.isFinite(planMinutes) && planMinutes > 0 ? planMinutes : allowanceWithoutPlan(env);
    const { usage } = await getUsage(pool, restaurantId, now);
    const used = Number(usage.find(u => u.metric === 'ai_call_minutes')?.used || 0);
    return Math.max(0, limit - used);
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
    if (extra > 0) await recordUsage(pool, call.restaurantId, 'ai_call_minutes', extra);
    if (reason === 'limit') { await hangup(callId); log.log?.('Website voice call hung up at the ' + maxMinutes(env) + '-minute limit (restaurant #' + call.restaurantId + ')'); }
    else await hangup(callId);
    return minutes;
  }

  return {
    /** A new call: count its first minute now, hang it up at the limit. */
    async start(callId, restaurantId) {
      if (!callId) return;
      await recordUsage(pool, restaurantId, 'ai_call_minutes', 1);
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
