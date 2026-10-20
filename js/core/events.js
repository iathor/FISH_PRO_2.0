export function createBus() {
  const listeners = new Map();
  return {
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(handler);
      return () => this.off(event, handler);
    },
    off(event, handler) { listeners.get(event)?.delete(handler); },
    emit(event, payload) {
      const set = listeners.get(event);
      if (!set) return;
      for (const h of set) {
        try { h(payload); }
        catch (err) { console.error(`[bus:${event}]`, err); }
      }
    },
    clear() { listeners.clear(); }
  };
}