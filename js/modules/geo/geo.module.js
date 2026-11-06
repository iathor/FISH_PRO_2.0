import { MAP_LAYERS, SPOT_CATEGORIES, getCompatibleMethods } from '../../core/config.js?v=2.5.6-r215';
import { events } from '../../core/events.js?v=2.5.6-r215';
import { storage, safeJsonParse } from '../../core/storage.js?v=2.5.6-r215';
import { router } from '../../core/router.js?v=2.5.6-r215';
import { store } from '../../core/store.js?v=2.5.6-r215';
import { fetchWithTimeout } from '../../core/http.js?v=2.5.6-r215';
import { installShortcut, syncInstallButtons } from '../../core/pwa.js?v=2.5.6-r215';
import { triggerHaptic } from '../../core/telegram.js?v=2.5.6-r215';
import { BASIN_CONFIGS, detectBasinByCoords, isCoastalInBasin, getSpotEcoregion, isSpeciesInGeoRange } from '../../data/basins.js?v=2.5.6-r215';
import { WATER_PROFILES, getAvailableWaterTypes } from '../../data/waters.js?v=2.5.6-r215';
import {
  RUSSIA_CITIES,
  RUSSIA_WATERS,
  findNearestRussianSettlement,
  getNearestRussianSettlements,
  getNearestRussianWaters,
  getWaterTypeShortTag
} from '../../data/russia-waters.js?v=2.5.6-r215';
import { FISH_DB } from '../../data/species.js?v=2.5.6-r215';
import { escapeHtml, createPill, showToast, openModal, closeModal, openConfirmDeleteModal, downloadFileCrossPlatform, flashHighlightElement } from '../../ui/components.js?v=2.5.6-r215';
import { fetchWeather } from '../weather/weather.module.js?v=2.5.6-r215';
import { calcDayBest } from '../forecast/forecast.module.js?v=2.5.6-r215';
import { computeHexPolygonForCircle, getEffectiveCircleRadiusKm, getCircleHexDecayState, canUserAccessCrewItem, getCurrentFisherIdentity, isUserAdmin, isCircleItemMine, isCircleItemHidden, openAddThematicMapPointModal } from '../circle/circle.module.js?v=2.5.6-r215';
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
    for (let pz = targetZ - 1; pz >= minSearchZ; pz--) {
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

      // Функция отрисовки офлайн-оверзума (с наложением контуров рек из Схемы при сильном зуме!)
      const renderOfflineFallbackToTile = async () => {
        try {
          let overzoom = await findParentOfflineTileForOverzoom(storageLayerId, z, x, y, false);
          let schemeOverlayOz = null;
          if (storageLayerId === 'yandex_sat') {
            schemeOverlayOz = await findParentOfflineTileForOverzoom('yandex_map', z, x, y, false);
          }
          if (!overzoom) {
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
              (storageLayerId === 'yandex_sat' && overzoom.scaleFactor >= 2) ? schemeOverlayOz : null
            );
            tile.onload = () => finishTileLoad();
            tile.onerror = () => finishTileLoad();
            tile.setAttribute('data-offline-overzoom', String(overzoom.parentZ));
            tile.src = dataUrl;
            return;
          }
          // Если мы ОНЛАЙН (интернет включён, а сервер спутника вернул 404 на высоком зуме Z14..Z18 в тундре/Чукотке),
          // НИКОГДА не показываем "ВНЕ ЗОНЫ ОФЛАЙН-КАРТЫ"! Вместо этого подгружаем онлайн-родительский спутник + схему!
          if (!isCurrentlyOffline) {
            const synthesizedOnline = await synthesizeOnlineHighZoomFallbackDataUrl(storageLayerId, z, x, y);
            if (synthesizedOnline) {
              tile.onload = () => finishTileLoad();
              tile.onerror = () => finishTileLoad();
              tile.src = synthesizedOnline;
              return;
            }
            // Прямой резерв на онлайн Яндекс Схему (которая существует на Z7..Z18 по всей РФ)
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
        } catch (e) {
          finishTileLoad();
        }
      };

      const exactKey = `${storageLayerId}_${z}_${x}_${y}`;

      // 1. Сверхбыстрая проверка точного тайла из RAM-кэша (только если ключ реально числится в базе офлайн-карт!)
      if (_offlineTileKeysSet.has(exactKey) && _ramTileDataUrlCache.has(exactKey)) {
        const ramHit = _ramTileDataUrlCache.get(exactKey);
        tile.setAttribute('data-offline-hit', '1');
        tile.setAttribute('data-offline-layer', storageLayerId);
        tile.onload = () => finishTileLoad();
        tile.onerror = () => finishTileLoad();
        tile.src = ramHit;
        return tile;
      }

      // 2. Если индекс ключей уже в памяти и точного тайла нет, а интернет включён — грузим напрямую по сети!
      if (_offlineKeysIndexed && !isCurrentlyOffline && !_offlineTileKeysSet.has(exactKey)) {
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
        if (rec && rec.dataUrl) {
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
    keepBuffer: 1
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

    // 2. Получаем чёткий векторный тайл гидрографии/схемы ТОЧНОГО масштаба Z (реки, берега, протоки, острова, дороги на Z12..Z18)
    const exactMapRes = await fetchAndReprojectEPSG3857ToEPSG3395DataUrl(OFFLINE_LAYER_SOURCES.yandex_map, z, x, y, attemptSeed);
    if (!parentSatOz && exactMapRes) {
      return exactMapRes;
    }
    if (!parentSatOz) return null;

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) return exactMapRes;

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

    if (exactMapRes && exactMapRes.dataUrl) {
      const mapImg = await new Promise((res) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = () => res(null);
        im.src = exactMapRes.dataUrl;
      });
      if (mapImg) {
        // Накладываем векторные русла рек, озёра и подписи Z12..Z18 поверх спутниковой подложки,
        // чтобы на максимальном зуме Z18 были идеально чёткие берега и названия!
        ctx.save();
        ctx.globalAlpha = parentSatOz.scaleFactor >= 4 ? 0.52 : 0.36;
        ctx.drawImage(mapImg, 0, 0, 256, 256);
        ctx.restore();
      }
    }

    const dataUrl = canvas.toDataURL('image/jpeg', 0.91);
    canvas.width = 0;
    canvas.height = 0;
    if (dataUrl && dataUrl.length > 220) {
      return { dataUrl, sizeBytes: Math.round(dataUrl.length * 0.74) };
    }
    return exactMapRes;
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
      `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(primaryYandexUrl)}`,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(primaryYandexUrl)}`
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
}) {
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

export async function openOfflineMapsManagerModal({
  centerLat,
  centerLon,
  locationTitle = 'Выбранный водоём',
  waterPoints = [],
  viewportBounds = null,
  onSelectPackLocation = null,
  onAfterChange = null
} = {}) {
  let chosenRadiusKm = 50;
  let chosenLayerMode = 'satellite';
  let smartHydroZ15 = true;
  let customAreaTitle = String(locationTitle || 'Район рыбалки').trim();

  const quotaInfo = await ensurePersistentStorageQuota();
  await getAllOfflineMapPacks();
  _selectedPackIdsForBatchDelete.clear();

  const isAdmin = isUserAdmin(store.getState());
  const modalTitle = isAdmin
    ? '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Офлайн-карты и Инспектор памяти (Админ)'
    : '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Офлайн-карты: Тайга, Тундра, Море';

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
            <div style="display:flex;flex-direction:column;gap:4px;padding:6px;background:rgba(15,23,42,0.85);border:1px solid var(--good);border-radius:8px;align-items:center;text-align:center;">
              <div style="width:100%;height:82px;border-radius:6px;overflow:hidden;background:#0b1120;border:1px solid var(--border);position:relative;">
                <img src="${sr.dataUrl}" alt="Тайл Z${sr.z}" data-verify-sample-img="${sr.key}" style="width:100%;height:100%;object-fit:cover;display:block;">
                <span style="position:absolute;top:3px;left:3px;padding:1px 5px;border-radius:4px;background:rgba(9,15,29,0.88);color:#10b981;font-size:9.5px;font-weight:900;">Z${sr.z} • ${lyrName}</span>
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

            <!-- Живой индикатор загрузки -->
            <div id="offMapDownloadProgressBox" style="display:none;flex-direction:column;gap:8px;padding:10px;background:var(--panel);border:1.5px solid var(--good);border-radius:8px;">
              <div style="display:flex;justify-content:space-between;align-items:center;font-size:11.5px;font-weight:800;gap:6px;">
                <span id="offMapProgressStatusText" style="color:var(--good);">Загрузка и верификация тайлов...</span>
                <span id="offMapProgressPctText" style="font-family:monospace;color:var(--accent);">0%</span>
              </div>
              <div style="width:100%;height:11px;background:rgba(15,23,42,0.85);border-radius:999px;overflow:hidden;border:1px solid var(--border);">
                <div id="offMapProgressBarFill" style="width:0%;height:100%;background:linear-gradient(90deg,#059669,#10b981);transition:width 0.15s ease;"></div>
              </div>
              <div style="display:flex;align-items:center;gap:10px;">
                <div id="offMapLiveTilePreviewWrap" style="width:58px;height:58px;border-radius:7px;overflow:hidden;border:1.5px solid var(--good);background:#0b1120;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--muted);text-align:center;">
                  <img id="offMapLiveTilePreviewImg" alt="" style="width:100%;height:100%;object-fit:cover;display:none;">
                  <span id="offMapLiveTilePreviewPlaceholder">Контроль<br>тайла</span>
                </div>
                <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:3px;">
                  <div id="offMapProgressSubMeta" style="font-size:11px;color:var(--text);font-weight:800;">Скачано новых: 0 • Записано: 0 КБ</div>
                  <div id="offMapProgressSampleMeta" style="font-size:10px;color:var(--good);">Ожидание первого проверенного тайла...</div>
                </div>
              </div>
              <button type="button" class="btn btn-sm" id="offMapCancelDownloadBtn" style="min-height:34px;color:var(--bad);border-color:rgba(239,68,68,0.4);">Остановить (сохранить скачанное)</button>
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
  ownership: "all", // "all" | "mine" | "foreign"
  spotCategory: "all" // "all" | "bite" | "slip" | "camp" | "hazard" | "shop"
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
function applyYandexTileFiltersToMap() {
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
function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}
function calcHaversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
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
  await fetchWeather(rLat, rLon, true);
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

  const exactCityMatch = !isExplicitWaterQuery ? RUSSIA_CITIES.find(c => {
    const cn = c.name.toLowerCase().replace(/ё/g, 'е');
    if (cn.includes('озеро ') || cn.includes('оз.')) return false;
    return cn === qLower || cn === qClean;
  }) : null;

  if (matchedWater && (isExplicitWaterQuery || !exactCityMatch)) {
    const exactCoords = await resolveExactWaterCoordinates(matchedWater, q);
    await setLocation(exactCoords.lat, exactCoords.lon, true, 12);
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
    await setLocation(matchedCity.lat, matchedCity.lon, true, 11);
    store.dispatch({
      type: 'SET_LOCATION_LABELS',
      payload: {
        locCountry: 'Россия',
        locAdmin1: matchedCity.admin1,
        locAdmin2: matchedCity.name,
        locLabel: matchedCity.name
      }
    });
    showToast(`Переход к населённому пункту: ${matchedCity.name}`, 'good');
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
      setLocation(pos.coords.latitude, pos.coords.longitude);
    },
    err => {
      if (err.code !== 1) {
        inlineGpsHint = 'Поиск координат по сотовой сети и Wi-Fi...';
        render(container);
        navigator.geolocation.getCurrentPosition(
          pos2 => {
            inlineGpsHint = '';
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
export async function importSpotsFromFileText(fileText) {
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
function renderMapOverlays() {
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
  if (visibleMapLayers.mySpots && visibleMapLayers.ownership !== 'foreign' && Array.isArray(s.savedSpots)) {
    s.savedSpots.forEach(sp => {
      if (!sp || !Number.isFinite(Number(sp.lat)) || !Number.isFinite(Number(sp.lon))) return;
      const catKey = normalizeSpotCatKey(sp.category || 'bite');
      if (visibleMapLayers.spotCategory !== 'all' && visibleMapLayers.spotCategory !== catKey) return;
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
      if (visibleMapLayers.ownership === 'mine' && !mine) return;
      if (visibleMapLayers.ownership === 'foreign' && mine) return;
      const catKey = normalizeSpotCatKey(item.cat || 'slip');
      if (visibleMapLayers.spotCategory !== 'all' && visibleMapLayers.spotCategory !== catKey) return;
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
    if (curZoom >= 12) {
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
        marker.bindPopup(
          `<div style="font-size:12.5px;line-height:1.45;">` +
          `<b style="color:${catObj.color};">${catObj.icon} ${escapeHtml(catObj.short)}:</b> <span class="klev-popup-title">${escapeHtml(pt.name)}</span><br>` +
          detailLine +
          `<span class="klev-popup-sub" style="font-size:11px;">${pt.isSavedSpot ? 'Личная закладка' : `Общая точка (${escapeHtml(pt.au)})`}</span><br>` +
          `${delOrHideBtn}</div>`
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
    if (visibleMapLayers.ownership === "mine" && !mine) return;
    if (visibleMapLayers.ownership === "foreign" && mine) return;
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
        `${actionBtnHtml}</div>`;
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
export function renderMap(mapBoxEl) {
  if (typeof window !== 'undefined') window.__KLEV_RENDER_MAP__ = renderMap;
  if (!mapBoxEl || typeof L === 'undefined') return;
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
    const yandexCrs = getYandexEPSG3395CRS();
    mapInstance = L.map(mapBoxEl, { ...(yandexCrs ? { crs: yandexCrs } : {}), minZoom: 4, maxZoom: 18 }).setView([targetLat, targetLon], targetZoom);
    mapInstance.attributionControl.setPrefix(false);
    currentTileLayer = createResilientTileLayer(currentLayerKey).addTo(mapInstance);
    applyYandexTileFiltersToMap();
    mapMarker = L.marker([s.lat, s.lon]).addTo(mapInstance);
    mapInstance.on('click', (e) => {
      if (inspectMode) {
        inspectWhatBitesHere(e.latlng.lat, e.latlng.lng);
        const secGeo = document.getElementById('secGeo');
        if (secGeo) render(secGeo);
      } else {
        setLocation(e.latlng.lat, e.latlng.lng);
      }
    });
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
    mapInstance.invalidateSize();
    if (mapMarker) mapMarker.setLatLng([s.lat, s.lon]);
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
export function render(container) {
  if (!container) return;
  const prevScrolls = Array.from(container.querySelectorAll('.chip-scroll-row')).map(el => el.scrollLeft);
  const s = store.getState();
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
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">
          <button type="button" class="btn btn-sm" id="geoGpsBtn" style="flex:1 1 110px;min-height:38px;padding:6px 10px;font-size:12px;font-weight:800;"><svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><circle cx=\"12\" cy=\"12\" r=\"8.5\" stroke=\"currentColor\" stroke-width=\"1.8\"/><circle cx=\"12\" cy=\"12\" r=\"4.5\" stroke=\"#38bdf8\" stroke-width=\"1.6\"/><circle cx=\"12\" cy=\"12\" r=\"1.8\" fill=\"#10b981\"/></svg> <span class="geo-full-only-inline">Мой GPS</span><span class="geo-guest-only-inline">Где я</span></button>
          <button type="button" class="btn btn-sm ${inspectMode ? 'btn-good' : 'btn-accent'}" id="geoInspectModeBtn" style="flex:1.2 1 135px;min-height:38px;padding:6px 10px;font-size:12px;font-weight:800;" title="Показать рыб, которые клюют в выбранной точке водоёма">
            <svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><circle cx=\"11\" cy=\"11\" r=\"6.5\" stroke=\"currentColor\" stroke-width=\"2\"/><path d=\"M16 16l4.5 4.5\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/></svg>
            <span class="geo-full-only-inline">${inspectMode ? 'Разведка ВКЛ' : 'Что здесь клюёт?'}</span>
            <span class="geo-guest-only-inline">Кто здесь клюёт</span>
          </button>
          <button type="button" class="btn btn-sm geo-auth-only-block" id="geoSaveSpotBtn" style="flex:1 1 90px;padding:5px 6px;font-size:11.5px;"><svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M12 2.5l2.9 6 6.6.9-4.8 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5-4.8-4.6 6.6-.9L12 2.5z\" fill=\"#fbbf24\" stroke=\"#f59e0b\" stroke-width=\"1.6\" stroke-linejoin=\"round\"/></svg> В закладки</button>
          <button type="button" class="btn btn-sm btn-good geo-auth-only-block" id="geoQuickLogCatchBtn" style="flex:1 1 110px;padding:5px 6px;font-size:11.5px;font-weight:800;"><svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M4 20C5 11 11 5 20 4\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/><path d=\"M20 4v7c0 1.7-1.3 3-3 3s-3-1.3-3-3\" stroke=\"#38bdf8\" stroke-width=\"1.8\" stroke-linecap=\"round\"/><circle cx=\"14\" cy=\"16\" r=\"2.2\" fill=\"#10b981\"/></svg> + В журнал</button>
          <button type="button" class="btn btn-sm btn-accent geo-auth-only-block" id="geoOpenOfflineMapsBtn" style="flex:1 1 100%;min-height:36px;padding:6px 10px;font-size:12px;font-weight:900;justify-content:center;" title="Скачать карту выбранной локации (50 км или 120 км) для безотказной работы в тайге, тундре и море без сети">
            <svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>
            <span>Офлайн-карты: Тайга • Тундра • Море (50 / 120 км)${getCachedOfflineMapPacksSync().length > 0 ? ` • Скачано: ${getCachedOfflineMapPacksSync().length}` : ''}</span>
          </button>
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
          Режим Яндекс Карты (точная проекция EPSG:3395 • работает без VPN):
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
        <div id="mapBox" role="application" aria-label="Карта выбора водоёма"></div>
        <div class="geo-auth-only-block">
        <!-- Слои приватности и навигации «Клёв ПРО: Круг» (перемещены вниз под карту по запросу) -->
        <div style="margin-top:10px;margin-bottom:8px;padding:10px;background:var(--panel);border:1px solid var(--border);border-radius:var(--r-sm);width:100%;max-width:100%;overflow:hidden;">
          <div style="font-size:10.5px;color:var(--muted);font-weight:800;margin-bottom:5px;text-transform:uppercase;letter-spacing:0.3px;">
            Слои меток на карте (нажмите для вкл/выкл):
          </div>
          <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;width:100%;">
            <button type="button" class="btn btn-sm ${visibleMapLayers.mySpots ? 'btn-accent' : ''}" data-toggle-overlay="mySpots" title="Показать или скрыть ваши личные сохранённые закладки на карте" style="width:100%;min-width:0;padding:4px 4px;font-size:11px;min-height:32px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              <svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><rect x=\"5\" y=\"11\" width=\"14\" height=\"10\" rx=\"2.5\" fill=\"rgba(251,191,36,0.22)\" stroke=\"#fbbf24\" stroke-width=\"1.8\"/><path d=\"M8 11V7a4 4 0 0 1 8 0v4\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\"/></svg> Точки (${thematicCount})
            </button>
            <button type="button" class="btn btn-sm ${visibleMapLayers.circleBlur ? 'btn-accent' : ''}" data-toggle-overlay="circleBlur" title="Показать или скрыть публичные точки сообщества Круг (размытие ±5 км)" style="width:100%;min-width:0;padding:4px 4px;font-size:11px;min-height:32px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              <svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><circle cx=\"9\" cy=\"8\" r=\"3.5\" fill=\"rgba(56,189,248,0.25)\" stroke=\"currentColor\" stroke-width=\"1.8\"/><path d=\"M3 19c0-3.2 2.7-5.5 6-5.5s6 2.3 6 5.5\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\"/><circle cx=\"17\" cy=\"9\" r=\"2.8\" stroke=\"currentColor\" stroke-width=\"1.6\"/><path d=\"M16 14c2.6.3 4.8 2 5 4.8\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\"/></svg> Круг (${circleBlurCount})
            </button>
            <button type="button" class="btn btn-sm ${visibleMapLayers.crewExact ? 'btn-accent' : ''}" data-toggle-overlay="crewExact" title="Показать или скрыть точные точки вашего закрытого Экипажа" style="width:100%;min-width:0;padding:4px 4px;font-size:11px;min-height:32px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              <svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0\" stroke=\"#38bdf8\" stroke-width=\"2\" stroke-linecap=\"round\"/></svg> Экипаж (${crewExactCount})
            </button>
          </div>
          <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;margin-top:4px;width:100%;">
            <button type="button" class="btn btn-sm ${visibleMapLayers.ownership === 'all' ? 'btn-accent' : ''}" data-map-owner="all" title="Показывать на карте и ваши, и чужие метки" style="width:100%;min-width:0;padding:3px 4px;font-size:11px;min-height:28px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              <svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6z\" fill=\"rgba(56,189,248,0.18)\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linejoin=\"round\"/><path d=\"M9 3v15M15 6v15\" stroke=\"currentColor\" stroke-width=\"1.6\"/><circle cx=\"12\" cy=\"10\" r=\"2.2\" fill=\"#38bdf8\" stroke=\"#fff\" stroke-width=\"1\"/></svg> Все (${mineMapCount + foreignMapCount})
            </button>
            <button type="button" class="btn btn-sm ${visibleMapLayers.ownership === 'mine' ? 'btn-good' : ''}" data-map-owner="mine" title="Оставить на карте только ваши собственные точки и закладки" style="width:100%;min-width:0;padding:3px 4px;font-size:11px;min-height:28px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              <svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><circle cx=\"12\" cy=\"8\" r=\"4\" fill=\"rgba(56,189,248,0.22)\" stroke=\"currentColor\" stroke-width=\"1.8\"/><path d=\"M4 20c0-3.8 3.6-6.5 8-6.5s8 2.7 8 6.5\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\"/></svg> Мои (${mineMapCount})
            </button>
            <button type="button" class="btn btn-sm ${visibleMapLayers.ownership === 'foreign' ? 'btn-accent' : ''}" data-map-owner="foreign" title="Оставить на карте только точки других рыболовов" style="width:100%;min-width:0;padding:3px 4px;font-size:11px;min-height:28px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              <svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><circle cx=\"12\" cy=\"12\" r=\"9\" stroke=\"currentColor\" stroke-width=\"1.8\"/><path d=\"M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18\" stroke=\"currentColor\" stroke-width=\"1.6\"/></svg> Чужие (${foreignMapCount})
            </button>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:6px;">
            <button type="button" class="w-chip ${visibleMapLayers.spotCategory === 'all' ? 'active' : ''}" data-spot-cat-filter="all" style="min-height:28px;padding:3px 9px;font-size:11px;">Все (${thematicCount})</button>
            ${Object.values(SPOT_CATEGORIES).map(cat => `
              <button type="button" class="w-chip ${visibleMapLayers.spotCategory === cat.id ? 'active' : ''}" data-spot-cat-filter="${cat.id}" style="min-height:28px;padding:3px 9px;font-size:11px;">
                ${cat.icon} ${cat.short}
              </button>
            `).join('')}
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;font-size:11px;color:${inspectMode ? 'var(--good)' : 'var(--muted)'};font-weight:700;margin-top:5px;">
            <span>${inspectMode ? '<svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><circle cx=\"11\" cy=\"11\" r=\"6.5\" stroke=\"currentColor\" stroke-width=\"2\"/><path d=\"M16 16l4.5 4.5\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/></svg> Режим разведки активен: нажмите в любое место карты' : '<svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z\" fill=\"rgba(239,68,68,0.22)\" stroke=\"#ef4444\" stroke-width=\"1.9\"/><circle cx=\"12\" cy=\"11\" r=\"2.3\" fill=\"#ef4444\"/></svg> © <a href=\"https://yandex.ru/maps/\" target=\"_blank\" rel=\"noopener\" style=\"color:inherit;text-decoration:underline;\">Яндекс Карты</a> (<a href=\"https://yandex.ru/legal/maps_termsofuse/\" target=\"_blank\" rel=\"noopener\" style=\"color:inherit;text-decoration:underline;\">Условия использования</a>) • EPSG:3395'}</span>
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
        <div style="margin-top:10px;padding:8px 10px;background:var(--card);border:1px dashed var(--accent);border-radius:var(--r-sm);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <span style="font-size:var(--fs-xs);font-weight:800;color:var(--accent);"><svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><circle cx=\"12\" cy=\"12\" r=\"9\" stroke=\"currentColor\" stroke-width=\"1.8\"/><circle cx=\"12\" cy=\"12\" r=\"5\" stroke=\"#38bdf8\" stroke-width=\"1.5\"/><path d=\"M12 12l6-6\" stroke=\"#10b981\" stroke-width=\"2\" stroke-linecap=\"round\"/><circle cx=\"12\" cy=\"12\" r=\"1.8\" fill=\"#10b981\"/></svg> Обмен путевыми точками и глубинами эхолота (.GPX / .KML / .JSON)</span>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button type="button" class="btn btn-sm" id="geoExportGpxBtn"><svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M12 15V3m0 0L8 7m4-4l4 4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2\" stroke=\"currentColor\" stroke-width=\"1.9\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg> Экспорт .GPX</button>
            <button type="button" class="btn btn-sm" id="geoExportKmlBtn"><svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M12 15V3m0 0L8 7m4-4l4 4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2\" stroke=\"currentColor\" stroke-width=\"1.9\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg> Экспорт .KML</button>
            <label class="btn btn-sm btn-accent" style="cursor:pointer;margin:0;">
              <svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2\" stroke=\"currentColor\" stroke-width=\"1.9\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg> Импорт .GPX / .KML / .JSON
              <input type="file" id="geoImportGpxInput" accept=".gpx,.kml,.xml,.json,application/gpx+xml,application/vnd.google-earth.kml+xml,application/json,text/xml,*/*" style="display:none;">
 </label>
 </div>
 </div>
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
 <div class="card geo-auth-only-block" style="background:var(--card);margin-bottom:14px;padding:10px 12px;border:1px solid var(--border);">
 <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:6px;">
 <span style="font-size:var(--fs-xs);font-weight:800;color:var(--accent);"> КАРТА ГЛУБИН И РЕЛЬЕФ ДНА: ${s.selectedWaterName || prof.name} (${getWaterTypeShortTag(s.water)})</span>
 <span class="pill pill-neutral" style="font-size:var(--fs-xs);">Эхолокационный диапазон: ${prof.minD}–${prof.maxD} м</span>
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
 <div style="color:var(--muted);font-size:var(--fs-xs);">СКОРОСТЬ ТЕЧЕНИЯ (ВЛИЯЕТ НА ВОДУ И ЛЁД)</div>
 <div style="font-weight:700;">${prof.flow >= 2.0 ? 'Быстрое (до ' + prof.flow + ' м/с)' : (prof.flow >= 1.0 ? 'Умеренное (~' + prof.flow + ' м/с)' : 'Слабое / стоячая вода')}</div>
 </div>
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
  container.querySelectorAll('[data-toggle-overlay]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-toggle-overlay');
      if (key && key in visibleMapLayers) {
        visibleMapLayers[key] = !visibleMapLayers[key];
        syncFilterButtonsInPlace();
        renderMapOverlays();
      }
    });
  });
  container.querySelectorAll('[data-map-owner]').forEach(btn => {
    btn.addEventListener('click', () => {
      visibleMapLayers.ownership = btn.getAttribute('data-map-owner') || 'all';
      syncFilterButtonsInPlace();
      renderMapOverlays();
    });
  });
  container.querySelectorAll('[data-spot-cat-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      visibleMapLayers.spotCategory = btn.getAttribute('data-spot-cat-filter') || 'all';
      syncFilterButtonsInPlace();
      renderMapOverlays();
    });
  });
 if (typeof document !== "undefined" && !window.__KLEV_MAP_POPUP_ACTIONS_BOUND__) {
 window.__KLEV_MAP_POPUP_ACTIONS_BOUND__ = true;
 document.addEventListener("click", (e) => {
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
      currentLayerKey = btn.getAttribute('data-map-layer') || 'yandex_map';
      if (mapInstance) {
        if (currentTileLayer) mapInstance.removeLayer(currentTileLayer);
        currentTileLayer = createResilientTileLayer(currentLayerKey).addTo(mapInstance);
        applyYandexTileFiltersToMap();
      }
      syncFilterButtonsInPlace();
    });
  });
  container.querySelectorAll('[data-ymap-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      const fKey = btn.getAttribute('data-ymap-filter');
      if (fKey && fKey in yandexMapFilters) {
        yandexMapFilters[fKey] = !yandexMapFilters[fKey];
        if (mapInstance) {
          if (fKey === 'labels') {
            if (currentTileLayer) mapInstance.removeLayer(currentTileLayer);
            currentTileLayer = createResilientTileLayer(currentLayerKey).addTo(mapInstance);
          }
          applyYandexTileFiltersToMap();
        }
        syncFilterButtonsInPlace();
      }
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
export async function init(container) {
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
 hiddenCircleIds: st.userProfile?.hiddenCircleIds,
 route: st.route,
 fishId: st.fishId
 };
 },
 (next, prev) => {
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
 next.savedSpots === prev.savedSpots) {
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