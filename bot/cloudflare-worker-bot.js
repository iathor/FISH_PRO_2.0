/**
 * @file bot/cloudflare-worker-bot.js
 * @description Автономная бессерверная (Serverless Webhook) версия бота @KlevProClubBot (Ревизия 2.0.164)
 * для круглосуточной бесплатной работы 24/7 на Cloudflare Workers (0 руб/мес, без включённого ПК!).
 *
 * Как подключить за 1 минуту:
 * 1. Вставьте этот код в Cloudflare Worker и добавьте переменную окружения BOT_TOKEN (ваш токен от @BotFather).
 * 2. Откройте в браузере адрес вашего воркера с параметром ?setup=1 (например: https://klevpro-bot.ваш-логин.workers.dev/?setup=1)
 *    — воркер сам привяжет Webhook к Telegram, настроит команды и синюю кнопку Mini App!
 */

const rateBuckets = new Map();

function checkWorkerRateLimit(userId, isGeo = false) {
  const now = Date.now();
  const key = String(userId || 'anon');
  let b = rateBuckets.get(key);
  if (!b || now - b.start >= 60000) {
    b = { start: now, total: 0, geo: 0 };
    rateBuckets.set(key, b);
  }
  b.total += 1;
  if (isGeo) b.geo += 1;
  if (b.total > 15) return false;
  if (isGeo && b.geo > 5) return false;
  return true;
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
  { name: 'Москва', lat: 55.7558, lon: 37.6173, basin: 'Волжско-Каспийский бассейн', water: 'р. Москва / р. Ока / Пироговское вдхр.', topFish: ['Судак', 'Окунь', 'Лещ', 'Плотва', 'Щука', 'Голавль'] },
  { name: 'Санкт-Петербург', lat: 59.9343, lon: 30.3351, basin: 'Балтийский и Ладожский бассейн', water: 'р. Нева / Финский залив / Ладога', topFish: ['Судак', 'Корюшка', 'Окунь', 'Лещ', 'Щука', 'Плотва'] },
  { name: 'Астрахань', lat: 46.3497, lon: 48.0408, basin: 'Волжско-Каспийский бассейн (Дельта)', water: 'р. Волга / р. Ахтуба', topFish: ['Сазан', 'Судак', 'Жерех', 'Сом', 'Щука', 'Вобла', 'Карась'] }
];

const BOT_FISH_CATALOG = [
  { id: 'pike', name: 'Щука', keywords: ['щук', 'щука', 'щуку', 'щуки'], optT: [6, 16], coldBonus: 8, gear: 'Джиг 10–24 г / Воблер-суспендер 90–110 мм / Колебалка (поводок-струна)', win: '08:00–11:00 и 15:00–17:30' },
  { id: 'burbot', name: 'Налим', keywords: ['налим', 'налима'], optT: [0, 8], coldBonus: 18, gear: 'Донная снасть / Закидушка / Тяжёлая стукалка с ершом или нарезкой рыбы', win: '18:00–23:30 (сумерки и ночь)' },
  { id: 'perch', name: 'Окунь речной', keywords: ['окун', 'окунь', 'горбач'], optT: [8, 18], coldBonus: 6, gear: 'Микроджиг 1.5–5 г / Отводной поводок / Балансир 40–50 мм', win: '07:30–10:30 и 15:30–17:30' },
  { id: 'zander', name: 'Судак', keywords: ['судак', 'судака'], optT: [10, 20], coldBonus: 5, gear: 'Джиг по русловой бровке 14–32 г (мандула / виброхвост)', win: '06:30–09:00 и 17:00–20:00' },
  { id: 'peled', name: 'Пелядь (Сырок)', keywords: ['пеляд', 'сырок', 'сырка'], optT: [2, 14], coldBonus: 12, gear: 'Деликатный поплавок / Мормышинг 0.3–0.6 г / Гирлянда с бокоплавом', win: '08:00–12:00' },
  { id: 'dace', name: 'Елец сибирский', keywords: ['елец', 'ельца', 'мохтик'], optT: [4, 16], coldBonus: 10, gear: 'Поплавок в проводку / Мормышка 0.3–0.5 г (мотыль, опарыш)', win: '09:00–14:00' },
  { id: 'carp', name: 'Сазан / Карп', keywords: ['сазан', 'карп'], optT: [16, 25], coldBonus: -12, gear: 'Карповая донная снасть / Фидер (жмых, бойл, кукуруза, червь)', win: '07:00–11:00' }
];

function parseQuery(raw) {
  const q = String(raw || '').replace(/^\/(klev|crew|circle|start)(@\S+)?\s*/i, '').trim().toLowerCase().replace(/ё/g, 'е');
  let fish = BOT_FISH_CATALOG.find(f => f.keywords.some(kw => q.includes(kw))) || null;
  let city = QUICK_CITIES.find(c => q.includes(c.name.toLowerCase().replace(/ё/g, 'е'))) || QUICK_CITIES[0];
  if (!fish) fish = BOT_FISH_CATALOG[0];
  return { city, fish };
}

export default {
  async fetch(request, env) {
    const BOT_TOKEN = env.BOT_TOKEN || '';
    const WEBHOOK_SECRET = env.WEBHOOK_SECRET || '';
    const WEBAPP_URL = (env.WEBAPP_URL || 'https://klevpro.ru/').replace(/\/?$/, '/');
    const reqUrl = new URL(request.url);

    // Автоматическая привязка Webhook в 1 клик при открытии ?setup=1 в браузере
    if (request.method === 'GET' && reqUrl.searchParams.get('setup') === '1' && BOT_TOKEN) {
      const webhookTarget = `${reqUrl.origin}${reqUrl.pathname}`;
      const whRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: webhookTarget, secret_token: WEBHOOK_SECRET || undefined })
      }).then(r => r.json());
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setChatMenuButton`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ menu_button: { type: 'web_app', text: '🎣 Клёв ПРО 2.0', web_app: { url: WEBAPP_URL } } })
      });
      return new Response(JSON.stringify({ status: 'webhook_registered', webhookTarget, telegramResponse: whRes }, null, 2), {
        headers: { 'Content-Type': 'application/json;charset=utf-8' }
      });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({
        status: 'ok',
        version: '2.0.164',
        service: 'Klev PRO 2.0 Telegram Bot (@KlevProClubBot) Webhook',
        setupHint: 'Add ?setup=1 to this URL to automatically bind Telegram Webhook',
        webapp: WEBAPP_URL
      }), { headers: { 'Content-Type': 'application/json;charset=utf-8' } });
    }

    if (WEBHOOK_SECRET) {
      const incomingSecret = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
      if (incomingSecret !== WEBHOOK_SECRET) {
        return new Response('Forbidden: invalid secret token', { status: 403 });
      }
    }

    try {
      const update = await request.json();
      const msg = update.message || update.callback_query?.message;
      if (msg && msg.chat && BOT_TOKEN) {
        const chatId = msg.chat.id;
        const userId = (update.message?.from?.id || update.callback_query?.from?.id) || chatId;

        if (!checkWorkerRateLimit(userId, Boolean(update.message?.location))) {
          return new Response('Rate limited', { status: 200 });
        }

        const rawText = update.callback_query?.data
          ? update.callback_query.data.replace('fish:', '').replace(':', ' ')
          : (update.message?.text || '');

        const { city, fish } = parseQuery(rawText);
        const deepAppUrl = `${WEBAPP_URL}?tg_lat=${city.lat.toFixed(4)}&tg_lon=${city.lon.toFixed(4)}&tg_city=${encodeURIComponent(city.name)}&tg_fish=${fish.id}#/forecast`;

        const replyText =
          `🎣 *Клёв ПРО 2.0: Круг • Оперативная сводка*
` +
          `📍 *Локация:* ${city.name} (${city.water})
` +
          `🐟 *Целевая рыба:* *${fish.name}*
` +
          `⏰ *Лучшие часы выхода:* ${fish.win}
` +
          `🎯 *Рекомендуемая снасть:* ${fish.gear}

` +
          `🏆 *ТОП активных рыб водоёма:* ${city.topFish.slice(0, 5).join(', ')}`;

        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: replyText,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: `🎣 Открыть в Mini App: ${city.name} • ${fish.name}`, web_app: { url: deepAppUrl } }],
                [
                  { text: '🐟 Щука', callback_data: `fish:${city.name}:pike` },
                  { text: '🐟 Налим', callback_data: `fish:${city.name}:burbot` },
                  { text: '🐟 Окунь', callback_data: `fish:${city.name}:perch` },
                  { text: '🐟 Пелядь', callback_data: `fish:${city.name}:peled` }
                ]
              ]
            }
          })
        });
      }
      return new Response('OK', { status: 200 });
    } catch (e) {
      return new Response('OK', { status: 200 });
    }
  }
};
