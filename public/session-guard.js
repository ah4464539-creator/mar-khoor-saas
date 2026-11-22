// Runs before the page paints: with a saved sign-in, hide the login form until the session is checked,
// so a refresh goes straight back to the dashboard instead of flashing the login screen.
(function () {
  try {
    var key = 'mar-khoor.owner-session';
    var saved = localStorage.getItem(key) || sessionStorage.getItem(key);
    if (!saved || /^#reset-token=/.test(location.hash)) return;
    var root = document.documentElement;
    root.classList.add('resuming');
    // Never leave the page blank: show the login form if nothing happened after 10 seconds.
    setTimeout(function () { root.classList.remove('resuming'); }, 10000);
  } catch (e) {}
})();
