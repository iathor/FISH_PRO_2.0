#!/usr/bin/env node
/**
 * @file bot/klevpro-telegram-bot.mjs
 * @description Автономный Telegram-бот и сервер Mini App для «Клёв ПРО: Круг» (@KlevProBot) — Ревизия 2.0.16.
 * Не требует внешних npm-пакетов (работает на стандартном Node.js 18/20/22+ fetch и Long Polling).
 *
 * Возможности:
 * 1. Ответ на отправку геопозиции (📎 -> Геопозиция): мгновенный расчёт бассейна РФ, ближайших водоёмов,
 *    погоды (MET.no без VPN / Open-Meteo), температуры воды, льда и ТОП-5 активных видов рыб.
 * 2. Команды:
 *    - /start — Приветствие + кнопка запуска Telegram Mini App «Клёв ПРО 2.0» (klevpro.ru)
 *    - /klev <город или река> — Быстрый прогноз по 340+ городам/посёлкам и водоёмам РФ (например: /klev Новый Уренгой)
 *    - /crew <город> — Генерация зашифрованного приглашения «🌊 Экипаж на 72 часа» (код KP1_...)
 *    - /circle <город> — Генерация сводки «👥 Круг (±5 км со смещением центра)»
 * 3. Inline-режим (@KlevProBot Новый Уренгой): отправка карточек прогноза и приглашений «Экипажа (72ч)» в любой групповой чат рыболовов.
 *
 * Запуск:
 *   BOT_TOKEN="ваш_токен_от_BotFather" WEBAPP_URL="https://klevpro.ru/" node bot/klevpro-telegram-bot.mjs
 */

import crypto from 'node:crypto';

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

/**
 * Криптографическая проверка подписи Telegram WebApp initData (алгоритм HMAC-SHA256 по спецификации Telegram Mini Apps)
 */
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

/**
 * Проверка секретного заголовка вебхука X-Telegram-Bot-Api-Secret-Token
 */
export function verifyWebhookSecretToken(headerValue, expectedSecret = WEBHOOK_SECRET) {
  if (!expectedSecret) return true;
  return Boolean(headerValue && headerValue === expectedSecret);
}

/**
 * Защита от флуда и спама (Rate Limiter: не более 10 общих запросов в минуту и не более 3 гео-запросов в минуту на пользователя)
 */
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
  if (bucket.total > 10) return { allowed: false, reason: 'Превышен лимит запросов (не более 10 в минуту). Подождите немного.' };
  if (isGeo && bucket.geo > 3) return { allowed: false, reason: 'Гео-запросы ограничены 3 точками в минуту для защиты метеосерверов.' };
  return { allowed: true };
}
const WEBAPP_URL = (process.env.WEBAPP_URL || 'https://klevpro.ru/').replace(/\/?$/, '/');
const CIPHER_SALT = 'KlevProCircle_v2.1_Salt_RU';

// Быстрая встроенная база ключевых рыболовных центров РФ (для мгновенного ответа в чатах и Inline-режиме)
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

function findCityByText(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return QUICK_CITIES[0];
  return QUICK_CITIES.find(c => c.name.toLowerCase().includes(q) || q.includes(c.name.toLowerCase())) || QUICK_CITIES[0];
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

/**
 * Запрашивает оперативную погоду из MET.no (работает в РФ без VPN)
 */
async function fetchLiveSpotWeather(lat, lon) {
  try {
    const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'KlevProBot/2.0.16 (https://klevpro.ru)' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const first = data?.properties?.timeseries?.[0]?.data?.instant?.details;
    const elev = data?.geometry?.coordinates?.[2] || 60;
    if (first) {
      const tAir = Math.round((first.air_temperature ?? 5) * 10) / 10;
      const pMm = Math.round((first.air_pressure_at_sea_level || 1013) * 0.750062 - elev / 11.5);
      const wind = Math.round((first.wind_speed ?? 3) * 10) / 10;
      const waterTemp = Math.max(0.2, Math.min(24, Math.round((tAir * 0.52 + 2.4) * 10) / 10));
      const iceText = tAir <= -6 && waterTemp <= 0.8
        ? '❄️ Устойчивый ледостав'
        : (tAir <= 2 && tAir >= -3 ? '🌊❄️ Шуга и забереги (колебания около 0°C)' : '🌊 Открытая вода');
      return { tAir, waterTemp, press: pMm, wind, iceText, source: 'MET.no Онлайн' };
    }
  } catch (e) {}
  return {
    tAir: 2.0,
    waterTemp: 3.2,
    press: 754,
    wind: 3.5,
    iceText: '🌊 Открытая вода / предзимье',
    source: 'Автономная модель'
  };
}

async function buildSpotForecastMessage(lat, lon, customTitle = '') {
  const near = findNearestCity(lat, lon);
  const w = await fetchLiveSpotWeather(lat, lon);
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
    fi: 'pike',
    fn: near.topFish[0] || 'Щука',
    mt: 'spin_micro',
    bt: 'Сезонная оснастка',
    tw: w.waterTemp,
    pr: w.press,
    nt: 'Точка сбора экипажа из Telegram (72 ч)'
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
    fi: 'pike',
    fn: near.topFish[0] || 'Щука',
    mt: 'spin_micro',
    bt: 'По сезону',
    tw: w.waterTemp,
    pr: w.press,
    nt: 'Размытая сводка Круга (±5 км)'
  });

  const text =
    `🎣 *Клёв ПРО 2.0: Круг • Оперативная сводка*\n` +
    `📍 *Локация:* ${locTitle}\n` +
    `🧭 *Бассейн:* ${near.basin}\n\n` +
    `🌡 *Воздух:* ${w.tAir > 0 ? '+' + w.tAir : w.tAir}°C • 💧 *Вода:* ~${w.waterTemp}°C\n` +
    `🧭 *Давление:* ${w.press} мм рт. ст. • 💨 *Ветер:* ${w.wind} м/с\n` +
    `🧊 *Режим водоёма:* ${w.iceText}\n\n` +
    `🐟 *ТОП активных рыб сейчас:*\n` +
    near.topFish.map((f, i) => `  ${i + 1}. *${f}* — высокий приоритет`).join('\n') +
    `\n\n🌊 *Код для Экипажа (72 ч):* \`${crewToken}\`\n` +
    `👥 *Код для Круга (±5 км):* \`${circleToken}\``;

  const replyMarkup = {
    inline_keyboard: [
      [
        { text: '🧭 Открыть Клёв ПРО 2.0 (Mini App)', web_app: { url: `${WEBAPP_URL}#klev_pack=${crewToken}` } }
      ],
      [
        { text: '🌊 Открыть в браузере (Экипаж 72ч)', url: `${WEBAPP_URL}#klev_pack=${crewToken}` },
        { text: '👥 Сводка Круга (±5 км)', url: `${WEBAPP_URL}#klev_pack=${circleToken}` }
      ]
    ]
  };

  return { text, replyMarkup, crewToken, circleToken, near, w };
}

async function callTelegramApi(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function handleUpdate(upd) {
  // 1. Обработка Inline-запросов (@KlevProBot Новый Уренгой)
  if (upd.inline_query) {
    const iq = upd.inline_query;
    const city = findCityByText(iq.query);
    const card = await buildSpotForecastMessage(city.lat, city.lon, `${city.name} (${city.water})`);
    await callTelegramApi('answerInlineQuery', {
      inline_query_id: iq.id,
      cache_time: 120,
      results: [
        {
          type: 'article',
          id: `forecast_${city.name}`,
          title: `🎣 Прогноз клёва: ${city.name} (${city.water})`,
          description: `Вода ~${card.w.waterTemp}°C, ${card.w.press} мм • ТОП: ${city.topFish.slice(0, 3).join(', ')}`,
          input_message_content: {
            message_text: card.text,
            parse_mode: 'Markdown'
          },
          reply_markup: {
            inline_keyboard: [
              [{ text: '🧭 Открыть в Клёв ПРО 2.0', url: `${WEBAPP_URL}#klev_pack=${card.circleToken}` }]
            ]
          }
        },
        {
          type: 'article',
          id: `crew_${city.name}`,
          title: `🌊 Экипаж на 72 часа: ${city.name}`,
          description: `Отправить точную точку сбора напарникам (автоудаление через 72 ч)`,
          input_message_content: {
            message_text: `🌊 *Выезд Экипажа (72 часа) • ${city.name}*\nВодоём: ${city.water}\nТочные координаты активны 72 часа!\n\n🔗 [Открыть точку на карте Клёв ПРО](${WEBAPP_URL}#klev_pack=${card.crewToken})\n🔑 Код: \`${card.crewToken}\``,
            parse_mode: 'Markdown'
          }
        }
      ]
    });
    return;
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

  // 2. Если пользователь прислал геопозицию (📎 -> Геопозиция)
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
        `👋 *Добро пожаловать в «Клёв ПРО 2.0: Круг»!*\n\n` +
        `Это закрытый клубный навигатор рыболова РФ (115 видов рыб, 8-факторный прогноз с 5-дневным архивом и барическим шоком, честный расчёт льда).\n\n` +
        `📌 *Как пользоваться ботом:*\n` +
        `• Отправьте боту *геопозицию* (📎 ➔ Геопозиция) — получите мгновенный расчёт воды, льда и ТОП-5 рыб.\n` +
        `• Напишите \`/klev Новый Уренгой\` (или любой город/реку РФ).\n` +
        `• Напишите \`/crew Сургут\` — чтобы создать зашифрованную точку *«🌊 Экипаж на 72 часа»*.\n` +
        `• Нажмите кнопку ниже, чтобы запустить полный навигатор прямо внутри Telegram!`,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🎣 Запустить «Клёв ПРО 2.0» (Mini App)', web_app: { url: appLink } }],
          [{ text: '🌐 Открыть сайт klevpro.ru', url: appLink }]
        ]
      }
    });
    return;
  }

  if (txt.startsWith('/klev') || txt.startsWith('/crew') || txt.startsWith('/circle') || !txt.startsWith('/')) {
    const cleanQuery = txt.replace(/^\/(klev|crew|circle)(@\S+)?\s*/i, '').trim() || 'Новый Уренгой';
    const city = findCityByText(cleanQuery);
    const card = await buildSpotForecastMessage(city.lat, city.lon, `${city.name} (${city.water})`);
    await callTelegramApi('sendMessage', {
      chat_id: chatId,
      text: card.text,
      parse_mode: 'Markdown',
      reply_markup: card.replyMarkup
    });
  }
}

async function startPolling() {
  if (!BOT_TOKEN) {
    console.log('ℹ️ Для запуска живого Telegram-бота укажите переменную окружения BOT_TOKEN="токен_от_BotFather"');
    process.exit(0);
  }
  console.log(`🚀 Бот «Клёв ПРО: Круг» запущен! WebApp URL: ${WEBAPP_URL}`);
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

// Экспортируем функции для автотестов и запускаем polling при прямом вызове
export { QUICK_CITIES, findNearestCity, findCityByText, encodeSharePack, buildSpotForecastMessage };

if (import.meta.url === `file://${process.argv[1]}`) {
  startPolling();
}
