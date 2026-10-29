import { events } from '../../core/events.js?v=2.3.0';
import { store } from '../../core/store.js?v=2.3.0';
import { storage, calcGeoDistanceKm, safeJsonParse } from '../../core/storage.js?v=2.3.0';
import { router } from '../../core/router.js?v=2.3.0';
import { getSeasonalBaitsForContext } from '../../core/config.js?v=2.3.0';
import { detectBasinByCoords, isCoastalInBasin } from '../../data/basins.js?v=2.3.0';
import { findNearestRussianSettlement, getNearestRussianWaters } from '../../data/russia-waters.js?v=2.3.0';
import { WATER_PROFILES } from '../../data/waters.js?v=2.3.0';
import { FISH_DB } from '../../data/species.js?v=2.3.0';
import { escapeHtml, createPill, showToast, openModal, closeModal, copyFisherIdToClipboard, openConfirmDeleteModal, openUserAgreementModal, isUserAgreementAccepted } from '../../ui/components.js?v=2.3.0';
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
} from '../../core/telegram.js?v=2.3.0';
import { setLocation } from '../geo/geo.module.js?v=2.3.0';
import { calcDynamicRig } from '../forecast/forecast.module.js?v=2.3.0';
export const CREW_TTL_MS = 72 * 60 * 60 * 1000;
export const CIRCLE_BLUR_RADIUS_KM = 5.0;
export const CIRCLE_OLDER_BLUR_RADIUS_KM = 10.0;
export const REGIONAL_K_ANONYMITY_THRESHOLD = 3;
const PACK_PREFIX = 'KP1_';
const CIPHER_SALT = 'KlevProCircle_v2.1_Salt_RU';
const E2E_PREFIX = 'KPE2E_';
const EPOCH_2024_MS = 1704067200000; // 2024-01-01T00:00:00Z
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
let isFullScreenChatOpen = false;
let _cloudSessionVerified = false;
let relayPollTimer = null;
let lastRelayPullTs = 0;
let _relayPollInFlight = false;
let _nearbySyncInFlight = false;
let _outboxFlushInFlight = false;
let _iosLifecycleBound = false;
const _recentlyPublishedLocalIds = new Map();
const _explicitlyDeletedLocalIds = new Set();
const PENDING_OUTBOX_STORAGE_KEY = 'klev_pro_pending_outbox_v2_1_21';
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
export async function workerFetch(endpointOrUrl, options = {}, timeoutMs = 5500, retries = 2) {
const fullUrl = String(endpointOrUrl || '').startsWith('http')
? endpointOrUrl
: `${RELAY_WORKER_URL}${endpointOrUrl}`;
const method = String(options.method || 'GET').toUpperCase();
const bodyStr = typeof options.body === 'string' ? options.body : (options.body ? JSON.stringify(options.body) : undefined);
const isIOS = _isIOSWebKitClient();
const effectiveRetries = (method === 'POST' && retries < 1) ? 1 : retries;
for (let attempt = 0; attempt <= effectiveRetries; attempt++) {
const canUseGetPayload = (method === 'POST' && bodyStr && bodyStr.length < 3600);
const useGetFallback = canUseGetPayload && (attempt >= 1);
const reqMethod = useGetFallback ? 'GET' : method;
const sep = fullUrl.includes('?') ? '&' : '?';
const targetUrl = useGetFallback
? `${fullUrl}${sep}payload=${encodeURIComponent(bodyStr)}&_t=${Date.now()}_${attempt}`
: (reqMethod === 'GET'
? (fullUrl.includes('_t=') ? `${fullUrl}&_r=${attempt}` : `${fullUrl}${sep}_t=${Date.now()}${attempt > 0 ? `_${attempt}` : ''}`)
: (attempt > 0 ? `${fullUrl}${sep}_r=${attempt}_${Date.now()}` : fullUrl));
const attemptTimeout = (isIOS && attempt === 0 && method === 'POST')
? Math.min(timeoutMs, 2600)
: timeoutMs;
const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
const timer = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, attemptTimeout) : null;
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
if (bodyStr.length < 32000) {
fetchOpts.keepalive = true;
}
}
const res = await fetch(targetUrl, fetchOpts);
if (timer) clearTimeout(timer);
if (res && (res.ok || res.status === 400 || res.status === 403 || res.status === 429)) {
return res;
}
} catch (err) {
if (timer) clearTimeout(timer);
if (attempt === effectiveRetries) throw err;
}
}
throw new Error('Network timeout');
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
export function fnv1a32(str = '') {
let h = 0x811c9dc5;
const s = String(str || '');
for (let i = 0; i < s.length; i++) {
h ^= s.charCodeAt(i);
h = Math.imul(h, 0x01000193);
}
return h >>> 0;
}
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
login = '';
callsign = (up.callsign && up.callsign !== 'Рыболов' && !isLoginOwnerMatch(up.callsign)) ? up.callsign : 'Гость (Резерв)';
if (rawSavedFid && isTemporaryReserveId(rawSavedFid) && rawSavedFid.slice(3, 5) === regCode) {
fisherId = rawSavedFid;
} else {
fisherId = formatTempReserveFisherId(regCode, `rz_v21:${devId}:${regCode}`);
}
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
export function requireRegisteredFisherId(actionLabel = 'отправки данных') {
const s = store.getState();
const ident = getCurrentFisherIdentity(s);
if (ident.isRegistered && !ident.isTemporaryReserve) {
return true;
}
showToast(
`🔒 Сначала зарегистрируйтесь (задайте логин и пароль)! С временным резервным ID (${ident.fisherId}) отправка недоступна.`,
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
export function isCircleItemHidden(item, stateObj = null) {
if (!item || !item.id) return false;
const s = stateObj || store.getState();
const hidden = s?.userProfile?.hiddenCircleIds;
return Array.isArray(hidden) && hidden.includes(item.id);
}
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
export async function ensureFisherIdentityInitialized(forceReallocateForRegion = false) {
const s = store.getState();
const up = s?.userProfile || {};
const regCode = resolveRussianRegionCode(s);
const hasRealLoc = Boolean(s?.hasUserLocation);
const ident = getCurrentFisherIdentity(s);
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
version: '2.3.0',
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
version: '2.3.0'
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
version: '2.3.0',
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
title: `🆘 СИГНАЛ SOS НА ВОДЕ (${itemCopy.wn || itemCopy.lb})`,
body: `Координаты: ${Number(itemCopy.lat).toFixed(4)}°N, ${Number(itemCopy.lon).toFixed(4)}°E • От ${itemCopy.fid}`,
subTab: 'radar',
lat: itemCopy.lat,
lon: itemCopy.lon,
silentToast: false
});
} else if (itemCopy.t === 'crew') {
pushAppNotification({
category: 'crew',
title: `🌊 Точка Экипажа (${itemCopy.crewKey || '72ч'})`,
body: `${itemCopy.wn || itemCopy.lb}: ${itemCopy.fn} (~${itemCopy.dp} м) • От ${itemCopy.fid}`,
subTab: 'radar',
lat: itemCopy.lat,
lon: itemCopy.lon,
silentToast: true
});
} else if (itemCopy.t === 'circle') {
pushAppNotification({
category: 'circle',
title: `👥 Новая сводка в Круге (${itemCopy.wn || itemCopy.lb})`,
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
if (newExternalCount > 0 || prunedCount > 0 || mergedList.length !== curList.length) {
storage.saveCircleItems(mergedList);
store.dispatch({ type: 'SET_CIRCLE_ITEMS', payload: mergedList });
syncCircleNavBadge();
}
if (showFeedbackToast) {
showToast(
newExternalCount > 0
? `📡 Радар Круга обновлён: получено ${newExternalCount} новых точек!`
: `📡 Радар Круга синхронизирован (активных точек: ${mergedList.length})`,
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
export async function authenticateAndSyncAccount(rawLogin, rawPassword, mode = 'login') {
const s = store.getState();
const regCode = resolveRussianRegionCode(s);
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
version: '2.3.0',
profileSnapshot: snapshot
})
});
const data = await res.json().catch(() => null);
if (!res.ok || (data && data.ok === false)) {
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
version: '2.3.0',
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
export function renderSettingsZoneTabsHtml(activeZone = 'auth') {
const effZone = activeZone === 'notif' ? 'app' : activeZone;
const zones = [
{ id: 'auth', icon: '🔐', label: 'Вход и ID' },
{ id: 'fishing', icon: '🎣', label: 'Рыбалка' },
{ id: 'app', icon: '⚙️', label: 'Настройки' }
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
`📍 ${locDisplay} • 👤 ${author}\n` +
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
`📍 ${locDisplay} (~${s.depth.toFixed(1)} м) • 👤 ${author}\n` +
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
`⚖️ ${shortRigWeight} • 🪱 ${shortBait} • 👤 ${author}` +
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
`📍 ${locDisplay} (~${packObj.dp} м) • 👤 ${author}\n` +
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
const crewBoxes = ident.unlockedCrewKeys.map(k => `CREW_${String(k).toUpperCase()}`);
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
for (const pkt of packets) {
if (!pkt || !pkt.cipherPayload) continue;
if (pkt.ts && pkt.ts > lastRelayPullTs) lastRelayPullTs = pkt.ts;
if (pkt.senderId && pkt.senderId === ident.fisherId) continue;
if (pkt.kind === 'circle_del') {
const delTargetId = pkt.targetId || pkt.itemId;
if (delTargetId) {
const curItems = store.getState().circleItems || [];
if (curItems.some(x => x && x.id === delTargetId)) {
const filtered = curItems.filter(x => x && x.id !== delTargetId);
storage.saveCircleItems(filtered);
store.dispatch({ type: 'SET_CIRCLE_ITEMS', payload: filtered });
syncCircleNavBadge();
}
}
} else if (pkt.kind === 'pack') {
const existing = s.circleItems || [];
const dec = decodeSharePack(pkt.cipherPayload);
if (dec && !existing.some(x => x.id === dec.id)) {
await importSharePackToken(pkt.cipherPayload, true, false);
newCount++;
}
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
if (manual) {
showToast(newCount > 0 ? `📥 Получено новых зашифрованных пакетов: ${newCount}` : '✅ Новых внешних пакетов в очереди нет', 'good');
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
if (normalizedChanId.startsWith('dm:')) {
const otherFid = msgObj.senderId === ident.fisherId
? (msgObj.peerId || normalizedChanId.replace(/^dm:/, '').split(':').find(p => p !== ident.fisherId) || '')
: (msgObj.senderId || msgObj.peerId || '');
if (otherFid) {
normalizedChanId = getCanonicalDmChannelId(ident.fisherId, otherFid, existing);
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
title: isCrew ? `🌊 Сообщение в Экипаже (${msgObj.crewKey || 'Экипаж'})` : `💬 Сообщение от ${msgObj.senderName || msgObj.senderId}`,
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
label: `🌊 Чат Экипажа ${k}${cItem ? ` (${cItem.wn || cItem.lb})` : ''}`,
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
🎣 <b>Поделиться уловом в зашифрованном чате:</b> напарники увидят карточку вашего трофея (рыба, вес, наживка, температура воды, давление) и смогут в 1 касание открыть сектор поимки на карте!
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
<input type="text" id="scCustomPeerIdInput" class="input" placeholder="Введите ID рыбака (напр. FP_89VIP089)..." style="display:none;margin-top:6px;text-transform:uppercase;">
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
`👤 Рыбак: ${ident.callsign}` +
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
showToast('🎣 Карточка улова отправлена в чат!', 'good');
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
<div style="display:flex;flex-direction:column;gap:8px;margin-top:8px;margin-bottom:14px;width:100%;box-sizing:border-box;">
<div style="display:flex;gap:8px;width:100%;">
<button type="button" class="btn ${currentMode === 'sos' ? 'btn-good' : 'btn-accent'}" id="shareSendTelegramBtn" style="flex:1;min-height:42px;${currentMode === 'sos' ? 'background:var(--bad);border-color:var(--bad);' : ''}">
✈️ В Telegram
</button>
<button type="button" class="btn btn-good" id="shareCopyOrNativeBtn" style="flex:1;min-height:42px;">
📋 Скопировать
</button>
</div>
<button type="button" class="btn btn-primary" id="shareSaveLocalCircleBtn" style="width:100%;min-height:44px;font-weight:800;border:1.5px solid var(--accent);background:var(--panel);">
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
await importSharePackToken(finalPack.token, true, true);
publishToRelayIfApplicable(finalPack).catch(() => {});
shareToTelegramChat(finalPack.webUrl, finalPack.summaryText);
});
bodyEl.querySelector('#shareCopyOrNativeBtn')?.addEventListener('click', async () => {
const finalPack = createSharePackFromContext(currentMode, customNote, overrideCatch);
await importSharePackToken(finalPack.token, true, true);
const publishPromise = publishToRelayIfApplicable(finalPack);
await shareOrCopyPack({
title: currentMode === 'sos' ? '🆘 SOS НА ВОДЕ • Клёв ПРО' : 'Клёв ПРО: Круг',
text: finalPack.summaryText,
url: finalPack.webUrl,
token: finalPack.token
});
await publishPromise;
});
bodyEl.querySelector('#shareSaveLocalCircleBtn')?.addEventListener('click', async (ev) => {
const btnEl = ev.currentTarget;
if (btnEl) {
btnEl.disabled = true;
btnEl.textContent = '⏳ Сохранение в БД...';
}
const finalPack = createSharePackFromContext(currentMode, customNote, overrideCatch);
await importSharePackToken(finalPack.token, false, true);
await publishToRelayIfApplicable(finalPack);
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
export function openAuthAndBackupModal(onBackToHub = null) {
const backFn = typeof onBackToHub === 'function'
? onBackToHub
: (() => {
if (typeof window !== 'undefined' && typeof window.__KLEV_OPEN_SETTINGS_ZONE__ === 'function') {
window.__KLEV_OPEN_SETTINGS_ZONE__('hub');
}
});
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
? '👑 ЭКСКЛЮЗИВНЫЙ ID СУПЕР-АДМИНА (ВЛАДЕЛЕЦ):'
: (ident.isRegistered
? '🟢 ВАШ ПОСТОЯННЫЙ ЗАКРЕПЛЁННЫЙ ID РЫБАКА:'
: '🟡 ВРЕМЕННЫЙ РЕЗЕРВНЫЙ ID (БЕЗ РЕГИСТРАЦИИ):')}
</span>
<div style="display:flex;gap:6px;flex-wrap:wrap;">
<button type="button" class="btn btn-sm ${ident.isRegistered ? 'btn-good' : ''}" data-copy-fisher-id="${ident.fisherId}" style="font-family:monospace;font-size:13px;font-weight:900;padding:4px 10px;">
🆔 ${ident.fisherId} 📋
</button>
${ident.isOwner ? `
<button type="button" class="btn btn-sm btn-accent" data-copy-fisher-id="${ident.fisherId === OWNER_BOUND_FISHER_ID ? OWNER_SECONDARY_FISHER_ID : OWNER_BOUND_FISHER_ID}" style="font-family:monospace;font-size:12px;font-weight:900;padding:4px 8px;">
🆔 ${ident.fisherId === OWNER_BOUND_FISHER_ID ? OWNER_SECONDARY_FISHER_ID : OWNER_BOUND_FISHER_ID} 📋
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
👑 Открыть вкладку «Супер-Админ и Статистика БД»
</button>
</div>
` : ''}
</div>
<!-- Форма регистрации / входа по Логину (или постоянному ID) и Паролю -->
<div class="card" style="background:var(--card);padding:12px;border:1.5px solid var(--accent);display:flex;flex-direction:column;gap:9px;">
<div style="font-weight:800;font-size:var(--fs-xs);color:var(--accent);">
${ident.isRegistered
? `🔑 ВАШ ПРОФИЛЬ АВТОРИЗОВАН (${escapeHtml(savedLogin)} • ${ident.fisherId})`
: '🔑 РЕГИСТРАЦИЯ ИЛИ ВХОД (ПОЛУЧЕНИЕ ПОСТОЯННОГО ID НАВСЕГДА)'}
</div>
<div style="font-size:11.5px;color:var(--muted);line-height:1.38;">
Постоянный ID не привязывается к железу телефона — он жёстко привязан <b>только к вашему логину и паролю</b>. Вы можете входить на любых телефонах (Android / iOS), планшетах, компьютерах и в Telegram Mini App.
</div>
<div>
<label style="display:block;font-size:var(--fs-xs);color:var(--muted);font-weight:700;margin-bottom:3px;">ЛОГИН РЫБАКА (ИЛИ ВАШ ПОСТОЯННЫЙ ID ДЛЯ ВХОДА):</label>
<input type="text" id="authCallsignInput" class="input" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" value="${escapeHtml(savedLogin)}" placeholder="Придумайте логин (или введите свой для входа)">
<div id="authLoginAvailabilityHint" style="font-size:11px;margin-top:3px;color:var(--muted);">
🛡️ При новой регистрации вам навсегда выдаётся персональный региональный ID (например, <code>FP_${resolveRussianRegionCode(s)}AAA001</code>).
</div>
</div>
<div>
<label style="display:block;font-size:var(--fs-xs);color:var(--muted);font-weight:700;margin-bottom:3px;">ПАРОЛЬ (ОТ 3 СИМВОЛОВ):</label>
<div style="display:flex;gap:6px;align-items:center;width:100%;">
<input type="password" id="authPinInput" class="input" autocomplete="current-password" placeholder="${ident.isRegistered ? '•••••••• (пароль для синхронизации)' : 'Введите пароль (от 3 симв.)...'}" style="flex:1;min-width:0;font-size:13.5px;">
<button type="button" class="btn btn-sm" id="authTogglePassVisBtn" title="Показать / скрыть пароль" style="min-height:40px;width:42px;min-width:42px;padding:0;flex-shrink:0;">👁️</button>
</div>
</div>
<div style="display:flex;flex-direction:column;gap:8px;width:100%;">
<button type="button" class="btn btn-accent" id="authSaveBtn" style="width:100%;min-height:42px;padding:8px 12px;font-size:13.5px;font-weight:800;line-height:1.25;white-space:normal;text-align:center;">
${ident.isRegistered
? `🔄 Синхронизировать (${ident.fisherId})`
: '🔑 Войти / Зарегистрировать ID'}
</button>
${ident.isRegistered ? `
<button type="button" class="btn btn-sm" id="authLogoutBtn" style="width:100%;min-height:38px;color:var(--bad);border-color:rgba(239,68,68,0.4);font-weight:800;">
🚪 Выйти
</button>
` : ''}
</div>
<!-- Привязка постоянного ID к Telegram -->
<div style="margin-top:2px;padding:9px 10px;background:var(--panel);border:1px solid var(--border);border-radius:var(--r-sm);display:flex;flex-direction:column;gap:6px;">
<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
<span style="font-weight:800;font-size:11.5px;color:var(--accent);">✈️ СВЯЗКА ПОСТОЯННОГО ID С TELEGRAM:</span>
<div style="display:flex;align-items:center;gap:4px;">
${ident.isRegistered && (ident.tgLinkedId || tgUser?.id || (ident.isOwner && ident.tgUsername))
? `<span class="pill pill-good" style="font-size:10.5px;">🟢 Связан: ${(ident.tgUsername || tgUser?.username || (ident.isOwner ? 'thorantony82' : '')) ? '@' + (ident.tgUsername || tgUser?.username || 'thorantony82') : 'ID ' + (ident.tgLinkedId || tgUser?.id)}</span>`
: `<span class="pill" style="font-size:10.5px;">⚪ Не привязан</span>`}
<button type="button" class="btn btn-sm" id="authCheckTgBindBtn" style="padding:2px 7px;font-size:10.5px;min-height:24px;" title="Проверить статус привязки в боте @KlevProClubBot">🔄 Проверить</button>
</div>
</div>
<div style="font-size:11px;color:var(--muted);line-height:1.35;">
${ident.isRegistered
? `При желании использовать сервисы Telegram (бот @KlevProClubBot, мини-приложение, отправка точек Экипажа, Круга и SOS в группы и чаты ТГ) свяжите ваш постоянный ID <b>${ident.fisherId}</b> с Telegram:`
: `Сначала зарегистрируйте логин и пароль выше, чтобы получить постоянный ID рыбака, после чего вы сможете привязать его к Telegram.`}
</div>
<button type="button" class="btn btn-sm ${ident.isRegistered ? 'btn-accent' : ''}" id="authBindTelegramBtn" style="width:100%;white-space:normal;line-height:1.35;padding:8px 10px;text-align:center;">
${ident.isRegistered && (ident.tgLinkedId || tgUser?.id || (ident.isOwner && ident.tgUsername))
? `🤖 Открыть @KlevProClubBot (единый ID ${ident.fisherId})`
: `✈️ Связать постоянный ID с Telegram (@KlevProClubBot)`}
</button>
</div>
</div>
<!-- Пользовательское соглашение и Правила безопасности -->
<div class="card" style="background:var(--card);padding:10px 12px;border:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
<div style="min-width:0;flex:1;">
<div style="font-size:var(--fs-xs);font-weight:800;color:var(--accent);">📜 Пользовательское соглашение «Клёв ПРО 2.0»</div>
<div style="font-size:11px;color:var(--muted);">Правила сообщества, безопасность на водоёмах и льду, защита данных</div>
</div>
<button type="button" class="btn btn-sm" id="authOpenUserAgreementBtn">📜 Прочитать</button>
</div>
<!-- Резервное копирование файла профиля -->
<div class="card" style="background:var(--card);padding:10px 12px;border:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
<span style="font-size:var(--fs-xs);font-weight:700;color:var(--muted);">💾 Локальная резервная копия (.JSON):</span>
<div style="display:flex;gap:6px;flex-wrap:wrap;">
<button type="button" class="btn btn-sm" id="backupExportBtn">📤 Скачать бэкап</button>
<label class="btn btn-sm" style="cursor:pointer;margin:0;">
📥 Восстановить
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
loginHint.textContent = '🛡️ Введите логин (от 2 символов) или ваш постоянный ID для входа.';
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
loginHint.textContent = '👑 Эксклюзивный логин Владельца (FP_89VIP089 & FP_FMP089) — введите мастер-пароль для входа.';
} else if (d.available) {
loginHint.style.color = 'var(--good)';
loginHint.textContent = `🟢 Логин «${val}» свободен! Придумайте пароль, чтобы получить постоянный ID рыбака навсегда.`;
} else {
loginHint.style.color = 'var(--accent)';
loginHint.textContent = `🔑 Логин «${val}» уже зарегистрирован. Если это ваш профиль — введите ваш пароль для входа и восстановления вашего ID.`;
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
toggleVisBtn.textContent = isPass ? '🙈' : '👁️';
});
}
bodyEl.querySelector('#authCheckTgBindBtn')?.addEventListener('click', async () => {
const btn = bodyEl.querySelector('#authCheckTgBindBtn');
if (btn) btn.textContent = '⏳...';
const st = await checkServerTelegramBindStatus(false);
if (st && st.bound) {
showToast(`🟢 Telegram успешно связан (@${st.tgUsername || 'KlevProClubBot'})!`, 'good');
} else {
showToast('Пока не привязан. Нажмите «Связать с Telegram» ниже и нажмите Start в боте!', 'info');
}
renderAuthBody(bodyEl);
});
bodyEl.querySelector('#authBindTelegramBtn')?.addEventListener('click', async () => {
const curIdent = getCurrentFisherIdentity(store.getState());
if (!curIdent.isRegistered || curIdent.isTemporaryReserve) {
showToast('🔒 Сначала зарегистрируйте логин и пароль выше, чтобы получить постоянный ID, а затем свяжите его с Telegram!', 'warn');
return;
}
await syncCurrentProfileToCloudIfLoggedIn();
openBotChatInTelegram(curIdent.fisherId);
});
bodyEl.querySelector('#authLogoutBtn')?.addEventListener('click', () => {
const tempFid = logoutCurrentFisherAccount();
showToast(`🚪 Вы вышли из профиля. Назначен временный резервный ID ${tempFid}`, 'info');
renderAuthBody(bodyEl);
});
bodyEl.querySelector('#authOpenUserAgreementBtn')?.addEventListener('click', () => {
openUserAgreementModal({ requireVerification: false });
});
const executeAuthLoginOrRegister = async (rawLogin, rawPin) => {
const saveBtn = bodyEl.querySelector('#authSaveBtn');
if (saveBtn) {
saveBtn.disabled = true;
saveBtn.textContent = '⏳ Синхронизация с сервером...';
}
const res = await authenticateAndSyncAccount(rawLogin, rawPin, 'login');
if (!res.ok) {
if (saveBtn) {
saveBtn.disabled = false;
saveBtn.textContent = '🔑 Войти / Зарегистрировать ID';
}
showToast(`❌ ${res.error || 'Ошибка входа'}`, 'bad');
return;
}
await copyFisherIdToClipboard(res.fisherId, res.isOwner ? 'Ваш ID Владельца' : 'Ваш постоянный ID рыбака');
if (res.isOwner) {
showToast(`👑 Добро пожаловать, ${res.login}! Активированы ваши эксклюзивные ID (FP_89VIP089 & FP_FMP089) и вкладка «👑 Админ»!`, 'good');
} else {
showToast(`✅ Постоянный ID ${res.fisherId} закреплён за логином «${res.login}» на всех устройствах!`, 'good');
}
renderAuthBody(bodyEl);
};
bodyEl.querySelector('#authSaveBtn')?.addEventListener('click', async () => {
const rawLogin = (bodyEl.querySelector('#authCallsignInput')?.value || '').trim();
const rawPin = (bodyEl.querySelector('#authPinInput')?.value || '').trim();
const prevUp = store.getState().userProfile || {};
if (!rawPin && ident.isRegistered && (prevUp.pinHash || prevUp.authTokenHash || ident.isOwner)) {
await syncCurrentProfileToCloudIfLoggedIn();
await copyFisherIdToClipboard(ident.fisherId, ident.isOwner ? 'Ваш ID Владельца' : 'Ваш постоянный ID рыбака');
showToast(`✅ Профиль ${ident.fisherId} синхронизирован`, 'good');
renderAuthBody(bodyEl);
return;
}
if (!rawLogin || rawPin.length < 3) {
showToast('Введите логин и пароль (минимум 3 символа)', 'warn');
return;
}
const isOwnerTry = isLoginOwnerMatch(rawLogin) || isOwnerFisherId(rawLogin);
if (!ident.isRegistered && !isOwnerTry && !isUserAgreementAccepted()) {
openUserAgreementModal({
requireVerification: true,
onAccepted: () => {
executeAuthLoginOrRegister(rawLogin, rawPin);
}
});
return;
}
await executeAuthLoginOrRegister(rawLogin, rawPin);
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
showToast('📤 Резервная копия профиля выгружена!', 'good');
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
showToast('✅ Профиль, точки и чаты успешно восстановлены!', 'good');
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
openModal('🔐 Регистрация, Вход и Постоянный ID', '<div id="authModalMount"></div>', (bodyEl) => {
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
export function formatCleanPeerTitle(peerNameRaw = '', peerIdRaw = '') {
const name = String(peerNameRaw || '').trim();
const pid = String(peerIdRaw || '').trim().toUpperCase();
if (pid === OWNER_BOUND_FISHER_ID || pid === OWNER_SECONDARY_FISHER_ID || /админ|iathor/i.test(name)) {
return '👑 Админ («Клёв ПРО»)';
}
if (!name || name.toUpperCase() === pid || /^FP_[A-Z0-9_]+$/i.test(name) || /^Рыбак\s+FP_/i.test(name)) {
return 'Рыболов';
}
return name;
}
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
title: `🌊 Экипаж ${k}${matchingCrew ? ` • ${matchingCrew.wn || matchingCrew.lb}` : ''}`,
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
title: `💬 ${cleanTitle}`,
subtitle: `${m.senderId === ident.fisherId ? 'Вы' : cleanTitle}: ${String(m.text || '').slice(0, 55)}`,
lastTs: m.ts || 0
});
} else {
if (cleanTitle !== 'Рыболов' && existingChan.peerName === 'Рыболов') {
existingChan.peerName = cleanTitle;
existingChan.title = `💬 ${cleanTitle}`;
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
${ident.isRegistered ? `🟢 Профиль: ${escapeHtml(ident.callsign)}` : '🟡 Гостевой режим (для отправки сообщений войдите в профиль)'}
</span>
</div>
<div style="display:flex;gap:6px;flex-wrap:wrap;">
${!ident.isRegistered
? `<button type="button" class="btn btn-sm btn-accent" id="chatOpenAuthBtn">🔐 Войти / Регистрация</button>`
: `<button type="button" class="btn btn-sm btn-good" id="chatShareCatchTopBtn">🎣 Поделиться уловом</button>`}
</div>
</div>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px;">
<div class="card" style="background:var(--card);padding:8px 10px;border:1px solid var(--border);">
<div style="font-weight:800;font-size:11px;color:var(--accent);margin-bottom:4px;">🌊 ЧАТ ЭКИПАЖА ПО КЛЮЧУ (KP-XXXX):</div>
<div style="display:flex;gap:6px;">
<input type="text" id="chatJoinCrewKeyInput" class="input" placeholder="Напр. KP-7A3F" style="flex:1;min-height:34px;text-transform:uppercase;">
<button type="button" class="btn btn-sm btn-accent" id="chatJoinCrewKeyBtn" style="min-height:34px;">Открыть</button>
</div>
</div>
<div class="card" style="background:var(--card);padding:8px 10px;border:1px solid var(--border);">
<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:4px;">
<div style="font-weight:800;font-size:11px;color:var(--good);">💬 ЛИЧНЫЙ ДИАЛОГ С РЫБАКОМ:</div>
<button type="button" class="btn btn-sm" id="chatWriteAdminBtn" style="min-height:28px;padding:2px 8px;font-size:11px;border-color:var(--good);color:var(--good);font-weight:800;">👑 Написать Админу</button>
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
📋 ВАШИ ДИАЛОГИ И ЧАТЫ ЭКИПАЖЕЙ (${allChannels.length}):
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
🗑️
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
${activeChan.crewKey ? `<span class="fisher-id-copy-badge" data-copy-fisher-id="${activeChan.crewKey}" data-copy-label="Ключ экипажа" style="font-size:11px;font-family:monospace;font-weight:800;cursor:pointer;padding:3px 7px;background:var(--card);border:1px solid var(--border);border-radius:6px;">🔑 ${activeChan.crewKey} 📋</span>` : ''}
<button type="button" class="btn btn-sm" id="chatDeleteHistoryBtn" style="color:var(--bad);border-color:rgba(239,68,68,0.4);min-height:32px;padding:3px 9px;">
🗑️ Удалить
</button>
</div>
</div>
<div id="chatMessagesScrollBox" style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;">
${activeMsgs.length === 0 ? `
<div style="margin:auto;padding:20px;text-align:center;color:var(--muted);font-size:var(--fs-xs);max-width:300px;">
Сообщений в этом диалоге пока нет. Напишите сообщение, отправьте свою геопозицию (📍) или прикрепите улов (🎣)!
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
<button type="button" class="btn btn-sm btn-good" data-chat-import-pack="${packTok}" style="min-height:28px;padding:2px 9px;font-size:11px;">🗺️ Показать точку на карте</button>
</div>
` : ''}
</div>
`;
}).join('')}
</div>
<div style="display:flex;gap:6px;padding:10px 12px;background:var(--panel);border-top:1px solid var(--border);align-items:center;flex-shrink:0;">
<button type="button" class="btn btn-sm" id="chatShareLocationBtn" title="Поделиться текущим местоположением" style="min-height:40px;padding:0 10px;flex-shrink:0;border-color:var(--accent);color:var(--accent);font-weight:800;">📍</button>
<button type="button" class="btn btn-sm btn-good" id="chatAttachCatchBtn" title="Прикрепить карточку улова" style="min-height:40px;padding:0 10px;flex-shrink:0;font-weight:800;">🎣</button>
<input type="text" id="chatComposeInput" class="input" placeholder="${ident.isRegistered ? 'Напишите сообщение...' : 'Войдите в профиль для отправки...'}" style="flex:1;min-height:40px;">
<button type="button" class="btn btn-accent" id="chatSendMsgBtn" style="min-height:40px;padding:0 16px;flex-shrink:0;font-weight:900;">➤</button>
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
: `<span class="pill pill-neutral" style="font-size:10px;padding:1px 6px;">🌐 ${escapeHtml(authorDisplay)}</span>`;
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
${item.t !== 'workshop' ? `<button type="button" class="btn btn-sm" data-goto-circle="${item.id}" title="Показать на карте" style="min-height:26px;padding:2px 7px;font-size:11px;">🗺️</button>` : `<button type="button" class="btn btn-sm btn-good" data-apply-workshop="${item.id}" title="Применить снасть" style="min-height:26px;padding:2px 7px;font-size:11px;">✅</button>`}
${cKey ? `<button type="button" class="btn btn-sm btn-accent" data-open-crew-chat="${cKey}" title="Открыть чат экипажа" style="min-height:26px;padding:2px 7px;font-size:11px;">💬</button>` : (!mine ? `<button type="button" class="btn btn-sm" data-open-dm="${itemFid}" data-open-dm-name="${escapeHtml(authorDisplay)}" title="Написать рыбаку" style="min-height:26px;padding:2px 7px;font-size:11px;">💬</button>` : '')}
${(mine || ident.isOwner) ? `
<button type="button" class="btn btn-sm" data-del-my-circle="${item.id}" title="Удалить запись" style="min-height:26px;padding:2px 7px;font-size:11px;color:var(--bad);border-color:rgba(239,68,68,0.4);">🗑️</button>
` : (hidden ? `
<button type="button" class="btn btn-sm btn-good" data-unhide-circle="${item.id}" title="Вернуть запись" style="min-height:26px;padding:2px 7px;font-size:11px;">👁️</button>
` : `
<button type="button" class="btn btn-sm" data-hide-foreign-circle="${item.id}" title="Скрыть чужую запись" style="min-height:26px;padding:2px 7px;font-size:11px;color:var(--muted);">🙈</button>
`)}
<button type="button" class="btn btn-sm" data-toggle-compact-row="${item.id}" title="Подробности" style="min-height:26px;padding:2px 6px;font-size:11px;">${isExpanded ? '▴' : '▾'}</button>
</div>
</div>
${isExpanded ? `
<div style="padding:10px;background:var(--panel);border-radius:var(--r-sm);border:1px solid var(--border);margin-top:4px;display:flex;flex-direction:column;gap:6px;font-size:var(--fs-xs);">
<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;">
<span style="font-weight:900;color:var(--accent);">🐟 ${escapeHtml(item.fn || 'Рыба')}${item.kg ? ` • Вес: ${item.kg} кг` : ''}</span>
<span style="color:var(--muted);font-size:11px;">⏳ До истечения: <b>${formatRemainingHours(item.ea || (item.ca ? item.ca + 72*3600000 : now + 72*3600000))}</b></span>
</div>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:6px;margin:2px 0;">
<div>🌊 <b>Водоём:</b> ${escapeHtml(item.wn || item.lb || 'Водоём')}</div>
<div>📏 <b>Глубина:</b> ${item.dp || 1.5} м</div>
<div>💧 <b>Вода:</b> ${item.tw ?? 8}°C</div>
<div>🧭 <b>Атм. давление:</b> ${item.pr ?? 755} мм</div>
<div>💨 <b>Ветер:</b> ${item.ws ?? 4} м/с</div>
<div>🪱 <b>Насадка:</b> ${escapeHtml(item.bt || 'мотыль / блесна')}</div>
<div>🎣 <b>Снасть:</b> ${escapeHtml(item.rw || item.rg || 'по сезону')}</div>
<div>👤 <b>Автор:</b> ${escapeHtml(authorDisplay)}</div>
</div>
${cKey ? `<div style="color:var(--good);font-weight:800;">🔑 Ключ закрытого экипажа: <code>${cKey}</code></div>` : ''}
${item.nt ? `<div style="padding:6px 8px;background:var(--card);border-left:3px solid var(--accent);border-radius:4px;color:var(--text);font-style:italic;">💬 «${escapeHtml(item.nt)}»</div>` : ''}
<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;">
${item.t !== 'workshop' ? `<button type="button" class="btn btn-sm btn-accent" data-goto-circle="${item.id}" style="padding:4px 10px;font-size:11.5px;">🗺️ Показать на карте</button>` : `<button type="button" class="btn btn-sm btn-good" data-apply-workshop="${item.id}" style="padding:4px 10px;font-size:11.5px;">✅ Применить снасть</button>`}
${cKey ? `<button type="button" class="btn btn-sm btn-good" data-open-crew-chat="${cKey}" style="padding:4px 10px;font-size:11.5px;">💬 Чат экипажа (${cKey})</button>` : (!mine ? `<button type="button" class="btn btn-sm" data-open-dm="${itemFid}" data-open-dm-name="${escapeHtml(authorDisplay)}" style="padding:4px 10px;font-size:11.5px;">💬 Написать в ЛС</button>` : '')}
${(mine || ident.isOwner) ? `<button type="button" class="btn btn-sm" data-del-my-circle="${item.id}" style="padding:4px 10px;font-size:11.5px;color:var(--bad);border-color:rgba(239,68,68,0.4);">🗑️ Удалить</button>` : ''}
</div>
</div>
` : ''}
</div>
`;
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
<div class="section-head" style="margin-bottom:8px;">
<div>
<span class="section-title">💬 Чаты Экипажей и Личные диалоги</span>
<div style="font-size:var(--fs-xs);color:var(--muted);margin-top:2px;">
Общение с экипажем по ключу <code>KP-XXXX</code> или личная переписка с рыбаками
</div>
</div>
</div>
${renderChatsSubView(s, ident, visibleCrews)}
</div>
`;
bindChatViewEvents(container);
}
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
container.innerHTML = `
<div class="card">
<!-- 1. Шапка статуса профиля (без лишнего дублирования ID) -->
<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;padding:10px 12px;background:${ident.isOwner ? 'rgba(16,185,129,0.10)' : (ident.isRegistered ? 'rgba(56,189,248,0.08)' : 'rgba(245,158,11,0.10)')};border:1.5px solid ${ident.isOwner ? 'var(--good)' : (ident.isRegistered ? 'var(--accent)' : 'var(--warn)')};border-radius:var(--r-sm);margin-bottom:12px;">
<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
<div>
<div style="font-weight:800;font-size:var(--fs-xs);color:var(--text);">
${ident.isOwner
? `👑 Супер-Админ Владелец (${escapeHtml(ident.login)})`
: (ident.isRegistered
? `🟢 Профиль активен: «${escapeHtml(ident.login || ident.callsign)}»`
: `🟡 Гостевой режим (только просмотр)`)}
</div>
<div style="font-size:11px;color:var(--muted);">
${ident.isRegistered
? 'Вы можете публиковать сводки в Круг (±5 км), создавать Экипажи (72 ч) и отправлять сигналы SOS'
: '🔒 Для публикации своих точек и общения в чатах войдите или зарегистрируйтесь в профиле'}
</div>
</div>
</div>
<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
${ident.isOwner ? `
<button type="button" class="btn btn-sm btn-good" id="circleGoAdminTabBtn" style="min-height:32px;font-weight:800;">👑 Статистика и БД</button>
` : ''}
${!ident.isRegistered ? `
<button type="button" class="btn btn-sm btn-accent" id="circleAuthModalBtn" style="min-height:32px;font-weight:800;">🔐 Регистрация / Вход</button>
` : `
<button type="button" class="btn btn-sm" id="circleAuthModalBtn" style="min-height:32px;">👤 Профиль</button>
`}
<button type="button" class="btn btn-sm" id="circleImportPackBtn" style="min-height:32px;" title="Ввести 4-значный ключ закрытого Экипажа KP-XXXX или код точки">🔑 Ключ KP-XXXX</button>
<button type="button" class="btn btn-sm" id="circleRefreshRadarBtn" style="min-height:32px;" title="Синхронизировать точки с сервером">🔄 Радар</button>
</div>
</div>
<!-- 2. Три главные карточки действий Круга -->
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;margin-bottom:12px;">
<button type="button" class="card" data-quick-share="circle" style="text-align:left;cursor:pointer;padding:10px 12px;background:var(--card);border:1.5px solid var(--good);display:flex;flex-direction:column;gap:4px;">
<div style="display:flex;justify-content:space-between;align-items:center;">
<span style="font-weight:900;font-size:var(--fs-sm);color:var(--good);">👥 Сводка в Круг (±5 км)</span>
<span class="pill pill-good" style="font-size:10px;">Приватно</span>
</div>
<div style="font-size:11px;color:var(--muted);line-height:1.35;">
Поделиться клёвом в радиусе 35 км со скрытием точного места (±5 км)
</div>
</button>
<button type="button" class="card" data-quick-share="crew" style="text-align:left;cursor:pointer;padding:10px 12px;background:var(--card);border:1.5px solid var(--accent);display:flex;flex-direction:column;gap:4px;">
<div style="display:flex;justify-content:space-between;align-items:center;">
<span style="font-weight:900;font-size:var(--fs-sm);color:var(--accent);">🌊 Экипаж (72 ч • KP-XXXX)</span>
<span class="pill pill-ice" style="font-size:10px;">По ключу</span>
</div>
<div style="font-size:11px;color:var(--muted);line-height:1.35;">
Точные координаты стоянки и общий чат только для своих напарников на 72 часа
</div>
</button>
<button type="button" class="card" data-quick-share="sos" style="text-align:left;cursor:pointer;padding:10px 12px;background:rgba(239,68,68,0.08);border:1.5px solid var(--bad);display:flex;flex-direction:column;gap:4px;">
<div style="display:flex;justify-content:space-between;align-items:center;">
<span style="font-weight:900;font-size:var(--fs-sm);color:var(--bad);">🆘 SOS на воде</span>
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
👤 Мои (${mineItems.length})
</button>
<button type="button" class="btn btn-sm ${activeOwnershipFilter === 'foreign' ? 'btn-accent' : ''}" data-circle-owner="foreign" style="min-height:30px;padding:3px 9px;">
🌐 Чужие (${foreignItems.length})
</button>
${hiddenItems.length > 0 || activeOwnershipFilter === 'hidden' ? `
<button type="button" class="btn btn-sm ${activeOwnershipFilter === 'hidden' ? 'btn-accent' : ''}" data-circle-owner="hidden" style="min-height:30px;padding:3px 9px;">
👁️ Скрытые (${hiddenItems.length})
</button>
` : ''}
</div>
<div style="display:flex;gap:5px;flex-wrap:wrap;">
${hiddenItems.length > 0 && activeOwnershipFilter === 'hidden' ? `
<button type="button" class="btn btn-sm" id="circleUnhideAllBtn" style="min-height:28px;font-size:11px;">👁️ Вернуть все</button>
` : ''}
${hiddenLockedCrewsCount > 0 ? `
<button type="button" class="btn btn-sm" id="circleUnlockHiddenCrewBtn" style="min-height:28px;font-size:11px;border-color:var(--accent);color:var(--accent);">🔒 Закрытых экипажей: ${hiddenLockedCrewsCount}</button>
` : ''}
${activeCategoryFilter === 'workshop' ? `
<button type="button" class="btn btn-sm btn-good" data-quick-share="workshop" style="min-height:28px;font-size:11px;">🛠️ + Добавить свой монтаж</button>
` : ''}
</div>
</div>
<div class="chip-scroll-row" style="margin-bottom:10px;">
<button type="button" class="w-chip ${activeCategoryFilter === 'all' ? 'active' : ''}" data-circle-cat="all">📡 Все сигналы (${baseList.length})</button>
<button type="button" class="w-chip ${activeCategoryFilter === 'circle' ? 'active' : ''}" data-circle-cat="circle">👥 Круг ±5км (${baseList.filter(x => x.t === 'circle').length})</button>
<button type="button" class="w-chip ${activeCategoryFilter === 'crew' ? 'active' : ''}" data-circle-cat="crew">🌊 Экипаж 72ч (${baseList.filter(x => x.t === 'crew' && !x.sos).length})</button>
<button type="button" class="w-chip ${activeCategoryFilter === 'sos' ? 'active' : ''}" data-circle-cat="sos">🆘 SOS (${baseList.filter(x => x.t === 'crew' && x.sos).length})</button>
<button type="button" class="w-chip ${activeCategoryFilter === 'workshop' ? 'active' : ''}" data-circle-cat="workshop">🛠️ Мастерская снастей (${baseList.filter(x => x.t === 'workshop').length})</button>
</div>
<!-- 4. Компактный список событий радара -->
<div class="circle-compact-list" style="display:flex;flex-direction:column;gap:6px;">
${filteredList.length === 0 ? `
<div style="padding:16px;background:var(--card);border:1px dashed var(--border);border-radius:var(--r-sm);font-size:var(--fs-xs);color:var(--muted);text-align:center;">
${activeOwnershipFilter === 'mine'
? 'У вас пока нет опубликованных точек. Выберите одну из 3 карточек выше, чтобы поделиться сводкой или создать Экипаж.'
: 'В выбранной категории пока нет активных точек за последние 72 часа. Нажмите «🔄 Радар» для проверки новых сигналов с сервера.'}
</div>
` : filteredList.map(item => renderCompactCircleRow(item, s, ident, now)).join('')}
</div>
</div>
`;
bindCircleEvents(container);
}
let _lastAdminDashboardFetchTs = 0;
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
if (forceToast) showToast(`👑 База данных обновлена с сервера: ${data.totalUsers || 0} пользователей, ${(data.points || []).length} точек`, 'good');
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
let _adminSearchFilter = '';
export function renderAdminSection(customContainer = null) {
const container = customContainer || (typeof document !== 'undefined' ? document.getElementById('secAdmin') : null);
if (!container) return;
const s = store.getState();
const ident = getCurrentFisherIdentity(s);
if (!ident.isOwner) {
container.innerHTML = `
<div class="card" style="border-color:var(--warn);text-align:center;padding:20px;">
<div style="font-size:var(--fs-md);font-weight:900;color:var(--warn);margin-bottom:6px;">🔒 Раздел только для Супер-Админа (Владельца)</div>
<p style="font-size:var(--fs-xs);color:var(--muted);margin-bottom:12px;">Войдите под эксклюзивным логином Владельца (iAthor / iAthor82) для доступа к серверной статистике и базе пользователей.</p>
<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
<button type="button" class="btn btn-accent" id="adminLockedSignInBtn">🔑 Войти как Супер-Админ</button>
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
const allRegs = Array.from(new Set([...Object.keys(regStats), ...Object.keys(counters), ...Object.keys(reserveCounters), '89'])).sort();
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
👑 ПАНЕЛЬ СУПЕР-АДМИНА И СТАТИСТИКА БД «КЛЁВ ПРО V.2.3.0»
</div>
<div style="font-size:var(--fs-xs);color:var(--muted);margin-top:3px;">
Владелец: <b style="color:var(--text);">Антон (${escapeHtml(ident.login)})</b> • Эксклюзивные неприкосновенные ID Владельца:
</div>
<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;align-items:center;">
<button type="button" class="btn btn-sm ${ident.fisherId === OWNER_BOUND_FISHER_ID ? 'btn-good' : ''}" data-switch-owner-fid="${OWNER_BOUND_FISHER_ID}" style="font-family:monospace;font-weight:900;">
${ident.fisherId === OWNER_BOUND_FISHER_ID ? '✓ Активен:' : 'Включить:'} 🆔 ${OWNER_BOUND_FISHER_ID}
</button>
<button type="button" class="btn btn-sm ${ident.fisherId === OWNER_SECONDARY_FISHER_ID ? 'btn-good' : ''}" data-switch-owner-fid="${OWNER_SECONDARY_FISHER_ID}" style="font-family:monospace;font-weight:900;">
${ident.fisherId === OWNER_SECONDARY_FISHER_ID ? '✓ Активен:' : 'Включить:'} 🆔 ${OWNER_SECONDARY_FISHER_ID}
</button>
<button type="button" class="btn btn-sm fisher-id-copy-badge" data-copy-fisher-id="${ident.fisherId}" style="font-family:monospace;">📋 Копировать ${ident.fisherId}</button>
</div>
</div>
<div style="display:flex;gap:6px;flex-wrap:wrap;">
<button type="button" class="btn btn-sm" id="admCloseBackToAppBtn" style="font-weight:900;border-color:var(--accent);color:var(--accent);">
← Назад в приложение (✕ Закрыть)
</button>
<button type="button" class="btn btn-sm btn-accent" id="admRefreshServerBtn">
${_adminDashboardLoading ? '⏳ Загрузка...' : '🔄 Обновить базу'}
</button>
<button type="button" class="btn btn-sm" id="admExportUsersJsonBtn">📥 База (.JSON)</button>
<button type="button" class="btn btn-sm" id="admExportUsersCsvBtn">📊 Таблица (.CSV)</button>
<button type="button" class="btn btn-sm" id="admOpenFullConsoleBtn" data-cloud-open-url="${fullConsoleUrl}">🛡️ Веб-консоль</button>
</div>
</div>
</div>
<!-- 1b. Статус привязки Cloudflare D1 SQL Базы Данных -->
${db.d1Status === 'CONNECTED' ? `
<div class="card" style="border:1.5px solid var(--good);background:rgba(16,185,129,0.12);padding:10px 14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
<div>
<div style="font-weight:900;color:var(--good);font-size:13px;">🟢 Cloudflare D1 База Данных: ПОДКЛЮЧЕНА (${escapeHtml(db.d1BindingName || 'DB')})</div>
<div style="font-size:11px;color:var(--muted);margin-top:2px;">Все постоянные ID, реестр пользователей, чаты и точки Круга сохраняются в SQL-таблицах D1.</div>
</div>
<span class="pill pill-good" style="font-size:11px;font-weight:800;">D1 Engine 2.3.0</span>
</div>
` : `
<div class="card" style="border:1.5px solid var(--warn);background:rgba(245,158,11,0.10);padding:10px 14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
<div style="font-size:12px;color:var(--text);">
Нажмите <b>«🔄 Обновить базу»</b> для загрузки актуального статуса D1 и списка пользователей с сервера.
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
<div style="font-size:11px;color:var(--muted);font-weight:700;">🟢 Постоянных ID (Логин+Пароль)</div>
</div>
<div class="card" style="background:var(--card);padding:10px 12px;">
<div style="font-size:20px;font-weight:900;color:var(--warn);">${reserveUsers.length}</div>
<div style="font-size:11px;color:var(--muted);font-weight:700;">🟡 Временных резервных (FP_XXRZ)</div>
</div>
<div class="card" style="background:var(--card);padding:10px 12px;">
<div style="font-size:20px;font-weight:900;color:var(--good);">${tgBoundUsers.length}</div>
<div style="font-size:11px;color:var(--muted);font-weight:700;">✈️ Привязаны к Telegram</div>
</div>
<div class="card" style="background:var(--card);padding:10px 12px;">
<div style="font-size:20px;font-weight:900;color:var(--text);">${active24h} / ${active7d}</div>
<div style="font-size:11px;color:var(--muted);font-weight:700;">Активны за 24ч / 7 дней</div>
</div>
<div class="card" style="background:var(--card);padding:10px 12px;">
<div style="font-size:15px;font-weight:900;color:var(--accent);">📱 ${apkCount} • 🍏 ${iosCount} • 🌐 ${webCount} • ✈️ ${tgCount}</div>
<div style="font-size:11px;color:var(--muted);font-weight:700;">APK / iOS / Web / TG • Точек: ${srvPoints.length}</div>
</div>
</div>
<!-- 3. Распределение выданных постоянных и резервных ID по регионам РФ -->
<div class="card">
<div style="font-weight:900;font-size:var(--fs-xs);color:var(--accent);margin-bottom:8px;">
🗺️ ВЫДАЧА ПОСТОЯННЫХ (FP_XXAAA) И РЕЗЕРВНЫХ (FP_XXRZ) ID ПО РЕГИОНАМ РФ:
</div>
<div style="display:flex;flex-wrap:wrap;gap:6px;">
${allRegs.map(rc => {
const st = regStats[rc] || { perm: 0, rz: 0 };
const nextPerm = (counters[rc] || 0) + 1;
const nextRz = (reserveCounters[rc] || 0) + 1;
return `
<span style="padding:4px 9px;border-radius:8px;background:var(--panel);border:1px solid var(--border);font-size:11.5px;">
Регион <b>${rc}</b>: <span style="color:var(--good);font-weight:800;">🟢 пост. ${st.perm}</span> (след. #${String(nextPerm).padStart(3, '0')}) •
<span style="color:var(--warn);font-weight:800;">🟡 рез. ${st.rz}</span> (след. RZ${String(nextRz).padStart(4, '0')})
</span>
`;
}).join('')}
</div>
</div>
<!-- 4. Реестр всех пользователей экосистемы -->
<div class="card">
<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
<span class="section-title">👥 Реестр пользователей (${filteredUsers.length} из ${users.length})</span>
<input type="search" id="admUserSearchInput" class="input" value="${escapeHtml(_adminSearchFilter)}" placeholder="🔍 Поиск по ID (FP_...), логину, @username, городу..." style="max-width:340px;min-height:36px;">
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
<tr><td colspan="8" style="padding:14px;text-align:center;color:var(--muted);">Пользователи не найдены (нажмите «🔄 Обновить базу»)</td></tr>
` : filteredUsers.map(u => {
const isRz = isTemporaryReserveId(u.fisherId);
const isOwn = isOwnerFisherId(u.fisherId);
const statusBadge = isOwn
? `<span class="pill pill-good" style="font-size:10px;">👑 ВЛАДЕЛЕЦ</span>`
: (isRz
? `<span class="pill pill-warn" style="font-size:10px;">🟡 Временный RZ</span>`
: `<span class="pill pill-good" style="font-size:10px;">🟢 Постоянный ID</span>`);
const timeStr = u.lastSeen ? new Date(u.lastSeen).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
return `
<tr style="border-bottom:1px solid var(--border);">
<td style="padding:7px 8px;font-family:monospace;font-weight:900;">
<span class="fisher-id-copy-badge" data-copy-fisher-id="${u.fisherId}" style="cursor:pointer;color:${isOwn ? 'var(--good)' : (isRz ? 'var(--warn)' : 'var(--accent)')};">${escapeHtml(u.fisherId)} 📋</span>
</td>
<td style="padding:7px 8px;">${statusBadge}</td>
<td style="padding:7px 8px;">
<b>${escapeHtml(u.login || u.callsign || 'Гость')}</b>
<div style="margin-top:2px;">
${u.tgUsername ? `<span style="padding:1px 6px;border-radius:4px;background:rgba(56,189,248,0.18);color:#38bdf8;font-weight:800;font-size:10.5px;">✈️ @${escapeHtml(u.tgUsername)}</span>` : (u.tgId ? `<span style="padding:1px 6px;border-radius:4px;background:rgba(56,189,248,0.12);color:#38bdf8;font-size:10.5px;">✈️ TG:${escapeHtml(u.tgId)}</span>` : `<span style="color:var(--muted);font-size:10px;">❌ Нет ТГ</span>`)}
</div>
</td>
<td style="padding:7px 8px;">[${escapeHtml(u.regionCode || '89')}] ${escapeHtml(u.locLabel || 'РФ')}</td>
<td style="padding:7px 8px;">${escapeHtml(u.platform || 'WEB')}</td>
<td style="padding:7px 8px;">${u.sessionsCount || 1} / <b>${u.circlePostsCount || 0}</b></td>
<td style="padding:7px 8px;color:var(--muted);">${timeStr}</td>
<td style="padding:7px 8px;text-align:right;">
${!isOwn ? `
<button type="button" class="btn btn-sm" data-adm-del-user="${escapeHtml(u.fisherId)}" data-adm-del-name="${escapeHtml(u.callsign || u.login || u.fisherId)}" style="border-color:var(--bad);color:var(--bad);padding:2px 7px;font-size:11px;">
🗑️ Удалить
</button>
` : `<span style="font-size:10px;color:var(--good);font-weight:900;">👑 Владелец</span>`}
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
<span class="section-title">🛡️ Супервизор закрытых Экипажей (${srvPoints.length} точек) и База Модераторов (${adminList.length})</span>
<div style="font-size:var(--fs-xs);color:var(--muted);">Как Владелец, вы видите все закрытые Экипажи без ввода ключа KP-XXXX и можете удалять любые точки с сервера</div>
</div>
<button type="button" class="btn btn-sm ${showAllCrewsFlag ? 'btn-good' : ''}" id="admToggleAllCrewsBtn">
${showAllCrewsFlag ? '👁️ Видимость всех закрытых Экипажей: ВКЛ' : '🙈 Видимость всех закрытых Экипажей: ВЫКЛ'}
</button>
</div>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;">
<div style="padding:10px;background:var(--panel);border:1px solid var(--border);border-radius:var(--r-sm);">
<div style="font-weight:800;font-size:var(--fs-xs);color:var(--accent);margin-bottom:6px;">➕ ДОБАВИТЬ МОДЕРАТОРА В БАЗУ АДМИНОВ:</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px;">
<input type="text" id="admAddModIdInput" class="input" placeholder="ID (напр. FP_89AAA001)" style="text-transform:uppercase;min-height:34px;font-family:monospace;">
<input type="text" id="admAddModLabelInput" class="input" placeholder="Имя / Примечание" style="min-height:34px;">
</div>
<button type="button" class="btn btn-sm btn-good" id="admAddModConfirmBtn" style="width:100%;">➕ Назначить модератором</button>
<div style="margin-top:8px;display:flex;flex-direction:column;gap:4px;max-height:140px;overflow-y:auto;">
${adminList.map(adm => `
<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;background:var(--card);border:1px solid var(--border);border-radius:6px;font-size:11.5px;">
<span><b style="font-family:monospace;color:var(--good);">${escapeHtml(adm.id)}</b> • ${escapeHtml(adm.label)}</span>
${DEFAULT_ADMIN_IDS.includes(adm.id)
? `<span class="pill pill-good" style="font-size:9.5px;">Владелец</span>`
: `<button type="button" class="btn btn-sm" data-adm-remove-mod="${adm.id}" data-adm-remove-label="${escapeHtml(adm.label)}" style="min-height:24px;padding:1px 6px;color:var(--bad);">✕</button>`}
</div>
`).join('')}
</div>
</div>
<div style="padding:10px;background:var(--panel);border:1px solid var(--border);border-radius:var(--r-sm);">
<div style="font-weight:800;font-size:var(--fs-xs);color:var(--accent);margin-bottom:6px;">📡 АКТИВНЫЕ ТОЧКИ НА СЕРВЕРЕ (${srvPoints.length}):</div>
<div style="display:flex;flex-direction:column;gap:5px;max-height:195px;overflow-y:auto;">
${srvPoints.length === 0 ? `
<div style="font-size:11.5px;color:var(--muted);padding:12px;text-align:center;">Активных точек на сервере сейчас нет</div>
` : srvPoints.map(pt => `
<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;padding:6px 8px;background:var(--card);border:1px solid var(--border);border-radius:6px;font-size:11.5px;">
<div style="min-width:0;flex:1;">
<b>${pt.sos ? '🆘 SOS' : (pt.t === 'crew' ? `🌊 ${pt.crewKey || 'Экипаж'}` : (pt.t === 'workshop' ? '🛠️ Снасть' : '👥 Круг'))}</b> •
${escapeHtml(pt.fn || 'Рыба')} (${escapeHtml(pt.wn || pt.lb || 'Водоём')}) •
<span style="font-family:monospace;color:var(--accent);">${escapeHtml(pt.fid || '')}</span>
</div>
<button type="button" class="btn btn-sm" data-adm-del-srv-point="${pt.id}" data-adm-del-srv-title="${escapeHtml(`${pt.fn || 'Точка'} (${pt.wn || pt.lb || 'Водоём'})`)}" style="min-height:24px;padding:1px 7px;color:var(--bad);">🗑️</button>
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
showToast(`👑 Активный ID Супер-Админа переключён на ${nextFid}`, 'good');
renderAdminSection(container);
});
});
container.querySelector('#admRefreshServerBtn')?.addEventListener('click', () => {
fetchSuperAdminDashboardData(true);
});
container.querySelector('#admOpenFullConsoleBtn')?.addEventListener('click', (e) => {
const url = e.currentTarget.getAttribute('data-cloud-open-url');
if (!url) return;
const iframeHtml = `
<div style="display:flex;flex-direction:column;gap:8px;">
<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;font-size:11.5px;color:var(--muted);">
<span>Для возврата в приложение нажмите «✕ Закрыть» внизу или сделайте жест «Назад».</span>
<button type="button" class="btn btn-sm" id="admModalReloadIframeBtn">🔄 Обновить</button>
</div>
<iframe id="admServerConsoleIframe" src="${escapeHtml(url)}" style="width:100%;height:68vh;border:1px solid var(--border);border-radius:8px;background:#070d19;"></iframe>
</div>
`;
openModal('👑 Серверная веб-консоль Супер-Админа', iframeHtml, (bodyEl) => {
bodyEl?.querySelector('#admModalReloadIframeBtn')?.addEventListener('click', () => {
const ifr = bodyEl.querySelector('#admServerConsoleIframe');
if (ifr) ifr.src = url + '&_t=' + Date.now();
});
}, true);
});
container.querySelector('#admExportUsersJsonBtn')?.addEventListener('click', () => {
const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), version: '2.3.0', total: users.length, users }, null, 2)], { type: 'application/json;charset=utf-8' });
const a = document.createElement('a');
a.href = URL.createObjectURL(blob);
a.download = `klev-pro-users-db-${new Date().toISOString().slice(0, 10)}.json`;
a.click();
showToast('📥 База пользователей (.JSON) выгружена', 'good');
});
container.querySelector('#admExportUsersCsvBtn')?.addEventListener('click', () => {
const header = ['fisherId', 'isTemporaryReserve', 'login', 'callsign', 'tgUsername', 'regionCode', 'locLabel', 'platform', 'sessionsCount', 'circlePostsCount', 'lastSeen'];
const rows = users.map(u => header.map(k => `"${String(u[k] ?? '').replace(/"/g, '""')}"`).join(','));
const csv = '\uFEFF' + header.join(',') + '\n' + rows.join('\n');
const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
const a = document.createElement('a');
a.href = URL.createObjectURL(blob);
a.download = `klev-pro-users-db-${new Date().toISOString().slice(0, 10)}.csv`;
a.click();
showToast('📊 Таблица пользователей (.CSV) выгружена', 'good');
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
showToast(!cur ? '👑 Видимость всех закрытых Экипажей ВКЛЮЧЕНА' : '🙈 Видимость закрытых Экипажей выключена', 'info');
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
showToast(`👑 Модератор ${formattedId} добавлен в базу`, 'good');
renderAdminSection(container);
});
container.querySelectorAll('[data-adm-remove-mod]').forEach(btn => {
btn.addEventListener('click', () => {
const targetId = btn.getAttribute('data-adm-remove-mod');
const targetLabel = btn.getAttribute('data-adm-remove-label') || targetId;
if (!targetId) return;
openConfirmDeleteModal({
title: '👑 Удалить модератора из базы админов?',
message: `Вы действительно хотите снять права модератора с «${escapeHtml(targetLabel)}» (${escapeHtml(targetId)})?`,
confirmLabel: '🗑️ Да, снять права',
onConfirm: () => {
store.dispatch({ type: 'REMOVE_ADMIN_FROM_WHITELIST', payload: targetId });
syncAdminWhitelistWithCloud({ action: 'remove', targetId });
syncCurrentProfileToCloudIfLoggedIn();
showToast(`🗑️ Модератор ${targetId} удалён из базы`, 'info');
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
title: '👑 Удалить точку с сервера и карты?',
message: `Вы действительно хотите удалить точку «${escapeHtml(pTitle)}» (${escapeHtml(pid)}) из базы сервера D1 и с карты у всех пользователей?`,
confirmLabel: '🗑️ Да, удалить точку',
onConfirm: async () => {
await deleteCircleItemFromServer(pid);
const next = (store.getState().circleItems || []).filter(x => x.id !== pid);
storage.saveCircleItems(next);
store.dispatch({ type: 'SET_CIRCLE_ITEMS', payload: next });
await fetchSuperAdminDashboardData(false);
showToast(`🗑️ Точка ${pid} удалена с сервера`, 'info');
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
title: '👑 Удаление аккаунта пользователя из БД',
message: `Вы точно хотите удалить пользователя «${escapeHtml(targetName)}» (${escapeHtml(targetFid)}) и все его данные из серверной базы данных D1? Это действие необратимо.`,
confirmLabel: '🗑️ Удалить из БД',
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
showToast(`🗑️ Пользователь ${targetFid} удалён из базы сервера`, 'good');
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
title: '🗑️ Удалить этот чат?',
message: `Чат «${escapeHtml(targetTitle || targetChanId)}» и его переписка будут удалены с вашего устройства. Если вы или собеседник напишете снова, чат создастся заново.`,
confirmLabel: '🗑️ Да, удалить чат',
onConfirm: () => {
const allMsgs = store.getState().chatMessages || [];
const ident = getCurrentFisherIdentity();
const remaining = allMsgs.filter(m => {
if (!m) return false;
if (m.channelId === targetChanId) return false;
if (targetChanId.startsWith('dm:') && String(m.channelId || '').startsWith('dm:')) {
const otherId = m.senderId === ident.fisherId ? m.peerId : m.senderId;
if (getCanonicalDmChannelId(ident.fisherId, otherId, allMsgs) === targetChanId) return false;
}
return true;
});
storage.saveChatMessages(remaining);
store.dispatch({ type: 'SET_CHAT_MESSAGES', payload: remaining });
store.dispatch({ type: 'DELETE_CHAT_CHANNEL', payload: targetChanId });
storage.saveSettings(store.getState());
if (activeChatChannelId === targetChanId) {
activeChatChannelId = '';
isFullScreenChatOpen = false;
}
syncCircleNavBadge();
showToast('🗑️ Чат удалён', 'info');
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
await importSharePackToken(sharePack.token, true, true);
publishCircleItemToServer(sharePack.packObj, sharePack.token).catch(() => {});
const waterTitle = s.selectedWaterName || WATER_PROFILES[s.water]?.shortName || s.locLabel;
const locMsgText =
`📍 МОЁ МЕСТОПОЛОЖЕНИЕ: ${s.locLabel} (${waterTitle})
` +
`🎯 Координаты: ${Number(s.lat).toFixed(4)}°N, ${Number(s.lon).toFixed(4)}°E • Глубина ~${s.depth} м
` +
`🔗 Код точки: ${sharePack.token}`;
if (isCrew) {
const cKey = activeChatChannelId.replace(/^crew:/, '');
await sendFishermanChatMessage({ channelId: activeChatChannelId, text: locMsgText, crewKey: cKey });
} else {
const parts = activeChatChannelId.replace(/^dm:/, '').split(':');
const ident = getCurrentFisherIdentity();
const peerId = parts.find(p => p !== ident.fisherId) || parts[0] || OWNER_BOUND_FISHER_ID;
await sendFishermanChatMessage({ channelId: activeChatChannelId, text: locMsgText, peerId });
}
showToast('📍 Ваше местоположение отправлено в чат!', 'good');
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
showToast(`🔓 Вы подключились к чату экипажа ${formatted}`, 'good');
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
if (!hasExistingMsgs) {
appendIncomingChatMessage({
id: `sys_${Date.now()}`,
channelId: chanId,
peerId,
peerName: cleanPeerName,
senderId: peerId === OWNER_BOUND_FISHER_ID ? OWNER_BOUND_FISHER_ID : ident.fisherId,
senderName: peerId === OWNER_BOUND_FISHER_ID ? '👑 Админ' : ident.callsign,
text: peerId === OWNER_BOUND_FISHER_ID
? 'Здравствуйте! Здесь вы можете задать вопрос Администратору «Клёв ПРО». Напишите ваше сообщение ниже.'
: `💬 Открыт личный диалог с ${cleanPeerName}.`,
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
openOrReuseDirectChat(OWNER_BOUND_FISHER_ID, '👑 Админ («Клёв ПРО»)');
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
openOrReuseDirectChat(OWNER_BOUND_FISHER_ID, '👑 Админ («Клёв ПРО»)');
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
text: `💬 Открыт личный диалог с ${peerName}.`,
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
showToast('Чужие записи нельзя удалить — используйте кнопку «🙈 Скрыть»', 'warn');
return;
}
openConfirmDeleteModal({
title: '🗑️ Удалить запись из Круга и с карты?',
message: `Запись «${escapeHtml(target?.fn || target?.wn || target?.lb || 'Сводка')}» будет удалена из ленты Круга, с карты и с сервера.`,
confirmLabel: '🗑️ Да, удалить',
onConfirm: () => {
const next = (store.getState().circleItems || []).filter(x => x.id !== id);
storage.saveCircleItems(next);
store.dispatch({ type: 'SET_CIRCLE_ITEMS', payload: next });
deleteCircleItemFromServer(id);
showToast('🗑️ Точка удалена из Круга, с карты и с сервера', 'info');
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
showToast('🙈 Чужая точка скрыта с карты и из ленты', 'info');
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
if (typeof window !== 'undefined' && typeof window.__KLEV_FOCUS_MAP_CIRCLE__ === 'function') {
window.__KLEV_FOCUS_MAP_CIRCLE__(item.id, item.lat, item.lon);
} else {
setLocation(item.lat, item.lon, true);
router.navigate('geo');
}
showToast(
item.sos
? `🆘 Пеленг сигнала SOS: ${item.wn || item.lb}`
: (item.t === 'crew'
? `🌊 Точка Экипажа (${item.crewKey || '72ч'}): ${item.wn || item.lb}`
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
showToast(`✅ Применена оснастка из Мастерской для вида «${item.fn}»!`, 'good');
router.navigate('forecast');
}
});
});
}
let unsub = null;
export async function init(container, chatsContainer = null, adminContainer = null) {
const savedItems = purgeExpiredCircleItems(storage.loadCircleItems ? storage.loadCircleItems() : []);
store.dispatch({ type: 'SET_CIRCLE_ITEMS', payload: savedItems });
const savedChats = storage.loadChatMessages ? storage.loadChatMessages() : [];
store.dispatch({ type: 'SET_CHAT_MESSAGES', payload: savedChats });
const savedNotifs = storage.loadNotifications ? storage.loadNotifications() : [];
store.dispatch({ type: 'SET_NOTIFICATIONS', payload: savedNotifs });
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
ensureFisherIdentityInitialized(true);
});
ensureFisherIdentityInitialized().then(() => {
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
ensureFisherIdentityInitialized(true);
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
