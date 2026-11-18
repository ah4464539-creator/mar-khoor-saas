const form=document.querySelector('#login'),status=document.querySelector('#status'),target=document.querySelector('#restaurants');
let token='',restaurantId=null,restaurantCurrency='';
let refreshing=false;
setInterval(async()=>{if(!restaurantId||!token||document.hidden||refreshing)return;refreshing=true;try{await refresh()}catch(e){status.textContent='Auto-refresh: '+e.message}finally{refreshing=false}},15000);
const api=async(path,options={})=>{const r=await fetch(path,{...options,headers:{...options.headers,Authorization:'Bearer '+token}});const data=await r.json();if(!r.ok)throw Error(data.error||'Request failed');return data};
async function refresh(){
 loadSite().catch(error=>{siteStatus.textContent=error.message});
 loadPlanOrders().catch(error=>{planOrders.textContent=error.message});
 const [menu,orders,analytics,inbox,outbound,aiSettings]=await Promise.all([api('/api/restaurants/'+restaurantId+'/menu'),api('/api/restaurants/'+restaurantId+'/orders'),api('/api/restaurants/'+restaurantId+'/analytics'),api('/api/restaurants/'+restaurantId+'/whatsapp/messages'),api('/api/restaurants/'+restaurantId+'/whatsapp/outbound'),api('/api/restaurants/'+restaurantId+'/whatsapp/ai-settings')]);
 document.querySelector('#whatsapp-ai-enabled').checked=aiSettings.enabled;
 const sentEl=document.querySelector('#whatsapp-outbound');sentEl.replaceChildren();if(!outbound.messages.length)sentEl.textContent='No outgoing messages yet.';
 for(const message of outbound.messages){const p=document.createElement('p');p.textContent=message.recipient+' · '+message.status+' · '+message.text_body;sentEl.append(p)}
 const inboxEl=document.querySelector('#whatsapp-inbox');inboxEl.replaceChildren();if(!inbox.messages.length)inboxEl.textContent='No messages yet.';
 for(const message of inbox.messages){
  const p=document.createElement('p');p.textContent=message.sender+' · '+message.message_type+' · '+(message.text_body||'[Non-text message]');
  if(message.message_type==='text'){
   const form=document.createElement('form'),input=document.createElement('input'),button=document.createElement('button');
   input.placeholder='Write reply';input.maxLength=4096;input.required=true;button.textContent='Send reply';
   form.append(input,button);
   form.addEventListener('submit',async e=>{e.preventDefault();button.disabled=true;try{
    await api('/api/restaurants/'+restaurantId+'/whatsapp/replies',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message_id:message.message_id,text:input.value})});
    input.value='';status.textContent='WhatsApp reply sent';
   }catch(err){status.textContent=err.message}finally{button.disabled=false}});
   p.append(form);
  }
  inboxEl.append(p);
 }
 const summary = analytics.summary;
 const revenue = (Number(summary.completed_revenue_minor) / 100).toFixed(2) + ' ' + restaurantCurrency;
 const metrics = [
  ['M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6m-6 4h6m-6 4h4', 'Total orders', summary.total_orders],
  ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zm0-15v5l3 2', 'Pending orders', summary.pending_orders],
  ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM8 12l3 3 5-6', 'Completed orders', summary.completed_orders],
  ['M4 4v16h16M8 16l4-5 3 2 5-7m-4 0h4v4', 'Completed revenue', revenue],
 ];
 const analyticsPanel = document.querySelector('#analytics');
 analyticsPanel.replaceChildren(...metrics.map(([symbol, label, value]) => {
  const card = document.createElement('article');
  const icon = document.createElement('span');
  icon.className = 'metric-icon';
  icon.setAttribute('aria-hidden', 'true');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ width: '24', height: '24', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) {
   svg.setAttribute(key, value);
  }
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', symbol);
  svg.append(path);
  icon.append(svg);
  const body = document.createElement('div');
  const title = document.createElement('span');
  title.textContent = label;
  const number = document.createElement('strong');
  number.textContent = value;
  body.append(title, number);
  card.append(icon, body);
  return card;
 }));
 const items=document.querySelector('#items');items.replaceChildren();
 for(const item of menu.items){const p=document.createElement('p'),button=document.createElement('button');p.textContent=item.name+' — '+(item.price_minor/100).toFixed(2)+' · '+(item.active?'Active':'Hidden')+' ';button.textContent=item.active?'Hide':'Show';button.addEventListener('click',async()=>{try{await api('/api/restaurants/'+restaurantId+'/menu/'+item.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({...item,active:!item.active})});await refresh()}catch(e){status.textContent=e.message}});const edit=document.createElement('button');edit.type='button';edit.textContent='Edit';edit.addEventListener('click',()=>editMenuItem(item));p.append(button,edit);items.append(p)}
 renderOwnerInsights(analytics);
 ownerOrders = orders.orders;
 renderOwnerOrders();
}

const orderSearch = document.querySelector('#owner-order-search');
const orderFilter = document.querySelector('#owner-order-status');
const orderTransitions = {pending:['accepted','cancelled'],accepted:['preparing','cancelled'],preparing:['ready'],ready:['completed']};
let ownerOrders = [];
orderSearch.addEventListener('input', renderOwnerOrders);
orderFilter.addEventListener('change', renderOwnerOrders);

function ownerMoney(minor) {
 return new Intl.NumberFormat(undefined, {style:'currency',currency:restaurantCurrency}).format(Number(minor)/100);
}

function ownerText(tag, value, className = '') {
 const node = document.createElement(tag);
 node.textContent = value;
 if (className) node.className = className;
 return node;
}

function renderOwnerInsights(analytics) {
 const sales = document.querySelector('#owner-sales');
 const days = [...analytics.last_30_days].reverse();
 const max = Math.max(1, ...days.map(day => Number(day.completed_revenue_minor)));
 const salesChart = ownerText('div', '', 'owner-sales-chart');
 for (const day of days) {
  const date = String(day.day).slice(0, 10);
  const plot = ownerText('div', '', 'owner-sales-day');
  const label = date + ' · ' + ownerMoney(day.completed_revenue_minor);
  const bar = document.createElement('meter');
  bar.max = max;
  bar.value = Number(day.completed_revenue_minor);
  bar.setAttribute('aria-label', label);
  bar.title = label;
  plot.append(bar);
  salesChart.append(plot);
 }
 const first = String(days[0]?.day ?? '').slice(0,10);
 const last = String(days.at(-1)?.day ?? '').slice(0,10);
 const caption = first === last ? first : first + ' – ' + last;
 sales.replaceChildren(...(days.length ? [salesChart, ownerText('small', caption)] : [ownerText('p','No sales activity in this period.')]));

 const statuses = analytics.by_status ?? [];
 const total = statuses.reduce((sum, row) => sum + Number(row.count), 0);
 const legend = ownerText('ul', '', 'owner-status-legend');
 const colors = {pending:'#db741e',accepted:'#634ceb',preparing:'#336ac6',ready:'#168d8b',completed:'#258050',cancelled:'#ab4454'};
 let position = 0;
 const segments = statuses.map(row => {
  const color = colors[row.status] ?? '#7d7490';
  const end = position + Number(row.count) / total * 100;
  const segment = color + ' ' + position + '% ' + end + '%';
  position = end;
  const item = ownerText('li', '');
  const swatch = ownerText('span', '', 'owner-status-dot');
  swatch.style.backgroundColor = color;
  item.append(swatch, ownerText('span', row.status), ownerText('strong', row.count));
  legend.append(item);
  return segment;
 });
 const ring = ownerText('div', '', 'owner-status-ring');
 ring.setAttribute('aria-hidden','true');
 if (segments.length) ring.style.backgroundImage = 'conic-gradient(' + segments.join(',') + ')';
 ring.append(ownerText('strong', total));
 document.querySelector('#owner-status-summary').replaceChildren(ring, ...(total ? [legend] : [ownerText('p','No orders yet.')]));
 const top = analytics.top_items ?? [];
 const items = ownerText('ul', '', 'owner-top-list');
 for (const item of top) {
  const row = ownerText('li', '');
  row.append(ownerText('span', item.name), ownerText('strong', item.quantity + ' sold'));
  items.append(row);
 }
 document.querySelector('#owner-top-items').replaceChildren(top.length ? items : ownerText('p','Completed orders will appear here.'));
}

function renderOwnerOrders() {
 const root = document.querySelector('#orders');
 const query = orderSearch.value.trim().toLowerCase().replace(/^#/, '');
 const visible = ownerOrders.filter(order =>
  (!orderFilter.value || order.status === orderFilter.value) &&
  (String(order.id).includes(query) || (order.customer_name ?? '').toLowerCase().includes(query) || (order.customer_phone ?? '').includes(query))
 );
 if (!visible.length) {
  root.replaceChildren(ownerText('p', ownerOrders.length ? 'No orders match these filters.' : 'No orders yet.'));
  return;
 }
 const table = document.createElement('table');
 table.setAttribute('aria-label','Recent restaurant orders');
 const header = table.createTHead().insertRow();
 for (const heading of ['Order ID','Customer','Date','Amount','Fulfilment','Payment','Status','Actions']) {
  const cell = ownerText('th', heading);
  cell.scope = 'col';
  header.append(cell);
 }
 const body = table.createTBody();
 for (const order of visible) {
  const row = body.insertRow();
  const date = new Date(order.created_at);
  const formatted = Number.isNaN(date.valueOf()) ? '—' : date.toLocaleDateString();
  for (const value of ['#' + order.id, order.customer_name || 'Customer', formatted, ownerMoney(order.total_minor)]) {
   row.append(ownerText('td', value));
  }
  // Fulfilment and cash payment details (absent for legacy website orders).
  const fulfilment = row.insertCell();
  if (order.order_type === 'delivery' || order.order_type === 'pickup') {
   fulfilment.append(ownerText('strong', order.order_type === 'delivery' ? 'Delivery' : 'Pickup'));
   for (const detail of [order.customer_phone, order.delivery_address, order.delivery_instructions && 'Note: ' + order.delivery_instructions]) {
    if (detail) fulfilment.append(document.createElement('br'), ownerText('span', detail));
   }
  } else fulfilment.textContent = '—';
  const payment = row.insertCell();
  const methods = {cod:'Cash on Delivery',cash_pickup:'Cash on Pickup',stripe:'Online'};
  payment.textContent = methods[order.payment_method] ? methods[order.payment_method] + ' · ' + ({unpaid:'Unpaid',pending:'Pending',paid:'Paid',failed:'Failed',refunded:'Refunded'}[order.payment_status] || 'Unpaid') : '—';
  row.insertCell().append(ownerText('span', order.status, 'owner-order-badge'));
  const actions = row.insertCell();
  for (const next of orderTransitions[order.status] ?? []) {
   const button = ownerText('button', {accepted:'Accept',preparing:'Prepare',ready:'Mark ready',completed:'Complete',cancelled:'Cancel'}[next]);
   button.type = 'button';
   button.addEventListener('click', async () => {
    const buttons = [...actions.querySelectorAll('button')];
    buttons.forEach(control => control.disabled = true);
    try {
     await api('/api/restaurants/' + restaurantId + '/orders/' + order.id + '/status', {
      method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({status:next})
     });
     await refresh();
     status.textContent = 'Order #' + order.id + ' updated';
    } catch (error) {
     status.textContent = error.message;
    } finally {
     buttons.forEach(control => control.disabled = false);
    }
   });
   actions.append(button);
  }
  if (['pending','accepted','preparing'].includes(order.status)) {
   const eta = document.createElement('div');
   eta.className = 'owner-order-estimate';
   const input = document.createElement('input');
   input.type = 'number'; input.min='1'; input.max='240'; input.step='1';
   input.style.width = '75px'; input.setAttribute('aria-label','Minutes to order ready');
   input.placeholder='Minutes';
   const remaining = order.estimated_ready_epoch == null ? null : Math.max(1,Math.ceil((Number(order.estimated_ready_epoch)*1000-Date.now())/60000));
   if (remaining !== null) input.value = remaining;
   const save = ownerText('button','Save ETA');
   save.type = 'button';
   const clear = ownerText('button','Clear ETA'); clear.type = 'button';
   const updateEstimate = async minutes => {
    save.disabled = true; clear.disabled = true;
    try {
     await api('/api/restaurants/'+restaurantId+'/orders/'+order.id+'/estimate',{
      method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({minutes})
     });
     await refresh();
     status.textContent = 'Order #'+order.id+' estimated time updated';
    }catch(error){status.textContent=error.message;save.disabled=false;clear.disabled=false;}
   };
   save.addEventListener('click',()=>{if(!input.reportValidity()||!input.value)return;updateEstimate(Number(input.value));});
   clear.addEventListener('click',()=>updateEstimate(null));
   eta.append(input,save,clear);
   actions.append(eta);
  }
 }
 root.replaceChildren(table);
}

const sessionKey = 'mar-khoor.owner-session';
const logoutButton = document.querySelector('#owner-logout');

async function loadAccount() {
 const result = await api('/api/my/restaurants');
 target.replaceChildren();
 target.closest(".mk-restaurant-list").hidden = result.restaurants.length < 2;
 document.body.classList.remove('signing-in');
 document.querySelector('.mk-login-grid').hidden = true;
 logoutButton.hidden = false;
 for (const restaurant of result.restaurants) {
  const button = document.createElement('button');
  button.textContent = restaurant.name + ' · ' + restaurant.role;
  button.addEventListener('click', () => openRestaurant(restaurant));
  target.append(button);
 }
 status.textContent = result.restaurants.length ? '' : 'No restaurants assigned.';
 if (result.restaurants.length === 1) await openRestaurant(result.restaurants[0]);
}

const ownerNavigation = document.querySelector('#owner-navigation');
const ownerOverview = document.querySelector('#owner-overview');
const messageViews = [...document.querySelectorAll('.owner-message-view')];
const overviewLink = document.querySelector('aside .selected');

function updateWorkspaceView(focusHeading = false) {
 if (!restaurantId) return;
 const activeView = messageViews.find(view => '#' + view.id === location.hash);
 ownerOverview.hidden = Boolean(activeView);
 messageViews.forEach(view => { view.hidden = view !== activeView; });
 for (const link of [overviewLink, ...ownerNavigation.querySelectorAll('a')]) {
  const current = link === overviewLink ? !location.hash || location.hash === overviewLink.hash : link.hash === location.hash;
  if (current) link.setAttribute('aria-current', link === overviewLink ? 'page' : 'location');
  else link.removeAttribute('aria-current');
 }
 if (focusHeading && activeView) {
  activeView.querySelector('h2').focus({ preventScroll: true });
  document.querySelector('#owner-workspace').scrollIntoView({ block: 'start' });
 }
}

window.addEventListener('hashchange', () => updateWorkspaceView(true));

async function openRestaurant(restaurant) {
 restaurantId = restaurant.id;
 restaurantCurrency = restaurant.currency;
 document.querySelector('#owner-heading').textContent = restaurant.name;
 document.querySelector('#management').hidden = false;
 ownerNavigation.hidden = restaurant.role !== 'admin';
 updateWorkspaceView();
 loadSetup(restaurant);
 try { await refresh(); } catch (error) { status.textContent = error.message; }
}

form.addEventListener('submit', async event => {
 event.preventDefault();
 const submit = form.querySelector('button[type=submit]');
 submit.disabled = true;
 status.textContent = 'Signing in…';
 try {
  const response = await fetch('/auth/login', {
   method: 'POST', headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({ email: document.querySelector('#email').value, password: document.querySelector('#password').value }),
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || 'Login failed');
  token = data.token;
  await loadAccount();
  if (document.querySelector('#remember-login').checked) {
   try { localStorage.setItem(sessionKey, token); } catch {}
  }
  form.reset();
 } catch (error) { status.textContent = error.message; }
 finally { submit.disabled = false; }
});

logoutButton.addEventListener('click', async () => {
 logoutButton.disabled = true;
 try {
  await api('/auth/logout', { method: 'POST' });
  try { localStorage.removeItem(sessionKey); } catch {}
  location.reload();
 } catch (error) { status.textContent = error.message; logoutButton.disabled = false; }
});

const menuItemForm = document.querySelector('#add-item');
const itemName = document.querySelector('#item-name');
const itemPrice = document.querySelector('#item-price');
const itemCategory = document.querySelector('#item-category');
const itemPhoto = document.querySelector('#item-photo');
const saveMenuItem = document.querySelector('#save-menu-item');
const cancelMenuEdit = document.querySelector('#cancel-menu-edit');
let editingMenuItem = null;
function editMenuItem(item) {
 editingMenuItem = item ? {item, restaurantId} : null;
 itemName.value = item?.name ?? '';
 itemPrice.value = item ? Number(item.price_minor) / 100 : '';
 itemCategory.value = item?.category ?? '';
 itemPhoto.value = item?.image_url ?? '';
 saveMenuItem.textContent = item ? 'Save item' : 'Add item';
 cancelMenuEdit.hidden = !item;
 if (item) itemName.focus();
}
cancelMenuEdit.addEventListener('click', () => editMenuItem(null));
menuItemForm.addEventListener('submit', async event => {
 event.preventDefault();
 if (!restaurantId) return;
 if (editingMenuItem && editingMenuItem.restaurantId !== restaurantId) {
  editMenuItem(null);
  return;
 }
 const item = editingMenuItem?.item;
 const amount = Number(itemPrice.value);
 const price_minor = Math.round(amount * 100);
 if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(price_minor)) {
  status.textContent = 'Invalid price';
  return;
 }
 saveMenuItem.disabled = true;
 try {
  await api('/api/restaurants/' + restaurantId + '/menu' + (item ? '/' + item.id : ''), {
   method: item ? 'PATCH' : 'POST',
   headers: {'Content-Type':'application/json'},
   body: JSON.stringify({name:itemName.value, description:item?.description ?? '', price_minor,
    category:itemCategory.value, image_url:itemPhoto.value, active:Boolean(item?.active)}),
  });
  editMenuItem(null);
  await refresh();
  status.textContent = item ? 'Menu item updated.' : 'Menu item added.';
 } catch (error) {
  status.textContent = error.message;
 } finally {
  saveMenuItem.disabled = false;
 }
});

document.querySelector('#whatsapp-ai-enabled').addEventListener('change',async e=>{if(!restaurantId)return;const enabled=e.target.checked;e.target.disabled=true;try{await api('/api/restaurants/'+restaurantId+'/whatsapp/ai-settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled})});status.textContent='WhatsApp AI '+(enabled?'enabled':'disabled')}catch(err){e.target.checked=!enabled;status.textContent=err.message}finally{e.target.disabled=false}});

// My plan: services, optional dedicated number, and the restaurant's own orders.
const usd=cents=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
const planForm=document.querySelector('#plan-form'),planStatus=document.querySelector('#plan-status'),planOrders=document.querySelector('#plan-orders'),planNumber=document.querySelector('#plan-number');
planForm.addEventListener('change',()=>{planNumber.hidden=!planForm.querySelector('input[value="voice"]').checked});
async function loadPlanOrders(){
 if(!restaurantId)return;
 const data=await api('/api/restaurants/'+restaurantId+'/plan-orders');
 planOrders.replaceChildren();
 try{const owned=await api('/api/restaurants/'+restaurantId+'/numbers');for(const n of owned.numbers){const p=document.createElement('p');p.textContent='Your dedicated phone number: '+n.phone_number;planOrders.append(p)}}catch{}
 if(!data.orders.length){planOrders.textContent='No plan orders yet.';return}
 for(const order of data.orders){
  const p=document.createElement('p');
  p.textContent='#'+order.id+' · '+order.features.join(', ')+(order.number_mode==='new'?' + dedicated number':'')+' · '+usd(order.monthly_minor)+' / month · first payment '+usd(order.first_payment_minor)+' · '+order.status.replace('_',' ')+' ';
  if(order.status==='pending_payment'){
   const cancel=document.createElement('button');cancel.textContent='Cancel';
   cancel.addEventListener('click',async()=>{try{await api('/api/restaurants/'+restaurantId+'/plan-orders/'+order.id+'/cancel',{method:'POST'});await loadPlanOrders()}catch(error){planStatus.textContent=error.message}});
   p.append(cancel);
  }
  planOrders.append(p);
 }
}
planForm.addEventListener('submit',async e=>{
 e.preventDefault();
 if(!restaurantId){planStatus.textContent='Select your restaurant first.';return}
 const features=[...planForm.querySelectorAll('input[name="service"]:checked')].map(input=>input.value);
 if(!features.length){planStatus.textContent='Select at least one service.';return}
 const numberMode=features.includes('voice')&&document.querySelector('#plan-new-number').checked?'new':'existing';
 const button=planForm.querySelector('button');button.disabled=true;
 try{
  const result=await api('/api/restaurants/'+restaurantId+'/plan-orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({features,numberMode})});
  planStatus.textContent='Order #'+result.order_id+' created: '+usd(result.monthly_minor)+' per month, first payment '+usd(result.first_payment_minor)+'. It becomes active after the platform owner confirms your payment.';
  await loadPlanOrders();
 }catch(error){planStatus.textContent=error.message}finally{button.disabled=false}
});

// My website: AI-written copy, owner edits, publish toggle.
const siteForm=document.querySelector('#site-form'),siteStatus=document.querySelector('#site-status'),siteLink=document.querySelector('#site-link'),sitePublish=document.querySelector('#site-publish');
const siteField=name=>document.querySelector('#site-'+name);
let sitePublished=false,siteSlug='',siteSections=['about','menu','hours','contact'];
function showSite(data){
 siteField('headline').value=data.config.headline;siteField('tagline').value=data.config.tagline;siteField('about').value=data.config.about;
 siteField('hours').value=data.config.hours;siteField('phone').value=data.config.phone;siteField('address').value=data.config.address;siteField('theme').value=data.config.theme;
 siteField('description').value=data.description||siteField('description').value;siteSections=data.config.sections;
 siteField('assistant-recording').checked=data.config.assistantRecording===true;
 if(data.slug)siteSlug=data.slug;
 if(typeof data.published==='boolean')sitePublished=data.published;
 sitePublish.textContent=sitePublished?'Unpublish':'Publish';
 siteLink.replaceChildren();
 if(sitePublished&&siteSlug){const a=document.createElement('a');a.href='/r/'+siteSlug;a.textContent='mar-khoor.com/r/'+siteSlug;a.target='_blank';a.rel='noopener';siteLink.append('Live at ',a)}
}
async function loadSite(){if(!restaurantId)return;showSite(await api('/api/restaurants/'+restaurantId+'/site'))}
const siteConfig=()=>({headline:siteField('headline').value,tagline:siteField('tagline').value,about:siteField('about').value,hours:siteField('hours').value,phone:siteField('phone').value,address:siteField('address').value,theme:siteField('theme').value,assistantRecording:siteField('assistant-recording').checked,sections:siteSections});
const siteJson={'Content-Type':'application/json'};
document.querySelector('#site-generate').addEventListener('click',async e=>{
 if(!restaurantId){siteStatus.textContent='Select your restaurant first.';return}
 const button = e.currentTarget;
 button.disabled=true;siteStatus.textContent='Writing…';
 try{const data=await api('/api/restaurants/'+restaurantId+'/site/generate',{method:'POST',headers:siteJson,body:JSON.stringify({description:siteField('description').value})});showSite(data);siteStatus.textContent=data.source==='ai'?'Draft written by AI and saved. Edit anything you like.':'AI is not available, so a basic draft was saved. Edit it below.'}
 catch(error){siteStatus.textContent=error.message}finally{button.disabled=false}
});
siteForm.addEventListener('submit',async e=>{
 e.preventDefault();if(!restaurantId){siteStatus.textContent='Select your restaurant first.';return}
 try{showSite(await api('/api/restaurants/'+restaurantId+'/site',{method:'PUT',headers:siteJson,body:JSON.stringify({config:siteConfig(),description:siteField('description').value})}));siteStatus.textContent='Saved.'}
 catch(error){siteStatus.textContent=error.message}
});
sitePublish.addEventListener('click',async()=>{
 if(!restaurantId){siteStatus.textContent='Select your restaurant first.';return}
 try{await api('/api/restaurants/'+restaurantId+'/site',{method:'PUT',headers:siteJson,body:JSON.stringify({config:siteConfig(),description:siteField('description').value})});
  const next=!sitePublished;await api('/api/restaurants/'+restaurantId+'/site/publish',{method:'POST',headers:siteJson,body:JSON.stringify({published:next})});
  await loadSite();siteStatus.textContent=next?'Your website is live.':'Your website is unpublished.'}
 catch(error){siteStatus.textContent=error.message}
});

const setupPanel = document.querySelector('#restaurant-setup');
const setupDialog = document.querySelector('#setup-dialog');
const setupForm = document.querySelector('#setup-form');
const setupSummary = document.querySelector('#setup-summary');
const setupStatus = document.querySelector('#setup-status');
const openSetup = document.querySelector('#open-setup');
const nextSetup = document.querySelector('#next-setup');
const backSetup = document.querySelector('#back-setup');
const deferSetup = document.querySelector('#defer-setup');
const setupProgress = document.querySelector('#setup-progress');
const setupResults = document.querySelector('#setup-results');
const usageMeter = document.querySelector('#usage-meter');
const planOptions = document.querySelector('#plan-options');
const setupSteps = [...setupForm.querySelectorAll('.setup-step')];
const setupTitles = ['Choose your plan', 'Connect your channels', 'Setup status'];
const integrationLabels = {whatsapp:'Business WhatsApp', ai_caller:'AI Caller', website:'Website'};
const statusLabels = {connected:'Connected', pending:'Pending', failed:'Failed', skipped:'Skipped', not_started:'Not started'};
const metricLabels = {ai_chats:'AI chats', whatsapp_messages:'WhatsApp messages', ai_call_minutes:'AI call minutes'};
let setupSelection = 0;
let setupStep = 0;
let setupData = {plans:[], subscription:null, integrations:[]};

const setupUrl = path => '/api/restaurants/' + restaurantId + path;
const jsonBody = (method, body) => ({method, headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});

function money(amount, currency) {
 return new Intl.NumberFormat(undefined, {style:'currency', currency, maximumFractionDigits: amount % 100 ? 2 : 0}).format(amount / 100);
}

function planPrice(plan, cycle) {
 const amount = plan.price_minor?.[cycle];
 if (amount == null) return 'Price to be confirmed';
 let text = money(amount, plan.currency) + (cycle === 'yearly' ? ' / year' : ' / month');
 if (plan.currency !== plan.base_currency && plan.base_price_minor?.[cycle] != null) text += ' (≈ ' + money(plan.base_price_minor[cycle], plan.base_currency) + ')';
 return text;
}

function numberLine(plan) {
 const number = plan.dedicated_number;
 if (!number) return '';
 if (number.included) return 'Dedicated AI phone number included';
 if (number.addon_price_minor == null) return 'Dedicated AI phone number: optional add-on';
 return 'Dedicated AI phone number: +' + money(number.addon_price_minor, plan.currency) + ' / month add-on';
}

function renderPlans() {
 const cycle = setupForm.elements.billing_cycle.value;
 const chosen = setupForm.querySelector('input[name="plan"]:checked')?.value || setupData.subscription?.plan || 'starter';
 planOptions.replaceChildren(...setupData.plans.map(plan => {
  const label = document.createElement('label');
  const input = Object.assign(document.createElement('input'), {type:'radio', name:'plan', value:plan.key, checked:plan.key === chosen});
  const body = document.createElement('span');
  body.append(ownerText('strong', plan.name), ownerText('small', planPrice(plan, cycle)));
  for (const [metric, limit] of Object.entries(plan.limits)) body.append(ownerText('small', limit.toLocaleString() + ' ' + metricLabels[metric] + ' / month'));
  const number = numberLine(plan);
  if (number) body.append(ownerText('small', number));
  label.append(input, body);
  return label;
 }));
 const fxNote = document.querySelector('#plan-fx');
 const converted = setupData.plans.some(plan => plan.converted);
 fxNote.replaceChildren();
 if (converted && setupData.exchange?.attribution) {
  const link = Object.assign(document.createElement('a'), {href:setupData.exchange.attribution.url, target:'_blank', rel:'noopener noreferrer', textContent:setupData.exchange.attribution.name});
  fxNote.append('Prices converted from USD with daily rates by ', link, '. The price is locked when you choose a plan.');
 } else if (converted) {
  fxNote.append('Prices converted from USD. The price is locked when you choose a plan.');
 }
 fxNote.hidden = !fxNote.childNodes.length;
}

function statusList(root, integrations) {
 root.replaceChildren(...integrations.map(item => {
  const row = document.createElement('li');
  row.dataset.status = item.status;
  row.append(ownerText('strong', integrationLabels[item.kind]), ownerText('span', statusLabels[item.status] || item.status, 'setup-badge'));
  if (item.detail) row.append(ownerText('small', item.detail));
  return row;
 }));
 root.hidden = !integrations.length;
}

function renderUsage(data) {
 if (!data?.subscription) { usageMeter.hidden = true; return; }
 usageMeter.replaceChildren(...data.usage.map(entry => {
  const row = document.createElement('div');
  row.className = 'usage-row';
  row.dataset.warning = entry.warning;
  const meter = Object.assign(document.createElement('meter'), {min:0, max:100, low:75, high:90, optimum:0, value:Math.min(100, entry.percent)});
  meter.setAttribute('aria-label', metricLabels[entry.metric]);
  let text = metricLabels[entry.metric] + ': ' + entry.used.toLocaleString() + ' of ' + entry.limit.toLocaleString() + ' (' + entry.percent + '%)';
  if (entry.warning >= 100) text += '. Over the limit; extra usage will be billed. Upgrade for a better rate.';
  else if (entry.warning >= 75) text += '. Approaching your limit; consider upgrading.';
  row.append(ownerText('span', text), meter);
  return row;
 }));
 usageMeter.hidden = false;
}

function fillConnectStep() {
 for (const item of setupData.integrations) {
  const value = setupForm.elements[item.kind + '_value'];
  const mode = setupForm.elements[item.kind + '_mode'];
  if (value && item.value) value.value = item.value;
  if (mode && item.mode && mode.tagName === 'SELECT') mode.value = item.mode;
  setupForm.elements[item.kind + '_skip'].checked = item.status === 'skipped';
 }
 syncConnectStep();
}

function syncConnectStep() {
 const domain = setupForm.querySelector('.setup-domain');
 domain.hidden = setupForm.elements.website_mode.value === 'builder';
 for (const kind of Object.keys(integrationLabels)) {
  const skipped = setupForm.elements[kind + '_skip'].checked;
  for (const field of setupForm.querySelectorAll('[data-kind="' + kind + '"] input:not([type=checkbox]):not([type=hidden]), [data-kind="' + kind + '"] select')) field.disabled = skipped;
 }
}

function showSetupStep(index) {
 setupStep = index;
 setupSteps.forEach((step, i) => { step.hidden = i !== index; });
 document.querySelector('#setup-step-label').textContent = 'Step ' + (index + 1) + ' of 3';
 document.querySelector('#setup-title').textContent = setupTitles[index];
 backSetup.hidden = index !== 1;
 deferSetup.hidden = index === 2;
 nextSetup.textContent = index === 0 ? 'Continue' : index === 1 ? 'Finish setup' : 'Done';
 setupStatus.textContent = '';
}

function summarise() {
 const sub = setupData.subscription;
 const plan = sub && setupData.plans.find(entry => entry.key === sub.plan);
 const connected = setupData.integrations.filter(item => item.status === 'connected').length;
 setupSummary.textContent = sub
  ? (plan?.name || sub.plan) + ' plan (' + sub.billing_cycle + ', ' + (sub.status === 'active' ? 'active' : 'payment pending') + '). ' + connected + ' of 3 channels connected.'
  : 'Choose a plan and connect WhatsApp, AI Caller and your website.';
 statusList(setupProgress, setupData.integrations.filter(item => item.status !== 'not_started'));
}

async function loadSetup(restaurant) {
 const selection = ++setupSelection;
 setupPanel.hidden = restaurant.role !== 'admin';
 openSetup.disabled = true;
 if (setupDialog.open) setupDialog.close();
 if (setupPanel.hidden) return;
 setupSummary.textContent = 'Loading setup…';
 try {
  const [plans, integrations, usage] = await Promise.all([api(setupUrl('/subscription')), api(setupUrl('/integrations')), api(setupUrl('/usage'))]);
  if (selection !== setupSelection) return;
  setupData = {plans:plans.plans, subscription:plans.subscription, integrations:integrations.integrations, exchange:plans.exchange};
  if (setupData.subscription) setupForm.elements.billing_cycle.value = setupData.subscription.billing_cycle;
  renderPlans();
  fillConnectStep();
  renderUsage(usage);
  summarise();
  openSetup.disabled = false;
  openSetup.textContent = setupData.subscription ? 'Change plan or setup' : 'Start setup';
  if (!setupData.subscription && !location.hash) { showSetupStep(0); setupDialog.showModal(); }
 } catch (error) {
  if (selection === setupSelection) setupSummary.textContent = error.message;
 }
}

function connectPayload() {
 const body = {};
 for (const kind of Object.keys(integrationLabels)) {
  if (setupForm.elements[kind + '_skip'].checked) { body[kind] = {skip:true}; continue; }
  const value = setupForm.elements[kind + '_value']?.value.trim() || '';
  const mode = setupForm.elements[kind + '_mode'].value;
  if (kind === 'website' && mode === 'builder') { body[kind] = {mode}; continue; }
  if (!value) { body[kind] = {skip:true}; continue; }
  body[kind] = {mode, value};
 }
 return body;
}

async function advanceSetup() {
 const selection = setupSelection;
 const controls = [...setupForm.querySelectorAll('button,input,select')];
 controls.forEach(control => { control.disabled = true; });
 try {
  if (setupStep === 0) {
   const plan = setupForm.querySelector('input[name="plan"]:checked')?.value;
   if (!plan) { setupStatus.textContent = 'Choose a plan.'; return; }
   setupStatus.textContent = 'Saving plan…';
   const result = await api(setupUrl('/subscription'), jsonBody('PUT', {plan, billing_cycle:setupForm.elements.billing_cycle.value}));
   if (selection !== setupSelection) return;
   setupData.subscription = result.subscription;
   showSetupStep(1);
  } else if (setupStep === 1) {
   setupStatus.textContent = 'Saving and connecting…';
   await api(setupUrl('/integrations'), jsonBody('PUT', connectPayload()));
   const result = await api(setupUrl('/integrations/finish'), {method:'POST'});
   if (selection !== setupSelection) return;
   setupData.integrations = result.integrations;
   statusList(setupResults, result.integrations);
   showSetupStep(2);
  } else {
   setupDialog.close();
  }
  summarise();
 } catch (error) {
  if (selection === setupSelection) setupStatus.textContent = error.message;
 } finally {
  controls.forEach(control => { control.disabled = false; });
  syncConnectStep();
 }
}

openSetup.addEventListener('click', () => { showSetupStep(0); renderPlans(); fillConnectStep(); setupDialog.showModal(); });
setupForm.addEventListener('change', event => {
 if (event.target.name === 'billing_cycle') renderPlans();
 syncConnectStep();
});
backSetup.addEventListener('click', () => showSetupStep(0));
deferSetup.addEventListener('click', () => setupDialog.close());
setupForm.addEventListener('submit', event => { event.preventDefault(); advanceSetup(); });

try { token = localStorage.getItem(sessionKey) || ''; } catch {}
if (token) loadAccount().catch(() => {
 token = '';
 try { localStorage.removeItem(sessionKey); } catch {}
});

