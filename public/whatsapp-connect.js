/*! "Connect WhatsApp" for restaurant owners: Meta Embedded Signup in a popup, then the server
 *  finishes the setup (token, webhooks, number registration, linking to this restaurant). */
(() => {
  let ctx = null, config = null, sdk = null, session = null;
  const $$ = sel => [...document.querySelectorAll(sel)];
  const text = (el, value) => { if (el) el.textContent = value; };

  function loadSdk(appId, version) {
    if (sdk) return sdk;
    sdk = new Promise((resolve, reject) => {
      window.fbAsyncInit = () => { window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version }); resolve(window.FB); };
      const s = document.createElement('script');
      s.src = 'https://connect.facebook.net/en_US/sdk.js'; s.async = true; s.defer = true; s.crossOrigin = 'anonymous';
      s.onerror = () => { sdk = null; reject(Error('Could not load Facebook. Check your connection or ad blocker.')); };
      document.head.append(s);
    });
    return sdk;
  }

  // Meta posts the WABA and phone number IDs to this window when the popup finishes.
  window.addEventListener('message', event => {
    if (!/(^|\.)facebook\.com$/.test(new URL(event.origin).hostname)) return;
    let data; try { data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch { return; }
    if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;
    if (/^FINISH/.test(data.event)) session = { waba_id: data.data?.waba_id, phone_number_id: data.data?.phone_number_id };
    else if (data.event === 'CANCEL') session = { cancelled: true };
    else if (data.event === 'ERROR') session = { error: data.data?.error_message || 'Meta reported an error' };
  });

  function render() {
    for (const box of $$('[data-wa-connect]')) {
      const button = box.querySelector('button'), status = box.querySelector('.wa-connect-status');
      if (!config) { button.disabled = true; text(status, 'Loading…'); continue; }
      const linked = config.numbers?.[0];
      box.hidden = !config.enabled && !linked;
      button.disabled = !config.enabled;
      button.textContent = linked ? 'Connect another WhatsApp number' : 'Connect WhatsApp with Facebook';
      text(status, linked ? '✅ Connected: ' + (linked.display_phone_number || 'WhatsApp number') + (linked.verified_name ? ' · ' + linked.verified_name : '') : 'Takes about 2 minutes. You log in with Facebook, pick or add your WhatsApp Business number, and we set up everything else.');
    }
  }

  async function connect(box) {
    const status = box.querySelector('.wa-connect-status'), button = box.querySelector('button');
    button.disabled = true; session = null; text(status, 'Opening Facebook…');
    try {
      const FB = await loadSdk(config.app_id, config.graph_version);
      const code = await new Promise(resolve => FB.login(r => resolve(r?.authResponse?.code || null), {
        config_id: config.config_id, response_type: 'code', override_default_response_type: true, extras: { setup: {} },
      }));
      // The message event can arrive just after the login callback.
      for (let i = 0; i < 20 && !session && code; i++) await new Promise(r => setTimeout(r, 150));
      if (!code || session?.cancelled) { text(status, 'WhatsApp was not connected. You can try again any time.'); return; }
      if (session?.error) { text(status, 'Meta: ' + session.error); return; }
      if (!session?.waba_id || !session?.phone_number_id) { text(status, 'Facebook finished without a WhatsApp number. Please try again and choose a number.'); return; }
      text(status, 'Finishing setup…');
      const result = await ctx.api('/api/restaurants/' + ctx.restaurantId + '/whatsapp/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, ...session }) });
      text(status, '✅ Connected: ' + (result.display_phone_number || 'your WhatsApp number') + (result.registered ? '. AI replies are on.' : '. Almost done: Meta still needs to finish registering this number.'));
      await refresh(false);
    } catch (error) {
      text(status, error.message || 'Connection failed. Please try again.');
    } finally { button.disabled = !config?.enabled; }
  }

  async function refresh(draw = true) {
    try { config = await ctx.api('/api/restaurants/' + ctx.restaurantId + '/whatsapp/signup'); } catch { config = { enabled: false, numbers: [] }; }
    if (draw) render();
    else { const keep = $$('[data-wa-connect] .wa-connect-status').map(s => s.textContent); render(); $$('[data-wa-connect] .wa-connect-status').forEach((s, i) => { s.textContent = keep[i]; }); }
  }

  window.mkWhatsAppConnect = {
    init(context) {
      ctx = context;
      for (const box of $$('[data-wa-connect]')) {
        if (box.dataset.ready) continue; box.dataset.ready = '1';
        box.querySelector('button').addEventListener('click', () => connect(box));
      }
      return refresh();
    },
  };
})();
