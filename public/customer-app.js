/*! Mar-Khoor customer app home: find a business, then order or book on its own page. */
(() => {
  const list = document.getElementById('cust-list');
  const status = document.getElementById('cust-status');
  const search = document.getElementById('cust-search');
  const input = document.getElementById('cust-q');
  const chips = [...document.querySelectorAll('.cust-chip')];
  const LABEL = { restaurant: 'Food', clinic: 'Clinic', salon: 'Salon', hotel: 'Hotel' };
  const ACTION = { restaurant: 'Order', clinic: 'Book', salon: 'Book', hotel: 'Book a room' };
  let category = '';
  let timer = null;
  let seq = 0;

  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const safeUrl = value => (typeof value === 'string' && /^\/(r\/[a-z0-9-]{1,160}|media\/[A-Za-z0-9._\/-]+)$/.test(value) ? value : null);

  function card(b) {
    const url = safeUrl(b.url);
    if (!url) return null;
    const li = el('li', 'cust-item');
    const a = el('a', 'cust-card');
    a.href = url;
    const logo = safeUrl(b.logo);
    if (logo) { const img = el('img', 'cust-logo'); img.src = logo; img.alt = ''; img.width = 48; img.height = 48; img.loading = 'lazy'; a.append(img); }
    else a.append(el('span', 'cust-logo cust-logo-letter', String(b.name || '?').trim().charAt(0).toUpperCase()));
    const text = el('span', 'cust-text');
    text.append(el('strong', 'cust-name', b.name));
    if (b.tagline) text.append(el('span', 'cust-tagline', b.tagline));
    text.append(el('span', 'tag', LABEL[b.category] || 'Food'));
    a.append(text, el('span', 'cust-go', ACTION[b.category] || 'Open'));
    li.append(a);
    return li;
  }

  async function load() {
    const mine = ++seq;
    status.textContent = 'Loading…';
    const params = new URLSearchParams();
    if (input.value.trim()) params.set('q', input.value.trim());
    if (category) params.set('category', category);
    try {
      const r = await fetch('/api/public/businesses' + (params.size ? '?' + params : ''), { headers: { Accept: 'application/json' } });
      const data = await r.json();
      if (mine !== seq) return;
      if (!r.ok) throw new Error(data.error || 'Unavailable');
      const cards = (data.businesses || []).map(card).filter(Boolean);
      list.replaceChildren(...cards);
      status.textContent = cards.length ? '' : (input.value.trim() || category ? 'Nothing found. Try another name or category.' : 'No businesses yet.');
    } catch {
      if (mine !== seq) return;
      list.replaceChildren();
      status.textContent = 'Could not load. Check your internet and try again.';
    }
  }

  search.addEventListener('submit', event => { event.preventDefault(); load(); });
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 300); });
  for (const chip of chips) chip.addEventListener('click', () => {
    category = chip.dataset.category || '';
    for (const c of chips) c.setAttribute('aria-pressed', String(c === chip));
    load();
  });
  load();
})();
