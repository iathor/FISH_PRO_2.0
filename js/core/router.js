import { store } from './store.js?v=2.9.2-r258';
import { renderMap } from '../modules/geo/geo.module.js?v=2.9.2-r258';
import { closeModal } from '../ui/components.js?v=2.9.2-r258';
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
  const menuBackdrop = document.getElementById('klevCompactMenuBackdrop');
  if (menuBackdrop && menuBackdrop.classList.contains('open')) {
    menuBackdrop.classList.remove('open');
    document.getElementById('bottomNavMenuTriggerBtn')?.classList.remove('active');
    return true;
  }
  const arcExpandedClose = document.getElementById('arcExpandedPlaqueHeader');
  if (arcExpandedClose && arcExpandedClose.offsetParent !== null) {
    arcExpandedClose.click();
    return true;
  }
  const arcWxClose = document.getElementById('arcCloseWeatherModalBtn');
  if (arcWxClose && arcWxClose.offsetParent !== null) {
    arcWxClose.click();
    return true;
  }
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
    const menuBackdrop = document.getElementById('klevCompactMenuBackdrop');
    if (menuBackdrop) menuBackdrop.classList.remove('open');
    const modalCloseBtn = document.querySelector('#appModalBackdrop.open [data-modal-close], #appModalBackdrop.open .modal-close');
    if (modalCloseBtn && typeof modalCloseBtn.click === 'function') {
      try { modalCloseBtn.click(); } catch (_e) {}
    }
    const arcWxClose = document.getElementById('arcCloseWeatherModalBtn');
    if (arcWxClose && arcWxClose.offsetParent !== null) {
      try { arcWxClose.click(); } catch (_e) {}
    }
    this.applyVisibility(target);
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
      try { window.scrollTo(0, 0); } catch (e) {}
      try { document.documentElement.scrollTop = 0; document.body.scrollTop = 0; } catch (e) {}
    }
    store.dispatch({ type: 'SET_ROUTE', payload: target });
    if (typeof window.syncFishDockState === 'function') {
      window.syncFishDockState(true, target);
    }
  },
  syncNavGliders(route, forceMeasure = false) {
    if (typeof document === 'undefined') return;
    const syncBarGlider = (barEl, gliderId) => {
      if (!barEl) return;
      let glider = document.getElementById(gliderId);
      if (!glider) {
        glider = document.createElement('div');
        glider.id = gliderId;
        glider.className = 'klev-nav-glider';
        barEl.prepend(glider);
      }
      barEl.classList.add('has-liquid-glider');
      const activeBtn = barEl.querySelector('.active');
      if (!activeBtn || activeBtn.offsetParent === null) {
        glider.style.opacity = '0';
        glider._prevBtn = null;
        return;
      }
      const btnChanged = glider._prevBtn !== activeBtn;
      if (!btnChanged && !forceMeasure && glider.style.opacity === '1') {
        return;
      }
      const barW = barEl.clientWidth || barEl.offsetWidth || 360;
      const left = activeBtn.offsetLeft;
      const top = activeBtn.offsetTop;
      const width = activeBtn.offsetWidth;
      const height = activeBtn.offsetHeight;
      const right = Math.max(0, barW - (left + width));
      if (width > 4 && height > 4) {
        const hadPrev = typeof glider._prevLeft === 'number' && glider._prevBtn !== null && glider._prevBtn !== undefined;
        const prevLeft = hadPrev ? glider._prevLeft : left;
        if (!hadPrev) {
          glider.setAttribute('data-glide-dir', 'init');
        } else if (left > prevLeft + 2) {
          glider.setAttribute('data-glide-dir', 'right');
        } else if (left < prevLeft - 2) {
          glider.setAttribute('data-glide-dir', 'left');
        }
        glider._prevLeft = left;
        glider._prevBtn = activeBtn;
        glider.style.top = `${top}px`;
        glider.style.height = `${height}px`;
        glider.style.left = `${left}px`;
        glider.style.right = `${right}px`;
        glider.style.opacity = '1';
        if (hadPrev && btnChanged) {
          glider.classList.remove('glider-liquid-bulge');
          void glider.offsetWidth;
          glider.classList.add('glider-liquid-bulge');
          const ico = activeBtn.querySelector('.top-nav-ico, .dock-ico');
          if (ico) {
            ico.classList.remove('klev-tab-ico-pop');
            void ico.offsetWidth;
            ico.classList.add('klev-tab-ico-pop');
          }
        }
      }
    };
    syncBarGlider(document.getElementById('topSectionNavBar'), 'topNavGlider');
    syncBarGlider(document.querySelector('.bottom-nav-inner'), 'bottomNavGlider');
    syncBarGlider(document.getElementById('adminTopTabBar'), 'admTopNavGlider');
    syncBarGlider(document.querySelector('.adm-sec-tabs'), 'admNavGlider');
  },
  applyVisibility(route) {
    if (this._lastAppliedDomRoute === route) {
      this.syncNavGliders(route, false);
      return;
    }
    const ROUTE_ORDER = ['weather', 'fish', 'calendar', 'geo', 'chats', 'circle', 'forecast', 'log', 'admin'];
    const prevRoute = this._lastVisibleRoute || store.getState().route || 'forecast';
    const prevIdx = ROUTE_ORDER.indexOf(prevRoute);
    const nextIdx = ROUTE_ORDER.indexOf(route);
    const slideDir = (prevRoute !== route && prevIdx !== -1 && nextIdx !== -1)
      ? (nextIdx > prevIdx ? 'right' : 'left')
      : 'fade';
    this._lastVisibleRoute = route;
    this._lastAppliedDomRoute = route;

    if (typeof document !== 'undefined' && document.body) {
      document.body.style.overflow = '';
      if (route !== 'chats' && route !== 'admin' && typeof window !== 'undefined' && typeof window.__KLEV_CLOSE_FULLSCREEN_CHAT__ === 'function') {
        try { window.__KLEV_CLOSE_FULLSCREEN_CHAT__(); } catch (_e) {}
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
        // Без тяжёлой GPU-перерастеризации огромных секций (0 мс переключение вкладок)
      } else {
        sec.style.display = 'none';
        sec.classList.remove('klev-sec-slide-right', 'klev-sec-slide-left', 'klev-sec-slide-fade');
      }
    });

    const menuBackdrop = document.getElementById('klevCompactMenuBackdrop');
    if (menuBackdrop) menuBackdrop.classList.remove('open');
    document.querySelectorAll('[data-nav-tab]').forEach(btn => {
      const tabAttr = btn.getAttribute('data-nav-tab');
      if (btn.id === 'navCircleChatsHubBtn') {
        btn.classList.toggle('active', route === 'chats' || route === 'circle');
      } else {
        btn.classList.toggle('active', tabAttr === route);
      }
    });
    const menuTriggerBtn = document.getElementById('bottomNavMenuTriggerBtn');
    if (menuTriggerBtn) {
      menuTriggerBtn.classList.toggle('active', ['weather', 'fish', 'calendar', 'circle', 'chats'].includes(route));
    }
    this.syncNavGliders(route, false);
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.setAttribute('data-scroll-compact', '0');
    }
    if (typeof window.syncFishDockState === 'function') {
      window.syncFishDockState(false, route);
    }
    if (route === 'weather') {
      setTimeout(() => {
        const secW = document.getElementById('secWeather');
        if (secW && typeof window.__KLEV_RENDER_WEATHER__ === 'function') {
          window.__KLEV_RENDER_WEATHER__(secW);
        }
      }, 10);
    }
    if (route === 'fish') {
      setTimeout(() => {
        const secF = document.getElementById('secFish');
        if (secF && typeof window.__KLEV_RENDER_FISH__ === 'function') {
          window.__KLEV_RENDER_FISH__(secF);
        }
      }, 10);
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
if (typeof window !== 'undefined') { window.__KLEV_SYNC_NAV_GLIDERS__ = () => router.syncNavGliders(store.getState().route, true); }
