import { createStore } from './core/store.js';
import { createBus } from './core/events.js';
import { createRouter } from './core/router.js';
import { ls } from './core/storage.js';
import { fmt } from './core/format.js';
import { DEFAULT_LOCATION, ROUTES, THEME_MODES } from './data/constants.js';
import { detectBasinByCoords, getBasinName } from './data/basin-configs.js';
import { icons } from './ui/components.js';

import { fishModule } from './modules/fish/fish.module.js';
import { geoModule } from './modules/geo/geo.module.js';
import { weatherModule } from './modules/weather/weather.module.js';
import { forecastModule } from './modules/forecast/forecast.module.js';
import { calendarModule } from './modules/calendar/calendar.module.js';
import { logModule } from './modules/log/log.module.js';

// === Globals ===
export const bus = createBus();
export const store = createStore({
  location: ls.get('location', DEFAULT_LOCATION),
  theme: ls.get('theme', 'auto'),
  water: ls.get('water', 'small_river'),
  depth: ls.get('depth', 1.2),
  method: ls.get('method', 'spin_micro'),
  fishId: ls.get('fishId', 'pike'),
  dayIdx: ls.get('dayIdx', 0),
  weather: null,
  forecast: null
});

// === Header render ===
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
  locBox.querySelector('.app-header__title').style.display = 'flex';
  locBox.querySelector('.app-header__title').style.alignItems = 'center';
  locBox.querySelector('.app-header__title').style.gap = '6px';
  locBox.querySelector('svg').style.width = '18px';
  locBox.querySelector('svg').style.height = '18px';
  locBox.querySelector('svg').style.color = 'var(--accent)';

  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.gap = '8px';
  actions.style.alignItems = 'center';

  const themeBtn = document.createElement('button');
  themeBtn.className = 'btn btn--sm btn--ghost';
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
  const modes = THEME_MODES;
  const cur = store.getState().theme;
  const next = modes[(modes.indexOf(cur) + 1) % modes.length];
  store.setState({ theme: next });
  ls.set('theme', next);
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

// === Nav render ===
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

// === Router setup ===
const router = createRouter({
  routes: [
    { path: '/fish',     title: 'Пазл рыбы',        render: (main, ctx) => fishModule.render(main, ctx) },
    { path: '/geo',      title: 'Геолокация',       render: (main, ctx) => geoModule.render(main, ctx) },
    { path: '/weather',  title: 'Погода и Луна',    render: (main, ctx) => weatherModule.render(main, ctx) },
    { path: '/forecast', title: 'Прогноз клёва',    render: (main, ctx) => forecastModule.render(main, ctx) },
    { path: '/calendar', title: 'Годовой календарь',render: (main, ctx) => calendarModule.render(main, ctx) },
    { path: '/log',      title: 'Журнал уловов',    render: (main, ctx) => logModule.render(main, ctx) }
  ],
  defaultPath: '/fish'
});

// === Location setter ===
export function setLocation(lat, lon, { label, country, admin1, admin2 } = {}) {
  const basinCode = detectBasinByCoords(lat, lon);
  const current = store.getState().location;
  store.setState({
    location: {
      lat, lon,
      country: country ?? current.country,
      admin1: admin1 ?? current.admin1,
      admin2: admin2 ?? current.admin2,
      label: label ?? current.label,
      basinCode
    }
  });
  ls.set('location', store.getState().location);
  renderHeader();
  bus.emit('location:changed', store.getState().location);
}

// === Online/offline ===
function initConnectivity() {
  const banner = document.getElementById('app-offline');
  const update = () => { banner.hidden = navigator.onLine; };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

// === Global errors ===
window.addEventListener('error', (e) => {
  console.error('[app] Uncaught:', e.error || e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[app] Unhandled rejection:', e.reason);
});

// === Service Worker ===
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(err => {
    console.warn('[app] SW registration failed:', err);
  });
}

// === Init ===
function init() {
  applyTheme(store.getState().theme);
  renderHeader();
  renderNav();
  initConnectivity();
  router.start();
}

init();