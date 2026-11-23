/**
 * @file tools/build-geo-db.mjs
 * @description Компилятор модульной гео-базы «Клёв ПРО 2.0» из data/geo/{cfo,szfo,yufo,skfo,pfo,urfo,sfo,dfo}.json
 * в компактное кортежное представление внутри js/data/russia-waters.js (1 строка = 1 запись).
 * Сокращает размер кода в 4 раза при увеличении базы до 3 596 населённых пунктов и 1 501 водоёма по всем 89 субъектам РФ.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const GEO_DIR = path.join(ROOT, 'data', 'geo');
const DISTRICTS = ['cfo', 'szfo', 'yufo', 'skfo', 'pfo', 'urfo', 'sfo', 'dfo'];

const BASIN_CODES = [
  'volga_caspian',
  'arctic_ob_taz',
  'black_azov',
  'baltic',
  'nw_karelia',
  'barents_white',
  'yenisei_lena',
  'baikal',
  'amur',
  'pacific_sea',
  'euro_west'
];

const WTYPE_CODES = [
  'small_river',
  'big_river',
  'quarry',
  'tundra_lake',
  'cooling_reservoir',
  'sea_gulf',
  'open_sea'
];

const settlements = [];
const waters = [];

for (const d of DISTRICTS) {
  const fp = path.join(GEO_DIR, `${d}.json`);
  if (!fs.existsSync(fp)) {
    throw new Error(`Missing geo district file: ${fp}`);
  }
  const parsed = JSON.parse(fs.readFileSync(fp, 'utf8'));
  if (Array.isArray(parsed.settlements)) settlements.push(...parsed.settlements);
  if (Array.isArray(parsed.waters)) waters.push(...parsed.waters);
}

const admin1Set = new Set();
for (const s of settlements) {
  admin1Set.add(s.admin1);
}
const ADMIN1_LIST = Array.from(admin1Set).sort((a, b) => a.localeCompare(b, 'ru'));
const admin1IdxMap = new Map(ADMIN1_LIST.map((name, i) => [name, i]));
const basinIdxMap = new Map(BASIN_CODES.map((code, i) => [code, i]));
const wTypeIdxMap = new Map(WTYPE_CODES.map((code, i) => [code, i]));

const cityTuples = settlements.map(c => [
  c.name,
  Number(Number(c.lat).toFixed(4)),
  Number(Number(c.lon).toFixed(4)),
  admin1IdxMap.get(c.admin1) ?? 0
]);

const waterTuples = waters.map(w => [
  w.name,
  w.cleanName === w.name.replace(/^(р\.|оз\.|вдхр\.)\s*/i, '').trim() ? '' : (w.cleanName || ''),
  basinIdxMap.get(w.basin) ?? 0,
  wTypeIdxMap.get(w.wType) ?? 0,
  Number(Number(w.defDepth || 2.0).toFixed(1)),
  Number(Number(w.lat).toFixed(4)),
  Number(Number(w.lon).toFixed(4)),
  w.region || ''
]);

const outJs = `/**
 * @file russia-waters.js
 * @description Единая модульная офлайн-база гидрографической сети (1 501 водоём) и населённых пунктов (3 596 городов, ПГТ и СНП)
 * по всем 89 субъектам Российской Федерации (Ревизия 2.9.2 r259).
 * Автоматически собирается скриптом tools/build-geo-db.mjs из исходников data/geo/{cfo,szfo,yufo,skfo,pfo,urfo,sfo,dfo}.json.
 */
const _BASINS = ${JSON.stringify(BASIN_CODES)};
const _WTYPES = ${JSON.stringify(WTYPE_CODES)};
const _WTAGS = ['Река малая','Река большая','Озеро / Карьер / Вдхр','Озеро / Старица','ГРЭС / Тёплый сброс','Морской залив / Губа','Открытое море'];
const _ADMINS = ${JSON.stringify(ADMIN1_LIST)};

const _W_RAW = [
${waterTuples.map(t => JSON.stringify(t)).join(',\n')}
];

const _C_RAW = [
${cityTuples.map(t => JSON.stringify(t)).join(',\n')}
];

export const RUSSIA_WATERS = _W_RAW.map(r => {
  const name = r[0];
  const cleanName = r[1] || name.replace(/^(р\\.|оз\\.|вдхр\\.)\\s*/i, '').trim();
  const wIdx = r[3] || 0;
  return {
    name,
    cleanName,
    basin: _BASINS[r[2]] || 'volga_caspian',
    wType: _WTYPES[wIdx] || 'small_river',
    typeTag: _WTAGS[wIdx] || 'Водоём',
    defDepth: r[4] || 2.0,
    lat: r[5],
    lon: r[6],
    region: r[7] || cleanName
  };
});

export const RUSSIA_CITIES = _C_RAW.map(r => ({
  name: r[0],
  lat: r[1],
  lon: r[2],
  admin1: _ADMINS[r[3]] || ''
}));

export function calcHaversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

export function findNearestRussianSettlement(lat, lon) {
  let best = null;
  let bestDist = Infinity;
  for (const c of RUSSIA_CITIES) {
    const d = calcHaversine(lat, lon, c.lat, c.lon);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  if (!best) return null;
  return {
    ...best,
    distKm: bestDist,
    label: bestDist <= 18 ? best.name : (bestDist <= 85 ? \`\${best.name} (\${bestDist} км)\` : best.name)
  };
}

export function getNearestRussianSettlements(lat, lon, maxCount = 24, maxRadiusKm = 180) {
  const withDist = RUSSIA_CITIES.map(c => ({
    name: c.name,
    admin1: c.admin1,
    lat: c.lat,
    lon: c.lon,
    distKm: calcHaversine(lat, lon, c.lat, c.lon)
  })).sort((a, b) => a.distKm - b.distKm);
  const inRadius = withDist.filter(c => c.distKm <= maxRadiusKm);
  return (inRadius.length >= 6 ? inRadius : withDist.slice(0, 12)).slice(0, maxCount);
}

export function getWaterTypeShortTag(wType) {
  switch (wType) {
    case 'big_river': return 'Река большая';
    case 'small_river': return 'Река малая';
    case 'quarry': return 'Озеро / Карьер / Вдхр';
    case 'tundra_lake': return 'Озеро / Старица';
    case 'cooling_reservoir': return 'ГРЭС / Тёплый сброс';
    case 'sea_gulf': return 'Морской залив / Губа';
    case 'open_sea': return 'Открытое море';
    default: return 'Водоём';
  }
}

export function getNearestRussianWaters(lat, lon, basinCode, isCoastal, maxCount = 35, radiusKm = 120) {
  const effRadius = Number.isFinite(radiusKm) && radiusKm > 0 ? radiusKm : 120;
  const calculated = RUSSIA_WATERS.map(w => {
    const distKm = calcHaversine(lat, lon, w.lat, w.lon);
    let penalty = 0;
    if (w.basin !== basinCode) penalty += 18;
    const isLocalSea = (w.wType === 'sea_gulf' || w.wType === 'open_sea') && distKm <= 55;
    if (!isCoastal && !isLocalSea && (w.wType === 'sea_gulf' || w.wType === 'open_sea')) penalty += 2000;
    return {
      ...w,
      distKm,
      sortScore: distKm + penalty
    };
  });
  calculated.sort((a, b) => a.sortScore - b.sortScore);
  const seenClean = new Set();
  let withinRadius = calculated.filter(w => {
    const key = (w.cleanName || w.name || '').toLowerCase();
    if (seenClean.has(key)) return false;
    const isImportantRegional = (w.wType === 'big_river' || w.wType === 'cooling_reservoir' || /ГРЭС|Пур|Таз|Обь|Ямылимуяганто|Лимбиях/i.test(w.name || '')) && w.distKm <= Math.max(effRadius, 95);
    const ok = (w.distKm <= effRadius || isImportantRegional) && (isCoastal || w.distKm <= 55 || !w.wType.startsWith('sea'));
    if (ok) seenClean.add(key);
    return ok;
  });
  if (withinRadius.length === 0) {
    withinRadius = calculated.filter(w => isCoastal || !w.wType.startsWith('sea')).slice(0, 6);
  } else {
    withinRadius = withinRadius.slice(0, Math.max(28, maxCount));
  }
  return withinRadius.map(w => {
    const isRiver = w.wType === 'big_river' || w.wType === 'small_river' || w.name.startsWith('р.');
    const prefix = isRiver ? '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg> ' : (w.wType.startsWith('sea') ? '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="5" r="2.5" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.5V21M5 13c0 4.5 3.1 8 7 8s7-3.5 7-8M8 10h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> ' : (w.wType === 'cooling_reservoir' ? '<svg class="k-ico" style="color:var(--warn);" viewBox="0 0 24 24" fill="none"><path d="M12 2c1.5 3.5 4.5 5.5 4.5 10a5.5 5.5 0 1 1-11 0c0-3 2-5.5 3.5-7 0 2 1.5 3 1.5 3S12 5.5 12 2z" fill="#f97316" stroke="#fbbf24" stroke-width="1.5" stroke-linejoin="round"/></svg> ' : '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3c0 0-6 7.1-6 11.5a6 6 0 0 0 12 0C18 10.1 12 3 12 3z" fill="rgba(56,189,248,0.32)" stroke="#38bdf8" stroke-width="1.8"/><path d="M9.5 15.5c.5 1.2 1.7 2 3 2" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg> '));
    const distStr = w.distKm < 1 ? \`\${Math.round(w.distKm * 1000)} м\` : \`\${w.distKm} км\`;
    const tag = w.typeTag || getWaterTypeShortTag(w.wType);
    return {
      name: w.cleanName,
      label: \`\${prefix}\${w.name} [\${tag}] • \${distStr}\`,
      wType: w.wType,
      typeTag: tag,
      defDepth: w.defDepth,
      distKm: w.distKm,
      lat: w.lat,
      lon: w.lon,
      isCurated: true
    };
  });
}
`;

const targetPaths = [
  path.join(ROOT, 'js', 'data', 'russia-waters.js'),
  path.join(ROOT, 'android', 'app', 'src', 'main', 'assets', 'www', 'js', 'data', 'russia-waters.js')
];

for (const tp of targetPaths) {
  if (fs.existsSync(path.dirname(tp))) {
    fs.writeFileSync(tp, outJs, 'utf8');
  }
}

console.log(`[build-geo-db] Compiled ${settlements.length} settlements and ${waters.length} waters across 89 regions (${(Buffer.byteLength(outJs, 'utf8') / 1024).toFixed(1)} KB, ${outJs.split('\n').length} lines).`);
