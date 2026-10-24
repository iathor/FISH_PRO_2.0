import { MAP_LAYERS, getCompatibleMethods } from '../../core/config.js?v=2.0.15';
import { events } from '../../core/events.js?v=2.0.15';
import { storage } from '../../core/storage.js?v=2.0.15';
import { store } from '../../core/store.js?v=2.0.15';
import { fetchWithTimeout } from '../../core/http.js?v=2.0.15';
import { installShortcut, syncInstallButtons } from '../../core/pwa.js?v=2.0.15';
import { WATER_PROFILES, getAvailableWaterTypes } from '../../data/waters.js?v=2.0.15';
import {
  RUSSIA_CITIES,
  RUSSIA_WATERS,
  findNearestRussianSettlement,
  getNearestRussianSettlements,
  getNearestRussianWaters,
  getWaterTypeShortTag
} from '../../data/russia-waters.js?v=2.0.15';
import { FISH_DB } from '../../data/species.js?v=2.0.15';
import { showToast } from '../../ui/components.js?v=2.0.15';
import { fetchWeather } from '../weather/weather.module.js?v=2.0.15';

let mapInstance = null;
let mapMarker = null;
let currentTileLayer = null;
let currentLayerKey = 'topo';
let mapOpen = false;
let inlineGpsHint = '';
let overpassLoading = false;
let activeOverpassReqId = 0;

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

/**
 * Классифицирует водный объект из OpenStreetMap / Overpass API по тегам, названию и размеру
 * (Озеро / Карьер / ГРЭС / Река-малая / Река-большая / Старица / Морской залив)
 */
export function classifyOsmWaterElement(el, name, isCoastal) {
  const tags = el?.tags || {};
  const nLower = String(name || '').toLowerCase();
  const waterTag = String(tags.water || '').toLowerCase();
  const waterwayTag = String(tags.waterway || '').toLowerCase();
  const landuseTag = String(tags.landuse || '').toLowerCase();

  if (/грэс|тэц|аэс|охладител|тёплый канал|теплый канал/i.test(nLower)) {
    return { wType: 'cooling_reservoir', typeTag: 'ГРЭС / Тёплый сброс' };
  }

  if (/губа|залив|лиман|бухта|пролив|море/i.test(nLower) || tags.natural === 'bay' || tags.natural === 'strait') {
    if (isCoastal) {
      return { wType: 'sea_gulf', typeTag: 'Морской залив / Губа' };
    }
    return { wType: 'quarry', typeTag: 'Крупный залив / Вдхр' };
  }

  if (waterwayTag || /^р\.|^река\s|^ручей\s|^протока\s/i.test(nLower)) {
    const isMajorRiver =
      /обь|иртыш|енисей|волга|кама|дон|днепр|пур|таз|надым|амур|зея|уссури|лена|вилюй|алдан|ангара|печора|уса|ока|урал|вятка|белая|кубань|нева|свирь|волхов|северная двина|вычегда|онега|луга|нарва|преголя|селенга|камчатка|колыма|индигирка|хатанга|пясина|тулома|томь|чулым|кет|вах|конда|туртас|тавда|тура|тобол|исеть|чусовая|сура|ветлуга|мокша|хопёр|медведица|северский донец|маныч|ахтуба|бузан|бахтемир/i.test(nLower) ||
      (tags.width && parseFloat(tags.width) >= 60) ||
      tags.boat === 'yes' ||
      tags.CEMT;

    if (isMajorRiver) {
      return { wType: 'big_river', typeTag: 'Река большая' };
    }
    if (waterwayTag === 'stream' || /ручей|ключ|речка/i.test(nLower)) {
      return { wType: 'small_river', typeTag: 'Река малая / Ручей' };
    }
    return { wType: 'small_river', typeTag: 'Река малая' };
  }

  if (/карьер|разрез|котлован/i.test(nLower) || waterTag === 'quarry' || landuseTag === 'quarry') {
    return { wType: 'quarry', typeTag: 'Карьер' };
  }

  if (/вдхр|водохранилище/i.test(nLower) || waterTag === 'reservoir' || landuseTag === 'reservoir') {
    return { wType: 'quarry', typeTag: 'Водохранилище' };
  }

  if (/старица|затон|сор|пойма|пруд|болото|ильмень|озерцо/i.test(nLower) || waterTag === 'oxbow' || waterTag === 'pond') {
    return { wType: 'tundra_lake', typeTag: /старица|затон/i.test(nLower) ? 'Старица / Затон' : 'Пруд / Озеро малое' };
  }

  if (el?.type === 'relation' || /большое|глубокое|святое|белое|светлое|круглое|долгое|селигер|ладож|онеж|байкал|имандра|сямозеро|сегозеро|выгозеро|пяозеро|чудск|телецк|увильды|тургояк|ханто|янтарное/i.test(nLower)) {
    return { wType: 'quarry', typeTag: 'Озеро крупное' };
  }

  return { wType: 'tundra_lake', typeTag: 'Озеро' };
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
    const z = clamp(mapInstance.getZoom() || 10, 8, 13);
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
  getNearbyWatersAndPlaces(rLat, rLon, st.waterRadiusKm || 50);
  await fetchWeather(rLat, rLon, true);
}

/**
 * Ревизия 2.0.15: Безопасное определение геолокации без блокировок в мобильных браузерах:
 * - Не вызывает getCurrentPosition при старте страницы, если разрешение ещё не выдано (state !== 'granted'),
 *   чтобы мобильные браузеры не блокировали запрос без клика пользователя.
 * - Если пользователь уже выдал разрешение ранее (state === 'granted') и точка ещё не выбиралась вручную — тихо уточняет координаты.
 */
export async function autoDetectStartupLocation() {
  const s = store.getState();
  if (s.hasUserLocation) return;

  if (typeof navigator !== 'undefined' && navigator.permissions && typeof navigator.permissions.query === 'function') {
    try {
      const perm = await navigator.permissions.query({ name: 'geolocation' });
      if (perm && perm.state === 'granted' && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          pos => {
            if (!store.getState().hasUserLocation) {
              setLocation(pos.coords.latitude, pos.coords.longitude);
            }
          },
          () => {},
          { enableHighAccuracy: false, timeout: 6000, maximumAge: 600000 }
        );
      }
    } catch (e) {}
  }
}

/**
 * Резервное определение примерных координат по IP (доступные в РФ без VPN сервисы),
 * если в мобильном браузере заблокирован системный доступ к GPS (PERMISSION_DENIED).
 */
export async function locateByIpFallback() {
  const providers = [
    {
      url: 'https://api.bigdatacloud.net/data/reverse-geocode-client?localityLanguage=ru',
      parse: d => (d && Number.isFinite(d.latitude) && Number.isFinite(d.longitude))
        ? { lat: d.latitude, lon: d.longitude, city: d.city || d.locality || d.principalSubdivision, region: d.principalSubdivision }
        : null
    },
    {
      url: 'https://ipwho.is/?lang=ru',
      parse: d => (d && d.success !== false && Number.isFinite(d.latitude) && Number.isFinite(d.longitude))
        ? { lat: d.latitude, lon: d.longitude, city: d.city, region: d.region }
        : null
    },
    {
      url: 'https://freeipapi.com/api/json',
      parse: d => (d && Number.isFinite(d.latitude) && Number.isFinite(d.longitude))
        ? { lat: d.latitude, lon: d.longitude, city: d.cityName, region: d.regionName }
        : null
    },
    {
      url: 'https://get.geojs.io/v1/ip/geo.json',
      parse: d => (d && d.latitude && d.longitude)
        ? { lat: parseFloat(d.latitude), lon: parseFloat(d.longitude), city: d.city, region: d.region }
        : null
    }
  ];

  for (const p of providers) {
    try {
      const raw = await fetchWithTimeout(p.url, 4200);
      const res = p.parse(raw);
      if (res && Number.isFinite(res.lat) && Number.isFinite(res.lon)) {
        return res;
      }
    } catch (e) {}
  }
  return null;
}

/**
 * Ревизия 2.0.15:
 * Универсальный трёхступенчатый каскад определения координат (GPS -> Сеть/Wi-Fi -> IP-геолокация РФ без VPN)
 */
export async function detectUserPosition() {
  if (typeof navigator !== 'undefined' && navigator.geolocation) {
    try {
      const pos1 = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 5500,
          maximumAge: 180000
        });
      });
      if (pos1 && pos1.coords && Number.isFinite(pos1.coords.latitude)) {
        return {
          lat: pos1.coords.latitude,
          lon: pos1.coords.longitude,
          source: 'gps',
          permissionDenied: false
        };
      }
    } catch (err1) {
      const denied1 = Boolean(err1 && err1.code === 1);
      if (!denied1) {
        try {
          const pos2 = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: false,
              timeout: 6000,
              maximumAge: 600000
            });
          });
          if (pos2 && pos2.coords && Number.isFinite(pos2.coords.latitude)) {
            return {
              lat: pos2.coords.latitude,
              lon: pos2.coords.longitude,
              source: 'network',
              permissionDenied: false
            };
          }
        } catch (err2) {}
      }
      const ipGeo = await locateByIpFallback();
      if (ipGeo) {
        return {
          lat: ipGeo.lat,
          lon: ipGeo.lon,
          city: ipGeo.city,
          region: ipGeo.region,
          source: 'ip',
          permissionDenied: denied1
        };
      }
      return { lat: null, lon: null, source: 'failed', permissionDenied: denied1 };
    }
  }

  const ipGeo = await locateByIpFallback();
  if (ipGeo) {
    return {
      lat: ipGeo.lat,
      lon: ipGeo.lon,
      city: ipGeo.city,
      region: ipGeo.region,
      source: 'ip',
      permissionDenied: false
    };
  }
  return { lat: null, lon: null, source: 'failed', permissionDenied: false };
}

export async function resolveReverseGeocode(lat, lon) {
  // 1. Мгновенная подстановка из единой офлайн-базы городов и близлежащих населённых пунктов РФ (0 мс, никогда не зависает!)
  const nearest = findNearestRussianSettlement(lat, lon);
  if (nearest && nearest.distKm <= 65) {
    store.dispatch({
      type: 'SET_LOCATION_LABELS',
      payload: {
        locCountry: 'Россия',
        locAdmin1: nearest.admin1,
        locAdmin2: nearest.name,
        locLabel: nearest.label
      }
    });
    if (nearest.distKm <= 16) {
      return;
    }
  }

  // 2. Уточнение по онлайн-геокодерам, если точка далеко от известных населённых пунктов
  try {
    const nomUrl = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1&zoom=12&accept-language=ru`;
    const nom = await fetchWithTimeout(nomUrl, 4800, { headers: { 'Accept-Language': 'ru' } });
    if (nom && nom.address) {
      const a = nom.address;
      const city = a.city || a.town || a.village || a.hamlet || a.municipality || a.county || nom.name || '';
      const reg = a.state || a.region || nearest?.admin1 || '';
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
    const data = await fetchWithTimeout(bdcUrl, 4500);
    if (data && (data.city || data.locality || data.principalSubdivision)) {
      const city = data.city || data.locality || data.principalSubdivision;
      store.dispatch({
        type: 'SET_LOCATION_LABELS',
        payload: {
          locCountry: data.countryName || 'Россия',
          locAdmin1: data.principalSubdivision || nearest?.admin1 || '',
          locAdmin2: city,
          locLabel: city
        }
      });
      return;
    }
  } catch (e) {}

  if (!nearest) {
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
}

export async function searchPlaceByQuery(query) {
  const q = (query || '').trim();
  if (!q) return;

  const qLower = q.toLowerCase();

  // 1. Поиск по единой офлайн-базе городов и посёлков РФ
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
    showToast(`Переход к населённому пункту: ${matchedCity.name}`, 'good');
    return;
  }

  // 2. Поиск по офлайн-базе водоёмов РФ
  const matchedWater = RUSSIA_WATERS.find(w =>
    w.name.toLowerCase().includes(qLower) ||
    w.cleanName.toLowerCase().includes(qLower)
  );
  if (matchedWater) {
    store.dispatch({
      type: 'SET_LOCATION_LABELS',
      payload: {
        locCountry: 'Россия',
        locAdmin1: matchedWater.region,
        locAdmin2: matchedWater.cleanName,
        locLabel: matchedWater.region
      }
    });
    store.dispatch({
      type: 'SET_WATER',
      payload: {
        water: matchedWater.wType,
        depth: matchedWater.defDepth,
        selectedWaterName: matchedWater.cleanName
      }
    });
    await setLocation(matchedWater.lat, matchedWater.lon, true);
    showToast(`Выбран водоём: ${matchedWater.name}`, 'good');
    return;
  }

  try {
    const nomUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&addressdetails=1&limit=1&accept-language=ru`;
    const nomData = await fetchWithTimeout(nomUrl, 5500, { headers: { 'Accept-Language': 'ru' } });
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
    const omData = await fetchWithTimeout(omUrl, 5500);
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
    inlineGpsHint = 'Геолокация не поддерживается браузером. Определяем регион по сети...';
    if (store.getState().route !== 'geo') mapOpen = true;
    render(container);
    locateByIpFallback().then(ipGeo => {
      if (ipGeo) {
        inlineGpsHint = `📍 Координаты определены по сети (${ipGeo.city || 'ваш регион'}). Для точного выбора укажите водоём на карте.`;
        setLocation(ipGeo.lat, ipGeo.lon);
      }
      render(container);
    });
    return;
  }

  inlineGpsHint = 'Опрос спутников GPS и датчиков геолокации...';
  render(container);

  const handleDeniedOrFailed = async (isPermissionDenied) => {
    const ipGeo = await locateByIpFallback();
    if (ipGeo) {
      const near = findNearestRussianSettlement(ipGeo.lat, ipGeo.lon);
      const cityTitle = near && near.distKm <= 35 ? near.name : (ipGeo.city || 'ваш регион');
      inlineGpsHint = isPermissionDenied
        ? `📍 В браузере запрещён доступ к GPS (определён город по сети: ${cityTitle}). Чтобы включить точный GPS, нажмите на значок 🔒/⚙️ слева от адреса klevpro.ru в строке браузера и разрешите «Геоданные», либо выберите водоём на карте.`
        : `📍 Спутники GPS недоступны в помещении — точка установлена по сети (${cityTitle}). Вы можете уточнить водоём кликом на карте.`;
      await setLocation(ipGeo.lat, ipGeo.lon);
    } else {
      inlineGpsHint = isPermissionDenied
        ? 'Доступ к GPS отклонён в настройках браузера. Нажмите на значок 🔒/⚙️ слева от адреса сайта и разрешите «Геоданные», либо выберите город в поиске / точку на карте.'
        : 'Слабый сигнал GPS. Выберите населённый пункт в поиске или укажите точку на карте.';
    }
    if (store.getState().route !== 'geo') mapOpen = true;
    render(container);
  };

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
            handleDeniedOrFailed(err2.code === 1);
          },
          { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 }
        );
      } else {
        handleDeniedOrFailed(true);
      }
    },
    { enableHighAccuracy: true, timeout: 7500, maximumAge: 180000 }
  );
}

/**
 * Ревизия 2.0.15:
 * Определение водоёмов и ближайших населённых пунктов по геолокации в радиусе «До 50 км» или «До 120 км».
 * 1) Мгновенно подставляет данные из единой офлайн-базы РФ (водоёмы + ближайшие населённые пункты) и 10-км кэша водоёмов.
 * 2) Асинхронно опрашивает каскад альтернативных серверов Overpass API (maps.mail.ru -> kumi.systems -> private.coffee -> overpass-api.de),
 *    чтобы при недоступности одного сервиса данные надёжно подгружались с другого!
 */
export async function getNearbyWatersAndPlaces(lat, lon, customRadiusKm = null) {
  const s = store.getState();
  const radiusKm = Number.isFinite(customRadiusKm) ? customRadiusKm : (s.waterRadiusKm || 50);
  const radiusMeters = Math.min(120000, Math.max(20000, Math.round(radiusKm * 1000)));
  const reqId = ++activeOverpassReqId;

  // 1. Мгновенная выборка водоёмов и близлежащих населённых пунктов из единой офлайн-базы РФ
  const offlineWaters = getNearestRussianWaters(lat, lon, s.basinCode, s.isCoastal, 18, radiusKm);
  const offlinePlaces = getNearestRussianSettlements(lat, lon, 12, Math.max(80, radiusKm));

  store.dispatch({ type: 'SET_NEARBY_WATERS', payload: offlineWaters });
  store.dispatch({ type: 'SET_NEARBY_PLACES', payload: offlinePlaces });

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

  // 2. Проверяем 10-км локальный кэш водоёмов
  const cachedWatersObj = storage.loadNearbyWatersCache(lat, lon, radiusKm);
  if (cachedWatersObj && Array.isArray(cachedWatersObj.waters) && cachedWatersObj.waters.length > 0) {
    store.dispatch({ type: 'SET_NEARBY_WATERS', payload: cachedWatersObj.waters });
    if (Array.isArray(cachedWatersObj.places) && cachedWatersObj.places.length > 0) {
      store.dispatch({ type: 'SET_NEARBY_PLACES', payload: cachedWatersObj.places });
    }
    return cachedWatersObj.waters;
  }

  // 3. Каскад альтернативных зеркал Overpass API (если один сервер не отвечает — автоматически запрашиваем в другом)
  overpassLoading = true;
  const placeRadiusMeters = Math.min(60000, radiusMeters);
  const query = `[out:json][timeout:65];(way["waterway"~"river|canal"]["name"](around:${radiusMeters},${lat},${lon});way["natural"="water"]["name"](around:${radiusMeters},${lat},${lon});relation["natural"="water"]["name"](around:${radiusMeters},${lat},${lon});node["place"~"city|town|village|hamlet"]["name"](around:${placeRadiusMeters},${lat},${lon}););out center tags 90;`;

  const endpoints = [
    { name: 'VK/Mail.ru Overpass РФ', url: 'https://maps.mail.ru/osm/tools/overpass/api/interpreter?data=' + encodeURIComponent(query), timeoutMs: 32000 },
    { name: 'Kumi Systems Overpass', url: 'https://overpass.kumi.systems/api/interpreter?data=' + encodeURIComponent(query), timeoutMs: 22000 },
    { name: 'Private.Coffee Overpass', url: 'https://overpass.private.coffee/api/interpreter?data=' + encodeURIComponent(query), timeoutMs: 22000 },
    { name: 'OSM.de Overpass', url: 'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(query), timeoutMs: 22000 }
  ];

  for (const ep of endpoints) {
    try {
      const data = await fetchWithTimeout(ep.url, ep.timeoutMs);
      if (reqId !== activeOverpassReqId) return offlineWaters;
      if (!data || !Array.isArray(data.elements)) continue;

      const seenWater = new Set(offlineWaters.map(w => w.name.toLowerCase()));
      const seenPlace = new Set(offlinePlaces.map(p => p.name.toLowerCase()));
      const waters = [...offlineWaters];
      const places = [...offlinePlaces];

      for (const el of data.elements) {
        const name = el.tags && (el.tags['name:ru'] || el.tags.name);
        if (!name) continue;
        const elLat = el.lat ?? el.center?.lat;
        const elLon = el.lon ?? el.center?.lon;
        const distKm = (elLat && elLon) ? calcHaversineKm(lat, lon, elLat, elLon) : 9.9;
        if (distKm > radiusKm + 5) continue;

        if (el.tags.place) {
          const key = name.toLowerCase();
          if (seenPlace.has(key)) continue;
          seenPlace.add(key);
          if (elLat && elLon) {
            places.push({ name, lat: elLat, lon: elLon, distKm });
          }
          continue;
        }

        const cleanName = name.replace(/^(река|озеро|пруд|ручей|карьер|водохранилище|вдхр\.?)\s+/i, '').trim();
        const wKey = cleanName.toLowerCase();
        if (!cleanName || seenWater.has(wKey)) continue;
        seenWater.add(wKey);

        const { wType, typeTag } = classifyOsmWaterElement(el, name, s.isCoastal);
        const defDepth = WATER_PROFILES[wType]?.defD || 1.5;
        const isRiver = wType === 'big_river' || wType === 'small_river';
        const prefix = isRiver ? '🌊 р. ' : (wType.startsWith('sea') ? '⚓ ' : (wType === 'cooling_reservoir' ? '♨️ ' : '💧 '));
        const distStr = distKm < 1 ? `${Math.round(distKm * 1000)} м` : `${distKm} км`;

        waters.push({
          name: cleanName,
          label: `${prefix}${cleanName} [${typeTag}] • ${distStr}`,
          wType,
          typeTag,
          defDepth,
          distKm,
          lat: elLat || lat,
          lon: elLon || lon
        });
      }

      waters.sort((a, b) => a.distKm - b.distKm);
      places.sort((a, b) => a.distKm - b.distKm);

      overpassLoading = false;
      const topPlaces = places.slice(0, 14);
      const topWaters = waters.slice(0, 20);

      storage.saveNearbyWatersCache(lat, lon, radiusKm, topWaters, topPlaces);
      store.dispatch({ type: 'SET_NEARBY_PLACES', payload: topPlaces });
      store.dispatch({ type: 'SET_NEARBY_WATERS', payload: topWaters });
      return topWaters;
    } catch (e) {}
  }

  overpassLoading = false;
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
  if (typeof window !== 'undefined') window.__KLEV_RENDER_MAP__ = renderMap;
  if (!mapBoxEl || typeof L === 'undefined') return;
  const s = store.getState();
  const targetZoom = mapInstance ? clamp(mapInstance.getZoom(), 7, 14) : 10;
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
  const prevScrolls = Array.from(container.querySelectorAll('.chip-scroll-row')).map(el => el.scrollLeft);
  const s = store.getState();
  const availableWaters = getAvailableWaterTypes(s.basinCode, s.lat, s.lon);
  const prof = WATER_PROFILES[s.water] || WATER_PROFILES.small_river;
  const isRouteGeo = s.route === 'geo';
  const showDrawer = isRouteGeo ? true : mapOpen;
  const compatibleMethods = getMethodOptions(s.iceState, s.water);
  const activeRadius = s.waterRadiusKm === 120 ? 120 : 50;

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

      ${inlineGpsHint ? `<div style="margin-bottom:8px;padding:7px 11px;border-radius:var(--r-sm);background:var(--pill-warn-bg);color:var(--pill-warn-text);font-size:var(--fs-xs);font-weight:700;line-height:1.4;">ℹ️ ${inlineGpsHint}</div>` : ''}

      <div id="geoMapSection" style="display:${showDrawer ? 'block' : 'none'};margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--border);">
        <div style="display:flex;gap:6px;margin-bottom:8px;">
          <input type="search" id="geoSearchInput" class="input" style="flex:1;" placeholder="Поиск реки, озера, города или посёлка РФ...">
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
            <div style="font-size:var(--fs-xs);color:var(--muted);font-weight:700;margin-bottom:4px;">🏘 БЛИЖАЙШИЕ ГОРОДА И НАСЕЛЁННЫЕ ПУНКТЫ (единая база РФ • кликните для перехода):</div>
            <div class="chip-scroll-row">
              ${s.nearbyPlaces.map(p => `
                <button type="button" class="w-chip" data-nearby-place="${p.lat},${p.lon},${p.name}">🏘 ${p.name} • ${p.distKm} км</button>
              `).join('')}
            </div>
          </div>
        ` : ''}

        ${s.savedSpots.length ? `
          <div style="margin-top:8px;">
            <div style="font-size:var(--fs-xs);color:var(--muted);font-weight:700;margin-bottom:4px;">📌 СОХРАНЁННЫЕ РЫБОЛОВНЫЕ ТОЧКИ:</div>
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
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:6px;">
          <div style="font-size:var(--fs-xs);color:var(--muted);font-weight:700;">
            🌊 ВОДОЁМЫ В РАДИУСЕ <b>ДО ${activeRadius} КМ</b> (${(s.nearbyWaters || []).length} шт.)
            ${s.selectedWaterName ? `• выбран: <b style="color:var(--accent);">${s.selectedWaterName}</b> [${getWaterTypeShortTag(s.water)}]` : '(кликните для выбора)'}:
          </div>
          <div style="display:inline-flex;gap:5px;align-items:center;">
            <button type="button" class="btn btn-sm ${activeRadius === 50 ? 'btn-accent' : ''}" data-water-radius="50" style="min-height:30px;padding:3px 10px;">📡 До 50 км</button>
            <button type="button" class="btn btn-sm ${activeRadius === 120 ? 'btn-accent' : ''}" data-water-radius="120" style="min-height:30px;padding:3px 10px;">📡 До 120 км</button>
          </div>
        </div>
        <div class="chip-scroll-row">
          ${(s.nearbyWaters || []).map(w => {
            const isSelected = s.selectedWaterName ? (s.selectedWaterName === w.name) : (s.water === w.wType);
            return `<button type="button" class="w-chip ${isSelected ? 'active' : ''}" data-nearby-water="${w.wType}" data-nearby-name="${w.name || w.label}" data-nearby-depth="${w.defDepth || ''}">${w.label}</button>`;
          }).join('')}
        </div>
      </div>

      <div class="card" style="background:var(--card);margin-bottom:12px;padding:10px 12px;border:1px solid var(--border);">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:6px;">
          <span style="font-size:var(--fs-xs);font-weight:800;color:var(--accent);">🗺️ КАРТА ГЛУБИН И РЕЛЬЕФ ДНА: ${s.selectedWaterName || prof.name} (${getWaterTypeShortTag(s.water)})</span>
          <span class="pill pill-neutral" style="font-size:var(--fs-xs);">Эхолокационный диапазон: ${prof.minD}–${prof.maxD} м</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;font-size:var(--fs-xs);">
          <div style="background:var(--panel);padding:6px 8px;border-radius:6px;">
            <div style="color:var(--muted);font-size:var(--fs-xs);">ТЕКУЩИЙ ГОРИЗОНТ ЛОВЛИ</div>
            <div style="font-weight:800;font-size:var(--fs-sm);color:var(--accent);">${s.depth.toFixed(1)} м (свал / русло)</div>
          </div>
          <div style="background:var(--panel);padding:6px 8px;border-radius:6px;">
            <div style="color:var(--muted);font-size:var(--fs-xs);">ХАРАКТЕР РЕЛЬЕФА</div>
            <div style="font-weight:700;">${prof.flow > 1.5 ? 'Русловая бровка, песчано-галечный свал' : 'Илистое дно, перепады глубин, старичные ямы'}</div>
          </div>
          <div style="background:var(--panel);padding:6px 8px;border-radius:6px;">
            <div style="color:var(--muted);font-size:var(--fs-xs);">СКОРОСТЬ ТЕЧЕНИЯ (ВЛИЯЕТ НА ВОДУ И ЛЁД)</div>
            <div style="font-weight:700;">${prof.flow >= 2.0 ? 'Быстрое (до ' + prof.flow + ' м/с)' : (prof.flow >= 1.0 ? 'Умеренное (~' + prof.flow + ' м/с)' : 'Слабое / стоячая вода')}</div>
          </div>
        </div>
      </div>

      <div class="controls-grid">
        <div>
          <label for="geoWaterSelect" style="display:block;font-size:var(--fs-xs);color:var(--muted);font-weight:700;margin-bottom:3px;">ТИП ВОДНОГО ОБЪЕКТА</label>
          <select id="geoWaterSelect">
            ${availableWaters.map(w => `<option value="${w.id}" ${w.id === s.water ? 'selected' : ''}>${w.name}</option>`).join('')}
          </select>
        </div>

        <div>
          <label for="geoMethodSelect" style="display:block;font-size:var(--fs-xs);color:var(--muted);font-weight:700;margin-bottom:3px;">СНАСТЬ И СПОСОБ ЛОВЛИ</label>
          <select id="geoMethodSelect">
            ${compatibleMethods.map(m => `<option value="${m.val}" ${m.val === s.method ? 'selected' : ''}>${m.text}</option>`).join('')}
          </select>
        </div>

        <div>
          <label for="geoDepthRange" style="display:block;font-size:var(--fs-xs);color:var(--muted);font-weight:700;margin-bottom:3px;">
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
    if (Array.isArray(prevScrolls) && prevScrolls[idx] > 0) el.scrollLeft = prevScrolls[idx];
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

  container.querySelectorAll('[data-water-radius]').forEach(btn => {
    btn.addEventListener('click', () => {
      const nextRadius = parseInt(btn.getAttribute('data-water-radius'), 10) === 120 ? 120 : 50;
      store.dispatch({ type: 'SET_WATER_RADIUS', payload: nextRadius });
      const st = store.getState();
      getNearbyWatersAndPlaces(st.lat, st.lon, nextRadius);
      showToast(`Радиус поиска водоёмов и видового состава рыб: до ${nextRadius} км`, 'info');
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
      showToast(`Выбран водоём: ${wName} (${getWaterTypeShortTag(wType)})`, 'info');
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
  // 1. Синхронно подгружаем точки из локального резерва и немедленно отрисовываем карту/водоёмы (0 мс, без ожидания IndexedDB!)
  const localSpots = storage.getLocalBackup ? storage.getLocalBackup('spots') : [];
  if (Array.isArray(localSpots) && localSpots.length > 0) {
    store.dispatch({ type: 'SET_SAVED_SPOTS', payload: localSpots });
  }

  const s = store.getState();
  if (!s.locLabel || s.locLabel.includes('Определение') || s.locAdmin1 === 'Автоопределение') {
    resolveReverseGeocode(s.lat, s.lon);
  }

  getNearbyWatersAndPlaces(s.lat, s.lon, s.waterRadiusKm || 50);
  render(container);

  if (unsub) unsub();
  unsub = store.subscribe(
    st => {
      const activeDay = st.weatherDays?.[st.dayIdx] || st.weatherDays?.[2] || st.weatherDays?.[0];
      return {
        lat: st.lat,
        lon: st.lon,
        basinCode: st.basinCode,
        isCoastal: st.isCoastal,
        water: st.water,
        waterRadiusKm: st.waterRadiusKm,
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

  autoDetectStartupLocation();

  // 2. Асинхронная синхронизация сохранённых точек из IndexedDB после первичной отрисовки
  try {
    const spots = await storage.getAllFromStore('spots');
    if (Array.isArray(spots)) {
      store.dispatch({ type: 'SET_SAVED_SPOTS', payload: spots });
    }
  } catch (e) {}
}

export function destroy() {
  if (unsub) unsub();
}

export const geoModule = {
  setLocation,
  autoDetectStartupLocation,
  locateByIpFallback,
  detectUserPosition,
  resolveReverseGeocode,
  searchPlaceByQuery,
  requestGPS,
  getNearbyWatersAndPlaces,
  classifyOsmWaterElement,
  saveSpot,
  deleteSpot,
  renderMap,
  getMethodOptions,
  init,
  render,
  destroy
};
