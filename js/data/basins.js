/**
 * @file basins.js
 * @description Многоуровневая система рыбохозяйственных бассейнов, ихтио-экорегионов (суббассейнов),
 * строгих гео-ареальных фильтров для всех 115 видов рыб по 89 субъектам РФ и 4-уровневого алгоритма
 * приоритетного ранжирования rankSpeciesWithUserPriority (Ревизия 2.9.2 r259).
 */
export const BASIN_CONFIGS = {
  black_azov: { name: 'Черноморско-Азовский бассейн', hasSea: true, spawnShiftWeeks: -2 },
  baltic: { name: 'Балтийский морской бассейн', hasSea: true, spawnShiftWeeks: 0 },
  barents_white: { name: 'Баренцево-Беломорский северный бассейн', hasSea: true, spawnShiftWeeks: 2 },
  nw_karelia: { name: 'Ладожско-Онежский и Карельский бассейн', hasSea: true, spawnShiftWeeks: 1 },
  pacific_sea: { name: 'Тихоокеанский дальневосточный бассейн', hasSea: true, spawnShiftWeeks: 1 },
  amur: { name: 'Амурский пресноводный бассейн', hasSea: false, spawnShiftWeeks: 0 },
  baikal: { name: 'Байкало-Ангарский бассейн', hasSea: false, spawnShiftWeeks: 1 },
  yenisei_lena: { name: 'Енисейско-Ленский сибирский бассейн', hasSea: true, spawnShiftWeeks: 2 },
  arctic_ob_taz: { name: 'Обь-Иртышский и Тазовский бассейн', hasSea: true, spawnShiftWeeks: 1 },
  euro_west: { name: 'Днепровско-Деснянский западный бассейн', hasSea: false, spawnShiftWeeks: -1 },
  volga_caspian: { name: 'Волжско-Каспийский бассейн (Волга, Кама, Ока, Урал)', hasSea: true, spawnShiftWeeks: 0 }
};

export function detectBasinByCoords(lat, lon) {
  // Чукотка в Западном полушарии (Уэлен, Лаврентия, Провидения: lon < 0)
  if (lon < -160.0 && lat >= 60.0) return 'pacific_sea';

  // Черноморско-Азовский и Донской бассейн (включая Северский Донец, Оскол, Красивую Мечу, Ворону, Хопёр, Мичуринск, Ливны, Ефремов, Старый Оскол)
  // Но НЕ Каспийский берег Дагестана/Калмыкии/Астрахани и НЕ бассейн Терека/Сулака/Кумы (lon >= 43.2 && lat <= 46.2)
  if (lat >= 41.0 && lat <= 45.8 && lon >= 43.2 && lon <= 51.5) return 'volga_caspian';
  if (lat >= 41.0 && lat <= 47.8 && lon >= 31.5 && lon <= 43.2) return 'black_azov';
  // Донской бассейн в Центральном Черноземье (Воронеж, Липецк, Елец, Ливны, Ефремов, Старый Оскол, Губкин, Белгород, Валуйки, Мичуринск, Уварово, Борисоглебск)
  // При этом Тамбов, Котовск, Моршанск (р. Цна: lat >= 52.55 && lon >= 41.2) остаются в volga_caspian!
  if (lat >= 47.8 && lat <= 53.35 && lon >= 36.35 && lon <= 43.5) {
    const isTambovTsna = lat >= 52.55 && lon >= 41.15 && lon <= 42.5;
    const isKurskSeim = lat >= 51.25 && lon <= 37.35 && lat <= 52.45;
    const isOrelOka = lat >= 52.65 && lon <= 37.35;
    if (!isTambovTsna && !isKurskSeim && !isOrelOka) return 'black_azov';
  }

  // Балтийский бассейн (Калининград, Псков, Великие Луки, Финский залив, Выборг, Высоцк, Луга)
  if (lat >= 53.8 && lat <= 61.0 && lon >= 19.0 && lon <= 30.85) return 'baltic';
  // Северо-запад Смоленской области (Велиж, Демидов, Пржевальское — бассейн Западной Двины)
  if (lat >= 55.15 && lat <= 56.5 && lon >= 30.8 && lon <= 32.1) return 'baltic';

  // Баренцево-Беломорский, Северо-Двинский и Печорский бассейн (включая Вологду, Сухону, Вычегду, Печору, Воркуту, Инту, Амдерму)
  if (lat >= 59.1 && lon >= 39.2 && lon < 65.0) return 'barents_white';
  if (lat >= 64.5 && lon >= 30.0 && lon < 65.0) return 'barents_white';

  // Ладожско-Онежский, Ильменско-Волховский и Карельский бассейн (включая Старую Руссу, Валдай, Боровичи, Вытегру, Карелию)
  // При этом Рыбинское вдхр. (Брейтово, Борок, Череповец, Весьегонск, Пестово) и Белое озеро (Липин Бор, Белозерск) — это volga_caspian!
  if (lat >= 57.45 && lat < 66.5 && lon >= 29.0 && lon <= 37.8) {
    const isUpperVolgaRybinka = (lat <= 59.35 && lon >= 35.5) || (lat <= 57.9 && lon >= 32.3);
    const isBeloyeLake = lat >= 59.8 && lat <= 60.4 && lon >= 37.1 && lon <= 38.2;
    if (!isUpperVolgaRybinka && !isBeloyeLake) return 'nw_karelia';
  }

  // Дальний Восток: разделение Приморья (Ханка/Уссури -> amur; побережье Японского моря, Сахалин, Камчатка, Магадан, Чукотка -> pacific_sea)
  if (lon >= 130.0 && lat >= 42.0) {
    const isKhankaUssuriInland = lat >= 44.1 && lat <= 48.6 && lon >= 130.8 && lon <= 135.2;
    const isAmurMainStem = lat >= 47.5 && lat <= 54.0 && lon >= 130.0 && lon <= 140.5;
    if (isKhankaUssuriInland || isAmurMainStem) return 'amur';
    if (lon >= 135.2 || lat < 44.1 || lat >= 54.0) return 'pacific_sea';
  }
  if (lon >= 112.0 && lon < 141.0 && lat >= 44.0 && lat < 56.0) return 'amur';

  // Байкало-Ангарский бассейн (Байкал, Селенга, Хилок, Чикой, Иркутск, Братск, Усть-Илимск)
  if (lat >= 49.5 && lat <= 58.5 && lon >= 101.5 && lon < 112.5) return 'baikal';

  // Енисейско-Ленский сибирский бассейн (включая Витим/Бодайбо, Алдан, Лену, Индигирку, Колыму)
  if (lon >= 88.0 && lon < 162.0 && lat >= 50.0) return 'yenisei_lena';

  // Обь-Иртышский и Тазовский бассейн (Западная Сибирь, Урал, Зауралье, ЯНАО, ХМАО)
  if (lat >= 50.5 && lon >= 59.65 && lon < 88.0) {
    // Южный Урал (Магнитогорск, Верхнеуральск, Ириклинское вдхр. — бассейн р. Урал -> volga_caspian)
    if (lat < 54.25 && lon < 60.6) return 'volga_caspian';
    return 'arctic_ob_taz';
  }

  // Днепровско-Деснянский западный бассейн (Смоленск, Брянск, Курск/Сейм, Юго-Запад Калужской обл. — Людиново/Киров, Дмитровск, Грайворон)
  // При этом Калуга, Обнинск, Таруса, Козельск, Орёл, Мценск, Белёв, Алексин, Суворов, Гагарин, Сычёвка (р. Ока, Угра, Жиздра, Зуша, Вазуза) — это volga_caspian!
  if (lon < 37.35 && lat < 55.6) {
    const isOkaUgraVazuza = (lat >= 54.15 && lon >= 34.8) || (lat >= 52.8 && lon >= 35.8 && lat <= 54.2);
    const isLudinovoKirovBolva = lat >= 53.7 && lat <= 54.25 && lon >= 34.2 && lon <= 34.75;
    if (!isOkaUgraVazuza || isLudinovoKirovBolva) return 'euro_west';
  }

  return 'volga_caspian';
}

export function isCoastalInBasin(basinCode, lat, lon) {
  if (!BASIN_CONFIGS[basinCode]?.hasSea) return false;
  switch (basinCode) {
    case 'arctic_ob_taz':
      return (lat >= 66.45 && lon >= 65.5 && lon <= 74.5) || (lat >= 67.2 && lon >= 65.5 && lon <= 84.0);
    case 'yenisei_lena':
      return lat >= 69.0;
    case 'nw_karelia':
      return (lat >= 63.8 && lon >= 34.0) || (lat <= 60.8 && lon <= 30.8);
    case 'volga_caspian':
      return (lat <= 46.65 && lon >= 46.5 && lon <= 51.5) || (lat <= 44.5 && lon >= 46.5 && lon <= 49.0);
    case 'black_azov':
      if (lat <= 44.85 && lon >= 37.0 && lon <= 40.2) return true; // ЧПК (Анапа — Сочи)
      if (lat <= 46.6 && lon >= 31.5 && lon <= 36.8) return true; // Крым и Херсонское побережье
      if (lat >= 45.0 && lat <= 47.4 && lon >= 34.5 && lon <= 39.5) return true; // Азовское море, Сиваш и лиманы
      return false;
    case 'baltic':
      return (lon <= 22.5) || (lat >= 59.35 && lon >= 27.5 && lon <= 30.8);
    case 'barents_white':
      return lat >= 66.2 || (lat >= 63.8 && lon >= 34.0 && lon <= 46.0) || (lat >= 68.0 && lon < 65.5);
    case 'pacific_sea':
      return true;
    default:
      return false;
  }
}

export function getSpotEcoregion(lat, lon, basinCode, waterType = 'small_river', selectedWaterName = '') {
  const nLat = Number.isFinite(Number(lat)) ? Number(lat) : 55.75;
  const nLon = Number.isFinite(Number(lon)) ? Number(lon) : 37.62;
  const bCode = (basinCode && BASIN_CONFIGS[basinCode]) ? basinCode : detectBasinByCoords(nLat, nLon);
  const wNameLower = String(selectedWaterName || '').toLowerCase();
  const isLakeOrQuarry = waterType === 'tundra_lake' || waterType === 'quarry';
  const isSea = waterType === 'sea_gulf' || waterType === 'open_sea';

  if (bCode === 'arctic_ob_taz') {
    const isPolarUralStream = (lon <= 67.8 && lat >= 65.4 && waterType === 'small_river') ||
      /собь|харбей|лонгот|щучья|кара|сыня|войкар|кожим/i.test(wNameLower);
    if (isPolarUralStream) {
      return {
        subRegion: 'polar_ural_mountain',
        displayBasinName: 'Горные реки Полярного Урала (Собь, Харбей, Лонгот-Юган, Сыня)',
        searchPlaceholder: 'Поиск рыбы (хариус, арктический голец, таймень, сиг-пыжьян, валёк, налим, щука, окунь...)',
        signatureSpecies: ['grayling', 'char', 'pizhyan', 'valek', 'burbot', 'pike', 'perch', 'dace', 'ide', 'peled', 'chir']
      };
    }
    if (lat >= 66.45 || isSea) {
      return {
        subRegion: 'yanao_arctic_coast',
        displayBasinName: 'Обь-Тазовский арктический бассейн (ЯНАО: Обская и Тазовская губы)',
        searchPlaceholder: 'Поиск рыбы (пелядь, сырок, щёкур, ряпушка, корюшка, навага, налим, щука...)',
        signatureSpecies: isSea
          ? ['peled', 'chir', 'pizhyan', 'cisco', 'smelt', 'navaga', 'omul_arctic', 'pike', 'perch', 'burbot', 'dace', 'ide', 'roach', 'ruffe', 'char', 'saffron_cod']
          : ['peled', 'chir', 'pizhyan', 'pike', 'perch', 'dace', 'burbot', 'cisco', 'roach', 'ide', 'ruffe', 'smelt']
      };
    }
    if (lat >= 62.6) {
      return {
        subRegion: 'yanao_north_taiga',
        displayBasinName: 'Обь-Тазовский северный бассейн (ЯНАО: Пур, Таз, Надым, Обь)',
        searchPlaceholder: 'Поиск рыбы (щука, окунь, сорога, мохтик, елец, язь, налим, сырок, щёкур...)',
        signatureSpecies: waterType === 'small_river'
          ? ['pike', 'perch', 'roach', 'dace', 'ide', 'burbot', 'ruffe', 'crucian', 'peled', 'pizhyan']
          : (isLakeOrQuarry
              ? ['perch', 'pike', 'roach', 'crucian', 'peled', 'chir', 'pizhyan', 'burbot', 'ruffe', 'ide']
              : ['pike', 'perch', 'peled', 'roach', 'dace', 'ide', 'burbot', 'chir', 'pizhyan', 'cisco', 'ruffe'])
      };
    }
    if (lat >= 58.5 && lon >= 61.5 && lon < 85.5) {
      return {
        subRegion: 'hmao_middle_ob',
        displayBasinName: 'Обь-Иртышский таёжный бассейн (Югра: Обь, Иртыш, Конда, Северная Сосьва, Вах)',
        searchPlaceholder: 'Поиск рыбы (щука, окунь, язь, сорога, мохтик, елец, сырок, карась, налим, судак...)',
        signatureSpecies: isLakeOrQuarry
          ? ['perch', 'pike', 'crucian', 'roach', 'peled', 'ide', 'rotan', 'burbot', 'bream', 'zander', 'tench', 'ruffe']
          : ['pike', 'perch', 'roach', 'ide', 'dace', 'burbot', 'peled', 'zander', 'bream', 'crucian', 'ruffe', 'gudgeon', 'tugun', 'sterlet']
      };
    }
    if (lon >= 58.8 && lon <= 62.1 && lat >= 54.0 && lat < 61.0) {
      return {
        subRegion: 'ural_mountain_lakes',
        displayBasinName: 'Уральский бассейн (Исеть, Чусовая, Тавда, Миасс, озёра Урала)',
        searchPlaceholder: 'Поиск рыбы (окунь, щука, чебак, лещ, карась, судак, карп, рипус, сиг, язь...)',
        signatureSpecies: waterType === 'quarry'
          ? ['perch', 'pike', 'roach', 'bream', 'crucian', 'zander', 'carp', 'vendace', 'whitefish', 'peled', 'ide', 'tench', 'ruffe', 'burbot', 'rudd', 'bleak', 'rotan']
          : (waterType === 'tundra_lake'
              ? ['crucian', 'perch', 'rotan', 'pike', 'roach', 'carp', 'bream', 'tench', 'rudd', 'bleak', 'ruffe', 'peled']
              : ['perch', 'pike', 'roach', 'bream', 'dace', 'ide', 'crucian', 'chub', 'zander', 'carp', 'gudgeon', 'ruffe', 'bleak', 'burbot', 'tench', 'grayling', 'white_bream', 'rudd'])
      };
    }
    if (lon > 62.1 && lon < 76.2 && lat < 58.5) {
      const isKurgan = lat <= 56.4 && lon >= 62.1 && lon <= 68.5;
      return {
        subRegion: 'zauralye_tobol_irtysh',
        displayBasinName: isKurgan
          ? 'Тобол-Исетский бассейн (Зауралье: Тобол, Исеть, Миасс, озёра Кургана)'
          : 'Обь-Иртышский бассейн (Тура, Тобол, Ишим, Иртыш)',
        searchPlaceholder: 'Поиск рыбы (карась, окунь, щука, чебак, лещ, судак, язь, сазан, пелядь, ротан...)',
        signatureSpecies: isLakeOrQuarry
          ? ['crucian', 'perch', 'rotan', 'pike', 'roach', 'carp', 'bream', 'zander', 'tench', 'peled', 'ide', 'rudd', 'bleak', 'ruffe', 'loach']
          : (waterType === 'big_river'
              ? ['perch', 'pike', 'zander', 'bream', 'roach', 'ide', 'crucian', 'carp', 'dace', 'burbot', 'ruffe', 'white_bream', 'gudgeon', 'bleak', 'tench', 'rudd', 'sterlet']
              : ['perch', 'pike', 'roach', 'crucian', 'ide', 'bream', 'dace', 'carp', 'zander', 'gudgeon', 'ruffe', 'bleak', 'tench', 'burbot', 'white_bream', 'rudd', 'rotan', 'loach'])
      };
    }
    const isAltaiFoothills = (lat <= 54.4 && lon >= 83.2) || /телецк|бия|катунь|мрассу|кондома|мана|томь/i.test(wNameLower);
    return {
      subRegion: isAltaiFoothills ? 'altai_mountain_ob' : 'upper_ob_steppe',
      displayBasinName: isAltaiFoothills
        ? 'Верхне-Обский и Алтайский бассейн (Бия, Катунь, Томь, Телецкое оз.)'
        : 'Верхне-Обский бассейн (Обь, Обское море, Томь, оз. Чаны)',
      searchPlaceholder: isAltaiFoothills
        ? 'Поиск рыбы (хариус, окунь, щука, чебак, елец, ленок, таймень, налим...)'
        : 'Поиск рыбы (окунь, щука, судак, чебак, лещ, язь, карась, сазан...)',
      signatureSpecies: isAltaiFoothills
        ? ['grayling', 'perch', 'pike', 'dace', 'roach', 'lenok', 'ide', 'burbot', 'zander', 'bream', 'crucian', 'gudgeon', 'ruffe']
        : (isLakeOrQuarry
            ? ['crucian', 'perch', 'pike', 'roach', 'zander', 'bream', 'ide', 'carp', 'tench', 'rotan', 'peled', 'ruffe', 'bleak', 'rudd']
            : ['perch', 'pike', 'zander', 'roach', 'bream', 'ide', 'crucian', 'dace', 'carp', 'burbot', 'ruffe', 'gudgeon', 'bleak', 'tench', 'white_bream', 'sterlet'])
    };
  }

  if (bCode === 'volga_caspian') {
    const isCaucasusMountainStream = lat <= 44.5 && lon >= 41.5 && lon <= 48.5 &&
      (waterType === 'small_river' || /баксан|чегем|черек|малк|ардон|фиагдон|гизельдон|урван|аргун|асса|армхи|андийск|аварск|каракойсу|самур/i.test(wNameLower));
    if (isCaucasusMountainStream) {
      return {
        subRegion: 'caucasus_terek_sulak_mountain',
        displayBasinName: 'Горные реки Северного Кавказа (бассейн Терека, Сулака и Самура)',
        searchPlaceholder: 'Поиск рыбы (форель ручьевая, терский усач, кавказский голавль, подуст, пескарь...)',
        signatureSpecies: ['brown_trout', 'barbel', 'chub', 'undermouth', 'gudgeon', 'bleak', 'rainbow_trout']
      };
    }
    if (lat <= 48.85) {
      return {
        subRegion: 'lower_volga_caspian',
        displayBasinName: 'Нижне-Волжский и Каспийский бассейн (Дельта Волги, Ахтуба, Терек, Сулак, Каспий)',
        searchPlaceholder: 'Поиск рыбы (сазан, судак, жерех, сом, вобла, щука, окунь, лещ, краснопёрка, кутум...)',
        signatureSpecies: isSea
          ? ['vobla', 'kutum', 'carp', 'zander', 'asp', 'pike', 'perch', 'rudd', 'bream', 'catfish', 'goby', 'chekhon', 'mullet', 'herring']
          : ['carp', 'zander', 'asp', 'catfish', 'pike', 'perch', 'vobla', 'bream', 'crucian', 'rudd', 'roach', 'chekhon', 'white_bream', 'volga_zander', 'tench', 'silver_carp', 'grass_carp', 'buffalo', 'blue_bream', 'sopa', 'ide', 'bleak', 'kutum', 'barbel']
      };
    }
    if (lon >= 52.0) {
      const isUralRiver = lat <= 53.6 && lon >= 52.0;
      const isBashkirMountain = lon >= 56.2 && lat >= 52.8 && lat <= 56.2;
      return {
        subRegion: 'kama_belaya_ural',
        displayBasinName: isUralRiver
          ? 'Уральский бассейн (р. Урал, Сакмара, Ириклинское вдхр.)'
          : 'Камско-Бельский бассейн (Белая, Уфа, Кама, Вятка, водохранилища)',
        searchPlaceholder: 'Поиск рыбы (щука, окунь, судак, лещ, голавль, жерех, сорога, карась, сазан, сом...)',
        signatureSpecies: isLakeOrQuarry
          ? ['perch', 'pike', 'crucian', 'bream', 'roach', 'zander', 'carp', 'white_bream', 'rudd', 'tench', 'ide', 'bleak', 'catfish', 'rotan', 'ruffe']
          : [
              'perch', 'pike', 'bream', 'roach', 'zander', 'chub', 'asp', 'crucian', 'ide', 'white_bream',
              'carp', 'chekhon', 'catfish', 'dace', 'gudgeon', 'bleak', 'rudd', 'tench', 'burbot',
              ...(isBashkirMountain ? ['grayling', 'brown_trout'] : []),
              'volga_zander', 'undermouth', 'sopa', 'blue_bream', 'sterlet'
            ]
      };
    }
    return {
      subRegion: 'upper_middle_volga',
      displayBasinName: 'Волжско-Окский бассейн (Волга, Ока, водохранилища Центра и Поволжья)',
      searchPlaceholder: 'Поиск рыбы (лещ, судак, окунь, щука, плотва, карась, голавль, жерех, сазан, сом, берш...)',
      signatureSpecies: isLakeOrQuarry
        ? ['perch', 'pike', 'bream', 'roach', 'crucian', 'zander', 'white_bream', 'carp', 'rudd', 'tench', 'bleak', 'ide', 'catfish', 'volga_zander', 'blue_bream', 'rotan', 'ruffe', 'burbot']
        : ['perch', 'pike', 'bream', 'roach', 'zander', 'crucian', 'white_bream', 'chub', 'asp', 'carp', 'ide', 'catfish', 'bleak', 'rudd', 'tench', 'chekhon', 'volga_zander', 'blue_bream', 'sopa', 'dace', 'gudgeon', 'ruffe', 'burbot', 'undermouth', 'sterlet']
    };
  }

  if (bCode === 'black_azov') {
    const isSochiCommercialPond = lat <= 44.65 && lat >= 43.3 && lon >= 38.4 && lon <= 41.0 &&
      (waterType === 'cooling_reservoir' || waterType === 'tundra_lake' || waterType === 'quarry' || /серебрян|барановск|форелев|ахштыр|казачий брод|платник|пруд/i.test(wNameLower));
    if (isSochiCommercialPond) {
      return {
        subRegion: 'sochi_commercial_pond',
        displayBasinName: 'Прудовые и форелевые хозяйства Большого Сочи и предгорий Кавказа',
        searchPlaceholder: 'Поиск рыбы (радужная форель, карп, карась, белый амур, толстолобик, канальный сомик, сом...)',
        signatureSpecies: ['rainbow_trout', 'carp', 'crucian', 'grass_carp', 'silver_carp', 'channel_catfish', 'catfish']
      };
    }
    const isCaucasianStream = lat <= 44.65 && lat >= 43.3 && lon >= 38.4 && lon <= 42.5 &&
      (waterType === 'small_river' || /мзымта|сочи|шахе|хоста|псоу|аше|псезуапсе|мацеста|кудепста|дагомыс|туапсе|пшада|вулан|теберда|зеленчук|лаба|белая|мраморн/i.test(wNameLower));
    if (isSea) {
      return {
        subRegion: 'black_azov_sea',
        displayBasinName: 'Черноморско-Азовский морской бассейн (Чёрное и Азовское моря)',
        searchPlaceholder: 'Поиск рыбы (ставрида, барабулька, сарган, смарида, луфарь, пеленгас, скорпена, ласкирь, глосса...)',
        signatureSpecies: ['horse_mackerel', 'red_mullet', 'sea_bass', 'garfish', 'mullet', 'scorpionfish', 'sea_bream', 'wrasse', 'bluefish', 'goby', 'flounder', 'turbot', 'mackerel', 'crab']
      };
    }
    if (isCaucasianStream) {
      return {
        subRegion: 'caucasus_mountain_river',
        displayBasinName: 'Черноморский бассейн (горные реки Кавказа и Большого Сочи)',
        searchPlaceholder: 'Поиск рыбы (ручьевая форель, пеструшка, кавказский голавль, усач, подуст, бычок, шемая...)',
        signatureSpecies: ['chub', 'brown_trout', 'barbel', 'undermouth', 'rainbow_trout', 'shemaya', 'gudgeon', 'bleak', 'goby', 'mullet']
      };
    }
    const isDon = lat >= 46.8;
    return {
      subRegion: 'don_kuban_inland',
      displayBasinName: isDon ? 'Донской бассейн (Дон, Северский Донец, Хопёр, Маныч, Воронеж)' : 'Кубанско-Азовский бассейн (Кубань, лиманы, водохранилища)',
      searchPlaceholder: 'Поиск рыбы (сазан, карась, судак, сула, тарань, щука, окунь, лещ, сом, голавль, жерех, рыбец...)',
      signatureSpecies: ['carp', 'crucian', 'zander', 'pike', 'perch', 'taran', 'bream', 'roach', 'catfish', 'chub', 'asp', 'rudd', 'white_bream', 'silver_carp', 'grass_carp', 'vimba', 'chekhon', 'goby', 'tench', 'bleak', 'volga_zander', 'barbel']
    };
  }

  if (bCode === 'euro_west') {
    return {
      subRegion: 'euro_west_desna_seim',
      displayBasinName: 'Днепровско-Деснянский и Сеймский бассейн (Днепр, Десна, Сейм, Псёл)',
      searchPlaceholder: 'Поиск рыбы (щука, окунь, лещ, карась, плотва, судак, голавль, карп, жерех, сом...)',
      signatureSpecies: ['perch', 'pike', 'crucian', 'bream', 'roach', 'zander', 'carp', 'chub', 'asp', 'white_bream', 'ide', 'tench', 'rudd', 'bleak', 'catfish', 'dace', 'gudgeon', 'ruffe', 'burbot', 'rotan']
    };
  }

  if (bCode === 'baltic') {
    return {
      subRegion: 'baltic_sea_rivers',
      displayBasinName: 'Балтийский бассейн (Финский и Куршский заливы, Нева, Преголя, Луга, Чудское оз.)',
      searchPlaceholder: 'Поиск рыбы (судак, окунь, щука, лещ, корюшка, плотва, камбала, сарган, треска, сырть...)',
      signatureSpecies: isSea
        ? ['smelt', 'flounder', 'zander', 'perch', 'pike', 'bream', 'roach', 'garfish', 'cod', 'herring', 'plaice', 'vimba', 'goby', 'salmon', 'trout']
        : ['perch', 'pike', 'zander', 'bream', 'roach', 'white_bream', 'crucian', 'smelt', 'ide', 'vimba', 'chub', 'asp', 'tench', 'rudd', 'bleak', 'burbot', 'ruffe', 'dace']
    };
  }

  if (bCode === 'nw_karelia') {
    return {
      subRegion: 'karelia_ladoga_onega',
      displayBasinName: 'Ладожско-Онежский, Ильменский и Карельский бассейн (Ладога, Онега, Ильмень, Вуокса, Карелия)',
      searchPlaceholder: 'Поиск рыбы (окунь, щука, судак, сиг, хариус, кумжа, палия, ряпушка, плотва, сорога, лещ, налим...)',
      signatureSpecies: ['perch', 'pike', 'zander', 'roach', 'bream', 'whitefish', 'vendace', 'grayling', 'trout', 'char', 'burbot', 'ide', 'dace', 'smelt', 'salmon', 'broad_whitefish', 'ruffe', 'crucian', 'catfish']
    };
  }

  if (bCode === 'barents_white') {
    const isPechoraDvina = lon >= 38.5;
    return {
      subRegion: isPechoraDvina ? 'dvina_pechora_north' : 'kola_barents',
      displayBasinName: isPechoraDvina
        ? 'Северо-Двинский и Печорский бассейн (Северная Двина, Вычегда, Сухона, Печора, Белое море)'
        : 'Кольско-Баренцевоморский бассейн (Кольский п-ов, Баренцево и Белое моря)',
      searchPlaceholder: isSea
        ? 'Поиск рыбы (треска, сайда, пикша, камбала, палтус, навага, корюшка, горбуша, сёмга...)'
        : 'Поиск рыбы (хариус, сиг, кумжа, сёмга, щука, окунь, лещ, судак, налим, горбуша, голец, сорога...)',
      signatureSpecies: isSea
        ? ['cod', 'haddock', 'saithe', 'flounder', 'plaice', 'navaga', 'smelt', 'halibut', 'wolffish', 'herring', 'salmon', 'pink_salmon', 'sea_bass', 'capelin', 'king_crab']
        : (isPechoraDvina
            ? ['pike', 'perch', 'bream', 'zander', 'grayling', 'whitefish', 'roach', 'ide', 'dace', 'burbot', 'crucian', 'salmon', 'pink_salmon', 'peled', 'chir', 'pizhyan', 'vendace', 'ruffe', 'smelt', 'navaga', 'sterlet']
            : ['trout', 'grayling', 'char', 'whitefish', 'salmon', 'pink_salmon', 'pike', 'perch', 'burbot', 'vendace', 'smelt', 'dace', 'roach'])
    };
  }

  if (bCode === 'yenisei_lena') {
    const isNorthYeniseiOrLena = lat >= 60.0 || lon >= 108.0;
    return {
      subRegion: isNorthYeniseiOrLena ? 'yenisei_lena_north' : 'yenisei_angara_south',
      displayBasinName: lon >= 108.0
        ? 'Ленский и Северо-Восточный бассейн (Лена, Вилюй, Алдан, Индигирка, Колыма — Якутия)'
        : (lat >= 60.0
            ? 'Нижне-Енисейский и Таймырский северный бассейн'
            : 'Верхне-Енисейский и Ангарский бассейн (Енисей, Ангара, Мана, Хакасия, Тыва)'),
      searchPlaceholder: isNorthYeniseiOrLena
        ? 'Поиск рыбы (хариус, ленок, щука, окунь, пелядь, чир, пыжьян, тугун, налим, сорога, елец...)'
        : 'Поиск рыбы (хариус, окунь, щука, елец-чебак, ленок, сорога, налим, пелядь, лещ, таймень...)',
      signatureSpecies: isNorthYeniseiOrLena
        ? ['pike', 'perch', 'grayling', 'lenok', 'dace', 'peled', 'chir', 'pizhyan', 'tugun', 'valek', 'ide', 'roach', 'crucian', 'burbot', 'cisco', 'char']
        : ['grayling', 'perch', 'pike', 'dace', 'roach', 'lenok', 'ide', 'crucian', 'burbot', 'peled', 'bream', 'zander', 'ruffe', 'gudgeon', 'tugun', 'pizhyan']
    };
  }

  if (bCode === 'baikal') {
    return {
      subRegion: 'baikal_angara_selenga',
      displayBasinName: 'Байкало-Ангарский бассейн (Байкал, Ангара, Селенга, Баргузин)',
      searchPlaceholder: 'Поиск рыбы (байкальский хариус, омуль, ленок, окунь, щука, сорога, елец-чебак, сиг, налим...)',
      signatureSpecies: ['baikal_grayling', 'perch', 'pike', 'roach', 'dace', 'omul', 'lenok', 'crucian', 'ide', 'burbot', 'pizhyan', 'peled', 'ruffe']
    };
  }

  if (bCode === 'amur') {
    return {
      subRegion: 'amur_ussuri_zeya',
      displayBasinName: 'Амурский бассейн (Амур, Зея, Бурея, Уссури, оз. Ханка, верхнеамурские озёра)',
      searchPlaceholder: 'Поиск рыбы (карась, сазан, щука, верхогляд, змееголов, ленок, хариус, сом, конь-губарь, кета...)',
      signatureSpecies: ['crucian', 'carp', 'pike', 'sky_gazer', 'snakehead', 'amur_catfish', 'tarpon_carp', 'parabramis', 'lenok', 'grayling', 'grass_carp', 'burbot', 'rotan', 'chum_salmon', 'pink_salmon', 'gudgeon']
    };
  }

  return {
    subRegion: 'pacific_far_east',
    displayBasinName: 'Тихоокеанский бассейн (Приморье, Сахалин, Камчатка, Магадан, Чукотка)',
    searchPlaceholder: 'Поиск рыбы (кета, горбуша, кижуч, мальма, кунджа, корюшка, навага, камбала, терпуг, сима...)',
    signatureSpecies: isSea
      ? ['smelt', 'navaga', 'starry_flounder', 'flounder', 'greenling', 'pink_salmon', 'chum_salmon', 'coho_salmon', 'cherry_salmon', 'char', 'dolly_varden', 'herring', 'walleye_pollock', 'sea_bass', 'halibut', 'crab', 'king_crab']
      : ['dolly_varden', 'char', 'pink_salmon', 'chum_salmon', 'coho_salmon', 'cherry_salmon', 'sockeye_salmon', 'chinook_salmon', 'smelt', 'navaga', 'grayling', 'crucian', 'pike', 'rotan']
  };
}

/**
 * Строгая гео-биотопная проверка обитания вида `fish` в выбранном водоёме или локации.
 * Если пользователь явно выбрал конкретный водоём (`selectedWaterName`), применяется строгая изоляция
 * биотопа этого водоёма (`waterType`) без просачивания магистральных рек, ГРЭС и моря из радиуса 95–120 км.
 */
export function isSpeciesInGeoRange(fish, lat, lon, basinCode, waterType = 'small_river', radiusKm = 50, radiusWaterTypes = null, isCoastal = false, hasCoolingInRadius = false, selectedWaterName = '') {
  if (!fish) return false;
  const bCode = basinCode || detectBasinByCoords(lat, lon);
  if (!Array.isArray(fish.basins) || !fish.basins.includes(bCode)) return false;
  const fid = fish.id;
  const wNameLower = String(selectedWaterName || '').toLowerCase().trim();
  const hasExplicitWater = wNameLower.length > 0;
  // При явном выборе конкретного водоёма (например, р. Ево-Яха, оз. Молодёжное, р. Сочи) отключаем подтягивание чужих биотопов из радиуса
  const rSet = hasExplicitWater
    ? new Set([waterType])
    : (radiusWaterTypes instanceof Set
        ? radiusWaterTypes
        : (Array.isArray(radiusWaterTypes) ? new Set(radiusWaterTypes) : new Set([waterType])));
  const isSeaWater = waterType === 'sea_gulf' || waterType === 'open_sea';
  const hasBigRiverInRadius = waterType === 'big_river' || (!hasExplicitWater && rSet.has('big_river'));
  const hasDeepQuarryInRadius = waterType === 'quarry' || (!hasExplicitWater && rSet.has('quarry'));
  const effCooling = waterType === 'cooling_reservoir' || (!hasExplicitWater && hasCoolingInRadius);
  const hasSeaInRadius = isSeaWater || (!hasExplicitWater && (isCoastal || rSet.has('sea_gulf') || rSet.has('open_sea')));

  // Озеро Молодёжное (г. Новый Уренгой, ЯНАО): исторически обитал только гольян (gudgeon), 2 года назад (2024) зарыблено плотвой (сорожкой) и мелким окунем
  if (/молод[её]жн/i.test(wNameLower) && (bCode === 'arctic_ob_taz' || lat >= 65.0)) {
    return ['roach', 'perch', 'gudgeon'].includes(fid);
  }

  // Малые тундровые и лесотундровые реки Крайнего Севера (Новый Уренгой: р. Седе-Яха, р. Ево-Яха, р. Тамчара-Яха, р. Варенга-Яха, р. Лимбяяха, lat >= 64.5)
  if (bCode === 'arctic_ob_taz' && lat >= 64.5 && waterType === 'small_river') {
    if (['rotan', 'loach', 'gudgeon', 'crucian'].includes(fid)) return false;
  }

  // Степные и лесостепные замкнутые озёра Зауралья (Курганская обл., юг Тюменской и восток Челябинской обл.: оз. Мишкинское, оз. Песчаное, оз. Варгашинское, оз. Мартыново, оз. Камышное, оз. Половинное, оз. Сафакуль, оз. Ачикуль, оз. Башкирское, оз. Чёрное)
  if (bCode === 'arctic_ob_taz' && lat < 59.0 && waterType === 'tundra_lake' && !/стариц|проток|затон|пойм/i.test(wNameLower)) {
    if (['burbot', 'ide', 'dace', 'gudgeon', 'white_bream', 'bleak', 'bream', 'zander', 'ruffe'].includes(fid)) return false;
  }

  // Глубокие тектонические озёра и карьеры Урала (оз. Увильды, оз. Тургояк, оз. Таватуй, оз. Аракуль, оз. Сунгуль, оз. Синара: lat < 60.0) — отсекаем чисто речных реофилов
  if (bCode === 'arctic_ob_taz' && lat < 60.0 && waterType === 'quarry' && !/вдхр|водохран|пруд/i.test(wNameLower)) {
    if (['taimen', 'grayling', 'dace', 'gudgeon', 'sterlet', 'siberian_sturgeon', 'nelma', 'muksun', 'chir'].includes(fid)) return false;
  }

  // Специальный биотоп Большого Сочи и ЧПК
  const isSochiZone = bCode === 'black_azov' && lat <= 44.65 && lat >= 43.3 && lon >= 38.4 && lon <= 40.6;
  if (isSochiZone && !isSeaWater) {
    const isSochiCommercialPond = waterType === 'cooling_reservoir' || waterType === 'tundra_lake' || waterType === 'quarry' ||
      /серебрян|барановск|форелев|ахштыр|казачий брод|платник|пруд/i.test(wNameLower);
    if (isSochiCommercialPond) {
      return ['rainbow_trout', 'carp', 'crucian', 'grass_carp', 'silver_carp', 'channel_catfish', 'catfish', 'russian_sturgeon'].includes(fid);
    }
    const isCaucasianStream = waterType === 'small_river' || /мзымта|сочи|шахе|хоста|псоу|аше|псезуапсе|мацеста|кудепста|дагомыс|туапсе|пшада|вулан/i.test(wNameLower);
    if (isCaucasianStream) {
      return ['brown_trout', 'trout', 'rainbow_trout', 'chub', 'barbel', 'undermouth', 'shemaya', 'bleak', 'gudgeon', 'goby', 'mullet'].includes(fid);
    }
  }

  // Горные реки Северного Кавказа (КЧР, КБР, Северная Осетия, Ингушетия, Чечня, горный Дагестан, горная Адыгея)
  const isNorthCaucasusMountainStream = (bCode === 'volga_caspian' || bCode === 'black_azov') &&
    lat <= 44.3 && lon >= 39.8 && lon <= 48.2 && waterType === 'small_river' &&
    /теберда|зеленчук|лаба|белая|курждипс|дах|баксан|чегем|черек|малк|ардон|фиагдон|гизельдон|аргун|асса|армхи|андийск|аварск|каракойсу/i.test(wNameLower);
  if (isNorthCaucasusMountainStream) {
    return ['brown_trout', 'rainbow_trout', 'chub', 'barbel', 'undermouth', 'gudgeon', 'bleak'].includes(fid);
  }

  const fishWaters = Array.isArray(fish.waters) ? fish.waters : ['small_river', 'big_river', 'quarry', 'tundra_lake'];
  let waterMatch = fishWaters.includes(waterType);
  if (isSeaWater && (fish.habitat === 'sea' || fishWaters.includes('sea_gulf') || fishWaters.includes('open_sea'))) {
    waterMatch = true;
  }
  if (!waterMatch && !isSeaWater && fish.habitat === 'fresh' && !hasExplicitWater) {
    if (radiusKm >= 120) {
      waterMatch = fishWaters.some(wt => rSet.has(wt));
    }
  }
  if (!waterMatch) return false;

  // В морских акваториях Чёрного и Баренцева морей отсекаем чисто пресноводных щуку, речного окуня, плотву, карася, язя
  if (isSeaWater && ['pike', 'perch', 'roach', 'crucian', 'ide', 'tench', 'dace', 'chub', 'burbot', 'ruffe', 'gudgeon'].includes(fid)) {
    if (bCode === 'black_azov' && (lat <= 45.2 || waterType === 'open_sea')) return false;
    if (bCode === 'barents_white' && waterType === 'open_sea') return false;
    if (bCode === 'pacific_sea' && waterType === 'open_sea') return false;
  }

  if (fish.habitat === 'sea' && !isSeaWater) {
    if (!fish.riverEntry && !['smelt', 'navaga', 'flounder', 'starry_flounder', 'mullet', 'goby', 'pink_salmon', 'chum_salmon', 'coho_salmon', 'sockeye_salmon', 'chinook_salmon', 'cherry_salmon', 'kutum', 'omul_arctic', 'herring'].includes(fid)) {
      return false;
    }
    if (!hasSeaInRadius) {
      if (fid === 'goby') {
        if (!['black_azov', 'volga_caspian', 'baltic'].includes(bCode)) return false;
      } else if (fid === 'smelt') {
        const isInlandSnetokLake = ['nw_karelia', 'baltic', 'volga_caspian'].includes(bCode) && lat >= 56.5 && lon <= 41.5 && hasDeepQuarryInRadius;
        if (!isInlandSnetokLake) return false;
      } else if (['pink_salmon', 'chum_salmon', 'coho_salmon', 'sockeye_salmon', 'chinook_salmon', 'cherry_salmon'].includes(fid)) {
        if (!['pacific_sea', 'amur', 'barents_white'].includes(bCode)) return false;
      } else {
        return false;
      }
    }
  }

  if (fish.legal === 'introduced') {
    if (['tilapia', 'channel_catfish', 'paddlefish', 'buffalo'].includes(fid)) {
      const isSouthernWarm = lat <= 48.5 && (bCode === 'black_azov' || bCode === 'volga_caspian');
      if (waterType !== 'cooling_reservoir' && !(radiusKm >= 120 && effCooling) && !(isSouthernWarm && fid === 'buffalo')) {
        return false;
      }
    }
    if (['silver_carp', 'grass_carp'].includes(fid)) {
      if (lat >= 57.5 && waterType !== 'cooling_reservoir' && !effCooling) return false;
      if (waterType === 'small_river' && lat >= 52.0 && !effCooling) return false;
    }
    if (fid === 'rainbow_trout') {
      if (waterType !== 'cooling_reservoir' && waterType !== 'quarry' && bCode !== 'pacific_sea') return false;
    }
  }

  if (fid === 'char') {
    if (bCode === 'arctic_ob_taz') {
      // Только Полярный Урал и арктическое побережье Карского моря (не в равнинных речках Пура/Таза/Надыма)
      const isPolarUralOrCoast = (lat >= 65.4 && lon <= 68.2) || (lat >= 67.5 && isSeaWater);
      if (!isPolarUralOrCoast) return false;
    } else if (bCode === 'yenisei_lena') {
      if (lat < 66.0) return false; // Таймыр, Путорана, низовья Лены
    } else if (bCode === 'barents_white') {
      if (lat < 64.5) return false; // Кольский п-ов, Северная Карелия, НАО, Полярный Урал
    } else if (bCode === 'nw_karelia') {
      // Палия в глубоких озёрах Ладога, Онега, Сегозеро, Пяозеро, Топозеро
      if (waterType !== 'quarry' && !hasDeepQuarryInRadius) return false;
    } else if (bCode === 'baikal') {
      if (lat < 54.0 || !hasDeepQuarryInRadius) return false;
    } else if (bCode !== 'pacific_sea') {
      return false;
    }
  }

  if (fid === 'chir') {
    if (bCode === 'arctic_ob_taz') {
      if (lat < 60.5) return false;
      // В малых равнинных речках и мелких городских озёрах (Ево-Яха, Седе-Яха, Молодёжное) щёкура нет — он в Пуре, Тазе, Надыме, Оби и крупных глубоких озёрах
      if ((waterType === 'small_river' || /молод[её]жн|безымянн/i.test(wNameLower)) && hasExplicitWater && !/пур|таз|надым|обь|собь|сыня|войкар|нгаркато|негито|ямбуто|пякуто|ямылиму/i.test(wNameLower)) {
        return false;
      }
    } else if (bCode === 'yenisei_lena') {
      if (lat < 59.5) return false;
    } else if (bCode === 'barents_white') {
      if (lat < 64.0 || lon < 49.0) return false;
    } else if (bCode === 'pacific_sea') {
      if (lat < 59.0) return false;
    } else {
      return false;
    }
  }

  if (fid === 'pizhyan') {
    if (bCode === 'arctic_ob_taz') {
      const isTeletskoye = lat <= 52.3 && lon >= 86.5 && hasDeepQuarryInRadius;
      if (lat < 60.0 && !isTeletskoye) return false;
      if (/молод[её]жн|безымянн/i.test(wNameLower)) return false;
    } else if (bCode === 'barents_white') {
      if (lat < 63.5 || lon < 44.0) return false;
    }
  }

  if (fid === 'peled') {
    if (bCode === 'arctic_ob_taz') {
      if (lat < 59.2 && waterType !== 'tundra_lake' && waterType !== 'quarry') return false;
      if (/молод[её]жн|безымянн/i.test(wNameLower)) return false;
    } else if (bCode === 'volga_caspian') {
      if (waterType !== 'quarry' && waterType !== 'tundra_lake') return false;
      if (lat < 53.5) return false;
    } else if (bCode === 'barents_white') {
      if (lon < 42.0) return false;
    } else if (bCode === 'nw_karelia') {
      return false; // В диких озёрах Карелии и Ладоге/Онеге пелядь не является массовым видом
    }
  }

  if (fid === 'muksun') {
    if (lat < 60.2) return false;
    if (waterType !== 'big_river' && waterType !== 'sea_gulf' && !hasBigRiverInRadius) return false;
  }

  if (fid === 'nelma') {
    if (bCode === 'arctic_ob_taz' && lat < 57.5) return false;
    const isKubenskoyeLake = bCode === 'barents_white' && /кубенск/i.test(wNameLower);
    if (bCode === 'barents_white' && !isKubenskoyeLake && (lat < 61.0 || lon < 40.0)) return false;
    if (!isKubenskoyeLake && waterType !== 'big_river' && waterType !== 'sea_gulf' && !hasBigRiverInRadius) return false;
  }

  if (fid === 'cisco') {
    if (lat < 61.2) return false;
    if (bCode === 'barents_white' && lon < 47.0) return false;
    if (bCode === 'arctic_ob_taz' && waterType !== 'big_river' && waterType !== 'sea_gulf' && !hasBigRiverInRadius) return false;
  }

  if (fid === 'omul_arctic') {
    if (lat < 65.5) return false;
    if (bCode === 'barents_white' && lon < 42.0) return false; // На Кольском п-ове арктического омуля нет
    if (!hasSeaInRadius && waterType !== 'big_river') return false;
  }

  if (fid === 'saffron_cod') {
    if (lat < 66.5 || !hasSeaInRadius) return false;
  }

  if (fid === 'navaga') {
    if (bCode === 'arctic_ob_taz' && (lat < 66.2 || !hasSeaInRadius)) return false;
    if (bCode === 'barents_white' && !hasSeaInRadius) return false;
  }

  if (fid === 'tugun') {
    if (bCode === 'arctic_ob_taz') {
      // Тугун (сосьвинская сельдь / манерка) обитает в Северной Сосьве/Ляпине (lon <= 66.5), Оби, Томи и верховьях Таза (lon >= 80.0), но НЕ в реках Нового Уренгоя (Ево-Яха, Седе-Яха, Пур)
      const isSosvaUral = lat >= 59.0 && lon <= 66.5;
      const isUpperTazOrTom = lon >= 80.0;
      if (!isSosvaUral && !isUpperTazOrTom) return false;
    } else if (bCode === 'yenisei_lena') {
      if (lat < 55.0) return false;
    } else {
      return false;
    }
  }

  if (fid === 'valek') {
    if (bCode === 'arctic_ob_taz') {
      if (lat < 65.5 || lon > 68.5) return false;
    } else if (bCode === 'yenisei_lena') {
      if (lat < 56.0 || lon < 88.0) return false;
    } else if (bCode === 'pacific_sea') {
      if (lat < 58.0) return false;
    } else {
      return false;
    }
  }

  if (fid === 'broad_whitefish') {
    if (bCode !== 'nw_karelia' && !(bCode === 'baltic' && lat >= 59.5 && lon >= 28.0)) return false;
    if (lat < 59.8) return false; // Нет в оз. Ильмень
    if (waterType !== 'quarry' && waterType !== 'sea_gulf' && waterType !== 'big_river' && !hasDeepQuarryInRadius) return false;
  }

  if (fid === 'vendace' || fid === 'whitefish') {
    if (bCode === 'arctic_ob_taz') {
      const isUralDeepLakeZone = lat >= 54.5 && lat <= 57.8 && lon >= 59.5 && lon <= 62.0;
      const isPolarUral = fid === 'whitefish' && lat >= 65.5 && lon <= 68.5;
      if (!isPolarUral) {
        if (!isUralDeepLakeZone) return false;
        if (waterType !== 'quarry' && !(radiusKm >= 120 && hasDeepQuarryInRadius)) return false;
      }
    } else if (bCode === 'volga_caspian') {
      const isUpperVolgaLake = lat >= 56.5 && lon <= 40.5;
      const isSouthUralLake = lat >= 53.2 && lat <= 56.0 && lon >= 58.0 && lon <= 61.5;
      if (!isUpperVolgaLake && !isSouthUralLake) return false;
      if (waterType !== 'quarry' && !(radiusKm >= 120 && hasDeepQuarryInRadius)) return false;
    }
  }

  if (fid === 'grayling' || fid === 'taimen') {
    if (waterType === 'tundra_lake') return false;
    if (bCode === 'arctic_ob_taz') {
      // В ЯНАО и ХМАО хариус и таймень обитают ТОЛЬКО в горно-предгорных притоках Полярного/Приполярного Урала (lon <= 67.8) и восточных притоках Верхнего Таза (Ратта, Худосей: lon >= 80.5), но НЕ в равнинных торфяных реках Нового Уренгоя, Надыма, Пура, Сургута!
      const isUralSlope = lon <= 61.5 || (lat >= 59.0 && lon <= 67.8);
      const isEastTazOrAltaiTom = lon >= 80.5;
      if (!isUralSlope && !isEastTazOrAltaiTom) return false;
    } else if (bCode === 'volga_caspian') {
      if (waterType === 'quarry' && !/павловск|нугуш|юмагузин|широковск/i.test(wNameLower)) return false;
      if (/бирь|дёма|дема|быстрый танып|чермасан|ашкадар|сюнь|база|шамсутдин|аслыкуль|кандрыкуль/i.test(wNameLower)) return false;
      const isKamaBashkirUral = (lon >= 56.1 && lat >= 52.2) || (lat >= 57.5 && lon >= 55.5);
      const isUpperVolgaStream = fid === 'grayling' && lat >= 56.5 && lon <= 37.5 && waterType === 'small_river';
      if (!isKamaBashkirUral && !isUpperVolgaStream) return false;
    }
  }

  if (fid === 'lenok') {
    if (lon < 83.5) return false;
  }

  if (fid === 'brown_trout') {
    if (bCode === 'volga_caspian') {
      const isBashkirUralStream = lon >= 56.0 && lon <= 60.0 && lat >= 52.8 && lat <= 56.5;
      const isCaucasusTerek = lat <= 44.5;
      if (!isBashkirUralStream && !isCaucasusTerek) return false;
    } else if (bCode === 'black_azov') {
      if (lat > 45.2 && lon > 38.0) return false;
    } else if (bCode === 'arctic_ob_taz') {
      if (lon > 61.5 || lat > 58.0) return false;
    }
  }

  if (fid === 'sterlet') {
    if (waterType !== 'big_river' && !(radiusKm >= 120 && hasBigRiverInRadius)) return false;
    // По Красной книге ЯНАО и ГосНИОРХ стерлядь обитает только в Оби и Иртыше (lon <= 70.5), а в бассейнах Надыма, Пура и Таза полностью отсутствует!
    if (bCode === 'arctic_ob_taz' && (lat >= 66.8 || lon > 70.5)) return false;
    if (bCode === 'yenisei_lena' && lon >= 98.0) return false;
    if (bCode === 'barents_white' && (lon < 39.0 || lon > 54.0 || lat > 65.0)) return false;
  }

  if (fid === 'siberian_sturgeon') {
    if (bCode === 'arctic_ob_taz' && lat < 57.8) return false;
    if (waterType !== 'big_river' && waterType !== 'sea_gulf' && bCode !== 'baikal' && !(radiusKm >= 120 && hasBigRiverInRadius)) return false;
  }

  if (['vobla', 'kutum', 'white_salmon'].includes(fid)) {
    if (lat > 49.0 || lon < 43.5) return false;
  }

  if (['beluga', 'stellate_sturgeon', 'shemaya'].includes(fid)) {
    if (bCode === 'volga_caspian' && lat > 51.0) return false;
  }

  if (fid === 'russian_sturgeon') {
    if (lat > 51.5) return false;
    if (waterType !== 'big_river' && waterType !== 'sea_gulf' && !(radiusKm >= 120 && hasBigRiverInRadius)) return false;
  }

  if (fid === 'barbel') {
    if (lat > 53.5) return false;
  }

  if (fid === 'zander') {
    if (bCode === 'arctic_ob_taz') {
      if (lat > 62.5) return false;
      if (waterType === 'small_river' && radiusKm < 120 && !hasBigRiverInRadius && !hasDeepQuarryInRadius) return false;
    } else if (bCode === 'yenisei_lena') {
      if (lat > 56.5 || lon > 94.0) return false;
    } else if (bCode === 'nw_karelia') {
      if (lat > 64.5) return false; // В Пяозере и Топозере судака нет
    } else if (bCode === 'barents_white') {
      if (lat > 64.8 || lon < 38.5 || lon > 54.0) return false; // Только Сев. Двина, Вычегда, Онега, Лача, Кенозеро, Кубенское
    }
  }

  if (fid === 'bream') {
    if (bCode === 'arctic_ob_taz') {
      if (lat > 63.0 && !(waterType === 'big_river' && lon <= 70.0)) return false;
    } else if (bCode === 'yenisei_lena') {
      if (lat > 59.0 || lon > 104.5) return false;
    } else if (bCode === 'barents_white') {
      if (lat > 65.2 || lon < 38.5 || lon > 56.0) return false;
    }
  }

  if (fid === 'catfish') {
    if (bCode === 'nw_karelia' && lat > 60.2) return false; // Только р. Волхов, оз. Ильмень, Ловать, Шелонь
  }

  if (fid === 'volga_zander') {
    if (bCode === 'baltic' || bCode === 'nw_karelia' || bCode === 'euro_west') return false;
  }

  if (fid === 'carp' || fid === 'tench') {
    if (bCode === 'arctic_ob_taz' || bCode === 'yenisei_lena') {
      if (lat > 59.2 && waterType !== 'cooling_reservoir' && !effCooling) return false;
    }
    if (bCode === 'nw_karelia' && lat > 61.8) return false;
  }

  if (['white_bream', 'rudd', 'bleak'].includes(fid)) {
    if (bCode === 'arctic_ob_taz') {
      if (lat > 58.6 || lon > 84.5) return false;
    }
    if (bCode === 'nw_karelia' && lat > 63.0) return false;
  }

  if (fid === 'chub' || fid === 'asp') {
    if (bCode === 'arctic_ob_taz') {
      if (lon > 62.2 || lat > 58.2) return false;
    }
    if (bCode === 'nw_karelia' && lat > 62.0) return false;
  }

  return true;
}

/**
 * 4-уровневый детерминированный алгоритм ранжирования видов рыб:
 * [1. Настройки рыбака (userProfile.targetSpecies, priorityGroup = 3)] ->
 * [2. Избранное (state.favorites, priorityGroup = 2)] ->
 * [3. Топ региона / локации (priorityGroup = 1)]
 * Все уровни работают строго внутри пула видов localAllowedItems, физически обитающих в данном водоёме/локации.
 */
export function rankSpeciesWithUserPriority(scoredItems, targetSpeciesIds = [], favoriteSpeciesIds = []) {
  if (!Array.isArray(scoredItems) || scoredItems.length === 0) return [];
  const targetSet = new Set(Array.isArray(targetSpeciesIds) ? targetSpeciesIds : []);
  const favSet = new Set(Array.isArray(favoriteSpeciesIds) ? favoriteSpeciesIds : []);

  const enriched = scoredItems
    .filter(item => item && typeof item === 'object' && ((item.fish && item.fish.id) || item.id))
    .map(item => {
      const f = item.fish || item;
      const fid = String(f?.id || '');
      const isTarget = targetSet.has(fid);
      const isFav = favSet.has(fid);
      const priorityGroup = isTarget ? 3 : (isFav ? 2 : 1);
      const rankVal = Number.isFinite(item.rankSc)
        ? item.rankSc
        : (Number.isFinite(item.rankScore)
            ? item.rankScore
            : (Number.isFinite(item.rank)
                ? item.rank
                : (Number.isFinite(item.score)
                    ? item.score
                    : (Number.isFinite(item.scDay) ? item.scDay : 50))));
      return {
        ...item,
        priorityGroup,
        isUserTarget: isTarget,
        isUserFavorite: isFav,
        _rankVal: rankVal
      };
    });

  enriched.sort((a, b) => {
    if (b.priorityGroup !== a.priorityGroup) return b.priorityGroup - a.priorityGroup;
    return b._rankVal - a._rankVal;
  });

  return enriched;
}
