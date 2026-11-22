// Owner dashboard: business type, services/staff/rooms, opening hours and the bookings board.
// Plain DOM building only, no HTML strings. Started by restaurant.js through window.mkBookings.init().
(function () {
  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const TYPE_ICONS = { restaurant: '🍽️', clinic: '🩺', hotel: '🏨', salon: '✂️' };
  const COPY = {
    restaurant: { people: 'Guests', cat: 'Category', arrive: 'Seated', finish: 'Done', group: 'Restaurant', online: 'Take table bookings online (website, WhatsApp and AI calls)', nav: 'Table bookings', setup: 'Tables & hours', resHint: 'Tables or areas guests can book (optional).', svcHint: 'For example: Table for 2, Family table, Private room.', capacity: 'Tables of this kind', resLegend: 'Which tables', guests: 'Guests' },
    clinic: { people: 'Patients', cat: 'Specialty', arrive: 'Patient arrived', finish: 'Done', group: 'Clinic', online: 'Patients can book appointments online (website, WhatsApp and AI calls)', nav: 'Appointments', setup: 'Doctors & services', resHint: 'Doctors or specialists who see patients.', svcHint: 'For example: General check-up, Dental cleaning, Follow-up visit.', capacity: 'Patients at the same time', resLegend: 'Which doctors', guests: 'Patients' },
    salon: { people: 'Clients', cat: 'Category', arrive: 'Arrived', finish: 'Done', group: 'Salon', online: 'Clients can book appointments online (website, WhatsApp and AI calls)', nav: 'Appointments', setup: 'Services & staff', resHint: 'Stylists or staff who do the work.', svcHint: 'For example: Haircut, Facial, Bridal makeup.', capacity: 'Clients at the same time', resLegend: 'Who does it', guests: 'People' },
    hotel: { people: 'Guests', cat: 'Category', arrive: 'Check in', finish: 'Check out', group: 'Hotel', online: 'Guests can book rooms online (website, WhatsApp and AI calls)', nav: 'Reservations', setup: 'Rooms & rates', resHint: 'Each room by its number (101, 102…). Housekeeping uses these.', svcHint: 'Each room type with its price per night. Tick its rooms, or give a number of rooms.', capacity: 'Rooms of this type (if no rooms are ticked)', resLegend: 'Rooms of this type', guests: 'Guests' },
  };
  const STATUS = { pending: 'New', confirmed: 'Confirmed', checked_in: 'Arrived', completed: 'Done', cancelled: 'Cancelled', no_show: 'No-show' };
  const SOURCE = { owner: '🧑‍💼', website: '🌐', whatsapp: '💬', call: '📞' };
  let ctx = null, data = null, range = 'week', day = '', view = 'list', weekStart = '', reschedule = null;

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
    document.querySelectorAll('[data-biz-label="group"]').forEach(n => { n.textContent = c.group; });
    document.querySelectorAll('[data-biz-label="customers"]').forEach(n => { n.textContent = c.people; });
    $('customers')?.setAttribute('data-title', c.people);
    if (location.hash === '#customers') { const h = document.querySelector('#owner-heading'); if (h) h.textContent = c.people; }
    if ($('bk-enabled-text')) $('bk-enabled-text').textContent = c.online;
    $('bookings')?.setAttribute('data-title', c.nav);
    $('booking-setup')?.setAttribute('data-title', c.setup);
    if (location.hash === '#bookings' || location.hash === '#booking-setup') { const h = document.querySelector('#owner-heading'); if (h) h.textContent = location.hash === '#bookings' ? c.nav : c.setup; }
    const info = data?.types?.[type()];
    if ($('bk-res-title')) $('bk-res-title').textContent = info ? info.resources : 'Staff';
    if ($('bk-svc-title')) $('bk-svc-title').textContent = info ? info.services : 'Services';
    if ($('bk-res-hint')) $('bk-res-hint').textContent = c.resHint;
    if ($('bk-svc-hint')) $('bk-svc-hint').textContent = c.svcHint;
    const resCard = $('bk-resources')?.closest('.bk-card'); if (resCard) resCard.hidden = false;
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
      input.addEventListener('change', () => { data.profile.category = key; if (key !== 'restaurant') $('bk-enabled').checked = true; renderTypeLine(); applyLabels(); renderResources(); renderServices(); });
      label.append(input, el('span', 'bk-type-icon', TYPE_ICONS[key] || '•'), el('b', null, info.label));
      return label;
    }));
    renderTypeLine();
    $('bk-enabled').checked = Boolean(data.profile.bookings_enabled);
    $('bk-slot').value = String(data.profile.slot_minutes || 30);
  }
  function renderTypeLine() {
    const info = data?.types?.[type()];
    if ($('bk-type-name')) $('bk-type-name').textContent = info ? info.label : '';
    if ($('bk-type-icon')) $('bk-type-icon').textContent = TYPE_ICONS[type()] || '';
  }
  // Dashboard box for clinics, salons and hotels: the next bookings instead of food sales.
  async function loadOverview() {
    if (!ctx || type() === 'restaurant' || !$('bk-overview-list')) return;
    const t = today();
    try {
      const { bookings } = await ctx.api(base() + '/bookings?from=' + t + '&to=' + addDays(t, 6));
      const live = bookings.filter(b => !['cancelled', 'no_show', 'completed'].includes(b.status));
      const chip = (n, label, cls) => { const c = el('div', 'bk-chip ' + (cls || '')); c.append(el('b', null, String(n)), el('span', null, label)); return c; };
      $('bk-overview-summary').replaceChildren(chip(live.filter(b => b.status === 'pending').length, 'New', 'new'), chip(live.filter(b => b.start_at.slice(0, 10) === t).length, 'Today'), chip(live.length, 'Next 7 days'));
      $('bk-overview-title').textContent = 'Upcoming ' + copy().nav.toLowerCase();
      const list = live.slice(0, 6).map(card);
      $('bk-overview-list').replaceChildren(...(list.length ? list : [el('p', 'muted bk-none', data?.services?.length ? 'No upcoming bookings yet.' : 'Add your services first, then customers can book.')]));
    } catch (error) { $('bk-overview-list').replaceChildren(el('p', 'muted', error.message)); }
  }
  function renderHourRows(box, hours, prefix) {
    if (!box) return;
    box.replaceChildren(...DAYS.map((name, d) => {
      const r = (hours?.[d] || [])[0];
      const row = el('div', 'bk-hour-row'); row.dataset.day = d;
      const open = el('label', 'check bk-open'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = Boolean(r); open.append(cb, ' ' + name);
      const from = el('input', 'input'); from.type = 'time'; from.value = r ? m2t(r[0]) : '09:00'; from.setAttribute('aria-label', name + ' from');
      const to = el('input', 'input'); to.type = 'time'; to.value = r ? m2t(r[1]) : '17:00'; to.setAttribute('aria-label', name + ' to');
      const sync = () => { from.disabled = to.disabled = !cb.checked; row.classList.toggle('closed', !cb.checked); };
      cb.addEventListener('change', sync); sync();
      row.append(open, from, el('span', 'muted', 'to'), to);
      return row;
    }));
  }
  function readHourRows(box) {
    const out = {};
    box.querySelectorAll('.bk-hour-row').forEach(row => {
      const [cb, from, to] = [row.querySelector('input[type=checkbox]'), ...row.querySelectorAll('input[type=time]')];
      out[row.dataset.day] = cb.checked && from.value && to.value && t2m(to.value) > t2m(from.value) ? [[t2m(from.value), t2m(to.value)]] : [];
    });
    return out;
  }
  async function deleteItem() {
    if (!editing?.id) return;
    const status = $('bk-i-status');
    if (!window.confirm('Delete "' + $('bk-i-name').value + '"? If it already has bookings it is only switched off.')) return;
    status.textContent = 'Deleting…';
    try {
      const result = await ctx.api(base() + (editing.kind === 'service' ? '/services/' : '/resources/') + editing.id, { method: 'DELETE' });
      if (result.services) data.services = result.services;
      if (result.resources) data.resources = result.resources;
      renderResources(); renderServices(); renderBoardHints();
      $('bk-item-dialog').close();
    } catch (error) { status.textContent = error.message; }
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
    box.replaceChildren(...data.resources.map(r => tile(r.name, [r.specialty, r.note, r.hours ? 'Own schedule' : '', r.active ? '' : 'Not taking bookings'], () => openItem('resource', r), !r.active)));
    if (!data.resources.length) box.append(el('p', 'small muted bk-empty', 'Nothing added yet.'));
  }
  function renderServices() {
    const box = $('bk-services'); if (!box || !data) return;
    const names = new Map(data.resources.map(r => [r.id, r.name]));
    box.replaceChildren(...data.services.map(s => tile(s.name, [
      night() ? money(s.price_minor) + ' / night · ' + (s.resource_ids.length || s.capacity) + ' room' + ((s.resource_ids.length || s.capacity) === 1 ? '' : 's') : s.duration_min + ' min · ' + money(s.price_minor),
      s.category || '',
      s.resource_ids.length ? s.resource_ids.map(id => names.get(id)).filter(Boolean).join(', ') : '',
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
    $('bk-i-dep').value = item ? (item.deposit_minor || 0) / 100 : 0;
    $('bk-i-active').checked = item ? item.active : true;
    $('bk-i-dur-field').hidden = kind !== 'service' || night();
    $('bk-i-price-label').textContent = night() ? 'Price per night' : 'Price';
    $('bk-i-cap-label').textContent = copy().capacity;
    const resField = $('bk-i-res-field');
    resField.hidden = kind !== 'service' || !data.resources.length;
    $('bk-i-res-legend').textContent = copy().resLegend || 'Who does it';
    $('bk-i-res').replaceChildren(...data.resources.map(r => { const l = el('label', 'check'); const c = el('input'); c.type = 'checkbox'; c.value = r.id; c.checked = Boolean(item?.resource_ids?.includes(r.id)); l.append(c, ' ' + r.name); return l; }));
    $('bk-i-cat').value = item?.category || '';
    $('bk-i-cat-label').textContent = copy().cat + ' (optional)';
    $('bk-i-cat-field').hidden = kind !== 'service' || night();
    $('bk-cat-list').replaceChildren(...[...new Set(data.services.map(x => x.category).filter(Boolean))].map(c => { const o = el('option'); o.value = c; return o; }));
    $('bk-i-spec').value = item?.specialty || '';
    $('bk-i-spec-field').hidden = kind !== 'resource' || type() !== 'clinic';
    $('bk-i-hours-field').hidden = kind !== 'resource' || night();
    $('bk-i-own-hours').checked = Boolean(item?.hours);
    renderHourRows($('bk-i-hours'), item?.hours || data.profile.hours, 'bk-i');
    $('bk-i-hours').hidden = !item?.hours;
    $('bk-i-delete').hidden = !item;
    $('bk-i-status').textContent = '';
    dlg.showModal(); $('bk-i-name').focus();
  }
  async function saveItem(event) {
    event.preventDefault();
    const status = $('bk-i-status');
    const body = editing.kind === 'service'
      ? { name: $('bk-i-name').value, description: $('bk-i-desc').value, duration_min: Number($('bk-i-dur').value), price: Number($('bk-i-price').value), capacity: Number($('bk-i-cap').value), resource_ids: [...$('bk-i-res').querySelectorAll('input:checked')].map(i => Number(i.value)), active: $('bk-i-active').checked }
      : { name: $('bk-i-name').value, note: $('bk-i-note').value, active: $('bk-i-active').checked, specialty: $('bk-i-spec').value, hours: $('bk-i-own-hours').checked ? readHourRows($('bk-i-hours')) : null };
    if (editing.kind === 'service') { body.category = $('bk-i-cat').value; body.deposit = Number($('bk-i-dep').value) || 0; }
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
  const mondayOf = date => { const wd = new Date(date + 'T00:00:00Z').getUTCDay(); return addDays(date, wd === 0 ? -6 : 1 - wd); };
  function boardQuery(from, to) {
    const q = new URLSearchParams({ from, to });
    if ($('bk-search')?.value.trim()) q.set('q', $('bk-search').value.trim());
    if ($('bk-filter')?.value) q.set('status', $('bk-filter').value);
    return q.toString();
  }
  async function loadBoard() {
    if (!ctx) return;
    let [from, to] = rangeDates();
    if (view === 'week') { if (!weekStart) weekStart = mondayOf(today()); from = weekStart; to = addDays(weekStart, 6); $('bk-week-label').textContent = fmtDay(from) + ' – ' + fmtDay(to); }
    $('bk-weeknav').hidden = view !== 'week';
    document.querySelector('.bk-range').hidden = view === 'week';
    document.querySelectorAll('[data-bk-range]').forEach(b => b.classList.toggle('active', !day && b.dataset.bkRange === range));
    const list = $('bk-list');
    try {
      const { bookings } = await ctx.api(base() + '/bookings?' + boardQuery(from, to));
      if (view === 'week') renderWeek(bookings, from); else renderBoard(bookings, from, to);
    } catch (error) { list.replaceChildren(el('p', 'muted', error.message)); }
  }
  function renderBoard(bookings, from, to) {
    const list = $('bk-list'), counts = { pending: 0, confirmed: 0 };
    list.classList.remove('week');
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
  function renderWeek(bookings, from) {
    const list = $('bk-list');
    const nav = $('nav-booking-count'); if (nav) { const n = bookings.filter(b => b.status === 'pending').length; nav.hidden = !n; nav.textContent = n; }
    list.replaceChildren(...Array.from({ length: 7 }, (_, i) => {
      const date = addDays(from, i), items = bookings.filter(b => b.start_at.slice(0, 10) === date || (night() && b.start_at.slice(0, 10) < date && b.end_at.slice(0, 10) > date));
      const col = el('section', 'bk-day' + (date === today() ? ' is-today' : ''));
      const head = el('div', 'bk-day-head'); head.append(el('h3', null, fmtDay(date)), el('span', 'count', String(items.length)));
      col.append(head, ...(items.length ? items.map(card) : [el('p', 'small muted', 'Free')]));
      return col;
    }));
    list.classList.add('week');
  }
  async function exportCsv(path, name) {
    try {
      const r = await fetch(path, { headers: { Authorization: 'Bearer ' + (ctx.token?.() || '') } });
      if (!r.ok) throw Error('Export failed');
      const url = URL.createObjectURL(await r.blob());
      const a = el('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (error) { alertNote(error.message); }
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
    if (b.paid_minor || b.pending_payments) { const pay = el('div', 'small'); if (b.paid_minor) pay.append(el('span', 'tag tag-ok', 'Paid ' + money(b.paid_minor))); if (b.pending_payments) pay.append(' ', el('span', 'tag tag-warn', 'Payment to check')); c.append(pay); }
    if (b.note) c.append(el('p', 'small bk-note', b.note));
    const acts = el('div', 'bk-actions');
    const btn = (label, status, cls) => { const x = el('button', 'btn btn-sm ' + (cls || 'btn-ghost'), label); x.type = 'button'; x.addEventListener('click', () => setStatus(b.id, status, x)); acts.append(x); };
    const extra = (label, fn) => { const x = el('button', 'btn btn-sm btn-quiet', label); x.type = 'button'; x.addEventListener('click', fn); acts.append(x); };
    const c2 = copy();
    if (b.status === 'pending') { btn('Confirm', 'confirmed', 'btn-primary'); btn('Cancel', 'cancelled'); }
    else if (b.status === 'confirmed') { btn(c2.arrive, 'checked_in', 'btn-dark'); btn('No-show', 'no_show'); btn('Cancel', 'cancelled'); }
    else if (b.status === 'checked_in') { btn(c2.finish, 'completed', 'btn-dark'); }
    if (['pending', 'confirmed'].includes(b.status)) extra('Reschedule', () => openNew(b));
    extra('Payment', () => openPayments(b, c));
    extra('History', async () => {
      const box = c.querySelector('.bk-history') || c.appendChild(el('ul', 'bk-history small muted'));
      try { const { events } = await ctx.api(base() + '/bookings/' + b.id + '/history'); box.replaceChildren(...events.map(e => el('li', null, e.at + ' · ' + e.action + (e.detail ? ' · ' + e.detail : '')))); }
      catch (error) { box.replaceChildren(el('li', null, error.message)); }
    });
    if (acts.childElementCount) c.append(acts);
    return c;
  }
  async function setStatus(id, status, button) {
    button.disabled = true;
    try { await ctx.api(base() + '/bookings/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }); if (location.hash === '#bookings') loadBoard(); else loadOverview(); }
    catch (error) { button.disabled = false; alertNote(error.message); }
  }
  const alertNote = msg => { const p = $('bk-public'); if (p) p.textContent = msg; };

  // ---------- New booking dialog ----------
  let pickedTime = '';
  function fillResources() {
    const svc = data.services.find(x => x.id === Number($('bk-f-service').value));
    const people = svc && !night() ? data.resources.filter(r => r.active && svc.resource_ids.includes(r.id)) : [];
    $('bk-f-res-field').hidden = !people.length;
    $('bk-f-res-label').textContent = (data.types?.[type()]?.resource || 'Staff');
    const keep = $('bk-f-res').value;
    $('bk-f-res').replaceChildren(el('option', null, 'Anyone free'), ...people.map(r => { const o = el('option', null, r.name + (r.specialty ? ' · ' + r.specialty : '')); o.value = r.id; return o; }));
    $('bk-f-res').options[0].value = '';
    if (people.some(r => String(r.id) === keep)) $('bk-f-res').value = keep;
  }
  function openNew(existing) {
    reschedule = existing && existing.id ? existing : null;
    if (!data?.services?.length) { location.hash = '#booking-setup'; return; }
    $('bk-f-service').replaceChildren(...data.services.filter(s => s.active).map(s => { const o = el('option', null, s.name + (night() ? ' · ' + money(s.price_minor) + '/night' : ' · ' + s.duration_min + ' min')); o.value = s.id; return o; }));
    $('bk-f-date').value = day || today(); $('bk-f-date').min = today();
    $('bk-f-out').value = addDays($('bk-f-date').value, 1);
    for (const id of ['bk-f-name', 'bk-f-phone', 'bk-f-note']) $(id).value = '';
    $('bk-f-guests').value = 1; $('bk-f-status').textContent = '';
    if (reschedule) {
      if (reschedule.service_id) $('bk-f-service').value = reschedule.service_id;
      $('bk-f-date').value = reschedule.start_at.slice(0, 10) < today() ? today() : reschedule.start_at.slice(0, 10);
      if (night()) $('bk-f-out').value = reschedule.end_at.slice(0, 10);
      $('bk-f-name').value = reschedule.customer_name; $('bk-f-phone').value = reschedule.customer_phone;
    }
    for (const id of ['bk-f-name', 'bk-f-phone', 'bk-f-guests', 'bk-f-note']) $(id).closest('.field').hidden = Boolean(reschedule);
    $('bk-dialog-title').textContent = reschedule ? 'Reschedule booking #' + reschedule.id : 'New booking';
    $('bk-f-save').textContent = reschedule ? 'Move booking' : 'Save booking';
    applyLabels(); fillResources(); if (reschedule?.resource_id) $('bk-f-res').value = String(reschedule.resource_id);
    $('bk-dialog').showModal(); checkAvailability();
  }
  async function checkAvailability() {
    pickedTime = '';
    const box = $('bk-f-slots'), note = $('bk-f-avail');
    const q = 'service_id=' + $('bk-f-service').value + '&date=' + $('bk-f-date').value + (night() ? '&check_out=' + $('bk-f-out').value : '') + ($('bk-f-res').value ? '&resource_id=' + $('bk-f-res').value : '') + (reschedule ? '&exclude=' + reschedule.id : '');
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
      const res = $('bk-f-res').value ? Number($('bk-f-res').value) : null;
      if (reschedule) await ctx.api(base() + '/bookings/' + reschedule.id + '/reschedule', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service_id: Number($('bk-f-service').value), date: $('bk-f-date').value, time: pickedTime, check_out: $('bk-f-out').value, resource_id: res }) });
      else await ctx.api(base() + '/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service_id: Number($('bk-f-service').value), date: $('bk-f-date').value, time: pickedTime, check_out: $('bk-f-out').value, resource_id: res, customer_name: $('bk-f-name').value, customer_phone: $('bk-f-phone').value, guests: Number($('bk-f-guests').value), note: $('bk-f-note').value }) });
      $('bk-dialog').close(); if (location.hash === '#bookings') loadBoard(); else loadOverview();
    } catch (error) { status.textContent = error.message; }
  }

  async function saveTransfer() {
    const note = $('bk-transfer-note');
    note.textContent = 'Saving…';
    try { const r = await ctx.api(base() + '/contacts', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transfer_phone: $('bk-transfer').value.trim() }) }); note.textContent = r.transfer_phone ? 'Saved. The AI Caller can transfer callers to ' + r.transfer_phone + '.' : 'Removed.'; }
    catch (error) { note.textContent = error.message; }
  }
  const ROOM = { clean: 'Clean', dirty: 'Dirty', cleaning: 'Cleaning', occupied: 'Occupied', out_of_order: 'Out of order' };
  function renderHousekeeping() {
    const grid = $('hk-grid'); if (!grid || !data) return;
    if (!data.resources.length) { grid.replaceChildren(el('p', 'muted bk-none', 'Add your rooms in Rooms & rates first.')); return; }
    grid.replaceChildren(...data.resources.filter(r => r.active).map(r => {
      const st = r.room_status || 'clean';
      const box = el('div', 'hk-room ' + st);
      const types = data.services.filter(sv => sv.resource_ids.includes(r.id)).map(sv => sv.name).join(', ');
      box.append(el('strong', null, r.name), el('span', 'small muted', types || 'No room type'), el('span', 'tag', ROOM[st]));
      const btns = el('div', 'hk-btns');
      for (const next of ['clean', 'cleaning', 'dirty', 'out_of_order']) {
        if (next === st) continue;
        const b = el('button', 'btn btn-sm btn-ghost', ROOM[next]); b.type = 'button';
        b.addEventListener('click', async () => { b.disabled = true; try { const res = await ctx.api(base() + '/resources/' + r.id + '/room-status', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: next }) }); data.resources = res.resources; renderHousekeeping(); } catch (error) { b.disabled = false; alert(error.message); } });
        btns.append(b);
      }
      box.append(btns); return box;
    }));
  }
  async function loadHandovers() {
    const box = $('wa-handover'); if (!box || !ctx) return;
    try {
      const { handovers } = await ctx.api(base() + '/handovers');
      box.hidden = !handovers.length;
      $('wa-handover-list').replaceChildren(...handovers.map(h => {
        const row = el('div', 'wa-handover-row');
        const wa = el('a', null, '+' + h.customer); wa.href = 'https://wa.me/' + h.customer; wa.target = '_blank'; wa.rel = 'noopener';
        const back = el('button', 'btn btn-sm btn-primary', 'Let AI reply again'); back.type = 'button';
        back.addEventListener('click', async () => { back.disabled = true; try { await ctx.api(base() + '/handovers/' + encodeURIComponent(h.customer), { method: 'DELETE' }); loadHandovers(); } catch { back.disabled = false; } });
        row.append(wa, el('span', 'small muted', (h.reason || '') + ' · until ' + h.until.slice(11)), back);
        return row;
      }));
    } catch { box.hidden = true; }
  }
  const PAY_LABEL = { cash: 'Cash', card: 'Card', jazzcash: 'JazzCash', easypaisa: 'Easypaisa', raast: 'Raast', bank: 'Bank', other: 'Other' };
  async function openPayments(b, card) {
    let box = card.querySelector('.bk-pay');
    if (box) { box.remove(); return; }
    box = el('div', 'bk-pay'); card.append(box);
    const draw = payments => {
      box.replaceChildren();
      for (const p of payments) {
        const row = el('div', 'bk-pay-row');
        row.append(el('b', null, (p.kind === 'refund' ? '↩ Refund ' : '') + money(p.amount_minor)), el('span', null, PAY_LABEL[p.method] || p.method || ''), el('span', 'muted', p.reference || ''), el('span', 'tag' + (p.status === 'pending' ? ' tag-warn' : ''), p.status === 'pending' ? 'To check' : p.status === 'rejected' ? 'Rejected' : 'OK'));
        if (p.status === 'pending') for (const [label, st] of [['Received', 'confirmed'], ['Not received', 'rejected']]) {
          const x = el('button', 'btn btn-sm ' + (st === 'confirmed' ? 'btn-primary' : 'btn-ghost'), label); x.type = 'button';
          x.addEventListener('click', async () => { x.disabled = true; try { draw((await ctx.api(base() + '/bookings/' + b.id + '/payments/' + p.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: st }) })).payments); } catch (error) { x.disabled = false; alert(error.message); } });
          row.append(x);
        }
        box.append(row);
      }
      const form = el('div', 'bk-pay-form');
      const kind = el('select', 'input'); for (const [v, t] of [['payment', 'Payment'], ['refund', 'Refund']]) { const o = el('option', null, t); o.value = v; kind.append(o); }
      const amount = el('input', 'input'); amount.type = 'number'; amount.min = '0'; amount.step = '0.01'; amount.placeholder = 'Amount'; amount.value = b.price_minor && !payments.length ? b.price_minor / 100 : '';
      const method = el('select', 'input'); for (const [v, t] of Object.entries(PAY_LABEL)) { const o = el('option', null, t); o.value = v; method.append(o); }
      const ref = el('input', 'input'); ref.placeholder = 'Reference (optional)'; ref.maxLength = 80;
      const save = el('button', 'btn btn-sm btn-dark', 'Save'); save.type = 'button';
      const msg = el('span', 'small');
      save.addEventListener('click', async () => {
        save.disabled = true; msg.textContent = '';
        try { draw((await ctx.api(base() + '/bookings/' + b.id + '/payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: kind.value, amount: Number(amount.value), method: method.value, reference: ref.value }) })).payments); loadBoardOrOverview(); }
        catch (error) { msg.textContent = error.message; save.disabled = false; }
      });
      form.append(kind, amount, method, ref, save, msg); box.append(form);
    };
    try { draw((await ctx.api(base() + '/bookings/' + b.id + '/payments')).payments); } catch (error) { box.replaceChildren(el('p', 'small', error.message)); }
  }
  const loadBoardOrOverview = () => { if (location.hash === '#bookings') loadBoard(); else loadOverview(); };
  async function loadReport() {
    if (!ctx || !$('rp-kpis')) return;
    try {
      const { report: r } = await ctx.api(base() + '/report?days=' + $('rp-days').value);
      const chip = (n, label, cls) => { const c = el('div', 'bk-chip ' + (cls || '')); c.append(el('b', null, String(n)), el('span', null, label)); return c; };
      $('rp-kpis').replaceChildren(chip(r.total, 'Bookings'), chip(r.done, 'Completed'), chip(r.cancelled, 'Cancelled'), chip(r.no_show_rate + '%', 'No-show rate', r.no_show_rate > 15 ? 'new' : ''), chip(money(r.revenue_minor), 'Revenue (completed)'), chip(money(r.paid_minor - r.refunded_minor), 'Payments received'));
      const bars = (box, rows) => {
        const max = Math.max(1, ...rows.map(x => x[1]));
        box.replaceChildren(...(rows.length && rows.some(x => x[1]) ? rows.map(([label, n, extra]) => { const row = el('div', 'rp-bar'); const track = el('div', 'rp-track'); const fill = el('div', 'rp-fill'); fill.style.width = Math.round(n * 100 / max) + '%'; track.append(fill); row.append(el('span', null, label), track, el('span', 'muted', String(n) + (extra ? ' · ' + extra : ''))); return row; }) : [el('p', 'small muted', 'No bookings in this period.')]));
      };
      bars($('rp-services'), r.services.map(x => [x.name, x.count, x.revenue_minor ? money(x.revenue_minor) : '']));
      bars($('rp-days-chart'), ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => [d, r.weekdays[i]]));
      bars($('rp-sources'), Object.entries({ website: 'Website', whatsapp: 'WhatsApp', call: 'AI calls', owner: 'Added by you' }).map(([k, label]) => [label, r.sources[k] || 0]));
    } catch (error) { $('rp-kpis').replaceChildren(el('p', 'muted', error.message)); }
  }
  async function loadDiscounts() {
    if (!ctx || !$('dc-list')) return;
    try { drawDiscounts((await ctx.api(base() + '/discounts')).discounts); } catch {}
  }
  function drawDiscounts(list) {
    $('dc-list').replaceChildren(...list.map(d => {
      const row = el('div', 'cu-row');
      const t = el('button', 'btn btn-sm btn-ghost', d.active ? 'Turn off' : 'Turn on'); t.type = 'button';
      t.addEventListener('click', async () => { t.disabled = true; try { drawDiscounts((await ctx.api(base() + '/discounts/' + d.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !d.active }) })).discounts); } catch { t.disabled = false; } });
      row.append(el('b', null, d.code), el('span', null, d.percent + '% off'), el('span', 'muted', d.valid_to ? 'until ' + d.valid_to : 'no end date'), el('span', 'muted', d.uses + ' used'), el('span', 'tag' + (d.active ? ' tag-ok' : ''), d.active ? 'On' : 'Off'), t);
      return row;
    }));
  }
  async function addDiscount() {
    const note = $('dc-note'); note.textContent = 'Saving…';
    try { drawDiscounts((await ctx.api(base() + '/discounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: $('dc-code').value, percent: Number($('dc-percent').value), valid_to: $('dc-to').value }) })).discounts); note.textContent = 'Added.'; $('dc-code').value = ''; $('dc-percent').value = ''; }
    catch (error) { note.textContent = error.message; }
  }
  async function loadTeam() {
    if (!ctx || !$('tm-list') || document.body.dataset.role === 'staff') return;
    try {
      const { team } = await ctx.api(base() + '/team');
      $('tm-list').replaceChildren(...team.map(m => {
        const row = el('div', 'cu-row'); row.append(el('b', null, m.email), el('span', 'tag' + (m.role === 'admin' ? ' tag-ok' : ''), m.role === 'admin' ? 'Owner' : 'Staff'));
        if (m.role === 'staff') { const x = el('button', 'btn btn-sm btn-ghost', 'Remove'); x.type = 'button'; x.addEventListener('click', async () => { if (!window.confirm('Remove ' + m.email + ' from your team?')) return; x.disabled = true; try { await ctx.api(base() + '/team/' + m.id, { method: 'DELETE' }); loadTeam(); } catch { x.disabled = false; } }); row.append(x); }
        return row;
      }));
    } catch {}
  }
  async function addStaff() {
    const note = $('tm-note'); note.textContent = 'Adding…';
    try { const r = await ctx.api(base() + '/team', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: $('tm-email').value, password: $('tm-pass').value }) }); note.textContent = r.existing ? 'Added. They sign in with their existing password.' : 'Added. Share the email and password with them privately.'; $('tm-email').value = ''; $('tm-pass').value = ''; loadTeam(); }
    catch (error) { note.textContent = error.message; }
  }
  async function loadCustomers() {
    if (!ctx || !$('cu-rows')) return;
    const q = $('cu-search').value.trim();
    try {
      const { customers } = await ctx.api(base() + '/customers' + (q ? '?q=' + encodeURIComponent(q) : ''));
      $('cu-note').textContent = customers.length ? customers.length + ' ' + copy().people.toLowerCase() : 'Nobody has booked yet.';
      $('cu-rows').replaceChildren(...customers.map(cu => {
        const tr = el('tr'); tr.tabIndex = 0;
        for (const v of [cu.name, cu.phone, cu.bookings, cu.visits, cu.missed, money(cu.spent_minor), cu.last_at ? fmtDay(cu.last_at.slice(0, 10)) : '—', cu.next_at ? fmtDay(cu.next_at.slice(0, 10)) + ' ' + cu.next_at.slice(11, 16) : '—']) tr.append(el('td', null, String(v)));
        const open = () => openCustomer(cu);
        tr.addEventListener('click', open); tr.addEventListener('keydown', e => { if (e.key === 'Enter') open(); });
        return tr;
      }));
    } catch (error) { $('cu-note').textContent = error.message; }
  }
  async function openCustomer(cu) {
    $('cu-detail').hidden = false; $('cu-detail-title').textContent = cu.name + ' · ' + cu.phone;
    const list = $('cu-detail-list'); list.replaceChildren(el('p', 'muted', 'Loading…'));
    try {
      const { bookings } = await ctx.api(base() + '/customers/' + encodeURIComponent(cu.phone));
      list.replaceChildren(...bookings.map(b => { const row = el('div', 'cu-row'); row.append(el('b', null, '#' + b.id), el('span', null, b.start_at), el('span', null, b.service || ''), el('span', 'tag', STATUS[b.status] || b.status), el('span', null, b.price_minor ? money(b.price_minor) : '')); if (b.note) row.append(el('small', 'muted', b.note)); return row; }));
      $('cu-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) { list.replaceChildren(el('p', 'muted', error.message)); }
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
      if (location.hash === '#customers') loadCustomers();
      if (location.hash === '#housekeeping') renderHousekeeping();
      if (location.hash === '#reports') loadReport();
      if (document.body.dataset.role !== 'staff') { loadDiscounts(); loadTeam(); }
      if (location.hash === '#whatsapp-inbox-view') loadHandovers();
      if ($('bk-transfer')) $('bk-transfer').value = result.transfer_phone || '';
      if (!location.hash || location.hash === '#owner-overview') loadOverview();
    } catch (error) { const n = $('bk-note'); if (n) n.textContent = error.message; }
  }

  let wired = false;
  function wire() {
    if (wired) return; wired = true;
    document.querySelectorAll('[data-bk-range]').forEach(b => b.addEventListener('click', () => { range = b.dataset.bkRange; day = ''; $('bk-day').value = ''; loadBoard(); }));
    $('bk-day')?.addEventListener('change', e => { day = e.target.value; loadBoard(); });
    $('bk-new')?.addEventListener('click', () => openNew());
    let searchTimer;
    $('bk-search')?.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadBoard, 350); });
    $('bk-filter')?.addEventListener('change', loadBoard);
    document.querySelectorAll('[data-bk-view]').forEach(b => b.addEventListener('click', () => { view = b.dataset.bkView; document.querySelectorAll('[data-bk-view]').forEach(x => x.classList.toggle('active', x === b)); loadBoard(); }));
    $('bk-prev')?.addEventListener('click', () => { weekStart = addDays(weekStart || mondayOf(today()), -7); loadBoard(); });
    $('bk-next')?.addEventListener('click', () => { weekStart = addDays(weekStart || mondayOf(today()), 7); loadBoard(); });
    $('bk-export')?.addEventListener('click', () => { const [from, to] = view === 'week' ? [weekStart, addDays(weekStart, 6)] : rangeDates(); exportCsv(base() + '/bookings.csv?' + boardQuery(from, to), 'bookings-' + from + '.csv'); });
    let cuTimer;
    $('cu-search')?.addEventListener('input', () => { clearTimeout(cuTimer); cuTimer = setTimeout(loadCustomers, 350); });
    $('cu-export')?.addEventListener('click', () => exportCsv(base() + '/customers.csv' + ($('cu-search').value.trim() ? '?q=' + encodeURIComponent($('cu-search').value.trim()) : ''), copy().people.toLowerCase() + '.csv'));
    $('cu-detail-close')?.addEventListener('click', () => { $('cu-detail').hidden = true; });
    $('bk-i-delete')?.addEventListener('click', deleteItem);
    $('bk-transfer-save')?.addEventListener('click', saveTransfer);
    $('rp-days')?.addEventListener('change', loadReport);
    $('dc-add')?.addEventListener('click', addDiscount);
    $('tm-add')?.addEventListener('click', addStaff);
    $('bk-i-own-hours')?.addEventListener('change', e => { $('bk-i-hours').hidden = !e.target.checked; });
    $('bk-f-res')?.addEventListener('change', checkAvailability);
    document.querySelector('[data-bk-new-link]')?.addEventListener('click', () => setTimeout(openNew, 50));
    $('bk-res-add')?.addEventListener('click', () => openItem('resource'));
    $('bk-svc-add')?.addEventListener('click', () => openItem('service'));
    $('bk-item-form')?.addEventListener('submit', saveItem);
    $('bk-i-cancel')?.addEventListener('click', () => $('bk-item-dialog').close());
    $('bk-save')?.addEventListener('click', () => saveProfile(false).catch(() => {}));
    $('bk-form')?.addEventListener('submit', saveBooking);
    $('bk-f-cancel')?.addEventListener('click', () => $('bk-dialog').close());
    $('bk-f-service')?.addEventListener('change', fillResources);
    for (const id of ['bk-f-service', 'bk-f-date', 'bk-f-out']) $(id)?.addEventListener('change', () => { if (id === 'bk-f-date' && night() && $('bk-f-out').value <= $('bk-f-date').value) $('bk-f-out').value = addDays($('bk-f-date').value, 1); checkAvailability(); });
    window.addEventListener('hashchange', () => { if (!ctx) return; applyLabels(); if (location.hash === '#housekeeping') renderHousekeeping(); if (location.hash === '#reports') loadReport(); if (location.hash === '#whatsapp-inbox-view') loadHandovers(); if (location.hash === '#customers') loadCustomers(); if (location.hash === '#bookings') loadBoard(); if (!location.hash || location.hash === '#owner-overview') loadOverview(); });
    $('bk-type-change')?.addEventListener('click', () => { const g = $('bk-type-grid'); g.hidden = !g.hidden; $('bk-type-change').textContent = g.hidden ? 'Wrong type? Change' : 'Keep this type'; });
    setInterval(() => { if (ctx && location.hash === '#bookings' && !document.hidden) loadBoard(); }, 60000);
  }

  window.mkBookings = {
    init(options) {
      ctx = { ...options }; data = null; day = ''; range = 'week';
      wire(); applyLabels(); load();
    },
  };
})();
