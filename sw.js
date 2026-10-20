const VERSION = 'v2.0.0';
const SHELL_CACHE = `kp-shell-${VERSION}`;
const TILE_CACHE  = `kp-tiles-${VERSION}`;
const IMG_CACHE   = `kp-img-${VERSION}`;

const SHELL_ASSETS = [
  './', './index.html', './manifest.json',
  './css/tokens.css', './css/base.css', './css/components.css', './css/layout.css',
  './js/app.js',
  './js/core/store.js', './js/core/events.js', './js/core/router.js',
  './js/core/api.js', './js/core/storage.js', './js/core/format.js',
  './js/data/constants.js', './js/data/basin-configs.js',
  './js/data/water-profiles.js', './js/data/fish-db.js',
  './js/ui/components.js',
  './js/modules/fish/fish.module.js',
  './js/modules/geo/geo.module.js',
  './js/modules/weather/weather.module.js',
  './js/modules/forecast/forecast.module.js',
  './js/modules/calendar/calendar.module.js',
  './js/modules/log/log.module.js'
];

const NETWORK_ONLY = [
  'open-meteo.com', 'met.no', 'nominatim.openstreetmap.org',
  'overpass-api.de', 'overpass.kumi.systems', 'maps.mail.ru',
  'bigdatacloud.net', 'allorigins.win'
];

const TILE_HOSTS = [
  'opentopomap.org', 'arcgisonline.com', 'cartocdn.com',
  'openstreetmap.org'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .catch(err => console.warn('[SW] Precache failed:', err))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !k.endsWith(VERSION)).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 1. API — bypass, всегда сеть
  if (NETWORK_ONLY.some(h => url.hostname.includes(h))) return;

  // 2. Навигация — Network First с фоллбэком в Shell
  if (req.mode === 'navigate' ||
     (url.origin === self.location.origin &&
      (url.pathname.endsWith('/') || url.pathname.endsWith('.html')))) {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(SHELL_CACHE).then(c => c.put(req, clone));
          }
          return res;
        })
        .catch(() => caches.match(req)
          .then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // 3. Тайлы карт — Cache First
  if (TILE_HOSTS.some(h => url.hostname.includes(h))) {
    event.respondWith(
      caches.open(TILE_CACHE).then(cache =>
        cache.match(req).then(cached =>
          cached || fetch(req).then(res => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          }).catch(() => new Response('', { status: 404 }))
        )
      )
    );
    return;
  }

  // 4. Same-origin ассеты — Stale-While-Revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.open(SHELL_CACHE).then(cache =>
        cache.match(req).then(cached => {
          const network = fetch(req)
            .then(res => {
              if (res.ok) cache.put(req, res.clone());
              return res;
            })
            .catch(() => cached);
          return cached || network;
        })
      )
    );
    return;
  }

  // 5. Изображения (CDN иконки, PNG рыб) — Cache First
  if (/\.(png|jpe?g|webp|svg|woff2?)$/i.test(url.pathname)) {
    event.respondWith(
      caches.open(IMG_CACHE).then(cache =>
        cache.match(req).then(cached =>
          cached || fetch(req).then(res => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          }).catch(() => new Response('', { status: 404 }))
        )
      )
    );
  }
});