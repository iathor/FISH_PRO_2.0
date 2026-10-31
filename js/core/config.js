/**
 * @file config.js
 * @description Конфигурация приложения (Релиз 2.5.0 r187), слои карт без VPN и адаптивные справочники снастей и сезонных наживок
 */

export const APP_VERSION = '2.5.0';
export const APP_BUILD_NUMBER = 187;
export const APP_REVISION = 'r187';
export const APP_DISPLAY_VERSION = 'v2.5.0 r187';
export const STATE_CACHE_KEY = 'klev_pro_state_v2.0';
export const WEATHER_CACHE_KEY = 'klev_pro_weather_v2.0';
export const RELEASE_CACHE_KEY = 'klev_pro_release_v2.0';
export const WEATHER_TTL_MS = 2 * 60 * 60 * 1000;

export const CURRENT_RELEASE_INFO = {
  "version": "2.5.0",
  "versionCode": 250187,
  "buildNumber": 187,
  "revision": "r187",
  "displayVersion": "v2.5.0 r187",
  "date": "30 октября 2026",
  "releasedAt": "2026-10-30T18:00:00Z",
  "apkUrl": "https://klevpro.ru/apk/klev-pro-v2.5.0.apk",
  "fileSize": "38.2 МБ",
  "title": "Выпущена новая версия «Клёв ПРО 2.0» (v2.5.0 r187)",
  "subtitle": "Стабильная работа БД и Топо-карт без VPN, свайп рыбы на главном экране, запись холостых выездов, личная аналитика уловов, 5 типов точек на карте и региональные чаты РФ.",
  "summary": "Реализован Второй этап Дорожной карты (v2.5.0 r187): бесперебойная синхронизация БД без VPN и с бесплатными VPN, топографические карты РФ без VPN, контроль обновлений APK по ревизиям (r187), свайп рыбы на главном блоке прогноза, кнопка «Холостой выезд (0 поклёвок)» и личная аналитика в Журнале, тактические блоки Фидер/Спиннинг/Лёд, 5 цветовых типов точек на карте, общие региональные чаты РФ и справочник оснасток.",
  "changes": [
    {
      "icon": "<svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M12 2.5l7 3.2v5.8c0 5-3 9.3-7 10.8-4-1.5-7-5.8-7-10.8V5.7l7-3.2z\" fill=\"rgba(56,189,248,0.22)\" stroke=\"#38bdf8\" stroke-width=\"1.8\" stroke-linejoin=\"round\"/></svg>",
      "title": "Работа БД и Топо-карт без VPN и с любыми бесплатными VPN (r187)",
      "text": "Внедрён многоканальный сетевой транспорт с автообходом блокировок ТСПУ и кривых прокси для 100% сохранения данных в БД, а топо-карта переведена на быстрый сервер рельефа, работающий без VPN по всей России."
    },
    {
      "icon": "<svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M20 11a8 8 0 0 0-14.5-4.5L4 8m0-5v5h5M4 13a8 8 0 0 0 14.5 4.5L20 16m0 5v-5h-5\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>",
      "title": "Точное автообновление APK по номеру ревизии (v2.5.0 r187)",
      "text": "Теперь приложение проверяет не только основной номер версии (2.5.0), но и внутренний счётчик сборки (r187), мгновенно оповещая о выходе любых исправлений."
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
      "title": "Работа БД и Топо-карт без VPN и с любыми бесплатными VPN (r187)",
      "text": "Внедрён многоканальный сетевой транспорт с автообходом блокировок ТСПУ и кривых прокси для 100% сохранения данных в БД, а топо-карта переведена на быстрый сервер рельефа, работающий без VPN по всей России."
    },
    {
      "icon": "<svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><path d=\"M20 11a8 8 0 0 0-14.5-4.5L4 8m0-5v5h5M4 13a8 8 0 0 0 14.5 4.5L20 16m0 5v-5h-5\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>",
      "title": "Точное автообновление APK по номеру ревизии (v2.5.0 r187)",
      "text": "Теперь приложение проверяет не только основной номер версии (2.5.0), но и внутренний счётчик сборки (r187), мгновенно оповещая о выходе любых исправлений."
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

// Слои карт, работающие в РФ без VPN (основной Топо — Esri World Topographic Map с рельефом, глубинами/реками и русскими подписями + резервные зеркала)
export const MAP_LAYERS = {
  topo: {
    name: 'Топо',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    fallbacks: [
      'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png'
    ],
    attr: '© Esri, OpenStreetMap (Топо без VPN)'
  },
  sat: {
    name: 'Спутник',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    fallbacks: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}'
    ],
    attr: '© Esri (Спутник)'
  },
  carto: {
    name: 'Схема',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    fallbacks: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}'
    ],
    attr: '© OpenStreetMap'
  },
  osm: {
    name: 'Рельеф',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}',
    fallbacks: [
      'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      'https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png'
    ],
    attr: '© Esri / NatGeo'
  }
};

// 5 цветовых типов пользовательских точек на карте (Пункт 19 Дорожной карты v2.5.0)
export const SPOT_CATEGORIES = {
  bite:   { id: 'bite',   icon: '<svg class="k-ico" style="color:var(--good);" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="currentColor" stroke="rgba(255,255,255,0.65)" stroke-width="1.4"/></svg>', short: 'Клёв',      label: '<svg class="k-ico" style="color:var(--good);" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="currentColor" stroke="rgba(255,255,255,0.65)" stroke-width="1.4"/></svg> Клёв / Уловистая точка', color: '#10b981' },
  slip:   { id: 'slip',   icon: '<svg class="k-ico" style="color:var(--accent);" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="currentColor" stroke="rgba(255,255,255,0.65)" stroke-width="1.4"/></svg>', short: 'Слип',      label: '<svg class="k-ico" style="color:var(--accent);" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="currentColor" stroke="rgba(255,255,255,0.65)" stroke-width="1.4"/></svg> Слип / Спуск лодки',     color: '#38bdf8' },
  camp:   { id: 'camp',   icon: '<svg class="k-ico" style="color:var(--warn);" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="currentColor" stroke="rgba(255,255,255,0.65)" stroke-width="1.4"/></svg>', short: 'Стоянка',   label: '<svg class="k-ico" style="color:var(--warn);" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="currentColor" stroke="rgba(255,255,255,0.65)" stroke-width="1.4"/></svg> Стоянка / Кемпинг',      color: '#f59e0b' },
  hazard: { id: 'hazard', icon: '<svg class="k-ico" style="color:var(--bad);" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="currentColor" stroke="rgba(255,255,255,0.65)" stroke-width="1.4"/></svg>', short: 'Опасно',    label: '<svg class="k-ico" style="color:var(--bad);" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="currentColor" stroke="rgba(255,255,255,0.65)" stroke-width="1.4"/></svg> Опасное место / Зацеп',  color: '#ef4444' },
  shop:   { id: 'shop',   icon: '<svg class="k-ico" style="color:#a855f7;" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="currentColor" stroke="rgba(255,255,255,0.65)" stroke-width="1.4"/></svg>', short: 'Магазин',   label: '<svg class="k-ico" style="color:#a855f7;" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="currentColor" stroke="rgba(255,255,255,0.65)" stroke-width="1.4"/></svg> Магазин снастей / База', color: '#a855f7' }
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
        'Балансир 50–70 мм (натурал / кислотник)',
        'Зимний раттлин (виб 55–80 мм)',
        'Широкая зимняя колебалка на щуку',
        'Донная блесна с подсадкой резки'
      ];
    }
    // winter_jig
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

  // Нано-джиг и Мормышинг (spin_micro) — отдельно для мирной/сиговой и для хищной рыбы
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
      return [
        'Сладкая кукуруза (цепочка на волосе с плавающей пенкой)',
        'Молодой побег камыша / сердцевина рогоза',
        'Плавающий бойл (ананас, слива, скопекс, трава)'
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
          { val: 'winter_lure', text: 'Зимнее блеснение: Балансир 60–70 мм / Виб' }
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

  // Open water
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

  // МИРНАЯ И СИГОВАЯ РЫБА (белая рыба, карась, елец, пелядь/сырок, плотва, лещ, язь и др.)
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

  // Елец (dace), Пелядь/Сырок (peled), Плотва/Сорога (roach), Краснопёрка (rudd), Уклейка (bleak), Пескарь (gudgeon), Чехонь (chekhon), Язь (ide)
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

  // Карась (crucian), Линь (tench), Тиляпия (tilapia)
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

  // Сиговые виды: Щокур/Чир (chir), Пыжьян (pizhyan), Тугун (tugun), Сиг (whitefish), Ряпушка (cisco, vendace), Омуль (omul, omul_arctic), Валёк (valek)
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

  // Лещ, Густера, Синец, Сопа, Подуст, Рыбец, Вобла, Тарань, Карп/Сазан, Усач, Стерлядь, Конь-губарь, Амурский лещ
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
  favorites: [], // Пункт 1b: Избранное по умолчанию строго пустое!
  favoritesExplicitlySet: false,
  pinnedDays: [],
  compareSpeciesIds: ['pike', 'perch', 'dace'],
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
