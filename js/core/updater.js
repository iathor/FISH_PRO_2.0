/**
 * @file updater.js
 * @description Модуль контроля версий, загрузки Android APK с сайта (строго только на сайте и только для Android)
 * и внутреннего протокола проверки обновлений внутри Android APK через каталог /apk/apk-version.json (Релиз 2.2.0).
 */

import { APP_VERSION, APP_REVISION, RELEASE_CACHE_KEY, CURRENT_RELEASE_INFO } from './config.js?v=2.2.0';
import { showToast } from '../ui/components.js?v=2.2.0';

export const PUBLIC_SITE_ORIGIN = 'https://klevpro.ru';
export const APK_MANIFEST_PATH = '/apk/apk-version.json';
export const DEFAULT_APK_DOWNLOAD_URL = 'https://klevpro.ru/apk/klev-pro-v2.2.0.apk';
export const APK_BANNER_DISMISSED_KEY = 'klev_pro_hide_apk_banner_v2.2.0';

let pendingSwRegistration = null;
let pendingReleaseInfo = null;
let updateBannerShown = false;
let _cachedApkManifest = null;

/**
 * Определяет, запущено ли приложение внутри нативного контейнера Android APK
 */
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

/**
 * Определяет, открыт ли сайт внутри Telegram Mini App
 */
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

/**
 * Строгая проверка для показа ссылки на скачивание APK:
 * ТОЛЬКО на сайте (не внутри APK и не в Telegram Mini App) и ТОЛЬКО для Android-устройств (не на iOS и не на ПК).
 */
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
 * Возвращает текущую версию, зашитую в установленный APK (или APP_VERSION)
 */
export function getInstalledApkVersionString() {
  try {
    if (typeof window !== 'undefined' && window.AndroidBridge && typeof window.AndroidBridge.getAppVersion === 'function') {
      const v = String(window.AndroidBridge.getAppVersion() || '').trim();
      if (v) return v;
    }
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
    const m = ua.match(/KlevProAPK\/([0-9]+\.[0-9]+\.[0-9]+)/i);
    if (m && m[1]) return m[1];
  } catch (e) {}
  return APP_VERSION;
}

/**
 * Сравнивает две версии формата X.Y.Z (возвращает 1 если vA > vB, -1 если vA < vB, 0 если равны)
 */
export function compareSemverStrings(vA = '', vB = '') {
  const cleanA = String(vA || '').replace(/[^0-9.]/g, '').split('.').map(n => parseInt(n, 10) || 0);
  const cleanB = String(vB || '').replace(/[^0-9.]/g, '').split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(cleanA.length, cleanB.length, 3);
  for (let i = 0; i < len; i++) {
    const a = cleanA[i] || 0;
    const b = cleanB[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
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
    localStorage.setItem(RELEASE_CACHE_KEY, JSON.stringify({
      version: info?.version || APP_VERSION,
      revision: info?.revision || APP_REVISION,
      updatedAt: Date.now()
    }));
  } catch (e) {}
}

/**
 * Нормализует список изменений (оставляет только понятные пользователю информационные сообщения без технических деталей кода)
 */
function normalizeReleaseChanges(info) {
  const rawList = Array.isArray(info?.changes)
    ? info.changes
    : (Array.isArray(info?.items) ? info.items : (Array.isArray(CURRENT_RELEASE_INFO?.changes) ? CURRENT_RELEASE_INFO.changes : []));

  return rawList.map((item) => {
    if (typeof item === 'string') {
      const parts = item.split(':');
      if (parts.length > 1 && parts[0].length < 65) {
        return {
          icon: '🔹',
          title: parts[0].trim(),
          text: parts.slice(1).join(':').trim()
        };
      }
      return { icon: '🔹', title: 'Улучшение в приложении', text: item };
    }
    return {
      icon: item?.icon || '🔹',
      title: item?.title || 'Улучшение в приложении',
      text: item?.text || 'Исправлены ошибки, устранены баги, ускорена работа сервисов.'
    };
  });
}

/**
 * Быстро проверяет информационный файл /apk/apk-version.json (на сайте или из репозитория klevpro.ru для APK)
 */
export async function fetchApkReleaseManifest() {
  const ts = Date.now();
  const inApk = isInsideAndroidApk();
  const candidateUrls = inApk
    ? [
        `${PUBLIC_SITE_ORIGIN}${APK_MANIFEST_PATH}?t=${ts}`,
        `${PUBLIC_SITE_ORIGIN}/version.json?t=${ts}`
      ]
    : [
        `./apk/apk-version.json?t=${ts}`,
        `${PUBLIC_SITE_ORIGIN}${APK_MANIFEST_PATH}?t=${ts}`,
        `./version.json?t=${ts}`
      ];

  for (const url of candidateUrls) {
    try {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, 4500) : null;
      const res = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        signal: ctrl ? ctrl.signal : undefined
      });
      if (timer) clearTimeout(timer);
      if (res && res.ok) {
        const data = await res.json();
        if (data && data.version) {
          const ver = String(data.version).trim();
          const resolvedApkUrl = data.apkUrl || `${PUBLIC_SITE_ORIGIN}/apk/klev-pro-v${ver}.apk`;
          _cachedApkManifest = {
            ...CURRENT_RELEASE_INFO,
            ...data,
            version: ver,
            apkUrl: resolvedApkUrl,
            fileSize: data.fileSize || '7.9 МБ',
            changes: normalizeReleaseChanges(data)
          };
          return _cachedApkManifest;
        }
      }
    } catch (e) {}
  }

  _cachedApkManifest = {
    ...CURRENT_RELEASE_INFO,
    apkUrl: CURRENT_RELEASE_INFO.apkUrl || DEFAULT_APK_DOWNLOAD_URL,
    fileSize: CURRENT_RELEASE_INFO.fileSize || '7.9 МБ',
    changes: normalizeReleaseChanges(CURRENT_RELEASE_INFO)
  };
  return _cachedApkManifest;
}

export function getCachedApkManifest() {
  return _cachedApkManifest || {
    ...CURRENT_RELEASE_INFO,
    apkUrl: CURRENT_RELEASE_INFO.apkUrl || DEFAULT_APK_DOWNLOAD_URL,
    fileSize: CURRENT_RELEASE_INFO.fileSize || '7.9 МБ',
    changes: normalizeReleaseChanges(CURRENT_RELEASE_INFO)
  };
}

/**
 * Запускает скачивание файла APK (на сайте для Android или обновление по запросу внутри самого APK)
 */
export async function triggerApkFileDownload(customManifest = null) {
  showToast('⏳ Проверка актуальной версии APK...', 'info');
  const manifest = customManifest || (await fetchApkReleaseManifest());
  const ver = manifest?.version || APP_VERSION;
  const targetUrl = manifest?.apkUrl || `${PUBLIC_SITE_ORIGIN}/apk/klev-pro-v${ver}.apk`;

  // 1. Если вызвано внутри установленного Android APK — передаём ссылку нативному загрузчику Android
  if (isInsideAndroidApk()) {
    try {
      if (window.AndroidBridge && typeof window.AndroidBridge.downloadApkUpdate === 'function') {
        window.AndroidBridge.downloadApkUpdate(targetUrl);
        showToast(`📥 Запущена загрузка обновления Клёв ПРО v${ver} (.APK)`, 'good');
        return true;
      }
    } catch (e) {}
    try {
      window.open(targetUrl, '_blank', 'noopener');
      showToast(`📥 Запущена загрузка обновления Клёв ПРО v${ver}`, 'good');
      return true;
    } catch (e) {}
  }

  // 2. Если вызвано на сайте на Android-смартфоне — скачиваем файл напрямую из каталога /apk/
  try {
    const a = document.createElement('a');
    a.href = targetUrl;
    a.setAttribute('download', `klev-pro-v${ver}.apk`);
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast(`📲 Загрузка «Клёв ПРО v${ver}.apk» началась! После скачивания откройте файл для установки.`, 'good');
    return true;
  } catch (e) {
    window.location.href = targetUrl;
    return true;
  }
}

/**
 * Управляет отображением плашки загрузки APK на сайте и пункта в меню «⋮ Ещё»
 * (Отображается СТРОГО только на сайте и СТРОГО только для Android-устройств)
 */
export async function syncAndroidSiteApkDownloadUI() {
  if (typeof document === 'undefined') return;
  const bannerEl = document.getElementById('androidApkSiteBanner');
  const moreMenuItem = document.getElementById('navMoreDownloadApkItem');
  const moreMenuText = document.getElementById('navMoreDownloadApkText');

  if (!isAndroidWebsiteVisitor()) {
    if (bannerEl) bannerEl.style.display = 'none';
    if (moreMenuItem) moreMenuItem.style.display = 'none';
    return;
  }

  const manifest = await fetchApkReleaseManifest();
  const ver = manifest?.version || APP_VERSION;
  const sizeStr = manifest?.fileSize ? ` • ${manifest.fileSize}` : '';

  if (moreMenuItem) {
    moreMenuItem.style.display = 'flex';
    if (moreMenuText) {
      moreMenuText.textContent = `Скачать Android APK (v${ver})`;
    }
    if (!moreMenuItem._apkBound) {
      moreMenuItem._apkBound = true;
      moreMenuItem.addEventListener('click', (e) => {
        e.stopPropagation();
        const morePopup = document.getElementById('navMorePopup');
        if (morePopup) morePopup.classList.remove('open');
        triggerApkFileDownload(manifest);
      });
    }
  }

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
        titleEl.textContent = `📲 Приложение «Клёв ПРО 2.0» для Android (v${ver}${sizeStr})`;
      }
      if (dlBtn) {
        dlBtn.textContent = `📥 Скачать APK (v${ver})`;
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
          showToast('Кнопка загрузки APK всегда доступна в меню «⋮ Ещё» и в «⚙️ Настройках приложения»', 'info');
        });
      }
    }
  }
}

/**
 * Загружает свежий манифест релиза version.json с сервера в обход всех кэшей
 */
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
      return {
        ...CURRENT_RELEASE_INFO,
        ...data,
        changes: normalizeReleaseChanges(data)
      };
    }
  } catch (e) {}
  return {
    ...CURRENT_RELEASE_INFO,
    changes: normalizeReleaseChanges(CURRENT_RELEASE_INFO)
  };
}

/**
 * Показывает индикатор доступного обновления на кнопке в шапке
 */
function markHeaderUpdateAvailable(hasUpdate, releaseInfo = null) {
  const btn = document.getElementById('headerRefreshBtn');
  if (!btn) return;
  if (hasUpdate) {
    btn.style.borderColor = 'var(--good)';
    btn.style.boxShadow = '0 0 0 2px rgba(16, 185, 129, 0.35)';
    btn.title = `Доступно обновление ${releaseInfo?.version || ''} — нажмите для просмотра`;
    btn.setAttribute('data-has-update', '1');
  } else {
    btn.style.borderColor = '';
    btn.style.boxShadow = '';
    btn.removeAttribute('data-has-update');
  }
}

/**
 * Открывает пользовательское окно с описанием новой версии:
 * - Внутри Android APK при выходе новой версии предлагает скачать и установить новый APK по запросу.
 * - В браузере / PWA обновляет кэш или показывает список пользовательских улучшений.
 */
export function showReleaseUpdateModal(releaseInfo = CURRENT_RELEASE_INFO, isPendingInstall = false) {
  const info = releaseInfo || CURRENT_RELEASE_INFO;
  const changesList = normalizeReleaseChanges(info);
  const inApk = isInsideAndroidApk();
  const installedApkVer = getInstalledApkVersionString();
  const hasNewerApk = inApk && compareSemverStrings(info.version, installedApkVer) > 0;

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
    ? `Выпущена новая версия приложения «Клёв ПРО 2.0» (v${info.version || APP_VERSION})`
    : `Версия приложения «Клёв ПРО 2.0» (v${info.version || APP_VERSION})`;

  const subtitleText = hasNewerApk
    ? `У вас установлена версия v${installedApkVer} • Доступна для загрузки версия v${info.version}`
    : (info.subtitle || 'Исправлены ошибки, устранены баги и ускорена работа сервисов.');

  modal.innerHTML = `
    <div class="modal-box modal-has-sticky-footer" role="dialog" aria-modal="true" aria-label="${headerTitle}" style="max-width:540px;border-color:var(--accent);">
      <div style="margin-bottom:8px;">
        <span class="pill ${hasNewerApk || isPendingInstall ? 'pill-good' : 'pill-neutral'}" style="margin-bottom:6px;">
          🚀 ${hasNewerApk ? `Доступно обновление APK v${info.version}` : `Версия ${info.version || APP_VERSION}`}
        </span>
        <h3 style="font-size:var(--fs-lg);font-weight:800;color:var(--text);margin-top:4px;line-height:1.3;">
          ${headerTitle}
        </h3>
        <div style="font-size:var(--fs-xs);color:var(--muted);margin-top:3px;line-height:1.4;">
          ${subtitleText}
        </div>
      </div>

      <div style="font-weight:800;font-size:var(--fs-xs);color:var(--accent);margin-top:4px;">
        📋 Что изменилось в версии:
      </div>

      <div style="max-height:46vh;overflow-y:auto;padding-right:2px;margin:8px 0;">
        ${changesHtml}
      </div>

      <div style="padding:9px 11px;background:rgba(16,185,129,0.10);border:1px solid rgba(16,185,129,0.30);border-radius:var(--r-sm);font-size:var(--fs-xs);color:var(--muted);margin-bottom:4px;">
        🛡️ <b>Ваши данные сохраняются:</b> все ваши рыболовные точки, профиль, чаты, избранные виды рыб и журнал уловов остаются на месте при обновлении.
      </div>

      <div class="modal-sticky-footer" style="flex-wrap:wrap;">
        ${inApk ? `
          ${hasNewerApk ? `
            <button type="button" class="btn btn-good" id="relModalDownloadApkBtn" style="flex:2;min-width:190px;font-weight:800;">
              📥 Загрузить новую версию (v${info.version})
            </button>
            <button type="button" class="btn" id="relModalLaterBtn" style="flex:1;min-width:110px;">Позже</button>
          ` : `
            <button type="button" class="btn" id="relModalDownloadApkBtn" style="flex:1;min-width:150px;">📥 Скачать APK заново</button>
            <button type="button" class="btn btn-accent" id="relModalOkBtn" style="flex:1;min-width:120px;">✕ Закрыть</button>
          `}
        ` : (isPendingInstall ? `
          <button type="button" class="btn btn-good" id="relModalConfirmBtn" style="flex:2;min-width:180px;">✅ Обновить приложение</button>
          <button type="button" class="btn" id="relModalLaterBtn" style="flex:1;min-width:110px;">✕ Закрыть</button>
        ` : `
          <button type="button" class="btn" id="relModalForceSyncBtn" style="flex:1;min-width:140px;">🔄 Обновить кэш</button>
          <button type="button" class="btn btn-accent" id="relModalOkBtn" style="flex:1;min-width:140px;">✕ Закрыть</button>
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
    try { localStorage.setItem('klev_pro_dismissed_rev', info?.revision || APP_REVISION); } catch (e) {}
    try { localStorage.setItem('klev_pro_dismissed_ver', info?.version || APP_VERSION); } catch (e) {}
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
      btn.textContent = '⏳ Обновление...';
    }
    await applyFullReleaseUpdate(info);
  });

  modal.querySelector('#relModalForceSyncBtn')?.addEventListener('click', async () => {
    const btn = modal.querySelector('#relModalForceSyncBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Перезагрузка...';
    }
    await applyFullReleaseUpdate(info);
  });
}

/**
 * Полное обновление кэша программы и активация новой ревизии с защитой от зацикливания
 */
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
  window.location.replace(`${cleanPath}?v=${encodeURIComponent(info?.version || APP_VERSION)}&rev=${Date.now()}${hash}`);
}

/**
 * Проверка наличия новой версии:
 * - Внутри Android APK проверяет /apk/apk-version.json на klevpro.ru и при наличии более новой версии предлагает скачать её по запросу.
 * - На сайте / в PWA проверяет version.json.
 */
export async function checkForReleaseUpdate({ manual = false } = {}) {
  const inApk = isInsideAndroidApk();

  if (inApk) {
    const apkManifest = await fetchApkReleaseManifest();
    const installedApkVer = getInstalledApkVersionString();
    const isApkNewer = compareSemverStrings(apkManifest.version, installedApkVer) > 0;
    const dismissedVer = (typeof localStorage !== 'undefined') ? localStorage.getItem('klev_pro_dismissed_ver') : null;

    if (isApkNewer) {
      pendingReleaseInfo = apkManifest;
      markHeaderUpdateAvailable(true, apkManifest);
      if (manual || (!updateBannerShown && dismissedVer !== apkManifest.version)) {
        updateBannerShown = true;
        showReleaseUpdateModal(apkManifest, true);
      }
      return true;
    }

    markHeaderUpdateAvailable(false);
    if (manual) {
      showToast(`✅ У вас установлена актуальная версия приложения (v${installedApkVer})`, 'good');
      showReleaseUpdateModal(apkManifest, false);
    }
    return false;
  }

  const serverInfo = await fetchServerReleaseInfo();
  const installed = getInstalledReleaseRecord();

  const isNewer = !installed ||
    compareSemverStrings(serverInfo.version, installed.version) > 0 ||
    installed.revision !== serverInfo.revision;

  if (!installed) {
    saveInstalledReleaseRecord(serverInfo);
    if (manual) {
      showReleaseUpdateModal(serverInfo, false);
    }
    return false;
  }

  const dismissedRev = (typeof localStorage !== 'undefined') ? localStorage.getItem('klev_pro_dismissed_rev') : null;
  const isDismissed = dismissedRev && dismissedRev === serverInfo.revision;

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

/**
 * Инициализация фонового отслеживания релизов и плашки скачивания APK для Android-посетителей сайта
 */
export function initReleaseUpdater() {
  const installed = getInstalledReleaseRecord();
  if (!installed) {
    saveInstalledReleaseRecord(CURRENT_RELEASE_INFO);
  } else if (installed.version !== APP_VERSION || installed.revision !== APP_REVISION) {
    saveInstalledReleaseRecord(CURRENT_RELEASE_INFO);
  }

  // Синхронизируем кнопку и плашку загрузки APK на сайте (только для Android-браузеров)
  setTimeout(() => {
    syncAndroidSiteApkDownloadUI().catch(() => {});
  }, 600);

  // Проверяем выход новой версии (внутри APK или на сайте)
  setTimeout(() => {
    checkForReleaseUpdate({ manual: false }).catch(() => {});
  }, 3200);
}
