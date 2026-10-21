import { isCoastalInBasin } from './basins.js';

export const WATER_PROFILES = {
  small_river: { name: 'Малая / средняя река (0.2–6 м)', shortName: 'Малая/средняя река', minD: 0.2, maxD: 6.0, defD: 1.4, flow: 1.3, isSea: false },
  big_river: { name: 'Крупная магистральная река / фарватер (0.5–18 м)', shortName: 'Крупная река', minD: 0.5, maxD: 18.0, defD: 4.5, flow: 2.2, isSea: false },
  quarry: { name: 'Глубокое озеро / карьер / вдхр (0.5–22 м)', shortName: 'Озеро / водохранилище', minD: 0.5, maxD: 22.0, defD: 5.0, flow: 0.7, isSea: false },
  tundra_lake: { name: 'Мелководное озеро / старица / пруд (0.2–3.5 м)', shortName: 'Старица / пруд / озеро', minD: 0.2, maxD: 3.5, defD: 1.2, flow: 0.4, isSea: false },
  cooling_reservoir: { name: 'Тёплый сброс ГРЭС/АЭС / Прудхоз (0.5–8 м)', shortName: 'Тёплый канал / Прудхоз', minD: 0.5, maxD: 8.0, defD: 2.5, flow: 1.1, isSea: false },
  sea_gulf: { name: 'Морская губа / эстуарий / лиман (0.5–15 м)', shortName: 'Морской залив / лиман', minD: 0.5, maxD: 15.0, defD: 3.5, flow: 1.8, isSea: true },
  open_sea: { name: 'Открытое море / банка / шельф (2–60 м)', shortName: 'Открытое море / шельф', minD: 2.0, maxD: 60.0, defD: 15.0, flow: 2.4, isSea: true }
};

export function getAvailableWaterTypes(basinCode, lat, lon) {
  const coastal = isCoastalInBasin(basinCode, lat, lon);
  return Object.entries(WATER_PROFILES)
    .filter(([, prof]) => coastal || !prof.isSea)
    .map(([id, prof]) => ({ id, ...prof }));
}

export function getRegionalWatersFallback(basinCode, lat, lon) {
  const coastal = isCoastalInBasin(basinCode, lat, lon);
  const base = [
    { label: '🌊 Малая / средняя река рядом', name: 'Малая река', wType: 'small_river', defDepth: 1.4, distKm: 1.2 },
    { label: '⚓ Русло крупной реки', name: 'Крупная река', wType: 'big_river', defDepth: 4.5, distKm: 3.5 },
    { label: '💧 Озеро / водохранилище', name: 'Водохранилище / озеро', wType: 'quarry', defDepth: 5.0, distKm: 4.8 },
    { label: '🌿 Пойменная старица / пруд', name: 'Пойменный пруд / старица', wType: 'tundra_lake', defDepth: 1.2, distKm: 2.1 }
  ];
  if (coastal) {
    base.unshift(
      { label: '🌊 Морской залив / бухта', name: 'Морской залив', wType: 'sea_gulf', defDepth: 4.0, distKm: 1.5 },
      { label: '⚓ Морской прибрежный свал', name: 'Открытое море', wType: 'open_sea', defDepth: 14.0, distKm: 5.0 }
    );
  }
  return base;
}
