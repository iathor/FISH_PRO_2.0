/**
 * @file updater.js
 * @description Модуль контроля версий, ревизий и обновления кэша установленного приложения (PWA)
 * Запрашивает у пользователя разрешение на обновление и выводит понятное описание изменений.
 */

import { APP_VERSION, APP_REVISION, RELEASE_CACHE_KEY, CURRENT_RELEASE_INFO } from './config.js';
import { showToast } from '../ui/components.js';

let pendingSwRegistration = null;
let pendingReleaseInfo = null;
let updateBannerShown = false;

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
 * Загружает свежий манифест релиза version.json с сервера в обход всех кэшей
 */
export async function fetchServerReleaseInfo() {
  try {
    const res = await fetch(`./version.json?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' }
    });
    if (!res.ok) return CURRENT_RELEASE_INFO;
    const data = await res.json();
    if (data && data.version && Array.isArray(data.changes)) {
      return data;
    }
  } catch (e) {}
  return CURRENT_RELEASE_INFO;
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
 * Открывает пользовательское окно с описанием новой версии/ревизии и запросом разрешения на обновление
 */
export function showReleaseUpdateModal(releaseInfo = CURRENT_RELEASE_INFO, isPendingInstall = true) {
  const info = releaseInfo || CURRENT_RELEASE_INFO;
  let modal = document.getElementById('releaseUpdateModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'releaseUpdateModal';
    modal.className = 'modal-backdrop';
    modal.style.zIndex = '9995';
    document.body.appendChild(modal);
  }

  const changesHtml = (info.changes || []).map(item => `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r-sm);padding:10px 12px;margin-bottom:8px;">
      <div style="font-weight:800;font-size:var(--fs-sm);color:var(--accent);margin-bottom:4px;">
        ${item.icon || '🔹'} ${item.title}
      </div>
      <div style="font-size:var(--fs-xs);color:var(--text);line-height:1.48;">
        ${item.text}
      </div>
    </div>
  `).join('');

  modal.innerHTML = `
    <div class="modal-box" role="dialog" aria-modal="true" aria-label="${info.title || 'Обновление приложения'}" style="max-width:500px;border-color:var(--accent);">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:10px;">
        <div>
          <span class="pill pill-good" style="margin-bottom:6px;">🚀 Версия ${info.version} • Ревизия ${info.revision || APP_REVISION}</span>
          <h3 style="font-size:var(--fs-lg);font-weight:800;color:var(--text);margin-top:4px;">
            ${isPendingInstall ? 'Доступно обновление приложения' : (info.title || 'Что нового в этой версии')}
          </h3>
          <div style="font-size:var(--fs-xs);color:var(--muted);margin-top:2px;">
            ${info.subtitle || 'Актуальный выпуск с улучшениями для рыбаков.'}
          </div>
        </div>
        <button type="button" class="btn btn-sm" id="relModalCloseBtn" aria-label="Закрыть">✕</button>
      </div>

      <div style="max-height:52vh;overflow-y:auto;padding-right:2px;margin:10px 0;">
        ${changesHtml}
      </div>

      <div style="padding:8px 10px;background:rgba(16,185,129,0.10);border:1px solid rgba(16,185,129,0.30);border-radius:var(--r-sm);font-size:11px;color:var(--muted);margin-bottom:12px;">
        🛡️ <b>Ваши данные в безопасности:</b> все сохранённые рыболовные точки, избранные виды рыб и записи в журнале уловов полностью сохранятся на телефоне.
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${isPendingInstall ? `
          <button type="button" class="btn" id="relModalLaterBtn" style="flex:1;">Отложить</button>
          <button type="button" class="btn btn-good" id="relModalConfirmBtn" style="flex:2;">✅ Обновить приложение и кэш</button>
        ` : `
          <button type="button" class="btn" id="relModalForceSyncBtn" style="flex:1;">🔄 Обновить кэш файлов</button>
          <button type="button" class="btn btn-accent" id="relModalOkBtn" style="flex:1;">Понятно</button>
        `}
      </div>
    </div>
  `;

  modal.classList.add('open');

  const closeLater = () => {
    modal.classList.remove('open');
  };

  modal.querySelector('#relModalCloseBtn')?.addEventListener('click', closeLater);
  modal.querySelector('#relModalLaterBtn')?.addEventListener('click', () => {
    closeLater();
    showToast('Обновление отложено. Нажмите 🔄 в шапке, когда будете готовы обновить.', 'info');
  });
  modal.querySelector('#relModalOkBtn')?.addEventListener('click', () => {
    saveInstalledReleaseRecord(info);
    closeLater();
  });

  modal.querySelector('#relModalConfirmBtn')?.addEventListener('click', async () => {
    const btn = modal.querySelector('#relModalConfirmBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Обновление модулей и кэша...';
    }
    await applyFullReleaseUpdate(info);
  });

  modal.querySelector('#relModalForceSyncBtn')?.addEventListener('click', async () => {
    const btn = modal.querySelector('#relModalForceSyncBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Очистка кэша и перезагрузка...';
    }
    await applyFullReleaseUpdate(info);
  });
}

/**
 * Полное обновление кэша программы и активация новой ревизии с согласия пользователя
 */
export async function applyFullReleaseUpdate(releaseInfo = CURRENT_RELEASE_INFO) {
  saveInstalledReleaseRecord(releaseInfo || CURRENT_RELEASE_INFO);
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch (e) {}

  try {
    if (pendingSwRegistration && pendingSwRegistration.waiting) {
      pendingSwRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
    } else if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        await reg.update().catch(() => {});
      }
    }
  } catch (e) {}

  setTimeout(() => {
    const cleanUrl = window.location.pathname + '?v=' + encodeURIComponent(releaseInfo?.version || APP_VERSION) + '&r=' + Date.now() + (window.location.hash || '');
    window.location.replace(cleanUrl);
  }, 250);
}

/**
 * Проверяет наличие новой версии/ревизии на сервере и в Service Worker
 */
export async function checkForReleaseUpdate({ manual = false } = {}) {
  const installed = getInstalledReleaseRecord();
  const serverInfo = await fetchServerReleaseInfo();
  pendingReleaseInfo = serverInfo;

  let swWaiting = Boolean(pendingSwRegistration && pendingSwRegistration.waiting);
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        pendingSwRegistration = reg;
        await reg.update().catch(() => {});
        if (reg.waiting) swWaiting = true;
      }
    } catch (e) {}
  }

  const isNewServerVersion =
    serverInfo.version !== APP_VERSION ||
    serverInfo.revision !== APP_REVISION ||
    (installed && (installed.version !== serverInfo.version || installed.revision !== serverInfo.revision));

  if (swWaiting || isNewServerVersion) {
    markHeaderUpdateAvailable(true, serverInfo);
    if (!updateBannerShown || manual) {
      updateBannerShown = true;
      showReleaseUpdateModal(serverInfo, true);
    }
    return true;
  }

  // Если пользователь впервые запустил только что установленную/обновлённую версию
  if (!installed) {
    saveInstalledReleaseRecord(CURRENT_RELEASE_INFO);
  }

  if (manual) {
    showReleaseUpdateModal(serverInfo, false);
  }
  return false;
}

/**
 * Инициализирует отслеживание обновлений Service Worker и ревизий приложения
 */
export function initReleaseUpdater() {
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((reg) => {
      pendingSwRegistration = reg;

      if (reg.waiting) {
        fetchServerReleaseInfo().then((info) => {
          markHeaderUpdateAvailable(true, info);
          showReleaseUpdateModal(info, true);
        });
      }

      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            fetchServerReleaseInfo().then((info) => {
              pendingReleaseInfo = info;
              markHeaderUpdateAvailable(true, info);
              showReleaseUpdateModal(info, true);
            });
          }
        });
      });
    }).catch((err) => {
      console.warn('[Updater] SW registration skipped:', err.message);
    });

    // Проверяем обновление при возврате пользователя в развёрнутое приложение
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        checkForReleaseUpdate({ manual: false });
      }
    });
  }

  // Фоновая проверка ревизии через 1.5 сек после старта
  setTimeout(() => {
    checkForReleaseUpdate({ manual: false });
  }, 1500);
}
