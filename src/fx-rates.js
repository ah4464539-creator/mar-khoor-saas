// USD exchange rates for showing plan prices in each restaurant's own currency.
// Source: ExchangeRate-API open access (no key, updated daily, attribution required in the UI).
// Cached in memory; a failed refresh keeps the last good rates for up to 7 days, then falls back
// to SUBSCRIPTION_FX_JSON ({"PKR":280.5,...}) and finally to no rates (prices shown in USD).

export const FX_SOURCE_URL = 'https://open.er-api.com/v6/latest/USD';
export const FX_ATTRIBUTION = { name: 'ExchangeRate-API', url: 'https://www.exchangerate-api.com' };
const FRESH_MS = 12 * 60 * 60 * 1000;
const STALE_MS = 7 * 24 * 60 * 60 * 1000;
const RETRY_MS = 10 * 60 * 1000;

let cache = null;        // { rates, asOf, fetchedAt, source }
let lastFailureAt = 0;

export function resetFxCache() { cache = null; lastFailureAt = 0; }

function validRates(rates) {
  if (!rates || typeof rates !== 'object' || Array.isArray(rates)) return null;
  const out = {};
  for (const [code, value] of Object.entries(rates)) {
    if (/^[A-Z]{3}$/.test(code) && typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1e7) out[code] = value;
  }
  out.USD = 1;
  return Object.keys(out).length > 1 ? out : null;
}

function envRates(text = process.env.SUBSCRIPTION_FX_JSON) {
  if (typeof text !== 'string' || !text.trim()) return null;
  try { return validRates(JSON.parse(text)); } catch { return null; }
}

/** Returns { rates, asOf, source } or null. Never throws. */
export async function getUsdRates({ fetcher = fetch, now = Date.now(), envJson } = {}) {
  if (cache && now - cache.fetchedAt < FRESH_MS) return cache;
  if (now - lastFailureAt >= RETRY_MS) {
    try {
      const response = await fetcher(FX_SOURCE_URL, { signal: AbortSignal.timeout(5000), headers: { Accept: 'application/json' } });
      const data = response.ok ? await response.json() : null;
      const rates = data?.result === 'success' && data?.base_code === 'USD' ? validRates(data.rates) : null;
      if (rates) {
        cache = { rates, asOf: typeof data.time_last_update_utc === 'string' ? data.time_last_update_utc.slice(0, 40) : null, fetchedAt: now, source: 'exchangerate-api' };
        return cache;
      }
      lastFailureAt = now;
    } catch {
      lastFailureAt = now;
    }
  }
  if (cache && now - cache.fetchedAt < STALE_MS) return cache;
  const fallback = envRates(envJson);
  return fallback ? { rates: fallback, asOf: null, fetchedAt: now, source: 'configured' } : null;
}

/** Rounds a converted amount (major units) to a clean price people expect to see. */
export function niceAmount(major) {
  if (!Number.isFinite(major) || major <= 0) return 0;
  if (major >= 1000) return Math.round(major / 100) * 100;
  if (major >= 100) return Math.round(major / 10) * 10;
  return Math.max(1, Math.round(major));
}

/** Converts USD minor units to the target currency's minor units (app-wide convention: /100). */
export function convertUsdMinor(usdMinor, currency, fx) {
  if (!Number.isSafeInteger(usdMinor)) return null;
  if (currency === 'USD') return usdMinor;
  const rate = fx?.rates?.[currency];
  if (!rate) return null;
  return niceAmount((usdMinor / 100) * rate) * 100;
}
