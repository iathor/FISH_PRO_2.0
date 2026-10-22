import { MAP_LAYERS, getCompatibleMethods } from '../../core/config.js';
import { events } from '../../core/events.js';
import { storage } from '../../core/storage.js';
import { store } from '../../core/store.js';
import { fetchWithTimeout } from '../../core/http.js';
import { installShortcut, syncInstallButtons } from '../../core/pwa.js';
import { WATER_PROFILES, getAvailableWaterTypes } from '../../data/waters.js';
import { RUSSIA_CITIES, getNearestRussianWaters } from '../../data/russia-waters.js';
import { FISH_DB } from '../../data/species.js';
import { showToast } from '../../ui/components.js';
import { fetchWeather } from '../weather/weather.module.js';

let mapInstance = null;
let mapMarker = null;
let currentTileLayer = null;
let currentLayerKey = 'topo';
let mapOpen = false;
let inlineGpsHint = '';

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function calcHaversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

export async function setLocation(lat, lon, skipReverseGeo = false) {
  const rLat = Math.round(lat * 10000) / 10000;
  const rLon = Math.round(lon * 10000) / 10000;
  store.dispatch({
    type: 'SET_LOCATION',
    payload: { lat: rLat, lon: rLon, hasUserLocation: true }
  });
  if (mapInstance && mapMarker) {
    mapMarker.setLatLng([rLat, rLon]);
    const z = clamp(mapInstance.getZoom() || 10, 9, 13);
    mapInstance.setView([rLat, rLon], z);
  }
  const st = store.getState();
  const prof = WATER_PROFILES[st.water] || WATER_PROFILES.small_river;
  if (st.depth < prof.minD || st.depth > prof.maxD) {
    store.dispatch({ type: 'SET_DEPTH', payload: prof.defD });
  }
  events.emit('location:changed', { lat: rLat, lon: rLon, basinCode: st.basinCode, isCoastal: st.isCoastal });
  if (!skipReverseGeo) {
    resolveReverseGeocode(rLat, rLon);
  }
  getNearbyWatersAndPlaces(rLat, rLon);
  await fetchWeather(rLat, rLon, true);
}

export async function autoDetectStartupLocation() {
  const s = store.getState();
  if (!s.hasUserLocation) {
    try {
      const ipData = await fetchWithTimeout('https://api.bigdatacloud.net/data/reverse-geocode-client?localityLanguage=ru', 4500);
      if (ipData && Number.isFinite(ipData.latitude) && Number.isFinite(ipData.longitude)) {
        const city = ipData.city || ipData.locality || ipData.principalSubdivision || 'Моя точка';
        store.dispatch({
          type: 'SET_LOCATION_LABELS',
          payload: {
            locCountry: ipData.countryName || 'Россия',
            locAdmin1: ipData.principalSubdivision || '',
            locAdmin2: city,
            locLabel: city
          }
        });
        await setLocation(ipData.latitude, ipData.longitude, true);
      }
    } catch (e) {}
  }
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLocation(pos.coords.latitude, pos.coords.longitude, false);
      },
      () => {},
      { enableHighAccuracy: false, timeout: 6500, maximumAge: 300000 }
    );
  }
}

async function resolveReverseGeocode(lat, lon) {
  // Check offline cities first if close (< 25 km)
  for (const c of RUSSIA_CITIES) {
    if (calcHaversineKm(lat, lon, c.lat, c.lon) <= 25) {
      store.dispatch({
        type: 'SET_LOCATION_LABELS',
        payload: {
          locCountry: 'Россия',
          locAdmin1: c.admin1,
          locAdmin2: c.name,
          locLabel: c.name
        }
      });
      return;
    }
  }

  try {
    const nomUrl = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1&zoom=12&accept-language=ru`;
    const nom = await fetchWithTimeout(nomUrl, 5500, { headers: { 'Accept-Language': 'ru' } });
    if (nom && nom.address) {
      const a = nom.address;
      const city = a.city || a.town || a.village || a.hamlet || a.municipality || a.county || nom.name || '';
      const reg = a.state || a.region || '';
      if (city || reg) {
        store.dispatch({
          type: 'SET_LOCATION_LABELS',
          payload: {
            locCountry: a.country || 'Россия',
            locAdmin1: reg,
            locAdmin2: city,
            locLabel: city || reg
          }
        });
        return;
      }
    }
  } catch (e) {}

  try {
    const bdcUrl = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=ru`;
    const data = await fetchWithTimeout(bdcUrl, 5500);
    if (data && (data.city || data.locality || data.principalSubdivision)) {
      const city = data.city || data.locality || data.principalSubdivision;
      store.dispatch({
        type: 'SET_LOCATION_LABELS',
        payload: {
          locCountry: data.countryName || 'Россия',
          locAdmin1: data.principalSubdivision || '',
          locAdmin2: city,
          locLabel: city
        }
      });
      return;
    }
  } catch (e) {}

  store.dispatch({
    type: 'SET_LOCATION_LABELS',
    payload: {
      locCountry: 'Россия',
      locAdmin1: `${lat.toFixed(2)}°N`,
      locAdmin2: `${lon.toFixed(2)}°E`,
      locLabel: `${lat.toFixed(2)}°N, ${lon.toFixed(2)}°E`
    }
  });
}

export async function searchPlaceByQuery(query) {
  const q = (query || '').trim();
  if (!q) return;

  // Offline quick match for famous Russian fishing cities
  const qLower = q.toLowerCase();
  const matchedCity = RUSSIA_CITIES.find(c => c.name.toLowerCase().includes(qLower) || qLower.includes(c.name.toLowerCase()));
  if (matchedCity) {
    store.dispatch({
      type: 'SET_LOCATION_LABELS',
      payload: {
        locCountry: 'Россия',
        locAdmin1: matchedCity.admin1,
        locAdmin2: matchedCity.name,
        locLabel: matchedCity.name
      }
    });
    await setLocation(matchedCity.lat, matchedCity.lon, true);
    return;
  }

  try {
    const nomUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&addressdetails=1&limit=1&accept-language=ru`;
    const nomData = await fetchWithTimeout(nomUrl, 6000, { headers: { 'Accept-Language': 'ru' } });
    if (Array.isArray(nomData) && nomData.length > 0) {
      const p = nomData[0];
      const addr = p.address || {};
      const city = addr.city || addr.town || addr.village || addr.county || p.name || q;
      store.dispatch({
        type: 'SET_LOCATION_LABELS',
        payload: {
          locCountry: addr.country || 'Россия',
          locAdmin1: addr.state || addr.region || '',
          locAdmin2: city,
          locLabel: p.name || city
        }
      });
      await setLocation(parseFloat(p.lat), parseFloat(p.lon), true);
      return;
    }
  } catch (e) {}

  try {
    const omUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=ru&format=json`;
    const omData = await fetchWithTimeout(omUrl, 6000);
    if (omData && omData.results && omData.results.length > 0) {
      const p = omData.results[0];
      store.dispatch({
        type: 'SET_LOCATION_LABELS',
        payload: {
          locCountry: p.country || 'Россия',
          locAdmin1: p.admin1 || '',
          locAdmin2: p.admin2 || p.name,
          locLabel: p.name
        }
      });
      await setLocation(p.latitude, p.longitude, true);
      return;
    }
    showToast('Водоём или населённый пункт не найден', 'bad');
  } catch (e) {
    showToast('Слабый сигнал сети при поиске. Укажите точку на карте.', 'bad');
  }
}

export function requestGPS(container) {
  if (!navigator.geolocation) {
    inlineGpsHint = 'Геолокация не поддерживается браузером. Выберите точку на карте.';
    if (store.getState().route !== 'geo') mapOpen = true;
    render(container);
    return;
  }
  inlineGpsHint = 'Опрос спутников GPS...';
  render(container);
  navigator.geolocation.getCurrentPosition(
    pos => {
      inlineGpsHint = '';
      setLocation(pos.coords.latitude, pos.coords.longitude);
    },
    err => {
      if (err.code !== 1) {
        inlineGpsHint = 'Поиск координат по сотовой сети и Wi-Fi...';
        render(container);
        navigator.geolocation.getCurrentPosition(
          pos2 => {
            inlineGpsHint = '';
            setLocation(pos2.coords.latitude, pos2.coords.longitude);
          },
          err2 => {
            inlineGpsHint = err2.code === 1
              ? 'Доступ к GPS отклонён. Кликните на нужный водоём прямо на карте.'
              : 'Слабый сигнал GPS и сети. Укажите водоём кликом на карте.';
            if (store.getState().route !== 'geo') mapOpen = true;
            render(container);
          },
          { enableHighAccuracy: false, timeout: 9000, maximumAge: 300000 }
        );
      } else {
        inlineGpsHint = 'Доступ к GPS отклонён в настройках браузера. Выберите точку на карте.';
        if (store.getState().route !== 'geo') mapOpen = true;
        render(container);
      }
    },
    { enableHighAccuracy: true, timeout: 9000, maximumAge: 120000 }
  );
}

export async function getNearbyWatersAndPlaces(lat, lon) {
  const s = store.getState();

  // 1. Instant offline calculation from Russia Hydrography DB
  const offlineWaters = getNearestRussianWaters(lat, lon, s.basinCode, s.isCoastal, 10);
  store.dispatch({ type: 'SET_NEARBY_WATERS', payload: offlineWaters });
  if (!store.getState().selectedWaterName && offlineWaters.length > 0) {
    store.dispatch({
      type: 'SET_WATER',
      payload: {
        water: offlineWaters[0].wType,
        depth: offlineWaters[0].defDepth,
        selectedWaterName: offlineWaters[0].name
      }
    });
  }

  // 2. Online enrichment from Overpass if available
  const query = `[out:json][timeout:7];(way["waterway"~"river|stream|canal"]["name"](around:38000,${lat},${lon});way["natural"="water"]["name"](around:38000,${lat},${lon});relation["natural"="water"]["name"](around:38000,${lat},${lon});node["place"~"city|town|village|hamlet"]["name"](around:35000,${lat},${lon}););out center tags 45;`;
  const endpoints = [
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter?data=' + encodeURIComponent(query),
    'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(query),
    'https://overpass.kumi.systems/api/interpreter?data=' + encodeURIComponent(query)
  ];

  for (const ep of endpoints) {
    try {
      const data = await fetchWithTimeout(ep, 6500);
      const seenWater = new Set(offlineWaters.map(w => w.name.toLowerCase()));
      const seenPlace = new Set();
      const waters = [...offlineWaters];
      const places = [];

      for (const el of (data.elements || [])) {
        const name = el.tags && (el.tags['name:ru'] || el.tags.name);
        if (!name) continue;
        const elLat = el.lat ?? el.center?.lat;
        const elLon = el.lon ?? el.center?.lon;
        const distKm = (elLat && elLon) ? calcHaversineKm(lat, lon, elLat, elLon) : 9.9;

        if (el.tags.place) {
          const key = name.toLowerCase();
          if (seenPlace.has(key)) continue;
          seenPlace.add(key);
          if (elLat && elLon) {
            places.push({ name, lat: elLat, lon: elLon, distKm });
          }
          continue;
        }

        const cleanName = name.replace(/^(река|озеро|пруд|ручей)\s+/i, '');
        const wKey = cleanName.toLowerCase();
        if (seenWater.has(wKey)) continue;
        seenWater.add(wKey);

        const isRiver = Boolean(el.tags.waterway);
        let wType = isRiver
          ? (/обь|иртыш|енисей|волга|кама|дон|днепр|пур|таз|амур|лена|ангара|печора|ока|урал|вятка|кубань|нева|свирь/i.test(name) ? 'big_river' : 'small_river')
          : (/море|губа|залив|лиман|бухта/i.test(name) ? (s.isCoastal ? 'sea_gulf' : 'quarry') : (/карьер|вдхр|водохранилище/i.test(name) ? 'quarry' : 'tundra_lake'));
        const defDepth = WATER_PROFILES[wType]?.defD || 1.5;
        const prefix = isRiver ? '🌊 р. ' : '💧 ';

        waters.push({
          name: cleanName,
          label: `${prefix}${cleanName} • ${distKm} км`,
          wType,
          defDepth,
          distKm,
          lat: elLat || lat,
          lon: elLon || lon
        });
      }

      waters.sort((a, b) => a.distKm - b.distKm);
      places.sort((a, b) => a.distKm - b.distKm);

      if (places.length > 0) {
        store.dispatch({ type: 'SET_NEARBY_PLACES', payload: places.slice(0, 8) });
      }
      if (waters.length > 0) {
        const topWaters = waters.slice(0, 10);
        store.dispatch({ type: 'SET_NEARBY_WATERS', payload: topWaters });
        return topWaters;
      }
    } catch (e) {}
  }

  return offlineWaters;
}

export async function saveSpot(customName = '') {
  const s = store.getState();
  const wTitle = s.selectedWaterName || WATER_PROFILES[s.water]?.shortName || s.water;
  const spot = {
    id: `spot_${Date.now()}`,
    name: (customName || '').trim() || `${s.locLabel} (${wTitle})`,
    lat: s.lat,
    lon: s.lon,
    basinCode: s.basinCode,
    water: s.water,
    selectedWaterName: s.selectedWaterName,
    depth: s.depth,
    createdAt: new Date().toISOString()
  };
  await storage.putToStore('spots', spot);
  const all = await storage.getAllFromStore('spots');
  store.dispatch({ type: 'SET_SAVED_SPOTS', payload: all });
  showToast(`⭐ Точка «${spot.name}» сохранена в закладки! Найти её можно в блоке «Карта и водоём» в строке «Сохранённые точки».`, 'good');
  return spot;
}

export async function deleteSpot(id) {
  await storage.deleteFromStore('spots', id);
  const all = await storage.getAllFromStore('spots');
  store.dispatch({ type: 'SET_SAVED_SPOTS', payload: all });
}

export function renderMap(mapBoxEl) {
  if (!mapBoxEl || typeof L === 'undefined') return;
  const s = store.getState();
  const targetZoom = mapInstance ? clamp(mapInstance.getZoom(), 9, 13) : 10;
  if (!mapInstance || mapInstance._container !== mapBoxEl) {
    if (mapInstance) {
      try { mapInstance.remove(); } catch (e) {}
    }
    mapInstance = L.map(mapBoxEl).setView([s.lat, s.lon], targetZoom);
    mapInstance.attributionControl.setPrefix(false);
    const cfg = MAP_LAYERS[currentLayerKey] || MAP_LAYERS.topo;
    currentTileLayer = L.tileLayer(cfg.url, { maxZoom: 18, attribution: cfg.attr }).addTo(mapInstance);
    mapMarker = L.marker([s.lat, s.lon]).addTo(mapInstance);
    mapInstance.on('click', (e) => {
      setLocation(e.latlng.lat, e.latlng.lng);
    });
  } else {
    mapInstance.invalidateSize();
    mapMarker.setLatLng([s.lat, s.lon]);
    mapInstance.setView([s.lat, s.lon], targetZoom);
  }
}

export function getMethodOptions(iceState, waterType) {
  const s = store.getState();
  const fish = FISH_DB.find(f => f.id === s.fishId) || FISH_DB[0];
  const day = s.weatherDays[s.dayIdx] || s.weatherDays[2] || s.weatherDays[0];
  const effIce = day?.iceState || iceState || s.iceState || 'open_water';
  const effWaterTemp = day?.waterTemp ?? 12;
  return getCompatibleMethods(fish, effIce, waterType, effWaterTemp);
}

export function render(container) {
  if (!container) return;
  const s = store.getState();
  const availableWaters = getAvailableWaterTypes(s.basinCode, s.lat, s.lon);
  const prof = WATER_PROFILES[s.water] || WATER_PROFILES.small_river;
  const isRouteGeo = s.route === 'geo';
  const showDrawer = isRouteGeo ? true : mapOpen;
  const compatibleMethods = getMethodOptions(s.iceState, s.water);

  container.innerHTML = `
    <div class="card">
      <div class="section-head">
        <div>
          <span class="section-title">📍 Водоём, карта глубин и снасть</span>
          <div style="font-size:var(--fs-xs);color:var(--accent);font-weight:700;margin-top:2px;">
            ${s.basinName} (${s.lat.toFixed(2)}°N, ${s.lon.toFixed(2)}°E)
          </div>
        </div>
        <div class="toolbar-row">
          ${!isRouteGeo ? `<button type="button" class="btn btn-sm btn-accent" id="geoToggleMapBtn">${showDrawer ? '🗺 Свернуть карту ▲' : '🗺 Карта и поиск ▼'}</button>` : ''}
          <button type="button" class="btn btn-sm" id="geoGpsBtn">🎯 Мой GPS</button>
          <button type="button" class="btn btn-sm" id="geoSaveSpotBtn">⭐ В закладки</button>
          <button type="button" class="btn btn-sm btn-install" data-install-app>📲 Ярлык на экран</button>
        </div>
      </div>

      ${inlineGpsHint ? `<div style="margin-bottom:8px;padding:6px 10px;border-radius:var(--r-sm);background:var(--pill-warn-bg);color:var(--pill-warn-text);font-size:var(--fs-xs);font-weight:700;">ℹ️ ${inlineGpsHint}</div>` : ''}

      <div id="geoMapSection" style="display:${showDrawer ? 'block' : 'none'};margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--border);">
        <div style="display:flex;gap:6px;margin-bottom:8px;">
          <input type="search" id="geoSearchInput" class="input" style="flex:1;" placeholder="Поиск реки, озера или населённого пункта...">
          <button type="button" class="btn btn-sm btn-accent" id="geoSearchBtn" style="min-height:38px;padding:0 14px;">Найти</button>
        </div>

        <div class="map-layers-row">
          ${Object.entries(MAP_LAYERS).map(([k, v]) => `
            <button type="button" class="btn btn-sm map-layer-btn ${currentLayerKey === k ? 'btn-accent' : ''}" data-map-layer="${k}">${v.name}</button>
          `).join('')}
        </div>

        <div id="mapBox" role="application" aria-label="Карта выбора водоёма"></div>

        ${(s.nearbyPlaces && s.nearbyPlaces.length) ? `
          <div style="margin-top:8px;">
            <div style="font-size:10px;color:var(--muted);font-weight:700;margin-bottom:4px;">🏘 НАСЕЛЁННЫЕ ПУНКТЫ РЯДОМ С ТОЧКОЙ (кликните для перехода):</div>
            <div class="chip-scroll-row">
              ${s.nearbyPlaces.map(p => `
                <button type="button" class="w-chip" data-nearby-place="${p.lat},${p.lon},${p.name}">🏘 ${p.name} • ${p.distKm} км</button>
              `).join('')}
            </div>
          </div>
        ` : ''}

        ${s.savedSpots.length ? `
          <div style="margin-top:8px;">
            <div style="font-size:10px;color:var(--muted);font-weight:700;margin-bottom:4px;">📌 СОХРАНЁННЫЕ РЫБОЛОВНЫЕ ТОЧКИ:</div>
            <div class="chip-scroll-row">
              ${s.savedSpots.map(sp => `
                <span class="w-chip" style="gap:6px;">
                  <button type="button" style="background:none;border:none;cursor:pointer;font-weight:700;" data-load-spot="${sp.id}">📍 ${sp.name}</button>
                  <button type="button" style="background:none;border:none;cursor:pointer;color:var(--bad);" data-del-spot="${sp.id}" aria-label="Удалить точку">✕</button>
                </span>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>

      <div style="margin-bottom:10px;">
        <div style="font-size:10px;color:var(--muted);font-weight:700;margin-bottom:4px;">
          🌊 ВОДОЁМЫ РЯДОМ ПО ПЕРИМЕТРУ ${s.selectedWaterName ? `(выбран: <b style="color:var(--accent);">${s.selectedWaterName}</b>)` : '(кликните для выбора водоёма)'}:
        </div>
        <div class="chip-scroll-row">
          ${(s.nearbyWaters || []).map(w => {
            const isSelected = s.selectedWaterName ? (s.selectedWaterName === w.name) : (s.water === w.wType);
            return `<button type="button" class="w-chip ${isSelected ? 'active' : ''}" data-nearby-water="${w.wType}" data-nearby-name="${w.name || w.label}" data-nearby-depth="${w.defDepth \vert{}\vert{} ''}">${w.label}</button>`;
          }).join('')}
        </div>
      </div>

      <!-- Батиметрический профиль и глубины водоёма (Point 3) -->
      <div class="card" style="background:var(--card);margin-bottom:12px;padding:10px 12px;border:1px solid var(--border);">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:6px;">
          <span style="font-size:var(--fs-xs);font-weight:800;color:var(--accent);">🗺️ КАРТА ГЛУБИН И РЕЛЬЕФ ДНА: ${s.selectedWaterName || prof.name}</span>
          <span class="pill pill-neutral" style="font-size:10px;">Эхолокационный диапазон: ${prof.minD}–${prof.maxD} м</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;font-size:var(--fs-xs);">
          <div style="background:var(--panel);padding:6px 8px;border-radius:6px;">
            <div style="color:var(--muted);font-size:10px;">ТЕКУЩИЙ ГОРИЗОНТ ЛОВЛИ</div>
            <div style="font-weight:800;font-size:var(--fs-sm);color:var(--accent);">${s.depth.toFixed(1)} м (свал / русло)</div>
          </div>
          <div style="background:var(--panel);padding:6px 8px;border-radius:6px;">
            <div style="color:var(--muted);font-size:10px;">ХАРАКТЕР РЕЛЬЕФА</div>
            <div style="font-weight:700;">${prof.flow > 1.5 ? 'Русловая бровка, песчано-галечный свал' : 'Илистое дно, перепады глубин, старичные ямы'}</div>
          </div>
          <div style="background:var(--panel);padding:6px 8px;border-radius:6px;">
            <div style="color:var(--muted);font-size:10px;">СКОРОСТЬ ТЕЧЕНИЯ</div>
            <div style="font-weight:700;">${prof.flow >= 2.0 ? 'Быстрое (до ' + prof.flow + ' м/с)' : (prof.flow >= 1.0 ? 'Умеренное (~' + prof.flow + ' м/с)' : 'Слабое / стоячая вода')}</div>
          </div>
        </div>
      </div>

      <div class="controls-grid">
        <div>
          <label for="geoWaterSelect" style="display:block;font-size:10px;color:var(--muted);font-weight:700;margin-bottom:3px;">ТИП ВОДНОГО ОБЪЕКТА</label>
          <select id="geoWaterSelect">
            ${availableWaters.map(w => `<option value="${w.id}" ${w.id === s.water ? 'selected' : ''}>${w.name}</option>`).join('')}
          </select>
        </div>

        <div>
          <label for="geoMethodSelect" style="display:block;font-size:10px;color:var(--muted);font-weight:700;margin-bottom:3px;">СНАСТЬ И СПОСОБ ЛОВЛИ</label>
          <select id="geoMethodSelect">
            ${compatibleMethods.map(m => `<option value="${m.val}" ${m.val === s.method ? 'selected' : ''}>${m.text}</option>`).join('')}
          </select>
        </div>

        <div>
          <label for="geoDepthRange" style="display:block;font-size:10px;color:var(--muted);font-weight:700;margin-bottom:3px;">
            РАБОЧАЯ ГЛУБИНА В ТОЧКЕ: <span id="geoDepthVal" style="color:var(--accent);font-weight:800;">${s.depth.toFixed(1)}</span> м (${prof.minD}–${prof.maxD} м)
          </label>
          <input type="range" id="geoDepthRange" min="${prof.minD}" max="${prof.maxD}" step="0.1" value="${s.depth}" style="width:100%;margin-top:8px;">
        </div>
      </div>
    </div>
  `;

  bindGeoEvents(container, showDrawer);
  const newRows = container.querySelectorAll('.chip-scroll-row');
  newRows.forEach((el, idx) => {
    if (prevScrolls[idx] > 0) el.scrollLeft = prevScrolls[idx];
  });
}

function bindGeoEvents(container, showDrawer) {
  const toggleBtn = container.querySelector('#geoToggleMapBtn');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      mapOpen = !mapOpen;
      render(container);
    });
  }

  const gpsBtn = container.querySelector('#geoGpsBtn');
  if (gpsBtn) gpsBtn.addEventListener('click', () => requestGPS(container));

  const saveSpotBtn = container.querySelector('#geoSaveSpotBtn');
  if (saveSpotBtn) saveSpotBtn.addEventListener('click', () => saveSpot());

  container.querySelectorAll('[data-install-app]').forEach(btn => {
    btn.addEventListener('click', () => installShortcut());
  });
  syncInstallButtons();

  const searchBtn = container.querySelector('#geoSearchBtn');
  const searchInput = container.querySelector('#geoSearchInput');
  if (searchBtn && searchInput) {
    searchBtn.addEventListener('click', () => searchPlaceByQuery(searchInput.value));
    searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') searchPlaceByQuery(searchInput.value); });
  }

  container.querySelectorAll('[data-map-layer]').forEach(btn => {
    btn.addEventListener('click', () => {
      currentLayerKey = btn.getAttribute('data-map-layer');
      if (mapInstance) {
        if (currentTileLayer) mapInstance.removeLayer(currentTileLayer);
        const cfg = MAP_LAYERS[currentLayerKey] || MAP_LAYERS.topo;
        currentTileLayer = L.tileLayer(cfg.url, { maxZoom: 18, attribution: cfg.attr }).addTo(mapInstance);
      }
      render(container);
    });
  });

  container.querySelectorAll('[data-nearby-place]').forEach(btn => {
    btn.addEventListener('click', () => {
      const [latStr, lonStr, name] = btn.getAttribute('data-nearby-place').split(',');
      store.dispatch({ type: 'SET_LOCATION_LABELS', payload: { locLabel: name, locAdmin2: name } });
      setLocation(parseFloat(latStr), parseFloat(lonStr), true);
    });
  });

  container.querySelectorAll('[data-nearby-water]').forEach(btn => {
    btn.addEventListener('click', () => {
      const wType = btn.getAttribute('data-nearby-water');
      const wName = btn.getAttribute('data-nearby-name') || '';
      const defD = parseFloat(btn.getAttribute('data-nearby-depth')) || WATER_PROFILES[wType]?.defD || 1.5;
      store.dispatch({ type: 'SET_WATER', payload: { water: wType, depth: defD, selectedWaterName: wName } });
      showToast(`Выбран водоём: ${wName}`, 'info');
    });
  });

  container.querySelectorAll('[data-load-spot]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-load-spot');
      const sp = store.getState().savedSpots.find(x => x.id === id);
      if (sp) {
        store.dispatch({ type: 'SET_LOCATION_LABELS', payload: { locLabel: sp.name } });
        store.dispatch({ type: 'SET_WATER', payload: { water: sp.water, depth: sp.depth, selectedWaterName: sp.selectedWaterName || '' } });
        setLocation(sp.lat, sp.lon, true);
      }
    });
  });

  container.querySelectorAll('[data-del-spot]').forEach(btn => {
    btn.addEventListener('click', () => deleteSpot(btn.getAttribute('data-del-spot')));
  });

  const wSel = container.querySelector('#geoWaterSelect');
  if (wSel) {
    wSel.addEventListener('change', (e) => {
      const wType = e.target.value;
      const prof = WATER_PROFILES[wType] || WATER_PROFILES.small_river;
      const clampedDepth = clamp(store.getState().depth, prof.minD, prof.maxD);
      store.dispatch({ type: 'SET_WATER', payload: { water: wType, depth: clampedDepth, selectedWaterName: '' } });
    });
  }

  const mSel = container.querySelector('#geoMethodSelect');
  if (mSel) {
    mSel.addEventListener('change', (e) => {
      store.dispatch({ type: 'SET_METHOD', payload: e.target.value });
    });
  }

  const dRange = container.querySelector('#geoDepthRange');
  const dVal = container.querySelector('#geoDepthVal');
  if (dRange) {
    dRange.addEventListener('input', (e) => { if (dVal) dVal.textContent = parseFloat(e.target.value).toFixed(1); });
    dRange.addEventListener('change', (e) => {
      store.dispatch({ type: 'SET_DEPTH', payload: parseFloat(e.target.value) });
    });
  }

  if (showDrawer) {
    setTimeout(() => {
      const box = container.querySelector('#mapBox');
      if (box) renderMap(box);
    }, 60);
  }
}

let unsub = null;

export async function init(container) {
  const spots = await storage.getAllFromStore('spots');
  store.dispatch({ type: 'SET_SAVED_SPOTS', payload: spots });
  const s = store.getState();
  getNearbyWatersAndPlaces(s.lat, s.lon);
  render(container);
  autoDetectStartupLocation();

  unsub = store.subscribe(
    st => {
      const activeDay = st.weatherDays?.[st.dayIdx] || st.weatherDays?.[2] || st.weatherDays?.[0];
      return {
        lat: st.lat,
        lon: st.lon,
        basinCode: st.basinCode,
        isCoastal: st.isCoastal,
        water: st.water,
        selectedWaterName: st.selectedWaterName,
        method: st.method,
        selectedBait: st.selectedBait,
        depth: st.depth,
        iceState: st.iceState,
        dayIdx: st.dayIdx,
        dayIceState: activeDay?.iceState || st.iceState,
        dayWaterTemp: activeDay?.waterTemp ?? 12,
        nearbyWaters: st.nearbyWaters,
        nearbyPlaces: st.nearbyPlaces,
        savedSpots: st.savedSpots,
        route: st.route,
        fishId: st.fishId
      };
    },
    () => render(container)
  );
}

export function destroy() {
  if (unsub) unsub();
}

export const geoModule = {
  setLocation,
  autoDetectStartupLocation,
  searchPlaceByQuery,
  requestGPS,
  getNearbyWatersAndPlaces,
  saveSpot,
  deleteSpot,
  renderMap,
  getMethodOptions,
  init,
  render,
  destroy
};
