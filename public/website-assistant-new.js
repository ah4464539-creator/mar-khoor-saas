/* Mar-Khoor public support assistant. No private restaurant data or stored transcripts. */
(() => {
  'use strict';
  if (document.querySelector('.mk-support-root')) return;
  const root = document.createElement('div');
  root.className = 'mk-support-root';
  root.innerHTML = [
    '<button type="button" class="mk-support-launch" aria-controls="mk-support-panel" aria-expanded="false" aria-label="Open Mar-Khoor AI support">',
      '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-4.1-1L3 21l1.2-4.7A8.4 8.4 0 1 1 21 11.5Z"/><path d="M8 11.5h8"/></svg>',
      '<span>AI Help</span>',
    '</button>',
    '<section id="mk-support-panel" class="mk-support-panel" role="dialog" aria-label="Mar-Khoor AI support chat" hidden>',
      '<header class="mk-support-header"><div class="mk-support-mark" aria-hidden="true">M</div>',
      '<div><strong>Mar-Khoor Support</strong><small><span class="mk-support-dot"></span><span id="mk-support-state">Checking availability</span></small></div>',
      '<button type="button" class="mk-support-close" aria-label="Close chat">×</button></header>',
      '<div id="mk-support-log" class="mk-support-log" role="log" aria-live="polite" aria-relevant="additions">',
        '<p class="mk-support-bubble" data-from="assistant">Hi! I can help with Mar-Khoor registration, business setup, WhatsApp AI, calling, websites and plans. How can I help?</p>',
        '<div class="mk-support-chips" aria-label="Common questions">',
          '<button type="button" data-question="How do I register my business?">How to register</button>',
          '<button type="button" data-question="How do I connect WhatsApp AI?">WhatsApp setup</button>',
          '<button type="button" data-question="What plans are available?">Plans &amp; pricing</button>',
        '</div>',
      '</div>',
      '<p class="mk-support-notice" id="mk-support-notice" role="status" hidden></p>',
      '<form class="mk-support-form" id="mk-support-form">',
        '<label class="mk-support-sr" for="mk-support-input">Message</label>',
        '<textarea id="mk-support-input" rows="1" enterkeyhint="send" maxlength="1200" placeholder="Ask a question…" required></textarea>',
        '<button type="submit" class="mk-support-send" aria-label="Send message" title="Send message">➤</button>',
      '</form>',
      '<div class="mk-support-footer">AI can make mistakes. No passwords or payment details. <a href="/contact.html">Contact us</a> · <a href="mailto:admin@mar-khoor.com">Email support</a></div>',
    '</section>',
  ].join('');
  document.body.appendChild(root);

  const launch = root.querySelector('.mk-support-launch');
  const panel = root.querySelector('.mk-support-panel');
  const closer = root.querySelector('.mk-support-close');
  const form = root.querySelector('.mk-support-form');
  const input = root.querySelector('textarea');
  const submit = root.querySelector('.mk-support-send');
  const log = root.querySelector('.mk-support-log');
  const notice = root.querySelector('.mk-support-notice');
  const state = root.querySelector('#mk-support-state');
  const dot = root.querySelector('.mk-support-dot');
  const mobileLayout = window.matchMedia('(max-width: 600px), (pointer: coarse) and (max-height: 500px)');
  const viewport = window.visualViewport;
  const history = [];
  let enabled = false;
  let busy = false;

  function showNotice(value) {
    notice.hidden = !value;
    notice.textContent = value || '';
  }
  function setEnabled(value) {
    enabled = value;
    input.disabled = !enabled;
    submit.disabled = !enabled;
    state.textContent = enabled ? 'AI assistant available' : 'Email support available';
    dot.classList.toggle('offline', !enabled);
    if (!enabled) showNotice('AI chat is temporarily unavailable. Please email admin@mar-khoor.com for assistance.');
    else showNotice('');
  }
  function fitVisibleViewport() {
    if (panel.hidden || !mobileLayout.matches || !viewport) return;
    const followLatest = log.scrollHeight - log.scrollTop - log.clientHeight < 4;
    panel.style.setProperty('--mk-support-viewport-top', viewport.offsetTop + 'px');
    panel.style.setProperty('--mk-support-viewport-left', viewport.offsetLeft + 'px');
    panel.style.setProperty('--mk-support-viewport-width', viewport.width + 'px');
    panel.style.setProperty('--mk-support-viewport-height', viewport.height + 'px');
    if (followLatest) log.scrollTop = log.scrollHeight;
  }
  viewport?.addEventListener('resize', fitVisibleViewport);
  viewport?.addEventListener('scroll', fitVisibleViewport);
  mobileLayout.addEventListener('change', fitVisibleViewport);

  function toggle(open) {
    panel.hidden = !open;
    launch.setAttribute('aria-expanded', String(open));
    if (open) {
      fitVisibleViewport();
      if (enabled && !mobileLayout.matches) input.focus();
      else closer.focus({ preventScroll: true });
    } else launch.focus({ preventScroll: true });
  }
  launch.addEventListener('click', () => toggle(panel.hidden));
  closer.addEventListener('click', () => toggle(false));
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') toggle(false);
  });
  document.addEventListener('click', event => {
    const opener = event.target.closest('[data-open-mk-support]');
    if (opener) { event.preventDefault(); toggle(true); }
  });

  function addMessage(value, from) {
    const p = document.createElement('p');
    p.className = 'mk-support-bubble';
    p.dataset.from = from;
    p.textContent = value;
    log.appendChild(p);
    log.scrollTop = log.scrollHeight;
    return p;
  }
  async function sendMessage(value) {
    const message = value.trim();
    if (!message || !enabled || busy || message.length > 1200) return;
    busy = true;
    input.value = '';
    if (!mobileLayout.matches) input.disabled = true;
    submit.disabled = true;
    showNotice('');
    addMessage(message, 'user');
    const pending = addMessage('Typing…', 'assistant');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 22000);
    try {
      const response = await fetch('/api/public/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
        body: JSON.stringify({ message, history: history.slice(-8) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || typeof data.reply !== 'string') throw new Error(data.error || 'Unable to answer right now');
      pending.textContent = data.reply;
      history.push({ role: 'user', content: message }, { role: 'assistant', content: data.reply });
      if (history.length > 8) history.splice(0, history.length - 8);
    } catch {
      pending.textContent = 'Sorry, I could not reply right now. Please email admin@mar-khoor.com.';
    } finally {
      clearTimeout(timeout);
      busy = false;
      input.disabled = !enabled;
      submit.disabled = !enabled;
      log.scrollTop = log.scrollHeight;
      if (!panel.hidden && enabled && !mobileLayout.matches) input.focus();
    }
  }
  submit.addEventListener('mousedown', event => {
    if (mobileLayout.matches && document.activeElement === input) event.preventDefault();
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    void sendMessage(input.value);
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (form.requestSubmit) form.requestSubmit(); else void sendMessage(input.value);
    }
  });
  root.querySelectorAll('[data-question]').forEach(button => button.addEventListener('click', () => {
    void sendMessage(button.dataset.question);
  }));
  // The launcher remains visible even when AI is disabled; visitors always have a support route.
  const statusController = new AbortController();
  const statusTimeout = setTimeout(() => statusController.abort(), 7000);
  fetch('/api/public/assistant/status', { cache: 'no-store', signal: statusController.signal })
    .then(r => r.ok ? r.json() : null)
    .then(data => setEnabled(data?.enabled === true))
    .catch(() => setEnabled(false))
    .finally(() => clearTimeout(statusTimeout));
})();
