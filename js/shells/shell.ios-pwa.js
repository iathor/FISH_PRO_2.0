import { safeModuleRun } from '../core/events.js?v=2.9.3-r239';
import { showToast } from '../ui/components.js?v=2.9.3-r239';

const IOS_HINT_STORAGE_KEY = 'klev_ios_pwa_hint_seen_v1';

function isIosDevice() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandaloneOrEmbedded() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return true;
  if (window.navigator && window.navigator.standalone === true) return true;
  if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
  if (document.documentElement.hasAttribute('data-apk-webview') || document.documentElement.hasAttribute('data-tg-webapp')) return true;
  if (typeof window.AndroidBridge !== 'undefined') return true;
  if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.platform && window.Telegram.WebApp.platform !== 'unknown') return true;
  return false;
}

function unlockIosSpeechSynthesis() {
  safeModuleRun('shell:ios-pwa:speechUnlock', () => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (window.__KLEV_IOS_SPEECH_UNLOCKED__) return;
    window.__KLEV_IOS_SPEECH_UNLOCKED__ = true;
    if (typeof window.SpeechSynthesisUtterance !== 'function') return;
    const u = new window.SpeechSynthesisUtterance('');
    u.volume = 0;
    u.rate = 1;
    window.speechSynthesis.speak(u);
    window.speechSynthesis.cancel();
  });
}

function showIosStandaloneHintIfNeeded() {
  safeModuleRun('shell:ios-pwa:standaloneHint', () => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (isStandaloneOrEmbedded()) return;
    document.documentElement.setAttribute('data-ios-install-hint', '1');
    try {
      if (window.localStorage && window.localStorage.getItem(IOS_HINT_STORAGE_KEY) === '1') return;
      if (window.localStorage) window.localStorage.setItem(IOS_HINT_STORAGE_KEY, '1');
    } catch (_e) {}

    const emitHint = () => {
      safeModuleRun('shell:ios-pwa:toast', () => {
        showToast('Для установки на экран iOS нажмите «Поделиться» и выберите «На экран Домой».', 'info', {
          durationMs: 6500,
          dedupKey: 'ios_pwa_standalone_hint'
        });
      });
    };

    if (document.body) {
      setTimeout(emitHint, 1200);
    } else {
      window.addEventListener('DOMContentLoaded', () => setTimeout(emitHint, 1200), { once: true });
    }
  });
}

export function initIosPwaShell() {
  return safeModuleRun('shell:ios-pwa', () => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return false;
    if (window.__KLEV_SHELL_IOS_PWA_INIT__) return true;
    window.__KLEV_SHELL_IOS_PWA_INIT__ = true;

    if (!isIosDevice()) return false;

    document.addEventListener('touchmove', (e) => {
      if (!e || !e.touches || e.touches.length !== 1) return;
      const target = e.target;
      if (target && typeof target.closest === 'function' && target.closest('#klevArcMapStage')) {
        if (e.cancelable) e.preventDefault();
      }
    }, { passive: false });

    document.addEventListener('touchstart', unlockIosSpeechSynthesis, { once: true, passive: true });
    showIosStandaloneHintIfNeeded();

    return true;
  }, false);
}

initIosPwaShell();
