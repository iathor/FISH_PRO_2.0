/**
 * Service Worker для PWA «Клёв ПРО 2.0» (многомодульная архитектура)
 * Версия v2.0.2:
 * - Управляемое обновление релиза и кэша по разрешению пользователя (SKIP_WAITING message)
 * - Защита от кэширования битых модулей и HTML-заглушек
 * - Отказоустойчивая предзагрузка через Promise.allSettled
 */
const CACHE_VERSION = 'v2.0.2';
const STATIC_CACHE = `klev-pro-static-${CACHE_VERSION}`;

const APP_SHELL_FILES = [
  './',
  './index.html',
  './version.json',
  './manifest.json',
  './icon.svg',
  './css/tokens.css',
  './css/base.css',
  './css/components.css',
  './css/layout.css',
  './js/app.js',
  './js/i18n/ru.js',
  './js/core/config.js',
  './js/core/updater.js',
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
      .then((cache) => Promise.allSettled(APP_SHELL_FILES.map((url) => cache.add(url))))
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

  // Манифест версии/ревизии всегда запрашиваем напрямую с сервера (Network-First без устаревания)
  if (url.pathname.endsWith('version.json')) {
    event.respondWith(
      fetch(req, { cache: 'no-store' }).catch(() => caches.match(req))
    );
    return;
  }

  // 1. Навигационные запросы (HTML-страница): Network-First с фоллбэком на ./index.html
  if (req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/')) {
    event.respondWith(
      fetch(req)
        .then((networkRes) => {
          if (networkRes && networkRes.ok && networkRes.status === 200) {
            const copy = networkRes.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(req, copy));
          }
          return networkRes;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
    );
    return;
  }

  // 2. ES-модули (.js), стили (.css) и манифест (.json):
  const isScriptOrStyle =
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.json');

  if (isScriptOrStyle) {
    event.respondWith(
      fetch(req)
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
        .catch(() => caches.match(req))
    );
    return;
  }

  // 3. Для локальных изображений рыб и иконок: Cache-First с подгрузкой из сети
  event.respondWith(
    caches.match(req).then((cachedRes) => {
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
