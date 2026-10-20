// js/core/state.js
import { createStore } from './store.js';
import { createBus } from './events.js';
import { ls } from './storage.js';
import { DEFAULT_LOCATION } from '../data/constants.js';

export const bus = createBus();

export const store = createStore({
  location: ls.get('location', DEFAULT_LOCATION),
  theme:    ls.get('theme', 'auto'),
  water:    ls.get('water', 'small_river'),
  depth:    ls.get('depth', 1.2),
  method:   ls.get('method', 'spin_micro'),
  fishId:   ls.get('fishId', 'pike'),
  dayIdx:   ls.get('dayIdx', 0),
  weather:  null,
  forecast: null
});

// Хелперы-мутаторы, чтобы модули не дёргали ls напрямую
export function persist(patch) {
  store.setState(patch);
  for (const [k, v] of Object.entries(patch)) {
    if (['location', 'theme', 'water', 'depth', 'method', 'fishId', 'dayIdx'].includes(k)) {
      ls.set(k, v);
    }
  }
}