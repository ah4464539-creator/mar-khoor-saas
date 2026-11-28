import { trackingLink } from './order-history.js?v=20261128-a1';

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
  const head = node('div', '');
  head.className = 'track-head';
  const titles = node('div', '');
  const eyebrow = node('span', order.restaurant_name + ' · Order #' + order.order_id);
  eyebrow.className = 'eyebrow';
  titles.append(eyebrow, node('h2', view === 'tracking' ? order.status_label : views[view]));
  head.append(titles);
  content.replaceChildren(head);
  if (view === 'tracking') {
    const epoch = Number(order.estimated_ready_epoch);
    if (order.estimated_ready_epoch != null && Number.isFinite(epoch) && epoch > 0 &&
        !['completed','cancelled'].includes(order.status)) {
      const remaining = Math.ceil((epoch * 1000 - Date.now()) / 60000);
      const eta = node('div', '');
      eta.className = 'track-eta';
      eta.append(node('small', remaining > 0 ? 'Estimated ready in' : 'Restaurant estimate passed'),
        node('strong', remaining > 0 ? remaining + ' min' : 'Awaiting update'),
        node('small', 'around ' + new Date(epoch * 1000).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'})));
      eta.setAttribute('aria-label', remaining > 0
        ? 'Restaurant estimated ready in about ' + remaining + ' minute' + (remaining === 1 ? '' : 's')
        : 'Restaurant estimate passed; awaiting an updated time');
      head.append(eta);
    }
    if (order.status !== 'cancelled') {
      const current = statuses.indexOf(order.status);
      const bar = node('div', '');
      bar.className = 'bar track-bar';
      const fill = document.createElement('i');
      fill.style.width = Math.max(8, (current + 1) / statuses.length * 100) + '%';
      bar.append(fill);
      const progress = node('ol', '');
      progress.className = 'order-progress';
      steps.forEach((label, index) => {
        const row = node('li', '');
        row.append(node('span', index < current ? '✓' : ''), node('strong', label));
        if (index < current) row.className = 'done';
        if (order.status === statuses[index]) row.setAttribute('aria-current', 'step');
        progress.append(row);
      });
      content.append(bar, progress);
    } else content.append(node('p', 'This order was cancelled by the restaurant. Contact them if you have questions.'));
    if (order.payment) content.append(paymentBox(order.payment, money));
    else if (order.payment_method) content.append(node('p', (order.payment_method === 'cod' ? 'Cash on delivery' : order.payment_method === 'cash_pickup' ? 'Cash on pickup' : 'Payment') + ' · ' + (order.payment_status === 'paid' ? 'paid' : 'unpaid')));
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
  const total = node('div', '');
  total.className = 'receipt-row receipt-total';
  total.append(node('strong', 'Total'), node('strong', money.format(order.total_minor / 100)));
  content.append(total);
  if (view === 'receipt') {
    content.append(node('p', 'Order receipt. Payment status is unavailable.'));
    const print = node('button', 'Print or save PDF');
    print.className = 'btn btn-ghost';
    print.type = 'button';
    print.addEventListener('click', () => window.print());
    content.append(print);
  }
}

const PAY_STATE = { awaiting: 'Waiting for your payment', submitted: 'Transaction ID sent · restaurant is checking', confirmed: 'Paid · confirmed by the restaurant', rejected: 'Payment not found · check the transaction ID' };
function paymentBox(pay, money) {
  const box = node('section', '');
  box.className = 'notice ' + (pay.status === 'confirmed' ? 'notice-ok' : pay.status === 'rejected' ? 'notice-warn' : 'notice-info');
  const card = pay.method_type === 'card_on_delivery';
  box.append(node('strong', pay.method_label + ' · ' + (card ? (pay.status === 'confirmed' ? 'paid' : 'pay by card when you receive the order') : PAY_STATE[pay.status] || pay.status)));
  if (!card && pay.account_number && pay.status !== 'confirmed') {
    box.append(node('p', 'Send ' + money.format(order.total_minor / 100) + ' to ' + pay.account_title + ' · ' + pay.account_number + (pay.instructions ? ' (' + pay.instructions + ')' : '')));
    if (pay.status === 'awaiting' || pay.status === 'rejected') {
      const form = document.createElement('form');
      form.className = 'pay-reference-form';
      const label = node('label', 'Transaction ID');
      label.htmlFor = 'track-reference';
      const input = document.createElement('input');
      input.id = 'track-reference'; input.className = 'input'; input.maxLength = 60; input.autocomplete = 'off'; input.required = true;
      const button = node('button', 'Send to restaurant');
      button.className = 'btn btn-primary btn-sm';
      const note = node('p', '');
      note.setAttribute('role', 'status');
      form.append(label, input, button, note);
      form.addEventListener('submit', async event => {
        event.preventDefault();
        button.disabled = true;
        try {
          const response = await fetch('/api/public/orders/' + id + '/payment-reference', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tracking-Token': token }, body: JSON.stringify({ reference: input.value }) });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw Error(data.error || 'Could not send. Try again.');
          order.payment.status = 'submitted';
          render();
        } catch (error) { note.textContent = error.message; button.disabled = false; }
      });
      box.append(form);
    }
  }
  return box;
}

async function load() {
  try {
    if (!Number.isSafeInteger(id) || id < 1 || !/^[a-f0-9]{48}$/.test(token)) throw Error('Open the tracking link from your order confirmation.');
    const response = await fetch('/api/public/orders/' + id + '/status', { headers: { 'X-Tracking-Token': token }, cache: 'no-store' });
    if (!response.ok) throw Error(response.status === 404 ? 'Order not found. Check your tracking link.' : 'Tracking is unavailable. Please try again.');
    order = await response.json();
    if (!order.restaurant_slug && !order.restaurant_name) throw Error('Tracking is unavailable. Please try again.');
    if (document.activeElement?.id !== 'track-reference') render();
    showNotify();
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
// "Notify me": push notifications for this order, through the same service worker as the apps.
const notifyBox = document.querySelector('#track-notify');
const notifyBtn = document.querySelector('#track-notify-btn');
const notifyStatus = document.querySelector('#track-notify-status');
const notifyKey = 'mar-khoor.notify.' + id;
const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const storedOn = () => { try { return localStorage.getItem(notifyKey) === '1'; } catch { return false; } };
function showNotify() {
  if (!notifyBox || !pushSupported || !order || ['completed', 'cancelled'].includes(order.status)) { if (notifyBox) notifyBox.hidden = true; return; }
  notifyBox.hidden = false;
  if (storedOn() && Notification.permission === 'granted') { notifyBtn.hidden = true; notifyStatus.textContent = '🔔 Notifications are on for this order.'; }
  else if (Notification.permission === 'denied') { notifyBtn.hidden = true; notifyStatus.textContent = 'Notifications are blocked. Allow them in your phone or browser settings for this site.'; }
}
const keyBytes = b64 => { const raw = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - b64.length % 4) % 4)); return Uint8Array.from(raw, c => c.charCodeAt(0)); };
notifyBtn?.addEventListener('click', async () => {
  notifyBtn.disabled = true; notifyStatus.textContent = 'Turning on…';
  try {
    if (await Notification.requestPermission() !== 'granted') throw Error('Notifications were not allowed.');
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(() => navigator.serviceWorker.ready);
    const keyRes = await fetch('/api/public/push-key');
    if (!keyRes.ok) throw Error('Notifications are unavailable right now.');
    const { public_key: publicKey } = await keyRes.json();
    const subscription = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
    const r = await fetch('/api/public/orders/' + id + '/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tracking-Token': token }, body: JSON.stringify({ subscription }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(data.error || 'Could not turn on notifications.');
    try { localStorage.setItem(notifyKey, '1'); } catch {}
    showNotify();
  } catch (error) { notifyStatus.textContent = error.message || 'Could not turn on notifications.'; notifyBtn.disabled = false; }
});
window.addEventListener('pagehide', () => clearTimeout(timer));
window.addEventListener('pageshow', event => { if (event.persisted) load(); });
load();
