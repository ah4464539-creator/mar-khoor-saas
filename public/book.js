// Public booking page: /book.html?b=<slug>. Times and prices are re-checked by the server.
(function () {
  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const slug = (new URLSearchParams(location.search).get('b') || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  const ICON = { restaurant: '🍽️', clinic: '🩺', hotel: '🏨', salon: '✂️' };
  const KIND = { restaurant: 'Reserve a table', clinic: 'Book an appointment', hotel: 'Book a room', salon: 'Book an appointment' };
  let info = null, service = null, picked = '', category = '';
  const night = () => info?.category === 'hotel';
  const money = m => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: info.business.currency, maximumFractionDigits: m % 100 ? 2 : 0 }).format(m / 100); } catch { return info.business.currency + ' ' + m / 100; } };
  const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const plus = (date, n) => { const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const api = async (path, options) => { const r = await fetch('/api/public/book/' + slug + path, options); const data = await r.json().catch(() => ({})); if (!r.ok) throw Error(data.error || 'Something went wrong'); return data; };

  async function start() {
    if (!slug) { $('book-name').textContent = 'Booking link is incomplete'; return; }
    try { info = await api(''); }
    catch (error) { $('book-name').textContent = error.message; return; }
    document.title = KIND[info.category] + ' · ' + info.business.name;
    $('book-name').textContent = info.business.name;
    $('book-kind').textContent = KIND[info.category] || 'Book online';
    $('book-icon').textContent = ICON[info.category] || '📅';
    $('book-svc-title').textContent = 'Choose ' + (info.type.service || 'a service').toLowerCase();
    $('book-when-title').textContent = night() ? 'Choose your dates' : 'Choose a time';
    $('book-date-label').textContent = night() ? 'Check-in' : 'Date';
    $('book-out-field').hidden = !night();
    $('book-guests-label').textContent = info.category === 'clinic' ? 'Patients' : info.category === 'restaurant' ? 'Guests' : 'People';
    if (!info.services.length) { $('book-avail').textContent = 'Online booking is not ready yet. Please call the business.'; }
    const cats = [...new Set(info.services.map(s => s.category).filter(Boolean))];
    const catLabel = info.category === 'clinic' ? 'Specialty' : 'Category';
    if (cats.length > 1) {
      $('book-cats').hidden = false;
      const chip = (label, value) => { const b = el('button', 'book-cat', label); b.type = 'button'; b.addEventListener('click', () => { category = value; $('book-cats').querySelectorAll('.book-cat').forEach(x => x.classList.toggle('on', x === b)); renderServices(); }); return b; };
      $('book-cats').replaceChildren(el('span', 'small muted', catLabel + ':'), chip('All', ''), ...cats.map(c => chip(c, c)));
      $('book-cats').querySelector('.book-cat').classList.add('on');
    }
    renderServices();
    $('book-res').addEventListener('change', check);
    $('book-date').min = today(); $('book-date').value = today(); $('book-out').value = plus(today(), 1);
    $('book-form').hidden = false;
    check();
  }
  function renderServices() {
    const list = info.services.filter(s => !category || s.category === category);
    $('book-services').replaceChildren(...list.map((s, i) => {
      const l = el('label', 'book-service'); const r = el('input'); r.type = 'radio'; r.name = 'svc'; r.value = s.id; r.checked = i === 0;
      const t = el('span', 'book-svc-text'); t.append(el('b', null, s.name), el('small', null, night() ? money(s.price_minor) + ' / night' : s.duration_min + ' min' + (s.price_minor ? ' · ' + money(s.price_minor) : '')));
      if (s.description) t.append(el('small', 'muted', s.description));
      r.addEventListener('change', () => { service = s; fillPeople(); check(); });
      l.append(r, t); return l;
    }));
    service = list[0] || null;
    fillPeople();
    if (info && $('book-form').hidden === false) check();
  }
  function fillPeople() {
    const people = service && !night() ? info.resources.filter(r => (service.resource_ids || []).includes(r.id)) : [];
    $('book-res-field').hidden = people.length < 2;
    $('book-res-label').textContent = info.category === 'clinic' ? 'Doctor' : info.category === 'restaurant' ? 'Table' : 'With';
    const any = el('option', null, info.category === 'clinic' ? 'Any available doctor' : 'Anyone available'); any.value = '';
    $('book-res').replaceChildren(any, ...people.map(r => { const o = el('option', null, r.name + (r.specialty ? ' · ' + r.specialty : '')); o.value = r.id; return o; }));
  }
  async function check() {
    picked = ''; $('book-total').textContent = '';
    const box = $('book-slots'), note = $('book-avail');
    box.replaceChildren();
    if (!service) return;
    if (night() && $('book-out').value <= $('book-date').value) $('book-out').value = plus($('book-date').value, 1);
    note.textContent = 'Checking…';
    try {
      const r = await api('/availability?service_id=' + service.id + '&date=' + $('book-date').value + (night() ? '&check_out=' + $('book-out').value : '') + ($('book-res').value ? '&resource_id=' + $('book-res').value : ''));
      if (r.kind === 'night') {
        note.textContent = r.rooms_left ? 'Available · ' + r.nights + ' night' + (r.nights > 1 ? 's' : '') : 'No rooms free for these dates. Try other dates.';
        if (r.rooms_left) $('book-total').textContent = 'Total: ' + money(r.total_minor);
        return;
      }
      note.textContent = r.slots.length ? '' : 'No free times on this day. Try another date.';
      box.append(...r.slots.map(s => { const b = el('button', 'book-slot', s.time); b.type = 'button'; b.addEventListener('click', () => { picked = s.time; box.querySelectorAll('.book-slot').forEach(x => x.classList.toggle('on', x === b)); if (service.price_minor) $('book-total').textContent = 'Price: ' + money(service.price_minor); }); return b; }));
    } catch (error) { note.textContent = error.message; }
  }
  async function submit(event) {
    event.preventDefault();
    const status = $('book-status');
    if (!service) return;
    if (!night() && !picked) { status.textContent = 'Please pick a time.'; return; }
    $('book-submit').disabled = true; status.textContent = 'Booking…';
    try {
      const { booking, token, deposit_minor: deposit, pay_options: payOptions } = await api('/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service_id: service.id, resource_id: $('book-res').value ? Number($('book-res').value) : null, date: $('book-date').value, time: picked, check_out: $('book-out').value, customer_name: $('book-cname').value, customer_phone: $('book-phone').value, guests: Number($('book-guests').value), note: $('book-note').value, discount_code: $('book-code').value }) });
      $('book-form').hidden = true; $('book-done').hidden = false;
      const when = night() ? booking.start_at.slice(0, 10) + ' to ' + booking.end_at.slice(0, 10) : booking.start_at.slice(0, 10) + ' at ' + booking.start_at.slice(11, 16);
      $('book-done-text').textContent = booking.service + ' · ' + when + ' · booking #' + booking.id;
      showPay(booking, token, deposit, payOptions || []);
    } catch (error) { status.textContent = error.message; $('book-submit').disabled = false; check(); }
  }
  const TYPE_KEY = { jazzcash: 'jazzcash', easypaisa: 'easypaisa', raast: 'raast', bank: 'bank', wallet: 'wallet', link: 'link', paypal: 'paypal', upi: 'upi' };
  function showPay(booking, token, deposit, options) {
    if (!options.length || !token) return;
    const amount = deposit || booking.price_minor;
    $('book-pay').hidden = false;
    $('book-pay-title').textContent = deposit ? 'Advance payment: ' + money(deposit) : amount ? 'Pay now (optional): ' + money(amount) : 'Pay now (optional)';
    $('book-pay-methods').replaceChildren(...options.map(o => { const d = el('div', 'book-pay-method'); d.append(el('b', null, o.label)); if (o.type === 'link' && /^https:\/\//.test(o.account_number || '')) { const a = el('a', 'btn btn-primary', 'Pay online'); a.href = o.account_number; a.target = '_blank'; a.rel = 'noopener noreferrer'; d.append(a); } else d.append(el('span', null, [o.account_title, o.account_number].filter(Boolean).join(' · '))); if (o.instructions) d.append(el('small', 'muted', o.instructions)); return d; }));
    $('book-pay-method').replaceChildren(...options.map(o => { const op = el('option', null, o.label); op.value = TYPE_KEY[o.type] || 'other'; return op; }));
    $('book-pay-send').onclick = async () => {
      const st = $('book-pay-status'); $('book-pay-send').disabled = true; st.textContent = 'Sending…';
      try { await api('/bookings/' + booking.id + '/payment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, reference: $('book-pay-ref').value, method: $('book-pay-method').value, amount: amount / 100 }) }); st.textContent = 'Thank you. The business will check your payment.'; }
      catch (error) { st.textContent = error.message; $('book-pay-send').disabled = false; }
    };
  }
  document.addEventListener('DOMContentLoaded', () => {
    $('book-date').addEventListener('change', check); $('book-out').addEventListener('change', check);
    $('book-form').addEventListener('submit', submit);
    start();
  });
})();
