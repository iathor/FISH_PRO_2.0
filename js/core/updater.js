import { APP_VERSION, APP_REVISION, RELEASE_CACHE_KEY, CURRENT_RELEASE_INFO } from './config.js?v=2.1.1';
import { showToast } from '../ui/components.js?v=2.1.1';
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
    <div class="modal-box modal-has-sticky-footer" role="dialog" aria-modal="true" aria-label="${info.title || 'Обновление приложения'}" style="max-width:540px;border-color:var(--accent);">
      <div style="margin-bottom:10px;">
        <span class="pill pill-good" style="margin-bottom:6px;">🚀 Версия ${info.version || APP_VERSION} • Ревизия ${info.revision || APP_REVISION}</span>
        <h3 style="font-size:var(--fs-lg);font-weight:800;color:var(--text);margin-top:4px;">
          ${isPendingInstall ? 'Доступно обновление приложения' : (info.title || 'Что нового в этой версии')}
        </h3>
        <div style="font-size:var(--fs-xs);color:var(--muted);margin-top:3px;line-height:1.4;">
          ${subtitleText}
        </div>
      </div>

      <div style="max-height:48vh;overflow-y:auto;padding-right:2px;margin:10px 0;">
        ${changesHtml}
      </div>

      <div style="padding:9px 11px;background:rgba(16,185,129,0.10);border:1px solid rgba(16,185,129,0.30);border-radius:var(--r-sm);font-size:var(--fs-xs);color:var(--muted);margin-bottom:4px;">
        🛡️ <b>Ваши данные в безопасности:</b> все сохранённые рыболовные точки, избранные виды рыб и записи в журнале уловов полностью сохраняются на устройстве.
      </div>

      <div class="modal-sticky-footer" style="flex-wrap:wrap;">
        ${isPendingInstall ? `
          <button type="button" class="btn btn-good" id="relModalConfirmBtn" style="flex:2;min-width:180px;">✅ Обновить приложение и кэш</button>
          <button type="button" class="btn" id="relModalLaterBtn" style="flex:1;min-width:110px;">✕ Закрыть</button>
        ` : `
          <button type="button" class="btn" id="relModalForceSyncBtn" style="flex:1;min-width:140px;">🔄 Обновить кэш</button>
          <button type="button" class="btn btn-accent" id="relModalOkBtn" style="flex:1;min-width:140px;">✕ Закрыть</button>
        `}
      </div>
    </div>
  `;
modal.classList.add('open');
if (typeof window !== 'undefined' && typeof window.__KLEV_PUSH_BACK_GUARD__ === 'function') {
window.__KLEV_PUSH_BACK_GUARD__('releaseModal');
}
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
export async function checkForReleaseUpdate({ manual = false } = {}) {
const serverInfo = await fetchServerReleaseInfo();
const installed = getInstalledReleaseRecord();
const isNewer = !installed ||
installed.version !== serverInfo.version ||
installed.revision !== serverInfo.revision;
if (!installed) {
saveInstalledReleaseRecord(serverInfo);
if (manual) {
showReleaseUpdateModal(serverInfo, false);
}
return false;
}
if (isNewer) {
pendingReleaseInfo = serverInfo;
markHeaderUpdateAvailable(true, serverInfo);
if (manual || !updateBannerShown) {
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
} else if (installed.version !== APP_VERSION || installed.revision !== APP_REVISION) {
saveInstalledReleaseRecord(CURRENT_RELEASE_INFO);
}
setTimeout(() => {
checkForReleaseUpdate({ manual: false }).catch(() => {});
}, 4500);
}
