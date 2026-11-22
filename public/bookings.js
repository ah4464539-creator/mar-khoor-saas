// Owner dashboard: business type, services/staff/rooms, opening hours and the bookings board.
// Plain DOM building only, no HTML strings. Started by restaurant.js through window.mkBookings.init().
(function () {
  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const TYPE_ICONS = { restaurant: '🍽️', clinic: '🩺', hotel: '🏨', salon: '✂️' };
  const COPY = {
    restaurant: { nav: 'Table bookings', setup: 'Tables & hours', resHint: 'Tables or areas guests can book (optional).', svcHint: 'For example: Table for 2, Family table, Private room.', capacity: 'Tables of this kind', resLegend: 'Which tables', guests: 'Guests' },
    clinic: { nav: 'Appointments', setup: 'Doctors & services', resHint: 'Doctors or specialists who see patients.', svcHint: 'For example: General check-up, Dental cleaning, Follow-up visit.', capacity: 'Patients at the same time', resLegend: 'Which doctors', guests: 'Patients' },
    salon: { nav: 'Appointments', setup: 'Services & staff', resHint: 'Stylists or staff who do the work.', svcHint: 'For example: Haircut, Facial, Bridal makeup.', capacity: 'Clients at the same time', resLegend: 'Who does it', guests: 'People' },
    hotel: { nav: 'Reservations', setup: 'Rooms & rates', resHint: '', svcHint: 'Each room type with its price per night and how many rooms you have.', capacity: 'Rooms of this type', resLegend: '', guests: 'Guests' },
  };
  const STATUS = { pending: 'New', confirmed: 'Confirmed', completed: 'Done', cancelled: 'Cancelled', no_show: 'No-show' };
  const SOURCE = { owner: '🧑‍💼', website: '🌐', whatsapp: '💬', call: '📞' };
  let ctx = null, data = null, range = 'week', day = '';

  const money = minor => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: ctx.currency || 'PKR', maximumFractionDigits: minor % 100 ? 2 : 0 }).format(minor / 100); } catch { return (ctx.currency || '') + ' ' + minor / 100; } };
  const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const addDays = (date, n) => { const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const fmtDay = date => new Date(date + 'T00:00:00Z').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const t2m = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
  const m2t = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const type = () => data?.profile?.category || ctx.category || 'restaurant';
  const night = () => type() === 'hotel';
  const copy = () => COPY[type()] || COPY.restaurant;
  const base = () => '/api/restaurants/' + ctx.restaurantId + '/business';

  function applyLabels() {
    document.body.dataset.category = type();
    const c = copy();
    document.querySelectorAll('[data-biz-label="bookings"]').forEach(n => { n.textContent = c.nav; });
    document.querySelectorAll('[data-biz-label="setup"]').forEach(n => { n.textContent = c.setup; });
    $('bookings')?.setAttribute('data-title', c.nav);
    $('booking-setup')?.setAttribute('data-title', c.setup);
    if (location.hash === '#bookings' || location.hash === '#booking-setup') { const h = document.querySelector('#owner-heading'); if (h) h.textContent = location.hash === '#bookings' ? c.nav : c.setup; }
    const info = data?.types?.[type()];
    if ($('bk-res-title')) $('bk-res-title').textContent = info ? info.resources : 'Staff';
    if ($('bk-svc-title')) $('bk-svc-title').textContent = info ? info.services : 'Services';
    if ($('bk-res-hint')) $('bk-res-hint').textContent = c.resHint;
    if ($('bk-svc-hint')) $('bk-svc-hint').textContent = c.svcHint;
    const resCard = $('bk-resources')?.closest('.bk-card'); if (resCard) resCard.hidden = night();
    if ($('bk-hours-card')) $('bk-hours-card').hidden = night();
    if ($('bk-f-guests-label')) $('bk-f-guests-label').textContent = c.guests;
    if ($('bk-f-service-label')) $('bk-f-service-label').textContent = info ? info.service : 'Service';
    if ($('bk-f-date-label')) $('bk-f-date-label').textContent = night() ? 'Check-in' : 'Date';
    if ($('bk-f-out-field')) $('bk-f-out-field').hidden = !night();
    if ($('bk-f-slots-field')) $('bk-f-slots-field').hidden = night();
    const link = location.origin + '/book.html?b=' + encodeURIComponent(ctx.slug || '');
    for (const id of ['bk-link', 'bk-public']) {
      const p = $(id); if (!p) continue;
      p.replaceChildren();
      if (!data?.profile?.bookings_enabled || !ctx.slug) { if (id === 'bk-link') p.textContent = 'Online booking is off.'; continue; }
      p.append('Customers book here: ');
      const a = el('a', null, link); a.href = link; a.target = '_blank'; a.rel = 'noopener'; p.append(a);
    }
  }

  // ---------- Setup page ----------
  function renderTypes() {
    const grid = $('bk-type-grid'); if (!grid || !data) return;
    grid.replaceChildren(...Object.entries(data.types).map(([key, info]) => {
      const label = el('label', 'bk-type');
      const input = el('input'); input.type = 'radio'; input.name = 'bk-category'; input.value = key; input.checked = key === type();
      input.addEventListener('change', () => { data.profile.category = key; if (key !== 'restaurant') $('bk-enabled').checked = true; applyLabels(); renderResources(); renderServices(); });
      label.append(input, el('span', 'bk-type-icon', TYPE_ICONS[key] || '•'), el('b', null, info.label));
      return label;
    }));
    $('bk-enabled').checked = Boolean(data.profile.bookings_enabled);
    $('bk-slot').value = String(data.profile.slot_minutes || 30);
  }
  function renderHours() {
    const box = $('bk-hours'); if (!box || !data) return;
    const hours = data.profile.hours || {};
    box.replaceChildren(...DAYS.map((name, d) => {
      const r = (hours[d] || [])[0];
      const row = el('div', 'bk-hour-row'); row.dataset.day = d;
      const open = el('label', 'check bk-open'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = Boolean(r); open.append(cb, ' ' + name);
      const from = el('input', 'input'); from.type = 'time'; from.value = r ? m2t(r[0]) : '09:00'; from.setAttribute('aria-label', name + ' opens');
      const to = el('input', 'input'); to.type = 'time'; to.value = r ? m2t(r[1]) : '18:00'; to.setAttribute('aria-label', name + ' closes');
      const sync = () => { from.disabled = to.disabled = !cb.checked; row.classList.toggle('closed', !cb.checked); };
      cb.addEventListener('change', sync); sync();
      row.append(open, from, el('span', 'muted', 'to'), to);
      return row;
    }));
  }
  function readHours() {
    const out = {};
    document.querySelectorAll('#bk-hours .bk-hour-row').forEach(row => {
      const [cb, from, to] = [row.querySelector('input[type=checkbox]'), ...row.querySelectorAll('input[type=time]')];
      out[row.dataset.day] = cb.checked && from.value && to.value && t2m(to.value) > t2m(from.value) ? [[t2m(from.value), t2m(to.value)]] : [];
    });
    return out;
  }
  function tile(title, lines, onEdit, inactive) {
    const box = el('div', 'bk-tile' + (inactive ? ' off' : ''));
    const info = el('div', 'bk-tile-info'); info.append(el('strong', null, title));
    for (const l of lines.filter(Boolean)) info.append(el('span', 'small muted', l));
    const edit = el('button', 'btn btn-ghost btn-sm', 'Edit'); edit.type = 'button'; edit.addEventListener('click', onEdit);
    box.append(info, edit); return box;
  }
  function renderResources() {
    const box = $('bk-resources'); if (!box || !data) return;
    box.replaceChildren(...data.resources.map(r => tile(r.name, [r.note, r.active ? '' : 'Not taking bookings'], () => openItem('resource', r), !r.active)));
    if (!data.resources.length) box.append(el('p', 'small muted bk-empty', 'Nothing added yet.'));
  }
  function renderServices() {
    const box = $('bk-services'); if (!box || !data) return;
    const names = new Map(data.resources.map(r => [r.id, r.name]));
    box.replaceChildren(...data.services.map(s => tile(s.name, [
      night() ? money(s.price_minor) + ' / night · ' + s.capacity + ' room' + (s.capacity === 1 ? '' : 's') : s.duration_min + ' min · ' + money(s.price_minor),
      !night() && s.resource_ids.length ? s.resource_ids.map(id => names.get(id)).filter(Boolean).join(', ') : '',
      s.active ? '' : 'Not taking bookings',
    ], () => openItem('service', s), !s.active)));
    if (!data.services.length) box.append(el('p', 'small muted bk-empty', 'Nothing added yet.'));
  }
  let editing = null;
  function openItem(kind, item) {
    editing = { kind, id: item?.id || 0 };
    const dlg = $('bk-item-dialog'), info = data.types[type()];
    $('bk-item-title').textContent = (item ? 'Edit ' : 'Add ') + (kind === 'service' ? info.service : info.resource).toLowerCase();
    dlg.querySelectorAll('[data-svc-only]').forEach(n => { n.hidden = kind !== 'service'; });
    dlg.querySelectorAll('[data-res-only]').forEach(n => { n.hidden = kind !== 'resource'; });
    $('bk-i-name').value = item?.name || '';
    $('bk-i-desc').value = item?.description || '';
    $('bk-i-note').value = item?.note || '';
    $('bk-i-dur').value = item?.duration_min && item.duration_min < 1440 ? item.duration_min : 30;
    $('bk-i-price').value = item ? (item.price_minor || 0) / 100 : 0;
    $('bk-i-cap').value = item?.capacity || 1;
    $('bk-i-active').checked = item ? item.active : true;
    $('bk-i-dur-field').hidden = kind !== 'service' || night();
    $('bk-i-price-label').textContent = night() ? 'Price per night' : 'Price';
    $('bk-i-cap-label').textContent = copy().capacity;
    const resField = $('bk-i-res-field');
    resField.hidden = kind !== 'service' || night() || !data.resources.length;
    $('bk-i-res-legend').textContent = copy().resLegend || 'Who does it';
    $('bk-i-res').replaceChildren(...data.resources.map(r => { const l = el('label', 'check'); const c = el('input'); c.type = 'checkbox'; c.value = r.id; c.checked = Boolean(item?.resource_ids?.includes(r.id)); l.append(c, ' ' + r.name); return l; }));
    $('bk-i-status').textContent = '';
    dlg.showModal(); $('bk-i-name').focus();
  }
  async function saveItem(event) {
    event.preventDefault();
    const status = $('bk-i-status');
    const body = editing.kind === 'service'
      ? { name: $('bk-i-name').value, description: $('bk-i-desc').value, duration_min: Number($('bk-i-dur').value), price: Number($('bk-i-price').value), capacity: Number($('bk-i-cap').value), resource_ids: [...$('bk-i-res').querySelectorAll('input:checked')].map(i => Number(i.value)), active: $('bk-i-active').checked }
      : { name: $('bk-i-name').value, note: $('bk-i-note').value, active: $('bk-i-active').checked };
    status.textContent = 'Saving…';
    try {
      // A new type of business must be saved first, so durations and prices are checked for it.
      if (data.profile.category !== data.saved_category) await saveProfile(true);
      const path = base() + (editing.kind === 'service' ? '/services' : '/resources') + (editing.id ? '/' + editing.id : '');
      const result = await ctx.api(path, { method: editing.id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (result.services) data.services = result.services;
      if (result.resources) data.resources = result.resources;
      renderResources(); renderServices(); renderBoardHints();
      $('bk-item-dialog').close();
    } catch (error) { status.textContent = error.message; }
  }
  async function saveProfile(quiet) {
    const note = $('bk-note');
    if (!quiet) note.textContent = 'Saving…';
    try {
      const body = { category: data.profile.category, bookings_enabled: $('bk-enabled').checked, slot_minutes: Number($('bk-slot').value) };
      if (!night()) body.hours = readHours();
      const result = await ctx.api(base() + '/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      data.profile = result.profile; data.saved_category = result.profile.category;
      ctx.category = result.profile.category;
      applyLabels(); renderHours();
      if (!quiet) note.textContent = 'Saved.';
    } catch (error) { note.textContent = error.message; throw error; }
  }

  // ---------- Bookings board ----------
  function rangeDates() {
    const t = today();
    if (day) return [day, day];
    if (range === 'today') return [t, t];
    if (range === 'month') return [t, addDays(t, 29)];
    return [t, addDays(t, 6)];
  }
  function renderBoardHints() { const e = $('bk-empty-setup'); if (e) e.hidden = Boolean(data?.services?.length); }
  async function loadBoard() {
    if (!ctx) return;
    const [from, to] = rangeDates();
    document.querySelectorAll('[data-bk-range]').forEach(b => b.classList.toggle('active', !day && b.dataset.bkRange === range));
    const list = $('bk-list');
    try {
      const { bookings } = await ctx.api(base() + '/bookings?from=' + from + '&to=' + to);
      renderBoard(bookings, from, to);
    } catch (error) { list.replaceChildren(el('p', 'muted', error.message)); }
  }
  function renderBoard(bookings, from, to) {
    const list = $('bk-list'), counts = { pending: 0, confirmed: 0 };
    for (const b of bookings) if (counts[b.status] != null) counts[b.status]++;
    const nav = $('nav-booking-count'); if (nav) { nav.hidden = !counts.pending; nav.textContent = counts.pending; }
    const sum = $('bk-summary');
    if (sum) {
      const chip = (n, label, cls) => { const c = el('div', 'bk-chip ' + (cls || '')); c.append(el('b', null, String(n)), el('span', null, label)); return c; };
      sum.replaceChildren(chip(counts.pending, 'New', 'new'), chip(counts.confirmed, 'Confirmed'), chip(bookings.filter(b => !['cancelled', 'no_show'].includes(b.status)).length, from === to ? fmtDay(from) : 'In this range'));
    }
    const groups = new Map();
    for (const b of bookings) { const d = b.start_at.slice(0, 10); if (!groups.has(d)) groups.set(d, []); groups.get(d).push(b); }
    if (!groups.size) { list.replaceChildren(el('p', 'muted bk-none', 'No bookings ' + (from === to ? 'on ' + fmtDay(from) : 'in this period') + '.')); return; }
    list.replaceChildren(...[...groups].map(([date, items]) => {
      const col = el('section', 'bk-day');
      const head = el('div', 'bk-day-head'); head.append(el('h3', null, date === today() ? 'Today · ' + fmtDay(date) : fmtDay(date)), el('span', 'count', String(items.length)));
      col.append(head, ...items.map(card));
      return col;
    }));
  }
  function card(b) {
    const c = el('article', 'bk-booking status-' + b.status);
    const top = el('div', 'bk-b-top');
    const when = night() ? fmtDay(b.start_at.slice(0, 10)) + ' → ' + fmtDay(b.end_at.slice(0, 10)) : b.start_at.slice(11, 16) + '–' + b.end_at.slice(11, 16);
    top.append(el('strong', 'bk-time', when), el('span', 'bk-src', SOURCE[b.source] || ''), el('span', 'tag bk-status', STATUS[b.status] || b.status));
    const who = el('div', 'bk-b-who'); who.append(el('b', null, b.customer_name));
    const tel = el('a', 'small', b.customer_phone); tel.href = 'tel:' + b.customer_phone; who.append(tel);
    const wa = el('a', 'small', 'WhatsApp'); wa.href = 'https://wa.me/' + b.customer_phone.replace(/\D/g, ''); wa.target = '_blank'; wa.rel = 'noopener'; who.append(wa);
    const what = el('div', 'small muted', [b.service, b.resource, b.guests > 1 ? b.guests + ' ' + copy().guests.toLowerCase() : '', b.price_minor ? money(b.price_minor) : ''].filter(Boolean).join(' · '));
    c.append(top, who, what);
    if (b.note) c.append(el('p', 'small bk-note', b.note));
    const acts = el('div', 'bk-actions');
    const btn = (label, status, cls) => { const x = el('button', 'btn btn-sm ' + (cls || 'btn-ghost'), label); x.type = 'button'; x.addEventListener('click', () => setStatus(b.id, status, x)); acts.append(x); };
    if (b.status === 'pending') { btn('Confirm', 'confirmed', 'btn-primary'); btn('Cancel', 'cancelled'); }
    else if (b.status === 'confirmed') { btn(night() ? 'Checked out' : 'Done', 'completed', 'btn-dark'); btn('No-show', 'no_show'); btn('Cancel', 'cancelled'); }
    if (acts.childElementCount) c.append(acts);
    return c;
  }
  async function setStatus(id, status, button) {
    button.disabled = true;
    try { await ctx.api(base() + '/bookings/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }); loadBoard(); }
    catch (error) { button.disabled = false; alertNote(error.message); }
  }
  const alertNote = msg => { const p = $('bk-public'); if (p) p.textContent = msg; };

  // ---------- New booking dialog ----------
  let pickedTime = '';
  function openNew() {
    if (!data?.services?.length) { location.hash = '#booking-setup'; return; }
    $('bk-f-service').replaceChildren(...data.services.filter(s => s.active).map(s => { const o = el('option', null, s.name + (night() ? ' · ' + money(s.price_minor) + '/night' : ' · ' + s.duration_min + ' min')); o.value = s.id; return o; }));
    $('bk-f-date').value = day || today(); $('bk-f-date').min = today();
    $('bk-f-out').value = addDays($('bk-f-date').value, 1);
    for (const id of ['bk-f-name', 'bk-f-phone', 'bk-f-note']) $(id).value = '';
    $('bk-f-guests').value = 1; $('bk-f-status').textContent = '';
    applyLabels(); $('bk-dialog').showModal(); checkAvailability();
  }
  async function checkAvailability() {
    pickedTime = '';
    const box = $('bk-f-slots'), note = $('bk-f-avail');
    const q = 'service_id=' + $('bk-f-service').value + '&date=' + $('bk-f-date').value + (night() ? '&check_out=' + $('bk-f-out').value : '');
    box.replaceChildren(); note.textContent = 'Checking…';
    try {
      const r = await ctx.api(base() + '/availability?' + q);
      if (r.kind === 'night') { note.textContent = r.rooms_left ? r.rooms_left + ' room(s) free · ' + r.nights + ' night(s) · ' + money(r.total_minor) : 'No rooms free for these dates.'; return; }
      note.textContent = r.slots.length ? '' : 'No free times on this day.';
      box.append(...r.slots.map(s => { const b = el('button', 'bk-slot', s.time); b.type = 'button'; b.addEventListener('click', () => { pickedTime = s.time; box.querySelectorAll('.bk-slot').forEach(x => x.classList.toggle('on', x === b)); }); return b; }));
    } catch (error) { note.textContent = error.message; }
  }
  async function saveBooking(event) {
    event.preventDefault();
    const status = $('bk-f-status');
    if (!night() && !pickedTime) { status.textContent = 'Pick a time.'; return; }
    status.textContent = 'Saving…';
    try {
      await ctx.api(base() + '/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service_id: Number($('bk-f-service').value), date: $('bk-f-date').value, time: pickedTime, check_out: $('bk-f-out').value, customer_name: $('bk-f-name').value, customer_phone: $('bk-f-phone').value, guests: Number($('bk-f-guests').value), note: $('bk-f-note').value }) });
      $('bk-dialog').close(); loadBoard();
    } catch (error) { status.textContent = error.message; }
  }

  async function load() {
    const id = ctx.restaurantId;
    try {
      const result = await ctx.api(base());
      if (!ctx || ctx.restaurantId !== id) return;
      data = { ...result, saved_category: result.profile.category };
      ctx.category = result.profile.category;
      applyLabels(); renderTypes(); renderHours(); renderResources(); renderServices(); renderBoardHints();
      if (location.hash === '#bookings') loadBoard();
    } catch (error) { const n = $('bk-note'); if (n) n.textContent = error.message; }
  }

  let wired = false;
  function wire() {
    if (wired) return; wired = true;
    document.querySelectorAll('[data-bk-range]').forEach(b => b.addEventListener('click', () => { range = b.dataset.bkRange; day = ''; $('bk-day').value = ''; loadBoard(); }));
    $('bk-day')?.addEventListener('change', e => { day = e.target.value; loadBoard(); });
    $('bk-new')?.addEventListener('click', openNew);
    document.querySelector('[data-bk-new-link]')?.addEventListener('click', () => setTimeout(openNew, 50));
    $('bk-res-add')?.addEventListener('click', () => openItem('resource'));
    $('bk-svc-add')?.addEventListener('click', () => openItem('service'));
    $('bk-item-form')?.addEventListener('submit', saveItem);
    $('bk-i-cancel')?.addEventListener('click', () => $('bk-item-dialog').close());
    $('bk-save')?.addEventListener('click', () => saveProfile(false).catch(() => {}));
    $('bk-form')?.addEventListener('submit', saveBooking);
    $('bk-f-cancel')?.addEventListener('click', () => $('bk-dialog').close());
    for (const id of ['bk-f-service', 'bk-f-date', 'bk-f-out']) $(id)?.addEventListener('change', () => { if (id === 'bk-f-date' && night() && $('bk-f-out').value <= $('bk-f-date').value) $('bk-f-out').value = addDays($('bk-f-date').value, 1); checkAvailability(); });
    window.addEventListener('hashchange', () => { if (!ctx) return; applyLabels(); if (location.hash === '#bookings') loadBoard(); });
    setInterval(() => { if (ctx && location.hash === '#bookings' && !document.hidden) loadBoard(); }, 60000);
  }

  window.mkBookings = {
    init(options) {
      ctx = { ...options }; data = null; day = ''; range = 'week';
      wire(); applyLabels(); load();
    },
  };
})();
