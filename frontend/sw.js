// Bump this whenever the app shell changes so an existing install cannot mix a
// newly deployed index.html with an older cached app.js.
const CACHE_NAME = 'taskflow-v13';
const PREFERENCES_CACHE = 'taskflow-preferences';
const ASSETS = ['./index.html', './styles.css', './app.js', './app.js?v=20261009-1', './config.js', './manifest.json', './icon-192.png', './icon-512.png'];
globalThis.addEventListener('install', e => { e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS))); globalThis.skipWaiting(); });
globalThis.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('taskflow-') && k !== CACHE_NAME && k !== PREFERENCES_CACHE).map(k => caches.delete(k))))); globalThis.clients.claim(); });
globalThis.addEventListener('message', e => {
  if(e.data?.type !== 'TASKFLOW_LANGUAGE' || !['en','ar'].includes(e.data.language)) return;
  const key = new URL('./__language__', self.registration.scope).href;
  e.waitUntil(caches.open(PREFERENCES_CACHE).then(cache => cache.put(key, new Response(e.data.language))));
});
async function notificationLanguage(){
  try {
    const cache = await caches.open(PREFERENCES_CACHE);
    const response = await cache.match(new URL('./__language__', self.registration.scope).href);
    return response && await response.text() === 'ar' ? 'ar' : 'en';
  } catch { return 'en'; }
}
function notificationCopy(data, language){
  let title = data.title || (language === 'ar' ? 'تاسك فلو برو' : 'TaskFlow Pro');
  let body = data.body || '';
  if(language === 'ar'){
    // Only translate the server's fixed reminder wrappers, never the user's title.
    if(/^(?:task|timetable)-/.test(data.tag || '') && title.startsWith('Reminder: ')) title = 'تذكير: ' + title.slice(10);
    const task = body.match(/^Task "([\s\S]*)" is due!$/);
    if(task) body = 'حان موعد المهمة «' + task[1] + '»!';
    else if(body === 'Coming up now') body = 'حان الموعد الآن';
    else if(body === 'Time block is starting!') body = 'حان وقت بدء الفترة الزمنية!';
  }
  return {title,body};
}
globalThis.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  /* Only manage the app shell. Cross-origin requests (the account database API) must pass straight
     through so a failed call surfaces as a real network error, not a fake "success" full of cached HTML. */
  if (url.origin !== self.location.origin || url.pathname.includes('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then(response => {
        if (!response.ok) return response;
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(e.request).then(cached => cached || (e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});
/* Server-sent Web Push: fires even when no tab is open, which is the whole point — the reminder
   check that runs inside app.js only works while a tab is alive somewhere. */
globalThis.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { title: 'TaskFlow Pro', body: e.data ? e.data.text() : '' }; }
  e.waitUntil((async()=>{
  const language = await notificationLanguage();
  const {title,body} = notificationCopy(data, language);
  const options = { body, lang:language, dir:language==='ar'?'rtl':'ltr', icon: './icon-192.png', badge: './icon-192.png', tag: data.tag || ('taskflow-reminder-' + Date.now()) };
  /* "Important" reminders get an alarm-like push: it stays on screen until the user acts on it
     and vibrates on mobile. There is no way to loop a custom alarm sound from a closed app —
     the OS/browser controls the notification sound — so this is as close as push notifications get. */
  if (data.important) { options.requireInteraction = true; options.vibrate = [300, 150, 300, 150, 300, 150, 600]; }
  await self.registration.showNotification(title, options);
  })());
});
globalThis.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) { if (c.url.startsWith(self.registration.scope) && 'focus' in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow('./index.html');
    })
  );
});
