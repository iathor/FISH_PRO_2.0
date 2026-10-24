/**
 * Service Worker для PWA «Клёв ПРО 2.0» (многомодульная архитектура)
 * Ревизия v2.0.1621:
 * - Немедленная активация новой версии (skipWaiting + clients.claim) без зависания старого кэша
 * - Поддержка новых модулей «Клёв ПРО: Круг» (circle.module.js) и Telegram Mini App SDK (telegram.js)
 * - Поддержка версионных query-параметров (?v=2.0.162) при офлайн-чтении из кэша (ignoreSearch: true)
 */
<<<<<<< HEAD
const CACHE_VERSION = 'v2.0.162-r2';
=======
const CACHE_VERSION = 'v2.0.161-r2';
>>>>>>> 33417ede577c091e7b89aed0efc07fda7f101501
const STATIC_CACHE = `klev-pro-static-${CACHE_VERSION}`;

const APP_SHELL_FILES = [
  './',
  './index.html',
  './version.json',
  './manifest.json',
  './icon.svg',
<<<<<<< HEAD
  './css/tokens.css?v=2.0.162',
  './css/base.css?v=2.0.162',
  './css/components.css?v=2.0.162',
  './css/layout.css?v=2.0.162',
  './js/app.js?v=2.0.162',
  './js/i18n/ru.js?v=2.0.162',
  './js/core/config.js?v=2.0.162',
  './js/core/updater.js?v=2.0.162',
  './js/core/events.js?v=2.0.162',
  './js/core/format.js?v=2.0.162',
  './js/core/http.js?v=2.0.162',
  './js/core/pwa.js?v=2.0.162',
  './js/core/telegram.js?v=2.0.162',
  './js/core/router.js?v=2.0.162',
  './js/core/storage.js?v=2.0.162',
  './js/core/store.js?v=2.0.162',
  './js/data/basins.js?v=2.0.162',
  './js/data/waters.js?v=2.0.162',
  './js/data/russia-waters.js?v=2.0.162',
  './js/data/species.js?v=2.0.162',
  './js/ui/components.js?v=2.0.162',
  './js/ui/svg.js?v=2.0.162',
  './js/modules/weather/weather.module.js?v=2.0.162',
  './js/modules/geo/geo.module.js?v=2.0.162',
  './js/modules/forecast/forecast.module.js?v=2.0.162',
  './js/modules/fish/fish.module.js?v=2.0.162',
  './js/modules/calendar/calendar.module.js?v=2.0.162',
  './js/modules/log/log.module.js?v=2.0.162',
  './js/modules/circle/circle.module.js?v=2.0.162'
=======
  './css/tokens.css?v=2.0.161',
  './css/base.css?v=2.0.161',
  './css/components.css?v=2.0.161',
  './css/layout.css?v=2.0.161',
  './js/app.js?v=2.0.161',
  './js/i18n/ru.js?v=2.0.161',
  './js/core/config.js?v=2.0.161',
  './js/core/updater.js?v=2.0.161',
  './js/core/events.js?v=2.0.161',
  './js/core/format.js?v=2.0.161',
  './js/core/http.js?v=2.0.161',
  './js/core/pwa.js?v=2.0.161',
  './js/core/telegram.js?v=2.0.161',
  './js/core/router.js?v=2.0.161',
  './js/core/storage.js?v=2.0.161',
  './js/core/store.js?v=2.0.161',
  './js/data/basins.js?v=2.0.161',
  './js/data/waters.js?v=2.0.161',
  './js/data/russia-waters.js?v=2.0.161',
  './js/data/species.js?v=2.0.161',
  './js/ui/components.js?v=2.0.161',
  './js/ui/svg.js?v=2.0.161',
  './js/modules/weather/weather.module.js?v=2.0.161',
  './js/modules/geo/geo.module.js?v=2.0.161',
  './js/modules/forecast/forecast.module.js?v=2.0.161',
  './js/modules/fish/fish.module.js?v=2.0.161',
  './js/modules/calendar/calendar.module.js?v=2.0.161',
  './js/modules/log/log.module.js?v=2.0.161',
  './js/modules/circle/circle.module.js?v=2.0.161'
>>>>>>> 33417ede577c091e7b89aed0efc07fda7f101501
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
