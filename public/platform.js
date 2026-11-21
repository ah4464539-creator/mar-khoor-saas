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

async function confirmDeleteTenant(tenant, button) {
  button.disabled = true;
  try {
    const preview = await platformApi('/api/platform/restaurants/' + tenant.id + '/delete-preview');
    if (preview.blockers.length) { window.alert('Cannot delete ' + tenant.name + ':\n\n' + preview.blockers.join('\n')); return; }
    const c = preview.counts;
    const typed = window.prompt('PERMANENTLY delete "' + tenant.name + '" (' + tenant.slug + ')?\n\n'
      + c.orders + ' orders, ' + c.menu_items + ' menu items, ' + c.customers + ' customers and all chats, calls, website and settings will be deleted.\n'
      + (preview.logins_removed.length ? 'Logins removed: ' + preview.logins_removed.join(', ') + '\n' : '')
      + '\nThis cannot be undone. Type the restaurant name to confirm:');
    if (typed === null) return;
    const result = await platformApi('/api/platform/restaurants/' + tenant.id, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm_name: typed }) });
    window.alert('Deleted ' + result.deleted + ' (' + result.rows + ' records).');
    await loadTenants();
  } catch (error) { window.alert(error.message); }
  finally { button.disabled = false; }
}

async function loadTenants() {
  const { restaurants } = await platformApi('/api/platform/restaurants');
  const root = document.querySelector('#tenant-list');
  root.replaceChildren();
  for (const tenant of restaurants) {
    const row = document.createElement('p');
    row.className = 'tenant-row';
    const text = document.createElement('span');
    text.textContent = '#' + tenant.id + ' · ' + tenant.name + ' · ' + tenant.slug + ' · ' + tenant.country_code + ' · ' + tenant.members + ' members';
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'btn btn-ghost btn-sm tenant-delete'; remove.textContent = 'Delete';
    remove.addEventListener('click', () => confirmDeleteTenant(tenant, remove));
    row.append(text, remove);
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
      [loadWhatsAppNumbers, '#wa-number-list'],
      [() => loadWorkerMetrics(token), '#worker-status'],
      [loadRoutes, '#route-list'],
      [loadSubscriptions, '#subscription-list'],
      [loadOrders, '#order-list'],
      [loadNumbers, '#number-list'],
      [loadHealth, '#health-status'],
      [loadDomains, '#domain-list'],
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
const subscriptionActions = {
  pending_payment: [['active', 'Confirm payment'], ['cancelled', 'Cancel']],
  active: [['past_due', 'Mark past due'], ['cancelled', 'Cancel']],
  past_due: [['active', 'Confirm payment'], ['cancelled', 'Cancel']],
  cancelled: [],
};
const subscriptionStatus = message => { document.querySelector('#subscription-status').textContent = message; };
async function loadSubscriptions() {
  const { subscriptions } = await platformApi('/api/platform/subscriptions');
  const root = document.querySelector('#subscription-list');
  root.replaceChildren();
  for (const sub of subscriptions) {
    const row = document.createElement('p');
    const price = sub.price_minor == null ? 'price to confirm'
      : new Intl.NumberFormat(undefined, { style: 'currency', currency: sub.currency, maximumFractionDigits: sub.price_minor % 100 ? 2 : 0 }).format(sub.price_minor / 100);
    row.textContent = sub.restaurant_name + ' (' + sub.country_code + ') · ' + sub.plan_key + ' · ' + sub.billing_cycle + ' · ' + price + ' · '
      + sub.status.replace('_', ' ') + ' · AI number: ' + (sub.voice_number || 'none') + ' ';
    for (const [next, label] of subscriptionActions[sub.status] || []) {
      const button = document.createElement('button');
      button.textContent = label;
      button.addEventListener('click', async () => {
        if (next === 'active' && sub.plan_key !== 'starter' && !confirm('Confirm payment for ' + sub.restaurant_name + '? This also buys an AI phone number with Telnyx (real money).')) return;
        button.disabled = true;
        subscriptionStatus(next === 'active' ? 'Confirming payment and setting up the AI number…' : 'Saving…');
        try {
          const result = await platformApi('/api/platform/subscriptions/' + sub.restaurant_id + '/status', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: next }) });
          subscriptionStatus('Saved: ' + result.status.replace('_', ' ') + '.' + (result.voice ? ' AI number: ' + result.voice.detail : ''));
          await Promise.all([loadSubscriptions(), loadNumbers()]);
        } catch (error) { subscriptionStatus(error.message); button.disabled = false; }
      });
      row.append(button);
    }
    if (sub.status === 'active' && sub.plan_key !== 'starter' && !/· active$/.test(sub.voice_number || '')) {
      const retry = document.createElement('button');
      retry.textContent = 'Set up AI number';
      retry.addEventListener('click', async () => {
        if (!confirm('Set up the AI number for ' + sub.restaurant_name + '? If none exists yet this buys one with Telnyx (real money).')) return;
        retry.disabled = true;
        subscriptionStatus('Setting up the AI number…');
        try {
          const result = await platformApi('/api/platform/subscriptions/' + sub.restaurant_id + '/voice-number', { method: 'POST' });
          subscriptionStatus('AI number: ' + result.voice.detail);
          await Promise.all([loadSubscriptions(), loadNumbers()]);
        } catch (error) { subscriptionStatus(error.message); retry.disabled = false; }
      });
      row.append(retry);
    }
    root.append(row);
  }
  if (!subscriptions.length) root.textContent = 'No restaurant has chosen a plan yet.';
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
    row.textContent = n.phone_number + ' · ' + n.restaurant_name + ' · ' + (n.plan_order_id ? 'order #' + n.plan_order_id : 'subscription') + ' · ' + n.status.replace('_', ' ') + (n.last_error ? ' · ' + n.last_error : '') + ' ';
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

// Integration health and custom domains.
const healthNames={whatsapp:'WhatsApp Business',ai:'OpenAI (AI replies, website text, menu import)',voice:'AI Call Assistant (Vapi)',numbers:'Dedicated numbers (Telnyx)',domains:'Custom domains (Hostinger API)',billing:'Plan payments (Stripe)',email:'Email (password reset)',payments:'Online payments (Stripe)',orders:'Orders'};
const healthLabels={live:['Live','tag-ok'],configured:['Configured · needs live test','tag-info'],missing:['Settings missing','tag-bad'],deferred:['Off by design','tag-warn']};
async function loadHealth(){
 const data=await platformApi('/api/platform/integrations/health');
 const list=document.querySelector('#health-list');
 list.replaceChildren(...Object.entries(data.channels).map(([key,channel])=>{
  const card=document.createElement('article');card.className='health-card';card.dataset.status=channel.status;
  const head=document.createElement('div');head.className='health-head';
  const name=document.createElement('strong');name.textContent=healthNames[key]||key;
  const tag=document.createElement('span');const [label,cls]=healthLabels[channel.status]||[channel.status,''];tag.className='tag '+cls;tag.textContent=label;
  head.append(name,tag);card.append(head);
  if(channel.note){const note=document.createElement('p');note.textContent=channel.note;card.append(note);}
  if(channel.missing?.length){const missing=document.createElement('p');missing.className='health-missing';missing.textContent='Missing: '+channel.missing.join(', ');card.append(missing);}
  return card;
 }));
 document.querySelector('#health-status').textContent='Checked '+new Date(data.checked_at).toLocaleTimeString();
}
document.querySelector('#health-refresh').addEventListener('click',()=>loadHealth().catch(error=>{document.querySelector('#health-status').textContent=error.message;}));
document.querySelector('#test-openai').addEventListener('click',async event=>{
 const button=event.currentTarget;button.disabled=true;document.querySelector('#health-status').textContent='Testing OpenAI…';
 try{const result=await platformApi('/api/platform/integrations/test-openai',{method:'POST'});document.querySelector('#health-status').textContent=result.message;}
 catch(error){document.querySelector('#health-status').textContent=error.message;}finally{button.disabled=false;}
});
async function loadDomains(){
 const {domains,automatic}=await platformApi('/api/platform/domains');
 const root=document.querySelector('#domain-list');
 if(!domains.length)root.textContent='No restaurant has added a custom domain yet.';
 else root.replaceChildren(...domains.map(item=>{
  const row=document.createElement('p');
  row.textContent=item.domain+' · '+item.name+' (#'+item.restaurant_id+') · '+(item.stage?'automatic: '+item.stage:item.status)+(item.ssl_status?' · SSL '+item.ssl_status:'')+(item.setup_error||item.last_error?' · '+(item.setup_error||item.last_error):'');
  if(automatic&&item.stage&&item.stage!=='live'){const check=document.createElement('button');check.type='button';check.textContent='Check now';check.addEventListener('click',async()=>{check.disabled=true;try{await platformApi('/api/platform/domains/'+item.restaurant_id+'/check',{method:'POST'});await loadDomains();}catch(error){row.append(' · '+error.message);check.disabled=false;}});row.append(check);}
  if(!item.stage&&(item.status==='verified'||item.status==='connected')){
   const button=document.createElement('button');button.type='button';button.textContent=item.status==='connected'?'Mark not connected':'Mark connected';
   button.addEventListener('click',async()=>{button.disabled=true;try{await platformApi('/api/platform/domains/'+item.restaurant_id+'/status',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:item.status==='connected'?'verified':'connected'})});await loadDomains();}catch(error){row.append(' · '+error.message);button.disabled=false;}});
   row.append(button);
  }
  return row;
 }));
 const {requests,enabled}=await platformApi('/api/platform/domain-requests');
 const list=document.querySelector('#domain-request-list');
 if(!requests.length){list.textContent=enabled?'No domain requests.':'Buying domains needs HOSTINGER_API_TOKEN on the server.';return;}
 list.replaceChildren(...requests.map(request=>{
  const row=document.createElement('p');
  const price=request.price_cents==null?'':' · '+new Intl.NumberFormat(undefined,{style:'currency',currency:request.currency||'USD'}).format(request.price_cents/100)+' first year';
  row.textContent=request.domain+' · '+request.name+' (#'+request.restaurant_id+')'+price+' · '+request.status+(request.error?' · '+request.error:'');
  if(['requested','failed'].includes(request.status)){
   const buy=document.createElement('button');buy.type='button';buy.textContent='Buy now';
   buy.addEventListener('click',async()=>{if(!confirm('Buy '+request.domain+price+' from your Hostinger account? This spends real money.'))return;buy.disabled=true;try{await platformApi('/api/platform/domain-requests/'+request.id+'/purchase',{method:'POST'});await loadDomains();}catch(error){row.append(' · '+error.message);buy.disabled=false;}});
   const reject=document.createElement('button');reject.type='button';reject.textContent='Reject';
   reject.addEventListener('click',async()=>{reject.disabled=true;try{await platformApi('/api/platform/domain-requests/'+request.id+'/reject',{method:'PUT'});await loadDomains();}catch(error){row.append(' · '+error.message);reject.disabled=false;}});
   row.append(buy,reject);
  }
  return row;
 }));
}

async function loadWhatsAppNumbers() {
  const data = await platformApi('/api/platform/whatsapp-numbers');
  const root = document.querySelector('#wa-number-list');
  root.replaceChildren();
  for (const n of data.numbers) {
    const row = document.createElement('div'); row.className = 'row';
    const main = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = (n.display_phone_number || 'Number not readable') + (n.verified_name ? ' · ' + n.verified_name : '');
    const meta = document.createElement('p'); meta.className = 'small muted';
    meta.textContent = 'Restaurant #' + n.restaurant_id + ' ' + n.restaurant_name + ' · Phone number ID ' + n.phone_number_id + (n.quality_rating ? ' · Quality ' + n.quality_rating : '') + (n.lookup_error ? ' · ' + n.lookup_error : '');
    main.append(title, meta);
    const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = n.active ? 'Active' : 'Off';
    row.append(main, tag); root.append(row);
  }
  if (!data.numbers.length) root.textContent = 'No WhatsApp number is connected to any restaurant yet, so incoming WhatsApp messages are ignored.';
}
document.querySelector('#wa-number-form')?.addEventListener('submit', async event => {
  event.preventDefault();
  if (!platformToken) return;
  const button = event.currentTarget.querySelector('button'), output = document.querySelector('#wa-number-status');
  const id = document.querySelector('#wa-phone-id').value.trim(), restaurant_id = Number(document.querySelector('#wa-restaurant-id').value);
  button.disabled = true; output.textContent = 'Saving…';
  try {
    await platformApi('/api/platform/whatsapp-numbers/' + encodeURIComponent(id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ restaurant_id, active: true }) });
    event.currentTarget?.reset?.(); output.textContent = 'Saved.';
    await loadWhatsAppNumbers();
  } catch (error) { output.textContent = error.message; } finally { button.disabled = false; }
});
