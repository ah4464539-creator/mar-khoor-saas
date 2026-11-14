let platformToken='';const status=document.querySelector('#status');
async function loadAssistants(){const r=await fetch('/api/platform/voice-assistants',{headers:{Authorization:'Bearer '+platformToken}});const data=await r.json();if(!r.ok)throw Error(data.error||'Assistant list unavailable');const root=document.querySelector('#assistant-list');root.replaceChildren();for(const a of data.assistants){const p=document.createElement('p');p.textContent=a.assistant_id+' · '+a.restaurant_name+' · '+(a.active?'Active':'Disabled');root.append(p)}if(!data.assistants.length)root.textContent='No assistants mapped yet.'}
document.querySelector('#assistant-form').addEventListener('submit',async e=>{e.preventDefault();if(!platformToken)return status.textContent='Sign in first.';try{const id=document.querySelector('#assistant-id').value.trim();const restaurant_id=Number(document.querySelector('#assistant-restaurant-id').value);const r=await fetch('/api/platform/voice-assistants/'+encodeURIComponent(id),{method:'PUT',headers:{Authorization:'Bearer '+platformToken,'Content-Type':'application/json'},body:JSON.stringify({restaurant_id,active:true})});const data=await r.json();if(!r.ok)throw Error(data.error||'Mapping failed');await loadAssistants();status.textContent='Assistant mapped.'}catch(err){status.textContent=err.message}});const form=document.querySelector('#login');form.addEventListener('submit',async e=>{e.preventDefault();status.textContent='Signing in…';try{const login=await fetch('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.querySelector('#email').value,password:document.querySelector('#password').value})});const data=await login.json();if(!login.ok)throw Error(data.error||'Login failed');const res=await fetch('/api/platform/summary',{headers:{Authorization:'Bearer '+data.token}});const summary=await res.json();if(!res.ok)throw Error(summary.error||'Access denied');platformToken=data.token;void loadWorkerMetrics(data.token);for(const key of ['restaurants','users','orders'])document.getElementById(key).textContent=summary[key];const tenantsResponse=await fetch('/api/platform/restaurants',{headers:{Authorization:'Bearer '+data.token}});const tenants=await tenantsResponse.json();if(!tenantsResponse.ok)throw Error(tenants.error||'Could not load tenants');const root=document.querySelector('#tenant-list');root.replaceChildren();for(const tenant of tenants.restaurants){const row=document.createElement('p');row.textContent='#'+tenant.id+' · '+tenant.name+' · '+tenant.slug+' · '+tenant.country_code+' · '+tenant.members+' members';root.append(row)}if(!tenants.restaurants.length)root.textContent='No restaurants yet.';await loadAssistants();await loadPlatformPlans().catch(error=>{document.querySelector('#route-list').textContent=error.message});status.textContent='Live platform metrics loaded.'}catch(err){status.textContent=err.message}});
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
    root.append(row);
  }
  if (!orders.length) root.textContent = 'No plan orders yet.';
}
const loadPlatformPlans = () => Promise.all([loadRoutes(), loadOrders()]);
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
