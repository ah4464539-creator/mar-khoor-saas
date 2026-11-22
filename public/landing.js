/*! Mar-Khoor landing page: solid nav on scroll, and the hero phone that plays a short sample
 *  WhatsApp chat for the chosen business type. Text only (no innerHTML). */
(() => {
  const nav = document.getElementById('lp-nav');
  const onScroll = () => nav && nav.classList.toggle('solid', window.scrollY > 40);
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();

  const chat = document.getElementById('lp-chat');
  if (!chat) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const CHATS = {
    restaurant: { name: 'Lahore Grill', icon: '🍽️', lines: [
      ['me', 'Salam! Do you have any deals today?'],
      ['ai', 'Wa alaikum salam! Family deal: 2 biryani + karahi + 1.5L drink for Rs 3,499. Want it for delivery?'],
      ['me', 'Yes, deliver to Model Town please'],
      ['card', 'Order #1044 confirmed', 'Family deal · Rs 3,499 · Delivery in 35–45 min'],
    ] },
    clinic: { name: 'City Care Clinic', icon: '🩺', lines: [
      ['me', 'Can I see the dentist tomorrow?'],
      ['ai', 'Dr. Ayesha Khan is free tomorrow at 9:30, 11:00 and 4:30. Dental check-up is Rs 2,500.'],
      ['me', '9:30 please, name Hamza'],
      ['card', 'Appointment booked', 'Mon 9:30 · Dr. Ayesha Khan · Reminder 2 hours before'],
    ] },
    salon: { name: 'Glow Studio', icon: '✂️', lines: [
      ['me', 'Haircut with Sana on Saturday?'],
      ['ai', 'Sana is free Saturday at 12:00 and 3:00. A haircut takes 45 minutes, Rs 1,500.'],
      ['me', '3 pm works'],
      ['card', 'Booking confirmed', 'Sat 3:00 pm · Haircut with Sana · Rs 1,500'],
    ] },
    hotel: { name: 'Hunza View Hotel', icon: '🏨', lines: [
      ['me', 'Room for 2 nights from Friday?'],
      ['ai', 'Yes! Deluxe room Rs 12,000/night or Family suite Rs 20,000/night. Breakfast included.'],
      ['me', 'Deluxe please'],
      ['card', 'Reservation confirmed', 'Fri–Sun · Deluxe room · Check-in 2 pm'],
    ] },
  };
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  let run = 0, auto = null;
  const wait = ms => new Promise(r => setTimeout(r, reduced ? 0 : ms));
  async function play(type) {
    const id = ++run, c = CHATS[type];
    document.getElementById('lp-name').textContent = c.name;
    document.getElementById('lp-av').textContent = c.icon;
    chat.replaceChildren();
    for (const [who, a, b] of c.lines) {
      if (id !== run) return;
      if (who !== 'me') { const t = el('div', 'typing'); t.append(el('i'), el('i'), el('i')); chat.append(t); await wait(900); t.remove(); if (id !== run) return; }
      if (who === 'card') { const m = el('div', 'msg ai card'); m.append(el('b', null, '✅ ' + a), el('span', null, b)); chat.append(m); }
      else chat.append(el('div', 'msg ' + who, a));
      await wait(who === 'me' ? 700 : 1100);
    }
  }
  const buttons = [...document.querySelectorAll('.lp-type')];
  const order = buttons.map(b => b.dataset.type);
  const select = (type, manual) => {
    buttons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.type === type)));
    play(type);
    clearInterval(auto);
    if (!manual && !reduced) auto = setInterval(() => { const next = order[(order.indexOf(current()) + 1) % order.length]; select(next, false); }, 9000);
  };
  const current = () => (buttons.find(b => b.getAttribute('aria-pressed') === 'true') || buttons[0]).dataset.type;
  buttons.forEach(b => b.addEventListener('click', () => select(b.dataset.type, true)));
  select('restaurant', false);
})();
