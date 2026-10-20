// js/app.js
import { store, bus, persist } from './core/state.js';
import { createRouter } from './core/router.js';
import { detectBasinByCoords } from './data/basin-configs.js';
import { ROUTES, THEME_MODES } from './data/constants.js';
import { icons } from './ui/components.js';

import { fishModule }     from './modules/fish/fish.module.js';
import { geoModule }      from './modules/geo/geo.module.js';
import { weatherModule }  from './modules/weather/weather.module.js';
import { forecastModule } from './modules/forecast/forecast.module.js';
import { calendarModule } from './modules/calendar/calendar.module.js';
import { logModule }      from './modules/log/log.module.js';

// ==================== HEADER ====================
function renderHeader() {
  const header = document.getElementById('app-header');
  const s = store.getState();
  const loc = s.location;
  header.innerHTML = '';

  const locBox = document.createElement('div');
  locBox.className = 'app-header__loc';
  const hierarchy = [loc.country, loc.admin1, loc.admin2].filter(Boolean).join(' • ');
  locBox.innerHTML = `
    <div class="app-header__hierarchy">${hierarchy}</div>
    <div class="app-header__title">${icons.location} ${loc.label}</div>
  `;
  const titleEl = locBox.querySelector('.app-header__title');
  titleEl.style.display = 'flex';
  titleEl.style.alignItems = 'center';
  titleEl.style.gap = '6px';
  const svg = titleEl.querySelector('svg');
  if (svg) {
    svg.style.width = '18px';
    svg.style.height = '18px';
    svg.style.color = 'var(--accent)';
    svg.style.flexShrink = '0';
  }

  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.gap = '8px';
  actions.style.alignItems = 'center';

  const themeBtn = document.createElement('button');
  themeBtn.className = 'btn btn--sm btn--ghost';
  themeBtn.type = 'button';
  themeBtn.setAttribute('aria-label', 'Переключить тему');
  themeBtn.textContent = s.theme === 'dark' ? '🌙' : s.theme === 'light' ? '☀️' : '💻';
  themeBtn.addEventListener('click', cycleTheme);

  const status = document.createElement('div');
  status.className = 'app-header__status';
  status.innerHTML = '<span class="app-header__dot"></span><span>Онлайн</span>';

  actions.append(themeBtn, status);
  header.append(locBox, actions);
}

function cycleTheme() {
  const cur = store.getState().theme;
  const next = THEME_MODES[(THEME_MODES.indexOf(cur) + 1) % THEME_MODES.length];
  persist({ theme: next });
  applyTheme(next);
  renderHeader();
}

function applyTheme(mode) {
  const eff = mode === 'auto'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : mode;
  document.documentElement.setAttribute('data-theme', eff);
  document.documentElement.setAttribute('data-theme-mode', mode);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', eff === 'dark' ? '#0b1120' : '#f1f5f9');
}

// ==================== NAV ====================
function renderNav() {
  const nav = document.getElementById('app-nav');
  nav.innerHTML = '';
  for (const r of ROUTES) {
    const item = document.createElement('a');
    item.href = '#' + r.path;
    item.className = 'app-nav__item';
    item.dataset.route = r.path;
    item.innerHTML = `
      <span class="app-nav__icon">${icons[r.icon] || ''}</span>
      <span>${r.navLabel}</span>
    `;
    nav.append(item);
  }
}

// ==================== ROUTER ====================
const router = createRouter({
  routes: [
    { path: '/fish',     title: 'Пазл рыбы',         render: (main, ctx) => fishModule.render(main, ctx) },
    { path: '/geo',      title: 'Геолокация',        render: (main, ctx) => geoModule.render(main, ctx) },
    { path: '/weather',  title: 'Погода и Луна',     render: (main, ctx) => weatherModule.render(main, ctx) },
    { path: '/forecast', title: 'Прогноз клёва',     render: (main, ctx) => forecastModule.render(main, ctx) },
    { path: '/calendar', title: 'Годовой календарь', render: (main, ctx) => calendarModule.render(main, ctx) },
    { path: '/log',      title: 'Журнал уловов',     render: (main, ctx) => logModule.render(main, ctx) }
  ],
  defaultPath: '/fish'
});

// ==================== LOCATION ====================
export function setLocation(lat, lon, meta = {}) {
  const basinCode = detectBasinByCoords(lat, lon);
  const current = store.getState().location;
  const next = {
    lat, lon,
    country: meta.country ?? current.country,
    admin1:  meta.admin1  ?? current.admin1,
    admin2:  meta.admin2  ?? current.admin2,
    label:   meta.label   ?? current.label,
    basinCode
  };
  persist({ location: next });
  renderHeader();
  bus.emit('location:changed', next);
}

// ==================== CONNECTIVITY ====================
function initConnectivity() {
  const banner = document.getElementById('app-offline');
  const update = () => { banner.hidden = navigator.onLine; };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

// ==================== GLOBAL ERRORS ====================
window.addEventListener('error', (e) => {
  console.error('[app] Uncaught:', e.error || e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[app] Unhandled rejection:', e.reason);
});

// ==================== SERVICE WORKER ====================
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.warn('[app] SW registration failed:', err);
    });
  });
}

// ==================== INIT ====================
function init() {
  applyTheme(store.getState().theme);
  renderHeader();
  renderNav();
  initConnectivity();
  router.start();
}

init();