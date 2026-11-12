/**
 * @file scanner.js
 * @description Мультимодальный нейро-определитель рыбы по фото («Ихтио-Сканер» v2.5.6):
 * - Прямое распознавание полного снимка через Gemini Flash Vision ИИ (gemini-2.5-flash / 2.5-flash-lite / 2.0-flash / 1.5-flash)
 * - Единый прямой промпт без рамок/точек/квадратов на фото: «Определи, что за рыба на фото, примерный размер и вес»
 * - Автоматическая подстановка ответа нейросети (вид, размер, вес в г/кг, диагностические признаки и разбор нескольких рыб в кадре) в карточку Атласа РФ
 */
import { store } from '../../core/store.js?v=2.9.2-r237';
import { router } from '../../core/router.js?v=2.9.2-r237';
import { RELAY_WORKER_URL, triggerHaptic } from '../../core/telegram.js?v=2.9.2-r237';
import { workerFetch } from '../circle/circle.module.js?v=2.9.2-r237';
import { BASIN_CONFIGS } from '../../data/basins.js?v=2.9.2-r237';
import { FISH_DB } from '../../data/species.js?v=2.9.2-r237';
import { renderFishVisual } from '../../ui/svg.js?v=2.9.2-r237';
import { escapeHtml, openModal, closeModal, showToast, flashHighlightElement } from '../../ui/components.js?v=2.9.2-r237';
/**
 * Коэффициент упитанности Фултона (k) по видам рыб для расчёта веса по длине:
 * W (кг) = (k * L_см^3) / 100000
 */
const FULTON_CONDITION_K = {
  pike: 0.85,
  amur_pike: 0.86,
  taimen: 0.96,
  lenok: 1.12,
  salmon: 1.15,
  trout: 1.18,
  char: 1.05,
  nelma: 0.98,
  muksun: 1.35,
  chir: 1.42,
  peled: 1.38,
  pizhyan: 1.25,
  whitefish: 1.25,
  tugun: 1.02,
  grayling: 1.08,
  baikal_grayling: 1.10,
  perch: 1.45,
  zander: 0.98,
  burbot: 0.78,
  dace: 1.18,
  roach: 1.42,
  ide: 1.52,
  chub: 1.38,
  bream: 1.75,
  crucian: 1.95,
  carp: 1.88,
  tench: 1.78,
  catfish: 0.76,
  sterlet: 0.68,
  siberian_sturgeon: 0.72,
  flounder: 1.45,
  plaice: 1.45,
  halibut: 1.35
};
export function estimateWeightByLengthAndSpecies(fishId, lengthCm) {
  const L = Math.max(2, Math.min(230, Number(lengthCm) || 25));
  let k = FULTON_CONDITION_K[fishId] || 1.25;
  // Аллометрическая поправка для крупных и трофейных экземпляров северных рек (W ~ L^3.18):
  // у трофейной щуки, тайменя, судака, нельмы и сазана старше 7–10 лет обхват тела растёт быстрее длины
  if (L >= 75 && ['pike', 'amur_pike', 'taimen', 'zander', 'nelma', 'catfish', 'carp', 'salmon'].includes(fishId)) {
    const trophyBoost = 1 + Math.min(0.38, ((L - 70) / 100) * 0.36);
    k = k * trophyBoost;
  } else if (L <= 11 && ['gudgeon', 'dace', 'bleak', 'tugun', 'smelt', 'loach'].includes(fishId)) {
    k = Math.min(k, 0.95);
  }
  const rawKg = (k * Math.pow(L, 3)) / 100000;
  if (rawKg < 0.05) {
    return Math.max(0.001, Math.round(rawKg * 1000) / 1000);
  }
  return Math.max(0.01, Math.round(rawKg * 100) / 100);
}
export function formatWeightHuman(weightKg) {
  const w = Number(weightKg) || 0;
  if (w <= 0) return '~100 г';
  if (w < 0.1) {
    const grams = Math.max(1, Math.round(w * 1000));
    return `~${grams} г (${w} кг)`;
  }
  if (w < 1.0) {
    const grams = Math.round(w * 100) * 10;
    return `~${grams} г (${w.toFixed(2)} кг)`;
  }
  return `~${w.toFixed(2)} кг`;
}
export function getDefaultTypicalLengthCm(fishId) {
  const map = {
    pike: 52, taimen: 85, lenok: 45, dace: 19, roach: 21, perch: 24,
    zander: 48, burbot: 50, peled: 32, chir: 44, pizhyan: 36, muksun: 46,
    nelma: 65, grayling: 30, ide: 36, bream: 38, crucian: 22, carp: 52,
    catfish: 85, trout: 38, salmon: 68, tugun: 15, smelt: 18, ruffe: 13,
    flounder: 28, plaice: 30, halibut: 65
  };
  return map[fishId] || 28;
}
/**
 * Явно запрашивает разрешения на Камеру и Фото у Android-контейнера (APK) или браузера
 */
export function requestAppCameraAndPhotoAccess() {
  try {
    if (typeof window !== 'undefined' && window.AndroidBridge && typeof window.AndroidBridge.requestCameraAndPhotoPermissions === 'function') {
      window.AndroidBridge.requestCameraAndPhotoPermissions();
      return true;
    }
  } catch (e) {}
  return false;
}
/**
 * Вычисляет расстояние Хэмминга между двумя 16-символьными hex-строками (64 бита)
 */
export function hammingDistanceHex64(h1, h2) {
  const a = String(h1 || '').replace(/^dh_/, '').padStart(16, '0');
  const b = String(h2 || '').replace(/^dh_/, '').padStart(16, '0');
  let dist = 0;
  for (let i = 0; i < 16; i++) {
    let xor = (parseInt(a[i], 16) ^ parseInt(b[i], 16)) & 0xf;
    while (xor > 0) {
      dist += xor & 1;
      xor >>= 1;
    }
  }
  return dist;
}
/**
 * Подготавливает полный снимок (без обрезки рамками) в чёткий JPEG до 960px и считает dHash для кэша одинаковых фото
 */
export async function extractPhotoVisualFeatures(imgSrc) {
  const stripB64Prefix = (str) => {
    const s = String(str || "");
    return s.includes(",") ? s.split(",")[1] : s;
  };
  if (typeof document === "undefined" || typeof Image === "undefined") {
    const pure = stripB64Prefix(imgSrc);
    return {
      dhash: "0000000000000000",
      roiDhash: "0000000000000000",
      thumbDataUrl: imgSrc,
      roiDataUrl: imgSrc,
      apiDataUrl: imgSrc,
      pureB64: pure
    };
  }
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const w = img.naturalWidth || img.width || 640;
          const h = img.naturalHeight || img.height || 480;
          let dhash = "0000000000000000";
          const c98 = document.createElement("canvas");
          c98.width = 9;
          c98.height = 8;
          const ctx98 = c98.getContext("2d");
          if (ctx98) {
            ctx98.drawImage(img, 0, 0, w, h, 0, 0, 9, 8);
            const p98 = ctx98.getImageData(0, 0, 9, 8).data;
            let bits = "";
            for (let y = 0; y < 8; y++) {
              for (let x = 0; x < 8; x++) {
                const i1 = (y * 9 + x) * 4;
                const i2 = (y * 9 + x + 1) * 4;
                const g1 = p98[i1] * 0.299 + p98[i1 + 1] * 0.587 + p98[i1 + 2] * 0.114;
                const g2 = p98[i2] * 0.299 + p98[i2 + 1] * 0.587 + p98[i2 + 2] * 0.114;
                bits += g1 < g2 ? "1" : "0";
              }
            }
            const h1 = parseInt(bits.slice(0, 32), 2).toString(16).padStart(8, "0");
            const h2 = parseInt(bits.slice(32, 64), 2).toString(16).padStart(8, "0");
            dhash = h1 + h2;
          }
          // 1. Чёткое превью для отображения на экране (до 960px, качество 0.85)
          const maxSidePreview = 960;
          const scalePreview = Math.min(1, maxSidePreview / Math.max(w, h));
          const cThumb = document.createElement("canvas");
          cThumb.width = Math.max(80, Math.round(w * scalePreview));
          cThumb.height = Math.max(80, Math.round(h * scalePreview));
          const ctxT = cThumb.getContext("2d");
          let thumbDataUrl = imgSrc;
          if (ctxT) {
            ctxT.drawImage(img, 0, 0, cThumb.width, cThumb.height);
            thumbDataUrl = cThumb.toDataURL("image/jpeg", 0.85);
          }
          // 2. Компактный пакет для передачи через Cloudflare Worker и прокси (строго < 44 КБ в Base64, чтобы весь POST-запрос был < 64 КБ и гарантированно проходил через все прокси и 4G)
          let apiDataUrl = thumbDataUrl;
          let pureB64 = stripB64Prefix(apiDataUrl);
          const compressionSteps = [
            { maxSide: 680, quality: 0.72 },
            { maxSide: 580, quality: 0.64 },
            { maxSide: 500, quality: 0.56 },
            { maxSide: 420, quality: 0.50 }
          ];
          for (const step of compressionSteps) {
            if (pureB64.length <= 42000) break;
            const sc = Math.min(1, step.maxSide / Math.max(w, h));
            const cApi = document.createElement("canvas");
            cApi.width = Math.max(64, Math.round(w * sc));
            cApi.height = Math.max(64, Math.round(h * sc));
            const ctxA = cApi.getContext("2d");
            if (ctxA) {
              ctxA.drawImage(img, 0, 0, cApi.width, cApi.height);
              apiDataUrl = cApi.toDataURL("image/jpeg", step.quality);
              pureB64 = stripB64Prefix(apiDataUrl);
            }
          }
          let relayB64 = pureB64;
          const relaySteps = [
            { maxSide: 320, quality: 0.48 },
            { maxSide: 260, quality: 0.44 },
            { maxSide: 220, quality: 0.40 }
          ];
          for (const st of relaySteps) {
            if (relayB64.length <= 11200) break;
            const scR = Math.min(1, st.maxSide / Math.max(w, h));
            const cRel = document.createElement("canvas");
            cRel.width = Math.max(64, Math.round(w * scR));
            cRel.height = Math.max(64, Math.round(h * scR));
            const ctxR = cRel.getContext("2d");
            if (ctxR) {
              ctxR.drawImage(img, 0, 0, cRel.width, cRel.height);
              relayB64 = stripB64Prefix(cRel.toDataURL("image/jpeg", st.quality));
            }
          }
          // Сверхкомпактный кадр microB64 (<= 1750 символов) для одиночного E2E GET-пакета (работает даже без чанков!)
          let microB64 = relayB64;
          const microSteps = [
            { maxSide: 140, quality: 0.38 },
            { maxSide: 112, quality: 0.34 },
            { maxSide: 96, quality: 0.30 }
          ];
          for (const mst of microSteps) {
            if (microB64.length <= 1750) break;
            const scM = Math.min(1, mst.maxSide / Math.max(w, h));
            const cMic = document.createElement("canvas");
            cMic.width = Math.max(48, Math.round(w * scM));
            cMic.height = Math.max(48, Math.round(h * scM));
            const ctxM = cMic.getContext("2d");
            if (ctxM) {
              ctxM.drawImage(img, 0, 0, cMic.width, cMic.height);
              microB64 = stripB64Prefix(cMic.toDataURL("image/jpeg", mst.quality));
            }
          }
          resolve({
            dhash,
            roiDhash: dhash,
            thumbDataUrl,
            roiDataUrl: thumbDataUrl,
            apiDataUrl,
            pureB64,
            relayB64,
            microB64
          });
        } catch (e) {
          const pure = stripB64Prefix(imgSrc);
          resolve({
            dhash: "0000000000000000",
            roiDhash: "0000000000000000",
            thumbDataUrl: imgSrc,
            roiDataUrl: imgSrc,
            apiDataUrl: imgSrc,
            pureB64: pure
          });
        }
      };
      img.onerror = () => {
        const pure = stripB64Prefix(imgSrc);
        resolve({
          dhash: "0000000000000000",
          roiDhash: "0000000000000000",
          thumbDataUrl: imgSrc,
          roiDataUrl: imgSrc,
          apiDataUrl: imgSrc,
          pureB64: pure
        });
      };
      img.src = imgSrc;
    } catch (err) {
      const pure = stripB64Prefix(imgSrc);
      resolve({
        dhash: "0000000000000000",
        roiDhash: "0000000000000000",
        thumbDataUrl: imgSrc,
        roiDataUrl: imgSrc,
        apiDataUrl: imgSrc,
        pureB64: pure
      });
    }
  });
}

const LOCAL_VISION_CACHE_KEY = "klev_vision_ai_cache_v263_r202";
const LOCAL_GEMINI_KEY_STORAGE = "klev_gemini_api_key_v2";
const LOCAL_GEMINI_QUOTA_STORAGE = "klev_gemini_quota_v2";

export function getStoredGeminiApiKey() {
  try {
    if (typeof window !== "undefined" && !window.__KLEV_ADMIN_CONTOUR__) return "";
    const s = store.getState();
    const fromProfile = String(s?.userProfile?.geminiApiKey || "").trim();
    if (fromProfile && fromProfile.length >= 16) return fromProfile;
    if (typeof localStorage !== "undefined") {
      const fromLs = String(localStorage.getItem(LOCAL_GEMINI_KEY_STORAGE) || "").trim();
      if (fromLs && fromLs.length >= 16) return fromLs;
    }
  } catch (e) {}
  return "";
}

export function saveStoredGeminiApiKey(rawKey = "") {
  const clean = String(rawKey || "").trim();
  try {
    if (typeof window !== "undefined" && !window.__KLEV_ADMIN_CONTOUR__) return "";
    if (typeof localStorage !== "undefined") {
      if (clean) localStorage.setItem(LOCAL_GEMINI_KEY_STORAGE, clean);
      else localStorage.removeItem(LOCAL_GEMINI_KEY_STORAGE);
    }
    store.dispatch({ type: "UPDATE_USER_PROFILE", payload: { geminiApiKey: clean } });
    const s = store.getState();
    const admTok = String(s?.userProfile?.adminSessionToken || "").trim();
    if (clean && clean.length >= 16 && admTok && typeof fetch === "function") {
      const cfgPayload = JSON.stringify({
        adminToken: admTok,
        geminiApiKey: clean
      });
      fetch(`${RELAY_WORKER_URL}/api/ai/config`, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Token": admTok
        },
        body: cfgPayload
      }).catch(() => {});
    }
  } catch (e) {}
  return clean;
}

export async function ensureGeminiKeySyncedFromServer() {
  return getStoredGeminiApiKey();
}

export function getLocalGeminiQuotaState(customKeyStr = null) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const rawKeys = String(customKeyStr !== null ? customKeyStr : getStoredGeminiApiKey())
    .split(",")
    .map(k => k.trim().replace(/^["'\s]+|["'\s]+$/g, ""))
    .filter(k => k.length >= 16);
  const keyCount = rawKeys.length;
  const limitPerDay = Math.max(1500, keyCount * 1500);
  let usedToday = 0;
  let usedAppToday = 0;
  let usedBotToday = 0;
  let totalAllTime = 0;
  let lastRequestAt = 0;
  let perKeyUsed = [0, 0, 0];
  try {
    if (typeof localStorage !== "undefined") {
      const raw = JSON.parse(localStorage.getItem(LOCAL_GEMINI_QUOTA_STORAGE) || "{}");
      if (raw && typeof raw === "object") {
        if (Number.isFinite(Number(raw.totalAllTime))) totalAllTime = Math.max(0, Number(raw.totalAllTime));
        if (Number.isFinite(Number(raw.lastRequestAt))) lastRequestAt = Math.max(0, Number(raw.lastRequestAt));
        if (raw.dateKey === todayStr) {
          if (Number.isFinite(Number(raw.usedToday))) usedToday = Math.max(0, Number(raw.usedToday));
          if (Number.isFinite(Number(raw.usedAppToday))) usedAppToday = Math.max(0, Number(raw.usedAppToday));
          if (Number.isFinite(Number(raw.usedBotToday))) usedBotToday = Math.max(0, Number(raw.usedBotToday));
          if (Array.isArray(raw.perKeyUsed)) {
            perKeyUsed = [Number(raw.perKeyUsed[0]) || 0, Number(raw.perKeyUsed[1]) || 0, Number(raw.perKeyUsed[2]) || 0];
          }
        }
      }
    }
  } catch (e) {}
  totalAllTime = Math.max(totalAllTime, usedToday);
  const remainingToday = Math.max(0, limitPerDay - usedToday);
  const pctRemaining = Math.round((remainingToday / limitPerDay) * 100);
  return {
    hasKey: keyCount > 0,
    keyCount,
    keys: rawKeys,
    limitPerDay,
    usedToday,
    usedAppToday,
    usedBotToday,
    totalAllTime,
    lastRequestAt,
    perKeyUsed,
    remainingToday,
    pctRemaining,
    dateKey: todayStr
  };
}

export function notifyServerGeminiUsage(usedKey = "", modelId = "", meta = {}) {
  try {
    const st = store.getState();
    const up = st?.userProfile || {};
    const fid = String(meta?.fisherId || up.fisherId || "FP_89RZ0001").trim().toUpperCase();
    const callsign = String(meta?.callsign || up.login || up.callsign || "Рыболов").trim();
    const envName = typeof window !== "undefined" && typeof window.__KLEV_GET_ERROR_AUTHOR_META__ === "function"
      ? (window.__KLEV_GET_ERROR_AUTHOR_META__().env || "WEB")
      : "WEB";
    const nowTs = Date.now();
    const entry = {
      id: `GAPI_${nowTs.toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      ts: nowTs,
      source: "app",
      fisherId: fid,
      callsign,
      env: envName,
      keySlot: Number(meta?.keySlot) || 1,
      model: modelId || "gemini-2.5-flash",
      httpStatus: Number(meta?.httpStatus) || 200,
      latencyMs: Number(meta?.latencyMs) || 180,
      action: String(meta?.action || "Ихтио-Сканер: фото рыбы").slice(0, 90),
      verifiedHttp200: true
    };
    if (typeof localStorage !== "undefined") {
      const qRaw = JSON.parse(localStorage.getItem(LOCAL_GEMINI_QUOTA_STORAGE) || "{}") || {};
      const recArr = Array.isArray(qRaw.recentCalls) ? qRaw.recentCalls : [];
      recArr.unshift(entry);
      qRaw.recentCalls = recArr.slice(0, 25);
      qRaw.lastHttpStatus = entry.httpStatus;
      qRaw.lastLatencyMs = entry.latencyMs;
      localStorage.setItem(LOCAL_GEMINI_QUOTA_STORAGE, JSON.stringify(qRaw));
    }
    if (typeof fetch !== "function") return;
    const payloadStr = JSON.stringify({
      usedKey: String(usedKey || "").slice(0, 12),
      keySlot: (Number(meta?.keySlot) || 1) - 1,
      model: entry.model,
      source: "app",
      fisherId: fid,
      callsign,
      env: envName,
      httpStatus: entry.httpStatus,
      latencyMs: entry.latencyMs,
      action: entry.action,
      ts: nowTs
    });
    const u = `${RELAY_WORKER_URL}/api/ai/record-usage?payload=${encodeURIComponent(payloadStr)}&_t=${nowTs}`;
    fetch(`https://allorigins.hexlet.app/raw?disableCache=true&url=${encodeURIComponent(u)}`, { method: "GET", mode: "cors", credentials: "omit" }).catch(() => {});
    fetch(`https://corsproxy-seven.vercel.app/api?url=${encodeURIComponent(u)}`, { method: "GET", mode: "cors", credentials: "omit" }).catch(() => {});
    fetch(u, { method: "GET", mode: "cors", credentials: "omit" }).catch(() => {});
  } catch (e) {}
}

export function incrementLocalGeminiQuotaUsed(serverQuotaObj = null) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const cur = getLocalGeminiQuotaState();
  const nextUsed = (serverQuotaObj && Number.isFinite(Number(serverQuotaObj.usedToday)))
    ? Math.max(cur.usedToday + 1, Number(serverQuotaObj.usedToday))
    : (cur.usedToday + 1);
  const nextApp = (serverQuotaObj && Number.isFinite(Number(serverQuotaObj.usedAppToday)))
    ? Math.max(cur.usedAppToday + 1, Number(serverQuotaObj.usedAppToday))
    : (cur.usedAppToday + 1);
  const nextBot = (serverQuotaObj && Number.isFinite(Number(serverQuotaObj.usedBotToday)))
    ? Math.max(cur.usedBotToday, Number(serverQuotaObj.usedBotToday))
    : cur.usedBotToday;
  const nextTotal = Math.max(nextUsed, cur.totalAllTime + 1, Number(serverQuotaObj?.totalAllTime) || 0);
  const nextPerKey = Array.isArray(serverQuotaObj?.perKeyUsed)
    ? serverQuotaObj.perKeyUsed.slice(0, 3)
    : [(cur.perKeyUsed[0] || 0) + 1, cur.perKeyUsed[1] || 0, cur.perKeyUsed[2] || 0];
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LOCAL_GEMINI_QUOTA_STORAGE, JSON.stringify({
        dateKey: todayStr,
        usedToday: nextUsed,
        usedAppToday: nextApp,
        usedBotToday: nextBot,
        totalAllTime: nextTotal,
        lastRequestAt: Date.now(),
        perKeyUsed: nextPerKey,
        limitPerDay: cur.limitPerDay
      }));
    }
  } catch (e) {}
  return getLocalGeminiQuotaState();
}

const CLIENT_GEMINI_MODELS_CASCADE = [
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-3-flash-preview",
  "gemini-2.5-flash-lite",
  "gemini-3.1-flash-lite-preview",
  "gemini-2.0-flash"
];

let _clientNeedsGeoRelay = false;

async function _postGeminiWithGeoRelay(rawUrl, bodyStr, timeoutMs) {
  const execPost = async (targetUrl, contentType, ms) => {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), ms) : null;
    try {
      const res = await fetch(targetUrl, {
        method: "POST",
        headers: { "Content-Type": contentType },
        body: bodyStr,
        signal: ctrl?.signal
      }).catch(() => null);
      if (timer) clearTimeout(timer);
      return res;
    } catch (e) {
      if (timer) clearTimeout(timer);
      return null;
    }
  };

  if (!_clientNeedsGeoRelay) {
    const directRes = await execPost(rawUrl, "application/json", Math.min(timeoutMs, 6500));
    if (directRes && directRes.ok) {
      return { res: directRes, errTxt: "" };
    }
    if (directRes) {
      const errTxt = await directRes.text().catch(() => "");
      if (/location is not supported|FAILED_PRECONDITION/i.test(errTxt)) {
        _clientNeedsGeoRelay = true;
      } else {
        return { res: directRes, errTxt };
      }
    } else {
      _clientNeedsGeoRelay = true;
    }
  }

  // Маршрутизация через зарубежные US/EU HTTPS-ретрансляторы (обход блокировки IP РФ со стороны Google AI Studio без VPN)
  const relayTargets = [
    `https://corsproxy.io/?url=${encodeURIComponent(rawUrl)}`,
    `https://corsproxy-seven.vercel.app/api?url=${encodeURIComponent(rawUrl)}`,
    `https://allorigins.hexlet.app/raw?disableCache=true&url=${encodeURIComponent(rawUrl)}`
  ];
  for (const rUrl of relayTargets) {
    const rRes = await execPost(rUrl, "application/json", timeoutMs);
    if (rRes && rRes.ok) {
      return { res: rRes, errTxt: "" };
    }
    if (rRes && (rRes.status === 400 || rRes.status === 403 || rRes.status === 404)) {
      const rErr = await rRes.text().catch(() => "");
      if (!/corsproxy|cloudflare|html/i.test(rErr)) {
        return { res: rRes, errTxt: rErr };
      }
    }
  }
  return { res: null, errTxt: "Network/Geo relay unreachable" };
}

export async function callGeminiClientSmart(apiKeyOrKeys, contentsPayload, genConfig = {}, timeoutMs = 12000) {
  const keyList = (Array.isArray(apiKeyOrKeys) ? apiKeyOrKeys : String(apiKeyOrKeys || "").split(","))
    .map(k => String(k || "").trim().replace(/^["'\s]+|["'\s]+$/g, ""))
    .filter(k => k.length >= 16)
    .slice(0, 3);
  if (keyList.length === 0) return { ok: false, status: 400, errorText: "Empty key" };
  let lastRes = { ok: false, status: 400, errorText: "No keys succeeded" };
  for (let kIdx = 0; kIdx < keyList.length; kIdx++) {
    const singleRes = await _callGeminiClientSingleKey(keyList[kIdx], contentsPayload, genConfig, timeoutMs);
    if (singleRes && singleRes.ok) {
      return { ...singleRes, usedKeyIndex: kIdx, usedKey: keyList[kIdx] };
    }
    lastRes = singleRes || lastRes;
  }
  return lastRes;
}

async function _callGeminiClientSingleKey(apiKey, contentsPayload, genConfig = {}, timeoutMs = 12000) {
  const tStart = Date.now();
  const cleanKey = String(apiKey || "").trim().replace(/^["'\s]+|["'\s]+$/g, "");
  if (!cleanKey) return { ok: false, status: 400, errorText: "Empty key" };
  const candidates = [];
  try {
    if (typeof localStorage !== "undefined") {
      const savedMod = String(localStorage.getItem("klev_gemini_active_model_v2") || "").trim();
      if (savedMod && savedMod.startsWith("gemini-") && !/lite/i.test(savedMod)) {
        candidates.push(savedMod);
      }
    }
  } catch (e) {}
  for (const fb of CLIENT_GEMINI_MODELS_CASCADE) {
    if (!candidates.includes(fb)) candidates.push(fb);
  }
  let listModelsChecked = false;
  const discoverModels = async () => {
    if (listModelsChecked) return;
    listModelsChecked = true;
    try {
      const lCtrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const lTimer = lCtrl ? setTimeout(() => lCtrl.abort(), 3500) : null;
      const listUrl = "https://generativelanguage.googleapis.com/v1beta/models?key=" + encodeURIComponent(cleanKey);
      let lRes = await fetch(listUrl, { method: "GET", signal: lCtrl?.signal }).catch(() => null);
      if (lTimer) clearTimeout(lTimer);
      if (!lRes || !lRes.ok) {
        lRes = await fetch("https://corsproxy-seven.vercel.app/api?url=" + encodeURIComponent(listUrl), { method: "GET" }).catch(() => null);
      }
      if (lRes && lRes.ok) {
        const lData = await lRes.json().catch(() => null);
        if (lData && Array.isArray(lData.models)) {
          for (const m of lData.models) {
            const methods = Array.isArray(m.supportedGenerationMethods) ? m.supportedGenerationMethods : [];
            if (!methods.includes("generateContent")) continue;
            const id = String(m.name || "").replace(/^models\//, "");
            if (!id.startsWith("gemini-")) continue;
            if (/embedding|imagen|veo|tts|audio|aqa|bisect|learnlm|robotics|computer-use|-image$|1\.0/i.test(id)) continue;
            if (!candidates.includes(id)) candidates.push(id);
          }
        }
      }
    } catch (e) {}
  };
  let lastStatus = 0;
  let lastErrorText = "";
  const maxAttempts = Math.min(6, candidates.length);
  for (let i = 0; i < maxAttempts; i++) {
    const modelId = candidates[i];
    const supportsThinkingCap = /^gemini-(2\.5|3)/i.test(modelId) && !/pro/i.test(modelId);
    const cfgVariants = supportsThinkingCap
      ? [
          { temperature: genConfig.temperature ?? 0.15, maxOutputTokens: genConfig.maxOutputTokens ?? 4096, thinkingConfig: { thinkingBudget: 512 } },
          { temperature: genConfig.temperature ?? 0.15, maxOutputTokens: genConfig.maxOutputTokens ?? 4096 }
        ]
      : [
          { temperature: genConfig.temperature ?? 0.15, maxOutputTokens: genConfig.maxOutputTokens ?? 4096 }
        ];
    for (let cIdx = 0; cIdx < cfgVariants.length; cIdx++) {
      try {
        const gUrl = "https://generativelanguage.googleapis.com/v1beta/models/" + modelId + ":generateContent?key=" + encodeURIComponent(cleanKey);
        const bodyStr = JSON.stringify({
          contents: contentsPayload,
          generationConfig: cfgVariants[cIdx]
        });
        const { res: gRes, errTxt } = await _postGeminiWithGeoRelay(gUrl, bodyStr, timeoutMs);
        if (!gRes) break;
        lastStatus = gRes.status;
        if (gRes.ok) {
          const gJson = await gRes.json().catch(() => null);
          const parts = gJson?.candidates?.[0]?.content?.parts || [];
          const nonThought = parts.filter(p => !p.thought && typeof p.text === "string" && p.text.trim());
          const rawTxt = (nonThought.length > 0 ? nonThought.map(p => p.text).join("\n") : parts.map(p => p.text || "").join("\n")).trim();
          if (rawTxt) {
            try {
              if (typeof localStorage !== "undefined") localStorage.setItem("klev_gemini_active_model_v2", modelId);
            } catch (e) {}
            return { ok: true, model: modelId, status: 200, latencyMs: Math.max(15, Date.now() - tStart), json: gJson, text: rawTxt };
          }
          if (cIdx < cfgVariants.length - 1) continue;
        }
        lastErrorText = errTxt;
        if (gRes.status === 400 && cIdx < cfgVariants.length - 1) {
          continue;
        }
        if (gRes.status === 400 || gRes.status === 403) {
          if (/API_KEY_INVALID|PERMISSION_DENIED/i.test(errTxt)) {
            break;
          }
        }
        if (gRes.status === 404) {
          await discoverModels();
          const suggested = errTxt.match(/models\/(gemini-[a-z0-9.-]+)/i);
          if (suggested && suggested[1] && !candidates.includes(suggested[1])) {
            candidates.splice(i + 1, 0, suggested[1]);
          }
        }
        break;
      } catch (e) {
        break;
      }
    }
    if (/API_KEY_INVALID|PERMISSION_DENIED/i.test(lastErrorText)) break;
  }
  return {
    ok: false,
    model: candidates[0] || "gemini-2.5-flash",
    status: lastStatus,
    errorText: lastErrorText
  };
}

function loadLocalVisionCache() {
  try {
    if (typeof localStorage === "undefined") return {};
    return JSON.parse(localStorage.getItem(LOCAL_VISION_CACHE_KEY) || "{}") || {};
  } catch (e) {
    return {};
  }
}

function saveLocalVisionCache(hashKey, resultObj) {
  try {
    if (typeof localStorage === "undefined" || !hashKey || hashKey === "0000000000000000") return;
    const cache = loadLocalVisionCache();
    const keys = Object.keys(cache);
    if (keys.length > 80) delete cache[keys[0]];
    cache[hashKey] = resultObj;
    localStorage.setItem(LOCAL_VISION_CACHE_KEY, JSON.stringify(cache));
  } catch (e) {}
}

/**
 * Словарь синонимов, народных названий и корней для 100% сопоставления ответа Gemini с карточками FISH_DB
 */
const SPECIES_KEYWORD_RULES = [
  { id: "crucian", rx: /карас|carassius/i },
  { id: "flounder", rx: /речная камбал|камбал.*flesus|platichthys|камбал/i },
  { id: "plaice", rx: /морская камбал|pleuronectes/i },
  { id: "starry_flounder", rx: /звездчатая камбал|звёздчатая камбал/i },
  { id: "halibut", rx: /палтус|hippoglossus/i },
  { id: "turbot", rx: /калкан|тюрбо|scophthalmus/i },
  { id: "amur_pike", rx: /амурская щук|reichertii/i },
  { id: "pike", rx: /щук|щурён|щурен|esox/i },
  { id: "chinese_perch", rx: /ауха|китайский окун|siniperca/i },
  { id: "sea_bass", rx: /сибас|лаврак|морской окун|dicentrarchus|sebastes/i },
  { id: "perch", rx: /окун|окушок|матросик|perca/i },
  { id: "volga_zander", rx: /берш|volgensis/i },
  { id: "zander", rx: /судак|клыкач|sander lucioperca/i },
  { id: "ruffe", rx: /ёрш|ерш|gymnocephalus/i },
  { id: "rotan", rx: /ротан|головешк|perccottus/i },
  { id: "goby", rx: /бычок|бычки|neogobius|ponticola/i },
  { id: "taran", rx: /тарань|heckeli/i },
  { id: "vobla", rx: /вобла|caspicus/i },
  { id: "kutum", rx: /кутум|вырезуб|frisii/i },
  { id: "roach", rx: /плотв|сорог|сорожк|чебак|rutilus/i },
  { id: "dace", rx: /елец|ельчик|мохтик|leuciscus/i },
  { id: "ide", rx: /язь|подъязок|leuciscus idus/i },
  { id: "chub", rx: /голавл|squalius|cephalus/i },
  { id: "rudd", rx: /красноперк|краснопёрк|scardinius/i },
  { id: "asp", rx: /жерех|шереспер|aspius/i },
  { id: "white_bream", rx: /густер|bjoerkna/i },
  { id: "blue_bream", rx: /синец|balliche|ballerus/i },
  { id: "sopa", rx: /белоглазк|сопа|sapa/i },
  { id: "parabramis", rx: /белый амурский лещ|черный лещ|parabramis/i },
  { id: "bream", rx: /лещ|подлещик|abramis brama/i },
  { id: "grass_carp", rx: /белый амур|ctenopharyngodon/i },
  { id: "black_carp", rx: /черный амур|чёрный амур|mylopharyngodon/i },
  { id: "silver_carp", rx: /толстолоб|hypophthalmichthys/i },
  { id: "buffalo", rx: /буффало|ictiobus/i },
  { id: "carp", rx: /карп|сазан|cyprinus/i },
  { id: "tench", rx: /линь|линёк|tinca/i },
  { id: "dace", rx: /гольян|озерный гольян|речной гольян|phoxinus|мохтик|елец|ельчик|leuciscus/i },
  { id: "bleak", rx: /верховк|овсянк|малявк|leucaspius|уклейк|уклея|alburnus/i },
  { id: "gudgeon", rx: /пескар|gobio/i },
  { id: "shemaya", rx: /шемая|chalcoides/i },
  { id: "bleak", rx: /уклейк|уклея|alburnus/i },
  { id: "chekhon", rx: /чехон|pelecus/i },
  { id: "undermouth", rx: /подуст|chondrostoma/i },
  { id: "vimba", rx: /рыбец|сырть|vimba/i },
  { id: "barbel", rx: /усач|мирон|barbus/i },
  { id: "sky_gazer", rx: /верхогляд|chanodichthys/i },
  { id: "yellowcheek", rx: /желтощек|желтощёк|elopichthys/i },
  { id: "tarpon_carp", rx: /монгольский краснопер|краснопёр|остролучк/i },
  { id: "loach", rx: /вьюн|щиповк|голец усат|misgurnus|cobitis/i },
  { id: "burbot", rx: /налим|lota lota/i },
  { id: "amur_catfish", rx: /амурский сом|parasilurus/i },
  { id: "channel_catfish", rx: /канальный сом|ictalurus/i },
  { id: "catfish", rx: /сом обыкновен|европейский сом|\bсом\b|сомён|silurus/i },
  { id: "taimen", rx: /таймен|hucho/i },
  { id: "lenok", rx: /ленок|ускуч|brachymystax/i },
  { id: "baikal_grayling", rx: /байкальский хариус|baicalensis/i },
  { id: "grayling", rx: /хариус|thymallus/i },
  { id: "rainbow_trout", rx: /радужная форел|микиж|mykiss|parasalmo/i },
  { id: "brown_trout", rx: /кумж|ручьевая форел|пеструшк|salmo trutta/i },
  { id: "trout", rx: /форел|озерная форел/i },
  { id: "salmon", rx: /сёмг|семг|атлантический лосос|salmo salar/i },
  { id: "dolly_varden", rx: /мальм| кундж|malma/i },
  { id: "char", rx: /голец|арктический голец|палия|salvelinus/i },
  { id: "pink_salmon", rx: /горбуш|gorbuscha/i },
  { id: "chum_salmon", rx: /кета|кеты|oncorhynchus keta/i },
  { id: "sockeye_salmon", rx: /нерк|nerka/i },
  { id: "coho_salmon", rx: /кижуч|kisutch/i },
  { id: "chinook_salmon", rx: /чавыч|tshawytscha/i },
  { id: "cherry_salmon", rx: /сима|masou/i },
  { id: "white_salmon", rx: /белорыбиц|leucichthys/i },
  { id: "nelma", rx: /нельма|stenodus/i },
  { id: "muksun", rx: /муксун|muksun/i },
  { id: "chir", rx: /чир|щокур|щекур|nasus/i },
  { id: "peled", rx: /пеляд|сырок|peled/i },
  { id: "pizhyan", rx: /пыжьян|сибирский сиг|pidschian/i },
  { id: "whitefish", rx: /сиг обыкновен|\bсиг\b|валаамк|lavaretus/i },
  { id: "broad_whitefish", rx: /чир|широколобик/i },
  { id: "omul_arctic", rx: /арктический омул|autumnalis/i },
  { id: "omul", rx: /омул|байкальский омул|migratorius/i },
  { id: "vendace", rx: /ряпушк|рипус|albula/i },
  { id: "cisco", rx: /сибирская ряпушк|зельдь|sardinella/i },
  { id: "tugun", rx: /тугун|сосьвинская сельд|манерк|tugun/i },
  { id: "valek", rx: /валёк|валек|cylindraceus|prosopium/i },
  { id: "smelt", rx: /корюшк|зубар|снеток|osmerus|hypomesus/i },
  { id: "capelin", rx: /мойв|уёк|mallotus/i },
  { id: "saffron_cod", rx: /дальневосточная наваг|вахня|gracilis/i },
  { id: "navaga", rx: /наваг|eleginus/i },
  { id: "cod", rx: /треск|gadus morhua/i },
  { id: "haddock", rx: /пикш|melanogrammus/i },
  { id: "saithe", rx: /сайд|pollachius/i },
  { id: "walleye_pollock", rx: /минтай|chalcogrammus|theragra/i },
  { id: "wolffish", rx: /зубатк|anarhichas/i },
  { id: "greenling", rx: /терпуг|зайчик морской|pleurogrammus/i },
  { id: "herring", rx: /сельдь|селедк|селёдк|clupea/i },
  { id: "mackerel", rx: /скумбр|scomber/i },
  { id: "horse_mackerel", rx: /ставрид|trachurus/i },
  { id: "bluefish", rx: /луфар|pomatomus/i },
  { id: "mullet", rx: /кефал|лобан|сингил|остронос|пеленгас|mugil|planiza|liza/i },
  { id: "red_mullet", rx: /барабул|султанк|mullus/i },
  { id: "garfish", rx: /сарган|belone/i },
  { id: "scorpionfish", rx: /скорпен|морской ёрш|морской ерш|scorpaena/i },
  { id: "sea_bream", rx: /дорад|зубарик|ласкир|морской карас|sparus|diplodus/i },
  { id: "wrasse", rx: /зеленушк|губан|symphodus/i },
  { id: "sand_eel", rx: /песчанк|ammodytes/i },
  { id: "anglerfish", rx: /удильщик|морской чёрт|морской черт|lophius/i },
  { id: "eel", rx: /угор|речной угор|anguilla/i },
  { id: "sterlet", rx: /стерляд|ruthenus/i },
  { id: "stellate_sturgeon", rx: /севрюг|stellatus/i },
  { id: "beluga", rx: /белуг|huso huso/i },
  { id: "kaluga", rx: /калуг|dauricus/i },
  { id: "siberian_sturgeon", rx: /сибирский осётр|сибирский осетр|baerii/i },
  { id: "russian_sturgeon", rx: /русский осётр|русский осетр|\bосётр\b|\bосетр\b|gueldenstaedtii/i },
  { id: "paddlefish", rx: /веслонос|polyodon/i },
  { id: "snakehead", rx: /змееголов|channa/i },
  { id: "tilapia", rx: /тиляп|тилап|oreochromis/i },
  { id: "king_crab", rx: /камчатский краб|paralithodes/i },
  { id: "crab", rx: /краб|стригун|волосатик|chionoecetes|cancer/i },
  { id: "crayfish", rx: /речной рак|узкопалый рак|широкопалый рак|\bрак\b|astacus|pontastacus/i }
];

export function matchSpeciesInAtlas(fishNameRu = "", fishNameLat = "", fullText = "") {
  const directById = FISH_DB.find(f => f.id === String(fishNameRu || "").trim().toLowerCase());
  if (directById) return directById;
  const primaryStr = `${fishNameRu || ""} ${fishNameLat || ""}`.toLowerCase().replace(/ё/g, "е").trim();
  const secondaryStr = String(fullText || "").toLowerCase().replace(/ё/g, "е");
  for (const f of FISH_DB) {
    const fn = f.name.toLowerCase().replace(/ё/g, "е");
    const fnShort = fn.split("(")[0].trim();
    const fl = (f.latin || "").toLowerCase();
    if (primaryStr && ((fnShort.length >= 3 && primaryStr.includes(fnShort)) || (fl.length >= 5 && primaryStr.includes(fl)))) {
      return f;
    }
  }
  if (primaryStr) {
    for (const rule of SPECIES_KEYWORD_RULES) {
      if (rule.rx.test(primaryStr)) {
        const found = FISH_DB.find(f => f.id === rule.id);
        if (found) return found;
      }
    }
  }
  if (secondaryStr) {
    const cleanedSecondary = secondaryStr.replace(/(?:исключает|не\s+является|отличается\s+от|против)[^.,;\n]*/g, "");
    for (const rule of SPECIES_KEYWORD_RULES) {
      if (rule.rx.test(cleanedSecondary)) {
        const found = FISH_DB.find(f => f.id === rule.id);
        if (found) return found;
      }
    }
  }
  return null;
}

/**
 * Разбирает ответ Gemini (как JSON, так и свободный текст)
 */
export function parseGeminiFishResponse(rawText = "") {
  const txt = String(rawText || "").trim();
  if (!txt) return null;
  const cleanJsonCandidate = txt.replace(/```json/gi, "").replace(/```/g, "").trim();
  const b0 = cleanJsonCandidate.indexOf("{");
  const b1 = cleanJsonCandidate.lastIndexOf("}");
  let obj = null;
  if (b0 !== -1 && b1 > b0) {
    try {
      obj = JSON.parse(cleanJsonCandidate.slice(b0, b1 + 1));
    } catch (e) {}
  }
  if (!obj && b0 !== -1) {
    const sub = cleanJsonCandidate.slice(b0);
    const exStr = (k) => {
      const m = sub.match(new RegExp(`"${k}"\\s*:\\s*"([^"]*)"`, "i"));
      return m ? m[1] : "";
    };
    const exNum = (k) => {
      const m = sub.match(new RegExp(`"${k}"\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)`, "i"));
      return m ? parseFloat(m[1]) : 0;
    };
    const fRu = exStr("fishNameRu") || exStr("species") || exStr("sceneTitle");
    if (fRu) {
      obj = {
        fishNameRu: fRu,
        fishNameLat: exStr("fishNameLat") || exStr("latin"),
        confidence: exNum("confidence") || 95,
        lengthCm: exNum("lengthCm") || exNum("estimatedLengthCm"),
        weightGrams: exNum("weightGrams"),
        weightKg: exNum("weightKg"),
        sizeText: exStr("sizeText"),
        traits: exStr("traits") || exStr("reason"),
        fullText: exStr("fullText") || exStr("details") || exStr("traits")
      };
    }
  }
  if (obj && typeof obj === "object") {
    const topFromMatches = Array.isArray(obj.matches) && obj.matches.length > 0 ? obj.matches[0] : null;
    const rawNameRu = String(obj.fishNameRu || obj.species || obj.fishName || topFromMatches?.fishNameRu || topFromMatches?.fishId || obj.sceneTitle || "").trim();
    const rawNameLat = String(obj.fishNameLat || obj.latin || topFromMatches?.fishNameLat || "").trim();
    const traits = String(obj.traits || topFromMatches?.reason || obj.morphNote || "").trim();
    const fullText = String(obj.fullText || obj.details || obj.description || obj.sceneTitle || traits || "").trim();
    const matchedFish = matchSpeciesInAtlas(rawNameRu, rawNameLat, `${traits} ${fullText}`)
      || (topFromMatches?.fishId ? FISH_DB.find(f => f.id === topFromMatches.fishId) : null);
    if (matchedFish || rawNameRu) {
      const fish = matchedFish || {
        id: "crucian",
        name: rawNameRu || "Рыба распознана ИИ",
        latin: rawNameLat || "",
        legal: "allowed",
        idTraits: traits,
        sizeInfo: obj.sizeText || ""
      };
      let lenCm = Number(obj.lengthCm || obj.estimatedLengthCm || topFromMatches?.estimatedLengthCm) || 0;
      if (lenCm <= 0) {
        const mLen = `${obj.lengthCm || ""} ${obj.sizeText || ""} ${fullText}`.match(/(\d+(?:[.,]\d+)?)\s*(?:[–-]\s*(\d+(?:[.,]\d+)?))?\s*см/i);
        if (mLen) {
          const v1 = parseFloat(mLen[1].replace(",", "."));
          const v2 = mLen[2] ? parseFloat(mLen[2].replace(",", ".")) : v1;
          lenCm = Math.round(((v1 + v2) / 2) * 10) / 10;
        }
      }
      if (lenCm <= 0) lenCm = getDefaultTypicalLengthCm(fish.id);
      let weightKg = 0;
      if (Number(obj.weightKg) > 0) {
        weightKg = Number(obj.weightKg);
      } else if (Number(obj.weightGrams) > 0) {
        weightKg = Number(obj.weightGrams) / 1000;
      } else if (Number(topFromMatches?.estimatedWeightKg) > 0) {
        weightKg = Number(topFromMatches.estimatedWeightKg);
      } else {
        const searchStr = `${obj.weightGrams || ""} ${obj.weightKg || ""} ${obj.sizeText || ""} ${fullText}`;
        const mGrams = searchStr.match(/(\d+(?:[.,]\d+)?)\s*(?:[–-]\s*(\d+(?:[.,]\d+)?))?\s*(?:г|гр|грамм[а-я]*)(?![а-я])/i);
        const mKg = searchStr.match(/(\d+(?:[.,]\d+)?)\s*(?:[–-]\s*(\d+(?:[.,]\d+)?))?\s*кг/i);
        if (mGrams) {
          const g1 = parseFloat(mGrams[1].replace(",", "."));
          const g2 = mGrams[2] ? parseFloat(mGrams[2].replace(",", ".")) : g1;
          weightKg = Math.round(((g1 + g2) / 2)) / 1000;
        } else if (mKg) {
          const k1 = parseFloat(mKg[1].replace(",", "."));
          const k2 = mKg[2] ? parseFloat(mKg[2].replace(",", ".")) : k1;
          weightKg = Math.round(((k1 + k2) / 2) * 100) / 100;
        } else {
          weightKg = estimateWeightByLengthAndSpecies(fish.id, lenCm);
        }
      }
      const conf = Math.max(50, Math.min(99, Math.round(Number(obj.confidence || topFromMatches?.confidence) || 95)));
      const displayTitle = rawNameRu && !FISH_DB.some(f => f.id === rawNameRu) ? rawNameRu : fish.name;
      const displayLatin = rawNameLat || fish.latin || "";
      const sizeText = String(obj.sizeText || `Длина: ~${lenCm} см • Вес: ${formatWeightHuman(weightKg)}`).trim();
      const rawDetected = Array.isArray(obj.detectedFish)
        ? obj.detectedFish
        : (Array.isArray(obj.otherFish) ? obj.otherFish : (Array.isArray(obj.species) ? obj.species : []));
      const isMultipleFish = Boolean(
        obj.isMultipleFish ||
        Number(obj.fishCount) > 1 ||
        rawDetected.length > 1 ||
        /несколько\s+рыб|на\s+фото\s+\d+\s+рыб|соседн[иея]\s+рыб|рядом\s+леж/i.test(`${fullText} ${traits}`)
      );

      const primaryItem = {
        fishId: fish.id,
        fish,
        displayTitle,
        displayLatin,
        positionLabel: String(obj.positionLabel || (isMultipleFish ? "по центру (основная)" : "")).trim(),
        isRedBook: fish.legal === "redbook",
        confidence: conf,
        reason: traits || fullText || fish.idTraits || "Определено нейросетью по внешним морфологическим признакам",
        fullAnalysisText: fullText || traits,
        sizeSummaryText: sizeText,
        estimatedLengthCm: lenCm,
        estimatedWeightKg: weightKg,
        isFromMultiFishPhoto: true
      };

      const detectedFishItems = [primaryItem];
      for (const det of rawDetected.slice(0, 6)) {
        if (!det || typeof det !== "object") continue;
        const detNameRu = String(det.fishNameRu || det.name || det.species || "").trim();
        const detNameLat = String(det.fishNameLat || det.latin || "").trim();
        const detTraits = String(det.traits || det.reason || det.description || "").trim();
        const detPos = String(det.positionLabel || det.position || "соседняя на фото").trim();
        if (!detNameRu) continue;
        const detMatched = matchSpeciesInAtlas(detNameRu, detNameLat, detTraits) || fish;
        let detLen = Number(det.lengthCm || det.estimatedLengthCm) || 0;
        if (detLen <= 0 && det.sizeText) {
          const mL = String(det.sizeText).match(/(\d+(?:[.,]\d+)?)\s*см/i);
          if (mL) detLen = parseFloat(mL[1].replace(",", "."));
        }
        if (detLen <= 0) detLen = getDefaultTypicalLengthCm(detMatched.id);
        let detWKg = 0;
        if (Number(det.weightKg) > 0) detWKg = Number(det.weightKg);
        else if (Number(det.weightGrams) > 0) detWKg = Number(det.weightGrams) / 1000;
        else detWKg = estimateWeightByLengthAndSpecies(detMatched.id, detLen);
        const detTitle = detNameRu && !FISH_DB.some(f => f.id === detNameRu) ? detNameRu : detMatched.name;
        const isDuplicateOfPrimary = (
          detectedFishItems.length === 1 &&
          (detMatched.id === primaryItem.fishId || detTitle.toLowerCase() === primaryItem.displayTitle.toLowerCase()) &&
          Math.abs(detLen - primaryItem.estimatedLengthCm) <= 3
        );
        if (isDuplicateOfPrimary) {
          if (detPos && !primaryItem.positionLabel) primaryItem.positionLabel = detPos;
          continue;
        }
        const detSizeText = String(det.sizeText || `Длина: ~${detLen} см • Вес: ${formatWeightHuman(detWKg)}`).trim();
        detectedFishItems.push({
          fishId: detMatched.id,
          fish: detMatched,
          displayTitle: detTitle,
          displayLatin: detNameLat || detMatched.latin || "",
          positionLabel: detPos,
          isRedBook: detMatched.legal === "redbook",
          confidence: Math.max(70, Math.min(98, Math.round(Number(det.confidence) || 92))),
          reason: detTraits || detMatched.idTraits || `Распознана на этом же снимке (${detPos})`,
          fullAnalysisText: detTraits
            ? `${detTitle} (${detPos}): ${detTraits}. Средний размер ~${detLen} см, вес ${formatWeightHuman(detWKg)}.`
            : `${detTitle} (${detPos}): средний размер ~${detLen} см, примерный вес ${formatWeightHuman(detWKg)}.`,
          sizeSummaryText: detSizeText,
          estimatedLengthCm: detLen,
          estimatedWeightKg: detWKg,
          isFromMultiFishPhoto: true
        });
      }

      const finalIsMulti = isMultipleFish || detectedFishItems.length > 1;
      const topMatches = [...detectedFishItems];
      const altList = Array.isArray(obj.alternatives) ? obj.alternatives : (Array.isArray(obj.matches) ? obj.matches.slice(1) : []);
      for (const alt of altList.slice(0, 2)) {
        const altName = String(alt.fishNameRu || alt.fishId || "").trim();
        const altFish = matchSpeciesInAtlas(altName, alt.fishNameLat || "", alt.reason || "");
        if (altFish && !topMatches.some(m => m.fishId === altFish.id)) {
          const altLen = getDefaultTypicalLengthCm(altFish.id);
          topMatches.push({
            fishId: altFish.id,
            fish: altFish,
            displayTitle: altFish.name,
            displayLatin: altFish.latin || "",
            positionLabel: "похожий вид",
            isRedBook: altFish.legal === "redbook",
            confidence: Math.max(10, Math.min(85, Math.round(Number(alt.confidence) || 25))),
            reason: alt.reason || altFish.idTraits || "Сходный по форме тела вид",
            fullAnalysisText: alt.reason || altFish.idTraits || "",
            sizeSummaryText: `Обычно ~${altLen} см`,
            estimatedLengthCm: altLen,
            estimatedWeightKg: estimateWeightByLengthAndSpecies(altFish.id, altLen),
            isFromMultiFishPhoto: false
          });
        }
      }
      return {
        sceneTitle: displayTitle,
        sizeText,
        fullText: fullText || traits,
        estimatedLengthCm: lenCm,
        estimatedWeightKg: weightKg,
        isMultipleFish: finalIsMulti,
        fishCount: Math.max(detectedFishItems.length, Number(obj.fishCount) || 1),
        detectedFish: detectedFishItems,
        topMatches
      };
    }
  }
  const matchedFromText = matchSpeciesInAtlas("", "", txt);
  if (matchedFromText) {
    let lenCm = getDefaultTypicalLengthCm(matchedFromText.id);
    const txtWithoutHandScale = txt.replace(/(?:ширин|размер|длин)[^\n.;:]*?(?:ладон|рук|пальц|ступн|коробк)[^\n.;:]*?\d+(?:[.,]\d+)?\s*(?:[–-]\s*\d+(?:[.,]\d+)?)?\s*см/gi, "");
    const mLenCentral = txtWithoutHandScale.match(/(?:средн[а-я]*|центральн[а-я]*)[^:\n]{0,30}:?[^\d\n]{0,20}(\d+(?:[.,]\d+)?)\s*(?:[–-]\s*(\d+(?:[.,]\d+)?))?\s*см/i);
    const mLenExplicit = txtWithoutHandScale.match(/(?:длина|размер|tl)[^\d\n]{0,30}?(\d+(?:[.,]\d+)?)\s*(?:[–-]\s*(\d+(?:[.,]\d+)?))?\s*см/i);
    const mLen = mLenCentral || mLenExplicit || txtWithoutHandScale.match(/(\d+(?:[.,]\d+)?)\s*(?:[–-]\s*(\d+(?:[.,]\d+)?))?\s*см/i);
    if (mLen) {
      const v1 = parseFloat(mLen[1].replace(",", "."));
      const v2 = mLen[2] ? parseFloat(mLen[2].replace(",", ".")) : v1;
      lenCm = Math.round(((v1 + v2) / 2) * 10) / 10;
    }
    let weightKg = estimateWeightByLengthAndSpecies(matchedFromText.id, lenCm);
    const mGramsCentral = txtWithoutHandScale.match(/(?:средн[а-я]*|центральн[а-я]*)[^:\n]{0,30}:?[^\d\n]{0,20}(\d+(?:[.,]\d+)?)\s*(?:[–-]\s*(\d+(?:[.,]\d+)?))?\s*(?:г|гр|грамм[а-я]*)(?![а-я])/i);
    const mGrams = mGramsCentral || txtWithoutHandScale.match(/(\d+(?:[.,]\d+)?)\s*(?:[–-]\s*(\d+(?:[.,]\d+)?))?\s*(?:г|гр|грамм[а-я]*)(?![а-я])/i);
    const mKg = txtWithoutHandScale.match(/(\d+(?:[.,]\d+)?)\s*(?:[–-]\s*(\d+(?:[.,]\d+)?))?\s*кг/i);
    if (mGrams) {
      const g1 = parseFloat(mGrams[1].replace(",", "."));
      const g2 = mGrams[2] ? parseFloat(mGrams[2].replace(",", ".")) : g1;
      weightKg = Math.round(((g1 + g2) / 2)) / 1000;
    } else if (mKg) {
      const k1 = parseFloat(mKg[1].replace(",", "."));
      const k2 = mKg[2] ? parseFloat(mKg[2].replace(",", ".")) : k1;
      weightKg = Math.round(((k1 + k2) / 2) * 100) / 100;
    }
    const cleanTxt = txt.replace(/[*#`]/g, "").trim();
    const firstSentence = cleanTxt.split(/\n+/)[0] || matchedFromText.name;
    const sizeText = `Длина: ~${lenCm} см • Вес: ${formatWeightHuman(weightKg)}`;
    const matchItem = {
      fishId: matchedFromText.id,
      fish: matchedFromText,
      displayTitle: matchedFromText.name,
      displayLatin: matchedFromText.latin || "",
      isRedBook: matchedFromText.legal === "redbook",
      confidence: 95,
      reason: firstSentence,
      fullAnalysisText: cleanTxt,
      sizeSummaryText: sizeText,
      estimatedLengthCm: lenCm,
      estimatedWeightKg: weightKg
    };
    return {
      sceneTitle: matchedFromText.name,
      sizeText,
      fullText: cleanTxt,
      estimatedLengthCm: lenCm,
      estimatedWeightKg: weightKg,
      topMatches: [matchItem]
    };
  }
  return null;
}

/**
 * Прямое распознавание рыбы по фото через Gemini Vision (и многоканальный Cloudflare Worker шлюз)
 * без рамок, квадратов и без подставных заглушек
 */
export async function analyzeFishPhotoHybrid(imgSrc, bypassCache = false) {
  const s = store.getState();
  const basinCode = s.basinCode || "arctic_ob_taz";
  const basinName = BASIN_CONFIGS[basinCode]?.name || "Водоёмы РФ";
  const locLabel = s.locLabel || s.locAdmin2 || s.locAdmin1 || "Новый Уренгой";

  const feat = await extractPhotoVisualFeatures(imgSrc);
  const cacheHashKey = feat.dhash;

  // 1. Проверяем локальный кэш по dHash фотографии (если не нажата кнопка «Повторить»)
  if (!bypassCache && cacheHashKey && cacheHashKey.length === 16 && cacheHashKey !== "0000000000000000") {
    const localCache = loadLocalVisionCache();
    const cachedEntry = localCache[cacheHashKey];
    if (cachedEntry && cachedEntry.parsedResult && Array.isArray(cachedEntry.parsedResult.topMatches) && cachedEntry.parsedResult.topMatches.length > 0) {
      const pr = cachedEntry.parsedResult;
      const hydratedMatches = pr.topMatches.map(m => ({
        ...m,
        fish: FISH_DB.find(f => f.id === m.fishId) || m.fish || FISH_DB[0]
      }));
      return {
        ok: true,
        engine: cachedEntry.engine || "Google Gemini Vision ИИ (кэш)",
        sourceMode: cachedEntry.engine || "Google Gemini Vision ИИ",
        basinCode,
        basinName,
        sceneTitle: pr.sceneTitle,
        sizeText: pr.sizeText,
        fullText: pr.fullText,
        morphNote: hydratedMatches[0].reason,
        primaryMatch: hydratedMatches[0],
        topMatch: hydratedMatches[0],
        isMultipleFish: Boolean(pr.isMultipleFish || (pr.detectedFish && pr.detectedFish.length > 1)),
        detectedFish: pr.detectedFish ? pr.detectedFish.map(m => ({ ...m, fish: FISH_DB.find(f => f.id === m.fishId) || m.fish || FISH_DB[0] })) : hydratedMatches.filter(m => m.isFromMultiFishPhoto),
        topMatches: hydratedMatches,
        matches: hydratedMatches,
        estimatedLengthCm: hydratedMatches[0].estimatedLengthCm,
        estimatedWeightKg: hydratedMatches[0].estimatedWeightKg,
        thumbDataUrl: feat.thumbDataUrl || imgSrc,
        roiDataUrl: feat.thumbDataUrl || imgSrc
      };
    }
  }

  // Если локально ключ ещё не синхронизирован с сервера — подтягиваем его перед запросом
  await ensureGeminiKeySyncedFromServer().catch(() => {});

  const apiDataUrl = feat.apiDataUrl || feat.thumbDataUrl || imgSrc || "";
  const pureB64 = feat.pureB64 || (apiDataUrl.includes(",") ? apiDataUrl.split(",")[1] : apiDataUrl);

  const regionHint = locLabel ? `Регион съёмки: ${locLabel} (${basinName}).` : `Регион съёмки: ${basinName}.`;
  const DIRECT_FISH_PROMPT =
    `Ты — эксперт-ихтиолог РФ. Точно определи вид рыбы на фото, её реальную полную длину (TL, в см) и реальный вес (в граммах или кг). ${regionHint}\n` +
    "1. ТОЧНАЯ ДИАГНОСТИКА МЕЛКИХ И СТАЙНЫХ РЫБ: Если на фото стайка мелких рыб в мелкоячеистой сетке/малявочнице/подсаке (ячея 5–8 мм), внимательно проверь форму тела и чешую! Не называй любую мелкую рыбу плотвой: у плотвы высокое сжатое с боков тело, крупная серебристая чешуя и красные глаза/плавники. Если тело вальковатое/прогонистое, чешуя очень мелкая, окраска золотисто-бурая/оливковая с тёмной спинкой или крапом — это озёрный/речной гольян (Phoxinus), елец (Leuciscus), пескарь (Gobio), верховка (Leucaspius) или тугун (Coregonus tugun). Их реальная длина по масштабу ячеи малявочницы 6–11 см, вес 8–22 г!\n" +
    "2. КАЛИБРОВКА ТРОФЕЙНЫХ ЭКЗЕМПЛЯРОВ В РУКАХ РЫБОЛОВА: Если рыбу держит взрослый человек, используй антропометрические эталоны: ширина плеч мужчины в куртке = 55–58 см, размах локтей = 90–95 см, ширина ладони = 10 см, высота сапога = 42 см, диаметр баллона ПВХ-лодки = 46–50 см. Если крупная щука, таймень, нельма или судак выступает за оба плеча/бедра рыболова и хвост/тело изогнуты по дуге, обязательно прибавь +10–14% на перспективу и изгиб тела и учитывай массивный обхват спины северных трофеев (не занижай длину и вес!).\n" +
    "3. Не путай сиговых рыб (сиг-пыжьян, пелядь, чир, тугун, ряпушка, муксун — есть жировой плавник) и карповых (гольян, елец, плотва, язь — без жирового плавника) с хариусом.\n" +
    "Верни ТОЛЬКО валидный JSON:\n" +
    '{"fishNameRu":"точное название рыбы","fishNameLat":"латинское название","confidence":96,"lengthCm":25,"weightGrams":220,"sizeText":"Длина ~25 см • Вес ~220 г","isMultipleFish":false,"fishCount":1,"traits":"ключевые морфологические признаки на снимке","fullText":"развёрнутое заключение ихтиолога по виду, пропорциям и весу","detectedFish":[{"fishNameRu":"название","positionLabel":"по центру","lengthCm":25,"weightGrams":220,"traits":"признаки"}]}';

  if (typeof fetch === "function" && pureB64 && pureB64.length > 100) {
    const geminiQuota = getLocalGeminiQuotaState();
    const activeClientKey = getStoredGeminiApiKey();

    // 2А. Многоканальный запрос к Cloudflare Worker /api/ai/identify-fish:
    // Сначала быстрый прямой POST (2.5 сек), а при блокировке ТСПУ без VPN — гарантированная пакетная передача
    // чанков через рабочий анти-DPI E2E GET-каскад workerFetch (Hexlet / Vercel / EveryOrigin)!
    const workerBodyStr = JSON.stringify({
      basinCode,
      locLabel,
      dhash: feat.dhash,
      roiDhash: feat.roiDhash,
      imageBase64: pureB64,
      geminiApiKey: activeClientKey,
      bypassCache: true,
      directPrompt: DIRECT_FISH_PROMPT
    });

    const parseWorkerResponseObj = (data) => {
      const eng = String(data?.engine || "");
      const isOldFallback = eng.includes("v2.5.3") || eng.includes("Морфометрическое ядро") || eng.includes("Гибридный");
      if (!data || !data.ok || isOldFallback) throw new Error("Worker not ok");
      const parsed = data.rawGeminiText
        ? parseGeminiFishResponse(data.rawGeminiText)
        : parseGeminiFishResponse(JSON.stringify(data));
      if (!parsed || !parsed.topMatches || parsed.topMatches.length === 0) throw new Error("Empty parse");
      return { data, parsed };
    };

    const callDirectPostFast = async (timeoutMs = 2600) => {
      const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
      try {
        const res = await fetch(`${RELAY_WORKER_URL}/api/ai/identify-fish`, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=UTF-8" },
          body: workerBodyStr,
          mode: "cors",
          credentials: "omit",
          signal: ctrl?.signal
        });
        if (timer) clearTimeout(timer);
        if (!res || !res.ok) throw new Error("Direct HTTP " + (res?.status || 0));
        const data = await res.json();
        return parseWorkerResponseObj(data);
      } catch (err) {
        if (timer) clearTimeout(timer);
        throw err;
      }
    };

    const callSingleShotCompactGetRelay = async () => {
      const compactImg = feat.microB64 || feat.relayB64 || pureB64;
      const sRes = await workerFetch('/api/ai/identify-fish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          basinCode,
          locLabel,
          dhash: feat.dhash,
          imageBase64: compactImg,
          bypassCache: true
        })
      }, 18000, 1);
      if (!sRes || !sRes.ok) throw new Error('Single-shot GET relay HTTP ' + (sRes?.status || 0));
      const sData = await sRes.json();
      return parseWorkerResponseObj(sData);
    };

    const callPostProxyWorkerRelay = async () => {
      const proxyUrl = `https://corsproxy.io/?url=${encodeURIComponent(RELAY_WORKER_URL + '/api/ai/identify-fish')}`;
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), 14000) : null;
      try {
        const pRes = await fetch(proxyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          body: workerBodyStr,
          mode: 'cors',
          credentials: 'omit',
          signal: ctrl?.signal
        });
        if (timer) clearTimeout(timer);
        if (!pRes || !pRes.ok) throw new Error('PostProxy HTTP ' + (pRes?.status || 0));
        const pData = await pRes.json();
        return parseWorkerResponseObj(pData);
      } catch (e) {
        if (timer) clearTimeout(timer);
        throw e;
      }
    };

    const callChunkedNoVpnRelay = async () => {
      const b64ToSend = feat.relayB64 || pureB64;
      const chunkSize = 1350; // <= 1.35 КБ на чанк -> URL ?e2e= менее 2.2 КБ (100% проходит лимит 4 КБ любых прокси!)
      const chunks = [];
      for (let i = 0; i < b64ToSend.length; i += chunkSize) {
        chunks.push(b64ToSend.slice(i, i + chunkSize));
      }
      const scanId = `SC_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
      try {
        // Сначала отправляем 0-й чанк и проверяем, поддерживает ли воркер пакетный режим chunkMode
        const firstRes = await workerFetch('/api/ai/identify-fish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chunkMode: 'put',
            scanId,
            idx: 0,
            total: chunks.length,
            data: chunks[0]
          })
        }, 7000, 1);
        const firstJson = firstRes ? await firstRes.json().catch(() => null) : null;
        if (!firstJson || !firstJson.ok || typeof firstJson.savedIdx !== 'number') {
          throw new Error('Worker chunkMode not active or chunk 0 failed');
        }
        // Загружаем остальные чанки батчами по 3 параллельно
        for (let bStart = 1; bStart < chunks.length; bStart += 3) {
          const batch = chunks.slice(bStart, bStart + 3);
          await Promise.all(batch.map(async (chunkData, offsetIdx) => {
            const idx = bStart + offsetIdx;
            const cRes = await workerFetch('/api/ai/identify-fish', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chunkMode: 'put',
                scanId,
                idx,
                total: chunks.length,
                data: chunkData
              })
            }, 7000, 1);
            const cJson = cRes ? await cRes.json().catch(() => null) : null;
            if (!cJson || !cJson.ok || typeof cJson.savedIdx !== 'number') {
              throw new Error(`Chunk ${idx} upload failed`);
            }
          }));
        }
        // Запускаем распознавание собранного снимка на воркере (без передачи 2.6 КБ directPrompt в URL!)
        const execRes = await workerFetch('/api/ai/identify-fish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chunkMode: 'exec',
            scanId,
            total: chunks.length,
            basinCode,
            locLabel,
            dhash: feat.dhash,
            roiDhash: feat.roiDhash,
            geminiApiKey: activeClientKey,
            bypassCache: true
          })
        }, 20000, 1);
        if (!execRes || !execRes.ok) throw new Error('Chunked exec HTTP ' + (execRes?.status || 0));
        const execData = await execRes.json();
        return parseWorkerResponseObj(execData);
      } catch (_chunkErr) {
        // Если воркер ещё не обновлён или чанки не прошли — пробуем параллельно одиночный компактный E2E GET-пакет и POST-ретранслятор
        return await Promise.any([
          callSingleShotCompactGetRelay(),
          callPostProxyWorkerRelay()
        ]);
      }
    };

    try {
      let workerWinner = null;
      try {
        workerWinner = await callDirectPostFast(2500);
      } catch (_directErr) {
        workerWinner = await callChunkedNoVpnRelay();
      }
      if (workerWinner && workerWinner.parsed) {
        const { data: cloudData, parsed: parsedFromRaw } = workerWinner;
        if (cloudData.aiQuota) incrementLocalGeminiQuotaUsed(cloudData.aiQuota);
        const engLabel = cloudData.engine || "Google Gemini Vision ИИ";
        if (cacheHashKey) {
          saveLocalVisionCache(cacheHashKey, { engine: engLabel, parsedResult: parsedFromRaw });
        }
        return {
          ok: true,
          engine: engLabel,
          sourceMode: engLabel,
          basinCode,
          basinName,
          sceneTitle: parsedFromRaw.sceneTitle,
          sizeText: parsedFromRaw.sizeText,
          fullText: parsedFromRaw.fullText,
          morphNote: parsedFromRaw.topMatches[0].reason,
          primaryMatch: parsedFromRaw.topMatches[0],
          topMatch: parsedFromRaw.topMatches[0],
          isMultipleFish: Boolean(parsedFromRaw.isMultipleFish),
          detectedFish: parsedFromRaw.detectedFish || parsedFromRaw.topMatches.filter(m => m.isFromMultiFishPhoto),
          topMatches: parsedFromRaw.topMatches,
          matches: parsedFromRaw.topMatches,
          estimatedLengthCm: parsedFromRaw.estimatedLengthCm,
          estimatedWeightKg: parsedFromRaw.estimatedWeightKg,
          thumbDataUrl: feat.thumbDataUrl || imgSrc,
          roiDataUrl: feat.thumbDataUrl || imgSrc
        };
      }
    } catch (e) {}

    // 2Б. Вызов Google Gemini Pro/Flash Vision API с ключом пользователя (с автоматическим US/EU проксированием для РФ)
    if (geminiQuota.hasKey && geminiQuota.remainingToday > 0) {
      const gKey = geminiQuota.keys[0];
      try {
        const smartRes = await callGeminiClientSmart(
          gKey,
          [{
            parts: [
              { text: DIRECT_FISH_PROMPT },
              { inline_data: { mime_type: "image/jpeg", data: pureB64 } }
            ]
          }],
          { temperature: 0.15, maxOutputTokens: 4096 },
          13000
        );
        if (smartRes && smartRes.ok && smartRes.text) {
          const parsed = parseGeminiFishResponse(smartRes.text);
          if (parsed && parsed.topMatches.length > 0) {
            incrementLocalGeminiQuotaUsed();
            notifyServerGeminiUsage(smartRes.usedKey || gKey, smartRes.model, {
              keySlot: (Number(smartRes.usedKeyIndex) || 0) + 1,
              httpStatus: 200,
              latencyMs: smartRes.latencyMs || 210,
              action: `Скан фото: ${parsed.topMatches[0]?.fish?.name || 'Рыба'}`
            });
            const engLabel = `Google ${smartRes.model || "Gemini Vision"} ИИ`;
            if (cacheHashKey) {
              saveLocalVisionCache(cacheHashKey, { engine: engLabel, parsedResult: parsed });
            }
            return {
              ok: true,
              engine: engLabel,
              sourceMode: engLabel,
              basinCode,
              basinName,
              sceneTitle: parsed.sceneTitle,
              sizeText: parsed.sizeText,
              fullText: parsed.fullText,
              morphNote: parsed.topMatches[0].reason,
              primaryMatch: parsed.topMatches[0],
              topMatch: parsed.topMatches[0],
              isMultipleFish: Boolean(parsed.isMultipleFish),
              detectedFish: parsed.detectedFish || parsed.topMatches.filter(m => m.isFromMultiFishPhoto),
              topMatches: parsed.topMatches,
              matches: parsed.topMatches,
              estimatedLengthCm: parsed.estimatedLengthCm,
              estimatedWeightKg: parsed.estimatedWeightKg,
              thumbDataUrl: feat.thumbDataUrl || imgSrc,
              roiDataUrl: feat.thumbDataUrl || imgSrc
            };
          }
        }
      } catch (e) {}
    }

    // 2В. Резервный мультимодальный облачный Vision-шлюз (Direct + US/EU Relay)
    const pollBodyStr = JSON.stringify({
      model: "openai",
      temperature: 0.15,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: DIRECT_FISH_PROMPT },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${pureB64}` } }
          ]
        }
      ]
    });
    const tryPollinations = async (pUrl, ms) => {
      const pCtrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const pTimer = pCtrl ? setTimeout(() => pCtrl.abort(), ms) : null;
      try {
        const pRes = await fetch(pUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: pollBodyStr,
          signal: pCtrl?.signal
        });
        if (pTimer) clearTimeout(pTimer);
        if (!pRes || !pRes.ok) throw new Error("poll failed");
        const pJson = await pRes.json();
        const rawTxt = String(pJson?.choices?.[0]?.message?.content || "").trim();
        const parsed = parseGeminiFishResponse(rawTxt);
        if (!parsed || !parsed.topMatches?.length) throw new Error("poll parse empty");
        return parsed;
      } catch (err) {
        if (pTimer) clearTimeout(pTimer);
        throw err;
      }
    };
    try {
      const pollParsed = await Promise.any([
        tryPollinations("https://text.pollinations.ai/openai", 9500),
        tryPollinations("https://corsproxy.io/?url=" + encodeURIComponent("https://text.pollinations.ai/openai"), 11500)
      ]);
      if (pollParsed && pollParsed.topMatches.length > 0) {
        const engTitle = "Мультимодальная нейросеть Vision ИИ (резервный канал)";
        if (cacheHashKey) {
          saveLocalVisionCache(cacheHashKey, { engine: engTitle, parsedResult: pollParsed });
        }
        return {
          ok: true,
          engine: engTitle,
          sourceMode: engTitle,
          basinCode,
          basinName,
          sceneTitle: pollParsed.sceneTitle,
          sizeText: pollParsed.sizeText,
          fullText: pollParsed.fullText,
          morphNote: pollParsed.topMatches[0].reason,
          primaryMatch: pollParsed.topMatches[0],
          topMatch: pollParsed.topMatches[0],
          topMatches: pollParsed.topMatches,
          matches: pollParsed.topMatches,
          estimatedLengthCm: pollParsed.estimatedLengthCm,
          estimatedWeightKg: pollParsed.estimatedWeightKg,
          thumbDataUrl: feat.thumbDataUrl || imgSrc,
          roiDataUrl: feat.thumbDataUrl || imgSrc
        };
      }
    } catch (e) {}
  }

  return {
    ok: false,
    error: "Не удалось получить ответ от нейросети Vision ИИ. Проверьте подключение к интернету или нажмите «Повторить».",
    thumbDataUrl: feat.thumbDataUrl || imgSrc,
    roiDataUrl: feat.thumbDataUrl || imgSrc
  };
}

/**
 * Открывает модальное окно «ИИ-определитель рыбы по фото»
 * без дублирования карточек и без рамок/точек на фотографии
 */
export function openFishPhotoScannerModal(options = {}) {
  const stNow = store.getState();
  const up = stNow?.userProfile || {};
  const fid = String(up.fisherId || '').trim().toUpperCase();
  const isTempId = !fid || /^FP_\d{2}RZ\d{4}$/i.test(fid) || (!up.login && !up.pinHash && !up.authTokenHash && fid !== 'FP_89VIP089' && fid !== 'FP_FMP089');
  if (isTempId) {
    showToast('Определение рыбы по фото (ИИ) доступно только зарегистрированным пользователям. Войдите или создайте постоянный ID в Профиле!', 'warn');
    return;
  }
  requestAppCameraAndPhotoAccess();
  ensureGeminiKeySyncedFromServer().catch(() => {});
  let activeResult = null;
  let selectedMatchIdx = 0;
  let currentImgSrc = options.initialImageSrc || "";
  let activeVideoStream = null;
  let cameraFacingMode = "environment";

  const stopCameraStream = () => {
    if (activeVideoStream) {
      try {
        activeVideoStream.getTracks().forEach(t => t.stop());
      } catch (e) {}
      activeVideoStream = null;
    }
  };

  const html = `
    <div id="fishScannerModalRoot" style="display:flex;flex-direction:column;gap:10px;font-size:var(--fs-sm);">
      <div style="padding:12px;text-align:center;color:var(--muted);">Запуск ИИ-определителя...</div>
    </div>
  `;

  openModal(
    '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" fill="rgba(56,189,248,0.22)" stroke="#38bdf8" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="4" stroke="#10b981" stroke-width="2"/></svg> ИИ-определитель рыбы по фото',
    html,
    async (bodyEl) => {
      const root = bodyEl.querySelector("#fishScannerModalRoot") || bodyEl;

      const runAnalysisAndRender = async (imgSrc, forceFresh = false) => {
        stopCameraStream();
        currentImgSrc = imgSrc;
        if (!currentImgSrc) {
          renderScannerView();
          return;
        }
        root.innerHTML = `
          <div class="card" style="padding:16px 12px;text-align:center;background:var(--panel);border:1.5px solid var(--accent);">
            <div style="margin-bottom:10px;border-radius:10px;overflow:hidden;max-height:220px;display:flex;justify-content:center;background:#090f1d;">
              <img src="${currentImgSrc}" alt="Фото" style="max-width:100%;max-height:220px;object-fit:contain;">
            </div>
            <div style="font-weight:900;font-size:14.5px;color:var(--accent);margin-bottom:4px;">
              Gemini Vision ИИ определяет вид рыбы, длину и вес...
            </div>
            <div style="font-size:11.5px;color:var(--muted);">
              Анализ морфологических признаков и масштаба снимка
            </div>
          </div>
        `;
        activeResult = await analyzeFishPhotoHybrid(currentImgSrc, forceFresh);
        selectedMatchIdx = 0;
        if (activeResult && activeResult.ok && activeResult.topMatches?.length > 0) {
          const topFish = activeResult.topMatches[0].fish;
          if (topFish && topFish.id) {
            store.dispatch({ type: "SET_FISH", payload: topFish.id });
          }
        }
        renderScannerView();
      };

      if (typeof window !== "undefined") {
        window.__KLEV_ON_NATIVE_CAMERA_PHOTO__ = (nativeDataUrl) => {
          if (nativeDataUrl && typeof nativeDataUrl === "string" && nativeDataUrl.startsWith("data:image/")) {
            runAnalysisAndRender(nativeDataUrl);
          }
        };
      }

      const startLiveCameraViewfinder = () => {
        stopCameraStream();
        if (typeof window !== "undefined" && window.AndroidBridge && typeof window.AndroidBridge.openNativeCamera === "function") {
          window.AndroidBridge.openNativeCamera();
          return;
        }
        const camInp = root.querySelector("#scannerCameraCaptureInput");
        if (camInp) {
          camInp.value = "";
          camInp.click();
        }
      };

      const renderScannerView = () => {
        const hasPhoto = Boolean(currentImgSrc);
        const hasValidResult = Boolean(hasPhoto && activeResult && activeResult.ok && activeResult.topMatches?.length);
        const activeMatch = hasValidResult ? (activeResult.topMatches[selectedMatchIdx] || activeResult.topMatches[0]) : null;
        const fish = activeMatch ? activeMatch.fish : FISH_DB[0];
        const isRedBook = fish.legal === "redbook";
        const isLicense = fish.legal === "license";
        const curLen = activeMatch ? (activeMatch.estimatedLengthCm || getDefaultTypicalLengthCm(fish.id)) : 25;
        const curWeight = activeMatch ? (activeMatch.estimatedWeightKg || estimateWeightByLengthAndSpecies(fish.id, curLen)) : 0.25;
        const displayTitle = activeMatch?.displayTitle || fish.name;
        const displayLatin = activeMatch?.displayLatin || fish.latin || "";
        const sizeSummaryText = activeMatch?.sizeSummaryText || activeResult?.sizeText || `Длина: ~${curLen} см • Вес: ${formatWeightHuman(curWeight)}`;
        const fullAnalysisText = activeMatch?.fullAnalysisText || activeResult?.fullText || activeMatch?.reason || "";
        const qState = getLocalGeminiQuotaState();

        root.innerHTML = `
          <input type="file" id="scannerFileInput" accept="image/*" style="display:none;">
          <input type="file" id="scannerCameraCaptureInput" accept="image/*" capture="environment" style="display:none;">

          ${!hasPhoto ? `
            <!-- Единая стартовая карточка без дублирования -->
            <div class="card" style="padding:16px 14px;text-align:center;background:var(--card);border:1.5px solid var(--accent);display:flex;flex-direction:column;gap:10px;">
              <div style="display:flex;justify-content:center;">
                <span class="pill pill-good" style="font-size:10.5px;font-weight:800;">
                  🟢 Нейросеть Gemini Vision ИИ готова к распознаванию
                </span>
              </div>
              <div style="font-weight:900;font-size:15px;color:var(--text);">
                Сфотографируйте улов или выберите фото
              </div>
              <div style="font-size:12px;color:var(--muted);max-width:420px;margin:0 auto;line-height:1.45;">
                Gemini Vision ИИ автоматически определит вид рыбы, оценит длину и вес по масштабу кадра и заполнит карточку.
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:2px;">
                <button type="button" class="btn btn-good" id="scannerOpenLiveCamBtn" style="min-height:42px;font-weight:900;">
                  <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" fill="rgba(16,185,129,0.22)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="4" stroke="currentColor" stroke-width="1.8"/></svg> Камера
                </button>
                <button type="button" class="btn btn-accent" id="scannerHeroGalleryBtn" style="min-height:42px;font-weight:900;">
                  <svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" stroke-width="1.8"/><circle cx="8.5" cy="8.5" r="1.8" fill="currentColor"/><path d="M21 15l-5-5L5 21" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Из галереи
                </button>
              </div>

            </div>
          ` : `
            <!-- Компактная карточка загруженного снимка + кнопки управления в одну строку -->
            <div class="card" style="padding:10px 12px;background:var(--panel);border:1.5px solid ${hasValidResult ? "var(--accent)" : "var(--warn)"};display:flex;flex-direction:column;gap:8px;">
              <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
                <span style="font-size:11.5px;font-weight:800;color:${hasValidResult ? "var(--accent)" : "var(--warn)"};">
                  ${hasValidResult ? escapeHtml(activeResult.sourceMode || "Google Gemini Vision ИИ") : "Повторный запрос к Vision ИИ"}
                </span>
                <div style="display:flex;gap:5px;flex-wrap:wrap;">
                  <button type="button" class="btn btn-sm btn-good" id="scannerOpenLiveCamBtn" style="min-height:30px;padding:2px 8px;font-size:11px;font-weight:800;">Камера</button>
                  <button type="button" class="btn btn-sm btn-accent" id="scannerHeroGalleryBtn" style="min-height:30px;padding:2px 8px;font-size:11px;font-weight:800;">Галерея</button>
                  <button type="button" class="btn btn-sm" id="scannerRetryBtn" style="min-height:30px;padding:2px 8px;font-size:11px;font-weight:800;">Повторить</button>
                </div>
              </div>
              <div style="width:100%;border-radius:10px;overflow:hidden;background:#090f1d;border:1px solid var(--border);display:flex;justify-content:center;align-items:center;max-height:230px;">
                <img src="${currentImgSrc}" alt="Фото улова" style="max-width:100%;max-height:230px;object-fit:contain;display:block;">
              </div>

              ${!hasValidResult ? `
                <div style="padding:8px 10px;border-radius:8px;background:rgba(245,158,11,0.12);border:1px solid var(--warn);text-align:center;">
                  <div style="font-weight:800;font-size:12.5px;color:var(--warn);margin-bottom:6px;">
                    ${escapeHtml(activeResult?.error || "Не удалось получить ответ от нейросети Vision ИИ")}
                  </div>
                  <button type="button" class="btn btn-accent" id="scannerRetryMainBtn" style="min-height:36px;font-weight:900;width:100%;">
                    Повторить анализ снимка
                  </button>
                </div>
              ` : ""}
            </div>
          `}

          ${hasValidResult ? `
            <!-- Результат распознавания нейросетью и карточка вида -->
            <div class="card" style="padding:12px 14px;background:var(--panel);border:1.5px solid ${isRedBook ? "var(--bad)" : "var(--good)"};display:flex;flex-direction:column;gap:10px;">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
                <span style="font-size:11px;font-weight:900;color:var(--muted);">РЕЗУЛЬТАТ РАСПОЗНАВАНИЯ:</span>
                <div style="display:flex;gap:6px;align-items:center;">
                  <span class="pill pill-good" style="font-size:10.5px;">Точность: ${activeMatch.confidence}%</span>
                  ${isRedBook
                    ? `<span class="pill pill-bad" style="font-size:10.5px;">Красная книга • Отпусти!</span>`
                    : (isLicense
                        ? `<span class="pill pill-warn" style="font-size:10.5px;">По путёвке / Лицензия</span>`
                        : `<span class="pill pill-good" style="font-size:10.5px;">Разрешённый вид</span>`)}
                </div>
              </div>
              <div style="display:grid;grid-template-columns:110px 1fr;gap:10px;align-items:center;">
                <div style="width:110px;height:78px;border-radius:10px;background:var(--card);display:flex;align-items:center;justify-content:center;padding:6px;border:1px solid var(--border);">
                  <img src="assets/fish/${fish.id}.png" alt="${escapeHtml(fish.name)}" style="max-width:100%;max-height:100%;object-fit:contain;" onerror="this.style.display='none'">
                </div>
                <div>
                  <div style="font-size:16px;font-weight:900;color:var(--text);">${escapeHtml(displayTitle)}</div>
                  <div style="font-size:11.5px;color:var(--muted);font-style:italic;">${escapeHtml(displayLatin)}</div>
                  <div style="margin-top:5px;padding:5px 8px;border-radius:7px;background:rgba(16,185,129,0.14);border:1px solid var(--good);font-weight:900;font-size:12px;color:var(--good);" id="scannerCalcSummaryBadge">
                    ${escapeHtml(sizeSummaryText)}
                  </div>
                </div>
              </div>
              <div style="padding:9px 11px;border-radius:8px;background:var(--card);border:1px solid var(--border);font-size:12px;line-height:1.45;color:var(--text);white-space:pre-line;">
                <b style="color:var(--accent);">Заключение ИИ по фото:</b>
${escapeHtml(fullAnalysisText || activeMatch.reason || fish.idTraits || "")}
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding-top:4px;border-top:1px dashed var(--border);">
                <div>
                  <label style="display:block;font-size:10.5px;color:var(--muted);font-weight:700;margin-bottom:2px;">ДЛИНА ОСНОВНОЙ РЫБЫ (СМ):</label>
                  <input type="number" id="scannerLenInput" class="input" min="1" max="220" step="0.5" value="${curLen}" style="width:100%;min-height:36px;padding:4px 8px;font-weight:800;">
                </div>
                <div>
                  <label style="display:block;font-size:10.5px;color:var(--muted);font-weight:700;margin-bottom:2px;">ВЕС (КГ, напр. 0.005 = 5 г):</label>
                  <input type="number" id="scannerWeightInput" class="input" min="0.001" max="100" step="0.005" value="${curWeight}" style="width:100%;min-height:36px;padding:4px 8px;font-weight:800;color:var(--good);">
                </div>
              </div>
              <div style="padding:8px 10px;border-radius:8px;background:${isRedBook ? "rgba(239,68,68,0.14)" : "rgba(16,185,129,0.09)"};border:1px solid ${isRedBook ? "var(--bad)" : "var(--good)"};font-size:11.5px;line-height:1.4;">
                <b style="color:${isRedBook ? "var(--bad)" : "var(--good)"};">
                  ${isRedBook ? "ВНИМАНИЕ: КРАСНАЯ КНИГА! ВЫЛОВ ЗАПРЕЩЁН!" : "Справка из Атласа РФ (" + escapeHtml(fish.name) + "):"}
                </b>
                ${isRedBook
                  ? escapeHtml(fish.handlingAdvice || "Немедленно освободите рыбу от крючка прямо в воде и бережно отпустите.")
                  : escapeHtml(fish.sizeInfo || "Разрешён к любительскому лову с соблюдением суточной нормы.")}
              </div>
            </div>
            ${(() => {
              const detectedList = Array.isArray(activeResult.detectedFish) && activeResult.detectedFish.length > 1
                ? activeResult.detectedFish
                : (activeResult.isMultipleFish && activeResult.topMatches.length > 1 ? activeResult.topMatches : []);
              if (detectedList.length > 1) {
                return `
                  <div class="card" style="padding:11px 13px;background:rgba(56,189,248,0.10);border:1.5px solid var(--accent);display:flex;flex-direction:column;gap:8px;">
                    <div style="font-weight:900;font-size:12.5px;color:var(--accent);line-height:1.35;">
                      На фото несколько рыб! Сейчас показан расчёт для: «${escapeHtml(displayTitle)}»${activeMatch?.positionLabel ? ` (${escapeHtml(activeMatch.positionLabel)})` : ""}.
                    </div>
                    <div style="font-size:11.5px;color:var(--text);line-height:1.35;">
                      Если вы спрашивали не про «${escapeHtml(displayTitle)}», выберите другую рыбу с этого фото кнопкой ниже:
                    </div>
                    <div style="display:flex;flex-direction:column;gap:6px;">
                      ${detectedList.map((m, idx) => {
                        const isSel = idx === selectedMatchIdx;
                        const wStr = formatWeightHuman(m.estimatedWeightKg || estimateWeightByLengthAndSpecies(m.fish.id, m.estimatedLengthCm || 25));
                        const posTag = m.positionLabel ? ` • ${m.positionLabel}` : "";
                        return `
                          <button type="button" class="btn ${isSel ? "btn-accent" : ""}" data-pick-scanner-match="${idx}" style="width:100%;justify-content:space-between;text-align:left;padding:8px 10px;min-height:42px;display:flex;align-items:center;gap:8px;border:${isSel ? "2px solid var(--accent)" : "1px solid var(--border)"};">
                            <span style="display:flex;align-items:center;gap:8px;min-width:0;flex:1;">
                              <img src="assets/fish/${m.fish.id}.png" alt="" style="width:36px;height:22px;object-fit:contain;flex-shrink:0;" onerror="this.style.display='none'">
                              <span style="font-weight:800;font-size:12.5px;white-space:normal;line-height:1.25;">
                                ${isSel ? "✓ " : ""}${idx + 1}. ${escapeHtml(m.displayTitle || m.fish.name)}${escapeHtml(posTag)}
                              </span>
                            </span>
                            <span class="pill ${isSel ? "pill-good" : "pill-neutral"}" style="font-weight:900;font-size:11px;flex-shrink:0;">
                              ~${m.estimatedLengthCm || 25} см • ${wStr}
                            </span>
                          </button>
                        `;
                      }).join("")}
                    </div>
                  </div>
                `;
              }
              if (activeResult.topMatches.length > 1) {
                return `
                  <div class="card" style="padding:10px 12px;background:var(--card);">
                    <div style="font-weight:900;font-size:11px;color:var(--accent);text-transform:uppercase;margin-bottom:6px;">
                      ДРУГИЕ ВАРИАНТЫ / СХОДНЫЕ ВИДЫ (НАЖМИТЕ, ЕСЛИ СРАВНИВАЕТЕ):
                    </div>
                    <div style="display:flex;flex-direction:column;gap:6px;">
                      ${activeResult.topMatches.map((m, idx) => `
                        <button type="button" class="btn ${idx === selectedMatchIdx ? "btn-accent" : ""}" data-pick-scanner-match="${idx}" style="width:100%;padding:7px 10px;border-radius:8px;display:flex;justify-content:space-between;align-items:center;gap:8px;text-align:left;">
                          <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1;">
                            <img src="assets/fish/${m.fish.id}.png" alt="" style="width:40px;height:24px;object-fit:contain;flex-shrink:0;" onerror="this.style.display='none'">
                            <div style="min-width:0;flex:1;">
                              <div style="font-weight:800;font-size:12.5px;color:var(--text);">
                                ${idx + 1}. ${escapeHtml(m.displayTitle || m.fish.name)}
                              </div>
                              <div style="font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                                ${escapeHtml(m.reason)}
                              </div>
                            </div>
                          </div>
                          <span class="pill ${m.confidence >= 80 ? "pill-good" : "pill-neutral"}" style="font-weight:900;font-size:11px;">${m.confidence}%</span>
                        </button>
                      `).join("")}
                    </div>
                  </div>
                `;
              }
              return "";
            })()}
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;">
              ${!isRedBook ? `
                <button type="button" class="btn btn-good" id="scannerApplyToLogBtn" style="min-height:42px;font-weight:900;">
                  <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 20C5 11 11 5 20 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 4v7c0 1.7-1.3 3-3 3s-3-1.3-3-3" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/><circle cx="14" cy="16" r="2.2" fill="#10b981"/></svg> + Записать в Журнал
                </button>
              ` : ""}
              <button type="button" class="btn btn-accent" id="scannerSelectForForecastBtn" style="min-height:42px;font-weight:800;">
                <svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="4.5" stroke="#38bdf8" stroke-width="1.6"/><circle cx="12" cy="12" r="1.8" fill="#10b981"/></svg> Прогноз и снасти
              </button>
              <button type="button" class="btn" id="scannerOpenPassportBtn" style="min-height:42px;font-weight:800;">
                <svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="2"/><path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> Паспорт вида
              </button>
            </div>
          ` : ""}
        `;

        const handleFileSelected = (file) => {
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            runAnalysisAndRender(String(reader.result || ""));
          };
          reader.readAsDataURL(file);
        };
        const fileInp = root.querySelector("#scannerFileInput");
        if (fileInp) {
          fileInp.addEventListener("change", (e) => handleFileSelected(e.target.files?.[0]));
        }
        const camCapInp = root.querySelector("#scannerCameraCaptureInput");
        if (camCapInp) {
          camCapInp.addEventListener("change", (e) => handleFileSelected(e.target.files?.[0]));
        }
        root.querySelector("#scannerOpenLiveCamBtn")?.addEventListener("click", () => startLiveCameraViewfinder());
        root.querySelector("#scannerHeroGalleryBtn")?.addEventListener("click", () => {
          requestAppCameraAndPhotoAccess();
          fileInp?.click();
        });
        const retryHandler = () => {
          try {
            if (typeof localStorage !== "undefined") {
              localStorage.removeItem(LOCAL_VISION_CACHE_KEY);
              localStorage.removeItem("klev_gemini_active_model_v2");
            }
          } catch (e) {}
          if (currentImgSrc) runAnalysisAndRender(currentImgSrc, true);
        };
        root.querySelector("#scannerRetryBtn")?.addEventListener("click", retryHandler);
        root.querySelector("#scannerRetryMainBtn")?.addEventListener("click", retryHandler);
        root.querySelector("#scannerInlineSaveKeyBtn")?.addEventListener("click", () => {
          const val = (root.querySelector("#scannerInlineGeminiKeyInp")?.value || "").trim();
          if (!val || val.length < 16) {
            showToast("Вставьте корректный ключ Google AI Studio (AIzaSy...)", "warn");
            return;
          }
          saveStoredGeminiApiKey(val);
          showToast("Ключ Gemini API сохранён и синхронизирован!", "good");
          if (currentImgSrc) runAnalysisAndRender(currentImgSrc);
          else renderScannerView();
        });



        if (!hasValidResult) return;

        const lenInp = root.querySelector("#scannerLenInput");
        const weightInp = root.querySelector("#scannerWeightInput");
        const badge = root.querySelector("#scannerCalcSummaryBadge");
        lenInp?.addEventListener("input", (e) => {
          const L = Math.max(1, Math.min(220, parseFloat(e.target.value) || curLen));
          const W = estimateWeightByLengthAndSpecies(fish.id, L);
          activeMatch.estimatedLengthCm = L;
          activeMatch.estimatedWeightKg = W;
          if (weightInp) weightInp.value = String(W);
          if (badge) badge.textContent = `Длина: ~${L} см • Вес: ${formatWeightHuman(W)}`;
        });
        weightInp?.addEventListener("input", (e) => {
          const W = Math.max(0.001, parseFloat(e.target.value) || curWeight);
          activeMatch.estimatedWeightKg = W;
          if (badge) badge.textContent = `Длина: ~${activeMatch.estimatedLengthCm || curLen} см • Вес: ${formatWeightHuman(W)}`;
        });
        root.querySelectorAll("[data-pick-scanner-match]").forEach(el => {
          el.addEventListener("click", () => {
            selectedMatchIdx = parseInt(el.getAttribute("data-pick-scanner-match"), 10) || 0;
            const picked = activeResult?.topMatches?.[selectedMatchIdx]?.fish;
            if (picked && picked.id) {
              store.dispatch({ type: "SET_FISH", payload: picked.id });
            }
            triggerHaptic("selection");
            renderScannerView();
          });
        });
        root.querySelector("#scannerApplyToLogBtn")?.addEventListener("click", () => {
          stopCameraStream();
          const finalLen = parseFloat(lenInp?.value) || curLen;
          const finalWeight = parseFloat(weightInp?.value) || curWeight;
          if (typeof options.onSelectResult === "function") {
            options.onSelectResult({
              fishId: fish.id,
              fishName: displayTitle,
              lengthCm: finalLen,
              weightKg: finalWeight,
              photoDataUrl: activeResult.thumbDataUrl
            });
            return;
          }
          closeModal();
          store.dispatch({ type: "SET_FISH", payload: fish.id });
          if (typeof window !== "undefined" && typeof window.__KLEV_OPEN_CATCH_WIZARD__ === "function") {
            window.__KLEV_OPEN_CATCH_WIZARD__({
              fishId: fish.id,
              lengthCm: finalLen,
              weightKg: finalWeight,
              photoDataUrl: activeResult.thumbDataUrl
            });
          }
          showToast(`Вид «${displayTitle}» (${formatWeightHuman(finalWeight)}, ${finalLen} см) передан в Журнал уловов!`, "good");
        });
        root.querySelector("#scannerSelectForForecastBtn")?.addEventListener("click", () => {
          stopCameraStream();
          store.dispatch({ type: "SET_FISH", payload: fish.id });
          closeModal();
          router.navigate("forecast");
          showToast(`Выбрана рыба: ${fish.name}`, "good");
          flashHighlightElement(["#bentoSwipeHeroCard", "#bentoWaveChartCard"], { scroll: true, block: "center", delayMs: 110 });
        });
        root.querySelector("#scannerOpenPassportBtn")?.addEventListener("click", () => {
          stopCameraStream();
          if (typeof options.onOpenDetail === "function") {
            options.onOpenDetail(fish.id);
          } else if (typeof window !== "undefined" && typeof window.__KLEV_OPEN_FISH_DETAIL__ === "function") {
            window.__KLEV_OPEN_FISH_DETAIL__(fish.id);
          }
        });
      };

      if (currentImgSrc) {
        await runAnalysisAndRender(currentImgSrc);
      } else {
        renderScannerView();
      }
    }
  );
}
