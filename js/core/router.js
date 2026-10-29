import { store } from './store.js?v=2.2.0';
import { renderMap } from '../modules/geo/geo.module.js?v=2.2.0';
import { closeModal } from '../ui/components.js?v=2.2.0';

const VALID_ROUTES = ['geo', 'weather', 'fish', 'forecast', 'circle', 'chats', 'log', 'calendar', 'admin'];
const DEFAULT_ROUTE = 'forecast';

const routeHistoryStack = [DEFAULT_ROUTE];
let suppressNextPopState = false;

/**
 * Ставит защитную запись в window.history, чтобы боковой свайп «Назад» (на Android / iOS / в APK / в Telegram Mini App)
 * всегда перехватывался приложением (закрывал открытое подменю/модалку или возвращал на вкладку Прогноз),
 * и НИКОГДА случайно не закрывал и не сворачивал приложение.
 */
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

/**
 * Централизованный обработчик жеста «Назад» (боковой свайп экрана / системная кнопка Back в APK, браузере и TMA).
 * Возвращает true, если действие обработано внутри приложения (закрыта модалка, лайтбокс, меню или выполнен переход на Прогноз).
 */
export function handleAppBackAction(source = 'popstate') {
  if (typeof document === 'undefined') return false;

  // 0a. Если открыто окно подтверждения удаления — закрываем его
  const confirmEl = document.getElementById('klevConfirmDeleteBackdrop');
  if (confirmEl && confirmEl.style.display === 'flex') {
    confirmEl.style.display = 'none';
    confirmEl.innerHTML = '';
    return true;
  }

  // 0b. Если открыто окно Пользовательского соглашения — закрываем его
  const uaEl = document.getElementById('klevUserAgreementBackdrop');
  if (uaEl && uaEl.style.display === 'flex') {
    uaEl.querySelector('#uaCancelCloseBtn')?.click();
    return true;
  }

  // 0c. Если открыто полноэкранное окно чата — возвращаемся к списку чатов
  if (typeof window !== 'undefined' && typeof window.__KLEV_CLOSE_FULLSCREEN_CHAT__ === 'function') {
    if (window.__KLEV_CLOSE_FULLSCREEN_CHAT__()) return true;
  }

  // 1. Если открыт полноэкранный лайтбокс рыбы — закрываем его
  const lb = document.getElementById('fishImageLightbox');
  if (lb && lb.classList.contains('open')) {
    lb.classList.remove('open');
    return true;
  }

  // 2. Если открыто окно обновления релиза — закрываем его
  const relModal = document.getElementById('releaseUpdateModal');
  if (relModal && relModal.classList.contains('open')) {
    relModal.classList.remove('open');
    return true;
  }

  // 3. Если открыто любое модальное окно или подменю настроек:
  //    если это дочернее подменю, открытое из хаба профиля, возвращаемся в хаб профиля; иначе закрываем модалку
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

  // 4. Если открыто всплывающее меню «⋮ Ещё» в нижней панели — закрываем его
  const morePopup = document.getElementById('navMorePopup');
  const moreBtn = document.getElementById('navMoreBtn');
  if (morePopup && morePopup.classList.contains('open')) {
    morePopup.classList.remove('open');
    if (moreBtn) moreBtn.setAttribute('aria-expanded', 'false');
    return true;
  }

  // 5. Если на карте открыта карточка разведки точки — закрываем её
  const scoutCloseBtn = document.getElementById('scoutCloseBtn');
  if (scoutCloseBtn && scoutCloseBtn.offsetParent !== null) {
    scoutCloseBtn.click();
    return true;
  }

  // 6. Если пользователь находится на любой вкладке кроме главной («🎣 Прогноз»), возвращаем на предыдущую вкладку или «🎣 Прогноз»
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
      // Инициализируем базовую подушку истории, чтобы первый же боковой свайп не выбросил из WebView / браузера
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
        // Всегда восстанавливаем защитную запись в истории, чтобы повторный боковой свайп не закрыл приложение
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
    const route = VALID_ROUTES.includes(cleanRoute) ? cleanRoute : DEFAULT_ROUTE;
    this.applyVisibility(route);
    if (store.getState().route !== route) {
      store.dispatch({ type: 'SET_ROUTE', payload: route });
    }
    if (typeof window.syncFishDockState === 'function') {
      window.syncFishDockState(true, route);
    }
  },

  navigate(route, opts = {}) {
    const target = VALID_ROUTES.includes(route) ? route : DEFAULT_ROUTE;
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
      try { window.scrollTo(0, 0); } catch (e) {}
    }
    // Сначала применяем видимость секций с передачей точного target, затем обновляем store!
    this.applyVisibility(target);
    store.dispatch({ type: 'SET_ROUTE', payload: target });
    if (typeof window.syncFishDockState === 'function') {
      window.syncFishDockState(true, target);
    }
  },

  applyVisibility(route) {
    document.querySelectorAll('[data-route-section]').forEach(sec => {
      const secName = sec.getAttribute('data-route-section');
      if (secName === route) {
        sec.style.display = '';
      } else if (secName === 'fish' && ['forecast', 'calendar'].includes(route)) {
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
      moreBtn.classList.toggle('active', route === 'calendar' || route === 'log' || route === 'admin');
    }
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
