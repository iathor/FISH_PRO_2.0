import { DEFAULT_STATE, getCompatibleMethods } from './config.js';
import { BASIN_CONFIGS, detectBasinByCoords, isCoastalInBasin } from '../data/basins.js';
import { FISH_DB } from '../data/species.js';
import { storage } from './storage.js';

export function createStore(initialState) {
  let state = { ...initialState };
  const subscribers = new Set();

  function getState() {
    return state;
  }

  function dispatch(action) {
    const prev = state;
    const next = reducer(state, action);
    if (next === prev) return;
    state = next;
    storage.saveSettings(state);

    for (const sub of subscribers) {
      try {
        const prevSlice = sub.selector ? sub.selector(prev) : prev;
        const nextSlice = sub.selector ? sub.selector(state) : state;
        if (!shallowEqual(prevSlice, nextSlice)) {
          sub.callback(state, prev);
        }
      } catch (err) {
        console.error('[store] subscriber error:', err);
      }
    }
  }

  function subscribe(selectorOrCb, maybeCb) {
    const sub = typeof maybeCb === 'function'
      ? { selector: selectorOrCb, callback: maybeCb }
      : { selector: null, callback: selectorOrCb };
    subscribers.add(sub);
    return () => subscribers.delete(sub);
  }

  return { getState, dispatch, subscribe };
}

function shallowEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (!Object.is(a[k], b[k])) return false;
  }
  return true;
}

function reducer(state, action) {
  switch (action.type) {
    case 'SET_ROUTE':
      return { ...state, route: action.payload };
    case 'SET_THEME':
      return { ...state, theme: action.payload };
    case 'SET_LOCATION': {
      const { lat, lon, locCountry, locAdmin1, locAdmin2, locLabel, hasUserLocation } = action.payload;
      const basinCode = detectBasinByCoords(lat, lon);
      const basinName = BASIN_CONFIGS[basinCode]?.name || 'Водный бассейн РФ';
      const isCoastal = isCoastalInBasin(basinCode, lat, lon);
      let water = state.water;
      if (!isCoastal && (water === 'sea_gulf' || water === 'open_sea')) {
        water = 'small_river';
      }
      return {
        ...state,
        hasUserLocation: hasUserLocation ?? true,
        lat,
        lon,
        locCountry: locCountry ?? state.locCountry,
        locAdmin1: locAdmin1 ?? state.locAdmin1,
        locAdmin2: locAdmin2 ?? state.locAdmin2,
        locLabel: locLabel ?? state.locLabel,
        basinCode,
        basinName,
        isCoastal,
        water,
        selectedWaterName: '',
        dayIdx: 2 // Today
      };
    }
    case 'SET_LOCATION_LABELS':
      return { ...state, ...action.payload };
    case 'SET_WATER':
      return {
        ...state,
        water: action.payload.water,
        depth: action.payload.depth ?? state.depth,
        selectedWaterName: action.payload.selectedWaterName ?? state.selectedWaterName
      };
    case 'SET_METHOD':
      return { ...state, method: action.payload };
    case 'SET_BAIT':
      return { ...state, selectedBait: action.payload };
    case 'SET_DEPTH':
      return { ...state, depth: action.payload };
    case 'SET_FISH': {
      const nextFishId = action.payload;
      const fishObj = FISH_DB.find(f => f.id === nextFishId) || FISH_DB[0];
      const compat = getCompatibleMethods(fishObj, state.iceState, state.water);
      const nextMethod = compat.some(m => m.val === state.method)
        ? state.method
        : (compat[0]?.val || state.method);
      return { ...state, fishId: nextFishId, method: nextMethod };
    }
    case 'SET_DAY':
      return { ...state, dayIdx: action.payload };
    case 'SET_HOUR':
      return { ...state, selectedHour: action.payload };
    case 'TOGGLE_SHOW_ALL':
      return { ...state, showAllSpecies: !state.showAllSpecies };
    case 'TOGGLE_ONLY_FAVORITES':
      return { ...state, onlyFavoritesFilter: !state.onlyFavoritesFilter };
    case 'SET_FAVORITES_LIST':
      return { ...state, favorites: action.payload };
    case 'SET_FISH_SEARCH':
      return { ...state, fishSearch: action.payload };
    case 'SET_FISH_GROUP':
      return { ...state, fishGroup: action.payload };
    case 'TOGGLE_FAVORITE': {
      const id = action.payload;
      const exists = state.favorites.includes(id);
      const favorites = exists ? state.favorites.filter(x => x !== id) : [id, ...state.favorites];
      return { ...state, favorites };
    }
    case 'TOGGLE_PIN_DAY': {
      const idx = action.payload;
      let pinned = [...state.pinnedDays];
      if (pinned.includes(idx)) pinned = pinned.filter(x => x !== idx);
      else if (pinned.length < 3) pinned.push(idx);
      else pinned = [pinned[1], pinned[2], idx];
      return { ...state, pinnedDays: pinned };
    }
    case 'SET_CALENDAR_MODE':
      return { ...state, calendarMode: action.payload };
    case 'TOGGLE_COMPARE_SPECIES': {
      const fid = action.payload;
      let list = [...state.compareSpeciesIds];
      if (list.includes(fid)) {
        if (list.length > 1) list = list.filter(x => x !== fid);
      } else if (list.length < 3) {
        list.push(fid);
      } else {
        list = [list[1], list[2], fid];
      }
      return { ...state, compareSpeciesIds: list };
    }
    case 'SET_WEATHER_DATA':
      return {
        ...state,
        weatherDays: action.payload.days,
        elevation: action.payload.elevation ?? state.elevation,
        normPress: action.payload.normPress ?? state.normPress,
        iceState: action.payload.iceState ?? state.iceState,
        iceThickness: action.payload.iceThickness ?? state.iceThickness,
        weatherSource: action.payload.source ?? state.weatherSource,
        weatherUpdatedAt: action.payload.updatedAt ?? Date.now()
      };
    case 'SET_NEARBY_WATERS':
      return { ...state, nearbyWaters: action.payload };
    case 'SET_NEARBY_PLACES':
      return { ...state, nearbyPlaces: action.payload };
    case 'SET_SAVED_SPOTS':
      return { ...state, savedSpots: action.payload };
    case 'SET_CATCHES':
      return { ...state, catches: action.payload };
    case 'SAVE_ONBOARDING':
      return {
        ...state,
        water: action.payload.water,
        method: action.payload.method,
        fishId: action.payload.fishId || state.fishId,
        favorites: Array.from(new Set([...(action.payload.targetSpecies || []), ...state.favorites])),
        userProfile: {
          onboarded: true,
          preferredWater: action.payload.water,
          preferredMethod: action.payload.method,
          targetSpecies: action.payload.targetSpecies || []
        }
      };
    default:
      return state;
  }
}

const saved = storage.loadSettings() || {};
const initLat = saved.lat ?? DEFAULT_STATE.lat;
const initLon = saved.lon ?? DEFAULT_STATE.lon;
const initBasin = detectBasinByCoords(initLat, initLon);
const initCoastal = isCoastalInBasin(initBasin, initLat, initLon);
let initWater = saved.water ?? DEFAULT_STATE.water;
if (!initCoastal && (initWater === 'sea_gulf' || initWater === 'open_sea')) {
  initWater = 'small_river';
}

export const store = createStore({
  ...DEFAULT_STATE,
  ...saved,
  dayIdx: 2, // Always start on Today (idx=2)
  basinCode: initBasin,
  basinName: BASIN_CONFIGS[initBasin]?.name || DEFAULT_STATE.basinName,
  isCoastal: initCoastal,
  water: initWater
});
