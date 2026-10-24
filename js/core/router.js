import { store } from './store.js?v=2.0.16';
import { renderMap } from '../modules/geo/geo.module.js?v=2.0.16';

const VALID_ROUTES = ['dashboard', 'fish', 'geo', 'weather', 'forecast', 'calendar', 'log', 'circle'];

export const router = {
  init() {
    window.addEventListener('hashchange', () => this.syncFromHash());
    this.syncFromHash();
  },

  syncFromHash() {
    const raw = (window.location.hash || '').replace(/^#\/?/, '').trim();
    if (raw.startsWith('klev_pack=')) {
      const route = 'circle';
      if (store.getState().route !== route) {
        store.dispatch({ type: 'SET_ROUTE', payload: route });
      }
      this.applyVisibility(route);
      return;
    }
    const cleanRoute = raw.split('?')[0];
    const route = VALID_ROUTES.includes(cleanRoute) ? cleanRoute : 'dashboard';
    if (store.getState().route !== route) {
      store.dispatch({ type: 'SET_ROUTE', payload: route });
    }
    this.applyVisibility(route);
  },

  navigate(route) {
    const target = VALID_ROUTES.includes(route) ? route : 'dashboard';
    if (window.location.hash !== `#/${target}`) {
      history.replaceState(null, '', `#/${target}`);
    }
    store.dispatch({ type: 'SET_ROUTE', payload: target });
    this.applyVisibility(target);
  },

  applyVisibility(route) {
    const appMode = store.getState().appMode || 'angler';
    document.querySelectorAll('[data-route-section]').forEach(sec => {
      const secName = sec.getAttribute('data-route-section');
      if (route === 'dashboard') {
        // В режиме «🟢 Новичок» на Обзоре оставляем только Карту, Рыб и Прогноз (со светофором Новичка), чтобы не перегружать экран
        if (appMode === 'novice' && (secName === 'calendar' || secName === 'circle')) {
          sec.style.display = 'none';
        } else {
          sec.style.display = '';
        }
      } else if (secName === route) {
        sec.style.display = '';
      } else if (secName === 'fish' && ['forecast', 'weather', 'calendar'].includes(route)) {
        // Keep fish section in DOM so its .fish-card buttons dock in miniature mode
        sec.style.display = '';
      } else {
        sec.style.display = 'none';
      }
    });
    document.querySelectorAll('[data-nav-tab]').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-nav-tab') === route);
    });
    const moreBtn = document.getElementById('navMoreBtn');
    if (moreBtn) {
      moreBtn.classList.toggle('active', route === 'calendar' || route === 'log' || route === 'circle');
    }
    if (typeof window.syncFishDockState === 'function') {
      window.syncFishDockState();
    }
    if (route === 'geo' || route === 'dashboard') {
      setTimeout(() => {
        const box = document.getElementById('mapBox');
        if (box && box.offsetParent !== null) {
          renderMap(box);
        }
      }, 80);
    }
  }
};
