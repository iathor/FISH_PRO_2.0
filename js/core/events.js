export const KLEV_EVENTS = Object.freeze({
  GEO_SPOT_PICKED: 'geo:spotPicked',
  GEO_LOCATION_CHANGED: 'geo:locationChanged',
  GEO_OVERLAYS_UPDATED: 'geo:overlaysUpdated',
  NAV_STATE_CHANGED: 'nav:stateChanged',
  AUTH_CHANGED: 'auth:changed',
  CIRCLE_UPDATED: 'circle:updated',
  UI_TOAST: 'ui:toast',
  MODULE_ERROR: 'module:error'
});

const MAX_MODULE_ERRORS = 50;
let _inSafeErrReport = false;

export function safeModuleRun(domainTag, fn, fallback = undefined) {
  try {
    return fn();
  } catch (err) {
    const tag = String(domainTag || 'unknown');
    const message = err && err.message ? String(err.message) : String(err || 'Unknown error');
    const stack = err && err.stack ? String(err.stack) : '';
    const entry = { tag, message, stack, ts: Date.now() };
    if (typeof window !== 'undefined') {
      if (!Array.isArray(window.__KLEV_MODULE_ERRORS__)) {
        window.__KLEV_MODULE_ERRORS__ = [];
      }
      window.__KLEV_MODULE_ERRORS__.push(entry);
      if (window.__KLEV_MODULE_ERRORS__.length > MAX_MODULE_ERRORS) {
        window.__KLEV_MODULE_ERRORS__.splice(0, window.__KLEV_MODULE_ERRORS__.length - MAX_MODULE_ERRORS);
      }
    }
    console.error('[KLEV:' + tag + ']', err);
    if (!_inSafeErrReport) {
      _inSafeErrReport = true;
      try {
        if (typeof window !== 'undefined') {
          window.__KLEV_LOG_ERR__?.('[' + tag + '] ' + entry.message, 'module:' + tag, 0, 0, err);
        }
        if (tag !== 'events:module:error') {
          events.emit(KLEV_EVENTS.MODULE_ERROR, entry);
        }
      } catch (_reportErr) {
      } finally {
        _inSafeErrReport = false;
      }
    }
    return fallback;
  }
}

const listeners = new Map();
export const events = {
  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => this.off(event, fn);
  },
  once(event, fn) {
    const wrapper = (payload) => {
      this.off(event, wrapper);
      return fn(payload);
    };
    return this.on(event, wrapper);
  },
  off(event, fn) {
    if (listeners.has(event)) listeners.get(event).delete(fn);
  },
  emit(event, payload) {
    if (!listeners.has(event)) return;
    for (const fn of Array.from(listeners.get(event))) {
      safeModuleRun('events:' + event, () => fn(payload));
    }
  }
};