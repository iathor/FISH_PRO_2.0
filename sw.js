/**
 * Service Worker для PWA «Клёв ПРО 2.0» (многомодульная архитектура)
 * Стратегия:
 * - HTML, JS, CSS, JSON: Network-First (мгновенная подгрузка актуальных модулей без необходимости тянуть экран вниз) + кэш-фоллбэк для офлайна
 * - Иконки и изображения рыб: Cache-First
 */
const CACHE_VERSION = 'v2.0.1';
const STATIC_CACHE = `klev-pro-static-${CACHE_VERSION}`;

const APP_SHELL_FILES = [
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
  './js/modules/forecast/forecast.module.js',
  './js/modules/fish/fish.module.js',
  './js/modules/calendar/calendar.module.js',
  './js/modules/log/log.module.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(APP_SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('klev-pro-') && key !== STATIC_CACHE)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Пропускаем внешние API запросы погоды и геокодинга напрямую в сеть
  if (url.origin !== self.location.origin) {
    return;
  }

  const isCodeOrDoc =
    req.mode === 'navigate' ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.json');

  if (isCodeOrDoc) {
    // Network-First: всегда отдаём свежий модуль при наличии сети, а в офлайне — из кэша
    event.respondWith(
      fetch(req)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const copy = networkRes.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(req, copy));
          }
          return networkRes;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
    );
    return;
  }

  // Для локальных изображений рыб и иконок: Cache-First с подгрузкой
  event.respondWith(
    caches.match(req).then((cachedRes) => {
      if (cachedRes) return cachedRes;
      return fetch(req).then((networkRes) => {
        if (networkRes && networkRes.status === 200) {
          const copy = networkRes.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(req, copy));
        }
        return networkRes;
      });
    })
  );
});
