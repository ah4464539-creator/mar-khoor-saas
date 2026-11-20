// Runs inside the Mar-Khoor chat iframe on an owner's own website. The panel stays open in the
// frame; "close" hides the frame on the host page through the embed script instead.
(() => {
  const assistant = document.querySelector('#assistant');
  if (!assistant || window.parent === window) return;
  assistant.addEventListener('toggle', () => {
    if (assistant.open) return;
    window.parent.postMessage({ source: 'mar-khoor-widget', type: 'close' }, '*');
    assistant.open = true;
  });
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.data?.source !== 'mar-khoor-embed') return;
    if (event.data.type === 'open') document.querySelector('#message')?.focus({ preventScroll: true });
  });
})();
