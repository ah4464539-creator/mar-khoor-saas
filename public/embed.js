/*! Mar-Khoor website widget. Add to any website:
 *  <script src="https://mar-khoor.com/embed.js" data-restaurant="your-restaurant" async></script>
 *  Shows the restaurant's AI Assistant, WhatsApp and AI Caller buttons as chosen in the dashboard. */
(() => {
  const script = document.currentScript || document.querySelector('script[data-restaurant][src*="embed.js"]');
  if (!script || window.__marKhoorWidget) return;
  window.__marKhoorWidget = true;
  const slug = (script.dataset.restaurant || '').toLowerCase();
  if (!/^[a-z0-9-]{1,160}$/.test(slug)) return console.warn('Mar-Khoor widget: data-restaurant is missing or invalid');
  const base = new URL(script.src, location.href).origin;
  const icons = {
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    whatsapp: '<path d="M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9L3 21"/><path d="M9 10a.5.5 0 0 0 1 0V9a.5.5 0 0 0-1 0v1a5 5 0 0 0 5 5h1a.5.5 0 0 0 0-1h-1a.5.5 0 0 0 0 1"/>',
    call: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
  };
  const svg = name => '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + icons[name] + '</svg>';
  const ink = hex => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#190d05' : '#ffffff';
  };

  fetch(base + '/embed/' + slug + '/config.json', { credentials: 'omit' })
    .then(response => response.ok ? response.json() : null)
    .then(config => { if (config?.enabled) mount(config); })
    .catch(() => {});

  function mount(config) {
    const tools = config.tools || {};
    if (!tools.assistant && !tools.whatsapp && !tools.call) return;
    const color = /^#[0-9a-f]{6}$/i.test(config.color) ? config.color : '#ff952f';
    const side = config.position === 'left' ? 'left' : 'right';
    const host = document.createElement('div');
    host.setAttribute('data-mar-khoor-widget', slug);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>'
      + ':host{all:initial}*{box-sizing:border-box}'
      + '.mk{position:fixed;' + side + ':18px;bottom:18px;z-index:2147483000;display:flex;flex-direction:column;align-items:' + (side === 'left' ? 'flex-start' : 'flex-end') + ';gap:10px;font:500 14px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif}'
      + '.row{display:flex;gap:10px;align-items:center;flex-direction:' + (side === 'left' ? 'row' : 'row-reverse') + '}'
      + 'button,a{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:8px;border-radius:999px;box-shadow:0 6px 22px rgba(0,0,0,.22);transition:transform .15s}'
      + 'button:hover,a:hover{transform:translateY(-1px)}button:focus-visible,a:focus-visible{outline:3px solid ' + color + ';outline-offset:3px}'
      + '.main{padding:13px 18px;background:' + color + ';color:' + ink(color) + ';font-weight:700}'
      + '.round{width:48px;height:48px;justify-content:center}.wa{background:#25d366;color:#fff}.call{background:#fff;color:#111}'
      + '.frame{display:none;width:min(390px,calc(100vw - 24px));height:min(600px,calc(100vh - 110px));border:0;border-radius:16px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.3);background:#181719}'
      + '.open .frame{display:block}'
      + '@media(max-width:520px){.open .frame{position:fixed;inset:0;width:100vw;height:100%;border-radius:0}.open .row{display:none}}'
      + '@media(prefers-reduced-motion:reduce){button,a{transition:none}}'
      + '</style><div class="mk"></div>';
    const box = root.querySelector('.mk');
    let frame = null;
    if (tools.assistant) {
      frame = document.createElement('iframe');
      frame.className = 'frame';
      frame.title = 'AI Assistant';
      frame.setAttribute('allow', 'microphone');
      frame.setAttribute('loading', 'lazy');
      box.append(frame);
    }
    const row = document.createElement('div');
    row.className = 'row';
    box.append(row);
    if (tools.assistant) {
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'main';
      open.setAttribute('aria-expanded', 'false');
      open.innerHTML = svg('chat') + '<span></span>';
      open.querySelector('span').textContent = config.label || 'Order with AI';
      const toggle = show => {
        if (show && !frame.src) frame.src = base + '/embed/' + slug + '/chat';
        box.classList.toggle('open', show);
        open.setAttribute('aria-expanded', String(show));
        open.innerHTML = show ? svg('close') + '<span>Close</span>' : svg('chat') + '<span></span>';
        if (!show) open.querySelector('span').textContent = config.label || 'Order with AI';
        if (show) frame.contentWindow?.postMessage({ source: 'mar-khoor-embed', type: 'open' }, base);
      };
      open.addEventListener('click', () => toggle(!box.classList.contains('open')));
      window.addEventListener('message', event => {
        if (event.origin === base && event.source === frame.contentWindow && event.data?.source === 'mar-khoor-widget' && event.data.type === 'close') { toggle(false); open.focus(); }
      });
      row.append(open);
    }
    if (tools.whatsapp) {
      const wa = document.createElement('a');
      wa.className = 'round wa';
      wa.href = 'https://wa.me/' + String(tools.whatsapp).replace(/\D/g, '');
      wa.target = '_blank';
      wa.rel = 'noopener';
      wa.setAttribute('aria-label', 'Chat on WhatsApp');
      wa.title = 'WhatsApp';
      wa.innerHTML = svg('whatsapp');
      row.append(wa);
    }
    if (tools.call) {
      const call = document.createElement('a');
      call.className = 'round call';
      call.href = 'tel:' + String(tools.call).replace(/[^+0-9]/g, '');
      call.setAttribute('aria-label', 'Call our AI order line');
      call.title = 'Call to order';
      call.innerHTML = svg('call');
      row.append(call);
    }
    document.body.append(host);
  }
})();
