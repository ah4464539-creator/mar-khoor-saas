/*! Mar-Khoor landing page: the live desk in the hero. For the chosen business type it plays
 *  three short moments: a customer writes or calls, the AI answers, the result lands on the desk.
 *  Text only (no innerHTML). Plays once on load and again when the visitor picks a type. */
(() => {
  const nav = document.getElementById('lp-nav');
  const onScroll = () => nav && nav.classList.toggle('solid', window.scrollY > 10);
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();

  const laneIn = document.getElementById('lane-in'), laneAi = document.getElementById('lane-ai'), laneOut = document.getElementById('lane-out');
  if (!laneIn) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DESKS = {
    restaurant: { name: 'Lahore Grill', clock: '7:42 pm', rows: [
      ['WhatsApp · Ali', 'Family deal ki delivery Model Town?', 'Family deal is Rs 3,499 with a 1.5L drink. Delivery in 35–45 minutes. Shall I confirm?', 'Order #1044', 'Family deal · delivery · Rs 3,499'],
      ['Call · +92 300', 'Two zinger burgers for pickup at 8', 'Two Zinger Burgers, Rs 1,100. Ready for pickup at 8:00 pm.', 'Order #1045', 'Pickup 8:00 pm · Rs 1,100'],
      ['Website · Sana', 'Table for 4 on Friday night?', 'Friday at 8:30 pm is free for 4. Booked under Sana.', 'Table booking', 'Fri 8:30 pm · 4 guests'],
    ] },
    clinic: { name: 'City Care Clinic', clock: '9:05 am', rows: [
      ['WhatsApp · Hamza', 'Kal dentist ka time mil jayega?', 'Dr. Ayesha Khan is free tomorrow at 9:30 or 11:00. A check-up is Rs 2,500.', 'Appointment', 'Mon 9:30 · Dr. Ayesha Khan'],
      ['Call · +92 321', 'I need to move my appointment', 'Your visit is now Wednesday at 4:30 pm with Dr. Bilal. You will get a reminder.', 'Rescheduled', 'Wed 4:30 pm · Dr. Bilal Ahmed'],
      ['Website · Noor', 'Is parking available?', 'Yes, free parking behind the building. Please bring old reports.', 'Answered', 'From your notes · no staff needed'],
    ] },
    salon: { name: 'Glow Studio', clock: '11:20 am', rows: [
      ['WhatsApp · Maryam', 'Saturday haircut with Sana?', 'Sana is free Saturday at 12:00 or 3:00. A haircut is Rs 1,500, 45 minutes.', 'Booking', 'Sat 3:00 pm · Haircut · Sana'],
      ['Call · +92 333', 'Bridal makeup in December', 'Bridal makeup is Rs 25,000 with a 50% advance. Here are the bank details.', 'Advance pending', 'Rs 12,500 · screenshot received'],
      ['Website · Hira', 'Can I come at 5 instead?', 'Done, your facial is moved to 5:00 pm today with Maria.', 'Rescheduled', 'Today 5:00 pm · Facial'],
    ] },
    hotel: { name: 'Hunza View Hotel', clock: '3:10 am', rows: [
      ['WhatsApp · Omar', 'Room for 2 nights from Friday?', 'Deluxe room Rs 12,000 a night, breakfast included. Room 101 is free.', 'Reservation', 'Fri–Sun · Room 101 · 2 nights'],
      ['Call · +44 20', 'What time is check-in?', 'Check-in is from 2 pm and check-out by 12 noon. Late arrival is fine.', 'Answered', 'Guest question at 3 am'],
      ['Website · Lisa', 'Family suite for next week', 'The Family suite is free from Tuesday, Rs 20,000 a night. Shall I hold it?', 'Reservation', 'Tue–Thu · Family suite'],
    ] },
  };
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const wait = ms => new Promise(r => setTimeout(r, reduced ? 0 : ms));
  const show = async (lane, node) => { lane.append(node); await wait(30); node.classList.add('in'); };
  let run = 0;
  async function play(type) {
    const id = ++run, d = DESKS[type];
    document.getElementById('desk-name').textContent = d.name;
    document.getElementById('desk-clock').textContent = d.clock;
    laneIn.replaceChildren(); laneAi.replaceChildren(); laneOut.replaceChildren();
    for (const [from, said, reply, title, detail] of d.rows) {
      if (id !== run) return;
      const a = el('div', 'item from'); a.append(el('small', null, from), el('span', null, said)); await show(laneIn, a); await wait(650);
      if (id !== run) return;
      const b = el('div', 'item reply'); b.append(el('small', null, 'AI reply'), el('span', null, reply)); await show(laneAi, b); await wait(650);
      if (id !== run) return;
      const c = el('div', 'item done'); c.append(el('small', null, 'Confirmed'), el('b', null, title), el('span', null, detail)); await show(laneOut, c); await wait(500);
    }
  }
  const buttons = [...document.querySelectorAll('.switch button')];
  buttons.forEach(btn => btn.addEventListener('click', () => {
    buttons.forEach(x => x.setAttribute('aria-pressed', String(x === btn)));
    play(btn.dataset.type);
  }));
  play('restaurant');
})();
