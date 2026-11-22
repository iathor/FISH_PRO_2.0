/**
 * Grid-based A* off-road / water / winter router for Клёв ПРО 2.0
 * Modes: 'boat' (water bodies, rivers, fairway, island holes, dam/weir barriers)
 *        'snowmobile' (ice-gated water, winter roads, cutlines, trails, buildings/fences avoidance)
 */

const EARTH_R = 6371000;
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

export function makeProj(lat0, lon0) {
  const cos0 = Math.cos(lat0 * DEG2RAD);
  return {
    toM(lat, lon) {
      return [
        (lon - lon0) * DEG2RAD * EARTH_R * cos0,
        (lat - lat0) * DEG2RAD * EARTH_R
      ];
    },
    toLL(x, y) {
      return [
        lat0 + (y / EARTH_R) * RAD2DEG,
        lon0 + (x / (EARTH_R * cos0)) * RAD2DEG
      ];
    }
  };
}

export function chooseGrid(a, b, padRatio = 0.35, minPadM = 1200, maxCells = 140000) {
  const lat0 = (a[0] + b[0]) / 2;
  const lon0 = (a[1] + b[1]) / 2;
  const proj = makeProj(lat0, lon0);
  const [ax, ay] = proj.toM(a[0], a[1]);
  const [bx, by] = proj.toM(b[0], b[1]);
  const distM = Math.hypot(bx - ax, by - ay);
  const padM = Math.max(minPadM, distM * padRatio);

  const minX = Math.min(ax, bx) - padM;
  const maxX = Math.max(ax, bx) + padM;
  const minY = Math.min(ay, by) - padM;
  const maxY = Math.max(ay, by) + padM;
  const widthM = Math.max(200, maxX - minX);
  const heightM = Math.max(200, maxY - minY);

  let cellM = distM < 3000 ? 18 : (distM < 10000 ? 30 : (distM < 25000 ? 55 : 90));
  while (Math.ceil(widthM / cellM) * Math.ceil(heightM / cellM) > maxCells) {
    cellM = Math.ceil(cellM * 1.2);
  }
  const cols = Math.max(8, Math.ceil(widthM / cellM));
  const rows = Math.max(8, Math.ceil(heightM / cellM));

  const sw = proj.toLL(minX, minY);
  const ne = proj.toLL(maxX, maxY);
  const bboxStr = `${sw[0].toFixed(5)},${sw[1].toFixed(5)},${ne[0].toFixed(5)},${ne[1].toFixed(5)}`;

  return {
    proj,
    minX,
    minY,
    maxX,
    maxY,
    cellM,
    cols,
    rows,
    bboxStr,
    toCell(lat, lon) {
      const [x, y] = proj.toM(lat, lon);
      const cx = Math.max(0, Math.min(cols - 1, Math.floor((x - minX) / cellM)));
      const cy = Math.max(0, Math.min(rows - 1, Math.floor((y - minY) / cellM)));
      return [cx, cy];
    },
    toLatLon(cx, cy) {
      const x = minX + (cx + 0.5) * cellM;
      const y = minY + (cy + 0.5) * cellM;
      return proj.toLL(x, y);
    }
  };
}

export function assembleRings(members, roleFilter = 'outer') {
  const segs = [];
  for (const m of (members || [])) {
    if (m.type !== 'way' || !Array.isArray(m.geometry) || m.geometry.length < 2) continue;
    const role = m.role || 'outer';
    if (roleFilter && role !== roleFilter) continue;
    segs.push(m.geometry.map(pt => [pt.lat, pt.lon]));
  }
  const rings = [];
  const keyOf = (pt) => `${pt[0].toFixed(6)},${pt[1].toFixed(6)}`;
  while (segs.length > 0) {
    const cur = segs.shift().slice();
    let changed = true;
    while (changed && segs.length > 0) {
      changed = false;
      const head = keyOf(cur[0]);
      const tail = keyOf(cur[cur.length - 1]);
      if (head === tail && cur.length >= 4) break;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        const sHead = keyOf(s[0]);
        const sTail = keyOf(s[s.length - 1]);
        if (tail === sHead) {
          cur.push(...s.slice(1));
          segs.splice(i, 1);
          changed = true;
          break;
        }
        if (tail === sTail) {
          cur.push(...s.slice(0, -1).reverse());
          segs.splice(i, 1);
          changed = true;
          break;
        }
        if (head === sTail) {
          cur.unshift(...s.slice(0, -1));
          segs.splice(i, 1);
          changed = true;
          break;
        }
        if (head === sHead) {
          cur.unshift(...s.slice(1).reverse());
          segs.splice(i, 1);
          changed = true;
          break;
        }
      }
    }
    if (cur.length >= 3) rings.push(cur);
  }
  return rings;
}

function _scanlineFillRing(grid, G, ringLL, value, mode = 'set') {
  if (!Array.isArray(ringLL) || ringLL.length < 3) return;
  const pts = ringLL.map(([lat, lon]) => {
    const [x, y] = G.proj.toM(lat, lon);
    return [(x - G.minX) / G.cellM, (y - G.minY) / G.cellM];
  });
  let minRow = G.rows, maxRow = -1;
  for (const [, py] of pts) {
    const r = Math.floor(py);
    if (r < minRow) minRow = r;
    if (r > maxRow) maxRow = r;
  }
  minRow = Math.max(0, minRow);
  maxRow = Math.min(G.rows - 1, maxRow);

  for (let row = minRow; row <= maxRow; row++) {
    const scanY = row + 0.5;
    const xs = [];
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[j];
      if ((y1 <= scanY && y2 > scanY) || (y2 <= scanY && y1 > scanY)) {
        xs.push(x1 + ((scanY - y1) * (x2 - x1)) / (y2 - y1));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const cStart = Math.max(0, Math.floor(xs[k]));
      const cEnd = Math.min(G.cols - 1, Math.floor(xs[k + 1]));
      const rowOff = row * G.cols;
      for (let col = cStart; col <= cEnd; col++) {
        if (mode === 'min') {
          if (value < grid[rowOff + col]) grid[rowOff + col] = value;
        } else {
          grid[rowOff + col] = value;
        }
      }
    }
  }
}

export function fillFeature(grid, G, outerRings, innerRings, value, mode = 'set') {
  for (const ring of (outerRings || [])) {
    _scanlineFillRing(grid, G, ring, value, mode);
  }
  for (const hole of (innerRings || [])) {
    _scanlineFillRing(grid, G, hole, Infinity, 'set');
  }
}

export function stampLine(grid, G, lineLL, radiusCells, value, mode = 'min') {
  if (!Array.isArray(lineLL) || lineLL.length < 2) return;
  const r = Math.max(0, Math.floor(radiusCells));
  const paintCell = (cx, cy) => {
    for (let dy = -r; dy <= r; dy++) {
      const ny = cy + dy;
      if (ny < 0 || ny >= G.rows) continue;
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r + 0.5) continue;
        const nx = cx + dx;
        if (nx < 0 || nx >= G.cols) continue;
        const idx = ny * G.cols + nx;
        if (mode === 'set') {
          grid[idx] = value;
        } else if (value < grid[idx]) {
          grid[idx] = value;
        }
      }
    }
  };

  for (let i = 0; i < lineLL.length - 1; i++) {
    const [x0, y0] = G.proj.toM(lineLL[i][0], lineLL[i][1]);
    const [x1, y1] = G.proj.toM(lineLL[i + 1][0], lineLL[i + 1][1]);
    const c0x = (x0 - G.minX) / G.cellM;
    const c0y = (y0 - G.minY) / G.cellM;
    const c1x = (x1 - G.minX) / G.cellM;
    const c1y = (y1 - G.minY) / G.cellM;
    const steps = Math.max(1, Math.ceil(Math.hypot(c1x - c0x, c1y - c0y) * 2));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = Math.floor(c0x + (c1x - c0x) * t);
      const cy = Math.floor(c0y + (c1y - c0y) * t);
      if (cx >= 0 && cx < G.cols && cy >= 0 && cy < G.rows) {
        paintCell(cx, cy);
      }
    }
  }
}

export function distToLand(grid, cols, rows) {
  const n = cols * rows;
  const dist = new Uint16Array(n);
  const INF = 60000;
  for (let i = 0; i < n; i++) {
    dist[i] = Number.isFinite(grid[i]) ? INF : 0;
  }
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (dist[i] === 0) continue;
      let d = dist[i];
      if (x > 0) d = Math.min(d, dist[i - 1] + 2);
      if (y > 0) d = Math.min(d, dist[i - cols] + 2);
      if (x > 0 && y > 0) d = Math.min(d, dist[i - cols - 1] + 3);
      if (x + 1 < cols && y > 0) d = Math.min(d, dist[i - cols + 1] + 3);
      dist[i] = d;
    }
  }
  for (let y = rows - 1; y >= 0; y--) {
    for (let x = cols - 1; x >= 0; x--) {
      const i = y * cols + x;
      if (dist[i] === 0) continue;
      let d = dist[i];
      if (x + 1 < cols) d = Math.min(d, dist[i + 1] + 2);
      if (y + 1 < rows) d = Math.min(d, dist[i + cols] + 2);
      if (x + 1 < cols && y + 1 < rows) d = Math.min(d, dist[i + cols + 1] + 3);
      if (x > 0 && y + 1 < rows) d = Math.min(d, dist[i + cols - 1] + 3);
      dist[i] = d;
    }
  }
  return dist;
}

export class MinHeap {
  constructor() {
    this.a = [];
  }
  get size() {
    return this.a.length;
  }
  push(idx, f) {
    const arr = this.a;
    let i = arr.length;
    arr.push([idx, f]);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (arr[p][1] <= f) break;
      const tmp = arr[p];
      arr[p] = arr[i];
      arr[i] = tmp;
      i = p;
    }
  }
  pop() {
    const arr = this.a;
    const top = arr[0];
    const last = arr.pop();
    if (arr.length > 0) {
      arr[0] = last;
      let i = 0;
      const n = arr.length;
      while (true) {
        let best = i;
        const l = i * 2 + 1;
        const r = l + 1;
        if (l < n && arr[l][1] < arr[best][1]) best = l;
        if (r < n && arr[r][1] < arr[best][1]) best = r;
        if (best === i) break;
        const tmp = arr[i];
        arr[i] = arr[best];
        arr[best] = tmp;
        i = best;
      }
    }
    return top;
  }
}

export function nearestPassable(grid, cols, rows, sx, sy, maxR = 14) {
  const idx0 = sy * cols + sx;
  if (Number.isFinite(grid[idx0])) return [sx, sy];
  let best = null;
  let bestD2 = Infinity;
  for (let r = 1; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      const ny = sy + dy;
      if (ny < 0 || ny >= rows) continue;
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const nx = sx + dx;
        if (nx < 0 || nx >= cols) continue;
        if (Number.isFinite(grid[ny * cols + nx])) {
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD2) {
            bestD2 = d2;
            best = [nx, ny];
          }
        }
      }
    }
    if (best) return best;
  }
  return null;
}

export function astarGrid(grid, cols, rows, startCell, goalCell, shoreDist = null, shoreWeight = 0) {
  const sIdx = startCell[1] * cols + startCell[0];
  const gIdx = goalCell[1] * cols + goalCell[0];
  if (!Number.isFinite(grid[sIdx]) || !Number.isFinite(grid[gIdx])) return null;

  const n = cols * rows;
  const gScore = new Float64Array(n);
  gScore.fill(Infinity);
  const came = new Int32Array(n);
  came.fill(-1);
  const closed = new Uint8Array(n);

  const h = (cx, cy) => { const dx = Math.abs(goalCell[0] - cx), dy = Math.abs(goalCell[1] - cy); return 0.6 * (dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy)); };
  const heap = new MinHeap();
  gScore[sIdx] = 0;
  heap.push(sIdx, h(startCell[0], startCell[1]));

  const DIRS = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]
  ];

  while (heap.size > 0) {
    const [cur] = heap.pop();
    if (cur === gIdx) {
      const path = [];
      let p = cur;
      while (p !== -1) {
        path.push([p % cols, Math.floor(p / cols)]);
        p = came[p];
      }
      path.reverse();
      return path;
    }
    if (closed[cur]) continue;
    closed[cur] = 1;

    const cx = cur % cols;
    const cy = Math.floor(cur / cols);
    const curG = gScore[cur];

    for (const [dx, dy, stepLen] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
      const nIdx = ny * cols + nx;
      if (closed[nIdx]) continue;
      const cellCost = grid[nIdx];
      if (!Number.isFinite(cellCost)) continue;
      // Запрещаем срезание углов суши/препятствий по диагонали
      if (dx !== 0 && dy !== 0) {
        if (!Number.isFinite(grid[cy * cols + nx]) || !Number.isFinite(grid[ny * cols + cx])) {
          continue;
        }
      }
      let extra = 0;
      if (shoreDist && shoreWeight > 0) {
        const sd = shoreDist[nIdx];
        if (sd < 6) extra = shoreWeight / (sd + 1);
      }
      const candG = curG + stepLen * (cellCost + extra);
      if (candG < gScore[nIdx]) {
        gScore[nIdx] = candG;
        came[nIdx] = cur;
        heap.push(nIdx, candG + h(nx, ny));
      }
    }
  }
  return null;
}

function _lineOfSight(grid, cols, p0, p1, shoreDist = null, minShoreCells = 0) {
  const [x0, y0] = p0;
  const [x1, y1] = p1;
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
  const baseCost = grid[y0 * cols + x0];
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    const cx = Math.round(x0 + (x1 - x0) * t);
    const cy = Math.round(y0 + (y1 - y0) * t);
    const idx = cy * cols + cx;
    const c = grid[idx];
    if (!Number.isFinite(c) || c > baseCost * 1.35 + 0.5) return false;
    if (shoreDist && minShoreCells > 0 && shoreDist[idx] < minShoreCells) return false;
  }
  return true;
}

export function smoothPath(grid, cols, path, opts = {}) {
  if (!Array.isArray(path) || path.length <= 2) return path || [];
  const maxSpanSteps = opts.maxSpanSteps || Infinity;
  const shoreDist = opts.shoreDist || null;
  const minShoreCells = opts.minShoreCells || 0;
  const out = [path[0]];
  let i = 0;
  while (i < path.length - 1) {
    let far = Math.min(path.length - 1, i + maxSpanSteps);
    while (far > i + 1) {
      if (_lineOfSight(grid, cols, path[i], path[far], shoreDist, minShoreCells)) break;
      far--;
    }
    out.push(path[far]);
    i = far;
  }
  return out;
}

const _gridOverpassCache = new Map();

export function buildCostGridFromElements(G, elements, mode = 'boat', iceState = 'open_water') {
  const n = G.cols * G.rows;
  const grid = new Float32Array(n);

  if (mode === 'boat') {
    grid.fill(Infinity);
    // 1. Площадные водоёмы (relations + closed ways)
    for (const el of elements) {
      const t = el.tags || {};
      const isWaterArea = t.natural === 'water' || t.waterway === 'riverbank' || t.landuse === 'reservoir' || t.water;
      if (!isWaterArea) continue;
      if (el.type === 'relation' && Array.isArray(el.members)) {
        const outers = assembleRings(el.members, 'outer');
        const inners = assembleRings(el.members, 'inner');
        fillFeature(grid, G, outers, inners, 1.0, 'min');
      } else if (el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 3) {
        const ring = el.geometry.map(pt => [pt.lat, pt.lon]);
        fillFeature(grid, G, [ring], [], 1.0, 'min');
      }
    }
    // 2. Линейные реки, протоки и судовой ход
    for (const el of elements) {
      const t = el.tags || {};
      if (el.type !== 'way' || !Array.isArray(el.geometry) || el.geometry.length < 2) continue;
      if (t.waterway === 'fairway') {
        const line = el.geometry.map(pt => [pt.lat, pt.lon]);
        stampLine(grid, G, line, Math.max(1, Math.round(30 / G.cellM)), 0.75, 'min');
      } else if (t.waterway === 'river' || t.waterway === 'canal' || t.waterway === 'stream') {
        const line = el.geometry.map(pt => [pt.lat, pt.lon]);
        const rad = t.waterway === 'river' ? Math.max(1, Math.round(45 / G.cellM)) : Math.max(1, Math.round(25 / G.cellM));
        stampLine(grid, G, line, rad, 1.0, 'min');
      }
    }
    // 3. Плотины, дамбы и водопады — жёсткий барьер
    for (const el of elements) {
      const t = el.tags || {};
      if (t.waterway === 'weir' || t.waterway === 'dam' || t.waterway === 'waterfall') {
        if (Array.isArray(el.geometry) && el.geometry.length >= 2) {
          stampLine(grid, G, el.geometry.map(pt => [pt.lat, pt.lon]), 1, Infinity, 'set');
        } else if (Number.isFinite(el.lat) && Number.isFinite(el.lon)) {
          const [cx, cy] = G.toCell(el.lat, el.lon);
          grid[cy * G.cols + cx] = Infinity;
        }
      }
    }
    return grid;
  }

  if (mode === 'offroad') {
    grid.fill(1.2);
    for (const el of elements) {
      const t = el.tags || {};
      let polyCost = null;
      if (t.natural === 'water' || t.waterway === 'riverbank' || t.landuse === 'reservoir') polyCost = Infinity;
      else if (t.natural === 'wetland') polyCost = 4.0;
      else if (t.natural === 'wood' || t.landuse === 'forest') polyCost = 2.2;
      else if (t.building) polyCost = Infinity;
      if (polyCost === null) continue;
      if (el.type === 'relation' && Array.isArray(el.members)) {
        fillFeature(grid, G, assembleRings(el.members, 'outer'), assembleRings(el.members, 'inner'), polyCost, 'set');
      } else if (el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 3) {
        fillFeature(grid, G, [el.geometry.map(pt => [pt.lat, pt.lon])], [], polyCost, 'set');
      }
    }
    for (const el of elements) {
      const t = el.tags || {};
      if (el.type !== 'way' || !Array.isArray(el.geometry) || el.geometry.length < 2) continue;
      const line = el.geometry.map(pt => [pt.lat, pt.lon]);
      if (t.highway) stampLine(grid, G, line, 1, 0.5, 'min');
      else if (t.waterway === 'river' || t.waterway === 'canal') stampLine(grid, G, line, 1, Infinity, 'set');
    }
    return grid;
  }

  // mode === 'snowmobile'
  grid.fill(1.4); // Базовая открытая целина / луг / тундра
  const icePassable = iceState === 'ice_safe' || iceState === 'ice_slush';
  const iceCost = iceState === 'ice_safe' ? 1.0 : (iceState === 'ice_slush' ? 1.35 : Infinity);

  // 1. Природные зоны (лес, болото, вода)
  for (const el of elements) {
    const t = el.tags || {};
    let polyCost = null;
    if (t.natural === 'water' || t.waterway === 'riverbank' || t.landuse === 'reservoir') {
      polyCost = icePassable ? iceCost : Infinity;
    } else if (t.natural === 'wood' || t.landuse === 'forest') {
      polyCost = 2.4;
    } else if (t.natural === 'wetland') {
      polyCost = iceState === 'ice_safe' ? 1.2 : 1.9;
    } else if (t.landuse === 'residential' || t.landuse === 'industrial') {
      polyCost = 4.5;
    }
    if (polyCost === null) continue;
    if (el.type === 'relation' && Array.isArray(el.members)) {
      const outers = assembleRings(el.members, 'outer');
      const inners = assembleRings(el.members, 'inner');
      fillFeature(grid, G, outers, inners, polyCost, 'set');
    } else if (el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 3) {
      fillFeature(grid, G, [el.geometry.map(pt => [pt.lat, pt.lon])], [], polyCost, 'set');
    }
  }

  // 2. Зимники, просеки и дороги
  for (const el of elements) {
    const t = el.tags || {};
    if (el.type !== 'way' || !Array.isArray(el.geometry) || el.geometry.length < 2) continue;
    const line = el.geometry.map(pt => [pt.lat, pt.lon]);
    if (t.winter_road === 'yes' || t.ice_road === 'yes' || t.highway === 'winter_road') {
      stampLine(grid, G, line, 1, 0.6, 'min');
    } else if (t.man_made === 'cutline' || t.highway === 'track' || t.highway === 'path') {
      stampLine(grid, G, line, 1, t.man_made === 'cutline' ? 1.2 : 0.85, 'min');
    } else if (t.highway) {
      stampLine(grid, G, line, 1, 0.95, 'min');
    } else if ((t.waterway === 'river' || t.waterway === 'stream') && icePassable) {
      stampLine(grid, G, line, 1, iceCost, 'min');
    }
  }

  // 3. Здания и заборы — жёсткий барьер
  for (const el of elements) {
    const t = el.tags || {};
    if (t.building || t.barrier === 'fence' || t.barrier === 'wall') {
      if (el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 3 && t.building) {
        fillFeature(grid, G, [el.geometry.map(pt => [pt.lat, pt.lon])], [], Infinity, 'set');
      } else if (Array.isArray(el.geometry) && el.geometry.length >= 2) {
        stampLine(grid, G, el.geometry.map(pt => [pt.lat, pt.lon]), 0, Infinity, 'set');
      }
    }
  }
  return grid;
}

export async function routeOnGrid(a, b, mode = 'boat', opts = {}) {
  const {
    iceState = 'open_water',
    queryOverpass = null,
    offline = false
  } = opts;

  if (!Array.isArray(a) || !Array.isArray(b)) return null;
  const G = chooseGrid(a, b, mode === 'boat' ? 0.35 : 0.30);
  const cacheKey = `${mode}|${iceState}|${G.bboxStr}`;
  let elements = _gridOverpassCache.get(cacheKey);

  if (!elements) {
    if (offline || typeof queryOverpass !== 'function') return null;
    const q = mode === 'boat'
      ? `[out:json][timeout:8];(way["waterway"~"^(river|stream|canal|fairway|riverbank|weir|dam|waterfall)$"](${G.bboxStr});way["natural"="water"](${G.bboxStr});relation["natural"="water"](${G.bboxStr});way["landuse"="reservoir"](${G.bboxStr});relation["landuse"="reservoir"](${G.bboxStr}););out geom;`
      : `[out:json][timeout:8];(way["highway"~"^(track|path|winter_road|service|unclassified|residential)$"](${G.bboxStr});way["winter_road"="yes"](${G.bboxStr});way["ice_road"="yes"](${G.bboxStr});way["man_made"="cutline"](${G.bboxStr});way["natural"~"^(water|wood|wetland)$"](${G.bboxStr});relation["natural"="water"](${G.bboxStr});way["landuse"~"^(forest|reservoir)$"](${G.bboxStr});way["building"](${G.bboxStr});way["barrier"~"^(fence|wall)$"](${G.bboxStr}););out geom;`;
    const data = await queryOverpass(q, 5500);
    if (!data || !Array.isArray(data.elements) || data.elements.length === 0) return null;
    elements = data.elements;
    _gridOverpassCache.set(cacheKey, elements);
  }

  const grid = buildCostGridFromElements(G, elements, mode, iceState);
  const rawStart = G.toCell(a[0], a[1]);
  const rawGoal = G.toCell(b[0], b[1]);
  const startCell = nearestPassable(grid, G.cols, G.rows, rawStart[0], rawStart[1], 18);
  const goalCell = nearestPassable(grid, G.cols, G.rows, rawGoal[0], rawGoal[1], 18);
  if (!startCell || !goalCell) return null;

  const shore = mode === 'boat' ? distToLand(grid, G.cols, G.rows) : null;
  const rawPath = astarGrid(grid, G.cols, G.rows, startCell, goalCell, shore, mode === 'boat' ? 1.5 : 0);
  if (!rawPath || rawPath.length < 2) return null;

  const smoothed = smoothPath(grid, G.cols, rawPath, mode === 'boat'
    ? { maxSpanSteps: 4, shoreDist: shore, minShoreCells: 2 }
    : { maxSpanSteps: 40 });
  const points = smoothed.map(([cx, cy]) => G.toLatLon(cx, cy));
  points[0] = [a[0], a[1]];
  points[points.length - 1] = [b[0], b[1]];

  const warnings = [];
  if (mode === 'snowmobile' && iceState === 'ice_slush') {
    warnings.push('На водоёмах возможна наледь (слуд), движение по льду с осторожностью.');
  }
  return {
    points,
    stats: { cols: G.cols, rows: G.rows, cellM: G.cellM, steps: smoothed.length },
    warnings
  };
}
