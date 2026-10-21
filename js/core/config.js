export const APP_VERSION = '2.0.0';
export const STATE_CACHE_KEY = 'klev_pro_state_v2.0';
export const WEATHER_CACHE_KEY = 'klev_pro_weather_v2.0';
export const WEATHER_TTL_MS = 2 * 60 * 60 * 1000;

export const IMG_SEARCH_DIRS = ['assets/fish/', 'fish/', ''];

export const MAP_LAYERS = {
  topo: { name: 'Топо', url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', attr: '© OpenTopoMap' },
  sat: { name: 'Спутник', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attr: '© Esri' },
  carto: { name: 'Схема', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attr: '© OpenStreetMap' },
  osm: { name: 'OSM', url: 'https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png', attr: '© OSM France' }
};

export const SEASONAL_BAITS = {
  peace_cold: [
    'Мотыль крупный (уральский насадочный / пучок)',
    'Мормыш / Бокоплав живой (гаммарус)',
    'Опарыш белый / красный',
    'Бутерброд: мотыль + опарыш',
    'Ручейник (шитик) / Короед',
    'Червь навозный (кусочек)'
  ],
  peace_warm: [
    'Червь навозный / Дендробена',
    'Опарыш (пучок)',
    'Кукуруза консервированная сладкая',
    'Перловка распаренная с чесноком / жмыхом',
    'Тесто / Манная болтушка с анисом',
    'Хлебный мякиш / Корочка',
    'Горох пареный / Мастырка',
    'Прессованный планктон / Зелень (водоросли)'
  ],
  predator_lure: [
    'Силиконовый виброхвост / твистер (съедобная резина)',
    'Вращающаяся блесна (вертушка №1–№4)',
    'Колеблющаяся блесна (колебалка 10–28 г)',
    'Воблер минноу / крэнк с заглублением',
    'Поролоновая рыбка / Мандула',
    'Поверхностная лягушка / Мышь (ночной лов)',
    'Силиконовый рак / креатура'
  ],
  predator_natural: [
    'Живец (плотвичка, карасик, уклейка, пескарь)',
    'Ёрш живой (донная снасть на налима/судака)',
    'Нарезка свежей рыбы (филе белой рыбы/тюльки)',
    'Пучок крупных выползков / дождевых червей',
    'Морской червь (нереис / пескожил)',
    'Креветка свежая / Мясо мидии или кальмара'
  ],
  winter_all: [
    'Мормышка вольфрамовая с мотылём',
    'Безнасадочная мормышка (гвоздешарик / чёртик)',
    'Балансир 40–70 мм (натурал / кислотник)',
    'Зимний раттлин (виб 50–75 мм)',
    'Зимняя вертикальная блесна с цепочкой',
    'Гирлянда мормышек на сига/корюшку (бокоплав)',
    'Жерлица с плотвичкой / карасиком',
    'Тяжёлая блесна-стукалка с тюлькой/ершом'
  ]
};

export function getSeasonalBaitsForContext(fish, method, waterTemp = 12, iceState = 'open_water') {
  if (iceState === 'ice_safe' || (method && method.startsWith('winter_'))) {
    if (method === 'winter_livebait') {
      return [
        'Живец: плотвичка',
        'Живец: карасик',
        'Живец: окунёк',
        'Живец: ёрш обыкновенный'
      ];
    }
    if (method === 'winter_stuka') {
      return [
        'Тяжёлая блесна-стукалка с кусочком ерша/тюльки',
        'Нарезка свежей белой рыбы',
        'Пучок крупных червей на стукалке'
      ];
    }
    if (method === 'winter_cisco') {
      return [
        'Гирлянда фосфорных микромормышек',
        'Подвеска с бокоплавом (гаммарусом)',
        'Кембрики и бисер светонакопительный'
      ];
    }
    if (method === 'winter_lure') {
      return [
        'Балансир 40–70 мм (натурал / кислотник)',
        'Зимний раттлин (виб 50–75 мм)',
        'Вертикальная блесна с одинарником на цепочке',
        'Донная блесна-лодочка с подсадкой'
      ];
    }
    return [
      'Мотыль крупный свежий (пучок)',
      'Мормыш (гаммарус / бормаш) живой',
      'Безнасадка: гвоздешарик / гвоздекубик',
      'Безнасадка: чёртик вольфрамовый',
      'Опарыш белый / личинка репейника'
    ];
  }

  const isPred = fish && fish.type === 'predator';
  if (method === 'spin_jig') {
    return isPred ? [
      'Силиконовый виброхвост 7–12 см',
      'Твистер съедобный 5–9 см',
      'Поролоновая рыбка на двойнике',
      'Мандула на судака/щуку',
      'Силиконовый рак / слаг'
    ] : [
      'Микросиликон съедобный 1–2 дюйма',
      'Силиконовый мотыль Berkley',
      'Микротвистер'
    ];
  }

  if (method === 'spin_micro') {
    return [
      'Мормышка с искусственным мотылем Berkley',
      'Микросиликон 1–1.5 дюйма (Polaris, Whitebait)',
      'Микроколебалка 1–2.5 г',
      'Вращающаяся блесна №00–№0',
      'Микровоблер 25–35 мм'
    ];
  }

  if (method === 'spin_lure') {
    return [
      'Колеблющаяся блесна (колебалка 10–25 г)',
      'Вращающаяся блесна (вертушка №2–№4)',
      'Воблер минноу (твичинг 70–110 мм)',
      'Воблер крэнк / шед с заглублением',
      'Поверхностный волкер / поппер'
    ];
  }

  if (method === 'bottom') {
    if (isPred) {
      return [
        'Живец (карасик, плотвичка, пескарь)',
        'Пучок крупных выползков / червей',
        'Нарезка свежей рыбы (филе)',
        'Кусочки мяса ракушки / мидии'
      ];
    }
    if (waterTemp <= 11) {
      return [
        'Мотыль крупный (пучок на клипсе)',
        'Опарыш белый / красный',
        'Бутерброд: мотыль + опарыш',
        'Червь навозный',
        'Ручейник (шитик)'
      ];
    }
    return [
      'Кукуруза сладкая консервированная',
      'Опарыш (пучок на крючке)',
      'Перловка распаренная с чесноком',
      'Червь навозный / Дендробена',
      'Пареный горох / Мастырка',
      'Тонущие пеллетсы / бойлы'
    ];
  }

  if (method === 'float') {
    if (waterTemp <= 11) {
      return [
        'Мотыль насадочный (2–3 шт.)',
        'Опарыш белый',
        'Кусочек червя',
        'Ручейник (шитик)'
      ];
    }
    return [
      'Манная болтушка с анисом',
      'Хлебный мякиш / корочка',
      'Кукуруза сладкая',
      'Перловка',
      'Опарыш',
      'Червь навозный'
    ];
  }

  if (method === 'fly') {
    return [
      'Сухая мушка (Mayfly / Caddis)',
      'Мокрая мушка / Стример',
      'Тяжёлая нимфа с вольфрамовой головкой',
      'Искусственная мышь (ночной лов)',
      'Мушка-жук / имитация стрекозы'
    ];
  }

  if (method === 'sea_rock') {
    return [
      'Съедобный силикон (Marukyu / Power Isome)',
      'Силиконовые рачки и креветки',
      'Светонакопительный слаг 1.5–2 дюйма',
      'Мясо мидии / морской червь'
    ];
  }

  if (method === 'sea_surf') {
    return [
      'Морской червь (нереис / пескожил)',
      'Мясо свежей хамсы / ставридки',
      'Очищенная креветка',
      'Филе кальмара'
    ];
  }

  if (method === 'sea_boat') {
    return [
      'Пилькер 40–120 г',
      'Ставка-самодур с перьями/люрексом',
      'Крупный виброхвост с джиг-головкой 100–300 г',
      'Нарезка сайды / сельди'
    ];
  }

  if (isPred) {
    return [...SEASONAL_BAITS.predator_lure, ...SEASONAL_BAITS.predator_natural];
  }
  return waterTemp <= 11 ? SEASONAL_BAITS.peace_cold : SEASONAL_BAITS.peace_warm;
}

export function getCompatibleMethods(fish, iceState = 'open_water', waterType = 'small_river') {
  const isSea = waterType === 'sea_gulf' || waterType === 'open_sea';
  if (iceState === 'ice_safe') {
    if (fish && fish.type === 'predator') {
      if (['burbot', 'cod', 'halibut', 'navaga', 'wolffish'].includes(fish.id)) {
        return [
          { val: 'winter_stuka', text: 'Тяжёлая стукалка со дна (налим, треска)' },
          { val: 'winter_livebait', text: 'Жерлицы / Подлёдные поставуши на живца' },
          { val: 'winter_lure', text: 'Зимнее блеснение: Балансир / Раттлин' },
          { val: 'winter_jig', text: 'Зимняя мормышка с мотылём' }
        ];
      }
      return [
        { val: 'winter_lure', text: 'Зимнее блеснение: Балансир / Раттлин / Блесна' },
        { val: 'winter_livebait', text: 'Жерлицы / Подлёдные поставуши на живца' },
        { val: 'winter_jig', text: 'Зимняя мормышка с мотылём / бокоплавом' }
      ];
    }
    if (['chir', 'pizhyan', 'peled', 'cisco', 'whitefish', 'smelt', 'vendace', 'omul', 'omul_arctic'].includes(fish?.id)) {
      return [
        { val: 'winter_cisco', text: 'Гирлянда мормышек (сиговые, корюшка)' },
        { val: 'winter_jig', text: 'Зимняя мормышка / Безмотылка (мотыль, бокоплав)' }
      ];
    }
    return [
      { val: 'winter_jig', text: 'Зимняя мормышка / Безмотылка (мотыль, бокоплав)' },
      { val: 'winter_cisco', text: 'Гирлянда мормышек (подлёдная)' }
    ];
  }

  // Open water
  const list = [];
  const isPred = fish && fish.type === 'predator';

  if (isSea) {
    if (isPred) {
      list.push({ val: 'sea_rock', text: 'Морская прибрежная ловля (рокфишинг, отводной)' });
      list.push({ val: 'sea_surf', text: 'Береговая морская донка (серфкастинг)' });
      list.push({ val: 'sea_boat', text: 'Морской отвесный лов с лодки / катера' });
      list.push({ val: 'spin_lure', text: 'Спиннинг: Пилькеры и морские блёсны' });
    } else {
      list.push({ val: 'sea_surf', text: 'Береговая морская донка (на нереиса)' });
      list.push({ val: 'sea_rock', text: 'Морская прибрежная ловля (легкий рокфиш)' });
      list.push({ val: 'float', text: 'Поплавочная удочка (с бомбардой / пенопластом)' });
    }
    return list;
  }

  if (isPred) {
    if (['pike', 'zander', 'volga_zander', 'catfish', 'amur_catfish'].includes(fish.id)) {
      list.push({ val: 'spin_jig', text: 'Спиннинг джиговый: Средний и тяжёлый (8–45 г)' });
      list.push({ val: 'spin_lure', text: 'Спиннинг: Блёсны и воблеры (колебалки, вертушки)' });
      list.push({ val: 'bottom', text: 'Донная снасть на живца / резку рыбы' });
      list.push({ val: 'spin_micro', text: 'Спиннинг лёгкий: Микроджиг (до 7 г)' });
    } else if (['perch', 'rotan'].includes(fish.id)) {
      list.push({ val: 'spin_micro', text: 'Спиннинг лёгкий: Микроджиг / Мормышинг (0.5–5 г)' });
      list.push({ val: 'spin_lure', text: 'Спиннинг: Мелкие вертушки и воблеры' });
      list.push({ val: 'float', text: 'Поплавочная удочка с червем / мотылем' });
      list.push({ val: 'spin_jig', text: 'Спиннинг джиговый' });
    } else if (['trout', 'grayling', 'baikal_grayling', 'lenok', 'salmon'].includes(fish.id)) {
      list.push({ val: 'fly', text: 'Нахлыст / Ловля на мушку и сбирулино' });
      list.push({ val: 'spin_micro', text: 'Ультралайт спиннинг (микроколебалки, вертушки)' });
      list.push({ val: 'spin_lure', text: 'Спиннинг: Тонущие воблеры и блёсны' });
      list.push({ val: 'float', text: 'Поплавочная удочка в проводку' });
    } else if (['burbot'].includes(fish.id)) {
      list.push({ val: 'bottom', text: 'Донная снасть (закидушка с живцом/ершом)' });
      list.push({ val: 'spin_jig', text: 'Тяжёлый джиг со дна в темноте' });
    } else {
      list.push({ val: 'spin_lure', text: 'Спиннинг: Блёсны и воблеры' });
      list.push({ val: 'spin_jig', text: 'Спиннинг джиговый' });
      list.push({ val: 'spin_micro', text: 'Спиннинг лёгкий: Микроджиг' });
      list.push({ val: 'bottom', text: 'Донная снасть' });
      list.push({ val: 'fly', text: 'Нахлыст' });
    }
    return list;
  }

  // Peace fish (strictly characteristic tackles for each species group)
  if (['crayfish', 'crab', 'king_crab'].includes(fish?.id)) {
    list.push({ val: 'bottom', text: 'Донная снасть / Разрешённая раколовка с приманкой' });
    return list;
  }

  if (['silver_carp', 'grass_carp', 'paddlefish'].includes(fish?.id)) {
    list.push({ val: 'bottom', text: 'Донная карповая снасть / Технопланктон со дна' });
    list.push({ val: 'float', text: 'Поплавочная оснастка на толстолобика / амура' });
    return list;
  }

  if (['carp', 'crucian', 'bream', 'tench', 'buffalo', 'black_carp', 'parabramis', 'tarpon_carp', 'white_bream', 'blue_bream', 'sopa', 'vimba', 'vobla', 'taran', 'kutum', 'undermouth', 'barbel', 'sterlet', 'loach'].includes(fish?.id)) {
    list.push({ val: 'bottom', text: 'Донная снасть: Фидер / Пикер / Карповая кормушка' });
    list.push({ val: 'float', text: 'Поплавочная удочка: Маховая / Матчевая / Болонская' });
    return list;
  }

  if (['roach', 'rudd', 'bleak', 'dace', 'gudgeon', 'chekhon', 'ide'].includes(fish?.id)) {
    list.push({ val: 'float', text: 'Поплавочная удочка: Маховая / В проводку' });
    list.push({ val: 'bottom', text: 'Донная снасть: Пикер / Лёгкий фидер' });
    list.push({ val: 'spin_micro', text: 'Мормышинг (сверхлёгкая снасть с мормышкой)' });
    if (['chekhon', 'ide', 'dace', 'rudd', 'bleak'].includes(fish?.id)) {
      list.push({ val: 'fly', text: 'Нахлыст / Ловля на мушку и бомбарду' });
    }
    return list;
  }

  if (['chir', 'pizhyan', 'peled', 'cisco', 'tugun', 'whitefish', 'vendace', 'broad_whitefish', 'omul', 'omul_arctic', 'valek'].includes(fish?.id)) {
    list.push({ val: 'float', text: 'Поплавочная удочка в проводку / Сбирулино' });
    list.push({ val: 'bottom', text: 'Донная снасть / Фидер с животной насадкой' });
    list.push({ val: 'fly', text: 'Нахлыст (нимфа / мушка)' });
    return list;
  }

  list.push({ val: 'bottom', text: 'Донная снасть: Фидер / Пикер' });
  list.push({ val: 'float', text: 'Поплавочная удочка' });
  return list;
}

export const DEFAULT_STATE = {
  route: 'dashboard',
  hasUserLocation: false,
  lat: 55.7558,
  lon: 37.6173,
  locCountry: 'Россия',
  locAdmin1: 'Автоопределение',
  locAdmin2: '',
  locLabel: 'Определение геолокации...',
  basinCode: 'volga_caspian',
  basinName: 'Волжско-Каспийский бассейн (Волга, Кама, Урал)',
  isCoastal: false,
  water: 'small_river',
  selectedWaterName: '',
  method: 'spin_micro',
  selectedBait: '',
  depth: 1.5,
  fishId: '',
  dayIdx: 2, // 0=Позавчера, 1=Вчера, 2=Сегодня (активен Сегодня!)
  selectedHour: new Date().getHours(),
  showAllSpecies: false,
  onlyFavoritesFilter: false,
  fishSearch: '',
  fishGroup: 'all',
  favorites: ['pike', 'perch', 'crucian', 'bream', 'roach', 'zander'],
  pinnedDays: [],
  compareSpeciesIds: ['pike', 'perch', 'zander'],
  calendarMode: 'single',
  theme: 'auto',
  elevation: 120,
  normPress: 750,
  iceState: 'open_water',
  iceThickness: 0,
  weatherSource: 'fallback',
  weatherUpdatedAt: 0,
  weatherDays: [],
  nearbyWaters: [],
  nearbyPlaces: [],
  savedSpots: [],
  catches: [],
  userProfile: {
    onboarded: false,
    preferredWater: 'small_river',
    preferredMethod: 'spin_micro',
    targetSpecies: []
  }
};
