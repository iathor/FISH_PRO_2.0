import { initReleaseUpdater, checkForReleaseUpdate } from './core/updater.js?v=2.2.0';
import { RU } from './i18n/ru.js?v=2.2.0';
import { events } from './core/events.js?v=2.2.0';
import { store } from './core/store.js?v=2.2.0';
import { router } from './core/router.js?v=2.2.0';
import { installShortcut, initPwa } from './core/pwa.js?v=2.2.0';
import {
  initTelegramMiniApp,
  extractIncomingDeepLinkParams,
  extractIncomingShareToken,
  clearIncomingShareTokenFromUrl,
  triggerHaptic,
  syncTelegramTheme,
  syncTelegramBackButton,
  getTelegramUser
} from './core/telegram.js?v=2.2.0';
import { FISH_DB } from './data/species.js?v=2.2.0';
import { WATER_PROFILES } from './data/waters.js?v=2.2.0';
import { showToast, openModal, closeModal } from './ui/components.js?v=2.2.0';
import { weatherModule } from './modules/weather/weather.module.js?v=2.2.0';
import { geoModule } from './modules/geo/geo.module.js?v=2.2.0';
import { fishModule } from './modules/fish/fish.module.js?v=2.2.0';
import { forecastModule } from './modules/forecast/forecast.module.js?v=2.2.0';
import { calendarModule } from './modules/calendar/calendar.module.js?v=2.2.0';
import { logModule } from './modules/log/log.module.js?v=2.2.0';
import { circleModule } from './modules/circle/circle.module.js?v=2.2.0';

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

// Переменная для отслеживания живого переключения системной/Telegram темы в режиме «Авто»
let _liveSystemSchemeOverride = null;

/**
 * Вычисляет эффективную тему ('light' | 'dark') для режима «Авто» во всех 3 средах:
 * - В браузере, Android APK WebView и Telegram Mini App:
 *   использует астрономический световой день в точке лова (восход sunriseHr .. закат sunsetHr, по умолчанию 07:00–20:00),
 *   а также мгновенно реагирует на живое переключение системной темы ОС или темы Telegram!
 */
export function resolveEffectiveTheme(themeMode) {
  if (themeMode === 'dark') return { effective: 'dark', sunriseHr: 7, sunsetHr: 20 };
  if (themeMode === 'light') return { effective: 'light', sunriseHr: 7, sunsetHr: 20 };

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
  const mode = ['auto', 'dark', 'light'].includes(themeMode) ? themeMode : 'auto';
  if (mode !== 'auto') {
    _liveSystemSchemeOverride = null;
  }
  const { effective, sunriseHr, sunsetHr } = resolveEffectiveTheme(mode);
  const root = document.documentElement;
  root.setAttribute('data-theme', effective);
  root.setAttribute('data-theme-mode', mode);
  syncTelegramTheme(effective);

  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute('content', effective === 'dark' ? '#0b1120' : '#f1f5f9');

  const btn = document.getElementById('headerThemeBtn');
  if (btn) {
    btn.textContent = mode === 'auto' ? '🌓' : (mode === 'dark' ? '🌙' : '☀️');
  }

  if (showNotificationToast) {
    if (mode === 'auto') {
      showToast(
        `🌓 Тема «Авто»: сейчас ${effective === 'light' ? '☀️ День (Светлая)' : '🌙 Ночь (Тёмная)'} • автосмена по восходу (${String(sunriseHr).padStart(2, '0')}:00) и закату (${String(sunsetHr).padStart(2, '0')}:00)`,
        'good'
      );
    } else if (mode === 'dark') {
      showToast('🌙 Включена Тёмная (ночная) тема', 'info');
    } else {
      showToast('☀️ Включена Светлая (дневная) тема', 'info');
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

  // Автопроверка перехода восход/закат каждые 60 секунд для режима «Авто»
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

  const profBtn = document.getElementById('headerProfileBtn');
  const navAdminBtn = document.getElementById('navAdminTabBtn');
  const navMoreAdminBtn = document.getElementById('navMoreAdminItem');
  if (circleModule && typeof circleModule.getCurrentFisherIdentity === 'function') {
    const ident = circleModule.getCurrentFisherIdentity(s);
    if (profBtn) {
      if (ident.isOwner) {
        profBtn.textContent = `👑 ${ident.fisherId}`;
        profBtn.style.borderColor = 'var(--good)';
        profBtn.style.color = 'var(--good)';
      } else if (ident.isRegistered) {
        profBtn.textContent = `🟢 ${ident.fisherId}`;
        profBtn.style.borderColor = 'var(--accent)';
        profBtn.style.color = 'var(--accent)';
      } else {
        profBtn.textContent = `🟡 ${ident.fisherId} • Войти`;
        profBtn.style.borderColor = 'var(--warn)';
        profBtn.style.color = 'var(--warn)';
      }
    }
    if (navAdminBtn) {
      navAdminBtn.style.display = ident.isOwner ? '' : 'none';
    }
    if (navMoreAdminBtn) {
      navMoreAdminBtn.style.display = ident.isOwner ? '' : 'none';
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
      applyTheme(next, true);
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
      if (willOpen && typeof window.__KLEV_PUSH_BACK_GUARD__ === 'function') {
        window.__KLEV_PUSH_BACK_GUARD__('morePopup');
      }
    });
    document.addEventListener('click', (e) => {
      if (!morePopup.contains(e.target) && e.target !== moreBtn) {
        closeMorePopup();
      }
    });
    const closeMoreBottomBtn = document.getElementById('navMoreCloseBottomBtn');
    if (closeMoreBottomBtn) {
      closeMoreBottomBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeMorePopup();
      });
    }
  }

  document.querySelectorAll('[data-settings-zone]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const zone = btn.getAttribute('data-settings-zone') || '';
      closeMorePopup();
      triggerHaptic('selection');
      fishModule.openOnboardingModal(true, zone);
    });
  });

  document.querySelectorAll('[data-nav-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-nav-tab');
      closeMorePopup();
      triggerHaptic('selection');
      if (tab === 'profile') {
        fishModule.openOnboardingModal(true, '');
      } else {
        router.navigate(tab);
      }
    });
  });

  // Делегированный перехватчик для кнопки «✎ Список» (#fishFavEditBtn) во вкладке РЫБЫ (100% надёжность)
  document.addEventListener('click', (e) => {
    const favEdit = e.target && e.target.closest ? e.target.closest('#fishFavEditBtn') : null;
    if (favEdit) {
      e.preventDefault();
      e.stopPropagation();
      fishModule.openFavoritesEditorModal();
    }
  });

  // Глобальное событие вызова окна шаринга в Круг / Экипаж / Мастерскую
  events.on('circle:openShareModal', (payload = {}) => {
    circleModule.openShareModalForCurrentContext(payload.mode || 'circle', payload.catchObj || null);
  });

  // Глобальное событие отправки улова в Чат
  events.on('circle:shareCatchToChat', (payload = {}) => {
    circleModule.openShareCatchToChatModal(payload.catchObj || null);
  });
}

// ==========================================
// DYNAMIC HEADER HEIGHT & SMOOTH SHRINKING FISH BUTTONS (MINIATURES ON SCROLL & FORECAST TAB)
// ==========================================
let cachedHeaderH = 0;
let cachedFullDockH = 212;
let scrollRafPending = false;

function syncHeaderLayout(forceMeasure = false) {
  const header = document.querySelector('.app-header');
  if (!header) return cachedHeaderH || 76;
  const rectH = Math.ceil(header.getBoundingClientRect().height);
  if (rectH > 30) {
    cachedHeaderH = rectH + 4;
    document.documentElement.style.setProperty('--header-h', `${cachedHeaderH}px`);
  }
  return cachedHeaderH || 76;
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

  const cardEl = secFish.querySelector('.card');
  const resultsArea = document.getElementById('fishResultsArea');
  const sentinel = document.getElementById('fishDockSentinel');
  const placeholder = document.getElementById('fishStripPlaceholder');
  const dockWrap = document.getElementById('fishStripDockWrap');

  const isMiniBarRoute = ['forecast', 'calendar'].includes(route);

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

  // На вкладке «🐟 Рыбы» (и всех остальных вкладках кроме Прогноза/Календаря)
  // ВСЕГДА раскрываем полный каркас справочника рыб (поиск, кнопки Избранное/Список/Весь атлас, группы и полные карточки)!
  if (cardEl) {
    cardEl.setAttribute('data-dock-mode', 'full');
    Array.from(cardEl.children).forEach(ch => {
      if (ch === placeholder || ch === sentinel) return;
      if (ch.id === 'fishSearchWrap') {
        ch.style.display = 'flex';
      } else if (ch.classList.contains('fish-toolbar-onerow')) {
        ch.style.display = 'grid';
      } else if (ch.classList.contains('chip-scroll-row') || ch.classList.contains('section-head')) {
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

  const isCleanSlateFirstRun = (() => {
    try {
      if (typeof localStorage !== 'undefined' && localStorage.getItem('klev_pro_clean_slate_notice_v2_1_2_r4') === '1') {
        localStorage.removeItem('klev_pro_clean_slate_notice_v2_1_2_r4');
        return true;
      }
    } catch (e) {}
    return false;
  })();

  if (isCleanSlateFirstRun) {
    if (typeof caches !== 'undefined' && typeof caches.keys === 'function') {
      caches.keys().then(keys => {
        keys.forEach(k => {
          if (!k.includes('2.2.0')) caches.delete(k).catch(() => {});
        });
      }).catch(() => {});
    }
    setTimeout(() => {
      const ident = circleModule.getCurrentFisherIdentity(store.getState());
      const cleanSlateHtml = `
        <div style="display:flex;flex-direction:column;gap:12px;font-size:var(--fs-sm);line-height:1.48;">
          <div style="padding:12px;background:rgba(16,185,129,0.10);border:1.5px solid var(--good);border-radius:var(--r-sm);">
            <div style="font-weight:900;font-size:var(--fs-md);color:var(--good);margin-bottom:4px;">
              🚀 Экосистема «Клёв ПРО» обновлена до версии V.2.2.0!
            </div>
            <div style="font-size:var(--fs-xs);color:var(--text);">
              Для перехода на новую серверную архитектуру и устранения конфликтов старых сборок выполнен автоматический <b>сброс устаревшего кэша и настроек («С чистого листа»)</b>.
            </div>
          </div>

          <div class="card" style="background:var(--card);padding:10px 12px;border:1px solid var(--border);display:flex;flex-direction:column;gap:8px;font-size:var(--fs-xs);">
            <div>🆔 <b>Ваш уникальный серверный ID рыбака:</b> <span class="fisher-id-copy-badge" data-copy-fisher-id="${ident.fisherId}" style="font-family:monospace;font-weight:900;color:var(--accent);cursor:pointer;">${ident.fisherId} 📋</span></div>
            <div>📡 <b>Живой радар «Круга» и «Экипажей»:</b> все опубликованные точки Круга (±5 км), закрытые Экипажи (по ключу <code>KP-XXXX</code>) и сигналы SOS теперь мгновенно синхронизируются между всеми устройствами через сервер.</div>
            <div>🔑 <b>Сквозной профиль:</b> если у вас уже есть Логин и Пароль, нажмите кнопку входа ниже, чтобы мгновенно восстановить свой профиль и ID.</div>
          </div>

          <div style="display:grid;grid-template-columns:1fr;gap:8px;margin-top:2px;">
            <button type="button" class="btn btn-accent" id="cleanSlateSignInBtn" style="width:100%;font-weight:800;">
              🔑 Войти по Логину и Паролю (Восстановить профиль)
            </button>
            <button type="button" class="btn btn-good" id="cleanSlateSetupBtn" style="width:100%;font-weight:800;">
              🎯 Настроить водоём, снасти и начать с чистого листа
            </button>
          </div>
        </div>
      `;
      openModal('🚀 Обновление V.2.2.0 («С чистого листа»)', cleanSlateHtml, (bodyEl) => {
        bodyEl.querySelector('#cleanSlateSignInBtn')?.addEventListener('click', () => {
          closeModal();
          circleModule.openAuthAndBackupModal();
        });
        bodyEl.querySelector('#cleanSlateSetupBtn')?.addEventListener('click', () => {
          closeModal();
          fishModule.openOnboardingModal(false);
        });
      });
    }, 450);
  } else {
    const curProfile = store.getState().userProfile;
    if ((!curProfile || !curProfile.onboarded) && !earlyDeepLink && !earlyShareToken) {
      setTimeout(() => {
        fishModule.openOnboardingModal(false);
      }, 450);
    }
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
