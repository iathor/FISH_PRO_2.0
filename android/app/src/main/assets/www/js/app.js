import { svgIcon } from './ui/icons.js?v=2.5.2';
import { initReleaseUpdater, checkForReleaseUpdate } from './core/updater.js?v=2.5.2';
import { RU } from './i18n/ru.js?v=2.5.2';
import { events } from './core/events.js?v=2.5.2';
import { store } from './core/store.js?v=2.5.2';
import { router } from './core/router.js?v=2.5.2';
import { installShortcut, initPwa } from './core/pwa.js?v=2.5.2';
import {
  initTelegramMiniApp,
  extractIncomingDeepLinkParams,
  extractIncomingShareToken,
  clearIncomingShareTokenFromUrl,
  triggerHaptic,
  syncTelegramTheme,
  syncTelegramBackButton,
  getTelegramUser
} from './core/telegram.js?v=2.5.2';
import { FISH_DB } from './data/species.js?v=2.5.2';
import { WATER_PROFILES } from './data/waters.js?v=2.5.2';
import { showToast, openModal, closeModal } from './ui/components.js?v=2.5.2';
import { weatherModule } from './modules/weather/weather.module.js?v=2.5.2';
import { geoModule } from './modules/geo/geo.module.js?v=2.5.2';
import { fishModule } from './modules/fish/fish.module.js?v=2.5.2';
import { forecastModule } from './modules/forecast/forecast.module.js?v=2.5.2';
import { calendarModule } from './modules/calendar/calendar.module.js?v=2.5.2';
import { logModule } from './modules/log/log.module.js?v=2.5.2';
import { circleModule } from './modules/circle/circle.module.js?v=2.5.2';

if (typeof window !== 'undefined') {
  window.__KLEV_BOOTSTRAPPED__ = true;
  window.__KLEV_STORE__ = store;
}

window.addEventListener('message', (e) => { if (e && e.data === 'klev_close_admin_console') closeModal(); });
window.addEventListener('error', (e) => {
  console.error('[Global Error]:', e.error || e.message);
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('[Unhandled Rejection]:', e.reason);
});

let _liveSystemSchemeOverride = null;

export function resolveEffectiveTheme(themeMode) {
  if (themeMode === 'dark') return { effective: 'dark', sunriseHr: 7, sunsetHr: 20 };
  if (themeMode === 'light') return { effective: 'light', sunriseHr: 7, sunsetHr: 20 };
  if (themeMode === 'contrast') return { effective: 'contrast', sunriseHr: 7, sunsetHr: 20 };

  const s = store.getState();
  const todayObj = s?.weatherDays?.[2] || s?.weatherDays?.[s?.dayIdx] || s?.weatherDays?.[0] || null;
  const sunriseHr = Number.isFinite(todayObj?.sunriseHr) ? todayObj.sunriseHr : 7;
  const sunsetHr = Number.isFinite(todayObj?.sunsetHr) ? todayObj.sunsetHr : 20;

  if (_liveSystemSchemeOverride === 'light' || _liveSystemSchemeOverride === 'dark') {
    return { effective: _liveSystemSchemeOverride, sunriseHr, sunsetHr };
  }

  const nowHr = new Date().getHours();
  const isDaylight = nowHr >= sunriseHr && nowHr < sunsetHr;
  return {
    effective: isDaylight ? 'light' : 'dark',
    sunriseHr,
    sunsetHr
  };
}

function applyTheme(themeMode, showNotificationToast = false) {
  const mode = ['auto', 'dark', 'light', 'contrast'].includes(themeMode) ? themeMode : 'auto';
  if (mode !== 'auto') {
    _liveSystemSchemeOverride = null;
  }
  const { effective, sunriseHr, sunsetHr } = resolveEffectiveTheme(mode);
  const root = document.documentElement;
  root.setAttribute('data-theme', effective);
  root.setAttribute('data-theme-mode', mode);
  syncTelegramTheme(effective === 'contrast' ? 'dark' : effective);

  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute('content', effective === 'contrast' ? '#0f1520' : (effective === 'dark' ? '#07111f' : '#dfeaf5'));

  const btn = document.getElementById('headerThemeBtn');
  if (btn) {
    btn.innerHTML = mode === 'auto' ? svgIcon('moon') : (mode === 'dark' ? svgIcon('moon') : (mode === 'contrast' ? svgIcon('glasses') : svgIcon('sun')));
  }

  if (showNotificationToast) {
    if (mode === 'auto') {
      showToast(
 ` Тема «Авто»: сейчас ${effective === 'light' ? ' День (Светлая)' : '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" fill="#fbbf24" stroke="#f59e0b" stroke-width="1.6" stroke-linejoin="round"/></svg> Ночь (Тёмная)'} • автосмена по восходу (${String(sunriseHr).padStart(2, '0')}:00) и закату (${String(sunsetHr).padStart(2, '0')}:00)`,
        'good'
      );
    } else if (mode === 'dark') {
      showToast(' Включена Тёмная радарная тема', 'info');
    } else if (mode === 'contrast') {
      showToast(' Включена мягкая Контрастная тактическая тема', 'good');
    } else {
      showToast(' Включена Светлая дневная тема', 'info');
    }
  }
}

function initAutoThemeListeners() {
  if (typeof window === 'undefined') return;
  try {
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onMqChange = (e) => {
        if ((store.getState().theme || 'auto') === 'auto') {
          _liveSystemSchemeOverride = e.matches ? 'dark' : 'light';
          applyTheme('auto', false);
        }
      };
      if (typeof mq.addEventListener === 'function') {
        mq.addEventListener('change', onMqChange);
      } else if (typeof mq.addListener === 'function') {
        mq.addListener(onMqChange);
      }
    }
  } catch (e) {}

  try {
    if (window.Telegram && window.Telegram.WebApp && typeof window.Telegram.WebApp.onEvent === 'function') {
      window.Telegram.WebApp.onEvent('themeChanged', () => {
        if ((store.getState().theme || 'auto') === 'auto') {
          const tgScheme = window.Telegram.WebApp.colorScheme;
          if (tgScheme === 'dark' || tgScheme === 'light') {
            _liveSystemSchemeOverride = tgScheme;
            applyTheme('auto', false);
          }
        }
      });
    }
  } catch (e) {}

  setInterval(() => {
    if ((store.getState().theme || 'auto') === 'auto') {
      applyTheme('auto', false);
    }
  }, 60000);
}

export function applyAppTheme(themeMode, showNotificationToast = false) {
  applyTheme(themeMode, showNotificationToast);
}
if (typeof window !== 'undefined') {
  window.__KLEV_APPLY_THEME__ = applyTheme;
}

function updateHeaderUI() {
  const s = store.getState();
  const statusBlock = document.getElementById('headerStatusBlock');
  const statusDot = document.getElementById('headerStatusDot');
  const seasonMain = document.getElementById('headerSeasonMainText');
  const seasonSub = document.getElementById('headerSeasonSubText');
  const topWeatherIco = document.getElementById('topNavWeatherIco');
  const topWeatherLbl = document.getElementById('topNavWeatherLbl');

  const isOff = !navigator.onLine || (s.weatherSource || '').includes('Автономный');
  if (statusDot) {
    statusDot.innerHTML = isOff ? `${svgIcon('radar', 'var(--warn)')} ОФЛАЙН` : `${svgIcon('dot', 'var(--good)')} ОНЛАЙН`;
  }

  const day = s.weatherDays?.[s.dayIdx] || s.weatherDays?.[2] || s.weatherDays?.[0];
  const ice = day?.iceState || s.iceState || 'open_water';
  const thick = day?.iceThickness ?? s.iceThickness ?? 0;
  const subState = day?.iceSubState || '';
  const wTemp = day?.waterTemp ?? 8;
  const prof = WATER_PROFILES[s.water] || WATER_PROFILES.small_river;
  const flowShort = prof.flow >= 1.8 ? 'быстрое теч.' : (prof.flow >= 1.1 ? 'умеренное теч.' : 'стоячая вода');

  // Автоматическая сезонная адаптация кнопки Погоды сверху
  if (topWeatherIco && topWeatherLbl) {
    if (ice === 'ice_safe' || ice === 'ice_danger') {
      topWeatherIco.innerHTML = svgIcon('snow');
      topWeatherLbl.textContent = 'Погода·Лёд';
    } else if (ice === 'ice_slush') {
      topWeatherIco.innerHTML = svgIcon('wave');
      topWeatherLbl.textContent = 'Погода·Вода';
    } else {
      topWeatherIco.innerHTML = svgIcon('weather');
      topWeatherLbl.textContent = 'Погода·Вода';
    }
  }

  // Увеличенный информативный блок статуса в левой части шапки (без дублирования города/реки)
  if (statusBlock) {
    const stripCls = ice === 'ice_safe'
      ? 'ice-safe'
      : (ice === 'ice_danger' ? 'ice-danger' : (ice === 'ice_slush' ? 'ice-slush' : 'open-water'));
    statusBlock.className = 'header-status-block ' + stripCls;
  }

  if (seasonMain && seasonSub) {
    if (ice === 'ice_safe') {
      seasonMain.innerHTML = `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2v20M2 12h20M4.9 4.9l14.2 14.2M19.1 4.9L4.9 19.1" stroke="#7dd3fc" stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="12" r="2.2" fill="#38bdf8"/></svg> Безопасный лёд ~${thick || 12} см`;
      seasonSub.innerHTML = `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3c0 0-6 7.1-6 11.5a6 6 0 0 0 12 0C18 10.1 12 3 12 3z" fill="rgba(56,189,248,0.32)" stroke="#38bdf8" stroke-width="1.8"/><path d="M9.5 15.5c.5 1.2 1.7 2 3 2" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg> Вода ~${wTemp}°C (${flowShort}) • Пешком разрешено`;
    } else if (ice === 'ice_danger') {
      seasonMain.innerHTML = subState === 'spring_rotten_ice'
        ? `<svg class="k-ico" style="color:var(--warn);" viewBox="0 0 24 24" fill="none"><path d="M12 3L2.5 19.5h19L12 3z" fill="rgba(245,158,11,0.24)" stroke="#f59e0b" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 9v5M12 17h.01" stroke="#fbbf24" stroke-width="2" stroke-linecap="round"/></svg> Рыхлый лёд (~${thick} см)`
        : `<svg class="k-ico" style="color:var(--warn);" viewBox="0 0 24 24" fill="none"><path d="M12 3L2.5 19.5h19L12 3z" fill="rgba(245,158,11,0.24)" stroke="#f59e0b" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 9v5M12 17h.01" stroke="#fbbf24" stroke-width="2" stroke-linecap="round"/></svg> Опасный лёд (~${thick} см)`;
      seasonSub.innerHTML = `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3c0 0-6 7.1-6 11.5a6 6 0 0 0 12 0C18 10.1 12 3 12 3z" fill="rgba(56,189,248,0.32)" stroke="#38bdf8" stroke-width="1.8"/><path d="M9.5 15.5c.5 1.2 1.7 2 3 2" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg> Вода ~${wTemp}°C • <svg class="k-ico" style="color:var(--bad);" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" fill="rgba(239,68,68,0.22)" stroke="#ef4444" stroke-width="1.9"/><path d="M6 6l12 12" stroke="#ef4444" stroke-width="2.1" stroke-linecap="round"/></svg> Выход на лёд запрещён!`;
    } else if (ice === 'ice_slush') {
      seasonMain.innerHTML = `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2v20M2 12h20M4.9 4.9l14.2 14.2M19.1 4.9L4.9 19.1" stroke="#7dd3fc" stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="12" r="2.2" fill="#38bdf8"/></svg> Забереги и редкая шуга`;
      seasonSub.innerHTML = `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3c0 0-6 7.1-6 11.5a6 6 0 0 0 12 0C18 10.1 12 3 12 3z" fill="rgba(56,189,248,0.32)" stroke="#38bdf8" stroke-width="1.8"/><path d="M9.5 15.5c.5 1.2 1.7 2 3 2" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg> Вода ~${wTemp}°C (${flowShort}) • Только с берега`;
    } else {
      seasonMain.innerHTML = `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg> Открытая вода (льда нет)`;
      seasonSub.innerHTML = `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3c0 0-6 7.1-6 11.5a6 6 0 0 0 12 0C18 10.1 12 3 12 3z" fill="rgba(56,189,248,0.32)" stroke="#38bdf8" stroke-width="1.8"/><path d="M9.5 15.5c.5 1.2 1.7 2 3 2" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg> Вода ~${wTemp}°C (${flowShort}) • Лодка и берег`;
    }
  }

  const profBtn = document.getElementById('headerProfileBtn');
  const idCodeEl = document.getElementById('headerProfileIdCode');
  const idSubEl = document.getElementById('headerProfileIdSub');
  const idAvatarEl = document.getElementById('headerProfileAvatar');
  const topAdminBtn = document.getElementById('topNavAdminBtn');
  const topNavBar = document.getElementById('topSectionNavBar');
  const okrugLabel = s.locAdmin1 || 'Регион РФ';

  if (circleModule && typeof circleModule.getCurrentFisherIdentity === 'function') {
    const ident = circleModule.getCurrentFisherIdentity(s);
    if (idCodeEl && idSubEl) {
      if (ident.isOwner) {
        idCodeEl.innerHTML = `${svgIcon('crown', '#fbbf24')} ID: ${ident.fisherId}`;
        idCodeEl.style.color = 'var(--good)';
        idSubEl.textContent = okrugLabel;
        if (idAvatarEl) idAvatarEl.innerHTML = svgIcon('crown', '#fbbf24');
        if (profBtn) profBtn.style.borderColor = 'var(--good)';
      } else if (ident.isRegistered) {
        idCodeEl.textContent = `ID: ${ident.fisherId}`;
        idCodeEl.style.color = 'var(--accent)';
        idSubEl.textContent = okrugLabel;
        if (idAvatarEl) idAvatarEl.innerHTML = svgIcon('shield', 'var(--good)');
        if (profBtn) profBtn.style.borderColor = 'var(--accent)';
      } else {
        idCodeEl.textContent = `ID: ${ident.fisherId}`;
        idCodeEl.style.color = 'var(--text)';
        idSubEl.textContent = `${okrugLabel} (Резерв)`;
        if (idAvatarEl) idAvatarEl.innerHTML = svgIcon('user');
        if (profBtn) profBtn.style.borderColor = 'var(--border)';
      }
    }
    if (topAdminBtn) {
      topAdminBtn.style.display = ident.isOwner ? '' : 'none';
    }
    if (topNavBar) {
      topNavBar.setAttribute('data-has-admin', ident.isOwner ? '1' : '0');
    }
  }
}

let _lastCommSubRoute = 'circle';

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

  const statusBlock = document.getElementById('headerStatusBlock');
  if (statusBlock) {
    statusBlock.addEventListener('click', () => {
      triggerHaptic('selection');
      router.navigate('weather');
    });
  }

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
      const modes = ['auto', 'dark', 'light', 'contrast'];
      const cur = store.getState().theme || 'auto';
      const next = modes[(modes.indexOf(cur) + 1) % modes.length];
      store.dispatch({ type: 'SET_THEME', payload: next });
      applyTheme(next, true);
    });
  }

  document.querySelectorAll('[data-settings-zone]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const zone = btn.getAttribute('data-settings-zone') || 'app';
      triggerHaptic('selection');
      fishModule.openOnboardingModal(true, zone);
    });
  });

  const sosQuickBtn = document.getElementById('bottomQuickSosBtn');
  if (sosQuickBtn) {
    sosQuickBtn.addEventListener('click', () => {
      triggerHaptic('warning');
      events.emit('circle:openShareModal', { mode: 'sos' });
    });
  }

  document.querySelectorAll('[data-nav-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-nav-tab');
      triggerHaptic('selection');
      if (tab === 'profile') {
        fishModule.openOnboardingModal(true, '');
      } else if (btn.id === 'navCircleChatsHubBtn') {
        const cur = store.getState().route;
        if (cur === 'circle') {
          _lastCommSubRoute = 'chats';
          router.navigate('chats');
        } else if (cur === 'chats') {
          _lastCommSubRoute = 'circle';
          router.navigate('circle');
        } else {
          router.navigate(_lastCommSubRoute || 'circle');
        }
      } else {
        if (tab === 'circle' || tab === 'chats') _lastCommSubRoute = tab;
        router.navigate(tab);
      }
    });
  });

  document.addEventListener('click', (e) => {
    const favEdit = e.target && e.target.closest ? e.target.closest('#fishFavEditBtn') : null;
    if (favEdit) {
      e.preventDefault();
      e.stopPropagation();
      fishModule.openFavoritesEditorModal();
    }
  });

  events.on('circle:openShareModal', (payload = {}) => {
    circleModule.openShareModalForCurrentContext(payload.mode || 'circle', payload.catchObj || null);
  });

  events.on('circle:shareCatchToChat', (payload = {}) => {
    circleModule.openShareCatchToChatModal(payload.catchObj || null);
  });
}

let cachedHeaderH = 0;
let scrollRafPending = false;

function syncHeaderLayout(forceMeasure = false) {
  const header = document.querySelector('.app-header');
  if (!header) return cachedHeaderH || 108;
  const rectH = Math.ceil(header.getBoundingClientRect().height);
  if (rectH > 30) {
    cachedHeaderH = rectH + 6;
    document.documentElement.style.setProperty('--header-h', `${cachedHeaderH}px`);
  }
  return cachedHeaderH || 108;
}

function syncFishDockState(forceMeasure = false, explicitRoute = null) {
  const headerH = syncHeaderLayout(forceMeasure);
  const hashClean = (typeof window !== 'undefined' && window.location.hash)
    ? window.location.hash.replace(/^#\/?/, '').split('?')[0].trim()
    : '';
  const activeTabRoute = (typeof document !== 'undefined')
    ? document.querySelector('.bottom-nav .nav-tab.active')?.getAttribute('data-nav-tab')
    : '';
  const route = explicitRoute || store.getState().route || activeTabRoute || hashClean || 'forecast';

  const secFish = document.getElementById('secFish');
  if (!secFish) {
    document.body.style.paddingTop = `${headerH}px`;
    return;
  }

  const cardEl = secFish.querySelector('.card, .bento-card');
  const resultsArea = document.getElementById('fishResultsArea');
  const sentinel = document.getElementById('fishDockSentinel');
  const placeholder = document.getElementById('fishStripPlaceholder');
  const dockWrap = document.getElementById('fishStripDockWrap');

  const isMiniBarRoute = ['calendar'].includes(route);

  if (isMiniBarRoute) {
    if (cardEl) {
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
    if (placeholder) {
      placeholder.style.height = '0px';
      placeholder.style.minHeight = '0px';
    }
    if (dockWrap && !dockWrap.classList.contains('docked-mini')) {
      dockWrap.classList.add('docked-mini');
    }
    document.body.style.paddingTop = `${headerH + 46}px`;
    return;
  }

  if (cardEl) {
    cardEl.setAttribute('data-dock-mode', 'full');
    Array.from(cardEl.children).forEach(ch => {
      if (ch === placeholder || ch === sentinel) return;
      if (ch.id === 'fishSearchWrap') {
        ch.style.display = 'flex';
      } else if (ch.classList.contains('fish-toolbar-onerow')) {
        ch.style.display = 'grid';
      } else if (ch.classList.contains('chip-scroll-row') || ch.classList.contains('section-head') || ch.classList.contains('bento-card-head')) {
        ch.style.display = 'flex';
      } else {
        ch.style.display = '';
      }
    });
    cardEl.style.padding = '';
    cardEl.style.border = '';
    cardEl.style.background = '';
    cardEl.style.boxShadow = '';
  }

  if (dockWrap && dockWrap.classList.contains('docked-mini')) {
    dockWrap.classList.remove('docked-mini');
  }
  if (placeholder) {
    placeholder.style.height = '';
    placeholder.style.minHeight = '';
  }
  document.body.style.paddingTop = `${headerH}px`;
}

window.syncFishDockState = syncFishDockState;

function safeInit(name, fn) {
  try {
    fn();
  } catch (err) {
    console.error(`[Bootstrap] Module ${name} init error:`, err);
  }
}

function applyIncomingDeepLinkToStore(deepLink, triggerNetworkFetch = false) {
  if (!deepLink) return;
  const hasCoords = Number.isFinite(deepLink.lat) && Number.isFinite(deepLink.lon);
  if (hasCoords) {
    const rLat = Math.round(deepLink.lat * 10000) / 10000;
    const rLon = Math.round(deepLink.lon * 10000) / 10000;
    store.dispatch({
      type: 'SET_LOCATION',
      payload: {
        lat: rLat,
        lon: rLon,
        locLabel: deepLink.city || undefined,
        locAdmin2: deepLink.city || undefined,
        hasUserLocation: true
      }
    });
    if (triggerNetworkFetch) {
      geoModule.setLocation(rLat, rLon, Boolean(deepLink.city));
    }
  } else if (deepLink.city) {
    store.dispatch({
      type: 'SET_LOCATION_LABELS',
      payload: { locLabel: deepLink.city, locAdmin2: deepLink.city }
    });
  }

  if (deepLink.fish) {
    const targetFishObj = FISH_DB.find(f => f.id === deepLink.fish);
    if (targetFishObj) {
      const st = store.getState();
      if (st.onlyFavoritesFilter && !(st.favorites || []).includes(targetFishObj.id)) {
        store.dispatch({ type: 'TOGGLE_ONLY_FAVORITES' });
      }
      if (Array.isArray(targetFishObj.waters) && targetFishObj.waters.length > 0 && !targetFishObj.waters.includes(st.water)) {
        const compatWater = targetFishObj.waters.includes('big_river') ? 'big_river' : targetFishObj.waters[0];
        store.dispatch({
          type: 'SET_WATER',
          payload: {
            water: compatWater,
            depth: WATER_PROFILES[compatWater]?.defD || 2.5,
            selectedWaterName: deepLink.water || ''
          }
        });
      } else if (deepLink.water) {
        store.dispatch({
          type: 'SET_WATER',
          payload: {
            water: st.water,
            depth: st.depth,
            selectedWaterName: deepLink.water
          }
        });
      }
      store.dispatch({ type: 'SET_FISH', payload: targetFishObj.id });
      const checkList = fishModule.getFilteredFishList(store.getState());
      if (!checkList.some(f => f.id === targetFishObj.id) && !store.getState().showAllSpecies) {
        store.dispatch({ type: 'TOGGLE_SHOW_ALL' });
      }
    }
  }
}

function bootstrapApp() {
  window.__KLEV_BOOTSTRAPPED__ = true;
  window.__KLEV_STORE__ = store;
  applyTheme(store.getState().theme || 'auto', false);
  initAutoThemeListeners();

  const earlyDeepLink = extractIncomingDeepLinkParams();
  const earlyShareToken = extractIncomingShareToken();
  if (earlyDeepLink) {
    applyIncomingDeepLinkToStore(earlyDeepLink, false);
  }

  safeInit('pwa', () => initPwa());
  safeInit('shellEvents', () => bindGlobalShellEvents());

  safeInit('weather', () => weatherModule.init(document.getElementById('secWeather')));
  safeInit('geo', () => geoModule.init(document.getElementById('secGeo')));
  safeInit('fish', () => fishModule.init(document.getElementById('secFish')));
  safeInit('forecast', () => forecastModule.init(document.getElementById('secForecast')));
  safeInit('circle', () => circleModule.init(document.getElementById('secCircle'), document.getElementById('secChats'), document.getElementById('secAdmin')));
  safeInit('calendar', () => calendarModule.init(document.getElementById('secCalendar')));
  safeInit('log', () => logModule.init(document.getElementById('secLog')));

  safeInit('router', () => { router.init(); window.__KLEV_NAVIGATE_SECTION__ = (r) => router.navigate(r); });
  safeInit('telegram', () => {
    initTelegramMiniApp(
      async (incomingToken) => {
        const imported = await circleModule.importSharePackToken(incomingToken, false);
        clearIncomingShareTokenFromUrl();
        if (imported) {
          router.navigate('circle');
        }
      },
      (deepLink) => {
        applyIncomingDeepLinkToStore(deepLink, false);
        if (Number.isFinite(deepLink.lat) && Number.isFinite(deepLink.lon) && !deepLink.city) {
          geoModule.resolveReverseGeocode(deepLink.lat, deepLink.lon);
        }
        router.navigate('forecast');
      }
    );
    const tgUser = getTelegramUser();
    if (tgUser && tgUser.displayName) {
      const curCallsign = store.getState().userProfile?.callsign;
      if (!curCallsign || curCallsign === 'Рыболов') {
        store.dispatch({ type: 'SET_USER_CALLSIGN', payload: tgUser.displayName });
      }
    }
    syncTelegramBackButton(store.getState().route || 'forecast', () => {
      if (typeof window.__KLEV_HANDLE_BACK__ === 'function' && window.__KLEV_HANDLE_BACK__('telegram')) return;
      router.navigate('forecast');
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
  if ((!curProfile || !curProfile.onboarded) && !earlyDeepLink && !earlyShareToken) {
    setTimeout(() => {
      fishModule.openOnboardingModal(false);
    }, 450);
  }

  store.subscribe(
    s => ({
      theme: s.theme,
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
      userProfile: s.userProfile,
      route: s.route
    }),
    (next, prev) => {
      if (!prev || next.theme !== prev.theme || (next.theme === 'auto' && next.weatherDays !== prev.weatherDays)) {
        applyTheme(next.theme || 'auto', false);
      }
      const curRoute = store.getState().route || 'forecast';
      updateHeaderUI();
      if (!prev || next.route !== prev.route) {
        router.applyVisibility(curRoute);
        syncTelegramBackButton(curRoute, () => {
          if (typeof window.__KLEV_HANDLE_BACK__ === 'function' && window.__KLEV_HANDLE_BACK__('telegram')) return;
          router.navigate('forecast');
        });
      }
      syncFishDockState();
    }
  );

  window.addEventListener('hashchange', async () => {
    const tok = extractIncomingShareToken();
    if (tok) {
      const imported = await circleModule.importSharePackToken(tok, false);
      clearIncomingShareTokenFromUrl();
      if (imported) router.navigate('circle');
    }
  });
  setTimeout(() => {
    const sp = document.getElementById('appSplashScreen');
    if (sp) sp.classList.add('splash-hide');
  }, 950);
  safeInit('updater', () => initReleaseUpdater());
  setTimeout(() => {
    if (circleModule && typeof circleModule.syncCurrentProfileToCloudIfLoggedIn === 'function') {
      circleModule.syncCurrentProfileToCloudIfLoggedIn().catch(() => {});
    }
  }, 1800);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrapApp);
} else {
  bootstrapApp();
}
