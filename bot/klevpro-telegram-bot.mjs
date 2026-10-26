/**
 * @file bot/cloudflare-worker-bot.js
 * @description Автономная бессерверная (Serverless Webhook) версия бота @KlevProClubBot (Ревизия 2.0.166)
 * для круглосуточной бесплатной работы 24/7 на Cloudflare Workers.
 *
 * Что нового в Ревизии 2.0.166:
 * 1. Полный ихтиологический атлас всех 115 видов рыб РФ со всеми народными названиями и склонениями
 *    (барабуля/султанка, чехонь/сабля, сырок/пелядь, щокур/чир, пыжьян, тугун/манерка, сорога/чебак, берш, калкан, луфарь, смарида, скорпена, горбуша, кижуч, чавыча и все остальные 115 видов).
 * 2. Полная база 680+ городов, райцентров, посёлков и сёл РФ (включая разграничение одноимённых населённых пунктов по региону, например «Мишкино Башкортостан» vs «Мишкино Курганская обл.»).
 * 3. Полная база 280+ рек, озёр, водохранилищ, лиманов и бухт РФ (включая озеро Негито, Ямбуто, Пякуто, р. Бирь, Аслыкуль, Кандрыкуль, Павловское вдхр., Сургутская ГРЭС и др.) с определением по типу и названию водоёма («озеро Негито», «река Пур», «Павловское вдхр»).
 * 4. Определение полного списка рыб по посёлку/водоёму с учётом бассейна, солёности и типа водоёма (12+ активных видов водоёма + 8 инлайн-кнопок быстрого переключения в 2 ряда).
 * 5. Исключена путаница при онлайн-геокодинге (например, «Мишкино озеро карась» больше не превращается в алтайский пункт «Мишкино озеро», а корректно распознаёт п. Мишкино + биотоп «Озеро / Старица» + рыбу «Карась»).
 */

const rateBuckets = new Map();

function checkWorkerRateLimit(userId, isGeo = false) {
  const now = Date.now();
  const key = String(userId || 'anon');
  let b = rateBuckets.get(key);
  if (!b || now - b.start >= 60000) {
    b = { start: now, total: 0, geo: 0 };
    rateBuckets.set(key, b);
  }
  b.total += 1;
  if (isGeo) b.geo += 1;
  if (b.total > 24) return false;
  if (isGeo && b.geo > 8) return false;
  return true;
}

const BASIN_NAMES = {
  black_azov: 'Черноморско-Азовский бассейн',
  baltic: 'Балтийский морской бассейн',
  barents_white: 'Баренцево-Беломорский арктический бассейн',
  nw_karelia: 'Ладожско-Онежский и Карельский бассейн',
  pacific_sea: 'Тихоокеанский бассейн',
  amur: 'Амурский пресноводный бассейн',
  baikal: 'Байкало-Ангарский бассейн',
  yenisei_lena: 'Енисейско-Ленский бассейн',
  arctic_ob_taz: 'Обь-Тазовский северный бассейн (ЯНАО / ХМАО / Обь / Иртыш)',
  euro_west: 'Днепровско-Донской бассейн',
  volga_caspian: 'Волжско-Каспийский бассейн (Волга / Кама / Белая / Урал)'
};

const REGIONAL_SIGNATURE_SPECIES = {
  arctic_ob_taz: ['burbot', 'peled', 'dace', 'pike', 'perch', 'chir', 'pizhyan', 'ide', 'roach', 'crucian', 'grayling', 'tugun', 'cisco', 'ruffe', 'smelt'],
  yenisei_lena: ['grayling', 'pike', 'perch', 'lenok', 'dace', 'peled', 'chir', 'pizhyan', 'tugun', 'valek', 'ide', 'roach', 'crucian', 'burbot', 'char'],
  volga_caspian: ['zander', 'pike', 'perch', 'bream', 'roach', 'crucian', 'carp', 'chub', 'asp', 'ide', 'chekhon', 'white_bream', 'catfish', 'volga_zander', 'dace', 'tench', 'rudd', 'bleak'],
  nw_karelia: ['pike', 'perch', 'zander', 'whitefish', 'grayling', 'trout', 'roach', 'bream', 'ide', 'dace', 'burbot', 'vendace', 'smelt', 'salmon'],
  barents_white: ['cod', 'salmon', 'trout', 'char', 'grayling', 'whitefish', 'pike', 'perch', 'dace', 'burbot', 'navaga', 'flounder', 'haddock', 'saithe', 'halibut'],
  baltic: ['zander', 'pike', 'perch', 'bream', 'roach', 'smelt', 'flounder', 'cod', 'garfish', 'vimba', 'white_bream', 'ide', 'dace', 'tench'],
  black_azov: ['horse_mackerel', 'red_mullet', 'garfish', 'mullet', 'bluefish', 'sea_bass', 'sea_bream', 'scorpionfish', 'turbot', 'flounder', 'goby', 'zander', 'carp', 'crucian', 'bream', 'taran', 'pike', 'perch', 'chub', 'brown_trout'],
  euro_west: ['pike', 'perch', 'zander', 'bream', 'crucian', 'carp', 'roach', 'chub', 'asp', 'ide', 'dace', 'tench', 'rudd', 'white_bream', 'catfish'],
  baikal: ['baikal_grayling', 'omul', 'lenok', 'pike', 'perch', 'dace', 'roach', 'ide', 'crucian', 'burbot', 'char', 'peled'],
  amur: ['pike', 'amur_pike', 'snakehead', 'sky_gazer', 'carp', 'crucian', 'amur_catfish', 'lenok', 'grayling', 'tarpon_carp', 'parabramis', 'grass_carp'],
  pacific_sea: ['coho_salmon', 'chum_salmon', 'pink_salmon', 'char', 'dolly_varden', 'cherry_salmon', 'chinook_salmon', 'sockeye_salmon', 'smelt', 'navaga', 'greenling', 'starry_flounder', 'halibut']
};

const WATER_TYPE_LABELS = {
  small_river: 'Река малая / средняя',
  big_river: 'Река большая / фарватер',
  quarry: 'Озеро глубокое / Водохранилище / Карьер',
  tundra_lake: 'Озеро / Старица / Пруд',
  cooling_reservoir: 'ГРЭС / Тёплый сброс',
  sea_gulf: 'Морской залив / Бухта / Лиман',
  open_sea: 'Открытое море / Шельф'
};

const BOT_FISH_CATALOG = [
  {
    "id": "pike",
    "name": "Щука",
    "group": "predator",
    "type": "predator",
    "habitat": "fresh",
    "legal": "free",
    "basins": [
      "arctic_ob_taz",
      "yenisei_lena",
      "baikal",
      "volga_caspian",
      "nw_karelia",
      "barents_white",
      "baltic",
      "euro_west",
      "black_azov",
      "amur",
      "pacific_sea"
    ],
    "waters": [
      "small_river",
      "big_river",
      "quarry",
      "tundra_lake",
      "cooling_reservoir",
      "sea_gulf"
    ],
    "optT": [
      8,
      16
    ],
    "tMinStop": 0.5,
    "coldBonus": 6,
    "monthActivity": [
      1,
      2,
      0,
      0,
      3,
      2,
      2,
      3,
      3,
      3,
      2,
      1
    ],
    "keywords": [
      "щук",
      "щучк",
      "травянк",
      "зубаст",
      "щурогай",
      "щурогайк",
      "шнурок",
      "щука",
      "щука травянка щурогайка карандаш крокодил мамка"
    ],
    "gear": "Спиннинг 7–32 г (воблеры-минноу 90–130 мм твичингом, колебалки, вертушки №3–5), джиг 10–36 г с виброхвостом 4–5 дюймов",
    "win": "06:30–10:00 и 16:30–20:00 (зорьки)"
  },
  {
    "id": "perch",
    "name": "Окунь речной",
    "group": "predator",
    "type": "predator",
    "habitat": "fresh",
    "legal": "free",
    "basins": [
      "arctic_ob_taz",
      "yenisei_lena",
      "baikal",
      "volga_caspian",
      "nw_karelia",
      "barents_white",
      "baltic",
      "euro_west",
      "black_azov"
    ],
    "waters": [
      "small_river",
      "big_river",
      "quarry",
      "tundra_lake",
      "cooling_reservoir",
      "sea_gulf"
    ],
    "optT": [
      10,
      18
    ],
    "tMinStop": 0.5,
    "coldBonus": 6,
    "monthActivity": [
      2,
      2,
      2,
      0,
      1,
      3,
      3,
      3,
      3,
      3,
      2,
      2
    ],
    "keywords": [
      "окун",
      "окушк",
      "горбач",
      "матросик",
      "полосат",
      "окунь речной",
      "окунь полосатый матросик горбач окушок"
    ],
    "gear": "Микроджиг и нано-джиг (0.5–5 г), отводной поводок, тейл-спиннеры, вертушки №1–3, небольшие крэнки и попперы, поплавочная удочка на червя или малька. Со льда — балансиры 35–55 мм, вертикальные блёсны с подвесным тройником-каплей, мормышка с мотылём и безмотылка.",
    "win": "06:30–10:00 и 16:30–20:00 (зорьки)"
  },
  {
    "id": "zander",
    "name": "Судак",
    "group": "predator",
    "type": "predator",
    "habitat": "fresh",
    "legal": "free",
    "basins": [
      "volga_caspian",
      "nw_karelia",
      "euro_west",
      "black_azov",
      "baltic",
      "arctic_ob_taz",
      "yenisei_lena"
    ],
    "waters": [
      "small_river",
      "big_river",
      "quarry",
      "cooling_reservoir",
      "sea_gulf"
    ],
    "optT": [
      12,
      20
    ],
    "tMinStop": 1,
    "coldBonus": 5,
    "monthActivity": [
      1,
      1,
      2,
      0,
      1,
      3,
      2,
      2,
      3,
      3,
      2,
      1
    ],
    "keywords": [
      "судак",
      "судач",
      "клыкаст",
      "судачок",
      "судак клыкастый напильник зандер"
    ],
    "gear": "Джиговый спиннинг быстрого строя (Fast/Extra-Fast) 12–45 г для просечки костистой пасти (поролон, мандула, узкие виброхвосты 3.5–5 дюймов), ночной твичинг воблеров-минноу на косах. Со льда — тяжёлые вибы (раттлины 70–95 мм) и судаковые блёсны с подсадкой тюльки.",
    "win": "06:30–10:00 и 16:30–20:00 (зорьки)"
  },
  {
    "id": "crucian",
    "name": "Карась серебряный / золотой",
    "group": "peace",
    "type": "peace",
    "habitat": "fresh",
    "legal": "free",
    "basins": [
      "arctic_ob_taz",
      "yenisei_lena",
      "baikal",
      "volga_caspian",
      "nw_karelia",
      "baltic",
      "euro_west",
      "black_azov",
      "amur",
      "pacific_sea"
    ],
    "waters": [
      "small_river",
      "big_river",
      "quarry",
      "tundra_lake",
      "cooling_reservoir"
    ],
    "optT": [
      16,
      24
    ],
    "tMinStop": 4,
    "coldBonus": -12,
    "monthActivity": [
      0,
      0,
      1,
      2,
      0,
      3,
      3,
      3,
      2,
      1,
      0,
      0
    ],
    "keywords": [
      "карас",
      "карасик",
      "лапоть",
      "бубыр",
      "карась серебряный",
      "золотой",
      "карась серебряный золотой буффало карасик пятак лапоть"
    ],
    "gear": "Нано-джиг и мормышинг (спиннинг XUL до 1.5–2 г, мормышка 0.2–0.6 г со слагом Tanta / Whitebait или искусственным мотылём), лёгкая маховая поплавочная удочка (поплавок 0.5–1.5 г), пикер и флэт-фидер («убийца карася»). Весной — животные насадки, летом — растительные и пряные ароматы (чеснок, анис, укроп).",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "carp",
    "name": "Карп / Сазан",
    "group": "peace",
    "type": "peace",
    "habitat": "fresh",
    "legal": "free",
    "basins": [
      "amur",
      "arctic_ob_taz",
      "baltic",
      "black_azov",
      "euro_west",
      "nw_karelia",
      "volga_caspian",
      "yenisei_lena"
    ],
    "waters": [
      "big_river",
      "cooling_reservoir",
      "quarry",
      "small_river",
      "tundra_lake"
    ],
    "optT": [
      18,
      25
    ],
    "tMinStop": 6,
    "coldBonus": -16,
    "monthActivity": [
      0,
      0,
      0,
      1,
      0,
      2,
      3,
      3,
      3,
      1,
      0,
      0
    ],
    "keywords": [
      "карп",
      "сазан",
      "карпик",
      "сазанчик",
      "зеркальный карп",
      "карп сазан карпуша зеркальный чешуйчатый"
    ],
    "gear": "Карповый бланк 3.5 lbs, донная кормушка, карповая оснастка",
    "win": "06:30–10:00 и 16:30–20:00 (зорьки)"
  },
  {
    "id": "bream",
    "name": "Лещ",
    "group": "peace",
    "type": "peace",
    "habitat": "fresh",
    "legal": "free",
    "basins": [
      "arctic_ob_taz",
      "baltic",
      "black_azov",
      "euro_west",
      "nw_karelia",
      "volga_caspian",
      "yenisei_lena"
    ],
    "waters": [
      "big_river",
      "cooling_reservoir",
      "quarry",
      "small_river",
      "tundra_lake"
    ],
    "optT": [
      14,
      20
    ],
    "tMinStop": 1.5,
    "coldBonus": -3,
    "monthActivity": [
      1,
      1,
      2,
      2,
      0,
      3,
      3,
      3,
      3,
      2,
      1,
      1
    ],
    "keywords": [
      "лещ",
      "подлещ",
      "подлещик",
      "леща",
      "лещу",
      "соплив",
      "лещ подлещик фанера лаврушка бронзовый"
    ],
    "gear": "Фидер 3.6–3.9 м, зимняя поплавочная удочка с мотылем",
    "win": "06:30–10:00 и 16:30–20:00 (зорьки)"
  },
  {
    "id": "roach",
    "name": "Плотва (Сорога / Чебак)",
    "group": "peace",
    "type": "peace",
    "habitat": "fresh",
    "legal": "free",
    "basins": [
      "arctic_ob_taz",
      "yenisei_lena",
      "baikal",
      "volga_caspian",
      "nw_karelia",
      "barents_white",
      "baltic",
      "euro_west",
      "black_azov"
    ],
    "waters": [
      "small_river",
      "big_river",
      "quarry",
      "tundra_lake",
      "cooling_reservoir",
      "sea_gulf"
    ],
    "optT": [
      12,
      19
    ],
    "tMinStop": 1,
    "coldBonus": -2,
    "monthActivity": [
      2,
      2,
      3,
      0,
      2,
      3,
      3,
      3,
      3,
      2,
      2,
      2
    ],
    "keywords": [
      "плотв",
      "сорог",
      "сорожк",
      "чебак",
      "серушк",
      "плотва",
      "сорога",
      "плотва сорога сорожка чебак плотвичка"
    ],
    "gear": "Поплавочная удочка (маховая, болонская, матчевая), пикер и фидер, мормышинг и нано-джиг (мормышка 0.2–0.6 г с искусственным мотылём, опарышем или вайтбейтом на плавном каче и зуде). Зимой — безмотылка (гвоздешарик, гвоздекубик, чёртик) и поплавочная оснастка с мотылём.",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "catfish",
    "name": "Сом обыкновенный",
    "group": "predator",
    "type": "predator",
    "habitat": "fresh",
    "legal": "free",
    "basins": [
      "baltic",
      "black_azov",
      "euro_west",
      "volga_caspian"
    ],
    "waters": [
      "big_river",
      "cooling_reservoir",
      "quarry",
      "small_river"
    ],
    "optT": [
      18,
      26
    ],
    "tMinStop": 8,
    "coldBonus": -17,
    "monthActivity": [
      0,
      0,
      0,
      1,
      0,
      2,
      3,
      3,
      2,
      1,
      0,
      0
    ],
    "keywords": [
      "сом",
      "сома",
      "сому",
      "сомик европейск",
      "усатый",
      "сом обыкновенный",
      "сом усатый соменок лягушатник"
    ],
    "gear": "Ловля с квоком, донка со шнуром #5.0 PE, живец или пучок выползков.",
    "win": "18:30–02:30 (сумерки и ночь)"
  },
  {
    "id": "burbot",
    "name": "Налим",
    "group": "predator",
    "type": "predator",
    "habitat": "fresh",
    "legal": "free",
    "basins": [
      "amur",
      "arctic_ob_taz",
      "baikal",
      "baltic",
      "barents_white",
      "black_azov",
      "euro_west",
      "nw_karelia",
      "volga_caspian",
      "yenisei_lena"
    ],
    "waters": [
      "big_river",
      "quarry",
      "small_river",
      "tundra_lake"
    ],
    "optT": [
      0,
      8
    ],
    "tMinStop": -1,
    "coldBonus": 21,
    "monthActivity": [
      0,
      0,
      3,
      2,
      1,
      0,
      0,
      0,
      2,
      3,
      3,
      0
    ],
    "keywords": [
      "налим",
      "меньк",
      "меnek",
      "треска пресноводн",
      "налим мень треска пресноводная"
    ],
    "gear": "Тяжелая блесна-стукалка, зимняя донка с ершом.",
    "win": "18:30–02:30 (сумерки и ночь)"
  },
  {
    "id": "tench",
    "name": "Линь",
    "group": "peace",
    "type": "peace",
    "habitat": "fresh",
    "legal": "free",
    "basins": [
      "arctic_ob_taz",
      "baltic",
      "black_azov",
      "euro_west",
      "nw_karelia",
      "volga_caspian",
      "yenisei_lena"
    ],
    "waters": [
      "big_river",
      "cooling_reservoir",
      "quarry",
      "small_river",
      "tundra_lake"
    ],
    "optT": [
      18,
      24
    ],
    "tMinStop": 6,
    "coldBonus": -16,
    "monthActivity": [
      0,
      0,
      0,
      1,
      2,
      0,
      3,
      3,
      2,
      0,
      0,
      0
    ],
    "keywords": [
      "линь",
      "линя",
      "линю",
      "линек",
      "линь линек царская рыба"
    ],
    "gear": "Поплавочная глухая оснастка, пучок червей с творогом",
    "win": "06:30–10:00 и 16:30–20:00 (зорьки)"
  },
  {
    "id": "chub",
    "name": "Голавль",
    "group": "predator",
    "type": "predator",
    "habitat": "fresh",
    "legal": "free",
    "basins": [
      "baltic",
      "black_azov",
      "euro_west",
      "nw_karelia",
      "volga_caspian"
    ],
    "waters": [
      "big_river",
      "quarry",
      "small_river"
    ],
    "optT": [
      14,
      21
    ],
    "tMinStop": 3,
    "coldBonus": -9,
    "monthActivity": [
      0,
      0,
      1,
      2,
      0,
      3,
      3,
      3,
      3,
      2,
      0,
      0
    ],
    "keywords": [
      "голавл",
      "лобаст",
      "голавль",
      "голавль лобастый голавлик"
    ],
    "gear": "Ультралайт, воблеры-жуки, микроколебалки.",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "asp",
    "name": "Жерех",
    "group": "predator",
    "type": "predator",
    "habitat": "fresh",
    "legal": "free",
    "basins": [
      "baltic",
      "black_azov",
      "euro_west",
      "nw_karelia",
      "volga_caspian"
    ],
    "waters": [
      "big_river",
      "cooling_reservoir",
      "quarry",
      "small_river"
    ],
    "optT": [
      15,
      22
    ],
    "tMinStop": 3,
    "coldBonus": -9,
    "monthActivity": [
      0,
      0,
      1,
      0,
      2,
      3,
      3,
      3,
      3,
      2,
      1,
      0
    ],
    "keywords": [
      "жерех",
      "шереспер",
      "конь речн",
      "жерех шереспер конь речной"
    ],
    "gear": "Дальнобойный спиннинг, тяжёлые морские блёсны, кастмастеры.",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "grayling",
    "name": "Хариус сибирский / европейский",
    "group": "predator",
    "type": "predator",
    "habitat": "fresh",
    "legal": "license",
    "basins": [
      "amur",
      "arctic_ob_taz",
      "baikal",
      "barents_white",
      "nw_karelia",
      "pacific_sea",
      "volga_caspian",
      "yenisei_lena"
    ],
    "waters": [
      "big_river",
      "quarry",
      "small_river",
      "tundra_lake"
    ],
    "optT": [
      6,
      14
    ],
    "tMinStop": 0,
    "coldBonus": 14,
    "monthActivity": [
      1,
      1,
      2,
      2,
      0,
      0,
      3,
      3,
      3,
      3,
      2,
      1
    ],
    "keywords": [
      "хариус",
      "харьк",
      "харюз",
      "сибирский хариус",
      "европейский хариус",
      "хариус сибирский",
      "европейский",
      "хариус харюзок парусник сибирский европейский"
    ],
    "gear": "Нахлыст, сбирулино, вертушки #00–#2.",
    "win": "06:30–10:00 и 16:30–20:00 (зорьки)"
  },
  {
    "id": "whitefish",
    "name": "Сиг проходной / озерный",
    "group": "whitefish",
    "type": "peace",
    "habitat": "fresh",
    "legal": "free",
    "basins": [
      "arctic_ob_taz",
      "baltic",
      "barents_white",
      "nw_karelia",
      "volga_caspian"
    ],
    "waters": [
      "big_river",
      "quarry",
      "sea_gulf",
      "small_river",
      "tundra_lake"
    ],
    "optT": [
      4,
      12
    ],
    "tMinStop": 0,
    "coldBonus": 15,
    "monthActivity": [
      2,
      2,
      2,
      2,
      3,
      3,
      2,
      2,
      0,
      0,
      3,
      3
    ],
    "keywords": [
      "сиг",
      "сига",
      "сигу",
      "сижок",
      "проходной сиг",
      "озерный сиг",
      "сиг проходной",
      "озерный",
      "сиг сижок озерный проходной"
    ],
    "gear": "Зимняя гирлянда мормышек, блесны с цепочкой",
    "win": "06:30–10:00 и 16:30–20:00 (зорьки)"
  },
  {
    "id": "flounder",
    "name": "Камбала-глосса / речная",
    "group": "sea",
    "type": "predator",
    "habitat": "sea",
    "legal": "free",
    "basins": [
      "baltic",
      "barents_white",
      "black_azov",
      "pacific_sea"
    ],
    "waters": [
      "open_sea",
      "sea_gulf",
      "big_river",
      "small_river"
    ],
    "optT": [
      6,
      15
    ],
    "tMinStop": 1,
    "coldBonus": 9,
    "monthActivity": [
      2,
      1,
      2,
      2,
      3,
      3,
      3,
      3,
      3,
      3,
      2,
      2
    ],
    "keywords": [
      "камбал",
      "глосс",
      "речная камбал",
      "камбала-глосса",
      "речная"
    ],
    "gear": "Береговое морское удилище, морской червь (нереис), шумовые бусины.",
    "win": "В течение всего дня (пик 08:00–16:00)"
  },
  {
    "id": "mullet",
    "name": "Пеленгас / Лобан",
    "group": "sea",
    "type": "peace",
    "habitat": "sea",
    "legal": "free",
    "basins": [
      "black_azov",
      "pacific_sea"
    ],
    "waters": [
      "sea_gulf",
      "big_river",
      "small_river"
    ],
    "optT": [
      14,
      24
    ],
    "tMinStop": 6,
    "coldBonus": -12,
    "monthActivity": [
      0,
      0,
      1,
      2,
      3,
      2,
      2,
      3,
      3,
      3,
      1,
      0
    ],
    "keywords": [
      "кефал",
      "пеленгас",
      "пиленгас",
      "лобан",
      "сингил",
      "остронос"
    ],
    "gear": "Береговая морская донка, чашечный монтаж под нереиса.",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "sea_bass",
    "name": "Морской окунь (Смарида / Рокфиш)",
    "group": "sea",
    "type": "predator",
    "habitat": "sea",
    "legal": "free",
    "basins": [
      "barents_white",
      "black_azov",
      "pacific_sea"
    ],
    "waters": [
      "open_sea",
      "sea_gulf"
    ],
    "optT": [
      8,
      16
    ],
    "tMinStop": 0.5,
    "coldBonus": 11,
    "monthActivity": [
      1,
      1,
      2,
      2,
      3,
      3,
      3,
      3,
      3,
      2,
      1,
      1
    ],
    "keywords": [
      "смарид",
      "морской окун",
      "окунь морск",
      "чуларк",
      "морской окунь",
      "смарида",
      "рокфиш"
    ],
    "gear": "Морская прибрежная ловля, отводной поводок, креатуры и светонакопительный силикон.",
    "win": "06:30–10:00 и 16:30–20:00 (зорьки)"
  },
  {
    "id": "garfish",
    "name": "Сарган",
    "group": "sea",
    "type": "predator",
    "habitat": "sea",
    "legal": "free",
    "basins": [
      "baltic",
      "black_azov"
    ],
    "waters": [
      "open_sea",
      "sea_gulf"
    ],
    "optT": [
      14,
      22
    ],
    "tMinStop": 8,
    "coldBonus": -10,
    "monthActivity": [
      0,
      0,
      0,
      1,
      2,
      3,
      3,
      3,
      3,
      3,
      1,
      0
    ],
    "keywords": [
      "сарган",
      "игла морск"
    ],
    "gear": "Плавающая бомбарда, поводок 1.5–2 м, шелковая нить.",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "anglerfish",
    "name": "Морской чёрт (Удильщик)",
    "group": "sea",
    "type": "predator",
    "habitat": "sea",
    "legal": "free",
    "basins": [
      "baltic",
      "barents_white"
    ],
    "waters": [
      "open_sea"
    ],
    "optT": [
      2,
      8
    ],
    "tMinStop": 1,
    "coldBonus": 11,
    "monthActivity": [
      2,
      2,
      2,
      2,
      2,
      2,
      2,
      2,
      2,
      2,
      2,
      2
    ],
    "keywords": [
      "морской черт",
      "удильщик"
    ],
    "gear": "Тяжелый бортовой джиг со дна, крупный виброхвост с филе рыбы.",
    "win": "18:30–02:30 (сумерки и ночь)"
  },
  {
    "id": "halibut",
    "name": "Палтус синекорый / белокорый",
    "group": "sea",
    "type": "predator",
    "habitat": "sea",
    "legal": "license",
    "basins": [
      "barents_white",
      "pacific_sea"
    ],
    "waters": [
      "open_sea"
    ],
    "optT": [
      0,
      7
    ],
    "tMinStop": -0.5,
    "coldBonus": 16,
    "monthActivity": [
      2,
      2,
      3,
      3,
      3,
      2,
      2,
      3,
      3,
      3,
      2,
      2
    ],
    "keywords": [
      "палтус",
      "палтус синекорый",
      "белокорый"
    ],
    "gear": "Морское удилище 30–50 lbs, виброхвосты 300–500 г.",
    "win": "06:30–10:00 и 16:30–20:00 (зорьки)"
  },
  {
    "id": "horse_mackerel",
    "name": "Ставрида",
    "group": "sea",
    "type": "predator",
    "habitat": "sea",
    "legal": "free",
    "basins": [
      "baltic",
      "black_azov"
    ],
    "waters": [
      "open_sea",
      "sea_gulf"
    ],
    "optT": [
      15,
      23
    ],
    "tMinStop": 8,
    "coldBonus": -14,
    "monthActivity": [
      0,
      0,
      0,
      1,
      2,
      3,
      3,
      3,
      3,
      3,
      1,
      0
    ],
    "keywords": [
      "ставрид",
      "ставридк",
      "ставрида"
    ],
    "gear": "Лёгкий морской спиннинг, головки 1.5–3 г, ставка «самодур».",
    "win": "18:30–02:30 (сумерки и ночь)"
  },
  {
    "id": "sand_eel",
    "name": "Песчанка",
    "group": "sea",
    "type": "peace",
    "habitat": "sea",
    "legal": "free",
    "basins": [
      "baltic",
      "barents_white",
      "pacific_sea"
    ],
    "waters": [
      "sea_gulf"
    ],
    "optT": [
      3,
      12
    ],
    "tMinStop": 1,
    "coldBonus": 5,
    "monthActivity": [
      1,
      1,
      2,
      3,
      3,
      3,
      3,
      3,
      2,
      1,
      0,
      0
    ],
    "keywords": [
      "песчанк",
      "песчанка"
    ],
    "gear": "Ставка сабики с мелким люрексом. Деликатный спиннинг (нано-джиг 0.3–1 г, микроджиг), поплавочная и фидерная оснастка с флюорокарбоновым поводком.",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "ruffe",
    "name": "Ёрш обыкновенный",
    "group": "predator",
    "type": "predator",
    "habitat": "fresh",
    "legal": "free",
    "basins": [
      "amur",
      "arctic_ob_taz",
      "baikal",
      "baltic",
      "barents_white",
      "black_azov",
      "euro_west",
      "nw_karelia",
      "volga_caspian",
      "yenisei_lena"
    ],
    "waters": [
      "big_river",
      "cooling_reservoir",
      "quarry",
      "small_river",
      "tundra_lake"
    ],
    "optT": [
      4,
      14
    ],
    "tMinStop": 0,
    "coldBonus": 9,
    "monthActivity": [
      3,
      3,
      2,
      0,
      1,
      2,
      2,
      2,
      3,
      3,
      3,
      3
    ],
    "keywords": [
      "ерш",
      "ерша",
      "ершик",
      "носар",
      "ерш обыкновенный",
      "ерш ершик носарь королевский"
    ],
    "gear": "Мормышка с мотылем у самого дна. Деликатный спиннинг (нано-джиг 0.3–1 г, микроджиг), поплавочная и фидерная оснастка с флюорокарбоновым поводком.",
    "win": "В течение всего дня (пик 08:00–16:00)"
  },
  {
    "id": "trout",
    "name": "Кумжа / Ручьевая форель",
    "group": "predator",
    "type": "predator",
    "habitat": "fresh",
    "legal": "license",
    "basins": [
      "baltic",
      "barents_white",
      "black_azov",
      "nw_karelia"
    ],
    "waters": [
      "sea_gulf",
      "small_river",
      "big_river",
      "quarry"
    ],
    "optT": [
      6,
      14
    ],
    "tMinStop": 0.5,
    "coldBonus": 12,
    "monthActivity": [
      1,
      1,
      2,
      3,
      3,
      3,
      2,
      3,
      0,
      0,
      0,
      1
    ],
    "keywords": [
      "кумж",
      "форел",
      "пеструшк",
      "кумжа",
      "ручьевая форель",
      "кумжа форель ручьевая озерная пеструшка"
    ],
    "gear": "Речной ультралайт, тонущие узкотелые воблеры 45–60 мм.",
    "win": "06:30–10:00 и 16:30–20:00 (зорьки)"
  },
  {
    "id": "goby",
    "name": "Бычок-кругляк / мартовик",
    "group": "sea",
    "type": "predator",
    "habitat": "sea",
    "legal": "free",
    "basins": [
      "baltic",
      "black_azov",
      "volga_caspian"
    ],
    "waters": [
      "big_river",
      "sea_gulf",
      "small_river",
      "quarry"
    ],
    "optT": [
      10,
      20
    ],
    "tMinStop": 4,
    "coldBonus": -3,
    "monthActivity": [
      1,
      1,
      2,
      3,
      2,
      2,
      3,
      3,
      3,
      3,
      2,
      1
    ],
    "keywords": [
      "бычок",
      "бычка",
      "кругляк",
      "мартовик",
      "кнут",
      "бычок-кругляк"
    ],
    "gear": "Отводной поводок, донка, кусочки червя или мидии.",
    "win": "В течение всего дня (пик 08:00–16:00)"
  },
  {
    "id": "bleak",
    "name": "Уклейка",
    "group": "peace",
    "type": "peace",
    "habitat": "fresh",
    "legal": "free",
    "basins": [
      "arctic_ob_taz",
      "baltic",
      "black_azov",
      "euro_west",
      "nw_karelia",
      "volga_caspian"
    ],
    "waters": [
      "big_river",
      "cooling_reservoir",
      "quarry",
      "small_river",
      "tundra_lake"
    ],
    "optT": [
      14,
      22
    ],
    "tMinStop": 4,
    "coldBonus": -12,
    "monthActivity": [
      0,
      0,
      1,
      3,
      3,
      3,
      3,
      3,
      2,
      1,
      0,
      0
    ],
    "keywords": [
      "уклейк",
      "уклея",
      "селявк",
      "верховодк",
      "уклейка",
      "уклейка уклея себель шеклея"
    ],
    "gear": "Легкий мах 3–4 м, поплавок 0.3–0.5 г, мелкий опарыш",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "ide",
    "name": "Язь (Подъязок)",
    "group": "peace",
    "type": "peace",
    "habitat": "fresh",
    "legal": "free",
    "basins": [
      "arctic_ob_taz",
      "yenisei_lena",
      "baikal",
      "volga_caspian",
      "nw_karelia",
      "barents_white",
      "baltic",
      "euro_west",
      "black_azov"
    ],
    "waters": [
      "small_river",
      "big_river",
      "quarry",
      "tundra_lake",
      "cooling_reservoir",
      "sea_gulf"
    ],
    "optT": [
      12,
      19
    ],
    "tMinStop": 1,
    "coldBonus": 2,
    "monthActivity": [
      1,
      1,
      2,
      0,
      3,
      3,
      3,
      3,
      3,
      2,
      1,
      1
    ],
    "keywords": [
      "язь",
      "язя",
      "язю",
      "язем",
      "подъяз",
      "подъязок",
      "язь подъязок красноперый"
    ],
    "gear": "Спиннинг ультралайт и лайт (вертушки №1–3, воблеры-крэнки 35–50 мм, колебалки, мормышинг и микроджиг 1–4 г), фидер и донка, болонская удочка в проводку, нахлыст.",
    "win": "06:30–10:00 и 16:30–20:00 (зорьки)"
  },
  {
    "id": "sterlet",
    "name": "Стерлядь",
    "group": "sturgeon",
    "type": "peace",
    "habitat": "fresh",
    "legal": "license",
    "basins": [
      "arctic_ob_taz",
      "barents_white",
      "black_azov",
      "euro_west",
      "volga_caspian",
      "yenisei_lena"
    ],
    "waters": [
      "big_river",
      "quarry",
      "small_river"
    ],
    "optT": [
      12,
      20
    ],
    "tMinStop": 1,
    "coldBonus": 2,
    "monthActivity": [
      1,
      1,
      2,
      2,
      0,
      0,
      3,
      3,
      3,
      2,
      1,
      1
    ],
    "keywords": [
      "стерляд",
      "стерляжк",
      "чухоньк",
      "стерлядь",
      "стерлядь стерлядка чечуга"
    ],
    "gear": "Фидер с пучком червя или мотыля",
    "win": "18:30–02:30 (сумерки и ночь)"
  },
  {
    "id": "herring",
    "name": "Сельдь атлантическая / тихоокеанская",
    "group": "sea",
    "type": "peace",
    "habitat": "sea",
    "legal": "free",
    "basins": [
      "baltic",
      "barents_white",
      "pacific_sea"
    ],
    "waters": [
      "open_sea",
      "sea_gulf",
      "big_river"
    ],
    "optT": [
      4,
      12
    ],
    "tMinStop": 0.5,
    "coldBonus": 7,
    "monthActivity": [
      2,
      2,
      3,
      3,
      2,
      1,
      1,
      2,
      3,
      3,
      2,
      2
    ],
    "keywords": [
      "сельд",
      "селедк",
      "сельдь",
      "сельдь атлантическая",
      "тихоокеанская"
    ],
    "gear": "Ставка-самодур с мобискином и золотыми крючками.",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "mackerel",
    "name": "Скумбрия атлантическая",
    "group": "sea",
    "type": "predator",
    "habitat": "sea",
    "legal": "free",
    "basins": [
      "baltic",
      "barents_white",
      "black_azov"
    ],
    "waters": [
      "open_sea",
      "sea_gulf"
    ],
    "optT": [
      12,
      20
    ],
    "tMinStop": 7,
    "coldBonus": -10,
    "monthActivity": [
      0,
      0,
      0,
      1,
      2,
      3,
      3,
      3,
      3,
      2,
      0,
      0
    ],
    "keywords": [
      "скумбри",
      "скумбрия атлантическая"
    ],
    "gear": "Тяжёлые морские блёсны 20–40 г, ярусные оснастки с перьями.",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "cod",
    "name": "Атлантическая треска",
    "group": "sea",
    "type": "predator",
    "habitat": "sea",
    "legal": "free",
    "basins": [
      "baltic",
      "barents_white"
    ],
    "waters": [
      "open_sea",
      "sea_gulf"
    ],
    "optT": [
      1,
      8
    ],
    "tMinStop": -1,
    "coldBonus": 18,
    "monthActivity": [
      3,
      3,
      3,
      2,
      2,
      1,
      1,
      2,
      3,
      3,
      3,
      3
    ],
    "keywords": [
      "треск",
      "атлантическая треск",
      "пертуй",
      "атлантическая треска"
    ],
    "gear": "Тяжелый бортовой джиг, тяжёлые морские блёсны 200–500 г с октопусом.",
    "win": "06:30–10:00 и 16:30–20:00 (зорьки)"
  },
  {
    "id": "smelt",
    "name": "Корюшка европейская / зубастая",
    "group": "sea",
    "type": "predator",
    "habitat": "sea",
    "legal": "free",
    "basins": [
      "arctic_ob_taz",
      "baltic",
      "barents_white",
      "nw_karelia",
      "pacific_sea"
    ],
    "waters": [
      "big_river",
      "quarry",
      "sea_gulf",
      "small_river"
    ],
    "optT": [
      0,
      8
    ],
    "tMinStop": -1.5,
    "coldBonus": 21,
    "monthActivity": [
      3,
      3,
      3,
      2,
      1,
      0,
      0,
      0,
      1,
      2,
      3,
      3
    ],
    "keywords": [
      "корюшк",
      "зубар",
      "малоротк",
      "снеток",
      "корюшка европейская",
      "зубастая",
      "корюшка зубатка огуречник снетка снеток"
    ],
    "gear": "Кобылки, гирлянды светонакопительных мормышек.",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "salmon",
    "name": "Атлантический лосось (Сёмга)",
    "group": "predator",
    "type": "predator",
    "habitat": "fresh",
    "legal": "license",
    "basins": [
      "baltic",
      "barents_white",
      "nw_karelia"
    ],
    "waters": [
      "big_river",
      "sea_gulf",
      "small_river",
      "quarry"
    ],
    "optT": [
      6,
      14
    ],
    "tMinStop": 0.5,
    "coldBonus": 11,
    "monthActivity": [
      0,
      0,
      1,
      1,
      2,
      3,
      3,
      3,
      2,
      0,
      0,
      0
    ],
    "keywords": [
      "семг",
      "атлантический лосос",
      "атлантический лосось",
      "семга",
      "семга лосось атлантический лох тинда"
    ],
    "gear": "Двуручный нахлыст, лососевые колебалки 20–45 г.",
    "win": "06:30–10:00 и 16:30–20:00 (зорьки)"
  },
  {
    "id": "crayfish",
    "name": "Речной рак",
    "group": "peace",
    "type": "peace",
    "habitat": "fresh",
    "legal": "license",
    "basins": [
      "black_azov",
      "euro_west",
      "nw_karelia",
      "volga_caspian"
    ],
    "waters": [
      "quarry",
      "small_river"
    ],
    "optT": [
      15,
      22
    ],
    "tMinStop": 6,
    "coldBonus": -17,
    "monthActivity": [
      0,
      0,
      0,
      0,
      0,
      1,
      2,
      3,
      3,
      3,
      0,
      0
    ],
    "keywords": [
      "рак",
      "речной рак",
      "рака",
      "раки"
    ],
    "gear": "Разрешенные раколовки с рыбой или чесночным хлебом.",
    "win": "18:30–02:30 (сумерки и ночь)"
  },
  {
    "id": "crab",
    "name": "Краб прибрежный / каменный",
    "group": "sea",
    "type": "predator",
    "habitat": "sea",
    "legal": "license",
    "basins": [
      "barents_white",
      "black_azov",
      "pacific_sea"
    ],
    "waters": [
      "sea_gulf"
    ],
    "optT": [
      12,
      20
    ],
    "tMinStop": 2,
    "coldBonus": 2,
    "monthActivity": [
      1,
      1,
      1,
      2,
      0,
      0,
      3,
      3,
      3,
      3,
      2,
      1
    ],
    "keywords": [
      "краб",
      "каменный краб",
      "краба",
      "краб прибрежный",
      "каменный"
    ],
    "gear": "Подъемник-хватка с рыбной насадкой.",
    "win": "18:30–02:30 (сумерки и ночь)"
  },
  {
    "id": "king_crab",
    "name": "Камчатский краб",
    "group": "sea",
    "type": "predator",
    "habitat": "sea",
    "legal": "license",
    "basins": [
      "barents_white",
      "pacific_sea"
    ],
    "waters": [
      "open_sea"
    ],
    "optT": [
      0,
      6
    ],
    "tMinStop": -0.5,
    "coldBonus": 14,
    "monthActivity": [
      2,
      2,
      2,
      0,
      0,
      2,
      3,
      3,
      3,
      3,
      2,
      2
    ],
    "keywords": [
      "камчатский краб"
    ],
    "gear": "Специализированная крабовая ловушка с сельдью.",
    "win": "В течение всего дня (пик 08:00–16:00)"
  },
  {
    "id": "silver_carp",
    "name": "Толстолобик белый / пестрый",
    "group": "peace",
    "type": "peace",
    "habitat": "fresh",
    "legal": "introduced",
    "basins": [
      "black_azov",
      "euro_west",
      "volga_caspian"
    ],
    "waters": [
      "big_river",
      "cooling_reservoir",
      "quarry"
    ],
    "optT": [
      20,
      28
    ],
    "tMinStop": 8,
    "coldBonus": -19,
    "monthActivity": [
      0,
      0,
      0,
      0,
      1,
      3,
      3,
      3,
      2,
      0,
      0,
      0
    ],
    "keywords": [
      "толстолоб",
      "толстолобик",
      "толстолобик белый",
      "пестрый",
      "толстолобик белый пестрый толстолоб"
    ],
    "gear": "Специальная оснастка «палочка толстолобика» с прессованным планктоном.",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "grass_carp",
    "name": "Белый амур",
    "group": "peace",
    "type": "peace",
    "habitat": "fresh",
    "legal": "introduced",
    "basins": [
      "amur",
      "black_azov",
      "euro_west",
      "volga_caspian"
    ],
    "waters": [
      "big_river",
      "cooling_reservoir",
      "quarry"
    ],
    "optT": [
      18,
      26
    ],
    "tMinStop": 7,
    "coldBonus": -17,
    "monthActivity": [
      0,
      0,
      0,
      0,
      1,
      3,
      3,
      3,
      2,
      0,
      0,
      0
    ],
    "keywords": [
      "белый амур",
      "амур бел",
      "белый амур травяной карп"
    ],
    "gear": "Мощный карповик, карповая оснастка, плавающий бойл, пучок травы.",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "channel_catfish",
    "name": "Сомик канальный",
    "group": "predator",
    "type": "predator",
    "habitat": "fresh",
    "legal": "introduced",
    "basins": [
      "black_azov",
      "euro_west",
      "volga_caspian"
    ],
    "waters": [
      "cooling_reservoir",
      "quarry"
    ],
    "optT": [
      18,
      28
    ],
    "tMinStop": 6,
    "coldBonus": -16,
    "monthActivity": [
      0,
      0,
      0,
      1,
      2,
      3,
      3,
      3,
      2,
      1,
      0,
      0
    ],
    "keywords": [
      "канальный сомик",
      "сомик канальн",
      "американский сомик",
      "сомик канальный",
      "сомик канальный американский"
    ],
    "gear": "Донка, фидер, печень птицы, креветка, пучок червей.",
    "win": "18:30–02:30 (сумерки и ночь)"
  },
  {
    "id": "tilapia",
    "name": "Тиляпия (нильская / мозамбикская)",
    "group": "peace",
    "type": "peace",
    "habitat": "fresh",
    "legal": "introduced",
    "basins": [
      "black_azov",
      "euro_west",
      "volga_caspian"
    ],
    "waters": [
      "cooling_reservoir"
    ],
    "optT": [
      22,
      32
    ],
    "tMinStop": 14,
    "coldBonus": -23,
    "monthActivity": [
      0,
      0,
      0,
      0,
      1,
      3,
      3,
      3,
      3,
      1,
      0,
      0
    ],
    "keywords": [
      "тиляпи",
      "теляпи",
      "тиляпия",
      "нильская",
      "мозамбикская",
      "тиляпия телапия нильская"
    ],
    "gear": "Легкий поплавок, фидер, кукуруза, червь, тесто с аттрактантами",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "rotan",
    "name": "Ротан (Головешка)",
    "group": "predator",
    "type": "predator",
    "habitat": "fresh",
    "legal": "free",
    "basins": [
      "amur",
      "arctic_ob_taz",
      "baikal",
      "baltic",
      "black_azov",
      "euro_west",
      "nw_karelia",
      "pacific_sea",
      "volga_caspian",
      "yenisei_lena"
    ],
    "waters": [
      "big_river",
      "cooling_reservoir",
      "quarry",
      "small_river",
      "tundra_lake"
    ],
    "optT": [
      12,
      22
    ],
    "tMinStop": -0.5,
    "coldBonus": 4,
    "monthActivity": [
      2,
      2,
      3,
      3,
      2,
      3,
      3,
      3,
      3,
      3,
      2,
      2
    ],
    "keywords": [
      "ротан",
      "головешк",
      "бычок прудов",
      "головешка",
      "ротан головешка бычок болотный"
    ],
    "gear": "Зимняя блесна с подсадкой куриной кожи, микроджиг.",
    "win": "В течение всего дня (пик 08:00–16:00)"
  },
  {
    "id": "buffalo",
    "name": "Буффало (большеротый)",
    "group": "peace",
    "type": "peace",
    "habitat": "fresh",
    "legal": "introduced",
    "basins": [
      "black_azov",
      "volga_caspian"
    ],
    "waters": [
      "cooling_reservoir",
      "quarry"
    ],
    "optT": [
      18,
      26
    ],
    "tMinStop": 7,
    "coldBonus": -17,
    "monthActivity": [
      0,
      0,
      0,
      1,
      2,
      3,
      3,
      3,
      2,
      1,
      0,
      0
    ],
    "keywords": [
      "буффало",
      "большеротый",
      "буффало большеротый карась американский"
    ],
    "gear": "Фидер, донная кормушка, распаренные злаки, бойлы",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "rainbow_trout",
    "name": "Форель радужная (Микижа)",
    "group": "predator",
    "type": "predator",
    "habitat": "fresh",
    "legal": "introduced",
    "basins": [
      "euro_west",
      "nw_karelia",
      "pacific_sea",
      "volga_caspian"
    ],
    "waters": [
      "cooling_reservoir",
      "quarry",
      "small_river"
    ],
    "optT": [
      10,
      18
    ],
    "tMinStop": 0.5,
    "coldBonus": 9,
    "monthActivity": [
      2,
      2,
      3,
      3,
      2,
      1,
      1,
      2,
      3,
      3,
      3,
      2
    ],
    "keywords": [
      "радужная форел",
      "микиж",
      "форель платник",
      "форель радужная",
      "микижа",
      "форель радужная микижа платник"
    ],
    "gear": "Прудовая форелевая снасть УЛ до 3.5 г, форелевая паста, микроколебалки.",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "russian_sturgeon",
    "name": "Осетр русский",
    "group": "sturgeon",
    "type": "peace",
    "habitat": "fresh",
    "legal": "redbook",
    "basins": [
      "black_azov",
      "volga_caspian"
    ],
    "waters": [
      "big_river",
      "sea_gulf"
    ],
    "optT": [
      14,
      22
    ],
    "tMinStop": 2,
    "coldBonus": -3,
    "monthActivity": [
      1,
      1,
      2,
      3,
      2,
      2,
      3,
      3,
      3,
      2,
      1,
      1
    ],
    "keywords": [
      "русский осетр",
      "осетр",
      "осетр русский",
      "осетр русский волжский каспийский"
    ],
    "gear": "Только искусственные платные водоемы.",
    "win": "18:30–02:30 (сумерки и ночь)"
  },
  {
    "id": "paddlefish",
    "name": "Веслонос",
    "group": "sturgeon",
    "type": "peace",
    "habitat": "fresh",
    "legal": "introduced",
    "basins": [
      "black_azov",
      "volga_caspian"
    ],
    "waters": [
      "cooling_reservoir",
      "quarry"
    ],
    "optT": [
      16,
      24
    ],
    "tMinStop": 5,
    "coldBonus": -14,
    "monthActivity": [
      0,
      0,
      0,
      1,
      2,
      3,
      3,
      3,
      2,
      1,
      0,
      0
    ],
    "keywords": [
      "веслонос",
      "веслонос американский осетр"
    ],
    "gear": "Специализированные прудовые снасти.",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "barbel",
    "name": "Усач (Марена)",
    "group": "peace",
    "type": "peace",
    "habitat": "fresh",
    "legal": "license",
    "basins": [
      "black_azov",
      "euro_west"
    ],
    "waters": [
      "big_river",
      "small_river"
    ],
    "optT": [
      14,
      22
    ],
    "tMinStop": 4,
    "coldBonus": -10,
    "monthActivity": [
      0,
      0,
      1,
      2,
      0,
      3,
      3,
      3,
      2,
      1,
      0,
      0
    ],
    "keywords": [
      "усач",
      "марен",
      "мирон",
      "марена",
      "усач марена мирон"
    ],
    "gear": "Мощный речной фидер, сырные насадки, пиявка, выползок",
    "win": "06:30–10:00 и 16:30–20:00 (зорьки)"
  },
  {
    "id": "white_bream",
    "name": "Густера",
    "group": "peace",
    "type": "peace",
    "habitat": "fresh",
    "legal": "free",
    "basins": [
      "arctic_ob_taz",
      "baltic",
      "black_azov",
      "euro_west",
      "nw_karelia",
      "volga_caspian"
    ],
    "waters": [
      "big_river",
      "cooling_reservoir",
      "quarry",
      "small_river",
      "tundra_lake"
    ],
    "optT": [
      14,
      20
    ],
    "tMinStop": 2,
    "coldBonus": -5,
    "monthActivity": [
      1,
      1,
      2,
      2,
      0,
      3,
      3,
      3,
      3,
      2,
      1,
      1
    ],
    "keywords": [
      "густер",
      "густерк",
      "тарашк",
      "ласкир речн",
      "густера",
      "густера густерка тарашка ласкирь речной"
    ],
    "gear": "Пикер, легкий фидер, мотыль с опарышем",
    "win": "06:30–10:00 и 16:30–20:00 (зорьки)"
  },
  {
    "id": "blue_bream",
    "name": "Синец",
    "group": "peace",
    "type": "peace",
    "habitat": "fresh",
    "legal": "free",
    "basins": [
      "baltic",
      "black_azov",
      "euro_west",
      "nw_karelia",
      "volga_caspian"
    ],
    "waters": [
      "big_river",
      "quarry",
      "small_river"
    ],
    "optT": [
      12,
      19
    ],
    "tMinStop": 2,
    "coldBonus": -7,
    "monthActivity": [
      1,
      1,
      2,
      2,
      0,
      3,
      3,
      3,
      2,
      2,
      1,
      1
    ],
    "keywords": [
      "синец",
      "синца",
      "синец сопа синец волжский"
    ],
    "gear": "Фидерная снасть с длинным поводком (до 1 м), опарыш",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "sopa",
    "name": "Белоглазка (Сопа)",
    "group": "peace",
    "type": "peace",
    "habitat": "fresh",
    "legal": "free",
    "basins": [
      "baltic",
      "black_azov",
      "euro_west",
      "volga_caspian"
    ],
    "waters": [
      "big_river",
      "quarry",
      "small_river"
    ],
    "optT": [
      10,
      18
    ],
    "tMinStop": 1.5,
    "coldBonus": -2,
    "monthActivity": [
      1,
      2,
      2,
      0,
      2,
      3,
      3,
      3,
      2,
      2,
      1,
      1
    ],
    "keywords": [
      "белоглазк",
      "сопа",
      "сопы",
      "клепец",
      "белоглазка",
      "белоглазка сопа клепец"
    ],
    "gear": "Речной фидер на тяжелых кормушках (80–120 г)",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "undermouth",
    "name": "Подуст волжский",
    "group": "peace",
    "type": "peace",
    "habitat": "fresh",
    "legal": "free",
    "basins": [
      "baltic",
      "black_azov",
      "euro_west",
      "volga_caspian"
    ],
    "waters": [
      "big_river",
      "quarry",
      "small_river"
    ],
    "optT": [
      12,
      19
    ],
    "tMinStop": 3,
    "coldBonus": -7,
    "monthActivity": [
      0,
      0,
      2,
      0,
      2,
      3,
      3,
      3,
      2,
      1,
      0,
      0
    ],
    "keywords": [
      "подуст",
      "чернобрюшк",
      "подуст волжский",
      "подуст чернобрюшка"
    ],
    "gear": "Проводочная болонская удочка, опарыш, мотыль",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "vimba",
    "name": "Рыбец (Сырть)",
    "group": "peace",
    "type": "peace",
    "habitat": "fresh",
    "legal": "license",
    "basins": [
      "baltic",
      "black_azov",
      "euro_west",
      "nw_karelia",
      "volga_caspian"
    ],
    "waters": [
      "big_river",
      "quarry",
      "sea_gulf",
      "small_river"
    ],
    "optT": [
      12,
      19
    ],
    "tMinStop": 2,
    "coldBonus": -3,
    "monthActivity": [
      1,
      1,
      3,
      2,
      0,
      2,
      3,
      3,
      3,
      2,
      1,
      1
    ],
    "keywords": [
      "рыбец",
      "сырть",
      "рыбца",
      "рыбец сырть подуст черноморский"
    ],
    "gear": "Донка, фидер, мотыль, червь, ракушка",
    "win": "06:30–10:00 и 16:30–20:00 (зорьки)"
  },
  {
    "id": "gudgeon",
    "name": "Пескарь обыкновенный",
    "group": "peace",
    "type": "peace",
    "habitat": "fresh",
    "legal": "free",
    "basins": [
      "amur",
      "arctic_ob_taz",
      "baikal",
      "baltic",
      "barents_white",
      "black_azov",
      "euro_west",
      "nw_karelia",
      "volga_caspian",
      "yenisei_lena"
    ],
    "waters": [
      "big_river",
      "quarry",
      "small_river",
      "tundra_lake"
    ],
    "optT": [
      12,
      20
    ],
    "tMinStop": 3,
    "coldBonus": -7,
    "monthActivity": [
      1,
      1,
      2,
      2,
      3,
      3,
      3,
      3,
      2,
      1,
      0,
      0
    ],
    "keywords": [
      "пескар",
      "пескарик",
      "бубырь",
      "пескарь обыкновенный",
      "пескарь пескарик бубырь"
    ],
    "gear": "Легкая поплавочная снасть, мелкий червь",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "loach",
    "name": "Вьюн обыкновенный",
    "group": "peace",
    "type": "peace",
    "habitat": "fresh",
    "legal": "free",
    "basins": [
      "amur",
      "arctic_ob_taz",
      "baikal",
      "baltic",
      "barents_white",
      "black_azov",
      "euro_west",
      "nw_karelia",
      "volga_caspian",
      "yenisei_lena"
    ],
    "waters": [
      "big_river",
      "quarry",
      "small_river",
      "tundra_lake"
    ],
    "optT": [
      14,
      22
    ],
    "tMinStop": 2,
    "coldBonus": -10,
    "monthActivity": [
      0,
      0,
      1,
      2,
      3,
      3,
      3,
      3,
      2,
      1,
      0,
      0
    ],
    "keywords": [
      "вьюн",
      "пискун",
      "вьюн обыкновенный",
      "вьюн пискун щиповка"
    ],
    "gear": "Поплавок у дна, мотыль, кусочек червя",
    "win": "18:30–02:30 (сумерки и ночь)"
  },
  {
    "id": "volga_zander",
    "name": "Берш (Волжский судак)",
    "group": "predator",
    "type": "predator",
    "habitat": "fresh",
    "legal": "license",
    "basins": [
      "baltic",
      "black_azov",
      "euro_west",
      "volga_caspian"
    ],
    "waters": [
      "big_river",
      "quarry",
      "small_river"
    ],
    "optT": [
      12,
      20
    ],
    "tMinStop": 1,
    "coldBonus": 4,
    "monthActivity": [
      1,
      1,
      2,
      0,
      1,
      3,
      2,
      2,
      3,
      3,
      2,
      1
    ],
    "keywords": [
      "берш",
      "бершик",
      "волжский судак",
      "берш волжский судак"
    ],
    "gear": "Джиг с мелким виброхвостом, зимняя блесна с тюлькой.",
    "win": "06:30–10:00 и 16:30–20:00 (зорьки)"
  },
  {
    "id": "chekhon",
    "name": "Чехонь",
    "group": "peace",
    "type": "peace",
    "habitat": "fresh",
    "legal": "free",
    "basins": [
      "baltic",
      "black_azov",
      "euro_west",
      "nw_karelia",
      "volga_caspian"
    ],
    "waters": [
      "big_river",
      "quarry",
      "small_river"
    ],
    "optT": [
      15,
      22
    ],
    "tMinStop": 4,
    "coldBonus": -10,
    "monthActivity": [
      0,
      0,
      1,
      3,
      0,
      3,
      3,
      3,
      2,
      1,
      0,
      0
    ],
    "keywords": [
      "чехон",
      "сабля",
      "чеша",
      "чехонь",
      "чехонь сабля чеша"
    ],
    "gear": "Бомбарда с опарышем, резинка, микровертушки",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "vobla",
    "name": "Вобла каспийская",
    "group": "peace",
    "type": "peace",
    "habitat": "fresh",
    "legal": "license",
    "basins": [
      "volga_caspian"
    ],
    "waters": [
      "big_river",
      "sea_gulf",
      "small_river",
      "tundra_lake"
    ],
    "optT": [
      10,
      18
    ],
    "tMinStop": 4,
    "coldBonus": -9,
    "monthActivity": [
      0,
      0,
      2,
      3,
      0,
      1,
      1,
      1,
      1,
      1,
      0,
      0
    ],
    "keywords": [
      "вобл",
      "каспийская вобл",
      "вобла каспийская",
      "вобла каспийская тарань астраханская"
    ],
    "gear": "Донка с 2–3 крючками, червь, опарыш",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "rudd",
    "name": "Красноперка",
    "group": "peace",
    "type": "peace",
    "habitat": "fresh",
    "legal": "free",
    "basins": [
      "arctic_ob_taz",
      "baltic",
      "black_azov",
      "euro_west",
      "nw_karelia",
      "volga_caspian"
    ],
    "waters": [
      "big_river",
      "cooling_reservoir",
      "quarry",
      "small_river",
      "tundra_lake"
    ],
    "optT": [
      16,
      24
    ],
    "tMinStop": 5,
    "coldBonus": -12,
    "monthActivity": [
      0,
      0,
      1,
      2,
      3,
      3,
      3,
      3,
      2,
      1,
      0,
      0
    ],
    "keywords": [
      "красноперк",
      "краснопер",
      "красноперка",
      "красноперка красноглазка"
    ],
    "gear": "Поплавок, ультралайт (мормышинг), микровертушки.",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "dace",
    "name": "Елец (Чебак / Мохтик)",
    "group": "peace",
    "type": "peace",
    "habitat": "fresh",
    "legal": "free",
    "basins": [
      "arctic_ob_taz",
      "yenisei_lena",
      "baikal",
      "volga_caspian",
      "nw_karelia",
      "barents_white",
      "baltic",
      "euro_west",
      "black_azov"
    ],
    "waters": [
      "small_river",
      "big_river",
      "quarry",
      "tundra_lake",
      "cooling_reservoir"
    ],
    "optT": [
      10,
      18
    ],
    "tMinStop": 1,
    "coldBonus": 2,
    "monthActivity": [
      1,
      1,
      2,
      0,
      3,
      3,
      3,
      3,
      3,
      2,
      1,
      1
    ],
    "keywords": [
      "елец",
      "ельц",
      "мохтик",
      "мегдым",
      "чебак сибирск",
      "чебак",
      "елец сибирский чебак мохтик межень ельчик"
    ],
    "gear": "Нано-джиг и мормышинг (удилище XUL 0.2–2 г, мормышки и одноухие монтажи 0.3–1.0 г с вайтбейтом, тантой, искусственным мотылём или опарышем на проводке «пелагический зуд» и снос по струе), ультралайт-вертушки №00–0, поплавочная удочка в проводку, лёгкий пикер и нахлыст (сухая мушка и нимфа). Зимой — тонкая мормышка с мотылём и безмотылка.",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "shemaya",
    "name": "Шемайя (Черноморско-каспийская)",
    "group": "peace",
    "type": "peace",
    "habitat": "fresh",
    "legal": "redbook",
    "basins": [
      "black_azov",
      "volga_caspian"
    ],
    "waters": [
      "big_river",
      "sea_gulf"
    ],
    "optT": [
      14,
      22
    ],
    "tMinStop": 4,
    "coldBonus": -10,
    "monthActivity": [
      1,
      1,
      2,
      3,
      3,
      3,
      3,
      3,
      3,
      2,
      1,
      1
    ],
    "keywords": [
      "шемая",
      "шемай",
      "шамая",
      "шемайя",
      "черноморско-каспийская",
      "шемайя шемая шамая царская селедка"
    ],
    "gear": "Целенаправленный любительский лов запрещён (Красная книга РФ). Часто попадается в прилове при ловле других видов на спиннинг, донные и поплавочные снасти — при поимке используйте безбородые крючки или обрежьте поводок у губы для безопасного выпуска.",
    "win": "06:30–10:00 и 16:30–20:00 (зорьки)"
  },
  {
    "id": "brown_trout",
    "name": "Форель ручьевая (Пеструшка)",
    "group": "predator",
    "type": "predator",
    "habitat": "fresh",
    "legal": "license",
    "basins": [
      "black_azov",
      "volga_caspian"
    ],
    "waters": [
      "small_river"
    ],
    "optT": [
      8,
      15
    ],
    "tMinStop": 0.5,
    "coldBonus": 11,
    "monthActivity": [
      1,
      1,
      2,
      3,
      3,
      3,
      2,
      3,
      0,
      0,
      1,
      1
    ],
    "keywords": [
      "ручьевая форел",
      "пеструшк",
      "форель ручьевая",
      "пеструшка",
      "форель ручьевая пеструшка кавказская"
    ],
    "gear": "Речной УЛ, микровоблеры, нахлыст. Деликатный спиннинг (нано-джиг 0.3–1 г, микроджиг), поплавочная и фидерная оснастка с флюорокарбоновым поводком.",
    "win": "06:30–10:00 и 16:30–20:00 (зорьки)"
  },
  {
    "id": "taran",
    "name": "Тарань",
    "group": "peace",
    "type": "peace",
    "habitat": "fresh",
    "legal": "free",
    "basins": [
      "black_azov"
    ],
    "waters": [
      "big_river",
      "sea_gulf",
      "small_river",
      "tundra_lake"
    ],
    "optT": [
      12,
      20
    ],
    "tMinStop": 3,
    "coldBonus": -5,
    "monthActivity": [
      2,
      2,
      3,
      0,
      2,
      3,
      3,
      3,
      2,
      2,
      1,
      1
    ],
    "keywords": [
      "таран",
      "тарань",
      "таранк",
      "тарань таранка азовская плотва"
    ],
    "gear": "Поплавок, донка, фидер, насадка — опарыш, червь",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "bluefish",
    "name": "Луфарь",
    "group": "sea",
    "type": "predator",
    "habitat": "sea",
    "legal": "free",
    "basins": [
      "black_azov"
    ],
    "waters": [
      "open_sea",
      "sea_gulf"
    ],
    "optT": [
      16,
      24
    ],
    "tMinStop": 10,
    "coldBonus": -16,
    "monthActivity": [
      0,
      0,
      0,
      0,
      1,
      2,
      3,
      3,
      3,
      2,
      0,
      0
    ],
    "keywords": [
      "луфар",
      "луфарь"
    ],
    "gear": "Спиннинг с пилькерами, поверхностные приманки, воблеры с металлическим поводком.",
    "win": "06:30–10:00 и 16:30–20:00 (зорьки)"
  },
  {
    "id": "red_mullet",
    "name": "Султанка (Барабулька)",
    "group": "sea",
    "type": "peace",
    "habitat": "sea",
    "legal": "free",
    "basins": [
      "black_azov"
    ],
    "waters": [
      "sea_gulf"
    ],
    "optT": [
      15,
      23
    ],
    "tMinStop": 8,
    "coldBonus": -12,
    "monthActivity": [
      0,
      0,
      0,
      1,
      2,
      3,
      3,
      3,
      3,
      2,
      1,
      0
    ],
    "keywords": [
      "барабул",
      "барабульк",
      "султанк",
      "султанка",
      "барабулька"
    ],
    "gear": "Пикер, морская донка, мелкий крючок с нереисом.",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "sea_bream",
    "name": "Морской карась (Ласкирь)",
    "group": "sea",
    "type": "peace",
    "habitat": "sea",
    "legal": "free",
    "basins": [
      "black_azov"
    ],
    "waters": [
      "sea_gulf"
    ],
    "optT": [
      16,
      24
    ],
    "tMinStop": 9,
    "coldBonus": -14,
    "monthActivity": [
      0,
      0,
      0,
      1,
      2,
      3,
      3,
      3,
      3,
      2,
      0,
      0
    ],
    "keywords": [
      "ласкир",
      "морской карас",
      "карась морск",
      "зубарик",
      "сарг",
      "морской карась",
      "ласкирь"
    ],
    "gear": "Морская прибрежная ловля, отводной поводок, съедобная резина (Marukyu), мясо креветки.",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "wrasse",
    "name": "Зеленушка (Рулена)",
    "group": "sea",
    "type": "peace",
    "habitat": "sea",
    "legal": "free",
    "basins": [
      "black_azov"
    ],
    "waters": [
      "sea_gulf"
    ],
    "optT": [
      16,
      24
    ],
    "tMinStop": 10,
    "coldBonus": -16,
    "monthActivity": [
      0,
      0,
      0,
      1,
      2,
      3,
      3,
      3,
      3,
      1,
      0,
      0
    ],
    "keywords": [
      "зеленушк",
      "рулен",
      "рябчик морск",
      "зеленушка",
      "рулена"
    ],
    "gear": "Микроджиг, поплавочная удочка с мидией или крабом.",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "scorpionfish",
    "name": "Скорпена (Морской ерш)",
    "group": "sea",
    "type": "predator",
    "habitat": "sea",
    "legal": "free",
    "basins": [
      "black_azov"
    ],
    "waters": [
      "sea_gulf"
    ],
    "optT": [
      14,
      22
    ],
    "tMinStop": 7,
    "coldBonus": -10,
    "monthActivity": [
      0,
      0,
      0,
      1,
      2,
      3,
      3,
      3,
      3,
      2,
      0,
      0
    ],
    "keywords": [
      "скорпен",
      "морской ерш",
      "ерш морск",
      "скорпена"
    ],
    "gear": "Морская прибрежная ловля в темноте, силиконовые рачки, джиг-головки 2–4 г.",
    "win": "18:30–02:30 (сумерки и ночь)"
  },
  {
    "id": "turbot",
    "name": "Калкан черноморский",
    "group": "sea",
    "type": "predator",
    "habitat": "sea",
    "legal": "license",
    "basins": [
      "black_azov"
    ],
    "waters": [
      "open_sea",
      "sea_gulf"
    ],
    "optT": [
      10,
      18
    ],
    "tMinStop": 4,
    "coldBonus": 4,
    "monthActivity": [
      1,
      1,
      2,
      0,
      0,
      2,
      3,
      3,
      3,
      3,
      2,
      1
    ],
    "keywords": [
      "калкан",
      "черноморский калкан",
      "калкан черноморский"
    ],
    "gear": "Мощный береговая морская донка, резка рыбы (хамса, ставрида).",
    "win": "В течение всего дня (пик 08:00–16:00)"
  },
  {
    "id": "chir",
    "name": "Щокур (Чир)",
    "group": "whitefish",
    "type": "peace",
    "habitat": "fresh",
    "legal": "free",
    "basins": [
      "arctic_ob_taz",
      "yenisei_lena",
      "barents_white",
      "pacific_sea"
    ],
    "waters": [
      "small_river",
      "big_river",
      "quarry",
      "tundra_lake"
    ],
    "optT": [
      4,
      12
    ],
    "tMinStop": 0,
    "coldBonus": 18,
    "monthActivity": [
      2,
      2,
      3,
      2,
      1,
      1,
      2,
      2,
      3,
      0,
      0,
      3
    ],
    "keywords": [
      "чир",
      "щокур",
      "щекур",
      "чира",
      "щокур чир щекур сиг северный"
    ],
    "gear": "Донная снасть и лёгкий пикер/фидер с животной насадкой, мормышинг и нано-джиг у самого дна (0.5–1.5 г с имитацией личинки и мотыля на медленном волочении), поплавочная удочка со дна. Со льда — зимняя поплавочная удочка и вольфрамовая мормышка с пучком мотыля или мормышем.",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "pizhyan",
    "name": "Пыжьян (Сибирский сиг)",
    "group": "whitefish",
    "type": "peace",
    "habitat": "fresh",
    "legal": "free",
    "basins": [
      "arctic_ob_taz",
      "yenisei_lena",
      "barents_white",
      "baikal"
    ],
    "waters": [
      "small_river",
      "big_river",
      "quarry",
      "tundra_lake",
      "sea_gulf"
    ],
    "optT": [
      4,
      13
    ],
    "tMinStop": 0,
    "coldBonus": 16,
    "monthActivity": [
      2,
      2,
      2,
      2,
      2,
      3,
      3,
      2,
      0,
      0,
      3,
      3
    ],
    "keywords": [
      "пыжьян",
      "сибирский сиг",
      "полкур",
      "пыжьян сиг сибирский полкур"
    ],
    "gear": "Мормышинг / нано-джиг (0.4–1.2 г с нимфами и слагами), ультралайт-вращалки №0–1, поплавочная удочка в проводку, лёгкий фидер/пикер, нахлыст (огруженные нимфы). Зимой — мормышка с мотылём/бокоплавом и зимняя блесна с цепочкой.",
    "win": "06:30–10:00 и 16:30–20:00 (зорьки)"
  },
  {
    "id": "peled",
    "name": "Пелядь (Сырок)",
    "group": "whitefish",
    "type": "peace",
    "habitat": "fresh",
    "legal": "free",
    "basins": [
      "arctic_ob_taz",
      "yenisei_lena",
      "barents_white",
      "nw_karelia",
      "volga_caspian",
      "baikal"
    ],
    "waters": [
      "small_river",
      "big_river",
      "quarry",
      "tundra_lake"
    ],
    "optT": [
      6,
      15
    ],
    "tMinStop": 0,
    "coldBonus": 14,
    "monthActivity": [
      2,
      2,
      3,
      2,
      2,
      3,
      3,
      3,
      2,
      0,
      0,
      1
    ],
    "keywords": [
      "пеляд",
      "сырок",
      "сырка",
      "сырку",
      "пелядь",
      "пелядь сырок сырочек речной озерный сиг"
    ],
    "gear": "Нано-джиг и мормышинг (XUL спиннинг до 1.5–2 г, мормышка 0.3–0.8 г с подсадкой белого/розового слага Whitebait, Tanta или нимфы в толще воды с мелким «зудом»), ультралайт-колебалки 1–2.5 г и вертушки №00–0, сбирулино (бомбарда) с мушкой, чувствительная поплавочная оснастка в проводку. Зимой — гирлянда из светонакопительных мормышек и бисера в полводы.",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "muksun",
    "name": "Муксун",
    "group": "whitefish",
    "type": "peace",
    "habitat": "fresh",
    "legal": "redbook",
    "basins": [
      "arctic_ob_taz",
      "yenisei_lena"
    ],
    "waters": [
      "big_river",
      "sea_gulf",
      "small_river"
    ],
    "optT": [
      4,
      12
    ],
    "tMinStop": 0,
    "coldBonus": 17,
    "monthActivity": [
      2,
      2,
      3,
      2,
      2,
      3,
      3,
      3,
      3,
      1,
      1,
      2
    ],
    "keywords": [
      "муксун",
      "муксуна",
      "муксун обской сиг краснокнижный"
    ],
    "gear": "Любительский и промысловый вылов в Обь-Иртышском бассейне категорически ЗАПРЕЩЁН.",
    "win": "06:30–10:00 и 16:30–20:00 (зорьки)"
  },
  {
    "id": "nelma",
    "name": "Нельма",
    "group": "whitefish",
    "type": "predator",
    "habitat": "fresh",
    "legal": "redbook",
    "basins": [
      "arctic_ob_taz",
      "yenisei_lena",
      "barents_white"
    ],
    "waters": [
      "big_river",
      "small_river",
      "sea_gulf"
    ],
    "optT": [
      4,
      12
    ],
    "tMinStop": 0,
    "coldBonus": 16,
    "monthActivity": [
      2,
      2,
      3,
      2,
      2,
      3,
      3,
      3,
      3,
      1,
      2,
      2
    ],
    "keywords": [
      "нельма",
      "нельмы",
      "нельму",
      "нельма белорыбица сибирская"
    ],
    "gear": "Любительский вылов в запретных бассейнах (включая Обь-Иртышский и Печорский) ЗАПРЕЩЁН.",
    "win": "06:30–10:00 и 16:30–20:00 (зорьки)"
  },
  {
    "id": "cisco",
    "name": "Ряпушка сибирская",
    "group": "whitefish",
    "type": "peace",
    "habitat": "fresh",
    "legal": "free",
    "basins": [
      "arctic_ob_taz",
      "barents_white",
      "yenisei_lena"
    ],
    "waters": [
      "big_river",
      "quarry",
      "sea_gulf",
      "small_river",
      "tundra_lake"
    ],
    "optT": [
      2,
      10
    ],
    "tMinStop": -0.5,
    "coldBonus": 19,
    "monthActivity": [
      3,
      3,
      3,
      2,
      1,
      2,
      2,
      2,
      0,
      0,
      2,
      3
    ],
    "keywords": [
      "ряпушк",
      "зеeld",
      "зельдь",
      "сибирская ряпушк",
      "ряпушка сибирская",
      "ряпушка сибирская зельдь туруханка"
    ],
    "gear": "Зимняя гирлянда со светонакопительными микромормышками",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "tugun",
    "name": "Тугун (Манерка / Сосьвинская сельдь)",
    "group": "whitefish",
    "type": "peace",
    "habitat": "fresh",
    "legal": "free",
    "basins": [
      "arctic_ob_taz",
      "yenisei_lena"
    ],
    "waters": [
      "small_river",
      "big_river",
      "tundra_lake",
      "quarry"
    ],
    "optT": [
      8,
      16
    ],
    "tMinStop": 1,
    "coldBonus": 9,
    "monthActivity": [
      1,
      1,
      2,
      2,
      3,
      3,
      3,
      3,
      0,
      0,
      1,
      1
    ],
    "keywords": [
      "тугун",
      "манерк",
      "сосьвинская сельд",
      "тугунок",
      "манерка",
      "сосьвинская сельдь",
      "тугун манерка сосьвинская сельдь тугунок"
    ],
    "gear": "Сверхлёгкий мормышинг (0.15–0.4 г с микромушкой или кусочком силиконового мотыля), лёгкая маховая поплавочная удочка с поплавком 0.3–0.8 г и крючком №16–18, нахлыст на сухую мушку.",
    "win": "06:30–10:00 и 16:30–20:00 (зорьки)"
  },
  {
    "id": "siberian_sturgeon",
    "name": "Сибирский осётр",
    "group": "sturgeon",
    "type": "peace",
    "habitat": "fresh",
    "legal": "redbook",
    "basins": [
      "arctic_ob_taz",
      "yenisei_lena",
      "baikal"
    ],
    "waters": [
      "big_river",
      "small_river",
      "sea_gulf",
      "quarry"
    ],
    "optT": [
      10,
      18
    ],
    "tMinStop": 0.5,
    "coldBonus": 4,
    "monthActivity": [
      1,
      1,
      2,
      2,
      2,
      3,
      3,
      3,
      3,
      2,
      1,
      1
    ],
    "keywords": [
      "сибирский осетр",
      "осетр сибирск",
      "осетр сибирский карыш коسترя"
    ],
    "gear": "Вылов дикой популяции категорически ЗАПРЕЩЁН (разрешён только лов товарной рыбы в коммерческих платных прудхозах).",
    "win": "18:30–02:30 (сумерки и ночь)"
  },
  {
    "id": "omul",
    "name": "Байкальский омуль",
    "group": "whitefish",
    "type": "peace",
    "habitat": "fresh",
    "legal": "license",
    "basins": [
      "baikal"
    ],
    "waters": [
      "quarry"
    ],
    "optT": [
      4,
      12
    ],
    "tMinStop": 0,
    "coldBonus": 16,
    "monthActivity": [
      2,
      2,
      2,
      1,
      2,
      3,
      3,
      3,
      0,
      0,
      0,
      2
    ],
    "keywords": [
      "омул",
      "байкальский омул",
      "байкальский омуль",
      "омуль байкальский селенгинский посольский"
    ],
    "gear": "Специальная настроечная мушка (кембрик, бисер), гирлянда",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "lenok",
    "name": "Ленок (Ускуч)",
    "group": "predator",
    "type": "predator",
    "habitat": "fresh",
    "legal": "license",
    "basins": [
      "amur",
      "baikal",
      "yenisei_lena"
    ],
    "waters": [
      "big_river",
      "small_river"
    ],
    "optT": [
      6,
      14
    ],
    "tMinStop": 0,
    "coldBonus": 14,
    "monthActivity": [
      1,
      1,
      2,
      2,
      0,
      3,
      3,
      3,
      3,
      2,
      1,
      1
    ],
    "keywords": [
      "ленок",
      "ленка",
      "ускуч",
      "ленок ускуч сибирская форель"
    ],
    "gear": "Спиннинг с искусственной мышью, узкотелые воблеры, нахлыст.",
    "win": "06:30–10:00 и 16:30–20:00 (зорьки)"
  },
  {
    "id": "taimen",
    "name": "Обыкновенный таймень",
    "group": "predator",
    "type": "predator",
    "habitat": "fresh",
    "legal": "redbook",
    "basins": [
      "yenisei_lena",
      "baikal",
      "amur",
      "arctic_ob_taz",
      "volga_caspian"
    ],
    "waters": [
      "big_river",
      "small_river",
      "quarry"
    ],
    "optT": [
      6,
      14
    ],
    "tMinStop": 0,
    "coldBonus": 12,
    "monthActivity": [
      1,
      1,
      2,
      2,
      1,
      3,
      3,
      3,
      3,
      3,
      2,
      1
    ],
    "keywords": [
      "таймен",
      "тайменя",
      "обыкновенный таймень",
      "таймень хозяин рек красный таймень"
    ],
    "gear": "В разрешённых РПУ (строго с безбородыми или поджатыми крючками): мощный спиннинг и двуручный нахлыст, крупные воблеры и поверхностные «мыши» в сумерках.",
    "win": "06:30–10:00 и 16:30–20:00 (зорьки)"
  },
  {
    "id": "snakehead",
    "name": "Змееголов",
    "group": "predator",
    "type": "predator",
    "habitat": "fresh",
    "legal": "free",
    "basins": [
      "amur"
    ],
    "waters": [
      "small_river",
      "tundra_lake"
    ],
    "optT": [
      18,
      28
    ],
    "tMinStop": 6,
    "coldBonus": -17,
    "monthActivity": [
      0,
      0,
      0,
      0,
      1,
      3,
      3,
      3,
      2,
      0,
      0,
      0
    ],
    "keywords": [
      "змееголов",
      "змееголов змей амурский"
    ],
    "gear": "Кастинговое удилище heavy, силиконовые незацепляемые лягушки.",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "sky_gazer",
    "name": "Верхогляд",
    "group": "predator",
    "type": "predator",
    "habitat": "fresh",
    "legal": "free",
    "basins": [
      "amur"
    ],
    "waters": [
      "big_river"
    ],
    "optT": [
      16,
      24
    ],
    "tMinStop": 4,
    "coldBonus": -12,
    "monthActivity": [
      0,
      0,
      0,
      1,
      2,
      3,
      3,
      3,
      2,
      1,
      0,
      0
    ],
    "keywords": [
      "верхогляд",
      "верхогляд пучеглаз амурский"
    ],
    "gear": "Дальнобойный спиннинг, тяжёлые морские блёсны, кастмастеры, поверхностные приманки.",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "yellowcheek",
    "name": "Желтощек",
    "group": "predator",
    "type": "predator",
    "habitat": "fresh",
    "legal": "redbook",
    "basins": [
      "amur"
    ],
    "waters": [
      "big_river"
    ],
    "optT": [
      15,
      22
    ],
    "tMinStop": 4,
    "coldBonus": -10,
    "monthActivity": [
      0,
      0,
      1,
      2,
      3,
      3,
      3,
      3,
      3,
      2,
      0,
      0
    ],
    "keywords": [
      "желтощек",
      "желтощек бамбуса амурская щука"
    ],
    "gear": "Целенаправленный любительский лов запрещён (Красная книга РФ). Часто попадается в прилове при ловле других видов на спиннинг, донные и поплавочные снасти — при поимке используйте безбородые крючки или обрежьте поводок у губы для безопасного выпуска.",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "chinese_perch",
    "name": "Ауха (Китайский окунь)",
    "group": "predator",
    "type": "predator",
    "habitat": "fresh",
    "legal": "redbook",
    "basins": [
      "amur"
    ],
    "waters": [
      "big_river"
    ],
    "optT": [
      16,
      24
    ],
    "tMinStop": 5,
    "coldBonus": -14,
    "monthActivity": [
      0,
      0,
      1,
      2,
      3,
      2,
      3,
      3,
      3,
      2,
      0,
      0
    ],
    "keywords": [
      "ауха",
      "китайский окун",
      "китайский окунь",
      "ауха китайский окунь ерш мандарин"
    ],
    "gear": "Целенаправленный любительский лов запрещён (Красная книга РФ). Часто попадается в прилове при ловле других видов на спиннинг, донные и поплавочные снасти — при поимке используйте безбородые крючки или обрежьте поводок у губы для безопасного выпуска.",
    "win": "06:30–10:00 и 16:30–20:00 (зорьки)"
  },
  {
    "id": "amur_catfish",
    "name": "Амурский сом",
    "group": "predator",
    "type": "predator",
    "habitat": "fresh",
    "legal": "free",
    "basins": [
      "amur"
    ],
    "waters": [
      "big_river",
      "tundra_lake"
    ],
    "optT": [
      16,
      24
    ],
    "tMinStop": 6,
    "coldBonus": -14,
    "monthActivity": [
      0,
      0,
      0,
      1,
      2,
      3,
      3,
      3,
      2,
      1,
      0,
      0
    ],
    "keywords": [
      "амурский сом",
      "сом амурск",
      "сом амурский дальневосточный"
    ],
    "gear": "Донка, спиннинг с крупным силиконом, лягушка.",
    "win": "18:30–02:30 (сумерки и ночь)"
  },
  {
    "id": "pink_salmon",
    "name": "Горбуша",
    "group": "sea",
    "type": "predator",
    "habitat": "sea",
    "legal": "license",
    "basins": [
      "amur",
      "barents_white",
      "pacific_sea"
    ],
    "waters": [
      "big_river",
      "sea_gulf",
      "small_river"
    ],
    "optT": [
      6,
      14
    ],
    "tMinStop": 1,
    "coldBonus": 9,
    "monthActivity": [
      0,
      0,
      0,
      0,
      1,
      2,
      3,
      3,
      1,
      0,
      0,
      0
    ],
    "keywords": [
      "горбуш",
      "горбуши",
      "горбуша",
      "горбуша розовый лосось"
    ],
    "gear": "Спиннинг 10–35 г, блесны Blue Fox #4–#5 розовых тонов.",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "chum_salmon",
    "name": "Кета",
    "group": "sea",
    "type": "predator",
    "habitat": "sea",
    "legal": "license",
    "basins": [
      "amur",
      "pacific_sea"
    ],
    "waters": [
      "big_river",
      "sea_gulf",
      "small_river"
    ],
    "optT": [
      6,
      14
    ],
    "tMinStop": 1,
    "coldBonus": 9,
    "monthActivity": [
      0,
      0,
      0,
      0,
      0,
      1,
      2,
      3,
      3,
      1,
      0,
      0
    ],
    "keywords": [
      "кета",
      "кеты",
      "кету",
      "кета серебрянка зубатка лосось"
    ],
    "gear": "Спиннинг тяжелого класса, колеблющиеся блесны.",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "coho_salmon",
    "name": "Кижуч",
    "group": "sea",
    "type": "predator",
    "habitat": "sea",
    "legal": "license",
    "basins": [
      "pacific_sea"
    ],
    "waters": [
      "big_river",
      "sea_gulf",
      "small_river"
    ],
    "optT": [
      5,
      12
    ],
    "tMinStop": 0.5,
    "coldBonus": 11,
    "monthActivity": [
      0,
      0,
      0,
      0,
      0,
      0,
      1,
      3,
      3,
      2,
      0,
      0
    ],
    "keywords": [
      "кижуч",
      "кижуча",
      "кижуч серебряный лосось белый"
    ],
    "gear": "Спиннинг, тяжелые вертушки с колокольчиком.",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "sockeye_salmon",
    "name": "Нерка (Красница)",
    "group": "sea",
    "type": "predator",
    "habitat": "sea",
    "legal": "license",
    "basins": [
      "pacific_sea"
    ],
    "waters": [
      "big_river",
      "sea_gulf",
      "small_river",
      "quarry"
    ],
    "optT": [
      5,
      12
    ],
    "tMinStop": 0.5,
    "coldBonus": 11,
    "monthActivity": [
      0,
      0,
      0,
      0,
      0,
      2,
      3,
      2,
      0,
      0,
      0,
      0
    ],
    "keywords": [
      "нерк",
      "красниц",
      "нерка",
      "красница",
      "нерка красница красный лосось"
    ],
    "gear": "Нахлыст, специализированные мушки. Деликатный спиннинг (нано-джиг 0.3–1 г, микроджиг), поплавочная и фидерная оснастка с флюорокарбоновым поводком.",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "chinook_salmon",
    "name": "Чавыча",
    "group": "sea",
    "type": "predator",
    "habitat": "sea",
    "legal": "license",
    "basins": [
      "pacific_sea"
    ],
    "waters": [
      "big_river",
      "sea_gulf",
      "small_river"
    ],
    "optT": [
      5,
      12
    ],
    "tMinStop": 0.5,
    "coldBonus": 12,
    "monthActivity": [
      0,
      0,
      0,
      0,
      1,
      3,
      3,
      1,
      0,
      0,
      0,
      0
    ],
    "keywords": [
      "чавыч",
      "чавычи",
      "чавыча",
      "чавыча королевский лосось князь"
    ],
    "gear": "Морской тяжелый спиннинг, мощнейшие катушки со шнуром #3.0+ PE.",
    "win": "06:30–10:00 и 16:30–20:00 (зорьки)"
  },
  {
    "id": "cherry_salmon",
    "name": "Сима (Масу)",
    "group": "sea",
    "type": "predator",
    "habitat": "sea",
    "legal": "license",
    "basins": [
      "pacific_sea"
    ],
    "waters": [
      "sea_gulf",
      "small_river",
      "big_river"
    ],
    "optT": [
      8,
      15
    ],
    "tMinStop": 1,
    "coldBonus": 7,
    "monthActivity": [
      0,
      0,
      0,
      1,
      3,
      3,
      1,
      0,
      0,
      0,
      0,
      0
    ],
    "keywords": [
      "сима",
      "симы",
      "масу",
      "сима масу вишневый лосось"
    ],
    "gear": "Спиннинг 5–21 г, тонущие узкотелые воблеры, колебалки.",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "char",
    "name": "Голец арктический / Кунджа",
    "group": "predator",
    "type": "predator",
    "habitat": "fresh",
    "legal": "license",
    "basins": [
      "arctic_ob_taz",
      "barents_white",
      "pacific_sea",
      "yenisei_lena"
    ],
    "waters": [
      "quarry",
      "sea_gulf",
      "small_river",
      "big_river",
      "tundra_lake"
    ],
    "optT": [
      3,
      11
    ],
    "tMinStop": -0.5,
    "coldBonus": 18,
    "monthActivity": [
      2,
      2,
      2,
      3,
      3,
      3,
      2,
      3,
      0,
      0,
      2,
      2
    ],
    "keywords": [
      "голец",
      "гольц",
      "кундж",
      "арктический голец",
      "голец арктический",
      "кунджа",
      "голец арктический кунджа палия мальма"
    ],
    "gear": "Спиннинг, белые колебалки, нахлыстовые крупные мушки.",
    "win": "06:30–10:00 и 16:30–20:00 (зорьки)"
  },
  {
    "id": "dolly_varden",
    "name": "Мальма",
    "group": "predator",
    "type": "predator",
    "habitat": "fresh",
    "legal": "free",
    "basins": [
      "pacific_sea"
    ],
    "waters": [
      "small_river",
      "big_river",
      "sea_gulf",
      "quarry"
    ],
    "optT": [
      4,
      12
    ],
    "tMinStop": 0,
    "coldBonus": 16,
    "monthActivity": [
      2,
      2,
      2,
      3,
      3,
      3,
      3,
      2,
      0,
      0,
      2,
      2
    ],
    "keywords": [
      "мальм",
      "мальмы",
      "мальма",
      "мальма голец тихоокеанский"
    ],
    "gear": "Легкий спиннинг, поплавок с икринкой, вертушки #2.",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "walleye_pollock",
    "name": "Минтай",
    "group": "sea",
    "type": "predator",
    "habitat": "sea",
    "legal": "free",
    "basins": [
      "pacific_sea"
    ],
    "waters": [
      "open_sea",
      "sea_gulf"
    ],
    "optT": [
      1,
      8
    ],
    "tMinStop": 0,
    "coldBonus": 12,
    "monthActivity": [
      2,
      2,
      3,
      3,
      2,
      1,
      1,
      2,
      2,
      3,
      3,
      2
    ],
    "keywords": [
      "минтай",
      "минтая"
    ],
    "gear": "Тяжёлые морские блёсны 80–150 г, ставки с октопусами.",
    "win": "06:30–10:00 и 16:30–20:00 (зорьки)"
  },
  {
    "id": "navaga",
    "name": "Навага дальневосточная / северная",
    "group": "sea",
    "type": "predator",
    "habitat": "sea",
    "legal": "free",
    "basins": [
      "arctic_ob_taz",
      "barents_white",
      "pacific_sea"
    ],
    "waters": [
      "sea_gulf",
      "big_river",
      "small_river"
    ],
    "optT": [
      -1,
      6
    ],
    "tMinStop": -1.5,
    "coldBonus": 23,
    "monthActivity": [
      3,
      3,
      2,
      1,
      0,
      0,
      0,
      1,
      2,
      3,
      3,
      3
    ],
    "keywords": [
      "наваг",
      "вахня",
      "навага дальневосточная",
      "северная",
      "навага вахня северная дальневосточная"
    ],
    "gear": "Зимняя блесна-иголка без бородки. Деликатный спиннинг (нано-джиг 0.3–1 г, микроджиг), поплавочная и фидерная оснастка с флюорокарбоновым поводком.",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "greenling",
    "name": "Терпуг (Одноперый / пятнистый)",
    "group": "sea",
    "type": "predator",
    "habitat": "sea",
    "legal": "free",
    "basins": [
      "pacific_sea"
    ],
    "waters": [
      "open_sea",
      "sea_gulf"
    ],
    "optT": [
      6,
      14
    ],
    "tMinStop": 1,
    "coldBonus": 7,
    "monthActivity": [
      1,
      1,
      2,
      3,
      3,
      3,
      3,
      2,
      1,
      1,
      1,
      1
    ],
    "keywords": [
      "терпуг",
      "одноперый",
      "пятнистый"
    ],
    "gear": "Джиг с силиконовыми октопусами, кастмастеры, донка.",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "starry_flounder",
    "name": "Камбала звездчатая",
    "group": "sea",
    "type": "predator",
    "habitat": "sea",
    "legal": "free",
    "basins": [
      "pacific_sea"
    ],
    "waters": [
      "sea_gulf",
      "big_river",
      "small_river"
    ],
    "optT": [
      4,
      14
    ],
    "tMinStop": 0.5,
    "coldBonus": 9,
    "monthActivity": [
      2,
      1,
      2,
      3,
      3,
      3,
      3,
      3,
      3,
      2,
      2,
      2
    ],
    "keywords": [
      "звездчатая камбал",
      "камбала звездчатая"
    ],
    "gear": "Береговая морская снасть, нарезка рыбы, морской червь.",
    "win": "В течение всего дня (пик 08:00–16:00)"
  },
  {
    "id": "vendace",
    "name": "Ряпушка европейская (Рипус)",
    "group": "whitefish",
    "type": "peace",
    "habitat": "fresh",
    "legal": "free",
    "basins": [
      "arctic_ob_taz",
      "baltic",
      "barents_white",
      "nw_karelia",
      "volga_caspian"
    ],
    "waters": [
      "big_river",
      "quarry",
      "sea_gulf",
      "small_river",
      "tundra_lake"
    ],
    "optT": [
      4,
      12
    ],
    "tMinStop": 0,
    "coldBonus": 16,
    "monthActivity": [
      2,
      2,
      3,
      2,
      2,
      3,
      3,
      2,
      1,
      0,
      0,
      2
    ],
    "keywords": [
      "рипус",
      "килец",
      "европейская ряпушк",
      "ряпушка европейская",
      "ряпушка европейская рипус килец"
    ],
    "gear": "Зимняя гирлянда с подсветкой, микромормышки",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "broad_whitefish",
    "name": "Сиг-лудога / Валаамка",
    "group": "whitefish",
    "type": "peace",
    "habitat": "fresh",
    "legal": "free",
    "basins": [
      "arctic_ob_taz",
      "baltic",
      "barents_white",
      "nw_karelia",
      "volga_caspian"
    ],
    "waters": [
      "big_river",
      "quarry",
      "sea_gulf",
      "small_river",
      "tundra_lake"
    ],
    "optT": [
      4,
      12
    ],
    "tMinStop": 0,
    "coldBonus": 14,
    "monthActivity": [
      2,
      2,
      3,
      2,
      3,
      3,
      2,
      2,
      0,
      0,
      2,
      2
    ],
    "keywords": [
      "лудог",
      "валаамк",
      "сиг лудог",
      "сиг-лудога",
      "валаамка",
      "сиг лудога валаамка ладожский"
    ],
    "gear": "Зимнее блеснение с цепочкой, донная снасть",
    "win": "06:30–10:00 и 16:30–20:00 (зорьки)"
  },
  {
    "id": "omul_arctic",
    "name": "Арктический омуль",
    "group": "whitefish",
    "type": "peace",
    "habitat": "sea",
    "legal": "free",
    "basins": [
      "arctic_ob_taz",
      "barents_white",
      "yenisei_lena"
    ],
    "waters": [
      "big_river",
      "quarry",
      "sea_gulf",
      "small_river",
      "tundra_lake"
    ],
    "optT": [
      1,
      9
    ],
    "tMinStop": -0.5,
    "coldBonus": 19,
    "monthActivity": [
      2,
      2,
      3,
      2,
      1,
      2,
      3,
      3,
      0,
      0,
      2,
      2
    ],
    "keywords": [
      "арктический омул",
      "омуль северн",
      "арктический омуль",
      "омуль арктический северный"
    ],
    "gear": "Гирлянда-самодур, мормышка с бокоплавом.",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "valek",
    "name": "Валёк (Конёк)",
    "group": "whitefish",
    "type": "peace",
    "habitat": "fresh",
    "legal": "free",
    "basins": [
      "arctic_ob_taz",
      "pacific_sea",
      "yenisei_lena"
    ],
    "waters": [
      "big_river",
      "quarry",
      "small_river"
    ],
    "optT": [
      4,
      12
    ],
    "tMinStop": 0,
    "coldBonus": 14,
    "monthActivity": [
      1,
      1,
      2,
      2,
      3,
      3,
      3,
      2,
      0,
      0,
      1,
      1
    ],
    "keywords": [
      "валек",
      "валька",
      "конек сибирск",
      "конек",
      "валек конек сиг вальковый"
    ],
    "gear": "Поплавочная удочка в проводку, ручейник, короед",
    "win": "06:30–10:00 и 16:30–20:00 (зорьки)"
  },
  {
    "id": "baikal_grayling",
    "name": "Байкальский хариус (белый / черный)",
    "group": "predator",
    "type": "predator",
    "habitat": "fresh",
    "legal": "license",
    "basins": [
      "baikal"
    ],
    "waters": [
      "big_river",
      "quarry",
      "small_river"
    ],
    "optT": [
      4,
      12
    ],
    "tMinStop": 0,
    "coldBonus": 16,
    "monthActivity": [
      2,
      2,
      3,
      2,
      0,
      2,
      3,
      3,
      3,
      3,
      2,
      2
    ],
    "keywords": [
      "байкальский хариус",
      "белый хариус",
      "черный хариус",
      "белый",
      "черный",
      "хариус байкальский белый черный"
    ],
    "gear": "Байкальский «кораблик», грузовой настрой с мушками под бормаша.",
    "win": "06:30–10:00 и 16:30–20:00 (зорьки)"
  },
  {
    "id": "beluga",
    "name": "Белуга",
    "group": "sturgeon",
    "type": "predator",
    "habitat": "sea",
    "legal": "redbook",
    "basins": [
      "black_azov",
      "volga_caspian"
    ],
    "waters": [
      "big_river",
      "open_sea",
      "sea_gulf"
    ],
    "optT": [
      10,
      20
    ],
    "tMinStop": 1,
    "coldBonus": 0,
    "monthActivity": [
      1,
      2,
      3,
      3,
      2,
      2,
      2,
      2,
      3,
      3,
      2,
      1
    ],
    "keywords": [
      "белуг",
      "белуга",
      "белуга царь рыба осетровые"
    ],
    "gear": "Целенаправленный любительский лов запрещён (Красная книга РФ). Часто попадается в прилове при ловле других видов на спиннинг, донные и поплавочные снасти — при поимке используйте безбородые крючки или обрежьте поводок у губы для безопасного выпуска.",
    "win": "18:30–02:30 (сумерки и ночь)"
  },
  {
    "id": "stellate_sturgeon",
    "name": "Севрюга",
    "group": "sturgeon",
    "type": "peace",
    "habitat": "sea",
    "legal": "redbook",
    "basins": [
      "black_azov",
      "volga_caspian"
    ],
    "waters": [
      "big_river",
      "sea_gulf"
    ],
    "optT": [
      12,
      22
    ],
    "tMinStop": 2,
    "coldBonus": -3,
    "monthActivity": [
      1,
      1,
      2,
      3,
      2,
      2,
      3,
      3,
      3,
      2,
      1,
      1
    ],
    "keywords": [
      "севрюг",
      "севрюга",
      "севрюга осетр носатый"
    ],
    "gear": "Целенаправленный любительский лов запрещён (Красная книга РФ). Часто попадается в прилове при ловле других видов на спиннинг, донные и поплавочные снасти — при поимке используйте безбородые крючки или обрежьте поводок у губы для безопасного выпуска.",
    "win": "18:30–02:30 (сумерки и ночь)"
  },
  {
    "id": "kaluga",
    "name": "Калуга",
    "group": "sturgeon",
    "type": "predator",
    "habitat": "fresh",
    "legal": "redbook",
    "basins": [
      "amur",
      "pacific_sea"
    ],
    "waters": [
      "big_river",
      "sea_gulf"
    ],
    "optT": [
      8,
      18
    ],
    "tMinStop": 1,
    "coldBonus": 2,
    "monthActivity": [
      1,
      1,
      2,
      2,
      2,
      3,
      3,
      3,
      3,
      2,
      1,
      1
    ],
    "keywords": [
      "калуг рыба",
      "амурская калуг",
      "калуга",
      "калуга амурская белуга"
    ],
    "gear": "Целенаправленный любительский лов запрещён (Красная книга РФ). Часто попадается в прилове при ловле других видов на спиннинг, донные и поплавочные снасти — при поимке используйте безбородые крючки или обрежьте поводок у губы для безопасного выпуска.",
    "win": "18:30–02:30 (сумерки и ночь)"
  },
  {
    "id": "white_salmon",
    "name": "Белорыбица",
    "group": "whitefish",
    "type": "predator",
    "habitat": "fresh",
    "legal": "redbook",
    "basins": [
      "volga_caspian"
    ],
    "waters": [
      "big_river"
    ],
    "optT": [
      6,
      16
    ],
    "tMinStop": 0.5,
    "coldBonus": 7,
    "monthActivity": [
      2,
      2,
      3,
      2,
      2,
      2,
      2,
      2,
      3,
      1,
      2,
      2
    ],
    "keywords": [
      "белорыбиц",
      "белорыбица",
      "белорыбица каспийская нельма"
    ],
    "gear": "Целенаправленный любительский лов запрещён (Красная книга РФ). Часто попадается в прилове при ловле других видов на спиннинг, донные и поплавочные снасти — при поимке используйте безбородые крючки или обрежьте поводок у губы для безопасного выпуска.",
    "win": "06:30–10:00 и 16:30–20:00 (зорьки)"
  },
  {
    "id": "kutum",
    "name": "Кутум",
    "group": "sea",
    "type": "peace",
    "habitat": "sea",
    "legal": "license",
    "basins": [
      "volga_caspian"
    ],
    "waters": [
      "big_river",
      "sea_gulf",
      "small_river"
    ],
    "optT": [
      12,
      20
    ],
    "tMinStop": 3,
    "coldBonus": -5,
    "monthActivity": [
      1,
      2,
      3,
      2,
      0,
      2,
      2,
      2,
      3,
      2,
      1,
      1
    ],
    "keywords": [
      "кутум",
      "кутум вырезуб каспийский"
    ],
    "gear": "Донная снасть, береговая донка, насадка — креветка, червь, краб.",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "black_carp",
    "name": "Черный амур",
    "group": "peace",
    "type": "peace",
    "habitat": "fresh",
    "legal": "redbook",
    "basins": [
      "amur",
      "black_azov",
      "volga_caspian"
    ],
    "waters": [
      "big_river",
      "cooling_reservoir"
    ],
    "optT": [
      18,
      26
    ],
    "tMinStop": 7,
    "coldBonus": -17,
    "monthActivity": [
      0,
      0,
      0,
      1,
      2,
      3,
      3,
      3,
      2,
      1,
      0,
      0
    ],
    "keywords": [
      "черный амур",
      "амур черн",
      "черный амур китайский плотва"
    ],
    "gear": "Только в специализированных прудовых хозяйствах.",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "tarpon_carp",
    "name": "Троегуб / Конь-губарь",
    "group": "peace",
    "type": "peace",
    "habitat": "fresh",
    "legal": "free",
    "basins": [
      "amur"
    ],
    "waters": [
      "big_river",
      "small_river"
    ],
    "optT": [
      14,
      22
    ],
    "tMinStop": 2,
    "coldBonus": -2,
    "monthActivity": [
      1,
      1,
      2,
      2,
      3,
      3,
      3,
      3,
      3,
      2,
      1,
      1
    ],
    "keywords": [
      "троегуб",
      "конь губар",
      "конь-губар",
      "конь-губарь",
      "троегуб конь губарь пестрый"
    ],
    "gear": "Речной фидер, червь, кукуруза, резка",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "parabramis",
    "name": "Лещ амурский (белый / черный)",
    "group": "peace",
    "type": "peace",
    "habitat": "fresh",
    "legal": "free",
    "basins": [
      "amur"
    ],
    "waters": [
      "big_river",
      "tundra_lake"
    ],
    "optT": [
      16,
      24
    ],
    "tMinStop": 4,
    "coldBonus": -10,
    "monthActivity": [
      0,
      0,
      1,
      2,
      3,
      2,
      3,
      3,
      3,
      2,
      0,
      0
    ],
    "keywords": [
      "амурский лещ",
      "белый лещ",
      "лещ амурский",
      "белый",
      "черный",
      "лещ амурский белый черный"
    ],
    "gear": "Фидер, донка, кукуруза, пеллетс, червь",
    "win": "06:30–10:00 и 16:30–20:00 (зорьки)"
  },
  {
    "id": "haddock",
    "name": "Пикша",
    "group": "sea",
    "type": "predator",
    "habitat": "sea",
    "legal": "free",
    "basins": [
      "barents_white"
    ],
    "waters": [
      "open_sea",
      "sea_gulf"
    ],
    "optT": [
      2,
      9
    ],
    "tMinStop": 0,
    "coldBonus": 14,
    "monthActivity": [
      2,
      2,
      2,
      3,
      3,
      3,
      3,
      3,
      3,
      2,
      2,
      2
    ],
    "keywords": [
      "пикш",
      "пикша"
    ],
    "gear": "Морской джиг, ставки с подсадкой креветки или кальмара.",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "saithe",
    "name": "Сайда",
    "group": "sea",
    "type": "predator",
    "habitat": "sea",
    "legal": "free",
    "basins": [
      "barents_white"
    ],
    "waters": [
      "open_sea",
      "sea_gulf"
    ],
    "optT": [
      3,
      10
    ],
    "tMinStop": 0.5,
    "coldBonus": 12,
    "monthActivity": [
      1,
      1,
      2,
      2,
      3,
      3,
      3,
      3,
      3,
      2,
      1,
      1
    ],
    "keywords": [
      "сайд",
      "сайда"
    ],
    "gear": "Скоростной отвесное блеснение в толще воды, перьевые оснастки.",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "wolffish",
    "name": "Зубатка (полосатая / пятнистая)",
    "group": "sea",
    "type": "predator",
    "habitat": "sea",
    "legal": "free",
    "basins": [
      "baltic",
      "barents_white"
    ],
    "waters": [
      "open_sea"
    ],
    "optT": [
      0,
      7
    ],
    "tMinStop": -1,
    "coldBonus": 16,
    "monthActivity": [
      2,
      2,
      3,
      3,
      3,
      3,
      2,
      2,
      3,
      3,
      2,
      2
    ],
    "keywords": [
      "зубатк",
      "зубатка",
      "полосатая",
      "пятнистая"
    ],
    "gear": "Морская донная стукалка с филе сайды или морским гребешком.",
    "win": "В течение всего дня (пик 08:00–16:00)"
  },
  {
    "id": "plaice",
    "name": "Камбала морская (Ершоватка)",
    "group": "sea",
    "type": "predator",
    "habitat": "sea",
    "legal": "free",
    "basins": [
      "baltic",
      "barents_white"
    ],
    "waters": [
      "open_sea",
      "sea_gulf"
    ],
    "optT": [
      2,
      11
    ],
    "tMinStop": 0,
    "coldBonus": 12,
    "monthActivity": [
      2,
      2,
      2,
      3,
      3,
      3,
      3,
      3,
      3,
      2,
      2,
      2
    ],
    "keywords": [
      "морская камбал",
      "ершоватк",
      "камбала морская",
      "ершоватка"
    ],
    "gear": "Донная снасть с яркими бусинами, пескожил, креветка.",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "capelin",
    "name": "Мойва (Уёк)",
    "group": "sea",
    "type": "peace",
    "habitat": "sea",
    "legal": "free",
    "basins": [
      "barents_white",
      "pacific_sea"
    ],
    "waters": [
      "sea_gulf"
    ],
    "optT": [
      1,
      8
    ],
    "tMinStop": -1,
    "coldBonus": 16,
    "monthActivity": [
      1,
      2,
      3,
      3,
      3,
      3,
      1,
      1,
      1,
      1,
      1,
      1
    ],
    "keywords": [
      "мойв",
      "уек",
      "мойва"
    ],
    "gear": "Сачок на накатной волне, мелкий самодур.",
    "win": "08:00–13:00 и 15:30–18:00"
  },
  {
    "id": "saffron_cod",
    "name": "Сайка (Полярная тресочка)",
    "group": "sea",
    "type": "predator",
    "habitat": "sea",
    "legal": "free",
    "basins": [
      "arctic_ob_taz",
      "barents_white",
      "yenisei_lena"
    ],
    "waters": [
      "open_sea",
      "sea_gulf"
    ],
    "optT": [
      -1.5,
      5
    ],
    "tMinStop": -1.8,
    "coldBonus": 24,
    "monthActivity": [
      3,
      3,
      3,
      2,
      1,
      1,
      1,
      1,
      2,
      3,
      3,
      3
    ],
    "keywords": [
      "сайк",
      "полярная тресочк",
      "сайка",
      "полярная тресочка",
      "сайка полярная тресочка"
    ],
    "gear": "Зимняя блесна, мормышка с кусочком креветки или рыбы.",
    "win": "В течение всего дня (пик 08:00–16:00)"
  },
  {
    "id": "eel",
    "name": "Угорь речной европейский",
    "group": "predator",
    "type": "predator",
    "habitat": "fresh",
    "legal": "redbook",
    "basins": [
      "baltic",
      "black_azov",
      "nw_karelia"
    ],
    "waters": [
      "big_river",
      "quarry",
      "sea_gulf"
    ],
    "optT": [
      14,
      22
    ],
    "tMinStop": 4,
    "coldBonus": -14,
    "monthActivity": [
      0,
      0,
      1,
      2,
      3,
      3,
      3,
      3,
      3,
      2,
      0,
      0
    ],
    "keywords": [
      "угорь",
      "угря",
      "угорь речной европейский",
      "угорь речной европейский змея"
    ],
    "gear": "Целенаправленный любительский лов запрещён (Красная книга РФ). Часто попадается в прилове при ловле других видов на спиннинг, донные и поплавочные снасти — при поимке используйте безбородые крючки или обрежьте поводок у губы для безопасного выпуска.",
    "win": "18:30–02:30 (сумерки и ночь)"
  }
];

const BOT_WATERS_DB = [{"name": "р. Седе-Яха", "cleanName": "Седе-Яха", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река малая", "defDepth": 1.4, "lat": 66.083, "lon": 76.68, "region": "Новый Уренгой"}, {"name": "р. Ево-Яха", "cleanName": "Ево-Яха", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река малая", "defDepth": 1.6, "lat": 66.071, "lon": 76.712, "region": "Новый Уренгой"}, {"name": "р. Тамчара-Яха", "cleanName": "Тамчара-Яха", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река малая", "defDepth": 1.3, "lat": 66.065, "lon": 76.63, "region": "Новый Уренгой"}, {"name": "оз. Молодёжное", "cleanName": "Молодёжное", "basin": "arctic_ob_taz", "wType": "tundra_lake", "typeTag": "Озеро", "defDepth": 1.8, "lat": 66.09, "lon": 76.69, "region": "Новый Уренгой"}, {"name": "Песчаные карьеры (Н. Уренгой)", "cleanName": "Карьеры Н. Уренгоя", "basin": "arctic_ob_taz", "wType": "quarry", "typeTag": "Карьер", "defDepth": 3.5, "lat": 66.055, "lon": 76.74, "region": "Новый Уренгой"}, {"name": "р. Тамбей-Яха", "cleanName": "Тамбей-Яха", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река малая", "defDepth": 1.2, "lat": 66.12, "lon": 76.55, "region": "ЯНАО / Новый Уренгой"}, {"name": "р. Варенга-Яха", "cleanName": "Варенга-Яха", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река малая", "defDepth": 1.8, "lat": 66.035, "lon": 77.52, "region": "Новый Уренгой / Коротчаево"}, {"name": "р. Арка-Табъяха", "cleanName": "Арка-Табъяха", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река малая", "defDepth": 1.7, "lat": 65.92, "lon": 76.42, "region": "Новый Уренгой (юг)"}, {"name": "р. Ямсовей", "cleanName": "Ямсовей", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.1, "lat": 65.65, "lon": 76.95, "region": "ЯНАО / Ямсовей"}, {"name": "р. Хадуттэ", "cleanName": "Хадуттэ", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.4, "lat": 66.48, "lon": 76.85, "region": "Новый Уренгой / Тазовский р-н"}, {"name": "р. Нгарка-Пыряяха", "cleanName": "Нгарка-Пыряяха", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2, "lat": 66.38, "lon": 77.95, "region": "ЯНАО / Уренгой"}, {"name": "р. Большая Хадырьяха", "cleanName": "Большая Хадырьяха", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.2, "lat": 65.82, "lon": 78.05, "region": "Коротчаево / Уренгой"}, {"name": "р. Пур (Коротчаево / Уренгой)", "cleanName": "Пур (Коротчаево)", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.5, "lat": 65.945, "lon": 78.18, "region": "Коротчаево / пгт. Уренгой"}, {"name": "оз. Ямылимуяганто", "cleanName": "Ямылимуяганто", "basin": "arctic_ob_taz", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 4.2, "lat": 65.78, "lon": 77.35, "region": "Пуровский р-н"}, {"name": "р. Правая Хетта", "cleanName": "Правая Хетта", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.2, "lat": 65.85, "lon": 74.5, "region": "Пангоды / Надымский р-н"}, {"name": "р. Пур (Тарко-Сале)", "cleanName": "Пур", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.2, "lat": 64.915, "lon": 77.78, "region": "Тарко-Сале"}, {"name": "р. Пяку-Пур", "cleanName": "Пяку-Пур", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.2, "lat": 64.9, "lon": 77.75, "region": "Тарко-Сале / Губкинский"}, {"name": "р. Айваседа-Пур", "cleanName": "Айваседа-Пур", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2, "lat": 64.91, "lon": 77.8, "region": "Тарко-Сале"}, {"name": "р. Таз", "cleanName": "Таз", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.8, "lat": 67.45, "lon": 78.7, "region": "п. Тазовский"}, {"name": "р. Надым", "cleanName": "Надым", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 3.8, "lat": 65.533, "lon": 72.52, "region": "г. Надым"}, {"name": "оз. Янтарное", "cleanName": "Янтарное", "basin": "arctic_ob_taz", "wType": "tundra_lake", "typeTag": "Озеро", "defDepth": 2.1, "lat": 65.54, "lon": 72.5, "region": "г. Надым"}, {"name": "оз. Ханто", "cleanName": "Ханто", "basin": "arctic_ob_taz", "wType": "tundra_lake", "typeTag": "Озеро", "defDepth": 2.5, "lat": 63.22, "lon": 75.43, "region": "г. Ноябрьск"}, {"name": "оз. Светлое (Ноябрьск)", "cleanName": "Светлое", "basin": "arctic_ob_taz", "wType": "quarry", "typeTag": "Озеро / Карьер", "defDepth": 4, "lat": 63.16, "lon": 75.38, "region": "г. Ноябрьск"}, {"name": "р. Нанкпёх", "cleanName": "Нанкпёх", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река малая", "defDepth": 1.3, "lat": 63.2, "lon": 75.4, "region": "г. Ноябрьск"}, {"name": "р. Обь (Салехард)", "cleanName": "Обь", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 7.5, "lat": 66.53, "lon": 66.6, "region": "Салехард / Лабытнанги"}, {"name": "р. Полуй", "cleanName": "Полуй", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.4, "lat": 66.52, "lon": 66.62, "region": "Салехард"}, {"name": "р. Собь", "cleanName": "Собь", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река малая", "defDepth": 1.8, "lat": 66.82, "lon": 65.8, "region": "Харп / Полярный Урал"}, {"name": "р. Обь (Сургут)", "cleanName": "Обь", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 6.8, "lat": 61.25, "lon": 73.4, "region": "Сургут"}, {"name": "вдхр. Сургутской ГРЭС", "cleanName": "Сургутская ГРЭС (тёплый канал)", "basin": "arctic_ob_taz", "wType": "cooling_reservoir", "typeTag": "ГРЭС", "defDepth": 3.5, "lat": 61.28, "lon": 73.5, "region": "Сургут"}, {"name": "р. Тромъёган", "cleanName": "Тромъёган", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.5, "lat": 61.42, "lon": 73.8, "region": "Сургутский р-н"}, {"name": "р. Обь (Нижневартовск)", "cleanName": "Обь", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 6.5, "lat": 60.93, "lon": 76.55, "region": "Нижневартовск"}, {"name": "оз. Самотлор", "cleanName": "Самотлор", "basin": "arctic_ob_taz", "wType": "tundra_lake", "typeTag": "Озеро", "defDepth": 2, "lat": 61.12, "lon": 76.75, "region": "Нижневартовск"}, {"name": "р. Вах", "cleanName": "Вах", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4, "lat": 60.98, "lon": 76.9, "region": "ХМАО-Югра"}, {"name": "р. Иртыш (Ханты-Мансийск)", "cleanName": "Иртыш", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 6, "lat": 61, "lon": 69.02, "region": "Ханты-Мансийск"}, {"name": "р. Конда", "cleanName": "Конда", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 3.8, "lat": 60.68, "lon": 68.05, "region": "ХМАО"}, {"name": "р. Иртыш (Тобольск)", "cleanName": "Иртыш", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 5.5, "lat": 58.19, "lon": 68.25, "region": "Тобольск"}, {"name": "р. Тура (Тюмень)", "cleanName": "Тура", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 3.6, "lat": 57.155, "lon": 65.535, "region": "Тюмень"}, {"name": "оз. Андреевское (Тюмень)", "cleanName": "Андреевское озеро", "basin": "arctic_ob_taz", "wType": "tundra_lake", "typeTag": "Озеро", "defDepth": 2.2, "lat": 57.05, "lon": 65.77, "region": "Тюмень"}, {"name": "р. Пышма", "cleanName": "Пышма", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2, "lat": 56.98, "lon": 65.38, "region": "Тюменская обл."}, {"name": "р. Исеть (Екатеринбург)", "cleanName": "Исеть", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.2, "lat": 56.835, "lon": 60.605, "region": "Екатеринбург"}, {"name": "Белоярское вдхр. (БАЭС)", "cleanName": "Белоярское вдхр.", "basin": "arctic_ob_taz", "wType": "cooling_reservoir", "typeTag": "ГРЭС/АЭС", "defDepth": 6.5, "lat": 56.85, "lon": 61.3, "region": "Заречный / Екатеринбург"}, {"name": "Рефтинское вдхр. (ГРЭС)", "cleanName": "Рефтинское вдхр.", "basin": "arctic_ob_taz", "wType": "cooling_reservoir", "typeTag": "ГРЭС", "defDepth": 5.2, "lat": 57.1, "lon": 61.7, "region": "Рефтинский / Свердловская обл."}, {"name": "р. Иртыш (Омск)", "cleanName": "Иртыш (Омск)", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.8, "lat": 54.99, "lon": 73.36, "region": "Омск"}, {"name": "р. Омь", "cleanName": "Омь", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.1, "lat": 54.995, "lon": 73.38, "region": "Омск"}, {"name": "р. Обь (Новосибирск)", "cleanName": "Обь (Новосибирск)", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 5.5, "lat": 55.01, "lon": 82.92, "region": "Новосибирск"}, {"name": "Новосибирское вдхр. (Обское море)", "cleanName": "Обское море", "basin": "arctic_ob_taz", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 7.5, "lat": 54.75, "lon": 82.85, "region": "Бердск / Новосибирск"}, {"name": "р. Бердь", "cleanName": "Бердь", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.4, "lat": 54.76, "lon": 83.1, "region": "Бердск"}, {"name": "р. Томь (Томск / Кемерово)", "cleanName": "Томь", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.2, "lat": 56.48, "lon": 84.95, "region": "Томск"}, {"name": "р. Обь (Барнаул)", "cleanName": "Обь (Барнаул)", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.8, "lat": 53.34, "lon": 83.78, "region": "Барнаул"}, {"name": "оз. Телецкое", "cleanName": "Телецкое озеро", "basin": "arctic_ob_taz", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 16, "lat": 51.78, "lon": 87.26, "region": "Республика Алтай"}, {"name": "р. Бия", "cleanName": "Бия", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.5, "lat": 52.54, "lon": 85.21, "region": "Бийск / Алтай"}, {"name": "Тазовская губа", "cleanName": "Тазовская губа", "basin": "arctic_ob_taz", "wType": "sea_gulf", "typeTag": "Морская губа", "defDepth": 4.5, "lat": 68, "lon": 76, "region": "ЯНАО / Карское море"}, {"name": "Обская губа", "cleanName": "Обская губа", "basin": "arctic_ob_taz", "wType": "sea_gulf", "typeTag": "Морская губа", "defDepth": 6, "lat": 68.5, "lon": 73.5, "region": "ЯНАО / Карское море"}, {"name": "р. Москва", "cleanName": "Москва-река", "basin": "volga_caspian", "wType": "big_river", "typeTag": "Река большая", "defDepth": 3.5, "lat": 55.75, "lon": 37.62, "region": "Москва"}, {"name": "р. Яуза", "cleanName": "Яуза", "basin": "volga_caspian", "wType": "small_river", "typeTag": "Река малая", "defDepth": 1.8, "lat": 55.755, "lon": 37.645, "region": "Москва"}, {"name": "р. Пахра", "cleanName": "Пахра", "basin": "volga_caspian", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.1, "lat": 55.44, "lon": 37.56, "region": "Подольск / Домодедово"}, {"name": "Пироговское вдхр.", "cleanName": "Пироговское вдхр.", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 5.2, "lat": 55.98, "lon": 37.7, "region": "Московская обл."}, {"name": "Клязьминское вдхр.", "cleanName": "Клязьминское вдхр.", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 4.8, "lat": 55.99, "lon": 37.58, "region": "Московская обл."}, {"name": "Истринское вдхр.", "cleanName": "Истринское вдхр.", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 6, "lat": 56.05, "lon": 36.8, "region": "Истра / Солнечногорск"}, {"name": "Можайское вдхр.", "cleanName": "Можайское вдхр.", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 6.5, "lat": 55.58, "lon": 35.85, "region": "Можайск"}, {"name": "Рузское вдхр.", "cleanName": "Рузское вдхр.", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 6.2, "lat": 55.78, "lon": 36.05, "region": "Руза"}, {"name": "Озернинское вдхр.", "cleanName": "Озернинское вдхр.", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 5.8, "lat": 55.77, "lon": 36.22, "region": "Рузский р-н"}, {"name": "оз. Сенеж", "cleanName": "Сенеж", "basin": "volga_caspian", "wType": "tundra_lake", "typeTag": "Озеро", "defDepth": 3, "lat": 56.19, "lon": 37.02, "region": "Солнечногорск"}, {"name": "Шатурские озёра (Шатурская ГРЭС)", "cleanName": "Шатурская ГРЭС (оз. Святое)", "basin": "volga_caspian", "wType": "cooling_reservoir", "typeTag": "ГРЭС", "defDepth": 3.8, "lat": 55.59, "lon": 39.55, "region": "Шатура"}, {"name": "Иваньковское вдхр. (Московское море)", "cleanName": "Иваньковское вдхр.", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 5.5, "lat": 56.75, "lon": 36.95, "region": "Дубна / Конаково"}, {"name": "Тёплый сброс Конаковской ГРЭС", "cleanName": "Конаковская ГРЭС", "basin": "volga_caspian", "wType": "cooling_reservoir", "typeTag": "ГРЭС", "defDepth": 3.5, "lat": 56.74, "lon": 36.78, "region": "Конаково"}, {"name": "р. Волга (Тверь)", "cleanName": "Волга", "basin": "volga_caspian", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.2, "lat": 56.86, "lon": 35.9, "region": "Тверь"}, {"name": "р. Тверца", "cleanName": "Тверца", "basin": "volga_caspian", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.1, "lat": 56.87, "lon": 35.92, "region": "Тверь"}, {"name": "оз. Плещеево", "cleanName": "Плещеево озеро", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 8, "lat": 56.76, "lon": 38.78, "region": "Переславль-Залесский"}, {"name": "р. Волга (Ярославль)", "cleanName": "Волга", "basin": "volga_caspian", "wType": "big_river", "typeTag": "Река большая", "defDepth": 5.8, "lat": 57.62, "lon": 39.89, "region": "Ярославль"}, {"name": "р. Которосль", "cleanName": "Которосль", "basin": "volga_caspian", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.2, "lat": 57.61, "lon": 39.88, "region": "Ярославль"}, {"name": "Рыбинское вдхр.", "cleanName": "Рыбинское вдхр.", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 6.8, "lat": 58.2, "lon": 38.5, "region": "Рыбинск / Череповец"}, {"name": "р. Ока (Серпухов / Кашира)", "cleanName": "Ока (Серпухов)", "basin": "volga_caspian", "wType": "big_river", "typeTag": "Река большая", "defDepth": 3.6, "lat": 54.88, "lon": 37.42, "region": "Серпухов"}, {"name": "р. Ока (Коломна)", "cleanName": "Ока", "basin": "volga_caspian", "wType": "big_river", "typeTag": "Река большая", "defDepth": 3.8, "lat": 55.08, "lon": 38.77, "region": "Коломна"}, {"name": "р. Ока (Рязань)", "cleanName": "Ока", "basin": "volga_caspian", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.2, "lat": 54.63, "lon": 39.75, "region": "Рязань"}, {"name": "р. Пра (Мещёра)", "cleanName": "Пра", "basin": "volga_caspian", "wType": "small_river", "typeTag": "Река малая", "defDepth": 1.8, "lat": 54.95, "lon": 40.15, "region": "Рязанская обл."}, {"name": "р. Клязьма (Владимир)", "cleanName": "Клязьма", "basin": "volga_caspian", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.2, "lat": 56.12, "lon": 40.41, "region": "Владимир"}, {"name": "р. Ока (Нижний Новгород)", "cleanName": "Ока", "basin": "volga_caspian", "wType": "big_river", "typeTag": "Река большая", "defDepth": 5, "lat": 56.32, "lon": 43.99, "region": "Нижний Новгород"}, {"name": "р. Волга (Нижний Новгород)", "cleanName": "Волга", "basin": "volga_caspian", "wType": "big_river", "typeTag": "Река большая", "defDepth": 6.5, "lat": 56.33, "lon": 44.01, "region": "Нижний Новгород"}, {"name": "р. Ветлуга", "cleanName": "Ветлуга", "basin": "volga_caspian", "wType": "big_river", "typeTag": "Река большая", "defDepth": 3.4, "lat": 56.85, "lon": 45.45, "region": "Нижегородская обл."}, {"name": "Горьковское вдхр.", "cleanName": "Горьковское вдхр.", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 6.2, "lat": 56.8, "lon": 43.4, "region": "Нижегородская обл."}, {"name": "Чебоксарское вдхр.", "cleanName": "Чебоксарское вдхр.", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 5.8, "lat": 56.14, "lon": 47.25, "region": "Чебоксары / Васильсурск"}, {"name": "р. Сура", "cleanName": "Сура", "basin": "volga_caspian", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.5, "lat": 55.85, "lon": 46.35, "region": "Чувашия / Пенза"}, {"name": "р. Волга (Казань)", "cleanName": "Волга", "basin": "volga_caspian", "wType": "big_river", "typeTag": "Река большая", "defDepth": 7.2, "lat": 55.79, "lon": 49.12, "region": "Казань"}, {"name": "р. Казанка", "cleanName": "Казанка", "basin": "volga_caspian", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2, "lat": 55.8, "lon": 49.11, "region": "Казань"}, {"name": "р. Свияга", "cleanName": "Свияга", "basin": "volga_caspian", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.4, "lat": 55.72, "lon": 48.65, "region": "Татарстан / Ульяновск"}, {"name": "р. Кама (Камское Устье)", "cleanName": "Камское Устье", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 9.5, "lat": 55.2, "lon": 49.28, "region": "Татарстан"}, {"name": "Нижнекамское вдхр. (Набережные Челны)", "cleanName": "Нижнекамское вдхр.", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 6.8, "lat": 55.7, "lon": 52.35, "region": "Набережные Челны"}, {"name": "р. Кама (Пермь)", "cleanName": "Кама", "basin": "volga_caspian", "wType": "big_river", "typeTag": "Река большая", "defDepth": 6.2, "lat": 58.01, "lon": 56.25, "region": "Пермь"}, {"name": "р. Чусовая", "cleanName": "Чусовая", "basin": "volga_caspian", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.4, "lat": 58.18, "lon": 56.85, "region": "Пермский край / Свердловская обл."}, {"name": "Камское вдхр.", "cleanName": "Камское вдхр.", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 6.5, "lat": 58.15, "lon": 56.35, "region": "Пермский край"}, {"name": "Куйбышевское вдхр. (Самара / Тольятти)", "cleanName": "Куйбышевское вдхр.", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 8.5, "lat": 53.2, "lon": 50.15, "region": "Самара"}, {"name": "р. Самара", "cleanName": "Самара", "basin": "volga_caspian", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.5, "lat": 53.18, "lon": 50.11, "region": "Самара"}, {"name": "р. Сок", "cleanName": "Сок", "basin": "volga_caspian", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.2, "lat": 53.41, "lon": 50.15, "region": "Самарская обл."}, {"name": "Саратовское вдхр.", "cleanName": "Саратовское вдхр.", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 7.8, "lat": 51.53, "lon": 46.03, "region": "Саратов / Балаково"}, {"name": "Волгоградское вдхр.", "cleanName": "Волгоградское вдхр.", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 8.2, "lat": 48.71, "lon": 44.51, "region": "Волгоград"}, {"name": "р. Волга (Астрахань / Дельта)", "cleanName": "Волга (Дельта)", "basin": "volga_caspian", "wType": "big_river", "typeTag": "Река большая", "defDepth": 5.5, "lat": 46.35, "lon": 48.04, "region": "Астрахань"}, {"name": "р. Бахтемир (Главный банк)", "cleanName": "Бахтемир", "basin": "volga_caspian", "wType": "big_river", "typeTag": "Река большая", "defDepth": 7, "lat": 45.95, "lon": 47.65, "region": "Астраханская обл."}, {"name": "р. Бузан", "cleanName": "Бузан", "basin": "volga_caspian", "wType": "big_river", "typeTag": "Река большая", "defDepth": 5, "lat": 46.55, "lon": 48.3, "region": "Астраханская обл."}, {"name": "р. Ахтуба (Волго-Ахтубинская пойма)", "cleanName": "Ахтуба", "basin": "volga_caspian", "wType": "big_river", "typeTag": "Река большая", "defDepth": 3.8, "lat": 48, "lon": 45.5, "region": "Ахтубинск / Харабали"}, {"name": "р. Белая (Уфа)", "cleanName": "Белая (Агидель)", "basin": "volga_caspian", "wType": "big_river", "typeTag": "Река большая", "defDepth": 3.6, "lat": 54.73, "lon": 55.97, "region": "Уфа"}, {"name": "р. Уфа (Караидель)", "cleanName": "Уфа (Уфимка)", "basin": "volga_caspian", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.5, "lat": 54.76, "lon": 56.05, "region": "Уфа"}, {"name": "Павловское вдхр.", "cleanName": "Павловское вдхр.", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 9, "lat": 55.42, "lon": 56.55, "region": "Башкортостан"}, {"name": "оз. Аслыкуль", "cleanName": "Аслыкуль", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Озеро", "defDepth": 4.5, "lat": 54.31, "lon": 54.58, "region": "Башкортостан"}, {"name": "р. Вятка (Киров)", "cleanName": "Вятка", "basin": "volga_caspian", "wType": "big_river", "typeTag": "Река большая", "defDepth": 3.2, "lat": 58.6, "lon": 49.66, "region": "Киров"}, {"name": "р. Урал (Оренбург)", "cleanName": "Урал", "basin": "volga_caspian", "wType": "big_river", "typeTag": "Река большая", "defDepth": 2.8, "lat": 51.77, "lon": 55.1, "region": "Оренбург"}, {"name": "Ириклинское вдхр.", "cleanName": "Ириклинское вдхр.", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 10, "lat": 51.78, "lon": 58.78, "region": "Оренбургская обл."}, {"name": "р. Урал (Магнитогорск)", "cleanName": "Урал", "basin": "volga_caspian", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.2, "lat": 53.42, "lon": 58.98, "region": "Магнитогорск"}, {"name": "оз. Увильды (Челябинск)", "cleanName": "Увильды", "basin": "arctic_ob_taz", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 11, "lat": 55.52, "lon": 60.5, "region": "Челябинская обл."}, {"name": "оз. Тургояк (Миасс)", "cleanName": "Тургояк", "basin": "arctic_ob_taz", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 14, "lat": 55.15, "lon": 60.06, "region": "Челябинская обл."}, {"name": "Шершнёвское вдхр. (Челябинск)", "cleanName": "Шершнёвское вдхр.", "basin": "arctic_ob_taz", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 5.5, "lat": 55.1, "lon": 61.33, "region": "Челябинск"}, {"name": "оз. Селигер", "cleanName": "Селигер", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 5.8, "lat": 57.2, "lon": 33.05, "region": "Осташков"}, {"name": "оз. Неро", "cleanName": "Неро", "basin": "volga_caspian", "wType": "tundra_lake", "typeTag": "Озеро", "defDepth": 1.5, "lat": 57.17, "lon": 39.43, "region": "Ростов Великий"}, {"name": "Каспийское море (Махачкала)", "cleanName": "Каспийское море", "basin": "volga_caspian", "wType": "sea_gulf", "typeTag": "Морской залив", "defDepth": 6.5, "lat": 42.98, "lon": 47.51, "region": "Махачкала"}, {"name": "Каспийское море (Дербент)", "cleanName": "Каспийское море", "basin": "volga_caspian", "wType": "open_sea", "typeTag": "Море", "defDepth": 12, "lat": 42.07, "lon": 48.29, "region": "Дербент"}, {"name": "Ладожское озеро", "cleanName": "Ладожское озеро", "basin": "nw_karelia", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 12, "lat": 60.5, "lon": 31, "region": "Приозерск / Шлиссельбург"}, {"name": "Онежское озеро", "cleanName": "Онежское озеро", "basin": "nw_karelia", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 14, "lat": 61.79, "lon": 34.37, "region": "Петрозаводск"}, {"name": "р. Нева", "cleanName": "Нева", "basin": "nw_karelia", "wType": "big_river", "typeTag": "Река большая", "defDepth": 6.5, "lat": 59.93, "lon": 30.34, "region": "Санкт-Петербург"}, {"name": "р. Вуокса", "cleanName": "Вуокса", "basin": "nw_karelia", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.5, "lat": 60.68, "lon": 30, "region": "Лосево / Приозерск"}, {"name": "оз. Отрадное", "cleanName": "Отрадное", "basin": "nw_karelia", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 7.5, "lat": 60.82, "lon": 30.2, "region": "Ленинградская обл."}, {"name": "р. Свирь", "cleanName": "Свирь", "basin": "nw_karelia", "wType": "big_river", "typeTag": "Река большая", "defDepth": 5.2, "lat": 60.91, "lon": 34.17, "region": "Подпорожье"}, {"name": "р. Волхов", "cleanName": "Волхов", "basin": "nw_karelia", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.8, "lat": 60.1, "lon": 32.3, "region": "Новая Ладога"}, {"name": "оз. Ильмень (Великий Новгород)", "cleanName": "Ильмень", "basin": "nw_karelia", "wType": "tundra_lake", "typeTag": "Озеро", "defDepth": 2.8, "lat": 58.28, "lon": 31.28, "region": "Великий Новгород"}, {"name": "оз. Сямозеро", "cleanName": "Сямозеро", "basin": "nw_karelia", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 6, "lat": 61.9, "lon": 33.15, "region": "Пряжинский р-н"}, {"name": "оз. Сегозеро", "cleanName": "Сегозеро", "basin": "nw_karelia", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 18, "lat": 63.3, "lon": 33.8, "region": "Медвежьегорский р-н"}, {"name": "оз. Выгозеро", "cleanName": "Выгозеро", "basin": "nw_karelia", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 7, "lat": 63.6, "lon": 34.7, "region": "Сегежа"}, {"name": "р. Суна", "cleanName": "Суна", "basin": "nw_karelia", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.2, "lat": 62.27, "lon": 33.98, "region": "Кивач"}, {"name": "р. Шуя (Карелия)", "cleanName": "Шуя", "basin": "nw_karelia", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2, "lat": 61.91, "lon": 34.25, "region": "Петрозаводск"}, {"name": "оз. Пяозеро / Топозеро", "cleanName": "Пяозеро", "basin": "nw_karelia", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 15, "lat": 65.8, "lon": 31, "region": "Северная Карелия"}, {"name": "Баренцево море (Териберка)", "cleanName": "Баренцево море (Териберка)", "basin": "barents_white", "wType": "open_sea", "typeTag": "Море", "defDepth": 25, "lat": 69.17, "lon": 35.14, "region": "Териберка"}, {"name": "Кольский залив (Мурманск)", "cleanName": "Кольский залив", "basin": "barents_white", "wType": "sea_gulf", "typeTag": "Морской залив", "defDepth": 18, "lat": 68.97, "lon": 33.08, "region": "Мурманск"}, {"name": "Белое море (Кандалакшский залив)", "cleanName": "Кандалакшский залив", "basin": "barents_white", "wType": "sea_gulf", "typeTag": "Морской залив", "defDepth": 12, "lat": 67.15, "lon": 32.4, "region": "Кандалакша"}, {"name": "Белое море (Двинский залив / Северодвинск)", "cleanName": "Двинский залив", "basin": "barents_white", "wType": "sea_gulf", "typeTag": "Морской залив", "defDepth": 8.5, "lat": 64.6, "lon": 39.8, "region": "Северодвинск / Архангельск"}, {"name": "р. Северная Двина (Архангельск)", "cleanName": "Северная Двина", "basin": "barents_white", "wType": "big_river", "typeTag": "Река большая", "defDepth": 6.5, "lat": 64.54, "lon": 40.52, "region": "Архангельск"}, {"name": "р. Онега", "cleanName": "Онега", "basin": "barents_white", "wType": "big_river", "typeTag": "Река большая", "defDepth": 3.8, "lat": 63.9, "lon": 38.1, "region": "Онега"}, {"name": "р. Вычегда (Сыктывкар)", "cleanName": "Вычегда", "basin": "barents_white", "wType": "big_river", "typeTag": "Река большая", "defDepth": 3.5, "lat": 61.67, "lon": 50.83, "region": "Сыктывкар"}, {"name": "р. Кола", "cleanName": "Кола", "basin": "barents_white", "wType": "small_river", "typeTag": "Река малая", "defDepth": 1.8, "lat": 68.88, "lon": 33.02, "region": "п. Молочный"}, {"name": "р. Тулома", "cleanName": "Тулома", "basin": "barents_white", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.5, "lat": 68.81, "lon": 32.81, "region": "Мурмаши"}, {"name": "р. Варзуга", "cleanName": "Варзуга", "basin": "barents_white", "wType": "small_river", "typeTag": "Река малая", "defDepth": 1.6, "lat": 66.4, "lon": 36.58, "region": "Терский берег"}, {"name": "р. Умба", "cleanName": "Умба", "basin": "barents_white", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2, "lat": 66.68, "lon": 34.35, "region": "Терский берег"}, {"name": "р. Поной", "cleanName": "Поной", "basin": "barents_white", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.2, "lat": 67.07, "lon": 39.5, "region": "Кольский п-ов"}, {"name": "оз. Имандра", "cleanName": "Имандра", "basin": "barents_white", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 10, "lat": 67.6, "lon": 33.1, "region": "Апатиты / Мончегорск"}, {"name": "оз. Ловозеро", "cleanName": "Ловозеро", "basin": "barents_white", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 8, "lat": 67.85, "lon": 35.15, "region": "Ловозерский р-н"}, {"name": "р. Печора (Нарьян-Мар)", "cleanName": "Печора", "basin": "barents_white", "wType": "big_river", "typeTag": "Река большая", "defDepth": 6, "lat": 67.64, "lon": 53, "region": "Ненецкий АО"}, {"name": "р. Печора (г. Печора / Усинск)", "cleanName": "Печора", "basin": "barents_white", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.8, "lat": 65.14, "lon": 57.22, "region": "Республика Коми"}, {"name": "р. Уса (Усинск)", "cleanName": "Уса", "basin": "barents_white", "wType": "big_river", "typeTag": "Река большая", "defDepth": 3.8, "lat": 65.98, "lon": 57.55, "region": "Усинск / Инта"}, {"name": "р. Дон (Ростов-на-Дону)", "cleanName": "Дон", "basin": "black_azov", "wType": "big_river", "typeTag": "Река большая", "defDepth": 5.5, "lat": 47.22, "lon": 39.72, "region": "Ростов-на-Дону"}, {"name": "р. Дон (Воронеж)", "cleanName": "Дон", "basin": "black_azov", "wType": "big_river", "typeTag": "Река большая", "defDepth": 3.8, "lat": 50.98, "lon": 39.5, "region": "Лиски / Воронеж"}, {"name": "р. Воронеж (Воронежское вдхр.)", "cleanName": "Воронежское вдхр.", "basin": "black_azov", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 4.2, "lat": 51.67, "lon": 39.2, "region": "Воронеж"}, {"name": "Нововоронежское вдхр. (АЭС)", "cleanName": "Нововоронежская АЭС", "basin": "black_azov", "wType": "cooling_reservoir", "typeTag": "ГРЭС/АЭС", "defDepth": 4.8, "lat": 51.27, "lon": 39.2, "region": "Нововоронеж"}, {"name": "Цимлянское вдхр.", "cleanName": "Цимлянское вдхр.", "basin": "black_azov", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 8, "lat": 47.6, "lon": 42.1, "region": "Волгодонск"}, {"name": "р. Маныч (Весёловское вдхр.)", "cleanName": "Маныч", "basin": "black_azov", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 4.2, "lat": 47.1, "lon": 40.8, "region": "п. Весёлый"}, {"name": "р. Северский Донец", "cleanName": "Северский Донец", "basin": "black_azov", "wType": "big_river", "typeTag": "Река большая", "defDepth": 3.2, "lat": 48.32, "lon": 40.26, "region": "Каменск-Шахтинский"}, {"name": "р. Кубань (Краснодар)", "cleanName": "Кубань", "basin": "black_azov", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4, "lat": 45.03, "lon": 38.98, "region": "Краснодар"}, {"name": "Краснодарское вдхр. (Кубанское море)", "cleanName": "Краснодарское вдхр.", "basin": "black_azov", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 6.2, "lat": 44.98, "lon": 39.25, "region": "Краснодар"}, {"name": "р. Кубань (Темрюк / дельта)", "cleanName": "Кубань (Дельта)", "basin": "black_azov", "wType": "big_river", "typeTag": "Река большая", "defDepth": 3.5, "lat": 45.27, "lon": 37.38, "region": "Темрюк"}, {"name": "Бейсугский лиман / р. Бейсуг", "cleanName": "Бейсугский лиман", "basin": "black_azov", "wType": "tundra_lake", "typeTag": "Лиман / Старица", "defDepth": 1.8, "lat": 46.08, "lon": 38.55, "region": "Приморско-Ахтарск"}, {"name": "Чёрное море (Севастопольские бухты)", "cleanName": "Севастопольские бухты", "basin": "black_azov", "wType": "sea_gulf", "typeTag": "Морской залив", "defDepth": 8.5, "lat": 44.62, "lon": 33.53, "region": "Севастополь"}, {"name": "р. Чёрная (Инкерман)", "cleanName": "р. Чёрная", "basin": "black_azov", "wType": "small_river", "typeTag": "Река малая", "defDepth": 1.5, "lat": 44.61, "lon": 33.6, "region": "Севастополь / Инкерман"}, {"name": "Симферопольское вдхр.", "cleanName": "Симферопольское вдхр.", "basin": "black_azov", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 6.5, "lat": 44.92, "lon": 34.15, "region": "Симферополь"}, {"name": "Чёрное море (ЮБК / Ялта)", "cleanName": "Чёрное море (ЮБК)", "basin": "black_azov", "wType": "open_sea", "typeTag": "Море", "defDepth": 15, "lat": 44.5, "lon": 34.17, "region": "Ялта"}, {"name": "Керченский пролив", "cleanName": "Керченский пролив", "basin": "black_azov", "wType": "sea_gulf", "typeTag": "Морской пролив", "defDepth": 7.5, "lat": 45.32, "lon": 36.48, "region": "Керчь / Тамань"}, {"name": "Цемесская бухта (Новороссийск)", "cleanName": "Цемесская бухта", "basin": "black_azov", "wType": "sea_gulf", "typeTag": "Морской залив", "defDepth": 12, "lat": 44.72, "lon": 37.78, "region": "Новороссийск"}, {"name": "Чёрное море (Сочи / Адлер)", "cleanName": "Чёрное море (Сочи)", "basin": "black_azov", "wType": "open_sea", "typeTag": "Море", "defDepth": 16, "lat": 43.59, "lon": 39.73, "region": "Сочи"}, {"name": "р. Мзымта", "cleanName": "Мзымта", "basin": "black_azov", "wType": "small_river", "typeTag": "Река малая", "defDepth": 1.8, "lat": 43.42, "lon": 39.92, "region": "Адлер"}, {"name": "р. Сочи", "cleanName": "р. Сочи", "basin": "black_azov", "wType": "small_river", "typeTag": "Река малая", "defDepth": 1.4, "lat": 43.595, "lon": 39.735, "region": "Сочи"}, {"name": "Азовское море (Таганрогский залив)", "cleanName": "Таганрогский залив", "basin": "black_azov", "wType": "sea_gulf", "typeTag": "Морской залив", "defDepth": 4.5, "lat": 47.2, "lon": 38.92, "region": "Таганрог"}, {"name": "Ейский лиман", "cleanName": "Ейский лиман", "basin": "black_azov", "wType": "sea_gulf", "typeTag": "Морской лиман", "defDepth": 2.8, "lat": 46.7, "lon": 38.3, "region": "Ейск"}, {"name": "оз. Абрау", "cleanName": "Абрау", "basin": "black_azov", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 7, "lat": 44.7, "lon": 37.6, "region": "Абрау-Дюрсо"}, {"name": "Финский залив (Маркизова лужа)", "cleanName": "Финский залив", "basin": "baltic", "wType": "sea_gulf", "typeTag": "Морской залив", "defDepth": 5.5, "lat": 59.95, "lon": 30.2, "region": "Санкт-Петербург"}, {"name": "Финский залив (Дамба КЗС / Кронштадт)", "cleanName": "Дамба Кронштадт", "basin": "baltic", "wType": "sea_gulf", "typeTag": "Морской залив", "defDepth": 7.5, "lat": 60.01, "lon": 29.74, "region": "Кронштадт"}, {"name": "Выборгский залив", "cleanName": "Выборгский залив", "basin": "baltic", "wType": "sea_gulf", "typeTag": "Морской залив", "defDepth": 7.2, "lat": 60.71, "lon": 28.75, "region": "Выборг"}, {"name": "р. Луга (Усть-Луга)", "cleanName": "Луга", "basin": "baltic", "wType": "big_river", "typeTag": "Река большая", "defDepth": 3.5, "lat": 59.68, "lon": 28.3, "region": "Кингисеппский р-н"}, {"name": "р. Нарва (Ивангород)", "cleanName": "Нарва", "basin": "baltic", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.2, "lat": 59.38, "lon": 28.2, "region": "Ивангород"}, {"name": "Куршский залив", "cleanName": "Куршский залив", "basin": "baltic", "wType": "sea_gulf", "typeTag": "Морской залив", "defDepth": 3.8, "lat": 54.96, "lon": 20.47, "region": "Зеленоградск / Коса"}, {"name": "Балтийское море (Балтийск / Янтарный)", "cleanName": "Балтийское море", "basin": "baltic", "wType": "open_sea", "typeTag": "Море", "defDepth": 14, "lat": 54.64, "lon": 19.89, "region": "Калининградская обл."}, {"name": "Калининградский (Вислинский) залив", "cleanName": "Калининградский залив", "basin": "baltic", "wType": "sea_gulf", "typeTag": "Морской залив", "defDepth": 3.5, "lat": 54.65, "lon": 20.15, "region": "Калининград"}, {"name": "р. Преголя", "cleanName": "Преголя", "basin": "baltic", "wType": "big_river", "typeTag": "Река большая", "defDepth": 3.2, "lat": 54.71, "lon": 20.51, "region": "Калининград"}, {"name": "р. Дейма / Матросовка", "cleanName": "Дейма", "basin": "baltic", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.8, "lat": 54.82, "lon": 21.1, "region": "Полесск"}, {"name": "оз. Чудско-Псковское", "cleanName": "Чудское озеро", "basin": "baltic", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 6.5, "lat": 57.82, "lon": 28.33, "region": "Псков"}, {"name": "р. Великая", "cleanName": "Великая", "basin": "baltic", "wType": "big_river", "typeTag": "Река большая", "defDepth": 2.8, "lat": 57.81, "lon": 28.32, "region": "Псков"}, {"name": "р. Енисей (Красноярск)", "cleanName": "Енисей", "basin": "yenisei_lena", "wType": "big_river", "typeTag": "Река большая", "defDepth": 6.8, "lat": 56.01, "lon": 92.87, "region": "Красноярск"}, {"name": "Красноярское вдхр.", "cleanName": "Красноярское вдхр.", "basin": "yenisei_lena", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 16, "lat": 55.95, "lon": 92.35, "region": "Дивногорск"}, {"name": "р. Мана", "cleanName": "Мана", "basin": "yenisei_lena", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.2, "lat": 55.95, "lon": 92.48, "region": "Усть-Мана"}, {"name": "р. Кан", "cleanName": "Кан", "basin": "yenisei_lena", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.4, "lat": 56.2, "lon": 95.7, "region": "Канск / Зеленогорск"}, {"name": "оз. Белё / Шира (Хакасия)", "cleanName": "Белё", "basin": "yenisei_lena", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 9, "lat": 54.65, "lon": 90.15, "region": "Хакасия"}, {"name": "р. Енисей (Енисейск)", "cleanName": "Енисей", "basin": "yenisei_lena", "wType": "big_river", "typeTag": "Река большая", "defDepth": 8.5, "lat": 58.45, "lon": 92.17, "region": "Енисейск"}, {"name": "р. Енисей (Дудинка)", "cleanName": "Енисей (Низовья)", "basin": "yenisei_lena", "wType": "big_river", "typeTag": "Река большая", "defDepth": 12, "lat": 69.4, "lon": 86.18, "region": "Дудинка"}, {"name": "р. Норилка / оз. Лама (Норильск)", "cleanName": "Норилка / Лама", "basin": "yenisei_lena", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 14, "lat": 69.35, "lon": 88.2, "region": "Норильск / Талнах"}, {"name": "р. Ангара (Братское вдхр.)", "cleanName": "Ангара (Братское вдхр.)", "basin": "yenisei_lena", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 14, "lat": 56.15, "lon": 101.6, "region": "Братск"}, {"name": "р. Ангара (Усть-Илимское вдхр.)", "cleanName": "Усть-Илимское вдхр.", "basin": "yenisei_lena", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 12, "lat": 58, "lon": 102.7, "region": "Усть-Илимск"}, {"name": "р. Лена (Якутск)", "cleanName": "Лена", "basin": "yenisei_lena", "wType": "big_river", "typeTag": "Река большая", "defDepth": 7.5, "lat": 62.03, "lon": 129.73, "region": "Якутск"}, {"name": "р. Амга", "cleanName": "Амга", "basin": "yenisei_lena", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.5, "lat": 60.9, "lon": 131.98, "region": "Якутия"}, {"name": "р. Лена (Ленск)", "cleanName": "Лена", "basin": "yenisei_lena", "wType": "big_river", "typeTag": "Река большая", "defDepth": 5.8, "lat": 60.72, "lon": 114.93, "region": "Ленск"}, {"name": "р. Вилюй", "cleanName": "Вилюй", "basin": "yenisei_lena", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.5, "lat": 62.08, "lon": 120.42, "region": "Вилюйск"}, {"name": "р. Алдан", "cleanName": "Алдан", "basin": "yenisei_lena", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.8, "lat": 58.96, "lon": 126.28, "region": "Алдан / Томмот"}, {"name": "р. Ангара (Иркутск)", "cleanName": "Ангара (Иркутск)", "basin": "baikal", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.5, "lat": 52.285, "lon": 104.28, "region": "Иркутск"}, {"name": "Иркутское вдхр.", "cleanName": "Иркутское вдхр.", "basin": "baikal", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 8.5, "lat": 52.15, "lon": 104.45, "region": "Иркутск"}, {"name": "р. Иркут", "cleanName": "Иркут", "basin": "baikal", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.2, "lat": 52.26, "lon": 104.2, "region": "Иркутск / Шелехов"}, {"name": "оз. Байкал (Листвянка)", "cleanName": "Байкал (Листвянка)", "basin": "baikal", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 22, "lat": 51.85, "lon": 104.86, "region": "Листвянка"}, {"name": "оз. Байкал (Малое Море / Ольхон)", "cleanName": "Байкал (Малое Море)", "basin": "baikal", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 14, "lat": 53.2, "lon": 107.35, "region": "Ольхон"}, {"name": "оз. Байкал (Чивыркуйский залив)", "cleanName": "Чивыркуйский залив", "basin": "baikal", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 8.5, "lat": 53.7, "lon": 109.15, "region": "Забайкальский нацпарк"}, {"name": "оз. Байкал (Слюдянка)", "cleanName": "Байкал (Слюдянка)", "basin": "baikal", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 18, "lat": 51.66, "lon": 103.71, "region": "Слюдянка"}, {"name": "р. Селенга (Улан-Удэ / дельта)", "cleanName": "Селенга", "basin": "baikal", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.2, "lat": 51.83, "lon": 107.58, "region": "Улан-Удэ"}, {"name": "оз. Гусиное (Гусиноозёрская ГРЭС)", "cleanName": "Гусиное озеро (ГРЭС)", "basin": "baikal", "wType": "cooling_reservoir", "typeTag": "ГРЭС", "defDepth": 5.5, "lat": 51.2, "lon": 106.4, "region": "Гусиноозёрск"}, {"name": "р. Баргузин", "cleanName": "Баргузин", "basin": "baikal", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.6, "lat": 53.62, "lon": 109.62, "region": "Баргузинский р-н"}, {"name": "р. Снежная", "cleanName": "Снежная", "basin": "baikal", "wType": "small_river", "typeTag": "Река малая", "defDepth": 1.8, "lat": 51.48, "lon": 104.63, "region": "Байкальск"}, {"name": "оз. Котокель", "cleanName": "Котокель", "basin": "baikal", "wType": "tundra_lake", "typeTag": "Озеро", "defDepth": 3.5, "lat": 52.8, "lon": 108.15, "region": "Прибайкальский р-н"}, {"name": "р. Амур (Хабаровск)", "cleanName": "Амур", "basin": "amur", "wType": "big_river", "typeTag": "Река большая", "defDepth": 6.5, "lat": 48.48, "lon": 135.07, "region": "Хабаровск"}, {"name": "р. Анюй", "cleanName": "Анюй", "basin": "amur", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.4, "lat": 49.3, "lon": 136.5, "region": "Хабаровский край"}, {"name": "р. Хор", "cleanName": "Хор", "basin": "amur", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.5, "lat": 47.78, "lon": 134.96, "region": "Хабаровский край"}, {"name": "р. Амур (Благовещенск)", "cleanName": "Амур", "basin": "amur", "wType": "big_river", "typeTag": "Река большая", "defDepth": 5.2, "lat": 50.27, "lon": 127.54, "region": "Благовещенск"}, {"name": "р. Амур (Комсомольск-на-Амуре)", "cleanName": "Амур", "basin": "amur", "wType": "big_river", "typeTag": "Река большая", "defDepth": 7.2, "lat": 50.55, "lon": 137, "region": "Комсомольск"}, {"name": "р. Зея (Благовещенск)", "cleanName": "Зея", "basin": "amur", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.2, "lat": 50.3, "lon": 127.6, "region": "Благовещенск"}, {"name": "Зейское вдхр.", "cleanName": "Зейское вдхр.", "basin": "amur", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 14, "lat": 53.75, "lon": 127.25, "region": "г. Зея"}, {"name": "Бурейское вдхр.", "cleanName": "Бурейское вдхр.", "basin": "amur", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 12, "lat": 50.18, "lon": 130.3, "region": "п. Талакан"}, {"name": "р. Уссури", "cleanName": "Уссури", "basin": "amur", "wType": "big_river", "typeTag": "Река большая", "defDepth": 3.6, "lat": 45.46, "lon": 133.42, "region": "Лесозаводск"}, {"name": "оз. Ханка", "cleanName": "Ханка", "basin": "amur", "wType": "tundra_lake", "typeTag": "Озеро", "defDepth": 2.8, "lat": 44.99, "lon": 132.06, "region": "Камень-Рыболов"}, {"name": "оз. Болонь", "cleanName": "Болонь", "basin": "amur", "wType": "tundra_lake", "typeTag": "Озеро", "defDepth": 2.2, "lat": 49.85, "lon": 136.45, "region": "Амурский р-н"}, {"name": "Амурский залив (Владивосток)", "cleanName": "Амурский залив", "basin": "pacific_sea", "wType": "sea_gulf", "typeTag": "Морской залив", "defDepth": 14, "lat": 43.12, "lon": 131.88, "region": "Владивосток"}, {"name": "р. Раздольная (Суйфун)", "cleanName": "Раздольная", "basin": "pacific_sea", "wType": "big_river", "typeTag": "Река большая", "defDepth": 3.2, "lat": 43.35, "lon": 131.8, "region": "Уссурийск / Тавричанка"}, {"name": "Уссурийский залив (Шамора)", "cleanName": "Уссурийский залив", "basin": "pacific_sea", "wType": "sea_gulf", "typeTag": "Морской залив", "defDepth": 11, "lat": 43.19, "lon": 132.12, "region": "Владивосток"}, {"name": "Залив Находка", "cleanName": "Залив Находка", "basin": "pacific_sea", "wType": "sea_gulf", "typeTag": "Морской залив", "defDepth": 15, "lat": 42.82, "lon": 132.88, "region": "Находка"}, {"name": "Авачинская губа", "cleanName": "Авачинская губа", "basin": "pacific_sea", "wType": "sea_gulf", "typeTag": "Морская губа", "defDepth": 16, "lat": 53.02, "lon": 158.65, "region": "Петропавловск-Камчатский"}, {"name": "р. Авача", "cleanName": "Авача", "basin": "pacific_sea", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2, "lat": 53.18, "lon": 158.38, "region": "Елизово"}, {"name": "р. Паратунка", "cleanName": "Паратунка", "basin": "pacific_sea", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.2, "lat": 52.96, "lon": 158.25, "region": "Елизово / Камчатка"}, {"name": "р. Камчатка", "cleanName": "Камчатка", "basin": "pacific_sea", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.5, "lat": 56.32, "lon": 160.84, "region": "п. Ключи"}, {"name": "р. Быстрая (Большая)", "cleanName": "Быстрая (Большая)", "basin": "pacific_sea", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.4, "lat": 52.75, "lon": 156.3, "region": "Усть-Большерецк"}, {"name": "Охотское море (бухта Нагаева)", "cleanName": "Бухта Нагаева", "basin": "pacific_sea", "wType": "sea_gulf", "typeTag": "Морской залив", "defDepth": 18, "lat": 59.56, "lon": 150.8, "region": "Магадан"}, {"name": "Анивский залив", "cleanName": "Анивский залив", "basin": "pacific_sea", "wType": "sea_gulf", "typeTag": "Морской залив", "defDepth": 12, "lat": 46.62, "lon": 142.77, "region": "Корсаков / Сахалин"}, {"name": "оз. Тунайча (Сахалин)", "cleanName": "Тунайча", "basin": "pacific_sea", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 9, "lat": 46.82, "lon": 143.15, "region": "Южно-Сахалинск"}, {"name": "р. Лютога (Сахалин)", "cleanName": "Лютога", "basin": "pacific_sea", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2, "lat": 46.78, "lon": 142.52, "region": "Анива / Сахалин"}, {"name": "р. Тымь", "cleanName": "Тымь", "basin": "pacific_sea", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.2, "lat": 50.85, "lon": 142.68, "region": "Тымовское / Сахалин"}, {"name": "р. Днепр (Смоленск)", "cleanName": "Днепр", "basin": "euro_west", "wType": "big_river", "typeTag": "Река большая", "defDepth": 2.8, "lat": 54.78, "lon": 32.05, "region": "Смоленск"}, {"name": "Десногорское вдхр. (Смоленская АЭС)", "cleanName": "Десногорское вдхр.", "basin": "euro_west", "wType": "cooling_reservoir", "typeTag": "ГРЭС/АЭС", "defDepth": 6.5, "lat": 54.15, "lon": 33.28, "region": "Десногорск"}, {"name": "р. Десна (Брянск)", "cleanName": "Десна", "basin": "euro_west", "wType": "big_river", "typeTag": "Река большая", "defDepth": 3.2, "lat": 53.25, "lon": 34.37, "region": "Брянск"}, {"name": "р. Сейм (Курск)", "cleanName": "Сейм", "basin": "euro_west", "wType": "big_river", "typeTag": "Река большая", "defDepth": 2.6, "lat": 51.73, "lon": 36.19, "region": "Курск"}, {"name": "Курчатовское вдхр. (Курская АЭС)", "cleanName": "Курчатовское вдхр.", "basin": "euro_west", "wType": "cooling_reservoir", "typeTag": "ГРЭС/АЭС", "defDepth": 5.8, "lat": 51.65, "lon": 35.65, "region": "Курчатов"}, {"name": "р. Оскол", "cleanName": "Оскол", "basin": "euro_west", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.1, "lat": 51.3, "lon": 37.83, "region": "Старый Оскол"}, {"name": "Старооскольское вдхр.", "cleanName": "Старооскольское вдхр.", "basin": "euro_west", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 5.2, "lat": 51.4, "lon": 37.95, "region": "Старый Оскол"}, {"name": "Белгородское вдхр.", "cleanName": "Белгородское вдхр.", "basin": "euro_west", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 4.8, "lat": 50.59, "lon": 36.59, "region": "Белгород"}, {"name": "оз. Негито (Нигито)", "cleanName": "Озеро Негито", "basin": "arctic_ob_taz", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 5.5, "lat": 65.41, "lon": 77.12, "region": "Пуровский р-н / Коротчаево / Уренгой"}, {"name": "оз. Ямбуто (ЯНАО)", "cleanName": "Озеро Ямбуто", "basin": "arctic_ob_taz", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 6.2, "lat": 67.31, "lon": 74.15, "region": "Надымский / Тазовский р-н"}, {"name": "оз. Пякуто", "cleanName": "Озеро Пякуто", "basin": "arctic_ob_taz", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 5, "lat": 63.43, "lon": 73.12, "region": "Муравленко / Ноябрьск"}, {"name": "оз. Тету-Мамонтотяй", "cleanName": "Тету-Мамонтотяй", "basin": "arctic_ob_taz", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 5.8, "lat": 63.18, "lon": 74.82, "region": "Ноябрьск / Вынгапуровский"}, {"name": "оз. Вынглор", "cleanName": "Озеро Вынглор", "basin": "arctic_ob_taz", "wType": "tundra_lake", "typeTag": "Озеро", "defDepth": 2.8, "lat": 63.28, "lon": 76.1, "region": "Ноябрьск / Ханымей"}, {"name": "оз. Часельское", "cleanName": "Часельское озеро", "basin": "arctic_ob_taz", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 6, "lat": 65.45, "lon": 80.55, "region": "Красноселькупский / Пуровский р-н"}, {"name": "оз. Чёртово (Красноселькуп)", "cleanName": "Чёртово озеро", "basin": "arctic_ob_taz", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 7.5, "lat": 65.05, "lon": 81.9, "region": "Красноселькуп / Толька"}, {"name": "оз. Большое Щучье (Полярный Урал)", "cleanName": "Большое Щучье", "basin": "arctic_ob_taz", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 18, "lat": 67.89, "lon": 66.31, "region": "Полярный Урал / Харп"}, {"name": "оз. Шурышкарский Сор", "cleanName": "Шурышкарский Сор", "basin": "arctic_ob_taz", "wType": "tundra_lake", "typeTag": "Озеро / Сор", "defDepth": 2.4, "lat": 65.91, "lon": 65.18, "region": "Шурышкары / Мужи"}, {"name": "оз. Войкарский Сор", "cleanName": "Войкарский Сор", "basin": "arctic_ob_taz", "wType": "tundra_lake", "typeTag": "Озеро / Сор", "defDepth": 2.5, "lat": 65.72, "lon": 64.65, "region": "Горки / Мужи"}, {"name": "р. Таб-Яха", "cleanName": "Таб-Яха", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.3, "lat": 65.81, "lon": 76.32, "region": "Новый Уренгой / Лимбяяха"}, {"name": "р. Хейги-Яха (Лонгъюган)", "cleanName": "Хейги-Яха", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.2, "lat": 65.31, "lon": 73.85, "region": "Лонгъюган / Надым"}, {"name": "р. Мессояха", "cleanName": "Мессояха", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 3.8, "lat": 67.75, "lon": 77.5, "region": "Тазовский / Антипаюта"}, {"name": "р. Харампур", "cleanName": "Харампур", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.1, "lat": 64.31, "lon": 78.22, "region": "Харампур / Пуровский р-н"}, {"name": "р. Северная Сосьва", "cleanName": "Северная Сосьва", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.5, "lat": 63.93, "lon": 65.04, "region": "Берёзово / Игрим"}, {"name": "р. Казым (Белоярский)", "cleanName": "Казым", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.5, "lat": 63.71, "lon": 66.7, "region": "Белоярский (ХМАО)"}, {"name": "оз. Нумто", "cleanName": "Озеро Нумто", "basin": "arctic_ob_taz", "wType": "tundra_lake", "typeTag": "Озеро", "defDepth": 2.2, "lat": 63.52, "lon": 71.35, "region": "Белоярский р-н (ХМАО)"}, {"name": "оз. Сырковый Сор (Салым)", "cleanName": "Сырковый Сор", "basin": "arctic_ob_taz", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 4.5, "lat": 60.05, "lon": 71.32, "region": "Салым / Нефтеюганский р-н"}, {"name": "оз. Торм-Эмтор", "cleanName": "Торм-Эмтор", "basin": "arctic_ob_taz", "wType": "tundra_lake", "typeTag": "Озеро", "defDepth": 2.6, "lat": 61.55, "lon": 77.8, "region": "Нижневартовский р-н"}, {"name": "р. Бирь (Мишкино / Бирск)", "cleanName": "Бирь", "basin": "volga_caspian", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2, "lat": 55.43, "lon": 55.9, "region": "Мишкино / Бирск (Башкортостан)"}, {"name": "р. Уфа (Караидель / Чандар)", "cleanName": "Уфа (Караидель)", "basin": "volga_caspian", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.8, "lat": 55.83, "lon": 56.91, "region": "Караидель (Башкортостан)"}, {"name": "р. Быстрый Танып", "cleanName": "Быстрый Танып", "basin": "volga_caspian", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.2, "lat": 56.12, "lon": 54.58, "region": "Бураево / Янаул (Башкортостан)"}, {"name": "р. Дёма (Давлеканово / Чишмы)", "cleanName": "Дёма", "basin": "volga_caspian", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.3, "lat": 54.22, "lon": 55.03, "region": "Давлеканово / Чишмы (Башкортостан)"}, {"name": "р. Сим", "cleanName": "Сим", "basin": "volga_caspian", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.1, "lat": 54.62, "lon": 56.38, "region": "Иглино / Архангельское (Башкортостан)"}, {"name": "р. Инзер", "cleanName": "Инзер", "basin": "volga_caspian", "wType": "small_river", "typeTag": "Река малая", "defDepth": 1.9, "lat": 54.42, "lon": 57.18, "region": "Инзер / Архангельское (Башкортостан)"}, {"name": "р. Ай (Месягутово / Лаклы)", "cleanName": "Ай", "basin": "volga_caspian", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2, "lat": 55.55, "lon": 58.25, "region": "Месягутово / Дуванский р-н"}, {"name": "р. Юрюзань", "cleanName": "Юрюзань", "basin": "volga_caspian", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.1, "lat": 55.38, "lon": 57.9, "region": "Малояз / Салаватский р-н"}, {"name": "р. Ик (Октябрьский / Туймазы)", "cleanName": "Ик", "basin": "volga_caspian", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.4, "lat": 54.48, "lon": 53.47, "region": "Октябрьский / Бакалы (Башкортостан)"}, {"name": "оз. Аслыкуль (Башкортостан)", "cleanName": "Озеро Аслыкуль", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 5.5, "lat": 54.31, "lon": 54.58, "region": "Давлеканово (Башкортостан)"}, {"name": "оз. Кандрыкуль (Башкортостан)", "cleanName": "Озеро Кандрыкуль", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 6.5, "lat": 54.5, "lon": 54.05, "region": "Туймазы / Кандры (Башкортостан)"}, {"name": "оз. Банное (Якты-Куль)", "cleanName": "Озеро Банное", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 10, "lat": 53.59, "lon": 58.63, "region": "Абзелиловский р-н / Магнитогорск"}, {"name": "Нугушское вдхр.", "cleanName": "Нугушское вдхр.", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 9, "lat": 53.05, "lon": 56.45, "region": "Мелеуз / Нугуш (Башкортостан)"}, {"name": "Юмагузинское вдхр.", "cleanName": "Юмагузинское вдхр.", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 12, "lat": 52.96, "lon": 56.55, "region": "Кугарчинский р-н (Башкортостан)"}, {"name": "Кармановское вдхр. (ГРЭС)", "cleanName": "Кармановское вдхр.", "basin": "volga_caspian", "wType": "cooling_reservoir", "typeTag": "ГРЭС", "defDepth": 5.5, "lat": 56.22, "lon": 54.33, "region": "Нефтекамск / Янаул (Башкортостан)"}, {"name": "оз. Шамсутдин (Бирск)", "cleanName": "Озеро Шамсутдин", "basin": "volga_caspian", "wType": "tundra_lake", "typeTag": "Озеро / Старица", "defDepth": 3.2, "lat": 55.44, "lon": 55.48, "region": "Бирск / Мишкинский р-н"}, {"name": "р. Шахе (Головинка / Сочи)", "cleanName": "Шахе", "basin": "black_azov", "wType": "small_river", "typeTag": "Река малая", "defDepth": 1.6, "lat": 43.79, "lon": 39.46, "region": "Сочи / Лазаревское"}, {"name": "р. Сочи", "cleanName": "р. Сочи", "basin": "black_azov", "wType": "small_river", "typeTag": "Река малая", "defDepth": 1.5, "lat": 43.6, "lon": 39.73, "region": "Сочи"}, {"name": "р. Псоу (Адлер / Сириус)", "cleanName": "Псоу", "basin": "black_azov", "wType": "small_river", "typeTag": "Река малая", "defDepth": 1.7, "lat": 43.395, "lon": 40.01, "region": "Адлер / Сириус"}, {"name": "Имеретинская бухта (Сириус)", "cleanName": "Имеретинский порт (Сириус)", "basin": "black_azov", "wType": "sea_gulf", "typeTag": "Морской залив", "defDepth": 7.5, "lat": 43.4, "lon": 39.95, "region": "Адлер / Сириус"}, {"name": "р. Хоста (Сочи)", "cleanName": "Хоста", "basin": "black_azov", "wType": "small_river", "typeTag": "Река малая", "defDepth": 1.4, "lat": 43.515, "lon": 39.87, "region": "Хоста / Сочи"}, {"name": "Бейсугский лиман", "cleanName": "Бейсугский лиман", "basin": "black_azov", "wType": "sea_gulf", "typeTag": "Морской лиман", "defDepth": 2.2, "lat": 46.08, "lon": 38.45, "region": "Приморско-Ахтарск / Бриньковская"}, {"name": "Ахтанизовский лиман", "cleanName": "Ахтанизовский лиман", "basin": "black_azov", "wType": "tundra_lake", "typeTag": "Лиман пресный", "defDepth": 1.8, "lat": 45.31, "lon": 37.18, "region": "Темрюк / Голубицкая"}, {"name": "оз. Мишкинское (пгт. Мишкино)", "cleanName": "оз. Мишкинское", "basin": "arctic_ob_taz", "wType": "tundra_lake", "typeTag": "Озеро", "defDepth": 2.2, "lat": 55.342, "lon": 63.915, "region": "Мишкино (Курганская обл.)"}, {"name": "р. Миасс (Мишкинский / Каргапольский р-н)", "cleanName": "р. Миасс", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.3, "lat": 55.545, "lon": 63.885, "region": "Мишкинский р-н (Курганская обл.)"}, {"name": "оз. Песчаное (Шумихинский / Мишкинский р-н)", "cleanName": "оз. Песчаное", "basin": "arctic_ob_taz", "wType": "tundra_lake", "typeTag": "Озеро", "defDepth": 2.8, "lat": 55.435, "lon": 63.52, "region": "Мишкино / Шумиха (Курганская обл.)"}, {"name": "р. Юргамыш (Юргамыш / Мишкино)", "cleanName": "р. Юргамыш", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река малая", "defDepth": 1.8, "lat": 55.38, "lon": 64.465, "region": "Юргамыш / Мишкино (Курганская обл.)"}, {"name": "оз. Горькое-Пресное / Круглое (Шумиха)", "cleanName": "оз. Круглое (Шумиха)", "basin": "arctic_ob_taz", "wType": "tundra_lake", "typeTag": "Озеро", "defDepth": 2.5, "lat": 55.26, "lon": 63.28, "region": "Шумиха (Курганская обл.)"}, {"name": "р. Миасс (Чесноковка / Шумихинский р-н)", "cleanName": "р. Миасс (Шумиха)", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.2, "lat": 55.48, "lon": 63.25, "region": "Шумихинский р-н (Курганская обл.)"}, {"name": "р. Исеть (Шадринск / Далматово)", "cleanName": "р. Исеть (Шадринск)", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река средняя", "defDepth": 2.6, "lat": 56.082, "lon": 63.635, "region": "Шадринск (Курганская обл.)"}, {"name": "р. Канаш / оз. Боровое (Шадринск)", "cleanName": "р. Канаш (Шадринск)", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река малая", "defDepth": 1.8, "lat": 56.04, "lon": 63.59, "region": "Шадринск (Курганская обл.)"}, {"name": "р. Тобол (Курган)", "cleanName": "р. Тобол (Курган)", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.2, "lat": 55.438, "lon": 65.352, "region": "Курган"}, {"name": "Орловское вдхр. (Курганская ТЭЦ)", "cleanName": "Орловское вдхр.", "basin": "arctic_ob_taz", "wType": "cooling_reservoir", "typeTag": "ГРЭС/ТЭЦ", "defDepth": 3.8, "lat": 55.452, "lon": 65.412, "region": "Курган"}, {"name": "оз. Бездонное / Старица Тобола (Курган)", "cleanName": "оз. Бездонное", "basin": "arctic_ob_taz", "wType": "tundra_lake", "typeTag": "Озеро / Старица", "defDepth": 2.8, "lat": 55.385, "lon": 65.295, "region": "Курган"}, {"name": "р. Куртамыш (Куртамыш)", "cleanName": "р. Куртамыш", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река малая", "defDepth": 1.9, "lat": 54.912, "lon": 64.435, "region": "Куртамыш (Курганская обл.)"}, {"name": "оз. Большое Пустое / Птичанские озёра", "cleanName": "оз. Большое Пустое", "basin": "arctic_ob_taz", "wType": "tundra_lake", "typeTag": "Озеро", "defDepth": 2.4, "lat": 54.88, "lon": 64.35, "region": "Куртамышский р-н (Курганская обл.)"}, {"name": "оз. Башкирское / Пресное (Макушино)", "cleanName": "оз. Башкирское (Макушино)", "basin": "arctic_ob_taz", "wType": "tundra_lake", "typeTag": "Озеро", "defDepth": 2.3, "lat": 55.215, "lon": 67.25, "region": "Макушино (Курганская обл.)"}, {"name": "оз. Песчаное / Пресное (Петухово)", "cleanName": "оз. Песчаное (Петухово)", "basin": "arctic_ob_taz", "wType": "tundra_lake", "typeTag": "Озеро", "defDepth": 2.5, "lat": 55.085, "lon": 67.91, "region": "Петухово (Курганская обл.)"}, {"name": "оз. Мартыново / Бутырино (Частоозерье)", "cleanName": "оз. Мартыново", "basin": "arctic_ob_taz", "wType": "tundra_lake", "typeTag": "Озеро", "defDepth": 2.6, "lat": 55.572, "lon": 67.912, "region": "Частоозерье (Курганская обл.)"}, {"name": "оз. Чёрное (Мокроусово / Зауралье)", "cleanName": "оз. Чёрное (Зауралье)", "basin": "arctic_ob_taz", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 4.5, "lat": 55.62, "lon": 66.95, "region": "Курганская обл."}, {"name": "р. Тобол (Ялуторовск / Заводоуковск)", "cleanName": "р. Тобол (Ялуторовск)", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4, "lat": 56.65, "lon": 66.32, "region": "Ялуторовск / Заводоуковск"}, {"name": "оз. Сингуль (Ялуторовский р-н)", "cleanName": "оз. Сингуль", "basin": "arctic_ob_taz", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 4.5, "lat": 56.45, "lon": 66.05, "region": "Ялуторовск"}, {"name": "р. Вагай (Вагай)", "cleanName": "р. Вагай", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.4, "lat": 57.938, "lon": 69.025, "region": "Вагай (Тюменская обл.)"}, {"name": "р. Иртыш (Уват)", "cleanName": "р. Иртыш (Уват)", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 6.5, "lat": 59.142, "lon": 68.892, "region": "Уват (Тюменская обл.)"}, {"name": "р. Туртас (Туртас / Уват)", "cleanName": "р. Туртас", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.5, "lat": 58.945, "lon": 69.145, "region": "Туртас (Тюменская обл.)"}, {"name": "р. Демьянка (Демьянка)", "cleanName": "р. Демьянка", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.8, "lat": 59.548, "lon": 69.31, "region": "Демьянка (Тюменская обл.)"}, {"name": "р. Тобол (Ярково)", "cleanName": "р. Тобол (Ярково)", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.5, "lat": 57.41, "lon": 67.078, "region": "Ярково (Тюменская обл.)"}, {"name": "р. Тавда (Нижняя Тавда / Тавда)", "cleanName": "р. Тавда", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.2, "lat": 57.85, "lon": 65.7, "region": "Тавда / Нижняя Тавда"}, {"name": "р. Ишим (г. Ишим)", "cleanName": "р. Ишим", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 3.8, "lat": 56.11, "lon": 69.495, "region": "Ишим (Тюменская обл.)"}, {"name": "оз. Мергень / Старица Ишима", "cleanName": "оз. Мергень", "basin": "arctic_ob_taz", "wType": "tundra_lake", "typeTag": "Озеро / Старица", "defDepth": 2.5, "lat": 55.642, "lon": 69.238, "region": "Казанское / Ишим"}, {"name": "р. Чусовая / Волчихинское вдхр. (Ревда / Первоуральск)", "cleanName": "Волчихинское вдхр.", "basin": "arctic_ob_taz", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 5.5, "lat": 56.78, "lon": 60.02, "region": "Ревда / Екатеринбург"}, {"name": "Верхнемакаровское вдхр. (Полевской)", "cleanName": "Верхнемакаровское вдхр.", "basin": "arctic_ob_taz", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 5, "lat": 56.48, "lon": 60.22, "region": "Полевской (Свердловская обл.)"}, {"name": "р. Исеть / оз. Сунгуль (Каменск-Уральский)", "cleanName": "р. Исеть (Каменск-Уральский)", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река средняя", "defDepth": 2.5, "lat": 56.415, "lon": 61.918, "region": "Каменск-Уральский"}, {"name": "Черноисточинское вдхр. / Тагильский пруд (Нижний Тагил)", "cleanName": "Тагильский пруд", "basin": "arctic_ob_taz", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 6, "lat": 57.9, "lon": 59.95, "region": "Нижний Тагил"}, {"name": "р. Сосьва / Киселёвское вдхр. (Серов)", "cleanName": "р. Сосьва (Серов)", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река средняя", "defDepth": 2.8, "lat": 59.605, "lon": 60.58, "region": "Серов (Свердловская обл.)"}, {"name": "р. Сосьва (пгт. Сосьва)", "cleanName": "р. Сосьва", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 3.8, "lat": 59.178, "lon": 61.855, "region": "Сосьва (Свердловская обл.)"}, {"name": "р. Лозьва / р. Сосьва (Гари)", "cleanName": "р. Лозьва (Гари)", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.2, "lat": 59.432, "lon": 62.352, "region": "Гари (Свердловская обл.)"}, {"name": "р. Лозьва / р. Ивдель (Ивдель)", "cleanName": "р. Лозьва (Ивдель)", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река средняя", "defDepth": 2.5, "lat": 60.692, "lon": 60.422, "region": "Ивдель (Свердловская обл.)"}, {"name": "оз. Большие Касли / оз. Иткуль (Касли)", "cleanName": "оз. Большие Касли", "basin": "arctic_ob_taz", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 7.5, "lat": 55.895, "lon": 60.76, "region": "Касли (Челябинская обл.)"}, {"name": "Южноуральское вдхр. (Южноуральская ГРЭС)", "cleanName": "Южноуральское вдхр. (ГРЭС)", "basin": "arctic_ob_taz", "wType": "cooling_reservoir", "typeTag": "ГРЭС", "defDepth": 5.2, "lat": 54.445, "lon": 61.255, "region": "Южноуральск (Челябинская обл.)"}, {"name": "р. Иртыш (Тара)", "cleanName": "р. Иртыш (Тара)", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 5.5, "lat": 56.895, "lon": 74.375, "region": "Тара (Омская обл.)"}, {"name": "р. Омь (Калачинск)", "cleanName": "р. Омь (Калачинск)", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.2, "lat": 55.055, "lon": 74.578, "region": "Калачинск (Омская обл.)"}, {"name": "р. Иртыш (Черлак)", "cleanName": "р. Иртыш (Черлак)", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.8, "lat": 54.158, "lon": 74.808, "region": "Черлак (Омская обл.)"}, {"name": "Новосибирское вдхр. (Ордынское / Спирино)", "cleanName": "Обское море (Ордынское)", "basin": "arctic_ob_taz", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 7, "lat": 54.375, "lon": 81.905, "region": "Ордынское (Новосибирская обл.)"}, {"name": "р. Обь (Сузун / Камень-на-Оби)", "cleanName": "р. Обь (Сузун)", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 5.2, "lat": 53.785, "lon": 81.8, "region": "Сузун / Камень-на-Оби"}, {"name": "оз. Чаны (Чаны / Барабинск)", "cleanName": "оз. Чаны", "basin": "arctic_ob_taz", "wType": "quarry", "typeTag": "Озеро крупное", "defDepth": 4.2, "lat": 55.15, "lon": 77.55, "region": "Барабинск / Чаны (Новосибирская обл.)"}, {"name": "оз. Сартлан (Барабинский р-н)", "cleanName": "оз. Сартлан", "basin": "arctic_ob_taz", "wType": "quarry", "typeTag": "Озеро крупное", "defDepth": 4.5, "lat": 55.02, "lon": 78.58, "region": "Барабинск (Новосибирская обл.)"}, {"name": "р. Обь (Колпашево)", "cleanName": "р. Обь (Колпашево)", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 6.2, "lat": 58.318, "lon": 82.912, "region": "Колпашево (Томская обл.)"}, {"name": "р. Обь (Парабель / Каргасок)", "cleanName": "р. Обь (Парабель)", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 6.5, "lat": 58.85, "lon": 81.15, "region": "Парабель / Каргасок (Томская обл.)"}, {"name": "р. Томь (Кемерово / Юрга)", "cleanName": "р. Томь (Кемерово)", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4, "lat": 55.5, "lon": 85.5, "region": "Кемерово / Юрга"}, {"name": "р. Томь (Новокузнецк / Междуреченск)", "cleanName": "р. Томь (Новокузнецк)", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 3.8, "lat": 53.72, "lon": 87.55, "region": "Новокузнецк / Междуреченск"}, {"name": "р. Алей / Гилёвское вдхр. (Рубцовск)", "cleanName": "р. Алей (Рубцовск)", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река средняя", "defDepth": 2.4, "lat": 51.502, "lon": 81.21, "region": "Рубцовск (Алтайский край)"}, {"name": "р. Катунь (Горно-Алтайск / Майма)", "cleanName": "р. Катунь", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река горная", "defDepth": 2.8, "lat": 51.958, "lon": 85.955, "region": "Горно-Алтайск (Республика Алтай)"}, {"name": "р. Пяку-Пур / р. Пурпе (Губкинский / Пурпе)", "cleanName": "р. Пяку-Пур (Губкинский)", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река средняя", "defDepth": 2.5, "lat": 64.45, "lon": 76.58, "region": "Губкинский / Пурпе (ЯНАО)"}, {"name": "р. Пяку-Пур / оз. Городское (Муравленко)", "cleanName": "оз. Городское (Муравленко)", "basin": "arctic_ob_taz", "wType": "tundra_lake", "typeTag": "Озеро", "defDepth": 2.4, "lat": 63.794, "lon": 74.525, "region": "Муравленко (ЯНАО)"}, {"name": "р. Левая Хетта / р. Надым (Ягельный / Приозёрный)", "cleanName": "р. Левая Хетта", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.2, "lat": 64.82, "lon": 72.8, "region": "Ягельный / Приозёрный (ЯНАО)"}, {"name": "р. Хейги-Яха / р. Надым (Лонгъюган)", "cleanName": "р. Хейги-Яха (Лонгъюган)", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.2, "lat": 65.305, "lon": 71.2, "region": "Лонгъюган (ЯНАО)"}, {"name": "Обская губа / р. Ныда (Ныда / Нори / Заполярный)", "cleanName": "Обская губа (Ныда)", "basin": "arctic_ob_taz", "wType": "sea_gulf", "typeTag": "Морская губа", "defDepth": 4.5, "lat": 66.5, "lon": 73.1, "region": "Ныда / Заполярный (ЯНАО)"}, {"name": "р. Кутопьюган / Обская губа (Кутопьюган)", "cleanName": "р. Кутопьюган", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.2, "lat": 66.08, "lon": 71.2, "region": "Кутопьюган (ЯНАО)"}, {"name": "р. Пур (Самбург)", "cleanName": "р. Пур (Самбург)", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 5, "lat": 66.85, "lon": 78.225, "region": "Самбург (ЯНАО)"}, {"name": "Тазовская губа (Антипаюта)", "cleanName": "Тазовская губа (Антипаюта)", "basin": "arctic_ob_taz", "wType": "sea_gulf", "typeTag": "Морская губа", "defDepth": 5, "lat": 69.095, "lon": 76.855, "region": "Антипаюта (ЯНАО)"}, {"name": "Гыданская губа / р. Гыда (Гыда)", "cleanName": "Гыданская губа", "basin": "arctic_ob_taz", "wType": "sea_gulf", "typeTag": "Морская губа", "defDepth": 5.5, "lat": 70.892, "lon": 78.47, "region": "Гыда (ЯНАО)"}, {"name": "Обская губа / р. Сеяха (Сеяха)", "cleanName": "Обская губа (Сеяха)", "basin": "arctic_ob_taz", "wType": "sea_gulf", "typeTag": "Морская губа", "defDepth": 6, "lat": 70.165, "lon": 72.515, "region": "Сеяха (ЯНАО)"}, {"name": "Обская губа (Новый Порт)", "cleanName": "Обская губа (Новый Порт)", "basin": "arctic_ob_taz", "wType": "sea_gulf", "typeTag": "Морская губа", "defDepth": 5.5, "lat": 67.69, "lon": 72.9, "region": "Новый Порт (ЯНАО)"}, {"name": "Обская губа / р. Ярудей (Яр-Сале / Панаевск / Салемал)", "cleanName": "Обская дельта (Яр-Сале)", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 5.5, "lat": 66.8, "lon": 69.95, "region": "Яр-Сале / Панаевск (ЯНАО)"}, {"name": "р. Обь / р. Щучья (Аксарка / Белоярск)", "cleanName": "р. Обь (Аксарка)", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 7, "lat": 66.68, "lon": 67.95, "region": "Аксарка / Белоярск (ЯНАО)"}, {"name": "р. Таз (Красноселькуп)", "cleanName": "р. Таз (Красноселькуп)", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.8, "lat": 65.702, "lon": 82.463, "region": "Красноселькуп (ЯНАО)"}, {"name": "р. Таз (Толька)", "cleanName": "р. Таз (Толька)", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.2, "lat": 64, "lon": 82.06, "region": "Толька (ЯНАО)"}, {"name": "р. Еркал-Надей-Пур (Халясавэй)", "cleanName": "р. Еркал-Надей-Пур", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.4, "lat": 63.39, "lon": 78.38, "region": "Халясавэй (ЯНАО)"}, {"name": "р. Сыня / р. Малая Обь (Овгорт / Горки)", "cleanName": "р. Сыня (Овгорт)", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река средняя", "defDepth": 2.8, "lat": 64.95, "lon": 64.3, "region": "Овгорт / Горки (ЯНАО)"}, {"name": "р. Пим (Лянтор / Нижнесортымский)", "cleanName": "р. Пим", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река средняя", "defDepth": 2.5, "lat": 62, "lon": 71.95, "region": "Лянтор / Нижнесортымский (ХМАО)"}, {"name": "р. Обь / пр. Каюковская (Лангепас / Покачи)", "cleanName": "р. Обь (Лангепас)", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 6, "lat": 61.45, "lon": 75.35, "region": "Лангепас / Покачи (ХМАО)"}, {"name": "р. Аган (Радужный / Новоаганск)", "cleanName": "р. Аган", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.2, "lat": 62.05, "lon": 77.05, "region": "Радужный / Новоаганск (ХМАО)"}, {"name": "р. Ингуягун / оз. Когалымское (Когалым)", "cleanName": "р. Ингуягун (Когалым)", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.4, "lat": 62.265, "lon": 74.485, "region": "Когалым (ХМАО)"}, {"name": "пр. Юганская Обь / р. Большой Балык (Нефтеюганск / Пыть-Ях / Пойковский)", "cleanName": "Юганская Обь", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 5.5, "lat": 61.05, "lon": 72.4, "region": "Нефтеюганск / Пыть-Ях (ХМАО)"}, {"name": "р. Иртыш (Горноправдинск)", "cleanName": "р. Иртыш (Горноправдинск)", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 6, "lat": 60.056, "lon": 69.908, "region": "Горноправдинск (ХМАО)"}, {"name": "р. Обь / Малая Обь (Приобье / Нягань / Октябрьское)", "cleanName": "р. Обь (Приобье)", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 6.5, "lat": 62.42, "lon": 65.65, "region": "Приобье / Нягань (ХМАО)"}, {"name": "р. Северная Сосьва (Игрим)", "cleanName": "р. Северная Сосьва (Игрим)", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.8, "lat": 63.19, "lon": 64.417, "region": "Игрим (ХМАО)"}, {"name": "р. Конда (Урай / Междуреченский)", "cleanName": "р. Конда (Урай)", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 3.8, "lat": 59.9, "lon": 65.3, "region": "Урай / Междуреченский (ХМАО)"}, {"name": "оз. Окунёво / р. Эсс (Советский / Югорск)", "cleanName": "оз. Окунёво (Советский)", "basin": "arctic_ob_taz", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 4.2, "lat": 61.34, "lon": 63.45, "region": "Советский / Югорск (ХМАО)"}, {"name": "р. Белая (Стерлитамак / Салават / Ишимбай)", "cleanName": "р. Белая (Стерлитамак)", "basin": "volga_caspian", "wType": "big_river", "typeTag": "Река большая", "defDepth": 3.5, "lat": 53.52, "lon": 55.95, "region": "Стерлитамак / Салават (Башкортостан)"}, {"name": "р. Белая / Белорецкий пруд (Белорецк)", "cleanName": "р. Белая (Белорецк)", "basin": "volga_caspian", "wType": "small_river", "typeTag": "Река горная", "defDepth": 2.2, "lat": 53.965, "lon": 58.4, "region": "Белорецк (Башкортостан)"}, {"name": "оз. Ургун / оз. Калкан (Учалы)", "cleanName": "оз. Ургун (Учалы)", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 5.5, "lat": 54.32, "lon": 59.38, "region": "Учалы (Башкортостан)"}, {"name": "оз. Талкас / р. Таналык (Баймак / Сибай)", "cleanName": "оз. Талкас (Баймак)", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 6.5, "lat": 52.66, "lon": 58.5, "region": "Баймак / Сибай (Башкортостан)"}, {"name": "р. Урал (Орск)", "cleanName": "р. Урал (Орск)", "basin": "volga_caspian", "wType": "big_river", "typeTag": "Река большая", "defDepth": 3, "lat": 51.23, "lon": 58.475, "region": "Орск (Оренбургская обл.)"}, {"name": "р. Самара / р. Бузулук (Бузулук)", "cleanName": "р. Самара (Бузулук)", "basin": "volga_caspian", "wType": "small_river", "typeTag": "Река средняя", "defDepth": 2.5, "lat": 52.788, "lon": 52.262, "region": "Бузулук (Оренбургская обл.)"}, {"name": "Ижевский пруд / р. Иж (Ижевск)", "cleanName": "Ижевский пруд", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 5.5, "lat": 56.86, "lon": 53.18, "region": "Ижевск (Удмуртия)"}, {"name": "Воткинское вдхр. (Чайковский / Воткинск / Оса)", "cleanName": "Воткинское вдхр.", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 8, "lat": 57, "lon": 54.55, "region": "Чайковский / Воткинск / Оса"}, {"name": "р. Сылва / р. Ирень (Кунгур)", "cleanName": "р. Сылва (Кунгур)", "basin": "volga_caspian", "wType": "small_river", "typeTag": "Река средняя", "defDepth": 2.6, "lat": 57.43, "lon": 56.95, "region": "Кунгур (Пермский край)"}, {"name": "Камское вдхр. (Березники / Соликамск / Пожва)", "cleanName": "Камское вдхр. (Березники)", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 7.5, "lat": 59.41, "lon": 56.78, "region": "Березники / Соликамск"}, {"name": "р. Вишера / р. Колва (Красновишерск / Чердынь)", "cleanName": "р. Вишера", "basin": "volga_caspian", "wType": "big_river", "typeTag": "Река большая", "defDepth": 3.5, "lat": 60.403, "lon": 56.8, "region": "Красновишерск / Чердынь (Пермский край)"}, {"name": "р. Вятка (Вятские Поляны / Мамадыш)", "cleanName": "р. Вятка (Мамадыш)", "basin": "volga_caspian", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.2, "lat": 55.95, "lon": 51.25, "region": "Вятские Поляны / Мамадыш"}, {"name": "р. Кама (Чистополь / Рыбная Слобода)", "cleanName": "р. Кама (Чистополь)", "basin": "volga_caspian", "wType": "big_river", "typeTag": "Река большая", "defDepth": 8, "lat": 55.37, "lon": 50.55, "region": "Чистополь (Татарстан)"}, {"name": "Куйбышевское вдхр. (Ульяновск / Димитровград / Сенгилей)", "cleanName": "Куйбышевское вдхр. (Ульяновск)", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 9, "lat": 54.315, "lon": 48.45, "region": "Ульяновск"}, {"name": "Саратовское вдхр. (Сызрань / Хвалынск / Балаково / Вольск)", "cleanName": "Волга (Балаково / Хвалынск)", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 8.5, "lat": 52.35, "lon": 48.05, "region": "Сызрань / Хвалынск / Балаково"}, {"name": "Сурское вдхр. / р. Сура (Пенза)", "cleanName": "Сурское вдхр. (Пенза)", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 6, "lat": 53.15, "lon": 45.15, "region": "Пенза"}, {"name": "р. Инсар / р. Сура (Саранск)", "cleanName": "р. Сура (Мордовия)", "basin": "volga_caspian", "wType": "small_river", "typeTag": "Река средняя", "defDepth": 2.4, "lat": 54.185, "lon": 45.2, "region": "Саранск (Мордовия)"}, {"name": "Волгоградское вдхр. (Камышин / Ровное)", "cleanName": "Волгоградское вдхр. (Камышин)", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 9.5, "lat": 50.09, "lon": 45.41, "region": "Камышин (Волгоградская обл.)"}, {"name": "р. Ахтуба / р. Волга (Харабали / Селитренное / Енотаевка)", "cleanName": "р. Ахтуба (Харабали)", "basin": "volga_caspian", "wType": "big_river", "typeTag": "Река большая", "defDepth": 5.5, "lat": 47.35, "lon": 47.25, "region": "Харабали / Енотаевка (Астраханская обл.)"}, {"name": "Каспийские раскаты (Лагань)", "cleanName": "Каспийский канал (Лагань)", "basin": "volga_caspian", "wType": "sea_gulf", "typeTag": "Морской залив", "defDepth": 3.5, "lat": 45.39, "lon": 47.365, "region": "Лагань (Калмыкия)"}, {"name": "Чограйское вдхр. / оз. Маныч (Элиста)", "cleanName": "Чограйское вдхр.", "basin": "black_azov", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 4.8, "lat": 46.15, "lon": 44.3, "region": "Элиста (Калмыкия)"}, {"name": "р. Терек / Кизлярский залив (Кизляр)", "cleanName": "р. Терек (Кизляр)", "basin": "volga_caspian", "wType": "big_river", "typeTag": "Река большая", "defDepth": 3.5, "lat": 43.85, "lon": 46.72, "region": "Кизляр (Дагестан)"}, {"name": "Угличское вдхр. (Углич / Калязин)", "cleanName": "Угличское вдхр.", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 6.5, "lat": 57.4, "lon": 38.1, "region": "Углич / Калязин"}, {"name": "Рыбинское вдхр. (Весьегонск / Брейтово)", "cleanName": "Рыбинское вдхр. (Весьегонск)", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 7, "lat": 58.65, "lon": 37.3, "region": "Весьегонск (Тверская обл.)"}, {"name": "р. Волга (Ржев / Зубцов)", "cleanName": "р. Волга (Ржев)", "basin": "volga_caspian", "wType": "big_river", "typeTag": "Река большая", "defDepth": 3, "lat": 56.262, "lon": 34.33, "region": "Ржев (Тверская обл.)"}, {"name": "Вышневолоцкое вдхр. / оз. Песьво (Вышний Волочёк / Удомля)", "cleanName": "оз. Песьво (Удомля АЭС)", "basin": "volga_caspian", "wType": "cooling_reservoir", "typeTag": "ГРЭС/АЭС", "defDepth": 5.5, "lat": 57.75, "lon": 34.8, "region": "Вышний Волочёк / Удомля"}, {"name": "Горьковское вдхр. / р. Волга (Кострома / Волгореченск / Плёс / Кинешма)", "cleanName": "р. Волга (Кострома / Кинешма)", "basin": "volga_caspian", "wType": "big_river", "typeTag": "Река большая", "defDepth": 6.5, "lat": 57.45, "lon": 41.52, "region": "Кострома / Плёс / Кинешма"}, {"name": "Уводьское вдхр. (Иваново)", "cleanName": "Уводьское вдхр.", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 5, "lat": 57.05, "lon": 40.9, "region": "Иваново"}, {"name": "р. Ока (Муром / Павлово / Выкса)", "cleanName": "р. Ока (Муром)", "basin": "volga_caspian", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.8, "lat": 55.58, "lon": 42.1, "region": "Муром / Выкса / Павлово"}, {"name": "р. Ока (Касимов / Шилово)", "cleanName": "р. Ока (Касимов)", "basin": "volga_caspian", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.5, "lat": 54.65, "lon": 41.15, "region": "Касимов / Шилово (Рязанская обл.)"}, {"name": "р. Упа / р. Ока (Тула / Алексин)", "cleanName": "р. Упа (Тула)", "basin": "volga_caspian", "wType": "small_river", "typeTag": "Река средняя", "defDepth": 2.4, "lat": 54.2, "lon": 37.62, "region": "Тула"}, {"name": "р. Ока / р. Протва (Калуга / Обнинск / Наро-Фоминск)", "cleanName": "р. Ока (Калуга)", "basin": "volga_caspian", "wType": "big_river", "typeTag": "Река большая", "defDepth": 3.6, "lat": 54.75, "lon": 36.45, "region": "Калуга / Обнинск"}, {"name": "Чебоксарское вдхр. / р. Волга (Лысково / Макарьево / Йошкар-Ола)", "cleanName": "р. Волга (Макарьево)", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 6.5, "lat": 56.25, "lon": 46.2, "region": "Лысково / Йошкар-Ола"}, {"name": "р. Луга (г. Луга)", "cleanName": "р. Луга", "basin": "baltic", "wType": "small_river", "typeTag": "Река средняя", "defDepth": 2.5, "lat": 58.74, "lon": 29.85, "region": "Луга (Ленинградская обл.)"}, {"name": "р. Волхов / р. Тихвинка (Кириши / Тихвин)", "cleanName": "р. Волхов (Кириши)", "basin": "nw_karelia", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.5, "lat": 59.52, "lon": 32.75, "region": "Кириши / Тихвин (ЛО)"}, {"name": "оз. Валдайское / р. Мста (Валдай / Боровичи)", "cleanName": "оз. Валдайское", "basin": "nw_karelia", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 8, "lat": 58.15, "lon": 33.55, "region": "Валдай / Боровичи (Новгородская обл.)"}, {"name": "Чудское озеро (Гдов)", "cleanName": "Чудское озеро (Гдов)", "basin": "baltic", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 7, "lat": 58.74, "lon": 27.8, "region": "Гдов (Псковская обл.)"}, {"name": "р. Ловать / оз. Жижицкое (Великие Луки)", "cleanName": "р. Ловать (Великие Луки)", "basin": "nw_karelia", "wType": "small_river", "typeTag": "Река средняя", "defDepth": 2.4, "lat": 56.34, "lon": 30.53, "region": "Великие Луки (Псковская обл.)"}, {"name": "р. Неман (Советск)", "cleanName": "р. Неман", "basin": "baltic", "wType": "big_river", "typeTag": "Река большая", "defDepth": 3.8, "lat": 55.085, "lon": 21.885, "region": "Советск (Калининградская обл.)"}, {"name": "Ладожские шхеры (Сортавала / Лахденпохья / Питкяранта / Олонец)", "cleanName": "Ладожские шхеры (Сортавала)", "basin": "nw_karelia", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 14, "lat": 61.55, "lon": 31.1, "region": "Сортавала / Лахденпохья (Карелия)"}, {"name": "Онежское озеро / р. Водла (Пудож / Медвежьегорск)", "cleanName": "р. Водла (Онежское оз.)", "basin": "nw_karelia", "wType": "big_river", "typeTag": "Река большая", "defDepth": 5.5, "lat": 61.81, "lon": 36.52, "region": "Пудож (Карелия)"}, {"name": "Белое море / р. Кемь (Беломорск / Кемь)", "cleanName": "Белое море (Беломорск / Кемь)", "basin": "barents_white", "wType": "sea_gulf", "typeTag": "Морской залив", "defDepth": 9, "lat": 64.75, "lon": 34.68, "region": "Беломорск / Кемь (Карелия)"}, {"name": "оз. Среднее Куйто / оз. Нюк (Калевала / Костомукша)", "cleanName": "оз. Куйто (Калевала)", "basin": "nw_karelia", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 10, "lat": 64.9, "lon": 30.9, "region": "Калевала / Костомукша (Карелия)"}, {"name": "оз. Кереть / Чупинская губа (Лоухи)", "cleanName": "оз. Кереть (Лоухи)", "basin": "barents_white", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 9.5, "lat": 66.08, "lon": 33.05, "region": "Лоухи (Карелия)"}, {"name": "р. Северная Двина (Котлас)", "cleanName": "р. Северная Двина (Котлас)", "basin": "barents_white", "wType": "big_river", "typeTag": "Река большая", "defDepth": 5.2, "lat": 61.255, "lon": 46.65, "region": "Котлас (Архангельская обл.)"}, {"name": "р. Вага (Вельск)", "cleanName": "р. Вага (Вельск)", "basin": "barents_white", "wType": "big_river", "typeTag": "Река большая", "defDepth": 3.5, "lat": 61.07, "lon": 42.1, "region": "Вельск (Архангельская обл.)"}, {"name": "р. Мезень (Мезень)", "cleanName": "р. Мезень", "basin": "barents_white", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.5, "lat": 65.85, "lon": 44.24, "region": "Мезень (Архангельская обл.)"}, {"name": "р. Ижма / р. Ухта (Ухта)", "cleanName": "р. Ижма (Ухта)", "basin": "barents_white", "wType": "big_river", "typeTag": "Река большая", "defDepth": 3.5, "lat": 63.57, "lon": 53.69, "region": "Ухта (Коми)"}, {"name": "р. Печора (Усть-Цильма)", "cleanName": "р. Печора (Усть-Цильма)", "basin": "barents_white", "wType": "big_river", "typeTag": "Река большая", "defDepth": 6, "lat": 65.442, "lon": 52.15, "region": "Усть-Цильма (Коми)"}, {"name": "р. Воркута / р. Уса (Воркута)", "cleanName": "р. Уса (Воркута)", "basin": "barents_white", "wType": "small_river", "typeTag": "Река севера", "defDepth": 2.4, "lat": 67.498, "lon": 64.052, "region": "Воркута (Коми)"}, {"name": "р. Дон (Вёшенская / Павловск)", "cleanName": "р. Дон (Вёшенская)", "basin": "black_azov", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.2, "lat": 50, "lon": 40.9, "region": "Вёшенская / Павловск"}, {"name": "р. Дон (Калач-на-Дону / Цимлянск)", "cleanName": "р. Дон (Калач-на-Дону)", "basin": "black_azov", "wType": "big_river", "typeTag": "Река большая", "defDepth": 5, "lat": 48.685, "lon": 43.525, "region": "Калач-на-Дону"}, {"name": "р. Протока / р. Кирпили (Славянск-на-Кубани / Тимашевск)", "cleanName": "р. Протока (Славянск)", "basin": "black_azov", "wType": "big_river", "typeTag": "Река большая", "defDepth": 3.5, "lat": 45.45, "lon": 38.5, "region": "Славянск-на-Кубани / Тимашевск"}, {"name": "Чёрное море (Джубга / Архипо-Осиповка / Туапсе)", "cleanName": "Чёрное море (Туапсе / Джубга)", "basin": "black_azov", "wType": "sea_gulf", "typeTag": "Морская бухта", "defDepth": 10, "lat": 44.22, "lon": 38.8, "region": "Туапсе / Джубга"}, {"name": "р. Белая / Майкопское вдхр. (Майкоп)", "cleanName": "р. Белая (Майкоп)", "basin": "black_azov", "wType": "small_river", "typeTag": "Река горная", "defDepth": 2, "lat": 44.61, "lon": 40.1, "region": "Майкоп (Адыгея)"}, {"name": "Феодосийский залив / Чёрное море (Судак / Феодосия)", "cleanName": "Феодосийский залив", "basin": "black_azov", "wType": "sea_gulf", "typeTag": "Морской залив", "defDepth": 9, "lat": 44.95, "lon": 35.18, "region": "Феодосия / Судак (Крым)"}, {"name": "Каламитский залив / оз. Донузлав (Евпатория / Черноморское)", "cleanName": "оз. Донузлав / Евпатория", "basin": "black_azov", "wType": "sea_gulf", "typeTag": "Морской залив", "defDepth": 8, "lat": 45.35, "lon": 33.05, "region": "Евпатория / Черноморское (Крым)"}, {"name": "Новотроицкое вдхр. / оз. Сенгилеевское (Ставрополь)", "cleanName": "Новотроицкое вдхр. (ГРЭС)", "basin": "black_azov", "wType": "cooling_reservoir", "typeTag": "ГРЭС", "defDepth": 5, "lat": 45.15, "lon": 41.8, "region": "Ставрополь"}, {"name": "р. Подкумок / р. Кума (Пятигорск / КМВ)", "cleanName": "р. Подкумок (Пятигорск)", "basin": "volga_caspian", "wType": "small_river", "typeTag": "Река предгорная", "defDepth": 1.8, "lat": 44.05, "lon": 43.06, "region": "Пятигорск (Ставропольский край)"}, {"name": "Матырское вдхр. / р. Дон (Липецк / Елец)", "cleanName": "р. Дон / Матырское вдхр. (Липецк)", "basin": "black_azov", "wType": "big_river", "typeTag": "Река большая", "defDepth": 3.6, "lat": 52.615, "lon": 39.05, "region": "Липецк / Елец"}, {"name": "р. Цна / Котовское вдхр. (Тамбов)", "cleanName": "р. Цна (Тамбов)", "basin": "volga_caspian", "wType": "small_river", "typeTag": "Река средняя", "defDepth": 2.5, "lat": 52.72, "lon": 41.455, "region": "Тамбов"}, {"name": "р. Ока (Орёл)", "cleanName": "р. Ока (Орёл)", "basin": "volga_caspian", "wType": "small_river", "typeTag": "Река средняя", "defDepth": 2.2, "lat": 52.967, "lon": 36.065, "region": "Орёл"}, {"name": "р. Чулым (Ачинск)", "cleanName": "р. Чулым (Ачинск)", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 3.8, "lat": 56.27, "lon": 90.495, "region": "Ачинск (Красноярский край)"}, {"name": "р. Енисей / р. Нижняя Тунгуска (Туруханск)", "cleanName": "р. Енисей (Туруханск)", "basin": "yenisei_lena", "wType": "big_river", "typeTag": "Река большая", "defDepth": 10, "lat": 65.795, "lon": 87.96, "region": "Туруханск"}, {"name": "р. Енисей (Игарка)", "cleanName": "р. Енисей (Игарка)", "basin": "yenisei_lena", "wType": "big_river", "typeTag": "Река большая", "defDepth": 11, "lat": 67.465, "lon": 86.585, "region": "Игарка"}, {"name": "р. Енисей / Красноярское вдхр. (Абакан / Минусинск / Саяногорск)", "cleanName": "р. Енисей (Абакан / Саяногорск)", "basin": "yenisei_lena", "wType": "big_river", "typeTag": "Река большая", "defDepth": 6.5, "lat": 53.5, "lon": 91.5, "region": "Абакан / Минусинск / Саяногорск"}, {"name": "р. Енисей / р. Бий-Хем (Кызыл)", "cleanName": "р. Енисей (Кызыл)", "basin": "yenisei_lena", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.5, "lat": 51.72, "lon": 94.44, "region": "Кызыл (Тыва)"}, {"name": "р. Лена (Усть-Кут)", "cleanName": "р. Лена (Усть-Кут)", "basin": "yenisei_lena", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.2, "lat": 56.795, "lon": 105.765, "region": "Усть-Кут (Иркутская обл.)"}, {"name": "оз. Байкал / р. Верхняя Ангара (Северобайкальск)", "cleanName": "Байкал (Северобайкальск)", "basin": "baikal", "wType": "quarry", "typeTag": "Озеро глубокое", "defDepth": 16, "lat": 55.635, "lon": 109.325, "region": "Северобайкальск (Бурятия)"}, {"name": "оз. Кенон / р. Ингода (Чита)", "cleanName": "оз. Кенон / р. Ингода (Чита)", "basin": "amur", "wType": "quarry", "typeTag": "Озеро / ГРЭС", "defDepth": 4.5, "lat": 52.035, "lon": 113.5, "region": "Чита (Забайкальский край)"}, {"name": "Вилюйское вдхр. / р. Малая Ботуобия (Мирный)", "cleanName": "Вилюйское вдхр. (Мирный)", "basin": "yenisei_lena", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 10, "lat": 62.535, "lon": 113.96, "region": "Мирный (Якутия)"}, {"name": "р. Вилюй (Вилюйск)", "cleanName": "р. Вилюй (Вилюйск)", "basin": "yenisei_lena", "wType": "big_river", "typeTag": "Река большая", "defDepth": 5, "lat": 63.755, "lon": 121.624, "region": "Вилюйск (Якутия)"}, {"name": "р. Чульман / р. Тимптон (Нерюнгри)", "cleanName": "р. Чульман (Нерюнгри)", "basin": "yenisei_lena", "wType": "small_river", "typeTag": "Река таёжная", "defDepth": 2.2, "lat": 56.66, "lon": 124.725, "region": "Нерюнгри (Якутия)"}, {"name": "Губа Буор-Хая / дельта Лены (Тикси)", "cleanName": "Дельта Лены / Тикси", "basin": "yenisei_lena", "wType": "sea_gulf", "typeTag": "Морская губа", "defDepth": 8, "lat": 71.637, "lon": 128.868, "region": "Тикси (Якутия)"}, {"name": "р. Зея (Свободный)", "cleanName": "р. Зея (Свободный)", "basin": "amur", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.5, "lat": 51.375, "lon": 128.135, "region": "Свободный (Амурская обл.)"}, {"name": "р. Тында / р. Гилюй (Тында)", "cleanName": "р. Гилюй (Тында)", "basin": "amur", "wType": "small_river", "typeTag": "Река таёжная", "defDepth": 2.4, "lat": 55.155, "lon": 124.725, "region": "Тында (Амурская обл.)"}, {"name": "р. Бира (Биробиджан)", "cleanName": "р. Бира (Биробиджан)", "basin": "amur", "wType": "small_river", "typeTag": "Река средняя", "defDepth": 2.5, "lat": 48.795, "lon": 132.92, "region": "Биробиджан (ЕАО)"}, {"name": "Амурский лиман / р. Амур (Николаевск-на-Амуре)", "cleanName": "Амурский лиман (Николаевск)", "basin": "pacific_sea", "wType": "sea_gulf", "typeTag": "Морской лиман", "defDepth": 6.5, "lat": 53.145, "lon": 140.72, "region": "Николаевск-на-Амуре"}, {"name": "Татарский пролив (Ванино / Советская Гавань)", "cleanName": "Бухта Ванино / Совгавань", "basin": "pacific_sea", "wType": "sea_gulf", "typeTag": "Морская бухта", "defDepth": 12, "lat": 49.02, "lon": 140.28, "region": "Ванино / Советская Гавань"}, {"name": "р. Поронай / залив Терпения (Поронайск)", "cleanName": "р. Поронай / Залив Терпения", "basin": "pacific_sea", "wType": "sea_gulf", "typeTag": "Морской залив", "defDepth": 7, "lat": 49.222, "lon": 143.102, "region": "Поронайск (Сахалин)"}, {"name": "Набильский залив / р. Тымь (Ноглики)", "cleanName": "Набильский залив (Ноглики)", "basin": "pacific_sea", "wType": "sea_gulf", "typeTag": "Морской залив", "defDepth": 5.5, "lat": 51.805, "lon": 143.14, "region": "Ноглики (Сахалин)"}, {"name": "Залив Помрь / Охотское море (Оха)", "cleanName": "Залив Помрь (Оха)", "basin": "pacific_sea", "wType": "sea_gulf", "typeTag": "Морской залив", "defDepth": 6, "lat": 53.59, "lon": 142.95, "region": "Оха (Сахалин)"}, {"name": "р. Камчатка / оз. Нерпичье (Усть-Камчатск)", "cleanName": "Устье р. Камчатка", "basin": "pacific_sea", "wType": "big_river", "typeTag": "Река большая", "defDepth": 5.5, "lat": 56.228, "lon": 162.476, "region": "Усть-Камчатск (Камчатка)"}, {"name": "Анадырский лиман / р. Анадырь (Анадырь)", "cleanName": "Анадырский лиман", "basin": "pacific_sea", "wType": "sea_gulf", "typeTag": "Морской лиман", "defDepth": 8, "lat": 64.733, "lon": 177.515, "region": "Анадырь (Чукотка)"}, {"name": "р. Нара (Наро-Фоминск)", "cleanName": "р. Нара", "basin": "volga_caspian", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.2, "lat": 55.389, "lon": 36.736, "region": "Наро-Фоминск"}, {"name": "Горьковское вдхр. (Юрьевец)", "cleanName": "Горьковское вдхр. (Юрьевец)", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 9.5, "lat": 57.322, "lon": 43.118, "region": "Юрьевец"}, {"name": "р. Клязьма (Ковров)", "cleanName": "р. Клязьма (Ковров)", "basin": "volga_caspian", "wType": "big_river", "typeTag": "Река большая", "defDepth": 3.8, "lat": 56.362, "lon": 41.305, "region": "Ковров"}, {"name": "р. Волга (Лысково / Макарьево)", "cleanName": "р. Волга (Лысково / Макарьево)", "basin": "volga_caspian", "wType": "big_river", "typeTag": "Река большая", "defDepth": 8, "lat": 56.048, "lon": 45.045, "region": "Лысково / Макарьево"}, {"name": "р. Ока (Павлово)", "cleanName": "р. Ока (Павлово)", "basin": "volga_caspian", "wType": "big_river", "typeTag": "Река большая", "defDepth": 6, "lat": 55.966, "lon": 43.078, "region": "Павлово"}, {"name": "р. Малая Кокшага (Йошкар-Ола)", "cleanName": "р. Малая Кокшага", "basin": "volga_caspian", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.8, "lat": 56.634, "lon": 47.905, "region": "Йошкар-Ола"}, {"name": "Черемшанский залив (Димитровград)", "cleanName": "Черемшанский залив", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 6.5, "lat": 54.212, "lon": 49.585, "region": "Димитровград"}, {"name": "Куйбышевское вдхр. (Тольятти)", "cleanName": "Жигулёвское море (Тольятти)", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 12, "lat": 53.485, "lon": 49.38, "region": "Тольятти"}, {"name": "Саратовское вдхр. (Сызрань)", "cleanName": "р. Волга (Сызрань)", "basin": "volga_caspian", "wType": "big_river", "typeTag": "Река большая", "defDepth": 8.5, "lat": 53.142, "lon": 48.468, "region": "Сызрань"}, {"name": "Усинский залив (Шигоны)", "cleanName": "Усинский залив", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 7.5, "lat": 53.395, "lon": 48.72, "region": "Шигоны"}, {"name": "р. Волга (Вольск / Маркс)", "cleanName": "р. Волга (Вольск / Маркс)", "basin": "volga_caspian", "wType": "big_river", "typeTag": "Река большая", "defDepth": 10, "lat": 51.905, "lon": 47.12, "region": "Вольск / Маркс"}, {"name": "Волгоградское вдхр. (Ровное)", "cleanName": "р. Волга (Ровное)", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 9.5, "lat": 50.778, "lon": 46.065, "region": "Ровное"}, {"name": "р. Ахтуба (Ахтубинск)", "cleanName": "р. Ахтуба (Ахтубинск)", "basin": "volga_caspian", "wType": "big_river", "typeTag": "Река большая", "defDepth": 6.5, "lat": 48.282, "lon": 46.155, "region": "Ахтубинск"}, {"name": "р. Чусовая (Чусовой)", "cleanName": "р. Чусовая (Чусовой)", "basin": "volga_caspian", "wType": "big_river", "typeTag": "Река большая", "defDepth": 3.5, "lat": 58.285, "lon": 57.815, "region": "Чусовой"}, {"name": "Воткинское вдхр. (Оса)", "cleanName": "р. Кама (Оса)", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 9, "lat": 57.292, "lon": 55.445, "region": "Оса"}, {"name": "Обвинский залив (Ильинский)", "cleanName": "р. Обва (Ильинский)", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 7, "lat": 58.572, "lon": 55.695, "region": "Ильинский"}, {"name": "Камское вдхр. (Пожва)", "cleanName": "р. Кама (Пожва)", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 8.5, "lat": 59.092, "lon": 56.11, "region": "Пожва"}, {"name": "р. Быстрый Танып (Балтачево / Татышлы)", "cleanName": "р. Быстрый Танып (Татышлы)", "basin": "volga_caspian", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.8, "lat": 56.145, "lon": 55.88, "region": "Верхние Татышлы / Старобалтачево"}, {"name": "р. Сюнь (Бакалы)", "cleanName": "р. Сюнь (Бакалы)", "basin": "volga_caspian", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.4, "lat": 55.182, "lon": 53.805, "region": "Бакалы"}, {"name": "р. База (Чекмагуш)", "cleanName": "р. База (Чекмагуш)", "basin": "volga_caspian", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.2, "lat": 55.138, "lon": 54.66, "region": "Чекмагуш"}, {"name": "р. Зилим (Красноусольский)", "cleanName": "р. Зилим", "basin": "volga_caspian", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.5, "lat": 53.925, "lon": 56.51, "region": "Красноусольский"}, {"name": "р. Белая (Кумертау / Мелеуз)", "cleanName": "р. Белая (Мелеуз / Кумертау)", "basin": "volga_caspian", "wType": "big_river", "typeTag": "Река большая", "defDepth": 3.8, "lat": 52.955, "lon": 55.925, "region": "Кумертау"}, {"name": "р. Белая (Актаныш)", "cleanName": "р. Белая (Актаныш)", "basin": "volga_caspian", "wType": "big_river", "typeTag": "Река большая", "defDepth": 6, "lat": 55.725, "lon": 54.095, "region": "Актаныш"}, {"name": "Онежское озеро (Медвежьегорск)", "cleanName": "Онежское озеро (Медвежьегорск)", "basin": "baltic_nw", "wType": "quarry", "typeTag": "Озеро крупное", "defDepth": 12, "lat": 62.895, "lon": 34.468, "region": "Медвежьегорск"}, {"name": "р. Кемь и Выг (Кемь / Беломорск)", "cleanName": "р. Кемь (Кемь)", "basin": "euro_north", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.5, "lat": 64.952, "lon": 34.605, "region": "Кемь"}, {"name": "р. Нижний Выг (Беломорск)", "cleanName": "р. Выг (Беломорск)", "basin": "euro_north", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.5, "lat": 64.522, "lon": 34.76, "region": "Беломорск"}, {"name": "р. Олонка и Ладога (Олонец)", "cleanName": "р. Олонка (Олонец)", "basin": "baltic_nw", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.8, "lat": 60.985, "lon": 32.968, "region": "Олонец"}, {"name": "р. Дон (Вёшенская)", "cleanName": "р. Дон (Вёшенская)", "basin": "south_azov_black", "wType": "big_river", "typeTag": "Река большая", "defDepth": 5.5, "lat": 49.622, "lon": 41.732, "region": "Вёшенская"}, {"name": "р. Дон (Павловск)", "cleanName": "р. Дон (Павловск)", "basin": "south_azov_black", "wType": "big_river", "typeTag": "Река большая", "defDepth": 5.2, "lat": 50.455, "lon": 40.095, "region": "Павловск"}, {"name": "Черноморская акватория (Джубга / Архипо-Осиповка)", "cleanName": "Чёрное море (Джубга)", "basin": "south_azov_black", "wType": "open_sea", "typeTag": "Морская акватория", "defDepth": 10, "lat": 44.325, "lon": 38.65, "region": "Джубга"}, {"name": "Дельта р. Селенга (Кабанск)", "cleanName": "р. Селенга (Кабанск)", "basin": "baikal_angara", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.8, "lat": 52.055, "lon": 106.645, "region": "Кабанск"}, {"name": "р. Лена (Покровск)", "cleanName": "р. Лена (Покровск)", "basin": "siberia_east", "wType": "big_river", "typeTag": "Река большая", "defDepth": 8, "lat": 61.482, "lon": 129.152, "region": "Покровск"}, {"name": "р. Алдан / р. Селигдар (Алдан)", "cleanName": "р. Алдан (Алдан)", "basin": "siberia_east", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.5, "lat": 58.65, "lon": 125.45, "region": "Алдан"}, {"name": "р. Амур (Николаевск-на-Амуре)", "cleanName": "р. Амур (Николаевск)", "basin": "amur_primorye", "wType": "big_river", "typeTag": "Река большая", "defDepth": 11, "lat": 53.138, "lon": 140.715, "region": "Николаевск-на-Амуре"}, {"name": "оз. Ханка (Спасск-Дальний)", "cleanName": "оз. Ханка (Спасск-Дальний)", "basin": "amur_primorye", "wType": "quarry", "typeTag": "Озеро крупное", "defDepth": 4.2, "lat": 44.655, "lon": 132.68, "region": "Спасск-Дальний"}, {"name": "р. Таз (Заполярный)", "cleanName": "р. Таз (Заполярный)", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 6, "lat": 66.41, "lon": 73.85, "region": "Заполярный (ЯНАО)"}, {"name": "р. Надым (Нори)", "cleanName": "р. Надым (Нори)", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 5.5, "lat": 66.152, "lon": 72.38, "region": "Нори (ЯНАО)"}, {"name": "р. Пякупур (Ханымей)", "cleanName": "р. Пякупур (Ханымей)", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 4.5, "lat": 63.725, "lon": 75.955, "region": "Ханымей (ЯНАО)"}, {"name": "оз. Чаны (Чаны)", "cleanName": "оз. Чаны (Северный плёс)", "basin": "arctic_ob_taz", "wType": "quarry", "typeTag": "Озеро крупное", "defDepth": 3.5, "lat": 55.25, "lon": 76.78, "region": "Чаны (Новосибирская обл.)"}, {"name": "р. Раздольная (Уссурийск)", "cleanName": "р. Раздольная (Уссурийск)", "basin": "amur_primorye", "wType": "big_river", "typeTag": "Река большая", "defDepth": 3.5, "lat": 43.792, "lon": 131.945, "region": "Уссурийск"}, {"name": "р. Малая Обь (Горки)", "cleanName": "р. Малая Обь (Горки)", "basin": "arctic_ob_taz", "wType": "big_river", "typeTag": "Река большая", "defDepth": 6.5, "lat": 65.078, "lon": 65.285, "region": "Горки (ЯНАО)"}, {"name": "р. Сортым-Пим (Нижнесортымский)", "cleanName": "р. Пим (Нижнесортымский)", "basin": "arctic_ob_taz", "wType": "small_river", "typeTag": "Река малая", "defDepth": 2.6, "lat": 62.44, "lon": 71.755, "region": "Нижнесортымский (ХМАО)"}, {"name": "р. Волга / Костромской залив (Кострома)", "cleanName": "р. Волга (Кострома)", "basin": "volga_caspian", "wType": "big_river", "typeTag": "Река большая", "defDepth": 7.5, "lat": 57.765, "lon": 40.918, "region": "Кострома"}, {"name": "р. Енисей (Железногорск / Атаманово)", "cleanName": "р. Енисей (Железногорск)", "basin": "siberia_east", "wType": "big_river", "typeTag": "Река большая", "defDepth": 6.5, "lat": 56.265, "lon": 93.49, "region": "Железногорск"}, {"name": "Залив Посьета / Бухта Славянка (Славянка)", "cleanName": "Залив Посьета (Славянка)", "basin": "amur_primorye", "wType": "sea_gulf", "typeTag": "Морской залив", "defDepth": 10, "lat": 42.865, "lon": 131.392, "region": "Славянка"}, {"name": "Куйбышевское вдхр. (Звенигово)", "cleanName": "р. Волга (Звенигово)", "basin": "volga_caspian", "wType": "big_river", "typeTag": "Река большая", "defDepth": 8.5, "lat": 55.968, "lon": 48.012, "region": "Звенигово"}, {"name": "Рыбинское вдхр. / р. Согожа (Пошехонье)", "cleanName": "Рыбинское вдхр. (Пошехонье)", "basin": "volga_caspian", "wType": "quarry", "typeTag": "Водохранилище", "defDepth": 6.5, "lat": 58.5, "lon": 39.11, "region": "Пошехонье"}];

const BOT_CITIES_DB = [{"name": "Новый Уренгой", "lat": 66.0833, "lon": 76.68, "admin1": "Ямало-Ненецкий АО"}, {"name": "Коротчаево", "lat": 65.9472, "lon": 78.1486, "admin1": "Ямало-Ненецкий АО"}, {"name": "Лимбяяха", "lat": 66.0581, "lon": 77.7914, "admin1": "Ямало-Ненецкий АО"}, {"name": "Уренгой (пгт)", "lat": 65.9631, "lon": 78.3686, "admin1": "Ямало-Ненецкий АО"}, {"name": "Ямсовей", "lat": 65.6542, "lon": 76.9531, "admin1": "Ямало-Ненецкий АО"}, {"name": "Пангоды", "lat": 65.85, "lon": 74.4856, "admin1": "Ямало-Ненецкий АО"}, {"name": "Правохеттинский", "lat": 65.658, "lon": 73.719, "admin1": "Ямало-Ненецкий АО"}, {"name": "Старый Надым", "lat": 65.565, "lon": 72.652, "admin1": "Ямало-Ненецкий АО"}, {"name": "Надым", "lat": 65.5333, "lon": 72.5167, "admin1": "Ямало-Ненецкий АО"}, {"name": "Ягельный", "lat": 64.96, "lon": 72.71, "admin1": "Ямало-Ненецкий АО"}, {"name": "Приозёрный (ЯНАО)", "lat": 64.67, "lon": 72.9, "admin1": "Ямало-Ненецкий АО"}, {"name": "Лонгъюган", "lat": 65.3, "lon": 70.93, "admin1": "Ямало-Ненецкий АО"}, {"name": "Ныда", "lat": 66.625, "lon": 72.93, "admin1": "Ямало-Ненецкий АО"}, {"name": "Нори", "lat": 66.15, "lon": 72.37, "admin1": "Ямало-Ненецкий АО"}, {"name": "Кутопьюган", "lat": 65.97, "lon": 70.72, "admin1": "Ямало-Ненецкий АО"}, {"name": "Тазовский", "lat": 67.4639, "lon": 78.7022, "admin1": "Ямало-Ненецкий АО"}, {"name": "Газ-Сале", "lat": 67.367, "lon": 78.969, "admin1": "Ямало-Ненецкий АО"}, {"name": "Самбург", "lat": 66.985, "lon": 78.221, "admin1": "Ямало-Ненецкий АО"}, {"name": "Антипаюта", "lat": 69.098, "lon": 76.855, "admin1": "Ямало-Ненецкий АО"}, {"name": "Гыда", "lat": 70.893, "lon": 78.472, "admin1": "Ямало-Ненецкий АО"}, {"name": "Тарко-Сале", "lat": 64.915, "lon": 77.78, "admin1": "Ямало-Ненецкий АО"}, {"name": "Пуровск", "lat": 64.983, "lon": 77.59, "admin1": "Ямало-Ненецкий АО"}, {"name": "Сывдарма", "lat": 65.243, "lon": 77.26, "admin1": "Ямало-Ненецкий АО"}, {"name": "Пурпе", "lat": 64.48, "lon": 76.68, "admin1": "Ямало-Ненецкий АО"}, {"name": "Губкинский", "lat": 64.434, "lon": 76.502, "admin1": "Ямало-Ненецкий АО"}, {"name": "Ханымей", "lat": 63.722, "lon": 75.95, "admin1": "Ямало-Ненецкий АО"}, {"name": "Харампур", "lat": 64.31, "lon": 78.1, "admin1": "Ямало-Ненецкий АО"}, {"name": "Халясавэй", "lat": 63.39, "lon": 78.38, "admin1": "Ямало-Ненецкий АО"}, {"name": "Муравленко", "lat": 63.792, "lon": 74.523, "admin1": "Ямало-Ненецкий АО"}, {"name": "Ноябрьск", "lat": 63.2, "lon": 75.45, "admin1": "Ямало-Ненецкий АО"}, {"name": "Вынгапуровский", "lat": 63.168, "lon": 76.968, "admin1": "Ямало-Ненецкий АО"}, {"name": "Красноселькуп", "lat": 65.702, "lon": 82.463, "admin1": "Ямало-Ненецкий АО"}, {"name": "Толька", "lat": 63.998, "lon": 82.06, "admin1": "Ямало-Ненецкий АО"}, {"name": "Салехард", "lat": 66.53, "lon": 66.6, "admin1": "Ямало-Ненецкий АО"}, {"name": "Лабытнанги", "lat": 66.657, "lon": 66.418, "admin1": "Ямало-Ненецкий АО"}, {"name": "Харп", "lat": 66.814, "lon": 65.808, "admin1": "Ямало-Ненецкий АО"}, {"name": "Обской", "lat": 66.69, "lon": 66.22, "admin1": "Ямало-Ненецкий АО"}, {"name": "Аксарка", "lat": 66.56, "lon": 67.798, "admin1": "Ямало-Ненецкий АО"}, {"name": "Белоярск (Приуральский)", "lat": 66.872, "lon": 68.136, "admin1": "Ямало-Ненецкий АО"}, {"name": "Катравож", "lat": 66.333, "lon": 66.085, "admin1": "Ямало-Ненецкий АО"}, {"name": "Яр-Сале", "lat": 66.863, "lon": 70.84, "admin1": "Ямало-Ненецкий АО"}, {"name": "Панаевск", "lat": 66.757, "lon": 70.116, "admin1": "Ямало-Ненецкий АО"}, {"name": "Салемал", "lat": 66.746, "lon": 68.938, "admin1": "Ямало-Ненецкий АО"}, {"name": "Мыс Каменный", "lat": 68.463, "lon": 73.593, "admin1": "Ямало-Ненецкий АО"}, {"name": "Сеяха", "lat": 70.165, "lon": 72.515, "admin1": "Ямало-Ненецкий АО"}, {"name": "Мужи", "lat": 65.398, "lon": 64.698, "admin1": "Ямало-Ненецкий АО"}, {"name": "Горки (Шурышкарский)", "lat": 65.076, "lon": 65.291, "admin1": "Ямало-Ненецкий АО"}, {"name": "Овгорт", "lat": 64.867, "lon": 63.367, "admin1": "Ямало-Ненецкий АО"}, {"name": "Сургут", "lat": 61.25, "lon": 73.4, "admin1": "Ханты-Мансийский АО"}, {"name": "Белый Яр (Сургутский)", "lat": 61.267, "lon": 73.238, "admin1": "Ханты-Мансийский АО"}, {"name": "Солнечный (Сургутский)", "lat": 61.298, "lon": 73.175, "admin1": "Ханты-Мансийский АО"}, {"name": "Барсово", "lat": 61.278, "lon": 73.153, "admin1": "Ханты-Мансийский АО"}, {"name": "Фёдоровский", "lat": 61.608, "lon": 73.719, "admin1": "Ханты-Мансийский АО"}, {"name": "Лянтор", "lat": 61.619, "lon": 72.155, "admin1": "Ханты-Мансийский АО"}, {"name": "Нижнесортымский", "lat": 62.438, "lon": 71.76, "admin1": "Ханты-Мансийский АО"}, {"name": "Нижневартовск", "lat": 60.93, "lon": 76.55, "admin1": "Ханты-Мансийский АО"}, {"name": "Излучинск", "lat": 60.963, "lon": 76.929, "admin1": "Ханты-Мансийский АО"}, {"name": "Мегион", "lat": 61.034, "lon": 76.11, "admin1": "Ханты-Мансийский АО"}, {"name": "Лангепас", "lat": 61.254, "lon": 75.182, "admin1": "Ханты-Мансийский АО"}, {"name": "Покачи", "lat": 61.75, "lon": 75.59, "admin1": "Ханты-Мансийский АО"}, {"name": "Радужный (ХМАО)", "lat": 62.133, "lon": 77.475, "admin1": "Ханты-Мансийский АО"}, {"name": "Новоаганск", "lat": 61.946, "lon": 76.663, "admin1": "Ханты-Мансийский АО"}, {"name": "Когалым", "lat": 62.264, "lon": 74.482, "admin1": "Ханты-Мансийский АО"}, {"name": "Нефтеюганск", "lat": 61.099, "lon": 72.603, "admin1": "Ханты-Мансийский АО"}, {"name": "Пойковский", "lat": 61.233, "lon": 71.883, "admin1": "Ханты-Мансийский АО"}, {"name": "Пыть-Ях", "lat": 60.75, "lon": 72.858, "admin1": "Ханты-Мансийский АО"}, {"name": "Салым", "lat": 60.062, "lon": 71.478, "admin1": "Ханты-Мансийский АО"}, {"name": "Ханты-Мансийск", "lat": 61, "lon": 69.02, "admin1": "Ханты-Мансийский АО"}, {"name": "Горноправдинск", "lat": 60.056, "lon": 69.908, "admin1": "Ханты-Мансийский АО"}, {"name": "Нягань", "lat": 62.14, "lon": 65.393, "admin1": "Ханты-Мансийский АО"}, {"name": "Приобье", "lat": 62.533, "lon": 65.617, "admin1": "Ханты-Мансийский АО"}, {"name": "Октябрьское (ХМАО)", "lat": 62.454, "lon": 66.05, "admin1": "Ханты-Мансийский АО"}, {"name": "Белоярский (ХМАО)", "lat": 63.711, "lon": 66.672, "admin1": "Ханты-Мансийский АО"}, {"name": "Берёзово", "lat": 63.938, "lon": 65.042, "admin1": "Ханты-Мансийский АО"}, {"name": "Игрим", "lat": 63.19, "lon": 64.417, "admin1": "Ханты-Мансийский АО"}, {"name": "Советский (ХМАО)", "lat": 61.361, "lon": 63.564, "admin1": "Ханты-Мансийский АО"}, {"name": "Югорск", "lat": 61.312, "lon": 63.332, "admin1": "Ханты-Мансийский АО"}, {"name": "Урай", "lat": 60.13, "lon": 64.789, "admin1": "Ханты-Мансийский АО"}, {"name": "Междуреченский", "lat": 59.6, "lon": 65.91, "admin1": "Ханты-Мансийский АО"}, {"name": "Тюмень", "lat": 57.153, "lon": 65.5343, "admin1": "Тюменская обл."}, {"name": "Боровский", "lat": 57.037, "lon": 65.713, "admin1": "Тюменская обл."}, {"name": "Винзили", "lat": 56.953, "lon": 65.792, "admin1": "Тюменская обл."}, {"name": "Ялуторовск", "lat": 56.653, "lon": 66.3, "admin1": "Тюменская обл."}, {"name": "Заводоуковск", "lat": 56.504, "lon": 66.551, "admin1": "Тюменская обл."}, {"name": "Тобольск", "lat": 58.198, "lon": 68.254, "admin1": "Тюменская обл."}, {"name": "Вагай", "lat": 57.937, "lon": 69.022, "admin1": "Тюменская обл."}, {"name": "Уват", "lat": 59.141, "lon": 68.895, "admin1": "Тюменская обл."}, {"name": "Туртас", "lat": 58.943, "lon": 69.142, "admin1": "Тюменская обл."}, {"name": "Ишим", "lat": 56.112, "lon": 69.49, "admin1": "Тюменская обл."}, {"name": "Екатеринбург", "lat": 56.8389, "lon": 60.6057, "admin1": "Свердловская обл."}, {"name": "Верхняя Пышма", "lat": 56.971, "lon": 60.583, "admin1": "Свердловская обл."}, {"name": "Берёзовский (Свердл.)", "lat": 56.908, "lon": 60.804, "admin1": "Свердловская обл."}, {"name": "Среднеуральск", "lat": 56.99, "lon": 60.467, "admin1": "Свердловская обл."}, {"name": "Заречный (Белоярское вдхр.)", "lat": 56.814, "lon": 61.326, "admin1": "Свердловская обл."}, {"name": "Рефтинский", "lat": 57.092, "lon": 61.673, "admin1": "Свердловская обл."}, {"name": "Первоуральск", "lat": 56.905, "lon": 59.943, "admin1": "Свердловская обл."}, {"name": "Ревда", "lat": 56.801, "lon": 59.91, "admin1": "Свердловская обл."}, {"name": "Сысерть", "lat": 56.5, "lon": 60.816, "admin1": "Свердловская обл."}, {"name": "Полевской", "lat": 56.442, "lon": 60.189, "admin1": "Свердловская обл."}, {"name": "Каменск-Уральский", "lat": 56.415, "lon": 61.918, "admin1": "Свердловская обл."}, {"name": "Нижний Тагил", "lat": 57.919, "lon": 59.965, "admin1": "Свердловская обл."}, {"name": "Серов", "lat": 59.603, "lon": 60.578, "admin1": "Свердловская обл."}, {"name": "Сосьва", "lat": 59.176, "lon": 61.854, "admin1": "Свердловская обл."}, {"name": "Гари", "lat": 59.43, "lon": 62.35, "admin1": "Свердловская обл."}, {"name": "Тавда", "lat": 58.042, "lon": 65.272, "admin1": "Свердловская обл."}, {"name": "Челябинск", "lat": 55.1644, "lon": 61.4368, "admin1": "Челябинская обл."}, {"name": "Копейск", "lat": 55.116, "lon": 61.617, "admin1": "Челябинская обл."}, {"name": "Миасс", "lat": 55.045, "lon": 60.108, "admin1": "Челябинская обл."}, {"name": "Чебаркуль", "lat": 54.978, "lon": 60.37, "admin1": "Челябинская обл."}, {"name": "Златоуст", "lat": 55.171, "lon": 59.65, "admin1": "Челябинская обл."}, {"name": "Кыштым", "lat": 55.706, "lon": 60.552, "admin1": "Челябинская обл."}, {"name": "Касли", "lat": 55.889, "lon": 60.758, "admin1": "Челябинская обл."}, {"name": "Южноуральск", "lat": 54.442, "lon": 61.253, "admin1": "Челябинская обл."}, {"name": "Магнитогорск", "lat": 53.407, "lon": 58.979, "admin1": "Челябинская обл."}, {"name": "Курган", "lat": 55.441, "lon": 65.341, "admin1": "Курганская обл."}, {"name": "Шадринск", "lat": 56.085, "lon": 63.633, "admin1": "Курганская обл."}, {"name": "Омск", "lat": 54.9885, "lon": 73.3242, "admin1": "Омская обл."}, {"name": "Тара", "lat": 56.894, "lon": 74.371, "admin1": "Омская обл."}, {"name": "Калачинск", "lat": 55.052, "lon": 74.575, "admin1": "Омская обл."}, {"name": "Черлак", "lat": 54.155, "lon": 74.805, "admin1": "Омская обл."}, {"name": "Новосибирск", "lat": 55.0084, "lon": 82.9357, "admin1": "Новосибирская обл."}, {"name": "Бердск", "lat": 54.758, "lon": 83.107, "admin1": "Новосибирская обл."}, {"name": "Искитим", "lat": 54.64, "lon": 83.305, "admin1": "Новосибирская обл."}, {"name": "Ордынское", "lat": 54.372, "lon": 81.901, "admin1": "Новосибирская обл."}, {"name": "Сузун", "lat": 53.782, "lon": 82.313, "admin1": "Новосибирская обл."}, {"name": "Колывань", "lat": 55.306, "lon": 82.739, "admin1": "Новосибирская обл."}, {"name": "Барабинск", "lat": 55.35, "lon": 78.35, "admin1": "Новосибирская обл."}, {"name": "Чаны", "lat": 55.313, "lon": 76.764, "admin1": "Новосибирская обл."}, {"name": "Томск", "lat": 56.4846, "lon": 84.9476, "admin1": "Томская обл."}, {"name": "Северск", "lat": 56.6, "lon": 84.883, "admin1": "Томская обл."}, {"name": "Колпашево", "lat": 58.316, "lon": 82.909, "admin1": "Томская обл."}, {"name": "Парабель", "lat": 58.698, "lon": 81.482, "admin1": "Томская обл."}, {"name": "Каргасок", "lat": 59.058, "lon": 80.864, "admin1": "Томская обл."}, {"name": "Стрежевой", "lat": 60.733, "lon": 77.589, "admin1": "Томская обл."}, {"name": "Кемерово", "lat": 55.355, "lon": 86.087, "admin1": "Кемеровская обл."}, {"name": "Новокузнецк", "lat": 53.757, "lon": 87.136, "admin1": "Кемеровская обл."}, {"name": "Юрга", "lat": 55.723, "lon": 84.886, "admin1": "Кемеровская обл."}, {"name": "Междуреченск", "lat": 53.694, "lon": 88.06, "admin1": "Кемеровская обл."}, {"name": "Барнаул", "lat": 53.3474, "lon": 83.7784, "admin1": "Алтайский край"}, {"name": "Новоалтайск", "lat": 53.391, "lon": 83.936, "admin1": "Алтайский край"}, {"name": "Бийск", "lat": 52.539, "lon": 85.207, "admin1": "Алтайский край"}, {"name": "Камень-на-Оби", "lat": 53.788, "lon": 81.348, "admin1": "Алтайский край"}, {"name": "Рубцовск", "lat": 51.501, "lon": 81.207, "admin1": "Алтайский край"}, {"name": "Горно-Алтайск", "lat": 51.958, "lon": 85.96, "admin1": "Республика Алтай"}, {"name": "Артыбаш (Телецкое оз.)", "lat": 51.794, "lon": 87.262, "admin1": "Республика Алтай"}, {"name": "Москва", "lat": 55.7558, "lon": 37.6173, "admin1": "Москва"}, {"name": "Зеленоград", "lat": 55.9825, "lon": 37.1814, "admin1": "Москва"}, {"name": "Химки", "lat": 55.897, "lon": 37.429, "admin1": "Московская обл."}, {"name": "Долгопрудный", "lat": 55.938, "lon": 37.514, "admin1": "Московская обл."}, {"name": "Мытищи", "lat": 55.9116, "lon": 37.7308, "admin1": "Московская обл."}, {"name": "Королёв", "lat": 55.922, "lon": 37.825, "admin1": "Московская обл."}, {"name": "Пушкино", "lat": 56.01, "lon": 37.847, "admin1": "Московская обл."}, {"name": "Щёлково", "lat": 55.923, "lon": 37.998, "admin1": "Московская обл."}, {"name": "Балашиха", "lat": 55.796, "lon": 37.938, "admin1": "Московская обл."}, {"name": "Люберцы", "lat": 55.678, "lon": 37.893, "admin1": "Московская обл."}, {"name": "Жуковский", "lat": 55.595, "lon": 38.12, "admin1": "Московская обл."}, {"name": "Раменское", "lat": 55.567, "lon": 38.23, "admin1": "Московская обл."}, {"name": "Бронницы", "lat": 55.425, "lon": 38.264, "admin1": "Московская обл."}, {"name": "Воскресенск", "lat": 55.317, "lon": 38.683, "admin1": "Московская обл."}, {"name": "Коломна", "lat": 55.0794, "lon": 38.7783, "admin1": "Московская обл."}, {"name": "Луховицы", "lat": 54.965, "lon": 39.026, "admin1": "Московская обл."}, {"name": "Кашира", "lat": 54.836, "lon": 38.151, "admin1": "Московская обл."}, {"name": "Ступино", "lat": 54.889, "lon": 38.078, "admin1": "Московская обл."}, {"name": "Серпухов", "lat": 54.9158, "lon": 37.4111, "admin1": "Московская обл."}, {"name": "Чехов", "lat": 55.148, "lon": 37.477, "admin1": "Московская обл."}, {"name": "Подольск", "lat": 55.4242, "lon": 37.5547, "admin1": "Московская обл."}, {"name": "Домодедово", "lat": 55.436, "lon": 37.766, "admin1": "Московская обл."}, {"name": "Одинцово", "lat": 55.679, "lon": 37.263, "admin1": "Московская обл."}, {"name": "Звенигород", "lat": 55.73, "lon": 36.854, "admin1": "Московская обл."}, {"name": "Красногорск", "lat": 55.82, "lon": 37.33, "admin1": "Московская обл."}, {"name": "Истра", "lat": 55.914, "lon": 36.86, "admin1": "Московская обл."}, {"name": "Солнечногорск", "lat": 56.185, "lon": 36.976, "admin1": "Московская обл."}, {"name": "Клин", "lat": 56.333, "lon": 36.733, "admin1": "Московская обл."}, {"name": "Дмитров", "lat": 56.344, "lon": 37.52, "admin1": "Московская обл."}, {"name": "Дубна", "lat": 56.736, "lon": 37.162, "admin1": "Московская обл."}, {"name": "Сергиев Посад", "lat": 56.31, "lon": 38.136, "admin1": "Московская обл."}, {"name": "Орехово-Зуево", "lat": 55.806, "lon": 38.961, "admin1": "Московская обл."}, {"name": "Шатура", "lat": 55.576, "lon": 39.542, "admin1": "Московская обл."}, {"name": "Егорьевск", "lat": 55.383, "lon": 39.033, "admin1": "Московская обл."}, {"name": "Руза", "lat": 55.698, "lon": 36.195, "admin1": "Московская обл."}, {"name": "Можайск", "lat": 55.502, "lon": 36.03, "admin1": "Московская обл."}, {"name": "Волоколамск", "lat": 56.036, "lon": 35.958, "admin1": "Московская обл."}, {"name": "Наро-Фоминск", "lat": 55.387, "lon": 36.733, "admin1": "Московская обл."}, {"name": "Тверь", "lat": 56.8587, "lon": 35.9176, "admin1": "Тверская обл."}, {"name": "Конаково", "lat": 56.7, "lon": 36.768, "admin1": "Тверская обл."}, {"name": "Завидово", "lat": 56.526, "lon": 36.525, "admin1": "Тверская обл."}, {"name": "Кимры", "lat": 56.873, "lon": 37.356, "admin1": "Тверская обл."}, {"name": "Калязин", "lat": 57.243, "lon": 37.854, "admin1": "Тверская обл."}, {"name": "Весьегонск", "lat": 58.663, "lon": 37.26, "admin1": "Тверская обл."}, {"name": "Осташков (Селигер)", "lat": 57.147, "lon": 33.107, "admin1": "Тверская обл."}, {"name": "Ржев", "lat": 56.262, "lon": 34.327, "admin1": "Тверская обл."}, {"name": "Вышний Волочёк", "lat": 57.585, "lon": 34.56, "admin1": "Тверская обл."}, {"name": "Удомля", "lat": 57.878, "lon": 35.006, "admin1": "Тверская обл."}, {"name": "Ярославль", "lat": 57.6261, "lon": 39.8845, "admin1": "Ярославская обл."}, {"name": "Рыбинск", "lat": 58.048, "lon": 38.858, "admin1": "Ярославская обл."}, {"name": "Брейтово", "lat": 58.303, "lon": 37.868, "admin1": "Ярославская обл."}, {"name": "Углич", "lat": 57.528, "lon": 38.318, "admin1": "Ярославская обл."}, {"name": "Мышкин", "lat": 57.786, "lon": 38.455, "admin1": "Ярославская обл."}, {"name": "Ростов Великий", "lat": 57.185, "lon": 39.414, "admin1": "Ярославская обл."}, {"name": "Переславль-Залесский", "lat": 56.736, "lon": 38.854, "admin1": "Ярославская обл."}, {"name": "Кострома", "lat": 57.7679, "lon": 40.9269, "admin1": "Костромская обл."}, {"name": "Волгореченск", "lat": 57.441, "lon": 41.158, "admin1": "Костромская обл."}, {"name": "Иваново", "lat": 57.0004, "lon": 40.9739, "admin1": "Ивановская обл."}, {"name": "Кинешма", "lat": 57.443, "lon": 42.149, "admin1": "Ивановская обл."}, {"name": "Юрьевец", "lat": 57.32, "lon": 43.109, "admin1": "Ивановская обл."}, {"name": "Плёс", "lat": 57.458, "lon": 41.514, "admin1": "Ивановская обл."}, {"name": "Владимир", "lat": 56.129, "lon": 40.4066, "admin1": "Владимирская обл."}, {"name": "Муром", "lat": 55.579, "lon": 42.052, "admin1": "Владимирская обл."}, {"name": "Ковров", "lat": 56.357, "lon": 41.319, "admin1": "Владимирская обл."}, {"name": "Рязань", "lat": 54.6292, "lon": 39.7368, "admin1": "Рязанская обл."}, {"name": "Спас-Клепики", "lat": 55.134, "lon": 40.175, "admin1": "Рязанская обл."}, {"name": "Касимов", "lat": 54.941, "lon": 41.396, "admin1": "Рязанская обл."}, {"name": "Шилово", "lat": 54.324, "lon": 40.875, "admin1": "Рязанская обл."}, {"name": "Тула", "lat": 54.1931, "lon": 37.6173, "admin1": "Тульская обл."}, {"name": "Алексин", "lat": 54.502, "lon": 37.068, "admin1": "Тульская обл."}, {"name": "Калуга", "lat": 54.5138, "lon": 36.2612, "admin1": "Калужская обл."}, {"name": "Обнинск", "lat": 55.096, "lon": 36.61, "admin1": "Калужская обл."}, {"name": "Таруса", "lat": 54.729, "lon": 37.177, "admin1": "Калужская обл."}, {"name": "Нижний Новгород", "lat": 56.3269, "lon": 44.0059, "admin1": "Нижегородская обл."}, {"name": "Бор", "lat": 56.358, "lon": 44.062, "admin1": "Нижегородская обл."}, {"name": "Кстово", "lat": 56.151, "lon": 44.195, "admin1": "Нижегородская обл."}, {"name": "Городец", "lat": 56.643, "lon": 43.472, "admin1": "Нижегородская обл."}, {"name": "Заволжье", "lat": 56.641, "lon": 43.393, "admin1": "Нижегородская обл."}, {"name": "Чкаловск", "lat": 56.768, "lon": 43.242, "admin1": "Нижегородская обл."}, {"name": "Лысково", "lat": 56.012, "lon": 45.025, "admin1": "Нижегородская обл."}, {"name": "Васильсурск", "lat": 56.129, "lon": 46.007, "admin1": "Нижегородская обл."}, {"name": "Павлово", "lat": 55.962, "lon": 43.09, "admin1": "Нижегородская обл."}, {"name": "Выкса", "lat": 55.319, "lon": 42.173, "admin1": "Нижегородская обл."}, {"name": "Чебоксары", "lat": 56.1439, "lon": 47.2489, "admin1": "Чувашская Республика"}, {"name": "Новочебоксарск", "lat": 56.11, "lon": 47.479, "admin1": "Чувашская Республика"}, {"name": "Козловка", "lat": 55.842, "lon": 48.248, "admin1": "Чувашская Республика"}, {"name": "Йошкар-Ола", "lat": 56.6344, "lon": 47.8999, "admin1": "Республика Марий Эл"}, {"name": "Волжск", "lat": 55.866, "lon": 48.358, "admin1": "Республика Марий Эл"}, {"name": "Козьмодемьянск", "lat": 56.341, "lon": 46.564, "admin1": "Республика Марий Эл"}, {"name": "Казань", "lat": 55.7961, "lon": 49.1064, "admin1": "Республика Татарстан"}, {"name": "Зеленодольск", "lat": 55.845, "lon": 48.518, "admin1": "Республика Татарстан"}, {"name": "Васильево", "lat": 55.838, "lon": 48.665, "admin1": "Республика Татарстан"}, {"name": "Лаишево", "lat": 55.405, "lon": 49.55, "admin1": "Республика Татарстан"}, {"name": "Камское Устье", "lat": 55.202, "lon": 49.272, "admin1": "Республика Татарстан"}, {"name": "Тетюши", "lat": 54.938, "lon": 48.838, "admin1": "Республика Татарстан"}, {"name": "Болгар", "lat": 54.96, "lon": 49.043, "admin1": "Республика Татарстан"}, {"name": "Чистополь", "lat": 55.363, "lon": 50.642, "admin1": "Республика Татарстан"}, {"name": "Мамадыш", "lat": 55.716, "lon": 51.409, "admin1": "Республика Татарстан"}, {"name": "Елабуга", "lat": 55.758, "lon": 52.046, "admin1": "Республика Татарстан"}, {"name": "Набережные Челны", "lat": 55.7436, "lon": 52.3958, "admin1": "Республика Татарстан"}, {"name": "Нижнекамск", "lat": 55.6366, "lon": 51.8245, "admin1": "Республика Татарстан"}, {"name": "Мензелинск", "lat": 55.726, "lon": 53.102, "admin1": "Республика Татарстан"}, {"name": "Ульяновск", "lat": 54.3142, "lon": 48.4031, "admin1": "Ульяновская обл."}, {"name": "Димитровград", "lat": 54.214, "lon": 49.618, "admin1": "Ульяновская обл."}, {"name": "Сенгилей", "lat": 53.966, "lon": 48.798, "admin1": "Ульяновская обл."}, {"name": "Старая Майна", "lat": 54.609, "lon": 48.928, "admin1": "Ульяновская обл."}, {"name": "Самара", "lat": 53.1959, "lon": 50.1002, "admin1": "Самарская обл."}, {"name": "Тольятти", "lat": 53.5078, "lon": 49.4204, "admin1": "Самарская обл."}, {"name": "Жигулёвск", "lat": 53.402, "lon": 49.495, "admin1": "Самарская обл."}, {"name": "Сызрань", "lat": 53.155, "lon": 48.474, "admin1": "Самарская обл."}, {"name": "Новокуйбышевск", "lat": 53.099, "lon": 49.948, "admin1": "Самарская обл."}, {"name": "Пенза", "lat": 53.1959, "lon": 45.0183, "admin1": "Пензенская обл."}, {"name": "Саранск", "lat": 54.1874, "lon": 45.1839, "admin1": "Республика Мордовия"}, {"name": "Саратов", "lat": 51.5336, "lon": 46.0343, "admin1": "Саратовская обл."}, {"name": "Энгельс", "lat": 51.4989, "lon": 46.125, "admin1": "Саратовская обл."}, {"name": "Маркс", "lat": 51.709, "lon": 46.749, "admin1": "Саратовская обл."}, {"name": "Вольск", "lat": 52.043, "lon": 47.379, "admin1": "Саратовская обл."}, {"name": "Балаково", "lat": 52.039, "lon": 47.784, "admin1": "Саратовская обл."}, {"name": "Хвалынск", "lat": 52.492, "lon": 48.106, "admin1": "Саратовская обл."}, {"name": "Волгоград", "lat": 48.708, "lon": 44.5133, "admin1": "Волгоградская обл."}, {"name": "Волжский", "lat": 48.785, "lon": 44.775, "admin1": "Волгоградская обл."}, {"name": "Камышин", "lat": 50.088, "lon": 45.405, "admin1": "Волгоградская обл."}, {"name": "Калач-на-Дону", "lat": 48.685, "lon": 43.526, "admin1": "Волгоградская обл."}, {"name": "Ахтубинск", "lat": 48.281, "lon": 46.174, "admin1": "Астраханская обл."}, {"name": "Харабали", "lat": 47.412, "lon": 47.256, "admin1": "Астраханская обл."}, {"name": "Селитренное", "lat": 47.167, "lon": 47.45, "admin1": "Астраханская обл."}, {"name": "Енотаевка", "lat": 47.246, "lon": 47.028, "admin1": "Астраханская обл."}, {"name": "Нариманов", "lat": 46.689, "lon": 47.85, "admin1": "Астраханская обл."}, {"name": "Астрахань", "lat": 46.3497, "lon": 48.0408, "admin1": "Астраханская обл."}, {"name": "Камызяк", "lat": 46.11, "lon": 48.077, "admin1": "Астраханская обл."}, {"name": "Кировский (Астрахань)", "lat": 45.845, "lon": 48.136, "admin1": "Астраханская обл."}, {"name": "Икряное", "lat": 46.093, "lon": 47.734, "admin1": "Астраханская обл."}, {"name": "Мумра", "lat": 45.772, "lon": 47.656, "admin1": "Астраханская обл."}, {"name": "Володарский", "lat": 46.402, "lon": 48.541, "admin1": "Астраханская обл."}, {"name": "Лиман (Астраханская)", "lat": 45.785, "lon": 47.224, "admin1": "Астраханская обл."}, {"name": "Лагань", "lat": 45.391, "lon": 47.362, "admin1": "Республика Калмыкия"}, {"name": "Элиста", "lat": 46.3078, "lon": 44.2558, "admin1": "Республика Калмыкия"}, {"name": "Махачкала", "lat": 42.9849, "lon": 47.5047, "admin1": "Республика Дагестан"}, {"name": "Каспийск", "lat": 42.885, "lon": 47.638, "admin1": "Республика Дагестан"}, {"name": "Дербент", "lat": 42.0678, "lon": 48.2899, "admin1": "Республика Дагестан"}, {"name": "Кизляр", "lat": 43.847, "lon": 46.714, "admin1": "Республика Дагестан"}, {"name": "Киров", "lat": 58.6035, "lon": 49.668, "admin1": "Кировская обл."}, {"name": "Кирово-Чепецк", "lat": 58.552, "lon": 50.043, "admin1": "Кировская обл."}, {"name": "Вятские Поляны", "lat": 56.221, "lon": 51.068, "admin1": "Кировская обл."}, {"name": "Ижевск", "lat": 56.8527, "lon": 53.2115, "admin1": "Удмуртская Республика"}, {"name": "Воткинск", "lat": 57.051, "lon": 53.987, "admin1": "Удмуртская Республика"}, {"name": "Сарапул", "lat": 56.467, "lon": 53.798, "admin1": "Удмуртская Республика"}, {"name": "Камбарка", "lat": 56.266, "lon": 54.205, "admin1": "Удмуртская Республика"}, {"name": "Пермь", "lat": 58.0105, "lon": 56.2502, "admin1": "Пермский край"}, {"name": "Краснокамск", "lat": 58.08, "lon": 55.755, "admin1": "Пермский край"}, {"name": "Добрянка", "lat": 58.459, "lon": 56.416, "admin1": "Пермский край"}, {"name": "Чусовой", "lat": 58.296, "lon": 57.816, "admin1": "Пермский край"}, {"name": "Кунгур", "lat": 57.428, "lon": 56.945, "admin1": "Пермский край"}, {"name": "Оса", "lat": 57.283, "lon": 55.458, "admin1": "Пермский край"}, {"name": "Чайковский", "lat": 56.768, "lon": 54.115, "admin1": "Пермский край"}, {"name": "Березники", "lat": 59.409, "lon": 56.804, "admin1": "Пермский край"}, {"name": "Соликамск", "lat": 59.645, "lon": 56.77, "admin1": "Пермский край"}, {"name": "Уфа", "lat": 54.7388, "lon": 55.9721, "admin1": "Республика Башкортостан"}, {"name": "Бирск", "lat": 55.418, "lon": 55.536, "admin1": "Республика Башкортостан"}, {"name": "Павловка (Павловское вдхр.)", "lat": 55.421, "lon": 56.551, "admin1": "Республика Башкортостан"}, {"name": "Нефтекамск", "lat": 56.088, "lon": 54.248, "admin1": "Республика Башкортостан"}, {"name": "Агидель", "lat": 55.899, "lon": 53.937, "admin1": "Республика Башкортостан"}, {"name": "Стерлитамак", "lat": 53.63, "lon": 55.931, "admin1": "Республика Башкортостан"}, {"name": "Салават", "lat": 53.361, "lon": 55.925, "admin1": "Республика Башкортостан"}, {"name": "Белорецк", "lat": 53.966, "lon": 58.4, "admin1": "Республика Башкортостан"}, {"name": "Оренбург", "lat": 51.7682, "lon": 55.097, "admin1": "Оренбургская обл."}, {"name": "Орск", "lat": 51.229, "lon": 58.475, "admin1": "Оренбургская обл."}, {"name": "Энергетик (Ириклинское вдхр.)", "lat": 51.745, "lon": 58.793, "admin1": "Оренбургская обл."}, {"name": "Бузулук", "lat": 52.788, "lon": 52.262, "admin1": "Оренбургская обл."}, {"name": "Санкт-Петербург", "lat": 59.9343, "lon": 30.3351, "admin1": "Санкт-Петербург"}, {"name": "Кронштадт", "lat": 59.991, "lon": 29.766, "admin1": "Санкт-Петербург"}, {"name": "Сестрорецк", "lat": 60.099, "lon": 29.962, "admin1": "Санкт-Петербург"}, {"name": "Зеленогорск (СПб)", "lat": 60.197, "lon": 29.702, "admin1": "Санкт-Петербург"}, {"name": "Выборг", "lat": 60.709, "lon": 28.749, "admin1": "Ленинградская обл."}, {"name": "Приморск (ЛО)", "lat": 60.366, "lon": 28.609, "admin1": "Ленинградская обл."}, {"name": "Приозерск", "lat": 61.039, "lon": 30.129, "admin1": "Ленинградская обл."}, {"name": "Лосево (Вуокса)", "lat": 60.681, "lon": 30.004, "admin1": "Ленинградская обл."}, {"name": "Шлиссельбург", "lat": 59.946, "lon": 31.033, "admin1": "Ленинградская обл."}, {"name": "Новая Ладога", "lat": 60.103, "lon": 32.302, "admin1": "Ленинградская обл."}, {"name": "Волхов", "lat": 59.925, "lon": 32.338, "admin1": "Ленинградская обл."}, {"name": "Сясьстрой", "lat": 60.136, "lon": 32.569, "admin1": "Ленинградская обл."}, {"name": "Лодейное Поле", "lat": 60.733, "lon": 33.553, "admin1": "Ленинградская обл."}, {"name": "Подпорожье", "lat": 60.911, "lon": 34.17, "admin1": "Ленинградская обл."}, {"name": "Сосновый Бор", "lat": 59.904, "lon": 29.086, "admin1": "Ленинградская обл."}, {"name": "Кингисепп", "lat": 59.373, "lon": 28.613, "admin1": "Ленинградская обл."}, {"name": "Усть-Луга", "lat": 59.66, "lon": 28.295, "admin1": "Ленинградская обл."}, {"name": "Ивангород", "lat": 59.371, "lon": 28.216, "admin1": "Ленинградская обл."}, {"name": "Луга", "lat": 58.737, "lon": 29.845, "admin1": "Ленинградская обл."}, {"name": "Гатчина", "lat": 59.566, "lon": 30.128, "admin1": "Ленинградская обл."}, {"name": "Тихвин", "lat": 59.644, "lon": 33.542, "admin1": "Ленинградская обл."}, {"name": "Кириши", "lat": 59.449, "lon": 32.018, "admin1": "Ленинградская обл."}, {"name": "Великий Новгород", "lat": 58.5228, "lon": 31.2699, "admin1": "Новгородская обл."}, {"name": "Старая Русса", "lat": 57.989, "lon": 31.356, "admin1": "Новгородская обл."}, {"name": "Валдай", "lat": 57.974, "lon": 33.252, "admin1": "Новгородская обл."}, {"name": "Боровичи", "lat": 58.388, "lon": 33.915, "admin1": "Новгородская обл."}, {"name": "Псков", "lat": 57.8194, "lon": 28.3318, "admin1": "Псковская обл."}, {"name": "Гдов (Чудское оз.)", "lat": 58.742, "lon": 27.815, "admin1": "Псковская обл."}, {"name": "Великие Луки", "lat": 56.34, "lon": 30.525, "admin1": "Псковская обл."}, {"name": "Калининград", "lat": 54.7104, "lon": 20.4522, "admin1": "Калининградская обл."}, {"name": "Зеленоградск", "lat": 54.96, "lon": 20.476, "admin1": "Калининградская обл."}, {"name": "Светлогорск", "lat": 54.943, "lon": 20.155, "admin1": "Калининградская обл."}, {"name": "Балтийск", "lat": 54.644, "lon": 19.892, "admin1": "Калининградская обл."}, {"name": "Светлый", "lat": 54.676, "lon": 20.134, "admin1": "Калининградская обл."}, {"name": "Полесск", "lat": 54.863, "lon": 21.099, "admin1": "Калининградская обл."}, {"name": "Советск (Калининградская)", "lat": 55.083, "lon": 21.886, "admin1": "Калининградская обл."}, {"name": "Петрозаводск", "lat": 61.785, "lon": 34.3469, "admin1": "Республика Карелия"}, {"name": "Кондопога", "lat": 62.203, "lon": 34.265, "admin1": "Республика Карелия"}, {"name": "Медвежьегорск", "lat": 62.912, "lon": 34.456, "admin1": "Республика Карелия"}, {"name": "Сегежа", "lat": 63.743, "lon": 34.316, "admin1": "Республика Карелия"}, {"name": "Беломорск", "lat": 64.525, "lon": 34.765, "admin1": "Республика Карелия"}, {"name": "Кемь", "lat": 64.956, "lon": 34.579, "admin1": "Республика Карелия"}, {"name": "Лоухи", "lat": 66.075, "lon": 33.045, "admin1": "Республика Карелия"}, {"name": "Пяозерский", "lat": 65.764, "lon": 31.082, "admin1": "Республика Карелия"}, {"name": "Калевала", "lat": 65.199, "lon": 31.186, "admin1": "Республика Карелия"}, {"name": "Костомукша", "lat": 64.588, "lon": 30.6, "admin1": "Республика Карелия"}, {"name": "Сортавала", "lat": 61.703, "lon": 30.691, "admin1": "Республика Карелия"}, {"name": "Лахденпохья", "lat": 61.519, "lon": 30.199, "admin1": "Республика Карелия"}, {"name": "Питкяранта", "lat": 61.572, "lon": 31.478, "admin1": "Республика Карелия"}, {"name": "Олонец", "lat": 60.985, "lon": 32.971, "admin1": "Республика Карелия"}, {"name": "Пудож", "lat": 61.806, "lon": 36.535, "admin1": "Республика Карелия"}, {"name": "Мурманск", "lat": 68.9707, "lon": 33.075, "admin1": "Мурманская обл."}, {"name": "Кола", "lat": 68.881, "lon": 33.018, "admin1": "Мурманская обл."}, {"name": "Мурмаши", "lat": 68.816, "lon": 32.812, "admin1": "Мурманская обл."}, {"name": "Териберка", "lat": 69.164, "lon": 35.143, "admin1": "Мурманская обл."}, {"name": "Североморск", "lat": 69.069, "lon": 33.416, "admin1": "Мурманская обл."}, {"name": "Мончегорск", "lat": 67.938, "lon": 32.915, "admin1": "Мурманская обл."}, {"name": "Апатиты", "lat": 67.568, "lon": 33.402, "admin1": "Мурманская обл."}, {"name": "Кандалакша", "lat": 67.151, "lon": 32.412, "admin1": "Мурманская обл."}, {"name": "Умба", "lat": 66.687, "lon": 34.343, "admin1": "Мурманская обл."}, {"name": "Варзуга", "lat": 66.398, "lon": 36.588, "admin1": "Мурманская обл."}, {"name": "Ловозеро", "lat": 68.006, "lon": 35.016, "admin1": "Мурманская обл."}, {"name": "Архангельск", "lat": 64.5399, "lon": 40.5158, "admin1": "Архангельская обл."}, {"name": "Северодвинск", "lat": 64.5635, "lon": 39.8302, "admin1": "Архангельская обл."}, {"name": "Новодвинск", "lat": 64.416, "lon": 40.812, "admin1": "Архангельская обл."}, {"name": "Онега", "lat": 63.906, "lon": 38.097, "admin1": "Архангельская обл."}, {"name": "Котлас", "lat": 61.252, "lon": 46.654, "admin1": "Архангельская обл."}, {"name": "Вельск", "lat": 61.066, "lon": 42.102, "admin1": "Архангельская обл."}, {"name": "Мезень", "lat": 65.852, "lon": 44.24, "admin1": "Архангельская обл."}, {"name": "Нарьян-Мар", "lat": 67.638, "lon": 53.006, "admin1": "Ненецкий АО"}, {"name": "Искателей", "lat": 67.679, "lon": 53.133, "admin1": "Ненецкий АО"}, {"name": "Сыктывкар", "lat": 61.6688, "lon": 50.8364, "admin1": "Республика Коми"}, {"name": "Ухта", "lat": 63.567, "lon": 53.683, "admin1": "Республика Коми"}, {"name": "Печора", "lat": 65.147, "lon": 57.228, "admin1": "Республика Коми"}, {"name": "Усинск", "lat": 65.994, "lon": 57.556, "admin1": "Республика Коми"}, {"name": "Усть-Цильма", "lat": 65.441, "lon": 52.15, "admin1": "Республика Коми"}, {"name": "Воркута", "lat": 67.498, "lon": 64.052, "admin1": "Республика Коми"}, {"name": "Ростов-на-Дону", "lat": 47.2225, "lon": 39.7187, "admin1": "Ростовская обл."}, {"name": "Азов", "lat": 47.112, "lon": 39.423, "admin1": "Ростовская обл."}, {"name": "Таганрог", "lat": 47.2096, "lon": 38.9352, "admin1": "Ростовская обл."}, {"name": "Новочеркасск", "lat": 47.418, "lon": 40.093, "admin1": "Ростовская обл."}, {"name": "Семикаракорск", "lat": 47.516, "lon": 40.806, "admin1": "Ростовская обл."}, {"name": "Волгодонск", "lat": 47.514, "lon": 42.153, "admin1": "Ростовская обл."}, {"name": "Цимлянск", "lat": 47.644, "lon": 42.102, "admin1": "Ростовская обл."}, {"name": "Весёлый (Маныч)", "lat": 47.086, "lon": 40.742, "admin1": "Ростовская обл."}, {"name": "Каменск-Шахтинский", "lat": 48.318, "lon": 40.26, "admin1": "Ростовская обл."}, {"name": "Вёшенская", "lat": 49.629, "lon": 41.726, "admin1": "Ростовская обл."}, {"name": "Краснодар", "lat": 45.0355, "lon": 38.9753, "admin1": "Краснодарский край"}, {"name": "Славянск-на-Кубани", "lat": 45.257, "lon": 38.125, "admin1": "Краснодарский край"}, {"name": "Темрюк", "lat": 45.271, "lon": 37.382, "admin1": "Краснодарский край"}, {"name": "Приморско-Ахтарск", "lat": 46.046, "lon": 38.175, "admin1": "Краснодарский край"}, {"name": "Ейск", "lat": 46.711, "lon": 38.273, "admin1": "Краснодарский край"}, {"name": "Тимашевск", "lat": 45.617, "lon": 38.946, "admin1": "Краснодарский край"}, {"name": "Анапа", "lat": 44.895, "lon": 37.316, "admin1": "Краснодарский край"}, {"name": "Новороссийск", "lat": 44.7239, "lon": 37.7689, "admin1": "Краснодарский край"}, {"name": "Геленджик", "lat": 44.561, "lon": 38.077, "admin1": "Краснодарский край"}, {"name": "Туапсе", "lat": 44.098, "lon": 39.074, "admin1": "Краснодарский край"}, {"name": "Сочи", "lat": 43.5855, "lon": 39.7231, "admin1": "Краснодарский край"}, {"name": "Адлер", "lat": 43.429, "lon": 39.923, "admin1": "Краснодарский край"}, {"name": "Майкоп", "lat": 44.6098, "lon": 40.1006, "admin1": "Республика Адыгея"}, {"name": "Севастополь", "lat": 44.6166, "lon": 33.5254, "admin1": "Севастополь"}, {"name": "Балаклава", "lat": 44.501, "lon": 33.599, "admin1": "Севастополь"}, {"name": "Симферополь", "lat": 44.9521, "lon": 34.1024, "admin1": "Республика Крым"}, {"name": "Ялта", "lat": 44.4952, "lon": 34.1663, "admin1": "Республика Крым"}, {"name": "Алушта", "lat": 44.676, "lon": 34.41, "admin1": "Республика Крым"}, {"name": "Судак", "lat": 44.851, "lon": 34.972, "admin1": "Республика Крым"}, {"name": "Феодосия", "lat": 45.0319, "lon": 35.3824, "admin1": "Республика Крым"}, {"name": "Керчь", "lat": 45.356, "lon": 36.467, "admin1": "Республика Крым"}, {"name": "Евпатория", "lat": 45.1904, "lon": 33.3669, "admin1": "Республика Крым"}, {"name": "Черноморское", "lat": 45.504, "lon": 32.702, "admin1": "Республика Крым"}, {"name": "Ставрополь", "lat": 45.0428, "lon": 41.9734, "admin1": "Ставропольский край"}, {"name": "Пятигорск", "lat": 44.0486, "lon": 43.0594, "admin1": "Ставропольский край"}, {"name": "Воронеж", "lat": 51.6608, "lon": 39.2003, "admin1": "Воронежская обл."}, {"name": "Нововоронеж", "lat": 51.315, "lon": 39.218, "admin1": "Воронежская обл."}, {"name": "Лиски", "lat": 50.985, "lon": 39.508, "admin1": "Воронежская обл."}, {"name": "Павловск (Воронежская)", "lat": 50.457, "lon": 40.108, "admin1": "Воронежская обл."}, {"name": "Липецк", "lat": 52.6088, "lon": 39.5992, "admin1": "Липецкая обл."}, {"name": "Елец", "lat": 52.624, "lon": 38.502, "admin1": "Липецкая обл."}, {"name": "Тамбов", "lat": 52.7212, "lon": 41.4523, "admin1": "Тамбовская обл."}, {"name": "Белгород", "lat": 50.595, "lon": 36.587, "admin1": "Белгородская обл."}, {"name": "Старый Оскол", "lat": 51.296, "lon": 37.841, "admin1": "Белгородская обл."}, {"name": "Курск", "lat": 51.7304, "lon": 36.1926, "admin1": "Курская обл."}, {"name": "Курчатов", "lat": 51.66, "lon": 35.656, "admin1": "Курская обл."}, {"name": "Орёл", "lat": 52.9668, "lon": 36.0625, "admin1": "Орловская обл."}, {"name": "Брянск", "lat": 53.2435, "lon": 34.3634, "admin1": "Брянская обл."}, {"name": "Смоленск", "lat": 54.7826, "lon": 32.0453, "admin1": "Смоленская обл."}, {"name": "Десногорск", "lat": 54.152, "lon": 33.285, "admin1": "Смоленская обл."}, {"name": "Красноярск", "lat": 56.0153, "lon": 92.8932, "admin1": "Красноярский край"}, {"name": "Дивногорск", "lat": 55.959, "lon": 92.373, "admin1": "Красноярский край"}, {"name": "Железногорск (Красноярский)", "lat": 56.251, "lon": 93.532, "admin1": "Красноярский край"}, {"name": "Канск", "lat": 56.201, "lon": 95.706, "admin1": "Красноярский край"}, {"name": "Ачинск", "lat": 56.269, "lon": 90.495, "admin1": "Красноярский край"}, {"name": "Лесосибирск", "lat": 58.235, "lon": 92.482, "admin1": "Красноярский край"}, {"name": "Енисейск", "lat": 58.449, "lon": 92.17, "admin1": "Красноярский край"}, {"name": "Туруханск", "lat": 65.795, "lon": 87.962, "admin1": "Красноярский край"}, {"name": "Игарка", "lat": 67.466, "lon": 86.583, "admin1": "Красноярский край"}, {"name": "Дудинка", "lat": 69.405, "lon": 86.177, "admin1": "Красноярский край"}, {"name": "Норильск", "lat": 69.3535, "lon": 88.2027, "admin1": "Красноярский край"}, {"name": "Минусинск", "lat": 53.706, "lon": 91.688, "admin1": "Красноярский край"}, {"name": "Абакан", "lat": 53.7211, "lon": 91.4424, "admin1": "Республика Хакасия"}, {"name": "Саяногорск", "lat": 53.088, "lon": 91.4, "admin1": "Республика Хакасия"}, {"name": "Шира", "lat": 54.491, "lon": 89.953, "admin1": "Республика Хакасия"}, {"name": "Кызыл", "lat": 51.7197, "lon": 94.4378, "admin1": "Республика Тыва"}, {"name": "Иркутск", "lat": 52.2864, "lon": 104.305, "admin1": "Иркутская обл."}, {"name": "Ангарск", "lat": 52.544, "lon": 103.888, "admin1": "Иркутская обл."}, {"name": "Шелехов", "lat": 52.208, "lon": 104.095, "admin1": "Иркутская обл."}, {"name": "Листвянка", "lat": 51.852, "lon": 104.868, "admin1": "Иркутская обл."}, {"name": "Слюдянка", "lat": 51.659, "lon": 103.706, "admin1": "Иркутская обл."}, {"name": "Байкальск", "lat": 51.518, "lon": 104.142, "admin1": "Иркутская обл."}, {"name": "Хужир (Ольхон)", "lat": 53.194, "lon": 107.339, "admin1": "Иркутская обл."}, {"name": "Братск", "lat": 56.151, "lon": 101.634, "admin1": "Иркутская обл."}, {"name": "Усть-Илимск", "lat": 58, "lon": 102.662, "admin1": "Иркутская обл."}, {"name": "Усть-Кут", "lat": 56.794, "lon": 105.767, "admin1": "Иркутская обл."}, {"name": "Улан-Удэ", "lat": 51.8335, "lon": 107.5841, "admin1": "Республика Бурятия"}, {"name": "Гусиноозёрск", "lat": 51.285, "lon": 106.526, "admin1": "Республика Бурятия"}, {"name": "Кабанск", "lat": 52.049, "lon": 106.652, "admin1": "Республика Бурятия"}, {"name": "Усть-Баргузин", "lat": 53.411, "lon": 109.026, "admin1": "Республика Бурятия"}, {"name": "Северобайкальск", "lat": 55.637, "lon": 109.323, "admin1": "Республика Бурятия"}, {"name": "Чита", "lat": 52.033, "lon": 113.501, "admin1": "Забайкальский край"}, {"name": "Якутск", "lat": 62.0355, "lon": 129.6755, "admin1": "Республика Саха (Якутия)"}, {"name": "Покровск (Якутия)", "lat": 61.478, "lon": 129.141, "admin1": "Республика Саха (Якутия)"}, {"name": "Ленск", "lat": 60.725, "lon": 114.928, "admin1": "Республика Саха (Якутия)"}, {"name": "Мирный (Якутия)", "lat": 62.535, "lon": 113.961, "admin1": "Республика Саха (Якутия)"}, {"name": "Вилюйск", "lat": 63.755, "lon": 121.624, "admin1": "Республика Саха (Якутия)"}, {"name": "Алдан", "lat": 58.603, "lon": 125.389, "admin1": "Республика Саха (Якутия)"}, {"name": "Нерюнгри", "lat": 56.658, "lon": 124.725, "admin1": "Республика Саха (Якутия)"}, {"name": "Тикси", "lat": 71.637, "lon": 128.868, "admin1": "Республика Саха (Якутия)"}, {"name": "Благовещенск", "lat": 50.2907, "lon": 127.5272, "admin1": "Амурская обл."}, {"name": "Свободный", "lat": 51.375, "lon": 128.134, "admin1": "Амурская обл."}, {"name": "Зея", "lat": 53.749, "lon": 127.262, "admin1": "Амурская обл."}, {"name": "Тында", "lat": 55.155, "lon": 124.725, "admin1": "Амурская обл."}, {"name": "Биробиджан", "lat": 48.794, "lon": 132.921, "admin1": "Еврейская АО"}, {"name": "Хабаровск", "lat": 48.4802, "lon": 135.0719, "admin1": "Хабаровский край"}, {"name": "Амурск", "lat": 50.226, "lon": 136.899, "admin1": "Хабаровский край"}, {"name": "Комсомольск-на-Амуре", "lat": 50.5496, "lon": 137.0067, "admin1": "Хабаровский край"}, {"name": "Николаевск-на-Амуре", "lat": 53.145, "lon": 140.722, "admin1": "Хабаровский край"}, {"name": "Советская Гавань", "lat": 48.969, "lon": 140.289, "admin1": "Хабаровский край"}, {"name": "Ванино", "lat": 49.092, "lon": 140.264, "admin1": "Хабаровский край"}, {"name": "Владивосток", "lat": 43.1155, "lon": 131.8855, "admin1": "Приморский край"}, {"name": "Артём", "lat": 43.355, "lon": 132.186, "admin1": "Приморский край"}, {"name": "Уссурийск", "lat": 43.797, "lon": 131.952, "admin1": "Приморский край"}, {"name": "Находка", "lat": 42.8138, "lon": 132.8735, "admin1": "Приморский край"}, {"name": "Большой Камень", "lat": 43.112, "lon": 132.348, "admin1": "Приморский край"}, {"name": "Спасск-Дальний", "lat": 44.6, "lon": 132.818, "admin1": "Приморский край"}, {"name": "Камень-Рыболов (Ханка)", "lat": 44.747, "lon": 132.043, "admin1": "Приморский край"}, {"name": "Славянка", "lat": 42.863, "lon": 131.385, "admin1": "Приморский край"}, {"name": "Южно-Сахалинск", "lat": 46.9591, "lon": 142.738, "admin1": "Сахалинская обл."}, {"name": "Корсаков", "lat": 46.634, "lon": 142.776, "admin1": "Сахалинская обл."}, {"name": "Анива", "lat": 46.715, "lon": 142.528, "admin1": "Сахалинская обл."}, {"name": "Холмск", "lat": 47.046, "lon": 142.046, "admin1": "Сахалинская обл."}, {"name": "Поронайск", "lat": 49.222, "lon": 143.102, "admin1": "Сахалинская обл."}, {"name": "Ноглики", "lat": 51.805, "lon": 143.138, "admin1": "Сахалинская обл."}, {"name": "Оха", "lat": 53.589, "lon": 142.949, "admin1": "Сахалинская обл."}, {"name": "Петропавловск-Камчатский", "lat": 53.0452, "lon": 158.6508, "admin1": "Камчатский край"}, {"name": "Елизово", "lat": 53.187, "lon": 158.383, "admin1": "Камчатский край"}, {"name": "Усть-Большерецк", "lat": 52.825, "lon": 156.252, "admin1": "Камчатский край"}, {"name": "Усть-Камчатск", "lat": 56.228, "lon": 162.476, "admin1": "Камчатский край"}, {"name": "Магадан", "lat": 59.5612, "lon": 150.8301, "admin1": "Магаданская обл."}, {"name": "Анадырь", "lat": 64.733, "lon": 177.515, "admin1": "Чукотский АО"}, {"name": "Уренгойское (озеро Негито)", "lat": 65.41, "lon": 77.12, "admin1": "Ямало-Ненецкий АО"}, {"name": "Новый Порт", "lat": 67.69, "lon": 72.9, "admin1": "Ямало-Ненецкий АО"}, {"name": "Горки (ЯНАО)", "lat": 65.06, "lon": 65.28, "admin1": "Ямало-Ненецкий АО"}, {"name": "Заполярный (ЯНАО)", "lat": 66.402, "lon": 73.84, "admin1": "Ямало-Ненецкий АО"}, {"name": "Берёзово (ХМАО)", "lat": 63.937, "lon": 65.043, "admin1": "Ханты-Мансийский АО"}, {"name": "Междуреченский (Кондинское)", "lat": 59.6, "lon": 65.91, "admin1": "Ханты-Мансийский АО"}, {"name": "Фёдоровский (ХМАО)", "lat": 61.608, "lon": 73.718, "admin1": "Ханты-Мансийский АО"}, {"name": "Мишкино (Башкортостан)", "lat": 55.461, "lon": 55.948, "admin1": "Республика Башкортостан"}, {"name": "Караидель", "lat": 55.833, "lon": 56.917, "admin1": "Республика Башкортостан"}, {"name": "Павловка (Башкортостан)", "lat": 55.418, "lon": 56.556, "admin1": "Республика Башкортостан"}, {"name": "Красная Горка (Нуримановский)", "lat": 55.197, "lon": 56.662, "admin1": "Республика Башкортостан"}, {"name": "Дюртюли", "lat": 55.492, "lon": 54.866, "admin1": "Республика Башкортостан"}, {"name": "Кушнаренково", "lat": 55.102, "lon": 55.344, "admin1": "Республика Башкортостан"}, {"name": "Благовещенск (Башкортостан)", "lat": 55.035, "lon": 55.978, "admin1": "Республика Башкортостан"}, {"name": "Янаул", "lat": 56.265, "lon": 54.931, "admin1": "Республика Башкортостан"}, {"name": "Бураево", "lat": 55.841, "lon": 55.408, "admin1": "Республика Башкортостан"}, {"name": "Старобалтачево", "lat": 56, "lon": 55.9, "admin1": "Республика Башкортостан"}, {"name": "Аскино", "lat": 56.089, "lon": 56.578, "admin1": "Республика Башкортостан"}, {"name": "Верхние Татышлы", "lat": 56.289, "lon": 55.858, "admin1": "Республика Башкортостан"}, {"name": "Калтасы", "lat": 55.973, "lon": 54.855, "admin1": "Республика Башкортостан"}, {"name": "Николо-Берёзовка", "lat": 56.128, "lon": 54.162, "admin1": "Республика Башкортостан"}, {"name": "Туймазы", "lat": 54.6, "lon": 53.7, "admin1": "Республика Башкортостан"}, {"name": "Октябрьский (Башкортостан)", "lat": 54.481, "lon": 53.471, "admin1": "Республика Башкортостан"}, {"name": "Бакалы", "lat": 55.179, "lon": 53.803, "admin1": "Республика Башкортостан"}, {"name": "Чекмагуш", "lat": 55.134, "lon": 54.655, "admin1": "Республика Башкортостан"}, {"name": "Чишмы", "lat": 54.592, "lon": 55.388, "admin1": "Республика Башкортостан"}, {"name": "Давлеканово", "lat": 54.219, "lon": 55.028, "admin1": "Республика Башкортостан"}, {"name": "Раевский (Альшеево)", "lat": 54.066, "lon": 54.918, "admin1": "Республика Башкортостан"}, {"name": "Белебей", "lat": 54.103, "lon": 54.122, "admin1": "Республика Башкортостан"}, {"name": "Иглино", "lat": 54.834, "lon": 56.417, "admin1": "Республика Башкортостан"}, {"name": "Кармаскалы", "lat": 54.371, "lon": 56.184, "admin1": "Республика Башкортостан"}, {"name": "Архангельское (Башкортостан)", "lat": 54.421, "lon": 56.792, "admin1": "Республика Башкортостан"}, {"name": "Красноусольский", "lat": 53.892, "lon": 56.469, "admin1": "Республика Башкортостан"}, {"name": "Ишимбай", "lat": 53.449, "lon": 56.046, "admin1": "Республика Башкортостан"}, {"name": "Мелеуз", "lat": 52.963, "lon": 55.932, "admin1": "Республика Башкортостан"}, {"name": "Кумертау", "lat": 52.766, "lon": 55.786, "admin1": "Республика Башкортостан"}, {"name": "Мраково", "lat": 52.716, "lon": 56.625, "admin1": "Республика Башкортостан"}, {"name": "Инзер (Башкортостан)", "lat": 54.216, "lon": 57.556, "admin1": "Республика Башкортостан"}, {"name": "Учалы", "lat": 54.319, "lon": 59.383, "admin1": "Республика Башкортостан"}, {"name": "Сибай", "lat": 52.716, "lon": 58.666, "admin1": "Республика Башкортостан"}, {"name": "Баймак", "lat": 52.592, "lon": 58.316, "admin1": "Республика Башкортостан"}, {"name": "Аскарово (Банное)", "lat": 53.338, "lon": 58.514, "admin1": "Республика Башкортостан"}, {"name": "Месягутово", "lat": 55.552, "lon": 58.252, "admin1": "Республика Башкортостан"}, {"name": "Малояз", "lat": 55.181, "lon": 58.151, "admin1": "Республика Башкортостан"}, {"name": "Большеустьикинское", "lat": 55.956, "lon": 58.273, "admin1": "Республика Башкортостан"}, {"name": "Мишкино (Курганская обл.)", "lat": 55.338, "lon": 63.918, "admin1": "Курганская обл."}, {"name": "Шумиха", "lat": 55.228, "lon": 63.293, "admin1": "Курганская обл."}, {"name": "Куртамыш", "lat": 54.911, "lon": 64.432, "admin1": "Курганская обл."}, {"name": "Макушино", "lat": 55.211, "lon": 67.244, "admin1": "Курганская обл."}, {"name": "Петухово", "lat": 55.069, "lon": 67.893, "admin1": "Курганская обл."}, {"name": "Частоозерье", "lat": 55.568, "lon": 67.908, "admin1": "Курганская обл."}, {"name": "Демьянка", "lat": 59.546, "lon": 69.308, "admin1": "Тюменская обл."}, {"name": "Ярково", "lat": 57.408, "lon": 67.075, "admin1": "Тюменская обл."}, {"name": "Нижняя Тавда", "lat": 57.673, "lon": 66.173, "admin1": "Тюменская обл."}, {"name": "Казанское (Тюменская)", "lat": 55.639, "lon": 69.235, "admin1": "Тюменская обл."}, {"name": "Сосьва (Свердловская)", "lat": 59.176, "lon": 61.855, "admin1": "Свердловская обл."}, {"name": "Ивдель", "lat": 60.691, "lon": 60.421, "admin1": "Свердловская обл."}, {"name": "Ильинский (Обва)", "lat": 58.569, "lon": 55.684, "admin1": "Пермский край"}, {"name": "Пожва", "lat": 59.092, "lon": 56.089, "admin1": "Пермский край"}, {"name": "Чердынь", "lat": 60.403, "lon": 56.479, "admin1": "Пермский край"}, {"name": "Красновишерск", "lat": 60.403, "lon": 57.079, "admin1": "Пермский край"}, {"name": "Болгар (Спасский затон)", "lat": 54.985, "lon": 49.056, "admin1": "Республика Татарстан"}, {"name": "Алексеевское (Кама)", "lat": 55.308, "lon": 50.115, "admin1": "Республика Татарстан"}, {"name": "Рыбная Слобода", "lat": 55.383, "lon": 50.145, "admin1": "Республика Татарстан"}, {"name": "Актаныш", "lat": 55.716, "lon": 54.083, "admin1": "Республика Татарстан"}, {"name": "Звенигово", "lat": 55.972, "lon": 48.015, "admin1": "Республика Марий Эл"}, {"name": "Юрино (Ветлуга)", "lat": 56.292, "lon": 46.299, "admin1": "Республика Марий Эл"}, {"name": "Макарьево", "lat": 56.082, "lon": 45.056, "admin1": "Нижегородская обл."}, {"name": "Брейтово (Рыбинка)", "lat": 58.297, "lon": 37.868, "admin1": "Ярославская обл."}, {"name": "Борок (Рыбинка)", "lat": 58.063, "lon": 38.238, "admin1": "Ярославская обл."}, {"name": "Весьегонск (Рыбинка)", "lat": 58.662, "lon": 37.262, "admin1": "Тверская обл."}, {"name": "Пошехонье", "lat": 58.502, "lon": 39.115, "admin1": "Ярославская обл."}, {"name": "Шигоны (Усинский залив)", "lat": 53.389, "lon": 48.675, "admin1": "Самарская обл."}, {"name": "Ровное", "lat": 50.776, "lon": 46.052, "admin1": "Саратовская обл."}, {"name": "Харабали (Ахтуба)", "lat": 47.412, "lon": 47.256, "admin1": "Астраханская обл."}, {"name": "Черный Яр", "lat": 48.062, "lon": 46.112, "admin1": "Астраханская обл."}, {"name": "Мумра (Главный банк)", "lat": 45.772, "lon": 47.658, "admin1": "Астраханская обл."}, {"name": "Красный Яр (Бузан)", "lat": 46.533, "lon": 48.348, "admin1": "Астраханская обл."}, {"name": "Сириус (Имеретинка)", "lat": 43.402, "lon": 39.961, "admin1": "Краснодарский край"}, {"name": "Хоста", "lat": 43.515, "lon": 39.869, "admin1": "Краснодарский край"}, {"name": "Дагомыс", "lat": 43.661, "lon": 39.654, "admin1": "Краснодарский край"}, {"name": "Лоо", "lat": 43.699, "lon": 39.589, "admin1": "Краснодарский край"}, {"name": "Лазаревское", "lat": 43.908, "lon": 39.331, "admin1": "Краснодарский край"}, {"name": "Джубга", "lat": 44.316, "lon": 38.705, "admin1": "Краснодарский край"}, {"name": "Архипо-Осиповка", "lat": 44.366, "lon": 38.531, "admin1": "Краснодарский край"}, {"name": "Дивноморское", "lat": 44.502, "lon": 38.135, "admin1": "Краснодарский край"}, {"name": "Кабардинка", "lat": 44.651, "lon": 37.939, "admin1": "Краснодарский край"}, {"name": "Большой Утриш", "lat": 44.761, "lon": 37.389, "admin1": "Краснодарский край"}, {"name": "Витязево", "lat": 44.988, "lon": 37.262, "admin1": "Краснодарский край"}, {"name": "Благовещенская (Анапа)", "lat": 45.063, "lon": 37.115, "admin1": "Краснодарский край"}, {"name": "Тамань", "lat": 45.218, "lon": 36.716, "admin1": "Краснодарский край"}, {"name": "Голубицкая", "lat": 45.325, "lon": 37.272, "admin1": "Краснодарский край"}, {"name": "Кучугуры", "lat": 45.405, "lon": 36.958, "admin1": "Краснодарский край"}, {"name": "Садки (Ахтарские лиманы)", "lat": 45.925, "lon": 38.182, "admin1": "Краснодарский край"}, {"name": "Ясенская Переправа", "lat": 46.245, "lon": 38.285, "admin1": "Краснодарский край"}, {"name": "Должанская (Коса Долгая)", "lat": 46.633, "lon": 37.802, "admin1": "Краснодарский край"}];

function getSpotEcoregion(lat, lon, basinCode, waterType = 'small_river', selectedWaterName = '') {
  const bCode = basinCode || detectBasinByCoords(lat, lon);
  const wNameLower = String(selectedWaterName || '').toLowerCase();
  const isLakeOrQuarry = waterType === 'tundra_lake' || waterType === 'quarry';
  const isSea = waterType === 'sea_gulf' || waterType === 'open_sea';

  // 1. ОБЬ-ИРТЫШСКИЙ И ТАЗОВСКИЙ МАКРОБАССЕЙН (разделённый на 5 реальных климатических зон!)
  if (bCode === 'arctic_ob_taz') {
    // 1a. Арктическое побережье и морские губы ЯНАО (Обская, Тазовская, Гыданская губы, Салехард, Тазовский, Яр-Сале, Новый Порт, Антипаюта, Гыда)
    if (lat >= 66.45 || isSea) {
      return {
        subRegion: 'yanao_arctic_coast',
        displayBasinName: 'Обь-Тазовский арктический бассейн (ЯНАО)',
        searchPlaceholder: '🔍 Поиск рыбы (пелядь, сырок, щокур, ряпушка, корюшка, навага, налим, щука...)',
        signatureSpecies: isSea
          ? ['peled', 'chir', 'pizhyan', 'cisco', 'smelt', 'navaga', 'omul_arctic', 'pike', 'perch', 'burbot', 'dace', 'ide', 'roach', 'ruffe', 'char', 'saffron_cod']
          : ['peled', 'chir', 'pizhyan', 'pike', 'perch', 'dace', 'burbot', 'cisco', 'roach', 'ide', 'ruffe', 'grayling', 'smelt', 'char']
      };
    }

    // 1b. Северный таёжно-тундровый бассейн ЯНАО (Новый Уренгой, Коротчаево, Уренгой, Надым, Пангоды, Тарко-Сале, Губкинский, Муравленко, Ноябрьск, Красноселькуп, Харп)
    if (lat >= 62.6) {
      return {
        subRegion: 'yanao_north_taiga',
        displayBasinName: 'Обь-Тазовский северный бассейн (ЯНАО: Пур, Таз, Надым, Обь)',
        searchPlaceholder: '🔍 Поиск рыбы (елец, сырок, пелядь, щука, окунь, сорога, щокур, налим...)',
        signatureSpecies: isLakeOrQuarry
          ? ['perch', 'pike', 'peled', 'roach', 'chir', 'pizhyan', 'burbot', 'crucian', 'dace', 'ide', 'ruffe', 'cisco']
          : ['perch', 'pike', 'dace', 'roach', 'peled', 'ide', 'burbot', 'chir', 'pizhyan', 'ruffe', 'cisco', 'grayling', 'tugun']
      };
    }

    // 1c. ХМАО-Югра и Среднее Приобье (Сургут, Нижневартовск, Ханты-Мансийск, Нефтеюганск, Когалым, Нягань, Приобье, Берёзово, Игрим, Урай, Уват)
    if (lat >= 58.5 && lon >= 61.5 && lon < 85.5) {
      return {
        subRegion: 'hmao_middle_ob',
        displayBasinName: 'Обь-Иртышский таёжный бассейн (Югра: Обь, Иртыш, Конда, Вах)',
        searchPlaceholder: '🔍 Поиск рыбы (щука, окунь, язь, сорога, чебак, елец, сырок, карась, налим, судак...)',
        signatureSpecies: isLakeOrQuarry
          ? ['perch', 'pike', 'crucian', 'roach', 'peled', 'ide', 'rotan', 'burbot', 'bream', 'zander', 'tench', 'ruffe']
          : ['pike', 'perch', 'roach', 'ide', 'dace', 'burbot', 'peled', 'zander', 'bream', 'crucian', 'ruffe', 'gudgeon', 'tugun', 'sterlet']
      };
    }

    // 1d. Горно-озёрный Средний и Южный Урал (Екатеринбург, Нижний Тагил, Серов, Каменск-Уральский, Челябинск, Миасс, Чебаркуль, Кыштым, Касли, оз. Увильды, оз. Тургояк)
    if (lon >= 58.8 && lon <= 62.1 && lat >= 54.0 && lat < 61.0) {
      return {
        subRegion: 'ural_mountain_lakes',
        displayBasinName: 'Уральский бассейн (Исеть, Чусовая, Миасс, озёра Урала)',
        searchPlaceholder: '🔍 Поиск рыбы (окунь, щука, чебак, лещ, карась, судак, карп, рипус, сиг, язь...)',
        signatureSpecies: waterType === 'quarry'
          ? ['perch', 'pike', 'roach', 'bream', 'crucian', 'zander', 'carp', 'vendace', 'whitefish', 'peled', 'ide', 'tench', 'ruffe', 'burbot', 'rudd', 'bleak', 'rotan']
          : (waterType === 'tundra_lake'
              ? ['crucian', 'perch', 'rotan', 'pike', 'roach', 'carp', 'bream', 'tench', 'rudd', 'bleak', 'ruffe', 'peled']
              : ['perch', 'pike', 'roach', 'bream', 'dace', 'ide', 'crucian', 'chub', 'zander', 'carp', 'gudgeon', 'ruffe', 'bleak', 'burbot', 'tench', 'grayling', 'white_bream', 'rudd'])
      };
    }

    // 1e. Южное Зауралье, Тобол, Исеть, Тура, Ишим и Омское Прииртышье (Курганская обл. — Мишкино, Шумиха, Шадринск, Курган, Куртамыш, Макушино; Тюмень, Тобольск, Ялуторовск, Ишим, Тавда; Омск, Тара, Калачинск)
    if (lon > 62.1 && lon < 76.2 && lat < 58.5) {
      const isKurgan = lat <= 56.4 && lon >= 62.1 && lon <= 68.5;
      return {
        subRegion: 'zauralye_tobol_irtysh',
        displayBasinName: isKurgan
          ? 'Тобол-Исетский бассейн (Зауралье: Тобол, Исеть, Миасс, озёра)'
          : 'Обь-Иртышский бассейн (Тура, Тобол, Ишим, Иртыш)',
        searchPlaceholder: '🔍 Поиск рыбы (карась, окунь, щука, чебак, плотва, лещ, судак, язь, сазан, ротан...)',
        signatureSpecies: isLakeOrQuarry
          ? ['crucian', 'perch', 'rotan', 'pike', 'roach', 'carp', 'bream', 'zander', 'tench', 'peled', 'ide', 'rudd', 'bleak', 'ruffe', 'loach']
          : (waterType === 'big_river'
              ? ['perch', 'pike', 'zander', 'bream', 'roach', 'ide', 'crucian', 'carp', 'dace', 'burbot', 'ruffe', 'white_bream', 'gudgeon', 'bleak', 'tench', 'rudd', 'sterlet']
              : ['perch', 'pike', 'roach', 'crucian', 'ide', 'bream', 'dace', 'carp', 'zander', 'gudgeon', 'ruffe', 'bleak', 'tench', 'burbot', 'white_bream', 'rudd', 'rotan', 'loach'])
      };
    }

    // 1f. Верхняя Обь, Новосибирск, Барабинск/Чаны, Томск, Кузбасс и Алтай (lon >= 76.2)
    const isAltaiFoothills = (lat <= 54.4 && lon >= 83.2) || /телецк|бия|катунь|мрассу|кондoма|мана|томь/i.test(wNameLower);
    return {
      subRegion: isAltaiFoothills ? 'altai_mountain_ob' : 'upper_ob_steppe',
      displayBasinName: isAltaiFoothills
        ? 'Верхне-Обский и Алтайский бассейн (Бия, Катунь, Томь, Телецкое оз.)'
        : 'Верхне-Обский бассейн (Обь, Обское море, Томь, оз. Чаны)',
      searchPlaceholder: isAltaiFoothills
        ? '🔍 Поиск рыбы (хариус, окунь, щука, чебак, елец, ленок, таймень, налим...)'
        : '🔍 Поиск рыбы (окунь, щука, судак, чебак, плотва, лещ, язь, карась, сазан...)',
      signatureSpecies: isAltaiFoothills
        ? ['grayling', 'perch', 'pike', 'dace', 'roach', 'lenok', 'ide', 'burbot', 'zander', 'bream', 'crucian', 'gudgeon', 'ruffe']
        : (isLakeOrQuarry
            ? ['crucian', 'perch', 'pike', 'roach', 'zander', 'bream', 'ide', 'carp', 'tench', 'rotan', 'peled', 'ruffe', 'bleak', 'rudd']
            : ['perch', 'pike', 'zander', 'roach', 'bream', 'ide', 'crucian', 'dace', 'carp', 'burbot', 'ruffe', 'gudgeon', 'bleak', 'tench', 'white_bream', 'sterlet'])
    };
  }

  // 2. ВОЛЖСКО-КАСПИЙСКИЙ МАКРОБАССЕЙН (разделённый на Нижнюю Волгу/Каспий, Прикамье/Башкирию/Урал и Верхнюю/Среднюю Волгу)
  if (bCode === 'volga_caspian') {
    // 2a. Нижняя Волга (Астрахань, Ахтуба, Дельта Волги) и Каспийское море (Дагестан, Калмыкия)
    if (lat <= 48.85) {
      return {
        subRegion: 'lower_volga_caspian',
        displayBasinName: 'Нижне-Волжский и Каспийский бассейн (Дельта Волги, Ахтуба, Каспий)',
        searchPlaceholder: '🔍 Поиск рыбы (сазан, судак, жерех, сом, вобла, щука, окунь, лещ, красноперка, кутум...)',
        signatureSpecies: isSea
          ? ['vobla', 'kutum', 'carp', 'zander', 'asp', 'pike', 'perch', 'rudd', 'bream', 'catfish', 'goby', 'chekhon', 'mullet']
          : ['carp', 'zander', 'asp', 'catfish', 'pike', 'perch', 'vobla', 'bream', 'crucian', 'rudd', 'roach', 'chekhon', 'white_bream', 'volga_zander', 'tench', 'silver_carp', 'grass_carp', 'buffalo', 'blue_bream', 'sopa', 'ide', 'bleak']
      };
    }

    // 2b. Камско-Бельский и Уральский бассейн (Башкортостан — Уфа, Мишкино РБ, Бирск, Павловка; Пермский край; Удмуртия; Оренбургская обл. — Урал, Ирикла)
    if (lon >= 52.0) {
      const isUralRiver = lat <= 53.6 && lon >= 52.0;
      const isBashkirMountain = lon >= 56.2 && lat >= 52.8 && lat <= 56.2;
      return {
        subRegion: 'kama_belaya_ural',
        displayBasinName: isUralRiver
          ? 'Уральский бассейн (р. Урал, Сакмара, Ириклинское вдхр.)'
          : 'Камско-Бельский бассейн (Белая, Уфа, Кама, Павловское вдхр.)',
        searchPlaceholder: '🔍 Поиск рыбы (щука, окунь, судак, лещ, голавль, жерех, сорога, карась, сазан, сом...)',
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

    // 2c. Верхняя и Средняя Волга, Ока, Москва и Центр РФ
    return {
      subRegion: 'upper_middle_volga',
      displayBasinName: 'Волжско-Окский бассейн (Волга, Ока, водохранилища Центра и Поволжья)',
      searchPlaceholder: '🔍 Поиск рыбы (лещ, судак, окунь, щука, плотва, карась, голавль, жерех, сазан, сом...)',
      signatureSpecies: isLakeOrQuarry
        ? ['perch', 'pike', 'bream', 'roach', 'crucian', 'zander', 'white_bream', 'carp', 'rudd', 'tench', 'bleak', 'ide', 'catfish', 'volga_zander', 'blue_bream', 'rotan', 'ruffe', 'burbot']
        : ['perch', 'pike', 'bream', 'roach', 'zander', 'crucian', 'white_bream', 'chub', 'asp', 'carp', 'ide', 'catfish', 'bleak', 'rudd', 'tench', 'chekhon', 'volga_zander', 'blue_bream', 'sopa', 'dace', 'gudgeon', 'ruffe', 'burbot', 'undermouth', 'sterlet']
    };
  }

  // 3. ЧЕРНОМОРСКО-АЗОВСКИЙ, ДОНСКОЙ И КУБАНСКИЙ БАССЕЙН
  if (bCode === 'black_azov') {
    const isCaucasianStream = lat <= 44.65 && lat >= 43.3 && lon >= 38.4 && lon <= 40.5 && (waterType === 'small_river' || /мзымта|сочи|шахе|хоста|псоу|аше|псезуапсе/i.test(wNameLower));
    if (isSea) {
      return {
        subRegion: 'black_azov_sea',
        displayBasinName: 'Черноморско-Азовский морской бассейн (Чёрное и Азовское моря)',
        searchPlaceholder: '🔍 Поиск рыбы (ставрида, барабулька, сарган, смарида, луфарь, пеленгас, скорпена, ласкирь...)',
        signatureSpecies: ['horse_mackerel', 'red_mullet', 'sea_bass', 'garfish', 'mullet', 'scorpionfish', 'sea_bream', 'wrasse', 'bluefish', 'goby', 'flounder', 'turbot', 'mackerel', 'crab']
      };
    }
    if (isCaucasianStream) {
      return {
        subRegion: 'caucasus_mountain_river',
        displayBasinName: 'Черноморский бассейн (горные реки Кавказа и Сочи)',
        searchPlaceholder: '🔍 Поиск рыбы (форель, пеструшка, голавль, усач, подуст, бычок, кумжа...)',
        signatureSpecies: ['brown_trout', 'chub', 'barbel', 'trout', 'undermouth', 'gudgeon', 'dace', 'goby', 'bleak']
      };
    }
    const isDon = lat >= 46.8;
    return {
      subRegion: 'don_kuban_inland',
      displayBasinName: isDon ? 'Донской бассейн (Дон, Северский Донец, Маныч, Воронеж)' : 'Кубанско-Азовский бассейн (Кубань, лиманы, водохранилища)',
      searchPlaceholder: '🔍 Поиск рыбы (сазан, карась, судак, тарань, щука, окунь, лещ, сом, голавль, жерех, рыбец...)',
      signatureSpecies: ['carp', 'crucian', 'zander', 'pike', 'perch', 'taran', 'bream', 'roach', 'catfish', 'chub', 'asp', 'rudd', 'white_bream', 'silver_carp', 'grass_carp', 'vimba', 'chekhon', 'goby', 'tench', 'bleak', 'volga_zander', 'barbel']
    };
  }

  // 4. ДНЕПРОВСКО-ДОНСКОЙ (ЗАПАДНЫЙ / ЦЕНТРАЛЬНО-ЧЕРНОЗЁМНЫЙ) БАССЕЙН
  if (bCode === 'euro_west') {
    return {
      subRegion: 'euro_west_desna_seim',
      displayBasinName: 'Днепровско-Деснянский и Сеймский бассейн (Днепр, Десна, Сейм, Оскол)',
      searchPlaceholder: '🔍 Поиск рыбы (щука, окунь, лещ, карась, плотва, судак, голавль, карп, жерех, сом...)',
      signatureSpecies: ['perch', 'pike', 'crucian', 'bream', 'roach', 'zander', 'carp', 'chub', 'asp', 'white_bream', 'ide', 'tench', 'rudd', 'bleak', 'catfish', 'dace', 'gudgeon', 'ruffe', 'burbot', 'rotan']
    };
  }

  // 5. БАЛТИЙСКИЙ БАССЕЙН (Финский залив, Нева, Луга, Псковско-Чудское оз., Калининград)
  if (bCode === 'baltic') {
    return {
      subRegion: 'baltic_sea_rivers',
      displayBasinName: 'Балтийский бассейн (Финский и Куршский заливы, Преголя, Луга, Чудское оз.)',
      searchPlaceholder: '🔍 Поиск рыбы (судак, окунь, щука, лещ, корюшка, плотва, камбала, сарган, треска, рыбец...)',
      signatureSpecies: isSea
        ? ['smelt', 'flounder', 'zander', 'perch', 'pike', 'bream', 'roach', 'garfish', 'cod', 'herring', 'plaice', 'vimba', 'goby', 'salmon', 'trout']
        : ['perch', 'pike', 'zander', 'bream', 'roach', 'white_bream', 'crucian', 'smelt', 'ide', 'vimba', 'chub', 'asp', 'tench', 'rudd', 'bleak', 'burbot', 'ruffe', 'dace']
    };
  }

  // 6. ЛАДОЖСКО-ОНЕЖСКИЙ И КАРЕЛЬСКИЙ БАССЕЙН
  if (bCode === 'nw_karelia') {
    return {
      subRegion: 'karelia_ladoga_onega',
      displayBasinName: 'Ладожско-Онежский и Карельский бассейн (Ладога, Онега, Вуокса, Карелия)',
      searchPlaceholder: '🔍 Поиск рыбы (окунь, щука, судак, сиг, хариус, форель, ряпушка, плотва, лещ, налим...)',
      signatureSpecies: ['perch', 'pike', 'zander', 'roach', 'bream', 'whitefish', 'vendace', 'grayling', 'trout', 'burbot', 'ide', 'dace', 'smelt', 'salmon', 'broad_whitefish', 'ruffe', 'crucian']
    };
  }

  // 7. БАРЕНЦЕВО-БЕЛОМОРСКИЙ И ПЕЧОРСКИЙ СЕВЕРНЫЙ БАССЕЙН
  if (bCode === 'barents_white') {
    const isPechoraDvina = lon >= 38.5;
    return {
      subRegion: isPechoraDvina ? 'dvina_pechora_north' : 'kola_barents',
      displayBasinName: isPechoraDvina
        ? 'Северо-Двинский и Печорский бассейн (Северная Двина, Вычегда, Печора, Белое море)'
        : 'Кольско-Баренцевоморский бассейн (Кольский п-ов, Баренцево и Белое моря)',
      searchPlaceholder: isSea
        ? '🔍 Поиск рыбы (треска, сайда, пикша, камбала, палтус, навага, корюшка, горбуша, семга...)'
        : '🔍 Поиск рыбы (хариус, сиг, кумжа, семга, щука, окунь, налим, горбуша, голец, плотва...)',
      signatureSpecies: isSea
        ? ['cod', 'haddock', 'saithe', 'flounder', 'plaice', 'navaga', 'smelt', 'halibut', 'wolffish', 'herring', 'salmon', 'pink_salmon', 'sea_bass', 'capelin']
        : (isPechoraDvina
            ? ['pike', 'perch', 'grayling', 'whitefish', 'roach', 'ide', 'dace', 'burbot', 'salmon', 'pink_salmon', 'peled', 'chir', 'pizhyan', 'vendace', 'ruffe', 'smelt', 'navaga']
            : ['trout', 'grayling', 'char', 'whitefish', 'salmon', 'pink_salmon', 'pike', 'perch', 'burbot', 'vendace', 'dace', 'roach', 'smelt'])
    };
  }

  // 8. ЕНИСЕЙСКО-ЛЕНСКИЙ БАССЕЙН (разделённый на Юг Сибири / Красноярск / Хакасию и Север / Таймыр / Якутию)
  if (bCode === 'yenisei_lena') {
    const isNorthYeniseiOrLena = lat >= 60.0 || lon >= 108.0;
    return {
      subRegion: isNorthYeniseiOrLena ? 'yenisei_lena_north' : 'yenisei_angara_south',
      displayBasinName: lon >= 108.0
        ? 'Ленский бассейн (Лена, Вилюй, Алдан, Амга — Якутия)'
        : (lat >= 60.0
            ? 'Нижне-Енисейский и Таймырский северный бассейн'
            : 'Верхне-Енисейский и Ангарский бассейн (Енисей, Ангара, Мана, Хакасия)'),
      searchPlaceholder: isNorthYeniseiOrLena
        ? '🔍 Поиск рыбы (хариус, ленок, щука, окунь, пелядь, чир, пыжьян, тугун, налим, елец...)'
        : '🔍 Поиск рыбы (хариус, окунь, щука, елец, ленок, сорога, налим, пелядь, лещ, таймень...)',
      signatureSpecies: isNorthYeniseiOrLena
        ? ['pike', 'perch', 'grayling', 'lenok', 'dace', 'peled', 'chir', 'pizhyan', 'tugun', 'valek', 'ide', 'roach', 'crucian', 'burbot', 'cisco', 'char']
        : ['grayling', 'perch', 'pike', 'dace', 'roach', 'lenok', 'ide', 'crucian', 'burbot', 'peled', 'bream', 'zander', 'ruffe', 'gudgeon', 'tugun', 'pizhyan']
    };
  }

  // 9. БАЙКАЛО-АНГАРСКИЙ БАССЕЙН
  if (bCode === 'baikal') {
    return {
      subRegion: 'baikal_angara_selenga',
      displayBasinName: 'Байкало-Ангарский бассейн (Байкал, Ангара, Селенга, Баргузин)',
      searchPlaceholder: '🔍 Поиск рыбы (байкальский хариус, омуль, ленок, окунь, щука, сорога, елец, сиг, налим...)',
      signatureSpecies: ['baikal_grayling', 'perch', 'pike', 'roach', 'dace', 'omul', 'lenok', 'crucian', 'ide', 'burbot', 'pizhyan', 'peled', 'ruffe']
    };
  }

  // 10. АМУРСКИЙ ПРЕСНОВОДНЫЙ БАССЕЙН
  if (bCode === 'amur') {
    return {
      subRegion: 'amur_ussuri_zeya',
      displayBasinName: 'Амурский бассейн (Амур, Зея, Бурея, Уссури, оз. Ханка)',
      searchPlaceholder: '🔍 Поиск рыбы (карась, сазан, щука, верхогляд, змееголов, ленок, хариус, сом, конь-губарь, кета...)',
      signatureSpecies: ['crucian', 'carp', 'pike', 'sky_gazer', 'snakehead', 'amur_catfish', 'tarpon_carp', 'parabramis', 'lenok', 'grayling', 'grass_carp', 'burbot', 'rotan', 'chum_salmon', 'pink_salmon', 'gudgeon']
    };
  }

  // 11. ТИХООКЕАНСКИЙ ДАЛЬНЕВОСТОЧНЫЙ БАССЕЙН
  return {
    subRegion: 'pacific_far_east',
    displayBasinName: 'Тихоокеанский бассейн (Приморье, Сахалин, Камчатка, Охотское море)',
    searchPlaceholder: '🔍 Поиск рыбы (кета, горбуша, кижуч, мальма, кунджа, корюшка, навага, камбала, терпуг, сима...)',
    signatureSpecies: isSea
      ? ['smelt', 'navaga', 'starry_flounder', 'flounder', 'greenling', 'pink_salmon', 'chum_salmon', 'coho_salmon', 'cherry_salmon', 'char', 'dolly_varden', 'herring', 'walleye_pollock', 'sea_bass', 'halibut', 'crab', 'king_crab']
      : ['dolly_varden', 'char', 'pink_salmon', 'chum_salmon', 'coho_salmon', 'cherry_salmon', 'sockeye_salmon', 'chinook_salmon', 'smelt', 'navaga', 'grayling', 'crucian', 'pike', 'rotan']
  };
}

/**
 * Строгая гео-ихтиологическая проверка: обитает ли конкретный вид рыбы `fish`
 * в точке `(lat, lon)` с учётом выбранного радиуса (`50 км` или `120 км`),
 * типа водоёма `waterType` и реально присутствующих в радиусе водоёмов (`radiusWaterTypes`).
 */
function isSpeciesInGeoRange(fish, lat, lon, basinCode, waterType = 'small_river', radiusKm = 50, radiusWaterTypes = null, isCoastal = false, hasCoolingInRadius = false, selectedWaterName = '') {
  if (!fish) return false;
  const bCode = basinCode || detectBasinByCoords(lat, lon);
  if (!Array.isArray(fish.basins) || !fish.basins.includes(bCode)) return false;

  const fid = fish.id;
  const rSet = radiusWaterTypes instanceof Set ? radiusWaterTypes : new Set([waterType]);
  const wNameLower = String(selectedWaterName || '').toLowerCase();
  const isSeaWater = waterType === 'sea_gulf' || waterType === 'open_sea';
  const hasBigRiverInRadius = waterType === 'big_river' || rSet.has('big_river');
  const hasLakeOrQuarryInRadius = waterType === 'tundra_lake' || waterType === 'quarry' || rSet.has('tundra_lake') || rSet.has('quarry');
  const hasDeepQuarryInRadius = waterType === 'quarry' || rSet.has('quarry');
  const hasSeaInRadius = isCoastal || isSeaWater || rSet.has('sea_gulf') || rSet.has('open_sea');

  // 1. Проверка соответствия биотопу с учётом радиуса 50 км (строго локальный водоём) и 120 км (водоёмы района)
  const fishWaters = Array.isArray(fish.waters) ? fish.waters : ['small_river', 'big_river', 'quarry', 'tundra_lake'];
  let waterMatch = fishWaters.includes(waterType);
  if ((waterType === 'sea_gulf' || waterType === 'open_sea') && (fish.habitat === 'sea' || fishWaters.includes('sea_gulf') || fishWaters.includes('open_sea'))) {
    waterMatch = true;
  }

  if (!waterMatch && !isSeaWater && fish.habitat === 'fresh') {
    if (radiusKm >= 120) {
      // В радиусе 120 км допускаем виды, чьи биотопы реально есть среди водоёмов в радиусе 120 км
      waterMatch = fishWaters.some(wt => rSet.has(wt));
    } else {
      // В радиусе 50 км: если выбрана малая река, допускаем заход видов только из непосредственно связанной большой реки в 50 км (кроме чисто озёрных рыб)
      if (waterType === 'small_river' && rSet.has('big_river') && fishWaters.includes('big_river') && !['vendace', 'whitefish', 'broad_whitefish', 'omul'].includes(fid)) {
        waterMatch = true;
      }
    }
  }
  if (!waterMatch) return false;

  // 2. Морские и полупроходные виды в пресных водах
  if (fish.habitat === 'sea' && !isSeaWater) {
    if (!fish.riverEntry && !['smelt', 'navaga', 'flounder', 'starry_flounder', 'mullet', 'goby', 'pink_salmon', 'chum_salmon', 'coho_salmon', 'sockeye_salmon', 'chinook_salmon', 'cherry_salmon', 'kutum', 'omul_arctic', 'herring'].includes(fid)) {
      return false;
    }
    if (!hasSeaInRadius) {
      // Вдали от морского побережья из морских/полупроходных видов могут встречаться только пресноводный снеток (smelt в озёрах СЗ и Верхней Волги), бычок-кругляк (goby в реках Волги/Дона/Москвы) и проходные дальневосточные/северные лососи
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

  // 3. Теплолюбивые вселенцы и объекты товарной аквакультуры (тиляпия, канальный сомик, буффало, веслонос, радужная форель, белый амур, толстолобик)
  if (fish.legal === 'introduced') {
    if (['tilapia', 'channel_catfish', 'paddlefish', 'buffalo'].includes(fid)) {
      const isSouthernWarm = lat <= 48.5 && (bCode === 'black_azov' || bCode === 'volga_caspian');
      if (waterType !== 'cooling_reservoir' && !(radiusKm >= 120 && hasCoolingInRadius) && !(isSouthernWarm && fid === 'buffalo')) {
        return false;
      }
    }
    if (['silver_carp', 'grass_carp'].includes(fid)) {
      if (lat >= 57.5 && waterType !== 'cooling_reservoir' && !hasCoolingInRadius) return false;
      if (waterType === 'small_river' && lat >= 52.0 && !hasCoolingInRadius) return false;
    }
    if (fid === 'rainbow_trout') {
      if (waterType !== 'cooling_reservoir' && waterType !== 'quarry' && bCode !== 'pacific_sea') return false;
    }
  }

  // 4. СТРОГИЕ ШИРОТНЫЕ И ДОЛГОТНЫЕ АРЕАЛЫ СЕВЕРНЫХ (АРКТИЧЕСКИХ И СИБИРСКИХ) ВИДОВ
  // 4a. Голец арктический / Кунджа (char) — НИКОГДА не водится в Курганской, Тюменской, Омской, Свердловской, Челябинской, Новосибирской областях!
  if (fid === 'char') {
    if (bCode === 'arctic_ob_taz' || bCode === 'yenisei_lena') {
      if (lat < 66.0) return false; // Только Полярный Урал, Ямал, Гыдан, Таймыр, Путорана
    } else if (bCode === 'barents_white') {
      if (lat < 65.5) return false; // Кольский п-ов, Северная Карелия, НАО
    } else if (bCode === 'baikal') {
      if (lat < 54.0 || !hasDeepQuarryInRadius) return false;
    } else if (bCode !== 'pacific_sea') {
      return false;
    }
  }

  // 4b. Щокур / Чир (chir) — только Север (ЯНАО, север ХМАО, Таймыр, Якутия, Печора, Чукотка; lat >= 60.5°N)
  if (fid === 'chir') {
    if (bCode === 'arctic_ob_taz') {
      if (lat < 60.5) return false;
    } else if (bCode === 'yenisei_lena') {
      if (lat < 59.5) return false;
    } else if (bCode === 'barents_white') {
      if (lat < 64.0 || lon < 49.0) return false; // Бассейн Печоры / НАО
    } else if (bCode === 'pacific_sea') {
      if (lat < 59.0) return false; // Анадырь / Колыма / Магадан
    } else {
      return false;
    }
  }

  // 4c. Пыжьян / Сибирский сиг (pizhyan) — Север (lat >= 60.0°N в Зап. Сибири) или высокогорное Телецкое озеро / Байкал / Восточная Сибирь
  if (fid === 'pizhyan') {
    if (bCode === 'arctic_ob_taz') {
      const isTeletskoye = lat <= 52.3 && lon >= 86.5 && hasDeepQuarryInRadius;
      if (lat < 60.0 && !isTeletskoye) return false;
    } else if (bCode === 'barents_white') {
      if (lat < 63.5 || lon < 44.0) return false;
    }
  }

  // 4d. Пелядь / Сырок (peled)
  if (fid === 'peled') {
    if (bCode === 'arctic_ob_taz') {
      // На юге Западной Сибири и в Зауралье (Курган, Челябинск, Екатеринбург, Тюмень, Омск, Новосибирск — lat < 59.2°N)
      // пелядь (сырок) живёт ТОЛЬКО в зарыбляемых озёрах и водохранилищах (tundra_lake, quarry), но НЕ в реках!
      if (lat < 59.2) {
        if (waterType !== 'tundra_lake' && waterType !== 'quarry') return false;
      }
    } else if (bCode === 'volga_caspian') {
      // В Волжско-Каспийском бассейне — только глубокие озёра Урала или Верхней Волги
      if (waterType !== 'quarry' && waterType !== 'tundra_lake') return false;
      if (lat < 53.5) return false;
    } else if (bCode === 'barents_white') {
      if (lon < 42.0) return false; // Бассейн Печоры и Мезени
    }
  }

  // 4e. Муксун (muksun), Нельма (nelma), Ряпушка сибирская (cisco), Арктический омуль (omul_arctic), Сайка (saffron_cod), Навага (navaga)
  if (fid === 'muksun') {
    if (lat < 60.2) return false;
    if (waterType !== 'big_river' && waterType !== 'sea_gulf' && !hasBigRiverInRadius) return false;
  }
  if (fid === 'nelma') {
    if (bCode === 'arctic_ob_taz' && lat < 57.5) return false;
    if (bCode === 'barents_white' && (lat < 61.0 || lon < 40.0)) return false;
    if (waterType !== 'big_river' && waterType !== 'sea_gulf' && !hasBigRiverInRadius) return false;
  }
  if (fid === 'cisco') {
    if (lat < 61.2) return false;
    if (bCode === 'barents_white' && lon < 47.0) return false;
  }
  if (fid === 'omul_arctic') {
    if (lat < 65.5) return false;
    if (!hasSeaInRadius && waterType !== 'big_river') return false;
  }
  if (fid === 'saffron_cod') {
    if (lat < 66.5 || !hasSeaInRadius) return false;
  }
  if (fid === 'navaga') {
    if (bCode === 'arctic_ob_taz' && (lat < 66.2 || !hasSeaInRadius)) return false;
    if (bCode === 'barents_white' && !hasSeaInRadius) return false;
  }

  // 4f. Тугун / Манерка (tugun) и Валёк (valek)
  if (fid === 'tugun') {
    if (bCode === 'arctic_ob_taz') {
      const isSosvaUral = lat >= 59.0 && lon <= 66.5;
      if (lat < 60.0 && !isSosvaUral) return false;
    } else if (bCode === 'yenisei_lena') {
      if (lat < 55.0) return false;
    } else {
      return false;
    }
  }
  if (fid === 'valek') {
    if (bCode === 'arctic_ob_taz') {
      if (lat < 65.5 || lon > 68.5) return false; // Только горные реки Полярного Урала
    } else if (bCode === 'yenisei_lena') {
      if (lat < 56.0 || lon < 88.0) return false;
    } else if (bCode === 'pacific_sea') {
      if (lat < 58.0) return false;
    } else {
      return false;
    }
  }

  // 4g. Европейская ряпушка / Рипус (vendace), Сиг проходной / озёрный (whitefish), Сиг-лудога / Валаамка (broad_whitefish)
  if (fid === 'broad_whitefish') {
    // Эндемик Ладоги и Онеги (nw_karelia и восток baltic)
    if (bCode !== 'nw_karelia' && !(bCode === 'baltic' && lat >= 59.5 && lon >= 28.0)) return false;
    if (waterType !== 'quarry' && waterType !== 'sea_gulf' && waterType !== 'big_river' && !hasDeepQuarryInRadius) return false;
  }
  if (fid === 'vendace' || fid === 'whitefish') {
    if (bCode === 'arctic_ob_taz') {
      // На Урале (Челябинская и Свердловская области — Увильды, Тургояк, Таватуй, Синара, Иткуль, Аракуль) рипус и озёрный сиг живут ТОЛЬКО в глубоких озёрах Урала (lon 59.5..62.0, lat 54.5..57.8)
      const isUralDeepLakeZone = lat >= 54.5 && lat <= 57.8 && lon >= 59.5 && lon <= 62.0;
      const isPolarUral = fid === 'whitefish' && lat >= 65.5 && lon <= 68.5;
      if (!isPolarUral) {
        if (!isUralDeepLakeZone) return false;
        if (waterType !== 'quarry' && !(radiusKm >= 120 && hasDeepQuarryInRadius)) return false;
      }
    } else if (bCode === 'volga_caspian') {
      // В Волжском бассейне — только глубокие озёра Верхней Волги (Плещеево, Селигер, Белое) или Южного Урала (Банное, Тургояк)
      const isUpperVolgaLake = lat >= 56.5 && lon <= 40.5;
      const isSouthUralLake = lat >= 53.2 && lat <= 56.0 && lon >= 58.0 && lon <= 61.5;
      if (!isUpperVolgaLake && !isSouthUralLake) return false;
      if (waterType !== 'quarry' && !(radiusKm >= 120 && hasDeepQuarryInRadius)) return false;
    }
  }

  // 5. ХАРИУС, ТАЙМЕНЬ, ЛЕНОК, РУЧЬЕВАЯ ФОРЕЛЬ (привязка к горным, предгорным и таёжным рекам)
  if (fid === 'grayling' || fid === 'taimen') {
    // В стоячих мелких степных прудах и старицах южнее 62°N хариус и таймень не живут
    if (waterType === 'tundra_lake' && lat < 62.0) return false;
    if (bCode === 'arctic_ob_taz') {
      const isUralSlope = lon <= 61.35 || (lat >= 59.0 && lon <= 66.0);
      const isNorthTaiga = lat >= 61.2;
      const isAltaiTom = lon >= 82.5;
      // Исключаем равнинные лесостепные реки Курганской, Тюменской, Омской и Барабинской областей!
      if (!isUralSlope && !isNorthTaiga && !isAltaiTom) return false;
    } else if (bCode === 'volga_caspian') {
      const isKamaBashkirUral = lon >= 55.2 && lat >= 52.5;
      const isUpperVolgaStream = fid === 'grayling' && lat >= 56.5 && lon <= 37.5 && waterType === 'small_river';
      if (!isKamaBashkirUral && !isUpperVolgaStream) return false;
    }
  }
  if (fid === 'lenok') {
    if (lon < 83.5) return false; // Только Алтай, Саяны, Енисей, Байкал, Лена, Амур, ДВ
  }
  if (fid === 'brown_trout') {
    if (bCode === 'volga_caspian') {
      const isBashkirUralStream = lon >= 56.0 && lon <= 60.0 && lat >= 52.8 && lat <= 56.5;
      const isCaucasusTerek = lat <= 44.5;
      if (!isBashkirUralStream && !isCaucasusTerek) return false;
    } else if (bCode === 'black_azov') {
      if (lat > 45.2 && lon > 38.0) return false; // Только горные и предгорные реки Кавказа и Крыма
    }
  }

  // 6. ОСЕТРОВЫЕ (Стерлядь, Сибирский осётр, Русский осётр, Белуга, Севрюга)
  if (fid === 'sterlet') {
    if (waterType !== 'big_river' && !(radiusKm >= 120 && hasBigRiverInRadius)) return false;
    if (bCode === 'arctic_ob_taz' && lat >= 66.8) return false;
    if (bCode === 'yenisei_lena' && lon >= 98.0) return false; // В бассейне Лены стерляди нет
    if (bCode === 'barents_white' && (lon < 39.0 || lon > 52.0)) return false; // Только Сев. Двина и Вычегда
  }
  if (fid === 'siberian_sturgeon') {
    if (waterType !== 'big_river' && waterType !== 'sea_gulf' && bCode !== 'baikal' && !(radiusKm >= 120 && hasBigRiverInRadius)) return false;
  }

  // 7. ЮЖНЫЕ, ЕВРОПЕЙСКИЕ И КАСПИЙСКИЕ ВИДЫ (отсечение на Севере и в Сибири)
  if (['vobla', 'kutum', 'white_salmon'].includes(fid)) {
    // Каспийская вобла, кутум и белорыбица — только Нижняя Волга (Астрахань/Волгоград), низовья Урала и Каспий!
    if (lat > 49.0 || lon < 43.5) return false;
  }
  if (['beluga', 'stellate_sturgeon', 'shemaya'].includes(fid)) {
    if (bCode === 'volga_caspian' && lat > 51.0) return false;
  }
  if (fid === 'russian_sturgeon') {
    if (waterType !== 'big_river' && waterType !== 'sea_gulf' && !(radiusKm >= 120 && hasBigRiverInRadius)) return false;
  }
  if (fid === 'barbel') {
    if (lat > 53.5) return false;
  }

  // Судак (zander)
  if (fid === 'zander') {
    if (bCode === 'arctic_ob_taz') {
      if (lat > 62.5) return false; // В ЯНАО судака нет
      // В малых степных речках судак присутствует, только если выбрано вдхр/большая река или в радиусе 120 км есть большая река/глубокое озеро
      if (waterType === 'small_river' && radiusKm < 120 && !hasBigRiverInRadius && !hasDeepQuarryInRadius) return false;
    } else if (bCode === 'yenisei_lena') {
      if (lat > 56.5 || lon > 94.0) return false; // Только Красноярское вдхр. / Абакан
    }
  }

  // Лещ (bream)
  if (fid === 'bream') {
    if (bCode === 'arctic_ob_taz') {
      if (lat > 63.0 && !(waterType === 'big_river' && lon <= 70.0)) return false; // Нет в реках и озёрах Пура/Таза/Надыма
    } else if (bCode === 'yenisei_lena') {
      if (lat > 59.0 || lon > 104.5) return false; // Только Енисей и Ангарские вдхр, нет в Якутии и на Таймыре
    }
  }

  // Карп / Сазан (carp) и Линь (tench)
  if (fid === 'carp' || fid === 'tench') {
    if (bCode === 'arctic_ob_taz' || bCode === 'yenisei_lena') {
      if (lat > 59.2 && waterType !== 'cooling_reservoir' && !hasCoolingInRadius) return false;
    }
    if (bCode === 'nw_karelia' && lat > 62.2) return false;
  }

  // Густера (white_bream), Краснопёрка (rudd), Уклейка (bleak)
  if (['white_bream', 'rudd', 'bleak'].includes(fid)) {
    if (bCode === 'arctic_ob_taz') {
      if (lat > 58.6 || lon > 84.5) return false; // Обитают на Урале, в Зауралье (Курган, Тюмень, Омск, Новосибирск), но отсутствуют в ХМАО и ЯНАО
    }
    if (bCode === 'nw_karelia' && lat > 63.0) return false;
  }

  // Голавль (chub) в пограничной зоне Урала
  if (fid === 'chub') {
    if (bCode === 'arctic_ob_taz') {
      // Голавль водится только в реках восточного предгорья Среднего и Южного Урала (Екатеринбург, Челябинск, Миасс, Сысерть, Исеть до Шадринска — lon <= 62.2, lat <= 58.2)
      if (lon > 62.2 || lat > 58.2) return false;
    }
    if (bCode === 'nw_karelia' && lat > 62.2) return false;
  }

  // 8. Быстрые горные реки Черноморского побережья Кавказа (Мзымта, Сочи, Шахе, Хоста, Псоу)
  const isCaucasianStream = bCode === 'black_azov' && lat <= 44.65 && lat >= 43.3 && lon >= 38.4 && lon <= 40.5 && (waterType === 'small_river' || /мзымта|сочи|шахе|хоста|псоу/i.test(wNameLower));
  if (isCaucasianStream && ['pike', 'perch', 'zander', 'bream', 'carp', 'crucian', 'catfish', 'asp', 'tench', 'rudd', 'white_bream', 'silver_carp', 'grass_carp'].includes(fid)) {
    return false;
  }

  return true;
}


function normStr(s) {
  return String(s || '').toLowerCase().replace(/ё/g, 'е').trim();
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

function detectBasinByCoords(lat, lon) {
  if (lat >= 41.0 && lat <= 47.8 && lon >= 32.5 && lon <= 41.5) return 'black_azov';
  if (lat >= 54.0 && lat <= 60.5 && lon >= 19.0 && lon <= 31.0) return 'baltic';
  if (lat >= 65.0 && lon >= 30.5 && lon <= 55.0) return 'barents_white';
  if (lat >= 60.5 && lat < 66.5 && lon >= 29.0 && lon <= 38.0) return 'nw_karelia';
  if (lon >= 130.0 && lat >= 42.0) return 'pacific_sea';
  if (lon >= 118.0 && lon < 141.0 && lat >= 47.0 && lat < 55.5) return 'amur';
  if (lat >= 51.0 && lat <= 56.5 && lon >= 103.0 && lon <= 112.0) return 'baikal';
  if ((lon >= 88.0 || (lon >= 85.5 && lat >= 65.5)) && lon < 135.0 && lat >= 51.0) return 'yenisei_lena';
  if (lat >= 54.5 && lon >= 60.0 && lon < 88.0) return 'arctic_ob_taz';
  if (lon < 37.0 && lat < 56.0) return 'euro_west';
  return 'volga_caspian';
}

function isCoastalInBasin(basinCode, lat, lon) {
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

function findNearestSettlement(lat, lon) {
  let best = BOT_CITIES_DB[0];
  let bestDist = Infinity;
  for (const c of BOT_CITIES_DB) {
    const d = haversineKm(lat, lon, c.lat, c.lon);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return { ...best, distKm: bestDist };
}

function findNearestWatersForSpot(lat, lon, basinCode, isCoastal, maxCount = 5) {
  const scored = BOT_WATERS_DB.map(w => {
    const d = haversineKm(lat, lon, w.lat, w.lon);
    let pen = 0;
    if (w.basin !== basinCode) pen += 18;
    const isLocalSea = (w.wType === 'sea_gulf' || w.wType === 'open_sea') && d <= 55;
    if (!isCoastal && !isLocalSea && (w.wType === 'sea_gulf' || w.wType === 'open_sea')) pen += 2000;
    return { ...w, distKm: d, score: d + pen };
  }).sort((a, b) => a.score - b.score);
  const seen = new Set();
  const uniq = [];
  for (const w of scored) {
    if (w.distKm > 120) continue;
    const k = normStr(w.cleanName);
    if (!seen.has(k)) {
      seen.add(k);
      uniq.push(w);
      if (uniq.length >= maxCount) break;
    }
  }
  return uniq;
}

/**
 * Возвращает полный ранжированный список рыб для населённого пункта и водоёма (100% синхронно с приложением)
 */
function getSpotSpeciesList(lat, lon, basinCode, wType, isCoastal, curMonthIdx = 9, nearWaters = [], waterName = '') {
  const effWType = wType || 'small_river';
  const radiusWaterTypes = new Set((nearWaters || []).map(w => w.wType).concat([effWType]));
  const hasCoolingInRadius = effWType === 'cooling_reservoir' || radiusWaterTypes.has('cooling_reservoir');
  const isLocalCoastal = Boolean(isCoastal || effWType.startsWith('sea') || radiusWaterTypes.has('sea_gulf') || radiusWaterTypes.has('open_sea'));
  const ecoregion = getSpotEcoregion(lat, lon, basinCode, effWType, waterName);
  const sigOrder = ecoregion.signatureSpecies || REGIONAL_SIGNATURE_SPECIES[basinCode] || [];

  const list = BOT_FISH_CATALOG.filter(f => {
    if (f.legal === 'redbook') return false;
    return isSpeciesInGeoRange(f, lat, lon, basinCode, effWType, 60, radiusWaterTypes, isLocalCoastal, hasCoolingInRadius, waterName);
  });

  list.sort((a, b) => {
    const aSig = sigOrder.indexOf(a.id);
    const bSig = sigOrder.indexOf(b.id);
    const aBonus = aSig >= 0 ? Math.max(8, 34 - aSig * 2) : -8;
    const bBonus = bSig >= 0 ? Math.max(8, 34 - bSig * 2) : -8;
    const aDirect = (Array.isArray(a.waters) && a.waters.includes(effWType)) ? 10 : -6;
    const bDirect = (Array.isArray(b.waters) && b.waters.includes(effWType)) ? 10 : -6;
    const aLic = a.legal === 'license' ? -6 : 0;
    const bLic = b.legal === 'license' ? -6 : 0;
    const aAct = (a.monthActivity && a.monthActivity[curMonthIdx]) ?? 2;
    const bAct = (b.monthActivity && b.monthActivity[curMonthIdx]) ?? 2;
    return (bBonus + bDirect + bLic + bAct * 5) - (aBonus + aDirect + aLic + aAct * 5);
  });

  return list.length > 0 ? list : BOT_FISH_CATALOG.slice(0, 10);
}

function buildSpotContext(lat, lon, customName = '', forcedWaterObj = null, forcedWaterType = '') {
  const nearCity = findNearestSettlement(lat, lon);
  const basinCode = forcedWaterObj?.basin || detectBasinByCoords(lat, lon);
  const isCoastal = isCoastalInBasin(basinCode, lat, lon);
  const nearWaters = findNearestWatersForSpot(lat, lon, basinCode, isCoastal, 5);
  const primaryWater = forcedWaterObj || nearWaters[0] || null;
  let wType = forcedWaterType || primaryWater?.wType || (isCoastal ? 'sea_gulf' : 'small_river');
  const activeWaterName = forcedWaterObj ? forcedWaterObj.cleanName : (nearWaters[0]?.cleanName || '');
  const ecoregion = getSpotEcoregion(lat, lon, basinCode, wType, activeWaterName);

  let waterSummary = '';
  if (forcedWaterObj) {
    waterSummary = `${forcedWaterObj.name} [${forcedWaterObj.typeTag || WATER_TYPE_LABELS[wType] || 'Водоём'}]`;
  } else if (forcedWaterType) {
    const matchingW = nearWaters.find(w => w.wType === forcedWaterType);
    waterSummary = matchingW
      ? `${matchingW.name} [${WATER_TYPE_LABELS[forcedWaterType]}]`
      : (WATER_TYPE_LABELS[forcedWaterType] || 'Водоём');
  } else if (nearWaters.length > 0) {
    waterSummary = nearWaters.slice(0, 3).map(w => w.name).join(' / ');
  } else {
    waterSummary = WATER_TYPE_LABELS[wType] || 'Река / озеро';
  }

  const displayName = customName || (forcedWaterObj ? `${forcedWaterObj.cleanName} (${forcedWaterObj.region})` : nearCity.name);
  const admin1 = nearCity.distKm <= 80 ? nearCity.admin1 : '';
  const curMonthIdx = new Date().getMonth();
  const speciesList = getSpotSpeciesList(lat, lon, basinCode, wType, isCoastal, curMonthIdx, nearWaters, activeWaterName);

  return {
    name: displayName,
    admin1,
    lat,
    lon,
    basinCode,
    basin: ecoregion.displayBasinName || BASIN_NAMES[basinCode] || 'Водный бассейн РФ',
    isCoastal,
    wType,
    waterName: activeWaterName,
    water: waterSummary,
    nearWaters,
    speciesList,
    topFish: speciesList.slice(0, 12).map(f => f.name)
  };
}

function decodeKplocToken(rawParam = '') {
  const str = String(rawParam || '').trim();
  if (!str.startsWith('KPLOC_')) return null;
  const parts = str.split('_');
  if (parts.length < 3) return null;
  const parseCoord = (p) => {
    if (!p) return NaN;
    const neg = p.startsWith('M') || p.startsWith('-');
    const clean = p.replace(/^[M-]/, '');
    const num = parseFloat(clean);
    if (!Number.isFinite(num)) return NaN;
    const val = (!clean.includes('.') && num > 180) ? (num / 10000) : num;
    return neg ? -val : val;
  };
  const lat = parseCoord(parts[1]);
  const lon = parseCoord(parts[2]);
  const fishId = parts.slice(3).join('_') || '';
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon, fishId };
}

/**
 * Распознаёт указанный пользователем тип водоёма в тексте запроса («озеро», «река», «карьер», «вдхр», «море», «грэс», «старица»)
 */
function detectWaterTypeFromQuery(q) {
  const s = ' ' + q + ' ';
  if (/[^а-яa-z0-9](грэс|тэц|аэс|теплый канал|теплый сброс)[^а-яa-z0-9]/i.test(s)) return 'cooling_reservoir';
  if (/[^а-яa-z0-9](море|морск[а-я]*|бухт[а-я]*|лиман[а-я]*|губ[аые]|залив[а-я]*)[^а-яa-z0-9]/i.test(s)) return 'sea_gulf';
  if (/[^а-яa-z0-9](вдхр|водохранилищ[а-я]*|карьер[а-я]*)[^а-яa-z0-9]/i.test(s)) return 'quarry';
  if (/[^а-яa-z0-9](стариц[а-я]*|пруд[а-я]*|болот[а-я]*|сор)[^а-яa-z0-9]/i.test(s)) return 'tundra_lake';
  if (/[^а-яa-z0-9](озер[а-я]*|оз)[^а-яa-z0-9]/i.test(s)) return 'tundra_lake';
  if (/[^а-яa-z0-9](рек[аиеу]|речк[а-я]*|р\.|проток[а-я]*|руче[йя])[^а-яa-z0-9]/i.test(s)) return 'small_river';
  return '';
}

/**
 * Ищет конкретный водоём по названию из базы BOT_WATERS_DB (с поддержкой склонений, например «озеро негито», «на рыбинке», «река пур», «аслыкуль»)
 */
function findWaterInQuery(q) {
  let bestWater = null;
  let bestScore = 0;

  for (const w of BOT_WATERS_DB) {
    const fullNorm = normStr(w.name).replace(/^(р\.|оз\.|вдхр\.)\s*/i, '').trim();
    const clean = normStr(w.cleanName).replace(/^(озеро|река|вдхр|море|оз\.|р\.)\s+/i, '').trim();
    const baseWord = clean.split(/[\s(]/)[0];
    const candidates = [fullNorm, clean];
    if (baseWord && baseWord.length >= 3) {
      candidates.push(baseWord);
      if (baseWord.length >= 5) candidates.push(baseWord.slice(0, -1));
      if (baseWord.length >= 7 && (baseWord.endsWith('ское') || baseWord.endsWith('цкое'))) {
        candidates.push(baseWord.slice(0, -2));
      }
    }
    for (const cand of candidates) {
      if (cand.length >= 3 && q.includes(cand)) {
        const idx = q.indexOf(cand);
        const prevChar = idx > 0 ? q[idx - 1] : ' ';
        if (!/[а-яa-z0-9]/i.test(prevChar)) {
          let sc = cand.length * 10;
          if (cand === fullNorm || cand === clean) sc += 25;
          if (sc > bestScore) {
            bestScore = sc;
            bestWater = w;
          }
        }
      }
    }
  }
  return bestWater;
}

/**
 * Ищет населённый пункт в BOT_CITIES_DB с учётом области/республики (например, «Мишкино Башкортостан» vs «Мишкино Курганская»)
 */
function findSettlementInQuery(q) {
  const matches = [];
  for (const c of BOT_CITIES_DB) {
    const cn = normStr(c.name);
    const baseName = cn.split('(')[0].trim();
    if (baseName.length < 2) continue;
    const stem = baseName.length >= 5 ? baseName.slice(0, -1) : baseName;
    const idx = q.indexOf(stem);
    if (idx !== -1) {
      const prevChar = idx > 0 ? q[idx - 1] : ' ';
      if (!/[а-яa-z0-9]/i.test(prevChar)) {
        let score = baseName.length * 10;
        if (q.includes(baseName)) score += 15;
        const adminNorm = normStr(c.admin1);
        const adminWords = adminNorm.replace(/область|обл\.|республика|край|ао/g, '').trim().split(/\s+/).filter(w => w.length >= 4);
        for (const aw of adminWords) {
          const awStem = aw.slice(0, Math.max(4, aw.length - 2));
          if (q.includes(awStem)) score += 120;
        }
        if ((q.includes('башкир') || q.includes('башкорт') || q.includes('уфа')) && adminNorm.includes('башкортостан')) score += 150;
        if ((q.includes('курган') || q.includes('заурал')) && adminNorm.includes('курган')) score += 150;
        if ((q.includes('ямал') || q.includes('янао')) && adminNorm.includes('ямало')) score += 150;
        if ((q.includes('хмао') || q.includes('югр')) && adminNorm.includes('ханты')) score += 150;
        if ((q.includes('татар')) && adminNorm.includes('татарстан')) score += 150;
        matches.push({ city: c, score });
      }
    }
  }
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.score - a.score);
  return matches[0].city;
}

/**
 * Онлайн-геокодер для редких малых деревень, посёлков, СНТ, рек и озёр РФ
 */
async function geocodePlaceOnline(placeQuery) {
  const clean = String(placeQuery || '').trim();
  if (clean.length < 2) return null;

  try {
    const nomUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(clean + ' Россия')}&format=json&addressdetails=1&limit=3&accept-language=ru`;
    const res = await fetch(nomUrl, { headers: { 'User-Agent': 'KlevProClubBot/2.0.166 (https://klevpro.ru)' } });
    if (res.ok) {
      const arr = await res.json();
      if (Array.isArray(arr) && arr.length > 0) {
        const hit = arr[0];
        const lat = parseFloat(hit.lat);
        const lon = parseFloat(hit.lon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          const shortTitle = String(hit.name || hit.display_name || clean).split(',')[0].trim();
          const isWaterHit = hit.class === 'natural' || hit.class === 'waterway' || /озеро|река|вдхр|водохранилище|пруд|лиман|губа|залив/i.test(shortTitle);
          const wType = isWaterHit ? (hit.class === 'waterway' ? 'small_river' : 'quarry') : '';
          return buildSpotContext(lat, lon, shortTitle, null, wType);
        }
      }
    }
  } catch (e) {}

  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(clean)}&count=5&language=ru&format=json`;
    const res = await fetch(url, { headers: { 'User-Agent': 'KlevProClubBot/2.0.166 (https://klevpro.ru)' } });
    if (res.ok) {
      const data = await res.json();
      const results = Array.isArray(data?.results) ? data.results : [];
      const hit = results.find(r => r.country_code === 'RU') || results[0];
      if (hit && Number.isFinite(hit.latitude) && Number.isFinite(hit.longitude)) {
        const title = hit.admin1 ? `${hit.name} (${hit.admin1})` : hit.name;
        return buildSpotContext(hit.latitude, hit.longitude, title);
      }
    }
  } catch (e) {}

  return null;
}

/**
 * Умный разбор любого запроса рыболова:
 * - «Сочи барабуля» / «Сочи барабулька»
 * - «Озеро Негито» / «Негито пелядь»
 * - «Мишкино Башкортостан чехонь»
 * - «Мишкино озеро карась»
 * - «Коротчаево налим» / «Пангоды хариус»
 */
// ============================================================================
// СЕССИИ ПОЛЬЗОВАТЕЛЕЙ И ПОСТОЯННАЯ ТЕКСТОВАЯ ПАНЕЛЬ (Ревизия 2.0.168)
// ============================================================================
const userSessions = new Map();

function getUserSession(userId) {
  const key = String(userId || 'anon');
  if (!userSessions.has(key)) {
    userSessions.set(key, {
      lat: 66.0833,
      lon: 76.6800,
      cityName: 'Новый Уренгой',
      wType: '',
      waterName: '',
      fishId: 'pike',
      radiusKm: 50,
      keyboardSent: false
    });
  }
  return userSessions.get(key);
}

function saveUserSession(userId, patch = {}) {
  const cur = getUserSession(userId);
  const next = { ...cur, ...patch };
  userSessions.set(String(userId || 'anon'), next);
  return next;
}

/**
 * Постоянная нижняя текстовая панель кнопок (ReplyKeyboardMarkup — как на Фото 2):
 * Ряд 1: [ 🌟 Рекомендации ]
 * Ряд 2: [ ⚡ ] [ 🔍 ] [ 👤 ] [ ❓ ]
 */
const BOT_REPLY_KEYBOARD = {
  keyboard: [
    [{ text: '🌟 Рекомендации' }],
    [{ text: '⚡' }, { text: '🔍' }, { text: '👤' }, { text: '❓' }]
  ],
  resize_keyboard: true,
  is_persistent: true,
  input_field_placeholder: 'Город, водоём или рыба (напр. Ярославль судак)...'
};

const BOT_COMMANDS_LIST = [
  { command: 'start', description: '🧭 Запуск и панель быстрых кнопок' },
  { command: 'klev', description: '🎣 Прогноз клёва (напр. /klev Ярославль судак)' },
  { command: 'top', description: '🌟 Рекомендации и ТОП-5 клёва сегодня' },
  { command: 'waters', description: '🌊 Водоёмы рядом (радиус 50 и 120 км)' },
  { command: 'fish', description: '🐟 Полный список рыб в локации' },
  { command: 'crew', description: '⚡ Экспресс-радар на 72 часа (3 дня)' },
  { command: 'profile', description: '👤 Мой профиль и домашняя точка' },
  { command: 'help', description: '❓ Справка и работа в группах/каналах' }
];

async function tgApi(botToken, method, payload) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (e) {
    return { ok: false, description: String(e) };
  }
}

/**
 * Переключает левую синюю кнопку на стандартное меню команд [ ☰ ] (убирает вызов Mini App с основной кнопки)
 */
async function configureBotMenusAndCommands(botToken, chatId = null) {
  const tasks = [
    tgApi(botToken, 'setChatMenuButton', {
      menu_button: { type: 'commands' }
    }),
    tgApi(botToken, 'setMyCommands', {
      commands: BOT_COMMANDS_LIST
    }),
    tgApi(botToken, 'setMyCommands', {
      commands: BOT_COMMANDS_LIST,
      scope: { type: 'all_private_chats' }
    }),
    tgApi(botToken, 'setMyCommands', {
      commands: [
        { command: 'klev', description: '🎣 Прогноз клёва (напр. /klev Астрахань сазан)' },
        { command: 'top', description: '🌟 ТОП-5 активных рыб в локации' },
        { command: 'waters', description: '🌊 Ближайшие водоёмы (50 / 120 км)' },
        { command: 'fish', description: '🐟 Видовой состав рыб в точке' },
        { command: 'help', description: '❓ Как пользоваться ботом в группе' }
      ],
      scope: { type: 'all_group_chats' }
    })
  ];
  if (chatId) {
    tasks.push(
      tgApi(botToken, 'setChatMenuButton', {
        chat_id: chatId,
        menu_button: { type: 'commands' }
      })
    );
  }
  await Promise.allSettled(tasks);
}

/**
 * Умный разбор любого запроса рыболова с учётом сохранённой локации пользователя:
 * - «Сочи барабуля» / «Сочи барабулька»
 * - «Озеро Негито» / «Негито пелядь»
 * - «Мишкино Башкортостан чехонь» / «Мишкино Курганская карась»
 * - просто «судак» или «карась» (берёт текущую точку пользователя из сессии!)
 */
async function resolveQueryCityAndFish(rawQuery, session = null) {
  const q = normStr(rawQuery)
    .replace(/^\/(klev|top|waters|fish|crew|circle|express|search|profile|help|start)(@\S+)?\s*/i, '')
    .replace(/^(!клев|клев|прогноз|рыбалка)\s+/i, '')
    .trim();

  // 1. Ищем целевую рыбу по всем 115 видам и их синонимам (выбираем самое длинное точное совпадение)
  let matchedFish = null;
  let matchedKeyword = '';
  for (const f of BOT_FISH_CATALOG) {
    for (const kw of f.keywords) {
      if (q.includes(kw)) {
        const idx = q.indexOf(kw);
        const prevChar = idx > 0 ? q[idx - 1] : ' ';
        if (!/[а-яa-z0-9]/i.test(prevChar) && kw.length > matchedKeyword.length) {
          matchedFish = f;
          matchedKeyword = kw;
        }
      }
    }
  }

  // 2. Определяем, указал ли пользователь тип водоёма («озеро», «река», «карьер», «вдхр», «море», «грэс»)
  const explicitWaterType = detectWaterTypeFromQuery(q);

  // 3. Очищаем запрос от найденной рыбы для поиска локации/водоёма
  let placeQuery = q;
  if (matchedKeyword) {
    placeQuery = placeQuery.replace(new RegExp(`[а-яa-z0-9_-]*${matchedKeyword}[а-яa-z0-9_-]*`, 'gi'), ' ');
  }

  // 4. Проверяем, есть ли в запросе конкретный именованный водоём из базы (491 водоём РФ)
  const matchedWaterObj = findWaterInQuery(placeQuery);

  // 5. Проверяем населённый пункт из базы 609 городов и сёл РФ
  const matchedSettlement = findSettlementInQuery(placeQuery);

  let spot = null;

  if (matchedWaterObj && (!matchedSettlement || explicitWaterType || q.includes(normStr(matchedWaterObj.cleanName)))) {
    spot = buildSpotContext(matchedWaterObj.lat, matchedWaterObj.lon, '', matchedWaterObj, matchedWaterObj.wType);
  } else if (matchedSettlement) {
    spot = buildSpotContext(matchedSettlement.lat, matchedSettlement.lon, matchedSettlement.name, matchedWaterObj, explicitWaterType);
  } else if (matchedWaterObj) {
    spot = buildSpotContext(matchedWaterObj.lat, matchedWaterObj.lon, '', matchedWaterObj, matchedWaterObj.wType);
  } else {
    const cleanOnlineCandidate = placeQuery
      .replace(/(?:^|\s)(в|во|на|под|около|рядом|у|клев|прогноз|рыбалка|рыба|рыбы|ловля|клюет|список|какая|какие|водится|город|г|поселок|пгт|село|с|деревня|д|река|речка|р|озеро|оз|вдхр|водохранилище|карьер|пруд|старица|море|залив|губа|лиман)(?=\s|$)/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (cleanOnlineCandidate.length >= 2) {
      const onlineSpot = await geocodePlaceOnline(cleanOnlineCandidate);
      if (onlineSpot) {
        if (explicitWaterType) {
          spot = buildSpotContext(onlineSpot.lat, onlineSpot.lon, onlineSpot.name, null, explicitWaterType);
        } else {
          spot = onlineSpot;
        }
      }
    }
  }

  if (!spot) {
    if (matchedFish && matchedFish.basins.length === 1 && matchedFish.basins[0] === 'black_azov') {
      spot = buildSpotContext(43.5855, 39.7231, 'Сочи', null, 'sea_gulf');
    } else if (session && Number.isFinite(session.lat) && Number.isFinite(session.lon)) {
      const savedWaterObj = session.waterName
        ? BOT_WATERS_DB.find(w => normStr(w.cleanName) === normStr(session.waterName))
        : null;
      spot = buildSpotContext(session.lat, session.lon, session.cityName || '', savedWaterObj, explicitWaterType || session.wType || '');
    } else {
      spot = buildSpotContext(66.0833, 76.6800, 'Новый Уренгой', null, explicitWaterType);
    }
  }

  // Если пользователь явно запросил морскую рыбу в приморском городе (например, «Сочи барабулька»), переключаем водоём на морскую акваторию
  if (matchedFish && matchedFish.habitat === 'sea' && spot.isCoastal && spot.wType !== 'sea_gulf' && spot.wType !== 'open_sea') {
    spot = buildSpotContext(spot.lat, spot.lon, spot.name, null, 'sea_gulf');
  }

  const chosenFish = matchedFish ||
    (session?.fishId && spot.speciesList.find(f => f.id === session.fishId)) ||
    spot.speciesList[0] ||
    BOT_FISH_CATALOG[0];

  return { city: spot, fish: chosenFish, isExplicitFish: Boolean(matchedFish) };
}

async function fetchLiveSpotWeather(lat, lon) {
  try {
    const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'KlevProClubBot/2.0.168 (https://klevpro.ru)' }
    });
    if (res.ok) {
      const data = await res.json();
      const series = data?.properties?.timeseries || [];
      const first = series[0]?.data?.instant?.details;
      const d24 = series[Math.min(24, series.length - 1)]?.data?.instant?.details || first;
      const d48 = series[Math.min(48, series.length - 1)]?.data?.instant?.details || d24;
      const elev = data?.geometry?.coordinates?.[2] || 60;
      if (first) {
        const tAir = Math.round((first.air_temperature ?? 5) * 10) / 10;
        const pMm = Math.round((first.air_pressure_at_sea_level || 1013) * 0.750062 - elev / 11.5);
        const wind = Math.round((first.wind_speed ?? 3) * 10) / 10;
        const waterTemp = Math.max(0.4, Math.min(24, Math.round((tAir * 0.52 + 2.4) * 10) / 10));
        const iceText = tAir <= -6 && waterTemp <= 0.8
          ? '❄️ Устойчивый ледостав'
          : (tAir <= 2.5 && tAir >= -3.5 ? '🌊❄️ Шуга и забереги (сплошного льда нет)' : '🌊 Открытая вода');

        const tAir24 = Math.round((d24?.air_temperature ?? tAir) * 10) / 10;
        const pMm24 = Math.round(((d24?.air_pressure_at_sea_level || 1013) * 0.750062) - elev / 11.5);
        const wind24 = Math.round((d24?.wind_speed ?? wind) * 10) / 10;

        const tAir48 = Math.round((d48?.air_temperature ?? tAir24) * 10) / 10;
        const pMm48 = Math.round(((d48?.air_pressure_at_sea_level || 1013) * 0.750062) - elev / 11.5);
        const wind48 = Math.round((d48?.wind_speed ?? wind24) * 10) / 10;

        return {
          tAir, waterTemp, press: pMm, wind, iceText,
          day2: { tAir: tAir24, waterTemp: Math.max(0.4, Math.round((waterTemp * 0.8 + (tAir24 * 0.52 + 2.4) * 0.2) * 10) / 10), press: pMm24, wind: wind24 },
          day3: { tAir: tAir48, waterTemp: Math.max(0.4, Math.round((waterTemp * 0.7 + (tAir48 * 0.52 + 2.4) * 0.3) * 10) / 10), press: pMm48, wind: wind48 }
        };
      }
    }
  } catch (e) {}
  return {
    tAir: 4.0,
    waterTemp: 4.5,
    press: 756,
    wind: 3.4,
    iceText: '🌊 Открытая вода',
    day2: { tAir: 4.5, waterTemp: 4.5, press: 757, wind: 3.0 },
    day3: { tAir: 5.0, waterTemp: 4.6, press: 758, wind: 2.8 }
  };
}

function computeFishScoreForWeather(fishObj, w) {
  const wt = w.waterTemp ?? 4.5;
  const [minOpt, maxOpt] = fishObj.optT || [8, 16];
  const curMonthIdx = new Date().getMonth();
  const mAct = (fishObj.monthActivity && fishObj.monthActivity[curMonthIdx]) ?? 2;
  let score = 54 + (mAct - 2) * 8;
  if (wt < (fishObj.tMinStop ?? 0.5)) {
    score -= 26;
  } else if (wt >= minOpt && wt <= maxOpt) {
    score += 20;
  } else if (wt < minOpt) {
    score += Math.max(-22, Math.round((fishObj.coldBonus || 0) - (minOpt - wt) * 3.2));
  } else {
    score -= Math.round((wt - maxOpt) * 3);
  }
  const pDiff = Math.abs((w.press || 755) - 755);
  score += Math.round(6 - Math.min(12, pDiff * 0.7));
  if (w.wind >= 1.5 && w.wind <= 5.5) score += 5;
  else if (w.wind > 8.5) score -= 12;
  return Math.max(15, Math.min(96, score));
}

function makeAppButton(text, deepAppUrl, isPrivateChat = true) {
  // В группах, супергруппах и каналах Telegram запрещает web_app в inline_keyboard (ошибка BUTTON_TYPE_INVALID),
  // поэтому для групп/каналов автоматически ставим универсальную URL-кнопку!
  if (isPrivateChat) {
    return { text, web_app: { url: deepAppUrl } };
  }
  return { text, url: deepAppUrl };
}

function getRegionalQuickFishKeyboard(city, currentFish) {
  const pool = [...(city.speciesList || [])];
  if (currentFish && !pool.some(x => x.id === currentFish.id)) {
    pool.unshift(currentFish);
  }
  const top8 = pool.slice(0, 8);
  const shortCity = String(city.name || 'Точка').split('(')[0].trim().slice(0, 14);
  const row1 = top8.slice(0, 4).map(f => ({
    text: `${f.id === currentFish?.id ? '✅ ' : '🐟 '}${f.name.split(/[\s(/]/)[0]}`,
    callback_data: `f:${city.lat.toFixed(3)}:${city.lon.toFixed(3)}:${f.id}:${shortCity}`
  }));
  const row2 = top8.slice(4, 8).map(f => ({
    text: `${f.id === currentFish?.id ? '✅ ' : '🐟 '}${f.name.split(/[\s(/]/)[0]}`,
    callback_data: `f:${city.lat.toFixed(3)}:${city.lon.toFixed(3)}:${f.id}:${shortCity}`
  }));
  const rows = row2.length > 0 ? [row1, row2] : [row1];

  // Ряд быстрого переключения ближайших водоёмов (до 3 водоёмов вокруг точки)
  if (Array.isArray(city.nearWaters) && city.nearWaters.length > 1) {
    const waterBtns = city.nearWaters.slice(0, 3).map(nw => {
      const isCur = nw.cleanName === city.waterName;
      const shortW = nw.cleanName.replace(/^(озеро|река|вдхр\.?|оз\.|р\.)\s*/i, '').split('(')[0].trim().slice(0, 12);
      return {
        text: `${isCur ? '🌊✓ ' : '🌊 '}${shortW}`,
        callback_data: `w:${nw.lat.toFixed(3)}:${nw.lon.toFixed(3)}:${currentFish?.id || 'pike'}:${shortW}`
      };
    });
    rows.push(waterBtns);
  }

  // Ряд быстрых действий под карточкой: ТОП-5 клёва и Экипаж 72ч
  rows.push([
    { text: '🌟 ТОП-5 клёва здесь', callback_data: `top:${city.lat.toFixed(3)}:${city.lon.toFixed(3)}:${shortCity}` },
    { text: '⚡ Радар 72ч', callback_data: `exp:${city.lat.toFixed(3)}:${city.lon.toFixed(3)}:${currentFish?.id || 'pike'}:${shortCity}` }
  ]);

  return rows;
}

async function buildWorkerForecastCard(city, fish, webappUrl, isPrivateChat = true) {
  const w = await fetchLiveSpotWeather(city.lat, city.lon);
  const fishScore = computeFishScoreForWeather(fish, w);
  const verdict = fish.legal === 'redbook'
    ? '⛔ Красная книга (Поймал — отпусти)'
    : (fishScore >= 65
        ? '🟢 Отличный клёв (Стоит ехать)'
        : (fishScore >= 42 ? '🟡 Умеренный / Осторожный клёв' : '🔴 Капризный клёв (слом погоды)'));

  const waterParam = city.waterName ? `&tg_water=${encodeURIComponent(city.waterName)}` : '';
  const deepAppUrl = `${webappUrl}?tg_lat=${city.lat.toFixed(4)}&tg_lon=${city.lon.toFixed(4)}&tg_city=${encodeURIComponent(city.name)}${waterParam}&tg_fish=${fish.id}#/forecast`;

  const isNativeToBasin = fish.basins && fish.basins.includes(city.basinCode);
  const habitatWarning = !isNativeToBasin
    ? `⚠️ _Примечание: ${fish.name} не является типичным массовым видом бассейна «${city.basin}» (расчёт выполнен по физическим параметрам воды)._\n\n`
    : '';

  const allSpotFishNames = (city.speciesList || []).slice(0, 12).map(f => f.name.split(' (')[0]).join(', ');
  const nearbyWatersLine = (city.nearWaters && city.nearWaters.length > 1)
    ? `\n🌊 *Водоёмы рядом:* ${city.nearWaters.slice(0, 4).map(nw => `${nw.name} (${nw.distKm} км)`).join(', ')}`
    : '';

  const replyText =
    `🎣 *Клёв ПРО 2.0: Круг • Оперативная сводка*\n` +
    `📍 *Локация:* ${city.name}${city.admin1 && !city.name.includes(city.admin1) ? ' (' + city.admin1 + ')' : ''}\n` +
    `🌊 *Водоём / биотоп:* ${city.water} (${WATER_TYPE_LABELS[city.wType] || 'Водоём'})\n` +
    `🧭 *Бассейн:* ${city.basin}\n\n` +
    habitatWarning +
    `🐟 *Целевая рыба:* *${fish.name}* — активность *${fishScore}%*\n` +
    `📊 *Вердикт:* ${verdict}\n` +
    `⏰ *Лучшие часы выхода:* ${fish.win}\n` +
    `🎯 *Рекомендуемая снасть:* ${fish.gear}\n\n` +
    `🌡 *Воздух:* ${w.tAir > 0 ? '+' + w.tAir : w.tAir}°C • 💧 *Вода:* ~${w.waterTemp}°C\n` +
    `🧭 *Давление:* ${w.press} мм рт. ст. • 💨 *Ветер:* ${w.wind} м/с\n` +
    `🧊 *Режим водоёма:* ${w.iceText}` +
    nearbyWatersLine +
    `\n\n🐟 *Рыбы в этой локации (${(city.speciesList || []).length} видов):* ${allSpotFishNames}`;

  const fishRows = getRegionalQuickFishKeyboard(city, fish);
  const appBtnText = `🎣 Открыть навигатор: ${city.name.split('(')[0].trim()} • ${fish.name.split(' ')[0]}`;
  const replyMarkup = {
    inline_keyboard: [
      [makeAppButton(appBtnText, deepAppUrl, isPrivateChat)],
      ...fishRows
    ]
  };

  return { replyText, replyMarkup, fishScore, weather: w, deepAppUrl };
}

/**
 * Карточка «🌟 Рекомендации» (ТОП-5 рыб по текущей погоде и водоёмам вокруг точки)
 */
async function buildRecommendationsCard(city, webappUrl, isPrivateChat = true) {
  const w = await fetchLiveSpotWeather(city.lat, city.lon);
  const scored = (city.speciesList || []).map((f, idx) => {
    const rawSc = computeFishScoreForWeather(f, w);
    const rankSc = rawSc + Math.max(0, 14 - idx * 2);
    return { fish: f, score: rawSc, rankSc };
  }).sort((a, b) => b.rankSc - a.rankSc);

  const top5 = scored.slice(0, 5);
  const bestFish = top5[0]?.fish || BOT_FISH_CATALOG[0];
  const waterParam = city.waterName ? `&tg_water=${encodeURIComponent(city.waterName)}` : '';
  const deepAppUrl = `${webappUrl}?tg_lat=${city.lat.toFixed(4)}&tg_lon=${city.lon.toFixed(4)}&tg_city=${encodeURIComponent(city.name)}${waterParam}&tg_fish=${bestFish.id}#/forecast`;

  const topLines = top5.map((item, i) => {
    const icon = item.score >= 65 ? '🟢' : (item.score >= 45 ? '🟡' : '🔴');
    const shortGear = String(item.fish.gear || '').split(',')[0].split('.')[0];
    return `${i + 1}. ${icon} *${item.fish.name}* — *${item.score}%*\n   ⏰ _${item.fish.win}_ • 🎯 _${shortGear}_`;
  }).join('\n\n');

  const watersBlock = (city.nearWaters && city.nearWaters.length > 0)
    ? city.nearWaters.slice(0, 4).map(nw => `• *${nw.name}* (${nw.typeTag || WATER_TYPE_LABELS[nw.wType] || 'Водоём'}) — ${nw.distKm} км`).join('\n')
    : `• ${city.water}`;

  const text =
    `🌟 *Рекомендации ихтиолога • ТОП-5 клёва сегодня*\n` +
    `📍 *Локация:* ${city.name}${city.admin1 && !city.name.includes(city.admin1) ? ' (' + city.admin1 + ')' : ''}\n` +
    `🧭 *Субрегион:* ${city.basin}\n` +
    `🌡 *Погода в точке:* Воздух ${w.tAir > 0 ? '+' + w.tAir : w.tAir}°C • Вода ~${w.waterTemp}°C • 🧭 ${w.press} мм • 💨 ${w.wind} м/с\n` +
    `🧊 *Состояние воды:* ${w.iceText}\n\n` +
    `🏆 *На кого лучше всего идти сегодня:*\n${topLines}\n\n` +
    `🌊 *Рекомендуемые водоёмы в радиусе 50 км:*\n${watersBlock}`;

  const shortCity = String(city.name || 'Точка').split('(')[0].trim().slice(0, 14);
  const btnRow1 = top5.slice(0, 3).map(item => ({
    text: `🐟 ${item.fish.name.split(/[\s(/]/)[0]} (${item.score}%)`,
    callback_data: `f:${city.lat.toFixed(3)}:${city.lon.toFixed(3)}:${item.fish.id}:${shortCity}`
  }));
  const btnRow2 = top5.slice(3, 5).map(item => ({
    text: `🐟 ${item.fish.name.split(/[\s(/]/)[0]} (${item.score}%)`,
    callback_data: `f:${city.lat.toFixed(3)}:${city.lon.toFixed(3)}:${item.fish.id}:${shortCity}`
  }));

  const inline_keyboard = [
    [makeAppButton(`🎣 Открыть полный прогноз: ${shortCity}`, deepAppUrl, isPrivateChat)],
    btnRow1
  ];
  if (btnRow2.length > 0) inline_keyboard.push(btnRow2);

  return { text, replyMarkup: { inline_keyboard } };
}

/**
 * Карточка «⚡» — Экспресс-радар на 72 часа (Сегодня / Завтра / Послезавтра)
 */
async function buildExpress72hCard(city, fish, webappUrl, isPrivateChat = true) {
  const w = await fetchLiveSpotWeather(city.lat, city.lon);
  const sc1 = computeFishScoreForWeather(fish, w);
  const sc2 = computeFishScoreForWeather(fish, w.day2 || w);
  const sc3 = computeFishScoreForWeather(fish, w.day3 || w);
  const iconFor = sc => sc >= 65 ? '🟢 Клюёт отлично' : (sc >= 42 ? '🟡 Умеренный клёв' : '🔴 Слом погоды');
  const shortCity = String(city.name || 'Точка').split('(')[0].trim().slice(0, 14);
  const deepAppUrl = `${webappUrl}?tg_lat=${city.lat.toFixed(4)}&tg_lon=${city.lon.toFixed(4)}&tg_city=${encodeURIComponent(city.name)}&tg_fish=${fish.id}#/forecast`;

  const text =
    `⚡ *Экспресс-радар на 72 часа (Экипаж 3 дня)*\n` +
    `📍 *Точка:* ${city.name} • 🌊 *Водоём:* ${city.water}\n` +
    `🐟 *Объект лова:* *${fish.name}*\n\n` +
    `📅 *СЕГОДНЯ:* *${sc1}%* — ${iconFor(sc1)}\n` +
    `   🌡 Воздух ${w.tAir > 0 ? '+' + w.tAir : w.tAir}°C • 💧 Вода ~${w.waterTemp}°C • 🧭 ${w.press} мм • 💨 ${w.wind} м/с\n\n` +
    `📅 *ЗАВТРА:* *${sc2}%* — ${iconFor(sc2)}\n` +
    `   🌡 Воздух ${w.day2.tAir > 0 ? '+' + w.day2.tAir : w.day2.tAir}°C • 💧 Вода ~${w.day2.waterTemp}°C • 🧭 ${w.day2.press} мм • 💨 ${w.day2.wind} м/с\n\n` +
    `📅 *ПОСЛЕЗАВТРА:* *${sc3}%* — ${iconFor(sc3)}\n` +
    `   🌡 Воздух ${w.day3.tAir > 0 ? '+' + w.day3.tAir : w.day3.tAir}°C • 💧 Вода ~${w.day3.waterTemp}°C • 🧭 ${w.day3.press} мм • 💨 ${w.day3.wind} м/с\n\n` +
    `⏰ *Лучшие окна выхода:* ${fish.win}\n` +
    `🎯 *Рабочая снасть:* ${fish.gear}`;

  const inline_keyboard = [
    [makeAppButton(`🎣 Почасовой график: ${shortCity} • ${fish.name.split(' ')[0]}`, deepAppUrl, isPrivateChat)],
    [
      { text: '📊 Сводка по рыбе', callback_data: `f:${city.lat.toFixed(3)}:${city.lon.toFixed(3)}:${fish.id}:${shortCity}` },
      { text: '🌟 ТОП-5 рыб', callback_data: `top:${city.lat.toFixed(3)}:${city.lon.toFixed(3)}:${shortCity}` }
    ]
  ];

  return { text, replyMarkup: { inline_keyboard } };
}

/**
 * Карточка «🔍» — Поиск локации, водоёма (50 / 120 км) и рыбы
 */
function buildSearchDirectoryCard(city) {
  const near50 = findNearestWatersForSpot(city.lat, city.lon, city.basinCode, city.isCoastal, 8)
    .filter(w => w.distKm <= 50);
  const near120 = findNearestWatersForSpot(city.lat, city.lon, city.basinCode, city.isCoastal, 10)
    .filter(w => w.distKm > 50 && w.distKm <= 120);

  const w50Str = near50.length
    ? near50.map(w => `• *${w.name}* [${w.typeTag || 'Водоём'}] — ${w.distKm} км`).join('\n')
    : '• В радиусе 50 км выберите точку на карте или укажите название реки/озера';
  const w120Str = near120.length
    ? near120.map(w => `• *${w.name}* [${w.typeTag || 'Водоём'}] — ${w.distKm} км`).join('\n')
    : '• Все основные водоёмы находятся ближе 50 км';

  const text =
    `🔍 *Поиск локации, водоёма (50 / 120 км) и рыбы*\n` +
    `📍 *Ваша текущая точка:* *${city.name}* (${city.basin})\n\n` +
    `🌊 *Водоёмы в радиусе до 50 км:*\n${w50Str}\n\n` +
    `🔭 *Водоёмы в радиусе 50–120 км (выезд выходного дня):*\n${w120Str}\n\n` +
    `✍️ *Как найти любую точку или рыбу:*\n` +
    `Просто напишите в чат название города, посёлка, реки, озера или рыбы:\n` +
    `• \`Мишкино Курганская карась\` или \`Курган судак\`\n` +
    `• \`Мишкино Башкортостан чехонь\` или \`Уфа жерех\`\n` +
    `• \`Новый Уренгой елец\` или \`Озеро Негито пелядь\`\n` +
    `• \`Ярославль судак\`, \`Астрахань сазан\`, \`Сочи барабуля\`\n\n` +
    `👇 Или выберите один из быстрых центров ловли кнопками ниже:`;

  const inline_keyboard = [
    [
      { text: '📍 Новый Уренгой', callback_data: 'f:66.083:76.680:dace:Новый Уренгой' },
      { text: '📍 Сургут (Обь)', callback_data: 'f:61.250:73.400:pike:Сургут' }
    ],
    [
      { text: '📍 Мишкино (Курган)', callback_data: 'f:55.338:63.918:crucian:Мишкино (Кург)' },
      { text: '📍 Мишкино (Башкирия)', callback_data: 'f:55.461:55.948:zander:Мишкино (РБ)' }
    ],
    [
      { text: '📍 Москва / Ока', callback_data: 'f:55.756:37.617:zander:Москва' },
      { text: '📍 Ярославль / Волга', callback_data: 'f:57.626:39.885:zander:Ярославль' }
    ],
    [
      { text: '📍 Астрахань (Дельта)', callback_data: 'f:46.350:48.041:carp:Астрахань' },
      { text: '📍 Сочи (Чёрное море)', callback_data: 'f:43.586:39.723:red_mullet:Сочи' }
    ]
  ];

  return { text, replyMarkup: { inline_keyboard } };
}

/**
 * Карточка «👤» — Профиль рыболова в боте
 */
function buildUserProfileCard(session, city, fish, webappUrl, isPrivateChat = true) {
  const shortCity = String(city.name || 'Точка').split('(')[0].trim().slice(0, 14);
  const deepAppUrl = `${webappUrl}?tg_lat=${city.lat.toFixed(4)}&tg_lon=${city.lon.toFixed(4)}&tg_city=${encodeURIComponent(city.name)}&tg_fish=${fish.id}#/forecast`;

  const text =
    `👤 *Ваш рыболовный профиль в боте*\n\n` +
    `📍 *Закреплённая локация:* *${city.name}* (${city.lat.toFixed(3)}°N, ${city.lon.toFixed(3)}°E)\n` +
    `🧭 *Рыбохозяйственный субрегион:* ${city.basin}\n` +
    `🌊 *Активный водоём:* ${city.water} (${WATER_TYPE_LABELS[city.wType] || 'Водоём'})\n` +
    `🐟 *Текущая целевая рыба:* *${fish.name}*\n` +
    `🐟 *Всего видов в вашей локации:* ${(city.speciesList || []).length} видов\n\n` +
    `💡 *Как сменить домашнюю точку:*\n` +
    `Отправьте в чат геопозицию (скрепка 📎 ➔ *Геопозиция*) или напишите название вашего города/водоёма — бот автоматически запомнит вашу новую локацию для кнопок *«🌟 Рекомендации»* и *«⚡»*!`;

  const inline_keyboard = [
    [makeAppButton('📱 Открыть полный навигатор «Клёв ПРО 2.0»', deepAppUrl, isPrivateChat)],
    [
      { text: '🌟 ТОП-5 клёва у меня', callback_data: `top:${city.lat.toFixed(3)}:${city.lon.toFixed(3)}:${shortCity}` },
      { text: '⚡ Прогноз на 72 часа', callback_data: `exp:${city.lat.toFixed(3)}:${city.lon.toFixed(3)}:${fish.id}:${shortCity}` }
    ],
    [
      { text: '🔍 Водоёмы 50 / 120 км', callback_data: `srch:${city.lat.toFixed(3)}:${city.lon.toFixed(3)}:${shortCity}` }
    ]
  ];

  return { text, replyMarkup: { inline_keyboard } };
}

/**
 * Карточка «❓» — Подробная справка и инструкция по использованию бота в других группах и каналах
 */
function buildHelpAndGroupsCard(webappUrl, isPrivateChat = true) {
  const text =
    `❓ *Справка по боту «Клёв ПРО 2.0: Круг» (@KlevProClubBot)*\n\n` +
    `📌 *1. Кнопки нижней панели (в личном чате с ботом):*\n` +
    `• *🌟 Рекомендации* — ТОП-5 самых уловистых рыб прямо сейчас в вашей локации + список водоёмов рядом.\n` +
    `• *⚡* — Экспресс-радар клёва на 72 часа (Сегодня / Завтра / Послезавтра).\n` +
    `• *🔍* — Поиск водоёмов в радиусах *50 км* и *120 км*, быстрый выбор регионов РФ.\n` +
    `• *👤* — Ваш профиль (сохранённая точка, водоём, целевая рыба и переход в веб-навигатор).\n` +
    `• *❓* — Эта памятка.\n\n` +
    `📌 *2. Как запрашивать прогноз текстом:*\n` +
    `Напишите в любом порядке *город/посёлок*, *название реки/озера* или *рыбу*:\n` +
    `• \`Мишкино Курганская карась\`\n` +
    `• \`Озеро Негито пелядь\`\n` +
    `• \`Ярославль судак\` или просто \`щука\` (для вашей текущей точки)\n\n` +
    `👥 *3. Как использовать бота в других группах и каналах:*\n` +
    `*Способ А — В любом чате/группе без добавления бота (Инлайн-режим):*\n` +
    `Наберите в строке ввода любого чата:\n` +
    `\`@KlevProClubBot Ярославль судак\`\n` +
    `и нажмите на всплывшую карточку — прогноз сразу отправится в группу!\n\n` +
    `*Способ Б — Добавить бота в рыболовную группу:*\n` +
    `Добавьте \`@KlevProClubBot\` в участники группы. Участники смогут запрашивать прогноз командами:\n` +
    `• \`/klev Город Рыба\` (например: \`/klev Астрахань сазан\`)\n` +
    `• \`/top Город\` (ТОП-5 активных рыб в городе)\n` +
    `• \`!клев Город Рыба\` или \`@KlevProClubBot Город Рыба\`\n\n` +
    `*Способ В — В Telegram-канале:*\n` +
    `Добавьте бота администратором канала (с правом публикации) и напишите в канале пост \`/klev Город Рыба\` — бот мгновенно превратит его в карточку прогноза с кнопками!`;

  const inline_keyboard = [
    [makeAppButton('🌐 Открыть навигатор «Клёв ПРО 2.0»', webappUrl, isPrivateChat)],
    [
      { text: '➕ Добавить бота в группу', url: 'https://t.me/KlevProClubBot?startgroup=klev' },
      { text: '📢 Добавить в канал', url: 'https://t.me/KlevProClubBot?startchannel=klev' }
    ]
  ];

  return { text, replyMarkup: { inline_keyboard } };
}

export default {
  async fetch(request, env) {
    const BOT_TOKEN = env.BOT_TOKEN || '';
    const WEBHOOK_SECRET = env.WEBHOOK_SECRET || '';
    const WEBAPP_URL = (env.WEBAPP_URL || 'https://klevpro.ru/').replace(/\/?$/, '/');
    const reqUrl = new URL(request.url);

    if (request.method === 'GET' && reqUrl.searchParams.get('setup') === '1' && BOT_TOKEN) {
      const webhookTarget = `${reqUrl.origin}${reqUrl.pathname}`;
      const whRes = await tgApi(BOT_TOKEN, 'setWebhook', {
        url: webhookTarget,
        secret_token: WEBHOOK_SECRET || undefined,
        allowed_updates: ['message', 'edited_message', 'channel_post', 'callback_query', 'inline_query']
      });
      await configureBotMenusAndCommands(BOT_TOKEN);
      return new Response(JSON.stringify({
        status: 'webhook_and_commands_registered',
        version: '2.0.168',
        menuButton: 'commands (☰)',
        replyKeyboard: ['🌟 Рекомендации', '⚡ | 🔍 | 👤 | ❓'],
        speciesCount: BOT_FISH_CATALOG.length,
        watersCount: BOT_WATERS_DB.length,
        citiesCount: BOT_CITIES_DB.length,
        webhookTarget,
        telegramResponse: whRes
      }, null, 2), {
        headers: { 'Content-Type': 'application/json;charset=utf-8' }
      });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({
        status: 'ok',
        version: '2.0.168',
        speciesCount: BOT_FISH_CATALOG.length,
        watersCount: BOT_WATERS_DB.length,
        citiesCount: BOT_CITIES_DB.length,
        service: 'Klev PRO 2.0 Telegram Bot (@KlevProClubBot) Webhook',
        setupHint: 'Add ?setup=1 to this URL to automatically bind Telegram Webhook & Commands Menu (☰)',
        webapp: WEBAPP_URL
      }), { headers: { 'Content-Type': 'application/json;charset=utf-8' } });
    }

    if (WEBHOOK_SECRET) {
      const incomingSecret = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
      if (incomingSecret !== WEBHOOK_SECRET) {
        return new Response('Forbidden: invalid secret token', { status: 403 });
      }
    }

    try {
      const update = await request.json();
      if (!BOT_TOKEN) return new Response('OK', { status: 200 });

      // ======================================================================
      // 0. ИНЛАЙН-РЕЖИМ ДЛЯ ЛЮБЫХ ГРУПП, КАНАЛОВ И ЧАТОВ (update.inline_query)
      // Позволяет набрать @KlevProClubBot Город Рыба в любом чате!
      // ======================================================================
      if (update.inline_query) {
        const iq = update.inline_query;
        const qText = (iq.query || '').trim();
        const sess = getUserSession(iq.from?.id);
        const { city, fish } = await resolveQueryCityAndFish(qText || `${sess.cityName} ${sess.fishId}`, sess);
        const card = await buildWorkerForecastCard(city, fish, WEBAPP_URL, false);
        const recCard = await buildRecommendationsCard(city, WEBAPP_URL, false);
        const expCard = await buildExpress72hCard(city, fish, WEBAPP_URL, false);

        const results = [
          {
            type: 'article',
            id: `fc_${city.lat.toFixed(2)}_${city.lon.toFixed(2)}_${fish.id}`,
            title: `🎣 ${city.name}: ${fish.name} — клёв ${card.fishScore}%`,
            description: `🌊 ${city.water} • 🌡 Вода ~${card.weather.waterTemp}°C • 🧭 ${card.weather.press} мм • 💨 ${card.weather.wind} м/с`,
            input_message_content: {
              message_text: card.replyText,
              parse_mode: 'Markdown'
            },
            reply_markup: card.replyMarkup
          },
          {
            type: 'article',
            id: `top_${city.lat.toFixed(2)}_${city.lon.toFixed(2)}`,
            title: `🌟 ТОП-5 активных рыб сегодня: ${city.name}`,
            description: `Рекомендации ихтиолога по водоёмам в радиусе 50 км (${city.basin})`,
            input_message_content: {
              message_text: recCard.text,
              parse_mode: 'Markdown'
            },
            reply_markup: recCard.replyMarkup
          },
          {
            type: 'article',
            id: `exp_${city.lat.toFixed(2)}_${city.lon.toFixed(2)}_${fish.id}`,
            title: `⚡ Экспресс-радар на 72 часа (3 дня): ${city.name}`,
            description: `Прогноз на Сегодня, Завтра и Послезавтра • ${fish.name}`,
            input_message_content: {
              message_text: expCard.text,
              parse_mode: 'Markdown'
            },
            reply_markup: expCard.replyMarkup
          }
        ];

        await tgApi(BOT_TOKEN, 'answerInlineQuery', {
          inline_query_id: iq.id,
          results,
          cache_time: 120,
          is_personal: true
        });
        return new Response('OK', { status: 200 });
      }

      // ======================================================================
      // 1. НАЖАТИЕ ИНЛАЙН-КНОПОК ПОД СООБЩЕНИЕМ (update.callback_query)
      // ======================================================================
      if (update.callback_query) {
        const cq = update.callback_query;
        const data = String(cq.data || '');
        const cqUserId = cq.from?.id || cq.message?.chat?.id;
        const isPrivate = cq.message?.chat?.type === 'private';

        if (data.startsWith('top:')) {
          const [, latStr, lonStr, customName] = data.split(':');
          const lat = parseFloat(latStr);
          const lon = parseFloat(lonStr);
          const city = buildSpotContext(Number.isFinite(lat) ? lat : 66.0833, Number.isFinite(lon) ? lon : 76.6800, customName || '');
          saveUserSession(cqUserId, { lat: city.lat, lon: city.lon, cityName: city.name, wType: city.wType, waterName: city.waterName });
          const rec = await buildRecommendationsCard(city, WEBAPP_URL, isPrivate);
          await tgApi(BOT_TOKEN, 'answerCallbackQuery', { callback_query_id: cq.id, text: `🌟 ТОП-5 клёва: ${city.name}` });
          if (cq.message && cq.message.chat) {
            await tgApi(BOT_TOKEN, 'editMessageText', {
              chat_id: cq.message.chat.id,
              message_id: cq.message.message_id,
              text: rec.text,
              parse_mode: 'Markdown',
              reply_markup: rec.replyMarkup
            });
          }
          return new Response('OK', { status: 200 });
        }

        if (data.startsWith('exp:')) {
          const [, latStr, lonStr, fishId, customName] = data.split(':');
          const lat = parseFloat(latStr);
          const lon = parseFloat(lonStr);
          const fish = BOT_FISH_CATALOG.find(f => f.id === fishId) || BOT_FISH_CATALOG[0];
          const city = buildSpotContext(Number.isFinite(lat) ? lat : 66.0833, Number.isFinite(lon) ? lon : 76.6800, customName || '');
          saveUserSession(cqUserId, { lat: city.lat, lon: city.lon, cityName: city.name, fishId: fish.id });
          const exp = await buildExpress72hCard(city, fish, WEBAPP_URL, isPrivate);
          await tgApi(BOT_TOKEN, 'answerCallbackQuery', { callback_query_id: cq.id, text: `⚡ Радар 72ч: ${city.name}` });
          if (cq.message && cq.message.chat) {
            await tgApi(BOT_TOKEN, 'editMessageText', {
              chat_id: cq.message.chat.id,
              message_id: cq.message.message_id,
              text: exp.text,
              parse_mode: 'Markdown',
              reply_markup: exp.replyMarkup
            });
          }
          return new Response('OK', { status: 200 });
        }

        if (data.startsWith('srch:')) {
          const [, latStr, lonStr, customName] = data.split(':');
          const lat = parseFloat(latStr);
          const lon = parseFloat(lonStr);
          const city = buildSpotContext(Number.isFinite(lat) ? lat : 66.0833, Number.isFinite(lon) ? lon : 76.6800, customName || '');
          const srch = buildSearchDirectoryCard(city);
          await tgApi(BOT_TOKEN, 'answerCallbackQuery', { callback_query_id: cq.id, text: `🔍 Водоёмы рядом: ${city.name}` });
          if (cq.message && cq.message.chat) {
            await tgApi(BOT_TOKEN, 'editMessageText', {
              chat_id: cq.message.chat.id,
              message_id: cq.message.message_id,
              text: srch.text,
              parse_mode: 'Markdown',
              reply_markup: srch.replyMarkup
            });
          }
          return new Response('OK', { status: 200 });
        }

        let city = buildSpotContext(66.0833, 76.6800, 'Новый Уренгой');
        let fish = BOT_FISH_CATALOG[0];

        if (data.startsWith('w:')) {
          // Переключение конкретного водоёма вокруг точки
          const [, latStr, lonStr, fishId, shortWName] = data.split(':');
          const lat = parseFloat(latStr);
          const lon = parseFloat(lonStr);
          fish = BOT_FISH_CATALOG.find(f => f.id === fishId) || BOT_FISH_CATALOG[0];
          const matchedW = BOT_WATERS_DB.find(w => Math.abs(w.lat - lat) < 0.02 && Math.abs(w.lon - lon) < 0.02);
          city = buildSpotContext(lat, lon, matchedW?.region || shortWName || '', matchedW || null, matchedW?.wType || '');
        } else if (data.startsWith('f:')) {
          const [, latStr, lonStr, fishId, customName] = data.split(':');
          const lat = parseFloat(latStr);
          const lon = parseFloat(lonStr);
          fish = BOT_FISH_CATALOG.find(f => f.id === fishId) || BOT_FISH_CATALOG[0];
          const wType = (fish.habitat === 'sea' && isCoastalInBasin(detectBasinByCoords(lat, lon), lat, lon)) ? 'sea_gulf' : '';
          city = buildSpotContext(Number.isFinite(lat) ? lat : 66.0833, Number.isFinite(lon) ? lon : 76.6800, customName || '', null, wType);
        } else if (data.startsWith('fish:')) {
          const [, cityName, fishId] = data.split(':');
          const resolved = await resolveQueryCityAndFish(`${cityName} ${fishId}`, getUserSession(cqUserId));
          city = resolved.city;
          fish = BOT_FISH_CATALOG.find(f => f.id === fishId) || resolved.fish;
        }

        saveUserSession(cqUserId, {
          lat: city.lat,
          lon: city.lon,
          cityName: city.name,
          wType: city.wType,
          waterName: city.waterName,
          fishId: fish.id
        });

        const card = await buildWorkerForecastCard(city, fish, WEBAPP_URL, isPrivate);
        await tgApi(BOT_TOKEN, 'answerCallbackQuery', {
          callback_query_id: cq.id,
          text: `🎣 ${city.name}: ${fish.name} (${card.fishScore}%)`
        });

        if (cq.message && cq.message.chat) {
          await tgApi(BOT_TOKEN, 'editMessageText', {
            chat_id: cq.message.chat.id,
            message_id: cq.message.message_id,
            text: card.replyText,
            parse_mode: 'Markdown',
            reply_markup: card.replyMarkup
          });
        }
        return new Response('OK', { status: 200 });
      }

      // ======================================================================
      // 2. ПОДДЕРЖКА КАНАЛОВ (update.channel_post) И ГРУПП / ЛИЧНЫХ ЧАТОВ
      // ======================================================================
      const msg = update.message || update.channel_post;
      if (!msg || !msg.chat) return new Response('OK', { status: 200 });

      const chatId = msg.chat.id;
      const chatType = msg.chat.type || 'private';
      const isPrivateChat = chatType === 'private';
      const isChannelPost = Boolean(update.channel_post);
      const userId = msg.from?.id || chatId;

      if (!checkWorkerRateLimit(userId, Boolean(msg.location))) {
        return new Response('OK', { status: 200 });
      }

      const session = getUserSession(userId);

      // Функция автоматической установки нижней панели кнопок (BOT_REPLY_KEYBOARD) и кнопки [ ☰ ] в личном чате
      async function ensurePrivateReplyKeyboard() {
        if (!isPrivateChat || session.keyboardSent) return;
        saveUserSession(userId, { keyboardSent: true });
        await configureBotMenusAndCommands(BOT_TOKEN, chatId);
        await tgApi(BOT_TOKEN, 'sendMessage', {
          chat_id: chatId,
          text: '🧭 *Панель быстрого управления активирована* (`🌟 Рекомендации`, `⚡`, `🔍`, `👤`, `❓`):',
          parse_mode: 'Markdown',
          reply_markup: BOT_REPLY_KEYBOARD
        });
      }

      // 2a. Отправка геопозиции (📎 -> Геопозиция)
      if (msg.location) {
        await ensurePrivateReplyKeyboard();
        const { latitude, longitude } = msg.location;
        const near = findNearestSettlement(latitude, longitude);
        const label = near.distKm <= 45 ? near.name : `${near.name} (${near.distKm} км)`;
        const city = buildSpotContext(latitude, longitude, label);
        const fish = city.speciesList[0] || BOT_FISH_CATALOG[0];
        saveUserSession(userId, {
          lat: city.lat,
          lon: city.lon,
          cityName: city.name,
          wType: city.wType,
          waterName: city.waterName,
          fishId: fish.id
        });
        const card = await buildWorkerForecastCard(city, fish, WEBAPP_URL, isPrivateChat);
        await tgApi(BOT_TOKEN, 'sendMessage', {
          chat_id: chatId,
          text: card.replyText,
          parse_mode: 'Markdown',
          reply_markup: card.replyMarkup
        });
        return new Response('OK', { status: 200 });
      }

      const rawText = (msg.text || '').trim();
      if (!rawText) return new Response('OK', { status: 200 });

      // В группах/супергруппах/каналах бот отвечает только на целевые обращения
      // (команды /klev, /top, /waters, /fish, /crew, /help, /start, упоминание @KlevProClubBot, префиксы "!клев", "клев ", "прогноз " или Reply боту),
      // чтобы не спамить на обычное общение рыбаков в группе!
      if (!isPrivateChat) {
        const isBotCommand = /^\/(klev|top|waters|fish|crew|express|search|help|start)(@KlevProClubBot)?(\s|$)/i.test(rawText);
        const isMention = /@KlevProClubBot/i.test(rawText);
        const isTriggerPrefix = /^(!клев|клев|прогноз)\s+/i.test(rawText);
        const isReplyToBot = Boolean(msg.reply_to_message?.from?.is_bot);
        if (!isBotCommand && !isMention && !isTriggerPrefix && !isReplyToBot) {
          return new Response('OK', { status: 200 });
        }
      }

      const cleanText = rawText.replace(/@KlevProClubBot/gi, '').trim();

      // ======================================================================
      // 3. ОБРАБОТКА /start (настройка [ ☰ ] + панель кнопок Фото 2 + приветствие)
      // ======================================================================
      if (cleanText.startsWith('/start')) {
        const startParam = cleanText.split(/\s+/)[1] || '';

        if (isPrivateChat) {
          saveUserSession(userId, { keyboardSent: true });
          await configureBotMenusAndCommands(BOT_TOKEN, chatId);
        }

        const kploc = decodeKplocToken(startParam);
        if (kploc) {
          const fish = BOT_FISH_CATALOG.find(f => f.id === kploc.fishId) || BOT_FISH_CATALOG[0];
          const near = findNearestSettlement(kploc.lat, kploc.lon);
          const label = near.distKm <= 50 ? near.name : `${kploc.lat.toFixed(3)}°N, ${kploc.lon.toFixed(3)}°E`;
          const city = buildSpotContext(kploc.lat, kploc.lon, label);
          saveUserSession(userId, { lat: city.lat, lon: city.lon, cityName: city.name, fishId: fish.id });
          if (isPrivateChat) {
            await tgApi(BOT_TOKEN, 'sendMessage', {
              chat_id: chatId,
              text: `📍 Загружена точка: *${city.name}* • *${fish.name}*`,
              parse_mode: 'Markdown',
              reply_markup: BOT_REPLY_KEYBOARD
            });
          }
          const card = await buildWorkerForecastCard(city, fish, WEBAPP_URL, isPrivateChat);
          await tgApi(BOT_TOKEN, 'sendMessage', {
            chat_id: chatId,
            text: card.replyText,
            parse_mode: 'Markdown',
            reply_markup: card.replyMarkup
          });
          return new Response('OK', { status: 200 });
        }

        const appLink = startParam.startsWith('KP1_') ? `${WEBAPP_URL}#klev_pack=${startParam}` : WEBAPP_URL;

        // 1) В личном чате первым сообщением закрепляем нижнюю панель кнопок (как на Фото 2)
        if (isPrivateChat) {
          await tgApi(BOT_TOKEN, 'sendMessage', {
            chat_id: chatId,
            text:
              `👋 *Добро пожаловать в «Клёв ПРО 2.0: Круг» (@KlevProClubBot)!*\n` +
              `Нижняя панель быстрых кнопок активирована:\n` +
              `• *🌟 Рекомендации* — ТОП-5 клёва сегодня в вашей точке\n` +
              `• *⚡* — Экспресс-радар на 72 часа (3 дня)\n` +
              `• *🔍* — Поиск водоёмов (50 и 120 км) и регионов\n` +
              `• *👤* — Ваш профиль и домашняя локация\n` +
              `• *❓* — Справка и работа в группах/каналах`,
            parse_mode: 'Markdown',
            reply_markup: BOT_REPLY_KEYBOARD
          });
        }

        // 2) Вторым сообщением отправляем интерактивную карточку быстрого старта
        await tgApi(BOT_TOKEN, 'sendMessage', {
          chat_id: chatId,
          text:
            `🎣 *В базе навигатора — все 115 видов рыб РФ, 609 городов/посёлков и 491 водоём.*\n\n` +
            `Напишите мне *город/посёлок, водоём или рыбу* в любом сочетании:\n` +
            `• \`Мишкино Курганская карась\` или \`Курган судак\`\n` +
            `• \`Мишкино Башкортостан чехонь\`\n` +
            `• \`Озеро Негито\` или \`Новый Уренгой елец\`\n` +
            `• \`Ярославль судак\` или \`Сочи барабулька\`\n\n` +
            `Или отправьте геопозицию (📎 ➔ Геопозиция), или выберите точку ниже:`,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [makeAppButton('🎣 Открыть навигатор «Клёв ПРО 2.0»', appLink, isPrivateChat)],
              [
                { text: '📍 Мишкино (Кург) • Карась', callback_data: 'f:55.338:63.918:crucian:Мишкино (Кург)' },
                { text: '📍 Мишкино (РБ) • Судак', callback_data: 'f:55.461:55.948:zander:Мишкино (РБ)' }
              ],
              [
                { text: '📍 Озеро Негито • Пелядь', callback_data: 'f:65.410:77.120:peled:Озеро Негито' },
                { text: '📍 Сочи • Барабулька', callback_data: 'f:43.586:39.723:red_mullet:Сочи' }
              ],
              [
                { text: '📍 Ярославль • Судак', callback_data: 'f:57.626:39.885:zander:Ярославль' },
                { text: '📍 Астрахань • Сазан', callback_data: 'f:46.350:48.041:carp:Астрахань' }
              ]
            ]
          }
        });
        return new Response('OK', { status: 200 });
      }

      // ======================================================================
      // 4. ОБРАБОТКА КНОПОК НИЖНЕЙ ТЕКСТОВОЙ ПАНЕЛИ (Фото 2) И КОМАНД МЕНЮ [ ☰ ]
      // ======================================================================
      await ensurePrivateReplyKeyboard();

      // Кнопка «🌟 Рекомендации» или команда /top [город]
      if (cleanText === '🌟 Рекомендации' || cleanText.toLowerCase() === 'рекомендации' || /^\/top(\s|$)/i.test(cleanText)) {
        const arg = cleanText.replace(/^\/top\s*/i, '').replace(/^🌟\s*Рекомендации/i, '').trim();
        const { city } = await resolveQueryCityAndFish(arg || session.cityName, session);
        saveUserSession(userId, { lat: city.lat, lon: city.lon, cityName: city.name, wType: city.wType, waterName: city.waterName });
        const rec = await buildRecommendationsCard(city, WEBAPP_URL, isPrivateChat);
        if (isChannelPost) {
          await tgApi(BOT_TOKEN, 'editMessageText', { chat_id: chatId, message_id: msg.message_id, text: rec.text, parse_mode: 'Markdown', reply_markup: rec.replyMarkup });
        } else {
          await tgApi(BOT_TOKEN, 'sendMessage', { chat_id: chatId, text: rec.text, parse_mode: 'Markdown', reply_markup: rec.replyMarkup });
        }
        return new Response('OK', { status: 200 });
      }

      // Кнопка «⚡» или команда /crew / /express [город рыба]
      if (cleanText === '⚡' || /^\/(crew|express)(\s|$)/i.test(cleanText)) {
        const arg = cleanText.replace(/^\/(crew|express)\s*/i, '').replace(/^⚡\s*/, '').trim();
        const { city, fish } = await resolveQueryCityAndFish(arg || `${session.cityName} ${session.fishId}`, session);
        saveUserSession(userId, { lat: city.lat, lon: city.lon, cityName: city.name, fishId: fish.id });
        const exp = await buildExpress72hCard(city, fish, WEBAPP_URL, isPrivateChat);
        if (isChannelPost) {
          await tgApi(BOT_TOKEN, 'editMessageText', { chat_id: chatId, message_id: msg.message_id, text: exp.text, parse_mode: 'Markdown', reply_markup: exp.replyMarkup });
        } else {
          await tgApi(BOT_TOKEN, 'sendMessage', { chat_id: chatId, text: exp.text, parse_mode: 'Markdown', reply_markup: exp.replyMarkup });
        }
        return new Response('OK', { status: 200 });
      }

      // Кнопка «🔍» или команды /search, /waters, /fish [город]
      if (cleanText === '🔍' || /^\/(search|waters|fish)(\s|$)/i.test(cleanText)) {
        const arg = cleanText.replace(/^\/(search|waters|fish)\s*/i, '').replace(/^🔍\s*/, '').trim();
        const { city } = await resolveQueryCityAndFish(arg || session.cityName, session);
        saveUserSession(userId, { lat: city.lat, lon: city.lon, cityName: city.name });
        const srch = buildSearchDirectoryCard(city);
        await tgApi(BOT_TOKEN, 'sendMessage', { chat_id: chatId, text: srch.text, parse_mode: 'Markdown', reply_markup: srch.replyMarkup });
        return new Response('OK', { status: 200 });
      }

      // Кнопка «👤» или команда /profile / /app
      if (cleanText === '👤' || /^\/(profile|my|app)(\s|$)/i.test(cleanText)) {
        const { city, fish } = await resolveQueryCityAndFish(`${session.cityName} ${session.fishId}`, session);
        const prof = buildUserProfileCard(session, city, fish, WEBAPP_URL, isPrivateChat);
        await tgApi(BOT_TOKEN, 'sendMessage', { chat_id: chatId, text: prof.text, parse_mode: 'Markdown', reply_markup: prof.replyMarkup });
        return new Response('OK', { status: 200 });
      }

      // Кнопка «❓» или команда /help
      if (cleanText === '❓' || cleanText === '?' || /^\/help(\s|$)/i.test(cleanText)) {
        const helpCard = buildHelpAndGroupsCard(WEBAPP_URL, isPrivateChat);
        await tgApi(BOT_TOKEN, 'sendMessage', { chat_id: chatId, text: helpCard.text, parse_mode: 'Markdown', reply_markup: helpCard.replyMarkup });
        return new Response('OK', { status: 200 });
      }

      // ======================================================================
      // 5. ЗАШИФРОВАННЫЙ КОД КРУГА/ЭКИПАЖА KP1_...
      // ======================================================================
      const kpMatch = cleanText.match(/(KP1_[A-Za-z0-9_-]+)/);
      if (kpMatch && kpMatch[1]) {
        const packUrl = `${WEBAPP_URL}#klev_pack=${kpMatch[1]}`;
        await tgApi(BOT_TOKEN, 'sendMessage', {
          chat_id: chatId,
          text: `📥 *Обнаружен зашифрованный пакет «Круга / Экипажа»!*\nНажмите кнопку ниже, чтобы сразу открыть и импортировать эту точку на карту:`,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [makeAppButton('📥 Открыть точку в навигаторе', packUrl, isPrivateChat)]
            ]
          }
        });
        return new Response('OK', { status: 200 });
      }

      // ======================================================================
      // 6. ЛЮБОЙ ТЕКСТОВЫЙ ЗАПРОС ПРОГНОЗА («Сочи барабуля», «Мишкино карась», «/klev Ярославль судак» и т.д.)
      // ======================================================================
      const { city, fish } = await resolveQueryCityAndFish(cleanText, session);
      saveUserSession(userId, {
        lat: city.lat,
        lon: city.lon,
        cityName: city.name,
        wType: city.wType,
        waterName: city.waterName,
        fishId: fish.id
      });

      const card = await buildWorkerForecastCard(city, fish, WEBAPP_URL, isPrivateChat);

      if (isChannelPost) {
        // В канале автоматически редактируем командный пост в красивую сводку
        await tgApi(BOT_TOKEN, 'editMessageText', {
          chat_id: chatId,
          message_id: msg.message_id,
          text: card.replyText,
          parse_mode: 'Markdown',
          reply_markup: card.replyMarkup
        });
      } else {
        await tgApi(BOT_TOKEN, 'sendMessage', {
          chat_id: chatId,
          reply_to_message_id: !isPrivateChat ? msg.message_id : undefined,
          text: card.replyText,
          parse_mode: 'Markdown',
          reply_markup: card.replyMarkup
        });
      }

      return new Response('OK', { status: 200 });
    } catch (e) {
      return new Response('OK', { status: 200 });
    }
  }
};
