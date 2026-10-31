/* Klev PRO v2.5.3 r190 (Protected Build) */
import { isCoastalInBasin } from './basins.js?v=2.5.3';
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
    { label: '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg> Малая / средняя река рядом', name: 'Малая река', wType: 'small_river', defDepth: 1.4, distKm: 1.2 },
    { label: '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="5" r="2.5" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.5V21M5 13c0 4.5 3.1 8 7 8s7-3.5 7-8M8 10h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> Русло крупной реки', name: 'Крупная река', wType: 'big_river', defDepth: 4.5, distKm: 3.5 },
    { label: '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3c0 0-6 7.1-6 11.5a6 6 0 0 0 12 0C18 10.1 12 3 12 3z" fill="rgba(56,189,248,0.32)" stroke="#38bdf8" stroke-width="1.8"/><path d="M9.5 15.5c.5 1.2 1.7 2 3 2" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg> Озеро / водохранилище', name: 'Водохранилище / озеро', wType: 'quarry', defDepth: 5.0, distKm: 4.8 },
    { label: '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M17 3C11 3 5 7 5 15c0 2.5 1.5 4 4 4 8 0 12-6 12-12 0-2.5-1.5-4-4-4z" fill="rgba(16,185,129,0.25)" stroke="#10b981" stroke-width="1.8"/><path d="M5 19L15 9" stroke="#10b981" stroke-width="1.8" stroke-linecap="round"/></svg> Пойменная старица / пруд', name: 'Пойменный пруд / старица', wType: 'tundra_lake', defDepth: 1.2, distKm: 2.1 }
  ];
  if (coastal) {
    base.unshift(
      { label: '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg> Морской залив / бухта', name: 'Морской залив', wType: 'sea_gulf', defDepth: 4.0, distKm: 1.5 },
      { label: '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="5" r="2.5" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.5V21M5 13c0 4.5 3.1 8 7 8s7-3.5 7-8M8 10h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> Морской прибрежный свал', name: 'Открытое море', wType: 'open_sea', defDepth: 14.0, distKm: 5.0 }
    );
  }
  return base;
}
