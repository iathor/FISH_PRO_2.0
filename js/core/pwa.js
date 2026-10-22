import { showToast } from '../ui/components.js?v=2.0.12';

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
    const png512 = generateFloatIconDataURL(512);
    if (!png512) return;
    const fav = document.getElementById('dynamicFavicon');
    const touch = document.getElementById('dynamicTouchIcon');
    if (fav) fav.href = png512;
    if (touch) touch.href = png512;
  } catch (e) {}
}

export function isStandaloneMode() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
         window.navigator.standalone === true;
}

export function syncInstallButtons() {
  const standalone = isStandaloneMode();
  document.querySelectorAll('[data-install-app]').forEach(btn => {
    if (standalone) {
      btn.style.display = 'none';
    } else {
      btn.style.display = 'inline-flex';
      if (!btn.classList.contains('btn-icon')) {
        btn.textContent = deferredInstallPrompt ? '📲 Установить приложение' : '📲 Ярлык на экран';
      } else {
        btn.title = deferredInstallPrompt ? '📲 Установить приложение' : '📲 Ярлык на экран';
      }
    }
  });
}

export function showInstallModal(htmlText) {
  let modal = document.getElementById('customInstallModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'customInstallModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(2,6,23,0.78);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
    modal.innerHTML = `
      <div style="background:var(--panel);border:1.5px solid var(--accent);border-radius:16px;max-width:360px;width:100%;padding:18px;box-shadow:var(--shadow-header);text-align:center;">
        <img id="modalIconPreview" alt="Клёв ПРО" style="width:72px;height:72px;border-radius:16px;margin-bottom:10px;border:1px solid var(--border);" src="">
        <div style="font-size:16px;font-weight:800;margin-bottom:8px;color:var(--text);">Установка «Клёв ПРО 2.0»</div>
        <div id="modalInstallText" style="font-size:13px;color:var(--muted);line-height:1.5;margin-bottom:16px;text-align:left;"></div>
        <button type="button" class="btn btn-accent" style="width:100%;" id="closeCustomInstallModalBtn">Понятно</button>
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal || e.target.id === 'closeCustomInstallModalBtn') {
        modal.style.display = 'none';
      }
    });
  }
  const iconEl = modal.querySelector('#modalIconPreview');
  if (iconEl) iconEl.src = generateFloatIconDataURL(192);
  const txtEl = modal.querySelector('#modalInstallText');
  if (txtEl) txtEl.innerHTML = htmlText;
  modal.style.display = 'flex';
}

export async function installShortcut() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    if (outcome === 'accepted') {
      deferredInstallPrompt = null;
      syncInstallButtons();
    }
    return;
  }
  const ua = (navigator.userAgent || '').toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) {
    showInstallModal('1. Нажмите кнопку <b>«Поделиться»</b> (квадрат со стрелкой внизу экрана Safari).<br>2. Выберите пункт <b>«На экран "Домой"»</b> ➔ <b>«Добавить»</b>.');
  } else if (/yabrowser/.test(ua)) {
    showInstallModal('1. Нажмите меню <b>«⋮»</b> или <b>«≡»</b> на панели Яндекс Браузера.<br>2. Выберите <b>«Добавить ярлык на телефон»</b>.');
  } else {
    showInstallModal('1. Нажмите меню браузера <b>«⋮»</b> (в правом верхнем углу).<br>2. Выберите <b>«Установить приложение»</b> или <b>«Добавить на главный экран»</b>.');
  }
}

export function initPwa() {
  initDynamicTouchIcon();
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    syncInstallButtons();
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    syncInstallButtons();
    showToast('Приложение «Клёв ПРО 2.0» установлено на главный экран!', 'good');
  });
  syncInstallButtons();
}

export const pwaModule = {
  generateFloatIconDataURL,
  initDynamicTouchIcon,
  isStandaloneMode,
  syncInstallButtons,
  initPwa,
  showInstallModal,
  installShortcut
};
