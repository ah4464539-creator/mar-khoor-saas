/*! Call forwarding steps for restaurant owners: their phone company switches forwarding on,
 *  so we show the ready-made dial codes with their AI number, a Copy button and a tap-to-dial link. */
(() => {
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const clean = number => { const digits = String(number || '').replace(/[^\d+]/g, ''); return /^\+?\d{6,16}$/.test(digits) ? (digits.startsWith('+') ? digits : '+' + digits) : null; };

  function codeRow(label, code) {
    const row = el('div', 'fwd-code');
    const text = el('div');
    text.append(el('span', 'fwd-label', label), el('code', null, code));
    const copy = el('button', 'btn btn-quiet btn-sm', 'Copy');
    copy.type = 'button';
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(code); copy.textContent = 'Copied'; } catch { copy.textContent = 'Select and copy'; }
      setTimeout(() => { copy.textContent = 'Copy'; }, 2000);
    });
    const dial = el('a', 'btn btn-quiet btn-sm', 'Dial');
    dial.href = 'tel:' + code.replace(/\*/g, '%2A').replace(/#/g, '%23');
    row.append(text, copy, dial);
    return row;
  }

  /** Renders the steps into `box`. aiNumber: the restaurant's AI number, or null while it is not ready. */
  function render(box, { aiNumber, restaurantNumber } = {}) {
    if (!box) return;
    const number = clean(aiNumber);
    const card = el('div', 'fwd-card');
    card.append(el('strong', null, 'Turn on call forwarding (1 minute)'));
    if (!number) {
      card.append(el('p', 'hint', 'Your AI phone number appears here once your plan is paid and the number is ready. Then come back: you will dial one short code from your restaurant phone and the AI starts answering.'));
      box.replaceChildren(card);
      return;
    }
    card.append(el('p', 'hint', 'From the restaurant phone' + (restaurantNumber ? ' (' + restaurantNumber + ')' : '') + ', dial one of these codes. Your phone company then sends calls to your AI number ' + number + '. Only you can switch this on: we cannot do it for you.'));
    const list = el('ol', 'fwd-steps');
    const step = (title, ...rows) => { const li = el('li'); li.append(el('span', null, title), ...rows); list.append(li); };
    step('AI answers every call:', codeRow('All calls', '**21*' + number + '#'));
    step('Or the AI answers only when you are busy or do not pick up:', codeRow('When busy', '**67*' + number + '#'), codeRow('When not answered', '**61*' + number + '#'));
    step('Call your restaurant number from another phone to test it.');
    step('To switch forwarding off again:', codeRow('Turn off', '##21#'));
    card.append(list, el('p', 'hint', 'These codes work on mobile phones (Jazz, Zong, Telenor, Ufone, Etisalat, du and most networks). On a landline, ask your phone company to forward calls to ' + number + '.'));
    box.replaceChildren(card);
  }

  window.mkForwarding = { render };
})();
