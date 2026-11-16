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
}

export function trackingLink(order, view = 'tracking') {
  return '/track.html#' + new URLSearchParams({ id: order.id, t: order.token, view });
}
