
/**
 * Полноэкранный модальный просмотр фотографии улова с возможностью зума и скачивания на устройство
 */
export function openCatchPhotoViewerModal({ photoUrl, fishName = 'Улов', dateLabel = '', weightKg = 0, lengthCm = 0 }) {
  if (!photoUrl || typeof document === 'undefined') return;
  const sizeInfo = [weightKg ? `${weightKg} кг` : '', lengthCm ? `${lengthCm} см` : ''].filter(Boolean).join(', ');
  const cleanTitle = `${fishName}${sizeInfo ? ` • ${sizeInfo}` : ''}`;
  const safeDate = (dateLabel || new Date().toISOString().slice(0, 10)).replace(/[^0-9A-Za-zА-Яа-я_-]/g, '_');
  const safeFish = fishName.replace(/[^0-9A-Za-zА-Яа-я_-]/g, '_').toLowerCase();
  const downloadName = `klev_catch_${safeFish}_${safeDate}.jpg`;

  let lb = document.getElementById('klevCatchPhotoLightbox');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'klevCatchPhotoLightbox';
    lb.style.cssText = 'position:fixed;inset:0;z-index:9850;background:rgba(5,10,20,0.92);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);display:none;align-items:center;justify-content:center;padding:12px;box-sizing:border-box;';
    document.body.appendChild(lb);
  }

  lb.innerHTML = `
    <div style="width:100%;max-width:560px;background:var(--panel);border:1.5px solid var(--accent);border-radius:14px;padding:12px 14px;box-shadow:0 20px 50px rgba(0,0,0,0.85);display:flex;flex-direction:column;gap:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <div style="font-weight:900;font-size:var(--fs-sm);color:var(--accent);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          Фото улова: ${escapeHtml(cleanTitle)}
        </div>
        <button type="button" class="btn btn-sm" id="catchViewerTopCloseBtn" style="min-height:30px;padding:2px 8px;font-weight:800;">✕</button>
      </div>
      <div style="width:100%;max-height:68vh;overflow:hidden;border-radius:10px;background:#050811;display:flex;align-items:center;justify-content:center;border:1px solid var(--border);">
        <img id="catchViewerImg" src="${photoUrl}" alt="${escapeHtml(cleanTitle)}" style="max-width:100%;max-height:66vh;object-fit:contain;border-radius:8px;display:block;">
      </div>
      <div style="font-size:11.5px;color:var(--muted);text-align:center;">
        ${escapeHtml(cleanTitle)}${dateLabel ? ` • ${escapeHtml(dateLabel)}` : ''}
      </div>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;width:100%;">
        <button type="button" class="btn btn-sm btn-good" id="catchViewerDownloadBtn" style="min-height:40px;font-weight:900;justify-content:center;">
          <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 15V3m0 0L8 7m4-4l4 4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Скачать фото
        </button>
        <button type="button" class="btn btn-sm" id="catchViewerCloseBtn" style="min-height:40px;font-weight:800;justify-content:center;">
          Закрыть просмотр
        </button>
      </div>
    </div>
  `;
  lb.style.display = 'flex';
  const closeLb = () => {
    lb.style.display = 'none';
    lb.innerHTML = '';
  };
  lb.onclick = (e) => {
    if (e.target === lb) closeLb();
  };
  lb.querySelector('#catchViewerTopCloseBtn')?.addEventListener('click', closeLb);
  lb.querySelector('#catchViewerCloseBtn')?.addEventListener('click', closeLb);
  lb.querySelector('#catchViewerDownloadBtn')?.addEventListener('click', () => {
    downloadPhotoCrossPlatform(downloadName, photoUrl);
  });
}

function downloadPhotoCrossPlatform(filename, dataUrl) {
  try {
    if (typeof window !== 'undefined' && window.AndroidBridge && typeof window.AndroidBridge.saveBase64ImageToGallery === 'function') {
      const pureB64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      const ok = window.AndroidBridge.saveBase64ImageToGallery(filename, pureB64);
      if (ok) {
        showToast(`Фото сохранено в галерею смартфона: ${filename}`, 'good');
        return true;
      }
    }
  } catch (_e) {}
  try {
    const parts = dataUrl.split(',');
    const mimeMatch = parts[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const bstr = atob(parts[1] || parts[0]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    const blob = new Blob([u8arr], { type: mime });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(blobUrl);
    }, 1500);
    showToast(`Фото улова скачано: ${filename}`, 'good');
    return true;
  } catch (err) {
    try {
      const w = window.open(dataUrl, '_blank');
      if (w) showToast('Фото открыто в новой вкладке для сохранения', 'info');
    } catch (_e) {}
  }
}

import { isSpeciesInGeoRange } from '../../data/basins.js?v=2.9.0-r235';
import { RU } from '../../i18n/ru.js?v=2.9.0-r235';
import { getSeasonalBaitsForContext, getCompatibleMethods } from '../../core/config.js?v=2.9.0-r235';
import { events } from '../../core/events.js?v=2.9.0-r235';
import { router } from '../../core/router.js?v=2.9.0-r235';
import { storage } from '../../core/storage.js?v=2.9.0-r235';
import { store } from '../../core/store.js?v=2.9.0-r235';
import { setLocation } from '../geo/geo.module.js?v=2.9.0-r235';
import { formatLocalYYYYMMDD, fmtDeltaPress } from '../../core/format.js?v=2.9.0-r235';
import { WATER_PROFILES, getAvailableWaterTypes } from '../../data/waters.js?v=2.9.0-r235';
import { FISH_DB } from '../../data/species.js?v=2.9.0-r235';
import { escapeHtml, createPill, showToast, openModal, closeModal, openConfirmDeleteModal, downloadFileCrossPlatform, flashHighlightElement } from '../../ui/components.js?v=2.9.0-r235';
let activeLogTab = 'active'; // 'active' | 'trash'
import { computeMoon } from '../weather/weather.module.js?v=2.9.0-r235';
import { calcHourly } from '../forecast/forecast.module.js?v=2.9.0-r235';
import { openFishPhotoScannerModal, analyzeFishPhotoHybrid, requestAppCameraAndPhotoAccess } from '../fish/scanner.js?v=2.9.0-r235';
let currentFilter = { fishId: 'all', cond: 'all' };
/**
 * Биологические верхние пределы веса (кг) для защиты от накрутки и опечаток
 */
const SPECIES_MAX_WEIGHT_KG = {
  bleak: 0.25, gudgeon: 0.30, tugun: 0.25, smelt: 0.45, vendace: 0.8, cisco: 1.2,
  ruffe: 0.5, rotan: 0.8, dace: 0.8, roach: 2.5, rudd: 2.5, perch: 3.5,
  crucian: 4.5, peled: 5.0, pizhyan: 6.0, chir: 12.0, whitefish: 10.0,
  grayling: 4.5, baikal_grayling: 4.0, trout: 12.0, chub: 6.5, ide: 6.5,
  tench: 6.5, bream: 9.0, asp: 12.0, zander: 18.0, volga_zander: 3.5,
  burbot: 24.0, pike: 32.0, carp: 40.0, grass_carp: 45.0, silver_carp: 55.0,
  salmon: 35.0, chinook_salmon: 50.0, catfish: 120.0, halibut: 150.0
};
export function getBiologicalMaxWeightKg(fish) {
  if (!fish) return 45;
  if (SPECIES_MAX_WEIGHT_KG[fish.id]) return SPECIES_MAX_WEIGHT_KG[fish.id];
  return fish.type === "predator" ? 35 : 15;
}
/**
 * Вычисляет детерминированный 64-битный перцептивный хэш (dHash / контент-отпечаток) фото
 */
export function computeDataUrlFingerprint(dataUrl) {
  const s = String(dataUrl || "");
  if (!s) return "";
  let h1 = 0xdeadbeef ^ s.length;
  let h2 = 0x41c6ce57 ^ s.length;
  const step = Math.max(1, Math.floor(s.length / 512));
  for (let i = 0; i < s.length; i += step) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return "dh_" + (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}
/**
 * Очищает фотографии улова от всех скрытых EXIF GPS-тегов камеры через перерисовку на <canvas>
 * и возвращает очищенный DataURL + 64-битный перцептивный хэш (dHash) для защиты от дубликатов.
 */
export async function sanitizeCatchPhotoAndComputeHash(rawDataUrl) {
  if (!rawDataUrl || typeof rawDataUrl !== "string") {
    return { cleanDataUrl: "", dHash: "", exifStripped: false };
  }
  if (typeof document === "undefined" || typeof Image === "undefined") {
    return {
      cleanDataUrl: rawDataUrl,
      dHash: computeDataUrlFingerprint(rawDataUrl),
      exifStripped: true
    };
  }
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        try {
          const hc = document.createElement("canvas");
          hc.width = 9;
          hc.height = 8;
          const hctx = hc.getContext("2d");
          let dHash = "";
          if (hctx) {
            hctx.drawImage(img, 0, 0, 9, 8);
            const px = hctx.getImageData(0, 0, 9, 8).data;
            let bits = "";
            for (let y = 0; y < 8; y++) {
              for (let x = 0; x < 8; x++) {
                const i1 = (y * 9 + x) * 4;
                const i2 = (y * 9 + x + 1) * 4;
                const g1 = px[i1] * 0.299 + px[i1 + 1] * 0.587 + px[i1 + 2] * 0.114;
                const g2 = px[i2] * 0.299 + px[i2 + 1] * 0.587 + px[i2 + 2] * 0.114;
                bits += g1 < g2 ? "1" : "0";
              }
            }
            const hex1 = parseInt(bits.slice(0, 32), 2).toString(16).padStart(8, "0");
            const hex2 = parseInt(bits.slice(32, 64), 2).toString(16).padStart(8, "0");
            dHash = "dh_" + hex1 + hex2;
          }
          const maxDim = 1280;
          let w = img.width || 800;
          let h = img.height || 600;
          if (w > maxDim || h > maxDim) {
            const ratio = Math.min(maxDim / w, maxDim / h);
            w = Math.round(w * ratio);
            h = Math.round(h * ratio);
          }
          const c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          const ctx = c.getContext("2d");
          if (ctx) {
            ctx.drawImage(img, 0, 0, w, h);
            const cleanDataUrl = c.toDataURL("image/jpeg", 0.84);
            resolve({
              cleanDataUrl,
              dHash: dHash || computeDataUrlFingerprint(cleanDataUrl),
              exifStripped: true
            });
            return;
          }
        } catch (e) {}
        resolve({
          cleanDataUrl: rawDataUrl,
          dHash: computeDataUrlFingerprint(rawDataUrl),
          exifStripped: true
        });
      };
      img.onerror = () => {
        resolve({
          cleanDataUrl: rawDataUrl,
          dHash: computeDataUrlFingerprint(rawDataUrl),
          exifStripped: false
        });
      };
      img.src = rawDataUrl;
    } catch (e) {
      resolve({
        cleanDataUrl: rawDataUrl,
        dHash: computeDataUrlFingerprint(rawDataUrl),
        exifStripped: false
      });
    }
  });
}
/**
 * Находит суточный и почасовой (24 ч) метеопрогноз из 10-км кэша локации по выбранной календарной дате YYYY-MM-DD
 */
export function resolveDayWeatherForDate(s, dateStr = null, fallbackDayIdx = null) {
  const todayDt = new Date();
  todayDt.setHours(0, 0, 0, 0);
  const todayStr = formatLocalYYYYMMDD(todayDt);
  let targetDate = dateStr;
  if (!targetDate && Number.isFinite(fallbackDayIdx) && s.weatherDays?.[fallbackDayIdx]) {
    targetDate = s.weatherDays[fallbackDayIdx].date;
  }
  if (!targetDate) targetDate = todayStr;
  const fromGeoCache = storage.getDayWeatherByDate(s.lat, s.lon, targetDate);
  if (fromGeoCache && Array.isArray(fromGeoCache.hours) && fromGeoCache.hours.length > 0) {
    return fromGeoCache;
  }
  const fromArchive5 = (s.weatherArchive5Days || []).find(d => d && d.date === targetDate);
  if (fromArchive5 && Array.isArray(fromArchive5.hours) && fromArchive5.hours.length > 0) {
    return fromArchive5;
  }
  const fromWeatherDays = (s.weatherDays || []).find(d => d && d.date === targetDate);
  if (fromWeatherDays && Array.isArray(fromWeatherDays.hours) && fromWeatherDays.hours.length > 0) {
    return fromWeatherDays;
  }
  const refDay = s.weatherDays?.[2] || s.weatherDays?.[0] || {};
  const dt = new Date(targetDate + 'T00:00:00');
  const diffDays = Math.round((dt.getTime() - todayDt.getTime()) / 86400000);
  const relTitle = diffDays === 0 ? 'Сегодня' : (diffDays === -1 ? 'Вчера' : (diffDays === -2 ? 'Позавчера' : (diffDays < 0 ? `${Math.abs(diffDays)} дн. назад` : '')));
  const label = `${RU.daysShort[dt.getDay()]}, ${dt.getDate()} ${RU.monthsGen[dt.getMonth()]}`;
  const moon = computeMoon(targetDate);
  const baseHours = Array.isArray(refDay.hours) && refDay.hours.length === 24 ? refDay.hours : [];
  const hours = [];
  for (let h = 0; h < 24; h++) {
    const bh = baseHours[h] || { tAir: refDay.tDay || 8, press: refDay.pressAvg || 754, dp3h: 0, wind: refDay.windMax || 3, windDir: 'З', cloud: 50, precip: 0 };
    hours.push({ ...bh, hour: h });
  }
  return {
    date: targetDate,
    relTitle,
    label,
    tDay: refDay.tDay ?? 8,
    tNight: refDay.tNight ?? 2,
    waterTemp: refDay.waterTemp ?? 8,
    pressAvg: refDay.pressAvg ?? 754,
    dP: refDay.dP ?? 0,
    windMax: refDay.windMax ?? 3,
    windDir: refDay.windDir || 'З',
    iceState: refDay.iceState || s.iceState || 'open_water',
    moon,
    hours
  };
}
export async function logCatch(catchData) {
  const s = store.getState();
  const day = resolveDayWeatherForDate(s, catchData.date, catchData.dayIdx ?? s.dayIdx);
  const chosenHour = Number.isFinite(catchData.hour) ? catchData.hour : s.selectedHour;
  const hr = (day.hours && day.hours[chosenHour]) || {
    hour: chosenHour ?? new Date().getHours(),
    tAir: day.tDay || 10,
    press: day.pressAvg || 754,
    dp3h: 0,
    wind: day.windMax || 3,
    windDir: day.windDir || 'З'
  };
  const fish = FISH_DB.find(f => f.id === (catchData.fishId || s.fishId)) || FISH_DB[0];
  const predScore = day.hours ? calcHourly(fish, day, hr, catchData.method || s.method, s.water, s.depth, s.normPress, s.iceState) : 50;
  const waterTitle = catchData.waterName || s.selectedWaterName || WATER_PROFILES[s.water]?.shortName || s.locLabel;
  const dt = new Date((day.date || new Date().toISOString().slice(0, 10)) + 'T00:00:00');
  const todayDt = new Date();
  todayDt.setHours(0, 0, 0, 0);
  const diffDays = Math.round((dt.getTime() - todayDt.getTime()) / 86400000);
  const relPrefix = diffDays === 0 ? 'Сегодня' : (diffDays === -1 ? 'Вчера' : (diffDays === -2 ? 'Позавчера' : (diffDays < 0 && diffDays >= -5 ? `${Math.abs(diffDays)} дн. назад` : '')));
  const formattedLabel = day.label || `${RU.daysShort[dt.getDay()]}, ${dt.getDate()} ${RU.monthsGen[dt.getMonth()]}`;
  const rawWeight = Math.max(0, parseFloat(catchData.weightKg) || 0);
  const maxBioWeight = getBiologicalMaxWeightKg(fish);
  const validatedWeight = rawWeight > maxBioWeight ? maxBioWeight : rawWeight;
  if (rawWeight > maxBioWeight) {
    showToast(` Вес ${rawWeight} кг превышает биологический максимум для вида «${fish.name}» (${maxBioWeight} кг) — скорректировано до ${maxBioWeight} кг.`, "warn");
  }
  let cleanPhoto = catchData.photoDataUrl || "";
  let photoHash = catchData.photoHash || "";
  if (cleanPhoto && !photoHash) {
    const sanitized = await sanitizeCatchPhotoAndComputeHash(cleanPhoto);
    cleanPhoto = sanitized.cleanDataUrl;
    photoHash = sanitized.dHash;
  }
  if (photoHash && storage.loadPhotoHashes) {
    const knownHashes = storage.loadPhotoHashes();
    const isDupInCatches = (s.catches || []).some(c => c && c.photoHash === photoHash);
    if (knownHashes.includes(photoHash) || isDupInCatches) {
      showToast(" Этот снимок уже загружался ранее (повторное фото) — запись сохранена в вашем журнале.", "warn");
    } else if (storage.savePhotoHash) {
      storage.savePhotoHash(photoHash);
    }
  }
  const up = s.userProfile || {};
  const record = {
    id: `catch_${Date.now()}`,
    timestamp: Date.now(),
    fid: up.fisherId || "",
    au: up.callsign || "Рыболов",
    date: day.date || new Date().toISOString().slice(0, 10),
    dateLabel: relPrefix ? `${relPrefix} (${formattedLabel})` : `${formattedLabel} (${day.date})`,
    hour: hr.hour,
    fishId: fish.id,
    fishName: fish.name,
    weightKg: validatedWeight,
    lengthCm: parseFloat(catchData.lengthCm) || 0,
    method: catchData.method || s.method,
    bait: (catchData.bait || '').trim() || 'Сезонная оснастка',
    matchedForecast: catchData.matchedForecast !== false,
    photoDataUrl: cleanPhoto,
    photoHash: photoHash,
    exifStripped: Boolean(cleanPhoto),
    locLabel: `${s.locLabel} • ${waterTitle}`,
    lat: s.lat,
    lon: s.lon,
    water: s.water,
    depth: s.depth,
    tAir: hr.tAir ?? day.tDay ?? 10,
    waterTemp: day.waterTemp ?? 10,
    press: hr.press ?? 754,
    dP: day.dP ?? 0,
    wind: hr.wind ?? 3,
    windDir: hr.windDir || 'З',
    moonDay: day.moon?.moonDay || 15,
    moonPhase: day.moon?.phaseName || 'Луна',
    predictedScore: predScore
  };
  await storage.putToStore('catches', record);
  const all = await storage.getAllFromStore('catches');
  all.sort((a, b) => b.timestamp - a.timestamp);
  store.dispatch({ type: 'SET_CATCHES', payload: all });
  showToast(` Улов (${fish.name}, ${record.dateLabel}) записан в журнал и учтён в прогнозе клёва!`, 'good');
  return record;
}
export async function markCatchForDeletion(id, removeSharedFromCircle = true) {
  const all = await storage.getAllFromStore('catches');
  const target = all.find(c => c && c.id === id);
  if (!target) return;
  const updated = { ...target, markedForDeletion: true, deletedAt: Date.now() };
  await storage.putToStore('catches', updated);
  const nextAll = await storage.getAllFromStore('catches');
  nextAll.sort((a, b) => b.timestamp - a.timestamp);
  store.dispatch({ type: 'SET_CATCHES', payload: nextAll });
  if (removeSharedFromCircle) {
    events.emit('circle:deleteSharedCatchItem', { catchObj: target });
  }
  showToast(` Запись «${target.fishName}» перемещена в «Помеченные на удаление»`, 'info');
}
export async function restoreCatchFromTrash(id) {
  const all = await storage.getAllFromStore('catches');
  const target = all.find(c => c && c.id === id);
  if (!target) return;
  const updated = { ...target, markedForDeletion: false, deletedAt: null };
  await storage.putToStore('catches', updated);
  const nextAll = await storage.getAllFromStore('catches');
  nextAll.sort((a, b) => b.timestamp - a.timestamp);
  store.dispatch({ type: 'SET_CATCHES', payload: nextAll });
  showToast(` Запись «${target.fishName}» восстановлена в Журнал уловов!`, 'good');
}
export async function deleteCatch(id, removeSharedFromCircle = true) {
  const existing = (store.getState().catches || []).find(c => c && c.id === id);
  await storage.deleteFromStore('catches', id);
  const all = await storage.getAllFromStore('catches');
  all.sort((a, b) => b.timestamp - a.timestamp);
  store.dispatch({ type: 'SET_CATCHES', payload: all });
  if (removeSharedFromCircle && existing) {
    events.emit('circle:deleteSharedCatchItem', { catchObj: existing });
  }
}
export function getCatches(filter = {}) {
  const list = (store.getState().catches || []).filter(c => c && !c.markedForDeletion);
  return list.filter(c => {
    if (filter.fishId && filter.fishId !== 'all' && c.fishId !== filter.fishId) return false;
    if (filter.cond === 'press_drop' && c.dP >= -1) return false;
    if (filter.cond === 'full_moon' && (c.moonDay < 14 || c.moonDay > 17)) return false;
    if (filter.cond === 'wind_strong' && c.wind <= 5) return false;
    return true;
  });
}
export async function logBlankTrip(customFishId = '') {
  const s = store.getState();
  const fish = FISH_DB.find(f => f.id === (customFishId || s.fishId)) || FISH_DB[0];
  const day = s.weatherDays?.[s.dayIdx] || s.weatherDays?.[2] || s.weatherDays?.[0] || {};
  const wTitle = s.selectedWaterName || WATER_PROFILES[s.water]?.shortName || s.locLabel;
  const rec = await logCatch({
    fishId: fish.id,
    fishName: `${fish.name} (Выезд без улова • 0 поклёвок)`,
    isBlankTrip: true,
    weightKg: 0,
    lengthCm: 0,
    method: s.method,
    bait: s.selectedBait || 'по сезону',
    water: s.water,
    locLabel: `${s.locLabel} (${wTitle})`,
    date: day.date,
    dateLabel: day.label || 'Сегодня',
    dayIdx: s.dayIdx ?? 2,
    hour: s.selectedHour ?? 12,
    matchedForecast: false
  });
  showToast(`Выезд без улова (0 поклёвок • ${fish.name}) записан в журнал для калибровки прогноза!`, 'info');
  return rec;
}
export function getPersonalStats(fishId) {
  const all = (store.getState().catches || []).filter(c => c && !c.markedForDeletion);
  const byFish = fishId && fishId !== 'all' ? all.filter(c => c.fishId === fishId) : all;
  const successList = byFish.filter(c => !c.isBlankTrip && !String(c.fishName || '').includes('Холостой'));
  const blankCount = byFish.length - successList.length;
  if (!byFish.length) {
    return {
      count: 0,
      successCount: 0,
      blankCount: 0,
      matchRate: null,
      avgWaterTemp: null,
      avgPress: null,
      topBait: '—',
      top3Baits: []
    };
  }
  const baseForEnv = successList.length > 0 ? successList : byFish;
  const matched = byFish.filter(c => c.matchedForecast).length;
  const matchRate = Math.round((matched / byFish.length) * 100);
  const avgWaterTemp = Math.round((baseForEnv.reduce((a, b) => a + (b.waterTemp || 10), 0) / baseForEnv.length) * 10) / 10;
  const avgPress = Math.round(baseForEnv.reduce((a, b) => a + (b.press || 754), 0) / baseForEnv.length);
  const baitCounts = {};
  baseForEnv.forEach(c => {
    if (c.bait) baitCounts[c.bait] = (baitCounts[c.bait] || 0) + 1;
  });
  const sortedBaits = Object.entries(baitCounts).sort((a, b) => b[1] - a[1]);
  const topBait = sortedBaits[0]?.[0] || '—';
  const top3Baits = sortedBaits.slice(0, 3).map(([bName, cnt], i) => `${i + 1}. ${bName.split('(')[0].trim()} (${cnt})`);
  return {
    count: byFish.length,
    successCount: successList.length,
    blankCount,
    matchRate,
    avgWaterTemp,
    avgPress,
    topBait,
    top3Baits
  };
}
/**
 * Ревизия 2.0.15:
 * Окно записи улова « Я поймал» с обычным календарём (<input type="date">),
 * быстрыми кнопками выбора за предыдущие 5 дней (и Сегодня) и автоматической подгрузкой почасового прогноза из кэша 10 км!
 */
function isDesktopLogViewOnlyMode() {
  if (typeof window === 'undefined') return false;
  if (typeof window.__KLEV_IS_MOBILE_MAP_MODE__ === 'function') {
    return !window.__KLEV_IS_MOBILE_MAP_MODE__();
  }
  return false;
}

export function openCatchWizard(prefill = {}) {
  if (isDesktopLogViewOnlyMode()) {
    showToast('На компьютере журнал уловов работает в режиме просмотра. Запись уловов доступна на смартфонах и в приложении.', 'info');
    return;
  }
  const s = store.getState();
  const todayDt = new Date();
  todayDt.setHours(0, 0, 0, 0);
  const todayStr = formatLocalYYYYMMDD(todayDt);
  const initialDayIdx = prefill.dayIdx ?? s.dayIdx;
  const initialDateStr = prefill.date || s.weatherDays[initialDayIdx]?.date || todayStr;
  let activeDateStr = initialDateStr > todayStr ? todayStr : initialDateStr;
  let activeHour = prefill.hour ?? s.selectedHour;
  const targetFishId = prefill.fishId || s.fishId;
  const quickDates = [];
  for (let offset = 0; offset >= -5; offset--) {
    const dt = new Date(todayDt.getTime() + offset * 86400000);
    const dStr = formatLocalYYYYMMDD(dt);
    const title = offset === 0 ? 'Сегодня' : (offset === -1 ? 'Вчера' : (offset === -2 ? 'Позавчера' : `${Math.abs(offset)} дн. назад`));
    const shortLbl = `${RU.daysShort[dt.getDay()]}, ${dt.getDate()} ${RU.monthsGen[dt.getMonth()]}`;
    quickDates.push({ date: dStr, title, shortLbl });
  }
  let day = resolveDayWeatherForDate(s, activeDateStr, initialDayIdx);
  let hr = (day.hours && day.hours[activeHour]) || { hour: activeHour, tAir: day.tDay || 8, press: day.pressAvg || 754, wind: day.windMax || 3, windDir: 'З' };
  const currentFish = FISH_DB.find(f => f.id === targetFishId) || FISH_DB[0];
  const favSet = new Set(s.favorites || []);
  const sortedSpecies = [...FISH_DB]
    .filter(f => f.legal !== 'redbook' && isSpeciesInGeoRange(f, s.lat, s.lon, s.basinCode, s.water, 120, new Set(['small_river', 'big_river', 'quarry', 'tundra_lake', ...(s.isCoastal ? ['sea_gulf', 'open_sea'] : [])]), s.isCoastal, true, s.selectedWaterName))
    .sort((a, b) => (favSet.has(b.id) ? 1 : 0) - (favSet.has(a.id) ? 1 : 0));
  const compatibleMethods = getCompatibleMethods(currentFish, day.iceState || s.iceState, s.water, day.waterTemp);
  const currentMethodVal = compatibleMethods.some(m => m.val === (prefill.method || s.method)) ? (prefill.method || s.method) : compatibleMethods[0]?.val;
  const seasonalBaits = getSeasonalBaitsForContext(currentFish, currentMethodVal, day.waterTemp ?? 12, day.iceState || s.iceState);
  const defaultBait = prefill.bait || s.selectedBait || seasonalBaits[0];
  const availWaters = getAvailableWaterTypes(s.basinCode, s.lat, s.lon);
  const initialWaterName = prefill.waterName || s.selectedWaterName || (s.nearbyWaters && s.nearbyWaters[0]?.name) || WATER_PROFILES[s.water]?.shortName || 'Река / озеро';
  let photoDataUrl = prefill.photoDataUrl || '';
  const initialWeightVal = prefill.weightKg ? String(prefill.weightKg) : '';
  const initialLengthVal = prefill.lengthCm ? String(prefill.lengthCm) : '';

  // Сбор сохранённых закладок с вкладки «Карта» (s.savedSpots + тематические точки карты)
  const buildMapBookmarksList = (stateObj) => {
    const list = [];
    const seen = new Set();
    (Array.isArray(stateObj.savedSpots) ? stateObj.savedSpots : []).forEach(sp => {
      if (!sp || !Number.isFinite(Number(sp.lat)) || !Number.isFinite(Number(sp.lon))) return;
      const k = `${Number(sp.lat).toFixed(4)}_${Number(sp.lon).toFixed(4)}`;
      if (seen.has(k)) return;
      seen.add(k);
      list.push({
        id: sp.id || `bm_${k}`,
        name: sp.name || sp.selectedWaterName || 'Закладка на карте',
        waterName: sp.selectedWaterName || sp.name || '',
        lat: Number(sp.lat),
        lon: Number(sp.lon),
        depth: Number(sp.depth) || stateObj.depth || 3
      });
    });
    (Array.isArray(stateObj.circleItems) ? stateObj.circleItems : []).forEach(ci => {
      if (!ci || ci.t !== 'spot' || !Number.isFinite(Number(ci.lat)) || !Number.isFinite(Number(ci.lon))) return;
      const k = `${Number(ci.lat).toFixed(4)}_${Number(ci.lon).toFixed(4)}`;
      if (seen.has(k)) return;
      seen.add(k);
      list.push({
        id: ci.id || `bm_${k}`,
        name: ci.wn || ci.lb || 'Точка на карте',
        waterName: ci.wn || ci.lb || '',
        lat: Number(ci.lat),
        lon: Number(ci.lon),
        depth: Number(ci.dp) || stateObj.depth || 3
      });
    });
    return list;
  };
  const mapBookmarks = buildMapBookmarksList(s);

  const formatSummaryBanner = (dObj, hObj) => {
    const tAirStr = (hObj.tAir > 0 ? '+' + hObj.tAir : hObj.tAir) + '°C';
    return `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="4" stroke="#38bdf8" stroke-width="1.8"/></svg> <b>Метеосводка из кэша 10 км (${dObj.date}, ${String(hObj.hour).padStart(2, '0')}:00):</b> Воздух ${tAirStr} • Вода ~${dObj.waterTemp ?? 10}°C • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><polygon points="16,8 13.5,13.5 8,16 10.5,10.5" fill="#38bdf8" stroke="currentColor" stroke-width="1.3"/></svg> ${hObj.press} мм (Δ ${fmtDeltaPress(dObj.dP ?? 0)}) • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> ${hObj.windDir} ${hObj.wind} м/с • ${dObj.moon?.phaseIcon || '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" fill="#fbbf24" stroke="#f59e0b" stroke-width="1.6" stroke-linejoin="round"/></svg>'} ${dObj.moon?.moonDay || 12} л.д.`;
  };
  const html = `
    <div style="display:flex;flex-direction:column;gap:10px;font-size:var(--fs-sm);">
      <div id="cwWeatherSummaryBox" style="padding:9px 11px;border-radius:var(--r-sm);background:var(--card);border:1px solid var(--border);font-size:var(--fs-xs);color:var(--accent);line-height:1.4;">
        ${formatSummaryBanner(day, hr)}
      </div>

      <!-- 1. Блок выбора локации улова (На карте или Из закладок карты) -->
      <div id="cwLocationPickerBlock" style="padding:9px 11px;border-radius:var(--r-sm);background:var(--card);border:1px solid var(--border);display:flex;flex-direction:column;gap:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
          <label style="font-weight:800;font-size:var(--fs-xs);color:var(--accent);">
            <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z" fill="rgba(56,189,248,0.22)" stroke="#38bdf8" stroke-width="1.9"/><circle cx="12" cy="11" r="2.3" fill="#38bdf8"/></svg>
            ЛОКАЦИЯ УЛОВА (НА КАРТЕ ИЛИ ИЗ ЗАКЛАДОК):
          </label>
          <span id="cwCurrentLocBadge" style="font-size:11px;font-weight:800;color:var(--good);font-family:monospace;">
            ${escapeHtml(s.locLabel)} (${s.lat.toFixed(4)}°N, ${s.lon.toFixed(4)}°E)
          </span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;width:100%;">
          <button type="button" class="btn btn-sm btn-accent" id="cwPickOnMapBtn" style="min-height:38px;width:100%;justify-content:center;font-weight:800;">
            <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6z" fill="rgba(56,189,248,0.22)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 3v15M15 6v15" stroke="currentColor" stroke-width="1.5"/></svg>
            Выбрать на карте
          </button>
          <button type="button" class="btn btn-sm" id="cwQuickAddBookmarkBtn" style="min-height:38px;width:100%;justify-content:center;font-weight:800;">
            <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5-4.8-4.6 6.6-.9L12 2.5z" fill="#fbbf24" stroke="#f59e0b" stroke-width="1.6" stroke-linejoin="round"/></svg>
            + В закладки карты
          </button>
        </div>
        <div>
          <select id="cwBookmarkSelect" style="width:100%;min-height:38px;">
            <option value="">Выбрать сохранённую точку из закладок карты (${mapBookmarks.length})...</option>
            ${mapBookmarks.map((bm, idx) => `
              <option value="${idx}">${escapeHtml(bm.name)} (${bm.lat.toFixed(3)}°N, ${bm.lon.toFixed(3)}°E)</option>
            `).join('')}
          </select>
        </div>
      </div>

      <!-- 2. Дата улова: аккуратные горизонтальные плашки 2x3 + календарь -->
      <div style="padding:9px 11px;border-radius:var(--r-sm);background:var(--card);border:1px solid var(--border);">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
          <label for="cwDateInput" style="font-weight:800;font-size:var(--fs-xs);color:var(--accent);"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="16" rx="3" fill="rgba(56,189,248,0.14)" stroke="currentColor" stroke-width="1.8"/><path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><rect x="7" y="13" width="3" height="3" rx="0.8" fill="#38bdf8"/><rect x="14" y="13" width="3" height="3" rx="0.8" fill="#10b981"/></svg> ДАТА УЛОВА (ПЛАШКИ ДАТ ИЛИ КАЛЕНДАРЬ):</label>
          <input type="date" id="cwDateInput" class="input" value="${activeDateStr}" max="${todayStr}" style="max-width:165px;min-height:34px;padding:3px 8px;">
        </div>
        <div class="cw-date-plaques-grid" id="cwQuickDatesRow">
          ${quickDates.map(qd => `
            <button type="button" class="cw-date-plaque ${qd.date === activeDateStr ? 'active' : ''}" data-cw-quick-date="${qd.date}">
              <span style="font-weight:900;">${qd.title}</span>
              <span style="font-size:11px;opacity:0.85;">${qd.shortLbl}</span>
            </button>
          `).join('')}
        </div>
      </div>

      <div style="border-left:3px solid var(--accent);padding-left:8px;margin-bottom:2px;">
        <span style="font-size:var(--fs-xs);color:var(--muted);font-weight:700;">СТРОГАЯ ЦЕПОЧКА ПОИМКИ (УЧИТЫВАЕТСЯ В ПРОГНОЗЕ КЛЁВА):</span>
      </div>

      <!-- Шаг 1 без дублирующей кнопки ИИ-определителя (выбор фото с ИИ находится внизу формы) -->
      <div>
        <label for="cwFishId" style="display:block;font-weight:700;font-size:var(--fs-xs);color:var(--muted);">ШАГ 1. ПОЙМАННАЯ РЫБА (ИЗБРАННЫЕ ВВЕРХУ)</label>
        <select id="cwFishId" style="margin-top:3px;width:100%;">
          ${sortedSpecies.map(f => `<option value="${f.id}" ${f.id === currentFish.id ? 'selected' : ''}>${favSet.has(f.id) ? '★ ' : ''}${f.name}</option>`).join('')}
        </select>
      </div>

      <div>
        <label for="cwMethod" style="display:block;font-weight:700;font-size:var(--fs-xs);color:var(--muted);">ШАГ 2. СНАСТЬ (ПОДХОДЯЩАЯ ПОД РЫБУ)</label>
        <select id="cwMethod" style="margin-top:3px;width:100%;">
          ${compatibleMethods.map(m => `<option value="${m.val}" ${m.val === currentMethodVal ? 'selected' : ''}>${String(m.text || '').replace(/<[^>]+>/g, '').trim()}</option>`).join('')}
        </select>
      </div>

      <div>
        <label for="cwBaitSelect" style="display:block;font-weight:700;font-size:var(--fs-xs);color:var(--muted);">ШАГ 3. СЕЗОННАЯ НАЖИВКА / ПРИМАНКА</label>
        <select id="cwBaitSelect" style="margin-top:3px;width:100%;">
          ${seasonalBaits.map(b => `<option value="${b}" ${b === defaultBait ? 'selected' : ''}>${b}</option>`).join('')}
          <option value="__custom__">Свой вариант наживки / воблера...</option>
        </select>
        <input type="text" id="cwBaitCustom" class="input" value="${defaultBait}" placeholder="Уточните модель воблера, насадку или цвет..." style="margin-top:6px;width:100%;">
      </div>

      <!-- Шаг 4 и Шаг 5 выровнены на всю ширину без перекоса заголовков и без обрезания названий водоёмов и часов -->
      <div style="display:flex;flex-direction:column;gap:8px;padding:9px 11px;border-radius:var(--r-sm);background:var(--card);border:1px solid var(--border);">
        <div>
          <label for="cwWaterSelect" style="display:block;font-weight:700;font-size:var(--fs-xs);color:var(--muted);">ШАГ 4. БЛИЖАЙШИЙ ВОДОЁМ И ТОЧНОЕ НАЗВАНИЕ</label>
          <select id="cwWaterSelect" style="margin-top:3px;width:100%;">
            ${(s.nearbyWaters || []).map(w => `<option value="${w.name || w.label}" ${s.selectedWaterName === w.name ? 'selected' : ''}>${String(w.label || '').replace(/<[^>]+>/g, '').trim()}</option>`).join('')}
            ${availWaters.map(w => `<option value="${w.shortName}">${String(w.name || '').replace(/<[^>]+>/g, '').trim()}</option>`).join('')}
          </select>
          <input type="text" id="cwWaterName" class="input" value="${escapeHtml(initialWaterName)}" placeholder="Точное название реки, озера или протоки..." style="margin-top:6px;width:100%;">
        </div>
        <div>
          <label for="cwHour" style="display:block;font-weight:700;font-size:var(--fs-xs);color:var(--muted);">ШАГ 5. ЧАС ПОИМКИ (ПОЧАСОВОЙ КЭШ ПОГОДЫ)</label>
          <select id="cwHour" style="margin-top:3px;width:100%;">
            ${(day.hours || []).map(h => `<option value="${h.hour}" ${h.hour === activeHour ? 'selected' : ''}>${String(h.hour).padStart(2, '0')}:00 (${h.tAir > 0 ? '+' + h.tAir : h.tAir}°C, ${h.press} мм, ${h.wind} м/с)</option>`).join('')}
          </select>
        </div>
      </div>

      <!-- Вес и Длина в симметричной строке с выравниванием по нижнему краю (align-items: end), Совпадение с прогнозом — на всю ширину -->
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;align-items:end;">
        <div>
          <label for="cwWeight" style="display:block;font-weight:700;font-size:var(--fs-xs);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">ВЕС ТРОФЕЯ (КГ)</label>
          <input type="number" id="cwWeight" class="input" step="0.05" min="0" value="${initialWeightVal}" placeholder="Напр. 1.85" style="margin-top:3px;width:100%;">
        </div>
        <div>
          <label for="cwLength" style="display:block;font-weight:700;font-size:var(--fs-xs);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">ДЛИНА РЫБЫ (СМ)</label>
          <input type="number" id="cwLength" class="input" step="1" min="0" value="${initialLengthVal}" placeholder="Напр. 52" style="margin-top:3px;width:100%;">
        </div>
      </div>

      <div>
        <label for="cwMatch" style="display:block;font-weight:700;font-size:var(--fs-xs);color:var(--muted);">СОВПАДЕНИЕ С ПРОГНОЗОМ</label>
        <select id="cwMatch" style="margin-top:3px;width:100%;">
          <option value="yes" selected>Прогноз оправдался</option>
          <option value="no">Клёв вопреки прогнозу</option>
        </select>
      </div>

      <div id="cwPhotoSection" style="display:${(typeof document !== 'undefined' && (document.documentElement.getAttribute('data-tg-miniapp') === '1' || document.documentElement.getAttribute('data-tg-webapp') === '1')) ? 'none' : 'block'};">
        <label for="cwPhoto" style="display:block;font-weight:700;font-size:var(--fs-xs);color:var(--muted);">ФОТОГРАФИЯ УЛОВА (АВТО-РАСПОЗНАВАНИЕ ВИДА И ВЕСА ИИ)</label>
        <input type="file" id="cwPhoto" accept="image/*" class="input" style="margin-top:3px;padding:5px;width:100%;">
        <div id="cwPhotoPreviewRow" style="margin-top:6px;display:${photoDataUrl ? 'flex' : 'none'};align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;background:var(--card);border:1px solid var(--border);border-radius:8px;">
          <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1;">
            <img id="cwPhotoThumbImg" src="${photoDataUrl || ''}" alt="Превью" style="width:48px;height:48px;object-fit:cover;border-radius:6px;border:1px solid var(--border);flex-shrink:0;cursor:pointer;">
            <div style="font-size:11.5px;line-height:1.35;min-width:0;">
              <b style="color:var(--good);">Фото прикреплено к записи</b>
              <div style="font-size:10.5px;color:var(--muted);">EXIF и GPS очищены в целях приватности</div>
            </div>
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0;">
            <button type="button" class="btn btn-sm" id="cwViewAttachedPhotoBtn" style="min-height:30px;padding:2px 8px;font-size:11px;font-weight:800;">Посмотреть</button>
            <button type="button" class="btn btn-sm btn-accent" id="cwDownloadAttachedPhotoBtn" style="min-height:30px;padding:2px 8px;font-size:11px;font-weight:800;">Скачать</button>
          </div>
        </div>
        <div id="cwAiPhotoBadge" style="margin-top:6px;display:none;padding:10px 12px;border-radius:var(--r-sm);font-size:11.5px;line-height:1.45;"></div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(185px,1fr));gap:8px;margin-top:6px;">
        <button type="button" class="btn btn-good" id="cwSubmitBtn"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" fill="rgba(16,185,129,0.2)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M17 21v-8H7v8M7 3v5h8" stroke="currentColor" stroke-width="1.7"/></svg> Записать в журнал</button>
        <button type="button" class="btn btn-accent" id="cwSubmitAndChatBtn"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> Записать и отправить в чат</button>
      </div>
    </div>
  `;
  openModal('<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 20C5 11 11 5 20 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 4v7c0 1.7-1.3 3-3 3s-3-1.3-3-3" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/><circle cx="14" cy="16" r="2.2" fill="#10b981"/></svg> Запись улова «Я поймал» (календарь + 5-дневный кэш)', html, (bodyEl) => {
    const dateInput = bodyEl.querySelector('#cwDateInput');
    const summaryBox = bodyEl.querySelector('#cwWeatherSummaryBox');
    const hourSel = bodyEl.querySelector('#cwHour');
    const fishSel = bodyEl.querySelector('#cwFishId');
    const methodSel = bodyEl.querySelector('#cwMethod');
    const baitSel = bodyEl.querySelector('#cwBaitSelect');
    const baitCustom = bodyEl.querySelector('#cwBaitCustom');
    const waterSel = bodyEl.querySelector('#cwWaterSelect');
    const waterNameInput = bodyEl.querySelector('#cwWaterName');
    const locBadge = bodyEl.querySelector('#cwCurrentLocBadge');
    const bookmarkSel = bodyEl.querySelector('#cwBookmarkSelect');

    const syncDateAndHourWeather = (nextDateStr, nextHourVal) => {
      if (nextDateStr) activeDateStr = nextDateStr;
      if (Number.isFinite(nextHourVal)) activeHour = nextHourVal;
      day = resolveDayWeatherForDate(store.getState(), activeDateStr, initialDayIdx);
      hr = (day.hours && day.hours[activeHour]) || day.hours?.[12] || { hour: activeHour, tAir: day.tDay || 8, press: day.pressAvg || 754, wind: day.windMax || 3, windDir: 'З' };
      if (dateInput && dateInput.value !== activeDateStr) {
        dateInput.value = activeDateStr;
      }
      bodyEl.querySelectorAll('[data-cw-quick-date]').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-cw-quick-date') === activeDateStr);
      });
      if (hourSel && Array.isArray(day.hours)) {
        hourSel.innerHTML = day.hours.map(h =>
          `<option value="${h.hour}" ${h.hour === activeHour ? 'selected' : ''}>${String(h.hour).padStart(2, '0')}:00 (${h.tAir > 0 ? '+' + h.tAir : h.tAir}°C, ${h.press} мм, ${h.wind} м/с)</option>`
        ).join('');
      }
      if (summaryBox) {
        summaryBox.innerHTML = formatSummaryBanner(day, hr);
      }
    };

    // 1. Выбор точки на карте с возвратом в окно записи улова
    bodyEl.querySelector('#cwPickOnMapBtn')?.addEventListener('click', () => {
      const draft = {
        date: activeDateStr,
        dayIdx: initialDayIdx,
        hour: parseInt(hourSel?.value ?? activeHour, 10),
        fishId: fishSel?.value || currentFish.id,
        method: methodSel?.value || currentMethodVal,
        bait: baitCustom?.value || defaultBait,
        waterName: waterNameInput?.value || initialWaterName,
        weightKg: bodyEl.querySelector('#cwWeight')?.value || '',
        lengthCm: bodyEl.querySelector('#cwLength')?.value || '',
        photoDataUrl
      };
      if (typeof window !== 'undefined') {
        window.__KLEV_CATCH_WIZARD_PICK_SPOT__ = {
          active: true,
          prevRoute: store.getState().route || 'log',
          prefill: draft
        };
      }
      closeModal();
      router.navigate('geo');
      showToast('Нажмите на карту в месте поимки и нажмите «Подтвердить точку для улова»', 'info');
      flashHighlightElement(['#cwMapPickFloatingBanner', '#mapBox'], { scroll: true, block: 'center', delayMs: 120 });
    });

    // 2. Быстрое сохранение текущей точки в закладки карты прямо из окна записи улова
    bodyEl.querySelector('#cwQuickAddBookmarkBtn')?.addEventListener('click', async () => {
      const stNow = store.getState();
      const customTitle = (waterNameInput?.value || '').trim() || stNow.selectedWaterName || stNow.locLabel || 'Моя точка улова';
      const newSpot = {
        id: `spot_${Date.now()}`,
        name: `${stNow.locLabel} • ${customTitle}`,
        category: 'bite',
        lat: stNow.lat,
        lon: stNow.lon,
        water: stNow.water,
        selectedWaterName: customTitle,
        depth: stNow.depth,
        normPress: stNow.normPress
      };
      await storage.putToStore('spots', newSpot);
      const allSpots = await storage.getAllFromStore('spots');
      store.dispatch({ type: 'SET_SAVED_SPOTS', payload: allSpots });
      const refreshedList = buildMapBookmarksList(store.getState());
      mapBookmarks.length = 0;
      refreshedList.forEach(x => mapBookmarks.push(x));
      if (bookmarkSel) {
        bookmarkSel.innerHTML = `<option value="">Выбрать сохранённую точку из закладок карты (${mapBookmarks.length})...</option>` +
          mapBookmarks.map((bm, idx) => `<option value="${idx}" ${bm.id === newSpot.id ? 'selected' : ''}>${escapeHtml(bm.name)} (${bm.lat.toFixed(3)}°N, ${bm.lon.toFixed(3)}°E)</option>`).join('');
      }
      showToast(`Точка «${newSpot.name}» добавлена в закладки карты`, 'good');
    });

    // 3. Выбор сохранённой закладки из выпадающего списка
    if (bookmarkSel) {
      bookmarkSel.addEventListener('change', (e) => {
        const idx = parseInt(e.target.value, 10);
        const chosenBm = Number.isFinite(idx) ? mapBookmarks[idx] : null;
        if (!chosenBm) return;
        setLocation(chosenBm.lat, chosenBm.lon, true);
        const stAfter = store.getState();
        if (waterNameInput) {
          waterNameInput.value = chosenBm.waterName || chosenBm.name || stAfter.selectedWaterName || initialWaterName;
        }
        if (locBadge) {
          locBadge.textContent = `${stAfter.locLabel} (${chosenBm.lat.toFixed(4)}°N, ${chosenBm.lon.toFixed(4)}°E)`;
        }
        syncDateAndHourWeather(activeDateStr, activeHour);
        showToast(`Выбрана закладка: ${chosenBm.name}`, 'good');
      });
    }

    if (dateInput) {
      dateInput.addEventListener('change', (e) => {
        if (e.target.value) {
          syncDateAndHourWeather(e.target.value, activeHour);
        }
      });
    }
    bodyEl.querySelectorAll('[data-cw-quick-date]').forEach(btn => {
      btn.addEventListener('click', () => {
        const dStr = btn.getAttribute('data-cw-quick-date');
        if (dStr) syncDateAndHourWeather(dStr, activeHour);
      });
    });
    if (hourSel) {
      hourSel.addEventListener('change', (e) => {
        syncDateAndHourWeather(activeDateStr, parseInt(e.target.value, 10));
      });
    }
    if (fishSel) {
      fishSel.addEventListener('change', (e) => {
        const chosenId = e.target.value;
        const fObj = FISH_DB.find(x => x.id === chosenId) || FISH_DB[0];
        const newMethods = getCompatibleMethods(fObj, day.iceState || s.iceState, s.water, day.waterTemp);
        if (methodSel) {
          methodSel.innerHTML = newMethods.map(m => `<option value="${m.val}">${String(m.text || '').replace(/<[^>]+>/g, '').trim()}</option>`).join('');
          const mVal = newMethods[0]?.val;
          const newBaits = getSeasonalBaitsForContext(fObj, mVal, day.waterTemp ?? 12, day.iceState || s.iceState);
          if (baitSel) {
            baitSel.innerHTML = newBaits.map(b => `<option value="${b}">${b}</option>`).join('') + '<option value="__custom__">Свой вариант...</option>';
            if (baitCustom) baitCustom.value = newBaits[0] || '';
          }
        }
      });
    }
    if (methodSel) {
      methodSel.addEventListener('change', (e) => {
        const chosenMethod = e.target.value;
        const chosenFishId = fishSel?.value || currentFish.id;
        const fObj = FISH_DB.find(x => x.id === chosenFishId) || currentFish;
        const newBaits = getSeasonalBaitsForContext(fObj, chosenMethod, day.waterTemp ?? 12, day.iceState || s.iceState);
        if (baitSel) {
          baitSel.innerHTML = newBaits.map(b => `<option value="${b}">${b}</option>`).join('') + '<option value="__custom__">Свой вариант...</option>';
          if (baitCustom) baitCustom.value = newBaits[0] || '';
        }
      });
    }
    if (baitSel && baitCustom) {
      baitSel.addEventListener('change', (e) => {
        if (e.target.value !== '__custom__') {
          baitCustom.value = e.target.value;
        } else {
          baitCustom.value = '';
          baitCustom.focus();
        }
      });
    }
    if (waterSel && waterNameInput) {
      waterSel.addEventListener('change', (e) => {
        waterNameInput.value = e.target.value;
      });
    }
    let photoHash = '';
    const fileInput = bodyEl.querySelector('#cwPhoto');
    const aiBadgeEl = bodyEl.querySelector('#cwAiPhotoBadge');
    if (fileInput) {
      fileInput.addEventListener('click', () => requestAppCameraAndPhotoAccess());
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async () => {
          const rawUrl = String(reader.result || '');
          const sanitized = await sanitizeCatchPhotoAndComputeHash(rawUrl);
          photoDataUrl = sanitized.cleanDataUrl;
          photoHash = sanitized.dHash;
          const prevRow = bodyEl.querySelector('#cwPhotoPreviewRow');
          const prevThumb = bodyEl.querySelector('#cwPhotoThumbImg');
          if (prevRow && prevThumb) {
            prevThumb.src = photoDataUrl;
            prevRow.style.display = 'flex';
          }
          showToast('Фото прикреплено (EXIF скрыт). Выполняется ИИ-проверка вида...', 'good');
          try {
            const aiRes = await analyzeFishPhotoHybrid(photoDataUrl, {
              basinCode: s.basinCode,
              lat: s.lat,
              lon: s.lon
            });
            const top = aiRes?.topMatch;
            if (top && aiBadgeEl) {
              aiBadgeEl.style.display = 'block';
              const curSelectedFishId = fishSel?.value || currentFish.id;
              const curSelectedFishObj = FISH_DB.find(x => x.id === curSelectedFishId) || currentFish;
              const isDiffFromCurrent = (top.fishId !== curSelectedFishId);

              if (top.isRedBook) {
                aiBadgeEl.style.borderColor = 'var(--bad)';
                aiBadgeEl.style.background = 'rgba(239,68,68,0.12)';
                aiBadgeEl.innerHTML = `<b style="color:var(--bad);">ВНИМАНИЕ (ИИ ${top.confidence}%): ${escapeHtml(top.fish.name)} — КРАСНАЯ КНИГА!</b><br>Вид запрещён к изъятию (поймал — отпусти).`;
              } else if (isDiffFromCurrent) {
                // Если рыба на фото отличается от выбранной в форме: НЕ подставляем автоматически, а вежливо спрашиваем рыбака!
                aiBadgeEl.style.borderColor = 'var(--warn)';
                aiBadgeEl.style.background = 'rgba(245,158,11,0.12)';
                aiBadgeEl.innerHTML = `
                  <div style="display:flex;flex-direction:column;gap:6px;">
                    <div>
                      <b style="color:var(--warn);">Смотри, что определил ИИ по фото (${top.confidence}%):</b> <b>${escapeHtml(top.fish.name)}</b> (~${top.estimatedWeightKg} кг, ~${top.estimatedLengthCm} см).<br>
                      В настройках записи сейчас выбран <b>«${escapeHtml(curSelectedFishObj.name)}»</b>. Заменить рыбу для журнала?
                    </div>
                    <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-top:2px;">
                      <button type="button" class="btn btn-sm btn-good" id="cwApplyAiDetectedBtn" style="min-height:32px;font-weight:900;">Да, заменить на «${escapeHtml(top.fish.name)}»</button>
                      <button type="button" class="btn btn-sm" id="cwKeepCurrentFishBtn" style="min-height:32px;font-weight:800;">Нет, оставить «${escapeHtml(curSelectedFishObj.name)}»</button>
                    </div>
                  </div>
                `;
              } else {
                aiBadgeEl.style.borderColor = 'var(--good)';
                aiBadgeEl.style.background = 'rgba(16,185,129,0.12)';
                aiBadgeEl.innerHTML = `
                  <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
                    <span><b>ИИ подтвердил (${top.confidence}%):</b> ${escapeHtml(top.fish.name)} • ~${top.estimatedWeightKg} кг (~${top.estimatedLengthCm} см)</span>
                    <button type="button" class="btn btn-sm btn-good" id="cwApplyAiDetectedBtn" style="min-height:26px;padding:2px 8px;font-size:11px;">Подставить вес/длину</button>
                  </div>
                `;
              }

              // Подстановка выполняется ТОЛЬКО при явном нажатии кнопки пользователем!
              aiBadgeEl.querySelector('#cwApplyAiDetectedBtn')?.addEventListener('click', () => {
                if (fishSel) {
                  if (!Array.from(fishSel.options).some(o => o.value === top.fishId)) {
                    const opt = document.createElement('option');
                    opt.value = top.fishId;
                    opt.textContent = top.fish.name;
                    fishSel.prepend(opt);
                  }
                  fishSel.value = top.fishId;
                  fishSel.dispatchEvent(new Event('change'));
                }
                const wInp = bodyEl.querySelector('#cwWeight');
                const lInp = bodyEl.querySelector('#cwLength');
                if (wInp) wInp.value = String(top.estimatedWeightKg);
                if (lInp) lInp.value = String(top.estimatedLengthCm);
                aiBadgeEl.style.display = 'none';
                showToast(`Заменено на: ${top.fish.name} (${top.estimatedWeightKg} кг, ${top.estimatedLengthCm} см)`, 'good');
              });

              aiBadgeEl.querySelector('#cwKeepCurrentFishBtn')?.addEventListener('click', () => {
                aiBadgeEl.style.display = 'none';
                showToast(`Оставлен ваш выбор: ${curSelectedFishObj.name}`, 'info');
              });
            }
          } catch (err) {}
        };
        reader.readAsDataURL(file);
      });
    }
        const openAttachedViewer = () => {
      if (!photoDataUrl) return;
      const curFishObj = FISH_DB.find(x => x.id === (fishSel?.value || currentFish.id)) || currentFish;
      openCatchPhotoViewerModal({
        photoUrl: photoDataUrl,
        fishName: curFishObj.name || 'Улов',
        dateLabel: activeDateStr,
        weightKg: parseFloat(bodyEl.querySelector('#cwWeight')?.value) || 0,
        lengthCm: parseFloat(bodyEl.querySelector('#cwLength')?.value) || 0
      });
    };
    bodyEl.querySelector('#cwPhotoThumbImg')?.addEventListener('click', openAttachedViewer);
    bodyEl.querySelector('#cwViewAttachedPhotoBtn')?.addEventListener('click', openAttachedViewer);
    bodyEl.querySelector('#cwDownloadAttachedPhotoBtn')?.addEventListener('click', () => {
      if (!photoDataUrl) return;
      const curFishObj = FISH_DB.find(x => x.id === (fishSel?.value || currentFish.id)) || currentFish;
      downloadPhotoCrossPlatform(`klev_attached_${curFishObj.name}_${activeDateStr}.jpg`, photoDataUrl);
    });

    const saveWizardCatch = async () => {
      const chosenHr = parseInt(bodyEl.querySelector('#cwHour')?.value ?? activeHour, 10);
      const chosenDate = bodyEl.querySelector('#cwDateInput')?.value || activeDateStr;
      return await logCatch({
        date: chosenDate,
        dayIdx: initialDayIdx,
        hour: chosenHr,
        waterName: bodyEl.querySelector('#cwWaterName')?.value || '',
        fishId: bodyEl.querySelector('#cwFishId')?.value || currentFish.id,
        method: bodyEl.querySelector('#cwMethod')?.value || currentMethodVal,
        weightKg: bodyEl.querySelector('#cwWeight')?.value || 0,
        lengthCm: bodyEl.querySelector('#cwLength')?.value || 0,
        bait: bodyEl.querySelector('#cwBaitCustom')?.value || defaultBait,
        matchedForecast: bodyEl.querySelector('#cwMatch')?.value === 'yes',
        photoDataUrl: (typeof document !== 'undefined' && (document.documentElement.getAttribute('data-tg-miniapp') === '1' || document.documentElement.getAttribute('data-tg-webapp') === '1')) ? '' : photoDataUrl,
        photoHash: (typeof document !== 'undefined' && (document.documentElement.getAttribute('data-tg-miniapp') === '1' || document.documentElement.getAttribute('data-tg-webapp') === '1')) ? '' : photoHash
      });
    };
    const submitBtn = bodyEl.querySelector('#cwSubmitBtn');
    if (submitBtn) {
      submitBtn.addEventListener('click', async () => {
        await saveWizardCatch();
        closeModal();
      });
    }
    const submitChatBtn = bodyEl.querySelector('#cwSubmitAndChatBtn');
    if (submitChatBtn) {
      submitChatBtn.addEventListener('click', async () => {
        const savedRec = await saveWizardCatch();
        closeModal();
        if (savedRec) {
          events.emit('circle:shareCatchToChat', { catchObj: savedRec });
        }
      });
    }
  });
}
if (typeof window !== 'undefined') {
  window.__KLEV_OPEN_CATCH_WIZARD__ = openCatchWizard;
  window.__KLEV_RENDER_LOG__ = renderLog;
}
export function renderLog(container) {
  if (!container) return;
  const s = store.getState();
  const activeFish = FISH_DB.find(f => f.id === s.fishId) || FISH_DB[0];
  const allRecords = Array.isArray(s.catches) ? s.catches : [];
  const activeRecords = allRecords.filter(c => c && !c.markedForDeletion);
  const trashRecords = allRecords.filter(c => c && c.markedForDeletion);
  const filtered = getCatches(currentFilter);
  const isDesktopViewOnly = isDesktopLogViewOnlyMode();
  if (isDesktopViewOnly && activeLogTab === 'trash') {
    activeLogTab = 'active';
  }
  const statsAll = getPersonalStats('all');
  const statsFish = getPersonalStats(activeFish.id);
  container.innerHTML = `
    <div class="card">
      <div class="section-head">
        <div>
          <span class="section-title"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="5" y="3" width="14" height="18" rx="2.5" fill="rgba(56,189,248,0.16)" stroke="currentColor" stroke-width="1.8"/><path d="M9 7h6M9 11h6M9 15h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> Журнал уловов и личная калибровка прогноза</span>

        </div>
        <div class="toolbar-row" style="display:flex;gap:6px;flex-wrap:wrap;">
          <button type="button" class="btn btn-sm btn-good" id="logOpenWizardBtn"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 20C5 11 11 5 20 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 4v7c0 1.7-1.3 3-3 3s-3-1.3-3-3" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/><circle cx="14" cy="16" r="2.2" fill="#10b981"/></svg> + Записать улов</button>
          <button type="button" class="btn btn-sm btn-accent" id="logOpenAiScannerBtn" title="Определить вид рыбы и вес по фотографии"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 8V6a2 2 0 0 1 2-2h2M4 16v2a2 2 0 0 0 2 2h2m8-16h2a2 2 0 0 1 2 2v2m-4 12h2a2 2 0 0 0 2-2v-2" stroke="#38bdf8" stroke-width="1.9" stroke-linecap="round"/><path d="M6 12s2.5-3.8 6.5-3.8c2.6 0 4.5 1.5 5.5 3.8-1 2.3-2.9 3.8-5.5 3.8-4 0-6.5-3.8-6.5-3.8z" fill="rgba(16,185,129,0.28)" stroke="#10b981" stroke-width="1.7"/></svg> По фото (ИИ)</button>
          <button type="button" class="btn btn-sm" id="logBlankTripBtn" style="border-color:var(--warn);color:var(--warn);" title="Если рыбалка прошла без поклёвок — нажмите, чтобы алгоритм учёл бесклёвье при этой погоде"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="4.5" stroke="#38bdf8" stroke-width="1.6"/><circle cx="12" cy="12" r="1.8" fill="#10b981"/></svg> Выезд без улова (0 поклёвок)</button>
          <button type="button" class="btn btn-sm" id="logExportJsonBtn" title="Сохранить полный архив Журнала (с фотографиями) и всех личных точек карты в .JSON"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 15V3m0 0L8 7m4-4l4 4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg> Сохранить архив (.JSON с фото и точками)</button>
          <button type="button" class="btn btn-sm" id="logExportCsvBtn" title="Выгрузить таблицу уловов в .CSV (для Excel)"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M3 3v18h18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M7 15l4-5 4 3 5-7" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg> .CSV</button>
          <label class="btn btn-sm btn-accent" id="logImportFileLabel" style="cursor:pointer;margin:0;" title="Загрузить записи уловов из файла .JSON или .CSV">
            <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg> Загрузить с устройства
            <input type="file" id="logImportFileInput" accept=".json,.csv,application/json,text/csv,*/*" style="display:none;">
          </label>
        </div>
      </div>
      <!-- Переключатель: Основной журнал vs Помеченные на удаление (защита от случайного удаления) -->
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;padding:8px 10px;background:var(--card);border:1px solid var(--border);border-radius:var(--r-sm);">
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button type="button" class="btn btn-sm ${activeLogTab === 'active' ? 'btn-accent' : ''}" id="logTabActiveBtn">
            <svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="5" y="3" width="14" height="18" rx="2.5" fill="rgba(56,189,248,0.16)" stroke="currentColor" stroke-width="1.8"/><path d="M9 7h6M9 11h6M9 15h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> Активные записи (${activeRecords.length})
          </button>
          <button type="button" class="btn btn-sm ${activeLogTab === 'trash' ? 'btn-accent' : ''}" id="logTabTrashBtn" style="${trashRecords.length > 0 ? 'border-color:var(--warn);color:var(--warn);' : ''}">
            <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Помеченные на удаление (${trashRecords.length})
          </button>
        </div>
        ${activeLogTab === 'trash' && trashRecords.length > 0 ? `
          <button type="button" class="btn btn-sm" id="logPurgeAllTrashBtn" style="color:var(--bad);border-color:rgba(239,68,68,0.45);">
            <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Удалить все помеченные навсегда
          </button>
        ` : ''}
      </div>
      ${activeLogTab === 'trash' ? `
        <div style="padding:10px 12px;margin-bottom:10px;background:rgba(245,158,11,0.10);border:1px solid var(--warn);border-radius:var(--r-sm);font-size:var(--fs-xs);color:var(--text);line-height:1.42;">
          <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2.5l7 3.2v5.8c0 5-3 9.3-7 10.8-4-1.5-7-5.8-7-10.8V5.7l7-3.2z" fill="rgba(56,189,248,0.22)" stroke="#38bdf8" stroke-width="1.8" stroke-linejoin="round"/></svg> <b>Защита от случайного удаления:</b> помеченные записи хранятся здесь до вашего подтверждения. Вы можете вернуть любую запись обратно в журнал или окончательно удалить её (вместе с публикацией в «Круге»).
        </div>
        ${trashRecords.length === 0 ? `
          <div style="padding:18px;text-align:center;background:var(--card);border:1px dashed var(--border);border-radius:var(--r-sm);color:var(--muted);font-size:var(--fs-sm);">
            В разделе «Помеченные на удаление» сейчас пусто.
          </div>
        ` : `
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(265px,1fr));gap:10px;">
            ${trashRecords.map(c => `
              <div class="card" style="background:var(--card);padding:10px 12px;border:1.5px dashed var(--warn);display:flex;flex-direction:column;gap:6px;">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
                  <span style="font-weight:800;font-size:var(--fs-md);color:var(--warn);"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> ${escapeHtml(c.fishName)} ${c.weightKg ? `• ${c.weightKg} кг` : ''}</span>
                  <span class="pill pill-warn" style="font-size:10px;">На удаление</span>
                </div>
                <div style="font-size:var(--fs-xs);color:var(--muted);">
                  <svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="16" rx="3" fill="rgba(56,189,248,0.14)" stroke="currentColor" stroke-width="1.8"/><path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><rect x="7" y="13" width="3" height="3" rx="0.8" fill="#38bdf8"/><rect x="14" y="13" width="3" height="3" rx="0.8" fill="#10b981"/></svg> ${escapeHtml(c.dateLabel || c.date)}, ${String(c.hour ?? 12).padStart(2, '0')}:00 • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z" fill="rgba(239,68,68,0.22)" stroke="#ef4444" stroke-width="1.9"/><circle cx="12" cy="11" r="2.3" fill="#ef4444"/></svg> ${escapeHtml(c.locLabel || 'Водоём')}
                </div>
                <div style="font-size:var(--fs-xs);color:var(--accent);">Наживка / приманка: <b>${escapeHtml(c.bait || '—')}</b></div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;">
                  <button type="button" class="btn btn-sm btn-good" data-restore-catch="${c.id}" style="flex:1;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M9 14L4 9l5-5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg> Восстановить</button>
                  <button type="button" class="btn btn-sm" data-purge-catch="${c.id}" style="flex:1;color:var(--bad);border-color:var(--bad);"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Удалить навсегда</button>
                </div>
              </div>
            `).join('')}
          </div>
        `}
      ` : `
        <div class="bento-metrics-grid" style="margin-bottom:12px;">
          <div class="bento-metric-tile" style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:12px 10px;gap:4px;">
            <div class="bento-metric-val" style="color:var(--good);font-size:19px;font-weight:900;">
              ${statsAll.matchRate !== null ? `${statsAll.matchRate}%` : `${statsAll.successCount} / ${statsAll.blankCount}`}
            </div>
            <div class="bento-metric-sub" style="font-size:11.5px;font-weight:800;color:var(--muted);">
              Уловов: <b>${statsAll.successCount}</b> • Пустых: <b>${statsAll.blankCount}</b>
            </div>
          </div>
          <div class="bento-metric-tile" style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:12px 10px;gap:4px;">
            <div class="bento-metric-val" style="font-size:17px;font-weight:900;color:var(--accent);">
              ${statsFish.count ? `~${statsFish.avgPress} мм • ~${statsFish.avgWaterTemp}°` : activeFish.name}
            </div>
            <div class="bento-metric-sub" style="font-size:11.5px;font-weight:800;color:var(--muted);">
              ${statsFish.count ? escapeHtml(activeFish.name) : 'Нет записей по рыбе'}
            </div>
          </div>
          <div class="bento-metric-tile" style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:12px 10px;gap:4px;">
            <div class="bento-metric-val" style="font-size:14px;font-weight:900;color:#fbbf24;line-height:1.3;">
              ${statsAll.top3Baits.length > 0 ? statsAll.top3Baits.join(' • ') : 'Приманки'}
            </div>
            <div class="bento-metric-sub" style="font-size:11.5px;font-weight:800;color:var(--muted);">
              ${statsAll.top3Baits.length > 0 ? 'Топ-3 по уловам' : 'Нет данных'}
            </div>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
          <select id="logFilterFish" style="max-width:220px;">
            <option value="all" ${currentFilter.fishId === 'all' ? 'selected' : ''}>Все рыбы (${activeRecords.length})</option>
            ${FISH_DB.filter(f => activeRecords.some(c => c.fishId === f.id)).map(f => `
              <option value="${f.id}" ${currentFilter.fishId === f.id ? 'selected' : ''}>${f.name}</option>
            `).join('')}
          </select>
          <select id="logFilterCond" style="max-width:240px;">
            <option value="all" ${currentFilter.cond === 'all' ? 'selected' : ''}>Любая погода</option>
            <option value="press_drop" ${currentFilter.cond === 'press_drop' ? 'selected' : ''}>Падение давления (Δ < −1 мм)</option>
            <option value="full_moon" ${currentFilter.cond === 'full_moon' ? 'selected' : ''}>Полнолуние (14–17 л.д.)</option>
            <option value="wind_strong" ${currentFilter.cond === 'wind_strong' ? 'selected' : ''}>Свежий ветер (> 5 м/с)</option>
          </select>
        </div>
        ${filtered.length === 0 ? `
          <div style="padding:16px;text-align:center;background:var(--card);border-radius:var(--r-sm);color:var(--muted);font-size:var(--fs-sm);">
            Записей пока нет. Нажмите <b>«<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 20C5 11 11 5 20 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 4v7c0 1.7-1.3 3-3 3s-3-1.3-3-3" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/><circle cx="14" cy="16" r="2.2" fill="#10b981"/></svg> + Записать улов»</b>, чтобы выбрать дату за последние 5 дней (или сегодня) — почасовой прогноз подставится автоматически!
          </div>
        ` : `
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(265px,1fr));gap:10px;">
            ${filtered.map(c => `
              <div class="card" style="background:var(--card);padding:10px 12px;display:flex;flex-direction:column;gap:5px;">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
                  <span style="font-weight:800;font-size:var(--fs-md);">${escapeHtml(c.fishName)} ${c.weightKg ? `• ${c.weightKg} кг` : ''} ${c.lengthCm ? `(${c.lengthCm} см)` : ''}</span>
                  <div style="display:flex;gap:4px;flex-wrap:wrap;">
                    <button type="button" class="btn btn-sm btn-good" style="min-height:28px;padding:2px 8px;" data-apply-catch-rig="${c.id}" title="Повторить снасть: подставить рыбу, способ ловли, глубину и приманку в прогноз"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 20C5 11 11 5 20 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 4v7c0 1.7-1.3 3-3 3s-3-1.3-3-3" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/><circle cx="14" cy="16" r="2.2" fill="#10b981"/></svg> Снасть</button>
                    <button type="button" class="btn btn-sm btn-accent" style="min-height:28px;padding:2px 8px;" data-chat-share-catch="${c.id}" title="Поделиться карточкой улова в чате Экипажа или личном диалоге"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> В чат</button>
                    <button type="button" class="btn btn-sm" style="min-height:28px;padding:2px 8px;" data-share-catch="${c.id}" title="Отправить улов в Круг с размытием координат ±5 км"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3.5" fill="rgba(56,189,248,0.25)" stroke="currentColor" stroke-width="1.8"/><path d="M3 19c0-3.2 2.7-5.5 6-5.5s6 2.3 6 5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="17" cy="9" r="2.8" stroke="currentColor" stroke-width="1.6"/><path d="M16 14c2.6.3 4.8 2 5 4.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg> В Круг</button>
                    <button type="button" class="btn btn-sm" style="min-height:28px;padding:2px 7px;color:var(--bad);" data-del-catch="${c.id}" title="Пометить на удаление" aria-label="Пометить запись на удаление"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
                  </div>
                </div>
                <div style="font-size:var(--fs-xs);color:var(--muted);">
                  <svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="16" rx="3" fill="rgba(56,189,248,0.14)" stroke="currentColor" stroke-width="1.8"/><path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><rect x="7" y="13" width="3" height="3" rx="0.8" fill="#38bdf8"/><rect x="14" y="13" width="3" height="3" rx="0.8" fill="#10b981"/></svg> ${escapeHtml(c.dateLabel || c.date)}, ${String(c.hour ?? 12).padStart(2, '0')}:00 • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z" fill="rgba(239,68,68,0.22)" stroke="#ef4444" stroke-width="1.9"/><circle cx="12" cy="11" r="2.3" fill="#ef4444"/></svg> ${escapeHtml(c.locLabel || 'Водоём')} (${c.depth} м)
                </div>
                <div style="display:flex;gap:4px;flex-wrap:wrap;">
                  ${createPill({ text: `Вода ${c.waterTemp}°C`, tone: 'neutral' })}
                  ${createPill({ text: `${c.press} мм (Δ${c.dP})`, tone: 'neutral' })}
                  ${createPill({ text: `${c.windDir} ${c.wind} м/с`, tone: 'neutral' })}
                  ${createPill({ text: c.matchedForecast ? '<svg class="k-ico" style="color:var(--good);" viewBox="0 0 24 24" fill="none"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" fill="rgba(16,185,129,0.22)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> Совпал' : '<svg class="k-ico" style="color:var(--warn);" viewBox="0 0 24 24" fill="none"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3" fill="rgba(245,158,11,0.22)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> Вопреки', tone: c.matchedForecast ? 'good' : 'warn' })}
                </div>
                <div style="font-size:var(--fs-xs);color:var(--accent);">Наживка / приманка: <b>${escapeHtml(c.bait)}</b></div>
                ${(c.photoDataUrl && /^data:image\/(jpeg|png|webp);base64,/i.test(c.photoDataUrl)) ? `
                  <div style="display:flex;flex-direction:column;gap:6px;margin-top:4px;">
                    <div style="position:relative;cursor:pointer;overflow:hidden;border-radius:8px;border:1px solid var(--border);background:#050811;" data-view-catch-photo="${c.id}" title="Нажмите для полноэкранного просмотра фото">
                      <img src="${c.photoDataUrl}" alt="Улов ${escapeHtml(c.fishName)}" style="width:100%;max-height:150px;object-fit:cover;display:block;">
                    </div>
                    <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;">
                      <button type="button" class="btn btn-sm" data-view-catch-photo="${c.id}" style="min-height:30px;padding:3px 8px;font-size:11px;font-weight:800;">
                        <svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="2"/><path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> Посмотреть фото
                      </button>
                      <button type="button" class="btn btn-sm btn-accent" data-download-catch-photo="${c.id}" style="min-height:30px;padding:3px 8px;font-size:11px;font-weight:800;">
                        <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 15V3m0 0L8 7m4-4l4 4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg> Скачать фото
                      </button>
                    </div>
                  </div>
                ` : ''}
              </div>
            `).join('')}
          </div>
        `}
      `}
    </div>
  `;
  bindLogEvents(container);
}
function bindLogEvents(container) {
  const openBtn = container.querySelector('#logOpenWizardBtn');
  if (openBtn) openBtn.addEventListener('click', () => openCatchWizard());
  const aiScanBtn = container.querySelector('#logOpenAiScannerBtn');
  if (aiScanBtn) aiScanBtn.addEventListener('click', () => openFishPhotoScannerModal());
  const blankBtn = container.querySelector('#logBlankTripBtn');
  if (blankBtn) blankBtn.addEventListener('click', () => logBlankTrip());
  container.querySelector('#logTabActiveBtn')?.addEventListener('click', () => {
    activeLogTab = 'active';
    renderLog(container);
  });
  container.querySelector('#logTabTrashBtn')?.addEventListener('click', () => {
    activeLogTab = 'trash';
    renderLog(container);
  });
  container.querySelector('#logPurgeAllTrashBtn')?.addEventListener('click', () => {
    const trashList = (store.getState().catches || []).filter(c => c && c.markedForDeletion);
    if (!trashList.length) return;
    openConfirmDeleteModal({
      title: '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Очистить «Помеченные на удаление»?',
      message: `Вы действительно хотите безвозвратно удалить все помеченные записи (${trashList.length} шт.) из журнала уловов?`,
      confirmLabel: `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Удалить все (${trashList.length})`,
      extraCheckboxLabel: 'Также удалить связанные с этими уловами публикации из «Круга» и с карты',
      extraCheckboxDefault: true,
      onConfirm: async (removeCircle) => {
        for (const item of trashList) {
          await deleteCatch(item.id, removeCircle);
        }
        activeLogTab = 'active';
        showToast(' Все помеченные записи окончательно удалены', 'info');
        renderLog(container);
      }
    });
  });
  const expBtn = container.querySelector('#logExportJsonBtn');
  if (expBtn) {
    expBtn.addEventListener('click', () => {
      const sNow = store.getState();
      const fullBackup = storage.exportFullProfileBackup(sNow);
      const cCount = fullBackup.summary?.catchesCount || 0;
      const pCount = fullBackup.summary?.catchesWithPhotoCount || 0;
      const spCount = (fullBackup.summary?.savedSpotsCount || 0) + (fullBackup.summary?.personalMapPointsCount || 0);
      const fname = `klev-pro-backup-full-${new Date().toISOString().slice(0, 10)}.json`;
      downloadFileCrossPlatform(fname, JSON.stringify(fullBackup, null, 2), 'application/json;charset=utf-8');
      showToast(`Сохранён полный архив: уловов ${cCount} (с фото: ${pCount}), личных точек/слипов: ${spCount}`, 'good');
    });
  }
  const expCsvBtn = container.querySelector('#logExportCsvBtn');
  if (expCsvBtn) {
    expCsvBtn.addEventListener('click', () => {
      const list = (store.getState().catches || []).filter(c => c && !c.markedForDeletion);
      const header = ['date', 'hour', 'fishId', 'fishName', 'weightKg', 'lengthCm', 'locLabel', 'waterName', 'depth', 'method', 'bait', 'tAir', 'waterTemp', 'press', 'wind', 'matchedForecast'];
      const rows = list.map(c => header.map(k => `"${String(c[k] ?? '').replace(/"/g, '""')}"`).join(','));
      const csv = '\uFEFF' + header.join(',') + '\n' + rows.join('\n');
      const fname = `klev-pro-catches-${new Date().toISOString().slice(0, 10)}.csv`;
      downloadFileCrossPlatform(fname, csv, 'text/csv;charset=utf-8');
      showToast(` Таблица уловов (${list.length} зап.) сохранена в файл ${fname}`, 'good');
    });
  }
  const impLogInput = container.querySelector('#logImportFileInput');
  if (impLogInput) {
    impLogInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const text = String(reader.result || '').trim();
          let incoming = [];
          let restoredSpotsCount = 0;
          let restoredRoutesCount = 0;
          if (text.startsWith('[') || text.startsWith('{')) {
            const parsed = JSON.parse(text);
            if (parsed && !Array.isArray(parsed) && (parsed.schema === 'KlevProFullBackup_v3' || parsed.schema === 'KlevProProfileBackup_v2' || Array.isArray(parsed.savedSpots) || Array.isArray(parsed.personalMapPoints))) {
              await storage.importFullProfileBackup(parsed, true);
              const allSpots = await storage.getAllFromStore('spots');
              if (Array.isArray(allSpots) && allSpots.length > 0) {
                store.dispatch({ type: 'SET_SAVED_SPOTS', payload: allSpots });
                restoredSpotsCount += allSpots.length;
              }
              const allCir = storage.loadCircleItems();
              if (Array.isArray(allCir) && allCir.length > 0) {
                store.dispatch({ type: 'SET_CIRCLE_ITEMS', payload: allCir });
                restoredSpotsCount += allCir.filter(x => x && x.t === 'spot').length;
              }
              if (Array.isArray(parsed.savedRoutes)) {
                restoredRoutesCount = parsed.savedRoutes.length;
              }
              if (Array.isArray(parsed.favorites) && parsed.favorites.length > 0) {
                store.dispatch({ type: 'SET_FAVORITES', payload: parsed.favorites });
              }
            }
            incoming = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.catches) ? parsed.catches : (Array.isArray(parsed?.data?.catches) ? parsed.data.catches : []));
          } else {
            const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
            if (lines.length > 1) {
              const cols = lines[0].split(',').map(s => s.replace(/^"|"$/g, '').trim());
              for (let i = 1; i < lines.length; i++) {
                const vals = lines[i].match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g) || [];
                const obj = {};
                cols.forEach((colName, idx) => {
                  obj[colName] = (vals[idx] || '').replace(/^"|"$/g, '').replace(/""/g, '"').trim();
                });
                if (obj.fishId || obj.fishName) {
                  incoming.push({
                    id: `catch_csv_${Date.now()}_${i}`,
                    date: obj.date || formatLocalYYYYMMDD(new Date()),
                    hour: parseInt(obj.hour, 10) || 12,
                    fishId: obj.fishId || 'pike',
                    fishName: obj.fishName || 'Рыба',
                    weightKg: parseFloat(obj.weightKg) || 0,
                    lengthCm: parseFloat(obj.lengthCm) || 0,
                    locLabel: obj.locLabel || '',
                    waterName: obj.waterName || '',
                    depth: parseFloat(obj.depth) || 2.0,
                    method: obj.method || 'spin_jig',
                    bait: obj.bait || '',
                    tAir: parseFloat(obj.tAir) || 10,
                    waterTemp: parseFloat(obj.waterTemp) || 10,
                    press: parseFloat(obj.press) || 754,
                    wind: parseFloat(obj.wind) || 3,
                    matchedForecast: obj.matchedForecast !== 'false',
                    timestamp: Date.now()
                  });
                }
              }
            }
          }
          let addedCount = 0;
          for (const rec of incoming) {
            if (rec && (rec.fishId || rec.fishName)) {
              const cleanRec = {
                ...rec,
                id: rec.id || `catch_imp_${Date.now()}_${addedCount}`,
                timestamp: rec.timestamp || Date.now()
              };
              await storage.putToStore('catches', cleanRec);
              addedCount++;
            }
          }
          if (addedCount > 0 || restoredSpotsCount > 0 || restoredRoutesCount > 0) {
            const all = await storage.getAllFromStore('catches');
            store.dispatch({ type: 'SET_CATCHES', payload: all });
            const photosRestored = (all || []).filter(c => c && c.photoDataUrl).length;
            renderLog(container);
            showToast(`Загружено с устройства: уловов ${addedCount} шт. (с фото: ${photosRestored}), точек/слипов: ${restoredSpotsCount}, маршрутов: ${restoredRoutesCount}`, 'good');
          } else {
            showToast('Не найдено записей уловов или точек в выбранном файле (.JSON / .CSV)', 'warn');
          }
        } catch (err) {
          showToast('Ошибка чтения файла журнала уловов', 'bad');
        }
        impLogInput.value = '';
      };
      reader.readAsText(file);
    });
  }
  const fFish = container.querySelector('#logFilterFish');
  if (fFish) {
    fFish.addEventListener('change', (e) => {
      currentFilter.fishId = e.target.value;
      renderLog(container);
    });
  }
  const fCond = container.querySelector('#logFilterCond');
  if (fCond) {
    fCond.addEventListener('change', (e) => {
      currentFilter.cond = e.target.value;
      renderLog(container);
    });
  }
  container.querySelectorAll('[data-apply-catch-rig]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-apply-catch-rig');
      const cObj = (store.getState().catches || []).find(x => x && x.id === id);
      if (cObj) {
        if (cObj.fishId) store.dispatch({ type: 'SET_FISH', payload: cObj.fishId });
        if (cObj.method) store.dispatch({ type: 'SET_METHOD', payload: cObj.method });
        if (cObj.bait) store.dispatch({ type: 'SET_BAIT', payload: cObj.bait });
        if (Number.isFinite(Number(cObj.depth))) store.dispatch({ type: 'SET_DEPTH', payload: Number(cObj.depth) });
        showToast(` Применена рабочая снасть из журнала для «${cObj.fishName}»!`, 'good');
        if (typeof window !== 'undefined' && typeof window.__KLEV_NAVIGATE_SECTION__ === 'function') {
          window.__KLEV_NAVIGATE_SECTION__('forecast');
        }
        flashHighlightElement(['#fcTackleControlsCard', '#bentoSwipeHeroCard', '.bento-tackle-summary', '.bento-tackle-rec'], {
          scroll: true,
          block: 'center',
          delayMs: 120
        });
      }
    });
  });
  container.querySelectorAll('[data-chat-share-catch]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-chat-share-catch');
      const cObj = (store.getState().catches || []).find(x => x.id === id);
      if (cObj) {
        events.emit('circle:shareCatchToChat', { catchObj: cObj });
      }
    });
  });
  container.querySelectorAll('[data-share-catch]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-share-catch');
      const cObj = (store.getState().catches || []).find(x => x.id === id);
      if (cObj) {
        events.emit('circle:openShareModal', { mode: 'circle', catchObj: cObj });
      }
    });
  });
  container.querySelectorAll('[data-download-catch-photo]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-download-catch-photo');
      const cObj = (store.getState().catches || []).find(x => x.id === id);
      if (cObj && cObj.photoDataUrl) {
        const safeFish = (cObj.fishName || 'улов').replace(/[^0-9A-Za-zА-Яа-я_-]/g, '_').toLowerCase();
        const safeDate = (cObj.date || 'photo').replace(/[^0-9A-Za-zА-Яа-я_-]/g, '_');
        downloadPhotoCrossPlatform(`klev_catch_${safeFish}_${safeDate}.jpg`, cObj.photoDataUrl);
      }
    });
  });
  container.querySelectorAll('[data-view-catch-photo]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = el.getAttribute('data-view-catch-photo');
      const cObj = (store.getState().catches || []).find(x => x.id === id);
      if (cObj && cObj.photoDataUrl) {
        openCatchPhotoViewerModal({
          photoUrl: cObj.photoDataUrl,
          fishName: cObj.fishName || 'Улов',
          dateLabel: cObj.dateLabel || cObj.date || '',
          weightKg: cObj.weightKg || 0,
          lengthCm: cObj.lengthCm || 0
        });
      }
    });
  });
  container.querySelectorAll('[data-del-catch]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-del-catch');
      const cObj = (store.getState().catches || []).find(x => x && x.id === id);
      if (!cObj) return;
      openConfirmDeleteModal({
        title: '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Пометить улов на удаление?',
        message: `Запись «${escapeHtml(cObj.fishName)}${cObj.weightKg ? ' (' + cObj.weightKg + ' кг)' : ''}» будет перемещена в раздел «Помеченные на удаление», откуда её можно восстановить или удалить навсегда.`,
        confirmLabel: '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> В помеченные на удаление',
        extraCheckboxLabel: 'Также сразу удалить связанную публикацию из «Круга» и с карты (если вы делились этим уловом)',
        extraCheckboxDefault: true,
        onConfirm: async (removeShared) => {
          await markCatchForDeletion(id, removeShared);
        }
      });
    });
  });
  container.querySelectorAll('[data-restore-catch]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-restore-catch');
      if (id) await restoreCatchFromTrash(id);
    });
  });
  container.querySelectorAll('[data-purge-catch]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-purge-catch');
      const cObj = (store.getState().catches || []).find(x => x && x.id === id);
      if (!cObj) return;
      openConfirmDeleteModal({
        title: '<svg class="k-ico" style="color:var(--warn);" viewBox="0 0 24 24" fill="none"><path d="M12 3L2.5 19.5h19L12 3z" fill="rgba(245,158,11,0.24)" stroke="#f59e0b" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 9v5M12 17h.01" stroke="#fbbf24" stroke-width="2" stroke-linecap="round"/></svg> Удалить запись об улове навсегда?',
        message: `Запись «${escapeHtml(cObj.fishName)}${cObj.weightKg ? ' (' + cObj.weightKg + ' кг)' : ''}» будет окончательно удалена без возможности восстановления.`,
        confirmLabel: '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Удалить навсегда',
        extraCheckboxLabel: 'Также удалить связанную публикацию из «Круга» и с карты',
        extraCheckboxDefault: true,
        onConfirm: async (removeShared) => {
          await deleteCatch(id, removeShared);
          showToast(' Запись окончательно удалена из журнала', 'info');
        }
      });
    });
  });
}
export function render(container) {
  renderLog(container);
}
let unsub = null;
let unsubEvent = null;
export async function init(container) {
  if (typeof window !== 'undefined') {
    window.__KLEV_OPEN_CATCH_WIZARD__ = openCatchWizard;
  window.__KLEV_RENDER_LOG__ = renderLog;
  }
  const localCatches = storage.getLocalBackup ? storage.getLocalBackup('catches') : [];
  if (Array.isArray(localCatches) && localCatches.length > 0) {
    localCatches.sort((a, b) => b.timestamp - a.timestamp);
    store.dispatch({ type: 'SET_CATCHES', payload: localCatches });
  }
  render(container);
  if (unsub) unsub();
  unsub = store.subscribe(
    s => ({ route: s.route, catches: s.catches, fishId: s.fishId }),
    (next) => {
      if (next.route && next.route !== 'log') {
        if (container) container._logNeedsRender = true;
        return;
      }
      if (container) container._logNeedsRender = false;
      render(container);
    }
  );
  if (unsubEvent) unsubEvent();
  unsubEvent = events.on('forecast:hourSelected', (payload) => {
    openCatchWizard(payload);
  });
  try {
    const idbCatches = await storage.getAllFromStore('catches');
    const backupCatches = storage.getLocalBackup ? storage.getLocalBackup('catches') : [];
    const mergedMap = new Map();
    for (const c of (Array.isArray(backupCatches) ? backupCatches : [])) {
      if (c && c.id) mergedMap.set(c.id, c);
    }
    const idbSet = new Set();
    for (const c of (Array.isArray(idbCatches) ? idbCatches : [])) {
      if (c && c.id) {
        idbSet.add(c.id);
        mergedMap.set(c.id, c);
      }
    }
    const mergedAll = Array.from(mergedMap.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    for (const c of mergedAll) {
      if (c && c.id && !idbSet.has(c.id)) {
        try { await storage.putToStore('catches', c); } catch (err) {}
      }
    }
    store.dispatch({ type: 'SET_CATCHES', payload: mergedAll });
  } catch (e) {}
}
export function destroy() {
  if (unsub) unsub();
  if (unsubEvent) unsubEvent();
}
export const logModule = {
  resolveDayWeatherForDate,
  getBiologicalMaxWeightKg,
  computeDataUrlFingerprint,
  sanitizeCatchPhotoAndComputeHash,
  logCatch,
  markCatchForDeletion,
  restoreCatchFromTrash,
  deleteCatch,
  getCatches,
  getPersonalStats,
  openCatchWizard,
  renderLog,
  init,
  render,
  destroy
};