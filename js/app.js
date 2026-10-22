import { initReleaseUpdater, checkForReleaseUpdate, showReleaseUpdateModal } from './core/updater.js';
import { RU } from './i18n/ru.js';
import { store } from './core/store.js';
import { router } from './core/router.js';
import { pwaModule, installShortcut, initPwa, syncInstallButtons } from './core/pwa.js';
import { showToast } from './ui/components.js';
import { weatherModule } from './modules/weather/weather.module.js';
import { geoModule } from './modules/geo/geo.module.js';
import { fishModule } from './modules/fish/fish.module.js';
import { forecastModule } from './modules/forecast/forecast.module.js';
import { calendarModule } from './modules/calendar/calendar.module.js';
import { logModule } from './modules/log/log.module.js';

window.addEventListener('error', (e) => {
  console.error('[Global Error]:', e.error || e.message);
  showToast(RU.errGeneric, 'bad');
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('[Unhandled Rejection]:', e.reason);
});

function applyTheme(themeMode) {
  const root = document.documentElement;
  let effective = themeMode;
  if (themeMode === 'auto') {
    effective = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  root.setAttribute('data-theme', effective);
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute('content', effective === 'dark' ? '#0b1120' : '#f1f5f9');

  const btn = document.getElementById('headerThemeBtn');
  if (btn) {
    btn.textContent = themeMode === 'auto' ? '🌓' : (themeMode === 'dark' ? '🌙' : '☀️');
  }
}

function updateHeaderUI() {
  const s = store.getState();
  const locSub = document.getElementById('headerLocSub');
  const locText = document.getElementById('headerLocText');
  const statusEl = document.getElementById('headerStatusPill');
  const seasonStrip = document.getElementById('headerSeasonStrip');

  if (locSub) {
    const regionPart = s.locAdmin1 && s.locAdmin1 !== s.locLabel ? `${s.locAdmin1} • ` : '';
    locSub.textContent = `${regionPart}${s.basinName}`;
  }
  if (locText) {
    const waterPart = s.selectedWaterName ? ` • ${s.selectedWaterName}` : '';
    locText.textContent = `📍 ${s.locLabel}${waterPart}`;
  }
  if (statusEl) {
    const isOff = !navigator.onLine || (s.weatherSource || '').includes('Автономный');
    statusEl.className = 'pill ' + (isOff ? 'pill-warn' : 'pill-good');
    statusEl.textContent = isOff ? `📡 ${RU.offlineMode}` : `🟢 ${s.weatherSource || RU.online}`;
  }
  if (seasonStrip) {
    const day = s.weatherDays[s.dayIdx] || s.weatherDays[2] || s.weatherDays[0];
    const ice = day?.iceState || s.iceState;
    const thick = day?.iceThickness ?? s.iceThickness;
    seasonStrip.className = 'season-strip ' + (ice === 'ice_safe' ? 'ice-safe' : (ice === 'ice_danger' ? 'ice-danger' : 'open-water'));
    if (ice === 'ice_safe') {
      seasonStrip.innerHTML = `<span>❄️ Подлёдный сезон: безопасный лёд ~${thick} см</span><span>💧 Вода ~${day?.waterTemp ?? 0.5}°C</span>`;
    } else if (ice === 'ice_danger') {
      seasonStrip.innerHTML = `<span>⚠️ Опасный ледостав / шуга (~${thick} см) — выход на лёд запрещён!</span><span>💧 Вода ~${day?.waterTemp ?? 0.8}°C</span>`;
    } else {
      seasonStrip.innerHTML = `<span>🌊 Открытая вода (льда нет)</span><span>💧 Вода ~${day?.waterTemp ?? 10}°C</span>`;
    }
  }
}

function bindGlobalShellEvents() {
  const installBtn = document.getElementById('installAppBtn');
  if (installBtn) {
    installBtn.addEventListener('click', () => installShortcut());
  }

  const profileBtn = document.getElementById('headerProfileBtn');
  if (profileBtn) {
    profileBtn.addEventListener('click', () => {
      fishModule.openOnboardingModal(true);
    });
  }

  const themeBtn = document.getElementById('headerThemeBtn');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const modes = ['auto', 'dark', 'light'];
      const cur = store.getState().theme || 'auto';
      const next = modes[(modes.indexOf(cur) + 1) % modes.length];
      store.dispatch({ type: 'SET_THEME', payload: next });
      applyTheme(next);
    });
  }

  const refreshBtn = document.getElementById('headerRefreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      const s = store.getState();
      weatherModule.fetchWeather(s.lat, s.lon, true);
      if (refreshBtn.getAttribute('data-has-update') === '1') {
        await checkForReleaseUpdate({ manual: true });
      } else {
        showToast('Метеоданные и проверка версии обновлены...', 'info');
        checkForReleaseUpdate({ manual: false });
      }
    });
  }

  const verBtn = document.getElementById('headerVersionBtn');
  if (verBtn) {
    verBtn.addEventListener('click', () => {
      checkForReleaseUpdate({ manual: true });
    });
  }

  document.querySelectorAll('[data-nav-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-nav-tab');
      if (tab === 'profile') {
        fishModule.openOnboardingModal(true);
      } else {
        router.navigate(tab);
      }
    });
  });
}


// ==========================================
// DYNAMIC HEADER HEIGHT & SHRINKING FISH BUTTONS (MINIATURES ON SCROLL)
// ==========================================
function syncHeaderLayout() {
  const header = document.querySelector('.app-header');
  if (!header) return 78;
  const h = Math.ceil(header.getBoundingClientRect().height) || 78;
  document.documentElement.style.setProperty('--header-h', `${h}px`);
  return h;
}

function clearFishCardInlineStyles(dockWrap) {
  if (!dockWrap) return;
  dockWrap.style.position = '';
  dockWrap.style.top = '';
  dockWrap.style.left = '';
  dockWrap.style.right = '';
  dockWrap.style.zIndex = '';
  dockWrap.style.background = '';
  dockWrap.style.borderBottom = '';
  dockWrap.style.boxShadow = '';
  dockWrap.style.padding = '';
  dockWrap.style.height = '';
  dockWrap.style.overflow = '';
  dockWrap.querySelectorAll('.fish-card').forEach(c => {
    c.style.height = '';
    c.style.minWidth = '';
    c.style.maxWidth = '';
    c.style.padding = '';
    c.style.overflow = '';
  });
  dockWrap.querySelectorAll('.fish-img-wrap').forEach(img => {
    img.style.width = '';
    img.style.height = '';
    img.style.marginTop = '';
  });
  dockWrap.querySelectorAll('.fish-latin, .fish-badge-wrap, .fish-rating-box, .fish-redbook-ban, [data-info-fish], .fav-btn').forEach(el => {
    el.style.opacity = '';
    el.style.maxHeight = '';
    el.style.overflow = '';
    el.style.margin = '';
    el.style.pointerEvents = '';
  });
}

let cachedFullDockH = 204;

function syncFishDockState() {
  const headerH = syncHeaderLayout();
  const route = store.getState().route || 'dashboard';
  const secFish = document.getElementById('secFish');
  const sentinel = document.getElementById('fishDockSentinel');
  const placeholder = document.getElementById('fishStripPlaceholder');
  const dockWrap = document.getElementById('fishStripDockWrap');

  if (!secFish || !dockWrap || !placeholder) {
    document.body.style.paddingTop = `${headerH}px`;
    return;
  }

  const cardEl = secFish.querySelector('.card');
  const isDedicatedFishTab = ['forecast', 'weather', 'calendar'].includes(route);

  if (isDedicatedFishTab) {
    if (cardEl) {
      Array.from(cardEl.children).forEach(ch => {
        if (ch !== placeholder && ch !== sentinel) ch.style.display = 'none';
      });
      cardEl.style.padding = '0';
      cardEl.style.border = 'none';
      cardEl.style.background = 'transparent';
      cardEl.style.boxShadow = 'none';
    }
    clearFishCardInlineStyles(dockWrap);
    placeholder.style.height = '0px';
    placeholder.style.minHeight = '0px';
    dockWrap.style.setProperty('--shrink', '1');
    dockWrap.classList.add('docked-mini');
    const dockH = Math.ceil(dockWrap.getBoundingClientRect().height) || 44;
    document.body.style.paddingTop = `${headerH + dockH}px`;
    return;
  }

  // Restore full card children visibility for dashboard / fish routes
  if (cardEl) {
    Array.from(cardEl.children).forEach(ch => {
      if (ch !== placeholder && ch !== sentinel) ch.style.display = '';
    });
    cardEl.style.padding = '';
    cardEl.style.border = '';
    cardEl.style.background = '';
    cardEl.style.boxShadow = '';
  }

  if (route !== 'dashboard' && route !== 'fish') {
    clearFishCardInlineStyles(dockWrap);
    dockWrap.classList.remove('docked-mini');
    dockWrap.style.removeProperty('--shrink');
    placeholder.style.height = '';
    placeholder.style.minHeight = '';
    document.body.style.paddingTop = `${headerH}px`;
    return;
  }

  document.body.style.paddingTop = `${headerH}px`;
  if (!sentinel) return;

  const sRect = sentinel.getBoundingClientRect();
  const delta = headerH - sRect.top;

  if (delta <= 0) {
    if (dockWrap.classList.contains('docked-mini')) {
      dockWrap.classList.remove('docked-mini');
    }
    dockWrap.style.removeProperty('--shrink');
    clearFishCardInlineStyles(dockWrap);
    placeholder.style.height = '';
    placeholder.style.minHeight = '';
    const curH = dockWrap.offsetHeight;
    if (curH > 120) cachedFullDockH = curH;
    return;
  }

  const fullH = cachedFullDockH || 204;
  const miniH = 44;
  const maxDelta = Math.max(80, fullH - miniH);
  const p = Math.min(1, Math.max(0, delta / maxDelta));

  // Keep placeholder at fullH so document scroll height never jumps,
  // while dockWrap height equals (fullH - p * maxDelta) so its bottom matches placeholder bottom to the exact pixel!
  placeholder.style.height = `${fullH}px`;
  placeholder.style.minHeight = `${fullH}px`;

  if (p < 1) {
    if (dockWrap.classList.contains('docked-mini')) {
      dockWrap.classList.remove('docked-mini');
    }
    const targetDockH = Math.round(fullH - p * maxDelta);
    const targetCardH = Math.max(34, targetDockH - 12);
    const fade = Math.max(0, 1 - p * 1.8);
    const extraMaxH = Math.round(Math.max(0, 1 - p * 1.4) * 34);

    dockWrap.style.position = 'fixed';
    dockWrap.style.top = `${headerH}px`;
    dockWrap.style.left = '0';
    dockWrap.style.right = '0';
    dockWrap.style.zIndex = '990';
    dockWrap.style.background = 'var(--panel)';
    dockWrap.style.borderBottom = '1px solid var(--border)';
    dockWrap.style.boxShadow = 'var(--shadow-header)';
    dockWrap.style.padding = '4px 12px';
    dockWrap.style.height = `${targetDockH}px`;
    dockWrap.style.overflow = 'hidden';

    dockWrap.querySelectorAll('.fish-card').forEach(c => {
      const padV = Math.round(10 - p * 6);
      const minW = Math.round(156 - p * 52);
      c.style.height = `${targetCardH}px`;
      c.style.minWidth = `${minW}px`;
      c.style.padding = `${padV}px 8px`;
      c.style.overflow = 'hidden';
    });
    dockWrap.querySelectorAll('.fish-img-wrap').forEach(img => {
      const w = Math.round(112 - p * 78);
      const h = Math.round(48 - p * 28);
      img.style.width = `${w}px`;
      img.style.height = `${h}px`;
      img.style.marginTop = `${Math.round(4 * (1 - p))}px`;
    });
    dockWrap.querySelectorAll('.fish-latin, .fish-badge-wrap, .fish-rating-box, .fish-redbook-ban, [data-info-fish], .fav-btn').forEach(el => {
      el.style.opacity = String(fade.toFixed(2));
      el.style.maxHeight = `${extraMaxH}px`;
      el.style.overflow = 'hidden';
      el.style.margin = p > 0.4 ? '0' : '';
      el.style.pointerEvents = p > 0.3 ? 'none' : '';
    });
  } else {
    clearFishCardInlineStyles(dockWrap);
    dockWrap.style.setProperty('--shrink', '1');
    if (!dockWrap.classList.contains('docked-mini')) {
      dockWrap.classList.add('docked-mini');
    }
  }
}

window.syncFishDockState = syncFishDockState;

function bootstrapApp() {
  applyTheme(store.getState().theme || 'auto');
  initPwa();
  bindGlobalShellEvents();

  weatherModule.init(document.getElementById('secWeather'));
  geoModule.init(document.getElementById('secGeo'));
  fishModule.init(document.getElementById('secFish'));
  forecastModule.init(document.getElementById('secForecast'));
  calendarModule.init(document.getElementById('secCalendar'));
  logModule.init(document.getElementById('secLog'));

  router.init();
  updateHeaderUI();
  syncFishDockState();

  window.addEventListener('scroll', () => {
    syncFishDockState();
  }, { passive: true });

  window.addEventListener('resize', () => {
    syncFishDockState();
  }, { passive: true });

  const headerEl = document.querySelector('.app-header');
  if (headerEl && typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      syncFishDockState();
    });
    ro.observe(headerEl);
  }

  // Check first-time onboarding
  const curProfile = store.getState().userProfile;
  if (!curProfile || !curProfile.onboarded) {
    setTimeout(() => {
      fishModule.openOnboardingModal(false);
    }, 450);
  }

  store.subscribe(
    s => ({
      locLabel: s.locLabel,
      locAdmin1: s.locAdmin1,
      selectedWaterName: s.selectedWaterName,
      basinName: s.basinName,
      weatherSource: s.weatherSource,
      iceState: s.iceState,
      iceThickness: s.iceThickness,
      dayIdx: s.dayIdx,
      weatherDays: s.weatherDays,
      fishId: s.fishId,
      showAllSpecies: s.showAllSpecies,
      onlyFavoritesFilter: s.onlyFavoritesFilter,
      water: s.water,
      route: s.route
    }),
    () => {
      updateHeaderUI();
      syncFishDockState();
    }
  );

  window.__KLEV_BOOTSTRAPPED__ = true;
  initReleaseUpdater();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrapApp);
} else {
  bootstrapApp();
}
