import { store } from './store.js?v=2.9.1-r236';
import { renderMap } from '../modules/geo/geo.module.js?v=2.9.1-r236';
import { closeModal } from '../ui/components.js?v=2.9.1-r236';
const VALID_ROUTES = ['geo', 'weather', 'fish', 'forecast', 'circle', 'chats', 'log', 'calendar', 'admin'];
const DEFAULT_ROUTE = (typeof window !== 'undefined' && window.__KLEV_ADMIN_CONTOUR__ === true) ? 'admin' : 'forecast';
const routeHistoryStack = [DEFAULT_ROUTE];
let suppressNextPopState = false;
export function pushBackGuardState(reason = 'guard') {
  if (typeof window === 'undefined' || !window.history || typeof window.history.pushState !== 'function') return;
  try {
    const curState = window.history.state;
    const curRoute = store.getState().route || DEFAULT_ROUTE;
    if (reason === 'init' && curState && curState.klevGuard) {
      return;
    }
    window.history.pushState({ klevGuard: true, reason, route: curRoute, ts: Date.now() }, '', window.location.hash || `#/${curRoute}`);
  } catch (e) {}
}
export function handleAppBackAction(source = 'popstate') {
  if (typeof document === 'undefined') return false;
  const selBackdrop = document.getElementById('klevCustomSelectBackdrop');
  if (selBackdrop && selBackdrop.classList.contains('open')) {
    selBackdrop.classList.remove('open');
    return true;
  }
  const confirmEl = document.getElementById('klevConfirmDeleteBackdrop');
  if (confirmEl && confirmEl.style.display === 'flex') {
    confirmEl.style.display = 'none';
    confirmEl.innerHTML = '';
    return true;
  }
  const uaEl = document.getElementById('klevUserAgreementBackdrop');
  if (uaEl && uaEl.style.display === 'flex') {
    uaEl.querySelector('#uaCancelCloseBtn')?.click();
    return true;
  }
  if (typeof window !== 'undefined' && typeof window.__KLEV_CLOSE_FULLSCREEN_CHAT__ === 'function') {
    if (window.__KLEV_CLOSE_FULLSCREEN_CHAT__()) return true;
  }
  const lb = document.getElementById('fishImageLightbox');
  if (lb && lb.classList.contains('open')) {
    lb.classList.remove('open');
    return true;
  }
  const relModal = document.getElementById('releaseUpdateModal');
  if (relModal && relModal.classList.contains('open')) {
    relModal.classList.remove('open');
    return true;
  }
  const backdrop = document.getElementById('appModalBackdrop');
  if (backdrop && backdrop.classList.contains('open')) {
    if (typeof window !== 'undefined' && typeof window.__KLEV_MODAL_BACK_FN__ === 'function') {
      const fn = window.__KLEV_MODAL_BACK_FN__;
      window.__KLEV_MODAL_BACK_FN__ = null;
      fn();
      return true;
    }
    closeModal();
    return true;
  }
  const scoutCloseBtn = document.getElementById('scoutCloseBtn');
  if (scoutCloseBtn && scoutCloseBtn.offsetParent !== null) {
    scoutCloseBtn.click();
    return true;
  }
  const curRoute = store.getState().route || DEFAULT_ROUTE;
  if (curRoute !== DEFAULT_ROUTE) {
    while (routeHistoryStack.length > 0 && routeHistoryStack[routeHistoryStack.length - 1] === curRoute) {
      routeHistoryStack.pop();
    }
    const prevRoute = routeHistoryStack.pop() || DEFAULT_ROUTE;
    router.navigate(prevRoute, { fromBack: true });
    return true;
  }
  return false;
}
if (typeof window !== 'undefined') {
  window.__KLEV_PUSH_BACK_GUARD__ = pushBackGuardState;
  window.__KLEV_HANDLE_BACK__ = handleAppBackAction;
}
export const router = {
  init() {
    this.syncFromHash();
    if (typeof window !== 'undefined') {
      try {
        const curRoute = store.getState().route || DEFAULT_ROUTE;
        window.history.replaceState({ klevRoot: true, route: curRoute }, '', window.location.hash || `#/${curRoute}`);
        pushBackGuardState('init');
      } catch (e) {}
      window.addEventListener('popstate', () => {
        if (suppressNextPopState) {
          suppressNextPopState = false;
          return;
        }
        const raw = (window.location.hash || '').replace(/^#\/?/, '').trim();
        if (raw.startsWith('klev_pack=') || raw.startsWith('pack=KP1_') || raw.startsWith('p=KP1_')) {
          this.syncFromHash();
          pushBackGuardState('pack');
          return;
        }
        handleAppBackAction('popstate');
        pushBackGuardState('rearm');
      });
      window.addEventListener('hashchange', () => {
        const raw = (window.location.hash || '').replace(/^#\/?/, '').trim();
        if (raw.startsWith('klev_pack=') || raw.startsWith('pack=KP1_') || raw.startsWith('p=KP1_')) {
          this.syncFromHash();
        }
      });
    }
  },
  syncFromHash() {
    if (typeof window !== 'undefined' && window.__KLEV_ADMIN_CONTOUR__ === true) {
      this.applyVisibility('admin');
      if (store.getState().route !== 'admin') {
        store.dispatch({ type: 'SET_ROUTE', payload: 'admin' });
      }
      return;
    }
    const raw = (window.location.hash || '').replace(/^#\/?/, '').trim();
    if (raw.startsWith('klev_pack=') || raw.startsWith('pack=KP1_') || raw.startsWith('p=KP1_')) {
      const route = 'circle';
      this.applyVisibility(route);
      if (store.getState().route !== route) {
        store.dispatch({ type: 'SET_ROUTE', payload: route });
      }
      if (typeof window.syncFishDockState === 'function') {
        window.syncFishDockState(true, route);
      }
      return;
    }
    const cleanRoute = raw.split('?')[0];
    let route = VALID_ROUTES.includes(cleanRoute) ? cleanRoute : DEFAULT_ROUTE;
    if (typeof window !== 'undefined' && typeof window.__KLEV_IS_MOBILE_GUEST__ === 'function' && window.__KLEV_IS_MOBILE_GUEST__()) {
      if (!['forecast', 'geo', 'weather', 'fish', 'calendar'].includes(route)) {
        route = DEFAULT_ROUTE;
      }
    }
    this.applyVisibility(route);
    if (store.getState().route !== route) {
      store.dispatch({ type: 'SET_ROUTE', payload: route });
    }
    if (typeof window.syncFishDockState === 'function') {
      window.syncFishDockState(true, route);
    }
  },
  navigate(route, opts = {}) {
    const target = (typeof window !== 'undefined' && window.__KLEV_ADMIN_CONTOUR__ === true) ? 'admin' : (VALID_ROUTES.includes(route) ? route : DEFAULT_ROUTE);
    if (typeof window !== 'undefined' && typeof window.__KLEV_IS_MOBILE_GUEST__ === 'function' && window.__KLEV_IS_MOBILE_GUEST__()) {
      if (!['forecast', 'geo', 'weather', 'fish', 'calendar'].includes(target)) {
        if (typeof window.__KLEV_PROMPT_GUEST_AUTH__ === 'function') {
          window.__KLEV_PROMPT_GUEST_AUTH__('Сначала войдите в аккаунт — разделы «Чаты·Круг», «SOS» и «Журнал» доступны после регистрации постоянного ID');
        }
        return;
      }
    }
    const prevRoute = store.getState().route || DEFAULT_ROUTE;
    if (!opts.fromBack && prevRoute !== target) {
      if (routeHistoryStack[routeHistoryStack.length - 1] !== prevRoute) {
        routeHistoryStack.push(prevRoute);
      }
      if (routeHistoryStack.length > 12) {
        routeHistoryStack.splice(0, routeHistoryStack.length - 12);
      }
    }
    if (typeof window !== 'undefined' && window.history) {
      try {
        if (window.location.hash !== `#/${target}`) {
          window.history.replaceState({ klevGuard: true, route: target }, '', `#/${target}`);
        }
        pushBackGuardState('nav');
      } catch (e) {}
    }
    if (prevRoute !== target && typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) {}
    }
    this.applyVisibility(target);
    store.dispatch({ type: 'SET_ROUTE', payload: target });
    if (typeof window.syncFishDockState === 'function') {
      window.syncFishDockState(true, target);
    }
  },
  applyVisibility(route) {
    const ROUTE_ORDER = ['weather', 'fish', 'calendar', 'geo', 'chats', 'circle', 'forecast', 'log', 'admin'];
    const prevRoute = this._lastVisibleRoute || store.getState().route || 'forecast';
    const prevIdx = ROUTE_ORDER.indexOf(prevRoute);
    const nextIdx = ROUTE_ORDER.indexOf(route);
    const slideDir = (prevRoute !== route && prevIdx !== -1 && nextIdx !== -1)
      ? (nextIdx > prevIdx ? 'right' : 'left')
      : 'fade';
    this._lastVisibleRoute = route;

    if (typeof document !== 'undefined' && document.body) {
      document.body.style.overflow = '';
      if (route !== 'chats' && route !== 'admin' && typeof window !== 'undefined' && typeof window.__KLEV_CLOSE_FULLSCREEN_CHAT__ === 'function') {
        try { window.__KLEV_CLOSE_FULLSCREEN_CHAT__(); } catch (_e) { /* ignore */ }
      }
      const rootEl = document.documentElement;
      const isArcMobile = typeof window.__KLEV_IS_MOBILE_MAP_MODE__ === 'function'
        ? window.__KLEV_IS_MOBILE_MAP_MODE__()
        : (window.innerWidth <= 1100);
      if (route === 'geo' && isArcMobile && !window.__KLEV_ADMIN_CONTOUR__) {
        rootEl.setAttribute('data-arc-map-active', '1');
        rootEl.setAttribute('data-arc-header-open', '0');
        rootEl.setAttribute('data-arc-footer-open', '0');
      } else {
        rootEl.setAttribute('data-arc-map-active', '0');
        rootEl.setAttribute('data-arc-header-open', '0');
        rootEl.setAttribute('data-arc-footer-open', '0');
      }
    }

    document.querySelectorAll('[data-route-section]').forEach(sec => {
      const secName = sec.getAttribute('data-route-section');
      if (secName === route) {
        sec.style.display = '';
        sec.classList.remove('klev-sec-slide-right', 'klev-sec-slide-left', 'klev-sec-slide-fade');
        void sec.offsetWidth;
        sec.classList.add(
          slideDir === 'right'
            ? 'klev-sec-slide-right'
            : (slideDir === 'left' ? 'klev-sec-slide-left' : 'klev-sec-slide-fade')
        );
      } else {
        sec.style.display = 'none';
        sec.classList.remove('klev-sec-slide-right', 'klev-sec-slide-left', 'klev-sec-slide-fade');
      }
    });

    document.querySelectorAll('[data-nav-tab]').forEach(btn => {
      const tabAttr = btn.getAttribute('data-nav-tab');
      if (btn.id === 'navCircleChatsHubBtn') {
        btn.classList.toggle('active', route === 'chats' || route === 'circle');
      } else {
        btn.classList.toggle('active', tabAttr === route);
      }
    });

    if (typeof window.syncFishDockState === 'function') {
      window.syncFishDockState(false, route);
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