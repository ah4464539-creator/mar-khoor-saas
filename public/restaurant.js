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
 for(const item of menu.items){const p=document.createElement('p'),button=document.createElement('button');p.textContent=item.name+' — '+(item.price_minor/100).toFixed(2)+' · '+(item.active?'Active':'Hidden')+' ';button.textContent=item.active?'Hide':'Show';button.addEventListener('click',async()=>{try{await api('/api/restaurants/'+restaurantId+'/menu/'+item.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({...item,active:!item.active})});await refresh()}catch(e){status.textContent=e.message}});p.append(button);items.append(p)}
 const list=document.querySelector('#orders');list.replaceChildren();
 for(const order of orders.orders){const p=document.createElement('p');p.textContent='#'+order.id+' · '+(order.customer_name||'Customer')+' · '+order.status+' · '+(order.total_minor/100).toFixed(2)+' ';const transitions={pending:['accepted','cancelled'],accepted:['preparing','cancelled'],preparing:['ready'],ready:['completed']};for(const next of transitions[order.status]||[]){const btn=document.createElement('button');btn.textContent=next;btn.addEventListener('click',async()=>{try{await api('/api/restaurants/'+restaurantId+'/orders/'+order.id+'/status',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:next})});await refresh();status.textContent='Order #'+order.id+' updated'}catch(e){status.textContent=e.message}});p.append(btn)}list.append(p)}
}
form.addEventListener('submit',async e=>{e.preventDefault();status.textContent='Signing in…';try{
 const response=await fetch('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.querySelector('#email').value,password:document.querySelector('#password').value})});
 const data=await response.json();if(!response.ok)throw Error(data.error||'Login failed');token=data.token;
 const result=await api('/api/my/restaurants');target.replaceChildren();
 for(const restaurant of result.restaurants){const button=document.createElement('button');button.textContent=restaurant.name+' · '+restaurant.role;button.addEventListener('click',async()=>{restaurantId=restaurant.id;restaurantCurrency=restaurant.currency;document.querySelector('#management').hidden=false;try{await refresh();status.textContent='Loaded '+restaurant.name}catch(e){status.textContent=e.message}});target.append(button)}
 if(!result.restaurants.length)target.textContent='No restaurants assigned.';status.textContent='Account loaded.';
}catch(err){status.textContent=err.message}});
document.querySelector('#add-item').addEventListener('submit',async e=>{e.preventDefault();if(!restaurantId)return;try{
 const name=document.querySelector('#item-name').value,amount=Number(document.querySelector('#item-price').value),price_minor=Math.round(amount*100);
 if(!Number.isFinite(amount)||amount<0||!Number.isSafeInteger(price_minor))throw Error('Invalid price');
 await api('/api/restaurants/'+restaurantId+'/menu',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,description:'',price_minor})});e.target.reset();await refresh();status.textContent='Menu item added.'
}catch(err){status.textContent=err.message}});

document.querySelector('#whatsapp-ai-enabled').addEventListener('change',async e=>{if(!restaurantId)return;const enabled=e.target.checked;e.target.disabled=true;try{await api('/api/restaurants/'+restaurantId+'/whatsapp/ai-settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled})});status.textContent='WhatsApp AI '+(enabled?'enabled':'disabled')}catch(err){e.target.checked=!enabled;status.textContent=err.message}finally{e.target.disabled=false}});

// My plan: services, optional dedicated number, and the restaurant's own orders.
const usd=cents=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
const planForm=document.querySelector('#plan-form'),planStatus=document.querySelector('#plan-status'),planOrders=document.querySelector('#plan-orders'),planNumber=document.querySelector('#plan-number');
planForm.addEventListener('change',()=>{planNumber.hidden=!planForm.querySelector('input[value="voice"]').checked});
async function loadPlanOrders(){
 if(!restaurantId)return;
 const data=await api('/api/restaurants/'+restaurantId+'/plan-orders');
 planOrders.replaceChildren();
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
 if(data.slug)siteSlug=data.slug;
 if(typeof data.published==='boolean')sitePublished=data.published;
 sitePublish.textContent=sitePublished?'Unpublish':'Publish';
 siteLink.replaceChildren();
 if(sitePublished&&siteSlug){const a=document.createElement('a');a.href='/r/'+siteSlug;a.textContent='mar-khoor.com/r/'+siteSlug;a.target='_blank';a.rel='noopener';siteLink.append('Live at ',a)}
}
async function loadSite(){if(!restaurantId)return;showSite(await api('/api/restaurants/'+restaurantId+'/site'))}
const siteConfig=()=>({headline:siteField('headline').value,tagline:siteField('tagline').value,about:siteField('about').value,hours:siteField('hours').value,phone:siteField('phone').value,address:siteField('address').value,theme:siteField('theme').value,sections:siteSections});
const siteJson={'Content-Type':'application/json'};
document.querySelector('#site-generate').addEventListener('click',async e=>{
 if(!restaurantId){siteStatus.textContent='Select your restaurant first.';return}
 e.currentTarget.disabled=true;siteStatus.textContent='Writing…';
 try{const data=await api('/api/restaurants/'+restaurantId+'/site/generate',{method:'POST',headers:siteJson,body:JSON.stringify({description:siteField('description').value})});showSite(data);siteStatus.textContent=data.source==='ai'?'Draft written by AI and saved. Edit anything you like.':'AI is not available, so a basic draft was saved. Edit it below.'}
 catch(error){siteStatus.textContent=error.message}finally{e.currentTarget.disabled=false}
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
