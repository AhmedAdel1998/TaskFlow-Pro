const CACHE_NAME = 'taskflow-v7';
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
