const form=document.querySelector('#login'),status=document.querySelector('#status'),target=document.querySelector('#restaurants');
let token='',restaurantId=null,restaurantCurrency='';
let refreshing=false;
setInterval(async()=>{if(!restaurantId||!token||document.hidden||refreshing)return;refreshing=true;try{await refresh()}catch(e){status.textContent='Auto-refresh: '+e.message}finally{refreshing=false}},15000);
const api=async(path,options={})=>{const r=await fetch(path,{...options,headers:{...options.headers,Authorization:'Bearer '+token}});const data=await r.json();if(!r.ok)throw Error(data.error||'Request failed');return data};
async function refresh(){
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
  ['▤', 'Total orders', summary.total_orders],
  ['◷', 'Pending orders', summary.pending_orders],
  ['✓', 'Completed orders', summary.completed_orders],
  ['▥', 'Completed revenue', revenue],
 ];
 const analyticsPanel = document.querySelector('#analytics');
 analyticsPanel.replaceChildren(...metrics.map(([symbol, label, value]) => {
  const card = document.createElement('article');
  const icon = document.createElement('span');
  icon.className = 'metric-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = symbol;
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
 const voiceByRestaurant=new Map((data.voiceOnboarding||[]).map(entry=>[String(entry.restaurant_id),entry]));
 const voiceStatus=document.querySelector('#voice-line-status');
 voiceStatus.textContent='';
 function showVoiceStatus(restaurant){
  const entry=voiceByRestaurant.get(String(restaurant.id));
  const messages={assigned:'AI ordering number: '+(entry?.phone??''),awaiting_local_number:'Waiting for a local AI ordering number.',temporarily_unavailable:'AI number status is temporarily unavailable.'};
  voiceStatus.textContent=messages[entry?.status]??'';
 }
 if(result.restaurants.length===1)showVoiceStatus(result.restaurants[0]);
 for(const restaurant of result.restaurants){const button=document.createElement('button');button.textContent=restaurant.name+' · '+restaurant.role;button.addEventListener('click',async()=>{showVoiceStatus(restaurant);restaurantId=restaurant.id;void loadChatProfile(restaurant.id);restaurantCurrency=restaurant.currency;document.querySelector('#management').hidden=false;try{await refresh();status.textContent='Loaded '+restaurant.name}catch(e){status.textContent=e.message}});target.append(button)}
 if(!result.restaurants.length)target.textContent='No restaurants assigned.';status.textContent='Account loaded.';
}catch(err){status.textContent=err.message}});
document.querySelector('#add-item').addEventListener('submit',async e=>{e.preventDefault();if(!restaurantId)return;try{
 const name=document.querySelector('#item-name').value,amount=Number(document.querySelector('#item-price').value),price_minor=Math.round(amount*100);
 if(!Number.isFinite(amount)||amount<0||!Number.isSafeInteger(price_minor))throw Error('Invalid price');
 await api('/api/restaurants/'+restaurantId+'/menu',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,description:'',price_minor})});e.target.reset();await refresh();status.textContent='Menu item added.'
}catch(err){status.textContent=err.message}});

document.querySelector('#whatsapp-ai-enabled').addEventListener('change',async e=>{if(!restaurantId)return;const enabled=e.target.checked;e.target.disabled=true;try{await api('/api/restaurants/'+restaurantId+'/whatsapp/ai-settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled})});status.textContent='WhatsApp AI '+(enabled?'enabled':'disabled')}catch(err){e.target.checked=!enabled;status.textContent=err.message}finally{e.target.disabled=false}});

const chatProfileForm=document.querySelector('#chat-profile-form');
const chatProfileStatus=document.querySelector('#chat-profile-status');
async function loadChatProfile(id){
 chatProfileForm.hidden=true;
 chatProfileStatus.textContent='Loading assistant settings…';
 try{
  const profile=await api('/api/restaurants/'+id+'/chat-profile');
  if(id!==restaurantId)return;
  chatProfileForm.elements.display_name.value=profile.display_name;
  chatProfileForm.elements.greeting.value=profile.greeting;
  chatProfileForm.elements.web_enabled.checked=profile.web_enabled;
  chatProfileForm.hidden=false;
  chatProfileStatus.textContent='';
 }catch(error){
  if(id===restaurantId)chatProfileStatus.textContent=error.message;
 }
}
chatProfileForm.addEventListener('submit',async event=>{
 event.preventDefault();
 const id=restaurantId;
 const data=new FormData(chatProfileForm);
 const button=chatProfileForm.querySelector('button');
 button.disabled=true;
 try{
  await api('/api/restaurants/'+id+'/chat-profile',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({
   display_name:data.get('display_name'),greeting:data.get('greeting'),web_enabled:data.has('web_enabled')
  })});
  if(id===restaurantId)chatProfileStatus.textContent='Assistant saved.';
 }catch(error){
  if(id===restaurantId)chatProfileStatus.textContent=error.message;
 }finally{button.disabled=false;}
});
