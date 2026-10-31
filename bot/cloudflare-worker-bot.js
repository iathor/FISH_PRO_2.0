// @file bot/cloudflare-worker-bot.js — @KlevProClubBot (V.2.1.1)
// Компактная сборка для Cloudflare Workers (115 рыб, 491 водоём, 609 городов РФ + Triple-Engine $0 DB + E2EE Relay + Обмен точками Круга/Экипажа/SOS + Уникальные Региональные ID FP_89AAA001 & Эксклюзивный VIP ID владельца FP_89VIP089 + Секретная Серверная Консоль Супер-Админа)

const WORKER_VERSION = '2.5.1';
const RESERVE_ID_TTL_MS = 24 * 60 * 60 * 1000; // Временный резервный ID живёт строго не более 24 часов (суток)
const deletedFisherIdsSet = new Set(); // Удалённые вручную через Админ-панель ID (защита от повторной фоновой вставки)
const rateBuckets = new Map();
const transitBoxes = new Map(); // Транзитная очередь зашифрованных пакетов (Zero-Storage: удаляется при доставке/по TTL)
const weatherGridCache = new Map(); // Кэш погоды бота по гео-сетке 0.1° × 0.1° (~8-10 км) на 20 минут
const weatherFullGridCache = new Map(); // Полный Edge-кэш Open-Meteo (past_days=7&forecast_days=10) по сетке 0.1° × 0.1° на 30 минут
const regionSequenceCounters = new Map(); // Счётчики ПОСТОЯННЫХ номеров зарегистрированных рыбаков по регионам РФ (0 -> AAA001 .. 998 -> AAA999, 999 -> AAB001)
const regionReserveCounters = new Map(); // Счётчики ВРЕМЕННЫХ резервных ID без регистрации (FP_XXRZ0001 .. FP_XXRZ9999)
const OWNER_FISHER_ID = 'FP_89VIP089';
const OWNER_SECONDARY_ID = 'FP_FMP089';
const OWNER_ALL_IDS = new Set([OWNER_FISHER_ID, OWNER_SECONDARY_ID]);
const reservedVanityIds = new Set([OWNER_FISHER_ID, OWNER_SECONDARY_ID, 'FP_89A01']); // Забронированные и VIP ID Владельца
const deviceToFisherIdMap = new Map(); // Привязка незарегистрированного устройства deviceId -> временного резервного ID (FP_XXRZYYYY)
const tgToFisherIdMap = new Map(); // Привязка Telegram User ID -> постоянного рыболовного ID (FP_XXAAA001 / FP_89VIP089 / FP_FMP089)
const fisherIdToAuthKeyMap = new Map([
 ['FP_89VIP089', 'OWNER_IATHOR_FP_89VIP089'],
 ['FP_FMP089', 'OWNER_IATHOR_FP_89VIP089']
]); // Привязка выданного постоянного ID -> authKey (позволяет входить как по логину, так и по своему ID!)
const loginToAuthKeyMap = new Map([
 ['iathor', 'OWNER_IATHOR_FP_89VIP089'],
 ['iathor82', 'OWNER_IATHOR_FP_89VIP089'],
 ['thorantony82', 'OWNER_IATHOR_FP_89VIP089'],
 ['fp_89vip089', 'OWNER_IATHOR_FP_89VIP089'],
 ['fp_fmp089', 'OWNER_IATHOR_FP_89VIP089']
]); // Глобальный индекс уникальности логинов (loginNorm -> authKey)
const usersRegistryStore = new Map(); // Реестр всех пользователей экосистемы (APK, Web/PWA, Telegram Mini App, TG Bot)
const circlePointsStore = new Map(); // Серверное хранилище активных точек Круга, Экипажа, SOS и Мастерской (TTL 72ч)
let persistentStateLoaded = false;
let lastEdgePersistTs = 0;

const adminWhitelistStore = new Map([
 [OWNER_FISHER_ID, { id: OWNER_FISHER_ID, label: "iAthor • Антон (Владелец / Основной VIP ID)", addedAt: "2026-10-27" }],
 [OWNER_SECONDARY_ID, { id: OWNER_SECONDARY_ID, label: "iAthor82 • Антон (Владелец / Спец-ID FP_FMP089)", addedAt: "2026-10-27" }]
]);

const WORKER_REGION_RULES = [
 ['сахалин','65'],['курил','65'],['якут','14'],['саха (якут','14'],['костром','44'],['томск','70'],['колпашево','70'],['омск','55'],
 ['ямало','89'],['янао','89'],['уренгой','89'],['салехард','89'],['надым','89'],['ноябрьск','89'],['тарко-сале','89'],['тазовск','89'],['губкинск','89'],['муравленко','89'],
 ['ненецк','83'],['нарьян-мар','83'],['ханты','86'],['хмао','86'],['югра','86'],['сургут','86'],['нижневартовск','86'],
 ['адыге','01'],['майкоп','01'],['башкорт','02'],['башкир','02'],['уфа','02'],['бурят','03'],['улан-удэ','03'],
 ['республика алтай','04'],['горно-алтайск','04'],['алтайск','22'],['барнаул','22'],['дагестан','05'],['махачкал','05'],['дербент','05'],
 ['ингушет','06'],['магас','06'],['кабардино','07'],['нальчик','07'],['калмык','08'],['элист','08'],['карачаево','09'],['черкесск','09'],
 ['карели','10'],['петрозаводск','10'],['коми','11'],['сыктывкар','11'],['воркут','11'],['усинск','11'],['марий эл','12'],['йошкар-ол','12'],
 ['мордов','13'],['саранск','13'],['осети','15'],['алани','15'],['татарстан','16'],['казан','16'],['челны','16'],['тыва','17'],['кызыл','17'],
 ['удмурт','18'],['ижевск','18'],['хакаси','19'],['абакан','19'],['чечен','20'],['грозн','20'],['чуваш','21'],['чебоксар','21'],
 ['краснодар','23'],['сочи','23'],['кубан','23'],['анап','23'],['красноярск','24'],['норильск','24'],['дудинк','24'],
 ['приморск','25'],['владивосток','25'],['находк','25'],['ставропол','26'],['пятигорск','26'],['хабаровск','27'],['комсомольск','27'],
 ['амурск','28'],['благовещенск','28'],['архангел','29'],['северодвинск','29'],['астрахан','30'],['ахтуб','30'],['харабал','30'],
 ['белгород','31'],['брянск','32'],['владимир','33'],['волгоград','34'],['вологод','35'],['воронеж','36'],['ивановск','37'],['иркутск','38'],['братск','38'],
 ['калининград','39'],['калуж','40'],['камчат','41'],['кемеров','42'],['кировск','43'],['киров','43'],['курган','45'],['шадринск','45'],['заурал','45'],
 ['курск','46'],['ленинград','47'],['выборг','47'],['липецк','48'],['магадан','49'],['московск','50'],['подмосков','50'],['москва','77'],['зеленоград','77'],
 ['мурманск','51'],['териберк','51'],['нижегород','52'],['новгородск','53'],['великий новгород','53'],['новосибирск','54'],['оренбург','56'],
 ['орловск','57'],['пенз','58'],['перм','59'],['псков','60'],['ростовск','61'],['ростов-на-дону','61'],['таганрог','61'],['рязан','62'],
 ['самар','63'],['тольятти','63'],['саратов','64'],['свердловск','66'],['екатеринбург','66'],['смоленск','67'],['тамбов','68'],['твер','69'],
 ['тульск','71'],['тюмен','72'],['тобольск','72'],['ульяновск','73'],['челябинск','74'],['магнитогорск','74'],['забайкал','75'],['чита','75'],
 ['ярослав','76'],['рыбинск','76'],['санкт-петербург','78'],['петербург','78'],['еврейск','79'],['биробиджан','79'],
 ['донецк','80'],['днр','80'],['луганск','81'],['лнр','81'],['севастопол','92'],['крым','82'],['симферопол','82'],['ялт','82'],
 ['херсон','84'],['запорож','85'],['чукот','87'],['анадыр','87']
];

function workerFnv1a32(str = '') {
 let h = 0x811c9dc5;
 const s = String(str || '');
 for (let i = 0; i < s.length; i++) {
  h ^= s.charCodeAt(i);
  h = Math.imul(h, 0x01000193);
 }
 return h >>> 0;
}

function workerSafeJsonParse(rawStr, fallback = null) {
 if (!rawStr || typeof rawStr !== 'string') return fallback;
 try {
  return JSON.parse(rawStr, (k, v) => (k === '__proto__' || k === 'constructor' || k === 'prototype') ? undefined : v);
 } catch (e) {
  return fallback;
 }
}

function workerSanitizeObject(obj) {
 if (!obj || typeof obj !== 'object') return {};
 try {
  return workerSafeJsonParse(JSON.stringify(obj), {});
 } catch (e) {
  return {};
 }
}

function constantTimeEquals(a = '', b = '') {
 const sa = String(a || '');
 const sb = String(b || '');
 if (sa.length !== sb.length) return false;
 let diff = 0;
 for (let i = 0; i < sa.length; i++) {
  diff |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
 }
 return diff === 0;
}

function workerDeriveAuthToken(loginNorm = '', passClean = '') {
 const cleanL = String(loginNorm || '').trim().toLowerCase().replace(/^@/, '');
 const cleanP = String(passClean || '').trim();
 let h1 = workerFnv1a32(`klev_auth_v2::${cleanL}::${cleanP}::KlevProCircle_v2.1_Salt_RU`);
 let h2 = workerFnv1a32(`salt2::${cleanP}::${cleanL}::${h1}`);
 for (let i = 0; i < 64; i++) {
  h1 = workerFnv1a32(`${h1}:${h2}:${i}:${cleanL}`);
  h2 = workerFnv1a32(`${h2}:${h1}:${i}:KlevProCircle_v2.1_Salt_RU`);
 }
 return `KTOK_${h1.toString(16).toUpperCase().padStart(8, '0')}_${h2.toString(16).toUpperCase().padStart(8, '0')}`;
}

function workerResolveRegionCode(rawRegionOrSnap = '') {
 if (typeof rawRegionOrSnap === 'string' && /^\d{2}$/.test(rawRegionOrSnap.trim())) {
  const d = rawRegionOrSnap.trim();
  return d === '00' ? '89' : d;
 }
 const text = typeof rawRegionOrSnap === 'object' && rawRegionOrSnap
  ? `${rawRegionOrSnap.locAdmin1 || ''} ${rawRegionOrSnap.locLabel || ''} ${rawRegionOrSnap.locAdmin2 || ''}`
  : String(rawRegionOrSnap || '');
 const norm = text.toLowerCase().replace(/ё/g, 'е');
 for (const [kw, code] of WORKER_REGION_RULES) {
  if (norm.includes(kw)) return code;
 }
 return '89';
}

function workerFormatFisherIdFromIndex(regionCode = '89', index0Based = 0) {
 const regDigits = String(regionCode || '89').replace(/\D/g, '').padStart(2, '0').slice(-2);
 const reg = regDigits === '00' ? '89' : regDigits;
 const idx = Math.max(0, Math.floor(Number(index0Based) || 0));
 const num = (idx % 999) + 1; // Строго 001..999 (без 000!)
 const letterBlock = Math.floor(idx / 999) % 17576;
 const c1 = String.fromCharCode(65 + (Math.floor(letterBlock / 676) % 26));
 const c2 = String.fromCharCode(65 + (Math.floor(letterBlock / 26) % 26));
 const c3 = String.fromCharCode(65 + (letterBlock % 26));
 return `FP_${reg}${c1}${c2}${c3}${String(num).padStart(3, '0')}`;
}

function workerFormatReserveFisherId(regionCode = '89', seq1Based = 1) {
 const regDigits = String(regionCode || '89').replace(/\D/g, '').padStart(2, '0').slice(-2);
 const reg = regDigits === '00' ? '89' : regDigits;
 const num = ((Math.max(1, Math.floor(Number(seq1Based) || 1)) - 1) % 9999) + 1;
 return `FP_${reg}RZ${String(num).padStart(4, '0')}`;
}

function isTemporaryReserveId(fid = '') {
 return /^FP_\d{2}RZ\d{4}$/i.test(String(fid || '').trim());
}

function isOwnerFisherId(fid = '') {
 const clean = String(fid || '').trim().toUpperCase();
 return clean === OWNER_FISHER_ID || clean === OWNER_SECONDARY_ID || clean === 'FP_89A01';
}

function isReservedOrVipFisherId(candidate = '') {
 const clean = String(candidate || '').trim().toUpperCase();
 if (!clean) return true;
 if (reservedVanityIds.has(clean)) return true;
 if (isOwnerFisherId(clean)) return true;
 if (/^FP_\d{2}VIP\d{3}$/.test(clean) || /^FP_VIP\d{3}$/.test(clean)) return true;
 return false;
}

function workerDecodeFisherIdFrom32Bit(val32) {
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

function workerNormalizeFisherId(rawStr = '', fallbackRegion = '89') {
 const clean = String(rawStr || '').trim().toUpperCase().replace(/-/g, '_');
 if (!clean) return '';
 if (clean === 'FP_89VIP089' || clean === '89VIP089' || clean === 'FP_89A01') return OWNER_FISHER_ID;
 if (clean === 'FP_FMP089' || clean === 'FMP089') return OWNER_SECONDARY_ID;
 const rzMatch = clean.match(/^(?:FP_)?(\d{2})RZ(\d{4})$/);
 if (rzMatch) {
  const numVal = Math.max(1, Math.min(9999, parseInt(rzMatch[2], 10) || 1));
  return `FP_${rzMatch[1]}RZ${String(numVal).padStart(4, '0')}`;
 }
 const regMatch = clean.match(/^(?:FP_)?(\d{2})([A-Z]{3})(\d{3})$/);
 if (regMatch) {
  const numVal = Math.max(1, Math.min(999, parseInt(regMatch[3], 10) || 1));
  return `FP_${regMatch[1]}${regMatch[2]}${String(numVal).padStart(3, '0')}`;
 }
 const vipMatch = clean.match(/^(?:FP_)?([A-Z]{3})(\d{3})$/);
 if (vipMatch) {
  const numVal = Math.max(1, Math.min(999, parseInt(vipMatch[2], 10) || 1));
  return `FP_${vipMatch[1]}${String(numVal).padStart(3, '0')}`;
 }
 return '';
}

function allocateNextRegionalFisherId(regionCode = '89') {
 const reg = workerResolveRegionCode(regionCode);
 let seq = regionSequenceCounters.get(reg) || 0;
 let candidate = workerFormatFisherIdFromIndex(reg, seq);
 while (isReservedOrVipFisherId(candidate) || usersRegistryStore.has(candidate)) {
  seq += 1;
  candidate = workerFormatFisherIdFromIndex(reg, seq);
 }
 regionSequenceCounters.set(reg, seq + 1);
 reservedVanityIds.add(candidate);
 return candidate;
}

function allocateNextReserveFisherId(regionCode = '89', seedDeviceId = '') {
 const reg = workerResolveRegionCode(regionCode);
 let seq = (regionReserveCounters.get(reg) || 0) + 1;
 if (seq > 9999) seq = 1;
 let candidate = workerFormatReserveFisherId(reg, seq);
 let guard = 0;
 while (usersRegistryStore.has(candidate) && guard < 9999) {
  seq = (seq % 9999) + 1;
  candidate = workerFormatReserveFisherId(reg, seq);
  guard++;
 }
 regionReserveCounters.set(reg, seq);
 return candidate;
}

// Предвычисленные криптографические дайджесты Владельца (без хранения открытого пароля в исходном коде)
const OWNER_TOKEN_HASH_IATHOR = 'KTOK_6AE3BD91_21C90CF5';
const OWNER_TOKEN_HASH_IATHOR82 = 'KTOK_52183B6B_39DEECFC';
const OWNER_TOKEN_HASH_IATHOR_LOWER = 'KTOK_1E665A58_64E3DB80';
const OWNER_ADMIN_CONSOLE_TOKEN = 'VIP089_D854A7F4_38D816DA';
const OWNER_PIN_FNV_EXACT = '5c4be2a9';
const OWNER_PIN_FNV_LOWER = '17b24989';
const recentActionDedupMap = new Map();

function clampLat(val, fallback = 66.0833) {
 const n = Number(val);
 return Number.isFinite(n) ? Math.max(-90, Math.min(90, n)) : fallback;
}

function clampLon(val, fallback = 76.6333) {
 const n = Number(val);
 return Number.isFinite(n) ? Math.max(-180, Math.min(180, n)) : fallback;
}

function isOwnerPasswordMatch(rawPass = '', env = null) {
 const clean = String(rawPass || '').trim();
 if (!clean) return false;
 if (env && env.ADMIN_SECRET_PASSWORD && constantTimeEquals(clean, String(env.ADMIN_SECRET_PASSWORD))) {
  return true;
 }
 const hExact = workerFnv1a32(`pin::${clean}`).toString(16);
 const hLower = workerFnv1a32(`pin::${clean.toLowerCase()}`).toString(16);
 const derived1 = workerDeriveAuthToken('iathor', clean);
 const derived2 = workerDeriveAuthToken('iathor82', clean);
 return (
  constantTimeEquals(hExact, OWNER_PIN_FNV_EXACT) ||
  constantTimeEquals(hLower, OWNER_PIN_FNV_LOWER) ||
  constantTimeEquals(derived1, OWNER_TOKEN_HASH_IATHOR) ||
  constantTimeEquals(derived1, OWNER_TOKEN_HASH_IATHOR_LOWER) ||
  constantTimeEquals(derived2, OWNER_TOKEN_HASH_IATHOR82)
 );
}

function getAdminConsoleToken(env = null) {
 if (env && env.ADMIN_CONSOLE_TOKEN && String(env.ADMIN_CONSOLE_TOKEN).trim().length >= 12) {
  return String(env.ADMIN_CONSOLE_TOKEN).trim();
 }
 return OWNER_ADMIN_CONSOLE_TOKEN;
}

function isValidOwnerAdminToken(tok = '', env = null) {
 const clean = String(tok || '').trim();
 if (!clean) return false;
 const envConsoleTok = getAdminConsoleToken(env);
 return (
  constantTimeEquals(clean, envConsoleTok) ||
  constantTimeEquals(clean, OWNER_ADMIN_CONSOLE_TOKEN) ||
  constantTimeEquals(clean, OWNER_TOKEN_HASH_IATHOR) ||
  constantTimeEquals(clean, OWNER_TOKEN_HASH_IATHOR82) ||
  constantTimeEquals(clean, OWNER_TOKEN_HASH_IATHOR_LOWER) ||
  isOwnerPasswordMatch(clean, env)
 );
}

function parseCookieValue(cookieHeader = '', cookieName = 'klev_admin_session') {
 if (!cookieHeader || typeof cookieHeader !== 'string') return '';
 const parts = cookieHeader.split(';');
 for (const part of parts) {
  const [k, ...rest] = part.trim().split('=');
  if (k === cookieName) return decodeURIComponent(rest.join('=') || '').trim();
 }
 return '';
}

function extractAdminTokenFromRequest(request, reqUrl, body = null) {
 if (body && typeof body === 'object') {
  const fromBody = body.adminToken || body.token || body.ownerSecret || '';
  if (fromBody) return String(fromBody).trim();
 }
 if (request && request.headers) {
  const hdrTok = request.headers.get('X-Admin-Token') || request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (hdrTok) return String(hdrTok).trim();
  const cookieTok = parseCookieValue(request.headers.get('Cookie') || '', 'klev_admin_session');
  if (cookieTok) return cookieTok;
 }
 if (reqUrl && reqUrl.searchParams) {
  return String(reqUrl.searchParams.get('adminToken') || reqUrl.searchParams.get('token') || '').trim();
 }
 return '';
}

async function workerSha256Hex(inputStr = '') {
 const str = String(inputStr || '');
 if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
  try {
   const data = new TextEncoder().encode(str);
   const hashBuf = await crypto.subtle.digest('SHA-256', data);
   return Array.from(new Uint8Array(hashBuf), b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  } catch (e) {}
 }
 let h1 = workerFnv1a32(`sha_fb1::${str}`);
 let h2 = workerFnv1a32(`sha_fb2::${str}::${h1}`);
 let h3 = workerFnv1a32(`sha_fb3::${h2}::${str}`);
 let h4 = workerFnv1a32(`sha_fb4::${h3}::${h1}`);
 return [h1, h2, h3, h4].map(n => (n >>> 0).toString(16).toUpperCase().padStart(8, '0')).join('');
}

async function workerDeriveSecureAuthToken(loginNorm = '', passClean = '', env = null) {
 const cleanL = String(loginNorm || '').trim().toLowerCase().replace(/^@/, '');
 const cleanP = String(passClean || '').trim();
 const salt = (env && env.AUTH_SERVER_SALT) ? String(env.AUTH_SERVER_SALT) : 'KlevProCircle_v2.3_ServerSalt_RU';
 const hex = await workerSha256Hex(`klev_auth_sha256::${cleanL}::${cleanP}::${salt}`);
 return `KTOK2_${hex.slice(0, 16)}_${hex.slice(16, 32)}`;
}

async function verifyTelegramWebAppInitData(initDataRaw = '', botToken = '') {
 if (!initDataRaw || !botToken || typeof initDataRaw !== 'string') return false;
 try {
  const params = new URLSearchParams(initDataRaw);
  const hash = params.get('hash') || '';
  if (!hash) return false;
  params.delete('hash');
  const sorted = Array.from(params.entries())
   .sort(([a], [b]) => a.localeCompare(b))
   .map(([k, v]) => `${k}=${v}`)
   .join('\n');
  const enc = new TextEncoder();
  const secretKey = await crypto.subtle.importKey('raw', enc.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const secretBytes = await crypto.subtle.sign('HMAC', secretKey, enc.encode(botToken));
  const dataKey = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBytes = await crypto.subtle.sign('HMAC', dataKey, enc.encode(sorted));
  const calcHex = Array.from(new Uint8Array(sigBytes), b => b.toString(16).padStart(2, '0')).join('');
  return constantTimeEquals(calcHex.toLowerCase(), hash.toLowerCase());
 } catch (e) {
  return false;
 }
}

function pickAllowedProfileFields(snap = null) {
 if (!snap || typeof snap !== 'object') return {};
 const out = {};
 if (typeof snap.callsign === 'string') out.callsign = snap.callsign.trim().slice(0, 48);
 if (typeof snap.deviceId === 'string') out.deviceId = snap.deviceId.trim().slice(0, 80);
 if (typeof snap.tgLinkedId === 'string' || typeof snap.tgLinkedId === 'number') out.tgLinkedId = String(snap.tgLinkedId).trim().slice(0, 32);
 if (typeof snap.tgUsername === 'string') out.tgUsername = snap.tgUsername.trim().replace(/^@/, '').slice(0, 48);
 if (typeof snap.pinHash === 'string') out.pinHash = snap.pinHash.trim().slice(0, 64);
 if (typeof snap.appMode === 'string' && ['novice', 'angler', 'pro'].includes(snap.appMode)) out.appMode = snap.appMode;
 if (typeof snap.theme === 'string' && ['auto', 'dark', 'light'].includes(snap.theme)) out.theme = snap.theme;
 if (snap.lat !== undefined) out.lat = clampLat(snap.lat, 66.0833);
 if (snap.lon !== undefined) out.lon = clampLon(snap.lon, 76.6333);
 if (typeof snap.locLabel === 'string') out.locLabel = snap.locLabel.trim().slice(0, 80);
 if (typeof snap.locAdmin1 === 'string') out.locAdmin1 = snap.locAdmin1.trim().slice(0, 80);
 if (typeof snap.locAdmin2 === 'string') out.locAdmin2 = snap.locAdmin2.trim().slice(0, 80);
 if (typeof snap.water === 'string') out.water = snap.water.trim().slice(0, 32);
 if (typeof snap.method === 'string') out.method = snap.method.trim().slice(0, 32);
 if (Array.isArray(snap.preferredWaters)) out.preferredWaters = snap.preferredWaters.map(x => String(x || '').slice(0, 32)).slice(0, 10);
 if (Array.isArray(snap.preferredMethods)) out.preferredMethods = snap.preferredMethods.map(x => String(x || '').slice(0, 32)).slice(0, 12);
 if (Array.isArray(snap.favorites)) out.favorites = snap.favorites.map(x => String(x || '').slice(0, 32)).slice(0, 40);
 if (Array.isArray(snap.unlockedCrewKeys)) out.unlockedCrewKeys = snap.unlockedCrewKeys.map(x => String(x || '').trim().toUpperCase().slice(0, 16)).slice(0, 50);
 if (Array.isArray(snap.deletedChatChannels)) out.deletedChatChannels = snap.deletedChatChannels.map(x => String(x || '').slice(0, 64)).slice(0, 60);
 if (Array.isArray(snap.hiddenCircleIds)) out.hiddenCircleIds = snap.hiddenCircleIds.map(x => String(x || '').slice(0, 64)).slice(0, 100);
 if (Array.isArray(snap.savedSpots)) {
  out.savedSpots = snap.savedSpots.slice(0, 25).map(sp => ({
   id: String(sp?.id || '').slice(0, 48),
   name: String(sp?.name || '').slice(0, 48),
   lat: clampLat(sp?.lat, 66.0833),
   lon: clampLon(sp?.lon, 76.6333),
   water: String(sp?.water || 'small_river').slice(0, 32),
   depth: Math.max(0.1, Math.min(200, Number(sp?.depth) || 2))
  }));
 }
 if (snap.notifSettings && typeof snap.notifSettings === 'object') {
  out.notifSettings = {
   sos: snap.notifSettings.sos !== false,
   crew: snap.notifSettings.crew !== false,
   circle: snap.notifSettings.circle !== false,
   workshop: snap.notifSettings.workshop !== false,
   dm: snap.notifSettings.dm !== false,
   sound: snap.notifSettings.sound !== false
  };
 }
 return out;
}

function sanitizePublicUserResponse(u, isAdminView = false) {
 if (!u || typeof u !== 'object') return null;
 if (isAdminView) {
  const copy = { ...u };
  delete copy.authShadow;
  delete copy.authTokenHash;
  delete copy.pinHash;
  delete copy.adminSessionToken;
  return copy;
 }
 return {
  fisherId: u.fisherId || '',
  login: u.login || '',
  callsign: u.callsign || 'Рыболов',
  regionCode: u.regionCode || '89',
  locLabel: u.locLabel || '',
  isOwner: Boolean(u.isOwner),
  isAdmin: Boolean(u.isAdmin),
  isTemporaryReserve: Boolean(u.isTemporaryReserve)
 };
}

async function verifyUserAuth(env, { fid = '', authTokenHash = '', deviceId = '', adminToken = '', request = null } = {}) {
 const hdrAuth = request?.headers?.get('X-Auth-Token') || '';
 const hdrAdm = request?.headers?.get('X-Admin-Token') || parseCookieValue(request?.headers?.get('Cookie') || '', 'klev_admin_session') || '';
 const effToken = String(authTokenHash || hdrAuth || '').trim();
 const effAdmin = String(adminToken || hdrAdm || '').trim();

 if (isValidOwnerAdminToken(effAdmin, env) || isValidOwnerAdminToken(effToken, env)) {
  return { ok: true, isAdmin: true, isOwner: true };
 }
 const normFid = workerNormalizeFisherId(fid || '', '89');
 if (!normFid) return { ok: false, isAdmin: false, isOwner: false };
 if (isOwnerFisherId(normFid)) {
  return { ok: false, isAdmin: false, isOwner: false };
 }
 if (isTemporaryReserveId(normFid)) {
  return { ok: true, isAdmin: false, isOwner: false, isReserve: true };
 }

 const aKey = fisherIdToAuthKeyMap.get(normFid) || '';
 const prof = (aKey ? cloudAuthProfiles.get(aKey) : null) || (await loadPersistedAuthProfile(env, aKey, '', normFid));
 const regUser = usersRegistryStore.get(normFid) || null;

 if (effToken && prof) {
  if (
   (prof.authTokenHash && constantTimeEquals(effToken, prof.authTokenHash)) ||
   (prof.secureTokenHash && constantTimeEquals(effToken, prof.secureTokenHash))
  ) {
   return { ok: true, isAdmin: adminWhitelistStore.has(normFid), isOwner: false };
  }
 }

 const cleanDev = String(deviceId || '').trim();
 if (cleanDev) {
  const mappedFid = deviceToFisherIdMap.get(cleanDev) || '';
  if (
   (mappedFid && constantTimeEquals(mappedFid, normFid)) ||
   (prof?.deviceId && constantTimeEquals(cleanDev, prof.deviceId)) ||
   (regUser?.deviceId && constantTimeEquals(cleanDev, regUser.deviceId))
  ) {
   return { ok: true, isAdmin: adminWhitelistStore.has(normFid), isOwner: false };
  }
 }

 // Для обратной совместимости с уже выданными сессиями v2.5.0 r186, если профиль ещё не связан с другим устройством
 if (!prof && !regUser) {
  return { ok: true, isAdmin: false, isOwner: false };
 }
 if (prof && !prof.deviceId && (!regUser || !regUser.deviceId) && !effToken) {
  return { ok: true, isAdmin: adminWhitelistStore.has(normFid), isOwner: false };
 }
 return { ok: false, isAdmin: false, isOwner: false };
}

function isDuplicateRecentAction(dedupKey = '', ttlMs = 15000) {
 if (!dedupKey) return false;
 const now = Date.now();
 if (recentActionDedupMap.size > 1000) {
  for (const [k, ts] of recentActionDedupMap.entries()) {
   if (now - ts > ttlMs) recentActionDedupMap.delete(k);
  }
 }
 const prev = recentActionDedupMap.get(dedupKey) || 0;
 if (now - prev < ttlMs) return true;
 recentActionDedupMap.set(dedupKey, now);
 return false;
}

function workerNormalizeLogin(raw = '') {
 return String(raw || '').trim().toLowerCase().replace(/[@\s]/g, '');
}

function workerIsAnonymousCallsignValid(rawLogin = '') {
 const s = String(rawLogin || '').trim();
 if (!s || /^FP_/i.test(s) || workerIsOwnerLogin(s)) return { ok: true };
 const withoutLeadingAt = s.replace(/^@+/, '');
 const hasEmailPattern = withoutLeadingAt.includes('@') || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
 const digitsOnly = s.replace(/\D/g, '');
 const hasPhonePattern = /(?:\+7|7|8)[\s\-()]?\d{3}[\s\-()]?\d{3}[\s\-()]?\d{2}/.test(s) || digitsOnly.length >= 9;
 if (hasEmailPattern || hasPhonePattern) {
  return {
   ok: false,
   error: 'В целях конфиденциальности (152-ФЗ) запрещено указывать номер телефона или e-mail в качестве позывного. Используйте вымышленный рыболовный никнейм.'
  };
 }
 return { ok: true };
}

function workerIsOwnerLogin(raw = '') {
 const n = workerNormalizeLogin(raw);
 return (
  n === 'iathor' ||
  n === 'iathor82' ||
  n === 'thorantony82' ||
  n === 'fp_89vip089' ||
  n === 'fp_fmp089' ||
  n === 'antonthor' ||
  n === '89vip089' ||
  n === 'fmp089'
 );
}

function resolveWorkerAccountIdentity(rawLogin = '', rawPassword = '', rawTokenHash = '', rawRegionCode = '89', snap = null) {
 const rawInputClean = String(rawLogin || '').trim().slice(0, 48);
 let loginClean = rawInputClean;
 let loginNorm = workerNormalizeLogin(loginClean);
 const passClean = String(rawPassword || '').trim();
 const incomingTok = String(rawTokenHash || '').trim();

 const isOwnerLogin = workerIsOwnerLogin(loginClean) || workerIsOwnerLogin(snap?.login) || isOwnerFisherId(snap?.fisherId);
 const isOwnerPass = (
  isOwnerPasswordMatch(passClean) ||
  (incomingTok && isValidOwnerAdminToken(incomingTok))
 );
 if (isOwnerLogin && isOwnerPass) {
  const preferredOwnerFid = (loginNorm === 'fp_fmp089' || String(snap?.fisherId || '').toUpperCase() === OWNER_SECONDARY_ID)
   ? OWNER_SECONDARY_ID
   : OWNER_FISHER_ID;
  return {
   ok: true,
   isOwner: true,
   authKey: 'OWNER_IATHOR_FP_89VIP089',
   fisherId: preferredOwnerFid,
   ownerIds: [OWNER_FISHER_ID, OWNER_SECONDARY_ID],
   login: loginNorm === 'iathor82' ? 'iAthor82' : 'iAthor',
   callsign: loginNorm === 'iathor82' ? 'iAthor82' : 'iAthor',
   pinHash: 'owner_iathor_vip089',
   authTokenHash: OWNER_TOKEN_HASH_IATHOR,
   adminSessionToken: OWNER_ADMIN_CONSOLE_TOKEN
  };
 }

 if (isOwnerLogin && !isOwnerPass) {
  return { ok: false, error: 'Неверный пароль для эксклюзивного аккаунта Супер-Админа (iAthor / FP_89VIP089 / FP_FMP089)' };
 }

 // Если пользователь ввёл свой постоянный Рыболовный ID (напр. FP_89AAA001) вместо логина — находим привязанный к нему профиль!
 const normalizedAsFid = workerNormalizeFisherId(rawInputClean, '89');
 if (normalizedAsFid && !isTemporaryReserveId(normalizedAsFid)) {
  const mappedKey = fisherIdToAuthKeyMap.get(normalizedAsFid);
  const mappedProf = mappedKey ? cloudAuthProfiles.get(mappedKey) : null;
  if (mappedProf && mappedProf.login) {
   loginClean = mappedProf.login;
   loginNorm = String(mappedProf.login).trim().toLowerCase().replace(/^@/, '');
  }
 }

 if (!loginNorm || (passClean.length < 3 && !incomingTok.startsWith('KTOK_'))) {
  return { ok: false, error: 'Укажите логин и пароль (от 3 символов) для получения постоянного ID рыбака' };
 }
 const anonWorkerCheck = workerIsAnonymousCallsignValid(loginClean);
 if (!anonWorkerCheck.ok) {
  return { ok: false, error: anonWorkerCheck.error };
 }

 const authTokenHash = incomingTok.startsWith('KTOK_')
  ? incomingTok
  : workerDeriveAuthToken(loginNorm, passClean);
 const pinHash = passClean
  ? workerFnv1a32(`pin::${passClean}`).toString(16)
  : String(snap?.pinHash || workerFnv1a32(authTokenHash).toString(16));

 // Проверяем глобальную уникальность логина: постоянный ID жёстко привязан ТОЛЬКО к логину и паролю!
 let existingAuthKey = loginToAuthKeyMap.get(loginNorm) || '';
 if (!existingAuthKey) {
  for (const [k, prof] of cloudAuthProfiles.entries()) {
   if (prof && String(prof.login || '').trim().toLowerCase().replace(/^@/, '') === loginNorm) {
    existingAuthKey = k;
    loginToAuthKeyMap.set(loginNorm, k);
    break;
   }
  }
 }
 if (existingAuthKey) {
  const boundProf = cloudAuthProfiles.get(existingAuthKey);
  if (boundProf && boundProf.authTokenHash && !constantTimeEquals(authTokenHash, boundProf.authTokenHash)) {
   return {
    ok: false,
    code: 'LOGIN_TAKEN',
    error: `Логин «${loginClean}» уже зарегистрирован (или введён неверный пароль)! Проверьте пароль или выберите другой логин.`
   };
  }
 }

 const authKey = existingAuthKey || `AUTH_${loginNorm}_${authTokenHash}`;
 loginToAuthKeyMap.set(loginNorm, authKey);
 const existingProf = cloudAuthProfiles.get(authKey);
 const regCode = workerResolveRegionCode(rawRegionCode || snap);

 // Постоянный ID выдаётся ОДИН РАЗ при регистрации логина+пароля и жёстко хранится в профиле логина+пароля (НЕ привязан к железу телефона!)
 let fisherId = existingProf?.fisherId ? workerNormalizeFisherId(existingProf.fisherId, regCode) : '';
 if (!fisherId || isOwnerFisherId(fisherId) || isTemporaryReserveId(fisherId)) {
  fisherId = allocateNextRegionalFisherId(regCode);
 }
 fisherIdToAuthKeyMap.set(fisherId, authKey);

 // Если до регистрации на этом устройстве был временный резервный ID (FP_XXRZYYYY), очищаем временный резерв
 const prevDevId = String(snap?.deviceId || '').trim();
 const prevTempFid = prevDevId ? deviceToFisherIdMap.get(prevDevId) : '';
 if (prevTempFid && isTemporaryReserveId(prevTempFid)) {
  usersRegistryStore.delete(prevTempFid);
  deviceToFisherIdMap.delete(prevDevId);
 }
 const snapTempFid = workerNormalizeFisherId(snap?.fisherId || '', regCode);
 if (snapTempFid && isTemporaryReserveId(snapTempFid)) {
  usersRegistryStore.delete(snapTempFid);
 }

 return {
  ok: true,
  isOwner: false,
  authKey,
  fisherId,
  login: existingProf?.login || loginClean,
  callsign: existingProf?.callsign || loginClean,
  pinHash,
  authTokenHash,
  adminSessionToken: ''
 };
}

const cloudAuthProfiles = new Map([
 ['OWNER_IATHOR_FP_89VIP089', {
  fisherId: OWNER_FISHER_ID,
  login: 'iAthor',
  callsign: 'iAthor',
  pinHash: 'owner_iathor_vip089',
  authTokenHash: OWNER_TOKEN_HASH_IATHOR,
  adminSessionToken: OWNER_ADMIN_CONSOLE_TOKEN,
  ownerUnlocked: true,
  isAdmin: true,
  adminShowAllCrews: true,
  appMode: 'pro',
  theme: 'auto',
  lat: 66.0833,
  lon: 76.6333,
  locLabel: 'Новый Уренгой',
  locAdmin1: 'Ямало-Ненецкий АО',
  locAdmin2: 'Новый Уренгой',
  water: 'small_river',
  method: 'spin_micro',
  favorites: ['pike', 'perch', 'burbot', 'peled', 'dace', 'chir', 'pizhyan', 'ide'],
  unlockedCrewKeys: [],
  notifSettings: { sos: true, crew: true, circle: true, workshop: true, dm: true, sound: true },
  updatedAt: 1730000000000
 }]
]);

usersRegistryStore.set(OWNER_FISHER_ID, {
 fisherId: OWNER_FISHER_ID,
 deviceId: 'owner_master_vip089',
 login: 'iAthor',
 callsign: 'iAthor',
 tgId: '',
 tgUsername: 'iAthor',
 regionCode: '89',
 locLabel: 'Новый Уренгой',
 platform: 'ADMIN-MASTER',
 version: WORKER_VERSION,
 isOwner: true,
 isAdmin: true,
 firstSeen: 1730000000000,
 lastSeen: Date.now(),
 sessionsCount: 1,
 circlePostsCount: 0,
 lat: 66.0833,
 lon: 76.6333
});

function upsertUserInRegistry(params = {}, env = null) {
 if (!params || !params.fisherId) return null;
 const fid = params.fisherId;
 const isOwner = isOwnerFisherId(fid) || (params.login && workerIsOwnerLogin(params.login));
 const isAdmin = isOwner || adminWhitelistStore.has(fid);
 const isTemp = isTemporaryReserveId(fid);

 const existing = usersRegistryStore.get(fid) || {};
 const now = Date.now();

 const user = {
  fisherId: fid,
  deviceId: params.deviceId || existing.deviceId || '',
  login: params.login !== undefined ? params.login : (existing.login || ''),
  callsign: params.callsign || existing.callsign || (isOwner ? 'iAthor' : (params.login || 'Рыболов')),
  tgId: params.tgId || existing.tgId || '',
  tgUsername: params.tgUsername !== undefined ? params.tgUsername : (existing.tgUsername || ''),
  regionCode: workerResolveRegionCode(params.regionCode || existing.regionCode || fid.slice(3, 5) || '89'),
  locLabel: params.locLabel || existing.locLabel || 'Водоём РФ',
  platform: params.platform || existing.platform || 'WEB',
  version: params.version || existing.version || WORKER_VERSION,
  isOwner: Boolean(isOwner),
  isAdmin: Boolean(isAdmin),
  isTemporaryReserve: Boolean(isTemp),
  firstSeen: existing.firstSeen || now,
  lastSeen: now,
  sessionsCount: (existing.sessionsCount || 0) + (params.incrementSession ? 1 : 0),
  circlePostsCount: (existing.circlePostsCount || 0) + (params.incrementPosts ? 1 : 0),
  lat: Number.isFinite(Number(params.lat)) ? Number(params.lat) : (existing.lat || 0),
  lon: Number.isFinite(Number(params.lon)) ? Number(params.lon) : (existing.lon || 0)
 };

 usersRegistryStore.set(fid, user);

 if (user.deviceId && !isTemp) {
  deviceToFisherIdMap.set(user.deviceId, fid);
 }
 if (user.tgId) {
  tgToFisherIdMap.set(String(user.tgId), fid);
 }
 // loginToAuthKeyMap обновляется только реальным authKey (AUTH_<login>_<tokenHash>) при авторизации
 if (!isTemp) {
  reservedVanityIds.add(fid);
 }

 if (env) {
  d1SaveUser(env, user).catch(() => {});
 }

 return user;
}



const CORS_HEADERS = {
 'Access-Control-Allow-Origin': '*',
 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
 'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, X-Requested-With, X-Auth-Token, X-Admin-Token',
 'Access-Control-Max-Age': '86400',
 'Cache-Control': 'no-store, no-cache, must-revalidate',
 'Pragma': 'no-cache',
 'Alt-Svc': 'clear',
 'X-Content-Type-Options': 'nosniff',
 'X-Frame-Options': 'SAMEORIGIN',
 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
 'X-XSS-Protection': '1; mode=block',
 'Referrer-Policy': 'strict-origin-when-cross-origin'
};

const MAX_REQUEST_BODY_BYTES = 65536;

async function readWorkerRequestPayload(request, reqUrl) {
 try {
  if (reqUrl && reqUrl.searchParams && reqUrl.searchParams.has('payload')) {
   const rawQ = String(reqUrl.searchParams.get('payload') || '');
   if (rawQ.length > MAX_REQUEST_BODY_BYTES) {
    const err = new Error('Payload Too Large');
    err.status = 413;
    throw err;
   }
   if (rawQ) return workerSanitizeObject(workerSafeJsonParse(rawQ, {}));
  }
 } catch (e) {
  if (e && e.status === 413) throw e;
 }
 const contentLen = Number(request?.headers?.get('content-length') || 0);
 if (contentLen > MAX_REQUEST_BODY_BYTES) {
  const err = new Error('Payload Too Large');
  err.status = 413;
  throw err;
 }
 try {
  const txt = await request.text();
  if (!txt) return {};
  if (txt.length > MAX_REQUEST_BODY_BYTES) {
   const err = new Error('Payload Too Large');
   err.status = 413;
   throw err;
  }
  const trimmed = txt.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
   return workerSanitizeObject(workerSafeJsonParse(trimmed, {}));
  }
  // Поддержка form-urlencoded (например, POST-форма входа в /fp-vip089-console)
  const params = new URLSearchParams(trimmed);
  const formObj = {};
  for (const [k, v] of params.entries()) {
   if (k !== '__proto__' && k !== 'constructor' && k !== 'prototype') {
    formObj[k] = v;
   }
  }
  return formObj;
 } catch (e) {
  if (e && e.status === 413) throw e;
  return {};
 }
}

function cleanupTransitBoxes() {
 const now = Date.now();
 const cutoff = now - 24 * 3600 * 1000;
 for (const [boxKey, arr] of transitBoxes.entries()) {
  const fresh = arr.filter(p => p && p.ts > cutoff);
  if (fresh.length === 0) transitBoxes.delete(boxKey);
  else transitBoxes.set(boxKey, fresh.slice(-50));
 }
 if (transitBoxes.size > 2000) {
  const oldestKey = transitBoxes.keys().next().value;
  if (oldestKey) transitBoxes.delete(oldestKey);
 }
 if (cloudAuthProfiles.size > 5000) {
  for (const k of cloudAuthProfiles.keys()) {
   if (k !== 'OWNER_IATHOR_FP_89VIP089') {
    cloudAuthProfiles.delete(k);
    break;
   }
  }
 }
 if (rateBuckets.size > 1000) {
  for (const [rk, b] of rateBuckets.entries()) {
   if (!b || now - b.start >= 60000) {
    rateBuckets.delete(rk);
   }
  }
  if (rateBuckets.size > 4000) {
   let removed = 0;
   for (const rk of rateBuckets.keys()) {
    rateBuckets.delete(rk);
    if (++removed >= 500) break;
   }
  }
 }
}

function checkWorkerRateLimit(userId, isGeo = false, maxPerMin = 140) {
 const now = Date.now();
 const key = String(userId || 'anon').slice(0, 64);
 let b = rateBuckets.get(key);
 if (!b || now - b.start >= 60000) {
  b = { start: now, total: 0, geo: 0 };
  rateBuckets.set(key, b);
 }
 b.total += 1;
 if (isGeo) b.geo += 1;
 if (b.total > maxPerMin) return false;
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
 arctic_ob_taz: ['burbot','peled','dace','pike','perch','chir','pizhyan','ide','roach','crucian','grayling','tugun','cisco','ruffe','smelt'],
 yenisei_lena: ['grayling','pike','perch','lenok','dace','peled','chir','pizhyan','tugun','valek','ide','roach','crucian','burbot','char'],
 volga_caspian: ['zander','pike','perch','bream','roach','crucian','carp','chub','asp','ide','chekhon','white_bream','catfish','volga_zander','dace','tench','rudd','bleak'],
 nw_karelia: ['pike','perch','zander','whitefish','grayling','trout','roach','bream','ide','dace','burbot','vendace','smelt','salmon'],
 barents_white: ['cod','salmon','trout','char','grayling','whitefish','pike','perch','dace','burbot','navaga','flounder','haddock','saithe','halibut'],
 baltic: ['zander','pike','perch','bream','roach','smelt','flounder','cod','garfish','vimba','white_bream','ide','dace','tench'],
 black_azov: ['horse_mackerel','red_mullet','garfish','mullet','bluefish','sea_bass','sea_bream','scorpionfish','turbot','flounder','goby','zander','carp','crucian','bream','taran','pike','perch','chub','brown_trout'],
 euro_west: ['pike','perch','zander','bream','crucian','carp','roach','chub','asp','ide','dace','tench','rudd','white_bream','catfish'],
 baikal: ['baikal_grayling','omul','lenok','pike','perch','dace','roach','ide','crucian','burbot','char','peled'],
 amur: ['pike','amur_pike','snakehead','sky_gazer','carp','crucian','amur_catfish','lenok','grayling','tarpon_carp','parabramis','grass_carp'],
 pacific_sea: ['coho_salmon','chum_salmon','pink_salmon','char','dolly_varden','cherry_salmon','chinook_salmon','sockeye_salmon','smelt','navaga','greenling','starry_flounder','halibut']
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

const _BC = ["arctic_ob_taz", "yenisei_lena", "volga_caspian", "nw_karelia", "barents_white", "baltic", "black_azov", "euro_west", "baikal", "amur", "pacific_sea", "baltic_nw", "euro_north", "south_azov_black", "baikal_angara", "siberia_east", "amur_primorye"];
const _WC = ["small_river", "big_river", "quarry", "tundra_lake", "cooling_reservoir", "sea_gulf", "open_sea"];
const _GR = ["predator", "peace", "whitefish", "sea", "sturgeon"];
const _TP = ["predator", "peace"];
const _HB = ["fresh", "sea"];
const _LG = ["free", "license", "redbook", "introduced"];
const _WN = ["06:30–10:00 и 16:30–20:00 (зорьки)", "08:00–13:00 и 15:30–18:00", "18:30–02:30 (сумерки и ночь)", "В течение всего дня (пик 08:00–16:00)"];
const _TT = [
"Река малая","Озеро","Карьер","Река большая","Озеро глубокое","Озеро / Карьер","ГРЭС","ГРЭС/АЭС",
"Водохранилище","Морская губа","Морской залив","Море","Лиман / Старица","Морской пролив",
"Морской лиман","Озеро / Сор","Озеро / Старица","Лиман пресный","Река средняя","ГРЭС/ТЭЦ",
"Озеро крупное","Река горная","Река севера","Морская бухта","Река предгорная","Озеро / ГРЭС",
"Река таёжная","Морская акватория"
];
const _RG = [
"Новый Уренгой","ЯНАО / Новый Уренгой","Новый Уренгой / Коротчаево","Новый Уренгой (юг)",
"ЯНАО / Ямсовей","Новый Уренгой / Тазовский р-н","ЯНАО / Уренгой","Коротчаево / Уренгой",
"Коротчаево / пгт. Уренгой","Пуровский р-н","Пангоды / Надымский р-н","Тарко-Сале",
"Тарко-Сале / Губкинский","п. Тазовский","г. Надым","г. Ноябрьск","Салехард / Лабытнанги",
"Салехард","Харп / Полярный Урал","Сургут","Сургутский р-н","Нижневартовск","ХМАО-Югра",
"Ханты-Мансийск","ХМАО","Тобольск","Тюмень","Тюменская обл.","Екатеринбург",
"Заречный / Екатеринбург","Рефтинский / Свердловская обл.","Омск","Новосибирск",
"Бердск / Новосибирск","Бердск","Томск","Барнаул","Республика Алтай","Бийск / Алтай",
"ЯНАО / Карское море","Москва","Подольск / Домодедово","Московская обл.","Истра / Солнечногорск",
"Можайск","Руза","Рузский р-н","Солнечногорск","Шатура","Дубна / Конаково","Конаково","Тверь",
"Переславль-Залесский","Ярославль","Рыбинск / Череповец","Серпухов","Коломна","Рязань",
"Рязанская обл.","Владимир","Нижний Новгород","Нижегородская обл.","Чебоксары / Васильсурск",
"Чувашия / Пенза","Казань","Татарстан / Ульяновск","Татарстан","Набережные Челны","Пермь",
"Пермский край / Свердловская обл.","Пермский край","Самара","Самарская обл.",
"Саратов / Балаково","Волгоград","Астрахань","Астраханская обл.","Ахтубинск / Харабали","Уфа",
"Башкортостан","Киров","Оренбург","Оренбургская обл.","Магнитогорск","Челябинская обл.",
"Челябинск","Осташков","Ростов Великий","Махачкала","Дербент","Приозерск / Шлиссельбург",
"Петрозаводск","Санкт-Петербург","Лосево / Приозерск","Ленинградская обл.","Подпорожье",
"Новая Ладога","Великий Новгород","Пряжинский р-н","Медвежьегорский р-н","Сегежа","Кивач",
"Северная Карелия","Териберка","Мурманск","Кандалакша","Северодвинск / Архангельск","Архангельск",
"Онега","Сыктывкар","п. Молочный","Мурмаши","Терский берег","Кольский п-ов",
"Апатиты / Мончегорск","Ловозерский р-н","Ненецкий АО","Республика Коми","Усинск / Инта",
"Ростов-на-Дону","Лиски / Воронеж","Воронеж","Нововоронеж","Волгодонск","п. Весёлый",
"Каменск-Шахтинский","Краснодар","Темрюк","Приморско-Ахтарск","Севастополь",
"Севастополь / Инкерман","Симферополь","Ялта","Керчь / Тамань","Новороссийск","Сочи","Адлер",
"Таганрог","Ейск","Абрау-Дюрсо","Кронштадт","Выборг","Кингисеппский р-н","Ивангород",
"Зеленоградск / Коса","Калининградская обл.","Калининград","Полесск","Псков","Красноярск",
"Дивногорск","Усть-Мана","Канск / Зеленогорск","Хакасия","Енисейск","Дудинка","Норильск / Талнах",
"Братск","Усть-Илимск","Якутск","Якутия","Ленск","Вилюйск","Алдан / Томмот","Иркутск",
"Иркутск / Шелехов","Листвянка","Ольхон","Забайкальский нацпарк","Слюдянка","Улан-Удэ",
"Гусиноозёрск","Баргузинский р-н","Байкальск","Прибайкальский р-н","Хабаровск","Хабаровский край",
"Благовещенск","Комсомольск","г. Зея","п. Талакан","Лесозаводск","Камень-Рыболов","Амурский р-н",
"Владивосток","Уссурийск / Тавричанка","Находка","Петропавловск-Камчатский","Елизово",
"Елизово / Камчатка","п. Ключи","Усть-Большерецк","Магадан","Корсаков / Сахалин","Южно-Сахалинск",
"Анива / Сахалин","Тымовское / Сахалин","Смоленск","Десногорск","Брянск","Курск","Курчатов",
"Старый Оскол","Белгород","Пуровский р-н / Коротчаево / Уренгой","Надымский / Тазовский р-н",
"Муравленко / Ноябрьск","Ноябрьск / Вынгапуровский","Ноябрьск / Ханымей",
"Красноселькупский / Пуровский р-н","Красноселькуп / Толька","Полярный Урал / Харп",
"Шурышкары / Мужи","Горки / Мужи","Новый Уренгой / Лимбяяха","Лонгъюган / Надым",
"Тазовский / Антипаюта","Харампур / Пуровский р-н","Берёзово / Игрим","Белоярский (ХМАО)",
"Белоярский р-н (ХМАО)","Салым / Нефтеюганский р-н","Нижневартовский р-н",
"Мишкино / Бирск (Башкортостан)","Караидель (Башкортостан)","Бураево / Янаул (Башкортостан)",
"Давлеканово / Чишмы (Башкортостан)","Иглино / Архангельское (Башкортостан)",
"Инзер / Архангельское (Башкортостан)","Месягутово / Дуванский р-н","Малояз / Салаватский р-н",
"Октябрьский / Бакалы (Башкортостан)","Давлеканово (Башкортостан)",
"Туймазы / Кандры (Башкортостан)","Абзелиловский р-н / Магнитогорск",
"Мелеуз / Нугуш (Башкортостан)","Кугарчинский р-н (Башкортостан)",
"Нефтекамск / Янаул (Башкортостан)","Бирск / Мишкинский р-н","Сочи / Лазаревское",
"Адлер / Сириус","Хоста / Сочи","Приморско-Ахтарск / Бриньковская","Темрюк / Голубицкая",
"Мишкино (Курганская обл.)","Мишкинский р-н (Курганская обл.)",
"Мишкино / Шумиха (Курганская обл.)","Юргамыш / Мишкино (Курганская обл.)",
"Шумиха (Курганская обл.)","Шумихинский р-н (Курганская обл.)","Шадринск (Курганская обл.)",
"Курган","Куртамыш (Курганская обл.)","Куртамышский р-н (Курганская обл.)",
"Макушино (Курганская обл.)","Петухово (Курганская обл.)","Частоозерье (Курганская обл.)",
"Курганская обл.","Ялуторовск / Заводоуковск","Ялуторовск","Вагай (Тюменская обл.)",
"Уват (Тюменская обл.)","Туртас (Тюменская обл.)","Демьянка (Тюменская обл.)",
"Ярково (Тюменская обл.)","Тавда / Нижняя Тавда","Ишим (Тюменская обл.)","Казанское / Ишим",
"Ревда / Екатеринбург","Полевской (Свердловская обл.)","Каменск-Уральский","Нижний Тагил",
"Серов (Свердловская обл.)","Сосьва (Свердловская обл.)","Гари (Свердловская обл.)",
"Ивдель (Свердловская обл.)","Касли (Челябинская обл.)","Южноуральск (Челябинская обл.)",
"Тара (Омская обл.)","Калачинск (Омская обл.)","Черлак (Омская обл.)",
"Ордынское (Новосибирская обл.)","Сузун / Камень-на-Оби","Барабинск / Чаны (Новосибирская обл.)",
"Барабинск (Новосибирская обл.)","Колпашево (Томская обл.)","Парабель / Каргасок (Томская обл.)",
"Кемерово / Юрга","Новокузнецк / Междуреченск","Рубцовск (Алтайский край)",
"Горно-Алтайск (Республика Алтай)","Губкинский / Пурпе (ЯНАО)","Муравленко (ЯНАО)",
"Ягельный / Приозёрный (ЯНАО)","Лонгъюган (ЯНАО)","Ныда / Заполярный (ЯНАО)","Кутопьюган (ЯНАО)",
"Самбург (ЯНАО)","Антипаюта (ЯНАО)","Гыда (ЯНАО)","Сеяха (ЯНАО)","Новый Порт (ЯНАО)",
"Яр-Сале / Панаевск (ЯНАО)","Аксарка / Белоярск (ЯНАО)","Красноселькуп (ЯНАО)","Толька (ЯНАО)",
"Халясавэй (ЯНАО)","Овгорт / Горки (ЯНАО)","Лянтор / Нижнесортымский (ХМАО)",
"Лангепас / Покачи (ХМАО)","Радужный / Новоаганск (ХМАО)","Когалым (ХМАО)",
"Нефтеюганск / Пыть-Ях (ХМАО)","Горноправдинск (ХМАО)","Приобье / Нягань (ХМАО)","Игрим (ХМАО)",
"Урай / Междуреченский (ХМАО)","Советский / Югорск (ХМАО)","Стерлитамак / Салават (Башкортостан)",
"Белорецк (Башкортостан)","Учалы (Башкортостан)","Баймак / Сибай (Башкортостан)",
"Орск (Оренбургская обл.)","Бузулук (Оренбургская обл.)","Ижевск (Удмуртия)",
"Чайковский / Воткинск / Оса","Кунгур (Пермский край)","Березники / Соликамск",
"Красновишерск / Чердынь (Пермский край)","Вятские Поляны / Мамадыш","Чистополь (Татарстан)",
"Ульяновск","Сызрань / Хвалынск / Балаково","Пенза","Саранск (Мордовия)",
"Камышин (Волгоградская обл.)","Харабали / Енотаевка (Астраханская обл.)","Лагань (Калмыкия)",
"Элиста (Калмыкия)","Кизляр (Дагестан)","Углич / Калязин","Весьегонск (Тверская обл.)",
"Ржев (Тверская обл.)","Вышний Волочёк / Удомля","Кострома / Плёс / Кинешма","Иваново",
"Муром / Выкса / Павлово","Касимов / Шилово (Рязанская обл.)","Тула","Калуга / Обнинск",
"Лысково / Йошкар-Ола","Луга (Ленинградская обл.)","Кириши / Тихвин (ЛО)",
"Валдай / Боровичи (Новгородская обл.)","Гдов (Псковская обл.)","Великие Луки (Псковская обл.)",
"Советск (Калининградская обл.)","Сортавала / Лахденпохья (Карелия)","Пудож (Карелия)",
"Беломорск / Кемь (Карелия)","Калевала / Костомукша (Карелия)","Лоухи (Карелия)",
"Котлас (Архангельская обл.)","Вельск (Архангельская обл.)","Мезень (Архангельская обл.)",
"Ухта (Коми)","Усть-Цильма (Коми)","Воркута (Коми)","Вёшенская / Павловск","Калач-на-Дону",
"Славянск-на-Кубани / Тимашевск","Туапсе / Джубга","Майкоп (Адыгея)","Феодосия / Судак (Крым)",
"Евпатория / Черноморское (Крым)","Ставрополь","Пятигорск (Ставропольский край)","Липецк / Елец",
"Тамбов","Орёл","Ачинск (Красноярский край)","Туруханск","Игарка",
"Абакан / Минусинск / Саяногорск","Кызыл (Тыва)","Усть-Кут (Иркутская обл.)",
"Северобайкальск (Бурятия)","Чита (Забайкальский край)","Мирный (Якутия)","Вилюйск (Якутия)",
"Нерюнгри (Якутия)","Тикси (Якутия)","Свободный (Амурская обл.)","Тында (Амурская обл.)",
"Биробиджан (ЕАО)","Николаевск-на-Амуре","Ванино / Советская Гавань","Поронайск (Сахалин)",
"Ноглики (Сахалин)","Оха (Сахалин)","Усть-Камчатск (Камчатка)","Анадырь (Чукотка)","Наро-Фоминск",
"Юрьевец","Ковров","Лысково / Макарьево","Павлово","Йошкар-Ола","Димитровград","Тольятти",
"Сызрань","Шигоны","Вольск / Маркс","Ровное","Ахтубинск","Чусовой","Оса","Ильинский","Пожва",
"Верхние Татышлы / Старобалтачево","Бакалы","Чекмагуш","Красноусольский","Кумертау","Актаныш",
"Медвежьегорск","Кемь","Беломорск","Олонец","Вёшенская","Павловск","Джубга","Кабанск","Покровск",
"Алдан","Спасск-Дальний","Заполярный (ЯНАО)","Нори (ЯНАО)","Ханымей (ЯНАО)",
"Чаны (Новосибирская обл.)","Уссурийск","Горки (ЯНАО)","Нижнесортымский (ХМАО)","Кострома",
"Железногорск","Славянка","Звенигово","Пошехонье"
];
const _ADM = ["Ямало-Ненецкий АО", "Ханты-Мансийский АО", "Тюменская обл.", "Свердловская обл.", "Челябинская обл.", "Курганская обл.", "Омская обл.", "Новосибирская обл.", "Томская обл.", "Кемеровская обл.", "Алтайский край", "Республика Алтай", "Москва", "Московская обл.", "Тверская обл.", "Ярославская обл.", "Костромская обл.", "Ивановская обл.", "Владимирская обл.", "Рязанская обл.", "Тульская обл.", "Калужская обл.", "Нижегородская обл.", "Чувашская Республика", "Республика Марий Эл", "Республика Татарстан", "Ульяновская обл.", "Самарская обл.", "Пензенская обл.", "Республика Мордовия", "Саратовская обл.", "Волгоградская обл.", "Астраханская обл.", "Республика Калмыкия", "Республика Дагестан", "Кировская обл.", "Удмуртская Республика", "Пермский край", "Республика Башкортостан", "Оренбургская обл.", "Санкт-Петербург", "Ленинградская обл.", "Новгородская обл.", "Псковская обл.", "Калининградская обл.", "Республика Карелия", "Мурманская обл.", "Архангельская обл.", "Ненецкий АО", "Республика Коми", "Ростовская обл.", "Краснодарский край", "Республика Адыгея", "Севастополь", "Республика Крым", "Ставропольский край", "Воронежская обл.", "Липецкая обл.", "Тамбовская обл.", "Белгородская обл.", "Курская обл.", "Орловская обл.", "Брянская обл.", "Смоленская обл.", "Красноярский край", "Республика Хакасия", "Республика Тыва", "Иркутская обл.", "Республика Бурятия", "Забайкальский край", "Республика Саха (Якутия)", "Амурская обл.", "Еврейская АО", "Хабаровский край", "Приморский край", "Сахалинская обл.", "Камчатский край", "Магаданская обл.", "Чукотский АО", "Донецкая Народная Республика", "Луганская Народная Республика", "Запорожская обл.", "Херсонская обл.", "Вологодская обл.", "Чеченская Республика", "Республика Ингушетия", "Кабардино-Балкарская Республика", "Карачаево-Черкесская Республика", "Республика Северная Осетия — Алания"];
const _RB_GEAR = 'Целенаправленный любительский лов запрещён (Красная книга РФ). При случайном прилове используйте безбородые крючки для бережного выпуска.';

const BOT_FISH_CATALOG = [
["pike","Щука",0,0,0,0,"0,1,8,2,3,4,5,7,6,9,10","012345",8,16,0.5,6,"120032233321","щук|щучк|травянк|зубаст|щурогай|щурогайк|шнурок|щука|травянка|щурогайка|карандаш|крокодил|мамка","Спиннинг 7–32 г (воблеры-минноу 90–130 мм твичингом, колебалки, вертушки №3–5), джиг 10–36 г с виброхвостом 4–5 дюймов",0],
["perch","Окунь речной",0,0,0,0,"0,1,8,2,3,4,5,7,6","012345",10,18,0.5,6,"222013333322","окун|окушк|горбач|матросик|полосат|окунь речной|окунь|полосатый|окушок","Микроджиг и нано-джиг (0.5–5 г), отводной поводок, тейл-спиннеры, вертушки №1–3, небольшие крэнки и попперы, поплавочная удочка на червя или.",0],
["zander","Судак",0,0,0,0,"2,3,7,6,5,0,1","01245",12,20,1,5,"112013223321","судак|судач|клыкаст|судачок|клыкастый|напильник|зандер","Джиговый спиннинг быстрого строя (Fast/Extra-Fast) 12–45 г для просечки костистой пасти (поролон, мандула, узкие виброхвосты 3.5–5 дюймов),.",0],
["crucian","Карась серебряный / золотой",1,1,0,0,"0,1,8,2,3,5,7,6,9,10","01234",16,24,4,-12,"001203332100","карас|карасик|лапоть|бубыр|карась серебряный|золотой|карась|серебряный|буффало|пятак","Нано-джиг и мормышинг (спиннинг XUL до 1.5–2 г, мормышка 0.2–0.6 г со слагом Tanta / Whitebait или искусственным мотылём), лёгкая маховая.",1],
["carp","Карп / Сазан",1,1,0,0,"9,0,5,6,7,3,2,1","14203",18,25,6,-16,"000102333100","карп|сазан|карпик|сазанчик|зеркальный карп|карпуша|зеркальный|чешуйчатый","Карповый бланк 3.5 lbs, донная кормушка, карповая оснастка",0],
["bream","Лещ",1,1,0,0,"0,5,6,7,3,2,1","14203",14,20,1.5,-3,"112203333211","лещ|подлещ|подлещик|леща|лещу|соплив|фанера|лаврушка|бронзовый","Фидер 3.6–3.9 м, зимняя поплавочная удочка с мотылем",0],
["roach","Плотва (Сорога / Чебак)",1,1,0,0,"0,1,8,2,3,4,5,7,6","012345",12,19,1,-2,"223023333222","плотв|сорог|сорожк|чебак|серушк|плотва|сорога|сорожка|плотвичка","Поплавочная удочка (маховая, болонская, матчевая), пикер и фидер, мормышинг и нано-джиг (мормышка 0.2–0.6 г с искусственным мотылём, опарышем.",1],
["catfish","Сом обыкновенный",0,0,0,0,"5,6,7,2","1420",18,26,8,-17,"000102332100","сом|сома|сому|сомик европейск|усатый|сом обыкновенный|соменок|лягушатник","Ловля с квоком, донка со шнуром #5.0 PE, живец или пучок выползков.",2],
["burbot","Налим",0,0,0,0,"9,0,8,5,4,6,7,3,2,1","1203",0,8,-1,21,"003210002330","налим|меньк|меnek|треска пресноводн|мень|треска|пресноводная","Тяжелая блесна-стукалка, зимняя донка с ершом.",2],
["tench","Линь",1,1,0,0,"0,5,6,7,3,2,1","14203",18,24,6,-16,"000120332000","линь|линя|линю|линек|царская|рыба","Поплавочная глухая оснастка, пучок червей с творогом",0],
["chub","Голавль",0,0,0,0,"5,6,7,3,2","120",14,21,3,-9,"001203333200","голавл|лобаст|голавль|голавль лобастый голавлик","Ультралайт, воблеры-жуки, микроколебалки.",1],
["asp","Жерех",0,0,0,0,"5,6,7,3,2","1420",15,22,3,-9,"001023333210","жерех|шереспер|конь речн|конь|речной","Дальнобойный спиннинг, тяжёлые морские блёсны, кастмастеры.",1],
["grayling","Хариус сибирский / европейский",0,0,0,1,"9,0,8,4,3,10,2,1","1203",6,14,0,14,"112200333321","хариус|харьк|харюз|сибирский хариус|европейский хариус|хариус сибирский|европейский|харюзок|парусник|сибирский","Нахлыст, сбирулино, вертушки #00–#2.",0],
["whitefish","Сиг проходной / озерный",2,1,0,0,"0,5,4,3,2","12503",4,12,0,15,"222233220033","сиг|сига|сигу|сижок|проходной сиг|озерный сиг|сиг проходной|озерный|проходной","Зимняя гирлянда мормышек, блесны с цепочкой",0],
["flounder","Камбала-глосса / речная",3,0,1,0,"5,4,6,10","6510",6,15,1,9,"212233333322","камбал|глосс|речная камбал|камбала-глосса|речная","Береговое морское удилище, морской червь (нереис), шумовые бусины.",3],
["mullet","Пеленгас / Лобан",3,1,1,0,"6,10","510",14,24,6,-12,"001232233310","кефал|пеленгас|пиленгас|лобан|сингил|остронос","Береговая морская донка, чашечный монтаж под нереиса.",1],
["sea_bass","Морской окунь (Смарида / Рокфиш)",3,0,1,0,"4,6,10","65",8,16,0.5,11,"112233333211","смарид|морской окун|окунь морск|чуларк|морской окунь|смарида|рокфиш","Морская прибрежная ловля, отводной поводок, креатуры и светонакопительный силикон.",0],
["garfish","Сарган",3,0,1,0,"5,6","65",14,22,8,-10,"000123333310","сарган|игла морск","Плавающая бомбарда, поводок 1.5–2 м, шелковая нить.",1],
["anglerfish","Морской чёрт (Удильщик)",3,0,1,0,"5,4","6",2,8,1,11,"222222222222","морской черт|удильщик","Тяжелый бортовой джиг со дна, крупный виброхвост с филе рыбы.",2],
["halibut","Палтус синекорый / белокорый",3,0,1,1,"4,10","6",0,7,-0.5,16,"223332233322","палтус|палтус синекорый|белокорый","Морское удилище 30–50 lbs, виброхвосты 300–500 г.",0],
["horse_mackerel","Ставрида",3,0,1,0,"5,6","65",15,23,8,-14,"000123333310","ставрид|ставридк|ставрида","Лёгкий морской спиннинг, головки 1.5–3 г, ставка «самодур».",2],
["sand_eel","Песчанка",3,1,1,0,"5,4,10","5",3,12,1,5,"112333332100","песчанк|песчанка","Ставка сабики с мелким люрексом. Деликатный спиннинг (нано-джиг 0.3–1 г, микроджиг), поплавочная и фидерная оснастка с флюорокарбоновым поводком.",1],
["ruffe","Ёрш обыкновенный",0,0,0,0,"9,0,8,5,4,6,7,3,2,1","14203",4,14,0,9,"332012223333","ерш|ерша|ершик|носар|ерш обыкновенный|носарь|королевский","Мормышка с мотылем у самого дна. Деликатный спиннинг (нано-джиг 0.3–1 г, микроджиг), поплавочная и фидерная оснастка с флюорокарбоновым поводком.",3],
["trout","Кумжа / Ручьевая форель",0,0,0,1,"5,4,6,3","5012",6,14,0.5,12,"112333230001","кумж|форел|пеструшк|кумжа|ручьевая форель|форель|ручьевая|озерная|пеструшка","Речной ультралайт, тонущие узкотелые воблеры 45–60 мм.",0],
["goby","Бычок-кругляк / мартовик",3,0,1,0,"5,6,2","1502",10,20,4,-3,"112322333321","бычок|бычка|кругляк|мартовик|кнут|бычок-кругляк","Отводной поводок, донка, кусочки червя или мидии.",3],
["bleak","Уклейка",1,1,0,0,"0,5,6,7,3,2","14203",14,22,4,-12,"001333332100","уклейк|уклея|селявк|верховодк|уклейка|себель|шеклея","Легкий мах 3–4 м, поплавок 0.3–0.5 г, мелкий опарыш",1],
["ide","Язь (Подъязок)",1,1,0,0,"0,1,8,2,3,4,5,7,6","012345",12,19,1,2,"112033333211","язь|язя|язю|язем|подъяз|подъязок|язь подъязок красноперый","Спиннинг ультралайт и лайт (вертушки №1–3, воблеры-крэнки 35–50 мм, колебалки, мормышинг и микроджиг 1–4 г), фидер и донка, болонская удочка.",0],
["sterlet","Стерлядь",4,1,0,1,"0,4,6,7,2,1","120",12,20,1,2,"112200333211","стерляд|стерляжк|чухоньк|стерлядь|стерлядь стерлядка чечуга","Фидер с пучком червя или мотыля",2],
["herring","Сельдь атлантическая / тихоокеанская",3,1,1,0,"5,4,10","651",4,12,0.5,7,"223321123322","сельд|селедк|сельдь|сельдь атлантическая|тихоокеанская","Ставка-самодур с мобискином и золотыми крючками.",1],
["mackerel","Скумбрия атлантическая",3,0,1,0,"5,4,6","65",12,20,7,-10,"000123333200","скумбри|скумбрия атлантическая","Тяжёлые морские блёсны 20–40 г, ярусные оснастки с перьями.",1],
["cod","Атлантическая треска",3,0,1,0,"5,4","65",1,8,-1,18,"333221123333","треск|атлантическая треск|пертуй|атлантическая треска","Тяжелый бортовой джиг, тяжёлые морские блёсны 200–500 г с октопусом.",0],
["smelt","Корюшка европейская / зубастая",3,0,1,0,"0,5,4,3,10","1250",0,8,-1.5,21,"333210001233","корюшк|зубар|малоротк|снеток|корюшка европейская|зубастая|корюшка|зубатка|огуречник|снетка","Кобылки, гирлянды светонакопительных мормышек.",1],
["salmon","Атлантический лосось (Сёмга)",0,0,0,1,"5,4,3","1502",6,14,0.5,11,"001123332000","семг|атлантический лосос|атлантический лосось|семга|лосось|атлантический|лох|тинда","Двуручный нахлыст, лососевые колебалки 20–45 г.",0],
["crayfish","Речной рак",1,1,0,1,"6,7,3,2","20",15,22,6,-17,"000001233300","рак|речной рак|рака|раки","Разрешенные раколовки с рыбой или чесночным хлебом.",2],
["crab","Краб прибрежный / каменный",3,0,1,1,"4,6,10","5",12,20,2,2,"111200333321","краб|каменный краб|краба|краб прибрежный|каменный","Подъемник-хватка с рыбной насадкой.",2],
["king_crab","Камчатский краб",3,0,1,1,"4,10","6",0,6,-0.5,14,"222002333322","камчатский краб","Специализированная крабовая ловушка с сельдью.",3],
["silver_carp","Толстолобик белый / пестрый",1,1,0,3,"6,7,2","142",20,28,8,-19,"000013332000","толстолоб|толстолобик|толстолобик белый|пестрый|белый","Специальная оснастка «палочка толстолобика» с прессованным планктоном.",1],
["grass_carp","Белый амур",1,1,0,3,"9,6,7,2","142",18,26,7,-17,"000013332000","белый амур|амур бел|белый|амур|травяной|карп","Мощный карповик, карповая оснастка, плавающий бойл, пучок травы.",1],
["channel_catfish","Сомик канальный",0,0,0,3,"6,7,2","42",18,28,6,-16,"000123332100","канальный сомик|сомик канальн|американский сомик|сомик канальный|сомик канальный американский","Донка, фидер, печень птицы, креветка, пучок червей.",2],
["tilapia","Тиляпия (нильская / мозамбикская)",1,1,0,3,"6,7,2","4",22,32,14,-23,"000013333100","тиляпи|теляпи|тиляпия|нильская|мозамбикская|тиляпия телапия нильская","Легкий поплавок, фидер, кукуруза, червь, тесто с аттрактантами",1],
["rotan","Ротан (Головешка)",0,0,0,0,"9,0,8,5,6,7,3,10,2,1","14203",12,22,-0.5,4,"223323333322","ротан|головешк|бычок прудов|головешка|бычок|болотный","Зимняя блесна с подсадкой куриной кожи, микроджиг.",3],
["buffalo","Буффало (большеротый)",1,1,0,3,"6,2","42",18,26,7,-17,"000123332100","буффало|большеротый|карась|американский","Фидер, донная кормушка, распаренные злаки, бойлы",1],
["rainbow_trout","Форель радужная (Микижа)",0,0,0,3,"7,3,10,2","420",10,18,0.5,9,"223321123332","радужная форел|микиж|форель платник|форель радужная|микижа|форель|радужная|платник","Прудовая форелевая снасть УЛ до 3.5 г, форелевая паста, микроколебалки.",1],
["russian_sturgeon","Осетр русский",4,1,0,2,"6,2","15",14,22,2,-3,"112322333211","русский осетр|осетр|осетр русский|русский|волжский|каспийский","Только искусственные платные водоемы.",2],
["paddlefish","Веслонос",4,1,0,3,"6,2","42",16,24,5,-14,"000123332100","веслонос|веслонос американский осетр","Специализированные прудовые снасти.",1],
["barbel","Усач (Марена)",1,1,0,1,"6,7","10",14,22,4,-10,"001203332100","усач|марен|мирон|марена|усач марена мирон","Мощный речной фидер, сырные насадки, пиявка, выползок",0],
["white_bream","Густера",1,1,0,0,"0,5,6,7,3,2","14203",14,20,2,-5,"112203333211","густер|густерк|тарашк|ласкир речн|густера|густерка|тарашка|ласкирь|речной","Пикер, легкий фидер, мотыль с опарышем",0],
["blue_bream","Синец",1,1,0,0,"5,6,7,3,2","120",12,19,2,-7,"112203332211","синец|синца|сопа|волжский","Фидерная снасть с длинным поводком (до 1 м), опарыш",1],
["sopa","Белоглазка (Сопа)",1,1,0,0,"5,6,7,2","120",10,18,1.5,-2,"122023332211","белоглазк|сопа|сопы|клепец|белоглазка|белоглазка сопа клепец","Речной фидер на тяжелых кормушках (80–120 г)",1],
["undermouth","Подуст волжский",1,1,0,0,"5,6,7,2","120",12,19,3,-7,"002023332100","подуст|чернобрюшк|подуст волжский|подуст чернобрюшка","Проводочная болонская удочка, опарыш, мотыль",1],
["vimba","Рыбец (Сырть)",1,1,0,1,"5,6,7,3,2","1250",12,19,2,-3,"113202333211","рыбец|сырть|рыбца|подуст|черноморский","Донка, фидер, мотыль, червь, ракушка",0],
["gudgeon","Пескарь обыкновенный",1,1,0,0,"9,0,8,5,4,6,7,3,2,1","1203",12,20,3,-7,"112233332100","пескар|пескарик|бубырь|пескарь обыкновенный|пескарь пескарик бубырь","Легкая поплавочная снасть, мелкий червь",1],
["loach","Вьюн обыкновенный",1,1,0,0,"9,0,8,5,4,6,7,3,2,1","1203",14,22,2,-10,"001233332100","вьюн|пискун|вьюн обыкновенный|вьюн пискун щиповка","Поплавок у дна, мотыль, кусочек червя",2],
["volga_zander","Берш (Волжский судак)",0,0,0,1,"5,6,7,2","120",12,20,1,4,"112013223321","берш|бершик|волжский судак|берш волжский судак","Джиг с мелким виброхвостом, зимняя блесна с тюлькой.",0],
["chekhon","Чехонь",1,1,0,0,"5,6,7,3,2","120",15,22,4,-10,"001303332100","чехон|сабля|чеша|чехонь|чехонь сабля чеша","Бомбарда с опарышем, резинка, микровертушки",1],
["vobla","Вобла каспийская",1,1,0,1,"2","1503",10,18,4,-9,"002301111100","вобл|каспийская вобл|вобла каспийская|вобла|каспийская|тарань|астраханская","Донка с 2–3 крючками, червь, опарыш",1],
["rudd","Красноперка",1,1,0,0,"0,5,6,7,3,2","14203",16,24,5,-12,"001233332100","красноперк|краснопер|красноперка|красноперка красноглазка","Поплавок, ультралайт (мормышинг), микровертушки.",1],
["dace","Елец (Чебак / Мохтик)",1,1,0,0,"0,1,8,2,3,4,5,7,6","01234",10,18,1,2,"112033333211","елец|ельц|мохтик|мегдым|чебак сибирск|чебак|сибирский|межень|ельчик","Нано-джиг и мормышинг (удилище XUL 0.2–2 г, мормышки и одноухие монтажи 0.3–1.0 г с вайтбейтом, тантой, искусственным мотылём или опарышем на.",1],
["shemaya","Шемайя (Черноморско-каспийская)",1,1,0,2,"6,2","15",14,22,4,-10,"112333333211","шемая|шемай|шамая|шемайя|черноморско-каспийская|царская|селедка","@RB",0],
["brown_trout","Форель ручьевая (Пеструшка)",0,0,0,1,"6,2","0",8,15,0.5,11,"112333230011","ручьевая форел|пеструшк|форель ручьевая|пеструшка|форель|ручьевая|кавказская","Речной УЛ, микровоблеры, нахлыст. Деликатный спиннинг (нано-джиг 0.3–1 г, микроджиг), поплавочная и фидерная оснастка с флюорокарбоновым.",0],
["taran","Тарань",1,1,0,0,"6","1503",12,20,3,-5,"223023332211","таран|тарань|таранк|таранка|азовская|плотва","Поплавок, донка, фидер, насадка — опарыш, червь",1],
["bluefish","Луфарь",3,0,1,0,"6","65",16,24,10,-16,"000012333200","луфар|луфарь","Спиннинг с пилькерами, поверхностные приманки, воблеры с металлическим поводком.",0],
["red_mullet","Султанка (Барабулька)",3,1,1,0,"6","5",15,23,8,-12,"000123333210","барабул|барабульк|султанк|султанка|барабулька","Пикер, морская донка, мелкий крючок с нереисом.",1],
["sea_bream","Морской карась (Ласкирь)",3,1,1,0,"6","5",16,24,9,-14,"000123333200","ласкир|морской карас|карась морск|зубарик|сарг|морской карась|ласкирь","Морская прибрежная ловля, отводной поводок, съедобная резина (Marukyu), мясо креветки.",1],
["wrasse","Зеленушка (Рулена)",3,1,1,0,"6","5",16,24,10,-16,"000123333100","зеленушк|рулен|рябчик морск|зеленушка|рулена","Микроджиг, поплавочная удочка с мидией или крабом.",1],
["scorpionfish","Скорпена (Морской ерш)",3,0,1,0,"6","5",14,22,7,-10,"000123333200","скорпен|морской ерш|ерш морск|скорпена","Морская прибрежная ловля в темноте, силиконовые рачки, джиг-головки 2–4 г.",2],
["turbot","Калкан черноморский",3,0,1,1,"6","65",10,18,4,4,"112002333321","калкан|черноморский калкан|калкан черноморский","Мощный береговая морская донка, резка рыбы (хамса, ставрида).",3],
["chir","Щокур (Чир)",2,1,0,0,"0,1,4,10","0123",4,12,0,18,"223211223003","чир|щокур|щекур|чира|сиг|северный","Донная снасть и лёгкий пикер/фидер с животной насадкой, мормышинг и нано-джиг у самого дна (0.5–1.5 г с имитацией личинки и мотыля на.",1],
["pizhyan","Пыжьян (Сибирский сиг)",2,1,0,0,"0,1,4,8","01235",4,13,0,16,"222223320033","пыжьян|сибирский сиг|полкур|сиг|сибирский","Мормышинг / нано-джиг (0.4–1.2 г с нимфами и слагами), ультралайт-вращалки №0–1, поплавочная удочка в проводку, лёгкий фидер/пикер, нахлыст.",0],
["peled","Пелядь (Сырок)",2,1,0,0,"0,1,4,3,2,8","0123",6,15,0,14,"223223332001","пеляд|сырок|сырка|сырку|пелядь|сырочек|речной|озерный|сиг","Нано-джиг и мормышинг (XUL спиннинг до 1.5–2 г, мормышка 0.3–0.8 г с подсадкой белого/розового слага Whitebait, Tanta или нимфы в толще воды.",1],
["muksun","Муксун",2,1,0,2,"0,1","150",4,12,0,17,"223223333112","муксун|муксуна|обской|сиг|краснокнижный","Любительский и промысловый вылов в Обь-Иртышском бассейне категорически ЗАПРЕЩЁН.",0],
["nelma","Нельма",2,0,0,2,"0,1,4","105",4,12,0,16,"223223333122","нельма|нельмы|нельму|нельма белорыбица сибирская","Любительский вылов в запретных бассейнах (включая Обь-Иртышский и Печорский) ЗАПРЕЩЁН.",0],
["cisco","Ряпушка сибирская",2,1,0,0,"0,4,1","12503",2,10,-0.5,19,"333212220023","ряпушк|зеeld|зельдь|сибирская ряпушк|ряпушка сибирская|ряпушка|сибирская|туруханка","Зимняя гирлянда со светонакопительными микромормышками",1],
["tugun","Тугун (Манерка / Сосьвинская сельдь)",2,1,0,0,"0,1","0132",8,16,1,9,"112233330011","тугун|манерк|сосьвинская сельд|тугунок|манерка|сосьвинская сельдь|сосьвинская|сельдь","Сверхлёгкий мормышинг (0.15–0.4 г с микромушкой или кусочком силиконового мотыля), лёгкая маховая поплавочная удочка с поплавком 0.3–0.8 г и.",0],
["siberian_sturgeon","Сибирский осётр",4,1,0,2,"0,1,8","1052",10,18,0.5,4,"112223333211","сибирский осетр|осетр сибирск|осетр|сибирский|карыш|коسترя","Вылов дикой популяции категорически ЗАПРЕЩЁН (разрешён только лов товарной рыбы в коммерческих платных прудхозах).",2],
["omul","Байкальский омуль",2,1,0,1,"8","2",4,12,0,16,"222123330002","омул|байкальский омул|байкальский омуль|омуль|байкальский|селенгинский|посольский","Специальная настроечная мушка (кембрик, бисер), гирлянда",1],
["lenok","Ленок (Ускуч)",0,0,0,1,"9,8,1","10",6,14,0,14,"112203333211","ленок|ленка|ускуч|сибирская|форель","Спиннинг с искусственной мышью, узкотелые воблеры, нахлыст.",0],
["taimen","Обыкновенный таймень",0,0,0,2,"1,8,9,0,2","102",6,14,0,12,"112213333321","таймен|тайменя|обыкновенный таймень|таймень|хозяин|рек|красный","В разрешённых РПУ (строго с безбородыми или поджатыми крючками): мощный спиннинг и двуручный нахлыст, крупные воблеры и поверхностные «мыши».",0],
["snakehead","Змееголов",0,0,0,0,"9","03",18,28,6,-17,"000013332000","змееголов|змееголов змей амурский","Кастинговое удилище heavy, силиконовые незацепляемые лягушки.",1],
["sky_gazer","Верхогляд",0,0,0,0,"9","1",16,24,4,-12,"000123332100","верхогляд|верхогляд пучеглаз амурский","Дальнобойный спиннинг, тяжёлые морские блёсны, кастмастеры, поверхностные приманки.",1],
["yellowcheek","Желтощек",0,0,0,2,"9","1",15,22,4,-10,"001233333200","желтощек|бамбуса|амурская|щука","@RB",1],
["chinese_perch","Ауха (Китайский окунь)",0,0,0,2,"9","1",16,24,5,-14,"001232333200","ауха|китайский окун|китайский окунь|китайский|окунь|ерш|мандарин","@RB",0],
["amur_catfish","Амурский сом",0,0,0,0,"9","13",16,24,6,-14,"000123332100","амурский сом|сом амурск|сом амурский дальневосточный","Донка, спиннинг с крупным силиконом, лягушка.",2],
["pink_salmon","Горбуша",3,0,1,1,"9,4,10","150",6,14,1,9,"000012331000","горбуш|горбуши|горбуша|горбуша розовый лосось","Спиннинг 10–35 г, блесны Blue Fox #4–#5 розовых тонов.",1],
["chum_salmon","Кета",3,0,1,1,"9,10","150",6,14,1,9,"000001233100","кета|кеты|кету|серебрянка|зубатка|лосось","Спиннинг тяжелого класса, колеблющиеся блесны.",1],
["coho_salmon","Кижуч",3,0,1,1,"10","150",5,12,0.5,11,"000000133200","кижуч|кижуча|серебряный|лосось|белый","Спиннинг, тяжелые вертушки с колокольчиком.",1],
["sockeye_salmon","Нерка (Красница)",3,0,1,1,"10","1502",5,12,0.5,11,"000002320000","нерк|красниц|нерка|красница|красный|лосось","Нахлыст, специализированные мушки. Деликатный спиннинг (нано-джиг 0.3–1 г, микроджиг), поплавочная и фидерная оснастка с флюорокарбоновым.",1],
["chinook_salmon","Чавыча",3,0,1,1,"10","150",5,12,0.5,12,"000013310000","чавыч|чавычи|чавыча|королевский|лосось|князь","Морской тяжелый спиннинг, мощнейшие катушки со шнуром #3.0+ PE.",0],
["cherry_salmon","Сима (Масу)",3,0,1,1,"10","501",8,15,1,7,"000133100000","сима|симы|масу|вишневый|лосось","Спиннинг 5–21 г, тонущие узкотелые воблеры, колебалки.",1],
["char","Голец арктический / Кунджа",0,0,0,1,"0,4,10,1","25013",3,11,-0.5,18,"222333230022","голец|гольц|кундж|арктический голец|голец арктический|кунджа|арктический|палия|мальма","Спиннинг, белые колебалки, нахлыстовые крупные мушки.",0],
["dolly_varden","Мальма",0,0,0,0,"10","0152",4,12,0,16,"222333320022","мальм|мальмы|мальма|мальма голец тихоокеанский","Легкий спиннинг, поплавок с икринкой, вертушки #2.",1],
["walleye_pollock","Минтай",3,0,1,0,"10","65",1,8,0,12,"223321122332","минтай|минтая","Тяжёлые морские блёсны 80–150 г, ставки с октопусами.",0],
["navaga","Навага дальневосточная / северная",3,0,1,0,"0,4,10","510",-1,6,-1.5,23,"332100012333","наваг|вахня|навага дальневосточная|северная|навага|дальневосточная","Зимняя блесна-иголка без бородки. Деликатный спиннинг (нано-джиг 0.3–1 г, микроджиг), поплавочная и фидерная оснастка с флюорокарбоновым.",1],
["greenling","Терпуг (Одноперый / пятнистый)",3,0,1,0,"10","65",6,14,1,7,"112333321111","терпуг|одноперый|пятнистый","Джиг с силиконовыми октопусами, кастмастеры, донка.",1],
["starry_flounder","Камбала звездчатая",3,0,1,0,"10","510",4,14,0.5,9,"212333333222","звездчатая камбал|камбала звездчатая","Береговая морская снасть, нарезка рыбы, морской червь.",3],
["vendace","Ряпушка европейская (Рипус)",2,1,0,0,"0,5,4,3,2","12503",4,12,0,16,"223223321002","рипус|килец|европейская ряпушк|ряпушка европейская|ряпушка|европейская","Зимняя гирлянда с подсветкой, микромормышки",1],
["broad_whitefish","Сиг-лудога / Валаамка",2,1,0,0,"0,5,4,3,2","12503",4,12,0,14,"223233220022","лудог|валаамк|сиг лудог|сиг-лудога|валаамка|сиг|лудога|ладожский","Зимнее блеснение с цепочкой, донная снасть",0],
["omul_arctic","Арктический омуль",2,1,1,0,"0,4,1","12503",1,9,-0.5,19,"223212330022","арктический омул|омуль северн|арктический омуль|омуль арктический северный","Гирлянда-самодур, мормышка с бокоплавом.",1],
["valek","Валёк (Конёк)",2,1,0,0,"0,10,1","120",4,12,0,14,"112233320011","валек|валька|конек сибирск|конек|сиг|вальковый","Поплавочная удочка в проводку, ручейник, короед",0],
["baikal_grayling","Байкальский хариус (белый / черный)",0,0,0,1,"8","120",4,12,0,16,"223202333322","байкальский хариус|белый хариус|черный хариус|белый|черный|хариус|байкальский","Байкальский «кораблик», грузовой настрой с мушками под бормаша.",0],
["beluga","Белуга",4,0,1,2,"6,2","165",10,20,1,0,"123322223321","белуг|белуга|царь|рыба|осетровые","@RB",2],
["stellate_sturgeon","Севрюга",4,1,1,2,"6,2","15",12,22,2,-3,"112322333211","севрюг|севрюга|севрюга осетр носатый","@RB",2],
["kaluga","Калуга",4,0,0,2,"9,10","15",8,18,1,2,"112223333211","калуг рыба|амурская калуг|калуга|калуга амурская белуга","@RB",2],
["white_salmon","Белорыбица",2,0,0,2,"2","1",6,16,0.5,7,"223222223122","белорыбиц|белорыбица|белорыбица каспийская нельма","@RB",0],
["kutum","Кутум",3,1,1,1,"2","150",12,20,3,-5,"123202223211","кутум|кутум вырезуб каспийский","Донная снасть, береговая донка, насадка — креветка, червь, краб.",1],
["black_carp","Черный амур",1,1,0,2,"9,6,2","14",18,26,7,-17,"000123332100","черный амур|амур черн|черный|амур|китайский|плотва","Только в специализированных прудовых хозяйствах.",1],
["tarpon_carp","Троегуб / Конь-губарь",1,1,0,0,"9","10",14,22,2,-2,"112233333211","троегуб|конь губар|конь-губар|конь-губарь|конь|губарь|пестрый","Речной фидер, червь, кукуруза, резка",1],
["parabramis","Лещ амурский (белый / черный)",1,1,0,0,"9","13",16,24,4,-10,"001232333200","амурский лещ|белый лещ|лещ амурский|белый|черный|лещ|амурский","Фидер, донка, кукуруза, пеллетс, червь",0],
["haddock","Пикша",3,0,1,0,"4","65",2,9,0,14,"222333333222","пикш|пикша","Морской джиг, ставки с подсадкой креветки или кальмара.",1],
["saithe","Сайда",3,0,1,0,"4","65",3,10,0.5,12,"112233333211","сайд|сайда","Скоростной отвесное блеснение в толще воды, перьевые оснастки.",1],
["wolffish","Зубатка (полосатая / пятнистая)",3,0,1,0,"5,4","6",0,7,-1,16,"223333223322","зубатк|зубатка|полосатая|пятнистая","Морская донная стукалка с филе сайды или морским гребешком.",3],
["plaice","Камбала морская (Ершоватка)",3,0,1,0,"5,4","65",2,11,0,12,"222333333222","морская камбал|ершоватк|камбала морская|ершоватка","Донная снасть с яркими бусинами, пескожил, креветка.",1],
["capelin","Мойва (Уёк)",3,1,1,0,"4,10","5",1,8,-1,16,"123333111111","мойв|уек|мойва","Сачок на накатной волне, мелкий самодур.",1],
["saffron_cod","Сайка (Полярная тресочка)",3,0,1,0,"0,4,1","65",-1.5,5,-1.8,24,"333211112333","сайк|полярная тресочк|сайка|полярная тресочка|сайка полярная тресочка","Зимняя блесна, мормышка с кусочком креветки или рыбы.",3],
["eel","Угорь речной европейский",0,0,0,2,"5,6,3","125",14,22,4,-14,"001233333200","угорь|угря|угорь речной европейский|речной|европейский|змея","@RB",2]
].map(r => ({
 id: r[0], name: r[1], group: _GR[r[2]], type: _TP[r[3]], habitat: _HB[r[4]], legal: _LG[r[5]],
 basins: r[6].split(',').map(i => _BC[Number(i)]),
 waters: r[7].split('').map(i => _WC[Number(i)]),
 optT: [r[8], r[9]], tMinStop: r[10], coldBonus: r[11],
 monthActivity: r[12].split('').map(Number),
 keywords: r[13].split('|'),
 gear: r[14] === '@RB' ? _RB_GEAR : r[14],
 win: _WN[r[15]]
}));

const BOT_WATERS_DB = [
["р. Седе-Яха","Седе-Яха",0,0,0,1.4,66.083,76.68,0],["р. Ево-Яха","Ево-Яха",0,0,0,1.6,66.071,76.712,0],
["р. Тамчара-Яха","Тамчара-Яха",0,0,0,1.3,66.065,76.63,0],
["оз. Молодёжное","Молодёжное",0,3,1,1.8,66.09,76.69,0],
["Песчаные карьеры (Н. Уренгой)","Карьеры Н. Уренгоя",0,2,2,3.5,66.055,76.74,0],
["р. Тамбей-Яха","Тамбей-Яха",0,0,0,1.2,66.12,76.55,1],
["р. Варенга-Яха","Варенга-Яха",0,0,0,1.8,66.035,77.52,2],
["р. Арка-Табъяха","Арка-Табъяха",0,0,0,1.7,65.92,76.42,3],["р. Ямсовей","Ямсовей",0,0,0,2.1,65.65,76.95,4],
["р. Хадуттэ","Хадуттэ",0,0,0,2.4,66.48,76.85,5],
["р. Нгарка-Пыряяха","Нгарка-Пыряяха",0,0,0,2,66.38,77.95,6],
["р. Большая Хадырьяха","Большая Хадырьяха",0,0,0,2.2,65.82,78.05,7],
["р. Пур (Коротчаево / Уренгой)","Пур (Коротчаево)",0,1,3,4.5,65.945,78.18,8],
["оз. Ямылимуяганто","Ямылимуяганто",0,2,4,4.2,65.78,77.35,9],
["р. Правая Хетта","Правая Хетта",0,0,0,2.2,65.85,74.5,10],
["р. Пур (Тарко-Сале)","Пур",0,1,3,4.2,64.915,77.78,11],["р. Пяку-Пур","Пяку-Пур",0,0,0,2.2,64.9,77.75,12],
["р. Айваседа-Пур","Айваседа-Пур",0,0,0,2,64.91,77.8,11],["р. Таз","Таз",0,1,3,4.8,67.45,78.7,13],
["р. Надым","Надым",0,1,3,3.8,65.533,72.52,14],["оз. Янтарное","Янтарное",0,3,1,2.1,65.54,72.5,14],
["оз. Ханто","Ханто",0,3,1,2.5,63.22,75.43,15],["оз. Светлое (Ноябрьск)","Светлое",0,2,5,4,63.16,75.38,15],
["р. Нанкпёх","Нанкпёх",0,0,0,1.3,63.2,75.4,15],["р. Обь (Салехард)","Обь",0,1,3,7.5,66.53,66.6,16],
["р. Полуй","Полуй",0,0,0,2.4,66.52,66.62,17],["р. Собь","Собь",0,0,0,1.8,66.82,65.8,18],
["р. Обь (Сургут)","Обь",0,1,3,6.8,61.25,73.4,19],
["вдхр. Сургутской ГРЭС","Сургутская ГРЭС (тёплый канал)",0,4,6,3.5,61.28,73.5,19],
["р. Тромъёган","Тромъёган",0,0,0,2.5,61.42,73.8,20],
["р. Обь (Нижневартовск)","Обь",0,1,3,6.5,60.93,76.55,21],
["оз. Самотлор","Самотлор",0,3,1,2,61.12,76.75,21],["р. Вах","Вах",0,1,3,4,60.98,76.9,22],
["р. Иртыш (Ханты-Мансийск)","Иртыш",0,1,3,6,61,69.02,23],["р. Конда","Конда",0,1,3,3.8,60.68,68.05,24],
["р. Иртыш (Тобольск)","Иртыш",0,1,3,5.5,58.19,68.25,25],
["р. Тура (Тюмень)","Тура",0,1,3,3.6,57.155,65.535,26],
["оз. Андреевское (Тюмень)","Андреевское озеро",0,3,1,2.2,57.05,65.77,26],
["р. Пышма","Пышма",0,0,0,2,56.98,65.38,27],["р. Исеть (Екатеринбург)","Исеть",0,0,0,2.2,56.835,60.605,28],
["Белоярское вдхр. (БАЭС)","Белоярское вдхр.",0,4,7,6.5,56.85,61.3,29],
["Рефтинское вдхр. (ГРЭС)","Рефтинское вдхр.",0,4,6,5.2,57.1,61.7,30],
["р. Иртыш (Омск)","Иртыш (Омск)",0,1,3,4.8,54.99,73.36,31],["р. Омь","Омь",0,0,0,2.1,54.995,73.38,31],
["р. Обь (Новосибирск)","Обь (Новосибирск)",0,1,3,5.5,55.01,82.92,32],
["Новосибирское вдхр. (Обское море)","Обское море",0,2,8,7.5,54.75,82.85,33],
["р. Бердь","Бердь",0,0,0,2.4,54.76,83.1,34],["р. Томь (Томск / Кемерово)","Томь",0,1,3,4.2,56.48,84.95,35],
["р. Обь (Барнаул)","Обь (Барнаул)",0,1,3,4.8,53.34,83.78,36],
["оз. Телецкое","Телецкое озеро",0,2,4,16,51.78,87.26,37],["р. Бия","Бия",0,0,0,2.5,52.54,85.21,38],
["Тазовская губа","",0,5,9,4.5,68,76,39],["Обская губа","",0,5,9,6,68.5,73.5,39],
["р. Москва","Москва-река",2,1,3,3.5,55.75,37.62,40],["р. Яуза","Яуза",2,0,0,1.8,55.755,37.645,40],
["р. Пахра","Пахра",2,0,0,2.1,55.44,37.56,41],["Пироговское вдхр.","",2,2,8,5.2,55.98,37.7,42],
["Клязьминское вдхр.","",2,2,8,4.8,55.99,37.58,42],["Истринское вдхр.","",2,2,8,6,56.05,36.8,43],
["Можайское вдхр.","",2,2,8,6.5,55.58,35.85,44],["Рузское вдхр.","",2,2,8,6.2,55.78,36.05,45],
["Озернинское вдхр.","",2,2,8,5.8,55.77,36.22,46],["оз. Сенеж","Сенеж",2,3,1,3,56.19,37.02,47],
["Шатурские озёра (Шатурская ГРЭС)","Шатурская ГРЭС (оз. Святое)",2,4,6,3.8,55.59,39.55,48],
["Иваньковское вдхр. (Московское море)","Иваньковское вдхр.",2,2,8,5.5,56.75,36.95,49],
["Тёплый сброс Конаковской ГРЭС","Конаковская ГРЭС",2,4,6,3.5,56.74,36.78,50],
["р. Волга (Тверь)","Волга",2,1,3,4.2,56.86,35.9,51],["р. Тверца","Тверца",2,0,0,2.1,56.87,35.92,51],
["оз. Плещеево","Плещеево озеро",2,2,4,8,56.76,38.78,52],
["р. Волга (Ярославль)","Волга",2,1,3,5.8,57.62,39.89,53],
["р. Которосль","Которосль",2,0,0,2.2,57.61,39.88,53],["Рыбинское вдхр.","",2,2,8,6.8,58.2,38.5,54],
["р. Ока (Серпухов / Кашира)","Ока (Серпухов)",2,1,3,3.6,54.88,37.42,55],
["р. Ока (Коломна)","Ока",2,1,3,3.8,55.08,38.77,56],["р. Ока (Рязань)","Ока",2,1,3,4.2,54.63,39.75,57],
["р. Пра (Мещёра)","Пра",2,0,0,1.8,54.95,40.15,58],
["р. Клязьма (Владимир)","Клязьма",2,0,0,2.2,56.12,40.41,59],
["р. Ока (Нижний Новгород)","Ока",2,1,3,5,56.32,43.99,60],
["р. Волга (Нижний Новгород)","Волга",2,1,3,6.5,56.33,44.01,60],
["р. Ветлуга","Ветлуга",2,1,3,3.4,56.85,45.45,61],["Горьковское вдхр.","",2,2,8,6.2,56.8,43.4,61],
["Чебоксарское вдхр.","",2,2,8,5.8,56.14,47.25,62],["р. Сура","Сура",2,0,0,2.5,55.85,46.35,63],
["р. Волга (Казань)","Волга",2,1,3,7.2,55.79,49.12,64],["р. Казанка","Казанка",2,0,0,2,55.8,49.11,64],
["р. Свияга","Свияга",2,0,0,2.4,55.72,48.65,65],
["р. Кама (Камское Устье)","Камское Устье",2,2,8,9.5,55.2,49.28,66],
["Нижнекамское вдхр. (Набережные Челны)","Нижнекамское вдхр.",2,2,8,6.8,55.7,52.35,67],
["р. Кама (Пермь)","Кама",2,1,3,6.2,58.01,56.25,68],["р. Чусовая","Чусовая",2,0,0,2.4,58.18,56.85,69],
["Камское вдхр.","",2,2,8,6.5,58.15,56.35,70],
["Куйбышевское вдхр. (Самара / Тольятти)","Куйбышевское вдхр.",2,2,8,8.5,53.2,50.15,71],
["р. Самара","Самара",2,0,0,2.5,53.18,50.11,71],["р. Сок","Сок",2,0,0,2.2,53.41,50.15,72],
["Саратовское вдхр.","",2,2,8,7.8,51.53,46.03,73],["Волгоградское вдхр.","",2,2,8,8.2,48.71,44.51,74],
["р. Волга (Астрахань / Дельта)","Волга (Дельта)",2,1,3,5.5,46.35,48.04,75],
["р. Бахтемир (Главный банк)","Бахтемир",2,1,3,7,45.95,47.65,76],["р. Бузан","Бузан",2,1,3,5,46.55,48.3,76],
["р. Ахтуба (Волго-Ахтубинская пойма)","Ахтуба",2,1,3,3.8,48,45.5,77],
["р. Белая (Уфа)","Белая (Агидель)",2,1,3,3.6,54.73,55.97,78],
["р. Уфа (Караидель)","Уфа (Уфимка)",2,0,0,2.5,54.76,56.05,78],
["Павловское вдхр.","",2,2,8,9,55.42,56.55,79],["оз. Аслыкуль","Аслыкуль",2,2,1,4.5,54.31,54.58,79],
["р. Вятка (Киров)","Вятка",2,1,3,3.2,58.6,49.66,80],["р. Урал (Оренбург)","Урал",2,1,3,2.8,51.77,55.1,81],
["Ириклинское вдхр.","",2,2,8,10,51.78,58.78,82],["р. Урал (Магнитогорск)","Урал",2,0,0,2.2,53.42,58.98,83],
["оз. Увильды (Челябинск)","Увильды",0,2,4,11,55.52,60.5,84],
["оз. Тургояк (Миасс)","Тургояк",0,2,4,14,55.15,60.06,84],
["Шершнёвское вдхр. (Челябинск)","Шершнёвское вдхр.",0,2,8,5.5,55.1,61.33,85],
["оз. Селигер","Селигер",2,2,4,5.8,57.2,33.05,86],["оз. Неро","Неро",2,3,1,1.5,57.17,39.43,87],
["Каспийское море (Махачкала)","Каспийское море",2,5,10,6.5,42.98,47.51,88],
["Каспийское море (Дербент)","Каспийское море",2,6,11,12,42.07,48.29,89],
["Ладожское озеро","",3,2,4,12,60.5,31,90],["Онежское озеро","",3,2,4,14,61.79,34.37,91],
["р. Нева","Нева",3,1,3,6.5,59.93,30.34,92],["р. Вуокса","Вуокса",3,1,3,4.5,60.68,30,93],
["оз. Отрадное","Отрадное",3,2,4,7.5,60.82,30.2,94],["р. Свирь","Свирь",3,1,3,5.2,60.91,34.17,95],
["р. Волхов","Волхов",3,1,3,4.8,60.1,32.3,96],
["оз. Ильмень (Великий Новгород)","Ильмень",3,3,1,2.8,58.28,31.28,97],
["оз. Сямозеро","Сямозеро",3,2,4,6,61.9,33.15,98],["оз. Сегозеро","Сегозеро",3,2,4,18,63.3,33.8,99],
["оз. Выгозеро","Выгозеро",3,2,4,7,63.6,34.7,100],["р. Суна","Суна",3,0,0,2.2,62.27,33.98,101],
["р. Шуя (Карелия)","Шуя",3,0,0,2,61.91,34.25,91],["оз. Пяозеро / Топозеро","Пяозеро",3,2,4,15,65.8,31,102],
["Баренцево море (Териберка)","",4,6,11,25,69.17,35.14,103],
["Кольский залив (Мурманск)","Кольский залив",4,5,10,18,68.97,33.08,104],
["Белое море (Кандалакшский залив)","Кандалакшский залив",4,5,10,12,67.15,32.4,105],
["Белое море (Двинский залив / Северодвинск)","Двинский залив",4,5,10,8.5,64.6,39.8,106],
["р. Северная Двина (Архангельск)","Северная Двина",4,1,3,6.5,64.54,40.52,107],
["р. Онега","Онега",4,1,3,3.8,63.9,38.1,108],["р. Вычегда (Сыктывкар)","Вычегда",4,1,3,3.5,61.67,50.83,109],
["р. Кола","Кола",4,0,0,1.8,68.88,33.02,110],["р. Тулома","Тулома",4,1,3,4.5,68.81,32.81,111],
["р. Варзуга","Варзуга",4,0,0,1.6,66.4,36.58,112],["р. Умба","Умба",4,0,0,2,66.68,34.35,112],
["р. Поной","Поной",4,0,0,2.2,67.07,39.5,113],["оз. Имандра","Имандра",4,2,4,10,67.6,33.1,114],
["оз. Ловозеро","Ловозеро",4,2,4,8,67.85,35.15,115],
["р. Печора (Нарьян-Мар)","Печора",4,1,3,6,67.64,53,116],
["р. Печора (г. Печора / Усинск)","Печора",4,1,3,4.8,65.14,57.22,117],
["р. Уса (Усинск)","Уса",4,1,3,3.8,65.98,57.55,118],
["р. Дон (Ростов-на-Дону)","Дон",6,1,3,5.5,47.22,39.72,119],
["р. Дон (Воронеж)","Дон",6,1,3,3.8,50.98,39.5,120],
["р. Воронеж (Воронежское вдхр.)","Воронежское вдхр.",6,2,8,4.2,51.67,39.2,121],
["Нововоронежское вдхр. (АЭС)","Нововоронежская АЭС",6,4,7,4.8,51.27,39.2,122],
["Цимлянское вдхр.","",6,2,8,8,47.6,42.1,123],
["р. Маныч (Весёловское вдхр.)","Маныч",6,2,8,4.2,47.1,40.8,124],
["р. Северский Донец","Северский Донец",6,1,3,3.2,48.32,40.26,125],
["р. Кубань (Краснодар)","Кубань",6,1,3,4,45.03,38.98,126],
["Краснодарское вдхр. (Кубанское море)","Краснодарское вдхр.",6,2,8,6.2,44.98,39.25,126],
["р. Кубань (Темрюк / дельта)","Кубань (Дельта)",6,1,3,3.5,45.27,37.38,127],
["Бейсугский лиман / р. Бейсуг","Бейсугский лиман",6,3,12,1.8,46.08,38.55,128],
["Чёрное море (Севастопольские бухты)","Севастопольские бухты",6,5,10,8.5,44.62,33.53,129],
["р. Чёрная (Инкерман)","р. Чёрная",6,0,0,1.5,44.61,33.6,130],
["Симферопольское вдхр.","",6,2,8,6.5,44.92,34.15,131],
["Чёрное море (ЮБК / Ялта)","Чёрное море (ЮБК)",6,6,11,15,44.5,34.17,132],
["Керченский пролив","",6,5,13,7.5,45.32,36.48,133],
["Цемесская бухта (Новороссийск)","Цемесская бухта",6,5,10,12,44.72,37.78,134],
["Чёрное море (Сочи / Адлер)","Чёрное море (Сочи)",6,6,11,16,43.59,39.73,135],
["р. Мзымта","Мзымта",6,0,0,1.8,43.42,39.92,136],["р. Сочи","",6,0,0,1.4,43.595,39.735,135],
["Азовское море (Таганрогский залив)","Таганрогский залив",6,5,10,4.5,47.2,38.92,137],
["Ейский лиман","",6,5,14,2.8,46.7,38.3,138],["оз. Абрау","Абрау",6,2,4,7,44.7,37.6,139],
["Финский залив (Маркизова лужа)","Финский залив",5,5,10,5.5,59.95,30.2,92],
["Финский залив (Дамба КЗС / Кронштадт)","Дамба Кронштадт",5,5,10,7.5,60.01,29.74,140],
["Выборгский залив","",5,5,10,7.2,60.71,28.75,141],["р. Луга (Усть-Луга)","Луга",5,1,3,3.5,59.68,28.3,142],
["р. Нарва (Ивангород)","Нарва",5,1,3,4.2,59.38,28.2,143],["Куршский залив","",5,5,10,3.8,54.96,20.47,144],
["Балтийское море (Балтийск / Янтарный)","Балтийское море",5,6,11,14,54.64,19.89,145],
["Калининградский (Вислинский) залив","Калининградский залив",5,5,10,3.5,54.65,20.15,146],
["р. Преголя","Преголя",5,1,3,3.2,54.71,20.51,146],
["р. Дейма / Матросовка","Дейма",5,0,0,2.8,54.82,21.1,147],
["оз. Чудско-Псковское","Чудское озеро",5,2,4,6.5,57.82,28.33,148],
["р. Великая","Великая",5,1,3,2.8,57.81,28.32,148],
["р. Енисей (Красноярск)","Енисей",1,1,3,6.8,56.01,92.87,149],
["Красноярское вдхр.","",1,2,8,16,55.95,92.35,150],["р. Мана","Мана",1,0,0,2.2,55.95,92.48,151],
["р. Кан","Кан",1,0,0,2.4,56.2,95.7,152],["оз. Белё / Шира (Хакасия)","Белё",1,2,4,9,54.65,90.15,153],
["р. Енисей (Енисейск)","Енисей",1,1,3,8.5,58.45,92.17,154],
["р. Енисей (Дудинка)","Енисей (Низовья)",1,1,3,12,69.4,86.18,155],
["р. Норилка / оз. Лама (Норильск)","Норилка / Лама",1,2,4,14,69.35,88.2,156],
["р. Ангара (Братское вдхр.)","Ангара (Братское вдхр.)",1,2,8,14,56.15,101.6,157],
["р. Ангара (Усть-Илимское вдхр.)","Усть-Илимское вдхр.",1,2,8,12,58,102.7,158],
["р. Лена (Якутск)","Лена",1,1,3,7.5,62.03,129.73,159],["р. Амга","Амга",1,0,0,2.5,60.9,131.98,160],
["р. Лена (Ленск)","Лена",1,1,3,5.8,60.72,114.93,161],["р. Вилюй","Вилюй",1,1,3,4.5,62.08,120.42,162],
["р. Алдан","Алдан",1,1,3,4.8,58.96,126.28,163],
["р. Ангара (Иркутск)","Ангара (Иркутск)",8,1,3,4.5,52.285,104.28,164],
["Иркутское вдхр.","",8,2,8,8.5,52.15,104.45,164],["р. Иркут","Иркут",8,0,0,2.2,52.26,104.2,165],
["оз. Байкал (Листвянка)","Байкал (Листвянка)",8,2,4,22,51.85,104.86,166],
["оз. Байкал (Малое Море / Ольхон)","Байкал (Малое Море)",8,2,4,14,53.2,107.35,167],
["оз. Байкал (Чивыркуйский залив)","Чивыркуйский залив",8,2,4,8.5,53.7,109.15,168],
["оз. Байкал (Слюдянка)","Байкал (Слюдянка)",8,2,4,18,51.66,103.71,169],
["р. Селенга (Улан-Удэ / дельта)","Селенга",8,1,3,4.2,51.83,107.58,170],
["оз. Гусиное (Гусиноозёрская ГРЭС)","Гусиное озеро (ГРЭС)",8,4,6,5.5,51.2,106.4,171],
["р. Баргузин","Баргузин",8,0,0,2.6,53.62,109.62,172],["р. Снежная","Снежная",8,0,0,1.8,51.48,104.63,173],
["оз. Котокель","Котокель",8,3,1,3.5,52.8,108.15,174],
["р. Амур (Хабаровск)","Амур",9,1,3,6.5,48.48,135.07,175],["р. Анюй","Анюй",9,0,0,2.4,49.3,136.5,176],
["р. Хор","Хор",9,0,0,2.5,47.78,134.96,176],["р. Амур (Благовещенск)","Амур",9,1,3,5.2,50.27,127.54,177],
["р. Амур (Комсомольск-на-Амуре)","Амур",9,1,3,7.2,50.55,137,178],
["р. Зея (Благовещенск)","Зея",9,1,3,4.2,50.3,127.6,177],["Зейское вдхр.","",9,2,8,14,53.75,127.25,179],
["Бурейское вдхр.","",9,2,8,12,50.18,130.3,180],["р. Уссури","Уссури",9,1,3,3.6,45.46,133.42,181],
["оз. Ханка","Ханка",9,3,1,2.8,44.99,132.06,182],["оз. Болонь","Болонь",9,3,1,2.2,49.85,136.45,183],
["Амурский залив (Владивосток)","Амурский залив",10,5,10,14,43.12,131.88,184],
["р. Раздольная (Суйфун)","Раздольная",10,1,3,3.2,43.35,131.8,185],
["Уссурийский залив (Шамора)","Уссурийский залив",10,5,10,11,43.19,132.12,184],
["Залив Находка","",10,5,10,15,42.82,132.88,186],["Авачинская губа","",10,5,9,16,53.02,158.65,187],
["р. Авача","Авача",10,0,0,2,53.18,158.38,188],["р. Паратунка","Паратунка",10,0,0,2.2,52.96,158.25,189],
["р. Камчатка","Камчатка",10,1,3,4.5,56.32,160.84,190],
["р. Быстрая (Большая)","Быстрая (Большая)",10,0,0,2.4,52.75,156.3,191],
["Охотское море (бухта Нагаева)","Бухта Нагаева",10,5,10,18,59.56,150.8,192],
["Анивский залив","",10,5,10,12,46.62,142.77,193],
["оз. Тунайча (Сахалин)","Тунайча",10,2,4,9,46.82,143.15,194],
["р. Лютога (Сахалин)","Лютога",10,0,0,2,46.78,142.52,195],["р. Тымь","Тымь",10,0,0,2.2,50.85,142.68,196],
["р. Днепр (Смоленск)","Днепр",7,1,3,2.8,54.78,32.05,197],
["Десногорское вдхр. (Смоленская АЭС)","Десногорское вдхр.",7,4,7,6.5,54.15,33.28,198],
["р. Десна (Брянск)","Десна",7,1,3,3.2,53.25,34.37,199],
["р. Сейм (Курск)","Сейм",7,1,3,2.6,51.73,36.19,200],
["Курчатовское вдхр. (Курская АЭС)","Курчатовское вдхр.",7,4,7,5.8,51.65,35.65,201],
["р. Оскол","Оскол",7,0,0,2.1,51.3,37.83,202],["Старооскольское вдхр.","",7,2,8,5.2,51.4,37.95,202],
["Белгородское вдхр.","",7,2,8,4.8,50.59,36.59,203],
["оз. Негито (Нигито)","Озеро Негито",0,2,4,5.5,65.41,77.12,204],
["оз. Ямбуто (ЯНАО)","Озеро Ямбуто",0,2,4,6.2,67.31,74.15,205],
["оз. Пякуто","Озеро Пякуто",0,2,4,5,63.43,73.12,206],
["оз. Тету-Мамонтотяй","Тету-Мамонтотяй",0,2,4,5.8,63.18,74.82,207],
["оз. Вынглор","Озеро Вынглор",0,3,1,2.8,63.28,76.1,208],
["оз. Часельское","Часельское озеро",0,2,4,6,65.45,80.55,209],
["оз. Чёртово (Красноселькуп)","Чёртово озеро",0,2,4,7.5,65.05,81.9,210],
["оз. Большое Щучье (Полярный Урал)","Большое Щучье",0,2,4,18,67.89,66.31,211],
["оз. Шурышкарский Сор","Шурышкарский Сор",0,3,15,2.4,65.91,65.18,212],
["оз. Войкарский Сор","Войкарский Сор",0,3,15,2.5,65.72,64.65,213],
["р. Таб-Яха","Таб-Яха",0,0,0,2.3,65.81,76.32,214],
["р. Хейги-Яха (Лонгъюган)","Хейги-Яха",0,0,0,2.2,65.31,73.85,215],
["р. Мессояха","Мессояха",0,1,3,3.8,67.75,77.5,216],["р. Харампур","Харампур",0,0,0,2.1,64.31,78.22,217],
["р. Северная Сосьва","Северная Сосьва",0,1,3,4.5,63.93,65.04,218],
["р. Казым (Белоярский)","Казым",0,0,0,2.5,63.71,66.7,219],
["оз. Нумто","Озеро Нумто",0,3,1,2.2,63.52,71.35,220],
["оз. Сырковый Сор (Салым)","Сырковый Сор",0,2,4,4.5,60.05,71.32,221],
["оз. Торм-Эмтор","Торм-Эмтор",0,3,1,2.6,61.55,77.8,222],
["р. Бирь (Мишкино / Бирск)","Бирь",2,0,0,2,55.43,55.9,223],
["р. Уфа (Караидель / Чандар)","Уфа (Караидель)",2,1,3,4.8,55.83,56.91,224],
["р. Быстрый Танып","Быстрый Танып",2,0,0,2.2,56.12,54.58,225],
["р. Дёма (Давлеканово / Чишмы)","Дёма",2,0,0,2.3,54.22,55.03,226],
["р. Сим","Сим",2,0,0,2.1,54.62,56.38,227],["р. Инзер","Инзер",2,0,0,1.9,54.42,57.18,228],
["р. Ай (Месягутово / Лаклы)","Ай",2,0,0,2,55.55,58.25,229],
["р. Юрюзань","Юрюзань",2,0,0,2.1,55.38,57.9,230],
["р. Ик (Октябрьский / Туймазы)","Ик",2,0,0,2.4,54.48,53.47,231],
["оз. Аслыкуль (Башкортостан)","Озеро Аслыкуль",2,2,4,5.5,54.31,54.58,232],
["оз. Кандрыкуль (Башкортостан)","Озеро Кандрыкуль",2,2,4,6.5,54.5,54.05,233],
["оз. Банное (Якты-Куль)","Озеро Банное",2,2,4,10,53.59,58.63,234],
["Нугушское вдхр.","",2,2,8,9,53.05,56.45,235],["Юмагузинское вдхр.","",2,2,8,12,52.96,56.55,236],
["Кармановское вдхр. (ГРЭС)","Кармановское вдхр.",2,4,6,5.5,56.22,54.33,237],
["оз. Шамсутдин (Бирск)","Озеро Шамсутдин",2,3,16,3.2,55.44,55.48,238],
["р. Шахе (Головинка / Сочи)","Шахе",6,0,0,1.6,43.79,39.46,239],["р. Сочи","",6,0,0,1.5,43.6,39.73,135],
["р. Псоу (Адлер / Сириус)","Псоу",6,0,0,1.7,43.395,40.01,240],
["Имеретинская бухта (Сириус)","Имеретинский порт (Сириус)",6,5,10,7.5,43.4,39.95,240],
["р. Хоста (Сочи)","Хоста",6,0,0,1.4,43.515,39.87,241],["Бейсугский лиман","",6,5,14,2.2,46.08,38.45,242],
["Ахтанизовский лиман","",6,3,17,1.8,45.31,37.18,243],
["оз. Мишкинское (пгт. Мишкино)","оз. Мишкинское",0,3,1,2.2,55.342,63.915,244],
["р. Миасс (Мишкинский / Каргапольский р-н)","р. Миасс",0,0,0,2.3,55.545,63.885,245],
["оз. Песчаное (Шумихинский / Мишкинский р-н)","оз. Песчаное",0,3,1,2.8,55.435,63.52,246],
["р. Юргамыш (Юргамыш / Мишкино)","р. Юргамыш",0,0,0,1.8,55.38,64.465,247],
["оз. Горькое-Пресное / Круглое (Шумиха)","оз. Круглое (Шумиха)",0,3,1,2.5,55.26,63.28,248],
["р. Миасс (Чесноковка / Шумихинский р-н)","р. Миасс (Шумиха)",0,0,0,2.2,55.48,63.25,249],
["р. Исеть (Шадринск / Далматово)","р. Исеть (Шадринск)",0,0,18,2.6,56.082,63.635,250],
["р. Канаш / оз. Боровое (Шадринск)","р. Канаш (Шадринск)",0,0,0,1.8,56.04,63.59,250],
["р. Тобол (Курган)","",0,1,3,4.2,55.438,65.352,251],
["Орловское вдхр. (Курганская ТЭЦ)","Орловское вдхр.",0,4,19,3.8,55.452,65.412,251],
["оз. Бездонное / Старица Тобола (Курган)","оз. Бездонное",0,3,16,2.8,55.385,65.295,251],
["р. Куртамыш (Куртамыш)","р. Куртамыш",0,0,0,1.9,54.912,64.435,252],
["оз. Большое Пустое / Птичанские озёра","оз. Большое Пустое",0,3,1,2.4,54.88,64.35,253],
["оз. Башкирское / Пресное (Макушино)","оз. Башкирское (Макушино)",0,3,1,2.3,55.215,67.25,254],
["оз. Песчаное / Пресное (Петухово)","оз. Песчаное (Петухово)",0,3,1,2.5,55.085,67.91,255],
["оз. Мартыново / Бутырино (Частоозерье)","оз. Мартыново",0,3,1,2.6,55.572,67.912,256],
["оз. Чёрное (Мокроусово / Зауралье)","оз. Чёрное (Зауралье)",0,2,4,4.5,55.62,66.95,257],
["р. Тобол (Ялуторовск / Заводоуковск)","р. Тобол (Ялуторовск)",0,1,3,4,56.65,66.32,258],
["оз. Сингуль (Ялуторовский р-н)","оз. Сингуль",0,2,4,4.5,56.45,66.05,259],
["р. Вагай (Вагай)","р. Вагай",0,0,0,2.4,57.938,69.025,260],
["р. Иртыш (Уват)","",0,1,3,6.5,59.142,68.892,261],
["р. Туртас (Туртас / Уват)","р. Туртас",0,0,0,2.5,58.945,69.145,262],
["р. Демьянка (Демьянка)","р. Демьянка",0,0,0,2.8,59.548,69.31,263],
["р. Тобол (Ярково)","",0,1,3,4.5,57.41,67.078,264],
["р. Тавда (Нижняя Тавда / Тавда)","р. Тавда",0,1,3,4.2,57.85,65.7,265],
["р. Ишим (г. Ишим)","р. Ишим",0,1,3,3.8,56.11,69.495,266],
["оз. Мергень / Старица Ишима","оз. Мергень",0,3,16,2.5,55.642,69.238,267],
["р. Чусовая / Волчихинское вдхр. (Ревда / Первоуральск)","Волчихинское вдхр.",0,2,8,5.5,56.78,60.02,268],
["Верхнемакаровское вдхр. (Полевской)","Верхнемакаровское вдхр.",0,2,8,5,56.48,60.22,269],
["р. Исеть / оз. Сунгуль (Каменск-Уральский)","р. Исеть (Каменск-Уральский)",0,0,18,2.5,56.415,61.918,270],
["Черноисточинское вдхр. / Тагильский пруд (Нижний Тагил)","Тагильский пруд",0,2,8,6,57.9,59.95,271],
["р. Сосьва / Киселёвское вдхр. (Серов)","р. Сосьва (Серов)",0,0,18,2.8,59.605,60.58,272],
["р. Сосьва (пгт. Сосьва)","р. Сосьва",0,1,3,3.8,59.178,61.855,273],
["р. Лозьва / р. Сосьва (Гари)","р. Лозьва (Гари)",0,1,3,4.2,59.432,62.352,274],
["р. Лозьва / р. Ивдель (Ивдель)","р. Лозьва (Ивдель)",0,0,18,2.5,60.692,60.422,275],
["оз. Большие Касли / оз. Иткуль (Касли)","оз. Большие Касли",0,2,4,7.5,55.895,60.76,276],
["Южноуральское вдхр. (Южноуральская ГРЭС)","Южноуральское вдхр. (ГРЭС)",0,4,6,5.2,54.445,61.255,277],
["р. Иртыш (Тара)","",0,1,3,5.5,56.895,74.375,278],["р. Омь (Калачинск)","",0,0,0,2.2,55.055,74.578,279],
["р. Иртыш (Черлак)","",0,1,3,4.8,54.158,74.808,280],
["Новосибирское вдхр. (Ордынское / Спирино)","Обское море (Ордынское)",0,2,8,7,54.375,81.905,281],
["р. Обь (Сузун / Камень-на-Оби)","р. Обь (Сузун)",0,1,3,5.2,53.785,81.8,282],
["оз. Чаны (Чаны / Барабинск)","оз. Чаны",0,2,20,4.2,55.15,77.55,283],
["оз. Сартлан (Барабинский р-н)","оз. Сартлан",0,2,20,4.5,55.02,78.58,284],
["р. Обь (Колпашево)","",0,1,3,6.2,58.318,82.912,285],
["р. Обь (Парабель / Каргасок)","р. Обь (Парабель)",0,1,3,6.5,58.85,81.15,286],
["р. Томь (Кемерово / Юрга)","р. Томь (Кемерово)",0,1,3,4,55.5,85.5,287],
["р. Томь (Новокузнецк / Междуреченск)","р. Томь (Новокузнецк)",0,1,3,3.8,53.72,87.55,288],
["р. Алей / Гилёвское вдхр. (Рубцовск)","р. Алей (Рубцовск)",0,0,18,2.4,51.502,81.21,289],
["р. Катунь (Горно-Алтайск / Майма)","р. Катунь",0,0,21,2.8,51.958,85.955,290],
["р. Пяку-Пур / р. Пурпе (Губкинский / Пурпе)","р. Пяку-Пур (Губкинский)",0,0,18,2.5,64.45,76.58,291],
["р. Пяку-Пур / оз. Городское (Муравленко)","оз. Городское (Муравленко)",0,3,1,2.4,63.794,74.525,292],
["р. Левая Хетта / р. Надым (Ягельный / Приозёрный)","р. Левая Хетта",0,0,0,2.2,64.82,72.8,293],
["р. Хейги-Яха / р. Надым (Лонгъюган)","р. Хейги-Яха (Лонгъюган)",0,0,0,2.2,65.305,71.2,294],
["Обская губа / р. Ныда (Ныда / Нори / Заполярный)","Обская губа (Ныда)",0,5,9,4.5,66.5,73.1,295],
["р. Кутопьюган / Обская губа (Кутопьюган)","р. Кутопьюган",0,0,0,2.2,66.08,71.2,296],
["р. Пур (Самбург)","",0,1,3,5,66.85,78.225,297],
["Тазовская губа (Антипаюта)","",0,5,9,5,69.095,76.855,298],
["Гыданская губа / р. Гыда (Гыда)","Гыданская губа",0,5,9,5.5,70.892,78.47,299],
["Обская губа / р. Сеяха (Сеяха)","Обская губа (Сеяха)",0,5,9,6,70.165,72.515,300],
["Обская губа (Новый Порт)","",0,5,9,5.5,67.69,72.9,301],
["Обская губа / р. Ярудей (Яр-Сале / Панаевск / Салемал)","Обская дельта (Яр-Сале)",0,1,3,5.5,66.8,69.95,302],
["р. Обь / р. Щучья (Аксарка / Белоярск)","р. Обь (Аксарка)",0,1,3,7,66.68,67.95,303],
["р. Таз (Красноселькуп)","",0,1,3,4.8,65.702,82.463,304],["р. Таз (Толька)","",0,1,3,4.2,64,82.06,305],
["р. Еркал-Надей-Пур (Халясавэй)","р. Еркал-Надей-Пур",0,0,0,2.4,63.39,78.38,306],
["р. Сыня / р. Малая Обь (Овгорт / Горки)","р. Сыня (Овгорт)",0,0,18,2.8,64.95,64.3,307],
["р. Пим (Лянтор / Нижнесортымский)","р. Пим",0,0,18,2.5,62,71.95,308],
["р. Обь / пр. Каюковская (Лангепас / Покачи)","р. Обь (Лангепас)",0,1,3,6,61.45,75.35,309],
["р. Аган (Радужный / Новоаганск)","р. Аган",0,1,3,4.2,62.05,77.05,310],
["р. Ингуягун / оз. Когалымское (Когалым)","р. Ингуягун (Когалым)",0,0,0,2.4,62.265,74.485,311],
["пр. Юганская Обь / р. Большой Балык (Нефтеюганск / Пыть-Ях / Пойковский)","Юганская Обь",0,1,3,5.5,61.05,72.4,312],
["р. Иртыш (Горноправдинск)","",0,1,3,6,60.056,69.908,313],
["р. Обь / Малая Обь (Приобье / Нягань / Октябрьское)","р. Обь (Приобье)",0,1,3,6.5,62.42,65.65,314],
["р. Северная Сосьва (Игрим)","",0,1,3,4.8,63.19,64.417,315],
["р. Конда (Урай / Междуреченский)","р. Конда (Урай)",0,1,3,3.8,59.9,65.3,316],
["оз. Окунёво / р. Эсс (Советский / Югорск)","оз. Окунёво (Советский)",0,2,4,4.2,61.34,63.45,317],
["р. Белая (Стерлитамак / Салават / Ишимбай)","р. Белая (Стерлитамак)",2,1,3,3.5,53.52,55.95,318],
["р. Белая / Белорецкий пруд (Белорецк)","р. Белая (Белорецк)",2,0,21,2.2,53.965,58.4,319],
["оз. Ургун / оз. Калкан (Учалы)","оз. Ургун (Учалы)",2,2,4,5.5,54.32,59.38,320],
["оз. Талкас / р. Таналык (Баймак / Сибай)","оз. Талкас (Баймак)",2,2,4,6.5,52.66,58.5,321],
["р. Урал (Орск)","",2,1,3,3,51.23,58.475,322],
["р. Самара / р. Бузулук (Бузулук)","р. Самара (Бузулук)",2,0,18,2.5,52.788,52.262,323],
["Ижевский пруд / р. Иж (Ижевск)","Ижевский пруд",2,2,8,5.5,56.86,53.18,324],
["Воткинское вдхр. (Чайковский / Воткинск / Оса)","Воткинское вдхр.",2,2,8,8,57,54.55,325],
["р. Сылва / р. Ирень (Кунгур)","р. Сылва (Кунгур)",2,0,18,2.6,57.43,56.95,326],
["Камское вдхр. (Березники / Соликамск / Пожва)","Камское вдхр. (Березники)",2,2,8,7.5,59.41,56.78,327],
["р. Вишера / р. Колва (Красновишерск / Чердынь)","р. Вишера",2,1,3,3.5,60.403,56.8,328],
["р. Вятка (Вятские Поляны / Мамадыш)","р. Вятка (Мамадыш)",2,1,3,4.2,55.95,51.25,329],
["р. Кама (Чистополь / Рыбная Слобода)","р. Кама (Чистополь)",2,1,3,8,55.37,50.55,330],
["Куйбышевское вдхр. (Ульяновск / Димитровград / Сенгилей)","Куйбышевское вдхр. (Ульяновск)",2,2,8,9,54.315,48.45,331],
["Саратовское вдхр. (Сызрань / Хвалынск / Балаково / Вольск)","Волга (Балаково / Хвалынск)",2,2,8,8.5,52.35,48.05,332],
["Сурское вдхр. / р. Сура (Пенза)","Сурское вдхр. (Пенза)",2,2,8,6,53.15,45.15,333],
["р. Инсар / р. Сура (Саранск)","р. Сура (Мордовия)",2,0,18,2.4,54.185,45.2,334],
["Волгоградское вдхр. (Камышин / Ровное)","Волгоградское вдхр. (Камышин)",2,2,8,9.5,50.09,45.41,335],
["р. Ахтуба / р. Волга (Харабали / Селитренное / Енотаевка)","р. Ахтуба (Харабали)",2,1,3,5.5,47.35,47.25,336],
["Каспийские раскаты (Лагань)","Каспийский канал (Лагань)",2,5,10,3.5,45.39,47.365,337],
["Чограйское вдхр. / оз. Маныч (Элиста)","Чограйское вдхр.",6,2,8,4.8,46.15,44.3,338],
["р. Терек / Кизлярский залив (Кизляр)","р. Терек (Кизляр)",2,1,3,3.5,43.85,46.72,339],
["Угличское вдхр. (Углич / Калязин)","Угличское вдхр.",2,2,8,6.5,57.4,38.1,340],
["Рыбинское вдхр. (Весьегонск / Брейтово)","Рыбинское вдхр. (Весьегонск)",2,2,8,7,58.65,37.3,341],
["р. Волга (Ржев / Зубцов)","р. Волга (Ржев)",2,1,3,3,56.262,34.33,342],
["Вышневолоцкое вдхр. / оз. Песьво (Вышний Волочёк / Удомля)","оз. Песьво (Удомля АЭС)",2,4,7,5.5,57.75,34.8,343],
["Горьковское вдхр. / р. Волга (Кострома / Волгореченск / Плёс / Кинешма)","р. Волга (Кострома / Кинешма)",2,1,3,6.5,57.45,41.52,344],
["Уводьское вдхр. (Иваново)","Уводьское вдхр.",2,2,8,5,57.05,40.9,345],
["р. Ока (Муром / Павлово / Выкса)","р. Ока (Муром)",2,1,3,4.8,55.58,42.1,346],
["р. Ока (Касимов / Шилово)","р. Ока (Касимов)",2,1,3,4.5,54.65,41.15,347],
["р. Упа / р. Ока (Тула / Алексин)","р. Упа (Тула)",2,0,18,2.4,54.2,37.62,348],
["р. Ока / р. Протва (Калуга / Обнинск / Наро-Фоминск)","р. Ока (Калуга)",2,1,3,3.6,54.75,36.45,349],
["Чебоксарское вдхр. / р. Волга (Лысково / Макарьево / Йошкар-Ола)","р. Волга (Макарьево)",2,2,8,6.5,56.25,46.2,350],
["р. Луга (г. Луга)","р. Луга",5,0,18,2.5,58.74,29.85,351],
["р. Волхов / р. Тихвинка (Кириши / Тихвин)","р. Волхов (Кириши)",3,1,3,4.5,59.52,32.75,352],
["оз. Валдайское / р. Мста (Валдай / Боровичи)","оз. Валдайское",3,2,4,8,58.15,33.55,353],
["Чудское озеро (Гдов)","",5,2,4,7,58.74,27.8,354],
["р. Ловать / оз. Жижицкое (Великие Луки)","р. Ловать (Великие Луки)",3,0,18,2.4,56.34,30.53,355],
["р. Неман (Советск)","р. Неман",5,1,3,3.8,55.085,21.885,356],
["Ладожские шхеры (Сортавала / Лахденпохья / Питкяранта / Олонец)","Ладожские шхеры (Сортавала)",3,2,4,14,61.55,31.1,357],
["Онежское озеро / р. Водла (Пудож / Медвежьегорск)","р. Водла (Онежское оз.)",3,1,3,5.5,61.81,36.52,358],
["Белое море / р. Кемь (Беломорск / Кемь)","Белое море (Беломорск / Кемь)",4,5,10,9,64.75,34.68,359],
["оз. Среднее Куйто / оз. Нюк (Калевала / Костомукша)","оз. Куйто (Калевала)",3,2,4,10,64.9,30.9,360],
["оз. Кереть / Чупинская губа (Лоухи)","оз. Кереть (Лоухи)",4,2,4,9.5,66.08,33.05,361],
["р. Северная Двина (Котлас)","",4,1,3,5.2,61.255,46.65,362],
["р. Вага (Вельск)","",4,1,3,3.5,61.07,42.1,363],
["р. Мезень (Мезень)","р. Мезень",4,1,3,4.5,65.85,44.24,364],
["р. Ижма / р. Ухта (Ухта)","р. Ижма (Ухта)",4,1,3,3.5,63.57,53.69,365],
["р. Печора (Усть-Цильма)","",4,1,3,6,65.442,52.15,366],
["р. Воркута / р. Уса (Воркута)","р. Уса (Воркута)",4,0,22,2.4,67.498,64.052,367],
["р. Дон (Вёшенская / Павловск)","р. Дон (Вёшенская)",6,1,3,4.2,50,40.9,368],
["р. Дон (Калач-на-Дону / Цимлянск)","р. Дон (Калач-на-Дону)",6,1,3,5,48.685,43.525,369],
["р. Протока / р. Кирпили (Славянск-на-Кубани / Тимашевск)","р. Протока (Славянск)",6,1,3,3.5,45.45,38.5,370],
["Чёрное море (Джубга / Архипо-Осиповка / Туапсе)","Чёрное море (Туапсе / Джубга)",6,5,23,10,44.22,38.8,371],
["р. Белая / Майкопское вдхр. (Майкоп)","р. Белая (Майкоп)",6,0,21,2,44.61,40.1,372],
["Феодосийский залив / Чёрное море (Судак / Феодосия)","Феодосийский залив",6,5,10,9,44.95,35.18,373],
["Каламитский залив / оз. Донузлав (Евпатория / Черноморское)","оз. Донузлав / Евпатория",6,5,10,8,45.35,33.05,374],
["Новотроицкое вдхр. / оз. Сенгилеевское (Ставрополь)","Новотроицкое вдхр. (ГРЭС)",6,4,6,5,45.15,41.8,375],
["р. Подкумок / р. Кума (Пятигорск / КМВ)","р. Подкумок (Пятигорск)",2,0,24,1.8,44.05,43.06,376],
["Матырское вдхр. / р. Дон (Липецк / Елец)","р. Дон / Матырское вдхр. (Липецк)",6,1,3,3.6,52.615,39.05,377],
["р. Цна / Котовское вдхр. (Тамбов)","р. Цна (Тамбов)",2,0,18,2.5,52.72,41.455,378],
["р. Ока (Орёл)","",2,0,18,2.2,52.967,36.065,379],["р. Чулым (Ачинск)","",0,1,3,3.8,56.27,90.495,380],
["р. Енисей / р. Нижняя Тунгуска (Туруханск)","р. Енисей (Туруханск)",1,1,3,10,65.795,87.96,381],
["р. Енисей (Игарка)","",1,1,3,11,67.465,86.585,382],
["р. Енисей / Красноярское вдхр. (Абакан / Минусинск / Саяногорск)","р. Енисей (Абакан / Саяногорск)",1,1,3,6.5,53.5,91.5,383],
["р. Енисей / р. Бий-Хем (Кызыл)","р. Енисей (Кызыл)",1,1,3,4.5,51.72,94.44,384],
["р. Лена (Усть-Кут)","",1,1,3,4.2,56.795,105.765,385],
["оз. Байкал / р. Верхняя Ангара (Северобайкальск)","Байкал (Северобайкальск)",8,2,4,16,55.635,109.325,386],
["оз. Кенон / р. Ингода (Чита)","",9,2,25,4.5,52.035,113.5,387],
["Вилюйское вдхр. / р. Малая Ботуобия (Мирный)","Вилюйское вдхр. (Мирный)",1,2,8,10,62.535,113.96,388],
["р. Вилюй (Вилюйск)","",1,1,3,5,63.755,121.624,389],
["р. Чульман / р. Тимптон (Нерюнгри)","р. Чульман (Нерюнгри)",1,0,26,2.2,56.66,124.725,390],
["Губа Буор-Хая / дельта Лены (Тикси)","Дельта Лены / Тикси",1,5,9,8,71.637,128.868,391],
["р. Зея (Свободный)","",9,1,3,4.5,51.375,128.135,392],
["р. Тында / р. Гилюй (Тында)","р. Гилюй (Тында)",9,0,26,2.4,55.155,124.725,393],
["р. Бира (Биробиджан)","",9,0,18,2.5,48.795,132.92,394],
["Амурский лиман / р. Амур (Николаевск-на-Амуре)","Амурский лиман (Николаевск)",10,5,14,6.5,53.145,140.72,395],
["Татарский пролив (Ванино / Советская Гавань)","Бухта Ванино / Совгавань",10,5,23,12,49.02,140.28,396],
["р. Поронай / залив Терпения (Поронайск)","р. Поронай / Залив Терпения",10,5,10,7,49.222,143.102,397],
["Набильский залив / р. Тымь (Ноглики)","Набильский залив (Ноглики)",10,5,10,5.5,51.805,143.14,398],
["Залив Помрь / Охотское море (Оха)","Залив Помрь (Оха)",10,5,10,6,53.59,142.95,399],
["р. Камчатка / оз. Нерпичье (Усть-Камчатск)","Устье р. Камчатка",10,1,3,5.5,56.228,162.476,400],
["Анадырский лиман / р. Анадырь (Анадырь)","Анадырский лиман",10,5,14,8,64.733,177.515,401],
["р. Нара (Наро-Фоминск)","р. Нара",2,0,0,2.2,55.389,36.736,402],
["Горьковское вдхр. (Юрьевец)","",2,2,8,9.5,57.322,43.118,403],
["р. Клязьма (Ковров)","",2,1,3,3.8,56.362,41.305,404],
["р. Волга (Лысково / Макарьево)","",2,1,3,8,56.048,45.045,405],
["р. Ока (Павлово)","",2,1,3,6,55.966,43.078,406],
["р. Малая Кокшага (Йошкар-Ола)","р. Малая Кокшага",2,0,0,2.8,56.634,47.905,407],
["Черемшанский залив (Димитровград)","Черемшанский залив",2,2,8,6.5,54.212,49.585,408],
["Куйбышевское вдхр. (Тольятти)","Жигулёвское море (Тольятти)",2,2,8,12,53.485,49.38,409],
["Саратовское вдхр. (Сызрань)","р. Волга (Сызрань)",2,1,3,8.5,53.142,48.468,410],
["Усинский залив (Шигоны)","Усинский залив",2,2,8,7.5,53.395,48.72,411],
["р. Волга (Вольск / Маркс)","",2,1,3,10,51.905,47.12,412],
["Волгоградское вдхр. (Ровное)","р. Волга (Ровное)",2,2,8,9.5,50.778,46.065,413],
["р. Ахтуба (Ахтубинск)","",2,1,3,6.5,48.282,46.155,414],
["р. Чусовая (Чусовой)","",2,1,3,3.5,58.285,57.815,415],
["Воткинское вдхр. (Оса)","р. Кама (Оса)",2,2,8,9,57.292,55.445,416],
["Обвинский залив (Ильинский)","р. Обва (Ильинский)",2,2,8,7,58.572,55.695,417],
["Камское вдхр. (Пожва)","р. Кама (Пожва)",2,2,8,8.5,59.092,56.11,418],
["р. Быстрый Танып (Балтачево / Татышлы)","р. Быстрый Танып (Татышлы)",2,0,0,2.8,56.145,55.88,419],
["р. Сюнь (Бакалы)","",2,0,0,2.4,55.182,53.805,420],["р. База (Чекмагуш)","",2,0,0,2.2,55.138,54.66,421],
["р. Зилим (Красноусольский)","р. Зилим",2,0,0,2.5,53.925,56.51,422],
["р. Белая (Кумертау / Мелеуз)","р. Белая (Мелеуз / Кумертау)",2,1,3,3.8,52.955,55.925,423],
["р. Белая (Актаныш)","",2,1,3,6,55.725,54.095,424],
["Онежское озеро (Медвежьегорск)","",11,2,20,12,62.895,34.468,425],
["р. Кемь и Выг (Кемь / Беломорск)","р. Кемь (Кемь)",12,1,3,4.5,64.952,34.605,426],
["р. Нижний Выг (Беломорск)","р. Выг (Беломорск)",12,1,3,4.5,64.522,34.76,427],
["р. Олонка и Ладога (Олонец)","р. Олонка (Олонец)",11,0,0,2.8,60.985,32.968,428],
["р. Дон (Вёшенская)","",13,1,3,5.5,49.622,41.732,429],
["р. Дон (Павловск)","",13,1,3,5.2,50.455,40.095,430],
["Черноморская акватория (Джубга / Архипо-Осиповка)","Чёрное море (Джубга)",13,6,27,10,44.325,38.65,431],
["Дельта р. Селенга (Кабанск)","р. Селенга (Кабанск)",14,1,3,4.8,52.055,106.645,432],
["р. Лена (Покровск)","",15,1,3,8,61.482,129.152,433],
["р. Алдан / р. Селигдар (Алдан)","р. Алдан (Алдан)",15,1,3,4.5,58.65,125.45,434],
["р. Амур (Николаевск-на-Амуре)","р. Амур (Николаевск)",16,1,3,11,53.138,140.715,395],
["оз. Ханка (Спасск-Дальний)","",16,2,20,4.2,44.655,132.68,435],
["р. Таз (Заполярный)","",0,1,3,6,66.41,73.85,436],["р. Надым (Нори)","",0,1,3,5.5,66.152,72.38,437],
["р. Пякупур (Ханымей)","",0,1,3,4.5,63.725,75.955,438],
["оз. Чаны (Чаны)","оз. Чаны (Северный плёс)",0,2,20,3.5,55.25,76.78,439],
["р. Раздольная (Уссурийск)","",16,1,3,3.5,43.792,131.945,440],
["р. Малая Обь (Горки)","",0,1,3,6.5,65.078,65.285,441],
["р. Сортым-Пим (Нижнесортымский)","р. Пим (Нижнесортымский)",0,0,0,2.6,62.44,71.755,442],
["р. Волга / Костромской залив (Кострома)","р. Волга (Кострома)",2,1,3,7.5,57.765,40.918,443],
["р. Енисей (Железногорск / Атаманово)","р. Енисей (Железногорск)",15,1,3,6.5,56.265,93.49,444],
["Залив Посьета / Бухта Славянка (Славянка)","Залив Посьета (Славянка)",16,5,10,10,42.865,131.392,445],
["Куйбышевское вдхр. (Звенигово)","р. Волга (Звенигово)",2,1,3,8.5,55.968,48.012,446],
["Рыбинское вдхр. / р. Согожа (Пошехонье)","Рыбинское вдхр. (Пошехонье)",2,2,8,6.5,58.5,39.11,447]
].map(r => ({
 name: r[0], cleanName: r[1] || r[0], basin: _BC[r[2]], wType: _WC[r[3]],
 typeTag: _TT[r[4]], defDepth: r[5], lat: r[6], lon: r[7], region: _RG[r[8]]
}));

const BOT_CITIES_DB = [
["Новый Уренгой", 66.0833, 76.68, 0],
["Коротчаево", 65.9472, 78.1486, 0],
["Лимбяяха", 66.0581, 77.7914, 0],
["Уренгой (пгт)", 65.9631, 78.3686, 0],
["Ямсовей", 65.6542, 76.9531, 0],
["Пангоды", 65.85, 74.4856, 0],
["Правохеттинский", 65.658, 73.719, 0],
["Старый Надым", 65.565, 72.652, 0],
["Надым", 65.5333, 72.5167, 0],
["Ягельный", 64.96, 72.71, 0],
["Приозёрный (ЯНАО)", 64.67, 72.9, 0],
["Лонгъюган", 65.3, 70.93, 0],
["Ныда", 66.625, 72.93, 0],
["Нори", 66.15, 72.37, 0],
["Кутопьюган", 65.97, 70.72, 0],
["Тазовский", 67.4639, 78.7022, 0],
["Газ-Сале", 67.367, 78.969, 0],
["Самбург", 66.985, 78.221, 0],
["Антипаюта", 69.098, 76.855, 0],
["Гыда", 70.893, 78.472, 0],
["Тарко-Сале", 64.915, 77.78, 0],
["Пуровск", 64.983, 77.59, 0],
["Сывдарма", 65.243, 77.26, 0],
["Пурпе", 64.48, 76.68, 0],
["Губкинский", 64.434, 76.502, 0],
["Ханымей", 63.722, 75.95, 0],
["Харампур", 64.31, 78.1, 0],
["Халясавэй", 63.39, 78.38, 0],
["Муравленко", 63.792, 74.523, 0],
["Ноябрьск", 63.2, 75.45, 0],
["Вынгапуровский", 63.168, 76.968, 0],
["Красноселькуп", 65.702, 82.463, 0],
["Толька", 63.998, 82.06, 0],
["Салехард", 66.53, 66.6, 0],
["Лабытнанги", 66.657, 66.418, 0],
["Харп", 66.814, 65.808, 0],
["Обской", 66.69, 66.22, 0],
["Аксарка", 66.56, 67.798, 0],
["Белоярск (Приуральский)", 66.872, 68.136, 0],
["Катравож", 66.333, 66.085, 0],
["Яр-Сале", 66.863, 70.84, 0],
["Панаевск", 66.757, 70.116, 0],
["Салемал", 66.746, 68.938, 0],
["Мыс Каменный", 68.463, 73.593, 0],
["Сеяха", 70.165, 72.515, 0],
["Мужи", 65.398, 64.698, 0],
["Горки (Шурышкарский)", 65.076, 65.291, 0],
["Овгорт", 64.867, 63.367, 0],
["Сургут", 61.25, 73.4, 1],
["Белый Яр (Сургутский)", 61.267, 73.238, 1],
["Солнечный (Сургутский)", 61.298, 73.175, 1],
["Барсово", 61.278, 73.153, 1],
["Фёдоровский", 61.608, 73.719, 1],
["Лянтор", 61.619, 72.155, 1],
["Нижнесортымский", 62.438, 71.76, 1],
["Нижневартовск", 60.93, 76.55, 1],
["Излучинск", 60.963, 76.929, 1],
["Мегион", 61.034, 76.11, 1],
["Лангепас", 61.254, 75.182, 1],
["Покачи", 61.75, 75.59, 1],
["Радужный (ХМАО)", 62.133, 77.475, 1],
["Новоаганск", 61.946, 76.663, 1],
["Когалым", 62.264, 74.482, 1],
["Нефтеюганск", 61.099, 72.603, 1],
["Пойковский", 61.233, 71.883, 1],
["Пыть-Ях", 60.75, 72.858, 1],
["Салым", 60.062, 71.478, 1],
["Ханты-Мансийск", 61, 69.02, 1],
["Горноправдинск", 60.056, 69.908, 1],
["Нягань", 62.14, 65.393, 1],
["Приобье", 62.533, 65.617, 1],
["Октябрьское (ХМАО)", 62.454, 66.05, 1],
["Белоярский (ХМАО)", 63.711, 66.672, 1],
["Берёзово", 63.938, 65.042, 1],
["Игрим", 63.19, 64.417, 1],
["Советский (ХМАО)", 61.361, 63.564, 1],
["Югорск", 61.312, 63.332, 1],
["Урай", 60.13, 64.789, 1],
["Междуреченский", 59.6, 65.91, 1],
["Тюмень", 57.153, 65.5343, 2],
["Боровский", 57.037, 65.713, 2],
["Винзили", 56.953, 65.792, 2],
["Ялуторовск", 56.653, 66.3, 2],
["Заводоуковск", 56.504, 66.551, 2],
["Тобольск", 58.198, 68.254, 2],
["Вагай", 57.937, 69.022, 2],
["Уват", 59.141, 68.895, 2],
["Туртас", 58.943, 69.142, 2],
["Ишим", 56.112, 69.49, 2],
["Екатеринбург", 56.8389, 60.6057, 3],
["Верхняя Пышма", 56.971, 60.583, 3],
["Берёзовский (Свердл.)", 56.908, 60.804, 3],
["Среднеуральск", 56.99, 60.467, 3],
["Заречный (Белоярское вдхр.)", 56.814, 61.326, 3],
["Рефтинский", 57.092, 61.673, 3],
["Первоуральск", 56.905, 59.943, 3],
["Ревда", 56.801, 59.91, 3],
["Сысерть", 56.5, 60.816, 3],
["Полевской", 56.442, 60.189, 3],
["Каменск-Уральский", 56.415, 61.918, 3],
["Нижний Тагил", 57.919, 59.965, 3],
["Серов", 59.603, 60.578, 3],
["Сосьва", 59.176, 61.854, 3],
["Гари", 59.43, 62.35, 3],
["Тавда", 58.042, 65.272, 3],
["Челябинск", 55.1644, 61.4368, 4],
["Копейск", 55.116, 61.617, 4],
["Миасс", 55.045, 60.108, 4],
["Чебаркуль", 54.978, 60.37, 4],
["Златоуст", 55.171, 59.65, 4],
["Кыштым", 55.706, 60.552, 4],
["Касли", 55.889, 60.758, 4],
["Южноуральск", 54.442, 61.253, 4],
["Магнитогорск", 53.407, 58.979, 4],
["Курган", 55.441, 65.341, 5],
["Шадринск", 56.085, 63.633, 5],
["Омск", 54.9885, 73.3242, 6],
["Тара", 56.894, 74.371, 6],
["Калачинск", 55.052, 74.575, 6],
["Черлак", 54.155, 74.805, 6],
["Новосибирск", 55.0084, 82.9357, 7],
["Бердск", 54.758, 83.107, 7],
["Искитим", 54.64, 83.305, 7],
["Ордынское", 54.372, 81.901, 7],
["Сузун", 53.782, 82.313, 7],
["Колывань", 55.306, 82.739, 7],
["Барабинск", 55.35, 78.35, 7],
["Чаны", 55.313, 76.764, 7],
["Томск", 56.4846, 84.9476, 8],
["Северск", 56.6, 84.883, 8],
["Колпашево", 58.316, 82.909, 8],
["Парабель", 58.698, 81.482, 8],
["Каргасок", 59.058, 80.864, 8],
["Стрежевой", 60.733, 77.589, 8],
["Кемерово", 55.355, 86.087, 9],
["Новокузнецк", 53.757, 87.136, 9],
["Юрга", 55.723, 84.886, 9],
["Междуреченск", 53.694, 88.06, 9],
["Барнаул", 53.3474, 83.7784, 10],
["Новоалтайск", 53.391, 83.936, 10],
["Бийск", 52.539, 85.207, 10],
["Камень-на-Оби", 53.788, 81.348, 10],
["Рубцовск", 51.501, 81.207, 10],
["Горно-Алтайск", 51.958, 85.96, 11],
["Артыбаш (Телецкое оз.)", 51.794, 87.262, 11],
["Москва", 55.7558, 37.6173, 12],
["Зеленоград", 55.9825, 37.1814, 12],
["Химки", 55.897, 37.429, 13],
["Долгопрудный", 55.938, 37.514, 13],
["Мытищи", 55.9116, 37.7308, 13],
["Королёв", 55.922, 37.825, 13],
["Пушкино", 56.01, 37.847, 13],
["Щёлково", 55.923, 37.998, 13],
["Балашиха", 55.796, 37.938, 13],
["Люберцы", 55.678, 37.893, 13],
["Жуковский", 55.595, 38.12, 13],
["Раменское", 55.567, 38.23, 13],
["Бронницы", 55.425, 38.264, 13],
["Воскресенск", 55.317, 38.683, 13],
["Коломна", 55.0794, 38.7783, 13],
["Луховицы", 54.965, 39.026, 13],
["Кашира", 54.836, 38.151, 13],
["Ступино", 54.889, 38.078, 13],
["Серпухов", 54.9158, 37.4111, 13],
["Чехов", 55.148, 37.477, 13],
["Подольск", 55.4242, 37.5547, 13],
["Домодедово", 55.436, 37.766, 13],
["Одинцово", 55.679, 37.263, 13],
["Звенигород", 55.73, 36.854, 13],
["Красногорск", 55.82, 37.33, 13],
["Истра", 55.914, 36.86, 13],
["Солнечногорск", 56.185, 36.976, 13],
["Клин", 56.333, 36.733, 13],
["Дмитров", 56.344, 37.52, 13],
["Дубна", 56.736, 37.162, 13],
["Сергиев Посад", 56.31, 38.136, 13],
["Орехово-Зуево", 55.806, 38.961, 13],
["Шатура", 55.576, 39.542, 13],
["Егорьевск", 55.383, 39.033, 13],
["Руза", 55.698, 36.195, 13],
["Можайск", 55.502, 36.03, 13],
["Волоколамск", 56.036, 35.958, 13],
["Наро-Фоминск", 55.387, 36.733, 13],
["Тверь", 56.8587, 35.9176, 14],
["Конаково", 56.7, 36.768, 14],
["Завидово", 56.526, 36.525, 14],
["Кимры", 56.873, 37.356, 14],
["Калязин", 57.243, 37.854, 14],
["Весьегонск", 58.663, 37.26, 14],
["Осташков (Селигер)", 57.147, 33.107, 14],
["Ржев", 56.262, 34.327, 14],
["Вышний Волочёк", 57.585, 34.56, 14],
["Удомля", 57.878, 35.006, 14],
["Ярославль", 57.6261, 39.8845, 15],
["Рыбинск", 58.048, 38.858, 15],
["Брейтово", 58.303, 37.868, 15],
["Углич", 57.528, 38.318, 15],
["Мышкин", 57.786, 38.455, 15],
["Ростов Великий", 57.185, 39.414, 15],
["Переславль-Залесский", 56.736, 38.854, 15],
["Кострома", 57.7679, 40.9269, 16],
["Волгореченск", 57.441, 41.158, 16],
["Иваново", 57.0004, 40.9739, 17],
["Кинешма", 57.443, 42.149, 17],
["Юрьевец", 57.32, 43.109, 17],
["Плёс", 57.458, 41.514, 17],
["Владимир", 56.129, 40.4066, 18],
["Муром", 55.579, 42.052, 18],
["Ковров", 56.357, 41.319, 18],
["Рязань", 54.6292, 39.7368, 19],
["Спас-Клепики", 55.134, 40.175, 19],
["Касимов", 54.941, 41.396, 19],
["Шилово", 54.324, 40.875, 19],
["Тула", 54.1931, 37.6173, 20],
["Алексин", 54.502, 37.068, 20],
["Калуга", 54.5138, 36.2612, 21],
["Обнинск", 55.096, 36.61, 21],
["Таруса", 54.729, 37.177, 21],
["Нижний Новгород", 56.3269, 44.0059, 22],
["Бор", 56.358, 44.062, 22],
["Кстово", 56.151, 44.195, 22],
["Городец", 56.643, 43.472, 22],
["Заволжье", 56.641, 43.393, 22],
["Чкаловск", 56.768, 43.242, 22],
["Лысково", 56.012, 45.025, 22],
["Васильсурск", 56.129, 46.007, 22],
["Павлово", 55.962, 43.09, 22],
["Выкса", 55.319, 42.173, 22],
["Чебоксары", 56.1439, 47.2489, 23],
["Новочебоксарск", 56.11, 47.479, 23],
["Козловка", 55.842, 48.248, 23],
["Йошкар-Ола", 56.6344, 47.8999, 24],
["Волжск", 55.866, 48.358, 24],
["Козьмодемьянск", 56.341, 46.564, 24],
["Казань", 55.7961, 49.1064, 25],
["Зеленодольск", 55.845, 48.518, 25],
["Васильево", 55.838, 48.665, 25],
["Лаишево", 55.405, 49.55, 25],
["Камское Устье", 55.202, 49.272, 25],
["Тетюши", 54.938, 48.838, 25],
["Болгар", 54.96, 49.043, 25],
["Чистополь", 55.363, 50.642, 25],
["Мамадыш", 55.716, 51.409, 25],
["Елабуга", 55.758, 52.046, 25],
["Набережные Челны", 55.7436, 52.3958, 25],
["Нижнекамск", 55.6366, 51.8245, 25],
["Мензелинск", 55.726, 53.102, 25],
["Ульяновск", 54.3142, 48.4031, 26],
["Димитровград", 54.214, 49.618, 26],
["Сенгилей", 53.966, 48.798, 26],
["Старая Майна", 54.609, 48.928, 26],
["Самара", 53.1959, 50.1002, 27],
["Тольятти", 53.5078, 49.4204, 27],
["Жигулёвск", 53.402, 49.495, 27],
["Сызрань", 53.155, 48.474, 27],
["Новокуйбышевск", 53.099, 49.948, 27],
["Пенза", 53.1959, 45.0183, 28],
["Саранск", 54.1874, 45.1839, 29],
["Саратов", 51.5336, 46.0343, 30],
["Энгельс", 51.4989, 46.125, 30],
["Маркс", 51.709, 46.749, 30],
["Вольск", 52.043, 47.379, 30],
["Балаково", 52.039, 47.784, 30],
["Хвалынск", 52.492, 48.106, 30],
["Волгоград", 48.708, 44.5133, 31],
["Волжский", 48.785, 44.775, 31],
["Камышин", 50.088, 45.405, 31],
["Калач-на-Дону", 48.685, 43.526, 31],
["Ахтубинск", 48.281, 46.174, 32],
["Харабали", 47.412, 47.256, 32],
["Селитренное", 47.167, 47.45, 32],
["Енотаевка", 47.246, 47.028, 32],
["Нариманов", 46.689, 47.85, 32],
["Астрахань", 46.3497, 48.0408, 32],
["Камызяк", 46.11, 48.077, 32],
["Кировский (Астрахань)", 45.845, 48.136, 32],
["Икряное", 46.093, 47.734, 32],
["Мумра", 45.772, 47.656, 32],
["Володарский", 46.402, 48.541, 32],
["Лиман (Астраханская)", 45.785, 47.224, 32],
["Лагань", 45.391, 47.362, 33],
["Элиста", 46.3078, 44.2558, 33],
["Махачкала", 42.9849, 47.5047, 34],
["Каспийск", 42.885, 47.638, 34],
["Дербент", 42.0678, 48.2899, 34],
["Кизляр", 43.847, 46.714, 34],
["Киров", 58.6035, 49.668, 35],
["Кирово-Чепецк", 58.552, 50.043, 35],
["Вятские Поляны", 56.221, 51.068, 35],
["Ижевск", 56.8527, 53.2115, 36],
["Воткинск", 57.051, 53.987, 36],
["Сарапул", 56.467, 53.798, 36],
["Камбарка", 56.266, 54.205, 36],
["Пермь", 58.0105, 56.2502, 37],
["Краснокамск", 58.08, 55.755, 37],
["Добрянка", 58.459, 56.416, 37],
["Чусовой", 58.296, 57.816, 37],
["Кунгур", 57.428, 56.945, 37],
["Оса", 57.283, 55.458, 37],
["Чайковский", 56.768, 54.115, 37],
["Березники", 59.409, 56.804, 37],
["Соликамск", 59.645, 56.77, 37],
["Уфа", 54.7388, 55.9721, 38],
["Бирск", 55.418, 55.536, 38],
["Павловка (Павловское вдхр.)", 55.421, 56.551, 38],
["Нефтекамск", 56.088, 54.248, 38],
["Агидель", 55.899, 53.937, 38],
["Стерлитамак", 53.63, 55.931, 38],
["Салават", 53.361, 55.925, 38],
["Белорецк", 53.966, 58.4, 38],
["Оренбург", 51.7682, 55.097, 39],
["Орск", 51.229, 58.475, 39],
["Энергетик (Ириклинское вдхр.)", 51.745, 58.793, 39],
["Бузулук", 52.788, 52.262, 39],
["Санкт-Петербург", 59.9343, 30.3351, 40],
["Кронштадт", 59.991, 29.766, 40],
["Сестрорецк", 60.099, 29.962, 40],
["Зеленогорск (СПб)", 60.197, 29.702, 40],
["Выборг", 60.709, 28.749, 41],
["Приморск (ЛО)", 60.366, 28.609, 41],
["Приозерск", 61.039, 30.129, 41],
["Лосево (Вуокса)", 60.681, 30.004, 41],
["Шлиссельбург", 59.946, 31.033, 41],
["Новая Ладога", 60.103, 32.302, 41],
["Волхов", 59.925, 32.338, 41],
["Сясьстрой", 60.136, 32.569, 41],
["Лодейное Поле", 60.733, 33.553, 41],
["Подпорожье", 60.911, 34.17, 41],
["Сосновый Бор", 59.904, 29.086, 41],
["Кингисепп", 59.373, 28.613, 41],
["Усть-Луга", 59.66, 28.295, 41],
["Ивангород", 59.371, 28.216, 41],
["Луга", 58.737, 29.845, 41],
["Гатчина", 59.566, 30.128, 41],
["Тихвин", 59.644, 33.542, 41],
["Кириши", 59.449, 32.018, 41],
["Великий Новгород", 58.5228, 31.2699, 42],
["Старая Русса", 57.989, 31.356, 42],
["Валдай", 57.974, 33.252, 42],
["Боровичи", 58.388, 33.915, 42],
["Псков", 57.8194, 28.3318, 43],
["Гдов (Чудское оз.)", 58.742, 27.815, 43],
["Великие Луки", 56.34, 30.525, 43],
["Калининград", 54.7104, 20.4522, 44],
["Зеленоградск", 54.96, 20.476, 44],
["Светлогорск", 54.943, 20.155, 44],
["Балтийск", 54.644, 19.892, 44],
["Светлый", 54.676, 20.134, 44],
["Полесск", 54.863, 21.099, 44],
["Советск (Калининградская)", 55.083, 21.886, 44],
["Петрозаводск", 61.785, 34.3469, 45],
["Кондопога", 62.203, 34.265, 45],
["Медвежьегорск", 62.912, 34.456, 45],
["Сегежа", 63.743, 34.316, 45],
["Беломорск", 64.525, 34.765, 45],
["Кемь", 64.956, 34.579, 45],
["Лоухи", 66.075, 33.045, 45],
["Пяозерский", 65.764, 31.082, 45],
["Калевала", 65.199, 31.186, 45],
["Костомукша", 64.588, 30.6, 45],
["Сортавала", 61.703, 30.691, 45],
["Лахденпохья", 61.519, 30.199, 45],
["Питкяранта", 61.572, 31.478, 45],
["Олонец", 60.985, 32.971, 45],
["Пудож", 61.806, 36.535, 45],
["Мурманск", 68.9707, 33.075, 46],
["Кола", 68.881, 33.018, 46],
["Мурмаши", 68.816, 32.812, 46],
["Териберка", 69.164, 35.143, 46],
["Североморск", 69.069, 33.416, 46],
["Мончегорск", 67.938, 32.915, 46],
["Апатиты", 67.568, 33.402, 46],
["Кандалакша", 67.151, 32.412, 46],
["Умба", 66.687, 34.343, 46],
["Варзуга", 66.398, 36.588, 46],
["Ловозеро", 68.006, 35.016, 46],
["Архангельск", 64.5399, 40.5158, 47],
["Северодвинск", 64.5635, 39.8302, 47],
["Новодвинск", 64.416, 40.812, 47],
["Онега", 63.906, 38.097, 47],
["Котлас", 61.252, 46.654, 47],
["Вельск", 61.066, 42.102, 47],
["Мезень", 65.852, 44.24, 47],
["Нарьян-Мар", 67.638, 53.006, 48],
["Искателей", 67.679, 53.133, 48],
["Сыктывкар", 61.6688, 50.8364, 49],
["Ухта", 63.567, 53.683, 49],
["Печора", 65.147, 57.228, 49],
["Усинск", 65.994, 57.556, 49],
["Усть-Цильма", 65.441, 52.15, 49],
["Воркута", 67.498, 64.052, 49],
["Ростов-на-Дону", 47.2225, 39.7187, 50],
["Азов", 47.112, 39.423, 50],
["Таганрог", 47.2096, 38.9352, 50],
["Новочеркасск", 47.418, 40.093, 50],
["Семикаракорск", 47.516, 40.806, 50],
["Волгодонск", 47.514, 42.153, 50],
["Цимлянск", 47.644, 42.102, 50],
["Весёлый (Маныч)", 47.086, 40.742, 50],
["Каменск-Шахтинский", 48.318, 40.26, 50],
["Вёшенская", 49.629, 41.726, 50],
["Краснодар", 45.0355, 38.9753, 51],
["Славянск-на-Кубани", 45.257, 38.125, 51],
["Темрюк", 45.271, 37.382, 51],
["Приморско-Ахтарск", 46.046, 38.175, 51],
["Ейск", 46.711, 38.273, 51],
["Тимашевск", 45.617, 38.946, 51],
["Анапа", 44.895, 37.316, 51],
["Новороссийск", 44.7239, 37.7689, 51],
["Геленджик", 44.561, 38.077, 51],
["Туапсе", 44.098, 39.074, 51],
["Сочи", 43.5855, 39.7231, 51],
["Адлер", 43.429, 39.923, 51],
["Майкоп", 44.6098, 40.1006, 52],
["Севастополь", 44.6166, 33.5254, 53],
["Балаклава", 44.501, 33.599, 53],
["Симферополь", 44.9521, 34.1024, 54],
["Ялта", 44.4952, 34.1663, 54],
["Алушта", 44.676, 34.41, 54],
["Судак", 44.851, 34.972, 54],
["Феодосия", 45.0319, 35.3824, 54],
["Керчь", 45.356, 36.467, 54],
["Евпатория", 45.1904, 33.3669, 54],
["Черноморское", 45.504, 32.702, 54],
["Ставрополь", 45.0428, 41.9734, 55],
["Пятигорск", 44.0486, 43.0594, 55],
["Воронеж", 51.6608, 39.2003, 56],
["Нововоронеж", 51.315, 39.218, 56],
["Лиски", 50.985, 39.508, 56],
["Павловск (Воронежская)", 50.457, 40.108, 56],
["Липецк", 52.6088, 39.5992, 57],
["Елец", 52.624, 38.502, 57],
["Тамбов", 52.7212, 41.4523, 58],
["Белгород", 50.595, 36.587, 59],
["Старый Оскол", 51.296, 37.841, 59],
["Курск", 51.7304, 36.1926, 60],
["Курчатов", 51.66, 35.656, 60],
["Орёл", 52.9668, 36.0625, 61],
["Брянск", 53.2435, 34.3634, 62],
["Смоленск", 54.7826, 32.0453, 63],
["Десногорск", 54.152, 33.285, 63],
["Красноярск", 56.0153, 92.8932, 64],
["Дивногорск", 55.959, 92.373, 64],
["Железногорск (Красноярский)", 56.251, 93.532, 64],
["Канск", 56.201, 95.706, 64],
["Ачинск", 56.269, 90.495, 64],
["Лесосибирск", 58.235, 92.482, 64],
["Енисейск", 58.449, 92.17, 64],
["Туруханск", 65.795, 87.962, 64],
["Игарка", 67.466, 86.583, 64],
["Дудинка", 69.405, 86.177, 64],
["Норильск", 69.3535, 88.2027, 64],
["Минусинск", 53.706, 91.688, 64],
["Абакан", 53.7211, 91.4424, 65],
["Саяногорск", 53.088, 91.4, 65],
["Шира", 54.491, 89.953, 65],
["Кызыл", 51.7197, 94.4378, 66],
["Иркутск", 52.2864, 104.305, 67],
["Ангарск", 52.544, 103.888, 67],
["Шелехов", 52.208, 104.095, 67],
["Листвянка", 51.852, 104.868, 67],
["Слюдянка", 51.659, 103.706, 67],
["Байкальск", 51.518, 104.142, 67],
["Хужир (Ольхон)", 53.194, 107.339, 67],
["Братск", 56.151, 101.634, 67],
["Усть-Илимск", 58, 102.662, 67],
["Усть-Кут", 56.794, 105.767, 67],
["Улан-Удэ", 51.8335, 107.5841, 68],
["Гусиноозёрск", 51.285, 106.526, 68],
["Кабанск", 52.049, 106.652, 68],
["Усть-Баргузин", 53.411, 109.026, 68],
["Северобайкальск", 55.637, 109.323, 68],
["Чита", 52.033, 113.501, 69],
["Якутск", 62.0355, 129.6755, 70],
["Покровск (Якутия)", 61.478, 129.141, 70],
["Ленск", 60.725, 114.928, 70],
["Мирный (Якутия)", 62.535, 113.961, 70],
["Вилюйск", 63.755, 121.624, 70],
["Алдан", 58.603, 125.389, 70],
["Нерюнгри", 56.658, 124.725, 70],
["Тикси", 71.637, 128.868, 70],
["Благовещенск", 50.2907, 127.5272, 71],
["Свободный", 51.375, 128.134, 71],
["Зея", 53.749, 127.262, 71],
["Тында", 55.155, 124.725, 71],
["Биробиджан", 48.794, 132.921, 72],
["Хабаровск", 48.4802, 135.0719, 73],
["Амурск", 50.226, 136.899, 73],
["Комсомольск-на-Амуре", 50.5496, 137.0067, 73],
["Николаевск-на-Амуре", 53.145, 140.722, 73],
["Советская Гавань", 48.969, 140.289, 73],
["Ванино", 49.092, 140.264, 73],
["Владивосток", 43.1155, 131.8855, 74],
["Артём", 43.355, 132.186, 74],
["Уссурийск", 43.797, 131.952, 74],
["Находка", 42.8138, 132.8735, 74],
["Большой Камень", 43.112, 132.348, 74],
["Спасск-Дальний", 44.6, 132.818, 74],
["Камень-Рыболов (Ханка)", 44.747, 132.043, 74],
["Славянка", 42.863, 131.385, 74],
["Южно-Сахалинск", 46.9591, 142.738, 75],
["Корсаков", 46.634, 142.776, 75],
["Анива", 46.715, 142.528, 75],
["Холмск", 47.046, 142.046, 75],
["Поронайск", 49.222, 143.102, 75],
["Ноглики", 51.805, 143.138, 75],
["Оха", 53.589, 142.949, 75],
["Петропавловск-Камчатский", 53.0452, 158.6508, 76],
["Елизово", 53.187, 158.383, 76],
["Усть-Большерецк", 52.825, 156.252, 76],
["Усть-Камчатск", 56.228, 162.476, 76],
["Магадан", 59.5612, 150.8301, 77],
["Анадырь", 64.733, 177.515, 78],
["Уренгойское (озеро Негито)", 65.41, 77.12, 0],
["Новый Порт", 67.69, 72.9, 0],
["Горки (ЯНАО)", 65.06, 65.28, 0],
["Заполярный (ЯНАО)", 66.402, 73.84, 0],
["Берёзово (ХМАО)", 63.937, 65.043, 1],
["Междуреченский (Кондинское)", 59.6, 65.91, 1],
["Фёдоровский (ХМАО)", 61.608, 73.718, 1],
["Мишкино (Башкортостан)", 55.461, 55.948, 38],
["Караидель", 55.833, 56.917, 38],
["Павловка (Башкортостан)", 55.418, 56.556, 38],
["Красная Горка (Нуримановский)", 55.197, 56.662, 38],
["Дюртюли", 55.492, 54.866, 38],
["Кушнаренково", 55.102, 55.344, 38],
["Благовещенск (Башкортостан)", 55.035, 55.978, 38],
["Янаул", 56.265, 54.931, 38],
["Бураево", 55.841, 55.408, 38],
["Старобалтачево", 56, 55.9, 38],
["Аскино", 56.089, 56.578, 38],
["Верхние Татышлы", 56.289, 55.858, 38],
["Калтасы", 55.973, 54.855, 38],
["Николо-Берёзовка", 56.128, 54.162, 38],
["Туймазы", 54.6, 53.7, 38],
["Октябрьский (Башкортостан)", 54.481, 53.471, 38],
["Бакалы", 55.179, 53.803, 38],
["Чекмагуш", 55.134, 54.655, 38],
["Чишмы", 54.592, 55.388, 38],
["Давлеканово", 54.219, 55.028, 38],
["Раевский (Альшеево)", 54.066, 54.918, 38],
["Белебей", 54.103, 54.122, 38],
["Иглино", 54.834, 56.417, 38],
["Кармаскалы", 54.371, 56.184, 38],
["Архангельское (Башкортостан)", 54.421, 56.792, 38],
["Красноусольский", 53.892, 56.469, 38],
["Ишимбай", 53.449, 56.046, 38],
["Мелеуз", 52.963, 55.932, 38],
["Кумертау", 52.766, 55.786, 38],
["Мраково", 52.716, 56.625, 38],
["Инзер (Башкортостан)", 54.216, 57.556, 38],
["Учалы", 54.319, 59.383, 38],
["Сибай", 52.716, 58.666, 38],
["Баймак", 52.592, 58.316, 38],
["Аскарово (Банное)", 53.338, 58.514, 38],
["Месягутово", 55.552, 58.252, 38],
["Малояз", 55.181, 58.151, 38],
["Большеустьикинское", 55.956, 58.273, 38],
["Мишкино (Курганская обл.)", 55.338, 63.918, 5],
["Шумиха", 55.228, 63.293, 5],
["Куртамыш", 54.911, 64.432, 5],
["Макушино", 55.211, 67.244, 5],
["Петухово", 55.069, 67.893, 5],
["Частоозерье", 55.568, 67.908, 5],
["Демьянка", 59.546, 69.308, 2],
["Ярково", 57.408, 67.075, 2],
["Нижняя Тавда", 57.673, 66.173, 2],
["Казанское (Тюменская)", 55.639, 69.235, 2],
["Сосьва (Свердловская)", 59.176, 61.855, 3],
["Ивдель", 60.691, 60.421, 3],
["Ильинский (Обва)", 58.569, 55.684, 37],
["Пожва", 59.092, 56.089, 37],
["Чердынь", 60.403, 56.479, 37],
["Красновишерск", 60.403, 57.079, 37],
["Болгар (Спасский затон)", 54.985, 49.056, 25],
["Алексеевское (Кама)", 55.308, 50.115, 25],
["Рыбная Слобода", 55.383, 50.145, 25],
["Актаныш", 55.716, 54.083, 25],
["Звенигово", 55.972, 48.015, 24],
["Юрино (Ветлуга)", 56.292, 46.299, 24],
["Макарьево", 56.082, 45.056, 22],
["Брейтово (Рыбинка)", 58.297, 37.868, 15],
["Борок (Рыбинка)", 58.063, 38.238, 15],
["Весьегонск (Рыбинка)", 58.662, 37.262, 14],
["Пошехонье", 58.502, 39.115, 15],
["Шигоны (Усинский залив)", 53.389, 48.675, 27],
["Ровное", 50.776, 46.052, 30],
["Харабали (Ахтуба)", 47.412, 47.256, 32],
["Черный Яр", 48.062, 46.112, 32],
["Мумра (Главный банк)", 45.772, 47.658, 32],
["Красный Яр (Бузан)", 46.533, 48.348, 32],
["Сириус (Имеретинка)", 43.402, 39.961, 51],
["Хоста", 43.515, 39.869, 51],
["Дагомыс", 43.661, 39.654, 51],
["Лоо", 43.699, 39.589, 51],
["Лазаревское", 43.908, 39.331, 51],
["Джубга", 44.316, 38.705, 51],
["Архипо-Осиповка", 44.366, 38.531, 51],
["Дивноморское", 44.502, 38.135, 51],
["Кабардинка", 44.651, 37.939, 51],
["Большой Утриш", 44.761, 37.389, 51],
["Витязево", 44.988, 37.262, 51],
["Благовещенская (Анапа)", 45.063, 37.115, 51],
["Тамань", 45.218, 36.716, 51],
["Голубицкая", 45.325, 37.272, 51],
["Кучугуры", 45.405, 36.958, 51],
["Садки (Ахтарские лиманы)", 45.925, 38.182, 51],
["Ясенская Переправа", 46.245, 38.285, 51],
["Должанская (Коса Долгая)", 46.633, 37.802, 51],
["Донецк", 48.0159, 37.8028, 79],
["Мариуполь", 47.0971, 37.5434, 79],
["Макеевка", 48.0478, 37.9258, 79],
["Горловка", 48.307, 38.0297, 79],
["Енакиево", 48.2311, 38.2053, 79],
["Старобешево (Старобешевское вдхр.)", 47.7531, 38.0319, 79],
["Зугрэс (Зуевское вдхр.)", 48.0175, 38.2619, 79],
["Седово (Кривая коса, Азовское море)", 47.0769, 38.1561, 79],
["Новоазовск", 47.1147, 38.0825, 79],
["Харцызск", 48.0428, 38.1425, 79],
["Волноваха", 47.5975, 37.4833, 79],
["Дебальцево", 48.3411, 38.4069, 79],
["Луганск", 48.574, 39.3078, 80],
["Алчевск (Исаковское вдхр.)", 48.4689, 38.7978, 80],
["Северодонецк (р. Северский Донец)", 48.9483, 38.4933, 80],
["Лисичанск (р. Северский Донец)", 48.9042, 38.4319, 80],
["Красный Луч", 48.1372, 38.9192, 80],
["Стаханов", 48.5681, 38.6436, 80],
["Краснодон", 48.2992, 39.7397, 80],
["Счастье (Луганская ТЭС / Северский Донец)", 48.7386, 39.2314, 80],
["Станица Луганская", 48.6706, 39.4689, 80],
["Старобельск (р. Айдар)", 49.2769, 38.9242, 80],
["Сватово (р. Красная)", 49.4092, 38.1619, 80],
["Мелитополь", 46.8489, 35.3653, 81],
["Бердянск (Бердянский залив)", 46.7597, 36.7989, 81],
["Энергодар (Днепровский плёс)", 47.4989, 34.6558, 81],
["Приморск (Азовское море)", 46.7347, 36.3442, 81],
["Кирилловка (Молочный и Утлюкский лиманы)", 46.3736, 35.3675, 81],
["Васильевка", 47.4419, 35.2764, 81],
["Днепрорудное", 47.3819, 34.9869, 81],
["Каменка-Днепровская", 47.4872, 34.4058, 81],
["Токмак", 47.2514, 35.7058, 81],
["Пологи", 47.4844, 36.2536, 81],
["Геническ (Арабатская стрелка / Сиваш)", 46.1769, 34.8058, 82],
["Скадовск (Джарылгачский залив)", 46.1189, 32.9106, 82],
["Новая Каховка (низовья Днепра)", 46.7511, 33.3606, 82],
["Каховка", 46.8136, 33.4869, 82],
["Голая Пристань (дельта Днепра)", 46.5242, 32.5203, 82],
["Алёшки (р. Конка / Днепр)", 46.6203, 32.7186, 82],
["Железный Порт (Чёрное море)", 46.1233, 32.2914, 82],
["Лазурное (Устричное оз. / Чёрное море)", 46.0842, 32.5294, 82],
["Чаплынка", 46.3639, 33.5403, 82],
["Вологда", 59.2205, 39.8915, 83],
["Череповец (Рыбинское вдхр.)", 59.1323, 37.9092, 83],
["Белозерск (Белое озеро)", 60.0325, 37.7872, 83],
["Липин Бор (Белое озеро)", 60.2608, 37.9772, 83],
["Кириллов (Сиверское оз. / Шексна)", 59.8606, 38.3792, 83],
["Вытегра (Онежское озеро)", 61.0064, 36.4481, 83],
["Шексна (Шекснинское вдхр.)", 59.2106, 38.5081, 83],
["Великий Устюг (р. Сухона / Юг)", 60.7619, 46.3039, 83],
["Тотьма (р. Сухона)", 59.9756, 42.7589, 83],
["Сокол (р. Сухона)", 59.4622, 40.1189, 83],
["Вожега (оз. Воже)", 60.4728, 40.2189, 83],
["Устюжна (р. Молога)", 58.8422, 36.4289, 83],
["Кубенское (оз. Кубенское)", 59.4425, 39.6789, 83],
["Грозный (Грозненское море / р. Сунжа)", 43.3184, 45.6986, 84],
["Гудермес (р. Сунжа / Белка)", 43.3508, 46.1036, 84],
["Шелковская (р. Терек / оз. Каргалинское)", 43.5089, 46.3389, 84],
["Наурская (р. Терек)", 43.6522, 45.3117, 84],
["Кезеной-Ам (высокогорное форелевое озеро)", 42.7758, 46.1519, 84],
["Шали", 43.1481, 45.9019, 84],
["Аргун", 43.2922, 45.8722, 84],
["Магас", 43.1686, 44.8131, 85],
["Назрань (р. Сунжа)", 43.2256, 44.7628, 85],
["Сунжа (р. Сунжа / Асса)", 43.3156, 45.0472, 85],
["Карабулак", 43.3053, 44.9094, 85],
["Малгобек", 43.5094, 44.5881, 85],
["Нальчик (р. Нальчик / Черек)", 43.4853, 43.6071, 86],
["Прохладный (р. Малка / Терек)", 43.7575, 44.0297, 86],
["Майский (р. Терек / Черек)", 43.6317, 44.0589, 86],
["Баксан (р. Баксан)", 43.6819, 43.5358, 86],
["Голубые озёра (Аушигер / Черек)", 43.2319, 43.6214, 86],
["Черкесск (Кубанское вдхр. / р. Кубань)", 44.2269, 42.0467, 87],
["Усть-Джегута (Усть-Джегутинское вдхр.)", 44.0858, 41.9733, 87],
["Карачаевск (р. Кубань / Теберда)", 43.7731, 41.9142, 87],
["Зеленчукская (р. Большой Зеленчук)", 43.8586, 41.5906, 87],
["Теберда (форелевые реки)", 43.4472, 41.7433, 87],
["Владикавказ (р. Терек)", 43.0246, 44.6818, 88],
["Моздок (р. Терек)", 43.7481, 44.6561, 88],
["Алагир (р. Ардон)", 43.0417, 44.2197, 88],
["Ардон (р. Ардон / Терек)", 43.1753, 44.2969, 88],
["Беслан", 43.1889, 44.5369, 88],
["Адыгейск (Краснодарское вдхр.)", 44.8825, 39.1906, 52],
["Яблоновский (р. Кубань)", 44.9897, 38.9433, 52],
["Каменномостский / Хаджох (р. Белая)", 44.2989, 40.1844, 52],
["Красногвардейское (Тщикское вдхр.)", 45.1278, 39.5719, 52],
["Невинномысск (р. Кубань)", 44.6339, 41.9428, 55],
["Солнечнодольск (Новотроицкое вдхр.)", 45.3136, 41.5036, 55],
["Будённовск (оз. Буйвола / р. Кума)", 44.7847, 44.1658, 55],
["Дивное (оз. Маныч-Гудило)", 45.9089, 43.3569, 55],
["Ессентуки", 44.0444, 42.8606, 55],
["Кисловодск", 43.9056, 42.7169, 55],
["Минеральные Воды", 44.2103, 43.1353, 55],
["Георгиевск", 44.1497, 43.4706, 55],
["Изобильный", 45.3694, 41.7119, 55],
["Сулак (устье р. Сулак / Каспий)", 43.2689, 47.5419, 34],
["Дубки (Чиркейское вдхр.)", 43.0211, 46.8358, 34],
["Избербаш (Каспийское море)", 42.5694, 47.8644, 34],
["Крайновка (Терек / Аграханский залив)", 43.7889, 47.4106, 34],
["Цаган Аман (р. Волга)", 47.5639, 46.7219, 33],
["Городовиковск", 46.0878, 41.9336, 33],
["Заречный (Пензенская)", 53.2028, 45.1669, 28],
["Кузнецк (р. Сура / Труёв)", 53.1169, 46.6006, 28],
["Сердобск (р. Сердоба)", 52.4581, 44.2169, 28],
["Никольск (Пензенская)", 53.7189, 46.0719, 28],
["Сурское (Сурское вдхр.)", 53.0819, 45.2219, 28],
["Нижний Ломов (р. Ломовка / Мокша)", 53.5306, 43.6769, 28],
["Рузаевка", 54.0628, 44.9506, 29],
["Краснослободск (р. Мокша)", 54.4289, 43.7758, 29],
["Темников (р. Мокша)", 54.6319, 43.2089, 29],
["Ковылкино (р. Мокша)", 54.0389, 43.9189, 29],
["Ардатов (р. Алатырь)", 54.8489, 46.2358, 29],
["Мичуринск (р. Лесной Воронеж)", 52.8978, 40.4908, 58],
["Моршанск (р. Цна)", 53.4442, 41.8106, 58],
["Котовск (Котовское вдхр. / р. Цна)", 52.5878, 41.5036, 58],
["Рассказово", 52.6719, 41.8869, 58],
["Уварово (р. Ворона)", 51.9839, 42.2639, 58],
["Ливны (р. Сосна)", 52.4256, 37.6069, 61],
["Мценск (р. Зуша)", 53.2789, 36.5728, 61],
["Болхов (р. Нугрь / Ока)", 53.4439, 36.0044, 61],
["Клинцы (р. Туросна)", 52.7528, 32.2369, 62],
["Новозыбков", 52.5369, 31.9339, 62],
["Трубчевск (р. Десна)", 52.5839, 33.7689, 62],
["Дятьково", 53.6028, 34.3339, 62],
["Жуковка (р. Десна)", 53.5339, 33.7306, 62],
["Железногорск (Курская / Копенское вдхр.)", 52.3392, 35.3569, 60],
["Рыльск (р. Сейм)", 51.5689, 34.6819, 60],
["Льгов (р. Сейм)", 51.6719, 35.2639, 60],
["Губкин", 51.2858, 37.5358, 59],
["Шебекино (р. Северский Донец)", 50.4078, 36.8858, 59],
["Валуйки (р. Оскол)", 50.2119, 38.1069, 59],
["Новый Оскол (р. Оскол)", 50.7619, 37.8689, 59],
["Грязи (Матырское вдхр. / р. Матыра)", 52.4958, 39.9419, 57],
["Задонск (р. Дон)", 52.3919, 38.9219, 57],
["Данков (р. Дон)", 53.2539, 39.1558, 57],
["Лебедянь (р. Дон)", 53.0189, 39.1339, 57],
["Новомосковск (Шатское и Пронское вдхр.)", 54.0119, 38.2906, 20],
["Суворов (Черепетское вдхр.)", 54.1228, 36.4958, 20],
["Ефремов (р. Красивая Меча)", 53.1469, 38.1169, 20],
["Белёв (р. Ока)", 53.8089, 36.1358, 20],
["Людиново (оз. Ломпадь)", 53.8644, 34.4478, 21],
["Козельск (р. Жиздра)", 54.0369, 35.7819, 21],
["Вязьма (р. Вязьма)", 55.2106, 34.2858, 63],
["Гагарин (Яузское и Вазузское вдхр.)", 55.5528, 35.0089, 63],
["Рославль (р. Остёр)", 53.9528, 32.8639, 63],
["Сычёвка (Вазузское вдхр.)", 55.8269, 34.2758, 63],
["Гороховец (р. Клязьма)", 56.2019, 42.6919, 18],
["Вязники (р. Клязьма)", 56.2428, 42.1558, 18],
["Гусь-Хрустальный (оз. Гусевское)", 55.6194, 40.6558, 18],
["Суздаль (р. Каменка / Нерль)", 56.4194, 40.4489, 18],
["Галич (Галичское озеро)", 58.3819, 42.3489, 16],
["Чухлома (Чухломское озеро)", 58.7539, 42.6858, 16],
["Шарья (р. Ветлуга)", 58.3719, 45.5139, 16],
["Макарьев (р. Унжа / Горьковское вдхр.)", 57.8819, 43.8069, 16],
["Кадый (Нёмда / Горьковское вдхр.)", 57.7819, 43.1889, 16],
["Котельнич (р. Вятка)", 58.3089, 48.3489, 35],
["Советск (Кировская, р. Вятка / Пижма)", 57.5889, 48.9589, 35],
["Уржум (р. Уржумка / Вятка)", 57.1139, 50.0019, 35],
["Белая Холуница (Белохолуницкий пруд)", 58.8419, 50.8519, 35],
["Алатырь (р. Сура / Алатырь)", 54.8419, 46.5789, 23],
["Мариинский Посад (р. Волга)", 56.1158, 47.7169, 23],
["Ядрин (р. Сура)", 55.9419, 46.2058, 23],
["Глазов (р. Чепца)", 58.1389, 52.6589, 36],
["Каракулино (р. Кама)", 56.0119, 53.7089, 36],
["Невель (оз. Невельское / Езерище)", 56.0189, 29.9319, 43],
["Себеж (оз. Себежское / Ороно)", 56.2839, 28.4819, 43],
["Печоры (Псковское озеро)", 57.8139, 27.6119, 43],
["Демянск (оз. Селигер — Полновский плёс)", 57.6439, 32.4658, 42],
["Чудово (р. Волхов)", 59.1244, 31.6719, 42],
["Пестово (р. Молога)", 58.5969, 35.8169, 42],
["Амдерма (Карское море)", 69.7594, 61.6636, 48],
["Индига (Баренцево море)", 67.6889, 48.7789, 48],
["Нижний Одес", 63.6439, 54.8569, 49],
["Инта (р. Большая Инта / Косью)", 66.0319, 60.1658, 49],
["Вуктыл (р. Печора / Щугор)", 63.8569, 57.3089, 49],
["Сосногорск (р. Ижма)", 63.5889, 53.8819, 49],
["Далматово (р. Исеть)", 56.2606, 62.9369, 5],
["Катайск (р. Исеть)", 56.2889, 62.5819, 5],
["Макушино (оз. Башкирское)", 55.2119, 67.2439, 5],
["Петухово (оз. Медвежье / Песчаное)", 55.0689, 67.8939, 5],
["Частоозерье (оз. Мартыново)", 55.5719, 67.9119, 5],
["Тевриз (р. Иртыш)", 57.5119, 72.3989, 6],
["Знаменское (р. Иртыш / Шиш)", 57.1258, 73.8169, 6],
["Большеречье (р. Иртыш)", 56.0919, 74.6269, 6],
["Крутинка (оз. Ик / Салтаим / Тенис)", 56.0058, 71.5089, 6],
["Белово (Беловское вдхр. / Инской)", 54.4169, 86.2989, 9],
["Крапивинский (р. Томь / Тайдон)", 54.9919, 86.8119, 9],
["Мариинск (р. Кия)", 56.2119, 87.7489, 9],
["Таштагол (р. Кондома / Мрассу)", 52.7658, 87.8719, 9],
["Яровое / Славгород (оз. Большое Яровое / Кулундинское)", 52.9319, 78.5839, 10],
["Завьялово (Завьяловские озёра)", 52.8389, 80.5789, 10],
["Змеиногорск (оз. Колыванское)", 51.1589, 82.1958, 10],
["Черногорск", 53.8244, 91.2842, 65],
["Абаза (р. Абакан)", 52.6519, 90.0919, 65],
["Копьёво (оз. Белё / Иткуль)", 54.9858, 89.8058, 65],
["Шагонар (Саяно-Шушенское вдхр. / р. Енисей)", 51.5319, 92.8119, 66],
["Тоора-Хем (р. Большой Енисей / оз. Азас)", 52.4689, 96.1139, 66],
["Чадан (р. Чадан / Хемчик)", 51.2858, 91.5789, 66],
["Туран", 52.1439, 93.9189, 66],
["Арахлей (Ивано-Арахлейские озёра)", 52.2119, 112.9119, 69],
["Краснокаменск", 50.0989, 118.0369, 69],
["Борзя (Торейские озёра / р. Онон)", 50.3889, 116.5289, 69],
["Шيلка / Нерчинск (р. Шилка / Ингода)", 51.8519, 116.0389, 69],
["Хилок (р. Хилок)", 51.3639, 110.4619, 69],
["Петровск-Забайкальский", 51.2758, 108.8419, 69],
["Талакан (Бурейское вдхр.)", 50.2819, 130.2689, 71],
["Белогорск (р. Томь)", 50.9189, 128.4758, 71],
["Шимановск", 52.0019, 127.6689, 71],
["Ленинское (р. Амур)", 47.9369, 132.6189, 72],
["Амурзет (р. Амур)", 47.6969, 131.0958, 72],
["Николаевка (р. Тунгуска / Амур)", 48.5569, 134.7858, 72],
["Ола (Ольский лиман / Охотское море)", 59.5789, 151.2989, 77],
["Палатка (р. Хасын)", 60.1019, 150.9358, 77],
["Синегорье (Колымское вдхр. / р. Колыма)", 62.0889, 150.5319, 77],
["Сусуман (р. Берелёх)", 62.7819, 148.1558, 77],
["Певек (Чаунская губа)", 69.7019, 170.3119, 78],
["Билибино (р. Малый Анюй)", 68.0558, 166.4419, 78],
["Эгвекинот (Залив Креста)", 66.3189, 179.1189, 78],
["Лаврентия", 65.5839, -171.0019, 78],
["Мильково (р. Камчатка)", 54.6969, 158.6219, 76],
["Вилючинск (Авачинская губа)", 52.9319, 158.4058, 76],
["Ключи (р. Камчатка)", 56.3219, 160.8489, 76],
["Оссора / Палана", 59.0919, 159.9519, 76]
].map(r => ({
 name: r[0], lat: r[1], lon: r[2], admin1: _ADM[r[3]]
}));

function getSpotEcoregion(lat, lon, basinCode, waterType = 'small_river', selectedWaterName = '') {
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
 let tail = parts.slice(3).join('_') || '';
 let fisherId = '';
 const fidMatch = tail.match(/(?:^|_)(FP_[A-Z0-9]{6,8})$/i);
 if (fidMatch) {
  fisherId = workerNormalizeFisherId(fidMatch[1], '89');
  tail = tail.slice(0, tail.length - fidMatch[0].length);
 }
 const fishId = tail || 'pike';
 if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
 return { lat, lon, fishId, fisherId };
}

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
 const key = String(userId || 'anon');
 const cur = getUserSession(key);
 const next = { ...cur, ...patch };
 if (key !== 'anon') {
  const devId = `tg_bot_${key}`;
  const regCode = workerResolveRegionCode(next.cityName || '89');
  const unameNorm = String(next.tgUsername || '').trim().toLowerCase().replace(/^@/, '');
  const isOwnerTg = (unameNorm === 'iathor' || unameNorm === 'iathor82' || unameNorm === 'thorantony82');
  let fid = isOwnerTg
   ? OWNER_FISHER_ID
   : (tgToFisherIdMap.get(key) || deviceToFisherIdMap.get(devId));
  if (!fid) {
   fid = allocateNextRegionalFisherId(regCode, devId);
  }
  tgToFisherIdMap.set(key, fid);
  deviceToFisherIdMap.set(devId, fid);
  next.fisherId = fid;
  upsertUserInRegistry({
   fisherId: fid,
   deviceId: devId,
   login: isOwnerTg ? 'iAthor' : undefined,
   callsign: isOwnerTg ? 'iAthor' : (next.tgName || next.tgUsername || `TG #${key}`),
   tgId: key,
   tgUsername: next.tgUsername || '',
   regionCode: regCode,
   locLabel: next.cityName || 'Новый Уренгой',
   platform: 'TG-BOT',
   version: WORKER_VERSION,
   lat: next.lat,
   lon: next.lon
  });
 }
 userSessions.set(key, next);
 return next;
}

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

async function resolveQueryCityAndFish(rawQuery, session = null) {
 const q = normStr(rawQuery)
  .replace(/^\/(klev|top|waters|fish|crew|circle|express|search|profile|help|start)(@\S+)?\s*/i, '')
  .replace(/^(!клев|клев|прогноз|рыбалка)\s+/i, '')
  .trim();

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

 const explicitWaterType = detectWaterTypeFromQuery(q);

 let placeQuery = q;
 if (matchedKeyword) {
  placeQuery = placeQuery.replace(new RegExp(`[а-яa-z0-9_-]*${matchedKeyword}[а-яa-z0-9_-]*`, 'gi'), ' ');
 }

 const matchedWaterObj = findWaterInQuery(placeQuery);

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
 const gridKey = `${Number(lat).toFixed(1)}_${Number(lon).toFixed(1)}`;
 const cachedGrid = weatherGridCache.get(gridKey);
 if (cachedGrid && Date.now() - cachedGrid.ts < 1200000) {
  return cachedGrid.data;
 }
 try {
  const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${Number(lat).toFixed(2)}&lon=${Number(lon).toFixed(2)}`;
  const res = await fetch(url, {
  headers: { 'User-Agent': 'KlevProClubBot/2.1.1 (https://klevpro.ru)' },
  cf: { cacheTtl: 1200, cacheEverything: true }
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

  const resultObj = {
  tAir, waterTemp, press: pMm, wind, iceText,
  day2: { tAir: tAir24, waterTemp: Math.max(0.4, Math.round((waterTemp * 0.8 + (tAir24 * 0.52 + 2.4) * 0.2) * 10) / 10), press: pMm24, wind: wind24 },
  day3: { tAir: tAir48, waterTemp: Math.max(0.4, Math.round((waterTemp * 0.7 + (tAir48 * 0.52 + 2.4) * 0.3) * 10) / 10), press: pMm48, wind: wind48 }
  };
  weatherGridCache.set(gridKey, { ts: Date.now(), data: resultObj });
  return resultObj;
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

function buildUserProfileCard(session, city, fish, webappUrl, isPrivateChat = true) {
 const shortCity = String(city.name || 'Точка').split('(')[0].trim().slice(0, 14);
 const deepAppUrl = `${webappUrl}?tg_lat=${city.lat.toFixed(4)}&tg_lon=${city.lon.toFixed(4)}&tg_city=${encodeURIComponent(city.name)}&tg_fish=${fish.id}#/forecast`;
 const fid = session?.fisherId || tgToFisherIdMap.get(String(session?.userId || '')) || 'FP_89AAA001';
 const regUser = usersRegistryStore.get(fid);
 const loginLabel = regUser?.login ? `\`${regUser.login}\` (🟢 синхронизирован)` : 'не задан (можно задать в Профиле приложения для синхронизации между устройствами)';
 const tgLabel = session?.tgUsername ? `@${session.tgUsername}` : (regUser?.tgUsername ? `@${regUser.tgUsername}` : 'привязан');

 const text =
  `👤 *Ваш единый рыболовный профиль*\n\n` +
  `🆔 *Рыболовный ID:* \`${fid}\`\n` +
  `🔑 *Логин профиля (APK / Сайт / ТГ):* ${loginLabel}\n` +
  `✈️ *Связка с Telegram:* 🟢 Активна (${tgLabel})\n` +
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



// ── Cloudflare D1 SQL Database & Storage Engine (V.2.1.2) ──
function getD1(env) {
 if (!env) return null;
 const candidateNames = ['DB', 'd1', 'D1', 'DATABASE', 'database', 'klev_db', 'KLEV_DB', 'DB_TG', 'tg_db', 'klevpro_db', 'PROD_DB'];
 for (const name of candidateNames) {
  if (env[name] && typeof env[name].prepare === 'function') {
   return { db: env[name], name };
  }
 }
 for (const key of Object.keys(env)) {
  if (env[key] && typeof env[key].prepare === 'function') {
   return { db: env[key], name: key };
  }
 }
 return null;
}

function getKV(env) {
 if (!env) return null;
 const candidateNames = ['KV', 'kv', 'KLEV_KV', 'klev_kv', 'NAMESPACE', 'STORAGE'];
 for (const name of candidateNames) {
  if (env[name] && typeof env[name].get === 'function' && typeof env[name].put === 'function') {
   return env[name];
  }
 }
 for (const key of Object.keys(env)) {
  if (env[key] && typeof env[key].get === 'function' && typeof env[key].put === 'function') {
   return env[key];
  }
 }
 return null;
}

let d1Initialized = false;
let _d1InitPromise = null;
async function ensureD1Tables(d1) {
 if (!d1 || d1Initialized) return;
 if (_d1InitPromise) return _d1InitPromise;
 _d1InitPromise = (async () => {
  try {
   await d1.batch([
    d1.prepare(`CREATE TABLE IF NOT EXISTS users_registry (fisher_id TEXT PRIMARY KEY, device_id TEXT, login TEXT, callsign TEXT, tg_id TEXT, tg_username TEXT, region_code TEXT, loc_label TEXT, platform TEXT, version TEXT, is_owner INTEGER DEFAULT 0, is_admin INTEGER DEFAULT 0, is_temporary INTEGER DEFAULT 0, first_seen INTEGER, last_seen INTEGER, sessions_count INTEGER DEFAULT 1, circle_posts_count INTEGER DEFAULT 0, lat REAL, lon REAL, payload TEXT)`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS auth_profiles (auth_key TEXT PRIMARY KEY, login_norm TEXT, fisher_id TEXT, payload TEXT, updated_at INTEGER)`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS region_counters (region_code TEXT PRIMARY KEY, seq_perm INTEGER DEFAULT 0, seq_reserve INTEGER DEFAULT 0)`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS circle_points (id TEXT PRIMARY KEY, t TEXT, sos INTEGER, fid TEXT, crew_key TEXT, lat REAL, lon REAL, ca INTEGER, ea INTEGER, payload TEXT)`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS transit_relay (id TEXT PRIMARY KEY, channel_id TEXT, sender_id TEXT, cipher_payload TEXT, kind TEXT, crew_key TEXT, peer_id TEXT, ts INTEGER)`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS klev_kv (k TEXT PRIMARY KEY, v TEXT, updated_at INTEGER)`),
    d1.prepare(`CREATE INDEX IF NOT EXISTS idx_users_lastseen ON users_registry(last_seen)`),
    d1.prepare(`CREATE INDEX IF NOT EXISTS idx_relay_ch_ts ON transit_relay(channel_id, ts)`),
    d1.prepare(`CREATE INDEX IF NOT EXISTS idx_circle_ea ON circle_points(ea)`)
   ]);
   d1Initialized = true;
  } catch (e) {
   console.error('[D1 Init Tables Error]', e);
   d1Initialized = true;
  } finally {
   _d1InitPromise = null;
  }
 })();
 return _d1InitPromise;
}

async function d1SaveUser(env, u) {
 const d1Info = getD1(env);
 const d1 = d1Info?.db;
 if (!d1 || !u || !u.fisherId) return;
 try {
  await ensureD1Tables(d1);
  const payloadStr = JSON.stringify(u);
  await d1.prepare(`
   INSERT INTO users_registry (
    fisher_id, device_id, login, callsign, tg_id, tg_username, region_code, loc_label,
    platform, version, is_owner, is_admin, is_temporary, first_seen, last_seen,
    sessions_count, circle_posts_count, lat, lon, payload
   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(fisher_id) DO UPDATE SET
    device_id = CASE WHEN excluded.device_id != '' THEN excluded.device_id ELSE users_registry.device_id END,
    login = CASE WHEN excluded.login != '' THEN excluded.login ELSE users_registry.login END,
    callsign = CASE WHEN excluded.callsign != '' THEN excluded.callsign ELSE users_registry.callsign END,
    tg_id = CASE WHEN excluded.tg_id != '' THEN excluded.tg_id ELSE users_registry.tg_id END,
    tg_username = CASE WHEN excluded.tg_username != '' THEN excluded.tg_username ELSE users_registry.tg_username END,
    region_code = excluded.region_code,
    loc_label = excluded.loc_label,
    platform = excluded.platform,
    version = excluded.version,
    last_seen = excluded.last_seen,
    sessions_count = users_registry.sessions_count + excluded.sessions_count,
    circle_posts_count = users_registry.circle_posts_count + excluded.circle_posts_count,
    lat = excluded.lat,
    lon = excluded.lon,
    payload = excluded.payload
  `).bind(
   u.fisherId, u.deviceId || '', u.login || '', u.callsign || '', u.tgId || '', u.tgUsername || '',
   u.regionCode || '89', u.locLabel || '', u.platform || 'WEB', u.version || WORKER_VERSION,
   u.isOwner ? 1 : 0, u.isAdmin ? 1 : 0, u.isTemporaryReserve ? 1 : 0,
   u.firstSeen || Date.now(), u.lastSeen || Date.now(),
   u.sessionsCount || 1, u.circlePostsCount || 0,
   Number(u.lat || 0), Number(u.lon || 0), payloadStr
  ).run();
 } catch (e) {
  console.error('[d1SaveUser error]', e);
 }
}

async function d1SaveAuthProfile(env, authKey, loginNorm, fisherId, profileObj) {
 const d1Info = getD1(env);
 const d1 = d1Info?.db;
 if (!d1 || !authKey || !profileObj) return;
 try {
  await ensureD1Tables(d1);
  await d1.prepare(`
   INSERT INTO auth_profiles (auth_key, login_norm, fisher_id, payload, updated_at)
   VALUES (?, ?, ?, ?, ?)
   ON CONFLICT(auth_key) DO UPDATE SET login_norm = excluded.login_norm, fisher_id = excluded.fisher_id, payload = excluded.payload, updated_at = excluded.updated_at
  `).bind(
   authKey, loginNorm || '', fisherId || '', JSON.stringify(profileObj), Date.now()
  ).run();
 } catch (e) {
  console.error('[d1SaveAuthProfile error]', e);
 }
}

async function d1SavePoint(env, pt) {
 const d1Info = getD1(env);
 const d1 = d1Info?.db;
 if (!d1 || !pt || !pt.id) return;
 try {
  await ensureD1Tables(d1);
  await d1.prepare(`
   INSERT INTO circle_points (id, t, sos, fid, crew_key, lat, lon, ca, ea, payload)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, ea = excluded.ea
  `).bind(
   pt.id, pt.t || 'circle', pt.sos ? 1 : 0, pt.fid || '', pt.crewKey || '',
   Number(pt.lat || 0), Number(pt.lon || 0), Number(pt.ca || Date.now()), Number(pt.ea || (Date.now() + 72*3600000)),
   JSON.stringify(pt)
  ).run();
 } catch (e) {}
}

async function d1DeletePoint(env, ptId) {
 const d1Info = getD1(env);
 const d1 = d1Info?.db;
 if (!d1 || !ptId) return;
 try {
  await ensureD1Tables(d1);
  await d1.prepare('DELETE FROM circle_points WHERE id = ?').bind(ptId).run();
 } catch (e) {}
}

async function d1PushRelay(env, pkt) {
 const d1Info = getD1(env);
 const d1 = d1Info?.db;
 if (!d1 || !pkt || !pkt.id) return;
 try {
  await ensureD1Tables(d1);
  await d1.prepare(`
   INSERT INTO transit_relay (id, channel_id, sender_id, cipher_payload, kind, crew_key, peer_id, ts)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
   pkt.id, pkt.channelId, pkt.senderId, pkt.cipherPayload, pkt.kind || 'chat',
   pkt.crewKey || '', pkt.peerId || '', Number(pkt.ts || Date.now())
  ).run();
  await d1.prepare('DELETE FROM transit_relay WHERE ts < ?').bind(Date.now() - 72 * 3600000).run().catch(() => {});
 } catch (e) {}
}
let _persistentStateLoadPromise = null;
let _lastD1StateSyncTs = 0;
async function pruneExpiredTemporaryUsers(env) {
 const now = Date.now();
 const cutoffTs = now - RESERVE_ID_TTL_MS;
 const expiredOrDupFids = [];
 const seenTempDeviceMap = new Map(); // deviceId -> newest temporary reserve user

 // Сортируем временные резервные ID по убыванию lastSeen/firstSeen, чтобы на 1 устройство оставался строго 1 актуальный резервный ID
 const allUsers = Array.from(usersRegistryStore.values()).sort((a, b) => (b.lastSeen || b.firstSeen || 0) - (a.lastSeen || a.firstSeen || 0));
 for (const u of allUsers) {
  if (!u || !u.fisherId) continue;
  if (deletedFisherIdsSet.has(u.fisherId) && !isOwnerFisherId(u.fisherId)) {
   usersRegistryStore.delete(u.fisherId);
   expiredOrDupFids.push(u.fisherId);
   continue;
  }
  if (isTemporaryReserveId(u.fisherId)) {
   const createdTs = Number(u.firstSeen || u.lastSeen || 0);
   if (!createdTs || (now - createdTs) > RESERVE_ID_TTL_MS) {
    usersRegistryStore.delete(u.fisherId);
    if (u.deviceId && deviceToFisherIdMap.get(u.deviceId) === u.fisherId) {
     deviceToFisherIdMap.delete(u.deviceId);
    }
    expiredOrDupFids.push(u.fisherId);
    continue;
   }
   if (u.deviceId) {
    if (seenTempDeviceMap.has(u.deviceId)) {
     // Дублирующий резервный ID от того же устройства (созданный в старых версиях при переключении точек на карте) — удаляем!
     usersRegistryStore.delete(u.fisherId);
     expiredOrDupFids.push(u.fisherId);
     continue;
    }
    seenTempDeviceMap.set(u.deviceId, u.fisherId);
    if (!deviceToFisherIdMap.has(u.deviceId)) {
     deviceToFisherIdMap.set(u.deviceId, u.fisherId);
    }
   }
  }
 }

 const d1Info = getD1(env);
 const d1 = d1Info?.db;
 if (d1) {
  try {
   await d1.prepare('DELETE FROM users_registry WHERE is_temporary = 1 AND first_seen < ?').bind(cutoffTs).run().catch(() => {});
   for (const fid of expiredOrDupFids.slice(0, 60)) {
    await d1.prepare('DELETE FROM users_registry WHERE fisher_id = ?').bind(fid).run().catch(() => {});
   }
  } catch (e) {}
 }
}

async function ensurePersistentStateLoaded(env, forceReload = false) {
 const nowTs = Date.now();
 if (persistentStateLoaded && !forceReload && (nowTs - _lastD1StateSyncTs < 8000)) return;
 if (_persistentStateLoadPromise && !forceReload) return _persistentStateLoadPromise;
 _persistentStateLoadPromise = (async () => {
 _lastD1StateSyncTs = nowTs;

 const d1Info = getD1(env);
 const d1 = d1Info?.db;

 if (d1) {
  await ensureD1Tables(d1);
  try {
   const kvRow = await d1.prepare('SELECT v FROM klev_kv WHERE k = ?').bind('SYS_STATE_V2_1_1').first().catch(() => null);
   if (kvRow && kvRow.v) {
    const parsedKv = workerSafeJsonParse(kvRow.v, null);
    if (parsedKv && Array.isArray(parsedKv.deletedIds)) {
     for (const df of parsedKv.deletedIds) {
      if (df) deletedFisherIdsSet.add(String(df).toUpperCase());
     }
    }
   }
  } catch (e) {}
  try {
   const userRows = await d1.prepare('SELECT payload FROM users_registry ORDER BY last_seen DESC LIMIT 5000').all();
   if (userRows && Array.isArray(userRows.results)) {
    const ownerBackup = usersRegistryStore.get(OWNER_FISHER_ID);
    usersRegistryStore.clear();
    if (ownerBackup) usersRegistryStore.set(OWNER_FISHER_ID, ownerBackup);
    for (const r of userRows.results) {
     const u = workerSafeJsonParse(r.payload, null);
     if (u && u.fisherId) {
      if (deletedFisherIdsSet.has(u.fisherId) && !isOwnerFisherId(u.fisherId)) continue;
      if (isTemporaryReserveId(u.fisherId) && (nowTs - Number(u.firstSeen || u.lastSeen || 0)) > RESERVE_ID_TTL_MS) continue;
      usersRegistryStore.set(u.fisherId, u);
      if (!isTemporaryReserveId(u.fisherId)) reservedVanityIds.add(u.fisherId);
      if (u.deviceId && (!deviceToFisherIdMap.has(u.deviceId) || !isTemporaryReserveId(u.fisherId))) {
       deviceToFisherIdMap.set(u.deviceId, u.fisherId);
      }
      if (u.tgId) tgToFisherIdMap.set(String(u.tgId), u.fisherId);
     }
    }
    await pruneExpiredTemporaryUsers(env);
   }

   const profRows = await d1.prepare('SELECT auth_key, login_norm, fisher_id, payload FROM auth_profiles LIMIT 5000').all();
   if (profRows && Array.isArray(profRows.results)) {
    for (const r of profRows.results) {
     const p = workerSafeJsonParse(r.payload, null);
     if (p && r.auth_key) {
      const effFid = r.fisher_id || p.fisherId || '';
      if (effFid) p.fisherId = effFid;
      cloudAuthProfiles.set(r.auth_key, p);
      const effLoginNorm = r.login_norm || workerNormalizeLogin(p.login || '');
      if (effLoginNorm) loginToAuthKeyMap.set(effLoginNorm, r.auth_key);
      if (effFid) {
       fisherIdToAuthKeyMap.set(effFid, r.auth_key);
       reservedVanityIds.add(effFid);
       if (!isTemporaryReserveId(effFid) && !usersRegistryStore.has(effFid)) {
        const restoredRec = upsertUserInRegistry({
         fisherId: effFid,
         deviceId: p.deviceId || '',
         login: p.login || effLoginNorm || '',
         callsign: p.callsign || p.login || 'Рыболов',
         tgId: p.tgLinkedId || '',
         tgUsername: p.tgUsername || '',
         regionCode: effFid.slice(3, 5) || workerResolveRegionCode(p.locAdmin1 || p.locLabel || '89'),
         locLabel: p.locLabel || 'Новый Уренгой',
         platform: 'WEB',
         version: WORKER_VERSION,
         lat: p.lat,
         lon: p.lon
        });
        if (restoredRec) d1SaveUser(env, restoredRec).catch(() => {});
       }
      }
     }
    }
   }

   const cntRows = await d1.prepare('SELECT region_code, seq_perm, seq_reserve FROM region_counters').all();
   if (cntRows && Array.isArray(cntRows.results)) {
    for (const r of cntRows.results) {
     if (r.region_code) {
      const curPerm = regionSequenceCounters.get(r.region_code) || 0;
      const curRz = regionReserveCounters.get(r.region_code) || 0;
      if (Number(r.seq_perm) > curPerm) regionSequenceCounters.set(r.region_code, Number(r.seq_perm));
      if (Number(r.seq_reserve) > curRz) regionReserveCounters.set(r.region_code, Number(r.seq_reserve));
     }
    }
   }

   const ptRows = await d1.prepare('SELECT payload FROM circle_points WHERE ea > ? ORDER BY ca DESC LIMIT 500').bind(Date.now()).all();
   if (ptRows && Array.isArray(ptRows.results)) {
    for (const r of ptRows.results) {
     const pt = workerSafeJsonParse(r.payload, null);
     if (pt && pt.id) circlePointsStore.set(pt.id, pt);
    }
   }

   adminWhitelistStore.set(OWNER_FISHER_ID, { id: OWNER_FISHER_ID, label: "iAthor • Антон (Владелец / Супер-Админ)", addedAt: "2026-10-27" });
   adminWhitelistStore.set(OWNER_SECONDARY_ID, { id: OWNER_SECONDARY_ID, label: "iAthor82 • Антон (Владелец / Спец-ID FP_FMP089)", addedAt: "2026-10-27" });
   persistentStateLoaded = true;
   return;
  } catch (e) {
   console.error('[D1 Load State Error]', e);
  }
 }

 const kv = getKV(env);
 if (kv) {
  try {
   const raw = (await kv.get('SYS_STATE_V2_1_1')) || (await kv.get('SYS_STATE_V2_1_00'));
   if (raw) {
    const parsed = workerSafeJsonParse(raw, null);
    if (parsed) applyLoadedSysMeta(parsed);
   }
  } catch (e) {}
 }
 persistentStateLoaded = true;
 })().finally(() => { _persistentStateLoadPromise = null; });
 return _persistentStateLoadPromise;
}


function bindTelegramToFisherProfile(params = {}) {
 const tgIdStr = String(params.tgId || '').trim();
 const tgUsernameClean = String(params.tgUsername || '').trim().replace(/^@/, '');
 const tgFirstName = String(params.tgFirstName || '').trim();
 const deviceId = String(params.deviceId || '').trim();
 const loginClean = String(params.login || '').trim();
 const loginNorm = workerNormalizeLogin(loginClean);
 const unameNorm = workerNormalizeLogin(tgUsernameClean);
 const hasNonOwnerExplicitFid = Boolean(params.fisherId && !isOwnerFisherId(params.fisherId));
 const hasNonOwnerExplicitLogin = Boolean(loginClean && !workerIsOwnerLogin(loginClean));
 const isOwner = !hasNonOwnerExplicitFid && !hasNonOwnerExplicitLogin && (
  workerIsOwnerLogin(loginClean) ||
  isOwnerFisherId(params.fisherId) ||
  (!loginClean && !params.fisherId && workerIsOwnerLogin(tgUsernameClean))
 );
 const regCode = workerResolveRegionCode(params.regionCode || params.locLabel || '89');
 let fid = isOwner ? OWNER_FISHER_ID : workerNormalizeFisherId(params.fisherId || '', regCode);
 if (!fid) {
  if (tgIdStr && tgToFisherIdMap.has(tgIdStr)) fid = tgToFisherIdMap.get(tgIdStr);
  else if (deviceId && deviceToFisherIdMap.has(deviceId)) fid = deviceToFisherIdMap.get(deviceId);
  else fid = allocateNextRegionalFisherId(regCode, deviceId || `tg_${tgIdStr}`);
 }

 // Если ранее у tg_bot_<tgId> был временный ID бота, переносим его на единый fid пользователя
 if (tgIdStr) {
  const botDevId = `tg_bot_${tgIdStr}`;
  const prevBotFid = deviceToFisherIdMap.get(botDevId);
  if (prevBotFid && prevBotFid !== fid && prevBotFid !== OWNER_FISHER_ID) {
   const prevBotRec = usersRegistryStore.get(prevBotFid);
   if (prevBotRec && (!prevBotRec.deviceId || prevBotRec.deviceId === botDevId)) {
    usersRegistryStore.delete(prevBotFid);
   }
  }
  tgToFisherIdMap.set(tgIdStr, fid);
  deviceToFisherIdMap.set(botDevId, fid);
  if (userSessions.has(tgIdStr)) {
   const s = userSessions.get(tgIdStr);
   userSessions.set(tgIdStr, { ...s, fisherId: fid, tgUsername: tgUsernameClean || s.tgUsername || '' });
  }
 }

 if (deviceId && fid !== OWNER_FISHER_ID) {
  deviceToFisherIdMap.set(deviceId, fid);
 }

 const existingUser = usersRegistryStore.get(fid);
 const userRec = upsertUserInRegistry({
  fisherId: fid,
  deviceId: deviceId || existingUser?.deviceId || (tgIdStr ? `tg_bot_${tgIdStr}` : ''),
  login: isOwner ? 'iAthor' : (loginClean || existingUser?.login || ''),
  callsign: isOwner ? 'iAthor' : (loginClean || existingUser?.callsign || tgFirstName || tgUsernameClean || 'Рыболов'),
  tgId: tgIdStr || existingUser?.tgId || '',
  tgUsername: tgUsernameClean || existingUser?.tgUsername || '',
  regionCode: regCode,
  locLabel: params.locLabel || existingUser?.locLabel || 'Новый Уренгой'
 });

 // Синхронизируем привязку Telegram во всех облачных профилях (Логин + Пароль) этого рыбака
 for (const [k, prof] of cloudAuthProfiles.entries()) {
  if (!prof || typeof prof !== 'object') continue;
  const profFid = workerNormalizeFisherId(prof.fisherId || '', '89');
  const profLoginNorm = String(prof.login || '').trim().toLowerCase().replace(/^@/, '');
  if (profFid === fid || (loginNorm && profLoginNorm === loginNorm) || (isOwner && k === 'OWNER_IATHOR_FP_89VIP089')) {
   prof.fisherId = isOwner ? OWNER_FISHER_ID : fid;
   if (tgIdStr) prof.tgLinkedId = tgIdStr;
   if (tgUsernameClean) prof.tgUsername = tgUsernameClean;
   prof.tgLinkedAt = Date.now();
   cloudAuthProfiles.set(k, prof);
  }
 }

 return userRec;
}


function purgeExpiredServerCirclePoints() {
 const now = Date.now();
 for (const [id, pt] of circlePointsStore.entries()) {
  if (!pt || (pt.ea && pt.ea < now)) {
   circlePointsStore.delete(id);
  }
 }
 if (circlePointsStore.size > 1500) {
  const sorted = Array.from(circlePointsStore.values()).sort((a, b) => (b.ca || 0) - (a.ca || 0)).slice(0, 1200);
  circlePointsStore.clear();
  for (const pt of sorted) circlePointsStore.set(pt.id, pt);
 }
}

function serializeFullServerState() {
 purgeExpiredServerCirclePoints();
 return JSON.stringify({
  v: WORKER_VERSION,
  ts: Date.now(),
  counters: Object.fromEntries(regionSequenceCounters.entries()),
  reserveCounters: Object.fromEntries(regionReserveCounters.entries()),
  fidAuthMap: Object.fromEntries(Array.from(fisherIdToAuthKeyMap.entries()).slice(-5000)),
  deletedIds: Array.from(deletedFisherIdsSet).slice(-2000),
  vanity: Array.from(reservedVanityIds).slice(-5000),
  whitelist: Array.from(adminWhitelistStore.values()),
  deviceMap: Object.fromEntries(Array.from(deviceToFisherIdMap.entries()).slice(-5000)),
  tgMap: Object.fromEntries(Array.from(tgToFisherIdMap.entries()).slice(-5000)),
  loginMap: Object.fromEntries(Array.from(loginToAuthKeyMap.entries()).slice(-5000)),
  users: Array.from(usersRegistryStore.values()).slice(-5000),
  points: Array.from(circlePointsStore.values()).slice(-1200),
  boxes: Object.fromEntries(Array.from(transitBoxes.entries()).map(([k, v]) => [k, (v || []).slice(-30)])),
  profiles: Object.fromEntries(Array.from(cloudAuthProfiles.entries()).slice(-3000))
 });
}

function applyLoadedSysMeta(parsed) {
 if (!parsed || typeof parsed !== 'object') return;
 if (parsed.counters && typeof parsed.counters === 'object') {
  for (const [reg, val] of Object.entries(parsed.counters)) {
   const cur = regionSequenceCounters.get(reg) || 0;
   if (Number(val) > cur) regionSequenceCounters.set(reg, Number(val));
  }
 }
 if (parsed.reserveCounters && typeof parsed.reserveCounters === 'object') {
  for (const [reg, val] of Object.entries(parsed.reserveCounters)) {
   const cur = regionReserveCounters.get(reg) || 0;
   if (Number(val) > cur) regionReserveCounters.set(reg, Number(val));
  }
 }
 if (parsed.fidAuthMap && typeof parsed.fidAuthMap === 'object') {
  for (const [fid, aKey] of Object.entries(parsed.fidAuthMap)) {
   if (fid && aKey) fisherIdToAuthKeyMap.set(String(fid).toUpperCase(), String(aKey));
  }
 }
 if (Array.isArray(parsed.deletedIds)) {
  for (const df of parsed.deletedIds) {
   if (typeof df === 'string' && df) deletedFisherIdsSet.add(df.toUpperCase());
  }
 }
 if (Array.isArray(parsed.vanity)) {
  for (const vid of parsed.vanity) {
   if (typeof vid === 'string' && vid) reservedVanityIds.add(vid);
  }
 }
 if (Array.isArray(parsed.whitelist)) {
  for (const item of parsed.whitelist) {
   if (item && item.id) {
    const normId = item.id === 'FP_FMP089' ? OWNER_FISHER_ID : item.id;
    adminWhitelistStore.set(normId, { ...item, id: normId });
   }
  }
 }
 if (parsed.deviceMap && typeof parsed.deviceMap === 'object') {
  for (const [devId, fid] of Object.entries(parsed.deviceMap)) {
   if (devId && fid && !deviceToFisherIdMap.has(devId)) {
    deviceToFisherIdMap.set(devId, fid);
   }
  }
 }
 if (parsed.tgMap && typeof parsed.tgMap === 'object') {
  for (const [tgId, fid] of Object.entries(parsed.tgMap)) {
   if (tgId && fid) {
    tgToFisherIdMap.set(String(tgId), fid === 'FP_FMP089' ? OWNER_FISHER_ID : fid);
   }
  }
 }
 if (parsed.loginMap && typeof parsed.loginMap === 'object') {
  for (const [lg, aKey] of Object.entries(parsed.loginMap)) {
   if (lg && aKey) loginToAuthKeyMap.set(String(lg).toLowerCase(), String(aKey));
  }
 }
 if (Array.isArray(parsed.users)) {
  for (const u of parsed.users) {
   if (u && u.fisherId) {
    const normId = u.fisherId === 'FP_FMP089' ? OWNER_FISHER_ID : u.fisherId;
    const ex = usersRegistryStore.get(normId);
    if (!ex || (u.lastSeen || 0) >= (ex.lastSeen || 0)) {
     usersRegistryStore.set(normId, { ...u, fisherId: normId });
    }
    reservedVanityIds.add(normId);
    if (u.deviceId && normId !== OWNER_FISHER_ID) {
     deviceToFisherIdMap.set(u.deviceId, normId);
    }
   }
  }
 }
 if (Array.isArray(parsed.points)) {
  const now = Date.now();
  for (const pt of parsed.points) {
   if (pt && pt.id && (!pt.ea || pt.ea > now)) {
    circlePointsStore.set(pt.id, pt);
   }
  }
 }
 if (parsed.boxes && typeof parsed.boxes === 'object') {
  for (const [ch, pkts] of Object.entries(parsed.boxes)) {
   if (ch && Array.isArray(pkts)) {
    const existing = transitBoxes.get(ch) || [];
    const seenIds = new Set(existing.map(p => p.id));
    const merged = [...existing];
    for (const p of pkts) {
     if (p && p.id && !seenIds.has(p.id)) {
      merged.push(p);
      seenIds.add(p.id);
     }
    }
    transitBoxes.set(ch, merged.slice(-50));
   }
  }
 }
 if (parsed.profiles && typeof parsed.profiles === 'object') {
  for (const [k, prof] of Object.entries(parsed.profiles)) {
   if (k && prof && typeof prof === 'object') {
    if (!cloudAuthProfiles.has(k)) cloudAuthProfiles.set(k, prof);
    if (prof.fisherId) {
     reservedVanityIds.add(prof.fisherId);
     fisherIdToAuthKeyMap.set(String(prof.fisherId).toUpperCase(), k);
    }
    if (prof.login) loginToAuthKeyMap.set(String(prof.login).trim().toLowerCase().replace(/^@/, ''), k);
   }
  }
 }
 adminWhitelistStore.set(OWNER_FISHER_ID, { id: OWNER_FISHER_ID, label: "iAthor • Антон (Владелец / Супер-Админ)", addedAt: "2026-10-27" });
}


async function persistSystemMeta(env, ctx = null) {
 const task = (async () => {
  const payloadStr = serializeFullServerState();
  lastEdgePersistTs = Date.now();
  const d1Info = getD1(env);
  const d1 = d1Info?.db;
  if (d1) {
   try {
    await d1.prepare('INSERT OR REPLACE INTO klev_kv (k, v, updated_at) VALUES (?, ?, ?)').bind('SYS_STATE_V2_1_1', payloadStr, Date.now()).run();
    for (const [rc, permVal] of regionSequenceCounters.entries()) {
     const rzVal = regionReserveCounters.get(rc) || 0;
     await d1.prepare('INSERT OR REPLACE INTO region_counters (region_code, seq_perm, seq_reserve) VALUES (?, ?, ?)').bind(rc, permVal, rzVal).run().catch(() => {});
    }
   } catch (e) {}
  }
  const kv = getKV(env);
  if (kv) {
   try {
    await kv.put('SYS_STATE_V2_1_1', payloadStr);
   } catch (e) {}
  }
 })();
 if (ctx && typeof ctx.waitUntil === 'function') {
  ctx.waitUntil(task);
  return;
 }
 await task;
}

async function loadPersistedAuthProfile(env, authKey, loginNorm = '', fisherId = '') {
 const d1Info = getD1(env);
 const d1 = d1Info?.db;
 if (d1) {
  try {
   let row = null;
   if (authKey) row = await d1.prepare('SELECT auth_key, login_norm, fisher_id, payload FROM auth_profiles WHERE auth_key = ?').bind(authKey).first();
   if (!row && loginNorm) row = await d1.prepare('SELECT auth_key, login_norm, fisher_id, payload FROM auth_profiles WHERE login_norm = ?').bind(loginNorm).first();
   if (!row && fisherId) row = await d1.prepare('SELECT auth_key, login_norm, fisher_id, payload FROM auth_profiles WHERE fisher_id = ?').bind(fisherId).first();
   if (row && row.payload) {
    const prof = workerSafeJsonParse(row.payload, null);
    if (prof) {
     const effKey = row.auth_key || authKey || `AUTH_${row.login_norm || loginNorm}`;
     cloudAuthProfiles.set(effKey, prof);
     if (authKey && authKey !== effKey) cloudAuthProfiles.set(authKey, prof);
     const effLogin = row.login_norm || loginNorm || workerNormalizeLogin(prof.login || '');
     if (effLogin) loginToAuthKeyMap.set(effLogin, effKey);
     const effFid = row.fisher_id || fisherId || prof.fisherId || '';
     if (effFid) {
      fisherIdToAuthKeyMap.set(effFid, effKey);
      reservedVanityIds.add(effFid);
     }
     return prof;
    }
   }
  } catch (e) {}
 }
 if (authKey && cloudAuthProfiles.has(authKey)) return cloudAuthProfiles.get(authKey);
 if (loginNorm && loginToAuthKeyMap.has(loginNorm)) {
  const k = loginToAuthKeyMap.get(loginNorm);
  if (cloudAuthProfiles.has(k)) return cloudAuthProfiles.get(k);
 }
 return null;
}

async function persistAuthProfile(env, authKey, profileObj, ctx = null) {
 if (!authKey || !profileObj) return;
 cloudAuthProfiles.set(authKey, profileObj);
 const loginNorm = workerNormalizeLogin(profileObj.login);
 const fid = profileObj.fisherId || '';
 await d1SaveAuthProfile(env, authKey, loginNorm, fid, profileObj);
 await persistSystemMeta(env, ctx);
}

function buildOwnerServerPortalSlotHtml(originUrl = 'https://klevprohbot.thorantony82.workers.dev', d1Info = null) {
 const consoleUrl = `${originUrl.replace(/\/?$/, '')}/fp-vip089-console`;
 const totalUsers = usersRegistryStore.size;
 const activePoints = circlePointsStore.size;
 const now = Date.now();
 const active24h = Array.from(usersRegistryStore.values()).filter(u => u && (now - (u.lastSeen || 0)) < 86400000).length;
 const safeD1Name = d1Info && d1Info.name ? String(d1Info.name).replace(/[&<>"']/g, '') : 'DB';
 const d1Badge = d1Info ? `<span class="pill pill-good" style="font-size:10px;">🟢 D1 (${safeD1Name})</span>` : `<span class="pill pill-bad" style="font-size:10px;">🔴 D1 не привязана</span>`;
 return `
  <div style="margin-top:8px;padding:10px 12px;background:rgba(56,189,248,0.12);border:1.5px solid var(--accent);border-radius:8px;display:flex;flex-direction:column;gap:8px;">
   <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
    <span style="font-weight:900;font-size:12px;color:var(--accent);">📊 ЗАКРЫТАЯ БАЗА ПОЛЬЗОВАТЕЛЕЙ И СТАТИСТИКА (ТОЛЬКО ДЛЯ FP_89VIP089)</span>
    ${d1Badge}
   </div>
   <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;text-align:center;">
    <div style="padding:6px;background:var(--panel);border-radius:6px;border:1px solid var(--border);">
     <div style="font-size:15px;font-weight:900;color:var(--good);">${totalUsers}</div>
     <div style="font-size:10px;color:var(--muted);">Рыбаков в БД</div>
    </div>
    <div style="padding:6px;background:var(--panel);border-radius:6px;border:1px solid var(--border);">
     <div style="font-size:15px;font-weight:900;color:var(--accent);">${active24h}</div>
     <div style="font-size:10px;color:var(--muted);">Активны (24ч)</div>
    </div>
    <div style="padding:6px;background:var(--panel);border-radius:6px;border:1px solid var(--border);">
     <div style="font-size:15px;font-weight:900;color:var(--warn);">${activePoints}</div>
     <div style="font-size:10px;color:var(--muted);">Точек в Круге</div>
    </div>
   </div>
   <button type="button" class="btn btn-sm btn-accent" data-cloud-open-url="${consoleUrl}" style="width:100%;font-weight:800;">
    🛡️ Открыть полную Базу Пользователей и Статистику (FP_89VIP089) ↗
   </button>
  </div>
 `;
}

function renderSuperAdminConsoleHtml(originUrl = '', d1Info = null) {
 purgeExpiredServerCirclePoints();
 const now = Date.now();
 const users = Array.from(usersRegistryStore.values()).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
 const points = Array.from(circlePointsStore.values()).sort((a, b) => (b.ca || 0) - (a.ca || 0));
 const totalUsers = users.length;
 const active24h = users.filter(u => (now - (u.lastSeen || 0)) < 86400000).length;
 const active7d = users.filter(u => (now - (u.lastSeen || 0)) < 7 * 86400000).length;
 const apkCount = users.filter(u => String(u.platform || '').toUpperCase().includes('APK') || String(u.platform || '').toUpperCase().includes('ANDROID')).length;
 const tgCount = users.filter(u => String(u.platform || '').toUpperCase().includes('TG')).length;
 const webCount = Math.max(0, totalUsers - apkCount - tgCount);

 const regStats = {};
 for (const u of users) {
  const rc = u.regionCode || '89';
  regStats[rc] = (regStats[rc] || 0) + 1;
 }
 const regBadges = Object.entries(regStats)
  .sort((a, b) => b[1] - a[1])
  .map(([rc, cnt]) => `<span style="padding:3px 8px;border-radius:999px;background:#1e293b;border:1px solid #334155;font-size:12px;">Регион <b>${rc}</b>: ${cnt} чел. (след. № ${(regionSequenceCounters.get(rc) || 0) + 1})</span>`)
  .join(' ');

 const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
 const fmtDate = (ts) => ts ? new Date(ts).toLocaleString('ru-RU', { timeZone: 'Asia/Yekaterinburg' }) : '—';

 const d1BannerHtml = d1Info
  ? `<div style="padding:10px 14px;border-radius:10px;background:rgba(16,185,129,0.15);border:1.5px solid #10b981;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
      <div>
       <div style="font-weight:900;color:#34d399;font-size:14px;">🟢 Cloudflare D1 База Данных: ПОДКЛЮЧЕНА (Имя привязки: ${esc(d1Info.name)})</div>
       <div style="font-size:12px;color:#94a3b8;margin-top:2px;">Все постоянные ID, реестр пользователей, чаты и точки сохраняются в постоянных SQL-таблицах D1.</div>
      </div>
      <span style="padding:4px 10px;border-radius:6px;background:#1e293b;border:1px solid #334155;font-size:11px;font-weight:800;color:#38bdf8;">D1 Engine 2.5.1</span>
     </div>`
  : `<div style="padding:12px 14px;border-radius:10px;background:rgba(239,68,68,0.15);border:1.5px solid #ef4444;margin-bottom:12px;display:flex;flex-direction:column;gap:6px;">
      <div style="font-weight:900;color:#f87171;font-size:14px;">🔴 ВНИМАНИЕ: Cloudflare D1 База Данных НЕ ПРИВЯЗАНА!</div>
      <div style="font-size:12.5px;color:#cbd5e1;line-height:1.45;">
       Из-за этого данные между устройствами не связываются и сбрасываются при перезапуске инстансов. Чтобы подключить созданную базу:<br>
       <b>1.</b> В Cloudflare Dashboard перейдите: <code>Workers & Pages</code> ➔ <code>klevprohbot</code> ➔ <code>Settings</code> ➔ <code>Variables and Bindings</code>.<br>
       <b>2.</b> В блоке <b>D1 Database Bindings</b> нажмите <b>Add binding</b>.<br>
       <b>3.</b> В поле <b>Variable name</b> введите строго: <code>DB</code>, выберите вашу созданную БД D1 и сохраните (<b>Deploy</b>).
      </div>
     </div>`;

 const userRows = users.map((u, idx) => {
  const roleBadge = u.fisherId === OWNER_FISHER_ID
   ? `<span style="padding:2px 7px;border-radius:6px;background:rgba(16,185,129,0.2);color:#34d399;font-weight:800;font-size:11px;">👑 ВЛАДЕЛЕЦ</span>`
   : (adminWhitelistStore.has(u.fisherId)
       ? `<span style="padding:2px 7px;border-radius:6px;background:rgba(56,189,248,0.2);color:#38bdf8;font-weight:800;font-size:11px;">🛡️ АДМИН</span>`
       : `<span style="padding:2px 7px;border-radius:6px;background:#1e293b;color:#94a3b8;font-size:11px;">🎣 Рыболов</span>`);
  return `
   <tr data-search-row="${esc(`${u.fisherId} ${u.login} ${u.callsign} ${u.tgUsername} ${u.locLabel} ${u.regionCode} ${u.platform}`.toLowerCase())}">
    <td style="padding:8px;border-bottom:1px solid #1e293b;color:#64748b;">${idx + 1}</td>
    <td style="padding:8px;border-bottom:1px solid #1e293b;font-family:monospace;font-weight:900;color:#38bdf8;">${esc(u.fisherId)}</td>
    <td style="padding:8px;border-bottom:1px solid #1e293b;"><b>${esc(u.login || u.callsign || 'Рыболов')}</b>${u.tgUsername ? ` <span style="color:#38bdf8;">(@${esc(u.tgUsername)})</span>` : (u.tgId ? ` <span style="color:#64748b;">(TG:${esc(u.tgId)})</span>` : '')}</td>
    <td style="padding:8px;border-bottom:1px solid #1e293b;"><span style="padding:2px 6px;border-radius:4px;background:#0f172a;border:1px solid #334155;font-family:monospace;">${esc(u.regionCode)}</span> ${esc(u.locLabel)}</td>
    <td style="padding:8px;border-bottom:1px solid #1e293b;">${esc(u.platform)} <span style="color:#64748b;font-size:11px;">v${esc(u.version)}</span></td>
    <td style="padding:8px;border-bottom:1px solid #1e293b;text-align:center;">${u.sessionsCount || 1} / <b>${u.circlePostsCount || 0}</b></td>
    <td style="padding:8px;border-bottom:1px solid #1e293b;font-size:12px;color:#94a3b8;">${fmtDate(u.lastSeen)}</td>
    <td style="padding:8px;border-bottom:1px solid #1e293b;">${roleBadge}</td>
   </tr>
  `;
 }).join('');

 const pointRows = points.map((p) => {
  const typeLbl = p.sos ? '🆘 SOS' : (p.t === 'crew' ? `🌊 Экипаж (${esc(p.crewKey || '')})` : (p.t === 'workshop' ? '🛠️ Снасть' : '👥 Круг ±5км'));
  return `
   <tr>
    <td style="padding:7px;border-bottom:1px solid #1e293b;font-family:monospace;font-size:11px;">${esc(p.id)}</td>
    <td style="padding:7px;border-bottom:1px solid #1e293b;font-weight:800;">${typeLbl}</td>
    <td style="padding:7px;border-bottom:1px solid #1e293b;font-family:monospace;color:#38bdf8;">${esc(p.fid || '—')} (${esc(p.au || 'Рыболов')})</td>
    <td style="padding:7px;border-bottom:1px solid #1e293b;">${esc(p.fn || 'Рыба')} • ${esc(p.wn || p.lb || 'Точка')} (${Number(p.lat || 0).toFixed(3)}, ${Number(p.lon || 0).toFixed(3)})</td>
    <td style="padding:7px;border-bottom:1px solid #1e293b;font-size:12px;">${esc(p.nt || '—')}</td>
    <td style="padding:7px;border-bottom:1px solid #1e293b;font-size:11px;color:#94a3b8;">${fmtDate(p.ca)}</td>
    <td style="padding:7px;border-bottom:1px solid #1e293b;">
     <button onclick="delPoint('${esc(p.id)}')" style="padding:4px 8px;border-radius:6px;border:1px solid #ef4444;background:rgba(239,68,68,0.15);color:#fca5a5;cursor:pointer;font-size:11px;">🗑️ Удалить</button>
    </td>
   </tr>
  `;
 }).join('');

 return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>👑 Закрытая Консоль Супер-Админа • iAthor (FP_89VIP089) • Клёв ПРО V.${WORKER_VERSION}</title>
<style>
 body { margin:0; padding:16px; background:#070d19; color:#f1f5f9; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
 .wrap { max-width:1220px; margin:0 auto; display:flex; flex-direction:column; gap:16px; }
 .card { background:#0f172a; border:1px solid #1e293b; border-radius:12px; padding:16px; box-shadow:0 8px 24px rgba(0,0,0,0.35); }
 .kpi-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:10px; }
 .kpi { background:#131f35; border:1px solid #263554; border-radius:10px; padding:12px; }
 .kpi-val { font-size:24px; font-weight:900; color:#38bdf8; }
 .kpi-lbl { font-size:12px; color:#94a3b8; margin-top:4px; }
 input.search { width:100%; box-sizing:border-box; padding:10px 14px; border-radius:8px; border:1px solid #334155; background:#070d19; color:#fff; font-size:14px; }
 .btn { padding:8px 14px; border-radius:8px; border:1px solid #38bdf8; background:rgba(56,189,248,0.15); color:#38bdf8; font-weight:800; cursor:pointer; font-size:13px; text-decoration:none; display:inline-block; }
 table { width:100%; border-collapse:collapse; font-size:13px; }
 th { text-align:left; padding:10px 8px; border-bottom:2px solid #334155; color:#94a3b8; font-size:11px; text-transform:uppercase; }
</style>
</head>
<body>
<div class="wrap">
 ${d1BannerHtml}
 <div class="card" style="border-color:#10b981;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
  <div>
   <div style="font-size:18px;font-weight:900;color:#34d399;">👑 ЗАКРЫТАЯ БАЗА ПОЛЬЗОВАТЕЛЕЙ И СТАТИСТИКА «КЛЁВ ПРО V.${WORKER_VERSION}»</div>
   <div style="font-size:12px;color:#94a3b8;margin-top:3px;">Владелец: <b>iAthor (Антон)</b> • Эксклюзивный ID: <b>${OWNER_FISHER_ID}</b> • Хранилище: Triple-Engine $0 (Edge Cache + D1/KV)</div>
  </div>
  <div style="display:flex;gap:8px;flex-wrap:wrap;">
   <button class="btn" style="border-color:#f87171;color:#fca5a5;background:rgba(239,68,68,0.16);" onclick="closeAdminConsole()">← Назад в приложение (✕ Закрыть)</button>
   <button class="btn" onclick="exportUsersJson()">📥 Скачать базу (.JSON)</button>
   <button class="btn" onclick="exportUsersCsv()">📊 Скачать таблицу (.CSV)</button>
   <button class="btn" onclick="location.reload()">🔄 Обновить данные</button>
  </div>
 </div>

 <div class="kpi-grid">
  <div class="kpi"><div class="kpi-val" style="color:#34d399;">${totalUsers}</div><div class="kpi-lbl">Всего рыбаков в базе (уникальных ID)</div></div>
  <div class="kpi"><div class="kpi-val">${active24h} / ${active7d}</div><div class="kpi-lbl">Активны за 24 часа / 7 дней</div></div>
  <div class="kpi"><div class="kpi-val" style="color:#a78bfa;">📱 ${apkCount} • 🌐 ${webCount} • ✈️ ${tgCount}</div><div class="kpi-lbl">Платформы (APK / Web PWA / Telegram)</div></div>
  <div class="kpi"><div class="kpi-val" style="color:#fbbf24;">${points.length}</div><div class="kpi-lbl">Активных точек в Круге / Экипаже / SOS</div></div>
 </div>

 <div class="card">
  <div style="font-weight:800;font-size:13px;color:#38bdf8;margin-bottom:8px;">🗺️ РАСПРЕДЕЛЕНИЕ ВЫДАННЫХ ID ПО РЕГИОНАМ РФ:</div>
  <div style="display:flex;flex-wrap:wrap;gap:6px;">${regBadges || 'Пока нет данных'}</div>
 </div>

 <div class="card">
  <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px;">
   <div style="font-weight:900;font-size:15px;">👥 РЕЕСТР ПОЛЬЗОВАТЕЛЕЙ ЭКОСИСТЕМЫ (${totalUsers}):</div>
   <div style="flex:1;min-width:260px;max-width:420px;">
    <input type="text" class="search" id="userSearchInp" placeholder="🔍 Поиск по ID (FP_...), логину, городу, региону или платформе..." oninput="filterUsers(this.value)">
   </div>
  </div>
  <div style="overflow-x:auto;">
   <table>
    <thead>
     <tr>
      <th>#</th>
      <th>ID Рыбака</th>
      <th>Логин / Позывной / TG</th>
      <th>Регион и Локация</th>
      <th>Платформа</th>
      <th>Сессий / Точек</th>
      <th>Последняя активность (ЕКБ/ЯНАО)</th>
      <th>Статус</th>
     </tr>
    </thead>
    <tbody id="usersTableBody">${userRows}</tbody>
   </table>
  </div>
 </div>

 <div class="card">
  <div style="font-weight:900;font-size:15px;margin-bottom:10px;">📡 АКТИВНЫЕ ТОЧКИ НА КАРТЕ КРУГА / ЭКИПАЖЕЙ / SOS (${points.length}):</div>
  <div style="overflow-x:auto;">
   <table>
    <thead>
     <tr>
      <th>ID точки</th>
      <th>Категория</th>
      <th>Автор (ID)</th>
      <th>Рыба • Водоём • Координаты</th>
      <th>Заметка</th>
      <th>Опубликовано</th>
      <th>Управление</th>
     </tr>
    </thead>
    <tbody>${pointRows || '<tr><td colspan="7" style="padding:14px;text-align:center;color:#64748b;">Активных точек пока нет</td></tr>'}</tbody>
   </table>
  </div>
 </div>
</div>
<script>
 const RAW_USERS = ${JSON.stringify(users.map(u => sanitizePublicUserResponse(u, true))).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')};
 const ADMIN_TOKEN = ${JSON.stringify(OWNER_ADMIN_CONSOLE_TOKEN)};
 function filterUsers(q) {
  const norm = (q || '').trim().toLowerCase();
  document.querySelectorAll('#usersTableBody tr').forEach(tr => {
   const hay = tr.getAttribute('data-search-row') || '';
   tr.style.display = (!norm || hay.includes(norm)) ? '' : 'none';
  });
 }
 function exportUsersJson() {
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), version: '${WORKER_VERSION}', total: RAW_USERS.length, users: RAW_USERS }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'klev-pro-users-db-' + new Date().toISOString().slice(0,10) + '.json';
  a.click();
 }
 function exportUsersCsv() {
  const header = ['fisherId','login','callsign','tgUsername','regionCode','locLabel','platform','version','sessionsCount','circlePostsCount','lastSeen'];
  const rows = RAW_USERS.map(u => header.map(k => '"' + String(u[k] ?? '').replace(/"/g, '""') + '"').join(','));
  const csv = '\uFEFF' + header.join(',') + '\n' + rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'klev-pro-users-db-' + new Date().toISOString().slice(0,10) + '.csv';
  a.click();
 }
 function closeAdminConsole() {
  try {
   if (window.parent && window.parent !== window) {
    window.parent.postMessage('klev_close_admin_console', '*');
    const parentBackdrop = window.parent.document && window.parent.document.getElementById('appModalBackdrop');
    if (parentBackdrop) parentBackdrop.classList.remove('open');
    return;
   }
  } catch (e) {}
  try { window.close(); } catch (e) {}
  if (window.history && window.history.length > 1) {
   window.history.back();
  } else {
   window.location.href = 'https://klevpro.ru/#/admin';
  }
 }
 // Поддержка свайпа от левого края для возврата в приложение
 (function() {
  var touchStartX = 0, touchStartY = 0;
  window.addEventListener('touchstart', function(e) {
   if (e.touches && e.touches.length === 1) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
   }
  }, { passive: true });
  window.addEventListener('touchend', function(e) {
   if (!e.changedTouches || !e.changedTouches.length) return;
   var dx = e.changedTouches[0].clientX - touchStartX;
   var dy = Math.abs(e.changedTouches[0].clientY - touchStartY);
   if (touchStartX < 48 && dx > 85 && dy < 65) {
    closeAdminConsole();
   }
  }, { passive: true });
 })();
 async function delPoint(id) {
  if (!confirm('Подтвердите удаление: точно удалить точку ' + id + ' с сервера и с карты у всех пользователей?')) return;
  const res = await fetch('/api/circle/delete', {
   method: 'POST',
   headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
   body: JSON.stringify({ id, fid: '${OWNER_FISHER_ID}', adminToken: ADMIN_TOKEN })
  });
  if (res.ok) location.reload();
 }
</script>
</body>
</html>`;
}


export default {
 async fetch(request, env, ctx) {
  try {
  const BOT_TOKEN = (env && env.BOT_TOKEN) || '';
  const WEBHOOK_SECRET = (env && env.WEBHOOK_SECRET) || '';
  const WEBAPP_URL = ((env && env.WEBAPP_URL) || 'https://klevpro.ru/').replace(/\/?$/, '/');
  const reqUrl = new URL(request.url);

  // Пункт 19: Принудительный HTTPS (кроме локальной отладки)
  if (reqUrl.protocol === 'http:' && reqUrl.hostname !== 'localhost' && reqUrl.hostname !== '127.0.0.1') {
   return Response.redirect(reqUrl.toString().replace(/^http:/, 'https:'), 301);
  }

  if (request.method === 'OPTIONS') {
   return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const clientIp = request.headers.get('CF-Connecting-IP') || 'anon_ip';

  // ── 0. Секретная серверная страница Базы Пользователей и Статистики (ТОЛЬКО для iAthor / FP_89VIP089) ──
  if (reqUrl.pathname.endsWith('/fp-vip089-console') && (request.method === 'GET' || request.method === 'POST')) {
   if (!checkWorkerRateLimit(`console_${clientIp}`, false, 10)) {
    return new Response('Too many requests', { status: 429, headers: CORS_HEADERS });
   }
   await ensurePersistentStateLoaded(env);
   let body = {};
   if (request.method === 'POST') {
    try {
     body = await readWorkerRequestPayload(request, reqUrl);
    } catch (e) {}
   }
   const tok = extractAdminTokenFromRequest(request, reqUrl, body);
   const consoleCsp = "default-src 'self' https: data: blob: 'unsafe-inline'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src *; frame-ancestors *;";
   if (!isValidOwnerAdminToken(tok, env)) {
    const loginHtml = '<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>👑 Вход в Веб-Консоль Владельца</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#090d16;color:#e2e8f0;font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:16px;} .box{background:#0f172a;border:1px solid #334155;border-radius:12px;padding:24px;max-width:380px;width:100%;text-align:center;box-shadow:0 10px 25px rgba(0,0,0,0.5);} input{width:100%;box-sizing:border-box;padding:11px 14px;background:#1e293b;border:1px solid #475569;border-radius:8px;color:#fff;font-size:14px;margin-bottom:12px;outline:none;} button{width:100%;padding:11px;background:#0284c7;color:#fff;font-weight:700;border:none;border-radius:8px;cursor:pointer;font-size:15px;}</style></head><body><div class="box"><div style="font-size:36px;margin-bottom:6px;">👑</div><h2 style="margin:0 0 6px;color:#38bdf8;">Веб-Консоль Супер-Админа</h2><p style="font-size:12px;color:#94a3b8;margin-bottom:18px;">Клёв ПРО 2.0 • Введите пароль Владельца или токен доступа</p><form method="POST" action="' + reqUrl.pathname + '"><input type="password" name="token" placeholder="Пароль или токен доступа" autofocus required><button type="submit">Войти в консоль</button></form></div></body></html>';
    return new Response(loginHtml, {
     status: 200,
     headers: {
      ...CORS_HEADERS,
      'Content-Type': 'text/html;charset=utf-8',
      'Content-Security-Policy': consoleCsp
     }
    });
   }
   const d1Info = getD1(env);
   const sessionCookie = `klev_admin_session=${encodeURIComponent(getAdminConsoleToken(env))}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`;
   return new Response(renderSuperAdminConsoleHtml(reqUrl.origin, d1Info), {
    headers: {
     ...CORS_HEADERS,
     'Content-Type': 'text/html;charset=utf-8',
     'Cache-Control': 'no-store, no-cache, must-revalidate',
     'Content-Security-Policy': consoleCsp,
     'Set-Cookie': sessionCookie
    }
   });
  }

  // ── Удаление пользователя из базы данных сервера Супер-Админом (/api/admin/user/delete) ──
  if (reqUrl.pathname.endsWith('/api/admin/user/delete') && (request.method === 'POST' || reqUrl.searchParams.has('payload'))) {
   if (!checkWorkerRateLimit(`admdel_${clientIp}`, false, 20)) {
    return new Response(JSON.stringify({ ok: false, error: 'Rate limit' }), { status: 429, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
   }
   await ensurePersistentStateLoaded(env);
   try {
    const body = await readWorkerRequestPayload(request, reqUrl);
    const tok = extractAdminTokenFromRequest(request, reqUrl, body);
    if (!isValidOwnerAdminToken(tok, env)) {
     return new Response(JSON.stringify({ ok: false, error: 'Forbidden: invalid admin token' }), { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }
    const targetFid = workerNormalizeFisherId(body.fisherId || '', '89') || String(body.fisherId || '').trim().toUpperCase();
    if (!targetFid || isOwnerFisherId(targetFid)) {
     return new Response(JSON.stringify({ ok: false, error: 'Нельзя удалить Владельца (FP_89VIP089)' }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }
    deletedFisherIdsSet.add(targetFid);
    const exUser = usersRegistryStore.get(targetFid);
    const exLoginNorm = exUser?.login ? workerNormalizeLogin(exUser.login) : '';
    usersRegistryStore.delete(targetFid);
    reservedVanityIds.delete(targetFid);
    if (exUser) {
     if (exUser.deviceId) deviceToFisherIdMap.delete(exUser.deviceId);
     if (exUser.tgId) tgToFisherIdMap.delete(String(exUser.tgId));
    }
    for (const [devK, devFid] of deviceToFisherIdMap.entries()) {
     if (devFid === targetFid) deviceToFisherIdMap.delete(devK);
    }
    for (const [tgK, tgFid] of tgToFisherIdMap.entries()) {
     if (tgFid === targetFid) tgToFisherIdMap.delete(tgK);
    }
    const mappedAuthKey = fisherIdToAuthKeyMap.get(targetFid);
    if (mappedAuthKey) cloudAuthProfiles.delete(mappedAuthKey);
    fisherIdToAuthKeyMap.delete(targetFid);

    const loginsToDelete = new Set();
    if (exLoginNorm) loginsToDelete.add(exLoginNorm);
    for (const [aKey, prof] of cloudAuthProfiles.entries()) {
     if (!prof) continue;
     const pFid = workerNormalizeFisherId(prof.fisherId || '', '89');
     const pLogin = workerNormalizeLogin(prof.login || '');
     if (pFid === targetFid || (exLoginNorm && pLogin === exLoginNorm)) {
      cloudAuthProfiles.delete(aKey);
      if (pLogin) loginsToDelete.add(pLogin);
     }
    }
    for (const ln of loginsToDelete) {
     const ak = loginToAuthKeyMap.get(ln);
     if (ak) cloudAuthProfiles.delete(ak);
     loginToAuthKeyMap.delete(ln);
    }
    for (const [ln, ak] of loginToAuthKeyMap.entries()) {
     if (ak === mappedAuthKey || (exLoginNorm && ak.startsWith(`AUTH_${exLoginNorm}_`))) {
      cloudAuthProfiles.delete(ak);
      loginToAuthKeyMap.delete(ln);
     }
    }

    // Очищаем транзитные боксы чатов и точек удалённого пользователя в памяти
    for (const [bKey, bArr] of transitBoxes.entries()) {
     if (bKey === `DM_${targetFid}`) {
      transitBoxes.delete(bKey);
      continue;
     }
     if (Array.isArray(bArr)) {
      const filtered = bArr.filter(p => p && p.senderId !== targetFid && p.peerId !== targetFid);
      if (filtered.length === 0) transitBoxes.delete(bKey);
      else transitBoxes.set(bKey, filtered);
     }
    }
    for (const [ptId, ptObj] of circlePointsStore.entries()) {
     if (ptObj && ptObj.fid === targetFid) circlePointsStore.delete(ptId);
    }

    const d1Info = getD1(env);
    const d1 = d1Info?.db;
    if (d1) {
     await d1.prepare('DELETE FROM users_registry WHERE fisher_id = ?').bind(targetFid).run().catch(() => {});
     if (exUser && exUser.deviceId && isTemporaryReserveId(targetFid)) {
      await d1.prepare('DELETE FROM users_registry WHERE device_id = ? AND is_temporary = 1').bind(exUser.deviceId).run().catch(() => {});
     }
     await d1.prepare('DELETE FROM auth_profiles WHERE fisher_id = ?').bind(targetFid).run().catch(() => {});
     for (const ln of loginsToDelete) {
      await d1.prepare('DELETE FROM auth_profiles WHERE login_norm = ?').bind(ln).run().catch(() => {});
     }
     await d1.prepare('DELETE FROM circle_points WHERE fid = ?').bind(targetFid).run().catch(() => {});
     await d1.prepare('DELETE FROM transit_relay WHERE sender_id = ? OR peer_id = ? OR channel_id = ?').bind(targetFid, targetFid, `DM_${targetFid}`).run().catch(() => {});
    }
    await persistSystemMeta(env, ctx);
    return new Response(JSON.stringify({
     ok: true,
     deleted: targetFid,
     totalUsers: usersRegistryStore.size
    }), {
     headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
    });
   } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'Bad request' }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
   }
  }

  // ── Поиск собеседника по Логину или Fisher ID (/auth/resolve-peer?query=...) ──
  if (reqUrl.pathname.endsWith('/auth/resolve-peer') && request.method === 'GET') {
   await ensurePersistentStateLoaded(env);
   const q = String(reqUrl.searchParams.get('query') || '').trim();
   if (!q) {
    return new Response(JSON.stringify({ ok: false, found: false }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
   }
   const norm = q.toLowerCase().replace(/^@/, '');
   if (norm === 'admin' || norm === 'админ' || workerIsOwnerLogin(q)) {
    return new Response(JSON.stringify({
     ok: true,
     found: true,
     fisherId: OWNER_FISHER_ID,
     callsign: '👑 Админ',
     login: 'admin',
     isAdmin: true,
     isOwner: true
    }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
   }
   if (/^FP_/i.test(q)) {
    const fid = workerNormalizeFisherId(q, '89');
    const u = usersRegistryStore.get(fid);
    return new Response(JSON.stringify({
     ok: true,
     found: Boolean(u || fid),
     fisherId: fid,
     callsign: u ? (u.callsign || u.login || fid) : fid,
     login: u ? (u.login || '') : '',
     tgUsername: u ? (u.tgUsername || '') : '',
     regionCode: u ? (u.regionCode || '89') : '89'
    }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
   }
   const aKey = loginToAuthKeyMap.get(norm);
   const prof = aKey ? cloudAuthProfiles.get(aKey) : null;
   if (prof && prof.fisherId) {
    return new Response(JSON.stringify({
     ok: true,
     found: true,
     fisherId: prof.fisherId,
     callsign: prof.callsign || prof.login || norm,
     login: prof.login || norm,
     tgUsername: prof.tgUsername || '',
     regionCode: prof.regionCode || '89'
    }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
   }
   for (const u of usersRegistryStore.values()) {
    if (u && (workerNormalizeLogin(u.login) === norm || workerNormalizeLogin(u.callsign) === norm || workerNormalizeLogin(u.tgUsername) === norm)) {
     return new Response(JSON.stringify({
      ok: true,
      found: true,
      fisherId: u.fisherId,
      callsign: u.callsign || u.login || norm,
      login: u.login || '',
      tgUsername: u.tgUsername || '',
      regionCode: u.regionCode || '89'
     }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
    }
   }
   return new Response(JSON.stringify({ ok: true, found: false }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
  }

  if (reqUrl.pathname.endsWith('/api/admin/users') && (request.method === 'GET' || request.method === 'POST')) {
   if (!checkWorkerRateLimit(`admusers_${clientIp}`, false, 30)) {
    return new Response(JSON.stringify({ ok: false, error: 'Rate limit' }), { status: 429, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
   }
   await ensurePersistentStateLoaded(env, true);
   let b = {};
   if (request.method === 'POST') {
    try {
     b = await readWorkerRequestPayload(request, reqUrl);
    } catch (e) {}
   }
   const tok = extractAdminTokenFromRequest(request, reqUrl, b);
   if (!isValidOwnerAdminToken(tok, env)) {
    return new Response(JSON.stringify({ ok: false, error: 'Not found' }), { status: 404, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
   }
   purgeExpiredServerCirclePoints();

   await pruneExpiredTemporaryUsers(env);
   const d1Info = getD1(env);
   const d1 = d1Info?.db;
   if (d1) {
    try {
     const rows = await d1.prepare('SELECT payload FROM users_registry ORDER BY last_seen DESC LIMIT 5000').all();
     if (rows && Array.isArray(rows.results)) {
      for (const r of rows.results) {
       const u = workerSafeJsonParse(r.payload, null);
       if (u && u.fisherId) {
        if (deletedFisherIdsSet.has(u.fisherId) && !isOwnerFisherId(u.fisherId)) continue;
        if (isTemporaryReserveId(u.fisherId) && (Date.now() - Number(u.firstSeen || u.lastSeen || 0)) > RESERVE_ID_TTL_MS) continue;
        usersRegistryStore.set(u.fisherId, u);
        if (!isTemporaryReserveId(u.fisherId)) reservedVanityIds.add(u.fisherId);
        if (u.deviceId && (!deviceToFisherIdMap.has(u.deviceId) || !isTemporaryReserveId(u.fisherId))) {
         deviceToFisherIdMap.set(u.deviceId, u.fisherId);
        }
        if (u.tgId) tgToFisherIdMap.set(String(u.tgId), u.fisherId);
       }
      }
     }
     await pruneExpiredTemporaryUsers(env);
    } catch (e) {
     console.error('[Admin users D1 query error]', e);
    }
   }

   return new Response(JSON.stringify({
    ok: true,
    version: WORKER_VERSION,
    d1Status: d1Info ? 'CONNECTED' : 'DISCONNECTED',
    d1BindingName: d1Info ? d1Info.name : null,
    ownerId: OWNER_FISHER_ID,
    ownerSecondaryId: OWNER_SECONDARY_ID,
    ownerIds: [OWNER_FISHER_ID, OWNER_SECONDARY_ID],
    totalUsers: usersRegistryStore.size,
    users: Array.from(usersRegistryStore.values()),
    points: Array.from(circlePointsStore.values()),
    whitelist: Array.from(adminWhitelistStore.values()),
    counters: Object.fromEntries(regionSequenceCounters.entries()),
    reserveCounters: Object.fromEntries(regionReserveCounters.entries())
   }), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
   });
  }

  
function generateSyntheticWeatherJson(lat, lon) {
 const now = new Date();
 const hourlyTimes = [];
 const hourlyTemps = [];
 const hourlyPress = [];
 const hourlyWind = [];
 const hourlyWindDir = [];
 const hourlyClouds = [];
 const hourlyPrecip = [];

 const nLat = Number(lat) || 66.1;
 const nLon = Number(lon) || 76.6;
 const baseTemp = (nLat > 64) ? -4.2 : 5.8;
 const basePress = 754;

 for (let d = -7; d <= 9; d++) {
  for (let h = 0; h < 24; h++) {
   const dt = new Date(now.getTime() + (d * 24 + h) * 3600000);
   hourlyTimes.push(dt.toISOString().slice(0, 16));
   const dayCycle = Math.sin((h - 8) / 24 * Math.PI * 2) * 3.5;
   hourlyTemps.push(Math.round((baseTemp + dayCycle) * 10) / 10);
   hourlyPress.push(Math.round(basePress + Math.sin(d + h / 6) * 4));
   hourlyWind.push(Math.max(1, Math.round((3.2 + Math.cos(h / 4) * 2.1) * 10) / 10));
   hourlyWindDir.push(220 + (h * 5) % 80);
   hourlyClouds.push(45 + (h * 3) % 40);
   hourlyPrecip.push(0);
  }
 }

 const dailyTimes = [];
 const dailyMaxTemps = [];
 const dailyMinTemps = [];
 const dailySunrise = [];
 const dailySunset = [];
 const dailyMaxWind = [];
 const dailyDomWindDir = [];

 for (let d = -7; d <= 9; d++) {
  const dt = new Date(now.getTime() + d * 86400000);
  const dateStr = dt.toISOString().slice(0, 10);
  dailyTimes.push(dateStr);
  dailyMaxTemps.push(Math.round((baseTemp + 3.5) * 10) / 10);
  dailyMinTemps.push(Math.round((baseTemp - 4.5) * 10) / 10);
  dailySunrise.push(`${dateStr}T07:15`);
  dailySunset.push(`${dateStr}T17:45`);
  dailyMaxWind.push(5.8);
  dailyDomWindDir.push(240);
 }

 return JSON.stringify({
  latitude: nLat,
  longitude: nLon,
  generationtime_ms: 0.5,
  utc_offset_seconds: 18000,
  timezone: 'Asia/Yekaterinburg',
  elevation: 35.0,
  hourly_units: {
   time: 'iso8601',
   temperature_2m: '°C',
   surface_pressure: 'hPa',
   wind_speed_10m: 'm/s',
   wind_direction_10m: '°',
   cloud_cover: '%',
   precipitation: 'mm'
  },
  hourly: {
   time: hourlyTimes,
   temperature_2m: hourlyTemps,
   surface_pressure: hourlyPress,
   wind_speed_10m: hourlyWind,
   wind_direction_10m: hourlyWindDir,
   cloud_cover: hourlyClouds,
   precipitation: hourlyPrecip
  },
  daily_units: {
   time: 'iso8601',
   temperature_2m_max: '°C',
   temperature_2m_min: '°C',
   sunrise: 'iso8601',
   sunset: 'iso8601',
   wind_speed_10m_max: 'm/s',
   wind_direction_10m_dominant: '°'
  },
  daily: {
   time: dailyTimes,
   temperature_2m_max: dailyMaxTemps,
   temperature_2m_min: dailyMinTemps,
   sunrise: dailySunrise,
   sunset: dailySunset,
   wind_speed_10m_max: dailyMaxWind,
   wind_direction_10m_dominant: dailyDomWindDir
  },
  _synthetic: true
 });
}

// ── 1. Эндпоинт 10-км гео-сетки погоды (/weather?lat=...&lon=...) с двойным кэшем и защитой от 502/сбоев ──
  if (reqUrl.pathname.endsWith('/weather') && request.method === 'GET') {
   const rawLat = parseFloat(reqUrl.searchParams.get('lat') || '66.1');
   const rawLon = parseFloat(reqUrl.searchParams.get('lon') || '76.6');
   const gLat = (Math.round((Number.isFinite(rawLat) ? Math.max(-85, Math.min(85, rawLat)) : 66.1) * 10) / 10).toFixed(1);
   const gLon = (Math.round((Number.isFinite(rawLon) ? Math.max(-180, Math.min(180, rawLon)) : 76.6) * 10) / 10).toFixed(1);
   const gridKey = `${gLat}_${gLon}`;
   const now = Date.now();

   // 1. Проверяем оперативный кэш в памяти инстанса
   const memHit = weatherFullGridCache.get(gridKey);
   if (memHit && now - memHit.ts < 1800000) {
    return new Response(memHit.rawJson, {
     headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json;charset=utf-8',
      'Cache-Control': 'public, max-age=1800, s-maxage=1800',
      'X-Klev-Grid': gridKey,
      'X-Klev-Cache': 'HIT-MEM'
     }
    });
   }

   // 2. Проверяем краевой кэш Cloudflare Edge
   const cacheKeyUrl = `${reqUrl.origin}/weather?grid=${gridKey}`;
   const edgeCache = (typeof caches !== 'undefined' && caches.default) ? caches.default : null;
   if (edgeCache) {
    try {
     const edgeHit = await edgeCache.match(cacheKeyUrl);
     if (edgeHit) {
      const bodyTxt = await edgeHit.text();
      weatherFullGridCache.set(gridKey, { ts: now, rawJson: bodyTxt });
      return new Response(bodyTxt, {
       headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json;charset=utf-8',
        'Cache-Control': 'public, max-age=1800, s-maxage=1800',
        'X-Klev-Grid': gridKey,
        'X-Klev-Cache': 'HIT-EDGE'
       }
      });
     }
    } catch (e) {}
   }

   let weatherPayload = null;

   // 3. Запрос к Open-Meteo с таймаутом
   try {
    const omUrl = `https://api.open-meteo.com/v1/forecast?latitude=${gLat}&longitude=${gLon}&past_days=7&hourly=temperature_2m,surface_pressure,wind_speed_10m,wind_direction_10m,cloud_cover,precipitation&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,wind_speed_10m_max,wind_direction_10m_dominant&forecast_days=10&wind_speed_unit=ms&timezone=auto`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4500);
    const upstreamRes = await fetch(omUrl, {
     headers: { 'User-Agent': 'KlevProClubBot/2.5.1 (https://klevpro.ru)' },
     signal: controller.signal,
     cf: { cacheTtl: 1800, cacheEverything: true }
    }).catch(() => null);
    clearTimeout(timeoutId);

    if (upstreamRes && upstreamRes.ok) {
     weatherPayload = await upstreamRes.text();
    }
   } catch (e) {}

   // 4. Если Open-Meteo недоступен или заблокирован — резервная метеомодель MET.no
   if (!weatherPayload) {
    try {
     const metUrl = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${gLat}&lon=${gLon}`;
     const metRes = await fetch(metUrl, {
      headers: { 'User-Agent': 'KlevProClubBot/2.5.1 (https://klevpro.ru, i@athor.ru)' }
     }).catch(() => null);
     if (metRes && metRes.ok) {
      const metJson = await metRes.json();
      if (metJson && metJson.properties && Array.isArray(metJson.properties.timeseries)) {
       // Преобразуем MET.no в стандартный формат Open-Meteo
       const ts = metJson.properties.timeseries;
       const hourlyTimes = [];
       const hourlyTemps = [];
       const hourlyPress = [];
       const hourlyWind = [];
       const hourlyWindDir = [];
       const hourlyClouds = [];
       const hourlyPrecip = [];

       for (const item of ts.slice(0, 168)) {
        hourlyTimes.push(item.time.slice(0, 16));
        const inst = item.data?.instant?.details || {};
        hourlyTemps.push(inst.air_temperature ?? 0);
        hourlyPress.push(Math.round((inst.air_pressure_at_sea_level ?? 1013) * 0.75006));
        hourlyWind.push(inst.wind_speed ?? 3);
        hourlyWindDir.push(inst.wind_from_direction ?? 180);
        hourlyClouds.push(inst.cloud_area_fraction ?? 50);
        hourlyPrecip.push(item.data?.next_1_hours?.details?.precipitation_amount ?? 0);
       }

       weatherPayload = JSON.stringify({
        latitude: parseFloat(gLat),
        longitude: parseFloat(gLon),
        hourly: {
         time: hourlyTimes,
         temperature_2m: hourlyTemps,
         surface_pressure: hourlyPress,
         wind_speed_10m: hourlyWind,
         wind_direction_10m: hourlyWindDir,
         cloud_cover: hourlyClouds,
         precipitation: hourlyPrecip
        },
        daily: {
         time: [new Date().toISOString().slice(0, 10)],
         temperature_2m_max: [Math.max(...hourlyTemps.slice(0, 24))],
         temperature_2m_min: [Math.min(...hourlyTemps.slice(0, 24))],
         wind_speed_10m_max: [Math.max(...hourlyWind.slice(0, 24))],
         wind_direction_10m_dominant: [220]
        },
        _source: 'met_no_bridge'
       });
      }
     }
    } catch (e) {}
   }

   // 5. Защитный шлюз $0: если оба апстрима не ответили — возвращаем безопасную сезонную синтетическую модель с HTTP 200 (НИКОГДА НЕ 502!)
   if (!weatherPayload) {
    weatherPayload = generateSyntheticWeatherJson(gLat, gLon);
   }

   if (weatherFullGridCache.size > 600) {
    const oldest = weatherFullGridCache.keys().next().value;
    if (oldest) weatherFullGridCache.delete(oldest);
   }
   weatherFullGridCache.set(gridKey, { ts: now, rawJson: weatherPayload });

   const responseHeaders = {
    ...CORS_HEADERS,
    'Content-Type': 'application/json;charset=utf-8',
    'Cache-Control': 'public, max-age=1800, s-maxage=1800',
    'X-Klev-Grid': gridKey,
    'X-Klev-Cache': 'SERVED-200'
   };

   if (edgeCache) {
    const cacheResp = new Response(weatherPayload, { headers: responseHeaders });
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(edgeCache.put(cacheKeyUrl, cacheResp).catch(() => {}));
    else await edgeCache.put(cacheKeyUrl, cacheResp).catch(() => {});
   }
   return new Response(weatherPayload, { headers: responseHeaders });
  }

  // ── 2. Серверное выделение ID (/api/id/allocate): без регистрации выдаёт временный резерв FP_XXRZYYYY, а при наличии валидного токена логина+пароля возвращает постоянный ID FP_XXAAA001 ──
  if (reqUrl.pathname.endsWith('/api/id/allocate') && (request.method === 'POST' || reqUrl.searchParams.has('payload'))) {
   if (!checkWorkerRateLimit(`alloc_${clientIp}`, false, 30)) {
    return new Response(JSON.stringify({ ok: false, error: 'Rate limit' }), { status: 429, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
   }
   try {
    await ensurePersistentStateLoaded(env);
    const body = await readWorkerRequestPayload(request, reqUrl);
    const deviceId = String(body.deviceId || '').trim().slice(0, 80);
    const cfHint = (request.cf && (request.cf.region || request.cf.city)) ? `${request.cf.region || ''} ${request.cf.city || ''}` : '';
    const regionSource = (body.hasUserLocation === false && cfHint)
     ? cfHint
     : (body.regionCode || body.locAdmin1 || body.locLabel || cfHint || '89');
    const regCode = workerResolveRegionCode(regionSource);
    const regionConfirmed = Boolean(body.hasUserLocation || body.regionConfirmed);
    const reqCurId = workerNormalizeFisherId(body.currentFisherId || '', regCode);
    const reqLoginNorm = String(body.login || '').trim().toLowerCase().replace(/^@/, '');
    const reqAuthToken = String(body.authTokenHash || '').trim();

    // 1. Проверяем, авторизован ли Владелец (iAthor / iAthor82 + токен пароля [REDACTED_OWNER_SECRET])
    const isVerifiedOwner = (
     (reqLoginNorm === 'iathor' || reqLoginNorm === 'iathor82' || reqLoginNorm === 'thorantony82' || isOwnerFisherId(reqCurId)) &&
     isValidOwnerAdminToken(reqAuthToken)
    );
    if (isVerifiedOwner) {
     const ownerFid = reqCurId === OWNER_SECONDARY_ID ? OWNER_SECONDARY_ID : OWNER_FISHER_ID;
     const ownerRecord = upsertUserInRegistry({
      fisherId: ownerFid,
      deviceId,
      login: 'iAthor',
      callsign: 'iAthor',
      tgId: body.tgId || '',
      tgUsername: body.tgUsername || '',
      regionCode: '89',
      locLabel: body.locLabel || 'Новый Уренгой',
      platform: body.platform || 'WEB',
      version: body.version || WORKER_VERSION,
      lat: body.lat,
      lon: body.lon,
      incrementSession: true
     });
     await d1SaveUser(env, ownerRecord);
     await persistSystemMeta(env, ctx);
     return new Response(JSON.stringify({
      ok: true,
      fisherId: ownerFid,
      ownerIds: [OWNER_FISHER_ID, OWNER_SECONDARY_ID],
      isTemporaryReserve: false,
      isRegistered: true,
      regionCode: '89',
      isOwner: true,
      tgId: ownerRecord?.tgId || '',
      tgUsername: ownerRecord?.tgUsername || '',
      login: 'iAthor',
      user: sanitizePublicUserResponse(ownerRecord, false)
     }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
    }

    // 2. Проверяем, зарегистрирован ли рыбак (валидная связка Логин + Пароль в cloudAuthProfiles)
    let verifiedPermanentId = '';
    let verifiedProf = null;
    if (reqLoginNorm && reqAuthToken.startsWith('KTOK_')) {
     const aKey = loginToAuthKeyMap.get(reqLoginNorm) || `AUTH_${reqLoginNorm}_${reqAuthToken}`;
     const prof = await loadPersistedAuthProfile(env, aKey, reqLoginNorm, reqCurId);
     if (prof && prof.authTokenHash && constantTimeEquals(reqAuthToken, prof.authTokenHash) && prof.fisherId && !isTemporaryReserveId(prof.fisherId)) {
      verifiedPermanentId = workerNormalizeFisherId(prof.fisherId, regCode);
      verifiedProf = prof;
     }
    }

    if (verifiedPermanentId) {
     const userRecord = upsertUserInRegistry({
      fisherId: verifiedPermanentId,
      deviceId,
      login: verifiedProf.login || body.login || '',
      callsign: verifiedProf.callsign || body.callsign || verifiedProf.login || 'Рыболов',
      tgId: verifiedProf.tgLinkedId || body.tgId || '',
      tgUsername: verifiedProf.tgUsername || body.tgUsername || '',
      regionCode: verifiedPermanentId.slice(3, 5) || regCode,
      regionConfirmed: true,
      profileBackup: body.profileBackup || null,
      locLabel: body.locLabel || verifiedProf.locLabel || 'Водоём РФ',
      platform: body.platform || 'WEB',
      version: body.version || WORKER_VERSION,
      lat: body.lat,
      lon: body.lon,
      incrementSession: true
     });
     await d1SaveUser(env, userRecord);
     await persistSystemMeta(env, ctx);
     return new Response(JSON.stringify({
      ok: true,
      fisherId: verifiedPermanentId,
      isTemporaryReserve: false,
      isRegistered: true,
      regionCode: verifiedPermanentId.slice(3, 5) || regCode,
      tgId: userRecord?.tgId || '',
      tgUsername: userRecord?.tgUsername || '',
      login: userRecord?.login || '',
      user: sanitizePublicUserResponse(userRecord, false)
     }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
    }

    // 3. Пользователь НЕ зарегистрировал логин и пароль -> выдаём строго 1 ВРЕМЕННЫЙ РЕЗЕРВНЫЙ ID (FP_XXRZYYYY) на 24 часа для этого устройства (независимо от переключения точек на карте!)
    await pruneExpiredTemporaryUsers(env);
    let tempReserveId = '';
    if (deviceId && deviceToFisherIdMap.has(deviceId)) {
     const bound = deviceToFisherIdMap.get(deviceId);
     if (bound && isTemporaryReserveId(bound) && !deletedFisherIdsSet.has(bound)) {
      const exBound = usersRegistryStore.get(bound);
      const ageMs = exBound ? (Date.now() - Number(exBound.firstSeen || exBound.lastSeen || Date.now())) : 0;
      if (ageMs <= RESERVE_ID_TTL_MS) {
       tempReserveId = bound;
      } else {
       usersRegistryStore.delete(bound);
       deviceToFisherIdMap.delete(deviceId);
      }
     }
    }
    if (!tempReserveId && reqCurId && isTemporaryReserveId(reqCurId) && !deletedFisherIdsSet.has(reqCurId)) {
     const exRec = usersRegistryStore.get(reqCurId);
     const ageMs = exRec ? (Date.now() - Number(exRec.firstSeen || exRec.lastSeen || Date.now())) : 0;
     if ((!exRec || !exRec.deviceId || exRec.deviceId === deviceId) && ageMs <= RESERVE_ID_TTL_MS) {
      tempReserveId = reqCurId;
     }
    }
    if (!tempReserveId) {
     tempReserveId = allocateNextReserveFisherId(regCode, deviceId);
     deletedFisherIdsSet.delete(tempReserveId);
    }
    if (deviceId) {
     // Удаляем любые старые дубли резервных ID этого же устройства из RAM и D1
     for (const [uid, uObj] of usersRegistryStore.entries()) {
      if (uid !== tempReserveId && uObj && uObj.deviceId === deviceId && isTemporaryReserveId(uid)) {
       usersRegistryStore.delete(uid);
       const d1Clean = getD1(env)?.db;
       if (d1Clean) d1Clean.prepare('DELETE FROM users_registry WHERE fisher_id = ?').bind(uid).run().catch(() => {});
      }
     }
     deviceToFisherIdMap.set(deviceId, tempReserveId);
    }

    const tempRecord = upsertUserInRegistry({
     fisherId: tempReserveId,
     deviceId,
     login: '',
     callsign: body.callsign || 'Гость (Резерв)',
     tgId: '',
     tgUsername: '',
     regionCode: regCode,
     regionConfirmed,
     locLabel: body.locLabel || 'Водоём РФ',
     platform: body.platform || 'WEB',
     version: body.version || WORKER_VERSION,
     lat: body.lat,
     lon: body.lon,
     incrementSession: true
    });

    await d1SaveUser(env, tempRecord);
    await persistSystemMeta(env, ctx);

    return new Response(JSON.stringify({
     ok: true,
     fisherId: tempReserveId,
     isTemporaryReserve: true,
     isRegistered: false,
     regionCode: regCode,
     tgId: '',
     tgUsername: '',
     login: '',
     user: sanitizePublicUserResponse(tempRecord, false)
    }), {
     headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
    });
   } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'Allocation error' }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
   }
  }

  // ── 2b. Двухэтапная связка автономного ID рыбака (FP_89...) и единого профиля с аккаунтом Telegram (/api/tg/bind) ──
  if (reqUrl.pathname.endsWith('/api/tg/bind')) {
   await ensurePersistentStateLoaded(env);
   if (request.method === 'GET' && !reqUrl.searchParams.has('payload')) {
    const qFid = workerNormalizeFisherId(reqUrl.searchParams.get('fid') || '', '89');
    const qDev = String(reqUrl.searchParams.get('deviceId') || '').trim();
    const qTg = String(reqUrl.searchParams.get('tgId') || '').trim();
    const qLoginRaw = String(reqUrl.searchParams.get('login') || '').trim();
    const isOwnerReq = workerIsOwnerLogin(qLoginRaw) || isOwnerFisherId(qFid);
    let effFid = qFid || (qTg ? tgToFisherIdMap.get(qTg) : '') || (qDev ? deviceToFisherIdMap.get(qDev) : '') || '';
    if (isOwnerReq && !effFid) effFid = OWNER_FISHER_ID;
    let u = effFid ? usersRegistryStore.get(effFid) : null;
    if (!u && isOwnerReq) {
     u = {
      fisherId: OWNER_FISHER_ID,
      login: 'iAthor',
      tgUsername: 'thorantony82',
      tgId: tgToFisherIdMap.get('owner_tg') || ''
     };
    }
    const isBound = Boolean(u && (u.tgId || u.tgUsername || isOwnerReq));
    return new Response(JSON.stringify({
     ok: true,
     bound: isBound,
     fisherId: u?.fisherId || effFid || (isOwnerReq ? OWNER_FISHER_ID : ''),
     tgId: u?.tgId || (isOwnerReq ? 'owner_tg' : ''),
     tgUsername: u?.tgUsername || (isOwnerReq ? 'thorantony82' : ''),
     login: u?.login || (isOwnerReq ? 'iAthor' : '')
    }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
   }
   if (request.method === 'POST' || reqUrl.searchParams.has('payload')) {
    if (!checkWorkerRateLimit(`tgbind_${clientIp}`, false, 20)) {
     return new Response(JSON.stringify({ ok: false, error: 'Rate limit' }), { status: 429, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }
    try {
     const body = await readWorkerRequestPayload(request, reqUrl);
     if (body.initData && BOT_TOKEN) {
      const validInit = await verifyTelegramWebAppInitData(body.initData, BOT_TOKEN);
      if (!validInit) {
       return new Response(JSON.stringify({ ok: false, error: 'Invalid Telegram initData signature' }), { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
      }
     }
     const rec = bindTelegramToFisherProfile({
      fisherId: body.fisherId || '',
      deviceId: body.deviceId || '',
      login: body.login || '',
      tgId: body.tgId || '',
      tgUsername: body.tgUsername || '',
      tgFirstName: body.tgFirstName || '',
      locLabel: body.locLabel || 'Новый Уренгой'
     });
     await persistSystemMeta(env, ctx);
     return new Response(JSON.stringify({
      ok: true,
      bound: Boolean(rec && rec.tgId),
      fisherId: rec?.fisherId || body.fisherId || '',
      tgId: rec?.tgId || '',
      tgUsername: rec?.tgUsername || '',
      login: rec?.login || '',
      user: sanitizePublicUserResponse(rec, false)
     }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
    } catch (e) {
     return new Response(JSON.stringify({ ok: false, error: 'Bind error' }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }
   }
  }

  // ── 3. Реальный обмен точками Круга, Экипажа, SOS и Мастерской между всеми устройствами (/api/circle/publish, /api/circle/nearby, /api/circle/delete) ──
  if (reqUrl.pathname.endsWith('/api/circle/publish') && (request.method === 'POST' || reqUrl.searchParams.has('payload'))) {
   if (!checkWorkerRateLimit(`pub_${clientIp}`, false, 35)) {
    return new Response(JSON.stringify({ ok: false, error: 'Rate limit' }), { status: 429, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
   }
   try {
    await ensurePersistentStateLoaded(env);
    purgeExpiredServerCirclePoints();
    const body = await readWorkerRequestPayload(request, reqUrl);
    const rawItem = workerSanitizeObject(body.item || body);
    if (!rawItem || !rawItem.t) {
     return new Response(JSON.stringify({ ok: false, error: 'Invalid circle item' }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }
    const now = Date.now();
    const fid = workerNormalizeFisherId(rawItem.fid || body.fid || '', rawItem.locAdmin1 || rawItem.lb || '89');
    if (!fid || isTemporaryReserveId(fid)) {
     return new Response(JSON.stringify({
      ok: false,
      code: 'REGISTRATION_REQUIRED',
      error: 'Сначала зарегистрируйте логин и пароль, чтобы получить постоянный ID рыбака и отправлять точки!'
     }), { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
    }
    const pubAuth = await verifyUserAuth(env, {
     fid,
     authTokenHash: body.authTokenHash || '',
     deviceId: rawItem.did || body.deviceId || '',
     adminToken: body.adminToken || '',
     request
    });
    if (!pubAuth.ok) {
     return new Response(JSON.stringify({ ok: false, error: 'Forbidden: unverified fisher identity' }), { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
    }
    const dedupKey = `pub_${fid}_${rawItem.t}_${rawItem.fi || ''}_${Math.round(clampLat(rawItem.lat) * 100)}_${Math.round(clampLon(rawItem.lon) * 100)}`;
    if (isDuplicateRecentAction(dedupKey, 5000) && circlePointsStore.has(String(rawItem.id || ''))) {
     const exPt = circlePointsStore.get(String(rawItem.id || ''));
     return new Response(JSON.stringify({ ok: true, id: exPt.id, item: exPt, deduplicated: true, totalActivePoints: circlePointsStore.size }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
    }
    const cleanItem = {
     id: String(rawItem.id || `cir_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`).slice(0, 64),
     t: ['circle', 'crew', 'workshop'].includes(rawItem.t) ? rawItem.t : 'circle',
     sos: Boolean(rawItem.sos),
     fid,
     did: String(rawItem.did || body.deviceId || '').slice(0, 80),
     au: String(rawItem.au || 'Рыболов').slice(0, 48),
     rk: String(rawItem.rk || 'angler').slice(0, 20),
     rw_w: Number(rawItem.rw_w) || 1,
     fi: String(rawItem.fi || 'pike').slice(0, 32),
     fn: String(rawItem.fn || 'Рыба').slice(0, 48),
     wt: String(rawItem.wt || 'small_river').slice(0, 32),
     wn: String(rawItem.wn || rawItem.lb || 'Водоём').slice(0, 80),
     lb: String(rawItem.lb || rawItem.wn || 'Водоём').slice(0, 80),
     mt: String(rawItem.mt || 'spin_light').slice(0, 32),
     bt: String(rawItem.bt || '').slice(0, 80),
     nt: String(rawItem.nt || '').slice(0, 240),
     lat: clampLat(rawItem.lat, 66.0833),
     lon: clampLon(rawItem.lon, 76.6333),
     dp: Number.isFinite(Number(rawItem.dp)) ? Number(rawItem.dp) : 2.5,
     tw: Number.isFinite(Number(rawItem.tw)) ? Number(rawItem.tw) : 8,
     ta: Number.isFinite(Number(rawItem.ta)) ? Number(rawItem.ta) : 10,
     pr: Number.isFinite(Number(rawItem.pr)) ? Number(rawItem.pr) : 754,
     wd: Number.isFinite(Number(rawItem.wd)) ? Number(rawItem.wd) : 3,
     sc: Number.isFinite(Number(rawItem.sc)) ? Number(rawItem.sc) : 75,
     kg: Number.isFinite(Number(rawItem.kg)) ? Number(rawItem.kg) : 0,
     crewKey: String(rawItem.crewKey || '').toUpperCase().slice(0, 16),
     rw: String(rawItem.rw || '').slice(0, 140),
     rl: String(rawItem.rl || '').slice(0, 120),
     rt: String(rawItem.rt || '').slice(0, 120),
     fl: String(rawItem.fl || '').slice(0, 48),
     twMin: Number.isFinite(Number(rawItem.twMin)) ? Number(rawItem.twMin) : 4,
     twMax: Number.isFinite(Number(rawItem.twMax)) ? Number(rawItem.twMax) : 18,
     packToken: String(body.packToken || rawItem.packToken || '').slice(0, 512),
     ca: Number(rawItem.ca) > 0 ? Number(rawItem.ca) : now,
     ea: Number(rawItem.ea) > now ? Math.min(Number(rawItem.ea), now + 72 * 3600000) : (now + 72 * 3600000)
    };

    circlePointsStore.set(cleanItem.id, cleanItem);

    await d1SavePoint(env, cleanItem);

    upsertUserInRegistry({
     fisherId: fid,
     deviceId: cleanItem.did,
     callsign: cleanItem.au,
     locLabel: cleanItem.lb,
     platform: body.platform || 'WEB',
     version: body.version || WORKER_VERSION,
     lat: cleanItem.lat,
     lon: cleanItem.lon,
     incrementPosts: true
    });

    await persistSystemMeta(env, ctx);

    return new Response(JSON.stringify({
     ok: true,
     id: cleanItem.id,
     item: cleanItem,
     totalActivePoints: circlePointsStore.size
    }), {
     headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
    });
   } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'Publish failed' }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
   }
  }

  if (reqUrl.pathname.endsWith('/api/circle/nearby') && request.method === 'GET') {
   await ensurePersistentStateLoaded(env);
   purgeExpiredServerCirclePoints();

   const d1Info = getD1(env);
   const d1 = d1Info?.db;
   if (d1) {
    try {
     const nowMs = Date.now();
     const ptRows = await d1.prepare('SELECT payload FROM circle_points WHERE ea > ? ORDER BY ca DESC LIMIT 300').bind(nowMs).all();
     if (ptRows && Array.isArray(ptRows.results)) {
      const d1PointIds = new Set();
      for (const r of ptRows.results) {
       const pt = workerSafeJsonParse(r.payload, null);
       if (pt && pt.id) {
        d1PointIds.add(pt.id);
        circlePointsStore.set(pt.id, pt);
       }
      }
      for (const [memId, memPt] of circlePointsStore.entries()) {
       if (!d1PointIds.has(memId) && (!memPt || (nowMs - (memPt.ca || 0)) > 15000)) {
        circlePointsStore.delete(memId);
       }
      }
     }
    } catch (e) {}
   }
   const lat = clampLat(reqUrl.searchParams.get('lat'), 66.0833);
   const lon = clampLon(reqUrl.searchParams.get('lon'), 76.6333);
   const radiusKm = Math.max(10, Math.min(500, parseFloat(reqUrl.searchParams.get('radius') || '120') || 120));
   const viewerFid = workerNormalizeFisherId(reqUrl.searchParams.get('fid') || '', '89');
   const viewerDevId = String(reqUrl.searchParams.get('deviceId') || '').trim();
   const viewerAuthTok = String(reqUrl.searchParams.get('authTokenHash') || '').trim();
   const crewKeysSet = new Set(
    String(reqUrl.searchParams.get('crewKeys') || '')
     .split(',')
     .map(k => k.trim().toUpperCase())
     .filter(Boolean)
   );
   const adminTok = extractAdminTokenFromRequest(request, reqUrl, null);
   const nearbyAuth = await verifyUserAuth(env, {
    fid: viewerFid,
    authTokenHash: viewerAuthTok,
    deviceId: viewerDevId,
    adminToken: adminTok,
    request
   });
   const isViewerAdmin = Boolean(
    nearbyAuth.isAdmin ||
    isValidOwnerAdminToken(adminTok, env) ||
    (nearbyAuth.ok && viewerFid && adminWhitelistStore.has(viewerFid))
   );

   if (viewerFid && !deletedFisherIdsSet.has(viewerFid) && (nearbyAuth.ok || (isTemporaryReserveId(viewerFid) && usersRegistryStore.has(viewerFid)))) {
    upsertUserInRegistry({
     fisherId: viewerFid,
     deviceId: viewerDevId,
     locLabel: reqUrl.searchParams.get('locLabel') || '',
     platform: reqUrl.searchParams.get('platform') || '',
     version: reqUrl.searchParams.get('version') || WORKER_VERSION,
     lat,
     lon
    });
    if (Date.now() - lastEdgePersistTs > 45000) {
     await persistSystemMeta(env, ctx);
    }
   }

   const results = [];
   for (const pt of circlePointsStore.values()) {
    if (!pt) continue;
    const isMine = (viewerFid && pt.fid === viewerFid && nearbyAuth.ok) || (viewerDevId && pt.did && pt.did === viewerDevId);
    if (pt.t === 'workshop') {
     results.push(pt);
     continue;
    }
    const dist = haversineKm(lat, lon, Number(pt.lat || 0), Number(pt.lon || 0));
    if (pt.t === 'crew' && pt.sos) {
     // Сигналы SOS на воде видны всем рыбакам в расширенном радиусе 250 км (или автору/админу везде)
     if (dist <= Math.max(radiusKm, 250) || isMine || isViewerAdmin) {
      results.push(pt);
     }
     continue;
    }
    if (pt.t === 'crew' && !pt.sos) {
     // Закрытые точки Экипажа видны только автору, участникам с ключом KP-XXXX или Супер-Админу (FP_89VIP089 / список админов)
     const hasKey = pt.crewKey && crewKeysSet.has(String(pt.crewKey).toUpperCase());
     if (isMine || hasKey || isViewerAdmin) {
      results.push(pt);
     }
     continue;
    }
    // Сводки Круга (±5 км) видны всем в радиусе поиска (по умолчанию 120 км)
    if (dist <= radiusKm || isMine || isViewerAdmin) {
     results.push(pt);
    }
   }

   results.sort((a, b) => (b.ca || 0) - (a.ca || 0));
   return new Response(JSON.stringify({
    ok: true,
    items: results.slice(0, 150),
    serverTime: Date.now()
   }), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
   });
  }

  if (reqUrl.pathname.endsWith('/api/circle/delete') && (request.method === 'POST' || reqUrl.searchParams.has('payload'))) {
   try {
    await ensurePersistentStateLoaded(env);
    const body = await readWorkerRequestPayload(request, reqUrl);
    const id = String(body.id || '').trim();
    const fid = workerNormalizeFisherId(body.fid || '', '89');
    const devId = String(body.deviceId || '').trim();
    const admTok = extractAdminTokenFromRequest(request, reqUrl, body);
    const isAdm = isValidOwnerAdminToken(admTok, env);
    const target = circlePointsStore.get(id);
    if (!target) {
     return new Response(JSON.stringify({ ok: true, deleted: false }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }
    const delAuth = await verifyUserAuth(env, {
     fid: target.fid,
     authTokenHash: body.authTokenHash || '',
     deviceId: devId,
     adminToken: admTok,
     request
    });
    const isVerifiedAuthor = (target.fid === fid && delAuth.ok) || Boolean(devId && target.did && target.did === devId);
    if (!isAdm && !isVerifiedAuthor) {
     return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }
    circlePointsStore.delete(id);
    await d1DeletePoint(env, id);
    const d1ForDel = getD1(env)?.db;
    if (d1ForDel) {
     await d1ForDel.prepare('DELETE FROM transit_relay WHERE kind = ? AND sender_id = ?').bind('pack', target.fid || fid).run().catch(() => {});
    }
    for (const [bKey, bList] of transitBoxes.entries()) {
     if (Array.isArray(bList)) {
      transitBoxes.set(bKey, bList.filter(p => p && !(p.kind === 'pack' && p.senderId === (target.fid || fid))));
     }
    }
    await persistSystemMeta(env, ctx);

    // Мгновенная трансляция удаления через транзитные боксы ретранслятора
    try {
     const gridKey = (target.lat && target.lon) ? `GRID_${Math.round(target.lat)}_${Math.round(target.lon)}` : 'GRID_66_77';
     const delBoxes = [gridKey, 'SOS_ALL'];
     if (target.crewKey) delBoxes.push(`CREW_${String(target.crewKey).toUpperCase()}`);
     for (const b of delBoxes) {
      const blist = transitBoxes.get(b) || [];
      blist.push({
       id: `del_${Date.now()}_${id}`,
       channelId: b,
       senderId: fid,
       kind: 'circle_del',
       targetId: id,
       ts: Date.now()
      });
      transitBoxes.set(b, blist.slice(-50));
     }
    } catch (e) {}

    return new Response(JSON.stringify({ ok: true, deleted: true, id }), {
     headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
    });
   } catch (e) {
    return new Response(JSON.stringify({ ok: false }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
   }
  }

  if (reqUrl.pathname.endsWith('/auth/check-login') && request.method === 'GET') {
   if (!checkWorkerRateLimit(`chklogin_${clientIp}`, false, 30)) {
    return new Response(JSON.stringify({ ok: false, available: false, error: 'Rate limit' }), { status: 429, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
   }
   await ensurePersistentStateLoaded(env);
   const rawL = String(reqUrl.searchParams.get('login') || '').trim();
   const normL = workerNormalizeLogin(rawL);
   const devId = String(reqUrl.searchParams.get('deviceId') || '').trim();
   if (!normL || normL.length < 2) {
    return new Response(JSON.stringify({ ok: false, available: false, reason: 'short' }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
   }
   if (workerIsOwnerLogin(rawL)) {
    return new Response(JSON.stringify({ ok: true, available: false, isOwnerLogin: true, message: 'Эксклюзивный логин Владельца (FP_89VIP089)' }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
   }
   const anonLoginChk = workerIsAnonymousCallsignValid(rawL);
   if (!anonLoginChk.ok) {
    return new Response(JSON.stringify({ ok: false, available: false, reason: 'pii_forbidden', error: anonLoginChk.error }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
   }
   await loadPersistedAuthProfile(env, '', normL, '');
   const aKey = loginToAuthKeyMap.get(normL);
   const prof = aKey ? cloudAuthProfiles.get(aKey) : null;
   const isMine = Boolean(prof && devId && prof.deviceId === devId);
   return new Response(JSON.stringify({
    ok: true,
    available: !aKey || isMine,
    isMine,
    fisherId: isMine ? prof.fisherId : undefined
   }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
  }

  if (reqUrl.pathname.endsWith('/auth/login') && (request.method === 'POST' || reqUrl.searchParams.has('payload'))) {
   if (!checkWorkerRateLimit(`auth_${clientIp}`, false, 15)) {
    return new Response(JSON.stringify({ ok: false, error: 'Too many login attempts' }), {
     status: 429,
     headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
    });
   }
   try {
    await ensurePersistentStateLoaded(env);
    const body = await readWorkerRequestPayload(request, reqUrl);
    const incomingSnap = pickAllowedProfileFields(workerSanitizeObject(body.profileSnapshot));
    const rawLoginClean = String(body.login || '').trim();
    const normLoginPre = workerNormalizeLogin(rawLoginClean);
    const normFidPre = /^FP_/i.test(rawLoginClean) ? workerNormalizeFisherId(rawLoginClean, '89') : '';
    const preCheckKey = normLoginPre ? `AUTH_${normLoginPre}_${body.authTokenHash && String(body.authTokenHash).startsWith('KTOK_') ? body.authTokenHash : workerDeriveAuthToken(rawLoginClean, body.password)}` : '';
    await loadPersistedAuthProfile(env, preCheckKey, normLoginPre, normFidPre);
    const ident = resolveWorkerAccountIdentity(body.login, body.password, body.authTokenHash, body.regionCode, incomingSnap);
    if (!ident.ok) {
     return new Response(JSON.stringify({ ok: false, error: ident.error || 'Укажите логин и пароль (от 3 символов)' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
     });
    }
    const existing = (await loadPersistedAuthProfile(env, ident.authKey)) || null;
    const regUser = usersRegistryStore.get(ident.fisherId) || null;
    const mergedTgId = String(incomingSnap.tgLinkedId || existing?.tgLinkedId || regUser?.tgId || '').trim();
    const mergedTgUser = String(incomingSnap.tgUsername || existing?.tgUsername || regUser?.tgUsername || '').trim().replace(/^@/, '');
    const secureTok = body.password ? await workerDeriveSecureAuthToken(ident.login, body.password, env) : (existing?.secureTokenHash || '');
    const merged = {
     ...pickAllowedProfileFields(existing || {}),
     ...incomingSnap,
     fisherId: ident.fisherId,
     login: ident.login,
     callsign: ident.isOwner ? 'iAthor' : ((existing && existing.callsign && existing.callsign !== 'Рыболов') ? existing.callsign : (incomingSnap.callsign || ident.callsign)),
     tgLinkedId: mergedTgId,
     tgUsername: mergedTgUser,
     pinHash: ident.pinHash,
     authTokenHash: ident.authTokenHash,
     secureTokenHash: secureTok,
     adminSessionToken: ident.isOwner ? getAdminConsoleToken(env) : '',
     ownerUnlocked: ident.isOwner ? true : Boolean(existing?.ownerUnlocked),
     isAdmin: ident.isOwner ? true : adminWhitelistStore.has(ident.fisherId),
     adminShowAllCrews: ident.isOwner ? (existing?.adminShowAllCrews ?? true) : Boolean(existing?.adminShowAllCrews),
     updatedAt: Date.now()
    };
    delete merged.authShadow;
    await persistAuthProfile(env, ident.authKey, merged, ctx);
    if (ident.isOwner) {
     adminWhitelistStore.set(OWNER_FISHER_ID, { id: OWNER_FISHER_ID, label: 'iAthor • Антон (Владелец / Супер-Админ)', addedAt: '2026-10-27' });
    }
    const resolvedRegCode = ident.isOwner
     ? '89'
     : (ident.fisherId.slice(3, 5) || workerResolveRegionCode(body.regionCode || incomingSnap.locAdmin1 || incomingSnap.locLabel || '89'));
    bindTelegramToFisherProfile({
     fisherId: ident.fisherId,
     deviceId: incomingSnap.deviceId || body.deviceId || '',
     login: ident.login,
     tgId: ident.isOwner ? mergedTgId : (workerIsOwnerLogin(mergedTgUser) ? '' : mergedTgId),
     tgUsername: ident.isOwner ? mergedTgUser : (workerIsOwnerLogin(mergedTgUser) ? '' : mergedTgUser),
     regionCode: resolvedRegCode,
     locLabel: incomingSnap.locLabel || 'Новый Уренгой'
    });
    const regRec = upsertUserInRegistry({
     fisherId: ident.fisherId,
     deviceId: incomingSnap.deviceId || body.deviceId || '',
     login: ident.login,
     callsign: merged.callsign,
     tgId: ident.isOwner ? mergedTgId : (workerIsOwnerLogin(mergedTgUser) ? '' : mergedTgId),
     tgUsername: ident.isOwner ? mergedTgUser : (workerIsOwnerLogin(mergedTgUser) ? '' : mergedTgUser),
     regionCode: resolvedRegCode,
     locLabel: incomingSnap.locLabel || 'Новый Уренгой',
     platform: body.platform || 'WEB',
     version: body.version || WORKER_VERSION,
     lat: incomingSnap.lat,
     lon: incomingSnap.lon,
     incrementSession: true
    });
    deletedFisherIdsSet.delete(ident.fisherId);
    const d1Login = getD1(env)?.db;
    if (d1Login && (incomingSnap.deviceId || body.deviceId)) {
     await d1Login.prepare('DELETE FROM users_registry WHERE device_id = ? AND is_temporary = 1').bind(incomingSnap.deviceId || body.deviceId).run().catch(() => {});
    }
    await d1SaveUser(env, regRec);
    await persistSystemMeta(env, ctx);
    return new Response(JSON.stringify({
     ok: true,
     found: Boolean(existing),
     isOwner: ident.isOwner,
     fisherId: ident.fisherId,
     login: ident.login,
     pinHash: ident.pinHash,
     adminSessionToken: ident.isOwner ? OWNER_ADMIN_CONSOLE_TOKEN : '',
     serverDynamicSlotHtml: ident.isOwner ? buildOwnerServerPortalSlotHtml(reqUrl.origin) : '',
     profile: merged,
     whitelist: Array.from(adminWhitelistStore.values())
    }), {
     headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
    });
   } catch (e) {
    console.error('[Worker Auth Error Caught]', e);
    // Защита Владельца: если вход совершает iAthor с паролем [REDACTED_OWNER_SECRET], авторизуем безоговорочно в памяти!
    let reqBody = null;
    try { reqBody = await readWorkerRequestPayload(request.clone(), reqUrl); } catch(err) {}
    const rawL = reqBody ? (reqBody.login || '') : '';
    const rawP = reqBody ? (reqBody.password || '') : '';
    const rawT = reqBody ? (reqBody.authTokenHash || '') : '';
    if (workerIsOwnerLogin(rawL) && (isOwnerPasswordMatch(rawP, env) || isValidOwnerAdminToken(rawT, env))) {
     const ownerFid = OWNER_FISHER_ID;
     adminWhitelistStore.set(ownerFid, { id: ownerFid, label: 'iAthor • Антон (Владелец / Супер-Админ)', addedAt: '2026-10-27' });
     adminWhitelistStore.set(OWNER_SECONDARY_ID, { id: OWNER_SECONDARY_ID, label: 'iAthor82 • Антон (Владелец / Спец-ID FP_FMP089)', addedAt: '2026-10-27' });
     const ownerProf = {
      fisherId: ownerFid,
      login: 'iAthor',
      callsign: 'iAthor',
      pinHash: 'owner_iathor_vip089',
      authTokenHash: OWNER_TOKEN_HASH_IATHOR,
      adminSessionToken: OWNER_ADMIN_CONSOLE_TOKEN,
      ownerUnlocked: true,
      isAdmin: true,
      adminShowAllCrews: true,
      appMode: 'pro',
      theme: 'auto',
      lat: 66.0833,
      lon: 76.6333,
      locLabel: 'Новый Уренгой',
      locAdmin1: 'Ямало-Ненецкий АО',
      locAdmin2: 'Новый Уренгой',
      water: 'small_river',
      method: 'spin_micro',
      favorites: ['pike', 'perch', 'burbot', 'peled', 'dace', 'chir', 'pizhyan', 'ide'],
      unlockedCrewKeys: [],
      notifSettings: { sos: true, crew: true, circle: true, workshop: true, dm: true, sound: true },
      updatedAt: Date.now()
     };
     usersRegistryStore.set(ownerFid, ownerProf);
     return new Response(JSON.stringify({
      ok: true,
      found: true,
      isOwner: true,
      fisherId: ownerFid,
      login: 'iAthor',
      pinHash: 'owner_iathor_vip089',
      adminSessionToken: OWNER_ADMIN_CONSOLE_TOKEN,
      serverDynamicSlotHtml: buildOwnerServerPortalSlotHtml(reqUrl.origin),
      profile: ownerProf,
      whitelist: Array.from(adminWhitelistStore.values()),
      recovered: true
     }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
     });
    }

    return new Response(JSON.stringify({
     ok: false,
     error: 'Ошибка авторизации: проверьте правильность логина и пароля'
    }), {
     status: 200,
     headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
    });
   }
  }

  if (reqUrl.pathname.endsWith('/auth/sync') && (request.method === 'POST' || reqUrl.searchParams.has('payload'))) {
   if (!checkWorkerRateLimit(`sync_${clientIp}`, false, 30)) {
    return new Response(JSON.stringify({ ok: false, error: 'Rate limit exceeded' }), {
     status: 429,
     headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
    });
   }
   try {
    await ensurePersistentStateLoaded(env);
    const body = await readWorkerRequestPayload(request, reqUrl);
    const snap = pickAllowedProfileFields(workerSanitizeObject(body.profileSnapshot));
    const rawLoginClean = String(body.login || '').trim();
    const normLoginPre = workerNormalizeLogin(rawLoginClean);
    const normFidPre = /^FP_/i.test(rawLoginClean) ? workerNormalizeFisherId(rawLoginClean, '89') : '';
    const preCheckKey = normLoginPre ? `AUTH_${normLoginPre}_${body.authTokenHash && String(body.authTokenHash).startsWith('KTOK_') ? body.authTokenHash : workerDeriveAuthToken(rawLoginClean, body.password)}` : '';
    await loadPersistedAuthProfile(env, preCheckKey, normLoginPre, normFidPre);
    const ident = resolveWorkerAccountIdentity(body.login, body.password, body.authTokenHash, body.regionCode, snap);
    if (!ident.ok) {
     return new Response(JSON.stringify({ ok: false, error: 'Invalid credentials' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
     });
    }
    const existing = (await loadPersistedAuthProfile(env, ident.authKey)) || {};
    const merged = {
     ...existing,
     ...snap,
     fisherId: ident.fisherId,
     login: ident.login,
     callsign: ident.isOwner ? 'iAthor' : (snap.callsign || existing.callsign || ident.callsign),
     pinHash: ident.pinHash,
     authTokenHash: ident.authTokenHash,
     adminSessionToken: ident.isOwner ? OWNER_ADMIN_CONSOLE_TOKEN : '',
     ownerUnlocked: ident.isOwner ? true : Boolean(existing.ownerUnlocked),
     isAdmin: ident.isOwner ? true : adminWhitelistStore.has(ident.fisherId),
     updatedAt: Date.now()
    };
    delete merged.authShadow;
    await persistAuthProfile(env, ident.authKey, merged, ctx);
    const resolvedSyncRegCode = ident.isOwner
     ? '89'
     : (ident.fisherId.slice(3, 5) || workerResolveRegionCode(body.regionCode || snap.locAdmin1 || snap.locLabel || '89'));
    const syncRec = upsertUserInRegistry({
     fisherId: ident.fisherId,
     deviceId: snap.deviceId || body.deviceId || '',
     login: ident.login,
     callsign: merged.callsign,
     tgId: ident.isOwner ? (snap.tgLinkedId || '') : (workerIsOwnerLogin(snap.tgUsername) ? '' : (snap.tgLinkedId || '')),
     tgUsername: ident.isOwner ? (snap.tgUsername || '') : (workerIsOwnerLogin(snap.tgUsername) ? '' : (snap.tgUsername || '')),
     regionCode: resolvedSyncRegCode,
     locLabel: snap.locLabel || 'Новый Уренгой',
     platform: body.platform || 'WEB',
     version: body.version || WORKER_VERSION,
     lat: snap.lat,
     lon: snap.lon
    });
    await d1SaveUser(env, syncRec);
    await persistSystemMeta(env, ctx);
    return new Response(JSON.stringify({
     ok: true,
     fisherId: ident.fisherId,
     isOwner: ident.isOwner,
     adminSessionToken: ident.isOwner ? OWNER_ADMIN_CONSOLE_TOKEN : '',
     serverDynamicSlotHtml: ident.isOwner ? buildOwnerServerPortalSlotHtml(reqUrl.origin) : '',
     profile: merged,
     whitelist: Array.from(adminWhitelistStore.values())
    }), {
     headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
    });
   } catch (e) {
    return new Response(JSON.stringify({ ok: false }), {
     status: 400,
     headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
    });
   }
  }

  if (reqUrl.pathname.endsWith('/admin/whitelist')) {
  if (!checkWorkerRateLimit(`wl_${clientIp}`, false, 15)) {
   return new Response(JSON.stringify({ ok: false, error: 'Rate limit' }), { status: 429, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }
  await ensurePersistentStateLoaded(env);
  if (request.method === 'GET' && !reqUrl.searchParams.has('payload')) {
   const admTok = extractAdminTokenFromRequest(request, reqUrl, null);
   const isFullAdm = isValidOwnerAdminToken(admTok, env);
   const listOut = Array.from(adminWhitelistStore.values()).map(item => isFullAdm ? item : { id: item.id });
   return new Response(JSON.stringify({ ok: true, whitelist: listOut }), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
   });
  }
  if (request.method === 'POST' || reqUrl.searchParams.has('payload')) {
   try {
    const body = await readWorkerRequestPayload(request, reqUrl);
    const secret = extractAdminTokenFromRequest(request, reqUrl, body);
    if (!isValidOwnerAdminToken(secret, env)) {
     return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }
    if (body.action === 'add' && body.entry && body.entry.id) {
     const cleanId = workerNormalizeFisherId(body.entry.id, '89') || String(body.entry.id).trim().toUpperCase();
     adminWhitelistStore.set(cleanId, {
      id: cleanId,
      label: String(body.entry.label || 'Администратор').slice(0, 40),
      addedAt: body.entry.addedAt || new Date().toISOString().slice(0, 10)
     });
    } else if (body.action === 'remove' && body.targetId) {
     const cleanId = workerNormalizeFisherId(body.targetId, '89') || String(body.targetId).trim().toUpperCase();
     if (cleanId !== OWNER_FISHER_ID && cleanId !== 'FP-89A01') adminWhitelistStore.delete(cleanId);
    } else if (Array.isArray(body.list)) {
     for (const item of body.list) {
      if (item && item.id) {
       const cid = workerNormalizeFisherId(item.id, '89') || String(item.id).trim().toUpperCase();
       adminWhitelistStore.set(cid, { id: cid, label: String(item.label || 'Админ').slice(0, 40), addedAt: item.addedAt || '' });
      }
     }
    }
    await persistSystemMeta(env, ctx);
    return new Response(JSON.stringify({ ok: true, whitelist: Array.from(adminWhitelistStore.values()) }), {
     headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
    });
   } catch (e) {
    return new Response(JSON.stringify({ ok: false }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
   }
  }
  }

  if (reqUrl.pathname.endsWith('/api/version') && request.method === 'GET') {
   return new Response(JSON.stringify({
    appName: 'Клёв ПРО 2.0',
    packageName: 'ru.klevpro.app',
    version: WORKER_VERSION,
    versionCode: 251188,
    buildRevision: '2026.10.31-r188',
    releaseDate: '2026-10-30',
    apkFileName: `klev-pro-v${WORKER_VERSION}.apk`,
    apkUrl: `https://klevpro.ru/apk/klev-pro-v${WORKER_VERSION}.apk`,
    apkDownloadUrl: `https://klevpro.ru/apk/klev-pro-v${WORKER_VERSION}.apk`,
    apkSizeMb: '37.9 МБ',
    fileSize: '37.9 МБ',
    title: `Выпущена новая версия приложения Клёв ПРО 2.0 (v${WORKER_VERSION})`,
    subtitle: 'Точная многоканальная проверка обновлений APK, защита от фантомных точек Круга и удалённых чатов, 1 резервный ID на 24 часа и выбор региона при регистрации.',
    changelog: [
     'Исправлена проверка обновлений внутри Android APK: приложение мгновенно видит выход новой версии на сервере и в репозитории',
     'Устранено фантомное появление давно удалённых точек Круга и повторное «оживление» удалённых чатов',
     'Исправлена выдача временных резервных ID (FP_XXRZYYYY): строго 1 резервный ID на сессию/сутки без дублей при переключении точек на карте и автоочистка из БД через 24 часа',
     'В окне регистрации добавлен выбор региональной группы РФ или точки на карте с запросом подтверждения региона перед сохранением нового рыбака в БД',
     'Журнал уловов на устройстве полностью независим от смены резервного или постоянного ID рыбака'
    ]
   }), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
   });
  }

  if (reqUrl.pathname.endsWith('/api/relay/delete-channel') && (request.method === 'POST' || reqUrl.searchParams.has('payload'))) {
   try {
    await ensurePersistentStateLoaded(env);
    const body = await readWorkerRequestPayload(request, reqUrl);
    const viewerFid = workerNormalizeFisherId(body.viewerFid || '', '89');
    const devId = String(body.deviceId || '').trim();
    const authTok = String(body.authTokenHash || '').trim();
    const admTok = extractAdminTokenFromRequest(request, reqUrl, body);
    const authRes = await verifyUserAuth(env, {
     fid: viewerFid,
     authTokenHash: authTok,
     deviceId: devId,
     adminToken: admTok,
     request
    });
    if (!authRes.ok && !authRes.isAdmin) {
     return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }
    const chanId = String(body.channelId || '').trim();
    const peerIds = Array.isArray(body.peerIds) ? body.peerIds.map(p => String(p || '').trim().toUpperCase()).filter(Boolean) : [];
    const d1 = getD1(env)?.db;

    if (chanId.startsWith('crew:')) {
     const cKey = chanId.replace(/^crew:/i, '').toUpperCase();
     const boxKey = `CREW_${cKey}`;
     transitBoxes.delete(boxKey);
     if (d1) {
      await d1.prepare('DELETE FROM transit_relay WHERE channel_id = ? OR crew_key = ?').bind(boxKey, cKey).run().catch(() => {});
     }
    } else if (viewerFid) {
     const dmBoxesToClean = [`DM_${viewerFid}`];
     if (authRes.isOwner || isOwnerFisherId(viewerFid)) {
      dmBoxesToClean.push(`DM_${OWNER_FISHER_ID}`, `DM_${OWNER_SECONDARY_ID}`);
     }
     for (const bKey of dmBoxesToClean) {
      const arr = transitBoxes.get(bKey) || [];
      if (peerIds.length > 0) {
       const rem = arr.filter(p => p && !peerIds.includes(String(p.senderId || '').toUpperCase()) && !peerIds.includes(String(p.peerId || '').toUpperCase()));
       if (rem.length === 0) transitBoxes.delete(bKey);
       else transitBoxes.set(bKey, rem);
      } else {
       transitBoxes.delete(bKey);
      }
      if (d1) {
       if (peerIds.length > 0) {
        for (const pid of peerIds) {
         await d1.prepare('DELETE FROM transit_relay WHERE (channel_id = ? AND (sender_id = ? OR peer_id = ?)) OR (channel_id = ? AND sender_id = ?)')
          .bind(bKey, pid, pid, `DM_${pid}`, viewerFid).run().catch(() => {});
        }
       } else {
        await d1.prepare('DELETE FROM transit_relay WHERE channel_id = ?').bind(bKey).run().catch(() => {});
       }
      }
     }
    }
    await persistSystemMeta(env, ctx);
    return new Response(JSON.stringify({ ok: true, deletedChannel: chanId }), {
     headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
    });
   } catch (e) {
    return new Response(JSON.stringify({ ok: false }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
   }
  }

  if (reqUrl.pathname.endsWith('/relay/push') && (request.method === 'POST' || reqUrl.searchParams.has('payload'))) {
  if (!checkWorkerRateLimit(`rpush_${clientIp}`, false, 45)) {
   return new Response(JSON.stringify({ ok: false, error: 'Rate limit' }), { status: 429, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }
  try {
   await ensurePersistentStateLoaded(env);
   cleanupTransitBoxes();
   const body = await readWorkerRequestPayload(request, reqUrl);
   const channelId = String(body.channelId || '').trim().toUpperCase().replace(/[^A-Z0-9_:-]/g, '').slice(0, 64);
   const cipherPayload = String(body.cipherPayload || '').trim().slice(0, 8192);
   const senderFid = workerNormalizeFisherId(body.senderId || '', '89');
   if (!channelId || !cipherPayload || !senderFid || isTemporaryReserveId(senderFid)) {
    return new Response(JSON.stringify({ ok: false, code: 'REGISTRATION_REQUIRED', error: 'Сначала зарегистрируйтесь для отправки сообщений' }), { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
   }
   const pushAuth = await verifyUserAuth(env, {
    fid: senderFid,
    authTokenHash: body.authTokenHash || '',
    deviceId: body.deviceId || '',
    adminToken: body.adminToken || '',
    request
   });
   if (!pushAuth.ok) {
    return new Response(JSON.stringify({ ok: false, error: 'Forbidden: sender auth failed' }), { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
   }
   const dedupRelayKey = `rel_${senderFid}_${channelId}_${cipherPayload.slice(-32)}`;
   if (isDuplicateRecentAction(dedupRelayKey, 4000)) {
    return new Response(JSON.stringify({ ok: true, relayed: true, deduplicated: true }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
   }
   const pkt = {
    id: `rel_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    channelId,
    senderId: senderFid,
    cipherPayload,
    kind: String(body.kind || 'chat').slice(0, 20),
    crewKey: body.crewKey ? String(body.crewKey).trim().toUpperCase().slice(0, 16) : '',
    peerId: body.peerId ? String(body.peerId).trim().toUpperCase().slice(0, 24) : '',
    ts: Date.now()
   };
   const list = transitBoxes.get(channelId) || [];
   list.push(pkt);
   transitBoxes.set(channelId, list.slice(-50));
   await d1PushRelay(env, pkt);
   await persistSystemMeta(env, ctx);
   return new Response(JSON.stringify({ ok: true, relayed: true, packetId: pkt.id }), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
   });
  } catch (e) {
   const status = e && e.status === 413 ? 413 : 400;
   return new Response(JSON.stringify({ ok: false, error: status === 413 ? 'Payload Too Large' : 'Push failed' }), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }
  }

  if (reqUrl.pathname.endsWith('/relay/pull') && request.method === 'GET') {
  if (!checkWorkerRateLimit(`rpull_${clientIp}`, false, 60)) {
   return new Response(JSON.stringify({ ok: false, packets: [] }), { status: 429, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }
  await ensurePersistentStateLoaded(env);
  cleanupTransitBoxes();
  const viewer = workerNormalizeFisherId(reqUrl.searchParams.get('viewer') || '', '89') || String(reqUrl.searchParams.get('viewer') || '').trim().toUpperCase();
  const viewerDevId = String(reqUrl.searchParams.get('deviceId') || '').trim();
  const viewerAuthTok = String(reqUrl.searchParams.get('authTokenHash') || '').trim();
  const viewerAdmTok = extractAdminTokenFromRequest(request, reqUrl, null);
  const pullAuth = await verifyUserAuth(env, {
   fid: viewer,
   authTokenHash: viewerAuthTok,
   deviceId: viewerDevId,
   adminToken: viewerAdmTok,
   request
  });
  // Защита от IDOR (Пункт 7): доступ к личным боксам DM_<FID> разрешён только самому подтверждённому получателю или Супер-Админу
  const rawBoxes = (reqUrl.searchParams.get('boxes') || '')
   .split(',')
   .map(s => s.trim().toUpperCase().replace(/[^A-Z0-9_:-]/g, ''))
   .filter(bKey => {
    if (!bKey) return false;
    if (bKey.startsWith('DM_')) {
     const dmTarget = bKey.slice(3);
     if (pullAuth.isAdmin) return true;
     return Boolean(pullAuth.ok && viewer && dmTarget === viewer);
    }
    return true;
   })
   .slice(0, 30);
  const since = Math.max(0, Number(reqUrl.searchParams.get('since') || 0));
  const packets = [];
  const seenPktIds = new Set();

  const d1Info = getD1(env);
  const d1 = d1Info?.db;
  if (d1 && rawBoxes.length > 0) {
   try {
    const placeholders = rawBoxes.map(() => '?').join(',');
    const query = `SELECT id, channel_id, sender_id, cipher_payload, kind, crew_key, peer_id, ts FROM transit_relay WHERE channel_id IN (${placeholders}) AND ts > ? ORDER BY ts ASC LIMIT 100`;
    const rows = await d1.prepare(query).bind(...rawBoxes, since).all();
    if (rows && Array.isArray(rows.results)) {
     for (const r of rows.results) {
      if (!viewer || r.sender_id !== viewer) {
       seenPktIds.add(r.id);
       packets.push({
        id: r.id,
        channelId: r.channel_id,
        senderId: r.sender_id,
        cipherPayload: r.cipher_payload,
        kind: r.kind,
        crewKey: r.crew_key,
        peerId: r.peer_id,
        ts: Number(r.ts)
       });
      }
     }
    }
   } catch (e) {
    console.error('[relay pull D1 error]', e);
   }
  }

  for (const bKey of rawBoxes) {
   const arr = transitBoxes.get(bKey);
   if (!arr || arr.length === 0) continue;
   const matching = arr.filter(p => p && p.ts > since && (!viewer || p.senderId !== viewer));
   for (const p of matching) {
    if (!seenPktIds.has(p.id)) {
     seenPktIds.add(p.id);
     packets.push(p);
    }
   }
   if (bKey.startsWith('DM_') && matching.length > 0) {
    const remaining = arr.filter(p => !matching.includes(p));
    if (remaining.length === 0) transitBoxes.delete(bKey);
    else transitBoxes.set(bKey, remaining);
   }
  }
  return new Response(JSON.stringify({ ok: true, packets: packets.slice(-100) }), {
   headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
  });
  }

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
  version: WORKER_VERSION,
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
  version: WORKER_VERSION,
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
  if (!constantTimeEquals(incomingSecret, WEBHOOK_SECRET)) {
  return new Response('Forbidden: invalid secret token', { status: 403 });
  }
  }

  try {
  await ensurePersistentStateLoaded(env);
  const update = await request.json();
  if (!BOT_TOKEN) return new Response('OK', { status: 200 });

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

  const msg = update.message || update.channel_post;
  if (!msg || !msg.chat) return new Response('OK', { status: 200 });

  const chatId = msg.chat.id;
  const chatType = msg.chat.type || 'private';
  const isPrivateChat = chatType === 'private';
  const isChannelPost = Boolean(update.channel_post);
  const userId = msg.from?.id || chatId;
  const fromUsername = msg.from?.username || '';
  const fromFullName = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || fromUsername || `Рыбак #${userId}`;

  if (!checkWorkerRateLimit(userId, Boolean(msg.location))) {
  return new Response('OK', { status: 200 });
  }

  const session = saveUserSession(userId, { userId, tgUsername: fromUsername, tgName: fromFullName });

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

  if (cleanText.startsWith('/start')) {
  const startParam = cleanText.split(/\s+/)[1] || '';

  if (isPrivateChat) {
  saveUserSession(userId, { keyboardSent: true, tgUsername: fromUsername, tgName: fromFullName });
  await configureBotMenusAndCommands(BOT_TOKEN, chatId);
  }

  // Двухэтапная связка автономного Рыболовного ID (из APK или с сайта) с аккаунтом Telegram пользователя (/start BIND_FP_...)
  if (/^BIND_/i.test(startParam)) {
  const rawBindFid = startParam.replace(/^BIND_/i, '').trim();
  const normBindFid = workerNormalizeFisherId(rawBindFid, '89');
  if (normBindFid) {
   const boundRec = bindTelegramToFisherProfile({
   fisherId: normBindFid,
   tgId: userId,
   tgUsername: fromUsername,
   tgFirstName: fromFullName
   });
   await persistSystemMeta(env, ctx);
   const tgDisp = fromUsername ? `@${fromUsername}` : `ID ${userId}`;
   const loginLine = boundRec?.login ? `🔑 *Единый логин профиля:* \`${boundRec.login}\`\n` : '';
   await tgApi(BOT_TOKEN, 'sendMessage', {
   chat_id: chatId,
   text:
    `🔗 *Связка выполнена! Ваш рыболовный ID и Telegram объединены воедино.*\n\n` +
    `🆔 *Ваш единый Рыболовный ID:* \`${boundRec?.fisherId || normBindFid}\`\n` +
    `✈️ *Аккаунт Telegram:* ${tgDisp}\n` +
    loginLine +
    `\nТеперь в мобильном приложении (APK), на сайте \`klevpro.ru\` и в боте \`@KlevProClubBot\` у вас единый профиль, общие точки Круга, Экипажи и настройки!`,
   parse_mode: 'Markdown',
   reply_markup: BOT_REPLY_KEYBOARD
   });
  }
  }

  const kploc = decodeKplocToken(startParam);
  if (kploc) {
  let bindNote = '';
  if (isPrivateChat && kploc.fisherId && !tgToFisherIdMap.has(String(userId))) {
   const bRec = bindTelegramToFisherProfile({
   fisherId: kploc.fisherId,
   tgId: userId,
   tgUsername: fromUsername,
   tgFirstName: fromFullName
   });
   await persistSystemMeta(env, ctx);
   bindNote = `\n🔗 *Ваш ID \`${bRec?.fisherId || kploc.fisherId}\` связан с вашим Telegram!*`;
  }
  const fish = BOT_FISH_CATALOG.find(f => f.id === kploc.fishId) || BOT_FISH_CATALOG[0];
  const near = findNearestSettlement(kploc.lat, kploc.lon);
  const label = near.distKm <= 50 ? near.name : `${kploc.lat.toFixed(3)}°N, ${kploc.lon.toFixed(3)}°E`;
  const city = buildSpotContext(kploc.lat, kploc.lon, label);
  saveUserSession(userId, { lat: city.lat, lon: city.lon, cityName: city.name, fishId: fish.id });
  await persistSystemMeta(env, ctx);
  if (isPrivateChat) {
  await tgApi(BOT_TOKEN, 'sendMessage', {
  chat_id: chatId,
  text: `📍 Загружена точка: *${city.name}* • *${fish.name}*${bindNote}`,
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

  const appLink = startParam.startsWith('KP1_') ? `${WEBAPP_URL}#p=${startParam}` : WEBAPP_URL;

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

  await ensurePrivateReplyKeyboard();

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

  if (cleanText === '🔍' || /^\/(search|waters|fish)(\s|$)/i.test(cleanText)) {
  const arg = cleanText.replace(/^\/(search|waters|fish)\s*/i, '').replace(/^🔍\s*/, '').trim();
  const { city } = await resolveQueryCityAndFish(arg || session.cityName, session);
  saveUserSession(userId, { lat: city.lat, lon: city.lon, cityName: city.name });
  const srch = buildSearchDirectoryCard(city);
  await tgApi(BOT_TOKEN, 'sendMessage', { chat_id: chatId, text: srch.text, parse_mode: 'Markdown', reply_markup: srch.replyMarkup });
  return new Response('OK', { status: 200 });
  }

  if (cleanText === '👤' || /^\/(profile|my|app)(\s|$)/i.test(cleanText)) {
  const { city, fish } = await resolveQueryCityAndFish(`${session.cityName} ${session.fishId}`, session);
  const prof = buildUserProfileCard(session, city, fish, WEBAPP_URL, isPrivateChat);
  await tgApi(BOT_TOKEN, 'sendMessage', { chat_id: chatId, text: prof.text, parse_mode: 'Markdown', reply_markup: prof.replyMarkup });
  return new Response('OK', { status: 200 });
  }

  if (cleanText === '❓' || cleanText === '?' || /^\/help(\s|$)/i.test(cleanText)) {
  const helpCard = buildHelpAndGroupsCard(WEBAPP_URL, isPrivateChat);
  await tgApi(BOT_TOKEN, 'sendMessage', { chat_id: chatId, text: helpCard.text, parse_mode: 'Markdown', reply_markup: helpCard.replyMarkup });
  return new Response('OK', { status: 200 });
  }

  const kpMatch = cleanText.match(/(KP1_[A-Za-z0-9_-]+)/);
  if (kpMatch && kpMatch[1]) {
  const tok = kpMatch[1];
  const packUrl = `${WEBAPP_URL}#p=${tok}`;
  let previewLines = `📥 *Обнаружен зашифрованный пакет «Круга / Экипажа»!*`;
  try {
  let b64 = tok.slice(4).replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';
  const bin = atob(b64);
  const salt = new TextEncoder().encode('KlevProCircle_v2.1_Salt_RU');
  const plain = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
  plain[i] = bin.charCodeAt(i) ^ salt[i % salt.length] ^ ((i * 31) & 0xff);
  }
  if (plain.length >= 18 && plain[0] === 0xb3) {
   const mCode = plain[1] & 0x03;
   const hasTail = Boolean((plain[1] >>> 6) & 0x01);
   const hasFid = Boolean((plain[1] & 0x80) && plain.length >= 21);
   const fiIdx = plain[2];
   const latInt = (plain[4] << 16) | (plain[5] << 8) | plain[6];
   const lonInt = (plain[7] << 16) | (plain[8] << 8) | plain[9];
   const lat = mCode === 3 ? 0 : Math.round(((latInt / 10000) - 90) * 10000) / 10000;
   const lon = mCode === 3 ? 0 : Math.round(((lonInt / 10000) - 180) * 10000) / 10000;
   const dp = Math.round((plain[10] / 4) * 10) / 10 || 2.0;
   const tw = Math.round(((plain[11] / 6) - 5) * 10) / 10;
   const pr = plain[12] + 650;
   const meta16 = (plain[16] << 8) | plain[17];
   const is32BitFid = Boolean((plain[3] & 0x80) && plain.length >= 22);
   let fidStr = '';
   let noteOffset = 18;
   if (hasFid && is32BitFid) {
    const fid32 = (((plain[18] & 0x7f) * 16777216) + (plain[19] << 16) + (plain[20] << 8) + plain[21]) >>> 0;
    fidStr = workerDecodeFisherIdFrom32Bit(fid32);
    noteOffset = 22;
   } else if (hasFid) {
    const fid20 = ((plain[18] & 0x0f) << 16) | (plain[19] << 8) | plain[20];
    fidStr = fid20 === 0x89a01 ? OWNER_FISHER_ID : workerFormatFisherIdFromIndex('89', fid20 % 99999);
    noteOffset = 21;
   }
   const customNote = (hasTail && plain.length > noteOffset) ? new TextDecoder().decode(plain.slice(noteOffset)).trim() : '';
   const fObj = BOT_FISH_CATALOG[fiIdx] || BOT_FISH_CATALOG[0];
   const nearC = (lat || lon) ? findNearestSettlement(lat, lon) : { name: 'Водоём' };
   const cKey = `KP-${(meta16 || 0x7a3f).toString(16).toUpperCase().padStart(4, '0')}`;
   const mTitle = mCode === 2 ? '🆘 SOS НА ВОДЕ (ВСЕМ РЫБАКАМ)' : (mCode === 1 ? `🌊 ЭКИПАЖ (72 ч • Ключ ${cKey})` : (mCode === 3 ? '🛠️ МАСТЕРСКАЯ СНАСТЕЙ' : '👥 СВОДКА В КРУГ (±5 км)'));
   previewLines = `*${mTitle} • Клёв ПРО*
📍 *${nearC.name}*${fidStr ? ` • 🆔 \`${fidStr}\`` : ''}
🐟 *${fObj.name}* • 💧 ~${tw}°C • 🧭 ${pr} мм • ~${dp} м` +
    ((mCode === 1 || mCode === 2) && (lat || lon) ? `
🎯 Координаты: \`${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E\`` : '') +
    (customNote ? `
💬 ${customNote}` : '');
  } else {
   const parsed = JSON.parse(new TextDecoder().decode(plain));
   if (Array.isArray(parsed) && parsed[0] === 2) {
   const [, mCode, fiIdx, , , lat, lon, dp, tw, pr, , , lb, wn, au, bt, nt] = parsed;
   const fObj = BOT_FISH_CATALOG[Number(fiIdx)] || BOT_FISH_CATALOG[0];
   const mTitle = mCode === 2 ? '🆘 SOS НА ВОДЕ (ВСЕМ)' : (mCode === 1 ? '🌊 ЭКИПАЖ (72 ч)' : (mCode === 3 ? '🛠️ МАСТЕРСКАЯ СНАСТЕЙ' : '👥 СВОДКА В КРУГ (±5 км)'));
   const locStr = (wn && wn !== lb) ? `${lb} (${wn})` : (lb || 'Точка на воде');
   previewLines = `*${mTitle} • Клёв ПРО*
📍 *${locStr}*${au ? ` • 👤 ${au}` : ''}
🐟 *${fObj.name}* • 💧 ~${tw}°C • 🧭 ${pr} мм • ~${dp} м` +
    ((mCode === 1 || mCode === 2) && lat && lon ? `
🎯 Координаты: \`${Number(lat).toFixed(4)}°N, ${Number(lon).toFixed(4)}°E\`` : '') +
    (bt ? `
🪱 Приманка: ${bt}` : '') +
    (nt ? `
💬 ${nt}` : '');
   } else if (parsed && parsed.t) {
   const mTitle = parsed.sos ? '🆘 SOS НА ВОДЕ (ВСЕМ)' : (parsed.t === 'crew' ? '🌊 ЭКИПАЖ (72 ч)' : (parsed.t === 'workshop' ? '🛠️ МАСТЕРСКАЯ СНАСТЕЙ' : '👥 СВОДКА В КРУГ'));
   previewLines = `*${mTitle} • Клёв ПРО*
📍 *${parsed.lb || parsed.wn || 'Водоём'}*
🐟 *${parsed.fn || 'Рыба'}* • 💧 ~${parsed.tw ?? 8}°C`;
   }
  }
  } catch (_) {}
  await tgApi(BOT_TOKEN, 'sendMessage', {
  chat_id: chatId,
  text: `${previewLines}

👇 Нажмите кнопку ниже, чтобы открыть и сохранить в ваш навигатор:`,
  parse_mode: 'Markdown',
  reply_markup: {
  inline_keyboard: [
  [makeAppButton('📥 Открыть в «Клёв ПРО 2.0»', packUrl, isPrivateChat)]
  ]
  }
  });
  return new Response('OK', { status: 200 });
  }

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
  } catch (topFatalError) {
   console.error('[Worker Fatal Recovered]', topFatalError);
   return new Response(JSON.stringify({
    ok: false,
    recovered: true,
    error: String(topFatalError?.message || topFatalError),
    version: WORKER_VERSION
   }), {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
   });
  }
 }
};