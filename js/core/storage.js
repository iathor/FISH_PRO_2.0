import { STATE_CACHE_KEY, WEATHER_CACHE_KEY, WEATHER_TTL_MS } from './config.js?v=2.9.0-r235';
import { formatLocalYYYYMMDD } from './format.js?v=2.9.0-r235';
const DB_NAME = 'KlevProDB_v2_1_1';
export const CLEAN_SLATE_FLAG_KEY = 'klev_pro_clean_slate_v2_1_1_r4';
export const CLEAN_SLATE_NOTICE_KEY = 'klev_pro_clean_slate_notice_v2_1_1_r4';

/**
 * ── ЗАЩИЩЁННЫЙ СЕЙФ ДАННЫХ ПРИЛОЖЕНИЯ ANDROID APK (Context.getFilesDir() / App Data) ──
 * Хранит пользовательские данные (профиль, Fisher ID, логин/пароль, точки на карте, журнал уловов с фото,
 * сохранённые маршруты Фазы 3, чаты и 10-км метеоархив) непосредственно во внутренней памяти ДАННЫХ приложения,
 * которая НЕ удаляется при нажатии «Очистить кэш» в системных настройках Android.
 */
const NATIVE_PROTECTED_KEY_PREFIXES = ['klev_pro_', 'KLEV_', 'kp_'];

function isProtectedUserKey(key) {
  if (!key || typeof key !== 'string') return false;
  if (key.includes('version_check') || key.includes('sw_cache')) return false;
  return NATIVE_PROTECTED_KEY_PREFIXES.some(pref => key.startsWith(pref)) || key.includes('klev');
}

export function saveKeyToNativeAppData(key, valueStr) {
  if (!isProtectedUserKey(key) || typeof valueStr !== 'string') return false;
  try {
    if (typeof window !== 'undefined' && window.AndroidBridge && typeof window.AndroidBridge.saveAppDataKey === 'function') {
      return Boolean(window.AndroidBridge.saveAppDataKey(String(key), String(valueStr)));
    }
  } catch (e) {}
  return false;
}

export function loadKeyFromNativeAppData(key) {
  if (!key) return null;
  try {
    if (typeof window !== 'undefined' && window.AndroidBridge && typeof window.AndroidBridge.loadAppDataKey === 'function') {
      const val = window.AndroidBridge.loadAppDataKey(String(key));
      if (val && typeof val === 'string' && val.length > 0) {
        return val;
      }
    }
  } catch (e) {}
  return null;
}

export function hydrateFromAndroidAppDataVault() {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return { restoredKeys: 0, syncedKeys: 0 };
  let restoredKeys = 0;
  let syncedKeys = 0;
  try {
    // 1. Перехватываем localStorage.setItem / removeItem для прозрачного зеркалирования всех klev_pro_* ключей в App Data APK
    if (!window.__klevNativeStorageHookInstalled && typeof Storage !== 'undefined' && Storage.prototype) {
      const origSetItem = Storage.prototype.setItem;
      const origRemoveItem = Storage.prototype.removeItem;
      Storage.prototype.setItem = function(k, v) {
        origSetItem.call(this, k, v);
        if (isProtectedUserKey(k) && !window.__klevRestoringFromNativeVault) {
          saveKeyToNativeAppData(String(k), String(v));
        }
      };
      Storage.prototype.removeItem = function(k) {
        origRemoveItem.call(this, k);
        if (this === window.localStorage && isProtectedUserKey(k) && !window.__klevRestoringFromNativeVault && window.__klevExplicitUserDeleteKey === k) {
          try {
            if (window.AndroidBridge && typeof window.AndroidBridge.removeAppDataKey === 'function') {
              window.AndroidBridge.removeAppDataKey(String(k));
            }
          } catch (e) {}
        }
      };
      window.__klevNativeStorageHookInstalled = true;
    }

    // 2. Восстанавливаем данные из Context.getFilesDir()/klev_appdata_vault, если кэш WebView был очищен
    if (window.AndroidBridge && typeof window.AndroidBridge.loadAllAppDataJson === 'function') {
      const rawVaultJson = window.AndroidBridge.loadAllAppDataJson();
      if (rawVaultJson && typeof rawVaultJson === 'string' && rawVaultJson.length > 2) {
        const vaultMap = JSON.parse(rawVaultJson);
        if (vaultMap && typeof vaultMap === 'object') {
          window.__klevRestoringFromNativeVault = true;
          try {
            for (const [k, vaultVal] of Object.entries(vaultMap)) {
              if (!k || typeof vaultVal !== 'string' || !vaultVal.length) continue;
              const curLocal = localStorage.getItem(k);
              if (!curLocal || (curLocal.length < 5 && vaultVal.length >= 5)) {
                localStorage.setItem(k, vaultVal);
                restoredKeys++;
              } else if (k === STATE_CACHE_KEY && curLocal && vaultVal) {
                try {
                  const curObj = JSON.parse(curLocal);
                  const vaultObj = JSON.parse(vaultVal);
                  if (!curObj?.userProfile?.fisherId && vaultObj?.userProfile?.fisherId) {
                    localStorage.setItem(k, vaultVal);
                    restoredKeys++;
                  }
                } catch (_) {}
              }
            }
          } finally {
            window.__klevRestoringFromNativeVault = false;
          }
        }
      }
      // 3. Обратная синхронизация: сохраняем все существующие в localStorage ключи в нативный сейф App Data
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && isProtectedUserKey(k)) {
          const val = localStorage.getItem(k);
          if (val && val.length > 0) {
            saveKeyToNativeAppData(k, val);
            syncedKeys++;
          }
        }
      }
    }

    // 4. Для PWA и сайта запрашиваем у браузера невытесняемое постоянное хранилище (Persistent Storage)
    if (navigator.storage && typeof navigator.storage.persist === 'function') {
      navigator.storage.persist().catch(() => {});
    }

    window.__klevFlushAllToNativeVault = () => {
      let flushed = 0;
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && isProtectedUserKey(k)) {
            const v = localStorage.getItem(k);
            if (v) {
              saveKeyToNativeAppData(k, v);
              flushed++;
            }
          }
        }
      } catch (e) {}
      return flushed;
    };
  } catch (e) {}
  return { restoredKeys, syncedKeys };
}

hydrateFromAndroidAppDataVault();

/**
 * Автоматический сброс старого кэша и настроек («С чистого листа») при первом запуске релиза V.2.1.1 (r2)
 * с автоматическим восстановлением эксклюзивного ID Владельца (iAthor -> FP_89VIP089)
 */
export function runCleanSlateMigrationV2100() {
  try {
    if (typeof localStorage === 'undefined') return false;
    if (localStorage.getItem(CLEAN_SLATE_FLAG_KEY) === '1' || loadKeyFromNativeAppData(CLEAN_SLATE_FLAG_KEY) === '1') {
      try { localStorage.setItem(CLEAN_SLATE_FLAG_KEY, '1'); } catch (_) {}
      return false;
    }
    // Если у пользователя уже есть точки, уловы, маршруты или профиль v2 — НИКОГДА не сбрасываем данные
    if (localStorage.getItem(STATE_CACHE_KEY) || localStorage.getItem('klev_pro_spots_backup_v2') || localStorage.getItem('klev_pro_catches_backup_v2') || localStorage.getItem('klev_pro_phase3_routes_v1')) {
      localStorage.setItem(CLEAN_SLATE_FLAG_KEY, '1');
      saveKeyToNativeAppData(CLEAN_SLATE_FLAG_KEY, '1');
      return false;
    }
    let preservedUserProfile = null;
    try {
      const prevRaw = localStorage.getItem(STATE_CACHE_KEY);
      if (prevRaw) {
        const prevParsed = JSON.parse(prevRaw);
        if (prevParsed && prevParsed.userProfile && prevParsed.userProfile.login) {
          preservedUserProfile = { ...prevParsed.userProfile };
          delete preservedUserProfile.authShadow;
        }
      }
    } catch (_) {}
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('klev_pro_') || k.startsWith('KLEV_') || k.includes('klev'))) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach(k => {
      try { localStorage.removeItem(k); } catch (e) {}
    });
    if (typeof indexedDB !== 'undefined' && typeof indexedDB.deleteDatabase === 'function') {
      try { indexedDB.deleteDatabase('KlevProDB_v2'); } catch (e) {}
    }
    if (preservedUserProfile) {
      try {
        localStorage.setItem(STATE_CACHE_KEY, JSON.stringify({
          appMode: preservedUserProfile.appMode || 'angler',
          hasUserLocation: false,
          lat: 66.0833,
          lon: 76.6800,
          locCountry: 'Россия',
          locAdmin1: 'Ямало-Ненецкий АО',
          locAdmin2: 'Новый Уренгой',
          locLabel: 'Новый Уренгой',
          userProfile: preservedUserProfile
        }));
      } catch (_) {}
    }
    localStorage.setItem(CLEAN_SLATE_FLAG_KEY, '1');
    localStorage.setItem(CLEAN_SLATE_NOTICE_KEY, '1');
    return true;
  } catch (e) {
    return false;
  }
}
runCleanSlateMigrationV2100();
export const GEO_WEATHER_ARCHIVE_KEY = 'klev_pro_geo_weather_archive_v2';
export const GEO_WATERS_CACHE_KEY = 'klev_pro_v259_waters_cache_r196';
export const CIRCLE_PACKS_CACHE_KEY = 'klev_pro_circle_packs_v2';
export const CIRCLE_CHATS_CACHE_KEY = 'klev_pro_circle_chats_v2';
export const CIRCLE_NOTIFS_CACHE_KEY = 'klev_pro_circle_notifs_v2';
export const DEVICE_ID_CACHE_KEY = 'klev_pro_device_id_v2';
export const PHOTO_HASHES_CACHE_KEY = 'klev_pro_photo_dhashes_v2';
export const GEO_CLUSTER_RADIUS_KM = 10.0;
const LOCAL_STORE_KEYS = {
  spots: 'klev_pro_spots_backup_v2',
  catches: 'klev_pro_catches_backup_v2',
  chats: CIRCLE_CHATS_CACHE_KEY
};
/**
 * Безопасный парсер JSON с защитой от Prototype Pollution (__proto__, constructor, prototype)
 */
export function safeJsonParse(rawStr, fallback = null) {
  if (!rawStr || typeof rawStr !== 'string') return fallback;
  try {
    return JSON.parse(rawStr, (key, value) => {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        return undefined;
      }
      return value;
    });
  } catch (e) {
    return fallback;
  }
}
let dbPromise = null;
const memoryFallback = { catches: [], spots: [], weather_archive: [], chats: [] };
const memoryBackupLoaded = { catches: false, spots: false, chats: false };
let _clustersMemoryCache = null;
let _nearbyWatersMemoryCache = null;
let _saveSettingsTimer = null;
let _pendingSettingsState = null;
function readLocalBackup(storeName) {
  const key = LOCAL_STORE_KEYS[storeName];
  if (!key) return [...(memoryFallback[storeName] || [])];
  if (memoryBackupLoaded[storeName] && Array.isArray(memoryFallback[storeName])) {
    return [...memoryFallback[storeName]];
  }
  try {
    let raw = localStorage.getItem(key);
    if (!raw) {
      const nativeRaw = loadKeyFromNativeAppData(key);
      if (nativeRaw) {
        raw = nativeRaw;
        try { localStorage.setItem(key, nativeRaw); } catch (_) {}
      }
    }
    memoryBackupLoaded[storeName] = true;
    if (!raw) return [...(memoryFallback[storeName] || [])];
    const parsed = safeJsonParse(raw);
    if (Array.isArray(parsed)) {
      memoryFallback[storeName] = parsed;
      return [...parsed];
    }
  } catch (e) {}
  return [...(memoryFallback[storeName] || [])];
}
function writeLocalBackup(storeName, list) {
  if (!Array.isArray(list)) return;
  memoryFallback[storeName] = [...list];
  memoryBackupLoaded[storeName] = true;
  const key = LOCAL_STORE_KEYS[storeName];
  if (!key) return;
  try {
    const serialized = JSON.stringify(list);
    localStorage.setItem(key, serialized);
    saveKeyToNativeAppData(key, serialized);
  } catch (e) {}
}
function mergeRecordsById(idbList = [], localList = []) {
  const map = new Map();
  for (const item of localList) {
    if (item && item.id) map.set(item.id, item);
  }
  for (const item of idbList) {
    if (item && item.id) map.set(item.id, item);
  }
  return Array.from(map.values());
}
export function calcGeoDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 100) / 100;
}
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    let settled = false;
    const finish = (dbInstance) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!dbInstance) {
        dbPromise = null;
      }
      resolve(dbInstance || null);
    };
    const timer = setTimeout(() => finish(null), 550);
    try {
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('catches')) {
          const cs = db.createObjectStore('catches', { keyPath: 'id' });
          cs.createIndex('fishId', 'fishId', { unique: false });
          cs.createIndex('timestamp', 'timestamp', { unique: false });
        }
        if (!db.objectStoreNames.contains('spots')) {
          db.createObjectStore('spots', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('weather_archive')) {
          db.createObjectStore('weather_archive', { keyPath: 'clusterId' });
        }
        if (!db.objectStoreNames.contains('chats')) {
          db.createObjectStore('chats', { keyPath: 'id' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        if (db) {
          db.onversionchange = () => {
            try { db.close(); } catch (e) {}
            dbPromise = null;
          };
        }
        finish(db);
      };
      req.onerror = () => finish(null);
      req.onblocked = () => finish(null);
    } catch (e) {
      finish(null);
    }
  });
  return dbPromise;
}
function readClustersFromLocalStorage() {
  if (_clustersMemoryCache !== null) {
    return _clustersMemoryCache;
  }
  try {
    const raw = localStorage.getItem(GEO_WEATHER_ARCHIVE_KEY);
    if (!raw) {
      _clustersMemoryCache = [];
      return _clustersMemoryCache;
    }
    const parsed = safeJsonParse(raw);
    _clustersMemoryCache = Array.isArray(parsed) ? parsed : [];
    return _clustersMemoryCache;
  } catch (e) {
    _clustersMemoryCache = [];
    return _clustersMemoryCache;
  }
}
let _idbClusterTimer = null;
function writeClustersToLocalStorage(clusters) {
  _clustersMemoryCache = Array.isArray(clusters) ? clusters : [];
  try {
    const s = JSON.stringify(_clustersMemoryCache); localStorage.setItem(GEO_WEATHER_ARCHIVE_KEY, s); saveKeyToNativeAppData(GEO_WEATHER_ARCHIVE_KEY, s);
  } catch (e) {}
  if (_idbClusterTimer) clearTimeout(_idbClusterTimer);
  _idbClusterTimer = setTimeout(() => {
    openDB().then(db => {
      if (!db || !db.objectStoreNames.contains('weather_archive')) return;
      try {
        const tx = db.transaction('weather_archive', 'readwrite');
        const st = tx.objectStore('weather_archive');
        (_clustersMemoryCache || []).forEach(c => {
          if (c && c.clusterId) st.put(c);
        });
      } catch (e) {}
    }).catch(() => {});
  }, 350);
}
export const storage = {
  _memDeviceId: '',
  getDeviceId() {
    try {
      if (typeof window !== 'undefined' && window.AndroidBridge && typeof window.AndroidBridge.getDeviceId === 'function') {
        const hw = String(window.AndroidBridge.getDeviceId() || '').trim();
        if (hw && hw.length >= 6 && hw !== 'unknown' && hw !== '9774d56d682e549c') {
          const hwId = `hw_${hw}`;
          this._memDeviceId = hwId;
          try { localStorage.setItem(DEVICE_ID_CACHE_KEY, hwId); } catch (_) {}
          return hwId;
        }
      }
      if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem(DEVICE_ID_CACHE_KEY);
        if (saved && typeof saved === 'string' && saved.length >= 10 && saved !== 'dev_local_fallback') {
          this._memDeviceId = saved;
          return saved;
        }
      }
      if (this._memDeviceId && this._memDeviceId.length >= 10) {
        return this._memDeviceId;
      }
      let freshId = '';
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        freshId = 'dev_' + crypto.randomUUID().replace(/-/g, '');
      } else if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        const arr = new Uint8Array(16);
        crypto.getRandomValues(arr);
        freshId = 'dev_' + Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
      } else {
        freshId = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12) + '_' + Math.random().toString(36).slice(2, 10);
      }
      this._memDeviceId = freshId;
      try { localStorage.setItem(DEVICE_ID_CACHE_KEY, freshId); } catch (_) {}
      return freshId;
    } catch (e) {
      if (!this._memDeviceId) {
        this._memDeviceId = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12);
      }
      return this._memDeviceId;
    }
  },
  loadPhotoHashes() {
    try {
      const raw = localStorage.getItem(PHOTO_HASHES_CACHE_KEY);
      if (!raw) return [];
      const parsed = safeJsonParse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  },
  savePhotoHash(dHash) {
    if (!dHash) return;
    try {
      const list = this.loadPhotoHashes().filter(x => x !== dHash);
      list.unshift(dHash);
      localStorage.setItem(PHOTO_HASHES_CACHE_KEY, JSON.stringify(list.slice(0, 200)));
    } catch (e) {}
  },
  loadSettings() {
    try {
      let raw = localStorage.getItem(STATE_CACHE_KEY);
      if (!raw) {
        const nativeRaw = loadKeyFromNativeAppData(STATE_CACHE_KEY);
        if (nativeRaw) {
          raw = nativeRaw;
          try { localStorage.setItem(STATE_CACHE_KEY, nativeRaw); } catch (_) {}
        }
      }
      return raw ? safeJsonParse(raw, null) : null;
    } catch (e) {
      return null;
    }
  },
  _flushSettingsNow(stateObj) {
    const s = stateObj || _pendingSettingsState;
    if (!s) return;
    _pendingSettingsState = null;
    try {
      const persist = {
        appMode: s.appMode || 'angler',
        hasUserLocation: s.hasUserLocation,
        lat: s.lat,
        lon: s.lon,
        locCountry: s.locCountry,
        locAdmin1: s.locAdmin1,
        locAdmin2: s.locAdmin2,
        locLabel: s.locLabel,
        basinCode: s.basinCode,
        basinName: s.basinName,
        isCoastal: s.isCoastal,
        water: s.water,
        waterRadiusKm: s.waterRadiusKm || 50,
        selectedWaterName: s.selectedWaterName,
        method: s.method,
        selectedBait: s.selectedBait,
        depth: s.depth,
        fishId: s.fishId,
        showAllSpecies: s.showAllSpecies,
        onlyFavoritesFilter: s.onlyFavoritesFilter,
        favorites: s.favorites,
        favoritesExplicitlySet: s.favoritesExplicitlySet,
        compareSpeciesIds: s.compareSpeciesIds,
        theme: s.theme,
        liquidGlass: s.liquidGlass !== false,
        userProfile: s.userProfile,
        proFactorWeights: s.proFactorWeights
      };
      const serializedState = JSON.stringify(persist);
      localStorage.setItem(STATE_CACHE_KEY, serializedState);
      saveKeyToNativeAppData(STATE_CACHE_KEY, serializedState);
    } catch (e) {}
  },
  saveSettings(state) {
    _pendingSettingsState = state;
    if (typeof window === 'undefined') {
      this._flushSettingsNow(state);
      return;
    }
    if (_saveSettingsTimer) clearTimeout(_saveSettingsTimer);
    _saveSettingsTimer = setTimeout(() => {
      _saveSettingsTimer = null;
      this._flushSettingsNow();
    }, 90);
  },
  loadCircleItems() {
    try {
      const raw = localStorage.getItem(CIRCLE_PACKS_CACHE_KEY);
      if (!raw) return [];
      const parsed = safeJsonParse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  },
  saveCircleItems(list) {
    try {
      if (Array.isArray(list)) {
        const s = JSON.stringify(list); localStorage.setItem(CIRCLE_PACKS_CACHE_KEY, s); saveKeyToNativeAppData(CIRCLE_PACKS_CACHE_KEY, s);
      }
    } catch (e) {}
  },
  loadChatMessages() {
    try {
      const raw = localStorage.getItem(CIRCLE_CHATS_CACHE_KEY);
      if (!raw) return [];
      const parsed = safeJsonParse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  },
  saveChatMessages(list) {
    if (!Array.isArray(list)) return;
    const trimmed = list.slice(0, 500);
    writeLocalBackup('chats', trimmed);
    openDB().then(db => {
      if (!db || !db.objectStoreNames.contains('chats')) return;
      try {
        const tx = db.transaction('chats', 'readwrite');
        const st = tx.objectStore('chats');
        st.clear();
        trimmed.slice(0, 100).forEach(msg => {
          if (msg && msg.id) st.put(msg);
        });
      } catch (e) {}
    }).catch(() => {});
  },
  loadNotifications() {
    try {
      const raw = localStorage.getItem(CIRCLE_NOTIFS_CACHE_KEY);
      if (!raw) return [];
      const parsed = safeJsonParse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  },
  saveNotifications(list) {
    try {
      if (Array.isArray(list)) {
        const s = JSON.stringify(list.slice(0, 120)); localStorage.setItem(CIRCLE_NOTIFS_CACHE_KEY, s); saveKeyToNativeAppData(CIRCLE_NOTIFS_CACHE_KEY, s);
      }
    } catch (e) {}
  },
  exportFullProfileBackup(state) {
    const catchesList = Array.isArray(state?.catches) && state.catches.length > 0
      ? state.catches
      : readLocalBackup('catches');
    const savedSpotsList = Array.isArray(state?.savedSpots) && state.savedSpots.length > 0
      ? state.savedSpots
      : readLocalBackup('spots');
    const circleList = Array.isArray(state?.circleItems) && state.circleItems.length > 0
      ? state.circleItems
      : this.loadCircleItems();
    const personalSpotItems = (circleList || []).filter(x => x && x.t === 'spot');
    let savedRoutes = [];
    try {
      const rawRoutes = typeof localStorage !== 'undefined' ? localStorage.getItem('klev_pro_phase3_routes_v1') : null;
      if (rawRoutes) savedRoutes = JSON.parse(rawRoutes) || [];
    } catch (e) {}
    return {
      schema: 'KlevProFullBackup_v3',
      version: '2.5.6',
      revision: 'r215',
      exportedAt: new Date().toISOString(),
      deviceId: this.getDeviceId(),
      summary: {
        catchesCount: (catchesList || []).length,
        catchesWithPhotoCount: (catchesList || []).filter(c => c && (c.photoDataUrl || c.photoUrl)).length,
        savedSpotsCount: (savedSpotsList || []).length,
        personalMapPointsCount: personalSpotItems.length,
        savedRoutesCount: (savedRoutes || []).length
      },
      userProfile: (() => {
        const up = { ...(state?.userProfile || {}) };
        delete up.authShadow;
        delete up.authTokenHash;
        delete up.secureTokenHash;
        delete up.pinHash;
        delete up.adminSessionToken;
        return up;
      })(),
      favorites: state?.favorites || [],
      proFactorWeights: state?.proFactorWeights || {},
      location: {
        lat: state?.lat,
        lon: state?.lon,
        locLabel: state?.locLabel,
        locAdmin1: state?.locAdmin1,
        water: state?.water,
        selectedWaterName: state?.selectedWaterName,
        depth: state?.depth
      },
      savedSpots: savedSpotsList || [],
      personalMapPoints: personalSpotItems,
      savedRoutes: savedRoutes || [],
      catches: catchesList || [],
      circleItems: circleList || [],
      chatMessages: state?.chatMessages || this.loadChatMessages(),
      notifications: state?.notifications || this.loadNotifications()
    };
  },
  async importFullProfileBackup(backupObj, mergeExisting = true) {
    if (!backupObj || typeof backupObj !== 'object') return false;
    try {
      if (Array.isArray(backupObj.savedRoutes) && typeof localStorage !== 'undefined') {
        try {
          const existingRoutes = mergeExisting ? (JSON.parse(localStorage.getItem('klev_pro_phase3_routes_v1') || '[]') || []) : [];
          const routeMap = new Map();
          existingRoutes.forEach(r => { if (r && r.id) routeMap.set(r.id, r); });
          backupObj.savedRoutes.forEach(r => { if (r && r.id) routeMap.set(r.id, r); });
          localStorage.setItem('klev_pro_phase3_routes_v1', JSON.stringify(Array.from(routeMap.values())));
        } catch (e) {}
      }
      if (Array.isArray(backupObj.savedSpots)) {
        const curSpots = mergeExisting ? (readLocalBackup('spots') || []) : [];
        const spMap = new Map();
        curSpots.forEach(s => { if (s && s.id) spMap.set(s.id, s); });
        backupObj.savedSpots.forEach(s => { if (s && s.id) spMap.set(s.id, s); });
        const mergedSpots = Array.from(spMap.values());
        writeLocalBackup('spots', mergedSpots);
        for (const sp of mergedSpots) {
          if (sp && sp.id) await this.putToStore('spots', sp);
        }
      }
      if (Array.isArray(backupObj.catches)) {
        const curCatches = mergeExisting ? (readLocalBackup('catches') || []) : [];
        const cMap = new Map();
        curCatches.forEach(c => { if (c && c.id) cMap.set(c.id, c); });
        backupObj.catches.forEach(c => { if (c && c.id) cMap.set(c.id, c); });
        const mergedCatches = Array.from(cMap.values());
        writeLocalBackup('catches', mergedCatches);
        for (const c of mergedCatches) {
          if (c && c.id) await this.putToStore('catches', c);
        }
      }
      const incomingCircle = [
        ...(Array.isArray(backupObj.circleItems) ? backupObj.circleItems : []),
        ...(Array.isArray(backupObj.personalMapPoints) ? backupObj.personalMapPoints : [])
      ];
      if (incomingCircle.length > 0) {
        const curCir = mergeExisting ? (this.loadCircleItems() || []) : [];
        const cirMap = new Map();
        curCir.forEach(it => { if (it && it.id) cirMap.set(it.id, it); });
        incomingCircle.forEach(it => { if (it && it.id) cirMap.set(it.id, it); });
        this.saveCircleItems(Array.from(cirMap.values()));
      }
      if (Array.isArray(backupObj.chatMessages)) {
        this.saveChatMessages(backupObj.chatMessages);
      }
      if (Array.isArray(backupObj.notifications)) {
        this.saveNotifications(backupObj.notifications);
      }
      return true;
    } catch (e) {
      return false;
    }
  },
  getLocalBackup(storeName) {
    return readLocalBackup(storeName);
  },
  findGeoWeatherCluster(lat, lon, radiusKm = GEO_CLUSTER_RADIUS_KM) {
    const clusters = readClustersFromLocalStorage();
    let best = null;
    let bestDist = Infinity;
    for (const c of clusters) {
      if (!c || !Number.isFinite(c.lat) || !Number.isFinite(c.lon)) continue;
      const d = calcGeoDistanceKm(lat, lon, c.lat, c.lon);
      if (d <= radiusKm && d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    return best ? { cluster: best, distKm: bestDist } : null;
  },
  saveWeatherCache(lat, lon, payload, extraArchiveDays = []) {
    const todayStr = formatLocalYYYYMMDD(new Date());
    const clusters = readClustersFromLocalStorage();
    let targetCluster = null;
    let bestDist = Infinity;
    for (const c of clusters) {
      if (!c || !Number.isFinite(c.lat) || !Number.isFinite(c.lon)) continue;
      const d = calcGeoDistanceKm(lat, lon, c.lat, c.lon);
      if (d <= GEO_CLUSTER_RADIUS_KM && d < bestDist) {
        bestDist = d;
        targetCluster = c;
      }
    }
    if (!targetCluster) {
      targetCluster = {
        clusterId: `geo_${lat.toFixed(3)}_${lon.toFixed(3)}`,
        lat: Math.round(lat * 10000) / 10000,
        lon: Math.round(lon * 10000) / 10000,
        elevation: payload.elevation || 90,
        normPress: payload.normPress || 752,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        hasRealArchive: Boolean(payload.hasRealArchive),
        daysByDate: {}
      };
      clusters.push(targetCluster);
    } else {
      targetCluster.updatedAt = Date.now();
      if (Number.isFinite(payload.elevation)) targetCluster.elevation = payload.elevation;
      if (Number.isFinite(payload.normPress)) targetCluster.normPress = payload.normPress;
    }
    if (!targetCluster.daysByDate || typeof targetCluster.daysByDate !== 'object') {
      targetCluster.daysByDate = {};
    }
    const incomingDays = [
      ...(Array.isArray(extraArchiveDays) ? extraArchiveDays : []),
      ...(Array.isArray(payload.days) ? payload.days : [])
    ];
    for (const day of incomingDays) {
      if (!day || !day.date || !Array.isArray(day.hours) || day.hours.length === 0) continue;
      const dStr = day.date;
      const isPastDay = dStr < todayStr;
      const existing = targetCluster.daysByDate[dStr];
      const recordToStore = {
        date: dStr,
        label: day.label || dStr,
        relTitle: day.relTitle || '',
        tDay: day.tDay,
        tNight: day.tNight,
        waterTemp: day.waterTemp,
        pressAvg: day.pressAvg,
        dP: day.dP,
        windMax: day.windMax,
        windDir: day.windDir,
        sunriseHr: day.sunriseHr,
        sunsetHr: day.sunsetHr,
        iceState: day.iceState,
        iceSubState: day.iceSubState,
        iceThickness: day.iceThickness,
        iceNote: day.iceNote,
        moon: day.moon,
        hours: day.hours.map(h => ({ ...h })),
        isReal: day.isReal !== false,
        savedAt: Date.now()
      };
      if (isPastDay) {
        if (!existing || (!existing.isReal && recordToStore.isReal)) {
          targetCluster.daysByDate[dStr] = recordToStore;
        }
      } else {
        targetCluster.daysByDate[dStr] = recordToStore;
      }
    }
    const pastDates = Object.keys(targetCluster.daysByDate).filter(d => d < todayStr).sort();
    const realPastCount = pastDates.filter(d => targetCluster.daysByDate[d]?.isReal !== false).length;
    targetCluster.hasRealArchive = realPastCount >= 3 || Boolean(payload.hasRealArchive);
    writeClustersToLocalStorage(clusters);
    try {
      localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify({
        lat,
        lon,
        timestamp: Date.now(),
        hasRealArchive: targetCluster.hasRealArchive,
        ...payload
      }));
    } catch (e) {}
    return targetCluster;
  },
  loadWeatherCache(lat, lon) {
    const todayStr = formatLocalYYYYMMDD(new Date());
    const found = this.findGeoWeatherCluster(lat, lon, GEO_CLUSTER_RADIUS_KM);
    if (found && found.cluster && found.cluster.daysByDate) {
      const c = found.cluster;
      const ageMs = Date.now() - (c.updatedAt || 0);
      const todayDt = new Date(todayStr + 'T00:00:00');
      const reconstructedDays = [];
      let allPresent = true;
      for (let idx = 0; idx < 12; idx++) {
        const rel = idx - 2; // -2..+9
        const curDt = new Date(todayDt.getTime() + rel * 86400000);
        const dStr = formatLocalYYYYMMDD(curDt);
        const storedDay = c.daysByDate[dStr];
        if (!storedDay || !Array.isArray(storedDay.hours) || storedDay.hours.length < 24) {
          allPresent = false;
          break;
        }
        reconstructedDays.push({
          ...storedDay,
          relOffset: rel,
          isArchive: rel < 0,
          relTitle: rel === -2 ? 'Позавчера' : (rel === -1 ? 'Вчера' : (rel === 0 ? 'Сегодня' : (rel === 1 ? 'Завтра' : (rel === 2 ? 'Послезавтра' : ''))))
        });
      }
      const past5Archive = this.getArchiveDaysForLocation(lat, lon, 5, todayStr);
      if (allPresent && reconstructedDays.length === 12) {
        const todayObj = reconstructedDays[2] || reconstructedDays[0];
        return {
          lat: c.lat,
          lon: c.lon,
          timestamp: c.updatedAt,
          elevation: c.elevation || 90,
          normPress: c.normPress || 752,
          iceState: todayObj.iceState || 'open_water',
          iceSubState: todayObj.iceSubState || 'open_water',
          iceThickness: todayObj.iceThickness || 0,
          iceNote: todayObj.iceNote || '',
          days: reconstructedDays,
          archive5Days: past5Archive.days,
          hasRealArchive: past5Archive.hasRealArchive,
          isExpired: ageMs > WEATHER_TTL_MS,
          ageMinutes: Math.max(1, Math.round(ageMs / 60000)),
          clusterDistKm: found.distKm
        };
      }
    }
    try {
      const raw = localStorage.getItem(WEATHER_CACHE_KEY);
      if (!raw) return null;
      const parsed = safeJsonParse(raw);
      const distKm = calcGeoDistanceKm(parsed.lat || 0, parsed.lon || 0, lat, lon);
      if (distKm > GEO_CLUSTER_RADIUS_KM || !parsed.days || parsed.days.length !== 12) return null;
      const ageMs = Date.now() - (parsed.timestamp || 0);
      return {
        ...parsed,
        isExpired: ageMs > WEATHER_TTL_MS,
        ageMinutes: Math.max(1, Math.round(ageMs / 60000))
      };
    } catch (e) {
      return null;
    }
  },
  getArchiveDaysForLocation(lat, lon, maxPastDays = 5, refDateStr = null) {
    const targetRef = refDateStr || formatLocalYYYYMMDD(new Date());
    const found = this.findGeoWeatherCluster(lat, lon, GEO_CLUSTER_RADIUS_KM);
    if (!found || !found.cluster || !found.cluster.daysByDate) {
      return {
        days: [],
        allArchiveDays: [],
        hasRealArchive: false,
        totalArchiveCount: 0,
        cluster: null
      };
    }
    const map = found.cluster.daysByDate;
    const allPastDates = Object.keys(map).filter(d => d < targetRef).sort();
    const allArchiveDays = allPastDates.map(d => map[d]).filter(Boolean);
    const recentSlice = allArchiveDays.slice(-maxPastDays);
    const realCount = recentSlice.filter(d => d && d.isReal !== false).length;
    return {
      days: recentSlice,
      allArchiveDays,
      hasRealArchive: realCount >= 3 || Boolean(found.cluster.hasRealArchive && recentSlice.length >= 2),
      totalArchiveCount: allArchiveDays.length,
      cluster: found.cluster
    };
  },
  getDayWeatherByDate(lat, lon, dateStr) {
    if (!dateStr) return null;
    const found = this.findGeoWeatherCluster(lat, lon, GEO_CLUSTER_RADIUS_KM);
    if (found && found.cluster && found.cluster.daysByDate && found.cluster.daysByDate[dateStr]) {
      return found.cluster.daysByDate[dateStr];
    }
    return null;
  },
  getWeatherArchiveStats(lat, lon) {
    const todayStr = formatLocalYYYYMMDD(new Date());
    const clusters = readClustersFromLocalStorage();
    let totalLocations = clusters.length;
    let totalArchiveDays = 0;
    let totalFutureDays = 0;
    let localArchiveDays = 0;
    let localOldestDate = null;
    for (const c of clusters) {
      const dates = Object.keys(c?.daysByDate || {}).sort();
      const past = dates.filter(d => d < todayStr);
      const fut = dates.filter(d => d >= todayStr);
      totalArchiveDays += past.length;
      totalFutureDays += fut.length;
      if (Number.isFinite(lat) && Number.isFinite(lon) && calcGeoDistanceKm(lat, lon, c.lat, c.lon) <= GEO_CLUSTER_RADIUS_KM) {
        localArchiveDays += past.length;
        if (past.length > 0 && (!localOldestDate || past[0] < localOldestDate)) {
          localOldestDate = past[0];
        }
      }
    }
    return {
      totalLocations,
      totalArchiveDays,
      totalFutureDays,
      localArchiveDays,
      localOldestDate
    };
  },
  clearWeatherArchiveKeep5Days() {
    const todayDt = new Date();
    todayDt.setHours(0, 0, 0, 0);
    const keepStartDt = new Date(todayDt.getTime() - 5 * 86400000);
    const keepCutoffStr = formatLocalYYYYMMDD(keepStartDt);
    const todayStr = formatLocalYYYYMMDD(todayDt);
    const clusters = readClustersFromLocalStorage();
    let removedCount = 0;
    let keptArchiveCount = 0;
    for (const c of clusters) {
      if (!c || !c.daysByDate) continue;
      for (const dStr of Object.keys(c.daysByDate)) {
        if (dStr < keepCutoffStr) {
          delete c.daysByDate[dStr];
          removedCount++;
        } else if (dStr < todayStr) {
          keptArchiveCount++;
        }
      }
    }
    writeClustersToLocalStorage(clusters);
    return {
      removedCount,
      keptArchiveCount,
      keepCutoffStr
    };
  },
  loadNearbyWatersCache(lat, lon, radiusKm = 50) {
    try {
      if (_nearbyWatersMemoryCache === null) {
        const raw = localStorage.getItem(GEO_WATERS_CACHE_KEY);
        const parsed = raw ? safeJsonParse(raw, []) : [];
        _nearbyWatersMemoryCache = Array.isArray(parsed) ? parsed : [];
      }
      for (const item of _nearbyWatersMemoryCache) {
        if (item.radiusKm === radiusKm && calcGeoDistanceKm(lat, lon, item.lat, item.lon) <= GEO_CLUSTER_RADIUS_KM) {
          if (Date.now() - (item.savedAt || 0) < 7 * 86400000) {
            return item;
          }
        }
      }
      return null;
    } catch (e) {
      return null;
    }
  },
  saveNearbyWatersCache(lat, lon, radiusKm, waters, places = []) {
    try {
      if (_nearbyWatersMemoryCache === null) {
        const raw = localStorage.getItem(GEO_WATERS_CACHE_KEY);
        const parsed = raw ? safeJsonParse(raw, []) : [];
        _nearbyWatersMemoryCache = Array.isArray(parsed) ? parsed : [];
      }
      const filtered = _nearbyWatersMemoryCache
        .filter(x => !(x.radiusKm === radiusKm && calcGeoDistanceKm(lat, lon, x.lat, x.lon) <= GEO_CLUSTER_RADIUS_KM))
        .slice(0, 24);
      filtered.unshift({
        lat,
        lon,
        radiusKm,
        waters,
        places,
        savedAt: Date.now()
      });
      _nearbyWatersMemoryCache = filtered;
      localStorage.setItem(GEO_WATERS_CACHE_KEY, JSON.stringify(filtered));
    } catch (e) {}
  },
  async getAllFromStore(storeName) {
    const localList = readLocalBackup(storeName);
    const db = await openDB();
    if (!db || !db.objectStoreNames.contains(storeName)) {
      return localList;
    }
    return new Promise((resolve) => {
      let done = false;
      const finish = (res) => {
        if (done) return;
        done = true;
        clearTimeout(t);
        resolve(res);
      };
      const t = setTimeout(() => finish(localList), 500);
      try {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => {
          const idbRows = req.result || [];
          const merged = mergeRecordsById(idbRows, localList);
          writeLocalBackup(storeName, merged);
          if (idbRows.length < merged.length && merged.length > 0) {
            try {
              const wTx = db.transaction(storeName, 'readwrite');
              const wSt = wTx.objectStore(storeName);
              merged.forEach(item => {
                if (item && item.id) wSt.put(item);
              });
            } catch (_) {}
          }
          finish(merged);
        };
        req.onerror = () => finish(localList);
      } catch (e) {
        finish(localList);
      }
    });
  },
  async putToStore(storeName, item) {
    const list = readLocalBackup(storeName);
    const idx = list.findIndex(x => x.id === item.id);
    if (idx >= 0) list[idx] = item; else list.unshift(item);
    writeLocalBackup(storeName, list);
    const db = await openDB();
    if (!db || !db.objectStoreNames.contains(storeName)) return item;
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(t);
        resolve(item);
      };
      const t = setTimeout(finish, 500);
      try {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(item);
        tx.oncomplete = finish;
        tx.onerror = finish;
      } catch (e) {
        finish();
      }
    });
  },
  async deleteFromStore(storeName, id) {
    const list = readLocalBackup(storeName).filter(x => x.id !== id);
    writeLocalBackup(storeName, list);
    const db = await openDB();
    if (!db || !db.objectStoreNames.contains(storeName)) return true;
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        clearTimeout(t);
        resolve(ok);
      };
      const t = setTimeout(() => finish(true), 500);
      try {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).delete(id);
        tx.oncomplete = () => finish(true);
        tx.onerror = () => finish(false);
      } catch (e) {
        finish(false);
      }
    });
  }
};