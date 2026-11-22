// Restaurant dashboard as an installable phone app:
// - "Install app" (Android/desktop prompt; iPhone gets Share → Add to Home Screen steps)
// - New-order alerts on this device (Web Push, works when the app is closed)
// - A loud ring + vibration when a new order arrives while the dashboard is open
// restaurant.js calls window.mkOwnerApp.init({ restaurantId, api }) and .orders(list) after each refresh.
(() => {
  const $ = s => document.querySelector(s);
  let prefsLoaded = false;
  let ctx = null, installEvent = null, seen = null, seenFor = null, audio = null, soundOn = true;
  try { soundOn = localStorage.getItem('mk-order-sound') !== 'off'; } catch { /* private mode */ }
  const supportsPush = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const say = text => { const el = $('#app-alerts-status'); if (el) el.textContent = text; };

  // Register the service worker early so the app is installable.
  let swReady = null;
  if ('serviceWorker' in navigator) {
    swReady = navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(() => navigator.serviceWorker.ready).catch(() => null);
    navigator.serviceWorker.addEventListener('message', event => { if (event.data?.type === 'mk-push') { ring(); window.mkOwnerRefresh?.(); } });
  }
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installEvent = event; render(); });
  window.addEventListener('appinstalled', () => { installEvent = null; render(); say('App installed. Open Mar-Khoor from your home screen.'); });

  // Ring: three short tones made in the browser (no sound file). Browsers allow sound after a first tap.
  function unlock() { if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch { audio = null; } } audio?.resume?.(); }
  document.addEventListener('pointerdown', unlock, { once: true });
  document.addEventListener('keydown', unlock, { once: true });
  function ring() {
    if (navigator.vibrate) navigator.vibrate([300, 120, 300, 120, 300]);
    if (!soundOn || !audio) return;
    const t = audio.currentTime;
    [0, 0.35, 0.7].forEach((offset, i) => {
      const osc = audio.createOscillator(), gain = audio.createGain();
      osc.type = 'square'; osc.frequency.value = i === 2 ? 1175 : 880;
      gain.gain.setValueAtTime(0.0001, t + offset); gain.gain.exponentialRampToValueAtTime(0.35, t + offset + 0.02); gain.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.28);
      osc.connect(gain).connect(audio.destination); osc.start(t + offset); osc.stop(t + offset + 0.3);
    });
  }
  let titleTimer = null;
  function flashTitle(count) {
    clearInterval(titleTimer);
    const base = document.title.replace(/^\(\d+ new\) /, '');
    let on = false;
    titleTimer = setInterval(() => { on = !on; document.title = on ? '(' + count + ' new) ' + base : base; }, 900);
    const stop = () => { clearInterval(titleTimer); document.title = base; window.removeEventListener('focus', stop); };
    window.addEventListener('focus', stop);
    setTimeout(stop, 60000);
  }

  /** Called with the order list after each dashboard refresh; rings for orders not seen before. */
  function orders(list) {
    if (!ctx || !Array.isArray(list)) return;
    const pending = list.filter(o => o.status === 'pending').map(o => Number(o.id));
    if (seenFor !== ctx.restaurantId || !seen) { seen = new Set(list.map(o => Number(o.id))); seenFor = ctx.restaurantId; return; }
    const fresh = pending.filter(id => !seen.has(id));
    list.forEach(o => seen.add(Number(o.id)));
    if (fresh.length) {
      ring(); flashTitle(fresh.length);
      const banner = $('#new-order-banner');
      if (banner) { banner.hidden = false; banner.querySelector('span').textContent = fresh.length === 1 ? 'New order #' + fresh[0] : fresh.length + ' new orders'; }
    }
  }

  async function subscription() { const reg = await swReady; return reg ? reg.pushManager.getSubscription() : null; }
  async function turnOn() {
    if (!supportsPush) { say(isIos && !standalone() ? 'On iPhone, first add this app to your Home Screen (Share → Add to Home Screen), open it from there, then turn alerts on.' : 'This browser cannot show order alerts. Use Chrome on Android or the installed app.'); return; }
    unlock();
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') { say('Notifications are blocked. Allow them for mar-khoor.com in your browser settings, then try again.'); return; }
    const reg = await swReady;
    if (!reg) { say('Could not start the app service. Reload the page and try again.'); return; }
    const { public_key } = await ctx.api('/api/restaurants/' + ctx.restaurantId + '/push');
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToBytes(public_key) });
    const r = await ctx.api('/api/restaurants/' + ctx.restaurantId + '/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }) });
    say('✅ Order alerts are on for this device (' + r.devices + ' device' + (r.devices === 1 ? '' : 's') + ' in total). Keep the phone volume up.');
    render();
  }
  async function turnOff() {
    const sub = await subscription();
    if (sub) { await ctx.api('/api/restaurants/' + ctx.restaurantId + '/push/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {}); await sub.unsubscribe().catch(() => {}); }
    say('Order alerts are off on this device.'); render();
  }
  function base64ToBytes(b64) { const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4)); return Uint8Array.from(s, c => c.charCodeAt(0)); }

  async function render() {
    const card = $('#app-alerts'); if (!card) return;
    const install = $('#app-install'), iosTip = $('#app-ios-tip'), on = $('#app-alerts-on'), off = $('#app-alerts-off'), test = $('#app-alerts-test'), sound = $('#app-sound');
    install.hidden = !installEvent || standalone();
    iosTip.hidden = !(isIos && !standalone());
    const sub = supportsPush && Notification.permission === 'granted' ? await subscription().catch(() => null) : null;
    on.hidden = Boolean(sub); off.hidden = !sub; test.hidden = !sub;
    const kinds = $('#app-alert-kinds');
    if (kinds) {
      kinds.hidden = !sub;
      if (sub && !prefsLoaded) { prefsLoaded = true; try { const r = await ctx.api('/api/restaurants/' + ctx.restaurantId + '/push'); for (const box of kinds.querySelectorAll('[data-alert-kind]')) box.checked = r.preferences?.[box.dataset.alertKind] !== false; } catch { prefsLoaded = false; } }
    }
    sound.checked = soundOn;
  }

  let wired = false;
  function wire() {
    if (wired) return; wired = true;
    $('#app-install')?.addEventListener('click', async () => { if (!installEvent) return; installEvent.prompt(); await installEvent.userChoice.catch(() => null); installEvent = null; render(); });
    $('#app-alerts-on')?.addEventListener('click', () => turnOn().catch(e => say(e.message)));
    $('#app-alerts-off')?.addEventListener('click', () => turnOff().catch(e => say(e.message)));
    $('#app-alerts-test')?.addEventListener('click', async () => { say('Sending a test alert…'); try { const r = await ctx.api('/api/restaurants/' + ctx.restaurantId + '/push/test', { method: 'POST' }); say(r.sent ? 'Test alert sent. It should appear in a few seconds.' : 'No device received it. Turn alerts off and on again.'); } catch (e) { say(e.message); } });
    $('#app-sound')?.addEventListener('change', e => { soundOn = e.target.checked; try { localStorage.setItem('mk-order-sound', soundOn ? 'on' : 'off'); } catch { /* ignore */ } if (soundOn) { unlock(); ring(); } });
    for (const box of document.querySelectorAll('[data-alert-kind]')) box.addEventListener('change', async () => {
      try { await ctx.api('/api/restaurants/' + ctx.restaurantId + '/push/preferences', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [box.dataset.alertKind]: box.checked }) }); say('Saved.'); }
      catch (e) { box.checked = !box.checked; say(e.message); }
    });
    $('#new-order-banner button')?.addEventListener('click', () => { $('#new-order-banner').hidden = true; location.hash = '#order-desk'; });
  }

  window.mkOwnerApp = {
    init(context) { ctx = context; seen = null; seenFor = null; prefsLoaded = false; wire(); render(); },
    orders,
    ring,
  };
})();
