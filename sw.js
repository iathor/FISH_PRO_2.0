// Klev PRO 2.0 (v2.0.172 Protected Build)
const CACHE_VERSION = 'klev-pro-v2.0.172';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const MAP_TILES_CACHE = 'klev-pro-map-tiles-v1';
const MAX_MAP_TILES = 650;
const CORE_ASSETS = [
'./',
'./index.html',
'./klev-pro-v2.html',
'./manifest.json',
'./css/variables.css',
'./css/reset.css',
'./css/layout.css',
'./css/components.css',
'./css/themes.css',
'./js/app.js',
'./js/config.js',
'./js/core/events.js',
'./js/core/router.js',
'./js/core/storage.js',
'./js/core/store.js',
'./js/core/utils.js',
'./js/data/baits.db.js',
'./js/data/fish.db.js',
'./js/data/knots.db.js',
'./js/data/methods.db.js',
'./js/data/Preserve.db.js',
'./js/data/presets.db.js',
'./js/data/rigs.db.js',
'./js/data/seasonal-tips.db.js',
'./js/data/waters.db.js',
'./js/data/russia-waters.db.js',
'./js/data/locales/ru.js',
'./js/modules/Arsenal/arsenal.module.js',
'./js/modules/calendar/calendar.module.js',
'./js/modules/checklist/checklist.module.js',
'./js/modules/diary/diary.module.js',
'./js/modules/echolot/echolot.module.js',
'./js/modules/explain/explain.module.js',
'./js/modules/fish/fish.module.js',
'./js/modules/forecast/forecast.module.js',
'./js/modules/geo/geo.module.js',
'./js/modules/header/header.module.js',
'./js/modules/knots/knots.module.js',
'./js/modules/map/map.module.js',
'./js/modules/Preserve/Preserve.module.js',
'./js/modules/profile/profile.module.js',
'./js/modules/safety/safety.module.js',
'./js/modules/seasonal/seasonal.module.js',
'./js/modules/share/share.module.js',
'./js/modules/tackle/tackle.module.js',
'./js/modules/trophy/trophy.module.js',
'./js/modules/voice/voice.module.js',
'./js/modules/weather/weather.module.js',
'./js/ui/chart-renderer.js',
'./js/ui/components.js',
'./js/ui/modal.js',
'./js/ui/svg-fish.js',
'./js/ui/toast.js'
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
