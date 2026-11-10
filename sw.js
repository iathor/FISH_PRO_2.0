/**
 * @file sw.js
 * @description Service Worker для PWA «Клёв ПРО 2.0: Круг» (Ревизия 2.8.3 r229).
 */

const CACHE_VERSION = 'klev-pro-v2.8.3-r230';
const STATIC_CACHE = `${CACHE_VERSION}-static`;

const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './version.json',
  './css/tokens.css?v=2.8.3-r230',
  './css/base.css?v=2.8.3-r230',
  './css/components.css?v=2.8.3-r230',
  './css/layout.css?v=2.8.3-r230',
  './js/app.js?v=2.8.3-r230',
  './js/core/config.js?v=2.8.3-r230',
  './js/core/events.js?v=2.8.3-r230',
  './js/core/format.js?v=2.8.3-r230',
  './js/core/http.js?v=2.8.3-r230',
  './js/core/pwa.js?v=2.8.3-r230',
  './js/core/router.js?v=2.8.3-r230',
  './js/core/storage.js?v=2.8.3-r230',
  './js/core/store.js?v=2.8.3-r230',
  './js/core/telegram.js?v=2.8.3-r230',
  './js/core/updater.js?v=2.8.3-r230',
  './js/data/basins.js?v=2.8.3-r230',
  './js/data/russia-waters.js?v=2.8.3-r230',
  './js/data/species.js?v=2.8.3-r230',
  './js/data/waters.js?v=2.8.3-r230',
  './js/i18n/ru.js?v=2.8.3-r230',
  './js/modules/calendar/calendar.module.js?v=2.8.3-r230',
  './js/modules/circle/circle.module.js?v=2.8.3-r230',
  './js/modules/fish/fish.module.js?v=2.8.3-r230',
  './js/modules/fish/scanner.js?v=2.8.3-r230',
  './js/modules/forecast/forecast.module.js?v=2.8.3-r230',
  './js/modules/geo/geo.module.js?v=2.8.3-r230',
  './js/modules/log/log.module.js?v=2.8.3-r230',
  './js/modules/weather/weather.module.js?v=2.8.3-r230',
  './js/ui/components.js?v=2.8.3-r230',
  './js/ui/icons.js?v=2.8.3-r230',
  './js/ui/svg.js?v=2.8.3-r230'
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
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then(c => c.put('./index.html', copy)).catch(() => {});
            return res;
          }
          return caches.match('./index.html', { ignoreSearch: true }).then(r => r || caches.match('./') || res);
        })
        .catch(() => caches.match('./index.html', { ignoreSearch: true }).then(r => r || caches.match('./')))
    );
    return;
  }

  const isCodeOrDoc = /\.(js|css|html|json)(\?|$)/i.test(url.pathname + url.search);
  if (isCodeOrDoc) {
    event.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then(async res => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then(cache => cache.put(req, copy)).catch(() => {});
            return res;
          }
          const cached = (await caches.match(req)) || (await caches.match(req, { ignoreSearch: true }));
          return cached || res;
        })
        .catch(async () => {
          const cached = (await caches.match(req)) || (await caches.match(req, { ignoreSearch: true }));
          return cached || new Response('', { status: 503 });
        })
    );
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(cached => {
      const networkFetch = fetch(req)
        .then(res => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then(cache => cache.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached || new Response('', { status: 503 }));

      return cached || networkFetch;
    })
  );
});
