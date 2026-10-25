import { store } from './store.js?v=2.0.164';
import { renderMap } from '../modules/geo/geo.module.js?v=2.0.164';

const VALID_ROUTES = ['geo', 'weather', 'fish', 'forecast', 'circle', 'log', 'calendar'];
const DEFAULT_ROUTE = 'forecast';

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
    // Если старая ссылка вела на #/dashboard или хэш пуст — открываем Прогноз (без перегруженного Обзора)
    const route = VALID_ROUTES.includes(cleanRoute) ? cleanRoute : DEFAULT_ROUTE;
    if (store.getState().route !== route) {
      store.dispatch({ type: 'SET_ROUTE', payload: route });
    }
    this.applyVisibility(route);
  },

  navigate(route) {
    const target = VALID_ROUTES.includes(route) ? route : DEFAULT_ROUTE;
    if (window.location.hash !== `#/${target}`) {
      history.replaceState(null, '', `#/${target}`);
    }
    store.dispatch({ type: 'SET_ROUTE', payload: target });
    this.applyVisibility(target);
  },

  applyVisibility(route) {
    document.querySelectorAll('[data-route-section]').forEach(sec => {
      const secName = sec.getAttribute('data-route-section');
      if (secName === route) {
        sec.style.display = '';
      } else if (secName === 'fish' && ['forecast', 'calendar'].includes(route)) {
        // На вкладках «Прогноз» и «Календарь» оставляем компактную полоску быстрого переключения целевой рыбы
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
      moreBtn.classList.toggle('active', route === 'calendar' || route === 'log');
    }
    if (typeof window.syncFishDockState === 'function') {
      window.syncFishDockState();
    }
    if (route === 'geo') {
      setTimeout(() => {
        const box = document.getElementById('mapBox');
        if (box && box.offsetParent !== null) {
          renderMap(box);
        }
      }, 60);
    }
  }
};
