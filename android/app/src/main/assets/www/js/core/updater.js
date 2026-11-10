import { store } from './store.js?v=2.8.1-r227';
/**
 * @file updater.js
 * @description Модуль строгого контроля версий (v2.8.1 r227):
 * - В Android APK: запрос на обновление выводится ТОЛЬКО если версия/ревизия на сервере СТРОГО ВЫШЕ установленной в APK.
 * - На Сайте и в PWA: проверка выхода новой версии с уведомлением о необходимости обновления кэша
 *   и бережной очисткой устаревшего кэша и технических куки БЕЗ удаления пользовательских данных (точек, журнала, профиля, чатов, офлайн-карт).
 */
import { APP_VERSION, APP_BUILD_NUMBER, APP_REVISION, APP_DISPLAY_VERSION, RELEASE_CACHE_KEY, CURRENT_RELEASE_INFO } from './config.js?v=2.8.1-r227';
import { showToast } from '../ui/components.js?v=2.8.1-r227';

export const PUBLIC_SITE_ORIGIN = 'https://klevpro.ru';
export const APK_MANIFEST_PATH = '/apk/apk-version.json';
export const DEFAULT_APK_DOWNLOAD_URL = 'https://klevpro.ru/apk/klev-pro-v2.8.1.apk';
export const APK_BANNER_DISMISSED_KEY = 'klev_pro_hide_apk_banner_v2.8.1_r227';
const WEB_CACHE_SYNCED_VER_KEY = 'klev_pro_web_cache_synced_ver_v2';

let pendingSwRegistration = null;
let pendingReleaseInfo = null;
let updateBannerShown = false;
let _cachedApkManifest = null;
let _bootInitialInstalledRecord = null;

export function isInsideAndroidApk() {
  try {
    if (typeof window === 'undefined') return false;
    if (typeof window.AndroidBridge !== 'undefined') return true;
    const host = (window.location?.hostname || '').toLowerCase();
    if (host.endsWith('androidplatform.net')) return true;
    if (window.location?.protocol === 'file:') return true;
    const ua = navigator.userAgent || '';
    if (/KlevProAPK|KlevProAndroid|;\s*wv\)/i.test(ua)) return true;
    if (typeof document !== 'undefined' && document.documentElement.getAttribute('data-apk-webview') === '1') return true;
  } catch (e) {}
  return false;
}

export function isInsideTelegramMiniApp() {
  try {
    if (typeof window === 'undefined') return false;
    if (typeof document !== 'undefined' && (document.documentElement.getAttribute('data-tg-webapp') === '1' || document.documentElement.getAttribute('data-tg-miniapp') === '1')) return true;
    const twa = window.Telegram && window.Telegram.WebApp;
    if (twa && ((typeof twa.initData === 'string' && twa.initData.length > 0) || twa.initDataUnsafe?.user)) return true;
    const hash = window.location?.hash || '';
    const search = window.location?.search || '';
    if (hash.includes('tgWebAppData') || search.includes('tgWebAppStartParam') || search.includes('tma=1')) return true;
  } catch (e) {}
  return false;
}

export function isAndroidWebsiteVisitor() {
  try {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
    if (isInsideAndroidApk() || isInsideTelegramMiniApp()) return false;
    const ua = navigator.userAgent || '';
    const isAndroid = /Android/i.test(ua);
    const isIOS = /iPhone|iPad|iPod/i.test(ua);
    return isAndroid && !isIOS;
  } catch (e) {
    return false;
  }
}

export function extractBuildRevisionNumber(rawRevOrObj) {
  if (typeof rawRevOrObj === 'number' && Number.isFinite(rawRevOrObj)) {
    return rawRevOrObj > 100000 ? (rawRevOrObj % 1000) : rawRevOrObj;
  }
  if (rawRevOrObj && typeof rawRevOrObj === 'object') {
    if (Number.isFinite(Number(rawRevOrObj.buildNumber))) return Number(rawRevOrObj.buildNumber);
    const str = String(rawRevOrObj.revision || rawRevOrObj.buildRevision || rawRevOrObj.version || '');
    const m = str.match(/r(\d+)/i);
    if (m && m[1]) return parseInt(m[1], 10);
    if (Number.isFinite(Number(rawRevOrObj.versionCode)) && Number.isFinite(Number(rawRevOrObj.versionCode)) > 100000) {
      return Number(rawRevOrObj.versionCode) % 1000;
    }
    return 0;
  }
  const s = String(rawRevOrObj || '').trim();
  const m = s.match(/r(\d+)/i);
  if (m && m[1]) return parseInt(m[1], 10);
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  return 0;
}

export function formatVersionWithRevision(ver = APP_VERSION, rev = APP_REVISION) {
  const cleanVer = String(ver || APP_VERSION).replace(/-r\d+$/i, '').trim();
  const revNum = extractBuildRevisionNumber(rev);
  return revNum > 0 ? `v${cleanVer} r${revNum}` : `v${cleanVer}`;
}

export function compareSemverStrings(vA = '', vB = '') {
  const cleanA = String(vA || '').replace(/-r\d+$/i, '').replace(/[^0-9.]/g, '').split('.').map(n => parseInt(n, 10) || 0);
  const cleanB = String(vB || '').replace(/-r\d+$/i, '').replace(/[^0-9.]/g, '').split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(cleanA.length, cleanB.length, 3);
  for (let i = 0; i < len; i++) {
    const a = cleanA[i] || 0;
    const b = cleanB[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

/**
 * Строгое сравнение двух версий:
 * 1) Сначала сравнивается семантическая версия (например, 2.8.1 > 2.5.6 -> 1; 2.5.6 < 2.8.1 -> -1).
 * 2) Только при полном равенстве семантической версии сравнивается номер сборки (buildNumber / rNNN).
 */
export function compareReleaseVersions(verA, revA, verB, revB) {
  const semCmp = compareSemverStrings(verA, verB);
  if (semCmp !== 0) return semCmp;
  const rA = extractBuildRevisionNumber(revA);
  const rB = extractBuildRevisionNumber(revB);
  if (rA > 0 && rB > 0) {
    if (rA > rB) return 1;
    if (rA < rB) return -1;
  }
  return 0;
}

/**
 * Определяет установленную версию внутри Android APK.
 * Берёт максимум между значением из нативного моста AndroidBridge и встроенной константой пакета APP_VERSION,
 * чтобы никогда не возникало ложного срабатывания на уже установленную или более старую версию.
 */
export function getInstalledApkVersionString() {
  let bridgeVer = '';
  try {
    if (typeof window !== 'undefined' && window.AndroidBridge && typeof window.AndroidBridge.getAppVersion === 'function') {
      const v = String(window.AndroidBridge.getAppVersion() || '').trim();
      if (v) bridgeVer = v.replace(/-r\d+$/i, '').trim();
    }
    if (!bridgeVer) {
      const ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
      const m = ua.match(/KlevProAPK\/([0-9]+\.[0-9]+\.[0-9]+)/i);
      if (m && m[1]) bridgeVer = m[1];
    }
  } catch (e) {}
  if (bridgeVer && compareSemverStrings(bridgeVer, APP_VERSION) >= 0) {
    return bridgeVer;
  }
  return APP_VERSION;
}

export function getInstalledApkRevisionNumber() {
  let bridgeRev = 0;
  try {
    if (typeof window !== 'undefined' && window.AndroidBridge) {
      if (typeof window.AndroidBridge.getAppBuildNumber === 'function') {
        const bn = Number(window.AndroidBridge.getAppBuildNumber());
        if (Number.isFinite(bn) && bn > 0) bridgeRev = bn;
      }
      if (!bridgeRev && typeof window.AndroidBridge.getAppVersion === 'function') {
        const v = String(window.AndroidBridge.getAppVersion() || '').trim();
        const revFromBridge = extractBuildRevisionNumber(v);
        if (revFromBridge > 0) bridgeRev = revFromBridge;
      }
    }
    if (!bridgeRev) {
      const ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
      const m = ua.match(/KlevProAPK\/[0-9.]+\-r(\d+)/i);
      if (m && m[1]) bridgeRev = parseInt(m[1], 10);
    }
  } catch (e) {}
  return Math.max(bridgeRev || 0, APP_BUILD_NUMBER);
}

function getInstalledReleaseRecord() {
  try {
    const raw = localStorage.getItem(RELEASE_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function saveInstalledReleaseRecord(info) {
  try {
    const verStr = String(info?.version || APP_VERSION).replace(/-r\d+$/i, '').trim();
    const revNum = extractBuildRevisionNumber(info) || APP_BUILD_NUMBER;
    localStorage.setItem(RELEASE_CACHE_KEY, JSON.stringify({
      version: verStr,
      buildNumber: revNum,
      revision: `r${revNum}`,
      updatedAt: Date.now()
    }));
  } catch (e) {}
}

/**
 * Бережная очистка устаревшего кэша и технических куки при обновлении версии на Сайте и в PWA.
 * ГАРАНТИЯ СОХРАННОСТИ ДАННЫХ:
 * - НЕ затрагивает IndexedDB (сохранённые точки на карте, журнал уловов с фото, офлайн-тайлы карт, настройки).
 * - НЕ затрагивает пользовательские ключи localStorage (профиль, Рыболовный ID, логин/пароль, чаты, маршруты Фазы 3).
 * - Очищает только устаревшие технические куки (кроме авторизационных), кэш статических файлов Service Worker (CacheStorage)
 *   и временный кэш старого прогноза погоды, чтобы сразу применились новые ресурсы v2.8.1.
 */
export async function safeCleanObsoleteCacheAndCookies() {
  // 1. Аккуратная очистка только технических/кэширующих куки (сохраняем любые авторизационные/пользовательские куки)
  try {
    if (typeof document !== 'undefined' && typeof document.cookie === 'string' && document.cookie.length > 0) {
      const protectedCookiePattern = /^(klev_auth|klev_user|klev_fid|klev_profile|klev_session|auth_token)/i;
      const cookies = document.cookie.split(';');
      for (const rawCookie of cookies) {
        const eqIdx = rawCookie.indexOf('=');
        const name = (eqIdx > -1 ? rawCookie.slice(0, eqIdx) : rawCookie).trim();
        if (!name || protectedCookiePattern.test(name)) {
          continue; // Пользовательские и авторизационные куки НЕ трогаем
        }
        // Удаляем устаревшие технические/кэш куки
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax`;
      }
    }
  } catch (e) {}

  // 2. Очистка временного кэша погодных ответов в localStorage и sessionStorage (пользовательские данные НЕ затрагиваются)
  try {
    if (typeof localStorage !== 'undefined') {
      const transientKeys = [
        'klev_pro_weather_v2.0',
        'klev_pro_geo_weather_archive_v2',
        'klev_vision_ai_cache_v258_direct'
      ];
      transientKeys.forEach(k => {
        try { localStorage.removeItem(k); } catch (_e) {}
      });
    }
    if (typeof sessionStorage !== 'undefined') {
      const sKeys = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && !k.includes('telegram') && !k.includes('auth')) {
          sKeys.push(k);
        }
      }
      sKeys.forEach(k => {
        try { sessionStorage.removeItem(k); } catch (_e) {}
      });
    }
  } catch (e) {}

  // 3. Очистка CacheStorage статических файлов (офлайн-карты лежат в IndexedDB и остаются в полной сохранности)
  try {
    if (typeof window !== 'undefined' && 'caches' in window) {
      const keys = await window.caches.keys();
      await Promise.all(
        keys
          .filter(k => !String(k).toLowerCase().includes('offline-tiles'))
          .map(k => window.caches.delete(k))
      );
    }
  } catch (e) {}

  // 4. Обновление регистрации Service Worker
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) {
        try {
          if (r.waiting) {
            r.waiting.postMessage({ type: 'SKIP_WAITING' });
          }
          await r.update();
        } catch (_e) {}
      }
    }
  } catch (e) {}
}

function normalizeReleaseChanges(info) {
  const rawList = (Array.isArray(info?.changes) && info.changes.length > 0)
    ? info.changes
    : ((Array.isArray(info?.highlights) && info.highlights.length > 0)
        ? info.highlights
        : ((Array.isArray(info?.changelog) && info.changelog.length > 0)
            ? info.changelog
            : ((Array.isArray(info?.items) && info.items.length > 0)
                ? info.items
                : (Array.isArray(CURRENT_RELEASE_INFO?.highlights) ? CURRENT_RELEASE_INFO.highlights : []))));
  return rawList.map((item) => {
    if (typeof item === 'string') {
      const parts = item.split(':');
      if (parts.length > 1 && parts[0].length < 65) {
        return {
          icon: '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg>',
          title: parts[0].trim(),
          text: parts.slice(1).join(':').trim()
        };
      }
      return { icon: '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg>', title: 'Улучшение в приложении', text: item };
    }
    return {
      icon: item?.icon || '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg>',
      title: item?.title || 'Улучшение в приложении',
      text: item?.text || 'Исправлены ошибки, устранены баги, ускорена работа сервисов.'
    };
  });
}

function parseManifestJsonPayload(rawJson) {
  if (!rawJson || typeof rawJson !== 'object') return null;
  if (rawJson.content && rawJson.encoding === 'base64') {
    try {
      const cleanB64 = String(rawJson.content).replace(/\s+/g, '');
      const decoded = decodeURIComponent(escape(atob(cleanB64)));
      return JSON.parse(decoded);
    } catch (e) {
      return null;
    }
  }
  return rawJson;
}

/**
 * Запрашивает актуальный манифест релиза с сервера (без использования локального кэша)
 */
export async function fetchApkReleaseManifest() {
  const ts = Date.now();
  const inApk = isInsideAndroidApk();
  const siteManifestUrl = `${PUBLIC_SITE_ORIGIN}${APK_MANIFEST_PATH}?_t=${ts}`;
  const siteVersionUrl = `${PUBLIC_SITE_ORIGIN}/version.json?_t=${ts}`;
  const ghRawUrl = `https://raw.githubusercontent.com/iathor/FISH_PRO_2.0/main/apk/apk-version.json?_t=${ts}`;
  const ghApiUrl = `https://api.github.com/repos/iathor/FISH_PRO_2.0/contents/apk/apk-version.json?ref=main&_t=${ts}`;

  const candidateUrls = inApk
    ? [
        siteManifestUrl,
        siteVersionUrl,
        ghRawUrl,
        ghApiUrl
      ]
    : [
        `./version.json?_t=${ts}`,
        `./apk/apk-version.json?_t=${ts}`,
        siteVersionUrl,
        siteManifestUrl
      ];

  let bestManifest = null;
  for (const url of candidateUrls) {
    try {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, 3800) : null;
      const res = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache' },
        signal: ctrl ? ctrl.signal : undefined
      });
      if (timer) clearTimeout(timer);
      if (res && res.ok) {
        const rawData = await res.json();
        const data = parseManifestJsonPayload(rawData);
        if (data && data.version) {
          const ver = String(data.version).replace(/-r\d+$/i, '').trim();
          const revNum = extractBuildRevisionNumber(data) || APP_BUILD_NUMBER;
          const revStr = `r${revNum}`;
          const resolvedApkUrl = data.apkDownloadUrl || data.apkUrl || `${PUBLIC_SITE_ORIGIN}/apk/klev-pro-v${ver}.apk`;
          const candidate = {
            ...CURRENT_RELEASE_INFO,
            ...data,
            version: ver,
            buildNumber: revNum,
            revision: revStr,
            displayVersion: `v${ver} ${revStr}`,
            apkUrl: resolvedApkUrl,
            fileSize: data.apkSizeMb || data.fileSize || '38.6 МБ',
            changes: normalizeReleaseChanges(data)
          };
          if (!bestManifest || compareReleaseVersions(candidate.version, candidate.buildNumber, bestManifest.version, bestManifest.buildNumber) > 0) {
            bestManifest = candidate;
          }
        }
      }
    } catch (e) {}
  }

  if (bestManifest) {
    _cachedApkManifest = bestManifest;
    return _cachedApkManifest;
  }

  _cachedApkManifest = {
    ...CURRENT_RELEASE_INFO,
    buildNumber: APP_BUILD_NUMBER,
    revision: APP_REVISION,
    displayVersion: APP_DISPLAY_VERSION,
    apkUrl: CURRENT_RELEASE_INFO.apkUrl || DEFAULT_APK_DOWNLOAD_URL,
    fileSize: CURRENT_RELEASE_INFO.fileSize || '38.6 МБ',
    changes: normalizeReleaseChanges(CURRENT_RELEASE_INFO)
  };
  return _cachedApkManifest;
}

export function getCachedApkManifest() {
  return _cachedApkManifest || {
    ...CURRENT_RELEASE_INFO,
    buildNumber: APP_BUILD_NUMBER,
    revision: APP_REVISION,
    displayVersion: APP_DISPLAY_VERSION,
    apkUrl: CURRENT_RELEASE_INFO.apkUrl || DEFAULT_APK_DOWNLOAD_URL,
    fileSize: CURRENT_RELEASE_INFO.fileSize || '38.6 МБ',
    changes: normalizeReleaseChanges(CURRENT_RELEASE_INFO)
  };
}

export async function triggerApkFileDownload(customManifest = null) {
  showToast('Проверка актуальной сборки APK...', 'info');
  const manifest = customManifest || (await fetchApkReleaseManifest());
  const ver = manifest?.version || APP_VERSION;
  const rev = manifest?.revision || APP_REVISION;
  const disp = formatVersionWithRevision(ver, rev);
  const targetUrl = `${manifest?.apkUrl || `${PUBLIC_SITE_ORIGIN}/apk/klev-pro-v${ver}.apk`}${manifest?.apkUrl?.includes('?') ? '&' : '?'}rev=${encodeURIComponent(rev)}_${Date.now()}`;
  if (isInsideAndroidApk()) {
    try {
      if (window.AndroidBridge && typeof window.AndroidBridge.downloadApkUpdate === 'function') {
        window.AndroidBridge.downloadApkUpdate(targetUrl);
        showToast(`Запущена загрузка обновления Клёв ПРО (${disp})`, 'good');
        return true;
      }
    } catch (e) {}
    try {
      window.open(targetUrl, '_blank', 'noopener');
      showToast(`Запущена загрузка обновления Клёв ПРО (${disp})`, 'good');
      return true;
    } catch (e) {}
  }
  try {
    const a = document.createElement('a');
    a.href = targetUrl;
    a.setAttribute('download', `klev-pro-v${ver}-${rev}.apk`);
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast(`Загрузка «Клёв ПРО ${disp}.apk» началась! После скачивания откройте файл для установки.`, 'good');
    return true;
  } catch (e) {
    window.location.href = targetUrl;
    return true;
  }
}

export async function syncAndroidSiteApkDownloadUI() {
  if (typeof document === 'undefined') return;
  const bannerEl = document.getElementById('androidApkSiteBanner');
  if (!isAndroidWebsiteVisitor()) {
    if (bannerEl) bannerEl.style.display = 'none';
    return;
  }
  const manifest = await fetchApkReleaseManifest();
  const ver = manifest?.version || APP_VERSION;
  const rev = manifest?.revision || APP_REVISION;
  const disp = formatVersionWithRevision(ver, rev);
  const sizeStr = manifest?.fileSize ? ` • ${manifest.fileSize}` : '';
  let isDismissed = false;
  try {
    isDismissed = localStorage.getItem(APK_BANNER_DISMISSED_KEY) === '1';
  } catch (e) {}
  if (bannerEl) {
    if (isDismissed) {
      bannerEl.style.display = 'none';
    } else {
      bannerEl.style.display = 'flex';
      const titleEl = bannerEl.querySelector('#androidApkBannerTitle');
      const dlBtn = bannerEl.querySelector('#androidApkBannerDownloadBtn');
      const closeBtn = bannerEl.querySelector('#androidApkBannerCloseBtn');
      if (titleEl) {
        titleEl.innerHTML = `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="6" y="2" width="12" height="20" rx="2.5" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="18" r="1.2" fill="#38bdf8"/></svg> Приложение «Клёв ПРО 2.0» для Android (${disp}${sizeStr})`;
      }
      if (dlBtn) {
        dlBtn.innerHTML = `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg> Скачать APK (${disp})`;
        if (!dlBtn._apkBound) {
          dlBtn._apkBound = true;
          dlBtn.addEventListener('click', () => {
            triggerApkFileDownload(manifest);
          });
        }
      }
      if (closeBtn && !closeBtn._apkBound) {
        closeBtn._apkBound = true;
        closeBtn.addEventListener('click', () => {
          bannerEl.style.display = 'none';
          try {
            localStorage.setItem(APK_BANNER_DISMISSED_KEY, '1');
          } catch (e) {}
          showToast('Кнопка загрузки APK всегда доступна в «Настройках»', 'info');
        });
      }
    }
  }
}

export async function fetchServerReleaseInfo() {
  if (isInsideAndroidApk()) {
    return await fetchApkReleaseManifest();
  }
  const ts = Date.now();
  const urls = [
    `./version.json?_t=${ts}`,
    `${PUBLIC_SITE_ORIGIN}/version.json?_t=${ts}`
  ];
  let best = null;
  for (const u of urls) {
    try {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, 3500) : null;
      const res = await fetch(u, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache' },
        signal: ctrl ? ctrl.signal : undefined
      });
      if (timer) clearTimeout(timer);
      if (res && res.ok) {
        const data = await res.json();
        if (data && data.version) {
          const verClean = String(data.version).replace(/-r\d+$/i, '').trim();
          const revNum = extractBuildRevisionNumber(data) || APP_BUILD_NUMBER;
          const candidate = {
            ...CURRENT_RELEASE_INFO,
            ...data,
            version: verClean,
            buildNumber: revNum,
            revision: `r${revNum}`,
            displayVersion: formatVersionWithRevision(verClean, `r${revNum}`),
            changes: normalizeReleaseChanges(data)
          };
          if (!best || compareReleaseVersions(candidate.version, candidate.buildNumber, best.version, best.buildNumber) > 0) {
            best = candidate;
          }
        }
      }
    } catch (e) {}
  }
  if (best) return best;
  return {
    ...CURRENT_RELEASE_INFO,
    buildNumber: APP_BUILD_NUMBER,
    revision: APP_REVISION,
    displayVersion: APP_DISPLAY_VERSION,
    changes: normalizeReleaseChanges(CURRENT_RELEASE_INFO)
  };
}

function markHeaderUpdateAvailable(hasUpdate, releaseInfo = null) {
  const btn = document.getElementById('topNavSettingsBtn');
  if (!btn) return;
  if (hasUpdate) {
    btn.style.borderColor = 'var(--good)';
    btn.style.boxShadow = '0 0 0 2px rgba(16, 185, 129, 0.35)';
    btn.title = `Доступно обновление ${formatVersionWithRevision(releaseInfo?.version, releaseInfo?.revision)}`;
    btn.setAttribute('data-has-update', '1');
  } else {
    btn.style.borderColor = '';
    btn.style.boxShadow = '';
    btn.removeAttribute('data-has-update');
  }
}

export function showReleaseUpdateModal(releaseInfo = CURRENT_RELEASE_INFO, isPendingInstall = false) {
  const info = releaseInfo || CURRENT_RELEASE_INFO;
  const changesList = normalizeReleaseChanges(info);
  const inApk = isInsideAndroidApk();
  const installedApkVer = getInstalledApkVersionString();
  const installedApkRev = getInstalledApkRevisionNumber();
  const installedDisp = formatVersionWithRevision(installedApkVer, installedApkRev);
  const remoteDisp = formatVersionWithRevision(info.version || APP_VERSION, info.revision || info.buildNumber || APP_REVISION);

  // В APK обновление предлагается СТРОГО только если серверная версия выше установленной
  const hasNewerApk = inApk && compareReleaseVersions(info.version, info.revision || info.buildNumber, installedApkVer, installedApkRev) > 0;
  const needsWebCacheRefresh = !inApk && Boolean(isPendingInstall);

  let modal = document.getElementById('releaseUpdateModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'releaseUpdateModal';
    modal.className = 'modal-backdrop';
    modal.style.zIndex = '9995';
    document.body.appendChild(modal);
  }

  const changesHtml = changesList.map(item => `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r-sm);padding:10px 12px;margin-bottom:8px;">
      <div style="font-weight:800;font-size:var(--fs-sm);color:var(--accent);margin-bottom:4px;">
        ${item.icon} ${item.title}
      </div>
      <div style="font-size:var(--fs-xs);color:var(--text);line-height:1.48;">
        ${item.text}
      </div>
    </div>
  `).join('');

  const headerTitle = hasNewerApk
    ? `Доступна новая версия APK «Клёв ПРО 2.0» (${remoteDisp})`
    : (needsWebCacheRefresh
        ? `Вышло обновление ${remoteDisp} — необходимо обновить кэш`
        : `Версия приложения «Клёв ПРО 2.0» (${remoteDisp})`);

  const subtitleText = hasNewerApk
    ? `У вас установлена версия ${installedDisp} • На сервере доступна более высокая версия ${remoteDisp}.`
    : (needsWebCacheRefresh
        ? `Обнаружена новая версия сайта / PWA (${remoteDisp}). Нажмите «Обновить кэш и применить», чтобы очистить устаревший кэш браузера и технические куки без потери ваших данных.`
        : (info.subtitle || 'У вас установлена актуальная версия со всеми последними обновлениями.'));

  modal.innerHTML = `
    <div class="modal-box modal-has-sticky-footer" role="dialog" aria-modal="true" aria-label="${headerTitle}" style="max-width:540px;border-color:var(--accent);">
      <div style="margin-bottom:8px;">
        <span class="pill ${hasNewerApk || needsWebCacheRefresh ? 'pill-good' : 'pill-neutral'}" style="margin-bottom:6px;">
          ${hasNewerApk ? `Новое обновление APK (${remoteDisp})` : (needsWebCacheRefresh ? `Требуется обновление кэша (${remoteDisp})` : `Актуальная версия ${remoteDisp}`)}
        </span>
        <h3 style="font-size:var(--fs-lg);font-weight:800;color:var(--text);margin-top:4px;line-height:1.3;">
          ${headerTitle}
        </h3>
        <div style="font-size:var(--fs-xs);color:var(--muted);margin-top:3px;line-height:1.45;">
          ${subtitleText}
        </div>
      </div>
      <div style="font-weight:800;font-size:var(--fs-xs);color:var(--accent);margin-top:4px;">
        Что нового в версии ${remoteDisp}:
      </div>
      <div style="max-height:44vh;overflow-y:auto;padding-right:2px;margin:8px 0;">
        ${changesHtml}
      </div>
      <div style="padding:9px 11px;background:rgba(16,185,129,0.10);border:1px solid rgba(16,185,129,0.30);border-radius:var(--r-sm);font-size:var(--fs-xs);color:var(--muted);margin-bottom:4px;">
        <b>Ваши данные надёжно защищены:</b> при обновлении версии и очистке устаревшего кэша/куки все ваши точки на карте, журнал уловов с фото, профиль, чаты и офлайн-карты полностью сохраняются.
      </div>
      <div class="modal-sticky-footer" style="flex-wrap:wrap;">
        ${inApk ? `
          ${hasNewerApk ? `
            <button type="button" class="btn btn-good" id="relModalDownloadApkBtn" style="flex:2;min-width:190px;font-weight:800;">
              Загрузить APK (${remoteDisp})
            </button>
            <button type="button" class="btn" id="relModalLaterBtn" style="flex:1;min-width:110px;">Позже</button>
          ` : `
            <button type="button" class="btn btn-accent" id="relModalOkBtn" style="flex:1;min-width:140px;">Закрыть (версия актуальна)</button>
          `}
        ` : (needsWebCacheRefresh ? `
          <button type="button" class="btn btn-good" id="relModalConfirmBtn" style="flex:2;min-width:195px;font-weight:800;">
            Обновить кэш и применить (${remoteDisp})
          </button>
          <button type="button" class="btn" id="relModalLaterBtn" style="flex:1;min-width:105px;">Позже</button>
        ` : `
          <button type="button" class="btn" id="relModalForceSyncBtn" style="flex:1;min-width:155px;">Очистить кэш (${remoteDisp})</button>
          <button type="button" class="btn btn-accent" id="relModalOkBtn" style="flex:1;min-width:125px;">Закрыть</button>
        `)}
      </div>
    </div>
  `;

  modal.classList.add('open');
  if (typeof window !== 'undefined' && typeof window.__KLEV_PUSH_BACK_GUARD__ === 'function') {
    window.__KLEV_PUSH_BACK_GUARD__('releaseModal');
  }

  const closeLater = () => {
    saveInstalledReleaseRecord(info);
    const revKey = `${info?.version || APP_VERSION}_${info?.revision || APP_REVISION}`;
    try { localStorage.setItem('klev_pro_dismissed_rev', revKey); } catch (e) {}
    try { localStorage.setItem('klev_pro_dismissed_ver', revKey); } catch (e) {}
    try { localStorage.setItem(WEB_CACHE_SYNCED_VER_KEY, revKey); } catch (e) {}
    modal.classList.remove('open');
  };

  modal.onclick = (e) => {
    if (e.target === modal) closeLater();
  };
  modal.querySelector('#relModalCloseBtn')?.addEventListener('click', closeLater);
  modal.querySelector('#relModalLaterBtn')?.addEventListener('click', closeLater);
  modal.querySelector('#relModalOkBtn')?.addEventListener('click', closeLater);

  modal.querySelector('#relModalDownloadApkBtn')?.addEventListener('click', async () => {
    modal.classList.remove('open');
    await triggerApkFileDownload(info);
  });

  modal.querySelector('#relModalConfirmBtn')?.addEventListener('click', async () => {
    const btn = modal.querySelector('#relModalConfirmBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Очистка кэша и обновление...';
    }
    await applyFullReleaseUpdate(info);
  });

  modal.querySelector('#relModalForceSyncBtn')?.addEventListener('click', async () => {
    const btn = modal.querySelector('#relModalForceSyncBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Очистка кэша и перезагрузка...';
    }
    await applyFullReleaseUpdate(info);
  });
}

export async function applyFullReleaseUpdate(info = CURRENT_RELEASE_INFO) {
  saveInstalledReleaseRecord(info);
  const verClean = String(info?.version || APP_VERSION).replace(/-r\d+$/i, '').trim();
  const revNum = extractBuildRevisionNumber(info) || APP_BUILD_NUMBER;
  const revKey = `${verClean}_r${revNum}`;
  try {
    localStorage.setItem('klev_pro_dismissed_rev', revKey);
    localStorage.setItem('klev_pro_dismissed_ver', revKey);
    localStorage.setItem('klev_pro_just_updated_rev', revKey);
    localStorage.setItem(WEB_CACHE_SYNCED_VER_KEY, revKey);
  } catch (e) {}

  await safeCleanObsoleteCacheAndCookies();

  const cleanPath = window.location.pathname || '/';
  const hash = window.location.hash || '#/forecast';
  window.location.replace(`${cleanPath}?v=${encodeURIComponent(verClean)}&rev=r${revNum}_${Date.now()}${hash}`);
}

export async function checkForReleaseUpdate({ manual = false } = {}) {
  const inApk = isInsideAndroidApk();

  // 1. ВНУТРИ ANDROID APK: запрос ТОЛЬКО если версия на сервере СТРОГО ВЫШЕ установленной в APK
  if (inApk) {
    const apkManifest = await fetchApkReleaseManifest();
    const installedApkVer = getInstalledApkVersionString();
    const installedApkRev = getInstalledApkRevisionNumber();
    const cmp = compareReleaseVersions(
      apkManifest.version,
      apkManifest.buildNumber || apkManifest.revision,
      installedApkVer,
      installedApkRev
    );
    const isApkStrictlyHigher = cmp > 0;
    const targetRevKey = `${apkManifest.version}_r${extractBuildRevisionNumber(apkManifest) || APP_BUILD_NUMBER}`;
    const dismissedVer = (typeof localStorage !== 'undefined') ? localStorage.getItem('klev_pro_dismissed_ver') : null;

    if (isApkStrictlyHigher) {
      pendingReleaseInfo = apkManifest;
      markHeaderUpdateAvailable(true, apkManifest);
      if (manual || (!updateBannerShown && dismissedVer !== targetRevKey)) {
        updateBannerShown = true;
        showReleaseUpdateModal(apkManifest, true);
      }
      return true;
    }

    // Если версия на сервере равна или ниже установленной в APK — НИКОГДА не показываем автоматический запрос
    markHeaderUpdateAvailable(false);
    if (manual) {
      const disp = formatVersionWithRevision(installedApkVer, installedApkRev);
      showToast(`У вас установлена актуальная версия APK (${disp})`, 'good');
      showReleaseUpdateModal({
        ...apkManifest,
        version: installedApkVer,
        buildNumber: installedApkRev,
        revision: `r${installedApkRev}`,
        displayVersion: disp
      }, false);
    }
    return false;
  }

  // 2. НА САЙТЕ И В PWA: проверяем выход новой версии и необходимость обновления кэша
  const serverInfo = await fetchServerReleaseInfo();
  const prevRecord = _bootInitialInstalledRecord || getInstalledReleaseRecord();
  const targetRevKey = `${serverInfo.version}_r${extractBuildRevisionNumber(serverInfo) || APP_BUILD_NUMBER}`;
  const lastCacheSyncedKey = (typeof localStorage !== 'undefined') ? localStorage.getItem(WEB_CACHE_SYNCED_VER_KEY) : null;
  const dismissedRev = (typeof localStorage !== 'undefined') ? localStorage.getItem('klev_pro_dismissed_rev') : null;

  // Серверная версия выше запущенного в браузере JS ИЛИ пользователь перешёл со старой версии (напр. 2.5.6 -> 2.8.1) и кэш ещё не синхронизирован
  const isServerHigherThanRunningJs = compareReleaseVersions(serverInfo.version, serverInfo.buildNumber, APP_VERSION, APP_BUILD_NUMBER) > 0;
  const isUpgradedFromOlderCachedVersion = Boolean(
    prevRecord &&
    compareReleaseVersions(serverInfo.version, serverInfo.buildNumber, prevRecord.version, prevRecord.buildNumber || prevRecord.revision) > 0 &&
    lastCacheSyncedKey !== targetRevKey
  );

  if (!prevRecord && !isServerHigherThanRunningJs) {
    // Первый визит нового пользователя — фиксируем текущую версию без лишнего окна
    saveInstalledReleaseRecord(serverInfo);
    try { localStorage.setItem(WEB_CACHE_SYNCED_VER_KEY, targetRevKey); } catch (e) {}
    if (manual) {
      showReleaseUpdateModal(serverInfo, false);
    }
    return false;
  }

  if (isServerHigherThanRunningJs || isUpgradedFromOlderCachedVersion) {
    // Выполняем фоновую бережную очистку устаревших технических куки и погодного кэша
    safeCleanObsoleteCacheAndCookies().catch(() => {});
    pendingReleaseInfo = serverInfo;
    markHeaderUpdateAvailable(true, serverInfo);
    if (manual || (!updateBannerShown && dismissedRev !== targetRevKey)) {
      updateBannerShown = true;
      showReleaseUpdateModal(serverInfo, true);
    }
    return true;
  }

  saveInstalledReleaseRecord(serverInfo);
  markHeaderUpdateAvailable(false);
  if (manual) {
    showToast(`Установлена актуальная версия ${formatVersionWithRevision(serverInfo.version, serverInfo.revision)}`, 'good');
    showReleaseUpdateModal(serverInfo, false);
  }
  return false;
}

export function initReleaseUpdater() {
  // Сохраняем слепок предыдущей установленной версии ДО проверки, чтобы корректно определить переход (например, с 2.5.6 на 2.8.1)
  _bootInitialInstalledRecord = getInstalledReleaseRecord();

  // Если страница уже перезагружена с параметром ?rev=rNNN после нажатия «Обновить кэш», фиксируем успешное обновление кэша
  try {
    const searchStr = typeof window !== 'undefined' ? (window.location?.search || '') : '';
    const revMatch = searchStr.match(/[?&]rev=r?(\d+)/i);
    if (revMatch && revMatch[1]) {
      const urlRevNum = Math.max(APP_BUILD_NUMBER, parseInt(revMatch[1], 10) || APP_BUILD_NUMBER);
      const urlRevKey = `${APP_VERSION}_r${urlRevNum}`;
      saveInstalledReleaseRecord({ version: APP_VERSION, buildNumber: urlRevNum, revision: `r${urlRevNum}` });
      localStorage.setItem('klev_pro_dismissed_rev', urlRevKey);
      localStorage.setItem('klev_pro_dismissed_ver', urlRevKey);
      localStorage.setItem(WEB_CACHE_SYNCED_VER_KEY, urlRevKey);
      _bootInitialInstalledRecord = { version: APP_VERSION, buildNumber: urlRevNum, revision: `r${urlRevNum}` };
    }
  } catch (e) {}

  setTimeout(() => {
    syncAndroidSiteApkDownloadUI().catch(() => {});
  }, 900);
  setTimeout(() => {
    checkForReleaseUpdate({ manual: false }).catch(() => {});
  }, 7400);
}
