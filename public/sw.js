// Minimal service worker. Android Chrome can only show notifications through a
// service worker (new Notification() throws there), so alerts go through this.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Focus the calculator (or open it) when the alert is tapped
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) =>
      windows.length > 0 ? windows[0].focus() : self.clients.openWindow(self.registration.scope)
    )
  );
});
