import { store } from './store.js?v=2.5.1';
/**
 * @file updater.js
 * @description Модуль контроля версий и внутренних ревизий (v2.5.0 r186),
 * загрузки Android APK с сайта и автоматической проверки обновлений внутри APK
 * с учётом как номера версии (X.Y.Z), так и внутреннего счётчика сборки (rNNN).
 */

import { APP_VERSION, APP_BUILD_NUMBER, APP_REVISION, APP_DISPLAY_VERSION, RELEASE_CACHE_KEY, CURRENT_RELEASE_INFO } from './config.js?v=2.5.1';
import { showToast } from '../ui/components.js?v=2.5.1';

export const PUBLIC_SITE_ORIGIN = 'https://klevpro.ru';
export const APK_MANIFEST_PATH = '/apk/apk-version.json';
export const DEFAULT_APK_DOWNLOAD_URL = 'https://klevpro.ru/apk/klev-pro-v2.5.1.apk';
export const APK_BANNER_DISMISSED_KEY = 'klev_pro_hide_apk_banner_v2.5.1_r188';

let pendingSwRegistration = null;
let pendingReleaseInfo = null;
let updateBannerShown = false;
let _cachedApkManifest = null;

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
    if (typeof document !== 'undefined' && document.documentElement.getAttribute('data-tg-webapp') === '1') return true;
    const twa = window.Telegram && window.Telegram.WebApp;
    if (twa && ((typeof twa.initData === 'string' && twa.initData.length > 0) || twa.initDataUnsafe?.user)) return true;
    const hash = window.location?.hash || '';
    const search = window.location?.search || '';
    if (hash.includes('tgWebAppData') || search.includes('tgWebAppStartParam')) return true;
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

/**
 * Извлекает числовой номер ревизии сборки (например, 186 из 'r186', '2026.10.30-r186', '2.5.0-r186' или 186)
 */
export function extractBuildRevisionNumber(rawRevOrObj) {
  if (typeof rawRevOrObj === 'number' && Number.isFinite(rawRevOrObj)) {
    return rawRevOrObj > 100000 ? (rawRevOrObj % 1000) : rawRevOrObj;
  }
  if (rawRevOrObj && typeof rawRevOrObj === 'object') {
    if (Number.isFinite(Number(rawRevOrObj.buildNumber))) return Number(rawRevOrObj.buildNumber);
    const str = String(rawRevOrObj.revision || rawRevOrObj.buildRevision || rawRevOrObj.version || '');
    const m = str.match(/r(\d+)/i);
    if (m && m[1]) return parseInt(m[1], 10);
    if (Number.isFinite(Number(rawRevOrObj.versionCode)) && Number(rawRevOrObj.versionCode) > 100000) {
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

export function getInstalledApkVersionString() {
  try {
    if (typeof window !== 'undefined' && window.AndroidBridge && typeof window.AndroidBridge.getAppVersion === 'function') {
      const v = String(window.AndroidBridge.getAppVersion() || '').trim();
      if (v) return v.replace(/-r\d+$/i, '');
    }
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
    const m = ua.match(/KlevProAPK\/([0-9]+\.[0-9]+\.[0-9]+)/i);
    if (m && m[1]) return m[1];
  } catch (e) {}
  return APP_VERSION;
}

export function getInstalledApkRevisionNumber() {
  try {
    if (typeof window !== 'undefined' && window.AndroidBridge && typeof window.AndroidBridge.getAppVersion === 'function') {
      const v = String(window.AndroidBridge.getAppVersion() || '').trim();
      const revFromBridge = extractBuildRevisionNumber(v);
      if (revFromBridge > 0) return revFromBridge;
    }
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
    const m = ua.match(/KlevProAPK\/[0-9.]+\-r(\d+)/i);
    if (m && m[1]) return parseInt(m[1], 10);
  } catch (e) {}
  return APP_BUILD_NUMBER;
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
 * Сравнивает два релиза с учётом И семантической версии (2.5.0), И внутреннего счётчика ревизии (r186).
 * Даже если версия одинаковая (2.5.0 == 2.5.0), но ревизия выросла (r187 > r186), возвращает 1!
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
    const revNum = extractBuildRevisionNumber(info) || APP_BUILD_NUMBER;
    localStorage.setItem(RELEASE_CACHE_KEY, JSON.stringify({
      version: info?.version || APP_VERSION,
      buildNumber: revNum,
      revision: `r${revNum}`,
      updatedAt: Date.now()
    }));
  } catch (e) {}
}

function normalizeReleaseChanges(info) {
  const rawList = (Array.isArray(info?.changes) && info.changes.length > 0)
    ? info.changes
    : ((Array.isArray(info?.changelog) && info.changelog.length > 0)
        ? info.changelog
        : ((Array.isArray(info?.items) && info.items.length > 0)
            ? info.items
            : (Array.isArray(CURRENT_RELEASE_INFO?.changes) ? CURRENT_RELEASE_INFO.changes : [])));

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
  // Поддержка ответа GitHub Contents API (где содержимое лежит в base64 в поле content)
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
 * Проверяет информационный файл /apk/apk-version.json (на сайте, через прямой GitHub API без кэша, в воркере и через резервный прокси без VPN)
 */
export async function fetchApkReleaseManifest() {
  const ts = Date.now();
  const inApk = isInsideAndroidApk();
  const ghApiUrl = `https://api.github.com/repos/thorantony82-create/klev-pro/contents/apk/apk-version.json?ref=main&_t=${ts}`;
  const siteManifestUrl = `${PUBLIC_SITE_ORIGIN}${APK_MANIFEST_PATH}?t=${ts}`;
  const candidateUrls = inApk
    ? [
        siteManifestUrl,
        ghApiUrl,
        `https://raw.githubusercontent.com/thorantony82-create/klev-pro/main/apk/apk-version.json?t=${ts}`,
        `https://klevprohbot.thorantony82.workers.dev/api/version?t=${ts}`,
        `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(siteManifestUrl)}`,
        `${PUBLIC_SITE_ORIGIN}/version.json?t=${ts}`
      ]
    : [
        `./apk/apk-version.json?t=${ts}`,
        `./version.json?t=${ts}`,
        siteManifestUrl,
        ghApiUrl
      ];

  let bestManifest = null;
  for (const url of candidateUrls) {
    try {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, 3800) : null;
      const res = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
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
            fileSize: data.apkSizeMb || data.fileSize || '38.2 МБ',
            changes: normalizeReleaseChanges(data)
          };
          if (!bestManifest || compareReleaseVersions(candidate.version, candidate.buildNumber, bestManifest.version, bestManifest.buildNumber) > 0) {
            bestManifest = candidate;
          }
          if (!inApk && compareReleaseVersions(candidate.version, candidate.buildNumber, CURRENT_RELEASE_INFO.version, APP_BUILD_NUMBER) >= 0) {
            break;
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
    fileSize: CURRENT_RELEASE_INFO.fileSize || '38.2 МБ',
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
    fileSize: CURRENT_RELEASE_INFO.fileSize || '38.2 МБ',
    changes: normalizeReleaseChanges(CURRENT_RELEASE_INFO)
  };
}

export async function triggerApkFileDownload(customManifest = null) {
  showToast(' Проверка актуальной ревизии APK...', 'info');
  const manifest = customManifest || (await fetchApkReleaseManifest());
  const ver = manifest?.version || APP_VERSION;
  const rev = manifest?.revision || APP_REVISION;
  const disp = formatVersionWithRevision(ver, rev);
  const targetUrl = `${manifest?.apkUrl || `${PUBLIC_SITE_ORIGIN}/apk/klev-pro-v${ver}.apk`}${manifest?.apkUrl?.includes('?') ? '&' : '?'}rev=${encodeURIComponent(rev)}_${Date.now()}`;

  if (isInsideAndroidApk()) {
    try {
      if (window.AndroidBridge && typeof window.AndroidBridge.downloadApkUpdate === 'function') {
        window.AndroidBridge.downloadApkUpdate(targetUrl);
        showToast(` Запущена загрузка обновления Клёв ПРО (${disp})`, 'good');
        return true;
      }
    } catch (e) {}
    try {
      window.open(targetUrl, '_blank', 'noopener');
      showToast(` Запущена загрузка обновления Клёв ПРО (${disp})`, 'good');
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
    showToast(` Загрузка «Клёв ПРО ${disp}.apk» началась! После скачивания откройте файл для установки.`, 'good');
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
          showToast('Кнопка загрузки APK всегда доступна в « Настройках»', 'info');
        });
      }
    }
  }
}

export async function fetchServerReleaseInfo() {
  if (isInsideAndroidApk()) {
    return await fetchApkReleaseManifest();
  }
  try {
    const res = await fetch(`./version.json?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' }
    });
    if (!res.ok) return CURRENT_RELEASE_INFO;
    const data = await res.json();
    if (data && data.version) {
      const revNum = extractBuildRevisionNumber(data) || APP_BUILD_NUMBER;
      return {
        ...CURRENT_RELEASE_INFO,
        ...data,
        buildNumber: revNum,
        revision: `r${revNum}`,
        displayVersion: formatVersionWithRevision(data.version, `r${revNum}`),
        changes: normalizeReleaseChanges(data)
      };
    }
  } catch (e) {}
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
  const hasNewerApk = inApk && compareReleaseVersions(info.version, info.revision || info.buildNumber, installedApkVer, installedApkRev) > 0;

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

  const headerTitle = (hasNewerApk || isPendingInstall)
    ? `Выпущена новая сборка «Клёв ПРО 2.0» (${remoteDisp})`
    : `Версия приложения «Клёв ПРО 2.0» (${remoteDisp})`;

  const subtitleText = hasNewerApk
    ? `У вас установлена сборка ${installedDisp} • Доступна новая сборка ${remoteDisp}`
    : (info.subtitle || 'Исправлены ошибки, устранены баги и ускорена работа сервисов.');

  modal.innerHTML = `
    <div class="modal-box modal-has-sticky-footer" role="dialog" aria-modal="true" aria-label="${headerTitle}" style="max-width:540px;border-color:var(--accent);">
      <div style="margin-bottom:8px;">
        <span class="pill ${hasNewerApk || isPendingInstall ? 'pill-good' : 'pill-neutral'}" style="margin-bottom:6px;">
          <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" fill="#f97316"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" fill="rgba(56,189,248,0.25)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> ${hasNewerApk ? `Доступно обновление APK (${remoteDisp})` : `Сборка ${remoteDisp}`}
        </span>
        <h3 style="font-size:var(--fs-lg);font-weight:800;color:var(--text);margin-top:4px;line-height:1.3;">
          ${headerTitle}
        </h3>
        <div style="font-size:var(--fs-xs);color:var(--muted);margin-top:3px;line-height:1.4;">
          ${subtitleText}
        </div>
      </div>

      <div style="font-weight:800;font-size:var(--fs-xs);color:var(--accent);margin-top:4px;">
        <svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> Что изменилось в сборке ${remoteDisp}:
      </div>

      <div style="max-height:46vh;overflow-y:auto;padding-right:2px;margin:8px 0;">
        ${changesHtml}
      </div>

      <div style="padding:9px 11px;background:rgba(16,185,129,0.10);border:1px solid rgba(16,185,129,0.30);border-radius:var(--r-sm);font-size:var(--fs-xs);color:var(--muted);margin-bottom:4px;">
        <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2.5l7 3.2v5.8c0 5-3 9.3-7 10.8-4-1.5-7-5.8-7-10.8V5.7l7-3.2z" fill="rgba(56,189,248,0.22)" stroke="#38bdf8" stroke-width="1.8" stroke-linejoin="round"/></svg> <b>Ваши данные сохраняются:</b> все ваши рыболовные точки, профиль, чаты, избранные виды рыб и журнал уловов остаются на месте при обновлении.
      </div>

      <div class="modal-sticky-footer" style="flex-wrap:wrap;">
        ${inApk ? `
          ${hasNewerApk ? `
            <button type="button" class="btn btn-good" id="relModalDownloadApkBtn" style="flex:2;min-width:190px;font-weight:800;">
              <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg> Загрузить обновление (${remoteDisp})
            </button>
            <button type="button" class="btn" id="relModalLaterBtn" style="flex:1;min-width:110px;">Позже</button>
          ` : `
            <button type="button" class="btn" id="relModalDownloadApkBtn" style="flex:1;min-width:150px;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg> Скачать APK (${remoteDisp}) заново</button>
            <button type="button" class="btn btn-accent" id="relModalOkBtn" style="flex:1;min-width:120px;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> Закрыть</button>
          `}
        ` : (isPendingInstall ? `
          <button type="button" class="btn btn-good" id="relModalConfirmBtn" style="flex:2;min-width:180px;"><svg class="k-ico" style="color:var(--good);" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" fill="rgba(16,185,129,0.24)" stroke="#10b981" stroke-width="1.9"/><path d="M8 12.5l2.7 2.7L16.5 9.5" stroke="#10b981" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg> Обновить до ${remoteDisp}</button>
          <button type="button" class="btn" id="relModalLaterBtn" style="flex:1;min-width:110px;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> Закрыть</button>
        ` : `
          <button type="button" class="btn" id="relModalForceSyncBtn" style="flex:1;min-width:140px;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M20 11a8 8 0 0 0-14.5-4.5L4 8m0-5v5h5M4 13a8 8 0 0 0 14.5 4.5L20 16m0 5v-5h-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Обновить кэш (${remoteDisp})</button>
          <button type="button" class="btn btn-accent" id="relModalOkBtn" style="flex:1;min-width:140px;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> Закрыть</button>
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
      btn.innerHTML = '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l3.5 2" stroke="#38bdf8" stroke-width="1.9" stroke-linecap="round"/></svg> Обновление...';
    }
    await applyFullReleaseUpdate(info);
  });

  modal.querySelector('#relModalForceSyncBtn')?.addEventListener('click', async () => {
    const btn = modal.querySelector('#relModalForceSyncBtn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l3.5 2" stroke="#38bdf8" stroke-width="1.9" stroke-linecap="round"/></svg> Перезагрузка...';
    }
    await applyFullReleaseUpdate(info);
  });
}

export async function applyFullReleaseUpdate(info = CURRENT_RELEASE_INFO) {
  saveInstalledReleaseRecord(info);

  try {
    if (pendingSwRegistration && pendingSwRegistration.waiting) {
      pendingSwRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
  } catch (e) {}

  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch (e) {}

  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.update().catch(() => {})));
    }
  } catch (e) {}

  const cleanPath = window.location.pathname || '/';
  const hash = window.location.hash || '#/forecast';
  window.location.replace(`${cleanPath}?v=${encodeURIComponent(info?.version || APP_VERSION)}&rev=${encodeURIComponent(info?.revision || APP_REVISION)}_${Date.now()}${hash}`);
}

export async function checkForReleaseUpdate({ manual = false } = {}) {
  const inApk = isInsideAndroidApk();

  if (inApk) {
    const apkManifest = await fetchApkReleaseManifest();
    const installedApkVer = getInstalledApkVersionString();
    const installedApkRev = getInstalledApkRevisionNumber();
    const isApkNewer = compareReleaseVersions(apkManifest.version, apkManifest.revision || apkManifest.buildNumber, installedApkVer, installedApkRev) > 0;
    const targetRevKey = `${apkManifest.version}_${apkManifest.revision || apkManifest.buildNumber}`;
    const dismissedVer = (typeof localStorage !== 'undefined') ? localStorage.getItem('klev_pro_dismissed_ver') : null;

    if (isApkNewer) {
      pendingReleaseInfo = apkManifest;
      markHeaderUpdateAvailable(true, apkManifest);
      if (manual || (!updateBannerShown && dismissedVer !== targetRevKey)) {
        updateBannerShown = true;
        showReleaseUpdateModal(apkManifest, true);
      }
      return true;
    }

    markHeaderUpdateAvailable(false);
    if (manual) {
      const disp = formatVersionWithRevision(installedApkVer, installedApkRev);
      showToast(` У вас установлена актуальная сборка приложения (${disp})`, 'good');
      showReleaseUpdateModal(apkManifest, false);
    }
    return false;
  }

  const serverInfo = await fetchServerReleaseInfo();
  const installed = getInstalledReleaseRecord();

  const isNewer = !installed ||
    compareReleaseVersions(serverInfo.version, serverInfo.revision || serverInfo.buildNumber, installed.version, installed.revision || installed.buildNumber) > 0;

  if (!installed) {
    saveInstalledReleaseRecord(serverInfo);
    if (manual) {
      showReleaseUpdateModal(serverInfo, false);
    }
    return false;
  }

  const targetRevKey = `${serverInfo.version}_${serverInfo.revision || serverInfo.buildNumber}`;
  const dismissedRev = (typeof localStorage !== 'undefined') ? localStorage.getItem('klev_pro_dismissed_rev') : null;
  const isDismissed = dismissedRev && dismissedRev === targetRevKey;

  if (isNewer) {
    pendingReleaseInfo = serverInfo;
    markHeaderUpdateAvailable(true, serverInfo);
    if (manual || (!isDismissed && !updateBannerShown)) {
      updateBannerShown = true;
      showReleaseUpdateModal(serverInfo, true);
    }
    return true;
  }

  markHeaderUpdateAvailable(false);
  if (manual) {
    showReleaseUpdateModal(serverInfo, false);
  }
  return false;
}

export function initReleaseUpdater() {
  const installed = getInstalledReleaseRecord();
  if (!installed) {
    saveInstalledReleaseRecord(CURRENT_RELEASE_INFO);
  } else if (installed.version !== APP_VERSION || extractBuildRevisionNumber(installed) !== APP_BUILD_NUMBER) {
    saveInstalledReleaseRecord(CURRENT_RELEASE_INFO);
  }

  setTimeout(() => {
    syncAndroidSiteApkDownloadUI().catch(() => {});
  }, 600);

  setTimeout(() => {
    checkForReleaseUpdate({ manual: false }).catch(() => {});
  }, 3200);
}
