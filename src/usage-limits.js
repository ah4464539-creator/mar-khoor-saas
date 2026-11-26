// Monthly usage limits per restaurant (AI chats, WhatsApp AI replies, AI call minutes).
//
// Limits come from the active plan (restaurant_subscriptions.limits) or, without a plan, from an active
// single tool (tools.js). Restaurants with neither (super-admin pilots / demos) have no limit.
// Policy (USAGE_LIMIT_MODE):
//   hard (default)  the AI stops for that channel once usage reaches limit + USAGE_LIMIT_GRACE_PERCENT
//                   (default 10%), until next month or an upgrade; the owner is alerted
//   soft            never stops (the old behaviour); warnings only
// Metering itself is in subscriptions.recordUsage (called where the usage happens).
import { usagePeriod } from './subscriptions.js';
import { TOOLS } from './tools.js';
import { pushToRestaurant } from './web-push.js';

const TOOL_FOR_METRIC = Object.fromEntries(Object.entries(TOOLS).map(([key, tool]) => [tool.metric, { key, limit: tool.limit }]));
const LABEL = { ai_chats: 'AI chats', whatsapp_messages: 'WhatsApp AI replies', ai_call_minutes: 'AI call minutes' };

export function limitPolicy(env = process.env) {
  const mode = String(env.USAGE_LIMIT_MODE || 'hard').trim().toLowerCase() === 'soft' ? 'soft' : 'hard';
  const grace = Number(env.USAGE_LIMIT_GRACE_PERCENT ?? 10);
  return { mode, gracePercent: Number.isInteger(grace) && grace >= 0 && grace <= 100 ? grace : 10 };
}

/** The monthly limit for one metric, or null when this restaurant has no limit. */
export async function monthlyLimit(pool, restaurantId, metric) {
  const [subs] = await pool.execute("SELECT limits FROM restaurant_subscriptions WHERE restaurant_id=? AND status='active' LIMIT 1", [restaurantId]);
  if (subs.length) {
    let limits = subs[0].limits;
    if (typeof limits === 'string') { try { limits = JSON.parse(limits); } catch { limits = null; } }
    const value = Number(limits?.[metric]);
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  const tool = TOOL_FOR_METRIC[metric];
  if (!tool) return null;
  try {
    const [rows] = await pool.execute("SELECT 1 FROM restaurant_tools WHERE restaurant_id=? AND tool_key=? AND status='active' LIMIT 1", [restaurantId, tool.key]);
    return rows.length ? tool.limit : null;
  } catch { return null; }
}

/**
 * { allowed, used, limit, stopAt } for one metric this month. Fails open (allowed) when the
 * database cannot be read, so a metering problem never takes the service down.
 */
export async function checkQuota(pool, restaurantId, metric, { env = process.env, date = new Date() } = {}) {
  const policy = limitPolicy(env);
  try {
    const limit = await monthlyLimit(pool, restaurantId, metric);
    if (limit === null) return { allowed: true, used: null, limit: null, stopAt: null };
    const [rows] = await pool.execute('SELECT used FROM usage_counters WHERE restaurant_id=? AND period=? AND metric=? LIMIT 1', [restaurantId, usagePeriod(date), metric]);
    const used = Number(rows[0]?.used || 0);
    const stopAt = Math.ceil(limit * (100 + policy.gracePercent) / 100);
    return { allowed: policy.mode === 'soft' || used < stopAt, used, limit, stopAt };
  } catch { return { allowed: true, used: null, limit: null, stopAt: null, error: true }; }
}

// One owner alert per restaurant, metric and day (per Node process).
const alerted = new Map();
export function alertLimitReached(pool, restaurantId, metric, quota, now = new Date()) {
  const key = restaurantId + ':' + metric + ':' + now.toISOString().slice(0, 10);
  if (alerted.has(key)) return false;
  if (alerted.size > 5000) alerted.clear();
  alerted.set(key, true);
  console.warn(JSON.stringify({ event: 'usage_limit_reached', restaurant_id: restaurantId, metric, used: quota.used, limit: quota.limit }));
  pushToRestaurant(pool, restaurantId, { title: 'Monthly limit reached: ' + (LABEL[metric] || metric), body: 'The AI is paused for this until next month. Upgrade your plan in Plans & billing to turn it back on now.', url: '/restaurant.html#plan', tag: 'limit-' + metric }).catch(() => {});
  return true;
}

/** Convenience: true when allowed; alerts the owner once when not. */
export async function withinLimit(pool, restaurantId, metric, options) {
  const quota = await checkQuota(pool, restaurantId, metric, options);
  if (!quota.allowed) alertLimitReached(pool, restaurantId, metric, quota);
  return quota.allowed;
}
