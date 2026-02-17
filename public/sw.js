const CACHE_NAME = 'iftar-checkin-v1';
const STATIC_ASSETS = [
  '/style.css',
  '/dashboard.js',
  '/offline.js',
];

// Install: cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first, fallback to cache
self.addEventListener('fetch', (event) => {
  // Only cache GET requests
  if (event.request.method !== 'GET') return;

  // Skip API requests from caching (except /api/guests for offline)
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/') && url.pathname !== '/api/guests') return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache successful responses
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Network failed, try cache
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          // For HTML pages, return the cached admin page
          if (event.request.headers.get('accept')?.includes('text/html')) {
            return caches.match('/admin');
          }
          return new Response('Offline', { status: 503 });
        });
      })
  );
});
