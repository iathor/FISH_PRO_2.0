import { showToast } from '../ui/components.js?v=2.5.0';

export const PWA_INSTALLED_KEY = 'klev_pro_pwa_installed';
let deferredInstallPrompt = null;

export function generateFloatIconDataURL(size = 512) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  const s = size / 512;
  ctx.scale(s, s);

  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#0b1120');
  g.addColorStop(1, '#0f2942');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);

  ctx.fillStyle = '#ef4444';
  ctx.fillRect(244, 60, 24, 115);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(244, 110, 24, 28);
  ctx.fillStyle = '#38bdf8';
  ctx.beginPath();
  ctx.ellipse(256, 230, 38, 72, 0, 0, Math.PI * 2);
  ctx.fill();

  const pts = [[40, 310], [140, 310], [180, 235], [220, 365], [260, 175], [300, 335], [340, 280], [375, 310], [472, 310]];
  ctx.strokeStyle = '#10b981';
  ctx.lineWidth = 16;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1])));
  ctx.stroke();

  ctx.font = '900 56px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f8fafc';
  ctx.fillText('КЛЁВ', 195, 445);
  ctx.fillStyle = '#38bdf8';
  ctx.fillText('PRO', 360, 445);
  return c.toDataURL('image/png');
}

export function initDynamicTouchIcon() {
  try {
    const fav = document.getElementById('dynamicFavicon');
    const touch = document.getElementById('dynamicTouchIcon');
    if (fav) fav.href = 'icon-192.png?v=2.5.0';
    if (touch) touch.href = 'apple-touch-icon.png?v=2.5.0';
  } catch (e) {}
}

/**
 * Проверяет, запущено ли приложение внутри Android APK WebView или Telegram Mini App,
 * где кнопка «Установить приложение / На экран» не нужна и должна быть полностью скрыта.
 */
export function isApkOrTmaContainer() {
  try {
    if (typeof window === 'undefined') return false;
    const host = (window.location?.hostname || '').toLowerCase();
    if (host.endsWith('androidplatform.net')) return true;
    const ua = navigator.userAgent || '';
    if (/;\s*wv\)|KlevProAPK/i.test(ua)) return true;
    if (
      document.documentElement.hasAttribute('data-tg-webapp') ||
      document.documentElement.hasAttribute('data-apk-webview')
    ) {
      return true;
    }
    const twa = window.Telegram && window.Telegram.WebApp;
    if (
      twa &&
      ((typeof twa.initData === 'string' && twa.initData.length > 0) ||
        (twa.initDataUnsafe && twa.initDataUnsafe.user) ||
        (twa.platform && twa.platform !== 'unknown'))
    ) {
      return true;
    }
    const hash = window.location.hash || '';
    const search = window.location.search || '';
    if (
      hash.includes('tgWebAppData') ||
      search.includes('tgWebAppStartParam') ||
      search.includes('tg_city=') ||
      search.includes('tg_fish=')
    ) {
      return true;
    }
  } catch (e) {}
  return false;
}

export function isStandaloneMode() {
  try {
    if (isApkOrTmaContainer()) return true;
    if (window.navigator.standalone === true) return true;
    if (typeof document !== 'undefined' && document.referrer && document.referrer.includes('android-app://')) return true;
    if (window.matchMedia) {
      if (window.matchMedia('(display-mode: standalone)').matches) return true;
      if (window.matchMedia('(display-mode: fullscreen)').matches) return true;
      if (window.matchMedia('(display-mode: minimal-ui)').matches) return true;
      if (window.matchMedia('(display-mode: window-controls-overlay)').matches) return true;
    }
  } catch (e) {}
  return false;
}

export function isAppInstalledOrShortcutPresent() {
  if (isStandaloneMode()) {
    try { localStorage.setItem(PWA_INSTALLED_KEY, '1'); } catch (e) {}
    return true;
  }
  try {
    return localStorage.getItem(PWA_INSTALLED_KEY) === '1';
  } catch (e) {
    return false;
  }
}

export function markAppInstalled(installed = true) {
  if (isApkOrTmaContainer()) {
    installed = true;
  }
  try {
    if (installed) {
      localStorage.setItem(PWA_INSTALLED_KEY, '1');
      document.documentElement.setAttribute('data-pwa-installed', '1');
    } else {
      localStorage.removeItem(PWA_INSTALLED_KEY);
      document.documentElement.removeAttribute('data-pwa-installed');
    }
  } catch (e) {}
  syncInstallButtons();
}

export function syncInstallButtons() {
  const installed = isAppInstalledOrShortcutPresent() || isApkOrTmaContainer();
  if (installed) {
    document.documentElement.setAttribute('data-pwa-installed', '1');
  } else {
    document.documentElement.removeAttribute('data-pwa-installed');
  }

  document.querySelectorAll('[data-install-app], #installAppBtn, #onbInstallAppBtn').forEach(btn => {
    if (installed) {
      btn.style.display = 'none';
    } else {
      btn.style.display = 'inline-flex';
      if (btn.id === 'onbInstallAppBtn') {
        btn.innerHTML = '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="6" y="2" width="12" height="20" rx="2.5" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="18" r="1.2" fill="#38bdf8"/></svg> На экран';
      } else if (!btn.classList.contains('btn-icon')) {
        btn.innerHTML = deferredInstallPrompt ? '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="6" y="2" width="12" height="20" rx="2.5" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="18" r="1.2" fill="#38bdf8"/></svg> Установить приложение' : '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="6" y="2" width="12" height="20" rx="2.5" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="18" r="1.2" fill="#38bdf8"/></svg> Ярлык на экран';
      } else {
        btn.title = deferredInstallPrompt ? '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="6" y="2" width="12" height="20" rx="2.5" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="18" r="1.2" fill="#38bdf8"/></svg> Установить приложение' : '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="6" y="2" width="12" height="20" rx="2.5" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="18" r="1.2" fill="#38bdf8"/></svg> Ярлык на экран';
      }
    }
  });
}

export function showInstallModal(htmlText) {
  if (isApkOrTmaContainer()) return;
  let modal = document.getElementById('customInstallModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'customInstallModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(2,6,23,0.78);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
    modal.innerHTML = `
      <div style="background:var(--panel);border:1.5px solid var(--accent);border-radius:16px;max-width:370px;width:100%;padding:18px;box-shadow:var(--shadow-header);text-align:center;">
        <img id="modalIconPreview" alt="Клёв ПРО" style="width:72px;height:72px;border-radius:16px;margin-bottom:10px;border:1px solid var(--border);" src="">
        <div style="font-size:16px;font-weight:800;margin-bottom:8px;color:var(--text);">Установка «Клёв ПРО 2.0»</div>
        <div id="modalInstallText" style="font-size:13px;color:var(--muted);line-height:1.5;margin-bottom:16px;text-align:left;"></div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <button type="button" class="btn btn-accent" style="width:100%;" id="closeCustomInstallModalBtn">Понятно</button>
          <button type="button" class="btn btn-sm" style="width:100%;color:var(--good);border-color:var(--good);" id="markShortcutAddedBtn"><svg class="k-ico" style="color:var(--good);" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" fill="rgba(16,185,129,0.24)" stroke="#10b981" stroke-width="1.9"/><path d="M8 12.5l2.7 2.7L16.5 9.5" stroke="#10b981" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg> Ярлык уже на экране (скрыть кнопку)</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal || e.target.id === 'closeCustomInstallModalBtn') {
        modal.style.display = 'none';
      } else if (e.target.id === 'markShortcutAddedBtn') {
        modal.style.display = 'none';
        markAppInstalled(true);
        showToast('Кнопка установки скрыта (ярлык уже добавлен)', 'good');
      }
    });
  }
  const iconEl = modal.querySelector('#modalIconPreview');
  if (iconEl) iconEl.src = 'icon-192.png?v=2.5.0';
  const txtEl = modal.querySelector('#modalInstallText');
  if (txtEl) {
    const safeHtml = String(htmlText || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/&lt;b&gt;/gi, '<b>')
      .replace(/&lt;\/b&gt;/gi, '</b>')
      .replace(/&lt;br\s*\/?&gt;/gi, '<br>');
    txtEl.innerHTML = safeHtml;
  }
  modal.style.display = 'flex';
}

export async function installShortcut() {
  if (isApkOrTmaContainer()) return;
  if (deferredInstallPrompt) {
    try {
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      if (outcome === 'accepted') {
        deferredInstallPrompt = null;
        markAppInstalled(true);
      }
    } catch (e) {}
    return;
  }
  const ua = (navigator.userAgent || '').toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) {
    showInstallModal('1. Нажмите кнопку <b>«Поделиться»</b> (квадрат со стрелкой внизу экрана Safari).<br>2. Выберите пункт <b>«На экран "Домой"»</b> <svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z\" fill=\"rgba(251,191,36,0.32)\" stroke=\"#fbbf24\" stroke-width=\"1.8\" stroke-linejoin=\"round\"/></svg> <b>«Добавить»</b>.');
  } else if (/yabrowser/.test(ua)) {
    showInstallModal('1. Нажмите меню <b>«⋮»</b> или <b>«≡»</b> на панели Яндекс Браузера.<br>2. Выберите <b>«Добавить ярлык на телефон»</b>.');
  } else {
    showInstallModal('1. Нажмите меню браузера <b>«⋮»</b> (в правом верхнем углу).<br>2. Выберите <b>«Установить приложение»</b> или <b>«Добавить на главный экран»</b>.');
  }
}

export function initPwa() {
  initDynamicTouchIcon();

  if (isApkOrTmaContainer()) {
    document.documentElement.setAttribute('data-pwa-installed', '1');
    syncInstallButtons();
    return;
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    if (isApkOrTmaContainer()) return;
    deferredInstallPrompt = e;
    if (!isStandaloneMode()) {
      markAppInstalled(false);
    }
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    markAppInstalled(true);
    showToast('Приложение «Клёв ПРО 2.0» установлено на главный экран!', 'good');
  });

  if (window.matchMedia) {
    try {
      const mq = window.matchMedia('(display-mode: standalone)');
      if (typeof mq.addEventListener === 'function') {
        mq.addEventListener('change', () => syncInstallButtons());
      }
    } catch (e) {}
  }

  if (typeof navigator !== 'undefined' && typeof navigator.getInstalledRelatedApps === 'function') {
    navigator.getInstalledRelatedApps().then(apps => {
      if (Array.isArray(apps) && apps.length > 0) {
        markAppInstalled(true);
      }
    }).catch(() => {});
  }

  syncInstallButtons();
}

export const pwaModule = {
  generateFloatIconDataURL,
  initDynamicTouchIcon,
  isApkOrTmaContainer,
  isStandaloneMode,
  isAppInstalledOrShortcutPresent,
  markAppInstalled,
  syncInstallButtons,
  initPwa,
  showInstallModal,
  installShortcut
};
