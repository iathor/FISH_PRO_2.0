const CACHE_VERSION = 'v2.0.0';
const TILE_CACHE = `map-tiles-${CACHE_VERSION}`;
const ASSET_CACHE = `app-assets-${CACHE_VERSION}`;

const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './css/tokens.css',
  './css/base.css',
  './css/components.css',
  './css/layout.css',
  './js/app.js',
  './js/i18n/ru.js',
  './js/core/config.js',
  './js/core/events.js',
  './js/core/format.js',
  './js/core/http.js',
  './js/core/pwa.js',
  './js/core/router.js',
  './js/core/storage.js',
  './js/core/store.js',
  './js/data/basins.js',
  './js/data/waters.js',
  './js/data/russia-waters.js',
  './js/data/species.js',
  './js/ui/components.js',
  './js/ui/svg.js',
  './js/modules/weather/weather.module.js',
  './js/modules/geo/geo.module.js',
  './js/modules/fish/fish.module.js',
  './js/modules/forecast/forecast.module.js',
  './js/modules/calendar/calendar.module.js',
  './js/modules/log/log.module.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(ASSET_CACHE).then(cache => cache.addAll(CORE_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== TILE_CACHE && k !== ASSET_CACHE).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // 1. СТРОГИЙ БАЙПАС: Все метеосерверы, геокодеры и Overpass API идут напрямую в сеть
  if (url.hostname.includes('open-meteo.com') ||
      url.hostname.includes('met.no') ||
      url.hostname.includes('allorigins.win') ||
      url.hostname.includes('nominatim.openstreetmap.org') ||
      url.hostname.includes('overpass-api.de') ||
      url.hostname.includes('kumi.systems') ||
      url.hostname.includes('maps.mail.ru') ||
      url.hostname.includes('bigdatacloud.net')) {
    return;
  }

  // 2. Навигационные запросы (HTML): Network First с фоллбэком в кэш
  if (event.request.mode === 'navigate' || (url.origin === self.location.origin && (url.pathname.endsWith('/') || url.pathname.endsWith('.html')))) {
    event.respondWith(
      fetch(event.request).then(networkRes => {
        if (networkRes && networkRes.ok) {
          const clone = networkRes.clone();
          caches.open(ASSET_CACHE).then(cache => cache.put(event.request, clone));
        }
        return networkRes;
      }).catch(() => {
        return caches.open(ASSET_CACHE).then(cache => {
          return cache.match(event.request).then(res => res || cache.match('./index.html') || cache.match('./'));
        });
      })
    );
    return;
  }

  // 3. Кэширование тайлов всех 4 слоев карт - Cache First
  if (url.hostname.includes('opentopomap.org') ||
      url.hostname.includes('arcgisonline.com') ||
      url.hostname.includes('cartocdn.com') ||
      url.hostname.includes('openstreetmap.org') ||
      url.hostname.includes('openstreetmap.fr')) {
    event.respondWith(
      caches.open(TILE_CACHE).then(cache => {
        return cache.match(event.request).then(response => {
          if (response) return response;
          return fetch(event.request).then(networkResponse => {
            if (networkResponse.ok) cache.put(event.request, networkResponse.clone());
            return networkResponse;
          }).catch(() => new Response('', { status: 404 }));
        });
      })
    );
    return;
  }

  // 4. Кэширование модулей JS/CSS, иконок и статики Leaflet - Stale-While-Revalidate
  if (url.hostname.includes('yastatic.net') ||
      url.hostname.includes('jsdelivr.net') ||
      (url.origin === self.location.origin && (url.pathname.endsWith('.js') || url.pathname.endsWith('.css') || url.pathname.endsWith('.png') || url.pathname.endsWith('.svg') || url.pathname.endsWith('manifest.json')))) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(cache => {
        return cache.match(event.request).then(cachedRes => {
          const fetchPromise = fetch(event.request).then(networkRes => {
            if (networkRes.ok) cache.put(event.request, networkRes.clone());
            return networkRes;
          }).catch(() => new Response('', { status: 404 }));
          return cachedRes || fetchPromise;
        });
      })
    );
    return;
  }
});
