import { rememberOrder, savedOrders, trackingLink } from './order-history.js?v=20261128-a1';

const status = document.querySelector('#status');
const target = document.querySelector('#menu');
const cart = new Map();
const storeName = document.querySelector('#store-name');
const cartSubtotal = document.querySelector('#cart-subtotal');
const checkout = document.querySelector('#checkout');
const orderStatus = document.querySelector('#order-status');
const orderForm = document.querySelector('#order-form');
const categoryNav = document.querySelector('#category-nav');
const mobileBar = document.querySelector('#mobile-cart-bar');
let restaurant = null;
let currency = null;

const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text != null) element.textContent = text;
  if (className) element.className = className;
  return element;
};
const money = minor => currency ? currency.format(minor / 100) : String(minor / 100);
const subtotal = () => [...cart.values()].reduce((sum, item) => sum + item.price_minor * item.quantity, 0);
const itemCount = () => [...cart.values()].reduce((sum, item) => sum + item.quantity, 0);

function photoUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value, location.origin);
    if ((url.protocol === 'https:' || (url.origin === location.origin && url.pathname.startsWith('/media/'))) && !url.username && !url.password) return url.href;
  } catch {}
  return null;
}

function setQuantity(item, quantity) {
  if (quantity <= 0) cart.delete(item.id);
  else cart.set(item.id, { ...item, quantity: Math.min(99, quantity) });
  renderCart();
}

function renderCart() {
  const root = document.querySelector('#cart');
  root.replaceChildren(...[...cart.values()].map(item => {
    const row = node('div', null, 'cart-line');
    const name = node('span', item.name, 'cart-name');
    const stepper = node('div', null, 'qty');
    const minus = node('button', '−'); minus.type = 'button'; minus.setAttribute('aria-label', 'Remove one ' + item.name);
    const plus = node('button', '+'); plus.type = 'button'; plus.setAttribute('aria-label', 'Add one ' + item.name);
    minus.addEventListener('click', () => setQuantity(item, item.quantity - 1));
    plus.addEventListener('click', () => setQuantity(item, item.quantity + 1));
    stepper.append(minus, node('strong', String(item.quantity)), plus);
    row.append(name, stepper, node('span', money(item.price_minor * item.quantity), 'num'));
    return row;
  }));
  const count = itemCount();
  checkout.hidden = !cart.size && !orderStatus.childNodes.length;
  orderForm.hidden = !cart.size;
  document.querySelector('#cart-count').textContent = count ? count + (count === 1 ? ' item' : ' items') : '';
  if (restaurant) cartSubtotal.textContent = money(subtotal());
  mobileBar.hidden = !cart.size;
  document.querySelector('#mobile-cart-label').textContent = 'View order · ' + count + (count === 1 ? ' item' : ' items');
  document.querySelector('#mobile-cart-total').textContent = money(subtotal());
  for (const card of target.querySelectorAll('[data-item-id]')) {
    const quantity = cart.get(Number(card.dataset.itemId))?.quantity || 0;
    card.querySelector('.in-cart').textContent = quantity ? quantity + ' in order' : '';
  }
  window.__mkSyncPay?.();
}

function updateOrderLinks(slug) {
  const base = '/orders.html?restaurant=' + encodeURIComponent(slug);
  const latest = savedOrders().find(order => order.slug === slug);
  document.querySelector('#customer-track').href = latest ? trackingLink(latest) : base + '#orders';
  document.querySelector('#customer-orders').href = base + '#orders';
  document.querySelector('#customer-refunds').href = base + '#refunds';
}

function dishCard(item) {
  const card = node('article', null, 'dish-card');
  card.dataset.itemId = item.id;
  const src = photoUrl(item.image_url);
  if (src) {
    const photo = document.createElement('img');
    Object.assign(photo, { src, alt: '', loading: 'lazy', width: 320, height: 240, referrerPolicy: 'no-referrer' });
    photo.className = 'dish-photo';
    card.append(photo);
  }
  const body = node('div', null, 'dish-body');
  const title = node('h3', item.name);
  const description = node('p', item.description || '', 'dish-text');
  const foot = node('div', null, 'dish-foot');
  const add = node('button', 'Add', 'btn btn-ghost btn-sm');
  add.type = 'button';
  add.setAttribute('aria-label', 'Add ' + item.name + ' to order');
  add.addEventListener('click', () => setQuantity(item, (cart.get(item.id)?.quantity || 0) + 1));
  foot.append(node('strong', money(item.price_minor), 'dish-price num'), node('span', '', 'in-cart'), add);
  body.append(title, description, foot);
  card.append(body);
  return card;
}

async function loadMenu(slug) {
  updateOrderLinks(slug);
  status.textContent = 'Loading menu…';
  try {
    const response = await fetch('/api/public/restaurants/' + encodeURIComponent(slug) + '/menu');
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'Menu unavailable');
    restaurant = data.restaurant;
    renderPaymentOptions(data.payment_options);
    currency = new Intl.NumberFormat(undefined, { style: 'currency', currency: restaurant.currency });
    storeName.textContent = restaurant.name;
    document.title = restaurant.name + ' · Menu';
    document.querySelector('#store-mark').textContent = restaurant.name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase() || 'R';
    document.querySelector('#store-link').href = '/r/' + encodeURIComponent(slug);
    const groups = new Map();
    for (const item of data.items) {
      const category = (item.category || '').trim() || 'Menu';
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(item);
    }
    let index = 0;
    for (const [category, items] of groups) {
      const section = node('section', null, 'menu-section');
      section.id = 'category-' + index++;
      section.append(node('h2', category));
      const grid = node('div', null, 'dish-grid');
      grid.append(...items.map(dishCard));
      section.append(grid);
      target.append(section);
      if (groups.size > 1) {
        const link = node('a', category);
        link.href = '#' + section.id;
        categoryNav.append(link);
      }
    }
    categoryNav.hidden = groups.size < 2;
    document.querySelector('#search-label').hidden = !data.items.length;
    status.textContent = data.items.length ? '' : 'No menu items yet.';
  } catch (error) {
    status.textContent = error.message;
  }
}

let paymentOptions = [{ key: 'cash', type: 'cash', label: 'Cash' }];
function renderPaymentOptions(options) {
  paymentOptions = Array.isArray(options) && options.length ? options : [{ key: 'cash', type: 'cash', label: 'Cash' }];
  const box = document.querySelector('#pay-options');
  box.replaceChildren();
  paymentOptions.forEach((option, index) => {
    const label = node('label', null, 'pay-option');
    const input = document.createElement('input');
    input.type = 'radio'; input.name = 'payment_option'; input.value = option.key; input.checked = index === 0;
    const text = node('span', option.label);
    text.dataset.payKey = option.key;
    label.append(input, text);
    box.append(label);
  });
  syncOrderType();
}
function selectedPayment() {
  const key = orderForm.querySelector('input[name="payment_option"]:checked')?.value || 'cash';
  return paymentOptions.find(option => option.key === key) || paymentOptions[0];
}
function syncOrderType() {
  const delivery = orderForm.elements.order_type.value === 'delivery';
  for (const field of orderForm.querySelectorAll('.delivery-only')) field.hidden = !delivery;
  document.querySelector('#delivery-address').required = delivery;
  for (const span of orderForm.querySelectorAll('[data-pay-key="cash"]')) span.textContent = delivery ? 'Cash on delivery' : 'Cash on pickup';
  for (const span of orderForm.querySelectorAll('[data-pay-key="card"]')) span.textContent = delivery ? 'Card on delivery' : 'Card at the counter';
  const option = selectedPayment();
  const transfer = option?.key?.startsWith('transfer:');
  document.querySelector('#pay-transfer').hidden = !transfer;
  if (transfer) {
    document.querySelector('#pay-title').textContent = option.account_title;
    const num = document.querySelector('#pay-number');
    if (option.type === 'link' && /^https:\/\//.test(option.account_number || '')) { const link = document.createElement('a'); link.href = option.account_number; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Pay online'; num.replaceChildren(link); }
    else num.textContent = option.account_number;
    document.querySelector('#pay-instructions').textContent = option.instructions || '';
    document.querySelector('#pay-amount').textContent = document.querySelector('#cart-subtotal').textContent || 'the total';
  }
}
document.querySelector('#pay-copy')?.addEventListener('click', async event => {
  try { await navigator.clipboard.writeText(document.querySelector('#pay-number').textContent); event.target.textContent = 'Copied'; setTimeout(() => { event.target.textContent = 'Copy'; }, 1500); } catch {}
});
window.__mkSyncPay = syncOrderType;
orderForm.addEventListener('change', syncOrderType);
syncOrderType();

orderForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!restaurant || !cart.size) return;
  const orderedFrom = restaurant;
  const submit = orderForm.querySelector('button:not([type=button])');
  const orderType = orderForm.elements.order_type.value;
  submit.disabled = true;
  orderStatus.replaceChildren(node('p', 'Placing order…', 'muted'));
  try {
    const response = await fetch('/api/public/restaurants/' + encodeURIComponent(orderedFrom.slug) + '/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: document.querySelector('#customer-name').value,
        items: [...cart.values()].map(item => ({ menu_item_id: item.id, quantity: item.quantity })),
        order_type: orderType,
        payment_method: orderType === 'delivery' ? 'cod' : 'cash_pickup',
        payment_option: selectedPayment().key,
        payment_reference: selectedPayment().key.startsWith('transfer:') ? document.querySelector('#pay-reference').value.trim() : undefined,
        customer_phone: document.querySelector('#customer-phone').value,
        delivery_address: orderType === 'delivery' ? document.querySelector('#delivery-address').value : '',
        delivery_instructions: orderType === 'delivery' ? document.querySelector('#delivery-instructions').value : '',
        client_request_id: crypto.randomUUID?.() ?? null,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'Order failed');
    const done = node('div', null, 'notice notice-ok');
    const text = node('div');
    const pay = data.payment;
    const online = typeof data.payment_url === 'string' && /^https:\/\/checkout\.stripe\.com\//.test(data.payment_url);
    const payText = online ? 'Taking you to the secure card payment page…'
      : data.payment_fallback === 'cash' ? 'Online payment is not available right now. Please pay in cash on ' + (orderType === 'delivery' ? 'delivery.' : 'pickup.')
      : !pay ? 'Pay in cash on ' + (orderType === 'delivery' ? 'delivery.' : 'pickup.')
      : pay.method_type === 'card_on_delivery' ? 'Pay by card on ' + (orderType === 'delivery' ? 'delivery.' : 'pickup.')
      : pay.status === 'submitted' ? 'We sent your transaction ID to the restaurant. They will confirm your payment.'
      : 'Send ' + document.querySelector('#cart-subtotal').textContent + ' to ' + pay.method_label + ' ' + pay.account_number + ' (' + pay.account_title + '), then add the transaction ID on the tracking page.';
    text.append(node('strong', 'Order #' + data.order_id + ' received'), node('p', 'The restaurant will confirm it shortly. ' + payText));
    if (data.tracking_token) {
      const saved = { id: data.order_id, token: data.tracking_token, restaurant: orderedFrom.name, slug: orderedFrom.slug, currency: orderedFrom.currency, totalMinor: data.total_minor, placedAt: new Date().toISOString() };
      rememberOrder(saved);
      updateOrderLinks(orderedFrom.slug);
      const link = node('a', 'Track your order', 'btn btn-primary btn-sm');
      link.href = trackingLink(saved);
      text.append(link);
    }
    done.append(text);
    orderStatus.replaceChildren(done);
    cart.clear();
    renderCart();
    document.querySelector('#pay-reference').value = '';
    if (online) location.assign(data.payment_url);
  } catch (error) {
    orderStatus.replaceChildren(node('p', error.message, 'notice notice-bad'));
  } finally {
    submit.disabled = false;
  }
});

const menuSearch = document.querySelector('#menu-search');
menuSearch.addEventListener('input', () => {
  const query = menuSearch.value.trim().toLocaleLowerCase();
  let matches = 0;
  for (const card of target.querySelectorAll('article')) {
    const text = [...card.querySelectorAll('h3, p')].map(item => item.textContent).join(' ');
    card.hidden = !text.toLocaleLowerCase().includes(query);
    if (!card.hidden) matches++;
  }
  for (const section of target.querySelectorAll('.menu-section')) section.hidden = !section.querySelector('article:not([hidden])');
  status.textContent = query ? (matches ? matches + ' matching items' : 'No items match your search.') : '';
});

const preset = new URLSearchParams(location.search).get('restaurant');
if (preset && /^[a-z0-9-]{1,160}$/.test(preset)) loadMenu(preset);
else status.textContent = 'Open the menu from your restaurant’s website.';
