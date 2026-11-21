/*! Mar-Khoor interface translation. Picks the visitor's language (saved choice, else browser),
 *  shows a language switcher, and translates the page's own text. Elements with translate="no"
 *  (restaurant names, menus, orders, messages) are never touched. */
(() => {
  const SUPPORTED = ['en','ur','ar','hi','bn','fa','tr','es','fr','de','it','pt','ru','id','ms','zh'];
  const NAMES = { en:'English', ur:'اردو', ar:'العربية', hi:'हिन्दी', bn:'বাংলা', fa:'فارسی', tr:'Türkçe', es:'Español', fr:'Français', de:'Deutsch', it:'Italiano', pt:'Português', ru:'Русский', id:'Bahasa Indonesia', ms:'Bahasa Melayu', zh:'中文' };
  const RTL = new Set(['ur','ar','fa']);
  const KEY = 'mk-lang', VERSION = '1';
  const corner = document.currentScript?.dataset.position === 'right' ? 'right' : 'left';
  let lang = 'en';
  try { lang = localStorage.getItem(KEY) || ''; } catch {}
  if (!SUPPORTED.includes(lang)) {
    lang = 'en';
    for (const tag of navigator.languages || [navigator.language || 'en']) { const code = String(tag).toLowerCase().split('-')[0]; if (SUPPORTED.includes(code)) { lang = code; break; } }
  }
  const html = document.documentElement;
  html.lang = lang; html.dir = RTL.has(lang) ? 'rtl' : 'ltr';
  window.mkLang = lang;

  const cacheKey = 'mk-i18n-' + VERSION + '-' + lang;
  let cache = {};
  try { cache = JSON.parse(localStorage.getItem(cacheKey) || '{}') || {}; } catch { cache = {}; }
  const unknown = new Set();
  const norm = text => text.replace(/\s+/g, ' ').trim();
  const skip = el => el.closest('script,style,textarea,code,pre,[translate="no"],[contenteditable="true"],.notranslate,[data-mk-lang]');
  const ATTRS = ['placeholder', 'aria-label', 'title'];
  const originals = new WeakMap(); // node -> English text, so re-renders are recognised

  function collect(root, out) {
    if (root.nodeType === 3) { if (root.parentElement && !skip(root.parentElement)) out.texts.push(root); return; }
    if (root.nodeType !== 1 || skip(root)) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: node => node.nodeType === 1 ? (skip(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP) : NodeFilter.FILTER_ACCEPT,
    });
    for (const attrEl of [root, ...root.querySelectorAll('[placeholder],[aria-label],[title]')]) if (attrEl.nodeType === 1 && !skip(attrEl)) out.attrs.push(attrEl);
    let node; while ((node = walker.nextNode())) out.texts.push(node);
  }
  function sourceOf(node) {
    const current = node.nodeValue;
    const known = originals.get(node);
    if (known && cache[norm(known.src)] === norm(current)) return known.src; // still our translation
    return current;
  }
  function apply(items) {
    for (const node of items.texts) {
      const src = sourceOf(node), key = norm(src);
      if (!key || !/\p{L}/u.test(key)) continue;
      const t = cache[key];
      if (t && norm(node.nodeValue) !== t) {
        const lead = src.match(/^\s*/)[0], tail = src.match(/\s*$/)[0];
        originals.set(node, { src });
        node.nodeValue = lead + t + tail;
      }
    }
    for (const el of items.attrs) for (const attr of ATTRS) {
      const value = el.getAttribute(attr); if (!value) continue;
      const store = el.__mkAttrs || (el.__mkAttrs = {});
      const src = store[attr] && cache[norm(store[attr])] === value ? store[attr] : value;
      const t = cache[norm(src)];
      if (t && t !== value) { store[attr] = src; el.setAttribute(attr, t); }
    }
  }
  function missing(items) {
    const out = new Set();
    for (const node of items.texts) { const key = norm(sourceOf(node)); if (key.length > 1 && /\p{L}{2}/u.test(key) && !(key in cache) && !unknown.has(key)) out.add(key); }
    for (const el of items.attrs) for (const attr of ATTRS) { const v = el.getAttribute(attr); const key = v && norm((el.__mkAttrs?.[attr] && cache[norm(el.__mkAttrs[attr])] === v) ? el.__mkAttrs[attr] : v); if (key && !(key in cache) && !unknown.has(key) && /\p{L}{2}/u.test(key)) out.add(key); }
    return [...out];
  }
  let inflight = false, queued = false;
  async function translate(root) {
    if (lang === 'en') return;
    const items = { texts: [], attrs: [] }; collect(root, items);
    apply(items);
    const need = missing(items);
    if (!need.length) return;
    if (inflight) { queued = true; return; }
    inflight = true;
    try {
      for (let i = 0; i < need.length; i += 120) {
        const chunk = need.slice(i, i + 120);
        const response = await fetch('/api/i18n/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang, strings: chunk }) });
        const data = await response.json().catch(() => ({}));
        const got = data.translations || {};
        for (const key of chunk) { if (got[key]) cache[key] = got[key]; else if (response.ok) unknown.add(key); }
        try { localStorage.setItem(cacheKey, JSON.stringify(cache)); } catch {}
        apply(items);
        if (!response.ok) break;
      }
    } catch {} finally {
      inflight = false;
      if (queued) { queued = false; schedule(document.body); }
    }
  }
  let timer = null; const roots = new Set();
  function schedule(root) { roots.add(root); clearTimeout(timer); timer = setTimeout(() => { const list = [...roots]; roots.clear(); for (const r of list) translate(r.isConnected === false ? document.body : r); }, 120); }

  function switcher() {
    const box = document.createElement('div');
    box.setAttribute('data-mk-lang', ''); box.setAttribute('translate', 'no');
    box.style.cssText = 'position:fixed;z-index:2147482000;bottom:14px;' + corner + ':14px;font:500 13px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif';
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Language');
    select.style.cssText = 'appearance:auto;padding:8px 10px;border-radius:999px;border:1px solid #d9cfc4;background:#fffdf9;color:#1c1714;box-shadow:0 4px 16px #1c17141f;cursor:pointer;max-width:170px';
    for (const code of SUPPORTED) { const o = document.createElement('option'); o.value = code; o.textContent = '🌐 ' + NAMES[code]; o.selected = code === lang; select.append(o); }
    select.addEventListener('change', () => { try { localStorage.setItem(KEY, select.value); } catch {} location.reload(); });
    box.append(select);
    document.body.append(box);
  }
  function start() {
    switcher();
    if (lang === 'en') return;
    translate(document.body);
    if (document.title) {
      const t = document.title; fetch('/api/i18n/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang, strings: [t] }) }).then(r => r.json()).then(d => { if (d.translations?.[t]) document.title = d.translations[t]; }).catch(() => {});
    }
    new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'characterData') schedule(record.target.parentElement || document.body);
        else if (record.type === 'attributes') schedule(record.target);
        else for (const node of record.addedNodes) if (node.nodeType === 1 || node.nodeType === 3) schedule(node.nodeType === 3 ? node.parentElement || document.body : node);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
