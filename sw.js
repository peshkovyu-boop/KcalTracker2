const CACHE_NAME = 'calctracker-cache-v33'; // ↑ меняй номер при каждом апдейте

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// fetch обработчик
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // === для JSON всегда пробуем сеть, иначе fallback на кэш ===
  if (url.pathname.endsWith('.json')) {
    event.respondWith((async () => {
      try {
        // force no-cache
        const fresh = await fetch(request, { cache: 'no-store' });
        return fresh;
      } catch {
        // если оффлайн и сеть не дала, берём кэш
        const cached = await caches.match(request);
        if (cached) return cached;
        throw new Error('offline and no cache');
      }
    })());
    return;
  }

  // === для остальных файлов обычный stale-while-revalidate ===
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);

    const network = fetch(request).then(res => {
      cache.put(request, res.clone());
      return res;
    }).catch(() => null);

    return cached || network || fetch(request);
  })());
});
