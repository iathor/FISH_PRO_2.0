/**
 * @file circle.module.js
 * @description Модуль «Клёв ПРО: Круг» и выделенная вкладка «💬 Чаты» (Ревизия 2.0.172):
 * - Ультракороткая бинарная упаковка V3 (#p=KP1_<28_символов>) со встроенным 20-битным ID рыбака (FP_89AAA001).
 * - Автоматическая привязка ID рыбака (FP_89AAA001) ко всем точкам: Круг, Экипаж 72ч, SOS, Мастерская, Закладки и Уловы.
 * - Автокопирование ID рыбака (FP_89AAA001) и ключей Экипажа (KP-XXXX) в 1 касание (data-copy-fisher-id).
 * - Разделение всех событий на «👤 МОИ» (с возможностью удаления 🗑️) и «🌐 ЧУЖИЕ» (только скрытие 🙈 / возврат 👁️).
 * - Компактный список событий (.circle-compact-list) с раскрывающимися деталями без «взрыва ленты».
 * - Выделенная вкладка «💬 Чаты» на нижней панели навигации + отправка карточки улова прямо в чат.
 * - Закрытый режим Супер-Админа (только для Владельца + управляемая База Администраторов с синхронизацией).
 */
import { store } from '../../core/store.js?v=2.0.172';
import { storage, calcGeoDistanceKm, safeJsonParse } from '../../core/storage.js?v=2.0.172';
import { router } from '../../core/router.js?v=2.0.172';
import { getSeasonalBaitsForContext } from '../../core/config.js?v=2.0.172';
import { detectBasinByCoords, isCoastalInBasin } from '../../data/basins.js?v=2.0.172';
import { findNearestRussianSettlement, getNearestRussianWaters } from '../../data/russia-waters.js?v=2.0.172';
import { WATER_PROFILES } from '../../data/waters.js?v=2.0.172';
import { FISH_DB } from '../../data/species.js?v=2.0.172';
import { escapeHtml, createPill, showToast, openModal, closeModal, copyFisherIdToClipboard } from '../../ui/components.js?v=2.0.172';
import {
  RELAY_WORKER_URL,
  buildShareUrls,
  shareToTelegramChat,
  shareOrCopyPack,
  getTelegramUser,
  syncToTelegramCloud,
  readFromTelegramCloud,
  triggerHaptic
} from '../../core/telegram.js?v=2.0.172';
import { setLocation } from '../geo/geo.module.js?v=2.0.172';
import { calcDynamicRig } from '../forecast/forecast.module.js?v=2.0.172';
export const CREW_TTL_MS = 72 * 60 * 60 * 1000;
export const CIRCLE_BLUR_RADIUS_KM = 5.0;
export const CIRCLE_OLDER_BLUR_RADIUS_KM = 10.0;
export const REGIONAL_K_ANONYMITY_THRESHOLD = 3;
const PACK_PREFIX = 'KP1_';
const CIPHER_SALT = 'KlevProCircle_v2.1_Salt_RU';
const E2E_PREFIX = 'KPE2E_';
const EPOCH_2024_MS = 1704067200000; // 2024-01-01T00:00:00Z
const OWNER_TG_USERNAMES = ['thorantony82', 'iathor', 'iathor82'];
const OWNER_MASTER_KEYS = ['KLEV-ADMIN-89', 'THOR82', '8989', 'FISHERMAN1982*', 'IATHOR82'];
const DEFAULT_ADMIN_IDS = ['FP_FMP089'];
export const OWNER_BOUND_LOGIN = 'iAthor82';
export const OWNER_BOUND_FISHER_ID = 'FP_FMP089';
export const OWNER_BOUND_PIN_HASH = 'owner_iathor82_1982';
export const PACK_WATER_KEYS = ['small_river', 'big_river', 'quarry', 'tundra_lake', 'cooling_reservoir', 'sea_gulf', 'open_sea'];
export const PACK_METHOD_KEYS = ['spin_micro', 'spin_jig', 'spin_lure', 'bottom', 'float', 'winter_jig', 'winter_lure', 'fly', 'sea_rock'];
export const RUSSIA_REGION_CODE_RULES = [
  ['сахалин', '65'], ['курил', '65'],
  ['якут', '14'], ['саха (якут', '14'],
  ['костром', '44'],
  ['томск', '70'], ['колпашево', '70'], ['стрежевой', '70'],
  ['омск', '55'],
  ['ямало', '89'], ['янао', '89'], ['уренгой', '89'], ['салехард', '89'], ['надым', '89'], ['ноябрьск', '89'], ['тарко-сале', '89'], ['тазовск', '89'], ['губкинск', '89'], ['муравленко', '89'], ['лабытнанг', '89'], ['пангод', '89'], ['коротчаев', '89'],
  ['ненецк', '83'], ['нарьян-мар', '83'],
  ['ханты', '86'], ['хмао', '86'], ['югра', '86'], ['сургут', '86'], ['нижневартовск', '86'], ['нефтеюганск', '86'], ['когалым', '86'], ['няган', '86'],
  ['адыге', '01'], ['майкоп', '01'],
  ['башкорт', '02'], ['башкир', '02'], ['уфа', '02'], ['стерлитамак', '02'],
  ['бурят', '03'], ['улан-удэ', '03'], ['северобайкальск', '03'],
  ['республика алтай', '04'], ['горно-алтайск', '04'],
  ['алтайск', '22'], ['барнаул', '22'], ['бийск', '22'],
  ['дагестан', '05'], ['махачкал', '05'], ['дербент', '05'], ['кизляр', '05'],
  ['ингушет', '06'], ['магас', '06'], ['назран', '06'],
  ['кабардино', '07'], ['нальчик', '07'],
  ['калмык', '08'], ['элист', '08'], ['лаган', '08'],
  ['карачаево', '09'], ['черкесск', '09'],
  ['карели', '10'], ['петрозаводск', '10'], ['сортавал', '10'],
  ['коми', '11'], ['сыктывкар', '11'], ['воркут', '11'], ['усинск', '11'], ['ухта', '11'], ['печор', '11'],
  ['марий эл', '12'], ['йошкар-ол', '12'],
  ['мордов', '13'], ['саранск', '13'],
  ['осети', '15'], ['алани', '15'], ['владикавказ', '15'],
  ['татарстан', '16'], ['казан', '16'], ['челны', '16'], ['нижнекамск', '16'],
  ['тыва', '17'], ['тува', '17'], ['кызыл', '17'],
  ['удмурт', '18'], ['ижевск', '18'], ['воткинск', '18'],
  ['хакаси', '19'], ['абакан', '19'], ['саяногорск', '19'],
  ['чечен', '20'], ['грозн', '20'],
  ['чуваш', '21'], ['чебоксар', '21'],
  ['краснодар', '23'], ['сочи', '23'], ['кубан', '23'], ['анап', '23'], ['туапсе', '23'], ['новороссийск', '23'], ['ейск', '23'], ['темрюк', '23'],
  ['красноярск', '24'], ['норильск', '24'], ['дудинк', '24'], ['енисейск', '24'],
  ['приморск', '25'], ['владивосток', '25'], ['находк', '25'], ['уссурийск', '25'],
  ['ставропол', '26'], ['пятигорск', '26'],
  ['хабаровск', '27'], ['комсомольск', '27'],
  ['амурск', '28'], ['благовещенск', '28'], ['зея', '28'], ['тында', '28'],
  ['архангел', '29'], ['северодвинск', '29'], ['котлас', '29'],
  ['астрахан', '30'], ['ахтуб', '30'], ['харабал', '30'], ['камызяк', '30'],
  ['белгород', '31'], ['старый оскол', '31'],
  ['брянск', '32'],
  ['владимир', '33'], ['муром', '33'],
  ['волгоград', '34'], ['камышин', '34'], ['волжский', '34'],
  ['вологод', '35'], ['вологд', '35'], ['череповец', '35'],
  ['воронеж', '36'],
  ['ивановск', '37'], ['иваново', '37'], ['кинешм', '37'],
  ['иркутск', '38'], ['братск', '38'], ['ангарск', '38'], ['листвянк', '38'],
  ['калининград', '39'], ['зеленоградск', '39'], ['балтийск', '39'],
  ['калуж', '40'], ['калуг', '40'], ['обнинск', '40'],
  ['камчат', '41'], ['петропавловск-камчат', '41'], ['елизово', '41'],
  ['кемеров', '42'], ['кузбасс', '42'], ['новокузнецк', '42'],
  ['кировск', '43'], ['киров', '43'], ['вятк', '43'],
  ['курган', '45'], ['шадринск', '45'], ['заурал', '45'], ['шумих', '45'], ['куртамыш', '45'],
  ['курск', '46'], ['курчатов', '46'],
  ['ленинград', '47'], ['выборг', '47'], ['приозерск', '47'], ['ладог', '47'],
  ['липецк', '48'], ['елец', '48'],
  ['магадан', '49'],
  ['московск', '50'], ['подмосков', '50'], ['подольск', '50'], ['коломн', '50'], ['серпухов', '50'], ['дубн', '50'], ['шатур', '50'], ['истр', '50'], ['можайск', '50'], ['руз', '50'],
  ['москва', '77'], ['зеленоград', '77'],
  ['мурманск', '51'], ['териберк', '51'], ['кольск', '51'], ['кандалакш', '51'],
  ['нижегород', '52'], ['нижний новгород', '52'],
  ['новгородск', '53'], ['великий новгород', '53'], ['валдай', '53'],
  ['новосибирск', '54'], ['бердск', '54'], ['барабинск', '54'], ['чаны', '54'],
  ['оренбург', '56'], ['орск', '56'], ['бузулук', '56'],
  ['орловск', '57'], ['орел', '57'],
  ['пенз', '58'],
  ['перм', '59'], ['березник', '59'], ['соликамск', '59'], ['чусов', '59'],
  ['псков', '60'], ['великие луки', '60'], ['гдов', '60'],
  ['ростовск', '61'], ['ростов-на-дону', '61'], ['таганрог', '61'], ['волгодонск', '61'], ['цимлянск', '61'],
  ['рязан', '62'], ['касимов', '62'],
  ['самар', '63'], ['тольятти', '63'], ['сызран', '63'],
  ['саратов', '64'], ['энгельс', '64'], ['балаково', '64'], ['вольск', '64'],
  ['свердловск', '66'], ['екатеринбург', '66'], ['нижний тагил', '66'], ['серов', '66'],
  ['смоленск', '67'], ['десногорск', '67'],
  ['тамбов', '68'],
  ['твер', '69'], ['конаково', '69'], ['ржев', '69'], ['осташков', '69'], ['весьегонск', '69'], ['селигер', '69'],
  ['тульск', '71'], ['тула', '71'],
  ['тюмен', '72'], ['тобольск', '72'], ['ишим', '72'], ['ялуторовск', '72'], ['уват', '72'],
  ['ульяновск', '73'], ['димитровград', '73'],
  ['челябинск', '74'], ['магнитогорск', '74'], ['миасс', '74'], ['увильд', '74'], ['тургояк', '74'],
  ['забайкал', '75'], ['чита', '75'],
  ['ярослав', '76'], ['рыбинск', '76'], ['ростов великий', '76'], ['переславл', '76'], ['углич', '76'],
  ['санкт-петербург', '78'], ['петербург', '78'], ['кронштадт', '78'], ['сестрорецк', '78'],
  ['еврейск', '79'], ['биробиджан', '79'],
  ['донецк', '80'], ['днр', '80'], ['мариупол', '80'],
  ['луганск', '81'], ['лнр', '81'],
  ['севастопол', '92'], ['балаклав', '92'], ['инкерман', '92'],
  ['крым', '82'], ['симферопол', '82'], ['ялт', '82'], ['керч', '82'], ['феодоси', '82'], ['евпатори', '82'], ['судак', '82'],
  ['херсон', '84'], ['геническ', '84'], ['скадовск', '84'],
  ['запорож', '85'], ['мелитопол', '85'], ['бердянск', '85'],
  ['чукот', '87'], ['анадыр', '87']
];
let filterWorkshopForToday = false;
let activeOwnershipFilter = 'all'; // 'all' | 'mine' | 'foreign' | 'hidden'
let activeCategoryFilter = 'all'; // 'all' | 'sos' | 'crew' | 'circle' | 'workshop'
const expandedCompactIds = new Set();
let activeChatChannelId = ''; // 'crew:KP-XXXX' | 'dm:FP_XXXX:FP_YYYY'
let relayPollTimer = null;
let lastRelayPullTs = 0;
/**
 * Быстрый детерминированный 32-битный FNV-1a хэш
 */
export function fnv1a32(str = '') {
  let h = 0x811c9dc5;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
/**
 * Вычисляет необратимый многораундовый крипто-токен авторизации (вместо хранения открытого пароля в localStorage)
 */
export function deriveSecureAuthToken(loginNorm = '', passClean = '') {
  const cleanL = String(loginNorm || '').trim().toLowerCase().replace(/^@/, '');
  const cleanP = String(passClean || '').trim();
  let h1 = fnv1a32(`klev_auth_v2::${cleanL}::${cleanP}::${CIPHER_SALT}`);
  let h2 = fnv1a32(`salt2::${cleanP}::${cleanL}::${h1}`);
  for (let i = 0; i < 64; i++) {
    h1 = fnv1a32(`${h1}:${h2}:${i}:${cleanL}`);
    h2 = fnv1a32(`${h2}:${h1}:${i}:${CIPHER_SALT}`);
  }
  return `KTOK_${h1.toString(16).toUpperCase().padStart(8, '0')}_${h2.toString(16).toUpperCase().padStart(8, '0')}`;
}
/**
 * Определяет 2-значный код региона РФ (01..99, включая новые регионы России 80, 81, 84, 85, 82, 92)
 * по названию субъекта/города или координатам рыбака
 */
export function resolveRussianRegionCode(stateOrText = null, lat = null, lon = null) {
  let text = '';
  let effLat = Number(lat);
  let effLon = Number(lon);
  if (typeof stateOrText === 'string') {
    text = stateOrText;
  } else if (stateOrText && typeof stateOrText === 'object') {
    text = `${stateOrText.locAdmin1 || ''} ${stateOrText.locLabel || ''} ${stateOrText.locAdmin2 || ''}`;
    if (!Number.isFinite(effLat)) effLat = Number(stateOrText.lat);
    if (!Number.isFinite(effLon)) effLon = Number(stateOrText.lon);
  } else {
    const s = store.getState();
    text = `${s?.locAdmin1 || ''} ${s?.locLabel || ''} ${s?.locAdmin2 || ''}`;
    if (!Number.isFinite(effLat)) effLat = Number(s?.lat);
    if (!Number.isFinite(effLon)) effLon = Number(s?.lon);
  }
  const norm = String(text || '').toLowerCase().replace(/ё/g, 'е').trim();
  if (norm) {
    for (const [kw, code] of RUSSIA_REGION_CODE_RULES) {
      if (norm.includes(kw)) return code;
    }
  }
  if (Number.isFinite(effLat) && Number.isFinite(effLon)) {
    const nearCity = findNearestRussianSettlement(effLat, effLon);
    if (nearCity && nearCity.admin1) {
      const admNorm = String(nearCity.admin1).toLowerCase().replace(/ё/g, 'е');
      for (const [kw, code] of RUSSIA_REGION_CODE_RULES) {
        if (admNorm.includes(kw)) return code;
      }
    }
  }
  return '89';
}
/**
 * Генерирует региональный Рыболовный ID формата FP_<RR><AAA..ZZZ><001..999>
 * Ёмкость: 26^3 * 999 = 17 558 424 уникальных ID на каждый регион РФ!
 * - index0 = 0   -> FP_89AAA001 (1-й рыбак в регионе)
 * - index0 = 998 -> FP_89AAA999 (999-й рыбак в регионе)
 * - index0 = 999 -> FP_89AAB001 (1000-й рыбак в регионе — строго 001, без 000!)
 */
export function formatFisherIdFromIndex(regionCode = '89', index0Based = 0) {
  const regDigits = String(regionCode || '89').replace(/\D/g, '').padStart(2, '0').slice(-2);
  const reg = (regDigits === '00' ? '89' : regDigits);
  const idx = Math.max(0, Math.floor(Number(index0Based) || 0));
  const num = (idx % 999) + 1; // Строго 001..999 (никогда не 000!)
  const letterBlock = Math.floor(idx / 999) % 17576;
  const c1 = String.fromCharCode(65 + (Math.floor(letterBlock / 676) % 26));
  const c2 = String.fromCharCode(65 + (Math.floor(letterBlock / 26) % 26));
  const c3 = String.fromCharCode(65 + (letterBlock % 26));
  return `FP_${reg}${c1}${c2}${c3}${String(num).padStart(3, '0')}`;
}
/**
 * Нормализует любой введённый или сохранённый Рыболовный ID к единому стандарту:
 * - Персональный ID Владельца и VIP/красивые ID без кода региона: FP_FMP089, FP_VIP777
 * - Стандартные региональные ID на 10^6+ аудиторию: FP_89AAA001, FP_77AAB001, FP_01AAA001, FP_45AAA001
 * - Автоматическая миграция старого FP_FMP089 -> FP_FMP089
 */
export function normalizeFisherId(rawStr = '', fallbackRegion = '89') {
  const clean = String(rawStr || '').trim().toUpperCase().replace(/-/g, '_');
  if (!clean) return '';
  if (clean === 'FP_89A01' || clean === 'FP_FMP089' || clean === 'FMP089') {
    return OWNER_BOUND_FISHER_ID;
  }
  const regMatch = clean.match(/^(?:FP_)?(\d{2})([A-Z]{3})(\d{3})$/);
  if (regMatch) {
    const reg = regMatch[1];
    const lets = regMatch[2];
    const numVal = Math.max(1, Math.min(999, parseInt(regMatch[3], 10) || 1));
    return `FP_${reg}${lets}${String(numVal).padStart(3, '0')}`;
  }
  const vipMatch = clean.match(/^(?:FP_)?([A-Z]{3})(\d{3})$/);
  if (vipMatch) {
    const lets = vipMatch[1];
    const numVal = Math.max(1, Math.min(999, parseInt(vipMatch[2], 10) || 1));
    return `FP_${lets}${String(numVal).padStart(3, '0')}`;
  }
  const idx = fnv1a32(clean) % (17576 * 999);
  return formatFisherIdFromIndex(fallbackRegion, idx);
}
export function isValidFisherIdFormat(str = '') {
  const s = String(str || '').trim();
  return /^FP_(?:\d{2})?[A-Z]{3}(?:00[1-9]|0[1-9]\d|[1-9]\d{2})$/.test(s);
}
/**
 * Вычисляет 16-битный числовой хэш ключа экипажа (1..65535) и форматирует его в короткий ключ KP-XXXX
 */
export function computeCrewKeyHash(seedStr = '') {
  const raw = String(seedStr || '').trim().toUpperCase();
  const hexMatch = raw.match(/^KP-([0-9A-F]{4})$/);
  if (hexMatch) {
    const val = parseInt(hexMatch[1], 16);
    if (Number.isFinite(val) && val > 0) return val & 0xffff;
  }
  const h = fnv1a32(raw || 'crew_default') & 0xffff;
  return h === 0 ? 0x7a3f : h;
}
export function formatCrewKeyFromHash(hash16) {
  const clean = (Number(hash16) || 0x7a3f) & 0xffff;
  return `KP-${(clean || 0x7a3f).toString(16).toUpperCase().padStart(4, '0')}`;
}
/**
 * Упаковывает Рыболовный ID (как региональный FP_89AAA001, так и VIP/Владельца FP_FMP089)
 * в 32-битное целое число (0 .. 1 755 842 399 < 2^31) без единой потери и обратно!
 */
export function encodeFisherIdTo32Bit(fisherIdStr = '') {
  const norm = normalizeFisherId(fisherIdStr || OWNER_BOUND_FISHER_ID);
  const regMatch = norm.match(/^FP_(\d{2})([A-Z]{3})(\d{3})$/);
  if (regMatch) {
    const reg = Math.max(1, Math.min(99, parseInt(regMatch[1], 10) || 89));
    const lets = regMatch[2];
    const num = Math.max(1, Math.min(999, parseInt(regMatch[3], 10) || 1));
    const lIdx = (lets.charCodeAt(0) - 65) * 676 + (lets.charCodeAt(1) - 65) * 26 + (lets.charCodeAt(2) - 65);
    return (((reg * 17576 + lIdx) * 999) + (num - 1)) >>> 0;
  }
  const vipMatch = norm.match(/^FP_([A-Z]{3})(\d{3})$/);
  if (vipMatch) {
    const lets = vipMatch[1];
    const num = Math.max(1, Math.min(999, parseInt(vipMatch[2], 10) || 1));
    const lIdx = (lets.charCodeAt(0) - 65) * 676 + (lets.charCodeAt(1) - 65) * 26 + (lets.charCodeAt(2) - 65);
    return ((lIdx * 999) + (num - 1)) >>> 0;
  }
  return encodeFisherIdTo32Bit('FP_89AAA001');
}
export function decodeFisherIdFrom32Bit(val32) {
  const v = (Number(val32) >>> 0) & 0x7fffffff;
  const num = (v % 999) + 1;
  const rem = Math.floor(v / 999);
  const lIdx = rem % 17576;
  const reg = Math.floor(rem / 17576);
  const c1 = String.fromCharCode(65 + (Math.floor(lIdx / 676) % 26));
  const c2 = String.fromCharCode(65 + (Math.floor(lIdx / 26) % 26));
  const c3 = String.fromCharCode(65 + (lIdx % 26));
  const numStr = String(num).padStart(3, '0');
  if (reg <= 0) {
    return `FP_${c1}${c2}${c3}${numStr}`;
  }
  return `FP_${String(Math.min(99, reg)).padStart(2, '0')}${c1}${c2}${c3}${numStr}`;
}
export function parseFisherIdTo20Bit(fisherIdStr = '') {
  return encodeFisherIdTo32Bit(fisherIdStr);
}
export function formatFisherIdFrom20Bit(val20) {
  const clean = (Number(val20) || 0) & 0xfffff;
  if (clean === 0x89a01) return OWNER_BOUND_FISHER_ID;
  return formatFisherIdFromIndex('89', clean % 99999);
}
/**
 * Проверяет логин и пароль рыбака; распознаёт постоянный аккаунт Владельца (iAthor82 / FISherman1982* -> FP_FMP089)
 * и детерминированно/последовательно формирует региональный ID рыбака (FP_<RR><AAA><001..999>).
 */
export function resolveAccountCredentials(rawLogin = '', rawPassword = '', preferredRegionCode = null) {
  const loginClean = String(rawLogin || '').trim().slice(0, 48);
  const loginNorm = loginClean.toLowerCase().replace(/^@/, '');
  const passClean = String(rawPassword || '').trim();
  const isOwnerMatch = (
    (loginNorm === 'iathor82' || loginNorm === 'iathor' || loginNorm === 'thorantony82') &&
    (passClean === 'FISherman1982*' || passClean.toLowerCase() === 'fisherman1982*')
  );
  if (isOwnerMatch) {
    return {
      ok: true,
      isOwner: true,
      login: OWNER_BOUND_LOGIN,
      callsign: OWNER_BOUND_LOGIN,
      fisherId: OWNER_BOUND_FISHER_ID,
      pinHash: OWNER_BOUND_PIN_HASH,
      authTokenHash: deriveSecureAuthToken(OWNER_BOUND_LOGIN, 'FISherman1982*')
    };
  }
  if (!loginNorm || passClean.length < 3) {
    return { ok: false, error: 'Введите логин и пароль (минимум 3 символа)' };
  }
  const pinHash = fnv1a32(`pin::${passClean}`).toString(16);
  const authTokenHash = deriveSecureAuthToken(loginNorm, passClean);
  const regCode = preferredRegionCode || resolveRussianRegionCode();
  const seed = `${loginNorm}:${pinHash}`;
  const detIdx = fnv1a32(seed) % (26 * 999);
  const fisherId = formatFisherIdFromIndex(regCode, detIdx);
  return {
    ok: true,
    isOwner: false,
    login: loginClean,
    callsign: loginClean,
    fisherId,
    pinHash,
    authTokenHash,
    regionCode: regCode
  };
}
/**
 * Проверяет, является ли текущий пользователь Владельцем (Супер-Админом Антоном: iAthor82 / FP_FMP089)
 */
export function isOwnerAdmin(stateObj = null) {
  const s = stateObj || store.getState();
  const up = s?.userProfile || {};
  if (up.ownerUnlocked === true) return true;
  if (['FP_FMP089', 'FP_FMP089'].includes(String(up.fisherId || '').toUpperCase()) && up.pinHash === OWNER_BOUND_PIN_HASH) return true;
  const loginNorm = String(up.login || up.callsign || '').trim().toLowerCase();
  if (loginNorm === 'iathor82' && up.pinHash === OWNER_BOUND_PIN_HASH) return true;
  const tgUser = getTelegramUser();
  const uname = String(tgUser?.username || up.tgUsername || '').toLowerCase().replace(/^@/, '');
  if (uname && OWNER_TG_USERNAMES.includes(uname)) return true;
  return false;
}
/**
 * Возвращает полный список администраторов из базы (Владелец + добавленные им в базу рыбаки)
 */
export function getAdminWhitelistEntries(stateObj = null) {
  const s = stateObj || store.getState();
  const up = s?.userProfile || {};
  const list = Array.isArray(up.adminWhitelist) ? up.adminWhitelist : [];
  const map = new Map();
  for (const defId of DEFAULT_ADMIN_IDS) {
    map.set(defId, { id: defId, label: 'Владелец (Супер-Админ)', addedAt: '2026-10-25' });
  }
  if (up.ownerUnlocked && up.fisherId) {
    const myId = String(up.fisherId).toUpperCase();
    map.set(myId, { id: myId, label: `${up.callsign || 'Антон'} (Владелец)`, addedAt: '2026-10-26' });
  }
  for (const item of list) {
    if (item && item.id) {
      const cleanId = String(item.id).trim().toUpperCase();
      map.set(cleanId, {
        id: cleanId,
        label: item.label || 'Модератор Круга',
        addedAt: item.addedAt || ''
      });
    }
  }
  return Array.from(map.values());
}
/**
 * Проверяет, имеет ли текущий пользователь права Администратора
 * (Владелец ИЛИ рыбак, чей ID FP_89AAA001 / @username добавлен Владельцем в Базу Администраторов)
 */
export function isUserAdmin(stateObj = null) {
  const s = stateObj || store.getState();
  const up = s?.userProfile || {};
  if (up.adminShowAllCrews === false) return false;
  if (isOwnerAdmin(s)) return true;
  const myFisherId = String(up.fisherId || '').trim().toUpperCase();
  const tgUser = getTelegramUser();
  const myUname = String(tgUser?.username || up.tgUsername || '').trim().toUpperCase().replace(/^@/, '');
  const whitelist = getAdminWhitelistEntries(s);
  return whitelist.some(entry => {
    const eid = String(entry.id || '').trim().toUpperCase().replace(/^@/, '');
    return (myFisherId && eid === myFisherId) || (myUname && eid === myUname);
  });
}
/**
 * Возвращает текущую учётную запись рыбака (Позывной, детерминированный Рыболовный ID FP_89AAA001, статус Админа и привязку ТГ)
 */
export function getCurrentFisherIdentity(stateObj = null) {
  const s = stateObj || store.getState();
  const up = s?.userProfile || {};
  const tgUser = getTelegramUser();
  const devId = storage.getDeviceId ? storage.getDeviceId() : 'dev_local';
  const callsign = (up.callsign && up.callsign !== 'Рыболов')
    ? up.callsign
    : (tgUser?.displayName || up.callsign || 'Рыболов');
  const loginStr = String(up.login || callsign || '').trim();
  const isOwner = isOwnerAdmin(s);
  let fisherId = up.fisherId;
  const regCode = resolveRussianRegionCode(s);
  if (isOwner && (loginStr.toLowerCase() === 'iathor82' || up.pinHash === OWNER_BOUND_PIN_HASH || !fisherId || String(fisherId).toUpperCase() === 'FP_FMP089')) {
    fisherId = OWNER_BOUND_FISHER_ID;
  } else if (!fisherId || !isValidFisherIdFormat(fisherId)) {
    const seed = up.pinHash
      ? `${loginStr.toLowerCase()}:${up.pinHash}`
      : (tgUser?.id ? `tg:${tgUser.id}` : `dev:${devId}`);
    const detIdx = fnv1a32(seed) % (26 * 999);
    fisherId = formatFisherIdFromIndex(regCode, detIdx);
  } else {
    fisherId = normalizeFisherId(fisherId, regCode);
  }
  return {
    callsign: isOwner && (!up.callsign || up.callsign === 'Рыболов') ? OWNER_BOUND_LOGIN : callsign,
    login: up.login || (up.pinHash ? callsign : ''),
    fisherId,
    deviceId: devId,
    isAuthenticated: Boolean(up.pinHash || tgUser?.id || up.tgLinkedId),
    isOwner: isOwnerAdmin(s),
    isAdmin: isUserAdmin(s),
    tgLinkedId: tgUser?.id || up.tgLinkedId || '',
    tgUsername: tgUser?.username || up.tgUsername || '',
    unlockedCrewKeys: Array.isArray(up.unlockedCrewKeys) ? up.unlockedCrewKeys : [],
    hiddenCircleIds: Array.isArray(up.hiddenCircleIds) ? up.hiddenCircleIds : [],
    notifSettings: {
      sos: true,
      crew: true,
      circle: true,
      workshop: true,
      dm: true,
      sound: true,
      ...(up.notifSettings || {})
    }
  };
}
/**
 * Проверяет, принадлежит ли точка/событие текущему рыбаку («👤 МОИ» vs «🌐 ЧУЖИЕ»)
 */
export function isCircleItemMine(item, stateObj = null) {
  if (!item) return false;
  if (item.isDemoSeed || item.isLockedExternalCrew) return false;
  const s = stateObj || store.getState();
  const ident = getCurrentFisherIdentity(s);
  if (item.fid && String(item.fid).toUpperCase() === String(ident.fisherId).toUpperCase()) {
    return true;
  }
  if (!item.importedAt && item.did && item.did === ident.deviceId && item.did !== 'ext_v3' && item.did !== 'ext') {
    return true;
  }
  return false;
}
/**
 * Проверяет, скрыта ли чужая точка/событие пользователем
 */
export function isCircleItemHidden(item, stateObj = null) {
  if (!item || !item.id) return false;
  const s = stateObj || store.getState();
  const hidden = s?.userProfile?.hiddenCircleIds;
  return Array.isArray(hidden) && hidden.includes(item.id);
}
/**
 * Проверяет доступ к закрытой точке «Экипажа (72 ч)»:
 * - Сигналы SOS видны ВСЕМ.
 * - Сводки Круга и Мастерской видны всем.
 * - Закрытые Экипажи видны ТОЛЬКО создателю, участникам с ключом KP-XXXX и Администраторам из базы!
 */
export function canUserAccessCrewItem(item, stateObj = null) {
  if (!item) return false;
  if (item.t !== 'crew') return true;
  if (item.sos) return true;
  const s = stateObj || store.getState();
  if (isUserAdmin(s)) return true;
  if (isCircleItemMine(item, s)) return true;
  const ident = getCurrentFisherIdentity(s);
  const itemKey = String(item.crewKey || '').toUpperCase();
  const unlocked = ident.unlockedCrewKeys.map(k => String(k).toUpperCase());
  if (itemKey && unlocked.includes(itemKey)) return true;
  if (item.id && unlocked.includes(String(item.id).toUpperCase())) return true;
  return false;
}
/**
 * Синхронизация базы администраторов с Cloudflare Worker (/admin/whitelist)
 */
export async function syncAdminWhitelistWithCloud(pushChange = null) {
  try {
    if (pushChange && isOwnerAdmin()) {
      const res = await fetch(`${RELAY_WORKER_URL}/admin/whitelist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerSecret: 'KLEV-ADMIN-89',
          action: pushChange.action || 'set',
          entry: pushChange.entry || null,
          targetId: pushChange.targetId || '',
          list: getAdminWhitelistEntries()
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.whitelist)) {
          store.dispatch({ type: 'SET_ADMIN_WHITELIST', payload: data.whitelist });
        }
      }
      return true;
    }
    const res = await fetch(`${RELAY_WORKER_URL}/admin/whitelist`, { method: 'GET' });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.whitelist) && data.whitelist.length > 0) {
        const local = store.getState().userProfile?.adminWhitelist || [];
        const mergedMap = new Map();
        [...local, ...data.whitelist].forEach(it => {
          if (it && it.id) mergedMap.set(String(it.id).toUpperCase(), it);
        });
        store.dispatch({ type: 'SET_ADMIN_WHITELIST', payload: Array.from(mergedMap.values()) });
      }
    }
    return true;
  } catch (e) {
    return false;
  }
}
/**
 * Клиентское сквозное шифрование (E2EE) сообщений чата рыбаков и экипажа.
 */
/**
 * Формирует слепок настроек профиля и рыбалки для межплатформенной облачной синхронизации
 */
export function buildProfileCloudSnapshot(stateObj = null) {
  const s = stateObj || store.getState();
  const ident = getCurrentFisherIdentity(s);
  const up = s?.userProfile || {};
  return {
    fisherId: ident.fisherId,
    login: ident.login || ident.callsign,
    callsign: ident.callsign,
    pinHash: up.pinHash || '',
    ownerUnlocked: Boolean(up.ownerUnlocked || ident.isOwner),
    adminShowAllCrews: up.adminShowAllCrews !== false,
    adminWhitelist: Array.isArray(up.adminWhitelist) ? up.adminWhitelist : [],
    unlockedCrewKeys: Array.isArray(up.unlockedCrewKeys) ? up.unlockedCrewKeys : [],
    notifSettings: ident.notifSettings,
    appMode: s.appMode || 'angler',
    theme: s.theme || 'auto',
    lat: s.lat,
    lon: s.lon,
    locLabel: s.locLabel,
    locAdmin1: s.locAdmin1,
    locAdmin2: s.locAdmin2,
    water: s.water,
    method: s.method,
    preferredWaters: up.preferredWaters || [s.water],
    preferredMethods: up.preferredMethods || [s.method],
    favorites: Array.isArray(s.favorites) ? s.favorites : [],
    savedSpots: Array.isArray(s.savedSpots) ? s.savedSpots.slice(0, 50) : [],
    updatedAt: Date.now()
  };
}
/**
 * Применяет загруженный из облака профиль к текущему устройству (браузер, APK, Telegram Mini App)
 */
export function applyCloudProfileToDevice(cloudProf, whitelist = null) {
  if (!cloudProf || typeof cloudProf !== 'object') return;
  const s = store.getState();
  const prevUp = s.userProfile || {};
  const mergedKeys = Array.from(new Set([
    ...(Array.isArray(prevUp.unlockedCrewKeys) ? prevUp.unlockedCrewKeys : []),
    ...(Array.isArray(cloudProf.unlockedCrewKeys) ? cloudProf.unlockedCrewKeys : [])
  ]));
  store.dispatch({
    type: 'UPDATE_USER_PROFILE',
    payload: {
      onboarded: true,
      login: cloudProf.login || prevUp.login || cloudProf.callsign || 'Рыболов',
      callsign: cloudProf.callsign || prevUp.callsign || 'Рыболов',
      fisherId: cloudProf.fisherId || prevUp.fisherId,
      pinHash: cloudProf.pinHash || prevUp.pinHash,
      ownerUnlocked: Boolean(cloudProf.ownerUnlocked || prevUp.ownerUnlocked),
      adminShowAllCrews: cloudProf.adminShowAllCrews !== undefined ? Boolean(cloudProf.adminShowAllCrews) : true,
      unlockedCrewKeys: mergedKeys,
      preferredWater: cloudProf.water || prevUp.preferredWater || s.water,
      preferredMethod: cloudProf.method || prevUp.preferredMethod || s.method,
      preferredWaters: Array.isArray(cloudProf.preferredWaters) ? cloudProf.preferredWaters : (prevUp.preferredWaters || [s.water]),
      preferredMethods: Array.isArray(cloudProf.preferredMethods) ? cloudProf.preferredMethods : (prevUp.preferredMethods || [s.method]),
      notifSettings: {
        ...(prevUp.notifSettings || {}),
        ...(cloudProf.notifSettings || {})
      }
    }
  });
  if (Array.isArray(whitelist) && whitelist.length > 0) {
    store.dispatch({ type: 'SET_ADMIN_WHITELIST', payload: whitelist });
  } else if (Array.isArray(cloudProf.adminWhitelist) && cloudProf.adminWhitelist.length > 0) {
    store.dispatch({ type: 'SET_ADMIN_WHITELIST', payload: cloudProf.adminWhitelist });
  }
  if (Array.isArray(cloudProf.favorites) && cloudProf.favorites.length > 0 && (!s.favorites || s.favorites.length === 0)) {
    store.dispatch({ type: 'SET_FAVORITES_LIST', payload: cloudProf.favorites });
  }
  if (Array.isArray(cloudProf.savedSpots) && cloudProf.savedSpots.length > 0) {
    const curSpots = Array.isArray(s.savedSpots) ? s.savedSpots : [];
    const spotMap = new Map();
    [...curSpots, ...cloudProf.savedSpots].forEach(sp => {
      if (sp && sp.id) spotMap.set(sp.id, sp);
    });
    const mergedSpots = Array.from(spotMap.values());
    storage.saveSpots(mergedSpots);
    store.dispatch({ type: 'SET_SAVED_SPOTS', payload: mergedSpots });
  }
  if (cloudProf.appMode && ['novice', 'angler', 'pro'].includes(cloudProf.appMode)) {
    store.dispatch({ type: 'SET_APP_MODE', payload: cloudProf.appMode });
  }
}
/**
 * Выполняет вход или синхронизацию профиля по Логину и Паролю между всеми устройствами (APK, Браузер, TG Mini App)
 */
export async function authenticateAndSyncAccount(rawLogin, rawPassword, mode = 'login') {
  const s = store.getState();
  const regCode = resolveRussianRegionCode(s);
  const creds = resolveAccountCredentials(rawLogin, rawPassword, regCode);
  if (!creds.ok) {
    return { ok: false, error: creds.error || 'Укажите логин и пароль' };
  }
  const tgUser = getTelegramUser();
  const prevUp = s.userProfile || {};
  let effectiveFisherId = creds.fisherId;
  if (!creds.isOwner && prevUp.login && prevUp.login.toLowerCase() === creds.login.toLowerCase() && isValidFisherIdFormat(prevUp.fisherId)) {
    effectiveFisherId = normalizeFisherId(prevUp.fisherId, regCode);
  }
  store.dispatch({
    type: 'UPDATE_USER_PROFILE',
    payload: {
      onboarded: true,
      login: creds.login,
      callsign: creds.callsign,
      fisherId: effectiveFisherId,
      pinHash: creds.pinHash,
      authTokenHash: creds.authTokenHash,
      authShadow: '',
      ownerUnlocked: creds.isOwner ? true : Boolean(prevUp.ownerUnlocked),
      adminShowAllCrews: creds.isOwner ? true : (prevUp.adminShowAllCrews !== false),
      tgLinkedId: tgUser?.id || prevUp.tgLinkedId || '',
      tgUsername: tgUser?.username || prevUp.tgUsername || ''
    }
  });
  if (creds.isOwner) {
    store.dispatch({
      type: 'ADD_ADMIN_TO_WHITELIST',
      payload: { id: OWNER_BOUND_FISHER_ID, label: 'iAthor82 • Антон (Владелец / Супер-Админ)' }
    });
  }
  const snapshot = buildProfileCloudSnapshot(store.getState());
  syncToTelegramCloud('klev_auth_v2', snapshot);
  let cloudSynced = false;
  let finalFisherId = effectiveFisherId;
  try {
    const endpoint = mode === 'sync' ? '/auth/sync' : '/auth/login';
    const res = await fetch(`${RELAY_WORKER_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: creds.login,
        authTokenHash: creds.authTokenHash,
        pinHash: creds.pinHash,
        regionCode: regCode,
        profileSnapshot: snapshot
      })
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.ok && data.profile) {
        if (data.fisherId) {
          finalFisherId = normalizeFisherId(data.fisherId, regCode);
          data.profile.fisherId = finalFisherId;
        }
        applyCloudProfileToDevice(data.profile, data.whitelist);
        cloudSynced = true;
      }
    }
  } catch (e) {}
  return {
    ok: true,
    isOwner: creds.isOwner,
    fisherId: finalFisherId,
    login: creds.login,
    callsign: creds.callsign,
    cloudSynced
  };
}
/**
 * Фоновая синхронизация изменений профиля в облако по крипто-токену authTokenHash (без хранения открытого пароля)
 */
export async function syncCurrentProfileToCloudIfLoggedIn() {
  const s = store.getState();
  const up = s?.userProfile || {};
  const tokenHash = up.authTokenHash || '';
  const login = up.login || up.callsign || '';
  if (!tokenHash || !login || login === 'Рыболов') {
    syncToTelegramCloud('klev_auth_v2', buildProfileCloudSnapshot(s));
    return false;
  }
  const snapshot = buildProfileCloudSnapshot(s);
  syncToTelegramCloud('klev_auth_v2', snapshot);
  try {
    const res = await fetch(`${RELAY_WORKER_URL}/auth/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login,
        authTokenHash: tokenHash,
        pinHash: up.pinHash || '',
        regionCode: resolveRussianRegionCode(s),
        profileSnapshot: snapshot
      })
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.ok && data.profile) {
        applyCloudProfileToDevice(data.profile, data.whitelist);
        return true;
      }
    }
  } catch (e) {}
  return false;
}
/**
 * Генерирует компактную шапку-переключатель между 4 раздельными подменю настроек:
 * 1) 🔐 Вход и ID | 2) 🎣 Рыбалка | 3) ⚙️ Параметры | 4) 🔔 Уведомления
 */
export function renderSettingsZoneTabsHtml(activeZone = 'auth') {
  const zones = [
    { id: 'auth', icon: '🔐', label: 'Вход и ID' },
    { id: 'fishing', icon: '🎣', label: 'Рыбалка' },
    { id: 'app', icon: '⚙️', label: 'Параметры' },
    { id: 'notif', icon: '🔔', label: 'Уведомления' }
  ];
  return `
    <div class="settings-zone-bar" role="tablist" aria-label="Зоны настроек">
      ${zones.map(z => `
        <button type="button" class="btn btn-sm settings-zone-tab ${activeZone === z.id ? 'btn-accent' : ''}" data-switch-settings-zone="${z.id}" role="tab" aria-selected="${activeZone === z.id ? 'true' : 'false'}">
          <span>${z.icon}</span>
          <span>${z.label}</span>
        </button>
      `).join('')}
    </div>
  `;
}
export function bindSettingsZoneTabs(bodyEl) {
  if (!bodyEl) return;
  bodyEl.querySelectorAll('[data-switch-settings-zone]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const targetZone = btn.getAttribute('data-switch-settings-zone');
      if (typeof window !== 'undefined' && typeof window.__KLEV_OPEN_SETTINGS_ZONE__ === 'function') {
        window.__KLEV_OPEN_SETTINGS_ZONE__(targetZone);
      }
    });
  });
}
export function encryptChatPayload(plainObj, channelKey = 'default') {
  const jsonStr = JSON.stringify(plainObj || {});
  const utf8 = new TextEncoder().encode(jsonStr);
  const keyBytes = new TextEncoder().encode(`${CIPHER_SALT}::${String(channelKey).toUpperCase()}`);
  const out = new Uint8Array(utf8.length);
  let rolling = fnv1a32(channelKey) & 0xff;
  for (let i = 0; i < utf8.length; i++) {
    const k = keyBytes[i % keyBytes.length] ^ ((i * 53 + rolling) & 0xff);
    out[i] = utf8[i] ^ k;
    rolling = (rolling + out[i] + 17) & 0xff;
  }
  let bin = '';
  for (let i = 0; i < out.length; i++) bin += String.fromCharCode(out[i]);
  const b64 = (typeof btoa === 'function' ? btoa(bin) : Buffer.from(out).toString('base64'))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${E2E_PREFIX}${b64}`;
}
export function decryptChatPayload(cipherStr, channelKey = 'default') {
  if (!cipherStr || typeof cipherStr !== 'string') return null;
  const clean = cipherStr.trim();
  const rawB64 = clean.startsWith(E2E_PREFIX) ? clean.slice(E2E_PREFIX.length) : clean;
  try {
    let b64 = rawB64.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';
    let bytes;
    if (typeof atob === 'function') {
      const bin = atob(b64);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else {
      bytes = new Uint8Array(Buffer.from(b64, 'base64'));
    }
    const keyBytes = new TextEncoder().encode(`${CIPHER_SALT}::${String(channelKey).toUpperCase()}`);
    const plain = new Uint8Array(bytes.length);
    let rolling = fnv1a32(channelKey) & 0xff;
    for (let i = 0; i < bytes.length; i++) {
      const k = keyBytes[i % keyBytes.length] ^ ((i * 53 + rolling) & 0xff);
      plain[i] = bytes[i] ^ k;
      rolling = (rolling + bytes[i] + 17) & 0xff;
    }
    const text = new TextDecoder().decode(plain);
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}
export function playNotificationPing(kind = 'normal') {
  try {
    const st = store.getState();
    if (st?.userProfile?.notifSettings?.sound === false) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;
    if (kind === 'sos') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.setValueAtTime(660, now + 0.14);
      osc.frequency.setValueAtTime(880, now + 0.28);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      osc.start(now);
      osc.stop(now + 0.46);
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.18);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      osc.start(now);
      osc.stop(now + 0.25);
    }
  } catch (e) {}
}
/**
 * Обновляет бейджи непрочитанных событий на нижней вкладке «👥 Круг» и непрочитанных сообщений на вкладке «💬 Чаты»
 */
export function syncCircleNavBadge() {
  if (typeof document === 'undefined') return;
  try {
    const s = store.getState();
    const unreadNotifs = (s.notifications || []).filter(n => n && !n.read).length;
    const unreadChats = (s.chatMessages || []).filter(m => m && m.unread).length;
    const applyBadgeToTab = (tabName, badgeId, count) => {
      const navBtn = document.querySelector(`[data-nav-tab="${tabName}"]`);
      if (!navBtn) return;
      navBtn.style.position = 'relative';
      let badge = document.getElementById(badgeId);
      if (count <= 0) {
        if (badge) badge.style.display = 'none';
        return;
      }
      if (!badge) {
        badge = document.createElement('span');
        badge.id = badgeId;
        badge.style.cssText = 'position:absolute;top:2px;right:10%;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:var(--bad);color:#fff;font-size:10px;font-weight:900;display:inline-flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.45);pointer-events:none;';
        navBtn.appendChild(badge);
      }
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.style.display = 'inline-flex';
    };
    applyBadgeToTab('circle', 'circleNavBadge', unreadNotifs);
    applyBadgeToTab('chats', 'chatsNavBadge', unreadChats);
  } catch (e) {}
}
export function pushAppNotification({ category = 'circle', title = '', body = '', subTab = 'radar', channelId = '', lat = null, lon = null, silentToast = false }) {
  const s = store.getState();
  const ident = getCurrentFisherIdentity(s);
  const prefs = ident.notifSettings;
  if (category === 'sos' && prefs.sos === false) return null;
  if (category === 'crew' && prefs.crew === false) return null;
  if (category === 'circle' && prefs.circle === false) return null;
  if (category === 'workshop' && prefs.workshop === false) return null;
  if (category === 'dm' && prefs.dm === false) return null;
  const notif = {
    id: `ntf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    category,
    title: title || 'Новое событие в Круге',
    body: body || '',
    subTab,
    channelId,
    lat,
    lon,
    ts: Date.now(),
    read: false
  };
  const prevList = Array.isArray(s.notifications) ? s.notifications : [];
  const nextList = [notif, ...prevList].slice(0, 80);
  storage.saveNotifications(nextList);
  store.dispatch({ type: 'SET_NOTIFICATIONS', payload: nextList });
  playNotificationPing(category === 'sos' ? 'sos' : 'normal');
  triggerHaptic(category === 'sos' ? 'error' : 'light');
  syncCircleNavBadge();
  if (!silentToast) {
    const tone = category === 'sos' ? 'bad' : (category === 'crew' || category === 'dm' ? 'good' : 'info');
    showToast(`🔔 ${notif.title}: ${notif.body}`, tone);
  }
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(notif.title, { body: notif.body, icon: 'icon-192.png' });
    }
  } catch (e) {}
  return notif;
}
export function getEffectiveCircleRadiusKm(item, nowMs = Date.now()) {
  const baseRadius = Number(item?.br) || CIRCLE_BLUR_RADIUS_KM;
  const createdMs = Number(item?.ca) || nowMs;
  const ageHours = Math.max(0, (nowMs - createdMs) / 3600000);
  if (ageHours >= 24) {
    return Math.max(baseRadius, CIRCLE_OLDER_BLUR_RADIUS_KM);
  }
  return baseRadius;
}
export function computeHexPolygonForCircle(lat, lon, radiusKm = 5.0, seedStr = '') {
  const gridLatStep = 0.045;
  const cosLat = Math.max(0.22, Math.cos((lat * Math.PI) / 180));
  const gridLonStep = 0.045 / cosLat;
  const cellLat = Math.round(lat / gridLatStep) * gridLatStep;
  const cellLon = Math.round(lon / gridLonStep) * gridLonStep;
  const seedInput = `${cellLat.toFixed(3)}_${cellLon.toFixed(3)}_${seedStr || 'hex'}`;
  const unsigned = fnv1a32(seedInput);
  const rotationDeg = (unsigned % 60) - 30;
  const vertices = [];
  for (let k = 0; k < 6; k++) {
    const baseAngleDeg = k * 60 + rotationDeg;
    const rad = (baseAngleDeg * Math.PI) / 180;
    const jitter = 0.88 + (((unsigned >>> (k * 4)) & 0x0f) / 15) * 0.20;
    const rKm = radiusKm * jitter;
    const vLat = Math.round((cellLat + (rKm * Math.cos(rad)) / 111.32) * 10000) / 10000;
    const vLon = Math.round((cellLon + (rKm * Math.sin(rad)) / (111.32 * cosLat)) * 10000) / 10000;
    vertices.push([vLat, vLon]);
  }
  return {
    cellLat: Math.round(cellLat * 1000) / 1000,
    cellLon: Math.round(cellLon * 1000) / 1000,
    vertices
  };
}
export function blurCoordsForCircle(lat, lon, seedStr = '') {
  const seedInput = `${lat.toFixed(3)}_${lon.toFixed(3)}_${seedStr || 'klev'}`;
  const unsigned = fnv1a32(seedInput);
  const angleRad = ((unsigned % 360) * Math.PI) / 180;
  const offsetKm = 1.4 + ((unsigned >>> 8) % 150) / 100;
  const dLat = (offsetKm * Math.cos(angleRad)) / 111.32;
  const cosLat = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const dLon = (offsetKm * Math.sin(angleRad)) / (111.32 * cosLat);
  const shiftedLat = lat + dLat;
  const shiftedLon = lon + dLon;
  const hex = computeHexPolygonForCircle(shiftedLat, shiftedLon, CIRCLE_BLUR_RADIUS_KM, seedStr);
  return {
    blurredLat: Math.round(shiftedLat * 1000) / 1000,
    blurredLon: Math.round(shiftedLon * 1000) / 1000,
    cellLat: hex.cellLat,
    cellLon: hex.cellLon,
    polygon: hex.vertices,
    blurRadiusKm: CIRCLE_BLUR_RADIUS_KM,
    offsetKm: Math.round(offsetKm * 10) / 10
  };
}
export function getUserExpertRank(catches = []) {
  const list = Array.isArray(catches) ? catches : [];
  const total = list.length;
  if (total === 0) {
    return {
      tier: 'new',
      badge: '🟢 Участник Круга',
      weight: 0.75,
      matchRate: 0,
      totalCatches: 0
    };
  }
  const matched = list.filter(c => c && c.matchedForecast !== false).length;
  const matchRate = Math.round((matched / total) * 100);
  if (total >= 5 && matchRate >= 80) {
    return {
      tier: 'expert',
      badge: `🏅 Эксперт Круга (${matchRate}%)`,
      weight: 1.5,
      matchRate,
      totalCatches: total
    };
  }
  if (total >= 2 && matchRate >= 60) {
    return {
      tier: 'angler',
      badge: `🎣 Опытный рыбак (${matchRate}%)`,
      weight: 1.0,
      matchRate,
      totalCatches: total
    };
  }
  return {
    tier: 'new',
    badge: `🟢 Рыболов (${matchRate}%)`,
    weight: 0.75,
    matchRate,
    totalCatches: total
  };
}
export function evaluateWorkshopRigMatch(rigItem, currentWaterType, currentDepth, currentWaterTemp, currentPress) {
  if (!rigItem) return { isMatch: false, score: 0, reasons: [] };
  let score = 100;
  const reasons = [];
  const rigWT = Number.isFinite(rigItem.tw) ? rigItem.tw : 10;
  const tempMin = Number.isFinite(rigItem.twMin) ? rigItem.twMin : (rigWT - 4.5);
  const tempMax = Number.isFinite(rigItem.twMax) ? rigItem.twMax : (rigWT + 4.5);
  if (currentWaterTemp >= tempMin && currentWaterTemp <= tempMax) {
    reasons.push(`💧 Вода ${currentWaterTemp}°C входит в рабочий коридор (${tempMin.toFixed(0)}..${tempMax.toFixed(0)}°C)`);
  } else {
    const diff = Math.min(Math.abs(currentWaterTemp - tempMin), Math.abs(currentWaterTemp - tempMax));
    score -= Math.min(45, Math.round(diff * 6));
  }
  if (rigItem.wt && rigItem.wt === currentWaterType) {
    reasons.push('🌊 Точное совпадение типа водоёма и течения');
  } else {
    score -= 15;
  }
  const rigDepth = Number.isFinite(rigItem.dp) ? rigItem.dp : currentDepth;
  if (Math.abs(rigDepth - currentDepth) <= 2.0) {
    reasons.push(`📏 Близкий горизонт глубины (~${rigDepth} м)`);
  } else {
    score -= 15;
  }
  return {
    isMatch: score >= 65,
    score: Math.max(10, score),
    tempRangeText: `${Math.max(0, Math.round(tempMin))}–${Math.round(tempMax)}°C`,
    reasons
  };
}
/**
 * Ультракомпактный бинарный упаковщик V3 со встроенным 20-битным Рыболовным ID (FP_89AAA001):
 * Фиксированный заголовок 21 байт = 28 символов Base64url (без знаков '='),
 * сохраняет точный ID рыбака (FP_89AAA001) во всех точках Круга, Экипажа, SOS и Мастерской!
 */
export function encodeSharePack(payloadObj) {
  const p = payloadObj || {};
  const ident = getCurrentFisherIdentity();
  const modeCode = p.sos ? 2 : (p.t === 'crew' ? 1 : (p.t === 'workshop' ? 3 : 0));
  const fiIdx = Math.max(0, Math.min(255, FISH_DB.findIndex(f => f.id === p.fi)));
  const wtIdx = Math.max(0, PACK_WATER_KEYS.indexOf(p.wt || 'small_river'));
  const mtIdx = Math.max(0, PACK_METHOD_KEYS.indexOf(p.mt || 'spin_jig'));
  const latVal = modeCode === 3 ? 0 : (Number(p.lat) || 0);
  const lonVal = modeCode === 3 ? 0 : (Number(p.lon) || 0);
  const latInt = Math.max(0, Math.min(1800000, Math.round((latVal + 90) * 10000)));
  const lonInt = Math.max(0, Math.min(3600000, Math.round((lonVal + 180) * 10000)));
  const dpByte = Math.max(0, Math.min(255, Math.round((Number(p.dp) || 2) * 4)));
  const twByte = Math.max(0, Math.min(255, Math.round(((Number(p.tw ?? 10)) + 5) * 6)));
  const prByte = Math.max(0, Math.min(255, Math.round((Number(p.pr) || 754) - 650)));
  const tsRelMin = Math.max(0, Math.floor(((Number(p.ca) || Date.now()) - EPOCH_2024_MS) / 60000)) & 0xffffff;
  const rkFlags = (p.rk === 'expert' ? 2 : (p.rk === 'angler' ? 1 : 0)) + (p.isDemoSeed ? 8 : 0);
  let meta16 = 0;
  if (modeCode === 1) {
    meta16 = computeCrewKeyHash(p.crewKey || p.id || `${latInt}_${lonInt}`);
  } else if (modeCode === 0) {
    meta16 = Math.max(0, Math.min(65535, Math.round((Number(p.kg) || 0) * 100)));
  } else {
    meta16 = computeCrewKeyHash(p.id || `${tsRelMin}`);
  }
  const fid32 = encodeFisherIdTo32Bit(p.fid || ident.fisherId);
  const customNoteClean = p._hasCustomNote ? String(p.nt || '').trim().slice(0, 48) : '';
  const tailBytes = customNoteClean ? new TextEncoder().encode(customNoteClean) : new Uint8Array(0);
  const hasTail = tailBytes.length > 0 ? 1 : 0;
  const rawBuf = new Uint8Array(22 + tailBytes.length);
  rawBuf[0] = 0xb3;
  rawBuf[1] = (modeCode & 0x03) | ((rkFlags & 0x0f) << 2) | (hasTail << 6) | 0x80;
  rawBuf[2] = fiIdx & 0xff;
  rawBuf[3] = (wtIdx & 0x07) | ((mtIdx & 0x0f) << 3) | 0x80;
  rawBuf[4] = (latInt >>> 16) & 0xff;
  rawBuf[5] = (latInt >>> 8) & 0xff;
  rawBuf[6] = latInt & 0xff;
  rawBuf[7] = (lonInt >>> 16) & 0xff;
  rawBuf[8] = (lonInt >>> 8) & 0xff;
  rawBuf[9] = lonInt & 0xff;
  rawBuf[10] = dpByte;
  rawBuf[11] = twByte;
  rawBuf[12] = prByte;
  rawBuf[13] = (tsRelMin >>> 16) & 0xff;
  rawBuf[14] = (tsRelMin >>> 8) & 0xff;
  rawBuf[15] = tsRelMin & 0xff;
  rawBuf[16] = (meta16 >>> 8) & 0xff;
  rawBuf[17] = meta16 & 0xff;
  rawBuf[18] = (fid32 >>> 24) & 0x7f;
  rawBuf[19] = (fid32 >>> 16) & 0xff;
  rawBuf[20] = (fid32 >>> 8) & 0xff;
  rawBuf[21] = fid32 & 0xff;
  if (tailBytes.length > 0) {
    rawBuf.set(tailBytes, 22);
  }
  const saltBytes = new TextEncoder().encode(CIPHER_SALT);
  const out = new Uint8Array(rawBuf.length);
  for (let i = 0; i < rawBuf.length; i++) {
    out[i] = rawBuf[i] ^ saltBytes[i % saltBytes.length] ^ ((i * 31) & 0xff);
  }
  let bin = '';
  for (let i = 0; i < out.length; i++) {
    bin += String.fromCharCode(out[i]);
  }
  const b64 = typeof btoa === 'function'
    ? btoa(bin)
    : Buffer.from(out).toString('base64');
  const b64url = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${PACK_PREFIX}${b64url}`;
}
/**
 * Декодирует токен KP1_... (поддерживает V3 с 20-битным ID рыбака, V3 18-байтный, V2 и V1)
 */
export function decodeSharePack(rawInput) {
  if (!rawInput || typeof rawInput !== 'string') return null;
  const trimmed = rawInput.trim();
  const match = trimmed.match(/KP1_[A-Za-z0-9_-]+/);
  const token = match ? match[0] : (trimmed.startsWith(PACK_PREFIX) ? trimmed : null);
  if (!token) return null;
  try {
    const b64url = token.slice(PACK_PREFIX.length);
    let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';
    let bytes;
    if (typeof atob === 'function') {
      const bin = atob(b64);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else {
      bytes = new Uint8Array(Buffer.from(b64, 'base64'));
    }
    const saltBytes = new TextEncoder().encode(CIPHER_SALT);
    const plainBytes = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      plainBytes[i] = bytes[i] ^ saltBytes[i % saltBytes.length] ^ ((i * 31) & 0xff);
    }
    if (plainBytes.length >= 18 && plainBytes[0] === 0xb3) {
      const b1 = plainBytes[1];
      const modeCode = b1 & 0x03;
      const rkFlags = (b1 >>> 2) & 0x0f;
      const hasTail = Boolean((b1 >>> 6) & 0x01);
      const hasEmbeddedFid = Boolean((b1 & 0x80) && plainBytes.length >= 21);
      const fiIdx = plainBytes[2];
      const wtIdx = plainBytes[3] & 0x07;
      const mtIdx = (plainBytes[3] >>> 3) & 0x0f;
      const latInt = (plainBytes[4] << 16) | (plainBytes[5] << 8) | plainBytes[6];
      const lonInt = (plainBytes[7] << 16) | (plainBytes[8] << 8) | plainBytes[9];
      const lat = modeCode === 3 ? 0 : Math.round(((latInt / 10000) - 90) * 10000) / 10000;
      const lon = modeCode === 3 ? 0 : Math.round(((lonInt / 10000) - 180) * 10000) / 10000;
      const dp = Math.round((plainBytes[10] / 4) * 10) / 10 || 2.0;
      const tw = Math.round(((plainBytes[11] / 6) - 5) * 10) / 10;
      const pr = plainBytes[12] + 650;
      const tsRelMin = (plainBytes[13] << 16) | (plainBytes[14] << 8) | plainBytes[15];
      const ca = tsRelMin > 0 ? (EPOCH_2024_MS + tsRelMin * 60000) : Date.now();
      const ea = ca + CREW_TTL_MS;
      const meta16 = (plainBytes[16] << 8) | plainBytes[17];
      const is32BitFid = Boolean((plainBytes[3] & 0x80) && plainBytes.length >= 22);
      let fid = 'FP_89AAA001';
      let noteOffset = 18;
      if (hasEmbeddedFid && is32BitFid) {
        const fid32 = (((plainBytes[18] & 0x7f) * 16777216) + (plainBytes[19] << 16) + (plainBytes[20] << 8) + plainBytes[21]) >>> 0;
        fid = decodeFisherIdFrom32Bit(fid32);
        noteOffset = 22;
      } else if (hasEmbeddedFid) {
        const fid20 = ((plainBytes[18] & 0x0f) << 16) | (plainBytes[19] << 8) | plainBytes[20];
        fid = formatFisherIdFrom20Bit(fid20);
        noteOffset = 21;
      }
      const customNote = (hasTail && plainBytes.length > noteOffset)
        ? new TextDecoder().decode(plainBytes.slice(noteOffset)).trim()
        : '';
      const fish = FISH_DB[fiIdx] || FISH_DB[0];
      const wt = PACK_WATER_KEYS[wtIdx] || 'small_river';
      const mt = PACK_METHOD_KEYS[mtIdx] || 'spin_jig';
      const prof = WATER_PROFILES[wt] || WATER_PROFILES.small_river;
      const rkNum = rkFlags & 0x03;
      const rk = rkNum === 2 ? 'expert' : (rkNum === 1 ? 'angler' : 'new');
      const rw_w = rk === 'expert' ? 1.5 : (rk === 'angler' ? 1.0 : 0.75);
      const isDemoSeed = Boolean(rkFlags & 0x08);
      const curIdent = getCurrentFisherIdentity();
      const isMyFid = fid === curIdent.fisherId && !isDemoSeed;
      const authorLabel = isMyFid ? curIdent.callsign : `Рыбак ${fid}`;
      let locLabel = 'Точка на воде';
      let waterName = prof.shortName || 'Водоём';
      if (modeCode !== 3 && (lat !== 0 || lon !== 0)) {
        const nearCity = findNearestRussianSettlement(lat, lon);
        if (nearCity) locLabel = nearCity.name;
        const basinCode = detectBasinByCoords(lat, lon);
        const isCoast = isCoastalInBasin(basinCode, lat, lon);
        const nearWaters = getNearestRussianWaters(lat, lon, basinCode, isCoast, 1, 60);
        if (nearWaters && nearWaters.length > 0) {
          waterName = nearWaters[0].name;
        } else {
          waterName = locLabel;
        }
      }
      const iceState = tw <= 1.0 ? 'ice_safe' : 'open_water';
      const seasonalBaits = getSeasonalBaitsForContext(fish, mt, tw, iceState);
      const bt = (seasonalBaits[0] || 'по сезону').split('(')[0].trim();
      const rig = calcDynamicRig(mt, wt, dp, 3, fish, tw, iceState);
      const idPrefix = modeCode === 2 ? 'sos' : (modeCode === 1 ? 'crew' : (modeCode === 3 ? 'ws' : 'cir'));
      const itemId = `${idPrefix}_${tsRelMin.toString(36)}_${fiIdx}_${meta16.toString(16)}`;
      if (modeCode === 2) {
        return {
          t: 'crew',
          sos: true,
          id: itemId,
          did: isMyFid ? curIdent.deviceId : 'ext_v3',
          fid,
          ca,
          ea,
          au: authorLabel,
          rk,
          lb: locLabel,
          wn: waterName,
          wt,
          lat,
          lon,
          dp,
          fi: fish.id,
          fn: fish.name,
          tw,
          pr,
          wnd: 'по метеорадару',
          ice: tw <= 1.0 ? 'Лёд / забереги' : 'Открытая вода',
          nt: customNote || '🆘 ТРЕБУЕТСЯ ПОМОЩЬ НА ВОДЕ / ЛЬДУ! Проверьте мои координаты',
          isDemoSeed
        };
      }
      if (modeCode === 1) {
        const crewKey = formatCrewKeyFromHash(meta16);
        return {
          t: 'crew',
          id: itemId,
          crewKey,
          did: isMyFid ? curIdent.deviceId : 'ext_v3',
          fid,
          ca,
          ea,
          au: authorLabel,
          rk,
          rw_w,
          lb: locLabel,
          wn: waterName,
          wt,
          lat,
          lon,
          dp,
          fi: fish.id,
          fn: fish.name,
          mt,
          bt,
          tw,
          pr,
          nt: customNote || `Точка сбора экипажа ${crewKey} (72 ч)`,
          isDemoSeed
        };
      }
      if (modeCode === 3) {
        const flowLabel = prof.flow >= 1.8 ? 'быстрое течение' : (prof.flow >= 1.1 ? 'умеренное течение' : 'стоячая вода');
        const twMin = Math.max(0.2, Math.round((tw - 3.5) * 10) / 10);
        const twMax = Math.min(28.0, Math.round((tw + 3.5) * 10) / 10);
        return {
          t: 'workshop',
          id: itemId,
          did: isMyFid ? curIdent.deviceId : 'ext_v3',
          fid,
          ca,
          au: authorLabel,
          rk,
          fi: fish.id,
          fn: fish.name,
          wt,
          fl: flowLabel,
          dp,
          mt,
          bt,
          rw: rig.weight,
          rl: rig.line,
          rt: rig.tactic,
          tw,
          twMin,
          twMax,
          pr,
          nt: customNote || `Рабочий монтаж на ${fish.name} (${flowLabel}, вода ${twMin}..${twMax}°C)`,
          isDemoSeed
        };
      }
      const hex = computeHexPolygonForCircle(lat, lon, CIRCLE_BLUR_RADIUS_KM, itemId);
      return {
        t: 'circle',
        id: itemId,
        did: isMyFid ? curIdent.deviceId : 'ext_v3',
        fid,
        ca,
        au: authorLabel,
        rk,
        rw_w,
        lb: locLabel,
        wn: waterName,
        wt,
        lat: hex.cellLat,
        lon: hex.cellLon,
        br: CIRCLE_BLUR_RADIUS_KM,
        poly: hex.vertices,
        dp,
        fi: fish.id,
        fn: fish.name,
        kg: Math.round((meta16 / 100) * 10) / 10,
        mt,
        bt,
        tw,
        pr,
        nt: customNote || `Разведка Круга: ${fish.name}`,
        isDemoSeed
      };
    }
    const jsonStr = new TextDecoder().decode(plainBytes);
    const parsed = JSON.parse(jsonStr);
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.t === 'crew' && !parsed.sos && !parsed.crewKey) {
      parsed.crewKey = formatCrewKeyFromHash(computeCrewKeyHash(parsed.id || 'crew'));
    }
    if (!parsed.fid) {
      parsed.fid = formatFisherIdFrom20Bit(fnv1a32(parsed.did || parsed.au || parsed.id || 'ext'));
    }
    return parsed;
  } catch (e) {
    return null;
  }
}
/**
 * Создаёт зашифрованный пакет и лаконичное сообщение для Telegram с автопривязкой ID рыбака (FP_89AAA001)
 */
export function createSharePackFromContext(mode = 'circle', customNote = '', overrideCatch = null, customCrewKey = '') {
  const s = store.getState();
  const fish = FISH_DB.find(f => f.id === (overrideCatch?.fishId || s.fishId)) || FISH_DB[0];
  const day = s.weatherDays?.[s.dayIdx] || s.weatherDays?.[2] || s.weatherDays?.[0] || {};
  const prof = WATER_PROFILES[s.water] || WATER_PROFILES.small_river;
  const rig = calcDynamicRig(s.method, s.water, s.depth, day.windMax || 3, fish, day.waterTemp ?? 10, day.iceState || s.iceState);
  const ident = getCurrentFisherIdentity(s);
  const author = ident.callsign;
  const deviceId = ident.deviceId;
  const expertInfo = getUserExpertRank(s.catches || []);
  const now = Date.now();
  const waterName = overrideCatch?.locLabel || s.selectedWaterName || prof.shortName || s.locLabel;
  const cleanNote = (customNote || '').trim();
  const locDisplay = (waterName && waterName !== s.locLabel) ? `${s.locLabel} (${waterName})` : s.locLabel;
  const shortBait = (overrideCatch?.bait || s.selectedBait || 'по сезону').split('(')[0].trim();
  const shortRigWeight = (rig.weight || 'Оснастка').split(',')[0].trim();
  if (mode === 'sos') {
    const expiresAt = now + CREW_TTL_MS;
    const packObj = {
      t: 'crew',
      sos: true,
      id: `sos_${now.toString(36)}`,
      did: deviceId,
      fid: ident.fisherId,
      ca: now,
      ea: expiresAt,
      au: author,
      rk: expertInfo.tier,
      lb: s.locLabel,
      wn: waterName,
      wt: s.water,
      lat: Math.round(s.lat * 10000) / 10000,
      lon: Math.round(s.lon * 10000) / 10000,
      dp: s.depth,
      fi: fish.id,
      fn: fish.name,
      tw: day.waterTemp ?? 4,
      pr: day.pressAvg ?? 754,
      wnd: `${day.windDir || 'З'} ${day.windMax || 4} м/с`,
      ice: day.iceNote || s.iceNote || 'Открытая вода',
      nt: cleanNote || '🆘 ТРЕБУЕТСЯ ПОМОЩЬ НА ВОДЕ / ЛЬДУ!',
      _hasCustomNote: Boolean(cleanNote)
    };
    const token = encodeSharePack(packObj);
    const { webUrl, tgMiniAppUrl } = buildShareUrls(token);
    const summaryText =
      `🆘 SOS НА ВОДЕ (ВСЕМ) • Клёв ПРО\n` +
      `📍 ${locDisplay} • 👤 ${author} (🆔 ${ident.fisherId})\n` +
      `🎯 GPS: ${packObj.lat.toFixed(4)}°N, ${packObj.lon.toFixed(4)}°E • 🧊 ${packObj.ice} • 💨 ${packObj.wnd} • 📞 112` +
      (cleanNote ? `\n💬 ${cleanNote}` : '');
    return { mode: 'sos', packObj, token, webUrl, tgMiniAppUrl, summaryText };
  }
  if (mode === 'crew') {
    const expiresAt = now + CREW_TTL_MS;
    const keyHash = computeCrewKeyHash(customCrewKey || `${s.lat.toFixed(3)}_${s.lon.toFixed(3)}_${ident.fisherId}`);
    const crewKey = formatCrewKeyFromHash(keyHash);
    const packObj = {
      t: 'crew',
      id: `crew_${now.toString(36)}`,
      crewKey,
      did: deviceId,
      fid: ident.fisherId,
      ca: now,
      ea: expiresAt,
      au: author,
      rk: expertInfo.tier,
      rw_w: expertInfo.weight,
      lb: s.locLabel,
      wn: waterName,
      wt: s.water,
      lat: Math.round(s.lat * 10000) / 10000,
      lon: Math.round(s.lon * 10000) / 10000,
      dp: s.depth,
      fi: fish.id,
      fn: fish.name,
      mt: s.method,
      bt: shortBait,
      tw: day.waterTemp ?? 10,
      pr: day.pressAvg ?? 754,
      nt: cleanNote || `Точка сбора экипажа ${crewKey} (72 ч)`,
      _hasCustomNote: Boolean(cleanNote)
    };
    const token = encodeSharePack(packObj);
    const { webUrl, tgMiniAppUrl } = buildShareUrls(token);
    const summaryText =
      `🌊 ЭКИПАЖ (72 ч • Ключ ${crewKey}) • Клёв ПРО\n` +
      `📍 ${locDisplay} (~${s.depth.toFixed(1)} м) • 🆔 ${ident.fisherId}\n` +
      `🐟 ${fish.name} • 💧 ~${packObj.tw}°C • 🎣 ${shortRigWeight} (${shortBait})` +
      (cleanNote ? `\n💬 ${cleanNote}` : '');
    return { mode, packObj, token, webUrl, tgMiniAppUrl, summaryText };
  }
  if (mode === 'workshop') {
    const curWT = day.waterTemp ?? 10;
    const curP = day.pressAvg ?? 754;
    const flowLabel = prof.flow >= 1.8 ? 'быстрое течение' : (prof.flow >= 1.1 ? 'умеренное течение' : 'стоячая вода');
    const twMin = Math.max(0.2, Math.round((curWT - 3.5) * 10) / 10);
    const twMax = Math.min(28.0, Math.round((curWT + 3.5) * 10) / 10);
    const packObj = {
      t: 'workshop',
      id: `ws_${now.toString(36)}`,
      did: deviceId,
      fid: ident.fisherId,
      ca: now,
      au: author,
      rk: expertInfo.tier,
      fi: fish.id,
      fn: fish.name,
      wt: s.water,
      fl: flowLabel,
      dp: s.depth,
      mt: s.method,
      bt: shortBait,
      rw: rig.weight,
      rl: rig.line,
      rt: rig.tactic,
      tw: curWT,
      twMin,
      twMax,
      pr: curP,
      nt: cleanNote || `Рабочий монтаж на ${fish.name} (${flowLabel}, вода ${twMin}..${twMax}°C)`,
      _hasCustomNote: Boolean(cleanNote)
    };
    const token = encodeSharePack(packObj);
    const { webUrl, tgMiniAppUrl } = buildShareUrls(token);
    const summaryText =
      `🛠️ МАСТЕРСКАЯ СНАСТЕЙ • Клёв ПРО\n` +
      `🐟 ${fish.name} • 🌊 ${prof.shortName} (~${s.depth.toFixed(1)} м, 💧 ${twMin}–${twMax}°C)\n` +
      `⚖️ ${shortRigWeight} • 🪱 ${shortBait} • 👤 ${author} (🆔 ${ident.fisherId})` +
      (cleanNote ? `\n💬 ${cleanNote}` : '');
    return { mode, packObj, token, webUrl, tgMiniAppUrl, summaryText };
  }
  const baseLat = overrideCatch?.lat ?? s.lat;
  const baseLon = overrideCatch?.lon ?? s.lon;
  const blurred = blurCoordsForCircle(baseLat, baseLon, `${now}_${fish.id}`);
  const packObj = {
    t: 'circle',
    id: `cir_${now.toString(36)}`,
    did: deviceId,
    fid: ident.fisherId,
    ca: now,
    au: author,
    rk: expertInfo.tier,
    rw_w: expertInfo.weight,
    lb: s.locLabel,
    wn: waterName,
    wt: overrideCatch?.water || s.water,
    lat: blurred.cellLat,
    lon: blurred.cellLon,
    br: blurred.blurRadiusKm,
    poly: blurred.polygon,
    dp: overrideCatch?.depth ?? s.depth,
    fi: fish.id,
    fn: fish.name,
    kg: overrideCatch?.weightKg || 0,
    mt: overrideCatch?.method || s.method,
    bt: shortBait,
    tw: overrideCatch?.waterTemp ?? day.waterTemp ?? 10,
    pr: overrideCatch?.press ?? day.pressAvg ?? 754,
    ph: overrideCatch?.photoHash || '',
    nt: cleanNote || (overrideCatch ? `Поимка: ${fish.name} (${overrideCatch.weightKg || 0.8} кг)` : `Разведка Круга: ${fish.name}`),
    _hasCustomNote: Boolean(cleanNote)
  };
  const token = encodeSharePack(packObj);
  const { webUrl, tgMiniAppUrl } = buildShareUrls(token);
  const summaryText =
    `👥 СВОДКА В КРУГ (±5 км) • Клёв ПРО\n` +
    `📍 ${locDisplay} (~${packObj.dp} м) • 🆔 ${ident.fisherId}\n` +
    `🐟 ${fish.name}${packObj.kg ? ` (${packObj.kg} кг)` : ''} • 💧 ~${packObj.tw}°C • 🪱 ${shortBait}` +
    (cleanNote ? `\n💬 ${cleanNote}` : '');
  return { mode: 'circle', packObj, token, webUrl, tgMiniAppUrl, summaryText };
}
export function purgeExpiredCircleItems(items = []) {
  const now = Date.now();
  return (Array.isArray(items) ? items : []).filter(item => {
    if (!item) return false;
    if (item.t === 'crew' && Number.isFinite(item.ea) && item.ea < now) {
      return false;
    }
    return true;
  });
}
export async function pushEncryptedRelayPacket({ channelId, cipherPayload, kind = 'chat', regionGrid = '' }) {
  try {
    const ident = getCurrentFisherIdentity();
    const res = await fetch(`${RELAY_WORKER_URL}/relay/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelId: String(channelId || '').toUpperCase(),
        senderId: ident.fisherId,
        cipherPayload,
        kind,
        regionGrid,
        ts: Date.now()
      })
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}
export async function pollEncryptedRelayPackets(manual = false) {
  try {
    const s = store.getState();
    const ident = getCurrentFisherIdentity(s);
    const gridKey = `GRID_${Math.round(s.lat)}_${Math.round(s.lon)}`;
    const crewBoxes = ident.unlockedCrewKeys.map(k => `CREW_${String(k).toUpperCase()}`);
    const boxes = [`DM_${ident.fisherId}`, gridKey, 'SOS_ALL', ...crewBoxes].slice(0, 16);
    const url = `${RELAY_WORKER_URL}/relay/pull?boxes=${encodeURIComponent(boxes.join(','))}&since=${lastRelayPullTs}&viewer=${encodeURIComponent(ident.fisherId)}`;
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) {
      if (manual) showToast('Локальный режим чатов активен (транзитный ретранслятор офлайн)', 'info');
      return 0;
    }
    const data = await res.json();
    const packets = Array.isArray(data?.packets) ? data.packets : [];
    let newCount = 0;
    for (const pkt of packets) {
      if (!pkt || !pkt.cipherPayload) continue;
      if (pkt.ts && pkt.ts > lastRelayPullTs) lastRelayPullTs = pkt.ts;
      if (pkt.senderId && pkt.senderId === ident.fisherId) continue;
      if (pkt.kind === 'pack') {
        const existing = s.circleItems || [];
        const dec = decodeSharePack(pkt.cipherPayload);
        if (dec && !existing.some(x => x.id === dec.id)) {
          await importSharePackToken(pkt.cipherPayload, true, false);
          newCount++;
        }
      } else if (pkt.kind === 'crew_chat' || pkt.kind === 'dm_chat') {
        const chKey = pkt.channelKey || pkt.channelId || 'default';
        const msgObj = decryptChatPayload(pkt.cipherPayload, chKey);
        if (msgObj && msgObj.id) {
          const added = appendIncomingChatMessage(msgObj, true);
          if (added) newCount++;
        }
      }
    }
    if (manual) {
      showToast(newCount > 0 ? `📥 Получено новых зашифрованных пакетов: ${newCount}` : '✅ Новых внешних пакетов в очереди нет', 'good');
    }
    return newCount;
  } catch (e) {
    if (manual) showToast('Работаем автономно: все сообщения сохранены на устройстве', 'info');
    return 0;
  }
}
export function appendIncomingChatMessage(msgObj, notifyIfExternal = true) {
  if (!msgObj || !msgObj.id || !msgObj.text) return false;
  const s = store.getState();
  const ident = getCurrentFisherIdentity(s);
  const existing = Array.isArray(s.chatMessages) ? s.chatMessages : [];
  if (existing.some(m => m && m.id === msgObj.id)) return false;
  const isMine = msgObj.senderId === ident.fisherId;
  const record = {
    ...msgObj,
    unread: !isMine && (s.route !== 'chats' || activeChatChannelId !== msgObj.channelId)
  };
  const updated = [...existing, record].slice(-500);
  storage.saveChatMessages(updated);
  store.dispatch({ type: 'SET_CHAT_MESSAGES', payload: updated });
  syncCircleNavBadge();
  if (!isMine && notifyIfExternal) {
    const isCrew = String(msgObj.channelId || '').startsWith('crew:');
    pushAppNotification({
      category: isCrew ? 'crew' : 'dm',
      title: isCrew ? `🌊 Сообщение в Экипаже (${msgObj.crewKey || 'Экипаж'})` : `💬 Сообщение от ${msgObj.senderName || msgObj.senderId}`,
      body: `${msgObj.senderName || 'Рыболов'}: ${msgObj.text.slice(0, 65)}`,
      subTab: 'chats',
      channelId: msgObj.channelId
    });
  }
  return true;
}
export async function sendFishermanChatMessage({ channelId, text, crewKey = '', peerId = '', peerName = '', catchMeta = null }) {
  const cleanText = String(text || '').trim();
  if (!cleanText) return null;
  const s = store.getState();
  const ident = getCurrentFisherIdentity(s);
  const now = Date.now();
  const isCrew = channelId.startsWith('crew:');
  const encryptionKey = isCrew
    ? String(crewKey || channelId.replace(/^crew:/, '')).toUpperCase()
    : [ident.fisherId, String(peerId || '').toUpperCase()].sort().join(':');
  const msgObj = {
    id: `msg_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    channelId,
    crewKey: isCrew ? encryptionKey : '',
    peerId: !isCrew ? String(peerId || '').toUpperCase() : '',
    peerName: peerName || peerId || '',
    senderId: ident.fisherId,
    senderName: ident.callsign,
    text: cleanText,
    catchMeta: catchMeta || null,
    ts: now,
    e2ee: true,
    unread: false
  };
  appendIncomingChatMessage(msgObj, false);
  const cipherPayload = encryptChatPayload(msgObj, encryptionKey);
  const relayBox = isCrew ? `CREW_${encryptionKey}` : `DM_${String(peerId || '').toUpperCase()}`;
  pushEncryptedRelayPacket({
    channelId: relayBox,
    cipherPayload,
    kind: isCrew ? 'crew_chat' : 'dm_chat'
  });
  triggerHaptic('light');
  return { msgObj, cipherPayload, encryptionKey };
}
/**
 * Модальное окно отправки улова в чат (из Журнала уловов или из вкладки «💬 Чаты»)
 */
export function openShareCatchToChatModal(preselectedCatch = null) {
  const s = store.getState();
  const ident = getCurrentFisherIdentity(s);
  const catches = Array.isArray(s.catches) ? s.catches : [];
  const allItems = purgeExpiredCircleItems(s.circleItems || []);
  const visibleCrews = allItems.filter(x => x.t === 'crew' && !x.sos && canUserAccessCrewItem(x, s));
  const crewKeysSet = new Set([
    ...ident.unlockedCrewKeys.map(k => String(k).toUpperCase()),
    ...visibleCrews.map(c => String(c.crewKey || '').toUpperCase()).filter(Boolean)
  ]);
  if (crewKeysSet.size === 0) {
    const defHash = computeCrewKeyHash(`${s.lat.toFixed(2)}_${s.lon.toFixed(2)}_${ident.fisherId}`);
    crewKeysSet.add(formatCrewKeyFromHash(defHash));
  }
  const channels = [];
  for (const k of crewKeysSet) {
    const cItem = visibleCrews.find(c => String(c.crewKey || '').toUpperCase() === k);
    channels.push({
      channelId: `crew:${k}`,
      label: `🌊 Чат Экипажа ${k}${cItem ? ` (${cItem.wn || cItem.lb})` : ''}`,
      crewKey: k
    });
  }
  for (const m of (s.chatMessages || [])) {
    if (!m || !String(m.channelId || '').startsWith('dm:')) continue;
    if (!channels.some(c => c.channelId === m.channelId)) {
      const peerId = m.senderId === ident.fisherId ? (m.peerId || 'FP_FMP089') : m.senderId;
      const peerName = m.senderId === ident.fisherId ? (m.peerName || peerId) : (m.senderName || peerId);
      channels.push({
        channelId: m.channelId,
        label: `💬 Личный чат: ${peerName} (${peerId})`,
        peerId,
        peerName
      });
    }
  }
  const defaultChanId = activeChatChannelId || channels[0]?.channelId || '';
  const html = `
    <div style="display:flex;flex-direction:column;gap:12px;font-size:var(--fs-sm);">
      <div style="padding:9px 11px;background:rgba(16,185,129,0.12);border:1px solid var(--good);border-radius:var(--r-sm);font-size:var(--fs-xs);line-height:1.42;">
        🎣 <b>Поделиться уловом в зашифрованном чате:</b> напарники увидят карточку вашего трофея (рыба, вес, наживка, температура воды, давление, ваш ID <b>${ident.fisherId}</b>) и смогут в 1 касание открыть сектор поимки на карте!
      </div>
      <div>
        <label style="display:block;font-weight:800;font-size:var(--fs-xs);color:var(--muted);margin-bottom:4px;">1. ВЫБЕРИТЕ УЛОВ ДЛЯ ОТПРАВКИ:</label>
        <select id="scCatchSelect" style="width:100%;">
          ${preselectedCatch ? `
            <option value="${preselectedCatch.id}" selected>
              🏆 ${preselectedCatch.fishName} ${preselectedCatch.weightKg ? `• ${preselectedCatch.weightKg} кг` : ''} (${preselectedCatch.dateLabel || 'Сегодня'}, ${preselectedCatch.locLabel || s.locLabel})
            </option>
          ` : ''}
          ${catches.filter(c => !preselectedCatch || c.id !== preselectedCatch.id).map(c => `
            <option value="${c.id}">
              🐟 ${c.fishName} ${c.weightKg ? `• ${c.weightKg} кг` : ''} (${c.dateLabel || c.date}, ${c.locLabel || s.locLabel})
            </option>
          `).join('')}
          <option value="__current_spot__" ${(!preselectedCatch && catches.length === 0) ? 'selected' : ''}>
            ⚡ Текущая рыба и точка с экрана (${(FISH_DB.find(f => f.id === s.fishId) || FISH_DB[0]).name} • ${s.locLabel})
          </option>
        </select>
      </div>
      <div>
        <label style="display:block;font-weight:800;font-size:var(--fs-xs);color:var(--muted);margin-bottom:4px;">2. КУДА ОТПРАВИТЬ (ЭКИПАЖ ИЛИ ЛИЧНЫЙ ЧАТ ПО ID):</label>
        <select id="scChannelSelect" style="width:100%;">
          ${channels.map(ch => `
            <option value="${ch.channelId}" ${ch.channelId === defaultChanId ? 'selected' : ''}>${ch.label}</option>
          `).join('')}
          <option value="__new_dm__">➕ Ввести ID рыбака (FP_89AAA001) для личного чата...</option>
        </select>
        <input type="text" id="scCustomPeerIdInput" class="input" placeholder="Введите ID рыбака (напр. FP_FMP089)..." style="display:none;margin-top:6px;text-transform:uppercase;">
      </div>
      <div>
        <label style="display:block;font-weight:800;font-size:var(--fs-xs);color:var(--muted);margin-bottom:4px;">3. КОММЕНТАРИЙ К УЛОВУ (ПО ЖЕЛАНИЮ):</label>
        <input type="text" id="scCommentInput" class="input" maxlength="80" placeholder="Например: Взяла на бровке 3.5 м с утра на паузе!">
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:8px;margin-top:4px;">
        <button type="button" class="btn btn-good" id="scConfirmSendChatBtn">💬 Отправить в чат приложения</button>
        <button type="button" class="btn btn-accent" id="scSendTelegramDirectBtn">✈️ Переслать в Telegram</button>
      </div>
    </div>
  `;
  openModal('🎣 Поделиться уловом в чате', html, (bodyEl) => {
    const chanSel = bodyEl.querySelector('#scChannelSelect');
    const peerInp = bodyEl.querySelector('#scCustomPeerIdInput');
    if (chanSel && peerInp) {
      chanSel.addEventListener('change', () => {
        peerInp.style.display = chanSel.value === '__new_dm__' ? 'block' : 'none';
      });
    }
    const buildCatchChatPayload = () => {
      const chosenCatchId = bodyEl.querySelector('#scCatchSelect')?.value || '';
      const comment = (bodyEl.querySelector('#scCommentInput')?.value || '').trim();
      const targetCatch = chosenCatchId === '__current_spot__'
        ? null
        : ((preselectedCatch && preselectedCatch.id === chosenCatchId) ? preselectedCatch : catches.find(x => x.id === chosenCatchId));
      const sharePack = createSharePackFromContext('circle', comment, targetCatch || null);
      const fishName = targetCatch?.fishName || sharePack.packObj.fn || 'Рыба';
      const weightStr = targetCatch?.weightKg ? `${targetCatch.weightKg} кг` : '';
      const lenStr = targetCatch?.lengthCm ? `${targetCatch.lengthCm} см` : '';
      const trophyMeta = [weightStr, lenStr].filter(Boolean).join(', ');
      const baitStr = targetCatch?.bait || sharePack.packObj.bt || 'по сезону';
      const spotStr = targetCatch?.locLabel || `${s.locLabel} (${sharePack.packObj.wn || ''})`;
      const waterTemp = targetCatch?.waterTemp ?? sharePack.packObj.tw ?? 10;
      const press = targetCatch?.press ?? sharePack.packObj.pr ?? 754;
      const chatText =
        `🎣 УЛОВ: ${fishName}${trophyMeta ? ` (${trophyMeta})` : ''}\n` +
        `📍 ${spotStr} • Глубина ~${targetCatch?.depth ?? s.depth} м\n` +
        `🪱 Приманка: ${baitStr} • 💧 Вода ${waterTemp}°C • 🧭 ${press} мм\n` +
        `👤 Рыбак: ${ident.callsign} (🆔 ${ident.fisherId})` +
        (comment ? `\n💬 ${comment}` : '') +
        `\n🔗 Код точки: ${sharePack.token}`;
      return {
        chatText,
        sharePack,
        catchMeta: {
          fishName,
          weightKg: targetCatch?.weightKg || 0,
          lengthCm: targetCatch?.lengthCm || 0,
          bait: baitStr,
          spot: spotStr,
          token: sharePack.token,
          webUrl: sharePack.webUrl,
          fisherId: ident.fisherId
        }
      };
    };
    bodyEl.querySelector('#scConfirmSendChatBtn')?.addEventListener('click', async () => {
      const { chatText, sharePack, catchMeta } = buildCatchChatPayload();
      let targetChannelId = chanSel?.value || defaultChanId;
      let crewKey = '';
      let peerId = '';
      if (targetChannelId === '__new_dm__') {
        const rawPeer = (peerInp?.value || '').trim().toUpperCase();
        if (!rawPeer) {
          showToast('Введите ID рыбака (например: FP_FMP089)', 'warn');
          return;
        }
        peerId = normalizeFisherId(rawPeer, resolveRussianRegionCode(s));
        targetChannelId = `dm:${[ident.fisherId, peerId].sort().join(':')}`;
      } else if (targetChannelId.startsWith('crew:')) {
        crewKey = targetChannelId.replace(/^crew:/, '');
        store.dispatch({ type: 'UNLOCK_CREW_KEY', payload: crewKey });
      } else if (targetChannelId.startsWith('dm:')) {
        const parts = targetChannelId.replace(/^dm:/, '').split(':');
        peerId = parts.find(p => p !== ident.fisherId) || parts[0] || '';
      }
      await importSharePackToken(sharePack.token, true, true);
      activeChatChannelId = targetChannelId;
      await sendFishermanChatMessage({
        channelId: targetChannelId,
        text: chatText,
        crewKey,
        peerId,
        catchMeta
      });
      closeModal();
      router.navigate('chats');
      renderChatsSection();
      showToast('🎣 Карточка улова отправлена в чат!', 'good');
    });
    bodyEl.querySelector('#scSendTelegramDirectBtn')?.addEventListener('click', async () => {
      const { sharePack } = buildCatchChatPayload();
      await importSharePackToken(sharePack.token, true, true);
      closeModal();
      shareToTelegramChat(sharePack.webUrl, sharePack.summaryText);
    });
  });
}
export async function importSharePackToken(rawInput, silent = false, unlockCrewOnImport = true) {
  const str = String(rawInput || '').trim();
  const e2eMatch = str.match(/KPE2E_[A-Za-z0-9_-]+/);
  if (e2eMatch) {
    const s = store.getState();
    const ident = getCurrentFisherIdentity(s);
    const candidateKeys = [
      ...ident.unlockedCrewKeys,
      ...(s.circleItems || []).map(x => x.crewKey).filter(Boolean)
    ];
    for (const k of candidateKeys) {
      const decMsg = decryptChatPayload(e2eMatch[0], k);
      if (decMsg && decMsg.id && decMsg.text) {
        appendIncomingChatMessage(decMsg, !silent);
        if (!silent) showToast(`💬 Зашифрованное сообщение Экипажа (${k}) расшифровано и сохранено!`, 'good');
        return decMsg;
      }
    }
  }
  const decoded = decodeSharePack(str);
  if (!decoded) {
    if (!silent) showToast('❌ Не удалось распознать код пакета «Клёв ПРО: Круг». Проверьте ссылку #p=KP1_...', 'bad');
    return null;
  }
  const now = Date.now();
  if (decoded.t === 'crew' && Number.isFinite(decoded.ea) && decoded.ea < now) {
    if (!silent) showToast('⌛ Срок действия этой точки «Экипажа» (72 часа) уже истёк.', 'warn');
    return null;
  }
  if (decoded.t === 'circle' && Number.isFinite(decoded.lat) && Number.isFinite(decoded.lon)) {
    const effR = getEffectiveCircleRadiusKm(decoded, now);
    const hex = computeHexPolygonForCircle(decoded.lat, decoded.lon, effR, decoded.id || 'cir');
    decoded.lat = hex.cellLat;
    decoded.lon = hex.cellLon;
    decoded.poly = hex.vertices;
  }
  if (decoded.t === 'crew' && !decoded.sos && decoded.crewKey && unlockCrewOnImport) {
    store.dispatch({ type: 'UNLOCK_CREW_KEY', payload: decoded.crewKey });
  }
  const s = store.getState();
  const ident = getCurrentFisherIdentity(s);
  if (!decoded.fid) {
    decoded.fid = ident.fisherId;
  }
  const existing = purgeExpiredCircleItems(s.circleItems || []);
  const isNewItem = !existing.some(x => x.id === decoded.id);
  const filtered = existing.filter(x => x.id !== decoded.id);
  const isMine = String(decoded.fid || '').toUpperCase() === String(ident.fisherId).toUpperCase() && !decoded.isDemoSeed;
  const updated = [{ ...decoded, importedAt: isMine ? 0 : now }, ...filtered].slice(0, 80);
  storage.saveCircleItems(updated);
  store.dispatch({ type: 'SET_CIRCLE_ITEMS', payload: updated });
  syncToTelegramCloud('klev_circle_v2', updated.slice(0, 8));
  const isExternal = !isMine || decoded.isDemoSeed;
  if (isNewItem && isExternal) {
    const distKm = (Number.isFinite(decoded.lat) && Number.isFinite(decoded.lon))
      ? calcGeoDistanceKm(s.lat, s.lon, decoded.lat, decoded.lon)
      : 0;
    const maxRadius = s.waterRadiusKm || 50;
    if (decoded.sos) {
      pushAppNotification({
        category: 'sos',
        title: `🆘 СИГНАЛ SOS НА ВОДЕ (${decoded.wn || decoded.lb})`,
        body: `Координаты: ${Number(decoded.lat).toFixed(4)}°N, ${Number(decoded.lon).toFixed(4)}°E • От ${decoded.fid || decoded.au}`,
        subTab: 'radar',
        lat: decoded.lat,
        lon: decoded.lon,
        silentToast: !silent
      });
    } else if (decoded.t === 'crew' && canUserAccessCrewItem(decoded, store.getState())) {
      pushAppNotification({
        category: 'crew',
        title: `🌊 Новая точка Экипажа (${decoded.crewKey || '72ч'})`,
        body: `${decoded.wn || decoded.lb}: ${decoded.fn} (~${decoded.dp} м) • От ${decoded.fid}`,
        subTab: 'radar',
        lat: decoded.lat,
        lon: decoded.lon,
        silentToast: !silent
      });
    } else if (decoded.t === 'circle' && distKm <= Math.max(120, maxRadius)) {
      pushAppNotification({
        category: 'circle',
        title: `👥 Сводка Круга рядом (${Math.round(distKm)} км)`,
        body: `${decoded.wn || decoded.lb}: ${decoded.fn} на «${decoded.bt || 'по сезону'}» • ${decoded.fid}`,
        subTab: 'radar',
        lat: decoded.lat,
        lon: decoded.lon,
        silentToast: !silent
      });
    } else if (decoded.t === 'workshop') {
      pushAppNotification({
        category: 'workshop',
        title: `🛠️ Новая оснастка в Мастерской`,
        body: `${decoded.fn}: ${decoded.rw || 'монтаж'} (${decoded.bt || 'приманка'}) • ${decoded.fid}`,
        subTab: 'radar',
        silentToast: !silent
      });
    }
  }
  triggerHaptic('success');
  if (!silent) {
    const typeLabel = decoded.sos
      ? `🆘 Сигнал SOS: ${decoded.wn || decoded.lb}`
      : (decoded.t === 'crew'
          ? `🌊 Точка Экипажа (${decoded.crewKey || '72ч'}): ${decoded.wn || decoded.lb}`
          : (decoded.t === 'workshop'
              ? `🛠️ Снасть Мастерской: ${decoded.fn}`
              : `👥 Сводка Круга (±${getEffectiveCircleRadiusKm(decoded, now)} км): ${decoded.fn}`));
    showToast(`✅ Добавлено: ${typeLabel} (🆔 ${decoded.fid})`, 'good');
  }
  return decoded;
}
export function evaluateCircleFieldConfirmation(fish, lat, lon, circleItems = [], catches = []) {
  const now = Date.now();
  const maxAgeMs = 72 * 3600 * 1000;
  const radiusKm = 35;
  const s = store.getState();
  const validExternalCircle = purgeExpiredCircleItems(circleItems).filter(item => {
    if (isCircleItemHidden(item, s)) return false;
    if (item.t !== 'circle' && item.t !== 'crew') return false;
    if (item.t === 'crew' && !canUserAccessCrewItem(item, s)) return false;
    if (!Number.isFinite(item.lat) || !Number.isFinite(item.lon)) return false;
    const ageMs = Math.max(0, now - (item.ca || now));
    if (ageMs > maxAgeMs) return false;
    if (isCircleItemMine(item, s)) return false;
    return calcGeoDistanceKm(lat, lon, item.lat, item.lon) <= radiusKm;
  });
  const matchingSpeciesCircle = validExternalCircle.filter(item => item.fi === fish?.id);
  const kAnonReady = validExternalCircle.length >= REGIONAL_K_ANONYMITY_THRESHOLD;
  if (matchingSpeciesCircle.length === 0 && validExternalCircle.length === 0) {
    return {
      hasSignal: false,
      val: 0,
      kAnonCount: 0,
      kAnonReady: false,
      note: 'Полевые сводки Круга: нет внешних сигналов от других участников в радиусе 35 км за 72 ч',
      commentary: 'Независимых отчётов от других участников вашего Круга в радиусе 35 км за последние 72 ч пока нет (ваши собственные точки и уловы учитываются отдельно без петли самоподтверждения).'
    };
  }
  if (matchingSpeciesCircle.length > 0) {
    let weightedSum = 0;
    let expertCount = 0;
    for (const item of matchingSpeciesCircle) {
      const ageHours = Math.max(0, Math.min(72, (now - (item.ca || now)) / 3600000));
      const timeDecay = 1.0 - (ageHours / 72) * 0.7;
      const authorWeight = Number.isFinite(item.rw_w) ? item.rw_w : (item.rk === 'expert' ? 1.5 : 1.0);
      if (item.rk === 'expert') expertCount++;
      weightedSum += 3.8 * timeDecay * authorWeight;
    }
    const boost = Math.max(2, Math.min(10, Math.round(weightedSum)));
    const bestBait = matchingSpeciesCircle[0]?.bt || 'по сезону';
    const authors = Array.from(new Set(matchingSpeciesCircle.map(x => x.fid || x.au).filter(Boolean))).slice(0, 2).join(', ');
    const expertBadgeNote = expertCount > 0 ? `, из них ${expertCount} от 🏅 Экспертов` : '';
    return {
      hasSignal: true,
      val: boost,
      kAnonCount: validExternalCircle.length,
      kAnonReady,
      note: `Полевое подтверждение Круга: +${boost}% (${matchingSpeciesCircle.length} независ. отч. за 72ч${expertBadgeNote}, лимит ±10%)`,
      commentary: `За последние 72 ч в радиусе 35 км получено ${matchingSpeciesCircle.length} независимых подтверждений по виду «${fish.name}»${authors ? ` (от: ${authors}${expertBadgeNote})` : ''}. Лучшая приманка на воде: «${bestBait}» (+${boost}% из макс. 10%).`
    };
  }
  const otherFishNames = Array.from(new Set(validExternalCircle.map(x => x.fn).filter(Boolean))).slice(0, 2).join(', ');
  return {
    hasSignal: true,
    val: +2,
    kAnonCount: validExternalCircle.length,
    kAnonReady,
    note: `Активность в секторе Круга (+2%, клюёт: ${otherFishNames || 'соседние виды'})`,
    commentary: `В радиусе 35 км есть свежие независимые сигналы Круга по соседним видам (${otherFishNames}), общая кормовая активность водоёма подтверждена.`
  };
}
export function openShareModalForCurrentContext(initialMode = 'circle', overrideCatch = null) {
  let currentMode = initialMode;
  let customNote = '';
  function renderModalContent(bodyEl) {
    const pack = createSharePackFromContext(currentMode, customNote, overrideCatch);
    const ident = getCurrentFisherIdentity();
    bodyEl.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:12px;font-size:var(--fs-sm);">
        <div style="padding:10px 12px;background:rgba(56,189,248,0.10);border:1px solid var(--accent);border-radius:var(--r-sm);font-size:var(--fs-xs);line-height:1.45;">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:4px;">
            <b>Автопривязка вашего ID к точке:</b>
            <span class="fisher-id-copy-badge" data-copy-fisher-id="${ident.fisherId}" title="Нажмите для автокопирования ID">🆔 ${ident.fisherId} 📋</span>
          </div>
          ${currentMode === 'sos'
            ? '🆘 <b>Экстренный сигнал SOS рассылается ВСЕМ рыбакам:</b> виден публично на карте и в Круге.'
            : (currentMode === 'crew'
                ? `🔑 <b>Закрытый Экипаж (${pack.packObj.crewKey}):</b> точные координаты и чат экипажа увидят ТОЛЬКО участники с ключом (и Админы из базы).`
                : '🛡️ <b>Ультракороткая бинарная упаковка V3:</b> вся ссылка занимает ~54 символа (<code>#p=KP1_...</code>) со встроенным ID рыбака и гексагоном ±5/10 км.')}
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:6px;">
          <button type="button" class="btn btn-sm ${currentMode === 'circle' ? 'btn-accent' : ''}" data-share-mode="circle" style="min-height:44px;flex-direction:column;gap:2px;">
            <span>👥 В Круг (±5/10 км)</span>
            <span style="font-size:10px;opacity:0.85;">Гексагон без пина</span>
          </button>
          <button type="button" class="btn btn-sm ${currentMode === 'crew' ? 'btn-accent' : ''}" data-share-mode="crew" style="min-height:44px;flex-direction:column;gap:2px;">
            <span>🌊 Экипаж (72 ч)</span>
            <span style="font-size:10px;opacity:0.85;">По ключу ${pack.packObj.crewKey || ''}</span>
          </button>
          <button type="button" class="btn btn-sm ${currentMode === 'workshop' ? 'btn-accent' : ''}" data-share-mode="workshop" style="min-height:44px;flex-direction:column;gap:2px;">
            <span>🛠️ Мастерская</span>
            <span style="font-size:10px;opacity:0.85;">Паспорт снасти</span>
          </button>
          <button type="button" class="btn btn-sm ${currentMode === 'sos' ? 'btn-good' : ''}" data-share-mode="sos" style="min-height:44px;flex-direction:column;gap:2px;border-color:var(--bad);color:${currentMode === 'sos' ? '#fff' : 'var(--bad)'};background:${currentMode === 'sos' ? 'var(--bad)' : 'var(--card)'};">
            <span>🆘 SOS НА ВОДЕ</span>
            <span style="font-size:10px;opacity:0.9;">Всем рыбакам!</span>
          </button>
        </div>
        <div>
          <label for="shareCustomNoteInput" style="display:block;font-size:var(--fs-xs);color:var(--muted);font-weight:700;margin-bottom:4px;">
            💬 КОРОТКИЙ КОММЕНТАРИЙ (ПО ЖЕЛАНИЮ):
          </label>
          <input type="text" id="shareCustomNoteInput" class="input" maxlength="48" value="${customNote}" placeholder="${currentMode === 'sos' ? 'Ситуация: заглох мотор, нужна буксировка, промоина...' : 'Оставьте пустым для минимальной длины ссылки (28 символов)...'}">
        </div>
        <div class="card" style="background:var(--card);padding:10px 12px;border:1px solid ${currentMode === 'sos' ? 'var(--bad)' : 'var(--border)'};font-size:var(--fs-xs);line-height:1.45;color:var(--text);">
          <div style="font-family:monospace;font-size:11.5px;color:var(--accent);font-weight:800;margin-bottom:6px;word-break:break-all;" id="shareShortUrlPreview">🔗 ${pack.webUrl} (${pack.webUrl.length} симв.)</div>
          <div style="white-space:pre-line;" id="sharePreviewBox">${pack.summaryText}</div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-top:4px;">
          <button type="button" class="btn ${currentMode === 'sos' ? 'btn-good' : 'btn-accent'}" id="shareSendTelegramBtn" style="${currentMode === 'sos' ? 'background:var(--bad);border-color:var(--bad);' : ''}">
            ✈️ В Telegram
          </button>
          <button type="button" class="btn btn-good" id="shareCopyOrNativeBtn">
            📋 Скопировать
          </button>
          <button type="button" class="btn" id="shareSaveLocalCircleBtn">
            ➕ Опубликовать в Круге
          </button>
        </div>
      </div>
    `;
    bodyEl.querySelectorAll('[data-share-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        currentMode = btn.getAttribute('data-share-mode');
        const noteEl = bodyEl.querySelector('#shareCustomNoteInput');
        if (noteEl) customNote = noteEl.value;
        renderModalContent(bodyEl);
      });
    });
    const noteInput = bodyEl.querySelector('#shareCustomNoteInput');
    if (noteInput) {
      noteInput.addEventListener('input', (e) => {
        customNote = e.target.value;
        const updatedPack = createSharePackFromContext(currentMode, customNote, overrideCatch);
        const prevBox = bodyEl.querySelector('#sharePreviewBox');
        const urlBox = bodyEl.querySelector('#shareShortUrlPreview');
        if (prevBox) prevBox.textContent = updatedPack.summaryText;
        if (urlBox) urlBox.textContent = `🔗 ${updatedPack.webUrl} (${updatedPack.webUrl.length} симв.)`;
      });
    }
    const publishToRelayIfApplicable = (finalPack) => {
      const s = store.getState();
      const gridBox = `GRID_${Math.round(s.lat)}_${Math.round(s.lon)}`;
      if (finalPack.mode === 'sos') {
        pushEncryptedRelayPacket({ channelId: 'SOS_ALL', cipherPayload: finalPack.token, kind: 'pack', regionGrid: gridBox });
      } else if (finalPack.mode === 'crew' && finalPack.packObj?.crewKey) {
        pushEncryptedRelayPacket({ channelId: `CREW_${finalPack.packObj.crewKey}`, cipherPayload: finalPack.token, kind: 'pack', regionGrid: gridBox });
      } else {
        pushEncryptedRelayPacket({ channelId: gridBox, cipherPayload: finalPack.token, kind: 'pack', regionGrid: gridBox });
      }
    };
    bodyEl.querySelector('#shareSendTelegramBtn')?.addEventListener('click', () => {
      const finalPack = createSharePackFromContext(currentMode, customNote, overrideCatch);
      importSharePackToken(finalPack.token, true, true);
      publishToRelayIfApplicable(finalPack);
      shareToTelegramChat(finalPack.webUrl, finalPack.summaryText);
    });
    bodyEl.querySelector('#shareCopyOrNativeBtn')?.addEventListener('click', async () => {
      const finalPack = createSharePackFromContext(currentMode, customNote, overrideCatch);
      await importSharePackToken(finalPack.token, true, true);
      publishToRelayIfApplicable(finalPack);
      await shareOrCopyPack({
        title: currentMode === 'sos' ? '🆘 SOS НА ВОДЕ • Клёв ПРО' : 'Клёв ПРО: Круг',
        text: finalPack.summaryText,
        url: finalPack.webUrl,
        token: finalPack.token
      });
    });
    bodyEl.querySelector('#shareSaveLocalCircleBtn')?.addEventListener('click', async () => {
      const finalPack = createSharePackFromContext(currentMode, customNote, overrideCatch);
      await importSharePackToken(finalPack.token, false, true);
      publishToRelayIfApplicable(finalPack);
      closeModal();
    });
  }
  openModal('🤝 Поделиться в «Круг / Экипаж / SOS»', '<div id="shareModalMount"></div>', (bodyEl) => {
    renderModalContent(bodyEl);
  });
}
export function openImportPackModal() {
  const s = store.getState();
  const ident = getCurrentFisherIdentity(s);
  const html = `
    <div style="display:flex;flex-direction:column;gap:12px;font-size:var(--fs-sm);">
      <div style="padding:10px 12px;background:var(--card);border:1px solid var(--border);border-radius:var(--r-sm);">
        <div style="font-weight:800;font-size:var(--fs-xs);color:var(--accent);margin-bottom:6px;">🔑 БЫСТРЫЙ ВВОД КЛЮЧА ЗАКРЫТОГО ЭКИПАЖА (формат KP-XXXX):</div>
        <div style="display:flex;gap:6px;">
          <input type="text" id="unlockCrewKeyInput" class="input" placeholder="Например: KP-7A3F" style="flex:1;text-transform:uppercase;font-weight:800;">
          <button type="button" class="btn btn-sm btn-accent" id="unlockCrewKeyConfirmBtn">🔓 Открыть экипаж</button>
        </div>
        <div style="font-size:11px;color:var(--muted);margin-top:4px;">
          Открытые ключи экипажей: <b>${ident.unlockedCrewKeys.length ? ident.unlockedCrewKeys.join(', ') : 'пока нет'}</b>
        </div>
      </div>
      <div>
        <label style="display:block;font-weight:800;font-size:var(--fs-xs);color:var(--muted);margin-bottom:4px;">
          📥 ИЛИ ВСТАВЬТЕ ССЫЛКУ <code>#p=KP1_...</code> / ЗАШИФРОВАННОЕ СООБЩЕНИЕ <code>KPE2E_...</code>:
        </label>
        <textarea id="importPackTextarea" class="input" rows="3" placeholder="Вставьте короткую ссылку https://klevpro.ru/#p=KP1_... или код..." style="min-height:80px;font-family:monospace;font-size:12px;"></textarea>
      </div>
      <div style="display:flex;gap:8px;">
        <button type="button" class="btn btn-good" id="importPackConfirmBtn" style="width:100%;">📥 Расшифровать и добавить в навигатор</button>
      </div>
    </div>
  `;
  openModal('🔑 Ключ Экипажа и приём пакета KP1', html, (bodyEl) => {
    const keyInput = bodyEl.querySelector('#unlockCrewKeyInput');
    const keyBtn = bodyEl.querySelector('#unlockCrewKeyConfirmBtn');
    if (keyBtn && keyInput) {
      keyBtn.addEventListener('click', () => {
        const rawKey = (keyInput.value || '').trim().toUpperCase();
        if (!rawKey) {
          showToast('Введите ключ экипажа (например, KP-7A3F)', 'warn');
          return;
        }
        const formatted = rawKey.startsWith('KP-') ? rawKey : `KP-${rawKey.replace(/[^0-9A-F]/g, '').slice(0, 4).padStart(4, '0')}`;
        store.dispatch({ type: 'UNLOCK_CREW_KEY', payload: formatted });
        activeChatChannelId = `crew:${formatted}`;
        showToast(`🔓 Ключ экипажа ${formatted} активирован! Точка и чат экипажа теперь открыты.`, 'good');
        closeModal();
      });
    }
    const ta = bodyEl.querySelector('#importPackTextarea');
    const btn = bodyEl.querySelector('#importPackConfirmBtn');
    if (btn && ta) {
      btn.addEventListener('click', async () => {
        const res = await importSharePackToken(ta.value, false, true);
        if (res) {
          closeModal();
        }
      });
    }
  });
}
export function openNotificationsModal(onBackToHub = null) {
  const backFn = typeof onBackToHub === 'function'
    ? onBackToHub
    : (() => {
        if (typeof window !== 'undefined' && typeof window.__KLEV_OPEN_SETTINGS_ZONE__ === 'function') {
          window.__KLEV_OPEN_SETTINGS_ZONE__('hub');
        }
      });
  function renderNotifBody(bodyEl) {
    const s = store.getState();
    const ident = getCurrentFisherIdentity(s);
    const prefs = ident.notifSettings;
    const notifs = Array.isArray(s.notifications) ? s.notifications : [];
    if (notifs.some(n => n && !n.read)) {
      const marked = notifs.map(n => ({ ...n, read: true }));
      storage.saveNotifications(marked);
      store.dispatch({ type: 'SET_NOTIFICATIONS', payload: marked });
      syncCircleNavBadge();
    }
    bodyEl.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:12px;font-size:var(--fs-sm);">
        ${renderSettingsZoneTabsHtml('notif')}
        <div style="padding:10px 12px;background:var(--card);border:1px solid var(--border);border-radius:var(--r-sm);display:flex;flex-direction:column;gap:8px;">
          <div style="font-weight:800;font-size:var(--fs-xs);color:var(--accent);">🔔 КАТЕГОРИИ ОПОВЕЩЕНИЙ (РАЗДЕЛЬНАЯ НАСТРОЙКА):</div>
          <label style="display:flex;justify-content:space-between;align-items:center;gap:8px;cursor:pointer;">
            <span style="min-width:0;line-height:1.3;">🆘 <b>Сигналы SOS на воде</b> (экстренно всем рыбакам в регионе)</span>
            <input type="checkbox" data-notif-toggle="sos" ${prefs.sos !== false ? 'checked' : ''} style="flex-shrink:0;">
          </label>
          <label style="display:flex;justify-content:space-between;align-items:center;gap:8px;cursor:pointer;">
            <span style="min-width:0;line-height:1.3;">🌊 <b>Экипаж и сообщения чата Экипажа</b> (по вашим ключам)</span>
            <input type="checkbox" data-notif-toggle="crew" ${prefs.crew !== false ? 'checked' : ''} style="flex-shrink:0;">
          </label>
          <label style="display:flex;justify-content:space-between;align-items:center;gap:8px;cursor:pointer;">
            <span style="min-width:0;line-height:1.3;">👥 <b>Сводки Круга на карте рядом</b> (в радиусе 50 / 120 км)</span>
            <input type="checkbox" data-notif-toggle="circle" ${prefs.circle !== false ? 'checked' : ''} style="flex-shrink:0;">
          </label>
          <label style="display:flex;justify-content:space-between;align-items:center;gap:8px;cursor:pointer;">
            <span style="min-width:0;line-height:1.3;">🛠️ <b>Новые оснастки в Мастерской снастей</b></span>
            <input type="checkbox" data-notif-toggle="workshop" ${prefs.workshop !== false ? 'checked' : ''} style="flex-shrink:0;">
          </label>
          <label style="display:flex;justify-content:space-between;align-items:center;gap:8px;cursor:pointer;">
            <span style="min-width:0;line-height:1.3;">💬 <b>Личные сообщения в чатах рыбаков</b> (1-на-1 по ID)</span>
            <input type="checkbox" data-notif-toggle="dm" ${prefs.dm !== false ? 'checked' : ''} style="flex-shrink:0;">
          </label>
          <label style="display:flex;justify-content:space-between;align-items:center;gap:8px;cursor:pointer;padding-top:6px;border-top:1px dashed var(--border);">
            <span style="min-width:0;line-height:1.3;">🔊 <b>Звуковой сигнал сонара и вибрация</b></span>
            <input type="checkbox" data-notif-toggle="sound" ${prefs.sound !== false ? 'checked' : ''} style="flex-shrink:0;">
          </label>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="font-weight:800;font-size:var(--fs-xs);color:var(--muted);">📋 ПОСЛЕДНИЕ СОБЫТИЯ И СИГНАЛЫ (${notifs.length}):</span>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button type="button" class="btn btn-sm" id="notifRequestOsPushBtn">📲 Системные Push</button>
            <button type="button" class="btn btn-sm" id="notifClearAllBtn">🗑️ Очистить</button>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;max-height:220px;overflow-y:auto;">
          ${notifs.length === 0 ? `
            <div style="padding:12px;background:var(--card);border:1px dashed var(--border);border-radius:var(--r-sm);font-size:var(--fs-xs);color:var(--muted);text-align:center;">
              Новых уведомлений пока нет.
            </div>
          ` : notifs.map(n => {
            const timeStr = new Date(n.ts || Date.now()).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
            const borderCol = n.category === 'sos' ? 'var(--bad)' : (n.category === 'crew' || n.category === 'dm' ? 'var(--accent)' : 'var(--border)');
            return `
              <div class="card" style="padding:8px 10px;background:var(--card);border:1px solid ${borderCol};font-size:var(--fs-xs);cursor:pointer;" data-notif-jump="${n.id}">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
                  <b style="color:${n.category === 'sos' ? 'var(--bad)' : 'var(--text)'};">${escapeHtml(n.title)}</b>
                  <span style="font-size:10px;color:var(--muted);">${timeStr}</span>
                </div>
                <div style="color:var(--muted);margin-top:3px;">${escapeHtml(n.body)}</div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
    bindSettingsZoneTabs(bodyEl);
    bodyEl.querySelectorAll('[data-notif-toggle]').forEach(chk => {
      chk.addEventListener('change', () => {
        const key = chk.getAttribute('data-notif-toggle');
        store.dispatch({
          type: 'UPDATE_USER_PROFILE',
          payload: {
            notifSettings: { [key]: chk.checked }
          }
        });
        syncCurrentProfileToCloudIfLoggedIn();
        showToast('Настройки уведомлений сохранены', 'good');
      });
    });
    bodyEl.querySelector('#notifRequestOsPushBtn')?.addEventListener('click', async () => {
      if (typeof Notification === 'undefined') {
        showToast('Внутриприложенческие звуковые и вибро-уведомления уже активны!', 'good');
        return;
      }
      try {
        const perm = await Notification.requestPermission();
        showToast(perm === 'granted' ? '✅ Системные уведомления разрешены!' : 'Активны внутриприложенческие уведомления сонара', 'good');
      } catch (e) {
        showToast('Активны внутриприложенческие уведомления сонара', 'info');
      }
    });
    bodyEl.querySelector('#notifClearAllBtn')?.addEventListener('click', () => {
      storage.saveNotifications([]);
      store.dispatch({ type: 'SET_NOTIFICATIONS', payload: [] });
      syncCircleNavBadge();
      renderNotifBody(bodyEl);
    });
    bodyEl.querySelectorAll('[data-notif-jump]').forEach(card => {
      card.addEventListener('click', () => {
        const nid = card.getAttribute('data-notif-jump');
        const target = (store.getState().notifications || []).find(x => x.id === nid);
        closeModal();
        if (target) {
          if (target.subTab === 'chats') {
            if (target.channelId) activeChatChannelId = target.channelId;
            router.navigate('chats');
            renderChatsSection();
          } else if (Number.isFinite(target.lat) && Number.isFinite(target.lon)) {
            setLocation(target.lat, target.lon, true);
            router.navigate('geo');
          }
        }
      });
    });
  }
  openModal('🔔 Уведомления (SOS, Экипаж, Круг, Чаты)', '<div id="notifModalMount"></div>', (bodyEl) => {
    renderNotifBody(bodyEl);
  }, true, { onBack: backFn });
}
/**
 * Подменю Зоны 1: «🔐 Логин, Пароль, Мой ID, Супер-Админ и Бэкап»
 * - Сквозной вход по Логину и Паролю на ВСЕХ устройствах (APK, Браузер, Telegram Mini App)
 * - Постоянная привязка аккаунта Владельца (iAthor82 / FISherman1982* -> ID FP_FMP089 + Супер-Админ)
 * - Автокопирование ID рыбака (FP_89AAA001) в 1 касание
 * - Управление Базой Администраторов и резервное копирование (.json)
 */
export function openAuthAndBackupModal(onBackToHub = null) {
  const backFn = typeof onBackToHub === 'function'
    ? onBackToHub
    : (() => {
        if (typeof window !== 'undefined' && typeof window.__KLEV_OPEN_SETTINGS_ZONE__ === 'function') {
          window.__KLEV_OPEN_SETTINGS_ZONE__('hub');
        }
      });
  function renderAuthBody(bodyEl) {
    const s = store.getState();
    const ident = getCurrentFisherIdentity(s);
    const tgUser = getTelegramUser();
    const ownerMode = isOwnerAdmin(s);
    const adminMode = isUserAdmin(s);
    const adminList = getAdminWhitelistEntries(s);
    const showAllCrewsFlag = s.userProfile?.adminShowAllCrews !== false;
    const savedLogin = s.userProfile?.login || (ident.callsign !== 'Рыболов' ? ident.callsign : '');
    bodyEl.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:12px;font-size:var(--fs-sm);">
        ${renderSettingsZoneTabsHtml('auth')}
        <div style="padding:10px 12px;background:rgba(56,189,248,0.10);border:1px solid var(--accent);border-radius:var(--r-sm);font-size:var(--fs-xs);line-height:1.45;">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:4px;">
            <span style="font-weight:800;color:var(--accent);">🆔 ВАШ РЫБОЛОВНЫЙ ID (НАЖМИТЕ ДЛЯ АВТОКОПИРОВАНИЯ):</span>
            <button type="button" class="btn btn-sm btn-good fisher-id-copy-badge" data-copy-fisher-id="${ident.fisherId}" title="Нажмите, чтобы скопировать ID в буфер обмена" style="font-family:monospace;font-size:13px;font-weight:900;padding:4px 10px;">
              🆔 ${ident.fisherId} 📋 Копировать ID
            </button>
          </div>
          <div>
            Ваш ID (<b>${ident.fisherId}</b>) автоматически привязывается ко всем вашим точкам в Круге, Экипаже, SOS и чатах.
            ${ident.isAuthenticated
              ? `<span style="color:var(--good);font-weight:800;"> • 🟢 Привязан к логину «${savedLogin || ident.callsign}» ${ownerMode ? '(👑 Владелец / Супер-Админ)' : ''}</span>`
              : ''}
          </div>
        </div>
        <div class="card" style="background:var(--card);padding:12px;border:1.5px solid var(--accent);display:flex;flex-direction:column;gap:9px;">
          <div style="font-weight:800;font-size:var(--fs-xs);color:var(--accent);">
            🔑 ВХОД ПО ЛОГИНУ И ПАРОЛЮ (РАБОТАЕТ НА ВСЕХ УСТРОЙСТВАХ: APK, БРАУЗЕР, ТГ)
          </div>
          <div style="font-size:11.5px;color:var(--muted);line-height:1.38;">
            Введите ваш логин и пароль на любом телефоне, планшете или ПК — система автоматически восстановит ваш <b>ID рыбака</b>, избранных рыб, снасти, ключи экипажей и права доступа.
          </div>
          <div>
            <label style="display:block;font-size:var(--fs-xs);color:var(--muted);font-weight:700;margin-bottom:3px;">ЛОГИН (ПОЗЫВНОЙ РЫБАКА):</label>
            <input type="text" id="authCallsignInput" class="input" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" value="${savedLogin}" placeholder="Например: iAthor82">
          </div>
          <div>
            <label style="display:block;font-size:var(--fs-xs);color:var(--muted);font-weight:700;margin-bottom:3px;">ПАРОЛЬ (ДЛЯ ВХОДА И СИНХРОНИЗАЦИИ ПРОФИЛЯ):</label>
            <div style="display:flex;gap:6px;align-items:center;">
              <input type="password" id="authPinInput" class="input" autocomplete="current-password" placeholder="${ident.isAuthenticated ? '•••••••• (введите пароль для входа/обновления)' : 'Введите ваш пароль...'}" style="flex:1;">
              <button type="button" class="btn btn-sm" id="authTogglePassVisBtn" title="Показать / скрыть пароль" style="min-height:40px;padding:0 10px;">👁️</button>
            </div>
          </div>
          <div style="font-size:11px;color:var(--muted);">
            ✈️ Привязка Telegram: <b>${tgUser ? `@${tgUser.username || tgUser.firstName} (ID ${tgUser.id})` : (ident.tgLinkedId ? `Привязан ID ${ident.tgLinkedId}` : 'Автоматически при запуске в @KlevProClubBot')}</b>
          </div>
          <button type="button" class="btn btn-accent" id="authSaveBtn" style="width:100%;white-space:normal;line-height:1.25;">
            🔑 Войти / Сохранить и синхронизировать профиль (${ident.fisherId})
          </button>
        </div>
        <!-- Закрытая система Администратора (только для Владельца iAthor82 и добавленных им в базу админов) -->
        ${ownerMode ? `
          <div class="card" style="background:rgba(16,185,129,0.08);padding:12px;border:1.5px solid var(--good);display:flex;flex-direction:column;gap:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
              <div style="min-width:0;">
                <div style="font-weight:900;font-size:var(--fs-sm);color:var(--good);">👑 ПАНЕЛЬ СУПЕР-АДМИНА (iAthor82 • FP_FMP089)</div>
                <div style="font-size:11px;color:var(--muted);">Видеть все закрытые экипажи без ключа можете только вы и рыбаки из вашей Базы Администраторов ниже.</div>
              </div>
              <button type="button" class="btn btn-sm ${showAllCrewsFlag ? 'btn-good' : ''}" id="adminToggleCrewsVisibilityBtn" style="width:100%;">
                ${showAllCrewsFlag ? '👁️ Видимость всех экипажей: ВКЛ' : '🙈 Видимость всех экипажей: ВЫКЛ'}
              </button>
            </div>
            <div style="padding:8px 10px;background:var(--panel);border:1px solid var(--border);border-radius:var(--r-sm);display:flex;flex-direction:column;gap:6px;">
              <div style="font-weight:800;font-size:var(--fs-xs);color:var(--accent);">➕ ДОБАВИТЬ АДМИНИСТРАТОРА В БАЗУ (ПО ID FP_89AAA001 ИЛИ @USERNAME):</div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
                <input type="text" id="adminAddIdInput" class="input" placeholder="ID (напр. FP_77AAA001)" style="text-transform:uppercase;min-height:36px;font-family:monospace;">
                <input type="text" id="adminAddLabelInput" class="input" placeholder="Имя / Примечание..." style="min-height:36px;">
              </div>
              <button type="button" class="btn btn-sm btn-good" id="adminAddConfirmBtn" style="width:100%;">➕ Добавить в Базу Администраторов</button>
            </div>
            <div>
              <div style="font-weight:800;font-size:var(--fs-xs);color:var(--muted);margin-bottom:4px;">📋 АКТИВНАЯ БАЗА АДМИНИСТРАТОРОВ (${adminList.length}):</div>
              <div style="display:flex;flex-direction:column;gap:4px;max-height:150px;overflow-y:auto;">
                ${adminList.map(adm => `
                  <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 8px;background:var(--panel);border:1px solid var(--border);border-radius:6px;font-size:var(--fs-xs);flex-wrap:wrap;">
                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0;">
                      <span class="fisher-id-copy-badge" data-copy-fisher-id="${adm.id}" style="font-family:monospace;font-weight:900;color:var(--good);cursor:pointer;">🆔 ${adm.id} 📋</span>
                      <b>${escapeHtml(adm.label || 'Администратор')}</b>
                    </div>
                    ${DEFAULT_ADMIN_IDS.includes(adm.id) ? `<span class="pill pill-good" style="font-size:10px;">Владелец</span>` : `<button type="button" class="btn btn-sm" data-remove-admin-id="${adm.id}" style="min-height:26px;padding:2px 8px;color:var(--bad);">🗑️ Исключить</button>`}
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        ` : (adminMode ? `
          <div class="card" style="background:rgba(16,185,129,0.08);padding:10px 12px;border:1.5px solid var(--good);display:flex;flex-direction:column;gap:8px;">
            <div>
              <div style="font-weight:800;font-size:var(--fs-xs);color:var(--good);">👑 Ваш ID (${ident.fisherId}) подтверждён в Базе Администраторов</div>
              <div style="font-size:11px;color:var(--muted);">Вам открыт просмотр всех закрытых экипажей на карте и в Круге.</div>
            </div>
            <button type="button" class="btn btn-sm ${showAllCrewsFlag ? 'btn-good' : ''}" id="adminToggleCrewsVisibilityBtn" style="width:100%;">
              ${showAllCrewsFlag ? '👁️ Все экипажи: ВКЛ' : '🙈 Все экипажи: ВЫКЛ'}
            </button>
          </div>
        ` : '')}
        <div class="card" style="background:var(--card);padding:10px 12px;border:1px solid var(--border);display:flex;flex-direction:column;gap:8px;">
          <div style="font-weight:800;font-size:var(--fs-xs);color:var(--accent);">☁️ ФАЙЛОВАЯ РЕЗЕРВНАЯ КОПИЯ ПРОФИЛЯ, ТОЧЕК И ЧАТОВ:</div>
          <div style="font-size:11px;color:var(--muted);line-height:1.4;">
            Помимо автоматической облачной синхронизации по логину и паролю, вы можете выгрузить полный локальный архив (.json) на устройство.
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:6px;">
            <button type="button" class="btn btn-sm btn-good" id="backupExportBtn">📤 Скачать бэкап (.json)</button>
            <label class="btn btn-sm btn-accent" style="cursor:pointer;margin:0;text-align:center;">
              📥 Загрузить из файла
              <input type="file" id="backupImportFileInput" accept=".json" style="display:none;">
            </label>
          </div>
        </div>
      </div>
    `;
    bindSettingsZoneTabs(bodyEl);
    const passInp = bodyEl.querySelector('#authPinInput');
    const toggleVisBtn = bodyEl.querySelector('#authTogglePassVisBtn');
    if (passInp && toggleVisBtn) {
      toggleVisBtn.addEventListener('click', () => {
        const isPass = passInp.type === 'password';
        passInp.type = isPass ? 'text' : 'password';
        toggleVisBtn.textContent = isPass ? '🙈' : '👁️';
      });
    }
    bodyEl.querySelector('#authSaveBtn')?.addEventListener('click', async () => {
      const saveBtn = bodyEl.querySelector('#authSaveBtn');
      const rawLogin = (bodyEl.querySelector('#authCallsignInput')?.value || '').trim();
      const rawPin = (bodyEl.querySelector('#authPinInput')?.value || '').trim();
      const prevUp = store.getState().userProfile || {};
      if (!rawPin && prevUp.pinHash) {
        const loginToUse = rawLogin || prevUp.login || prevUp.callsign || 'Рыболов';
        const isOwnerMatch = loginToUse.toLowerCase() === 'iathor82' && prevUp.pinHash === OWNER_BOUND_PIN_HASH;
        const fid = isOwnerMatch ? OWNER_BOUND_FISHER_ID : (isValidFisherIdFormat(prevUp.fisherId) ? normalizeFisherId(prevUp.fisherId) : formatFisherIdFromIndex(resolveRussianRegionCode(), fnv1a32(`${loginToUse.toLowerCase()}:${prevUp.pinHash}`) % (26 * 999)));
        store.dispatch({
          type: 'UPDATE_USER_PROFILE',
          payload: {
            login: loginToUse,
            callsign: loginToUse,
            fisherId: fid
          }
        });
        await syncCurrentProfileToCloudIfLoggedIn();
        await copyFisherIdToClipboard(fid, 'Ваш ID рыбака');
        renderAuthBody(bodyEl);
        return;
      }
      if (!rawLogin || rawPin.length < 3) {
        showToast('Введите ваш логин (напр. iAthor82) и пароль (от 3 символов)', 'warn');
        return;
      }
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = '⏳ Синхронизация профиля между устройствами...';
      }
      const res = await authenticateAndSyncAccount(rawLogin, rawPin, 'login');
      if (!res.ok) {
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = '🔑 Войти / Сохранить и синхронизировать профиль';
        }
        showToast(`❌ ${res.error || 'Ошибка входа'}`, 'bad');
        return;
      }
      await copyFisherIdToClipboard(res.fisherId, res.isOwner ? 'Ваш ID Владельца' : 'Ваш ID рыбака');
      if (res.isOwner) {
        showToast(`👑 Добро пожаловать, ${res.login}! Аккаунт Владельца (${res.fisherId}) и права Супер-Админа активированы.`, 'good');
      } else {
        showToast(`✅ Вход выполнен: ${res.login} (ID ${res.fisherId})! Профиль синхронизирован.`, 'good');
      }
      renderAuthBody(bodyEl);
    });
    bodyEl.querySelector('#adminToggleCrewsVisibilityBtn')?.addEventListener('click', () => {
      const cur = store.getState().userProfile?.adminShowAllCrews !== false;
      store.dispatch({
        type: 'UPDATE_USER_PROFILE',
        payload: { adminShowAllCrews: !cur }
      });
      syncCurrentProfileToCloudIfLoggedIn();
      showToast(!cur ? '👑 Отображение всех закрытых экипажей ВКЛЮЧЕНО' : '🙈 Отображение чужих закрытых экипажей скрыто', 'info');
      renderAuthBody(bodyEl);
    });
    bodyEl.querySelector('#adminAddConfirmBtn')?.addEventListener('click', () => {
      const rawId = (bodyEl.querySelector('#adminAddIdInput')?.value || '').trim().toUpperCase();
      const label = (bodyEl.querySelector('#adminAddLabelInput')?.value || '').trim() || 'Модератор Круга';
      if (!rawId) {
        showToast('Введите ID рыбака (напр. FP_77AAA001) или @username', 'warn');
        return;
      }
      const formattedId = rawId.startsWith('@')
        ? rawId
        : normalizeFisherId(rawId, resolveRussianRegionCode());
      const entry = { id: formattedId, label, addedAt: new Date().toISOString().slice(0, 10) };
      store.dispatch({ type: 'ADD_ADMIN_TO_WHITELIST', payload: entry });
      syncAdminWhitelistWithCloud({ action: 'add', entry });
      syncCurrentProfileToCloudIfLoggedIn();
      showToast(`👑 Рыбак ${formattedId} (${label}) добавлен в Базу Администраторов!`, 'good');
      renderAuthBody(bodyEl);
    });
    bodyEl.querySelectorAll('[data-remove-admin-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-remove-admin-id');
        if (!targetId) return;
        store.dispatch({ type: 'REMOVE_ADMIN_FROM_WHITELIST', payload: targetId });
        syncAdminWhitelistWithCloud({ action: 'remove', targetId });
        syncCurrentProfileToCloudIfLoggedIn();
        showToast(`🗑️ ID ${targetId} удалён из Базы Администраторов`, 'info');
        renderAuthBody(bodyEl);
      });
    });
    bodyEl.querySelector('#backupExportBtn')?.addEventListener('click', () => {
      const backup = storage.exportFullProfileBackup(store.getState());
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `klev-pro-profile-${ident.fisherId}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast('📤 Полная резервная копия профиля, точек и чатов выгружена!', 'good');
    });
    const fileInp = bodyEl.querySelector('#backupImportFileInput');
    if (fileInp) {
      fileInp.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
          const text = await file.text();
          const parsed = safeJsonParse(text);
          const ok = await storage.importFullProfileBackup(parsed);
          if (ok) {
            if (parsed.userProfile) {
              store.dispatch({ type: 'UPDATE_USER_PROFILE', payload: parsed.userProfile });
            }
            if (Array.isArray(parsed.savedSpots)) {
              store.dispatch({ type: 'SET_SAVED_SPOTS', payload: parsed.savedSpots });
            }
            if (Array.isArray(parsed.catches)) {
              store.dispatch({ type: 'SET_CATCHES', payload: parsed.catches });
            }
            if (Array.isArray(parsed.circleItems)) {
              store.dispatch({ type: 'SET_CIRCLE_ITEMS', payload: parsed.circleItems });
            }
            if (Array.isArray(parsed.chatMessages)) {
              store.dispatch({ type: 'SET_CHAT_MESSAGES', payload: parsed.chatMessages });
            }
            showToast('✅ Профиль, ключи экипажей, точки и чаты успешно восстановлены!', 'good');
            closeModal();
          } else {
            showToast('❌ Неверный формат файла резервной копии', 'bad');
          }
        } catch (err) {
          showToast('❌ Ошибка чтения файла резервной копии', 'bad');
        }
      });
    }
  }
  openModal('🔐 Профиль: Логин, Пароль и Мой ID', '<div id="authModalMount"></div>', (bodyEl) => {
    renderAuthBody(bodyEl);
  }, true, { onBack: backFn });
}
function formatRemainingHours(expiresAt) {
  const diffMs = (expiresAt || 0) - Date.now();
  if (diffMs <= 0) return 'Истекло';
  const hrs = Math.floor(diffMs / 3600000);
  const mins = Math.floor((diffMs % 3600000) / 60000);
  return `${hrs}ч ${mins}м`;
}
/**
 * Отрисовка выделенной вкладки «💬 Чаты» (Экипажи по ключу + Личные диалоги 1-на-1 + Поделиться уловом в чате)
 */
export function renderChatsSubView(s, ident, visibleCrews) {
  const allMsgs = Array.isArray(s.chatMessages) ? s.chatMessages : [];
  const crewKeysSet = new Set([
    ...ident.unlockedCrewKeys.map(k => String(k).toUpperCase()),
    ...visibleCrews.map(c => String(c.crewKey || '').toUpperCase()).filter(Boolean)
  ]);
  const crewChannels = Array.from(crewKeysSet).map(k => {
    const matchingCrew = visibleCrews.find(c => String(c.crewKey || '').toUpperCase() === k);
    return {
      channelId: `crew:${k}`,
      type: 'crew',
      crewKey: k,
      title: `🌊 Экипаж ${k}${matchingCrew ? ` • ${matchingCrew.wn || matchingCrew.lb}` : ''}`,
      subtitle: 'Постоянный зашифрованный чат членов экипажа (хранится только на ваших устройствах)'
    };
  });
  const dmChannelsMap = new Map();
  for (const m of allMsgs) {
    if (!m || !String(m.channelId || '').startsWith('dm:')) continue;
    const peerId = m.senderId === ident.fisherId ? (m.peerId || 'Рыболов') : m.senderId;
    const peerName = m.senderId === ident.fisherId ? (m.peerName || peerId) : (m.senderName || peerId);
    if (!dmChannelsMap.has(m.channelId)) {
      dmChannelsMap.set(m.channelId, {
        channelId: m.channelId,
        type: 'dm',
        peerId,
        peerName,
        title: `💬 ${peerName} (${peerId})`,
        subtitle: 'Личный E2EE-диалог 1-на-1 (сервер не хранит историю)'
      });
    }
  }
  const dmChannels = Array.from(dmChannelsMap.values());
  const allChannels = [...crewChannels, ...dmChannels];
  if (!activeChatChannelId && allChannels.length > 0) {
    activeChatChannelId = allChannels[0].channelId;
  }
  const activeChan = allChannels.find(c => c.channelId === activeChatChannelId) || allChannels[0] || null;
  if (activeChan && allMsgs.some(m => m && m.channelId === activeChan.channelId && m.unread)) {
    const marked = allMsgs.map(m => (m && m.channelId === activeChan.channelId ? { ...m, unread: false } : m));
    storage.saveChatMessages(marked);
    store.dispatch({ type: 'SET_CHAT_MESSAGES', payload: marked });
    syncCircleNavBadge();
  }
  const activeMsgs = activeChan
    ? allMsgs.filter(m => m && m.channelId === activeChan.channelId)
    : [];
  return `
    <div style="display:flex;flex-direction:column;gap:10px;">
      <!-- Верхняя панель рыбака в Чатах с автокопированием ID и кнопкой Поделиться уловом -->
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;padding:9px 12px;background:var(--card);border:1px solid var(--border);border-radius:var(--r-sm);">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <span style="font-size:var(--fs-xs);color:var(--muted);font-weight:700;">Ваш ID для связи:</span>
          <button type="button" class="btn btn-sm fisher-id-copy-badge" data-copy-fisher-id="${ident.fisherId}" title="Нажмите для автокопирования вашего ID рыбака" style="min-height:28px;padding:2px 9px;font-family:monospace;font-weight:900;border-color:var(--good);color:var(--good);">
            🆔 ${ident.fisherId} 📋
          </button>
          <span style="font-size:var(--fs-xs);font-weight:800;">${ident.callsign}</span>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button type="button" class="btn btn-sm btn-good" id="chatShareCatchTopBtn">🎣 Поделиться уловом в чате</button>
          <button type="button" class="btn btn-sm" id="chatOpenAuthBtn">🔐 Профиль / ID</button>
          <button type="button" class="btn btn-sm" id="chatManualPollRelayBtn" title="Проверить входящие зашифрованные пакеты">🔄 Связь</button>
        </div>
      </div>
      <!-- Компактная панель входа в Экипаж по ключу или старта личного диалога по ID -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px;">
        <div class="card" style="background:var(--card);padding:8px 10px;border:1px solid var(--border);">
          <div style="font-weight:800;font-size:11px;color:var(--accent);margin-bottom:4px;">🌊 ЧАТ ЭКИПАЖА ПО КЛЮЧУ (KP-XXXX):</div>
          <div style="display:flex;gap:6px;">
            <input type="text" id="chatJoinCrewKeyInput" class="input" placeholder="Напр. KP-7A3F" style="flex:1;min-height:34px;text-transform:uppercase;">
            <button type="button" class="btn btn-sm btn-accent" id="chatJoinCrewKeyBtn" style="min-height:34px;">Открыть</button>
          </div>
        </div>
        <div class="card" style="background:var(--card);padding:8px 10px;border:1px solid var(--border);">
          <div style="font-weight:800;font-size:11px;color:var(--good);margin-bottom:4px;">💬 ЛИЧНЫЙ ЧАТ ПО ID РЫБАКА (FP_89AAA001):</div>
          <div style="display:flex;gap:6px;">
            <input type="text" id="chatStartDmIdInput" class="input" placeholder="ID напарника (напр. FP_FMP089)" style="flex:1;min-height:34px;text-transform:uppercase;">
            <button type="button" class="btn btn-sm btn-good" id="chatStartDmBtn" style="min-height:34px;">Написать</button>
          </div>
        </div>
      </div>
      <!-- Список каналов (Экипажи + Личные диалоги) -->
      <div class="chip-scroll-row" style="padding-bottom:2px;">
        ${allChannels.length === 0 ? `
          <span style="font-size:var(--fs-xs);color:var(--muted);">Введите ключ Экипажа <code>KP-XXXX</code>, ID рыбака <code>FP_89AAA001</code> выше или нажмите «🎣 Поделиться уловом в чате».</span>
        ` : allChannels.map(ch => {
          const isAct = activeChan && activeChan.channelId === ch.channelId;
          const unreadCnt = allMsgs.filter(m => m && m.channelId === ch.channelId && m.unread).length;
          return `
            <button type="button" class="btn btn-sm ${isAct ? 'btn-accent' : ''}" data-select-chat-chan="${ch.channelId}">
              ${ch.title} ${unreadCnt > 0 ? `<span class="pill pill-bad" style="font-size:10px;padding:1px 6px;">+${unreadCnt}</span>` : ''}
            </button>
          `;
        }).join('')}
      </div>
      <!-- Окно активного чата -->
      ${activeChan ? `
        <div class="card" style="background:var(--card);padding:10px 12px;border:1.5px solid var(--accent);display:flex;flex-direction:column;gap:8px;">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;border-bottom:1px solid var(--border);padding-bottom:6px;">
            <div>
              <div style="font-weight:800;font-size:var(--fs-sm);color:var(--accent);">${activeChan.title}</div>
              <div style="font-size:10.5px;color:var(--muted);">${activeChan.subtitle}</div>
            </div>
            <div style="display:flex;gap:6px;align-items:center;">
              ${activeChan.crewKey ? `<span class="fisher-id-copy-badge" data-copy-fisher-id="${activeChan.crewKey}" data-copy-label="Ключ экипажа" style="font-size:11px;font-family:monospace;font-weight:800;cursor:pointer;">🔑 ${activeChan.crewKey} 📋</span>` : ''}
              ${activeChan.peerId ? `<span class="fisher-id-copy-badge" data-copy-fisher-id="${activeChan.peerId}" style="font-size:11px;font-family:monospace;font-weight:800;cursor:pointer;">🆔 ${activeChan.peerId} 📋</span>` : ''}
              <button type="button" class="btn btn-sm" id="chatDeleteHistoryBtn" style="color:var(--bad);min-height:28px;padding:2px 8px;">🗑️ Очистить</button>
            </div>
          </div>
          <div id="chatMessagesScrollBox" style="display:flex;flex-direction:column;gap:8px;max-height:320px;overflow-y:auto;padding:4px 2px;">
            ${activeMsgs.length === 0 ? `
              <div style="padding:16px;text-align:center;color:var(--muted);font-size:var(--fs-xs);">
                Сообщений пока нет. Напишите напарникам или нажмите <b>«🎣 Улов»</b> внизу, чтобы отправить карточку пойманной рыбы!
              </div>
            ` : activeMsgs.map(m => {
              const isMe = m.senderId === ident.fisherId;
              const timeStr = new Date(m.ts || Date.now()).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
              const tokenMatch = String(m.text || '').match(/KP1_[A-Za-z0-9_-]+/);
              const packTok = m.catchMeta?.token || (tokenMatch ? tokenMatch[0] : '');
              return `
                <div style="align-self:${isMe ? 'flex-end' : 'flex-start'};max-width:88%;padding:8px 11px;border-radius:12px;background:${isMe ? 'rgba(56,189,248,0.16)' : 'var(--panel)'};border:1px solid ${isMe ? 'var(--accent)' : 'var(--border)'};font-size:var(--fs-xs);">
                  <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:3px;flex-wrap:wrap;">
                    <b style="color:${isMe ? 'var(--accent)' : 'var(--good)'};">${isMe ? `Вы (${escapeHtml(m.senderName)})` : `${escapeHtml(m.senderName)}`}</b>
                    ${m.senderId ? `<span class="fisher-id-copy-badge" data-copy-fisher-id="${m.senderId}" title="Скопировать ID автора" style="font-family:monospace;font-size:10.5px;cursor:pointer;">🆔 ${m.senderId} 📋</span>` : ''}
                    <span style="font-size:10px;color:var(--muted);">🔒 ${timeStr}</span>
                  </div>
                  <div style="white-space:pre-wrap;line-height:1.42;color:var(--text);">${escapeHtml(m.text)}</div>
                  ${packTok ? `
                    <div style="margin-top:6px;padding-top:5px;border-top:1px dashed var(--border);display:flex;gap:6px;flex-wrap:wrap;">
                      <button type="button" class="btn btn-sm btn-good" data-chat-import-pack="${packTok}" style="min-height:26px;padding:2px 8px;font-size:11px;">🗺️ Открыть точку улова на карте</button>
                    </div>
                  ` : ''}
                </div>
              `;
            }).join('')}
          </div>
          <div style="display:flex;gap:6px;padding-top:6px;border-top:1px solid var(--border);align-items:center;">
            <button type="button" class="btn btn-sm btn-good" id="chatAttachCatchBtn" title="Поделиться уловом из журнала или текущим клёвом в этом чате" style="min-height:38px;padding:0 10px;flex-shrink:0;">🎣 Улов</button>
            <input type="text" id="chatComposeInput" class="input" placeholder="Зашифрованное сообщение..." style="flex:1;min-height:38px;">
            <button type="button" class="btn btn-accent" id="chatSendMsgBtn" style="min-height:38px;padding:0 14px;flex-shrink:0;">➤</button>
          </div>
        </div>
      ` : ''}
    </div>
  `;
}
/**
 * Строит компактную 1-строчную (аккордеон) строку события для ленты «👥 Круг»,
 * разделяя «👤 Мои» (с кнопкой 🗑️ Удалить) и «🌐 Чужие» (с кнопкой 🙈 Скрыть / 👁️ Вернуть)
 */
function renderCompactCircleRow(item, s, ident, now) {
  const mine = isCircleItemMine(item, s);
  const hidden = isCircleItemHidden(item, s);
  const isExpanded = expandedCompactIds.has(item.id);
  const itemFid = item.fid || (mine ? ident.fisherId : 'FP_89AAA001');
  const ageMin = Math.max(1, Math.round((now - (item.ca || now)) / 60000));
  const ageLabel = ageMin < 60 ? `${ageMin} мин` : `${Math.round(ageMin / 60)} ч`;
  let catBadge = '';
  let titleText = '';
  let subMetaText = '';
  let rowBorderColor = mine ? 'rgba(16,185,129,0.55)' : 'var(--border)';
  let rowBg = 'var(--card)';
  if (item.t === 'crew' && item.sos) {
    catBadge = `<span class="pill pill-bad" style="font-size:10px;padding:1px 6px;">🆘 SOS</span>`;
    titleText = `${item.lb || 'Водоём'}${item.wn && item.wn !== item.lb ? ` • ${item.wn}` : ''}`;
    subMetaText = `🎯 ${Number(item.lat).toFixed(3)}°N, ${Number(item.lon).toFixed(3)}°E • ⏳ ${formatRemainingHours(item.ea)}`;
    rowBorderColor = 'var(--bad)';
    rowBg = 'rgba(239,68,68,0.08)';
  } else if (item.t === 'crew') {
    const cKey = item.crewKey || formatCrewKeyFromHash(computeCrewKeyHash(item.id));
    catBadge = `<span class="pill pill-ice" style="font-size:10px;padding:1px 6px;">🌊 Экипаж ${cKey}</span>`;
    titleText = `${item.fn || 'Рыба'} • ${item.wn || item.lb || 'Точка'}`;
    subMetaText = `📏 ${item.dp || 2}м • 💧 ${item.tw ?? 8}°C • ⏳ ${formatRemainingHours(item.ea)}`;
  } else if (item.t === 'workshop') {
    catBadge = `<span class="pill pill-warn" style="font-size:10px;padding:1px 6px;">🛠️ Снасть</span>`;
    titleText = `${item.fn || 'Рыба'}: ${(item.rw || 'Монтаж').split(',')[0]}`;
    subMetaText = `🪱 ${item.bt || 'приманка'} • 💧 ${item.twMin ?? 4}..${item.twMax ?? 16}°C`;
  } else {
    const effR = getEffectiveCircleRadiusKm(item, now);
    catBadge = `<span class="pill pill-good" style="font-size:10px;padding:1px 6px;">⬡ ±${effR}км</span>`;
    titleText = `${item.fn || 'Рыба'}${item.kg ? ` (${item.kg} кг)` : ''} • ${item.wn || item.lb || 'Сектор'}`;
    subMetaText = `🪱 ${item.bt || 'по сезону'} • 💧 ${item.tw ?? 8}°C • ${ageLabel}`;
  }
  const ownerPill = mine
    ? `<span class="pill pill-good" style="font-size:10px;padding:1px 6px;">👤 Моё</span>`
    : `<span class="pill pill-neutral" style="font-size:10px;padding:1px 6px;">🌐 Чужое</span>`;
  const fidBadge = `<span class="fisher-id-copy-badge" data-copy-fisher-id="${itemFid}" title="Нажмите для автокопирования ID рыбака" style="font-family:monospace;font-size:10.5px;font-weight:900;padding:1px 6px;border-radius:4px;background:var(--panel);border:1px solid var(--border);cursor:pointer;">🆔 ${itemFid} 📋</span>`;
  const cKey = item.t === 'crew' && !item.sos ? (item.crewKey || formatCrewKeyFromHash(computeCrewKeyHash(item.id))) : '';
  return `
    <div class="circle-compact-row" style="background:${rowBg};border:1px solid ${rowBorderColor};border-radius:var(--r-sm);padding:7px 10px;display:flex;flex-direction:column;gap:6px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;flex:1;min-width:190px;cursor:pointer;" data-toggle-compact-row="${item.id}">
          ${catBadge}
          ${ownerPill}
          <span style="font-weight:800;font-size:var(--fs-xs);color:var(--text);">${titleText}</span>
          <span style="font-size:11px;color:var(--muted);">${subMetaText}</span>
        </div>
        <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;flex-wrap:wrap;">
          ${fidBadge}
          ${item.t !== 'workshop' ? `<button type="button" class="btn btn-sm" data-goto-circle="${item.id}" title="Показать на карте" style="min-height:26px;padding:2px 7px;font-size:11px;">🗺️</button>` : `<button type="button" class="btn btn-sm btn-good" data-apply-workshop="${item.id}" title="Применить снасть" style="min-height:26px;padding:2px 7px;font-size:11px;">✅</button>`}
          ${cKey ? `<button type="button" class="btn btn-sm btn-accent" data-open-crew-chat="${cKey}" title="Открыть чат экипажа" style="min-height:26px;padding:2px 7px;font-size:11px;">💬</button>` : `<button type="button" class="btn btn-sm" data-open-dm="${itemFid}" data-open-dm-name="${item.au || itemFid}" title="Написать рыбаку в чат" style="min-height:26px;padding:2px 7px;font-size:11px;">💬</button>`}
          ${mine ? `
            <button type="button" class="btn btn-sm" data-del-my-circle="${item.id}" title="Удалить мою запись" style="min-height:26px;padding:2px 7px;font-size:11px;color:var(--bad);border-color:rgba(239,68,68,0.4);">🗑️ Удалить</button>
          ` : (hidden ? `
            <button type="button" class="btn btn-sm btn-good" data-unhide-circle="${item.id}" title="Вернуть запись в ленту и на карту" style="min-height:26px;padding:2px 7px;font-size:11px;">👁️ Вернуть</button>
          ` : `
            <button type="button" class="btn btn-sm" data-hide-foreign-circle="${item.id}" title="Скрыть чужую запись из ленты и с карты" style="min-height:26px;padding:2px 7px;font-size:11px;color:var(--muted);">🙈 Скрыть</button>
          `)}
          <button type="button" class="btn btn-sm" data-toggle-compact-row="${item.id}" title="Развернуть / свернуть подробности" style="min-height:26px;padding:2px 6px;font-size:11px;">${isExpanded ? '▴' : '▾'}</button>
        </div>
      </div>
      ${isExpanded ? `
        <div style="padding-top:6px;border-top:1px dashed var(--border);font-size:var(--fs-xs);color:var(--muted);display:flex;flex-direction:column;gap:4px;">
          <div>
            👤 Автор: <b style="color:var(--text);">${item.au || 'Рыболов'}</b> (${fidBadge}) •
            ${item.t === 'crew'
              ? `🎯 Точные координаты: <b>${Number(item.lat).toFixed(4)}°N, ${Number(item.lon).toFixed(4)}°E</b> (глубина ${item.dp || 2} м)`
              : (item.t === 'workshop'
                  ? `🌊 Условия: ${item.fl || 'течение'}, глубина ~${item.dp || 2} м • Леска: ${item.rl || '—'} • Подача: ${item.rt || '—'}`
                  : `⬡ Гексагон анти-триангуляции ±${getEffectiveCircleRadiusKm(item, now)} км • Глубина ~${item.dp || 2} м • 🧭 ${item.pr ?? 754} мм`)}
          </div>
          ${item.nt ? `<div style="color:var(--accent);font-weight:700;">💬 ${escapeHtml(item.nt)}</div>` : ''}
        </div>
      ` : ''}
    </div>
  `;
}
/**
 * Отрисовка выделенной секции «💬 Чаты» (#secChats)
 */
export function renderChatsSection(customContainer = null) {
  const container = customContainer || (typeof document !== 'undefined' ? document.getElementById('secChats') : null);
  if (!container) return;
  const s = store.getState();
  const ident = getCurrentFisherIdentity(s);
  const allItems = purgeExpiredCircleItems(s.circleItems || []);
  const visibleCrews = allItems.filter(x => x.t === 'crew' && !x.sos && canUserAccessCrewItem(x, s));
  container.innerHTML = `
    <div class="card">
      <div class="section-head" style="margin-bottom:8px;">
        <div>
          <span class="section-title">💬 Зашифрованные Чаты Экипажей и Рыбаков (Zero-Storage E2EE)</span>
          <div style="font-size:var(--fs-xs);color:var(--muted);margin-top:2px;">
            Без общих спам-чатов • Переписка и карточки уловов шифруются на устройстве и хранятся только у участников
          </div>
        </div>
      </div>
      ${renderChatsSubView(s, ident, visibleCrews)}
    </div>
  `;
  bindChatViewEvents(container);
}
/**
 * Отрисовка вкладки «👥 Круг» (компактная лента с разделением «👤 Мои» / «🌐 Чужие» / «👁️ Скрытые»)
 */
export function render(container) {
  if (!container) return;
  const s = store.getState();
  const now = Date.now();
  const day = s.weatherDays?.[s.dayIdx] || s.weatherDays?.[2] || s.weatherDays?.[0] || {};
  const curWT = day.waterTemp ?? 10;
  const ident = getCurrentFisherIdentity(s);
  const allItems = purgeExpiredCircleItems(s.circleItems || []);
  const accessibleItems = allItems.filter(item => {
    if (item.t === 'crew' && !item.sos) return canUserAccessCrewItem(item, s);
    return true;
  });
  const hiddenLockedCrewsCount = allItems.filter(x => x.t === 'crew' && !x.sos && !canUserAccessCrewItem(x, s)).length;
  const nonHiddenItems = accessibleItems.filter(x => !isCircleItemHidden(x, s));
  const hiddenItems = accessibleItems.filter(x => isCircleItemHidden(x, s));
  const mineItems = nonHiddenItems.filter(x => isCircleItemMine(x, s));
  const foreignItems = nonHiddenItems.filter(x => !isCircleItemMine(x, s));
  let baseList = nonHiddenItems;
  if (activeOwnershipFilter === 'mine') baseList = mineItems;
  else if (activeOwnershipFilter === 'foreign') baseList = foreignItems;
  else if (activeOwnershipFilter === 'hidden') baseList = hiddenItems;
  const filteredList = baseList.filter(item => {
    if (activeCategoryFilter === 'sos') return item.t === 'crew' && Boolean(item.sos);
    if (activeCategoryFilter === 'crew') return item.t === 'crew' && !item.sos;
    if (activeCategoryFilter === 'circle') return item.t === 'circle';
    if (activeCategoryFilter === 'workshop') return item.t === 'workshop';
    return true;
  });
  const unreadNotifsCount = (s.notifications || []).filter(n => n && !n.read).length;
  const unreadChatsCount = (s.chatMessages || []).filter(m => m && m.unread).length;
  const expertRank = getUserExpertRank(s.catches || []);
  container.innerHTML = `
    <div class="card">
      <div class="section-head">
        <div>
          <span class="section-title">👥 «Клёв ПРО: Круг» • Компактный радар точек и Экипажей</span>
          <div style="font-size:var(--fs-xs);color:var(--accent);font-weight:700;margin-top:2px;">
            Разделение «👤 Мои (удаление) / 🌐 Чужие (скрытие)» • Автопривязка 🆔 ${ident.fisherId} ко всем точкам
          </div>
        </div>
        <div class="toolbar-row">
          <button type="button" class="btn btn-sm btn-good" id="circleCreatePackBtn">🤝 Поделиться</button>
          <button type="button" class="btn btn-sm" id="circleSosBtn" style="border-color:var(--bad);color:#fff;background:var(--bad);font-weight:800;">🆘 SOS ВСЕМ</button>
          <button type="button" class="btn btn-sm btn-accent" id="circleImportPackBtn">🔑 Ключ / Код KP1</button>
          <button type="button" class="btn btn-sm" id="circleNotifBtn">
            🔔 Уведомления ${unreadNotifsCount > 0 ? `<span class="pill pill-bad" style="font-size:10px;padding:1px 5px;">+${unreadNotifsCount}</span>` : ''}
          </button>
        </div>
      </div>
      <!-- Компактная строка профиля рыбака с автокопированием ID в 1 клик и переходом в Чаты -->
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;padding:8px 11px;background:var(--card);border:1px solid var(--border);border-radius:var(--r-sm);margin-bottom:10px;">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <button type="button" class="btn btn-sm fisher-id-copy-badge" data-copy-fisher-id="${ident.fisherId}" title="Нажмите для автокопирования вашего ID рыбака" style="min-height:30px;padding:2px 9px;font-family:monospace;font-weight:900;border-color:var(--good);color:var(--good);">
            🆔 ${ident.fisherId} 📋
          </button>
          <input type="text" id="circleCallsignInput" class="input" value="${ident.callsign}" placeholder="Ваш позывной..." style="max-width:145px;min-height:30px;padding:2px 8px;font-size:var(--fs-xs);font-weight:800;">
          <button type="button" class="btn btn-sm" id="circleSaveCallsignBtn" style="min-height:30px;padding:2px 8px;" title="Сохранить позывной">💾</button>
          <button type="button" class="btn btn-sm ${ident.isAdmin ? 'btn-good' : ''}" id="circleAuthModalBtn" style="min-height:30px;">
            ${ident.isOwner ? '👑 Супер-Админ (База)' : (ident.isAdmin ? '👑 Админ • Профиль' : '🔐 Профиль / Бэкап')}
          </button>
          ${createPill({ text: `${expertRank.badge}`, tone: expertRank.tier === 'expert' ? 'good' : 'neutral' })}
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          <button type="button" class="btn btn-sm btn-accent" id="circleJumpToChatsTabBtn" style="min-height:30px;">
            💬 Открыть Чаты (${(s.chatMessages || []).length}) ${unreadChatsCount > 0 ? `<span class="pill pill-bad" style="font-size:10px;padding:1px 5px;">+${unreadChatsCount}</span>` : ''}
          </button>
          <button type="button" class="btn btn-sm" id="circleDemoSeedBtn" style="min-height:30px;" title="Загрузить примеры своих и чужих точек для проверки">✨ Тест</button>
        </div>
      </div>
      <!-- Быстрые кнопки отправки (1 компактная строка вместо огромных карточек) -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:6px;margin-bottom:10px;">
        <button type="button" class="btn btn-sm btn-accent" data-quick-share="crew">🌊 Создать Экипаж (72ч)</button>
        <button type="button" class="btn btn-sm btn-good" data-quick-share="circle">👥 Сводка в Круг (±5км)</button>
        <button type="button" class="btn btn-sm" data-quick-share="workshop" style="border-color:var(--warn);color:var(--warn);">🛠️ Снасть в Мастерскую (${curWT}°C)</button>
        <button type="button" class="btn btn-sm" id="circleShareCatchToChatBtn">🎣 Улов в Чат</button>
      </div>
      <!-- Фильтр 1: РАЗДЕЛЕНИЕ «МОИ — ЧУЖИЕ — СКРЫТЫЕ» -->
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:8px;padding:7px 10px;background:var(--card);border:1px solid var(--border);border-radius:var(--r-sm);">
        <div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;">
          <button type="button" class="btn btn-sm ${activeOwnershipFilter === 'all' ? 'btn-accent' : ''}" data-circle-owner="all" style="min-height:30px;padding:3px 9px;">
            Все (${nonHiddenItems.length})
          </button>
          <button type="button" class="btn btn-sm ${activeOwnershipFilter === 'mine' ? 'btn-good' : ''}" data-circle-owner="mine" style="min-height:30px;padding:3px 9px;">
            👤 Мои • удаление (${mineItems.length})
          </button>
          <button type="button" class="btn btn-sm ${activeOwnershipFilter === 'foreign' ? 'btn-accent' : ''}" data-circle-owner="foreign" style="min-height:30px;padding:3px 9px;">
            🌐 Чужие • скрытие (${foreignItems.length})
          </button>
          <button type="button" class="btn btn-sm ${activeOwnershipFilter === 'hidden' ? 'btn-accent' : ''}" data-circle-owner="hidden" style="min-height:30px;padding:3px 9px;">
            👁️ Скрытые (${hiddenItems.length})
          </button>
        </div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;">
          ${hiddenItems.length > 0 && activeOwnershipFilter === 'hidden' ? `
            <button type="button" class="btn btn-sm" id="circleUnhideAllBtn" style="min-height:28px;font-size:11px;">👁️ Вернуть все (${hiddenItems.length})</button>
          ` : ''}
          ${hiddenLockedCrewsCount > 0 ? `
            <button type="button" class="btn btn-sm" id="circleUnlockHiddenCrewBtn" style="min-height:28px;font-size:11px;border-color:var(--accent);color:var(--accent);">🔒 Закрытых без ключа: ${hiddenLockedCrewsCount}</button>
          ` : ''}
        </div>
      </div>
      <!-- Фильтр 2: Категории (Все / SOS / Экипаж / Круг / Снасти) -->
      <div class="chip-scroll-row" style="margin-bottom:8px;">
        <button type="button" class="w-chip ${activeCategoryFilter === 'all' ? 'active' : ''}" data-circle-cat="all">Все типы (${baseList.length})</button>
        <button type="button" class="w-chip ${activeCategoryFilter === 'sos' ? 'active' : ''}" data-circle-cat="sos">🆘 SOS (${baseList.filter(x => x.t === 'crew' && x.sos).length})</button>
        <button type="button" class="w-chip ${activeCategoryFilter === 'crew' ? 'active' : ''}" data-circle-cat="crew">🌊 Экипаж 72ч (${baseList.filter(x => x.t === 'crew' && !x.sos).length})</button>
        <button type="button" class="w-chip ${activeCategoryFilter === 'circle' ? 'active' : ''}" data-circle-cat="circle">👥 Круг ±5км (${baseList.filter(x => x.t === 'circle').length})</button>
        <button type="button" class="w-chip ${activeCategoryFilter === 'workshop' ? 'active' : ''}" data-circle-cat="workshop">🛠️ Мастерская (${baseList.filter(x => x.t === 'workshop').length})</button>
      </div>
      <!-- Компактный список событий (без громоздких карточек!) -->
      <div class="circle-compact-list" style="display:flex;flex-direction:column;gap:6px;">
        ${filteredList.length === 0 ? `
          <div style="padding:14px;background:var(--card);border:1px dashed var(--border);border-radius:var(--r-sm);font-size:var(--fs-xs);color:var(--muted);text-align:center;">
            ${activeOwnershipFilter === 'mine'
              ? `У вас пока нет собственных опубликованных точек (с вашим ID <b>${ident.fisherId}</b>). Нажмите «🤝 Поделиться» выше, чтобы создать свою точку.`
              : (activeOwnershipFilter === 'hidden'
                  ? 'Скрытых чужих точек сейчас нет.'
                  : 'В выбранной категории пока нет записей. Нажмите «✨ Тест» выше для проверки компактной ленты «Мои / Чужие»!')}
          </div>
        ` : filteredList.map(item => renderCompactCircleRow(item, s, ident, now)).join('')}
      </div>
    </div>
  `;
  bindCircleEvents(container);
}
function bindChatViewEvents(container) {
  if (!container) return;
  container.querySelector('#chatShareCatchTopBtn')?.addEventListener('click', () => {
    openShareCatchToChatModal(null);
  });
  container.querySelector('#chatAttachCatchBtn')?.addEventListener('click', () => {
    openShareCatchToChatModal(null);
  });
  container.querySelector('#chatOpenAuthBtn')?.addEventListener('click', () => {
    openAuthAndBackupModal();
  });
  container.querySelectorAll('[data-select-chat-chan]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeChatChannelId = btn.getAttribute('data-select-chat-chan') || '';
      renderChatsSection(container);
    });
  });
  container.querySelectorAll('[data-chat-import-pack]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tok = btn.getAttribute('data-chat-import-pack');
      if (!tok) return;
      const dec = await importSharePackToken(tok, false, true);
      if (dec && Number.isFinite(dec.lat) && Number.isFinite(dec.lon)) {
        setLocation(dec.lat, dec.lon, true);
        router.navigate('geo');
      }
    });
  });
  const joinCrewBtn = container.querySelector('#chatJoinCrewKeyBtn');
  const joinCrewInp = container.querySelector('#chatJoinCrewKeyInput');
  if (joinCrewBtn && joinCrewInp) {
    joinCrewBtn.addEventListener('click', () => {
      const raw = (joinCrewInp.value || '').trim().toUpperCase();
      if (!raw) {
        showToast('Введите 4-значный ключ экипажа (например: KP-7A3F)', 'warn');
        return;
      }
      const formatted = raw.startsWith('KP-') ? raw : `KP-${raw.replace(/[^0-9A-F]/g, '').slice(0, 4).padStart(4, '0')}`;
      store.dispatch({ type: 'UNLOCK_CREW_KEY', payload: formatted });
      activeChatChannelId = `crew:${formatted}`;
      showToast(`🔓 Вы подключились к чату экипажа ${formatted}`, 'good');
      renderChatsSection(container);
    });
  }
  const startDmBtn = container.querySelector('#chatStartDmBtn');
  const startDmInp = container.querySelector('#chatStartDmIdInput');
  if (startDmBtn && startDmInp) {
    startDmBtn.addEventListener('click', () => {
      const raw = (startDmInp.value || '').trim().toUpperCase();
      if (!raw) {
        showToast('Введите ID рыбака (например: FP_FMP089)', 'warn');
        return;
      }
      const peerId = normalizeFisherId(raw, resolveRussianRegionCode());
      const ident = getCurrentFisherIdentity();
      const chanId = `dm:${[ident.fisherId, peerId].sort().join(':')}`;
      activeChatChannelId = chanId;
      appendIncomingChatMessage({
        id: `sys_${Date.now()}`,
        channelId: chanId,
        peerId,
        peerName: `Рыбак ${peerId}`,
        senderId: ident.fisherId,
        senderName: ident.callsign,
        text: `🔒 Личный зашифрованный чат с ${peerId} открыт (история хранится только на ваших устройствах).`,
        ts: Date.now(),
        e2ee: true,
        unread: false
      }, false);
      renderChatsSection(container);
    });
  }
  container.querySelector('#chatManualPollRelayBtn')?.addEventListener('click', () => {
    pollEncryptedRelayPackets(true);
  });
  container.querySelector('#chatDeleteHistoryBtn')?.addEventListener('click', () => {
    if (!activeChatChannelId) return;
    const remaining = (store.getState().chatMessages || []).filter(m => m && m.channelId !== activeChatChannelId);
    storage.saveChatMessages(remaining);
    store.dispatch({ type: 'SET_CHAT_MESSAGES', payload: remaining });
    showToast('История этого чата удалена с вашего устройства', 'info');
    renderChatsSection(container);
  });
  const chatInput = container.querySelector('#chatComposeInput');
  const chatSendBtn = container.querySelector('#chatSendMsgBtn');
  if (chatInput && chatSendBtn) {
    const triggerSend = async () => {
      const val = (chatInput.value || '').trim();
      if (!val || !activeChatChannelId) return;
      chatInput.value = '';
      if (activeChatChannelId.startsWith('crew:')) {
        const cKey = activeChatChannelId.replace(/^crew:/, '');
        await sendFishermanChatMessage({ channelId: activeChatChannelId, text: val, crewKey: cKey });
      } else {
        const parts = activeChatChannelId.replace(/^dm:/, '').split(':');
        const ident = getCurrentFisherIdentity();
        const peerId = parts.find(p => p !== ident.fisherId) || parts[0] || '';
        await sendFishermanChatMessage({ channelId: activeChatChannelId, text: val, peerId });
      }
      renderChatsSection(container);
      const scrollBox = container.querySelector('#chatMessagesScrollBox');
      if (scrollBox) scrollBox.scrollTop = scrollBox.scrollHeight;
    };
    chatSendBtn.addEventListener('click', triggerSend);
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        triggerSend();
      }
    });
  }
}
function bindCircleEvents(container) {
  container.querySelector('#circleCreatePackBtn')?.addEventListener('click', () => {
    openShareModalForCurrentContext('circle');
  });
  container.querySelector('#circleSosBtn')?.addEventListener('click', () => {
    openShareModalForCurrentContext('sos');
  });
  container.querySelector('#circleImportPackBtn')?.addEventListener('click', () => {
    openImportPackModal();
  });
  container.querySelector('#circleUnlockHiddenCrewBtn')?.addEventListener('click', () => {
    openImportPackModal();
  });
  container.querySelector('#circleNotifBtn')?.addEventListener('click', () => {
    openNotificationsModal();
  });
  container.querySelector('#circleAuthModalBtn')?.addEventListener('click', () => {
    openAuthAndBackupModal();
  });
  container.querySelector('#circleJumpToChatsTabBtn')?.addEventListener('click', () => {
    router.navigate('chats');
    renderChatsSection();
  });
  container.querySelector('#circleShareCatchToChatBtn')?.addEventListener('click', () => {
    openShareCatchToChatModal(null);
  });
  container.querySelectorAll('[data-circle-owner]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeOwnershipFilter = btn.getAttribute('data-circle-owner') || 'all';
      render(container);
    });
  });
  container.querySelectorAll('[data-circle-cat]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeCategoryFilter = btn.getAttribute('data-circle-cat') || 'all';
      render(container);
    });
  });
  container.querySelector('#circleUnhideAllBtn')?.addEventListener('click', () => {
    store.dispatch({ type: 'CLEAR_HIDDEN_CIRCLE_ITEMS' });
    activeOwnershipFilter = 'all';
    showToast('👁️ Все скрытые записи возвращены в ленту и на карту', 'good');
    render(container);
  });
  container.querySelectorAll('[data-toggle-compact-row]').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-copy-fisher-id]')) return;
      const id = el.getAttribute('data-toggle-compact-row');
      if (!id) return;
      if (expandedCompactIds.has(id)) expandedCompactIds.delete(id);
      else expandedCompactIds.add(id);
      render(container);
    });
  });
  container.querySelectorAll('[data-quick-share]').forEach(btn => {
    btn.addEventListener('click', () => {
      openShareModalForCurrentContext(btn.getAttribute('data-quick-share'));
    });
  });
  const saveCallsignBtn = container.querySelector('#circleSaveCallsignBtn');
  const callsignInput = container.querySelector('#circleCallsignInput');
  if (saveCallsignBtn && callsignInput) {
    saveCallsignBtn.addEventListener('click', () => {
      const val = (callsignInput.value || '').trim() || 'Рыболов';
      store.dispatch({ type: 'SET_USER_CALLSIGN', payload: val });
      showToast(`Позывной в Круге сохранён: ${val}`, 'good');
    });
  }
  container.querySelectorAll('[data-open-crew-chat]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cKey = btn.getAttribute('data-open-crew-chat');
      if (cKey) {
        store.dispatch({ type: 'UNLOCK_CREW_KEY', payload: cKey });
        activeChatChannelId = `crew:${cKey}`;
        router.navigate('chats');
        renderChatsSection();
      }
    });
  });
  container.querySelectorAll('[data-open-dm]').forEach(btn => {
    btn.addEventListener('click', () => {
      const peerId = String(btn.getAttribute('data-open-dm') || '').toUpperCase();
      const peerName = btn.getAttribute('data-open-dm-name') || peerId;
      if (!peerId) return;
      const ident = getCurrentFisherIdentity();
      const sortedPair = [ident.fisherId, peerId].sort().join(':');
      const chanId = `dm:${sortedPair}`;
      activeChatChannelId = chanId;
      const existing = store.getState().chatMessages || [];
      if (!existing.some(m => m && m.channelId === chanId)) {
        appendIncomingChatMessage({
          id: `sys_${Date.now()}`,
          channelId: chanId,
          peerId,
          peerName,
          senderId: ident.fisherId,
          senderName: ident.callsign,
          text: `👋 Открыт защищённый личный диалог (E2EE) с рыбаком ${peerName} (${peerId}).`,
          ts: Date.now(),
          e2ee: true,
          unread: false
        }, false);
      }
      router.navigate('chats');
      renderChatsSection();
    });
  });
  const demoBtn = container.querySelector('#circleDemoSeedBtn');
  if (demoBtn) {
    demoBtn.addEventListener('click', async () => {
      const s = store.getState();
      const ident = getCurrentFisherIdentity(s);
      const myPack = createSharePackFromContext('circle', 'Моя личная точка (доступна кнопка Удалить)');
      myPack.packObj.fid = ident.fisherId;
      myPack.packObj.did = ident.deviceId;
      myPack.packObj.au = ident.callsign;
      myPack.packObj.isDemoSeed = false;
      const p1 = createSharePackFromContext('circle', 'Выход на свале 2.5м, пауза 4 сек');
      p1.packObj.did = 'demo_external_expert_1';
      p1.packObj.fid = 'FP_89AAA001';
      p1.packObj.au = 'Северянин-89';
      p1.packObj.rk = 'expert';
      p1.packObj.rw_w = 1.5;
      p1.packObj.isDemoSeed = true;
      const t1 = encodeSharePack(p1.packObj);
      await importSharePackToken(t1, true, true);
      const p2 = createSharePackFromContext('crew', 'Сбор у лодочного спуска в 06:30', null, 'KP-7A3F');
      p2.packObj.did = 'demo_external_crew_2';
      p2.packObj.fid = 'FP_77AAA001';
      p2.packObj.au = 'Капитан Обь';
      p2.packObj.crewKey = 'KP-7A3F';
      p2.packObj.isDemoSeed = true;
      const t2 = encodeSharePack(p2.packObj);
      await importSharePackToken(t2, true, true);
      const lockedCrew = {
        ...p2.packObj,
        id: `crew_locked_${Date.now().toString(36)}`,
        crewKey: 'KP-99C4',
        did: 'stranger_device_99',
        fid: 'FP_89AAB001',
        au: 'Закрытая Бригада',
        lat: Math.round((s.lat + 0.018) * 10000) / 10000,
        lon: Math.round((s.lon + 0.022) * 10000) / 10000,
        nt: 'Секретная точка чужого экипажа (видна только Админам из базы или по ключу KP-99C4)',
        isLockedExternalCrew: true,
        isDemoSeed: true
      };
      const curList = store.getState().circleItems || [];
      const combined = [myPack.packObj, lockedCrew, ...curList].slice(0, 80);
      storage.saveCircleItems(combined);
      store.dispatch({ type: 'SET_CIRCLE_ITEMS', payload: combined });
      appendIncomingChatMessage({
        id: `demo_msg_${Date.now()}`,
        channelId: 'crew:KP-7A3F',
        crewKey: 'KP-7A3F',
        senderId: 'FP_77AAA001',
        senderName: 'Капитан Обь',
        text: `Парни, в точке (${s.locLabel}) эхолот показывает бель на бровке ${s.depth.toFixed(1)} м! Скидывайте свои уловы кнопкой «🎣 Улов».`,
        ts: Date.now(),
        e2ee: true
      }, true);
      showToast(`✨ Добавлены: 1 ваша точка (🆔 ${ident.fisherId}, можно удалить) и чужие точки (можно скрыть)!`, 'good');
    });
  }
  container.querySelectorAll('[data-del-my-circle]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-del-my-circle');
      const target = (store.getState().circleItems || []).find(x => x.id === id);
      if (target && !isCircleItemMine(target, store.getState())) {
        showToast('Чужие записи нельзя удалить — используйте кнопку «🙈 Скрыть»', 'warn');
        return;
      }
      const next = (store.getState().circleItems || []).filter(x => x.id !== id);
      storage.saveCircleItems(next);
      store.dispatch({ type: 'SET_CIRCLE_ITEMS', payload: next });
      showToast('🗑️ Ваша точка удалена из Круга и с карты', 'info');
    });
  });
  container.querySelectorAll('[data-hide-foreign-circle]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-hide-foreign-circle');
      if (!id) return;
      store.dispatch({ type: 'HIDE_CIRCLE_ITEM', payload: id });
      showToast('🙈 Чужая точка скрыта из ленты и с карты (доступна в фильтре «👁️ Скрытые»)', 'info');
    });
  });
  container.querySelectorAll('[data-unhide-circle]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-unhide-circle');
      if (!id) return;
      store.dispatch({ type: 'UNHIDE_CIRCLE_ITEM', payload: id });
      showToast('👁️ Запись возвращена в ленту и на карту', 'good');
    });
  });
  container.querySelectorAll('[data-goto-circle]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-goto-circle');
      const item = (store.getState().circleItems || []).find(x => x.id === id);
      if (item && Number.isFinite(item.lat) && Number.isFinite(item.lon)) {
        setLocation(item.lat, item.lon, true);
        router.navigate('geo');
        showToast(
          item.sos
            ? `🆘 Пеленг сигнала SOS: ${item.wn || item.lb} (🆔 ${item.fid || ''})`
            : (item.t === 'crew'
                ? `🌊 Точка Экипажа (${item.crewKey || '72ч'}): ${item.wn || item.lb}`
                : `⬡ Гексагон Круга (±${getEffectiveCircleRadiusKm(item)} км): ${item.wn || item.lb}`),
          'info'
        );
      }
    });
  });
  container.querySelectorAll('[data-apply-workshop]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-apply-workshop');
      const item = (store.getState().circleItems || []).find(x => x.id === id);
      if (item) {
        if (item.fi) store.dispatch({ type: 'SET_FISH', payload: item.fi });
        if (item.mt) store.dispatch({ type: 'SET_METHOD', payload: item.mt });
        if (item.bt) store.dispatch({ type: 'SET_BAIT', payload: item.bt });
        if (Number.isFinite(item.dp)) store.dispatch({ type: 'SET_DEPTH', payload: item.dp });
        showToast(`✅ Применена оснастка из Мастерской для вида «${item.fn}»!`, 'good');
        router.navigate('forecast');
      }
    });
  });
}
let unsub = null;
export async function init(container, chatsContainer = null) {
  const savedItems = purgeExpiredCircleItems(storage.loadCircleItems ? storage.loadCircleItems() : []);
  store.dispatch({ type: 'SET_CIRCLE_ITEMS', payload: savedItems });
  const savedChats = storage.loadChatMessages ? storage.loadChatMessages() : [];
  store.dispatch({ type: 'SET_CHAT_MESSAGES', payload: savedChats });
  const savedNotifs = storage.loadNotifications ? storage.loadNotifications() : [];
  store.dispatch({ type: 'SET_NOTIFICATIONS', payload: savedNotifs });
  const ident = getCurrentFisherIdentity(store.getState());
  if (!store.getState().userProfile?.fisherId) {
    store.dispatch({
      type: 'UPDATE_USER_PROFILE',
      payload: {
        fisherId: ident.fisherId,
        tgLinkedId: ident.tgLinkedId,
        tgUsername: ident.tgUsername
      }
    });
  }
  render(container);
  renderChatsSection(chatsContainer || (typeof document !== 'undefined' ? document.getElementById('secChats') : null));
  syncCircleNavBadge();
  if (unsub) unsub();
  unsub = store.subscribe(
    st => ({
      route: st.route,
      circleItems: st.circleItems,
      chatMessages: st.chatMessages,
      notifications: st.notifications,
      lat: st.lat,
      lon: st.lon,
      locLabel: st.locLabel,
      fishId: st.fishId,
      water: st.water,
      method: st.method,
      depth: st.depth,
      catches: st.catches,
      userProfile: st.userProfile
    }),
    (next) => {
      syncCircleNavBadge();
      if (next.route === 'chats') {
        renderChatsSection();
      } else if (!next.route || next.route === 'circle') {
        render(container);
      }
    }
  );
  if (relayPollTimer) clearInterval(relayPollTimer);
  relayPollTimer = setInterval(() => {
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      pollEncryptedRelayPackets(false);
    }
  }, 25000);
  syncAdminWhitelistWithCloud(null);
  try {
    const cloudItems = await readFromTelegramCloud('klev_circle_v2');
    if (Array.isArray(cloudItems) && cloudItems.length > 0) {
      const mergedMap = new Map();
      [...savedItems, ...purgeExpiredCircleItems(cloudItems)].forEach(it => {
        if (it && it.id) mergedMap.set(it.id, it);
      });
      const merged = Array.from(mergedMap.values()).sort((a, b) => (b.ca || 0) - (a.ca || 0));
      storage.saveCircleItems(merged);
      store.dispatch({ type: 'SET_CIRCLE_ITEMS', payload: merged });
    }
  } catch (e) {}
}
export function destroy() {
  if (unsub) unsub();
  if (relayPollTimer) clearInterval(relayPollTimer);
}
export const circleModule = {
  CREW_TTL_MS,
  CIRCLE_BLUR_RADIUS_KM,
  CIRCLE_OLDER_BLUR_RADIUS_KM,
  REGIONAL_K_ANONYMITY_THRESHOLD,
  computeCrewKeyHash,
  formatCrewKeyFromHash,
  parseFisherIdTo20Bit,
  formatFisherIdFrom20Bit,
  resolveAccountCredentials,
  authenticateAndSyncAccount,
  syncCurrentProfileToCloudIfLoggedIn,
  renderSettingsZoneTabsHtml,
  bindSettingsZoneTabs,
  getCurrentFisherIdentity,
  isOwnerAdmin,
  isUserAdmin,
  getAdminWhitelistEntries,
  isCircleItemMine,
  isCircleItemHidden,
  canUserAccessCrewItem,
  encryptChatPayload,
  decryptChatPayload,
  pushAppNotification,
  syncCircleNavBadge,
  getEffectiveCircleRadiusKm,
  computeHexPolygonForCircle,
  blurCoordsForCircle,
  getUserExpertRank,
  evaluateWorkshopRigMatch,
  encodeSharePack,
  decodeSharePack,
  createSharePackFromContext,
  purgeExpiredCircleItems,
  importSharePackToken,
  evaluateCircleFieldConfirmation,
  openShareModalForCurrentContext,
  openShareCatchToChatModal,
  openImportPackModal,
  openNotificationsModal,
  openAuthAndBackupModal,
  sendFishermanChatMessage,
  pollEncryptedRelayPackets,
  renderChatsSection,
  init,
  render,
  destroy
};