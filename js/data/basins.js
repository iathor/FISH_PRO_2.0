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
euro_west: { name: 'Днепровско-Донской бассейн', hasSea: false, spawnShiftWeeks: -1 },
volga_caspian: { name: 'Волжско-Каспийский бассейн (Волга, Кама, Урал)', hasSea: true, spawnShiftWeeks: 0 }
};
export function detectBasinByCoords(lat, lon) {
if (lat >= 41.0 && lat <= 47.8 && lon >= 32.5 && lon <= 41.8) return 'black_azov';
if (lat >= 47.8 && lat <= 53.0 && lon >= 38.2 && lon <= 41.6) return 'black_azov';
if (lat >= 54.0 && lat <= 60.5 && lon >= 19.0 && lon <= 30.8) return 'baltic';
if (lat >= 60.8 && lon >= 38.0 && lon < 60.0) return 'barents_white';
if (lat >= 65.0 && lon >= 30.5 && lon < 60.0) return 'barents_white';
if (lat >= 58.0 && lat < 66.5 && lon >= 29.0 && lon <= 38.0) return 'nw_karelia';
if (lon >= 130.0 && lat >= 42.0 && (lon >= 138.0 || lat < 47.2 || lat >= 54.0)) return 'pacific_sea';
if (lon >= 112.0 && lon < 141.0 && lat >= 44.5 && lat < 56.0) return 'amur';
if (lat >= 50.5 && lat <= 56.8 && lon >= 102.5 && lon < 112.0) return 'baikal';
if (lon >= 88.0 && lon < 138.0 && lat >= 51.0) return 'yenisei_lena';
if (lat >= 50.5 && lon >= 60.0 && lon < 88.0) {
if (lat < 54.15 && lon < 60.8) return 'volga_caspian';
return 'arctic_ob_taz';
}
if (lon < 37.2 && lat < 55.8) return 'euro_west';
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
return (lat >= 63.8 && lon >= 34.0) || (lat <= 60.8 && lon <= 30.6);
case 'volga_caspian':
return lat <= 46.65 && lon >= 46.5 && lon <= 51.5;
case 'black_azov':
if (lat <= 44.85 && lon >= 37.0 && lon <= 40.2) return true;
if (lat <= 46.2 && lon >= 32.5 && lon <= 36.8) return true;
if (lat >= 45.0 && lat <= 47.35 && lon >= 36.5 && lon <= 39.5) return true;
return false;
case 'baltic':
return (lon <= 22.5) || (lat >= 59.35 && lon >= 27.5 && lon <= 30.6);
case 'barents_white':
return lat >= 66.2 || (lat >= 63.8 && lon >= 36.5 && lon <= 45.5);
case 'pacific_sea':
return true;
default:
return false;
}
}
export function getSpotEcoregion(lat, lon, basinCode, waterType = 'small_river', selectedWaterName = '') {
const bCode = basinCode || detectBasinByCoords(lat, lon);
const wNameLower = String(selectedWaterName || '').toLowerCase();
const isLakeOrQuarry = waterType === 'tundra_lake' || waterType === 'quarry';
const isSea = waterType === 'sea_gulf' || waterType === 'open_sea';
if (bCode === 'arctic_ob_taz') {
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
if (bCode === 'volga_caspian') {
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
return {
subRegion: 'upper_middle_volga',
displayBasinName: 'Волжско-Окский бассейн (Волга, Ока, водохранилища Центра и Поволжья)',
searchPlaceholder: '🔍 Поиск рыбы (лещ, судак, окунь, щука, плотва, карась, голавль, жерех, сазан, сом...)',
signatureSpecies: isLakeOrQuarry
? ['perch', 'pike', 'bream', 'roach', 'crucian', 'zander', 'white_bream', 'carp', 'rudd', 'tench', 'bleak', 'ide', 'catfish', 'volga_zander', 'blue_bream', 'rotan', 'ruffe', 'burbot']
: ['perch', 'pike', 'bream', 'roach', 'zander', 'crucian', 'white_bream', 'chub', 'asp', 'carp', 'ide', 'catfish', 'bleak', 'rudd', 'tench', 'chekhon', 'volga_zander', 'blue_bream', 'sopa', 'dace', 'gudgeon', 'ruffe', 'burbot', 'undermouth', 'sterlet']
};
}
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
if (bCode === 'euro_west') {
return {
subRegion: 'euro_west_desna_seim',
displayBasinName: 'Днепровско-Деснянский и Сеймский бассейн (Днепр, Десна, Сейм, Оскол)',
searchPlaceholder: '🔍 Поиск рыбы (щука, окунь, лещ, карась, плотва, судак, голавль, карп, жерех, сом...)',
signatureSpecies: ['perch', 'pike', 'crucian', 'bream', 'roach', 'zander', 'carp', 'chub', 'asp', 'white_bream', 'ide', 'tench', 'rudd', 'bleak', 'catfish', 'dace', 'gudgeon', 'ruffe', 'burbot', 'rotan']
};
}
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
if (bCode === 'nw_karelia') {
return {
subRegion: 'karelia_ladoga_onega',
displayBasinName: 'Ладожско-Онежский и Карельский бассейн (Ладога, Онега, Вуокса, Карелия)',
searchPlaceholder: '🔍 Поиск рыбы (окунь, щука, судак, сиг, хариус, форель, ряпушка, плотва, лещ, налим...)',
signatureSpecies: ['perch', 'pike', 'zander', 'roach', 'bream', 'whitefish', 'vendace', 'grayling', 'trout', 'burbot', 'ide', 'dace', 'smelt', 'salmon', 'broad_whitefish', 'ruffe', 'crucian']
};
}
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
if (bCode === 'baikal') {
return {
subRegion: 'baikal_angara_selenga',
displayBasinName: 'Байкало-Ангарский бассейн (Байкал, Ангара, Селенга, Баргузин)',
searchPlaceholder: '🔍 Поиск рыбы (байкальский хариус, омуль, ленок, окунь, щука, сорога, елец, сиг, налим...)',
signatureSpecies: ['baikal_grayling', 'perch', 'pike', 'roach', 'dace', 'omul', 'lenok', 'crucian', 'ide', 'burbot', 'pizhyan', 'peled', 'ruffe']
};
}
if (bCode === 'amur') {
return {
subRegion: 'amur_ussuri_zeya',
displayBasinName: 'Амурский бассейн (Амур, Зея, Бурея, Уссури, оз. Ханка)',
searchPlaceholder: '🔍 Поиск рыбы (карась, сазан, щука, верхогляд, змееголов, ленок, хариус, сом, конь-губарь, кета...)',
signatureSpecies: ['crucian', 'carp', 'pike', 'sky_gazer', 'snakehead', 'amur_catfish', 'tarpon_carp', 'parabramis', 'lenok', 'grayling', 'grass_carp', 'burbot', 'rotan', 'chum_salmon', 'pink_salmon', 'gudgeon']
};
}
return {
subRegion: 'pacific_far_east',
displayBasinName: 'Тихоокеанский бассейн (Приморье, Сахалин, Камчатка, Охотское море)',
searchPlaceholder: '🔍 Поиск рыбы (кета, горбуша, кижуч, мальма, кунджа, корюшка, навага, камбала, терпуг, сима...)',
signatureSpecies: isSea
? ['smelt', 'navaga', 'starry_flounder', 'flounder', 'greenling', 'pink_salmon', 'chum_salmon', 'coho_salmon', 'cherry_salmon', 'char', 'dolly_varden', 'herring', 'walleye_pollock', 'sea_bass', 'halibut', 'crab', 'king_crab']
: ['dolly_varden', 'char', 'pink_salmon', 'chum_salmon', 'coho_salmon', 'cherry_salmon', 'sockeye_salmon', 'chinook_salmon', 'smelt', 'navaga', 'grayling', 'crucian', 'pike', 'rotan']
};
}
export function isSpeciesInGeoRange(fish, lat, lon, basinCode, waterType = 'small_river', radiusKm = 50, radiusWaterTypes = null, isCoastal = false, hasCoolingInRadius = false, selectedWaterName = '') {
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
const fishWaters = Array.isArray(fish.waters) ? fish.waters : ['small_river', 'big_river', 'quarry', 'tundra_lake'];
let waterMatch = fishWaters.includes(waterType);
if ((waterType === 'sea_gulf' || waterType === 'open_sea') && (fish.habitat === 'sea' || fishWaters.includes('sea_gulf') || fishWaters.includes('open_sea'))) {
waterMatch = true;
}
if (!waterMatch && !isSeaWater && fish.habitat === 'fresh') {
if (radiusKm >= 120) {
waterMatch = fishWaters.some(wt => rSet.has(wt));
} else {
if (waterType === 'small_river' && rSet.has('big_river') && fishWaters.includes('big_river') && !['vendace', 'whitefish', 'broad_whitefish', 'omul'].includes(fid)) {
waterMatch = true;
}
}
}
if (!waterMatch) return false;
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
if (fid === 'char') {
if (bCode === 'arctic_ob_taz' || bCode === 'yenisei_lena') {
if (lat < 66.0) return false;
} else if (bCode === 'barents_white') {
if (lat < 65.5) return false;
} else if (bCode === 'baikal') {
if (lat < 54.0 || !hasDeepQuarryInRadius) return false;
} else if (bCode !== 'pacific_sea') {
return false;
}
}
if (fid === 'chir') {
if (bCode === 'arctic_ob_taz') {
if (lat < 60.5) return false;
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
} else if (bCode === 'barents_white') {
if (lat < 63.5 || lon < 44.0) return false;
}
}
if (fid === 'peled') {
if (bCode === 'arctic_ob_taz') {
if (lat < 59.2) {
if (waterType !== 'tundra_lake' && waterType !== 'quarry') return false;
}
} else if (bCode === 'volga_caspian') {
if (waterType !== 'quarry' && waterType !== 'tundra_lake') return false;
if (lat < 53.5) return false;
} else if (bCode === 'barents_white') {
if (lon < 42.0) return false;
}
}
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
if (waterType === 'tundra_lake' && lat < 62.0) return false;
if (bCode === 'arctic_ob_taz') {
const isUralSlope = lon <= 61.35 || (lat >= 59.0 && lon <= 66.0);
const isNorthTaiga = lat >= 61.2;
const isAltaiTom = lon >= 82.5;
if (!isUralSlope && !isNorthTaiga && !isAltaiTom) return false;
} else if (bCode === 'volga_caspian') {
const isKamaBashkirUral = lon >= 55.2 && lat >= 52.5;
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
}
}
if (fid === 'sterlet') {
if (waterType !== 'big_river' && !(radiusKm >= 120 && hasBigRiverInRadius)) return false;
if (bCode === 'arctic_ob_taz' && lat >= 66.8) return false;
if (bCode === 'yenisei_lena' && lon >= 98.0) return false;
if (bCode === 'barents_white' && (lon < 39.0 || lon > 52.0)) return false;
}
if (fid === 'siberian_sturgeon') {
if (waterType !== 'big_river' && waterType !== 'sea_gulf' && bCode !== 'baikal' && !(radiusKm >= 120 && hasBigRiverInRadius)) return false;
}
if (['vobla', 'kutum', 'white_salmon'].includes(fid)) {
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
if (fid === 'zander') {
if (bCode === 'arctic_ob_taz') {
if (lat > 62.5) return false;
if (waterType === 'small_river' && radiusKm < 120 && !hasBigRiverInRadius && !hasDeepQuarryInRadius) return false;
} else if (bCode === 'yenisei_lena') {
if (lat > 56.5 || lon > 94.0) return false;
}
}
if (fid === 'bream') {
if (bCode === 'arctic_ob_taz') {
if (lat > 63.0 && !(waterType === 'big_river' && lon <= 70.0)) return false;
} else if (bCode === 'yenisei_lena') {
if (lat > 59.0 || lon > 104.5) return false;
}
}
if (fid === 'carp' || fid === 'tench') {
if (bCode === 'arctic_ob_taz' || bCode === 'yenisei_lena') {
if (lat > 59.2 && waterType !== 'cooling_reservoir' && !hasCoolingInRadius) return false;
}
if (bCode === 'nw_karelia' && lat > 62.2) return false;
}
if (['white_bream', 'rudd', 'bleak'].includes(fid)) {
if (bCode === 'arctic_ob_taz') {
if (lat > 58.6 || lon > 84.5) return false;
}
if (bCode === 'nw_karelia' && lat > 63.0) return false;
}
if (fid === 'chub') {
if (bCode === 'arctic_ob_taz') {
if (lon > 62.2 || lat > 58.2) return false;
}
if (bCode === 'nw_karelia' && lat > 62.2) return false;
}
const isCaucasianStream = bCode === 'black_azov' && lat <= 44.65 && lat >= 43.3 && lon >= 38.4 && lon <= 40.5 && (waterType === 'small_river' || /мзымта|сочи|шахе|хоста|псоу/i.test(wNameLower));
if (isCaucasianStream && ['pike', 'perch', 'zander', 'bream', 'carp', 'crucian', 'catfish', 'asp', 'tench', 'rudd', 'white_bream', 'silver_carp', 'grass_carp'].includes(fid)) {
return false;
}
return true;
}
