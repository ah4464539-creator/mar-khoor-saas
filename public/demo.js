/*! Mar-Khoor landing page demos: sample conversations for AI Calling, WhatsApp AI and the
 *  Website Assistant, played as animations (optionally spoken with the browser's own voices). */
(() => {
  const root = document.getElementById('demo');
  if (!root) return;
  const stage = root.querySelector('.demo-stage');
  const steps = root.querySelector('.demo-steps');
  const playBtn = root.querySelector('#demo-play');
  const soundBtn = root.querySelector('#demo-sound');
  const tabs = [...root.querySelectorAll('.demo-tab')];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  const DEMOS = {
    calling: {
      steps: ['A customer calls your restaurant number', 'The AI answers in a natural female voice and reads your live menu', 'It confirms items, total and pickup time', 'The order lands in your order desk'],
      lines: [
        ['ai', 'Assalam o alaikum, Lahore Grill. What would you like to order today?', 1],
        ['me', 'One zinger burger and large fries, please.', 1],
        ['ai', 'One Zinger Burger, Rs 650, and Large Fries, Rs 350. Your total is Rs 1,000. Pickup or delivery?', 2],
        ['me', 'Pickup at eight.', 2],
        ['ai', 'Done. Order 1044 will be ready at 8 pm. We will text you the tracking link. Thank you!', 3],
      ],
      order: ['#1044', 'AI call · Pickup 8:00 pm', 'Zinger Burger, Large Fries', 'Rs 1,000'],
    },
    whatsapp: {
      steps: ['A customer messages your WhatsApp in their own language', 'The AI replies with menu items and prices', 'It takes the address and payment choice', 'The order lands in your order desk with a tracking link'],
      lines: [
        ['me', 'Assalam o alaikum, 2 chicken karahi aur 4 naan chahiye', 1],
        ['ai', 'Walaikum assalam! 2 × Chicken Karahi (Rs 1,600) + 4 × Naan (Rs 60) = Rs 3,440. Delivery ya pickup?', 1],
        ['me', 'Delivery, DHA Phase 5', 2],
        ['ai', 'Order #1043 confirmed ✅\nCash on delivery · about 35 minutes.\nTrack: mar-khoor.com/track', 3],
      ],
      order: ['#1043', 'WhatsApp · Delivery', '2 Chicken Karahi, 4 Naan', 'Rs 3,440'],
    },
    assistant: {
      steps: ['A visitor opens the chat on your website', 'The AI suggests dishes from your real menu', 'It adds them to the cart', 'The customer checks out in one tap'],
      lines: [
        ['me', 'Do you have something vegetarian?', 1],
        ['ai', 'Yes: Daal Makhani (Rs 750) and Paneer Tikka (Rs 950). Shall I add one?', 1],
        ['me', 'Add Paneer Tikka', 2],
        ['ai', 'Added ✅ Your cart: Paneer Tikka · Rs 950.', 3],
      ],
      chip: 'Checkout',
      order: ['#1045', 'Website · Delivery', 'Paneer Tikka', 'Rs 950'],
    },
  };

  let current = 'calling', run = 0, sound = false, playing = false;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, reduced ? 0 : ms));

  // Prefer the most natural female voice the visitor's device offers (Edge/Windows "Natural"
  // voices, Apple Samantha/Ava, Google female), then any female English voice.
  function femaleVoice() {
    const voices = speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang));
    const female = /female|woman|aria|jenny|ava|emma|michelle|sonia|libby|natasha|samantha|victoria|karen|moira|tessa|fiona|zira|serena|allison|susan/i;
    const natural = /natural|neural|online|premium|enhanced/i;
    return voices.find(v => natural.test(v.name) && female.test(v.name))
      || voices.find(v => /google uk english female/i.test(v.name))
      || voices.find(v => female.test(v.name))
      || voices[0] || null;
  }
  function speak(text, who) {
    if (!sound || !('speechSynthesis' in window)) return Promise.resolve(false);
    return new Promise(resolve => {
      const u = new SpeechSynthesisUtterance(text.replace(/[✅×]/g, ' ').replace(/Rs /g, 'rupees '));
      const voice = femaleVoice();
      if (who === 'ai' && voice) u.voice = voice;
      u.rate = 1; u.pitch = who === 'ai' ? 1.05 : 0.9;
      u.onend = u.onerror = () => resolve(true);
      speechSynthesis.speak(u);
    });
  }

  function frame(kind) {
    stage.replaceChildren();
    if (kind === 'calling') {
      const phone = el('div', 'demo-phone'), screen = el('div', 'demo-screen call demo-call');
      const av = el('div', 'demo-call-av', 'LG');
      const wave = el('div', 'demo-wave'); for (let i = 0; i < 22; i++) wave.append(el('span'));
      const time = el('div', 'demo-call-time', 'AI Caller · 00:00');
      screen.append(av, el('h4', '', 'Lahore Grill'), time, wave, el('div', 'demo-transcript'), el('div', 'demo-hang', '✆'));
      phone.append(screen); stage.append(phone);
      return { log: screen.querySelector('.demo-transcript'), av, wave, time, phone };
    }
    if (kind === 'whatsapp') {
      const phone = el('div', 'demo-phone'), screen = el('div', 'demo-screen');
      const bar = el('div', 'demo-bar'); const who = el('div');
      who.append(document.createTextNode('Lahore Grill'), el('small', '', 'Business account · AI replies'));
      bar.append(el('div', 'demo-av', 'LG'), who);
      screen.append(bar, el('div', 'demo-log')); phone.append(screen); stage.append(phone);
      return { log: screen.querySelector('.demo-log'), phone };
    }
    const browser = el('div', 'demo-browser');
    const url = el('div', 'demo-url'); url.append(el('i'), el('i'), el('i'), el('span', '', 'lahoregrill.com'));
    const site = el('div', 'demo-site'); const dishes = el('div', 'demo-dishes');
    for (const d of ['Chicken Karahi', 'Seekh Kebab', 'Daal Makhani', 'Paneer Tikka']) dishes.append(el('div', '', d));
    site.append(el('h4', '', 'Lahore Grill'), el('p', '', 'Order online · Delivery & pickup'), dishes);
    const widget = el('div', 'demo-widget'); widget.append(el('header', '', 'Order with AI'), el('div', 'demo-log'));
    browser.append(url, site, widget); stage.append(browser);
    return { log: widget.querySelector('.demo-log'), phone: browser };
  }

  function setStep(n) { [...steps.children].forEach((li, i) => li.classList.toggle('on', i < n + 1 && i <= n)); }
  function renderSteps(list) {
    steps.replaceChildren(...list.map((text, i) => { const li = el('li'); li.append(el('b', '', String(i + 1)), el('span', '', text)); return li; }));
  }
  function trim(log, max) { while (log.children.length > max) log.firstElementChild.remove(); }

  async function play() {
    const id = ++run; playing = true; playBtn.textContent = '■ Stop';
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    const demo = DEMOS[current]; renderSteps(demo.steps);
    const ui = frame(current); setStep(0);
    let seconds = 0, waveTimer = null, clock = null, talking = false;
    if (ui.wave) {
      waveTimer = setInterval(() => { for (const bar of ui.wave.children) bar.style.height = (talking ? 6 + Math.random() * 26 : 4 + Math.random() * 4) + 'px'; ui.av.classList.toggle('talk', talking); }, 120);
      clock = setInterval(() => { seconds++; ui.time.textContent = 'AI Caller · 00:' + String(seconds).padStart(2, '0'); }, 1000);
    }
    try {
      await sleep(700);
      for (const [who, text, step] of demo.lines) {
        if (id !== run) return;
        setStep(step);
        if (current !== 'calling') {
          const typing = el('div', 'demo-typing' + (who === 'me' ? ' me' : '')); typing.append(el('i'), el('i'), el('i'));
          ui.log.append(typing); trim(ui.log, 6);
          await sleep(Math.min(1800, 500 + text.length * 18)); typing.remove();
          if (id !== run) return;
          const msg = el('div', 'demo-msg ' + who);
          if (who === 'ai') msg.append(el('small', '', 'Mar-Khoor AI'));
          msg.append(document.createTextNode(text)); ui.log.append(msg); trim(ui.log, 6);
          const spoke = await speak(text, who);
          if (!spoke) await sleep(900 + text.length * 22);
        } else {
          const line = el('div', 'demo-line ' + who);
          line.append(el('small', '', who === 'ai' ? 'AI Caller' : 'Customer'), document.createTextNode(text));
          talking = who === 'ai'; ui.log.append(line); trim(ui.log, 4);
          const spoke = await speak(text, who);
          if (!spoke) await sleep(1100 + text.length * 30);
          talking = false; await sleep(300);
        }
      }
      if (id !== run) return;
      if (demo.chip) { ui.log.append(el('div', 'demo-chip', demo.chip)); await sleep(900); }
      setStep(3);
      const [num, channel, items, total] = demo.order;
      const card = el('div', 'demo-order'); const head = el('strong'); head.append(document.createTextNode('New order ' + num), el('span', 'tag', 'New'));
      card.append(head, el('div', 'muted', channel), el('div', '', items), el('strong', '', total));
      stage.append(card);
      await sleep(2600);
    } finally {
      clearInterval(waveTimer); clearInterval(clock);
      if (id === run) { playing = false; playBtn.textContent = '↻ Play again'; }
    }
  }
  function stop() { run++; playing = false; if ('speechSynthesis' in window) speechSynthesis.cancel(); playBtn.textContent = '▶ Play demo'; }

  tabs.forEach(tab => tab.addEventListener('click', () => {
    current = tab.dataset.demo;
    tabs.forEach(t => t.setAttribute('aria-selected', String(t === tab)));
    play();
  }));
  playBtn.addEventListener('click', () => (playing ? stop() : play()));
  if (!('speechSynthesis' in window)) soundBtn.hidden = true;
  soundBtn.addEventListener('click', () => {
    sound = !sound; soundBtn.setAttribute('aria-pressed', String(sound));
    soundBtn.textContent = sound ? '🔊 Sound on' : '🔇 Sound off';
    if ('speechSynthesis' in window) speechSynthesis.getVoices();
    play();
  });
  renderSteps(DEMOS[current].steps); frame(current);
  // Start when the section scrolls into view (silent until the visitor turns sound on).
  new IntersectionObserver((entries, observer) => {
    if (entries.some(e => e.isIntersecting)) { observer.disconnect(); play(); }
  }, { threshold: 0.35 }).observe(root);
})();
