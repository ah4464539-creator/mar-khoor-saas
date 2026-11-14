const form=document.querySelector('#lookup'),status=document.querySelector('#status'),target=document.querySelector('#menu'),cart=new Map();
let restaurant=null;
const storeName = document.querySelector('#store-name');
const cartSubtotal = document.querySelector('#cart-subtotal');
function renderCart(){const root=document.querySelector('#cart');root.replaceChildren();for(const item of cart.values()){const row=document.createElement('p'),remove=document.createElement('button');row.textContent=item.name+' × '+item.quantity+' ';remove.textContent='Remove';remove.addEventListener('click',()=>{cart.delete(item.id);renderCart()});row.append(remove);root.append(row)}document.querySelector('#checkout').hidden=!cart.size;
  if (restaurant && cart.size) {
    const subtotal = [...cart.values()].reduce((sum, item) => sum + item.price_minor * item.quantity, 0);
    cartSubtotal.textContent = new Intl.NumberFormat(undefined, { style: 'currency', currency: restaurant.currency }).format(subtotal / 100);
  }
}
form.addEventListener('submit',async e=>{e.preventDefault();target.replaceChildren();storeName.textContent='Discover the menu';menuSearch.value='';menuSearchLabel.hidden=true;document.querySelector('#order-status').textContent='';cart.clear();renderCart();status.textContent='Loading menu…';try{const slug=document.querySelector('#slug').value.trim();const r=await fetch('/api/public/restaurants/'+encodeURIComponent(slug)+'/menu');const data=await r.json();if(!r.ok)throw Error(data.error||'Menu unavailable');restaurant=data.restaurant;storeName.textContent=restaurant.name;for(const item of data.items){const card=document.createElement('article'),title=document.createElement('h3'),desc=document.createElement('p'),price=document.createElement('strong'),add=document.createElement('button');title.textContent=item.name;desc.textContent=item.description||'';price.textContent=new Intl.NumberFormat(undefined,{style:'currency',currency:data.restaurant.currency}).format(item.price_minor/100);add.textContent='Add to order';add.addEventListener('click',()=>{const existing=cart.get(item.id);if(existing&&existing.quantity>=99)return;cart.set(item.id,{...item,quantity:(existing?.quantity||0)+1});renderCart()});card.append(title,desc,price,add);target.append(card)}menuSearchLabel.hidden=!data.items.length;status.textContent=data.restaurant.name+' · '+data.items.length+' available items';if(!data.items.length)target.textContent='No menu items yet.'}catch(err){restaurant=null;status.textContent=err.message}});
document.querySelector('#order-form').addEventListener('submit',async e=>{e.preventDefault();const output=document.querySelector('#order-status');if(!restaurant||!cart.size)return;const submit=e.currentTarget.querySelector('button');submit.disabled=true;output.textContent='Placing order…';try{const r=await fetch('/api/public/restaurants/'+encodeURIComponent(restaurant.slug)+'/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({customer_name:document.querySelector('#customer-name').value,items:[...cart.values()].map(i=>({menu_item_id:i.id,quantity:i.quantity}))})});const data=await r.json();if(!r.ok)throw Error(data.error||'Order failed');output.textContent='Order #'+data.order_id+' received. Status: '+data.status+'. ';if(data.tracking_token){const link=document.createElement('a');link.href='/track.html#id='+data.order_id+'&t='+data.tracking_token;link.textContent='Track your order';output.append(link)}cart.clear();renderCart();}catch(err){output.textContent=err.message}finally{submit.disabled=false}});

const menuSearch = document.querySelector('#menu-search');
const menuSearchLabel = document.querySelector('#search-label');
menuSearch.addEventListener('input', () => {
  const query = menuSearch.value.trim().toLocaleLowerCase();
  let matches = 0;
  for (const card of target.querySelectorAll('article')) {
    const text = [...card.querySelectorAll('h3, p')].map(node => node.textContent).join(' ');
    card.hidden = !text.toLocaleLowerCase().includes(query);
    if (!card.hidden) matches++;
  }
  status.textContent = matches ? restaurant.name + ' · ' + matches + ' matching items' : 'No items match your search.';
});

const preset = new URLSearchParams(location.search).get('restaurant');
if (preset && /^[a-z0-9-]{1,160}$/.test(preset)) { document.querySelector('#slug').value = preset; form.requestSubmit(); }
