import { safeModuleRun } from '../../core/events.js?v=2.9.2-r257';

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

// Уплотнение отрезков полилинии маршрута до шага <= 12 метров (с адаптивным увеличением шага для маршрутов > 25 км)
export function _densifyPolylineToMaxStep(rawPts, maxStepKm = 0.012) {
  return safeModuleRun('geo:routing', () => {
    if (!Array.isArray(rawPts) || rawPts.length < 2) return Array.isArray(rawPts) ? rawPts : [];
    let totalKm = 0;
    for (let i = 1; i < rawPts.length; i++) {
      const p1 = rawPts[i - 1];
      const p2 = rawPts[i];
      if (p1 && p2 && Number.isFinite(p1.lat) && Number.isFinite(p1.lon) && Number.isFinite(p2.lat) && Number.isFinite(p2.lon)) {
        totalKm += calcHaversineKm(p1.lat, p1.lon, p2.lat, p2.lon);
      }
    }
    const effStepKm = totalKm > 25
      ? Math.max(maxStepKm, Math.min(0.050, totalKm / 2500))
      : maxStepKm;
    const out = [rawPts[0]];
    for (let i = 1; i < rawPts.length; i++) {
      const p1 = rawPts[i - 1];
      const p2 = rawPts[i];
      const segKm = calcHaversineKm(p1.lat, p1.lon, p2.lat, p2.lon);
      if (segKm > effStepKm) {
        const steps = Math.min(250, Math.ceil(segKm / effStepKm));
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

export function evaluateRouteSegments(finalPoly, transportMode = 'car', boatGaps = []) {
  return safeModuleRun('geo:routing', () => {
    const pts = Array.isArray(finalPoly) ? finalPoly : [];
    const gaps = (transportMode === 'boat' && Array.isArray(boatGaps)) ? boatGaps : [];
    const isGapSeg = (segIdx) => gaps.some(g => Array.isArray(g) && segIdx >= g[0] && segIdx < g[1]);
    let totalKm = 0;
    let waterKm = 0;
    let gapKm = 0;
    const turns = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const d = calcHaversineKm(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
      totalKm += d;
      if (isGapSeg(i)) {
        gapKm += d;
      } else {
        waterKm += d;
      }
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
    const hasGaps = gaps.length > 0 && gapKm > 0;
    const speed = ARC_TRANSPORT_MODES[transportMode]?.avgSpeedKmh || 30;
    const effectiveKmForEta = (transportMode === 'boat' && hasGaps)
      ? (waterKm > 0.01 ? waterKm : totalKm)
      : totalKm;
    const etaMin = Math.max(1, Math.round((effectiveKmForEta / speed) * 60));
    return {
      totalKm,
      waterKm,
      gapKm,
      hasGaps,
      distKm: Math.max(0.05, totalKm),
      turns,
      etaMin
    };
  }, { totalKm: 0, waterKm: 0, gapKm: 0, hasGaps: false, distKm: 0.05, turns: [], etaMin: 1 });
}

function _cleanXmlEntities(str = '') {
  return String(str || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, '')
    .trim();
}

export function cleanTrackNameFromFileName(fileName = '') {
  const base = String(fileName || '').split(/[\\/]/).pop() || '';
  const cleaned = base
    .replace(/\.(?:gpx\.bin|gpx|bin|kml|kmz|geojson|json|xml|trk|plt)+$/i, '')
    .replace(/\.(?:gpx|bin|kml|kmz|geojson|json|xml|trk|plt)+$/i, '')
    .trim();
  return cleaned || 'Загруженный трек';
}

export function parseTrackTimestampMs(rawVal) {
  if (rawVal === null || rawVal === undefined) return null;
  const s = String(rawVal).trim();
  if (!s) return null;
  if (/^\d{12,14}$/.test(s)) {
    const ms = Number(s);
    return Number.isFinite(ms) ? ms : null;
  }
  if (/^\d{9,11}(?:\.\d+)?$/.test(s)) {
    const sec = parseFloat(s);
    return Number.isFinite(sec) ? Math.round(sec * 1000) : null;
  }
  const parsed = Date.parse(s);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Распаковка .KMZ (ZIP-архив с doc.kml или *.kml внутри)
 * Поддерживает разбор Central Directory (для потоковых ZIP с General Purpose Bit 3, как в GeoTracker)
 * и прямое сканирование локальных ZIP-заголовков 0x04034b50, методы сжатия 0 (Stored) и 8 (Deflate-Raw).
 */
export async function extractKmlFromKmzBuffer(arrayBuffer) {
  if (!arrayBuffer) throw new Error('Пустой буфер KMZ');
  const bytes = arrayBuffer instanceof Uint8Array
    ? arrayBuffer
    : (arrayBuffer.buffer instanceof ArrayBuffer
        ? new Uint8Array(arrayBuffer.buffer, arrayBuffer.byteOffset, arrayBuffer.byteLength)
        : new Uint8Array(arrayBuffer));
  if (bytes.length < 30) throw new Error('Некорректный размер KMZ-архива');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder('utf-8');

  const entries = [];

  // 1. Сначала ищем End of Central Directory (0x06054b50), где всегда указаны точные размеры сжатых данных
  let eocdOffset = -1;
  const minEocd = Math.max(0, bytes.length - 65558);
  for (let i = bytes.length - 22; i >= minEocd; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset >= 0) {
    const totalCdEntries = view.getUint16(eocdOffset + 10, true);
    const cdOffset = view.getUint32(eocdOffset + 16, true);
    let ptr = cdOffset;
    for (let e = 0; e < totalCdEntries && ptr + 46 <= bytes.length; e++) {
      if (view.getUint32(ptr, true) !== 0x02014b50) break;
      const compression = view.getUint16(ptr + 10, true);
      const compSize = view.getUint32(ptr + 20, true);
      const uncompSize = view.getUint32(ptr + 24, true);
      const nameLen = view.getUint16(ptr + 28, true);
      const extraLen = view.getUint16(ptr + 30, true);
      const commentLen = view.getUint16(ptr + 32, true);
      const localHdrOffset = view.getUint32(ptr + 42, true);
      const entryName = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
      ptr += 46 + nameLen + extraLen + commentLen;

      if (localHdrOffset + 30 <= bytes.length && view.getUint32(localHdrOffset, true) === 0x04034b50) {
        const lNameLen = view.getUint16(localHdrOffset + 26, true);
        const lExtraLen = view.getUint16(localHdrOffset + 28, true);
        const dataStart = localHdrOffset + 30 + lNameLen + lExtraLen;
        if (dataStart + compSize <= bytes.length) {
          entries.push({
            name: entryName,
            compression,
            compSize,
            uncompSize,
            compData: bytes.subarray(dataStart, dataStart + compSize)
          });
        }
      }
    }
  }

  // 2. Резервный проход по локальным ZIP-заголовкам 0x04034b50 (если Central Directory отсутствует)
  if (entries.length === 0) {
    let offset = 0;
    while (offset + 30 <= bytes.length) {
      const sig = view.getUint32(offset, true);
      if (sig !== 0x04034b50) break;
      const compression = view.getUint16(offset + 8, true);
      const compSize = view.getUint32(offset + 18, true);
      const uncompSize = view.getUint32(offset + 22, true);
      const nameLen = view.getUint16(offset + 26, true);
      const extraLen = view.getUint16(offset + 28, true);
      const nameBytes = bytes.subarray(offset + 30, offset + 30 + nameLen);
      const entryName = decoder.decode(nameBytes);
      const dataStart = offset + 30 + nameLen + extraLen;
      if (compSize === 0 || dataStart + compSize > bytes.length) break;
      entries.push({
        name: entryName,
        compression,
        compSize,
        uncompSize,
        compData: bytes.subarray(dataStart, dataStart + compSize)
      });
      offset = dataStart + compSize;
    }
  }

  if (entries.length === 0) {
    throw new Error('В KMZ-архиве не найдены локальные файлы');
  }

  const kmlEntry =
    entries.find(e => /(?:^|\/)doc\.kml$/i.test(e.name)) ||
    entries.find(e => /\.kml$/i.test(e.name)) ||
    entries[0];

  if (kmlEntry.compression === 0) {
    return decoder.decode(kmlEntry.compData);
  }

  if (kmlEntry.compression === 8) {
    try {
      if (typeof process !== 'undefined' && process.versions && process.versions.node) {
        const reqFn = typeof Function === 'function' ? Function('return typeof require === "function" ? require : null')() : null;
        let zlibMod = reqFn ? reqFn('zlib') : (typeof process.getBuiltinModule === 'function' ? process.getBuiltinModule('zlib') : null);
        if (!zlibMod && typeof Function === 'function') {
          zlibMod = await Function('m', 'return import(m)')('node:zlib').catch(() => null);
        }
        const inflateRawSync = zlibMod?.inflateRawSync || zlibMod?.default?.inflateRawSync;
        if (typeof inflateRawSync === 'function') {
          return decoder.decode(inflateRawSync(kmlEntry.compData));
        }
      }
    } catch (_e) {}
    if (typeof DecompressionStream !== 'undefined') {
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      writer.write(kmlEntry.compData);
      writer.close();
      const ab = await new Response(ds.readable).arrayBuffer();
      return decoder.decode(new Uint8Array(ab));
    }
    throw new Error('Среда не поддерживает распаковку Deflate-Raw');
  }

  throw new Error(`Неподдерживаемый метод сжатия KMZ: ${kmlEntry.compression}`);
}

/**
 * Универсальный парсер сторонних треков (.gpx, .gpx.bin, .kml, .geojson, .json)
 */
export function parseTrackFromExternalFileText(fileText, fileName = '') {
  if (!fileText || typeof fileText !== 'string') return null;
  const trimmed = fileText.trim();
  if (!trimmed) return null;

  const fallbackTitle = cleanTrackNameFromFileName(fileName);
  let title = '';
  let format = 'gpx';
  const rawPoints = [];

  if (trimmed.startsWith('<')) {
    const isKml = /<kml\b|<gx:Track\b|<LineString\b/i.test(trimmed) && !/<gpx\b/i.test(trimmed);
    if (isKml) {
      format = 'kml';
      const docIdx = trimmed.search(/<Document\b/i);
      if (docIdx >= 0) {
        const docHead = trimmed.slice(docIdx, docIdx + 2000).split(/<(?:Style|Schema|Placemark|Folder)\b/i)[0];
        const mDocName = docHead.match(/<name[^>]*>([\s\S]*?)<\/name>/i);
        if (mDocName) title = _cleanXmlEntities(mDocName[1]);
      }
      if (!title) {
        const pmNameMatch = trimmed.match(/<Placemark\b[^>]*>[\s\S]{0,1200}?<name[^>]*>([\s\S]*?)<\/name>/i);
        if (pmNameMatch) {
          const cand = _cleanXmlEntities(pmNameMatch[1]);
          if (cand && (!/^Track\s*\d+$/i.test(cand) || !fileName)) {
            title = cand;
          }
        }
      }

      // 1. Разбор <gx:Track> с <when> и <gx:coord>lon lat alt</gx:coord>
      const gxTrackRegex = /<gx:Track\b[^>]*>([\s\S]*?)<\/gx:Track>/gi;
      let gxMatch;
      while ((gxMatch = gxTrackRegex.exec(trimmed)) !== null) {
        const trackBlock = gxMatch[1] || '';
        const whens = [];
        const whenRegex = /<when[^>]*>([^<]+)<\/when>/gi;
        let wm;
        while ((wm = whenRegex.exec(trackBlock)) !== null) {
          whens.push(parseTrackTimestampMs(wm[1]));
        }
        const coordRegex = /<gx:coord[^>]*>\s*([0-9.+-]+)\s+([0-9.+-]+)(?:\s+([0-9.+-]+))?\s*<\/gx:coord>/gi;
        let cm;
        let cIdx = 0;
        while ((cm = coordRegex.exec(trackBlock)) !== null) {
          const lon = parseFloat(cm[1]);
          const lat = parseFloat(cm[2]);
          const ele = cm[3] !== undefined ? parseFloat(cm[3]) : undefined;
          const ts = cIdx < whens.length ? whens[cIdx] : null;
          cIdx++;
          if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
            const pt = {
              lat: Number(lat.toFixed(7)),
              lon: Number(lon.toFixed(7))
            };
            if (Number.isFinite(ele)) pt.ele = Number(ele.toFixed(2));
            if (Number.isFinite(ts)) pt.ts = ts;
            rawPoints.push(pt);
          }
        }
      }

      // 2. Разбор <LineString><coordinates>lon,lat,alt ...</coordinates></LineString>
      if (rawPoints.length < 2 && /<LineString\b/i.test(trimmed)) {
        const lsRegex = /<LineString\b[^>]*>([\s\S]*?)<\/LineString>/gi;
        let lsMatch;
        while ((lsMatch = lsRegex.exec(trimmed)) !== null) {
          const coordsMatch = (lsMatch[1] || '').match(/<coordinates[^>]*>([\s\S]*?)<\/coordinates>/i);
          if (coordsMatch) {
            const tuples = coordsMatch[1].trim().split(/\s+/);
            for (const tup of tuples) {
              if (!tup) continue;
              const parts = tup.split(',');
              if (parts.length >= 2) {
                const lon = parseFloat(parts[0]);
                const lat = parseFloat(parts[1]);
                const ele = parts[2] !== undefined ? parseFloat(parts[2]) : undefined;
                if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
                  const pt = {
                    lat: Number(lat.toFixed(7)),
                    lon: Number(lon.toFixed(7))
                  };
                  if (Number.isFinite(ele)) pt.ele = Number(ele.toFixed(2));
                  rawPoints.push(pt);
                }
              }
            }
          }
        }
      }
    } else {
      // GPX 1.0 / 1.1 (<trk>/<trkseg>/<trkpt> или <rte>/<rtept>)
      format = 'gpx';
      const trkIdx = trimmed.search(/<trk\b/i);
      if (trkIdx >= 0) {
        const segIdx = trimmed.indexOf('<trkseg', trkIdx);
        const trkHead = trimmed.slice(trkIdx, segIdx > trkIdx ? segIdx : trkIdx + 1800);
        const mTrkName = trkHead.match(/<name[^>]*>([\s\S]*?)<\/name>/i);
        if (mTrkName) title = _cleanXmlEntities(mTrkName[1]);
      }
      if (!title) {
        const rteIdx = trimmed.search(/<rte\b/i);
        if (rteIdx >= 0) {
          const rtePtIdx = trimmed.indexOf('<rtept', rteIdx);
          const rteHead = trimmed.slice(rteIdx, rtePtIdx > rteIdx ? rtePtIdx : rteIdx + 1800);
          const mRteName = rteHead.match(/<name[^>]*>([\s\S]*?)<\/name>/i);
          if (mRteName) title = _cleanXmlEntities(mRteName[1]);
        }
      }
      if (!title) {
        const metaMatch = trimmed.match(/<metadata\b[^>]*>([\s\S]*?)<\/metadata>/i);
        if (metaMatch) {
          const metaClean = metaMatch[1].replace(/<author\b[\s\S]*?<\/author>/gi, '');
          const mMetaName = metaClean.match(/<name[^>]*>([\s\S]*?)<\/name>/i);
          if (mMetaName) title = _cleanXmlEntities(mMetaName[1]);
        }
      }

      const extractGpxPointsByTag = (tagName) => {
        const rgx = new RegExp(`<${tagName}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/${tagName}>)`, 'gi');
        let m;
        while ((m = rgx.exec(trimmed)) !== null) {
          const attrs = m[1] || '';
          const inner = m[2] || '';
          const latM = attrs.match(/\blat=["']([0-9.+-]+)["']/i);
          const lonM = attrs.match(/\blon=["']([0-9.+-]+)["']/i);
          if (!latM || !lonM) continue;
          const lat = parseFloat(latM[1]);
          const lon = parseFloat(lonM[1]);
          if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
          const pt = {
            lat: Number(lat.toFixed(7)),
            lon: Number(lon.toFixed(7))
          };
          if (inner) {
            const eleM = inner.match(/<ele[^>]*>([0-9.+-]+)<\/ele>/i);
            const accM = inner.match(/<acc[^>]*>([0-9.+-]+)<\/acc>/i);
            const timeM = inner.match(/<time[^>]*>([^<]+)<\/time>/i);
            if (eleM && Number.isFinite(parseFloat(eleM[1]))) pt.ele = Number(parseFloat(eleM[1]).toFixed(2));
            if (accM && Number.isFinite(parseFloat(accM[1]))) pt.acc = Number(parseFloat(accM[1]).toFixed(1));
            if (timeM) {
              const ts = parseTrackTimestampMs(timeM[1]);
              if (Number.isFinite(ts)) pt.ts = ts;
            }
          }
          rawPoints.push(pt);
        }
      };

      extractGpxPointsByTag('trkpt');
      if (rawPoints.length < 2) {
        rawPoints.length = 0;
        extractGpxPointsByTag('rtept');
      }
    }
  } else if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    format = 'geojson';
    try {
      const parsed = JSON.parse(trimmed);
      title = String(parsed?.name || parsed?.title || parsed?.properties?.name || parsed?.features?.[0]?.properties?.name || '').trim();
      const pushCoordPair = (lat, lon, ele, ts) => {
        const la = Number(lat);
        const lo = Number(lon);
        if (Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180) {
          const pt = { lat: Number(la.toFixed(7)), lon: Number(lo.toFixed(7)) };
          if (Number.isFinite(Number(ele))) pt.ele = Number(Number(ele).toFixed(2));
          if (Number.isFinite(Number(ts))) pt.ts = Number(ts);
          rawPoints.push(pt);
        }
      };
      const extractFromGeoJsonGeom = (geom) => {
        if (!geom || typeof geom !== 'object') return;
        if (geom.type === 'LineString' && Array.isArray(geom.coordinates)) {
          for (const c of geom.coordinates) {
            if (Array.isArray(c) && c.length >= 2) pushCoordPair(c[1], c[0], c[2]);
          }
        } else if (geom.type === 'MultiLineString' && Array.isArray(geom.coordinates)) {
          for (const line of geom.coordinates) {
            if (Array.isArray(line)) {
              for (const c of line) {
                if (Array.isArray(c) && c.length >= 2) pushCoordPair(c[1], c[0], c[2]);
              }
            }
          }
        }
      };
      if (parsed?.type === 'FeatureCollection' && Array.isArray(parsed.features)) {
        for (const f of parsed.features) extractFromGeoJsonGeom(f?.geometry);
      } else if (parsed?.type === 'Feature' && parsed.geometry) {
        extractFromGeoJsonGeom(parsed.geometry);
      } else if (parsed?.type === 'LineString' || parsed?.type === 'MultiLineString') {
        extractFromGeoJsonGeom(parsed);
      } else {
        const ptsArr = Array.isArray(parsed)
          ? parsed
          : (Array.isArray(parsed?.points) ? parsed.points : (Array.isArray(parsed?.track) ? parsed.track : []));
        for (const item of ptsArr) {
          if (Array.isArray(item) && item.length >= 2) {
            pushCoordPair(item[0], item[1], item[2]);
          } else if (item && typeof item === 'object' && Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lon ?? item.lng))) {
            pushCoordPair(item.lat, item.lon ?? item.lng, item.ele ?? item.alt, parseTrackTimestampMs(item.ts ?? item.time));
          }
        }
      }
    } catch (_e) {
      return null;
    }
  }

  if (rawPoints.length < 2) return null;

  const finalTitle = title || fallbackTitle || 'Загруженный трек';
  const startPt = rawPoints[0];
  const finishPt = rawPoints[rawPoints.length - 1];

  let exactTotalKm = 0;
  for (let i = 1; i < rawPoints.length; i++) {
    exactTotalKm += calcHaversineKm(rawPoints[i - 1].lat, rawPoints[i - 1].lon, rawPoints[i].lat, rawPoints[i].lon);
  }
  const totalDistKm = Number(Math.max(0.01, exactTotalKm).toFixed(3));

  // Умное прореживание simplifyTrackRdp для треков длиннее 1500 точек (допуск 5–6 м, сжатие до ~800–1300 точек с обязательным сохранением Старта А и Финиша Б)
  let simplifiedPoints = rawPoints;
  if (rawPoints.length > 1500) {
    let epsM = 5.5;
    simplifiedPoints = simplifyTrackRdp(rawPoints, epsM);
    while (simplifiedPoints.length > 1300 && epsM < 25) {
      epsM = Number((epsM * 1.25).toFixed(2));
      simplifiedPoints = simplifyTrackRdp(rawPoints, epsM);
    }
    if (simplifiedPoints.length < 800) {
      // Дополняем ключевые вершины RDP опорными точками исходного трека до диапазона ~850–1150 точек
      const rdpSet = new Set(simplifiedPoints);
      const neededExtra = Math.max(0, 950 - simplifiedPoints.length);
      const stride = Math.max(2, Math.floor(rawPoints.length / (neededExtra + 1)));
      const merged = [rawPoints[0]];
      for (let i = 1; i < rawPoints.length - 1; i++) {
        if (rdpSet.has(rawPoints[i]) || (i % stride === 0 && merged.length < 1250)) {
          merged.push(rawPoints[i]);
        }
      }
      merged.push(rawPoints[rawPoints.length - 1]);
      simplifiedPoints = merged;
    }
    if (simplifiedPoints.length < 2) {
      simplifiedPoints = [startPt, finishPt];
    } else {
      simplifiedPoints[0] = startPt;
      simplifiedPoints[simplifiedPoints.length - 1] = finishPt;
    }
  }

  const now = Date.now();
  return {
    id: `ext_trk_${now}_${Math.random().toString(36).slice(2, 7)}`,
    title: finalTitle,
    name: finalTitle,
    fileName: String(fileName || ''),
    format,
    rawPointCount: rawPoints.length,
    points: simplifiedPoints,
    totalDistKm,
    startLat: startPt.lat,
    startLon: startPt.lon,
    originStartLat: startPt.lat,
    originStartLon: startPt.lon,
    destLat: finishPt.lat,
    destLon: finishPt.lon,
    startPoint: { ...startPt },
    finishPoint: { ...finishPt },
    startLabel: `Старт А (${startPt.lat.toFixed(5)}°N, ${startPt.lon.toFixed(5)}°E)`,
    finishLabel: `Финиш Б (${finishPt.lat.toFixed(5)}°N, ${finishPt.lon.toFixed(5)}°E)`,
    startedAt: startPt.ts || now,
    finishedAt: finishPt.ts || now,
    isExternalTrack: true,
    alreadySaved: true,
    status: 'completed'
  };
}
