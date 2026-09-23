const CACHE_NAME = 'taskflow-v8';
const ASSETS = ['./index.html', './styles.css', './app.js', './manifest.json', './icon-192.png', './icon-512.png'];
globalThis.addEventListener('install', e => { e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS))); globalThis.skipWaiting(); });
globalThis.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))); globalThis.clients.claim(); });
globalThis.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  /* Only manage the app shell. Cross-origin requests (the account database API) must pass straight
     through so a failed call surfaces as a real network error, not a fake "success" full of cached HTML. */
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(e.request).then(cached => cached || caches.match('./index.html')))
  );
});
/* Server-sent Web Push: fires even when no tab is open, which is the whole point — the reminder
   check that runs inside app.js only works while a tab is alive somewhere. */
globalThis.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { title: 'TaskFlow Pro', body: e.data ? e.data.text() : '' }; }
  const title = data.title || 'TaskFlow Pro';
  const options = { body: data.body || '', icon: './icon-192.png', badge: './icon-192.png', tag: data.tag || ('taskflow-reminder-' + Date.now()) };
  /* "Important" reminders get an alarm-like push: it stays on screen until the user acts on it
     and vibrates on mobile. There is no way to loop a custom alarm sound from a closed app —
     the OS/browser controls the notification sound — so this is as close as push notifications get. */
  if (data.important) { options.requireInteraction = true; options.vibrate = [300, 150, 300, 150, 300, 150, 600]; }
  e.waitUntil(self.registration.showNotification(title, options));
});
globalThis.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow('./index.html');
    })
  );
});
