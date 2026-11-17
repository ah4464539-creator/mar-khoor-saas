import { trackingLink } from './order-history.js';

const params = new URLSearchParams(location.hash.slice(1));
const id = Number(params.get('id'));
const token = params.get('t') || '';
const content = document.querySelector('#track-content');
const tabs = document.querySelector('#track-tabs');
const views = { tracking: 'Tracking', details: 'Order details', receipt: 'Receipt', refunds: 'Refunds' };
const steps = ['Received', 'Accepted', 'Being prepared', 'Ready', 'Completed'];
const statuses = ['pending', 'accepted', 'preparing', 'ready', 'completed'];
const node = (tag, text) => Object.assign(document.createElement(tag), { textContent: text });
let order;
let timer;

function render() {
  if (!order) return;
  const requested = new URLSearchParams(location.hash.slice(1)).get('view');
  const view = Object.hasOwn(views, requested) ? requested : 'tracking';
  const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: order.currency });
  tabs.replaceChildren(...Object.entries(views).map(([key, label]) => {
    const link = node('a', label);
    link.href = trackingLink({ id, token }, key);
    if (view === key) link.setAttribute('aria-current', 'page');
    return link;
  }));
  tabs.hidden = false;
  if (order.restaurant_slug) {
    document.querySelector('#order-history-link').href = '/orders.html?restaurant=' + encodeURIComponent(order.restaurant_slug);
  }
  content.replaceChildren(node('h2', views[view]), node('p', order.restaurant_name + ' · Order #' + order.order_id));
  if (view === 'tracking') {
    content.append(node('p', order.status_label));
    const epoch = Number(order.estimated_ready_epoch);
    if (order.estimated_ready_epoch != null && Number.isFinite(epoch) && epoch > 0 &&
        !['completed','cancelled'].includes(order.status)) {
      const remaining = Math.ceil((epoch * 1000 - Date.now()) / 60000);
      const estimate = remaining > 0
        ? 'Restaurant estimated ready in about ' + remaining + ' minute' + (remaining === 1 ? '' : 's')
        : 'Restaurant estimate passed; awaiting an updated time';
      content.append(node('p', estimate + ' (' +
        new Date(epoch * 1000).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'}) + ')'));
    }
    if (order.status !== 'cancelled') {
      const progress = node('ol', '');
      progress.className = 'order-progress';
      steps.forEach((label, index) => {
        const row = node('li', label);
        if (order.status === statuses[index]) row.setAttribute('aria-current', 'step');
        progress.append(row);
      });
      content.append(progress);
    }
    return;
  }
  if (view === 'refunds') {
    content.append(node('p', 'Online refund status is unavailable. Contact the restaurant with your order number for refund help.'));
    if (order.restaurant_slug) {
      const link = node('a', 'Visit restaurant');
      link.href = '/r/' + encodeURIComponent(order.restaurant_slug);
      content.append(link);
    }
    return;
  }
  const placed = new Date(order.placed_at);
  if (!Number.isNaN(placed.getTime())) content.append(node('p', placed.toLocaleString()));
  content.append(node('p', order.status_label));
  for (const item of order.items) {
    const row = node('div', '');
    row.className = 'receipt-row';
    row.append(node('span', item.quantity + ' × ' + item.name));
    if (item.unit_price_minor != null) row.append(node('strong', money.format(item.quantity * item.unit_price_minor / 100)));
    content.append(row);
  }
  content.append(node('p', 'Order total: ' + money.format(order.total_minor / 100)));
  if (view === 'receipt') {
    content.append(node('p', 'Order receipt. Payment status is unavailable.'));
    const print = node('button', 'Print or save PDF');
    print.type = 'button';
    print.addEventListener('click', () => window.print());
    content.append(print);
  }
}

async function load() {
  try {
    if (!Number.isSafeInteger(id) || id < 1 || !/^[a-f0-9]{48}$/.test(token)) throw Error('Open the tracking link from your order confirmation.');
    const response = await fetch('/api/public/orders/' + id + '/status', { headers: { 'X-Tracking-Token': token }, cache: 'no-store' });
    if (!response.ok) throw Error(response.status === 404 ? 'Order not found. Check your tracking link.' : 'Tracking is unavailable. Please try again.');
    order = await response.json();
    if (!order.restaurant_slug && !order.restaurant_name) throw Error('Tracking is unavailable. Please try again.');
    render();
    if (!['completed', 'cancelled'].includes(order.status)) timer = setTimeout(load, 15000);
  } catch (error) {
    if (!order) content.textContent = error.message;
    else timer = setTimeout(load, 15000);
  }
}
window.addEventListener('hashchange', () => {
  const next = new URLSearchParams(location.hash.slice(1));
  if (Number(next.get('id')) !== id || (next.get('t') || '') !== token) location.reload();
  else render();
});
window.addEventListener('pagehide', () => clearTimeout(timer));
window.addEventListener('pageshow', event => { if (event.persisted) load(); });
load();
