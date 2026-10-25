/**
 * Service Worker для PWA «Клёв ПРО 2.0» (многомодульная архитектура)
 * Ревизия v2.0.1651:
 * - Немедленная активация новой версии (skipWaiting + clients.claim) без зависания старого кэша
 * - Поддержка новых модулей «Клёв ПРО: Круг» (circle.module.js) и Telegram Mini App SDK (telegram.js)
 * - Поддержка версионных query-параметров (?v=2.0.165) при офлайн-чтении из кэша (ignoreSearch: true)
 */
const CACHE_VERSION = 'v2.0.165-r2';
const STATIC_CACHE = `klev-pro-static-${CACHE_VERSION}`;

const APP_SHELL_FILES = [
  './',
  './index.html',
  './version.json',
  './manifest.json',
  './icon.svg',
  './css/tokens.css?v=2.0.165',
  './css/base.css?v=2.0.165',
  './css/components.css?v=2.0.165',
  './css/layout.css?v=2.0.165',
  './js/app.js?v=2.0.165',
  './js/i18n/ru.js?v=2.0.165',
  './js/core/config.js?v=2.0.165',
  './js/core/updater.js?v=2.0.165',
  './js/core/events.js?v=2.0.165',
  './js/core/format.js?v=2.0.165',
  './js/core/http.js?v=2.0.165',
  './js/core/pwa.js?v=2.0.165',
  './js/core/telegram.js?v=2.0.165',
  './js/core/router.js?v=2.0.165',
  './js/core/storage.js?v=2.0.165',
  './js/core/store.js?v=2.0.165',
  './js/data/basins.js?v=2.0.165',
  './js/data/waters.js?v=2.0.165',
  './js/data/russia-waters.js?v=2.0.165',
  './js/data/species.js?v=2.0.165',
  './js/ui/components.js?v=2.0.165',
  './js/ui/svg.js?v=2.0.165',
  './js/modules/weather/weather.module.js?v=2.0.165',
  './js/modules/geo/geo.module.js?v=2.0.165',
  './js/modules/forecast/forecast.module.js?v=2.0.165',
  './js/modules/fish/fish.module.js?v=2.0.165',
  './js/modules/calendar/calendar.module.js?v=2.0.165',
  './js/modules/log/log.module.js?v=2.0.165',
  './js/modules/circle/circle.module.js?v=2.0.165'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) =>
        Promise.allSettled(
          APP_SHELL_FILES.map((url) =>
            fetch(url, { cache: 'reload' }).then((res) => {
              if (res && res.ok) return cache.put(url, res);
            })
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => (key.startsWith('klev-pro-') || key.startsWith('app-assets-') || key.startsWith('map-tiles-')) && key !== STATIC_CACHE)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname.endsWith('version.json')) {
    event.respondWith(
      fetch(req, { cache: 'no-store' }).catch(() => caches.match(req, { ignoreSearch: true }))
    );
    return;
  }

  if (req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/')) {
    event.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then((networkRes) => {
          if (networkRes && networkRes.ok && networkRes.status === 200) {
            const copy = networkRes.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put('./index.html', copy));
          }
          return networkRes;
        })
        .catch(() =>
          caches.match(req, { ignoreSearch: true }).then((cached) => cached || caches.match('./index.html', { ignoreSearch: true }))
        )
    );
    return;
  }

  const isScriptOrStyle =
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.json');

  if (isScriptOrStyle) {
    event.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then((networkRes) => {
          if (networkRes && networkRes.ok && networkRes.status === 200) {
            const ct = (networkRes.headers.get('content-type') || '').toLowerCase();
            if (!url.pathname.endsWith('.js') || !ct.includes('text/html')) {
              const copy = networkRes.clone();
              caches.open(STATIC_CACHE).then((cache) => cache.put(req, copy));
            }
          }
          return networkRes;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }))
    );
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cachedRes) => {
      if (cachedRes) return cachedRes;
      return fetch(req).then((networkRes) => {
        if (networkRes && networkRes.ok && networkRes.status === 200) {
          const copy = networkRes.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(req, copy));
        }
        return networkRes;
      });
    })
  );
});
