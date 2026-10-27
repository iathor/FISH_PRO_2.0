/**
 * @file telegram.js
 * @description Модуль глубокой интеграции с Telegram Mini Apps (TMA / Telegram WebApp API),
 * нативными кнопками BackButton / MainButton, синхронизацией цветов шапки Telegram,
 * Telegram CloudStorage, HapticFeedback, Deep-Linking (?tg_city=...&tg_fish=... / start=KPLOC_...)
 * и мгновенным шарингом ультракоротких карточек «Круга», «Экипажа (72ч)» и «SOS» (#p=KP1_...) (Ревизия 2.0.172).
 */
import { showToast } from '../ui/components.js?v=2.0.172';
import { syncInstallButtons } from './pwa.js?v=2.0.172';
export const TELEGRAM_BOT_USERNAME = 'KlevProClubBot';
export const PUBLIC_APP_URL = 'https://klevpro.ru/';
export const RELAY_WORKER_URL = 'https://klevprohbot.thorantony82.workers.dev';
let tgWebApp = null;
let cloudSyncEnabled = false;
let backBtnHandler = null;
/**
 * Кодирует координаты и ID рыбы в безопасный токен Telegram без точек (только [A-Za-z0-9_-])
 * Пример: (57.6261, 39.8845, 'zander') -> 'KPLOC_576261_398845_zander'
 */
export function encodeKplocToken(lat, lon, fishId = 'pike') {
  const latInt = Math.round((Number(lat) || 66.0833) * 10000);
  const lonInt = Math.round((Number(lon) || 76.6800) * 10000);
  const latStr = latInt < 0 ? `M${Math.abs(latInt)}` : String(latInt);
  const lonStr = lonInt < 0 ? `M${Math.abs(lonInt)}` : String(lonInt);
  const cleanFish = String(fishId || 'pike').replace(/[^A-Za-z0-9_-]/g, '');
  return `KPLOC_${latStr}_${lonStr}_${cleanFish}`;
}
/**
 * Декодирует токен KPLOC_... (поддерживает и новый целочисленный формат KPLOC_576261_398845_zander,
 * и старый дробный формат KPLOC_66.0847_76.6700_smelt)
 */
export function decodeKplocToken(rawParam = '') {
  const str = String(rawParam || '').trim();
  if (!str.startsWith('KPLOC_')) return null;
  const parts = str.split('_');
  if (parts.length < 3) return null;
  const parseCoord = (p) => {
    if (!p) return NaN;
    const neg = p.startsWith('M') || p.startsWith('-');
    const clean = p.replace(/^[M-]/, '');
    const num = parseFloat(clean);
    if (!Number.isFinite(num)) return NaN;
    const val = (!clean.includes('.') && num > 180) ? (num / 10000) : num;
    return neg ? -val : val;
  };
  const lat = parseCoord(parts[1]);
  const lon = parseCoord(parts[2]);
  const fish = parts.slice(3).join('_') || '';
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon, fish };
}
/**
 * Проверяет, запущено ли приложение внутри контейнера Telegram Mini App
 */
export function isTelegramWebApp() {
  if (typeof window === 'undefined') return false;
  const twa = window.Telegram && window.Telegram.WebApp;
  if (twa && (
    (typeof twa.initData === 'string' && twa.initData.length > 0) ||
    (twa.initDataUnsafe && twa.initDataUnsafe.user) ||
    (twa.platform && twa.platform !== 'unknown')
  )) {
    return true;
  }
  const hash = window.location.hash || '';
  const search = window.location.search || '';
  return hash.includes('tgWebAppData') || search.includes('tgWebAppStartParam') || search.includes('tg_city=') || search.includes('tg_fish=');
}
/**
 * Возвращает объект пользователя Telegram (если приложение открыто внутри Telegram)
 */
export function getTelegramUser() {
  try {
    const u = window.Telegram?.WebApp?.initDataUnsafe?.user;
    if (u && u.id) {
      return {
        id: u.id,
        firstName: u.first_name || 'Рыболов',
        lastName: u.last_name || '',
        username: u.username || '',
        displayName: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || `Рыбак #${u.id}`
      };
    }
  } catch (e) {}
  return null;
}
/**
 * Синхронизирует цвет верхней системной панели и фона Telegram Mini App с темой приложения
 */
export function syncTelegramTheme(effectiveTheme = 'dark') {
  try {
    const twa = window.Telegram?.WebApp;
    if (!twa) return;
    const isLight = effectiveTheme === 'light';
    const headerHex = isLight ? '#ffffff' : '#151f32';
    const bgHex = isLight ? '#f1f5f9' : '#0b1120';
    if (typeof twa.setHeaderColor === 'function') twa.setHeaderColor(headerHex);
    if (typeof twa.setBackgroundColor === 'function') twa.setBackgroundColor(bgHex);
  } catch (e) {}
}
/**
 * Управляет системной кнопкой «Назад» (←) в шапке Telegram Mini App:
 * на внутренних вкладках возвращает в «Прогноз» вместо случайного закрытия всего приложения
 */
export function syncTelegramBackButton(currentRoute, onBack) {
  try {
    const bb = window.Telegram?.WebApp?.BackButton;
    if (!bb || !isTelegramWebApp()) return;
    if (backBtnHandler && typeof bb.offClick === 'function') {
      bb.offClick(backBtnHandler);
    }
    if (currentRoute && currentRoute !== 'forecast') {
      backBtnHandler = () => {
        triggerHaptic('selection');
        if (typeof onBack === 'function') onBack();
      };
      if (typeof bb.onClick === 'function') bb.onClick(backBtnHandler);
      if (typeof bb.show === 'function') bb.show();
    } else {
      if (typeof bb.hide === 'function') bb.hide();
    }
  } catch (e) {}
}
/**
 * Вызывает тактильный отклик (вибрацию) в Telegram Mini App или стандартный navigator.vibrate
 */
export function triggerHaptic(type = 'light') {
  try {
    const hf = window.Telegram?.WebApp?.HapticFeedback;
    if (hf) {
      if (type === 'success' || type === 'warning' || type === 'error') {
        hf.notificationOccurred(type);
      } else if (type === 'selection') {
        hf.selectionChanged();
      } else {
        hf.impactOccurred(type);
      }
      return;
    }
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(type === 'heavy' ? 25 : 10);
    }
  } catch (e) {}
}
/**
 * Извлекает параметры быстрого перехода из ответа бота (?tg_lat=...&tg_lon=...&tg_city=...&tg_fish=... или KPLOC_...)
 */
export function extractIncomingDeepLinkParams() {
  if (typeof window === 'undefined') return null;
  try {
    const searchParams = new URLSearchParams(window.location.search || '');
    const hashStr = window.location.hash || '';
    const hashQueryIdx = hashStr.indexOf('?');
    const hashParams = hashQueryIdx >= 0 ? new URLSearchParams(hashStr.slice(hashQueryIdx + 1)) : null;
    const getP = (k) => searchParams.get(k) || (hashParams ? hashParams.get(k) : null);
    const lat = parseFloat(getP('tg_lat') || '');
    const lon = parseFloat(getP('tg_lon') || '');
    const city = getP('tg_city') || '';
    const water = getP('tg_water') || '';
    const fish = getP('tg_fish') || '';
    const startParam = window.Telegram?.WebApp?.initDataUnsafe?.start_param ||
      getP('startapp') ||
      getP('tgWebAppStartParam') ||
      getP('start') || '';
    const decodedKploc = decodeKplocToken(startParam);
    if (decodedKploc) {
      return {
        lat: decodedKploc.lat,
        lon: decodedKploc.lon,
        city: city || '',
        water: water || '',
        fish: decodedKploc.fish || fish
      };
    }
    if ((Number.isFinite(lat) && Number.isFinite(lon)) || fish) {
      return {
        lat: Number.isFinite(lat) ? lat : null,
        lon: Number.isFinite(lon) ? lon : null,
        city,
        water,
        fish
      };
    }
  } catch (e) {}
  return null;
}
/**
 * Извлекает стартовый параметр пакета (#p=KP1_... или #klev_pack=KP1_... или ?startapp=KP1_...)
 */
export function extractIncomingShareToken() {
  if (typeof window === 'undefined') return null;
  try {
    const tgStart = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
    if (tgStart && tgStart.startsWith('KP1_')) {
      return tgStart;
    }
    const params = new URLSearchParams(window.location.search || '');
    const qParam = params.get('p') || params.get('startapp') || params.get('tgWebAppStartParam') || params.get('klev_pack') || params.get('start');
    if (qParam && qParam.startsWith('KP1_')) {
      return qParam;
    }
    const hash = window.location.hash || '';
    const match = hash.match(/(?:klev_pack|pack|p)=(KP1_[A-Za-z0-9_-]+)/);
    if (match && match[1]) {
      return match[1];
    }
  } catch (e) {}
  return null;
}
/**
 * Очищает одноразовый токен пакета из адресной строки после успешного импорта
 */
export function clearIncomingShareTokenFromUrl() {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  try {
    const hash = window.location.hash || '';
    if (hash.includes('klev_pack=') || hash.includes('pack=KP1_') || hash.includes('p=KP1_')) {
      window.history.replaceState(null, '', window.location.pathname + '#/circle');
    }
  } catch (e) {}
}
/**
 * Сохраняет компактный слепок точек и пакетов «Круга» в Telegram CloudStorage (если доступно)
 */
export async function syncToTelegramCloud(key, dataObj) {
  try {
    const cs = window.Telegram?.WebApp?.CloudStorage;
    if (!cs || typeof cs.setItem !== 'function') return false;
    const raw = JSON.stringify(dataObj);
    if (raw.length > 4000) return false;
    return await new Promise((resolve) => {
      cs.setItem(key, raw, (err, ok) => {
        resolve(!err && Boolean(ok));
      });
    });
  } catch (e) {
    return false;
  }
}
/**
 * Читает сохранённые данные из Telegram CloudStorage
 */
export async function readFromTelegramCloud(key) {
  try {
    const cs = window.Telegram?.WebApp?.CloudStorage;
    if (!cs || typeof cs.getItem !== 'function') return null;
    return await new Promise((resolve) => {
      cs.getItem(key, (err, val) => {
        if (err || !val) {
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(val));
        } catch (e) {
          resolve(null);
        }
      });
    });
  } catch (e) {
    return null;
  }
}
/**
 * Формирует универсальные рабочие ссылки для открытия пакета и прогноза (всегда публичный домен, никогда не androidplatform.net)
 */
export function getPublicShareBaseUrl() {
  try {
    if (typeof window !== 'undefined' && window.location?.origin) {
      const host = (window.location.hostname || '').toLowerCase();
      if (
        window.location.origin.startsWith('http') &&
        host &&
        host !== 'localhost' &&
        host !== '127.0.0.1' &&
        !host.endsWith('.androidplatform.net') &&
        !host.startsWith('192.168.') &&
        !host.startsWith('10.')
      ) {
        return window.location.origin + '/';
      }
    }
  } catch (e) {}
  return PUBLIC_APP_URL;
}
/**
 * Формирует ультракороткую ссылку #p=KP1_... (~50 символов целиком!)
 */
export function buildShareUrls(token) {
  const baseOrigin = getPublicShareBaseUrl();
  const webUrl = `${baseOrigin}#p=${encodeURIComponent(token)}`;
  const tgMiniAppUrl = token.length <= 64
    ? `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${encodeURIComponent(token)}`
    : webUrl;
  return { webUrl, tgMiniAppUrl };
}
/**
 * Формирует пару ссылок для шаринга конкретного прогноза по координатам и рыбе
 */
export function buildForecastShareUrls(lat, lon, cityLabel, fishId) {
  const baseOrigin = getPublicShareBaseUrl();
  const cleanLat = (Number(lat) || 66.0833).toFixed(4);
  const cleanLon = (Number(lon) || 76.6800).toFixed(4);
  const webUrl = `${baseOrigin}?tg_lat=${cleanLat}&tg_lon=${cleanLon}&tg_city=${encodeURIComponent(cityLabel || '')}&tg_fish=${encodeURIComponent(fishId || 'pike')}#/forecast`;
  const kplocToken = encodeKplocToken(lat, lon, fishId);
  const botStartUrl = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${kplocToken}`;
  return { webUrl, botStartUrl, kplocToken };
}
/**
 * Открывает диалог отправки сообщения/карточки в Telegram (работает и в браузере, и внутри Telegram Mini App)
 */
export function shareToTelegramChat(shareUrl, textSummary) {
  triggerHaptic('light');
  const fullTgShare = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(textSummary)}`;
  try {
    if (window.Telegram?.WebApp && typeof window.Telegram.WebApp.openTelegramLink === 'function' && isTelegramWebApp()) {
      window.Telegram.WebApp.openTelegramLink(fullTgShare);
      return true;
    }
    if (typeof window !== 'undefined' && typeof window.open === 'function') {
      window.open(fullTgShare, '_blank', 'noopener,noreferrer');
      return true;
    }
  } catch (e) {}
  return false;
}
/**
 * Открывает чат с ботом @KlevProClubBot
 */
export function openBotChatInTelegram() {
  triggerHaptic('light');
  const botUrl = `https://t.me/${TELEGRAM_BOT_USERNAME}`;
  try {
    if (window.Telegram?.WebApp && typeof window.Telegram.WebApp.openTelegramLink === 'function' && isTelegramWebApp()) {
      window.Telegram.WebApp.openTelegramLink(botUrl);
      return true;
    }
    if (typeof window !== 'undefined' && typeof window.open === 'function') {
      window.open(botUrl, '_blank', 'noopener,noreferrer');
      return true;
    }
  } catch (e) {}
  return false;
}
/**
 * Универсальная функция «Поделиться» (Web Share API -> Копирование в буфер обмена)
 */
export async function shareOrCopyPack({ title, text, url }) {
  triggerHaptic('light');
  const fullText = `${text}\n🔗 ${url}`;
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text, url });
      showToast('✅ Пакет успешно отправлен!', 'good');
      return { method: 'web_share', ok: true };
    } catch (err) {
      if (err && err.name === 'AbortError') {
        return { method: 'aborted', ok: false };
      }
    }
  }
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(fullText);
      showToast('📋 Короткая ссылка и карточка скопированы в буфер обмена!', 'good');
      return { method: 'clipboard', ok: true };
    }
  } catch (e) {}
  return { method: 'manual', ok: false, fullText };
}
/**
 * Базовая проверка целостности строки initData на клиенте (наличие 64-символьного hex-хэша HMAC-SHA256 и свежести auth_date)
 */
export function validateTelegramInitDataStructure(rawInitData = "") {
  const str = String(rawInitData || window.Telegram?.WebApp?.initData || "").trim();
  if (!str) return { present: false, validStructure: false, reason: "empty" };
  try {
    const params = new URLSearchParams(str);
    const hash = params.get("hash") || "";
    const authDate = parseInt(params.get("auth_date") || "0", 10);
    const isHex64 = /^[a-f0-9]{64}$/i.test(hash);
    const ageSec = authDate > 0 ? Math.floor(Date.now() / 1000) - authDate : 0;
    const isFresh = authDate > 0 && ageSec < 86400 * 7;
    return {
      present: true,
      validStructure: isHex64 && isFresh,
      hash,
      authDate,
      ageSec
    };
  } catch (e) {
    return { present: true, validStructure: false, reason: "parse_error" };
  }
}
export function initTelegramMiniApp(onTokenReceived = null, onDeepLinkReceived = null) {
  if (typeof window === 'undefined') return;
  const setupTwa = () => {
    try {
      const twa = window.Telegram?.WebApp;
      if (twa) {
        tgWebApp = twa;
        if (typeof twa.ready === 'function') twa.ready();
        if (typeof twa.expand === 'function') twa.expand();
        if (typeof twa.enableClosingConfirmation === 'function' && isTelegramWebApp()) {
          twa.enableClosingConfirmation();
        }
        cloudSyncEnabled = Boolean(twa.CloudStorage);
        const curTheme = document.documentElement.getAttribute('data-theme') || 'dark';
        syncTelegramTheme(curTheme);
        if (isTelegramWebApp()) {
          document.documentElement.setAttribute('data-tg-webapp', '1');
          document.documentElement.setAttribute('data-pwa-installed', '1');
          syncInstallButtons();
        }
      }
    } catch (e) {}
    const incomingToken = extractIncomingShareToken();
    if (incomingToken && typeof onTokenReceived === 'function') {
      onTokenReceived(incomingToken);
    }
    const deepLink = extractIncomingDeepLinkParams();
    if (deepLink && typeof onDeepLinkReceived === 'function') {
      onDeepLinkReceived(deepLink);
    }
  };
  window.__KLEV_ON_TG_SDK_LOAD__ = setupTwa;
  setupTwa();
}
export const telegramModule = {
  TELEGRAM_BOT_USERNAME,
  PUBLIC_APP_URL,
  RELAY_WORKER_URL,
  encodeKplocToken,
  decodeKplocToken,
  isTelegramWebApp,
  getTelegramUser,
  syncTelegramTheme,
  syncTelegramBackButton,
  triggerHaptic,
  extractIncomingDeepLinkParams,
  extractIncomingShareToken,
  clearIncomingShareTokenFromUrl,
  syncToTelegramCloud,
  readFromTelegramCloud,
  buildShareUrls,
  buildForecastShareUrls,
  shareToTelegramChat,
  openBotChatInTelegram,
  shareOrCopyPack,
  validateTelegramInitDataStructure,
  initTelegramMiniApp
};