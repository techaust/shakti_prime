// The push service worker (docs/03-roadmap-appendix/phase1.md §8.1). Registered only when a person turns
// alerts on for this browser. It shows the alert the notify worker sent, whose words come from the
// message catalogue on the server, and opens the alert's screen on this site when it is tapped.

/** A path on this site, never another site's address. */
function sitePath(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : '/home';
}

self.addEventListener('push', (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    message = {};
  }
  if (typeof message.title !== 'string' || message.title === '') return;
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: typeof message.body === 'string' ? message.body : '',
      tag: typeof message.tag === 'string' ? message.tag : undefined,
      icon: '/icon.svg',
      data: { url: sitePath(message.url) },
    }),
  );
});

// Take hold of the pages already open, so a tab opened before this worker started can be moved.
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(sitePath(event.notification.data?.url), self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
      const open = windows.find((w) => w.url.startsWith(self.location.origin));
      if (open) {
        try {
          const moved = await open.navigate(url);
          await (moved ?? open).focus();
          return undefined;
        } catch {
          // A window this worker does not control cannot be moved: open the screen in a new one.
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
