export const BASIN_CONFIGS = {
  black_azov: { name: 'Черноморско-Азовский бассейн', hasSea: true, spawnShiftWeeks: -2 },
  baltic: { name: 'Балтийский морской бассейн', hasSea: true, spawnShiftWeeks: 0 },
  barents_white: { name: 'Баренцево-Беломорский арктический бассейн', hasSea: true, spawnShiftWeeks: 2 },
  nw_karelia: { name: 'Ладожско-Онежский и Карельский бассейн', hasSea: true, spawnShiftWeeks: 1 },
  pacific_sea: { name: 'Тихоокеанский бассейн', hasSea: true, spawnShiftWeeks: 1 },
  amur: { name: 'Амурский пресноводный бассейн', hasSea: false, spawnShiftWeeks: 0 },
  baikal: { name: 'Байкало-Ангарский бассейн', hasSea: false, spawnShiftWeeks: 1 },
  yenisei_lena: { name: 'Енисейско-Ленский бассейн', hasSea: true, spawnShiftWeeks: 2 },
  arctic_ob_taz: { name: 'Обь-Тазовский бассейн (ЯНАО, Пур, Таз, Обь, Иртыш)', hasSea: true, spawnShiftWeeks: 2 },
  euro_west: { name: 'Днепровско-Донской бассейн', hasSea: false, spawnShiftWeeks: -1 },
  volga_caspian: { name: 'Волжско-Каспийский бассейн (Волга, Кама, Урал)', hasSea: true, spawnShiftWeeks: 0 }
};

export function detectBasinByCoords(lat, lon) {
  if (lat >= 41.0 && lat <= 47.8 && lon >= 32.5 && lon <= 41.5) return 'black_azov';
  if (lat >= 54.0 && lat <= 60.5 && lon >= 19.0 && lon <= 31.0) return 'baltic';
  if (lat >= 65.0 && lon >= 30.5 && lon <= 59.5) return 'barents_white';
  if (lat >= 60.5 && lat < 66.5 && lon >= 29.0 && lon <= 38.0) return 'nw_karelia';
  if (lon >= 130.0 && lat >= 42.0) return 'pacific_sea';
  if (lon >= 118.0 && lon < 141.0 && lat >= 47.0 && lat < 55.5) return 'amur';
  if (lat >= 51.0 && lat <= 56.5 && lon >= 103.0 && lon <= 112.0) return 'baikal';
  if (lon >= 88.0 && lon < 135.0 && lat >= 52.0) return 'yenisei_lena';
  if (lat >= 52.0 && lon >= 61.5 && lon < 88.0) return 'arctic_ob_taz';
  if (lon < 37.0 && lat < 56.0) return 'euro_west';
  return 'volga_caspian';
}

export function isCoastalInBasin(basinCode, lat, lon) {
  if (!BASIN_CONFIGS[basinCode]?.hasSea) return false;

  switch (basinCode) {
    case 'arctic_ob_taz':
      return (lat >= 66.45 && lon >= 66.0 && lon <= 74.5) || (lat >= 67.2 && lon >= 66.0 && lon <= 84.0);

    case 'yenisei_lena':
      return lat >= 69.0;

    case 'nw_karelia':
      return (lat >= 63.8 && lon >= 34.0) || (lat <= 61.0 && lon <= 30.8);

    case 'volga_caspian':
      return lat <= 46.8 && lon >= 46.5 && lon <= 51.5;

    case 'black_azov':
      return lat <= 47.4 && lon >= 32.5 && lon <= 40.5;

    case 'baltic':
      return (lon <= 23.0) || (lat >= 59.5 && lon >= 27.5 && lon <= 30.6);

    case 'barents_white':
    case 'pacific_sea':
      return true;

    default:
      return false;
  }
}
