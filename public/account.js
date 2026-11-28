// Customer account: email sign-in link, then the orders and bookings of every phone.
import { customerSession, setCustomerSession, syncAccountOrders, trackingLink } from './order-history.js?v=20261128-a1';

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const status = $('acct-status');
const STATUS = { pending: 'Waiting for the business', confirmed: 'Confirmed', cancelled: 'Cancelled', completed: 'Completed', no_show: 'Missed', checked_in: 'Checked in' };

async function call(path, options = {}) {
  const session = customerSession();
  const headers = { ...(options.headers || {}), ...(session ? { 'X-Customer-Session': session } : {}) };
  const r = await fetch('/api/public/customer' + path, { ...options, headers, cache: 'no-store' });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) setCustomerSession('');
  if (!r.ok) throw Object.assign(Error(data.error || 'Something went wrong. Please try again.'), { status: r.status });
  return data;
}

function money(minor, currency) {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(minor) / 100); } catch { return ''; }
}

function showSignIn(message = '') {
  $('acct-signin').hidden = false; $('acct-signedin').hidden = true; status.textContent = message;
}

async function showAccount() {
  status.textContent = 'Loading…';
  const me = await call('/me');
  $('acct-who').textContent = me.email;
  $('acct-signin').hidden = true; $('acct-signedin').hidden = false;
  const [orders, bookings] = await Promise.all([syncAccountOrders(), call('/bookings').then(d => d.bookings || []).catch(() => [])]);
  const orderItems = orders.map(o => {
    const li = el('li', 'cust-item'), box = el('div', 'cust-card'), text = el('div', 'cust-text');
    const a = el('a', 'cust-name', 'Order #' + o.id); a.href = trackingLink(o);
    text.append(a, el('span', 'cust-tagline', o.restaurant || ''));
    const when = o.placedAt ? new Date(o.placedAt) : null;
    if (when && !Number.isNaN(when.getTime())) text.append(el('span', 'cust-address', when.toLocaleString()));
    if (/^[A-Z]{3}$/.test(o.currency || '') && Number.isFinite(o.totalMinor)) text.append(el('span', 'tag', money(o.totalMinor, o.currency)));
    box.append(text); li.append(box); return li;
  });
  $('acct-orders').replaceChildren(...(orderItems.length ? orderItems : [el('li', 'cust-status', 'No orders yet.')]));
  const bookingItems = bookings.map(b => {
    const li = el('li', 'cust-item'), box = el('div', 'cust-card'), text = el('div', 'cust-text');
    const title = el('a', 'cust-name', (b.service || 'Booking') + ' · ' + (b.business || ''));
    if (typeof b.url === 'string' && /^\/r\/[a-z0-9-]{1,160}$/.test(b.url)) title.href = b.url;
    text.append(title, el('span', 'cust-address', String(b.start_at || '').replace('T', ' ')), el('span', 'tag', STATUS[b.status] || b.status || ''));
    if (b.price_minor > 0 && /^[A-Z]{3}$/.test(b.currency || '')) text.append(el('span', 'cust-tagline', money(b.price_minor, b.currency)));
    box.append(text); li.append(box); return li;
  });
  $('acct-bookings').replaceChildren(...(bookingItems.length ? bookingItems : [el('li', 'cust-status', 'No bookings yet. Bookings you make while signed in appear here.')]));
  status.textContent = '';
}

$('acct-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter || event.target.querySelector('button');
  button.disabled = true; status.textContent = 'Sending…';
  try {
    await call('/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: $('acct-email').value }) });
    status.textContent = 'Check your email and open the sign-in link on this phone. It expires in 20 minutes.';
  } catch (error) { status.textContent = error.message; }
  button.disabled = false;
});

$('acct-signout').addEventListener('click', async () => {
  await call('/logout', { method: 'POST' }).catch(() => {});
  setCustomerSession('');
  showSignIn('Signed out. Your orders stay saved on this phone.');
});

async function start() {
  const login = new URLSearchParams(location.hash.slice(1)).get('login');
  if (login) {
    history.replaceState(null, '', location.pathname); // the one-time token leaves the address bar at once
    try {
      const data = await call('/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: login }) });
      setCustomerSession(data.session);
    } catch (error) { return showSignIn(error.message); }
  }
  if (!customerSession()) return showSignIn();
  try { await showAccount(); } catch (error) { if (error.status === 401) showSignIn('Please sign in again.'); else status.textContent = error.message; }
}
start();
