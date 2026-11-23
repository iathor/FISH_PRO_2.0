import { safeModuleRun } from '../../core/events.js?v=2.9.3-r239';

export const ARC_TRANSPORT_MODES = {
  car: {
    id: 'car',
    label: 'Автомобиль',
    avgSpeedKmh: 45,
    svg: '<svg class="k-svg" viewBox="0 0 24 24" fill="none"><use href="#transport-car"/></svg>'
  },
  snowmobile: {
    id: 'snowmobile',
    label: 'Снегоход/Мотособака',
    avgSpeedKmh: 28,
    svg: '<svg class="k-svg" viewBox="0 0 24 24" fill="none"><use href="#transport-snowmobile"/></svg>'
  },
  boat: {
    id: 'boat',
    label: 'Лодка',
    avgSpeedKmh: 20,
    svg: '<svg class="k-svg" viewBox="0 0 24 24" fill="none"><use href="#transport-boat"/></svg>'
  },
  bike: {
    id: 'bike',
    label: 'Велосипед',
    avgSpeedKmh: 16,
    svg: '<svg class="k-svg" viewBox="0 0 24 24" fill="none"><use href="#transport-bicycle"/></svg>'
  },
  walk: {
    id: 'walk',
    label: 'Пешком',
    avgSpeedKmh: 4.5,
    svg: '<svg class="k-svg" viewBox="0 0 24 24" fill="none"><use href="#transport-walk"/></svg>'
  }
};

export function calcHaversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 100000) / 100000;
}

export function calcBearingDeg(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const p1 = lat1 * toRad;
  const p2 = lat2 * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const y = Math.sin(dLon) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dLon);
  return (Math.atan2(y, x) * toDeg + 360) % 360;
}

export function bearingToCompassRu(deg) {
  const dirs = ['С (Север)', 'СВ (Северо-Восток)', 'В (Восток)', 'ЮВ (Юго-Восток)', 'Ю (Юг)', 'ЮЗ (Юго-Запад)', 'З (Запад)', 'СЗ (Северо-Запад)'];
  return dirs[Math.round(((Number(deg) || 0) % 360) / 45) % 8];
}

// Уплотнение отрезков полилинии маршрута до шага <= 12 метров (чтобы на длинных прямых улицах и дорогах не было ложного отклонения)
export function _densifyPolylineToMaxStep(rawPts, maxStepKm = 0.012) {
  return safeModuleRun('geo:routing', () => {
    if (!Array.isArray(rawPts) || rawPts.length < 2) return Array.isArray(rawPts) ? rawPts : [];
    const out = [rawPts[0]];
    for (let i = 1; i < rawPts.length; i++) {
      const p1 = rawPts[i - 1];
      const p2 = rawPts[i];
      const segKm = calcHaversineKm(p1.lat, p1.lon, p2.lat, p2.lon);
      if (segKm > maxStepKm) {
        const steps = Math.min(250, Math.ceil(segKm / maxStepKm));
        for (let s = 1; s < steps; s++) {
          const t = s / steps;
          out.push({
            lat: Number((p1.lat + (p2.lat - p1.lat) * t).toFixed(6)),
            lon: Number((p1.lon + (p2.lon - p1.lon) * t).toFixed(6)),
            snapped: Boolean(p2.snapped)
          });
        }
      }
      out.push(p2);
    }
    return out;
  }, Array.isArray(rawPts) ? rawPts : []);
}

// Фильтрация одиночных сотовых выбросов БЕЗ срезания прямых углов перекрёстков и привязанных к дорогам точек
export function _smoothRecordedTrackPoints(rawPts) {
  return safeModuleRun('geo:routing', () => {
    if (!Array.isArray(rawPts) || rawPts.length < 3) return Array.isArray(rawPts) ? rawPts : [];
    const filtered = [rawPts[0]];
    for (let i = 1; i < rawPts.length; i++) {
      const prev = filtered[filtered.length - 1];
      const cur = rawPts[i];
      if (!cur || !Number.isFinite(cur.lat) || !Number.isFinite(cur.lon)) continue;
      const dKm = calcHaversineKm(prev.lat, prev.lon, cur.lat, cur.lon);
      // Отсекаем только явный одиночный "телепорт" базовой станции (> 130 м в сторону с мгновенным возвратом обратно в радиус 25 м)
      if (!cur.snapped && i + 1 < rawPts.length && dKm > 0.13) {
        const next = rawPts[i + 1];
        const prevToNextKm = calcHaversineKm(prev.lat, prev.lon, next.lat, next.lon);
        if (prevToNextKm < 0.025) {
          continue;
        }
      }
      filtered.push(cur);
    }
    return filtered;
  }, Array.isArray(rawPts) ? rawPts : []);
}

export function simplifyTrackRdp(points, epsM = 3) {
  return safeModuleRun('geo:routing', () => {
    if (!Array.isArray(points) || points.length < 3) return Array.isArray(points) ? points.slice() : [];
    const toXY = (p, lat0) => ({ x: p.lon * 111320 * Math.cos(lat0 * Math.PI / 180), y: p.lat * 110540 });
    const lat0 = points[0].lat;
    const xy = points.map(p => toXY(p, lat0));
    const keep = new Uint8Array(points.length);
    keep[0] = 1;
    keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      let maxD = 0;
      let idx = -1;
      for (let i = a + 1; i < b; i++) {
        const dx = xy[b].x - xy[a].x;
        const dy = xy[b].y - xy[a].y;
        const len2 = dx * dx + dy * dy;
        const t = len2 ? Math.max(0, Math.min(1, ((xy[i].x - xy[a].x) * dx + (xy[i].y - xy[a].y) * dy) / len2)) : 0;
        const d = Math.hypot(xy[i].x - (xy[a].x + t * dx), xy[i].y - (xy[a].y + t * dy));
        if (d > maxD) { maxD = d; idx = i; }
      }
      if (maxD > epsM && idx > 0) {
        keep[idx] = 1;
        stack.push([a, idx], [idx, b]);
      }
    }
    return points.filter((_, i) => keep[i]);
  }, Array.isArray(points) ? points.slice() : []);
}

export function evaluateRouteSegments(finalPoly, transportMode = 'car') {
  return safeModuleRun('geo:routing', () => {
    const pts = Array.isArray(finalPoly) ? finalPoly : [];
    let totalKm = 0;
    const turns = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const d = calcHaversineKm(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
      totalKm += d;
      if (i > 0 && i < pts.length - 1) {
        const b1 = calcBearingDeg(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
        const b2 = calcBearingDeg(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
        const diff = ((b2 - b1 + 540) % 360) - 180;
        if (Math.abs(diff) >= 28) {
          turns.push({
            pt: pts[i],
            dirText: diff > 0 ? 'Направо' : 'Налево',
            dirCode: diff > 0 ? 'right' : 'left',
            distFromStartKm: totalKm
          });
        }
      }
    }
    const speed = ARC_TRANSPORT_MODES[transportMode]?.avgSpeedKmh || 30;
    const etaMin = Math.max(1, Math.round((totalKm / speed) * 60));
    return {
      totalKm,
      distKm: Math.max(0.05, totalKm),
      turns,
      etaMin
    };
  }, { totalKm: 0, distKm: 0.05, turns: [], etaMin: 1 });
}
