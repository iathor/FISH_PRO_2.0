export function createStore(initialState = {}) {
  let state = initialState;
  const subscribers = new Set();

  function notify() {
    for (const sub of subscribers) {
      try { sub(state); }
      catch (err) { console.error('[store]', err); }
    }
  }

  return {
    getState: () => state,
    setState(patch) {
      const next = typeof patch === 'function' ? patch(state) : { ...state, ...patch };
      if (next === state) return;
      state = next;
      notify();
    },
    update(fn) { this.setState(fn); },
    subscribe(selector, handler, { immediate = false } = {}) {
      let prev = selector(state);
      const wrapped = (s) => {
        const next = selector(s);
        if (next !== prev) { prev = next; handler(next, prev); }
      };
      subscribers.add(wrapped);
      if (immediate) handler(prev, prev);
      return () => subscribers.delete(wrapped);
    },
    subscribeAll(handler) {
      subscribers.add(handler);
      return () => subscribers.delete(handler);
    }
  };
}