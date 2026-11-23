import { safeModuleRun } from '../../core/events.js?v=2.9.2-r258';
import { SPOT_CATEGORIES } from '../../core/config.js?v=2.9.2-r258';
import { store } from '../../core/store.js?v=2.9.2-r258';
import { canUserAccessCrewItem, isCircleItemMine, isCircleItemHidden } from '../circle/circle.module.js?v=2.9.2-r258';

export function normalizeSpotCatKey(rawCat = '') {
  if (rawCat === 'spot' || rawCat === 'hole') return 'bite';
  if (rawCat === 'hazard') return 'danger';
  return SPOT_CATEGORIES[rawCat] ? (SPOT_CATEGORIES[rawCat].id || rawCat) : 'slip';
}

export function computeDeduplicatedMapCounts(stateObj = null) {
  return safeModuleRun('geo:overlays', () => {
    const s = stateObj || store.getState();
    const seenSpotKeys = new Set();
    const uniqueSpots = [];
    if (Array.isArray(s.savedSpots)) {
      s.savedSpots.forEach(sp => {
        if (!sp || !Number.isFinite(Number(sp.lat)) || !Number.isFinite(Number(sp.lon))) return;
        const catKey = normalizeSpotCatKey(sp.category || sp.cat || 'bite');
        const dKey = `${catKey}_${Number(sp.lat).toFixed(4)}_${Number(sp.lon).toFixed(4)}`;
        if (seenSpotKeys.has(dKey)) return;
        seenSpotKeys.add(dKey);
        uniqueSpots.push({ id: sp.id, catKey, lat: Number(sp.lat), lon: Number(sp.lon), mine: true, source: 'saved', layerKey: 'mySpots', raw: sp, dKey });
      });
    }
    if (Array.isArray(s.catches)) {
      s.catches.forEach(c => {
        if (!c || c.deletedAt || c.isBlankTrip) return;
        const cLat = Number.isFinite(Number(c.lat)) ? Number(c.lat) : Number(s.lat);
        const cLon = Number.isFinite(Number(c.lon)) ? Number(c.lon) : Number(s.lon);
        if (!Number.isFinite(cLat) || !Number.isFinite(cLon)) return;
        const catKey = normalizeSpotCatKey(c.category || c.cat || 'bite');
        const dKey = `catch_${c.id || ''}_${cLat.toFixed(4)}_${cLon.toFixed(4)}`;
        if (seenSpotKeys.has(dKey)) return;
        seenSpotKeys.add(dKey);
        const fishTitle = c.fishName || c.fish || 'Улов';
        const weightInfo = Number(c.weightKg) > 0 ? ` (${Number(c.weightKg).toFixed(2).replace(/\.00$/, '')} кг)` : '';
        uniqueSpots.push({
          id: `catch_pt_${c.id || Date.now()}`,
          catKey,
          lat: cLat,
          lon: cLon,
          mine: true,
          source: 'catch',
          layerKey: 'mySpots',
          raw: { ...c, name: `Улов: ${fishTitle}${weightInfo}`, metaSummary: [c.dateLabel || c.date || '', c.bait ? `Приманка: ${c.bait}` : ''].filter(Boolean).join(' • ') },
          dKey
        });
      });
    }
    const rawCircle = (Array.isArray(s.circleItems) ? s.circleItems : []).filter(x => x && !isCircleItemHidden(x, s));
    const circleBlurItems = [];
    rawCircle.forEach(item => {
      if (!item || !Number.isFinite(Number(item.lat)) || !Number.isFinite(Number(item.lon))) return;
      if (item.t === 'spot') {
        const catKey = normalizeSpotCatKey(item.cat || item.category || 'slip');
        const dKey = `${catKey}_${Number(item.lat).toFixed(4)}_${Number(item.lon).toFixed(4)}`;
        if (seenSpotKeys.has(dKey)) return;
        seenSpotKeys.add(dKey);
        circleBlurItems.push({
          id: item.id,
          catKey,
          lat: Number(item.lat),
          lon: Number(item.lon),
          mine: isCircleItemMine(item, s),
          source: 'circle',
          layerKey: 'circleBlur',
          raw: item,
          dKey
        });
      } else if (item.t === 'circle') {
        circleBlurItems.push({
          id: item.id,
          catKey: normalizeSpotCatKey(item.cat || 'bite'),
          lat: Number(item.lat),
          lon: Number(item.lon),
          mine: isCircleItemMine(item, s),
          source: 'circleBlur',
          layerKey: 'circleBlur',
          raw: item
        });
      }
    });
    const now = Date.now();
    const crewExactItems = rawCircle
      .filter(x => x.t === 'crew' && Number.isFinite(Number(x.lat)) && Number.isFinite(Number(x.lon)) && (x.sos || ((!x.ea || x.ea > now) && (canUserAccessCrewItem(x, s) || isCircleItemMine(x, s)))))
      .map(item => ({
        id: item.id,
        catKey: normalizeSpotCatKey(item.cat || (item.sos ? 'danger' : 'camp')),
        lat: Number(item.lat),
        lon: Number(item.lon),
        mine: isCircleItemMine(item, s),
        source: 'crewExact',
        layerKey: 'crewExact',
        raw: item
      }));
    const allPlaqueItems = [...uniqueSpots, ...circleBlurItems, ...crewExactItems];
    const mineMapCount = allPlaqueItems.filter(x => x.mine).length;
    const foreignMapCount = allPlaqueItems.filter(x => !x.mine).length;
    return {
      uniqueSpots,
      circleBlurItems,
      crewExactItems,
      allPlaqueItems,
      thematicCount: uniqueSpots.length,
      circleBlurCount: circleBlurItems.length,
      crewExactCount: crewExactItems.length,
      mineMapCount,
      foreignMapCount,
      totalMapCount: mineMapCount + foreignMapCount
    };
  }, {
    uniqueSpots: [],
    circleBlurItems: [],
    crewExactItems: [],
    allPlaqueItems: [],
    thematicCount: 0,
    circleBlurCount: 0,
    crewExactCount: 0,
    mineMapCount: 0,
    foreignMapCount: 0,
    totalMapCount: 0
  });
}

export function prepareOverlayMarkerLists(mapCounts, visibleMapLayers) {
  return safeModuleRun('geo:overlays', () => {
    const allCatsList = Object.values(SPOT_CATEGORIES);
    const selCats = visibleMapLayers?.selectedCategories instanceof Set
      ? visibleMapLayers.selectedCategories
      : new Set(allCatsList.map(c => c.id));
    const allItemsPool = Array.isArray(mapCounts?.allPlaqueItems)
      ? mapCounts.allPlaqueItems
      : (mapCounts?.uniqueSpots || []);
    const catCounts = {};
    allCatsList.forEach(c => { catCounts[c.id] = 0; });
    allItemsPool.forEach(u => {
      if (u.layerKey === 'mySpots' && !visibleMapLayers?.mySpots) return;
      if (u.layerKey === 'circleBlur' && !visibleMapLayers?.circleBlur) return;
      if (u.layerKey === 'crewExact' && !visibleMapLayers?.crewExact) return;
      if (u.mine && !visibleMapLayers?.showMine) return;
      if (!u.mine && !visibleMapLayers?.showForeign) return;
      if (catCounts[u.catKey] !== undefined) catCounts[u.catKey]++;
    });
    const filteredSpotItems = allItemsPool.filter(u => {
      if (u.layerKey === 'mySpots' && !visibleMapLayers?.mySpots) return false;
      if (u.layerKey === 'circleBlur' && !visibleMapLayers?.circleBlur) return false;
      if (u.layerKey === 'crewExact' && !visibleMapLayers?.crewExact) return false;
      if (u.mine && !visibleMapLayers?.showMine) return false;
      if (!u.mine && !visibleMapLayers?.showForeign) return false;
      if (!selCats.has(u.catKey)) return false;
      return true;
    });
    return { allCatsList, selCats, catCounts, filteredSpotItems };
  }, { allCatsList: [], selCats: new Set(), catCounts: {}, filteredSpotItems: [] });
}
