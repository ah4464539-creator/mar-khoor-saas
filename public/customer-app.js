/*! Mar-Khoor business directory (/app, /businesses): every published business, grouped by
 *  category, with buttons to order/book, call or WhatsApp it. Text-only DOM (textContent only). */
(() => {
  const list = document.getElementById('cust-list');
  const status = document.getElementById('cust-status');
  const search = document.getElementById('cust-search');
  const input = document.getElementById('cust-q');
  const chips = [...document.querySelectorAll('.cust-chip')];
  const ORDER = ['restaurant', 'clinic', 'salon', 'hotel'];
  const GROUP = { restaurant: 'Food & restaurants', clinic: 'Clinics & doctors', salon: 'Salons & beauty', hotel: 'Hotels & guest houses' };
  const LABEL = { restaurant: 'Food', clinic: 'Clinic', salon: 'Salon', hotel: 'Hotel' };
  const ACTION = { restaurant: 'Order', clinic: 'Book', salon: 'Book', hotel: 'Book a room' };
  const params = new URLSearchParams(location.search);
  let category = ORDER.includes(params.get('category')) ? params.get('category') : '';
  let timer = null;
  let seq = 0;

  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const safeUrl = value => (typeof value === 'string' && /^\/(r\/[a-z0-9-]{1,160}|media\/[A-Za-z0-9._\/-]+)$/.test(value) ? value : null);
  const link = (cls, href, text, label) => { const a = el('a', cls, text); a.href = href; if (label) a.setAttribute('aria-label', label); return a; };

  function card(b) {
    const url = safeUrl(b.url);
    if (!url) return null;
    const li = el('li', 'cust-item');
    const box = el('div', 'cust-card');
    const logo = safeUrl(b.logo);
    if (logo) { const img = el('img', 'cust-logo'); img.src = logo; img.alt = ''; img.width = 48; img.height = 48; img.loading = 'lazy'; box.append(img); }
    else box.append(el('span', 'cust-logo cust-logo-letter', String(b.name || '?').trim().charAt(0).toUpperCase()));
    const text = el('div', 'cust-text');
    text.append(link('cust-name', url, b.name));
    if (b.tagline) text.append(el('span', 'cust-tagline', b.tagline));
    if (b.address) text.append(el('span', 'cust-address', b.address));
    text.append(el('span', 'tag', LABEL[b.category] || 'Food'));
    const actions = el('div', 'cust-actions');
    actions.append(link('cust-btn cust-btn-main', url, ACTION[b.category] || 'Open', (ACTION[b.category] || 'Open') + ': ' + b.name));
    // Talk to the business's AI inside the app (no WhatsApp needed): chat, or a live voice call.
    if (b.ai_chat === true) actions.append(link('cust-btn cust-btn-ai', url + '#assistant', 'Chat with AI', 'Chat with the AI of ' + b.name));
    if (b.ai_voice === true) actions.append(link('cust-btn cust-btn-ai', url + '#assistant-talk', 'Talk to AI', 'Talk to the AI of ' + b.name));
    if (typeof b.phone === 'string' && /^\+?[0-9]{7,15}$/.test(b.phone)) actions.append(link('cust-btn', 'tel:' + b.phone, 'Call', 'Call ' + b.name));
    if (typeof b.whatsapp === 'string' && /^[0-9]{7,15}$/.test(b.whatsapp)) {
      const wa = link('cust-btn cust-btn-wa', 'https://wa.me/' + b.whatsapp, 'WhatsApp', 'WhatsApp ' + b.name);
      wa.rel = 'noopener'; wa.target = '_blank';
      actions.append(wa);
    }
    text.append(actions);
    box.append(text);
    li.append(box);
    return li;
  }

  function render(businesses) {
    const items = [];
    if (category || input.value.trim()) {
      for (const b of businesses) { const c = card(b); if (c) items.push(c); }
      list.replaceChildren(...items);
      return items.length;
    }
    // "All": one section per category, in a fixed order.
    let count = 0;
    for (const key of ORDER) {
      const cards = businesses.filter(b => (b.category || 'restaurant') === key).map(card).filter(Boolean);
      if (!cards.length) continue;
      count += cards.length;
      const section = el('li', 'cust-group');
      const head = el('div', 'cust-group-head');
      head.append(el('h2', 'cust-group-title', GROUP[key] + ' (' + cards.length + ')'));
      const more = el('button', 'cust-more', 'See all'); more.type = 'button';
      more.addEventListener('click', () => select(key));
      head.append(more);
      const ul = el('ul', 'cust-list');
      ul.append(...cards);
      section.append(head, ul);
      items.push(section);
    }
    list.replaceChildren(...items);
    return count;
  }

  async function load() {
    const mine = ++seq;
    status.textContent = 'Loading…';
    const query = new URLSearchParams();
    if (input.value.trim()) query.set('q', input.value.trim());
    if (category) query.set('category', category);
    try {
      const r = await fetch('/api/public/businesses' + (query.size ? '?' + query : ''), { headers: { Accept: 'application/json' } });
      const data = await r.json();
      if (mine !== seq) return;
      if (!r.ok) throw new Error(data.error || 'Unavailable');
      const shown = render(data.businesses || []);
      status.textContent = shown ? '' : (input.value.trim() || category ? 'Nothing found. Try another name or category.' : 'No businesses yet.');
    } catch {
      if (mine !== seq) return;
      list.replaceChildren();
      status.textContent = 'Could not load. Check your internet and try again.';
    }
  }

  function select(key) {
    category = key;
    for (const c of chips) c.setAttribute('aria-pressed', String((c.dataset.category || '') === key));
    const url = new URL(location.href);
    if (key) url.searchParams.set('category', key); else url.searchParams.delete('category');
    history.replaceState(null, '', url);
    window.scrollTo({ top: 0 });
    load();
  }

  search.addEventListener('submit', event => { event.preventDefault(); load(); });
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 300); });
  for (const chip of chips) chip.addEventListener('click', () => select(chip.dataset.category || ''));
  for (const c of chips) c.setAttribute('aria-pressed', String((c.dataset.category || '') === category));
  load();
})();
