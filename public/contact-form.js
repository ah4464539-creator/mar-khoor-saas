// Mar-Khoor public Contact Us form. The server sends email; no tokens in browser.
(() => {
  const form = document.getElementById('mk-contact-form');
  if (!form) return;
  const send = document.getElementById('mk-contact-submit');
  const status = document.getElementById('mk-contact-feedback');
  const readiness = document.getElementById('mk-contact-readiness');
  const emailLink = '<a href="mailto:admin@mar-khoor.com?subject=Mar-Khoor%20Support%20Request">admin@mar-khoor.com</a>';
  const show = (text, type) => {
    status.textContent = text;
    status.dataset.type = type;
  };

  fetch('/api/public/contact/status', { cache: 'no-store' })
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (data?.available !== true) {
        readiness.innerHTML = 'The online form is currently unavailable. You can email our official address directly: ' + emailLink;
        readiness.hidden = false;
      }
    })
    .catch(() => { /* Fallback remains visible beside the form. */ });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity() || send.disabled) return;

    const values = Object.fromEntries(new FormData(form).entries());
    const data = {
      name: String(values.name || '').trim(),
      email: String(values.email || '').trim(),
      topic: String(values.topic || '').trim(),
      message: String(values.message || '').trim(),
      consent: form.elements.namedItem('consent')?.checked === true,
      website: String(values.website || ''),
    };
    send.disabled = true;
    send.textContent = 'Sending…';
    show('Sending your message securely…', 'pending');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch('/api/public/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
      });
      const reply = await response.json().catch(() => ({}));
      if (!response.ok || reply.accepted !== true) throw new Error(reply.error || 'Contact form is unavailable');
      show('Your request has been submitted to Mar-Khoor support. Please check your email for a response.', 'success');
      form.reset();
    } catch {
      show('We could not send your request through the online form. Please contact admin@mar-khoor.com directly.', 'error');
    } finally {
      clearTimeout(timeout);
      send.disabled = false;
      send.textContent = 'Send message';
    }
  });
})();
