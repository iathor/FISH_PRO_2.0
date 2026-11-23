import { safeModuleRun } from '../core/events.js?v=2.9.3-r239';

function syncMobileViewport() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const docEl = document.documentElement;
  if (!docEl) return;
  const vvHeight = window.visualViewport && Number(window.visualViewport.height);
  const vhPx = (vvHeight > 0 ? vvHeight : (window.innerHeight || docEl.clientHeight || 0));
  if (vhPx > 0) {
    docEl.style.setProperty('--klev-vh', `${(vhPx * 0.01).toFixed(4)}px`);
  }
  docEl.style.setProperty('--klev-safe-top', 'env(safe-area-inset-top, 0px)');
  docEl.style.setProperty('--klev-safe-right', 'env(safe-area-inset-right, 0px)');
  docEl.style.setProperty('--klev-safe-bottom', 'env(safe-area-inset-bottom, 0px)');
  docEl.style.setProperty('--klev-safe-left', 'env(safe-area-inset-left, 0px)');
  docEl.setAttribute('data-mobile-shell', '1');
}

export function initMobileShell() {
  return safeModuleRun('shell:mobile', () => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return false;
    if (window.__KLEV_SHELL_MOBILE_INIT__) return true;
    window.__KLEV_SHELL_MOBILE_INIT__ = true;

    syncMobileViewport();
    const onResize = () => safeModuleRun('shell:mobile:resize', syncMobileViewport);
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('orientationchange', () => {
      setTimeout(onResize, 60);
    }, { passive: true });
    if (window.visualViewport && typeof window.visualViewport.addEventListener === 'function') {
      window.visualViewport.addEventListener('resize', onResize, { passive: true });
    }

    return true;
  }, false);
}

initMobileShell();
