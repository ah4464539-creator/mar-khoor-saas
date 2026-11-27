// Owner dashboard: "Use your own number" for the AI Caller (AI receptionist page).
// restaurant.js calls window.mkOwnLine.init({ restaurantId, api }). Text is always set with textContent.
(() => {
  const $ = id => document.getElementById(id);
  let ctx = null, poll = null;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const url = (path = '') => '/api/restaurants/' + ctx.restaurantId + '/own-line' + path;

  function copyRow(label, value, { secret = false } = {}) {
    const row = el('div', 'own-line-row');
    const text = el('div');
    const code = el('code', null, secret ? '••••••••••••' : value);
    text.append(el('span', 'fwd-label', label), code);
    const actions = el('span', 'own-line-actions');
    if (secret) {
      const show = el('button', 'btn btn-quiet btn-sm', 'Show'); show.type = 'button';
      show.addEventListener('click', () => { const hidden = code.textContent !== value; code.textContent = hidden ? value : '••••••••••••'; show.textContent = hidden ? 'Hide' : 'Show'; });
      actions.append(show);
    }
    const copy = el('button', 'btn btn-quiet btn-sm', 'Copy'); copy.type = 'button';
    copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(value); copy.textContent = 'Copied'; } catch { copy.textContent = 'Select and copy'; } setTimeout(() => { copy.textContent = 'Copy'; }, 2000); });
    actions.append(copy);
    row.append(text, actions);
    return row;
  }
  function dialRow(label, code) {
    const row = copyRow(label, code);
    const dial = el('a', 'btn btn-quiet btn-sm', 'Dial');
    dial.href = 'tel:' + code.replace(/\*/g, '%2A').replace(/#/g, '%23');
    row.querySelector('.own-line-actions').append(dial);
    return row;
  }

  const GUIDES = {
    sim: ['Put the spare SIM in a 1-port GSM gateway (for example GoIP, Dinstar or Yeastar) and connect the gateway to the internet.',
      'In the gateway settings, add a SIP account with the server, username and password below.',
      'Set incoming GSM calls to go to the SIP destination below (often called "GSM to VoIP" / "call forward to VoIP").'],
    landline: ['Connect the landline cable to a phone adapter with an FXO port (for example Grandstream HT813) and connect the adapter to the internet.',
      'On the FXO port, add a SIP account with the server, username and password below.',
      'Set incoming calls on the FXO line to go to the SIP destination below ("unconditional forward to VoIP").'],
    pbx: ['In your phone system or VoIP provider, add a SIP trunk (or "SIP forwarding") to the server below with this username and password.',
      'Route incoming calls for your number (or only after-hours / busy calls) to the SIP address below.'],
  };

  function render(data) {
    const card = $('own-line-card');
    if (!card) return;
    card.hidden = !data.available && !data.line;
    const select = $('own-line-type');
    if (!select.options.length) for (const [value, label] of Object.entries(data.line_types || {})) { const o = el('option', null, label); o.value = value; select.append(o); }
    const box = $('own-line-details');
    const line = data.line;
    clearInterval(poll); poll = null;
    if (!line) { box.replaceChildren(); $('own-line-save').textContent = 'Connect my number'; return; }
    $('own-line-phone').value = line.phone_number;
    select.value = line.line_type;
    $('own-line-save').textContent = 'Save changes';
    const status = line.status === 'connected'
      ? el('p', 'own-line-status ok', '✓ Connected. The AI answered a call on ' + line.phone_number + (line.last_call_at ? ' (last call ' + new Date(line.last_call_at).toLocaleString() + ')' : '') + '.')
      : line.status === 'failed' ? el('p', 'own-line-status bad', 'The AI line could not be created. Press "Save changes" to try again.')
      : el('p', 'own-line-status wait', 'Waiting for the first call. Set up your device with the settings below, then call ' + line.phone_number + ' from another phone.');
    const s = line.settings;
    const settings = el('div', 'own-line-settings');
    settings.append(el('strong', null, 'Settings for your ' + (line.line_type === 'pbx' ? 'phone system' : 'gateway')),
      copyRow('SIP server', s.sip_server), copyRow('Port', s.port), copyRow('Username', s.username),
      s.password ? copyRow('Password', s.password, { secret: true }) : el('p', 'hint', 'Password unavailable: press "New password".'),
      copyRow('Send calls to (SIP destination)', s.destination), copyRow('Full SIP address', s.sip_uri));
    const steps = el('ol', 'fwd-steps');
    for (const text of GUIDES[line.line_type] || []) steps.append(el('li', null, text));
    steps.append(el('li', null, 'Call ' + line.phone_number + ' from another phone. When the AI answers, this card turns green.'));
    const fwd = el('details', 'own-line-forward');
    fwd.append(el('summary', null, 'Also send calls from another number (for example your personal mobile) to ' + line.phone_number));
    if (line.forwarding) {
      fwd.append(el('p', 'hint', 'Dial one code from that phone. Standard codes work on most mobile networks worldwide; some US carriers use the *72 code.'),
        dialRow('All calls', line.forwarding.all), dialRow('When busy', line.forwarding.busy), dialRow('When not answered', line.forwarding.no_answer),
        dialRow('When switched off / no signal', line.forwarding.unreachable), dialRow('Turn forwarding off', line.forwarding.off), copyRow('US carriers (Verizon and others)', line.forwarding.us_alternative));
    }
    const more = el('div', 'form-actions');
    const reset = el('button', 'btn btn-ghost btn-sm', 'New password'); reset.type = 'button';
    reset.addEventListener('click', async () => {
      if (!confirm('Create a new password? You must then type it into your gateway or phone system again.')) return;
      try { render({ ...data, line: (await ctx.api(url('/reset-password'), { method: 'POST' })).line }); $('own-line-note').textContent = 'New password created. Update your device.'; }
      catch (error) { $('own-line-note').textContent = error.message; }
    });
    const remove = el('button', 'btn btn-quiet btn-sm', 'Disconnect'); remove.type = 'button';
    remove.addEventListener('click', async () => {
      if (!confirm('Disconnect your own number from the AI? Calls on it will no longer reach the AI.')) return;
      try { await ctx.api(url(''), { method: 'DELETE' }); $('own-line-note').textContent = 'Disconnected.'; load(); }
      catch (error) { $('own-line-note').textContent = error.message; }
    });
    more.append(reset, remove);
    box.replaceChildren(status, settings, el('strong', null, 'Steps'), steps, fwd, more);
    if (line.status !== 'connected') poll = setInterval(() => { if (location.hash === '#ai-receptionist' && !document.hidden) load(); }, 15000);
  }

  async function load() {
    if (!ctx) return;
    try { render(await ctx.api(url(''))); }
    catch { if ($('own-line-card')) $('own-line-card').hidden = true; }
  }
  window.mkOwnLine = { init(next) { ctx = next; load(); } };
  document.addEventListener('DOMContentLoaded', () => {
    $('own-line-save')?.addEventListener('click', async event => {
      event.target.disabled = true;
      $('own-line-note').textContent = 'Connecting… (this can take a few seconds)';
      try {
        const result = await ctx.api(url(''), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone_number: $('own-line-phone').value, line_type: $('own-line-type').value }) });
        $('own-line-note').textContent = 'Saved. Now set up your device with the settings below.';
        render({ available: true, line_types: {}, line: result.line });
      } catch (error) { $('own-line-note').textContent = error.message; }
      finally { event.target.disabled = false; }
    });
  });
  window.addEventListener('hashchange', () => { if (location.hash === '#ai-receptionist') load(); });
})();
