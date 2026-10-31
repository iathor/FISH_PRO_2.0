/* Klev PRO v2.5.3 r190 (Protected Build) */
export const APP_VERSION = '2.5.3';
export const APP_BUILD_NUMBER = 190;
export const APP_REVISION = 'r190';
export const APP_DISPLAY_VERSION = 'v2.5.3 r190';
export const STATE_CACHE_KEY = 'klev_pro_state_v2.0';
export const WEATHER_CACHE_KEY = 'klev_pro_weather_v2.0';
export const RELEASE_CACHE_KEY = 'klev_pro_release_v2.0';
export const WEATHER_TTL_MS = 2 * 60 * 60 * 1000;
export const CURRENT_RELEASE_INFO = {
  "version": "2.5.3",
  "versionCode": 253190,
  "buildNumber": 190,
  "revision": "r190",
  "displayVersion": "v2.5.3 r190",
  "date": "31 октября 2026",
  "releasedAt": "2026-10-31T16:00:00Z",
  "apkUrl": "https://klevpro.ru/apk/klev-pro-v2.5.3.apk",
  "fileSize": "38.4 МБ",
  "title": "Выпущена новая версия «Клёв ПРО 2.0» (v2.5.3 r190)",
  "subtitle": "Точная гидрологическая математика ледостава и зимних снастей, тематические точки на карте (Слип, Коряга, Стоянка) с масштабом < 1 км/см и кластеризацией, а также специализированный Карповый и Флэт-Фидерный модуль.",
  "summary": "В релизе v2.5.3 r190 модернизирована математическая модель Стефана-Зубова для расчёта толщины льда и автоматического переключения на зимние снасти (жерлицы, вибы/раттлины, балансиры, мормышки), во вкладку «Чаты и Круг» добавлен 3-й блок «Точка на карту (Слип • Коряга • Стоянка • Опасность)» с умной кластеризацией на карте при масштабе крупнее 1 км/см, а также внедрён модуль Карпфишинга, Сазана и Флэт-Фидера с программой бойлов/ПВА по температуре воды, дистанцией клипсы и таймером перезаброса.",
  "changes": [
    {
      "icon": "<svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M12 2.5l7 3.2v5.8c0 5-3 9.3-7 10.8-4-1.5-7-5.8-7-10.8V5.7l7-3.2z\" fill=\"rgba(56,189,248,0.22)\" stroke=\"#38bdf8\" stroke-width=\"1.8\" stroke-linejoin=\"round\"/></svg>",
      "title": "Работа БД и Топо-карт без VPN и с любыми бесплатными VPN (r190)",
      "text": "Внедрён многоканальный сетевой транспорт с автообходом блокировок ТСПУ и кривых прокси для 100% сохранения данных в БД, а топо-карта переведена на быстрый сервер рельефа, работающий без VPN по всей России."
    },
    {
      "icon": "<svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M20 11a8 8 0 0 0-14.5-4.5L4 8m0-5v5h5M4 13a8 8 0 0 0 14.5 4.5L20 16m0 5v-5h-5\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>",
      "title": "Точное автообновление APK по номеру ревизии (v2.5.3 r190)",
      "text": "Теперь приложение проверяет не только основной номер версии (2.5.0), но и внутренний счётчик сборки (r190), мгновенно оповещая о выходе любых исправлений."
    },
    {
      "icon": "<svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><circle cx=\"12\" cy=\"12\" r=\"8.5\" stroke=\"currentColor\" stroke-width=\"1.8\"/><circle cx=\"12\" cy=\"12\" r=\"4.5\" stroke=\"#38bdf8\" stroke-width=\"1.6\"/><circle cx=\"12\" cy=\"12\" r=\"1.8\" fill=\"#10b981\"/></svg>",
      "title": "Свайп рыбы, восход/закат, Kp-индекс и тактика по снастям",
      "text": "Меняйте рыбу свайпом влево/вправо прямо по главной карточке прогноза, смотрите восход, закат и геомагнитный Kp-индекс на графике клёва, а также тактику прикормки (фидер), паузы ступеньки (спиннинг) и безопасности льда."
    },
    {
      "icon": "<svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><rect x=\"5\" y=\"3\" width=\"14\" height=\"18\" rx=\"2.5\" fill=\"rgba(56,189,248,0.16)\" stroke=\"currentColor\" stroke-width=\"1.8\"/><path d=\"M9 7h6M9 11h6M9 15h4\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\"/></svg>",
      "title": "Холостой выезд (0 поклёвок), Личная аналитика, 5 типов точек и Региональные чаты",
      "text": "В Журнале добавлены учёт холостых выездов и карточка личной аналитики (лучшее давление, вода и Топ-3 приманок), на Карте — 5 цветовых типов точек (Клёв, Слип, Стоянка, Опасность, Магазин), а в Чатах — общие региональные чаты РФ."
    }
  ],
  "items": [
    {
      "icon": "<svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M12 2.5l7 3.2v5.8c0 5-3 9.3-7 10.8-4-1.5-7-5.8-7-10.8V5.7l7-3.2z\" fill=\"rgba(56,189,248,0.22)\" stroke=\"#38bdf8\" stroke-width=\"1.8\" stroke-linejoin=\"round\"/></svg>",
      "title": "Работа БД и Топо-карт без VPN и с любыми бесплатными VPN (r190)",
      "text": "Внедрён многоканальный сетевой транспорт с автообходом блокировок ТСПУ и кривых прокси для 100% сохранения данных в БД, а топо-карта переведена на быстрый сервер рельефа, работающий без VPN по всей России."
    },
    {
      "icon": "<svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M20 11a8 8 0 0 0-14.5-4.5L4 8m0-5v5h5M4 13a8 8 0 0 0 14.5 4.5L20 16m0 5v-5h-5\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>",
      "title": "Точное автообновление APK по номеру ревизии (v2.5.3 r190)",
      "text": "Теперь приложение проверяет не только основной номер версии (2.5.0), но и внутренний счётчик сборки (r190), мгновенно оповещая о выходе любых исправлений."
    },
    {
      "icon": "<svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><circle cx=\"12\" cy=\"12\" r=\"8.5\" stroke=\"currentColor\" stroke-width=\"1.8\"/><circle cx=\"12\" cy=\"12\" r=\"4.5\" stroke=\"#38bdf8\" stroke-width=\"1.6\"/><circle cx=\"12\" cy=\"12\" r=\"1.8\" fill=\"#10b981\"/></svg>",
      "title": "Свайп рыбы, восход/закат, Kp-индекс и тактика по снастям",
      "text": "Меняйте рыбу свайпом влево/вправо прямо по главной карточке прогноза, смотрите восход, закат и геомагнитный Kp-индекс на графике клёва, а также тактику прикормки (фидер), паузы ступеньки (спиннинг) и безопасности льда."
    },
    {
      "icon": "<svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><rect x=\"5\" y=\"3\" width=\"14\" height=\"18\" rx=\"2.5\" fill=\"rgba(56,189,248,0.16)\" stroke=\"currentColor\" stroke-width=\"1.8\"/><path d=\"M9 7h6M9 11h6M9 15h4\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\"/></svg>",
      "title": "Холостой выезд (0 поклёвок), Личная аналитика, 5 типов точек и Региональные чаты",
      "text": "В Журнале добавлены учёт холостых выездов и карточка личной аналитики (лучшее давление, вода и Топ-3 приманок), на Карте — 5 цветовых типов точек (Клёв, Слип, Стоянка, Опасность, Магазин), а в Чатах — общие региональные чаты РФ."
    }
  ]
};
export const IMG_SEARCH_DIRS = ['assets/fish/', 'fish/', 'https://klevpro.ru/assets/fish/', 'https://klevpro.ru/fish/'];
export const MAP_LAYERS = {
  yandex_map: {
    name: 'Яндекс Схема',
    isYandex: true,
    url: 'https://core-renderer-tiles.maps.yandex.net/tiles?l=map&v=24.10.30-0&x={x}&y={y}&z={z}&scale=2&lang=ru_RU',
    fallbacks: [
      'https://vec01.maps.yandex.net/tiles?l=map&x={x}&y={y}&z={z}&scale=2&lang=ru_RU',
      'https://vec02.maps.yandex.net/tiles?l=map&x={x}&y={y}&z={z}&scale=2&lang=ru_RU',
      'https://vec03.maps.yandex.net/tiles?l=map&x={x}&y={y}&z={z}&scale=2&lang=ru_RU'
    ],
    attr: '© Яндекс Карты'
  },
  yandex_sat: {
    name: 'Яндекс Спутник',
    isYandex: true,
    subdomains: ['1', '2', '3', '4'],
    url: 'https://sat0{s}.maps.yandex.net/tiles?l=sat&x={x}&y={y}&z={z}&lang=ru_RU',
    fallbacks: [
      'https://core-sat.maps.yandex.net/tiles?l=sat&x={x}&y={y}&z={z}&lang=ru_RU',
      'https://sat01.maps.yandex.net/tiles?l=sat&x={x}&y={y}&z={z}&lang=ru_RU',
      'https://sat02.maps.yandex.net/tiles?l=sat&x={x}&y={y}&z={z}&lang=ru_RU'
    ],
    attr: '© Яндекс Спутник'
  },
  yandex_hybrid: {
    name: 'Яндекс Гибрид',
    isYandex: true,
    hasLabelsOverlay: true,
    subdomains: ['1', '2', '3', '4'],
    url: 'https://sat0{s}.maps.yandex.net/tiles?l=sat&x={x}&y={y}&z={z}&lang=ru_RU',
    overlayUrl: 'https://core-renderer-tiles.maps.yandex.net/tiles?l=skl&v=24.10.30-0&x={x}&y={y}&z={z}&scale=2&lang=ru_RU',
    fallbacks: [
      'https://core-sat.maps.yandex.net/tiles?l=sat&x={x}&y={y}&z={z}&lang=ru_RU',
      'https://sat01.maps.yandex.net/tiles?l=sat&x={x}&y={y}&z={z}&lang=ru_RU'
    ],
    attr: '© Яндекс Гибрид'
  },
  yandex_dark: {
    name: 'Яндекс Ночь',
    isYandex: true,
    url: 'https://core-renderer-tiles.maps.yandex.net/tiles?l=map&v=24.10.30-0&x={x}&y={y}&z={z}&scale=2&lang=ru_RU&theme=dark',
    fallbacks: [
      'https://core-renderer-tiles.maps.yandex.net/tiles?l=map&x={x}&y={y}&z={z}&scale=2&lang=ru_RU&theme=dark',
      'https://vec01.maps.yandex.net/tiles?l=map&x={x}&y={y}&z={z}&scale=2&lang=ru_RU'
    ],
    attr: '© Яндекс Карты (Ночной радар)'
  }
};
export const SPOT_CATEGORIES = {
  slip: {
    id: 'slip',
    short: 'Слип',
    color: '#38bdf8',
    icon: '<svg class="k-ico" style="color:#38bdf8;" viewBox="0 0 24 24" fill="none"><path d="M3 17l18-5v7H3v-2z" fill="rgba(56,189,248,0.25)" stroke="#38bdf8" stroke-width="1.8" stroke-linejoin="round"/><path d="M6 12l9-3 3 3-12 2v-2z" fill="#38bdf8"/></svg>',
    label: '<svg class="k-ico" style="color:#38bdf8;" viewBox="0 0 24 24" fill="none"><path d="M3 17l18-5v7H3v-2z" fill="rgba(56,189,248,0.25)" stroke="#38bdf8" stroke-width="1.8" stroke-linejoin="round"/><path d="M6 12l9-3 3 3-12 2v-2z" fill="#38bdf8"/></svg> Слип / Спуск лодки'
  },
  snag: {
    id: 'snag',
    short: 'Коряга',
    color: '#d97706',
    icon: '<svg class="k-ico" style="color:#d97706;" viewBox="0 0 24 24" fill="none"><path d="M12 20V8m0 4l-5-4m5 6l5-5M7 20h10" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    label: '<svg class="k-ico" style="color:#d97706;" viewBox="0 0 24 24" fill="none"><path d="M12 20V8m0 4l-5-4m5 6l5-5M7 20h10" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Коряга / Бровка / Зацеп'
  },
  camp: {
    id: 'camp',
    short: 'Стоянка',
    color: '#10b981',
    icon: '<svg class="k-ico" style="color:#10b981;" viewBox="0 0 24 24" fill="none"><path d="M12 4L3 19h18L12 4z" fill="rgba(16,185,129,0.24)" stroke="#10b981" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 12l-3 7h6l-3-7z" fill="#10b981"/></svg>',
    label: '<svg class="k-ico" style="color:#10b981;" viewBox="0 0 24 24" fill="none"><path d="M12 4L3 19h18L12 4z" fill="rgba(16,185,129,0.24)" stroke="#10b981" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 12l-3 7h6l-3-7z" fill="#10b981"/></svg> Стоянка / Подъезд / Лагерь'
  },
  hazard: {
    id: 'hazard',
    short: 'Опасно',
    color: '#ef4444',
    icon: '<svg class="k-ico" style="color:#ef4444;" viewBox="0 0 24 24" fill="none"><path d="M12 3L2.5 19.5h19L12 3z" fill="rgba(239,68,68,0.24)" stroke="#ef4444" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 9v5M12 17h.01" stroke="#fca5a5" stroke-width="2" stroke-linecap="round"/></svg>',
    label: '<svg class="k-ico" style="color:#ef4444;" viewBox="0 0 24 24" fill="none"><path d="M12 3L2.5 19.5h19L12 3z" fill="rgba(239,68,68,0.24)" stroke="#ef4444" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 9v5M12 17h.01" stroke="#fca5a5" stroke-width="2" stroke-linecap="round"/></svg> Опасность / Промоина / Сеть'
  },
  bite: {
    id: 'bite',
    short: 'Яма / Клёв',
    color: '#06b6d4',
    icon: '<svg class="k-ico" style="color:#06b6d4;" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8" fill="rgba(6,182,212,0.22)" stroke="#06b6d4" stroke-width="1.8"/><circle cx="12" cy="12" r="3" fill="#06b6d4"/></svg>',
    label: '<svg class="k-ico" style="color:#06b6d4;" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8" fill="rgba(6,182,212,0.22)" stroke="#06b6d4" stroke-width="1.8"/><circle cx="12" cy="12" r="3" fill="#06b6d4"/></svg> Клёв / Рабочая яма / Свим'
  },
  shop: {
    id: 'shop',
    short: 'Магазин',
    color: '#a855f7',
    icon: '<svg class="k-ico" style="color:#a855f7;" viewBox="0 0 24 24" fill="none"><rect x="4" y="8" width="16" height="12" rx="2" fill="rgba(168,85,247,0.22)" stroke="#a855f7" stroke-width="1.8"/><path d="M8 8V6a4 4 0 0 1 8 0v2" stroke="#a855f7" stroke-width="1.8"/></svg>',
    label: '<svg class="k-ico" style="color:#a855f7;" viewBox="0 0 24 24" fill="none"><rect x="4" y="8" width="16" height="12" rx="2" fill="rgba(168,85,247,0.22)" stroke="#a855f7" stroke-width="1.8"/><path d="M8 8V6a4 4 0 0 1 8 0v2" stroke="#a855f7" stroke-width="1.8"/></svg> Магазин снастей / База'
  }
};
export const SEASONAL_BAITS = {
  peace_cold: [
    'Мотыль крупный (уральский насадочный / пучок)',
    'Мормыш / Бокоплав живой (гаммарус)',
    'Опарыш белый / красный (пинка)',
    'Бутерброд: мотыль + опарыш',
    'Ручейник (шитик) / Короед',
    'Червь навозный (небольшой кусочек)'
  ],
  peace_warm: [
    'Червь навозный / Дендробена',
    'Опарыш (пучок 3–5 шт.)',
    'Кукуруза консервированная сладкая',
    'Перловка распаренная с чесноком / жмыхом',
    'Тесто / Манная болтушка с анисом',
    'Хлебный мякиш / Корочка',
    'Горох пареный / Мастырка',
    'Прессованный планктон / Зелень (нитчатые водоросли)'
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
    'Гирлянда мормышек на сига/корюшку/сырка (бокоплав)',
    'Жерлица с плотвичкой / карасиком',
    'Тяжёлая блесна-стукалка с тюлькой/ершом'
  ]
};
export function getSeasonalBaitsForContext(fish, method, waterTemp = 12, iceState = 'open_water') {
  const fid = fish?.id || '';
  const isCold = waterTemp <= 10.5;
  const isPred = fish && fish.type === 'predator';
  if (iceState === 'ice_safe' || (method && method.startsWith('winter_'))) {
    if (method === 'winter_livebait') {
      if (['zander', 'volga_zander', 'burbot'].includes(fid)) {
        return [
          'Живец придонный: пескарь / уклейка / тюлька',
          'Живец: ёрш обыкновенный (на налима и судака)',
          'Живец: мелкая плотвичка (сорожка)',
          'Свежая нарезка тюльки / белой рыбы'
        ];
      }
      return [
        'Живец: плотвичка (сорожка)',
        'Живец: карасик мелкий',
        'Живец: окунёк матросик',
        'Живец: пескарь / ёрш'
      ];
    }
    if (method === 'winter_stuka') {
      return [
        'Тяжёлая блесна-стукалка с подсадкой ерша / тюльки',
        'Джиг-головка светонакопительная с нарезкой рыбы',
        'Пучок червей / куриная печень на стукалке'
      ];
    }
    if (method === 'winter_cisco') {
      if (['smelt', 'herring', 'navaga', 'saffron_cod'].includes(fid)) {
        return [
          'Гирлянда фосфорных мормышек с кусочком корюшки / креветки',
          'Ставка-самодур с мобискином и морским червём',
          'Блесна-иголка с подсадкой мяса рыбы'
        ];
      }
      return [
        'Гирлянда фосфорных микромормышек с бокоплавом (гаммарусом)',
        'Подвеска с мотылём и светонакопительным бисером (на сырка/сига)',
        'Кембрики под бормаша / нимфа'
      ];
    }
    if (method === 'winter_lure') {
      if (['zander', 'volga_zander'].includes(fid)) {
        return [
          'Зимний раттлин (виб 65–85 мм) с подсадкой тюльки',
          'Судаковая вертикальная блесна-трубочка',
          'Балансир 60–75 мм (натурал / светонакопитель)'
        ];
      }
      if (['perch', 'rotan', 'grayling', 'trout', 'lenok', 'peled', 'pizhyan', 'whitefish'].includes(fid)) {
        return [
          'Балансир 35–50 мм (окунёвый / натурал / кислотник)',
          'Зимняя вертикальная блесна с подвесным тройником-каплей',
          'Блесна с цепочкой и подсадкой мотыля / бокоплава'
        ];
      }
      return [
        'Зимний раттлин / Виб 65–85 мм (натурал / редхед / кислотник)',
        'Балансир 60–80 мм (щучий профиль)',
        'Широкая зимняя колебалка на щуку (Вильямс / Власовская)',
        'Донная блесна с подсадкой резки'
      ];
    }
    if (['bream', 'white_bream', 'blue_bream', 'sopa', 'carp', 'crucian'].includes(fid)) {
      return [
        'Пучок крупного уральского мотыля на мормышке / коромысле',
        'Бутерброд: мотыль + белый опарыш',
        'Чёртик / «коза» в тандеме (плавная проводка)',
        'Мормыш (живой бокоплав)'
      ];
    }
    return [
      'Мотыль крупный свежий (1–3 личинки на вольфраме)',
      'Безнасадка: гвоздешарик / гвоздекубик / кошачий глаз',
      'Безнасадка: вольфрамовый чёртик / уралка / муравей',
      'Мормыш (живой гаммарус / бормаш)',
      'Опарыш / личинка репейной моли'
    ];
  }
  if (method === 'spin_micro') {
    if (!isPred || ['dace', 'peled', 'chir', 'pizhyan', 'tugun', 'whitefish', 'cisco', 'vendace', 'valek', 'crucian', 'roach', 'rudd', 'bleak', 'ide', 'bream', 'white_bream', 'gudgeon', 'tench', 'carp', 'chekhon'].includes(fid)) {
      if (isCold) {
        return [
          'Нано-джиг 0.3–0.8 г + искусственный мотыль Berkley (медленное волочение с паузой)',
          'Вольфрамовая мормышка 0.2–0.5 г + фиолетовый/рубиновый слаг Tanta 1" у дна',
          'Одноухий монтаж 0.4–1.0 г с пассивным слагом Whitebait / Polaris на паузе 3–5 сек',
          'Мормышка с подсадкой живого мотыля / опарыша (комбо-мормышинг)',
          'Огруженная нимфа ручейника / бокоплава (0.4–0.8 г) у придонной бровки'
        ];
      }
      return [
        'Мормышка 0.2–0.6 г + слаг Whitebait / Tanta 0.8–1.2" (пелагический зуд и кач)',
        'Нано-джиг (одноухий монтаж 0.3–1.0 г) + личинка Polaris / искусственный мотыль',
        'Мухомормышка / Нимфа с вольфрамовой бусиной (веснянка, ручейник, бормаш)',
        'Мормышка 0.2–0.5 г с силиконовым опарышем / нарезкой съедобной резины',
        'Микроколебалка 0.8–2.0 г / Вертушка №00 на снос по струе'
      ];
    }
    if (isCold) {
      return [
        'Пассивный слаг 1–1.8 дюйма (Polaris / Tanta) на паузе до 4–5 сек',
        'Мормышка 0.3–0.8 г с искусственным мотылём / вайтбейтом',
        'Микрорачок на оснастке джиг-риг 1.2–3.5 г (волочение по дну)',
        'Микроколебалка 1.2–2.5 г медленной проводкой у дна'
      ];
    }
    return [
      'Активный микротвистер / виброхвост 1.2–2 дюйма (микроджиг 1–4 г)',
      'Мормышка 0.3–0.8 г со слагом Tanta / Whitebait (мормышинг)',
      'Вращающаяся блесна (вертушка №00–№1)',
      'Микроколебалка 1.2–3.5 г в толще воды',
      'Микрокрэнк / уокер 25–38 мм (поверхностный бой)'
    ];
  }
  if (method === 'spin_jig') {
    if (!isPred) {
      return [
        'Лёгкий джиг-риг / отводной 2–6 г с пассивной личинкой 1.2–1.8 дюйма',
        'Искусственный мотыль / червь Marukyu на шарнирном монтаже',
        'Микротвистер 1.5 дюйма на медленной придонной подаче'
      ];
    }
    if (isCold) {
      return [
        'Мандула (билайн / триколор) с перегрузом на паузе 3–5 сек',
        'Поролоновая рыбка с прижатым двойником (холодная вода)',
        'Пассивный слаг / силиконовый рак 3–4 дюйма',
        'Крупный виброхвост 10–14 см на медленной подаче у дна'
      ];
    }
    return [
      'Активный силиконовый виброхвост 7–11 см (съедобная резина)',
      'Твистер 6–9 см на шарнирном монтаже',
      'Силиконовая креатура / рак на отводном поводке',
      'Поролоновая рыбка / мандула по русловым бровкам'
    ];
  }
  if (method === 'spin_lure') {
    if (['dace', 'peled', 'pizhyan', 'whitefish', 'rudd', 'chekhon', 'bleak'].includes(fid)) {
      return [
        'Вращающаяся блесна УЛ (вертушка №00–№1 с мушкой на тройнике)',
        'Микроколебалка форелевого типа 1.0–2.8 г в толще струи',
        'Мини-крэнк / воблер-жук 22–35 мм на снос по течению',
        'Поверхностный микро-поппер / уокер 30–40 мм'
      ];
    }
    if (['asp', 'sky_gazer'].includes(fid)) {
      return isCold ? [
        'Тяжёлый пилькер / кастмастер 14–28 г в придонном слое',
        'Тонущий стикбейт / раттлин 60–75 мм',
        'Дальнобойная узкая колебалка («трёхгранка»)'
      ] : [
        'Кастмастер / жереховая блесна 10–24 г в верхнем горизонте',
        'Уокер / поппер поверхностный («бой» на перекате)',
        'Стример-вабик перед блесной',
        'Тонущий воблер-минноу 60–80 мм'
      ];
    }
    if (['chub', 'ide', 'trout', 'brown_trout', 'rainbow_trout', 'grayling', 'baikal_grayling', 'lenok', 'char', 'dolly_varden'].includes(fid)) {
      return isCold ? [
        'Тонущий воблер-минноу 40–55 мм с паузами в приямках',
        'Колеблющаяся блесна 2.5–6 г у дна',
        'Вращающаяся блесна №1–№2 с утяжелённым сердечником'
      ] : [
        'Воблер-крэнк (SSR/SR) и имитации майского жука / кузнечика',
        'Вращающаяся блесна №0–№3 на снос по струе',
        'Микроколебалка 2–5 г',
        'Ночная поверхностная мышь (таймень / ленок / крупный голавль)'
      ];
    }
    if (isCold) {
      return [
        'Воблер-минноу суспендер (SP) 90–130 мм с паузами до 5–7 сек',
        'Широкая колеблющаяся блесна 16–28 г (медленная равномерка)',
        'Тонущий раттлин / виб впритирку ко дну'
      ];
    }
    return [
      'Воблер-минноу 80–115 мм (активный твичинг)',
      'Вращающаяся блесна (вертушка №2–№4)',
      'Колеблющаяся блесна 10–22 г вдоль травы и кос',
      'Поверхностный поппер / глиссер-лягушка по мелководью',
      'Воблер-крэнк со средним заглублением'
    ];
  }
  if (method === 'bottom') {
    if (['crayfish', 'crab', 'king_crab'].includes(fid)) {
      return [
        'Свежая резаная рыба (плотвичка, карась, сельдь)',
        'Мясо ракушки / мидии / креветки',
        'Чёрный хлеб, натёртый чесноком и укропом'
      ];
    }
    if (['silver_carp', 'paddlefish'].includes(fid)) {
      return [
        'Донный гейзер-технопланктон с плавающими пенопластовыми шариками',
        'Пылящая карповая каша в пружине с крючком на всплытии'
      ];
    }
    if (['grass_carp'].includes(fid)) {
      return isCold ? [
        'Подрезанный поп-ап / вафтерс 8–10 мм (ананас, чеснок, специи) с ПВА-стиком',
        'Одиночная кукуруза с плавающей пенкой на волосе №8–10',
        'Флэт-кормушка (микро-пеллетс 1.5–2 мм) с нейтральной насадкой'
      ] : [
        'Сладкая ферментированная кукуруза (цепочка на волосе с плавающей пенкой)',
        'Плавающий или нейтральный бойл 12–16 мм (ананас, слива, скопекс, трава)',
        'Молодой побег камыша / сердцевина рогоза / технопланктон'
      ];
    }
    if (['carp', 'buffalo', 'black_carp'].includes(fid)) {
      return isCold ? [
        'Одиночный подрезанный Поп-ап / Вафтерс 8–10 мм (специи, робин ред, чеснок, криль) + ПВА-стик',
        'Флэт-кормушка (пеллетс 1.5–2 мм криль/палтус) с нейтральной насадкой Wafters 8 мм',
        'Пучок крупного мотыля / опарыша на клипсе с дипом «Специи / Чеснок»',
        'Кусочек червя Дендробена с подсадкой пенопласта'
      ] : [
        'Тонущий бойл 14–20 мм (рыбная мука / палтус / монстер краб) или «снеговик» с поп-апом 10 мм',
        'Фруктовый бойл / Вафтерс 12–16 мм (клубника, слива, ананас, скопекс) под флэт-фидер',
        'Тигровый орех / цепочка ферментированной кукурузы на волосе с пенкой',
        'Пеллетс Халибут (Палтус) 8–14 мм на волосе со спомбовым закормом'
      ];
    }
    if (isPred) {
      return isCold ? [
        'Живец у дна (ёрш, пескарь, карасик)',
        'Свежая нарезка рыбы (филе бели / тюлька)',
        'Куриная или говяжья печень',
        'Пучок крупных выползков'
      ] : [
        'Живец активный (уклейка, плотвичка, пескарь)',
        'Пучок ночных выползков / пиявка (на сома и усача)',
        'Мясо ракушки-перловицы / медведка',
        'Нарезка свежей рыбы'
      ];
    }
    if (isCold) {
      return [
        'Мотыль крупный (пучок 3–5 шт. на тонком крючке №14–16)',
        'Бутерброд: 2 мотыля + 1 белый опарыш',
        'Опарыш (белый / красный пинка) или живой бокоплав (мормыш)',
        'Кусочек навозного червя со специями (кориандр / чеснок)',
        'Ручейник (шитик)'
      ];
    }
    return [
      'Червь навозный / Дендробена (или пучок червей)',
      'Опарыш (пучок 3–5 шт.) или бутерброд с кукурузой',
      'Кукуруза сладкая консервированная',
      'Перловка распаренная с чесноком и жмыхом',
      'Пареный горох / мастырка / флэт-бойлы 8–12 мм'
    ];
  }
  if (method === 'float') {
    if (['silver_carp', 'paddlefish'].includes(fid)) {
      return [
        'Бочонок технопланктона (оригинал, анис, мёд, топлёное молоко)',
        'Пылящее тесто для толстолобика в горизонте 0.5–1.5 м'
      ];
    }
    if (isPred) {
      return [
        'Мелкий живец (верховка, уклейка, пескарь) на живцовой поплавочке',
        'Навозный червь / пучок опарыша в проводку',
        'Мальковая резка / куриная шкурка (на ротана и окуня)'
      ];
    }
    if (isCold) {
      return [
        'Мотыль насадочный (1–3 личинки на крючке №16–18)',
        'Опарыш мелкий (пинка) / живой мормыш (бокоплав)',
        'Ручейник (шитик) / короед в проводку',
        'Небольшой кусочек навозного червя'
      ];
    }
    return [
      'Опарыш / навозный червь (классика для рек и озёр)',
      'Манная болтушка с анисом / ванилью',
      'Хлебный мякиш / прищип / корочка',
      'Кукуруза сладкая / пареная перловка',
      'Тесто с чесноком / зелень (нитчатые водоросли на плотву и краснопёрку)'
    ];
  }
  if (method === 'fly') {
    if (isCold) {
      return [
        'Тяжёлая огруженная нимфа с вольфрамовой головкой (Goldhead)',
        'Мокрая мушка под бокоплава (гаммаруса / ручейника) у дна',
        'Тонущий стример (Woolly Bugger / пиявка)'
      ];
    }
    return [
      'Сухая мушка (подёнка Mayfly / ручейник Caddis)',
      'Нимфа под бормаша / веснянку в толще струи',
      'Имитация жука / кузнечика / муравья (ловля под кустами)',
      'Мокрая мушка / эмерджер в поверхностной плёнке'
    ];
  }
  if (method === 'sea_rock') {
    return isCold ? [
      'Стрейчевый червь Marukyu Power Isome на паузе у камней',
      'Светонакопительный пассивный слаг 1.5–2 дюйма (микроджиг 1.5–3 г)',
      'Мясо свежей креветки / мидии на отводном поводке'
    ] : [
      'Силиконовые рачки, крабы и креатуры 1.5–2.5 дюйма',
      'Микроджиг со светонакопительным твистером (ночной лов ставриды и ерша)',
      'Поверхностный пилькер 3–7 г / бомбарда с нереисом (сарган, луфарь)',
      'Морской червь нереис / усик креветки'
    ];
  }
  if (method === 'sea_surf') {
    return [
      'Морской червь (нереис / пескожил) на плавающем крючке с зелёным пенопластом',
      'Свежая нарезка хамсы / ставриды / саргана (на калкана и камбалу)',
      'Очищенная сырая креветка / мясо мидии',
      'Полоска свежего кальмара'
    ];
  }
  if (method === 'sea_boat') {
    return [
      'Тяжёлый морской пилькер 60–250 г с октопусом',
      'Ставка-самодур (сабики) с люрексом и рыбьей кожей',
      'Крупный виброхвост на морской джиг-головке 150–400 г',
      'Филе сельди / сайды / кальмара на донной оснастке'
    ];
  }
  if (isPred) {
    return isCold ? SEASONAL_BAITS.predator_natural : SEASONAL_BAITS.predator_lure;
  }
  return isCold ? SEASONAL_BAITS.peace_cold : SEASONAL_BAITS.peace_warm;
}
export function getCompatibleMethods(fish, iceState = 'open_water', waterType = 'small_river', waterTemp = 12) {
  const isSea = waterType === 'sea_gulf' || waterType === 'open_sea';
  const isCold = waterTemp <= 10.5;
  const fid = fish?.id || '';
  if (iceState === 'ice_safe') {
    if (fish && fish.type === 'predator') {
      if (['burbot', 'cod', 'halibut', 'navaga', 'wolffish'].includes(fid)) {
        return [
          { val: 'winter_stuka', text: 'Тяжёлая стукалка со дна (налим, треска)' },
          { val: 'winter_livebait', text: 'Жерлицы / Подлёдные поставуши на живца' },
          { val: 'winter_lure', text: 'Зимнее блеснение: Балансир / Раттлин' },
          { val: 'winter_jig', text: 'Зимняя мормышка с мотылём / резкой' }
        ];
      }
      if (['pike'].includes(fid)) {
        return [
          { val: 'winter_livebait', text: 'Жерлицы на живца (плотва, карась, окунь)' },
          { val: 'winter_lure', text: 'Зимнее блеснение: Раттлин (Виб 65–85 мм) / Балансир' },
          { val: 'winter_jig', text: 'Зимняя блесна / Крупная мормышка с резкой' }
        ];
      }
      if (['zander', 'volga_zander'].includes(fid)) {
        return [
          { val: 'winter_lure', text: 'Зимнее блеснение: Виб (раттлин) / Судаковая блесна' },
          { val: 'winter_livebait', text: 'Подлёдные жерлицы / поставуши с тюлькой' }
        ];
      }
      return [
        { val: 'winter_lure', text: 'Зимнее блеснение: Балансир / Раттлин / Блесна' },
        { val: 'winter_jig', text: 'Зимняя мормышка с мотылём / безмотылка' },
        { val: 'winter_livebait', text: 'Жерлицы на мелкого живца' }
      ];
    }
    if (['chir', 'pizhyan', 'peled', 'cisco', 'whitefish', 'smelt', 'vendace', 'omul', 'omul_arctic', 'broad_whitefish', 'valek', 'tugun'].includes(fid)) {
      return [
        { val: 'winter_cisco', text: 'Гирлянда мормышек / Подлёдный поплавок (сиговые, сырок, корюшка)' },
        { val: 'winter_jig', text: 'Зимняя мормышка / Безмотылка (мотыль, мормыш)' },
        { val: 'winter_lure', text: 'Зимняя сиговая блесна с цепочкой / Балансир' }
      ];
    }
    return [
      { val: 'winter_jig', text: 'Зимняя мормышка / Поплавок со льда (мотыль, мормыш, безмотылка)' },
      { val: 'winter_cisco', text: 'Тандем мормышек / Чёртик / Гвоздешарик' }
    ];
  }
  const list = [];
  const isPred = fish && fish.type === 'predator';
  if (isSea) {
    if (['flounder', 'starry_flounder', 'turbot', 'plaice', 'halibut', 'wolffish', 'anglerfish'].includes(fid)) {
      list.push({ val: 'sea_surf', text: 'Береговая морская донка (серфкастинг со дна)' });
      list.push({ val: 'sea_boat', text: 'Морской отвесный лов с лодки / катера' });
      list.push({ val: 'sea_rock', text: 'Прибрежный морской джиг (тирольская палочка / булер)' });
      return list;
    }
    if (['cod', 'haddock', 'saithe', 'walleye_pollock'].includes(fid)) {
      list.push({ val: 'sea_boat', text: 'Морской отвесный лов с катера (пилькер, самодур)' });
      list.push({ val: 'sea_surf', text: 'Береговая морская донка' });
      list.push({ val: 'sea_rock', text: 'Морской береговой спиннинг' });
      return list;
    }
    if (isPred) {
      list.push({ val: 'sea_rock', text: 'Морская прибрежная ловля (рокфишинг, микроджиг, пилькер)' });
      list.push({ val: 'sea_surf', text: 'Береговая морская донка (серфкастинг)' });
      list.push({ val: 'sea_boat', text: 'Морской лов с лодки / самодур' });
      list.push({ val: 'spin_lure', text: 'Спиннинг: Морские блёсны и воблеры' });
    } else {
      list.push({ val: 'sea_surf', text: 'Береговая морская донка (на нереиса с пенопластом)' });
      list.push({ val: 'sea_rock', text: 'Лёгкий рокфишинг / мормышинг у камней и пирсов' });
      list.push({ val: 'float', text: 'Поплавочная удочка / Бомбарда' });
    }
    return list;
  }
  if (isPred) {
    if (['zander', 'volga_zander'].includes(fid)) {
      list.push({ val: 'spin_jig', text: 'Спиннинг джиговый: Ступенчатая проводка у дна (10–42 г)' });
      list.push({ val: 'spin_lure', text: 'Спиннинг: Глубоководные воблеры и раттлины' });
      list.push({ val: 'bottom', text: 'Донная снасть на живца / нарезку рыбы' });
      list.push({ val: 'spin_micro', text: 'Лёгкий джиг / Отводной поводок на бровках (3–8 г)' });
      return list;
    }
    if (['pike'].includes(fid)) {
      if (isCold) {
        list.push({ val: 'spin_jig', text: 'Спиннинг джиговый: Русловый джиг по холодной воде (10–35 г)' });
        list.push({ val: 'spin_lure', text: 'Спиннинг: Воблеры-суспендеры и крупные колебалки' });
        list.push({ val: 'bottom', text: 'Живцовая донка / Поплавочная жерлица' });
      } else {
        list.push({ val: 'spin_lure', text: 'Спиннинг: Воблеры (твичинг), колебалки и вертушки' });
        list.push({ val: 'spin_jig', text: 'Спиннинг джиговый: Виброхвосты и твистеры (8–28 г)' });
        list.push({ val: 'bottom', text: 'Живцовая снасть у кромки камыша' });
      }
      return list;
    }
    if (['catfish', 'amur_catfish', 'channel_catfish'].includes(fid)) {
      list.push({ val: 'bottom', text: 'Мощная донная снасть / Ловля с квоком (выползок, живец, печень)' });
      list.push({ val: 'spin_jig', text: 'Тяжёлый джиг по зимовальным ямам и руслу (24–60 г)' });
      list.push({ val: 'spin_lure', text: 'Спиннинг: Глубоководные крэнки и тяжёлые колебалки' });
      return list;
    }
    if (['chub', 'asp', 'sky_gazer', 'snakehead'].includes(fid)) {
      list.push({ val: 'spin_lure', text: 'Спиннинг: Воблеры-крэнки, блёсны, кастмастеры, топвотеры' });
      list.push({ val: 'spin_micro', text: 'Нано-джиг / Мормышинг и Ультралайт (0.3–5 г)' });
      list.push({ val: 'fly', text: 'Нахлыст / Бомбарда с сухой мушкой или жуком' });
      list.push({ val: 'float', text: 'Поплавочная удочка в проводку (кузнечик, корка, горох)' });
      list.push({ val: 'bottom', text: 'Донная снасть / Фидер на течении' });
      return list;
    }
    if (['perch', 'rotan'].includes(fid)) {
      list.push({ val: 'spin_micro', text: 'Микроджиг / Нано-джиг и Мормышинг (0.2–5 г)' });
      if (isCold) {
        list.push({ val: 'spin_jig', text: 'Спиннинг джиговый / Отводной поводок по бровкам (6–16 г)' });
        list.push({ val: 'float', text: 'Поплавочная удочка / Боковой кивок с червём или мальком' });
        list.push({ val: 'spin_lure', text: 'Спиннинг: Тонущие воблеры и раттлины' });
      } else {
        list.push({ val: 'spin_lure', text: 'Спиннинг: Вертушки №1–№3, тейл-спиннеры, попперы' });
        list.push({ val: 'spin_jig', text: 'Спиннинг джиговый / Отводной поводок' });
        list.push({ val: 'float', text: 'Поплавочная удочка с червём / мальком' });
      }
      return list;
    }
    if (['trout', 'brown_trout', 'rainbow_trout', 'grayling', 'baikal_grayling', 'lenok', 'salmon', 'pink_salmon', 'chum_salmon', 'coho_salmon', 'sockeye_salmon', 'chinook_salmon', 'cherry_salmon', 'char', 'dolly_varden'].includes(fid)) {
      if (['grayling', 'baikal_grayling'].includes(fid)) {
        list.push({ val: 'spin_micro', text: 'Ультралайт / Мормышинг и Нано-джиг (0.3–3.5 г, нимфы, вертушки №00–1)' });
        list.push({ val: 'fly', text: 'Нахлыст / Грузовой настрой с мушкой или сбирулино' });
        list.push({ val: 'float', text: 'Болонская поплавочная удочка в проводку (ручейник, бормаш, червь)' });
        list.push({ val: 'spin_lure', text: 'Спиннинг: Вращающиеся и колеблющиеся блёсны' });
      } else {
        list.push({ val: 'spin_lure', text: 'Спиннинг: Тонущие воблеры, колебалки и вертушки' });
        list.push({ val: 'spin_micro', text: 'Ультралайт / Нано-джиг (форелевые микроколебалки и резина 0.4–4 г)' });
        list.push({ val: 'fly', text: 'Нахлыст / Стример и мушка' });
        list.push({ val: 'float', text: 'Поплавочная снасть в проводку / паста' });
      }
      return list;
    }
    if (['burbot', 'ruffe'].includes(fid)) {
      list.push({ val: 'bottom', text: 'Донная снасть (закидушка / пикер с червём, ершом или резкой)' });
      list.push({ val: 'spin_micro', text: 'Нано-джиг / Микроджиг у самого дна с паузами (0.4–4 г)' });
      list.push({ val: 'spin_jig', text: 'Ступенчатый джиг у дна с долгими паузами' });
      list.push({ val: 'float', text: 'Поплавочная снасть у дна' });
      return list;
    }
    list.push({ val: 'spin_lure', text: 'Спиннинг: Блёсны и воблеры' });
    list.push({ val: 'spin_jig', text: 'Спиннинг джиговый' });
    list.push({ val: 'spin_micro', text: 'Микроджиг / Нано-джиг (мормышинг)' });
    list.push({ val: 'bottom', text: 'Донная снасть' });
    return list;
  }
  if (['crayfish', 'crab', 'king_crab'].includes(fid)) {
    list.push({ val: 'bottom', text: 'Донная снасть / Разрешённая раколовка с приманкой' });
    return list;
  }
  if (['silver_carp', 'paddlefish'].includes(fid)) {
    list.push({ val: 'float', text: 'Поплавочная оснастка «Барилка» на технопланктон (в толще воды)' });
    list.push({ val: 'bottom', text: 'Донная оснастка «Гейзер» с технопланктоном и пенопластом' });
    return list;
  }
  if (['grass_carp'].includes(fid)) {
    list.push({ val: 'bottom', text: 'Карповая донная снасть / Флэт-фидер (кукуруза, бойл, камыш)' });
    list.push({ val: 'float', text: 'Матчевая поплавочная оснастка у стенки тростника' });
    return list;
  }
  if (['dace', 'peled', 'roach', 'rudd', 'bleak', 'gudgeon', 'chekhon', 'ide'].includes(fid)) {
    if (['dace', 'peled'].includes(fid)) {
      list.push({ val: 'spin_micro', text: 'Нано-джиг / Мормышинг (XUL 0.2–1.2 г, вайтбейт, танта, мотыль в толще и у дна)' });
      list.push({ val: 'float', text: 'Поплавочная удочка: Болонская / Маховая в проводку по струе' });
      list.push({ val: 'bottom', text: 'Донная снасть: Деликатный пикер / Лёгкий фидер' });
      list.push({ val: 'fly', text: 'Нахлыст / Плавающая бомбарда (сбирулино) с мушкой или нимфой' });
      list.push({ val: 'spin_lure', text: 'Ультралайт спиннинг: Микроколебалки 0.8–2.5 г и вертушки №00–№1' });
      return list;
    }
    if (isCold) {
      list.push({ val: 'bottom', text: 'Донная снасть: Деликатный пикер / Лёгкий фидер (тонкий поводок)' });
      list.push({ val: 'float', text: 'Поплавочная удочка: Болонская / Маховая со дна' });
      list.push({ val: 'spin_micro', text: 'Нано-джиг / Мормышинг (XUL 0.2–1.0 г на медленной проводке)' });
    } else {
      list.push({ val: 'float', text: 'Поплавочная удочка: Маховая / Болонская в проводку' });
      list.push({ val: 'spin_micro', text: 'Нано-джиг / Мормышинг (XUL 0.2–1.0 г, танта, вайтбейт, мотыль)' });
      list.push({ val: 'bottom', text: 'Донная снасть: Пикер / Лёгкий фидер' });
    }
    if (['chekhon', 'ide', 'rudd', 'bleak'].includes(fid)) {
      list.push({ val: 'spin_lure', text: 'Ультралайт: Микровертушки №00–№1, микроколебалки и крэнки' });
      list.push({ val: 'fly', text: 'Нахлыст / Бомбарда (сбирулино) с мушкой или опарышем' });
    }
    return list;
  }
  if (['crucian', 'tench', 'tilapia'].includes(fid)) {
    if (isCold) {
      list.push({ val: 'bottom', text: 'Донная снасть: Лёгкий пикер / Фидер на глубине (мотыль, опарыш)' });
      list.push({ val: 'float', text: 'Чувствительная поплавочная удочка у дна' });
      list.push({ val: 'spin_micro', text: 'Нано-джиг / Мормышинг у дна (0.2–0.6 г с паузами 3–5 сек)' });
    } else {
      list.push({ val: 'float', text: 'Поплавочная удочка: Маховая у камыша и в окнах кувшинок' });
      list.push({ val: 'spin_micro', text: 'Нано-джиг / Мормышинг (XUL 0.2–0.8 г, танта, мотыль, вайтбейт)' });
      list.push({ val: 'bottom', text: 'Донная снасть: Пикер / Флэт-фидер («убийца карася»)' });
    }
    return list;
  }
  if (['chir', 'pizhyan', 'cisco', 'tugun', 'whitefish', 'vendace', 'broad_whitefish', 'omul', 'omul_arctic', 'valek'].includes(fid)) {
    if (['tugun', 'cisco', 'vendace', 'omul', 'omul_arctic'].includes(fid)) {
      list.push({ val: 'float', text: 'Поплавочная удочка в проводку / Сбирулино с мушкой' });
      list.push({ val: 'spin_micro', text: 'Нано-джиг / Мормышинг (0.2–0.8 г, микросиликон и нимфы в толще воды)' });
      list.push({ val: 'fly', text: 'Нахлыст / Грузовой настрой («гирлянда» мушек под бормаша)' });
      list.push({ val: 'bottom', text: 'Донная снасть / Лёгкий пикер' });
      return list;
    }
    list.push({ val: 'bottom', text: 'Донная снасть / Фидер по плёсам и бровкам (мотыль, мормыш, ручейник)' });
    list.push({ val: 'spin_micro', text: 'Нано-джиг / Мормышинг у дна и в толще (0.3–1.2 г, нимфа, танта, мотыль)' });
    list.push({ val: 'float', text: 'Поплавочная удочка в проводку / Сбирулино' });
    list.push({ val: 'fly', text: 'Нахлыст (огруженная нимфа у дна / бокоплав)' });
    list.push({ val: 'spin_lure', text: 'Ультралайт спиннинг: Вращалки №0–№1 и микроколебалки' });
    return list;
  }
  if (['carp', 'bream', 'buffalo', 'black_carp', 'parabramis', 'tarpon_carp', 'white_bream', 'blue_bream', 'sopa', 'vimba', 'vobla', 'taran', 'kutum', 'barbel', 'sterlet', 'undermouth', 'loach'].includes(fid)) {
    list.push({ val: 'bottom', text: 'Донная снасть: Фидер / Пикер / Карповая кормушка' });
    list.push({ val: 'float', text: 'Поплавочная удочка: Болонская в проводку / Матчевая / Маховая' });
    list.push({ val: 'spin_micro', text: 'Нано-джиг / Мормышинг (0.3–1.2 г, придонная подача мотыля и слагов)' });
    return list;
  }
  list.push({ val: 'bottom', text: 'Донная снасть: Фидер / Пикер' });
  list.push({ val: 'float', text: 'Поплавочная удочка' });
  list.push({ val: 'spin_micro', text: 'Нано-джиг / Мормышинг (0.2–1.2 г)' });
  return list;
}
export const DEFAULT_STATE = {
  route: 'forecast',
  appMode: 'angler',
  hasUserLocation: false,
  lat: 66.0833,
  lon: 76.6800,
  locCountry: 'Россия',
  locAdmin1: 'Ямало-Ненецкий АО',
  locAdmin2: 'Новый Уренгой',
  locLabel: 'Новый Уренгой',
  basinCode: 'arctic_ob_taz',
  basinName: 'Обь-Тазовский северный бассейн (Обь, Иртыш, Пур, Таз)',
  isCoastal: false,
  water: 'small_river',
  waterRadiusKm: 50,
  selectedWaterName: '',
  method: 'winter_livebait',
  selectedBait: '',
  depth: 2.0,
  fishId: '',
  dayIdx: 2, // 0=Позавчера, 1=Вчера, 2=Сегодня (активен Сегодня!)
  selectedHour: new Date().getHours(),
  showAllSpecies: false,
  onlyFavoritesFilter: false,
  fishSearch: '',
  fishGroup: 'all',
  favorites: [], // Пункт 1b: Избранное по умолчанию строго пустое!
  favoritesExplicitlySet: false,
  pinnedDays: [],
  compareSpeciesIds: ['pike', 'perch', 'dace'],
  calendarMode: 'single',
  theme: 'auto',
  elevation: 120,
  normPress: 750,
  iceState: 'ice_safe',
  iceThickness: 16,
  weatherSource: 'fallback',
  weatherUpdatedAt: 0,
  weatherDays: [],
  nearbyWaters: [],
  nearbyPlaces: [],
  savedSpots: [],
  catches: [],
  circleItems: [],
  chatMessages: [],
  notifications: [],
  proFactorWeights: { temp: 1.0, press: 1.0, archive_shock: 1.0, circle_field: 1.0 },
  userProfile: {
    onboarded: false,
    appMode: 'angler',
    login: '',
    callsign: 'Рыболов',
    fisherId: '',
    pinHash: '',
    authTokenHash: '',
    tgLinkedId: '',
    tgUsername: '',
    isAdmin: false,
    ownerUnlocked: false,
    adminShowAllCrews: true,
    adminWhitelist: [],
    hiddenCircleIds: [],
    unlockedCrewKeys: [],
    notifSettings: {
      sos: true,
      crew: true,
      circle: true,
      workshop: true,
      dm: true,
      sound: true
    },
    preferredWater: 'small_river',
    preferredMethod: 'spin_micro',
    targetSpecies: []
  }
};
