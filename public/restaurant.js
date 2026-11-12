const form=document.querySelector('#login'),status=document.querySelector('#status'),target=document.querySelector('#restaurants');
let token='',restaurantId=null;
const api=async(path,options={})=>{const r=await fetch(path,{...options,headers:{...options.headers,Authorization:'Bearer '+token}});const data=await r.json();if(!r.ok)throw Error(data.error||'Request failed');return data};
async function refresh(){
 const [menu,orders]=await Promise.all([api('/api/restaurants/'+restaurantId+'/menu'),api('/api/restaurants/'+restaurantId+'/orders')]);
 const items=document.querySelector('#items');items.replaceChildren();
 for(const item of menu.items){const p=document.createElement('p'),button=document.createElement('button');p.textContent=item.name+' — '+(item.price_minor/100).toFixed(2)+' · '+(item.active?'Active':'Hidden')+' ';button.textContent=item.active?'Hide':'Show';button.addEventListener('click',async()=>{try{await api('/api/restaurants/'+restaurantId+'/menu/'+item.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({...item,active:!item.active})});await refresh()}catch(e){status.textContent=e.message}});p.append(button);items.append(p)}
 const list=document.querySelector('#orders');list.replaceChildren();
 for(const order of orders.orders){const p=document.createElement('p');p.textContent='#'+order.id+' · '+(order.customer_name||'Customer')+' · '+order.status+' · '+(order.total_minor/100).toFixed(2)+' ';const transitions={pending:['accepted','cancelled'],accepted:['preparing','cancelled'],preparing:['ready'],ready:['completed']};for(const next of transitions[order.status]||[]){const btn=document.createElement('button');btn.textContent=next;btn.addEventListener('click',async()=>{try{await api('/api/restaurants/'+restaurantId+'/orders/'+order.id+'/status',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:next})});await refresh();status.textContent='Order #'+order.id+' updated'}catch(e){status.textContent=e.message}});p.append(btn)}list.append(p)}
}
form.addEventListener('submit',async e=>{e.preventDefault();status.textContent='Signing in…';try{
 const response=await fetch('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.querySelector('#email').value,password:document.querySelector('#password').value})});
 const data=await response.json();if(!response.ok)throw Error(data.error||'Login failed');token=data.token;
 const result=await api('/api/my/restaurants');target.replaceChildren();
 for(const restaurant of result.restaurants){const button=document.createElement('button');button.textContent=restaurant.name+' · '+restaurant.role;button.addEventListener('click',async()=>{restaurantId=restaurant.id;document.querySelector('#management').hidden=false;try{await refresh();status.textContent='Loaded '+restaurant.name}catch(e){status.textContent=e.message}});target.append(button)}
 if(!result.restaurants.length)target.textContent='No restaurants assigned.';status.textContent='Account loaded.';
}catch(err){status.textContent=err.message}});
document.querySelector('#add-item').addEventListener('submit',async e=>{e.preventDefault();if(!restaurantId)return;try{
 const name=document.querySelector('#item-name').value,amount=Number(document.querySelector('#item-price').value),price_minor=Math.round(amount*100);
 if(!Number.isFinite(amount)||amount<0||!Number.isSafeInteger(price_minor))throw Error('Invalid price');
 await api('/api/restaurants/'+restaurantId+'/menu',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,description:'',price_minor})});e.target.reset();await refresh();status.textContent='Menu item added.'
}catch(err){status.textContent=err.message}});
