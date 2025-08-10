const CACHE_NAME = 'calctracker-cache-v1';
const PRECACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];
const isOFF = (url) => url.hostname.endsWith('openfoodfacts.org') || url.hostname.endsWith('openfoodfacts.net');

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    // наши файлы — cache-first
    e.respondWith(
      caches.match(req).then(c => c || fetch(req).then(res => {
        const copy = res.clone(); caches.open(CACHE_NAME).then(cache => cache.put(req, copy)); return res;
      }))
    );
  } else if (isOFF(url) || url.hostname.includes('unpkg.com') || url.hostname.includes('zxing')) {
    // внешние — network-first
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        caches.open(CACHE_NAME).then(c => c.put(req, fresh.clone()));
        return fresh;
      } catch {
        const cached = await caches.match(req);
        return cached || new Response('', { status: 502, statusText: 'Offline' });
      }
    })());
  }
});
