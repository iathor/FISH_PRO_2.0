/**
 * @file config.js
 * @description Конфигурация приложения, слои карт и адаптивные справочники снастей и сезонных наживок
 */

export const APP_VERSION = '2.0.1';
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
  const fid = fish?.id || '';
  const isCold = waterTemp <= 10.5;

  if (iceState === 'ice_safe' || (method && method.startsWith('winter_'))) {
    if (method === 'winter_livebait') {
      if (['zander', 'volga_zander', 'burbot'].includes(fid)) {
        return [
          'Живец придонный: пескарь / уклейка / тюлька',
          'Живец: ёрш обыкновенный (на налима и судака)',
          'Живец: мелкая плотвичка',
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
        'Подвеска с мотылём и светонакопительным бисером',
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
      if (['perch', 'rotan', 'grayling', 'trout', 'lenok'].includes(fid)) {
        return [
          'Балансир 35–50 мм (окунёвый / кислотник)',
          'Зимняя вертикальная блесна с тройником-каплей',
          'Блесна с цепочкой и подсадкой мотыля / глаза'
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
        'Чёртик / «коза» в тандеме (пассивная проводка)',
        'Мормыш (живой бокоплав)'
      ];
    }
    return [
      'Мотыль крупный свежий (1–3 личинки)',
      'Безнасадка: гвоздешарик / гвоздекубик',
      'Безнасадка: вольфрамовый чёртик / уралка',
      'Мормыш (живой гаммарус / бормаш)',
      'Опарыш / личинка репейной моли'
    ];
  }

  const isPred = fish && fish.type === 'predator';
  if (method === 'spin_jig') {
    if (!isPred) {
      return [
        'Микросиликон пассивный 1–1.8 дюйма (имитация личинки)',
        'Искусственный мотыль Berkley на лёгкой джиг-риг оснастке',
        'Микротвистер 1.5 дюйма'
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

  if (method === 'spin_micro') {
    if (isCold) {
      return [
        'Пассивный слаг 1–1.5 дюйма (Polaris / Tant) на паузе до 4 сек',
        'Мормышка 0.3–0.8 г с искусственным мотылём',
        'Микроколебалка 1.2–2.2 г медленной проводкой у дна',
        'Микрорачок на оснастке джиг-риг 1.5–3 г'
      ];
    }
    return [
      'Активный микротвистер / виброхвост 1.2–2 дюйма',
      'Вращающаяся блесна (вертушка №00–№1)',
      'Микроколебалка 1.5–3.5 г в толще воды',
      'Микрокрэнк / уокер 28–38 мм (поверхностный бой)',
      'Мормышка с подсадкой силиконового опарыша'
    ];
  }

  if (method === 'spin_lure') {
    if (['asp', 'sky_gazer', 'chekhon'].includes(fid)) {
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
    if (['chub', 'ide', 'trout', 'brown_trout', 'rainbow_trout', 'grayling', 'lenok'].includes(fid)) {
      return isCold ? [
        'Тонущий воблер-минноу 40–55 мм с паузами в приямках',
        'Колеблющаяся блесна 2.5–5 г у дна',
        'Вращающаяся блесна №1–№2 с утяжелённым сердечником'
      ] : [
        'Воблер-крэнк (SSR/SR) и имитации майского жука / кузнечика',
        'Вращающаяся блесна №1–№3 на снос по струе',
        'Микроколебалка 2–5 г',
        'Ночная поверхностная мышь (таймень / ленок)'
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
      'Колеблющаяся блесна 10–22 г вдоль травы',
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
        'Пылящая карповая каша в пружине с голым крючком на всплытии'
      ];
    }
    if (['grass_carp'].includes(fid)) {
      return [
        'Сладкая кукуруза (цепочка на волосе с пенкой)',
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
        'Опарыш (белый / красный пинка)',
        'Кусочек навозного червя со специями (кориандр / чеснок)',
        'Ручейник (шитик)'
      ];
    }
    return [
      'Кукуруза сладкая консервированная (или с подсадкой опарыша)',
      'Пучок опарыша (3–5 шт.)',
      'Червь навозный / Дендробена',
      'Перловка распаренная с чесноком и жмыхом',
      'Пареный горох / мастырка / бойлы 10–14 мм'
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
        'Мелкий живец (верховка, уклейка, горчак) на живцовой поплавочке',
        'Навозный червь / пучок опарыша в проводку',
        'Мальковая резка / куриная шкурка (на ротана и окуня)'
      ];
    }
    if (isCold) {
      return [
        'Мотыль насадочный (1–2 личинки на крючке №16–18)',
        'Опарыш мелкий (пинка)',
        'Ручейник (шитик) / короед в проводку',
        'Небольшой кусочек навозного червя'
      ];
    }
    return [
      'Манная болтушка с анисом / ванилью',
      'Хлебный мякиш / прищип / корочка',
      'Кукуруза сладкая / пареная перловка',
      'Опарыш / навозный червь',
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
      'Имитация жука / кузнечика / осы (ловля взабродку)',
      'Мокрая мушка / эмерджер в поверхностной плёнке',
      'Мышь меховая поверхностная (сумеречный лов ленка и тайменя)'
    ];
  }

  if (method === 'sea_rock') {
    return isCold ? [
      'Съедобный червь Marukyu Power Isome на паузе у камней',
      'Светонакопительный пассивный слаг 1.5–2 дюйма (миis-джиг 1.5–3 г)',
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
    if (['chir', 'pizhyan', 'peled', 'cisco', 'whitefish', 'smelt', 'vendace', 'omul', 'omul_arctic'].includes(fid)) {
      return [
        { val: 'winter_cisco', text: 'Гирлянда мормышек (сиговые, корюшка)' },
        { val: 'winter_jig', text: 'Зимняя мормышка / Безмотылка (мотыль, бокоплав)' }
      ];
    }
    return [
      { val: 'winter_jig', text: 'Зимняя мормышка / Поплавок со льда (мотыль, мормыш)' },
      { val: 'winter_cisco', text: 'Тандем мормышек / Чёртик (подлёдная)' }
    ];
  }

  // Open water
  const list = [];
  const isPred = fish && fish.type === 'predator';

  if (isSea) {
    if (['flounder', 'starry_flounder', 'turbot', 'plaice', 'halibut', 'wolffish', 'anglerfish'].includes(fid)) {
      list.push({ val: 'sea_surf', text: 'Береговая морская донка (серфкастинг со дна)' });
      list.push({ val: 'sea_boat', text: 'Морской отвесный лов с лодки / катера' });
      list.push({ val: 'sea_rock', text: 'Прибрежный морской джиг (тирольская палочка)' });
      return list;
    }
    if (['cod', 'haddock', 'saithe', 'walleye_pollock'].includes(fid)) {
      list.push({ val: 'sea_boat', text: 'Морской отвесный лов с катера (пилькер, самодур)' });
      list.push({ val: 'sea_surf', text: 'Береговая морская донка' });
      list.push({ val: 'sea_rock', text: 'Морской береговой спиннинг' });
      return list;
    }
    if (isPred) {
      list.push({ val: 'sea_rock', text: 'Морская прибрежная ловля (рокфишинг, пилькер, бомбарда)' });
      list.push({ val: 'sea_surf', text: 'Береговая морская донка (серфкастинг)' });
      list.push({ val: 'sea_boat', text: 'Морской лов с лодки / самодур' });
      list.push({ val: 'spin_lure', text: 'Спиннинг: Морские блёсны и воблеры' });
    } else {
      list.push({ val: 'sea_surf', text: 'Береговая морская донка (на нереиса с пенопластом)' });
      list.push({ val: 'sea_rock', text: 'Лёгкий рокфишинг / поплавок у камней' });
      list.push({ val: 'float', text: 'Поплавочная удочка / Бомбарда' });
    }
    return list;
  }

  if (isPred) {
    if (['zander', 'volga_zander'].includes(fid)) {
      list.push({ val: 'spin_jig', text: 'Спиннинг джиговый: Ступенчатая проводка у дна (10–42 г)' });
      list.push({ val: 'spin_lure', text: 'Спиннинг: Глубоководные воблеры и раттлины' });
      list.push({ val: 'bottom', text: 'Донная снасть на живца / нарезку рыбы' });
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
      list.push({ val: 'spin_micro', text: 'Ультралайт: Микроколебалки и мелкие вертушки (1–6 г)' });
      list.push({ val: 'fly', text: 'Нахлыст / Бомбарда с сухой мушкой или жуком' });
      list.push({ val: 'float', text: 'Поплавочная удочка в проводку (кузнечик, вишня, корка)' });
      return list;
    }
    if (['perch', 'rotan'].includes(fid)) {
      if (isCold) {
        list.push({ val: 'spin_micro', text: 'Микроджиг / Отводной поводок на паузе (1–6 г)' });
        list.push({ val: 'spin_jig', text: 'Спиннинг джиговый по бровкам (6–16 г)' });
        list.push({ val: 'float', text: 'Поплавочная удочка / Боковой кивок с червём или мальком' });
        list.push({ val: 'spin_lure', text: 'Спиннинг: Тонущие воблеры и раттлины' });
      } else {
        list.push({ val: 'spin_micro', text: 'Спиннинг лёгкий: Микроджиг / Мормышинг (0.5–5 г)' });
        list.push({ val: 'spin_lure', text: 'Спиннинг: Вертушки №1–№2, тейл-спиннеры, попперы' });
        list.push({ val: 'float', text: 'Поплавочная удочка с червём / мальком' });
        list.push({ val: 'spin_jig', text: 'Спиннинг джиговый / Отводной поводок' });
      }
      return list;
    }
    if (['trout', 'brown_trout', 'rainbow_trout', 'grayling', 'baikal_grayling', 'lenok', 'salmon', 'pink_salmon', 'chum_salmon', 'coho_salmon', 'sockeye_salmon', 'chinook_salmon', 'cherry_salmon', 'char', 'dolly_varden'].includes(fid)) {
      if (['grayling', 'baikal_grayling', 'sockeye_salmon'].includes(fid)) {
        list.push({ val: 'fly', text: 'Нахлыст / Грузовой настрой с мушкой или сбирулино' });
        list.push({ val: 'spin_micro', text: 'Ультралайт спиннинг (вертушки №00–№2, микроколебалки)' });
        list.push({ val: 'float', text: 'Болонская удочка в проводку (ручейник, бормаш)' });
      } else {
        list.push({ val: 'spin_lure', text: 'Спиннинг: Тонущие воблеры, колебалки и вертушки' });
        list.push({ val: 'spin_micro', text: 'Ультралайт (форелевые микроколебалки и резина 1–4 г)' });
        list.push({ val: 'fly', text: 'Нахлыст / Стример и мушка' });
        list.push({ val: 'float', text: 'Поплавочная снасть в проводку / паста' });
      }
      return list;
    }
    if (['burbot', 'ruffe'].includes(fid)) {
      list.push({ val: 'bottom', text: 'Донная снасть (закидушка / пикер с червём, ершом или резкой)' });
      list.push({ val: 'spin_jig', text: 'Ступенчатый джиг у самого дна с долгими паузами' });
      list.push({ val: 'float', text: 'Поплавочная снасть у дна' });
      return list;
    }
    list.push({ val: 'spin_lure', text: 'Спиннинг: Блёсны и воблеры' });
    list.push({ val: 'spin_jig', text: 'Спиннинг джиговый' });
    list.push({ val: 'spin_micro', text: 'Спиннинг лёгкий: Микроджиг' });
    list.push({ val: 'bottom', text: 'Донная снасть' });
    return list;
  }

  // Peace fish (strictly characteristic tackles for each species group & season)
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

  if (['crucian', 'tench', 'tilapia'].includes(fid)) {
    if (isCold) {
      list.push({ val: 'bottom', text: 'Донная снасть: Лёгкий пикер / Фидер на глубине (мотыль, опарыш)' });
      list.push({ val: 'float', text: 'Чувствительная поплавочная удочка у дна' });
    } else {
      list.push({ val: 'float', text: 'Поплавочная удочка: Маховая у камыша и кувшинок' });
      list.push({ val: 'bottom', text: 'Донная снасть: Пикер / Флэт-кормушка («убийца карася»)' });
      list.push({ val: 'spin_micro', text: 'Мормышинг в толще прогретой воды (0.2–0.6 г)' });
    }
    return list;
  }

  if (['carp', 'bream', 'buffalo', 'black_carp', 'parabramis', 'tarpon_carp', 'white_bream', 'blue_bream', 'sopa', 'vimba', 'vobla', 'taran', 'kutum', 'barbel', 'sterlet'].includes(fid)) {
    list.push({ val: 'bottom', text: 'Донная снасть: Фидер / Пикер / Карповая кормушка' });
    list.push({ val: 'float', text: 'Поплавочная удочка: Матчевая / Болонская в проводку' });
    return list;
  }

  if (['roach', 'rudd', 'bleak', 'dace', 'gudgeon', 'chekhon', 'ide', 'undermouth', 'loach'].includes(fid)) {
    if (isCold && ['roach', 'ide', 'dace', 'chekhon', 'undermouth'].includes(fid)) {
      list.push({ val: 'bottom', text: 'Донная снасть: Деликатный пикер / Лёгкий фидер (поводок 0.10 мм)' });
      list.push({ val: 'float', text: 'Поплавочная удочка: Болонская / Маховая со дна' });
      list.push({ val: 'spin_micro', text: 'Мормышинг / Наноджиг (0.3–1 г)' });
    } else {
      list.push({ val: 'float', text: 'Поплавочная удочка: Маховая / Болонская в проводку' });
      list.push({ val: 'bottom', text: 'Донная снасть: Пикер / Лёгкий фидер' });
      list.push({ val: 'spin_micro', text: 'Мормышинг (сверхлёгкая снасть с мормышкой)' });
    }
    if (['chekhon', 'ide', 'dace', 'rudd', 'bleak'].includes(fid)) {
      list.push({ val: 'fly', text: 'Нахлыст / Ловля на мушку и плавающую бомбарду' });
    }
    return list;
  }

  if (['chir', 'pizhyan', 'peled', 'cisco', 'tugun', 'whitefish', 'vendace', 'broad_whitefish', 'omul', 'omul_arctic', 'valek'].includes(fid)) {
    if (isCold && ['chir', 'pizhyan', 'whitefish', 'broad_whitefish', 'valek'].includes(fid)) {
      list.push({ val: 'bottom', text: 'Донная снасть / Фидер по ямам (мотыль, бокоплав, ручейник)' });
      list.push({ val: 'float', text: 'Поплавочная удочка в проводку / Сбирулино' });
      list.push({ val: 'fly', text: 'Нахлыст (огруженная нимфа у дна)' });
    } else {
      list.push({ val: 'float', text: 'Поплавочная удочка в проводку / Сбирулино' });
      list.push({ val: 'bottom', text: 'Донная снасть / Фидер с животной насадкой' });
      list.push({ val: 'fly', text: 'Нахлыст (нимфа / сухая мушка)' });
    }
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
