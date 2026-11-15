let platformToken='';const status=document.querySelector('#status');
async function loadAssistants(){const r=await fetch('/api/platform/voice-assistants',{headers:{Authorization:'Bearer '+platformToken}});const data=await r.json();if(!r.ok)throw Error(data.error||'Assistant list unavailable');const root=document.querySelector('#assistant-list');root.replaceChildren();for(const a of data.assistants){const p=document.createElement('p');p.textContent=a.assistant_id+' · '+a.restaurant_name+' · '+(a.active?'Active':'Disabled');root.append(p)}if(!data.assistants.length)root.textContent='No assistants mapped yet.'}
document.querySelector('#assistant-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!platformToken) return;
  const form = event.currentTarget;
  const button = form.querySelector('button');
  const output = document.querySelector('#assistant-status');
  if (button.disabled) return;
  const id = document.querySelector('#assistant-id').value.trim();
  const restaurant_id = Number(document.querySelector('#assistant-restaurant-id').value);
  if (!id) {
    output.textContent = 'Enter the Vapi assistant ID.';
    return;
  }
  button.disabled = true;
  output.textContent = 'Saving mapping…';
  try {
    await platformApi('/api/platform/voice-assistants/' + encodeURIComponent(id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurant_id, active: true }),
    });
    form.reset();
    output.textContent = 'Mapping saved.';
    await loadAssistants().catch(() => {
      output.textContent = 'Mapping saved. Reload the page to refresh the list.';
    });
  } catch (error) {
    output.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
const form = document.querySelector('#login');
const loginScreen = document.querySelector('#platform-login-screen');
const workspace = document.querySelector('#platform-workspace');
const loginStatus = document.querySelector('#login-status');
const signIn = form.querySelector('button');
const signOut = document.querySelector('#platform-sign-out');

async function loadSummary() {
  const summary = await platformApi('/api/platform/summary');
  for (const key of ['restaurants', 'users', 'orders']) {
    document.getElementById(key).textContent = summary[key];
  }
}

async function loadTenants() {
  const { restaurants } = await platformApi('/api/platform/restaurants');
  const root = document.querySelector('#tenant-list');
  root.replaceChildren();
  for (const tenant of restaurants) {
    const row = document.createElement('p');
    row.textContent = '#' + tenant.id + ' · ' + tenant.name + ' · ' + tenant.slug + ' · ' + tenant.country_code + ' · ' + tenant.members + ' members';
    root.append(row);
  }
  if (!restaurants.length) root.textContent = 'No restaurants yet.';
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (signIn.disabled) return;
  signIn.disabled = true;
  loginStatus.textContent = 'Signing in…';
  try {
    const response = await fetch('/auth/platform-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: form.querySelector('#email').value, password: form.querySelector('#password').value }),
    });
    const { token, expiresIn, error } = await response.json();
    if (!response.ok || !token) throw Error(error || 'Sign-in failed');

    platformToken = token;
    form.reset();
    loginStatus.textContent = '';
    loginScreen.hidden = true;
    workspace.hidden = false;
    document.querySelector('#platform-heading').focus();
    window.setTimeout(() => window.location.reload(), expiresIn * 1000);

    const panels = [
      [loadSummary, '#status'],
      [loadTenants, '#tenant-list'],
      [loadAssistants, '#assistant-list'],
      [() => loadWorkerMetrics(token), '#worker-status'],
      [loadRoutes, '#route-list'],
      [loadOrders, '#order-list'],
      [loadNumbers, '#number-list'],
    ];
    await Promise.all(panels.map(async ([load, output]) => {
      try { await load(); }
      catch (error) { document.querySelector(output).textContent = error.message; }
    }));
  } catch (error) {
    loginStatus.textContent = error.message;
  } finally {
    signIn.disabled = false;
  }
});

signOut.addEventListener('click', async () => {
  signOut.disabled = true;
  try {
    await platformApi('/auth/logout', { method: 'POST' });
    window.location.reload();
  } catch (error) {
    status.textContent = error.message;
    signOut.disabled = false;
  }
});

async function loadWorkerMetrics(token) {
  const output = document.querySelector('#worker-status');
  const metrics = document.querySelector('#worker-metrics');
  output.textContent = 'Loading worker metrics…';
  metrics.replaceChildren();
  try {
    const response = await fetch('/api/platform/whatsapp-ai/monitor', {
      headers: { Authorization: 'Bearer ' + token },
    });
    if (!response.ok) throw Error('WhatsApp monitoring is currently unavailable.');
    const data = await response.json();
    if (token !== platformToken) return;
    const totals = [
      ['Delayed jobs', data.delayed_pending],
      ['Stalled jobs', data.stale_processing],
      ...data.jobs.map(job => ['Jobs · ' + job.status, job.count]),
      ...data.outbound_last_24h.map(item => ['Last 24 hours · ' + item.status, item.count]),
    ];
    for (const [label, count] of totals) {
      const term = document.createElement('dt');
      const value = document.createElement('dd');
      term.textContent = label;
      value.textContent = count;
      metrics.append(term, value);
    }
    output.textContent = 'Worker and delivery counts loaded.';
  } catch (error) {
    if (token === platformToken) output.textContent = error.message;
  }
}

// Phone number routes and plan orders.
const usd = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
async function platformApi(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...options.headers, Authorization: 'Bearer ' + platformToken } });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || 'Request failed');
  return data;
}
const nextStatuses = { pending_payment: ['paid', 'cancelled'], paid: ['provisioning', 'cancelled'], provisioning: ['active', 'cancelled'], active: ['cancelled'], cancelled: [] };
async function loadRoutes() {
  const { routes } = await platformApi('/api/platform/number-routes');
  const root = document.querySelector('#route-list');
  root.replaceChildren();
  for (const route of routes) {
    const row = document.createElement('p');
    row.textContent = route.country_code + ' · ' + route.provider + ' · ' + (route.mode === 'unavailable' ? 'not available'
      : usd(route.monthly_minor) + ' / month · ' + usd(route.setup_minor ?? 0) + ' setup') + (route.requirements ? ' · ' + route.requirements : '');
    root.append(row);
  }
  if (!routes.length) root.textContent = 'No routes yet. A country without a route cannot order a number.';
}
async function loadOrders() {
  const { orders } = await platformApi('/api/platform/plan-orders');
  const root = document.querySelector('#order-list');
  root.replaceChildren();
  for (const order of orders) {
    const row = document.createElement('p');
    row.textContent = '#' + order.id + ' · ' + order.restaurant_name + ' (' + order.country_code + ') · ' + order.features.join(', ')
      + (order.number_mode === 'new' ? ' + number' : '') + ' · ' + usd(order.monthly_minor) + ' / month · first payment '
      + usd(order.first_payment_minor) + ' · ' + order.status.replace('_', ' ') + ' ';
    for (const next of nextStatuses[order.status] || []) {
      const button = document.createElement('button');
      button.textContent = next.replace('_', ' ');
      button.addEventListener('click', async () => {
        try {
          await platformApi('/api/platform/plan-orders/' + order.id + '/status', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: next }) });
          await loadOrders();
        } catch (error) { document.querySelector('#route-status').textContent = error.message; }
      });
      row.append(button);
    }
    if (order.number_mode === 'new' && ['paid', 'provisioning'].includes(order.status)) {
      const find = document.createElement('button');
      find.textContent = 'Find numbers';
      find.addEventListener('click', () => findNumbers(order));
      row.append(find);
    }
    root.append(row);
  }
  if (!orders.length) root.textContent = 'No plan orders yet.';
}
const numberStatus = message => { document.querySelector('#number-status').textContent = message; };
async function findNumbers(order) {
  const root = document.querySelector('#number-candidates');
  root.replaceChildren();
  numberStatus('Searching ' + order.country_code + '…');
  try {
    const data = await platformApi('/api/platform/plan-orders/' + order.id + '/number-candidates');
    numberStatus(data.candidates.length ? 'Pick one number for order #' + order.id + '.' : 'No numbers found for ' + order.country_code + '.');
    for (const item of data.candidates) {
      const row = document.createElement('p');
      row.textContent = item.phone_number + ' · provider cost ' + (item.monthly_cost ?? '?') + ' ' + (item.currency ?? '') + ' / month, upfront ' + (item.upfront_cost ?? '?') + ' ';
      const buy = document.createElement('button');
      buy.textContent = 'Buy this number';
      buy.addEventListener('click', async () => {
        if (!confirm('Buy ' + item.phone_number + ' for order #' + order.id + '? This spends real money.')) return;
        buy.disabled = true;
        try {
          const result = await platformApi('/api/platform/plan-orders/' + order.id + '/number', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone_number: item.phone_number, confirm_purchase: true }) });
          numberStatus(result.note || ('Number ' + result.phone_number + ' is ' + result.status + '.'));
          root.replaceChildren();
          await Promise.all([loadNumbers(), loadOrders()]);
        } catch (error) { numberStatus(error.message); buy.disabled = false; }
      });
      row.append(buy);
      root.append(row);
    }
  } catch (error) { numberStatus(error.message); }
}
async function loadNumbers() {
  const { numbers } = await platformApi('/api/platform/numbers');
  const root = document.querySelector('#number-list');
  root.replaceChildren();
  for (const n of numbers) {
    const row = document.createElement('p');
    row.textContent = n.phone_number + ' · ' + n.restaurant_name + ' · order #' + n.plan_order_id + ' · ' + n.status.replace('_', ' ') + (n.last_error ? ' · ' + n.last_error : '') + ' ';
    if (['pending_provider', 'import_failed'].includes(n.status)) {
      const retry = document.createElement('button');
      retry.textContent = 'Retry import';
      retry.addEventListener('click', async () => {
        try { const result = await platformApi('/api/platform/numbers/' + n.id + '/retry', { method: 'POST' }); numberStatus('Number is ' + result.status + '.'); await loadNumbers(); }
        catch (error) { numberStatus(error.message); }
      });
      row.append(retry);
    }
    root.append(row);
  }
  if (!numbers.length) root.textContent = 'No numbers bought yet.';
}
document.querySelector('#route-form').addEventListener('submit', async event => {
  event.preventDefault();
  const output = document.querySelector('#route-status');
  if (!platformToken) { output.textContent = 'Sign in first.'; return; }
  const mode = document.querySelector('#route-mode').value;
  const cents = id => { const value = document.querySelector(id).value; return value === '' ? null : Math.round(Number(value) * 100); };
  const body = { provider: document.querySelector('#route-provider').value, mode, requirements: document.querySelector('#route-requirements').value.trim() };
  if (mode !== 'unavailable') { body.monthly_minor = cents('#route-monthly'); body.setup_minor = cents('#route-setup') ?? 0; }
  try {
    await platformApi('/api/platform/number-routes/' + encodeURIComponent(document.querySelector('#route-country').value.trim().toUpperCase()), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    output.textContent = 'Route saved.';
    await loadRoutes();
  } catch (error) { output.textContent = error.message; }
});
