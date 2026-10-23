import { STATE_CACHE_KEY, WEATHER_CACHE_KEY, WEATHER_TTL_MS } from './config.js?v=2.0.13';

const DB_NAME = 'KlevProDB_v2';
const DB_VERSION = 1;
let dbPromise = null;
const memoryFallback = { catches: [], spots: [] };

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
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
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
  return dbPromise;
}

export const storage = {
  loadSettings() {
    try {
      const raw = localStorage.getItem(STATE_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  },

  saveSettings(state) {
    try {
      const persist = {
        hasUserLocation: state.hasUserLocation,
        lat: state.lat,
        lon: state.lon,
        locCountry: state.locCountry,
        locAdmin1: state.locAdmin1,
        locAdmin2: state.locAdmin2,
        locLabel: state.locLabel,
        basinCode: state.basinCode,
        basinName: state.basinName,
        isCoastal: state.isCoastal,
        water: state.water,
        waterRadiusKm: state.waterRadiusKm || 50,
        selectedWaterName: state.selectedWaterName,
        method: state.method,
        selectedBait: state.selectedBait,
        depth: state.depth,
        fishId: state.fishId,
        showAllSpecies: state.showAllSpecies,
        onlyFavoritesFilter: state.onlyFavoritesFilter,
        favorites: state.favorites,
        favoritesExplicitlySet: state.favoritesExplicitlySet,
        compareSpeciesIds: state.compareSpeciesIds,
        theme: state.theme,
        userProfile: state.userProfile
      };
      localStorage.setItem(STATE_CACHE_KEY, JSON.stringify(persist));
    } catch (e) {}
  },

  loadWeatherCache(lat, lon) {
    try {
      const raw = localStorage.getItem(WEATHER_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const dist = Math.hypot((parsed.lat || 0) - lat, (parsed.lon || 0) - lon);
      if (dist > 0.15 || !parsed.days || parsed.days.length !== 12) return null;
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

  saveWeatherCache(lat, lon, payload) {
    try {
      localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify({
        lat,
        lon,
        timestamp: Date.now(),
        ...payload
      }));
    } catch (e) {}
  },

  async getAllFromStore(storeName) {
    const db = await openDB();
    if (!db) return [...(memoryFallback[storeName] || [])];
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([...(memoryFallback[storeName] || [])]);
      } catch (e) {
        resolve([...(memoryFallback[storeName] || [])]);
      }
    });
  },

  async putToStore(storeName, item) {
    const list = memoryFallback[storeName] || [];
    const idx = list.findIndex(x => x.id === item.id);
    if (idx >= 0) list[idx] = item; else list.unshift(item);
    const db = await openDB();
    if (!db) return item;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(item);
        tx.oncomplete = () => resolve(item);
        tx.onerror = () => resolve(item);
      } catch (e) {
        resolve(item);
      }
    });
  },

  async deleteFromStore(storeName, id) {
    memoryFallback[storeName] = (memoryFallback[storeName] || []).filter(x => x.id !== id);
    const db = await openDB();
    if (!db) return true;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).delete(id);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }
};
