import { savedOrders, trackingLink, syncAccountOrders, customerSession } from './order-history.js?v=20261128-a1';

const restaurant = new URLSearchParams(location.search).get('restaurant');
if (restaurant && /^[a-z0-9-]{1,160}$/.test(restaurant)) {
  document.querySelector('#back-to-menu').href = '/menu.html?restaurant=' + encodeURIComponent(restaurant);
}
const activity = document.querySelector('#activity');
const node = (tag, text) => Object.assign(document.createElement(tag), { textContent: text });

function render() {
  const view = location.hash === '#refunds' ? 'refunds' : 'orders';
  for (const link of document.querySelectorAll('#activity-tabs a')) {
    if (link.hash === '#' + view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  const orders = savedOrders().filter(order => !restaurant || order.slug === restaurant);
  if (!orders.length) {
    activity.replaceChildren(node('h2', 'No saved orders'), node('p', 'Orders you place on this browser will appear here.'));
    return;
  }
  const rows = orders.map(order => {
    const row = node('div', '');
    row.className = 'order-row';
    const info = node('div', '');
    const link = node('a', 'Order #' + order.id);
    link.href = trackingLink(order, view === 'refunds' ? 'refunds' : 'details');
    const date = new Date(order.placedAt);
    info.append(link, node('span', order.restaurant || 'Restaurant'), node('small', Number.isNaN(date.getTime()) ? '' : date.toLocaleString()));
    row.append(info);
    if (typeof order.currency === 'string' && /^[A-Z]{3}$/.test(order.currency) && Number.isFinite(order.totalMinor)) {
      row.append(node('strong', new Intl.NumberFormat(undefined, { style: 'currency', currency: order.currency }).format(order.totalMinor / 100)));
    }
    return row;
  });
  if (view === 'refunds') rows.unshift(node('p', 'Choose an order for refund information.'));
  activity.replaceChildren(...rows);
}
window.addEventListener('hashchange', render);
render();
// Signed in: show the orders from every phone; otherwise offer to sign in.
const foot = document.querySelector('#orders-account');
if (customerSession()) { if (foot) foot.textContent = 'Signed in: your orders from every phone are shown.'; syncAccountOrders().then(render).catch(() => {}); }
