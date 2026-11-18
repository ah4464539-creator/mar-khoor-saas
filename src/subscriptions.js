// Subscription plans and usage limits. No express import: testable with mock pools.
//
// Every plan includes every feature (AI Assistant, Business WhatsApp, AI Caller, Website).
// Plans differ only by monthly usage limits. Prices are NOT hard-coded: the platform owner sets
// them in SUBSCRIPTION_PRICES_JSON. Without a price a plan can be chosen but shows
// "price to be confirmed" and stays pending_payment. Usage never stops service at the limit.

export const FEATURES = Object.freeze(['ai_assistant', 'whatsapp', 'ai_caller', 'website']);
export const METRICS = Object.freeze(['ai_chats', 'whatsapp_messages', 'ai_call_minutes']);
export const CYCLES = Object.freeze(['monthly', 'yearly']);
export const WARNING_LEVELS = Object.freeze([75, 90, 100]);

// Default monthly limits; override with SUBSCRIPTION_LIMITS_JSON ({"starter":{"ai_chats":300,...},...}).
const DEFAULT_PLANS = Object.freeze([
  { key: 'starter', name: 'Starter', limits: { ai_chats: 300, whatsapp_messages: 100, ai_call_minutes: 30 } },
  { key: 'premium', name: 'Premium', limits: { ai_chats: 1200, whatsapp_messages: 500, ai_call_minutes: 120 } },
  { key: 'enterprise', name: 'Enterprise', limits: { ai_chats: 5000, whatsapp_messages: 2500, ai_call_minutes: 500 } },
]);
export const PLAN_KEYS = Object.freeze(DEFAULT_PLANS.map(plan => plan.key));

function parseJson(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  try { const value = JSON.parse(text); return value && typeof value === 'object' && !Array.isArray(value) ? value : null; }
  catch { return null; }
}
const validAmount = value => Number.isSafeInteger(value) && value >= 0 && value <= 100000000000;
const validLimit = value => Number.isSafeInteger(value) && value >= 0 && value <= 100000000;

/**
 * Builds the plan catalog for a currency.
 * pricesJson: {"PKR":{"starter":{"monthly":500000,"yearly":5000000},...},"USD":{...}} (minor units).
 */
export function planCatalog(currency, { pricesJson = process.env.SUBSCRIPTION_PRICES_JSON, limitsJson = process.env.SUBSCRIPTION_LIMITS_JSON } = {}) {
  const prices = parseJson(pricesJson)?.[currency] ?? {};
  const limitOverrides = parseJson(limitsJson) ?? {};
  return DEFAULT_PLANS.map(plan => {
    const limits = { ...plan.limits };
    for (const metric of METRICS) if (validLimit(limitOverrides[plan.key]?.[metric])) limits[metric] = limitOverrides[plan.key][metric];
    const price = {};
    for (const cycle of CYCLES) price[cycle] = validAmount(prices[plan.key]?.[cycle]) ? prices[plan.key][cycle] : null;
    return { key: plan.key, name: plan.name, features: [...FEATURES], limits, currency, price_minor: price };
  });
}

export function validateSubscriptionChoice(body) {
  const { plan, billing_cycle: cycle } = body ?? {};
  if (!PLAN_KEYS.includes(plan)) return { error: 'Choose Starter, Premium or Enterprise' };
  if (!CYCLES.includes(cycle)) return { error: 'Choose monthly or yearly billing' };
  return { value: { plan, cycle } };
}

export const usagePeriod = (date = new Date()) => date.toISOString().slice(0, 7); // UTC 'YYYY-MM'

/** Highest warning level crossed (75/90/100) or 0. */
export function warningLevel(used, limit) {
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return 0;
  const percent = (used / limit) * 100;
  return [...WARNING_LEVELS].reverse().find(level => percent >= level) ?? 0;
}

export function nextPlan(planKey) {
  const index = PLAN_KEYS.indexOf(planKey);
  return index >= 0 && index < PLAN_KEYS.length - 1 ? PLAN_KEYS[index + 1] : null;
}

/** Usage summary for the dashboard: never blocks service, only reports and suggests upgrades. */
export function usageSummary(planKey, limits, counters) {
  return METRICS.map(metric => {
    const used = Number(counters?.[metric] ?? 0);
    const limit = Number(limits?.[metric] ?? 0);
    const level = warningLevel(used, limit);
    return {
      metric, used, limit,
      percent: limit > 0 ? Math.min(999, Math.round((used / limit) * 100)) : 0,
      warning: level,
      overage: limit > 0 ? Math.max(0, used - limit) : 0,
      suggestion: level >= 75 && nextPlan(planKey) ? 'upgrade_to_' + nextPlan(planKey) : null,
    };
  });
}

// Database helpers ---------------------------------------------------------------------------

export async function getSubscription(pool, restaurantId) {
  const [rows] = await pool.execute('SELECT plan_key,billing_cycle,status,limits,currency,price_minor,created_at,updated_at FROM restaurant_subscriptions WHERE restaurant_id=? LIMIT 1', [restaurantId]);
  if (!rows.length) return null;
  const row = rows[0];
  let limits = row.limits;
  if (typeof limits === 'string') { try { limits = JSON.parse(limits); } catch { limits = {}; } }
  return { plan: row.plan_key, billing_cycle: row.billing_cycle, status: row.status, limits, currency: row.currency,
    price_minor: row.price_minor == null ? null : Number(row.price_minor), created_at: row.created_at, updated_at: row.updated_at };
}

/**
 * Chooses or changes a plan. The limits and price are snapshotted from the server catalog for the
 * restaurant's own currency; the client never supplies them. Payment confirmation is separate.
 */
export async function chooseSubscription(pool, restaurantId, body, options = {}) {
  const choice = validateSubscriptionChoice(body);
  if (choice.error) return { status: 400, body: { error: choice.error } };
  try {
    const [restaurants] = await pool.execute('SELECT currency FROM restaurants WHERE id=? LIMIT 1', [restaurantId]);
    if (!restaurants.length) return { status: 404, body: { error: 'Restaurant not found' } };
    const currency = restaurants[0].currency;
    const plan = planCatalog(currency, options).find(entry => entry.key === choice.value.plan);
    const price = plan.price_minor[choice.value.cycle];
    await pool.execute(
      "INSERT INTO restaurant_subscriptions(restaurant_id,plan_key,billing_cycle,status,limits,currency,price_minor) VALUES (?,?,?,'pending_payment',?,?,?) "
      + "ON DUPLICATE KEY UPDATE plan_key=VALUES(plan_key),billing_cycle=VALUES(billing_cycle),limits=VALUES(limits),currency=VALUES(currency),price_minor=VALUES(price_minor),"
      + "status=IF(status='active' AND plan_key=VALUES(plan_key) AND billing_cycle=VALUES(billing_cycle),'active','pending_payment')",
      [restaurantId, plan.key, choice.value.cycle, JSON.stringify(plan.limits), currency, price]);
    return { status: 200, body: { subscription: await getSubscription(pool, restaurantId), price_confirmed: price !== null } };
  } catch {
    return { status: 503, body: { error: 'Plans unavailable' } };
  }
}

/** Adds usage. Never throws and never blocks the caller: metering must not take service down. */
export async function recordUsage(pool, restaurantId, metric, amount = 1, date = new Date()) {
  if (!METRICS.includes(metric) || !Number.isSafeInteger(restaurantId) || restaurantId < 1 || !Number.isSafeInteger(amount) || amount < 1 || amount > 100000) return false;
  try {
    await pool.execute(
      'INSERT INTO usage_counters(restaurant_id,period,metric,used) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE used=used+VALUES(used)',
      [restaurantId, usagePeriod(date), metric, amount]);
    return true;
  } catch {
    return false;
  }
}

export async function getUsage(pool, restaurantId, date = new Date()) {
  const period = usagePeriod(date);
  const subscription = await getSubscription(pool, restaurantId);
  const [rows] = await pool.execute('SELECT metric,used FROM usage_counters WHERE restaurant_id=? AND period=?', [restaurantId, period]);
  const counters = Object.fromEntries(rows.map(row => [row.metric, Number(row.used)]));
  if (!subscription) return { period, subscription: null, usage: METRICS.map(metric => ({ metric, used: counters[metric] ?? 0, limit: null, percent: 0, warning: 0, overage: 0, suggestion: null })) };
  return { period, subscription, usage: usageSummary(subscription.plan, subscription.limits, counters) };
}
