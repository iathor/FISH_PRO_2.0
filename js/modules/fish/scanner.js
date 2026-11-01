/**
 * @file scanner.js
 * @description Мультимодальный нейро-определитель рыбы по фото («Ихтио-Сканер» v2.5.6):
 * - Прямое распознавание полного снимка через Gemini Flash Vision ИИ (gemini-3.5-flash-lite / 3.6-flash / 3.8-flash / 2.5-flash)
 * - Единый прямой промпт без рамок/точек/квадратов на фото: «Определи, что за рыба на фото, примерный размер и вес»
 * - Автоматическая подстановка ответа нейросети (вид, размер, вес в г/кг, диагностические признаки и разбор нескольких рыб в кадре) в карточку Атласа РФ
 */
import { store } from '../../core/store.js?v=2.5.6';
import { router } from '../../core/router.js?v=2.5.6';
import { RELAY_WORKER_URL, triggerHaptic } from '../../core/telegram.js?v=2.5.6';
import { BASIN_CONFIGS } from '../../data/basins.js?v=2.5.6';
import { FISH_DB } from '../../data/species.js?v=2.5.6';
import { escapeHtml, openModal, closeModal, showToast } from '../../ui/components.js?v=2.5.6';
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
  const L = Math.max(2, Math.min(220, Number(lengthCm) || 25));
  const k = FULTON_CONDITION_K[fishId] || 1.25;
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
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return {
      dhash: '0000000000000000',
      roiDhash: '0000000000000000',
      thumbDataUrl: imgSrc,
      roiDataUrl: imgSrc
    };
  }
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const w = img.naturalWidth || img.width || 640;
          const h = img.naturalHeight || img.height || 480;
          let dhash = '0000000000000000';
          const c98 = document.createElement('canvas');
          c98.width = 9;
          c98.height = 8;
          const ctx98 = c98.getContext('2d');
          if (ctx98) {
            ctx98.drawImage(img, 0, 0, w, h, 0, 0, 9, 8);
            const p98 = ctx98.getImageData(0, 0, 9, 8).data;
            let bits = '';
            for (let y = 0; y < 8; y++) {
              for (let x = 0; x < 8; x++) {
                const i1 = (y * 9 + x) * 4;
                const i2 = (y * 9 + x + 1) * 4;
                const g1 = p98[i1] * 0.299 + p98[i1 + 1] * 0.587 + p98[i1 + 2] * 0.114;
                const g2 = p98[i2] * 0.299 + p98[i2 + 1] * 0.587 + p98[i2 + 2] * 0.114;
                bits += g1 < g2 ? '1' : '0';
              }
            }
            const h1 = parseInt(bits.slice(0, 32), 2).toString(16).padStart(8, '0');
            const h2 = parseInt(bits.slice(32, 64), 2).toString(16).padStart(8, '0');
            dhash = h1 + h2;
          }
          const maxSide = 960;
          const scale = Math.min(1, maxSide / Math.max(w, h));
          const cThumb = document.createElement('canvas');
          cThumb.width = Math.max(80, Math.round(w * scale));
          cThumb.height = Math.max(80, Math.round(h * scale));
          const ctxT = cThumb.getContext('2d');
          let thumbDataUrl = imgSrc;
          if (ctxT) {
            ctxT.drawImage(img, 0, 0, cThumb.width, cThumb.height);
            thumbDataUrl = cThumb.toDataURL('image/jpeg', 0.85);
          }
          resolve({
            dhash,
            roiDhash: dhash,
            thumbDataUrl,
            roiDataUrl: thumbDataUrl
          });
        } catch (e) {
          resolve({
            dhash: '0000000000000000',
            roiDhash: '0000000000000000',
            thumbDataUrl: imgSrc,
            roiDataUrl: imgSrc
          });
        }
      };
      img.onerror = () => {
        resolve({
          dhash: '0000000000000000',
          roiDhash: '0000000000000000',
          thumbDataUrl: imgSrc,
          roiDataUrl: imgSrc
        });
      };
      img.src = imgSrc;
    } catch (err) {
      resolve({
        dhash: '0000000000000000',
        roiDhash: '0000000000000000',
        thumbDataUrl: imgSrc,
        roiDataUrl: imgSrc
      });
    }
  });
}
const LOCAL_VISION_CACHE_KEY = 'klev_vision_ai_cache_v258_direct';
const LOCAL_GEMINI_KEY_STORAGE = 'klev_gemini_api_key_v2';
const LOCAL_GEMINI_QUOTA_STORAGE = 'klev_gemini_quota_v2';
export function getStoredGeminiApiKey() {
  try {
    const s = store.getState();
    const fromProfile = String(s?.userProfile?.geminiApiKey || '').trim();
    if (fromProfile && fromProfile.length >= 16) return fromProfile;
    if (typeof localStorage !== 'undefined') {
      const fromLs = String(localStorage.getItem(LOCAL_GEMINI_KEY_STORAGE) || '').trim();
      if (fromLs && fromLs.length >= 16) return fromLs;
    }
  } catch (e) {}
  return '';
}
export function saveStoredGeminiApiKey(rawKey = '') {
  const clean = String(rawKey || '').trim();
  try {
    if (typeof localStorage !== 'undefined') {
      if (clean) localStorage.setItem(LOCAL_GEMINI_KEY_STORAGE, clean);
      else localStorage.removeItem(LOCAL_GEMINI_KEY_STORAGE);
    }
    store.dispatch({ type: 'UPDATE_USER_PROFILE', payload: { geminiApiKey: clean } });
  } catch (e) {}
  return clean;
}
export function getLocalGeminiQuotaState(customKeyStr = null) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const rawKeys = String(customKeyStr !== null ? customKeyStr : getStoredGeminiApiKey())
    .split(',')
    .map(k => k.trim().replace(/^["'\s]+|["'\s]+$/g, ''))
    .filter(k => k.length >= 16);
  const keyCount = rawKeys.length;
  const limitPerDay = Math.max(1500, keyCount * 1500);
  let usedToday = 0;
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = JSON.parse(localStorage.getItem(LOCAL_GEMINI_QUOTA_STORAGE) || '{}');
      if (raw && raw.dateKey === todayStr && Number.isFinite(Number(raw.usedToday))) {
        usedToday = Math.max(0, Number(raw.usedToday));
      }
    }
  } catch (e) {}
  const remainingToday = Math.max(0, limitPerDay - usedToday);
  const pctRemaining = Math.round((remainingToday / limitPerDay) * 100);
  return {
    hasKey: keyCount > 0,
    keyCount,
    keys: rawKeys,
    limitPerDay,
    usedToday,
    remainingToday,
    pctRemaining,
    dateKey: todayStr
  };
}
export function incrementLocalGeminiQuotaUsed(serverQuotaObj = null) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const cur = getLocalGeminiQuotaState();
  const nextUsed = (serverQuotaObj && Number.isFinite(Number(serverQuotaObj.usedToday)))
    ? Math.max(cur.usedToday + 1, Number(serverQuotaObj.usedToday))
    : (cur.usedToday + 1);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LOCAL_GEMINI_QUOTA_STORAGE, JSON.stringify({
        dateKey: todayStr,
        usedToday: nextUsed,
        limitPerDay: cur.limitPerDay
      }));
    }
  } catch (e) {}
  return getLocalGeminiQuotaState();
}
const CLIENT_GEMINI_MODELS_CASCADE = [
  'gemini-3.5-flash-lite',
  'gemini-3.6-flash',
  'gemini-3.8-flash',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3.7-flash',
  'gemini-3.5-flash',
  'gemini-3-flash-preview',
  'gemini-2.5-pro'
];
export async function callGeminiClientSmart(apiKey, contentsPayload, genConfig = {}, timeoutMs = 8500) {
  const cleanKey = String(apiKey || '').trim().replace(/^["'\s]+|["'\s]+$/g, '');
  if (!cleanKey) return { ok: false, status: 400, errorText: 'Empty key' };
  const candidates = [];
  try {
    if (typeof localStorage !== 'undefined') {
      const savedMod = String(localStorage.getItem('klev_gemini_active_model_v2') || '').trim();
      if (savedMod && !/2\.0-flash|flash-latest/i.test(savedMod)) {
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
      const lCtrl = new AbortController();
      const lTimer = setTimeout(() => lCtrl.abort(), 3200);
      const lRes = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(cleanKey), {
        method: 'GET',
        signal: lCtrl.signal
      }).catch(() => null);
      clearTimeout(lTimer);
      if (lRes && lRes.ok) {
        const lData = await lRes.json().catch(() => null);
        if (lData && Array.isArray(lData.models)) {
          for (const m of lData.models) {
            const methods = Array.isArray(m.supportedGenerationMethods) ? m.supportedGenerationMethods : [];
            if (!methods.includes('generateContent')) continue;
            const id = String(m.name || '').replace(/^models\//, '');
            if (!id.startsWith('gemini-')) continue;
            if (/embedding|imagen|veo|tts|audio|aqa|bisect|learnlm|robotics|computer-use|-image$|2\.0-flash|flash-latest|1\.0/i.test(id)) continue;
            if (!candidates.includes(id)) candidates.push(id);
          }
        }
      }
    } catch (e) {}
  };
  if (candidates.length === CLIENT_GEMINI_MODELS_CASCADE.length) {
    await discoverModels();
  }
  let lastStatus = 0;
  let lastErrorText = '';
  const maxAttempts = Math.min(5, candidates.length);
  for (let i = 0; i < maxAttempts; i++) {
    const modelId = candidates[i];
    try {
      const gCtrl = new AbortController();
      const gTimer = setTimeout(() => gCtrl.abort(), timeoutMs);
      const gUrl = 'https://generativelanguage.googleapis.com/v1beta/models/' + modelId + ':generateContent?key=' + encodeURIComponent(cleanKey);
      const gRes = await fetch(gUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: contentsPayload,
          generationConfig: {
            temperature: genConfig.temperature ?? 0.15,
            maxOutputTokens: genConfig.maxOutputTokens ?? 4096
          }
        }),
        signal: gCtrl.signal
      }).catch(() => null);
      clearTimeout(gTimer);
      if (!gRes) continue;
      lastStatus = gRes.status;
      if (gRes.ok) {
        const gJson = await gRes.json().catch(() => null);
        const parts = gJson?.candidates?.[0]?.content?.parts || [];
        const nonThought = parts.filter(p => !p.thought && typeof p.text === 'string');
        const rawTxt = (nonThought.length > 0 ? nonThought.map(p => p.text).join('\n') : parts.map(p => p.text || '').join('\n')).trim();
        if (rawTxt) {
          try {
            if (typeof localStorage !== 'undefined') localStorage.setItem('klev_gemini_active_model_v2', modelId);
          } catch (e) {}
          return { ok: true, model: modelId, status: 200, json: gJson, text: rawTxt };
        }
      }
      const errTxt = await gRes.text().catch(() => '');
      lastErrorText = errTxt;
      if (gRes.status === 404) {
        await discoverModels();
        const suggested = errTxt.match(/models\/(gemini-[a-z0-9.-]+)/i);
        if (suggested && suggested[1] && !candidates.includes(suggested[1]) && !/2\.0-flash/i.test(suggested[1])) {
          candidates.splice(i + 1, 0, suggested[1]);
        }
      }
    } catch (e) {}
  }
  return {
    ok: false,
    model: candidates[0] || 'gemini-3.5-flash-lite',
    status: lastStatus,
    errorText: lastErrorText
  };
}
function loadLocalVisionCache() {
  try {
    if (typeof localStorage === 'undefined') return {};
    return JSON.parse(localStorage.getItem(LOCAL_VISION_CACHE_KEY) || '{}') || {};
  } catch (e) {
    return {};
  }
}
function saveLocalVisionCache(hashKey, resultObj) {
  try {
    if (typeof localStorage === 'undefined' || !hashKey || hashKey === '0000000000000000') return;
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
  { id: 'crucian', rx: /карас|carassius/i },
  { id: 'flounder', rx: /речная камбал|камбал.*flesus|platichthys|камбал/i },
  { id: 'plaice', rx: /морская камбал|pleuronectes/i },
  { id: 'starry_flounder', rx: /звездчатая камбал|звёздчатая камбал/i },
  { id: 'halibut', rx: /палтус|hippoglossus/i },
  { id: 'turbot', rx: /калкан|тюрбо|scophthalmus/i },
  { id: 'amur_pike', rx: /амурская щук|reichertii/i },
  { id: 'pike', rx: /щук|щурён|щурен|esox/i },
  { id: 'chinese_perch', rx: /ауха|китайский окун|siniperca/i },
  { id: 'sea_bass', rx: /сибас|лаврак|морской окун|dicentrarchus|sebastes/i },
  { id: 'perch', rx: /окун|окушок|матросик|perca/i },
  { id: 'volga_zander', rx: /берш|volgensis/i },
  { id: 'zander', rx: /судак|клыкач|sander lucioperca/i },
  { id: 'ruffe', rx: /ёрш|ерш|gymnocephalus/i },
  { id: 'rotan', rx: /ротан|головешк|perccottus/i },
  { id: 'goby', rx: /бычок|бычки|neogobius|ponticola/i },
  { id: 'taran', rx: /тарань|heckeli/i },
  { id: 'vobla', rx: /вобла|caspicus/i },
  { id: 'kutum', rx: /кутум|вырезуб|frisii/i },
  { id: 'roach', rx: /плотв|сорог|сорожк|чебак|rutilus/i },
  { id: 'dace', rx: /елец|ельчик|мохтик|leuciscus/i },
  { id: 'ide', rx: /язь|подъязок|leuciscus idus/i },
  { id: 'chub', rx: /голавл|squalius|cephalus/i },
  { id: 'rudd', rx: /красноперк|краснопёрк|scardinius/i },
  { id: 'asp', rx: /жерех|шереспер|aspius/i },
  { id: 'white_bream', rx: /густер|bjoerkna/i },
  { id: 'blue_bream', rx: /синец|balliche|ballerus/i },
  { id: 'sopa', rx: /белоглазк|сопа|sapa/i },
  { id: 'parabramis', rx: /белый амурский лещ|черный лещ|parabramis/i },
  { id: 'bream', rx: /лещ|подлещик|abramis brama/i },
  { id: 'grass_carp', rx: /белый амур|ctenopharyngodon/i },
  { id: 'black_carp', rx: /черный амур|чёрный амур|mylopharyngodon/i },
  { id: 'silver_carp', rx: /толстолоб|hypophthalmichthys/i },
  { id: 'buffalo', rx: /буффало|ictiobus/i },
  { id: 'carp', rx: /карп|сазан|cyprinus/i },
  { id: 'tench', rx: /линь|линёк|tinca/i },
  { id: 'gudgeon', rx: /пескар|gobio/i },
  { id: 'shemaya', rx: /шемая|chalcoides/i },
  { id: 'bleak', rx: /уклейк|уклея|alburnus/i },
  { id: 'chekhon', rx: /чехон|pelecus/i },
  { id: 'undermouth', rx: /подуст|chondrostoma/i },
  { id: 'vimba', rx: /рыбец|сырть|vimba/i },
  { id: 'barbel', rx: /усач|мирон|barbus/i },
  { id: 'sky_gazer', rx: /верхогляд|chanodichthys/i },
  { id: 'yellowcheek', rx: /желтощек|желтощёк|elopichthys/i },
  { id: 'tarpon_carp', rx: /монгольский краснопер|краснопёр|остролучк/i },
  { id: 'loach', rx: /вьюн|щиповк|голец усат|misgurnus|cobitis/i },
  { id: 'burbot', rx: /налим|lota lota/i },
  { id: 'amur_catfish', rx: /амурский сом|parasilurus/i },
  { id: 'channel_catfish', rx: /канальный сом|ictalurus/i },
  { id: 'catfish', rx: /сом обыкновен|европейский сом|\bсом\b|сомён|silurus/i },
  { id: 'taimen', rx: /таймен|hucho/i },
  { id: 'lenok', rx: /ленок|ускуч|brachymystax/i },
  { id: 'baikal_grayling', rx: /байкальский хариус|baicalensis/i },
  { id: 'grayling', rx: /хариус|thymallus/i },
  { id: 'rainbow_trout', rx: /радужная форел|микиж|mykiss|parasalmo/i },
  { id: 'brown_trout', rx: /кумж|ручьевая форел|пеструшк|salmo trutta/i },
  { id: 'trout', rx: /форел|озерная форел/i },
  { id: 'salmon', rx: /сёмг|семг|атлантический лосос|salmo salar/i },
  { id: 'dolly_varden', rx: /мальм| кундж|malma/i },
  { id: 'char', rx: /голец|арктический голец|палия|salvelinus/i },
  { id: 'pink_salmon', rx: /горбуш|gorbuscha/i },
  { id: 'chum_salmon', rx: /кета|кеты|oncorhynchus keta/i },
  { id: 'sockeye_salmon', rx: /нерк|nerka/i },
  { id: 'coho_salmon', rx: /кижуч|kisutch/i },
  { id: 'chinook_salmon', rx: /чавыч|tshawytscha/i },
  { id: 'cherry_salmon', rx: /сима|masou/i },
  { id: 'white_salmon', rx: /белорыбиц|leucichthys/i },
  { id: 'nelma', rx: /нельма|stenodus/i },
  { id: 'muksun', rx: /муксун|muksun/i },
  { id: 'chir', rx: /чир|щокур|щекур|nasus/i },
  { id: 'peled', rx: /пеляд|сырок|peled/i },
  { id: 'pizhyan', rx: /пыжьян|сибирский сиг|pidschian/i },
  { id: 'whitefish', rx: /сиг обыкновен|\bсиг\b|валаамк|lavaretus/i },
  { id: 'broad_whitefish', rx: /чир|широколобик/i },
  { id: 'omul_arctic', rx: /арктический омул|autumnalis/i },
  { id: 'omul', rx: /омул|байкальский омул|migratorius/i },
  { id: 'vendace', rx: /ряпушк|рипус|albula/i },
  { id: 'cisco', rx: /сибирская ряпушк|зельдь|sardinella/i },
  { id: 'tugun', rx: /тугун|сосьвинская сельд|манерк|tugun/i },
  { id: 'valek', rx: /валёк|валек|cylindraceus|prosopium/i },
  { id: 'smelt', rx: /корюшк|зубар|снеток|osmerus|hypomesus/i },
  { id: 'capelin', rx: /мойв|уёк|mallotus/i },
  { id: 'saffron_cod', rx: /дальневосточная наваг|вахня|gracilis/i },
  { id: 'navaga', rx: /наваг|eleginus/i },
  { id: 'cod', rx: /треск|gadus morhua/i },
  { id: 'haddock', rx: /пикш|melanogrammus/i },
  { id: 'saithe', rx: /сайд|pollachius/i },
  { id: 'walleye_pollock', rx: /минтай|chalcogrammus|theragra/i },
  { id: 'wolffish', rx: /зубатк|anarhichas/i },
  { id: 'greenling', rx: /терпуг|зайчик морской|pleurogrammus/i },
  { id: 'herring', rx: /сельдь|селедк|селёдк|clupea/i },
  { id: 'mackerel', rx: /скумбр|scomber/i },
  { id: 'horse_mackerel', rx: /ставрид|trachurus/i },
  { id: 'bluefish', rx: /луфар|pomatomus/i },
  { id: 'mullet', rx: /кефал|лобан|сингил|остронос|пеленгас|mugil|planiza|liza/i },
  { id: 'red_mullet', rx: /барабул|султанк|mullus/i },
  { id: 'garfish', rx: /сарган|belone/i },
  { id: 'scorpionfish', rx: /скорпен|морской ёрш|морской ерш|scorpaena/i },
  { id: 'sea_bream', rx: /дорад|зубарик|ласкир|морской карас|sparus|diplodus/i },
  { id: 'wrasse', rx: /зеленушк|губан|symphodus/i },
  { id: 'sand_eel', rx: /песчанк|ammodytes/i },
  { id: 'anglerfish', rx: /удильщик|морской чёрт|морской черт|lophius/i },
  { id: 'eel', rx: /угор|речной угор|anguilla/i },
  { id: 'sterlet', rx: /стерляд|ruthenus/i },
  { id: 'stellate_sturgeon', rx: /севрюг|stellatus/i },
  { id: 'beluga', rx: /белуг|huso huso/i },
  { id: 'kaluga', rx: /калуг|dauricus/i },
  { id: 'siberian_sturgeon', rx: /сибирский осётр|сибирский осетр|baerii/i },
  { id: 'russian_sturgeon', rx: /русский осётр|русский осетр|\bосётр\b|\bосетр\b|gueldenstaedtii/i },
  { id: 'paddlefish', rx: /веслонос|polyodon/i },
  { id: 'snakehead', rx: /змееголов|channa/i },
  { id: 'tilapia', rx: /тиляп|тилап|oreochromis/i },
  { id: 'king_crab', rx: /камчатский краб|paralithodes/i },
  { id: 'crab', rx: /краб|стригун|волосатик|chionoecetes|cancer/i },
  { id: 'crayfish', rx: /речной рак|узкопалый рак|широкопалый рак|\bрак\b|astacus|pontastacus/i }
];
export function matchSpeciesInAtlas(fishNameRu = '', fishNameLat = '', fullText = '') {
  const directById = FISH_DB.find(f => f.id === String(fishNameRu || '').trim().toLowerCase());
  if (directById) return directById;
  const primaryStr = `${fishNameRu || ''} ${fishNameLat || ''}`.toLowerCase().replace(/ё/g, 'е').trim();
  const secondaryStr = String(fullText || '').toLowerCase().replace(/ё/g, 'е');
  for (const f of FISH_DB) {
    const fn = f.name.toLowerCase().replace(/ё/g, 'е');
    const fnShort = fn.split('(')[0].trim();
    const fl = (f.latin || '').toLowerCase();
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
    const cleanedSecondary = secondaryStr.replace(/(?:исключает|не\s+является|отличается\s+от|против)[^.,;\n]*/g, '');
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
 * Разбирает ответ Gemini (как JSON, так и свободный текст в стиле Фото 6)
 */
export function parseGeminiFishResponse(rawText = '') {
  const txt = String(rawText || '').trim();
  if (!txt) return null;
  const cleanJsonCandidate = txt.replace(/```json/gi, '').replace(/```/g, '').trim();
  const b0 = cleanJsonCandidate.indexOf('{');
  const b1 = cleanJsonCandidate.lastIndexOf('}');
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
  if (obj && typeof obj === 'object') {
    const topFromMatches = Array.isArray(obj.matches) && obj.matches.length > 0 ? obj.matches[0] : null;
    const rawNameRu = String(obj.fishNameRu || obj.species || obj.fishName || topFromMatches?.fishNameRu || topFromMatches?.fishId || obj.sceneTitle || '').trim();
    const rawNameLat = String(obj.fishNameLat || obj.latin || topFromMatches?.fishNameLat || '').trim();
    const traits = String(obj.traits || topFromMatches?.reason || obj.morphNote || '').trim();
    const fullText = String(obj.fullText || obj.details || obj.description || obj.sceneTitle || traits || '').trim();
    const matchedFish = matchSpeciesInAtlas(rawNameRu, rawNameLat, `${traits} ${fullText}`)
      || (topFromMatches?.fishId ? FISH_DB.find(f => f.id === topFromMatches.fishId) : null);
    if (matchedFish || rawNameRu) {
      const fish = matchedFish || {
        id: 'crucian',
        name: rawNameRu || 'Рыба распознана ИИ',
        latin: rawNameLat || '',
        legal: 'allowed',
        idTraits: traits,
        sizeInfo: obj.sizeText || ''
      };
      let lenCm = Number(obj.lengthCm || obj.estimatedLengthCm || topFromMatches?.estimatedLengthCm) || 0;
      if (lenCm <= 0) {
        const mLen = `${obj.sizeText || ''} ${fullText}`.match(/(\d+(?:[.,]\d+)?)\s*(?:[–-]\s*(\d+(?:[.,]\d+)?))?\s*см/i);
        if (mLen) {
          const v1 = parseFloat(mLen[1].replace(',', '.'));
          const v2 = mLen[2] ? parseFloat(mLen[2].replace(',', '.')) : v1;
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
        const mGrams = `${obj.sizeText || ''} ${fullText}`.match(/(\d+(?:[.,]\d+)?)\s*(?:[–-]\s*(\d+(?:[.,]\d+)?))?\s*(?:г|гр|грамм)(?![а-я])/i);
        const mKg = `${obj.sizeText || ''} ${fullText}`.match(/(\d+(?:[.,]\d+)?)\s*(?:[–-]\s*(\d+(?:[.,]\d+)?))?\s*кг/i);
        if (mGrams) {
          const g1 = parseFloat(mGrams[1].replace(',', '.'));
          const g2 = mGrams[2] ? parseFloat(mGrams[2].replace(',', '.')) : g1;
          weightKg = Math.round(((g1 + g2) / 2)) / 1000;
        } else if (mKg) {
          const k1 = parseFloat(mKg[1].replace(',', '.'));
          const k2 = mKg[2] ? parseFloat(mKg[2].replace(',', '.')) : k1;
          weightKg = Math.round(((k1 + k2) / 2) * 100) / 100;
        } else {
          weightKg = estimateWeightByLengthAndSpecies(fish.id, lenCm);
        }
      }
      const conf = Math.max(50, Math.min(99, Math.round(Number(obj.confidence || topFromMatches?.confidence) || 95)));
      const displayTitle = rawNameRu && !FISH_DB.some(f => f.id === rawNameRu) ? rawNameRu : fish.name;
      const displayLatin = rawNameLat || fish.latin || '';
      const sizeText = String(obj.sizeText || `Длина: ~${lenCm} см • Вес: ${formatWeightHuman(weightKg)}`).trim();
      const topMatches = [
        {
          fishId: fish.id,
          fish,
          displayTitle,
          displayLatin,
          isRedBook: fish.legal === 'redbook',
          confidence: conf,
          reason: traits || fullText || fish.idTraits || 'Определено нейросетью по внешним морфологическим признакам',
          fullAnalysisText: fullText || traits,
          sizeSummaryText: sizeText,
          estimatedLengthCm: lenCm,
          estimatedWeightKg: weightKg
        }
      ];
      const altList = Array.isArray(obj.alternatives) ? obj.alternatives : (Array.isArray(obj.matches) ? obj.matches.slice(1) : []);
      for (const alt of altList.slice(0, 2)) {
        const altName = String(alt.fishNameRu || alt.fishId || '').trim();
        const altFish = matchSpeciesInAtlas(altName, alt.fishNameLat || '', alt.reason || '');
        if (altFish && !topMatches.some(m => m.fishId === altFish.id)) {
          const altLen = getDefaultTypicalLengthCm(altFish.id);
          topMatches.push({
            fishId: altFish.id,
            fish: altFish,
            displayTitle: altFish.name,
            displayLatin: altFish.latin || '',
            isRedBook: altFish.legal === 'redbook',
            confidence: Math.max(10, Math.min(85, Math.round(Number(alt.confidence) || 25))),
            reason: alt.reason || altFish.idTraits || 'Сходный по форме тела вид',
            fullAnalysisText: alt.reason || altFish.idTraits || '',
            sizeSummaryText: `Обычно ~${altLen} см`,
            estimatedLengthCm: altLen,
            estimatedWeightKg: estimateWeightByLengthAndSpecies(altFish.id, altLen)
          });
        }
      }
      return {
        sceneTitle: displayTitle,
        sizeText,
        fullText: fullText || traits,
        estimatedLengthCm: lenCm,
        estimatedWeightKg: weightKg,
        topMatches
      };
    }
  }
  const matchedFromText = matchSpeciesInAtlas('', '', txt);
  if (matchedFromText) {
    let lenCm = getDefaultTypicalLengthCm(matchedFromText.id);
    const mLenExplicit = txt.match(/(?:длина|размер|tl)[^\d\n]{0,30}?(\d+(?:[.,]\d+)?)\s*(?:[–-]\s*(\d+(?:[.,]\d+)?))?\s*см/i);
    const mLen = mLenExplicit || txt.replace(/ширин[а-я]*\s*~?\s*\d+(?:[.,–-]\d+)?\s*см/gi, "").match(/(\d+(?:[.,]\d+)?)\s*(?:[–-]\s*(\d+(?:[.,]\d+)?))?\s*см/i);
    if (mLen) {
      const v1 = parseFloat(mLen[1].replace(',', '.'));
      const v2 = mLen[2] ? parseFloat(mLen[2].replace(',', '.')) : v1;
      lenCm = Math.round(((v1 + v2) / 2) * 10) / 10;
    }
    let weightKg = estimateWeightByLengthAndSpecies(matchedFromText.id, lenCm);
    const mGrams = txt.match(/(\d+(?:[.,]\d+)?)\s*(?:[–-]\s*(\d+(?:[.,]\d+)?))?\s*(?:г|гр|грамм)(?![а-я])/i);
    const mKg = txt.match(/(\d+(?:[.,]\d+)?)\s*(?:[–-]\s*(\d+(?:[.,]\d+)?))?\s*кг/i);
    if (mGrams) {
      const g1 = parseFloat(mGrams[1].replace(',', '.'));
      const g2 = mGrams[2] ? parseFloat(mGrams[2].replace(',', '.')) : g1;
      weightKg = Math.round(((g1 + g2) / 2)) / 1000;
    } else if (mKg) {
      const k1 = parseFloat(mKg[1].replace(',', '.'));
      const k2 = mKg[2] ? parseFloat(mKg[2].replace(',', '.')) : k1;
      weightKg = Math.round(((k1 + k2) / 2) * 100) / 100;
    }
    const cleanTxt = txt.replace(/[*#`]/g, '').trim();
    const firstSentence = cleanTxt.split(/\n+/)[0] || matchedFromText.name;
    const sizeText = `Длина: ~${lenCm} см • Вес: ${formatWeightHuman(weightKg)}`;
    const matchItem = {
      fishId: matchedFromText.id,
      fish: matchedFromText,
      displayTitle: matchedFromText.name,
      displayLatin: matchedFromText.latin || '',
      isRedBook: matchedFromText.legal === 'redbook',
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
 * Прямое распознавание рыбы по фото через Gemini Vision (и резервные облачные модели)
 * без рамок, квадратов и без подставной «Щуки»
 */
export async function analyzeFishPhotoHybrid(imgSrc) {
  const s = store.getState();
  const basinCode = s.basinCode || 'arctic_ob_taz';
  const basinName = BASIN_CONFIGS[basinCode]?.name || 'Водоёмы РФ';
  const feat = await extractPhotoVisualFeatures(imgSrc);
  const cacheHashKey = feat.dhash;
  if (cacheHashKey && cacheHashKey.length === 16 && cacheHashKey !== '0000000000000000') {
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
        engine: cachedEntry.engine || 'Google Gemini Flash Vision ИИ (кэш)',
        sourceMode: cachedEntry.engine || 'Google Gemini Flash Vision ИИ',
        basinCode,
        basinName,
        sceneTitle: pr.sceneTitle,
        sizeText: pr.sizeText,
        fullText: pr.fullText,
        morphNote: hydratedMatches[0].reason,
        primaryMatch: hydratedMatches[0],
        topMatch: hydratedMatches[0],
        topMatches: hydratedMatches,
        matches: hydratedMatches,
        estimatedLengthCm: hydratedMatches[0].estimatedLengthCm,
        estimatedWeightKg: hydratedMatches[0].estimatedWeightKg,
        thumbDataUrl: feat.thumbDataUrl || imgSrc,
        roiDataUrl: feat.thumbDataUrl || imgSrc
      };
    }
  }
  const imagePayload = feat.thumbDataUrl || imgSrc || '';
  const DIRECT_FISH_PROMPT =
    'Определи, что за рыба на фото, её примерный размер (длину в см) и примерный вес (в граммах или кг, с привязкой к масштабу ладони или предметов в кадре).\n' +
    'Если на фото несколько рыб, возьми за основную центральную (или самую крупную), а в поле fullText подробно распиши каждую рыбу (верхнюю, среднюю, нижнюю) и суммарный вес, как на приёме у ихтиолога.\n' +
    'Верни ответ в формате JSON (без обёрток):\n' +
    '{"fishNameRu":"название рыбы на русском (например: Серебряный карась (молодь) / Речная камбала / Окунь)","fishNameLat":"латинское название","confidence":96,"lengthCm":6,"weightGrams":5,"sizeText":"Длина ~5–6.5 см • Вес ~5–7 г (суммарно 3 шт. ~10–14 г)","traits":"диагностические признаки на фото (форма тела, чешуя, плавники, усики и т.д.)","fullText":"подробное описание рыбы, оценка размера и массы каждой особи на фото","alternatives":[{"fishNameRu":"похожий вид","confidence":20,"reason":"чем отличается"}]}';
  if (typeof fetch === 'function' && imagePayload.startsWith('data:image/')) {
    const pureB64 = imagePayload.includes(',') ? imagePayload.split(',')[1] : imagePayload;
    const geminiQuota = getLocalGeminiQuotaState();
    if (geminiQuota.hasKey && geminiQuota.remainingToday > 0) {
      const gKey = geminiQuota.keys[0];
      try {
        const smartRes = await callGeminiClientSmart(
          gKey,
          [{
            parts: [
              { text: DIRECT_FISH_PROMPT },
              { inline_data: { mime_type: 'image/jpeg', data: pureB64 } }
            ]
          }],
          { temperature: 0.15, maxOutputTokens: 4096 },
          8500
        );
        if (smartRes && smartRes.ok && smartRes.text) {
          const parsed = parseGeminiFishResponse(smartRes.text);
          if (parsed && parsed.topMatches.length > 0) {
            const updatedQuota = incrementLocalGeminiQuotaUsed();
            const engLabel = `Google ${smartRes.model || 'Gemini Flash'} Vision ИИ (осталось ${updatedQuota.remainingToday} из ${updatedQuota.limitPerDay})`;
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
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8500);
      const cloudRes = await fetch(`${RELAY_WORKER_URL}/api/ai/identify-fish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          basinCode,
          dhash: feat.dhash,
          roiDhash: feat.roiDhash,
          imageBase64: imagePayload,
          geminiApiKey: getStoredGeminiApiKey(),
          directPrompt: DIRECT_FISH_PROMPT
        }),
        signal: ctrl.signal
      }).catch(() => null);
      clearTimeout(timer);
      if (cloudRes && cloudRes.ok) {
        const cloudData = await cloudRes.json().catch(() => null);
        const eng = String(cloudData?.engine || '');
        const isOldFallback = eng.includes('v2.5.3') || eng.includes('Морфометрическое ядро') || eng.includes('Гибридный');
        if (cloudData && cloudData.ok && !isOldFallback) {
          if (cloudData.aiQuota) incrementLocalGeminiQuotaUsed(cloudData.aiQuota);
          const parsedFromRaw = cloudData.rawGeminiText
            ? parseGeminiFishResponse(cloudData.rawGeminiText)
            : parseGeminiFishResponse(JSON.stringify(cloudData));
          if (parsedFromRaw && parsedFromRaw.topMatches.length > 0) {
            if (cacheHashKey) {
              saveLocalVisionCache(cacheHashKey, { engine: cloudData.engine || 'Gemini Vision ИИ', parsedResult: parsedFromRaw });
            }
            return {
              ok: true,
              engine: cloudData.engine || 'Google Gemini Flash Vision ИИ',
              sourceMode: cloudData.engine || 'Google Gemini Flash Vision ИИ',
              basinCode,
              basinName,
              sceneTitle: parsedFromRaw.sceneTitle,
              sizeText: parsedFromRaw.sizeText,
              fullText: parsedFromRaw.fullText,
              morphNote: parsedFromRaw.topMatches[0].reason,
              primaryMatch: parsedFromRaw.topMatches[0],
              topMatch: parsedFromRaw.topMatches[0],
              topMatches: parsedFromRaw.topMatches,
              matches: parsedFromRaw.topMatches,
              estimatedLengthCm: parsedFromRaw.estimatedLengthCm,
              estimatedWeightKg: parsedFromRaw.estimatedWeightKg,
              thumbDataUrl: feat.thumbDataUrl || imgSrc,
              roiDataUrl: feat.thumbDataUrl || imgSrc
            };
          }
        }
      }
    } catch (e) {}
    try {
      const vCtrl = new AbortController();
      const vTimer = setTimeout(() => vCtrl.abort(), 8000);
      const vRes = await fetch('https://text.pollinations.ai/openai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'openai',
          temperature: 0.15,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: DIRECT_FISH_PROMPT },
                { type: 'image_url', image_url: { url: imagePayload } }
              ]
            }
          ]
        }),
        signal: vCtrl.signal
      }).catch(() => null);
      clearTimeout(vTimer);
      if (vRes && vRes.ok) {
        const vJson = await vRes.json().catch(() => null);
        const rawTxt = String(vJson?.choices?.[0]?.message?.content || '').trim();
        const parsed = parseGeminiFishResponse(rawTxt);
        if (parsed && parsed.topMatches.length > 0) {
          const qAfter = geminiQuota.hasKey ? incrementLocalGeminiQuotaUsed() : null;
          const engTitle = qAfter
            ? `Vision ИИ (осталось ${qAfter.remainingToday} из ${qAfter.limitPerDay})`
            : 'Мультимодальная нейросеть Vision ИИ';
          if (cacheHashKey) {
            saveLocalVisionCache(cacheHashKey, { engine: engTitle, parsedResult: parsed });
          }
          return {
            ok: true,
            engine: engTitle,
            sourceMode: engTitle,
            basinCode,
            basinName,
            sceneTitle: parsed.sceneTitle,
            sizeText: parsed.sizeText,
            fullText: parsed.fullText,
            morphNote: parsed.topMatches[0].reason,
            primaryMatch: parsed.topMatches[0],
            topMatch: parsed.topMatches[0],
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
  return {
    ok: false,
    error: 'Не удалось получить ответ от нейросети Vision ИИ. Проверьте подключение к интернету или нажмите «Повторить анализ».',
    thumbDataUrl: feat.thumbDataUrl || imgSrc,
    roiDataUrl: feat.thumbDataUrl || imgSrc
  };
}
/**
 * Открывает модальное окно «Нейро-определитель рыбы по фото (Vision ИИ)»
 * без рамок, точек и квадратов на фотографии — сразу показывает фото и подставляет ответ Gemini в карточку
 */
export function openFishPhotoScannerModal(options = {}) {
  requestAppCameraAndPhotoAccess();
  let activeResult = null;
  let selectedMatchIdx = 0;
  let currentImgSrc = options.initialImageSrc || '';
  let activeVideoStream = null;
  let cameraFacingMode = 'environment';
  const stopCameraStream = () => {
    if (activeVideoStream) {
      try {
        activeVideoStream.getTracks().forEach(t => t.stop());
      } catch (e) {}
      activeVideoStream = null;
    }
  };
  const html = `
    <div id="fishScannerModalRoot" style="display:flex;flex-direction:column;gap:12px;font-size:var(--fs-sm);">
      <div style="padding:12px;text-align:center;color:var(--muted);">Запуск нейро-сканера...</div>
    </div>
  `;
  openModal(
    '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" fill="rgba(56,189,248,0.22)" stroke="#38bdf8" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="4" stroke="#10b981" stroke-width="2"/></svg> Нейро-определитель рыбы по фото (Gemini Vision ИИ)',
    html,
    async (bodyEl) => {
      const root = bodyEl.querySelector('#fishScannerModalRoot') || bodyEl;
      const runAnalysisAndRender = async (imgSrc) => {
        stopCameraStream();
        currentImgSrc = imgSrc;
        if (!currentImgSrc) {
          renderScannerView();
          return;
        }
        root.innerHTML = `
          <div class="card" style="padding:20px 14px;text-align:center;background:var(--panel);border:1.5px solid var(--accent);">
            <div style="margin-bottom:10px;border-radius:10px;overflow:hidden;max-height:220px;display:flex;justify-content:center;background:#090f1d;">
              <img src="${currentImgSrc}" alt="Фото" style="max-width:100%;max-height:220px;object-fit:contain;">
            </div>
            <div style="font-weight:900;font-size:15px;color:var(--accent);margin-bottom:4px;">
              Нейросеть Gemini Vision определяет вид рыбы, размер и вес...
            </div>
            <div style="font-size:12px;color:var(--muted);">
              Анализ морфологических признаков, масштаба и сверка с базой рыб РФ
            </div>
          </div>
        `;
        activeResult = await analyzeFishPhotoHybrid(currentImgSrc);
        selectedMatchIdx = 0;
        renderScannerView();
      };
      if (typeof window !== 'undefined') {
        window.__KLEV_ON_NATIVE_CAMERA_PHOTO__ = (nativeDataUrl) => {
          if (nativeDataUrl && typeof nativeDataUrl === 'string' && nativeDataUrl.startsWith('data:image/')) {
            runAnalysisAndRender(nativeDataUrl);
          }
        };
      }
      const startLiveCameraViewfinder = async () => {
        stopCameraStream();
        if (typeof window !== 'undefined' && window.AndroidBridge && typeof window.AndroidBridge.openNativeCamera === 'function') {
          window.AndroidBridge.openNativeCamera();
          return;
        }
        requestAppCameraAndPhotoAccess();
        const camBox = root.querySelector('#scannerLiveCameraBox');
        const videoEl = root.querySelector('#scannerLiveVideo');
        if (!camBox || !videoEl) return;
        if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
          root.querySelector('#scannerCameraCaptureInput')?.click();
          return;
        }
        try {
          camBox.style.display = 'flex';
          activeVideoStream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: cameraFacingMode },
              width: { ideal: 1280 },
              height: { ideal: 720 }
            },
            audio: false
          });
          videoEl.srcObject = activeVideoStream;
          await videoEl.play().catch(() => {});
        } catch (err) {
          camBox.style.display = 'none';
          root.querySelector('#scannerCameraCaptureInput')?.click();
        }
      };
      const renderScannerView = () => {
        const hasPhoto = Boolean(currentImgSrc);
        const hasValidResult = Boolean(hasPhoto && activeResult && activeResult.ok && activeResult.topMatches?.length);
        const activeMatch = hasValidResult ? (activeResult.topMatches[selectedMatchIdx] || activeResult.topMatches[0]) : null;
        const fish = activeMatch ? activeMatch.fish : FISH_DB[0];
        const isRedBook = fish.legal === 'redbook';
        const isLicense = fish.legal === 'license';
        const curLen = activeMatch ? (activeMatch.estimatedLengthCm || getDefaultTypicalLengthCm(fish.id)) : 25;
        const curWeight = activeMatch ? (activeMatch.estimatedWeightKg || estimateWeightByLengthAndSpecies(fish.id, curLen)) : 0.25;
        const displayTitle = activeMatch?.displayTitle || fish.name;
        const displayLatin = activeMatch?.displayLatin || fish.latin || '';
        const sizeSummaryText = activeMatch?.sizeSummaryText || activeResult?.sizeText || `Длина: ~${curLen} см • Вес: ${formatWeightHuman(curWeight)}`;
        const fullAnalysisText = activeMatch?.fullAnalysisText || activeResult?.fullText || activeMatch?.reason || '';
        root.innerHTML = `
          <!-- 1. Панель Камеры и Галереи -->
          <div class="card" style="padding:11px 12px;background:var(--card);border:1.5px solid var(--accent);">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
              <div>
                <div style="font-weight:900;font-size:13.5px;color:var(--text);">
                  Сфотографируйте улов или загрузите фото
                </div>
                <div style="font-size:11px;color:var(--muted);margin-top:2px;">
                  Нейросеть Gemini Flash Vision автоматически определит вид рыбы, примерную длину и вес
                </div>
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                <button type="button" class="btn btn-sm btn-good" id="scannerOpenLiveCamBtn" style="min-height:36px;font-weight:900;">
                  <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" fill="rgba(16,185,129,0.22)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="4" stroke="currentColor" stroke-width="1.8"/></svg> Камера
                </button>
                <label class="btn btn-sm btn-accent" id="scannerGalleryLabelBtn" style="cursor:pointer;margin:0;min-height:36px;font-weight:900;">
                  <svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" stroke-width="1.8"/><circle cx="8.5" cy="8.5" r="1.8" fill="currentColor"/><path d="M21 15l-5-5L5 21" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Из галереи
                  <input type="file" id="scannerFileInput" accept="image/*" style="display:none;">
                </label>
                <input type="file" id="scannerCameraCaptureInput" accept="image/*" capture="environment" style="display:none;">
              </div>
            </div>
            <!-- Видоискатель камеры (если открыт в веб-браузере) -->
            <div id="scannerLiveCameraBox" style="display:none;flex-direction:column;gap:8px;margin-top:10px;padding:10px;border-radius:10px;background:#090f1d;border:1.5px solid var(--good);">
              <div style="position:relative;width:100%;max-height:280px;border-radius:8px;overflow:hidden;background:#000;display:flex;align-items:center;justify-content:center;">
                <video id="scannerLiveVideo" autoplay playsinline muted style="width:100%;max-height:280px;object-fit:cover;"></video>
              </div>
              <div style="display:flex;justify-content:center;gap:8px;flex-wrap:wrap;">
                <button type="button" class="btn btn-good" id="scannerSnapPhotoBtn" style="min-height:40px;font-weight:900;flex:1;">
                  Сделать снимок и распознать
                </button>
                <button type="button" class="btn btn-sm" id="scannerFlipCamBtn" style="min-height:40px;">
                  Сменить камеру
                </button>
                <button type="button" class="btn btn-sm" id="scannerCloseCamBtn" style="min-height:40px;color:var(--bad);">
                  Закрыть
                </button>
              </div>
            </div>
          </div>
          ${!hasPhoto ? `
            <!-- Стартовый экран до выбора фотографии -->
            <div class="card" style="padding:20px 14px;text-align:center;background:var(--panel);border:1px dashed var(--border);">
              <div style="font-weight:900;font-size:14px;color:var(--text);margin-bottom:6px;">
                Готов к распознаванию рыбы по фото
              </div>
              <div style="font-size:12px;color:var(--muted);max-width:440px;margin:0 auto 12px;line-height:1.45;">
                Нажмите <b>«Камера»</b> или <b>«Из галереи»</b>. ИИ автоматически определит вид рыбы (включая мальков и редкие виды), оценит длину и вес по масштабу кадра и заполнит карточку.
              </div>
              <div style="display:flex;justify-content:center;gap:8px;flex-wrap:wrap;">
                <button type="button" class="btn btn-good" id="scannerHeroCamBtn" style="min-height:42px;font-weight:900;">
                  Снять фото
                </button>
                <button type="button" class="btn btn-accent" id="scannerHeroGalleryBtn" style="min-height:42px;font-weight:900;">
                  Выбрать из галереи
                </button>
              </div>
            </div>
          ` : !hasValidResult ? `
            <!-- Ошибка сети / повтор -->
            <div class="card" style="padding:14px;background:var(--panel);border:1.5px solid var(--warn);text-align:center;">
              <div style="border-radius:10px;overflow:hidden;max-height:240px;background:#090f1d;margin-bottom:10px;display:flex;justify-content:center;">
                <img src="${currentImgSrc}" alt="Снимок" style="max-width:100%;max-height:240px;object-fit:contain;">
              </div>
              <div style="font-weight:800;color:var(--warn);margin-bottom:8px;">
                ${escapeHtml(activeResult?.error || 'Не удалось связаться с нейросетью Vision ИИ')}
              </div>
              <button type="button" class="btn btn-accent" id="scannerRetryBtn" style="min-height:38px;font-weight:900;">
                Повторить распознавание
              </button>
            </div>
          ` : `
            <!-- 2. Чистое фото улова (без рамок, точек и квадратов) -->
            <div class="card" style="padding:10px 12px;background:var(--panel);border:1px solid var(--border);">
              <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
                <span style="font-size:11.5px;font-weight:800;color:var(--accent);">${escapeHtml(activeResult.sourceMode || 'Google Gemini Flash Vision ИИ')}</span>
                <button type="button" class="btn btn-sm" id="scannerRetryBtn" style="min-height:26px;padding:2px 8px;font-size:11px;">Пересчитать ИИ</button>
              </div>
              <div style="width:100%;border-radius:10px;overflow:hidden;background:#090f1d;border:1px solid var(--border);display:flex;justify-content:center;align-items:center;max-height:280px;">
                <img src="${currentImgSrc}" alt="Фото улова" style="max-width:100%;max-height:280px;object-fit:contain;display:block;">
              </div>
            </div>
            <!-- 3. Результат распознавания нейросетью и карточка вида -->
            <div class="card" style="padding:12px 14px;background:var(--panel);border:1.5px solid ${isRedBook ? 'var(--bad)' : 'var(--good)'};display:flex;flex-direction:column;gap:10px;">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
                <span style="font-size:11.5px;font-weight:900;color:var(--muted);">РЕЗУЛЬТАТ РАСПОЗНАВАНИЯ GEMINI VISION:</span>
                <div style="display:flex;gap:6px;align-items:center;">
                  <span class="pill pill-good" style="font-size:10.5px;">Точность: ${activeMatch.confidence}%</span>
                  ${isRedBook
                    ? `<span class="pill pill-bad" style="font-size:10.5px;">Красная книга • Отпусти!</span>`
                    : (isLicense
                        ? `<span class="pill pill-warn" style="font-size:10.5px;">По путёвке / Лицензия</span>`
                        : `<span class="pill pill-good" style="font-size:10.5px;">Разрешённый вид</span>`)}
                </div>
              </div>
              <div style="display:grid;grid-template-columns:115px 1fr;gap:10px;align-items:center;">
                <div style="width:115px;height:82px;border-radius:10px;background:var(--card);display:flex;align-items:center;justify-content:center;padding:6px;border:1px solid var(--border);">
                  <img src="assets/fish/${fish.id}.png" alt="${escapeHtml(fish.name)}" style="max-width:100%;max-height:100%;object-fit:contain;" onerror="this.style.display='none'">
                </div>
                <div>
                  <div style="font-size:16px;font-weight:900;color:var(--text);">${escapeHtml(displayTitle)}</div>
                  <div style="font-size:11.5px;color:var(--muted);font-style:italic;">${escapeHtml(displayLatin)}</div>
                  <div style="margin-top:5px;padding:5px 8px;border-radius:7px;background:rgba(16,185,129,0.14);border:1px solid var(--good);font-weight:900;font-size:12.5px;color:var(--good);" id="scannerCalcSummaryBadge">
                    ${escapeHtml(sizeSummaryText)}
                  </div>
                </div>
              </div>
              <!-- Полный ответ и диагностические признаки от ИИ -->
              <div style="padding:9px 11px;border-radius:8px;background:var(--card);border:1px solid var(--border);font-size:12px;line-height:1.45;color:var(--text);white-space:pre-line;">
                <b style="color:var(--accent);">Заключение ИИ по фото:</b>\n${escapeHtml(fullAnalysisText || activeMatch.reason || fish.idTraits || '')}
              </div>
              <!-- Поля точной корректировки длины и веса для записи в Журнал -->
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
              <div style="padding:8px 10px;border-radius:8px;background:${isRedBook ? 'rgba(239,68,68,0.14)' : 'rgba(16,185,129,0.09)'};border:1px solid ${isRedBook ? 'var(--bad)' : 'var(--good)'};font-size:11.5px;line-height:1.4;">
                <b style="color:${isRedBook ? 'var(--bad)' : 'var(--good)'};">
                  ${isRedBook ? 'ВНИМАНИЕ: КРАСНАЯ КНИГА! ВЫЛОВ ЗАПРЕЩЁН!' : 'Справка из Атласа РФ (' + escapeHtml(fish.name) + '):'}
                </b>
                ${isRedBook
                  ? escapeHtml(fish.handlingAdvice || 'Немедленно освободите рыбу от крючка прямо в воде и бережно отпустите.')
                  : escapeHtml(fish.sizeInfo || 'Разрешён к любительскому лову с соблюдением суточной нормы.')}
              </div>
            </div>
            ${activeResult.topMatches.length > 1 ? `
              <!-- 4. Альтернативные варианты, если рыба похожа на родственный вид -->
              <div class="card" style="padding:10px 12px;background:var(--card);">
                <div style="font-weight:900;font-size:11px;color:var(--accent);text-transform:uppercase;margin-bottom:6px;">
                  БЛИЗКИЕ ВИДЫ В БАЗЕ (НАЖМИТЕ ДЛЯ ПЕРЕКЛЮЧЕНИЯ КАРТОЧКИ):
                </div>
                <div style="display:flex;flex-direction:column;gap:6px;">
                  ${activeResult.topMatches.map((m, idx) => `
                    <div data-pick-scanner-match="${idx}" style="padding:7px 10px;border-radius:8px;background:${idx === selectedMatchIdx ? 'rgba(56,189,248,0.14)' : 'var(--panel)'};border:1.5px solid ${idx === selectedMatchIdx ? 'var(--accent)' : 'var(--border)'};cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:8px;">
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
                      <span class="pill ${m.confidence >= 80 ? 'pill-good' : 'pill-neutral'}" style="font-weight:900;font-size:11px;">${m.confidence}%</span>
                    </div>
                  `).join('')}
                </div>
              </div>
            ` : ''}
            <!-- 5. Кнопки передачи в Журнал, Прогноз и Паспорт вида -->
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:8px;">
              ${!isRedBook ? `
                <button type="button" class="btn btn-good" id="scannerApplyToLogBtn" style="min-height:42px;font-weight:900;">
                  <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 20C5 11 11 5 20 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 4v7c0 1.7-1.3 3-3 3s-3-1.3-3-3" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/><circle cx="14" cy="16" r="2.2" fill="#10b981"/></svg> + Записать в Журнал
                </button>
              ` : ''}
              <button type="button" class="btn btn-accent" id="scannerSelectForForecastBtn" style="min-height:42px;font-weight:800;">
                <svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="4.5" stroke="#38bdf8" stroke-width="1.6"/><circle cx="12" cy="12" r="1.8" fill="#10b981"/></svg> Прогноз и снасти
              </button>
              <button type="button" class="btn" id="scannerOpenPassportBtn" style="min-height:42px;font-weight:800;">
                <svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="2"/><path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> Паспорт вида
              </button>
            </div>
          `}
        `;
        const handleFileSelected = (file) => {
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            runAnalysisAndRender(String(reader.result || ''));
          };
          reader.readAsDataURL(file);
        };
        const fileInp = root.querySelector('#scannerFileInput');
        if (fileInp) {
          fileInp.addEventListener('click', () => requestAppCameraAndPhotoAccess());
          fileInp.addEventListener('change', (e) => handleFileSelected(e.target.files?.[0]));
        }
        const camCapInp = root.querySelector('#scannerCameraCaptureInput');
        if (camCapInp) {
          camCapInp.addEventListener('change', (e) => handleFileSelected(e.target.files?.[0]));
        }
        root.querySelector('#scannerOpenLiveCamBtn')?.addEventListener('click', () => startLiveCameraViewfinder());
        root.querySelector('#scannerHeroCamBtn')?.addEventListener('click', () => startLiveCameraViewfinder());
        root.querySelector('#scannerHeroGalleryBtn')?.addEventListener('click', () => {
          requestAppCameraAndPhotoAccess();
          fileInp?.click();
        });
        root.querySelector('#scannerRetryBtn')?.addEventListener('click', () => {
          try {
            if (typeof localStorage !== 'undefined') localStorage.removeItem(LOCAL_VISION_CACHE_KEY);
          } catch (e) {}
          if (currentImgSrc) runAnalysisAndRender(currentImgSrc);
        });
        root.querySelector('#scannerFlipCamBtn')?.addEventListener('click', () => {
          cameraFacingMode = cameraFacingMode === 'environment' ? 'user' : 'environment';
          startLiveCameraViewfinder();
        });
        root.querySelector('#scannerCloseCamBtn')?.addEventListener('click', () => {
          stopCameraStream();
          const camBox = root.querySelector('#scannerLiveCameraBox');
          if (camBox) camBox.style.display = 'none';
        });
        root.querySelector('#scannerSnapPhotoBtn')?.addEventListener('click', () => {
          const videoEl = root.querySelector('#scannerLiveVideo');
          if (!videoEl || !videoEl.videoWidth) return;
          const c = document.createElement('canvas');
          c.width = videoEl.videoWidth;
          c.height = videoEl.videoHeight;
          const ctx = c.getContext('2d');
          if (ctx) {
            ctx.drawImage(videoEl, 0, 0, c.width, c.height);
            const dataUrl = c.toDataURL('image/jpeg', 0.86);
            stopCameraStream();
            runAnalysisAndRender(dataUrl);
          }
        });
        if (!hasValidResult) return;
        const lenInp = root.querySelector('#scannerLenInput');
        const weightInp = root.querySelector('#scannerWeightInput');
        const badge = root.querySelector('#scannerCalcSummaryBadge');
        lenInp?.addEventListener('input', (e) => {
          const L = Math.max(1, Math.min(220, parseFloat(e.target.value) || curLen));
          const W = estimateWeightByLengthAndSpecies(fish.id, L);
          activeMatch.estimatedLengthCm = L;
          activeMatch.estimatedWeightKg = W;
          if (weightInp) weightInp.value = String(W);
          if (badge) badge.textContent = `Длина: ~${L} см • Вес: ${formatWeightHuman(W)}`;
        });
        weightInp?.addEventListener('input', (e) => {
          const W = Math.max(0.001, parseFloat(e.target.value) || curWeight);
          activeMatch.estimatedWeightKg = W;
          if (badge) badge.textContent = `Длина: ~${activeMatch.estimatedLengthCm || curLen} см • Вес: ${formatWeightHuman(W)}`;
        });
        root.querySelectorAll('[data-pick-scanner-match]').forEach(el => {
          el.addEventListener('click', () => {
            selectedMatchIdx = parseInt(el.getAttribute('data-pick-scanner-match'), 10) || 0;
            triggerHaptic('selection');
            renderScannerView();
          });
        });
        root.querySelector('#scannerApplyToLogBtn')?.addEventListener('click', () => {
          stopCameraStream();
          const finalLen = parseFloat(lenInp?.value) || curLen;
          const finalWeight = parseFloat(weightInp?.value) || curWeight;
          if (typeof options.onSelectResult === 'function') {
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
          store.dispatch({ type: 'SET_FISH', payload: fish.id });
          if (typeof window !== 'undefined' && typeof window.__KLEV_OPEN_CATCH_WIZARD__ === 'function') {
            window.__KLEV_OPEN_CATCH_WIZARD__({
              fishId: fish.id,
              lengthCm: finalLen,
              weightKg: finalWeight,
              photoDataUrl: activeResult.thumbDataUrl
            });
          }
          showToast(`Вид «${displayTitle}» (${formatWeightHuman(finalWeight)}, ${finalLen} см) передан в Журнал уловов!`, 'good');
        });
        root.querySelector('#scannerSelectForForecastBtn')?.addEventListener('click', () => {
          stopCameraStream();
          store.dispatch({ type: 'SET_FISH', payload: fish.id });
          closeModal();
          router.navigate('forecast');
          showToast(`Выбрана рыба: ${fish.name}`, 'good');
        });
        root.querySelector('#scannerOpenPassportBtn')?.addEventListener('click', () => {
          stopCameraStream();
          if (typeof options.onOpenDetail === 'function') {
            options.onOpenDetail(fish.id);
          } else if (typeof window !== 'undefined' && typeof window.__KLEV_OPEN_FISH_DETAIL__ === 'function') {
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