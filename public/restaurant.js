import { uploadImage } from './image-upload.js';
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
 const summary = analytics.summary || {};
 const metrics = [
  ['M3 4h18l-2 10H5L3 4zm3 14a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm12 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2z', 'Total Orders', Number(summary.total_orders ?? 0)],
  ['M12 2v20m7-15c0 3-14 3-14 0s14-3 14 0zm0 10c0 3-14 3-14 0m14 5c0 3-14 3-14 0', 'Total Sales', ownerMoney(summary.completed_revenue_minor ?? 0)],
  ['M4 3v6a3 3 0 0 0 6 0V3M7 3v18m12 0V3c-3 2-4 5-4 9h4', 'Menu Items', menu.items.length],
  ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m7-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm11 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75', 'Customers', Number(summary.customer_names_count ?? 0)],
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
 for(const item of menu.items){const p=document.createElement('p'),button=document.createElement('button');p.className='owner-menu-row'+(item.active?'':' hidden-item');let thumb;try{const u=new URL(item.image_url,location.origin);if(!item.image_url||(u.protocol!=='https:'&&!(u.origin===location.origin&&u.pathname.startsWith('/media/'))))throw 0;thumb=document.createElement('img');thumb.src=u.href;thumb.alt='';thumb.loading='lazy';thumb.className='owner-menu-thumb';}catch{thumb=ownerText('span','No photo','owner-menu-thumb');}const text=ownerText('span','','owner-menu-text');text.append(ownerText('strong',item.name),ownerText('small',ownerMoney(item.price_minor)+' · '+(item.active?'Active':'Hidden')));button.type='button';button.className='btn btn-ghost btn-sm';button.textContent=item.active?'Hide':'Show';button.addEventListener('click',async()=>{try{await api('/api/restaurants/'+restaurantId+'/menu/'+item.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({...item,active:!item.active})});await refresh()}catch(e){status.textContent=e.message}});const edit=document.createElement('button');edit.type='button';edit.className='btn btn-ghost btn-sm';edit.textContent='Edit';edit.addEventListener('click',()=>editMenuItem(item));const actions=ownerText('span','','owner-menu-actions');actions.append(button,edit);p.append(thumb,text,actions);items.append(p)}
 renderOwnerInsights(analytics, menu.items);
 ownerOrders = orders.orders;
 renderOwnerOrderActivity(ownerOrders);
 renderOwnerOrders();
}

const orderSearch = document.querySelector('#owner-order-search');
const orderFilter = document.querySelector('#owner-order-status');
const orderTransitions = {pending:['accepted','cancelled'],accepted:['preparing','cancelled'],preparing:['ready'],ready:['completed']};
let ownerOrders = [];
orderSearch.addEventListener('input', renderOwnerOrders);
orderFilter.addEventListener('change', renderOwnerOrders);
const ownerGlobalSearch=document.querySelector('#owner-global-search');
ownerGlobalSearch?.addEventListener('input',()=>{orderSearch.value=ownerGlobalSearch.value;renderOwnerOrders();});
ownerGlobalSearch?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();location.hash='#order-desk';}});

function ownerMoney(minor) {
 return new Intl.NumberFormat(undefined, {style:'currency',currency:restaurantCurrency}).format(Number(minor)/100);
}

function ownerText(tag, value, className = '') {
 const node = document.createElement(tag);
 node.textContent = value;
 if (className) node.className = className;
 return node;
}

function ownerCompactMoney(minor) {
 try { return new Intl.NumberFormat(undefined, {style:'currency',currency:restaurantCurrency,notation:'compact',maximumFractionDigits:1}).format(Number(minor)/100); }
 catch { return ownerMoney(minor); }
}

// The chart is drawn at the container's real pixel width so its labels stay readable on phones.
let lastInsights = null, lastChartWidth = 0;
const salesResize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
 const width = document.querySelector('#owner-sales')?.clientWidth || 0;
 if (lastInsights && width && Math.abs(width - lastChartWidth) > 24) renderOwnerInsights(...lastInsights);
}) : null;
if (salesResize) salesResize.observe(document.querySelector('#owner-sales'));

function renderOwnerInsights(analytics, menuItems = []) {
 lastInsights = [analytics, menuItems];
 const sales = document.querySelector('#owner-sales');
 const chartWidth = Math.round(Math.min(700, Math.max(280, sales.clientWidth || 700)));
 lastChartWidth = sales.clientWidth || chartWidth;
 const byDay = new Map((analytics.last_30_days ?? []).map(day => [String(day.day).slice(0, 10), Number(day.completed_revenue_minor) || 0]));
 const today = new Date();
 const series = [];
 for (let offset = 29; offset >= 0; offset--) {
  const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - offset));
  const day = date.toISOString().slice(0, 10);
  series.push({day, amount:Math.max(0, byDay.get(day) || 0)});
 }
 const max = Math.max(1, ...series.map(day => day.amount));
 const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
 const svgNode = (tag, attributes = {}, content = null) => {
  const element = document.createElementNS(svg.namespaceURI, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  if (content !== null) element.textContent = String(content);
  return element;
 };
 svg.setAttribute('viewBox', '0 0 ' + chartWidth + ' 228');
 svg.setAttribute('role', 'img');
 svg.setAttribute('class', 'owner-revenue-chart');
 svg.setAttribute('aria-label', 'Real completed revenue for each of the last 30 days');
 const defs = svgNode('defs');
 const gradient = svgNode('linearGradient', {id:'mk-owner-sales-area',x1:'0',y1:'0',x2:'0',y2:'1'});
 gradient.append(svgNode('stop', {offset:'0%', 'stop-color':'#fa9a31', 'stop-opacity':'.48'}),svgNode('stop',{offset:'100%','stop-color':'#ffddb4','stop-opacity':'.03'}));
 defs.append(gradient);svg.append(defs);
 const narrow=chartWidth<480;
 const left=narrow?62:72,right=chartWidth-(narrow?8:13),chartTop=20,bottom=190;
 const y=value=>bottom-(value/max)*(bottom-chartTop);
 for(let i=0;i<=4;i++){
  const yy=bottom-i*(bottom-chartTop)/4;
  svg.append(svgNode('line',{x1:left,y1:yy,x2:right,y2:yy,class:'axis'}));
  svg.append(svgNode('text',{x:left-8,y:yy+4,'text-anchor':'end',class:'tick'},ownerCompactMoney(Math.round(max*i/4))));
 }
 const points=series.map((day,i)=>({x:left+i*(right-left)/29,y:y(day.amount),day:day.day,amount:day.amount}));
 const path=points.map((p,i)=>(i?'L':'M')+p.x.toFixed(1)+','+p.y.toFixed(1)).join(' ');
 svg.append(svgNode('path',{d:path+' L'+right+','+bottom+' L'+left+','+bottom+' Z',fill:'url(#mk-owner-sales-area)'}));
 svg.append(svgNode('path',{d:path,class:'revenue-line'}));
 for(const i of narrow?[0,14,29]:[0,7,14,21,29]){
  const p=points[i];
  svg.append(svgNode('circle',{cx:p.x,cy:p.y,r:'3.8',class:'revenue-dot'}));
  const label=new Date(p.day+'T00:00:00Z').toLocaleDateString(undefined,{month:'short',day:'numeric',timeZone:'UTC'});
  svg.append(svgNode('text',{x:p.x,y:215,'text-anchor':i===0?'start':i===29?'end':'middle',class:'tick'},label));
 }
 sales.replaceChildren(svg);
 if(!series.some(day=>day.amount>0))sales.append(ownerText('small','No completed revenue in this period.'));

 const statuses=analytics.by_status ?? [];
 const total=statuses.reduce((sum,row)=>sum+Number(row.count||0),0);
 const legend=ownerText('ul','','owner-status-legend');
 const colors={pending:'#e78b2f',accepted:'#715ac7',preparing:'#4162b3',ready:'#24a3a0',completed:'#258050',cancelled:'#c45160'};
 let position=0;
 const segments=[];
 for(const row of statuses){
  const count=Number(row.count)||0;
  if(count<=0 || total<=0)continue;
  const color=colors[row.status]??'#7d7490';
  const end=position+count/total*100;
  segments.push(color+' '+position+'% '+end+'%');
  position=end;
  const item=ownerText('li','');
  const swatch=ownerText('span','','owner-status-dot');swatch.style.backgroundColor=color;
  item.append(swatch,ownerText('span',row.status),ownerText('strong',count));legend.append(item);
 }
 const ring=ownerText('div','','owner-status-ring');ring.setAttribute('aria-hidden','true');
 if(segments.length)ring.style.backgroundImage='conic-gradient('+segments.join(',')+')';
 ring.append(ownerText('strong',total));
 document.querySelector('#owner-status-summary').replaceChildren(ring,...(total?[legend]:[ownerText('p','No orders yet.')]));
 const top=analytics.top_items ?? [];
 const items=ownerText('ul','','owner-top-list');
 const topCount=Math.max(1,...top.map(item=>Number(item.quantity)||0));
 for(const item of top){
  const row=ownerText('li','');
  const matched=menuItems.find(menuItem=>menuItem.name===item.name && typeof menuItem.image_url==='string');
  let picture;
  try{
   const url=new URL(matched?.image_url,location.origin);
   if((url.protocol!=='https:'&&!(url.origin===location.origin&&url.pathname.startsWith('/media/'))) || url.username || url.password)throw Error('Image URL not allowed');
   picture=document.createElement('img');picture.className='owner-dish-thumb';picture.alt='';picture.loading='lazy';picture.src=url.href;
  }catch{picture=ownerText('span','✦','owner-dish-thumb owner-dish-placeholder');}
  const details=ownerText('div','','owner-dish-details');
  details.append(ownerText('strong',item.name),ownerText('small',String(item.quantity)+' sold'));
  const bar=ownerText('span','','owner-dish-bar'),fill=document.createElement('i');
  fill.style.width=(100*(Number(item.quantity)||0)/topCount).toFixed(0)+'%';bar.append(fill);
  row.append(picture,details,bar);items.append(row);
 }
 document.querySelector('#owner-top-items').replaceChildren(top.length?items:ownerText('p','Completed orders will appear here.'));
}

function renderOwnerOrderActivity(orders) {
 const list=ownerText('ul','','owner-activity-list');
 for (const order of orders.slice(0,4)) {
  const entry=ownerText('li','');
  const icon=ownerText('span',order.status==='completed'?'✓':order.status==='cancelled'?'×':'●','owner-activity-icon');
  const text=ownerText('div','');
  const statusName=String(order.status||'pending').replace(/_/g,' ');
  text.append(ownerText('strong','Order #'+order.id+' · '+statusName),ownerText('small',(order.customer_name||'Customer')+' · '+ownerMoney(order.total_minor)));
  const date=new Date(order.created_at);
  const time=ownerText('time',Number.isNaN(date.valueOf())?'':date.toLocaleString());
  entry.append(icon,text,time);list.append(entry);
 }
 document.querySelector('#owner-order-activity').replaceChildren(orders.length?list:ownerText('p','No order activity yet.','muted'));
}

function renderOwnerOrders() {
 const root = document.querySelector('#orders');
 const query = orderSearch.value.trim().toLowerCase().replace(/^#/, '');
 const visible = ownerOrders.filter(order =>
  (!orderFilter.value || order.status === orderFilter.value) &&
  (String(order.id).includes(query) || (order.customer_name ?? '').toLowerCase().includes(query) || (order.customer_phone ?? '').includes(query))
 );
 const pendingCount = ownerOrders.filter(order => order.status === 'pending').length;
 const navCount = document.querySelector('#nav-pending-count');
 if (navCount) { navCount.textContent = pendingCount; navCount.hidden = !pendingCount; }
 if (!visible.length) {
  root.replaceChildren(ownerText('p', ownerOrders.length ? 'No orders match these filters.' : 'No orders yet. New orders appear here automatically.', 'muted'));
  return;
 }
 const columns = orderFilter.value ? [[orderFilter.value, orderFilter.value]] :
  [['pending', 'New'], ['accepted', 'Accepted'], ['preparing', 'Preparing'], ['ready', 'Ready'], ['completed', 'Completed'], ['cancelled', 'Cancelled']];
 const labels = {accepted:'Accept',preparing:'Start preparing',ready:'Mark ready',completed:'Complete',cancelled:'Cancel'};
 const methods = {cod:'Cash on delivery',cash_pickup:'Cash on pickup',stripe:'Online'};
 const payments = {unpaid:'Unpaid',pending:'Pending',paid:'Paid',failed:'Failed',refunded:'Refunded'};
 const board = columns.map(([statusKey, title]) => {
  const list = visible.filter(order => (order.status || 'pending') === statusKey);
  if (!list.length && ['completed', 'cancelled'].includes(statusKey) && !orderFilter.value) return null;
  const column = ownerText('section', '', 'order-column' + (['completed', 'cancelled'].includes(statusKey) ? ' done' : ''));
  column.setAttribute('aria-label', title + ' orders');
  const head = ownerText('header', '');
  const badge = ownerText('span', String(list.length), 'owner-order-badge'); badge.dataset.status = statusKey;
  head.append(ownerText('h3', title.charAt(0).toUpperCase() + title.slice(1)), badge);
  column.append(head);
  if (!list.length) column.append(ownerText('p', 'Nothing here right now.', 'empty'));
  const limit = ['completed', 'cancelled'].includes(statusKey) && !orderFilter.value ? 6 : 50;
  for (const order of list.slice(0, limit)) column.append(orderCard(order, labels, methods, payments));
  if (list.length > limit) column.append(ownerText('p', '+' + (list.length - limit) + ' more · filter by status to see all', 'order-more'));
  return column;
 }).filter(Boolean);
 root.replaceChildren(...board);
}

function orderCard(order, labels, methods, payments) {
 const card = ownerText('article', '', 'order-card');
 const head = ownerText('div', '', 'head');
 const date = new Date(order.created_at);
 head.append(ownerText('strong', '#' + order.id), ownerText('time', Number.isNaN(date.valueOf()) ? '' : date.toLocaleString(undefined, {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'})));
 const meta = ownerText('div', '', 'meta');
 meta.append(ownerText('strong', order.customer_name || 'Customer'));
 if (order.order_type === 'delivery' || order.order_type === 'pickup') meta.append(ownerText('span', order.order_type === 'delivery' ? 'Delivery' : 'Pickup'));
 for (const detail of [order.customer_phone, order.delivery_address, order.delivery_instructions && 'Note: ' + order.delivery_instructions]) if (detail) meta.append(ownerText('span', detail));
 const money = ownerText('div', '', 'money');
 money.append(ownerText('strong', ownerMoney(order.total_minor)));
 if (methods[order.payment_method]) {
  const pay = ownerText('span', methods[order.payment_method] + ' · ' + (payments[order.payment_status] || 'Unpaid'), 'tag ' + (order.payment_status === 'paid' ? 'tag-ok' : 'tag-warn'));
  money.append(pay);
 }
 card.append(head, meta, money);
 const actions = ownerText('div', '', 'actions');
 for (const next of orderTransitions[order.status] ?? []) {
  const button = ownerText('button', labels[next], 'btn btn-sm ' + (next === 'cancelled' ? 'btn-ghost' : next === 'accepted' ? 'btn-primary' : 'btn-dark'));
  button.type = 'button';
  button.addEventListener('click', async () => {
   const buttons = [...card.querySelectorAll('button')];
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
  const eta = ownerText('div', '', 'owner-order-estimate');
  const input = document.createElement('input');
  input.type = 'number'; input.min='1'; input.max='240'; input.step='1';
  input.setAttribute('aria-label','Minutes until order #' + order.id + ' is ready');
  input.placeholder='min';
  const remaining = order.estimated_ready_epoch == null ? null : Math.max(1,Math.ceil((Number(order.estimated_ready_epoch)*1000-Date.now())/60000));
  if (remaining !== null) input.value = remaining;
  const save = ownerText('button','Save ETA','btn btn-ghost btn-sm'); save.type = 'button';
  const clear = ownerText('button','Clear','btn btn-quiet btn-sm'); clear.type = 'button';
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
  eta.append(ownerText('span','Ready in'), input, ownerText('span','min'), save, clear);
  card.append(eta);
 }
 if (actions.childNodes.length) card.append(actions);
 return card;
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
 document.querySelector('#owner-heading').textContent = (activeView || ownerOverview).dataset.title || 'Dashboard';
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
 siteDirty=false;
 resetSiteForm();
 document.querySelector('#site-preview-wrap').hidden=true;
 document.querySelector('#site-preview-frame').removeAttribute('srcdoc');
 restaurantId = restaurant.id;
 restaurantCurrency = restaurant.currency;
 document.querySelector('#owner-tenant-initials').textContent = String(restaurant.name || 'R').split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase() || 'R';
 document.querySelector('#owner-restaurant-label').textContent = restaurant.name;
 document.querySelector('#owner-switch-name').textContent = restaurant.name;
 document.querySelector('#owner-restaurant-switch').hidden = false;
 document.querySelector('#management').hidden = false;
 ownerNavigation.hidden = restaurant.role !== 'admin';
 updateWorkspaceView();
 loadSetup(restaurant);
 try { await refresh(); } catch (error) { status.textContent = error.message; }
}

const loginError = document.querySelector('#login-error');
const loginNotice = document.querySelector('#login-notice');
function showLoginError(message) {
 loginError.textContent = message;
 loginError.hidden = !message;
}
function loginErrorMessage(status, serverMessage) {
 if (status === 400 || status === 401) return 'Incorrect email or password. Please try again, or use “Forgot password?”.';
 if (status === 429) return 'Too many sign-in attempts. Please wait a few minutes and try again.';
 if (status >= 500) return 'Sign-in is temporarily unavailable. Please try again shortly.';
 return serverMessage || 'Sign-in failed. Please try again.';
}
for (const input of form.querySelectorAll('input:not([type=checkbox])')) input.addEventListener('input', () => showLoginError(''));

form.addEventListener('submit', async event => {
 event.preventDefault();
 const submit = form.querySelector('button[type=submit]');
 submit.disabled = true;
 submit.textContent = 'Signing in…';
 showLoginError('');
 if (loginNotice) loginNotice.hidden = true;
 try {
  let response;
  try {
   response = await fetch('/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: document.querySelector('#email').value, password: document.querySelector('#password').value }),
   });
  } catch { throw Error('Could not reach Mar-Khoor. Check your internet connection and try again.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(loginErrorMessage(response.status, data.error));
  token = data.token;
  await loadAccount();
  // Kept signed in (default): survives closing the browser until "Sign out".
  // Unticked: signed in only until this browser tab/window is closed.
  try {
   if (document.querySelector('#remember-login').checked) { localStorage.setItem(sessionKey, token); sessionStorage.removeItem(sessionKey); }
   else { sessionStorage.setItem(sessionKey, token); localStorage.removeItem(sessionKey); }
  } catch {}
  form.reset();
 } catch (error) {
  showLoginError(error.message);
  document.querySelector('#password').select();
 }
 finally { submit.disabled = false; submit.textContent = 'Sign in'; }
});

logoutButton.addEventListener('click', async () => {
 logoutButton.disabled = true;
 try {
  await api('/auth/logout', { method: 'POST' });
  try { localStorage.removeItem(sessionKey); sessionStorage.removeItem(sessionKey); } catch {}
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
const itemPhotoFile = document.querySelector('#item-photo-file');
const itemPhotoPreview = document.querySelector('#item-photo-preview');
const itemPhotoEmpty = document.querySelector('#item-photo-empty');
const itemPhotoRemove = document.querySelector('#item-photo-remove');
const itemPhotoStatus = document.querySelector('#item-photo-status');
function showItemPhoto(url) {
 itemPhoto.value = url || '';
 itemPhotoPreview.hidden = !url; itemPhotoEmpty.hidden = Boolean(url); itemPhotoRemove.hidden = !url;
 if (url) itemPhotoPreview.src = url; else itemPhotoPreview.removeAttribute('src');
}
itemPhotoRemove.addEventListener('click', () => { showItemPhoto(''); itemPhotoStatus.textContent = 'Photo removed. Save the item to apply.'; });
itemPhotoFile.addEventListener('change', async () => {
 const file = itemPhotoFile.files[0]; itemPhotoFile.value = '';
 if (!file || !restaurantId) return;
 const id = restaurantId; saveMenuItem.disabled = true; itemPhotoStatus.textContent = 'Uploading photo…';
 try {
  const result = await uploadImage({ restaurantId: id, token, kind: 'menu', file, options: { maxSide: 1400 } });
  if (id !== restaurantId) return;
  showItemPhoto(result.url); itemPhotoStatus.textContent = 'Photo uploaded. Save the item to apply.';
 } catch (error) { itemPhotoStatus.textContent = error.message; }
 finally { saveMenuItem.disabled = false; }
});
let editingMenuItem = null;
function editMenuItem(item) {
 editingMenuItem = item ? {item, restaurantId} : null;
 itemName.value = item?.name ?? '';
 itemPrice.value = item ? Number(item.price_minor) / 100 : '';
 itemCategory.value = item?.category ?? '';
 showItemPhoto(item?.image_url ?? '');
 itemPhotoStatus.textContent = 'JPG, PNG or WebP. Large photos are resized automatically.';
 saveMenuItem.textContent = item ? 'Save item' : 'Add item';
 document.querySelector('#menu-editor-title').textContent = item ? 'Edit item' : 'Add item';
 if (item && location.hash !== '#menu-management') location.hash = '#menu-management';
 if (item && matchMedia('(max-width: 959px)').matches) document.querySelector('.menu-editor').scrollIntoView({behavior:'smooth', block:'start'});
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
let sitePublished=false,siteSlug='',siteSections=['about','menu','hours','contact'],siteDirty=false;
let siteImages={logo:'',cover:'',gallery:[]};
const siteImageStatus=document.querySelector('#site-image-status');
const galleryList=document.querySelector('#site-gallery');
function renderSiteImages(){
 for(const field of document.querySelectorAll('[data-site-image]')){
  const key=field.dataset.siteImage,url=siteImages[key],img=field.querySelector('img'),empty=field.querySelector('.photo-empty');
  img.hidden=!url;empty.hidden=Boolean(url);field.querySelector('.photo-remove').hidden=!url;
  if(url)img.src=url;else img.removeAttribute('src');
 }
 galleryList.replaceChildren(...siteImages.gallery.map((url,index)=>{
  const li=document.createElement('li'),img=document.createElement('img'),remove=document.createElement('button');
  img.src=url;img.alt='Gallery photo '+(index+1);remove.type='button';remove.textContent='Remove';remove.setAttribute('aria-label','Remove gallery photo '+(index+1));
  remove.addEventListener('click',()=>{siteImages.gallery=siteImages.gallery.filter((_,i)=>i!==index);siteDirty=true;renderSiteImages();});
  li.append(img,remove);return li;
 }));
 document.querySelector('#site-gallery-add').hidden=siteImages.gallery.length>=8;
}
async function uploadSiteImages(kind,files){
 if(!restaurantId)return;
 const id=restaurantId;
 for(const file of files){
  if(kind==='gallery'&&siteImages.gallery.length>=8){siteImageStatus.textContent='The gallery holds up to 8 photos.';break;}
  siteImageStatus.textContent='Uploading '+(kind==='gallery'?'photo':kind)+'…';
  try{
   const result=await uploadImage({restaurantId:id,token,kind,file,options:kind==='logo'?{maxSide:512,square:true}:{maxSide:kind==='cover'?2000:1400}});
   if(id!==restaurantId)return;
   if(kind==='gallery')siteImages.gallery=[...siteImages.gallery,result.url];else siteImages[kind]=result.url;
   siteDirty=true;renderSiteImages();
   siteImageStatus.textContent='Uploaded. Select Save website to keep it'+(sitePublished?' (your live site updates when you save).':'.');
  }catch(error){siteImageStatus.textContent=error.message;return;}
 }
}
for(const field of document.querySelectorAll('[data-site-image]')){
 const input=field.querySelector('input[type=file]');
 input.addEventListener('change',()=>{const files=[...input.files];input.value='';uploadSiteImages(field.dataset.siteImage,files.slice(0,1));});
 field.querySelector('.photo-remove').addEventListener('click',()=>{siteImages[field.dataset.siteImage]='';siteDirty=true;renderSiteImages();siteImageStatus.textContent='Removed. Save to apply.';});
}
document.querySelector('#site-gallery-file').addEventListener('change',event=>{const files=[...event.target.files];event.target.value='';uploadSiteImages('gallery',files);});
siteForm.addEventListener('input',()=>{siteDirty=true;});
siteForm.addEventListener('change',()=>{siteDirty=true;});
function resetSiteForm(){
 siteForm.reset();siteImages={logo:'',cover:'',gallery:[]};renderSiteImages();siteSlug='';sitePublished=false;siteSections=['about','menu','hours','contact'];
 sitePublish.textContent='Publish';siteLink.replaceChildren();siteStatus.textContent='';
}
function showSite(data){
 siteField('headline').value=data.config.headline;siteField('tagline').value=data.config.tagline;siteField('about').value=data.config.about;
 siteField('hours').value=data.config.hours;siteField('phone').value=data.config.phone;siteField('address').value=data.config.address;siteField('theme').value=data.config.theme;
 if(typeof data.description==='string')siteField('description').value=data.description;siteSections=data.config.sections;
 const chosenTemplate=siteForm.querySelector('input[name="site-template"][value="'+(data.config.template||'classic')+'"]');
 if(chosenTemplate)chosenTemplate.checked=true;
 siteField('assistant-recording').checked=data.config.assistantRecording===true;
 siteImages={logo:data.config.logo||'',cover:data.config.cover||'',gallery:Array.isArray(data.config.gallery)?data.config.gallery.slice(0,8):[]};renderSiteImages();
 if(data.slug)siteSlug=data.slug;
 if(typeof data.published==='boolean')sitePublished=data.published;
 siteDirty=false;
 sitePublish.textContent=sitePublished?'Unpublish':'Publish';
 siteLink.replaceChildren();
 if(sitePublished&&siteSlug){const a=document.createElement('a');a.href='/r/'+siteSlug;a.textContent='mar-khoor.com/r/'+siteSlug;a.target='_blank';a.rel='noopener';siteLink.append('Live at ',a)}
}
async function loadSite({force=false}={}){if(!restaurantId||(siteDirty&&!force))return;const id=restaurantId;const data=await api('/api/restaurants/'+id+'/site');if(id===restaurantId)showSite(data)}
const siteConfig=()=>({template:siteForm.querySelector('input[name="site-template"]:checked')?.value||'classic',headline:siteField('headline').value,tagline:siteField('tagline').value,about:siteField('about').value,hours:siteField('hours').value,phone:siteField('phone').value,address:siteField('address').value,theme:siteField('theme').value,assistantRecording:siteField('assistant-recording').checked,sections:siteSections,...(siteImages.logo?{logo:siteImages.logo}:{}),...(siteImages.cover?{cover:siteImages.cover}:{}),...(siteImages.gallery.length?{gallery:siteImages.gallery}:{})});
const siteJson={'Content-Type':'application/json'};
document.querySelector('#site-generate').addEventListener('click',async e=>{
 if(!restaurantId){siteStatus.textContent='Select your restaurant first.';return}
 const button = e.currentTarget;
 button.disabled=true;siteStatus.textContent='Writing…';
 try{
  const template=siteConfig().template,id=restaurantId;
  const data=await api('/api/restaurants/'+id+'/site/generate',{method:'POST',headers:siteJson,body:JSON.stringify({description:siteField('description').value})});
  // Never put one restaurant's draft into another restaurant's form after a switch.
  if(id!==restaurantId)return;
  const images=siteImages;data.config.template=template;showSite(data);siteImages=images;renderSiteImages();siteDirty=true;
  siteStatus.textContent=data.source==='ai'?'AI draft ready. Review and preview it, then select Save website. Nothing has been published.':'AI writing is unavailable. You can still edit, preview and save this template manually. Nothing has been published.';
 }
 catch(error){siteStatus.textContent=error.message}finally{button.disabled=false}
});
siteForm.addEventListener('submit',async e=>{
 e.preventDefault();if(!restaurantId){siteStatus.textContent='Select your restaurant first.';return}
 try{const wasPublished=sitePublished,id=restaurantId;const saved=await api('/api/restaurants/'+id+'/site',{method:'PUT',headers:siteJson,body:JSON.stringify({config:siteConfig(),description:siteField('description').value})});if(id!==restaurantId)return;showSite(saved);siteStatus.textContent=wasPublished?'Saved. Your published site has been updated.':'Draft saved. Publish when you are ready.'}
 catch(error){siteStatus.textContent=error.message}
});
sitePublish.addEventListener('click',async()=>{
 if(!restaurantId){siteStatus.textContent='Select your restaurant first.';return}
 sitePublish.disabled=true;
 try{
  const next=!sitePublished,id=restaurantId;
  if(next){await api('/api/restaurants/'+id+'/site',{method:'PUT',headers:siteJson,body:JSON.stringify({config:siteConfig(),description:siteField('description').value})});if(id===restaurantId)siteDirty=false;}
  try{await api('/api/restaurants/'+id+'/site/publish',{method:'POST',headers:siteJson,body:JSON.stringify({published:next})});}
  catch(error){if(next&&id===restaurantId){await loadSite({force:true}).catch(()=>{});throw Error('Your draft was saved, but it is not live yet. '+error.message)}throw error}
  if(id!==restaurantId)return;
  siteDirty=false;await loadSite({force:true});
  siteStatus.textContent=next?'Your approved website is live.':'Your website is unpublished. Your saved draft remains available.';
 }catch(error){siteStatus.textContent=error.message}finally{sitePublish.disabled=false}
});
const sitePreviewWrap=document.querySelector('#site-preview-wrap');
const sitePreviewFrame=document.querySelector('#site-preview-frame');
document.querySelector('#site-preview-close').addEventListener('click',()=>{
 sitePreviewWrap.hidden=true;sitePreviewFrame.removeAttribute('srcdoc');
});
document.querySelector('#site-preview-button').addEventListener('click',async event=>{
 if(!restaurantId){siteStatus.textContent='Select your restaurant first.';return}
 const button=event.currentTarget,id=restaurantId;
 button.disabled=true;siteStatus.textContent='Preparing your private preview…';
 try{
  const response=await fetch('/api/restaurants/'+id+'/site/preview',{
   method:'POST',
   headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify({config:siteConfig()}),
  });
  if(!response.ok){const result=await response.json().catch(()=>({}));throw Error(result.error||'Preview unavailable')}
  const html=await response.text();
  if(id!==restaurantId)return;
  sitePreviewFrame.srcdoc=html;sitePreviewWrap.hidden=false;
  sitePreviewWrap.scrollIntoView({behavior:'smooth',block:'start'});
  siteStatus.textContent='Preview ready. This view is private; nothing was published.';
 }catch(error){siteStatus.textContent=error.message}finally{button.disabled=false}
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
const setupTitles = ['Choose your plan', 'Connect WhatsApp and AI Caller', 'Your website', 'Setup status'];
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

// A plan clicked on the landing page (?plan=...) is an explicit choice: remember it and open
// setup on that plan after sign-in, even when the restaurant already has a plan.
const PLAN_STORE = 'mar-khoor.chosen-plan';
let planIntent = false;
{
 const params = new URLSearchParams(location.search);
 const plan = params.get('plan');
 if (['starter','premium','enterprise'].includes(plan)) {
  planIntent = true;
  try { localStorage.setItem(PLAN_STORE, JSON.stringify({plan, cycle: params.get('cycle') === 'yearly' ? 'yearly' : 'monthly', at: Date.now()})); } catch {}
  history.replaceState(null, '', location.pathname + location.hash);
  const notice = document.querySelector('#login-notice');
  if (notice) { notice.textContent = 'Sign in to continue with the ' + plan[0].toUpperCase() + plan.slice(1) + ' plan.'; notice.className = 'auth-message auth-info'; notice.hidden = false; }
 }
}

// Plan picked on /build-plan.html before registering (kept for 30 days).
function rememberedPlan() {
 try {
  const saved = JSON.parse(localStorage.getItem(PLAN_STORE) || 'null');
  if (saved && ['starter','premium','enterprise'].includes(saved.plan) && Date.now() - saved.at < 30 * 86400000) return saved;
 } catch {}
 return null;
}

function renderPlans() {
 const cycle = setupForm.elements.billing_cycle.value;
 const chosen = setupForm.querySelector('input[name="plan"]:checked')?.value || (planIntent && rememberedPlan()?.plan) || setupData.subscription?.plan || rememberedPlan()?.plan || 'starter';
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
  if (mode && item.mode && (mode.tagName === 'SELECT' || mode instanceof RadioNodeList)) mode.value = item.mode;
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

const LAST_SETUP_STEP = 3;
function websiteNeedsBuilder() {
 return !setupForm.elements.website_skip.checked && ['builder', 'domain'].includes(setupForm.elements.website_mode.value);
}
function showSetupStep(index) {
 setupStep = index;
 setupSteps.forEach((step, i) => { step.hidden = i !== index; });
 document.querySelector('#setup-step-label').textContent = 'Step ' + (index + 1) + ' of ' + (LAST_SETUP_STEP + 1);
 document.querySelector('#setup-title').textContent = setupTitles[index];
 document.querySelector('#setup-bar-fill').style.width = ((index + 1) / (LAST_SETUP_STEP + 1) * 100) + '%';
 backSetup.hidden = index === 0 || index === LAST_SETUP_STEP;
 deferSetup.hidden = index === LAST_SETUP_STEP;
 nextSetup.textContent = index === 0 || index === 1 ? 'Continue'
  : index === 2 ? (websiteNeedsBuilder() ? 'Finish and open AI Website Builder' : 'Finish setup')
  : 'Done';
 setupStatus.textContent = '';
}

// After setup, take the owner straight into the AI Website Builder with what we already know.
async function openWebsiteBuilder(integrations) {
 setupDialog.close();
 location.hash = '#website';
 try { await loadSite(); } catch {}
 const caller = setupForm.elements.ai_caller_value?.value.trim();
 const phone = document.querySelector('#site-phone');
 if (caller && phone && !phone.value) phone.value = caller;
 const pending = integrations.filter(item => item.kind !== 'website' && item.status !== 'skipped')
  .map(item => integrationLabels[item.kind] + ': ' + (statusLabels[item.status] || item.status).toLowerCase());
 siteStatus.textContent = (pending.length ? 'Setup saved (' + pending.join(', ') + '). ' : 'Setup saved. ')
  + 'Now describe your restaurant and press “Write with AI”. Edit anything, then Save and Publish.';
 document.querySelector('#site-description')?.focus();
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
  const remembered = rememberedPlan();
  if (remembered && (planIntent || !setupData.subscription)) setupForm.elements.billing_cycle.value = remembered.cycle === 'yearly' ? 'yearly' : 'monthly';
  else if (setupData.subscription) setupForm.elements.billing_cycle.value = setupData.subscription.billing_cycle;
  renderPlans();
  fillConnectStep();
  renderUsage(usage);
  summarise();
  openSetup.disabled = false;
  openSetup.textContent = setupData.subscription ? 'Change plan or setup' : 'Start setup';
  const wantsChange = planIntent && remembered && (remembered.plan !== setupData.subscription?.plan || remembered.cycle !== setupData.subscription?.billing_cycle);
  // First-time setup is skippable: do not interrupt returning owners on every sign-in.
  const firstPromptKey = 'mar-khoor.setup-prompted.' + restaurant.id;
  let alreadyPrompted = false;
  try { alreadyPrompted = localStorage.getItem(firstPromptKey) === '1'; } catch {}
  if ((!setupData.subscription && !location.hash && !alreadyPrompted) || wantsChange) {
   if (!wantsChange) { try { localStorage.setItem(firstPromptKey,'1'); } catch {} }
   showSetupStep(0); setupDialog.showModal();
  }
  planIntent = false;
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
   try { localStorage.removeItem(PLAN_STORE); } catch {}
   showSetupStep(1);
  } else if (setupStep === 1) {
   // Save and validate the two numbers now, so a wrong number is caught before the website step.
   setupStatus.textContent = 'Saving numbers…';
   const { whatsapp, ai_caller } = connectPayload();
   await api(setupUrl('/integrations'), jsonBody('PUT', { whatsapp, ai_caller }));
   if (selection !== setupSelection) return;
   showSetupStep(2);
  } else if (setupStep === 2) {
   if (!setupForm.elements.website_skip.checked && setupForm.elements.website_mode.value !== 'builder' && !setupForm.elements.website_value.value.trim()) {
    setupStatus.textContent = 'Enter your website domain, for example myrestaurant.com, or choose “build my website with AI”.';
    return;
   }
   setupStatus.textContent = 'Saving and connecting…';
   await api(setupUrl('/integrations'), jsonBody('PUT', connectPayload()));
   const result = await api(setupUrl('/integrations/finish'), {method:'POST'});
   if (selection !== setupSelection) return;
   setupData.integrations = result.integrations;
   statusList(setupResults, result.integrations);
   if (websiteNeedsBuilder()) { summarise(); await openWebsiteBuilder(result.integrations); return; }
   showSetupStep(LAST_SETUP_STEP);
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
 if (setupStep === 2) showSetupStep(2); // refresh the button label for the chosen website path
});
backSetup.addEventListener('click', () => showSetupStep(Math.max(0, setupStep - 1)));
deferSetup.addEventListener('click', () => setupDialog.close());
setupForm.addEventListener('submit', event => { event.preventDefault(); advanceSetup(); });

try { token = localStorage.getItem(sessionKey) || sessionStorage.getItem(sessionKey) || ''; } catch {}
// Do not auto-open a saved session while someone is completing a password reset link.
if (token && document.querySelector('#reset-view')?.hidden !== false) loadAccount().catch(() => {
 token = '';
 try { localStorage.removeItem(sessionKey); sessionStorage.removeItem(sessionKey); } catch {}
});

