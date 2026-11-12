import { storage } from './core/storage.js?v=2.9.2-r237';
import { svgIcon } from './ui/icons.js?v=2.9.2-r237';
import { initReleaseUpdater, checkForReleaseUpdate } from './core/updater.js?v=2.9.2-r237';
import { RU } from './i18n/ru.js?v=2.9.2-r237';
import { events } from './core/events.js?v=2.9.2-r237';
import { store } from './core/store.js?v=2.9.2-r237';
import { router } from './core/router.js?v=2.9.2-r237';
import { installShortcut, initPwa } from './core/pwa.js?v=2.9.2-r237';
import {
  initTelegramMiniApp,
  extractIncomingDeepLinkParams,
  extractIncomingShareToken,
  clearIncomingShareTokenFromUrl,
  triggerHaptic,
  syncTelegramTheme,
  syncTelegramBackButton,
  getTelegramUser
} from './core/telegram.js?v=2.9.2-r237';
import { FISH_DB } from './data/species.js?v=2.9.2-r237';
import { WATER_PROFILES } from './data/waters.js?v=2.9.2-r237';
import { showToast, openModal, closeModal } from './ui/components.js?v=2.9.2-r237';
import { weatherModule } from './modules/weather/weather.module.js?v=2.9.2-r237';
import { geoModule } from './modules/geo/geo.module.js?v=2.9.2-r237';
import { fishModule } from './modules/fish/fish.module.js?v=2.9.2-r237';
import { forecastModule } from './modules/forecast/forecast.module.js?v=2.9.2-r237';
import { calendarModule } from './modules/calendar/calendar.module.js?v=2.9.2-r237';
import { logModule } from './modules/log/log.module.js?v=2.9.2-r237';
import { circleModule } from './modules/circle/circle.module.js?v=2.9.2-r237';
if (typeof window !== 'undefined') {
  window.__KLEV_BOOTSTRAPPED__ = true;
  window.__KLEV_STORE__ = store;
}
window.addEventListener('message', (e) => { if (e && e.data === 'klev_close_admin_console') closeModal(); });
const CLIENT_ERROR_LOG_KEY = 'klev_pro_client_error_log_v1';

export function getClientErrorTelemetryLog() {
  try {
    const raw = localStorage.getItem(CLIENT_ERROR_LOG_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (_e) {
    return [];
  }
}

export function clearClientErrorTelemetryLog() {
  try {
    localStorage.removeItem(CLIENT_ERROR_LOG_KEY);
  } catch (_e) {}
  return [];
}


export function getClientEnvironmentLabel() {
  try {
    if (typeof window === 'undefined') return 'unknown';
    const host = (window.location?.hostname || '').toLowerCase();
    const ua = navigator.userAgent || '';
    if (host.endsWith('androidplatform.net') || /;\s*wv\)|KlevProAPK/i.test(ua) || (typeof document !== 'undefined' && document.documentElement.getAttribute('data-apk-webview') === '1') || typeof window.AndroidBridge !== 'undefined') {
      return 'apk';
    }
    const twa = window.Telegram && window.Telegram.WebApp;
    if (twa && ((typeof twa.initData === 'string' && twa.initData.length > 0) || (twa.initDataUnsafe && twa.initDataUnsafe.user) || (twa.platform && twa.platform !== 'unknown'))) {
      return 'tma';
    }
    const hash = window.location.hash || '';
    const search = window.location.search || '';
    if (hash.includes('tgWebAppData') || search.includes('tgWebAppStartParam') || search.includes('tg_city=') || search.includes('tg_fish=')) {
      return 'tma';
    }
    const isStandalone = (window.navigator && window.navigator.standalone === true) ||
      (typeof document !== 'undefined' && document.referrer && document.referrer.includes('android-app://')) ||
      (window.matchMedia && (
        window.matchMedia('(display-mode: standalone)').matches ||
        window.matchMedia('(display-mode: fullscreen)').matches ||
        window.matchMedia('(display-mode: minimal-ui)').matches ||
        window.matchMedia('(display-mode: window-controls-overlay)').matches
      ));
    if (isStandalone) {
      return 'pwa';
    }
    const docEl = typeof document !== 'undefined' ? document.documentElement : null;
    const layoutMode = docEl ? (docEl.getAttribute('data-device-layout') || '') : '';
    const w = window.innerWidth || (docEl ? docEl.clientWidth : 1024);
    const h = window.innerHeight || (docEl ? docEl.clientHeight : 768);
    if (layoutMode === 'desktop-tablet' || (w >= 900 && h > 540)) {
      return 'desktop';
    }
    return 'web';
  } catch (_e) {
    return 'web';
  }
}

export function getCurrentUserForTelemetry() {
  try {
    const s = (typeof store !== 'undefined' && store.getState) ? store.getState() : null;
    const up = s?.userProfile || {};
    const rawFid = String(up.fisherId || '').trim().toUpperCase();
    const login = String(up.login || up.callsign || '').trim();
    const isOwner = Boolean(
      typeof window !== 'undefined' &&
      window.__KLEV_ADMIN_CONTOUR__ === true &&
      up.ownerUnlocked &&
      up.adminSessionToken
    );
    const isTemp = Boolean(!rawFid || /^FP_\d{2}RZ\d{4}$/i.test(rawFid) || up.isTemporaryReserve);
    const isRegistered = Boolean(isOwner || (!isTemp && login && login !== 'Рыболов'));
    return {
      fisherId: rawFid || (isOwner ? 'FP_89VIP089' : 'FP_89RZ0001'),
      login: login || (isOwner ? 'iAthor' : (isTemp ? 'Гость (Резерв)' : 'Рыболов')),
      isOwner,
      isRegistered,
      isTemporaryReserve: isTemp
    };
  } catch (_e) {
    return {
      fisherId: 'FP_89RZ0001',
      login: 'Гость',
      isOwner: false,
      isRegistered: false,
      isTemporaryReserve: true
    };
  }
}

export function recordClientErrorTelemetry(type, message, sourceOrStack = '') {
  try {
    const msgStr = String(message || 'Unknown error').slice(0, 240);
    // Игнорируем штатные сетевые таймауты анти-DPI шлюзов, AbortController и ResizeObserver, чтобы не засорять телеметрию
    if (/Offline simulated|Failed to fetch|NetworkError|Load failed|AbortError|aborted|All promises were rejected|AggregateError|ResizeObserver|Script error/i.test(msgStr)) {
      return null;
    }
    const list = getClientErrorTelemetryLog();
    const envLabel = getClientEnvironmentLabel();
    const uInfo = getCurrentUserForTelemetry();

    const entry = {
      id: `ERR_${Date.now()}_${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      ts: Date.now(),
      type: String(type || 'error'),
      msg: msgStr,
      src: String(sourceOrStack || '').slice(0, 220),
      route: String(window.location?.hash || '#/forecast'),
      ver: '2.9.2-r237',
      env: envLabel,
      fisherId: uInfo.fisherId,
      login: uInfo.login,
      isOwner: uInfo.isOwner,
      isRegistered: uInfo.isRegistered,
      isTemporaryReserve: uInfo.isTemporaryReserve,
      notifyMode: 'admin_console_telemetry_only',
      ua: String(navigator.userAgent || '').slice(0, 90)
    };
    list.unshift(entry);
    localStorage.setItem(CLIENT_ERROR_LOG_KEY, JSON.stringify(list.slice(0, 30)));

    // Отправка в раздел «4.3 Телеметрия ошибок клиента» через анти-DPI шлюз workerFetch (БЕЗ засорения личных чатов и пуш-уведомлений!)
    if (typeof navigator !== 'undefined' && navigator.onLine && circleModule && typeof circleModule.workerFetch === 'function') {
      circleModule.workerFetch('/api/telemetry/client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry)
      }, 5500, 0).catch(() => {});
    }

    return entry;
  } catch (_e) {
    return null;
  }
}

function notifyAdminViaChatFromUser(entry, uInfo) {
  try {
    if (typeof window === 'undefined') return;
    const s = (typeof store !== 'undefined' && store.getState) ? store.getState() : null;
    const myFid = uInfo.fisherId || 'FP_89AAA001';
    const myLogin = uInfo.login || 'Рыболов';
    const canonicalChan = `dm:${[myFid, 'FP_89VIP089'].sort().join(':')}`;
    const envUpper = String(entry.env || 'web').toUpperCase();
    const reportText = `[Авто-отчёт об ошибке]: На клиенте ${envUpper} произошёл сбой: «${entry.msg}» (модуль: ${entry.src || entry.route}). Мой ID: ${myFid}`;

    const curMsgs = Array.isArray(s?.chatMessages) ? [...s.chatMessages] : [];
    if (!curMsgs.some(m => m && m.id === `sys_err_${entry.id}`)) {
      const updated = [...curMsgs, {
        id: `sys_err_${entry.id}`,
        channelId: canonicalChan,
        peerId: 'FP_89VIP089',
        peerName: 'Админ («Клёв ПРО»)',
        senderId: myFid,
        senderName: myLogin,
        text: reportText,
        ts: entry.ts,
        e2ee: true,
        unread: false
      }];
      if (typeof storage !== 'undefined' && storage.saveChatMessages) {
        storage.saveChatMessages(updated);
      }
      if (typeof store !== 'undefined' && store.dispatch) {
        store.dispatch({ type: 'SET_CHAT_MESSAGES', payload: updated });
        store.dispatch({ type: 'RESTORE_CHAT_CHANNEL', payload: canonicalChan });
      }
    }

    if (circleModule && typeof circleModule.sendFishermanChatMessage === 'function') {
      circleModule.sendFishermanChatMessage({
        channelId: canonicalChan,
        text: reportText,
        peerId: 'FP_89VIP089'
      }).catch(() => {});
    }
  } catch (err) {
    console.error('Error in notifyAdminViaChatFromUser:', err);
  }
}

if (typeof window !== 'undefined') {
  window.__KLEV_GET_CLIENT_ERRORS__ = getClientErrorTelemetryLog;
  window.__KLEV_CLEAR_CLIENT_ERRORS__ = clearClientErrorTelemetryLog;
  window.__KLEV_RECORD_CLIENT_ERROR__ = recordClientErrorTelemetry;
  window.__KLEV_GET_CLIENT_ENV__ = getClientEnvironmentLabel;
}

window.addEventListener('error', (e) => {
  console.error('[Global Error]:', e.error || e.message);
  recordClientErrorTelemetry(
    'runtime_error',
    e.message || (e.error && e.error.message) || 'Runtime Error',
    `${e.filename || ''}:${e.lineno || 0}:${e.colno || 0}`
  );
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[Unhandled Rejection]:', e.reason);
  const rMsg = e.reason ? (e.reason.message || String(e.reason)) : 'Unhandled Promise Rejection';
  recordClientErrorTelemetry('unhandled_rejection', rMsg, (e.reason && e.reason.stack) ? String(e.reason.stack).slice(0, 180) : '');
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
      const fmtSunClock = (hrVal) => {
        const totMin = Math.max(0, Math.round((Number(hrVal) || 0) * 60));
        const hh = String(Math.floor(totMin / 60) % 24).padStart(2, '0');
        const mm = String(totMin % 60).padStart(2, '0');
        return `${hh}:${mm}`;
      };
      showToast(
        `Тема «Авто»: сейчас ${effective === 'light' ? 'День (Светлая)' : 'Ночь (Тёмная)'} • восход ${fmtSunClock(sunriseHr)}, закат ${fmtSunClock(sunsetHr)}`,
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
export function applyLiquidGlassMode(enabled, showNotificationToast = false) {
  const isOn = enabled !== false;
  document.documentElement.setAttribute('data-liquid-glass', isOn ? '1' : '0');
  const lgBtn = document.getElementById('headerLiquidGlassBtn');
  if (lgBtn) {
    lgBtn.classList.toggle('liquid-glass-active', isOn);
    lgBtn.style.borderColor = isOn ? 'var(--accent)' : 'var(--border)';
    lgBtn.style.opacity = isOn ? '1' : '0.68';
    lgBtn.title = isOn
      ? 'Эффект «Жидкое стекло»: ВКЛЮЧЁН (нажмите для возврата к классической отрисовке)'
      : 'Эффект «Жидкое стекло»: ВЫКЛЮЧЕН (классическая отрисовка • нажмите для включения)';
  }
  if (showNotificationToast) {
    showToast(
      isOn
        ? ' Включён эффект «Жидкое стекло» (Liquid Glass) на кнопках и панелях'
        : ' Эффект «Жидкое стекло» отключён — включена классическая отрисовка компонентов',
      isOn ? 'good' : 'info'
    );
  }
}
if (typeof window !== 'undefined') {
  window.__KLEV_APPLY_LIQUID_GLASS__ = applyLiquidGlassMode;
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
    statusDot.innerHTML = isOff ? `${svgIcon('radar', 'var(--warn)')}` : `${svgIcon('dot', 'var(--good)')}`;
    statusDot.style.padding = '1px 3px';
    statusDot.title = isOff ? 'Офлайн-режим' : 'Онлайн';
  }
  const day = s.weatherDays?.[s.dayIdx] || s.weatherDays?.[2] || s.weatherDays?.[0];
  const ice = day?.iceState || s.iceState || 'open_water';
  const thick = day?.iceThickness ?? s.iceThickness ?? 0;
  const subState = day?.iceSubState || '';
  const wTemp = day?.waterTemp ?? 8;
  const prof = WATER_PROFILES[s.water] || WATER_PROFILES.small_river;
  const flowShort = prof.flow >= 1.8 ? 'быстрое теч.' : (prof.flow >= 1.1 ? 'умеренное теч.' : 'стоячая вода');
  if (topWeatherIco && topWeatherLbl) {
    if (ice === 'ice_safe' || ice === 'ice_danger') {
      topWeatherIco.innerHTML = svgIcon('snow');
      topWeatherLbl.textContent = 'Погода';
    } else if (ice === 'ice_slush') {
      topWeatherIco.innerHTML = svgIcon('wave');
      topWeatherLbl.textContent = 'Погода';
    } else {
      topWeatherIco.innerHTML = svgIcon('weather');
      topWeatherLbl.textContent = 'Погода';
    }
  }
  if (statusBlock) {
    const stripCls = ice === 'ice_safe'
      ? 'ice-safe'
      : (ice === 'ice_danger' ? 'ice-danger' : (ice === 'ice_slush' ? 'ice-slush' : 'open-water'));
    statusBlock.className = 'header-status-block ' + stripCls;
  }
  if (seasonMain && seasonSub) {
    if (typeof window !== 'undefined' && window.__KLEV_ADMIN_CONTOUR__ === true) {
      seasonMain.textContent = 'КЛЁВ ПРО АДМИН';
      seasonSub.innerHTML = '<span>Консоль D1 • Управление • 152-ФЗ</span>';
      if (statusBlock) {
        statusBlock.classList.remove('ice-mode');
        statusBlock.classList.add('open-water');
      }
    } else
    if (ice === 'ice_safe') {
      seasonMain.innerHTML = `Лёд ~${thick || 12} см`;
      seasonSub.innerHTML = `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3c0 0-6 7.1-6 11.5a6 6 0 0 0 12 0C18 10.1 12 3 12 3z" fill="rgba(56,189,248,0.32)" stroke="#38bdf8" stroke-width="1.8"/><path d="M9.5 15.5c.5 1.2 1.7 2 3 2" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg><span>Вода ~${wTemp}°C</span>`;
    } else if (ice === 'ice_danger') {
      seasonMain.innerHTML = subState === 'spring_rotten_ice' ? `Рыхлый ~${thick} см` : `Опасный ~${thick} см`;
      seasonSub.innerHTML = `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3c0 0-6 7.1-6 11.5a6 6 0 0 0 12 0C18 10.1 12 3 12 3z" fill="rgba(56,189,248,0.32)" stroke="#38bdf8" stroke-width="1.8"/><path d="M9.5 15.5c.5 1.2 1.7 2 3 2" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg><span>Вода ~${wTemp}°C</span>`;
    } else if (ice === 'ice_slush') {
      seasonMain.innerHTML = `Шуга / Забереги`;
      seasonSub.innerHTML = `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3c0 0-6 7.1-6 11.5a6 6 0 0 0 12 0C18 10.1 12 3 12 3z" fill="rgba(56,189,248,0.32)" stroke="#38bdf8" stroke-width="1.8"/><path d="M9.5 15.5c.5 1.2 1.7 2 3 2" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg><span>Вода ~${wTemp}°C</span>`;
    } else {
      seasonMain.innerHTML = `Чистая вода`;
      seasonSub.innerHTML = `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3c0 0-6 7.1-6 11.5a6 6 0 0 0 12 0C18 10.1 12 3 12 3z" fill="rgba(56,189,248,0.32)" stroke="#38bdf8" stroke-width="1.8"/><path d="M9.5 15.5c.5 1.2 1.7 2 3 2" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg><span>Вода ~${wTemp}°C</span>`;
    }
  }
  const profBtn = document.getElementById('headerProfileBtn');
  const idCodeEl = document.getElementById('headerProfileIdCode');
  const idSubEl = document.getElementById('headerProfileIdSub');
  const idAvatarEl = document.getElementById('headerProfileAvatar');
  const topAdminBtn = document.getElementById('topNavAdminBtn');
  const topNavBar = document.getElementById('topSectionNavBar');
  const okrugLabel = s.locAdmin1 || 'Регион РФ';
  if (circleModule && typeof circleModule.syncMobileGuestDomState === 'function') {
    circleModule.syncMobileGuestDomState(s);
  }
  if (circleModule && typeof circleModule.getCurrentFisherIdentity === 'function') {
    const ident = circleModule.getCurrentFisherIdentity(s);
    if (idCodeEl && idSubEl) {
      if (ident.isOwner) {
        idCodeEl.textContent = `ID: ${ident.fisherId}`;
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
    const showAdm = Boolean(typeof window !== 'undefined' && window.__KLEV_ADMIN_CONTOUR__ === true);
    if (topAdminBtn) {
      topAdminBtn.style.display = showAdm ? '' : 'none';
    }
    if (topNavBar) {
      topNavBar.setAttribute('data-has-admin', showAdm ? '1' : '0');
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
      if (typeof window !== 'undefined' && window.__KLEV_ADMIN_CONTOUR__ === true) {
        if (circleModule && typeof circleModule.fetchSuperAdminDashboardData === 'function') {
          circleModule.fetchSuperAdminDashboardData(true);
        }
        return;
      }
      if (circleModule && typeof circleModule.isMobileGuestRestricted === 'function' && circleModule.isMobileGuestRestricted()) {
        circleModule.promptMobileGuestAuth('Сначала войдите в аккаунт — подробная метеосводка и радар льда доступны после авторизации');
        return;
      }
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
      if (typeof window !== 'undefined' && window.__KLEV_ADMIN_CONTOUR__ === true) {
        router.navigate('admin');
        if (circleModule && typeof circleModule.switchAdminWorkspaceTab === 'function') {
          circleModule.switchAdminWorkspaceTab('dashboard');
        }
        return;
      }
      if (circleModule && typeof circleModule.isMobileGuestRestricted === 'function' && circleModule.isMobileGuestRestricted()) {
        circleModule.openAuthAndBackupModal();
        return;
      }
      fishModule.openOnboardingModal(true);
    });
  }
  const lgBtn = document.getElementById('headerLiquidGlassBtn');
  if (lgBtn) {
    lgBtn.addEventListener('click', () => {
      triggerHaptic('selection');
      const cur = store.getState().liquidGlass !== false;
      const next = !cur;
      store.dispatch({ type: 'SET_LIQUID_GLASS', payload: next });
      applyLiquidGlassMode(next, true);
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
      if (typeof window !== 'undefined' && typeof window.__KLEV_IS_MOBILE_MAP_MODE__ === 'function' && !window.__KLEV_IS_MOBILE_MAP_MODE__()) {
        showToast('Подача сигнала SOS доступна только с мобильных устройств. На ПК сигналы SOS доступны для просмотра на карте.', 'info');
        return;
      }
      triggerHaptic('warning');
      if (circleModule && typeof circleModule.isMobileGuestRestricted === 'function' && circleModule.isMobileGuestRestricted()) {
        circleModule.promptMobileGuestAuth('Сначала войдите в аккаунт — отправка экстренного сигнала SOS и работа с Экипажем доступны после авторизации');
        return;
      }
      events.emit('circle:openShareModal', { mode: 'sos' });
    });
  }
  document.querySelectorAll('[data-nav-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-nav-tab');
      triggerHaptic('selection');
      if (circleModule && typeof circleModule.isMobileGuestRestricted === 'function' && circleModule.isMobileGuestRestricted()) {
        if (!['forecast', 'geo', 'weather', 'fish', 'calendar', 'profile', 'admin'].includes(tab)) {
          circleModule.promptMobileGuestAuth('Сначала войдите в аккаунт — разделы «Чаты·Круг», «SOS» и «Журнал» доступны после регистрации постоянного ID');
          return;
        }
      }
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
  const isMiniBarRoute = false;
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
  applyLiquidGlassMode(store.getState().liquidGlass !== false, false);
  initAutoThemeListeners();
  const earlyDeepLink = extractIncomingDeepLinkParams();
  const earlyShareToken = extractIncomingShareToken();
  if (earlyDeepLink) {
    applyIncomingDeepLinkToStore(earlyDeepLink, false);
  }
  try {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }
    window.scrollTo(0, 0);
  } catch (_e) {}
  safeInit('router', () => { router.init(); window.__KLEV_NAVIGATE_SECTION__ = (r) => router.navigate(r); });
  safeInit('pwa', () => initPwa());
  safeInit('shellEvents', () => bindGlobalShellEvents());
  safeInit('weather', () => weatherModule.init(document.getElementById('secWeather')));
  safeInit('geo', () => geoModule.init(document.getElementById('secGeo')));
  safeInit('fish', () => fishModule.init(document.getElementById('secFish')));
  safeInit('forecast', () => forecastModule.init(document.getElementById('secForecast')));
  safeInit('circle', () => circleModule.init(document.getElementById('secCircle'), document.getElementById('secChats'), document.getElementById('secAdmin')));
  safeInit('calendar', () => calendarModule.init(document.getElementById('secCalendar')));
  safeInit('log', () => logModule.init(document.getElementById('secLog')));
  try {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    document.documentElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
  } catch (_e) {}
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
  if (typeof window !== 'undefined' && window.__KLEV_ADMIN_CONTOUR__ === true) {
    router.navigate('admin');
    if (circleModule && typeof circleModule.renderAdminSection === 'function') {
      circleModule.renderAdminSection();
    }
    document.addEventListener('click', (e) => {
      const tabBtn = e.target && e.target.closest ? e.target.closest('[data-adm-workspace-tab]') : null;
      if (!tabBtn) return;
      e.preventDefault();
      e.stopPropagation();
      const tabId = tabBtn.getAttribute('data-adm-workspace-tab') || 'dashboard';
      triggerHaptic('selection');
      router.navigate('admin');
      if (circleModule && typeof circleModule.switchAdminWorkspaceTab === 'function') {
        circleModule.switchAdminWorkspaceTab(tabId);
      }
    });
  } else if (circleModule && typeof circleModule.checkAndEnforcePolicyVersionOnStartup === 'function') {
    circleModule.checkAndEnforcePolicyVersionOnStartup();
  }
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
    if (circleModule && typeof circleModule.syncMobileGuestDomState === 'function') {
      circleModule.syncMobileGuestDomState();
    }
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
  const isMobGuestStartup = circleModule && typeof circleModule.isMobileGuestRestricted === 'function' && circleModule.isMobileGuestRestricted();
  const isAdmContour = Boolean(typeof window !== 'undefined' && window.__KLEV_ADMIN_CONTOUR__ === true);
  if (!isAdmContour && (!curProfile || !curProfile.onboarded) && !earlyDeepLink && !earlyShareToken && !isMobGuestStartup) {
    setTimeout(() => {
      if (circleModule && typeof circleModule.isMobileGuestRestricted === 'function' && circleModule.isMobileGuestRestricted()) return;
      fishModule.openOnboardingModal(false);
    }, 450);
  }
  store.subscribe(
    s => ({
      theme: s.theme,
      liquidGlass: s.liquidGlass,
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
      if (!prev || next.liquidGlass !== prev.liquidGlass) {
        applyLiquidGlassMode(next.liquidGlass !== false, false);
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
  }, 7000);
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