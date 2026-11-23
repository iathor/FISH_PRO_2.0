import { safeModuleRun } from '../core/events.js?v=2.9.2-r258';
import { closeModal } from '../ui/components.js?v=2.9.2-r258';

function syncDesktopLayout() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const docEl = document.documentElement;
  if (!docEl) return;
  const width = window.innerWidth || docEl.clientWidth || 1024;
  if (width >= 900) {
    if (docEl.getAttribute('data-device-layout') !== 'desktop-tablet') {
      docEl.setAttribute('data-device-layout', 'desktop-tablet');
    }
  } else if (typeof window.__KLEV_SYNC_DEVICE_LAYOUT__ === 'function') {
    window.__KLEV_SYNC_DEVICE_LAYOUT__();
  }
}

export function initDesktopShell() {
  return safeModuleRun('shell:desktop', () => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return false;
    if (window.__KLEV_SHELL_DESKTOP_INIT__) return true;
    window.__KLEV_SHELL_DESKTOP_INIT__ = true;

    syncDesktopLayout();
    window.addEventListener('resize', () => {
      safeModuleRun('shell:desktop:resize', syncDesktopLayout);
    }, { passive: true });

    document.addEventListener('keydown', (e) => {
      if (!e || e.key !== 'Escape') return;
      safeModuleRun('shell:desktop:escape', () => {
        closeModal();
      });
    });

    return true;
  }, false);
}

initDesktopShell();
