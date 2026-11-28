/*! Mar-Khoor homepage hero "Orbit": restaurant, clinic, salon and hotel circle the AI desk.
 *  Every few seconds the next one comes to the front, the accent colour changes and its booking
 *  card flips in. Also reveals the animated channels cards. Text only (no innerHTML). */
(() => {
  const hero = document.getElementById('orbit-hero');
  if (!hero) return;
  const DESKS = [
    { key: 'restaurant', word: 'restaurant', colour: '#F08A2E', icon: 'ob-pot', biz: 'Lahore Grill', title: 'Order #1044 confirmed', detail: 'Family deal · delivery · Rs 3,499' },
    { key: 'clinic', word: 'clinic', colour: '#7FD6D0', icon: 'ob-plus', biz: 'City Care Clinic', title: 'Appointment booked', detail: 'Mon 9:30 · Dr. Ayesha Khan' },
    { key: 'salon', word: 'salon', colour: '#F783AC', icon: 'ob-scissors', biz: 'Glow Studio', title: 'Booking confirmed', detail: 'Sat 3:00 pm · Haircut · Sana' },
    { key: 'hotel', word: 'hotel', colour: '#9DB8FF', icon: 'ob-key', biz: 'Hunza View Hotel', title: 'Reservation held', detail: 'Fri–Sun · Room 101 · 2 nights' },
  ];
  const svgNS = 'http://www.w3.org/2000/svg';
  const sys = document.getElementById('ob-sys'), ring = document.getElementById('ob-ring');
  const card = document.getElementById('ob-card'), word = document.getElementById('ob-word');
  const tabs = [...hero.querySelectorAll('.ob-tabs button')];
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  const planets = DESKS.map((d, i) => {
    const p = el('div', 'ob-planet'); p.style.transform = 'rotate(' + i * 90 + 'deg)'; p.style.setProperty('--a', i * 90 + 'deg');
    const pl = el('div', 'ob-pl'); pl.style.color = d.colour;
    const svg = document.createElementNS(svgNS, 'svg'); svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(svgNS, 'use'); use.setAttribute('href', '#' + d.icon);
    svg.append(use); pl.append(svg); p.append(pl); ring.append(p); return p;
  });

  const tick = document.getElementById('ob-tick');
  for (let r = 0; r < 4; r++) for (const d of DESKS) tick.append(el('span', null, d.biz + ' — ' + d.title + ' · ' + d.detail));

  let now = 0, turns = 0, timer;
  function show(i) {
    turns += ((i - now) % 4 + 4) % 4; now = i;
    const d = DESKS[i];
    sys.style.setProperty('--rot', -turns * 90 + 'deg');
    hero.style.setProperty('--oc', d.colour);
    planets.forEach((p, j) => p.classList.toggle('now', j === i));
    tabs.forEach((b, j) => b.setAttribute('aria-pressed', String(j === i)));
    word.classList.add('out');
    setTimeout(() => { word.textContent = d.word; word.classList.remove('out'); }, 300);
    card.classList.remove('flip'); void card.offsetWidth; card.classList.add('flip');
    setTimeout(() => { card.replaceChildren(el('small', null, d.biz), el('b', null, '✓ ' + d.title), el('span', null, d.detail)); }, 300);
  }
  const start = () => { clearInterval(timer); timer = setInterval(() => show((now + 1) % 4), 3200); };
  tabs.forEach((b, i) => b.addEventListener('click', () => { show(i); start(); }));
  show(0); start();

  // Channels: reveal the heading words and cards when they scroll into view; run the call timer.
  const io = new IntersectionObserver(entries => entries.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }), { threshold: 0.2 });
  document.querySelectorAll('#channels h2, #channels .chc').forEach(n => io.observe(n));
  const clock = document.getElementById('ch-clock');
  if (clock) { let s = 0; setInterval(() => { s = (s + 1) % 60; clock.textContent = '00:' + String(s).padStart(2, '0'); }, 1000); }
})();
