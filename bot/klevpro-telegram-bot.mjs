#!/usr/bin/env node
/**
 * @file bot/klevpro-telegram-bot.mjs
 * @description Автономный интерактивный Telegram-бот для «Клёв ПРО 2.0: Круг» (@KlevProClubBot) — Ревизия 2.0.164.
 * Не требует внешних npm-пакетов (работает на стандартном Node.js 18/20/22+ fetch и Long Polling).
 *
 * Как запустить в 1 команду (Windows / Linux / macOS):
 *   node bot/klevpro-telegram-bot.mjs ВАШ_ТОКЕН_ОТ_BOTFATHER
 *   или:
 *   BOT_TOKEN="ВАШ_ТОКЕН" node bot/klevpro-telegram-bot.mjs
 */

import crypto from 'node:crypto';

const CLI_TOKEN = (process.argv[2] && !process.argv[2].startsWith('-')) ? process.argv[2].trim() : '';
const BOT_TOKEN = (process.env.BOT_TOKEN || CLI_TOKEN || '').trim();
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const WEBAPP_URL = (process.env.WEBAPP_URL || 'https://klevpro.ru/').replace(/\/?$/, '/');
const CIPHER_SALT = 'KlevProCircle_v2.1_Salt_RU';

export function verifyTelegramWebAppInitData(initDataRaw, botToken = BOT_TOKEN) {
  if (!initDataRaw || !botToken) return false;
  try {
    const params = new URLSearchParams(initDataRaw);
    const receivedHash = params.get('hash');
    if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) return false;
    params.delete('hash');
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(computedHash, 'hex'), Buffer.from(receivedHash, 'hex'));
  } catch (e) {
    return false;
  }
}

export function verifyWebhookSecretToken(headerValue, expectedSecret = WEBHOOK_SECRET) {
  if (!expectedSecret) return true;
  return Boolean(headerValue && headerValue === expectedSecret);
}

const rateLimitBuckets = new Map();
export function checkBotRateLimit(userId, isGeo = false, nowMs = Date.now()) {
  const key = String(userId || 'anon');
  let bucket = rateLimitBuckets.get(key);
  if (!bucket || (nowMs - bucket.windowStart) >= 60000) {
    bucket = { windowStart: nowMs, total: 0, geo: 0 };
    rateLimitBuckets.set(key, bucket);
  }
  bucket.total += 1;
  if (isGeo) bucket.geo += 1;
  if (bucket.total > 15) return { allowed: false, reason: 'Превышен лимит запросов (не более 15 в минуту). Подождите немного.' };
  if (isGeo && bucket.geo > 5) return { allowed: false, reason: 'Гео-запросы ограничены 5 точками в минуту для защиты метеосерверов.' };
  return { allowed: true };
}

const QUICK_CITIES = [
  { name: 'Новый Уренгой', lat: 66.0833, lon: 76.6800, basin: 'Обь-Тазовский северный бассейн (ЯНАО)', water: 'р. Седе-Яха / р. Ево-Яха', topFish: ['Налим', 'Пелядь (Сырок)', 'Елец сибирский', 'Щука', 'Окунь', 'Щокур (Чир)'] },
  { name: 'Салехард', lat: 66.5300, lon: 66.6000, basin: 'Обь-Тазовский северный бассейн (ЯНАО)', water: 'р. Обь / р. Полуй', topFish: ['Налим', 'Корюшка', 'Ряпушка', 'Щука', 'Язь', 'Пыжьян'] },
  { name: 'Надым', lat: 65.5330, lon: 72.5200, basin: 'Обь-Тазовский северный бассейн (ЯНАО)', water: 'р. Надым / оз. Янтарное', topFish: ['Щука', 'Окунь', 'Налим', 'Плотва (Сорога)', 'Елец', 'Язь'] },
  { name: 'Тарко-Сале', lat: 64.9150, lon: 77.7800, basin: 'Обь-Тазовский северный бассейн (ЯНАО)', water: 'р. Пяку-Пур / р. Айваседа-Пур', topFish: ['Щука', 'Окунь', 'Елец', 'Язь', 'Налим', 'Пелядь (Сырок)'] },
  { name: 'Ноябрьск', lat: 63.2000, lon: 75.4500, basin: 'Обь-Тазовский северный бассейн (ЯНАО)', water: 'оз. Ханто / р. Нанкпёх', topFish: ['Окунь', 'Щука', 'Плотва (Сорога)', 'Карась', 'Налим'] },
  { name: 'Сургут', lat: 61.2500, lon: 73.4000, basin: 'Обь-Иртышский бассейн (ХМАО)', water: 'р. Обь / водохранилище ГРЭС', topFish: ['Щука', 'Судак', 'Окунь', 'Язь', 'Лещ', 'Налим'] },
  { name: 'Нижневартовск', lat: 60.9300, lon: 76.5500, basin: 'Обь-Иртышский бассейн (ХМАО)', water: 'р. Обь / р. Вах', topFish: ['Щука', 'Окунь', 'Язь', 'Судак', 'Налим', 'Елец'] },
  { name: 'Ханты-Мансийск', lat: 61.0000, lon: 69.0200, basin: 'Обь-Иртышский бассейн (ХМАО)', water: 'р. Иртыш / р. Обь', topFish: ['Щука', 'Судак', 'Окунь', 'Язь', 'Налим'] },
  { name: 'Тюмень', lat: 57.1530, lon: 65.5343, basin: 'Обь-Иртышский бассейн', water: 'р. Тура / Андреевское оз.', topFish: ['Лещ', 'Судак', 'Щука', 'Окунь', 'Карась', 'Чебак'] },
  { name: 'Екатеринбург', lat: 56.8389, lon: 60.6057, basin: 'Камско-Тобольский бассейн (Урал)', water: 'Белоярское вдхр. / р. Исеть', topFish: ['Судак', 'Лещ', 'Окунь', 'Щука', 'Плотва (Чебак)', 'Карась'] },
  { name: 'Новосибирск', lat: 55.0084, lon: 82.9357, basin: 'Верхнеобский бассейн', water: 'р. Обь / Обское море', topFish: ['Судак', 'Окунь', 'Щука', 'Лещ', 'Язь', 'Налим'] },
  { name: 'Омск', lat: 54.9885, lon: 73.3242, basin: 'Иртышский бассейн', water: 'р. Иртыш / р. Омь', topFish: ['Судак', 'Щука', 'Лещ', 'Язь', 'Окунь', 'Налим'] },
  { name: 'Пермь', lat: 58.0105, lon: 56.2502, basin: 'Камский бассейн', water: 'р. Кама / Камское вдхр.', topFish: ['Судак', 'Лещ', 'Щука', 'Окунь', 'Жерех', 'Налим'] },
  { name: 'Москва', lat: 55.7558, lon: 37.6173, basin: 'Волжско-Каспийский бассейн', water: 'р. Москва / р. Ока / Пироговское вдхр.', topFish: ['Судак', 'Окунь', 'Лещ', 'Плотва', 'Щука', 'Голавль'] },
  { name: 'Санкт-Петербург', lat: 59.9343, lon: 30.3351, basin: 'Балтийский и Ладожский бассейн', water: 'р. Нева / Финский залив / Ладога', topFish: ['Судак', 'Корюшка', 'Окунь', 'Лещ', 'Щука', 'Плотва'] },
  { name: 'Астрахань', lat: 46.3497, lon: 48.0408, basin: 'Волжско-Каспийский бассейн (Дельта)', water: 'р. Волга / р. Ахтуба', topFish: ['Сазан', 'Судак', 'Жерех', 'Сом', 'Щука', 'Вобла', 'Карась'] },
  { name: 'Казань', lat: 55.7961, lon: 49.1064, basin: 'Волжско-Каспийский бассейн', water: 'Куйбышевское вдхр. (Волга / Кама)', topFish: ['Судак', 'Берш', 'Лещ', 'Щука', 'Окунь', 'Жерех'] },
  { name: 'Самара', lat: 53.1959, lon: 50.1002, basin: 'Волжско-Каспийский бассейн', water: 'Саратовское вдхр. (Волга)', topFish: ['Судак', 'Лещ', 'Щука', 'Окунь', 'Голавль', 'Жерех'] },
  { name: 'Ростов-на-Дону', lat: 47.2225, lon: 39.7187, basin: 'Черноморско-Азовский бассейн', water: 'р. Дон / Таганрогский залив', topFish: ['Судак', 'Сазан', 'Тарань', 'Лещ', 'Пеленгас', 'Карась'] },
  { name: 'Мурманск', lat: 68.9707, lon: 33.0750, basin: 'Баренцево-Беломорский бассейн', water: 'Кольский залив / р. Кола / р. Тулома', topFish: ['Треска', 'Сёмга', 'Кумжа', 'Голец', 'Хариус', 'Сайда'] },
  { name: 'Красноярск', lat: 56.0153, lon: 92.8932, basin: 'Енисейский бассейн', water: 'р. Енисей / р. Мана / Красноярское вдхр.', topFish: ['Хариус сибирский', 'Елец', 'Щука', 'Окунь', 'Налим', 'Ленок'] },
  { name: 'Иркутск', lat: 52.2864, lon: 104.3050, basin: 'Байкало-Ангарский бассейн', water: 'р. Ангара / оз. Байкал', topFish: ['Байкальский хариус', 'Омуль', 'Щука', 'Окунь', 'Елец'] },
  { name: 'Хабаровск', lat: 48.4802, lon: 135.0719, basin: 'Амурский бассейн', water: 'р. Амур / р. Уссури', topFish: ['Верхогляд', 'Змееголов', 'Сазан', 'Щука амурская', 'Кета', 'Сом'] },
  { name: 'Владивосток', lat: 43.1155, lon: 131.8855, basin: 'Тихоокеанский морской бассейн', water: 'Залив Петра Великого / Амурский залив', topFish: ['Камбала', 'Навага', 'Корюшка зубастая', 'Терпуг', 'Минтай', 'Кета'] }
];

// Словарь распознавания целевой рыбы из запросов вида «Новый Уренгой щука», «Сургут судак», «налим»
const BOT_FISH_CATALOG = [
  { id: 'pike', name: 'Щука', keywords: ['щук', 'щука', 'щуку', 'щуки', 'травянк'], optT: [6, 16], coldBonus: 8, gear: 'Джиг 10–24 г / Воблер-суспендер 90–110 мм / Колебалка (поводок-струна)', win: '08:00–11:00 и 15:00–17:30' },
  { id: 'burbot', name: 'Налим', keywords: ['налим', 'налима', 'меньк'], optT: [0, 8], coldBonus: 18, gear: 'Донная снасть / Закидушка / Тяжёлая стукалка с подсадкой ерша или резки рыбы', win: '18:00–23:30 (сумерки и ночь)' },
  { id: 'perch', name: 'Окунь речной', keywords: ['окун', 'окунь', 'горбач', 'матрос'], optT: [8, 18], coldBonus: 6, gear: 'Микроджиг 1.5–5 г / Отводной поводок / Балансир 40–50 мм', win: '07:30–10:30 и 15:30–17:30' },
  { id: 'zander', name: 'Судак', keywords: ['судак', 'судака', 'клыкаст'], optT: [10, 20], coldBonus: 5, gear: 'Джиг по русловой бровке 14–32 г (мандула / виброхвост 3.5–4.5")', win: '06:30–09:00 и 17:00–20:00' },
  { id: 'peled', name: 'Пелядь (Сырок)', keywords: ['пеляд', 'сырок', 'сырка'], optT: [2, 14], coldBonus: 12, gear: 'Деликатный поплавок / Мормышинг 0.3–0.6 г / Гирлянда с бокоплавом (мормышем)', win: '08:00–12:00' },
  { id: 'dace', name: 'Елец сибирский', keywords: ['елец', 'ельца', 'мохтик', 'мегдым'], optT: [4, 16], coldBonus: 10, gear: 'Поплавок в проводку / Мормышка 0.3–0.5 г (мотыль, опарыш)', win: '09:00–14:00' },
  { id: 'chir', name: 'Щокур (Чир)', keywords: ['чир', 'щокур', 'щекур'], optT: [1, 11], coldBonus: 14, gear: 'Донный пикер / Мормышка у дна с пучком мотыля или бокоплава', win: '08:30–13:00' },
  { id: 'pizhyan', name: 'Пыжьян (Сибирский сиг)', keywords: ['пыжьян', 'сиг', 'сига'], optT: [1, 12], coldBonus: 14, gear: 'Поплавок в проводку / Нахлыст (нимфа) / Зимняя гирлянда', win: '08:00–12:00' },
  { id: 'roach', name: 'Плотва (Сорога / Чебак)', keywords: ['плотв', 'сорог', 'чебак', 'вобл', 'таран'], optT: [8, 19], coldBonus: 5, gear: 'Поплавочная удочка / Лёгкий фидер (поводок 0.10 мм, мотыль + опарыш)', win: '08:30–12:30' },
  { id: 'bream', name: 'Лещ', keywords: ['лещ', 'подлещ'], optT: [11, 20], coldBonus: 2, gear: 'Фидерная кормушка на русловом свале (мотыль, опарыш, специи)', win: '06:00–10:00' },
  { id: 'crucian', name: 'Карась', keywords: ['карас'], optT: [14, 24], coldBonus: -14, gear: 'Маховая поплавочная удочка / Флэт-фидер (мотыль, червь, чеснок)', win: '09:00–13:00' },
  { id: 'carp', name: 'Сазан / Карп', keywords: ['сазан', 'карп'], optT: [16, 25], coldBonus: -12, gear: 'Карповая донная снасть / Фидер (жмых, бойл, кукуруза, червь)', win: '07:00–11:00' },
  { id: 'grayling', name: 'Хариус', keywords: ['хариус', 'харьк'], optT: [4, 14], coldBonus: 12, gear: 'Нахлыст / Сбирулино (грузовой настрой с мушкой под бормаша) / Вертушка №0–1', win: '09:00–15:00' },
  { id: 'smelt', name: 'Корюшка', keywords: ['корюшк', 'зубар'], optT: [0, 9], coldBonus: 15, gear: 'Гирлянда светонакопительных мормышек / Самодур с кусочком рыбы или креветки', win: '07:30–12:00' },
  { id: 'ide', name: 'Язь', keywords: ['язь', 'язя', 'подъяз'], optT: [8, 18], coldBonus: 6, gear: 'Спиннинг (крэнк / вертушка №2) или фидер на границе струи', win: '07:30–11:00' },
  { id: 'catfish', name: 'Сом', keywords: ['сом', 'сома'], optT: [16, 26], coldBonus: -18, gear: 'Мощная донная снасть по русловым ямам (пучок выползков, живец, печень)', win: '20:00–03:00' },
  { id: 'trout', name: 'Форель / Кумжа', keywords: ['форел', 'кумж', 'микиж'], optT: [6, 15], coldBonus: 10, gear: 'Ультралайт до 4 г (микроколебалки, силиконовый слаг, форелевая паста)', win: '07:30–11:00' }
];

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

function findNearestCity(lat, lon) {
  let best = QUICK_CITIES[0];
  let bestDist = Infinity;
  for (const c of QUICK_CITIES) {
    const d = haversineKm(lat, lon, c.lat, c.lon);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return { ...best, distKm: bestDist };
}

/**
 * Умный парсер текста вида «Новый Уренгой щука», «/klev Сургут судак», «налим»
 */
export function parseCityAndFishQuery(rawQuery) {
  const q = String(rawQuery || '')
    .replace(/^\/(klev|crew|circle|start)(@\S+)?\s*/i, '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е');

  let matchedFish = null;
  for (const f of BOT_FISH_CATALOG) {
    if (f.keywords.some(kw => q.includes(kw))) {
      matchedFish = f;
      break;
    }
  }

  let matchedCity = null;
  for (const c of QUICK_CITIES) {
    const cNorm = c.name.toLowerCase().replace(/ё/g, 'е');
    if (q.includes(cNorm)) {
      matchedCity = c;
      break;
    }
    const tokens = cNorm.split(/[\s-]+/).filter(t => t.length >= 4);
    if (tokens.length > 0 && tokens.some(tok => q.includes(tok))) {
      matchedCity = c;
      break;
    }
  }

  const city = matchedCity || QUICK_CITIES[0];
  if (!matchedFish) {
    const topName = (city.topFish[0] || 'Щука').toLowerCase().replace(/ё/g, 'е');
    matchedFish = BOT_FISH_CATALOG.find(f => f.keywords.some(kw => topName.includes(kw))) || BOT_FISH_CATALOG[0];
  }

  return { city, fish: matchedFish, hadExplicitFish: Boolean(q && BOT_FISH_CATALOG.some(f => f.keywords.some(kw => q.includes(kw)))) };
}

function findCityByText(query) {
  return parseCityAndFishQuery(query).city;
}

function computeFishScoreForWeather(fishObj, w) {
  const wt = w.waterTemp ?? 3.0;
  const [minOpt, maxOpt] = fishObj.optT || [6, 16];
  let score = 58;
  if (wt >= minOpt && wt <= maxOpt) {
    score += 20;
  } else if (wt < minOpt) {
    score += Math.max(-22, Math.round(fishObj.coldBonus - (minOpt - wt) * 3.5));
  } else {
    score -= Math.round((wt - maxOpt) * 3);
  }
  const pDiff = Math.abs((w.press || 754) - 755);
  score += Math.round(6 - Math.min(12, pDiff * 0.7));
  if (w.wind >= 1.5 && w.wind <= 5.5) score += 5;
  else if (w.wind > 8.5) score -= 12;
  return Math.max(18, Math.min(96, score));
}

function encodeSharePack(payloadObj) {
  const jsonStr = JSON.stringify(payloadObj);
  const utf8Bytes = Buffer.from(jsonStr, 'utf8');
  const saltBytes = Buffer.from(CIPHER_SALT, 'utf8');
  const out = Buffer.alloc(utf8Bytes.length);
  for (let i = 0; i < utf8Bytes.length; i++) {
    out[i] = utf8Bytes[i] ^ saltBytes[i % saltBytes.length] ^ ((i * 31) & 0xff);
  }
  const b64url = out.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `KP1_${b64url}`;
}

function blurCoords(lat, lon) {
  const dLat = 0.018;
  const dLon = 0.025;
  return {
    lat: Math.round((lat + dLat) * 1000) / 1000,
    lon: Math.round((lon - dLon) * 1000) / 1000,
    br: 5.0
  };
}

async function fetchLiveSpotWeather(lat, lon) {
  try {
    const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'KlevProClubBot/2.0.164 (https://klevpro.ru)' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const first = data?.properties?.timeseries?.[0]?.data?.instant?.details;
    const elev = data?.geometry?.coordinates?.[2] || 60;
    if (first) {
      const tAir = Math.round((first.air_temperature ?? 5) * 10) / 10;
      const pMm = Math.round((first.air_pressure_at_sea_level || 1013) * 0.750062 - elev / 11.5);
      const wind = Math.round((first.wind_speed ?? 3) * 10) / 10;
      const waterTemp = Math.max(0.4, Math.min(24, Math.round((tAir * 0.52 + 2.4) * 10) / 10));
      const iceText = tAir <= -6 && waterTemp <= 0.8
        ? '❄️ Устойчивый ледостав'
        : (tAir <= 2.5 && tAir >= -3.5 ? '🌊❄️ Шуга и забереги (сплошного льда нет)' : '🌊 Открытая вода');
      return { tAir, waterTemp, press: pMm, wind, iceText, source: 'MET.no Онлайн' };
    }
  } catch (e) {}
  return {
    tAir: 1.5,
    waterTemp: 2.3,
    press: 762,
    wind: 3.6,
    iceText: '🌊❄️ Шуга и забереги (сплошного льда нет)',
    source: 'Автономная модель'
  };
}

async function buildSpotForecastMessage(lat, lon, customTitle = '', targetFishObj = null) {
  const near = findNearestCity(lat, lon);
  const w = await fetchLiveSpotWeather(lat, lon);
  const fish = targetFishObj || BOT_FISH_CATALOG[0];
  const fishScore = computeFishScoreForWeather(fish, w);
  const verdict = fishScore >= 65
    ? '🟢 Отличный клёв (Стоит ехать)'
    : (fishScore >= 42 ? '🟡 Умеренный / Осторожный клёв' : '🔴 Капризный клёв (слом погоды)');

  const locTitle = customTitle || (near.distKm <= 55 ? `${near.name} (${near.water})` : `${lat.toFixed(3)}°N, ${lon.toFixed(3)}°E`);
  const now = Date.now();

  const crewToken = encodeSharePack({
    t: 'crew',
    id: `crew_${now.toString(36)}`,
    ca: now,
    ea: now + 72 * 3600 * 1000,
    au: 'Telegram Экипаж',
    lb: near.name,
    wn: near.water,
    wt: 'small_river',
    lat: Math.round(lat * 10000) / 10000,
    lon: Math.round(lon * 10000) / 10000,
    dp: 2.2,
    fi: fish.id,
    fn: fish.name,
    mt: 'spin_micro',
    bt: 'Сезонная оснастка',
    tw: w.waterTemp,
    pr: w.press,
    nt: `Точка сбора экипажа из @KlevProClubBot (72 ч) • Цель: ${fish.name}`
  });

  const blurred = blurCoords(lat, lon);
  const circleToken = encodeSharePack({
    t: 'circle',
    id: `cir_${now.toString(36)}`,
    ca: now,
    au: 'Telegram Круг',
    lb: near.name,
    wn: near.water,
    wt: 'small_river',
    lat: blurred.lat,
    lon: blurred.lon,
    br: 5.0,
    dp: 2.0,
    fi: fish.id,
    fn: fish.name,
    mt: 'spin_micro',
    bt: 'По сезону',
    tw: w.waterTemp,
    pr: w.press,
    nt: `Размытая сводка Круга (±5 км) • Рыба: ${fish.name}`
  });

  const deepAppUrl = `${WEBAPP_URL}?tg_lat=${lat.toFixed(4)}&tg_lon=${lon.toFixed(4)}&tg_city=${encodeURIComponent(near.name)}&tg_fish=${fish.id}#/forecast`;

  const text =
    `🎣 *Клёв ПРО 2.0: Круг • Полевая сводка*
` +
    `📍 *Локация:* ${locTitle}
` +
    `🧭 *Бассейн:* ${near.basin}

` +
    `🐟 *Целевая рыба:* *${fish.name}* — активность *${fishScore}%*
` +
    `📊 *Вердикт:* ${verdict}
` +
    `⏰ *Лучшие часы выхода:* ${fish.win}
` +
    `🎯 *Рабочая снасть сейчас:* ${fish.gear}

` +
    `🌡 *Воздух:* ${w.tAir > 0 ? '+' + w.tAir : w.tAir}°C • 💧 *Вода:* ~${w.waterTemp}°C
` +
    `🧭 *Давление:* ${w.press} мм рт. ст. • 💨 *Ветер:* ${w.wind} м/с
` +
    `🧊 *Режим водоёма:* ${w.iceText}

` +
    `🏆 *Активные виды в этом водоёме:* ${near.topFish.slice(0, 5).join(', ')}

` +
    `🌊 *Код Экипажа (72 ч):* \`${crewToken}\``;

  const replyMarkup = {
    inline_keyboard: [
      [
        { text: `🎣 Открыть в Mini App: ${near.name} • ${fish.name}`, web_app: { url: deepAppUrl } }
      ],
      [
        { text: '🐟 Щука', callback_data: `fish:${near.name}:pike` },
        { text: '🐟 Налим', callback_data: `fish:${near.name}:burbot` },
        { text: '🐟 Окунь', callback_data: `fish:${near.name}:perch` },
        { text: '🐟 Пелядь', callback_data: `fish:${near.name}:peled` }
      ],
      [
        { text: '🌊 Точка Экипажа (72ч)', url: `${WEBAPP_URL}#klev_pack=${crewToken}` },
        { text: '👥 Сводка Круга (±5 км)', url: `${WEBAPP_URL}#klev_pack=${circleToken}` }
      ]
    ]
  };

  return { text, replyMarkup, crewToken, circleToken, near, w, fish, fishScore, deepAppUrl };
}

async function callTelegramApi(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

export async function handleUpdate(upd) {
  // 1. Обработка Inline-запросов (@KlevProClubBot Новый Уренгой щука)
  if (upd.inline_query) {
    const iq = upd.inline_query;
    const parsed = parseCityAndFishQuery(iq.query);
    const card = await buildSpotForecastMessage(parsed.city.lat, parsed.city.lon, `${parsed.city.name} (${parsed.city.water})`, parsed.fish);
    await callTelegramApi('answerInlineQuery', {
      inline_query_id: iq.id,
      cache_time: 60,
      results: [
        {
          type: 'article',
          id: `fc_${parsed.city.name}_${parsed.fish.id}`,
          title: `🎣 ${parsed.city.name}: ${parsed.fish.name} (${card.fishScore}%)`,
          description: `Вода ~${card.w.waterTemp}°C, ${card.w.press} мм • Выход: ${parsed.fish.win}`,
          input_message_content: {
            message_text: card.text,
            parse_mode: 'Markdown'
          },
          reply_markup: {
            inline_keyboard: [
              [{ text: `🧭 Открыть прогноз (${parsed.city.name} • ${parsed.fish.name})`, url: card.deepAppUrl }]
            ]
          }
        },
        {
          type: 'article',
          id: `crew_${parsed.city.name}_${parsed.fish.id}`,
          title: `🌊 Экипаж на 72 часа: ${parsed.city.name} (${parsed.fish.name})`,
          description: `Отправить зашифрованную точку сбора напарникам в чат`,
          input_message_content: {
            message_text: `🌊 *Выезд Экипажа (72 часа) • ${parsed.city.name}*
Водоём: ${parsed.city.water} • Цель: *${parsed.fish.name}*

🔗 [Открыть точку на карте Клёв ПРО](${WEBAPP_URL}#klev_pack=${card.crewToken})
🔑 Код пакета: \`${card.crewToken}\``,
            parse_mode: 'Markdown'
          }
        }
      ]
    });
    return;
  }

  // 2. Обработка нажатий на инлайн-кнопки выбора рыбы прямо в чате (callback_query)
  if (upd.callback_query) {
    const cq = upd.callback_query;
    const data = String(cq.data || '');
    if (data.startsWith('fish:')) {
      const [, cityName, fishId] = data.split(':');
      const city = QUICK_CITIES.find(c => c.name === cityName) || QUICK_CITIES[0];
      const fish = BOT_FISH_CATALOG.find(f => f.id === fishId) || BOT_FISH_CATALOG[0];
      const card = await buildSpotForecastMessage(city.lat, city.lon, `${city.name} (${city.water})`, fish);
      await callTelegramApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: `🎣 Пересчитано: ${city.name} • ${fish.name} (${card.fishScore}%)`
      });
      if (cq.message && cq.message.chat) {
        await callTelegramApi('editMessageText', {
          chat_id: cq.message.chat.id,
          message_id: cq.message.message_id,
          text: card.text,
          parse_mode: 'Markdown',
          reply_markup: card.replyMarkup
        });
      }
      return;
    }
  }

  const msg = upd.message;
  if (!msg || !msg.chat) return;
  const chatId = msg.chat.id;
  const userId = msg.from?.id || chatId;
  const rl = checkBotRateLimit(userId, Boolean(msg.location));
  if (!rl.allowed) {
    await callTelegramApi('sendMessage', { chat_id: chatId, text: `⏳ ${rl.reason}` });
    return;
  }

  // 3. Если пользователь прислал геопозицию (📎 -> Геопозиция)
  if (msg.location) {
    const { latitude, longitude } = msg.location;
    const card = await buildSpotForecastMessage(latitude, longitude);
    await callTelegramApi('sendMessage', {
      chat_id: chatId,
      text: card.text,
      parse_mode: 'Markdown',
      reply_markup: card.replyMarkup
    });
    return;
  }

  const txt = (msg.text || '').trim();

  if (txt.startsWith('/start')) {
    const startParam = txt.split(/\s+/)[1] || '';
    const appLink = startParam.startsWith('KP1_') ? `${WEBAPP_URL}#klev_pack=${startParam}` : WEBAPP_URL;
    await callTelegramApi('sendMessage', {
      chat_id: chatId,
      text:
        `👋 *Добро пожаловать в клубный навигатор «Клёв ПРО 2.0: Круг» (@KlevProClubBot)!*

` +
        `Я рассчитываю клёв по 115 видам рыб РФ (8 факторов, 5-дневный архив и барический шок, температура воды и безопасность льда).

` +
        `⚡ *Напишите мне прямо сюда в чат:*
` +
        `• Город и рыбу — например: \`Новый Уренгой щука\`, \`Сургут судак\` или \`Астрахань сазан\`
` +
        `• Или отправьте *геопозицию* (📎 ➔ Геопозиция)
` +
        `• Или нажмите кнопку ниже для выбора рыбы прямо в чате!`,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🎣 Открыть навигатор «Клёв ПРО 2.0» (Mini App)', web_app: { url: appLink } }],
          [
            { text: '📍 Новый Уренгой • Щука', callback_data: 'fish:Новый Уренгой:pike' },
            { text: '📍 Новый Уренгой • Налим', callback_data: 'fish:Новый Уренгой:burbot' }
          ],
          [
            { text: '📍 Сургут • Судак', callback_data: 'fish:Сургут:zander' },
            { text: '📍 Астрахань • Сазан', callback_data: 'fish:Астрахань:carp' }
          ]
        ]
      }
    });
    return;
  }

  // 4. Любой текстовый запрос («Новый Уренгой щука», «/klev», «/crew», «окунь» и т.д.)
  const parsed = parseCityAndFishQuery(txt);
  const card = await buildSpotForecastMessage(parsed.city.lat, parsed.city.lon, `${parsed.city.name} (${parsed.city.water})`, parsed.fish);
  await callTelegramApi('sendMessage', {
    chat_id: chatId,
    text: card.text,
    parse_mode: 'Markdown',
    reply_markup: card.replyMarkup
  });
}

async function autoConfigureBotOnStartup() {
  try {
    await callTelegramApi('deleteWebhook', { drop_pending_updates: false });
    await callTelegramApi('setMyCommands', {
      commands: [
        { command: 'start', description: 'Главное меню и запуск навигатора Клёв ПРО 2.0' },
        { command: 'klev', description: 'Прогноз по городу и рыбе (напр.: /klev Новый Уренгой щука)' },
        { command: 'crew', description: 'Создать точку сбора Экипажа на 72 часа' },
        { command: 'circle', description: 'Сводка Круга (±5 км) по водоёму' }
      ]
    });
    await callTelegramApi('setChatMenuButton', {
      menu_button: {
        type: 'web_app',
        text: '🎣 Клёв ПРО 2.0',
        web_app: { url: WEBAPP_URL }
      }
    });
  } catch (e) {}
}

async function startPolling() {
  if (!BOT_TOKEN) {
    console.log('ℹ️ Укажите токен бота от @BotFather одним из способов:');
    console.log('   node bot/klevpro-telegram-bot.mjs ВАШ_ТОКЕН');
    console.log('   или BOT_TOKEN="ВАШ_ТОКЕН" node bot/klevpro-telegram-bot.mjs');
    process.exit(0);
  }
  await autoConfigureBotOnStartup();
  const me = await callTelegramApi('getMe', {});
  const botName = me?.result?.username ? `@${me.result.username}` : '@KlevProClubBot';
  console.log(`✅ Бот ${botName} успешно запущен и настроен! Mini App URL: ${WEBAPP_URL}`);
  console.log('📡 Ожидание сообщений в чате (нажмите Ctrl+C для остановки)...');

  let offset = 0;
  while (true) {
    try {
      const res = await callTelegramApi('getUpdates', { offset, timeout: 25 });
      if (res && Array.isArray(res.result)) {
        for (const upd of res.result) {
          offset = upd.update_id + 1;
          await handleUpdate(upd);
        }
      }
    } catch (err) {
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

export { QUICK_CITIES, BOT_FISH_CATALOG, findNearestCity, findCityByText, encodeSharePack, buildSpotForecastMessage };

if (import.meta.url === `file://${process.argv[1]}`) {
  startPolling();
}
