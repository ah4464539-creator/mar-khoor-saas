// Owner dashboard: AI call history (Vapi). restaurant.js calls
// window.mkCallHistory.init({ restaurantId, api }) when a restaurant opens; the list loads when the
// "#call-history" view is shown. Text is always inserted with textContent (transcripts are customer speech).
(() => {
  const $ = id => document.getElementById(id);
  let ctx = null, cursor = null, loading = false;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const when = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(); };
  const duration = s => s == null ? '' : s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + String(s % 60).padStart(2, '0') + 's';
  const STATUS = { 'in-progress': 'Live now', ringing: 'Ringing', queued: 'Queued', forwarding: 'Transferring', ended: 'Ended', scheduled: 'Scheduled' };

  function row(call) {
    const item = el('li', 'call-row');
    const button = el('button', 'call-open');
    button.type = 'button';
    const title = el('strong', '', call.caller_number || 'Hidden number');
    const meta = [STATUS[call.status] || call.status, when(call.started_at), duration(call.duration_seconds)].filter(Boolean).join(' · ');
    const tags = el('span', 'call-tags');
    if (call.order_id) tags.append(el('span', 'tag tag-ember', 'Order #' + call.order_id));
    if (call.transferred_to) tags.append(el('span', 'tag', 'Transferred'));
    button.append(title, el('small', 'muted', meta), tags);
    button.addEventListener('click', () => openCall(call.id));
    item.append(button);
    return item;
  }

  async function load({ more = false } = {}) {
    if (!ctx || loading) return;
    loading = true;
    const list = $('call-history-list'), status = $('call-history-status'), next = $('call-history-more');
    try {
      const data = await ctx.api('/api/restaurants/' + ctx.restaurantId + '/voice-calls' + (more && cursor ? '?before=' + cursor : ''));
      if (!more) list.replaceChildren();
      for (const call of data.calls) list.append(row(call));
      cursor = data.next_cursor;
      next.hidden = !cursor;
      status.textContent = list.children.length ? '' : 'No AI calls yet. Calls answered by your AI Caller appear here.';
    } catch (error) { status.textContent = error.message; }
    finally { loading = false; }
  }

  async function openCall(id) {
    const panel = $('call-detail'), body = $('call-detail-body');
    body.replaceChildren(el('p', 'muted', 'Loading…'));
    panel.hidden = false;
    try {
      const { call } = await ctx.api('/api/restaurants/' + ctx.restaurantId + '/voice-calls/' + id);
      const parts = [el('h3', '', call.caller_number || 'Hidden number'),
        el('p', 'small muted', [when(call.started_at), duration(call.duration_seconds), call.ended_reason].filter(Boolean).join(' · '))];
      if (call.order_id) parts.push(el('p', '', 'Order #' + call.order_id + ' was created on this call (pending until staff confirm it).'));
      if (call.transferred_to) parts.push(el('p', '', 'Transferred to ' + call.transferred_to));
      if (call.summary) parts.push(el('h4', '', 'Summary'), el('p', '', call.summary));
      if (call.recording_url) {
        const audio = document.createElement('audio');
        audio.controls = true; audio.preload = 'none'; audio.src = call.recording_url;
        parts.push(el('h4', '', 'Recording'), audio);
      }
      parts.push(el('h4', '', 'Transcript'));
      if (call.lines?.length) {
        const ul = el('ul', 'call-transcript');
        for (const line of call.lines) ul.append(el('li', line.role === 'assistant' ? 'from-ai' : 'from-caller', (line.role === 'assistant' ? 'AI: ' : 'Caller: ') + line.text));
        parts.push(ul);
      } else parts.push(el('pre', 'call-transcript-text', call.transcript || 'No transcript (it is removed after the retention period).'));
      body.replaceChildren(...parts);
    } catch (error) { body.replaceChildren(el('p', 'muted', error.message)); }
  }

  window.mkCallHistory = {
    init(next) {
      ctx = next; cursor = null;
      $('call-history-list')?.replaceChildren();
      if ($('call-detail')) $('call-detail').hidden = true;
      if (location.hash === '#call-history') load();
    },
  };
  document.addEventListener('DOMContentLoaded', () => {
    $('call-history-more')?.addEventListener('click', () => load({ more: true }));
    $('call-history-refresh')?.addEventListener('click', () => load());
    $('call-detail-close')?.addEventListener('click', () => { $('call-detail').hidden = true; });
  });
  window.addEventListener('hashchange', () => { if (location.hash === '#call-history') load(); });
})();
