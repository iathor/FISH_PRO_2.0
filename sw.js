/**
 * @file sw.js
 * @description Service Worker для PWA «Клёв ПРО 2.0: Круг» (Ревизия 2.1.1 r175).
 * - Офлайн-кэш тайлов карт (OpenTopoMap / OSM / Esri) в хранилище klev-pro-map-tiles-v2.1.1 (LRU до 650 тайлов)
 * - Автоматический пропуск локального контейнера Android APK (appassets.androidplatform.net), где файлы уже внутри APK
 */

const CACHE_VERSION = 'klev-pro-v2.2.0-r180';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const MAP_TILES_CACHE = 'klev-pro-map-tiles-v2.2.0';
const MAX_MAP_TILES = 650;

const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './version.json',
  './css/tokens.css?v=2.2.0',
  './css/base.css?v=2.2.0',
  './css/components.css?v=2.2.0',
  './css/layout.css?v=2.2.0',
  './js/app.js?v=2.2.0',
  './js/core/config.js?v=2.2.0',
  './js/core/events.js?v=2.2.0',
  './js/core/format.js?v=2.2.0',
  './js/core/http.js?v=2.2.0',
  './js/core/pwa.js?v=2.2.0',
  './js/core/router.js?v=2.2.0',
  './js/core/storage.js?v=2.2.0',
  './js/core/store.js?v=2.2.0',
  './js/core/telegram.js?v=2.2.0',
  './js/core/updater.js?v=2.2.0',
  './js/data/basins.js?v=2.2.0',
  './js/data/russia-waters.js?v=2.2.0',
  './js/data/species.js?v=2.2.0',
  './js/data/waters.js?v=2.2.0',
  './js/i18n/ru.js?v=2.2.0',
  './js/modules/calendar/calendar.module.js?v=2.2.0',
  './js/modules/circle/circle.module.js?v=2.2.0',
  './js/modules/fish/fish.module.js?v=2.2.0',
  './js/modules/forecast/forecast.module.js?v=2.2.0',
  './js/modules/geo/geo.module.js?v=2.2.0',
  './js/modules/log/log.module.js?v=2.2.0',
  './js/modules/weather/weather.module.js?v=2.2.0',
  './js/ui/components.js?v=2.2.0',
  './js/ui/svg.js?v=2.2.0'
];

function isMapTileHostname(hostname = '') {
  return /(tile\.opentopomap\.org|tile\.openstreetmap\.org|openstreetmap\.fr|arcgisonline\.com|core-renderer-tiles\.maps\.yandex\.net|maps\.mail\.ru)/i.test(String(hostname || ''));
}

async function trimMapTileCache() {
  try {
    const cache = await caches.open(MAP_TILES_CACHE);
    const keys = await cache.keys();
    if (keys.length > MAX_MAP_TILES) {
      const toDelete = keys.slice(0, keys.length - MAX_MAP_TILES);
      await Promise.all(toDelete.map(req => cache.delete(req)));
    }
  } catch (e) {}
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
          .filter(key => key !== STATIC_CACHE && key !== MAP_TILES_CACHE)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  if (isMapTileHostname(url.hostname)) {
    event.respondWith(
      caches.open(MAP_TILES_CACHE).then(async cache => {
        const cachedTile = await cache.match(req);
        if (cachedTile) {
          return cachedTile;
        }
        try {
          const netRes = await fetch(req);
          if (netRes && (netRes.status === 200 || netRes.type === 'opaque')) {
            cache.put(req, netRes.clone()).then(() => trimMapTileCache()).catch(() => {});
          }
          return netRes;
        } catch (err) {
          return cachedTile || new Response('', { status: 408, statusText: 'Offline Map Tile Unavailable' });
        }
      })
    );
    return;
  }

  // В Android APK WebView ресурсы уже локальные в assets/www, не кэшируем их повторно в CacheStorage
  if (url.hostname === 'appassets.androidplatform.net') {
    return;
  }

  if (url.origin !== self.location.origin) {
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
