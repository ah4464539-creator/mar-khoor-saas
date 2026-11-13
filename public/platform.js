let platformToken='';const status=document.querySelector('#status');
async function loadAssistants(){const r=await fetch('/api/platform/voice-assistants',{headers:{Authorization:'Bearer '+platformToken}});const data=await r.json();if(!r.ok)throw Error(data.error||'Assistant list unavailable');const root=document.querySelector('#assistant-list');root.replaceChildren();for(const a of data.assistants){const p=document.createElement('p');p.textContent=a.assistant_id+' · '+a.restaurant_name+' · '+(a.active?'Active':'Disabled');root.append(p)}if(!data.assistants.length)root.textContent='No assistants mapped yet.'}
document.querySelector('#assistant-form').addEventListener('submit',async e=>{e.preventDefault();if(!platformToken)return status.textContent='Sign in first.';try{const id=document.querySelector('#assistant-id').value.trim();const restaurant_id=Number(document.querySelector('#assistant-restaurant-id').value);const r=await fetch('/api/platform/voice-assistants/'+encodeURIComponent(id),{method:'PUT',headers:{Authorization:'Bearer '+platformToken,'Content-Type':'application/json'},body:JSON.stringify({restaurant_id,active:true})});const data=await r.json();if(!r.ok)throw Error(data.error||'Mapping failed');await loadAssistants();status.textContent='Assistant mapped.'}catch(err){status.textContent=err.message}});const form=document.querySelector('#login');form.addEventListener('submit',async e=>{e.preventDefault();status.textContent='Signing in…';try{const login=await fetch('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.querySelector('#email').value,password:document.querySelector('#password').value})});const data=await login.json();if(!login.ok)throw Error(data.error||'Login failed');const res=await fetch('/api/platform/summary',{headers:{Authorization:'Bearer '+data.token}});const summary=await res.json();if(!res.ok)throw Error(summary.error||'Access denied');platformToken=data.token;void loadWorkerMetrics(data.token);for(const key of ['restaurants','users','orders'])document.getElementById(key).textContent=summary[key];const tenantsResponse=await fetch('/api/platform/restaurants',{headers:{Authorization:'Bearer '+data.token}});const tenants=await tenantsResponse.json();if(!tenantsResponse.ok)throw Error(tenants.error||'Could not load tenants');const root=document.querySelector('#tenant-list');root.replaceChildren();for(const tenant of tenants.restaurants){const row=document.createElement('p');row.textContent='#'+tenant.id+' · '+tenant.name+' · '+tenant.slug+' · '+tenant.country_code+' · '+tenant.members+' members';root.append(row)}if(!tenants.restaurants.length)root.textContent='No restaurants yet.';await loadAssistants();status.textContent='Live platform metrics loaded.'}catch(err){status.textContent=err.message}});
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

async function savePlatformSettings(path, method, data) {
  if (!platformToken) throw Error('Sign in first.');
  const response = await fetch(path, {
    method,
    headers: {Authorization: 'Bearer ' + platformToken, 'Content-Type': 'application/json'},
    body: JSON.stringify(data)
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || 'Unable to save settings.');
  return result;
}

document.querySelector('#create-restaurant').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  const output = document.querySelector('#onboarding-status');
  const link = document.querySelector('#onboarding-link');
  button.disabled = true;
  link.hidden = true;
  try {
    const data = Object.fromEntries(new FormData(form));
    data.country_code = data.country_code.toUpperCase();
    data.currency = data.currency.toUpperCase();
    const restaurant = await savePlatformSettings('/api/platform/restaurants', 'POST', data);
    output.textContent = 'Restaurant created. ID: ' + restaurant.id;
    link.href = '/menu.html?restaurant=' + encodeURIComponent(restaurant.slug);
    link.hidden = false;
    document.querySelector('#restaurant-phone-form [name=restaurant_id]').value = restaurant.id;
    form.reset();
  } catch (error) {
    output.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.querySelector('#restaurant-phone-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  const output = document.querySelector('#phone-settings-status');
  button.disabled = true;
  try {
    const data = new FormData(form);
    const result = await savePlatformSettings('/api/platform/restaurants/' + encodeURIComponent(data.get('restaurant_id')) + '/public-phone', 'PUT', {phone: data.get('phone').trim()});
    output.textContent = result.phone ? 'Storefront phone saved.' : 'Storefront phone removed.';
  } catch (error) {
    output.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
