import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

function toDataModuleUrl(code) {
  return 'data:text/javascript;base64,' + Buffer.from(code, 'utf8').toString('base64');
}

const gridSrc = fs.readFileSync(path.join(ROOT, 'js/modules/geo/grid-router.js'), 'utf8');
const gridUrl = toDataModuleUrl(gridSrc);

const boatSrc = fs
  .readFileSync(path.join(ROOT, 'js/modules/geo/boat-router.js'), 'utf8')
  .replace(/from\s+['"]\.\/grid-router\.js(?:\?[^'"]*)?['"]/g, `from '${gridUrl}'`);
const boatUrl = toDataModuleUrl(boatSrc);

const eventsStubUrl = toDataModuleUrl(`export function safeModuleRun(_tag, fn, fb) { try { return fn(); } catch (_e) { return fb; } }`);
const routingSrc = fs
  .readFileSync(path.join(ROOT, 'js/modules/geo/geo.routing.js'), 'utf8')
  .replace(/from\s+['"]\.\.\/\.\.\/core\/events\.js(?:\?[^'"]*)?['"]/g, `from '${eventsStubUrl}'`);
const routingUrl = toDataModuleUrl(routingSrc);

const storeStubUrl = toDataModuleUrl(`export const store = { getState: () => ({ lat: 55.7558, lon: 37.6173, savedSpots: [] }) };`);
const gpsSrc = fs
  .readFileSync(path.join(ROOT, 'js/modules/geo/geo.gps.js'), 'utf8')
  .replace(/from\s+['"]\.\.\/\.\.\/core\/events\.js(?:\?[^'"]*)?['"]/g, `from '${eventsStubUrl}'`)
  .replace(/from\s+['"]\.\.\/\.\.\/core\/store\.js(?:\?[^'"]*)?['"]/g, `from '${storeStubUrl}'`)
  .replace(/from\s+['"]\.\/geo\.routing\.js(?:\?[^'"]*)?['"]/g, `from '${routingUrl}'`);
const gpsUrl = toDataModuleUrl(gpsSrc);

const { makeProj, routeOnGrid, assembleRings } = await import(gridUrl);
const { routeBoatRobust, LADDER } = await import(boatUrl);
const { evaluateRouteSegments } = await import(routingUrl);
const { getTrueUserGpsCoords } = await import(gpsUrl);

const P = makeProj(66, 78);
const ll = ([x, y]) => { const [la, lo] = P.toLL(x, y); return { lat: la, lon: lo }; };
function ribbon(pts, w) {
  const L = [], R = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy);
    dx /= l;
    dy /= l;
    L.push([pts[i][0] - dy * w / 2, pts[i][1] + dx * w / 2]);
    R.push([pts[i][0] + dy * w / 2, pts[i][1] - dx * w / 2]);
  }
  return L.concat(R.reverse());
}
const poly = (c, w) => {
  const g = ribbon(c, w).map(ll);
  g.push(g[0]);
  return [{ type: 'way', tags: { natural: 'water' }, geometry: g }];
};
const ok = (name, cond) => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name);
  if (!cond) process.exitCode = 1;
};

// 1. U-образная излучина: хорда 3 км, по воде 33 км
const u = [];
for (let y = 0; y >= -15000; y -= 250) u.push([0, y]);
for (let x = 0; x <= 3000; x += 250) u.push([x, -15000]);
for (let y = -15000; y <= 0; y += 250) u.push([3000, y]);
let r = await routeBoatRobust(P.toLL(0, -100), P.toLL(3000, -100), {
  queryOverpass: async () => ({ elements: poly(u, 300) })
});
ok('излучина найдена (3-я ступень)', r.ok && r.diag.tries.length === 3 && r.diag.tries[2].ok);

// 2. 100 км, меандры, река 200 м
const c = [];
for (let x = 0; x <= 100000; x += 500) c.push([x, 3000 * Math.sin(x / 12000)]);
r = await routeBoatRobust(P.toLL(...c[0]), P.toLL(...c[c.length - 1]), {
  queryOverpass: async () => ({ elements: poly(c, 200) })
});
ok('100 км меандры найдены и уточнены', r.ok && r.diag.refined >= 4);

// 3. 100 км, полигон реки 150/300/600 м (консервативная растеризация)
const line = [];
for (let x = 0; x <= 100000; x += 500) line.push([x, 300 * Math.sin(x / 9000)]);
for (const w of [150, 300, 600]) {
  const g = await routeOnGrid(P.toLL(...line[0]), P.toLL(...line[line.length - 1]), 'boat', {
    queryOverpass: async () => ({ elements: poly(line, w) }),
    padRatio: 0.35,
    minPadM: 1200,
    maxCells: 140000
  });
  ok('100 км, река ' + w + ' м', !!g);
}

// 4. Разрыв в данных 4 км → честный отказ
r = await routeBoatRobust(P.toLL(0, 0), P.toLL(20000, 0), {
  queryOverpass: async () => ({
    elements: [
      ...poly([[0, 0], [8000, 0]], 200),
      ...poly([[12000, 0], [20000, 0]], 200)
    ]
  })
});
ok('разрыв в данных → no_water_path', r.ok === false && r.reason === 'no_water_path');

// 5. Проверка подсчета незамкнутых колец assembleRings и параметров LADDER
const ringDiag = { unclosedRings: 0 };
assembleRings([
  { type: 'way', role: 'outer', geometry: [{ lat: 66.0, lon: 78.0 }, { lat: 66.01, lon: 78.0 }, { lat: 66.01, lon: 78.02 }] }
], 'outer', ringDiag);
ok('подсчет незамкнутых колец diag.unclosedRings и LADDER', ringDiag.unclosedRings === 1 && LADDER.length === 3);

// 6. Проверка evaluateRouteSegments с boatGaps и getTrueUserGpsCoords без жесткого Нового Уренгоя
const segEval = evaluateRouteSegments([[55.75, 37.61], [55.80, 37.61], [55.90, 37.61]], 'boat', [[1, 2]]);
const fallbackGps = getTrueUserGpsCoords({ lat: 55.7558, lon: 37.6173, savedSpots: [] }, null);
ok('evaluateRouteSegments (waterKm/gapKm/hasGaps) и фоллбэк GPS', segEval.hasGaps && segEval.waterKm > 0 && segEval.gapKm > 0 && fallbackGps.lat === 55.7558);
