import { rememberOrder, savedOrders, trackingLink } from './order-history.js';
const status=document.querySelector('#status'),target=document.querySelector('#menu'),cart=new Map();
let restaurant=null;
const storeName = document.querySelector('#store-name');
const cartSubtotal = document.querySelector('#cart-subtotal');
function renderCart(){const root=document.querySelector('#cart');root.replaceChildren();for(const item of cart.values()){const row=document.createElement('p'),remove=document.createElement('button');row.textContent=item.name+' × '+item.quantity+' ';remove.textContent='Remove';remove.addEventListener('click',()=>{cart.delete(item.id);renderCart()});row.append(remove);root.append(row)}document.querySelector('#checkout').hidden=!cart.size;
  if (restaurant && cart.size) {
    const subtotal = [...cart.values()].reduce((sum, item) => sum + item.price_minor * item.quantity, 0);
    cartSubtotal.textContent = new Intl.NumberFormat(undefined, { style: 'currency', currency: restaurant.currency }).format(subtotal / 100);
  }
}
function updateOrderLinks(slug) {
  const base = '/orders.html?restaurant=' + encodeURIComponent(slug);
  const latest = savedOrders().find(order => order.slug === slug);
  document.querySelector('#customer-track').href = latest ? trackingLink(latest) : base + '#orders';
  document.querySelector('#customer-orders').href = base + '#orders';
  document.querySelector('#customer-refunds').href = base + '#refunds';
}

async function loadMenu(slug) {
  const slugPath = encodeURIComponent(slug);
  updateOrderLinks(slug);
  status.textContent = 'Loading menu…';
  try {
    const response = await fetch('/api/public/restaurants/' + slugPath + '/menu');
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'Menu unavailable');
    restaurant = data.restaurant;
    storeName.textContent = restaurant.name.toUpperCase();
    document.title = storeName.textContent;
    const currency = new Intl.NumberFormat(undefined, { style: 'currency', currency: restaurant.currency });
    for (const item of data.items) {
      const card = document.createElement('article');
      const title = document.createElement('h3');
      const description = document.createElement('p');
      const price = document.createElement('strong');
      const add = document.createElement('button');
      title.textContent = item.name;
      description.textContent = item.description || '';
      price.textContent = currency.format(item.price_minor / 100);
      add.textContent = 'Add to order';
      add.addEventListener('click', () => {
        const quantity = cart.get(item.id)?.quantity || 0;
        if (quantity >= 99) return;
        cart.set(item.id, { ...item, quantity: quantity + 1 });
        renderCart();
      });
      card.append(title, description, price, add);
      target.append(card);
    }
    menuSearchLabel.hidden = !data.items.length;
    status.textContent = data.items.length
      ? data.items.length + (data.items.length === 1 ? ' available item' : ' available items')
      : 'No menu items yet.';
  } catch (error) {
    status.textContent = error.message;
  }
}
document.querySelector('#order-form').addEventListener('submit',async e=>{e.preventDefault();const output=document.querySelector('#order-status');if(!restaurant||!cart.size)return;const orderedFrom=restaurant;const submit=e.currentTarget.querySelector('button');submit.disabled=true;output.textContent='Placing order…';try{const r=await fetch('/api/public/restaurants/'+encodeURIComponent(orderedFrom.slug)+'/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({customer_name:document.querySelector('#customer-name').value,items:[...cart.values()].map(i=>({menu_item_id:i.id,quantity:i.quantity}))})});const data=await r.json();if(!r.ok)throw Error(data.error||'Order failed');output.textContent='Order #'+data.order_id+' received. Status: '+data.status+'. ';if(data.tracking_token){const link=document.createElement('a');const saved={id:data.order_id,token:data.tracking_token,restaurant:orderedFrom.name,slug:orderedFrom.slug,currency:orderedFrom.currency,totalMinor:data.total_minor,placedAt:new Date().toISOString()};rememberOrder(saved);updateOrderLinks(orderedFrom.slug);link.href=trackingLink(saved);link.textContent='Track your order';output.append(link)}cart.clear();renderCart();}catch(err){output.textContent=err.message}finally{submit.disabled=false}});

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
  status.textContent = matches ? matches + ' matching items' : 'No items match your search.';
});

const preset = new URLSearchParams(location.search).get('restaurant');
if (preset && /^[a-z0-9-]{1,160}$/.test(preset)) loadMenu(preset);
else status.textContent = 'Open the menu from your restaurant’s website.';
