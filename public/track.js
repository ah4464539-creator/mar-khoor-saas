// Reads the order id and tracking token from the URL fragment (never sent to the server in a URL).
const params = new URLSearchParams(location.hash.slice(1));
const id = Number(params.get('id')), token = params.get('t') || '';
const el = name => document.querySelector('#track-' + name);
let timer;
async function load() {
  try {
    if (!Number.isSafeInteger(id) || id < 1 || !/^[a-f0-9]{48}$/.test(token)) throw Error('This tracking link is not valid.');
    const response = await fetch('/api/public/orders/' + id + '/status', { headers: { 'X-Tracking-Token': token } });
    const data = await response.json();
    if (!response.ok) throw Error(response.status === 404 ? 'Order not found. Check your tracking link.' : 'Tracking is unavailable. Please try again.');
    el('restaurant').textContent = data.restaurant_name + ' · Order #' + data.order_id;
    el('status').textContent = data.status_label;
    el('items').replaceChildren(...data.items.map(item => Object.assign(document.createElement('li'), { textContent: item.quantity + ' × ' + item.name })));
    el('total').textContent = 'Total: ' + new Intl.NumberFormat(undefined, { style: 'currency', currency: data.currency }).format(data.total_minor / 100);
    el('note').textContent = 'This page updates automatically.';
    if (data.status === 'completed' || data.status === 'cancelled') clearInterval(timer);
  } catch (error) {
    el('status').textContent = error.message;
    clearInterval(timer);
  }
}
load();
timer = setInterval(load, 15000);
