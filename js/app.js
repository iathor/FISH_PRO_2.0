import { initReleaseUpdater, checkForReleaseUpdate } from './core/updater.js?v=2.0.163';
import { RU } from './i18n/ru.js?v=2.0.163';
import { events } from './core/events.js?v=2.0.163';
import { store } from './core/store.js?v=2.0.163';
import { router } from './core/router.js?v=2.0.163';
import { installShortcut, initPwa } from './core/pwa.js?v=2.0.163';
import { initTelegramMiniApp, clearIncomingShareTokenFromUrl, triggerHaptic } from './core/telegram.js?v=2.0.163';
import { showToast } from './ui/components.js?v=2.0.163';
import { weatherModule } from './modules/weather/weather.module.js?v=2.0.163';
import { geoModule } from './modules/geo/geo.module.js?v=2.0.163';
import { fishModule } from './modules/fish/fish.module.js?v=2.0.163';
import { forecastModule } from './modules/forecast/forecast.module.js?v=2.0.163';
import { calendarModule } from './modules/calendar/calendar.module.js?v=2.0.163';
import { logModule } from './modules/log/log.module.js?v=2.0.163';
import { circleModule } from './modules/circle/circle.module.js?v=2.0.163';

if (typeof window !== 'undefined') {
  window.__KLEV_BOOTSTRAPPED__ = true;
}

window.addEventListener('error', (e) => {
  console.error('[Global Error]:', e.error || e.message);
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

export function applyAppTheme(themeMode) {
  applyTheme(themeMode);
}
if (typeof window !== 'undefined') {
  window.__KLEV_APPLY_THEME__ = applyTheme;
}

function updateHeaderUI() {
  const s = store.getState();
  const locSub = document.getElementById('headerLocSub');
  const locText = document.getElementById('headerLocText');
  const statusEl = document.getElementById('headerStatusPill');
  const seasonStrip = document.getElementById('headerSeasonStrip');

  if (locSub) {
    const shortBasin = (s.basinName || '').replace(/\s*\([^)]*\)/g, '').trim();
    const regionPart = s.locAdmin1 && s.locAdmin1 !== s.locLabel ? `${s.locAdmin1} • ` : '';
    locSub.textContent = `${regionPart}${shortBasin}`;
  }
  if (locText) {
    const waterPart = s.selectedWaterName ? ` • ${s.selectedWaterName}` : '';
    locText.textContent = `📍 ${s.locLabel}${waterPart}`;
  }
  if (statusEl) {
    const isOff = !navigator.onLine || (s.weatherSource || '').includes('Автономный');
    statusEl.className = 'pill header-status-pill ' + (isOff ? 'pill-warn' : 'pill-good');
    const shortSrc = (s.weatherSource || RU.online)
      .replace(/\s+назад/g, '')
      .replace(/Онлайн\s*\(MET\.no\)/i, 'MET.no')
      .replace(/Онлайн\s*•\s*10 дней\s*\+\s*архив/i, 'Онлайн');
    statusEl.textContent = isOff ? `📡 Офлайн` : `🟢 ${shortSrc}`;
  }
  if (seasonStrip) {
    const day = s.weatherDays[s.dayIdx] || s.weatherDays[2] || s.weatherDays[0];
    const ice = day?.iceState || s.iceState;
    const thick = day?.iceThickness ?? s.iceThickness;
    const subState = day?.iceSubState || '';

    const stripCls = ice === 'ice_safe'
      ? 'ice-safe'
      : (ice === 'ice_danger' ? 'ice-danger' : (ice === 'ice_slush' ? 'ice-slush' : 'open-water'));
    seasonStrip.className = 'season-strip ' + stripCls;

    if (ice === 'ice_safe') {
      seasonStrip.innerHTML = `<span>❄️ Безопасный лёд ~${thick} см</span><span>💧 Вода ~${day?.waterTemp ?? 0.5}°C</span>`;
    } else if (ice === 'ice_danger') {
      const msg = subState === 'spring_rotten_ice'
        ? `⚠️ Весенний рыхлый лёд (~${thick} см) — опасно!`
        : `⚠️ Опасный тонкий лёд (~${thick} см) — выход запрещён!`;
      seasonStrip.innerHTML = `<span>${msg}</span><span>💧 Вода ~${day?.waterTemp ?? 0.8}°C</span>`;
    } else if (ice === 'ice_slush') {
      seasonStrip.innerHTML = `<span>🌊❄️ Шуга и забереги (сплошного льда нет)</span><span>💧 Вода ~${day?.waterTemp ?? 1.2}°C</span>`;
    } else {
      seasonStrip.innerHTML = `<span>🌊 Открытая вода (льда нет)</span><span>💧 Вода ~${day?.waterTemp ?? 10}°C</span>`;
    }
  }
}

function bindGlobalShellEvents() {
  const locClickArea = document.getElementById('headerLocClickArea');
  if (locClickArea) {
    locClickArea.addEventListener('click', () => {
      if (store.getState().route !== 'geo') {
        triggerHaptic('selection');
        router.navigate('geo');
      }
    });
  }
  const installBtn = document.getElementById('installAppBtn');
  if (installBtn) {
    installBtn.addEventListener('click', () => installShortcut());
  }

  const modeBtn = document.getElementById('headerModeBtn');
  if (modeBtn) {
    modeBtn.addEventListener('click', () => {
      const order = ['novice', 'angler', 'pro'];
      const cur = store.getState().appMode || 'angler';
      const next = order[(order.indexOf(cur) + 1) % order.length];
      store.dispatch({ type: 'SET_APP_MODE', payload: next });
      router.applyVisibility(store.getState().route || 'forecast');
      triggerHaptic('selection');
      const labels = {
        novice: '🟢 Режим «Новичок»: светофор клёва, ТОП-3 рыбы и готовая снасть',
        angler: '🟡 Режим «Рыбак»: полный навигатор, архив 5 дней и Круг',
        pro: '🔴 Режим «Профи»: все 8 факторов с весами и импорт/экспорт GPX'
      };
      showToast(labels[next] || next, 'good');
    });
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

  const moreBtn = document.getElementById('navMoreBtn');
  const morePopup = document.getElementById('navMorePopup');
  const closeMorePopup = () => {
    if (morePopup) morePopup.classList.remove('open');
    if (moreBtn) moreBtn.setAttribute('aria-expanded', 'false');
  };

  if (moreBtn && morePopup) {
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = !morePopup.classList.contains('open');
      morePopup.classList.toggle('open', willOpen);
      moreBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });
    document.addEventListener('click', (e) => {
      if (!morePopup.contains(e.target) && e.target !== moreBtn) {
        closeMorePopup();
      }
    });
  }

  document.querySelectorAll('[data-nav-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-nav-tab');
      closeMorePopup();
      triggerHaptic('selection');
      if (tab === 'profile') {
        fishModule.openOnboardingModal(true);
      } else {
        router.navigate(tab);
      }
    });
  });

  // Глобальное событие вызова окна шаринга в Круг / Экипаж / Мастерскую
  events.on('circle:openShareModal', (payload = {}) => {
    circleModule.openShareModalForCurrentContext(payload.mode || 'circle', payload.catchObj || null);
  });
}

// ==========================================
// DYNAMIC HEADER HEIGHT & SMOOTH SHRINKING FISH BUTTONS (MINIATURES ON SCROLL & FORECAST TAB)
// ==========================================
let cachedHeaderH = 66;
let cachedFullDockH = 212;
let scrollRafPending = false;

function syncHeaderLayout(forceMeasure = false) {
  if (!forceMeasure && cachedHeaderH > 40) return cachedHeaderH;
  const header = document.querySelector('.app-header');
  if (!header) return cachedHeaderH;
  const h = Math.ceil(header.getBoundingClientRect().height) || 66;
  cachedHeaderH = h;
  document.documentElement.style.setProperty('--header-h', `${h}px`);
  return h;
}

function syncFishDockState(forceMeasure = false) {
  const headerH = syncHeaderLayout(forceMeasure);
  const route = store.getState().route || 'forecast';
  const secFish = document.getElementById('secFish');
  const resultsArea = document.getElementById('fishResultsArea');
  const sentinel = document.getElementById('fishDockSentinel');
  const placeholder = document.getElementById('fishStripPlaceholder');
  const dockWrap = document.getElementById('fishStripDockWrap');

  if (!secFish || !dockWrap || !placeholder) {
    document.body.style.paddingTop = `${headerH}px`;
    return;
  }

  const cardEl = secFish.querySelector('.card');
  const isDedicatedFishTab = ['forecast', 'calendar'].includes(route);

  if (isDedicatedFishTab) {
    if (cardEl && cardEl.getAttribute('data-dock-mode') !== 'mini') {
      cardEl.setAttribute('data-dock-mode', 'mini');
      Array.from(cardEl.children).forEach(ch => {
        if (ch !== placeholder && ch !== sentinel && ch !== resultsArea && ch.id !== 'fishResultsArea') {
          ch.style.display = 'none';
        } else {
          ch.style.display = '';
        }
      });
      cardEl.style.padding = '0';
      cardEl.style.border = 'none';
      cardEl.style.background = 'transparent';
      cardEl.style.boxShadow = 'none';
    }
    placeholder.style.height = '0px';
    placeholder.style.minHeight = '0px';
    if (!dockWrap.classList.contains('docked-mini')) {
      dockWrap.classList.add('docked-mini');
    }
    document.body.style.paddingTop = `${headerH + 46}px`;
    return;
  }

  if (cardEl && cardEl.getAttribute('data-dock-mode') === 'mini') {
    cardEl.setAttribute('data-dock-mode', 'full');
    Array.from(cardEl.children).forEach(ch => {
      if (ch !== placeholder && ch !== sentinel) ch.style.display = '';
    });
    cardEl.style.padding = '';
    cardEl.style.border = '';
    cardEl.style.background = '';
    cardEl.style.boxShadow = '';
  }

  if (route !== 'fish') {
    if (dockWrap.classList.contains('docked-mini')) {
      dockWrap.classList.remove('docked-mini');
    }
    placeholder.style.height = '';
    placeholder.style.minHeight = '';
    document.body.style.paddingTop = `${headerH}px`;
    return;
  }

  document.body.style.paddingTop = `${headerH}px`;
  if (!sentinel) return;

  const sRect = sentinel.getBoundingClientRect();
  const delta = headerH - sRect.top;

  // Переключение одним CSS-классом с гистерезисом (0.01 мс, без пересчёта геометрии 800 DOM-узлов на каждом пикселе скролла!)
  if (delta > 36) {
    if (!dockWrap.classList.contains('docked-mini')) {
      placeholder.style.height = `${cachedFullDockH}px`;
      placeholder.style.minHeight = `${cachedFullDockH}px`;
      dockWrap.classList.add('docked-mini');
    }
  } else if (delta <= 8) {
    if (dockWrap.classList.contains('docked-mini')) {
      dockWrap.classList.remove('docked-mini');
      placeholder.style.height = '';
      placeholder.style.minHeight = '';
    }
  }
}

window.syncFishDockState = syncFishDockState;

function safeInit(name, fn) {
  try {
    fn();
  } catch (err) {
    console.error(`[Bootstrap] Module ${name} init error:`, err);
  }
}

function bootstrapApp() {
  window.__KLEV_BOOTSTRAPPED__ = true;
  applyTheme(store.getState().theme || 'auto');
  safeInit('pwa', () => initPwa());
  safeInit('shellEvents', () => bindGlobalShellEvents());

  safeInit('weather', () => weatherModule.init(document.getElementById('secWeather')));
  safeInit('geo', () => geoModule.init(document.getElementById('secGeo')));
  safeInit('fish', () => fishModule.init(document.getElementById('secFish')));
  safeInit('forecast', () => forecastModule.init(document.getElementById('secForecast')));
  safeInit('circle', () => circleModule.init(document.getElementById('secCircle')));
  safeInit('calendar', () => calendarModule.init(document.getElementById('secCalendar')));
  safeInit('log', () => logModule.init(document.getElementById('secLog')));

  safeInit('router', () => router.init());
  safeInit('telegram', () => {
    initTelegramMiniApp(async (incomingToken) => {
      const imported = await circleModule.importSharePackToken(incomingToken, false);
      clearIncomingShareTokenFromUrl();
      if (imported) {
        router.navigate('circle');
      }
    });
  });

  updateHeaderUI();
  syncFishDockState();

  window.addEventListener('scroll', () => {
    if (!scrollRafPending) {
      scrollRafPending = true;
      requestAnimationFrame(() => {
        scrollRafPending = false;
        syncFishDockState();
      });
    }
  }, { passive: true });

  window.addEventListener('resize', () => {
    syncFishDockState(true);
  }, { passive: true });

  const headerEl = document.querySelector('.app-header');
  if (headerEl && typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      syncFishDockState(true);
    });
    ro.observe(headerEl);
  }

  const curProfile = store.getState().userProfile;
  if (!curProfile || !curProfile.onboarded) {
    setTimeout(() => {
      fishModule.openOnboardingModal(false);
    }, 450);
  }

  store.subscribe(
    s => ({
      appMode: s.appMode,
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
      waterRadiusKm: s.waterRadiusKm,
      route: s.route
    }),
    () => {
      updateHeaderUI();
      router.applyVisibility(store.getState().route || 'forecast');
      syncFishDockState();
    }
  );

  safeInit('updater', () => initReleaseUpdater());
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrapApp);
} else {
  bootstrapApp();
}
