/**
 * @file store.js
 * @description Централизованное хранилище состояния (Store) с автоматической синхронизацией снасти и наживки и чистым списком Избранного по умолчанию (Ревизия 2.0.11)
 */

import { DEFAULT_STATE, getCompatibleMethods, getSeasonalBaitsForContext } from './config.js?v=2.0.12';
import { storage } from './storage.js?v=2.0.12';
import { detectBasinByCoords, BASIN_CONFIGS, isCoastalInBasin } from '../data/basins.js?v=2.0.12';
import { FISH_DB } from '../data/species.js?v=2.0.12';

function getActiveDaySeasonContext(state, overrideDays = null, overrideDayIdx = null, overrideIceState = null) {
  const rawDays = overrideDays ?? state?.weatherDays;
  const days = Array.isArray(rawDays) ? rawDays : [];
  const idx = Number.isFinite(overrideDayIdx) ? overrideDayIdx : (Number.isFinite(state?.dayIdx) ? state.dayIdx : 2);
  const day = days[idx] || days[2] || days[0] || null;
  const effIce = day?.iceState || overrideIceState || state?.iceState || 'open_water';
  const effWaterTemp = Number.isFinite(day?.waterTemp) ? day.waterTemp : 12;
  return { effIce, effWaterTemp };
}

function syncTackleForContext(nextState, forcePrimaryMethod = false) {
  const fishObj = FISH_DB.find(f => f.id === nextState.fishId) || FISH_DB[0];
  const { effIce, effWaterTemp } = getActiveDaySeasonContext(nextState);
  const compat = getCompatibleMethods(fishObj, effIce, nextState.water, effWaterTemp);

  let nextMethod = nextState.method;
  if (forcePrimaryMethod || !compat.some(m => m.val === nextMethod)) {
    nextMethod = compat[0]?.val || nextState.method;
  }

  const baits = getSeasonalBaitsForContext(fishObj, nextMethod, effWaterTemp, effIce);
  const nextBait = (!forcePrimaryMethod && nextState.selectedBait && baits.includes(nextState.selectedBait))
    ? nextState.selectedBait
    : (baits[0] || '');

  return {
    ...nextState,
    method: nextMethod,
    selectedBait: nextBait
  };
}

function createStore(initialState) {
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
      const nextBase = {
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
        dayIdx: 2
      };
      return syncTackleForContext(nextBase, false);
    }
    case 'SET_LOCATION_LABELS':
      return { ...state, ...action.payload };
    case 'SET_WATER': {
      const nextWater = action.payload.water;
      const waterChanged = nextWater !== state.water;
      const nextBase = {
        ...state,
        water: nextWater,
        depth: action.payload.depth ?? state.depth,
        selectedWaterName: action.payload.selectedWaterName ?? state.selectedWaterName
      };
      return syncTackleForContext(nextBase, waterChanged);
    }
    case 'SET_METHOD': {
      const nextMethod = action.payload;
      const fishObj = FISH_DB.find(f => f.id === state.fishId) || FISH_DB[0];
      const { effIce, effWaterTemp } = getActiveDaySeasonContext(state);
      const baits = getSeasonalBaitsForContext(fishObj, nextMethod, effWaterTemp, effIce);
      const nextBait = (state.selectedBait && baits.includes(state.selectedBait))
        ? state.selectedBait
        : (baits[0] || '');
      return { ...state, method: nextMethod, selectedBait: nextBait };
    }
    case 'SET_BAIT':
      return { ...state, selectedBait: action.payload };
    case 'SET_DEPTH':
      return { ...state, depth: action.payload };
    case 'SET_FISH': {
      const nextFishId = action.payload;
      const fishChanged = nextFishId !== state.fishId;
      const nextBase = { ...state, fishId: nextFishId };
      return syncTackleForContext(nextBase, fishChanged);
    }
    case 'SET_DAY': {
      const nextDayIdx = action.payload;
      const prevSeason = getActiveDaySeasonContext(state);
      const nextBase = { ...state, dayIdx: nextDayIdx };
      const nextSeason = getActiveDaySeasonContext(nextBase);
      const seasonShifted = prevSeason.effIce !== nextSeason.effIce ||
        (prevSeason.effWaterTemp <= 10.5) !== (nextSeason.effWaterTemp <= 10.5);
      return syncTackleForContext(nextBase, seasonShifted);
    }
    case 'SET_HOUR':
      return { ...state, selectedHour: action.payload };
    case 'TOGGLE_SHOW_ALL':
      return { ...state, showAllSpecies: !state.showAllSpecies };
    case 'TOGGLE_ONLY_FAVORITES':
      return { ...state, onlyFavoritesFilter: !state.onlyFavoritesFilter };
    case 'SET_FAVORITES_LIST': {
      const favs = Array.isArray(action.payload) ? action.payload : [];
      return {
        ...state,
        favorites: favs,
        favoritesExplicitlySet: true,
        onlyFavoritesFilter: favs.length === 0 ? false : state.onlyFavoritesFilter
      };
    }
    case 'SET_FISH_SEARCH':
      return { ...state, fishSearch: action.payload };
    case 'SET_FISH_GROUP':
      return { ...state, fishGroup: action.payload };
    case 'TOGGLE_FAVORITE': {
      const id = action.payload;
      const exists = state.favorites.includes(id);
      const favorites = exists ? state.favorites.filter(x => x !== id) : [id, ...state.favorites];
      return {
        ...state,
        favorites,
        favoritesExplicitlySet: true,
        onlyFavoritesFilter: favorites.length === 0 ? false : state.onlyFavoritesFilter
      };
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
    case 'SET_WEATHER_DATA': {
      const prevSeason = getActiveDaySeasonContext(state);
      const nextBase = {
        ...state,
        weatherDays: action.payload.days,
        elevation: action.payload.elevation ?? state.elevation,
        normPress: action.payload.normPress ?? state.normPress,
        iceState: action.payload.iceState ?? state.iceState,
        iceThickness: action.payload.iceThickness ?? state.iceThickness,
        weatherSource: action.payload.source ?? state.weatherSource,
        weatherUpdatedAt: action.payload.updatedAt ?? Date.now()
      };
      const nextSeason = getActiveDaySeasonContext(nextBase);
      const seasonShifted = prevSeason.effIce !== nextSeason.effIce ||
        (prevSeason.effWaterTemp <= 10.5) !== (nextSeason.effWaterTemp <= 10.5);
      return syncTackleForContext(nextBase, seasonShifted);
    }
    case 'SET_NEARBY_WATERS':
      return { ...state, nearbyWaters: action.payload };
    case 'SET_NEARBY_PLACES':
      return { ...state, nearbyPlaces: action.payload };
    case 'SET_SAVED_SPOTS':
      return { ...state, savedSpots: action.payload };
    case 'SET_CATCHES':
      return { ...state, catches: action.payload };
    case 'SAVE_ONBOARDING': {
      const targetSpecies = Array.isArray(action.payload.targetSpecies) ? action.payload.targetSpecies : [];
      const nextBase = {
        ...state,
        water: action.payload.water,
        method: action.payload.method,
        fishId: action.payload.fishId || state.fishId,
        favorites: targetSpecies,
        favoritesExplicitlySet: true,
        onlyFavoritesFilter: targetSpecies.length === 0 ? false : state.onlyFavoritesFilter,
        userProfile: {
          onboarded: true,
          preferredWater: action.payload.water,
          preferredMethod: action.payload.method,
          preferredWaters: action.payload.preferredWaters || [action.payload.water],
          preferredMethods: action.payload.preferredMethods || [action.payload.method],
          targetSpecies
        }
      };
      return syncTackleForContext(nextBase, false);
    }
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

// Пункт 1b: Если пользователь явно не выбирал избранное в новой ревизии, список избранного пустой
const initFavorites = saved.favoritesExplicitlySet === true && Array.isArray(saved.favorites)
  ? saved.favorites
  : [];

export const store = createStore(syncTackleForContext({
  ...DEFAULT_STATE,
  ...saved,
  favorites: initFavorites,
  favoritesExplicitlySet: Boolean(saved.favoritesExplicitlySet),
  onlyFavoritesFilter: initFavorites.length === 0 ? false : Boolean(saved.onlyFavoritesFilter),
  dayIdx: 2,
  basinCode: initBasin,
  basinName: BASIN_CONFIGS[initBasin]?.name || DEFAULT_STATE.basinName,
  isCoastal: initCoastal,
  water: initWater
}, false));
