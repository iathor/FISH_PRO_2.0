import { STATE_CACHE_KEY, WEATHER_CACHE_KEY, WEATHER_TTL_MS } from './config.js?v=2.0.14';
import { formatLocalYYYYMMDD } from './format.js?v=2.0.14';

const DB_NAME = 'KlevProDB_v2';
const DB_VERSION = 2;
export const GEO_WEATHER_ARCHIVE_KEY = 'klev_pro_geo_weather_archive_v2';
export const GEO_WATERS_CACHE_KEY = 'klev_pro_geo_waters_cache_v2';
export const GEO_CLUSTER_RADIUS_KM = 10.0;

let dbPromise = null;
const memoryFallback = { catches: [], spots: [], weather_archive: [] };

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
        if (!db.objectStoreNames.contains('weather_archive')) {
          db.createObjectStore('weather_archive', { keyPath: 'clusterId' });
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

function readClustersFromLocalStorage() {
  try {
    const raw = localStorage.getItem(GEO_WEATHER_ARCHIVE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function writeClustersToLocalStorage(clusters) {
  try {
    localStorage.setItem(GEO_WEATHER_ARCHIVE_KEY, JSON.stringify(clusters));
  } catch (e) {}
  // Дублируем в IndexedDB для надёжности
  openDB().then(db => {
    if (!db || !db.objectStoreNames.contains('weather_archive')) return;
    try {
      const tx = db.transaction('weather_archive', 'readwrite');
      const st = tx.objectStore('weather_archive');
      clusters.forEach(c => {
        if (c && c.clusterId) st.put(c);
      });
    } catch (e) {}
  }).catch(() => {});
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

  /**
   * Ищет кластер погоды в радиусе 10 км от указанных координат
   */
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

  /**
   * Сохраняет и накапливает прогноз и архив погоды по геолокации в радиусе 10 км:
   * - Если сегодня запросить прогноз, для локации в радиусе 10 км кэшируются все дни (архив, сегодня, завтра, послезавтра и до 5–10 дней вперёд).
   * - Если запрос в этой локации (<= 10 км) происходит завтра или через 5 дней:
   *   старые записи автоматически переходят в статус архивных и НЕ затираются,
   *   а перезаписываются только текущий (сегодняшний) и будущие дни!
   * - В кэш сохраняются все параметры для прогноза клёва по всем видам рыб:
   *   tDay, tNight, waterTemp (с учётом течения), pressAvg, dP, windMax, windDir, moon, iceState, iceThickness и почасовой массив hours (24 ч).
   */
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

    // Объединяем дополнительные архивные дни (до 5–7 дней назад) и основные дни прогноза
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
        // Архивные дни НЕ перезаписываются, если в кэше уже лежит реальный прогноз/архив за этот день!
        if (!existing || (!existing.isReal && recordToStore.isReal)) {
          targetCluster.daysByDate[dStr] = recordToStore;
        }
      } else {
        // Текущий (сегодняшний) и будущие дни перезаписываются свежим прогнозом
        targetCluster.daysByDate[dStr] = recordToStore;
      }
    }

    // Проверяем наличие реального архива минимум за 3 прошлых дня в этой локации (10 км)
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

  /**
   * Загружает кэш погоды и накопленный архив для локации в радиусе 10 км
   */
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
      const parsed = JSON.parse(raw);
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

  /**
   * Возвращает архивные дни (по умолчанию за последние 5 дней до refDateStr) для локации в радиусе 10 км
   */
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

  /**
   * Возвращает сохранённый день (с полным почасовым прогнозом 0–23 ч, температурой воды, давлением, ветром и Луной)
   * по произвольной календарной дате YYYY-MM-DD из 10-км кэша локации
   */
  getDayWeatherByDate(lat, lon, dateStr) {
    if (!dateStr) return null;
    const found = this.findGeoWeatherCluster(lat, lon, GEO_CLUSTER_RADIUS_KM);
    if (found && found.cluster && found.cluster.daysByDate && found.cluster.daysByDate[dateStr]) {
      return found.cluster.daysByDate[dateStr];
    }
    return null;
  },

  /**
   * Возвращает сводную статистику по всему локальному архиву погоды (сколько локаций 10 км и сколько дней в архиве)
   */
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

  /**
   * Очищает архив погоды по кнопке «🧹 Очистить архив погоды»:
   * удаляет все старые архивные записи во всех локациях, КРОМЕ последних 5 дней в архиве (и текущего/будущего прогноза).
   */
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

  /**
   * Кэш найденных водоёмов и населённых пунктов в радиусе 10 км (для мгновенного отклика и экономии лимитов Overpass)
   */
  loadNearbyWatersCache(lat, lon, radiusKm = 50) {
    try {
      const raw = localStorage.getItem(GEO_WATERS_CACHE_KEY);
      if (!raw) return null;
      const list = JSON.parse(raw);
      if (!Array.isArray(list)) return null;
      for (const item of list) {
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
      const raw = localStorage.getItem(GEO_WATERS_CACHE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      const filtered = Array.isArray(list)
        ? list.filter(x => !(x.radiusKm === radiusKm && calcGeoDistanceKm(lat, lon, x.lat, x.lon) <= GEO_CLUSTER_RADIUS_KM)).slice(0, 24)
        : [];
      filtered.unshift({
        lat,
        lon,
        radiusKm,
        waters,
        places,
        savedAt: Date.now()
      });
      localStorage.setItem(GEO_WATERS_CACHE_KEY, JSON.stringify(filtered));
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
