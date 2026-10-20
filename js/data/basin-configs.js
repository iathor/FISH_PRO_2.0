export const BASIN_CONFIGS = {
  black_azov:    { name: 'Черноморско-Азовский бассейн',                    hasSea: true },
  baltic:        { name: 'Балтийский морской бассейн',                      hasSea: true },
  barents_white: { name: 'Баренцево-Беломорский арктический бассейн',       hasSea: true },
  nw_karelia:    { name: 'Ладожско-Онежский и Карельский бассейн',          hasSea: true },
  pacific_sea:   { name: 'Тихоокеанский бассейн',                           hasSea: true },
  amur:          { name: 'Амурский пресноводный бассейн',                   hasSea: false },
  baikal:        { name: 'Байкало-Ангарский бассейн',                       hasSea: false },
  yenisei_lena:  { name: 'Енисейско-Ленский бассейн',                       hasSea: true },
  arctic_ob_taz: { name: 'Обь-Тазовский бассейн (ЯНАО, Пур, Таз, Обь)',     hasSea: true },
  euro_west:     { name: 'Днепровско-Донской бассейн',                      hasSea: false },
  volga_caspian: { name: 'Волжско-Каспийский бассейн (Волга, Кама, Урал)',  hasSea: false }
};

// Границы бассейнов — от специфичных к общим
const BASIN_BOXES = [
  { code: 'black_azov',    bounds: { lat: [41.0, 47.8], lon: [32.5, 41.5] } },  // + Крым
  { code: 'baltic',        bounds: { lat: [54.0, 60.5], lon: [19.0, 31.0] } },
  { code: 'barents_white', bounds: { lat: [65.0, 82.0], lon: [30.5, 55.0] } },
  { code: 'nw_karelia',    bounds: { lat: [60.5, 66.5], lon: [29.0, 38.0] } },
  { code: 'pacific_sea',   bounds: { lat: [42.0, 72.0], lon: [130.0, 180.0] } },
  { code: 'amur',          bounds: { lat: [47.0, 55.5], lon: [118.0, 141.0] } },
  { code: 'baikal',        bounds: { lat: [51.0, 56.5], lon: [103.0, 112.0] } },
  { code: 'yenisei_lena',  bounds: { lat: [52.0, 82.0], lon: [88.0, 135.0] } },
  { code: 'arctic_ob_taz', bounds: { lat: [63.0, 82.0], lon: [64.0, 88.0] } },
  { code: 'euro_west',     bounds: { lat: [44.0, 56.0], lon: [26.0, 44.0] } }
];

export function detectBasinByCoords(lat, lon) {
  if (lat == null || lon == null) return 'volga_caspian';
  for (const box of BASIN_BOXES) {
    const { lat: la, lon: lo } = box.bounds;
    if (lat >= la[0] && lat <= la[1] && lon >= lo[0] && lon <= lo[1]) return box.code;
  }
  return 'volga_caspian';
}

/**
 * Возвращает true только если точка реально прибрежная в рамках бассейна —
 * то есть морские опции уместны.
 * ✅ ФИКС бага «Новый Уренгой получает морские опции».
 */
export function isCoastalInBasin(basinCode, lat, lon) {
  if (lat == null || lon == null) return true;
  switch (basinCode) {
    case 'arctic_ob_taz': {
      // Обская губа: Салехард (66.5, 66.6) → Новый Порт (67.7, 72.9)
      if (lat >= 66.0 && lat <= 68.6 && lon >= 66.0 && lon <= 75.0) return true;
      // Тазовская губа: Тазовский (67.5, 78.7) и окрестности
      if (lat >= 67.0 && lat <= 69.2 && lon >= 77.0 && lon <= 80.5) return true;
      // Карское побережье (Ямал, Гыдан)
      if (lat >= 68.5) return true;
      return false;
    }
    case 'yenisei_lena': {
      // Енисейский залив от Дудинки (69.4, 86.2) к северу
      if (lat >= 69.3 && lon >= 78.0 && lon <= 88.0) return true;
      // Дельта Лены, море Лаптевых
      if (lat >= 70.5 && lon >= 120.0) return true;
      // Карское море
      if (lat >= 72.0) return true;
      return false;
    }
    case 'nw_karelia': {
      // Узкая полоса Балтики: Сортавала, Выборг
      if (lat >= 59.5 && lat <= 61.8 && lon >= 27.5 && lon <= 30.6) return true;
      return false;  // Ладога и Онега — пресные
    }
    default:
      return true;
  }
}

export function getAvailableWaterTypes(basinCode, lat, lon) {
  const base = ['small_river', 'big_river', 'quarry', 'tundra_lake', 'cooling_reservoir'];
  const hasSea = BASIN_CONFIGS[basinCode]?.hasSea && isCoastalInBasin(basinCode, lat, lon);
  return hasSea ? [...base, 'sea_gulf', 'open_sea'] : base;
}

export function getBasinName(code) {
  return BASIN_CONFIGS[code]?.name || 'Неизвестный бассейн';
}