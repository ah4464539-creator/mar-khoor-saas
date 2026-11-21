// Isolated Mar-Khoor Super Admin V2. Original /super-admin remains unchanged.
// Preview data is always explicitly marked and never mixed into authenticated results.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const demoMode = location.protocol === 'file:' || new URLSearchParams(location.search).get('preview') === '1';
  const titles = { overview:'Platform Overview',restaurants:'Restaurant Directory',orders:'Live Order Monitor',voice:'AI Call Center',whatsapp:'WhatsApp Activity',websites:'Website Builder',billing:'Billing & Revenue',system:'System Health' };
  let token = '', snapshot = null, refreshTimer = null, requestRunning = false;
  const themeKey = 'mk-super-admin-v2-theme';
  function text(id, value) { const el = $(id); if (el) el.textContent = String(value ?? '—'); }
  function num(value) { return new Intl.NumberFormat('en').format(Number(value) || 0); }
  function date(value) { const x = new Date(value); return Number.isNaN(x.getTime()) ? '—' : x.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }); }
  function money(minor, currency) {
    try {
      const digits = new Intl.NumberFormat('en', { style:'currency', currency }).resolvedOptions().maximumFractionDigits;
      return new Intl.NumberFormat('en', { style:'currency', currency, maximumFractionDigits:digits }).format((Number(minor)||0)/10**digits);
    } catch { return String(currency||'') + ' ' + String(minor||0) + ' minor units'; }
  }
  function theme(value) {
    const selected = value === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = selected;
    $('theme-toggle').querySelector('use')?.setAttribute('href', selected === 'dark' ? '#ic-sun' : '#ic-moon');
    $('theme-toggle').title = selected === 'dark' ? 'Switch to light' : 'Switch to dark';
    try { localStorage.setItem(themeKey,selected); } catch {}
  }
  let saved = 'light';
  try { saved = localStorage.getItem(themeKey) || 'light'; } catch {}
  theme(saved);
  $('theme-toggle').addEventListener('click', () => theme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  const navLinks = [...document.querySelectorAll('[data-view]')];
  function mobileOpen(open) {
    $('sidebar').classList.toggle('open', open);
    $('mobile-shade').hidden = !open;
  }
  $('menu-toggle').addEventListener('click', () => mobileOpen(true));
  $('mob-close').addEventListener('click', () => mobileOpen(false));
  $('mobile-shade').addEventListener('click', () => mobileOpen(false));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') mobileOpen(false); });
  function view(name) {
    if (!(name in titles)) name = 'overview';
    document.querySelectorAll('[data-view-section]').forEach(el => el.classList.toggle('active',el.dataset.viewSection===name));
    navLinks.forEach(el => {
      const active = el.dataset.view === name;
      el.classList.toggle('active',active);
      if (active) el.setAttribute('aria-current','page'); else el.removeAttribute('aria-current');
    });
    text('page-title',titles[name]);text('crumb-name',titles[name].replace('Platform ',''));
    mobileOpen(false);
    if (name === 'system') health();
    window.scrollTo({ top:0, behavior:'instant' });
  }
  navLinks.forEach(el => el.addEventListener('click', event => {
    event.preventDefault();
    const next=el.dataset.view;
    history.replaceState(null,'','#'+next);
    view(next);
  }));
  document.querySelectorAll('[data-jump]').forEach(el => el.addEventListener('click', () => {
    const next=el.dataset.jump;history.replaceState(null,'','#'+next);view(next);
  }));
  window.addEventListener('hashchange',()=>view(location.hash.slice(1)));
  function setState(label, ok) {
    const pill=$('mode-pill');pill.classList.toggle('off',!ok);
    pill.replaceChildren();
    const dot=document.createElement('i'),caption=document.createTextNode(label);
    pill.append(dot,caption);
  }
  function showNotice(message) { const el=$('notice');el.textContent=message;el.hidden=!message; }
  function td(row,value,small=false) {
    const cell=document.createElement('td');
    if (small) { const sub=document.createElement('small');sub.textContent=String(value??'—');cell.append(sub); }
    else cell.textContent=String(value??'—');
    row.append(cell);return cell;
  }
  function emptyTable(root,colspan=5) {
    root.replaceChildren();
    const row=document.createElement('tr'),cell=document.createElement('td');
    cell.colSpan=colspan;cell.textContent='No records in the database for this view.';row.append(cell);root.append(row);
  }
  function populateOrders(rootId,rows) {
    const root=$(rootId);
    if (!rows?.length) { emptyTable(root);return; }
    root.replaceChildren(...rows.map(o=>{
      const tr=document.createElement('tr');
      td(tr,'#'+o.id);td(tr,o.restaurant_name);td(tr,money(o.total_minor,o.currency));
      const state=td(tr,'');const pill=document.createElement('span');
      pill.className='status-tag '+String(o.status||'').toLowerCase();pill.textContent=o.status||'Unknown';state.append(pill);
      td(tr,date(o.created_at),true);
      return tr;
    }));
  }
  function populateRestaurants(rows,filter='') {
    const root=$('restaurant-table');
    const filtered=(rows||[]).filter(r=>(r.name+' '+r.slug+' '+r.country_code).toLowerCase().includes(filter.toLowerCase()));
    if (!filtered.length) { emptyTable(root);return; }
    root.replaceChildren(...filtered.map(r=>{
      const tr=document.createElement('tr');
      td(tr,r.name);td(tr,r.slug,true);td(tr,r.country_code);td(tr,r.currency);td(tr,date(r.created_at),true);
      return tr;
    }));
  }
  $('restaurant-search').addEventListener('input',event=>populateRestaurants(snapshot?.recent_restaurants||[],event.target.value));
  function renderActivities(rows) {
    const el=$('overview-restaurants');el.replaceChildren();
    if (!rows?.length) {el.textContent='No new registrations.';return;}
    for (const r of rows.slice(0,5)) {
      const item=document.createElement('div'),icon=document.createElement('span'),group=document.createElement('span'),name=document.createElement('strong'),country=document.createElement('small'),when=document.createElement('time');
      item.className='activity-item';icon.className='avatar';icon.textContent=String(r.name||'?').trim().slice(0,2).toUpperCase();
      name.textContent=r.name;country.textContent=r.country_code+' · '+r.currency;when.textContent=date(r.created_at);
      group.append(name,country);item.append(icon,group,when);el.append(item);
    }
  }
  function renderStatuses(rows) {
    const root=$('status-bars');root.replaceChildren();
    const total=(rows||[]).reduce((s,r)=>s+(Number(r.count)||0),0);
    if (!total) {root.textContent='No orders recorded yet.';return;}
    for (const status of [...rows].sort((a,b)=>b.count-a.count)) {
      const row=document.createElement('div'),labels=document.createElement('div'),name=document.createElement('span'),count=document.createElement('strong'),track=document.createElement('div'),bar=document.createElement('span');
      row.className='status-row';labels.className='status-labels';track.className='bar-track';
      name.textContent=String(status.status).replaceAll('_',' ');count.textContent=num(status.count)+' · '+Math.round(status.count/total*100)+'%';
      bar.style.width=(status.count/total*100)+'%';track.append(bar);labels.append(name,count);row.append(labels,track);root.append(row);
    }
  }
  function chartSeries(data,days) {
    const lookup=new Map((data||[]).map(r=>[String(r.day).slice(0,10),r]));
    const end=new Date();end.setUTCHours(0,0,0,0);
    return Array.from({length:days},(_,i)=>{
      const d=new Date(end);d.setUTCDate(end.getUTCDate()-days+1+i);
      const day=d.toISOString().slice(0,10);
      return lookup.get(day)||{day,orders:0,registrations:0,calls:0,messages:0};
    });
  }
  function lineChart(id,rows,keys) {
    const el=$(id);if(!el)return;
    const W=640,H=183,L=34,R=12,T=11,B=29;
    const plotW=W-L-R,plotH=H-T-B;
    const max=Math.max(1,...rows.flatMap(r=>keys.map(k=>Number(r[k])||0)));
    const x=i=>L+(rows.length===1?plotW/2:i/(Math.max(1,rows.length-1)))*plotW;
    const y=v=>T+plotH-(Number(v)||0)/max*plotH;
    const ticks=4;
    const grid=Array.from({length:ticks+1},(_,i)=>{
      const gy=T+i*plotH/ticks;const label=Math.round(max*(ticks-i)/ticks);
      return '<line class="axis" x1="'+L+'" y1="'+gy+'" x2="'+(W-R)+'" y2="'+gy+'"/><text x="0" y="'+(gy+3)+'">'+label+'</text>';
    }).join('');
    const lines=keys.map((key,i)=>{
      const points=rows.map((r,n)=>[x(n),y(r[key])]);
      const path=points.map((p,n)=>(n?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');
      return '<path d="'+path+'" fill="none" class="'+(i?'line-b':'line-a')+'" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>';
    }).join('');
    const labels=[0,Math.round((rows.length-1)/3),Math.round((rows.length-1)*2/3),rows.length-1].map(i=>{
      const d=rows[i];return d?'<text x="'+x(i)+'" y="'+(H-5)+'" text-anchor="middle">'+String(d.day).slice(5)+'</text>':'';
    }).join('');
    el.innerHTML='<svg role="img" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" aria-label="Real platform activity chart">'+grid+lines+labels+'</svg>';
  }
  function barChart(id,rows,keys) {
    const el=$(id);if(!el)return;
    const W=640,H=183,L=31,R=8,T=12,B=29;
    const groups=7,groupSize=Math.max(1,Math.ceil(rows.length/groups));
    const bins=Array.from({length:groups},(_,i)=>{
      const subset=rows.slice(i*groupSize,(i+1)*groupSize);
      return { a:subset.reduce((s,x)=>s+(Number(x[keys[0]])||0),0),b:subset.reduce((s,x)=>s+(Number(x[keys[1]])||0),0),day:subset[0]?.day?.slice(5)||'' };
    });
    const max=Math.max(1,...bins.flatMap(v=>[v.a,v.b])),height=H-T-B,w=W-L-R;
    const grid=Array.from({length:5},(_,i)=>'<line class="axis" x1="'+L+'" y1="'+(T+i*height/4)+'" x2="'+(W-R)+'" y2="'+(T+i*height/4)+'"/>').join('');
    const bars=bins.map((b,i)=>{
      const center=L+(i+.5)*w/groups,ha=b.a/max*height,hb=b.b/max*height;
      return '<rect class="bar-a" x="'+(center-15)+'" y="'+(T+height-ha)+'" width="13" height="'+Math.max(.01,ha)+'" rx="3"/>'+
      '<rect class="bar-b" x="'+(center+2)+'" y="'+(T+height-hb)+'" width="13" height="'+Math.max(.01,hb)+'" rx="3"/>'+
      '<text x="'+center+'" y="'+(H-6)+'" text-anchor="middle">'+b.day+'</text>';
    }).join('');
    el.innerHTML='<svg role="img" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" aria-label="Platform channel activity">'+grid+bars+'</svg>';
  }
  function renderRevenue(rows) {
    const root=$('revenue-list');root.replaceChildren();
    if (!rows?.length) {root.textContent='No completed orders recorded for the chosen period.';return;}
    rows.forEach(r=>{
      const item=document.createElement('div'),group=document.createElement('div'),key=document.createElement('b'),orders=document.createElement('small'),amount=document.createElement('b');
      item.className='revenue-line';key.textContent=r.currency;orders.textContent=num(r.orders)+' completed orders';amount.textContent=money(r.total_minor,r.currency);
      group.append(key,orders);item.append(group,amount);root.append(item);
    });
  }
  function applySnapshot(data) {
    snapshot=data;
    const k=data.kpis||{},p=data.period_totals||{},series=chartSeries(data.series,data.period_days||30);
    for (const [id,v] of Object.entries({
      'k-restaurants':k.restaurants,'k-orders':k.orders,'k-subscriptions':k.active_subscriptions,'k-open-orders':k.open_orders,
      'k-period-orders':p.orders,'p-calls':p.calls,'p-messages':p.messages,'s-assistants':k.active_assistants,
      's-websites':k.published_sites,'s-visitors':k.page_views,'s-users':k.users,'o-total':k.orders,'o-open':k.open_orders,
      'o-period':p.orders,'voice-active':k.active_assistants,'voice-calls':p.calls,'whatsapp-messages':p.messages,
      'whatsapp-restaurants':k.restaurants,'websites-published':k.published_sites,'websites-views':k.page_views,
      'websites-menu':k.menu_views,'billing-subscriptions':k.active_subscriptions,'nav-restaurants':k.restaurants
    })) text(id,num(v));
    text('last-updated','Updated '+new Date(data.updated_at).toLocaleTimeString());
    text('sidebar-sync','Last sync '+new Date(data.updated_at).toLocaleTimeString());
    text('footer-sync','Updated '+date(data.updated_at));
    text('system-api','Connected');
    text('system-sync',new Date(data.updated_at).toLocaleTimeString());
    lineChart('growth-chart',series,['orders','registrations']);
    barChart('channel-chart',series,['calls','messages']);
    lineChart('voice-chart',series,['calls']);
    lineChart('whatsapp-chart',series,['messages']);
    renderStatuses(data.order_statuses);
    renderActivities(data.recent_restaurants);
    populateRestaurants(data.recent_restaurants,$('restaurant-search').value);
    populateOrders('overview-orders',data.recent_orders);
    populateOrders('order-table',data.recent_orders);
    renderRevenue(data.revenue_by_currency);
  }
  async function health(){
    if(demoMode){text('system-db','Demo only');return;}
    if(!token)return;
    try {
      const res=await fetch('/health/database',{cache:'no-store'});
      if(!res.ok)throw Error('Unreachable');
      const info=await res.json();
      text('system-db',info.database==='connected'?'Connected':'Unavailable');
    } catch {text('system-db','Unavailable');}
  }
  async function loadData(){
    if (requestRunning||!token||demoMode)return;
    requestRunning=true;
    try {
      const response=await fetch('/api/platform/v2/overview?days='+encodeURIComponent($('period').value),{
        headers:{Authorization:'Bearer '+token},cache:'no-store'
      });
      const payload=await response.json().catch(()=>({}));
      if(response.status===401||response.status===403){throw Object.assign(Error('Session expired or access denied'),{auth:true});}
      if(!response.ok)throw Error(payload.error||'Dashboard data unavailable');
      applySnapshot(payload);
      showNotice('');
      setState('LIVE · 15s',true);
      if(document.querySelector('[data-view-section=system]').classList.contains('active')) health();
    } catch(err) {
      if(err.auth){clearInterval(refreshTimer);token='';$('v2-app').hidden=true;$('v2-auth').hidden=false;}
      setState('DATA UNAVAILABLE',false);
      text('system-api','Unavailable');
      showNotice(err.message+'. Last successfully loaded data, if any, is retained but may be out of date.');
    } finally {requestRunning=false;}
  }
  $('period').addEventListener('change',()=>{
    if(demoMode){applySnapshot(makeDemo(Number($('period').value)));return;}
    loadData();
  });
  $('refresh').addEventListener('click',()=>{
    if(demoMode){applySnapshot(makeDemo(Number($('period').value)));return;}
    loadData();
  });
  $('logout').addEventListener('click',async()=>{
    if(demoMode)return;
    try {await fetch('/auth/logout',{method:'POST',headers:{Authorization:'Bearer '+token}});}catch{}
    clearInterval(refreshTimer);token='';snapshot=null;$('v2-app').hidden=true;$('v2-auth').hidden=false;setState('DISCONNECTED',false);
  });
  $('v2-login').addEventListener('submit',async event=>{
    event.preventDefault();
    const button=event.currentTarget.querySelector('button');button.disabled=true;
    text('login-error','');
    try {
      const fd=new FormData(event.currentTarget);
      const response=await fetch('/auth/platform-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:fd.get('email'),password:fd.get('password')})});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok||!payload.token)throw Error(payload.error||'Sign-in failed');
      token=payload.token;
      event.currentTarget.reset();
      $('v2-auth').hidden=true;$('v2-app').hidden=false;
      view(location.hash.slice(1));
      await loadData();
      clearInterval(refreshTimer);refreshTimer=setInterval(loadData,15000);
      setTimeout(()=>{if(token){clearInterval(refreshTimer);token='';$('v2-app').hidden=true;$('v2-auth').hidden=false;text('login-error','Super Admin session expired. Sign in again.');}},Math.max(1,payload.expiresIn||3600)*1000);
    } catch(error) {text('login-error',error.message);}
    finally{button.disabled=false;}
  });
  function makeDemo(days) {
    const now=new Date(),base=new Date(now);base.setUTCHours(0,0,0,0);
    const series=Array.from({length:days},(_,i)=>{
      const d=new Date(base);d.setUTCDate(base.getUTCDate()-days+1+i);
      const s=i+42;
      return {day:d.toISOString().slice(0,10),orders:Math.max(0,Math.round(13+5*Math.sin(s*.65)+s/15)),registrations:Math.max(0,Math.round(2.3+1.5*Math.sin(s*.29))),calls:Math.max(0,Math.round(9+4*Math.sin(s*.38))),messages:Math.max(0,Math.round(28+9*Math.cos(s*.41)))};
    });
    const sum=key=>series.reduce((s,r)=>s+r[key],0);
    const recent_restaurants=[
      {id:5,name:'Cedar Table',slug:'cedar-table',country_code:'GR',currency:'EUR',created_at:new Date(now-864e5).toISOString()},
      {id:4,name:'Olive & Thyme',slug:'olive-thyme',country_code:'PK',currency:'PKR',created_at:new Date(now-2*864e5).toISOString()},
      {id:3,name:'Summit Kitchen',slug:'summit-kitchen',country_code:'AE',currency:'AED',created_at:new Date(now-4*864e5).toISOString()},
      {id:2,name:'Urban Plate',slug:'urban-plate',country_code:'GR',currency:'EUR',created_at:new Date(now-7*864e5).toISOString()},
      {id:1,name:'Harvest Bistro',slug:'harvest-bistro',country_code:'PK',currency:'PKR',created_at:new Date(now-11*864e5).toISOString()}
    ];
    const statuses=['completed','pending','accepted','preparing','ready','cancelled'];
    const recent_orders=Array.from({length:12},(_,i)=>({id:417-i,restaurant_name:recent_restaurants[i%5].name,currency:recent_restaurants[i%5].currency,total_minor:recent_restaurants[i%5].currency==='PKR'?Math.round(75000+i*10500):Math.round(1900+i*215),status:statuses[i%statuses.length],created_at:new Date(now-i*62*60*1000).toISOString()}));
    return {period_days:days,updated_at:new Date().toISOString(),kpis:{restaurants:128,users:376,orders:12458,active_subscriptions:89,published_sites:103,active_assistants:67,open_orders:42,page_views:95421,menu_views:32018},period_totals:{orders:sum('orders'),registrations:sum('registrations'),calls:sum('calls'),messages:sum('messages')},series,recent_restaurants,recent_orders,order_statuses:[{status:'completed',count:7980},{status:'pending',count:237},{status:'accepted',count:880},{status:'preparing',count:432},{status:'ready',count:191},{status:'cancelled',count:156}],revenue_by_currency:[{currency:'EUR',total_minor:2482950,orders:632},{currency:'PKR',total_minor:467392500,orders:1320},{currency:'AED',total_minor:4873000,orders:295}]};
  }
  if(demoMode){
    $('v2-auth').hidden=true;$('v2-app').hidden=false;
    $('demo-notice').hidden=false;
    $('logout').hidden=true;
    $('sidebar-sync').textContent='Synthetic demonstration';
    setState('DESIGN PREVIEW',false);
    applySnapshot(makeDemo(30));
    view(location.hash.slice(1));
  }
})();