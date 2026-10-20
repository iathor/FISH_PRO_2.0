const LS_PREFIX = 'kp.';

export const ls = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(LS_PREFIX + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value) {
    try {
      localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
      return true;
    } catch (err) {
      console.warn('[storage] write failed', err);
      return false;
    }
  },
  remove(key) {
    try { localStorage.removeItem(LS_PREFIX + key); } catch {}
  }
};

const DB_NAME = 'klevpro';
const DB_VERSION = 1;
const STORES = ['catches', 'spots', 'photos'];
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath: 'id', autoIncrement: true });
          store.createIndex('createdAt', 'createdAt');
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(storeName, mode) {
  const db = await openDb();
  if (!db) throw new Error('IndexedDB unavailable');
  return db.transaction(storeName, mode).objectStore(storeName);
}

export const idb = {
  add: (s, v) => tx(s, 'readwrite').then(store => new Promise((resolve, reject) => {
    const req = store.add({ ...v, createdAt: v.createdAt ?? Date.now() });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  })),
  get: (s, id) => tx(s, 'readonly').then(store => new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  })),
  getAll: (s) => tx(s, 'readonly').then(store => new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  })),
  delete: (s, id) => tx(s, 'readwrite').then(store => new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  })),
  clear: (s) => tx(s, 'readwrite').then(store => new Promise((resolve, reject) => {
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  }))
};