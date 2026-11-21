import { uploadImage, prepareImage } from './image-upload.js?v=20261120-s5';
const form=document.querySelector('#login'),status=document.querySelector('#status'),target=document.querySelector('#restaurants');
let token='',restaurantId=null,restaurantCurrency='';
let refreshing=false;
setInterval(async()=>{if(!restaurantId||!token||document.hidden||refreshing)return;refreshing=true;try{await refresh()}catch(e){status.textContent='Auto-refresh: '+e.message}finally{refreshing=false}},15000);
const api=async(path,options={})=>{const r=await fetch(path,{...options,headers:{...options.headers,Authorization:'Bearer '+token}});const data=await r.json();if(!r.ok){const e=Error(data.error||'Request failed');e.code=data.code;e.status=r.status;throw e}return data};
async function refresh(){
 loadSite().catch(error=>{siteStatus.textContent=error.message});
 if(location.hash==='#website'){loadSiteAnalytics().catch(()=>{});loadDomain().catch(()=>{});loadWidget().catch(()=>{});}
 loadPlanOrders().catch(error=>{planOrders.textContent=error.message});
 if(billingLoadedFor!==restaurantId){billingLoadedFor=restaurantId;loadBilling().catch(()=>{});}
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
 let payBox = null;
 if (order.payment_type) {
  const states = {awaiting:'Not paid yet',submitted:'Check payment',confirmed:'Paid',rejected:'Not received'};
  money.append(ownerText('span', order.payment_label + ' · ' + (states[order.payment_state] || order.payment_state), 'tag ' + (order.payment_state === 'confirmed' ? 'tag-ok' : 'tag-warn')));
  if (order.payment_state !== 'confirmed') {
   payBox = ownerText('div', '', 'owner-payment-check');
   if (order.payment_reference) payBox.append(ownerText('span', 'Transaction ID: ' + order.payment_reference, 'small'));
   else if (order.payment_type !== 'card_on_delivery') payBox.append(ownerText('span', 'Customer has not sent a transaction ID yet', 'small muted'));
   for (const [action, text, cls] of [['confirm', order.payment_type === 'card_on_delivery' ? 'Mark paid' : 'Payment received', 'btn-primary'], ['reject', 'Not received', 'btn-ghost']]) {
    if (action === 'reject' && (order.payment_type === 'card_on_delivery' || !order.payment_reference)) continue;
    const b = ownerText('button', text, 'btn btn-sm ' + cls); b.type = 'button';
    b.addEventListener('click', async () => {
     if (action === 'confirm' && order.payment_type !== 'card_on_delivery' && !window.confirm('Only confirm after you see ' + ownerMoney(order.total_minor) + ' in your ' + order.payment_label + ' account' + (order.payment_reference ? ' (transaction ' + order.payment_reference + ')' : '') + '.')) return;
     b.disabled = true;
     try { await api('/api/restaurants/' + restaurantId + '/orders/' + order.id + '/payment', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action})}); await refresh(); status.textContent = 'Order #' + order.id + ' payment updated'; }
     catch (error) { status.textContent = error.message; b.disabled = false; }
    });
    payBox.append(b);
   }
  }
 } else if (methods[order.payment_method]) {
  const pay = ownerText('span', methods[order.payment_method] + ' · ' + (payments[order.payment_status] || 'Unpaid'), 'tag ' + (order.payment_status === 'paid' ? 'tag-ok' : 'tag-warn'));
  money.append(pay);
 }
 card.append(head, meta, money);
 if (payBox) card.append(payBox);
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

window.addEventListener('hashchange', () => { updateWorkspaceView(true); if (location.hash === '#website') loadSiteAnalytics().catch(() => {}); });

async function openRestaurant(restaurant) {
 siteDirty=false;
 resetSiteForm();
 document.querySelector('#site-preview-wrap').hidden=true;
 document.querySelector('#site-preview-frame').removeAttribute('srcdoc');
 restaurantId = restaurant.id;
 window.mkWhatsAppConnect?.init({ restaurantId, api });
 window.mkSiteContent?.init({ restaurantId, api });
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

// Earlier service orders (old per-service ordering) and owned numbers, shown only when there are any.
const usd=cents=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
const planStatus=document.querySelector('#plan-status'),planOrders=document.querySelector('#plan-orders');
async function loadPlanOrders(){
 if(!restaurantId)return;
 const data=await api('/api/restaurants/'+restaurantId+'/plan-orders');
 planOrders.replaceChildren();
 let shown=0;
 try{const owned=await api('/api/restaurants/'+restaurantId+'/numbers');for(const n of owned.numbers){const p=document.createElement('p');p.textContent='Your dedicated phone number: '+n.phone_number;planOrders.append(p);shown++}}catch{}
 {const box=document.createElement('div');planOrders.append(box);showForwarding(box,{savedOnly:true}).catch(()=>{});}
 for(const order of data.orders){
  const p=document.createElement('p');shown++;
  p.textContent='#'+order.id+' · '+order.features.join(', ')+(order.number_mode==='new'?' + dedicated number':'')+' · '+usd(order.monthly_minor)+' / month · '+order.status.replace('_',' ')+' ';
  if(order.status==='pending_payment'){
   const cancel=document.createElement('button');cancel.className='btn btn-ghost btn-sm';cancel.textContent='Cancel';
   cancel.addEventListener('click',async()=>{try{await api('/api/restaurants/'+restaurantId+'/plan-orders/'+order.id+'/cancel',{method:'POST'});await loadPlanOrders()}catch(error){planStatus.textContent=error.message}});
   p.append(cancel);
  }
  planOrders.append(p);
 }
 document.querySelector('#plan-orders-card').hidden=!shown;
}

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
 siteField('hours').value=data.config.hours;siteField('phone').value=data.config.phone;siteField('address').value=data.config.address;window.mkPhone?.sync();siteField('theme').value=data.config.theme;
 if(typeof data.description==='string')siteField('description').value=data.description;siteSections=data.config.sections;
 const chosenTemplate=siteForm.querySelector('input[name="site-template"][value="'+(data.config.template||'classic')+'"]');
 if(chosenTemplate)chosenTemplate.checked=true;
 siteField('assistant-recording').checked=data.config.assistantRecording===true;
 siteField('language').value=data.config.language||'en';
 siteImages={logo:data.config.logo||'',cover:data.config.cover||'',gallery:Array.isArray(data.config.gallery)?data.config.gallery.slice(0,8):[]};renderSiteImages();
 if(data.slug)siteSlug=data.slug;
 if(typeof data.published==='boolean')sitePublished=data.published;
 siteDirty=false;
 sitePublish.textContent=sitePublished?'Unpublish':'Publish';
 siteLink.replaceChildren();
 if(sitePublished&&siteSlug){const a=document.createElement('a');a.href='/r/'+siteSlug;a.textContent='mar-khoor.com/r/'+siteSlug;a.target='_blank';a.rel='noopener';siteLink.append('Live at ',a)}
}
async function loadSiteAnalytics(){
 if(!restaurantId)return;
 const id=restaurantId,data=await api('/api/restaurants/'+id+'/site/analytics');
 if(id!==restaurantId)return;
 const fmt=n=>Number(n||0).toLocaleString();
 document.querySelector('#sa-views').textContent=fmt(data.totals.page_views);
 document.querySelector('#sa-menu').textContent=fmt(data.totals.menu_views);
 document.querySelector('#sa-orders').textContent=fmt(data.totals.orders);
 document.querySelector('#sa-rate').textContent=data.menu_open_rate==null?'—':data.menu_open_rate+'%';
 const max=Math.max(1,...data.days.map(day=>day.page_views));
 document.querySelector('#sa-chart').replaceChildren(...data.days.map(day=>{const bar=document.createElement('span');bar.style.height=Math.max(3,Math.round(day.page_views/max*100))+'%';bar.title=day.day+': '+day.page_views+' views';return bar;}));
}
async function loadSite({force=false}={}){if(!restaurantId||(siteDirty&&!force))return;const id=restaurantId;const data=await api('/api/restaurants/'+id+'/site');if(id===restaurantId)showSite(data)}
const siteConfig=()=>({template:siteForm.querySelector('input[name="site-template"]:checked')?.value||'classic',headline:siteField('headline').value,tagline:siteField('tagline').value,about:siteField('about').value,hours:siteField('hours').value,phone:siteField('phone').value,address:siteField('address').value,theme:siteField('theme').value,assistantRecording:siteField('assistant-recording').checked,sections:siteSections,language:siteField('language').value,...(siteImages.logo?{logo:siteImages.logo}:{}),...(siteImages.cover?{cover:siteImages.cover}:{}),...(siteImages.gallery.length?{gallery:siteImages.gallery}:{})});
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
  catch(error){if(next&&id===restaurantId){await loadSite({force:true}).catch(()=>{});if(error.code==='plan_required'){siteStatus.textContent='Your website is saved. Buy a plan to put it live.';showPlanRequired();return}throw Error('Your draft was saved, but it is not live yet. '+error.message)}throw error}
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
// Call forwarding steps: shown when the restaurant chose "Forward my calls".
async function showForwarding(box,{savedOnly=false}={}){
 if(!box||!window.mkForwarding)return;
 const caller=setupData.integrations?.find(item=>item.kind==='ai_caller');
 if(savedOnly&&caller?.mode!=='forward'){box.replaceChildren();return;}
 const mode=caller?.mode||setupForm.elements.ai_caller_mode?.value;
 if(mode!=='forward'||caller?.status==='skipped'||setupForm.elements.ai_caller_skip?.checked){box.replaceChildren();return;}
 let aiNumber=null;
 try{const owned=await api('/api/restaurants/'+restaurantId+'/numbers');aiNumber=owned.numbers?.[0]?.phone_number||null;}catch{}
 window.mkForwarding.render(box,{aiNumber,restaurantNumber:caller?.value||setupForm.elements.ai_caller_value?.value?.trim()||''});
}

const usageMeter = document.querySelector('#usage-meter');
const planOptions = document.querySelector('#plan-options');
const setupSteps = [...setupForm.querySelectorAll('.setup-step')];
const setupTitles = ['Choose your plan', 'Connect WhatsApp and AI Caller', 'Your website', 'Setup status'];
const integrationLabels = {whatsapp:'Business WhatsApp', ai_caller:'AI Caller', website:'Website'};
const statusLabels = {connected:'Connected', pending:'Pending', failed:'Failed', skipped:'Skipped', not_started:'Not started'};
const metricLabels = {ai_chats:'AI chats', whatsapp_messages:'WhatsApp messages', ai_call_minutes:'Phone call minutes', ai_voice_minutes:'Website live voice minutes'};
let setupSelection = 0;
let setupStep = 0;
let setupPlanChoice = null;
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
 if (['website','whatsapp','calling'].includes(params.get('tool'))) { try { localStorage.setItem('mar-khoor.want-tool', params.get('tool')); } catch {} history.replaceState(null, '', location.pathname + location.hash); }
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
  if (entry.stops_at_limit && entry.warning >= 100) text += '. Used up: website voice is paused until next month (text chat keeps working).';
  else if (entry.stops_at_limit && entry.warning >= 75) text += '. Almost used up; website voice pauses at the limit.';
  else if (entry.warning >= 100) text += '. Over the limit; extra usage will be billed. Upgrade for a better rate.';
  else if (entry.warning >= 75) text += '. Approaching your limit; consider upgrading.';
  row.append(ownerText('span', text), meter);
  return row;
 }));
 usageMeter.hidden = false;
}

const CALL_MODE_TEXT = { forward:'Forward my calls (easiest)', import:'Connect my own number', new:'Get a new local number' };
function adaptCallOptions() {
 const select = setupForm.elements.ai_caller_mode, hint = document.querySelector('#setup-call-hint');
 if (!select || !hint) return;
 const pk = setupCountry === 'PK';
 for (const option of select.options) option.textContent = CALL_MODE_TEXT[option.value] + (pk && option.value === 'import' ? ' (recommended, cheaper)' : pk && option.value === 'new' ? ' (costs more in Pakistan)' : '');
 hint.hidden = !pk;
 hint.textContent = 'In Pakistan a new number from us costs much more each month. Put a spare SIM or number on the AI Caller instead: we give you the call minutes, you pay no number fee.';
}
function fillConnectStep() {
 adaptCallOptions();
 const callMode = setupForm.elements.ai_caller_mode;
 if (setupCountry === 'PK' && callMode && !setupData.integrations.some(item => item.kind === 'ai_caller' && item.mode)) callMode.value = 'import';
 for (const item of setupData.integrations) {
  const value = setupForm.elements[item.kind + '_value'];
  const mode = setupForm.elements[item.kind + '_mode'];
  if (value && item.value) value.value = item.value;
  window.mkPhone?.sync();
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
  : index === 2 ? (setupPlanChoice || (setupData?.subscription && setupData.subscription.status !== 'active') ? 'Finish and go to cart' : websiteNeedsBuilder() ? 'Finish and open AI Website Builder' : 'Finish setup')
  : (setupPlanChoice || (setupData?.subscription && setupData.subscription.status !== 'active') ? 'Go to cart & pay' : 'Done');
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
 const payNow = document.querySelector('#pay-now');
 if (payNow) { payNow.hidden = !sub || sub.status === 'active'; openSetup.classList.toggle('btn-primary', payNow.hidden); openSetup.classList.toggle('btn-ghost', !payNow.hidden); }
 statusList(setupProgress, setupData.integrations.filter(item => item.status !== 'not_started'));
}

var setupCountry = '';
async function loadSetup(restaurant) {
 setupCountry = restaurant.country_code || '';
 window.mkPhone?.setDefaultCountry(setupCountry);
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
   // A plan already picked on the landing page / registration is not asked again: save it and
   // go straight to connecting channels (Back still lets the owner change it).
   if (remembered && setupData.subscription?.status !== 'active' && setupForm.querySelector('input[name="plan"][value="' + remembered.plan + '"]')?.checked) {
    await advanceSetup();
    if (setupStep === 1) setupStatus.textContent = remembered.plan[0].toUpperCase() + remembered.plan.slice(1) + ' plan (' + remembered.cycle + ') selected. Use Back to change it.';
   }
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
   const cycle = setupForm.elements.billing_cycle.value;
   const current = setupData.subscription;
   if (current?.status === 'active') {
    // An active (paid) plan stays active; a change is paid for in the cart at the end.
    setupPlanChoice = current.plan === plan && current.billing_cycle === cycle ? null : { plan, cycle };
   } else {
    setupStatus.textContent = 'Saving plan…';
    const result = await api(setupUrl('/subscription'), jsonBody('PUT', {plan, billing_cycle:cycle}));
    if (selection !== setupSelection) return;
    setupData.subscription = result.subscription;
    setupPlanChoice = null;
   }
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
   showForwarding(document.querySelector('#setup-forwarding'));
   if (websiteNeedsBuilder()) {
    const sub = setupData.subscription;
    if (setupPlanChoice || (sub && sub.status !== 'active')) {
     // Pay first: the cart opens now, and the AI Website Builder opens by itself once the plan is active.
     try { localStorage.setItem('mar-khoor.after-pay.' + restaurantId, 'website'); } catch {}
     setupDialog.close();
     const plan = setupPlanChoice?.plan || sub?.plan, cycle = setupPlanChoice?.cycle || sub?.billing_cycle;
     setupPlanChoice = null;
     summarise();
     goToCart(plan, cycle, 'Setup saved. Check your cart and pay: your plan starts right away and the AI Website Builder opens after payment.');
     return;
    }
    summarise(); await openWebsiteBuilder(result.integrations); return;
   }
   showSetupStep(LAST_SETUP_STEP);
  } else {
   setupDialog.close();
   const sub = setupData.subscription;
   if (setupPlanChoice) goToCart(setupPlanChoice.plan, setupPlanChoice.cycle, 'Setup saved. Pay for the new plan in your cart; your current plan stays active until then.');
   else if (sub && sub.status !== 'active') goToCart(sub.plan, sub.billing_cycle, 'Setup saved. Check your cart and pay to activate your plan.');
   setupPlanChoice = null;
  }
  summarise();
 } catch (error) {
  if (selection === setupSelection) setupStatus.textContent = error.message;
 } finally {
  controls.forEach(control => { control.disabled = false; });
  syncConnectStep();
 }
}

document.querySelector('#pay-now')?.addEventListener('click', () => { const sub = setupData?.subscription; goToCart(sub?.plan, sub?.billing_cycle, 'Check your cart and pay to activate your plan.'); });
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


// AI menu import: draft → owner review → bulk add.
const importBody=document.querySelector('#menu-import-body'),importToggle=document.querySelector('#menu-import-toggle');
const importStatus=document.querySelector('#import-status'),importReview=document.querySelector('#import-review'),importRows=document.querySelector('#import-rows');
let importItems=[],importRestaurant=null;
importToggle.addEventListener('click',()=>{const open=importBody.hidden;importBody.hidden=!open;importToggle.setAttribute('aria-expanded',String(open));importToggle.textContent=open?'Close':'Start import';});
for(const tab of document.querySelectorAll('[data-import-tab]'))tab.addEventListener('click',()=>{
 for(const other of document.querySelectorAll('[data-import-tab]'))other.setAttribute('aria-selected',String(other===tab));
 for(const pane of document.querySelectorAll('[data-import-pane]'))pane.hidden=pane.dataset.importPane!==tab.dataset.importTab;
});
function setImportBusy(busy){for(const control of importBody.querySelectorAll('button,input,textarea'))control.disabled=busy;}
async function runImport(body,headers){
 if(!restaurantId)return;
 const id=restaurantId;setImportBusy(true);importReview.hidden=true;importStatus.textContent='Reading your menu with AI… this can take up to a minute.';
 try{
  const response=await fetch('/api/restaurants/'+id+'/menu/import',{method:'POST',headers:{Authorization:'Bearer '+token,...headers},body});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error||'Menu import failed');
  if(id!==restaurantId)return;
  importRestaurant=id;importItems=data.items.map(item=>({...item,selected:item.price_minor!=null}));renderImport();
  importStatus.textContent='Found '+data.items.length+' items. Check names and prices, untick anything wrong, then add.';
 }catch(error){importStatus.textContent=error.message;}
 finally{setImportBusy(false);}
}
function renderImport(){
 importRows.replaceChildren(...importItems.map((item,index)=>{
  const row=document.createElement('tr');
  const pick=document.createElement('input');pick.type='checkbox';pick.checked=item.selected;pick.setAttribute('aria-label','Add '+item.name);pick.addEventListener('change',()=>{item.selected=pick.checked;countImport();});
  const field=(key,value,attrs={})=>{const input=Object.assign(document.createElement('input'),{value,className:'input',...attrs});input.addEventListener('input',()=>{item[key]=input.value;});return input;};
  const name=field('name',item.name,{maxLength:180});name.setAttribute('aria-label','Item name');
  const category=field('category',item.category,{maxLength:80});category.setAttribute('aria-label','Category');
  const price=field('price',item.price_minor==null?'':(item.price_minor/100).toString(),{type:'number',min:'0',step:'0.01',placeholder:'Price'});price.setAttribute('aria-label','Price');
  price.addEventListener('input',()=>{const value=Number(price.value);item.price_minor=price.value===''||!Number.isFinite(value)||value<0?null:Math.round(value*100);if(item.price_minor!=null&&!item.selected){item.selected=true;pick.checked=true;countImport();}});
  for(const [cell,content] of [[document.createElement('td'),pick],[document.createElement('td'),name],[document.createElement('td'),category],[document.createElement('td'),price]]){cell.append(content);row.append(cell);}
  if(item.description){const note=document.createElement('small');note.className='hint';note.textContent=item.description;row.children[1].append(note);}
  return row;
 }));
 importReview.hidden=!importItems.length;countImport();
}
function countImport(){const selected=importItems.filter(item=>item.selected).length;document.querySelector('#import-count').textContent=selected+' of '+importItems.length+' selected';document.querySelector('#import-add').textContent='Add '+selected+' item'+(selected===1?'':'s');document.querySelector('#import-all').checked=selected===importItems.length;}
document.querySelector('#import-all').addEventListener('change',event=>{for(const item of importItems)item.selected=event.target.checked;renderImport();});
document.querySelector('#import-cancel').addEventListener('click',()=>{importItems=[];importReview.hidden=true;importStatus.textContent='Import discarded. Nothing was added.';});
document.querySelector('#import-file').addEventListener('change',async event=>{
 const file=event.target.files[0];event.target.value='';if(!file)return;
 try{
  if(file.type==='application/pdf'){if(file.size>8*1024*1024)throw Error('PDF must be 8 MB or smaller');await runImport(file,{'Content-Type':'application/pdf'});}
  else{const blob=await prepareImage(file,{maxSide:2200,quality:0.9});await runImport(blob,{'Content-Type':blob.type});}
 }catch(error){importStatus.textContent=error.message;}
});
document.querySelector('#import-url-go').addEventListener('click',()=>{const url=document.querySelector('#import-url').value.trim();if(!url){importStatus.textContent='Paste the link to your menu page.';return;}runImport(JSON.stringify({url}),{'Content-Type':'application/json'});});
document.querySelector('#import-text-go').addEventListener('click',()=>{const text=document.querySelector('#import-text').value;if(!text.trim()){importStatus.textContent='Paste your menu text first.';return;}runImport(JSON.stringify({text}),{'Content-Type':'application/json'});});
document.querySelector('#import-add').addEventListener('click',async event=>{
 if(importRestaurant!==restaurantId){importStatus.textContent='This draft belongs to another restaurant. Import again.';return;}
 const chosen=importItems.filter(item=>item.selected);
 if(!chosen.length){importStatus.textContent='Select at least one item.';return;}
 const missing=chosen.find(item=>!String(item.name).trim()||item.price_minor==null);
 if(missing){importStatus.textContent='Add a name and price for “'+(missing.name||'item')+'” or untick it.';return;}
 const button=event.currentTarget;button.disabled=true;
 try{
  const result=await api('/api/restaurants/'+restaurantId+'/menu/bulk',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:chosen.map(({name,description,category,price_minor})=>({name:String(name).trim(),description:description||'',category:String(category||'').trim(),price_minor}))})});
  importItems=[];importReview.hidden=true;importStatus.textContent=result.added+' items added to your menu. You can add photos with Edit.';
  await refresh();
 }catch(error){importStatus.textContent=error.message;}
 finally{button.disabled=false;}
});

// Custom domain for the restaurant website (automatic through Hostinger when enabled).
const domainInput=document.querySelector('#domain-input'),domainStatus=document.querySelector('#domain-status'),domainNote=document.querySelector('#domain-note');
const domainLabels={pending:['Setting up','tag-warn'],verified:['Almost live','tag-info'],connected:['Live','tag-ok']};
const stageNotes={ownership:'Add the TXT record below so we can confirm the domain is yours. We check automatically.',parking:'Connecting your domain to Mar-Khoor hosting…',dns:'Hosting is ready. Waiting for DNS to point to Mar-Khoor.',ssl:'DNS is correct. Installing the secure HTTPS certificate…',live:'Your website is live on this domain.',error:'Setup needs help from the Mar-Khoor team.'};
function cellRow(values){const row=document.createElement('tr');values.forEach((value,i)=>{const cell=document.createElement('td');const el=document.createElement(i===1||i===2?'code':'span');el.textContent=value;cell.append(el);row.append(cell);});return row;}
function showDomain(data){
 const has=Boolean(data.domain);
 if(document.activeElement!==domainInput)domainInput.value=data.domain||'';
 document.querySelector('#domain-remove').hidden=!has;
 document.querySelector('#domain-buy').hidden=has||data.automatic===false;
 domainStatus.hidden=!has;
 if(has){const [label,cls]=data.stage==='live'?domainLabels.connected:domainLabels[data.status]||[data.status,''];domainStatus.textContent=label;domainStatus.className='tag '+cls;}
 const progress=document.querySelector('#domain-progress');
 progress.hidden=!(has&&data.steps);
 progress.replaceChildren(...(data.steps||[]).map(step=>{const li=document.createElement('li');li.dataset.state=step.state;li.textContent=step.label;return li;}));
 const records=data.records||[];
 document.querySelector('#domain-steps').hidden=!has||!records.length;
 document.querySelector('#domain-records').replaceChildren(...records.map(record=>cellRow([record.type,record.name,record.value,record.purpose])));
 const ns=document.querySelector('#domain-ns');
 ns.hidden=!(has&&data.automatic&&!data.managed&&data.stage==='dns');
 if(!ns.hidden)ns.textContent='Easiest option: at your domain company, either add the records below, or change the nameservers to Hostinger’s (ask us for the exact pair) — then we manage all records for you automatically.';
 document.querySelector('#domain-verify').hidden=!has||data.stage==='live';
 domainNote.textContent=!has?'':(!sitePublished&&data.status!=='connected'?'Saved. Your domain shows your website once it is published (publishing needs a plan). ':'')+(data.automatic?(stageNotes[data.stage]||'')+(data.last_error&&data.stage!=='live'?' ('+data.last_error+')':''):data.status==='connected'?'Your website is live on '+data.domain+'.':data.status==='verified'?'Ownership verified. The Mar-Khoor team is switching on HTTPS.':(data.last_error||''));
}
async function loadDomain(){if(!restaurantId)return;const id=restaurantId;const data=await api('/api/restaurants/'+id+'/site/domain');if(id===restaurantId)showDomain(data);loadDomainRequests().catch(()=>{});}
async function loadDomainRequests(){const id=restaurantId;const {requests}=await api('/api/restaurants/'+id+'/site/domain/requests');if(id!==restaurantId||!requests.length)return;const latest=requests[0];const labels={requested:'waiting for confirmation',purchasing:'being registered',purchased:'registered — connecting automatically',failed:'could not be registered',rejected:'not approved'};document.querySelector('#domain-request-status').textContent='Your request for '+latest.domain+' is '+(labels[latest.status]||latest.status)+'.';}
document.querySelector('#domain-save').addEventListener('click',async event=>{
 const button=event.currentTarget;button.disabled=true;domainNote.textContent='Saving and connecting…';
 try{showDomain(await api('/api/restaurants/'+restaurantId+'/site/domain',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({domain:domainInput.value})}));}
 catch(error){domainNote.textContent=error.message;}
 finally{button.disabled=false;}
});
document.querySelector('#domain-remove').addEventListener('click',async()=>{if(!confirm('Remove this domain from your website?'))return;try{showDomain(await api('/api/restaurants/'+restaurantId+'/site/domain',{method:'DELETE'}));domainInput.value='';}catch(error){domainNote.textContent=error.message;}});
document.querySelector('#domain-verify').addEventListener('click',async event=>{const button=event.currentTarget;button.disabled=true;domainNote.textContent='Checking…';try{showDomain(await api('/api/restaurants/'+restaurantId+'/site/domain/verify',{method:'POST'}));}catch(error){domainNote.textContent=error.message;}finally{button.disabled=false;}});
document.querySelector('#domain-search-go').addEventListener('click',async event=>{
 const button=event.currentTarget,list=document.querySelector('#domain-options'),statusLine=document.querySelector('#domain-request-status');
 button.disabled=true;statusLine.textContent='Searching…';list.replaceChildren();
 try{
  const {options}=await api('/api/restaurants/'+restaurantId+'/site/domain/search?name='+encodeURIComponent(document.querySelector('#domain-search').value));
  statusLine.textContent=options.length?'Available domains:':'Nothing available with that name. Try another.';
  list.replaceChildren(...options.map(option=>{const li=document.createElement('li');const name=document.createElement('strong');name.textContent=option.domain;const price=document.createElement('span');price.className='small muted';price.textContent=new Intl.NumberFormat(undefined,{style:'currency',currency:option.currency||'USD'}).format(option.price_cents/100)+' first year';const pick=document.createElement('button');pick.type='button';pick.className='btn btn-primary btn-sm';pick.textContent='Request';
   pick.addEventListener('click',async()=>{pick.disabled=true;try{await api('/api/restaurants/'+restaurantId+'/site/domain/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({domain:option.domain})});list.replaceChildren();statusLine.textContent='Requested '+option.domain+'. We will register and connect it for you.';}catch(error){statusLine.textContent=error.message;pick.disabled=false;}});
   li.append(name,price,pick);return li;}));
 }catch(error){statusLine.textContent=error.message;}
 finally{button.disabled=false;}
});
window.addEventListener('hashchange',()=>{if(location.hash==='#website')loadDomain().catch(()=>{});});
if(location.hash==='#website')setTimeout(()=>loadDomain().catch(()=>{}),1500);

// Website widget: Mar-Khoor tools on the owner's existing website.
const widgetEl=id=>document.getElementById(id);
function showWidget(data){
 const c=data.config,n=data.connected_numbers||{};
 widgetEl('widget-enabled').checked=c.enabled;widgetEl('widget-assistant').checked=c.assistant;widgetEl('widget-whatsapp').checked=c.whatsapp;widgetEl('widget-call').checked=c.call;
 widgetEl('widget-whatsapp-number').value=c.whatsapp_number;widgetEl('widget-whatsapp-number').placeholder=n.whatsapp?'Using your connected number '+n.whatsapp:'';
 widgetEl('widget-call-number').value=c.call_number;widgetEl('widget-call-number').placeholder=n.call?'Using your AI Caller number '+n.call:'';
 widgetEl('widget-label').value=c.label;widgetEl('widget-color').value=c.color;widgetEl('widget-position').value=c.position;widgetEl('widget-greeting').value=c.greeting;window.mkPhone?.sync();
 widgetEl('widget-origins').value=c.origins.map(o=>o.replace(/^https:\/\//,'')).join(', ');
 const note=widgetEl('widget-assistant-note');
 note.hidden=data.assistant_available&&data.menu_items>0;
 note.textContent=!data.assistant_available?'The AI Assistant is not included in your current plan yet. The chat button stays hidden until it is.':'Add menu items first so the AI Assistant can answer and take orders.';
 const tag=widgetEl('widget-status');tag.hidden=false;tag.textContent=c.enabled?'On':'Off';tag.className='tag'+(c.enabled?' tag-ok':'');
 widgetEl('widget-code').hidden=!c.enabled;widgetEl('widget-snippet').value=data.snippet;widgetEl('widget-preview').href=data.preview_url;
 widgetEl('widget-preview').parentElement.hidden=!(c.assistant&&data.assistant_available);
}
async function loadWidget(){if(!restaurantId||!widgetEl('widget-form'))return;const id=restaurantId;const data=await api('/api/restaurants/'+id+'/widget');if(id===restaurantId)showWidget(data);}
widgetEl('widget-form')?.addEventListener('submit',async event=>{
 event.preventDefault();const note=widgetEl('widget-note');note.textContent='Saving…';
 try{
  const data=await api('/api/restaurants/'+restaurantId+'/widget',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({
   enabled:widgetEl('widget-enabled').checked,assistant:widgetEl('widget-assistant').checked,whatsapp:widgetEl('widget-whatsapp').checked,call:widgetEl('widget-call').checked,
   whatsapp_number:widgetEl('widget-whatsapp-number').value,call_number:widgetEl('widget-call-number').value,
   label:widgetEl('widget-label').value,color:widgetEl('widget-color').value,position:widgetEl('widget-position').value,
   greeting:widgetEl('widget-greeting').value,origins:widgetEl('widget-origins').value})});
  showWidget(data);note.textContent=data.config.enabled?'Saved. Copy the code below into your website.':'Saved. The widget is off on your website.';
 }catch(e){note.textContent=e.message}
});
widgetEl('widget-copy')?.addEventListener('click',async()=>{const input=widgetEl('widget-snippet');try{await navigator.clipboard.writeText(input.value);widgetEl('widget-copy').textContent='Copied';setTimeout(()=>widgetEl('widget-copy').textContent='Copy code',2000)}catch{input.select()}});
window.addEventListener('hashchange',()=>{if(location.hash==='#website')loadWidget().catch(()=>{});});
if(location.hash==='#website')setTimeout(()=>loadWidget().catch(()=>{}),1500);

// Plans & billing: plan + tools go into a cart, then card payment (Stripe Checkout).
// Activation happens only through Stripe's webhook.
const billingEl=id=>document.getElementById(id);
var billingLoadedFor=null;let billingData=null,billingPlans=[];
const TOOL_NAMES={website:'Website Builder',ai_assistant:'Web AI Assistant',whatsapp:'WhatsApp Business',ai_caller:'AI Call Assistant'};
const billingMoney=(minor,currency)=>{try{return new Intl.NumberFormat(undefined,{style:'currency',currency,maximumFractionDigits:minor%100?2:0}).format(minor/100)}catch{return currency+' '+(minor/100)}};
const billingForm=billingEl('billing-form');
const billingCycle=()=>billingForm.elements.billing_cycle.value;
const billingPlan=()=>billingPlans.find(p=>p.key===billingForm.querySelector('input[name="plan"]:checked')?.value);
const addonFor=(plan,cycle)=>{const m=plan?.dedicated_number?.included?null:plan?.dedicated_number?.addon_price_minor;return Number.isSafeInteger(m)&&m>0?(cycle==='yearly'?m*12:m):null};
function renderBillingPlans(){
 const box=billingEl('billing-plans');if(!box)return;
 const chosen=billingForm.querySelector('input[name="plan"]:checked')?.value||billingData?.subscription?.plan||'starter';
 box.replaceChildren();
 const cycle=billingCycle(),sub=billingData?.subscription;
 for(const plan of billingPlans){
  const label=document.createElement('label');label.className='billing-plan';
  const input=document.createElement('input');input.type='radio';input.name='plan';input.value=plan.key;input.checked=chosen===plan.key;
  const name=document.createElement('strong');name.textContent=plan.name;
  const price=document.createElement('span');price.className='billing-price';const amount=plan.price_minor?.[cycle];price.textContent=amount==null?'Price on request':billingMoney(amount,plan.currency)+(cycle==='yearly'?' / year':' / month');
  const limits=document.createElement('small');limits.className='muted';limits.textContent=plan.limits.ai_chats.toLocaleString()+' AI chats · '+plan.limits.whatsapp_messages.toLocaleString()+' WhatsApp · '+plan.limits.ai_call_minutes.toLocaleString()+' call min'+(plan.dedicated_number?.included?' · own AI number included':'');
  label.append(input,name,price,limits);
  if(sub?.status==='active'&&sub.plan===plan.key&&sub.billing_cycle===cycle){const tag=document.createElement('span');tag.className='tag tag-ok';tag.textContent='Current';label.append(tag)}
  box.append(label);
 }
 renderCart();
}
function renderCart(){
 if(buyMode()==='tools')return renderToolsCart();
 const plan=billingPlan(),cycle=billingCycle(),lines=billingEl('cart-lines');if(!lines)return;
 const number=billingEl('billing-number'),numberPrice=billingEl('billing-number-price');
 const addon=addonFor(plan,cycle);
 if(plan?.dedicated_number?.included){number.checked=true;number.disabled=true;numberPrice.textContent='· included in '+plan.name}
 else{number.disabled=addon==null;if(addon==null)number.checked=false;numberPrice.textContent=addon==null?'· not available yet':'· +'+billingMoney(addon,plan.currency)+(cycle==='yearly'?' / year':' / month')+(setupCountry==='PK'?' · tip: a spare SIM of your own costs nothing extra; your plan already includes the call minutes':'')}
 lines.replaceChildren();
 const line=(name,value,cls)=>{const li=document.createElement('li');if(cls)li.className=cls;const a=document.createElement('span');a.textContent=name;const b=document.createElement('span');b.textContent=value;li.append(a,b);lines.append(li)};
 if(!plan){billingEl('cart-total').textContent='—';return}
 const price=plan.price_minor?.[cycle];
 line(plan.name+' plan ('+cycle+')',price==null?'Price on request':billingMoney(price,plan.currency),'cart-plan');
 const tools=[...billingForm.querySelectorAll('input[name="tool"]:checked')].map(i=>i.value);
 for(const t of tools)line(TOOL_NAMES[t],'Included','cart-tool');
 if(!tools.length)line('No tools selected','—','cart-tool cart-empty');
 const wantsNumber=number.checked;
 if(wantsNumber)line('Dedicated AI phone number',plan.dedicated_number?.included?'Included':billingMoney(addon,plan.currency),'cart-tool');
 const total=price==null?null:price+(wantsNumber&&!plan.dedicated_number?.included?addon:0);
 billingEl('cart-total').textContent=total==null?'—':billingMoney(total,plan.currency);
 billingEl('cart-renews').textContent=total==null?'':(cycle==='yearly'?'Billed every year':'Billed every month')+'. Price in '+plan.currency+(plan.converted?' (converted from USD at today’s rate)':'')+'.';
 const pay=billingEl('billing-pay');
 const sub=billingData?.subscription;
 const same=sub?.status==='active'&&billingData?.stripe?.has_customer&&sub.plan===plan.key&&sub.billing_cycle===cycle&&(plan.dedicated_number?.included||Boolean(billingData.number_addon)===wantsNumber);
 pay.disabled=!billingData?.enabled||total==null||!tools.length||same;
 pay.textContent=same?'This is your current plan':sub?.status==='active'&&billingData?.stripe?.has_customer?'Change plan & pay':'Checkout & pay '+(total==null?'':billingMoney(total,plan.currency));
}
function showBilling(data,plans){
 billingData=data;billingPlans=plans||billingPlans;
 const sub=data.subscription,status=billingEl('billing-status');
 const labels={active:'Active',pending_payment:'Payment pending',past_due:'Payment failed',cancelled:'Cancelled'};
 status.hidden=!sub;status.textContent=sub?labels[sub.status]||sub.status:'';status.className='tag'+(sub?.status==='active'?' tag-ok':sub?.status==='past_due'?' tag-ember':'');
 const plan=sub&&billingPlans.find(p=>p.key===sub.plan);
 const renews=data.stripe?.renews_at?' · renews '+new Date(data.stripe.renews_at).toLocaleDateString():'';
 billingEl('billing-summary').textContent=sub?'Current: '+(plan?.name||sub.plan)+' · '+sub.billing_cycle+(sub.price_minor!=null?' · '+billingMoney(sub.price_minor,sub.currency):'')+renews:'Pick a plan, tick your tools, then pay from your cart.';
 if(sub?.billing_cycle&&!billingForm.dataset.touched)billingForm.elements.billing_cycle.value=sub.billing_cycle;
 if(data.number_addon&&!billingForm.dataset.touched)billingEl('billing-number').checked=true;
 billingEl('billing-manage').hidden=!data.stripe?.has_customer;
 const notice=billingEl('billing-notice');
 if(!data.enabled){notice.hidden=false;notice.className='notice notice-info';notice.textContent='Card payment is not switched on yet. The platform confirms your payment manually.'}
 else if(sub?.status==='past_due'){notice.hidden=false;notice.className='notice notice-warn';notice.textContent='Your last payment failed. Update your card in “Manage billing” to keep your plan.'}
 else if(data.test_mode){notice.hidden=false;notice.className='notice notice-info';notice.textContent='Test mode: use card 4242 4242 4242 4242, any future date and any CVC.'}
 else notice.hidden=true;
 renderBillingPlans();
 if(buyMode()==='tools')syncBuyMode();
 const myTools=(data.my_tools||[]).filter(t=>t.status==='active');
 if(myTools.length&&!sub)billingEl('billing-summary').textContent='Active tools: '+myTools.map(t=>({website:'AI Website Builder',whatsapp:'WhatsApp Business AI',calling:'AI Calling'})[t.tool_key]||t.tool_key).join(', ');
}
async function loadBilling(){
 if(!restaurantId||!billingEl('billing'))return;const id=restaurantId;
 const [data,plans]=await Promise.all([api('/api/restaurants/'+id+'/billing'),api('/api/restaurants/'+id+'/subscription').catch(()=>({plans:[]}))]);
 if(id===restaurantId)showBilling(data,plans.plans);
 return data;
}
// Opens Plans & billing with the plan chosen during setup already in the cart.
function goToCart(planKey,cycle,message){
 if(location.hash!=='#plan')location.hash='#plan';
 const apply=()=>{
  if(cycle&&billingForm.elements.billing_cycle)billingForm.elements.billing_cycle.value=cycle;
  billingForm.dataset.touched='1';renderBillingPlans();
  const radio=planKey&&billingForm.querySelector('input[name="plan"][value="'+planKey+'"]');if(radio){radio.checked=true;renderCart()}
  if(message){const n=billingEl('billing-notice');n.hidden=false;n.className='notice notice-info';n.textContent=message}
  billingEl('billing-cart')?.scrollIntoView({behavior:'smooth',block:'start'});
 };
 if(billingPlans.length)apply();else loadBilling().then(apply).catch(()=>{});
}
// Single tools (no full plan): AI Website Builder, WhatsApp Business AI, AI Calling.
const buyMode=()=>billingForm?.elements.buy_mode?.value||'plan';
function syncBuyMode(){
 const tools=buyMode()==='tools';
 billingEl('billing-plan-step').hidden=tools;billingEl('billing-included-step').hidden=tools;billingEl('billing-tools-step').hidden=!tools;
 if(tools)renderToolCards();
}
function renderToolCards(){
 const box=billingEl('billing-tools');if(!box||!billingData?.tools)return;
 const chosen=new Set([...billingForm.querySelectorAll('input[name="tool_buy"]:checked')].map(i=>i.value));
 const owned=new Set((billingData.my_tools||[]).filter(t=>t.status==='active').map(t=>t.tool_key));
 const cycle=billingCycle();box.replaceChildren();
 for(const tool of billingData.tools){
  const label=document.createElement('label');label.className='billing-plan';
  const input=document.createElement('input');input.type='checkbox';input.name='tool_buy';input.value=tool.key;input.checked=chosen.has(tool.key);input.disabled=owned.has(tool.key);
  const name=document.createElement('strong');name.textContent=tool.name;
  const price=document.createElement('span');price.className='billing-price';price.textContent=billingMoney(tool.price_minor[cycle],tool.currency)+(cycle==='yearly'?' / year':' / month')+(tool.key==='calling'?' + number':'');
  const inc=document.createElement('small');inc.className='muted';inc.textContent=tool.includes;
  label.append(input,name,price,inc);
  if(owned.has(tool.key)){const tag=document.createElement('span');tag.className='tag tag-ok';tag.textContent='Active';label.append(tag)}
  box.append(label);
 }
 renderToolsCart();
}
function renderToolsCart(){
 const lines=billingEl('cart-lines');if(!lines||!billingData?.tools)return;
 const cycle=billingCycle(),tools=billingData.tools;
 const picked=[...billingForm.querySelectorAll('input[name="tool_buy"]:checked')].map(i=>i.value);
 const calling=tools.find(t=>t.key==='calling');
 const numberField=billingEl('tool-number-field');numberField.hidden=!picked.includes('calling');
 const newRadio=billingForm.querySelector('input[name="call_number"][value="new"]');
 const numberAvailable=Boolean(calling?.number?.available);
 newRadio.disabled=!numberAvailable;if(!numberAvailable&&newRadio.checked)billingForm.querySelector('input[name="call_number"][value="own"]').checked=true;
 billingEl('tool-number-price').textContent=numberAvailable?'· +'+billingMoney(calling.number.price_minor[cycle],calling.currency)+(cycle==='yearly'?' / year':' / month')+' (the number\'s real cost)':'· not available in your country yet';
 const hint=billingEl('tool-number-hint');hint.hidden=!calling?.number?.recommend_own;hint.textContent='Recommended: put a spare SIM or number of your own on the AI Caller. The call minutes are included; a new number from us costs much more here.';
 lines.replaceChildren();
 const line=(name,value,cls)=>{const li=document.createElement('li');if(cls)li.className=cls;const a=document.createElement('span');a.textContent=name;const b=document.createElement('span');b.textContent=value;li.append(a,b);lines.append(li)};
 let total=0;const currency=tools[0]?.currency||'USD';
 for(const key of picked){const t=tools.find(x=>x.key===key);total+=t.price_minor[cycle];line(t.name+' ('+cycle+')',billingMoney(t.price_minor[cycle],t.currency),'cart-plan')}
 const wantsNew=picked.includes('calling')&&newRadio.checked&&numberAvailable;
 if(picked.includes('calling'))line(wantsNew?'Dedicated AI phone number':'Your own number',wantsNew?billingMoney(calling.number.price_minor[cycle],currency):'No fee','cart-tool');
 if(wantsNew)total+=calling.number.price_minor[cycle];
 if(!picked.length)line('No tool selected yet','—','cart-tool cart-empty');
 billingEl('cart-total').textContent=picked.length?billingMoney(total,currency):'—';
 billingEl('cart-renews').textContent=picked.length?(cycle==='yearly'?'Billed every year':'Billed every month')+'. Price in '+currency+(tools[0]?.converted?' (converted from USD at today’s rate)':'')+(picked.includes('calling')?'. Extra call minutes: '+billingMoney(calling.extra_minute_minor,currency)+' each.':'.'):'';
 const pay=billingEl('billing-pay');pay.disabled=!billingData.enabled||!picked.length;pay.textContent=picked.length?'Checkout & pay '+billingMoney(total,currency):'Choose a tool';
}
function goToTools(toolKey,message){
 if(location.hash!=='#plan')location.hash='#plan';
 const apply=()=>{billingForm.elements.buy_mode.value='tools';billingForm.dataset.touched='1';syncBuyMode();const box=billingForm.querySelector('input[name="tool_buy"][value="'+toolKey+'"]');if(box&&!box.disabled){box.checked=true;renderToolsCart()}
  if(message){const n=billingEl('billing-notice');n.hidden=false;n.className='notice notice-info';n.textContent=message}
  billingEl('billing-cart')?.scrollIntoView({behavior:'smooth',block:'start'})};
 if(billingData?.tools)apply();else loadBilling().then(apply).catch(()=>{});
}
billingForm?.addEventListener('change',event=>{billingForm.dataset.touched='1';if(event.target.name==='buy_mode'){syncBuyMode();renderCart();return}if(event.target.name==='billing_cycle'){renderBillingPlans();if(buyMode()==='tools')renderToolCards();}else renderCart()});
billingForm?.addEventListener('submit',async event=>{
 event.preventDefault();const note=billingEl('billing-note'),button=billingEl('billing-pay');
 if(buyMode()==='tools'){
  const tools=[...billingForm.querySelectorAll('input[name="tool_buy"]:checked')].map(i=>i.value);
  if(!tools.length){note.textContent='Choose a tool.';return}
  button.disabled=true;note.textContent='Opening secure payment…';
  try{const data=await api('/api/restaurants/'+restaurantId+'/billing/tools-checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tools,billing_cycle:billingCycle(),call_number:billingForm.querySelector('input[name="call_number"]:checked')?.value||'own'})});note.textContent='Redirecting to Stripe…';location.assign(data.url)}
  catch(e){note.textContent=e.message;button.disabled=false}
  return;
 }
 const plan=billingPlan();if(!plan){note.textContent='Choose a plan.';return}
 const tools=[...billingForm.querySelectorAll('input[name="tool"]:checked')].map(i=>i.value);
 if(!tools.length){note.textContent='Choose at least one tool.';return}
 button.disabled=true;note.textContent='Opening secure payment…';
 try{
  const data=await api('/api/restaurants/'+restaurantId+'/billing/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({plan:plan.key,billing_cycle:billingCycle(),tools,dedicated_number:billingEl('billing-number').checked&&!plan.dedicated_number?.included})});
  note.textContent='Redirecting to Stripe…';location.assign(data.url);
 }catch(e){note.textContent=e.message;button.disabled=false}
});
billingEl('billing-manage')?.addEventListener('click',async()=>{const note=billingEl('billing-note');note.textContent='Opening billing…';try{const data=await api('/api/restaurants/'+restaurantId+'/billing/portal',{method:'POST'});location.assign(data.url)}catch(e){note.textContent=e.message}});
(function billingReturn(){
 const result=new URLSearchParams(location.search).get('billing');if(!result)return;
 history.replaceState(null,'',location.pathname+location.hash);
 const wait=async tries=>{
  if(!restaurantId){if(tries<20)setTimeout(()=>wait(tries+1),500);return}
  const notice=billingEl('billing-notice');
  if(result==='cancelled'){await loadBilling().catch(()=>{});notice.hidden=false;notice.className='notice notice-info';notice.textContent='Payment cancelled. Nothing was charged.';return}
  const data=await loadBilling().catch(()=>null);
  if(data?.subscription?.status==='active'&&data.stripe?.has_customer){
   notice.hidden=false;notice.className='notice notice-ok';notice.textContent='Payment received. Your plan is active.';
   let next=null;try{next=localStorage.getItem('mar-khoor.after-pay.'+restaurantId);localStorage.removeItem('mar-khoor.after-pay.'+restaurantId)}catch{}
   if(next==='website'){notice.textContent+=' Opening your AI Website Builder…';setTimeout(()=>{location.hash='#website';loadSite().catch(()=>{});siteStatus.textContent='Your plan is active. Describe your restaurant and press “Write with AI”, then Save and Publish.';document.querySelector('#site-description')?.focus()},2500)}
   return}
  notice.hidden=false;notice.className='notice notice-info';notice.textContent='Payment received. Activating your plan…';
  if(tries<40)setTimeout(()=>wait(tries+1),3000);
 };
 setTimeout(()=>wait(0),800);
})();
window.addEventListener('hashchange',()=>{if(location.hash==='#plan')loadBilling().catch(()=>{});});
if(location.hash==='#plan')setTimeout(()=>loadBilling().catch(()=>{}),1500);

// Payment methods customers can use (cash, card on delivery, bank / wallet transfers).
const payEl = id => document.getElementById(id);
var payLoadedFor = null;
function payTransferRow(t = {}) {
 const row = document.createElement('div'); row.className = 'pay-transfer-row';
 row.dataset.id = t.id || '';
 const field = (labelText, el, wide) => { const l = document.createElement('label'); l.className = 'field' + (wide ? ' pay-wide' : ''); const span = document.createElement('span'); span.textContent = labelText; l.append(span, el); return l; };
 const input = (key, max, placeholder) => { const el = document.createElement('input'); el.className = 'input'; el.dataset.f = key; el.maxLength = max; if (placeholder) el.placeholder = placeholder; return el; };
 const select = document.createElement('select'); select.className = 'input'; select.dataset.f = 'type';
 for (const [value, text] of [['bank','Bank transfer'],['jazzcash','JazzCash'],['easypaisa','Easypaisa'],['raast','Raast'],['other','Other']]) { const o = document.createElement('option'); o.value = value; o.textContent = text; select.append(o); }
 const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'btn btn-ghost btn-sm'; remove.dataset.remove = ''; remove.textContent = 'Remove';
 const title = input('account_title', 80); title.required = true;
 const number = input('account_number', 40); number.required = true;
 row.append(field('Type', select), field('Name shown to customers', input('label', 60, 'e.g. Meezan Bank')), field('Account title', title), field('Account / IBAN / mobile number', number), field('Note for customers (optional)', input('instructions', 200, 'e.g. Write your order number in the payment note'), true), remove);
 for (const key of ['type','label','account_title','account_number','instructions']) if (t[key]) row.querySelector('[data-f="'+key+'"]').value = t[key];
 row.querySelector('[data-remove]').addEventListener('click', () => row.remove());
 return row;
}
function showPaySettings(data) {
 const s = data.settings;
 payEl('pay-cash').checked = s.cash; payEl('pay-card').checked = s.card_on_delivery;
 const list = payEl('pay-transfers'); list.replaceChildren(...s.transfers.map(payTransferRow));
 payEl('pay-preview').textContent = 'Customers see: ' + data.preview.map(o => o.label).join(' · ');
}
async function loadPaySettings() { if (!restaurantId || !payEl('pay-form')) return; const id = restaurantId; const data = await api('/api/restaurants/' + id + '/payment-settings'); if (id === restaurantId) showPaySettings(data); }
payEl('pay-add')?.addEventListener('click', () => { if (payEl('pay-transfers').children.length < 5) payEl('pay-transfers').append(payTransferRow()); });
payEl('pay-form')?.addEventListener('submit', async event => {
 event.preventDefault(); const note = payEl('pay-note'); note.textContent = 'Saving…';
 const transfers = [...payEl('pay-transfers').children].map(row => Object.fromEntries([['id', row.dataset.id], ...[...row.querySelectorAll('[data-f]')].map(el => [el.dataset.f, el.value])]));
 try { const data = await api('/api/restaurants/' + restaurantId + '/payment-settings', {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({cash:payEl('pay-cash').checked, card_on_delivery:payEl('pay-card').checked, transfers})}); showPaySettings(data); note.textContent = 'Saved. Customers see these options at checkout now.'; }
 catch (error) { note.textContent = error.message; }
});
window.addEventListener('hashchange', () => { if (location.hash === '#order-desk' && payLoadedFor !== restaurantId) { payLoadedFor = restaurantId; loadPaySettings().catch(() => {}); } });
setTimeout(() => { if (location.hash === '#order-desk') { payLoadedFor = restaurantId; loadPaySettings().catch(() => {}); } }, 1500);

// A visitor who picked a single tool on the landing page lands in the cart with it.
(function wantTool(tries){
 let want=null;try{want=localStorage.getItem('mar-khoor.want-tool')}catch{}
 if(!want||!['website','whatsapp','calling'].includes(want))return;
 if(!restaurantId){if(tries<300)setTimeout(()=>wantTool(tries+1),1000);return}
 try{localStorage.removeItem('mar-khoor.want-tool');localStorage.setItem('mar-khoor.setup-prompted.'+restaurantId,'1')}catch{}
 setTimeout(()=>{if(setupDialog?.open)setupDialog.close();goToTools(want,'Your tool is in the cart. Pay to switch it on.')},1200);
})(0);

// Publishing (and a custom domain going live) needs a paid plan or the AI Website Builder tool.
const planRequired=document.getElementById('plan-required-dialog');
async function showPlanRequired(){
 if(!planRequired)return;
 const list=document.getElementById('plan-required-plans');list.replaceChildren();
 try{
  const data=billingData&&billingPlans.length?{plans:billingPlans,tools:billingData.tools}:await (async()=>{const [b,p]=await Promise.all([api('/api/restaurants/'+restaurantId+'/billing'),api('/api/restaurants/'+restaurantId+'/subscription')]);billingData=b;billingPlans=p.plans||[];return {plans:billingPlans,tools:b.tools}})();
  for(const plan of data.plans){
   const li=document.createElement('li');const name=document.createElement('strong');name.textContent=plan.name;
   const price=document.createElement('span');price.textContent=plan.price_minor?.monthly==null?'Price on request':billingMoney(plan.price_minor.monthly,plan.currency)+' / month';
   const b=document.createElement('button');b.type='button';b.className='btn btn-sm '+(plan.key==='starter'?'btn-primary':'btn-ghost');b.textContent='Choose '+plan.name;
   b.addEventListener('click',()=>{planRequired.close();try{localStorage.setItem('mar-khoor.after-pay.'+restaurantId,'website')}catch{};goToCart(plan.key,'monthly','Pay for your plan: your website goes live right after.')});
   li.append(name,price,b);list.append(li);
  }
  const site=(data.tools||[]).find(t=>t.key==='website');
  const only=document.getElementById('plan-required-tool');
  only.hidden=!site;if(site)only.textContent='Only the AI Website Builder ('+billingMoney(site.price_minor.monthly,site.currency)+' / month)';
 }catch(error){console.warn('plan dialog',error?.message)}
 planRequired.showModal();
}
document.getElementById('plan-required-tool')?.addEventListener('click',()=>{planRequired.close();try{localStorage.setItem('mar-khoor.after-pay.'+restaurantId,'website')}catch{};goToTools('website','Pay for the AI Website Builder: your website goes live right after.')});
document.getElementById('plan-required-close')?.addEventListener('click',()=>planRequired.close());
