const CACHE_NAME = 'mohammed-v1';
const APP_SHELL = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // never cache API calls — chat must always hit the network
  if (event.request.url.includes('/api/')) return;

  event.respondWith(
    caches
      .match(event.request)
      .then((cached) => cached || fetch(event.request).catch(() => caches.match('/index.html')))
  );
});
