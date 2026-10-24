/**
 * @file telegram.js
 * @description Модуль интеграции с Telegram Mini Apps (TMA / Telegram WebApp API),
 * поддержкой Telegram CloudStorage, HapticFeedback, Deep-Linking (startapp)
 * и мгновенного шаринга карточек «Круга», «Экипажа (72ч)» и «Мастерской снастей» в чаты Telegram (Ревизия 2.0.16).
 */

import { showToast } from '../ui/components.js?v=2.0.161';

export const TELEGRAM_BOT_USERNAME = 'KlevProBot';
export const PUBLIC_APP_URL = 'https://klevpro.ru/';

let tgWebApp = null;
let cloudSyncEnabled = false;

/**
 * Проверяет, запущено ли приложение внутри контейнера Telegram Mini App
 */
export function isTelegramWebApp() {
  if (typeof window === 'undefined') return false;
  const twa = window.Telegram && window.Telegram.WebApp;
  if (twa && (twa.initData || twa.platform && twa.platform !== 'unknown')) {
    return true;
  }
  const hash = window.location.hash || '';
  const search = window.location.search || '';
  return hash.includes('tgWebAppData') || search.includes('tgWebAppStartParam');
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
        hf.impactOccurred(type); // 'light' | 'medium' | 'heavy'
      }
      return;
    }
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(type === 'heavy' ? 25 : 10);
    }
  } catch (e) {}
}

/**
 * Извлекает стартовый параметр пакета (#klev_pack=... или ?startapp=... или tgWebAppStartParam)
 */
export function extractIncomingShareToken() {
  if (typeof window === 'undefined') return null;
  try {
    // 1. Из Telegram WebApp initDataUnsafe.start_param
    const tgStart = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
    if (tgStart && tgStart.startsWith('KP1_')) {
      return tgStart;
    }

    // 2. Из query-параметров (?startapp=KP1_... или ?klev_pack=KP1_...)
    const params = new URLSearchParams(window.location.search || '');
    const qParam = params.get('startapp') || params.get('tgWebAppStartParam') || params.get('klev_pack');
    if (qParam && qParam.startsWith('KP1_')) {
      return qParam;
    }

    // 3. Из URL hash (#klev_pack=KP1_... или #/circle?pack=KP1_...)
    const hash = window.location.hash || '';
    const match = hash.match(/(?:klev_pack|pack)=(KP1_[A-Za-z0-9_-]+)/);
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
    if (hash.includes('klev_pack=') || hash.includes('pack=KP1_')) {
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
    if (raw.length > 4000) return false; // Лимит значения в CloudStorage Telegram — 4096 байт
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
 * Формирует универсальную ссылку для открытия пакета в веб-версии (klevpro.ru) и в Telegram Mini App
 */
export function buildShareUrls(token) {
  const baseOrigin = (typeof window !== 'undefined' && window.location?.origin && window.location.origin.startsWith('http'))
    ? (window.location.origin + window.location.pathname)
    : PUBLIC_APP_URL;
  const webUrl = `${baseOrigin}#klev_pack=${encodeURIComponent(token)}`;
  const tgMiniAppUrl = `https://t.me/${TELEGRAM_BOT_USERNAME}/app?startapp=${encodeURIComponent(token)}`;
  return { webUrl, tgMiniAppUrl };
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
 * Универсальная функция «Поделиться» (Web Share API -> Копирование в буфер обмена)
 */
export async function shareOrCopyPack({ title, text, url, token }) {
  triggerHaptic('light');
  const fullText = `${text}\n\n🔗 Открыть в «Клёв ПРО»: ${url}\n🔑 Код пакета (для вставки вручную): ${token}`;

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text: `${text}\nКод: ${token}`, url });
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
      showToast('📋 Зашифрованная ссылка и код скопированы в буфер обмена! Перешлите их в чат.', 'good');
      return { method: 'clipboard', ok: true };
    }
  } catch (e) {}

  return { method: 'manual', ok: false, fullText };
}

/**
 * Инициализирует Telegram Mini App SDK (если запущено внутри Telegram или с параметрами TMA)
 */
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

export function initTelegramMiniApp(onTokenReceived = null) {
  if (typeof window === 'undefined') return;

  const setupTwa = () => {
    try {
      const twa = window.Telegram?.WebApp;
      if (twa) {
        tgWebApp = twa;
        if (typeof twa.ready === 'function') twa.ready();
        if (typeof twa.expand === 'function') twa.expand();
        cloudSyncEnabled = Boolean(twa.CloudStorage);

        const tgUser = getTelegramUser();
        if (tgUser) {
          document.documentElement.setAttribute('data-tg-webapp', '1');
        }
      }
    } catch (e) {}

    const incomingToken = extractIncomingShareToken();
    if (incomingToken && typeof onTokenReceived === 'function') {
      onTokenReceived(incomingToken);
    }
  };

  // Если скрипт Telegram уже есть или мы в обычном браузере с #klev_pack
  setupTwa();

  // Если открыто внутри Telegram Webview, но скрипт ещё не подгружен — подгружаем неблокирующе
  const ua = (navigator.userAgent || '').toLowerCase();
  const looksLikeTelegram = ua.includes('telegram') || typeof window.TelegramWebviewProxy !== 'undefined' || window.location.hash.includes('tgWebAppData');
  if (looksLikeTelegram && !window.Telegram?.WebApp) {
    const s = document.createElement('script');
    s.src = 'https://telegram.org/js/telegram-web-app.js';
    s.async = true;
    s.onload = setupTwa;
    document.head.appendChild(s);
  }
}

export const telegramModule = {
  TELEGRAM_BOT_USERNAME,
  PUBLIC_APP_URL,
  isTelegramWebApp,
  getTelegramUser,
  triggerHaptic,
  extractIncomingShareToken,
  clearIncomingShareTokenFromUrl,
  syncToTelegramCloud,
  readFromTelegramCloud,
  buildShareUrls,
  shareToTelegramChat,
  shareOrCopyPack,
  validateTelegramInitDataStructure,
  initTelegramMiniApp
};
