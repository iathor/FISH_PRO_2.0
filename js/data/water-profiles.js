export const WATER_PROFILES = {
  small_river:       { id: 'small_river',       name: 'Малая / средняя река',            minD: 0.2, maxD: 6.0,  defD: 1.2,  flow: 1.3 },
  big_river:         { id: 'big_river',         name: 'Крупная магистральная река',      minD: 0.5, maxD: 18.0, defD: 4.5,  flow: 2.2 },
  quarry:            { id: 'quarry',            name: 'Глубокое озеро / карьер / вдхр',  minD: 0.5, maxD: 22.0, defD: 5.0,  flow: 0.7 },
  tundra_lake:       { id: 'tundra_lake',       name: 'Мелководное озеро / старица / пруд', minD: 0.2, maxD: 3.5, defD: 1.0, flow: 0.4 },
  cooling_reservoir: { id: 'cooling_reservoir', name: 'Тёплый сброс ГРЭС/АЭС / Прудхоз',  minD: 0.5, maxD: 8.0,  defD: 2.5,  flow: 1.1 },
  sea_gulf:          { id: 'sea_gulf',          name: 'Морская губа / эстуарий / лиман',  minD: 0.5, maxD: 15.0, defD: 3.5,  flow: 1.8 },
  open_sea:          { id: 'open_sea',          name: 'Открытое море / банка / шельф',    minD: 2.0, maxD: 60.0, defD: 15.0, flow: 2.4 }
};

export function getWaterProfile(id) {
  return WATER_PROFILES[id] || WATER_PROFILES.small_river;
}