/**
 * @file updater.js
 * @description Модуль контроля версий, ревизий и безопасного обновления кэша установленного приложения (PWA).
 * Не блокирует старт приложения, защищён от бесконечных циклов перезагрузки и поддерживает все форматы описания релизов.
 */

import { APP_VERSION, APP_REVISION, RELEASE_CACHE_KEY, CURRENT_RELEASE_INFO } from './config.js?v=2.0.165';
import { showToast } from '../ui/components.js?v=2.0.165';

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
 * Нормализует список изменений из version.json или CURRENT_RELEASE_INFO
 * (поддерживает как массив объектов {icon, title/module, text}, так и массив строк)
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
      return { icon: '🔹', title: 'Улучшение в релизе', text: item };
    }
    return {
      icon: item?.icon || '🔹',
      title: item?.title || item?.module || 'Обновление модуля',
      text: item?.text || ''
    };
  });
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
 * Открывает пользовательское окно с описанием новой версии/ревизии
 */
export function showReleaseUpdateModal(releaseInfo = CURRENT_RELEASE_INFO, isPendingInstall = false) {
  const info = releaseInfo || CURRENT_RELEASE_INFO;
  const changesList = normalizeReleaseChanges(info);

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

  const subtitleText = info.subtitle || info.summary || 'Актуальный выпуск с улучшениями для рыбаков.';

  modal.innerHTML = `
    <div class="modal-box" role="dialog" aria-modal="true" aria-label="${info.title || 'Обновление приложения'}" style="max-width:540px;border-color:var(--accent);">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:10px;">
        <div>
          <span class="pill pill-good" style="margin-bottom:6px;">🚀 Версия ${info.version || APP_VERSION} • Ревизия ${info.revision || APP_REVISION}</span>
          <h3 style="font-size:var(--fs-lg);font-weight:800;color:var(--text);margin-top:4px;">
            ${isPendingInstall ? 'Доступно обновление приложения' : (info.title || 'Что нового в этой версии')}
          </h3>
          <div style="font-size:var(--fs-xs);color:var(--muted);margin-top:3px;line-height:1.4;">
            ${subtitleText}
          </div>
        </div>
        <button type="button" class="btn btn-sm" id="relModalCloseBtn" aria-label="Закрыть">✕</button>
      </div>

      <div style="max-height:50vh;overflow-y:auto;padding-right:2px;margin:10px 0;">
        ${changesHtml}
      </div>

      <div style="padding:9px 11px;background:rgba(16,185,129,0.10);border:1px solid rgba(16,185,129,0.30);border-radius:var(--r-sm);font-size:var(--fs-xs);color:var(--muted);margin-bottom:12px;">
        🛡️ <b>Ваши данные в безопасности:</b> все сохранённые рыболовные точки, избранные виды рыб и записи в журнале уловов полностью сохраняются на устройстве.
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${isPendingInstall ? `
          <button type="button" class="btn" id="relModalLaterBtn" style="flex:1;">Позже</button>
          <button type="button" class="btn btn-good" id="relModalConfirmBtn" style="flex:2;">✅ Обновить приложение и кэш</button>
        ` : `
          <button type="button" class="btn" id="relModalForceSyncBtn" style="flex:1;">🔄 Перезагрузить кэш</button>
          <button type="button" class="btn btn-accent" id="relModalOkBtn" style="flex:1;">Отлично, к рыбалке!</button>
        `}
      </div>
    </div>
  `;

  modal.classList.add('open');

  const closeLater = () => {
    modal.classList.remove('open');
  };

  modal.onclick = (e) => {
    if (e.target === modal) closeLater();
  };

  modal.querySelector('#relModalCloseBtn')?.addEventListener('click', closeLater);
  modal.querySelector('#relModalLaterBtn')?.addEventListener('click', () => {
    saveInstalledReleaseRecord(info);
    closeLater();
    showToast('Вы можете открыть описание релиза и обновить кэш в любой момент кнопкой 📦 в шапке.', 'info');
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
 * Полное обновление кэша программы и активация новой ревизии с защитой от зацикливания
 */
export async function applyFullReleaseUpdate(releaseInfo = CURRENT_RELEASE_INFO) {
  const targetVer = releaseInfo?.version || APP_VERSION;
  const targetRev = releaseInfo?.revision || APP_REVISION;
  saveInstalledReleaseRecord({ version: targetVer, revision: targetRev });
  try {
    sessionStorage.setItem('klev_just_updated_rev', `${targetVer}_${targetRev}`);
  } catch (e) {}

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
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
  } catch (e) {}

  setTimeout(() => {
    const cleanUrl = window.location.pathname + '?v=' + encodeURIComponent(targetVer) + '&updated=' + Date.now() + (window.location.hash || '');
    window.location.replace(cleanUrl);
  }, 200);
}

/**
 * Проверяет наличие новой версии/ревизии на сервере без ложных срабатываний
 */
export async function checkForReleaseUpdate({ manual = false } = {}) {
  const serverInfo = await fetchServerReleaseInfo();
  pendingReleaseInfo = serverInfo;

  // Защита от повторного показа окна сразу после перезагрузки
  let justUpdated = false;
  try {
    const marker = sessionStorage.getItem('klev_just_updated_rev');
    if (marker === `${serverInfo.version}_${serverInfo.revision}`) {
      justUpdated = true;
    }
  } catch (e) {}

  // Если загруженный код в браузере уже совпадает с версией на сервере — фиксируем в localStorage и не тревожим пользователя
  const isCodeUpToDate =
    serverInfo.version === APP_VERSION &&
    (!serverInfo.revision || serverInfo.revision === APP_REVISION);

  if (isCodeUpToDate || justUpdated) {
    saveInstalledReleaseRecord(serverInfo);
    markHeaderUpdateAvailable(false);
    if (manual) {
      showReleaseUpdateModal(serverInfo, false);
    }
    return false;
  }

  // Если на сервере появилась более свежая версия, чем текущий загруженный APP_VERSION
  markHeaderUpdateAvailable(true, serverInfo);
  if (!updateBannerShown || manual) {
    updateBannerShown = true;
    showReleaseUpdateModal(serverInfo, true);
  }
  return true;
}

/**
 * Инициализирует отслеживание обновлений Service Worker и ревизий приложения
 */
export function initReleaseUpdater() {
  // Сразу сохраняем текущую работающую ревизию, если она ещё не была записана
  const installed = getInstalledReleaseRecord();
  if (!installed || installed.version !== APP_VERSION || installed.revision !== APP_REVISION) {
    saveInstalledReleaseRecord(CURRENT_RELEASE_INFO);
  }

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register(`./sw.js?v=${APP_VERSION}`, { updateViaCache: 'none' }).then((reg) => {
      pendingSwRegistration = reg;
    }).catch((err) => {
      console.warn('[Updater] SW registration skipped:', err.message);
    });
  }

  // Фоновая тихая сверка с version.json через 2.5 сек после старта
  setTimeout(() => {
    checkForReleaseUpdate({ manual: false });
  }, 2500);
}
