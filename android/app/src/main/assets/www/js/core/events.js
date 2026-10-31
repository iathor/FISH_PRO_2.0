/* Klev PRO v2.5.3 r190 (Protected Build) */
const listeners = new Map();
export const events = {
  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => this.off(event, fn);
  },
  off(event, fn) {
    if (listeners.has(event)) listeners.get(event).delete(fn);
  },
  emit(event, payload) {
    if (!listeners.has(event)) return;
    for (const fn of listeners.get(event)) {
      try { fn(payload); } catch (err) { console.error(`[events] Error in ${event}:`, err); }
    }
  }
};
