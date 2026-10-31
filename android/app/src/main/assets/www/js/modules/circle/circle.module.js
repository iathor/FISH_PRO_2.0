/**
 * @file circle.module.js
 * @description Модуль «Клёв ПРО: Круг» и выделенная вкладка « Чаты» (Ревизия 2.1.1):
 * - Ультракороткая бинарная упаковка V3 (#p=KP1_<28_символов>) со встроенным 20-битным ID рыбака (FP_89AAA001).
 * - Автоматическая привязка ID рыбака (FP_89AAA001) ко всем точкам: Круг, Экипаж 72ч, SOS, Мастерская, Закладки и Уловы.
 * - Автокопирование ID рыбака (FP_89AAA001) и ключей Экипажа (KP-XXXX) в 1 касание (data-copy-fisher-id).
 * - Разделение всех событий на « МОИ» (с возможностью удаления ) и « ЧУЖИЕ» (только скрытие / возврат ).
 * - Компактный список событий (.circle-compact-list) с раскрывающимися деталями без «взрыва ленты».
 * - Выделенная вкладка « Чаты» на нижней панели навигации + отправка карточки улова прямо в чат.
 * - Закрытый режим Супер-Админа (только для Владельца + управляемая База Администраторов с синхронизацией).
 */

import { events } from '../../core/events.js?v=2.5.1';
import { store } from '../../core/store.js?v=2.5.1';
import { storage, calcGeoDistanceKm, safeJsonParse } from '../../core/storage.js?v=2.5.1';
import { router } from '../../core/router.js?v=2.5.1';
import { getSeasonalBaitsForContext } from '../../core/config.js?v=2.5.1';
import { detectBasinByCoords, isCoastalInBasin } from '../../data/basins.js?v=2.5.1';
import { findNearestRussianSettlement, getNearestRussianWaters } from '../../data/russia-waters.js?v=2.5.1';
import { WATER_PROFILES } from '../../data/waters.js?v=2.5.1';
import { FISH_DB } from '../../data/species.js?v=2.5.1';
import { escapeHtml, isAnonymousCallsignValid, createPill, showToast, openModal, closeModal, copyFisherIdToClipboard, openConfirmDeleteModal, openUserAgreementModal, isUserAgreementAccepted, downloadFileCrossPlatform, triggerSystemNotificationCrossPlatform, requestSystemNotificationsAccess } from '../../ui/components.js?v=2.5.1';
import {
  RELAY_WORKER_URL,
  buildShareUrls,
  shareToTelegramChat,
  shareOrCopyPack,
  getTelegramUser,
  bindFisherIdWithTelegram,
  checkServerTelegramBindStatus,
  openBotChatInTelegram,
  syncToTelegramCloud,
  readFromTelegramCloud,
  triggerHaptic
} from '../../core/telegram.js?v=2.5.1';
import { setLocation } from '../geo/geo.module.js?v=2.5.1';
import { calcDynamicRig } from '../forecast/forecast.module.js?v=2.5.1';

export const CREW_TTL_MS = 72 * 60 * 60 * 1000;
export const CIRCLE_BLUR_RADIUS_KM = 5.0;
export const CIRCLE_OLDER_BLUR_RADIUS_KM = 10.0;
export const REGIONAL_K_ANONYMITY_THRESHOLD = 3;
const PACK_PREFIX = 'KP1_';
const CIPHER_SALT = 'KlevProCircle_v2.1_Salt_RU';
const E2E_PREFIX = 'KPE2E_';
const EPOCH_2024_MS = 1704067200000; // 2024-01-01T00:00:00Z

// Базовый список суперадминов (Владелец Антон: логин iAthor -> эксклюзивный ID FP_89VIP089, проверка пароля строго по крипто-хэшу и на сервере)
const OWNER_TG_USERNAMES = ['thorantony82', 'iathor', 'iathor82'];
export const OWNER_BOUND_LOGIN = 'iAthor';
export const OWNER_BOUND_FISHER_ID = 'FP_89VIP089';
export const OWNER_SECONDARY_FISHER_ID = 'FP_FMP089';
const DEFAULT_ADMIN_IDS = [OWNER_BOUND_FISHER_ID, OWNER_SECONDARY_FISHER_ID];
export const OWNER_BOUND_PIN_HASH = 'owner_iathor_vip089';
let _adminDashboardCache = null;
let _adminDashboardLoading = false;
const OWNER_ADMIN_CONSOLE_TOKEN = 'VIP089_D854A7F4_38D816DA';
const OWNER_TOKEN_HASH_IATHOR = 'KTOK_1E665A58_64E3DB80';
const OWNER_TOKEN_HASH_IATHOR82 = 'KTOK_52183B6B_39DEECFC';
let _serverDynamicAdminSlotHtml = '';
let _serverAdminSessionToken = '';
let _idAllocationInFlight = false;
let _lastNearbyCircleSyncTs = 0;

export const PACK_WATER_KEYS = ['small_river', 'big_river', 'quarry', 'tundra_lake', 'cooling_reservoir', 'sea_gulf', 'open_sea'];
export const PACK_METHOD_KEYS = ['spin_micro', 'spin_jig', 'spin_lure', 'bottom', 'float', 'winter_jig', 'winter_lure', 'fly', 'sea_rock'];

// Полная таблица кодов всех субъектов РФ (01..99, включая новые регионы России 80, 81, 84, 85, 82, 92)
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

export const RUSSIA_REGIONS_DIRECTORY = [
  { code: '01', name: 'Республика Адыгея' },
  { code: '02', name: 'Республика Башкортостан' },
  { code: '03', name: 'Республика Бурятия' },
  { code: '04', name: 'Республика Алтай' },
  { code: '05', name: 'Республика Дагестан' },
  { code: '06', name: 'Республика Ингушетия' },
  { code: '07', name: 'Кабардино-Балкарская Республика' },
  { code: '08', name: 'Республика Калмыкия' },
  { code: '09', name: 'Карачаево-Черкесская Республика' },
  { code: '10', name: 'Республика Карелия' },
  { code: '11', name: 'Республика Коми' },
  { code: '12', name: 'Республика Марий Эл' },
  { code: '13', name: 'Республика Мордовия' },
  { code: '14', name: 'Республика Саха (Якутия)' },
  { code: '15', name: 'Республика Северная Осетия — Алания' },
  { code: '16', name: 'Республика Татарстан' },
  { code: '17', name: 'Республика Тыва' },
  { code: '18', name: 'Удмуртская Республика' },
  { code: '19', name: 'Республика Хакасия' },
  { code: '20', name: 'Чеченская Республика' },
  { code: '21', name: 'Чувашская Республика' },
  { code: '22', name: 'Алтайский край' },
  { code: '23', name: 'Краснодарский край' },
  { code: '24', name: 'Красноярский край' },
  { code: '25', name: 'Приморский край' },
  { code: '26', name: 'Ставропольский край' },
  { code: '27', name: 'Хабаровский край' },
  { code: '28', name: 'Амурская область' },
  { code: '29', name: 'Архангельская область' },
  { code: '30', name: 'Астраханская область' },
  { code: '31', name: 'Белгородская область' },
  { code: '32', name: 'Брянская область' },
  { code: '33', name: 'Владимирская область' },
  { code: '34', name: 'Волгоградская область' },
  { code: '35', name: 'Вологодская область' },
  { code: '36', name: 'Воронежская область' },
  { code: '37', name: 'Ивановская область' },
  { code: '38', name: 'Иркутская область' },
  { code: '39', name: 'Калининградская область' },
  { code: '40', name: 'Калужская область' },
  { code: '41', name: 'Камчатский край' },
  { code: '42', name: 'Кемеровская область — Кузбасс' },
  { code: '43', name: 'Кировская область' },
  { code: '44', name: 'Костромская область' },
  { code: '45', name: 'Курганская область' },
  { code: '46', name: 'Курская область' },
  { code: '47', name: 'Ленинградская область' },
  { code: '48', name: 'Липецкая область' },
  { code: '49', name: 'Магаданская область' },
  { code: '50', name: 'Московская область' },
  { code: '51', name: 'Мурманская область' },
  { code: '52', name: 'Нижегородская область' },
  { code: '53', name: 'Новгородская область' },
  { code: '54', name: 'Новосибирская область' },
  { code: '55', name: 'Омская область' },
  { code: '56', name: 'Оренбургская область' },
  { code: '57', name: 'Орловская область' },
  { code: '58', name: 'Пензенская область' },
  { code: '59', name: 'Пермский край' },
  { code: '60', name: 'Псковская область' },
  { code: '61', name: 'Ростовская область' },
  { code: '62', name: 'Рязанская область' },
  { code: '63', name: 'Самарская область' },
  { code: '64', name: 'Саратовская область' },
  { code: '65', name: 'Сахалинская область' },
  { code: '66', name: 'Свердловская область' },
  { code: '67', name: 'Смоленская область' },
  { code: '68', name: 'Тамбовская область' },
  { code: '69', name: 'Тверская область' },
  { code: '70', name: 'Томская область' },
  { code: '71', name: 'Тульская область' },
  { code: '72', name: 'Тюменская область' },
  { code: '73', name: 'Ульяновская область' },
  { code: '74', name: 'Челябинская область' },
  { code: '75', name: 'Забайкальский край' },
  { code: '76', name: 'Ярославская область' },
  { code: '77', name: 'г. Москва' },
  { code: '78', name: 'г. Санкт-Петербург' },
  { code: '79', name: 'Еврейская автономная область' },
  { code: '80', name: 'Донецкая Народная Республика' },
  { code: '81', name: 'Луганская Народная Республика' },
  { code: '82', name: 'Республика Крым' },
  { code: '83', name: 'Ненецкий автономный округ' },
  { code: '84', name: 'Херсонская область' },
  { code: '85', name: 'Запорожская область' },
  { code: '86', name: 'Ханты-Мансийский АО — Югра' },
  { code: '87', name: 'Чукотский автономный округ' },
  { code: '89', name: 'Ямало-Ненецкий АО' },
  { code: '92', name: 'г. Севастополь' }
];

export function getRegionNameByCode(regCode = '89') {
  const clean = String(regCode || '89').replace(/\D/g, '').padStart(2, '0').slice(-2);
  const found = RUSSIA_REGIONS_DIRECTORY.find(r => r.code === clean);
  return found ? found.name : `Регион ${clean}`;
}

let filterWorkshopForToday = false;
let activeOwnershipFilter = 'all'; // 'all' | 'mine' | 'foreign' | 'hidden'
let activeCategoryFilter = 'all'; // 'all' | 'sos' | 'crew' | 'circle' | 'workshop'
const expandedCompactIds = new Set();
let activeChatChannelId = ''; // 'crew:KP-XXXX' | 'dm:FP_XXXX:FP_YYYY'
let isFullScreenChatOpen = false;
let _cloudSessionVerified = false;
let relayPollTimer = null;
let _relayPollInFlight = false;
let _nearbySyncInFlight = false;
let _outboxFlushInFlight = false;
let _iosLifecycleBound = false;
let _explicitMapPointChosenForReg = false;
let _sessionReserveAllocatedFid = '';
const _recentlyPublishedLocalIds = new Map();
const _explicitlyDeletedLocalIds = new Set();
const _seenRelayPacketIds = new Set();
const _deletedChatTimestamps = new Map();
const PENDING_OUTBOX_STORAGE_KEY = 'klev_pro_pending_outbox_v2_1_21';
const RELAY_SYNC_STORAGE_KEY = 'klev_pro_relay_sync_v232';
const DEVICE_RESERVE_ID_STORAGE_KEY = 'klev_pro_device_reserve_v232';
export const RESERVE_ID_TTL_MS = 24 * 60 * 60 * 1000; // 24 часа

let lastRelayPullTs = (() => {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(RELAY_SYNC_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed?.deletedCircleIds)) {
          parsed.deletedCircleIds.forEach(id => { if (id) _explicitlyDeletedLocalIds.add(id); });
        }
        if (Array.isArray(parsed?.seenPacketIds)) {
          parsed.seenPacketIds.forEach(id => { if (id) _seenRelayPacketIds.add(id); });
        }
        if (parsed?.deletedChatMap && typeof parsed.deletedChatMap === 'object') {
          Object.entries(parsed.deletedChatMap).forEach(([k, ts]) => {
            if (k && Number(ts) > 0) _deletedChatTimestamps.set(k, Number(ts));
          });
        }
        if (Number(parsed?.lastPullTs) > 0) {
          return Number(parsed.lastPullTs);
        }
      }
      // При первом запуске берём только свежие пакеты с текущего момента (минус 30 сек), чтобы не оживлять старые/удалённые чаты из 72ч архива
      const initTs = Date.now() - 30000;
      localStorage.setItem(RELAY_SYNC_STORAGE_KEY, JSON.stringify({
        lastPullTs: initTs,
        deletedCircleIds: [],
        seenPacketIds: [],
        deletedChatMap: {}
      }));
      return initTs;
    }
  } catch (e) {}
  return Date.now() - 30000;
})();

function _persistRelaySyncState() {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(RELAY_SYNC_STORAGE_KEY, JSON.stringify({
      lastPullTs: lastRelayPullTs,
      deletedCircleIds: Array.from(_explicitlyDeletedLocalIds).slice(-300),
      seenPacketIds: Array.from(_seenRelayPacketIds).slice(-300),
      deletedChatMap: Object.fromEntries(Array.from(_deletedChatTimestamps.entries()).slice(-200))
    }));
  } catch (e) {}
}

function _getOrCreateLockedDeviceReserveId(regCode = '89', devId = 'dev_local', rawSavedFid = '') {
  const now = Date.now();
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(DEVICE_RESERVE_ID_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.fid && isTemporaryReserveId(parsed.fid) && Number(parsed.createdAt) > 0 && (now - Number(parsed.createdAt)) < RESERVE_ID_TTL_MS) {
          return parsed.fid;
        }
      }
    }
  } catch (e) {}

  let chosenFid = '';
  if (rawSavedFid && isTemporaryReserveId(rawSavedFid)) {
    chosenFid = rawSavedFid;
  } else {
    const dayBucket = Math.floor(now / RESERVE_ID_TTL_MS);
    chosenFid = formatTempReserveFisherId(regCode, `rz_v232:${devId}:${dayBucket}`);
  }

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(DEVICE_RESERVE_ID_STORAGE_KEY, JSON.stringify({
        fid: chosenFid,
        createdAt: now,
        deviceId: devId
      }));
    }
  } catch (e) {}
  return chosenFid;
}

function _updateLockedDeviceReserveId(srvFid, devId = 'dev_local') {
  if (!srvFid || !isTemporaryReserveId(srvFid)) return;
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(DEVICE_RESERVE_ID_STORAGE_KEY);
      const prev = raw ? JSON.parse(raw) : null;
      const createdAt = (prev && prev.createdAt && (Date.now() - Number(prev.createdAt)) < RESERVE_ID_TTL_MS)
        ? Number(prev.createdAt)
        : Date.now();
      localStorage.setItem(DEVICE_RESERVE_ID_STORAGE_KEY, JSON.stringify({
        fid: srvFid,
        createdAt,
        deviceId: devId
      }));
    }
  } catch (e) {}
}

function _isIOSWebKitClient() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function _loadPendingOutbox() {
  try {
    if (typeof localStorage === 'undefined') return { points: [], relays: [] };
    const raw = localStorage.getItem(PENDING_OUTBOX_STORAGE_KEY);
    if (!raw) return { points: [], relays: [] };
    const parsed = JSON.parse(raw);
    return {
      points: Array.isArray(parsed?.points) ? parsed.points.slice(-30) : [],
      relays: Array.isArray(parsed?.relays) ? parsed.relays.slice(-40) : []
    };
  } catch (e) {
    return { points: [], relays: [] };
  }
}

function _savePendingOutbox(box) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(PENDING_OUTBOX_STORAGE_KEY, JSON.stringify({
      points: Array.isArray(box?.points) ? box.points.slice(-30) : [],
      relays: Array.isArray(box?.relays) ? box.relays.slice(-40) : []
    }));
  } catch (e) {}
}

function _enqueueOutboxPoint(itemObj, packToken = '') {
  if (!itemObj || !itemObj.id) return;
  const box = _loadPendingOutbox();
  const filtered = box.points.filter(x => x && x.item && x.item.id !== itemObj.id);
  filtered.push({ item: itemObj, packToken: packToken || itemObj.packToken || '', ts: Date.now() });
  box.points = filtered;
  _savePendingOutbox(box);
}

function _removeOutboxPoint(itemId) {
  if (!itemId) return;
  const box = _loadPendingOutbox();
  const next = box.points.filter(x => x && x.item && x.item.id !== itemId);
  if (next.length !== box.points.length) {
    box.points = next;
    _savePendingOutbox(box);
  }
}

function _enqueueOutboxRelay(pktPayload) {
  if (!pktPayload || !pktPayload.channelId || !pktPayload.cipherPayload) return;
  const box = _loadPendingOutbox();
  const key = `${pktPayload.channelId}_${pktPayload.cipherPayload.slice(-24)}`;
  const filtered = box.relays.filter(x => x && x._k !== key);
  filtered.push({ ...pktPayload, _k: key, ts: Date.now() });
  box.relays = filtered;
  _savePendingOutbox(box);
}

function _removeOutboxRelay(key) {
  if (!key) return;
  const box = _loadPendingOutbox();
  const next = box.relays.filter(x => x && x._k !== key);
  if (next.length !== box.relays.length) {
    box.relays = next;
    _savePendingOutbox(box);
  }
}

/**
 * Надёжный сетевой транспорт для iOS (Safari / WebKit / PWA / Telegram Mini App), Android APK и ПК:
 * - Для POST-запросов использует Content-Type: text/plain;charset=UTF-8 (CORS Simple Request без блокирующего OPTIONS preflight в WebKit)
 * - На iOS WebKit включает keepalive, анти-кэш метку _t на всех GET-запросах и быстрый переход на GET ?payload=... при малейшей задержке POST-сокета
 */
let _preferredRelayProxyUntil = 0;
let _lastWorkingGatewayLabel = 'Прямой канал D1 / Edge';

export function getLastActiveDbGatewayLabel() {
  return _lastWorkingGatewayLabel;
}

function _isValidWorkerPayloadText(rawText, isHtmlExpected = false) {
  if (!rawText || typeof rawText !== 'string') return false;
  const trimmed = rawText.trim();
  if (!trimmed) return false;
  if (isHtmlExpected && (trimmed.includes('Клёв ПРО') || trimmed.includes('Веб-Консоль') || trimmed.includes('ЗАКРЫТАЯ БАЗА'))) {
    return true;
  }
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object') return false;
    const keys = ['ok', 'version', 'items', 'users', 'fisherId', 'whitelist', 'packets', 'bound', 'error', 'deleted', 'deletedChannel', 'appName', 'totalUsers', 'd1Status'];
    return keys.some(k => k in parsed);
  } catch (e) {
    return false;
  }
}

async function _executeSingleGatewayRequest(kind, fullUrl, method, bodyStr, canUseGetPayload, timeoutMs, tag) {
  const sep = fullUrl.includes('?') ? '&' : '?';
  const buildDirectGetUrl = (suffix) => {
    if (method === 'POST' && canUseGetPayload) {
      return `${fullUrl}${sep}payload=${encodeURIComponent(bodyStr)}&_t=${Date.now()}_${suffix}`;
    }
    return fullUrl.includes('_t=')
      ? `${fullUrl}&_r=${suffix}`
      : `${fullUrl}${sep}_t=${Date.now()}_${suffix}`;
  };

  let targetUrl = fullUrl;
  let reqMethod = method;
  const innerUrl = buildDirectGetUrl(`${kind}_${tag}`);

  if (kind === 'direct') {
    reqMethod = method;
    targetUrl = reqMethod === 'GET' ? innerUrl : fullUrl;
  } else if (kind === 'direct_get_payload') {
    reqMethod = 'GET';
    targetUrl = innerUrl;
  } else if (kind === 'relay_corsproxy') {
    reqMethod = 'GET';
    targetUrl = `https://corsproxy.io/?url=${encodeURIComponent(innerUrl)}`;
  } else if (kind === 'relay_allorigins_json') {
    reqMethod = 'GET';
    targetUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(innerUrl)}&_t=${Date.now()}`;
  } else if (kind === 'relay_codetabs') {
    reqMethod = 'GET';
    targetUrl = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(innerUrl)}`;
  } else if (kind === 'relay_allorigins_raw') {
    reqMethod = 'GET';
    targetUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(innerUrl)}`;
  } else if (kind === 'relay_thingproxy') {
    reqMethod = 'GET';
    targetUrl = `https://thingproxy.freeboard.io/fetch/${innerUrl}`;
  }

  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, timeoutMs) : null;

  try {
    const fetchOpts = {
      method: reqMethod,
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      signal: ctrl ? ctrl.signal : undefined
    };
    if (reqMethod === 'POST' && bodyStr !== undefined) {
      fetchOpts.headers = { 'Content-Type': 'text/plain;charset=UTF-8' };
      fetchOpts.body = bodyStr;
    }
    const res = await fetch(targetUrl, fetchOpts);
    if (timer) clearTimeout(timer);
    if (!res) throw new Error('Empty response');

    let textBody = await res.text();
    if (kind === 'relay_allorigins_json') {
      const outer = JSON.parse(textBody);
      textBody = outer && typeof outer.contents === 'string' ? outer.contents : '';
    }

    const isHtmlConsole = fullUrl.includes('/fp-vip089-console');
    if (!_isValidWorkerPayloadText(textBody, isHtmlConsole)) {
      throw new Error(`Invalid gateway payload from ${kind}`);
    }

    if (kind.startsWith('relay_')) {
      _preferredRelayProxyUntil = Date.now() + 300000;
      _lastWorkingGatewayLabel = `Анти-DPI шлюз (${kind.replace('relay_', '')} • без VPN)`;
    } else {
      _preferredRelayProxyUntil = 0;
      _lastWorkingGatewayLabel = kind === 'direct_get_payload' ? 'Прямой GET-пакет (VPN-совместимый)' : 'Прямой канал D1 / Edge';
    }

    return new Response(textBody, {
      status: 200,
      headers: {
        'Content-Type': isHtmlConsole ? 'text/html;charset=utf-8' : 'application/json;charset=utf-8'
      }
    });
  } catch (err) {
    if (timer) clearTimeout(timer);
    throw err;
  }
}

/**
 * Многоканальный отказоустойчивый транспорт БД (Вариант Б — v2.5.1 r188):
 * - 6 независимых каналов связи (Direct POST/GET, Direct GET-Payload для VPN, и 4 HTTPS Anti-DPI ретранслятора для мобильных сетей РФ без VPN).
 * - Строгая валидация ответа (исключает ложные 403/429 и HTML-заглушки прокси).
 * - Параллельная гонка каналов (Promise.any), выбирающая самый быстрый рабочий маршрут в текущей сети за 300–700 мс.
 */
export async function workerFetch(endpointOrUrl, options = {}, timeoutMs = 5500, retries = 2) {
  const fullUrl = String(endpointOrUrl || '').startsWith('http')
    ? endpointOrUrl
    : `${RELAY_WORKER_URL}${endpointOrUrl}`;
  const method = String(options.method || 'GET').toUpperCase();
  const bodyStr = typeof options.body === 'string' ? options.body : (options.body ? JSON.stringify(options.body) : undefined);
  const canUseGetPayload = (method === 'POST' && bodyStr && bodyStr.length < 7500);
  const relayReady = (method === 'GET') || canUseGetPayload;
  const preferRelayFirst = relayReady && (Date.now() < _preferredRelayProxyUntil);

  const runParallelRelayRace = (raceTag = 'r0') => {
    const candidates = [
      _executeSingleGatewayRequest('relay_corsproxy', fullUrl, method, bodyStr, canUseGetPayload, 4600, raceTag),
      _executeSingleGatewayRequest('relay_allorigins_json', fullUrl, method, bodyStr, canUseGetPayload, 4800, raceTag),
      _executeSingleGatewayRequest('relay_codetabs', fullUrl, method, bodyStr, canUseGetPayload, 4800, raceTag),
      _executeSingleGatewayRequest('relay_allorigins_raw', fullUrl, method, bodyStr, canUseGetPayload, 4800, raceTag)
    ];
    if (method === 'POST' && canUseGetPayload) {
      candidates.push(_executeSingleGatewayRequest('direct_get_payload', fullUrl, method, bodyStr, canUseGetPayload, 3500, raceTag));
    } else {
      candidates.push(_executeSingleGatewayRequest('direct', fullUrl, method, bodyStr, canUseGetPayload, 3500, raceTag));
    }
    return Promise.any(candidates);
  };

  if (preferRelayFirst) {
    try {
      return await runParallelRelayRace('fast');
    } catch (e) {}
  }

  // Даём прямому каналу быстрый старт (1350 мс); если ТСПУ блокирует *.workers.dev или нет ответа,
  // мгновенно включаем параллельную гонку всех Anti-DPI ретрансляторов, не дожидаясь долгого таймаута!
  try {
    const directPromises = [
      _executeSingleGatewayRequest('direct', fullUrl, method, bodyStr, canUseGetPayload, Math.min(timeoutMs, 3200), 'd0')
    ];
    if (method === 'POST' && canUseGetPayload) {
      directPromises.push(_executeSingleGatewayRequest('direct_get_payload', fullUrl, method, bodyStr, canUseGetPayload, 3200, 'gp0'));
    }
    const directRace = Promise.any(directPromises);

    if (!relayReady) {
      return await directRace;
    }

    let relayTimer = null;
    const delayedRelays = new Promise((resolve, reject) => {
      relayTimer = setTimeout(() => {
        runParallelRelayRace('delayed').then(resolve).catch(reject);
      }, 1350);
    });

    const winner = await Promise.any([
      directRace.catch(err => {
        if (relayTimer) clearTimeout(relayTimer);
        return runParallelRelayRace('fallback');
      }),
      delayedRelays
    ]);
    if (relayTimer) clearTimeout(relayTimer);
    return winner;
  } catch (finalErr) {
    if (retries > 0 && relayReady) {
      return await runParallelRelayRace('retry');
    }
    throw finalErr || new Error('Network timeout');
  }
}

export function getCanonicalDmChannelId(myFidRaw, peerFidRaw, allMsgs = []) {
  const reg = resolveRussianRegionCode();
  const myFid = isOwnerFisherId(myFidRaw) ? OWNER_BOUND_FISHER_ID : normalizeFisherId(myFidRaw || '', reg);
  let peerFid = String(peerFidRaw || '').trim().toUpperCase();
  if (peerFid === 'ADMIN_SUPPORT' || isOwnerFisherId(peerFid)) {
    peerFid = OWNER_BOUND_FISHER_ID;
  } else {
    peerFid = normalizeFisherId(peerFid, reg) || peerFid;
  }
  const canonical = `dm:${[myFid, peerFid].sort().join(':')}`;
  if (Array.isArray(allMsgs) && allMsgs.length > 0) {
    const existingMatch = allMsgs.find(m => {
      if (!m || !String(m.channelId || '').startsWith('dm:')) return false;
      if (m.channelId === canonical) return true;
      const mPeer = isOwnerFisherId(m.peerId) ? OWNER_BOUND_FISHER_ID : String(m.peerId || '').toUpperCase();
      const mSender = isOwnerFisherId(m.senderId) ? OWNER_BOUND_FISHER_ID : String(m.senderId || '').toUpperCase();
      return (mPeer === peerFid && mSender === myFid) || (mSender === peerFid && mPeer === myFid);
    });
    if (existingMatch && existingMatch.channelId) {
      return existingMatch.channelId;
    }
  }
  return canonical;
}

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
 * - index0 = 0 -> FP_89AAA001 (1-й рыбак в регионе)
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
 * Генерирует временный резервный ID для незарегистрированного рыбака формата FP_XXRZYYYY
 * где XX — код региона РФ (01..92), RZ — шаблон резерва, YYYY — номер от 0001 до 9999.
 */
export function formatTempReserveFisherId(regionCode = '89', seedNumOrStr = 1) {
  const regDigits = String(regionCode || '89').replace(/\D/g, '').padStart(2, '0').slice(-2);
  const reg = (regDigits === '00' ? '89' : regDigits);
  let num = 1;
  if (typeof seedNumOrStr === 'number' && Number.isFinite(seedNumOrStr)) {
    num = ((Math.max(1, Math.floor(seedNumOrStr)) - 1) % 9999) + 1;
  } else {
    num = (fnv1a32(String(seedNumOrStr || 'dev_rz')) % 9999) + 1;
  }
  return `FP_${reg}RZ${String(num).padStart(4, '0')}`;
}

export function isTemporaryReserveId(fid = '') {
  return /^FP_\d{2}RZ\d{4}$/i.test(String(fid || '').trim());
}

export function isOwnerFisherId(fid = '') {
  const clean = String(fid || '').trim().toUpperCase();
  return clean === OWNER_BOUND_FISHER_ID || clean === OWNER_SECONDARY_FISHER_ID || clean === 'FP_89A01';
}

export function isLoginOwnerMatch(rawLogin = '') {
  const clean = String(rawLogin || '').trim().toLowerCase().replace(/[@\s]/g, '');
  return (
    clean === 'iathor' ||
    clean === 'iathor82' ||
    clean === 'thorantony82' ||
    clean === 'fp_89vip089' ||
    clean === 'fp_fmp089' ||
    clean === 'antonthor' ||
    clean === '89vip089' ||
    clean === 'fmp089'
  );
}

export function normalizeFisherId(rawStr = '', fallbackRegion = '89') {
  const clean = String(rawStr || '').trim().toUpperCase().replace(/-/g, '_');
  if (!clean) return '';
  if (clean === 'FP_89VIP089' || clean === '89VIP089' || clean === 'FP_89A01') {
    return OWNER_BOUND_FISHER_ID;
  }
  if (clean === 'FP_FMP089' || clean === 'FMP089') {
    return OWNER_SECONDARY_FISHER_ID;
  }
  const rzMatch = clean.match(/^(?:FP_)?(\d{2})RZ(\d{4})$/);
  if (rzMatch) {
    const reg = rzMatch[1];
    const numVal = Math.max(1, Math.min(9999, parseInt(rzMatch[2], 10) || 1));
    return `FP_${reg}RZ${String(numVal).padStart(4, '0')}`;
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
  const s = String(str || '').trim().toUpperCase();
  if (isTemporaryReserveId(s) || isOwnerFisherId(s)) return true;
  return /^FP_(?:\d{2})?[A-Z]{3}(?:00[1-9]|0[1-9]\d|[1-9]\d{2})$/.test(s);
}

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
 * Упаковывает Рыболовный ID (как региональный FP_89AAA001, так и VIP/Владельца FP_89VIP089)
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
 * Проверяет логин и пароль рыбака; распознаёт постоянный аккаунт Владельца (iAthor -> FP_89VIP089)
 * и детерминированно/последовательно формирует региональный ID рыбака (FP_<RR><AAA><001..999>).
 */
export function resolveAccountCredentials(rawLogin = '', rawPassword = '', preferredRegionCode = null) {
  const loginClean = String(rawLogin || '').trim().slice(0, 48);
  const loginNorm = loginClean.toLowerCase().replace(/[@\s]/g, '');
  const passClean = String(rawPassword || '').trim();
  const computedToken = deriveSecureAuthToken(loginNorm, passClean);
  const computedTokenLower = deriveSecureAuthToken(loginNorm, passClean.toLowerCase());

  const isOwnerLogin = isLoginOwnerMatch(loginClean);
  const passNorm = passClean.toLowerCase();
  const passNormNoStar = passNorm.replace(/\*+$/, '');
  const isOwnerPassHash = (
    fnv1a32(`pin::${passClean}`).toString(16) === '5c4be2a9' ||
    fnv1a32(`pin::${passNorm}`).toString(16) === '17b24989' ||
    fnv1a32(`pin::${passNormNoStar}`).toString(16) === '76722d9b' ||
    computedToken === OWNER_TOKEN_HASH_IATHOR ||
    computedToken === OWNER_TOKEN_HASH_IATHOR82 ||
    computedTokenLower === OWNER_TOKEN_HASH_IATHOR
  );

  if (isOwnerLogin && isOwnerPassHash) {
    const preferredFid = (loginNorm === 'fp_fmp089' || loginNorm === 'fmp089') ? OWNER_SECONDARY_FISHER_ID : OWNER_BOUND_FISHER_ID;
    return {
      ok: true,
      isOwner: true,
      login: loginNorm === 'iathor82' ? 'iAthor82' : OWNER_BOUND_LOGIN,
      callsign: loginNorm === 'iathor82' ? 'iAthor82' : OWNER_BOUND_LOGIN,
      fisherId: preferredFid,
      ownerIds: [OWNER_BOUND_FISHER_ID, OWNER_SECONDARY_FISHER_ID],
      pinHash: OWNER_BOUND_PIN_HASH,
      authTokenHash: OWNER_TOKEN_HASH_IATHOR
    };
  }
  if (isOwnerLogin && !isOwnerPassHash) {
    return { ok: false, error: 'Неверный пароль для эксклюзивного аккаунта Владельца (iAthor / FP_89VIP089 / FP_FMP089)' };
  }

  if (!loginNorm || passClean.length < 3) {
    return { ok: false, error: 'Введите логин и пароль (минимум 3 символа) для регистрации постоянного ID' };
  }
  const anonCheck = isAnonymousCallsignValid(loginClean);
  if (!anonCheck.ok) {
    return { ok: false, error: anonCheck.error };
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
 * Проверяет, является ли текущий пользователь Владельцем (Супер-Админом Антоном: iAthor / iAthor82 -> FP_89VIP089 & FP_FMP089)
 */
export function isOwnerAdmin(stateObj = null) {
  const s = stateObj || store.getState();
  const up = s?.userProfile || {};
  if (up.ownerUnlocked === true) return true;
  const fidUpper = String(up.fisherId || '').trim().toUpperCase();
  if (isOwnerFisherId(fidUpper) && (up.pinHash || up.authTokenHash || up.ownerUnlocked)) return true;
  if (isLoginOwnerMatch(up.login) && (up.pinHash || up.authTokenHash || up.ownerUnlocked)) return true;
  const tgUser = getTelegramUser();
  const uname = String(tgUser?.username || up.tgUsername || '').toLowerCase().replace(/^@/, '');
  if (uname && OWNER_TG_USERNAMES.includes(uname)) return true;
  return false;
}

/**
 * Возвращает полный список администраторов из базы (Владелец FP_89VIP089 + FP_FMP089 + добавленные им в базу рыбаки)
 */
export function getAdminWhitelistEntries(stateObj = null) {
  const s = stateObj || store.getState();
  const up = s?.userProfile || {};
  const list = Array.isArray(up.adminWhitelist) ? up.adminWhitelist : [];
  const map = new Map([
    [OWNER_BOUND_FISHER_ID, { id: OWNER_BOUND_FISHER_ID, label: 'iAthor • Антон (Владелец / Основной VIP ID)', addedAt: '2026-10-25' }],
    [OWNER_SECONDARY_FISHER_ID, { id: OWNER_SECONDARY_FISHER_ID, label: 'iAthor82 • Антон (Владелец / Спец-ID FP_FMP089)', addedAt: '2026-10-25' }]
  ]);
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
 */
export function isUserAdmin(stateObj = null) {
  const s = stateObj || store.getState();
  const up = s?.userProfile || {};
  if (up.adminShowAllCrews === false) return false;
  if (isOwnerAdmin(s)) return true;

  const myFisherId = String(up.fisherId || '').trim().toUpperCase();
  if (!myFisherId || isTemporaryReserveId(myFisherId)) return false;
  const tgUser = getTelegramUser();
  const myUname = String(tgUser?.username || up.tgUsername || '').trim().toUpperCase().replace(/^@/, '');
  const whitelist = getAdminWhitelistEntries(s);

  return whitelist.some(entry => {
    const eid = String(entry.id || '').trim().toUpperCase().replace(/^@/, '');
    return (myFisherId && eid === myFisherId) || (myUname && eid === myUname);
  });
}

/**
 * Возвращает текущую учётную запись рыбака:
 * 1. Без регистрации (нет логина и пароля): выдаётся ВРЕМЕННЫЙ РЕЗЕРВНЫЙ ID формата FP_XXRZYYYY (напр. FP_89RZ0001).
 * 2. При регистрации логина и пароля: выдаётся ПОСТОЯННЫЙ ID формата FP_XXAAA001, жёстко привязанный ТОЛЬКО к логину и паролю на всех устройствах!
 * 3. Для Владельца (iAthor / iAthor82): эксклюзивные неприкосновенные ID FP_89VIP089 и FP_FMP089.
 */
export function getCurrentFisherIdentity(stateObj = null) {
  const s = stateObj || store.getState();
  const up = s?.userProfile || {};
  const tgUser = getTelegramUser();
  const devId = storage.getDeviceId ? storage.getDeviceId() : 'dev_local';
  const isOwner = isOwnerAdmin(s);
  const hasCredentials = Boolean(isOwner || (up.login && up.login !== 'Рыболов' && (up.pinHash || up.authTokenHash)));
  const regCode = resolveRussianRegionCode(s);
  const rawSavedFid = String(up.fisherId || '').trim().toUpperCase();

  let fisherId = '';
  let callsign = 'Рыболов';
  let login = '';

  if (isOwner) {
    fisherId = rawSavedFid === OWNER_SECONDARY_FISHER_ID ? OWNER_SECONDARY_FISHER_ID : OWNER_BOUND_FISHER_ID;
    login = up.login && isLoginOwnerMatch(up.login) ? up.login : OWNER_BOUND_LOGIN;
    callsign = up.callsign && up.callsign !== 'Рыболов' ? up.callsign : login;
  } else if (hasCredentials) {
    login = String(up.login || up.callsign || '').trim();
    callsign = (up.callsign && up.callsign !== 'Рыболов') ? up.callsign : login;
    if (rawSavedFid && isValidFisherIdFormat(rawSavedFid) && !isTemporaryReserveId(rawSavedFid) && !isOwnerFisherId(rawSavedFid)) {
      fisherId = normalizeFisherId(rawSavedFid, regCode);
    } else {
      const detIdx = 1 + (fnv1a32(`auth_v21:${login.toLowerCase()}:${up.pinHash || up.authTokenHash}`) % (26 * 999 - 2));
      fisherId = formatFisherIdFromIndex(regCode, detIdx);
    }
  } else {
    // БЕЗ РЕГИСТРАЦИИ: строго 1 временный резервный ID формата FP_XXRZYYYY на сессию / 24 часа (не меняется при переключении точек на карте!)
    login = '';
    callsign = (up.callsign && up.callsign !== 'Рыболов' && !isLoginOwnerMatch(up.callsign)) ? up.callsign : 'Гость (Резерв)';
    fisherId = _getOrCreateLockedDeviceReserveId(regCode, devId, rawSavedFid);
  }

  const isTemp = isTemporaryReserveId(fisherId);
  const isRegistered = Boolean(isOwner || (hasCredentials && !isTemp));

  return {
    callsign,
    login,
    fisherId,
    ownerIds: isOwner ? [OWNER_BOUND_FISHER_ID, OWNER_SECONDARY_FISHER_ID] : [],
    deviceId: devId,
    isRegistered,
    isTemporaryReserve: isTemp,
    isAuthenticated: isRegistered,
    isOwner,
    isAdmin: isUserAdmin(s),
    tgLinkedId: isRegistered ? (tgUser?.id || up.tgLinkedId || '') : '',
    tgUsername: isRegistered ? (tgUser?.username || up.tgUsername || '') : '',
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
 * Блокирует отправку точек/сообщений/пакетов для незарегистрированных рыбаков с временным резервным ID (FP_XXRZYYYY)
 * и открывает окно регистрации Логина и Пароля!
 */
export function requireRegisteredFisherId(actionLabel = 'отправки данных') {
  const s = store.getState();
  const ident = getCurrentFisherIdentity(s);
  if (ident.isRegistered && !ident.isTemporaryReserve) {
    return true;
  }
  showToast(
 ` Сначала зарегистрируйтесь (задайте логин и пароль)! С временным резервным ID (${ident.fisherId}) отправка недоступна.`,
    'warn'
  );
  openAuthAndBackupModal();
  return false;
}

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
      const res = await workerFetch('/admin/whitelist', {
        method: 'POST',
        body: JSON.stringify({
          ownerSecret: _serverAdminSessionToken || store.getState().userProfile?.adminSessionToken || store.getState().userProfile?.authTokenHash || '',
          action: pushChange.action || 'set',
          entry: pushChange.entry || null,
          targetId: pushChange.targetId || '',
          list: getAdminWhitelistEntries()
        })
      }, 4500, 1);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.whitelist)) {
          store.dispatch({ type: 'SET_ADMIN_WHITELIST', payload: data.whitelist });
        }
      }
      return true;
    }

    const res = await workerFetch('/admin/whitelist', { method: 'GET' }, 4500, 1);
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

export function detectClientPlatformLabel() {
  if (typeof window === 'undefined') return 'WEB';
  const ua = navigator.userAgent || '';
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (window.AndroidBridge || /KlevProAndroid|wv\)/i.test(ua)) return 'APK';
  if (window.Telegram?.WebApp?.initData) return isIOS ? 'iOS-TG' : 'TG-MiniApp';
  if ((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator?.standalone === true) {
    return isIOS ? 'iOS-PWA' : 'PWA';
  }
  return isIOS ? 'iOS-Web' : 'WEB';
}

/**
 * Гарантирует фиксацию уникального ID устройства и выделение уникального серверного ID рыбака (/api/id/allocate)
 */
export async function ensureFisherIdentityInitialized(forceReallocateForRegion = false) {
  const s = store.getState();
  const up = s?.userProfile || {};
  const regCode = resolveRussianRegionCode(s);
  const hasRealLoc = Boolean(s?.hasUserLocation);
  const ident = getCurrentFisherIdentity(s);

  // Фиксируем актуальный ID (постоянный для зарегистрированных или временный резервный FP_XXRZYYYY для гостей)
  if (!up.fisherId || up.fisherId !== ident.fisherId || !up.deviceId || (ident.isOwner && !up.ownerUnlocked)) {
    store.dispatch({
      type: 'UPDATE_USER_PROFILE',
      payload: {
        fisherId: ident.fisherId,
        login: ident.login,
        callsign: ident.callsign,
        ownerUnlocked: ident.isOwner ? true : Boolean(up.ownerUnlocked),
        deviceId: ident.deviceId,
        regionConfirmed: Boolean(up.regionConfirmed || hasRealLoc),
        tgLinkedId: ident.tgLinkedId,
        tgUsername: ident.tgUsername
      }
    });
    storage.saveSettings(store.getState());
  }

  if (ident.isTemporaryReserve && _sessionReserveAllocatedFid === ident.fisherId && !forceReallocateForRegion) {
    return ident.fisherId;
  }
  if (_idAllocationInFlight && !forceReallocateForRegion) return ident.fisherId;
  _idAllocationInFlight = true;
  try {
    const curStateNow = store.getState();
    const curUpNow = curStateNow?.userProfile || {};
    const res = await workerFetch('/api/id/allocate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: ident.deviceId,
        currentFisherId: ident.fisherId,
        regionCode: regCode,
        hasUserLocation: hasRealLoc,
        regionConfirmed: Boolean(curUpNow.regionConfirmed || hasRealLoc),
        profileBackup: null,
        locLabel: s.locLabel || 'Новый Уренгой',
        locAdmin1: s.locAdmin1 || '',
        login: ident.isRegistered ? (ident.login || '') : '',
        authTokenHash: ident.isRegistered ? (curUpNow.authTokenHash || '') : '',
        callsign: ident.callsign || 'Гость (Резерв)',
        tgId: ident.isRegistered ? (ident.tgLinkedId || '') : '',
        tgUsername: ident.isRegistered ? (ident.tgUsername || '') : '',
        platform: detectClientPlatformLabel(),
        version: '2.5.1',
        lat: s.lat,
        lon: s.lon
      })
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.ok && data.fisherId) {
        const curState = store.getState();
        const curUp = curState.userProfile || {};
        const curIdent = getCurrentFisherIdentity(curState);
        const srvReg = data.regionCode || regCode;
        let srvFid = normalizeFisherId(data.fisherId, srvReg);
        if (curIdent.isOwner) {
          srvFid = curIdent.fisherId;
        } else if (curIdent.isRegistered && !curIdent.isTemporaryReserve && isTemporaryReserveId(srvFid)) {
          srvFid = curIdent.fisherId;
        }
        if (isTemporaryReserveId(srvFid)) {
          _updateLockedDeviceReserveId(srvFid, curIdent.deviceId);
          _sessionReserveAllocatedFid = srvFid;
        }
        store.dispatch({
          type: 'UPDATE_USER_PROFILE',
          payload: {
            fisherId: srvFid,
            deviceId: curIdent.deviceId,
            serverIdAllocated: true,
            regionConfirmed: Boolean(curUp.regionConfirmed || hasRealLoc || srvReg !== '89')
          }
        });
        storage.saveSettings(store.getState());
        _idAllocationInFlight = false;
        return srvFid;
      }
    }
  } catch (e) {}
  _idAllocationInFlight = false;
  return ident.fisherId;
}

/**
 * Публикует точку Круга, Экипажа, SOS или Мастерской на сервер (/api/circle/publish)
 * (доступно ТОЛЬКО зарегистрированным рыбакам с постоянным ID FP_XXAAA001 или Владельцу!)
 */
export async function publishCircleItemToServer(itemObj, packToken = '') {
  if (!itemObj || !itemObj.t) return false;
  const s = store.getState();
  const ident = getCurrentFisherIdentity(s);
  if (!ident.isRegistered || ident.isTemporaryReserve) {
    return false;
  }
  const now = Date.now();
  const itemPayload = {
    ...itemObj,
    fid: itemObj.fid || ident.fisherId,
    did: itemObj.did || ident.deviceId,
    au: itemObj.au || ident.callsign,
    ca: itemObj.ca || now
  };
  delete itemPayload.poly;
  delete itemPayload.offlinePending;
  delete itemPayload.publishedAt;

  if (itemPayload.id) {
    _recentlyPublishedLocalIds.set(itemPayload.id, now);
    _explicitlyDeletedLocalIds.delete(itemPayload.id);
    _enqueueOutboxPoint(itemPayload, packToken);
  }

  try {
    const res = await workerFetch('/api/circle/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        item: itemPayload,
        packToken: packToken || itemObj.packToken || '',
        deviceId: ident.deviceId,
        authTokenHash: s.userProfile?.authTokenHash || '',
        adminToken: _serverAdminSessionToken || s.userProfile?.adminSessionToken || '',
        platform: detectClientPlatformLabel(),
        version: '2.5.1'
      })
    }, 4800, 2);

    if (res && res.ok) {
      const data = await res.json().catch(() => null);
      if (itemPayload.id) {
        _removeOutboxPoint(itemPayload.id);
      }
      const curItems = store.getState().circleItems || [];
      let changed = false;
      const updatedItems = curItems.map(it => {
        if (it && it.id === itemPayload.id) {
          changed = true;
          return { ...it, offlinePending: false, syncedAt: Date.now() };
        }
        return it;
      });
      if (!changed && data && data.item && data.item.id) {
        const srvCopy = { ...data.item, offlinePending: false, syncedAt: Date.now() };
        if (srvCopy.t === 'circle' && Number.isFinite(srvCopy.lat) && Number.isFinite(srvCopy.lon) && !Array.isArray(srvCopy.poly)) {
          const effR = getEffectiveCircleRadiusKm(srvCopy, Date.now());
          const hex = computeHexPolygonForCircle(srvCopy.lat, srvCopy.lon, effR, srvCopy.id);
          srvCopy.lat = hex.cellLat;
          srvCopy.lon = hex.cellLon;
          srvCopy.poly = hex.vertices;
        }
        updatedItems.unshift(srvCopy);
        changed = true;
      }
      if (changed) {
        storage.saveCircleItems(updatedItems);
        store.dispatch({ type: 'SET_CIRCLE_ITEMS', payload: updatedItems });
        syncCircleNavBadge();
      }
      return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

export async function flushPendingOutboxToServer() {
  if (_outboxFlushInFlight) return;
  const s = store.getState();
  const ident = getCurrentFisherIdentity(s);
  if (!ident.isRegistered || ident.isTemporaryReserve) return;
  const box = _loadPendingOutbox();
  if (!box.points.length && !box.relays.length) return;

  _outboxFlushInFlight = true;
  try {
    for (const entry of box.points) {
      if (!entry || !entry.item || !entry.item.id) continue;
      if (_explicitlyDeletedLocalIds.has(entry.item.id)) {
        _removeOutboxPoint(entry.item.id);
        continue;
      }
      await publishCircleItemToServer(entry.item, entry.packToken || '');
    }
    for (const rel of box.relays) {
      if (!rel || !rel.channelId || !rel.cipherPayload) continue;
      const ok = await pushEncryptedRelayPacket(rel, true);
      if (ok && rel._k) {
        _removeOutboxRelay(rel._k);
      }
    }
  } catch (e) {}
  _outboxFlushInFlight = false;
}

export async function deleteCircleItemFromServer(itemId) {
  if (!itemId) return false;
  _explicitlyDeletedLocalIds.add(itemId);
  _persistRelaySyncState();
  _recentlyPublishedLocalIds.delete(itemId);
  _removeOutboxPoint(itemId);
  try {
    const s = store.getState();
    const ident = getCurrentFisherIdentity(s);
    const res = await workerFetch('/api/circle/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: itemId,
        fid: ident.fisherId,
        deviceId: ident.deviceId,
        authTokenHash: s.userProfile?.authTokenHash || '',
        adminToken: _serverAdminSessionToken || s.userProfile?.adminSessionToken || ''
      })
    }, 4800, 2);
    return Boolean(res && res.ok);
  } catch (e) {
    return false;
  }
}

/**
 * Загружает с сервера все активные точки Круга, открытых Экипажей, SOS и Мастерской рядом (/api/circle/nearby)
 */
export async function syncNearbyCirclePointsFromServer(showFeedbackToast = false, forceImmediate = false) {
  const now = Date.now();
  if (!showFeedbackToast && !forceImmediate && (now - _lastNearbyCircleSyncTs < 5000 || _nearbySyncInFlight)) return false;
  _lastNearbyCircleSyncTs = now;
  _nearbySyncInFlight = true;
  try {
    await flushPendingOutboxToServer();
    const s = store.getState();
    const ident = getCurrentFisherIdentity(s);
    const radiusKm = Math.max(120, Number(s.waterRadiusKm) || 120);
    const crewKeysParam = ident.unlockedCrewKeys.map(k => String(k).toUpperCase()).join(',');
    const adminTok = _serverAdminSessionToken || s.userProfile?.adminSessionToken || '';
    const qs = new URLSearchParams({
      lat: String(Number(s.lat || 66.0833).toFixed(4)),
      lon: String(Number(s.lon || 76.6333).toFixed(4)),
      radius: String(radiusKm),
      fid: ident.fisherId,
      deviceId: ident.deviceId,
      authTokenHash: s.userProfile?.authTokenHash || '',
      crewKeys: crewKeysParam,
      adminToken: adminTok,
      platform: detectClientPlatformLabel(),
      version: '2.5.1',
      locLabel: s.locLabel || ''
    });
    const res = await workerFetch(`/api/circle/nearby?${qs.toString()}`, { method: 'GET' }, 4800, 1);
    if (!res.ok) {
      _nearbySyncInFlight = false;
      return false;
    }
    const data = await res.json();
    if (!data || !data.ok || !Array.isArray(data.items)) {
      _nearbySyncInFlight = false;
      return false;
    }

    const curList = purgeExpiredCircleItems(store.getState().circleItems || []);
    const serverIds = new Set(data.items.map(x => x.id));
    const mergedMap = new Map();

    // Синхронизация удалений с защитой только что созданных локальных точек от гонки (race condition) на iOS:
    let prunedCount = 0;
    const unconfirmedMineToRepublish = [];
    curList.forEach(it => {
      if (!it || !it.id) return;
      if (_explicitlyDeletedLocalIds.has(it.id)) {
        prunedCount++;
        return;
      }
      const isMine = String(it.fid || '').toUpperCase() === String(ident.fisherId).toUpperCase() && !it.isDemoSeed;
      const recentPubTs = _recentlyPublishedLocalIds.get(it.id) || it.publishedAt || it.ca || 0;
      const isProtectedMine = isMine && (it.offlinePending || (now - recentPubTs < 300000));
      const hasCoords = Number.isFinite(it.lat) && Number.isFinite(it.lon);
      const dist = hasCoords ? calcGeoDistanceKm(s.lat, s.lon, it.lat, it.lon) : 0;
      const inRadius = dist <= radiusKm;

      if (inRadius && !serverIds.has(it.id) && !isProtectedMine) {
        _explicitlyDeletedLocalIds.add(it.id);
        prunedCount++;
        return;
      }
      if (isMine && !serverIds.has(it.id) && (it.offlinePending || (now - recentPubTs < 120000))) {
        unconfirmedMineToRepublish.push(it);
      }
      mergedMap.set(it.id, it);
    });

    if (unconfirmedMineToRepublish.length > 0 && ident.isRegistered && !ident.isTemporaryReserve) {
      unconfirmedMineToRepublish.slice(0, 3).forEach(pt => {
        publishCircleItemToServer(pt, pt.packToken || '').catch(() => {});
      });
    }

    let newExternalCount = 0;
    for (const srvItem of data.items) {
      if (!srvItem || !srvItem.id) continue;
      const itemCopy = { ...srvItem };
      if (itemCopy.t === 'circle' && Number.isFinite(itemCopy.lat) && Number.isFinite(itemCopy.lon) && !Array.isArray(itemCopy.poly)) {
        const effR = getEffectiveCircleRadiusKm(itemCopy, now);
        const hex = computeHexPolygonForCircle(itemCopy.lat, itemCopy.lon, effR, itemCopy.id);
        itemCopy.lat = hex.cellLat;
        itemCopy.lon = hex.cellLon;
        itemCopy.poly = hex.vertices;
      }
      const isMine = String(itemCopy.fid || '').toUpperCase() === String(ident.fisherId).toUpperCase();
      const existingItem = mergedMap.get(itemCopy.id);
      if (!existingItem) {
        itemCopy.importedAt = isMine ? 0 : now;
        if (!isMine) {
          newExternalCount++;
          if (itemCopy.sos) {
            pushAppNotification({
              category: 'sos',
              title: `<svg class="k-ico" style="color:var(--bad);" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9.5" fill="#dc2626" stroke="#fca5a5" stroke-width="1.8"/><text x="12" y="15" text-anchor="middle" fill="#fff" font-size="7.5" font-weight="900" font-family="sans-serif">SOS</text></svg> СИГНАЛ SOS НА ВОДЕ (${itemCopy.wn || itemCopy.lb})`,
              body: `Координаты: ${Number(itemCopy.lat).toFixed(4)}°N, ${Number(itemCopy.lon).toFixed(4)}°E • От ${itemCopy.fid}`,
              subTab: 'radar',
              lat: itemCopy.lat,
              lon: itemCopy.lon,
              silentToast: false
            });
          } else if (itemCopy.t === 'crew') {
            pushAppNotification({
              category: 'crew',
              title: `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg> Точка Экипажа (${itemCopy.crewKey || '72ч'})`,
              body: `${itemCopy.wn || itemCopy.lb}: ${itemCopy.fn} (~${itemCopy.dp} м) • От ${itemCopy.fid}`,
              subTab: 'radar',
              lat: itemCopy.lat,
              lon: itemCopy.lon,
              silentToast: true
            });
          } else if (itemCopy.t === 'circle') {
            pushAppNotification({
              category: 'circle',
              title: `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3.5" fill="rgba(56,189,248,0.25)" stroke="currentColor" stroke-width="1.8"/><path d="M3 19c0-3.2 2.7-5.5 6-5.5s6 2.3 6 5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="17" cy="9" r="2.8" stroke="currentColor" stroke-width="1.6"/><path d="M16 14c2.6.3 4.8 2 5 4.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg> Новая сводка в Круге (${itemCopy.wn || itemCopy.lb})`,
              body: `${itemCopy.fn} на «${itemCopy.bt || 'по сезону'}» • От ${itemCopy.fid}`,
              subTab: 'radar',
              lat: itemCopy.lat,
              lon: itemCopy.lon,
              silentToast: true
            });
          }
        }
      }
      mergedMap.set(itemCopy.id, itemCopy);
    }

    const mergedList = Array.from(mergedMap.values())
      .sort((a, b) => (b.ca || 0) - (a.ca || 0))
      .slice(0, 120);

    if (prunedCount > 0) {
      _persistRelaySyncState();
    }
    if (newExternalCount > 0 || prunedCount > 0 || mergedList.length !== curList.length) {
      storage.saveCircleItems(mergedList);
      store.dispatch({ type: 'SET_CIRCLE_ITEMS', payload: mergedList });
      syncCircleNavBadge();
    }

    if (showFeedbackToast) {
      showToast(
 newExternalCount > 0
 ? ` Радар Круга обновлён: получено ${newExternalCount} новых точек!`
 : ` Радар Круга синхронизирован (активных точек: ${mergedList.length})`,
        'good'
      );
    }
    _nearbySyncInFlight = false;
    return true;
  } catch (e) {
    _nearbySyncInFlight = false;
    if (showFeedbackToast) {
      showToast('Автономный режим радара Круга (показаны сохранённые точки)', 'info');
    }
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
    deviceId: ident.deviceId || up.deviceId || '',
    login: ident.login || ident.callsign,
    callsign: ident.callsign,
    tgLinkedId: ident.tgLinkedId || up.tgLinkedId || '',
    tgUsername: ident.tgUsername || up.tgUsername || '',
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
    favorites: Array.isArray(s.favorites) ? s.favorites.slice(0, 25) : [],
    savedSpots: Array.isArray(s.savedSpots)
      ? s.savedSpots.slice(0, 10).map(sp => ({
          id: sp.id,
          name: String(sp.name || '').slice(0, 36),
          lat: Number(Number(sp.lat || 0).toFixed(4)),
          lon: Number(Number(sp.lon || 0).toFixed(4)),
          water: sp.water || 'small_river',
          depth: sp.depth || 2
        }))
      : [],
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

  const isCloudOwner = Boolean(
    cloudProf.ownerUnlocked ||
    prevUp.ownerUnlocked ||
    isLoginOwnerMatch(cloudProf.login) ||
    isOwnerFisherId(cloudProf.fisherId)
  );
  const resolvedFid = isCloudOwner
    ? (String(cloudProf.fisherId || prevUp.fisherId || '').toUpperCase() === OWNER_SECONDARY_FISHER_ID ? OWNER_SECONDARY_FISHER_ID : OWNER_BOUND_FISHER_ID)
    : (cloudProf.fisherId && !isTemporaryReserveId(cloudProf.fisherId) ? cloudProf.fisherId : prevUp.fisherId);

  store.dispatch({
    type: 'UPDATE_USER_PROFILE',
    payload: {
      onboarded: true,
      login: isCloudOwner ? (cloudProf.login || OWNER_BOUND_LOGIN) : (cloudProf.login || prevUp.login || cloudProf.callsign || 'Рыболов'),
      callsign: isCloudOwner ? (cloudProf.callsign || OWNER_BOUND_LOGIN) : (cloudProf.callsign || prevUp.callsign || 'Рыболов'),
      fisherId: resolvedFid,
      tgLinkedId: String(cloudProf.tgLinkedId || cloudProf.tgId || prevUp.tgLinkedId || ''),
      tgUsername: String(cloudProf.tgUsername || prevUp.tgUsername || ''),
      pinHash: cloudProf.pinHash || prevUp.pinHash,
      authTokenHash: cloudProf.authTokenHash || prevUp.authTokenHash,
      ownerUnlocked: isCloudOwner,
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
 * Регистрация или вход по Логину (или постоянному ID) и Паролю.
 * Постоянный ID выдаётся ОДИН РАЗ и навсегда привязывается СТРОГО к Логину и Паролю (не к телефону!),
 * обеспечивая единый ID и одинаковые данные на Android, iOS, планшетах, ПК и в Telegram Mini App.
 */
export async function authenticateAndSyncAccount(rawLogin, rawPassword, mode = 'login', overrideRegionCode = '') {
  const s = store.getState();
  const regCode = (overrideRegionCode && /^\d{2}$/.test(String(overrideRegionCode).trim()))
    ? String(overrideRegionCode).trim()
    : resolveRussianRegionCode(s);
  const creds = resolveAccountCredentials(rawLogin, rawPassword, regCode);
  if (!creds.ok) {
    return { ok: false, error: creds.error || 'Укажите логин и пароль' };
  }

  const tgUser = getTelegramUser();
  const prevUp = s.userProfile || {};

  const isSamePrevLogin = Boolean(prevUp.login && prevUp.login.toLowerCase() === creds.login.toLowerCase());
  let effectiveFisherId = creds.fisherId;
  if (!creds.isOwner && isSamePrevLogin && prevUp.fisherId && !isTemporaryReserveId(prevUp.fisherId) && !isOwnerFisherId(prevUp.fisherId)) {
    effectiveFisherId = normalizeFisherId(prevUp.fisherId, regCode);
  }

  const rawTgId = tgUser?.id || (isSamePrevLogin ? prevUp.tgLinkedId : '') || '';
  let rawTgUname = tgUser?.username || (isSamePrevLogin ? prevUp.tgUsername : '') || '';
  if (!creds.isOwner && isLoginOwnerMatch(rawTgUname)) {
    rawTgUname = '';
  }

  // 1. Локальная активация профиля
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
      ownerUnlocked: creds.isOwner ? true : false,
      adminShowAllCrews: creds.isOwner ? true : (prevUp.adminShowAllCrews !== false),
      tgLinkedId: rawTgId,
      tgUsername: rawTgUname
    }
  });

  if (creds.isOwner) {
    store.dispatch({
      type: 'ADD_ADMIN_TO_WHITELIST',
      payload: { id: OWNER_BOUND_FISHER_ID, label: 'iAthor • Антон (Владелец / Основной VIP ID)' }
    });
    store.dispatch({
      type: 'ADD_ADMIN_TO_WHITELIST',
      payload: { id: OWNER_SECONDARY_FISHER_ID, label: 'iAthor82 • Антон (Владелец / Спец-ID FP_FMP089)' }
    });
  }

  const snapshot = buildProfileCloudSnapshot(store.getState());
  syncToTelegramCloud('klev_auth_v2', snapshot);

  // 2. Сетевая синхронизация через Cloudflare Worker (/auth/login или /auth/sync)
  let cloudSynced = false;
  let finalFisherId = effectiveFisherId;
  try {
    const endpoint = mode === 'sync' ? '/auth/sync' : '/auth/login';
    const res = await workerFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: creds.login,
        password: rawPassword,
        authTokenHash: creds.authTokenHash,
        pinHash: creds.pinHash,
        regionCode: regCode,
        platform: detectClientPlatformLabel(),
        version: '2.5.1',
        profileSnapshot: snapshot
      })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || (data && data.ok === false)) {
      // Если логин занят другим рыбаком или неверный пароль — откатываем к временному резервному ID!
      if (!prevUp.pinHash) {
        const tempId = formatTempReserveFisherId(regCode, storage.getDeviceId ? storage.getDeviceId() : 'dev');
        store.dispatch({
          type: 'UPDATE_USER_PROFILE',
          payload: {
            login: '',
            callsign: 'Гость (Резерв)',
            fisherId: tempId,
            pinHash: '',
            authTokenHash: '',
            ownerUnlocked: false
          }
        });
      }
      return {
        ok: false,
        error: data?.error || 'Неверный пароль или логин уже занят другим рыбаком'
      };
    }
    if (data && data.ok && data.profile) {
      if (creds.isOwner || data.isOwner) {
        finalFisherId = data.fisherId === OWNER_SECONDARY_FISHER_ID ? OWNER_SECONDARY_FISHER_ID : OWNER_BOUND_FISHER_ID;
        data.profile.fisherId = finalFisherId;
        data.profile.login = creds.login;
        data.profile.callsign = creds.callsign;
        data.profile.ownerUnlocked = true;
      } else if (data.fisherId) {
        finalFisherId = normalizeFisherId(data.fisherId, regCode);
        data.profile.fisherId = finalFisherId;
      }
      if (data.adminSessionToken) {
        _serverAdminSessionToken = data.adminSessionToken;
        data.profile.adminSessionToken = data.adminSessionToken;
      }
      if (typeof data.serverDynamicSlotHtml === 'string' && data.serverDynamicSlotHtml) {
        _serverDynamicAdminSlotHtml = data.serverDynamicSlotHtml;
      }
      applyCloudProfileToDevice(data.profile, data.whitelist);
      cloudSynced = true;
      _cloudSessionVerified = true;
      setTimeout(() => { ensureFisherIdentityInitialized(true).catch(() => {}); }, 150);
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
 * Выход из зарегистрированного профиля на текущем устройстве (возвращает устройство на временный резервный ID FP_XXRZYYYY)
 */
export function logoutCurrentFisherAccount() {
  const s = store.getState();
  const regCode = resolveRussianRegionCode(s);
  const devId = storage.getDeviceId ? storage.getDeviceId() : 'dev_local';
  const tempFid = formatTempReserveFisherId(regCode, `rz_v21:${devId}:${regCode}`);
  _serverAdminSessionToken = '';
  _serverDynamicAdminSlotHtml = '';
  store.dispatch({
    type: 'UPDATE_USER_PROFILE',
    payload: {
      login: '',
      callsign: 'Гость (Резерв)',
      fisherId: tempFid,
      pinHash: '',
      authTokenHash: '',
      adminSessionToken: '',
      ownerUnlocked: false,
      tgLinkedId: '',
      tgUsername: ''
    }
  });
  storage.saveSettings(store.getState());
  if (s.route === 'admin') {
    router.navigate('forecast');
  }
  return tempFid;
}

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
    const res = await workerFetch('/auth/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login,
        authTokenHash: tokenHash,
        pinHash: up.pinHash || '',
        regionCode: resolveRussianRegionCode(s),
        platform: detectClientPlatformLabel(),
        version: '2.5.1',
        profileSnapshot: snapshot
      })
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.ok && data.profile) {
        if (data.adminSessionToken) {
          _serverAdminSessionToken = data.adminSessionToken;
          data.profile.adminSessionToken = data.adminSessionToken;
        }
        if (typeof data.serverDynamicSlotHtml === 'string') {
          _serverDynamicAdminSlotHtml = data.serverDynamicSlotHtml;
        }
        applyCloudProfileToDevice(data.profile, data.whitelist);
        return true;
      }
    }
  } catch (e) {}
  return false;
}

/**
 * Генерирует компактную шапку-переключатель между 4 раздельными подменю настроек:
 * 1) Вход и ID | 2) Рыбалка | 3) Параметры | 4) Уведомления
 */
export function renderSettingsZoneTabsHtml(activeZone = 'auth') {
  const effZone = activeZone === 'notif' ? 'app' : activeZone;
  const zones = [
    { id: 'auth', icon: '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="5" y="11" width="14" height="10" rx="2.5" fill="rgba(251,191,36,0.22)" stroke="#fbbf24" stroke-width="1.8"/><path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>', label: 'Вход и ID' },
    { id: 'fishing', icon: '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 20C5 11 11 5 20 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 4v7c0 1.7-1.3 3-3 3s-3-1.3-3-3" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/><circle cx="14" cy="16" r="2.2" fill="#10b981"/></svg>', label: 'Рыбалка' },
    { id: 'app', icon: '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3.2" stroke="currentColor" stroke-width="1.9"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.77 1.05 1.41 1.19H21a2 2 0 1 1 0 4h-.09c-.64.14-1.15.59-1.51 1.21z" stroke="currentColor" stroke-width="1.6"/></svg>', label: 'Настройки' }
  ];
  return `
    <div class="settings-zone-bar" role="tablist" aria-label="Зоны настроек">
      ${zones.map(z => `
        <button type="button" class="btn btn-sm settings-zone-tab ${effZone === z.id ? 'btn-accent' : ''}" data-switch-settings-zone="${z.id}" role="tab" aria-selected="${effZone === z.id ? 'true' : 'false'}">
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
 * Обновляет бейджи непрочитанных событий на нижней вкладке « Круг» и непрочитанных сообщений на вкладке « Чаты»
 */
export function markCircleNotificationsRead() {
  try {
    const s = store.getState();
    const notifs = Array.isArray(s.notifications) ? s.notifications : [];
    if (notifs.some(n => !n.read)) {
      const updated = notifs.map(n => ({ ...n, read: true }));
      store.dispatch({ type: 'SET_NOTIFICATIONS', payload: updated });
      if (typeof storage !== 'undefined' && typeof storage.saveNotifications === 'function') {
        storage.saveNotifications(updated);
      }
      syncCircleNavBadge();
    }
  } catch (e) {}
}

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

    applyBadgeToTab('circle', 'circleNavBadge', unreadNotifs + unreadChats);
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
  triggerSystemNotificationCrossPlatform(notif.title, notif.body, category);
  syncCircleNavBadge();

  if (!silentToast) {
    const tone = category === 'sos' ? 'bad' : (category === 'crew' || category === 'dm' ? 'good' : 'info');
    showToast(` ${notif.title}: ${notif.body}`, tone);
  }

  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(notif.title, { body: notif.body, icon: 'icon-192.png' });
    }
  } catch (e) {}

  return notif;
}

export const CIRCLE_HEX_TTL_HOURS = 72;
export const CIRCLE_HEX_TTL_MS = CIRCLE_HEX_TTL_HOURS * 3600 * 1000;

/**
 * Вычисляет состояние 72-часового угасания гексагона (соты) «Круга» на карте и в ленте:
 * - 0..12 ч: яркая сота ±5 км (свежесть 83–100%), сплошной контур
 * - 12..36 ч: актуальная сота ±6.5 км (свежесть 50–83%), штриховой контур
 * - 36..72 ч: угасающая сота ±8.5 км (свежесть 1–50%), пунктирный полупрозрачный контур
 * - > 72 ч: точка полностью погасла (expired = true)
 */
export function getCircleHexDecayState(item, nowMs = Date.now()) {
  const baseRadius = Number(item?.br) || CIRCLE_BLUR_RADIUS_KM;
  let createdMs = Number(item?.ca) || nowMs;
  if (item?.isDemoSeed && (nowMs - createdMs) > 36 * 3600000) {
    // Чтобы стартовые демо-соты оставались наглядными, держим их в окне 6..18 ч
    createdMs = nowMs - 8 * 3600000;
  }
  const ageHours = Math.max(0, (nowMs - createdMs) / 3600000);
  const expired = !item?.isDemoSeed && ageHours >= CIRCLE_HEX_TTL_HOURS;
  const hoursLeft = Math.max(0, Math.ceil(CIRCLE_HEX_TTL_HOURS - ageHours));
  const freshness = Math.max(0, Math.min(1, 1 - (ageHours / CIRCLE_HEX_TTL_HOURS)));

  if (ageHours < 12) {
    return {
      ageHours: Math.round(ageHours * 10) / 10,
      hoursLeft,
      freshness,
      expired: false,
      radiusKm: baseRadius,
      strokeOpacity: 0.96,
      fillOpacity: 0.28,
      weight: 2.6,
      dashArray: null,
      markerOpacity: 1.0,
      stageLabel: 'Свежий сектор (0–12 ч)'
    };
  }
  if (ageHours < 36) {
    return {
      ageHours: Math.round(ageHours * 10) / 10,
      hoursLeft,
      freshness,
      expired: false,
      radiusKm: Math.max(baseRadius, 6.5),
      strokeOpacity: 0.80,
      fillOpacity: 0.18,
      weight: 2.1,
      dashArray: '8, 4',
      markerOpacity: 0.90,
      stageLabel: 'Актуальный сектор (12–36 ч)'
    };
  }
  return {
    ageHours: Math.round(ageHours * 10) / 10,
    hoursLeft,
    freshness,
    expired,
    radiusKm: Math.max(baseRadius, 8.5),
    strokeOpacity: Math.max(0.32, Number((0.28 + freshness * 0.65).toFixed(2))),
    fillOpacity: Math.max(0.06, Number((0.05 + freshness * 0.22).toFixed(2))),
    weight: 1.5,
    dashArray: '4, 6',
    markerOpacity: Math.max(0.50, Number((0.45 + freshness * 0.65).toFixed(2))),
    stageLabel: 'Угасающий сектор (36–72 ч)'
  };
}

export function getEffectiveCircleRadiusKm(item, nowMs = Date.now()) {
  return getCircleHexDecayState(item, nowMs).radiusKm;
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
      badge: '<svg class="k-ico" style="color:var(--good);" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="currentColor" stroke="rgba(255,255,255,0.65)" stroke-width="1.4"/></svg> Участник Круга',
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
      badge: `<svg class="k-ico" style="color:#fbbf24;" viewBox="0 0 24 24" fill="none"><path d="M7 4h10v5a5 5 0 0 1-10 0V4z" fill="rgba(251,191,36,0.28)" stroke="#fbbf24" stroke-width="1.8"/><path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3M12 14v4M8 20h8" stroke="#fbbf24" stroke-width="1.8" stroke-linecap="round"/></svg> Эксперт Круга (${matchRate}%)`,
      weight: 1.5,
      matchRate,
      totalCatches: total
    };
  }
  if (total >= 2 && matchRate >= 60) {
    return {
      tier: 'angler',
      badge: `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 20C5 11 11 5 20 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 4v7c0 1.7-1.3 3-3 3s-3-1.3-3-3" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/><circle cx="14" cy="16" r="2.2" fill="#10b981"/></svg> Опытный рыбак (${matchRate}%)`,
      weight: 1.0,
      matchRate,
      totalCatches: total
    };
  }
  return {
    tier: 'new',
    badge: `<svg class="k-ico" style="color:var(--good);" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="currentColor" stroke="rgba(255,255,255,0.65)" stroke-width="1.4"/></svg> Рыболов (${matchRate}%)`,
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
    reasons.push(`<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3c0 0-6 7.1-6 11.5a6 6 0 0 0 12 0C18 10.1 12 3 12 3z" fill="rgba(56,189,248,0.32)" stroke="#38bdf8" stroke-width="1.8"/><path d="M9.5 15.5c.5 1.2 1.7 2 3 2" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg> Вода ${currentWaterTemp}°C входит в рабочий коридор (${tempMin.toFixed(0)}..${tempMax.toFixed(0)}°C)`);
  } else {
    const diff = Math.min(Math.abs(currentWaterTemp - tempMin), Math.abs(currentWaterTemp - tempMax));
    score -= Math.min(45, Math.round(diff * 6));
  }

  if (rigItem.wt && rigItem.wt === currentWaterType) {
    reasons.push('<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg> Точное совпадение типа водоёма и течения');
  } else {
    score -= 15;
  }

  const rigDepth = Number.isFinite(rigItem.dp) ? rigItem.dp : currentDepth;
  if (Math.abs(rigDepth - currentDepth) <= 2.0) {
    reasons.push(`<svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="3" y="8" width="18" height="8" rx="2" transform="rotate(-35 12 12)" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8"/><path d="M8 11l1.5 2M11 9l1.5 2M14 7l1.5 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg> Близкий горизонт глубины (~${rigDepth} м)`);
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

  // Бит 7 в байте 1 (0x80) и бит 7 в байте 3 (0x80) указывают на 32-битный ID рыбака (FP_89VIP089 / FP_89AAA001) в байтах 18..21
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
          nt: customNote || '<svg class="k-ico" style="color:var(--bad);" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9.5" fill="#dc2626" stroke="#fca5a5" stroke-width="1.8"/><text x="12" y="15" text-anchor="middle" fill="#fff" font-size="7.5" font-weight="900" font-family="sans-serif">SOS</text></svg> ТРЕБУЕТСЯ ПОМОЩЬ НА ВОДЕ / ЛЬДУ! Проверьте мои координаты',
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
      nt: cleanNote || '<svg class="k-ico" style="color:var(--bad);" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9.5" fill="#dc2626" stroke="#fca5a5" stroke-width="1.8"/><text x="12" y="15" text-anchor="middle" fill="#fff" font-size="7.5" font-weight="900" font-family="sans-serif">SOS</text></svg> ТРЕБУЕТСЯ ПОМОЩЬ НА ВОДЕ / ЛЬДУ!',
      _hasCustomNote: Boolean(cleanNote)
    };
    const token = encodeSharePack(packObj);
    const _decCanonical = decodeSharePack(token);
    if (_decCanonical && _decCanonical.id) packObj.id = _decCanonical.id;
    const { webUrl, tgMiniAppUrl } = buildShareUrls(token);
    const summaryText =
      `<svg class="k-ico" style="color:var(--bad);" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9.5" fill="#dc2626" stroke="#fca5a5" stroke-width="1.8"/><text x="12" y="15" text-anchor="middle" fill="#fff" font-size="7.5" font-weight="900" font-family="sans-serif">SOS</text></svg> SOS НА ВОДЕ (ВСЕМ) • Клёв ПРО\n` +
      `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z" fill="rgba(239,68,68,0.22)" stroke="#ef4444" stroke-width="1.9"/><circle cx="12" cy="11" r="2.3" fill="#ef4444"/></svg> ${locDisplay} • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" fill="rgba(56,189,248,0.22)" stroke="currentColor" stroke-width="1.8"/><path d="M4 20c0-3.8 3.6-6.5 8-6.5s8 2.7 8 6.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> ${author}\n` +
      `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="4.5" stroke="#38bdf8" stroke-width="1.6"/><circle cx="12" cy="12" r="1.8" fill="#10b981"/></svg> GPS: ${packObj.lat.toFixed(4)}°N, ${packObj.lon.toFixed(4)}°E • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2v20M2 12h20M4.9 4.9l14.2 14.2M19.1 4.9L4.9 19.1" stroke="#7dd3fc" stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="12" r="2.2" fill="#38bdf8"/></svg> ${packObj.ice} • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> ${packObj.wnd} • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> 112` +
      (cleanNote ? `\n<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> ${cleanNote}` : '');

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
    const _decCanonical = decodeSharePack(token);
    if (_decCanonical && _decCanonical.id) packObj.id = _decCanonical.id;
    const { webUrl, tgMiniAppUrl } = buildShareUrls(token);
    const summaryText =
      `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg> ЭКИПАЖ (72 ч • Ключ ${crewKey}) • Клёв ПРО\n` +
      `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z" fill="rgba(239,68,68,0.22)" stroke="#ef4444" stroke-width="1.9"/><circle cx="12" cy="11" r="2.3" fill="#ef4444"/></svg> ${locDisplay} (~${s.depth.toFixed(1)} м) • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" fill="rgba(56,189,248,0.22)" stroke="currentColor" stroke-width="1.8"/><path d="M4 20c0-3.8 3.6-6.5 8-6.5s8 2.7 8 6.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> ${author}\n` +
      `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 12s4-6 11-6c4.2 0 7 2.5 9 6-2 3.5-4.8 6-9 6-7 0-11-6-11-6z" fill="rgba(56,189,248,0.28)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M2 12l-1.5-3.5L5 10.5M2 12l-1.5 3.5L5 13.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="16.5" cy="10.8" r="1.3" fill="currentColor"/></svg> ${fish.name} • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3c0 0-6 7.1-6 11.5a6 6 0 0 0 12 0C18 10.1 12 3 12 3z" fill="rgba(56,189,248,0.32)" stroke="#38bdf8" stroke-width="1.8"/><path d="M9.5 15.5c.5 1.2 1.7 2 3 2" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg> ~${packObj.tw}°C • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 20C5 11 11 5 20 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 4v7c0 1.7-1.3 3-3 3s-3-1.3-3-3" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/><circle cx="14" cy="16" r="2.2" fill="#10b981"/></svg> ${shortRigWeight} (${shortBait})` +
      (cleanNote ? `\n<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> ${cleanNote}` : '');

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
    const _decCanonical = decodeSharePack(token);
    if (_decCanonical && _decCanonical.id) packObj.id = _decCanonical.id;
    const { webUrl, tgMiniAppUrl } = buildShareUrls(token);
    const summaryText =
      `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" fill="rgba(56,189,248,0.2)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> МАСТЕРСКАЯ СНАСТЕЙ • Клёв ПРО\n` +
      `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 12s4-6 11-6c4.2 0 7 2.5 9 6-2 3.5-4.8 6-9 6-7 0-11-6-11-6z" fill="rgba(56,189,248,0.28)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M2 12l-1.5-3.5L5 10.5M2 12l-1.5 3.5L5 13.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="16.5" cy="10.8" r="1.3" fill="currentColor"/></svg> ${fish.name} • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg> ${prof.shortName} (~${s.depth.toFixed(1)} м, <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3c0 0-6 7.1-6 11.5a6 6 0 0 0 12 0C18 10.1 12 3 12 3z" fill="rgba(56,189,248,0.32)" stroke="#38bdf8" stroke-width="1.8"/><path d="M9.5 15.5c.5 1.2 1.7 2 3 2" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg> ${twMin}–${twMax}°C)\n` +
      `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3v18M5 7h14M5 7l-3 6h6l-3-6zm14 0l-3 6h6l-3-6zM8 21h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> ${shortRigWeight} • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 18c0-4 4-4 4-8s4-4 4-6 5-1 5 3-3 5-3 8 4 4 6 2" stroke="#f43f5e" stroke-width="2.2" stroke-linecap="round"/></svg> ${shortBait} • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" fill="rgba(56,189,248,0.22)" stroke="currentColor" stroke-width="1.8"/><path d="M4 20c0-3.8 3.6-6.5 8-6.5s8 2.7 8 6.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> ${author}` +
      (cleanNote ? `\n<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> ${cleanNote}` : '');

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
  const _decCanonical = decodeSharePack(token);
  if (_decCanonical && _decCanonical.id) packObj.id = _decCanonical.id;
  const { webUrl, tgMiniAppUrl } = buildShareUrls(token);
  const summaryText =
    `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3.5" fill="rgba(56,189,248,0.25)" stroke="currentColor" stroke-width="1.8"/><path d="M3 19c0-3.2 2.7-5.5 6-5.5s6 2.3 6 5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="17" cy="9" r="2.8" stroke="currentColor" stroke-width="1.6"/><path d="M16 14c2.6.3 4.8 2 5 4.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg> СВОДКА В КРУГ (±5 км) • Клёв ПРО\n` +
    `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z" fill="rgba(239,68,68,0.22)" stroke="#ef4444" stroke-width="1.9"/><circle cx="12" cy="11" r="2.3" fill="#ef4444"/></svg> ${locDisplay} (~${packObj.dp} м) • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" fill="rgba(56,189,248,0.22)" stroke="currentColor" stroke-width="1.8"/><path d="M4 20c0-3.8 3.6-6.5 8-6.5s8 2.7 8 6.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> ${author}\n` +
    `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 12s4-6 11-6c4.2 0 7 2.5 9 6-2 3.5-4.8 6-9 6-7 0-11-6-11-6z" fill="rgba(56,189,248,0.28)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M2 12l-1.5-3.5L5 10.5M2 12l-1.5 3.5L5 13.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="16.5" cy="10.8" r="1.3" fill="currentColor"/></svg> ${fish.name}${packObj.kg ? ` (${packObj.kg} кг)` : ''} • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3c0 0-6 7.1-6 11.5a6 6 0 0 0 12 0C18 10.1 12 3 12 3z" fill="rgba(56,189,248,0.32)" stroke="#38bdf8" stroke-width="1.8"/><path d="M9.5 15.5c.5 1.2 1.7 2 3 2" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg> ~${packObj.tw}°C • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 18c0-4 4-4 4-8s4-4 4-6 5-1 5 3-3 5-3 8 4 4 6 2" stroke="#f43f5e" stroke-width="2.2" stroke-linecap="round"/></svg> ${shortBait}` +
    (cleanNote ? `\n<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> ${cleanNote}` : '');

  return { mode: 'circle', packObj, token, webUrl, tgMiniAppUrl, summaryText };
}

export function purgeExpiredCircleItems(items = []) {
  const now = Date.now();
  const valid = (Array.isArray(items) ? items : []).filter(item => {
    if (!item) return false;
    if (item.t === 'crew' && Number.isFinite(item.ea) && item.ea < now) {
      return false;
    }
    if (item.t === 'circle' && !item.isDemoSeed && getCircleHexDecayState(item, now).expired) {
      return false;
    }
    return true;
  });
  const seenIds = new Set();
  const seenRecentTwin = [];
  const result = [];
  for (const it of valid) {
    if (it.id) {
      if (seenIds.has(it.id)) continue;
      seenIds.add(it.id);
    }
    const fidKey = String(it.fid || it.did || '').toUpperCase();
    const tKey = String(it.t || 'circle');
    const fiKey = String(it.fi || '');
    const caVal = Number(it.ca) || 0;
    if (fidKey && caVal > 0) {
      const isTwin = seenRecentTwin.some(prev =>
        prev.fidKey === fidKey &&
        prev.tKey === tKey &&
        prev.fiKey === fiKey &&
        Boolean(prev.sos) === Boolean(it.sos) &&
        Math.abs(prev.caVal - caVal) < 90000
      );
      if (isTwin) continue;
      seenRecentTwin.push({ fidKey, tKey, fiKey, sos: it.sos, caVal });
    }
    result.push(it);
  }
  return result;
}

function saveOwnSharePackLocally(finalPack, showFeedbackToast = false) {
  if (!finalPack || !finalPack.packObj) return null;
  const s = store.getState();
  const now = Date.now();
  const item = {
    ...finalPack.packObj,
    packToken: finalPack.token || '',
    offlinePending: true,
    publishedAt: now,
    importedAt: 0
  };
  if (item.t === 'crew' && !item.sos && item.crewKey) {
    store.dispatch({ type: 'UNLOCK_CREW_KEY', payload: item.crewKey });
  }
  if (item.id) {
    _recentlyPublishedLocalIds.set(item.id, now);
    _explicitlyDeletedLocalIds.delete(item.id);
  }
  const existing = purgeExpiredCircleItems(s.circleItems || []);
  const filtered = existing.filter(x => {
    if (!x) return false;
    if (x.id === item.id) return false;
    const sameAuthor = String(x.fid || '').toUpperCase() === String(item.fid || '').toUpperCase();
    if (sameAuthor && x.t === item.t && x.fi === item.fi && Math.abs((Number(x.ca) || 0) - (Number(item.ca) || now)) < 90000) {
      return false;
    }
    return true;
  });
  const updated = [item, ...filtered].slice(0, 80);
  storage.saveCircleItems(updated);
  store.dispatch({ type: 'SET_CIRCLE_ITEMS', payload: updated });
  syncCircleNavBadge();
  syncToTelegramCloud('klev_circle_v2', updated.slice(0, 8));
  if (showFeedbackToast) {
    const label = item.sos
      ? '<svg class="k-ico" style="color:var(--bad);" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9.5" fill="#dc2626" stroke="#fca5a5" stroke-width="1.8"/><text x="12" y="15" text-anchor="middle" fill="#fff" font-size="7.5" font-weight="900" font-family="sans-serif">SOS</text></svg> Сигнал SOS опубликован в Круге и отправлен на сервер!'
      : (item.t === 'crew'
          ? `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg> Точка Экипажа (${item.crewKey}) опубликована!`
          : `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3.5" fill="rgba(56,189,248,0.25)" stroke="currentColor" stroke-width="1.8"/><path d="M3 19c0-3.2 2.7-5.5 6-5.5s6 2.3 6 5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="17" cy="9" r="2.8" stroke="currentColor" stroke-width="1.6"/><path d="M16 14c2.6.3 4.8 2 5 4.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg> Сводка по виду «${item.fn}» (${item.wn || item.lb}) опубликована в Круге!`);
    showToast(label, 'good');
  }
  return item;
}

export async function pushEncryptedRelayPacket({ channelId, cipherPayload, kind = 'chat', regionGrid = '', crewKey = '', peerId = '' }, fromOutbox = false) {
  const ident = getCurrentFisherIdentity();
  if (!ident.isRegistered || ident.isTemporaryReserve) return false;
  const sNow = store.getState();
  const pktPayload = {
    channelId: String(channelId || '').toUpperCase(),
    senderId: ident.fisherId,
    deviceId: ident.deviceId,
    authTokenHash: sNow?.userProfile?.authTokenHash || '',
    adminToken: _serverAdminSessionToken || sNow?.userProfile?.adminSessionToken || '',
    cipherPayload,
    kind,
    crewKey: String(crewKey || '').toUpperCase(),
    peerId: String(peerId || '').toUpperCase(),
    regionGrid,
    ts: Date.now()
  };
  const outboxKey = `${pktPayload.channelId}_${String(cipherPayload || '').slice(-24)}`;
  if (!fromOutbox) {
    _enqueueOutboxRelay({ ...pktPayload, _k: outboxKey });
  }
  try {
    const res = await workerFetch('/relay/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pktPayload)
    }, 4500, 2);
    if (res && res.ok) {
      _removeOutboxRelay(outboxKey);
      return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

export async function pollEncryptedRelayPackets(manual = false) {
  if (_relayPollInFlight && !manual) return 0;
  _relayPollInFlight = true;
  try {
    const s = store.getState();
    const ident = getCurrentFisherIdentity(s);
    const gridKey = `GRID_${Math.round(s.lat)}_${Math.round(s.lon)}`;
    const myRegCode = resolveRussianRegionCode(s);
    const crewBoxes = ident.unlockedCrewKeys.map(k => `CREW_${String(k).toUpperCase()}`);
    const regChatBox = `CREW_REG-${myRegCode}`;
    if (!crewBoxes.includes(regChatBox)) crewBoxes.push(regChatBox);
    if (activeChatChannelId && activeChatChannelId.startsWith('crew:')) {
      const actCrewBox = `CREW_${activeChatChannelId.replace(/^crew:/, '').toUpperCase()}`;
      if (!crewBoxes.includes(actCrewBox)) crewBoxes.push(actCrewBox);
    }
    const dmBoxes = [`DM_${ident.fisherId}`];
    if (ident.isOwner) {
      dmBoxes.push(`DM_${OWNER_BOUND_FISHER_ID}`, `DM_${OWNER_SECONDARY_FISHER_ID}`);
    }
    const boxes = Array.from(new Set([...dmBoxes, gridKey, 'SOS_ALL', ...crewBoxes])).slice(0, 24);

    const authTokParam = encodeURIComponent(s.userProfile?.authTokenHash || '');
    const admTokParam = encodeURIComponent(_serverAdminSessionToken || s.userProfile?.adminSessionToken || '');
    const devIdParam = encodeURIComponent(ident.deviceId || '');
    const url = `${RELAY_WORKER_URL}/relay/pull?boxes=${encodeURIComponent(boxes.join(','))}&since=${lastRelayPullTs}&viewer=${encodeURIComponent(ident.fisherId)}&deviceId=${devIdParam}&authTokenHash=${authTokParam}&adminToken=${admTokParam}`;
    const res = await workerFetch(url, { method: 'GET' }, 4500, 0);
    if (!res.ok) {
      if (manual) showToast('Локальный режим чатов активен (транзитный ретранслятор офлайн)', 'info');
      return 0;
    }
    const data = await res.json();
    const packets = Array.isArray(data?.packets) ? data.packets : [];
    let newCount = 0;

    let stateChanged = false;
    for (const pkt of packets) {
      if (!pkt) continue;
      if (pkt.ts && pkt.ts > lastRelayPullTs) {
        lastRelayPullTs = pkt.ts;
        stateChanged = true;
      }
      if (pkt.id && _seenRelayPacketIds.has(pkt.id)) continue;
      if (pkt.id) {
        _seenRelayPacketIds.add(pkt.id);
        stateChanged = true;
      }

      if (pkt.kind === 'circle_del') {
        const delTargetId = pkt.targetId || pkt.itemId;
        if (delTargetId) {
          _explicitlyDeletedLocalIds.add(delTargetId);
          stateChanged = true;
          const curItems = store.getState().circleItems || [];
          if (curItems.some(x => x && x.id === delTargetId)) {
            const filtered = curItems.filter(x => x && x.id !== delTargetId);
            storage.saveCircleItems(filtered);
            store.dispatch({ type: 'SET_CIRCLE_ITEMS', payload: filtered });
            syncCircleNavBadge();
          }
        }
        continue;
      }

      if (!pkt.cipherPayload) continue;
      if (pkt.senderId && pkt.senderId === ident.fisherId) continue;

      if (pkt.kind === 'pack') {
        // Игнорируем архивные pack-пакеты из transit_relay: единственным актуальным источником точек Круга/Экипажа/SOS является /api/circle/nearby (таблица circle_points в D1).
        // Это полностью исключает фантомное появление давно удалённых точек Круга при запуске приложения!
        continue;
      } else if (pkt.kind === 'crew_chat' || pkt.kind === 'dm_chat') {
        let msgObj = null;
        const candidates = [];
        if (pkt.crewKey) candidates.push(pkt.crewKey);
        if (pkt.channelId && pkt.channelId.startsWith('CREW_')) candidates.push(pkt.channelId.replace(/^CREW_/, ''));
        if (pkt.channelKey) candidates.push(pkt.channelKey);
        if (pkt.channelId) candidates.push(pkt.channelId);
        if (pkt.senderId) candidates.push([ident.fisherId, pkt.senderId].sort().join(':'));
        if (pkt.peerId) candidates.push([ident.fisherId, pkt.peerId].sort().join(':'));
        if (pkt.channelId && pkt.channelId.startsWith('DM_')) candidates.push(pkt.channelId.replace(/^DM_/, ''));

        for (const k of candidates) {
          if (!k) continue;
          msgObj = decryptChatPayload(pkt.cipherPayload, k);
          if (msgObj && msgObj.id) break;
        }

        if (msgObj && msgObj.id) {
          const added = appendIncomingChatMessage(msgObj, true);
          if (added) {
            newCount++;
            const secChats = document.getElementById('secChats');
            if (secChats && secChats.classList.contains('active')) {
              renderChatsSection(secChats);
            }
          }
        }
      }
    }

    if (stateChanged) {
      _persistRelaySyncState();
    }
    if (manual) {
      showToast(newCount > 0 ? ` Получено новых зашифрованных пакетов: ${newCount}` : ' Новых внешних пакетов в очереди нет', 'good');
    }
    _relayPollInFlight = false;
    return newCount;
  } catch (e) {
    _relayPollInFlight = false;
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

  let normalizedChanId = String(msgObj.channelId || '');
  let otherFid = '';
  if (normalizedChanId.startsWith('dm:')) {
    otherFid = msgObj.senderId === ident.fisherId
      ? (msgObj.peerId || normalizedChanId.replace(/^dm:/, '').split(':').find(p => p !== ident.fisherId) || '')
      : (msgObj.senderId || msgObj.peerId || '');
    if (otherFid) {
      normalizedChanId = getCanonicalDmChannelId(ident.fisherId, otherFid, existing);
    }
  }

  // Защита от «оживления» удалённых чатов: если этот чат или переписка с собеседником были удалены после времени отправки пакета (msgObj.ts), игнорируем старый пакет!
  const msgTs = Number(msgObj.ts) || 0;
  const senderNameNorm = String(msgObj.senderName || msgObj.peerName || '').trim().toLowerCase();
  const delChanTs = _deletedChatTimestamps.get(normalizedChanId) || _deletedChatTimestamps.get(String(msgObj.channelId || '')) || 0;
  const delPeerTs = otherFid ? (_deletedChatTimestamps.get(`peer:${String(otherFid).toUpperCase()}`) || 0) : 0;
  const delNameTs = senderNameNorm ? (_deletedChatTimestamps.get(`name:${senderNameNorm}`) || 0) : 0;
  const effectiveDeletedTs = Math.max(delChanTs, delPeerTs, delNameTs);
  if (effectiveDeletedTs > 0 && msgObj.senderId !== ident.fisherId) {
    if (!msgTs || msgTs <= effectiveDeletedTs + 5000) {
      return false;
    }
  }

  store.dispatch({ type: 'RESTORE_CHAT_CHANNEL', payload: normalizedChanId });

  const isMine = msgObj.senderId === ident.fisherId;
  const record = {
    ...msgObj,
    channelId: normalizedChanId,
    unread: !isMine && (s.route !== 'chats' || !isFullScreenChatOpen || activeChatChannelId !== normalizedChanId)
  };

  const updated = [...existing, record].slice(-500);
  storage.saveChatMessages(updated);
  store.dispatch({ type: 'SET_CHAT_MESSAGES', payload: updated });
  syncCircleNavBadge();

  if (!isMine && notifyIfExternal) {
    const isCrew = String(msgObj.channelId || '').startsWith('crew:');
    pushAppNotification({
      category: isCrew ? 'crew' : 'dm',
      title: isCrew ? `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg> Сообщение в Экипаже (${msgObj.crewKey || 'Экипаж'})` : `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> Сообщение от ${msgObj.senderName || msgObj.senderId}`,
      body: `${msgObj.senderName || 'Рыболов'}: ${msgObj.text.slice(0, 65)}`,
      subTab: 'chats',
      channelId: msgObj.channelId
    });
  }
  return true;
}

export async function sendFishermanChatMessage({ channelId, text, crewKey = '', peerId = '', peerName = '', catchMeta = null }) {
  if (!requireRegisteredFisherId('отправки сообщения в чат')) return null;
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
  await pushEncryptedRelayPacket({
    channelId: relayBox,
    cipherPayload,
    kind: isCrew ? 'crew_chat' : 'dm_chat',
    crewKey: isCrew ? encryptionKey : '',
    peerId: !isCrew ? String(peerId || '').toUpperCase() : ''
  });

  triggerHaptic('light');
  return { msgObj, cipherPayload, encryptionKey };
}

/**
 * Модальное окно отправки улова в чат (из Журнала уловов или из вкладки « Чаты»)
 */
export function openShareCatchToChatModal(preselectedCatch = null) {
  if (!requireRegisteredFisherId('отправки улова в чат')) return;
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
      label: `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg> Чат Экипажа ${k}${cItem ? ` (${cItem.wn || cItem.lb})` : ''}`,
      crewKey: k
    });
  }

  for (const m of (s.chatMessages || [])) {
    if (!m || !String(m.channelId || '').startsWith('dm:')) continue;
    if (!channels.some(c => c.channelId === m.channelId)) {
      const peerId = m.senderId === ident.fisherId ? (m.peerId || 'FP_89VIP089') : m.senderId;
      const peerName = m.senderId === ident.fisherId ? (m.peerName || peerId) : (m.senderName || peerId);
      channels.push({
        channelId: m.channelId,
        label: `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> Личный чат: ${peerName} (${peerId})`,
        peerId,
        peerName
      });
    }
  }

  const defaultChanId = activeChatChannelId || channels[0]?.channelId || '';

  const html = `
    <div style="display:flex;flex-direction:column;gap:12px;font-size:var(--fs-sm);">
      <div style="padding:9px 11px;background:rgba(16,185,129,0.12);border:1px solid var(--good);border-radius:var(--r-sm);font-size:var(--fs-xs);line-height:1.42;">
        <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 20C5 11 11 5 20 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 4v7c0 1.7-1.3 3-3 3s-3-1.3-3-3" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/><circle cx="14" cy="16" r="2.2" fill="#10b981"/></svg> <b>Поделиться уловом в зашифрованном чате:</b> напарники увидят карточку вашего трофея (рыба, вес, наживка, температура воды, давление) и смогут в 1 касание открыть сектор поимки на карте!
      </div>

      <div>
        <label style="display:block;font-weight:800;font-size:var(--fs-xs);color:var(--muted);margin-bottom:4px;">1. ВЫБЕРИТЕ УЛОВ ДЛЯ ОТПРАВКИ:</label>
        <select id="scCatchSelect" style="width:100%;">
          ${preselectedCatch ? `
            <option value="${preselectedCatch.id}" selected>
 ${preselectedCatch.fishName} ${preselectedCatch.weightKg ? `• ${preselectedCatch.weightKg} кг` : ''} (${preselectedCatch.dateLabel || 'Сегодня'}, ${preselectedCatch.locLabel || s.locLabel})
 </option>
          ` : ''}
          ${catches.filter(c => !preselectedCatch || c.id !== preselectedCatch.id).map(c => `
            <option value="${c.id}">
 ${c.fishName} ${c.weightKg ? `• ${c.weightKg} кг` : ''} (${c.dateLabel || c.date}, ${c.locLabel || s.locLabel})
 </option>
          `).join('')}
          <option value="__current_spot__" ${(!preselectedCatch && catches.length === 0) ? 'selected' : ''}>
 Текущая рыба и точка с экрана (${(FISH_DB.find(f => f.id === s.fishId) || FISH_DB[0]).name} • ${s.locLabel})
 </option>
        </select>
      </div>

      <div>
        <label style="display:block;font-weight:800;font-size:var(--fs-xs);color:var(--muted);margin-bottom:4px;">2. КУДА ОТПРАВИТЬ (ЭКИПАЖ ИЛИ ЛИЧНЫЙ ЧАТ ПО ID):</label>
        <select id="scChannelSelect" style="width:100%;">
          ${channels.map(ch => `
            <option value="${ch.channelId}" ${ch.channelId === defaultChanId ? 'selected' : ''}>${String(ch.label || '').replace(/<[^>]+>/g, '').trim()}</option>
          `).join('')}
          <option value="__new_dm__"> Ввести ID рыбака (FP_89AAA001) для личного чата...</option>
        </select>
        <input type="text" id="scCustomPeerIdInput" class="input" placeholder="Введите ID рыбака (напр. FP_89VIP089)..." style="display:none;margin-top:6px;text-transform:uppercase;">
      </div>

      <div>
        <label style="display:block;font-weight:800;font-size:var(--fs-xs);color:var(--muted);margin-bottom:4px;">3. КОММЕНТАРИЙ К УЛОВУ (ПО ЖЕЛАНИЮ):</label>
        <input type="text" id="scCommentInput" class="input" maxlength="80" placeholder="Например: Взяла на бровке 3.5 м с утра на паузе!">
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:8px;margin-top:4px;">
        <button type="button" class="btn btn-good" id="scConfirmSendChatBtn"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> Отправить в чат приложения</button>
        <button type="button" class="btn btn-accent" id="scSendTelegramDirectBtn"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" fill="rgba(56,189,248,0.22)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> Переслать в Telegram</button>
      </div>
    </div>
  `;

  openModal('<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 20C5 11 11 5 20 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 4v7c0 1.7-1.3 3-3 3s-3-1.3-3-3" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/><circle cx="14" cy="16" r="2.2" fill="#10b981"/></svg> Поделиться уловом в чате', html, (bodyEl) => {
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
        `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 20C5 11 11 5 20 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 4v7c0 1.7-1.3 3-3 3s-3-1.3-3-3" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/><circle cx="14" cy="16" r="2.2" fill="#10b981"/></svg> УЛОВ: ${fishName}${trophyMeta ? ` (${trophyMeta})` : ''}\n` +
        `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z" fill="rgba(239,68,68,0.22)" stroke="#ef4444" stroke-width="1.9"/><circle cx="12" cy="11" r="2.3" fill="#ef4444"/></svg> ${spotStr} • Глубина ~${targetCatch?.depth ?? s.depth} м\n` +
        `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 18c0-4 4-4 4-8s4-4 4-6 5-1 5 3-3 5-3 8 4 4 6 2" stroke="#f43f5e" stroke-width="2.2" stroke-linecap="round"/></svg> Приманка: ${baitStr} • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3c0 0-6 7.1-6 11.5a6 6 0 0 0 12 0C18 10.1 12 3 12 3z" fill="rgba(56,189,248,0.32)" stroke="#38bdf8" stroke-width="1.8"/><path d="M9.5 15.5c.5 1.2 1.7 2 3 2" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg> Вода ${waterTemp}°C • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><polygon points="16,8 13.5,13.5 8,16 10.5,10.5" fill="#38bdf8" stroke="currentColor" stroke-width="1.3"/></svg> ${press} мм\n` +
        `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" fill="rgba(56,189,248,0.22)" stroke="currentColor" stroke-width="1.8"/><path d="M4 20c0-3.8 3.6-6.5 8-6.5s8 2.7 8 6.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> Рыбак: ${ident.callsign}` +
        (comment ? `\n<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> ${comment}` : '') +
        `\n<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> Код точки: ${sharePack.token}`;

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
          showToast('Введите ID рыбака (например: FP_89VIP089)', 'warn');
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
      await publishCircleItemToServer(sharePack.packObj, sharePack.token);
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
      showToast(' Карточка улова отправлена в чат!', 'good');
    });

    bodyEl.querySelector('#scSendTelegramDirectBtn')?.addEventListener('click', async () => {
      const { sharePack } = buildCatchChatPayload();
      await importSharePackToken(sharePack.token, true, true);
      await publishCircleItemToServer(sharePack.packObj, sharePack.token);
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
        if (!silent) showToast(` Зашифрованное сообщение Экипажа (${k}) расшифровано и сохранено!`, 'good');
        return decMsg;
      }
    }
  }

  const decoded = decodeSharePack(str);
  if (!decoded) {
    if (!silent) showToast(' Не удалось распознать код пакета «Клёв ПРО: Круг». Проверьте ссылку #p=KP1_...', 'bad');
    return null;
  }

  const now = Date.now();
  if (decoded.t === 'crew' && Number.isFinite(decoded.ea) && decoded.ea < now) {
    if (!silent) showToast(' Срок действия этой точки «Экипажа» (72 часа) уже истёк.', 'warn');
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
  if (isMine && decoded.id) {
    _recentlyPublishedLocalIds.set(decoded.id, now);
    _explicitlyDeletedLocalIds.delete(decoded.id);
  }
  const updated = [{
    ...decoded,
    packToken: str.startsWith(PACK_PREFIX) ? str : (decoded.packToken || ''),
    offlinePending: isMine ? true : false,
    publishedAt: isMine ? now : 0,
    importedAt: isMine ? 0 : now
  }, ...filtered].slice(0, 80);

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
        title: `<svg class="k-ico" style="color:var(--bad);" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9.5" fill="#dc2626" stroke="#fca5a5" stroke-width="1.8"/><text x="12" y="15" text-anchor="middle" fill="#fff" font-size="7.5" font-weight="900" font-family="sans-serif">SOS</text></svg> СИГНАЛ SOS НА ВОДЕ (${decoded.wn || decoded.lb})`,
        body: `Координаты: ${Number(decoded.lat).toFixed(4)}°N, ${Number(decoded.lon).toFixed(4)}°E • От ${decoded.fid || decoded.au}`,
        subTab: 'radar',
        lat: decoded.lat,
        lon: decoded.lon,
        silentToast: !silent
      });
    } else if (decoded.t === 'crew' && canUserAccessCrewItem(decoded, store.getState())) {
      pushAppNotification({
        category: 'crew',
        title: `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg> Новая точка Экипажа (${decoded.crewKey || '72ч'})`,
        body: `${decoded.wn || decoded.lb}: ${decoded.fn} (~${decoded.dp} м) • От ${decoded.fid}`,
        subTab: 'radar',
        lat: decoded.lat,
        lon: decoded.lon,
        silentToast: !silent
      });
    } else if (decoded.t === 'circle' && distKm <= Math.max(120, maxRadius)) {
      pushAppNotification({
        category: 'circle',
        title: `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3.5" fill="rgba(56,189,248,0.25)" stroke="currentColor" stroke-width="1.8"/><path d="M3 19c0-3.2 2.7-5.5 6-5.5s6 2.3 6 5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="17" cy="9" r="2.8" stroke="currentColor" stroke-width="1.6"/><path d="M16 14c2.6.3 4.8 2 5 4.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg> Сводка Круга рядом (${Math.round(distKm)} км)`,
        body: `${decoded.wn || decoded.lb}: ${decoded.fn} на «${decoded.bt || 'по сезону'}» • ${decoded.fid}`,
        subTab: 'radar',
        lat: decoded.lat,
        lon: decoded.lon,
        silentToast: !silent
      });
    } else if (decoded.t === 'workshop') {
      pushAppNotification({
        category: 'workshop',
        title: `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" fill="rgba(56,189,248,0.2)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> Новая оснастка в Мастерской`,
        body: `${decoded.fn}: ${decoded.rw || 'монтаж'} (${decoded.bt || 'приманка'}) • ${decoded.fid}`,
        subTab: 'radar',
        silentToast: !silent
      });
    }
  }

  triggerHaptic('success');
  if (!silent) {
    const typeLabel = decoded.sos
      ? `<svg class="k-ico" style="color:var(--bad);" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9.5" fill="#dc2626" stroke="#fca5a5" stroke-width="1.8"/><text x="12" y="15" text-anchor="middle" fill="#fff" font-size="7.5" font-weight="900" font-family="sans-serif">SOS</text></svg> Сигнал SOS: ${decoded.wn || decoded.lb}`
      : (decoded.t === 'crew'
          ? `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg> Точка Экипажа (${decoded.crewKey || '72ч'}): ${decoded.wn || decoded.lb}`
          : (decoded.t === 'workshop'
              ? `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" fill="rgba(56,189,248,0.2)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> Снасть Мастерской: ${decoded.fn}`
              : `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3.5" fill="rgba(56,189,248,0.25)" stroke="currentColor" stroke-width="1.8"/><path d="M3 19c0-3.2 2.7-5.5 6-5.5s6 2.3 6 5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="17" cy="9" r="2.8" stroke="currentColor" stroke-width="1.6"/><path d="M16 14c2.6.3 4.8 2 5 4.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg> Сводка Круга (±${getEffectiveCircleRadiusKm(decoded, now)} км): ${decoded.fn}`));
    showToast(` Добавлено: ${typeLabel} ( ${decoded.fid})`, 'good');
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
    const expertBadgeNote = expertCount > 0 ? `, из них ${expertCount} от <svg class="k-ico" style="color:#fbbf24;" viewBox="0 0 24 24" fill="none"><path d="M7 4h10v5a5 5 0 0 1-10 0V4z" fill="rgba(251,191,36,0.28)" stroke="#fbbf24" stroke-width="1.8"/><path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3M12 14v4M8 20h8" stroke="#fbbf24" stroke-width="1.8" stroke-linecap="round"/></svg> Экспертов` : '';

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
  if (!requireRegisteredFisherId('публикации точки в Круг / Экипаж / SOS')) return;
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
            <span class="fisher-id-copy-badge" data-copy-fisher-id="${ident.fisherId}" title="Нажмите для автокопирования ID"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> ${ident.fisherId} <svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></span>
          </div>
          ${currentMode === 'sos'
            ? '<svg class="k-ico" style="color:var(--bad);" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9.5" fill="#dc2626" stroke="#fca5a5" stroke-width="1.8"/><text x="12" y="15" text-anchor="middle" fill="#fff" font-size="7.5" font-weight="900" font-family="sans-serif">SOS</text></svg> <b>Экстренный сигнал SOS рассылается ВСЕМ рыбакам:</b> виден публично на карте и в Круге.'
            : (currentMode === 'crew'
                ? `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="8" cy="15" r="4.5" fill="rgba(251,191,36,0.22)" stroke="#fbbf24" stroke-width="1.8"/><path d="M11.5 11.5L20 3m-3 3l2.5 2.5M14.5 8.5L17 11" stroke="#fbbf24" stroke-width="1.8" stroke-linecap="round"/></svg> <b>Закрытый Экипаж (${pack.packObj.crewKey}):</b> точные координаты и чат экипажа увидят ТОЛЬКО участники с ключом (и Админы из базы).`
                : '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2.5l7 3.2v5.8c0 5-3 9.3-7 10.8-4-1.5-7-5.8-7-10.8V5.7l7-3.2z" fill="rgba(56,189,248,0.22)" stroke="#38bdf8" stroke-width="1.8" stroke-linejoin="round"/></svg> <b>Ультракороткая бинарная упаковка V3:</b> вся ссылка занимает ~54 символа (<code>#p=KP1_...</code>) со встроенным ID рыбака и гексагоном ±5/10 км.')}
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:6px;">
          <button type="button" class="btn btn-sm ${currentMode === 'circle' ? 'btn-accent' : ''}" data-share-mode="circle" style="min-height:44px;flex-direction:column;gap:2px;">
            <span><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3.5" fill="rgba(56,189,248,0.25)" stroke="currentColor" stroke-width="1.8"/><path d="M3 19c0-3.2 2.7-5.5 6-5.5s6 2.3 6 5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="17" cy="9" r="2.8" stroke="currentColor" stroke-width="1.6"/><path d="M16 14c2.6.3 4.8 2 5 4.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg> В Круг (±5/10 км)</span>
            <span style="font-size:10px;opacity:0.85;">Гексагон без пина</span>
          </button>
          <button type="button" class="btn btn-sm ${currentMode === 'crew' ? 'btn-accent' : ''}" data-share-mode="crew" style="min-height:44px;flex-direction:column;gap:2px;">
            <span><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg> Экипаж (72 ч)</span>
            <span style="font-size:10px;opacity:0.85;">По ключу ${pack.packObj.crewKey || ''}</span>
          </button>

          <button type="button" class="btn btn-sm ${currentMode === 'sos' ? 'btn-good' : ''}" data-share-mode="sos" style="min-height:44px;flex-direction:column;gap:2px;border-color:var(--bad);color:${currentMode === 'sos' ? '#fff' : 'var(--bad)'};background:${currentMode === 'sos' ? 'var(--bad)' : 'var(--card)'};">
            <span><svg class="k-ico" style="color:var(--bad);" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9.5" fill="#dc2626" stroke="#fca5a5" stroke-width="1.8"/><text x="12" y="15" text-anchor="middle" fill="#fff" font-size="7.5" font-weight="900" font-family="sans-serif">SOS</text></svg> SOS НА ВОДЕ</span>
            <span style="font-size:10px;opacity:0.9;">Всем рыбакам!</span>
          </button>
        </div>

        <div>
          <label for="shareCustomNoteInput" style="display:block;font-size:var(--fs-xs);color:var(--muted);font-weight:700;margin-bottom:4px;">
            <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> КОРОТКИЙ КОММЕНТАРИЙ (ПО ЖЕЛАНИЮ):
          </label>
          <input type="text" id="shareCustomNoteInput" class="input" maxlength="48" value="${customNote}" placeholder="${currentMode === 'sos' ? 'Ситуация: заглох мотор, нужна буксировка, промоина...' : 'Оставьте пустым для минимальной длины ссылки (28 символов)...'}">
        </div>

        <div class="card" style="background:var(--card);padding:10px 12px;border:1px solid ${currentMode === 'sos' ? 'var(--bad)' : 'var(--border)'};font-size:var(--fs-xs);line-height:1.45;color:var(--text);">
          <div style="font-family:monospace;font-size:11.5px;color:var(--accent);font-weight:800;margin-bottom:6px;word-break:break-all;" id="shareShortUrlPreview"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> ${pack.webUrl} (${pack.webUrl.length} симв.)</div>
          <div style="white-space:pre-line;" id="sharePreviewBox">${pack.summaryText}</div>
        </div>

        <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px;margin-bottom:14px;width:100%;box-sizing:border-box;">
          <div style="display:flex;gap:8px;width:100%;">
            <button type="button" class="btn ${currentMode === 'sos' ? 'btn-good' : 'btn-accent'}" id="shareSendTelegramBtn" style="flex:1;min-height:42px;${currentMode === 'sos' ? 'background:var(--bad);border-color:var(--bad);' : ''}">
              <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" fill="rgba(56,189,248,0.22)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> В Telegram
            </button>
            <button type="button" class="btn btn-good" id="shareCopyOrNativeBtn" style="flex:1;min-height:42px;">
              <svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> Скопировать
            </button>
          </div>
          <button type="button" class="btn btn-primary" id="shareSaveLocalCircleBtn" style="width:100%;min-height:44px;font-weight:800;border:1.5px solid var(--accent);background:var(--panel);">
            <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg> Опубликовать в Круге
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
        if (urlBox) urlBox.innerHTML = `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> ${updatedPack.webUrl} (${updatedPack.webUrl.length} симв.)`;
      });
    }

    const publishToRelayIfApplicable = async (finalPack) => {
      const s = store.getState();
      const gridBox = `GRID_${Math.round(s.lat)}_${Math.round(s.lon)}`;
      const targetChannel = finalPack.mode === 'sos'
        ? 'SOS_ALL'
        : (finalPack.mode === 'crew' && finalPack.packObj?.crewKey ? `CREW_${finalPack.packObj.crewKey}` : gridBox);
      const [srvOk] = await Promise.all([
        publishCircleItemToServer(finalPack.packObj, finalPack.token),
        pushEncryptedRelayPacket({ channelId: targetChannel, cipherPayload: finalPack.token, kind: 'pack', regionGrid: gridBox })
      ]);
      return srvOk;
    };

    bodyEl.querySelector('#shareSendTelegramBtn')?.addEventListener('click', async () => {
      const finalPack = createSharePackFromContext(currentMode, customNote, overrideCatch);
      saveOwnSharePackLocally(finalPack, false);
      publishToRelayIfApplicable(finalPack).catch(() => {});
      shareToTelegramChat(finalPack.webUrl, finalPack.summaryText);
    });

    bodyEl.querySelector('#shareCopyOrNativeBtn')?.addEventListener('click', async () => {
      const finalPack = createSharePackFromContext(currentMode, customNote, overrideCatch);
      saveOwnSharePackLocally(finalPack, false);
      const publishPromise = publishToRelayIfApplicable(finalPack);
      await shareOrCopyPack({
        title: currentMode === 'sos' ? '<svg class="k-ico" style="color:var(--bad);" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9.5" fill="#dc2626" stroke="#fca5a5" stroke-width="1.8"/><text x="12" y="15" text-anchor="middle" fill="#fff" font-size="7.5" font-weight="900" font-family="sans-serif">SOS</text></svg> SOS НА ВОДЕ • Клёв ПРО' : 'Клёв ПРО: Круг',
        text: finalPack.summaryText,
        url: finalPack.webUrl,
        token: finalPack.token
      });
      await publishPromise;
    });

    bodyEl.querySelector('#shareSaveLocalCircleBtn')?.addEventListener('click', async (ev) => {
      const btnEl = ev.currentTarget;
      if (btnEl) {
        if (btnEl.disabled) return;
        btnEl.disabled = true;
        btnEl.innerHTML = '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l3.5 2" stroke="#38bdf8" stroke-width="1.9" stroke-linecap="round"/></svg> Сохранение в БД...';
      }
      const finalPack = createSharePackFromContext(currentMode, customNote, overrideCatch);
      saveOwnSharePackLocally(finalPack, true);
      await publishToRelayIfApplicable(finalPack);
      closeModal();
    });
  }

  openModal('<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3.5" fill="rgba(56,189,248,0.25)" stroke="currentColor" stroke-width="1.8"/><path d="M3 19c0-3.2 2.7-5.5 6-5.5s6 2.3 6 5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="17" cy="9" r="2.8" stroke="currentColor" stroke-width="1.6"/><path d="M16 14c2.6.3 4.8 2 5 4.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg> Поделиться в «Круг / Экипаж / SOS»', '<div id="shareModalMount"></div>', (bodyEl) => {
    renderModalContent(bodyEl);
  });
}

export function openImportPackModal() {
  const s = store.getState();
  const ident = getCurrentFisherIdentity(s);
  const html = `
    <div style="display:flex;flex-direction:column;gap:12px;font-size:var(--fs-sm);">
      <div style="padding:10px 12px;background:var(--card);border:1px solid var(--border);border-radius:var(--r-sm);">
        <div style="font-weight:800;font-size:var(--fs-xs);color:var(--accent);margin-bottom:6px;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="8" cy="15" r="4.5" fill="rgba(251,191,36,0.22)" stroke="#fbbf24" stroke-width="1.8"/><path d="M11.5 11.5L20 3m-3 3l2.5 2.5M14.5 8.5L17 11" stroke="#fbbf24" stroke-width="1.8" stroke-linecap="round"/></svg> БЫСТРЫЙ ВВОД КЛЮЧА ЗАКРЫТОГО ЭКИПАЖА (формат KP-XXXX):</div>
        <div style="display:flex;gap:6px;">
          <input type="text" id="unlockCrewKeyInput" class="input" placeholder="Например: KP-7A3F" style="flex:1;text-transform:uppercase;font-weight:800;">
          <button type="button" class="btn btn-sm btn-accent" id="unlockCrewKeyConfirmBtn"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="5" y="11" width="14" height="10" rx="2.5" stroke="currentColor" stroke-width="1.8"/><path d="M8 11V7a4 4 0 0 1 7.5-1.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> Открыть экипаж</button>
        </div>
        <div style="font-size:11px;color:var(--muted);margin-top:4px;">
          Открытые ключи экипажей: <b>${ident.unlockedCrewKeys.length ? ident.unlockedCrewKeys.join(', ') : 'пока нет'}</b>
        </div>
      </div>

      <div>
        <label style="display:block;font-weight:800;font-size:var(--fs-xs);color:var(--muted);margin-bottom:4px;">
          <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg> ИЛИ ВСТАВЬТЕ ССЫЛКУ <code>#p=KP1_...</code> / ЗАШИФРОВАННОЕ СООБЩЕНИЕ <code>KPE2E_...</code>:
        </label>
        <textarea id="importPackTextarea" class="input" rows="3" placeholder="Вставьте короткую ссылку https://klevpro.ru/#p=KP1_... или код..." style="min-height:80px;font-family:monospace;font-size:12px;"></textarea>
      </div>
      <div style="display:flex;gap:8px;">
        <button type="button" class="btn btn-good" id="importPackConfirmBtn" style="width:100%;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg> Расшифровать и добавить в навигатор</button>
      </div>
    </div>
  `;

  openModal('<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="8" cy="15" r="4.5" fill="rgba(251,191,36,0.22)" stroke="#fbbf24" stroke-width="1.8"/><path d="M11.5 11.5L20 3m-3 3l2.5 2.5M14.5 8.5L17 11" stroke="#fbbf24" stroke-width="1.8" stroke-linecap="round"/></svg> Ключ Экипажа и приём пакета KP1', html, (bodyEl) => {
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
        showToast(` Ключ экипажа ${formatted} активирован! Точка и чат экипажа теперь открыты.`, 'good');
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
          <div style="font-weight:800;font-size:var(--fs-xs);color:var(--accent);"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9z" fill="rgba(251,191,36,0.24)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> КАТЕГОРИИ ОПОВЕЩЕНИЙ (РАЗДЕЛЬНАЯ НАСТРОЙКА):</div>

          <label style="display:flex;justify-content:space-between;align-items:center;gap:8px;cursor:pointer;">
            <span style="min-width:0;line-height:1.3;"><svg class="k-ico" style="color:var(--bad);" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9.5" fill="#dc2626" stroke="#fca5a5" stroke-width="1.8"/><text x="12" y="15" text-anchor="middle" fill="#fff" font-size="7.5" font-weight="900" font-family="sans-serif">SOS</text></svg> <b>Сигналы SOS на воде</b> (экстренно всем рыбакам в регионе)</span>
            <input type="checkbox" data-notif-toggle="sos" ${prefs.sos !== false ? 'checked' : ''} style="flex-shrink:0;">
          </label>

          <label style="display:flex;justify-content:space-between;align-items:center;gap:8px;cursor:pointer;">
            <span style="min-width:0;line-height:1.3;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg> <b>Экипаж и сообщения чата Экипажа</b> (по вашим ключам)</span>
            <input type="checkbox" data-notif-toggle="crew" ${prefs.crew !== false ? 'checked' : ''} style="flex-shrink:0;">
          </label>

          <label style="display:flex;justify-content:space-between;align-items:center;gap:8px;cursor:pointer;">
            <span style="min-width:0;line-height:1.3;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3.5" fill="rgba(56,189,248,0.25)" stroke="currentColor" stroke-width="1.8"/><path d="M3 19c0-3.2 2.7-5.5 6-5.5s6 2.3 6 5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="17" cy="9" r="2.8" stroke="currentColor" stroke-width="1.6"/><path d="M16 14c2.6.3 4.8 2 5 4.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg> <b>Сводки Круга на карте рядом</b> (в радиусе 50 / 120 км)</span>
            <input type="checkbox" data-notif-toggle="circle" ${prefs.circle !== false ? 'checked' : ''} style="flex-shrink:0;">
          </label>

          <label style="display:flex;justify-content:space-between;align-items:center;gap:8px;cursor:pointer;">
            <span style="min-width:0;line-height:1.3;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" fill="rgba(56,189,248,0.2)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> <b>Новые оснастки в Мастерской снастей</b></span>
            <input type="checkbox" data-notif-toggle="workshop" ${prefs.workshop !== false ? 'checked' : ''} style="flex-shrink:0;">
          </label>

          <label style="display:flex;justify-content:space-between;align-items:center;gap:8px;cursor:pointer;">
            <span style="min-width:0;line-height:1.3;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> <b>Личные сообщения в чатах рыбаков</b> (1-на-1 по ID)</span>
            <input type="checkbox" data-notif-toggle="dm" ${prefs.dm !== false ? 'checked' : ''} style="flex-shrink:0;">
          </label>

          <label style="display:flex;justify-content:space-between;align-items:center;gap:8px;cursor:pointer;padding-top:6px;border-top:1px dashed var(--border);">
            <span style="min-width:0;line-height:1.3;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19" fill="rgba(56,189,248,0.24)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/></svg> <b>Звуковой сигнал сонара и вибрация</b></span>
            <input type="checkbox" data-notif-toggle="sound" ${prefs.sound !== false ? 'checked' : ''} style="flex-shrink:0;">
          </label>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="font-weight:800;font-size:var(--fs-xs);color:var(--muted);"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> ПОСЛЕДНИЕ СОБЫТИЯ И СИГНАЛЫ (${notifs.length}):</span>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button type="button" class="btn btn-sm" id="notifRequestOsPushBtn"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="6" y="2" width="12" height="20" rx="2.5" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="18" r="1.2" fill="#38bdf8"/></svg> Системные Push</button>
            <button type="button" class="btn btn-sm" id="notifClearAllBtn"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Очистить</button>
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
    bodyEl.querySelectorAll('[data-cloud-open-url]').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetUrl = btn.getAttribute('data-cloud-open-url');
        if (targetUrl) window.open(targetUrl, '_blank', 'noopener');
      });
    });

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
      await requestSystemNotificationsAccess();
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

  openModal('<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9z" fill="rgba(251,191,36,0.24)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> Уведомления (SOS, Экипаж, Круг, Чаты)', '<div id="notifModalMount"></div>', (bodyEl) => {
    renderNotifBody(bodyEl);
  }, true, { onBack: backFn });
}

/**
 * Подменю Зоны 1: « Логин, Пароль, Мой ID, Супер-Админ и Бэкап»
 * - Сквозной вход по Логину и Паролю на ВСЕХ устройствах (APK, Браузер, Telegram Mini App)
 * - Постоянная привязка аккаунта Владельца (iAthor -> ID FP_89VIP089 + Супер-Админ)
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
  // Фоновый опрос статуса привязки Telegram при каждом открытии окна
  try { checkServerTelegramBindStatus(true); } catch (e) {}

  function renderAuthBody(bodyEl) {
    if (!bodyEl) return;
    const s = store.getState();
    const ident = getCurrentFisherIdentity(s);
    const tgUser = getTelegramUser();
    const ownerMode = ident.isOwner;
    const savedLogin = ident.isRegistered ? (ident.login || ident.callsign) : '';

    bodyEl.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:12px;font-size:var(--fs-sm);">
        ${renderSettingsZoneTabsHtml('auth')}

        <!-- Статус текущего ID (Временный резерв FP_XXRZYYYY vs Постоянный FP_XXAAA001 vs Владелец FP_89VIP089 / FP_FMP089) -->
        <div style="padding:11px 12px;background:${ident.isOwner ? 'rgba(16,185,129,0.12)' : (ident.isRegistered ? 'rgba(56,189,248,0.10)' : 'rgba(245,158,11,0.12)')};border:1.5px solid ${ident.isOwner ? 'var(--good)' : (ident.isRegistered ? 'var(--accent)' : 'var(--warn)')};border-radius:var(--r-sm);font-size:var(--fs-xs);line-height:1.45;">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:6px;">
            <span style="font-weight:900;color:${ident.isOwner ? 'var(--good)' : (ident.isRegistered ? 'var(--accent)' : 'var(--warn)')};">
              ${ident.isOwner
                ? '<svg class="k-ico" style="color:#fbbf24;" viewBox="0 0 24 24" fill="none"><path d="M3 18h18l-2-11-5 4-2-6-2 6-5-4-2 11z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> ЭКСКЛЮЗИВНЫЙ ID СУПЕР-АДМИНА (ВЛАДЕЛЕЦ):'
                : (ident.isRegistered
                    ? '<svg class="k-ico" style="color:var(--good);" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="currentColor" stroke="rgba(255,255,255,0.65)" stroke-width="1.4"/></svg> ВАШ ПОСТОЯННЫЙ ЗАКРЕПЛЁННЫЙ ID РЫБАКА:'
                    : '<svg class="k-ico" style="color:var(--warn);" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="currentColor" stroke="rgba(255,255,255,0.65)" stroke-width="1.4"/></svg> ВРЕМЕННЫЙ РЕЗЕРВНЫЙ ID (БЕЗ РЕГИСТРАЦИИ):')}
            </span>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <button type="button" class="btn btn-sm ${ident.isRegistered ? 'btn-good' : ''}" data-copy-fisher-id="${ident.fisherId}" style="font-family:monospace;font-size:13px;font-weight:900;padding:4px 10px;">
                <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> ${ident.fisherId} <svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
              </button>
              ${ident.isOwner ? `
                <button type="button" class="btn btn-sm btn-accent" data-copy-fisher-id="${ident.fisherId === OWNER_BOUND_FISHER_ID ? OWNER_SECONDARY_FISHER_ID : OWNER_BOUND_FISHER_ID}" style="font-family:monospace;font-size:12px;font-weight:900;padding:4px 8px;">
                  <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> ${ident.fisherId === OWNER_BOUND_FISHER_ID ? OWNER_SECONDARY_FISHER_ID : OWNER_BOUND_FISHER_ID} <svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
                </button>
              ` : ''}
            </div>
          </div>
          <div>
            ${ident.isOwner
              ? `За вашим аккаунтом <b>${savedLogin}</b> навечно закреплены оба неприкосновенных ID Владельца: <b>FP_89VIP089</b> и <b>FP_FMP089</b>. Никто другой не может их получить.`
              : (ident.isRegistered
                  ? `Ваш постоянный ID <b>${ident.fisherId}</b> выдан один раз и навсегда жёстко привязан только к вашему логину (<b>${escapeHtml(savedLogin)}</b>) и паролю. Входите с Android, iOS, планшета или ПК — везде будет этот же ID и ваши данные!`
                  : `Сейчас вам выдан временный резервный ID <b>${ident.fisherId}</b> (шаблон <code>FP_XXRZYYYY</code>). С временным ID можно смотреть прогноз и карту, но <b>отправка точек в Круг, Экипаж, SOS и Чаты заблокирована</b>. Зарегистрируйте логин и пароль ниже, чтобы получить постоянный ID навсегда!`)}
          </div>
          ${ident.isOwner ? `
            <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
              <button type="button" class="btn btn-sm btn-good" id="authOpenSuperAdminTabBtn" style="width:100%;font-weight:900;">
                <svg class="k-ico" style="color:#fbbf24;" viewBox="0 0 24 24" fill="none"><path d="M3 18h18l-2-11-5 4-2-6-2 6-5-4-2 11z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> Открыть вкладку «Супер-Админ и Статистика БД»
              </button>
            </div>
          ` : ''}
        </div>

        <!-- Форма регистрации / входа по Логину (или постоянному ID) и Паролю -->
        <div class="card" style="background:var(--card);padding:12px;border:1.5px solid var(--accent);display:flex;flex-direction:column;gap:9px;">
          <div style="font-weight:800;font-size:var(--fs-xs);color:var(--accent);">
            ${ident.isRegistered
              ? `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="8" cy="15" r="4.5" fill="rgba(251,191,36,0.22)" stroke="#fbbf24" stroke-width="1.8"/><path d="M11.5 11.5L20 3m-3 3l2.5 2.5M14.5 8.5L17 11" stroke="#fbbf24" stroke-width="1.8" stroke-linecap="round"/></svg> ВАШ ПРОФИЛЬ АВТОРИЗОВАН (${escapeHtml(savedLogin)} • ${ident.fisherId})`
              : '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="8" cy="15" r="4.5" fill="rgba(251,191,36,0.22)" stroke="#fbbf24" stroke-width="1.8"/><path d="M11.5 11.5L20 3m-3 3l2.5 2.5M14.5 8.5L17 11" stroke="#fbbf24" stroke-width="1.8" stroke-linecap="round"/></svg> РЕГИСТРАЦИЯ ИЛИ ВХОД (ПОЛУЧЕНИЕ ПОСТОЯННОГО ID НАВСЕГДА)'}
          </div>
          <div style="font-size:11.5px;color:var(--muted);line-height:1.38;">
            Постоянный ID не привязывается к железу телефона — он жёстко привязан <b>только к вашему логину и паролю</b>. Вы можете входить на любых телефонах (Android / iOS), планшетах, компьютерах и в Telegram Mini App.
          </div>

          <div>
            <label style="display:block;font-size:var(--fs-xs);color:var(--muted);font-weight:700;margin-bottom:3px;">ЛОГИН РЫБАКА (ИЛИ ВАШ ПОСТОЯННЫЙ ID ДЛЯ ВХОДА):</label>
            <input type="text" id="authCallsignInput" class="input" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" value="${escapeHtml(savedLogin)}" placeholder="Придумайте логин (или введите свой для входа)">
            <div id="authLoginAvailabilityHint" style="font-size:11px;margin-top:3px;color:var(--muted);">
              <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2.5l7 3.2v5.8c0 5-3 9.3-7 10.8-4-1.5-7-5.8-7-10.8V5.7l7-3.2z" fill="rgba(56,189,248,0.22)" stroke="#38bdf8" stroke-width="1.8" stroke-linejoin="round"/></svg> При новой регистрации вам навсегда выдаётся персональный региональный ID (например, <code>FP_${resolveRussianRegionCode(s)}AAA001</code>).
            </div>
          </div>

          <div>
            <label style="display:block;font-size:var(--fs-xs);color:var(--muted);font-weight:700;margin-bottom:3px;">ПАРОЛЬ (ОТ 3 СИМВОЛОВ):</label>
            <div style="display:flex;gap:6px;align-items:center;width:100%;">
              <input type="password" id="authPinInput" class="input" autocomplete="current-password" placeholder="${ident.isRegistered ? '•••••••• (пароль для синхронизации)' : 'Введите пароль (от 3 симв.)...'}" style="flex:1;min-width:0;font-size:13.5px;">
              <button type="button" class="btn btn-sm" id="authTogglePassVisBtn" title="Показать / скрыть пароль" style="min-height:40px;width:42px;min-width:42px;padding:0;flex-shrink:0;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/></svg></button>
            </div>
          </div>

          ${!ident.isRegistered ? `
            <div style="padding:9px 10px;background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.32);border-radius:var(--r-sm);display:flex;flex-direction:column;gap:6px;">
              <div style="font-size:11.5px;font-weight:800;color:var(--accent);">
                <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z" fill="rgba(239,68,68,0.22)" stroke="#ef4444" stroke-width="1.9"/><circle cx="12" cy="11" r="2.3" fill="#ef4444"/></svg> РЕГИОНАЛЬНАЯ ГРУППА ИЛИ ТОЧКА НА КАРТЕ (НЕОБЯЗАТЕЛЬНО):
              </div>
              <div style="font-size:11px;color:var(--muted);line-height:1.36;">
                При регистрации вы можете указать свой регион из списка ниже или выбрать точку на карте для формирования кода региона в вашем постоянном ID (<code>FP_XXAAA001</code>). Параметр <b>необязательный</b> — если не указывать, перед сохранением мы уточним вашу текущую региональную группу: <b>[${resolveRussianRegionCode(s)} — ${getRegionNameByCode(resolveRussianRegionCode(s))}]</b> (${escapeHtml(s.locLabel || 'Новый Уренгой')}).
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
                <select id="authOptionalRegionSelect" class="input" style="flex:1;min-width:190px;font-size:12.5px;">
                  <option value=""> Не выбрано — текущая точка: [${resolveRussianRegionCode(s)}] ${getRegionNameByCode(resolveRussianRegionCode(s))} (${escapeHtml(s.locLabel || 'Новый Уренгой')})</option>
                  ${RUSSIA_REGIONS_DIRECTORY.map(r => `<option value="${r.code}">[${r.code}] ${r.name}</option>`).join('')}
                </select>
                <button type="button" class="btn btn-sm" id="authPickMapPointBtn" style="white-space:nowrap;font-weight:700;">
                  <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6z" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 3v15M15 6v15" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="10" r="2.2" fill="#38bdf8" stroke="#fff" stroke-width="1"/></svg> Точка на карте
                </button>
              </div>
            </div>
          ` : ''}

          <div style="display:flex;flex-direction:column;gap:8px;width:100%;">
            <button type="button" class="btn btn-accent" id="authSaveBtn" style="width:100%;min-height:42px;padding:8px 12px;font-size:13.5px;font-weight:800;line-height:1.25;white-space:normal;text-align:center;">
              ${ident.isRegistered
                ? `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M20 11a8 8 0 0 0-14.5-4.5L4 8m0-5v5h5M4 13a8 8 0 0 0 14.5 4.5L20 16m0 5v-5h-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Синхронизировать (${ident.fisherId})`
                : '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="8" cy="15" r="4.5" fill="rgba(251,191,36,0.22)" stroke="#fbbf24" stroke-width="1.8"/><path d="M11.5 11.5L20 3m-3 3l2.5 2.5M14.5 8.5L17 11" stroke="#fbbf24" stroke-width="1.8" stroke-linecap="round"/></svg> Войти / Зарегистрировать ID'}
            </button>
            ${ident.isRegistered ? `
              <button type="button" class="btn btn-sm" id="authLogoutBtn" style="width:100%;min-height:38px;color:var(--bad);border-color:rgba(239,68,68,0.4);font-weight:800;">
                <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> Выйти
              </button>
            ` : ''}
          </div>

          <!-- Привязка постоянного ID к Telegram -->
          <div style="margin-top:2px;padding:9px 10px;background:var(--panel);border:1px solid var(--border);border-radius:var(--r-sm);display:flex;flex-direction:column;gap:6px;">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
              <span style="font-weight:800;font-size:11.5px;color:var(--accent);"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" fill="rgba(56,189,248,0.22)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> СВЯЗКА ПОСТОЯННОГО ID С TELEGRAM:</span>
              <div style="display:flex;align-items:center;gap:4px;">
                ${ident.isRegistered && (ident.tgLinkedId || tgUser?.id || (ident.isOwner && ident.tgUsername))
                  ? `<span class="pill pill-good" style="font-size:10.5px;"><svg class="k-ico" style="color:var(--good);" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="currentColor" stroke="rgba(255,255,255,0.65)" stroke-width="1.4"/></svg> Связан: ${(ident.tgUsername || tgUser?.username || (ident.isOwner ? 'thorantony82' : '')) ? '@' + (ident.tgUsername || tgUser?.username || 'thorantony82') : 'ID ' + (ident.tgLinkedId || tgUser?.id)}</span>`
                  : `<span class="pill" style="font-size:10.5px;"><svg class="k-ico" style="color:var(--muted);" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="currentColor" stroke="rgba(255,255,255,0.65)" stroke-width="1.4"/></svg> Не привязан</span>`}
                <button type="button" class="btn btn-sm" id="authCheckTgBindBtn" style="padding:2px 7px;font-size:10.5px;min-height:24px;" title="Проверить статус привязки в боте @KlevProClubBot"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M20 11a8 8 0 0 0-14.5-4.5L4 8m0-5v5h5M4 13a8 8 0 0 0 14.5 4.5L20 16m0 5v-5h-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Проверить</button>
              </div>
            </div>
            <div style="font-size:11px;color:var(--muted);line-height:1.35;">
              ${ident.isRegistered
                ? `При желании использовать сервисы Telegram (бот @KlevProClubBot, мини-приложение, отправка точек Экипажа, Круга и SOS в группы и чаты ТГ) свяжите ваш постоянный ID <b>${ident.fisherId}</b> с Telegram:`
                : `Сначала зарегистрируйте логин и пароль выше, чтобы получить постоянный ID рыбака, после чего вы сможете привязать его к Telegram.`}
            </div>
            <button type="button" class="btn btn-sm ${ident.isRegistered ? 'btn-accent' : ''}" id="authBindTelegramBtn" style="width:100%;white-space:normal;line-height:1.35;padding:8px 10px;text-align:center;">
              ${ident.isRegistered && (ident.tgLinkedId || tgUser?.id || (ident.isOwner && ident.tgUsername))
                ? `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="4" y="8" width="16" height="12" rx="3" fill="rgba(56,189,248,0.2)" stroke="currentColor" stroke-width="1.8"/><path d="M12 3v5M9 3h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="9" cy="14" r="1.5" fill="#38bdf8"/><circle cx="15" cy="14" r="1.5" fill="#38bdf8"/></svg> Открыть @KlevProClubBot (единый ID ${ident.fisherId})`
                : `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" fill="rgba(56,189,248,0.22)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> Связать постоянный ID с Telegram (@KlevProClubBot)`}
            </button>
          </div>
        </div>

        <!-- Пользовательское соглашение и Правила безопасности -->
        <div class="card" style="background:var(--card);padding:10px 12px;border:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <div style="min-width:0;flex:1;">
            <div style="font-size:var(--fs-xs);font-weight:800;color:var(--accent);"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" fill="rgba(56,189,248,0.14)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14 2v6h6M8 13h8M8 17h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> Пользовательское соглашение «Клёв ПРО 2.0»</div>
            <div style="font-size:11px;color:var(--muted);">Правила сообщества, безопасность на водоёмах и льду, защита данных</div>
          </div>
          <button type="button" class="btn btn-sm" id="authOpenUserAgreementBtn"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" fill="rgba(56,189,248,0.14)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14 2v6h6M8 13h8M8 17h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> Прочитать</button>
        </div>

        <!-- Резервное копирование файла профиля -->
        <div class="card" style="background:var(--card);padding:10px 12px;border:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <span style="font-size:var(--fs-xs);font-weight:700;color:var(--muted);"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" fill="rgba(16,185,129,0.2)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M17 21v-8H7v8M7 3v5h8" stroke="currentColor" stroke-width="1.7"/></svg> Локальная резервная копия (.JSON):</span>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button type="button" class="btn btn-sm" id="backupExportBtn"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 15V3m0 0L8 7m4-4l4 4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg> Скачать бэкап</button>
            <label class="btn btn-sm" style="cursor:pointer;margin:0;">
              <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg> Восстановить
              <input type="file" id="backupImportFileInput" accept=".json,application/json" style="display:none;">
            </label>
          </div>
        </div>
      </div>
    `;

    bindSettingsZoneTabs(bodyEl);

    bodyEl.querySelector('#authOpenSuperAdminTabBtn')?.addEventListener('click', () => {
      closeModal();
      router.navigate('admin');
      renderAdminSection();
    });

    const loginInp = bodyEl.querySelector('#authCallsignInput');
    const loginHint = bodyEl.querySelector('#authLoginAvailabilityHint');
    let loginCheckTimer = null;
    if (loginInp && loginHint) {
      loginInp.addEventListener('input', () => {
        clearTimeout(loginCheckTimer);
        const val = (loginInp.value || '').trim();
        if (val.length < 2) {
          loginHint.style.color = 'var(--muted)';
          loginHint.innerHTML = '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2.5l7 3.2v5.8c0 5-3 9.3-7 10.8-4-1.5-7-5.8-7-10.8V5.7l7-3.2z" fill="rgba(56,189,248,0.22)" stroke="#38bdf8" stroke-width="1.8" stroke-linejoin="round"/></svg> Введите рыболовный позывной (от 2 символов, без телефона и e-mail) или ваш постоянный ID.';
          return;
        }
        const anonChk = isAnonymousCallsignValid(val);
        if (!anonChk.ok) {
          loginHint.style.color = 'var(--bad)';
          loginHint.innerHTML = `<svg class="k-ico" style="color:var(--bad);" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" fill="rgba(239,68,68,0.22)" stroke="#ef4444" stroke-width="1.9"/><path d="M6 6l12 12" stroke="#ef4444" stroke-width="2.1" stroke-linecap="round"/></svg> ${anonChk.error}`;
          return;
        }
        loginCheckTimer = setTimeout(async () => {
          try {
            const devId = storage.getDeviceId ? storage.getDeviceId() : '';
            const r = await workerFetch(`/auth/check-login?login=${encodeURIComponent(val)}&deviceId=${encodeURIComponent(devId)}`, { method: 'GET' }, 3500, 0);
            if (!r.ok) return;
            const d = await r.json();
            if (d.isOwnerLogin) {
              loginHint.style.color = 'var(--good)';
              loginHint.innerHTML = '<svg class="k-ico" style="color:#fbbf24;" viewBox="0 0 24 24" fill="none"><path d="M3 18h18l-2-11-5 4-2-6-2 6-5-4-2 11z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> Эксклюзивный логин Владельца (FP_89VIP089 & FP_FMP089) — введите мастер-пароль для входа.';
            } else if (d.available) {
              loginHint.style.color = 'var(--good)';
              loginHint.innerHTML = `<svg class="k-ico" style="color:var(--good);" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="currentColor" stroke="rgba(255,255,255,0.65)" stroke-width="1.4"/></svg> Логин «${val}» свободен! Придумайте пароль, чтобы получить постоянный ID рыбака навсегда.`;
            } else {
              loginHint.style.color = 'var(--accent)';
              loginHint.innerHTML = `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="8" cy="15" r="4.5" fill="rgba(251,191,36,0.22)" stroke="#fbbf24" stroke-width="1.8"/><path d="M11.5 11.5L20 3m-3 3l2.5 2.5M14.5 8.5L17 11" stroke="#fbbf24" stroke-width="1.8" stroke-linecap="round"/></svg> Логин «${val}» уже зарегистрирован. Если это ваш профиль — введите ваш пароль для входа и восстановления вашего ID.`;
            }
          } catch (e) {}
        }, 300);
      });
    }

    const passInp = bodyEl.querySelector('#authPinInput');
    const toggleVisBtn = bodyEl.querySelector('#authTogglePassVisBtn');
    if (passInp && toggleVisBtn) {
      toggleVisBtn.addEventListener('click', () => {
        const isPass = passInp.type === 'password';
        passInp.type = isPass ? 'text' : 'password';
        toggleVisBtn.innerHTML = isPass ? '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-6.4 0-10-7-10-7a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c6.4 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' : '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/></svg>';
      });
    }

    bodyEl.querySelector('#authCheckTgBindBtn')?.addEventListener('click', async () => {
      const btn = bodyEl.querySelector('#authCheckTgBindBtn');
      if (btn) btn.innerHTML = '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l3.5 2" stroke="#38bdf8" stroke-width="1.9" stroke-linecap="round"/></svg>...';
      const st = await checkServerTelegramBindStatus(false);
      if (st && st.bound) {
        showToast(` Telegram успешно связан (@${st.tgUsername || 'KlevProClubBot'})!`, 'good');
      } else {
        showToast('Пока не привязан. Нажмите «Связать с Telegram» ниже и нажмите Start в боте!', 'info');
      }
      renderAuthBody(bodyEl);
    });

    bodyEl.querySelector('#authBindTelegramBtn')?.addEventListener('click', async () => {
      const curIdent = getCurrentFisherIdentity(store.getState());
      if (!curIdent.isRegistered || curIdent.isTemporaryReserve) {
        showToast(' Сначала зарегистрируйте логин и пароль выше, чтобы получить постоянный ID, а затем свяжите его с Telegram!', 'warn');
        return;
      }
      await syncCurrentProfileToCloudIfLoggedIn();
      openBotChatInTelegram(curIdent.fisherId);
    });

    bodyEl.querySelector('#authLogoutBtn')?.addEventListener('click', () => {
      const tempFid = logoutCurrentFisherAccount();
      showToast(` Вы вышли из профиля. Назначен временный резервный ID ${tempFid}`, 'info');
      renderAuthBody(bodyEl);
    });

    bodyEl.querySelector('#authOpenUserAgreementBtn')?.addEventListener('click', () => {
      openUserAgreementModal({ requireVerification: false });
    });

    bodyEl.querySelector('#authPickMapPointBtn')?.addEventListener('click', () => {
      _explicitMapPointChosenForReg = true;
      closeModal();
      router.navigate('geo');
      showToast(' Выберите свою точку или водоём на карте, затем откройте «Вход и ID» для завершения регистрации', 'info');
    });

    const executeAuthLoginOrRegister = async (rawLogin, rawPin, chosenRegOverride = '') => {
      const saveBtn = bodyEl.querySelector('#authSaveBtn');
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l3.5 2" stroke="#38bdf8" stroke-width="1.9" stroke-linecap="round"/></svg> Синхронизация с сервером...';
      }

      const res = await authenticateAndSyncAccount(rawLogin, rawPin, 'login', chosenRegOverride);
      if (!res.ok) {
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.innerHTML = '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="8" cy="15" r="4.5" fill="rgba(251,191,36,0.22)" stroke="#fbbf24" stroke-width="1.8"/><path d="M11.5 11.5L20 3m-3 3l2.5 2.5M14.5 8.5L17 11" stroke="#fbbf24" stroke-width="1.8" stroke-linecap="round"/></svg> Войти / Зарегистрировать ID';
        }
        showToast(` ${res.error || 'Ошибка входа'}`, 'bad');
        return;
      }

      _explicitMapPointChosenForReg = false;
      await copyFisherIdToClipboard(res.fisherId, res.isOwner ? 'Ваш ID Владельца' : 'Ваш постоянный ID рыбака');
      if (res.isOwner) {
        showToast(` Добро пожаловать, ${res.login}! Активированы ваши эксклюзивные ID (FP_89VIP089 & FP_FMP089) и вкладка «<svg class="k-ico" style="color:#fbbf24;" viewBox="0 0 24 24" fill="none"><path d="M3 18h18l-2-11-5 4-2-6-2 6-5-4-2 11z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> Админ»!`, 'good');
      } else {
        showToast(` Постоянный ID ${res.fisherId} закреплён за логином «${res.login}» на всех устройствах!`, 'good');
      }
      renderAuthBody(bodyEl);
    };

    const proceedWithAgreementAndAuth = async (rawLogin, rawPin, chosenRegOverride = '') => {
      const isOwnerTry = isLoginOwnerMatch(rawLogin) || isOwnerFisherId(rawLogin);
      if (!ident.isRegistered && !isOwnerTry && !isUserAgreementAccepted()) {
        openUserAgreementModal({
          requireVerification: true,
          onAccepted: () => {
            openModal('<svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="5" y="11" width="14" height="10" rx="2.5" fill="rgba(251,191,36,0.22)" stroke="#fbbf24" stroke-width="1.8"/><path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> Регистрация, Вход и Постоянный ID', '<div id="authModalMount"></div>', (bEl) => {
              renderAuthBody(bEl);
              executeAuthLoginOrRegister(rawLogin, rawPin, chosenRegOverride);
            }, true, { onBack: backFn });
          }
        });
        return;
      }
      await executeAuthLoginOrRegister(rawLogin, rawPin, chosenRegOverride);
    };

    bodyEl.querySelector('#authSaveBtn')?.addEventListener('click', async () => {
      const rawLogin = (bodyEl.querySelector('#authCallsignInput')?.value || '').trim();
      const rawPin = (bodyEl.querySelector('#authPinInput')?.value || '').trim();
      const chosenRegionCode = (bodyEl.querySelector('#authOptionalRegionSelect')?.value || '').trim();
      const prevUp = store.getState().userProfile || {};

      if (!rawPin && ident.isRegistered && (prevUp.pinHash || prevUp.authTokenHash || ident.isOwner)) {
        await syncCurrentProfileToCloudIfLoggedIn();
        await copyFisherIdToClipboard(ident.fisherId, ident.isOwner ? 'Ваш ID Владельца' : 'Ваш постоянный ID рыбака');
        showToast(` Профиль ${ident.fisherId} синхронизирован`, 'good');
        renderAuthBody(bodyEl);
        return;
      }

      if (!rawLogin || rawPin.length < 3) {
        showToast('Введите логин и пароль (минимум 3 символа)', 'warn');
        return;
      }
      const isOwnerTryPre = isLoginOwnerMatch(rawLogin) || isOwnerFisherId(rawLogin);
      if (!isOwnerTryPre) {
        const anonSaveChk = isAnonymousCallsignValid(rawLogin);
        if (!anonSaveChk.ok) {
          showToast(` ${anonSaveChk.error}`, 'bad');
          return;
        }
      }

      // Если рыбак регистрирует НОВЫЙ аккаунт и НЕ выбрал явно регион из списка и НЕ указал точку на карте —
      // перед сохранением нового пользователя в базу запрашиваем подтверждение региональной группы!
      if (!ident.isRegistered && !isOwnerTryPre && !chosenRegionCode && !_explicitMapPointChosenForReg && !/^FP_/i.test(rawLogin)) {
        let isNewAccount = true;
        try {
          const devId = storage.getDeviceId ? storage.getDeviceId() : '';
          const chkRes = await workerFetch(`/auth/check-login?login=${encodeURIComponent(rawLogin)}&deviceId=${encodeURIComponent(devId)}`, { method: 'GET' }, 3200, 0);
          if (chkRes && chkRes.ok) {
            const chkData = await chkRes.json();
            if (chkData && chkData.available === false && !chkData.isMine) {
              isNewAccount = false;
            }
          }
        } catch (e) {}

        if (isNewAccount) {
          const curState = store.getState();
          const autoRegCode = resolveRussianRegionCode(curState);
          const autoRegName = getRegionNameByCode(autoRegCode);
          const curSpotName = curState.locLabel || 'Новый Уренгой';

          const confirmHtml = `
            <div style="display:flex;flex-direction:column;gap:12px;font-size:var(--fs-sm);line-height:1.48;">
              <div style="padding:12px;background:rgba(245,158,11,0.12);border:1.5px solid var(--warn);border-radius:var(--r-sm);">
                <div style="font-weight:900;color:var(--warn);font-size:14px;margin-bottom:6px;">
                  <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z" fill="rgba(239,68,68,0.22)" stroke="#ef4444" stroke-width="1.9"/><circle cx="12" cy="11" r="2.3" fill="#ef4444"/></svg> Подтверждение региональной группы
                </div>
                <div style="color:var(--text);font-size:13.5px;font-weight:700;">
                  Вы уверены, что хотите остаться в этой региональной группе: <span style="color:var(--accent);">[${autoRegCode} — ${escapeHtml(autoRegName)}]</span>?
                </div>
                <div style="font-size:11.5px;color:var(--muted);margin-top:6px;">
                  Текущая точка на карте: <b>${escapeHtml(curSpotName)}</b>. Вы не выбрали регион вручную из списка при регистрации — на основе группы <b>[${autoRegCode}]</b> вам будет присвоен постоянный ID формата <code>FP_${autoRegCode}AAA001</code> и сохранена запись в базе данных.
                </div>
              </div>
              <div style="display:flex;flex-direction:column;gap:8px;">
                <button type="button" class="btn btn-good" id="regConfirmStayBtn" style="width:100%;font-weight:900;min-height:42px;">
                  <svg class="k-ico" style="color:var(--good);" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" fill="rgba(16,185,129,0.24)" stroke="#10b981" stroke-width="1.9"/><path d="M8 12.5l2.7 2.7L16.5 9.5" stroke="#10b981" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg> Да, остаться в группе [${autoRegCode} — ${escapeHtml(autoRegName)}]
                </button>
                <button type="button" class="btn" id="regConfirmChangeBtn" style="width:100%;font-weight:800;min-height:40px;border-color:var(--accent);color:var(--accent);">
                  <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z" fill="rgba(239,68,68,0.22)" stroke="#ef4444" stroke-width="1.9"/><circle cx="12" cy="11" r="2.3" fill="#ef4444"/></svg> Нет, выбрать другой регион из списка или точку на карте
                </button>
              </div>
            </div>
          `;

          openModal('<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z" fill="rgba(239,68,68,0.22)" stroke="#ef4444" stroke-width="1.9"/><circle cx="12" cy="11" r="2.3" fill="#ef4444"/></svg> Подтверждение региональной группы', confirmHtml, (cBody) => {
            cBody.querySelector('#regConfirmStayBtn')?.addEventListener('click', () => {
              openModal('<svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="5" y="11" width="14" height="10" rx="2.5" fill="rgba(251,191,36,0.22)" stroke="#fbbf24" stroke-width="1.8"/><path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> Регистрация, Вход и Постоянный ID', '<div id="authModalMount"></div>', (bEl) => {
                renderAuthBody(bEl);
                const lInp = bEl.querySelector('#authCallsignInput');
                const pInp = bEl.querySelector('#authPinInput');
                if (lInp) lInp.value = rawLogin;
                if (pInp) pInp.value = rawPin;
                proceedWithAgreementAndAuth(rawLogin, rawPin, autoRegCode);
              }, true, { onBack: backFn });
            });
            cBody.querySelector('#regConfirmChangeBtn')?.addEventListener('click', () => {
              openModal('<svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="5" y="11" width="14" height="10" rx="2.5" fill="rgba(251,191,36,0.22)" stroke="#fbbf24" stroke-width="1.8"/><path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> Регистрация, Вход и Постоянный ID', '<div id="authModalMount"></div>', (bEl) => {
                renderAuthBody(bEl);
                const lInp = bEl.querySelector('#authCallsignInput');
                const pInp = bEl.querySelector('#authPinInput');
                const rSel = bEl.querySelector('#authOptionalRegionSelect');
                if (lInp) lInp.value = rawLogin;
                if (pInp) pInp.value = rawPin;
                if (rSel) {
                  rSel.focus();
                  rSel.style.boxShadow = '0 0 0 2px var(--accent)';
                }
                showToast(' Выберите ваш регион в выпадающем списке или нажмите « Точка на карте»', 'info');
              }, true, { onBack: backFn });
            });
          });
          return;
        }
      }

      await proceedWithAgreementAndAuth(rawLogin, rawPin, chosenRegionCode);
    });

    bodyEl.querySelector('#backupExportBtn')?.addEventListener('click', () => {
      const backup = storage.exportFullProfileBackup(store.getState());
      const fname = `klev-pro-profile-${ident.fisherId}-${new Date().toISOString().slice(0, 10)}.json`;
      downloadFileCrossPlatform(fname, JSON.stringify(backup, null, 2), 'application/json;charset=utf-8');
      showToast(` Резервная копия профиля сохранена: ${fname}`, 'good');
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
            if (parsed.userProfile) store.dispatch({ type: 'UPDATE_USER_PROFILE', payload: parsed.userProfile });
            if (Array.isArray(parsed.savedSpots)) store.dispatch({ type: 'SET_SAVED_SPOTS', payload: parsed.savedSpots });
            if (Array.isArray(parsed.catches)) store.dispatch({ type: 'SET_CATCHES', payload: parsed.catches });
            if (Array.isArray(parsed.circleItems)) store.dispatch({ type: 'SET_CIRCLE_ITEMS', payload: parsed.circleItems });
            if (Array.isArray(parsed.chatMessages)) store.dispatch({ type: 'SET_CHAT_MESSAGES', payload: parsed.chatMessages });
            showToast(' Профиль, точки и чаты успешно восстановлены!', 'good');
            closeModal();
          } else {
            showToast(' Неверный формат файла резервной копии', 'bad');
          }
        } catch (err) {
          showToast(' Ошибка чтения файла резервной копии', 'bad');
        }
      });
    }
  }

  openModal('<svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="5" y="11" width="14" height="10" rx="2.5" fill="rgba(251,191,36,0.22)" stroke="#fbbf24" stroke-width="1.8"/><path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> Регистрация, Вход и Постоянный ID', '<div id="authModalMount"></div>', (bodyEl) => {
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
 * Отрисовка выделенной вкладки « Чаты» (Экипажи по ключу + Личные диалоги 1-на-1)
 */
export function formatCleanPeerTitle(peerNameRaw = '', peerIdRaw = '') {
  const name = String(peerNameRaw || '').trim();
  const pid = String(peerIdRaw || '').trim().toUpperCase();
  if (pid === OWNER_BOUND_FISHER_ID || pid === OWNER_SECONDARY_FISHER_ID || /админ|iathor/i.test(name)) {
    return '<svg class="k-ico" style="color:#fbbf24;" viewBox="0 0 24 24" fill="none"><path d="M3 18h18l-2-11-5 4-2-6-2 6-5-4-2 11z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> Админ («Клёв ПРО»)';
  }
  if (!name || name.toUpperCase() === pid || /^FP_[A-Z0-9_]+$/i.test(name) || /^Рыбак\s+FP_/i.test(name)) {
    return 'Рыболов';
  }
  return name;
}

/**
 * Отрисовка выделенной вкладки « Чаты»:
 * - Вертикальный список чатов сверху вниз (вместо горизонтальной карусели)
 * - Открытие каждого чата в отдельном полноэкранном окне
 * - Компактная кнопка « Гео» (поделиться местоположением) внутри окна чата
 * - Корректное удаление всех чатов (включая последний) с подтверждением
 */
export function renderChatsSubView(s, ident, visibleCrews) {
  const allMsgs = Array.isArray(s.chatMessages) ? s.chatMessages : [];
  const deletedSet = new Set(Array.isArray(s.userProfile?.deletedChatChannels) ? s.userProfile.deletedChatChannels : []);

  const crewKeysSet = new Set([
    ...ident.unlockedCrewKeys.map(k => String(k).toUpperCase()),
    ...visibleCrews.map(c => String(c.crewKey || '').toUpperCase()).filter(Boolean)
  ]);

  const crewChannels = [];
  for (const k of crewKeysSet) {
    const chanId = `crew:${k}`;
    const chanMsgs = allMsgs.filter(m => m && m.channelId === chanId);
    if (deletedSet.has(chanId) && chanMsgs.length === 0) continue;
    const matchingCrew = visibleCrews.find(c => String(c.crewKey || '').toUpperCase() === k);
    const lastMsg = chanMsgs.length > 0 ? chanMsgs[chanMsgs.length - 1] : null;
    crewChannels.push({
      channelId: chanId,
      type: 'crew',
      crewKey: k,
      title: k.startsWith('REG-') ? `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" stroke="currentColor" stroke-width="1.6"/></svg> Региональный чат РФ (Регион ${k.replace('REG-', '')})` : `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg> Экипаж ${k}${matchingCrew ? ` • ${matchingCrew.wn || matchingCrew.lb}` : ''}`,
      subtitle: lastMsg ? `${lastMsg.senderName || 'Рыболов'}: ${String(lastMsg.text || '').slice(0, 55)}` : 'Чат участников экипажа по ключу',
      lastTs: lastMsg?.ts || matchingCrew?.ca || 0
    });
  }

  const dmChannelsMap = new Map();
  for (const m of allMsgs) {
    if (!m || !String(m.channelId || '').startsWith('dm:')) continue;
    const rawPeerId = m.senderId === ident.fisherId
      ? (m.peerId || m.channelId.replace(/^dm:/, '').split(':').find(p => p !== ident.fisherId) || OWNER_BOUND_FISHER_ID)
      : (m.senderId || m.peerId || OWNER_BOUND_FISHER_ID);
    const peerId = isOwnerFisherId(rawPeerId) || rawPeerId === 'ADMIN_SUPPORT' ? OWNER_BOUND_FISHER_ID : rawPeerId;
    const canonicalChanId = getCanonicalDmChannelId(ident.fisherId, peerId, allMsgs);
    if (deletedSet.has(canonicalChanId)) continue;

    const rawPeerName = m.senderId === ident.fisherId ? (m.peerName || '') : (m.senderName || m.peerName || '');
    const cleanTitle = formatCleanPeerTitle(rawPeerName, peerId);

    const existingChan = dmChannelsMap.get(canonicalChanId);
    if (!existingChan) {
      dmChannelsMap.set(canonicalChanId, {
        channelId: canonicalChanId,
        type: 'dm',
        peerId,
        peerName: cleanTitle,
        title: `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> ${cleanTitle}`,
        subtitle: `${m.senderId === ident.fisherId ? 'Вы' : cleanTitle}: ${String(m.text || '').slice(0, 55)}`,
        lastTs: m.ts || 0
      });
    } else {
      if (cleanTitle !== 'Рыболов' && existingChan.peerName === 'Рыболов') {
        existingChan.peerName = cleanTitle;
        existingChan.title = cleanTitle;
      }
      if ((m.ts || 0) >= existingChan.lastTs) {
        existingChan.subtitle = `${m.senderId === ident.fisherId ? 'Вы' : existingChan.peerName}: ${String(m.text || '').slice(0, 55)}`;
        existingChan.lastTs = m.ts || 0;
      }
    }
  }

  const dmChannels = Array.from(dmChannelsMap.values()).sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));
  const allChannels = [...crewChannels, ...dmChannels];

  const activeChan = activeChatChannelId
    ? (allChannels.find(c => c.channelId === activeChatChannelId) || null)
    : null;

  if (!activeChan) {
    activeChatChannelId = '';
    isFullScreenChatOpen = false;
  }

  if (isFullScreenChatOpen && activeChan && allMsgs.some(m => m && m.channelId === activeChan.channelId && m.unread)) {
    const marked = allMsgs.map(m => (m && m.channelId === activeChan.channelId ? { ...m, unread: false } : m));
    storage.saveChatMessages(marked);
    store.dispatch({ type: 'SET_CHAT_MESSAGES', payload: marked });
    syncCircleNavBadge();
  }

  const activeMsgs = activeChan
    ? allMsgs.filter(m => m && (m.channelId === activeChan.channelId || (activeChan.type === 'dm' && getCanonicalDmChannelId(ident.fisherId, m.senderId === ident.fisherId ? m.peerId : m.senderId, allMsgs) === activeChan.channelId)))
    : [];

  return `
    <div style="display:flex;flex-direction:column;gap:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;padding:9px 12px;background:var(--card);border:1px solid ${ident.isRegistered ? 'var(--border)' : 'var(--warn)'};border-radius:var(--r-sm);">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="font-size:var(--fs-xs);color:${ident.isRegistered ? 'var(--good)' : 'var(--warn)'};font-weight:800;">
            ${ident.isRegistered ? `<svg class="k-ico" style="color:var(--good);" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="currentColor" stroke="rgba(255,255,255,0.65)" stroke-width="1.4"/></svg> Профиль: ${escapeHtml(ident.callsign)}` : '<svg class="k-ico" style="color:var(--warn);" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="currentColor" stroke="rgba(255,255,255,0.65)" stroke-width="1.4"/></svg> Гостевой режим (для отправки сообщений войдите в профиль)'}
          </span>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${!ident.isRegistered
            ? `<button type="button" class="btn btn-sm btn-accent" id="chatOpenAuthBtn"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="5" y="11" width="14" height="10" rx="2.5" fill="rgba(251,191,36,0.22)" stroke="#fbbf24" stroke-width="1.8"/><path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> Войти / Регистрация</button>`
            : `<button type="button" class="btn btn-sm btn-good" id="chatShareCatchTopBtn"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 20C5 11 11 5 20 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 4v7c0 1.7-1.3 3-3 3s-3-1.3-3-3" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/><circle cx="14" cy="16" r="2.2" fill="#10b981"/></svg> Поделиться уловом</button>`}
        </div>
      </div>

      <!-- Пункт 20 Дорожной карты v2.5.0: Общие региональные чаты рыбаков РФ -->
      <div class="bento-card" style="padding:10px 12px;border:1.5px solid var(--accent);">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:6px;">
          <div>
            <div style="font-weight:900;font-size:13.5px;color:var(--text);"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" stroke="currentColor" stroke-width="1.6"/></svg> Общие региональные чаты рыбаков РФ</div>
            <div style="font-size:11px;color:var(--muted);">Открытые каналы по регионам России для обмена вестями с водоёмов и ледовой обстановкой</div>
          </div>
          <button type="button" class="btn btn-sm btn-good" data-open-regional-chat="REG-${resolveRussianRegionCode(s)}" style="min-height:34px;font-weight:900;">
            <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z" fill="rgba(239,68,68,0.22)" stroke="#ef4444" stroke-width="1.9"/><circle cx="12" cy="11" r="2.3" fill="#ef4444"/></svg> Чат моего региона (${resolveRussianRegionCode(s)})
          </button>
        </div>
        <div class="chip-scroll-row" style="padding-bottom:2px;">
          ${[
            ['89', '89 • ЯНАО (Ямал)'],
            ['86', '86 • ХМАО-Югра'],
            ['72', '72 • Тюмень'],
            ['30', '30 • Астрахань / Волга'],
            ['10', '10 • Карелия'],
            ['51', '51 • Мурманск / Кольский'],
            ['16', '16 • Татарстан / Кама'],
            ['54', '54 • Новосибирск / Обь'],
            ['66', '66 • Свердловск / Урал'],
            ['23', '23 • Краснодар / Кубань'],
            ['77', '77 • Москва и МО'],
            ['78', '78 • СПб и Ладога'],
            ['24', '24 • Красноярск / Енисей'],
            ['38', '38 • Иркутск / Байкал']
          ].map(([code, label]) => `
            <button type="button" class="w-chip ${activeChatChannelId === 'crew:REG-' + code ? 'active' : ''}" data-open-regional-chat="REG-${code}" style="min-height:32px;padding:4px 10px;">
              <svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" stroke="currentColor" stroke-width="1.6"/></svg> ${label}
            </button>
          `).join('')}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px;">
        <div class="card" style="background:var(--card);padding:8px 10px;border:1px solid var(--border);">
          <div style="font-weight:800;font-size:11px;color:var(--accent);margin-bottom:4px;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg> ЧАТ ЭКИПАЖА ПО КЛЮЧУ (KP-XXXX):</div>
          <div style="display:flex;gap:6px;">
            <input type="text" id="chatJoinCrewKeyInput" class="input" placeholder="Напр. KP-7A3F" style="flex:1;min-height:34px;text-transform:uppercase;">
            <button type="button" class="btn btn-sm btn-accent" id="chatJoinCrewKeyBtn" style="min-height:34px;">Открыть</button>
          </div>
        </div>

        <div class="card" style="background:var(--card);padding:8px 10px;border:1px solid var(--border);">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:4px;">
            <div style="font-weight:800;font-size:11px;color:var(--good);"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> ЛИЧНЫЙ ДИАЛОГ С РЫБАКОМ:</div>
            <button type="button" class="btn btn-sm" id="chatWriteAdminBtn" style="min-height:28px;padding:2px 8px;font-size:11px;border-color:var(--good);color:var(--good);font-weight:800;"><svg class="k-ico" style="color:#fbbf24;" viewBox="0 0 24 24" fill="none"><path d="M3 18h18l-2-11-5 4-2-6-2 6-5-4-2 11z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> Написать Админу</button>
          </div>
          <div style="display:flex;gap:6px;">
            <input type="text" id="chatStartDmIdInput" class="input" placeholder="Введите логин или ID собеседника" style="flex:1;min-height:34px;">
            <button type="button" class="btn btn-sm btn-good" id="chatStartDmBtn" style="min-height:34px;">Написать</button>
          </div>
        </div>
      </div>

      <!-- Вертикальный список чатов сверху вниз -->
      <div style="display:flex;flex-direction:column;gap:8px;">
        <div style="font-weight:800;font-size:var(--fs-xs);color:var(--muted);">
          <svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> ВАШИ ДИАЛОГИ И ЧАТЫ ЭКИПАЖЕЙ (${allChannels.length}):
        </div>
        ${allChannels.length === 0 ? `
          <div style="padding:18px 14px;background:var(--card);border:1px dashed var(--border);border-radius:var(--r-sm);font-size:var(--fs-xs);color:var(--muted);text-align:center;">
            Активных чатов сейчас нет. Введите ключ экипажа <code>KP-XXXX</code> или логин напарника выше, чтобы начать общение.
          </div>
        ` : allChannels.map(ch => {
          const unreadCnt = allMsgs.filter(m => m && m.channelId === ch.channelId && m.unread).length;
          const timeLbl = ch.lastTs ? new Date(ch.lastTs).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
          return `
            <div class="card" style="background:var(--card);padding:10px 12px;border:1px solid ${unreadCnt > 0 ? 'var(--accent)' : 'var(--border)'};display:flex;justify-content:space-between;align-items:center;gap:8px;cursor:pointer;" data-select-chat-chan="${escapeHtml(ch.channelId)}">
              <div style="min-width:0;flex:1;">
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                  <span style="font-weight:800;font-size:var(--fs-sm);color:var(--text);">${escapeHtml(ch.title)}</span>
                  ${unreadCnt > 0 ? `<span class="pill pill-bad" style="font-size:10px;padding:1px 6px;">+${unreadCnt} новых</span>` : ''}
                  ${timeLbl ? `<span style="font-size:10.5px;color:var(--muted);">${timeLbl}</span>` : ''}
                </div>
                <div style="font-size:11.5px;color:var(--muted);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                  ${escapeHtml(ch.subtitle || 'Нажмите, чтобы открыть окно чата')}
                </div>
              </div>
              <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
                <button type="button" class="btn btn-sm btn-accent" data-select-chat-chan="${escapeHtml(ch.channelId)}" style="min-height:30px;padding:3px 10px;font-size:11.5px;">
                  Открыть
                </button>
                <button type="button" class="btn btn-sm" data-del-chat-chan="${escapeHtml(ch.channelId)}" data-del-chat-title="${escapeHtml(ch.title)}" title="Удалить чат" style="min-height:30px;padding:3px 8px;color:var(--bad);border-color:rgba(239,68,68,0.4);">
                  <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <!-- Отдельное полноэкранное окно выбранного чата -->
      ${isFullScreenChatOpen && activeChan ? `
        <div id="klevFullScreenChatOverlay" style="position:fixed;inset:0;z-index:1180;background:var(--bg);display:flex;flex-direction:column;width:100%;height:100%;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 12px;background:var(--panel);border-bottom:1px solid var(--border);box-shadow:var(--shadow-header);flex-shrink:0;">
            <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1;">
              <button type="button" class="btn btn-sm" id="chatFullScreenBackBtn" style="min-height:34px;padding:4px 10px;font-weight:800;flex-shrink:0;">
                ← К чатам
              </button>
              <div style="min-width:0;flex:1;">
                <div style="font-weight:900;font-size:var(--fs-sm);color:var(--accent);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                  ${escapeHtml(activeChan.title)}
                </div>
                <div style="font-size:10.5px;color:var(--muted);">
                  ${activeChan.type === 'crew' ? 'Чат участников экипажа' : 'Личный диалог'}
                </div>
              </div>
            </div>
            <div style="display:flex;gap:6px;align-items:center;flex-shrink:0;">
              ${activeChan.crewKey ? `<span class="fisher-id-copy-badge" data-copy-fisher-id="${activeChan.crewKey}" data-copy-label="Ключ экипажа" style="font-size:11px;font-family:monospace;font-weight:800;cursor:pointer;padding:3px 7px;background:var(--card);border:1px solid var(--border);border-radius:6px;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="8" cy="15" r="4.5" fill="rgba(251,191,36,0.22)" stroke="#fbbf24" stroke-width="1.8"/><path d="M11.5 11.5L20 3m-3 3l2.5 2.5M14.5 8.5L17 11" stroke="#fbbf24" stroke-width="1.8" stroke-linecap="round"/></svg> ${activeChan.crewKey} <svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></span>` : ''}
              <button type="button" class="btn btn-sm" id="chatDeleteHistoryBtn" style="color:var(--bad);border-color:rgba(239,68,68,0.4);min-height:32px;padding:3px 9px;">
                <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Удалить
              </button>
            </div>
          </div>

          <div id="chatMessagesScrollBox" style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;">
            ${activeMsgs.length === 0 ? `
              <div style="margin:auto;padding:20px;text-align:center;color:var(--muted);font-size:var(--fs-xs);max-width:300px;">
                Сообщений в этом диалоге пока нет. Напишите сообщение, отправьте свою геопозицию (<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z" fill="rgba(239,68,68,0.22)" stroke="#ef4444" stroke-width="1.9"/><circle cx="12" cy="11" r="2.3" fill="#ef4444"/></svg>) или прикрепите улов (<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 20C5 11 11 5 20 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 4v7c0 1.7-1.3 3-3 3s-3-1.3-3-3" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/><circle cx="14" cy="16" r="2.2" fill="#10b981"/></svg>)!
              </div>
            ` : activeMsgs.map(m => {
              const isMe = m.senderId === ident.fisherId;
              const senderDisplay = isMe ? 'Вы' : formatCleanPeerTitle(m.senderName, m.senderId);
              const timeStr = new Date(m.ts || Date.now()).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
              const tokenMatch = String(m.text || '').match(/KP1_[A-Za-z0-9_-]+/);
              const packTok = m.catchMeta?.token || (tokenMatch ? tokenMatch[0] : '');
              return `
                <div style="align-self:${isMe ? 'flex-end' : 'flex-start'};max-width:86%;padding:9px 12px;border-radius:12px;background:${isMe ? 'rgba(56,189,248,0.16)' : 'var(--card)'};border:1px solid ${isMe ? 'var(--accent)' : 'var(--border)'};font-size:var(--fs-xs);">
                  <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:3px;flex-wrap:wrap;">
                    <b style="color:${isMe ? 'var(--accent)' : 'var(--good)'};">${escapeHtml(senderDisplay)}</b>
                    <span style="font-size:10px;color:var(--muted);">${timeStr}</span>
                  </div>
                  <div style="white-space:pre-wrap;line-height:1.45;color:var(--text);word-break:break-word;">${escapeHtml(m.text)}</div>
                  ${packTok ? `
                    <div style="margin-top:6px;padding-top:5px;border-top:1px dashed var(--border);display:flex;gap:6px;flex-wrap:wrap;">
                      <button type="button" class="btn btn-sm btn-good" data-chat-import-pack="${packTok}" style="min-height:28px;padding:2px 9px;font-size:11px;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6z" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 3v15M15 6v15" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="10" r="2.2" fill="#38bdf8" stroke="#fff" stroke-width="1"/></svg> Показать точку на карте</button>
                    </div>
                  ` : ''}
                </div>
              `;
            }).join('')}
          </div>

          <div style="display:flex;gap:6px;padding:10px 12px;background:var(--panel);border-top:1px solid var(--border);align-items:center;flex-shrink:0;">
            <button type="button" class="btn btn-sm" id="chatShareLocationBtn" title="Поделиться текущим местоположением" style="min-height:40px;padding:0 10px;flex-shrink:0;border-color:var(--accent);color:var(--accent);font-weight:800;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z" fill="rgba(239,68,68,0.22)" stroke="#ef4444" stroke-width="1.9"/><circle cx="12" cy="11" r="2.3" fill="#ef4444"/></svg></button>
            <button type="button" class="btn btn-sm btn-good" id="chatAttachCatchBtn" title="Прикрепить карточку улова" style="min-height:40px;padding:0 10px;flex-shrink:0;font-weight:800;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 20C5 11 11 5 20 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 4v7c0 1.7-1.3 3-3 3s-3-1.3-3-3" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/><circle cx="14" cy="16" r="2.2" fill="#10b981"/></svg></button>
            <input type="text" id="chatComposeInput" class="input" placeholder="${ident.isRegistered ? 'Напишите сообщение...' : 'Войдите в профиль для отправки...'}" style="flex:1;min-height:40px;">
            <button type="button" class="btn btn-accent" id="chatSendMsgBtn" style="min-height:40px;padding:0 16px;flex-shrink:0;font-weight:900;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg></button>
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

function renderCompactCircleRow(item, s, ident, now) {
  const mine = isCircleItemMine(item, s);
  const hidden = isCircleItemHidden(item, s);
  const isExpanded = expandedCompactIds.has(item.id);
  const itemFid = item.fid || (mine ? ident.fisherId : 'FP_89AAA001');
  const authorDisplay = formatCleanPeerTitle(item.au, itemFid);
  const ageMin = Math.max(1, Math.round((now - (item.ca || now)) / 60000));
  const ageLabel = ageMin < 60 ? `${ageMin} мин` : `${Math.round(ageMin / 60)} ч`;

  let catBadge = '';
  let titleText = '';
  let subMetaText = '';
  let rowBorderColor = mine ? 'rgba(16,185,129,0.55)' : 'var(--border)';
  let rowBg = 'var(--card)';

  if (item.t === 'crew' && item.sos) {
    catBadge = `<span class="pill pill-bad" style="font-size:10px;padding:1px 6px;"><svg class="k-ico" style="color:var(--bad);" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9.5" fill="#dc2626" stroke="#fca5a5" stroke-width="1.8"/><text x="12" y="15" text-anchor="middle" fill="#fff" font-size="7.5" font-weight="900" font-family="sans-serif">SOS</text></svg> SOS</span>`;
    titleText = `${item.lb || 'Водоём'}${item.wn && item.wn !== item.lb ? ` • ${item.wn}` : ''}`;
    subMetaText = `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="4.5" stroke="#38bdf8" stroke-width="1.6"/><circle cx="12" cy="12" r="1.8" fill="#10b981"/></svg> ${Number(item.lat).toFixed(3)}°N, ${Number(item.lon).toFixed(3)}°E • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l3.5 2" stroke="#38bdf8" stroke-width="1.9" stroke-linecap="round"/></svg> ${formatRemainingHours(item.ea)}`;
    rowBorderColor = 'var(--bad)';
    rowBg = 'rgba(239,68,68,0.08)';
  } else if (item.t === 'crew') {
    const cKey = item.crewKey || formatCrewKeyFromHash(computeCrewKeyHash(item.id));
    catBadge = `<span class="pill pill-ice" style="font-size:10px;padding:1px 6px;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg> Экипаж ${cKey}</span>`;
    titleText = `${item.fn || 'Рыба'} • ${item.wn || item.lb || 'Точка'}`;
    subMetaText = `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="3" y="8" width="18" height="8" rx="2" transform="rotate(-35 12 12)" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8"/><path d="M8 11l1.5 2M11 9l1.5 2M14 7l1.5 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg> ${item.dp || 2}м • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3c0 0-6 7.1-6 11.5a6 6 0 0 0 12 0C18 10.1 12 3 12 3z" fill="rgba(56,189,248,0.32)" stroke="#38bdf8" stroke-width="1.8"/><path d="M9.5 15.5c.5 1.2 1.7 2 3 2" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg> ${item.tw ?? 8}°C • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l3.5 2" stroke="#38bdf8" stroke-width="1.9" stroke-linecap="round"/></svg> ${formatRemainingHours(item.ea)}`;
  } else if (item.t === 'workshop') {
    catBadge = `<span class="pill pill-warn" style="font-size:10px;padding:1px 6px;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" fill="rgba(56,189,248,0.2)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> Снасть</span>`;
    titleText = `${item.fn || 'Рыба'}: ${(item.rw || 'Монтаж').split(',')[0]}`;
    subMetaText = `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 18c0-4 4-4 4-8s4-4 4-6 5-1 5 3-3 5-3 8 4 4 6 2" stroke="#f43f5e" stroke-width="2.2" stroke-linecap="round"/></svg> ${item.bt || 'приманка'} • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3c0 0-6 7.1-6 11.5a6 6 0 0 0 12 0C18 10.1 12 3 12 3z" fill="rgba(56,189,248,0.32)" stroke="#38bdf8" stroke-width="1.8"/><path d="M9.5 15.5c.5 1.2 1.7 2 3 2" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg> ${item.twMin ?? 4}..${item.twMax ?? 16}°C`;
  } else {
    const decay = getCircleHexDecayState(item, now);
    catBadge = `<span class="pill pill-good" style="font-size:10px;padding:1px 6px;">⬡ ±${decay.radiusKm}км • ~${decay.hoursLeft}ч</span>`;
    titleText = `${item.fn || 'Рыба'}${item.kg ? ` (${item.kg} кг)` : ''} • ${item.wn || item.lb || 'Сектор'}`;
    subMetaText = `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 18c0-4 4-4 4-8s4-4 4-6 5-1 5 3-3 5-3 8 4 4 6 2" stroke="#f43f5e" stroke-width="2.2" stroke-linecap="round"/></svg> ${item.bt || 'по сезону'} • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3c0 0-6 7.1-6 11.5a6 6 0 0 0 12 0C18 10.1 12 3 12 3z" fill="rgba(56,189,248,0.32)" stroke="#38bdf8" stroke-width="1.8"/><path d="M9.5 15.5c.5 1.2 1.7 2 3 2" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg> ${item.tw ?? 8}°C • Свежесть ${Math.round(decay.freshness * 100)}% (${ageLabel})`;
  }

  const ownerPill = mine
    ? `<span class="pill pill-good" style="font-size:10px;padding:1px 6px;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" fill="rgba(56,189,248,0.22)" stroke="currentColor" stroke-width="1.8"/><path d="M4 20c0-3.8 3.6-6.5 8-6.5s8 2.7 8 6.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> Моё</span>`
    : `<span class="pill pill-neutral" style="font-size:10px;padding:1px 6px;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" stroke="currentColor" stroke-width="1.6"/></svg> ${escapeHtml(authorDisplay)}</span>`;

  const cKey = item.t === 'crew' && !item.sos ? (item.crewKey || formatCrewKeyFromHash(computeCrewKeyHash(item.id))) : '';

  return `
    <div class="circle-compact-row" style="background:${rowBg};border:1px solid ${rowBorderColor};border-radius:var(--r-sm);padding:8px 10px;display:flex;flex-direction:column;gap:6px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;flex:1;min-width:190px;cursor:pointer;" data-toggle-compact-row="${item.id}">
          ${catBadge}
          ${ownerPill}
          <span style="font-weight:800;font-size:var(--fs-xs);color:var(--text);">${titleText}</span>
          <span style="font-size:11px;color:var(--muted);">${subMetaText}</span>
        </div>

        <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;flex-wrap:wrap;">
          ${item.t !== 'workshop' ? `<button type="button" class="btn btn-sm" data-goto-circle="${item.id}" title="Показать на карте" style="min-height:28px;padding:2px 7px;font-size:11px;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6z" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 3v15M15 6v15" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="10" r="2.2" fill="#38bdf8" stroke="#fff" stroke-width="1"/></svg></button>` : ''}
          ${!item.sos ? `<button type="button" class="btn btn-sm btn-good" data-apply-workshop="${item.id}" title="Повторить снасть: применить рыбу, метод, глубину и приманку в прогнозе" style="min-height:28px;padding:2px 7px;font-size:11px;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 20C5 11 11 5 20 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 4v7c0 1.7-1.3 3-3 3s-3-1.3-3-3" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/><circle cx="14" cy="16" r="2.2" fill="#10b981"/></svg> Снасть</button>` : ''}
          ${cKey ? `<button type="button" class="btn btn-sm btn-accent" data-open-crew-chat="${cKey}" title="Открыть чат экипажа" style="min-height:26px;padding:2px 7px;font-size:11px;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg></button>` : (!mine ? `<button type="button" class="btn btn-sm" data-open-dm="${itemFid}" data-open-dm-name="${escapeHtml(authorDisplay)}" title="Написать рыбаку" style="min-height:26px;padding:2px 7px;font-size:11px;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg></button>` : '')}
          ${(mine || ident.isOwner) ? `
            <button type="button" class="btn btn-sm" data-del-my-circle="${item.id}" title="Удалить запись" style="min-height:26px;padding:2px 7px;font-size:11px;color:var(--bad);border-color:rgba(239,68,68,0.4);"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          ` : (hidden ? `
            <button type="button" class="btn btn-sm btn-good" data-unhide-circle="${item.id}" title="Вернуть запись" style="min-height:26px;padding:2px 7px;font-size:11px;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/></svg></button>
          ` : `
            <button type="button" class="btn btn-sm" data-hide-foreign-circle="${item.id}" title="Скрыть чужую запись" style="min-height:26px;padding:2px 7px;font-size:11px;color:var(--muted);"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-6.4 0-10-7-10-7a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c6.4 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
          `)}
          <button type="button" class="btn btn-sm" data-toggle-compact-row="${item.id}" title="Подробности" style="min-height:26px;padding:2px 6px;font-size:11px;">${isExpanded ? '▴' : '▾'}</button>
        </div>
      </div>

      ${isExpanded ? `
        <div style="padding:10px;background:var(--panel);border-radius:var(--r-sm);border:1px solid var(--border);margin-top:4px;display:flex;flex-direction:column;gap:6px;font-size:var(--fs-xs);">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;">
            <span style="font-weight:900;color:var(--accent);"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 12s4-6 11-6c4.2 0 7 2.5 9 6-2 3.5-4.8 6-9 6-7 0-11-6-11-6z" fill="rgba(56,189,248,0.28)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M2 12l-1.5-3.5L5 10.5M2 12l-1.5 3.5L5 13.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="16.5" cy="10.8" r="1.3" fill="currentColor"/></svg> ${escapeHtml(item.fn || 'Рыба')}${item.kg ? ` • Вес: ${item.kg} кг` : ''}</span>
            <span style="color:var(--muted);font-size:11px;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l3.5 2" stroke="#38bdf8" stroke-width="1.9" stroke-linecap="round"/></svg> До истечения: <b>${formatRemainingHours(item.ea || (item.ca ? item.ca + 72*3600000 : now + 72*3600000))}</b></span>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:6px;margin:2px 0;">
            <div><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg> <b>Водоём:</b> ${escapeHtml(item.wn || item.lb || 'Водоём')}</div>
            <div><svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="3" y="8" width="18" height="8" rx="2" transform="rotate(-35 12 12)" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8"/><path d="M8 11l1.5 2M11 9l1.5 2M14 7l1.5 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg> <b>Глубина:</b> ${item.dp || 1.5} м</div>
            <div><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3c0 0-6 7.1-6 11.5a6 6 0 0 0 12 0C18 10.1 12 3 12 3z" fill="rgba(56,189,248,0.32)" stroke="#38bdf8" stroke-width="1.8"/><path d="M9.5 15.5c.5 1.2 1.7 2 3 2" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg> <b>Вода:</b> ${item.tw ?? 8}°C</div>
            <div><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><polygon points="16,8 13.5,13.5 8,16 10.5,10.5" fill="#38bdf8" stroke="currentColor" stroke-width="1.3"/></svg> <b>Атм. давление:</b> ${item.pr ?? 755} мм</div>
            <div><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> <b>Ветер:</b> ${item.ws ?? 4} м/с</div>
            <div><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 18c0-4 4-4 4-8s4-4 4-6 5-1 5 3-3 5-3 8 4 4 6 2" stroke="#f43f5e" stroke-width="2.2" stroke-linecap="round"/></svg> <b>Насадка:</b> ${escapeHtml(item.bt || 'мотыль / блесна')}</div>
            <div><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 20C5 11 11 5 20 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 4v7c0 1.7-1.3 3-3 3s-3-1.3-3-3" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/><circle cx="14" cy="16" r="2.2" fill="#10b981"/></svg> <b>Снасть:</b> ${escapeHtml(item.rw || item.rg || 'по сезону')}</div>
            <div><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" fill="rgba(56,189,248,0.22)" stroke="currentColor" stroke-width="1.8"/><path d="M4 20c0-3.8 3.6-6.5 8-6.5s8 2.7 8 6.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> <b>Автор:</b> ${escapeHtml(authorDisplay)}</div>
          </div>
          ${cKey ? `<div style="color:var(--good);font-weight:800;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="8" cy="15" r="4.5" fill="rgba(251,191,36,0.22)" stroke="#fbbf24" stroke-width="1.8"/><path d="M11.5 11.5L20 3m-3 3l2.5 2.5M14.5 8.5L17 11" stroke="#fbbf24" stroke-width="1.8" stroke-linecap="round"/></svg> Ключ закрытого экипажа: <code>${cKey}</code></div>` : ''}
          ${item.nt ? `<div style="padding:6px 8px;background:var(--card);border-left:3px solid var(--accent);border-radius:4px;color:var(--text);font-style:italic;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> «${escapeHtml(item.nt)}»</div>` : ''}
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;">
            ${item.t !== 'workshop' ? `<button type="button" class="btn btn-sm btn-accent" data-goto-circle="${item.id}" style="padding:4px 10px;font-size:11.5px;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6z" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 3v15M15 6v15" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="10" r="2.2" fill="#38bdf8" stroke="#fff" stroke-width="1"/></svg> Показать на карте</button>` : ''}
            ${!item.sos ? `<button type="button" class="btn btn-sm btn-good" data-apply-workshop="${item.id}" style="padding:4px 10px;font-size:11.5px;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 20C5 11 11 5 20 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 4v7c0 1.7-1.3 3-3 3s-3-1.3-3-3" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/><circle cx="14" cy="16" r="2.2" fill="#10b981"/></svg> Повторить снасть в прогнозе</button>` : ''}
            ${cKey ? `<button type="button" class="btn btn-sm btn-good" data-open-crew-chat="${cKey}" style="padding:4px 10px;font-size:11.5px;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> Чат экипажа (${cKey})</button>` : (!mine ? `<button type="button" class="btn btn-sm" data-open-dm="${itemFid}" data-open-dm-name="${escapeHtml(authorDisplay)}" style="padding:4px 10px;font-size:11.5px;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> Написать в ЛС</button>` : '')}
            ${(mine || ident.isOwner) ? `<button type="button" class="btn btn-sm" data-del-my-circle="${item.id}" style="padding:4px 10px;font-size:11.5px;color:var(--bad);border-color:rgba(239,68,68,0.4);"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Удалить</button>` : ''}
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

export function renderCircleChatsHubBar(activeMode = 'radar') {
  const s = store.getState();
  const unreadChats = (s.chatMessages || []).filter(m => m && m.unread).length;
  const allItems = purgeExpiredCircleItems(s.circleItems || []);
  const radarCount = allItems.filter(x => x && x.t !== 'workshop' && !isCircleItemHidden(x, s)).length;
  const wsCount = allItems.filter(x => x && x.t === 'workshop' && !isCircleItemHidden(x, s)).length;

  return `
    <div class="circle-chats-hub-bar" role="tablist" aria-label="Единый центр связи: Чаты, Круг и Экипажи">
      <button type="button" class="btn circle-chats-hub-btn ${activeMode === 'chats' ? 'btn-accent' : ''}" data-hub-switch="chats" role="tab" aria-selected="${activeMode === 'chats' ? 'true' : 'false'}">
        <span><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> Чаты и Каналы</span>
        ${unreadChats > 0 ? `<span class="pill pill-bad" style="font-size:10px;padding:1px 6px;margin-left:2px;">+${unreadChats}</span>` : ''}
      </button>
      <button type="button" class="btn circle-chats-hub-btn ${activeMode !== 'chats' ? 'btn-accent' : ''}" data-hub-switch="radar" role="tab" aria-selected="${activeMode !== 'chats' ? 'true' : 'false'}">
        <span><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="5" stroke="#38bdf8" stroke-width="1.5"/><path d="M12 12l6-6" stroke="#10b981" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="1.8" fill="#10b981"/></svg> Круг и Экипажи (${radarCount})</span>
      </button>
    </div>
  `;
}

function bindCircleChatsHubBarEvents(container) {
  if (!container) return;
  container.querySelectorAll('[data-hub-switch]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const target = btn.getAttribute('data-hub-switch');
      triggerHaptic('selection');
      if (target === 'chats') {
        router.navigate('chats');
        renderChatsSection();
      } else if (target === 'workshop') {
        activeCategoryFilter = 'workshop';
        router.navigate('circle');
        const secCir = typeof document !== 'undefined' ? document.getElementById('secCircle') : null;
        if (secCir) render(secCir);
      } else {
        if (activeCategoryFilter === 'workshop') activeCategoryFilter = 'all';
        router.navigate('circle');
        const secCir = typeof document !== 'undefined' ? document.getElementById('secCircle') : null;
        if (secCir) render(secCir);
      }
    });
  });
}

export function renderChatsSection(customContainer = null) {
  const container = customContainer || (typeof document !== 'undefined' ? document.getElementById('secChats') : null);
  if (!container) return;
  const s = store.getState();
  const ident = getCurrentFisherIdentity(s);
  const allItems = purgeExpiredCircleItems(s.circleItems || []);
  const visibleCrews = allItems.filter(x => x.t === 'crew' && !x.sos && canUserAccessCrewItem(x, s));

  container.innerHTML = `
    <div class="card">
      ${renderCircleChatsHubBar('chats')}
      <div class="section-head" style="margin-bottom:8px;">
        <div>
          <span class="section-title"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> Чаты Экипажей и Личные диалоги</span>
          <div style="font-size:var(--fs-xs);color:var(--muted);margin-top:2px;">
            Общение с экипажем по ключу <code>KP-XXXX</code> или личная переписка с рыбаками
          </div>
        </div>
      </div>
      ${renderChatsSubView(s, ident, visibleCrews)}
    </div>
  `;

  bindCircleChatsHubBarEvents(container);
  bindChatViewEvents(container);
}

/**
 * Отрисовка вкладки « Круг»
 */
export function render(container) {
  if (!container) return;
  markCircleNotificationsRead();
  const s = store.getState();
  const now = Date.now();
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

  const hubMode = activeCategoryFilter === 'workshop' ? 'workshop' : 'radar';
  container.innerHTML = `
    <div class="card">
      ${renderCircleChatsHubBar(hubMode)}
      <!-- 1. Шапка статуса профиля (без лишнего дублирования ID) -->
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;padding:10px 12px;background:${ident.isOwner ? 'rgba(16,185,129,0.10)' : (ident.isRegistered ? 'rgba(56,189,248,0.08)' : 'rgba(245,158,11,0.10)')};border:1.5px solid ${ident.isOwner ? 'var(--good)' : (ident.isRegistered ? 'var(--accent)' : 'var(--warn)')};border-radius:var(--r-sm);margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <div>
            <div style="font-weight:800;font-size:var(--fs-xs);color:var(--text);">
              ${ident.isOwner
                ? `<svg class="k-ico" style="color:#fbbf24;" viewBox="0 0 24 24" fill="none"><path d="M3 18h18l-2-11-5 4-2-6-2 6-5-4-2 11z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> Супер-Админ Владелец (${escapeHtml(ident.login)})`
                : (ident.isRegistered
                    ? `<svg class="k-ico" style="color:var(--good);" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="currentColor" stroke="rgba(255,255,255,0.65)" stroke-width="1.4"/></svg> Профиль активен: «${escapeHtml(ident.login || ident.callsign)}»`
                    : `<svg class="k-ico" style="color:var(--warn);" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="currentColor" stroke="rgba(255,255,255,0.65)" stroke-width="1.4"/></svg> Гостевой режим (только просмотр)`)}
            </div>
            <div style="font-size:11px;color:var(--muted);">
              ${ident.isRegistered
                ? 'Вы можете публиковать сводки в Круг (±5 км), создавать Экипажи (72 ч) и отправлять сигналы SOS'
                : '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="5" y="11" width="14" height="10" rx="2.5" fill="rgba(251,191,36,0.22)" stroke="#fbbf24" stroke-width="1.8"/><path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> Для публикации своих точек и общения в чатах войдите или зарегистрируйтесь в профиле'}
            </div>
          </div>
        </div>

        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
          ${ident.isOwner ? `
            <button type="button" class="btn btn-sm btn-good" id="circleGoAdminTabBtn" style="min-height:32px;font-weight:800;"><svg class="k-ico" style="color:#fbbf24;" viewBox="0 0 24 24" fill="none"><path d="M3 18h18l-2-11-5 4-2-6-2 6-5-4-2 11z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> Статистика и БД</button>
          ` : ''}
          ${!ident.isRegistered ? `
            <button type="button" class="btn btn-sm btn-accent" id="circleAuthModalBtn" style="min-height:32px;font-weight:800;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="5" y="11" width="14" height="10" rx="2.5" fill="rgba(251,191,36,0.22)" stroke="#fbbf24" stroke-width="1.8"/><path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> Регистрация / Вход</button>
          ` : `
            <button type="button" class="btn btn-sm" id="circleAuthModalBtn" style="min-height:32px;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" fill="rgba(56,189,248,0.22)" stroke="currentColor" stroke-width="1.8"/><path d="M4 20c0-3.8 3.6-6.5 8-6.5s8 2.7 8 6.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> Профиль</button>
          `}
          <button type="button" class="btn btn-sm" id="circleImportPackBtn" style="min-height:32px;" title="Ввести 4-значный ключ закрытого Экипажа KP-XXXX или код точки"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="8" cy="15" r="4.5" fill="rgba(251,191,36,0.22)" stroke="#fbbf24" stroke-width="1.8"/><path d="M11.5 11.5L20 3m-3 3l2.5 2.5M14.5 8.5L17 11" stroke="#fbbf24" stroke-width="1.8" stroke-linecap="round"/></svg> Ключ KP-XXXX</button>
          <button type="button" class="btn btn-sm" id="circleRefreshRadarBtn" style="min-height:32px;" title="Синхронизировать точки с сервером"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M20 11a8 8 0 0 0-14.5-4.5L4 8m0-5v5h5M4 13a8 8 0 0 0 14.5 4.5L20 16m0 5v-5h-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Радар</button>
        </div>
      </div>

      <!-- 2. Три главные карточки действий Круга -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;margin-bottom:12px;">
        <button type="button" class="card" data-quick-share="circle" style="text-align:left;cursor:pointer;padding:10px 12px;background:var(--card);border:1.5px solid var(--good);display:flex;flex-direction:column;gap:4px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-weight:900;font-size:var(--fs-sm);color:var(--good);"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3.5" fill="rgba(56,189,248,0.25)" stroke="currentColor" stroke-width="1.8"/><path d="M3 19c0-3.2 2.7-5.5 6-5.5s6 2.3 6 5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="17" cy="9" r="2.8" stroke="currentColor" stroke-width="1.6"/><path d="M16 14c2.6.3 4.8 2 5 4.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg> Сводка в Круг (±5 км)</span>
            <span class="pill pill-good" style="font-size:10px;">Приватно</span>
          </div>
          <div style="font-size:11px;color:var(--muted);line-height:1.35;">
            Поделиться клёвом в радиусе 35 км со скрытием точного места (±5 км)
          </div>
        </button>

        <button type="button" class="card" data-quick-share="crew" style="text-align:left;cursor:pointer;padding:10px 12px;background:var(--card);border:1.5px solid var(--accent);display:flex;flex-direction:column;gap:4px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-weight:900;font-size:var(--fs-sm);color:var(--accent);"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg> Экипаж (72 ч • KP-XXXX)</span>
            <span class="pill pill-ice" style="font-size:10px;">По ключу</span>
          </div>
          <div style="font-size:11px;color:var(--muted);line-height:1.35;">
            Точные координаты стоянки и общий чат только для своих напарников на 72 часа
          </div>
        </button>

        <button type="button" class="card" data-quick-share="sos" style="text-align:left;cursor:pointer;padding:10px 12px;background:rgba(239,68,68,0.08);border:1.5px solid var(--bad);display:flex;flex-direction:column;gap:4px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-weight:900;font-size:var(--fs-sm);color:var(--bad);"><svg class="k-ico" style="color:var(--bad);" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9.5" fill="#dc2626" stroke="#fca5a5" stroke-width="1.8"/><text x="12" y="15" text-anchor="middle" fill="#fff" font-size="7.5" font-weight="900" font-family="sans-serif">SOS</text></svg> SOS на воде</span>
            <span class="pill pill-bad" style="font-size:10px;">Всем рядом</span>
          </div>
          <div style="font-size:11px;color:var(--muted);line-height:1.35;">
            Экстренный сигнал помощи с точными GPS-координатами всем рыбакам в регионе
          </div>
        </button>
      </div>

      <!-- 3. Панель фильтрации радара (Принадлежность + Тип точек) -->
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:8px;padding:8px 10px;background:var(--card);border:1px solid var(--border);border-radius:var(--r-sm);">
        <div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;">
          <button type="button" class="btn btn-sm ${activeOwnershipFilter === 'all' ? 'btn-accent' : ''}" data-circle-owner="all" style="min-height:30px;padding:3px 9px;">
            Все (${nonHiddenItems.length})
          </button>
          <button type="button" class="btn btn-sm ${activeOwnershipFilter === 'mine' ? 'btn-good' : ''}" data-circle-owner="mine" style="min-height:30px;padding:3px 9px;">
            <svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" fill="rgba(56,189,248,0.22)" stroke="currentColor" stroke-width="1.8"/><path d="M4 20c0-3.8 3.6-6.5 8-6.5s8 2.7 8 6.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> Мои (${mineItems.length})
          </button>
          <button type="button" class="btn btn-sm ${activeOwnershipFilter === 'foreign' ? 'btn-accent' : ''}" data-circle-owner="foreign" style="min-height:30px;padding:3px 9px;">
            <svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" stroke="currentColor" stroke-width="1.6"/></svg> Чужие (${foreignItems.length})
          </button>
          ${hiddenItems.length > 0 || activeOwnershipFilter === 'hidden' ? `
            <button type="button" class="btn btn-sm ${activeOwnershipFilter === 'hidden' ? 'btn-accent' : ''}" data-circle-owner="hidden" style="min-height:30px;padding:3px 9px;">
              <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/></svg> Скрытые (${hiddenItems.length})
            </button>
          ` : ''}
        </div>

        <div style="display:flex;gap:5px;flex-wrap:wrap;">
          ${hiddenItems.length > 0 && activeOwnershipFilter === 'hidden' ? `
            <button type="button" class="btn btn-sm" id="circleUnhideAllBtn" style="min-height:28px;font-size:11px;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/></svg> Вернуть все</button>
          ` : ''}
          ${hiddenLockedCrewsCount > 0 ? `
            <button type="button" class="btn btn-sm" id="circleUnlockHiddenCrewBtn" style="min-height:28px;font-size:11px;border-color:var(--accent);color:var(--accent);"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="5" y="11" width="14" height="10" rx="2.5" fill="rgba(251,191,36,0.22)" stroke="#fbbf24" stroke-width="1.8"/><path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> Закрытых экипажей: ${hiddenLockedCrewsCount}</button>
          ` : ''}
          ${activeCategoryFilter === 'workshop' ? `
            <button type="button" class="btn btn-sm btn-good" data-quick-share="workshop" style="min-height:28px;font-size:11px;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" fill="rgba(56,189,248,0.2)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> + Добавить свой монтаж</button>
          ` : ''}
        </div>
      </div>

      <div class="chip-scroll-row" style="margin-bottom:10px;">
        <button type="button" class="w-chip ${activeCategoryFilter === 'all' ? 'active' : ''}" data-circle-cat="all"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="5" stroke="#38bdf8" stroke-width="1.5"/><path d="M12 12l6-6" stroke="#10b981" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="1.8" fill="#10b981"/></svg> Все сигналы (${baseList.length})</button>
        <button type="button" class="w-chip ${activeCategoryFilter === 'circle' ? 'active' : ''}" data-circle-cat="circle"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3.5" fill="rgba(56,189,248,0.25)" stroke="currentColor" stroke-width="1.8"/><path d="M3 19c0-3.2 2.7-5.5 6-5.5s6 2.3 6 5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="17" cy="9" r="2.8" stroke="currentColor" stroke-width="1.6"/><path d="M16 14c2.6.3 4.8 2 5 4.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg> Круг ±5км (${baseList.filter(x => x.t === 'circle').length})</button>
        <button type="button" class="w-chip ${activeCategoryFilter === 'crew' ? 'active' : ''}" data-circle-cat="crew"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg> Экипаж 72ч (${baseList.filter(x => x.t === 'crew' && !x.sos).length})</button>
        <button type="button" class="w-chip ${activeCategoryFilter === 'sos' ? 'active' : ''}" data-circle-cat="sos"><svg class="k-ico" style="color:var(--bad);" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9.5" fill="#dc2626" stroke="#fca5a5" stroke-width="1.8"/><text x="12" y="15" text-anchor="middle" fill="#fff" font-size="7.5" font-weight="900" font-family="sans-serif">SOS</text></svg> SOS (${baseList.filter(x => x.t === 'crew' && x.sos).length})</button>

      </div>

      <!-- 4. Компактный список событий радара -->
      <div class="circle-compact-list" style="display:flex;flex-direction:column;gap:6px;">
        ${filteredList.length === 0 ? `
          <div style="padding:16px;background:var(--card);border:1px dashed var(--border);border-radius:var(--r-sm);font-size:var(--fs-xs);color:var(--muted);text-align:center;">
            ${activeOwnershipFilter === 'mine'
              ? 'У вас пока нет опубликованных точек. Выберите одну из 3 карточек выше, чтобы поделиться сводкой или создать Экипаж.'
              : 'В выбранной категории пока нет активных точек за последние 72 часа. Нажмите «<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M20 11a8 8 0 0 0-14.5-4.5L4 8m0-5v5h5M4 13a8 8 0 0 0 14.5 4.5L20 16m0 5v-5h-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Радар» для проверки новых сигналов с сервера.'}
          </div>
        ` : filteredList.map(item => renderCompactCircleRow(item, s, ident, now)).join('')}
      </div>
    </div>
  `;

  bindCircleChatsHubBarEvents(container);
  bindCircleEvents(container);
}

/**
 * Загружает с сервера полную статистику и реестр пользователей для вкладки Супер-Админа (« Админ»)
 */
let _lastAdminDashboardFetchTs = 0;
/**
 * Открывает полную серверную Веб-консоль Супер-Админа напрямую через многоканальный шлюз workerFetch
 * (100% работает без VPN в мобильных сетях РФ, с VPN, в Android APK и в Telegram Mini App без блокировки iframe/CSP)
 */
export async function openFullServerWebConsoleModal() {
  const s = store.getState();
  const ident = getCurrentFisherIdentity(s);
  if (!ident.isOwner) {
    showToast('Доступ разрешён только Владельцу (iAthor / FP_89VIP089)', 'bad');
    return;
  }

  const renderConsoleModalContent = (bodyEl, dbData) => {
    if (!bodyEl) return;
    const db = dbData || _adminDashboardCache || {};
    const users = Array.isArray(db.users) ? db.users : [];
    const points = Array.isArray(db.points) ? db.points : (store.getState().circleItems || []);
    const counters = db.counters || {};
    const reserveCounters = db.reserveCounters || {};
    const d1Connected = db.d1Status === 'CONNECTED';
    const now = Date.now();
    const active24h = users.filter(u => u && (now - (u.lastSeen || 0)) < 86400000).length;
    const active7d = users.filter(u => u && (now - (u.lastSeen || 0)) < 7 * 86400000).length;

    const regStats = {};
    for (const u of users) {
      const rc = u.regionCode || '89';
      regStats[rc] = (regStats[rc] || 0) + 1;
    }
    const regBadgesHtml = Object.entries(regStats)
      .sort((a, b) => b[1] - a[1])
      .map(([rc, cnt]) => `<span class="pill pill-neutral" style="font-size:11px;">Регион <b>${escapeHtml(rc)}</b>: ${cnt} чел. (след. #${(counters[rc] || 0) + 1} / RZ${(reserveCounters[rc] || 0) + 1})</span>`)
      .join(' ');

    bodyEl.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:10px;font-size:12px;">
        <div class="card" style="padding:10px 12px;border:1.5px solid ${d1Connected ? 'var(--good)' : 'var(--warn)'};background:${d1Connected ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.12)'};">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
            <div>
              <div style="font-weight:900;color:${d1Connected ? 'var(--good)' : 'var(--warn)'};font-size:13px;">
                ${d1Connected ? 'Cloudflare D1 SQL: ПОДКЛЮЧЕНА (' + escapeHtml(db.d1BindingName || 'DB') + ')' : 'Автономная синхронизация (нажмите «Обновить с сервера»)'}
              </div>
              <div style="font-size:11px;color:var(--muted);margin-top:2px;">
                Активный канал связи: <b style="color:var(--accent);">${escapeHtml(getLastActiveDbGatewayLabel())}</b> • Версия ядра: <b>v2.5.1 r188</b>
              </div>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <button type="button" class="btn btn-sm btn-accent" id="wcModalSyncBtn">Обновить с сервера</button>
              <button type="button" class="btn btn-sm" id="wcModalExportJsonBtn">Экспорт .JSON</button>
              <button type="button" class="btn btn-sm" id="wcModalExportCsvBtn">Экспорт .CSV</button>
            </div>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;">
          <div class="card" style="padding:8px 10px;background:var(--card);">
            <div style="font-size:18px;font-weight:900;color:var(--good);">${users.length}</div>
            <div style="font-size:10.5px;color:var(--muted);">Всего рыбаков в БД</div>
          </div>
          <div class="card" style="padding:8px 10px;background:var(--card);">
            <div style="font-size:18px;font-weight:900;color:var(--accent);">${active24h} / ${active7d}</div>
            <div style="font-size:10.5px;color:var(--muted);">Активны 24ч / 7д</div>
          </div>
          <div class="card" style="padding:8px 10px;background:var(--card);">
            <div style="font-size:18px;font-weight:900;color:var(--warn);">${points.length}</div>
            <div style="font-size:10.5px;color:var(--muted);">Точек Круга / Экипажей</div>
          </div>
        </div>

        <div class="card" style="padding:8px 10px;background:var(--card);">
          <div style="font-weight:800;font-size:11px;color:var(--accent);margin-bottom:6px;">РАСПРЕДЕЛЕНИЕ ID ПО РЕГИОНАМ РФ:</div>
          <div style="display:flex;flex-wrap:wrap;gap:5px;">${regBadgesHtml || '<span style="color:var(--muted);">Данные загружаются...</span>'}</div>
        </div>

        <div class="card" style="padding:10px;background:var(--card);">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
            <span style="font-weight:900;color:var(--text);">РЕЕСТР ПОЛЬЗОВАТЕЛЕЙ D1 (${users.length}):</span>
            <input type="search" id="wcModalSearchInput" class="input" placeholder="Фильтр по ID, логину, @tg, городу..." style="max-width:240px;min-height:32px;font-size:12px;">
          </div>
          <div style="max-height:240px;overflow-y:auto;overflow-x:auto;border:1px solid var(--border);border-radius:8px;">
            <table style="width:100%;border-collapse:collapse;font-size:11.5px;">
              <thead>
                <tr style="background:var(--panel);color:var(--muted);text-align:left;">
                  <th style="padding:6px;">ID</th>
                  <th style="padding:6px;">Логин / TG</th>
                  <th style="padding:6px;">Регион</th>
                  <th style="padding:6px;">Платформа</th>
                  <th style="padding:6px;text-align:right;">Действие</th>
                </tr>
              </thead>
              <tbody id="wcModalUsersTbody">
                ${users.length === 0 ? '<tr><td colspan="5" style="padding:12px;text-align:center;color:var(--muted);">Нажмите «Обновить с сервера» для получения реестра D1</td></tr>' : users.map(u => {
                  const isOwn = isOwnerFisherId(u.fisherId);
                  const rowSearch = escapeHtml(`${u.fisherId || ''} ${u.login || ''} ${u.callsign || ''} ${u.tgUsername || ''} ${u.locLabel || ''} ${u.regionCode || ''}`.toLowerCase());
                  return `
                    <tr data-wc-search="${rowSearch}" style="border-bottom:1px solid var(--border);">
                      <td style="padding:6px;font-family:monospace;font-weight:800;color:${isOwn ? 'var(--good)' : 'var(--accent)'};" data-copy-fisher-id="${escapeHtml(u.fisherId)}">${escapeHtml(u.fisherId)}</td>
                      <td style="padding:6px;"><b>${escapeHtml(u.login || u.callsign || 'Гость')}</b> ${u.tgUsername ? `<span style="color:var(--accent);">@${escapeHtml(u.tgUsername)}</span>` : ''}</td>
                      <td style="padding:6px;">[${escapeHtml(u.regionCode || '89')}] ${escapeHtml(u.locLabel || 'РФ')}</td>
                      <td style="padding:6px;">${escapeHtml(u.platform || 'WEB')} <span style="color:var(--muted);font-size:10px;">v${escapeHtml(u.version || '2.5.1')}</span></td>
                      <td style="padding:6px;text-align:right;">
                        ${isOwn ? '<span style="color:var(--good);font-weight:800;">Владелец</span>' : `<button type="button" class="btn btn-sm" data-wc-del-user="${escapeHtml(u.fisherId)}" style="min-height:24px;padding:1px 7px;color:var(--bad);border-color:var(--bad);">Удалить</button>`}
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card" style="padding:10px;background:var(--card);">
          <div style="font-weight:900;color:var(--text);margin-bottom:6px;">АКТИВНЫЕ ТОЧКИ И ГЕКСАГОНЫ НА СЕРВЕРЕ (${points.length}):</div>
          <div style="max-height:180px;overflow-y:auto;display:flex;flex-direction:column;gap:5px;">
            ${points.length === 0 ? '<div style="padding:10px;text-align:center;color:var(--muted);">Активных точек сейчас нет</div>' : points.map(pt => {
              const decay = getCircleHexDecayState(pt, now);
              return `
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 8px;background:var(--panel);border:1px solid var(--border);border-radius:6px;">
                  <div style="min-width:0;flex:1;">
                    <b>[${escapeHtml(pt.t || 'circle')}] ${escapeHtml(pt.fn || 'Рыба')}</b> • ${escapeHtml(pt.wn || pt.lb || 'Водоём')} •
                    <span style="font-family:monospace;color:var(--accent);">${escapeHtml(pt.fid || '')}</span> •
                    <span style="color:var(--muted);font-size:10.5px;">осталось ~${decay.hoursLeft} ч</span>
                  </div>
                  <button type="button" class="btn btn-sm" data-wc-del-point="${escapeHtml(pt.id)}" style="min-height:24px;padding:1px 7px;color:var(--bad);border-color:var(--bad);">Удалить</button>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;

    bodyEl.querySelector('#wcModalSyncBtn')?.addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      btn.textContent = 'Синхронизация...';
      const fresh = await fetchSuperAdminDashboardData(true);
      renderConsoleModalContent(bodyEl, fresh);
    });

    bodyEl.querySelector('#wcModalExportJsonBtn')?.addEventListener('click', () => {
      const fname = `klev-pro-users-db-${new Date().toISOString().slice(0, 10)}.json`;
      downloadFileCrossPlatform(fname, JSON.stringify({ exportedAt: new Date().toISOString(), version: '2.5.1', total: users.length, users, points }, null, 2), 'application/json;charset=utf-8');
      showToast(`База сохранена: ${fname}`, 'good');
    });

    bodyEl.querySelector('#wcModalExportCsvBtn')?.addEventListener('click', () => {
      const header = ['fisherId', 'isTemporaryReserve', 'login', 'callsign', 'tgUsername', 'regionCode', 'locLabel', 'platform', 'sessionsCount', 'circlePostsCount', 'lastSeen'];
      const rows = users.map(u => header.map(k => `"${String(u[k] ?? '').replace(/"/g, '""')}"`).join(','));
      const csv = "\uFEFF" + header.join(",") + "\n" + rows.join("\n");
      const fname = `klev-pro-users-db-${new Date().toISOString().slice(0, 10)}.csv`;
      downloadFileCrossPlatform(fname, csv, 'text/csv;charset=utf-8');
      showToast(`Таблица сохранена: ${fname}`, 'good');
    });

    bodyEl.querySelector('#wcModalSearchInput')?.addEventListener('input', (ev) => {
      const q = (ev.target.value || '').trim().toLowerCase();
      bodyEl.querySelectorAll('#wcModalUsersTbody tr[data-wc-search]').forEach(tr => {
        const hay = tr.getAttribute('data-wc-search') || '';
        tr.style.display = (!q || hay.includes(q)) ? '' : 'none';
      });
    });

    bodyEl.querySelectorAll('[data-wc-del-user]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const targetFid = btn.getAttribute('data-wc-del-user');
        if (!targetFid) return;
        const tok = _serverAdminSessionToken || store.getState().userProfile?.adminSessionToken || OWNER_ADMIN_CONSOLE_TOKEN;
        try {
          const res = await workerFetch('/api/admin/user/delete', {
            method: 'POST',
            body: JSON.stringify({ targetFisherId: targetFid, adminToken: tok })
          }, 5500, 1);
          if (res.ok) {
            showToast(`Пользователь ${targetFid} удалён из базы D1`, 'info');
            const fresh = await fetchSuperAdminDashboardData(false);
            renderConsoleModalContent(bodyEl, fresh);
          }
        } catch (err) {
          showToast('Ошибка связи при удалении пользователя', 'bad');
        }
      });
    });

    bodyEl.querySelectorAll('[data-wc-del-point]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const pid = btn.getAttribute('data-wc-del-point');
        if (!pid) return;
        await deleteCircleItemFromServer(pid);
        showToast(`Точка ${pid} удалена с сервера`, 'info');
        const fresh = await fetchSuperAdminDashboardData(false);
        renderConsoleModalContent(bodyEl, fresh);
      });
    });
  };

  openModal(
    'Серверная Веб-консоль Супер-Админа (D1 Cloud)',
    '<div id="wcModalRoot"><div style="padding:18px;text-align:center;color:var(--muted);">Подключение к базе D1 через многоканальный шлюз...</div></div>',
    async (bodyEl) => {
      const root = bodyEl?.querySelector('#wcModalRoot') || bodyEl;
      renderConsoleModalContent(root, _adminDashboardCache);
      const fresh = await fetchSuperAdminDashboardData(false);
      if (fresh) renderConsoleModalContent(root, fresh);
    },
    true
  );
}

export async function fetchSuperAdminDashboardData(forceToast = false) {
  const s = store.getState();
  if (!isOwnerAdmin(s)) return null;
  _adminDashboardLoading = true;
  _lastAdminDashboardFetchTs = Date.now();
  const tok = _serverAdminSessionToken || s.userProfile?.adminSessionToken || OWNER_ADMIN_CONSOLE_TOKEN || OWNER_TOKEN_HASH_IATHOR;
  try {
    const res = await workerFetch(`/api/admin/users?token=${encodeURIComponent(tok)}`, { method: 'GET' }, 6500, 1);
    if (res.ok) {
      const data = await res.json();
      if (data && data.ok) {
        _adminDashboardCache = data;
        _adminDashboardLoading = false;
        if (forceToast) showToast(` База данных обновлена с сервера: ${data.totalUsers || 0} пользователей, ${(data.points || []).length} точек`, 'good');
        renderAdminSection();
        return data;
      }
    }
  } catch (e) {}
  _adminDashboardLoading = false;
  if (forceToast) showToast('Показана локальная сводка Супер-Админа', 'info');
  renderAdminSection();
  return _adminDashboardCache;
}

/**
 * Отрисовка выделенной вкладки Супер-Админа « Админ» (#secAdmin) со статистикой, реестром ID и базой
 */
let _adminSearchFilter = '';

export function renderAdminSection(customContainer = null) {
  const container = customContainer || (typeof document !== 'undefined' ? document.getElementById('secAdmin') : null);
  if (!container) return;
  const s = store.getState();
  const ident = getCurrentFisherIdentity(s);

  if (!ident.isOwner) {
    container.innerHTML = `
      <div class="card" style="border-color:var(--warn);text-align:center;padding:20px;">
        <div style="font-size:var(--fs-md);font-weight:900;color:var(--warn);margin-bottom:6px;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="5" y="11" width="14" height="10" rx="2.5" fill="rgba(251,191,36,0.22)" stroke="#fbbf24" stroke-width="1.8"/><path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> Раздел только для Супер-Админа (Владельца)</div>
        <p style="font-size:var(--fs-xs);color:var(--muted);margin-bottom:12px;">Войдите под эксклюзивным логином Владельца (iAthor / iAthor82) для доступа к серверной статистике и базе пользователей.</p>
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
          <button type="button" class="btn btn-accent" id="adminLockedSignInBtn"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="8" cy="15" r="4.5" fill="rgba(251,191,36,0.22)" stroke="#fbbf24" stroke-width="1.8"/><path d="M11.5 11.5L20 3m-3 3l2.5 2.5M14.5 8.5L17 11" stroke="#fbbf24" stroke-width="1.8" stroke-linecap="round"/></svg> Войти как Супер-Админ</button>
          <button type="button" class="btn" id="adminLockedBackBtn">← Назад в приложение</button>
        </div>
      </div>
    `;
    container.querySelector('#adminLockedSignInBtn')?.addEventListener('click', () => openAuthAndBackupModal());
    container.querySelector('#adminLockedBackBtn')?.addEventListener('click', () => router.navigate('forecast'));
    return;
  }

  if ((!_adminDashboardCache || (Date.now() - _lastAdminDashboardFetchTs > 2500)) && !_adminDashboardLoading) {
    fetchSuperAdminDashboardData(false);
  }

  const db = _adminDashboardCache || {};
  const users = Array.isArray(db.users) ? db.users : [];
  const srvPoints = Array.isArray(db.points) ? db.points : (s.circleItems || []);
  const counters = db.counters || {};
  const reserveCounters = db.reserveCounters || {};
  const now = Date.now();

  const permanentUsers = users.filter(u => u && !isTemporaryReserveId(u.fisherId));
  const reserveUsers = users.filter(u => u && isTemporaryReserveId(u.fisherId));
  const tgBoundUsers = users.filter(u => u && (u.tgId || u.tgUsername));
  const active24h = users.filter(u => u && (now - (u.lastSeen || 0)) < 86400000).length;
  const active7d = users.filter(u => u && (now - (u.lastSeen || 0)) < 7 * 86400000).length;
  const apkCount = users.filter(u => String(u?.platform || '').toUpperCase().includes('APK')).length;
  const iosCount = users.filter(u => String(u?.platform || '').toUpperCase().includes('IOS')).length;
  const tgCount = users.filter(u => String(u?.platform || '').toUpperCase().includes('TG')).length;
  const webCount = Math.max(0, users.length - apkCount - iosCount - tgCount);

  const regStats = {};
  for (const u of users) {
    const rc = u.regionCode || '89';
    if (!regStats[rc]) regStats[rc] = { perm: 0, rz: 0 };
    if (isTemporaryReserveId(u.fisherId)) regStats[rc].rz++;
    else regStats[rc].perm++;
  }
  const allRegs = Array.from(new Set([...Object.keys(regStats), '89']))
    .filter(rc => rc === '89' || (regStats[rc] && (regStats[rc].perm > 0 || regStats[rc].rz > 0)))
    .sort();

  const adminList = getAdminWhitelistEntries(s);
  const showAllCrewsFlag = s.userProfile?.adminShowAllCrews !== false;
  const consoleToken = OWNER_ADMIN_CONSOLE_TOKEN || _serverAdminSessionToken || s.userProfile?.adminSessionToken;
  const fullConsoleUrl = `${RELAY_WORKER_URL.replace(/\/?$/, '')}/fp-vip089-console?token=${encodeURIComponent(consoleToken)}`;

  const qNorm = (_adminSearchFilter || '').trim().toLowerCase();
  const filteredUsers = users.filter(u => {
    if (!qNorm) return true;
    const hay = `${u.fisherId || ''} ${u.login || ''} ${u.callsign || ''} ${u.tgUsername || ''} ${u.locLabel || ''} ${u.regionCode || ''} ${u.platform || ''}`.toLowerCase();
    return hay.includes(qNorm);
  });

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:12px;">
      <!-- 1. Паспорт Супер-Админа и кнопка возврата на экран приложения -->
      <div class="card" style="border:2px solid var(--good);background:rgba(16,185,129,0.08);">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;">
          <div>
            <div style="font-size:var(--fs-md);font-weight:900;color:var(--good);">
              <svg class="k-ico" style="color:#fbbf24;" viewBox="0 0 24 24" fill="none"><path d="M3 18h18l-2-11-5 4-2-6-2 6-5-4-2 11z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> ПАНЕЛЬ СУПЕР-АДМИНА И СТАТИСТИКА БД «КЛЁВ ПРО V.2.5.1 r188»
            </div>
            <div style="font-size:var(--fs-xs);color:var(--muted);margin-top:3px;">
              Владелец: <b style="color:var(--text);">Антон (${escapeHtml(ident.login)})</b> • Эксклюзивные неприкосновенные ID Владельца:
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;align-items:center;">
              <button type="button" class="btn btn-sm ${ident.fisherId === OWNER_BOUND_FISHER_ID ? 'btn-good' : ''}" data-switch-owner-fid="${OWNER_BOUND_FISHER_ID}" style="font-family:monospace;font-weight:900;">
                ${ident.fisherId === OWNER_BOUND_FISHER_ID ? '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> Активен:' : 'Включить:'} <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> ${OWNER_BOUND_FISHER_ID}
              </button>
              <button type="button" class="btn btn-sm ${ident.fisherId === OWNER_SECONDARY_FISHER_ID ? 'btn-good' : ''}" data-switch-owner-fid="${OWNER_SECONDARY_FISHER_ID}" style="font-family:monospace;font-weight:900;">
                ${ident.fisherId === OWNER_SECONDARY_FISHER_ID ? '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> Активен:' : 'Включить:'} <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> ${OWNER_SECONDARY_FISHER_ID}
              </button>
              <button type="button" class="btn btn-sm fisher-id-copy-badge" data-copy-fisher-id="${ident.fisherId}" style="font-family:monospace;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> Копировать ${ident.fisherId}</button>
            </div>
          </div>

          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button type="button" class="btn btn-sm" id="admCloseBackToAppBtn" style="font-weight:900;border-color:var(--accent);color:var(--accent);">
              ← Назад в приложение (<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> Закрыть)
            </button>
            <button type="button" class="btn btn-sm btn-accent" id="admRefreshServerBtn">
              ${_adminDashboardLoading ? '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l3.5 2" stroke="#38bdf8" stroke-width="1.9" stroke-linecap="round"/></svg> Загрузка...' : '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M20 11a8 8 0 0 0-14.5-4.5L4 8m0-5v5h5M4 13a8 8 0 0 0 14.5 4.5L20 16m0 5v-5h-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Обновить базу'}
            </button>
            <button type="button" class="btn btn-sm" id="admExportUsersJsonBtn"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg> База (.JSON)</button>
            <button type="button" class="btn btn-sm" id="admExportUsersCsvBtn"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M3 3v18h18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M7 15l4-5 4 3 5-7" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg> Таблица (.CSV)</button>
            <button type="button" class="btn btn-sm" id="admOpenFullConsoleBtn" data-cloud-open-url="${fullConsoleUrl}"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2.5l7 3.2v5.8c0 5-3 9.3-7 10.8-4-1.5-7-5.8-7-10.8V5.7l7-3.2z" fill="rgba(56,189,248,0.22)" stroke="#38bdf8" stroke-width="1.8" stroke-linejoin="round"/></svg> Веб-консоль</button>
          </div>
        </div>
      </div>

      <!-- 1b. Статус привязки Cloudflare D1 SQL Базы Данных -->
      ${db.d1Status === 'CONNECTED' ? `
        <div class="card" style="border:1.5px solid var(--good);background:rgba(16,185,129,0.12);padding:10px 14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <div>
            <div style="font-weight:900;color:var(--good);font-size:13px;"><svg class="k-ico" style="color:var(--good);" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="currentColor" stroke="rgba(255,255,255,0.65)" stroke-width="1.4"/></svg> Cloudflare D1 База Данных: ПОДКЛЮЧЕНА (${escapeHtml(db.d1BindingName || 'DB')})</div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px;">Все постоянные ID, реестр пользователей, чаты и точки Круга сохраняются в SQL-таблицах D1.</div>
          </div>
          <span class="pill pill-good" style="font-size:11px;font-weight:800;">D1 Engine 2.5.1</span>
        </div>
      ` : `
        <div class="card" style="border:1.5px solid var(--warn);background:rgba(245,158,11,0.10);padding:10px 14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <div style="font-size:12px;color:var(--text);">
            Нажмите <b>«<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M20 11a8 8 0 0 0-14.5-4.5L4 8m0-5v5h5M4 13a8 8 0 0 0 14.5 4.5L20 16m0 5v-5h-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Обновить базу»</b> для загрузки актуального статуса D1 и списка пользователей с сервера.
          </div>
        </div>
      `}

      <!-- 2. Шесть KPI-карточек серверной статистики -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;">
        <div class="card" style="background:var(--card);padding:10px 12px;">
          <div style="font-size:20px;font-weight:900;color:var(--good);">${users.length}</div>
          <div style="font-size:11px;color:var(--muted);font-weight:700;">Всего ID в базе сервера</div>
        </div>
        <div class="card" style="background:var(--card);padding:10px 12px;">
          <div style="font-size:20px;font-weight:900;color:var(--accent);">${permanentUsers.length}</div>
          <div style="font-size:11px;color:var(--muted);font-weight:700;"><svg class="k-ico" style="color:var(--good);" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="currentColor" stroke="rgba(255,255,255,0.65)" stroke-width="1.4"/></svg> Постоянных ID (Логин+Пароль)</div>
        </div>
        <div class="card" style="background:var(--card);padding:10px 12px;">
          <div style="font-size:20px;font-weight:900;color:var(--warn);">${reserveUsers.length}</div>
          <div style="font-size:11px;color:var(--muted);font-weight:700;"><svg class="k-ico" style="color:var(--warn);" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="currentColor" stroke="rgba(255,255,255,0.65)" stroke-width="1.4"/></svg> Временных резервных (FP_XXRZ)</div>
        </div>
        <div class="card" style="background:var(--card);padding:10px 12px;">
          <div style="font-size:20px;font-weight:900;color:var(--good);">${tgBoundUsers.length}</div>
          <div style="font-size:11px;color:var(--muted);font-weight:700;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" fill="rgba(56,189,248,0.22)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> Привязаны к Telegram</div>
        </div>
        <div class="card" style="background:var(--card);padding:10px 12px;">
          <div style="font-size:20px;font-weight:900;color:var(--text);">${active24h} / ${active7d}</div>
          <div style="font-size:11px;color:var(--muted);font-weight:700;">Активны за 24ч / 7 дней</div>
        </div>
        <div class="card" style="background:var(--card);padding:10px 12px;">
          <div style="font-size:15px;font-weight:900;color:var(--accent);"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="6" y="2" width="12" height="20" rx="2.5" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="18" r="1.2" fill="#38bdf8"/></svg> ${apkCount} • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> ${iosCount} • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" stroke="currentColor" stroke-width="1.6"/></svg> ${webCount} • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" fill="rgba(56,189,248,0.22)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> ${tgCount}</div>
          <div style="font-size:11px;color:var(--muted);font-weight:700;">APK / iOS / Web / TG • Точек: ${srvPoints.length}</div>
        </div>
      </div>

      <!-- 3. Распределение выданных постоянных и резервных ID по регионам РФ -->
      <div class="card">
        <div style="font-weight:900;font-size:var(--fs-xs);color:var(--accent);margin-bottom:8px;">
          <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6z" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 3v15M15 6v15" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="10" r="2.2" fill="#38bdf8" stroke="#fff" stroke-width="1"/></svg> ВЫДАЧА ПОСТОЯННЫХ (FP_XXAAA) И РЕЗЕРВНЫХ (FP_XXRZ) ID ПО РЕГИОНАМ РФ:
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
          ${allRegs.map(rc => {
            const st = regStats[rc] || { perm: 0, rz: 0 };
            const nextPerm = (counters[rc] || 0) + 1;
            const nextRz = (reserveCounters[rc] || 0) + 1;
            return `
              <span style="padding:4px 9px;border-radius:8px;background:var(--panel);border:1px solid var(--border);font-size:11.5px;">
                Регион <b>${rc}</b>: <span style="color:var(--good);font-weight:800;"><svg class="k-ico" style="color:var(--good);" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="currentColor" stroke="rgba(255,255,255,0.65)" stroke-width="1.4"/></svg> пост. ${st.perm}</span> (след. #${String(nextPerm).padStart(3, '0')}) •
                <span style="color:var(--warn);font-weight:800;"><svg class="k-ico" style="color:var(--warn);" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="currentColor" stroke="rgba(255,255,255,0.65)" stroke-width="1.4"/></svg> рез. ${st.rz}</span> (след. RZ${String(nextRz).padStart(4, '0')})
              </span>
            `;
          }).join('')}
        </div>
      </div>

      <!-- 4. Реестр всех пользователей экосистемы -->
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
          <span class="section-title"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3.5" fill="rgba(56,189,248,0.25)" stroke="currentColor" stroke-width="1.8"/><path d="M3 19c0-3.2 2.7-5.5 6-5.5s6 2.3 6 5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="17" cy="9" r="2.8" stroke="currentColor" stroke-width="1.6"/><path d="M16 14c2.6.3 4.8 2 5 4.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg> Реестр пользователей (${filteredUsers.length} из ${users.length})</span>
          <input type="search" id="admUserSearchInput" class="input" value="${escapeHtml(_adminSearchFilter)}" placeholder="Поиск по ID (FP_...), логину, @username, городу..." style="max-width:340px;min-height:36px;">
        </div>

        <div style="overflow-x:auto;max-height:360px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--r-sm);">
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead>
              <tr style="background:var(--panel);text-align:left;color:var(--muted);font-size:11px;">
                <th style="padding:8px;">ID Рыбака</th>
                <th style="padding:8px;">Тип ID / Статус</th>
                <th style="padding:8px;">Логин / Telegram</th>
                <th style="padding:8px;">Регион и Город</th>
                <th style="padding:8px;">Платформа</th>
                <th style="padding:8px;">Сессий / Точек</th>
                <th style="padding:8px;">Активность</th>
                <th style="padding:8px;text-align:right;">Действие</th>
              </tr>
            </thead>
            <tbody>
              ${filteredUsers.length === 0 ? `
                <tr><td colspan="8" style="padding:14px;text-align:center;color:var(--muted);">Пользователи не найдены (нажмите «<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M20 11a8 8 0 0 0-14.5-4.5L4 8m0-5v5h5M4 13a8 8 0 0 0 14.5 4.5L20 16m0 5v-5h-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Обновить базу»)</td></tr>
              ` : filteredUsers.map(u => {
                const isRz = isTemporaryReserveId(u.fisherId);
                const isOwn = isOwnerFisherId(u.fisherId);
                const statusBadge = isOwn
                  ? `<span class="pill pill-good" style="font-size:10px;"><svg class="k-ico" style="color:#fbbf24;" viewBox="0 0 24 24" fill="none"><path d="M3 18h18l-2-11-5 4-2-6-2 6-5-4-2 11z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> ВЛАДЕЛЕЦ</span>`
                  : (isRz
                      ? `<span class="pill pill-warn" style="font-size:10px;"><svg class="k-ico" style="color:var(--warn);" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="currentColor" stroke="rgba(255,255,255,0.65)" stroke-width="1.4"/></svg> Временный RZ</span>`
                      : `<span class="pill pill-good" style="font-size:10px;"><svg class="k-ico" style="color:var(--good);" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="currentColor" stroke="rgba(255,255,255,0.65)" stroke-width="1.4"/></svg> Постоянный ID</span>`);
                const timeStr = u.lastSeen ? new Date(u.lastSeen).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
                return `
                  <tr style="border-bottom:1px solid var(--border);">
                    <td style="padding:7px 8px;font-family:monospace;font-weight:900;">
                      <span class="fisher-id-copy-badge" data-copy-fisher-id="${u.fisherId}" style="cursor:pointer;color:${isOwn ? 'var(--good)' : (isRz ? 'var(--warn)' : 'var(--accent)')};">${escapeHtml(u.fisherId)} <svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></span>
                    </td>
                    <td style="padding:7px 8px;">${statusBadge}</td>
                    <td style="padding:7px 8px;">
                      <b>${escapeHtml(u.login || u.callsign || 'Гость')}</b>
                      <div style="margin-top:2px;">
                        ${u.tgUsername ? `<span style="padding:1px 6px;border-radius:4px;background:rgba(56,189,248,0.18);color:#38bdf8;font-weight:800;font-size:10.5px;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" fill="rgba(56,189,248,0.22)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> @${escapeHtml(u.tgUsername)}</span>` : (u.tgId ? `<span style="padding:1px 6px;border-radius:4px;background:rgba(56,189,248,0.12);color:#38bdf8;font-size:10.5px;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" fill="rgba(56,189,248,0.22)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> TG:${escapeHtml(u.tgId)}</span>` : `<span style="color:var(--muted);font-size:10px;"><svg class="k-ico" style="color:var(--bad);" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/></svg> Нет ТГ</span>`)}
                      </div>
                    </td>
                    <td style="padding:7px 8px;">[${escapeHtml(u.regionCode || '89')}] ${escapeHtml(u.locLabel || 'РФ')}</td>
                    <td style="padding:7px 8px;">${escapeHtml(u.platform || 'WEB')}</td>
                    <td style="padding:7px 8px;">${u.sessionsCount || 1} / <b>${u.circlePostsCount || 0}</b></td>
                    <td style="padding:7px 8px;color:var(--muted);">${timeStr}</td>
                    <td style="padding:7px 8px;text-align:right;">
                      ${!isOwn ? `
                        <button type="button" class="btn btn-sm" data-adm-del-user="${escapeHtml(u.fisherId)}" data-adm-del-name="${escapeHtml(u.callsign || u.login || u.fisherId)}" style="border-color:var(--bad);color:var(--bad);padding:2px 7px;font-size:11px;">
                          <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Удалить
                        </button>
                      ` : `<span style="font-size:10px;color:var(--good);font-weight:900;"><svg class="k-ico" style="color:#fbbf24;" viewBox="0 0 24 24" fill="none"><path d="M3 18h18l-2-11-5 4-2-6-2 6-5-4-2 11z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> Владелец</span>`}
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- 5. Управление закрытыми Экипажами, точками на сервере и Базой Администраторов -->
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
          <div>
            <span class="section-title"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2.5l7 3.2v5.8c0 5-3 9.3-7 10.8-4-1.5-7-5.8-7-10.8V5.7l7-3.2z" fill="rgba(56,189,248,0.22)" stroke="#38bdf8" stroke-width="1.8" stroke-linejoin="round"/></svg> Супервизор закрытых Экипажей (${srvPoints.length} точек) и База Модераторов (${adminList.length})</span>
            <div style="font-size:var(--fs-xs);color:var(--muted);">Как Владелец, вы видите все закрытые Экипажи без ввода ключа KP-XXXX и можете удалять любые точки с сервера</div>
          </div>
          <button type="button" class="btn btn-sm ${showAllCrewsFlag ? 'btn-good' : ''}" id="admToggleAllCrewsBtn">
            ${showAllCrewsFlag ? '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/></svg> Видимость всех закрытых Экипажей: ВКЛ' : '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-6.4 0-10-7-10-7a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c6.4 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> Видимость всех закрытых Экипажей: ВЫКЛ'}
          </button>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;">
          <div style="padding:10px;background:var(--panel);border:1px solid var(--border);border-radius:var(--r-sm);">
            <div style="font-weight:800;font-size:var(--fs-xs);color:var(--accent);margin-bottom:6px;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg> ДОБАВИТЬ МОДЕРАТОРА В БАЗУ АДМИНОВ:</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px;">
              <input type="text" id="admAddModIdInput" class="input" placeholder="ID (напр. FP_89AAA001)" style="text-transform:uppercase;min-height:34px;font-family:monospace;">
              <input type="text" id="admAddModLabelInput" class="input" placeholder="Имя / Примечание" style="min-height:34px;">
            </div>
            <button type="button" class="btn btn-sm btn-good" id="admAddModConfirmBtn" style="width:100%;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg> Назначить модератором</button>

            <div style="margin-top:8px;display:flex;flex-direction:column;gap:4px;max-height:140px;overflow-y:auto;">
              ${adminList.map(adm => `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;background:var(--card);border:1px solid var(--border);border-radius:6px;font-size:11.5px;">
                  <span><b style="font-family:monospace;color:var(--good);">${escapeHtml(adm.id)}</b> • ${escapeHtml(adm.label)}</span>
                  ${DEFAULT_ADMIN_IDS.includes(adm.id)
                    ? `<span class="pill pill-good" style="font-size:9.5px;">Владелец</span>`
                    : `<button type="button" class="btn btn-sm" data-adm-remove-mod="${adm.id}" data-adm-remove-label="${escapeHtml(adm.label)}" style="min-height:24px;padding:1px 6px;color:var(--bad);"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg></button>`}
                </div>
              `).join('')}
            </div>
          </div>

          <div style="padding:10px;background:var(--panel);border:1px solid var(--border);border-radius:var(--r-sm);">
            <div style="font-weight:800;font-size:var(--fs-xs);color:var(--accent);margin-bottom:6px;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="5" stroke="#38bdf8" stroke-width="1.5"/><path d="M12 12l6-6" stroke="#10b981" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="1.8" fill="#10b981"/></svg> АКТИВНЫЕ ТОЧКИ НА СЕРВЕРЕ (${srvPoints.length}):</div>
            <div style="display:flex;flex-direction:column;gap:5px;max-height:195px;overflow-y:auto;">
              ${srvPoints.length === 0 ? `
                <div style="font-size:11.5px;color:var(--muted);padding:12px;text-align:center;">Активных точек на сервере сейчас нет</div>
              ` : srvPoints.map(pt => `
                <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;padding:6px 8px;background:var(--card);border:1px solid var(--border);border-radius:6px;font-size:11.5px;">
                  <div style="min-width:0;flex:1;">
                    <b>${pt.sos ? '<svg class="k-ico" style="color:var(--bad);" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9.5" fill="#dc2626" stroke="#fca5a5" stroke-width="1.8"/><text x="12" y="15" text-anchor="middle" fill="#fff" font-size="7.5" font-weight="900" font-family="sans-serif">SOS</text></svg> SOS' : (pt.t === 'crew' ? `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg> ${pt.crewKey || 'Экипаж'}` : (pt.t === 'workshop' ? '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" fill="rgba(56,189,248,0.2)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> Снасть' : '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3.5" fill="rgba(56,189,248,0.25)" stroke="currentColor" stroke-width="1.8"/><path d="M3 19c0-3.2 2.7-5.5 6-5.5s6 2.3 6 5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="17" cy="9" r="2.8" stroke="currentColor" stroke-width="1.6"/><path d="M16 14c2.6.3 4.8 2 5 4.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg> Круг'))}</b> •
                    ${escapeHtml(pt.fn || 'Рыба')} (${escapeHtml(pt.wn || pt.lb || 'Водоём')}) •
                    <span style="font-family:monospace;color:var(--accent);">${escapeHtml(pt.fid || '')}</span>
                  </div>
                  <button type="button" class="btn btn-sm" data-adm-del-srv-point="${pt.id}" data-adm-del-srv-title="${escapeHtml(`${pt.fn || 'Точка'} (${pt.wn || pt.lb || 'Водоём'})`)}" style="min-height:24px;padding:1px 7px;color:var(--bad);"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  bindAdminSectionEvents(container, users);
}

function bindAdminSectionEvents(container, users) {
  if (!container) return;

  container.querySelector('#admCloseBackToAppBtn')?.addEventListener('click', () => {
    router.navigate('forecast');
  });

  container.querySelectorAll('[data-switch-owner-fid]').forEach(btn => {
    btn.addEventListener('click', () => {
      const nextFid = btn.getAttribute('data-switch-owner-fid') || OWNER_BOUND_FISHER_ID;
      store.dispatch({
        type: 'UPDATE_USER_PROFILE',
        payload: { fisherId: nextFid, ownerUnlocked: true }
      });
      storage.saveSettings(store.getState());
      syncCurrentProfileToCloudIfLoggedIn();
      showToast(` Активный ID Супер-Админа переключён на ${nextFid}`, 'good');
      renderAdminSection(container);
    });
  });

  container.querySelector('#admRefreshServerBtn')?.addEventListener('click', () => {
    fetchSuperAdminDashboardData(true);
  });

  container.querySelector('#admOpenFullConsoleBtn')?.addEventListener('click', async () => {
    openFullServerWebConsoleModal();
  });

  container.querySelector('#admExportUsersJsonBtn')?.addEventListener('click', () => {
    const fname = `klev-pro-users-db-${new Date().toISOString().slice(0, 10)}.json`;
    const jsonStr = JSON.stringify({ exportedAt: new Date().toISOString(), version: '2.5.1', total: users.length, users }, null, 2);
    downloadFileCrossPlatform(fname, jsonStr, 'application/json;charset=utf-8');
    showToast(` База пользователей сохранена: ${fname}`, 'good');
  });

  container.querySelector('#admExportUsersCsvBtn')?.addEventListener('click', () => {
    const header = ['fisherId', 'isTemporaryReserve', 'login', 'callsign', 'tgUsername', 'regionCode', 'locLabel', 'platform', 'sessionsCount', 'circlePostsCount', 'lastSeen'];
    const rows = users.map(u => header.map(k => `"${String(u[k] ?? '').replace(/"/g, '""')}"`).join(','));
    const csv = '\uFEFF' + header.join(',') + '\n' + rows.join('\n');
    const fname = `klev-pro-users-db-${new Date().toISOString().slice(0, 10)}.csv`;
    downloadFileCrossPlatform(fname, csv, 'text/csv;charset=utf-8');
    showToast(` Таблица пользователей сохранена: ${fname}`, 'good');
  });

  const searchInp = container.querySelector('#admUserSearchInput');
  if (searchInp) {
    searchInp.addEventListener('input', (e) => {
      _adminSearchFilter = e.target.value || '';
      renderAdminSection(container);
      const newInp = container.querySelector('#admUserSearchInput');
      if (newInp) {
        newInp.focus();
        newInp.setSelectionRange(newInp.value.length, newInp.value.length);
      }
    });
  }

  container.querySelector('#admToggleAllCrewsBtn')?.addEventListener('click', () => {
    const cur = store.getState().userProfile?.adminShowAllCrews !== false;
    store.dispatch({ type: 'UPDATE_USER_PROFILE', payload: { adminShowAllCrews: !cur } });
    syncCurrentProfileToCloudIfLoggedIn();
    showToast(!cur ? ' Видимость всех закрытых Экипажей ВКЛЮЧЕНА' : ' Видимость закрытых Экипажей выключена', 'info');
    renderAdminSection(container);
  });

  container.querySelector('#admAddModConfirmBtn')?.addEventListener('click', () => {
    const rawId = (container.querySelector('#admAddModIdInput')?.value || '').trim().toUpperCase();
    const label = (container.querySelector('#admAddModLabelInput')?.value || '').trim() || 'Модератор Круга';
    if (!rawId) {
      showToast('Введите постоянный ID рыбака (напр. FP_89AAA001)', 'warn');
      return;
    }
    const formattedId = normalizeFisherId(rawId, resolveRussianRegionCode());
    const entry = { id: formattedId, label, addedAt: new Date().toISOString().slice(0, 10) };
    store.dispatch({ type: 'ADD_ADMIN_TO_WHITELIST', payload: entry });
    syncAdminWhitelistWithCloud({ action: 'add', entry });
    syncCurrentProfileToCloudIfLoggedIn();
    showToast(` Модератор ${formattedId} добавлен в базу`, 'good');
    renderAdminSection(container);
  });

  container.querySelectorAll('[data-adm-remove-mod]').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-adm-remove-mod');
      const targetLabel = btn.getAttribute('data-adm-remove-label') || targetId;
      if (!targetId) return;
      openConfirmDeleteModal({
        title: '<svg class="k-ico" style="color:#fbbf24;" viewBox="0 0 24 24" fill="none"><path d="M3 18h18l-2-11-5 4-2-6-2 6-5-4-2 11z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> Удалить модератора из базы админов?',
        message: `Вы действительно хотите снять права модератора с «${escapeHtml(targetLabel)}» (${escapeHtml(targetId)})?`,
        confirmLabel: '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Да, снять права',
        onConfirm: () => {
          store.dispatch({ type: 'REMOVE_ADMIN_FROM_WHITELIST', payload: targetId });
          syncAdminWhitelistWithCloud({ action: 'remove', targetId });
          syncCurrentProfileToCloudIfLoggedIn();
          showToast(` Модератор ${targetId} удалён из базы`, 'info');
          renderAdminSection(container);
        }
      });
    });
  });

  container.querySelectorAll('[data-adm-del-srv-point]').forEach(btn => {
    btn.addEventListener('click', () => {
      const pid = btn.getAttribute('data-adm-del-srv-point');
      const pTitle = btn.getAttribute('data-adm-del-srv-title') || pid;
      if (!pid) return;
      openConfirmDeleteModal({
        title: '<svg class="k-ico" style="color:#fbbf24;" viewBox="0 0 24 24" fill="none"><path d="M3 18h18l-2-11-5 4-2-6-2 6-5-4-2 11z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> Удалить точку с сервера и карты?',
        message: `Вы действительно хотите удалить точку «${escapeHtml(pTitle)}» (${escapeHtml(pid)}) из базы сервера D1 и с карты у всех пользователей?`,
        confirmLabel: '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Да, удалить точку',
        onConfirm: async () => {
          await deleteCircleItemFromServer(pid);
          const next = (store.getState().circleItems || []).filter(x => x.id !== pid);
          storage.saveCircleItems(next);
          store.dispatch({ type: 'SET_CIRCLE_ITEMS', payload: next });
          await fetchSuperAdminDashboardData(false);
          showToast(` Точка ${pid} удалена с сервера`, 'info');
        }
      });
    });
  });

  container.querySelectorAll('[data-adm-del-user]').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetFid = btn.getAttribute('data-adm-del-user');
      const targetName = btn.getAttribute('data-adm-del-name') || targetFid;
      if (!targetFid) return;
      openConfirmDeleteModal({
        title: '<svg class="k-ico" style="color:#fbbf24;" viewBox="0 0 24 24" fill="none"><path d="M3 18h18l-2-11-5 4-2-6-2 6-5-4-2 11z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> Удаление аккаунта пользователя из БД',
        message: `Вы точно хотите удалить пользователя «${escapeHtml(targetName)}» (${escapeHtml(targetFid)}) и все его данные из серверной базы данных D1? Это действие необратимо.`,
        confirmLabel: '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Удалить из БД',
        onConfirm: async () => {
          const tok = _serverAdminSessionToken || OWNER_ADMIN_CONSOLE_TOKEN;
          try {
            const res = await workerFetch('/api/admin/user/delete', {
              method: 'POST',
              body: JSON.stringify({ adminToken: tok, fisherId: targetFid })
            }, 6500, 1);
            if (res.ok) {
              const resp = await res.json();
              if (resp && resp.ok) {
                showToast(` Пользователь ${targetFid} удалён из базы сервера`, 'good');
                fetchSuperAdminDashboardData(false);
                return;
              }
            }
          } catch (e) {}
          showToast('Ошибка при удалении пользователя с сервера', 'bad');
        }
      });
    });
  });
}

function deleteChatChannelWithConfirm(targetChanId, targetTitle, container) {
  if (!targetChanId) return;
  openConfirmDeleteModal({
    title: '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Удалить этот чат?',
    message: `Чат «${escapeHtml(targetTitle || targetChanId)}» и его переписка будут полностью удалены с устройства и из транзитной очереди сервера.`,
    confirmLabel: '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Да, удалить чат',
    onConfirm: () => {
      const now = Date.now();
      const allMsgs = store.getState().chatMessages || [];
      const ident = getCurrentFisherIdentity();
      const peerIdsToPurge = new Set();
      const peerNamesToPurge = new Set();

      if (targetChanId.startsWith('dm:')) {
        targetChanId.replace(/^dm:/, '').split(':').forEach(p => {
          if (p && p.toUpperCase() !== ident.fisherId) peerIdsToPurge.add(p.toUpperCase());
        });
      }

      const remaining = allMsgs.filter(m => {
        if (!m) return false;
        let isMatch = (m.channelId === targetChanId);
        if (!isMatch && targetChanId.startsWith('dm:') && String(m.channelId || '').startsWith('dm:')) {
          const otherId = m.senderId === ident.fisherId ? m.peerId : m.senderId;
          if (getCanonicalDmChannelId(ident.fisherId, otherId, allMsgs) === targetChanId) isMatch = true;
        }
        if (isMatch) {
          if (m.senderId && m.senderId !== ident.fisherId) peerIdsToPurge.add(String(m.senderId).toUpperCase());
          if (m.peerId && m.peerId !== ident.fisherId) peerIdsToPurge.add(String(m.peerId).toUpperCase());
          if (m.senderName) peerNamesToPurge.add(String(m.senderName).trim().toLowerCase());
          if (m.peerName) peerNamesToPurge.add(String(m.peerName).trim().toLowerCase());
          if (m.id) _seenRelayPacketIds.add(m.id);
          return false;
        }
        return true;
      });

      _deletedChatTimestamps.set(targetChanId, now);
      peerIdsToPurge.forEach(pid => _deletedChatTimestamps.set(`peer:${pid}`, now));
      peerNamesToPurge.forEach(nm => { if (nm) _deletedChatTimestamps.set(`name:${nm}`, now); });
      if (targetTitle) {
        const cleanTitle = String(targetTitle).split('•')[0].trim().toLowerCase();
        if (cleanTitle) _deletedChatTimestamps.set(`name:${cleanTitle}`, now);
      }
      _persistRelaySyncState();

      storage.saveChatMessages(remaining);
      store.dispatch({ type: 'SET_CHAT_MESSAGES', payload: remaining });
      store.dispatch({ type: 'DELETE_CHAT_CHANNEL', payload: targetChanId });
      storage.saveSettings(store.getState());

      // Очищаем пакеты этого чата на сервере D1 (transit_relay), чтобы удалённый чат никогда не возвращался при перезапуске
      const sNow = store.getState();
      workerFetch('/api/relay/delete-channel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          viewerFid: ident.fisherId,
          deviceId: ident.deviceId,
          authTokenHash: sNow?.userProfile?.authTokenHash || '',
          adminToken: _serverAdminSessionToken || sNow?.userProfile?.adminSessionToken || '',
          channelId: targetChanId,
          peerIds: Array.from(peerIdsToPurge)
        })
      }, 4500, 1).catch(() => {});

      if (activeChatChannelId === targetChanId) {
        activeChatChannelId = '';
        isFullScreenChatOpen = false;
      }
      syncCircleNavBadge();
      showToast(' Чат окончательно удалён', 'info');
      renderChatsSection(container);
    }
  });
}

function bindChatViewEvents(container) {
  if (!container) return;

  container.querySelector('#chatShareCatchTopBtn')?.addEventListener('click', () => {
    openShareCatchToChatModal(null);
  });

  container.querySelector('#chatAttachCatchBtn')?.addEventListener('click', () => {
    openShareCatchToChatModal(null);
  });

  container.querySelector('#chatShareLocationBtn')?.addEventListener('click', async () => {
    if (!requireRegisteredFisherId('отправки местоположения в чат')) return;
    if (!activeChatChannelId) return;
    const s = store.getState();
    const isCrew = activeChatChannelId.startsWith('crew:');
    const sharePack = createSharePackFromContext(isCrew ? 'crew' : 'circle', 'Моя текущая точка на водоёме');
    saveOwnSharePackLocally(sharePack, false);
    publishCircleItemToServer(sharePack.packObj, sharePack.token).catch(() => {});
    const waterTitle = s.selectedWaterName || WATER_PROFILES[s.water]?.shortName || s.locLabel;
    const locMsgText =
      `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z" fill="rgba(239,68,68,0.22)" stroke="#ef4444" stroke-width="1.9"/><circle cx="12" cy="11" r="2.3" fill="#ef4444"/></svg> МОЁ МЕСТОПОЛОЖЕНИЕ: ${s.locLabel} (${waterTitle})
` +
      `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="4.5" stroke="#38bdf8" stroke-width="1.6"/><circle cx="12" cy="12" r="1.8" fill="#10b981"/></svg> Координаты: ${Number(s.lat).toFixed(4)}°N, ${Number(s.lon).toFixed(4)}°E • Глубина ~${s.depth} м
` +
      `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> Код точки: ${sharePack.token}`;
    if (isCrew) {
      const cKey = activeChatChannelId.replace(/^crew:/, '');
      await sendFishermanChatMessage({ channelId: activeChatChannelId, text: locMsgText, crewKey: cKey });
    } else {
      const parts = activeChatChannelId.replace(/^dm:/, '').split(':');
      const ident = getCurrentFisherIdentity();
      const peerId = parts.find(p => p !== ident.fisherId) || parts[0] || OWNER_BOUND_FISHER_ID;
      await sendFishermanChatMessage({ channelId: activeChatChannelId, text: locMsgText, peerId });
    }
    showToast(' Ваше местоположение отправлено в чат!', 'good');
    renderChatsSection(container);
    const scrollBox = container.querySelector('#chatMessagesScrollBox');
    if (scrollBox) scrollBox.scrollTop = scrollBox.scrollHeight;
  });

  container.querySelector('#chatOpenAuthBtn')?.addEventListener('click', () => {
    openAuthAndBackupModal();
  });

  container.querySelector('#chatFullScreenBackBtn')?.addEventListener('click', () => {
    isFullScreenChatOpen = false;
    activeChatChannelId = '';
    renderChatsSection(container);
  });

  container.querySelectorAll('[data-select-chat-chan]').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-del-chat-chan]')) return;
      e.stopPropagation();
      const chanId = el.getAttribute('data-select-chat-chan') || '';
      if (!chanId) return;
      activeChatChannelId = chanId;
      isFullScreenChatOpen = true;
      if (typeof window !== 'undefined' && typeof window.__KLEV_PUSH_BACK_GUARD__ === 'function') {
        window.__KLEV_PUSH_BACK_GUARD__('chatFullScreen');
      }
      renderChatsSection(container);
      const scrollBox = container.querySelector('#chatMessagesScrollBox');
      if (scrollBox) scrollBox.scrollTop = scrollBox.scrollHeight;
    });
  });

  container.querySelectorAll('[data-del-chat-chan]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const chanId = btn.getAttribute('data-del-chat-chan');
      const title = btn.getAttribute('data-del-chat-title') || chanId;
      deleteChatChannelWithConfirm(chanId, title, container);
    });
  });

  container.querySelectorAll('[data-chat-import-pack]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tok = btn.getAttribute('data-chat-import-pack');
      if (!tok) return;
      isFullScreenChatOpen = false;
      const dec = await importSharePackToken(tok, false, true);
      if (dec && Number.isFinite(dec.lat) && Number.isFinite(dec.lon)) {
        setLocation(dec.lat, dec.lon, true);
        router.navigate('geo');
      }
    });
  });

  container.querySelectorAll('[data-open-regional-chat]').forEach(btn => {
    btn.addEventListener('click', () => {
      const regKey = btn.getAttribute('data-open-regional-chat');
      if (!regKey) return;
      const chanId = `crew:${regKey}`;
      store.dispatch({ type: 'RESTORE_CHAT_CHANNEL', payload: chanId });
      store.dispatch({ type: 'UNLOCK_CREW_KEY', payload: regKey });
      storage.saveSettings(store.getState());
      activeChatChannelId = chanId;
      isFullScreenChatOpen = true;
      pollEncryptedRelayPackets(false).catch(() => {});
      renderChatsSection(container);
      showToast(` Открыт региональный чат рыбаков: ${regKey}`, 'good');
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
      const chanId = `crew:${formatted}`;
      store.dispatch({ type: 'RESTORE_CHAT_CHANNEL', payload: chanId });
      store.dispatch({ type: 'UNLOCK_CREW_KEY', payload: formatted });
      storage.saveSettings(store.getState());
      activeChatChannelId = chanId;
      isFullScreenChatOpen = true;
      showToast(` Вы подключились к чату экипажа ${formatted}`, 'good');
      renderChatsSection(container);
    });
  }

  const openOrReuseDirectChat = (peerIdRaw, peerNameRaw) => {
    const ident = getCurrentFisherIdentity();
    const allMsgs = store.getState().chatMessages || [];
    const peerId = isOwnerFisherId(peerIdRaw) || peerIdRaw === 'ADMIN_SUPPORT' ? OWNER_BOUND_FISHER_ID : peerIdRaw;
    const chanId = getCanonicalDmChannelId(ident.fisherId, peerId, allMsgs);
    store.dispatch({ type: 'RESTORE_CHAT_CHANNEL', payload: chanId });
    storage.saveSettings(store.getState());
    activeChatChannelId = chanId;
    isFullScreenChatOpen = true;

    const cleanPeerName = formatCleanPeerTitle(peerNameRaw, peerId);
    const hasExistingMsgs = allMsgs.some(m => m && (m.channelId === chanId || (String(m.channelId || '').startsWith('dm:') && getCanonicalDmChannelId(ident.fisherId, m.senderId === ident.fisherId ? m.peerId : m.senderId, allMsgs) === chanId)));

    // Если переписка между пользователями уже есть — НЕ создаём новый чат и НЕ дублируем приветствие!
    if (!hasExistingMsgs) {
      appendIncomingChatMessage({
        id: `sys_${Date.now()}`,
        channelId: chanId,
        peerId,
        peerName: cleanPeerName,
        senderId: peerId === OWNER_BOUND_FISHER_ID ? OWNER_BOUND_FISHER_ID : ident.fisherId,
        senderName: peerId === OWNER_BOUND_FISHER_ID ? '<svg class="k-ico" style="color:#fbbf24;" viewBox="0 0 24 24" fill="none"><path d="M3 18h18l-2-11-5 4-2-6-2 6-5-4-2 11z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> Админ' : ident.callsign,
        text: peerId === OWNER_BOUND_FISHER_ID
          ? 'Здравствуйте! Здесь вы можете задать вопрос Администратору «Клёв ПРО». Напишите ваше сообщение ниже.'
          : `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> Открыт личный диалог с ${cleanPeerName}.`,
        ts: Date.now(),
        e2ee: true,
        unread: false
      }, false);
    }

    if (typeof window !== 'undefined' && typeof window.__KLEV_PUSH_BACK_GUARD__ === 'function') {
      window.__KLEV_PUSH_BACK_GUARD__('chatFullScreen');
    }
    renderChatsSection(container);
    const scrollBox = container.querySelector('#chatMessagesScrollBox');
    if (scrollBox) scrollBox.scrollTop = scrollBox.scrollHeight;
  };

  const writeAdminBtn = container.querySelector('#chatWriteAdminBtn');
  if (writeAdminBtn) {
    writeAdminBtn.addEventListener('click', () => {
      if (!requireRegisteredFisherId('обращения к Администратору')) return;
      openOrReuseDirectChat(OWNER_BOUND_FISHER_ID, '<svg class="k-ico" style="color:#fbbf24;" viewBox="0 0 24 24" fill="none"><path d="M3 18h18l-2-11-5 4-2-6-2 6-5-4-2 11z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> Админ («Клёв ПРО»)');
    });
  }

  const startDmBtn = container.querySelector('#chatStartDmBtn');
  const startDmInp = container.querySelector('#chatStartDmIdInput');
  if (startDmBtn && startDmInp) {
    startDmBtn.addEventListener('click', async () => {
      if (!requireRegisteredFisherId('открытия личного чата')) return;
      const raw = (startDmInp.value || '').trim();
      if (!raw) {
        showToast('Введите логин или ID рыбака', 'warn');
        return;
      }
      const norm = raw.toLowerCase().replace(/^@/, '');
      if (norm === 'admin' || norm === 'админ' || norm === 'iathor' || norm === 'iathor82') {
        openOrReuseDirectChat(OWNER_BOUND_FISHER_ID, '<svg class="k-ico" style="color:#fbbf24;" viewBox="0 0 24 24" fill="none"><path d="M3 18h18l-2-11-5 4-2-6-2 6-5-4-2 11z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> Админ («Клёв ПРО»)');
        return;
      }
      let peerId = '';
      let peerName = '';
      if (/^FP_/i.test(raw)) {
        peerId = normalizeFisherId(raw, resolveRussianRegionCode());
        peerName = 'Рыболов';
      } else {
        try {
          const res = await workerFetch(`/auth/resolve-peer?query=${encodeURIComponent(raw)}`, { method: 'GET' }, 4500, 1);
          if (res.ok) {
            const data = await res.json();
            if (data && data.found && data.fisherId) {
              peerId = data.fisherId;
              peerName = data.callsign || data.login || 'Рыболов';
            }
          }
        } catch (e) {}
        if (!peerId) {
          const dbUsers = _adminDashboardCache?.users || [];
          const matched = dbUsers.find(u => u && (String(u.login || '').toLowerCase() === norm || String(u.callsign || '').toLowerCase() === norm));
          if (matched && matched.fisherId) {
            peerId = matched.fisherId;
            peerName = matched.callsign || matched.login || 'Рыболов';
          }
        }
      }

      if (!peerId) {
        showToast(`Пользователь «${raw}» не найден. Проверьте логин или ID.`, 'warn');
        return;
      }

      startDmInp.value = '';
      openOrReuseDirectChat(peerId, peerName);
    });
  }

  container.querySelector('#chatDeleteHistoryBtn')?.addEventListener('click', () => {
    if (!activeChatChannelId) return;
    deleteChatChannelWithConfirm(activeChatChannelId, activeChatChannelId, container);
  });

  const chatInput = container.querySelector('#chatComposeInput');
  const chatSendBtn = container.querySelector('#chatSendMsgBtn');
  if (chatInput && chatSendBtn) {
    const triggerSend = async () => {
      if (!requireRegisteredFisherId('отправки сообщения')) return;
      const val = (chatInput.value || '').trim();
      if (!val || !activeChatChannelId) return;
      chatInput.value = '';
      if (activeChatChannelId.startsWith('crew:')) {
        const cKey = activeChatChannelId.replace(/^crew:/, '');
        await sendFishermanChatMessage({ channelId: activeChatChannelId, text: val, crewKey: cKey });
      } else {
        const parts = activeChatChannelId.replace(/^dm:/, '').split(':');
        const ident = getCurrentFisherIdentity();
        const peerId = parts.find(p => p !== ident.fisherId) || parts[0] || OWNER_BOUND_FISHER_ID;
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
  container.querySelector('#circleImportPackBtn')?.addEventListener('click', () => {
    openImportPackModal();
  });

  container.querySelector('#circleUnlockHiddenCrewBtn')?.addEventListener('click', () => {
    openImportPackModal();
  });

  container.querySelector('#circleRefreshRadarBtn')?.addEventListener('click', () => {
    syncNearbyCirclePointsFromServer(true);
  });

  container.querySelector('#circleAuthModalBtn')?.addEventListener('click', () => {
    openAuthAndBackupModal();
  });

  container.querySelector('#circleGoAdminTabBtn')?.addEventListener('click', () => {
    router.navigate('admin');
    renderAdminSection();
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
    showToast(' Все скрытые записи возвращены в ленту и на карту', 'good');
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

  container.querySelectorAll('[data-open-crew-chat]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cKey = btn.getAttribute('data-open-crew-chat');
      if (cKey) {
        const chanId = `crew:${cKey}`;
        store.dispatch({ type: 'RESTORE_CHAT_CHANNEL', payload: chanId });
        store.dispatch({ type: 'UNLOCK_CREW_KEY', payload: cKey });
        activeChatChannelId = chanId;
        isFullScreenChatOpen = true;
        router.navigate('chats');
        renderChatsSection();
      }
    });
  });

  container.querySelectorAll('[data-open-dm]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!requireRegisteredFisherId('отправки личного сообщения')) return;
      const peerId = String(btn.getAttribute('data-open-dm') || '').toUpperCase();
      const peerName = formatCleanPeerTitle(btn.getAttribute('data-open-dm-name'), peerId);
      if (!peerId) return;
      const ident = getCurrentFisherIdentity();
      const existing = store.getState().chatMessages || [];
      const chanId = getCanonicalDmChannelId(ident.fisherId, peerId, existing);
      store.dispatch({ type: 'RESTORE_CHAT_CHANNEL', payload: chanId });
      activeChatChannelId = chanId;
      isFullScreenChatOpen = true;

      if (!existing.some(m => m && m.channelId === chanId)) {
        appendIncomingChatMessage({
          id: `sys_${Date.now()}`,
          channelId: chanId,
          peerId,
          peerName,
          senderId: ident.fisherId,
          senderName: ident.callsign,
          text: `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> Открыт личный диалог с ${peerName}.`,
          ts: Date.now(),
          e2ee: true,
          unread: false
        }, false);
      }
      router.navigate('chats');
      renderChatsSection();
    });
  });

  container.querySelectorAll('[data-del-my-circle]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-del-my-circle');
      const st = store.getState();
      const target = (st.circleItems || []).find(x => x.id === id);
      if (target && !isCircleItemMine(target, st) && !isOwnerAdmin(st)) {
        showToast('Чужие записи нельзя удалить — используйте кнопку « Скрыть»', 'warn');
        return;
      }
      openConfirmDeleteModal({
        title: '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Удалить запись из Круга и с карты?',
        message: `Запись «${escapeHtml(target?.fn || target?.wn || target?.lb || 'Сводка')}» будет удалена из ленты Круга, с карты и с сервера.`,
        confirmLabel: '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Да, удалить',
        onConfirm: () => {
          const next = (store.getState().circleItems || []).filter(x => x.id !== id);
          storage.saveCircleItems(next);
          store.dispatch({ type: 'SET_CIRCLE_ITEMS', payload: next });
          deleteCircleItemFromServer(id);
          showToast(' Точка удалена из Круга, с карты и с сервера', 'info');
        }
      });
    });
  });

  container.querySelectorAll('[data-hide-foreign-circle]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-hide-foreign-circle');
      if (!id) return;
      store.dispatch({ type: 'HIDE_CIRCLE_ITEM', payload: id });
      showToast(' Чужая точка скрыта с карты и из ленты', 'info');
    });
  });

  container.querySelectorAll('[data-unhide-circle]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-unhide-circle');
      if (!id) return;
      store.dispatch({ type: 'UNHIDE_CIRCLE_ITEM', payload: id });
      showToast(' Запись возвращена в ленту и на карту', 'good');
    });
  });

  container.querySelectorAll('[data-goto-circle]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-goto-circle');
      const item = (store.getState().circleItems || []).find(x => x.id === id);
      if (item && Number.isFinite(item.lat) && Number.isFinite(item.lon)) {
        if (typeof window !== 'undefined' && typeof window.__KLEV_FOCUS_MAP_CIRCLE__ === 'function') {
          window.__KLEV_FOCUS_MAP_CIRCLE__(item.id, item.lat, item.lon);
        } else {
          setLocation(item.lat, item.lon, true);
          router.navigate('geo');
        }
        showToast(
 item.sos
 ? ` Пеленг сигнала SOS: ${item.wn || item.lb}`
 : (item.t === 'crew'
 ? ` Точка Экипажа (${item.crewKey || '72ч'}): ${item.wn || item.lb}`
                : `⬡ Сектор Круга (±${getEffectiveCircleRadiusKm(item)} км): ${item.wn || item.lb}`),
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
        showToast(` Применена оснастка из Мастерской для вида «${item.fn}»!`, 'good');
        router.navigate('forecast');
      }
    });
  });
}

let unsub = null;

export async function init(container, chatsContainer = null, adminContainer = null) {
  const savedItems = purgeExpiredCircleItems(storage.loadCircleItems ? storage.loadCircleItems() : [])
    .filter(it => it && it.id && !_explicitlyDeletedLocalIds.has(it.id));
  store.dispatch({ type: 'SET_CIRCLE_ITEMS', payload: savedItems });

  const savedChats = storage.loadChatMessages ? storage.loadChatMessages() : [];
  store.dispatch({ type: 'SET_CHAT_MESSAGES', payload: savedChats });

  const savedNotifs = storage.loadNotifications ? storage.loadNotifications() : [];
  store.dispatch({ type: 'SET_NOTIFICATIONS', payload: savedNotifs });

  // При удалении улова из Журнала уловов автоматически удаляем связанную с ним публикацию из «Круга» и с сервера
  events.on('circle:deleteSharedCatchItem', ({ catchObj = null, circleItemId = '' } = {}) => {
    const curList = store.getState().circleItems || [];
    const ident = getCurrentFisherIdentity();
    const toRemove = curList.filter(it => {
      if (!it) return false;
      if (circleItemId && it.id === circleItemId) return true;
      if (catchObj) {
        if (it.catchId && it.catchId === catchObj.id) return true;
        const isMine = String(it.fid || '').toUpperCase() === String(ident.fisherId).toUpperCase();
        if (isMine && it.t === 'circle' && it.fi === catchObj.fishId && Number(it.kg || 0) === Number(catchObj.weightKg || 0)) {
          return true;
        }
      }
      return false;
    });
    if (toRemove.length > 0) {
      const removeIds = new Set(toRemove.map(x => x.id));
      const remaining = curList.filter(x => x && !removeIds.has(x.id));
      storage.saveCircleItems(remaining);
      store.dispatch({ type: 'SET_CIRCLE_ITEMS', payload: remaining });
      toRemove.forEach(pt => {
        deleteCircleItemFromServer(pt.id);
      });
    }
  });

  // Глобальный перехват кнопки/свайпа «Назад» для полноэкранного окна чата
  if (typeof window !== 'undefined') {
    window.__KLEV_CLOSE_FULLSCREEN_CHAT__ = () => {
      if (isFullScreenChatOpen) {
        isFullScreenChatOpen = false;
        activeChatChannelId = '';
        renderChatsSection();
        return true;
      }
      return false;
    };
  }

  events.on('location:changed', () => {
    syncNearbyCirclePointsFromServer(false);
  });
  ensureFisherIdentityInitialized(false).then(() => {
    syncNearbyCirclePointsFromServer(false);
  }).catch(() => {});

  render(container);
  renderChatsSection(chatsContainer || (typeof document !== 'undefined' ? document.getElementById('secChats') : null));
  renderAdminSection(adminContainer || (typeof document !== 'undefined' ? document.getElementById('secAdmin') : null));
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
    (next, prev) => {
      syncCircleNavBadge();
      if (prev && (next.lat !== prev.lat || next.lon !== prev.lon || next.locLabel !== prev.locLabel)) {
        syncNearbyCirclePointsFromServer(false);
      }
      if (next.route === 'chats') {
        const secChats = typeof document !== 'undefined' ? document.getElementById('secChats') : null;
        if (secChats && secChats.contains(document.activeElement) && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
          return;
        }
        renderChatsSection();
      } else if (next.route === 'admin') {
        renderAdminSection();
      } else if (!next.route || next.route === 'circle') {
        if (typeof document !== 'undefined' && container && container.contains(document.activeElement) && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
          return;
        }
        render(container);
      }
    }
  );

  if (relayPollTimer) clearInterval(relayPollTimer);
  relayPollTimer = setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      pollEncryptedRelayPackets(false);
      syncNearbyCirclePointsFromServer(false);
      const curIdent = getCurrentFisherIdentity();
      if (curIdent.isRegistered && !_cloudSessionVerified) {
        syncCurrentProfileToCloudIfLoggedIn().then(ok => {
          if (ok) _cloudSessionVerified = true;
        }).catch(() => {});
      }
    }
  }, 4000);

  if (typeof window !== 'undefined' && !_iosLifecycleBound) {
    _iosLifecycleBound = true;
    const onWakeOrOnline = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      _relayPollInFlight = false;
      _nearbySyncInFlight = false;
      flushPendingOutboxToServer().then(() => {
        syncNearbyCirclePointsFromServer(false, true);
        pollEncryptedRelayPackets(false);
      }).catch(() => {});
    };
    window.addEventListener('pageshow', onWakeOrOnline);
    window.addEventListener('online', onWakeOrOnline);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') onWakeOrOnline();
      });
    }
  }

  syncAdminWhitelistWithCloud(null);

  // Примечание: актуальные точки Круга синхронизируются напрямую с сервера D1 через syncNearbyCirclePointsFromServer(),
  // чтобы удалённые точки из старого облачного кэша Telegram никогда не всплывали при запуске.
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
  OWNER_BOUND_FISHER_ID,
  OWNER_SECONDARY_FISHER_ID,
  computeCrewKeyHash,
  formatCrewKeyFromHash,
  formatTempReserveFisherId,
  isTemporaryReserveId,
  isOwnerFisherId,
  requireRegisteredFisherId,
  parseFisherIdTo20Bit,
  formatFisherIdFrom20Bit,
  resolveAccountCredentials,
  authenticateAndSyncAccount,
  logoutCurrentFisherAccount,
  syncCurrentProfileToCloudIfLoggedIn,
  renderSettingsZoneTabsHtml,
  bindSettingsZoneTabs,
  getCurrentFisherIdentity,
  ensureFisherIdentityInitialized,
  publishCircleItemToServer,
  deleteCircleItemFromServer,
  syncNearbyCirclePointsFromServer,
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
  fetchSuperAdminDashboardData,
  renderChatsSection,
  renderAdminSection,
  init,
  render,
  destroy
};
