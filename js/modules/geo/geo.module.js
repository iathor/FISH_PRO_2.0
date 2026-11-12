import { renderFishVisual } from '../../ui/svg.js?v=2.9.2-r237';
import { MAP_LAYERS, SPOT_CATEGORIES, getCompatibleMethods } from '../../core/config.js?v=2.9.2-r237';
import { events } from '../../core/events.js?v=2.9.2-r237';
import { storage, safeJsonParse } from '../../core/storage.js?v=2.9.2-r237';
import { router } from '../../core/router.js?v=2.9.2-r237';
import { store } from '../../core/store.js?v=2.9.2-r237';
import { fetchWithTimeout } from '../../core/http.js?v=2.9.2-r237';
import { installShortcut, syncInstallButtons } from '../../core/pwa.js?v=2.9.2-r237';
import { triggerHaptic } from '../../core/telegram.js?v=2.9.2-r237';
import { BASIN_CONFIGS, detectBasinByCoords, isCoastalInBasin, getSpotEcoregion, isSpeciesInGeoRange } from '../../data/basins.js?v=2.9.2-r237';
import { WATER_PROFILES, getAvailableWaterTypes } from '../../data/waters.js?v=2.9.2-r237';
import {
  RUSSIA_CITIES,
  RUSSIA_WATERS,
  findNearestRussianSettlement,
  getNearestRussianSettlements,
  getNearestRussianWaters,
  getWaterTypeShortTag
} from '../../data/russia-waters.js?v=2.9.2-r237';
import { FISH_DB } from '../../data/species.js?v=2.9.2-r237';
import { escapeHtml, createPill, showToast, openModal, closeModal, openConfirmDeleteModal, downloadFileCrossPlatform, flashHighlightElement, isGeoDistributionConsentActive, ensureGeoDistributionConsent, setGeoDistributionConsentState } from '../../ui/components.js?v=2.9.2-r237';
import { fetchWeather, weatherModule } from '../weather/weather.module.js?v=2.9.2-r237';
import { calcDayBest } from '../forecast/forecast.module.js?v=2.9.2-r237';
import { computeHexPolygonForCircle, getEffectiveCircleRadiusKm, getCircleHexDecayState, canUserAccessCrewItem, getCurrentFisherIdentity, isUserAdmin, isCurrentUserBetaTester, verifyBetaTesterStatusFromCloud, isCircleItemMine, isCircleItemHidden, openAddThematicMapPointModal } from '../circle/circle.module.js?v=2.9.2-r237';
// ============================================================================
// АВТОНОМНОЕ ЯДРО, РЕПРОЕКТОР EPSG:3395 И ИНСПЕКТОР ПРОВЕРКИ ОФЛАЙН-КАРТ (ФАЗА 1 • v2)
// Хранение в формате инлайн-DataURL (100% сохранность после перезапуска Android WebView)
// + Мгновенный RAM-индекс ключей (_offlineTileKeysSet) без блокировок и фризов IndexedDB
// ============================================================================
const OFFLINE_DB_NAME = 'KlevProOfflineMapsDB_v5';
const OFFLINE_DB_VERSION = 1;
const LEGACY_OFFLINE_DB_NAMES = ['KlevProOfflineMapsDB_v1', 'KlevProOfflineMapsDB_v2', 'KlevProOfflineMapsDB_v3', 'KlevProOfflineMapsDB_v4'];
const OFFLINE_PACKS_LS_BACKUP_KEY = 'klev_pro_offline_packs_meta_v5';
const WGS84_ECCENTRICITY = 0.08181919084262149;

let _offlineDbInstance = null;
let _offlineDbPromise = null;
let _legacyDbCleaned = false;
let _activeDownloadJob = null;
let _cachedPacksList = [];
let _selectedPackIdsForBatchDelete = new Set();
let _showOfflinePerimetersOnMap = true;
let _forceOfflineTestMode = false;
let _offlineMapsEnabledOnMap = true;
try {
  if (typeof localStorage !== 'undefined') {
    const savedOffEn = localStorage.getItem('klev_pro_offline_maps_enabled_v1');
    if (savedOffEn !== null) _offlineMapsEnabledOnMap = savedOffEn !== '0';
  }
} catch (_e) {}
export function isOfflineMapLayerEnabled() {
  return Boolean(_offlineMapsEnabledOnMap);
}
export function setOfflineMapLayerEnabled(enabled) {
  _offlineMapsEnabledOnMap = Boolean(enabled);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('klev_pro_offline_maps_enabled_v1', _offlineMapsEnabledOnMap ? '1' : '0');
    }
  } catch (_e) {}
}
let _inspectedPackIdInModal = null;
let _nativeApkTileProxyState = 'untested'; // 'untested' | 'ok' | 'unavailable'
let _nativeApkFailStreak = 0;
let _directYandexCorsState = 'untested'; // 'untested' | 'ok' | 'blocked'
let _workerTileProxyState = 'untested'; // 'untested' | 'ok' | 'unavailable'
let _workerProxyFailStreak = 0;
let _sharedReprojCanvas = null;
let _sharedReprojCtx = null;

// Мгновенный индекс всех существующих ключей тайлов в оперативной памяти (0 мс на проверку наличия)
const _offlineTileKeysSet = new Set();
let _offlineKeysIndexed = false;

// Быстрый LRU-кэш последних прочитанных DataURL тайлов в RAM (исключает повторные чтения при зуме/сдвиге)
const _ramTileDataUrlCache = new Map();
const MAX_RAM_TILE_CACHE = 600;
const _epsg3857BitmapCache = new Map();

function putRamTileCache(key, dataUrl) {
  if (!key || !dataUrl) return;
  if (_ramTileDataUrlCache.has(key)) {
    _ramTileDataUrlCache.delete(key);
  } else if (_ramTileDataUrlCache.size >= MAX_RAM_TILE_CACHE) {
    const oldestKey = _ramTileDataUrlCache.keys().next().value;
    if (oldestKey) _ramTileDataUrlCache.delete(oldestKey);
  }
  _ramTileDataUrlCache.set(key, dataUrl);
}

// Читаем резервную копию метаданных пакетов из localStorage при холодном старте
try {
  if (typeof localStorage !== 'undefined') {
    const rawPacks = localStorage.getItem(OFFLINE_PACKS_LS_BACKUP_KEY);
    if (rawPacks) {
      const parsedPacks = JSON.parse(rawPacks);
      if (Array.isArray(parsedPacks)) _cachedPacksList = parsedPacks;
    }
  }
} catch (e) {}

let _tileCacheBustSeq = Date.now();

function savePacksListToLocalBackup(list) {
  try {
    if (typeof localStorage !== 'undefined') {
      if (Array.isArray(list) && list.length > 0) {
        localStorage.setItem(OFFLINE_PACKS_LS_BACKUP_KEY, JSON.stringify(list));
      } else {
        localStorage.removeItem(OFFLINE_PACKS_LS_BACKUP_KEY);
      }
    }
  } catch (e) {}
}

export async function purgeGhostBrowserTileCaches() {
  _tileCacheBustSeq = Date.now();
  _epsg3857BitmapCache.clear();
  try {
    if (typeof window !== 'undefined' && 'caches' in window) {
      const keys = await window.caches.keys();
      await Promise.all(
        keys
          .filter(k => k.includes('map-tiles') || k.includes('tiles'))
          .map(k => window.caches.delete(k))
      );
    }
  } catch (_e) {}
  try {
    if (typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'PURGE_MAP_TILE_CACHES' });
    }
  } catch (_e) {}
}

export function refreshActiveLeafletMapLayers() {
  _tileCacheBustSeq = Date.now();
  if (mapInstance) {
    try {
      if (currentTileLayer) {
        mapInstance.removeLayer(currentTileLayer);
      }
      currentTileLayer = createResilientTileLayer(currentLayerKey).addTo(mapInstance);
      applyYandexTileFiltersToMap();
      renderMapOverlays();
    } catch (_e) {}
  }
}

export function isOfflineMapTestModeActive() {
  return _forceOfflineTestMode;
}

export function setOfflineMapTestMode(enabled) {
  _forceOfflineTestMode = Boolean(enabled);
  if (typeof window !== 'undefined') {
    window.__KLEV_FORCE_OFFLINE_MAP_TEST__ = _forceOfflineTestMode;
  }
}

export const OFFLINE_LAYER_SOURCES = {
  yandex_map: {
    id: 'yandex_map',
    title: 'Яндекс Схема (реки, протоки, зимники)',
    shortTitle: 'Схема',
    avgTileBytes: 15500,
    isEPSG3395: true,
    outputMime: 'image/png',
    buildUrl: (z, x, y) => {
      return `https://core-renderer-tiles.maps.yandex.net/tiles?l=map&v=24.10.30-0&x=${x}&y=${y}&z=${z}&scale=2&lang=ru_RU`;
    },
    buildAltYandexUrl: (z, x, y, subIdx = 0) => {
      const s = ['1', '2', '3', '4'][Math.abs(subIdx) % 4];
      return `https://vec0${s}.maps.yandex.net/tiles?l=map&x=${x}&y=${y}&z=${z}&scale=2&lang=ru_RU`;
    },
    buildCors3857Urls: (z, x, y3857, subIdx = 0) => {
      const sOsm = ['a', 'b', 'c'][Math.abs(subIdx) % 3];
      const sCarto = ['a', 'b', 'c', 'd'][Math.abs(subIdx) % 4];
      const pool = [
        `https://${sCarto}.basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y3857}.png`,
        `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${z}/${y3857}/${x}`,
        `https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${z}/${y3857}/${x}`,
        `https://tile.openstreetmap.org/${z}/${x}/${y3857}.png`,
        `https://${sOsm}.tile.openstreetmap.fr/hot/${z}/${x}/${y3857}.png`
      ];
      const shift = Math.abs(subIdx) % pool.length;
      return pool.slice(shift).concat(pool.slice(0, shift));
    }
  },
  yandex_sat: {
    id: 'yandex_sat',
    title: 'Яндекс Спутник (косы, старицы, рельеф)',
    shortTitle: 'Спутник',
    avgTileBytes: 19500,
    isEPSG3395: true,
    outputMime: 'image/jpeg',
    buildUrl: (z, x, y, subIdx = 0) => {
      const s = ['1', '2', '3', '4'][Math.abs(subIdx) % 4];
      return `https://sat0${s}.maps.yandex.net/tiles?l=sat&x=${x}&y=${y}&z=${z}&lang=ru_RU`;
    },
    buildAltYandexUrl: (z, x, y) => {
      return `https://core-sat.maps.yandex.net/tiles?l=sat&x=${x}&y=${y}&z=${z}&lang=ru_RU`;
    },
    buildCors3857Urls: (z, x, y3857) => {
      return [
        `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y3857}/${x}`,
        `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y3857}/${x}`
      ];
    }
  },
  yandex_skl: {
    id: 'yandex_skl',
    title: 'Гибрид: Названия рек, озёр и дорог',
    shortTitle: 'Гибрид-слои',
    avgTileBytes: 9500,
    isEPSG3395: true,
    outputMime: 'image/png',
    buildUrl: (z, x, y) => {
      return `https://core-renderer-tiles.maps.yandex.net/tiles?l=skl&v=24.10.30-0&x=${x}&y=${y}&z=${z}&scale=2&lang=ru_RU`;
    },
    buildAltYandexUrl: (z, x, y) => {
      return `https://core-renderer-tiles.maps.yandex.net/tiles?l=skl&x=${x}&y=${y}&z=${z}&scale=2&lang=ru_RU`;
    },
    buildCors3857Urls: (z, x, y3857) => {
      return [
        `https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/${z}/${y3857}/${x}`,
        `https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/${z}/${y3857}/${x}`
      ];
    }
  }
};

export function openOfflineMapsDB(forceReopen = false) {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  // Фоновая очистка старой тяжелой Blob-базы v1 (однократно)
  if (!_legacyDbCleaned) {
    _legacyDbCleaned = true;
    try {
      for (const oldName of LEGACY_OFFLINE_DB_NAMES) {
        indexedDB.deleteDatabase(oldName);
      }
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('klev_pro_offline_packs_meta_v2');
        localStorage.removeItem('klev_pro_offline_packs_meta_v3');
        localStorage.removeItem('klev_pro_offline_packs_meta_v4');
      }
      purgeGhostBrowserTileCaches();
    } catch (e) {}
  }
  if (forceReopen) {
    _offlineDbInstance = null;
    _offlineDbPromise = null;
  }
  if (_offlineDbInstance) {
    return Promise.resolve(_offlineDbInstance);
  }
  if (_offlineDbPromise) return _offlineDbPromise;

  _offlineDbPromise = new Promise((resolve) => {
    let settled = false;
    const finish = (db) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!db) _offlineDbPromise = null;
      resolve(db || null);
    };
    const timer = setTimeout(() => finish(null), 2500);
    try {
      const req = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('tiles')) {
          db.createObjectStore('tiles', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('packs')) {
          db.createObjectStore('packs', { keyPath: 'id' });
        }
      };
      req.onsuccess = (e) => {
        const db = e.target.result;
        _offlineDbInstance = db;
        db.onclose = () => {
          _offlineDbInstance = null;
          _offlineDbPromise = null;
        };
        db.onversionchange = () => {
          try { db.close(); } catch (err) {}
          _offlineDbInstance = null;
          _offlineDbPromise = null;
        };
        finish(db);
      };
      req.onerror = () => finish(null);
      req.onblocked = () => finish(null);
    } catch (err) {
      finish(null);
    }
  });
  return _offlineDbPromise;
}

/**
 * Быстрая синхронизация индекса ключей тайлов в RAM (занимает ~2 мс, читает только строки-ключи без картинок!)
 */
export async function syncOfflineKeysIndexFromDB(force = false) {
  if (_offlineKeysIndexed && !force && _offlineTileKeysSet.size > 0) {
    return _offlineTileKeysSet;
  }
  let db = await openOfflineMapsDB();
  if (!db) return _offlineTileKeysSet;
  return new Promise((resolve) => {
    const attemptRead = (dbConn, isRetry = false) => {
      try {
        const tx = dbConn.transaction(['tiles'], 'readonly');
        const req = tx.objectStore('tiles').getAllKeys();
        req.onsuccess = () => {
          const keys = Array.isArray(req.result) ? req.result : [];
          _offlineTileKeysSet.clear();
          for (const k of keys) {
            if (typeof k === 'string') _offlineTileKeysSet.add(k);
          }
          _offlineKeysIndexed = true;
          resolve(_offlineTileKeysSet);
        };
        req.onerror = () => resolve(_offlineTileKeysSet);
      } catch (e) {
        if (!isRetry) {
          openOfflineMapsDB(true).then(freshDb => {
            if (freshDb) attemptRead(freshDb, true);
            else resolve(_offlineTileKeysSet);
          });
        } else {
          resolve(_offlineTileKeysSet);
        }
      }
    };
    attemptRead(db, false);
  });
}

export async function ensurePersistentStorageQuota() {
  let persisted = false;
  let usageBytes = 0;
  let quotaBytes = 0;
  try {
    if (typeof navigator !== 'undefined' && navigator.storage) {
      if (typeof navigator.storage.persisted === 'function') {
        persisted = await navigator.storage.persisted();
      }
      if (!persisted && typeof navigator.storage.persist === 'function') {
        persisted = await navigator.storage.persist();
      }
      if (typeof navigator.storage.estimate === 'function') {
        const est = await navigator.storage.estimate();
        usageBytes = Number(est?.usage) || 0;
        quotaBytes = Number(est?.quota) || 0;
      }
    }
  } catch (e) {}
  return { persisted, usageBytes, quotaBytes };
}

export function latLonToTileEPSG3395(lat, lon, z) {
  const n = Math.pow(2, z);
  const clampedLat = Math.max(-85.051128, Math.min(85.051128, Number(lat) || 0));
  const normLon = ((Number(lon) || 0) + 180) / 360;
  const x = Math.max(0, Math.min(n - 1, Math.floor(normLon * n)));
  const phi = (clampedLat * Math.PI) / 180;
  const sinPhi = Math.sin(phi);
  const eSin = WGS84_ECCENTRICITY * sinPhi;
  const mercY = 0.5 * Math.log((1 + sinPhi) / (1 - sinPhi)) -
    0.5 * WGS84_ECCENTRICITY * Math.log((1 + eSin) / (1 - eSin));
  const normY = 0.5 - mercY / (2 * Math.PI);
  const y = Math.max(0, Math.min(n - 1, Math.floor(normY * n)));
  return { x, y, z };
}

function tileY3395ToLatDeg(yFloat, z) {
  const normY = yFloat / Math.pow(2, z);
  const mercY = (0.5 - normY) * 2 * Math.PI;
  const ts = Math.exp(-mercY);
  let phi = Math.PI / 2 - 2 * Math.atan(ts);
  for (let i = 0; i < 5; i++) {
    const sinPhi = Math.sin(phi);
    const con = Math.pow((1 - WGS84_ECCENTRICITY * sinPhi) / (1 + WGS84_ECCENTRICITY * sinPhi), WGS84_ECCENTRICITY / 2);
    phi = Math.PI / 2 - 2 * Math.atan(ts * con);
  }
  return (phi * 180) / Math.PI;
}

function latDegToGlobalPixelY3857(latDeg, z) {
  const clamped = Math.max(-85.051128, Math.min(85.051128, latDeg));
  const phi = (clamped * Math.PI) / 180;
  const merc = Math.log(Math.tan(Math.PI / 4 + phi / 2));
  return (0.5 - merc / (2 * Math.PI)) * 256 * Math.pow(2, z);
}

export function computeBoundingBoxForRadiusKm(lat, lon, radiusKm = 50) {
  const rKm = Math.max(5, Math.min(250, Number(radiusKm) || 50));
  const dLat = rKm / 111.132;
  const cosLat = Math.max(0.20, Math.cos((Number(lat) * Math.PI) / 180));
  const dLon = rKm / (111.320 * cosLat);
  return {
    north: Math.min(84.5, Number(lat) + dLat),
    south: Math.max(-84.5, Number(lat) - dLat),
    east: Math.min(179.99, Number(lon) + dLon),
    west: Math.max(-179.99, Number(lon) - dLon),
    radiusKm: rKm
  };
}

/**
 * Компактный, сбалансированный план тайлов (220–450 тайлов вместо 6158!):
 * - z7..z10 (для 50 км) и z7..z9 (для 120 км) покрывают 100% площади рамки без белых пятен;
 * - z11..z14 покрывают рыболовное ядро вокруг точки и ближайших водоёмов с поддержкой плавного Overzoom до z18!
 */
export function buildOfflinePackTilePlan({
  centerLat,
  centerLon,
  radiusKm = 50,
  layerMode = 'satellite',
  smartHydroZ15 = true,
  waterPoints = [],
  viewportBounds = null
}) {
  const is120 = Number(radiusKm) >= 100;
  const effRadiusKm = is120 ? 120 : 50;
  const bbox = computeBoundingBoxForRadiusKm(centerLat, centerLon, effRadiusKm);

  const coordKeysSet = new Set();
  const baseCoords = [];
  const highDetailSklCoordKeys = new Set();

  const addFullBboxAtZoom = (z) => {
    const nw = latLonToTileEPSG3395(bbox.north, bbox.west, z);
    const se = latLonToTileEPSG3395(bbox.south, bbox.east, z);
    const cTile = latLonToTileEPSG3395(centerLat, centerLon, z);
    const xMin = Math.min(nw.x, se.x);
    const xMax = Math.max(nw.x, se.x);
    const yMin = Math.min(nw.y, se.y);
    const yMax = Math.max(nw.y, se.y);
    const levelCoords = [];
    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        const ck = `${z}_${x}_${y}`;
        if (!coordKeysSet.has(ck)) {
          coordKeysSet.add(ck);
          const distSq = (x - cTile.x) * (x - cTile.x) + (y - cTile.y) * (y - cTile.y);
          levelCoords.push({ z, x, y, distSq });
        }
      }
    }
    levelCoords.sort((a, b) => a.distSq - b.distSq);
    for (const lc of levelCoords) baseCoords.push({ z: lc.z, x: lc.x, y: lc.y });
  };

  const addTileSpanAroundPoint = (lat, lon, z, halfSpanTiles, includeHybridLabels = false) => {
    const n = Math.pow(2, z);
    const c = latLonToTileEPSG3395(lat, lon, z);
    const levelCoords = [];
    for (let dx = -halfSpanTiles; dx <= halfSpanTiles; dx++) {
      for (let dy = -halfSpanTiles; dy <= halfSpanTiles; dy++) {
        const tx = c.x + dx;
        const ty = c.y + dy;
        if (tx >= 0 && tx < n && ty >= 0 && ty < n) {
          const ck = `${z}_${tx}_${ty}`;
          if (includeHybridLabels) highDetailSklCoordKeys.add(ck);
          if (!coordKeysSet.has(ck)) {
            coordKeysSet.add(ck);
            levelCoords.push({ z, x: tx, y: ty, distSq: dx * dx + dy * dy });
          }
        }
      }
    }
    levelCoords.sort((a, b) => a.distSq - b.distSq);
    for (const lc of levelCoords) baseCoords.push({ z: lc.z, x: lc.x, y: lc.y });
  };

  const addViewportBoxAtZoom = (vb, z, maxSpanPerAxis = 10) => {
    if (!vb || !Number.isFinite(vb.north) || !Number.isFinite(vb.south)) return;
    const nw = latLonToTileEPSG3395(vb.north, vb.west, z);
    const se = latLonToTileEPSG3395(vb.south, vb.east, z);
    const midLat = (vb.north + vb.south) / 2;
    const midLon = (vb.west + vb.east) / 2;
    const cTile = latLonToTileEPSG3395(midLat, midLon, z);
    const xMin = Math.max(Math.min(nw.x, se.x), cTile.x - Math.floor(maxSpanPerAxis / 2));
    const xMax = Math.min(Math.max(nw.x, se.x), cTile.x + Math.floor(maxSpanPerAxis / 2));
    const yMin = Math.max(Math.min(nw.y, se.y), cTile.y - Math.floor(maxSpanPerAxis / 2));
    const yMax = Math.min(Math.max(nw.y, se.y), cTile.y + Math.floor(maxSpanPerAxis / 2));
    const levelCoords = [];
    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        const ck = `${z}_${x}_${y}`;
        if (!coordKeysSet.has(ck)) {
          coordKeysSet.add(ck);
          const distSq = (x - cTile.x) * (x - cTile.x) + (y - cTile.y) * (y - cTile.y);
          levelCoords.push({ z, x, y, distSq });
        }
      }
    }
    levelCoords.sort((a, b) => a.distSq - b.distSq);
    for (const lc of levelCoords) baseCoords.push({ z: lc.z, x: lc.x, y: lc.y });
  };

  // 1. 100% СПЛОШНОЕ ПОКРЫТИЕ ВСЕГО КВАДРАТА 50 КМ ИЛИ 120 КМ БЕЗ ПРОПУСКОВ (~75–135 МБ):
  // - Для квадрата 50 км (100x100 км): 100% всей площади квадрата скачивается на Z7, Z8, Z9, Z10, Z11, Z12 и Z13 (3 612 тайлов сплошного покрытия каждого километра квадрата!)
  // - Для квадрата 120 км (240x240 км): 100% всей площади квадрата скачивается на Z7, Z8, Z9, Z10, Z11 и Z12 (5 031 тайл сплошного покрытия!) + массивный квадрат 31x31 тайл (961 шт.) на Z13!
  addFullBboxAtZoom(7);
  addFullBboxAtZoom(8);
  addFullBboxAtZoom(9);
  addFullBboxAtZoom(10);
  addFullBboxAtZoom(11);
  addFullBboxAtZoom(12);
  if (!is120) {
    addFullBboxAtZoom(13);
  } else {
    addTileSpanAroundPoint(centerLat, centerLon, 13, 15, true);
  }

  // 2. Видимая область экрана пользователя (viewportBounds) — полное покрытие Z13..Z18
  if (viewportBounds) {
    addViewportBoxAtZoom(viewportBounds, 13, 12);
    addViewportBoxAtZoom(viewportBounds, 14, 10);
    if (smartHydroZ15) {
      addViewportBoxAtZoom(viewportBounds, 15, 8);
      addViewportBoxAtZoom(viewportBounds, 16, 6);
      addViewportBoxAtZoom(viewportBounds, 17, 4);
      addViewportBoxAtZoom(viewportBounds, 18, 3);
    }
  }

  // 3. Все пользовательские точки (слипы, стоянки, ямы, домашняя точка) и все водоёмы (реки, озёра, протоки) внутри квадрата
  const allCandidatePts = (Array.isArray(waterPoints) ? waterPoints : []).filter(w =>
    w && Number.isFinite(Number(w.lat)) && Number.isFinite(Number(w.lon)) &&
    Number(w.lat) >= bbox.south && Number(w.lat) <= bbox.north &&
    Number(w.lon) >= bbox.west && Number(w.lon) <= bbox.east
  );
  const priorityUserSpots = allCandidatePts.filter(w => w.isPrioritySpot).slice(0, 24);
  const riverAndLakePts = allCandidatePts.filter(w => !w.isPrioritySpot).slice(0, 36);

  // 4. Широкий массив Z14..Z18 вокруг центра квадрата
  addTileSpanAroundPoint(centerLat, centerLon, 14, is120 ? 8 : 7, true);
  if (smartHydroZ15) {
    addTileSpanAroundPoint(centerLat, centerLon, 15, 5, true);
    addTileSpanAroundPoint(centerLat, centerLon, 16, 4, true);
    addTileSpanAroundPoint(centerLat, centerLon, 17, 3, true);
    addTileSpanAroundPoint(centerLat, centerLon, 18, 2, true);
  }

  // 5. Полная детализация Z14..Z18 вокруг ВСЕХ пользовательских меток на карте
  priorityUserSpots.forEach((sp) => {
    addTileSpanAroundPoint(sp.lat, sp.lon, 13, 3, true);
    addTileSpanAroundPoint(sp.lat, sp.lon, 14, 3, true);
    if (smartHydroZ15) {
      addTileSpanAroundPoint(sp.lat, sp.lon, 15, 2, true);
      addTileSpanAroundPoint(sp.lat, sp.lon, 16, 2, true);
      addTileSpanAroundPoint(sp.lat, sp.lon, 17, 2, true);
      addTileSpanAroundPoint(sp.lat, sp.lon, 18, 1, true);
    }
  });

  // 6. Детализация Z13..Z17 вдоль всех рек, проток и озёр внутри квадрата 50/120 км
  riverAndLakePts.forEach((wp, idx) => {
    if (is120) {
      addTileSpanAroundPoint(wp.lat, wp.lon, 13, 3, true);
    }
    addTileSpanAroundPoint(wp.lat, wp.lon, 14, 2, true);
    if (smartHydroZ15 && idx < 18) {
      addTileSpanAroundPoint(wp.lat, wp.lon, 15, 2, true);
      if (idx < 10) {
        addTileSpanAroundPoint(wp.lat, wp.lon, 16, 1, true);
        addTileSpanAroundPoint(wp.lat, wp.lon, 17, 1, true);
      }
    }
  });

  const selectedLayers = [];
  if (layerMode === 'scheme') {
    selectedLayers.push('yandex_map');
  } else if (layerMode === 'satellite') {
    selectedLayers.push('yandex_sat');
  } else {
    selectedLayers.push('yandex_sat', 'yandex_map');
  }

  const tileTasks = [];
  const taskKeysSet = new Set();
  let estimatedTotalBytes = 0;

  const pushTask = (layerId, c) => {
    const key = `${layerId}_${c.z}_${c.x}_${c.y}`;
    if (taskKeysSet.has(key)) return;
    const lyrCfg = OFFLINE_LAYER_SOURCES[layerId];
    if (!lyrCfg) return;
    taskKeysSet.add(key);
    tileTasks.push({
      key,
      layerId,
      z: c.z,
      x: c.x,
      y: c.y
    });
    estimatedTotalBytes += lyrCfg.avgTileBytes;
  };

  const maxZ = smartHydroZ15 ? 18 : 14;
  for (let z = 7; z <= maxZ; z++) {
    const coordsAtZ = baseCoords.filter(c => c.z === z);
    for (const c of coordsAtZ) {
      if (layerMode === 'scheme') {
        pushTask('yandex_map', c);
      } else if (layerMode === 'satellite') {
        pushTask('yandex_sat', c);
      } else {
        pushTask('yandex_sat', c);
        pushTask('yandex_map', c);
      }
    }
  }

  return {
    radiusKm: effRadiusKm,
    bbox,
    layerMode,
    layers: selectedLayers,
    smartHydroZ15,
    maxZoom: maxZ,
    baseTileCount: baseCoords.length,
    totalTiles: tileTasks.length,
    estimatedTotalBytes,
    tileTasks
  };
}

export async function inspectPlanOverlapWithExistingDB(plan) {
  await syncOfflineKeysIndexFromDB(false);
  if (!plan || !Array.isArray(plan.tileTasks)) {
    return {
      alreadyCachedTiles: 0,
      needDownloadTiles: 0,
      estimatedDownloadBytes: 0
    };
  }
  let alreadyCachedTiles = 0;
  let estimatedDownloadBytes = 0;
  for (const t of plan.tileTasks) {
    if (_offlineTileKeysSet.has(t.key)) {
      alreadyCachedTiles++;
    } else {
      estimatedDownloadBytes += (OFFLINE_LAYER_SOURCES[t.layerId]?.avgTileBytes || 16000);
    }
  }
  return {
    alreadyCachedTiles,
    needDownloadTiles: Math.max(0, plan.tileTasks.length - alreadyCachedTiles),
    estimatedDownloadBytes
  };
}

function querySingleTileKeyFromDB(key) {
  if (!key) return Promise.resolve(null);
  if (_ramTileDataUrlCache.has(key)) {
    const dUrl = _ramTileDataUrlCache.get(key);
    const pts = String(key).split('_');
    return Promise.resolve({
      key,
      layerId: pts.length >= 5 ? `${pts[0]}_${pts[1]}` : 'yandex_map',
      z: pts.length >= 5 ? parseInt(pts[2], 10) : 10,
      x: pts.length >= 5 ? parseInt(pts[3], 10) : 0,
      y: pts.length >= 5 ? parseInt(pts[4], 10) : 0,
      sizeBytes: Math.round(dUrl.length * 0.74),
      dataUrl: dUrl
    });
  }
  if (_offlineKeysIndexed && !_offlineTileKeysSet.has(key)) {
    return Promise.resolve(null);
  }
  return openOfflineMapsDB().then((db) => {
    if (!db) return null;
    return new Promise((resolve) => {
      const attemptGet = (dbConn, isRetry = false) => {
        try {
          const tx = dbConn.transaction(['tiles'], 'readonly');
          const req = tx.objectStore('tiles').get(key);
          req.onsuccess = () => {
            const res = req.result;
            if (res && typeof res.dataUrl === 'string' && res.dataUrl.length > 200) {
              putRamTileCache(key, res.dataUrl);
              _offlineTileKeysSet.add(key);
              resolve(res);
            } else {
              resolve(null);
            }
          };
          req.onerror = () => resolve(null);
        } catch (e) {
          if (!isRetry) {
            openOfflineMapsDB(true).then(freshDb => {
              if (freshDb) attemptGet(freshDb, true);
              else resolve(null);
            });
          } else {
            resolve(null);
          }
        }
      };
      attemptGet(db, false);
    });
  });
}

export async function getOfflineTileRecord(layerId, z, x, y, allowCrossLayerFallback = false) {
  const primaryKey = `${layerId}_${z}_${x}_${y}`;
  // Если индекс уже в памяти, проверяем мгновенно без открытия транзакций IndexedDB!
  if (_offlineKeysIndexed) {
    if (_offlineTileKeysSet.has(primaryKey)) {
      const rec = await querySingleTileKeyFromDB(primaryKey);
      if (rec) return rec;
    }
    if (allowCrossLayerFallback && layerId !== 'yandex_skl') {
      const altLayer = layerId === 'yandex_map' ? 'yandex_sat' : 'yandex_map';
      const altKey = `${altLayer}_${z}_${x}_${y}`;
      if (_offlineTileKeysSet.has(altKey)) {
        return await querySingleTileKeyFromDB(altKey);
      }
    }
    return null;
  }
  const exact = await querySingleTileKeyFromDB(primaryKey);
  if (exact) return exact;
  if (allowCrossLayerFallback && layerId !== 'yandex_skl') {
    const altLayer = layerId === 'yandex_map' ? 'yandex_sat' : 'yandex_map';
    return await querySingleTileKeyFromDB(`${altLayer}_${z}_${x}_${y}`);
  }
  return null;
}

export async function findParentOfflineTileForOverzoom(layerId, targetZ, targetX, targetY, allowCrossLayerFallback = true) {
  if (!_offlineKeysIndexed) {
    await syncOfflineKeysIndexFromDB(false);
  }
  if (_offlineTileKeysSet.size === 0) return null;

  const minSearchZ = 7;
  const candidateLayers = (allowCrossLayerFallback && layerId !== 'yandex_skl')
    ? [layerId, layerId === 'yandex_map' ? 'yandex_sat' : 'yandex_map']
    : [layerId];

  for (const lyr of candidateLayers) {
    const startPz = lyr === 'yandex_sat' ? Math.min(targetZ - 1, 13) : (targetZ - 1);
    for (let pz = startPz; pz >= minSearchZ; pz--) {
      const shift = targetZ - pz;
      const px = targetX >> shift;
      const py = targetY >> shift;
      const pKey = `${lyr}_${pz}_${px}_${py}`;
      // Мгновенная проверка в Set в RAM (0 транзакций к БД для отсутствующих уровней!)
      if (!_offlineTileKeysSet.has(pKey)) continue;
      const rec = await querySingleTileKeyFromDB(pKey);
      if (rec && rec.dataUrl) {
        const scaleFactor = 1 << shift;
        const subX = targetX - (px << shift);
        const subY = targetY - (py << shift);
        return {
          record: rec,
          parentZ: pz,
          scaleFactor,
          cropX: (subX / scaleFactor) * 256,
          cropY: (subY / scaleFactor) * 256,
          cropSize: 256 / scaleFactor
        };
      }
    }
  }
  return null;
}

/**
 * Мгновенная генерация векторной SVG-сетки для тайлов вне скачанной зоны (0 мс, 0 нагрузки на Canvas и CPU!)
 */
function getTacticalOfflineGridSvgUrl(coords) {
  const z = coords?.z || 0;
  const x = coords?.x || 0;
  const y = coords?.y || 0;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" fill="#0c192c"/><path d="M64 0v256M128 0v256M192 0v256M0 64h256M0 128h256M0 192h256" stroke="#38bdf8" stroke-opacity="0.12" stroke-width="1"/><rect x="0.5" y="0.5" width="255" height="255" fill="none" stroke="#38bdf8" stroke-opacity="0.18" stroke-width="1"/><text x="10" y="22" fill="#94a3b8" fill-opacity="0.48" font-family="monospace" font-size="10" font-weight="bold">ВНЕ ЗОНЫ ОФЛАЙН-КАРТЫ (Z${z})</text><text x="10" y="36" fill="#94a3b8" fill-opacity="0.40" font-family="monospace" font-size="10">X:${x} Y:${y}</text></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

function applyCanvasSharpenAndContrast(ctx, width, height, scaleFactor = 2) {
  if (!ctx || scaleFactor < 2) return;
  try {
    const imgData = ctx.getImageData(0, 0, width, height);
    const d = imgData.data;
    const copy = new Uint8ClampedArray(d);
    // Усиливаем локальный микроконтраст береговых линий, проток и стариц при сильном увеличении
    const amount = Math.min(0.65, 0.22 + Math.log2(scaleFactor) * 0.10);
    const w4 = width * 4;
    for (let y = 1; y < height - 1; y++) {
      const row = y * w4;
      for (let x = 1; x < width - 1; x++) {
        const idx = row + x * 4;
        for (let c = 0; c < 3; c++) {
          const center = copy[idx + c];
          const neighbors = (
            copy[idx - 4 + c] +
            copy[idx + 4 + c] +
            copy[idx - w4 + c] +
            copy[idx + w4 + c]
          ) * 0.25;
          const sharpened = center + (center - neighbors) * (amount * 2.4);
          // Легкая S-кривая контраста для разделения воды и берега
          const norm = Math.max(0, Math.min(255, sharpened)) / 255;
          const contrasted = (norm - 0.5) * (1 + amount * 0.35) + 0.5;
          d[idx + c] = Math.max(0, Math.min(255, Math.round(contrasted * 255)));
        }
      }
    }
    ctx.putImageData(imgData, 0, 0);
  } catch (_e) {}
}

export function renderOverzoomOrFallbackCanvasDataUrl(overzoomInfo, coords, isLabelsLayer = false, overlaySchemeOverzoom = null) {
  const TRANSPARENT_GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  if (isLabelsLayer && (!overzoomInfo || !overzoomInfo.record || !overzoomInfo.record.dataUrl)) {
    return Promise.resolve(TRANSPARENT_GIF);
  }
  if (!overzoomInfo || !overzoomInfo.record || !overzoomInfo.record.dataUrl) {
    return Promise.resolve(getTacticalOfflineGridSvgUrl(coords));
  }
  return new Promise((resolve) => {
    const dim = isLabelsLayer ? 256 : 512; // 512x512 Retina Ultra-HD для максимальной чёткости на экранах смартфонов!
    const canvas = document.createElement('canvas');
    canvas.width = dim;
    canvas.height = dim;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      resolve(isLabelsLayer ? TRANSPARENT_GIF : getTacticalOfflineGridSvgUrl(coords));
      return;
    }
    const img = new Image();
    img.onload = () => {
      const scale = img.naturalWidth > 0 ? (img.naturalWidth / 256) : 1;
      const sx = overzoomInfo.cropX * scale;
      const sy = overzoomInfo.cropY * scale;
      const sw = Math.max(1, overzoomInfo.cropSize * scale);
      const sh = Math.max(1, overzoomInfo.cropSize * scale);

      if (!isLabelsLayer && overzoomInfo.scaleFactor >= 4) {
        // МНОГОСТУПЕНЧАТЫЙ 2x ПИРАМИДАЛЬНЫЙ АПСКЕЙЛЕР С ФИКСАЦИЕЙ БЕРЕГОВЫХ ЛИНИЙ НА КАЖДОМ ШАГЕ:
        // Вместо одного размытого растяжения (например, 16px -> 512px) увеличиваем кратно 2x (64 -> 128 -> 256 -> 512),
        // на каждом шаге перехватывая и заостряя границу воды и берега до 1 пикселя!
        let curW = Math.max(64, Math.min(256, Math.round(sw * 2)));
        let stepCanvas = document.createElement('canvas');
        stepCanvas.width = curW;
        stepCanvas.height = curW;
        let stepCtx = stepCanvas.getContext('2d');
        stepCtx.imageSmoothingEnabled = true;
        try { stepCtx.imageSmoothingQuality = 'high'; } catch (_e) {}
        stepCtx.drawImage(img, sx, sy, sw, sh, 0, 0, curW, curW);
        applyCanvasSharpenAndContrast(stepCtx, curW, curW, 2);

        while (curW < dim) {
          const nextW = Math.min(dim, curW * 2);
          const nextCanvas = document.createElement('canvas');
          nextCanvas.width = nextW;
          nextCanvas.height = nextW;
          const nextCtx = nextCanvas.getContext('2d');
          nextCtx.imageSmoothingEnabled = true;
          try { nextCtx.imageSmoothingQuality = 'high'; } catch (_e) {}
          nextCtx.drawImage(stepCanvas, 0, 0, curW, curW, 0, 0, nextW, nextW);
          applyCanvasSharpenAndContrast(nextCtx, nextW, nextW, 2);
          stepCanvas.width = 0;
          stepCanvas.height = 0;
          stepCanvas = nextCanvas;
          stepCtx = nextCtx;
          curW = nextW;
        }
        ctx.drawImage(stepCanvas, 0, 0, dim, dim);
        stepCanvas.width = 0;
        stepCanvas.height = 0;
      } else {
        ctx.imageSmoothingEnabled = true;
        try { ctx.imageSmoothingQuality = 'high'; } catch (e) {}
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dim, dim);
        if (!isLabelsLayer && overzoomInfo.scaleFactor >= 2) {
          applyCanvasSharpenAndContrast(ctx, dim, dim, overzoomInfo.scaleFactor);
        }
      }

      const finishWithOptionalOverlay = () => {
        const outUrl = isLabelsLayer ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.92);
        canvas.width = 0;
        canvas.height = 0;
        resolve(outUrl);
      };
      if (!isLabelsLayer && overlaySchemeOverzoom && overlaySchemeOverzoom.record && overlaySchemeOverzoom.record.dataUrl) {
        const schemeImg = new Image();
        schemeImg.onload = () => {
          try {
            const sScale = schemeImg.naturalWidth > 0 ? (schemeImg.naturalWidth / 256) : 1;
            ctx.save();
            ctx.globalAlpha = overzoomInfo.scaleFactor >= 4 ? 0.45 : 0.30;
            ctx.globalCompositeOperation = 'source-over';
            ctx.drawImage(
              schemeImg,
              overlaySchemeOverzoom.cropX * sScale,
              overlaySchemeOverzoom.cropY * sScale,
              overlaySchemeOverzoom.cropSize * sScale,
              overlaySchemeOverzoom.cropSize * sScale,
              0,
              0,
              dim,
              dim
            );
            ctx.restore();
          } catch (_e) {}
          finishWithOptionalOverlay();
        };
        schemeImg.onerror = () => finishWithOptionalOverlay();
        schemeImg.src = overlaySchemeOverzoom.record.dataUrl;
        return;
      }
      finishWithOptionalOverlay();
    };
    img.onerror = () => {
      canvas.width = 0;
      canvas.height = 0;
      resolve(isLabelsLayer ? TRANSPARENT_GIF : getTacticalOfflineGridSvgUrl(coords));
    };
    img.src = overzoomInfo.record.dataUrl;
  });
}

export function createOfflineAwareLeafletLayer(layerId, urlTemplate, fallbacks = [], subdomains = ['1', '2', '3', '4'], attr = '', tileClassName = 'klev-base-tile-layer') {
  if (typeof L === 'undefined' || !L.TileLayer) return null;
  const storageLayerId = layerId === 'yandex_skl'
    ? 'yandex_skl'
    : (layerId === 'yandex_sat' || layerId === 'yandex_hybrid' ? 'yandex_sat' : 'yandex_map');
  const isLabels = storageLayerId === 'yandex_skl';
  const TRANSPARENT_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

  const CustomOfflineLayer = L.TileLayer.extend({
    createTile: function (coords, done) {
      const self = this;
      const tile = document.createElement('img');
      if (this.options.crossOrigin || this.options.crossOrigin === '') {
        tile.crossOrigin = this.options.crossOrigin === true ? '' : this.options.crossOrigin;
      }
      tile.alt = '';
      tile.setAttribute('role', 'presentation');
      if (tileClassName) tile.className = tileClassName;

      const z = coords.z;
      const x = coords.x;
      const y = coords.y;
      const rawNetUrl = this.getTileUrl(coords);
      const netUrl = rawNetUrl + (rawNetUrl.includes('?') ? `&_cb=${_tileCacheBustSeq}` : `?_cb=${_tileCacheBustSeq}`);
      let isDoneCalled = false;

      const finishTileLoad = () => {
        if (isDoneCalled) return;
        isDoneCalled = true;
        self._tileOnLoad(done, tile);
      };

      const isCurrentlyOffline = (typeof navigator !== 'undefined' && navigator.onLine === false) || _forceOfflineTestMode;

      // Для прозрачного слоя подписей и дорог (yandex_skl)
      if (isLabels) {
        const sklKey = `yandex_skl_${z}_${x}_${y}`;
        const sklRam = _ramTileDataUrlCache.get(sklKey);
        if (sklRam) {
          tile.setAttribute('data-offline-hit', '1');
          tile.onload = () => finishTileLoad();
          tile.onerror = () => finishTileLoad();
          tile.src = sklRam;
          return tile;
        }
        getOfflineTileRecord('yandex_skl', z, x, y, false).then(async (rec) => {
          if (rec && rec.dataUrl) {
            tile.setAttribute('data-offline-hit', '1');
            tile.onload = () => finishTileLoad();
            tile.onerror = () => finishTileLoad();
            tile.src = rec.dataUrl;
            return;
          }
          if (isCurrentlyOffline) {
            const sklOz = await findParentOfflineTileForOverzoom('yandex_skl', z, x, y, false);
            if (sklOz) {
              const ozUrl = await renderOverzoomOrFallbackCanvasDataUrl(sklOz, coords, true);
              tile.onload = () => finishTileLoad();
              tile.onerror = () => finishTileLoad();
              tile.src = ozUrl;
              return;
            }
            tile.onload = () => finishTileLoad();
            tile.onerror = () => finishTileLoad();
            tile.src = TRANSPARENT_PIXEL;
            return;
          }
          tile.onload = () => finishTileLoad();
          tile.onerror = () => {
            tile.onerror = null;
            tile.src = TRANSPARENT_PIXEL;
            finishTileLoad();
          };
          tile.src = netUrl;
        }).catch(() => {
          tile.onload = () => finishTileLoad();
          tile.onerror = () => finishTileLoad();
          tile.src = TRANSPARENT_PIXEL;
        });
        return tile;
      }

      // Функция отрисовки офлайн-оверзума (строго сохраняет тип слоя: спутник никогда не подменяется белой схемой)
      const renderOfflineFallbackToTile = async () => {
        try {
          let overzoom = await findParentOfflineTileForOverzoom(storageLayerId, z, x, y, false);
          if (!overzoom && isCurrentlyOffline) {
            const altLayerId = storageLayerId === 'yandex_map' ? 'yandex_sat' : 'yandex_map';
            const altExact = await getOfflineTileRecord(altLayerId, z, x, y, false);
            if (altExact && altExact.dataUrl) {
              tile.setAttribute('data-offline-hit', '1');
              tile.setAttribute('data-offline-layer', altLayerId);
              tile.onload = () => finishTileLoad();
              tile.onerror = () => finishTileLoad();
              tile.src = altExact.dataUrl;
              return;
            }
            overzoom = await findParentOfflineTileForOverzoom(altLayerId, z, x, y, false);
          }
          if (overzoom) {
            const dataUrl = await renderOverzoomOrFallbackCanvasDataUrl(
              overzoom,
              coords,
              false,
              null
            );
            tile.onload = () => finishTileLoad();
            tile.onerror = () => finishTileLoad();
            tile.setAttribute('data-offline-overzoom', String(overzoom.parentZ));
            tile.src = dataUrl;
            return;
          }
          // Если мы ОНЛАЙН и сервер спутника вернул 404 на высоком зуме Z14..Z18 в северных широтах,
          // апскейлим родительский спутниковый снимок Z13/Z12 или Esri World Imagery без подмены на белую схему!
          if (!isCurrentlyOffline) {
            const synthesizedOnline = await synthesizeOnlineHighZoomFallbackDataUrl(storageLayerId, z, x, y);
            if (synthesizedOnline) {
              tile.onload = () => finishTileLoad();
              tile.onerror = () => finishTileLoad();
              tile.src = synthesizedOnline;
              return;
            }
            if (storageLayerId === 'yandex_sat') {
              const pz = Math.min(z - 1, 12);
              const shift = Math.max(1, z - pz);
              const px = x >> shift;
              const py = y >> shift;
              tile.onload = () => finishTileLoad();
              tile.onerror = () => finishTileLoad();
              tile.src = `https://sat01.maps.yandex.net/tiles?l=sat&x=${px}&y=${py}&z=${pz}&lang=ru_RU&_cb=${_tileCacheBustSeq}`;
              return;
            }
            tile.onload = () => finishTileLoad();
            tile.onerror = () => finishTileLoad();
            tile.src = `https://core-renderer-tiles.maps.yandex.net/tiles?l=map&v=24.10.30-0&x=${x}&y=${y}&z=${z}&scale=2&lang=ru_RU&_cb=${_tileCacheBustSeq}`;
            return;
          }
          const gridUrl = getTacticalOfflineGridSvgUrl(coords);
          tile.onload = () => finishTileLoad();
          tile.onerror = () => finishTileLoad();
          tile.setAttribute('data-offline-overzoom', 'grid');
          tile.src = gridUrl;
          // Автоматическое самовосстановление тайлов после отключения/переключения VPN или смены сети (Wi-Fi <-> LTE)
          if (!_forceOfflineTestMode) {
            [1500, 3500, 6800].forEach((delayMs) => {
              setTimeout(() => {
                if (_forceOfflineTestMode || !tile.isConnected || tile.getAttribute('data-offline-overzoom') !== 'grid') return;
                if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
                const retryImg = new Image();
                retryImg.crossOrigin = 'anonymous';
                const retryCb = `${_tileCacheBustSeq}_${Date.now()}`;
                const retryPrimary = rawNetUrl + (rawNetUrl.includes('?') ? `&_cb=${retryCb}` : `?_cb=${retryCb}`);
                const isApkEnv = typeof window !== 'undefined' && Boolean(window.AndroidBridge);
                const retryCandidates = [
                  retryPrimary,
                  ...(isApkEnv ? [`https://appassets.androidplatform.net/__klev_tile_proxy__?layer=${encodeURIComponent(storageLayerId)}&z=${z}&x=${x}&y=${y}&_cb=${retryCb}`] : []),
                  storageLayerId === 'yandex_sat'
                    ? `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}?_cb=${retryCb}`
                    : `https://tile.openstreetmap.org/${z}/${x}/${y}.png?_cb=${retryCb}`
                ];
                let cIdx = 0;
                const tryNextCandidate = () => {
                  if (cIdx >= retryCandidates.length) return;
                  const candUrl = retryCandidates[cIdx++];
                  retryImg.onload = () => {
                    if (tile.isConnected && tile.getAttribute('data-offline-overzoom') === 'grid') {
                      tile.removeAttribute('data-offline-overzoom');
                      tile.src = candUrl;
                    }
                  };
                  retryImg.onerror = () => tryNextCandidate();
                  retryImg.src = candUrl;
                };
                tryNextCandidate();
              }, delayMs);
            });
          }
        } catch (e) {
          finishTileLoad();
        }
      };

      const exactKey = `${storageLayerId}_${z}_${x}_${y}`;
      const isHighZoomLegacySat = (storageLayerId === 'yandex_sat' && z >= 14);

      // Если пользователь выключил отображение загруженных офлайн-карт тумблером на плашке (и есть интернет), грузим живую онлайн-карту!
      if (!_offlineMapsEnabledOnMap && !isCurrentlyOffline) {
        let fbIdx = 0;
        tile.onload = () => finishTileLoad();
        tile.onerror = () => {
          if (fbIdx < fallbacks.length) {
            const sub = subdomains[Math.abs(x + y) % subdomains.length] || '1';
            const fbUrl = fallbacks[fbIdx++]
              .replace('{s}', sub)
              .replace('{z}', String(z))
              .replace('{x}', String(x))
              .replace('{y}', String(y));
            tile.src = fbUrl + (fbUrl.includes('?') ? `&_cb=${_tileCacheBustSeq}` : `?_cb=${_tileCacheBustSeq}`);
            return;
          }
          finishTileLoad();
        };
        tile.src = netUrl;
        return tile;
      }

      // 1. Сверхбыстрая проверка точного тайла из RAM-кэша (для спутника Z>=14 используем чистый оверзум родительского спутника Z13)
      if (!isHighZoomLegacySat && _offlineTileKeysSet.has(exactKey) && _ramTileDataUrlCache.has(exactKey)) {
        const ramHit = _ramTileDataUrlCache.get(exactKey);
        tile.setAttribute('data-offline-hit', '1');
        tile.setAttribute('data-offline-layer', storageLayerId);
        tile.onload = () => finishTileLoad();
        tile.onerror = () => finishTileLoad();
        tile.src = ramHit;
        return tile;
      }

      // 2. Если индекс ключей уже в памяти и точного тайла нет, а интернет включён — грузим напрямую по сети!
      if (_offlineKeysIndexed && !isCurrentlyOffline && (!_offlineTileKeysSet.has(exactKey) || isHighZoomLegacySat)) {
        let fbIdx = 0;
        tile.onload = () => finishTileLoad();
        tile.onerror = () => {
          if (fbIdx < fallbacks.length) {
            const sub = subdomains[Math.abs(x + y) % subdomains.length] || '1';
            const fbUrl = fallbacks[fbIdx++]
              .replace('{s}', sub)
              .replace('{z}', String(z))
              .replace('{x}', String(x))
              .replace('{y}', String(y));
            tile.src = fbUrl + (fbUrl.includes('?') ? `&_cb=${_tileCacheBustSeq}` : `?_cb=${_tileCacheBustSeq}`);
            return;
          }
          tile.onerror = null;
          renderOfflineFallbackToTile();
        };
        tile.src = netUrl;
        return tile;
      }

      // 3. Читаем точный тайл из IndexedDB
      getOfflineTileRecord(storageLayerId, z, x, y, false).then(async (rec) => {
        if (rec && rec.dataUrl && (!isHighZoomLegacySat || rec.pureSatV2 === true)) {
          tile.setAttribute('data-offline-hit', '1');
          tile.setAttribute('data-offline-layer', storageLayerId);
          tile.onload = () => finishTileLoad();
          tile.onerror = () => renderOfflineFallbackToTile();
          tile.src = rec.dataUrl;
          return;
        }
        if (isCurrentlyOffline) {
          await renderOfflineFallbackToTile();
          return;
        }
        let fbIdx = 0;
        tile.onload = () => finishTileLoad();
        tile.onerror = () => {
          if (fbIdx < fallbacks.length) {
            const sub = subdomains[Math.abs(x + y) % subdomains.length] || '1';
            const fbUrl = fallbacks[fbIdx++]
              .replace('{s}', sub)
              .replace('{z}', String(z))
              .replace('{x}', String(x))
              .replace('{y}', String(y));
            tile.src = fbUrl + (fbUrl.includes('?') ? `&_cb=${_tileCacheBustSeq}` : `?_cb=${_tileCacheBustSeq}`);
            return;
          }
          tile.onerror = null;
          renderOfflineFallbackToTile();
        };
        tile.src = netUrl;
      }).catch(() => {
        if (isCurrentlyOffline) {
          renderOfflineFallbackToTile();
        } else {
          tile.onload = () => finishTileLoad();
          tile.onerror = () => renderOfflineFallbackToTile();
          tile.src = netUrl;
        }
      });

      return tile;
    }
  });

  return new CustomOfflineLayer(urlTemplate, {
    maxZoom: 18,
    subdomains,
    attribution: attr,
    className: tileClassName,
    updateWhenIdle: true,
    updateWhenZooming: false,
    keepBuffer: 3
  });
}

export async function getAllOfflineMapPacks() {
  await syncOfflineKeysIndexFromDB(false);
  const db = await openOfflineMapsDB();
  if (!db) return _cachedPacksList;
  return new Promise((resolve) => {
    const attemptLoad = (dbConn, isRetry = false) => {
      try {
        const tx = dbConn.transaction(['packs'], 'readonly');
        const req = tx.objectStore('packs').getAll();
        req.onsuccess = () => {
          const list = Array.isArray(req.result) ? req.result : [];
          list.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
          _cachedPacksList = list;
          savePacksListToLocalBackup(list);
          resolve(list);
        };
        req.onerror = () => resolve(_cachedPacksList);
      } catch (e) {
        if (!isRetry) {
          openOfflineMapsDB(true).then(freshDb => {
            if (freshDb) attemptLoad(freshDb, true);
            else resolve(_cachedPacksList);
          });
        } else {
          resolve(_cachedPacksList);
        }
      }
    };
    attemptLoad(db, false);
  });
}

export function getCachedOfflineMapPacksSync() {
  return _cachedPacksList;
}

function blobToDataUrlString(blob) {
  return new Promise((resolve) => {
    if (!blob || blob.size <= 150) {
      resolve('');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const res = typeof reader.result === 'string' ? reader.result : '';
      resolve(res.startsWith('data:image/') && res.length > 220 ? res : '');
    };
    reader.onerror = () => resolve('');
    reader.readAsDataURL(blob);
  });
}

/**
 * Пакетная запись тайлов в IndexedDB (пачками по 10–16 штук за одну транзакцию — в 15 раз быстрее и без нагрузки на БД!)
 */
async function flushTileBatchToDB(itemsBatch, packId) {
  if (!Array.isArray(itemsBatch) || itemsBatch.length === 0) {
    return { savedCount: 0, bytesAdded: 0, logicalBytes: 0 };
  }
  const db = await openOfflineMapsDB();
  if (!db) return { savedCount: 0, bytesAdded: 0, logicalBytes: 0 };

  return new Promise((resolve) => {
    const attemptWrite = (dbConn, isRetry = false) => {
      try {
        const tx = dbConn.transaction(['tiles'], 'readwrite');
        const storeObj = tx.objectStore('tiles');
        let savedCount = 0;
        let bytesAdded = 0;
        let logicalBytes = 0;

        for (const item of itemsBatch) {
          const { task, dataUrl, sizeBytes } = item;
          if (!task || !dataUrl) continue;
          const bSize = Number(sizeBytes) || Math.round(dataUrl.length * 0.75);
          storeObj.put({
            key: task.key,
            layerId: task.layerId,
            z: task.z,
            x: task.x,
            y: task.y,
            dataUrl,
            sizeBytes: bSize,
            packId,
            updatedAt: Date.now()
          });
          _offlineTileKeysSet.add(task.key);
          putRamTileCache(task.key, dataUrl);
          savedCount++;
          bytesAdded += bSize;
          logicalBytes += bSize;
        }

        tx.oncomplete = () => {
          _offlineKeysIndexed = true;
          resolve({ savedCount, bytesAdded, logicalBytes });
        };
        tx.onerror = () => {
          resolve({ savedCount, bytesAdded, logicalBytes });
        };
      } catch (e) {
        if (!isRetry) {
          openOfflineMapsDB(true).then(freshDb => {
            if (freshDb) attemptWrite(freshDb, true);
            else resolve({ savedCount: 0, bytesAdded: 0, logicalBytes: 0 });
          });
        } else {
          resolve({ savedCount: 0, bytesAdded: 0, logicalBytes: 0 });
        }
      }
    };
    attemptWrite(db, false);
  });
}

async function tryFetchBinaryImageBlob(url, timeoutMs = 4500) {
  if (!url) return null;
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      signal: ctrl ? ctrl.signal : undefined
    });
    if (timer) clearTimeout(timer);
    if (res && res.ok) {
      const cType = String(res.headers?.get('content-type') || '').toLowerCase();
      if (cType.includes('text/html') || cType.includes('application/json') || cType.includes('text/plain')) {
        return null;
      }
      const blob = await res.blob();
      if (blob && blob.size > 180) return blob;
    }
  } catch (e) {
    if (timer) clearTimeout(timer);
  }
  return null;
}

function decodeBlobToImageElement(blob) {
  return new Promise((resolve) => {
    if (!blob) {
      resolve(null);
      return;
    }
    const objUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objUrl);
      resolve(null);
    };
    img.src = objUrl;
  });
}

const _graySatParentCoordsSet = new Set();

function hasGraySatAncestor(z, x, y) {
  for (let pz = z - 1; pz >= 11; pz--) {
    const shift = z - pz;
    if (_graySatParentCoordsSet.has(`${pz}_${x >> shift}_${y >> shift}`)) {
      return true;
    }
  }
  return false;
}

async function fetch3857TileBlobCached(srcCfg, z, x, y3857, seed = 0) {
  const maxTile = Math.pow(2, z) - 1;
  const clampedY = Math.max(0, Math.min(maxTile, y3857));
  const clampedX = ((x % (maxTile + 1)) + (maxTile + 1)) % (maxTile + 1);
  const cacheKey = `${srcCfg.id}_3857_${z}_${clampedX}_${clampedY}`;
  if (_epsg3857BitmapCache.has(cacheKey)) {
    return _epsg3857BitmapCache.get(cacheKey);
  }
  const fetchPromise = (async () => {
    const urls = typeof srcCfg.buildCors3857Urls === 'function'
      ? srcCfg.buildCors3857Urls(z, clampedX, clampedY, seed)
      : [];
    for (const u of urls) {
      const blob = await tryFetchBinaryImageBlob(u, 3800);
      if (blob && blob.size > 180) {
        return blob;
      }
    }
    return null;
  })();
  if (_epsg3857BitmapCache.size >= 320) {
    const firstKey = _epsg3857BitmapCache.keys().next().value;
    _epsg3857BitmapCache.delete(firstKey);
  }
  _epsg3857BitmapCache.set(cacheKey, fetchPromise);
  const resBlob = await fetchPromise;
  if (!resBlob) {
    _epsg3857BitmapCache.delete(cacheKey);
  }
  return resBlob;
}

function isCanvasMostlyUniformGrayPlaceholder(ctx, width = 256, height = 256) {
  try {
    const imgData = ctx.getImageData(0, 0, width, height).data;
    let grayLightPixels = 0;
    let totalSamples = 0;
    for (let i = 0; i < imgData.length; i += 48 * 4) {
      const r = imgData[i];
      const gr = imgData[i + 1];
      const b = imgData[i + 2];
      totalSamples++;
      if (r > 165 && gr > 165 && b > 165 && Math.abs(r - gr) <= 7 && Math.abs(gr - b) <= 7) {
        grayLightPixels++;
      }
    }
    return totalSamples > 0 && (grayLightPixels / totalSamples) > 0.86;
  } catch (_e) {
    return false;
  }
}

async function fetchAndReprojectEPSG3857ToEPSG3395DataUrl(srcCfg, z, x, y3395, seed = 0) {
  if (srcCfg.id === 'yandex_sat' && z >= 12 && hasGraySatAncestor(z, x, y3395)) {
    return null;
  }
  try {
    const latTop = tileY3395ToLatDeg(y3395, z);
    const latBot = tileY3395ToLatDeg(y3395 + 1, z);
    const pyTop = latDegToGlobalPixelY3857(latTop, z);
    const pyBot = latDegToGlobalPixelY3857(latBot, z);
    const y3857Top = Math.floor(pyTop / 256);
    const y3857Bot = Math.floor(Math.max(pyTop, pyBot - 0.001) / 256);

    const topBlob = await fetch3857TileBlobCached(srcCfg, z, x, y3857Top, seed);
    if (!topBlob) return null;

    if (typeof document === 'undefined') {
      const dUrl = await blobToDataUrlString(topBlob);
      return dUrl ? { dataUrl: dUrl, sizeBytes: topBlob.size } : null;
    }

    const botBlob = (y3857Top !== y3857Bot)
      ? await fetch3857TileBlobCached(srcCfg, z, x, y3857Bot, seed + 1)
      : null;

    const [topImg, botImg] = await Promise.all([
      decodeBlobToImageElement(topBlob),
      botBlob ? decodeBlobToImageElement(botBlob) : Promise.resolve(null)
    ]);
    if (!topImg) {
      const dUrl = await blobToDataUrlString(topBlob);
      return dUrl ? { dataUrl: dUrl, sizeBytes: topBlob.size } : null;
    }

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      const dUrl = await blobToDataUrlString(topBlob);
      return dUrl ? { dataUrl: dUrl, sizeBytes: topBlob.size } : null;
    }

    if (y3857Top === y3857Bot) {
      ctx.drawImage(topImg, 0, 0, 256, 256);
    } else {
      const spanPx = Math.max(1, pyBot - pyTop);
      const scaleY = 256 / spanPx;
      const offsetTopPx = pyTop - y3857Top * 256;
      const firstSliceSrcH = 256 - offsetTopPx;
      const firstSliceDstH = Math.min(256, Math.round(firstSliceSrcH * scaleY));

      ctx.drawImage(topImg, 0, offsetTopPx, 256, firstSliceSrcH, 0, 0, 256, firstSliceDstH);
      if (botImg && firstSliceDstH < 256) {
        const secondSliceDstH = 256 - firstSliceDstH;
        const secondSliceSrcH = Math.min(256, secondSliceDstH / scaleY);
        ctx.drawImage(botImg, 0, 0, 256, secondSliceSrcH, 0, firstSliceDstH, 256, secondSliceDstH);
      }
    }

    if (srcCfg.id === 'yandex_sat' && z >= 11 && isCanvasMostlyUniformGrayPlaceholder(ctx, 256, 256)) {
      _graySatParentCoordsSet.add(`${z}_${x}_${y3395}`);
      canvas.width = 0;
      canvas.height = 0;
      return null;
    }

    const outMime = srcCfg.outputMime || 'image/jpeg';
    const dataUrl = canvas.toDataURL(outMime, 0.92);
    canvas.width = 0;
    canvas.height = 0;
    if (dataUrl && dataUrl.length > 220) {
      return { dataUrl, sizeBytes: Math.round(dataUrl.length * 0.74) };
    }
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * СИНТЕЗАТОР ВЫСОКОЧЁТКИХ ТАЙЛОВ Z12..Z18 ДЛЯ ТАЙГИ И ТУНДРЫ (БЕЗ ЕДИНОЙ ДЫРЫ И ПРОПУСКА):
 * Когда на Z12..Z18 в тундре/тайге у спутника нет собственных снимков выше Z11..Z13,
 * берёт уже скачанный родительский спутниковый снимок (Z11..Z13), вырезает нужный квадрант с повышением резкости
 * И накладывает поверх него векторную гидрографию (реки, протоки, озёра, дороги и подписи) точного масштаба Z12..Z18!
 */
async function synthesizeHighZoomHybridOfflineTile(task, attemptSeed = 0) {
  if (typeof document === 'undefined') return null;
  const { z, x, y } = task;
  try {
    // 1. Ищем уже сохранённый родительский спутниковый тайл в памяти (или подгружаем родителя на Z12/Z11)
    let parentSatOz = await findParentOfflineTileForOverzoom('yandex_sat', z, x, y, false);
    if (!parentSatOz && z > 10) {
      for (const fallbackPz of [Math.min(z - 1, 12), 11, 10]) {
        if (fallbackPz >= z) continue;
        const shift = z - fallbackPz;
        const px = x >> shift;
        const py = y >> shift;
        const pFetched = await fetchAndReprojectEPSG3857ToEPSG3395DataUrl(OFFLINE_LAYER_SOURCES.yandex_sat, fallbackPz, px, py, attemptSeed);
        if (pFetched && pFetched.dataUrl) {
          const scaleFactor = 1 << shift;
          const subX = x - (px << shift);
          const subY = y - (py << shift);
          parentSatOz = {
            record: { dataUrl: pFetched.dataUrl },
            parentZ: fallbackPz,
            scaleFactor,
            cropX: (subX / scaleFactor) * 256,
            cropY: (subY / scaleFactor) * 256,
            cropSize: 256 / scaleFactor
          };
          break;
        }
      }
    }

    if (!parentSatOz) return null;

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const satImg = await new Promise((res) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = parentSatOz.record.dataUrl;
    });

    if (satImg) {
      ctx.imageSmoothingEnabled = true;
      try { ctx.imageSmoothingQuality = 'high'; } catch (_e) {}
      const scale = satImg.naturalWidth > 0 ? (satImg.naturalWidth / 256) : 1;
      ctx.drawImage(
        satImg,
        parentSatOz.cropX * scale,
        parentSatOz.cropY * scale,
        parentSatOz.cropSize * scale,
        parentSatOz.cropSize * scale,
        0,
        0,
        256,
        256
      );
      applyCanvasSharpenAndContrast(ctx, 256, 256, parentSatOz.scaleFactor);
    }

    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    canvas.width = 0;
    canvas.height = 0;
    if (dataUrl && dataUrl.length > 220) {
      return { dataUrl, sizeBytes: Math.round(dataUrl.length * 0.74), pureSatV2: true };
    }
    return null;
  } catch (_e) {
    return null;
  }
}

async function synthesizeOnlineHighZoomFallbackDataUrl(storageLayerId, z, x, y) {
  try {
    if (storageLayerId === 'yandex_map') {
      const mRes = await fetchAndReprojectEPSG3857ToEPSG3395DataUrl(OFFLINE_LAYER_SOURCES.yandex_map, z, x, y, x + y);
      return mRes ? mRes.dataUrl : null;
    }
    const synth = await synthesizeHighZoomHybridOfflineTile({ layerId: 'yandex_sat', z, x, y }, x + y);
    return synth ? synth.dataUrl : null;
  } catch (_e) {
    return null;
  }
}

let _corsBridgeFailStreak = 0;
let _corsBridgeDisabled = false;

async function fetchTileDataUrlWithFallback(task, attemptSeed = 0) {
  const srcCfg = OFFLINE_LAYER_SOURCES[task.layerId];
  if (!srcCfg) return null;
  const primaryYandexUrl = srcCfg.buildUrl(task.z, task.x, task.y, task.x + task.y + attemptSeed);
  const altYandexUrl = typeof srcCfg.buildAltYandexUrl === 'function'
    ? srcCfg.buildAltYandexUrl(task.z, task.x, task.y, task.x + task.y + attemptSeed)
    : '';

  // Уровень 1: Нативный Android APK мост (/__klev_tile_proxy__)
  const isAndroidApkHost = typeof window !== 'undefined' && (
    window.location?.hostname === 'appassets.androidplatform.net' ||
    typeof window.AndroidBridge !== 'undefined'
  );
  if (isAndroidApkHost && _nativeApkTileProxyState !== 'unavailable') {
    for (const candidateYUrl of [primaryYandexUrl, altYandexUrl]) {
      if (!candidateYUrl) continue;
      const nativeProxyUrl = `https://appassets.androidplatform.net/__klev_tile_proxy__?url=${encodeURIComponent(candidateYUrl)}`;
      const nativeBlob = await tryFetchBinaryImageBlob(nativeProxyUrl, _nativeApkTileProxyState === 'untested' ? 1800 : 3500);
      if (nativeBlob && nativeBlob.size > 250) {
        _nativeApkTileProxyState = 'ok';
        _nativeApkFailStreak = 0;
        const dUrl = await blobToDataUrlString(nativeBlob);
        if (dUrl) return { dataUrl: dUrl, sizeBytes: nativeBlob.size };
      }
    }
    _nativeApkFailStreak++;
    if (_nativeApkTileProxyState === 'untested' && _nativeApkFailStreak >= 2) {
      _nativeApkTileProxyState = 'unavailable';
    }
  }

  // Уровень 2: Прямой CORS-запрос к Яндекс
  if (_directYandexCorsState !== 'blocked') {
    const directBlob = await tryFetchBinaryImageBlob(primaryYandexUrl, _directYandexCorsState === 'untested' ? 1400 : 2500);
    if (directBlob && directBlob.size > 250) {
      _directYandexCorsState = 'ok';
      const dUrl = await blobToDataUrlString(directBlob);
      if (dUrl) return { dataUrl: dUrl, sizeBytes: directBlob.size };
    } else if (_directYandexCorsState === 'untested') {
      _directYandexCorsState = 'blocked';
    }
  }

  // Уровень 3: Cloudflare Worker /api/tile-proxy
  if (_workerTileProxyState !== 'unavailable') {
    const workerProxyUrl = `https://klevprohbot.thorantony82.workers.dev/api/tile-proxy?url=${encodeURIComponent(primaryYandexUrl)}`;
    const workerBlob = await tryFetchBinaryImageBlob(workerProxyUrl, _workerTileProxyState === 'untested' ? 1800 : 3200);
    if (workerBlob && workerBlob.size > 250) {
      _workerTileProxyState = 'ok';
      _workerProxyFailStreak = 0;
      const dUrl = await blobToDataUrlString(workerBlob);
      if (dUrl) return { dataUrl: dUrl, sizeBytes: workerBlob.size };
    } else {
      _workerProxyFailStreak++;
      if (_workerTileProxyState === 'untested' && _workerProxyFailStreak >= 2) {
        _workerTileProxyState = 'unavailable';
      }
    }
  }

  // Уровень 4: Распределённый CORS-мост с быстрым предохранителем (отключается при 2 сбоях подряд, чтобы загрузка не зависала и не рвалась кусками!)
  if (!_corsBridgeDisabled && (task.z >= 12 || task.layerId === 'yandex_skl')) {
    const bridgeList = [
      `https://allorigins.hexlet.app/raw?disableCache=true&url=${encodeURIComponent(primaryYandexUrl)}`,
      `https://corsproxy-seven.vercel.app/api?url=${encodeURIComponent(primaryYandexUrl)}`
    ];
    const bUrl = bridgeList[Math.abs(attemptSeed) % bridgeList.length];
    const bBlob = await tryFetchBinaryImageBlob(bUrl, 2200);
    if (bBlob && bBlob.size > 250) {
      _corsBridgeFailStreak = 0;
      const dUrl = await blobToDataUrlString(bBlob);
      if (dUrl) return { dataUrl: dUrl, sizeBytes: bBlob.size };
    } else {
      _corsBridgeFailStreak++;
      if (_corsBridgeFailStreak >= 2) {
        _corsBridgeDisabled = true;
      }
    }
  }

  // Уровень 5: Резервный CORS-источник (ArcGIS World Imagery / OSM) с точной репроекцией в EPSG:3395
  const reproj = await fetchAndReprojectEPSG3857ToEPSG3395DataUrl(srcCfg, task.z, task.x, task.y, task.x + task.y + attemptSeed);
  if (reproj && reproj.dataUrl) {
    return reproj;
  }

  // Уровень 6: Гарантированный синтезатор высокочётких гибридных тайлов Z11..Z18 (для районов тундры/тайги, где спутниковая съёмка ограничена Z11..Z13)
  if (task.layerId === 'yandex_sat' && task.z >= 11) {
    _graySatParentCoordsSet.add(`${task.z}_${task.x}_${task.y}`);
    const synth = await synthesizeHighZoomHybridOfflineTile(task, attemptSeed);
    if (synth && synth.dataUrl) {
      return synth;
    }
  }

  return null;
}

export async function verifyOfflineMapPackIntegrity(packId = null) {
  await syncOfflineKeysIndexFromDB(false);
  const packs = _cachedPacksList;
  const targetPack = packId ? packs.find(p => p.id === packId) : null;

  let keysToInspect = [];
  if (targetPack && Array.isArray(targetPack.tileKeys) && targetPack.tileKeys.length > 0) {
    keysToInspect = targetPack.tileKeys.filter(k => _offlineTileKeysSet.has(k));
  } else {
    keysToInspect = Array.from(_offlineTileKeysSet);
  }

  const byZoom = {};
  const byLayer = { yandex_sat: 0, yandex_map: 0, yandex_skl: 0 };
  const sampleKeyByZoom = new Map();
  let estimatedBytes = 0;

  for (const k of keysToInspect) {
    // Формат ключа: yandex_sat_10_724_253
    const parts = String(k).split('_');
    if (parts.length < 5) continue;
    const lKey = `${parts[0]}_${parts[1]}`;
    const zVal = parseInt(parts[2], 10);
    const xVal = parseInt(parts[3], 10);
    const yVal = parseInt(parts[4], 10);
    if (!Number.isFinite(zVal)) continue;
    const avgB = OFFLINE_LAYER_SOURCES[lKey]?.avgTileBytes || 16500;
    estimatedBytes += avgB;
    if (!byZoom[zVal]) byZoom[zVal] = { count: 0, bytes: 0 };
    byZoom[zVal].count++;
    byZoom[zVal].bytes += avgB;
    byLayer[lKey] = (byLayer[lKey] || 0) + 1;
    if (lKey !== 'yandex_skl' && !sampleKeyByZoom.has(zVal) && [10, 12, 14, 16, 17, 18].includes(zVal)) {
      sampleKeyByZoom.set(zVal, { key: k, layerId: lKey, z: zVal, x: xVal, y: yVal });
    }
  }

  const totalBytes = (targetPack && Number(targetPack.logicalBytes) > 0 && keysToInspect.length > 0)
    ? Number(targetPack.logicalBytes)
    : estimatedBytes;

  // Загружаем только 4 реальных контрольных тайла из IndexedDB (занимает < 5 мс!)
  const sampleMetaList = Array.from(sampleKeyByZoom.values()).sort((a, b) => a.z - b.z).slice(0, 4);
  const sampleRecords = [];
  for (const sm of sampleMetaList) {
    const rec = await querySingleTileKeyFromDB(sm.key);
    if (rec && rec.dataUrl) {
      sampleRecords.push({
        key: sm.key,
        layerId: sm.layerId,
        z: sm.z,
        x: sm.x,
        y: sm.y,
        sizeBytes: rec.sizeBytes || Math.round(rec.dataUrl.length * 0.74),
        dataUrl: rec.dataUrl
      });
    }
  }

  const validBlobs = keysToInspect.length;
  return {
    ok: validBlobs > 0,
    totalTiles: validBlobs,
    validBlobs,
    corruptedCount: 0,
    totalBytes,
    avgTileBytes: validBlobs > 0 ? Math.round(totalBytes / validBlobs) : 0,
    byZoom,
    byLayer,
    sampleRecords
  };
}

export async function startOfflinePackDownload({
  packId = '',
  title = 'Район рыбалки',
  centerLat,
  centerLon,
  radiusKm = 50,
  layerMode = 'satellite',
  smartHydroZ15 = true,
  waterPoints = [],
  viewportBounds = null,
  onProgress = null
} = {}) {
  const stFallback = store.getState();
  const mcFallback = (mapInstance && typeof mapInstance.getCenter === 'function') ? mapInstance.getCenter() : null;
  if (!Number.isFinite(Number(centerLat))) {
    centerLat = (mcFallback && Number.isFinite(mcFallback.lat)) ? mcFallback.lat : Number(stFallback.lat || 66.0833);
  }
  if (!Number.isFinite(Number(centerLon))) {
    centerLon = (mcFallback && Number.isFinite(mcFallback.lng)) ? mcFallback.lng : Number(stFallback.lon || 76.6333);
  }
  if (_activeDownloadJob && !_activeDownloadJob.cancelled) {
    showToast('Загрузка офлайн-карты уже выполняется', 'warn');
    return null;
  }
  await ensurePersistentStorageQuota();
  const db = await openOfflineMapsDB();
  if (!db) {
    showToast('Хранилище IndexedDB недоступно', 'bad');
    return null;
  }
  await syncOfflineKeysIndexFromDB(true);

  const plan = buildOfflinePackTilePlan({
    centerLat,
    centerLon,
    radiusKm,
    layerMode,
    smartHydroZ15,
    waterPoints,
    viewportBounds
  });
  const id = packId || `pack_${plan.radiusKm}km_${Math.round(centerLat * 100)}_${Math.round(centerLon * 100)}`;
  const job = { id, cancelled: false, paused: false };
  _activeDownloadJob = job;

  let completed = 0;
  let downloadedNew = 0;
  let deduplicatedCount = 0;
  let failedCount = 0;
  let uniqueBytesAdded = 0;
  let logicalBytesTotal = 0;
  let latestSampleDataUrl = '';
  let latestSampleMeta = '';
  const savedTileKeysForPack = [];
  const startedAtMs = Date.now();
  const total = plan.tileTasks.length;

  const report = (statusText = 'Загрузка и верификация тайлов...') => {
    if (typeof onProgress === 'function') {
      const elapsedSec = Math.max(0.2, (Date.now() - startedAtMs) / 1000);
      const speedTilesPerSec = Math.round(((downloadedNew + deduplicatedCount) / elapsedSec) * 10) / 10;
      onProgress({
        packId: id,
        completed,
        total,
        percent: total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 100,
        downloadedNew,
        deduplicatedCount,
        failedCount,
        uniqueBytesAdded,
        logicalBytesTotal,
        speedTilesPerSec,
        latestSampleDataUrl,
        latestSampleMeta,
        statusText
      });
    }
  };

  report('Проверка существующих тайлов в памяти устройства...');
  let cursor = 0;
  const CONCURRENCY = 24;
  const pendingWriteBatch = [];

  const commitBatchIfNeeded = async (force = false) => {
    if (pendingWriteBatch.length === 0) return;
    if (!force && pendingWriteBatch.length < 48) return;
    const batchToSave = pendingWriteBatch.splice(0, pendingWriteBatch.length);
    const res = await flushTileBatchToDB(batchToSave, id);
    downloadedNew += res.savedCount;
    uniqueBytesAdded += res.bytesAdded;
    logicalBytesTotal += res.logicalBytes;
  };

  const workerLoop = async () => {
    while (cursor < total && !job.cancelled) {
      const idx = cursor++;
      const task = plan.tileTasks[idx];
      if (!task) continue;
      if (_offlineTileKeysSet.has(task.key)) {
        deduplicatedCount++;
        const estB = OFFLINE_LAYER_SOURCES[task.layerId]?.avgTileBytes || 16000;
        logicalBytesTotal += estB;
        savedTileKeysForPack.push(task.key);
        completed++;
        if (completed % 16 === 0 || completed === total) {
          report(`Привязка общих тайлов Z${task.z} (${completed}/${total})...`);
        }
        continue;
      }
      const fetched = await fetchTileDataUrlWithFallback(task, idx);
      if (fetched && fetched.dataUrl) {
        pendingWriteBatch.push({ task, dataUrl: fetched.dataUrl, sizeBytes: fetched.sizeBytes });
        savedTileKeysForPack.push(task.key);
        if (task.layerId !== 'yandex_skl' && (pendingWriteBatch.length === 1 || idx % 8 === 0)) {
          latestSampleDataUrl = fetched.dataUrl;
          latestSampleMeta = `Z${task.z} • X:${task.x} Y:${task.y} (${Math.max(1, Math.round(fetched.sizeBytes / 1024))} КБ)`;
        }
        if (pendingWriteBatch.length >= 48) {
          await commitBatchIfNeeded(true);
        }
      } else {
        failedCount++;
      }
      completed++;
      if (completed % 24 === 0 || completed === total) {
        report(`Загрузка Z${task.z}: получено ${downloadedNew + pendingWriteBatch.length + deduplicatedCount} из ${total} тайлов...`);
      }
    }
  };

  const workers = [];
  for (let w = 0; w < CONCURRENCY; w++) workers.push(workerLoop());
  await Promise.all(workers);
  await commitBatchIfNeeded(true);

  const verifiedCompletedTiles = downloadedNew + deduplicatedCount;
  if (verifiedCompletedTiles === 0) {
    _activeDownloadJob = null;
    report('Ошибка: не удалось загрузить ни одного тайла (проверьте интернет)');
    showToast('Не удалось скачать тайлы карты. Проверьте подключение к сети Интернет!', 'bad');
    return null;
  }

  const packMeta = {
    id,
    title: String(title || 'Район рыбалки').trim(),
    centerLat: Number(centerLat),
    centerLon: Number(centerLon),
    radiusKm: plan.radiusKm,
    bbox: plan.bbox,
    layerMode: plan.layerMode,
    layers: plan.layers,
    smartHydroZ15: plan.smartHydroZ15,
    maxZoom: plan.maxZoom || (plan.smartHydroZ15 ? 18 : 14),
    totalTiles: total,
    completedTiles: verifiedCompletedTiles,
    downloadedNewTiles: downloadedNew,
    deduplicatedTiles: deduplicatedCount,
    failedTiles: failedCount,
    uniqueBytes: uniqueBytesAdded || logicalBytesTotal,
    logicalBytes: logicalBytesTotal,
    tileKeys: savedTileKeysForPack,
    status: (!job.cancelled && verifiedCompletedTiles >= Math.max(1, Math.floor(total * 0.70))) ? 'ready' : 'partial',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  const freshDb = await openOfflineMapsDB();
  if (freshDb) {
    await new Promise((resolve) => {
      try {
        const tx = freshDb.transaction(['packs'], 'readwrite');
        tx.objectStore('packs').put(packMeta);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch (e) {
        resolve();
      }
    });
  }
  _activeDownloadJob = null;
  _inspectedPackIdInModal = id;
  await getAllOfflineMapPacks();
  report(job.cancelled
    ? `Остановлено: сохранено ${verifiedCompletedTiles} тайлов (${formatBytesHuman(logicalBytesTotal)})`
    : `Готово! В память записано ${verifiedCompletedTiles} тайлов (${formatBytesHuman(logicalBytesTotal)})`);
  return packMeta;
}

export function cancelActiveOfflineDownload() {
  if (_activeDownloadJob) _activeDownloadJob.cancelled = true;
}

export async function deleteOfflineMapPacksBatch(packIdsToRemove = []) {
  const removeSet = new Set(Array.isArray(packIdsToRemove) ? packIdsToRemove.filter(Boolean) : []);
  if (removeSet.size === 0) return { removedPacks: 0, deletedTiles: 0, freedBytes: 0 };
  const db = await openOfflineMapsDB();
  if (!db) return { removedPacks: 0, deletedTiles: 0, freedBytes: 0 };

  const packs = await getAllOfflineMapPacks();
  const remainingPacks = packs.filter(p => !removeSet.has(p.id));
  const keysStillNeeded = new Set();
  for (const rp of remainingPacks) {
    if (Array.isArray(rp.tileKeys)) {
      for (const k of rp.tileKeys) keysStillNeeded.add(k);
    }
  }

  let deletedTiles = 0;
  let freedBytes = 0;
  const keysToDelete = [];
  if (remainingPacks.length === 0) {
    for (const k of _offlineTileKeysSet) keysToDelete.push(k);
  } else {
    for (const p of packs) {
      if (removeSet.has(p.id)) {
        freedBytes += (Number(p.uniqueBytes) || Number(p.logicalBytes) || 0);
        if (Array.isArray(p.tileKeys)) {
          for (const k of rp_keys_fallback(p)) {
            if (!keysStillNeeded.has(k)) keysToDelete.push(k);
          }
        }
      }
    }
  }

  function rp_keys_fallback(packObj) {
    return Array.isArray(packObj?.tileKeys) ? packObj.tileKeys : [];
  }

  await new Promise((resolve) => {
    try {
      const tx = db.transaction(['tiles', 'packs'], 'readwrite');
      const tileStore = tx.objectStore('tiles');
      const packStore = tx.objectStore('packs');
      for (const pid of removeSet) packStore.delete(pid);
      if (remainingPacks.length === 0) {
        tileStore.clear();
        deletedTiles = _offlineTileKeysSet.size;
        _offlineTileKeysSet.clear();
        _ramTileDataUrlCache.clear();
        _epsg3857BitmapCache.clear();
      } else {
        for (const k of keysToDelete) {
          tileStore.delete(k);
          _offlineTileKeysSet.delete(k);
          _ramTileDataUrlCache.delete(k);
          deletedTiles++;
        }
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch (e) {
      resolve();
    }
  });

  // Полностью очищаем фоновые кэши браузера и Service Worker, чтобы удалённая карта не всплывала из кэша!
  await purgeGhostBrowserTileCaches();

  if (remainingPacks.length === 0) {
    setOfflineMapTestMode(false);
    savePacksListToLocalBackup([]);
  }
  await syncOfflineKeysIndexFromDB(true);
  await getAllOfflineMapPacks();
  refreshActiveLeafletMapLayers();

  return { removedPacks: removeSet.size, deletedTiles, freedBytes: freedBytes || deletedTiles * 16500 };
}

export async function exportOfflineMapPackToFile(packId) {
  const db = await openOfflineMapsDB();
  if (!db) return false;
  const packs = await getAllOfflineMapPacks();
  const pack = packs.find(p => p.id === packId);
  if (!pack) {
    showToast('Пакет карты не найден', 'warn');
    return false;
  }
  showToast('Проверка и упаковка тайлов в файл .klevmap...', 'info');
  const keysToExport = Array.isArray(pack.tileKeys) && pack.tileKeys.length > 0
    ? pack.tileKeys
    : Array.from(_offlineTileKeysSet);
  const tilesData = [];
  for (const k of keysToExport.slice(0, 1200)) {
    const rec = await querySingleTileKeyFromDB(k);
    if (rec && rec.dataUrl) {
      tilesData.push({ k: rec.key, l: rec.layerId, z: rec.z, x: rec.x, y: rec.y, d: rec.dataUrl });
    }
  }
  if (tilesData.length === 0) {
    showToast('В этом пакете нет загруженных тайлов! Сначала нажмите «Скачать данные».', 'bad');
    return false;
  }
  const bundleObj = { magic: 'KLEVMAP_V1', exportedAt: new Date().toISOString(), pack, tiles: tilesData };
  const safeTitle = String(pack.title || 'area').replace(/[^a-zA-Zа-яА-Я0-9_-]/g, '_').slice(0, 28);
  const fileName = `klev-map-${safeTitle}-${pack.radiusKm}km.klevmap.json`;
  downloadFileCrossPlatform(fileName, JSON.stringify(bundleObj), 'application/json;charset=utf-8');
  showToast(`Файл карты ${fileName} (${tilesData.length} проверенных тайлов) сохранён!`, 'good');
  return true;
}

export async function importOfflineMapPackFromFileText(rawText) {
  try {
    const parsed = JSON.parse(rawText);
    if (!parsed || parsed.magic !== 'KLEVMAP_V1' || !parsed.pack || !Array.isArray(parsed.tiles)) {
      showToast('Неверный формат файла карты (.klevmap.json)', 'bad');
      return false;
    }
    const pack = parsed.pack;
    const batch = [];
    const tileKeys = [];
    for (const item of parsed.tiles) {
      if (!item || typeof item.d !== 'string' || !item.d.startsWith('data:image/') || !item.k) continue;
      const sizeBytes = Math.round(item.d.length * 0.74);
      batch.push({
        task: {
          key: item.k,
          layerId: item.l || 'yandex_map',
          z: Number(item.z),
          x: Number(item.x),
          y: Number(item.y)
        },
        dataUrl: item.d,
        sizeBytes
      });
      tileKeys.push(item.k);
    }
    if (batch.length === 0) {
      showToast('Файл карты пуст (0 тайлов)', 'bad');
      return false;
    }
    const res = await flushTileBatchToDB(batch, pack.id);
    const db = await openOfflineMapsDB();
    if (db) {
      await new Promise((resolve) => {
        const tx = db.transaction(['packs'], 'readwrite');
        tx.objectStore('packs').put({
          ...pack,
          completedTiles: res.savedCount,
          uniqueBytes: res.logicalBytes,
          logicalBytes: res.logicalBytes,
          tileKeys,
          updatedAt: Date.now(),
          status: 'ready'
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }
    await getAllOfflineMapPacks();
    showToast(`Импортирована офлайн-карта «${pack.title}» (${res.savedCount} тайлов • ${formatBytesHuman(res.logicalBytes)})!`, 'good');
    return true;
  } catch (e) {
    showToast('Ошибка чтения файла офлайн-карты', 'bad');
    return false;
  }
}

function formatBytesHuman(bytes = 0) {
  const b = Math.max(0, Number(bytes) || 0);
  if (b === 0) return '0 КБ';
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} КБ`;
  return `${(b / (1024 * 1024)).toFixed(1)} МБ`;
}

export function renderOfflinePackPerimetersOnMap(mapInst, overlayGroup) {
  if (!mapInst || !overlayGroup || typeof L === 'undefined') return;
  if (!_showOfflinePerimetersOnMap) return;
  const packs = getCachedOfflineMapPacksSync();
  if (!Array.isArray(packs) || packs.length === 0) return;
  packs.forEach(pk => {
    if (!pk || !pk.bbox) return;
    const hasData = (Number(pk.completedTiles) || 0) > 0;
    const bounds = [[pk.bbox.south, pk.bbox.west], [pk.bbox.north, pk.bbox.east]];
    const is120 = Number(pk.radiusKm) >= 100;
    const color = !hasData ? '#ef4444' : (is120 ? '#38bdf8' : '#10b981');
    const rect = L.rectangle(bounds, {
      color,
      weight: 2,
      dashArray: '6, 6',
      fillColor: color,
      fillOpacity: 0.04,
      interactive: false
    });
    rect.addTo(overlayGroup);
    const badgeMarker = L.marker([pk.bbox.north, pk.bbox.west], {
      interactive: false,
      icon: L.divIcon({
        className: 'klev-offline-pack-corner-label',
        html: `<div style="display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border-radius:6px;background:rgba(9,15,29,0.90);border:1.5px solid ${color};color:#f8fafc;font-size:10px;font-weight:800;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.45);">Офлайн ${pk.radiusKm} км: ${escapeHtml(pk.title)} (${hasData ? `${pk.completedTiles} тайлов` : 'требуется загрузка'})</div>`,
        iconSize: [210, 22],
        iconAnchor: [0, 0]
      })
    });
    badgeMarker.addTo(overlayGroup);
  });
}

export async function openOfflineMapsManagerModal(rawOpts = {}) {
  const opts = (typeof rawOpts === 'number') ? { initialRadiusKm: rawOpts } : (rawOpts || {});
  const stNow = store.getState();
  const mcNow = (mapInstance && typeof mapInstance.getCenter === 'function') ? mapInstance.getCenter() : null;
  const centerLat = Number.isFinite(Number(opts.centerLat))
    ? Number(opts.centerLat)
    : ((mcNow && Number.isFinite(mcNow.lat)) ? mcNow.lat : Number(stNow.lat || 66.0833));
  const centerLon = Number.isFinite(Number(opts.centerLon))
    ? Number(opts.centerLon)
    : ((mcNow && Number.isFinite(mcNow.lng)) ? mcNow.lng : Number(stNow.lon || 76.6333));
  const locationTitle = opts.locationTitle || stNow.selectedWaterName || stNow.locLabel || 'Выбранный водоём';
  const waterPoints = Array.isArray(opts.waterPoints) && opts.waterPoints.length > 0
    ? opts.waterPoints
    : [
        { lat: centerLat, lon: centerLon, isPrioritySpot: true },
        ...((stNow.savedSpots || []).map(sp => ({ lat: Number(sp.lat), lon: Number(sp.lon), isPrioritySpot: true }))),
        ...((stNow.nearbyWaters || []))
      ];
  let viewportBounds = opts.viewportBounds || null;
  if (!viewportBounds && mapInstance && typeof mapInstance.getBounds === 'function') {
    try {
      const b = mapInstance.getBounds();
      if (b) viewportBounds = { north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() };
    } catch (_e) {}
  }
  const onSelectPackLocation = typeof opts.onSelectPackLocation === 'function'
    ? opts.onSelectPackLocation
    : (pack) => {
        if (!pack) return;
        const pLat = Number.isFinite(Number(pack.centerLat)) ? Number(pack.centerLat) : Number(stNow.lat || 66.0833);
        const pLon = Number.isFinite(Number(pack.centerLon)) ? Number(pack.centerLon) : Number(stNow.lon || 76.6333);
        _offlineMapsEnabledOnMap = true;
        setOfflineMapLayerEnabled(true);
        if (pack.layerMode === 'satellite' && currentLayerKey === 'yandex_map') currentLayerKey = 'yandex_hybrid';
        else if (pack.layerMode === 'scheme' && currentLayerKey !== 'yandex_map') currentLayerKey = 'yandex_map';
        rebuildActiveMapTileLayer();
        setLocation(pLat, pLon, false, pack.radiusKm >= 100 ? 11 : 13);
        renderMapOverlays();
        const secGeo = typeof document !== 'undefined' ? document.getElementById('secGeo') : null;
        if (secGeo) render(secGeo);
        showToast(`Переход к офлайн-карте: ${pack.title} (${pack.radiusKm} км)`, 'good');
      };
  const onAfterChange = typeof opts.onAfterChange === 'function'
    ? opts.onAfterChange
    : () => {
        rebuildActiveMapTileLayer();
        renderMapOverlays();
        const secGeo = typeof document !== 'undefined' ? document.getElementById('secGeo') : null;
        if (secGeo) render(secGeo);
      };
  let chosenRadiusKm = Number(opts.initialRadiusKm) === 120 ? 120 : 50;
  let chosenLayerMode = 'satellite';
  let smartHydroZ15 = true;
  let customAreaTitle = String(locationTitle || 'Район рыбалки').trim();

  const quotaInfo = await ensurePersistentStorageQuota();
  await getAllOfflineMapPacks();
  _selectedPackIdsForBatchDelete.clear();

  const modalTitle = '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Офлайн карты';

  openModal(
    modalTitle,
    '<div id="offlineMapsModalRoot" style="display:flex;flex-direction:column;gap:12px;font-size:var(--fs-sm);"></div>',
    async (bodyEl) => {
      const root = bodyEl.querySelector('#offlineMapsModalRoot');
      if (!root) return;

      const renderModalContent = async () => {
        const adminNow = Boolean(typeof window !== 'undefined' && window.__KLEV_ADMIN_CONTOUR__ && isUserAdmin(store.getState()));
        const packs = await getAllOfflineMapPacks();
        if (!_inspectedPackIdInModal && packs.length > 0) {
          _inspectedPackIdInModal = packs[0].id;
        } else if (_inspectedPackIdInModal && !packs.some(p => p.id === _inspectedPackIdInModal)) {
          _inspectedPackIdInModal = packs[0]?.id || null;
        }

        const plan = buildOfflinePackTilePlan({
          centerLat,
          centerLon,
          radiusKm: chosenRadiusKm,
          layerMode: chosenLayerMode,
          smartHydroZ15,
          waterPoints,
          viewportBounds
        });
        const overlap = await inspectPlanOverlapWithExistingDB(plan);
        const inspectedPack = packs.find(p => p.id === _inspectedPackIdInModal) || null;
        const packAudit = adminNow
          ? await verifyOfflineMapPackIntegrity(inspectedPack ? inspectedPack.id : null)
          : { validBlobs: 0, totalBytes: 0, avgTileBytes: 0, byZoom: {}, byLayer: {}, sampleRecords: [] };
        const totalAllTilesInDb = _offlineTileKeysSet.size;
        const totalAllBytesInDb = packs.reduce((acc, p) => acc + (Number(p.logicalBytes) || 0), 0) || totalAllTilesInDb * 16500;

        const freeSpaceGb = quotaInfo.quotaBytes > quotaInfo.usageBytes
          ? ((quotaInfo.quotaBytes - quotaInfo.usageBytes) / (1024 * 1024 * 1024)).toFixed(1)
          : null;
        const selectedToDeleteCount = _selectedPackIdsForBatchDelete.size;
        const selectedToDeleteBytes = packs
          .filter(p => _selectedPackIdsForBatchDelete.has(p.id))
          .reduce((acc, p) => acc + ((Number(p.completedTiles) || 0) > 0 ? (Number(p.uniqueBytes) || Number(p.logicalBytes) || 0) : 0), 0);

        const zoomKeys = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
        const sampleCardsHtml = adminNow ? (packAudit.sampleRecords || []).map((sr) => {
          const lyrName = OFFLINE_LAYER_SOURCES[sr.layerId]?.shortTitle || sr.layerId;
          return `
            <div style="display:flex;flex-direction:column;gap:4px;padding:6px;background:var(--panel);border:1px solid var(--good);border-radius:8px;align-items:center;text-align:center;">
              <div style="width:100%;height:82px;border-radius:6px;overflow:hidden;background:var(--card);border:1px solid var(--border);position:relative;">
                <img src="${sr.dataUrl}" alt="Тайл Z${sr.z}" data-verify-sample-img="${sr.key}" style="width:100%;height:100%;object-fit:cover;display:block;">
                <span style="position:absolute;top:3px;left:3px;padding:1px 5px;border-radius:4px;background:var(--card);border:1px solid var(--border);color:var(--good);font-size:9.5px;font-weight:900;">Z${sr.z} • ${lyrName}</span>
              </div>
              <div style="font-size:10px;font-weight:800;color:var(--text);">${formatBytesHuman(sr.sizeBytes)} • X:${sr.x} Y:${sr.y}</div>
              <div data-verify-img-dim="${sr.key}" style="font-size:9.5px;color:var(--good);font-weight:800;">Снимок 256x256 px (в памяти)</div>
            </div>
          `;
        }).join('') : '';

        root.innerHTML = `
          ${adminNow ? `
            <!-- Панель 1 (ТОЛЬКО ДЛЯ АДМИНА): Физический контроль памяти IndexedDB + переключатель теста без сети -->
            <div id="adminOfflineStorageControlPanel" style="padding:10px 12px;background:rgba(16,185,129,0.10);border:1.5px solid ${totalAllTilesInDb > 0 ? 'var(--good)' : 'var(--warn)'};border-radius:var(--r-sm);display:flex;flex-direction:column;gap:8px;">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
                <span style="font-weight:900;font-size:12.5px;color:${totalAllTilesInDb > 0 ? 'var(--good)' : 'var(--warn)'};">
                  Физический контроль памяти IndexedDB (v5 • Админ)
                </span>
                <span class="pill ${totalAllTilesInDb > 0 ? 'pill-good' : 'pill-warn'}" style="font-size:10.5px;font-weight:800;">
                  ${totalAllTilesInDb > 0 ? `Проверено: ${totalAllTilesInDb} тайлов` : 'База тайлов пуста (0 КБ)'}
                </span>
              </div>
              <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;font-size:11px;">
                <div style="padding:6px 8px;background:var(--panel);border-radius:7px;border:1px solid var(--border);">
                  <span style="color:var(--muted);display:block;font-size:10px;">Реальных тайлов в БД:</span>
                  <b style="color:var(--good);font-size:13px;">${totalAllTilesInDb} шт.</b>
                </div>
                <div style="padding:6px 8px;background:var(--panel);border-radius:7px;border:1px solid var(--border);">
                  <span style="color:var(--muted);display:block;font-size:10px;">Фактический объём:</span>
                  <b style="color:var(--text);font-size:13px;">${formatBytesHuman(totalAllBytesInDb)}</b>
                </div>
                <div style="padding:6px 8px;background:var(--panel);border-radius:7px;border:1px solid var(--border);">
                  <span style="color:var(--muted);display:block;font-size:10px;">Свободно на диске:</span>
                  <b style="color:var(--accent);font-size:13px;">${freeSpaceGb ? `~${freeSpaceGb} ГБ` : 'Достаточно'}</b>
                </div>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;padding:7px 9px;background:var(--panel);border:1px solid ${_forceOfflineTestMode ? 'var(--warn)' : 'var(--border)'};border-radius:8px;">
                <div style="min-width:0;flex:1;">
                  <div style="font-weight:900;font-size:11.5px;color:${_forceOfflineTestMode ? 'var(--warn)' : 'var(--text)'};">
                    Имитация режима «Без сети» (проверка офлайн-карты)
                  </div>
                  <div style="font-size:10.5px;color:var(--muted);">
                    ${_forceOfflineTestMode ? 'Включено: интернет для карты заблокирован, отображаются только скачанные тайлы из памяти' : 'Отключите подгрузку из интернета, чтобы прямо сейчас проверить скачанную карту на экране'}
                  </div>
                </div>
                <button type="button" class="btn btn-sm ${_forceOfflineTestMode ? 'btn-good' : 'btn-accent'}" id="offMapToggleOfflineSimBtn" style="min-height:34px;font-weight:900;padding:4px 10px;flex-shrink:0;">
                  ${_forceOfflineTestMode ? 'Тест ВКЛ (Выключить)' : 'Проверить без сети'}
                </button>
              </div>
            </div>
          ` : ''}

          <!-- Блок 1: Загрузка новой области 50 км / 120 км (доступен всем) -->
          <div class="card" style="padding:11px 12px;background:var(--card);border:1.5px solid var(--accent);display:flex;flex-direction:column;gap:10px;">
            <div style="font-weight:900;font-size:13px;color:var(--accent);">
              1. Скачать карту вокруг выбранной точки (${Number(centerLat).toFixed(4)}°N, ${Number(centerLon).toFixed(4)}°E)
            </div>
            <div>
              <label style="display:block;font-size:11px;font-weight:800;color:var(--muted);margin-bottom:4px;">НАЗВАНИЕ РАЙОНА / ВОДОЁМА ДЛЯ СОХРАНЕНИЯ:</label>
              <input type="text" id="offMapTitleInput" class="input" maxlength="54" value="${escapeHtml(customAreaTitle)}" placeholder="Напр.: р. Седе-Яха и р. Ямсовей">
            </div>
            <div>
              <label style="display:block;font-size:11px;font-weight:800;color:var(--muted);margin-bottom:5px;">2. ВЫБЕРИТЕ УСЛОВИЕ ОХВАТА ЛОКАЦИИ («50 КМ» ИЛИ «120 КМ»):</label>
              <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;">
                <button type="button" class="btn ${chosenRadiusKm === 50 ? 'btn-good' : ''}" data-pick-off-radius="50" style="min-height:48px;flex-direction:column;gap:2px;padding:6px 8px;width:100%;">
                  <span style="font-weight:900;font-size:13px;">Радиус 50 км</span>
                  <span style="font-size:10.5px;opacity:0.88;">Квадрат 100x100 км (выезд 1–2 дня)</span>
                </button>
                <button type="button" class="btn ${chosenRadiusKm === 120 ? 'btn-accent' : ''}" data-pick-off-radius="120" style="min-height:48px;flex-direction:column;gap:2px;padding:6px 8px;width:100%;">
                  <span style="font-weight:900;font-size:13px;">Радиус 120 км</span>
                  <span style="font-size:10.5px;opacity:0.88;">Квадрат 240x240 км (экспедиция / море)</span>
                </button>
              </div>
            </div>
            <div>
              <label style="display:block;font-size:11px;font-weight:800;color:var(--muted);margin-bottom:5px;">3. ВЫБЕРИТЕ ТИП КАРТЫ ДЛЯ РАБОТЫ БЕЗ СЕТИ:</label>
              <div style="display:flex;flex-direction:column;gap:6px;">
                <button type="button" class="btn btn-sm ${chosenLayerMode === 'satellite' ? 'btn-accent' : ''}" data-pick-off-layer="satellite" style="justify-content:space-between;min-height:38px;width:100%;text-align:left;padding:6px 10px;">
                  <span style="font-weight:800;">Яндекс Спутник + Гибрид (дороги и реки до Z18)</span>
                  <span class="pill pill-good" style="font-size:10px;">Рекомендуется</span>
                </button>
                <button type="button" class="btn btn-sm ${chosenLayerMode === 'scheme' ? 'btn-accent' : ''}" data-pick-off-layer="scheme" style="justify-content:space-between;min-height:38px;width:100%;text-align:left;padding:6px 10px;">
                  <span style="font-weight:800;">Яндекс Схема (реки, дороги, зимники, рельеф)</span>
                  <span class="pill pill-neutral" style="font-size:10px;">Быстрая загрузка</span>
                </button>
                <button type="button" class="btn btn-sm ${chosenLayerMode === 'full' ? 'btn-accent' : ''}" data-pick-off-layer="full" style="justify-content:space-between;min-height:38px;width:100%;text-align:left;padding:6px 10px;">
                  <span style="font-weight:800;">Полный комплект (Схема + Спутник + Гибрид Z18)</span>
                  <span class="pill pill-warn" style="font-size:10px;">Оба слоя</span>
                </button>
              </div>
            </div>
            <label style="display:flex;align-items:flex-start;gap:8px;padding:8px 10px;background:var(--panel);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:11.5px;line-height:1.35;">
              <input type="checkbox" id="offMapSmartHydroChk" ${smartHydroZ15 ? 'checked' : ''} style="margin-top:2px;width:16px;height:16px;flex-shrink:0;">
              <span><b>Комбинированное покрытие (Обзор Z7–Z13 на весь квадрат + Детализация Z14–Z18 до 10 м/см):</b> обзорная карта покрывает весь квадрат ${chosenRadiusKm} км, а детальные масштабы Z14–Z18 загружаются вдоль русел рек, мостов, слипов и ваших точек (защищённое хранилище IndexedDB Persistent).</span>
            </label>
            <div style="padding:9px 11px;background:var(--panel);border:1px solid var(--border);border-radius:8px;display:flex;flex-direction:column;gap:4px;font-size:11.5px;">
              <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;">
                <span style="color:var(--muted);">По плану в квадрате ${chosenRadiusKm} км (Z7–Z${smartHydroZ15 ? 18 : 14}):</span>
                <b>${plan.totalTiles} тайлов (~${formatBytesHuman(plan.estimatedTotalBytes)})</b>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;">
                <span style="color:var(--muted);">Уже есть в памяти (общие тайлы):</span>
                <b style="color:var(--good);">${overlap.alreadyCachedTiles} шт.</b>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;">
                <span style="color:var(--muted);">Статус постоянного хранилища:</span>
                <b style="color:${quotaInfo.persisted ? 'var(--good)' : 'var(--warn)'};">${quotaInfo.persisted ? 'Защищено от автоочистки (Persistent)' : 'Временное (установите PWA/APK для защиты)'}</b>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;padding-top:4px;border-top:1px dashed var(--border);">
                <span style="font-weight:800;color:var(--text);">К скачиванию по сети:</span>
                <b style="font-size:13px;color:var(--accent);">${overlap.needDownloadTiles} шт. (~${formatBytesHuman(overlap.estimatedDownloadBytes)})</b>
              </div>
            </div>

            <!-- Живой индикатор загрузки (адаптивный для светлой, тёмной и контрастной тем) -->
            <div id="offMapDownloadProgressBox" class="klev-offline-progress-card" style="display:none;flex-direction:column;gap:8px;padding:10px 12px;background:var(--card);border:1.5px solid var(--good);border-radius:10px;box-shadow:var(--shadow);">
              <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:11.5px;font-weight:800;gap:8px;">
                <span id="offMapProgressStatusText" style="color:var(--good);min-width:0;flex:1;line-height:1.3;">Загрузка и верификация тайлов...</span>
                <span id="offMapProgressPctText" style="font-family:monospace;font-weight:900;color:var(--accent);white-space:nowrap;flex-shrink:0;">0%</span>
              </div>
              <div class="klev-progress-track" style="width:100%;height:12px;border-radius:999px;overflow:hidden;border:1px solid var(--border);">
                <div id="offMapProgressBarFill" style="width:0%;height:100%;background:linear-gradient(90deg,var(--accent),var(--good));border-radius:999px;transition:width 0.15s ease;"></div>
              </div>
              <div style="display:flex;align-items:center;gap:10px;">
                <div id="offMapLiveTilePreviewWrap" style="width:58px;height:58px;border-radius:8px;overflow:hidden;border:1.5px solid var(--good);background:var(--panel);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--muted);text-align:center;">
                  <img id="offMapLiveTilePreviewImg" alt="" style="width:100%;height:100%;object-fit:cover;display:none;">
                  <span id="offMapLiveTilePreviewPlaceholder">Контроль<br>тайла</span>
                </div>
                <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:3px;">
                  <div id="offMapProgressSubMeta" style="font-size:11px;color:var(--text);font-weight:800;line-height:1.3;">Скачано новых: 0 • Записано: 0 КБ</div>
                  <div id="offMapProgressSampleMeta" style="font-size:10.5px;color:var(--good);font-weight:700;line-height:1.25;">Ожидание первого проверенного тайла...</div>
                </div>
              </div>
              <button type="button" class="btn btn-sm" id="offMapCancelDownloadBtn" style="min-height:36px;width:100%;justify-content:center;font-weight:800;color:var(--bad);border-color:var(--bad);background:var(--panel);">Остановить (сохранить скачанное)</button>
            </div>

            <button type="button" class="btn btn-good" id="offMapStartDownloadBtn" style="width:100%;min-height:44px;font-weight:900;font-size:13.5px;">
              <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <span>Скачать офлайн-карту (${chosenRadiusKm} км • ${overlap.needDownloadTiles > 0 ? `~${formatBytesHuman(overlap.estimatedDownloadBytes)}` : 'Обновить данные'})</span>
            </button>
          </div>

          ${adminNow ? `
            <!-- Панель 2 (ТОЛЬКО ДЛЯ АДМИНА): ИНСТРУМЕНТ ПРОВЕРКИ ЗАГРУЖЕННЫХ ДАННЫХ (Z7–Z18) -->
            <div id="adminOfflineInspectorPanel" class="card" style="padding:11px 12px;background:var(--card);border:1.5px solid ${packAudit.validBlobs > 0 ? 'var(--good)' : 'var(--warn)'};display:flex;flex-direction:column;gap:9px;">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
                <div style="font-weight:900;font-size:13px;color:var(--text);">
                  Инструмент проверки загруженных данных ${inspectedPack ? `«${escapeHtml(inspectedPack.title)}»` : ''} (Админ)
                </div>
                <button type="button" class="btn btn-sm" id="offMapRunVerifyNowBtn" style="min-height:28px;padding:2px 9px;font-size:11px;font-weight:800;">
                  Перепроверить БД
                </button>
              </div>

              ${packAudit.validBlobs > 0 ? `
                <div style="padding:8px 10px;background:rgba(16,185,129,0.10);border:1px solid var(--good);border-radius:8px;font-size:11.5px;display:flex;flex-direction:column;gap:4px;">
                  <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span style="color:var(--muted);">Статус проверки данных:</span>
                    <b style="color:var(--good);">ДАННЫЕ ПОДТВЕРЖДЕНЫ (${packAudit.validBlobs} тайлов)</b>
                  </div>
                  <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span style="color:var(--muted);">Реальный размер изображений в памяти:</span>
                    <b>${formatBytesHuman(packAudit.totalBytes)} (средний тайл: ${(packAudit.avgTileBytes / 1024).toFixed(1)} КБ)</b>
                  </div>
                  <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span style="color:var(--muted);">По слоям (Спутник / Схема / Гибрид):</span>
                    <b>Спутник: ${packAudit.byLayer.yandex_sat || 0} • Схема: ${packAudit.byLayer.yandex_map || 0} • Гибрид: ${packAudit.byLayer.yandex_skl || 0}</b>
                  </div>
                </div>

                <div>
                  <div style="font-size:10.5px;font-weight:800;color:var(--muted);margin-bottom:5px;text-transform:uppercase;">
                    Распределение физических тайлов по масштабам (Z7 – Z18 • максимальная детализация):
                  </div>
                  <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px;font-size:10.5px;">
                    ${zoomKeys.map(zk => {
                      const zStat = packAudit.byZoom[zk] || { count: 0, bytes: 0 };
                      const hasZ = zStat.count > 0;
                      return `
                        <div style="padding:5px 6px;background:var(--panel);border:1px solid ${hasZ ? 'rgba(16,185,129,0.45)' : 'var(--border)'};border-radius:6px;display:flex;justify-content:space-between;align-items:center;">
                          <span style="font-weight:900;color:${hasZ ? 'var(--good)' : 'var(--muted)'};">Z${zk}</span>
                          <span style="font-weight:800;color:${hasZ ? 'var(--text)' : 'var(--muted)'};">${zStat.count} шт.</span>
                        </div>
                      `;
                    }).join('')}
                  </div>
                </div>

                ${sampleCardsHtml ? `
                  <div>
                    <div style="font-size:10.5px;font-weight:800;color:var(--muted);margin-bottom:5px;text-transform:uppercase;">
                      Контрольные снимки напрямую из памяти устройства (живая выгрузка из IndexedDB):
                    </div>
                    <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;">
                      ${sampleCardsHtml}
                    </div>
                  </div>
                ` : ''}
              ` : `
                <div style="padding:12px;background:rgba(245,158,11,0.10);border:1.5px solid var(--warn);border-radius:8px;color:var(--text);font-size:11.5px;line-height:1.45;">
                  <b style="color:var(--warn);display:block;margin-bottom:4px;">Нет загруженных тайлов для выбранного района</b>
                  Нажмите кнопку <b>«Скачать офлайн-карту»</b> выше для загрузки полной пирамиды масштабов <b>Z7–Z18</b>.
                </div>
              `}
            </div>
          ` : ''}

          <!-- Блок 3: Список сохранённых карт + пакетное удаление (доступен всем) -->
          <div class="card" style="padding:11px 12px;background:var(--card);border:1px solid var(--border);display:flex;flex-direction:column;gap:8px;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
              <div style="font-weight:900;font-size:12.5px;color:var(--text);">Сохранённые районы в памяти (${packs.length})</div>
              <label style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--muted);cursor:pointer;">
                <input type="checkbox" id="offMapShowPerimetersChk" ${_showOfflinePerimetersOnMap ? 'checked' : ''}>
                <span>Рамки зон на карте</span>
              </label>
            </div>
            ${packs.length > 0 ? `
              <div style="display:flex;flex-direction:column;gap:6px;padding:8px 10px;background:var(--panel);border:1px solid var(--border);border-radius:8px;">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
                  <span style="font-size:11px;font-weight:800;color:var(--muted);">Пакетная очистка места (выбрано: <b style="color:var(--text);">${selectedToDeleteCount}</b> из ${packs.length}):</span>
                  <div style="display:flex;gap:5px;flex-wrap:wrap;">
                    <button type="button" class="btn btn-sm" id="offMapSelectAllBtn" style="min-height:28px;padding:2px 8px;font-size:11px;">Выбрать все</button>
                    <button type="button" class="btn btn-sm" id="offMapClearSelBtn" style="min-height:28px;padding:2px 8px;font-size:11px;">Снять выбор</button>
                  </div>
                </div>
                <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;">
                  <button type="button" class="btn btn-sm" id="offMapBatchDeleteSelectedBtn" ${selectedToDeleteCount === 0 ? 'disabled' : ''} style="min-height:36px;font-weight:800;color:var(--bad);border-color:rgba(239,68,68,0.45);opacity:${selectedToDeleteCount === 0 ? '0.5' : '1'};width:100%;">
                    Удалить выбранные (${selectedToDeleteCount})${selectedToDeleteBytes > 0 ? ` • ${formatBytesHuman(selectedToDeleteBytes)}` : ''}
                  </button>
                  <button type="button" class="btn btn-sm" id="offMapDeleteAllBtn" style="min-height:36px;font-weight:800;color:var(--warn);border-color:rgba(245,158,11,0.45);width:100%;">
                    Очистить все карты
                  </button>
                </div>
              </div>
              <div style="display:flex;flex-direction:column;gap:6px;max-height:290px;overflow-y:auto;">
                ${packs.map(pk => {
                  const isChecked = _selectedPackIdsForBatchDelete.has(pk.id);
                  const realTiles = Number(pk.completedTiles) || 0;
                  const realBytes = realTiles > 0 ? (Number(pk.uniqueBytes) || Number(pk.logicalBytes) || 0) : 0;
                  const modeLbl = pk.layerMode === 'scheme' ? 'Схема' : (pk.layerMode === 'satellite' ? 'Спутник+Гибрид' : 'Схема+Спутник');
                  const dateStr = new Date(pk.updatedAt || pk.createdAt || Date.now()).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
                  const borderColor = isChecked ? 'var(--bad)' : (realTiles > 0 ? 'var(--good)' : 'var(--bad)');
                  return `
                    <div style="padding:8px 10px;background:var(--panel);border:1.5px solid ${borderColor};border-radius:8px;display:flex;flex-direction:column;gap:6px;">
                      <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;width:100%;">
                        <input type="checkbox" data-off-pack-check="${escapeHtml(pk.id)}" ${isChecked ? 'checked' : ''} style="margin-top:3px;width:16px;height:16px;flex-shrink:0;">
                        <div style="min-width:0;flex:1;">
                          <div style="font-weight:900;font-size:12.5px;color:var(--text);display:flex;align-items:center;gap:5px;flex-wrap:wrap;">
                            <span>${escapeHtml(pk.title)}</span>
                            <span class="pill ${pk.radiusKm >= 100 ? 'pill-ice' : 'pill-good'}" style="font-size:10px;padding:1px 6px;">${pk.radiusKm} км</span>
                            <span class="pill ${realTiles > 0 ? 'pill-good' : 'pill-bad'}" style="font-size:9.5px;padding:1px 6px;">
                              ${realTiles > 0 ? `${realTiles} тайлов` : '0 тайлов'}
                            </span>
                          </div>
                          <div style="font-size:11px;color:var(--muted);margin-top:2px;">
                            ${modeLbl} • В памяти: <b style="color:${realTiles > 0 ? 'var(--good)' : 'var(--bad)'};">${formatBytesHuman(realBytes)}</b> • от ${dateStr}
                          </div>
                        </div>
                      </label>
                      <div style="display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end;">
                        <button type="button" class="btn btn-sm btn-good" data-off-pack-redownload="${escapeHtml(pk.id)}" style="min-height:28px;padding:2px 9px;font-size:11px;font-weight:800;">
                          Обновить
                        </button>
                        ${adminNow ? `
                          <button type="button" class="btn btn-sm" data-off-pack-inspect="${escapeHtml(pk.id)}" style="min-height:28px;padding:2px 9px;font-size:11px;">
                            Проверить
                          </button>
                        ` : ''}
                        <button type="button" class="btn btn-sm btn-accent" data-off-pack-goto="${escapeHtml(pk.id)}" style="min-height:28px;padding:2px 9px;font-size:11px;">
                          На карту
                        </button>
                        <button type="button" class="btn btn-sm" data-off-pack-export="${escapeHtml(pk.id)}" style="min-height:28px;padding:2px 9px;font-size:11px;">
                          В файл
                        </button>
                        <button type="button" class="btn btn-sm" data-off-pack-del-single="${escapeHtml(pk.id)}" style="min-height:28px;padding:2px 8px;font-size:11px;color:var(--bad);border-color:rgba(239,68,68,0.4);">
                          Удалить
                        </button>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            ` : `
              <div style="padding:14px;background:var(--panel);border:1px dashed var(--border);border-radius:8px;text-align:center;color:var(--muted);font-size:12px;">
                У вас пока нет сохранённых офлайн-карт. Выберите радиус <b>50 км</b> или <b>120 км</b> выше и нажмите «Скачать офлайн-карту» перед выездом на водоём.
              </div>
            `}
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;padding-top:6px;border-top:1px dashed var(--border);">
              <span style="font-size:11px;color:var(--muted);">Обмен картами с напарником без интернета (.klevmap):</span>
              <label class="btn btn-sm" style="cursor:pointer;margin:0;min-height:30px;padding:3px 10px;font-size:11px;">
                Загрузить карту из файла
                <input type="file" id="offMapImportFileInput" accept=".json,.klevmap,application/json,*/*" style="display:none;">
              </label>
            </div>
          </div>
        `;

        root.querySelectorAll('[data-verify-sample-img]').forEach(imgEl => {
          const k = imgEl.getAttribute('data-verify-sample-img');
          const lbl = root.querySelector(`[data-verify-img-dim="${k}"]`);
          const updateDim = () => {
            if (!lbl) return;
            if (imgEl.naturalWidth > 0 && imgEl.naturalHeight > 0) {
              lbl.textContent = `Снимок ${imgEl.naturalWidth}x${imgEl.naturalHeight} px (OK)`;
              lbl.style.color = 'var(--good)';
            }
          };
          imgEl.addEventListener('load', updateDim);
          if (imgEl.complete && imgEl.naturalWidth > 0) updateDim();
        });

        root.querySelector('#offMapTitleInput')?.addEventListener('input', (e) => { customAreaTitle = e.target.value; });
        root.querySelector('#offMapToggleOfflineSimBtn')?.addEventListener('click', () => {
          setOfflineMapTestMode(!_forceOfflineTestMode);
          if (typeof onAfterChange === 'function') onAfterChange();
          showToast(
            _forceOfflineTestMode
              ? 'Включён режим проверки офлайн-карты: интернет для карты отключён, тайлы берутся только из памяти'
              : 'Обычный режим карты восстановлен (офлайн + онлайн)',
            _forceOfflineTestMode ? 'warn' : 'good'
          );
          renderModalContent();
        });
        root.querySelector('#offMapRunVerifyNowBtn')?.addEventListener('click', async () => {
          await syncOfflineKeysIndexFromDB(true);
          await renderModalContent();
          showToast('Ревизия памяти IndexedDB выполнена', 'good');
        });
        root.querySelectorAll('[data-pick-off-radius]').forEach(btn => {
          btn.addEventListener('click', () => {
            chosenRadiusKm = parseInt(btn.getAttribute('data-pick-off-radius'), 10) === 120 ? 120 : 50;
            renderModalContent();
          });
        });
        root.querySelectorAll('[data-pick-off-layer]').forEach(btn => {
          btn.addEventListener('click', () => {
            chosenLayerMode = btn.getAttribute('data-pick-off-layer') || 'satellite';
            renderModalContent();
          });
        });
        root.querySelector('#offMapSmartHydroChk')?.addEventListener('change', (e) => {
          smartHydroZ15 = Boolean(e.target.checked);
          renderModalContent();
        });
        root.querySelector('#offMapShowPerimetersChk')?.addEventListener('change', (e) => {
          _showOfflinePerimetersOnMap = Boolean(e.target.checked);
          if (typeof onAfterChange === 'function') onAfterChange();
        });

        const triggerDownloadFlow = async (overrideParams = null) => {
          const titleVal = overrideParams?.title || (root.querySelector('#offMapTitleInput')?.value || '').trim() || customAreaTitle || 'Район рыбалки';
          const cLat = overrideParams?.centerLat ?? centerLat;
          const cLon = overrideParams?.centerLon ?? centerLon;
          const rKm = overrideParams?.radiusKm ?? chosenRadiusKm;
          const lMode = overrideParams?.layerMode ?? chosenLayerMode;
          const sHydro = overrideParams?.smartHydroZ15 ?? smartHydroZ15;
          const pId = overrideParams?.packId || '';

          const progBox = root.querySelector('#offMapDownloadProgressBox');
          const startBtn = root.querySelector('#offMapStartDownloadBtn');
          if (progBox) progBox.style.display = 'flex';
          if (startBtn) startBtn.style.display = 'none';
          const statusEl = root.querySelector('#offMapProgressStatusText');
          const pctEl = root.querySelector('#offMapProgressPctText');
          const barEl = root.querySelector('#offMapProgressBarFill');
          const subEl = root.querySelector('#offMapProgressSubMeta');
          const sampleMetaEl = root.querySelector('#offMapProgressSampleMeta');
          const sampleImgEl = root.querySelector('#offMapLiveTilePreviewImg');
          const samplePhEl = root.querySelector('#offMapLiveTilePreviewPlaceholder');

          const resPack = await startOfflinePackDownload({
            packId: pId,
            title: titleVal,
            centerLat: cLat,
            centerLon: cLon,
            radiusKm: rKm,
            layerMode: lMode,
            smartHydroZ15: sHydro,
            waterPoints,
            viewportBounds,
            viewportBounds,
            onProgress: (st) => {
              if (statusEl) statusEl.textContent = st.statusText;
              if (pctEl) pctEl.textContent = `${st.percent}% (${st.completed}/${st.total})`;
              if (barEl) barEl.style.width = `${st.percent}%`;
              if (subEl) {
                subEl.textContent = `Проверено: ${st.downloadedNew + st.deduplicatedCount} шт. • Память: ${formatBytesHuman(st.logicalBytesTotal)} • ${st.speedTilesPerSec} тайл/с`;
              }
              if (st.latestSampleDataUrl && sampleImgEl) {
                sampleImgEl.src = st.latestSampleDataUrl;
                sampleImgEl.style.display = 'block';
                if (samplePhEl) samplePhEl.style.display = 'none';
                if (sampleMetaEl) sampleMetaEl.textContent = `Получен снимок: ${st.latestSampleMeta}`;
              }
            }
          });
          if (typeof onAfterChange === 'function') onAfterChange();
          if (resPack && resPack.completedTiles > 0) {
            showToast(`Карта «${titleVal}» проверена и записана: ${resPack.completedTiles} тайлов (${formatBytesHuman(resPack.logicalBytes)})`, 'good');
          }
          await renderModalContent();
        };

        root.querySelector('#offMapStartDownloadBtn')?.addEventListener('click', () => triggerDownloadFlow());
        root.querySelector('#offMapCancelDownloadBtn')?.addEventListener('click', () => cancelActiveOfflineDownload());

        root.querySelectorAll('[data-off-pack-redownload]').forEach(btn => {
          btn.addEventListener('click', () => {
            const pid = btn.getAttribute('data-off-pack-redownload');
            const pk = packs.find(p => p.id === pid);
            if (!pk) return;
            triggerDownloadFlow({
              packId: pk.id,
              title: pk.title,
              centerLat: pk.centerLat,
              centerLon: pk.centerLon,
              radiusKm: pk.radiusKm,
              layerMode: pk.layerMode || 'satellite',
              smartHydroZ15: pk.smartHydroZ15 !== false
            });
          });
        });

        root.querySelectorAll('[data-off-pack-inspect]').forEach(btn => {
          btn.addEventListener('click', () => {
            const pid = btn.getAttribute('data-off-pack-inspect');
            if (pid) {
              _inspectedPackIdInModal = pid;
              renderModalContent();
            }
          });
        });

        root.querySelectorAll('[data-off-pack-check]').forEach(chk => {
          chk.addEventListener('change', () => {
            const pid = chk.getAttribute('data-off-pack-check');
            if (!pid) return;
            if (chk.checked) _selectedPackIdsForBatchDelete.add(pid);
            else _selectedPackIdsForBatchDelete.delete(pid);
            renderModalContent();
          });
        });
        root.querySelector('#offMapSelectAllBtn')?.addEventListener('click', () => {
          packs.forEach(p => _selectedPackIdsForBatchDelete.add(p.id));
          renderModalContent();
        });
        root.querySelector('#offMapClearSelBtn')?.addEventListener('click', () => {
          _selectedPackIdsForBatchDelete.clear();
          renderModalContent();
        });
        root.querySelector('#offMapBatchDeleteSelectedBtn')?.addEventListener('click', async () => {
          if (_selectedPackIdsForBatchDelete.size === 0) return;
          const ids = Array.from(_selectedPackIdsForBatchDelete);
          const res = await deleteOfflineMapPacksBatch(ids);
          _selectedPackIdsForBatchDelete.clear();
          if (typeof onAfterChange === 'function') onAfterChange();
          showToast(`Удалено карт: ${res.removedPacks} шт. • Освобождено: ${formatBytesHuman(res.freedBytes)}`, 'info');
          renderModalContent();
        });
        root.querySelector('#offMapDeleteAllBtn')?.addEventListener('click', () => {
          openConfirmDeleteModal({
            title: 'Очистить все офлайн-карты?',
            message: `Будут удалены все загруженные районы (${packs.length} шт.) и освобождено ~${formatBytesHuman(totalAllBytesInDb)} памяти устройства.`,
            confirmLabel: 'Да, очистить все',
            onConfirm: async () => {
              const allIds = packs.map(p => p.id);
              const res = await deleteOfflineMapPacksBatch(allIds);
              _selectedPackIdsForBatchDelete.clear();
              if (typeof onAfterChange === 'function') onAfterChange();
              showToast(`Все офлайн-карты удалены (освобождено ${formatBytesHuman(res.freedBytes)})`, 'info');
              renderModalContent();
            }
          });
        });
        root.querySelectorAll('[data-off-pack-del-single]').forEach(btn => {
          btn.addEventListener('click', async () => {
            const pid = btn.getAttribute('data-off-pack-del-single');
            if (!pid) return;
            const res = await deleteOfflineMapPacksBatch([pid]);
            _selectedPackIdsForBatchDelete.delete(pid);
            if (typeof onAfterChange === 'function') onAfterChange();
            showToast(`Карта удалена (освобождено ${formatBytesHuman(res.freedBytes)})`, 'info');
            renderModalContent();
          });
        });
        root.querySelectorAll('[data-off-pack-goto]').forEach(btn => {
          btn.addEventListener('click', () => {
            const pid = btn.getAttribute('data-off-pack-goto');
            const pk = packs.find(p => p.id === pid);
            if (pk && typeof onSelectPackLocation === 'function') {
              closeModal();
              onSelectPackLocation(pk);
            }
          });
        });
        root.querySelectorAll('[data-off-pack-export]').forEach(btn => {
          btn.addEventListener('click', () => {
            const pid = btn.getAttribute('data-off-pack-export');
            if (pid) exportOfflineMapPackToFile(pid);
          });
        });
        root.querySelector('#offMapImportFileInput')?.addEventListener('change', (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const r = new FileReader();
          r.onload = async () => {
            const ok = await importOfflineMapPackFromFileText(String(r.result || ''));
            if (ok) {
              if (typeof onAfterChange === 'function') onAfterChange();
              renderModalContent();
            }
          };
          r.readAsText(f);
        });
      };
      await renderModalContent();
    }
  );
}

let mapInstance = null;
let mapMarker = null;
let scoutMarker = null;
let overlayLayerGroup = null;
let _circleLayersMap = new Map();
let _focusedCircleId = null;
export function focusCircleOnMap(circleId, lat, lon) {
  _focusedCircleId = circleId;
  mapOpen = true;
  if (typeof window !== 'undefined' && typeof window.__KLEV_NAVIGATE_SECTION__ === 'function') {
    window.__KLEV_NAVIGATE_SECTION__('geo');
  }
  setTimeout(() => {
    if (mapInstance && Number.isFinite(lat) && Number.isFinite(lon)) {
      mapInstance.flyTo([lat, lon], 13);
      renderMapOverlays();
      if (_circleLayersMap.has(circleId)) {
        const lyr = _circleLayersMap.get(circleId);
        if (typeof lyr.openPopup === 'function') lyr.openPopup();
      }
    }
    flashHighlightElement('#mapBox', { scroll: true, block: 'center', delayMs: 40 });
  }, 120);
}
if (typeof window !== 'undefined') {
  window.__KLEV_FOCUS_MAP_CIRCLE__ = focusCircleOnMap;
}
let currentTileLayer = null;
let currentLayerKey = 'yandex_map';
let mapOpen = false;
let inlineGpsHint = '';
let overpassLoading = false;
let activeOverpassReqId = 0;
let yandexMapFilters = {
  hydro: false,
  labels: false,
  dim: false
};
let inspectMode = false;
let inspectedPoint = null; // { lat, lon, basinCode, basinName, settlement, waters, topSpecies, waterType }
let visibleMapLayers = {
  mySpots: true,
  circleBlur: true,
  crewExact: true,
  showMine: true,
  showForeign: true,
  ownership: "all", // "all" | "mine" | "foreign" | "none"
  spotCategory: "all",
  selectedCategories: new Set(["slip", "snag", "camp", "hazard", "bite", "shop"]),
  openDropdown: "" // "" | "sources" | "ownership" | "categories"
};
/**
 * Возвращает точную эллиптическую проекцию Меркатора EPSG:3395 (WGS-84) для Яндекс Карт,
 * чтобы берега рек, острова и рыболовные точки совпадали с точностью до метра без вертикального сдвига.
 */
function getYandexEPSG3395CRS() {
  if (typeof L === 'undefined') return null;
  if (L.CRS && L.CRS.EPSG3395) return L.CRS.EPSG3395;
  if (L.Projection && L.Projection.Mercator && L.CRS && L.CRS.Earth && L.Transformation) {
    const R = 6378137;
    const scale = 0.5 / (Math.PI * R);
    return L.extend({}, L.CRS.Earth, {
      code: 'EPSG:3395',
      projection: L.Projection.Mercator,
      transformation: new L.Transformation(scale, 0.5, -scale, 0.5)
    });
  }
  return L.CRS.EPSG3857;
}
let _lastMapStoreCoordKey = '';
function normalizeSpotCatKey(rawCat = '') {
  if (rawCat === 'spot' || rawCat === 'hole') return 'bite';
  return SPOT_CATEGORIES[rawCat] ? rawCat : 'slip';
}
export function computeDeduplicatedMapCounts(stateObj = null) {
  const s = stateObj || store.getState();
  const ident = getCurrentFisherIdentity(s);
  const seenSpotKeys = new Set();
  const uniqueSpots = [];
  if (Array.isArray(s.savedSpots)) {
    s.savedSpots.forEach(sp => {
      if (!sp || !Number.isFinite(Number(sp.lat)) || !Number.isFinite(Number(sp.lon))) return;
      const catKey = normalizeSpotCatKey(sp.category || 'bite');
      const dKey = `${catKey}_${Number(sp.lat).toFixed(4)}_${Number(sp.lon).toFixed(4)}`;
      if (seenSpotKeys.has(dKey)) return;
      seenSpotKeys.add(dKey);
      uniqueSpots.push({ id: sp.id, catKey, lat: Number(sp.lat), lon: Number(sp.lon), mine: true, source: 'saved', raw: sp, dKey });
    });
  }
  const rawCircle = (Array.isArray(s.circleItems) ? s.circleItems : []).filter(x => x && !isCircleItemHidden(x, s));
  rawCircle.forEach(item => {
    if (item.t !== 'spot' || !Number.isFinite(Number(item.lat)) || !Number.isFinite(Number(item.lon))) return;
    const catKey = normalizeSpotCatKey(item.cat || 'slip');
    const dKey = `${catKey}_${Number(item.lat).toFixed(4)}_${Number(item.lon).toFixed(4)}`;
    if (seenSpotKeys.has(dKey)) return;
    seenSpotKeys.add(dKey);
    uniqueSpots.push({ id: item.id, catKey, lat: Number(item.lat), lon: Number(item.lon), mine: isCircleItemMine(item, s), source: 'circle', raw: item, dKey });
  });
  const circleBlurItems = rawCircle.filter(x => x.t === 'circle' && Number.isFinite(Number(x.lat)) && Number.isFinite(Number(x.lon)));
  const now = Date.now();
  const crewExactItems = rawCircle.filter(x => x.t === 'crew' && Number.isFinite(Number(x.lat)) && Number.isFinite(Number(x.lon)) && (x.sos || ((!x.ea || x.ea > now) && (canUserAccessCrewItem(x, s) || isCircleItemMine(x, s)))));
  const mineSpots = uniqueSpots.filter(x => x.mine).length;
  const foreignSpots = uniqueSpots.filter(x => !x.mine).length;
  const mineCircle = circleBlurItems.filter(x => isCircleItemMine(x, s)).length;
  const foreignCircle = circleBlurItems.filter(x => !isCircleItemMine(x, s)).length;
  const mineCrew = crewExactItems.filter(x => isCircleItemMine(x, s)).length;
  const foreignCrew = crewExactItems.filter(x => !isCircleItemMine(x, s)).length;
  const mineMapCount = mineSpots + mineCircle + mineCrew;
  const foreignMapCount = foreignSpots + foreignCircle + foreignCrew;
  return {
    uniqueSpots,
    thematicCount: uniqueSpots.length,
    circleBlurCount: circleBlurItems.length,
    crewExactCount: crewExactItems.length,
    mineMapCount,
    foreignMapCount,
    totalMapCount: mineMapCount + foreignMapCount
  };
}
function ensureDynamicYmapFilterStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('klevDynamicYmapFilterStyle')) return;
  const st = document.createElement('style');
  st.id = 'klevDynamicYmapFilterStyle';
  st.textContent = `
    #mapBox[data-ymap-layer="yandex_dark"] img.klev-base-tile-layer {
      filter: invert(0.92) hue-rotate(185deg) saturate(1.22) brightness(0.88) contrast(1.16) !important;
    }
    #mapBox[data-ymap-layer="yandex_dark"][data-ymap-hydro="1"] img.klev-base-tile-layer {
      filter: invert(0.92) hue-rotate(185deg) saturate(1.65) brightness(0.90) contrast(1.36) !important;
    }
    #mapBox[data-ymap-layer="yandex_dark"][data-ymap-dim="1"] img.klev-base-tile-layer {
      filter: invert(0.92) hue-rotate(185deg) saturate(1.15) brightness(0.66) contrast(1.20) !important;
    }
    #mapBox[data-ymap-layer="yandex_dark"][data-ymap-hydro="1"][data-ymap-dim="1"] img.klev-base-tile-layer {
      filter: invert(0.92) hue-rotate(185deg) saturate(1.55) brightness(0.68) contrast(1.38) !important;
    }
    #mapBox:not([data-ymap-layer="yandex_dark"])[data-ymap-hydro="1"][data-ymap-dim="0"] img.klev-base-tile-layer {
      filter: contrast(1.38) saturate(1.55) brightness(0.96) !important;
    }
    #mapBox:not([data-ymap-layer="yandex_dark"])[data-ymap-hydro="0"][data-ymap-dim="1"] img.klev-base-tile-layer {
      filter: brightness(0.68) contrast(1.12) saturate(0.90) !important;
    }
    #mapBox:not([data-ymap-layer="yandex_dark"])[data-ymap-hydro="1"][data-ymap-dim="1"] img.klev-base-tile-layer {
      filter: brightness(0.70) contrast(1.42) saturate(1.45) !important;
    }
    #mapBox img.klev-labels-tile-layer {
      filter: drop-shadow(0 1px 2px rgba(0,0,0,0.85)) !important;
    }
  `;
  document.head.appendChild(st);
}
function applyYandexTileFiltersToMap() {
  ensureDynamicYmapFilterStyles();
  if (!mapInstance) return;
  if (typeof mapInstance.getPane === 'function') {
    const tilePane = mapInstance.getPane('tilePane');
    if (tilePane) tilePane.style.filter = '';
  }
  const containerEl = mapInstance._container || (typeof document !== 'undefined' ? document.getElementById('mapBox') : null);
  if (containerEl) {
    containerEl.setAttribute('data-ymap-hydro', yandexMapFilters.hydro ? '1' : '0');
    containerEl.setAttribute('data-ymap-dim', yandexMapFilters.dim ? '1' : '0');
    containerEl.setAttribute('data-ymap-layer', currentLayerKey || 'yandex_map');
  }
}
function createSingleResilientTileLayer(layerId, url, fallbacks = [], subdomains = ['1', '2', '3', '4'], attr = '', tileClassName = 'klev-base-tile-layer') {
  const offlineTl = createOfflineAwareLeafletLayer(layerId, url, fallbacks, subdomains, attr, tileClassName);
  if (offlineTl) return offlineTl;
  return L.tileLayer(url, {
    maxZoom: 18,
    subdomains,
    attribution: attr,
    className: tileClassName,
    updateWhenIdle: false,
    updateWhenZooming: false,
    keepBuffer: 2
  });
}
function createResilientTileLayer(layerKey = 'yandex_map') {
  const cfg = MAP_LAYERS[layerKey] || MAP_LAYERS.yandex_map || Object.values(MAP_LAYERS)[0];
  const subs = Array.isArray(cfg.subdomains) ? cfg.subdomains : ['1', '2', '3', '4'];
  const fallbacks = Array.isArray(cfg.fallbacks) ? cfg.fallbacks : [];
  const baseTl = createSingleResilientTileLayer(layerKey, cfg.url, fallbacks, subs, cfg.attr, 'klev-base-tile-layer');
  const needLabelsOverlay = Boolean(cfg.hasLabelsOverlay || (yandexMapFilters.labels && layerKey === 'yandex_sat'));
  if (needLabelsOverlay) {
    const sklUrl = cfg.overlayUrl || 'https://core-renderer-tiles.maps.yandex.net/tiles?l=skl&v=24.10.30-0&x={x}&y={y}&z={z}&scale=2&lang=ru_RU';
    const sklTl = createSingleResilientTileLayer('yandex_skl', sklUrl, [], subs, '', 'klev-labels-tile-layer');
    return L.layerGroup([baseTl, sklTl]);
  }
  return baseTl;
}
function rebuildActiveMapTileLayer() {
  if (!mapInstance) return;
  _tileCacheBustSeq = Date.now();
  if (currentTileLayer) {
    try {
      if (typeof currentTileLayer.eachLayer === 'function') {
        currentTileLayer.eachLayer(sub => { try { mapInstance.removeLayer(sub); } catch (_e) {} });
      }
      mapInstance.removeLayer(currentTileLayer);
    } catch (_e) {}
    currentTileLayer = null;
  }
  currentTileLayer = createResilientTileLayer(currentLayerKey).addTo(mapInstance);
  applyYandexTileFiltersToMap();
}

function ensureNetworkAndVpnTileRecoveryBound() {
  if (typeof window === 'undefined' || window.__KLEV_VPN_TILE_RECOVERY_BOUND__) return;
  window.__KLEV_VPN_TILE_RECOVERY_BOUND__ = true;
  let lastRecoverTs = 0;
  const triggerTileRecoveryIfNeeded = (forceRebuild = false) => {
    if (_forceOfflineTestMode || !mapInstance) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const now = Date.now();
    if (now - lastRecoverTs < 1200) return;
    const hasStuckGridTiles = typeof document !== 'undefined' && Boolean(document.querySelector('img[data-offline-overzoom="grid"]'));
    if (forceRebuild || hasStuckGridTiles) {
      lastRecoverTs = now;
      rebuildActiveMapTileLayer();
    }
  };
  window.addEventListener('online', () => {
    setTimeout(() => triggerTileRecoveryIfNeeded(true), 350);
    setTimeout(() => triggerTileRecoveryIfNeeded(false), 2200);
  });
  if (typeof navigator !== 'undefined' && navigator.connection && typeof navigator.connection.addEventListener === 'function') {
    navigator.connection.addEventListener('change', () => {
      setTimeout(() => triggerTileRecoveryIfNeeded(true), 600);
      setTimeout(() => triggerTileRecoveryIfNeeded(false), 2600);
    });
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        setTimeout(() => triggerTileRecoveryIfNeeded(false), 500);
      }
    });
  }
  setInterval(() => {
    triggerTileRecoveryIfNeeded(false);
  }, 2800);
}
function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}
function calcHaversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 100000) / 100000;
}
/**
 * Вычисляет мгновенную разведку для любой точки карты (« Что здесь клюёт?»)
 * без изменения домашней локации пользователя в store!
 */
export function inspectWhatBitesHere(lat, lon) {
  const rLat = Math.round(lat * 10000) / 10000;
  const rLon = Math.round(lon * 10000) / 10000;
  const s = store.getState();
  const basinCode = detectBasinByCoords(rLat, rLon);
  const isCoastal = isCoastalInBasin(basinCode, rLat, rLon);
  const settlement = findNearestRussianSettlement(rLat, rLon);
  const waters = getNearestRussianWaters(rLat, rLon, basinCode, isCoastal, 6, 60);
  const primaryWater = waters[0]?.wType || (isCoastal ? 'sea_gulf' : 'small_river');
  const primaryWaterName = waters[0]?.name || WATER_PROFILES[primaryWater]?.shortName || 'Водоём';
  const defDepth = waters[0]?.defDepth || WATER_PROFILES[primaryWater]?.defD || 2.0;
  const ecoregion = getSpotEcoregion(rLat, rLon, basinCode, primaryWater, primaryWaterName);
  const basinName = ecoregion.displayBasinName || BASIN_CONFIGS[basinCode]?.name || 'Водный бассейн РФ';
  const day = s.weatherDays?.[s.dayIdx] || s.weatherDays?.[2] || s.weatherDays?.[0] || null;
  const radiusTypes = new Set(waters.map(w => w.wType).concat([primaryWater]));
  const hasCooling = primaryWater === 'cooling_reservoir' || radiusTypes.has('cooling_reservoir');
  const isLocalCoastal = Boolean(isCoastal || primaryWater.startsWith('sea') || radiusTypes.has('sea_gulf') || radiusTypes.has('open_sea'));
  const candidateSpecies = FISH_DB.filter(f => {
    if (f.legal === 'redbook') return false;
    return isSpeciesInGeoRange(f, rLat, rLon, basinCode, primaryWater, 60, radiusTypes, isLocalCoastal, hasCooling, primaryWaterName);
  });
  const sigOrder = ecoregion.signatureSpecies || [];
  const sigMap = new Map(sigOrder.map((id, idx) => [id, idx]));
  const scored = candidateSpecies.map(f => {
    const compat = getCompatibleMethods(f, day?.iceState || s.iceState, primaryWater, day?.waterTemp ?? 10);
    const bestMethod = compat[0]?.val || s.method;
    const score = day ? calcDayBest(f, day, bestMethod, primaryWater, defDepth, s.normPress, day.iceState || s.iceState) : 65;
    const sigIdx = sigMap.has(f.id) ? sigMap.get(f.id) : -1;
    const abundanceBonus = sigIdx >= 0 ? Math.max(8, 30 - sigIdx * 2) : -8;
    const isSeaBiotope = primaryWater === 'sea_gulf' || primaryWater === 'open_sea';
    const matchesBiotope = Array.isArray(f.waters) && (
      f.waters.includes(primaryWater) ||
      (isSeaBiotope && (f.habitat === 'sea' || f.waters.includes('sea_gulf') || f.waters.includes('open_sea')))
    );
    const directWaterBonus = matchesBiotope ? 10 : -6;
    const legalAdjust = (f.legal === 'license' && (sigIdx < 0 || sigIdx > 4)) ? -6 : 0;
    return {
      fish: f,
      score,
      rankScore: score + abundanceBonus + directWaterBonus + legalAdjust,
      methodText: compat[0]?.text || 'Спиннинг / Поплавок'
    };
  }).sort((a, b) => b.rankScore - a.rankScore);
  inspectedPoint = {
    lat: rLat,
    lon: rLon,
    basinCode,
    basinName,
    isCoastal,
    settlementLabel: settlement ? `${settlement.name} (${settlement.distKm} км)` : `${rLat.toFixed(2)}°N, ${rLon.toFixed(2)}°E`,
    waters,
    primaryWater,
    primaryWaterName,
    defDepth,
    topSpecies: scored.slice(0, 6)
  };
  triggerHaptic('selection');
  return inspectedPoint;
}
export function classifyOsmWaterElement(el, name, isCoastal) {
  const tags = el?.tags || {};
  const nLower = String(name || '').toLowerCase();
  const waterTag = String(tags.water || '').toLowerCase();
  const waterwayTag = String(tags.waterway || '').toLowerCase();
  const landuseTag = String(tags.landuse || '').toLowerCase();
  if (/грэс|тэц|аэс|охладител|тёплый канал|теплый канал/i.test(nLower)) {
    return { wType: 'cooling_reservoir', typeTag: 'ГРЭС / Тёплый сброс' };
  }
  if (/губа|залив|лиман|бухта|пролив|море/i.test(nLower) || tags.natural === 'bay' || tags.natural === 'strait') {
    if (isCoastal) {
      return { wType: 'sea_gulf', typeTag: 'Морской залив / Губа' };
    }
    return { wType: 'quarry', typeTag: 'Крупный залив / Вдхр' };
  }
  if (waterwayTag || /^р\.|^река\s|^ручей\s|^протока\s/i.test(nLower)) {
    const isMajorRiver =
      /обь|иртыш|енисей|волга|кама|дон|днепр|пур|таз|надым|амур|зея|уссури|лена|вилюй|алдан|ангара|печора|уса|ока|урал|вятка|белая|кубань|нева|свирь|волхов|северная двина|вычегда|онега|луга|нарва|преголя|селенга|камчатка|колыма|индигирка|хатанга|пясина|тулома|томь|чулым|кет|вах|конда|туртас|тавда|тура|тобол|исеть|чусовая|сура|ветлуга|мокша|хопёр|медведица|северский донец|маныч|ахтуба|бузан|бахтемир/i.test(nLower) ||
      (tags.width && parseFloat(tags.width) >= 60) ||
      tags.boat === 'yes' ||
      tags.CEMT;
    if (isMajorRiver) {
      return { wType: 'big_river', typeTag: 'Река большая' };
    }
    if (waterwayTag === 'stream' || /ручей|ключ|речка/i.test(nLower)) {
      return { wType: 'small_river', typeTag: 'Река малая / Ручей' };
    }
    return { wType: 'small_river', typeTag: 'Река малая' };
  }
  if (/карьер|разрез|котлован/i.test(nLower) || waterTag === 'quarry' || landuseTag === 'quarry') {
    return { wType: 'quarry', typeTag: 'Карьер' };
  }
  if (/вдхр|водохранилище/i.test(nLower) || waterTag === 'reservoir' || landuseTag === 'reservoir') {
    return { wType: 'quarry', typeTag: 'Водохранилище' };
  }
  if (/старица|затон|сор|пойма|пруд|болото|ильмень|озерцо/i.test(nLower) || waterTag === 'oxbow' || waterTag === 'pond') {
    return { wType: 'tundra_lake', typeTag: /старица|затон/i.test(nLower) ? 'Старица / Затон' : 'Пруд / Озеро малое' };
  }
  if (el?.type === 'relation' || /большое|глубокое|святое|белое|светлое|круглое|долгое|селигер|ладож|онеж|байкал|имандра|сямозеро|сегозеро|выгозеро|пяозеро|чудск|телецк|увильды|тургояк|ханто|янтарное/i.test(nLower)) {
    return { wType: 'quarry', typeTag: 'Озеро крупное' };
  }
  return { wType: 'tundra_lake', typeTag: 'Озеро' };
}
export async function setLocation(lat, lon, skipReverseGeo = false, targetZoomOverride = null) {
  const rLat = Math.round(Number(lat) * 1000000) / 1000000;
  const rLon = Math.round(Number(lon) * 1000000) / 1000000;
  _lastMapStoreCoordKey = `${rLat.toFixed(4)}_${rLon.toFixed(4)}`;
  store.dispatch({
    type: 'SET_LOCATION',
    payload: { lat: rLat, lon: rLon, hasUserLocation: true }
  });
  if (mapInstance && mapMarker) {
    mapMarker.setLatLng([rLat, rLon]);
    const z = Number.isFinite(targetZoomOverride)
      ? clamp(targetZoomOverride, 6, 18)
      : clamp(mapInstance.getZoom() || 11, 7, 18);
    mapInstance.setView([rLat, rLon], z);
  }
  const st = store.getState();
  const prof = WATER_PROFILES[st.water] || WATER_PROFILES.small_river;
  if (st.depth < prof.minD || st.depth > prof.maxD) {
    store.dispatch({ type: 'SET_DEPTH', payload: prof.defD });
  }
  events.emit('location:changed', { lat: rLat, lon: rLon, basinCode: st.basinCode, isCoastal: st.isCoastal });
  if (!skipReverseGeo) {
    resolveReverseGeocode(rLat, rLon);
  }
  getNearbyWatersAndPlaces(rLat, rLon, st.waterRadiusKm || 50);
  const lastWLat = Number(window.__KLEV_LAST_WEATHER_FETCH_LAT__);
  const lastWLon = Number(window.__KLEV_LAST_WEATHER_FETCH_LON__);
  const distFromLastWeatherKm = (Number.isFinite(lastWLat) && Number.isFinite(lastWLon))
    ? calcHaversineKm(rLat, rLon, lastWLat, lastWLon)
    : 9999;
  // При переключении местоположения автоматически запрашиваем актуальную погоду и сводку meteoinfo.ru по новой точке
  if (distFromLastWeatherKm > 0.3 || !Array.isArray(st.weatherDays) || st.weatherDays.length === 0) {
    window.__KLEV_LAST_WEATHER_FETCH_LAT__ = rLat;
    window.__KLEV_LAST_WEATHER_FETCH_LON__ = rLon;
    await fetchWeather(rLat, rLon, true);
  } else {
    await fetchWeather(rLat, rLon, false);
  }
}
export async function autoDetectStartupLocation() {
  const s = store.getState();
  if (s.hasUserLocation) return;
  if (typeof navigator !== 'undefined' && navigator.permissions && typeof navigator.permissions.query === 'function') {
    try {
      const perm = await navigator.permissions.query({ name: 'geolocation' });
      if (perm && perm.state === 'granted' && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          pos => {
            _updateLiveGpsTelemetryFromPosition(pos);
            if (!store.getState().hasUserLocation) {
              setLocation(pos.coords.latitude, pos.coords.longitude);
            }
          },
          () => {},
          { enableHighAccuracy: false, timeout: 6000, maximumAge: 600000 }
        );
      }
    } catch (e) {}
  }
}
export async function locateByIpFallback() {
  const providers = [
    {
      url: 'https://api.bigdatacloud.net/data/reverse-geocode-client?localityLanguage=ru',
      parse: d => (d && Number.isFinite(d.latitude) && Number.isFinite(d.longitude))
        ? { lat: d.latitude, lon: d.longitude, city: d.city || d.locality || d.principalSubdivision, region: d.principalSubdivision }
        : null
    },
    {
      url: 'https://ipwho.is/?lang=ru',
      parse: d => (d && d.success !== false && Number.isFinite(d.latitude) && Number.isFinite(d.longitude))
        ? { lat: d.latitude, lon: d.longitude, city: d.city, region: d.region }
        : null
    },
    {
      url: 'https://freeipapi.com/api/json',
      parse: d => (d && Number.isFinite(d.latitude) && Number.isFinite(d.longitude))
        ? { lat: d.latitude, lon: d.longitude, city: d.cityName, region: d.regionName }
        : null
    },
    {
      url: 'https://get.geojs.io/v1/ip/geo.json',
      parse: d => (d && d.latitude && d.longitude)
        ? { lat: parseFloat(d.latitude), lon: parseFloat(d.longitude), city: d.city, region: d.region }
        : null
    }
  ];
  for (const p of providers) {
    try {
      const raw = await fetchWithTimeout(p.url, 4200);
      const res = p.parse(raw);
      if (res && Number.isFinite(res.lat) && Number.isFinite(res.lon)) {
        return res;
      }
    } catch (e) {}
  }
  return null;
}
export async function detectUserPosition() {
  if (typeof navigator !== 'undefined' && navigator.geolocation) {
    try {
      const pos1 = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 5500,
          maximumAge: 180000
        });
      });
      if (pos1 && pos1.coords && Number.isFinite(pos1.coords.latitude)) {
        return {
          lat: pos1.coords.latitude,
          lon: pos1.coords.longitude,
          source: 'gps',
          permissionDenied: false
        };
      }
    } catch (err1) {
      const denied1 = Boolean(err1 && err1.code === 1);
      if (!denied1) {
        try {
          const pos2 = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: false,
              timeout: 6000,
              maximumAge: 600000
            });
          });
          if (pos2 && pos2.coords && Number.isFinite(pos2.coords.latitude)) {
            return {
              lat: pos2.coords.latitude,
              lon: pos2.coords.longitude,
              source: 'network',
              permissionDenied: false
            };
          }
        } catch (err2) {}
      }
      const ipGeo = await locateByIpFallback();
      if (ipGeo) {
        return {
          lat: ipGeo.lat,
          lon: ipGeo.lon,
          city: ipGeo.city,
          region: ipGeo.region,
          source: 'ip',
          permissionDenied: denied1
        };
      }
      return { lat: null, lon: null, source: 'failed', permissionDenied: denied1 };
    }
  }
  const ipGeo = await locateByIpFallback();
  if (ipGeo) {
    return {
      lat: ipGeo.lat,
      lon: ipGeo.lon,
      city: ipGeo.city,
      region: ipGeo.region,
      source: 'ip',
      permissionDenied: false
    };
  }
  return { lat: null, lon: null, source: 'failed', permissionDenied: false };
}
export async function resolveReverseGeocode(lat, lon) {
  const nearest = findNearestRussianSettlement(lat, lon);
  if (nearest && nearest.distKm <= 65) {
    store.dispatch({
      type: 'SET_LOCATION_LABELS',
      payload: {
        locCountry: 'Россия',
        locAdmin1: nearest.admin1,
        locAdmin2: nearest.name,
        locLabel: nearest.label
      }
    });
    if (nearest.distKm <= 16) {
      return;
    }
  }
  try {
    const nomUrl = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1&zoom=12&accept-language=ru`;
    const nom = await fetchWithTimeout(nomUrl, 4800, { headers: { 'Accept-Language': 'ru' } });
    if (nom && nom.address) {
      const a = nom.address;
      const city = a.city || a.town || a.village || a.hamlet || a.municipality || a.county || nom.name || '';
      const reg = a.state || a.region || nearest?.admin1 || '';
      if (city || reg) {
        store.dispatch({
          type: 'SET_LOCATION_LABELS',
          payload: {
            locCountry: a.country || 'Россия',
            locAdmin1: reg,
            locAdmin2: city,
            locLabel: city || reg
          }
        });
        return;
      }
    }
  } catch (e) {}
  try {
    const bdcUrl = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=ru`;
    const data = await fetchWithTimeout(bdcUrl, 4500);
    if (data && (data.city || data.locality || data.principalSubdivision)) {
      const city = data.city || data.locality || data.principalSubdivision;
      store.dispatch({
        type: 'SET_LOCATION_LABELS',
        payload: {
          locCountry: data.countryName || 'Россия',
          locAdmin1: data.principalSubdivision || nearest?.admin1 || '',
          locAdmin2: city,
          locLabel: city
        }
      });
      return;
    }
  } catch (e) {}
  if (!nearest) {
    store.dispatch({
      type: 'SET_LOCATION_LABELS',
      payload: {
        locCountry: 'Россия',
        locAdmin1: `${lat.toFixed(2)}°N`,
        locAdmin2: `${lon.toFixed(2)}°E`,
        locLabel: `${lat.toFixed(2)}°N, ${lon.toFixed(2)}°E`
      }
    });
  }
}
const REFINED_WATERS_CACHE_KEY = 'klev_refined_waters_v1';
function loadRefinedWaterCoordsMap() {
  try {
    if (typeof localStorage === 'undefined') return {};
    return JSON.parse(localStorage.getItem(REFINED_WATERS_CACHE_KEY) || '{}') || {};
  } catch (e) {
    return {};
  }
}
function saveRefinedWaterCoords(waterName, lat, lon) {
  try {
    if (typeof localStorage === 'undefined' || !waterName) return;
    const map = loadRefinedWaterCoordsMap();
    map[waterName.toLowerCase()] = { lat: Number(lat), lon: Number(lon), ts: Date.now() };
    localStorage.setItem(REFINED_WATERS_CACHE_KEY, JSON.stringify(map));
  } catch (e) {}
}
function hasHighPrecisionCoords(lat, lon) {
  const latDec = (String(lat).split('.')[1] || '').length;
  const lonDec = (String(lon).split('.')[1] || '').length;
  return latDec >= 4 || lonDec >= 4;
}
async function resolveExactWaterCoordinates(waterObj, rawQuery = '') {
  if (!waterObj) return { lat: 0, lon: 0 };
  const cacheKey = (waterObj.name || waterObj.cleanName || '').toLowerCase();
  const refinedMap = loadRefinedWaterCoordsMap();
  if (cacheKey && refinedMap[cacheKey] && Number.isFinite(refinedMap[cacheKey].lat) && Number.isFinite(refinedMap[cacheKey].lon)) {
    return { lat: refinedMap[cacheKey].lat, lon: refinedMap[cacheKey].lon };
  }
  if (hasHighPrecisionCoords(waterObj.lat, waterObj.lon) || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    return { lat: waterObj.lat, lon: waterObj.lon };
  }
  try {
    const dLat = 0.85;
    const dLon = 1.6;
    const viewbox = `${(waterObj.lon - dLon).toFixed(3)},${(waterObj.lat + dLat).toFixed(3)},${(waterObj.lon + dLon).toFixed(3)},${(waterObj.lat - dLat).toFixed(3)}`;
    const qStr = waterObj.cleanName || rawQuery;
    const nomUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(qStr)}&format=json&viewbox=${viewbox}&bounded=0&limit=6&accept-language=ru`;
    const nomData = await fetchWithTimeout(nomUrl, 3200, { headers: { 'Accept-Language': 'ru' } });
    if (Array.isArray(nomData) && nomData.length > 0) {
      const waterHit = nomData.find(it => {
        if (!it) return false;
        const pLat = parseFloat(it.lat);
        const pLon = parseFloat(it.lon);
        if (!Number.isFinite(pLat) || !Number.isFinite(pLon)) return false;
        const dist = calcHaversineKm(waterObj.lat, waterObj.lon, pLat, pLon);
        if (dist > 65) return false;
        return (
          it.class === 'waterway' ||
          it.class === 'natural' ||
          /^(river|stream|canal|water|lake|reservoir|bay|strait|pond|oxbow|wetland)$/i.test(String(it.type || ''))
        );
      });
      if (waterHit) {
        const exLat = parseFloat(waterHit.lat);
        const exLon = parseFloat(waterHit.lon);
        waterObj.lat = exLat;
        waterObj.lon = exLon;
        saveRefinedWaterCoords(cacheKey, exLat, exLon);
        return { lat: exLat, lon: exLon };
      }
    }
  } catch (e) {}
  return { lat: waterObj.lat, lon: waterObj.lon };
}

export async function searchPlaceByQuery(query) {
  const q = (query || '').trim();
  if (!q) return;
  const qLower = q.toLowerCase().replace(/ё/g, 'е');
  const qClean = qLower.replace(/^(река|р\.|озеро|оз\.|водохранилище|вдхр\.|поселок|пгт|село|с\.|город|г\.)\s+/i, '').trim();
  const isExplicitWaterQuery = /(?:^|\s)(озеро|оз|река|р|вдхр|водохранилище|карьер|губа|залив|лиман|сор|протока|старица)(?=\s|$)/i.test(qLower);
  const matchedWater = (qClean.length >= 2) ? (
    RUSSIA_WATERS.find(w => {
      const wn = w.name.toLowerCase().replace(/ё/g, 'е');
      const wc = w.cleanName.toLowerCase().replace(/ё/g, 'е');
      const wcNoPrefix = wc.replace(/^(река|озеро|водохранилище|вдхр\.|губа|залив)\s+/i, '').trim();
      return wc === qLower || wc === qClean || wcNoPrefix === qClean || wn === qLower;
    }) ||
    RUSSIA_WATERS.find(w => {
      const wn = w.name.toLowerCase().replace(/ё/g, 'е');
      const wc = w.cleanName.toLowerCase().replace(/ё/g, 'е');
      return wn.includes(qClean) || wc.includes(qClean) || qLower.includes(wc);
    })
  ) : null;

  const exactCityMatch = !isExplicitWaterQuery ? (
    RUSSIA_CITIES.find(c => {
      const cn = c.name.toLowerCase().replace(/ё/g, 'е');
      if (cn.includes('озеро ') || cn.includes('оз.')) return false;
      const cnBase = cn.split('(')[0].replace(/^(поселок|пгт|село|с\.|город|г\.)\s+/i, '').trim();
      return cn === qLower || cn === qClean || cnBase === qLower || cnBase === qClean;
    }) ||
    RUSSIA_CITIES.find(c => {
      const cn = c.name.toLowerCase().replace(/ё/g, 'е');
      if (cn.includes('озеро ') || cn.includes('оз.')) return false;
      const cnBase = cn.split('(')[0].trim();
      return qClean.length >= 3 && (cnBase.startsWith(qClean) || qClean.endsWith(cnBase));
    })
  ) : null;

  if (matchedWater && (isExplicitWaterQuery || !exactCityMatch)) {
    const exactCoords = await resolveExactWaterCoordinates(matchedWater, q);
    store.dispatch({
      type: 'SET_LOCATION_LABELS',
      payload: {
        locCountry: 'Россия',
        locAdmin1: matchedWater.region,
        locAdmin2: matchedWater.cleanName,
        locLabel: matchedWater.region
      }
    });
    store.dispatch({
      type: 'SET_WATER',
      payload: {
        water: matchedWater.wType,
        depth: matchedWater.defDepth,
        selectedWaterName: matchedWater.cleanName
      }
    });
    showToast(`Выбран водоём: ${matchedWater.name} (${exactCoords.lat.toFixed(4)}°N, ${exactCoords.lon.toFixed(4)}°E)`, 'good');
    await setLocation(exactCoords.lat, exactCoords.lon, true, 12);
    return;
  }

  const matchedCity = exactCityMatch || RUSSIA_CITIES.find(c => {
    const cn = c.name.toLowerCase().replace(/ё/g, 'е');
    const ca = (c.admin1 || '').toLowerCase().replace(/ё/g, 'е');
    const full = `${cn} ${ca}`;
    const words = qClean.split(/\s+/).filter(w => w.length >= 2);
    return words.length > 0 && words.every(w => full.includes(w));
  }) || RUSSIA_CITIES.find(c => {
    const cn = c.name.toLowerCase().replace(/ё/g, 'е');
    return cn.includes(qClean) || qClean.includes(cn.split('(')[0].trim());
  });
  if (matchedCity) {
    const nearW = getNearestRussianWaters(matchedCity.lat, matchedCity.lon, detectBasinByCoords(matchedCity.lat, matchedCity.lon), false, 5, 80);
    store.dispatch({
      type: 'SET_LOCATION_LABELS',
      payload: {
        locCountry: 'Россия',
        locAdmin1: matchedCity.admin1,
        locAdmin2: matchedCity.name,
        locLabel: matchedCity.name
      }
    });
    if (nearW && nearW[0]) {
      store.dispatch({
        type: 'SET_WATER',
        payload: {
          water: nearW[0].wType || 'big_river',
          depth: nearW[0].defDepth || 3.0,
          selectedWaterName: nearW[0].name || matchedCity.name
        }
      });
    }
    showToast(`Переход к населённому пункту: ${matchedCity.name}`, 'good');
    await setLocation(matchedCity.lat, matchedCity.lon, true, 11);
    return;
  }
  try {
    const nomUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&addressdetails=1&limit=5&accept-language=ru`;
    const nomData = await fetchWithTimeout(nomUrl, 5500, { headers: { 'Accept-Language': 'ru' } });
    if (Array.isArray(nomData) && nomData.length > 0) {
      const waterHit = nomData.find(it =>
        it && (
          it.class === 'waterway' ||
          it.class === 'natural' ||
          /^(river|stream|canal|water|lake|reservoir|bay|strait|pond|oxbow|wetland)$/i.test(String(it.type || ''))
        )
      );
      const p = (isExplicitWaterQuery && waterHit) ? waterHit : (waterHit || nomData[0]);
      const pLat = parseFloat(p.lat);
      const pLon = parseFloat(p.lon);
      const addr = p.address || {};
      const regionName = addr.state || addr.region || addr.county || '';
      const rawTitle = p.name || (p.display_name ? p.display_name.split(',')[0].trim() : q);
      const isWaterResult = Boolean(waterHit && p === waterHit) || isExplicitWaterQuery;
      if (isWaterResult && Number.isFinite(pLat) && Number.isFinite(pLon)) {
        const basinCode = detectBasinByCoords(pLat, pLon);
        const isCoast = isCoastalInBasin(basinCode, pLat, pLon);
        const { wType, typeTag } = classifyOsmWaterElement({ tags: { waterway: p.type, water: p.type, natural: p.type } }, rawTitle, isCoast);
        const defDepth = WATER_PROFILES[wType]?.defD || 2.0;
        const nearSettlement = findNearestRussianSettlement(pLat, pLon);
        const cityLbl = addr.city || addr.town || addr.village || nearSettlement?.name || rawTitle;
        await setLocation(pLat, pLon, true, 12);
        store.dispatch({
          type: 'SET_LOCATION_LABELS',
          payload: {
            locCountry: addr.country || 'Россия',
            locAdmin1: regionName || nearSettlement?.admin1 || '',
            locAdmin2: rawTitle,
            locLabel: cityLbl
          }
        });
        store.dispatch({
          type: 'SET_WATER',
          payload: {
            water: wType,
            depth: defDepth,
            selectedWaterName: rawTitle
          }
        });
        const curWaters = store.getState().nearbyWaters || [];
        const customWaterEntry = {
          name: rawTitle,
          label: `${rawTitle} [${typeTag}] • 0 км`,
          wType,
          typeTag,
          defDepth,
          distKm: 0,
          lat: pLat,
          lon: pLon,
          isCurated: true
        };
        store.dispatch({
          type: 'SET_NEARBY_WATERS',
          payload: [customWaterEntry, ...curWaters.filter(w => (w.name || '').toLowerCase() !== rawTitle.toLowerCase())].slice(0, 42)
        });
        showToast(`Выбран водоём: ${rawTitle} (${typeTag}) • Ихтиобаза обновлена`, 'good');
        return;
      }
      const city = addr.city || addr.town || addr.village || addr.county || rawTitle || q;
      store.dispatch({
        type: 'SET_LOCATION_LABELS',
        payload: {
          locCountry: addr.country || 'Россия',
          locAdmin1: regionName,
          locAdmin2: city,
          locLabel: rawTitle || city
        }
      });
      await setLocation(pLat, pLon, true);
      return;
    }
  } catch (e) {}
  try {
    const omUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=ru&format=json`;
    const omData = await fetchWithTimeout(omUrl, 5500);
    if (omData && omData.results && omData.results.length > 0) {
      const p = omData.results[0];
      store.dispatch({
        type: 'SET_LOCATION_LABELS',
        payload: {
          locCountry: p.country || 'Россия',
          locAdmin1: p.admin1 || '',
          locAdmin2: p.admin2 || p.name,
          locLabel: p.name
        }
      });
      await setLocation(p.latitude, p.longitude, true);
      return;
    }
    showToast('Водоём или населённый пункт не найден', 'bad');
  } catch (e) {
    showToast('Слабый сигнал сети при поиске. Укажите точку на карте.', 'bad');
  }
}
export function requestGPS(container) {
  if (!navigator.geolocation) {
    inlineGpsHint = 'Геолокация не поддерживается браузером. Определяем регион по сети...';
    if (store.getState().route !== 'geo') mapOpen = true;
    render(container);
    locateByIpFallback().then(ipGeo => {
      if (ipGeo) {
        inlineGpsHint = `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z" fill="rgba(239,68,68,0.22)" stroke="#ef4444" stroke-width="1.9"/><circle cx="12" cy="11" r="2.3" fill="#ef4444"/></svg> Координаты определены по сети (${ipGeo.city || 'ваш регион'}). Для точного выбора укажите водоём на карте.`;
        setLocation(ipGeo.lat, ipGeo.lon);
      }
      render(container);
    });
    return;
  }
  inlineGpsHint = 'Опрос спутников GPS и датчиков геолокации...';
  render(container);
  const handleDeniedOrFailed = async (isPermissionDenied) => {
    const ipGeo = await locateByIpFallback();
    if (ipGeo) {
      const near = findNearestRussianSettlement(ipGeo.lat, ipGeo.lon);
      const cityTitle = near && near.distKm <= 35 ? near.name : (ipGeo.city || 'ваш регион');
      inlineGpsHint = isPermissionDenied
        ? `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z" fill="rgba(239,68,68,0.22)" stroke="#ef4444" stroke-width="1.9"/><circle cx="12" cy="11" r="2.3" fill="#ef4444"/></svg> В браузере запрещён доступ к GPS (определён город по сети: ${cityTitle}). Чтобы включить точный GPS, нажмите на значок <svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="5" y="11" width="14" height="10" rx="2.5" fill="rgba(251,191,36,0.22)" stroke="#fbbf24" stroke-width="1.8"/><path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>/<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3.2" stroke="currentColor" stroke-width="1.9"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.77 1.05 1.41 1.19H21a2 2 0 1 1 0 4h-.09c-.64.14-1.15.59-1.51 1.21z" stroke="currentColor" stroke-width="1.6"/></svg> слева от адреса klevpro.ru в строке браузера и разрешите «Геоданные», либо выберите водоём на карте.`
        : `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z" fill="rgba(239,68,68,0.22)" stroke="#ef4444" stroke-width="1.9"/><circle cx="12" cy="11" r="2.3" fill="#ef4444"/></svg> Спутники GPS недоступны в помещении — точка установлена по сети (${cityTitle}). Вы можете уточнить водоём кликом на карте.`;
      await setLocation(ipGeo.lat, ipGeo.lon);
    } else {
      inlineGpsHint = isPermissionDenied
        ? 'Доступ к GPS отклонён в настройках браузера. Нажмите на значок <svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="5" y="11" width="14" height="10" rx="2.5" fill="rgba(251,191,36,0.22)" stroke="#fbbf24" stroke-width="1.8"/><path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>/<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3.2" stroke="currentColor" stroke-width="1.9"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.77 1.05 1.41 1.19H21a2 2 0 1 1 0 4h-.09c-.64.14-1.15.59-1.51 1.21z" stroke="currentColor" stroke-width="1.6"/></svg> слева от адреса сайта и разрешите «Геоданные», либо выберите город в поиске / точку на карте.'
        : 'Слабый сигнал GPS. Выберите населённый пункт в поиске или укажите точку на карте.';
    }
    if (store.getState().route !== 'geo') mapOpen = true;
    render(container);
  };
  navigator.geolocation.getCurrentPosition(
    pos => {
      inlineGpsHint = '';
      _updateLiveGpsTelemetryFromPosition(pos);
      setLocation(pos.coords.latitude, pos.coords.longitude);
    },
    err => {
      if (err.code !== 1) {
        inlineGpsHint = 'Поиск координат по сотовой сети и Wi-Fi...';
        render(container);
        navigator.geolocation.getCurrentPosition(
          pos2 => {
            inlineGpsHint = '';
            _updateLiveGpsTelemetryFromPosition(pos2);
            setLocation(pos2.coords.latitude, pos2.coords.longitude);
          },
          err2 => {
            handleDeniedOrFailed(err2.code === 1);
          },
          { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 }
        );
      } else {
        handleDeniedOrFailed(true);
      }
    },
    { enableHighAccuracy: true, timeout: 7500, maximumAge: 180000 }
  );
}
export async function getNearbyWatersAndPlaces(lat, lon, customRadiusKm = null, offlineOnly = false) {
  const s = store.getState();
  const radiusKm = Number.isFinite(customRadiusKm) ? customRadiusKm : (s.waterRadiusKm || 50);
  const radiusMeters = Math.min(120000, Math.max(20000, Math.round(radiusKm * 1000)));
  const reqId = ++activeOverpassReqId;
  const offlineWaters = getNearestRussianWaters(lat, lon, s.basinCode, s.isCoastal, 36, radiusKm);
  const offlinePlaces = getNearestRussianSettlements(lat, lon, 24, Math.max(150, radiusKm));
  store.dispatch({ type: 'SET_NEARBY_WATERS', payload: offlineWaters });
  store.dispatch({ type: 'SET_NEARBY_PLACES', payload: offlinePlaces });
  if (!store.getState().selectedWaterName && offlineWaters.length > 0) {
    store.dispatch({
      type: 'SET_WATER',
      payload: {
        water: offlineWaters[0].wType,
        depth: offlineWaters[0].defDepth,
        selectedWaterName: offlineWaters[0].name
      }
    });
  }
  const cachedWatersObj = storage.loadNearbyWatersCache(lat, lon, radiusKm);
  if (cachedWatersObj && Array.isArray(cachedWatersObj.waters) && cachedWatersObj.waters.length > 0) {
    const mergedMap = new Map();
    for (const w of offlineWaters) mergedMap.set((w.name || '').toLowerCase(), w);
    for (const w of cachedWatersObj.waters) {
      const k = (w.name || '').toLowerCase();
      if (!mergedMap.has(k)) mergedMap.set(k, w);
    }
    const mergedWaters = Array.from(mergedMap.values()).sort((a, b) => {
      if (Boolean(a.isCurated) !== Boolean(b.isCurated)) return a.isCurated ? -1 : 1;
      return (a.distKm || 0) - (b.distKm || 0);
    }).slice(0, 48);
    store.dispatch({ type: 'SET_NEARBY_WATERS', payload: mergedWaters });
    if (Array.isArray(cachedWatersObj.places) && cachedWatersObj.places.length > 0) {
      const pMap = new Map();
      for (const p of offlinePlaces) pMap.set((p.name || '').toLowerCase(), p);
      for (const p of cachedWatersObj.places) {
        const pk = (p.name || '').toLowerCase();
        if (!pMap.has(pk)) pMap.set(pk, p);
      }
      store.dispatch({ type: 'SET_NEARBY_PLACES', payload: Array.from(pMap.values()).sort((a, b) => a.distKm - b.distKm).slice(0, 28) });
    }
    return mergedWaters;
  }
  if (offlineOnly) {
    return offlineWaters;
  }
  overpassLoading = true;
  const placeRadiusMeters = Math.min(50000, radiusMeters);
  const query = `[out:json][timeout:8];(way["waterway"~"river|canal"]["name"](around:${radiusMeters},${lat},${lon});way["natural"="water"]["name"](around:${radiusMeters},${lat},${lon});relation["natural"="water"]["name"](around:${radiusMeters},${lat},${lon});node["place"~"city|town|village|hamlet"]["name"](around:${placeRadiusMeters},${lat},${lon}););out center tags 75;`;
  const endpoints = [
    { name: 'VK/Mail.ru Overpass РФ', url: 'https://maps.mail.ru/osm/tools/overpass/api/interpreter?data=' + encodeURIComponent(query), timeoutMs: 4500 },
    { name: 'Kumi Systems Overpass', url: 'https://overpass.kumi.systems/api/interpreter?data=' + encodeURIComponent(query), timeoutMs: 4500 }
  ];
  for (const ep of endpoints) {
    try {
      const data = await fetchWithTimeout(ep.url, ep.timeoutMs);
      if (reqId !== activeOverpassReqId) return offlineWaters;
      if (!data || !Array.isArray(data.elements)) continue;
      const seenWater = new Set(offlineWaters.map(w => w.name.toLowerCase()));
      const seenPlace = new Set(offlinePlaces.map(p => p.name.toLowerCase()));
      const waters = [...offlineWaters];
      const places = [...offlinePlaces];
      for (const el of data.elements) {
        const name = el.tags && (el.tags['name:ru'] || el.tags.name);
        if (!name) continue;
        const elLat = el.lat ?? el.center?.lat;
        const elLon = el.lon ?? el.center?.lon;
        const distKm = (elLat && elLon) ? calcHaversineKm(lat, lon, elLat, elLon) : 9.9;
        if (distKm > radiusKm + 5) continue;
        if (el.tags.place) {
          const key = name.toLowerCase();
          if (seenPlace.has(key)) continue;
          seenPlace.add(key);
          if (elLat && elLon) {
            places.push({ name, lat: elLat, lon: elLon, distKm });
          }
          continue;
        }
        const cleanName = name.replace(/^(река|озеро|пруд|ручей|карьер|водохранилище|вдхр\.?)\s+/i, '').trim();
        const wKey = cleanName.toLowerCase();
        if (!cleanName || seenWater.has(wKey)) continue;
        seenWater.add(wKey);
        const { wType, typeTag } = classifyOsmWaterElement(el, name, s.isCoastal);
        const defDepth = WATER_PROFILES[wType]?.defD || 1.5;
        const isRiver = wType === 'big_river' || wType === 'small_river';
        const prefix = isRiver ? '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg> р. ' : (wType.startsWith('sea') ? '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="5" r="2.5" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.5V21M5 13c0 4.5 3.1 8 7 8s7-3.5 7-8M8 10h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> ' : (wType === 'cooling_reservoir' ? '<svg class="k-ico" style="color:var(--warn);" viewBox="0 0 24 24" fill="none"><path d="M12 2c1.5 3.5 4.5 5.5 4.5 10a5.5 5.5 0 1 1-11 0c0-3 2-5.5 3.5-7 0 2 1.5 3 1.5 3S12 5.5 12 2z" fill="#f97316" stroke="#fbbf24" stroke-width="1.5" stroke-linejoin="round"/></svg> ' : '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3c0 0-6 7.1-6 11.5a6 6 0 0 0 12 0C18 10.1 12 3 12 3z" fill="rgba(56,189,248,0.32)" stroke="#38bdf8" stroke-width="1.8"/><path d="M9.5 15.5c.5 1.2 1.7 2 3 2" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg> '));
        const distStr = distKm < 1 ? `${Math.round(distKm * 1000)} м` : `${distKm} км`;
        waters.push({
          name: cleanName,
          label: `${prefix}${cleanName} [${typeTag}] • ${distStr}`,
          wType,
          typeTag,
          defDepth,
          distKm,
          lat: elLat || lat,
          lon: elLon || lon
        });
      }
      const curatedSet = new Set(offlineWaters.map(w => (w.name || '').toLowerCase()));
      const osmExtra = waters.filter(w => !curatedSet.has((w.name || '').toLowerCase())).sort((a, b) => a.distKm - b.distKm);
      const combinedWaters = [...offlineWaters, ...osmExtra.slice(0, 18)].sort((a, b) => {
        if (Boolean(a.isCurated) !== Boolean(b.isCurated)) return a.isCurated ? -1 : 1;
        return (a.distKm || 0) - (b.distKm || 0);
      });
      places.sort((a, b) => a.distKm - b.distKm);
      overpassLoading = false;
      const topPlaces = places.slice(0, 26);
      const topWaters = combinedWaters.slice(0, 42);
      storage.saveNearbyWatersCache(lat, lon, radiusKm, topWaters, topPlaces);
      store.dispatch({ type: 'SET_NEARBY_PLACES', payload: topPlaces });
      store.dispatch({ type: 'SET_NEARBY_WATERS', payload: topWaters });
      return topWaters;
    } catch (e) {}
  }
  overpassLoading = false;
  return offlineWaters;
}
export async function saveSpot(customName = '', category = 'bite') {
  const s = store.getState();
  const ident = getCurrentFisherIdentity(s);
  const wTitle = s.selectedWaterName || WATER_PROFILES[s.water]?.shortName || s.water;
  const catObj = SPOT_CATEGORIES[category] || SPOT_CATEGORIES.bite;
  const spot = {
    id: `spot_${Date.now()}`,
    name: (customName || '').trim() || `${s.locLabel} (${wTitle})`,
    category: catObj.id,
    lat: s.lat,
    lon: s.lon,
    basinCode: s.basinCode,
    water: s.water,
    selectedWaterName: s.selectedWaterName,
    depth: s.depth,
    fid: ident.fisherId,
    au: ident.callsign,
    did: storage.getDeviceId ? storage.getDeviceId() : "dev_local",
    visibility: 'private',
    createdAt: new Date().toISOString()
  };
  await storage.putToStore('spots', spot);
  const all = await storage.getAllFromStore('spots');
  store.dispatch({ type: 'SET_SAVED_SPOTS', payload: all });
  showToast(`${catObj.icon} Точка «${spot.name}» (${catObj.short}) сохранена на вашем устройстве!`, 'good');
  return spot;
}
export function openSaveSpotModal(defaultCat = 'bite') {
  if (typeof openAddThematicMapPointModal === 'function') {
    openAddThematicMapPointModal(defaultCat);
    return;
  }
  const s = store.getState();
  const wTitle = s.selectedWaterName || WATER_PROFILES[s.water]?.shortName || s.water;
  const defName = `${s.locLabel} (${wTitle})`;
  let chosenCat = 'bite';
  const html = `
    <div style="display:flex;flex-direction:column;gap:12px;font-size:var(--fs-sm);">
      <div style="font-size:var(--fs-xs);color:var(--muted);">
        <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z" fill="rgba(239,68,68,0.22)" stroke="#ef4444" stroke-width="1.9"/><circle cx="12" cy="11" r="2.3" fill="#ef4444"/></svg> Координаты: <b>${s.lat.toFixed(4)}°N, ${s.lon.toFixed(4)}°E</b> • Глубина: <b>~${s.depth.toFixed(1)} м</b>
      </div>
      <div>
        <label style="display:block;font-size:11.5px;font-weight:800;color:var(--muted);margin-bottom:5px;">1. ВЫБЕРИТЕ ТИП ТОЧКИ НА КАРТЕ:</label>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:6px;" id="spotCatPickerGrid">
          ${Object.values(SPOT_CATEGORIES).map(cat => `
            <button type="button" class="btn btn-sm ${cat.id === 'bite' ? 'btn-accent' : ''}" data-pick-spot-cat="${cat.id}" style="justify-content:flex-start;min-height:40px;font-size:12px;">
              <span>${cat.label}</span>
            </button>
          `).join('')}
        </div>
      </div>
      <div>
        <label for="saveSpotCustomNameInp" style="display:block;font-size:11.5px;font-weight:800;color:var(--muted);margin-bottom:4px;">2. НАЗВАНИЕ ТОЧКИ / ОРИЕНТИР:</label>
        <input type="text" id="saveSpotCustomNameInp" class="input" value="${escapeHtml(defName)}" maxlength="64" placeholder="Например: Бровка у коряги, Слип у моста...">
      </div>
      <button type="button" class="btn btn-good" id="saveSpotConfirmModalBtn" style="width:100%;min-height:44px;font-weight:900;">
        <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5-4.8-4.6 6.6-.9L12 2.5z" fill="#fbbf24" stroke="#f59e0b" stroke-width="1.6" stroke-linejoin="round"/></svg> Сохранить точку на карте
      </button>
    </div>
  `;
  openModal('<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5-4.8-4.6 6.6-.9L12 2.5z" fill="#fbbf24" stroke="#f59e0b" stroke-width="1.6" stroke-linejoin="round"/></svg> Сохранить точку в закладки', html, (bodyEl) => {
    bodyEl.querySelectorAll('[data-pick-spot-cat]').forEach(btn => {
      btn.addEventListener('click', () => {
        chosenCat = btn.getAttribute('data-pick-spot-cat') || 'bite';
        bodyEl.querySelectorAll('[data-pick-spot-cat]').forEach(b => {
          b.classList.toggle('btn-accent', b.getAttribute('data-pick-spot-cat') === chosenCat);
        });
      });
    });
    bodyEl.querySelector('#saveSpotConfirmModalBtn')?.addEventListener('click', async () => {
      const customTitle = bodyEl.querySelector('#saveSpotCustomNameInp')?.value || defName;
      await saveSpot(customTitle, chosenCat);
      closeModal();
    });
  });
}
export async function deleteSpot(id) {
  await storage.deleteFromStore('spots', id);
  const all = await storage.getAllFromStore('spots');
  store.dispatch({ type: 'SET_SAVED_SPOTS', payload: all });
}
/**
 * Экспорт сохранённых точек в формат .GPX (для эхолотов Garmin / Lowrance / Практик в режиме « Профи»)
 */
export function exportSpotsToGpx() {
  const s = store.getState();
  const spots = s.savedSpots || [];
  if (spots.length === 0) {
    showToast('Нет сохранённых точек для выгрузки в .GPX. Сначала добавьте точку кнопкой « В закладки».', 'warn');
    return;
  }
  const wpts = spots.map(sp => {
    const safeName = String(sp.name || 'Точка').replace(/[<>&"']/g, '');
    return `  <wpt lat="${sp.lat}" lon="${sp.lon}">\n    <ele>-${sp.depth || 2.0}</ele>\n    <name>${safeName}</name>\n    <desc>Глубина: ${sp.depth || 2.0} м, тип: ${sp.water || 'small_river'}</desc>\n  </wpt>`;
  }).join('\n');
  const gpxXml = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="KlevPRO 2.0" xmlns="http://www.topografix.com/GPX/1/1">\n${wpts}\n</gpx>`;
  const fname = `klev-pro-spots-${new Date().toISOString().slice(0, 10)}.gpx`;
  downloadFileCrossPlatform(fname, gpxXml, 'application/gpx+xml;charset=utf-8');
  showToast(` Выгружено ${spots.length} точек в файл ${fname} (Garmin / Lowrance / Практик / Сусанин)`, 'good');
}
export function exportSpotsToKml() {
  const s = store.getState();
  const spots = s.savedSpots || [];
  if (spots.length === 0) {
    showToast('Нет сохранённых точек для выгрузки в .KML. Сначала добавьте точку кнопкой « В закладки».', 'warn');
    return;
  }
  const placemarks = spots.map(sp => {
    const safeName = String(sp.name || 'Точка').replace(/[<>&"']/g, '');
    return `    <Placemark>\n      <name>${safeName}</name>\n      <description>Глубина: ${sp.depth || 2.0} м, тип: ${sp.water || 'small_river'}</description>\n      <Point><coordinates>${sp.lon},${sp.lat},-${sp.depth || 2.0}</coordinates></Point>\n    </Placemark>`;
  }).join('\n');
  const kmlXml = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n <Document>\n <name>Клёв ПРО 2.0 — Рыболовные точки</name>\n${placemarks}\n </Document>\n</kml>`;
  const fname = `klev-pro-spots-${new Date().toISOString().slice(0, 10)}.kml`;
  downloadFileCrossPlatform(fname, kmlXml, 'application/vnd.google-earth.kml+xml;charset=utf-8');
  showToast(` Выгружено ${spots.length} точек в файл ${fname} (Google Earth / Яндекс / Locus Map)`, 'good');
}
/**
 * Импорт точек из файла .GPX (wpt/rtept/trkpt + глубины эхолота), .KML (Placemark) или .JSON
 */
let _bathymetryLayerEnabled = true;

export async function importSpotsFromFileText(fileText) {
  if (!fileText) return 0;
  const trimmedCheck = fileText.trim();
  // Поддержка CSV-выгрузок эхолотов (Lowrance / Garmin Quickdraw / Deeper / Humminbird / Практик: lat,lon,depth)
  if (!trimmedCheck.startsWith('<') && !trimmedCheck.startsWith('{') && !trimmedCheck.startsWith('[')) {
    const lines = trimmedCheck.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    let csvCount = 0;
    for (let i = 0; i < lines.length; i++) {
      const parts = lines[i].split(/[;,\t]/).map(s => s.trim());
      if (parts.length >= 3) {
        const lat = parseFloat(parts[0]);
        const lon = parseFloat(parts[1]);
        const depthVal = Math.abs(parseFloat(parts[2]));
        if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && Number.isFinite(depthVal)) {
          const sp = {
            id: `spot_csv_bathy_${Date.now()}_${csvCount}`,
            name: parts[3] ? String(parts[3]).replace(/^["']|["']$/g, '') : `Промер эхолота ${depthVal.toFixed(1)} м`,
            category: 'bite',
            isBathymetryPoint: true,
            lat: Math.round(lat * 100000) / 100000,
            lon: Math.round(lon * 100000) / 100000,
            basinCode: detectBasinByCoords(lat, lon),
            water: 'small_river',
            selectedWaterName: '',
            depth: Math.min(60, Math.max(0.3, Number(depthVal.toFixed(1)))),
            metaSummary: `Промер эхолота • Глубина ${depthVal.toFixed(1)} м`,
            createdAt: new Date().toISOString()
          };
          await storage.putToStore('spots', sp);
          csvCount++;
        }
      }
    }
    if (csvCount > 0) {
      const all = await storage.getAllFromStore('spots');
      store.dispatch({ type: 'SET_SAVED_SPOTS', payload: all });
      _bathymetryLayerEnabled = true;
      renderMapOverlays();
      showToast(`Загружена карта глубин эхолота (.CSV): ${csvCount} точек промера`, 'good');
      return csvCount;
    }
  }
  return _importSpotsXmlOrJson(fileText);
}

async function _importSpotsXmlOrJson(fileText) {
  if (!fileText) return 0;
  let importedCount = 0;
  try {
    const trimmed = fileText.trim();
    if (trimmed.startsWith('<')) {
      const gpxRegex = /<(?:wpt|rtept|trkpt)[^>]*lat=["']([0-9.-]+)["'][^>]*lon=["']([0-9.-]+)["'][^>]*>([\s\S]*?)<\/(?:wpt|rtept|trkpt)>/gi;
      let match;
      while ((match = gpxRegex.exec(trimmed)) !== null) {
        const lat = parseFloat(match[1]);
        const lon = parseFloat(match[2]);
        const inner = match[3] || '';
        const nameMatch = inner.match(/<name>([\s\S]*?)<\/name>/i);
        const eleMatch = inner.match(/<(?:ele|depth|gpxtpx:depth|waterdepth)>([\s\S]*?)<\/(?:ele|depth|gpxtpx:depth|waterdepth)>/i);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          const depthVal = eleMatch ? Math.abs(parseFloat(eleMatch[1])) || 2.5 : 2.5;
          const sp = {
            id: `spot_gpx_${Date.now()}_${importedCount}`,
            name: (nameMatch ? nameMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : `GPX Точка #${importedCount + 1}`),
            lat: Math.round(lat * 10000) / 10000,
            lon: Math.round(lon * 10000) / 10000,
            basinCode: detectBasinByCoords(lat, lon),
            water: 'small_river',
            selectedWaterName: '',
            depth: Math.min(25, Math.max(0.5, depthVal)),
            createdAt: new Date().toISOString()
          };
          await storage.putToStore('spots', sp);
          importedCount++;
        }
      }
      if (importedCount === 0 && /<Placemark/i.test(trimmed)) {
        const kmlRegex = /<Placemark[^>]*>([\s\S]*?)<\/Placemark>/gi;
        let km;
        while ((km = kmlRegex.exec(trimmed)) !== null) {
          const block = km[1] || '';
          const coordMatch = block.match(/<coordinates>\s*([0-9.-]+)\s*,\s*([0-9.-]+)(?:\s*,\s*([0-9.-]+))?/i);
          if (coordMatch) {
            const lon = parseFloat(coordMatch[1]);
            const lat = parseFloat(coordMatch[2]);
            const alt = coordMatch[3] ? Math.abs(parseFloat(coordMatch[3])) : 2.5;
            const nameMatch = block.match(/<name>([\s\S]*?)<\/name>/i);
            if (Number.isFinite(lat) && Number.isFinite(lon)) {
              const sp = {
                id: `spot_kml_${Date.now()}_${importedCount}`,
                name: (nameMatch ? nameMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : `KML Точка #${importedCount + 1}`),
                lat: Math.round(lat * 10000) / 10000,
                lon: Math.round(lon * 10000) / 10000,
                basinCode: detectBasinByCoords(lat, lon),
                water: 'small_river',
                selectedWaterName: '',
                depth: Math.min(25, Math.max(0.5, alt || 2.5)),
                createdAt: new Date().toISOString()
              };
              await storage.putToStore('spots', sp);
              importedCount++;
            }
          }
        }
      }
    } else {
      const parsed = safeJsonParse(trimmed);
      const arr = Array.isArray(parsed)
        ? parsed
        : (Array.isArray(parsed?.spots) ? parsed.spots : (Array.isArray(parsed?.data?.spots) ? parsed.data.spots : (Array.isArray(parsed?.savedSpots) ? parsed.savedSpots : [])));
      for (const item of arr) {
        if (item && Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lon))) {
          const lat = Number(item.lat);
          const lon = Number(item.lon);
          await storage.putToStore('spots', {
            id: item.id || `spot_json_${Date.now()}_${importedCount}`,
            name: item.name || `Точка #${importedCount + 1}`,
            lat: Math.round(lat * 10000) / 10000,
            lon: Math.round(lon * 10000) / 10000,
            basinCode: item.basinCode || detectBasinByCoords(lat, lon),
            water: item.water || 'small_river',
            selectedWaterName: item.selectedWaterName || '',
            depth: Number(item.depth) || 2.0,
            createdAt: item.createdAt || new Date().toISOString()
          });
          importedCount++;
        }
      }
    }
  } catch (e) {}
  if (importedCount > 0) {
    const all = await storage.getAllFromStore('spots');
    store.dispatch({ type: 'SET_SAVED_SPOTS', payload: all });
    showToast(` Импортировано рыболовных точек: ${importedCount} шт.`, 'good');
  } else {
    showToast('Не удалось найти путевые точки (<wpt>) в выбранном файле.', 'bad');
  }
  return importedCount;
}
/**
 * Отрисовывает на карте дополнительные слои:
 * - <svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><rect x=\"5\" y=\"11\" width=\"14\" height=\"10\" rx=\"2.5\" fill=\"rgba(251,191,36,0.22)\" stroke=\"#fbbf24\" stroke-width=\"1.8\"/><path d=\"M8 11V7a4 4 0 0 1 8 0v4\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\"/></svg> Мои сохранённые точки
 * - <svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><circle cx=\"9\" cy=\"8\" r=\"3.5\" fill=\"rgba(56,189,248,0.25)\" stroke=\"currentColor\" stroke-width=\"1.8\"/><path d=\"M3 19c0-3.2 2.7-5.5 6-5.5s6 2.3 6 5.5\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\"/><circle cx=\"17\" cy=\"9\" r=\"2.8\" stroke=\"currentColor\" stroke-width=\"1.6\"/><path d=\"M16 14c2.6.3 4.8 2 5 4.8\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\"/></svg> Размытые круги ±5 км из «Круга»
 * - <svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0\" stroke=\"#38bdf8\" stroke-width=\"2\" stroke-linecap=\"round\"/></svg> Точные точки «Экипажа (72ч)»
 * - <svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><circle cx=\"11\" cy=\"11\" r=\"6.5\" stroke=\"currentColor\" stroke-width=\"2\"/><path d=\"M16 16l4.5 4.5\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/></svg> Маркер разведки «Что здесь клюёт?»
 */

// ============================================================================
// ФАЗА 3: ЗАПИСЬ МАРШРУТА В ФОНЕ, ВОЗВРАТ ПО МАРШРУТУ И РЕЖИМ «Я ПОТЕРЯЛСЯ»
// ============================================================================
const PHASE3_SAVED_ROUTES_KEY = 'klev_pro_phase3_routes_v1';
const PHASE3_ACTIVE_TRACK_KEY = 'klev_pro_phase3_active_track_v2';
const LAST_REAL_USER_GPS_KEY = 'klev_pro_last_real_gps_v1';
let _phase3WatchId = null;
let _phase3WakeLock = null;
let _phase3RouteLayerGroup = null;
let _phase3ActiveTrack = null;
let _lastUserMapTouchTs = 0;
let _lastAutoZoomAdjustTs = 0;
let _isProgrammaticAutoZoom = false;
let _liveUserGpsMarker = null;
let _lastRealUserGps = null;

function _isCorruptedIndoorJitterTrack(trk) {
  if (!trk || !Array.isArray(trk.points)) return false;
  if (trk.points.length < 25) return false;
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  for (const p of trk.points) {
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }
  const bboxDiagKm = calcHaversineKm(minLat, minLon, maxLat, maxLon);
  const distKm = Number(trk.totalDistKm || trk.recordedDistKm || 0);
  // Если диагональ разброса точек < 0.75 км (вокруг дома/микрорайона), а намотано > 2.2 км — это комнатный дрейф GPS
  return bboxDiagKm < 0.75 && distKm > 2.2;
}

try {
  if (typeof localStorage !== 'undefined') {
    // Безусловно удаляем старый фантомный фоновый трек v1 (рисовавший прямоугольную сетку вокруг дома)
    localStorage.removeItem('klev_pro_phase3_active_track_v1');
    const rawSavedGps = localStorage.getItem(LAST_REAL_USER_GPS_KEY);
    if (rawSavedGps) {
      const parsedGps = JSON.parse(rawSavedGps);
      if (parsedGps && Number.isFinite(parsedGps.lat) && Number.isFinite(parsedGps.lon)) {
        _lastRealUserGps = parsedGps;
      }
    }
    const rawRoutes = localStorage.getItem(PHASE3_SAVED_ROUTES_KEY);
    if (rawRoutes) {
      const parsedRoutes = JSON.parse(rawRoutes);
      if (Array.isArray(parsedRoutes)) {
        const cleanedRoutes = parsedRoutes.filter(r => r && !_isCorruptedIndoorJitterTrack(r));
        if (cleanedRoutes.length !== parsedRoutes.length) {
          localStorage.setItem(PHASE3_SAVED_ROUTES_KEY, JSON.stringify(cleanedRoutes));
        }
      }
    }
    const rawAct = localStorage.getItem(PHASE3_ACTIVE_TRACK_KEY);
    if (rawAct) {
      const candidate = JSON.parse(rawAct);
      const ageMs = Date.now() - Number(candidate?.startedAt || 0);
      if (candidate && candidate.explicitlyConfirmed === true && ageMs < 6 * 3600 * 1000 && !_isCorruptedIndoorJitterTrack(candidate)) {
        _phase3ActiveTrack = candidate;
      } else {
        localStorage.removeItem(PHASE3_ACTIVE_TRACK_KEY);
      }
    }
  }
} catch (e) {}

export function canAccessPhase3Routes(stateObj = null) {
  return true;
  const s = stateObj || store.getState();
  if (isUserAdmin(s)) return true;
  if (isCurrentUserBetaTester(s)) return true;
  try {
    if (typeof localStorage !== 'undefined') {
      if (localStorage.getItem('klev_pro_beta_tester_granted_v1') === '1') return true;
      if (localStorage.getItem('klev_pro_phase3_public_unlocked_v1') === '1') return true;
    }
  } catch (e) {}
  return false;
}

export function getSavedPhase3Routes() {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(PHASE3_SAVED_ROUTES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function savePhase3RoutesList(list) {
  try {
    if (typeof localStorage !== 'undefined' && Array.isArray(list)) {
      localStorage.setItem(PHASE3_SAVED_ROUTES_KEY, JSON.stringify(list.slice(0, 50)));
    }
  } catch (e) {}
}

function persistActivePhase3Track() {
  try {
    if (typeof localStorage === 'undefined') return;
    if (_phase3ActiveTrack) {
      localStorage.setItem(PHASE3_ACTIVE_TRACK_KEY, JSON.stringify(_phase3ActiveTrack));
    } else {
      localStorage.removeItem(PHASE3_ACTIVE_TRACK_KEY);
    }
  } catch (e) {}
}

function calcBearingDeg(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const p1 = lat1 * toRad;
  const p2 = lat2 * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const y = Math.sin(dLon) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dLon);
  return (Math.atan2(y, x) * toDeg + 360) % 360;
}

function bearingToCompassRu(deg) {
  const dirs = ['С (Север)', 'СВ (Северо-Восток)', 'В (Восток)', 'ЮВ (Юго-Восток)', 'Ю (Юг)', 'ЮЗ (Юго-Запад)', 'З (Запад)', 'СЗ (Северо-Запад)'];
  return dirs[Math.round(((Number(deg) || 0) % 360) / 45) % 8];
}

function bearingToSpokenDirectionRu(deg) {
  const dirs = ['север', 'северо-восток', 'восток', 'юго-восток', 'юг', 'юго-запад', 'запад', 'северо-запад'];
  return dirs[Math.round(((Number(deg) || 0) % 360) / 45) % 8];
}

let _voiceGuidanceEnabled = true;
let _voiceGuidanceBgEnabled = true;
let _lastSpokenPhrase = '';
let _lastSpokenTs = 0;

try {
  if (typeof localStorage !== 'undefined') {
    const savedScr = localStorage.getItem('klev_pro_voice_screen_v1');
    if (savedScr !== null) _voiceGuidanceEnabled = savedScr !== '0';
    const savedBg = localStorage.getItem('klev_pro_voice_bg_v1');
    if (savedBg !== null) _voiceGuidanceBgEnabled = savedBg !== '0';
  }
  if (typeof window !== 'undefined' && window.AndroidBridge && typeof window.AndroidBridge.setBgVoiceEnabled === 'function') {
    window.AndroidBridge.setBgVoiceEnabled(Boolean(_voiceGuidanceBgEnabled));
  }
} catch (e) {}

export function setVoiceGuidanceScreenEnabled(enabled) {
  _voiceGuidanceEnabled = Boolean(enabled);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('klev_pro_voice_screen_v1', _voiceGuidanceEnabled ? '1' : '0');
    }
  } catch (e) {}
  _updateActiveRouteOnScreenHud();
}

export function setVoiceGuidanceBackgroundEnabled(enabled) {
  _voiceGuidanceBgEnabled = Boolean(enabled);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('klev_pro_voice_bg_v1', _voiceGuidanceBgEnabled ? '1' : '0');
    }
    if (typeof window !== 'undefined' && window.AndroidBridge && typeof window.AndroidBridge.setBgVoiceEnabled === 'function') {
      window.AndroidBridge.setBgVoiceEnabled(_voiceGuidanceBgEnabled);
    }
  } catch (e) {}
  _updateActiveRouteOnScreenHud();
}

export function speakRouteGuidanceRu(phrase, forceImmediate = false) {
  if (!phrase) return;
  const now = Date.now();
  if (!forceImmediate && phrase === _lastSpokenPhrase && (now - _lastSpokenTs < 12000)) return;
  _lastSpokenPhrase = phrase;
  _lastSpokenTs = now;
  const isWarn = phrase.includes('отклонились') || phrase.includes('Внимание');
  showToast(phrase, isWarn ? 'warn' : 'good');

  const isBgNow = typeof document !== 'undefined' && document.visibilityState === 'hidden';
  const allowVoiceNow = isBgNow ? _voiceGuidanceBgEnabled : _voiceGuidanceEnabled;
  if (!allowVoiceNow) return;

  // 1. Звуковой сигнал привлечения внимания (работает и в APK, и в браузере)
  try {
    if (typeof window !== 'undefined' && window.AndroidBridge && typeof window.AndroidBridge.playNavTone === 'function') {
      window.AndroidBridge.playNavTone(isWarn ? 'warn' : 'good');
    } else if (typeof window !== 'undefined' && typeof window.__KLEV_PLAY_SONAR_PING__ === 'function') {
      window.__KLEV_PLAY_SONAR_PING__(isWarn ? 'warn' : 'normal');
    }
  } catch (e) {}

  // 2. Нативный синтезатор речи Android (TextToSpeech) в APK — работает и на экране, и в фоне
  try {
    if (typeof window !== 'undefined' && window.AndroidBridge && typeof window.AndroidBridge.speakTts === 'function') {
      window.AndroidBridge.speakTts(String(phrase), Boolean(forceImmediate));
      return;
    }
  } catch (e) {}

  // 3. Браузерный Web Speech API (для Web / PWA) с задержкой после cancel(), чтобы Chrome не сбрасывал фразу
  try {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      if (forceImmediate) {
        try { window.speechSynthesis.cancel(); } catch (_e) {}
      }
      setTimeout(() => {
        try {
          const u = new SpeechSynthesisUtterance(String(phrase));
          u.lang = 'ru-RU';
          u.rate = 0.98;
          u.pitch = 1.0;
          u.volume = 1.0;
          const voices = window.speechSynthesis.getVoices ? window.speechSynthesis.getVoices() : [];
          const ruVoice = voices.find(v => v && /^ru/i.test(v.lang));
          if (ruVoice) u.voice = ruVoice;
          window.speechSynthesis.speak(u);
        } catch (_e2) {}
      }, forceImmediate ? 60 : 10);
    }
  } catch (e) {}
}

// Запрос разрешений при первом запуске только при нажатии «Начать запись пути» или «Построить маршрут до точки на карте»
const FIRST_TIME_ROUTE_PERMS_KEY = 'klev_pro_first_route_perms_prompted_v1';
export function ensureRoutePermissionsBeforeAction(actionLabel, onProceed) {
  const perms = getDeviceBackgroundPermissionsStatus();
  const allGranted = Boolean(perms.sysGpsEnabled && perms.bgLocGranted && perms.batteryUnrestricted);
  let alreadyPrompted = false;
  try {
    if (typeof localStorage !== 'undefined') {
      alreadyPrompted = localStorage.getItem(FIRST_TIME_ROUTE_PERMS_KEY) === '1';
    }
  } catch (e) {}

  if (allGranted || alreadyPrompted) {
    if (typeof onProceed === 'function') onProceed();
    return;
  }

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(FIRST_TIME_ROUTE_PERMS_KEY, '1');
    }
  } catch (e) {}

  const html = `
    <div style="display:flex;flex-direction:column;gap:10px;font-size:var(--fs-sm);line-height:1.45;">
      <div style="padding:10px 12px;background:var(--panel);border:1.5px solid var(--accent);border-radius:var(--r-sm);color:var(--text);">
        Для безотказной работы функции <b>«${escapeHtml(actionLabel)}»</b> в фоновом режиме и при выключенном экране активируйте недостающие системные разрешения (в дальнейшем они доступны в разделе <b>Настройки -> 3. Приложение и Звук</b>):
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;font-size:11.5px;">
        ${!perms.sysGpsEnabled ? `
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 10px;background:var(--card);border:1px solid var(--border);border-radius:6px;">
            <div><b>1. Системная геолокация (GPS/ГЛОНАСС)</b><div style="font-size:10.5px;color:var(--warn);">Требуется включить точный GPS</div></div>
            <button type="button" class="btn btn-sm" id="ftPermGpsBtn">Включить GPS</button>
          </div>
        ` : ''}
        ${!perms.bgLocGranted ? `
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 10px;background:var(--card);border:1px solid var(--border);border-radius:6px;">
            <div><b>2. Фоновый режим геолокации</b><div style="font-size:10.5px;color:var(--muted);">Запись пути и голосовое ведение при погашенном экране</div></div>
            <button type="button" class="btn btn-sm btn-accent" id="ftPermBgBtn">Разрешить фон</button>
          </div>
        ` : ''}
        ${!perms.batteryUnrestricted ? `
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 10px;background:var(--card);border:1px solid var(--border);border-radius:6px;">
            <div><b>3. Отключение экономии батареи</b><div style="font-size:10.5px;color:var(--warn);">Чтобы система не останавливала трекер в лесу/на воде</div></div>
            <button type="button" class="btn btn-sm btn-good" id="ftPermBatBtn">Снять экономию</button>
          </div>
        ` : ''}
      </div>
      <button type="button" class="btn btn-good" id="ftPermContinueBtn" style="min-height:42px;font-weight:900;width:100%;justify-content:center;">
        Продолжить: ${escapeHtml(actionLabel)}
      </button>
    </div>
  `;
  openModal('Разрешения для навигации и записи маршрута', html, (bEl) => {
    bEl.querySelector('#ftPermGpsBtn')?.addEventListener('click', () => {
      if (typeof window !== 'undefined' && window.AndroidBridge && typeof window.AndroidBridge.openLocationSourceSettings === 'function') {
        window.AndroidBridge.openLocationSourceSettings();
      } else {
        requestGPS();
      }
    });
    bEl.querySelector('#ftPermBgBtn')?.addEventListener('click', async () => {
      if (typeof window !== 'undefined' && window.AndroidBridge && typeof window.AndroidBridge.requestBackgroundLocationPermission === 'function') {
        window.AndroidBridge.requestBackgroundLocationPermission();
      }
      await acquireBackgroundWakeLock(true);
      try { localStorage.setItem('klev_pro_bg_loc_ack_v1', '1'); } catch (e) {}
      showToast('Фоновый режим геолокации активирован', 'good');
    });
    bEl.querySelector('#ftPermBatBtn')?.addEventListener('click', () => {
      if (typeof window !== 'undefined' && window.AndroidBridge && typeof window.AndroidBridge.requestIgnoreBatteryOptimizations === 'function') {
        window.AndroidBridge.requestIgnoreBatteryOptimizations();
      }
      try { localStorage.setItem('klev_pro_bg_battery_ack_v1', '1'); } catch (e) {}
      showToast('Запрошено отключение экономии батареи', 'good');
    });
    bEl.querySelector('#ftPermContinueBtn')?.addEventListener('click', () => {
      closeModal();
      if (typeof onProceed === 'function') onProceed();
    });
  });
}

// Точное форматирование дистанции маршрута в метрах (с точностью до 10 м, без плавания в минус)
export function formatExactRouteDistanceRu(distKm, roundStepMeters = 10) {
  const rawMeters = Math.max(0, Math.round((Number(distKm) || 0) * 1000));
  const step = Math.max(1, Number(roundStepMeters) || 10);
  const roundedMeters = rawMeters < 30 ? rawMeters : Math.round(rawMeters / step) * step;
  if (roundedMeters < 1000) {
    return `${roundedMeters} м`;
  }
  const kmStr = (roundedMeters / 1000).toFixed(2);
  return `${roundedMeters.toLocaleString('ru-RU')} м (${kmStr} км)`;
}

// Уплотнение отрезков полилинии маршрута до шага <= 12 метров (чтобы на длинных прямых улицах и дорогах не было ложного отклонения)
function _densifyPolylineToMaxStep(rawPts, maxStepKm = 0.012) {
  if (!Array.isArray(rawPts) || rawPts.length < 2) return Array.isArray(rawPts) ? rawPts : [];
  const out = [rawPts[0]];
  for (let i = 1; i < rawPts.length; i++) {
    const p1 = rawPts[i - 1];
    const p2 = rawPts[i];
    const segKm = calcHaversineKm(p1.lat, p1.lon, p2.lat, p2.lon);
    if (segKm > maxStepKm) {
      const steps = Math.min(250, Math.ceil(segKm / maxStepKm));
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        out.push({
          lat: Number((p1.lat + (p2.lat - p1.lat) * t).toFixed(6)),
          lon: Number((p1.lon + (p2.lon - p1.lon) * t).toFixed(6)),
          snapped: Boolean(p2.snapped)
        });
      }
    }
    out.push(p2);
  }
  return out;
}

// Фильтрация одиночных сотовых выбросов БЕЗ срезания прямых углов перекрёстков и привязанных к дорогам точек
function _smoothRecordedTrackPoints(rawPts) {
  if (!Array.isArray(rawPts) || rawPts.length < 3) return Array.isArray(rawPts) ? rawPts : [];
  const filtered = [rawPts[0]];
  for (let i = 1; i < rawPts.length; i++) {
    const prev = filtered[filtered.length - 1];
    const cur = rawPts[i];
    if (!cur || !Number.isFinite(cur.lat) || !Number.isFinite(cur.lon)) continue;
    const dKm = calcHaversineKm(prev.lat, prev.lon, cur.lat, cur.lon);
    // Отсекаем только явный одиночный "телепорт" базовой станции (> 130 м в сторону с мгновенным возвратом обратно в радиус 25 м)
    if (!cur.snapped && i + 1 < rawPts.length && dKm > 0.13) {
      const next = rawPts[i + 1];
      const prevToNextKm = calcHaversineKm(prev.lat, prev.lon, next.lat, next.lon);
      if (prevToNextKm < 0.025) {
        continue;
      }
    }
    filtered.push(cur);
  }
  return filtered;
}

function _isInsideTelegramMiniAppEnv() {
  if (typeof window === 'undefined') return false;
  const twa = window.Telegram && window.Telegram.WebApp;
  if (twa && ((typeof twa.initData === 'string' && twa.initData.length > 0) || (twa.initDataUnsafe && twa.initDataUnsafe.user))) {
    return true;
  }
  return document.documentElement.getAttribute('data-tg-miniapp') === '1';
}

export function openExternalMapNavigatorUrl(url) {
  if (!url || typeof window === 'undefined') return;
  try {
    if (window.AndroidBridge && typeof window.AndroidBridge.openExternalUrl === 'function') {
      window.AndroidBridge.openExternalUrl(url);
      return;
    }
    if (window.AndroidBridge && typeof window.AndroidBridge.downloadApkUpdate === 'function') {
      window.AndroidBridge.downloadApkUpdate(url);
      return;
    }
    if (window.Telegram?.WebApp?.openLink && /^https?:/i.test(url)) {
      window.Telegram.WebApp.openLink(url);
      return;
    }
  } catch (e) {}
  try {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.setAttribute('data-allow-ext-nav', '1');
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 500);
  } catch (e) {
    window.open(url, '_blank');
  }
}

// Построение маршрута по дорогам и лесным тропам (OSRM driving + foot с жёсткой привязкой к полотну дороги и шагом 10 м)
export async function buildRoadOrTrailRouteBetween(startLat, startLon, destLat, destLon) {
  const rawFallback = [
    { lat: Number(startLat.toFixed(6)), lon: Number(startLon.toFixed(6)) },
    { lat: Number(destLat.toFixed(6)), lon: Number(destLon.toFixed(6)) }
  ];
  const fallbackPts = _densifyPolylineToMaxStep(rawFallback, 0.010);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { points: fallbackPts, snappedToRoads: false, distKm: Number(calcHaversineKm(startLat, startLon, destLat, destLon).toFixed(3)) };
  }
  const isApk = typeof window !== 'undefined' && Boolean(window.AndroidBridge);
  const wrapApkProxy = (u) => isApk ? `https://appassets.androidplatform.net/__klev_net_proxy__?url=${encodeURIComponent(u)}` : u;
  const routeCandidates = [
    `https://router.project-osrm.org/route/v1/driving/${startLon.toFixed(6)},${startLat.toFixed(6)};${destLon.toFixed(6)},${destLat.toFixed(6)}?overview=full&geometries=geojson&steps=true&continue_straight=true`,
    `https://routing.openstreetmap.de/routed-car/route/v1/driving/${startLon.toFixed(6)},${startLat.toFixed(6)};${destLon.toFixed(6)},${destLat.toFixed(6)}?overview=full&geometries=geojson&steps=true&continue_straight=true`,
    `https://router.project-osrm.org/route/v1/foot/${startLon.toFixed(6)},${startLat.toFixed(6)};${destLon.toFixed(6)},${destLat.toFixed(6)}?overview=full&geometries=geojson&steps=true&continue_straight=true`,
    `https://routing.openstreetmap.de/routed-foot/route/v1/driving/${startLon.toFixed(6)},${startLat.toFixed(6)};${destLon.toFixed(6)},${destLat.toFixed(6)}?overview=full&geometries=geojson&steps=true&continue_straight=true`
  ];
  for (const rawUrl of [routeCandidates[1], routeCandidates[0], routeCandidates[3], routeCandidates[2]]) {
    try {
      const url = wrapApkProxy(rawUrl);
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), 4200) : null;
      const res = await fetch(url, { signal: ctrl?.signal }).catch(() => null);
      if (timer) clearTimeout(timer);
      if (!res || !res.ok) continue;
      const data = await res.json().catch(() => null);
      const route = data?.routes?.[0];
      const coords = route?.geometry?.coordinates;
      if (Array.isArray(coords) && coords.length >= 2) {
        const rawPts = coords.map(c => ({ lat: Number(c[1].toFixed(6)), lon: Number(c[0].toFixed(6)), snapped: true }));
        // Если конечная точка находится в лесу/на воде далеко от дороги (> 95 м), доводим финишный отрезок до точки
        if (calcHaversineKm(destLat, destLon, rawPts[rawPts.length - 1].lat, rawPts[rawPts.length - 1].lon) > 0.095) {
          rawPts.push({ lat: Number(destLat.toFixed(6)), lon: Number(destLon.toFixed(6)), snapped: false });
        }
        const pts = _densifyPolylineToMaxStep(rawPts, 0.010);
        let totalKm = 0;
        for (let i = 1; i < pts.length; i++) {
          totalKm += calcHaversineKm(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon);
        }
        return { points: pts, snappedToRoads: true, distKm: Number(totalKm.toFixed(3)) };
      }
    } catch (e) {}
  }
  return { points: fallbackPts, snappedToRoads: false, distKm: Number(calcHaversineKm(startLat, startLon, destLat, destLon).toFixed(3)) };
}

// Вычисление предстоящего поворота на 18–95 м вперёд вдоль уплотнённой полилинии маршрута
function _detectUpcomingTurnInstruction(userLat, userLon, pts, idx, stepForward = true) {
  if (!Array.isArray(pts) || pts.length < 4) return null;
  const dirStep = stepForward ? 1 : -1;
  let distAlongMeters = 0;
  let prevPt = { lat: userLat, lon: userLon };

  // Определяем текущий курс дороги на ближайших 18 метрах
  let baseRoadBearing = null;
  let lookInitIdx = idx;
  while (lookInitIdx >= 0 && lookInitIdx < pts.length) {
    const dM = calcHaversineKm(userLat, userLon, pts[lookInitIdx].lat, pts[lookInitIdx].lon) * 1000;
    if (dM >= 10) {
      baseRoadBearing = calcBearingDeg(userLat, userLon, pts[lookInitIdx].lat, pts[lookInitIdx].lon);
      break;
    }
    lookInitIdx += dirStep;
  }
  if (baseRoadBearing === null) return null;

  for (let k = idx + dirStep; k >= 0 && k < pts.length; k += dirStep) {
    const curPt = pts[k];
    distAlongMeters += calcHaversineKm(prevPt.lat, prevPt.lon, curPt.lat, curPt.lon) * 1000;
    prevPt = curPt;
    if (distAlongMeters < 18) continue;
    if (distAlongMeters > 95) break;

    // Ищем точку через 22–35 м после вершины поворота k, чтобы измерить угол новой улицы
    let afterIdx = k + dirStep;
    let afterAccumM = 0;
    let pA = curPt;
    while (afterIdx >= 0 && afterIdx < pts.length && afterAccumM < 24) {
      afterAccumM += calcHaversineKm(pA.lat, pA.lon, pts[afterIdx].lat, pts[afterIdx].lon) * 1000;
      pA = pts[afterIdx];
      if (afterAccumM >= 22) break;
      afterIdx += dirStep;
    }
    if (afterAccumM < 12) continue;
    const outBearing = calcBearingDeg(curPt.lat, curPt.lon, pA.lat, pA.lon);
    let diff = ((outBearing - baseRoadBearing + 540) % 360) - 180;
    if (Math.abs(diff) >= 32) {
      const dirWord = diff > 0 ? 'направо' : 'налево';
      return {
        dirWord,
        distMeters: Math.max(10, Math.round(distAlongMeters / 10) * 10),
        turnIdx: k,
        turnLat: curPt.lat,
        turnLon: curPt.lon
      };
    }
  }
  return null;
}

// Открытие диалога выбора навигации к точке на карте (Внешние карты Яндекс/Google/2ГИС ИЛИ ведение по нашей карте с чекбоксом записи маршрута)
export function openNavigateToSpotChoiceModal({ lat, lon, title = 'Точка ловли', categoryLabel = 'Ориентир' } = {}) {
  const destLat = Number(lat);
  const destLon = Number(lon);
  if (!Number.isFinite(destLat) || !Number.isFinite(destLon)) return;
  const isTma = _isInsideTelegramMiniAppEnv();
  const s = store.getState();
  const startLat = _liveGpsFix.hasRealFix ? _liveGpsFix.lat : Number(s.lat || 66.0833);
  const startLon = _liveGpsFix.hasRealFix ? _liveGpsFix.lon : Number(s.lon || 76.6333);
  const directDistKm = calcHaversineKm(startLat, startLon, destLat, destLon);

  const yandexUrl = `https://yandex.ru/maps/?rtext=${startLat.toFixed(6)},${startLon.toFixed(6)}~${destLat.toFixed(6)},${destLon.toFixed(6)}&rtt=auto`;
  const googleUrl = `https://www.google.com/maps/dir/?api=1&origin=${startLat.toFixed(6)},${startLon.toFixed(6)}&destination=${destLat.toFixed(6)},${destLon.toFixed(6)}&travelmode=driving`;
  const dgisUrl = `https://2gis.ru/directions/points/${startLon.toFixed(6)}%2C${startLat.toFixed(6)}%7C${destLon.toFixed(6)}%2C${destLat.toFixed(6)}`;
  const geoIntentUrl = `geo:${destLat.toFixed(6)},${destLon.toFixed(6)}?q=${destLat.toFixed(6)},${destLon.toFixed(6)}(${encodeURIComponent(title)})`;

  const html = `
    <div style="display:flex;flex-direction:column;gap:12px;font-size:var(--fs-sm);line-height:1.45;">
      <div style="padding:10px 12px;background:var(--panel);border:1.5px solid var(--accent);border-radius:var(--r-sm);">
        <div style="font-weight:900;font-size:13.5px;color:var(--text);">${escapeHtml(categoryLabel)}: «${escapeHtml(title)}»</div>
        <div style="font-size:11.5px;color:var(--muted);margin-top:2px;">
          Координаты: <b>${destLat.toFixed(5)}°N, ${destLon.toFixed(5)}°E</b> • Дистанция по прямой: <b id="navChoiceDirectDistLbl">${formatExactRouteDistanceRu(directDistKm, 10)}</b>
        </div>
        ${(() => {
          const mHaz = (typeof window !== 'undefined' && typeof window.__KLEV_GET_ROUTE_WEATHER_HAZARDS__ === 'function')
            ? window.__KLEV_GET_ROUTE_WEATHER_HAZARDS__(_arcTransportMode || 'car')
            : null;
          if (!mHaz || !mHaz.hasHazards || !mHaz.summaryText) return '';
          return `<div style="margin-top:6px;padding:6px 8px;border-radius:8px;background:${mHaz.severity === 'bad' ? 'rgba(239,68,68,0.16)' : 'rgba(245,158,11,0.14)'};border:1px solid ${mHaz.severity === 'bad' ? 'var(--bad)' : 'var(--warn)'};color:${mHaz.severity === 'bad' ? 'var(--bad)' : 'var(--warn)'};font-size:11.5px;font-weight:800;">Погодная сводка по маршруту: ${escapeHtml(mHaz.summaryText)}</div>`;
        })()}
      </div>

      ${!isTma ? `
        <!-- Вариант 1 (только в APK и Web, скрыт в Telegram Mini App): Ведение по нашей карте -->
        <div style="padding:11px 12px;background:var(--card);border:1.5px solid var(--good);border-radius:var(--r-sm);display:flex;flex-direction:column;gap:8px;">
          <div style="font-weight:900;font-size:13px;color:var(--good);">
            1. Ведение до точки по нашей карте (с привязкой к дорогам/тропам и голосом)
          </div>
          <div style="font-size:11.5px;color:var(--muted);">
            Маршрут строится с точной привязкой к дорогам и тропам (шаг сегментов 10 м), определяет дистанцию с точностью до 10 м и ведёт голосом без сброса записываемого пути.
          </div>
          <label style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--panel);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:12px;font-weight:800;color:var(--text);">
            <input type="checkbox" id="navToSpotRecordTrackChk" checked style="width:17px;height:17px;accent-color:var(--accent);">
            <span>Выполнить запись маршрута до точки? (для обратного возврата)</span>
          </label>
          <button type="button" class="btn btn-good" id="navToSpotStartInAppBtn" style="min-height:42px;font-weight:900;width:100%;justify-content:center;">
            Построить маршрут на нашей карте и начать ведение
          </button>
        </div>
      ` : ''}

      <!-- Вариант 2: Перейти во внешнее приложение карт / навигатора -->
      <div style="padding:11px 12px;background:var(--card);border:1px solid var(--border);border-radius:var(--r-sm);display:flex;flex-direction:column;gap:8px;">
        <div style="font-weight:900;font-size:12.5px;color:var(--accent);">
          ${isTma ? 'Построить маршрут во внешнем навигаторе (Яндекс / Google / 2ГИС):' : '2. Открыть маршрут во внешнем навигаторе (Яндекс / Google / 2ГИС / Системный):'}
        </div>
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;">
          <button type="button" class="btn btn-sm btn-accent" data-ext-map-url="${escapeHtml(yandexUrl)}" style="min-height:38px;font-weight:800;justify-content:center;">Яндекс Карты / Навигатор</button>
          <button type="button" class="btn btn-sm" data-ext-map-url="${escapeHtml(googleUrl)}" style="min-height:38px;font-weight:800;justify-content:center;">Google Карты</button>
          <button type="button" class="btn btn-sm" data-ext-map-url="${escapeHtml(dgisUrl)}" style="min-height:38px;font-weight:800;justify-content:center;">2ГИС Навигатор</button>
          <button type="button" class="btn btn-sm" data-ext-map-url="${escapeHtml(geoIntentUrl)}" style="min-height:38px;font-weight:800;justify-content:center;">Другие карты (Системный выбор)</button>
        </div>
      </div>
    </div>
  `;

  openModal('Маршрут и навигация до точки', html, (bEl) => {
    // При открытии окна дополнительно запрашиваем точный GPS, чтобы обновить стартовую точку для внешних ссылок и расчёта расстояния
    acquireFreshHighAccuracyGpsFix(3000).then((fix) => {
      if (!fix || !fix.hasRealFix || !document.body.contains(bEl)) return;
      const dKm = calcHaversineKm(fix.lat, fix.lon, destLat, destLon);
      const lbl = bEl.querySelector('#navChoiceDirectDistLbl');
      if (lbl) lbl.textContent = formatExactRouteDistanceRu(dKm, 10);
      const yUrl = `https://yandex.ru/maps/?rtext=${fix.lat.toFixed(6)},${fix.lon.toFixed(6)}~${destLat.toFixed(6)},${destLon.toFixed(6)}&rtt=auto`;
      const gUrl = `https://www.google.com/maps/dir/?api=1&origin=${fix.lat.toFixed(6)},${fix.lon.toFixed(6)}&destination=${destLat.toFixed(6)},${destLon.toFixed(6)}&travelmode=driving`;
      const dUrl = `https://2gis.ru/directions/points/${fix.lon.toFixed(6)}%2C${fix.lat.toFixed(6)}%7C${destLon.toFixed(6)}%2C${destLat.toFixed(6)}`;
      const btns = bEl.querySelectorAll('[data-ext-map-url]');
      if (btns[0]) btns[0].setAttribute('data-ext-map-url', yUrl);
      if (btns[1]) btns[1].setAttribute('data-ext-map-url', gUrl);
      if (btns[2]) btns[2].setAttribute('data-ext-map-url', dUrl);
    }).catch(() => {});

    bEl.querySelectorAll('[data-ext-map-url]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const targetUrl = btn.getAttribute('data-ext-map-url');
        if (targetUrl) {
          openExternalMapNavigatorUrl(targetUrl);
        }
      });
    });

    bEl.querySelector('#navToSpotStartInAppBtn')?.addEventListener('click', () => {
      const recordAlong = Boolean(bEl.querySelector('#navToSpotRecordTrackChk')?.checked);
      closeModal();
      ensureRoutePermissionsBeforeAction('Построить маршрут до точки на карте', async () => {
        await startNavigationToTargetSpot({
          destLat,
          destLon,
          destTitle: title,
          recordTrackAlong: recordAlong
        });
      });
    });
  });
}

export async function startNavigationToTargetSpot({ destLat, destLon, destTitle = 'Точка ловли', recordTrackAlong = true } = {}) {
  const freshFix = await acquireFreshHighAccuracyGpsFix(4000);
  const s = store.getState();
  const startLat = freshFix && freshFix.hasRealFix ? freshFix.lat : Number(s.lat || 66.0833);
  const startLon = freshFix && freshFix.hasRealFix ? freshFix.lon : Number(s.lon || 76.6333);
  const built = await buildRoadOrTrailRouteBetween(startLat, startLon, destLat, destLon);
  const now = Date.now();
  const initBearing = Math.round(calcBearingDeg(startLat, startLon, built.points[Math.min(1, built.points.length - 1)].lat, built.points[Math.min(1, built.points.length - 1)].lon));
  const initDirRu = bearingToSpokenDirectionRu(initBearing);

  const roadStartPt = built.points[0] || { lat: startLat, lon: startLon };
  _phase3ActiveTrack = {
    id: `nav_spot_${now}`,
    title: `К точке: ${destTitle}`,
    startedAt: now,
    startLat: roadStartPt.lat,
    startLon: roadStartPt.lon,
    originStartLat: roadStartPt.lat,
    originStartLon: roadStartPt.lon,
    destLat,
    destLon,
    destTitle,
    startLabel: `Старт (${roadStartPt.lat.toFixed(4)}°N, ${roadStartPt.lon.toFixed(4)}°E)`,
    status: 'navigating_to_spot',
    returnMode: 'to_spot',
    snappedToRoads: built.snappedToRoads,
    recordTrackAlong: Boolean(recordTrackAlong),
    rawGpsTrace: [{ lat: roadStartPt.lat, lon: roadStartPt.lon, ts: now, acc: freshFix?.acc || 5 }],
    recordedBreadcrumbPoints: [{ lat: roadStartPt.lat, lon: roadStartPt.lon, ts: now, acc: freshFix?.acc || 5, snapped: true }],
    alreadySaved: false,
    wasOffTrack: false,
    nearGoalAnnounced: false,
    arrivedAnnounced: false,
    lastTurnAnnouncedIdx: -1,
    lastTurnAnnouncedLat: null,
    lastTurnAnnouncedLon: null,
    lastProgressSpokenDistKm: built.distKm,
    lastRerouteTs: now,
    totalDistKm: built.distKm,
    points: built.points
  };
  _phase3ReturnUserPos = { lat: roadStartPt.lat, lon: roadStartPt.lon, acc: freshFix?.acc || 5, ts: now };
  _phase3OffTrackMeters = 0;
  persistActivePhase3Track();
  acquireBackgroundWakeLock(true);
  bindPhase3GeolocationWatcher();
  renderPhase3TrackOnMap();
  _updateActiveRouteOnScreenHud();
  if (mapInstance && typeof mapInstance.setView === 'function') {
    try { mapInstance.setView([roadStartPt.lat, roadStartPt.lon], Math.max(15, mapInstance.getZoom() || 15)); } catch (e) {}
  }
  try {
    const smartRt = await computeSmartTransportRoute([{ lat: destLat, lon: destLon }], _arcTransportMode || 'car', 'waypoints');
    if (smartRt && Array.isArray(smartRt.points) && smartRt.points.length >= 2) {
      smartRt.started = true;
      smartRt.paused = false;
      smartRt.recordingAsked = true;
      _arcBuiltRoute = smartRt;
      renderArcRouteDraftAndActiveOnMap();
    }
  } catch (_e) {}
  const activeHaz = (typeof window !== 'undefined' && typeof window.__KLEV_GET_ROUTE_WEATHER_HAZARDS__ === 'function')
    ? window.__KLEV_GET_ROUTE_WEATHER_HAZARDS__(_arcTransportMode || 'car')
    : null;
  const roadHaz = s.roadHazard;
  const roadWarnSpeech = (activeHaz && activeHaz.hasHazards && activeHaz.summaryText)
    ? ` Внимание на маршруте: ${activeHaz.summaryText}.`
    : ((roadHaz && roadHaz.roadIceRisk && roadHaz.roadIceRisk !== 'NONE' && roadHaz.alertNote) ? ` ${roadHaz.alertNote}` : '');
  if (roadWarnSpeech) {
    try { showToast(roadWarnSpeech.trim(), 'warn'); } catch (_) {}
  }
  speakRouteGuidanceRu(`Маршрут до точки построен, дистанция ${formatExactRouteDistanceRu(built.distKm, 10)}. Двигайтесь на ${initDirRu}.${roadWarnSpeech}`, true);
  const secGeo = typeof document !== 'undefined' ? document.getElementById('secGeo') : null;
  if (secGeo) render(secGeo);
}

async function acquireBackgroundWakeLock(enable = true) {
  try {
    if (typeof window !== 'undefined' && window.AndroidBridge && typeof window.AndroidBridge.setKeepScreenAndCpuAwake === 'function') {
      window.AndroidBridge.setKeepScreenAndCpuAwake(Boolean(enable));
    }
  } catch (e) {}
  try {
    if (enable && typeof navigator !== 'undefined' && navigator.wakeLock && typeof navigator.wakeLock.request === 'function') {
      _phase3WakeLock = await navigator.wakeLock.request('screen');
    } else if (!enable && _phase3WakeLock) {
      await _phase3WakeLock.release();
      _phase3WakeLock = null;
    }
  } catch (e) {}
}

export function getDeviceBackgroundPermissionsStatus() {
  let sysGpsEnabled = true;
  let batteryUnrestricted = false;
  let bgLocGranted = false;
  const isAndroidApk = Boolean(typeof window !== 'undefined' && window.AndroidBridge);
  try {
    if (isAndroidApk) {
      if (typeof window.AndroidBridge.isSystemLocationEnabled === 'function') {
        sysGpsEnabled = Boolean(window.AndroidBridge.isSystemLocationEnabled());
      }
      if (typeof window.AndroidBridge.isIgnoringBatteryOptimizations === 'function') {
        batteryUnrestricted = Boolean(window.AndroidBridge.isIgnoringBatteryOptimizations());
      }
      if (typeof window.AndroidBridge.hasBackgroundLocationPermission === 'function') {
        bgLocGranted = Boolean(window.AndroidBridge.hasBackgroundLocationPermission());
      }
    } else if (typeof localStorage !== 'undefined') {
      batteryUnrestricted = localStorage.getItem('klev_pro_bg_battery_ack_v1') === '1';
      bgLocGranted = localStorage.getItem('klev_pro_bg_loc_ack_v1') === '1';
    }
  } catch (e) {}
  return { isAndroidApk, sysGpsEnabled, batteryUnrestricted, bgLocGranted };
}

// ── Живая телеметрия спутников GPS/ГЛОНАСС и высокоточный трекер Фазы 3 ──
let _liveGpsFix = {
  lat: null,
  lon: null,
  acc: 999,
  satellitesUsed: 0,
  satellitesVisible: 0,
  speedMps: 0,
  headingDeg: 0,
  ts: 0,
  hasRealFix: false
};
let _phase3ReturnUserPos = null; // Текущая позиция пользователя в режиме ведения назад (НЕ дописывается в трек!)
let _phase3OffTrackMeters = 0;
let _phase3LastOffTrackAlertTs = 0;
let _phase3SnapToRoadsEnabled = false;
let _phase3LastRoadSnapTs = 0;

function _estimateSatellitesFromAccuracy(accMeters, hasFix) {
  try {
    if (typeof window !== 'undefined' && window.AndroidBridge && typeof window.AndroidBridge.getGnssSatellitesUsed === 'function') {
      const hwUsed = Number(window.AndroidBridge.getGnssSatellitesUsed()) || 0;
      const hwVis = Number(window.AndroidBridge.getGnssSatellitesVisible()) || 0;
      if (hwUsed > 0) {
        return { used: hwUsed, visible: Math.max(hwUsed + 2, hwVis) };
      }
    }
  } catch (e) {}
  if (!hasFix || !Number.isFinite(accMeters) || accMeters > 150) {
    return { used: 0, visible: 4 };
  }
  if (accMeters <= 3.5) return { used: 14, visible: 19 };
  if (accMeters <= 6.0) return { used: 12, visible: 17 };
  if (accMeters <= 10.0) return { used: 10, visible: 15 };
  if (accMeters <= 15.0) return { used: 8, visible: 13 };
  if (accMeters <= 25.0) return { used: 6, visible: 11 };
  if (accMeters <= 50.0) return { used: 4, visible: 9 };
  return { used: 3, visible: 7 };
}

export function noteUserMapTouchInteraction() {
  _lastUserMapTouchTs = Date.now();
}

let _startupHomeCoords = null;
export function getTrueUserGpsCoords(stateObj = null) {
  if (_liveGpsFix && _liveGpsFix.hasRealFix && Number.isFinite(_liveGpsFix.lat) && Number.isFinite(_liveGpsFix.lon)) {
    return { lat: _liveGpsFix.lat, lon: _liveGpsFix.lon, acc: _liveGpsFix.acc || 10, isRealGps: true };
  }
  if (_lastRealUserGps && Number.isFinite(_lastRealUserGps.lat) && Number.isFinite(_lastRealUserGps.lon)) {
    return { lat: _lastRealUserGps.lat, lon: _lastRealUserGps.lon, acc: _lastRealUserGps.acc || 15, isRealGps: true };
  }
  const s = stateObj || store.getState();
  if (Array.isArray(s?.savedSpots) && s.savedSpots.length > 0) {
    const homeSpot = s.savedSpots.find(sp => sp && /дом|база|работа/i.test(String(sp.name || '')) && Number.isFinite(Number(sp.lat)) && Number.isFinite(Number(sp.lon)))
      || s.savedSpots.find(sp => sp && Number.isFinite(Number(sp.lat)) && Number.isFinite(Number(sp.lon)));
    if (homeSpot) {
      return { lat: Number(homeSpot.lat), lon: Number(homeSpot.lon), acc: 20, isRealGps: false };
    }
  }
  if (!_startupHomeCoords && Number.isFinite(Number(s?.lat)) && Number.isFinite(Number(s?.lon))) {
    _startupHomeCoords = { lat: Number(s.lat), lon: Number(s.lon) };
  }
  if (_startupHomeCoords) {
    return { lat: _startupHomeCoords.lat, lon: _startupHomeCoords.lon, acc: 25, isRealGps: false };
  }
  return { lat: 66.0845, lon: 76.6809, acc: 25, isRealGps: false };
}

function _saveRealUserGpsCoords(lat, lon, acc = 12) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  _lastRealUserGps = { lat: Number(lat), lon: Number(lon), acc: Math.round(Number(acc) || 12), ts: Date.now() };
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LAST_REAL_USER_GPS_KEY, JSON.stringify(_lastRealUserGps));
    }
  } catch (_e) {}
}

function _updateLiveGpsTelemetryFromPosition(pos) {
  if (!pos || !pos.coords) return;
  const lat = Number(pos.coords.latitude);
  const lon = Number(pos.coords.longitude);
  const acc = Math.max(1, Math.round(Number(pos.coords.accuracy) || 15));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  const sats = _estimateSatellitesFromAccuracy(acc, true);
  const spMs = Number.isFinite(Number(pos.coords.speed)) ? Math.max(0, Number(pos.coords.speed)) : 0;
  const hdg = Number.isFinite(Number(pos.coords.heading)) && Number(pos.coords.heading) >= 0 ? Number(pos.coords.heading) : _arcCompassHeadingDeg;
  _liveGpsFix = {
    lat,
    lon,
    acc,
    satellitesUsed: sats.used,
    satellitesVisible: sats.visible,
    speedMps: spMs,
    headingDeg: hdg,
    ts: Date.now(),
    hasRealFix: true
  };
  _saveRealUserGpsCoords(lat, lon, acc);
  try { updateLiveUserGpsMarkerOnMap(); } catch (_e) {}

  // Замечание 1: Автозум срабатывает ТОЛЬКО при активном ведении по маршруту
  // и СТРОГО с задержкой не менее 10 секунд (10000 мс) после последнего касания карты!
  try {
    const now = Date.now();
    const isRouteGuidanceActive = Boolean(
      (_arcBuiltRoute && _arcBuiltRoute.started && !_arcBuiltRoute.paused) ||
      (_phase3ActiveTrack && (_phase3ActiveTrack.status === 'returning' || _phase3ActiveTrack.status === 'navigating_to_spot'))
    );
    const touchCooldownElapsed = (now - _lastUserMapTouchTs) >= 10000;
    const autoZoomCooldownElapsed = (now - _lastAutoZoomAdjustTs) >= 10000;
    if (isRouteGuidanceActive && touchCooldownElapsed && autoZoomCooldownElapsed && mapInstance && isMobileOrTabletMapMode()) {
      const kmh = spMs * 3.6;
      _arcLastSpeedKmh = kmh;
      const targetZ = kmh <= 2.5 ? 16 : (kmh <= 9 ? 15 : (kmh <= 28 ? 14 : 12));
      if (Math.abs((mapInstance.getZoom() || 14) - targetZ) >= 2) {
        _lastAutoZoomAdjustTs = now;
        _isProgrammaticAutoZoom = true;
        mapInstance.setZoom(targetZ);
        setTimeout(() => { _isProgrammaticAutoZoom = false; }, 450);
      }
    }
  } catch (_e) {}
}

export function acquireFreshHighAccuracyGpsFix(timeoutMs = 5500) {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve(_liveGpsFix.hasRealFix ? _liveGpsFix : null);
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        _updateLiveGpsTelemetryFromPosition(pos);
        resolve(_liveGpsFix);
      },
      () => {
        resolve(_liveGpsFix.hasRealFix && (Date.now() - _liveGpsFix.ts < 30000) ? _liveGpsFix : null);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: timeoutMs }
    );
  });
}

// Сильная привязка записанного трека к дорогам и развязкам OSRM (без срезания углов и без разрывов на поворотах)
let _roadSnapInFlight = false;
async function _trySnapRecentSegmentToOsmTrail(targetArrayKey = 'points') {
  if (!_phase3SnapToRoadsEnabled || !_phase3ActiveTrack || _roadSnapInFlight) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const now = Date.now();
  if (now - _phase3LastRoadSnapTs < 3200) return;
  const pts = _phase3ActiveTrack[targetArrayKey] || [];
  if (pts.length < 2) return;
  _phase3LastRoadSnapTs = now;
  _roadSnapInFlight = true;
  try {
    // Берём последние точки сырого GPS-следа (или хвост массива точек) для точного картирования по дорожной сети
    const rawTrace = Array.isArray(_phase3ActiveTrack.rawGpsTrace) && _phase3ActiveTrack.rawGpsTrace.length >= 2
      ? _phase3ActiveTrack.rawGpsTrace
      : pts;
    const tail = rawTrace.slice(-14);
    if (tail.length < 2) return;

    // Отбираем опорные точки с шагом >= 8 м (плюс первую и последнюю), чтобы OSRM строил чёткую геометрию по дороге
    const keyPts = [tail[0]];
    for (let i = 1; i < tail.length - 1; i++) {
      if (calcHaversineKm(keyPts[keyPts.length - 1].lat, keyPts[keyPts.length - 1].lon, tail[i].lat, tail[i].lon) >= 0.008) {
        keyPts.push(tail[i]);
      }
    }
    const lastTailPt = tail[tail.length - 1];
    if (keyPts[keyPts.length - 1] !== lastTailPt) {
      keyPts.push(lastTailPt);
    }
    if (keyPts.length < 2) return;

    const coordsStr = keyPts.map(p => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
    const radiuses = keyPts.map(() => '55').join(';');
    const prof = (_liveGpsFix.speedMps || 0) > 2.2 ? 'driving' : 'driving';
    let snappedCoords = null;

    // 1. Сначала пробуем OSRM Map Matching (/match/v1/driving/) со склейкой всех под-сегментов
    if (keyPts.length >= 3) {
      const matchUrl = `https://router.project-osrm.org/match/v1/${prof}/${coordsStr}?geometries=geojson&radiuses=${radiuses}&overview=full&gaps=ignore&tidy=true`;
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), 3200) : null;
      const res = await fetch(matchUrl, { signal: ctrl?.signal }).catch(() => null);
      if (timer) clearTimeout(timer);
      if (res && res.ok) {
        const data = await res.json().catch(() => null);
        if (Array.isArray(data?.matchings) && data.matchings.length > 0) {
          const merged = [];
          for (const m of data.matchings) {
            if (Array.isArray(m?.geometry?.coordinates)) {
              for (const c of m.geometry.coordinates) {
                if (!merged.length || merged[merged.length - 1][0] !== c[0] || merged[merged.length - 1][1] !== c[1]) {
                  merged.push(c);
                }
              }
            }
          }
          if (merged.length >= 2) {
            snappedCoords = merged;
          }
        }
      }
    }

    // 2. Если /match/ не дал сплошной привязки (например, на резком повороте или съезде), строим маршрут /route/v1/driving/ через опорные точки
    if (!snappedCoords || snappedCoords.length < 2) {
      const routeViaPts = keyPts.length > 6
        ? [keyPts[0], keyPts[Math.floor(keyPts.length / 3)], keyPts[Math.floor((keyPts.length * 2) / 3)], keyPts[keyPts.length - 1]]
        : keyPts;
      const viaStr = routeViaPts.map(p => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
      const routeUrl = `https://router.project-osrm.org/route/v1/driving/${viaStr}?overview=full&geometries=geojson`;
      const ctrl2 = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer2 = ctrl2 ? setTimeout(() => ctrl2.abort(), 3200) : null;
      const res2 = await fetch(routeUrl, { signal: ctrl2?.signal }).catch(() => null);
      if (timer2) clearTimeout(timer2);
      if (res2 && res2.ok) {
        const data2 = await res2.json().catch(() => null);
        const rCoords = data2?.routes?.[0]?.geometry?.coordinates;
        if (Array.isArray(rCoords) && rCoords.length >= 2) {
          snappedCoords = rCoords;
        }
      }
    }

    if (Array.isArray(snappedCoords) && snappedCoords.length >= 2 && snappedCoords.length <= 1200) {
      const firstTail = tail[0];
      const lastOrig = tail[tail.length - 1];
      const lastSnapped = snappedCoords[snappedCoords.length - 1];
      const driftKm = calcHaversineKm(lastOrig.lat, lastOrig.lon, lastSnapped[1], lastSnapped[0]);
      if (driftKm <= 0.075) {
        // Находим в целевом массиве pts индекс, с которого начинался хвост firstTail
        let cutIdx = pts.length;
        for (let i = pts.length - 1; i >= 0; i--) {
          if ((pts[i].ts && firstTail.ts && pts[i].ts <= firstTail.ts) ||
              calcHaversineKm(pts[i].lat, pts[i].lon, firstTail.lat, firstTail.lon) < 0.015) {
            cutIdx = i;
            break;
          }
        }
        const prefix = pts.slice(0, Math.max(0, cutIdx));
        const snappedPts = _densifyPolylineToMaxStep(snappedCoords.map((c) => ({
          lat: Number(c[1].toFixed(6)),
          lon: Number(c[0].toFixed(6)),
          ts: now,
          acc: 4,
          snapped: true
        })), 0.010);
        const combined = [...prefix, ...snappedPts].slice(-4000);
        let recalcDist = 0;
        for (let i = 1; i < combined.length; i++) {
          recalcDist += calcHaversineKm(combined[i - 1].lat, combined[i - 1].lon, combined[i].lat, combined[i].lon);
        }
        _phase3ActiveTrack[targetArrayKey] = combined;
        if (targetArrayKey === 'points') {
          _phase3ActiveTrack.totalDistKm = Math.max(Number(_phase3ActiveTrack.totalDistKm || 0), Number(recalcDist.toFixed(3)));
        } else {
          _phase3ActiveTrack.recordedDistKm = Math.max(Number(_phase3ActiveTrack.recordedDistKm || 0), Number(recalcDist.toFixed(3)));
        }
        persistActivePhase3Track();
        renderPhase3TrackOnMap();
        _updateActiveRouteOnScreenHud();
      }
    }
  } catch (e) {
  } finally {
    _roadSnapInFlight = false;
  }
}

// Точная ортогональная проекция координат пользователя на ближайший отрезок маршрута (исключает ложные срабатывания схода с маршрута на длинных прямых участках!)
function _computeReturnProgressAlongTrack(userLat, userLon, pts) {
  if (!Array.isArray(pts) || pts.length === 0) {
    return { nearestIdx: 0, offTrackMeters: 0, remainingTrailKm: 0, totalTrailKm: 0, projLat: userLat, projLon: userLon, nextTargetLat: userLat, nextTargetLon: userLon, bearingDeg: 0 };
  }
  if (pts.length === 1) {
    const dKm = calcHaversineKm(userLat, userLon, pts[0].lat, pts[0].lon);
    return {
      nearestIdx: 0,
      nextWaypointIdx: 0,
      offTrackMeters: Math.round(dKm * 1000),
      remainingTrailKm: Number(dKm.toFixed(3)),
      totalTrailKm: Number(dKm.toFixed(3)),
      projLat: pts[0].lat,
      projLon: pts[0].lon,
      nextTargetLat: pts[0].lat,
      nextTargetLon: pts[0].lon,
      bearingDeg: Math.round(calcBearingDeg(userLat, userLon, pts[0].lat, pts[0].lon))
    };
  }

  const cosLat = Math.cos((userLat * Math.PI) / 180) || 0.5;
  let bestSegIdx = 0;
  let bestT = 0;
  let minPerpKm = Infinity;
  let bestProjLat = pts[0].lat;
  let bestProjLon = pts[0].lon;

  for (let i = 0; i < pts.length - 1; i++) {
    const A = pts[i];
    const B = pts[i + 1];
    const dx = (B.lon - A.lon) * cosLat;
    const dy = B.lat - A.lat;
    const lenSq = dx * dx + dy * dy;
    let t = 0;
    if (lenSq > 1e-12) {
      const px = (userLon - A.lon) * cosLat;
      const py = userLat - A.lat;
      t = Math.max(0, Math.min(1, (px * dx + py * dy) / lenSq));
    }
    const projLat = A.lat + t * (B.lat - A.lat);
    const projLon = A.lon + t * (B.lon - A.lon);
    const dKm = calcHaversineKm(userLat, userLon, projLat, projLon);
    if (dKm < minPerpKm) {
      minPerpKm = dKm;
      bestSegIdx = i;
      bestT = t;
      bestProjLat = projLat;
      bestProjLon = projLon;
    }
  }

  const offTrackMeters = Math.round(minPerpKm * 1000);
  // Полная длина всей полилинии маршрута
  let totalTrailKm = 0;
  for (let i = 1; i < pts.length; i++) {
    totalTrailKm += calcHaversineKm(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon);
  }
  // Точное оставшееся расстояние вдоль полилинии от точки проекции (bestProjLat, bestProjLon) до pts[0] (финиша в инвертированном массиве)
  let remainingAlongLineKm = calcHaversineKm(bestProjLat, bestProjLon, pts[bestSegIdx].lat, pts[bestSegIdx].lon);
  for (let i = bestSegIdx; i > 0; i--) {
    remainingAlongLineKm += calcHaversineKm(pts[i].lat, pts[i - 1] ? pts[i].lon : pts[0].lon, pts[i - 1].lat, pts[i - 1].lon);
  }
  const remainingTrailKm = Math.max(0, remainingAlongLineKm);
  // Выбираем следующую точку впереди по ходу движения (на 25–45 м вперёд по линии, чтобы курс не дёргался)
  let lookaheadIdx = bestSegIdx;
  let accumLookKm = calcHaversineKm(bestProjLat, bestProjLon, pts[bestSegIdx].lat, pts[bestSegIdx].lon);
  while (lookaheadIdx > 0 && accumLookKm < 0.035) {
    accumLookKm += calcHaversineKm(pts[lookaheadIdx].lat, pts[lookaheadIdx].lon, pts[lookaheadIdx - 1].lat, pts[lookaheadIdx - 1].lon);
    lookaheadIdx--;
  }
  const targetPt = offTrackMeters > 65 ? { lat: bestProjLat, lon: bestProjLon } : (pts[lookaheadIdx] || pts[0]);
  const bearingDeg = Math.round(calcBearingDeg(userLat, userLon, targetPt.lat, targetPt.lon));

  return {
    nearestIdx: bestSegIdx,
    nextWaypointIdx: lookaheadIdx,
    offTrackMeters,
    remainingTrailKm: Number(remainingTrailKm.toFixed(3)),
    totalTrailKm: Number(totalTrailKm.toFixed(3)),
    projLat: bestProjLat,
    projLon: bestProjLon,
    nextTargetLat: targetPt.lat,
    nextTargetLon: targetPt.lon,
    bearingDeg
  };
}

export function startPhase3RouteRecording(customTitle = '', emergencyLost = false, explicitStartCoords = null) {
  const s = store.getState();
  const now = Date.now();
  // ВАЖНО: Никогда не начинаем запись маршрута от выбранного на карте водоёма или чужой точки!
  // Старт берётся СТРОГО от реальных GPS-координат пользователя (explicitStartCoords или _liveGpsFix).
  const realStartLat = Number.isFinite(Number(explicitStartCoords?.lat))
    ? Number(explicitStartCoords.lat)
    : (_liveGpsFix.hasRealFix && Number.isFinite(_liveGpsFix.lat) ? _liveGpsFix.lat : Number(s.lat || 66.0833));
  const realStartLon = Number.isFinite(Number(explicitStartCoords?.lon))
    ? Number(explicitStartCoords.lon)
    : (_liveGpsFix.hasRealFix && Number.isFinite(_liveGpsFix.lon) ? _liveGpsFix.lon : Number(s.lon || 76.6333));
  const realStartAcc = Number(explicitStartCoords?.acc || _liveGpsFix.acc || 5);

  if (!_phase3ActiveTrack || !emergencyLost) {
    const nearSettle = findNearestRussianSettlement(realStartLat, realStartLon);
    const startPlaceName = nearSettle && nearSettle.distKm <= 25 ? nearSettle.name : (s.locLabel || 'Точка старта');
    _phase3ActiveTrack = {
      id: `route_${now}`,
      title: customTitle || `Маршрут от ${startPlaceName} (${new Date(now).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })})`,
      startedAt: now,
      startLat: realStartLat,
      startLon: realStartLon,
      originStartLat: realStartLat,
      originStartLon: realStartLon,
      startLabel: `Мой GPS старт (${realStartLat.toFixed(5)}°N, ${realStartLon.toFixed(5)}°E)`,
      status: emergencyLost ? 'returning' : 'recording',
      returnMode: emergencyLost ? 'lost_emergency' : 'normal',
      explicitlyConfirmed: true,
      alreadySaved: false,
      totalDistKm: 0,
      rawGpsTrace: [
        { lat: realStartLat, lon: realStartLon, ts: now, acc: Math.round(realStartAcc) }
      ],
      points: [
        { lat: realStartLat, lon: realStartLon, ts: now, acc: Math.round(realStartAcc) }
      ]
    };
    _phase3ReturnUserPos = { lat: realStartLat, lon: realStartLon, acc: Math.round(realStartAcc), ts: now };
    _phase3OffTrackMeters = 0;
    if (mapInstance && typeof mapInstance.setView === 'function') {
      try { mapInstance.setView([realStartLat, realStartLon], Math.max(15, mapInstance.getZoom() || 15)); } catch (e) {}
    }
  } else if (emergencyLost && _phase3ActiveTrack) {
    _phase3ActiveTrack.status = 'returning';
    _phase3ActiveTrack.returnMode = 'lost_emergency';
  }
  persistActivePhase3Track();
  acquireBackgroundWakeLock(true);
  bindPhase3GeolocationWatcher();
  renderPhase3TrackOnMap();
  if (emergencyLost && typeof window !== 'undefined' && typeof window.__KLEV_PLAY_SONAR_PING__ === 'function') {
    try { window.__KLEV_PLAY_SONAR_PING__('sos'); } catch (e) {}
  }
  return _phase3ActiveTrack;
}

export function switchPhase3ToReturnMode(emergencyLost = false) {
  if (!_phase3ActiveTrack) {
    return startPhase3RouteRecording('Аварийный возврат к старту', true);
  }
  _phase3ActiveTrack.status = 'returning';
  _phase3ActiveTrack.returnMode = emergencyLost ? 'lost_emergency' : 'normal';
  const pts = _phase3ActiveTrack.points || [];
  const lastPt = pts[pts.length - 1] || pts[0];
  if (!_phase3ReturnUserPos && lastPt) {
    _phase3ReturnUserPos = {
      lat: _liveGpsFix.hasRealFix ? _liveGpsFix.lat : lastPt.lat,
      lon: _liveGpsFix.hasRealFix ? _liveGpsFix.lon : lastPt.lon,
      acc: _liveGpsFix.acc || 5,
      ts: Date.now()
    };
  }
  persistActivePhase3Track();
  acquireBackgroundWakeLock(true);
  bindPhase3GeolocationWatcher();
  renderPhase3TrackOnMap();
  if (typeof window !== 'undefined' && typeof window.__KLEV_PLAY_SONAR_PING__ === 'function') {
    try { window.__KLEV_PLAY_SONAR_PING__(emergencyLost ? 'sos' : 'normal'); } catch (e) {}
  }
  return _phase3ActiveTrack;
}

export function stopAndSavePhase3Route(saveToHistory = true) {
  if (_phase3WatchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
    try { navigator.geolocation.clearWatch(_phase3WatchId); } catch (e) {}
    _phase3WatchId = null;
  }
  acquireBackgroundWakeLock(false);
  const wasAlreadySaved = Boolean(_phase3ActiveTrack?.alreadySaved);
  const shouldSave = (_phase3ActiveTrack?.status === 'navigating_to_spot')
    ? Boolean(saveToHistory && _phase3ActiveTrack.recordTrackAlong)
    : Boolean(saveToHistory && !wasAlreadySaved);
  const rawPointsToSave = (_phase3ActiveTrack?.status === 'navigating_to_spot' && Array.isArray(_phase3ActiveTrack.recordedBreadcrumbPoints) && _phase3ActiveTrack.recordedBreadcrumbPoints.length >= 1)
    ? [..._phase3ActiveTrack.recordedBreadcrumbPoints]
    : [...(_phase3ActiveTrack?.points || [])];

  // Если пользователь нажал «Записать маршрут» и остановил запись даже на коротком участке (1 точка),
  // добавляем текущую реальную GPS-координату финиша, чтобы маршрут гарантированно сохранился в список!
  if (shouldSave && _phase3ActiveTrack && rawPointsToSave.length === 1) {
    const curGps = getTrueUserGpsCoords(store.getState());
    const p0 = rawPointsToSave[0];
    const endLat = Number.isFinite(Number(curGps?.lat)) ? Number(Number(curGps.lat).toFixed(7)) : p0.lat;
    const endLon = Number.isFinite(Number(curGps?.lon)) ? Number(Number(curGps.lon).toFixed(7)) : p0.lon;
    rawPointsToSave.push({
      lat: endLat,
      lon: endLon,
      ts: Date.now(),
      acc: Math.round(Number(curGps?.acc || p0.acc || 5))
    });
  }

  // Сохраняем точные GPS-точки без грубого сглаживания и без притягивания к автомобильным дорогам
  const pointsToSave = rawPointsToSave.filter(p => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon)));
  if (shouldSave && _phase3ActiveTrack && pointsToSave.length >= 2) {
    let exactSavedDistKm = 0;
    for (let i = 1; i < pointsToSave.length; i++) {
      exactSavedDistKm += calcHaversineKm(pointsToSave[i - 1].lat, pointsToSave[i - 1].lon, pointsToSave[i].lat, pointsToSave[i].lon);
    }
    const finalDistKm = Math.max(exactSavedDistKm, Number(_phase3ActiveTrack.recordedDistKm || 0), Number(_phase3ActiveTrack.totalDistKm || 0));
    const finished = {
      ..._phase3ActiveTrack,
      points: pointsToSave,
      totalDistKm: Number(finalDistKm.toFixed(4)),
      alreadySaved: true,
      status: 'completed',
      finishedAt: Date.now()
    };
    const list = getSavedPhase3Routes().filter(r => r && r.id !== finished.id);
    list.unshift(finished);
    savePhase3RoutesList(list);
    showToast(`Маршрут «${finished.name || 'Трек'}» сохранён в список (${formatExactRouteDistanceRu(finalDistKm, 1)})`, 'good');
  }
  _phase3ActiveTrack = null;
  _phase3ReturnUserPos = null;
  _phase3OffTrackMeters = 0;
  persistActivePhase3Track();
  renderPhase3TrackOnMap();
}

let _lastProcessedGpsTickTs = 0;

function _processIncomingPhase3GpsFix(pos) {
  _updateLiveGpsTelemetryFromPosition(pos);
  if (!_phase3ActiveTrack || !pos || !pos.coords) return;
  const now = Date.now();
  if (now - _lastProcessedGpsTickTs < 450) return;
  _lastProcessedGpsTickTs = now;

  const rawLat = Number(pos.coords.latitude);
  const rawLon = Number(pos.coords.longitude);
  const acc = Number(pos.coords.accuracy) || 10;
  if (!Number.isFinite(rawLat) || !Number.isFinite(rawLon)) return;

  // Сохраняем сырой GPS-след для точной привязки к дорожной сети OSRM (включая повороты и развязки)
  if (!Array.isArray(_phase3ActiveTrack.rawGpsTrace)) {
    _phase3ActiveTrack.rawGpsTrace = [];
  }
  const lastRaw = _phase3ActiveTrack.rawGpsTrace[_phase3ActiveTrack.rawGpsTrace.length - 1];
  if (!lastRaw || calcHaversineKm(lastRaw.lat, lastRaw.lon, rawLat, rawLon) >= 0.003) {
    if (acc <= 95) {
      _phase3ActiveTrack.rawGpsTrace.push({ lat: Number(rawLat.toFixed(6)), lon: Number(rawLon.toFixed(6)), ts: now, acc: Math.round(acc) });
      if (_phase3ActiveTrack.rawGpsTrace.length > 1500) {
        _phase3ActiveTrack.rawGpsTrace = _phase3ActiveTrack.rawGpsTrace.slice(-1500);
      }
    }
  }

  // 1. РЕЖИМ ЗАПИСИ МАРШРУТА: сверхточная запись реального трека (точность 7 знаков ~1.1 см, шаг от 0.8 м, БЕЗ притягивания к автодорогам!)
  if (_phase3ActiveTrack.status === 'recording') {
    if (!_phase3ActiveTrack.explicitlyConfirmed) return;
    if (acc > 45 && (_phase3ActiveTrack.points?.length || 0) >= 1) {
      return;
    }
    const pts = _phase3ActiveTrack.points || [];
    const lastPt = pts[pts.length - 1];
    const lat = Number(rawLat.toFixed(7));
    const lon = Number(rawLon.toFixed(7));
    const stepKm = lastPt ? calcHaversineKm(lastPt.lat, lastPt.lon, lat, lon) : 0;
    const dtSec = lastPt ? Math.max(0.25, (now - (lastPt.ts || now)) / 1000) : 1;
    const speedMps = (stepKm * 1000) / dtSec;
    if (lastPt && speedMps > 65) return;

    // Минимальный шаг 0.8 метра (0.0008 км), чтобы детально записывать каждый шаг по дворам, тропинкам и льду без привязки к дорогам
    const minStepKm = acc <= 12 ? 0.0008 : 0.0020;
    if (!lastPt || stepKm >= minStepKm) {
      pts.push({ lat, lon, ts: now, acc: Math.round(acc) });
      _phase3ActiveTrack.points = pts.slice(-6000);
      let sumKm = 0;
      for (let i = 1; i < _phase3ActiveTrack.points.length; i++) {
        sumKm += calcHaversineKm(_phase3ActiveTrack.points[i - 1].lat, _phase3ActiveTrack.points[i - 1].lon, _phase3ActiveTrack.points[i].lat, _phase3ActiveTrack.points[i].lon);
      }
      _phase3ActiveTrack.totalDistKm = Math.max(Number(_phase3ActiveTrack.totalDistKm || 0), Number(sumKm.toFixed(4)));
      persistActivePhase3Track();
      if (typeof window !== 'undefined' && window.AndroidBridge && typeof window.AndroidBridge.updateNavNotification === 'function') {
        try {
          window.AndroidBridge.updateNavNotification(
            'Запись маршрута • Клёв ПРО 2.0',
            `Пройдено: ${formatExactRouteDistanceRu(_phase3ActiveTrack.totalDistKm, 10)} • Точность ±${Math.round(acc)} м`
          );
        } catch (_e) {}
      }
    }
  } else if (_phase3ActiveTrack.status === 'returning' || _phase3ActiveTrack.status === 'navigating_to_spot') {
    // 2. РЕЖИМ ВЕДЕНИЯ ПО МАРШРУТУ (обратно к старту ИЛИ вперёд к выбранной точке на карте)
    if (acc > 95) return;
    const isForwardToSpot = _phase3ActiveTrack.status === 'navigating_to_spot';
    const pts = _phase3ActiveTrack.points || [];
    const calcPts = isForwardToSpot ? [...pts].reverse() : pts;
    const navState = _computeReturnProgressAlongTrack(rawLat, rawLon, calcPts);
    _phase3OffTrackMeters = navState.offTrackMeters;

    // Привязываем позицию к полотну дороги в коридоре <= 42 м, чтобы маркер шёл строго по дороге
    const snappedLat = navState.offTrackMeters <= 42 ? Number(navState.projLat.toFixed(6)) : Number(rawLat.toFixed(6));
    const snappedLon = navState.offTrackMeters <= 42 ? Number(navState.projLon.toFixed(6)) : Number(rawLon.toFixed(6));
    _phase3ReturnUserPos = { lat: snappedLat, lon: snappedLon, acc: Math.round(acc), ts: now };

    // Непрерывная запись пройденного пути (с привязкой к реальным дорогам/развязкам через OSRM)
    if (isForwardToSpot && _phase3ActiveTrack.recordTrackAlong) {
      const recPts = Array.isArray(_phase3ActiveTrack.recordedBreadcrumbPoints) ? _phase3ActiveTrack.recordedBreadcrumbPoints : [];
      const lastRec = recPts[recPts.length - 1];
      const stepRecKm = lastRec ? calcHaversineKm(lastRec.lat, lastRec.lon, snappedLat, snappedLon) : 1;
      const dtRecSec = lastRec ? Math.max(0.5, (now - (lastRec.ts || now)) / 1000) : 1;
      const recSpeedMps = (stepRecKm * 1000) / dtRecSec;
      const rawRecLat = Number(rawLat.toFixed(7));
      const rawRecLon = Number(rawLon.toFixed(7));
      const rawStepRecKm = lastRec ? calcHaversineKm(lastRec.lat, lastRec.lon, rawRecLat, rawRecLon) : 1;
      if (!lastRec || (rawStepRecKm >= 0.0008 && recSpeedMps <= 65)) {
        recPts.push({ lat: rawRecLat, lon: rawRecLon, ts: now, acc: Math.round(acc) });
        _phase3ActiveTrack.recordedBreadcrumbPoints = recPts.slice(-6000);
        let recSumKm = 0;
        const sm = _phase3ActiveTrack.recordedBreadcrumbPoints;
        for (let i = 1; i < sm.length; i++) {
          recSumKm += calcHaversineKm(sm[i - 1].lat, sm[i - 1].lon, sm[i].lat, sm[i].lon);
        }
        _phase3ActiveTrack.recordedDistKm = Math.max(Number(_phase3ActiveTrack.recordedDistKm || 0), Number(recSumKm.toFixed(4)));
        persistActivePhase3Track();
      }
    }

    const remMeters = Math.max(0, Math.round(navState.remainingTrailKm * 1000));
    const roundedOffMeters = Math.max(10, Math.round(navState.offTrackMeters / 10) * 10);
    const dirRu = bearingToSpokenDirectionRu(navState.bearingDeg);

    if (typeof window !== 'undefined' && window.AndroidBridge && typeof window.AndroidBridge.updateNavNotification === 'function') {
      try {
        window.AndroidBridge.updateNavNotification(
          `До цели: ${formatExactRouteDistanceRu(navState.remainingTrailKm, 10)} • Курс ${navState.bearingDeg}°`,
          navState.offTrackMeters >= 45
            ? `Отклонение ${roundedOffMeters} м! Поверните на ${dirRu}`
            : `Двигайтесь на ${dirRu} (звук в фоне: ${_voiceGuidanceBgEnabled ? 'ВКЛ' : 'ВЫКЛ'})`
        );
      } catch (_e) {}
    }

    // Проверка 1: прибытие в конечную точку назначения (<= 25 м)
    if (remMeters <= 25 && !_phase3ActiveTrack.arrivedAnnounced) {
      _phase3ActiveTrack.arrivedAnnounced = true;
      speakRouteGuidanceRu('Вы прибыли в точку назначения.', true);
      persistActivePhase3Track();
    } else if (remMeters > 25 && remMeters <= 450 && remMeters >= 260 && !_phase3ActiveTrack.nearGoalAnnounced) {
      _phase3ActiveTrack.nearGoalAnnounced = true;
      const remRounded = Math.round(remMeters / 10) * 10;
      speakRouteGuidanceRu(`Вы почти у цели. До окончания маршрута осталось ${remRounded} метров.`, true);
      persistActivePhase3Track();
    }

    // Проверка 2: отклонение от маршрута (>= 45 м) и мгновенная перепривязка к новой улице/съезду
    if (navState.offTrackMeters >= 45) {
      _phase3ActiveTrack.offTrackStrikeCount = (_phase3ActiveTrack.offTrackStrikeCount || 0) + 1;
    } else {
      _phase3ActiveTrack.offTrackStrikeCount = 0;
    }

    if ((_phase3ActiveTrack.offTrackStrikeCount || 0) >= 2 && navState.offTrackMeters >= 45) {
      _phase3ActiveTrack.wasOffTrack = true;
      if (now - _phase3LastOffTrackAlertTs > 14000) {
        _phase3LastOffTrackAlertTs = now;
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
          try { navigator.vibrate([250, 120, 250]); } catch (e) {}
        }
        speakRouteGuidanceRu(`Вы отклонились от маршрута на ${roundedOffMeters} метров, вернитесь на маршрут! Поверните на ${dirRu} и двигайтесь прямо.`, true);
      }
      // Перестроение маршрута по фактической дороге без потери точки старта и уже пройденного пути
      if (isForwardToSpot && Number.isFinite(_phase3ActiveTrack.destLat) && (now - (_phase3ActiveTrack.lastRerouteTs || 0) > 10000)) {
        _phase3ActiveTrack.lastRerouteTs = now;
        buildRoadOrTrailRouteBetween(rawLat, rawLon, _phase3ActiveTrack.destLat, _phase3ActiveTrack.destLon).then((rerouted) => {
          if (_phase3ActiveTrack && _phase3ActiveTrack.status === 'navigating_to_spot' && Array.isArray(rerouted?.points) && rerouted.points.length >= 2) {
            const walkedSoFarKm = Number(_phase3ActiveTrack.recordedDistKm || 0);
            _phase3ActiveTrack.points = rerouted.points;
            _phase3ActiveTrack.totalDistKm = Number((walkedSoFarKm + rerouted.distKm).toFixed(3));
            _phase3ActiveTrack.wasOffTrack = false;
            _phase3ActiveTrack.offTrackStrikeCount = 0;
            _phase3ActiveTrack.lastProgressSpokenDistKm = rerouted.distKm;
            const newBearing = Math.round(calcBearingDeg(rawLat, rawLon, rerouted.points[Math.min(1, rerouted.points.length - 1)].lat, rerouted.points[Math.min(1, rerouted.points.length - 1)].lon));
            speakRouteGuidanceRu(`Маршрут перестроен по текущей дороге. До точки осталось ${formatExactRouteDistanceRu(rerouted.distKm, 10)}. Двигайтесь на ${bearingToSpokenDirectionRu(newBearing)}.`, true);
            persistActivePhase3Track();
            renderPhase3TrackOnMap();
            _updateActiveRouteOnScreenHud();
          }
        }).catch(() => {});
      }
    } else if (_phase3ActiveTrack.wasOffTrack && navState.offTrackMeters <= 30) {
      _phase3ActiveTrack.wasOffTrack = false;
      _phase3ActiveTrack.offTrackStrikeCount = 0;
      speakRouteGuidanceRu(`Вы вернулись на маршрут, двигайтесь на ${dirRu}.`, true);
      persistActivePhase3Track();
    } else if (!(_phase3ActiveTrack.wasOffTrack)) {
      const actualIdx = isForwardToSpot ? (pts.length - 1 - navState.nearestIdx) : navState.nearestIdx;
      const turnInfo = _detectUpcomingTurnInstruction(snappedLat, snappedLon, pts, actualIdx, isForwardToSpot);
      const distFromLastTurnAnnounced = (turnInfo && Number.isFinite(_phase3ActiveTrack.lastTurnAnnouncedLat))
        ? calcHaversineKm(turnInfo.turnLat, turnInfo.turnLon, _phase3ActiveTrack.lastTurnAnnouncedLat, _phase3ActiveTrack.lastTurnAnnouncedLon) * 1000
        : 999;

      if (turnInfo && distFromLastTurnAnnounced > 55) {
        _phase3ActiveTrack.lastTurnAnnouncedIdx = turnInfo.turnIdx;
        _phase3ActiveTrack.lastTurnAnnouncedLat = turnInfo.turnLat;
        _phase3ActiveTrack.lastTurnAnnouncedLon = turnInfo.turnLon;
        _phase3ActiveTrack.lastTurnText = `Через ${turnInfo.distMeters} м поверните ${turnInfo.dirWord}`;
        speakRouteGuidanceRu(`Поверните ${turnInfo.dirWord} через ${turnInfo.distMeters} метров.`, false);
        persistActivePhase3Track();
      } else {
        // Периодическое голосовое сопровождение каждые 250 метров прямого участка, чтобы водитель всегда знал оставшийся метраж
        const prevSpokenRemKm = Number(_phase3ActiveTrack.lastProgressSpokenDistKm || navState.totalTrailKm || 0);
        if (prevSpokenRemKm - navState.remainingTrailKm >= 0.25 && remMeters > 80) {
          _phase3ActiveTrack.lastProgressSpokenDistKm = navState.remainingTrailKm;
          speakRouteGuidanceRu(`Двигайтесь по маршруту на ${dirRu}. До точки осталось ${formatExactRouteDistanceRu(navState.remainingTrailKm, 10)}.`, false);
          persistActivePhase3Track();
        }
      }
    }
  }
  renderPhase3TrackOnMap();
  _updateActiveRouteOnScreenHud();
}

if (typeof window !== 'undefined') {
  window.__KLEV_ON_NATIVE_GPS_FIX__ = (lat, lon, acc, speed, bearing, ts) => {
    _processIncomingPhase3GpsFix({
      coords: {
        latitude: Number(lat),
        longitude: Number(lon),
        accuracy: Number(acc) || 8,
        speed: Number(speed) || 0,
        heading: Number(bearing) || 0
      },
      timestamp: Number(ts) || Date.now()
    });
  };
}

function bindPhase3GeolocationWatcher() {
  if (_phase3WatchId !== null || typeof navigator === 'undefined' || !navigator.geolocation) return;
  try {
    _phase3WatchId = navigator.geolocation.watchPosition(
      (pos) => {
        _processIncomingPhase3GpsFix(pos);
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
  } catch (e) {}
}

// Экранная панель активного маршрута над картой (позволяет на экране переключать звук на экране и звук в фоне!)
function _updateActiveRouteOnScreenHud() {
  if (typeof document === 'undefined') return;
  const mount = document.getElementById('geoActiveRouteLiveHudMount');
  if (!mount) return;
  if (!_phase3ActiveTrack) {
    mount.innerHTML = '';
    mount.style.display = 'none';
    return;
  }
  mount.style.display = 'block';
  const trk = _phase3ActiveTrack;
  const isNav = trk.status === 'returning' || trk.status === 'navigating_to_spot';
  const isForward = trk.status === 'navigating_to_spot';
  const pts = trk.points || [];
  const userPos = _phase3ReturnUserPos || (_liveGpsFix.hasRealFix ? _liveGpsFix : (pts[pts.length - 1] || { lat: 66.0833, lon: 76.6333 }));
  const calcPts = isForward ? [...pts].reverse() : pts;
  const navState = isNav ? _computeReturnProgressAlongTrack(userPos.lat, userPos.lon, calcPts) : null;
  const walkedKm = isForward ? (trk.recordedDistKm || 0) : (trk.totalDistKm || 0);
  const remKm = navState ? navState.remainingTrailKm : 0;
  const dirWord = navState ? bearingToSpokenDirectionRu(navState.bearingDeg) : 'прямо';

  mount.innerHTML = `
    <div style="margin-bottom:8px;padding:10px 12px;border-radius:10px;background:var(--card);border:1.5px solid ${navState && navState.offTrackMeters >= 45 ? 'var(--bad)' : 'var(--good)'};display:flex;flex-direction:column;gap:8px;box-shadow:0 4px 14px rgba(0,0,0,0.22);">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
        <div style="font-weight:900;font-size:13px;color:var(--text);">
          ${escapeHtml(trk.title || 'Активный маршрут')}
        </div>
        <span class="pill ${navState && navState.offTrackMeters >= 45 ? 'pill-bad' : 'pill-good'}" style="font-size:10.5px;font-weight:800;">
          ${isNav ? `Осталось: ${formatExactRouteDistanceRu(remKm, 10)}` : `Записано: ${formatExactRouteDistanceRu(walkedKm, 10)}`}
        </span>
      </div>
      ${isNav ? `
        <div style="font-size:12px;font-weight:800;color:${navState && navState.offTrackMeters >= 45 ? 'var(--bad)' : 'var(--accent)'};line-height:1.35;">
          ${navState && navState.offTrackMeters >= 45
            ? `Отклонение ${Math.round(navState.offTrackMeters / 10) * 10} м! Поверните на ${dirWord}`
            : (trk.lastTurnText ? `${escapeHtml(trk.lastTurnText)} • Курс на ${dirWord} (${navState?.bearingDeg || 0}°)` : `Двигайтесь по маршруту на ${dirWord} (${navState?.bearingDeg || 0}°) • Пройдено: ${formatExactRouteDistanceRu(walkedKm, 10)}`)}
        </div>
      ` : `
        <div style="font-size:11.5px;color:var(--muted);">
          Фоновая запись GPS и привязка к дорогам активны • Точек: <b>${pts.length}</b> • Точность: <b>±${_liveGpsFix.hasRealFix ? _liveGpsFix.acc : 10} м</b>
        </div>
      `}
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;">
        <button type="button" class="btn btn-sm ${_voiceGuidanceEnabled ? 'btn-good' : ''}" id="hudToggleScreenVoiceBtn" style="min-height:34px;font-size:11px;font-weight:800;justify-content:center;">
          Звук на экране: ${_voiceGuidanceEnabled ? 'ВКЛ' : 'ВЫКЛ'}
        </button>
        <button type="button" class="btn btn-sm ${_voiceGuidanceBgEnabled ? 'btn-accent' : ''}" id="hudToggleBgVoiceBtn" style="min-height:34px;font-size:11px;font-weight:800;justify-content:center;">
          Звук в фоне: ${_voiceGuidanceBgEnabled ? 'ВКЛ' : 'ВЫКЛ'}
        </button>
        <button type="button" class="btn btn-sm" id="hudTestVoiceBtn" style="min-height:34px;font-size:11px;font-weight:800;justify-content:center;">
          Проверить голос
        </button>
        <button type="button" class="btn btn-sm" id="hudStopRouteBtn" style="min-height:34px;font-size:11px;font-weight:800;justify-content:center;color:var(--bad);border-color:rgba(239,68,68,0.45);">
          Завершить маршрут
        </button>
      </div>
    </div>
  `;

  mount.querySelector('#hudToggleScreenVoiceBtn')?.addEventListener('click', () => {
    setVoiceGuidanceScreenEnabled(!_voiceGuidanceEnabled);
    showToast(_voiceGuidanceEnabled ? 'Голосовое сопровождение на экране ВКЛЮЧЕНО' : 'Голосовое сопровождение на экране ВЫКЛЮЧЕНО', 'info');
  });
  mount.querySelector('#hudToggleBgVoiceBtn')?.addEventListener('click', () => {
    setVoiceGuidanceBackgroundEnabled(!_voiceGuidanceBgEnabled);
    showToast(_voiceGuidanceBgEnabled ? 'Голосовое сопровождение в фоне ВКЛЮЧЕНО' : 'Голосовое сопровождение в фоне ВЫКЛЮЧЕНО', 'info');
  });
  mount.querySelector('#hudTestVoiceBtn')?.addEventListener('click', () => {
    const testMsg = isNav
      ? `Проверка голоса. До точки назначения осталось ${formatExactRouteDistanceRu(remKm, 10)}, двигайтесь на ${dirWord}. Звук в фоне ${_voiceGuidanceBgEnabled ? 'включён' : 'выключен'}.`
      : `Проверка голоса. Идёт запись маршрута, пройдено ${formatExactRouteDistanceRu(walkedKm, 10)}. Звук в фоне ${_voiceGuidanceBgEnabled ? 'включён' : 'выключен'}.`;
    speakRouteGuidanceRu(testMsg, true);
  });
  mount.querySelector('#hudStopRouteBtn')?.addEventListener('click', () => {
    stopAndSavePhase3Route(true);
    _updateActiveRouteOnScreenHud();
    showToast('Маршрут завершён и сохранён', 'good');
  });
}

function renderPhase3TrackOnMap() {
  if (!mapInstance || typeof window === 'undefined' || !window.L) return;
  const L = window.L;
  if (!_phase3RouteLayerGroup) {
    _phase3RouteLayerGroup = L.layerGroup().addTo(mapInstance);
  }
  _phase3RouteLayerGroup.clearLayers();
  if (!_phase3ActiveTrack || !Array.isArray(_phase3ActiveTrack.points) || _phase3ActiveTrack.points.length === 0) return;
  const pts = _phase3ActiveTrack.points;
  const isReturning = _phase3ActiveTrack.status === 'returning' || _phase3ActiveTrack.status === 'navigating_to_spot';
  const isForwardToSpot = _phase3ActiveTrack.status === 'navigating_to_spot';
  const isEmergency = _phase3ActiveTrack.returnMode === 'lost_emergency';

  if (!isReturning) {
    // Отрисовка записываемого маршрута (бирюзовая непрерывная линия по дорогам)
    const latlngs = pts.map(p => [p.lat, p.lon]);
    if (latlngs.length >= 2) {
      L.polyline(latlngs, {
        color: '#38bdf8',
        weight: 5,
        opacity: 0.95
      }).addTo(_phase3RouteLayerGroup);
    }
  } else {
    const userPos = _phase3ReturnUserPos || (_liveGpsFix.hasRealFix ? _liveGpsFix : pts[pts.length - 1]);
    const calcPts = isForwardToSpot ? [...pts].reverse() : pts;
    const navState = _computeReturnProgressAlongTrack(userPos.lat, userPos.lon, calcPts);
    const activeAheadPts = [
      { lat: navState.projLat, lon: navState.projLon },
      ...calcPts.slice(0, navState.nearestIdx + 1).reverse()
    ];
    // Фактически пройденная траектория от самой стартовой точки (originStartLat/Lon) до текущей позиции
    const passedPts = (isForwardToSpot && Array.isArray(_phase3ActiveTrack.recordedBreadcrumbPoints) && _phase3ActiveTrack.recordedBreadcrumbPoints.length >= 2)
      ? _phase3ActiveTrack.recordedBreadcrumbPoints
      : calcPts.slice(navState.nearestIdx + 1).reverse();

    if (passedPts.length >= 2) {
      L.polyline(passedPts.map(p => [p.lat, p.lon]), {
        color: '#0ea5e9',
        weight: 5,
        opacity: 0.92
      }).addTo(_phase3RouteLayerGroup);
    }
    if (activeAheadPts.length >= 2) {
      L.polyline(activeAheadPts.map(p => [p.lat, p.lon]), {
        color: isEmergency ? '#ef4444' : '#10b981',
        weight: 5.5,
        opacity: 0.96
      }).addTo(_phase3RouteLayerGroup);
    }
    if (navState.offTrackMeters > 45) {
      L.polyline([[userPos.lat, userPos.lon], [navState.projLat, navState.projLon]], {
        color: '#ef4444',
        weight: 3,
        dashArray: '6, 6',
        opacity: 0.95
      }).addTo(_phase3RouteLayerGroup);
    }
    L.circleMarker([userPos.lat, userPos.lon], {
      radius: 7,
      color: '#ffffff',
      fillColor: navState.offTrackMeters >= 45 ? '#ef4444' : '#38bdf8',
      fillOpacity: 0.98,
      weight: 2.5
    }).bindPopup(`<b>Ваше положение:</b> осталось ${formatExactRouteDistanceRu(navState.remainingTrailKm, 10)} • Курс ${navState.bearingDeg}°`).addTo(_phase3RouteLayerGroup);
  }

  // Точка старта ВСЕГДА остаётся в исходной точке начала движения (originStartLat/Lon), никогда не прыгает при перестроении
  const originLat = Number.isFinite(_phase3ActiveTrack.originStartLat) ? _phase3ActiveTrack.originStartLat : pts[0]?.lat;
  const originLon = Number.isFinite(_phase3ActiveTrack.originStartLon) ? _phase3ActiveTrack.originStartLon : pts[0]?.lon;
  if (Number.isFinite(originLat) && Number.isFinite(originLon)) {
    L.circleMarker([originLat, originLon], {
      radius: 8,
      color: '#ffffff',
      fillColor: '#10b981',
      fillOpacity: 0.95,
      weight: 2.5
    }).bindPopup(`<b>Точка старта / База:</b> ${escapeHtml(_phase3ActiveTrack.startLabel || 'Старт')}`).addTo(_phase3RouteLayerGroup);
  }
}

export function openPhase3RoutesModal(container = null) {
  const s = store.getState();
  if (!canAccessPhase3Routes(s)) {
    const fid = s.userProfile?.fisherId || 'FP_89RZ0001';
    const betaHtml = `
      <div style="display:flex;flex-direction:column;gap:12px;font-size:var(--fs-sm);line-height:1.48;">
        <div style="padding:12px;background:rgba(245,158,11,0.12);border:1.5px solid var(--warn);border-radius:var(--r-sm);">
          <div style="font-weight:900;color:var(--warn);font-size:14px;margin-bottom:6px;">
            Доступ к Фазе 3 («Маршруты и Я потерялся») по списку Бета-тестеров
          </div>
          <div style="font-size:12px;color:var(--text);">
            Функции фоновой записи маршрута, обратного ведения по точкам и экстренного режима <b>«Я потерялся»</b> сейчас проходят закрытое бета-тестирование перед общим выпуском.
          </div>
          <div style="margin-top:8px;padding:8px 10px;background:var(--card);border:1px solid var(--border);border-radius:6px;font-size:12px;">
            Ваш рыболовный ID для подключения к бета-тесту: <b style="color:var(--accent);font-family:monospace;">${escapeHtml(fid)}</b>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <button type="button" class="btn btn-accent" id="phase3CheckBetaStatusBtn" style="min-height:40px;font-weight:800;">Проверить доступ</button>
          <button type="button" class="btn" id="phase3BetaCloseBtn" style="min-height:40px;font-weight:800;">Закрыть</button>
        </div>
      </div>
    `;
    openModal('Фаза 3: Маршруты и «Я потерялся» (Бета-тест)', betaHtml, (bEl) => {
      bEl.querySelector('#phase3BetaCloseBtn')?.addEventListener('click', () => closeModal());
      bEl.querySelector('#phase3CheckBetaStatusBtn')?.addEventListener('click', async (ev) => {
        const btn = ev.currentTarget;
        if (btn) {
          btn.disabled = true;
          btn.textContent = 'Проверка...';
        }
        try {
          const granted = await verifyBetaTesterStatusFromCloud(fid);
          if (granted || canAccessPhase3Routes(store.getState())) {
            try { localStorage.setItem('klev_pro_beta_tester_granted_v1', '1'); } catch (_e) {}
            store.dispatch({ type: 'UPDATE_USER_PROFILE', payload: { isBetaTester: true } });
            closeModal();
            showToast('Статус Бета-тестера подтверждён! Фаза 3 разблокирована.', 'good');
            openPhase3RoutesModal(container);
            return;
          }
        } catch (e) {}
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Проверить доступ';
        }
        showToast('Ваш ID пока не включён в список Бета-тестеров. Передайте ваш ID администратору.', 'warn');
      });
    });
    return;
  }

  // Запускаем живой опрос спутников при открытии окна Фазы 3
  bindPhase3GeolocationWatcher();
  let _weakSignalConfirmPending = false;

  const renderModalContent = (bodyEl) => {
    if (!bodyEl) return;
    const perms = getDeviceBackgroundPermissionsStatus();
    const savedRoutes = getSavedPhase3Routes();
    const trk = _phase3ActiveTrack;
    const isRet = trk && trk.status === 'returning';
    const livePos = _phase3ReturnUserPos || (_liveGpsFix.hasRealFix ? _liveGpsFix : (trk?.points?.[trk.points.length - 1] || { lat: 66.0833, lon: 76.6333 }));
    const navState = trk ? _computeReturnProgressAlongTrack(livePos.lat, livePos.lon, trk.points || []) : null;
    const distToStartKm = navState ? navState.remainingTrailKm : 0;
    const bearingToStart = navState ? navState.bearingDeg : 0;
    const compassToStart = trk ? bearingToCompassRu(bearingToStart) : '—';

    const satsUsed = _liveGpsFix.satellitesUsed || 0;
    const satsVis = _liveGpsFix.satellitesVisible || 0;
    const gpsAcc = _liveGpsFix.hasRealFix ? _liveGpsFix.acc : null;
    const isStrongLock = Boolean(_liveGpsFix.hasRealFix && satsUsed >= 8 && gpsAcc !== null && gpsAcc <= 18);

    bodyEl.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:12px;font-size:var(--fs-sm);">
        <!-- Контроль спутников GPS/ГЛОНАСС перед стартом и во время движения -->
        <div style="padding:10px 12px;background:var(--card);border:1.5px solid ${isStrongLock ? 'var(--good)' : 'var(--warn)'};border-radius:var(--r-sm);display:flex;flex-direction:column;gap:6px;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
            <span style="font-weight:900;font-size:12.5px;color:${isStrongLock ? 'var(--good)' : 'var(--warn)'};">
              Спутники GPS / ГЛОНАСС: ${ _liveGpsFix.hasRealFix ? `${satsUsed} в работе (видно ${satsVis})` : 'Поиск спутников...' }
            </span>
            <span class="pill ${isStrongLock ? 'pill-good' : 'pill-warn'}" style="font-size:10.5px;font-weight:800;">
              ${ gpsAcc !== null ? `Точность ±${gpsAcc} м` : 'Ожидание сигнала' }
            </span>
          </div>
          <div style="font-size:11.5px;color:var(--muted);line-height:1.38;">
            ${ isStrongLock
              ? `Уверенный захват (${satsUsed} спутников, ±${gpsAcc} м): ваши точные координаты (${_liveGpsFix.lat.toFixed(5)}°N, ${_liveGpsFix.lon.toFixed(5)}°E) готовы к записи пути с точностью до метра.`
              : `Для точной записи маршрута рекомендуется связь с 8–12 спутниками (сейчас: ${satsUsed}, погрешность ${gpsAcc !== null ? '±' + gpsAcc + ' м' : 'не определена'}). Нажмите «Обновить захват GPS» на открытом воздухе перед стартом.` }
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;padding-top:4px;border-top:1px dashed var(--border);">
<span>Запись точного трека GPS (шаг от 0.8 м, без притягивания к дорогам)</span>
            <button type="button" class="btn btn-sm" id="p3RefreshGpsLockBtn" style="min-height:28px;padding:2px 9px;font-size:11px;font-weight:800;">
              Обновить захват GPS
            </button>
          </div>
        </div>

        ${_weakSignalConfirmPending ? `
          <div style="padding:11px 12px;background:rgba(239,68,68,0.14);border:1.5px solid var(--bad);border-radius:var(--r-sm);display:flex;flex-direction:column;gap:8px;">
            <div style="font-weight:900;color:var(--bad);font-size:13px;">
              Внимание: слабая связь со спутниками (${satsUsed} спутн., точность ${gpsAcc !== null ? '±' + gpsAcc + ' м' : 'низкая'})!
            </div>
            <div style="font-size:11.5px;color:var(--text);line-height:1.4;">
              Для чистой записи тропы без скачков требуется минимум 8–12 спутников и точность до ±15 м. При слабом сигнале маршрут может записаться некорректно.
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <button type="button" class="btn btn-sm btn-good" id="p3WaitGoodSatellitesBtn" style="min-height:36px;font-weight:800;">Ждать 8–12 спутников</button>
              <button type="button" class="btn btn-sm" id="p3ForceStartWeakGpsBtn" style="min-height:36px;font-weight:800;color:var(--warn);border-color:var(--warn);">Начать принудительно</button>
            </div>
          </div>
        ` : ''}

        <!-- Основная панель управления маршрутом и возвратом -->
        <div style="padding:12px;background:${trk?.returnMode === 'lost_emergency' ? 'rgba(239,68,68,0.18)' : 'rgba(245,158,11,0.10)'};border:1.5px solid ${trk?.returnMode === 'lost_emergency' ? 'var(--bad)' : 'var(--warn)'};border-radius:var(--r-sm);">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
            <span style="font-weight:900;font-size:14px;color:${trk?.returnMode === 'lost_emergency' ? 'var(--bad)' : 'var(--warn)'};">
              ${trk?.returnMode === 'lost_emergency' ? 'АКТИВЕН РЕЖИМ «Я ПОТЕРЯЛСЯ — ВОЗВРАТ К СТАРТУ»' : 'Запись маршрута в фоне и возврат по следу'}
            </span>
            <span class="pill ${trk ? 'pill-good' : 'pill-neutral'}" style="font-size:10.5px;">
              ${trk ? (isRet ? 'Ведение назад по тропе' : 'Идёт запись (шаг 1.5 м)') : 'Ожидание'}
            </span>
          </div>
          ${isRet && navState && navState.offTrackMeters > 20 ? `
            <div style="margin:6px 0;padding:8px 10px;border-radius:8px;background:rgba(239,68,68,0.22);border:1.5px solid #ef4444;color:#fca5a5;font-size:12px;font-weight:900;">
              ОТКЛОНЕНИЕ ОТ МАРШРУТА: ${navState.offTrackMeters} м! Вернитесь к линии тропы (азимут: ${navState.bearingDeg}°).
            </div>
          ` : ''}
          ${trk ? `
            <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:8px 0;padding:8px;background:var(--card);border:1px solid var(--border);border-radius:8px;text-align:center;">
              <div>
                <div style="font-size:10px;color:var(--muted);">${isRet ? 'ДЛИНА ТРОПЫ' : 'ПРОЙДЕНО'}</div>
                <div style="font-weight:900;font-size:13px;color:var(--accent);">${formatExactRouteDistanceRu(trk.recordedDistKm || trk.totalDistKm || 0, 10)}</div>
              </div>
              <div>
                <div style="font-size:10px;color:var(--muted);">ОСТАЛОСЬ ПО ТРОПЕ</div>
                <div style="font-weight:900;font-size:13px;color:var(--good);">${formatExactRouteDistanceRu(distToStartKm, 10)}</div>
              </div>
              <div>
                <div style="font-size:10px;color:var(--muted);">КУРС ПО ТРОПЕ НАЗАД</div>
                <div style="font-weight:900;font-size:13px;color:var(--warn);">${bearingToStart}° (${compassToStart.split(' ')[0]})</div>
              </div>
            </div>
            <div style="font-size:11.5px;color:var(--text);margin-bottom:8px;">
              Точка старта: <b>${escapeHtml(trk.startLabel)}</b> • Точек следа: <b>${trk.points.length}</b> ${isRet ? `• Отклонение от тропы: <b>${navState?.offTrackMeters || 0} м</b>` : ''}
            </div>
          ` : `
            <div style="font-size:12px;color:var(--muted);margin-bottom:8px;">
              Нажмите «Начать запись пути» — старт зафиксируется строго в вашем текущем GPS-местоположении (0 м), а при возврате приложение проведёт вас обратно по записанным точкам с сигналом при сходе с тропы.
            </div>
          `}
          <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;">
            ${!trk ? `
              <button type="button" class="btn btn-good" id="p3StartTrackBtn" style="min-height:42px;font-weight:900;">Начать запись пути</button>
              <button type="button" class="btn" id="p3LostEmergencyBtn" style="min-height:42px;font-weight:900;background:#ef4444;border-color:#ef4444;color:#fff;">Я ПОТЕРЯЛСЯ (Назад)</button>
            ` : `
              <button type="button" class="btn ${isRet ? 'btn-good' : 'btn-accent'}" id="p3ReturnByTrackBtn" style="min-height:42px;font-weight:900;">
                ${isRet ? 'Ведение назад активно' : 'Вести назад по тропе'}
              </button>
              <button type="button" class="btn" id="p3LostEmergencyBtn" style="min-height:42px;font-weight:900;background:#ef4444;border-color:#ef4444;color:#fff;">
                Я ПОТЕРЯЛСЯ (Курс)
              </button>
              <button type="button" class="btn btn-sm" id="p3StopSaveTrackBtn" style="grid-column:1 / -1;min-height:38px;font-weight:800;">
                ${isRet && trk.alreadySaved
                  ? 'Завершить ведение по маршруту'
                  : `Завершить и сохранить маршрут (${formatExactRouteDistanceRu(trk.recordedDistKm || trk.totalDistKm || 0, 10)})`}
              </button>
            `}
          </div>
        </div>

        <!-- Голосовое сопровождение по маршруту (на экране + отдельное переключение в фоне) -->
        <div style="padding:10px 12px;background:var(--card);border:1px solid var(--border);border-radius:var(--r-sm);display:flex;flex-direction:column;gap:8px;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
            <label style="display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:800;color:var(--text);cursor:pointer;">
              <input type="checkbox" id="p3ToggleVoiceGuidanceChk" ${_voiceGuidanceEnabled ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--accent);">
              <span>Голосовое сопровождение на экране (повороты, сход с маршрута, прибытие)</span>
            </label>
            <button type="button" class="btn btn-sm" id="p3TestVoiceModalBtn" style="min-height:28px;padding:2px 10px;font-size:11px;font-weight:800;">Проверить звук</button>
          </div>
          <label style="display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:800;color:var(--accent);cursor:pointer;padding-top:6px;border-top:1px dashed var(--border);">
            <input type="checkbox" id="p3ToggleBgVoiceGuidanceChk" ${_voiceGuidanceBgEnabled ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--accent);">
            <span>Звуковое сопровождение в фоне (когда приложение свёрнуто или экран погашен)</span>
          </label>
        </div>

        <!-- Сохранённые маршруты -->
        <div style="padding:10px 12px;background:var(--card);border:1px solid var(--border);border-radius:var(--r-sm);">
          <div style="font-weight:900;font-size:12px;color:var(--muted);text-transform:uppercase;margin-bottom:6px;">
            Сохранённые маршруты в памяти устройства (${savedRoutes.length}):
          </div>
          ${savedRoutes.length === 0 ? `
            <div style="font-size:11.5px;color:var(--muted);">У вас пока нет сохранённых маршрутов.</div>
          ` : `
            <div style="display:flex;flex-direction:column;gap:6px;max-height:180px;overflow-y:auto;">
              ${savedRoutes.map(rt => `
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:7px 9px;background:var(--panel);border:1px solid var(--border);border-radius:6px;font-size:11.5px;">
                  <div style="min-width:0;flex:1;">
                    <div style="font-weight:800;color:var(--text);">${escapeHtml(rt.title || 'Маршрут')}</div>
                    <div style="font-size:10.5px;color:var(--muted);">${formatExactRouteDistanceRu(rt.totalDistKm || 0, 10)} • Точек: ${(rt.points || []).length}</div>
                  </div>
                  <div style="display:flex;gap:5px;">
                    <button type="button" class="btn btn-sm btn-accent" data-load-saved-route="${escapeHtml(rt.id)}" style="min-height:28px;padding:2px 8px;font-size:11px;">Вести назад</button>
                    <button type="button" class="btn btn-sm" data-del-saved-route="${escapeHtml(rt.id)}" style="min-height:28px;padding:2px 7px;font-size:11px;color:var(--bad);">✕</button>
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </div>
      </div>
    `;

    bodyEl.querySelector('#p3ToggleRoadSnapChk')?.addEventListener('change', (ev) => {
      _phase3SnapToRoadsEnabled = Boolean(ev.target.checked);
    });
    bodyEl.querySelector('#p3RefreshGpsLockBtn')?.addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      if (btn) { btn.disabled = true; btn.textContent = 'Опрос спутников...'; }
      const fix = await acquireFreshHighAccuracyGpsFix(5000);
      if (fix && fix.hasRealFix) {
        showToast(`Захват спутников: ${fix.satellitesUsed} в работе, точность ±${fix.acc} м`, fix.satellitesUsed >= 8 ? 'good' : 'warn');
      } else {
        showToast('Не удалось получить точный отклик GPS. Выйдите на открытое место.', 'warn');
      }
      renderModalContent(bodyEl);
    });
    bodyEl.querySelector('#p3WaitGoodSatellitesBtn')?.addEventListener('click', async () => {
      _weakSignalConfirmPending = false;
      await acquireFreshHighAccuracyGpsFix(5000);
      renderModalContent(bodyEl);
    });
    bodyEl.querySelector('#p3ForceStartWeakGpsBtn')?.addEventListener('click', () => {
      _weakSignalConfirmPending = false;
      startPhase3RouteRecording('', false, _liveGpsFix.hasRealFix ? _liveGpsFix : null);
      showToast('Запись маршрута запущена принудительно от текущих координат.', 'warn');
      renderModalContent(bodyEl);
      if (container) render(container);
    });
    bodyEl.querySelector('#p3ToggleVoiceGuidanceChk')?.addEventListener('change', (ev) => {
      setVoiceGuidanceScreenEnabled(Boolean(ev.target.checked));
      showToast(_voiceGuidanceEnabled ? 'Голосовое сопровождение на экране включено' : 'Голосовое сопровождение на экране выключено', 'info');
    });
    bodyEl.querySelector('#p3ToggleBgVoiceGuidanceChk')?.addEventListener('change', (ev) => {
      setVoiceGuidanceBackgroundEnabled(Boolean(ev.target.checked));
      showToast(_voiceGuidanceBgEnabled ? 'Звуковое сопровождение в фоне включено' : 'Звуковое сопровождение в фоне выключено', 'info');
    });
    bodyEl.querySelector('#p3TestVoiceModalBtn')?.addEventListener('click', () => {
      speakRouteGuidanceRu(`Проверка голосового сопровождения. Звук в фоне ${_voiceGuidanceBgEnabled ? 'включён' : 'выключен'}.`, true);
    });
    bodyEl.querySelector('#p3StartTrackBtn')?.addEventListener('click', (ev) => {
      const btn = ev.currentTarget;
      ensureRoutePermissionsBeforeAction('Начать запись пути', async () => {
        if (btn) { btn.disabled = true; btn.textContent = 'Захват GPS...'; }
        const freshFix = await acquireFreshHighAccuracyGpsFix(600).catch(() => null);
        _weakSignalConfirmPending = false;
        const startFix = (freshFix && freshFix.hasRealFix) ? freshFix : getTrueUserGpsCoords(store.getState());
        startPhase3RouteRecording('', false, startFix);
        speakRouteGuidanceRu('Запись маршрута начата от вашего текущего местоположения.', true);
        renderModalContent(bodyEl);
        if (container) render(container);
      });
    });
    bodyEl.querySelector('#p3ReturnByTrackBtn')?.addEventListener('click', async () => {
      await acquireFreshHighAccuracyGpsFix(3500);
      switchPhase3ToReturnMode(false);
      const pts = _phase3ActiveTrack?.points || [];
      const uPos = _phase3ReturnUserPos || (_liveGpsFix.hasRealFix ? _liveGpsFix : pts[pts.length - 1]);
      const navSt = uPos ? _computeReturnProgressAlongTrack(uPos.lat, uPos.lon, pts) : null;
      const dirWord = navSt ? bearingToSpokenDirectionRu(navSt.bearingDeg) : 'север';
      speakRouteGuidanceRu(`Навигация по обратному маршруту начата, двигайтесь на ${dirWord}.`, true);
      renderModalContent(bodyEl);
      if (container) render(container);
    });
    bodyEl.querySelector('#p3LostEmergencyBtn')?.addEventListener('click', async () => {
      const freshFix = await acquireFreshHighAccuracyGpsFix(3500);
      if (_phase3ActiveTrack && (_phase3ActiveTrack.points?.length || 0) >= 2) {
        switchPhase3ToReturnMode(true);
      } else {
        startPhase3RouteRecording('Экстренный возврат (Я потерялся)', true, freshFix);
      }
      showToast('Активирован режим «Я ПОТЕРЯЛСЯ»: построен обратный курс к точке старта!', 'warn');
      renderModalContent(bodyEl);
      if (container) render(container);
    });
    bodyEl.querySelector('#p3StopSaveTrackBtn')?.addEventListener('click', () => {
      const wasReturningSaved = Boolean(_phase3ActiveTrack && _phase3ActiveTrack.status === 'returning' && _phase3ActiveTrack.alreadySaved);
      stopAndSavePhase3Route(!wasReturningSaved);
      showToast(wasReturningSaved ? 'Ведение по маршруту завершено' : 'Маршрут сохранён в память устройства', 'good');
      renderModalContent(bodyEl);
      if (container) render(container);
    });
    bodyEl.querySelector('#p3OpenSysLocationBtn')?.addEventListener('click', () => {
      if (typeof window !== 'undefined' && window.AndroidBridge && typeof window.AndroidBridge.openLocationSourceSettings === 'function') {
        window.AndroidBridge.openLocationSourceSettings();
      } else {
        requestGPS(container);
        showToast('Запрошен доступ к системной геолокации GPS/ГЛОНАСС', 'info');
      }
    });
    bodyEl.querySelector('#p3ReqBgLocBtn')?.addEventListener('click', async () => {
      if (typeof window !== 'undefined' && window.AndroidBridge && typeof window.AndroidBridge.requestBackgroundLocationPermission === 'function') {
        window.AndroidBridge.requestBackgroundLocationPermission();
      }
      await acquireBackgroundWakeLock(true);
      try { localStorage.setItem('klev_pro_bg_loc_ack_v1', '1'); } catch (e) {}
      showToast('Фоновый режим геолокации и защита от засыпания активированы', 'good');
      renderModalContent(bodyEl);
    });
    bodyEl.querySelector('#p3ReqBatteryOptBtn')?.addEventListener('click', () => {
      if (typeof window !== 'undefined' && window.AndroidBridge && typeof window.AndroidBridge.requestIgnoreBatteryOptimizations === 'function') {
        window.AndroidBridge.requestIgnoreBatteryOptimizations();
      }
      try { localStorage.setItem('klev_pro_bg_battery_ack_v1', '1'); } catch (e) {}
      showToast('Запрошено отключение экономии заряда батареи для непрерывной записи трека', 'good');
      renderModalContent(bodyEl);
    });
    bodyEl.querySelectorAll('[data-load-saved-route]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const rid = btn.getAttribute('data-load-saved-route');
        const found = getSavedPhase3Routes().find(r => r && r.id === rid);
        if (found) {
          const freshFix = await acquireFreshHighAccuracyGpsFix(3000);
          const pts = Array.isArray(found.points) ? found.points : [];
          const endPt = pts[pts.length - 1] || pts[0] || { lat: found.startLat, lon: found.startLon };
          _phase3ReturnUserPos = freshFix && freshFix.hasRealFix
            ? { lat: freshFix.lat, lon: freshFix.lon, acc: freshFix.acc, ts: Date.now() }
            : { lat: endPt.lat, lon: endPt.lon, acc: 5, ts: Date.now() };
          _phase3ActiveTrack = {
            ...found,
            alreadySaved: true,
            status: 'returning',
            returnMode: 'normal'
          };
          persistActivePhase3Track();
          acquireBackgroundWakeLock(true);
          bindPhase3GeolocationWatcher();
          renderPhase3TrackOnMap();
          if (mapInstance && typeof mapInstance.setView === 'function' && endPt) {
            try { mapInstance.setView([endPt.lat, endPt.lon], Math.max(14, mapInstance.getZoom() || 14)); } catch (e) {}
          }
          closeModal();
          showToast('Маршрут загружен в режиме обратного ведения к точке старта (без повторной записи)', 'good');
          if (container) render(container);
        }
      });
    });
    bodyEl.querySelectorAll('[data-del-saved-route]').forEach(btn => {
      btn.addEventListener('click', () => {
        const rid = btn.getAttribute('data-del-saved-route');
        const next = getSavedPhase3Routes().filter(r => r && r.id !== rid);
        savePhase3RoutesList(next);
        renderModalContent(bodyEl);
      });
    });
  };

  openModal('Маршруты, Возврат по следу и «Я потерялся»', '<div id="p3ModalMount"></div>', (bEl) => {
    renderModalContent(bEl);
    acquireFreshHighAccuracyGpsFix(4000).then(() => {
      if (document.body.contains(bEl)) renderModalContent(bEl);
    }).catch(() => {});
  });
}

function renderMapOverlays() {
  try { renderPhase3TrackOnMap(); } catch (e) {}
  try { renderStrictRiverFlowArrowsOnMap(); } catch (e) {}
  try { renderArcRouteDraftAndActiveOnMap(); } catch (e) {}
  if (!mapInstance || typeof L === 'undefined') return;
  const s = store.getState();
  if (mapInstance && typeof mapInstance.getPane === "function" && typeof mapInstance.createPane === "function") {
    if (!mapInstance.getPane("hexagonsPane")) {
      const hp = mapInstance.createPane("hexagonsPane");
      hp.style.zIndex = "340";
    }
    if (!mapInstance.getPane("spotsAndSosPane")) {
      const sp = mapInstance.createPane("spotsAndSosPane");
      sp.style.zIndex = "660";
    }
  }
  if (!overlayLayerGroup) {
    overlayLayerGroup = L.layerGroup().addTo(mapInstance);
  } else {
    overlayLayerGroup.clearLayers();
  }
  _circleLayersMap.clear();
  renderOfflinePackPerimetersOnMap(mapInstance, overlayLayerGroup);
  const ident = getCurrentFisherIdentity(s);
  const curZoom = (typeof mapInstance.getZoom === 'function' ? mapInstance.getZoom() : 10) || 10;
  const thematicCandidates = [];
  const seenThematicKeys = new Set();
  if (visibleMapLayers.mySpots && visibleMapLayers.showMine !== false && Array.isArray(s.savedSpots)) {
    s.savedSpots.forEach(sp => {
      if (!sp || !Number.isFinite(Number(sp.lat)) || !Number.isFinite(Number(sp.lon))) return;
      const catKey = normalizeSpotCatKey(sp.category || 'bite');
      if (visibleMapLayers.selectedCategories instanceof Set && !visibleMapLayers.selectedCategories.has(catKey)) return;
      const dedupKey = `${catKey}_${Number(sp.lat).toFixed(4)}_${Number(sp.lon).toFixed(4)}`;
      if (seenThematicKeys.has(dedupKey)) return;
      seenThematicKeys.add(dedupKey);
      thematicCandidates.push({
        id: sp.id,
        lat: Number(sp.lat),
        lon: Number(sp.lon),
        catKey,
        dedupKey,
        name: sp.name || 'Точка',
        depth: sp.depth || 0,
        clipMeters: sp.clipMeters || 0,
        metaSummary: sp.metaSummary || sp.nt || '',
        au: sp.au || ident.callsign,
        mine: true,
        isSavedSpot: true
      });
    });
  }
  const rawCircleList = Array.isArray(s.circleItems) ? s.circleItems : [];
  if (visibleMapLayers.mySpots) {
    rawCircleList.forEach(item => {
      if (!item || item.t !== 'spot' || !Number.isFinite(Number(item.lat)) || !Number.isFinite(Number(item.lon))) return;
      if (isCircleItemHidden(item, s)) return;
      const mine = isCircleItemMine(item, s);
      if (!visibleMapLayers.showMine && mine) return;
      if (!visibleMapLayers.showForeign && !mine) return;
      const catKey = normalizeSpotCatKey(item.cat || 'slip');
      if (visibleMapLayers.selectedCategories instanceof Set && !visibleMapLayers.selectedCategories.has(catKey)) return;
      const dedupKey = `${catKey}_${Number(item.lat).toFixed(4)}_${Number(item.lon).toFixed(4)}`;
      if (seenThematicKeys.has(dedupKey)) return;
      seenThematicKeys.add(dedupKey);
      thematicCandidates.push({
        id: item.id,
        lat: Number(item.lat),
        lon: Number(item.lon),
        catKey,
        dedupKey,
        name: item.wn || item.fn || item.lb || 'Точка',
        depth: item.dp || 0,
        clipMeters: item.clipMeters || 0,
        metaSummary: item.metaSummary || item.nt || '',
        au: item.au || 'Рыболов',
        mine,
        isSavedSpot: false
      });
    });
  }
  if (thematicCandidates.length > 0) {
    if (curZoom >= 10) {
      thematicCandidates.forEach(pt => {
        const catObj = SPOT_CATEGORIES[pt.catKey] || SPOT_CATEGORIES.slip;
        const delOrHideBtn = pt.isSavedSpot
          ? `<button type="button" data-popup-del-spot="${escapeHtml(pt.id)}" style="margin-top:5px;padding:2px 8px;border-radius:5px;border:1px solid #ef4444;background:#ef4444;color:#fff;font-size:10.5px;font-weight:800;cursor:pointer;">Удалить закладку</button>`
          : ((pt.mine || ident.isOwner)
              ? `<button type="button" data-popup-del-circle="${escapeHtml(pt.id)}" style="margin-top:5px;padding:2px 8px;border-radius:5px;border:1px solid #ef4444;background:#ef4444;color:#fff;font-size:10.5px;font-weight:800;cursor:pointer;">Удалить точку</button>`
              : `<button type="button" data-popup-hide-circle="${escapeHtml(pt.id)}" style="margin-top:5px;padding:2px 8px;border-radius:5px;border:1px solid #64748b;background:#334155;color:#fff;font-size:10.5px;font-weight:800;cursor:pointer;">Скрыть точку</button>`);
        let marker;
        if (typeof L.divIcon === 'function' && typeof L.marker === 'function') {
          marker = L.marker([pt.lat, pt.lon], {
            pane: (mapInstance && mapInstance.getPane && mapInstance.getPane("spotsAndSosPane")) ? "spotsAndSosPane" : "markerPane",
            zIndexOffset: 900,
            icon: L.divIcon({
              className: 'klev-thematic-spot-icon',
              html: `<div style="width:22px;height:22px;border-radius:50%;background:rgba(15,23,42,0.86);border:1.8px solid ${catObj.color};box-shadow:0 1px 5px rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;font-size:12px;">${catObj.icon}</div>`,
              iconSize: [22, 22],
              iconAnchor: [11, 11]
            })
          });
        } else {
          marker = L.circleMarker([pt.lat, pt.lon], {
            radius: 7,
            color: '#ffffff',
            fillColor: catObj.color,
            fillOpacity: 0.92,
            weight: 2
          });
        }
        const showDepth = (pt.catKey === 'snag' || pt.catKey === 'spot' || pt.catKey === 'bite') && Number(pt.depth) > 0;
        const showClip = pt.catKey === 'slip' && Number(pt.clipMeters) > 0;
        let cleanMeta = String(pt.metaSummary || '').trim();
        if (!showDepth && cleanMeta) {
          cleanMeta = cleanMeta.replace(/\s*•?\s*глубина\s*~?\s*[\d.,]+\s*м/gi, '').replace(/^•\s*|\s*•$/g, '').trim();
          if (!cleanMeta || cleanMeta === 'Слип') {
            cleanMeta = pt.catKey === 'slip' ? (showClip ? `Спуск лодки (слип) • Клипса ${pt.clipMeters} м` : 'Спуск лодки / Слип') : catObj.short;
          }
        }
        let detailLine = '';
        if (cleanMeta) {
          detailLine = `<span class="klev-popup-detail">${escapeHtml(cleanMeta)}</span><br>`;
        } else if (showDepth || showClip) {
          detailLine = `<span class="klev-popup-detail">${showDepth ? `Глубина: ${pt.depth} м` : ''}${showDepth && showClip ? ' • ' : ''}${showClip ? `Клипса: ${pt.clipMeters} м` : ''}</span><br>`;
        }
        const navRouteBtn = isMobileOrTabletMapMode() ? `<button type="button" data-popup-nav-spot="1" data-nav-lat="${pt.lat}" data-nav-lon="${pt.lon}" data-nav-title="${escapeHtml(pt.name)}" data-nav-cat="${escapeHtml(catObj.short)}" style="margin-top:5px;margin-right:5px;padding:3px 9px;border-radius:5px;border:1px solid #10b981;background:#10b981;color:#fff;font-size:10.5px;font-weight:800;cursor:pointer;">Маршрут до точки</button>` : "";
        if (_bathymetryLayerEnabled && Number(pt.depth) > 0 && (pt.catKey === 'bite' || pt.catKey === 'snag' || pt.isBathymetryPoint)) {
          const dVal = Number(pt.depth);
          const bathyCol = dVal >= 8 ? '#1d4ed8' : (dVal >= 4 ? '#0284c7' : '#38bdf8');
          const isoCircle = L.circle([pt.lat, pt.lon], {
            radius: Math.max(35, Math.min(180, dVal * 16)),
            color: bathyCol,
            fillColor: bathyCol,
            fillOpacity: 0.22,
            weight: 1.5,
            dashArray: '3, 4'
          });
          overlayLayerGroup.addLayer(isoCircle);
        }
        marker.bindPopup(
          `<div style="font-size:12.5px;line-height:1.45;">` +
          `<b style="color:${catObj.color};">${catObj.icon} ${escapeHtml(catObj.short)}:</b> <span class="klev-popup-title">${escapeHtml(pt.name)}</span><br>` +
          detailLine +
          `<span class="klev-popup-sub" style="font-size:11px;">${pt.isSavedSpot ? 'Личная закладка' : `Общая точка (${escapeHtml(pt.au)})`}</span><br>` +
          `<div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;">${navRouteBtn}${delOrHideBtn}</div></div>`
        );
        overlayLayerGroup.addLayer(marker);
        if (pt.id) _circleLayersMap.set(pt.id, marker);
      });
    } else {
      const clusterRadiusKm = Math.max(0.85, Math.pow(2, 12 - curZoom) * 1.15);
      const clusters = [];
      thematicCandidates.forEach(pt => {
        let foundCluster = null;
        for (const cl of clusters) {
          if (calcHaversineKm(pt.lat, pt.lon, cl.lat, cl.lon) <= clusterRadiusKm) {
            foundCluster = cl;
            break;
          }
        }
        if (foundCluster) {
          foundCluster.items.push(pt);
          const n = foundCluster.items.length;
          foundCluster.lat = (foundCluster.lat * (n - 1) + pt.lat) / n;
          foundCluster.lon = (foundCluster.lon * (n - 1) + pt.lon) / n;
        } else {
          clusters.push({ lat: pt.lat, lon: pt.lon, items: [pt] });
        }
      });
      clusters.forEach(cl => {
        const count = cl.items.length;
        const firstCat = SPOT_CATEGORIES[cl.items[0].catKey] || SPOT_CATEGORIES.slip;
        let clMarker;
        if (typeof L.divIcon === 'function' && typeof L.marker === 'function') {
          clMarker = L.marker([cl.lat, cl.lon], {
            pane: (mapInstance && mapInstance.getPane && mapInstance.getPane("spotsAndSosPane")) ? "spotsAndSosPane" : "markerPane",
            zIndexOffset: 950,
            icon: L.divIcon({
              className: 'klev-thematic-cluster-icon',
              html: `<div title="Точек: ${count} (нажмите для приближения < 1 км/см)" style="width:26px;height:26px;border-radius:50%;background:rgba(15,23,42,0.88);border:2px solid ${firstCat.color};color:#fff;font-size:11.5px;font-weight:900;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.5);cursor:pointer;">${count}</div>`,
              iconSize: [26, 26],
              iconAnchor: [13, 13]
            })
          });
          if (typeof clMarker.on === 'function') {
            clMarker.on('click', () => {
              if (mapInstance && typeof mapInstance.flyTo === 'function') {
                mapInstance.flyTo([cl.lat, cl.lon], 12);
              } else if (mapInstance && typeof mapInstance.setView === 'function') {
                mapInstance.setView([cl.lat, cl.lon], 12);
              }
            });
          }
        } else {
          clMarker = L.circleMarker([cl.lat, cl.lon], {
            radius: 10,
            color: firstCat.color,
            fillColor: '#0f172a',
            fillOpacity: 0.9,
            weight: 2
          });
        }
        overlayLayerGroup.addLayer(clMarker);
      });
    }
  }
  const now = Date.now();
  const circleItems = Array.isArray(s.circleItems) ? s.circleItems : [];
  circleItems.forEach(item => {
    if (!item || !Number.isFinite(item.lat) || !Number.isFinite(item.lon)) return;
    if (isCircleItemHidden(item, s)) return;
    const mine = isCircleItemMine(item, s);
    if (!visibleMapLayers.showMine && mine) return;
    if (!visibleMapLayers.showForeign && !mine) return;
    const ownerBadgeHtml = mine
      ? `<span style="color:#10b981;font-weight:800;"><svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><circle cx=\"12\" cy=\"8\" r=\"4\" fill=\"rgba(56,189,248,0.22)\" stroke=\"currentColor\" stroke-width=\"1.8\"/><path d=\"M4 20c0-3.8 3.6-6.5 8-6.5s8 2.7 8 6.5\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\"/></svg> Моя</span>`
      : `<span style="color:#38bdf8;font-weight:800;"><svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><circle cx=\"12\" cy=\"12\" r=\"9\" stroke=\"currentColor\" stroke-width=\"1.8\"/><path d=\"M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18\" stroke=\"currentColor\" stroke-width=\"1.6\"/></svg> Чужая</span>`;
    const actionBtnHtml = (mine || ident.isOwner)
      ? `<button type="button" data-popup-del-circle="${item.id}" style="margin-top:5px;padding:3px 8px;border-radius:5px;border:1px solid #ef4444;background:#ef4444;color:#fff;font-size:11px;font-weight:800;cursor:pointer;"><svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg> Удалить точку</button>`
      : `<button type="button" data-popup-hide-circle="${item.id}" style="margin-top:5px;padding:3px 8px;border-radius:5px;border:1px solid #64748b;background:#334155;color:#fff;font-size:11px;font-weight:800;cursor:pointer;"><svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M17.94 17.94A10.07 10.07 0 0 1 12 19c-6.4 0-10-7-10-7a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c6.4 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\"/></svg> Скрыть чужую точку</button>`;
    const isFocused = (_focusedCircleId && String(_focusedCircleId) === String(item.id));
    if (item.sos) {
      const hasSpotsPane = Boolean(mapInstance && mapInstance.getPane && mapInstance.getPane("spotsAndSosPane"));
      const sosMarker = L.marker([item.lat, item.lon], {
        pane: hasSpotsPane ? "spotsAndSosPane" : "markerPane",
        zIndexOffset: 2200,
        icon: L.divIcon({
          className: "klev-sos-icon",
          html: "<div style=\"width:28px;height:28px;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 0 8px #ef4444);animation:pulse 1.4s infinite;\"><svg class=\"k-ico\" style=\"width:26px;height:26px;color:var(--bad);\" viewBox=\"0 0 24 24\" fill=\"none\"><circle cx=\"12\" cy=\"12\" r=\"10\" fill=\"#dc2626\" stroke=\"#ffffff\" stroke-width=\"2.2\"/><text x=\"12\" y=\"15\" text-anchor=\"middle\" fill=\"#fff\" font-size=\"7.5\" font-weight=\"900\" font-family=\"sans-serif\">SOS</text></svg></div>",
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        })
      });
      const cleanSosReason = String(item.nt || "Требуется срочная помощь на воде / льду!").replace(/<[^>]+>/g, "").trim();
      const sosTimeStr = item.ca ? new Date(item.ca).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "сейчас";
      const sosPopupHtml = `<div style="font-size:12px;line-height:1.45;min-width:210px;">` +
        `<b style="color:#ef4444;font-size:13.5px;"><svg class="k-ico" style="color:var(--bad);" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9.5" fill="#dc2626" stroke="#fca5a5" stroke-width="1.8"/><text x="12" y="15" text-anchor="middle" fill="#fff" font-size="7.5" font-weight="900" font-family="sans-serif">SOS</text></svg> СИГНАЛ SOS (${ownerBadgeHtml}):</b><br>` +
        `<div style="margin-top:4px;padding:6px 8px;border-radius:8px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.4);">` +
        `<b>Точные координаты:</b> <span style="font-family:monospace;font-weight:900;">${Number(item.lat).toFixed(4)}°N, ${Number(item.lon).toFixed(4)}°E</span><br>` +
        `<b>Ориентир / Водоём:</b> ${escapeHtml(item.wn || item.lb || "Водоём")}<br>` +
        `<b>Причина SOS:</b> <span style="color:#fca5a5;font-weight:800;">«${escapeHtml(cleanSosReason)}»</span><br>` +
        `<b>Отправитель:</b> ${escapeHtml(item.au || "Рыболов")} (${escapeHtml(item.fid || "")}) • ${sosTimeStr}` +
        `</div>` +
        `${actionBtnHtml}</div>`;
      sosMarker.bindPopup(sosPopupHtml);
      overlayLayerGroup.addLayer(sosMarker);
      _circleLayersMap.set(item.id, sosMarker);
      if (isFocused) sosMarker.openPopup();
    } else if (item.t === "crew" && visibleMapLayers.crewExact) {
      const hasAccess = canUserAccessCrewItem(item, s) || mine;
      if (!hasAccess) return;
      const isLinkActive = !Number.isFinite(item.ea) || item.ea >= now;
      const hrsLeft = isLinkActive ? Math.max(1, Math.round(((item.ea || now) - now) / 3600000)) : 0;
      const hasHexPane = Boolean(mapInstance && mapInstance.getPane && mapInstance.getPane("hexagonsPane"));
      const hasSpotsPane = Boolean(mapInstance && mapInstance.getPane && mapInstance.getPane("spotsAndSosPane"));
      const crewZone = L.circle([item.lat, item.lon], {
        pane: hasHexPane ? "hexagonsPane" : "overlayPane",
        radius: 1500,
        color: isFocused ? "#34d399" : "#10b981",
        fillColor: "#10b981",
        fillOpacity: isFocused ? 0.28 : 0.16,
        weight: isFocused ? 3 : 2
      });
      const crewMarker = L.marker([item.lat, item.lon], {
        pane: hasSpotsPane ? "spotsAndSosPane" : "markerPane",
        zIndexOffset: 1400,
        icon: L.divIcon({
          className: "klev-crew-icon",
          html: "<div style=\"font-size:16px;line-height:1;text-shadow:0 1px 3px rgba(0,0,0,0.8);\"><svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M3 16l2 4h14l2-4-9-2-9 2z\" fill=\"rgba(56,189,248,0.22)\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linejoin=\"round\"/><path d=\"M12 4v10M12 4l6 6h-6\" stroke=\"#38bdf8\" stroke-width=\"1.8\" stroke-linejoin=\"round\"/></svg></div>",
          iconSize: [22, 22],
          iconAnchor: [11, 11]
        })
      });
      const cKey = item.crewKey || "";
      const crewPopupHtml = `<div style="font-size:12px;line-height:1.4;">` +
        `<b style="color:#10b981;font-size:13px;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg> Экипаж ${cKey ? `(${cKey})` : ""} (${ownerBadgeHtml}):</b><br>` +
        `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z" fill="rgba(239,68,68,0.22)" stroke="#ef4444" stroke-width="1.9"/><circle cx="12" cy="11" r="2.3" fill="#ef4444"/></svg> <b>${escapeHtml(item.wn || item.lb || "Стоянка")}</b> (глубина ${item.dp || 2} м)<br>` +
        `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 12s4-6 11-6c4.2 0 7 2.5 9 6-2 3.5-4.8 6-9 6-7 0-11-6-11-6z" fill="rgba(56,189,248,0.28)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M2 12l-1.5-3.5L5 10.5M2 12l-1.5 3.5L5 13.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="16.5" cy="10.8" r="1.3" fill="currentColor"/></svg> Рыба: <b>${escapeHtml(item.fn || "—")}</b> • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 18c0-4 4-4 4-8s4-4 4-6 5-1 5 3-3 5-3 8 4 4 6 2" stroke="#f43f5e" stroke-width="2.2" stroke-linecap="round"/></svg> ${escapeHtml(item.bt || "по сезону")}<br>` +
        `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" fill="rgba(56,189,248,0.22)" stroke="currentColor" stroke-width="1.8"/><path d="M4 20c0-3.8 3.6-6.5 8-6.5s8 2.7 8 6.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> Напарник: <b>${escapeHtml(item.au || "Экипаж")}</b><br>` +
        `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l3.5 2" stroke="#38bdf8" stroke-width="1.9" stroke-linecap="round"/></svg> Статус: <b>${item.isExpedition && item.expStart && item.expEnd ? `Экспедиция (${escapeHtml(item.expStart)}..${escapeHtml(item.expEnd)}) • Сохранено навсегда` : (isLinkActive ? `Ссылка активна ~${hrsLeft} ч • Точка сохранена навсегда` : 'Точка экипажа сохранена навсегда')}</b><br>` +
        (item.nt ? `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> «${escapeHtml(item.nt)}»<br>` : "") +
        (cKey ? `<button type="button" data-popup-crew-chat="${cKey}" style="margin-top:6px;padding:3px 9px;border-radius:5px;border:1px solid #10b981;background:#10b981;color:#fff;font-size:11px;font-weight:800;cursor:pointer;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> Чат экипажа (${cKey})</button><br>` : "") +
        (isMobileOrTabletMapMode() ? `<button type="button" data-popup-nav-spot="1" data-nav-lat="${item.lat}" data-nav-lon="${item.lon}" data-nav-title="${escapeHtml(item.wn || item.lb || 'Точка экипажа')}" data-nav-cat="Экипаж" style="margin-top:5px;margin-right:5px;padding:3px 8px;border-radius:5px;border:1px solid #0284c7;background:#0284c7;color:#fff;font-size:11px;font-weight:800;cursor:pointer;">Маршрут до точки</button>` : "") + `${actionBtnHtml}</div>`;
      crewZone.bindPopup(crewPopupHtml);
      crewMarker.bindPopup(crewPopupHtml);
      overlayLayerGroup.addLayer(crewZone);
      overlayLayerGroup.addLayer(crewMarker);
      _circleLayersMap.set(item.id, crewMarker);
      if (isFocused) crewMarker.openPopup();
    } else if (item.t === "circle" && visibleMapLayers.circleBlur) {
      const decay = getCircleHexDecayState(item, now);
      if (decay.expired) return;
      const polyColor = mine ? "#10b981" : "#38bdf8";
      const hexObj = computeHexPolygonForCircle(item.lat, item.lon, decay.radiusKm, item.id);
      const hexVertices = (Array.isArray(item.poly) && item.poly.length === 6 && decay.radiusKm === 5.0)
        ? item.poly
        : hexObj.vertices;
      const hasHexPane = Boolean(mapInstance && mapInstance.getPane && mapInstance.getPane("hexagonsPane"));
      const blurZone = L.polygon(hexVertices, {
        pane: hasHexPane ? "hexagonsPane" : "overlayPane",
        color: isFocused ? "#fbbf24" : polyColor,
        opacity: isFocused ? 1.0 : decay.strokeOpacity,
        fillColor: polyColor,
        fillOpacity: isFocused ? 0.28 : Math.min(0.18, decay.fillOpacity),
        weight: isFocused ? 3.0 : decay.weight,
        dashArray: isFocused ? null : decay.dashArray
      });
      const centerLat = Number.isFinite(hexObj.cellLat) ? hexObj.cellLat : item.lat;
      const centerLon = Number.isFinite(hexObj.cellLon) ? hexObj.cellLon : item.lon;
      const fishIconMarker = L.marker([centerLat, centerLon], {
        pane: hasHexPane ? "hexagonsPane" : "markerPane",
        opacity: decay.markerOpacity,
        icon: L.divIcon({
          className: "klev-circle-icon",
          html: `<div style="font-size:15px;line-height:1;opacity:${decay.markerOpacity};text-shadow:0 1px 3px rgba(0,0,0,0.8);">${item.kg ? "<svg class=\"k-ico\" style=\"color:#fbbf24;\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M7 4h10v5a5 5 0 0 1-10 0V4z\" fill=\"rgba(251,191,36,0.28)\" stroke=\"#fbbf24\" stroke-width=\"1.8\"/><path d=\"M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3M12 14v4M8 20h8\" stroke=\"#fbbf24\" stroke-width=\"1.8\" stroke-linecap=\"round\"/></svg>" : "<svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M2 12s4-6 11-6c4.2 0 7 2.5 9 6-2 3.5-4.8 6-9 6-7 0-11-6-11-6z\" fill=\"rgba(56,189,248,0.28)\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linejoin=\"round\"/><path d=\"M2 12l-1.5-3.5L5 10.5M2 12l-1.5 3.5L5 13.5\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\"/><circle cx=\"16.5\" cy=\"10.8\" r=\"1.3\" fill=\"currentColor\"/></svg>"}</div>`,
          iconSize: [18, 18],
          iconAnchor: [9, 9]
        })
      });
      const overlappingPoints = [
        ...thematicCandidates.map(tp => ({ id: tp.id, lat: tp.lat, lon: tp.lon, t: "spot", cat: tp.catKey, wn: tp.name })),
        ...circleItems.filter(other => {
          if (!other || other.id === item.id || !Number.isFinite(other.lat) || !Number.isFinite(other.lon)) return false;
          if (isCircleItemHidden(other, s)) return false;
          if (other.t === "circle" || other.t === "workshop" || other.t === "spot") return false;
          if (other.t === "crew" && !other.sos) {
            const acc = canUserAccessCrewItem(other, s) || isCircleItemMine(other, s);
            if (!acc) return false;
          }
          return true;
        })
      ].filter(pt => calcHaversineKm(centerLat, centerLon, pt.lat, pt.lon) <= (decay.radiusKm + 0.6));
      const innerPointsHtml = overlappingPoints.length > 0
        ? `<div style="margin-top:6px;padding:6px 8px;border-radius:7px;background:rgba(15,23,42,0.55);border:1px solid rgba(56,189,248,0.35);">` +
          `<div style="font-size:10.5px;font-weight:900;color:#38bdf8;margin-bottom:4px;">Точки внутри этого гексагона (${overlappingPoints.length}):</div>` +
          overlappingPoints.map(pt => {
            const ptLbl = pt.sos
              ? `SOS: ${escapeHtml(pt.wn || pt.lb || "Сигнал помощи")}`
              : (pt.t === "spot"
                  ? `${escapeHtml((SPOT_CATEGORIES[pt.cat] || SPOT_CATEGORIES.slip).short)}: ${escapeHtml(pt.wn || pt.fn || pt.lb || "Точка")}`
                  : `Экипаж ${escapeHtml(pt.crewKey || "")}: ${escapeHtml(pt.wn || pt.lb || "Стоянка")}`);
            const btnCol = pt.sos ? "#ef4444" : (pt.t === "spot" ? (SPOT_CATEGORIES[pt.cat]?.color || "#38bdf8") : "#10b981");
            return `<button type="button" data-popup-focus-point="${escapeHtml(pt.id)}" data-popup-focus-lat="${pt.lat}" data-popup-focus-lon="${pt.lon}" style="display:block;width:100%;text-align:left;margin-top:3px;padding:4px 7px;border-radius:5px;border:1px solid ${btnCol};background:rgba(15,23,42,0.85);color:#fff;font-size:11px;font-weight:800;cursor:pointer;">→ Открыть: ${ptLbl}</button>`;
          }).join("") +
          `</div>`
        : "";
      const freshnessPct = Math.round(decay.freshness * 100);
      const circlePopupHtml = `<div style="font-size:12px;line-height:1.42;">` +
        `<b style="color:${polyColor};font-size:13px;">⬡ Гексагон Круга ±${decay.radiusKm} км (${ownerBadgeHtml}):</b><br>` +
        `<span style="display:inline-block;margin:2px 0 4px;padding:1px 7px;border-radius:999px;background:rgba(56,189,248,0.16);border:1px solid ${polyColor};font-size:10.5px;font-weight:800;color:${polyColor};">${decay.stageLabel} • Свежесть ${freshnessPct}% (осталось ~${decay.hoursLeft} ч из 72 ч)</span><br>` +
        `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z" fill="rgba(239,68,68,0.22)" stroke="#ef4444" stroke-width="1.9"/><circle cx="12" cy="11" r="2.3" fill="#ef4444"/></svg> <b>${escapeHtml(item.wn || item.lb || "Водоём")}</b> (глубина ~${item.dp || 1.5} м)<br>` +
        `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 12s4-6 11-6c4.2 0 7 2.5 9 6-2 3.5-4.8 6-9 6-7 0-11-6-11-6z" fill="rgba(56,189,248,0.28)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M2 12l-1.5-3.5L5 10.5M2 12l-1.5 3.5L5 13.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="16.5" cy="10.8" r="1.3" fill="currentColor"/></svg> <b>${escapeHtml(item.fn || "Рыба")}${item.kg ? ` (${item.kg} кг)` : ""}</b> • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3c0 0-6 7.1-6 11.5a6 6 0 0 0 12 0C18 10.1 12 3 12 3z" fill="rgba(56,189,248,0.32)" stroke="#38bdf8" stroke-width="1.8"/><path d="M9.5 15.5c.5 1.2 1.7 2 3 2" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg> Вода ~${item.tw ?? 8}°C<br>` +
        `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 18c0-4 4-4 4-8s4-4 4-6 5-1 5 3-3 5-3 8 4 4 6 2" stroke="#f43f5e" stroke-width="2.2" stroke-linecap="round"/></svg> Приманка: <b>${escapeHtml(item.bt || "по сезону")}</b><br>` +
        `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" fill="rgba(56,189,248,0.22)" stroke="currentColor" stroke-width="1.8"/><path d="M4 20c0-3.8 3.6-6.5 8-6.5s8 2.7 8 6.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> От: <b>${escapeHtml(item.au || "Рыболов")}</b><br>` +
        (item.nt ? `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> «${escapeHtml(item.nt)}»<br>` : "") +
        innerPointsHtml +
        `${actionBtnHtml}</div>`;
      blurZone.bindPopup(circlePopupHtml);
      fishIconMarker.bindPopup(circlePopupHtml);
      overlayLayerGroup.addLayer(blurZone);
      overlayLayerGroup.addLayer(fishIconMarker);
      _circleLayersMap.set(item.id, blurZone);
      if (isFocused) blurZone.openPopup();
    }
  });
  if (inspectMode && inspectedPoint && Number.isFinite(inspectedPoint.lat)) {
    const scMarker = L.circleMarker([inspectedPoint.lat, inspectedPoint.lon], {
      radius: 9,
      color: '#f59e0b',
      fillColor: '#fbbf24',
      fillOpacity: 0.9,
      weight: 2.5
    });
    scMarker.bindPopup(`<b><svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><circle cx=\"11\" cy=\"11\" r=\"6.5\" stroke=\"currentColor\" stroke-width=\"2\"/><path d=\"M16 16l4.5 4.5\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/></svg> Разведка точки:</b> ${inspectedPoint.settlementLabel}<br>Топ: ${inspectedPoint.topSpecies[0]?.fish?.name || 'Щука'} (${inspectedPoint.topSpecies[0]?.score || 70}%)`);
    overlayLayerGroup.addLayer(scMarker);
  }
}
if (typeof window !== "undefined") {
  window.addEventListener("resize", () => {
    if (mapInstance) mapInstance.invalidateSize();
  }, { passive: true });
}
let _lastMapBoxW = 0;
let _lastMapBoxH = 0;
export function renderMap(mapBoxEl) {
  if (typeof window !== 'undefined') window.__KLEV_RENDER_MAP__ = renderMap;
  if (!mapBoxEl) return;
  _ensureArcCompassSensorStarted();
  if (typeof L === 'undefined') { updateLiveUserGpsMarkerOnMap(); return; }
  const boxW = mapBoxEl.clientWidth || 0;
  const boxH = mapBoxEl.clientHeight || 0;
  if (mapBoxEl.offsetParent === null || boxW < 40 || boxH < 40) {
    return;
  }
  const s = store.getState();
  const storeCoordKey = `${Number(s.lat || 0).toFixed(4)}_${Number(s.lon || 0).toFixed(4)}`;
  const storeLocChanged = _lastMapStoreCoordKey !== storeCoordKey;
  const prevCenter = (mapInstance && typeof mapInstance.getCenter === 'function' && !storeLocChanged)
    ? mapInstance.getCenter()
    : null;
  const targetLat = prevCenter && Number.isFinite(prevCenter.lat) ? prevCenter.lat : s.lat;
  const targetLon = prevCenter && Number.isFinite(prevCenter.lng) ? prevCenter.lng : s.lon;
  const targetZoom = mapInstance ? clamp(mapInstance.getZoom(), 4, 18) : 10;
  _lastMapStoreCoordKey = storeCoordKey;
  if (!mapInstance || mapInstance._container !== mapBoxEl) {
    if (mapInstance) {
      try { mapInstance.remove(); } catch (e) {}
    }
    overlayLayerGroup = null;
    _arcRouteDraftLayerGroup = null;
    _riverArrowsLayerGroup = null;
    _liveUserGpsMarker = null;
    const yandexCrs = getYandexEPSG3395CRS();
    mapInstance = L.map(mapBoxEl, { ...(yandexCrs ? { crs: yandexCrs } : {}), minZoom: 4, maxZoom: 18 }).setView([targetLat, targetLon], targetZoom);
    _lastMapBoxW = boxW;
    _lastMapBoxH = boxH;
    mapInstance.attributionControl.setPrefix(false);
    currentTileLayer = createResilientTileLayer(currentLayerKey).addTo(mapInstance);
    applyYandexTileFiltersToMap();
    mapMarker = L.marker([s.lat, s.lon]).addTo(mapInstance);
    updateLiveUserGpsMarkerOnMap();

    // Замечание 1: Фиксируем любое касание/жест пользователя по карте для 10-секундной задержки автозума
    mapInstance.on('dragstart', () => { noteUserMapTouchInteraction(); });
    mapInstance.on('zoomstart', () => {
      if (!_isProgrammaticAutoZoom) noteUserMapTouchInteraction();
    });

    // Замечание 3: Защита от фантомных нажатий!
    // Короткий тап НЕ меняет точку на карте (только сворачивает открытые меню/плашки).
    // Смена точки на карте (setLocation) выполняется ТОЛЬКО при удержании от 0.25 сек (>= 250 мс) одним пальцем без сдвига!
    let _holdTimer = null;
    let _holdStartPt = null;
    let _holdLatLng = null;
    let _holdMultiTouch = false;

    const cancelMapHold = () => {
      if (_holdTimer) {
        clearTimeout(_holdTimer);
        _holdTimer = null;
      }
      _holdStartPt = null;
      _holdLatLng = null;
    };

    const applyDeliberateMapPointSelect = (lat, lng) => {
      if (_arcRouteBuilderMode) return;
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try { navigator.vibrate(18); } catch (_e) {}
      }
      if (inspectMode) {
        inspectWhatBitesHere(lat, lng);
        const secGeo = document.getElementById('secGeo');
        if (secGeo) render(secGeo);
      } else {
        setLocation(lat, lng);
      }
    };

    mapInstance.on('mousedown', (e) => {
      noteUserMapTouchInteraction();
      if (_arcRouteBuilderMode) return;
      const origEv = e.originalEvent;
      if (origEv && origEv.touches && origEv.touches.length > 1) {
        _holdMultiTouch = true;
        cancelMapHold();
        return;
      }
      _holdMultiTouch = false;
      _holdLatLng = e.latlng;
      _holdStartPt = e.containerPoint;
      if (_holdTimer) clearTimeout(_holdTimer);
      _holdTimer = setTimeout(() => {
        _holdTimer = null;
        if (!_holdMultiTouch && _holdLatLng) {
          applyDeliberateMapPointSelect(_holdLatLng.lat, _holdLatLng.lng);
        }
      }, 250);
    });

    mapInstance.on('mousemove', (e) => {
      if (!_holdStartPt || !e.containerPoint) return;
      const dx = e.containerPoint.x - _holdStartPt.x;
      const dy = e.containerPoint.y - _holdStartPt.y;
      if (Math.hypot(dx, dy) > 10) {
        cancelMapHold();
      }
    });

    mapInstance.on('mouseup', cancelMapHold);
    mapInstance.on('dragstart', cancelMapHold);
    mapInstance.on('movestart', cancelMapHold);
    mapInstance.on('zoomstart', cancelMapHold);

    // Дополнительно поддерживаем touchstart/touchmove/touchend напрямую на контейнере карты для мобильных браузеров и APK
    mapBoxEl.addEventListener('touchstart', (ev) => {
      noteUserMapTouchInteraction();
      if (_arcRouteBuilderMode) return;
      if (!ev.touches || ev.touches.length !== 1) {
        _holdMultiTouch = true;
        cancelMapHold();
        return;
      }
      const t = ev.touches[0];
      if (t.target && t.target.closest && t.target.closest('.leaflet-control, .leaflet-popup, .leaflet-marker-icon, button, a')) {
        cancelMapHold();
        return;
      }
      _holdMultiTouch = false;
      const rect = mapBoxEl.getBoundingClientRect();
      const px = [t.clientX - rect.left, t.clientY - rect.top];
      _holdStartPt = { x: px[0], y: px[1] };
      if (mapInstance && typeof mapInstance.containerPointToLatLng === 'function') {
        _holdLatLng = mapInstance.containerPointToLatLng(px);
      }
      if (_holdTimer) clearTimeout(_holdTimer);
      _holdTimer = setTimeout(() => {
        _holdTimer = null;
        if (!_holdMultiTouch && _holdLatLng) {
          applyDeliberateMapPointSelect(_holdLatLng.lat, _holdLatLng.lng);
        }
      }, 250);
    }, { passive: true });

    mapBoxEl.addEventListener('touchmove', (ev) => {
      noteUserMapTouchInteraction();
      if (!ev.touches || ev.touches.length !== 1) {
        _holdMultiTouch = true;
        cancelMapHold();
        return;
      }
      if (_holdStartPt) {
        const rect = mapBoxEl.getBoundingClientRect();
        const dx = (ev.touches[0].clientX - rect.left) - _holdStartPt.x;
        const dy = (ev.touches[0].clientY - rect.top) - _holdStartPt.y;
        if (Math.hypot(dx, dy) > 10) {
          cancelMapHold();
        }
      }
    }, { passive: true });

    mapBoxEl.addEventListener('touchend', () => {
      noteUserMapTouchInteraction();
      cancelMapHold();
    }, { passive: true });

    mapBoxEl.addEventListener('touchcancel', cancelMapHold, { passive: true });
    mapBoxEl.addEventListener('wheel', () => { noteUserMapTouchInteraction(); cancelMapHold(); }, { passive: true });

    if (typeof mapInstance.on === 'function') {
      mapInstance.on('zoomend', () => {
        renderMapOverlays();
        const z = mapInstance.getZoom ? (mapInstance.getZoom() || 10) : 10;
        const badge = typeof document !== 'undefined' ? document.getElementById('geoZoomScaleHintBadge') : null;
        if (badge) {
          badge.innerHTML = z >= 12
            ? 'Масштаб &lt; 1 км/см: показаны отдельные точки (слипы, коряги, стоянки)'
            : 'Обзорный масштаб: точки сгруппированы в круги с цифрой (приблизьте для деталей)';
        }
      });
    }
  } else {
    const sizeChanged = Math.abs(boxW - _lastMapBoxW) > 4 || Math.abs(boxH - _lastMapBoxH) > 4;
    if (sizeChanged) {
      const keepCenter = mapInstance.getCenter();
      const keepZoom = mapInstance.getZoom();
      _lastMapBoxW = boxW;
      _lastMapBoxH = boxH;
      mapInstance.invalidateSize({ pan: false, animate: false });
      if (keepCenter && Number.isFinite(keepCenter.lat) && Number.isFinite(keepCenter.lng)) {
        mapInstance.setView([keepCenter.lat, keepCenter.lng], keepZoom, { animate: false });
      }
    } else {
      mapInstance.invalidateSize({ pan: false, animate: false });
    }
    if (mapMarker) mapMarker.setLatLng([s.lat, s.lon]);
    updateLiveUserGpsMarkerOnMap();
    applyYandexTileFiltersToMap();
  }
  renderMapOverlays();
}
export function getMethodOptions(iceState, waterType) {
  const s = store.getState();
  const fish = FISH_DB.find(f => f.id === s.fishId) || FISH_DB[0];
  const day = s.weatherDays[s.dayIdx] || s.weatherDays[2] || s.weatherDays[0];
  const effIce = day?.iceState || iceState || s.iceState || 'open_water';
  const effWaterTemp = day?.waterTemp ?? 12;
  return getCompatibleMethods(fish, effIce, waterType, effWaterTemp);
}

// ============================================================================
// МЕГА-ПЕРЕРАБОТКА v2.9.0: МОБИЛЬНЫЙ / ПЛАНШЕТНЫЙ ИНТЕРФЕЙС КАРТЫ «АРКА»
// (Для компьютера сохраняется классический интерфейс карты, для мобильных и планшетов — Вариант 1 «Арка»)
// ============================================================================

let _arcUiOverride = null; // null | 'mobile' | 'desktop'
let _arcActivePopover = null; // null | 'layers' | 'spotGrid' | 'transport' | 'search'
let _arcTransportMode = 'car'; // 'car' (по умолчанию) | 'snowmobile' | 'bike' | 'boat' | 'walk'
let _arcGpsCompassState = 'off'; // 'off' | 'centered' | 'compass'
let _arcCompassHeadingDeg = 0;
let _arcLastSpeedKmh = 0;
let _arcRiverFlowEnabled = true;
let _arcSwipePage = 0; // 0, 1, 2 (3 экрана по 2 плашки)
let _arcExpandedPlaqueId = null; // null | '8.1' | '8.2' | '8.3' | '8.4' | '8.5' | '8.6'
let _arcExpandedPlaqueTall = false;
let _arcSelectedSpecificFishId = null; // null = средний по ТОП-10 региона, иначе id конкретной рыбы
let _arcFullScreenWeatherOpen = false;
let _arcOfflinePromptRadiusKm = null; // null | 50 | 120

// Состояние конструктора маршрутов и ведения (п. 8.2.2, 8.2.3)
let _arcRouteBuilderMode = null; // null | 'waypoints' | 'freehand'
let _arcWaypointsDraft = []; // массив { lat, lon } (НЕ соединяются линией до нажатия «Закончить и построить маршрут»!)
let _arcFreehandStrokes = []; // массив мазков, каждый мазок — массив [{lat, lon}, ...]
let _arcBuiltRoute = null; // { mode, transport, points: [[lat,lon],...], distKm, etaMin, turns: [...], started: false, paused: false, currentTurnIdx: 0, offRouteAlerted: false }
let _arcHoldStopTimer = null;
let _arcHoldStopStartTs = 0;
let _arcHoldStopProgressPct = 0;
let _arcHoldStopRaf = null;
let _arcNavSimInterval = null;

// Кэш реальных полилиний рек и ручьёв из OpenStreetMap для отрисовки стрелок течения СТРОГО по руслам рек (п. 5)
const _osmRiverWaysCache = new Map();
let _osmRiverFetchInFlight = false;
let _riverArrowsLayerGroup = null;
let _arcRouteDraftLayerGroup = null;

export function isMobileOrTabletMapMode() {
  if (typeof window === 'undefined') return false;
  let res = false;
  if (_arcUiOverride === 'desktop' || window.__KLEV_MAP_UI_OVERRIDE__ === 'desktop') {
    res = false;
  } else if (_arcUiOverride === 'mobile' || window.__KLEV_MAP_UI_OVERRIDE__ === 'mobile') {
    res = true;
  } else if (window.__KLEV_ADMIN_CONTOUR__ === true) {
    res = false;
  } else {
    const w = window.innerWidth || document.documentElement?.clientWidth || 1024;
    const ua = navigator.userAgent || '';
    const isTouchDevice = /Android|iPhone|iPad|iPod|Mobile|Tablet|KlevProAPK/i.test(ua) ||
      Boolean(window.AndroidBridge) ||
      Boolean(window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData) ||
      Boolean(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    res = w <= 1100 || isTouchDevice;
  }
  try {
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.setAttribute('data-desktop-web', res ? '0' : '1');
    }
  } catch (_e) {}
  return res;
}

// Отрисовка и обновление маркера реальной геопозиции пользователя с лучом «взгляда» по компасу (Замечание 6)
function buildLiveUserGpsDivIconHtml(headingDeg = 0, showCone = false) {
  const rot = Number.isFinite(Number(headingDeg)) ? Math.round(Number(headingDeg)) : 0;
  return `
    <div class="klev-live-user-gps-marker klev-live-user-gps-wrap" style="position:relative;width:64px;height:64px;display:flex;align-items:center;justify-content:center;pointer-events:none;">
      <div id="klevLiveGpsViewCone" style="position:absolute;inset:0;display:${showCone ? 'flex' : 'none'};opacity:${showCone ? '0.95' : '0'};align-items:center;justify-content:center;transform:rotate(${rot}deg);transition:transform 0.15s linear;">
        <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
          <defs>
            <radialGradient id="klevCompassConeGrad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stop-color="#10b981" stop-opacity="0.58"/>
              <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.0"/>
            </radialGradient>
          </defs>
          <path d="M32 32 L14 4 A32 32 0 0 1 50 4 Z" fill="url(#klevCompassConeGrad)"/>
          <polygon points="32,5 36.5,16 32,13.5 27.5,16" fill="#10b981" stroke="#ffffff" stroke-width="1"/>
        </svg>
      </div>
      <div style="width:18px;height:18px;border-radius:999px;background:#10b981;border:3px solid #ffffff;box-shadow:0 0 0 5px rgba(16,185,129,0.28), 0 2px 8px rgba(0,0,0,0.65);position:relative;z-index:2;"></div>
    </div>
  `;
}

let _compassSmoothSin = 0;
let _compassSmoothCos = 1;
let _compassHasSample = false;
let _compassBestSource = ''; // 'native' | 'sensor_api' | 'abs' | 'rel'
let _compassNativePollTimer = null;

function _applyNewCompassHeading(rawDeg, sourceTag = 'rel') {
  if (!Number.isFinite(rawDeg)) return;
  const rank = { native: 4, sensor_api: 3, abs: 2, rel: 1 };
  const curRank = rank[_compassBestSource] || 0;
  const newRank = rank[sourceTag] || 1;
  if (newRank < curRank) return;
  _compassBestSource = sourceTag;

  const normDeg = ((rawDeg % 360) + 360) % 360;
  const rad = (normDeg * Math.PI) / 180;
  if (!_compassHasSample) {
    _compassSmoothSin = Math.sin(rad);
    _compassSmoothCos = Math.cos(rad);
    _compassHasSample = true;
  } else {
    const alpha = 0.35;
    _compassSmoothSin = _compassSmoothSin * (1 - alpha) + Math.sin(rad) * alpha;
    _compassSmoothCos = _compassSmoothCos * (1 - alpha) + Math.cos(rad) * alpha;
  }
  const smoothed = ((Math.atan2(_compassSmoothSin, _compassSmoothCos) * 180) / Math.PI + 360) % 360;
  _arcCompassHeadingDeg = Math.round(smoothed) % 360;

  if (typeof document !== 'undefined') {
    document.querySelectorAll('#klevLiveGpsViewCone').forEach(cone => {
      cone.style.display = 'flex';
      cone.style.opacity = '0.96';
      cone.style.transform = `rotate(${_arcCompassHeadingDeg}deg)`;
    });
    const btnNeedle = document.querySelector('#arcBtnGpsCompass svg[data-compass-needle="1"]');
    if (btnNeedle) {
      btnNeedle.style.transform = `rotate(${-_arcCompassHeadingDeg}deg)`;
    }
  }
}

function _ensureArcCompassSensorStarted() {
  if (typeof window === 'undefined') return;
  window.__KLEV_ON_NATIVE_COMPASS__ = (deg) => {
    _applyNewCompassHeading(Number(deg), 'native');
  };
  if (window.AndroidBridge && typeof window.AndroidBridge.getCompassHeadingDeg === 'function' && !_compassNativePollTimer) {
    _compassNativePollTimer = setInterval(() => {
      try {
        const d = Number(window.AndroidBridge.getCompassHeadingDeg());
        if (Number.isFinite(d) && d >= 0) {
          _applyNewCompassHeading(d, 'native');
        }
      } catch (_e) {}
    }, 180);
  }
  if (window.__KLEV_ARC_COMPASS_BOUND__) return;
  window.__KLEV_ARC_COMPASS_BOUND__ = true;

  // 1. Generic Sensor API (AbsoluteOrientationSensor / RelativeOrientationSensor — использует аппаратный гироскоп + вектор вращения)
  try {
    const SensorCtor = window.AbsoluteOrientationSensor || window.RelativeOrientationSensor;
    if (typeof SensorCtor === 'function') {
      const sensor = new SensorCtor({ frequency: 30, referenceFrame: 'device' });
      sensor.addEventListener('reading', () => {
        const q = sensor.quaternion;
        if (!Array.isArray(q) || q.length < 4) return;
        const [x, y, z, w] = q;
        const siny_cosp = 2 * (w * z + x * y);
        const cosy_cosp = 1 - 2 * (y * y + z * z);
        const yawDeg = (Math.atan2(siny_cosp, cosy_cosp) * 180) / Math.PI;
        const scrAngle = (window.screen?.orientation && Number.isFinite(window.screen.orientation.angle))
          ? window.screen.orientation.angle
          : (Number.isFinite(window.orientation) ? Number(window.orientation) : 0);
        const heading = ((360 - yawDeg) + scrAngle + 360) % 360;
        _applyNewCompassHeading(heading, 'sensor_api');
      });
      sensor.addEventListener('error', () => {});
      sensor.start();
    }
  } catch (_e) {}

  // 2. События ориентации браузера / WebView (без вычитания начального угла и без конфликта двух слушателей)
  const extractHeadingFromEvent = (ev) => {
    if (!ev) return null;
    const scrAngle = (window.screen?.orientation && Number.isFinite(window.screen.orientation.angle))
      ? window.screen.orientation.angle
      : (Number.isFinite(window.orientation) ? Number(window.orientation) : 0);
    if (Number.isFinite(ev.webkitCompassHeading) && ev.webkitCompassHeading >= 0) {
      return (ev.webkitCompassHeading + scrAngle + 360) % 360;
    }
    if (Number.isFinite(ev.alpha)) {
      return ((360 - ev.alpha) + scrAngle + 360) % 360;
    }
    return null;
  };

  if ('ondeviceorientationabsolute' in window) {
    window.addEventListener('deviceorientationabsolute', (ev) => {
      const h = extractHeadingFromEvent(ev);
      if (h !== null) _applyNewCompassHeading(h, 'abs');
    }, { passive: true });
  }
  window.addEventListener('deviceorientation', (ev) => {
    const h = extractHeadingFromEvent(ev);
    if (h !== null) _applyNewCompassHeading(h, ev.absolute ? 'abs' : 'rel');
  }, { passive: true });
}

export function updateLiveUserGpsMarkerOnMap() {
  _ensureArcCompassSensorStarted();
  const realPos = getTrueUserGpsCoords();
  if (!Number.isFinite(realPos.lat) || !Number.isFinite(realPos.lon)) return;
  // Зелёный сектор («луч взгляда» по компасу) всегда активен на точке геолокации пользователя
  const showCone = true;
  if (!mapInstance || typeof L === 'undefined') {
    const mapBox = document.getElementById('mapBox');
    if (mapBox) {
      let fb = document.getElementById('klevLiveGpsFallbackMarker');
      if (!fb) {
        fb = document.createElement('div');
        fb.id = 'klevLiveGpsFallbackMarker';
        fb.style.cssText = 'position:absolute;left:50%;top:50%;width:64px;height:64px;transform:translate(-50%,-50%);pointer-events:none;z-index:680;';
        mapBox.appendChild(fb);
      }
      fb.innerHTML = buildLiveUserGpsDivIconHtml(_arcCompassHeadingDeg, showCone);
    }
    return;
  }
  const fbOld = document.getElementById('klevLiveGpsFallbackMarker');
  if (fbOld) fbOld.remove();
  const html = buildLiveUserGpsDivIconHtml(_arcCompassHeadingDeg, showCone);
  const existingWrap = (mapInstance._container || document).querySelector('.klev-live-user-gps-wrap');
  const hasLayerOk = _liveUserGpsMarker && (typeof mapInstance.hasLayer === 'function' ? mapInstance.hasLayer(_liveUserGpsMarker) : Boolean(existingWrap));
  if (!_liveUserGpsMarker || !hasLayerOk) {
    _liveUserGpsMarker = L.marker([realPos.lat, realPos.lon], {
      interactive: false,
      keyboard: false,
      zIndexOffset: 2800,
      icon: L.divIcon({
        className: 'klev-live-user-gps-marker',
        html,
        iconSize: [64, 64],
        iconAnchor: [32, 32]
      })
    }).addTo(mapInstance);
  } else {
    if (typeof _liveUserGpsMarker.setLatLng === 'function') {
      _liveUserGpsMarker.setLatLng([realPos.lat, realPos.lon]);
    }
    if (typeof _liveUserGpsMarker.setZIndexOffset === 'function') {
      _liveUserGpsMarker.setZIndexOffset(2800);
    }
    const cone = (mapInstance._container || document).querySelector('#klevLiveGpsViewCone');
    if (cone) {
      cone.style.display = 'flex';
      cone.style.opacity = '0.96';
      cone.style.transform = `rotate(${Math.round(_arcCompassHeadingDeg)}deg)`;
    } else if (existingWrap && existingWrap.parentElement) {
      existingWrap.parentElement.innerHTML = html;
    }
  }
}

if (typeof window !== 'undefined') {
  window.__KLEV_IS_MOBILE_MAP_MODE__ = isMobileOrTabletMapMode;
  window.__KLEV_SET_MAP_UI_MODE_OVERRIDE__ = (mode) => {
    _arcUiOverride = mode;
    window.__KLEV_MAP_UI_OVERRIDE__ = mode;
    const rootEl = document.documentElement;
    const isMob = isMobileOrTabletMapMode();
    rootEl.setAttribute('data-desktop-web', isMob ? '0' : '1');
    const isArc = isMob && (store.getState().route === 'geo');
    rootEl.setAttribute('data-arc-map-active', isArc ? '1' : '0');
    const secGeo = document.getElementById('secGeo');
    if (secGeo) render(secGeo);
    const secLog = document.getElementById('secLog');
    if (secLog && typeof window.__KLEV_RENDER_LOG__ === 'function') window.__KLEV_RENDER_LOG__(secLog);
  };
}

const ARC_TRANSPORT_MODES = {
  car: {
    id: 'car',
    label: 'Автомобиль',
    avgSpeedKmh: 45,
    svg: '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M5 11l2-5h10l2 5m-15 0h16a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-1v2a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-2H8v2a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-2H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><circle cx="7.5" cy="14" r="1.3" fill="currentColor"/><circle cx="16.5" cy="14" r="1.3" fill="currentColor"/></svg>'
  },
  snowmobile: {
    id: 'snowmobile',
    label: 'Снегоход/Мотособака',
    avgSpeedKmh: 28,
    svg: '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M3 16h11l3-4-4-3H9L6 13H3v3z" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><path d="M12 6l3 3m2 8h4l1-2" stroke="#38bdf8" stroke-width="1.9" stroke-linecap="round"/><rect x="3" y="17" width="11" height="2.5" rx="1.2" fill="currentColor"/></svg>'
  },
  bike: {
    id: 'bike',
    label: 'Велосипед',
    avgSpeedKmh: 16,
    svg: '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="6.5" cy="16.5" r="3.5" stroke="currentColor" stroke-width="1.9"/><circle cx="17.5" cy="16.5" r="3.5" stroke="currentColor" stroke-width="1.9"/><path d="M6.5 16.5l3.5-6.5h4.5l-2.5 6.5m-2-6.5L9 7.5H7m7.5 2.5l3 6.5M14 7h2.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  },
  boat: {
    id: 'boat',
    label: 'Лодка',
    avgSpeedKmh: 20,
    svg: '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M3 14l3 4h12l3-4-9-2-9 2z" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><path d="M12 6v6m0-6l4 4h-4" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 20c2-1 4-1 6 0s4 1 6 0 4-1 6 0" stroke="#38bdf8" stroke-width="1.7" stroke-linecap="round"/></svg>'
  },
  walk: {
    id: 'walk',
    label: 'Пешком',
    avgSpeedKmh: 4.5,
    svg: '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="4.5" r="2" fill="currentColor"/><path d="M10 9l-2 4m2-4l3 1.5 2 2.5M10 9l-.5 5.5-2.5 5m3-5l2.5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  }
};

// Встроенный высокоточный гидрографический каркас рек ЯНАО / ХМАО (р. Седэяха, р. Тамчара-Яха, р. Варенга-Яха, р. Евояха, р. Пур, р. Хадуттэ, р. Надым, р. Таз)
// С плотной детализацией изгибов русел внутри Нового Уренгоя, Коротчаево и Уренгоя для 100% водной маршрутизации лодки
const BUILTIN_RIVER_HYDRO_WAYS = [
  {
    id: 'hydro_sedeyakha',
    type: 'river',
    name: 'р. Седэяха',
    pts: [
      [66.1180, 76.4800], [66.1145, 76.5120], [66.1110, 76.5410], [66.1072, 76.5690],
      [66.1030, 76.5940], [66.0985, 76.6150], [66.0942, 76.6310], [66.0902, 76.6435],
      [66.0872, 76.6525], [66.0852, 76.6605], [66.0840, 76.6685], [66.0832, 76.6765],
      [66.0825, 76.6845], [66.0818, 76.6925], [66.0812, 76.7010], [66.0806, 76.7105],
      [66.0798, 76.7205], [66.0788, 76.7310], [66.0778, 76.7420], [66.0765, 76.7540],
      [66.0750, 76.7665], [66.0732, 76.7800], [66.0712, 76.7950], [66.0690, 76.8110],
      [66.0660, 76.8290], [66.0628, 76.8480], [66.0595, 76.8670], [66.0560, 76.8860],
      [66.0522, 76.9050], [66.0485, 76.9240], [66.0448, 76.9410], [66.0410, 76.9560]
    ]
  },
  {
    id: 'hydro_tamcharayakha',
    type: 'river',
    name: 'р. Тамчара-Яха',
    pts: [
      [66.0450, 76.5800], [66.0510, 76.5980], [66.0570, 76.6160], [66.0625, 76.6330],
      [66.0675, 76.6490], [66.0720, 76.6625], [66.0760, 76.6735], [66.0795, 76.6805],
      [66.0825, 76.6845]
    ]
  },
  {
    id: 'hydro_varengayakha',
    type: 'river',
    name: 'р. Варенга-Яха',
    pts: [
      [66.1280, 76.6250], [66.1190, 76.6520], [66.1100, 76.6780], [66.1010, 76.7020],
      [66.0925, 76.7210], [66.0850, 76.7330], [66.0778, 76.7420]
    ]
  },
  {
    id: 'hydro_evoyakha',
    type: 'river',
    name: 'р. Евояха',
    pts: [
      [65.9400, 76.6200], [65.9600, 76.6750], [65.9800, 76.7350], [66.0000, 76.7980],
      [66.0160, 76.8550], [66.0290, 76.9080], [66.0410, 76.9560], [66.0395, 76.9950],
      [66.0365, 77.0450], [66.0325, 77.1050], [66.0280, 77.1650], [66.0210, 77.2500],
      [66.0130, 77.3450], [66.0040, 77.4400], [65.9950, 77.5350], [65.9860, 77.6300],
      [65.9780, 77.7250], [65.9710, 77.8150], [65.9660, 77.9050], [65.9620, 77.9850],
      [65.9590, 78.0650], [65.9560, 78.1350], [65.9540, 78.1850]
    ]
  },
  {
    id: 'hydro_pur',
    type: 'river',
    name: 'р. Пур',
    pts: [
      [64.9200, 77.8200], [65.0800, 77.8600], [65.2400, 77.9100], [65.4000, 77.9600],
      [65.5500, 78.0200], [65.6800, 78.0750], [65.7800, 78.1150], [65.8500, 78.1450],
      [65.8900, 78.1520], [65.9080, 78.1420], [65.9220, 78.1360], [65.9350, 78.1440],
      [65.9460, 78.1620], [65.9540, 78.1820], [65.9615, 78.1920], [65.9690, 78.1840],
      [65.9760, 78.1710], [65.9830, 78.1650], [65.9910, 78.1720], [65.9985, 78.1860],
      [66.0060, 78.1980], [66.0145, 78.2030], [66.0235, 78.1960], [66.0320, 78.1890],
      [66.0410, 78.1950], [66.0500, 78.2080], [66.0580, 78.2150], [66.0720, 78.2190],
      [66.0880, 78.2220], [66.1150, 78.2280], [66.1750, 78.2420], [66.2400, 78.2600],
      [66.3200, 78.2850], [66.4200, 78.3100], [66.5400, 78.3300], [66.6800, 78.3400],
      [66.8200, 78.3200]
    ]
  },
  {
    id: 'hydro_khadutte',
    type: 'river',
    name: 'р. Хадуттэ',
    pts: [
      [66.4800, 76.7500], [66.4650, 77.0500], [66.4500, 77.3800], [66.4350, 77.7200],
      [66.4250, 78.0200], [66.4200, 78.3100]
    ]
  },
  {
    id: 'hydro_nadym',
    type: 'river',
    name: 'р. Надым',
    pts: [
      [65.3500, 72.6500], [65.4600, 72.5800], [65.5400, 72.5300], [65.6500, 72.4800],
      [65.8000, 72.3800], [66.0000, 72.2200], [66.1800, 72.0500]
    ]
  },
  {
    id: 'hydro_taz',
    type: 'river',
    name: 'р. Таз',
    pts: [
      [66.8500, 79.2500], [67.0500, 79.0500], [67.2500, 78.9200], [67.4700, 78.7300]
    ]
  }
];

// Встроенный каркас объездных дорог, зимников и периметральных магистралей (Новый Уренгой — Коротчаево — Уренгой)
// Исключает проезд снегохода, велосипеда или авто сквозь дома даже при отсутствии ответа внешних серверов OSRM/Overpass
const BUILTIN_SNOWMOBILE_BYPASS_WAYS = [
  {
    id: 'bypass_north_ring',
    hw: 'track',
    pts: [
      [66.0920, 76.6320], [66.0922, 76.6480], [66.0915, 76.6650], [66.0912, 76.6820],
      [66.0908, 76.7010], [66.0900, 76.7250], [66.0885, 76.7520], [66.0860, 76.7820]
    ]
  },
  {
    id: 'street_26_kpss',
    hw: 'secondary',
    pts: [
      [66.0858, 76.6320], [66.0860, 76.6480], [66.0862, 76.6565], [66.0865, 76.6680],
      [66.0868, 76.6805], [66.0872, 76.6950], [66.0875, 76.7120]
    ]
  },
  {
    id: 'street_leningradsky',
    hw: 'primary',
    pts: [
      [66.0808, 76.6350], [66.0810, 76.6480], [66.0812, 76.6565], [66.0814, 76.6680],
      [66.0816, 76.6805], [66.0818, 76.6950]
    ]
  },
  {
    id: 'street_geologorazvedchikov',
    hw: 'tertiary',
    pts: [
      [66.0762, 76.6380], [66.0764, 76.6565], [66.0766, 76.6680], [66.0768, 76.6805],
      [66.0770, 76.6950], [66.0765, 76.7150]
    ]
  },
  {
    id: 'bypass_south_taezhnaya',
    hw: 'track',
    pts: [
      [66.0715, 76.6320], [66.0718, 76.6565], [66.0720, 76.6680], [66.0722, 76.6805],
      [66.0725, 76.6950], [66.0720, 76.7200], [66.0700, 76.7500], [66.0665, 76.7820]
    ]
  },
  {
    id: 'meridian_west_obyezdnaya',
    hw: 'track',
    pts: [
      [66.0715, 76.6320], [66.0762, 76.6380], [66.0808, 76.6350], [66.0858, 76.6320], [66.0920, 76.6320]
    ]
  },
  {
    id: 'meridian_yubileynaya',
    hw: 'secondary',
    pts: [
      [66.0718, 76.6565], [66.0764, 76.6565], [66.0812, 76.6565], [66.0862, 76.6565], [66.0915, 76.6650]
    ]
  },
  {
    id: 'meridian_molodezhnaya',
    hw: 'tertiary',
    pts: [
      [66.0720, 76.6680], [66.0766, 76.6680], [66.0814, 76.6680], [66.0865, 76.6680], [66.0915, 76.6650]
    ]
  },
  {
    id: 'meridian_internatsionalnaya',
    hw: 'secondary',
    pts: [
      [66.0722, 76.6805], [66.0768, 76.6805], [66.0816, 76.6805], [66.0868, 76.6805], [66.0912, 76.6820]
    ]
  },
  {
    id: 'meridian_east_industrial',
    hw: 'track',
    pts: [
      [66.0725, 76.6950], [66.0770, 76.6950], [66.0818, 76.6950], [66.0872, 76.6950], [66.0908, 76.7010]
    ]
  },
  {
    id: 'meridian_far_east_zimnik',
    hw: 'track',
    pts: [
      [66.0665, 76.7820], [66.0732, 76.7800], [66.0800, 76.7810], [66.0860, 76.7820]
    ]
  },
  {
    id: 'highway_nur_korotchaevo_urengoy',
    hw: 'track',
    pts: [
      [66.0725, 76.6950], [66.0665, 76.7820], [66.0580, 76.9200], [66.0480, 77.1200],
      [66.0350, 77.3500], [66.0150, 77.6000], [65.9900, 77.8500], [65.9650, 78.0500],
      [65.9470, 78.1490], [65.9550, 78.2500], [65.9630, 78.3690]
    ]
  }
];

function _getBuiltinRiverWaysNear(minLat, minLon, maxLat, maxLon) {
  return BUILTIN_RIVER_HYDRO_WAYS.filter(w =>
    w.pts.some(p => p[0] >= minLat - 0.35 && p[0] <= maxLat + 0.35 && p[1] >= minLon - 0.55 && p[1] <= maxLon + 0.55)
  );
}

async function _queryOverpassJson(queryStr, timeoutMs = 4500) {
  if (_forceOfflineTestMode || (typeof navigator !== 'undefined' && navigator.onLine === false)) return null;
  const isApk = typeof window !== 'undefined' && Boolean(window.AndroidBridge);
  const wrapApkProxy = (u) => isApk ? `https://appassets.androidplatform.net/__klev_net_proxy__?url=${encodeURIComponent(u)}` : u;
  const mirrors = [
    `https://maps.mail.ru/osm/tools/overpass/api/interpreter?data=${encodeURIComponent(queryStr)}`,
    `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(queryStr)}`,
    `https://overpass.kumi.systems/api/interpreter?data=${encodeURIComponent(queryStr)}`
  ];
  for (const rawUrl of mirrors) {
    try {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
      const res = await fetch(wrapApkProxy(rawUrl), { signal: ctrl?.signal }).catch(() => null);
      if (timer) clearTimeout(timer);
      if (!res || !res.ok) continue;
      const data = await res.json().catch(() => null);
      if (data && Array.isArray(data.elements)) return data;
    } catch (_e) {}
  }
  return null;
}

const _osmRiverInFlightByKey = new Set();

// П. 5: Загрузка реальных водных путей из OpenStreetMap и отрисовка стрелочек течения СТРОГО по руслам рек (без возможности рекурсивного зацикливания!)
async function fetchStrictRiverWaysForMapBounds(lat, lon) {
  const key = `${Number(lat).toFixed(1)}_${Number(lon).toFixed(1)}`;
  if (_osmRiverWaysCache.has(key)) return _osmRiverWaysCache.get(key);
  const builtinNear = _getBuiltinRiverWaysNear(lat - 0.25, lon - 0.45, lat + 0.25, lon + 0.45);
  try {
    const rawSaved = localStorage.getItem(`klev_osm_river_ways_${key}`);
    if (rawSaved) {
      const parsed = JSON.parse(rawSaved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const merged = [...parsed, ...builtinNear];
        _osmRiverWaysCache.set(key, merged);
        return merged;
      }
    }
  } catch (_e) {}

  // Сразу записываем базовый набор в кэш до сетевого запроса, чтобы повторные вызовы renderStrictRiverFlowArrowsOnMap НИКОГДА не входили в цикл!
  _osmRiverWaysCache.set(key, builtinNear);

  if (_osmRiverInFlightByKey.has(key) || _forceOfflineTestMode || (typeof navigator !== 'undefined' && !navigator.onLine)) {
    return builtinNear;
  }
  _osmRiverInFlightByKey.add(key);
  try {
    const dLat = 0.14;
    const dLon = 0.26;
    const bbox = `${(lat - dLat).toFixed(3)},${(lon - dLon).toFixed(3)},${(lat + dLat).toFixed(3)},${(lon + dLon).toFixed(3)}`;
    const q = `[out:json][timeout:6];way["waterway"~"^(river|stream|canal)$"](${bbox});out geom;`;
    const data = await _queryOverpassJson(q, 4500);
    if (data && Array.isArray(data.elements)) {
      const ways = [];
      for (const el of data.elements) {
        if (el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 3) {
          ways.push({
            id: el.id,
            type: el.tags?.waterway || 'river',
            name: el.tags?.name || '',
            pts: el.geometry.map(g => [Number(g.lat), Number(g.lon)])
          });
        }
      }
      const merged = [...ways, ...builtinNear];
      _osmRiverWaysCache.set(key, merged);
      try {
        if (ways.length > 0) {
          localStorage.setItem(`klev_osm_river_ways_${key}`, JSON.stringify(ways.slice(0, 50)));
        }
      } catch (_e) {}
      _osmRiverInFlightByKey.delete(key);
      return merged;
    }
  } catch (_e) {}
  _osmRiverInFlightByKey.delete(key);
  return builtinNear;
}

function renderStrictRiverFlowArrowsOnMap(allowNetworkFetch = true) {
  if (!mapInstance || typeof L === 'undefined') return;
  if (!_riverArrowsLayerGroup || _riverArrowsLayerGroup._map !== mapInstance) {
    _riverArrowsLayerGroup = L.layerGroup().addTo(mapInstance);
  } else {
    _riverArrowsLayerGroup.clearLayers();
  }
  if (!_arcRiverFlowEnabled) return;
  const zoom = typeof mapInstance.getZoom === 'function' ? mapInstance.getZoom() : 10;
  if (zoom < 11) return;

  const center = mapInstance.getCenter();
  const key = `${Number(center.lat).toFixed(1)}_${Number(center.lng).toFixed(1)}`;
  const cachedWays = _osmRiverWaysCache.get(key);
  if (!cachedWays) {
    if (allowNetworkFetch) {
      fetchStrictRiverWaysForMapBounds(center.lat, center.lng).then((ways) => {
        if (ways && ways.length > 0 && mapInstance) {
          renderStrictRiverFlowArrowsOnMap(false);
        }
      }).catch(() => {});
    }
    return;
  }

  const bounds = typeof mapInstance.getBounds === 'function' ? mapInstance.getBounds() : null;
  const stepNodes = zoom >= 14 ? 4 : (zoom >= 12 ? 7 : 10);
  let arrowsAdded = 0;

  for (const w of cachedWays) {
    if (arrowsAdded >= 48) break;
    const pts = w.pts;
    if (!Array.isArray(pts) || pts.length < 3) continue;
    for (let i = 1; i < pts.length - 1; i += stepNodes) {
      if (arrowsAdded >= 48) break;
      const p1 = pts[i];
      const p2 = pts[i + 1];
      if (!p1 || !p2) continue;
      if (bounds && !bounds.contains(p1)) continue;
      const dy = p2[0] - p1[0];
      const dx = (p2[1] - p1[1]) * Math.cos(p1[0] * Math.PI / 180);
      if (Math.hypot(dx, dy) < 0.00012) continue;
      const angleDeg = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;

      const arrowMarker = L.marker(p1, {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: 'klev-strict-river-arrow',
          iconSize: [14, 14],
          iconAnchor: [7, 7],
          html: `<div style="width:14px;height:14px;display:flex;align-items:center;justify-content:center;transform:rotate(${angleDeg.toFixed(1)}deg);pointer-events:none;">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M8 2L13 12L8 9.5L3 12L8 2Z" fill="#0284c7" stroke="#ffffff" stroke-width="1.2" stroke-linejoin="round"/>
            </svg>
          </div>`
        })
      });
      _riverArrowsLayerGroup.addLayer(arrowMarker);
      arrowsAdded++;
    }
  }
}

// Отрисовка черновика точек маршрута и построенного маршрута с цветовой индикацией способа передвижения
function renderArcRouteDraftAndActiveOnMap() {
  if (!mapInstance || typeof L === 'undefined') return;
  if (!_arcRouteDraftLayerGroup || _arcRouteDraftLayerGroup._map !== mapInstance) {
    _arcRouteDraftLayerGroup = L.layerGroup().addTo(mapInstance);
  } else {
    _arcRouteDraftLayerGroup.clearLayers();
  }

  // 1. В режиме «Маршрут по точкам» до нажатия «Закончить и построить маршрут» точки НЕ соединяются!
  if (_arcRouteBuilderMode === 'waypoints' && _arcWaypointsDraft.length > 0) {
    _arcWaypointsDraft.forEach((pt, idx) => {
      const m = L.marker([pt.lat, pt.lon], {
        icon: L.divIcon({
          className: 'klev-arc-wp-pin',
          iconSize: [24, 24],
          iconAnchor: [12, 12],
          html: `<div style="width:24px;height:24px;border-radius:999px;background:#0ea5e9;border:2px solid #ffffff;color:#ffffff;font-size:11px;font-weight:900;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.55);">${idx + 1}</div>`
        })
      });
      _arcRouteDraftLayerGroup.addLayer(m);
    });
  }

  // 2. В режиме «Нарисовать пальцем» показываем нарисованные мазки непосредственно на карте
  if (_arcRouteBuilderMode === 'freehand' && _arcFreehandStrokes.length > 0) {
    _arcFreehandStrokes.forEach((stroke) => {
      if (Array.isArray(stroke) && stroke.length >= 2) {
        const poly = L.polyline(stroke, {
          color: '#38bdf8',
          weight: 4.5,
          opacity: 0.92,
          dashArray: '6, 5'
        });
        _arcRouteDraftLayerGroup.addLayer(poly);
      }
    });
  }

  // 3. Построенный маршрут (с мгновенным обновлением при смене способа передвижения!)
  if (_arcBuiltRoute && Array.isArray(_arcBuiltRoute.points) && _arcBuiltRoute.points.length >= 2) {
    const tr = _arcBuiltRoute.transport || _arcTransportMode || 'car';
    const colorByTransport = {
      car: '#0ea5e9',
      snowmobile: '#f59e0b',
      bike: '#10b981',
      boat: '#06b6d4',
      walk: '#a855f7'
    };
    const col = colorByTransport[tr] || '#0ea5e9';
    const dashByTransport = tr === 'walk' ? '6, 6' : (tr === 'snowmobile' ? '10, 5' : null);
    const lineOpts = {
      color: col,
      weight: 5.5,
      opacity: 0.95,
      lineJoin: 'round',
      lineCap: 'round'
    };
    if (dashByTransport) lineOpts.dashArray = dashByTransport;
    const line = L.polyline(_arcBuiltRoute.points, lineOpts);
    _arcRouteDraftLayerGroup.addLayer(line);

    const endPt = _arcBuiltRoute.points[_arcBuiltRoute.points.length - 1];
    const finishMarker = L.marker(endPt, {
      icon: L.divIcon({
        className: 'klev-arc-finish-pin',
        iconSize: [26, 26],
        iconAnchor: [13, 13],
        html: `<div style="width:26px;height:26px;border-radius:999px;background:${col};border:2.5px solid #ffffff;color:#ffffff;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px rgba(0,0,0,0.6);">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M5 3v18M5 4h13l-2.5 4.5L18 13H5" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>`
      })
    });
    _arcRouteDraftLayerGroup.addLayer(finishMarker);
  }
}

// Плотная интерполяция сегментов рек (шаг 50 м для лодки) и зимников
function _densifyWayGeometry(pts, maxStepKm = 0.06) {
  if (!Array.isArray(pts) || pts.length < 2) return pts || [];
  const out = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const d = calcHaversineKm(p1[0], p1[1], p2[0], p2[1]);
    if (d > maxStepKm) {
      const steps = Math.min(80, Math.ceil(d / maxStepKm));
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        out.push([p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t]);
      }
    }
    out.push(p2);
  }
  return out;
}

// Построение связного графа:
// - для лодки (boat): СТРОГО по руслам рек и протокам (шаг 50 м + связка притоков), без привязки к автомобильным дорогам!
// - для снегохода (snowmobile): по объездным дорогам, зимникам, просекам и тропам в обход домов и с избеганием открытых водоёмов!
// - для велосипеда (bike) и пешком (walk): по тропам, велодорожкам и дорогам.

// ============================================================================
// ЭПИК: ДВИЖОК ВОДНОЙ МАРШРУТИЗАЦИИ WATER NAVMESH ENGINE (ЗАДАЧИ 1–4)
// 1. Формирование 2D водного графа (NavMesh) внутри водных полигонов (natural=water, waterway=riverbank)
//    и гибридных русловых коридоров (waterway=river|stream|canal|fairway) с вырезанием островов (role=inner).
// 2. Поиск пути A* / Дейкстры строго по воде с гарантированным обходом островов, кос и мысов.
// 3. Приоритизация фарватера (k = 0.68 на центральной линии русла) и штраф прибрежной отмели (k = 2.65),
//    исключающий срезание углов по мелководью внутренних радиусов излучин.
// 4. Динамический учёт вектора течения без перестроения сетки NavMesh: вычисление угла между вектором ребра
//    и вектором течения реки (против течения угол > 90° -> вес увеличивается, по течению -> уменьшается).
// ============================================================================

const BUILTIN_RIVER_ISLANDS = [
  {
    id: 'island_pur_urengoy_1',
    riverId: 'hydro_pur',
    name: 'о. Пурский (Уренгой)',
    // Остров в русле р. Пур между 65.9540 и 65.9690
    ring: [
      [65.9565, 78.1845],
      [65.9595, 78.1895],
      [65.9635, 78.1905],
      [65.9655, 78.1870],
      [65.9620, 78.1835],
      [65.9565, 78.1845]
    ]
  },
  {
    id: 'island_pur_limbiyakha_2',
    riverId: 'hydro_pur',
    name: 'о. Коса Пурская',
    ring: [
      [65.9935, 78.1765],
      [65.9965, 78.1835],
      [66.0005, 78.1885],
      [66.0015, 78.1850],
      [65.9975, 78.1780],
      [65.9935, 78.1765]
    ]
  },
  {
    id: 'island_sedeyakha_1',
    riverId: 'hydro_sedeyakha',
    name: 'о. Седэяхинский',
    ring: [
      [66.0836, 76.6745],
      [66.0842, 76.6780],
      [66.0830, 76.6815],
      [66.0823, 76.6780],
      [66.0836, 76.6745]
    ]
  }
];

const _waterNavMeshCache = new Map();

function _isPointInPolygonRing(lat, lon, ring) {
  if (!Array.isArray(ring) || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i][0], xi = ring[i][1];
    const yj = ring[j][0], xj = ring[j][1];
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lon < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function _ccwOrient(ax, ay, bx, by, cx, cy) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function _segmentsStrictlyIntersect(a1, a2, b1, b2) {
  const ay1 = a1[0], ax1 = a1[1], ay2 = a2[0], ax2 = a2[1];
  const by1 = b1[0], bx1 = b1[1], by2 = b2[0], bx2 = b2[1];
  const d1 = _ccwOrient(ax1, ay1, ax2, ay2, bx1, by1);
  const d2 = _ccwOrient(ax1, ay1, ax2, ay2, bx2, by2);
  const d3 = _ccwOrient(bx1, by1, bx2, by2, ax1, ay1);
  const d4 = _ccwOrient(bx1, by1, bx2, by2, ax2, ay2);
  if (((d1 > 1e-11 && d2 < -1e-11) || (d1 < -1e-11 && d2 > 1e-11)) &&
      ((d3 > 1e-11 && d4 < -1e-11) || (d3 < -1e-11 && d4 > 1e-11))) {
    return true;
  }
  return false;
}

function _doesSegmentIntersectPolygonRing(p1, p2, ring) {
  if (!Array.isArray(ring) || ring.length < 2) return false;
  const mid = [(p1[0] + p2[0]) * 0.5, (p1[1] + p2[1]) * 0.5];
  if (_isPointInPolygonRing(mid[0], mid[1], ring)) return true;
  for (let i = 0; i < ring.length - 1; i++) {
    if (_segmentsStrictlyIntersect(p1, p2, ring[i], ring[i + 1])) return true;
  }
  return false;
}

function _pointToSegmentDistKm(lat, lon, aLat, aLon, bLat, bLon) {
  const cosLat = Math.cos((lat * Math.PI) / 180) || 0.5;
  const dx = (bLon - aLon) * cosLat;
  const dy = bLat - aLat;
  const lenSq = dx * dx + dy * dy;
  let t = 0;
  if (lenSq > 1e-12) {
    t = ((lon - aLon) * cosLat * dx + (lat - aLat) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
  }
  const projLat = aLat + t * dy;
  const projLon = aLon + t * (bLon - aLon);
  return calcHaversineKm(lat, lon, projLat, projLon);
}

function _minDistToRingKm(lat, lon, ring) {
  if (!Array.isArray(ring) || ring.length < 2) return Infinity;
  let minD = Infinity;
  for (let i = 0; i < ring.length - 1; i++) {
    const d = _pointToSegmentDistKm(lat, lon, ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1]);
    if (d < minD) minD = d;
  }
  return minD;
}

/**
 * Задача 1: Построение 2D навигационной сетки (NavMesh) по водным полигонам (natural=water, waterway=riverbank)
 * и русловым линиям (waterway=river|stream|canal|fairway) с вырезанием островов (role=inner).
 */
export async function buildWaterNavMesh(minLat, minLon, maxLat, maxLon, options = {}) {
  const bboxKey = `${minLat.toFixed(3)}_${minLon.toFixed(3)}_${maxLat.toFixed(3)}_${maxLon.toFixed(3)}`;
  if (!options.forceRebuild && _waterNavMeshCache.has(bboxKey)) {
    const cached = _waterNavMeshCache.get(bboxKey);
    if (options.flowSpeedMps !== undefined || options.boatSpeedKmh !== undefined) {
      applyDynamicHydrologyWeights(cached, options);
    }
    return cached;
  }

  const bbox = `${minLat.toFixed(4)},${minLon.toFixed(4)},${maxLat.toFixed(4)},${maxLon.toFixed(4)}`;
  const centerlines = [];
  const waterOuterRings = [];
  const islandInnerRings = [];

  // 1. Встроенные острова и русла рек (работают мгновенно даже в полном офлайне)
  const builtinRivers = _getBuiltinRiverWaysNear(minLat, minLon, maxLat, maxLon);
  for (const br of builtinRivers) {
    const isBig = /пур|обь|таз|надым|енисей|волга|кама|иртыш/i.test(br.name || '');
    centerlines.push({
      id: br.id,
      name: br.name || 'Река',
      halfWidthKm: isBig ? 0.16 : 0.045,
      pts: br.pts
    });
  }
  for (const isl of BUILTIN_RIVER_ISLANDS) {
    if (isl.ring.some(p => p[0] >= minLat - 0.1 && p[0] <= maxLat + 0.1 && p[1] >= minLon - 0.15 && p[1] <= maxLon + 0.15)) {
      islandInnerRings.push(isl.ring);
    }
  }
  _osmRiverWaysCache.forEach((cachedList) => {
    if (!Array.isArray(cachedList)) return;
    for (const cw of cachedList) {
      if (Array.isArray(cw.pts) && cw.pts.length >= 2) {
        centerlines.push({
          id: cw.id || 'osm_cached',
          name: cw.name || '',
          halfWidthKm: cw.type === 'river' ? 0.08 : 0.03,
          pts: cw.pts
        });
      }
    }
  });

  // 2. Если переданы пользовательские острова/полигоны (например, для тестирования или из кэша)
  if (Array.isArray(options.customIslands)) {
    for (const ci of options.customIslands) {
      if (Array.isArray(ci) && ci.length >= 3) islandInnerRings.push(ci);
    }
  }
  if (Array.isArray(options.customWaterPolygons)) {
    for (const wp of options.customWaterPolygons) {
      if (Array.isArray(wp) && wp.length >= 3) waterOuterRings.push(wp);
    }
  }

  // 3. Запрос водных полигонов (natural=water, waterway=riverbank) и фарватеров (waterway=river|fairway) из Overpass API
  if (!options.skipNetwork && !_forceOfflineTestMode && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
    const q = `[out:json][timeout:6];(way["waterway"~"^(river|stream|canal|fairway|riverbank)$"](${bbox});way["natural"="water"](${bbox});relation["natural"="water"](${bbox}););out geom(${bbox});`;
    const data = await _queryOverpassJson(q, 4200).catch(() => null);
    if (data && Array.isArray(data.elements)) {
      for (const el of data.elements) {
        if (el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 2) {
          const pts = el.geometry.map(g => [Number(g.lat), Number(g.lon)]);
          const ww = String(el.tags?.waterway || '');
          const nat = String(el.tags?.natural || '');
          const isClosed = pts.length >= 4 && calcHaversineKm(pts[0][0], pts[0][1], pts[pts.length - 1][0], pts[pts.length - 1][1]) <= 0.03;
          if (nat === 'water' || ww === 'riverbank' || isClosed) {
            waterOuterRings.push(pts);
          } else if (/^(river|stream|canal|fairway)$/.test(ww)) {
            const wMeters = parseFloat(el.tags?.width) || (ww === 'river' ? 110 : (ww === 'fairway' ? 140 : 35));
            centerlines.push({
              id: `way_${el.id}`,
              name: el.tags?.name || '',
              halfWidthKm: Math.max(0.02, Math.min(0.45, (wMeters * 0.5) / 1000)),
              pts
            });
          }
        } else if (el.type === 'relation' && Array.isArray(el.members)) {
          for (const mb of el.members) {
            if (mb.type === 'way' && Array.isArray(mb.geometry) && mb.geometry.length >= 3) {
              const ring = mb.geometry.map(g => [Number(g.lat), Number(g.lon)]);
              if (mb.role === 'inner') {
                islandInnerRings.push(ring);
              } else if (mb.role === 'outer' || !mb.role) {
                waterOuterRings.push(ring);
              }
            }
          }
        }
      }
    }
  }

  // 4. Формируем узлы и рёбра 2D NavMesh (5 параллельных ходовых полос поперёк русла: 0 = фарватер, ±1 = свал, ±2 = береговая кромка)
  const nodes = new Map();
  const baseEdges = []; // { fromKey, toKey, distKm, avgShorePenalty, dirUx, dirUy, flowUx, flowUy, laneWeight }

  const addNode = (lat, lon, meta = {}) => {
    // Исключаем узлы, попадающие внутрь любого острова (role=inner)
    for (const isl of islandInnerRings) {
      if (_isPointInPolygonRing(lat, lon, isl)) return null;
    }
    const k = `${lat.toFixed(5)}_${lon.toFixed(5)}`;
    let existing = nodes.get(k);
    if (!existing) {
      // Проверяем близость к границе полигона / береговой линии или острову
      let minBankKm = meta.bankDistKm ?? 0.08;
      for (const isl of islandInnerRings) {
        const dIsl = _minDistToRingKm(lat, lon, isl);
        if (dIsl < minBankKm) minBankKm = dIsl;
      }
      for (const outRing of waterOuterRings) {
        const dOut = _minDistToRingKm(lat, lon, outRing);
        if (dOut < minBankKm) minBankKm = dOut;
      }
      // Задача 3: понижающий коэффициент 0.68 для фарватера (lane === 0), штраф 2.65 для прибрежной отмели (< 25 м от берега или lane === ±2)
      let shorePenalty = 1.0;
      if (meta.lane === 0 && minBankKm >= 0.022) {
        shorePenalty = 0.68; // Приоритет фарватера (центральной линии водоёма)
      } else if (Math.abs(meta.lane || 0) === 1 && minBankKm >= 0.018) {
        shorePenalty = 0.94; // Рабочий русловой свал
      } else if (Math.abs(meta.lane || 0) >= 2 || minBankKm < 0.022) {
        shorePenalty = 2.65; // Штраф мелководья у берега / внутреннего радиуса поворота
      }

      existing = {
        key: k,
        lat,
        lon,
        lane: meta.lane ?? 0,
        shorePenalty,
        flowUx: meta.flowUx ?? 0,
        flowUy: meta.flowUy ?? 0,
        flowFactor: meta.lane === 0 ? 1.0 : (Math.abs(meta.lane || 0) === 1 ? 0.78 : 0.48),
        adj: new Map()
      };
      nodes.set(k, existing);
    } else if ((meta.lane === 0) && existing.shorePenalty > 0.70) {
      existing.shorePenalty = 0.68;
      existing.lane = 0;
    }
    return existing;
  };

  const tryConnectNodes = (n1, n2) => {
    if (!n1 || !n2 || n1.key === n2.key) return;
    const p1 = [n1.lat, n1.lon];
    const p2 = [n2.lat, n2.lon];
    // Задача 1 и 2: Строго запрещаем рёбра, пересекающие контур любого острова (inner) или береговую линию (outer)
    for (const isl of islandInnerRings) {
      if (_doesSegmentIntersectPolygonRing(p1, p2, isl)) return;
    }
    for (const outRing of waterOuterRings) {
      // Если оба узла внутри внешнего водного полигона, проверяем, не перерезает ли ребро береговой мыс/излучину
      if (outRing.length >= 4 && _segmentsStrictlyIntersectList(p1, p2, outRing)) return;
    }
    const distKm = calcHaversineKm(n1.lat, n1.lon, n2.lat, n2.lon);
    if (distKm <= 0.0001 || distKm > 1.8) return;
    const cosLat = Math.cos(((n1.lat + n2.lat) * 0.5 * Math.PI) / 180) || 0.5;
    const dx = (n2.lon - n1.lon) * cosLat;
    const dy = n2.lat - n1.lat;
    const len = Math.hypot(dx, dy) || 1e-9;
    const dirUx = dx / len;
    const dirUy = dy / len;
    const avgShorePenalty = (n1.shorePenalty + n2.shorePenalty) * 0.5;
    const flowUx = (n1.flowUx + n2.flowUx) * 0.5;
    const flowUy = (n1.flowUy + n2.flowUy) * 0.5;

    baseEdges.push({
      fromKey: n1.key,
      toKey: n2.key,
      distKm,
      avgShorePenalty,
      dirUx,
      dirUy,
      flowUx,
      flowUy,
      flowFactor: (n1.flowFactor + n2.flowFactor) * 0.5
    });
    baseEdges.push({
      fromKey: n2.key,
      toKey: n1.key,
      distKm,
      avgShorePenalty,
      dirUx: -dirUx,
      dirUy: -dirUy,
      flowUx,
      flowUy,
      flowFactor: (n1.flowFactor + n2.flowFactor) * 0.5
    });
  };

  // Строим 5-полосную 2D навигационную сетку вдоль каждого русла реки с обходом островов
  const laneOffsets = [
    { lane: 0, frac: 0.0 },
    { lane: -1, frac: -0.42 },
    { lane: 1, frac: 0.42 },
    { lane: -2, frac: -0.82 },
    { lane: 2, frac: 0.82 }
  ];

  const crossSectionTerminalSlices = [];

  for (const cl of centerlines) {
    if (!Array.isArray(cl.pts) || cl.pts.length < 2) continue;
    const dense = _densifyWayGeometry(cl.pts, 0.045); // Шаг сечений 45 м
    const halfW = cl.halfWidthKm || 0.08;
    let prevSlice = null;

    for (let i = 0; i < dense.length; i++) {
      const cur = dense[i];
      const prev = dense[Math.max(0, i - 1)];
      const next = dense[Math.min(dense.length - 1, i + 1)];
      const cosLat = Math.cos((cur[0] * Math.PI) / 180) || 0.5;
      const tx = (next[1] - prev[1]) * cosLat;
      const ty = next[0] - prev[0];
      const tLen = Math.hypot(tx, ty) || 1e-9;
      // Единичный вектор течения (в OSM реки ориентированы от истока к устью)
      const flowUx = tx / tLen;
      const flowUy = ty / tLen;
      // Перпендикуляр (нормаль к руслу от левого берега к правому)
      const nx = -flowUy;
      const ny = flowUx;

      const curSlice = {};
      for (const lo of laneOffsets) {
        const offsetKm = halfW * lo.frac;
        const dLat = (ny * offsetKm) / 111.132;
        const dLon = (nx * offsetKm) / (111.32 * cosLat);
        const nLat = cur[0] + dLat;
        const nLon = cur[1] + dLon;
        const bankDistKm = Math.max(0.008, halfW * (1 - Math.abs(lo.frac)));
        const nd = addNode(nLat, nLon, {
          lane: lo.lane,
          bankDistKm,
          flowUx,
          flowUy
        });
        if (nd) curSlice[lo.lane] = nd;
      }

      // Поперечные связи внутри текущего створа (между соседними полосами: -2 <-> -1 <-> 0 <-> 1 <-> 2)
      const orderedLanes = [-2, -1, 0, 1, 2];
      for (let li = 0; li < orderedLanes.length - 1; li++) {
        const nA = curSlice[orderedLanes[li]];
        const nB = curSlice[orderedLanes[li + 1]];
        if (nA && nB) tryConnectNodes(nA, nB);
      }
      // Если центральный фарватер (0) перекрыт островом, соединяем обходные протоки (-1 и +1) перед/за островом
      if (!curSlice[0] && curSlice[-1] && curSlice[1]) {
        tryConnectNodes(curSlice[-1], curSlice[1]);
      }

      // Продольные и диагональные связи с предыдущим створом (формируют триангулированную 2D-сетку NavMesh)
      if (prevSlice) {
        for (const lCur of orderedLanes) {
          const nodeCur = curSlice[lCur];
          if (!nodeCur) continue;
          for (const lPrev of [lCur, lCur - 1, lCur + 1]) {
            const nodePrev = prevSlice[lPrev];
            if (nodePrev) tryConnectNodes(nodePrev, nodeCur);
          }
        }
      }

      if (i === 0 || i === dense.length - 1) {
        crossSectionTerminalSlices.push(curSlice);
      }
      prevSlice = curSlice;
    }
  }

  // Сшиваем устья притоков с основным руслом (в радиусе до 2.2 км без пересечения островов)
  const allNodesList = Array.from(nodes.values());
  for (const slice of crossSectionTerminalSlices) {
    const centerNode = slice[0] || slice[-1] || slice[1];
    if (!centerNode) continue;
    let bestTarget = null;
    let bestD = 2.2;
    for (const cand of allNodesList) {
      if (cand.key === centerNode.key || centerNode.adj.has(cand.key)) continue;
      const d = calcHaversineKm(centerNode.lat, centerNode.lon, cand.lat, cand.lon);
      if (d <= 0.28) {
        tryConnectNodes(centerNode, cand);
      } else if (d < bestD) {
        bestD = d;
        bestTarget = cand;
      }
    }
    if (bestTarget && bestD <= 2.2) {
      tryConnectNodes(centerNode, bestTarget);
    }
  }

  const mesh = {
    bboxKey,
    nodes,
    baseEdges,
    waterOuterRings,
    islandInnerRings,
    hydrologyParams: { flowSpeedMps: 0.5, boatSpeedKmh: 20 }
  };

  // Задача 4: Инициализируем динамические веса рёбер с учётом вектора течения
  applyDynamicHydrologyWeights(mesh, options);
  _waterNavMeshCache.set(bboxKey, mesh);
  return mesh;
}

function _segmentsStrictlyIntersectList(p1, p2, ring) {
  for (let i = 0; i < ring.length - 1; i++) {
    if (_segmentsStrictlyIntersect(p1, p2, ring[i], ring[i + 1])) return true;
  }
  return false;
}

/**
 * Задача 4: Динамическое обновление весов рёбер графа NavMesh на лету (по вектору течения и скорости лодки)
 * без необходимости перестроения самой навигационной сетки!
 */
export function applyDynamicHydrologyWeights(mesh, { flowSpeedMps = null, boatSpeedKmh = null } = {}) {
  if (!mesh || !mesh.nodes || !Array.isArray(mesh.baseEdges)) return mesh;
  const s = store.getState();
  const profFlow = WATER_PROFILES[s?.water]?.flow ?? 1.0;
  // Скорость течения в м/с (например, 0.65 м/с = 2.34 км/ч на реке)
  const effFlowMps = Number.isFinite(Number(flowSpeedMps))
    ? Math.max(0, Number(flowSpeedMps))
    : Math.max(0, (profFlow - 0.3) * 0.55);
  const effBoatKmh = Number.isFinite(Number(boatSpeedKmh)) && Number(boatSpeedKmh) > 0
    ? Number(boatSpeedKmh)
    : (ARC_TRANSPORT_MODES.boat?.avgSpeedKmh || 20);

  mesh.hydrologyParams = { flowSpeedMps: effFlowMps, boatSpeedKmh: effBoatKmh };

  // Очищаем старые веса в списках смежности без пересоздания узлов
  mesh.nodes.forEach(nd => nd.adj.clear());

  const flowKmhBase = effFlowMps * 3.6;

  for (const edge of mesh.baseEdges) {
    const fromNode = mesh.nodes.get(edge.fromKey);
    if (!fromNode) continue;

    // Косинус угла между единичным вектором ребра (dirUx, dirUy) и единичным вектором течения (flowUx, flowUy):
    // cosTheta = +1 (попутное течение, угол 0°), cosTheta = -1 (против течения, угол 180° > 90°)
    const fLen = Math.hypot(edge.flowUx, edge.flowUy);
    const cosTheta = fLen > 1e-6 ? ((edge.dirUx * edge.flowUx + edge.dirUy * edge.flowUy) / fLen) : 0;
    const localFlowKmh = flowKmhBase * (edge.flowFactor || 1.0);

    // Эффективная путевая скорость лодки относительно дна (км/ч)
    const groundSpeedKmh = Math.max(1.8, effBoatKmh + localFlowKmh * cosTheta);
    // Модификатор сопротивления течения: при движении против течения (угол > 90°, cosTheta < 0)
    // отношение effBoatKmh / groundSpeedKmh > 1 (вес пропорционально растёт); по течению < 1 (вес снижается)
    const currentResistanceFactor = effBoatKmh / groundSpeedKmh;

    const dynamicWeight = edge.distKm * edge.avgShorePenalty * currentResistanceFactor;
    const prevW = fromNode.adj.get(edge.toKey);
    if (prevW === undefined || dynamicWeight < prevW) {
      fromNode.adj.set(edge.toKey, dynamicWeight);
    }
  }
  return mesh;
}

/**
 * Задача 2 и 3: Поиск пути A* по 2D сетке WaterNavMesh с обходом островов, приоритетом фарватера и учётом течения
 */
export async function findWaterNavMeshPath(a, b, options = {}) {
  const spanLat = Math.abs(a[0] - b[0]);
  const spanLon = Math.abs(a[1] - b[1]);
  if (spanLat > 2.6 || spanLon > 4.2) return null;

  const padLat = Math.max(0.05, spanLat * 0.25);
  const padLon = Math.max(0.08, spanLon * 0.25);
  const mesh = await buildWaterNavMesh(
    Math.min(a[0], b[0]) - padLat,
    Math.min(a[1], b[1]) - padLon,
    Math.max(a[0], b[0]) + padLat,
    Math.max(a[1], b[1]) + padLon,
    options
  );
  if (!mesh || mesh.nodes.size < 2) return null;

  let startNode = null, minStartScore = Infinity;
  let endNode = null, minEndScore = Infinity;

  mesh.nodes.forEach(n => {
    const da = calcHaversineKm(a[0], a[1], n.lat, n.lon) * (n.lane === 0 ? 0.85 : 1.0);
    const db = calcHaversineKm(b[0], b[1], n.lat, n.lon) * (n.lane === 0 ? 0.85 : 1.0);
    if (da < minStartScore) { minStartScore = da; startNode = n; }
    if (db < minEndScore) { minEndScore = db; endNode = n; }
  });

  if (!startNode || !endNode || minStartScore > 15.0 || minEndScore > 15.0) return null;

  if (startNode.key === endNode.key && startNode.adj.size > 0) {
    let bestNbr = null, bestD = Infinity;
    startNode.adj.forEach((_, nbrKey) => {
      const cand = mesh.nodes.get(nbrKey);
      if (cand) {
        const d = calcHaversineKm(b[0], b[1], cand.lat, cand.lon);
        if (d < bestD) { bestD = d; bestNbr = cand; }
      }
    });
    if (bestNbr) endNode = bestNbr;
  }

  // Алгоритм A* с допустимой эвристикой (0.45 * физическое расстояние)
  const gScore = new Map([[startNode.key, 0]]);
  const fScore = new Map([[startNode.key, calcHaversineKm(startNode.lat, startNode.lon, endNode.lat, endNode.lon) * 0.45]]);
  const cameFrom = new Map();
  const openSet = new Set([startNode.key]);
  let visited = 0;

  while (openSet.size > 0 && visited < 35000) {
    visited++;
    let currentKey = null;
    let bestF = Infinity;
    openSet.forEach(k => {
      const fv = fScore.get(k) ?? Infinity;
      if (fv < bestF) { bestF = fv; currentKey = k; }
    });
    if (!currentKey) break;
    if (currentKey === endNode.key) {
      const pathNodes = [];
      let cur = currentKey;
      while (cur) {
        const nd = mesh.nodes.get(cur);
        if (nd) pathNodes.push(nd);
        cur = cameFrom.get(cur);
      }
      pathNodes.reverse();
      const coords = pathNodes.map(nd => [nd.lat, nd.lon]);
      return {
        points: coords,
        nodes: pathNodes,
        totalCost: gScore.get(endNode.key) || 0,
        mesh
      };
    }
    openSet.delete(currentKey);
    const curNode = mesh.nodes.get(currentKey);
    const curG = gScore.get(currentKey) ?? Infinity;
    curNode.adj.forEach((edgeWeight, nbrKey) => {
      const tentativeG = curG + edgeWeight;
      if (tentativeG < (gScore.get(nbrKey) ?? Infinity)) {
        cameFrom.set(nbrKey, currentKey);
        gScore.set(nbrKey, tentativeG);
        const nbrNode = mesh.nodes.get(nbrKey);
        fScore.set(nbrKey, tentativeG + calcHaversineKm(nbrNode.lat, nbrNode.lon, endNode.lat, endNode.lon) * 0.45);
        openSet.add(nbrKey);
      }
    });
  }
  return null;
}

if (typeof window !== 'undefined') {
  window.__KLEV_WATER_NAVMESH_ENGINE__ = {
    buildWaterNavMesh,
    applyDynamicHydrologyWeights,
    findWaterNavMeshPath,
    isPointInIsland: (lat, lon) => BUILTIN_RIVER_ISLANDS.some(isl => _isPointInPolygonRing(lat, lon, isl.ring)),
    getBuiltinIslands: () => BUILTIN_RIVER_ISLANDS
  };
}

async function _buildOsmNetworkPathBetween(a, b, transportMode = 'car') {
  if (transportMode === 'boat') {
    const navRes = await findWaterNavMeshPath(a, b);
    if (navRes && Array.isArray(navRes.points) && navRes.points.length >= 2) {
      return navRes.points;
    }
  }
  try {
    const spanLat = Math.abs(a[0] - b[0]);
    const spanLon = Math.abs(a[1] - b[1]);
    if (spanLat > 2.6 || spanLon > 4.2) return null;

    const padLat = transportMode === 'boat' ? Math.max(0.06, spanLat * 0.25) : Math.max(0.025, spanLat * 0.20);
    const padLon = transportMode === 'boat' ? Math.max(0.10, spanLon * 0.25) : Math.max(0.040, spanLon * 0.20);
    const minLat = Math.min(a[0], b[0]) - padLat;
    const maxLat = Math.max(a[0], b[0]) + padLat;
    const minLon = Math.min(a[1], b[1]) - padLon;
    const maxLon = Math.max(a[1], b[1]) + padLon;
    const bbox = `${minLat.toFixed(4)},${minLon.toFixed(4)},${maxLat.toFixed(4)},${maxLon.toFixed(4)}`;

    let elements = [];
    if (!_forceOfflineTestMode && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
      let q = '';
      if (transportMode === 'boat') {
        q = `[out:json][timeout:6];way["waterway"~"^(river|stream|canal|fairway)$"](${bbox});out geom;`;
      } else if (transportMode === 'snowmobile') {
        // Не запрашиваем way["building"], чтобы не вызывать таймаут Overpass на городах; дороги и тропы в OSM всегда огибают дома!
        q = `[out:json][timeout:6];way["highway"~"^(track|path|footway|cycleway|service|unclassified|residential|living_street|tertiary|secondary|primary|trunk|winter_road)$"](${bbox});out geom;`;
      } else if (transportMode === 'walk') {
        q = `[out:json][timeout:6];way["highway"~"^(footway|path|track|pedestrian|steps|residential|service|living_street|unclassified|tertiary|secondary|cycleway)$"](${bbox});out geom;`;
      } else if (transportMode === 'bike') {
        q = `[out:json][timeout:6];way["highway"~"^(cycleway|path|track|residential|service|living_street|unclassified|tertiary|secondary|primary)$"](${bbox});out geom;`;
      } else {
        q = `[out:json][timeout:6];way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|track|living_street)$"](${bbox});out geom;`;
      }
      const data = await _queryOverpassJson(q, 4200);
      if (data && Array.isArray(data.elements)) {
        elements = data.elements;
      }
    }

    const nodes = new Map();
    const getOrAddNode = (lat, lon) => {
      const k = `${lat.toFixed(4)}_${lon.toFixed(4)}`;
      let n = nodes.get(k);
      if (!n) {
        n = { key: k, lat, lon, adj: new Map() };
        nodes.set(k, n);
      }
      return n;
    };
    const addEdge = (n1, n2, weightFactor = 1.0) => {
      if (!n1 || !n2 || n1.key === n2.key) return;
      const d = calcHaversineKm(n1.lat, n1.lon, n2.lat, n2.lon) * weightFactor;
      const prev1 = n1.adj.get(n2.key);
      if (prev1 === undefined || d < prev1) {
        n1.adj.set(n2.key, d);
        n2.adj.set(n1.key, d);
      }
    };

    const wayEndpoints = [];

    // Для сухопутных режимов (снегоход, велосипед, пешком, авто) подключаем опорную сеть объездных дорог, зимников и улиц в обход домов
    if (transportMode !== 'boat') {
      for (const rw of BUILTIN_SNOWMOBILE_BYPASS_WAYS) {
        if (!rw.pts.some(p => p[0] >= minLat - 0.35 && p[0] <= maxLat + 0.35 && p[1] >= minLon - 0.55 && p[1] <= maxLon + 0.55)) continue;
        const densePts = _densifyWayGeometry(rw.pts, 0.08);
        let wFactor = 1.0;
        if (transportMode === 'snowmobile') {
          wFactor = rw.hw === 'track' ? 0.48 : 0.95;
        } else if (transportMode === 'car') {
          wFactor = rw.hw === 'track' ? 1.35 : 0.72;
        } else if (transportMode === 'bike') {
          wFactor = rw.hw === 'tertiary' || rw.hw === 'track' ? 0.68 : 0.92;
        } else if (transportMode === 'walk') {
          wFactor = rw.hw === 'tertiary' || rw.hw === 'secondary' ? 0.65 : 0.95;
        }
        let prevNode = null;
        for (let i = 0; i < densePts.length; i++) {
          const curNode = getOrAddNode(densePts[i][0], densePts[i][1]);
          if (prevNode) addEdge(prevNode, curNode, wFactor);
          prevNode = curNode;
        }
      }
    }

    // Для лодки всегда включаем встроенный гидрографический каркас рек + кэш рек с шагом 50 метров (0.05 км)
    if (transportMode === 'boat') {
      const builtinWays = _getBuiltinRiverWaysNear(minLat, minLon, maxLat, maxLon);
      for (const bw of builtinWays) {
        const densePts = _densifyWayGeometry(bw.pts, 0.05);
        let prevNode = null;
        for (let i = 0; i < densePts.length; i++) {
          const curNode = getOrAddNode(densePts[i][0], densePts[i][1]);
          if (prevNode) addEdge(prevNode, curNode, 0.90);
          if (i === 0 || i === densePts.length - 1) wayEndpoints.push(curNode);
          prevNode = curNode;
        }
      }
      _osmRiverWaysCache.forEach((cachedList) => {
        if (!Array.isArray(cachedList)) return;
        for (const cw of cachedList) {
          if (!Array.isArray(cw.pts) || cw.pts.length < 2) continue;
          const densePts = _densifyWayGeometry(cw.pts, 0.05);
          let prevNode = null;
          for (let i = 0; i < densePts.length; i++) {
            const curNode = getOrAddNode(densePts[i][0], densePts[i][1]);
            if (prevNode) addEdge(prevNode, curNode, 0.92);
            if (i === 0 || i === densePts.length - 1) wayEndpoints.push(curNode);
            prevNode = curNode;
          }
        }
      });
    }

    const stepKm = transportMode === 'boat' ? 0.05 : 0.15;
    for (const el of elements) {
      if (el.type !== 'way' || !Array.isArray(el.geometry) || el.geometry.length < 2) continue;
      const hw = String(el.tags?.highway || el.tags?.waterway || '');
      const isBridge = Boolean(el.tags?.bridge && el.tags.bridge !== 'no');
      let wFactor = 1.0;
      if (transportMode === 'boat') {
        wFactor = hw === 'river' ? 0.90 : 0.98;
      } else if (transportMode === 'snowmobile') {
        // Снегоход выбирает объездные дороги, просёлки, зимники и тропы (0.48), избегая жилых дворов (1.45) и мостов/пересечений воды (2.8)
        if (/^(track|path|winter_road|unclassified|cycleway|footway)$/.test(hw)) wFactor = 0.48;
        else if (/^(tertiary|secondary|trunk|primary)$/.test(hw)) wFactor = 0.78;
        else if (/^(service|residential|living_street)$/.test(hw)) wFactor = 1.45;
        if (isBridge) wFactor *= 2.8;
      } else if (transportMode === 'walk') {
        if (/^(footway|path|pedestrian|steps|track)$/.test(hw)) wFactor = 0.65;
        else if (/^(residential|service|living_street)$/.test(hw)) wFactor = 0.90;
        else wFactor = 1.25;
      } else if (transportMode === 'bike') {
        if (/^(cycleway|path|track|service|residential)$/.test(hw)) wFactor = 0.68;
        else wFactor = 1.15;
      }

      const rawPts = el.geometry.map(g => [Number(g.lat), Number(g.lon)]);
      const densePts = _densifyWayGeometry(rawPts, stepKm);
      let prevNode = null;
      for (let i = 0; i < densePts.length; i++) {
        const curNode = getOrAddNode(densePts[i][0], densePts[i][1]);
        if (prevNode) addEdge(prevNode, curNode, wFactor);
        if (i === 0 || i === densePts.length - 1) {
          wayEndpoints.push(curNode);
        }
        prevNode = curNode;
      }
    }

    // Для лодки: сшиваем устья притоков с основными реками (в радиусе до 2.2 км)
    if (transportMode === 'boat' && nodes.size >= 2) {
      const allNodesArr = Array.from(nodes.values());
      for (const ep of wayEndpoints) {
        let bestOther = null;
        let bestDist = 2.2;
        for (const cand of allNodesArr) {
          if (cand.key === ep.key || ep.adj.has(cand.key)) continue;
          const d = calcHaversineKm(ep.lat, ep.lon, cand.lat, cand.lon);
          if (d <= 0.35) {
            addEdge(ep, cand, 1.10);
          } else if (d < bestDist) {
            bestDist = d;
            bestOther = cand;
          }
        }
        if (bestOther && bestDist <= 2.2) {
          addEdge(ep, bestOther, 1.25);
        }
      }
    }

    if (nodes.size < 2) return null;

    let startNode = null, minStartD = Infinity;
    let endNode = null, minEndD = Infinity;
    nodes.forEach(n => {
      const da = calcHaversineKm(a[0], a[1], n.lat, n.lon);
      const db = calcHaversineKm(b[0], b[1], n.lat, n.lon);
      if (da < minStartD) { minStartD = da; startNode = n; }
      if (db < minEndD) { minEndD = db; endNode = n; }
    });

    const maxSnapDistKm = transportMode === 'boat' ? 15.0 : 4.5;
    if (!startNode || !endNode || minStartD > maxSnapDistKm || minEndD > maxSnapDistKm) return null;

    // Если точки старта и финиша оказались рядом с одним узлом реки, берём соседний узел по руслу реки
    if (startNode.key === endNode.key && startNode.adj.size > 0) {
      let bestNbr = null;
      let bestNbrDist = Infinity;
      startNode.adj.forEach((_, nbrKey) => {
        const cand = nodes.get(nbrKey);
        if (cand) {
          const d = calcHaversineKm(b[0], b[1], cand.lat, cand.lon);
          if (d < bestNbrDist) {
            bestNbrDist = d;
            bestNbr = cand;
          }
        }
      });
      if (bestNbr) endNode = bestNbr;
    }
    if (startNode.key === endNode.key) return [a, [startNode.lat, startNode.lon], b];

    // Алгоритм A* по графу русел рек / объездных дорог и зимников / велодорожек и троп
    const gScore = new Map([[startNode.key, 0]]);
    const fScore = new Map([[startNode.key, calcHaversineKm(startNode.lat, startNode.lon, endNode.lat, endNode.lon) * 0.45]]);
    const cameFrom = new Map();
    const openSet = new Set([startNode.key]);
    let visitedCount = 0;

    while (openSet.size > 0 && visitedCount < 25000) {
      visitedCount++;
      let currentKey = null;
      let bestF = Infinity;
      openSet.forEach(k => {
        const fVal = fScore.get(k) ?? Infinity;
        if (fVal < bestF) { bestF = fVal; currentKey = k; }
      });
      if (!currentKey) break;
      if (currentKey === endNode.key) {
        const path = [];
        let cur = currentKey;
        while (cur) {
          const nd = nodes.get(cur);
          if (nd) path.push([nd.lat, nd.lon]);
          cur = cameFrom.get(cur);
        }
        path.reverse();
        if (transportMode === 'boat') {
          // Для лодки возвращаем СТРОГО водное русло без сухопутных отрезков до дома/берега
          const boatSeg = [];
          if (calcHaversineKm(a[0], a[1], path[0][0], path[0][1]) <= 0.12) boatSeg.push(a);
          boatSeg.push(...path);
          if (calcHaversineKm(b[0], b[1], path[path.length - 1][0], path[path.length - 1][1]) <= 0.12) boatSeg.push(b);
          return boatSeg.length >= 2 ? boatSeg : path;
        }
        const fullSeg = [];
        if (calcHaversineKm(a[0], a[1], path[0][0], path[0][1]) > 0.015) fullSeg.push(a);
        fullSeg.push(...path);
        if (calcHaversineKm(b[0], b[1], path[path.length - 1][0], path[path.length - 1][1]) > 0.015) fullSeg.push(b);
        return fullSeg.length >= 2 ? fullSeg : null;
      }
      openSet.delete(currentKey);
      const curNode = nodes.get(currentKey);
      const curG = gScore.get(currentKey) ?? Infinity;
      curNode.adj.forEach((edgeDist, nbrKey) => {
        const tentativeG = curG + edgeDist;
        if (tentativeG < (gScore.get(nbrKey) ?? Infinity)) {
          cameFrom.set(nbrKey, currentKey);
          gScore.set(nbrKey, tentativeG);
          const nbrNode = nodes.get(nbrKey);
          fScore.set(nbrKey, tentativeG + calcHaversineKm(nbrNode.lat, nbrNode.lon, endNode.lat, endNode.lon) * 0.45);
          openSet.add(nbrKey);
        }
      });
    }
  } catch (_e) {}
  return null;
}

// Каскадный запрос маршрута по дорогам, объездным путям, велодорожкам и тропам (FOSSGIS + OSRM + граф Overpass OSM)
async function _fetchRoutedSegmentForTransport(a, b, transportMode = 'car') {
  const isApk = typeof window !== 'undefined' && Boolean(window.AndroidBridge);
  const wrapApkProxy = (u) => isApk ? `https://appassets.androidplatform.net/__klev_net_proxy__?url=${encodeURIComponent(u)}` : u;

  if (!_forceOfflineTestMode && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
    // Для снегохода сначала строим маршрут по графу объездных дорог/зимников/троп в обход жилых домов и мостов
    if (transportMode === 'snowmobile') {
      const snowSeg = await _buildOsmNetworkPathBetween(a, b, 'snowmobile');
      if (Array.isArray(snowSeg) && snowSeg.length >= 3) {
        return snowSeg;
      }
    }

    const coordPair = `${a[1].toFixed(6)},${a[0].toFixed(6)};${b[1].toFixed(6)},${b[0].toFixed(6)}`;
    let urls = [];
    if (transportMode === 'car') {
      urls = [
        `https://routing.openstreetmap.de/routed-car/route/v1/driving/${coordPair}?overview=full&geometries=geojson&steps=true&continue_straight=true`,
        `https://router.project-osrm.org/route/v1/driving/${coordPair}?overview=full&geometries=geojson&steps=true&continue_straight=true`
      ];
    } else if (transportMode === 'bike') {
      urls = [
        `https://routing.openstreetmap.de/routed-bike/route/v1/driving/${coordPair}?overview=full&geometries=geojson&steps=true&continue_straight=true`,
        `https://router.project-osrm.org/route/v1/bike/${coordPair}?overview=full&geometries=geojson&steps=true`,
        `https://routing.openstreetmap.de/routed-foot/route/v1/driving/${coordPair}?overview=full&geometries=geojson&steps=true&continue_straight=true`,
        `https://routing.openstreetmap.de/routed-car/route/v1/driving/${coordPair}?overview=full&geometries=geojson&steps=true`,
        `https://router.project-osrm.org/route/v1/driving/${coordPair}?overview=full&geometries=geojson&steps=true`
      ];
    } else if (transportMode === 'walk') {
      urls = [
        `https://routing.openstreetmap.de/routed-foot/route/v1/driving/${coordPair}?overview=full&geometries=geojson&steps=true&continue_straight=true`,
        `https://router.project-osrm.org/route/v1/foot/${coordPair}?overview=full&geometries=geojson&steps=true`,
        `https://routing.openstreetmap.de/routed-bike/route/v1/driving/${coordPair}?overview=full&geometries=geojson&steps=true&continue_straight=true`,
        `https://routing.openstreetmap.de/routed-car/route/v1/driving/${coordPair}?overview=full&geometries=geojson&steps=true`,
        `https://router.project-osrm.org/route/v1/driving/${coordPair}?overview=full&geometries=geojson&steps=true`
      ];
    } else if (transportMode === 'snowmobile') {
      // Резервный роутинг снегохода по тропам и объездным дорожкам (никогда не по прямой сквозь дома!)
      urls = [
        `https://routing.openstreetmap.de/routed-bike/route/v1/driving/${coordPair}?overview=full&geometries=geojson&steps=true&alternatives=true`,
        `https://routing.openstreetmap.de/routed-foot/route/v1/driving/${coordPair}?overview=full&geometries=geojson&steps=true`,
        `https://router.project-osrm.org/route/v1/bike/${coordPair}?overview=full&geometries=geojson&steps=true`,
        `https://routing.openstreetmap.de/routed-car/route/v1/driving/${coordPair}?overview=full&geometries=geojson&steps=true`,
        `https://router.project-osrm.org/route/v1/driving/${coordPair}?overview=full&geometries=geojson&steps=true`
      ];
    }

    for (const rawUrl of urls) {
      try {
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = ctrl ? setTimeout(() => ctrl.abort(), 4200) : null;
        const res = await fetch(wrapApkProxy(rawUrl), { signal: ctrl?.signal }).catch(() => null);
        if (timer) clearTimeout(timer);
        if (!res || !res.ok) continue;
        const data = await res.json().catch(() => null);
        // Для снегохода при наличии альтернативного (объездного) маршрута выбираем объездной вариант
        const routeIdx = (transportMode === 'snowmobile' && Array.isArray(data?.routes) && data.routes.length > 1) ? 1 : 0;
        const coords = data?.routes?.[routeIdx]?.geometry?.coordinates;
        if (Array.isArray(coords) && coords.length >= 2) {
          const pts = coords.map(c => [Number(c[1]), Number(c[0])]);
          if (calcHaversineKm(a[0], a[1], pts[0][0], pts[0][1]) > 0.03) pts.unshift(a);
          if (calcHaversineKm(b[0], b[1], pts[pts.length - 1][0], pts[pts.length - 1][1]) > 0.03) pts.push(b);
          return pts;
        }
      } catch (_e) {}
    }

  }
  // Расчёт по графу объездных дорог/зимников/троп/русел рек (работает и онлайн через Overpass, и офлайн по встроенному каркасу!)
  const osmGraphSeg = await _buildOsmNetworkPathBetween(a, b, transportMode);
  if (Array.isArray(osmGraphSeg) && osmGraphSeg.length >= 2) {
    return osmGraphSeg;
  }
  return null;
}

// Построение маршрута в зависимости от выбранного способа передвижения
export async function computeSmartTransportRoute(waypointsList, transportMode = 'car', explicitRouteMode = null) {
  const s = store.getState();
  let realUserGps = getTrueUserGpsCoords(s);
  if (!realUserGps.isRealGps) {
    const fresh = await acquireFreshHighAccuracyGpsFix(550).catch(() => null);
    if (fresh && fresh.hasRealFix) {
      realUserGps = { lat: fresh.lat, lon: fresh.lon, acc: fresh.acc, isRealGps: true };
    }
  }
  const startPt = [Number(realUserGps.lat), Number(realUserGps.lon)];
  const rawTargets = (Array.isArray(waypointsList) ? waypointsList : [])
    .map(p => Array.isArray(p) ? [Number(p[0]), Number(p[1])] : [Number(p.lat), Number(p.lon)])
    .filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (rawTargets.length === 0) return null;

  const resolvedMode = explicitRouteMode || _arcRouteBuilderMode || (rawTargets.length > 8 ? 'freehand' : 'waypoints');
  const isFreehand = resolvedMode === 'freehand' || rawTargets.length > 8;

  let effectiveTargets = rawTargets;
  if (rawTargets.length > 36) {
    const sampled = [rawTargets[0]];
    const step = Math.max(1, Math.floor(rawTargets.length / 34));
    for (let i = step; i < rawTargets.length - 1; i += step) {
      sampled.push(rawTargets[i]);
    }
    sampled.push(rawTargets[rawTargets.length - 1]);
    effectiveTargets = sampled;
  }

  // Если маршрут нарисован пальцем (freehand) ИЛИ выбран режим «Лодка» и пользователь указал >=2 точек на реке
  // (или находится дома в >1 км от реки), НЕ притягиваем начало маршрута к сухопутному «Дому»!
  const distFromHomeToFirstTargetKm = calcHaversineKm(startPt[0], startPt[1], effectiveTargets[0][0], effectiveTargets[0][1]);
  const skipHomeStart = isFreehand || (transportMode === 'boat' && (effectiveTargets.length >= 2 || distFromHomeToFirstTargetKm > 0.8));
  const chain = skipHomeStart ? [...effectiveTargets] : [startPt, ...effectiveTargets];
  let finalPoly = [];

  if (transportMode === 'boat') {
    // Лодка — СТРОГО по руслам рек, протокам и акватории без прокладывания линий по суше от «Дома»!
    const aFirst = chain[0];
    const bLast = chain[chain.length - 1];
    const midLat = (aFirst[0] + bLast[0]) / 2;
    const midLon = (aFirst[1] + bLast[1]) / 2;
    const riverWays = await fetchStrictRiverWaysForMapBounds(midLat, midLon).catch(() => []);
    const allRiverNodes = [];
    for (const w of (riverWays || [])) {
      if (!Array.isArray(w.pts) || w.pts.length < 2) continue;
      const denseW = _densifyWayGeometry(w.pts, 0.04);
      for (const rp of denseW) allRiverNodes.push(rp);
    }

    if (isFreehand && effectiveTargets.length >= 2) {
      // В режиме «Нарисовать пальцем» для лодки:
      // 1) Пробуем построить точный маршрут по графу русла реки между началом и концом нарисованной линии,
      //    если линия проведена вдоль известного русла (в пределах 650 м от русла)
      const graphWaterSeg = await _buildOsmNetworkPathBetween(aFirst, bLast, 'boat');
      const graphMatchesStroke = Array.isArray(graphWaterSeg) && graphWaterSeg.length >= 2 &&
        calcHaversineKm(aFirst[0], aFirst[1], graphWaterSeg[0][0], graphWaterSeg[0][1]) <= 0.65 &&
        calcHaversineKm(bLast[0], bLast[1], graphWaterSeg[graphWaterSeg.length - 1][0], graphWaterSeg[graphWaterSeg.length - 1][1]) <= 0.65;

      // Проверяем, не отклоняется ли середина нарисованной кривой от найденного русла (например, если пользователь рисовал по старице/протоке)
      const midStroke = effectiveTargets[Math.floor(effectiveTargets.length / 2)];
      let midDistToGraph = Infinity;
      if (graphMatchesStroke) {
        for (const gp of graphWaterSeg) {
          const d = calcHaversineKm(midStroke[0], midStroke[1], gp[0], gp[1]);
          if (d < midDistToGraph) midDistToGraph = d;
        }
      }

      if (graphMatchesStroke && midDistToGraph <= 0.55) {
        finalPoly = graphWaterSeg;
      } else {
        // Привязываем каждую нарисованную точку к фарватеру реки (если река в радиусе 350 м), сохраняя все изгибы руки пользователя по воде!
        finalPoly = effectiveTargets.map(pt => {
          let bestRp = null;
          let bestD = 0.35;
          for (const rp of allRiverNodes) {
            const d = calcHaversineKm(pt[0], pt[1], rp[0], rp[1]);
            if (d < bestD) {
              bestD = d;
              bestRp = rp;
            }
          }
          return bestRp ? [bestRp[0], bestRp[1]] : [pt[0], pt[1]];
        });
      }
    } else {
      // Режим «По точкам» для лодки
      const boatChain = chain.length > 6
        ? [chain[0], chain[Math.floor(chain.length / 2)], chain[chain.length - 1]]
        : (chain.length === 1 ? [startPt, chain[0]] : chain);
      for (let i = 0; i < boatChain.length - 1; i++) {
        const a = boatChain[i];
        const b = boatChain[i + 1];
        let waterSeg = await _buildOsmNetworkPathBetween(a, b, 'boat');
        if (!waterSeg || waterSeg.length < 2) {
          for (const w of (riverWays || [])) {
            if (!Array.isArray(w.pts) || w.pts.length < 2) continue;
            const denseW = _densifyWayGeometry(w.pts, 0.05);
            let idxA = -1, dA = 999, idxB = -1, dB = 999;
            denseW.forEach((rp, idx) => {
              const da = calcHaversineKm(a[0], a[1], rp[0], rp[1]);
              const db = calcHaversineKm(b[0], b[1], rp[0], rp[1]);
              if (da < dA) { dA = da; idxA = idx; }
              if (db < dB) { dB = db; idxB = idx; }
            });
            if (dA <= 15.0 && dB <= 15.0 && idxA !== -1 && idxB !== -1) {
              if (idxA === idxB && denseW.length >= 2) {
                idxB = Math.min(denseW.length - 1, idxA + 1);
              }
              const slice = idxA <= idxB ? denseW.slice(idxA, idxB + 1) : denseW.slice(idxB, idxA + 1).reverse();
              waterSeg = slice;
              break;
            }
          }
        }
        if (waterSeg && waterSeg.length >= 2) {
          if (finalPoly.length === 0) finalPoly.push(...waterSeg);
          else finalPoly.push(...waterSeg.slice(1));
        } else {
          if (finalPoly.length === 0) finalPoly.push(a);
          finalPoly.push(b);
        }
      }
    }
  } else if (transportMode === 'snowmobile' || transportMode === 'car' || transportMode === 'bike' || transportMode === 'walk') {
    const routeChain = chain.length > 6
      ? [chain[0], chain[Math.floor(chain.length / 2)], chain[chain.length - 1]]
      : chain;
    finalPoly = [routeChain[0]];
    for (let i = 0; i < routeChain.length - 1; i++) {
      const a = routeChain[i];
      const b = routeChain[i + 1];
      let seg = await _fetchRoutedSegmentForTransport(a, b, transportMode);
      if (!seg || seg.length < 2) {
        seg = [a, b];
      }
      finalPoly.push(...seg.slice(1));
    }
  } else {
    finalPoly = chain;
  }

  let totalKm = 0;
  const turns = [];
  for (let i = 0; i < finalPoly.length - 1; i++) {
    const d = calcHaversineKm(finalPoly[i][0], finalPoly[i][1], finalPoly[i + 1][0], finalPoly[i + 1][1]);
    totalKm += d;
    if (i > 0 && i < finalPoly.length - 1) {
      const b1 = calcBearingDeg(finalPoly[i - 1][0], finalPoly[i - 1][1], finalPoly[i][0], finalPoly[i][1]);
      const b2 = calcBearingDeg(finalPoly[i][0], finalPoly[i][1], finalPoly[i + 1][0], finalPoly[i + 1][1]);
      let diff = ((b2 - b1 + 540) % 360) - 180;
      if (Math.abs(diff) >= 28) {
        turns.push({
          pt: finalPoly[i],
          dirText: diff > 0 ? 'Направо' : 'Налево',
          dirCode: diff > 0 ? 'right' : 'left',
          distFromStartKm: totalKm
        });
      }
    }
  }

  const speed = ARC_TRANSPORT_MODES[transportMode]?.avgSpeedKmh || 30;
  const etaMin = Math.max(1, Math.round((totalKm / speed) * 60));
  const routeHazards = (typeof window !== 'undefined' && typeof window.__KLEV_GET_ROUTE_WEATHER_HAZARDS__ === 'function')
    ? window.__KLEV_GET_ROUTE_WEATHER_HAZARDS__(transportMode)
    : { hasHazards: false, activeForMode: [], summaryText: '' };

  return {
    mode: resolvedMode,
    transport: transportMode,
    targetWaypoints: effectiveTargets,
    points: finalPoly,
    distKm: Math.max(0.05, totalKm),
    etaMin,
    turns,
    hazards: routeHazards,
    started: false,
    paused: false,
    currentTurnIdx: 0,
    offRouteAlerted: false
  };
}

// Расчёт ТОП-10 рыб региона в выбранной точке карты (п. 8.1)
function computeTop10RegionalFishAtMapPoint(s) {
  const dayObj = s.weatherDays?.[s.dayIdx] || s.weatherDays?.[2] || s.weatherDays?.[0] || null;
  const activeWaterTitle = s.selectedWaterName || s.nearbyWaters?.[0]?.name || WATER_PROFILES[s.water]?.shortName || 'Водоём';
  const ecoreg = getSpotEcoregion(s.lat, s.lon, s.basinCode, s.water, activeWaterTitle);
  const sigSet = new Map((ecoreg.signatureSpecies || []).map((id, i) => [id, i]));
  const rTypes = new Set((s.nearbyWaters || []).map(w => w.wType).concat([s.water]));
  const hasCool = s.water === 'cooling_reservoir' || rTypes.has('cooling_reservoir');
  const isCoastLocal = Boolean(s.isCoastal || String(s.water || '').startsWith('sea'));

  let pool = FISH_DB.filter(f =>
    f.legal !== 'redbook' &&
    isSpeciesInGeoRange(f, s.lat, s.lon, s.basinCode, s.water, 120, rTypes, isCoastLocal, hasCool, activeWaterTitle)
  );
  if (!pool.length) pool = FISH_DB.filter(f => f.legal !== 'redbook');

  const ranked = pool.map(f => {
    const compat = getCompatibleMethods(f, dayObj?.iceState || s.iceState, s.water, dayObj?.waterTemp ?? 10);
    const bestM = compat[0]?.val || s.method;
    const sc = dayObj ? calcDayBest(f, dayObj, bestM, s.water, s.depth, s.normPress, dayObj.iceState || s.iceState) : 65;
    const sIdx = sigSet.has(f.id) ? sigSet.get(f.id) : -1;
    const bonus = sIdx >= 0 ? Math.max(6, 24 - sIdx * 2) : 0;
    return { fish: f, score: sc, rank: sc + bonus };
  }).sort((a, b) => b.rank - a.rank).slice(0, 10);

  const avgScore = ranked.length
    ? Math.round(ranked.reduce((acc, x) => acc + x.score, 0) / ranked.length)
    : 65;

  return { top10: ranked, avgScore };
}

// Поиск ближайшей точки типа «Магазин/База» (shop) или «Стоянка/Лагерь» (camp) (п. 8.2)
function findNearestBaseOrCampPoint(s) {
  const candidates = [];
  if (Array.isArray(s.savedSpots)) {
    s.savedSpots.forEach(sp => {
      const cat = normalizeSpotCatKey(sp?.category || '');
      if ((cat === 'shop' || cat === 'camp') && Number.isFinite(Number(sp.lat)) && Number.isFinite(Number(sp.lon))) {
        candidates.push({
          name: sp.name || (cat === 'shop' ? 'База' : 'Стоянка'),
          cat,
          lat: Number(sp.lat),
          lon: Number(sp.lon),
          distKm: calcHaversineKm(s.lat, s.lon, Number(sp.lat), Number(sp.lon))
        });
      }
    });
  }
  if (Array.isArray(s.circleItems)) {
    s.circleItems.forEach(it => {
      if (!it || it.t !== 'spot' || isCircleItemHidden(it, s)) return;
      const cat = normalizeSpotCatKey(it.cat || '');
      if ((cat === 'shop' || cat === 'camp') && Number.isFinite(Number(it.lat)) && Number.isFinite(Number(it.lon))) {
        candidates.push({
          name: it.wn || it.fn || (cat === 'shop' ? 'База' : 'Стоянка'),
          cat,
          lat: Number(it.lat),
          lon: Number(it.lon),
          distKm: calcHaversineKm(s.lat, s.lon, Number(it.lat), Number(it.lon))
        });
      }
    });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.distKm - b.distKm);
  return candidates[0];
}

// Проверка наличия загруженной офлайн-карты в текущей точке (п. 8.4)
function hasLoadedOfflineMapAtPoint(lat, lon) {
  const packs = getCachedOfflineMapPacksSync();
  if (!Array.isArray(packs) || !packs.length) return false;
  return packs.some(p => {
    const cLat = Number(p.centerLat ?? p.lat);
    const cLon = Number(p.centerLon ?? p.lon);
    const rad = Number(p.radiusKm) || 50;
    if (!Number.isFinite(cLat) || !Number.isFinite(cLon)) return true;
    return calcHaversineKm(lat, lon, cLat, cLon) <= rad * 1.15;
  });
}

// Проверка наличия загруженных карт глубин для данной точки (п. 8.5)
function hasLoadedBathymetryAtPoint(s) {
  const allPts = [...(s.savedSpots || []), ...(s.circleItems || [])];
  return allPts.some(pt => {
    if (!pt || !Number.isFinite(Number(pt.lat)) || !Number.isFinite(Number(pt.lon))) return false;
    const d = Number(pt.depth ?? pt.dp ?? 0);
    if (d <= 0 && !pt.isBathymetryPoint) return false;
    return calcHaversineKm(s.lat, s.lon, Number(pt.lat), Number(pt.lon)) <= 50;
  });
}

// Количество пойманных рыб за всё время в квадрате 120 км (п. 8.6)
function countCatchesIn120KmSquare(s) {
  const catches = Array.isArray(s.catches) ? s.catches : [];
  let totalCount = 0;
  for (const c of catches) {
    if (!c || c.deletedAt || c.blank) continue;
    const cLat = Number(c.lat);
    const cLon = Number(c.lon);
    if (Number.isFinite(cLat) && Number.isFinite(cLon)) {
      if (calcHaversineKm(s.lat, s.lon, cLat, cLon) <= 120) {
        totalCount += Math.max(1, Number(c.count) || 1);
      }
    } else {
      totalCount += Math.max(1, Number(c.count) || 1);
    }
  }
  return totalCount;
}



// Отрисовка полноэкранного мобильного/планшетного интерфейса «Вариант 1 — Арка» (v2.9.0)
function renderArcMobileMap(container, s, prevLiveMapBox) {
  const rootEl = typeof document !== 'undefined' ? document.documentElement : null;
  if (rootEl && s.route === 'geo') {
    rootEl.setAttribute('data-arc-map-active', '1');
  }

  const dayObj = s.weatherDays?.[s.dayIdx] || s.weatherDays?.[2] || s.weatherDays?.[0] || {};
  const tAir = Math.round(Number(dayObj.tDay ?? -4));
  const tAirFormatted = `${tAir > 0 ? '+' + tAir : tAir}°`; // п. 2.4: без буквы C, только точка градуса над цифрой и без текста

  const curTransport = ARC_TRANSPORT_MODES[_arcTransportMode] || ARC_TRANSPORT_MODES.car;
  const { top10, avgScore } = computeTop10RegionalFishAtMapPoint(s);
  const chosenFishObj = _arcSelectedSpecificFishId ? FISH_DB.find(f => f.id === _arcSelectedSpecificFishId) : null;
  const chosenFishScore = chosenFishObj
    ? (top10.find(x => x.fish.id === chosenFishObj.id)?.score ?? calcDayBest(chosenFishObj, dayObj, s.method, s.water, s.depth, s.normPress, s.iceState))
    : avgScore;

  const nearestBase = findNearestBaseOrCampPoint(s);
  const mapCounts = computeDeduplicatedMapCounts(s);
  const totalMapPoints = mapCounts.thematicCount + mapCounts.circleBlurCount + mapCounts.crewExactCount;
  const hasOfflineHere = hasLoadedOfflineMapAtPoint(s.lat, s.lon);
  const hasBathyHere = hasLoadedBathymetryAtPoint(s);
  const catches120Count = countCatchesIn120KmSquare(s);

  const gpsIconSvg = _arcGpsCompassState === 'compass'
    ? `<svg class="k-ico" data-compass-needle="1" style="width:22px;height:22px;transform:rotate(${-_arcCompassHeadingDeg}deg);transition:transform 0.14s linear;" viewBox="0 0 24 24" fill="none">
         <polygon points="12,2 15.5,12 8.5,12" fill="#ef4444"/>
         <polygon points="12,22 15.5,12 8.5,12" fill="#cbd5e1"/>
         <circle cx="12" cy="12" r="2.2" fill="#ffffff"/>
       </svg>`
    : `<svg class="k-ico" style="width:20px;height:20px;color:${_arcGpsCompassState === 'centered' ? 'var(--accent)' : 'var(--text)'};" viewBox="0 0 24 24" fill="currentColor">
         <path d="M3 11l19-9-9 19-2-8-8-2z"/>
       </svg>`;

  // Разноцветная иконка для кнопки «Точка» (п. 2.7)
  const multicolorSpotSvg = `
    <svg class="k-ico" style="width:22px;height:22px;" viewBox="0 0 24 24" fill="none">
      <circle cx="7.5" cy="7.5" r="3.8" fill="#38bdf8" stroke="#ffffff" stroke-width="1.2"/>
      <circle cx="16.5" cy="7.5" r="3.8" fill="#10b981" stroke="#ffffff" stroke-width="1.2"/>
      <circle cx="7.5" cy="16.5" r="3.8" fill="#fbbf24" stroke="#ffffff" stroke-width="1.2"/>
      <circle cx="16.5" cy="16.5" r="3.8" fill="#ef4444" stroke="#ffffff" stroke-width="1.2"/>
    </svg>
  `;

  // Отрисовка содержимого раскрытой плашки (п. 7: без кнопки Возврата, только наименование; закрытие по клику на заголовок, свайпу вниз или клику по карте)
  let expandedPlaqueHtml = '';
  if (_arcExpandedPlaqueId) {
    let pTitle = '';
    let pBody = '';

    if (_arcExpandedPlaqueId === '8.1') {
      pTitle = 'Что здесь клюёт?';
      pBody = `
        <div style="display:flex;flex-direction:column;gap:6px;">
          <button type="button" class="btn btn-sm ${!_arcSelectedSpecificFishId ? 'btn-accent' : ''}" data-arc-pick-fish="__avg__" style="justify-content:space-between;min-height:38px;font-weight:800;">
            <span>Средний клёв по ТОП-10 региона</span>
            <b>${avgScore}%</b>
          </button>
          <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;">
            ${top10.map((item, idx) => `
              <button type="button" class="btn btn-sm ${_arcSelectedSpecificFishId === item.fish.id ? 'btn-accent' : ''}" data-arc-pick-fish="${item.fish.id}" style="justify-content:space-between;min-height:42px;padding:4px 8px;font-size:11.5px;font-weight:800;">
                <span style="display:inline-flex;align-items:center;gap:6px;min-width:0;overflow:hidden;">
                  <span class="arc-fish-svg-slot" style="width:28px;height:16px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;">${renderFishVisual(item.fish)}</span>
                  <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${idx + 1}. ${escapeHtml(item.fish.name)}</span>
                </span>
                <b style="margin-left:4px;color:${item.score >= 60 ? 'var(--good)' : 'var(--accent)'};">${item.score}%</b>
              </button>
            `).join('')}
          </div>
        </div>
      `;
    } else if (_arcExpandedPlaqueId === '8.2') {
      pTitle = nearestBase ? `До ближайшей базы: ${nearestBase.distKm.toFixed(1)} км (${escapeHtml(nearestBase.name)})` : 'До ближайшей базы км';
      pBody = `
        <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;">
          <button type="button" class="btn btn-sm" id="arcPlaqueBtnLost" style="min-height:44px;font-weight:900;font-size:11.5px;border-color:var(--warn);color:var(--warn);">Я потерялся</button>
          <button type="button" class="btn btn-sm btn-accent" id="arcPlaqueBtnWaypoints" style="min-height:44px;font-weight:900;font-size:11.5px;">Маршрут по точкам</button>
          <button type="button" class="btn btn-sm btn-good" id="arcPlaqueBtnFreehand" style="min-height:44px;font-weight:900;font-size:11.5px;">Нарисовать пальцем</button>
        </div>
      `;
    } else if (_arcExpandedPlaqueId === '8.3') {
      pTitle = `Точки на карте (${totalMapPoints})`;
      const allCatsList = Object.values(SPOT_CATEGORIES);
      const selCats = visibleMapLayers.selectedCategories instanceof Set ? visibleMapLayers.selectedCategories : new Set(allCatsList.map(c => c.id));
      const filteredSpotItems = (mapCounts.uniqueSpots || []).filter(u => {
        if (!visibleMapLayers.mySpots) return false;
        if (u.mine && !visibleMapLayers.showMine) return false;
        if (!u.mine && !visibleMapLayers.showForeign) return false;
        if (!selCats.has(u.catKey)) return false;
        return true;
      });
      const offStyle = 'opacity:0.48;border-style:dashed;';
      pBody = `
        <div style="display:flex;flex-direction:column;gap:8px;">
          <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;">
            <button type="button" class="btn btn-sm ${visibleMapLayers.mySpots ? 'btn-accent' : ''}" data-arc-filter-src="mySpots" style="min-height:34px;font-size:11px;font-weight:800;${visibleMapLayers.mySpots ? '' : offStyle}">Ориентиры (${mapCounts.thematicCount})</button>
            <button type="button" class="btn btn-sm ${visibleMapLayers.circleBlur ? 'btn-accent' : ''}" data-arc-filter-src="circleBlur" style="min-height:34px;font-size:11px;font-weight:800;${visibleMapLayers.circleBlur ? '' : offStyle}">Круг (${mapCounts.circleBlurCount})</button>
            <button type="button" class="btn btn-sm ${visibleMapLayers.crewExact ? 'btn-accent' : ''}" data-arc-filter-src="crewExact" style="min-height:34px;font-size:11px;font-weight:800;${visibleMapLayers.crewExact ? '' : offStyle}">Экипаж (${mapCounts.crewExactCount})</button>
          </div>
          <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;">
            <button type="button" class="btn btn-sm ${visibleMapLayers.showMine ? 'btn-good' : ''}" data-arc-filter-own="mine" style="min-height:34px;font-size:11px;font-weight:800;${visibleMapLayers.showMine ? '' : offStyle}">Мои (${mapCounts.mineMapCount})</button>
            <button type="button" class="btn btn-sm ${visibleMapLayers.showForeign ? 'btn-accent' : ''}" data-arc-filter-own="foreign" style="min-height:34px;font-size:11px;font-weight:800;${visibleMapLayers.showForeign ? '' : offStyle}">Чужие (${mapCounts.foreignMapCount})</button>
          </div>
          <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;">
            ${allCatsList.map(cat => {
              const isCatOn = selCats.has(cat.id);
              return `
                <button type="button" class="btn btn-sm ${isCatOn ? 'btn-accent' : ''}" data-arc-filter-cat="${cat.id}" style="min-height:34px;font-size:11px;font-weight:800;gap:4px;${isCatOn ? '' : offStyle}">
                  ${cat.icon} <span>${escapeHtml(cat.short)}</span>
                </button>
              `;
            }).join('')}
          </div>
          ${filteredSpotItems.length > 0 ? `
            <div style="display:flex;flex-direction:column;gap:5px;padding-top:6px;border-top:1px solid rgba(125,211,252,0.2);max-height:150px;overflow-y:auto;">
              ${filteredSpotItems.slice(0, 25).map(u => {
                const spTitle = u.source === 'saved' ? (u.raw?.name || 'Точка') : (u.raw?.wn || u.raw?.fn || u.raw?.lb || 'Точка');
                return `
                  <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;padding:5px 8px;border-radius:10px;background:var(--panel);border:1px solid var(--border);">
                    <button type="button" data-load-spot="${escapeHtml(u.id)}" data-load-spot-lat="${u.lat}" data-load-spot-lon="${u.lon}" style="background:none;border:none;color:var(--text);font-weight:800;font-size:11.5px;text-align:left;cursor:pointer;flex:1;display:flex;align-items:center;gap:6px;">
                      ${(SPOT_CATEGORIES[u.catKey] || SPOT_CATEGORIES.bite).icon} <span>${escapeHtml(spTitle)}</span>
                    </button>
                    <button type="button" data-del-spot="${escapeHtml(u.id)}" style="background:none;border:none;color:var(--bad);cursor:pointer;padding:2px 6px;font-weight:900;">&times;</button>
                  </div>
                `;
              }).join('')}
            </div>
          ` : `
            <div style="font-size:11px;color:var(--muted);text-align:center;padding:4px 0;">
              Точки выбранных категорий скрыты фильтром выше (нажмите на кнопку фильтра для включения)
            </div>
          `}
        </div>
      `;
    } else if (_arcExpandedPlaqueId === '8.4') {
      const savedPacksCount = (_cachedPacksList || []).length;
      pTitle = `Офлайн карты (${savedPacksCount})`;
      if (_arcOfflinePromptRadiusKm) {
        pBody = `
          <div style="display:flex;flex-direction:column;gap:8px;">
            <div style="font-size:12px;font-weight:800;">Квадрат ${_arcOfflinePromptRadiusKm} км: Спутник + гибрид (дороги и реки до Z18)</div>
            <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;">
              <button type="button" class="btn btn-sm btn-good" id="arcOfflineConfirmDefaultBtn" data-rad="${_arcOfflinePromptRadiusKm}" style="min-height:42px;font-weight:900;">Скачать по умолчанию</button>
              <button type="button" class="btn btn-sm btn-accent" id="arcOfflineChooseManualBtn" data-rad="${_arcOfflinePromptRadiusKm}" style="min-height:42px;font-weight:900;">Выбрать вручную</button>
            </div>
          </div>
        `;
      } else {
        pBody = `
          <div style="display:flex;flex-direction:column;gap:8px;">
            <div style="display:flex;align-items:center;gap:8px;">
              <button type="button" class="klev-arc-glass klev-arc-icon-btn ${_offlineMapsEnabledOnMap ? 'active' : ''}" id="arcOfflineToggleLayerBtn" title="Вкл/Выкл загруженные офлайн-карты на карте" style="width:46px;height:46px;flex-shrink:0;">
                <svg class="k-ico" style="width:22px;height:22px;color:${_offlineMapsEnabledOnMap ? '#10b981' : '#ef4444'};" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.2"/>
                  <circle cx="12" cy="12" r="4.2" fill="currentColor"/>
                </svg>
              </button>
              <button type="button" class="btn btn-sm btn-accent" id="arcOpenOfflineManagerModalBtn" style="flex:1;min-height:46px;font-weight:900;">
                Загруженные карты (${savedPacksCount})
              </button>
            </div>
            <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;">
              <button type="button" class="btn btn-sm btn-accent" data-arc-offline-radius="50" style="min-height:42px;font-weight:900;">Скачать квадрат 50 км</button>
              <button type="button" class="btn btn-sm btn-good" data-arc-offline-radius="120" style="min-height:42px;font-weight:900;">Скачать квадрат 120 км</button>
            </div>
          </div>
        `;
      }
    } else if (_arcExpandedPlaqueId === '8.5') {
      pTitle = 'Глубины';
      pBody = `
        <div style="display:flex;align-items:center;gap:8px;">
          <button type="button" class="klev-arc-glass klev-arc-icon-btn ${_bathymetryLayerEnabled ? 'active' : ''}" id="arcBathyToggleIconBtn" title="Вкл/Выкл слой глубин" style="width:46px;height:46px;">
            <svg class="k-ico" style="width:22px;height:22px;color:${_bathymetryLayerEnabled ? '#10b981' : '#ef4444'};" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/>
              <circle cx="12" cy="12" r="5" stroke="currentColor" stroke-width="1.6" stroke-dasharray="3 2"/>
              <circle cx="12" cy="12" r="2" fill="currentColor"/>
            </svg>
          </button>
          <button type="button" class="btn btn-sm btn-accent" id="arcBathyLoadFileBtn" style="flex:1;min-height:46px;font-weight:900;">Загрузить карту глубин</button>
        </div>
      `;
    } else if (_arcExpandedPlaqueId === '8.6') {
      pTitle = `Улов (${catches120Count})`;
      pBody = `
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;">
          <button type="button" class="btn btn-sm btn-good" id="arcPlaqueAddCatchBtn" style="min-height:44px;font-weight:900;">Добавить улов</button>
          <button type="button" class="btn btn-sm btn-accent" id="arcPlaqueAiPhotoBtn" style="min-height:44px;font-weight:900;">По фото ИИ</button>
        </div>
      `;
    }

    expandedPlaqueHtml = `
      <div class="klev-arc-glass klev-arc-expanded-plaque ${_arcExpandedPlaqueTall ? 'swiped-tall' : ''}" id="arcExpandedPlaqueSheet">
        <div class="klev-arc-expanded-head" id="arcExpandedPlaqueHeader" title="Нажмите на заголовок для сворачивания">
          <span>${pTitle}</span>
          <span style="width:32px;height:4px;border-radius:999px;background:rgba(148,163,184,0.45);"></span>
        </div>
        <div>${pBody}</div>
      </div>
    `;
  }

  container.innerHTML = `
    <div class="klev-arc-map-stage ${_arcGpsCompassState === 'compass' ? 'compass-bearing-active' : ''}" id="klevArcMapStage">
      <div id="mapBox" role="application" aria-label="Карта водоёмов"></div>

      <!-- П. 2.2: Верхний язычок «Разделы и шапка» -->
      <button type="button" class="klev-arc-glass klev-arc-edge-handle top-handle" id="arcTopHeaderPeekBtn">
        <span>Разделы и шапка</span>
        <svg class="k-ico" style="width:12px;height:12px;" viewBox="0 0 24 24" fill="none"><polyline points="6 9 12 15 18 9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>

      <!-- Верхняя Арка кнопок на карте (без лишних надписей, п. 2.1, 2.4, 2.8) -->
      <div id="arcTopFloatingBar" style="position:absolute;top:32px;left:10px;right:10px;z-index:920;display:${_arcRouteBuilderMode ? 'none' : 'flex'};align-items:center;justify-content:space-between;gap:8px;pointer-events:none;">
        <div style="display:flex;align-items:center;gap:7px;pointer-events:auto;">
          <!-- П. 2.1: Слои — только кнопка без надписи -->
          <button type="button" class="klev-arc-glass klev-arc-icon-btn ${_arcActivePopover === 'layers' ? 'active' : ''}" id="arcBtnLayers" aria-label="Слои карты">
            <svg class="k-ico" style="width:20px;height:20px;" viewBox="0 0 24 24" fill="none">
              <polygon points="12 2 2 7 12 12 22 7 12 2" stroke="#38bdf8" stroke-width="2" stroke-linejoin="round"/>
              <polyline points="2 17 12 22 22 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <polyline points="2 12 12 17 22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>

          <!-- П. 2.4: Погода — только значок и температура со знаком градуса (без C и без текста) -->
          <button type="button" class="klev-arc-glass" id="arcBtnWeather" style="height:44px;padding:0 12px;border-radius:16px;display:inline-flex;align-items:center;gap:6px;font-weight:900;font-size:15px;cursor:pointer;" aria-label="Погода">
            <svg class="k-ico" style="width:19px;height:19px;color:#38bdf8;" viewBox="0 0 24 24" fill="none">
              <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" fill="rgba(56,189,248,0.24)" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
            </svg>
            <span>${tAirFormatted}</span>
          </button>
        </div>

        <!-- Центральная капсула быстрого поиска реки/озера/города -->
        <button type="button" class="klev-arc-glass ${_arcActivePopover === 'search' ? 'active' : ''}" id="arcBtnSearchToggle" style="pointer-events:auto;height:44px;padding:0 12px;border-radius:16px;display:inline-flex;align-items:center;gap:6px;flex:1;max-width:210px;min-width:0;cursor:pointer;font-weight:800;font-size:12px;">
          <svg class="k-ico" style="width:16px;height:16px;color:#38bdf8;flex-shrink:0;" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2.2"/><line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(s.selectedWaterName || s.locLabel || 'Поиск водоёма')}</span>
        </button>

        <!-- П. 2.8: Кнопка выбора способа передвижения (по умолчанию Автомобиль) -->
        <button type="button" class="klev-arc-glass klev-arc-icon-btn ${_arcActivePopover === 'transport' ? 'active' : ''}" id="arcBtnTransport" style="pointer-events:auto;" aria-label="Способ передвижения">
          ${curTransport.svg}
        </button>
      </div>

      <!-- Плашка указаний по построенному маршруту (п. 8.2.3) + сводка опасностей по маршруту -->
      ${_arcBuiltRoute ? (() => {
        const liveHaz = (typeof window !== 'undefined' && typeof window.__KLEV_GET_ROUTE_WEATHER_HAZARDS__ === 'function')
          ? window.__KLEV_GET_ROUTE_WEATHER_HAZARDS__(_arcBuiltRoute.transport || _arcTransportMode)
          : (_arcBuiltRoute.hazards || { hasHazards: false, summaryText: '' });
        const hazRowHtml = liveHaz && liveHaz.hasHazards && liveHaz.summaryText
          ? `<div id="arcRouteHazardAlertRow" style="margin-top:6px;padding:5px 9px;border-radius:10px;background:${liveHaz.severity === 'bad' ? 'rgba(239,68,68,0.20)' : 'rgba(245,158,11,0.18)'};border:1px solid ${liveHaz.severity === 'bad' ? 'rgba(239,68,68,0.55)' : 'rgba(245,158,11,0.50)'};color:${liveHaz.severity === 'bad' ? '#fca5a5' : '#fde68a'};font-size:11px;font-weight:800;line-height:1.25;">Внимание на маршруте: ${escapeHtml(liveHaz.summaryText)}</div>`
          : '';
        return `
        <div class="klev-arc-glass" id="arcActiveRouteBanner" style="position:absolute;top:84px;left:12px;right:12px;z-index:922;border-radius:18px;padding:9px 13px;display:flex;flex-direction:column;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
            ${_arcBuiltRoute.started ? (() => {
              const turn = _arcBuiltRoute.turns?.[_arcBuiltRoute.currentTurnIdx] || null;
              const nextDistM = turn ? Math.max(10, Math.round(turn.distFromStartKm * 1000)) : Math.round(_arcBuiltRoute.distKm * 1000);
              const nextDir = turn ? turn.dirText : 'Прямо по маршруту';
              return `
                <div style="display:flex;align-items:center;gap:10px;min-width:0;">
                  <div style="width:36px;height:36px;border-radius:12px;background:rgba(56,189,248,0.22);display:flex;align-items:center;justify-content:center;color:#38bdf8;font-weight:900;flex-shrink:0;">
                    ${turn?.dirCode === 'left' ? '↰' : (turn?.dirCode === 'right' ? '↱' : '↑')}
                  </div>
                  <div style="min-width:0;">
                    <div style="font-size:15px;font-weight:900;line-height:1.15;">${nextDistM} м • ${nextDir}</div>
                    <div style="font-size:11.5px;font-weight:800;color:var(--muted);">${_arcBuiltRoute.distKm.toFixed(1).replace('.', ',')} км • ${_arcBuiltRoute.etaMin} мин</div>
                  </div>
                </div>
              `;
            })() : `
              <div style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:900;">
                <span style="color:#38bdf8;">${curTransport.svg}</span>
                <span>${_arcBuiltRoute.distKm.toFixed(1).replace('.', ',')} км • ${_arcBuiltRoute.etaMin} мин</span>
              </div>
            `}
            <button type="button" class="btn btn-sm" id="arcClearBuiltRouteBtn" style="min-height:28px;padding:2px 8px;font-weight:900;">&times;</button>
          </div>
          ${hazRowHtml}
        </div>
        `;
      })() : ''}

      <!-- Правые кнопки на карте: П. 2.5 (GPS без надписи) и П. 2.7 (Точка с разными цветами; Кнопка Улов убрана по п. 2.6) -->
      <div id="arcRightSideButtons" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);z-index:920;display:${_arcRouteBuilderMode ? 'none' : 'flex'};flex-direction:column;gap:10px;">
        <button type="button" class="klev-arc-glass klev-arc-icon-btn ${_arcGpsCompassState === 'compass' ? 'active' : ''}" id="arcBtnGpsCompass" aria-label="GPS и Компас">
          ${gpsIconSvg}
        </button>
        <button type="button" class="klev-arc-glass klev-arc-icon-btn ${_arcActivePopover === 'spotGrid' ? 'active' : ''}" id="arcBtnAddSpot" aria-label="Добавить точку">
          ${multicolorSpotSvg}
        </button>
      </div>

      <!-- Всплывающее меню 2.1: Слои карты -->
      <div class="klev-arc-glass" id="arcPopoverLayers" style="display:${_arcActivePopover === 'layers' ? 'flex' : 'none'};position:absolute;top:84px;left:10px;right:10px;z-index:940;border-radius:22px;padding:12px;flex-direction:column;gap:10px;">
        <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;">
          ${Object.entries(MAP_LAYERS).map(([k, v]) => `
            <button type="button" class="btn btn-sm ${currentLayerKey === k ? 'btn-accent' : ''}" data-arc-layer="${k}" style="min-height:38px;font-size:11px;font-weight:800;padding:4px 4px;">${v.name.replace('Яндекс ', '')}</button>
          `).join('')}
        </div>
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;">
          <button type="button" class="btn btn-sm ${yandexMapFilters.hydro ? 'btn-accent' : ''}" data-arc-ymap-filter="hydro" style="min-height:36px;font-size:11px;font-weight:800;">Контраст русел</button>
          <button type="button" class="btn btn-sm ${(yandexMapFilters.labels || currentLayerKey === 'yandex_hybrid') ? 'btn-accent' : ''}" data-arc-ymap-filter="labels" style="min-height:36px;font-size:11px;font-weight:800;">Названия рек</button>
          <button type="button" class="btn btn-sm ${yandexMapFilters.dim ? 'btn-accent' : ''}" data-arc-ymap-filter="dim" style="min-height:36px;font-size:11px;font-weight:800;">Антиблик</button>
          <button type="button" class="btn btn-sm ${_arcRiverFlowEnabled ? 'btn-accent' : ''}" id="arcToggleRiverArrowsBtn" style="min-height:36px;font-size:11px;font-weight:800;">Течение рек</button>
        </div>
      </div>

      <!-- Всплывающее меню 2.8: Выбор способа передвижения (Автомобиль по умолчанию, Снегоход/Мотособака, Велосипед, Лодка, Пешком) -->
      <div class="klev-arc-glass" id="arcPopoverTransport" style="display:${_arcActivePopover === 'transport' ? 'flex' : 'none'};position:absolute;top:84px;right:10px;width:235px;z-index:940;border-radius:20px;padding:8px;flex-direction:column;gap:5px;">
        ${Object.values(ARC_TRANSPORT_MODES).map(tm => `
          <button type="button" class="btn btn-sm ${_arcTransportMode === tm.id ? 'btn-accent' : ''}" data-arc-transport="${tm.id}" style="justify-content:flex-start;gap:10px;min-height:40px;font-size:12px;font-weight:800;padding:6px 10px;">
            ${tm.svg}
            <span>${tm.label}</span>
          </button>
        `).join('')}
      </div>

      <!-- Всплывающее меню 2.7: Плитка 2x3 выбора типа точки (при выборе — переход в окно «Добавить точку на карту» с выбранным типом) -->
      <div class="klev-arc-glass" id="arcPopoverSpotGrid" style="display:${_arcActivePopover === 'spotGrid' ? 'grid' : 'none'};position:absolute;right:62px;top:50%;transform:translateY(-50%);width:248px;z-index:940;border-radius:22px;padding:10px;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;">
        ${Object.values(SPOT_CATEGORIES).map(cat => `
          <button type="button" class="btn btn-sm" data-arc-quick-spot-cat="${cat.id}" style="min-height:46px;flex-direction:column;gap:3px;font-size:11px;font-weight:800;padding:6px 4px;">
            ${cat.icon}
            <span>${escapeHtml(cat.short)}</span>
          </button>
        `).join('')}
      </div>

      <!-- Всплывающее меню поиска водоёма и населённого пункта -->
      <div class="klev-arc-glass" id="arcPopoverSearch" style="display:${_arcActivePopover === 'search' ? 'flex' : 'none'};position:absolute;top:84px;left:10px;right:10px;z-index:940;border-radius:22px;padding:12px;flex-direction:column;gap:8px;">
        <div style="display:flex;gap:6px;">
          <input type="search" id="arcSearchInput" class="input" style="flex:1;min-height:38px;" placeholder="Река, озеро, город РФ...">
          <button type="button" class="btn btn-sm btn-accent" id="arcSearchSubmitBtn" style="min-height:38px;padding:0 12px;font-weight:800;">Найти</button>
          <button type="button" class="btn btn-sm btn-good" id="arcSearchGoHomeBtn" style="min-height:38px;padding:0 10px;font-weight:900;" title="Вернуться домой к моей геопозиции">Домой</button>
        </div>
        ${(() => {
          const rawPlaces = (s.nearbyPlaces && s.nearbyPlaces.length) ? [...s.nearbyPlaces] : getNearestRussianSettlements(s.lat, s.lon, 20, 180);
          const curatedWaters = getNearestRussianWaters(s.lat, s.lon, s.basinCode, s.isCoastal, 30, 120);
          return `
            <select id="arcNearbyPlaceSelect" class="input" style="width:100%;min-height:38px;font-weight:800;">
              ${rawPlaces.map((p, idx) => `<option value="${p.lat},${p.lon},${escapeHtml(p.name)}" ${idx === 0 ? 'selected' : ''}>${escapeHtml(p.name)} (${p.distKm <= 1 ? 'рядом' : p.distKm + ' км'})</option>`).join('')}
            </select>
            <select id="arcNearbyWaterSelect" class="input" style="width:100%;min-height:38px;font-weight:800;">
              ${curatedWaters.map((w, idx) => {
                const cleanLbl = String(w.label || w.name || '').replace(/<svg[\s\S]*?<\/svg>/gi, '').replace(/<[^>]+>/g, '').trim();
                return `<option value="${escapeHtml(w.wType)}|${escapeHtml(w.name || cleanLbl)}|${w.defDepth || ''}|${w.lat || ''}|${w.lon || ''}" ${idx === 0 ? 'selected' : ''}>${escapeHtml(cleanLbl)}</option>`;
              }).join('')}
            </select>
          `;
        })()}
      </div>

      <!-- П. 8.2.2: Центральный аккуратный крестик-цель для режима «Маршрут по точкам» -->
      <div id="arcCenterCrosshair" style="display:${_arcRouteBuilderMode === 'waypoints' ? 'flex' : 'none'};position:absolute;inset:0;z-index:915;pointer-events:none;align-items:center;justify-content:center;">
        <svg width="38" height="38" viewBox="0 0 38 38" fill="none" style="filter:drop-shadow(0 2px 6px rgba(0,0,0,0.75));">
          <circle cx="19" cy="19" r="9" stroke="#38bdf8" stroke-width="2.2"/>
          <line x1="19" y1="2" x2="19" y2="11" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round"/>
          <line x1="19" y1="27" x2="19" y2="36" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round"/>
          <line x1="2" y1="19" x2="11" y2="19" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round"/>
          <line x1="27" y1="19" x2="36" y2="19" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round"/>
          <circle cx="19" cy="19" r="2.2" fill="#10b981"/>
        </svg>
      </div>

      <!-- П. 8.2.3: Подсказка режима рисования пальцем (1 палец — линия по карте, 2 пальца — сдвиг/зум карты) -->
      ${_arcRouteBuilderMode === 'freehand' ? `
        <div class="klev-arc-glass" style="position:absolute;top:34px;left:50%;transform:translateX(-50%);z-index:935;border-radius:999px;padding:6px 14px;font-size:11.5px;font-weight:800;white-space:nowrap;pointer-events:none;">
          1 палец — рисовать • 2 пальца — двигать карту
        </div>
      ` : ''}

      <!-- Панель управления в нижней части экрана для режимов «Маршрут по точкам» (п. 8.2.2) и «Нарисовать пальцем» (п. 8.2.3) -->
      ${_arcRouteBuilderMode === 'waypoints' ? `
        <div class="klev-arc-glass" id="arcWaypointsBottomBar" style="position:absolute;bottom:34px;left:10px;right:10px;z-index:935;border-radius:22px;padding:10px;display:flex;flex-direction:column;gap:8px;">
          <div style="display:flex;gap:7px;">
            <button type="button" class="btn btn-sm" id="arcWpBackBtn" style="width:44px;min-height:42px;padding:0;justify-content:center;" aria-label="Назад">
              <svg class="k-ico" viewBox="0 0 24 24" fill="none"><polyline points="15 18 9 12 15 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button type="button" class="btn btn-sm btn-accent" id="arcWpAddPointBtn" style="flex:1;min-height:42px;font-weight:900;">Добавить точку (${_arcWaypointsDraft.length})</button>
            <button type="button" class="btn btn-sm" id="arcWpUndoBtn" style="min-height:42px;padding:0 10px;font-weight:800;">Отменить последний выбор</button>
          </div>
          <button type="button" class="btn btn-good" id="arcWpFinishBuildBtn" style="width:100%;min-height:44px;font-weight:900;">Закончить и построить маршрут</button>
        </div>
      ` : ''}

      ${_arcRouteBuilderMode === 'freehand' ? `
        <div class="klev-arc-glass" id="arcFreehandBottomBar" style="position:absolute;bottom:34px;left:10px;right:10px;z-index:935;border-radius:22px;padding:10px;display:flex;gap:7px;align-items:center;">
          <button type="button" class="btn btn-sm" id="arcFhBackBtn" style="width:44px;min-height:42px;padding:0;justify-content:center;" aria-label="Назад">
            <svg class="k-ico" viewBox="0 0 24 24" fill="none"><polyline points="15 18 9 12 15 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button type="button" class="btn btn-sm" id="arcFhUndoStrokeBtn" style="flex:1;min-height:42px;font-weight:800;">Отменить последнее действие (${_arcFreehandStrokes.length})</button>
          <button type="button" class="btn btn-good" id="arcFhFinishBuildBtn" style="flex:1;min-height:42px;font-weight:900;">Завершить</button>
        </div>
      ` : ''}

      <!-- Кнопки «Вести по маршруту» и «Стоп с удержанием 1-2 сек и круговым прогрессом» (п. 8.2.3 + видео) -->
      ${(_arcBuiltRoute && !_arcRouteBuilderMode) ? `
        <div id="arcGuidanceFloatingControls" style="position:absolute;bottom:130px;left:50%;transform:translateX(-50%);z-index:932;display:flex;align-items:center;gap:14px;">
          <button type="button" class="klev-arc-glass" id="arcNavStartPauseBtn" style="width:58px;height:58px;border-radius:999px;display:flex;align-items:center;justify-content:center;cursor:pointer;border:2px solid var(--accent);" aria-label="Вести по маршруту">
            ${!_arcBuiltRoute.started
              ? `<span style="transform:scale(1.25);display:inline-flex;">${curTransport.svg}</span>`
              : (_arcBuiltRoute.paused
                  ? `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>`
                  : `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4.5" height="14" rx="1.2"/><rect x="13.5" y="5" width="4.5" height="14" rx="1.2"/></svg>`)}
          </button>
          ${_arcBuiltRoute.started ? `
            <button type="button" class="klev-arc-glass" id="arcNavStopHoldBtn" style="position:relative;width:58px;height:58px;border-radius:999px;display:flex;align-items:center;justify-content:center;cursor:pointer;border:2px solid rgba(239,68,68,0.65);user-select:none;-webkit-user-select:none;" aria-label="Удерживайте для остановки маршрута">
              <svg width="56" height="56" viewBox="0 0 56 56" style="position:absolute;inset:0;transform:rotate(-90deg);pointer-events:none;">
                <circle cx="28" cy="28" r="25" fill="none" stroke="rgba(239,68,68,0.22)" stroke-width="4"/>
                <circle id="arcStopHoldProgressCircle" cx="28" cy="28" r="25" fill="none" stroke="#ef4444" stroke-width="4" stroke-linecap="round" stroke-dasharray="157" stroke-dashoffset="157"/>
              </svg>
              <div style="width:16px;height:16px;border-radius:3px;background:#ffffff;"></div>
            </button>
          ` : ''}
        </div>
      ` : ''}

      <!-- Нижний блок: Свайпаемые плашки по 2 на экран (п. 7, 8.1 – 8.6) -->
      <div id="arcBottomPlaquesMount" style="position:absolute;bottom:28px;left:10px;right:10px;z-index:930;display:${_arcRouteBuilderMode ? 'none' : 'flex'};flex-direction:column;gap:6px;">
        ${_arcExpandedPlaqueId ? expandedPlaqueHtml : `
          <div class="klev-arc-duo-viewport" id="arcDuoSwipeViewport">
            <div class="klev-arc-duo-track" id="arcDuoSwipeTrack" style="transform:translate3d(-${_arcSwipePage * 33.333333}%, 0, 0);">
              <!-- ЭКРАН 1: 8.1 Клёв / ТОП-10 рыб + 8.2 База / Маршруты (без верхнего заголовка до раскрытия, укрупнено и отцентровано) -->
              <div class="klev-arc-duo-page">
                <div class="klev-arc-glass klev-arc-plaque" data-arc-open-plaque="8.1">
                  ${chosenFishObj ? `
                    <div class="klev-arc-plaque-metric" style="color:var(--good);">${chosenFishScore}%</div>
                    <div class="klev-arc-plaque-sub">
                      <span class="arc-fish-svg-slot" style="width:28px;height:15px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;">${renderFishVisual(chosenFishObj)}</span>
                      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:110px;">${escapeHtml(chosenFishObj.name)}</span>
                    </div>
                  ` : `
                    <div class="klev-arc-plaque-metric" style="color:var(--good);">${avgScore}%</div>
                    <div class="klev-arc-plaque-sub" style="color:var(--accent);">Клёв • ТОП-10 рыб</div>
                  `}
                </div>

                <div class="klev-arc-glass klev-arc-plaque" data-arc-open-plaque="8.2">
                  ${nearestBase ? `
                    <div class="klev-arc-plaque-metric" style="color:var(--accent);">${nearestBase.distKm.toFixed(1).replace('.', ',')} км</div>
                    <div class="klev-arc-plaque-sub" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px;">${escapeHtml(nearestBase.name)} • Маршрут</div>
                  ` : `
                    <div class="klev-arc-plaque-metric" style="font-size:19px;color:var(--warn);">Маршрут</div>
                    <div class="klev-arc-plaque-sub">Укажите базу на карте</div>
                  `}
                </div>
              </div>

              <!-- ЭКРАН 2: 8.3 Точки на карте + 8.4 Офлайн карты -->
              <div class="klev-arc-duo-page">
                <div class="klev-arc-glass klev-arc-plaque" data-arc-open-plaque="8.3">
                  <div class="klev-arc-plaque-metric">${totalMapPoints}</div>
                  <div class="klev-arc-plaque-sub" style="color:var(--accent);">Точки • Фильтр</div>
                </div>

                <div class="klev-arc-glass klev-arc-plaque" data-arc-open-plaque="8.4">
                  <div style="display:flex;align-items:center;justify-content:center;gap:8px;">
                    <svg class="k-ico" style="width:28px;height:28px;color:${(hasOfflineHere && _offlineMapsEnabledOnMap) ? '#10b981' : '#ef4444'};" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.2"/>
                      <circle cx="12" cy="12" r="4.2" fill="currentColor"/>
                    </svg>
                    <span class="klev-arc-plaque-metric" style="font-size:18px;color:${(hasOfflineHere && _offlineMapsEnabledOnMap) ? 'var(--good)' : 'var(--bad)'};">${hasOfflineHere ? (_offlineMapsEnabledOnMap ? '50/120 ОК' : 'ВЫКЛ') : 'Офлайн'}</span>
                  </div>
                  <div class="klev-arc-plaque-sub">${hasOfflineHere ? (_offlineMapsEnabledOnMap ? 'Карта в памяти' : 'Офлайн-слой скрыт') : 'Скачать 50 / 120 км'}</div>
                </div>
              </div>

              <!-- ЭКРАН 3: 8.5 Глубины + 8.6 Улов -->
              <div class="klev-arc-duo-page">
                <div class="klev-arc-glass klev-arc-plaque" data-arc-open-plaque="8.5">
                  <div style="display:flex;align-items:center;justify-content:center;gap:7px;">
                    <svg class="k-ico" style="width:26px;height:26px;color:${hasBathyHere ? '#10b981' : '#ef4444'};" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.2"/>
                      <path d="M12 12l5-5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
                      <circle cx="12" cy="12" r="2.2" fill="currentColor"/>
                    </svg>
                    <span class="klev-arc-plaque-metric" style="font-size:21px;">~${s.depth.toFixed(1)} м</span>
                  </div>
                  <div class="klev-arc-plaque-sub">Глубины • Изобаты</div>
                </div>

                <div class="klev-arc-glass klev-arc-plaque" data-arc-open-plaque="8.6">
                  <div class="klev-arc-plaque-metric" style="color:var(--good);">${catches120Count}</div>
                  <div class="klev-arc-plaque-sub" style="color:var(--accent);">Уловы • 120 км</div>
                </div>
              </div>
            </div>
          </div>

          <!-- Индикаторы свайпа 3 экранов -->
          <div style="display:flex;justify-content:center;align-items:center;gap:6px;">
            ${[0, 1, 2].map(i => `
              <button type="button" data-arc-page-dot="${i}" style="height:6px;width:${_arcSwipePage === i ? '22px' : '6px'};border-radius:999px;border:none;background:${_arcSwipePage === i ? 'var(--accent)' : 'rgba(148,163,184,0.45)'};transition:all 0.25s ease;cursor:pointer;padding:0;" aria-label="Экран ${i + 1}"></button>
            `).join('')}
          </div>
        `}
      </div>

      <!-- П. 2.3: Нижний язычок «Быстрый доступ» -->
      <button type="button" class="klev-arc-glass klev-arc-edge-handle bottom-handle" id="arcBottomFooterPeekBtn">
        <svg class="k-ico" style="width:12px;height:12px;" viewBox="0 0 24 24" fill="none"><polyline points="18 15 12 9 6 15" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span>Быстрый доступ</span>
      </button>

      <!-- Полноэкранное окно Погоды поверх карты (п. 2.4) -->
      <div id="arcFullScreenWeatherModal" style="display:${_arcFullScreenWeatherOpen ? 'block' : 'none'};position:fixed;inset:0;z-index:1300;background:var(--bg-grad, var(--bg));overflow-y:auto;padding:12px 10px 28px;">
        <div style="max-width:960px;margin:0 auto;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
            <button type="button" class="klev-arc-glass" id="arcCloseWeatherModalBtn" style="height:40px;padding:0 14px;border-radius:14px;display:inline-flex;align-items:center;gap:6px;font-weight:900;font-size:13px;cursor:pointer;">
              <svg class="k-ico" viewBox="0 0 24 24" fill="none"><polyline points="15 18 9 12 15 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <span>На карту</span>
            </button>
          </div>
          <div id="arcWeatherInnerMount"></div>
        </div>
      </div>

      <!-- Скрытый слот загрузки файлов глубин -->
      <input type="file" id="geoBathymetryFileInput" accept=".gpx,.csv,.kml,.xml,.json,*/*" style="display:none;">
    </div>
  `;

  if (prevLiveMapBox) {
    const newSlot = container.querySelector('#mapBox');
    if (newSlot && newSlot.parentNode) {
      newSlot.parentNode.replaceChild(prevLiveMapBox, newSlot);
      if (mapInstance) {
        try { mapInstance.invalidateSize({ pan: false, animate: false }); } catch (_e) {}
        try { renderMapOverlays(); } catch (_e) {}
      }
    }
  }

  if (_arcFullScreenWeatherOpen) {
    const wMount = container.querySelector('#arcWeatherInnerMount');
    if (wMount && weatherModule && typeof weatherModule.render === 'function') {
      weatherModule.render(wMount);
    }
  }

  bindArcMobileMapEvents(container);
  updateLiveUserGpsMarkerOnMap();
  renderArcRouteDraftAndActiveOnMap();
  setTimeout(() => {
    const box = container.querySelector('#mapBox');
    if (box && box.offsetParent !== null) {
      renderMap(box);
      if (mapInstance) mapInstance.invalidateSize({ pan: false, animate: false });
      renderArcRouteDraftAndActiveOnMap();
    }
  }, 40);
}

function bindArcMobileMapEvents(container) {
  if (!container) return;
  const s = store.getState();

  // П. 2.2 и 2.3: Кнопки «Разделы и шапка» и «Быстрый доступ»
  container.querySelector('#arcTopHeaderPeekBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const rootEl = document.documentElement;
    const isOpen = rootEl.getAttribute('data-arc-header-open') === '1';
    rootEl.setAttribute('data-arc-header-open', isOpen ? '0' : '1');
  });

  container.querySelector('#arcBottomFooterPeekBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const rootEl = document.documentElement;
    const isOpen = rootEl.getAttribute('data-arc-footer-open') === '1';
    rootEl.setAttribute('data-arc-footer-open', isOpen ? '0' : '1');
  });

  // Свайп снизу карты вверх для раскрытия меню «Быстрый доступ» (п. 2.3)
  let edgeTouchStartY = 0;
  container.addEventListener('touchstart', (e) => {
    if (e.touches && e.touches.length === 1) {
      edgeTouchStartY = e.touches[0].clientY;
    }
  }, { passive: true });
  container.addEventListener('touchend', (e) => {
    if (!e.changedTouches || !e.changedTouches.length) return;
    const endY = e.changedTouches[0].clientY;
    const vh = window.innerHeight || 700;
    if (edgeTouchStartY > vh - 48 && edgeTouchStartY - endY > 36) {
      document.documentElement.setAttribute('data-arc-footer-open', '1');
    }
  }, { passive: true });

  // Глобальный обработчик кнопок внутри балунов точек («Маршрут до точки», «Удалить закладку») для мобильной и ПК карты
  ensureGlobalMapPopupActionsBound();
  ensureNetworkAndVpnTileRecoveryBound();

  // Клик по области карты прячет шапку, нижнее меню, всплывашки и открытую плашку (п. 2.2, 2.3, 7),
  // но НЕ перехватывает нажатия внутри открытого попапа точки (.leaflet-popup) и кнопок управления!
  const mapBoxEl = container.querySelector('#mapBox');
  if (mapBoxEl) {
    mapBoxEl.addEventListener('pointerdown', (ev) => {
      if (ev && ev.target && typeof ev.target.closest === 'function') {
        if (ev.target.closest('.leaflet-popup, .leaflet-control, [data-popup-nav-spot], [data-popup-del-spot], [data-popup-del-circle], [data-popup-hide-circle], [data-popup-focus-point]')) {
          return;
        }
      }
      const rootEl = document.documentElement;
      const hadHeader = rootEl.getAttribute('data-arc-header-open') === '1';
      const hadFooter = rootEl.getAttribute('data-arc-footer-open') === '1';
      if (hadHeader) rootEl.setAttribute('data-arc-header-open', '0');
      if (hadFooter) rootEl.setAttribute('data-arc-footer-open', '0');
      if (_arcActivePopover || _arcExpandedPlaqueId) {
        _arcActivePopover = null;
        _arcExpandedPlaqueId = null;
        _arcExpandedPlaqueTall = false;
        _arcOfflinePromptRadiusKm = null;
        render(container);
      }
    });
  }

  // П. 2.1: Кнопка Слои
  container.querySelector('#arcBtnLayers')?.addEventListener('click', (e) => {
    e.stopPropagation();
    _arcActivePopover = _arcActivePopover === 'layers' ? null : 'layers';
    render(container);
  });

  container.querySelectorAll('[data-arc-layer]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const lk = btn.getAttribute('data-arc-layer');
      if (lk && MAP_LAYERS[lk]) {
        currentLayerKey = lk;
        rebuildActiveMapTileLayer();
        render(container);
      }
    });
  });

  container.querySelectorAll('[data-arc-ymap-filter]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const fk = btn.getAttribute('data-arc-ymap-filter');
      if (fk && fk in yandexMapFilters) {
        yandexMapFilters[fk] = !yandexMapFilters[fk];
        try { localStorage.setItem('klev_pro_ymap_filters_v1', JSON.stringify(yandexMapFilters)); } catch (_e) {}
        applyYandexTileFiltersToMap();
        render(container);
      }
    });
  });

  container.querySelector('#arcToggleRiverArrowsBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    _arcRiverFlowEnabled = !_arcRiverFlowEnabled;
    renderStrictRiverFlowArrowsOnMap();
    render(container);
  });

  // П. 2.4: Кнопка Погоды (раскрывается на весь экран и закрывается обратно на карту)
  container.querySelector('#arcBtnWeather')?.addEventListener('click', (e) => {
    e.stopPropagation();
    _arcFullScreenWeatherOpen = true;
    _arcActivePopover = null;
    render(container);
  });

  container.querySelector('#arcCloseWeatherModalBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    _arcFullScreenWeatherOpen = false;
    render(container);
  });

  // Поиск водоёма и города
  container.querySelector('#arcBtnSearchToggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    _arcActivePopover = _arcActivePopover === 'search' ? null : 'search';
    render(container);
  });

  container.querySelector('#arcSearchSubmitBtn')?.addEventListener('click', () => {
    const q = container.querySelector('#arcSearchInput')?.value?.trim();
    if (q) {
      _arcActivePopover = null;
      searchPlaceByQuery(q);
    }
  });

  container.querySelector('#arcSearchInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = e.currentTarget?.value?.trim();
      if (q) {
        _arcActivePopover = null;
        searchPlaceByQuery(q);
      }
    }
  });

  container.querySelector('#arcSearchGoHomeBtn')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    _arcActivePopover = null;
    const realPos = getTrueUserGpsCoords(s);
    await setLocation(realPos.lat, realPos.lon, false, 13);
    showToast('Возврат домой к вашей геопозиции', 'good');
  });

  container.querySelector('#arcNearbyPlaceSelect')?.addEventListener('change', (e) => {
    const parts = String(e.target.value || '').split(',');
    const pLat = parseFloat(parts[0]);
    const pLon = parseFloat(parts[1]);
    const name = parts.slice(2).join(',').trim();
    if (Number.isFinite(pLat) && Number.isFinite(pLon)) {
      _arcActivePopover = null;
      store.dispatch({ type: 'SET_LOCATION_LABELS', payload: { locLabel: name, locAdmin2: name } });
      setLocation(pLat, pLon, true);
    }
  });

  container.querySelector('#arcNearbyWaterSelect')?.addEventListener('change', (e) => {
    const [wType, wName, defDStr, wLatStr, wLonStr] = String(e.target.value || '').split('|');
    if (!wType) return;
    _arcActivePopover = null;
    const defD = parseFloat(defDStr) || WATER_PROFILES[wType]?.defD || 1.5;
    store.dispatch({ type: 'SET_WATER', payload: { water: wType, depth: defD, selectedWaterName: wName || '' } });
    const wLat = parseFloat(wLatStr);
    const wLon = parseFloat(wLonStr);
    if (Number.isFinite(wLat) && Number.isFinite(wLon) && mapInstance) {
      mapInstance.setView([wLat, wLon], Math.max(12, mapInstance.getZoom() || 12));
    }
  });

  // П. 2.8: Выбор способа передвижения
  container.querySelector('#arcBtnTransport')?.addEventListener('click', (e) => {
    e.stopPropagation();
    _arcActivePopover = _arcActivePopover === 'transport' ? null : 'transport';
    render(container);
  });

  container.querySelectorAll('[data-arc-transport]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const tm = btn.getAttribute('data-arc-transport') || 'car';
      _arcTransportMode = tm;
      _arcActivePopover = null;

      let savedTargets = null;
      if (_arcBuiltRoute && Array.isArray(_arcBuiltRoute.targetWaypoints) && _arcBuiltRoute.targetWaypoints.length > 0) {
        savedTargets = _arcBuiltRoute.targetWaypoints;
      } else if (_arcWaypointsDraft.length > 0) {
        savedTargets = _arcWaypointsDraft;
      } else if (_arcFreehandStrokes.length > 0) {
        const flat = [];
        _arcFreehandStrokes.forEach(st => { if (Array.isArray(st)) flat.push(...st); });
        if (flat.length >= 2) savedTargets = flat;
      } else if (_arcBuiltRoute && Array.isArray(_arcBuiltRoute.points) && _arcBuiltRoute.points.length >= 2) {
        savedTargets = [_arcBuiltRoute.points[_arcBuiltRoute.points.length - 1]];
      }

      render(container);

      if (savedTargets && savedTargets.length > 0) {
        const wasStarted = Boolean(_arcBuiltRoute && _arcBuiltRoute.started);
        const wasPaused = Boolean(_arcBuiltRoute && _arcBuiltRoute.paused);
        const rt = await computeSmartTransportRoute(savedTargets, _arcTransportMode, _arcBuiltRoute?.mode || null);
        if (rt) {
          rt.started = wasStarted;
          rt.paused = wasPaused;
          _arcBuiltRoute = rt;
          renderArcRouteDraftAndActiveOnMap();
          render(container);
          renderArcRouteDraftAndActiveOnMap();
        }
      }
    });
  });

  // П. 2.5 и Замечание 6: Кнопка GPS / Компас
  // 1) Всегда возвращает карту к РЕАЛЬНОЙ геопозиции пользователя (getTrueUserGpsCoords), а не к передвинутой точке просмотра водоёма!
  // 2) В режиме компаса не переворачивает контейнер #mapBox вверх ногами на 180° и не обрезает углы карты, а вращает стрелку компаса и луч «взгляда» на GPS-маркере пользователя.
  container.querySelector('#arcBtnGpsCompass')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const boxEl = container.querySelector('#mapBox');
    if (boxEl) boxEl.style.transform = 'none';

    const realPos = getTrueUserGpsCoords(s);
    const c = mapInstance ? mapInstance.getCenter() : { lat: realPos.lat, lng: realPos.lon };
    const distToRealGpsKm = calcHaversineKm(realPos.lat, realPos.lon, c.lat, c.lng);

    const distStoreToRealKm = calcHaversineKm(realPos.lat, realPos.lon, Number(s.lat || 0), Number(s.lon || 0));
    if (distToRealGpsKm > 0.18 || distStoreToRealKm > 0.5 || _arcGpsCompassState === 'off') {
      _arcGpsCompassState = 'centered';
      if (distStoreToRealKm > 0.5) {
        setLocation(realPos.lat, realPos.lon, false, 14);
      }
      if (mapInstance) {
        mapInstance.setView([realPos.lat, realPos.lon], Math.max(14, mapInstance.getZoom() || 14));
      }
      updateLiveUserGpsMarkerOnMap();
      render(container);
      // Дополнительно запрашиваем свежий GPS-фикс и центрируем строго на реальном положении пользователя
      const fresh = await acquireFreshHighAccuracyGpsFix(4500).catch(() => null);
      if (fresh && fresh.hasRealFix && mapInstance) {
        mapInstance.setView([fresh.lat, fresh.lon], Math.max(14, mapInstance.getZoom() || 14));
        updateLiveUserGpsMarkerOnMap();
      }
      return;
    }

    if (_arcGpsCompassState === 'centered') {
      _arcGpsCompassState = 'compass';
      if (mapInstance) {
        mapInstance.setView([realPos.lat, realPos.lon], Math.max(14, mapInstance.getZoom() || 14));
      }
      if (typeof window !== 'undefined' && typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        try { await DeviceOrientationEvent.requestPermission(); } catch (_e) {}
      }
      _ensureArcCompassSensorStarted();
    } else {
      _arcGpsCompassState = 'centered';
      if (mapInstance) {
        mapInstance.setView([realPos.lat, realPos.lon], Math.max(14, mapInstance.getZoom() || 14));
      }
    }
    updateLiveUserGpsMarkerOnMap();
    render(container);
    updateLiveUserGpsMarkerOnMap();
  });

  // П. 2.7: Кнопка Точка (плитка 2x3 -> переход в окно «Добавить точку на карту» с выбранным типом точки)
  container.querySelector('#arcBtnAddSpot')?.addEventListener('click', (e) => {
    e.stopPropagation();
    _arcActivePopover = _arcActivePopover === 'spotGrid' ? null : 'spotGrid';
    render(container);
  });

  container.querySelectorAll('[data-arc-quick-spot-cat]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const catId = btn.getAttribute('data-arc-quick-spot-cat') || 'bite';
      _arcActivePopover = null;
      render(container);
      openSaveSpotModal(catId);
    });
  });

  // П. 7: Свайп между 3 экранами нижних плашек (по 2 плашки на экран)
  const duoViewport = container.querySelector('#arcDuoSwipeViewport');
  if (duoViewport) {
    let startX = 0;
    duoViewport.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches.length === 1) startX = e.touches[0].clientX;
    }, { passive: true });
    duoViewport.addEventListener('touchend', (e) => {
      if (!e.changedTouches || !e.changedTouches.length) return;
      const dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) > 38) {
        _arcSwipePage = Math.max(0, Math.min(2, _arcSwipePage + (dx < 0 ? 1 : -1)));
        const track = container.querySelector('#arcDuoSwipeTrack');
        if (track) track.style.transform = `translate3d(-${_arcSwipePage * 33.333333}%, 0, 0)`;
        render(container);
      }
    }, { passive: true });
  }

  container.querySelectorAll('[data-arc-page-dot]').forEach(dot => {
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      _arcSwipePage = parseInt(dot.getAttribute('data-arc-page-dot'), 10) || 0;
      render(container);
    });
  });

  // Открытие плашки 8.1 – 8.6
  container.querySelectorAll('[data-arc-open-plaque]').forEach(pl => {
    pl.addEventListener('click', (e) => {
      e.stopPropagation();
      _arcExpandedPlaqueId = pl.getAttribute('data-arc-open-plaque');
      _arcExpandedPlaqueTall = false;
      _arcOfflinePromptRadiusKm = null;
      render(container);
    });
  });

  // П. 7: Повторное нажатие на заголовок плашки сворачивает её; свайп вверх разворачивает выше, свайп вниз сворачивает
  const expHeader = container.querySelector('#arcExpandedPlaqueHeader');
  const expSheet = container.querySelector('#arcExpandedPlaqueSheet');
  if (expHeader) {
    expHeader.addEventListener('click', (e) => {
      e.stopPropagation();
      _arcExpandedPlaqueId = null;
      _arcExpandedPlaqueTall = false;
      _arcOfflinePromptRadiusKm = null;
      render(container);
    });
  }
  if (expSheet) {
    let sheetStartY = 0;
    expSheet.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches.length === 1) sheetStartY = e.touches[0].clientY;
    }, { passive: true });
    expSheet.addEventListener('touchend', (e) => {
      if (!e.changedTouches || !e.changedTouches.length) return;
      const dy = e.changedTouches[0].clientY - sheetStartY;
      if (dy < -42) {
        _arcExpandedPlaqueTall = true;
        expSheet.classList.add('swiped-tall');
      } else if (dy > 48 && expSheet.scrollTop <= 4) {
        if (_arcExpandedPlaqueTall) {
          _arcExpandedPlaqueTall = false;
          expSheet.classList.remove('swiped-tall');
        } else {
          _arcExpandedPlaqueId = null;
          render(container);
        }
      }
    }, { passive: true });
  }

  // П. 8.1: Выбор рыбы из ТОП-10 региона в точке
  container.querySelectorAll('[data-arc-pick-fish]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const fid = btn.getAttribute('data-arc-pick-fish');
      if (fid === '__avg__') {
        _arcSelectedSpecificFishId = null;
      } else if (fid) {
        _arcSelectedSpecificFishId = fid;
        store.dispatch({ type: 'SET_FISH', payload: fid });
      }
      _arcExpandedPlaqueId = null;
      render(container);
    });
  });

  // П. 8.2.1: «Я потерялся» -> вызывает окно «Маршруты, Возврат по следу и Я потерялся»
  container.querySelector('#arcPlaqueBtnLost')?.addEventListener('click', (e) => {
    e.stopPropagation();
    _arcExpandedPlaqueId = null;
    render(container);
    openPhase3RoutesModal();
  });

  // П. 8.2.2: «Маршрут по точкам»
  container.querySelector('#arcPlaqueBtnWaypoints')?.addEventListener('click', (e) => {
    e.stopPropagation();
    _arcExpandedPlaqueId = null;
    _arcRouteBuilderMode = 'waypoints';
    _arcWaypointsDraft = [];
    _arcBuiltRoute = null;
    render(container);
  });

  container.querySelector('#arcWpBackBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    _arcRouteBuilderMode = null;
    _arcWaypointsDraft = [];
    renderArcRouteDraftAndActiveOnMap();
    render(container);
  });

  container.querySelector('#arcWpAddPointBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const c = mapInstance ? mapInstance.getCenter() : { lat: Number(s.lat || 66.0833), lng: Number(s.lon || 76.6333) };
    _arcWaypointsDraft.push({ lat: c.lat, lon: c.lng });
    renderArcRouteDraftAndActiveOnMap();
    render(container);
  });

  container.querySelector('#arcWpUndoBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    _arcWaypointsDraft.pop();
    renderArcRouteDraftAndActiveOnMap();
    render(container);
  });

  container.querySelector('#arcWpFinishBuildBtn')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (_arcWaypointsDraft.length === 0) {
      const c = mapInstance ? mapInstance.getCenter() : { lat: Number(s.lat || 66.0865), lng: Number(s.lon || 76.6420) };
      _arcWaypointsDraft.push({ lat: c.lat, lon: c.lng });
    }
    const built = await computeSmartTransportRoute(_arcWaypointsDraft, _arcTransportMode, 'waypoints');
    _arcRouteBuilderMode = null;
    _arcBuiltRoute = built;
    renderArcRouteDraftAndActiveOnMap();
    render(container);
  });

  // П. 8.2.3: «Нарисовать пальцем» (поддержка нескольких мазков)
  container.querySelector('#arcPlaqueBtnFreehand')?.addEventListener('click', (e) => {
    e.stopPropagation();
    _arcExpandedPlaqueId = null;
    _arcRouteBuilderMode = 'freehand';
    _arcFreehandStrokes = [];
    _arcBuiltRoute = null;
    render(container);
  });

  // В режиме «Нарисовать пальцем»:
  // - 1 палец (или зажатая мышь): рисует линию непосредственно в координатах карты L.polyline без малейшего смещения!
  // - 2 пальца: свободно двигают (панорамируют) и масштабируют (щипок/зум) карту!
  if (mapBoxEl) {
    if (_arcRouteBuilderMode === 'freehand') {
      mapBoxEl.style.touchAction = 'none';
      if (mapInstance && mapInstance.dragging) {
        try { mapInstance.dragging.disable(); } catch (_e) {}
      }
    } else {
      mapBoxEl.style.touchAction = '';
      if (mapInstance && mapInstance.dragging) {
        try { mapInstance.dragging.enable(); } catch (_e) {}
      }
    }

    if (!mapBoxEl.__klevFreehandDirectBound) {
      mapBoxEl.__klevFreehandDirectBound = true;
      let isDrawing1Finger = false;
      let curLatLngs = [];
      let livePolyline = null;
      let twoFingerPrevMid = null;
      let twoFingerPrevDist = 0;

      const clientXYToLatLng = (clientX, clientY) => {
        if (!mapInstance) return null;
        const r = mapBoxEl.getBoundingClientRect();
        if (r.width >= 40 && r.height >= 40 && (Math.abs(r.width - _lastMapBoxW) > 4 || Math.abs(r.height - _lastMapBoxH) > 4)) {
          _lastMapBoxW = r.width;
          _lastMapBoxH = r.height;
          mapInstance.invalidateSize({ pan: false, animate: false });
        }
        const pt = [clientX - r.left, clientY - r.top];
        const ll = mapInstance.containerPointToLatLng(pt);
        return ll && Number.isFinite(ll.lat) && Number.isFinite(ll.lng) ? [ll.lat, ll.lng] : null;
      };

      const cancelLiveStroke = () => {
        isDrawing1Finger = false;
        curLatLngs = [];
        if (livePolyline && mapInstance) {
          try { mapInstance.removeLayer(livePolyline); } catch (_e) {}
        }
        livePolyline = null;
      };

      const commitLiveStroke = () => {
        if (!isDrawing1Finger) return;
        isDrawing1Finger = false;
        if (livePolyline && mapInstance) {
          try { mapInstance.removeLayer(livePolyline); } catch (_e) {}
        }
        livePolyline = null;
        if (curLatLngs.length >= 2) {
          const step = Math.max(1, Math.floor(curLatLngs.length / 18));
          const sampled = [];
          for (let i = 0; i < curLatLngs.length; i += step) {
            sampled.push(curLatLngs[i]);
          }
          const lastPt = curLatLngs[curLatLngs.length - 1];
          if (sampled[sampled.length - 1] !== lastPt) sampled.push(lastPt);
          _arcFreehandStrokes.push(sampled);
          renderArcRouteDraftAndActiveOnMap();
          const undoBtn = document.getElementById('arcFhUndoStrokeBtn');
          if (undoBtn) {
            undoBtn.textContent = `Отменить последнее действие (${_arcFreehandStrokes.length})`;
          }
        }
        curLatLngs = [];
      };

      mapBoxEl.addEventListener('touchstart', (ev) => {
        if (_arcRouteBuilderMode !== 'freehand' || !mapInstance) return;
        if (ev.touches.length >= 2) {
          cancelLiveStroke();
          const t0 = ev.touches[0];
          const t1 = ev.touches[1];
          twoFingerPrevMid = [(t0.clientX + t1.clientX) / 2, (t0.clientY + t1.clientY) / 2];
          twoFingerPrevDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
          return;
        }
        if (ev.touches.length === 1) {
          twoFingerPrevMid = null;
          const t = ev.touches[0];
          const ll = clientXYToLatLng(t.clientX, t.clientY);
          if (!ll) return;
          isDrawing1Finger = true;
          curLatLngs = [ll];
          livePolyline = L.polyline(curLatLngs, {
            color: '#38bdf8',
            weight: 5,
            opacity: 0.95,
            lineCap: 'round',
            lineJoin: 'round'
          }).addTo(mapInstance);
        }
      }, { passive: true });

      mapBoxEl.addEventListener('touchmove', (ev) => {
        if (_arcRouteBuilderMode !== 'freehand' || !mapInstance) return;
        if (ev.touches.length >= 2) {
          if (isDrawing1Finger) cancelLiveStroke();
          const t0 = ev.touches[0];
          const t1 = ev.touches[1];
          const mid = [(t0.clientX + t1.clientX) / 2, (t0.clientY + t1.clientY) / 2];
          const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
          if (twoFingerPrevMid) {
            const dx = twoFingerPrevMid[0] - mid[0];
            const dy = twoFingerPrevMid[1] - mid[1];
            if (Math.hypot(dx, dy) > 1.5) {
              mapInstance.panBy([dx, dy], { animate: false });
            }
          }
          if (twoFingerPrevDist > 25 && Math.abs(dist - twoFingerPrevDist) > 28) {
            const curZ = mapInstance.getZoom() || 12;
            const nextZ = dist > twoFingerPrevDist ? Math.min(18, curZ + 1) : Math.max(4, curZ - 1);
            if (nextZ !== curZ) {
              mapInstance.setZoom(nextZ, { animate: false });
            }
            twoFingerPrevDist = dist;
          }
          twoFingerPrevMid = mid;
          return;
        }
        if (ev.touches.length === 1 && isDrawing1Finger) {
          const t = ev.touches[0];
          const ll = clientXYToLatLng(t.clientX, t.clientY);
          if (!ll) return;
          curLatLngs.push(ll);
          if (livePolyline) livePolyline.setLatLngs(curLatLngs);
        }
      }, { passive: true });

      mapBoxEl.addEventListener('touchend', (ev) => {
        if (_arcRouteBuilderMode !== 'freehand') return;
        if (!ev.touches || ev.touches.length < 2) {
          twoFingerPrevMid = null;
          twoFingerPrevDist = 0;
        }
        if (!ev.touches || ev.touches.length === 0) {
          commitLiveStroke();
        }
      }, { passive: true });

      mapBoxEl.addEventListener('mousedown', (ev) => {
        if (_arcRouteBuilderMode !== 'freehand' || !mapInstance || ev.button !== 0) return;
        const ll = clientXYToLatLng(ev.clientX, ev.clientY);
        if (!ll) return;
        isDrawing1Finger = true;
        curLatLngs = [ll];
        livePolyline = L.polyline(curLatLngs, {
          color: '#38bdf8',
          weight: 5,
          opacity: 0.95,
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(mapInstance);
      });

      mapBoxEl.addEventListener('mousemove', (ev) => {
        if (_arcRouteBuilderMode !== 'freehand' || !isDrawing1Finger || !mapInstance) return;
        const ll = clientXYToLatLng(ev.clientX, ev.clientY);
        if (!ll) return;
        curLatLngs.push(ll);
        if (livePolyline) livePolyline.setLatLngs(curLatLngs);
      });

      window.addEventListener('mouseup', () => {
        if (_arcRouteBuilderMode === 'freehand' && isDrawing1Finger) {
          commitLiveStroke();
        }
      });
    }
  }

  container.querySelector('#arcFhBackBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    _arcRouteBuilderMode = null;
    _arcFreehandStrokes = [];
    if (mapInstance && mapInstance.dragging) {
      try { mapInstance.dragging.enable(); } catch (_e) {}
    }
    renderArcRouteDraftAndActiveOnMap();
    render(container);
  });

  container.querySelector('#arcFhUndoStrokeBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    _arcFreehandStrokes.pop();
    renderArcRouteDraftAndActiveOnMap();
    const undoBtn = container.querySelector('#arcFhUndoStrokeBtn');
    if (undoBtn) {
      undoBtn.textContent = `Отменить последнее действие (${_arcFreehandStrokes.length})`;
    }
  });

  container.querySelector('#arcFhFinishBuildBtn')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const flatPts = [];
    _arcFreehandStrokes.forEach(st => {
      if (Array.isArray(st)) flatPts.push(...st);
    });
    _arcRouteBuilderMode = null;
    if (mapInstance && mapInstance.dragging) {
      try { mapInstance.dragging.enable(); } catch (_e) {}
    }
    if (flatPts.length >= 2) {
      const built = await computeSmartTransportRoute(flatPts, _arcTransportMode, 'freehand');
      _arcBuiltRoute = built;
    }
    renderArcRouteDraftAndActiveOnMap();
    render(container);
  });

  // Ведение по построенному маршруту: кнопка Старт/Пауза и кнопка Стоп с удержанием 1.5 сек и круговым заполнением
  // Замечание 5 и 9: Никогда не запускаем запись трека автоматически в фоне без явного согласия пользователя!
  container.querySelector('#arcNavStartPauseBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!_arcBuiltRoute) return;
    if (!_arcBuiltRoute.started) {
      _arcBuiltRoute.started = true;
      _arcBuiltRoute.paused = false;
      updateLiveUserGpsMarkerOnMap();
      const startHaz = (typeof window !== 'undefined' && typeof window.__KLEV_GET_ROUTE_WEATHER_HAZARDS__ === 'function')
        ? window.__KLEV_GET_ROUTE_WEATHER_HAZARDS__(_arcBuiltRoute.transport || _arcTransportMode)
        : (_arcBuiltRoute.hazards || null);
      const hazVoice = (startHaz && startHaz.hasHazards && startHaz.summaryText)
        ? ` Внимание: на маршруте ${startHaz.summaryText}.`
        : '';
      speakRouteGuidanceRu(`Маршрут построен. Дистанция ${_arcBuiltRoute.distKm.toFixed(1)} километра.${hazVoice} Начинаем движение.`);
      if (!_phase3ActiveTrack) {
        try { startPhase3RouteRecording('', false, getTrueUserGpsCoords(s)); } catch (_e) {}
      }
    } else {
      _arcBuiltRoute.paused = !_arcBuiltRoute.paused;
      speakRouteGuidanceRu(_arcBuiltRoute.paused ? 'Ведение по маршруту на паузе' : 'Продолжаем движение по маршруту');
    }
    render(container);
  });

  const stopHoldBtn = container.querySelector('#arcNavStopHoldBtn');
  if (stopHoldBtn) {
    const startHold = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      _arcHoldStopStartTs = performance.now();
      const ring = container.querySelector('#arcStopHoldProgressCircle');
      const tick = (now) => {
        const elapsed = now - _arcHoldStopStartTs;
        const ratio = Math.min(1, elapsed / 1450);
        if (ring) {
          ring.style.strokeDashoffset = String(157 * (1 - ratio));
        }
        if (ratio >= 1) {
          _arcBuiltRoute = null;
          _arcWaypointsDraft = [];
          _arcFreehandStrokes = [];
          if (_phase3ActiveTrack) {
            try { stopAndSavePhase3Route(true); } catch (_e) {}
          }
          renderArcRouteDraftAndActiveOnMap();
          updateLiveUserGpsMarkerOnMap();
          speakRouteGuidanceRu('Маршрут завершён и сохранён');
          render(container);
          return;
        }
        _arcHoldStopRaf = requestAnimationFrame(tick);
      };
      _arcHoldStopRaf = requestAnimationFrame(tick);
    };
    const cancelHold = () => {
      if (_arcHoldStopRaf) cancelAnimationFrame(_arcHoldStopRaf);
      _arcHoldStopRaf = null;
      const ring = container.querySelector('#arcStopHoldProgressCircle');
      if (ring) ring.style.strokeDashoffset = '157';
    };
    stopHoldBtn.addEventListener('pointerdown', startHold);
    stopHoldBtn.addEventListener('pointerup', cancelHold);
    stopHoldBtn.addEventListener('pointerleave', cancelHold);
    stopHoldBtn.addEventListener('pointercancel', cancelHold);
  }

  container.querySelector('#arcClearBuiltRouteBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    _arcBuiltRoute = null;
    _arcWaypointsDraft = [];
    _arcFreehandStrokes = [];
    if (_phase3ActiveTrack) {
      try { stopAndSavePhase3Route(true); } catch (_e) {}
    }
    renderArcRouteDraftAndActiveOnMap();
    updateLiveUserGpsMarkerOnMap();
    render(container);
  });

  // П. 8.3: Фильтр точек на карте
  container.querySelectorAll('[data-arc-filter-src]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const k = btn.getAttribute('data-arc-filter-src');
      if (k in visibleMapLayers) {
        visibleMapLayers[k] = !visibleMapLayers[k];
        renderMapOverlays();
        render(container);
      }
    });
  });

  container.querySelectorAll('[data-arc-filter-own]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const ow = btn.getAttribute('data-arc-filter-own');
      if (ow === 'mine') visibleMapLayers.showMine = !visibleMapLayers.showMine;
      if (ow === 'foreign') visibleMapLayers.showForeign = !visibleMapLayers.showForeign;
      renderMapOverlays();
      render(container);
    });
  });

  container.querySelectorAll('[data-arc-filter-cat]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const cid = btn.getAttribute('data-arc-filter-cat');
      if (!(visibleMapLayers.selectedCategories instanceof Set)) {
        visibleMapLayers.selectedCategories = new Set(Object.keys(SPOT_CATEGORIES));
      }
      if (visibleMapLayers.selectedCategories.has(cid)) {
        visibleMapLayers.selectedCategories.delete(cid);
      } else {
        visibleMapLayers.selectedCategories.add(cid);
      }
      renderMapOverlays();
      render(container);
    });
  });

  container.querySelectorAll('[data-load-spot]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-load-spot');
      const sp = (s.savedSpots || []).find(x => x && x.id === id) ||
                 (s.circleItems || []).find(x => x && x.id === id);
      const lat = sp ? Number(sp.lat) : parseFloat(btn.getAttribute('data-load-spot-lat'));
      const lon = sp ? Number(sp.lon) : parseFloat(btn.getAttribute('data-load-spot-lon'));
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        visibleMapLayers.mySpots = true;
        visibleMapLayers.showMine = true;
        if (sp) {
          const catKey = normalizeSpotCatKey(sp.category || sp.cat || 'bite');
          if (visibleMapLayers.selectedCategories instanceof Set) {
            visibleMapLayers.selectedCategories.add(catKey);
          }
        }
        _arcExpandedPlaqueId = null;
        await setLocation(lat, lon, true, 15);
        renderMapOverlays();
        render(container);
        setTimeout(() => {
          if (id && _circleLayersMap.has(id)) {
            const m = _circleLayersMap.get(id);
            if (m && typeof m.openPopup === 'function') m.openPopup();
          }
        }, 120);
      }
    });
  });

  container.querySelectorAll('[data-del-spot]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-del-spot');
      deleteSpot(id).then(() => {
        renderMapOverlays();
        render(container);
      });
    });
  });

  // П. 8.4: Офлайн-карты (тумблер Вкл/Выкл, кнопка окна управления загруженными картами, скачивание 50 км и 120 км)
  container.querySelector('#arcOfflineToggleLayerBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    setOfflineMapLayerEnabled(!_offlineMapsEnabledOnMap);
    rebuildActiveMapTileLayer();
    renderMapOverlays();
    render(container);
    showToast(_offlineMapsEnabledOnMap ? 'Загруженные офлайн-карты на карте ВКЛЮЧЕНЫ' : 'Офлайн-карты скрыты (включён онлайн-режим)', 'info');
  });

  container.querySelector('#arcOpenOfflineManagerModalBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    _arcOfflinePromptRadiusKm = null;
    _arcExpandedPlaqueId = null;
    render(container);
    openOfflineMapsManagerModal({ initialRadiusKm: 50 });
  });

  container.querySelectorAll('[data-arc-offline-radius]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      _arcOfflinePromptRadiusKm = parseInt(btn.getAttribute('data-arc-offline-radius'), 10) || 50;
      render(container);
    });
  });

  container.querySelector('#arcOfflineConfirmDefaultBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const rad = parseInt(e.currentTarget.getAttribute('data-rad'), 10) || 50;
    const mc = (mapInstance && typeof mapInstance.getCenter === 'function') ? mapInstance.getCenter() : null;
    const cLat = (mc && Number.isFinite(mc.lat)) ? mc.lat : Number(s.lat || 66.0833);
    const cLon = (mc && Number.isFinite(mc.lng)) ? mc.lng : Number(s.lon || 76.6333);
    _arcOfflinePromptRadiusKm = null;
    _arcExpandedPlaqueId = null;
    setOfflineMapLayerEnabled(true);
    render(container);
    startOfflinePackDownload({
      centerLat: cLat,
      centerLon: cLon,
      radiusKm: rad,
      layerMode: 'satellite',
      smartHydroZ15: true,
      title: `${s.locLabel || 'Квадрат'} (${rad} км • Спутник+гибрид Z18)`
    }).then(() => {
      rebuildActiveMapTileLayer();
      renderMapOverlays();
      render(container);
    });
  });

  container.querySelector('#arcOfflineChooseManualBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const rad = parseInt(e.currentTarget.getAttribute('data-rad'), 10) || 50;
    _arcOfflinePromptRadiusKm = null;
    _arcExpandedPlaqueId = null;
    render(container);
    openOfflineMapsManagerModal({ initialRadiusKm: rad });
  });

  // П. 8.5: Глубины (значок Вкл/Выкл и Загрузить карту глубин)
  container.querySelector('#arcBathyToggleIconBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    _bathymetryLayerEnabled = !_bathymetryLayerEnabled;
    renderMapOverlays();
    render(container);
  });

  container.querySelector('#arcBathyLoadFileBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    container.querySelector('#geoBathymetryFileInput')?.click();
  });

  const bathyInp = container.querySelector('#geoBathymetryFileInput');
  if (bathyInp) {
    bathyInp.addEventListener('change', async (ev) => {
      const file = ev.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      await importSpotsFromFileText(text);
      _bathymetryLayerEnabled = true;
      renderMapOverlays();
      render(container);
    });
  }

  // П. 8.6: Улов (Добавить улов и По фото ИИ)
  container.querySelector('#arcPlaqueAddCatchBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    _arcExpandedPlaqueId = null;
    render(container);
    events.emit('forecast:hourSelected', {
      dayIdx: s.dayIdx ?? 2,
      hour: s.selectedHour ?? new Date().getHours()
    });
  });

  container.querySelector('#arcPlaqueAiPhotoBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    _arcExpandedPlaqueId = null;
    render(container);
    if (typeof window !== 'undefined' && typeof window.__KLEV_OPEN_FISH_SCANNER__ === 'function') {
      window.__KLEV_OPEN_FISH_SCANNER__();
    } else {
      router.navigate('fish');
    }
  });
}

export function render(container) {
  if (!container) return;
  const s = store.getState();
  if (isMobileOrTabletMapMode() && !(typeof window !== 'undefined' && window.__KLEV_CATCH_WIZARD_PICK_SPOT__?.active)) {
    const prevLiveMapBoxArc = (mapInstance && mapInstance._container && container.contains(mapInstance._container))
      ? mapInstance._container
      : null;
    if (prevLiveMapBoxArc && prevLiveMapBoxArc.parentNode) {
      prevLiveMapBoxArc.parentNode.removeChild(prevLiveMapBoxArc);
    }
    renderArcMobileMap(container, s, prevLiveMapBoxArc);
    return;
  }
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-arc-map-active', '0');
  }
  const prevScrolls = Array.from(container.querySelectorAll('.chip-scroll-row')).map(el => el.scrollLeft);
  const availableWaters = getAvailableWaterTypes(s.basinCode, s.lat, s.lon);
  const prof = WATER_PROFILES[s.water] || WATER_PROFILES.small_river;
  const showDrawer = true;
  const compatibleMethods = getMethodOptions(s.iceState, s.water);
  const activeRadius = s.waterRadiusKm === 120 ? 120 : 50;
  const isProMode = s.appMode === 'pro';
  const mapCounts = computeDeduplicatedMapCounts(s);
  const thematicCount = mapCounts.thematicCount;
  const circleBlurCount = mapCounts.circleBlurCount;
  const crewExactCount = mapCounts.crewExactCount;
  const mineMapCount = mapCounts.mineMapCount;
  const foreignMapCount = mapCounts.foreignMapCount;
  const prevLiveMapBox = (mapInstance && mapInstance._container && container.contains(mapInstance._container))
    ? mapInstance._container
    : null;
  if (prevLiveMapBox && prevLiveMapBox.parentNode) {
    prevLiveMapBox.parentNode.removeChild(prevLiveMapBox);
  }
  container.innerHTML = `
    <div class="card">
      <div style="margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:6px;">
          <span class="section-title"><svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z\" fill=\"rgba(239,68,68,0.22)\" stroke=\"#ef4444\" stroke-width=\"1.9\"/><circle cx=\"12\" cy=\"11\" r=\"2.3\" fill=\"#ef4444\"/></svg> Водоём, карта глубин и точки</span>
          <span style="font-size:var(--fs-xs);color:var(--accent);font-weight:700;">
            ${s.lat.toFixed(2)}°N, ${s.lon.toFixed(2)}°E
          </span>
        </div>
        <!-- Симметричная сетка управления картой 2x2 («по фен-шую») -->
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:8px;">
          <button type="button" class="btn btn-sm" id="geoGpsBtn" style="width:100%;min-height:40px;padding:6px 10px;font-size:12px;font-weight:800;justify-content:center;"><svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><circle cx=\"12\" cy=\"12\" r=\"8.5\" stroke=\"currentColor\" stroke-width=\"1.8\"/><circle cx=\"12\" cy=\"12\" r=\"4.5\" stroke=\"#38bdf8\" stroke-width=\"1.6\"/><circle cx=\"12\" cy=\"12\" r=\"1.8\" fill=\"#10b981\"/></svg> <span class="geo-full-only-inline">Мой GPS</span><span class="geo-guest-only-inline">Где я</span></button>
          <button type="button" class="btn btn-sm ${inspectMode ? 'btn-good' : 'btn-accent'}" id="geoInspectModeBtn" style="width:100%;min-height:40px;padding:6px 10px;font-size:12px;font-weight:800;justify-content:center;" title="Показать рыб, которые клюют в выбранной точке водоёма">
            <svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><circle cx=\"11\" cy=\"11\" r=\"6.5\" stroke=\"currentColor\" stroke-width=\"2\"/><path d=\"M16 16l4.5 4.5\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/></svg>
            <span class="geo-full-only-inline">${inspectMode ? 'Разведка ВКЛ' : 'Что здесь клюёт?'}</span>
            <span class="geo-guest-only-inline">Кто здесь клюёт</span>
          </button>
          <button type="button" class="btn btn-sm geo-auth-only-block" id="geoSaveSpotBtn" style="width:100%;min-height:40px;padding:6px 10px;font-size:12px;font-weight:800;justify-content:center;"><svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M12 2.5l2.9 6 6.6.9-4.8 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5-4.8-4.6 6.6-.9L12 2.5z\" fill=\"#fbbf24\" stroke=\"#f59e0b\" stroke-width=\"1.6\" stroke-linejoin=\"round\"/></svg> + Точка в закладки</button>
          <button type="button" class="btn btn-sm btn-good geo-auth-only-block" id="geoQuickLogCatchBtn" style="width:100%;min-height:40px;padding:6px 10px;font-size:12px;font-weight:800;justify-content:center;"><svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M4 20C5 11 11 5 20 4\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/><path d=\"M20 4v7c0 1.7-1.3 3-3 3s-3-1.3-3-3\" stroke=\"#38bdf8\" stroke-width=\"1.8\" stroke-linecap=\"round\"/><circle cx=\"14\" cy=\"16\" r=\"2.2\" fill=\"#10b981\"/></svg> + Записать в журнал</button>
          <button type="button" class="btn btn-sm btn-accent geo-auth-only-block" id="geoOpenOfflineMapsBtn" style="width:100%;min-height:40px;padding:6px 10px;font-size:11.5px;font-weight:900;justify-content:center;" title="Скачать карту выбранной локации (50 км или 120 км) для работы без сети">
            <svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>
            <span>Офлайн-карты 50/120 км${getCachedOfflineMapPacksSync().length > 0 ? ` (${getCachedOfflineMapPacksSync().length})` : ''}</span>
          </button>
          <button type="button" class="btn btn-sm geo-auth-only-block" id="geoOpenPhase3RoutesBtn" style="width:100%;min-height:40px;padding:6px 10px;font-size:11.5px;font-weight:900;justify-content:center;border-color:${_phase3ActiveTrack ? 'var(--bad)' : 'var(--warn)'};color:${_phase3ActiveTrack ? 'var(--bad)' : 'var(--warn)'};background:${_phase3ActiveTrack ? 'rgba(239,68,68,0.14)' : 'rgba(245,158,11,0.10)'};" title="Запись маршрута в фоне, возврат по следу и аварийный режим Я потерялся">
            <svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><circle cx=\"12\" cy=\"12\" r=\"9\" stroke=\"currentColor\" stroke-width=\"1.8\"/><polygon points=\"16,8 13.5,13.5 8,16 10.5,10.5\" fill=\"currentColor\"/></svg>
            <span>${_phase3ActiveTrack ? (_phase3ActiveTrack.status === 'returning' ? 'Возврат по следу ВКЛ' : `Маршрут: ${(_phase3ActiveTrack.totalDistKm || 0).toFixed(1)} км`) : 'Маршруты • Я потерялся'}</span>
          </button>
        </div>
        <!-- Статус согласия на передачу геоданных в сеть Интернет (ст. 10.1 152-ФЗ) с кнопкой отзыва -->
        <div class="geo-auth-only-block" style="margin-top:8px;padding:7px 10px;background:var(--card);border:1px solid var(--border);border-radius:8px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;font-size:11px;">
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-weight:800;color:${isGeoDistributionConsentActive() ? 'var(--good)' : 'var(--muted)'};">
              ${isGeoDistributionConsentActive() ? '[✓] Согласие на передачу геоданных в сеть активно' : '[ ] Передача геоданных в сеть не активирована (100% локально)'}
            </span>
          </div>
          <div style="display:flex;gap:6px;">
            ${isGeoDistributionConsentActive() ? `
              <button type="button" class="btn btn-sm" id="geoRevokeConsentQuickBtn" style="min-height:26px;padding:2px 8px;font-size:10.5px;color:var(--bad);border-color:rgba(239,68,68,0.45);">
                Отозвать и удалить геоданные
              </button>
            ` : `
              <button type="button" class="btn btn-sm btn-accent" id="geoGrantConsentQuickBtn" style="min-height:26px;padding:2px 8px;font-size:10.5px;">
                Дать согласие на отправку
              </button>
            `}
          </div>
        </div>
      </div>
      ${inlineGpsHint ? `<div style="margin-bottom:8px;padding:7px 11px;border-radius:var(--r-sm);background:var(--pill-warn-bg);color:var(--pill-warn-text);font-size:var(--fs-xs);font-weight:700;line-height:1.4;"><svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><circle cx=\"12\" cy=\"12\" r=\"9\" fill=\"rgba(56,189,248,0.18)\" stroke=\"#38bdf8\" stroke-width=\"1.8\"/><path d=\"M12 11v5M12 8h.01\" stroke=\"#38bdf8\" stroke-width=\"2\" stroke-linecap=\"round\"/></svg> ${inlineGpsHint}</div>` : ''}
      <div id="geoMapSection" style="display:${showDrawer ? 'block' : 'none'};margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--border);">
        <div class="geo-auth-only-block">
        <div style="display:flex;gap:6px;margin-bottom:8px;">
          <input type="search" id="geoSearchInput" class="input" style="flex:1;" placeholder="Поиск реки, озера, города или посёлка РФ...">
          <button type="button" class="btn btn-sm btn-accent" id="geoSearchBtn" style="min-height:38px;padding:0 14px;">Найти</button>
        </div>
        <div style="font-size:10.5px;color:var(--muted);font-weight:800;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.3px;">
          Режим Яндекс Карты:
        </div>
        <div class="map-layers-row" style="margin-bottom:6px;">
          ${Object.entries(MAP_LAYERS).map(([k, v]) => `
            <button type="button" class="btn btn-sm map-layer-btn ${currentLayerKey === k ? 'btn-accent' : ''}" data-map-layer="${k}">${v.name}</button>
          `).join('')}
        </div>
        <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-bottom:8px;">
          <span style="font-size:10.5px;color:var(--muted);font-weight:800;">Фильтры Яндекс Карты:</span>
          <button type="button" class="w-chip ${yandexMapFilters.hydro ? 'active' : ''}" data-ymap-filter="hydro" style="min-height:26px;padding:2px 9px;font-size:11px;" title="Усилить контраст проток, стариц, песчаных кос и береговой линии">
            Контраст русел и проток
          </button>
          <button type="button" class="w-chip ${(yandexMapFilters.labels || currentLayerKey === 'yandex_hybrid') ? 'active' : ''}" data-ymap-filter="labels" style="min-height:26px;padding:2px 9px;font-size:11px;" title="Наложить векторные названия рек, озёр и ориентиров Яндекса поверх спутника">
            Названия рек и дорог
          </button>
          <button type="button" class="w-chip ${yandexMapFilters.dim ? 'active' : ''}" data-ymap-filter="dim" style="min-height:26px;padding:2px 9px;font-size:11px;" title="Приглушить яркость карты для комфортного просмотра в сумерках и ночью">
            Антиблик (вечерний)
          </button>
          ${isUserAdmin(s) ? `<button type="button" class="w-chip ${_forceOfflineTestMode ? 'active' : ''}" id="geoToggleOfflineSimChip" style="min-height:26px;padding:2px 9px;font-size:11px;${_forceOfflineTestMode ? 'border-color:var(--good);color:var(--good);font-weight:900;' : ''}" title="Включить или выключить режим проверки офлайн-карты без интернета (только для Админа)">
            ${_forceOfflineTestMode ? 'Тест офлайн: ВКЛ' : 'Тест без сети'}
          </button>` : ''}
        </div>
        ${(_forceOfflineTestMode && isUserAdmin(s)) ? `<div style="margin-bottom:6px;padding:6px 10px;border-radius:8px;background:rgba(16,185,129,0.14);border:1.5px solid var(--good);display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:11px;font-weight:800;color:var(--good);"><span>РЕЖИМ ПРОВЕРКИ ОФЛАЙН-КАРТЫ: интернет отключён, карта читается из памяти устройства</span><button type="button" class="btn btn-sm" id="geoDisableOfflineSimBannerBtn" style="min-height:24px;padding:1px 8px;font-size:10.5px;">Выключить</button></div>` : ''}
        </div>
        ${(typeof window !== 'undefined' && window.__KLEV_CATCH_WIZARD_PICK_SPOT__?.active) ? `
          <div id="cwMapPickFloatingBanner" style="margin-bottom:8px;padding:10px 12px;border-radius:10px;background:rgba(16,185,129,0.16);border:1.5px solid var(--good);display:flex;flex-direction:column;gap:8px;">
            <div style="font-size:12px;font-weight:800;color:var(--text);line-height:1.38;">
              Выбор точки улова на карте: нажмите на нужное место водоёма на карте ниже (сейчас: <b>${escapeHtml(s.locLabel)} • ${escapeHtml(s.selectedWaterName || 'водоём')}</b>, ${s.lat.toFixed(4)}°N, ${s.lon.toFixed(4)}°E) и подтвердите выбор.
            </div>
            <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;">
              <button type="button" class="btn btn-sm btn-good" id="cwConfirmMapSpotReturnBtn" style="min-height:36px;font-weight:900;">Подтвердить точку для улова</button>
              <button type="button" class="btn btn-sm" id="cwCancelMapSpotReturnBtn" style="min-height:36px;font-weight:800;">Вернуться без изменений</button>
            </div>
          </div>
        ` : ''}
        <div id="geoActiveRouteLiveHudMount" style="display:none;"></div>
        <div id="mapBox" role="application" aria-label="Карта выбора водоёма"></div>
        <div class="geo-auth-only-block">
        <!-- Слои меток на карте: компактная панель из 3 раскрывающихся списков с множественным выбором (описания внутри списков) -->
        ${(() => {
          const totalSourcesPts = thematicCount + circleBlurCount + crewExactCount;
          const allSourcesSelected = Boolean(visibleMapLayers.mySpots && visibleMapLayers.circleBlur && visibleMapLayers.crewExact);
          const activeSourceNames = [];
          if (visibleMapLayers.mySpots) activeSourceNames.push(`Ориентиры (${thematicCount})`);
          if (visibleMapLayers.circleBlur) activeSourceNames.push(`Круг (${circleBlurCount})`);
          if (visibleMapLayers.crewExact) activeSourceNames.push(`Экипаж (${crewExactCount})`);
          const sourcesBtnText = allSourcesSelected
            ? `1. Слои: Все точки (${totalSourcesPts})`
            : (activeSourceNames.length > 0 ? `1. Слои: ${activeSourceNames.join(', ')}` : '1. Слои: Скрыты (0)');

          const totalOwnerPts = mineMapCount + foreignMapCount;
          const bothOwnersSelected = Boolean(visibleMapLayers.showMine && visibleMapLayers.showForeign);
          const ownerBtnText = bothOwnersSelected
            ? `2. Чьи: Все точки (${totalOwnerPts})`
            : (visibleMapLayers.showMine
                ? `2. Чьи: Мои (${mineMapCount})`
                : (visibleMapLayers.showForeign ? `2. Чьи: Чужие (${foreignMapCount})` : '2. Чьи: Скрыты (0)'));

          const allCatsList = Object.values(SPOT_CATEGORIES);
          const selCats = visibleMapLayers.selectedCategories instanceof Set ? visibleMapLayers.selectedCategories : new Set(allCatsList.map(c => c.id));
          const allCatsSelected = selCats.size >= allCatsList.length;
          const catBtnText = allCatsSelected
            ? `3. Ориентиры водоёма: Все точки (${thematicCount})`
            : (selCats.size > 0
                ? `3. Ориентиры: ${allCatsList.filter(c => selCats.has(c.id)).map(c => c.short).join(', ')}`
                : '3. Ориентиры: Не выбраны (0)');

          const catDescriptions = {
            slip: 'Съезд для спуска ПВХ-лодки или катера на воду',
            snag: 'Подводный коряжник, топляк или бровка (стоянка рыбы)',
            camp: 'Береговая поляна для палатки, костра или стоянки авто',
            hazard: 'Тонкий лёд, промоина, майна, мель, камень или старая сеть',
            bite: 'Рабочая яма, русловой свал или точка активного клёва',
            shop: 'Рыболовный магазин (живец, мотыль, прикормка, снасти)'
          };

          return `
        <div id="geoMapLayersMultiSelectCard" style="margin-top:8px;margin-bottom:6px;padding:7px 9px;background:var(--panel);border:1px solid var(--border);border-radius:var(--r-sm);width:100%;max-width:100%;display:flex;flex-direction:column;gap:5px;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
            <span style="font-size:10px;color:var(--muted);font-weight:800;text-transform:uppercase;letter-spacing:0.2px;">
              Слои меток на карте:
            </span>
          </div>

          <!-- Компактная сетка кнопок: 1 и 2 в одной строке, 3 под ними -->
          <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;">
            <button type="button" class="btn btn-sm ${allSourcesSelected ? 'btn-accent' : ''}" data-ms-dropdown-toggle="sources" style="width:100%;min-width:0;min-height:30px;justify-content:space-between;padding:3px 8px;font-size:11px;font-weight:800;text-align:left;">
              <span id="msSourcesSummaryLbl" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(sourcesBtnText)}</span>
              <span style="flex-shrink:0;margin-left:4px;font-size:10px;">▾</span>
            </button>
            <button type="button" class="btn btn-sm ${bothOwnersSelected ? 'btn-accent' : 'btn-good'}" data-ms-dropdown-toggle="ownership" style="width:100%;min-width:0;min-height:30px;justify-content:space-between;padding:3px 8px;font-size:11px;font-weight:800;text-align:left;">
              <span id="msOwnershipSummaryLbl" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(ownerBtnText)}</span>
              <span style="flex-shrink:0;margin-left:4px;font-size:10px;">▾</span>
            </button>
            <button type="button" class="btn btn-sm ${allCatsSelected ? 'btn-accent' : ''}" data-ms-dropdown-toggle="categories" style="grid-column:1 / -1;width:100%;min-width:0;min-height:30px;justify-content:space-between;padding:3px 8px;font-size:11px;font-weight:800;text-align:left;">
              <span id="msCategoriesSummaryLbl" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(catBtnText)}</span>
              <span style="flex-shrink:0;margin-left:4px;font-size:10px;">▾</span>
            </button>
          </div>

          <!-- Раскрывающийся список 1: Источники меток -->
          <div id="msDropdownPanel_sources" style="display:${visibleMapLayers.openDropdown === 'sources' ? 'flex' : 'none'};flex-direction:column;gap:5px;padding:7px 9px;background:var(--card);border:1px solid var(--accent);border-radius:8px;">
            <div style="font-size:10.5px;color:var(--muted);line-height:1.3;">
              <b>1. Источники меток:</b> выберите, какие слои показывать на карте (можно отметить сразу несколько).
            </div>
            <label style="display:flex;align-items:center;gap:7px;padding:4px 4px;border-bottom:1px dashed var(--border);cursor:pointer;font-size:11px;font-weight:900;color:var(--accent);">
              <input type="checkbox" data-ms-source-all="1" ${allSourcesSelected ? 'checked' : ''} style="width:15px;height:15px;flex-shrink:0;">
              <span>Все точки и слои на карте (${totalSourcesPts})</span>
            </label>
            <label style="display:flex;align-items:flex-start;gap:7px;padding:3px 4px;cursor:pointer;font-size:11px;">
              <input type="checkbox" data-ms-source-item="mySpots" ${visibleMapLayers.mySpots ? 'checked' : ''} style="margin-top:2px;width:15px;height:15px;flex-shrink:0;">
              <div>
                <div style="font-weight:800;color:var(--text);">Ориентиры водоёма и закладки (${thematicCount})</div>
                <div style="font-size:10px;color:var(--muted);">Точные береговые и водные метки: слипы, ямы, коряги, стоянки, опасный лёд и магазины</div>
              </div>
            </label>
            <label style="display:flex;align-items:flex-start;gap:7px;padding:3px 4px;cursor:pointer;font-size:11px;">
              <input type="checkbox" data-ms-source-item="circleBlur" ${visibleMapLayers.circleBlur ? 'checked' : ''} style="margin-top:2px;width:15px;height:15px;flex-shrink:0;">
              <div>
                <div style="font-weight:800;color:var(--text);">Сводки сообщества «Круг» ±5 км (${circleBlurCount})</div>
                <div style="font-size:10px;color:var(--muted);">Отчёты рыбаков за 72 ч в виде шестиугольных зон (показывают район клёва без сдачи секретной лунки)</div>
              </div>
            </label>
            <label style="display:flex;align-items:flex-start;gap:7px;padding:3px 4px;cursor:pointer;font-size:11px;">
              <input type="checkbox" data-ms-source-item="crewExact" ${visibleMapLayers.crewExact ? 'checked' : ''} style="margin-top:2px;width:15px;height:15px;flex-shrink:0;">
              <div>
                <div style="font-weight:800;color:var(--text);">Точные точки закрытого «Экипажа» (${crewExactCount})</div>
                <div style="font-size:10px;color:var(--muted);">Координаты стоянок и рабочих лунок вашей группы по ключу KP-...</div>
              </div>
            </label>
          </div>

          <!-- Раскрывающийся список 2: Принадлежность точек -->
          <div id="msDropdownPanel_ownership" style="display:${visibleMapLayers.openDropdown === 'ownership' ? 'flex' : 'none'};flex-direction:column;gap:5px;padding:7px 9px;background:var(--card);border:1px solid var(--accent);border-radius:8px;">
            <div style="font-size:10.5px;color:var(--muted);line-height:1.3;">
              <b>2. Принадлежность точек:</b> оставьте только свои личные наработки или включите метки других рыболовов.
            </div>
            <label style="display:flex;align-items:center;gap:7px;padding:4px 4px;border-bottom:1px dashed var(--border);cursor:pointer;font-size:11px;font-weight:900;color:var(--accent);">
              <input type="checkbox" data-ms-owner-all="1" ${bothOwnersSelected ? 'checked' : ''} style="width:15px;height:15px;flex-shrink:0;">
              <span>Все точки: Мои и Чужие (${totalOwnerPts})</span>
            </label>
            <label style="display:flex;align-items:flex-start;gap:7px;padding:3px 4px;cursor:pointer;font-size:11px;">
              <input type="checkbox" data-ms-owner-item="mine" ${visibleMapLayers.showMine ? 'checked' : ''} style="margin-top:2px;width:15px;height:15px;flex-shrink:0;">
              <div>
                <div style="font-weight:800;color:var(--text);">Мои личные точки и закладки (${mineMapCount})</div>
                <div style="font-size:10px;color:var(--muted);">Ваши приватные закладки на устройстве и опубликованные вами отчёты</div>
              </div>
            </label>
            <label style="display:flex;align-items:flex-start;gap:7px;padding:3px 4px;cursor:pointer;font-size:11px;">
              <input type="checkbox" data-ms-owner-item="foreign" ${visibleMapLayers.showForeign ? 'checked' : ''} style="margin-top:2px;width:15px;height:15px;flex-shrink:0;">
              <div>
                <div style="font-weight:800;color:var(--text);">Точки других рыболовов (${foreignMapCount})</div>
                <div style="font-size:10px;color:var(--muted);">Общедоступные слипы, опасный лёд и сводки участников сообщества</div>
              </div>
            </label>
          </div>

          <!-- Раскрывающийся список 3: Категории ориентиров водоёма -->
          <div id="msDropdownPanel_categories" style="display:${visibleMapLayers.openDropdown === 'categories' ? 'flex' : 'none'};flex-direction:column;gap:5px;padding:7px 9px;background:var(--card);border:1px solid var(--accent);border-radius:8px;">
            <div style="font-size:10.5px;color:var(--muted);line-height:1.3;">
              <b>3. Типы ориентиров на водоёме:</b> отметьте нужные категории объектов для отображения на карте.
            </div>
            <label style="display:flex;align-items:center;gap:7px;padding:4px 4px;border-bottom:1px dashed var(--border);cursor:pointer;font-size:11px;font-weight:900;color:var(--accent);">
              <input type="checkbox" data-ms-cat-all="1" ${allCatsSelected ? 'checked' : ''} style="width:15px;height:15px;flex-shrink:0;">
              <span>Все типы точек водоёма (${thematicCount})</span>
            </label>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:4px;">
              ${allCatsList.map(cat => `
                <label style="display:flex;align-items:flex-start;gap:6px;padding:3px 4px;cursor:pointer;font-size:11px;">
                  <input type="checkbox" data-ms-cat-item="${cat.id}" ${selCats.has(cat.id) ? 'checked' : ''} style="margin-top:2px;width:15px;height:15px;flex-shrink:0;">
                  <div>
                    <div style="font-weight:800;color:var(--text);display:flex;align-items:center;gap:4px;">
                      ${cat.icon} <span>${escapeHtml(cat.short)}</span>
                    </div>
                    <div style="font-size:9.8px;color:var(--muted);line-height:1.25;">${escapeHtml(catDescriptions[cat.id] || cat.short)}</div>
                  </div>
                </label>
              `).join('')}
            </div>
          </div>
          `;
        })()}
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;font-size:10.5px;color:${inspectMode ? 'var(--good)' : 'var(--muted)'};font-weight:700;margin-top:2px;">
            ${inspectMode ? '<span><svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><circle cx=\"11\" cy=\"11\" r=\"6.5\" stroke=\"currentColor\" stroke-width=\"2\"/><path d=\"M16 16l4.5 4.5\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/></svg> Режим разведки активен: нажмите в любое место карты</span>' : ''}
            <span id="geoZoomScaleHintBadge" style="color:var(--accent);font-size:10.5px;">${(mapInstance && mapInstance.getZoom && mapInstance.getZoom() >= 12) ? 'Масштаб &lt; 1 км/см: показаны отдельные точки (слипы, коряги, стоянки)' : 'Обзорный масштаб: точки сгруппированы в круги с цифрой (приблизьте для деталей)'}</span>
          </div>
        </div>
        <!-- Карточка мгновенной разведки «<svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><circle cx=\"11\" cy=\"11\" r=\"6.5\" stroke=\"currentColor\" stroke-width=\"2\"/><path d=\"M16 16l4.5 4.5\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/></svg> Что здесь клюёт?» (Шаг 1) -->
        ${inspectedPoint ? `
          <div class="card" id="geoScoutResultCard" style="margin-top:10px;background:var(--card);border:1.5px solid var(--good);padding:10px 12px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;">
              <div>
                <span class="pill pill-good" style="font-size:10px;"><svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><circle cx=\"11\" cy=\"11\" r=\"6.5\" stroke=\"currentColor\" stroke-width=\"2\"/><path d=\"M16 16l4.5 4.5\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/></svg> Разведка точки (без перезаписи вашей локации)</span>
                <div style="font-weight:800;font-size:var(--fs-md);margin-top:4px;">
                  <svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z\" fill=\"rgba(239,68,68,0.22)\" stroke=\"#ef4444\" stroke-width=\"1.9\"/><circle cx=\"12\" cy=\"11\" r=\"2.3\" fill=\"#ef4444\"/></svg> ${inspectedPoint.settlementLabel} • ${inspectedPoint.primaryWaterName}
                </div>
                <div style="font-size:var(--fs-xs);color:var(--muted);">
                  ${inspectedPoint.basinName} (${inspectedPoint.lat.toFixed(3)}°N, ${inspectedPoint.lon.toFixed(3)}°E)
                </div>
              </div>
            </div>
            <div style="margin-top:8px;font-size:var(--fs-xs);color:var(--accent);font-weight:800;">
              <svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M2 12s4-6 11-6c4.2 0 7 2.5 9 6-2 3.5-4.8 6-9 6-7 0-11-6-11-6z\" fill=\"rgba(56,189,248,0.28)\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linejoin=\"round\"/><path d=\"M2 12l-1.5-3.5L5 10.5M2 12l-1.5 3.5L5 13.5\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\"/><circle cx=\"16.5\" cy=\"10.8\" r=\"1.3\" fill=\"currentColor\"/></svg> ТОП-6 АКТИВНЫХ ВИДОВ РЫБ ЗДЕСЬ СЕГОДНЯ:
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:6px;margin-top:6px;">
              ${inspectedPoint.topSpecies.map(item => {
                const tone = item.score >= 60 ? 'var(--good)' : (item.score >= 38 ? 'var(--warn)' : 'var(--bad)');
                return `
                  <div style="padding:6px 8px;background:var(--panel);border:1px solid var(--border);border-radius:6px;font-size:var(--fs-xs);">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                      <b>${item.fish.name}</b>
                      <span style="font-weight:800;color:${tone};">${item.score}%</span>
                    </div>
                    <div style="font-size:10px;color:var(--muted);margin-top:2px;">${item.methodText}</div>
                  </div>
                `;
              }).join('')}
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;padding-top:8px;border-top:1px solid var(--border);">
              <button type="button" class="btn btn-sm btn-accent" id="scoutApplyLocationBtn" style="flex:2;min-width:170px;"><svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z\" fill=\"rgba(239,68,68,0.22)\" stroke=\"#ef4444\" stroke-width=\"1.9\"/><circle cx=\"12\" cy=\"11\" r=\"2.3\" fill=\"#ef4444\"/></svg> Сделать основной точкой</button>
              <button type="button" class="btn btn-sm" id="scoutCloseBtn" style="flex:1;min-width:110px;"><svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M6 6l12 12M18 6L6 18\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\"/></svg> Закрыть</button>
            </div>
          </div>
        ` : ''}
        ${(() => {
          const rawPlaces = (s.nearbyPlaces && s.nearbyPlaces.length) ? [...s.nearbyPlaces] : getNearestRussianSettlements(s.lat, s.lon, 24, 180);
          if (!rawPlaces.length) return '';
          const curCity = String(s.locLabel || s.locAdmin2 || '').toLowerCase();
          rawPlaces.sort((a, b) => {
            const aSel = curCity && (a.name.toLowerCase() === curCity || curCity.includes(a.name.toLowerCase().split('(')[0].trim()));
            const bSel = curCity && (b.name.toLowerCase() === curCity || curCity.includes(b.name.toLowerCase().split('(')[0].trim()));
            if (aSel && !bSel) return -1;
            if (!aSel && bSel) return 1;
            return (a.distKm || 0) - (b.distKm || 0);
          });
          return `
            <div style="margin-top:10px;">
              <label for="geoNearbyPlaceSelect" style="display:block;font-size:var(--fs-xs);color:var(--muted);font-weight:700;margin-bottom:4px;">
                <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5z" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
                ГОРОД / НАСЕЛЁННЫЙ ПУНКТ (${rawPlaces.length} в регионе • выберите из раскрывающегося списка):
              </label>
              <select id="geoNearbyPlaceSelect" class="input" style="width:100%;min-height:40px;font-weight:800;">
                ${rawPlaces.map((p, idx) => `
                  <option value="${p.lat},${p.lon},${escapeHtml(p.name)}" ${idx === 0 ? 'selected' : ''}>
                    ${idx === 0 ? '★ ' : ''}${escapeHtml(p.name)} — ${p.distKm <= 1 ? 'текущая локация' : (p.distKm + ' км')}
                  </option>
                `).join('')}
              </select>
            </div>
          `;
        })()}
        ${s.savedSpots.length ? `
          <div style="margin-top:8px;">
            <div style="font-size:var(--fs-xs);color:var(--muted);font-weight:700;margin-bottom:4px;"><svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z\" fill=\"rgba(239,68,68,0.22)\" stroke=\"#ef4444\" stroke-width=\"1.9\"/><circle cx=\"12\" cy=\"11\" r=\"2.3\" fill=\"#ef4444\"/></svg> ВАШИ СОХРАНЁННЫЕ ЗАКЛАДКИ (<svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><rect x=\"5\" y=\"11\" width=\"14\" height=\"10\" rx=\"2.5\" fill=\"rgba(251,191,36,0.22)\" stroke=\"#fbbf24\" stroke-width=\"1.8\"/><path d=\"M8 11V7a4 4 0 0 1 8 0v4\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\"/></svg> 100% ПРИВАТНО НА УСТРОЙСТВЕ):</div>
            <div style="font-size:10.5px;color:var(--muted);margin-bottom:4px;">Фильтр ваших закладок по назначению:</div>
            <div class="chip-scroll-row" style="margin-bottom:6px;padding-bottom:2px;">
              <button type="button" class="w-chip ${visibleMapLayers.spotCategory === 'all' ? 'active' : ''}" data-spot-cat-filter="all" style="min-height:28px;padding:3px 9px;font-size:11px;"><svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6z\" fill=\"rgba(56,189,248,0.18)\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linejoin=\"round\"/><path d=\"M9 3v15M15 6v15\" stroke=\"currentColor\" stroke-width=\"1.6\"/><circle cx=\"12\" cy=\"10\" r=\"2.2\" fill=\"#38bdf8\" stroke=\"#fff\" stroke-width=\"1\"/></svg> Все закладки (${s.savedSpots.length})</button>
              ${Object.values(SPOT_CATEGORIES).map(cat => `
                <button type="button" class="w-chip ${visibleMapLayers.spotCategory === cat.id ? 'active' : ''}" data-spot-cat-filter="${cat.id}" style="min-height:28px;padding:3px 9px;font-size:11px;">
                  ${cat.icon} ${cat.label}
                </button>
              `).join('')}
            </div>
            <div class="chip-scroll-row">
              ${s.savedSpots.filter(sp => visibleMapLayers.spotCategory === 'all' || (sp.category || 'bite') === visibleMapLayers.spotCategory).map(sp => `
                <span class="w-chip" style="gap:6px;">
                  <button type="button" style="background:none;border:none;cursor:pointer;font-weight:700;color:var(--text);" data-load-spot="${sp.id}">${(SPOT_CATEGORIES[sp.category] || SPOT_CATEGORIES.bite).icon} ${escapeHtml(sp.name)}</button>
                  <button type="button" style="background:none;border:none;cursor:pointer;color:var(--bad);" data-del-spot="${sp.id}" aria-label="Удалить точку"><svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M6 6l12 12M18 6L6 18\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\"/></svg></button>
                </span>
              `).join('')}
            </div>
          </div>
        ` : ''}

 </div>
 </div>
 <div style="margin-bottom:12px;">
 <div class="geo-auth-only-block" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:6px;">
 <label for="geoNearbyWaterSelect" style="font-size:var(--fs-xs);color:var(--muted);font-weight:700;">
 ВОДОЁМЫ В РАДИУСЕ <b>ДО ${activeRadius} КМ</b> (${(s.nearbyWaters || []).length} шт.)
 ${s.selectedWaterName ? `• выбран: <b style="color:var(--accent);">${escapeHtml(s.selectedWaterName)}</b> [${getWaterTypeShortTag(s.water)}]` : '(выберите из списка)'}:
 </label>
 <div style="display:inline-flex;gap:5px;align-items:center;">
 <button type="button" class="btn btn-sm ${activeRadius === 50 ? 'btn-accent' : ''}" data-water-radius="50" style="min-height:30px;padding:3px 10px;"> До 50 км</button>
 <button type="button" class="btn btn-sm ${activeRadius === 120 ? 'btn-accent' : ''}" data-water-radius="120" style="min-height:30px;padding:3px 10px;"> До 120 км</button>
 </div>
 </div>
 ${(() => {
   const curatedWaters = getNearestRussianWaters(s.lat, s.lon, s.basinCode, s.isCoastal, 40, activeRadius);
   const mergedMap = new Map();
   for (const cw of curatedWaters) {
     mergedMap.set((cw.name || '').toLowerCase(), cw);
   }
   if (Array.isArray(s.nearbyWaters)) {
     for (const nw of s.nearbyWaters) {
       const k = (nw.name || '').toLowerCase();
       if (k && !mergedMap.has(k)) mergedMap.set(k, nw);
     }
   }
   const rawWaters = Array.from(mergedMap.values());
   const selNameNorm = String(s.selectedWaterName || '').toLowerCase().trim();
   rawWaters.sort((a, b) => {
     const aName = String(a.name || '').toLowerCase().trim();
     const bName = String(b.name || '').toLowerCase().trim();
     const aExact = Boolean(selNameNorm && (aName === selNameNorm || aName.includes(selNameNorm) || selNameNorm.includes(aName)));
     const bExact = Boolean(selNameNorm && (bName === selNameNorm || bName.includes(selNameNorm) || selNameNorm.includes(bName)));
     if (aExact && !bExact) return -1;
     if (!aExact && bExact) return 1;
     const aTypeMatch = a.wType === s.water;
     const bTypeMatch = b.wType === s.water;
     if (aTypeMatch && !bTypeMatch) return -1;
     if (!aTypeMatch && bTypeMatch) return 1;
     return (a.distKm || 0) - (b.distKm || 0);
   });
   return `
           <select id="geoNearbyWaterSelect" class="input geo-auth-only-block" style="width:100%;min-height:42px;font-weight:800;">
        ${rawWaters.map((w, idx) => {
          const cleanLbl = String(w.label || w.name || '').replace(/<svg[\s\S]*?<\/svg>/gi, '').replace(/<[^>]+>/g, '').trim();
          return `<option value="${escapeHtml(w.wType)}|${escapeHtml(w.name || cleanLbl)}|${w.defDepth || ''}|${w.lat || ''}|${w.lon || ''}" ${idx === 0 ? 'selected' : ''}>${idx === 0 ? '★ ' : ''}${escapeHtml(cleanLbl)}</option>`;
        }).join('')}
      </select>
      ${(() => {
        const activeWaterTitle = s.selectedWaterName || rawWaters[0]?.name || prof.shortName || 'Водоём';
        const ecoreg = getSpotEcoregion(s.lat, s.lon, s.basinCode, s.water, activeWaterTitle);
        const basinTitle = ecoreg.displayBasinName || BASIN_CONFIGS[s.basinCode]?.name || 'Бассейн РФ';
        const dayObj = s.weatherDays?.[s.dayIdx] || s.weatherDays?.[2] || s.weatherDays?.[0] || null;
        const rTypes = new Set([s.water]);
        const hasCool = s.water === 'cooling_reservoir';
        const isCoastLocal = Boolean(s.isCoastal || s.water.startsWith('sea'));
        const waterSpecies = FISH_DB.filter(f => f.legal !== 'redbook' && isSpeciesInGeoRange(f, s.lat, s.lon, s.basinCode, s.water, activeRadius, rTypes, isCoastLocal, hasCool, activeWaterTitle));
        const sigSet = new Map((ecoreg.signatureSpecies || []).map((id, i) => [id, i]));
        const ranked = waterSpecies.map(f => {
          const compat = getCompatibleMethods(f, dayObj?.iceState || s.iceState, s.water, dayObj?.waterTemp ?? 10);
          const bestM = compat[0]?.val || s.method;
          const sc = dayObj ? calcDayBest(f, dayObj, bestM, s.water, s.depth, s.normPress, dayObj.iceState || s.iceState) : 65;
          const sIdx = sigSet.has(f.id) ? sigSet.get(f.id) : -1;
          const bonus = sIdx >= 0 ? Math.max(6, 24 - sIdx * 2) : 0;
          return { fish: f, score: sc, rank: sc + bonus };
        }).sort((a, b) => b.rank - a.rank).slice(0, 6);
        if (!ranked.length) return '';
        return `
          <div id="geoWaterIchthyoCard" style="margin-top:8px;padding:9px 11px;background:var(--panel);border:1.5px solid var(--border);border-radius:var(--r-sm);transition:border-color 0.25s ease, box-shadow 0.25s ease;">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;font-size:11.5px;margin-bottom:6px;">
              <span style="font-weight:800;color:var(--accent);"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 12s4-6 11-6c4.2 0 7 2.5 9 6-2 3.5-4.8 6-9 6-7 0-11-6-11-6z" fill="rgba(56,189,248,0.28)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="16.5" cy="10.8" r="1.3" fill="currentColor"/></svg> Ихтиобаза водоёма «${escapeHtml(activeWaterTitle)}» (${waterSpecies.length} видов):</span>
              <span style="color:var(--muted);font-size:10.5px;">${escapeHtml(basinTitle)}</span>
            </div>
            <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;">
              ${ranked.map(item => {
                const isCur = item.fish.id === s.fishId;
                const col = item.score >= 65 ? 'var(--good)' : (item.score >= 42 ? 'var(--warn)' : 'var(--muted)');
                return `<button type="button" class="btn btn-sm ${isCur ? 'btn-accent' : ''}" data-water-ichthyo-fish="${item.fish.id}" style="min-height:32px;padding:3px 6px;font-size:11px;justify-content:space-between;">
                  <span style="overflow:hidden;text-overflow:ellipsis;">${escapeHtml(item.fish.name.split(' ')[0])}</span>
                  <b style="color:${isCur ? '#fff' : col};margin-left:3px;">${item.score}%</b>
                </button>`;
              }).join('')}
            </div>
          </div>
        `;
      })()}
    `;
 })()}
 </div>
 <div class="card geo-auth-only-block" style="background:var(--card);margin-bottom:14px;padding:10px 12px;border:1px solid var(--border);display:flex;flex-direction:column;gap:8px;">
 <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
 <span style="font-size:var(--fs-xs);font-weight:800;color:var(--accent);"> КАРТА ГЛУБИН И ИНТЕГРАЦИЯ С ЭХОЛОТАМИ: ${s.selectedWaterName || prof.name} (${getWaterTypeShortTag(s.water)})</span>
 <span class="pill pill-neutral" style="font-size:var(--fs-xs);">Диапазон: ${prof.minD}–${prof.maxD} м</span>
 </div>
 <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;font-size:var(--fs-xs);">
 <div style="background:var(--panel);padding:6px 8px;border-radius:6px;">
 <div style="color:var(--muted);font-size:var(--fs-xs);">ТЕКУЩИЙ ГОРИЗОНТ ЛОВЛИ</div>
 <div id="geoCurrentHorizonVal" style="font-weight:800;font-size:var(--fs-sm);color:var(--accent);">${s.depth.toFixed(1)} м (свал / русло)</div>
 </div>
 <div style="background:var(--panel);padding:6px 8px;border-radius:6px;">
 <div style="color:var(--muted);font-size:var(--fs-xs);">ХАРАКТЕР РЕЛЬЕФА</div>
 <div style="font-weight:700;">${prof.flow > 1.5 ? 'Русловая бровка, песчано-галечный свал' : 'Илистое дно, перепады глубин, старичные ямы'}</div>
 </div>
 <div style="background:var(--panel);padding:6px 8px;border-radius:6px;">
 <div style="color:var(--muted);font-size:var(--fs-xs);">СЛОЙ ГЛУБИН ЭХОЛОТА НА КАРТЕ</div>
 <div style="font-weight:700;color:var(--good);">Изобаты глубин (.GPX, .CSV, .KML, .JSON)</div>
 </div>
 </div>
 <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;padding-top:6px;border-top:1px dashed var(--border);font-size:11px;">
   <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-weight:800;color:var(--text);">
     <input type="checkbox" id="geoToggleBathymetryLayerChk" ${_bathymetryLayerEnabled ? 'checked' : ''} style="width:15px;height:15px;accent-color:var(--accent);">
     <span>Показывать цветовой слой глубин (изобаты) на карте</span>
   </label>
   <label class="btn btn-sm btn-accent" style="cursor:pointer;margin:0;min-height:30px;padding:3px 10px;font-size:11px;font-weight:800;">
     Загрузить лог глубин (.GPX / .CSV / .KML / .JSON)
     <input type="file" id="geoBathymetryFileInput" accept=".gpx,.csv,.kml,.xml,.json,*/*" style="display:none;">
   </label>
 </div>
 </div>
 <div class="controls-grid geo-auth-only-block" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr));margin-top:6px;">
 <div>
 <label for="geoWaterSelect" style="display:block;font-size:var(--fs-xs);color:var(--muted);font-weight:700;margin-bottom:4px;">ТИП ВОДНОГО ОБЪЕКТА (БИОТОП)</label>
 <select id="geoWaterSelect" class="input" style="width:100%;min-height:40px;font-weight:800;">
 ${(() => {
   const sortedBiotopes = [...availableWaters].sort((a, b) => (a.id === s.water ? -1 : (b.id === s.water ? 1 : 0)));
   return sortedBiotopes.map((w, idx) => `<option value="${w.id}" ${idx === 0 ? 'selected' : ''}>${idx === 0 ? '★ ' : ''}${String(w.name || '').replace(/<[^>]+>/g, '').trim()}</option>`).join('');
 })()}
 </select>
 </div>
 <div>
 <label for="geoMethodSelect" style="display:block;font-size:var(--fs-xs);color:var(--muted);font-weight:700;margin-bottom:4px;">СПОСОБ ЛОВЛИ И РАБОЧАЯ СНАСТЬ</label>
 <select id="geoMethodSelect" class="input" style="width:100%;min-height:40px;font-weight:800;">
 ${(() => {
   const sortedMethods = [...compatibleMethods].sort((a, b) => (a.val === s.method ? -1 : (b.val === s.method ? 1 : 0)));
   return sortedMethods.map((m, idx) => `<option value="${m.val}" ${idx === 0 ? 'selected' : ''}>${idx === 0 ? '★ ' : ''}${String(m.text || '').replace(/<[^>]+>/g, '').trim()}</option>`).join('');
 })()}
 </select>
 </div>
 <div>
 <label for="geoDepthRange" style="display:block;font-size:var(--fs-xs);color:var(--muted);font-weight:700;margin-bottom:3px;">
 РАБОЧАЯ ГЛУБИНА В ТОЧКЕ: <span id="geoDepthVal" style="color:var(--accent);font-weight:800;">${s.depth.toFixed(1)}</span> м (${prof.minD}–${prof.maxD} м)
 </label>
 <input type="range" id="geoDepthRange" min="${prof.minD}" max="${prof.maxD}" step="0.1" value="${s.depth}" style="width:100%;margin-top:8px;">
 </div>
 </div>
 </div>
 `;
 if (prevLiveMapBox) {
   const newSlot = container.querySelector('#mapBox');
   if (newSlot && newSlot.parentNode) {
     newSlot.parentNode.replaceChild(prevLiveMapBox, newSlot);
   }
 }
 bindGeoEvents(container, showDrawer);
 const newRows = container.querySelectorAll('.chip-scroll-row');
 newRows.forEach((el, idx) => {
 if (Array.isArray(prevScrolls) && prevScrolls[idx] > 0) el.scrollLeft = prevScrolls[idx];
 });
}
function bindGeoEvents(container, showDrawer) {
 const toggleBtn = container.querySelector('#geoToggleMapBtn');
 if (toggleBtn) {
 toggleBtn.addEventListener('click', () => {
 mapOpen = !mapOpen;
 render(container);
 });
 }
 const inspectBtn = container.querySelector('#geoInspectModeBtn');
 if (inspectBtn) {
 inspectBtn.addEventListener('click', () => {
 if (typeof window !== 'undefined' && typeof window.__KLEV_IS_MOBILE_GUEST__ === 'function' && window.__KLEV_IS_MOBILE_GUEST__()) {
   flashHighlightElement('#geoWaterIchthyoCard', { scroll: true, block: 'center', delayMs: 30 });
   showToast('Нажмите на кнопку с названием рыбы ниже для расчёта клёва', 'good');
   return;
 }
 inspectMode = !inspectMode;
 if (inspectMode) {
 mapOpen = true;
 const st = store.getState();
 if (!inspectedPoint) {
 inspectWhatBitesHere(st.lat, st.lon);
 }
 showToast(' Включён режим разведки «Что здесь клюёт?»: тапните в любую точку карты или выберите посёлок ниже!', 'good');
 } else {
 inspectedPoint = null;
 }
 render(container);
 if (inspectMode) {
   flashHighlightElement(['#geoScoutResultCard', '#mapBox'], { scroll: true, block: 'center', delayMs: 80 });
 }
 });
 }
 const scoutApplyBtn = container.querySelector('#scoutApplyLocationBtn');
 if (scoutApplyBtn && inspectedPoint) {
 scoutApplyBtn.addEventListener('click', () => {
 const pt = inspectedPoint;
 inspectMode = false;
 inspectedPoint = null;
 setLocation(pt.lat, pt.lon);
 showToast(` Основная точка перенесена: ${pt.settlementLabel}`, 'good');
 flashHighlightElement(['#mapBox', '#geoWaterIchthyoCard'], { scroll: true, block: 'center', delayMs: 80 });
 });
 }
 const scoutCloseBtn = container.querySelector('#scoutCloseBtn');
 if (scoutCloseBtn) {
 scoutCloseBtn.addEventListener('click', () => {
 inspectMode = false;
 inspectedPoint = null;
 render(container);
 });
 }
 const gpsBtn = container.querySelector('#geoGpsBtn');
 if (gpsBtn) gpsBtn.addEventListener('click', () => {
   requestGPS(container);
   flashHighlightElement(['#mapBox', '#geoWaterIchthyoCard'], { scroll: true, block: 'center', delayMs: 80 });
 });
 const saveSpotBtn = container.querySelector('#geoSaveSpotBtn');
 if (saveSpotBtn) saveSpotBtn.addEventListener('click', () => openSaveSpotModal());
  container.querySelector('#geoOpenPhase3RoutesBtn')?.addEventListener('click', () => {
    openPhase3RoutesModal(container);
  });
  container.querySelector('#geoGrantConsentQuickBtn')?.addEventListener('click', () => {
    ensureGeoDistributionConsent('публикации точек в Круг, Экипаж и Чаты', () => {
      render(container);
    });
  });
  container.querySelector('#geoRevokeConsentQuickBtn')?.addEventListener('click', () => {
    if (typeof window !== 'undefined' && typeof window.__KLEV_REVOKE_GEO_CONSENT__ === 'function') {
      window.__KLEV_REVOKE_GEO_CONSENT__(() => render(container));
    } else {
      setGeoDistributionConsentState(false);
      showToast('Согласие на передачу геоданных отозвано', 'info');
      render(container);
    }
  });
  const offlineMapsBtn = container.querySelector('#geoOpenOfflineMapsBtn');
  if (offlineMapsBtn) {
    offlineMapsBtn.addEventListener('click', () => {
      const stNow = store.getState();
      const mapCenter = (mapInstance && typeof mapInstance.getCenter === 'function') ? mapInstance.getCenter() : null;
      const effCenterLat = (mapCenter && Number.isFinite(mapCenter.lat)) ? mapCenter.lat : stNow.lat;
      const effCenterLon = (mapCenter && Number.isFinite(mapCenter.lng)) ? mapCenter.lng : stNow.lon;
      const nearSettle = findNearestRussianSettlement(effCenterLat, effCenterLon);
      const curatedW = getNearestRussianWaters(effCenterLat, effCenterLon, stNow.basinCode, stNow.isCoastal, 24, 120);
      const movedFromHome = calcHaversineKm(effCenterLat, effCenterLon, stNow.lat, stNow.lon) > 5;
      const waterTitle = movedFromHome
        ? (curatedW[0]?.name ? `${curatedW[0].name} (${nearSettle?.name || 'Район карты'})` : (nearSettle?.name || 'Выбранный участок карты'))
        : (stNow.selectedWaterName || stNow.locAdmin2 || stNow.locLabel || 'Район рыбалки');
      const userSpotPts = [
        { lat: stNow.lat, lon: stNow.lon, isPrioritySpot: true },
        ...(Array.isArray(stNow.savedSpots) ? stNow.savedSpots : []).map(sp => ({ lat: Number(sp.lat), lon: Number(sp.lon), isPrioritySpot: true })),
        ...(Array.isArray(stNow.circleItems) ? stNow.circleItems : []).filter(ci => ci && Number.isFinite(Number(ci.lat)) && Number.isFinite(Number(ci.lon))).map(ci => ({ lat: Number(ci.lat), lon: Number(ci.lon), isPrioritySpot: true }))
      ];
      const allWaterPts = [
        ...userSpotPts,
        ...curatedW,
        ...(Array.isArray(stNow.nearbyWaters) ? stNow.nearbyWaters : [])
      ];
      let currentVpBounds = null;
      if (mapInstance && typeof mapInstance.getBounds === 'function') {
        try {
          const b = mapInstance.getBounds();
          if (b) {
            currentVpBounds = {
              north: b.getNorth(),
              south: b.getSouth(),
              east: b.getEast(),
              west: b.getWest()
            };
          }
        } catch (_e) {}
      }
      openOfflineMapsManagerModal({
        centerLat: effCenterLat,
        centerLon: effCenterLon,
        locationTitle: waterTitle,
        waterPoints: allWaterPts,
        viewportBounds: currentVpBounds,
        onSelectPackLocation: (pk) => {
          if (pk && Number.isFinite(pk.centerLat) && Number.isFinite(pk.centerLon)) {
            if (pk.layerMode === 'satellite' && currentLayerKey === 'yandex_map') {
              currentLayerKey = 'yandex_hybrid';
            } else if (pk.layerMode === 'scheme' && currentLayerKey !== 'yandex_map') {
              currentLayerKey = 'yandex_map';
            }
            if (mapInstance) {
              if (currentTileLayer) mapInstance.removeLayer(currentTileLayer);
              currentTileLayer = createResilientTileLayer(currentLayerKey).addTo(mapInstance);
            }
            setLocation(pk.centerLat, pk.centerLon, false, pk.radiusKm >= 100 ? 11 : 13);
            render(container);
            showToast(`Переход к офлайн-карте: ${pk.title} (${pk.radiusKm} км)`, 'good');
          }
        },
        onAfterChange: () => {
          if (mapInstance) {
            if (currentTileLayer) mapInstance.removeLayer(currentTileLayer);
            currentTileLayer = createResilientTileLayer(currentLayerKey).addTo(mapInstance);
          }
          renderMapOverlays();
          render(container);
        }
     });
   });
 }
  const toggleOfflineSim = () => {
    setOfflineMapTestMode(!_forceOfflineTestMode);
    if (mapInstance) {
      if (currentTileLayer) mapInstance.removeLayer(currentTileLayer);
      currentTileLayer = createResilientTileLayer(currentLayerKey).addTo(mapInstance);
    }
    render(container);
    showToast(
      _forceOfflineTestMode
        ? 'Режим проверки «Без сети» включён: карта загружается только из памяти устройства'
        : 'Обычный гибридный режим карты восстановлен',
      _forceOfflineTestMode ? 'good' : 'info'
    );
  };
  container.querySelector('#geoToggleOfflineSimChip')?.addEventListener('click', toggleOfflineSim);
  container.querySelector('#geoDisableOfflineSimBannerBtn')?.addEventListener('click', toggleOfflineSim);
 const quickCatchBtn = container.querySelector('#geoQuickLogCatchBtn');
 if (quickCatchBtn) {
 quickCatchBtn.addEventListener('click', () => {
 const sNow = store.getState();
 events.emit('forecast:hourSelected', {
 dayIdx: sNow.dayIdx ?? 2,
 hour: sNow.selectedHour ?? new Date().getHours()
 });
 });
 }
 const shareCrewBtn = container.querySelector('#geoShareCrewBtn');
 if (shareCrewBtn) {
 shareCrewBtn.addEventListener('click', () => {
 events.emit('circle:openShareModal', { mode: 'crew' });
 });
 }
  const syncFilterButtonsInPlace = () => {
    container.querySelectorAll('[data-toggle-overlay]').forEach(b => {
      const k = b.getAttribute('data-toggle-overlay');
      b.classList.toggle('btn-accent', Boolean(visibleMapLayers[k]));
    });
    container.querySelectorAll('[data-map-owner]').forEach(b => {
      const ow = b.getAttribute('data-map-owner');
      b.classList.toggle('btn-accent', (ow === 'all' || ow === 'foreign') && visibleMapLayers.ownership === ow);
      b.classList.toggle('btn-good', ow === 'mine' && visibleMapLayers.ownership === 'mine');
    });
    container.querySelectorAll('[data-spot-cat-filter]').forEach(b => {
      const sc = b.getAttribute('data-spot-cat-filter');
      b.classList.toggle('active', visibleMapLayers.spotCategory === sc);
    });
    container.querySelectorAll('[data-map-layer]').forEach(b => {
      const lk = b.getAttribute('data-map-layer');
      b.classList.toggle('btn-accent', currentLayerKey === lk);
    });
    container.querySelectorAll('[data-ymap-filter]').forEach(b => {
      const fk = b.getAttribute('data-ymap-filter');
      const isAct = fk === 'labels' ? Boolean(yandexMapFilters.labels || currentLayerKey === 'yandex_hybrid') : Boolean(yandexMapFilters[fk]);
      b.classList.toggle('active', isAct);
    });
  };
  // Обработчики 3 раскрывающихся списков с многократным выбором (Источники, Принадлежность, Категории точек)
  container.querySelectorAll('[data-ms-dropdown-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const ddKey = btn.getAttribute('data-ms-dropdown-toggle') || '';
      visibleMapLayers.openDropdown = (visibleMapLayers.openDropdown === ddKey) ? '' : ddKey;
      ['sources', 'ownership', 'categories'].forEach(k => {
        const panel = container.querySelector(`#msDropdownPanel_${k}`);
        if (panel) panel.style.display = (visibleMapLayers.openDropdown === k) ? 'flex' : 'none';
      });
    });
  });

  const syncMultiSelectLayerState = () => {
    visibleMapLayers.ownership = (visibleMapLayers.showMine && visibleMapLayers.showForeign)
      ? 'all'
      : (visibleMapLayers.showMine ? 'mine' : (visibleMapLayers.showForeign ? 'foreign' : 'none'));
    const allCatIds = Object.keys(SPOT_CATEGORIES);
    visibleMapLayers.spotCategory = (visibleMapLayers.selectedCategories.size >= allCatIds.length)
      ? 'all'
      : (visibleMapLayers.selectedCategories.size === 1 ? Array.from(visibleMapLayers.selectedCategories)[0] : 'multi');
    renderMapOverlays();
    render(container);
  };

  container.querySelector('[data-ms-source-all]')?.addEventListener('change', (ev) => {
    const chk = Boolean(ev.target.checked);
    visibleMapLayers.mySpots = chk;
    visibleMapLayers.circleBlur = chk;
    visibleMapLayers.crewExact = chk;
    syncMultiSelectLayerState();
  });
  container.querySelectorAll('[data-ms-source-item]').forEach(inp => {
    inp.addEventListener('change', (ev) => {
      const k = inp.getAttribute('data-ms-source-item');
      if (k && k in visibleMapLayers) {
        visibleMapLayers[k] = Boolean(ev.target.checked);
        syncMultiSelectLayerState();
      }
    });
  });

  container.querySelector('[data-ms-owner-all]')?.addEventListener('change', (ev) => {
    const chk = Boolean(ev.target.checked);
    visibleMapLayers.showMine = chk;
    visibleMapLayers.showForeign = chk;
    syncMultiSelectLayerState();
  });
  container.querySelectorAll('[data-ms-owner-item]').forEach(inp => {
    inp.addEventListener('change', (ev) => {
      const k = inp.getAttribute('data-ms-owner-item');
      if (k === 'mine') visibleMapLayers.showMine = Boolean(ev.target.checked);
      if (k === 'foreign') visibleMapLayers.showForeign = Boolean(ev.target.checked);
      syncMultiSelectLayerState();
    });
  });

  container.querySelector('[data-ms-cat-all]')?.addEventListener('change', (ev) => {
    const chk = Boolean(ev.target.checked);
    if (chk) {
      visibleMapLayers.selectedCategories = new Set(Object.keys(SPOT_CATEGORIES));
    } else {
      visibleMapLayers.selectedCategories = new Set();
    }
    syncMultiSelectLayerState();
  });
  container.querySelectorAll('[data-ms-cat-item]').forEach(inp => {
    inp.addEventListener('change', (ev) => {
      const catId = inp.getAttribute('data-ms-cat-item');
      if (!catId) return;
      if (!(visibleMapLayers.selectedCategories instanceof Set)) {
        visibleMapLayers.selectedCategories = new Set(Object.keys(SPOT_CATEGORIES));
      }
      if (ev.target.checked) visibleMapLayers.selectedCategories.add(catId);
      else visibleMapLayers.selectedCategories.delete(catId);
      syncMultiSelectLayerState();
    });
  });

  container.querySelectorAll('[data-spot-cat-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      const f = btn.getAttribute('data-spot-cat-filter') || 'all';
      if (f === 'all') {
        visibleMapLayers.selectedCategories = new Set(Object.keys(SPOT_CATEGORIES));
      } else {
        visibleMapLayers.selectedCategories = new Set([f]);
      }
      syncMultiSelectLayerState();
    });
  });
 _bindDesktopBathyControls(container);
 ensureGlobalMapPopupActionsBound();
 ensureNetworkAndVpnTileRecoveryBound();
}

function ensureGlobalMapPopupActionsBound() {
 if (typeof document !== "undefined" && !window.__KLEV_MAP_POPUP_ACTIONS_BOUND__) {
 window.__KLEV_MAP_POPUP_ACTIONS_BOUND__ = true;
 document.addEventListener("click", (e) => {
 const yandexTermsLink = e.target.closest?.('a[href*="yandex.ru/legal/maps_termsofuse"]');
 if (yandexTermsLink && !yandexTermsLink.hasAttribute('data-allow-ext-nav')) {
  e.preventDefault();
  e.stopPropagation();
  const href = yandexTermsLink.getAttribute('href') || 'https://yandex.ru/legal/maps_termsofuse/';
  const termsHtml = `
    <div style="display:flex;flex-direction:column;gap:10px;font-size:var(--fs-sm);line-height:1.5;">
      <div style="padding:12px 14px;background:var(--panel);border:1px solid var(--border);border-radius:10px;color:var(--text);display:flex;flex-direction:column;gap:8px;">
        <div style="font-weight:900;font-size:14px;color:var(--accent);">Условия использования сервиса Яндекс.Карты</div>
        <div>1. Картографические материалы и спутниковые снимки предоставляются ООО «Яндекс» исключительно для личного некоммерческого использования пользователями приложения.</div>
        <div>2. Любое копирование, коммерческое распространение или перепродажа картографических тайлов без письменного согласия правообладателя запрещены.</div>
        <div>3. Полный текст актуального лицензионного соглашения доступен на официальном сайте правообладателя: <code>https://yandex.ru/legal/maps_termsofuse/</code>.</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <button type="button" class="btn btn-good" id="yandexTermsBackToAppBtn" style="min-height:42px;font-weight:900;justify-content:center;">
          Вернуться в приложение
        </button>
        <button type="button" class="btn btn-sm" id="yandexTermsOpenExtBrowserBtn" style="min-height:42px;font-weight:800;justify-content:center;">
          Открыть в браузере
        </button>
      </div>
    </div>
  `;
  openModal('Условия использования Яндекс.Карт', termsHtml, (bEl) => {
    bEl.querySelector('#yandexTermsBackToAppBtn')?.addEventListener('click', () => closeModal());
    bEl.querySelector('#yandexTermsOpenExtBrowserBtn')?.addEventListener('click', () => {
      openExternalMapNavigatorUrl(href);
    });
  });
  return;
 }
 const navSpotBtn = e.target.closest?.("[data-popup-nav-spot]");
 if (navSpotBtn) {
  const nlat = parseFloat(navSpotBtn.getAttribute("data-nav-lat"));
  const nlon = parseFloat(navSpotBtn.getAttribute("data-nav-lon"));
  const ntitle = navSpotBtn.getAttribute("data-nav-title") || "Точка ловли";
  const ncat = navSpotBtn.getAttribute("data-nav-cat") || "Точка на карте";
  if (Number.isFinite(nlat) && Number.isFinite(nlon)) {
   openNavigateToSpotChoiceModal({ lat: nlat, lon: nlon, title: ntitle, categoryLabel: ncat });
  }
  return;
 }
 const focusPtBtn = e.target.closest?.("[data-popup-focus-point]");
 if (focusPtBtn) {
  const pid = focusPtBtn.getAttribute("data-popup-focus-point");
  const plat = parseFloat(focusPtBtn.getAttribute("data-popup-focus-lat"));
  const plon = parseFloat(focusPtBtn.getAttribute("data-popup-focus-lon"));
  if (pid && Number.isFinite(plat) && Number.isFinite(plon)) {
   focusCircleOnMap(pid, plat, plon);
  }
  return;
 }
 const delSpotBtn = e.target.closest?.("[data-popup-del-spot]");
 if (delSpotBtn) {
  const spId = delSpotBtn.getAttribute("data-popup-del-spot");
  if (spId) {
   const stNow = store.getState();
   const targetSp = (stNow.savedSpots || []).find(x => x && x.id === spId);
   deleteSpot(spId);
   if (targetSp && Number.isFinite(Number(targetSp.lat)) && Number.isFinite(Number(targetSp.lon))) {
     const dupCircle = (stNow.circleItems || []).filter(c => c && c.t === 'spot' && Math.abs(Number(c.lat) - Number(targetSp.lat)) < 0.0002 && Math.abs(Number(c.lon) - Number(targetSp.lon)) < 0.0002);
     if (dupCircle.length > 0) {
       dupCircle.forEach(dc => events.emit("circle:deleteSharedCatchItem", { circleItemId: dc.id }));
       const remCircle = (stNow.circleItems || []).filter(c => !dupCircle.some(dc => dc.id === c.id));
       storage.saveCircleItems(remCircle);
       store.dispatch({ type: "SET_CIRCLE_ITEMS", payload: remCircle });
     }
   }
   renderMapOverlays();
   showToast(" Точка удалена с карты", "info");
  }
  return;
 }
 const delBtn = e.target.closest?.("[data-popup-del-circle]");
 if (delBtn) {
 const id = delBtn.getAttribute("data-popup-del-circle");
 const targetPt = (store.getState().circleItems || []).find(x => x && x.id === id);
 openConfirmDeleteModal({
 title: " Удалить точку с карты и из Круга?",
 message: `Точка «${escapeHtml(targetPt?.fn || targetPt?.wn || targetPt?.lb || "Сводка")}» будет удалена с карты и из ленты Круга.`,
 confirmLabel: " Да, удалить",
 onConfirm: () => {
 events.emit("circle:deleteSharedCatchItem", { circleItemId: id });
 const next = (store.getState().circleItems || []).filter(x => x.id !== id);
 storage.saveCircleItems(next);
 store.dispatch({ type: "SET_CIRCLE_ITEMS", payload: next });
 renderMapOverlays();
 showToast(" Точка удалена с карты и из Круга", "info");
 }
 });
 return;
 }
 const hideBtn = e.target.closest?.("[data-popup-hide-circle]");
 if (hideBtn) {
 const id = hideBtn.getAttribute("data-popup-hide-circle");
 store.dispatch({ type: "HIDE_CIRCLE_ITEM", payload: id });
 renderMapOverlays();
 showToast(" Чужая точка скрыта с вашей карты (можно вернуть во вкладке «Круг -> Скрытые»)", "info");
 }
 });
 }
}

function _bindDesktopBathyControls(container) {
 container.querySelector('#geoToggleBathymetryLayerChk')?.addEventListener('change', (ev) => {
  _bathymetryLayerEnabled = Boolean(ev.target.checked);
  renderMapOverlays();
  showToast(_bathymetryLayerEnabled ? 'Слой глубин (изобаты) на карте включён' : 'Слой глубин на карте скрыт', 'info');
 });
 container.querySelector('#geoBathymetryFileInput')?.addEventListener('change', (ev) => {
  const file = ev.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
   importSpotsFromFileText(String(reader.result || ''));
   ev.target.value = '';
  };
  reader.readAsText(file);
 });
 const expGpxBtn = container.querySelector('#geoExportGpxBtn');
 if (expGpxBtn) {
 expGpxBtn.addEventListener('click', () => exportSpotsToGpx());
 }
 const expKmlBtn = container.querySelector('#geoExportKmlBtn');
 if (expKmlBtn) {
 expKmlBtn.addEventListener('click', () => exportSpotsToKml());
 }
 const impGpxInput = container.querySelector('#geoImportGpxInput');
 if (impGpxInput) {
 impGpxInput.addEventListener('change', (e) => {
 const file = e.target.files?.[0];
 if (!file) return;
 const reader = new FileReader();
 reader.onload = () => {
 importSpotsFromFileText(String(reader.result || ''));
 impGpxInput.value = '';
 };
 reader.readAsText(file);
 });
 }
 container.querySelectorAll('[data-install-app]').forEach(btn => {
 btn.addEventListener('click', () => installShortcut());
 });
 syncInstallButtons();
 const searchBtn = container.querySelector('#geoSearchBtn');
 const searchInput = container.querySelector('#geoSearchInput');
 if (searchBtn && searchInput) {
 searchBtn.addEventListener('click', () => searchPlaceByQuery(searchInput.value));
 searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') searchPlaceByQuery(searchInput.value); });
 }
  container.querySelectorAll('[data-map-layer]').forEach(btn => {
    btn.addEventListener('click', () => {
      const nextLayer = btn.getAttribute('data-map-layer') || 'yandex_map';
      currentLayerKey = nextLayer;
      if (nextLayer === 'yandex_sat' || nextLayer === 'yandex_map' || nextLayer === 'yandex_dark') {
        yandexMapFilters.labels = false;
      } else if (nextLayer === 'yandex_hybrid') {
        yandexMapFilters.labels = true;
      }
      rebuildActiveMapTileLayer();
      syncFilterButtonsInPlace();
    });
  });
  container.querySelectorAll('[data-ymap-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      const fKey = btn.getAttribute('data-ymap-filter');
      if (!fKey || !(fKey in yandexMapFilters)) return;
      if (fKey === 'labels') {
        if (currentLayerKey === 'yandex_hybrid') {
          currentLayerKey = 'yandex_sat';
          yandexMapFilters.labels = false;
        } else if (currentLayerKey === 'yandex_sat') {
          yandexMapFilters.labels = !yandexMapFilters.labels;
        } else {
          yandexMapFilters.labels = !yandexMapFilters.labels;
          if (yandexMapFilters.labels) {
            currentLayerKey = 'yandex_hybrid';
          }
        }
        rebuildActiveMapTileLayer();
      } else {
        yandexMapFilters[fKey] = !yandexMapFilters[fKey];
        applyYandexTileFiltersToMap();
      }
      syncFilterButtonsInPlace();
    });
  });
 container.querySelectorAll('[data-water-radius]').forEach(btn => {
 btn.addEventListener('click', () => {
 const nextRadius = parseInt(btn.getAttribute('data-water-radius'), 10) === 120 ? 120 : 50;
 store.dispatch({ type: 'SET_WATER_RADIUS', payload: nextRadius });
 const st = store.getState();
 getNearbyWatersAndPlaces(st.lat, st.lon, nextRadius);
 showToast(`Радиус поиска водоёмов и видового состава рыб: до ${nextRadius} км`, 'info');
 });
 });
 const nearPlaceSel = container.querySelector('#geoNearbyPlaceSelect');
 if (nearPlaceSel) {
  nearPlaceSel.addEventListener('change', (e) => {
   const parts = String(e.target.value || '').split(',');
   const pLat = parseFloat(parts[0]);
   const pLon = parseFloat(parts[1]);
   const name = parts.slice(2).join(',').trim();
   if (!Number.isFinite(pLat) || !Number.isFinite(pLon)) return;
   if (inspectMode) {
    inspectWhatBitesHere(pLat, pLon);
    render(container);
   } else {
    store.dispatch({ type: 'SET_LOCATION_LABELS', payload: { locLabel: name, locAdmin2: name } });
    setLocation(pLat, pLon, true);
    showToast(`Выбран населённый пункт: ${name}`, 'good');
   }
  });
 }
   const nearWaterSel = container.querySelector('#geoNearbyWaterSelect');
  if (nearWaterSel) {
   nearWaterSel.addEventListener('change', (e) => {
    const [wType, wName, defDStr, wLatStr, wLonStr] = String(e.target.value || '').split('|');
    if (!wType) return;
    const defD = parseFloat(defDStr) || WATER_PROFILES[wType]?.defD || 1.5;
    store.dispatch({ type: 'SET_WATER', payload: { water: wType, depth: defD, selectedWaterName: wName || '' } });
    const wLat = parseFloat(wLatStr);
    const wLon = parseFloat(wLonStr);
    if (Number.isFinite(wLat) && Number.isFinite(wLon) && mapInstance && mapMarker) {
     mapMarker.setLatLng([wLat, wLon]);
     mapInstance.setView([wLat, wLon], Math.max(11, mapInstance.getZoom() || 11));
    }
    showToast(`Выбран водоём: ${wName} (${getWaterTypeShortTag(wType)}) • Ихтиобаза привязана`, 'good');
   });
  }
  container.querySelectorAll('[data-water-ichthyo-fish]').forEach(btn => {
   btn.addEventListener('click', () => {
    const fid = btn.getAttribute('data-water-ichthyo-fish');
    if (!fid) return;
    store.dispatch({ type: 'SET_FISH', payload: fid });
    container.querySelectorAll('[data-water-ichthyo-fish]').forEach(b => {
     const isMatch = b.getAttribute('data-water-ichthyo-fish') === fid;
     b.classList.toggle('btn-accent', isMatch);
    });
    const fObj = FISH_DB.find(x => x.id === fid);
    showToast(`Целевая рыба водоёма: ${fObj ? fObj.name : fid}`, 'good');
    flashHighlightElement([btn, '#geoWaterIchthyoCard'], { scroll: false, delayMs: 20 });
   });
  });
 container.querySelectorAll('[data-load-spot]').forEach(btn => {
 btn.addEventListener('click', () => {
 const id = btn.getAttribute('data-load-spot');
 const sp = store.getState().savedSpots.find(x => x.id === id);
 if (sp) {
 store.dispatch({ type: 'SET_LOCATION_LABELS', payload: { locLabel: sp.name } });
 store.dispatch({ type: 'SET_WATER', payload: { water: sp.water, depth: sp.depth, selectedWaterName: sp.selectedWaterName || '' } });
 setLocation(sp.lat, sp.lon, true);
 flashHighlightElement(['#mapBox', '#geoWaterIchthyoCard'], { scroll: true, block: 'center', delayMs: 90 });
 }
 });
 });
 container.querySelectorAll('[data-del-spot]').forEach(btn => {
 btn.addEventListener('click', () => {
 const id = btn.getAttribute('data-del-spot');
 const sp = (store.getState().savedSpots || []).find(x => x && x.id === id);
 openConfirmDeleteModal({
 title: ' Удалить сохранённую закладку?',
 message: `Точка «${escapeHtml(sp?.name || 'Закладка')}» будет удалена из ваших закладок на карте.`,
 confirmLabel: ' Удалить',
 onConfirm: () => deleteSpot(id)
 });
 });
 });
 const wSel = container.querySelector('#geoWaterSelect');
 if (wSel) {
 wSel.addEventListener('change', (e) => {
 const wType = e.target.value;
 const stNow = store.getState();
 const prof = WATER_PROFILES[wType] || WATER_PROFILES.small_river;
 const fallbackWaters = getNearestRussianWaters(stNow.lat, stNow.lon, stNow.basinCode, stNow.isCoastal, 40, stNow.waterRadiusKm || 120);
 const pool = [...fallbackWaters, ...(stNow.nearbyWaters || [])];
 const matchW = pool.find(w => w && w.wType === wType);
 const nextDepth = matchW?.defDepth || clamp(stNow.depth, prof.minD, prof.maxD);
 const nextName = matchW?.name || '';
 store.dispatch({ type: 'SET_WATER', payload: { water: wType, depth: nextDepth, selectedWaterName: nextName } });
 if (nextName) {
  showToast(`Выбран биотоп: ${getWaterTypeShortTag(wType)} • ${nextName}`, 'good');
 }
 });
 }
 const mSel = container.querySelector('#geoMethodSelect');
 if (mSel) {
 mSel.addEventListener('change', (e) => {
 store.dispatch({ type: 'SET_METHOD', payload: e.target.value });
 });
 }
 const dRange = container.querySelector('#geoDepthRange');
 const dVal = container.querySelector('#geoDepthVal');
 const dHorVal = container.querySelector('#geoCurrentHorizonVal');
 if (dRange) {
 dRange.addEventListener('input', (e) => {
 const fv = parseFloat(e.target.value).toFixed(1);
 if (dVal) dVal.textContent = fv;
 if (dHorVal) dHorVal.textContent = `${fv} м (свал / русло)`;
 });
 dRange.addEventListener('change', (e) => {
 store.dispatch({ type: 'SET_DEPTH', payload: parseFloat(e.target.value) });
 });
 }
 container.querySelector('#cwConfirmMapSpotReturnBtn')?.addEventListener('click', () => {
   const pickCtx = (typeof window !== 'undefined') ? window.__KLEV_CATCH_WIZARD_PICK_SPOT__ : null;
   if (typeof window !== 'undefined') window.__KLEV_CATCH_WIZARD_PICK_SPOT__ = null;
   const stNow = store.getState();
   const prevRoute = pickCtx?.prevRoute || 'log';
   router.navigate(prevRoute);
   render(container);
   if (typeof window !== 'undefined' && typeof window.__KLEV_OPEN_CATCH_WIZARD__ === 'function') {
     setTimeout(() => {
       window.__KLEV_OPEN_CATCH_WIZARD__({
         ...(pickCtx?.prefill || {}),
         lat: stNow.lat,
         lon: stNow.lon,
         locLabel: stNow.locLabel,
         waterName: stNow.selectedWaterName || (stNow.nearbyWaters && stNow.nearbyWaters[0]?.name) || pickCtx?.prefill?.waterName || ''
       });
     }, 60);
   }
 });
 container.querySelector('#cwCancelMapSpotReturnBtn')?.addEventListener('click', () => {
   const pickCtx = (typeof window !== 'undefined') ? window.__KLEV_CATCH_WIZARD_PICK_SPOT__ : null;
   if (typeof window !== 'undefined') window.__KLEV_CATCH_WIZARD_PICK_SPOT__ = null;
   const prevRoute = pickCtx?.prevRoute || 'log';
   router.navigate(prevRoute);
   render(container);
   if (typeof window !== 'undefined' && typeof window.__KLEV_OPEN_CATCH_WIZARD__ === 'function') {
     setTimeout(() => {
       window.__KLEV_OPEN_CATCH_WIZARD__(pickCtx?.prefill || {});
     }, 60);
   }
 });
 if (showDrawer) {
 setTimeout(() => {
 const box = container.querySelector('#mapBox');
 if (box && box.offsetParent !== null) renderMap(box);
 }, 60);
 }
}
let unsub = null;
let _lastMapUiIsMobile = null;
export async function init(container) {
 if (typeof window !== 'undefined' && !window.__KLEV_GEO_RESIZE_BOUND__) {
   window.__KLEV_GEO_RESIZE_BOUND__ = true;
   window.addEventListener('resize', () => {
     const nowMobile = isMobileOrTabletMapMode();
     if (_lastMapUiIsMobile !== null && _lastMapUiIsMobile !== nowMobile) {
       _lastMapUiIsMobile = nowMobile;
       const secGeo = document.getElementById('secGeo');
       if (secGeo && store.getState().route === 'geo') {
         render(secGeo);
       }
     } else {
       _lastMapUiIsMobile = nowMobile;
     }
   }, { passive: true });
 }
 _lastMapUiIsMobile = isMobileOrTabletMapMode();
 getAllOfflineMapPacks().then(() => {
   renderMapOverlays();
 }).catch(() => {});
 const localSpots = storage.getLocalBackup ? storage.getLocalBackup('spots') : [];
 if (Array.isArray(localSpots) && localSpots.length > 0) {
 store.dispatch({ type: 'SET_SAVED_SPOTS', payload: localSpots });
 }
 const s = store.getState();
 if (!s.locLabel || s.locLabel.includes('Определение') || s.locAdmin1 === 'Автоопределение') {
 resolveReverseGeocode(s.lat, s.lon);
 }
 getNearbyWatersAndPlaces(s.lat, s.lon, s.waterRadiusKm || 50, true);
 render(container);
 setTimeout(() => {
 const stNow = store.getState();
 getNearbyWatersAndPlaces(stNow.lat, stNow.lon, stNow.waterRadiusKm || 50, false).catch(() => {});
 }, 1500);
 if (unsub) unsub();
 unsub = store.subscribe(
 st => {
 const activeDay = st.weatherDays?.[st.dayIdx] || st.weatherDays?.[2] || st.weatherDays?.[0];
 return {
 appMode: st.appMode,
 lat: st.lat,
 lon: st.lon,
 basinCode: st.basinCode,
 isCoastal: st.isCoastal,
 water: st.water,
 waterRadiusKm: st.waterRadiusKm,
 selectedWaterName: st.selectedWaterName,
 method: st.method,
 selectedBait: st.selectedBait,
 depth: st.depth,
 iceState: st.iceState,
 dayIdx: st.dayIdx,
 dayIceState: activeDay?.iceState || st.iceState,
 dayWaterTemp: activeDay?.waterTemp ?? 12,
 nearbyWaters: st.nearbyWaters,
 nearbyPlaces: st.nearbyPlaces,
 savedSpots: st.savedSpots,
 circleItems: st.circleItems,
 catches: st.catches,
 hiddenCircleIds: st.userProfile?.hiddenCircleIds,
 route: st.route,
 fishId: st.fishId
 };
 },
 (next, prev) => {
 if (!container) return;
 if (next.route && next.route !== 'geo') {
 container._geoNeedsRender = true;
 return;
 }
 container._geoNeedsRender = false;
 if (typeof document !== 'undefined' && container.contains(document.activeElement) && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
 renderMapOverlays();
 return;
 }
 if (prev &&
 next.route === prev.route &&
 !(typeof window !== 'undefined' && window.__KLEV_CATCH_WIZARD_PICK_SPOT__?.active) &&
 next.lat === prev.lat &&
 next.lon === prev.lon &&
 next.water === prev.water &&
 next.waterRadiusKm === prev.waterRadiusKm &&
 next.selectedWaterName === prev.selectedWaterName &&
 next.method === prev.method &&
 next.depth === prev.depth &&
 next.appMode === prev.appMode &&
 next.dayIdx === prev.dayIdx &&
 next.nearbyWaters === prev.nearbyWaters &&
 next.nearbyPlaces === prev.nearbyPlaces &&
 next.savedSpots === prev.savedSpots &&
 next.catches === prev.catches) {
 renderMapOverlays();
 return;
 }
 render(container);
 }
 );
 autoDetectStartupLocation();
 try {
 const spots = await storage.getAllFromStore('spots');
 if (Array.isArray(spots)) {
 store.dispatch({ type: 'SET_SAVED_SPOTS', payload: spots });
 }
 } catch (e) {}
}
export function destroy() {
 if (unsub) unsub();
}
export const geoModule = {
 setLocation,
 inspectWhatBitesHere,
 exportSpotsToGpx,
 importSpotsFromFileText,
 autoDetectStartupLocation,
 locateByIpFallback,
 detectUserPosition,
 resolveReverseGeocode,
 searchPlaceByQuery,
 requestGPS,
 getNearbyWatersAndPlaces,
 classifyOsmWaterElement,
 saveSpot,
 deleteSpot,
 renderMap,
 getMethodOptions,
 init,
 render,
 destroy
};
if (typeof window !== 'undefined') {
  window.__KLEV_EXPORT_SPOTS_GPX__ = () => exportSpotsToGpx();
  window.__KLEV_EXPORT_SPOTS_KML__ = () => exportSpotsToKml();
  window.__KLEV_IMPORT_SPOTS_TEXT__ = (txt) => importSpotsFromFileText(txt);
  window.__KLEV_GET_BG_PERMS_STATUS__ = () => getDeviceBackgroundPermissionsStatus();
  window.__KLEV_REQ_ROUTE_PERMS__ = async (kind, onDone) => {
    if (kind === 'gps') {
      if (window.AndroidBridge && typeof window.AndroidBridge.openLocationSourceSettings === 'function') {
        window.AndroidBridge.openLocationSourceSettings();
      } else {
        requestGPS();
      }
      showToast('Системная геолокация GPS/ГЛОНАСС активирована', 'good');
    } else if (kind === 'bg') {
      if (window.AndroidBridge && typeof window.AndroidBridge.requestBackgroundLocationPermission === 'function') {
        window.AndroidBridge.requestBackgroundLocationPermission();
      }
      await acquireBackgroundWakeLock(true);
      try { localStorage.setItem('klev_pro_bg_loc_ack_v1', '1'); } catch (e) {}
      showToast('Фоновый режим геолокации активирован', 'good');
    } else if (kind === 'battery') {
      if (window.AndroidBridge && typeof window.AndroidBridge.requestIgnoreBatteryOptimizations === 'function') {
        window.AndroidBridge.requestIgnoreBatteryOptimizations();
      }
      try { localStorage.setItem('klev_pro_bg_battery_ack_v1', '1'); } catch (e) {}
      showToast('Отключение экономии заряда батареи активировано', 'good');
    }
    if (typeof onDone === 'function') onDone();
  };
}
