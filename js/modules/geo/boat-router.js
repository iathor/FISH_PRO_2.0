import { routeOnGrid } from './grid-router.js?v=2.9.2-r259';

const R = 6371000, D = Math.PI / 180;
const distM = (p, q) => {
  const dx = (q[1] - p[1]) * D * R * Math.cos((p[0] + q[0]) / 2 * D), dy = (q[0] - p[0]) * D * R;
  return Math.hypot(dx, dy);
};
const pathLen = (pts) => pts.reduce((s, p, i) => i ? s + distM(pts[i - 1], p) : 0, 0);

// Лестница расширения области: сначала быстро и точно, потом шире и грубее
export const LADDER = [
  { padRatio: 0.35, minPadM: 1200,  maxCells: 140000 },
  { padRatio: 1.2,  minPadM: 8000,  maxCells: 200000 },
  { padRatio: 3.0,  minPadM: 25000, maxCells: 260000 }
];

export async function routeBoatRobust(a, b, opts = {}) {
  const tStart = Date.now();
  const diag = {
    tries: [],
    el: 0,
    tSec: 0,
    cellM: 0,
    snapStartM: 0,
    snapGoalM: 0,
    unclosedRings: 0,
    refined: 0,
    keptCoarse: 0
  };
  let coarse = null;
  for (const step of LADDER) {
    const r = await routeOnGrid(a, b, 'boat', { ...opts, ...step });
    diag.tries.push({
      ...step,
      ok: !!r,
      cellM: r?.stats?.cellM,
      el: r?.stats?.elements || 0,
      fetchMs: r?.stats?.fetchMs || 0
    });
    if (r) {
      coarse = r;
      diag.el = r.stats?.elements || 0;
      diag.cellM = r.stats?.cellM || 0;
      diag.snapStartM = Math.round(r.stats?.snapStartM || 0);
      diag.snapGoalM = Math.round(r.stats?.snapGoalM || 0);
      diag.unclosedRings = r.stats?.unclosedRings || 0;
      break;
    }
  }
  if (!coarse) {
    diag.tSec = Number(((Date.now() - tStart) / 1000).toFixed(2));
    return { ok: false, reason: 'no_water_path', diag };
  }

  // Грубая сетка (>90 м) – уточняем участками по <=20 км вдоль найденного русла
  if (coarse.stats.cellM > 90 && pathLen(coarse.points) > 30000) {
    const pts = coarse.points, out = [pts[0]];
    let legStart = pts[0], legStartIdx = 0, acc = 0, refined = 0, kept = 0;
    for (let i = 1; i < pts.length; i++) {
      acc += distM(pts[i - 1], pts[i]);
      if (acc >= 20000 || i === pts.length - 1) {
        const leg = await routeOnGrid(legStart, pts[i], 'boat', { ...opts, padRatio: 0.35, minPadM: 1500, maxCells: 140000 });
        if (leg && leg.points.length >= 2) {
          out.push(...leg.points.slice(1));
          refined++;
        } else {
          out.push(...pts.slice(legStartIdx + 1, i + 1));
          kept++;
        }
        legStart = pts[i];
        legStartIdx = i;
        acc = 0;
      }
    }
    diag.refined = refined;
    diag.keptCoarse = kept;
    diag.tSec = Number(((Date.now() - tStart) / 1000).toFixed(2));
    return { ok: true, points: out, diag };
  }
  diag.tSec = Number(((Date.now() - tStart) / 1000).toFixed(2));
  return { ok: true, points: coarse.points, diag };
}
