/*! Mar-Khoor app "Chats": the Mar-Khoor Assistant and every business chat kept on this phone.
 *  Text-only DOM (textContent), no HTML from the server or the AI is inserted. */
(() => {
  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const load = key => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
  const SLUG = /^[a-z0-9-]{1,160}$/;
  const ICON = { restaurant: '🍽️', clinic: '🩺', salon: '💇', hotel: '🏨' };

  function when(at) {
    const d = new Date(Number(at));
    if (Number.isNaN(d.getTime())) return '';
    return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString();
  }

  function renderChats() {
    const chats = (load('mar-khoor.chats') || []).filter(c => c && SLUG.test(c.slug));
    const list = $('chat-list');
    const pinned = list.firstElementChild;
    const rows = chats.map(c => {
      const li = el('li');
      const a = el('a', 'chat-row'); a.href = '/r/' + c.slug + '/chat';
      a.append(el('span', 'chat-row-avatar', ICON[c.category] || String(c.name || '?').charAt(0).toUpperCase()));
      const text = el('span', 'chat-row-text');
      text.append(el('strong', null, c.name || c.slug), el('span', null, c.last || ''));
      a.append(text, el('small', 'chat-row-time', when(c.at)));
      li.append(a);
      return li;
    });
    list.replaceChildren(pinned, ...rows);
    $('chat-empty').hidden = rows.length > 0;
  }

  // ---- Mar-Khoor Assistant ----
  const log = $('concierge-log');
  const history = (load('mar-khoor.concierge') || []).filter(h => h && typeof h.content === 'string').slice(-20);
  const bubble = (role, text) => { const p = el('p', 'bubble ' + (role === 'user' ? 'bubble-me' : 'bubble-ai'), text); log.append(p); return p; };
  function suggestions(list) {
    const box = el('div', 'concierge-cards');
    for (const b of list) {
      if (!SLUG.test(b.slug)) continue;
      const c = el('div', 'concierge-card');
      c.append(el('strong', null, b.name), el('span', null, b.tagline || ''));
      const actions = el('div', 'cust-actions');
      const add = (cls, href, text) => { const a = el('a', 'cust-btn ' + cls, text); a.href = href; actions.append(a); };
      if (b.chat === '/r/' + b.slug + '/chat') add('cust-btn-main', b.chat, b.category === 'restaurant' ? 'Chat & order' : 'Chat & book');
      else add('cust-btn-main', '/r/' + b.slug, 'Open');
      if (b.call === '/r/' + b.slug + '/chat#call') add('cust-btn-ai', b.call, '📞 Call AI');
      c.append(actions);
      box.append(c);
    }
    log.append(box);
  }
  for (const h of history) bubble(h.role, h.content);
  const save = () => { try { localStorage.setItem('mar-khoor.concierge', JSON.stringify(history.slice(-20))); } catch {} };

  $('concierge-form').addEventListener('submit', async event => {
    event.preventDefault();
    const input = $('concierge-input');
    const message = input.value.trim();
    if (!message) return;
    input.value = '';
    bubble('user', message);
    const thinking = bubble('assistant', 'Thinking…');
    log.scrollTop = log.scrollHeight;
    try {
      const r = await fetch('/api/public/concierge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, history: history.slice(-6) }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw Error(data.error || 'The assistant is unavailable right now.');
      thinking.textContent = data.reply || 'Here are some options:';
      if (Array.isArray(data.businesses) && data.businesses.length) suggestions(data.businesses);
      history.push({ role: 'user', content: message }, { role: 'assistant', content: thinking.textContent });
      save();
    } catch (error) { thinking.textContent = error.message || 'Could not connect. Please try again.'; }
    log.scrollTop = log.scrollHeight;
    input.focus();
  });

  function route() {
    const assistant = location.hash === '#assistant';
    $('assistant-view').hidden = !assistant;
    $('chats-view').hidden = assistant;
    if (assistant) { log.scrollTop = log.scrollHeight; $('concierge-input').focus({ preventScroll: true }); }
    else renderChats();
  }
  window.addEventListener('hashchange', route);
  window.addEventListener('pageshow', route);
  route();
})();
