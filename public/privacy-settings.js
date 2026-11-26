// Owner dashboard: how long customer messages and call transcripts are kept (AI receptionist → Privacy).
// restaurant.js calls window.mkPrivacySettings.init({ restaurantId, api }) when a restaurant opens.
(() => {
  const $ = id => document.getElementById(id);
  let ctx = null;
  const CHOICES = [7, 14, 30, 60, 90, 180, 365];
  function show(data) {
    const select = $('privacy-days');
    if (!select) return;
    const def = data.default_days;
    const options = [['', 'Platform default (messages ' + def.messages + ' days, transcripts ' + def.transcripts + ' days)'], ...CHOICES.filter(d => d >= data.min_days && d <= data.max_days).map(d => [String(d), d + ' days'])];
    select.replaceChildren(...options.map(([value, label]) => { const o = document.createElement('option'); o.value = value; o.textContent = label; return o; }));
    select.value = data.message_retention_days == null ? '' : String(data.message_retention_days);
  }
  async function load() {
    if (!ctx) return;
    try { show(await ctx.api('/api/restaurants/' + ctx.restaurantId + '/privacy')); $('privacy-card').hidden = false; }
    catch { if ($('privacy-card')) $('privacy-card').hidden = true; }
  }
  window.mkPrivacySettings = { init(next) { ctx = next; load(); } };
  document.addEventListener('DOMContentLoaded', () => {
    $('privacy-save')?.addEventListener('click', async event => {
      const value = $('privacy-days').value;
      event.target.disabled = true;
      try {
        show(await ctx.api('/api/restaurants/' + ctx.restaurantId + '/privacy', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message_retention_days: value === '' ? null : Number(value) }) }));
        $('privacy-note').textContent = 'Saved. Older messages are cleared in the next daily clean-up.';
      } catch (error) { $('privacy-note').textContent = error.message; }
      finally { event.target.disabled = false; }
    });
  });
})();
