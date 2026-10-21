import { store } from './store.js';

const VALID_ROUTES = ['dashboard', 'fish', 'geo', 'weather', 'forecast', 'calendar', 'log'];

export const router = {
  init() {
    window.addEventListener('hashchange', () => this.syncFromHash());
    this.syncFromHash();
  },

  syncFromHash() {
    const raw = (window.location.hash || '').replace(/^#\/?/, '').trim();
    const route = VALID_ROUTES.includes(raw) ? raw : 'dashboard';
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
    document.querySelectorAll('[data-route-section]').forEach(sec => {
      const secName = sec.getAttribute('data-route-section');
      if (route === 'dashboard' || secName === route) {
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
    if (typeof window.syncFishDockState === 'function') {
      window.syncFishDockState();
    }
    if (route === 'geo' || route === 'dashboard') {
      setTimeout(() => {
        const box = document.getElementById('mapBox');
        if (box && box.offsetParent !== null) {
          if (typeof window.renderGeoMap === 'function') window.renderGeoMap(box);
        }
      }, 80);
    }
  }
};
