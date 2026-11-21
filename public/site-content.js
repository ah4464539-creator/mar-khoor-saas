// Owner dashboard: blog posts and content pages for the restaurant's AI website.
// restaurant.js calls window.mkSiteContent.init({ restaurantId, api }) when a restaurant opens.
(() => {
  const $ = id => document.getElementById(id);
  let ctx = null, kind = 'post', items = [], editing = null, base = '';
  const LABELS = {
    post: { title: 'Blog posts', hint: 'News, offers, recipes and events for your customers.', button: 'New post', empty: 'No posts yet. Write your first one — AI can draft it for you.', editorNew: 'New post', editorEdit: 'Edit post', path: '/blog/' },
    page: { title: 'Pages', hint: 'About us, delivery info, privacy policy and other fixed pages. Linked in your website footer.', button: 'New page', empty: 'No pages yet. Use a quick start below to add one.', editorNew: 'New page', editorEdit: 'Edit page', path: '/p/' },
  };
  const url = (path = '') => '/api/restaurants/' + ctx.restaurantId + '/site/content' + path;
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  function setKind(next) {
    kind = next;
    document.querySelectorAll('[data-content-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.contentTab === kind)));
    const L = LABELS[kind];
    $('content-list-title').textContent = L.title; $('content-list-hint').textContent = L.hint;
    $('content-new').querySelector('span').textContent = L.button;
    closeEditor();
    return load();
  }

  async function load() {
    if (!ctx) return;
    const list = $('content-list');
    try {
      const data = await ctx.api(url('?kind=' + kind));
      items = data.items; base = data.base;
    } catch (error) { list.replaceChildren(el('li', 'muted', error.message)); return; }
    render();
  }

  function render() {
    const list = $('content-list');
    list.replaceChildren();
    if (!items.length) list.append(el('li', 'muted', LABELS[kind].empty));
    for (const item of items) {
      const li = el('li', 'content-item');
      const main = el('div');
      main.append(el('strong', null, item.title));
      const meta = [item.status === 'published' ? 'Published' : 'Draft', item.category, kind === 'page' && item.show_in_nav ? 'In top menu' : null].filter(Boolean).join(' · ');
      main.append(el('p', 'small muted', meta));
      const actions = el('div', 'content-actions');
      if (item.status === 'published') { const a = el('a', 'btn btn-sm btn-ghost', 'View'); a.href = base + LABELS[kind].path + item.slug; a.target = '_blank'; a.rel = 'noopener'; actions.append(a); }
      const edit = el('button', 'btn btn-sm btn-ghost', 'Edit'); edit.type = 'button'; edit.addEventListener('click', () => openEditor(item));
      const del = el('button', 'btn btn-sm btn-quiet', 'Delete'); del.type = 'button';
      del.addEventListener('click', async () => {
        if (del.dataset.confirm !== '1') { del.dataset.confirm = '1'; del.textContent = 'Tap again to delete'; setTimeout(() => { del.dataset.confirm = ''; del.textContent = 'Delete'; }, 4000); return; }
        del.disabled = true;
        try { await ctx.api(url('/' + item.id + '?kind=' + kind), { method: 'DELETE' }); await load(); } catch (error) { del.textContent = error.message; }
      });
      actions.append(edit, del);
      li.append(main, actions); list.append(li);
    }
    const cats = [...new Set(items.map(i => i.category).filter(Boolean))];
    $('content-category-list').replaceChildren(...cats.map(c => { const o = document.createElement('option'); o.value = c; return o; }));
    const box = $('content-categories');
    box.hidden = kind !== 'post' || !cats.length;
    box.replaceChildren(el('span', 'small muted', 'Categories: '), ...cats.map(c => el('span', 'tag', c + ' (' + items.filter(i => i.category === c).length + ')')));
  }

  function openEditor(item = null) {
    editing = item;
    const L = LABELS[kind];
    $('content-editor').hidden = false;
    $('content-editor-title').textContent = item ? L.editorEdit : L.editorNew;
    $('content-ai').hidden = kind !== 'post';
    $('content-presets').hidden = kind !== 'page' || Boolean(item);
    $('content-post-fields').hidden = kind !== 'post';
    $('content-nav-field').hidden = kind !== 'page';
    $('content-title').value = item?.title || '';
    $('content-category').value = item?.category || '';
    $('content-excerpt').value = item?.excerpt || '';
    $('content-body').value = item?.body || '';
    $('content-nav').checked = Boolean(item?.show_in_nav);
    $('content-status').value = item?.status || 'draft';
    $('content-status-text').textContent = '';
    $('content-title').focus();
  }
  function closeEditor() { editing = null; $('content-editor').hidden = true; }

  async function save(event) {
    event.preventDefault();
    const out = $('content-status-text'), button = $('content-save');
    const body = { title: $('content-title').value, body: $('content-body').value, status: $('content-status').value };
    if (kind === 'post') { body.category = $('content-category').value; body.excerpt = $('content-excerpt').value; }
    else body.show_in_nav = $('content-nav').checked;
    if (editing) body.slug = editing.slug;
    button.disabled = true; out.textContent = 'Saving…';
    try {
      await ctx.api(editing ? url('/' + editing.id + '?kind=' + kind) : url('?kind=' + kind), json(editing ? 'PUT' : 'POST', body));
      closeEditor(); await load();
    } catch (error) { out.textContent = error.message; }
    finally { button.disabled = false; }
  }

  async function aiDraft() {
    const topic = $('content-topic').value.trim(), out = $('content-status-text'), button = $('content-ai-go');
    if (!topic) { $('content-topic').focus(); return; }
    button.disabled = true; out.textContent = 'AI is writing a draft…';
    try {
      const draft = await ctx.api(url('/draft'), json('POST', { topic }));
      $('content-title').value = draft.title; $('content-category').value = draft.category || '';
      $('content-excerpt').value = draft.excerpt || ''; $('content-body').value = draft.body;
      $('content-status').value = 'draft';
      out.textContent = 'Draft ready. Read it, edit anything, then save.';
    } catch (error) { out.textContent = error.message; }
    finally { button.disabled = false; }
  }

  let wired = false;
  function wire() {
    if (wired) return; wired = true;
    document.querySelectorAll('[data-content-tab]').forEach(b => b.addEventListener('click', () => setKind(b.dataset.contentTab)));
    $('content-new').addEventListener('click', () => openEditor());
    $('content-cancel').addEventListener('click', closeEditor);
    $('content-form').addEventListener('submit', save);
    $('content-ai-go').addEventListener('click', aiDraft);
    document.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => { $('content-title').value = b.dataset.preset; $('content-body').focus(); }));
    window.addEventListener('hashchange', () => { if (location.hash === '#blog-pages') load(); });
  }

  window.mkSiteContent = {
    init(context) {
      if (!document.getElementById('blog-pages')) return;
      ctx = context; wire(); closeEditor();
      kind = 'post';
      document.querySelectorAll('[data-content-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.contentTab === 'post')));
      if (location.hash === '#blog-pages') load();
    },
  };
})();
