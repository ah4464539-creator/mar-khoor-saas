// Country-wise phone number routing: which provider serves a country, at what price, and how it is fulfilled.
// Pure helpers only (no database, no HTTP) so they are easy to test.

export const PROVIDERS = ['telnyx', 'twilio', 'didww', 'manual'];
export const MODES = ['auto', 'manual', 'unavailable'];
// Providers whose API adapter is implemented. Empty for now: every number is provisioned by hand,
// so a route cannot claim `auto` yet.
export const AUTOMATED_PROVIDERS = [];

const price = value => Number.isSafeInteger(value) && value >= 0 && value <= 10000000;

// Validates a super-admin route update. Returns { route } or { error }.
export function normalizeRoute(country, input) {
  if (typeof country !== 'string' || !/^[A-Z]{2}$/.test(country)) return { error: 'Invalid country' };
  const { provider, mode, monthly_minor: monthly, setup_minor: setup = 0, requirements = '' } = input ?? {};
  if (!PROVIDERS.includes(provider)) return { error: 'Unknown provider' };
  if (!MODES.includes(mode)) return { error: 'Invalid mode' };
  if (mode === 'auto' && !AUTOMATED_PROVIDERS.includes(provider)) return { error: 'Automatic provisioning is not implemented for this provider' };
  if (typeof requirements !== 'string' || requirements.length > 500) return { error: 'Invalid requirements' };
  if (mode === 'unavailable') {
    return { route: { country_code: country, provider, mode, monthly_minor: null, setup_minor: null, requirements } };
  }
  if (!price(monthly) || !price(setup)) return { error: 'Monthly and setup prices must be whole USD cents' };
  return { route: { country_code: country, provider, mode, monthly_minor: monthly, setup_minor: setup, requirements } };
}

// Merges stored routes over the environment catalog (stored routes win) in the shape quotePlan expects.
export function catalogWithRoutes(base, rows) {
  const numbers = { ...(base?.numbers ?? {}) };
  for (const row of rows ?? []) {
    numbers[row.country_code] = row.mode === 'unavailable'
      ? { status: 'unavailable' }
      : { monthly: Number(row.monthly_minor), setup: Number(row.setup_minor ?? 0) };
  }
  return { ...base, numbers };
}

// A quote can be ordered only when every line has a confirmed price and nothing is unavailable.
export function isOrderable(quote) {
  return Array.isArray(quote?.items) && quote.items.length > 0
    && quote.items.every(item => item.status !== 'unavailable' && Number.isSafeInteger(item.monthly) && item.monthly >= 0);
}

// Totals for a cart, including a requested number (which quotePlan lists as "verification pending").
export function orderTotals(quote) {
  const monthly = quote.items.reduce((sum, item) => sum + (item.monthly ?? 0), 0);
  const setup = quote.items.reduce((sum, item) => sum + (item.setup ?? 0), 0);
  return { monthly, firstPayment: monthly + setup };
}

// Allowed status changes. Payment is confirmed by hand, so only a super admin moves an order forward.
export const NEXT_STATUS = {
  pending_payment: ['paid', 'cancelled'],
  paid: ['provisioning', 'cancelled'],
  provisioning: ['active', 'cancelled'],
  active: ['cancelled'],
  cancelled: []
};
