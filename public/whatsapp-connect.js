/*! "Connect WhatsApp" for restaurant owners: Meta Embedded Signup in a popup, then the server
 *  finishes the setup (token, webhooks, number registration, linking to this restaurant). */
(() => {
  let ctx = null, config = null, sdk = null, session = null;
  const $$ = sel => [...document.querySelectorAll(sel)];
  const text = (el, value) => { if (el) el.textContent = value; };
  const FREE_NOTE = 'Every month the first 1,000 WhatsApp replies are free (Meta). For more, add a card in WhatsApp Manager.';
  // A second line under the status, so the free-replies note stays visible.
  function note(box) {
    let el = box.querySelector('.wa-connect-note');
    if (!el) { el = document.createElement('p'); el.className = 'wa-connect-note hint'; box.append(el); }
    const link = document.createElement('a');
    link.href = 'https://business.facebook.com/wa/manage/home/'; link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'Open WhatsApp Manager';
    el.replaceChildren(document.createTextNode(FREE_NOTE + ' '), link);
  }

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

  // "Number + code" activation: no Facebook login. Built once per box.
  function otpForm(box) {
    let form = box.querySelector('.wa-otp');
    if (form) return form;
    form = document.createElement('div'); form.className = 'wa-otp';
    const make = (tag, attrs = {}, kids = []) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'text') n.textContent = v; else if (k === 'hidden') n.hidden = v; else n.setAttribute(k, v); } n.append(...kids); return n; };
    const field = (label, input) => make('div', { class: 'field' }, [make('label', {}, [label, input])]);
    const strongNot = make('strong', { text: 'not' });
    form.append(
      make('p', { class: 'wa-otp-title' }, [make('strong', { text: 'Activate WhatsApp with your number' })]),
      field('WhatsApp number for your restaurant', make('input', { class: 'input', 'data-phone': '', name: 'wa-otp-phone', type: 'tel', inputmode: 'tel', autocomplete: 'tel', maxlength: '32', placeholder: '+92 300 1234567' })),
      field('Name customers will see', make('input', { class: 'input', name: 'wa-otp-name', maxlength: '120', placeholder: 'e.g. Urban Cafe' })),
      make('div', { class: 'wa-otp-row' }, [
        make('select', { class: 'input', name: 'wa-otp-method', 'aria-label': 'How to receive the code' }, [make('option', { value: 'SMS', text: 'Code by SMS' }), make('option', { value: 'VOICE', text: 'Code by phone call' })]),
        make('button', { type: 'button', class: 'btn btn-primary', 'data-otp-send': '', text: 'Send code' }),
      ]),
      make('div', { class: 'wa-otp-row', 'data-otp-code': '', hidden: true }, [
        make('input', { class: 'input', name: 'wa-otp-code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', placeholder: '6-digit code', 'aria-label': '6-digit code' }),
        make('button', { type: 'button', class: 'btn btn-primary', 'data-otp-verify': '', text: 'Activate' }),
      ]),
      make('p', { class: 'hint' }, ['This number must ', strongNot, ' be active in the WhatsApp or WhatsApp Business app (delete WhatsApp from it first, or use a new SIM). It must be able to receive an SMS or a call.']),
      make('p', { class: 'wa-otp-status', role: 'status' }),
    );
    box.append(form);
    window.mkPhone?.scan?.();
    const status = form.querySelector('.wa-otp-status'), phone = form.querySelector('[name="wa-otp-phone"]'), name = form.querySelector('[name="wa-otp-name"]');
    const setupWa = document.querySelector('#setup-wa');
    const prefill = () => {
      if (!phone.value && setupWa?.value) { phone.value = setupWa.value; window.mkPhone?.sync?.(); }
      if (!name.value) name.value = (document.querySelector('#owner-restaurant-label')?.textContent || '').trim().replace(/^Restaurant$/, '');
    };
    prefill(); setupWa?.addEventListener('change', prefill);
    form.querySelector('[data-otp-send]').addEventListener('click', async e => {
      const button = e.currentTarget; button.disabled = true; text(status, 'Asking Meta to send your code…');
      try {
        const r = await ctx.api('/api/restaurants/' + ctx.restaurantId + '/whatsapp/number/start', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: phone.value, display_name: name.value, method: form.querySelector('[name="wa-otp-method"]').value }) });
        form.querySelector('[data-otp-code]').hidden = false;
        form.querySelector('[name="wa-otp-code"]').focus();
        text(status, (r.method === 'VOICE' ? 'You will get a call on ' : 'Code sent by SMS to ') + r.phone + '. Type the 6-digit code above.');
        button.textContent = 'Send a new code';
      } catch (error) { text(status, error.message); }
      finally { button.disabled = false; }
    });
    form.querySelector('[data-otp-verify]').addEventListener('click', async e => {
      const button = e.currentTarget; button.disabled = true; text(status, 'Activating…');
      try {
        const r = await ctx.api('/api/restaurants/' + ctx.restaurantId + '/whatsapp/number/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: form.querySelector('[name="wa-otp-code"]').value }) });
        text(status, '✅ WhatsApp is active on ' + r.phone + '. AI replies are on. Meta reviews the name “' + r.display_name + '” (usually within a day); messages work meanwhile.');
        await refresh(false);
      } catch (error) { text(status, error.message); }
      finally { button.disabled = false; }
    });
    return form;
  }

  function render() {
    for (const box of $$('[data-wa-connect]')) {
      const button = box.querySelector('button'), status = box.querySelector('.wa-connect-status');
      if (!config) { button.disabled = true; text(status, 'Loading…'); continue; }
      const linked = config.numbers?.[0];
      const codeOn = Boolean(config.number_code?.available), codeDone = config.number_code?.status?.status === 'registered';
      box.hidden = !config.enabled && !linked && !codeOn;
      button.hidden = !config.enabled;
      button.disabled = !config.enabled;
      button.textContent = linked ? 'Connect another WhatsApp number' : 'Connect WhatsApp with Facebook';
      note(box);
      if (codeDone) text(status, '✅ Connected: ' + config.number_code.status.phone + ' · ' + config.number_code.status.display_name + '. AI replies are on.');
      else if (linked) text(status, '✅ Connected: ' + (linked.display_phone_number || 'WhatsApp number') + (linked.verified_name ? ' · ' + linked.verified_name : ''));
      else text(status, config.enabled ? 'Takes about 2 minutes. You log in with Facebook, pick or add your WhatsApp Business number, and we set up everything else.' : '');
      const form = codeOn ? otpForm(box) : box.querySelector('.wa-otp');
      if (form) form.hidden = !codeOn || codeDone || Boolean(linked);
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
