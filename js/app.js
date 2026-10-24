import { initReleaseUpdater, checkForReleaseUpdate } from './core/updater.js?v=2.0.161';
import { RU } from './i18n/ru.js?v=2.0.161';
import { events } from './core/events.js?v=2.0.161';
import { store } from './core/store.js?v=2.0.161';
import { router } from './core/router.js?v=2.0.161';
import { installShortcut, initPwa } from './core/pwa.js?v=2.0.161';
import { initTelegramMiniApp, clearIncomingShareTokenFromUrl, triggerHaptic } from './core/telegram.js?v=2.0.161';
import { showToast } from './ui/components.js?v=2.0.161';
import { weatherModule } from './modules/weather/weather.module.js?v=2.0.161';
import { geoModule } from './modules/geo/geo.module.js?v=2.0.161';
import { fishModule } from './modules/fish/fish.module.js?v=2.0.161';
import { forecastModule } from './modules/forecast/forecast.module.js?v=2.0.161';
import { calendarModule } from './modules/calendar/calendar.module.js?v=2.0.161';
import { logModule } from './modules/log/log.module.js?v=2.0.161';
import { circleModule } from './modules/circle/circle.module.js?v=2.0.161';

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

function updateHeaderUI() {
  const s = store.getState();
  const locSub = document.getElementById('headerLocSub');
  const locText = document.getElementById('headerLocText');
  const statusEl = document.getElementById('headerStatusPill');
  const seasonStrip = document.getElementById('headerSeasonStrip');
  const modeBtn = document.getElementById('headerModeBtn');

  if (modeBtn) {
    const mode = s.appMode || 'angler';
    const modeIcons = { novice: '🟢', angler: '🟡', pro: '🔴' };
    const modeNames = { novice: 'Новичок (Светофор + ТОП-3)', angler: 'Рыбак (Полный + Круг)', pro: 'Профи (8 факторов + GPX)' };
    modeBtn.textContent = modeIcons[mode] || '🟡';
    modeBtn.title = `Режим: ${modeIcons[mode] || '🟡'} ${modeNames[mode] || 'Рыбак'} (нажмите для переключения)`;
  }

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
    const subState = day?.iceSubState || '';
    const customNote = day?.iceNote || '';

    const stripCls = ice === 'ice_safe'
      ? 'ice-safe'
      : (ice === 'ice_danger' ? 'ice-danger' : (ice === 'ice_slush' ? 'ice-slush' : 'open-water'));
    seasonStrip.className = 'season-strip ' + stripCls;

    if (ice === 'ice_safe') {
      seasonStrip.innerHTML = `<span>${customNote || `❄️ Подлёдный сезон: безопасный лёд ~${thick} см`}</span><span>💧 Вода ~${day?.waterTemp ?? 0.5}°C</span>`;
    } else if (ice === 'ice_danger') {
      const msg = subState === 'spring_rotten_ice'
        ? (customNote || `⚠️ Весенний рыхлый лёд и промоины (~${thick} см) — выход на лёд запрещён!`)
        : (customNote || `⚠️ Опасный тонкий лёд (~${thick} см) — выход на лёд запрещён!`);
      seasonStrip.innerHTML = `<span>${msg}</span><span>💧 Вода ~${day?.waterTemp ?? 0.8}°C</span>`;
    } else if (ice === 'ice_slush') {
      seasonStrip.innerHTML = `<span>${customNote || '🌊❄️ Шуга и забереги (колебания -3..+3°C, ледостава нет)'}</span><span>💧 Вода ~${day?.waterTemp ?? 1.2}°C</span>`;
    } else {
      seasonStrip.innerHTML = `<span>${customNote || '🌊 Открытая вода (льда нет)'}</span><span>💧 Вода ~${day?.waterTemp ?? 10}°C</span>`;
    }
  }
}

function bindGlobalShellEvents() {
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
      router.applyVisibility(store.getState().route || 'dashboard');
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
function syncHeaderLayout() {
  const header = document.querySelector('.app-header');
  if (!header) return 82;
  const h = Math.ceil(header.getBoundingClientRect().height) || 82;
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

let cachedFullDockH = 212;
let scrollRafPending = false;

function syncFishDockState() {
  const headerH = syncHeaderLayout();
  const route = store.getState().route || 'dashboard';
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
  const isDedicatedFishTab = ['forecast', 'weather', 'calendar'].includes(route);

  if (isDedicatedFishTab) {
    if (cardEl) {
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
    clearFishCardInlineStyles(dockWrap);
    placeholder.style.height = '0px';
    placeholder.style.minHeight = '0px';
    dockWrap.style.setProperty('--shrink', '1');
    dockWrap.classList.add('docked-mini');
    const dockH = Math.ceil(dockWrap.getBoundingClientRect().height) || 48;
    document.body.style.paddingTop = `${headerH + dockH}px`;
    return;
  }

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

  const fullH = cachedFullDockH || 212;
  const miniH = 48;
  const maxDelta = Math.max(175, fullH - miniH + 35);
  const rawP = Math.min(1, Math.max(0, delta / maxDelta));
  const p = Number((rawP * (2 - rawP)).toFixed(3));

  placeholder.style.height = `${fullH}px`;
  placeholder.style.minHeight = `${fullH}px`;

  if (rawP < 0.99) {
    if (dockWrap.classList.contains('docked-mini')) {
      dockWrap.classList.remove('docked-mini');
    }
    const heightSpan = fullH - miniH;
    const targetDockH = Math.round(fullH - p * heightSpan);
    const targetCardH = Math.max(38, targetDockH - 12);
    const fade = Math.max(0, 1 - p * 1.45);
    const extraMaxH = Math.round(Math.max(0, 1 - p * 1.25) * 34);

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
      const padV = Math.round(10 - p * 5);
      const minW = Math.round(168 - p * 54);
      c.style.height = `${targetCardH}px`;
      c.style.minWidth = `${minW}px`;
      c.style.padding = `${padV}px 8px`;
      c.style.overflow = 'hidden';
    });
    dockWrap.querySelectorAll('.fish-img-wrap').forEach(img => {
      const w = Math.round(118 - p * 76);
      const h = Math.round(52 - p * 26);
      img.style.width = `${w}px`;
      img.style.height = `${h}px`;
      img.style.marginTop = `${Math.round(4 * (1 - p))}px`;
    });
    dockWrap.querySelectorAll('.fish-latin, .fish-badge-wrap, .fish-rating-box, .fish-redbook-ban, [data-info-fish], .fav-btn').forEach(el => {
      el.style.opacity = String(fade.toFixed(2));
      el.style.maxHeight = `${extraMaxH}px`;
      el.style.overflow = 'hidden';
      el.style.margin = p > 0.5 ? '0' : '';
      el.style.pointerEvents = p > 0.35 ? 'none' : '';
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
    syncFishDockState();
  }, { passive: true });

  const headerEl = document.querySelector('.app-header');
  if (headerEl && typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      syncFishDockState();
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
      router.applyVisibility(store.getState().route || 'dashboard');
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
