import { safeModuleRun } from '../../core/events.js?v=2.9.2-r257';
import { store } from '../../core/store.js?v=2.9.2-r257';
import { calcHaversineKm, calcBearingDeg } from './geo.routing.js?v=2.9.2-r257';

export const LAST_REAL_USER_GPS_KEY = 'klev_pro_last_real_gps_v1';
export const GPSF_MODE_VMAX = { walk: 3.5, bike: 12, boat: 18, snowmobile: 30, car: 45 };

let _startupHomeCoords = null;
let _lastRealUserGps = null;

try {
  if (typeof localStorage !== 'undefined') {
    const rawSavedGps = localStorage.getItem(LAST_REAL_USER_GPS_KEY);
    if (rawSavedGps) {
      const parsedGps = JSON.parse(rawSavedGps);
      if (parsedGps && Number.isFinite(parsedGps.lat) && Number.isFinite(parsedGps.lon)) {
        _lastRealUserGps = parsedGps;
      }
    }
  }
} catch (_e) {}

const _GPSF = {
  lat: null,
  lon: null,
  varM2: 0,
  ts: 0,
  pend: null,
  pendN: 0,
  anchor: null,
  stillN: 0,
  moveN: 0
};
const _gpsFilterStats = { ok: 0, rejAcc: 0, rejStale: 0, rejOrder: 0, rejJump: 0, held: 0 };
let _gpsFiltered = null;

export function isManualLocationSession() {
  return typeof window !== 'undefined' && Boolean(window.__KLEV_MANUAL_LOC_SESSION__);
}

export function setManualLocationSession(active) {
  if (typeof window !== 'undefined') {
    window.__KLEV_MANUAL_LOC_SESSION__ = Boolean(active);
  }
  return Boolean(active);
}

export function getLastRealUserGps() {
  return _lastRealUserGps;
}

export function getGpsFiltered() {
  return _gpsFiltered;
}

export function getGpsFilterStats() {
  return _gpsFilterStats;
}

export function _gpsFilterReset() {
  Object.assign(_GPSF, {
    lat: null,
    lon: null,
    varM2: 0,
    ts: 0,
    pend: null,
    pendN: 0,
    anchor: null,
    stillN: 0,
    moveN: 0
  });
  _gpsFiltered = null;
}

export function _saveRealUserGpsCoords(lat, lon, acc = 12) {
  return safeModuleRun('geo:gps', () => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return _lastRealUserGps;
    _lastRealUserGps = { lat: Number(lat), lon: Number(lon), acc: Math.round(Number(acc) || 12), ts: Date.now() };
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(LAST_REAL_USER_GPS_KEY, JSON.stringify(_lastRealUserGps));
      }
    } catch (_e) {}
    return _lastRealUserGps;
  }, _lastRealUserGps);
}

export function getTrueUserGpsCoords(stateObj = null, liveGpsFix = null) {
  return safeModuleRun('geo:gps', () => {
    if (liveGpsFix && liveGpsFix.hasRealFix && Number.isFinite(liveGpsFix.lat) && Number.isFinite(liveGpsFix.lon)) {
      return { lat: liveGpsFix.lat, lon: liveGpsFix.lon, acc: liveGpsFix.acc || 10, isRealGps: true };
    }
    if (_lastRealUserGps && Number.isFinite(_lastRealUserGps.lat) && Number.isFinite(_lastRealUserGps.lon)) {
      return { lat: _lastRealUserGps.lat, lon: _lastRealUserGps.lon, acc: _lastRealUserGps.acc || 15, isRealGps: true };
    }
    const s = stateObj || store.getState();
    if (Array.isArray(s?.savedSpots) && s.savedSpots.length > 0) {
      const homeSpot = s.savedSpots.find(sp => sp && /дом|база|работа/i.test(String(sp.name || '')) && Number.isFinite(Number(sp.lat)) && Number.isFinite(Number(sp.lon)))
        || s.savedSpots.find(sp => sp && Number.isFinite(Number(sp.lat)) && Number.isFinite(Number(sp.lon)));
      if (homeSpot) {
        return { lat: Number(homeSpot.lat), lon: Number(homeSpot.lon), acc: 20, isRealGps: false };
      }
    }
    if (!_startupHomeCoords && Number.isFinite(Number(s?.lat)) && Number.isFinite(Number(s?.lon))) {
      _startupHomeCoords = { lat: Number(s.lat), lon: Number(s.lon) };
    }
    if (_startupHomeCoords) {
      return { lat: _startupHomeCoords.lat, lon: _startupHomeCoords.lon, acc: 25, isRealGps: false };
    }
    return {
      lat: Number.isFinite(Number(s?.lat)) ? Number(s.lat) : 55.7558,
      lon: Number.isFinite(Number(s?.lon)) ? Number(s.lon) : 37.6173,
      acc: 25,
      isRealGps: false
    };
  }, { lat: 55.7558, lon: 37.6173, acc: 25, isRealGps: false });
}

export function _estimateSatellitesFromAccuracy(accMeters, hasFix) {
  try {
    if (typeof window !== 'undefined' && window.AndroidBridge && typeof window.AndroidBridge.getGnssSatellitesUsed === 'function') {
      const hwUsed = Number(window.AndroidBridge.getGnssSatellitesUsed()) || 0;
      const hwVis = Number(window.AndroidBridge.getGnssSatellitesVisible()) || 0;
      if (hwUsed > 0) {
        return { used: hwUsed, visible: Math.max(hwUsed + 2, hwVis) };
      }
    }
  } catch (_e) {}
  if (!hasFix || !Number.isFinite(accMeters) || accMeters > 150) {
    return { used: 0, visible: 4 };
  }
  if (accMeters <= 3.5) return { used: 14, visible: 19 };
  if (accMeters <= 6.0) return { used: 12, visible: 17 };
  if (accMeters <= 10.0) return { used: 10, visible: 15 };
  if (accMeters <= 15.0) return { used: 8, visible: 13 };
  if (accMeters <= 25.0) return { used: 6, visible: 11 };
  if (accMeters <= 50.0) return { used: 4, visible: 9 };
  return { used: 3, visible: 7 };
}

export function _gpsFilterIngest(pos, opts = {}) {
  return safeModuleRun('geo:gps', () => {
    const accMax = opts.accMax || 50;
    const vmax = opts.vmax || GPSF_MODE_VMAX[opts.mode] || 20;
    const c = pos && pos.coords;
    if (!c) return null;
    const lat = Number(c.latitude);
    const lon = Number(c.longitude);
    const acc = Number(c.accuracy) > 0 ? Number(c.accuracy) : 50;
    const nowTs = Date.now();
    const rawTs = Number(pos.timestamp) || nowTs;
    const t = Math.abs(nowTs - rawTs) <= 6500 ? rawTs : nowTs;
    const vRep = Number.isFinite(Number(c.speed)) && Number(c.speed) >= 0 ? Number(c.speed) : null;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    // В фоне разрешаем сетевой провайдер, если спутниковый GPS не обновлялся дольше 7 секунд
    if (pos._isGps === false && _GPSF.lat !== null && (nowTs - (_GPSF.ts || 0) < 7000)) { _gpsFilterStats.rejAcc++; return null; }
    if (acc > accMax) { _gpsFilterStats.rejAcc++; return null; }
    if (nowTs - t > 12000) { _gpsFilterStats.rejStale++; return null; }
    if (_GPSF.ts && t < _GPSF.ts) { _GPSF.ts = t; }

    const out = (la, lo, held) => {
      _gpsFiltered = { lat: la, lon: lo, acc, speed: vRep, ts: t, held: !!held };
      _gpsFilterStats.ok++;
      if (held) _gpsFilterStats.held++;
      return _gpsFiltered;
    };

    if (_GPSF.lat === null) {
      Object.assign(_GPSF, { lat, lon, varM2: acc * acc, ts: t });
      return out(lat, lon, false);
    }

    const dt = Math.max(0.2, (t - _GPSF.ts) / 1000);
    const distM = calcHaversineKm(_GPSF.lat, _GPSF.lon, lat, lon) * 1000;

    const jumpLimit = Math.max(25, 3 * acc);
    const vLimit = Math.max(vmax, 2 * (vRep || 0) + 3);
    if (distM > jumpLimit && distM / dt > vLimit) {
      if (_GPSF.pend && calcHaversineKm(_GPSF.pend.lat, _GPSF.pend.lon, lat, lon) * 1000 < Math.max(15, 2 * acc)) {
        _GPSF.pendN++;
      } else {
        _GPSF.pend = { lat, lon };
        _GPSF.pendN = 1;
      }
      if (_GPSF.pendN < 3) {
        _gpsFilterStats.rejJump++;
        return null;
      }
      Object.assign(_GPSF, { lat, lon, varM2: acc * acc, ts: t, pend: null, pendN: 0, anchor: null, stillN: 0 });
      return out(lat, lon, false);
    }
    _GPSF.pend = null;
    _GPSF.pendN = 0;

    const q = Math.max(vmax * 0.5, 1.0);
    _GPSF.varM2 += dt * q * q;
    const k = _GPSF.varM2 / (_GPSF.varM2 + acc * acc);
    _GPSF.lat += k * (lat - _GPSF.lat);
    _GPSF.lon += k * (lon - _GPSF.lon);
    _GPSF.varM2 = (1 - k) * _GPSF.varM2;
    _GPSF.ts = t;

    const still = (vRep !== null ? vRep < 0.6 : distM < Math.max(2, acc * 0.5)) && distM < Math.max(5, acc);
    if (still) {
      _GPSF.stillN++;
      _GPSF.moveN = 0;
    } else {
      _GPSF.moveN++;
      _GPSF.stillN = 0;
    }
    if (!_GPSF.anchor && _GPSF.stillN >= 3) {
      _GPSF.anchor = { lat: _GPSF.lat, lon: _GPSF.lon };
    }
    if (_GPSF.anchor) {
      const dAnch = calcHaversineKm(_GPSF.anchor.lat, _GPSF.anchor.lon, _GPSF.lat, _GPSF.lon) * 1000;
      if (_GPSF.moveN >= 2 || (vRep !== null && vRep > 1.0) || dAnch > Math.max(8, 2.5 * acc)) {
        _GPSF.anchor = null;
      } else {
        return out(_GPSF.anchor.lat, _GPSF.anchor.lon, true);
      }
    }
    return out(_GPSF.lat, _GPSF.lon, false);
  }, null);
}

export function computeGpsTelemetryStep(pos, prevTelemetryFix = null, fallbackHeadingDeg = 0) {
  return safeModuleRun('geo:gps', () => {
    if (!pos || !pos.coords) return null;
    const lat = Number(pos.coords.latitude);
    const lon = Number(pos.coords.longitude);
    const acc = Math.max(1, Math.round(Number(pos.coords.accuracy) || 15));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const sats = _estimateSatellitesFromAccuracy(acc, true);
    const fixTs = Number(pos.timestamp) || Date.now();
    let spMs = (Number.isFinite(Number(pos.coords.speed)) && Number(pos.coords.speed) >= 0) ? Number(pos.coords.speed) : -1;
    let hdg = (Number.isFinite(Number(pos.coords.heading)) && Number(pos.coords.heading) >= 0) ? Number(pos.coords.heading) : -1;
    if (prevTelemetryFix && Number.isFinite(prevTelemetryFix.lat) && Number.isFinite(prevTelemetryFix.lon)) {
      const dtS = Math.max(0.4, (fixTs - prevTelemetryFix.ts) / 1000);
      const stepM = calcHaversineKm(prevTelemetryFix.lat, prevTelemetryFix.lon, lat, lon) * 1000;
      // Вычисляем скорость по смещению координат только если шаг превышает радиус комнатного GPS-шума
      if (spMs < 0 && dtS <= 15 && stepM >= Math.max(6.0, acc * 0.55) && acc <= 35) {
        spMs = stepM / dtS;
      }
      if (hdg < 0 && stepM >= Math.max(4.5, acc * 0.45) && dtS <= 15) {
        hdg = calcBearingDeg(prevTelemetryFix.lat, prevTelemetryFix.lon, lat, lon);
      }
    }
    if (spMs < 0) spMs = 0;
    if (hdg < 0) hdg = fallbackHeadingDeg;
    return {
      lat,
      lon,
      acc,
      sats,
      fixTs,
      spMs,
      hdg,
      nextPrevTelemetryFix: { lat, lon, ts: fixTs }
    };
  }, null);
}
