// Single AI tools bought on their own (instead of a full plan): AI Website Builder, WhatsApp
// Business AI and AI Calling. Owner-approved USD prices, converted to the restaurant's currency
// like plans. AI Calling with a new number adds the number's real monthly cost (Telnyx).
// No express import: testable with mock pools.
import { convertUsdMinor } from './fx-rates.js';
import { numberSalesEnabled } from './number-sales.js';

export const TOOLS_SQL = `CREATE TABLE IF NOT EXISTS restaurant_tools (
 restaurant_id BIGINT UNSIGNED NOT NULL,
 tool_key VARCHAR(20) NOT NULL,
 billing_cycle VARCHAR(10) NOT NULL,
 status VARCHAR(20) NOT NULL DEFAULT 'pending_payment',
 number_mode VARCHAR(10) NULL,
 currency CHAR(3) NOT NULL,
 price_minor BIGINT UNSIGNED NOT NULL,
 stripe_subscription_id VARCHAR(64) NULL,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 PRIMARY KEY (restaurant_id,tool_key),
 INDEX (stripe_subscription_id),
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB`;

const ensured = new WeakMap();
export function ensureToolsTable(pool) {
  if (!ensured.has(pool)) ensured.set(pool, pool.query(TOOLS_SQL).catch(error => { ensured.delete(pool); throw error; }));
  return ensured.get(pool);
}

// USD minor units per month. Yearly = 10 months (2 months free), like plans.
export const TOOLS = Object.freeze({
  website: { name: 'AI Website Builder', includes: 'Website with your live menu + AI chat on it (1,500 AI chats a month)', usd: 1200, metric: 'ai_chats', limit: 1500 },
  whatsapp: { name: 'WhatsApp Business AI', includes: 'AI answers and takes orders on your WhatsApp (1,000 AI replies a month)', usd: 1900, metric: 'whatsapp_messages', limit: 1000 },
  calling: { name: 'AI Calling', includes: 'AI answers calls and takes orders (100 call minutes a month)', usd: 2900, metric: 'ai_call_minutes', limit: 100 },
});
export const TOOL_KEYS = Object.freeze(Object.keys(TOOLS));
export const EXTRA_MINUTE_USD = 25; // US$0.25 per call minute above the included minutes
const YEARLY_MONTHS = 10;

// Real monthly cost of a new local number (USD minor), passed through at cost. Override with
// TOOL_NUMBER_COSTS_JSON {"GB":300}. Countries without a known cost offer "own number" only.
const NUMBER_COST_USD = Object.freeze({ US: 100, CA: 100, PK: 4250 });
export function numberCostUsd(country, env = process.env) {
  let overrides = {};
  try { overrides = JSON.parse(env.TOOL_NUMBER_COSTS_JSON || '{}') || {}; } catch { overrides = {}; }
  const value = overrides[country] ?? NUMBER_COST_USD[country];
  return Number.isSafeInteger(value) && value > 0 && value <= 100000 ? value : null;
}

/** Tools given away free while testing: FREE_TOOLS_FOR_TESTING="whatsapp" (comma list of tool keys).
 *  Empty by default. Turning it off stops new free activations; tools already activated stay active. */
export function freeTestTools(env = process.env) {
  return new Set(String(env.FREE_TOOLS_FOR_TESTING || '').split(',').map(key => key.trim()).filter(key => TOOL_KEYS.includes(key)));
}

const local = (usdMinor, currency, fx) => currency === 'USD' ? usdMinor : convertUsdMinor(usdMinor, currency, fx);

/** Tool prices for one restaurant (currency + country), as shown in the cart. */
export function toolCatalog(currency, country, { fx = null, env = process.env } = {}) {
  const shown = currency === 'USD' || fx?.rates?.[currency] ? currency : 'USD';
  const numberUsd = numberSalesEnabled(env) ? numberCostUsd(country, env) : null;
  const free = freeTestTools(env);
  return TOOL_KEYS.map(key => {
    const tool = TOOLS[key];
    const entry = {
      key, name: tool.name, includes: tool.includes, currency: shown, converted: shown !== 'USD', free_test: free.has(key),
      price_minor: { monthly: local(tool.usd, shown, fx), yearly: local(tool.usd * YEARLY_MONTHS, shown, fx) },
      base_price_minor: { monthly: tool.usd, yearly: tool.usd * YEARLY_MONTHS },
    };
    if (key === 'calling') {
      entry.extra_minute_minor = local(EXTRA_MINUTE_USD, shown, fx);
      entry.number = {
        available: numberUsd !== null,
        price_minor: numberUsd === null ? null : { monthly: local(numberUsd, shown, fx), yearly: local(numberUsd * 12, shown, fx) },
        base_price_minor: numberUsd === null ? null : { monthly: numberUsd, yearly: numberUsd * 12 },
        recommend_own: country === 'PK' || numberUsd === null || numberUsd > 1000,
      };
    }
    return entry;
  });
}

export function validateToolChoice(body) {
  const tools = Array.isArray(body?.tools) ? [...new Set(body.tools)].filter(key => TOOL_KEYS.includes(key)) : [];
  if (!tools.length) return { error: 'Choose at least one tool' };
  const cycle = body?.billing_cycle === 'yearly' ? 'yearly' : body?.billing_cycle === 'monthly' || body?.billing_cycle === undefined ? 'monthly' : null;
  if (!cycle) return { error: 'Choose monthly or yearly' };
  const numberMode = tools.includes('calling') ? (body?.call_number === 'new' ? 'new' : 'own') : null;
  return { value: { tools, cycle, numberMode } };
}

/** Lines for the cart and for Stripe, all from the server catalog. */
export function toolCartLines(catalog, { tools, cycle, numberMode }) {
  const lines = [];
  for (const key of tools) {
    const entry = catalog.find(item => item.key === key);
    lines.push({ key, name: entry.name, amount_minor: entry.price_minor[cycle] });
  }
  if (numberMode === 'new') {
    const calling = catalog.find(item => item.key === 'calling');
    if (!calling?.number?.available) return { error: 'A new number is not available. Connect your own number instead.' };
    lines.push({ key: 'number', name: 'Dedicated AI phone number', amount_minor: calling.number.price_minor[cycle] });
  }
  if (lines.some(line => !Number.isSafeInteger(line.amount_minor) || line.amount_minor < 1)) return { error: 'These tools have no confirmed price in your currency yet' };
  return { lines, currency: catalog[0].currency, total_minor: lines.reduce((sum, line) => sum + line.amount_minor, 0) };
}

/** Activates free test tools without payment (price 0, billing_cycle 'free_test', no Stripe id). */
export async function activateFreeTools(db, restaurantId, { tools, numberMode }, currency) {
  for (const key of tools) {
    await db.execute(
      "INSERT INTO restaurant_tools(restaurant_id,tool_key,billing_cycle,status,number_mode,currency,price_minor,stripe_subscription_id) VALUES (?,?,'free_test','active',?,?,0,NULL) "
      + "ON DUPLICATE KEY UPDATE billing_cycle='free_test',status='active',number_mode=VALUES(number_mode),currency=VALUES(currency),price_minor=0,stripe_subscription_id=NULL",
      [restaurantId, key, key === 'calling' ? (numberMode || 'own') : null, currency]);
  }
}

export async function activeTools(db, restaurantId) {
  try {
    const [rows] = await db.execute("SELECT tool_key,billing_cycle,status,number_mode FROM restaurant_tools WHERE restaurant_id=?", [restaurantId]);
    return rows;
  } catch { return []; }
}
export async function hasActiveTool(db, restaurantId, key) {
  try {
    const [rows] = await db.execute("SELECT 1 FROM restaurant_tools WHERE restaurant_id=? AND tool_key=? AND status='active' LIMIT 1", [restaurantId, key]);
    return rows.length > 0;
  } catch { return false; }
}
export async function hasToolNumber(db, restaurantId) {
  try {
    const [rows] = await db.execute("SELECT 1 FROM restaurant_tools WHERE restaurant_id=? AND tool_key='calling' AND status='active' AND number_mode='new' LIMIT 1", [restaurantId]);
    return rows.length > 0;
  } catch { return false; }
}
