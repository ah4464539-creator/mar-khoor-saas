// Subscription plans and usage limits. No express import: testable with mock pools.
//
// Every plan includes every feature (AI Assistant, Business WhatsApp, AI Caller, Website).
// Plans differ only by monthly usage limits. Base prices are in USD (owner-approved; override with
// SUBSCRIPTION_PRICES_JSON {"USD":{...}}) and are converted automatically to each restaurant's
// currency with daily exchange rates. An explicit per-currency entry in SUBSCRIPTION_PRICES_JSON
// (e.g. {"PKR":{...}}) wins over conversion. Without a rate the price is shown in USD.
// Usage limits are enforced in usage-limits.js: the AI pauses for a channel at limit + 10% grace
// (USAGE_LIMIT_MODE=soft restores "never stop").
import { convertUsdMinor } from './fx-rates.js';

export const BASE_CURRENCY = 'USD';
export const FEATURES = Object.freeze(['ai_assistant', 'whatsapp', 'ai_caller', 'website']);
export const METRICS = Object.freeze(['ai_chats', 'whatsapp_messages', 'ai_call_minutes']);
export const CYCLES = Object.freeze(['monthly', 'yearly']);
export const WARNING_LEVELS = Object.freeze([75, 90, 100]);

// Monthly limits and USD prices (minor units). Limits: override with SUBSCRIPTION_LIMITS_JSON.
// Starter has no dedicated AI phone number; it is an add-on. Premium and Enterprise include one.
const DEFAULT_PLANS = Object.freeze([
  { key: 'starter', name: 'Starter', limits: { ai_chats: 1500, whatsapp_messages: 1000, ai_call_minutes: 100 },
    usd: { monthly: 3900, yearly: 39000 }, number: { included: false, addon_usd_monthly: 4900 } },
  { key: 'premium', name: 'Premium', limits: { ai_chats: 5000, whatsapp_messages: 3000, ai_call_minutes: 400 },
    usd: { monthly: 19900, yearly: 199000 }, number: { included: true, addon_usd_monthly: null } },
  { key: 'enterprise', name: 'Enterprise', limits: { ai_chats: 15000, whatsapp_messages: 8000, ai_call_minutes: 1200 },
    usd: { monthly: 59900, yearly: 599000 }, number: { included: true, addon_usd_monthly: null } },
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
 * Builds the plan catalog for a restaurant currency.
 * fx: { rates: {PKR: 280.1, ...}, asOf, source } from getUsdRates(), or null.
 * Prices are in the restaurant's currency when an explicit price or a rate exists, otherwise USD.
 */
export function planCatalog(currency, { pricesJson = process.env.SUBSCRIPTION_PRICES_JSON, limitsJson = process.env.SUBSCRIPTION_LIMITS_JSON, fx = null } = {}) {
  const configured = parseJson(pricesJson) ?? {};
  const limitOverrides = parseJson(limitsJson) ?? {};
  const explicitLocal = currency !== BASE_CURRENCY ? configured[currency] : null;
  const canConvert = currency === BASE_CURRENCY || Boolean(fx?.rates?.[currency]);
  const shownCurrency = explicitLocal || canConvert ? currency : BASE_CURRENCY;
  return DEFAULT_PLANS.map(plan => {
    const limits = { ...plan.limits };
    for (const metric of METRICS) if (validLimit(limitOverrides[plan.key]?.[metric])) limits[metric] = limitOverrides[plan.key][metric];
    const base = {}, price = {};
    for (const cycle of CYCLES) {
      const usdOverride = configured[BASE_CURRENCY]?.[plan.key]?.[cycle];
      base[cycle] = validAmount(usdOverride) ? usdOverride : plan.usd[cycle];
      const local = explicitLocal?.[plan.key]?.[cycle];
      price[cycle] = validAmount(local) ? local
        : shownCurrency === BASE_CURRENCY ? base[cycle]
        : convertUsdMinor(base[cycle], shownCurrency, fx);
    }
    const addonUsd = plan.number.addon_usd_monthly;
    const addon = addonUsd == null ? null
      : shownCurrency === BASE_CURRENCY ? addonUsd
      : validAmount(explicitLocal?.number_addon?.monthly) ? explicitLocal.number_addon.monthly
      : convertUsdMinor(addonUsd, shownCurrency, fx);
    return {
      key: plan.key, name: plan.name, features: [...FEATURES], limits,
      currency: shownCurrency, price_minor: price,
      base_currency: BASE_CURRENCY, base_price_minor: base,
      dedicated_number: { included: plan.number.included, addon_price_minor: addon, addon_base_price_minor: addonUsd },
      converted: shownCurrency !== BASE_CURRENCY && !explicitLocal,
    };
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
    const plan = planCatalog(restaurants[0].currency, options).find(entry => entry.key === choice.value.plan);
    const currency = plan.currency; // the price is locked in the currency it was shown in
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
