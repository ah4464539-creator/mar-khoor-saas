// Forgot-password and reset-password views inside the restaurant login card.
(() => {
  const views = { login: document.querySelector('#login-view'), forgot: document.querySelector('#forgot-view'), reset: document.querySelector('#reset-view') };
  if (!views.login || !views.forgot || !views.reset) return;
  let resetToken = '';

  function say(element, text, tone) {
    element.textContent = text || '';
    element.className = 'auth-message' + (tone ? ' auth-' + tone : '');
    element.hidden = !text;
  }

  function show(name, focusSelector) {
    for (const [key, view] of Object.entries(views)) view.hidden = key !== name;
    const loginError = document.querySelector('#login-error');
    if (loginError) loginError.hidden = true; // never carry a stale sign-in error between views
    const target = focusSelector && document.querySelector(focusSelector);
    if (target) target.focus();
  }

  async function post(url, body) {
    let response;
    try {
      response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch {
      throw Error('Could not reach Mar-Khoor. Check your internet connection and try again.');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.error || 'Something went wrong. Please try again.');
    return data;
  }

  // Navigation between views.
  document.querySelector('#forgot-link')?.addEventListener('click', event => {
    event.preventDefault();
    const typed = document.querySelector('#email')?.value || '';
    document.querySelector('#forgot-email').value = typed;
    say(document.querySelector('#forgot-message'), '');
    show('forgot', '#forgot-email');
  });
  for (const link of document.querySelectorAll('.back-to-login')) {
    link.addEventListener('click', event => { event.preventDefault(); show('login', '#email'); });
  }

  // Request a reset link.
  const forgotForm = document.querySelector('#forgot-form');
  const forgotMessage = document.querySelector('#forgot-message');
  forgotForm.addEventListener('submit', async event => {
    event.preventDefault();
    const button = forgotForm.querySelector('button[type=submit]');
    button.disabled = true;
    button.textContent = 'Sending…';
    say(forgotMessage, '');
    try {
      const data = await post('/auth/password/forgot', { email: document.querySelector('#forgot-email').value.trim() });
      say(forgotMessage, data.message, 'success');
    } catch (error) {
      say(forgotMessage, error.message, 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Send reset link';
    }
  });

  // Choose a new password from the emailed link (#reset-token=...).
  const resetForm = document.querySelector('#reset-form');
  const resetMessage = document.querySelector('#reset-message');
  document.querySelector('#reset-show-password')?.addEventListener('change', function () {
    for (const id of ['#reset-password', '#reset-confirm']) document.querySelector(id).type = this.checked ? 'text' : 'password';
  });
  resetForm.addEventListener('submit', async event => {
    event.preventDefault();
    const password = document.querySelector('#reset-password').value;
    const confirm = document.querySelector('#reset-confirm').value;
    if (password.length < 12) return say(resetMessage, 'Password must be at least 12 characters.', 'error');
    if (password !== confirm) return say(resetMessage, 'The two passwords do not match.', 'error');
    const button = resetForm.querySelector('button[type=submit]');
    button.disabled = true;
    button.textContent = 'Updating…';
    say(resetMessage, '');
    try {
      await post('/auth/password/reset', { token: resetToken, password });
      resetToken = '';
      resetForm.reset();
      say(document.querySelector('#login-notice'), 'Your password has been updated. Please sign in with your new password.', 'success');
      show('login', '#email');
    } catch (error) {
      say(resetMessage, error.message, 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Update password';
    }
  });

  function readHash() {
    const match = /^#reset-token=([a-f0-9]{64})$/.exec(location.hash);
    if (match) {
      resetToken = match[1];
      // Remove the token from the address bar and history right away.
      history.replaceState(null, '', location.pathname + location.search);
      say(resetMessage, '');
      show('reset', '#reset-password');
    } else if (location.hash === '#forgot-password') {
      history.replaceState(null, '', location.pathname + location.search);
      show('forgot', '#forgot-email');
    }
  }
  window.addEventListener('hashchange', readHash);
  readHash();
})();
