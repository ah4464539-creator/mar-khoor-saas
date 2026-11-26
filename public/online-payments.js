// Owner dashboard: online card payments for customer orders (Stripe Connect, the restaurant's own account).
// restaurant.js calls window.mkOnlinePayments.init({ restaurantId, api }) when a restaurant opens.
(() => {
  const $ = id => document.getElementById(id);
  let ctx = null;
  function show(state) {
    const box = $('online-pay');
    if (!box) return;
    box.hidden = !state.configured;
    if (!state.configured) return;
    const status = $('online-pay-status');
    status.textContent = !state.connected ? 'Not set up yet. Setup takes about 5 minutes on Stripe (business and bank details).'
      : !state.charges_enabled ? 'Stripe is still checking your details. Finish the setup, then press "Check status".'
      : state.online_enabled ? 'On: customers can pay by card at checkout.' : 'Ready. Turn it on to show “Pay online now” at checkout.';
    if (state.test_mode) status.textContent += ' (Test mode: no real money.)';
    $('online-pay-connect').hidden = Boolean(state.charges_enabled);
    $('online-pay-connect').textContent = state.connected ? 'Continue setup on Stripe' : 'Set up card payments';
    $('online-pay-refresh').hidden = !state.connected || state.charges_enabled;
    $('online-pay-toggle-wrap').hidden = !state.charges_enabled;
    $('online-pay-toggle').checked = Boolean(state.online_enabled);
  }
  const url = path => '/api/restaurants/' + ctx.restaurantId + '/payments/online' + path;
  async function load() {
    if (!ctx) return;
    try { show(await ctx.api(url(''))); } catch { if ($('online-pay')) $('online-pay').hidden = true; }
  }
  window.mkOnlinePayments = { init(next) { ctx = next; load(); } };
  document.addEventListener('DOMContentLoaded', () => {
    $('online-pay-connect')?.addEventListener('click', async event => {
      event.target.disabled = true;
      try { const { url: link } = await ctx.api(url('/connect'), { method: 'POST' }); if (/^https:\/\/connect\.stripe\.com\//.test(link)) location.assign(link); }
      catch (error) { $('online-pay-status').textContent = error.message; }
      finally { event.target.disabled = false; }
    });
    $('online-pay-refresh')?.addEventListener('click', async () => {
      try { show(await ctx.api(url('/refresh'), { method: 'POST' })); } catch (error) { $('online-pay-status').textContent = error.message; }
    });
    $('online-pay-toggle')?.addEventListener('change', async event => {
      const enabled = event.target.checked;
      event.target.disabled = true;
      try { show(await ctx.api(url(''), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) })); }
      catch (error) { event.target.checked = !enabled; $('online-pay-status').textContent = error.message; }
      finally { event.target.disabled = false; }
    });
  });
  window.addEventListener('hashchange', () => { if (location.hash === '#payment-methods') load(); });
})();
