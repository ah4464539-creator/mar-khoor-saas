// Mar-Khoor restaurant app: shows "New order" alerts sent by the server (Web Push),
// even when the dashboard is closed, and opens the Live orders screen on tap.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : '' }; }
  const url = typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/restaurant.html#order-desk';
  event.waitUntil(Promise.all([
    self.registration.showNotification(String(data.title || 'Mar-Khoor').slice(0, 80), {
      body: String(data.body || '').slice(0, 200), icon: '/app-icons/icon-192.png', badge: '/app-icons/badge-96.png',
      tag: String(data.tag || 'mk'), renotify: true, requireInteraction: true, vibrate: [300, 120, 300, 120, 300], data: { url },
    }),
    // Tell open dashboards to refresh and ring.
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => list.forEach(c => c.postMessage({ type: 'mk-push', tag: data.tag || '' }))),
  ]));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/restaurant.html#order-desk';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(c => new URL(c.url).pathname === '/restaurant.html');
    if (open) { open.navigate?.(url).catch(() => {}); return open.focus(); }
    return self.clients.openWindow(url);
  }));
});
