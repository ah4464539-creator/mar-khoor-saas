const storageKey = 'mar-khoor.customer-orders';
const validOrder = order => Number.isSafeInteger(order?.id) && order.id > 0 &&
  typeof order.token === 'string' && /^[a-f0-9]{48}$/.test(order.token);

export function savedOrders() {
  try {
    const orders = JSON.parse(localStorage.getItem(storageKey) || '[]');
    return Array.isArray(orders) ? orders.filter(validOrder) : [];
  } catch { return []; }
}

export function rememberOrder(order) {
  if (!validOrder(order)) return;
  try {
    localStorage.setItem(storageKey, JSON.stringify([order, ...savedOrders().filter(saved => saved.id !== order.id)].slice(0, 40)));
  } catch { /* The checkout tracking link still works without browser storage. */ }
  // Signed in: add the new order to the account in the background.
  if (customerSession()) syncAccountOrders().catch(() => {});
}

// Customer account (Mar-Khoor app): orders follow the customer to every phone they sign in on.
const SESSION_KEY = 'mar-khoor.customer-session';
export function customerSession() {
  try { const s = localStorage.getItem(SESSION_KEY) || ''; return /^[a-f0-9]{64}$/.test(s) ? s : ''; } catch { return ''; }
}
export function setCustomerSession(session) {
  try { if (session) localStorage.setItem(SESSION_KEY, session); else localStorage.removeItem(SESSION_KEY); } catch {}
}
/** Sends this phone's orders to the account and saves the account's orders here. Returns the list. */
export async function syncAccountOrders() {
  const session = customerSession();
  if (!session) return savedOrders();
  const r = await fetch('/api/public/customer/orders/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Customer-Session': session },
    body: JSON.stringify({ orders: savedOrders().map(o => ({ id: o.id, token: o.token })) }) });
  if (r.status === 401) { setCustomerSession(''); return savedOrders(); }
  if (!r.ok) return savedOrders();
  const data = await r.json();
  const local = new Map(savedOrders().map(o => [o.id, o]));
  const merged = (data.orders || []).filter(validOrder).map(o => ({ ...o, ...(local.get(o.id) || {}) }));
  for (const o of local.values()) if (!merged.some(m => m.id === o.id)) merged.push(o);
  merged.sort((a, b) => b.id - a.id);
  try { localStorage.setItem(storageKey, JSON.stringify(merged.slice(0, 100))); } catch {}
  return merged;
}

export function trackingLink(order, view = 'tracking') {
  return '/track.html#' + new URLSearchParams({ id: order.id, t: order.token, view });
}
