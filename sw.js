/**
 * @file sw.js
 * @description Service Worker для PWA «Клёв ПРО 2.0: Круг» (Ревизия 2.5.6 r213).
 * - Кэширует только статический код приложения (CORE_ASSETS)
 * - НЕ кэширует тайлы карт в фоновом CacheStorage (все офлайн-карты управляются строго через IndexedDB KlevProOfflineMapsDB_v5 с полной очисткой при удалении)
 */

const CACHE_VERSION = 'klev-pro-v2.5.6-r213';
const STATIC_CACHE = `${CACHE_VERSION}-static`;

const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './version.json',
  './css/tokens.css?v=2.5.6-r213',
  './css/base.css?v=2.5.6-r213',
  './css/components.css?v=2.5.6-r213',
  './css/layout.css?v=2.5.6-r213',
  './js/app.js?v=2.5.6-r213',
  './js/core/config.js?v=2.5.6-r213',
  './js/core/events.js?v=2.5.6-r213',
  './js/core/format.js?v=2.5.6-r213',
  './js/core/http.js?v=2.5.6-r213',
  './js/core/pwa.js?v=2.5.6-r213',
  './js/core/router.js?v=2.5.6-r213',
  './js/core/storage.js?v=2.5.6-r213',
  './js/core/store.js?v=2.5.6-r213',
  './js/core/telegram.js?v=2.5.6-r213',
  './js/core/updater.js?v=2.5.6-r213',
  './js/data/basins.js?v=2.5.6-r213',
  './js/data/russia-waters.js?v=2.5.6-r213',
  './js/data/species.js?v=2.5.6-r213',
  './js/data/waters.js?v=2.5.6-r213',
  './js/i18n/ru.js?v=2.5.6-r213',
  './js/modules/calendar/calendar.module.js?v=2.5.6-r213',
  './js/modules/circle/circle.module.js?v=2.5.6-r213',
  './js/modules/fish/fish.module.js?v=2.5.6-r213',
  './js/modules/fish/scanner.js?v=2.5.6-r213',
  './js/modules/forecast/forecast.module.js?v=2.5.6-r213',
  './js/modules/geo/geo.module.js?v=2.5.6-r213',
  './js/modules/log/log.module.js?v=2.5.6-r213',
  './js/modules/weather/weather.module.js?v=2.5.6-r213',
  './js/ui/components.js?v=2.5.6-r213',
  './js/ui/icons.js?v=2.5.6-r213',
  './js/ui/svg.js?v=2.5.6-r213'
];

function isMapTileHostname(hostname = '') {
  return /(tile\.opentopomap\.org|tile\.openstreetmap\.org|openstreetmap\.fr|arcgisonline\.com|basemaps\.cartocdn\.com|core-renderer-tiles\.maps\.yandex\.net|core-sat\.maps\.yandex\.net|sat0[1-4]\.maps\.yandex\.net|vec0[1-4]\.maps\.yandex\.net|maps\.yandex\.net|maps\.mail\.ru)/i.test(String(hostname || ''));
}

self.addEventListener('install', event => {
  if (self.location && self.location.hostname === 'appassets.androidplatform.net') {
    self.skipWaiting();
    return;
  }
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => {
      return Promise.allSettled(
        CORE_ASSETS.map(url =>
          fetch(url, { cache: 'no-cache' }).then(res => {
            if (res && res.ok) return cache.put(url, res);
          }).catch(() => {})
        )
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== STATIC_CACHE)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'PURGE_MAP_TILE_CACHES') {
    caches.keys().then(keys => {
      keys.forEach(k => {
        if (k.includes('map-tiles')) caches.delete(k);
      });
    }).catch(() => {});
  }
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Никогда не перехватываем запросы к серверу БД/погоды/ретранслятора и к тайлам карт (все офлайн-карты работают строго через IndexedDB!)
  if (
    url.hostname.includes('workers.dev') ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/relay/') ||
    url.pathname.startsWith('/weather') ||
    isMapTileHostname(url.hostname)
  ) {
    return;
  }

  if (url.hostname === 'appassets.androidplatform.net') {
    return;
  }

  if (url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname.includes('/apk/') || url.pathname.endsWith('.apk') || url.pathname.endsWith('version.json')) {
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(STATIC_CACHE).then(c => c.put('./index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  const isCodeOrDoc = /\.(js|css|html|json)(\?|$)/i.test(url.pathname + url.search);
  if (isCodeOrDoc) {
    event.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then(res => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then(cache => cache.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cached => {
      const networkFetch = fetch(req)
        .then(res => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then(cache => cache.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);

      return cached || networkFetch;
    })
  );
});
