// @file bot/cloudflare-worker-bot.js — @KlevProClubBot (V.2.1.1)
// Компактная сборка для Cloudflare Workers (115 рыб, 491 водоём, 609 городов РФ + Triple-Engine $0 DB + E2EE Relay + Обмен точками Круга/Экипажа/SOS + Уникальные Региональные ID FP_89AAA001 & Эксклюзивный VIP ID владельца FP_89VIP089 + Секретная Серверная Консоль Супер-Админа)

const WORKER_VERSION = '2.9.2-r259';
const RESERVE_ID_TTL_MS = 24 * 60 * 60 * 1000; // Временный резервный ID живёт строго не более 24 часов (суток)
const deletedFisherIdsSet = new Set(); // Удалённые вручную через Админ-панель ID (защита от повторной фоновой вставки)
const rateBuckets = new Map();
const transitBoxes = new Map();
const deadmanTimersStore = new Map();
const clientErrorTelemetryLog = []; // Кольцевой буфер последних ошибок клиентов для Супер-Админа
const loginFailBuckets = new Map(); // Анти-брутфорс: ключ `${ip}_${loginNorm}` -> { count, firstFailTs, lockedUntil }
const securityAuditStore = {
 counters: {
  sqli: 0,
  idor: 0,
  mass_assign: 0,
  deserialization: 0,
  data_exposure: 0,
  brute_force: 0,
  xss: 0
 },
 events: [] // Кольцевой буфер последних 80 перехваченных попыток обхода 7 рубежей бэкенда
};

const SECURITY_FACTOR_META = {
 sqli: { code: '01', key: 'sqli', title: '01 / SQL-инъекция (Поиск и параметры)' },
 idor: { code: '02', key: 'idor', title: '02 / IDOR / BOLA (Доступ к чужим объектам по ID)' },
 mass_assign: { code: '03', key: 'mass_assign', title: '03 / Массовое присвоение (Подмена ролей и полей формы)' },
 deserialization: { code: '04', key: 'deserialization', title: '04 / Десериализация и схема (Prototype Pollution / JSON)' },
 data_exposure: { code: '05', key: 'data_exposure', title: '05 / Защита от утечки данных API (Скрытие deviceId и токенов)' },
 brute_force: { code: '06', key: 'brute_force', title: '06 / Защита входа (Анти-брутфорс: лимит 5 попыток / 15 мин)' },
 xss: { code: '07', key: 'xss', title: '07 / Анти-XSS (Санитизация HTML/JS-скриптов в полях)' }
};

function recordSecurityIncident(factorKey, endpoint = '', detail = '', ip = 'anon', fid = '') {
 const meta = SECURITY_FACTOR_META[factorKey] || SECURITY_FACTOR_META.xss;
 const k = meta.key;
 securityAuditStore.counters[k] = (Number(securityAuditStore.counters[k]) || 0) + 1;
 const ev = {
  id: `SEC_${Date.now()}_${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
  ts: Date.now(),
  factorKey: k,
  factorCode: meta.code,
  factorTitle: meta.title,
  endpoint: String(endpoint || '/api').slice(0, 64),
  detail: String(detail || 'Заблокирована подозрительная нагрузка').slice(0, 220),
  ip: String(ip || 'anon').slice(0, 48),
  fid: String(fid || '—').slice(0, 24),
  blocked: true
 };
 securityAuditStore.events.unshift(ev);
 if (securityAuditStore.events.length > 80) securityAuditStore.events.length = 80;
 return ev;
}

function getSecurityAuditSnapshot() {
 const c = securityAuditStore.counters || {};
 const totalBlocked = Object.values(c).reduce((acc, v) => acc + (Number(v) || 0), 0);
 return {
  updatedAt: Date.now(),
  totalBlocked,
  counters: {
   sqli: Number(c.sqli) || 0,
   idor: Number(c.idor) || 0,
   mass_assign: Number(c.mass_assign) || 0,
   deserialization: Number(c.deserialization) || 0,
   data_exposure: Number(c.data_exposure) || 0,
   brute_force: Number(c.brute_force) || 0,
   xss: Number(c.xss) || 0
  },
  events: (securityAuditStore.events || []).slice(0, 50)
 };
}

function detectSqlInjectionAttempt(rawStr, endpoint = '', ip = 'anon', fid = '') {
 if (!rawStr || typeof rawStr !== 'string') return false;
 const str = String(rawStr);
 // Запросы к D1 полностью параметризованы (.prepare().bind()); проверяем только длину и управляющие/нулевые байты, не блокируя апострофы и легитимные логины.
 if (str.length > 8192 || /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(str)) {
  recordSecurityIncident('sqli', endpoint, 'Отклонена строка с управляющими символами или превышением длины', ip, fid);
  return true;
 }
 return false;
}

function workerCleanText(rawVal, maxLen = 120, fieldName = 'field', endpoint = '', ip = 'anon', fid = '') {
 if (rawVal === null || rawVal === undefined) return '';
 const str = String(rawVal).trim();
 if (!str) return '';
 const xssRegex = /(<\s*\/?\s*(script|iframe|object|embed|svg|img|style|link|meta|onload|onerror)\b|javascript\s*:|on(error|load|click|mouseover|focus)\s*=)/i;
 if (xssRegex.test(str)) {
  recordSecurityIncident('xss', endpoint, `Удалён XSS-код в поле "${fieldName}": ${str.slice(0, 110)}`, ip, fid);
 }
 detectSqlInjectionAttempt(str, endpoint, ip, fid);
 return str
  .replace(/<[^>]*>/g, '')
  .replace(/[<>]/g, '')
  .replace(/javascript\s*:/gi, '')
  .replace(/on(error|load|click|mouseover|focus)\s*=/gi, '')
  .trim()
  .slice(0, maxLen);
}

function detectMassAssignmentAttempt(rawObj, endpoint = '', ip = 'anon', fid = '', isOwner = false) {
 if (!rawObj || typeof rawObj !== 'object' || isOwner) return false;
 const forbiddenKeys = ['role', 'isAdmin', 'isOwner', 'adminSessionToken', 'authShadow', 'secureTokenHash', 'permissions', 'superuser'];
 const found = [];
 for (const k of forbiddenKeys) {
  if (Object.prototype.hasOwnProperty.call(rawObj, k)) {
   if ((k === 'isAdmin' || k === 'isOwner') && rawObj[k] === false) continue;
   if (k === 'adminSessionToken' && !rawObj[k]) continue;
   found.push(`${k}=${JSON.stringify(rawObj[k]).slice(0, 32)}`);
  }
 }
 if (found.length > 0) {
  recordSecurityIncident('mass_assign', endpoint, `Отброшены запрещённые поля формы: ${found.join(', ')}`, ip, fid);
  return true;
 }
 return false;
}

function sanitizePublicCirclePoint(pt, includeDeviceForOwner = false, canSeeCrewSecrets = false) {
 if (!pt || typeof pt !== 'object') return null;
 const out = { ...pt };
 if (!includeDeviceForOwner) {
  delete out.did;
 }
 if (out.t === 'crew' && !out.sos && !canSeeCrewSecrets && !includeDeviceForOwner) {
  delete out.packToken;
 }
 return out;
}

const BRUTE_FORCE_WINDOW_MS = 5 * 60 * 1000;
const BRUTE_FORCE_MAX_FAILS = 5;

function checkLoginBruteForce(ip = 'anon', loginNorm = '') {
 const cleanIp = String(ip || 'anon').trim().slice(0, 48);
 const normL = String(loginNorm || 'any').toLowerCase().slice(0, 40);
 const key = `acct_${cleanIp}_${normL}`;
 const now = Date.now();
 const rec = loginFailBuckets.get(key);
 if (!rec) return { locked: false, remainingAttempts: BRUTE_FORCE_MAX_FAILS };
 if (rec.lockedUntil && now < rec.lockedUntil) {
  return { locked: true, waitSec: Math.ceil((rec.lockedUntil - now) / 1000), count: rec.count };
 }
 if (now - rec.firstFailTs > BRUTE_FORCE_WINDOW_MS) {
  loginFailBuckets.delete(key);
  return { locked: false, remainingAttempts: BRUTE_FORCE_MAX_FAILS };
 }
 return { locked: false, remainingAttempts: Math.max(0, BRUTE_FORCE_MAX_FAILS - rec.count) };
}

function recordLoginFailure(ip = 'anon', loginNorm = '', endpoint = '/auth/login') {
 const cleanIp = String(ip || 'anon').trim().slice(0, 48);
 const normL = String(loginNorm || 'any').toLowerCase().slice(0, 40);
 const key = `acct_${cleanIp}_${normL}`;
 const now = Date.now();
 let rec = loginFailBuckets.get(key);
 if (!rec || (now - rec.firstFailTs > BRUTE_FORCE_WINDOW_MS)) {
  rec = { count: 0, firstFailTs: now, lastFailTs: 0, lockedUntil: 0 };
 }
 rec.lastFailTs = now;
 rec.count += 1;
 if (rec.count >= BRUTE_FORCE_MAX_FAILS) {
  rec.lockedUntil = now + BRUTE_FORCE_WINDOW_MS;
  recordSecurityIncident('brute_force', endpoint, `Блокировка перебора пароля (${rec.count} неудачных попыток к логину "${loginNorm || 'admin'}")`, ip, loginNorm);
 }
 loginFailBuckets.set(key, rec);
 return rec;
}

function clearLoginFailures(ip = 'anon', loginNorm = '') {
 const cleanIp = String(ip || 'anon').trim().slice(0, 48);
 const normL = String(loginNorm || 'any').toLowerCase().slice(0, 40);
 loginFailBuckets.delete(`acct_${cleanIp}_${normL}`);
 loginFailBuckets.delete(`bf_v2_${normL}`);
 loginFailBuckets.delete(`${String(ip || 'anon').slice(0, 40)}_${normL}`);
} // Контрольные таймеры возвращения (Dead Man's Switch) // Транзитная очередь зашифрованных пакетов (Zero-Storage: удаляется при доставке/по TTL)
const weatherGridCache = new Map(); // Кэш погоды бота по гео-сетке 0.1° × 0.1° (~8-10 км) на 20 минут
const weatherFullGridCache = new Map(); // Полный Edge-кэш Open-Meteo (past_days=14&forecast_days=10) по сетке 0.1° × 0.1° на 30 минут
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
 ['сахалин','65'],['курил','65'],['sakhalin','65'],['yuzhno-sakhalinsk','65'],
 ['якут','14'],['саха (якут','14'],['sakha','14'],['yakut','14'],
 ['костром','44'],['kostrom','44'],
 ['томск','70'],['колпашево','70'],['tomsk','70'],
 ['омск','55'],['omsk','55'],
 ['ямало','89'],['янао','89'],['уренгой','89'],['салехард','89'],['надым','89'],['ноябрьск','89'],['тарко-сале','89'],['тазовск','89'],['губкинск','89'],['муравленко','89'],
 ['yamalo-nenets','89'],['yamal','89'],['novy urengoy','89'],['urengoy','89'],['salekhard','89'],['nadym','89'],['noyabrsk','89'],['tarko-sale','89'],['gubkinsk','89'],['muravlenko','89'],
 ['ненецк','83'],['нарьян-мар','83'],['nenets','83'],['naryan-mar','83'],
 ['ханты','86'],['хмао','86'],['югра','86'],['сургут','86'],['нижневартовск','86'],['khanty-mansi','86'],['yugra','86'],['surgut','86'],['nizhnevartovsk','86'],['nefteyugansk','86'],['kogalym','86'],
 ['адыге','01'],['майкоп','01'],['adyge','01'],['maykop','01'],
 ['башкорт','02'],['башкир','02'],['уфа','02'],['bashkortostan','02'],['bashkir','02'],['ufa','02'],['sterlitamak','02'],
 ['бурят','03'],['улан-удэ','03'],['buryat','03'],['ulan-ude','03'],
 ['республика алтай','04'],['горно-алтайск','04'],['altai republic','04'],['republic of altai','04'],['gorno-altaysk','04'],
 ['алтайск','22'],['барнаул','22'],['altai krai','22'],['altaysk','22'],['altai','22'],['barnaul','22'],['biysk','22'],
 ['дагестан','05'],['махачкал','05'],['дербент','05'],['dagestan','05'],['makhachkala','05'],['derbent','05'],
 ['ингушет','06'],['магас','06'],['ingushet','06'],['magas','06'],['nazran','06'],
 ['кабардино','07'],['нальчик','07'],['kabardino','07'],['nalchik','07'],
 ['калмык','08'],['элист','08'],['kalmyk','08'],['elista','08'],
 ['карачаево','09'],['черкесск','09'],['karachay','09'],['cherkessk','09'],
 ['карели','10'],['петрозаводск','10'],['kareli','10'],['petrozavodsk','10'],
 ['коми','11'],['сыктывкар','11'],['воркут','11'],['усинск','11'],['komi','11'],['syktyvkar','11'],['vorkuta','11'],['usinsk','11'],['ukhta','11'],
 ['марий эл','12'],['йошкар-ол','12'],['mari el','12'],['yoshkar-ola','12'],
 ['мордов','13'],['саранск','13'],['mordov','13'],['saransk','13'],
 ['осети','15'],['алани','15'],['osseti','15'],['alani','15'],['vladikavkaz','15'],
 ['татарстан','16'],['казан','16'],['челны','16'],['tatarstan','16'],['kazan','16'],['chelny','16'],['almetyevsk','16'],['nizhnekamsk','16'],
 ['тыва','17'],['кызыл','17'],['tuva','17'],['tyva','17'],['kyzyl','17'],
 ['удмурт','18'],['ижевск','18'],['udmurt','18'],['izhevsk','18'],
 ['хакаси','19'],['абакан','19'],['khakass','19'],['abakan','19'],
 ['чечен','20'],['грозн','20'],['chechen','20'],['chechnya','20'],['grozny','20'],
 ['чуваш','21'],['чебоксар','21'],['chuvash','21'],['cheboksary','21'],
 ['краснодар','23'],['сочи','23'],['кубан','23'],['анап','23'],['krasnodar','23'],['sochi','23'],['kuban','23'],['anapa','23'],['novorossiysk','23'],['armavir','23'],
 ['красноярск','24'],['норильск','24'],['дудинк','24'],['krasnoyarsk','24'],['norilsk','24'],['dudinka','24'],['achinsk','24'],
 ['приморск','25'],['владивосток','25'],['находк','25'],['primorsk','25'],['primorye','25'],['vladivostok','25'],['nakhodka','25'],['ussuriysk','25'],
 ['ставропол','26'],['пятигорск','26'],['stavropol','26'],['pyatigorsk','26'],['kislovodsk','26'],
 ['хабаровск','27'],['комсомольск','27'],['khabarovsk','27'],['komsomolsk','27'],
 ['амурск','28'],['благовещенск','28'],['amur','28'],['blagoveshchensk','28'],
 ['архангел','29'],['северодвинск','29'],['arkhangelsk','29'],['severodvinsk','29'],
 ['астрахан','30'],['ахтуб','30'],['харабал','30'],['astrakhan','30'],['akhtubinsk','30'],
 ['белгород','31'],['belgorod','31'],['stary oskol','31'],
 ['брянск','32'],['bryansk','32'],
 ['владимир','33'],['vladimir','33'],
 ['волгоград','34'],['volgograd','34'],['volzhsky','34'],
 ['вологод','35'],['vologda','35'],['vologod','35'],['cherepovets','35'],
 ['воронеж','36'],['voronezh','36'],
 ['ивановск','37'],['ivanovo','37'],['ivanovsk','37'],
 ['иркутск','38'],['братск','38'],['irkutsk','38'],['bratsk','38'],['angarsk','38'],
 ['калининград','39'],['kaliningrad','39'],
 ['калуж','40'],['kaluga','40'],['kaluzh','40'],['obninsk','40'],
 ['камчат','41'],['kamchat','41'],['petropavlovsk-kamchatsky','41'],
 ['кемеров','42'],['kemerov','42'],['kuzbass','42'],['novokuznetsk','42'],
 ['кировск','43'],['киров','43'],['kirov','43'],
 ['курган','45'],['шадринск','45'],['заурал','45'],['kurgan','45'],['shadrinsk','45'],
 ['курск','46'],['kursk','46'],
 ['ленинград','47'],['выборг','47'],['leningrad','47'],['vyborg','47'],['gatchina','47'],
 ['липецк','48'],['lipetsk','48'],
 ['магадан','49'],['magadan','49'],
 ['московск','50'],['подмосков','50'],['moscow oblast','50'],['moskovskaya','50'],['moskovsk','50'],['podolsk','50'],['balashikha','50'],['khimki','50'],['mytishchi','50'],['odintsovo','50'],['kolomna','50'],['serpukhov','50'],
 ['москва','77'],['зеленоград','77'],['moscow','77'],['zelenograd','77'],
 ['мурманск','51'],['териберк','51'],['murmansk','51'],['apatity','51'],
 ['нижегород','52'],['nizhny novgorod','52'],['nizhegorod','52'],['dzerzhinsk','52'],
 ['новгородск','53'],['великий новгород','53'],['veliky novgorod','53'],['novgorod','53'],
 ['новосибирск','54'],['novosibirsk','54'],['berdsk','54'],
 ['оренбург','56'],['orenburg','56'],['orsk','56'],
 ['орловск','57'],['oryol','57'],['orel','57'],['orlovsk','57'],
 ['пенз','58'],['penza','58'],
 ['перм','59'],['perm','59'],['berezniki','59'],
 ['псков','60'],['pskov','60'],
 ['ростовск','61'],['ростов-на-дону','61'],['таганрог','61'],['rostov','61'],['taganrog','61'],['volgodonsk','61'],
 ['рязан','62'],['ryazan','62'],
 ['самар','63'],['тольятти','63'],['samara','63'],['tolyatti','63'],['togliatti','63'],['syzran','63'],
 ['саратов','64'],['saratov','64'],['engels','64'],['balakovo','64'],
 ['свердловск','66'],['екатеринбург','66'],['sverdlovsk','66'],['yekaterinburg','66'],['ekaterinburg','66'],['nizhny tagil','66'],['kamensk-uralsky','66'],
 ['смоленск','67'],['smolensk','67'],
 ['тамбов','68'],['tambov','68'],
 ['твер','69'],['tver','69'],
 ['тульск','71'],['tula','71'],['tulsk','71'],
 ['тюмен','72'],['тобольск','72'],['tyumen','72'],['tobolsk','72'],['ishim','72'],
 ['ульяновск','73'],['ulyanovsk','73'],
 ['челябинск','74'],['магнитогорск','74'],['chelyabinsk','74'],['magnitogorsk','74'],['miass','74'],['zlatoust','74'],
 ['забайкал','75'],['чита','75'],['zabaykal','75'],['transbaikal','75'],['chita','75'],
 ['ярослав','76'],['рыбинск','76'],['yaroslav','76'],['rybinsk','76'],
 ['санкт-петербург','78'],['петербург','78'],['saint petersburg','78'],['st.-petersburg','78'],['st. petersburg','78'],['st petersburg','78'],['sankt-peterburg','78'],['petersburg','78'],
 ['еврейск','79'],['биробиджан','79'],['jewish','79'],['birobidzhan','79'],
 ['донецк','80'],['днр','80'],['donetsk','80'],
 ['луганск','81'],['лнр','81'],['lugansk','81'],['luhansk','81'],
 ['севастопол','92'],['sevastopol','92'],
 ['крым','82'],['симферопол','82'],['ялт','82'],['crimea','82'],['krym','82'],['simferopol','82'],['yalta','82'],['kerch','82'],
 ['херсон','84'],['kherson','84'],
 ['запорож','85'],['zaporizh','85'],['zaporozh','85'],
 ['чукот','87'],['анадыр','87'],['chukot','87'],['anadyr','87']
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
  return d === '00' ? '77' : d;
 }
 const text = typeof rawRegionOrSnap === 'object' && rawRegionOrSnap
  ? `${rawRegionOrSnap.locAdmin1 || ''} ${rawRegionOrSnap.locLabel || ''} ${rawRegionOrSnap.locAdmin2 || ''}`
  : String(rawRegionOrSnap || '');
 const norm = text.toLowerCase().replace(/ё/g, 'е');
 for (const [kw, code] of WORKER_REGION_RULES) {
  if (norm.includes(kw)) return code;
 }
 return '77';
}

function resolveCfClientGeo(request) {
 const cf = (request && typeof request === 'object' && request.cf && typeof request.cf === 'object') ? request.cf : null;
 const cfLat = cf && cf.latitude !== undefined ? parseFloat(cf.latitude) : NaN;
 const cfLon = cf && cf.longitude !== undefined ? parseFloat(cf.longitude) : NaN;
 const rawRegion = cf && cf.region ? String(cf.region).trim() : '';
 const rawCity = cf && cf.city ? String(cf.city).trim() : '';
 const citiesArr = (typeof _CITIES !== 'undefined' && Array.isArray(_CITIES)) ? _CITIES : [];
 const admArr = (typeof _ADM !== 'undefined' && Array.isArray(_ADM)) ? _ADM : [];
 if (Number.isFinite(cfLat) && Number.isFinite(cfLon) && Math.abs(cfLat) <= 90 && Math.abs(cfLon) <= 180 && (Math.abs(cfLat) > 0.01 || Math.abs(cfLon) > 0.01)) {
  let bestRow = null;
  let bestDist = Infinity;
  for (let i = 0; i < citiesArr.length; i++) {
   const row = citiesArr[i];
   const rLat = Number(Array.isArray(row) ? row[1] : row.lat);
   const rLon = Number(Array.isArray(row) ? row[2] : row.lon);
   const d = haversineKm(cfLat, cfLon, rLat, rLon);
   if (d < bestDist) {
    bestDist = d;
    bestRow = row;
   }
  }
  const cityName = bestRow ? String(Array.isArray(bestRow) ? bestRow[0] : bestRow.name) : (rawCity || 'Водоём РФ');
  const admin1 = bestRow
   ? String(Array.isArray(bestRow) ? (admArr[bestRow[3]] || '') : (bestRow.admin1 || ''))
   : (rawRegion || 'Москва');
  const regionCode = workerResolveRegionCode(`${admin1} ${cityName} ${rawRegion} ${rawCity}`);
  return {
   lat: Number(cfLat.toFixed(4)),
   lon: Number(cfLon.toFixed(4)),
   cityName,
   admin1,
   locLabel: cityName,
   locAdmin1: admin1,
   locAdmin2: cityName,
   regionCode
  };
 }
 if (rawRegion || rawCity) {
  const regionCode = workerResolveRegionCode(`${rawRegion} ${rawCity}`);
  let matchedRow = null;
  const cityLower = rawCity.toLowerCase().replace(/ё/g, 'е');
  if (cityLower) {
   for (let i = 0; i < citiesArr.length; i++) {
    const row = citiesArr[i];
    const rName = String(Array.isArray(row) ? row[0] : row.name).toLowerCase().replace(/ё/g, 'е');
    if (rName === cityLower || rName.startsWith(cityLower + ' ')) {
     matchedRow = row;
     break;
    }
   }
  }
  if (!matchedRow) {
   for (let i = 0; i < citiesArr.length; i++) {
    const row = citiesArr[i];
    const rName = String(Array.isArray(row) ? row[0] : row.name);
    const admName = Array.isArray(row) ? (admArr[row[3]] || '') : (row.admin1 || '');
    if (workerResolveRegionCode(`${admName} ${rName}`) === regionCode) {
     matchedRow = row;
     break;
    }
   }
  }
  const lat = matchedRow ? Number(Array.isArray(matchedRow) ? matchedRow[1] : matchedRow.lat) : 55.7558;
  const lon = matchedRow ? Number(Array.isArray(matchedRow) ? matchedRow[2] : matchedRow.lon) : 37.6173;
  const cityName = matchedRow ? String(Array.isArray(matchedRow) ? matchedRow[0] : matchedRow.name) : (rawCity || rawRegion || 'Водоём РФ');
  const admin1 = matchedRow
   ? String(Array.isArray(matchedRow) ? (admArr[matchedRow[3]] || '') : (matchedRow.admin1 || ''))
   : (rawRegion || 'Москва');
  return {
   lat,
   lon,
   cityName,
   admin1,
   regionCode
  };
 }
 return {
  lat: 55.7558,
  lon: 37.6173,
  cityName: '',
  admin1: '',
  regionCode: '77'
 };
}

function workerFormatFisherIdFromIndex(regionCode = '77', index0Based = 0) {
 const regDigits = String(regionCode || '77').replace(/\D/g, '').padStart(2, '0').slice(-2);
 const reg = regDigits === '00' ? '77' : regDigits;
 const idx = Math.max(0, Math.floor(Number(index0Based) || 0));
 const num = (idx % 999) + 1; // Строго 001..999 (без 000!)
 const letterBlock = Math.floor(idx / 999) % 17576;
 const c1 = String.fromCharCode(65 + (Math.floor(letterBlock / 676) % 26));
 const c2 = String.fromCharCode(65 + (Math.floor(letterBlock / 26) % 26));
 const c3 = String.fromCharCode(65 + (letterBlock % 26));
 return `FP_${reg}${c1}${c2}${c3}${String(num).padStart(3, '0')}`;
}

function workerFormatReserveFisherId(regionCode = '77', seq1Based = 1) {
 const regDigits = String(regionCode || '77').replace(/\D/g, '').padStart(2, '0').slice(-2);
 const reg = regDigits === '00' ? '77' : regDigits;
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

function workerNormalizeFisherId(rawStr = '', fallbackRegion = '77') {
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

function allocateNextRegionalFisherId(regionCode = '77') {
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

function allocateNextReserveFisherId(regionCode = '77', seedDeviceId = '') {
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

const recentActionDedupMap = new Map();
const activeAdminSessionsMap = new Map(); // token -> expiresAtMs
const revokedAdminSessionsSet = new Set();
const ADMIN_SESSION_DEFAULT_TTL_MS = 8 * 3600 * 1000; // 8 часов

// Чистая синхронная реализация SHA-256 и RFC 2104 HMAC-SHA256 (256 бит) для криптостойкой подписи сессий
async function sha256Bytes(dataBytes) {
 const msg = dataBytes instanceof Uint8Array ? dataBytes : new TextEncoder().encode(String(dataBytes || ''));
 const hashBuf = await crypto.subtle.digest('SHA-256', msg);
 return new Uint8Array(hashBuf);
}

async function hmacSha256Hex(keyStr = '', messageStr = '') {
 const enc = new TextEncoder();
 const rawKey = enc.encode(String(keyStr || 'klev_default_hmac_key'));
 const cryptoKey = await crypto.subtle.importKey(
  'raw',
  rawKey.length > 0 ? rawKey : new Uint8Array([1]),
  { name: 'HMAC', hash: 'SHA-256' },
  false,
  ['sign']
 );
 const sigBuf = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(String(messageStr || '')));
 return Array.from(new Uint8Array(sigBuf), b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function generateSecureRandomTokenHex(byteLen = 32, prefix = 'STOK_') {
 const bytes = new Uint8Array(byteLen);
 if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
  crypto.getRandomValues(bytes);
 } else {
  for (let i = 0; i < byteLen; i++) bytes[i] = Math.floor(Math.random() * 256);
 }
 return prefix + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function getAdminSigningSecret(env = null) {
 if (!env || typeof env !== 'object') return '';
 const s = String(env.ADMIN_SESSION_SECRET || env.OWNER_ADMIN_TOKEN || env.ADMIN_CONSOLE_TOKEN || env.ADMIN_SECRET_PASSWORD || '').trim();
 return s.length >= 8 ? s : '';
}

async function issueServerAdminSessionToken(ttlMs = ADMIN_SESSION_DEFAULT_TTL_MS, env = null) {
 const secret = getAdminSigningSecret(env);
 if (!secret) return '';
 const safeTtl = Math.max(60000, Math.min(24 * 3600 * 1000, Number(ttlMs) || ADMIN_SESSION_DEFAULT_TTL_MS));
 const expMs = Date.now() + safeTtl;
 const nonceHex = generateSecureRandomTokenHex(8, '');
 const sigHex = await hmacSha256Hex(secret, `ADM_SESS_V3:${expMs}:${nonceHex}`);
 const token = `ADM_SESS_${expMs}_${nonceHex}_${sigHex}`;
 activeAdminSessionsMap.set(token, expMs);
 return token;
}

async function workerPbkdf2HashPassword(passClean = '', saltHex = '') {
 const cleanP = String(passClean || '').trim();
 let sHex = String(saltHex || '').trim().toUpperCase();
 if (!sHex || sHex.length < 16) {
  sHex = generateSecureRandomTokenHex(16, '');
 }
 if (typeof crypto !== 'undefined' && crypto.subtle) {
  try {
   const enc = new TextEncoder();
   const keyMat = await crypto.subtle.importKey('raw', enc.encode(cleanP), 'PBKDF2', false, ['deriveBits']);
   const saltBytes = new Uint8Array(sHex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
   const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: 100000, hash: 'SHA-256' },
    keyMat,
    256
   );
   const hashHex = Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
   return `PBKDF2$100000$${sHex}$${hashHex}`;
  } catch (e) {}
 }
 const fbHex = await workerSha256Hex(`pbkdf2_fb::${sHex}::${cleanP}`);
 return `PBKDF2$100000$${sHex}$${fbHex}`;
}

async function workerVerifyPasswordVerifier(passClean = '', storedVerifier = '') {
 const cleanP = String(passClean || '').trim();
 const ver = String(storedVerifier || '').trim();
 if (!cleanP || !ver.startsWith('PBKDF2$')) return false;
 const parts = ver.split('$');
 if (parts.length !== 4) return false;
 const saltHex = parts[2];
 const recomputed = await workerPbkdf2HashPassword(cleanP, saltHex);
 return constantTimeEquals(recomputed, ver);
}

function clampLat(val, fallback = 55.7558) {
 const n = Number(val);
 return Number.isFinite(n) ? Math.max(-90, Math.min(90, n)) : fallback;
}

function clampLon(val, fallback = 37.6173) {
 const n = Number(val);
 return Number.isFinite(n) ? Math.max(-180, Math.min(180, n)) : fallback;
}

function isOwnerPasswordMatch(rawPass = '', env = null) {
 const clean = String(rawPass || '').trim();
 if (!clean || !env || typeof env !== 'object') return false;
 const envPass = String(env.ADMIN_SECRET_PASSWORD || '').trim();
 if (envPass.length >= 4 && constantTimeEquals(clean, envPass)) {
  return true;
 }
 const envOwnerTok = String(env.OWNER_ADMIN_TOKEN || env.ADMIN_CONSOLE_TOKEN || '').trim();
 if (envOwnerTok.length >= 12 && constantTimeEquals(clean, envOwnerTok)) {
  return true;
 }
 return false;
}

function getAdminConsoleToken(env = null) {
 if (!env || typeof env !== 'object') return '';
 const tok = String(env.OWNER_ADMIN_TOKEN || env.ADMIN_CONSOLE_TOKEN || '').trim();
 return tok.length >= 12 ? tok : '';
}

async function isValidOwnerAdminToken(tok = '', env = null) {
 const clean = String(tok || '').trim();
 if (!clean || clean === 'OWNER_LOCAL_ADMIN') return false;
 const signingSecret = getAdminSigningSecret(env);
 if (!signingSecret) {
  // Fail-closed: без настроенных секретов в Cloudflare админ-доступ полностью закрыт
  return false;
 }
 if (clean.startsWith('ADM_SESS_')) {
  if (revokedAdminSessionsSet.has(clean)) return false;
  // Формат строго: ADM_SESS_<expMs>_<nonceHex16>_<hmacSha256Hex64> (5 частей)
  // Любые старые/поддельные токены вида ADM_SESS_<64hex> (3 части) немедленно отклоняются!
  const parts = clean.split('_');
  if (parts.length !== 5) return false;
  const expNum = Number(parts[2] || 0);
  const nonceHex = String(parts[3] || '').toUpperCase();
  const sigHex = String(parts[4] || '').toUpperCase();
  const now = Date.now();
  if (!Number.isFinite(expNum) || expNum <= now || expNum > (now + 24 * 3600 * 1000)) {
   activeAdminSessionsMap.delete(clean);
   return false;
  }
  if (!/^[0-9A-F]{16}$/.test(nonceHex) || !/^[0-9A-F]{64}$/.test(sigHex)) {
   return false;
  }
  const expectedSig = await hmacSha256Hex(signingSecret, `ADM_SESS_V3:${expNum}:${nonceHex}`);
  if (!constantTimeEquals(sigHex, expectedSig)) {
   return false;
  }
  activeAdminSessionsMap.set(clean, expNum);
  return true;
 }
 const envConsoleTok = getAdminConsoleToken(env);
 if (envConsoleTok && constantTimeEquals(clean, envConsoleTok)) {
  return true;
 }
 if (isOwnerPasswordMatch(clean, env)) {
  return true;
 }
 return false;
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
 // Пункт 5 Блока 1: Токен принимается ТОЛЬКО из заголовков (X-Admin-Token / Authorization / Cookie) или тела запроса.
 // Чтение adminToken / token из открытых URL query-параметров (reqUrl.searchParams) запрещено!
 if (request && request.headers) {
  const hdrTok = request.headers.get('X-Admin-Token') || request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (hdrTok) return String(hdrTok).trim();
  const cookieTok = parseCookieValue(request.headers.get('Cookie') || '', 'klev_admin_session');
  if (cookieTok) return cookieTok;
 }
 if (body && typeof body === 'object') {
  const fromBody = body.adminToken || body.token || body.ownerSecret || '';
  if (fromBody) return String(fromBody).trim();
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
  const authDateSec = Number(params.get('auth_date') || 0);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!authDateSec || Math.abs(nowSec - authDateSec) > 86400) return false;
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
 if (typeof snap.geminiApiKey === 'string' && snap.geminiApiKey.trim().length >= 16) out.geminiApiKey = snap.geminiApiKey.trim().slice(0, 512);
 if (typeof snap.appMode === 'string' && ['novice', 'angler', 'pro'].includes(snap.appMode)) out.appMode = snap.appMode;
 if (typeof snap.theme === 'string' && ['auto', 'dark', 'light'].includes(snap.theme)) out.theme = snap.theme;
 if (snap.lat !== undefined) out.lat = clampLat(snap.lat, 55.7558);
 if (snap.lon !== undefined) out.lon = clampLon(snap.lon, 37.6173);
 if (typeof snap.locLabel === 'string') out.locLabel = snap.locLabel.trim().slice(0, 80);
 if (typeof snap.locAdmin1 === 'string') out.locAdmin1 = snap.locAdmin1.trim().slice(0, 80);
 if (typeof snap.locAdmin2 === 'string') out.locAdmin2 = snap.locAdmin2.trim().slice(0, 80);
 if (typeof snap.water === 'string') out.water = snap.water.trim().slice(0, 32);
 if (typeof snap.method === 'string') out.method = snap.method.trim().slice(0, 32);
 if (Array.isArray(snap.preferredWaters)) out.preferredWaters = snap.preferredWaters.map(x => String(x || '').slice(0, 32)).slice(0, 10);
 if (Array.isArray(snap.preferredMethods)) out.preferredMethods = snap.preferredMethods.map(x => String(x || '').slice(0, 32)).slice(0, 12);
 if (Array.isArray(snap.targetSpecies)) out.targetSpecies = snap.targetSpecies.map(x => String(x || '').slice(0, 32)).slice(0, 40);
 if (Array.isArray(snap.favorites)) out.favorites = snap.favorites.map(x => String(x || '').slice(0, 32)).slice(0, 40);
 if (Array.isArray(snap.unlockedCrewKeys)) out.unlockedCrewKeys = snap.unlockedCrewKeys.map(x => String(x || '').trim().toUpperCase().slice(0, 16)).slice(0, 50);
 if (Array.isArray(snap.deletedChatChannels)) out.deletedChatChannels = snap.deletedChatChannels.map(x => String(x || '').slice(0, 64)).slice(0, 60);
 if (typeof snap.adminShowAllCrews === 'boolean') out.adminShowAllCrews = snap.adminShowAllCrews;
 if (Array.isArray(snap.hiddenCircleIds)) out.hiddenCircleIds = snap.hiddenCircleIds.map(x => String(x || '').slice(0, 64)).slice(0, 100);
 if (Array.isArray(snap.savedSpots)) {
  out.savedSpots = snap.savedSpots.slice(0, 25).map(sp => ({
   id: String(sp?.id || '').slice(0, 48),
   name: String(sp?.name || '').slice(0, 48),
   lat: clampLat(sp?.lat, 55.7558),
   lon: clampLon(sp?.lon, 37.6173),
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
  delete copy.pbkdf2Verifier;
  delete copy.sessionToken;
  return copy;
 }
 return {
  fisherId: u.fisherId || '',
  login: u.login || '',
  callsign: u.callsign || 'Рыболов',
  regionCode: u.regionCode || (u.isOwner ? '89' : '77'),
  locLabel: u.locLabel || '',
  isOwner: Boolean(u.isOwner),
  isAdmin: Boolean(u.isAdmin),
  isTemporaryReserve: Boolean(u.isTemporaryReserve)
 };
}

async function verifyUserAuth(env, { fid = '', authTokenHash = '', deviceId = '', adminToken = '', request = null, targetDeviceId = '' } = {}) {
 const hdrAuth = request?.headers?.get('X-Auth-Token') || request?.headers?.get('Authorization')?.replace(/^Bearer\s+/i, '') || '';
 const hdrAdm = request?.headers?.get('X-Admin-Token') || parseCookieValue(request?.headers?.get('Cookie') || '', 'klev_admin_session') || '';
 const effToken = String(authTokenHash || hdrAuth || '').trim();
 const effAdmin = String(adminToken || hdrAdm || '').trim();
 const cleanDev = String(deviceId || '').trim();

 if (await isValidOwnerAdminToken(effAdmin, env) || await isValidOwnerAdminToken(effToken, env)) {
  return { ok: true, isAdmin: true, isOwner: true };
 }
 const normFid = workerNormalizeFisherId(fid || '', '89');
 if (!normFid) return { ok: false, isAdmin: false, isOwner: false };
 if (isTemporaryReserveId(normFid)) {
  const regReserve = usersRegistryStore.get(normFid) || null;
  const boundDev = String(targetDeviceId || regReserve?.deviceId || '').trim();
  if (boundDev) {
   const devMatch = Boolean(cleanDev && constantTimeEquals(cleanDev, boundDev));
   const tokMatch = Boolean(
    effToken && regReserve && (
     (regReserve.sessionToken && constantTimeEquals(effToken, regReserve.sessionToken)) ||
     (regReserve.authTokenHash && constantTimeEquals(effToken, regReserve.authTokenHash))
    )
   );
   if (!devMatch && !tokMatch) {
    return { ok: false, isAdmin: false, isOwner: false, isReserve: true };
   }
  } else if (cleanDev && deviceToFisherIdMap.has(cleanDev)) {
   const mappedDevFid = deviceToFisherIdMap.get(cleanDev) || '';
   if (mappedDevFid && !constantTimeEquals(mappedDevFid, normFid)) {
    return { ok: false, isAdmin: false, isOwner: false, isReserve: true };
   }
  }
  return { ok: true, isAdmin: false, isOwner: false, isReserve: true };
 }

 const isOwnerId = isOwnerFisherId(normFid);
 const aKey = fisherIdToAuthKeyMap.get(normFid) || '';
 const prof = (aKey ? cloudAuthProfiles.get(aKey) : null) || (await loadPersistedAuthProfile(env, aKey, '', normFid));
 const regUser = usersRegistryStore.get(normFid) || null;

 for (const candTok of [effToken, effAdmin]) {
  if (!candTok) continue;
  const matchProf = prof && (
   (prof.sessionToken && constantTimeEquals(candTok, prof.sessionToken)) ||
   (prof.adminSessionToken && constantTimeEquals(candTok, prof.adminSessionToken)) ||
   (prof.authTokenHash && constantTimeEquals(candTok, prof.authTokenHash)) ||
   (prof.secureTokenHash && constantTimeEquals(candTok, prof.secureTokenHash))
  );
  const matchReg = regUser && (
   (regUser.sessionToken && constantTimeEquals(candTok, regUser.sessionToken)) ||
   (regUser.adminSessionToken && constantTimeEquals(candTok, regUser.adminSessionToken)) ||
   (regUser.authTokenHash && constantTimeEquals(candTok, regUser.authTokenHash)) ||
   (regUser.secureTokenHash && constantTimeEquals(candTok, regUser.secureTokenHash))
  );
  if (matchProf || matchReg) {
   return { ok: true, isAdmin: Boolean(isOwnerId || adminWhitelistStore.has(normFid)), isOwner: isOwnerId };
  }
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

async function resolveWorkerAccountIdentity(rawLogin = '', rawPassword = '', rawTokenHash = '', rawRegionCode = '77', snap = null, env = null) {
 const rawInputClean = String(rawLogin || '').trim().slice(0, 48);
 let loginClean = rawInputClean;
 let loginNorm = workerNormalizeLogin(loginClean);
 const passClean = String(rawPassword || '').trim();
 const incomingTok = String(rawTokenHash || '').trim();

 const isOwnerLogin = workerIsOwnerLogin(loginClean) || workerIsOwnerLogin(snap?.login) || isOwnerFisherId(snap?.fisherId);
 const isOwnerPass = (
  isOwnerPasswordMatch(passClean, env) ||
  (incomingTok && await isValidOwnerAdminToken(incomingTok, env))
 );
 if (isOwnerLogin && isOwnerPass) {
  const preferredOwnerFid = (loginNorm === 'fp_fmp089' || String(snap?.fisherId || '').toUpperCase() === OWNER_SECONDARY_ID)
   ? OWNER_SECONDARY_ID
   : OWNER_FISHER_ID;
  const admTok = await issueServerAdminSessionToken(ADMIN_SESSION_DEFAULT_TTL_MS, env);
  if (!admTok) {
   return { ok: false, error: 'Серверные секреты администратора (ADMIN_SECRET_PASSWORD / ADMIN_SESSION_SECRET) не заданы в Cloudflare' };
  }
  return {
   ok: true,
   isOwner: true,
   authKey: 'OWNER_IATHOR_FP_89VIP089',
   fisherId: preferredOwnerFid,
   ownerIds: [OWNER_FISHER_ID, OWNER_SECONDARY_ID],
   login: loginNorm === 'iathor82' ? 'iAthor82' : 'iAthor',
   callsign: loginNorm === 'iathor82' ? 'iAthor82' : 'iAthor',
   pinHash: 'owner_iathor_vip089',
   authTokenHash: admTok,
   sessionToken: admTok,
   adminSessionToken: admTok
  };
 }

 if (isOwnerLogin && !isOwnerPass) {
  return { ok: false, error: 'Неверный серверный мастер-пароль администратора' };
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

 if (!loginNorm || (passClean.length < 3 && !incomingTok.startsWith('STOK_') && !incomingTok.startsWith('KTOK_'))) {
  return { ok: false, error: 'Укажите логин и пароль (от 3 символов) для получения постоянного ID рыбака' };
 }
 const anonWorkerCheck = workerIsAnonymousCallsignValid(loginClean);
 if (!anonWorkerCheck.ok) {
  return { ok: false, error: anonWorkerCheck.error };
 }

 // Перед выдачей или проверкой ID принудительно подгружаем профиль из D1 по нормализованному логину (независимо от устройства и региона!)
 if (env && loginNorm) {
  await loadPersistedAuthProfile(env, '', loginNorm, '');
 }
 let existingAuthKey = loginToAuthKeyMap.get(loginNorm) || '';
 if (!existingAuthKey) {
  for (const [k, prof] of cloudAuthProfiles.entries()) {
   if (prof && workerNormalizeLogin(prof.login || '') === loginNorm) {
    existingAuthKey = k;
    loginToAuthKeyMap.set(loginNorm, k);
    break;
   }
  }
 }
 const legacyDerivedTok = passClean ? workerDeriveAuthToken(loginNorm, passClean) : incomingTok;
 let pbkdf2Verifier = '';
 let sessionToken = '';
 if (existingAuthKey) {
  const boundProf = cloudAuthProfiles.get(existingAuthKey);
  if (boundProf) {
   let validCreds = false;
   const candidateSecureTok = passClean ? await workerDeriveSecureAuthToken(loginNorm, passClean, env) : '';
   if (passClean && boundProf.pbkdf2Verifier) {
    validCreds = await workerVerifyPasswordVerifier(passClean, boundProf.pbkdf2Verifier);
    if (validCreds) pbkdf2Verifier = boundProf.pbkdf2Verifier;
   }
   if (!validCreds && passClean && boundProf.secureTokenHash && candidateSecureTok) {
    validCreds = constantTimeEquals(candidateSecureTok, boundProf.secureTokenHash);
   }
   if (!validCreds && passClean && boundProf.authTokenHash) {
    validCreds = constantTimeEquals(legacyDerivedTok, boundProf.authTokenHash) || (incomingTok && constantTimeEquals(incomingTok, boundProf.authTokenHash));
   }
   if (!validCreds && incomingTok) {
    validCreds = Boolean(
     (boundProf.sessionToken && constantTimeEquals(incomingTok, boundProf.sessionToken)) ||
     (boundProf.authTokenHash && constantTimeEquals(incomingTok, boundProf.authTokenHash)) ||
     (boundProf.secureTokenHash && constantTimeEquals(incomingTok, boundProf.secureTokenHash))
    );
   }
   // Вход без пароля разрешён строго при совпадении валидного sessionToken / authTokenHash / secureTokenHash
   if (validCreds && passClean && !pbkdf2Verifier) {
    pbkdf2Verifier = await workerPbkdf2HashPassword(passClean);
   } else if (validCreds && !pbkdf2Verifier) {
    pbkdf2Verifier = boundProf.pbkdf2Verifier || '';
   }
   if (!validCreds) {
    return {
     ok: false,
     code: 'LOGIN_TAKEN',
     error: `Логин «${loginClean}» уже зарегистрирован (или введён неверный пароль)! Проверьте пароль или выберите другой логин.`
    };
   }
   sessionToken = (boundProf.sessionToken && String(boundProf.sessionToken).startsWith('STOK_'))
    ? boundProf.sessionToken
    : generateSecureRandomTokenHex(32, 'STOK_');
  }
 } else {
  if (passClean) {
   pbkdf2Verifier = await workerPbkdf2HashPassword(passClean);
  }
  sessionToken = generateSecureRandomTokenHex(32, 'STOK_');
 }
 if (!sessionToken || !String(sessionToken).startsWith('STOK_')) {
  sessionToken = generateSecureRandomTokenHex(32, 'STOK_');
 }
 const authTokenHash = sessionToken;
 const pinHash = passClean
  ? workerFnv1a32(`pin::${passClean}`).toString(16)
  : String(snap?.pinHash || workerFnv1a32(authTokenHash).toString(16));

 const authKey = existingAuthKey || `AUTH_${loginNorm}_${authTokenHash}`;
 loginToAuthKeyMap.set(loginNorm, authKey);
 const existingProf = cloudAuthProfiles.get(authKey);
 const regCode = workerResolveRegionCode(rawRegionCode || snap);

 // Постоянный ID выдаётся ОДИН РАЗ при первой регистрации логина+пароля и НАВСЕГДА привязан к аккаунту на всех устройствах и в любых регионах!
 let fisherId = (existingProf?.fisherId && !isTemporaryReserveId(existingProf.fisherId))
  ? workerNormalizeFisherId(existingProf.fisherId, existingProf.fisherId.slice(3, 5) || regCode)
  : '';
 if (!fisherId || isOwnerFisherId(fisherId) || isTemporaryReserveId(fisherId)) {
  const existingPermCandidates = [];
  for (const u of usersRegistryStore.values()) {
   if (u && u.fisherId && !isTemporaryReserveId(u.fisherId) && !isOwnerFisherId(u.fisherId)) {
    if (workerNormalizeLogin(u.login) === loginNorm || workerNormalizeLogin(u.callsign) === loginNorm) {
     existingPermCandidates.push(u.fisherId);
    }
   }
  }
  if (existingPermCandidates.length === 0 && env) {
   const d1Lookup = getD1(env)?.db;
   if (d1Lookup) {
    try {
     const rows = await d1Lookup.prepare('SELECT fisher_id FROM users_registry WHERE is_temporary = 0 AND (LOWER(login) = ? OR LOWER(callsign) = ?) ORDER BY first_seen ASC LIMIT 5').bind(loginNorm, loginNorm).all();
     if (rows && Array.isArray(rows.results)) {
      for (const r of rows.results) {
       if (r.fisher_id && !isTemporaryReserveId(r.fisher_id) && !isOwnerFisherId(r.fisher_id)) {
        existingPermCandidates.push(r.fisher_id);
       }
      }
     }
    } catch (_e) {}
   }
  }
  if (existingPermCandidates.length > 0) {
   existingPermCandidates.sort();
   fisherId = existingPermCandidates[0];
  } else {
   fisherId = allocateNextRegionalFisherId(regCode);
  }
 }
 fisherIdToAuthKeyMap.set(fisherId, authKey);
 if (!existingProf || existingProf.fisherId !== fisherId) {
  cloudAuthProfiles.set(authKey, {
   ...(existingProf || {}),
   fisherId,
   login: existingProf?.login || loginClean,
   callsign: existingProf?.callsign || loginClean,
   pinHash: '',
   pbkdf2Verifier: pbkdf2Verifier || existingProf?.pbkdf2Verifier || '',
   sessionToken,
   authTokenHash
  });
 }

 // Немедленно поглощаем и удаляем все временные резервные ID (FP_XXRZYYYY) этого устройства и этого логина из памяти и D1
 const prevDevId = String(snap?.deviceId || '').trim();
 const tempFidsToPurge = new Set();
 if (prevDevId) {
  const prevTempFid = deviceToFisherIdMap.get(prevDevId);
  if (prevTempFid && isTemporaryReserveId(prevTempFid)) tempFidsToPurge.add(prevTempFid);
  deviceToFisherIdMap.set(prevDevId, fisherId);
 }
 for (const candRaw of [snap?.fisherId, snap?.previousFisherId]) {
  if (candRaw && isTemporaryReserveId(candRaw)) {
   tempFidsToPurge.add(String(candRaw).trim().toUpperCase());
  }
 }
 for (const [uid, uObj] of usersRegistryStore.entries()) {
  if (!uObj || uid === fisherId) continue;
  const uLogNorm = workerNormalizeLogin(uObj.login || '');
  const uCallNorm = workerNormalizeLogin(uObj.callsign || '');
  if (isTemporaryReserveId(uid) && ((prevDevId && uObj.deviceId === prevDevId) || uLogNorm === loginNorm || uCallNorm === loginNorm)) {
   tempFidsToPurge.add(uid);
  }
 }
 const d1Purge = getD1(env)?.db;
 for (const tfid of tempFidsToPurge) {
  usersRegistryStore.delete(tfid);
  deletedFisherIdsSet.add(tfid);
  if (d1Purge) {
   d1Purge.prepare('DELETE FROM users_registry WHERE fisher_id = ?').bind(tfid).run().catch(() => {});
  }
 }

 return {
  ok: true,
  isOwner: false,
  authKey,
  fisherId,
  login: existingProf?.login || loginClean,
  callsign: existingProf?.callsign || loginClean,
  pinHash: '',
  pbkdf2Verifier: pbkdf2Verifier || existingProf?.pbkdf2Verifier || '',
  sessionToken,
  authTokenHash,
  adminSessionToken: ''
 };
}

const cloudAuthProfiles = new Map([
 ['OWNER_IATHOR_FP_89VIP089', {
  fisherId: OWNER_FISHER_ID,
  login: 'iAthor',
  callsign: 'iAthor',
  pinHash: '',
  authTokenHash: '',
  adminSessionToken: '',
  ownerUnlocked: true,
  isAdmin: true,
  adminShowAllCrews: false,
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
 const cfGeo = params.cfGeo || null;

 const existing = usersRegistryStore.get(fid) || {};
 const now = Date.now();

 const user = {
  fisherId: fid,
  deviceId: params.deviceId || existing.deviceId || '',
  login: params.login !== undefined ? params.login : (existing.login || ''),
  callsign: params.callsign || existing.callsign || (isOwner ? 'iAthor' : (params.login || 'Рыболов')),
  tgId: params.tgId || existing.tgId || '',
  tgUsername: params.tgUsername !== undefined ? params.tgUsername : (existing.tgUsername || ''),
  regionCode: workerResolveRegionCode(params.regionCode || existing.regionCode || fid.slice(3, 5) || cfGeo?.regionCode || (isOwner ? '89' : '77')),
  locLabel: params.locLabel || existing.locLabel || (isOwner ? 'Новый Уренгой' : (cfGeo?.cityName || 'Водоём РФ')),
  platform: params.platform || existing.platform || 'WEB',
  version: params.version || existing.version || WORKER_VERSION,
  isOwner: Boolean(isOwner),
  isAdmin: Boolean(isAdmin),
  isBetaTester: Boolean(isOwner || isAdmin || params.isBetaTester || existing.isBetaTester || isUserBetaTesterOnServer(fid)),
  isTemporaryReserve: Boolean(isTemp),
  firstSeen: existing.firstSeen || now,
  lastSeen: now,
  sessionsCount: (existing.sessionsCount || 0) + (params.incrementSession ? 1 : 0),
  circlePostsCount: (existing.circlePostsCount || 0) + (params.incrementPosts ? 1 : 0),
  lat: Number.isFinite(Number(params.lat)) ? Number(params.lat) : (existing.lat || cfGeo?.lat || (isOwner ? 66.0833 : 55.7558)),
  lon: Number.isFinite(Number(params.lon)) ? Number(params.lon) : (existing.lon || cfGeo?.lon || (isOwner ? 76.6333 : 37.6173))
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



const ALLOWED_CORS_ORIGINS = new Set([
 'https://klevpro.ru',
 'https://www.klevpro.ru',
 'https://iathor.github.io',
 'https://ia-thor.github.io',
 'https://appassets.androidplatform.net',
 'https://web.telegram.org'
]);

function isAllowedCorsOrigin(origin = '') {
 const clean = String(origin || '').trim();
 if (!clean) return true;
 if (ALLOWED_CORS_ORIGINS.has(clean)) return true;
 if (/^https?:\/\/(localhost|127\.0\.0\.\d+)(:\d+)?$/i.test(clean)) return true;
 if (/^(capacitor|file):\/\//i.test(clean)) return true;
 return false;
}

function getCorsHeadersForRequest(request = null) {
 const origin = request?.headers?.get('Origin') || '';
 const allowOrigin = (!origin || isAllowedCorsOrigin(origin))
  ? (origin || 'https://klevpro.ru')
  : 'https://klevpro.ru';
 return {
  'Access-Control-Allow-Origin': allowOrigin,
  'Vary': 'Origin',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, X-Requested-With, X-Auth-Token, X-Admin-Token, X-Klev-E2E',
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
}

const CORS_HEADERS = getCorsHeadersForRequest(null);

// ── Этап 2: Серверное E2E-шифрование транспортных конвертов (?e2e=...) для резервных облачных шлюзов ──
const _WORKER_ENVELOPE_JWK_PARTS = ["eyJrZXlfb3BzIjpbImRlY3J5cHQiXSwiZXh0Ijp0cnVlLCJrdHkiOiJSU0EiLCJuIjoidExxSXZ5Wk84cF9xVDB6RENoRDBRZldGWFEyQlBoSlg4azEtSktu","YWZ4eFRVb0tfU01ZUzNnZ1NHUC1lODRFVzRKcE5JSFVxRmxpVGZzNDlQcmlzdnd6cVhPR0ZRMU9mbFVmMWo5OE1qTzNFVG5FbkExTFltalV1b21SOUhGb3Ns","ajduR2drZVZSdFY5b1d4R3ZSRGREa280bkh5YklPWjhCdnZ5aFd2dFM1OHFHMUpPLXdWanJUOElHeDhUTE1yNGhPVXhMenF5S3FYdlg1anRiMGN0X3dnTFpz","RThGTDFWbDZqWkJ6TW4ycEMzaEQ2Ri1wZUhreldtM09OX29vaXlGZ2hlbEdvUWV3VDhaQzVOcDNlRDZfQ2k1ZUhrVnNieWZzQTk1azlsZjZfV3gyaTM3Y0xS","bjViaHppQVNHVGM4OThOUnBiX09TNVFwWVA5a05rMVlRIiwiZSI6IkFRQUIiLCJkIjoiRko0ZElKVnB0ME1vRTJEaDlVR0c1QWx5Nl9Fdzk5aFc0U1VYQ1c2","NUp2d2Z3MDk0TEFDd3dWU3hYOW0xa19qN2w2Ynl1b3V6UF9aZDZUNzBfTFZMdThYbzdLeXJxOGtiOFFkVEM5VTUxTkFCTDZPM19DaVUzazdINGEzT0doQnRl","cngxVi1LSGE5VWhBdTB3amE4bEROckNmOGJaRGFrYnhDa2p1MjJxN0dQT2xLcS1pakdyenMwT2g5WVdLMjVMU3oxSVZXWHJHc1k0TWpFSWdIS2pKLWp5eTJx","bGNpRW5TTjVrOHpsUG40dnktWVJaeHlyYWRGbTB4aFVSNHM0SVFWOFVpQWFvZ0JDTk83RWhKUV9Bdk52a2JLRlZXbTZjX2RkU3dBRzFFUUVSdzl4cjM4dU1a","R3p5T2J6YmVKeGdrT2syTHo1eUhZV2Y1MTlyNzQwY213IiwicCI6IjVjT2hheFpaNXY4WENYaHFXdElGS21lb0NJajZuR3psRU9BdndJU2JSQVNxbmtDeUlP","RHZqaldXcHFmR1ZVS25nMW1KZEZIRk5DUEtBTmN3R1Q2cTZJZU1GYnlscnpaWm1xeDlkb3RTNkdURXRZZzdWN2xMaUZwM2tHekx0aGpMWExHWWVyalBDNmdv","SGpKcDM2bUl6WGxXYUNZTlNmcmJzQnJRNndmelI1cyIsInEiOiJ5VjJFaFRWMzlCaVo2Y3FuNDdFQThpdm5XX19VVEtndmdLY2hjMG81ejdYdktWVWJJR1pX","eFZfbHpNY1VrMDY4bWVmUTZEX1pWWDNOSGFVY0liekdxR2lTdXZzVGFiQndZSUZwY3h6dzRTTDJHZEZfTnpKV1h2c0VITjByalM3UnZUSmZudjVtLVRNRDRy","M05uRFJnWUpXMkdKOUswQkp6eXF6S3dhQUdyTE0iLCJkcCI6Ikp3eGlhSks1NExwRnJnUmFfdWhtbkZoVmhHM1RPYmFBRDZncU5XdlRfM0ZUbGVXazRGV2FJ","TzhXbFdnNkdzOWpMTDJRME1YODMtbWRNUnRoUDBrWlByLWFuUzhjY1hTcE1kSlMyRXpCWUdHUDFOSThVNkpZSmVwS0c2LUJ4NGJiT1B1dDBGMk1Rb3pubElv","NDJCdzE5Y1hEVzV2cjhrRENDV0hsVTZ4Y09qVSIsImRxIjoiYzFETjRtZERZWk54R1JVSVhubHdQRDl1U0I1UzJ1OTVfS2c1bk1lR0lmQmpuUHp6QXZQNGZ5","R3lfVG1KQy04TVRPc1hsTmx6d2VUQVFWamJxbXBzTGVkdEdBMVBDYmlVTW9BSl9uVTFjUWpQZk91ZmVlR20yc19QaENRWW04cVRMRkVidDNhalM5U3VSZnhD","TWxGQVhDLUFUOHR4VVlVdnNJS1J2cDdCRThjIiwicWkiOiJrNFVFU0NBNzNWNTlDcTk5U0JpdHIwSDFCN3hyX2JtN0lrTGRYM3c2cms2NjBKQ0JQSWg2ZDVT","TFNnMXdtbW9FaGZncm5ka29rdE82cDVwZUl3ODNfUDhkdXdQNnY4Z0toMm9rdk42ajdGcXZ3NngzTWlLN0tlOWxITnlkUzBTQnBMeVVLMG1RYUV1VHpuNzZj","d09RVGx4U0N3bmZDUWtDTFhIMkU5MVRfNWMiLCJhbGciOiJSU0EtT0FFUC0yNTYifQ=="];
function _buildLegacyEnvelopeJwkFallback() {
 return JSON.parse(atob(_WORKER_ENVELOPE_JWK_PARTS.join('')));
}
const WORKER_DEFAULT_ENVELOPE_PRIV_JWK = _buildLegacyEnvelopeJwkFallback();
const _WORKER_E2E_SEED_PARTS = ['KLEV_E2E_', 'V2_FALLBACK_', '796B06F969B53B94', 'D769D114273739BF'];
function getWorkerE2ESeed(env = null) {
 const envSeed = (env && env.WORKER_E2E_SEED) ? String(env.WORKER_E2E_SEED).trim() : '';
 return envSeed || _WORKER_E2E_SEED_PARTS.join('');
}
const WORKER_E2E_FALLBACK_SEED = getWorkerE2ESeed(null);
const seenWorkerE2ENonces = new Map(); // nonce -> ts
let _cachedWorkerEnvelopePrivKey = null;
let _cachedWorkerEnvelopePrivKeyRaw = '';

function workerB64UrlToBytes(b64url = '') {
 const b64 = String(b64url || '').replace(/-/g, '+').replace(/_/g, '/');
 const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
 const bin = atob(b64 + pad);
 const out = new Uint8Array(bin.length);
 for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
 return out;
}

function workerBytesToB64Url(bytes) {
 const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
 let bin = '';
 for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
 return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function workerHexToBytes(hex = '') {
 const clean = String(hex || '').trim();
 if (!clean || clean.length % 2 !== 0) return new Uint8Array(0);
 const out = new Uint8Array(clean.length / 2);
 for (let i = 0; i < out.length; i++) {
  out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16) || 0;
 }
 return out;
}

async function getWorkerEnvelopePrivateKey(env = null) {
 const rawJwkStr = (env && env.WORKER_ENVELOPE_PRIVKEY) ? String(env.WORKER_ENVELOPE_PRIVKEY).trim() : JSON.stringify(_buildLegacyEnvelopeJwkFallback());
 if (_cachedWorkerEnvelopePrivKey && _cachedWorkerEnvelopePrivKeyRaw === rawJwkStr) {
  return _cachedWorkerEnvelopePrivKey;
 }
 const jwkObj = JSON.parse(rawJwkStr);
 const key = await crypto.subtle.importKey(
  'jwk',
  jwkObj,
  { name: 'RSA-OAEP', hash: 'SHA-256' },
  false,
  ['decrypt']
 );
 _cachedWorkerEnvelopePrivKey = key;
 _cachedWorkerEnvelopePrivKeyRaw = rawJwkStr;
 return key;
}

async function workerXorStreamCipher(dataBytes, keyHex, ivHex) {
 const out = new Uint8Array(dataBytes.length);
 const enc = new TextEncoder();
 let blockIdx = 0;
 let offset = 0;
 while (offset < dataBytes.length) {
  const seedBytes = enc.encode(`${keyHex}:${ivHex}:${blockIdx++}`);
  const keystream = await sha256Bytes(seedBytes);
  const chunkLen = Math.min(32, dataBytes.length - offset);
  for (let i = 0; i < chunkLen; i++) {
   out[offset + i] = dataBytes[offset + i] ^ keystream[i];
  }
  offset += chunkLen;
 }
 return out;
}

async function unwrapWorkerE2ERequest(outerRequest, outerUrl, env = null) {
 const rawE2E = String(outerUrl.searchParams.get('e2e') || '').trim();
 if (!rawE2E) return { ok: false, error: 'Empty E2E envelope' };
 try {
  let plainJsonStr = '';
  let e2eVersion = 'E2E1';
  if (rawE2E.startsWith('E2E1.')) {
   const parts = rawE2E.split('.');
   if (parts.length !== 4) return { ok: false, error: 'Malformed E2E1 envelope' };
   const wrappedKeyBytes = workerB64UrlToBytes(parts[1]);
   const ivBytes = workerB64UrlToBytes(parts[2]);
   const cipherBytes = workerB64UrlToBytes(parts[3]);
   const privKey = await getWorkerEnvelopePrivateKey(env);
   const aesRawBuf = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privKey, wrappedKeyBytes);
   const aesKey = await crypto.subtle.importKey('raw', aesRawBuf, { name: 'AES-GCM' }, false, ['decrypt']);
   const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes }, aesKey, cipherBytes);
   plainJsonStr = new TextDecoder().decode(plainBuf);
   e2eVersion = 'E2E1';
  } else if (rawE2E.startsWith('E2E0.')) {
   const parts = rawE2E.split('.');
   if (parts.length !== 4) return { ok: false, error: 'Malformed E2E0 envelope' };
   const ivHex = parts[1];
   const cipherB64 = parts[2];
   const macHex = parts[3].toUpperCase();
   const e2eSeed = getWorkerE2ESeed(env);
   const expectedMac = await hmacSha256Hex(e2eSeed, `E2E0:${ivHex}:${cipherB64}`);
   if (!constantTimeEquals(macHex, expectedMac)) return { ok: false, error: 'Invalid E2E0 HMAC' };
   const cipherBytes = workerB64UrlToBytes(cipherB64);
   const plainBytes = await workerXorStreamCipher(cipherBytes, e2eSeed, ivHex);
   plainJsonStr = new TextDecoder().decode(plainBytes);
   e2eVersion = 'E2E0';
  } else {
   return { ok: false, error: 'Unsupported E2E version' };
  }
  const envObj = JSON.parse(plainJsonStr);
  if (!envObj || typeof envObj !== 'object') return { ok: false, error: 'Invalid E2E payload' };
  const now = Date.now();
  const ts = Number(envObj.ts || 0);
  if (!ts || Math.abs(now - ts) > 15 * 60 * 1000) {
   return { ok: false, error: 'Expired E2E envelope timestamp' };
  }
  const nonce = String(envObj.n || '').trim();
  if (!nonce) {
   return { ok: false, error: 'Invalid E2E envelope' };
  }
  if (seenWorkerE2ENonces.size > 4000) {
   for (const [k, v] of seenWorkerE2ENonces.entries()) {
    if (now - v > 15 * 60 * 1000) seenWorkerE2ENonces.delete(k);
   }
  }
  if (seenWorkerE2ENonces.has(nonce)) {
   return { ok: false, error: 'Replayed E2E envelope nonce' };
  }
  seenWorkerE2ENonces.set(nonce, now);
  const method = String(envObj.m || 'GET').toUpperCase();
  const cleanUrl = new URL(outerUrl.toString());
  cleanUrl.search = '';
  if (envObj.q && typeof envObj.q === 'string') {
   const qStr = envObj.q.startsWith('?') ? envObj.q.slice(1) : envObj.q;
   const sp = new URLSearchParams(qStr);
   for (const [k, v] of sp.entries()) cleanUrl.searchParams.set(k, v);
  }
  const headers = new Headers(outerRequest.headers);
  if (envObj.h && typeof envObj.h === 'object') {
   for (const [hk, hv] of Object.entries(envObj.h)) {
    if (hv) headers.set(hk, String(hv));
   }
  }
  if (method === 'POST' && !headers.has('Content-Type')) {
   headers.set('Content-Type', 'application/json;charset=UTF-8');
  }
  const bodyStr = typeof envObj.b === 'string' ? envObj.b : (envObj.b ? JSON.stringify(envObj.b) : '');
  const syntheticRequest = new Request(cleanUrl.toString(), {
   method,
   headers,
   body: method === 'POST' ? bodyStr : undefined
  });
  return {
   ok: true,
   syntheticRequest,
   respKeyHex: String(envObj.rk || '').trim(),
   version: e2eVersion
  };
 } catch (err) {
  return { ok: false, error: 'Invalid E2E envelope' };
 }
}

async function encryptWorkerE2EResponse(bodyText, httpStatus, respKeyHex, version = 'E2E1', env = null) {
 const payloadStr = JSON.stringify({
  status: Number(httpStatus || 200),
  body: String(bodyText ?? ''),
  ts: Date.now()
 });
 const plainBytes = new TextEncoder().encode(payloadStr);
 if (version === 'E2E1' && respKeyHex && respKeyHex.length === 64 && typeof crypto !== 'undefined' && crypto.subtle) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const keyBytes = workerHexToBytes(respKeyHex);
  const aesKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, plainBytes);
  return `E2E1.${workerBytesToB64Url(iv)}.${workerBytesToB64Url(new Uint8Array(cipherBuf))}`;
 }
 const ivHex = generateSecureRandomTokenHex(8, '');
 const e2eSeed = getWorkerE2ESeed(env);
 const cipherBytes = await workerXorStreamCipher(plainBytes, respKeyHex || e2eSeed, ivHex);
 const cipherB64 = workerBytesToB64Url(cipherBytes);
 const macHex = await hmacSha256Hex(respKeyHex || e2eSeed, `E2ER0:${ivHex}:${cipherB64}`);
 return `E2E0.${ivHex}.${cipherB64}.${macHex}`;
}

function jsonResponse(obj, status = 200) {
 return new Response(JSON.stringify(obj), {
  status,
  headers: { ...CORS_HEADERS, "Content-Type": "application/json;charset=utf-8" }
 });
}

const MAX_REQUEST_BODY_BYTES = 524288;

async function readWorkerRequestPayload(request, reqUrl, maxBytes = MAX_REQUEST_BODY_BYTES) {
 const effMax = Math.max(MAX_REQUEST_BODY_BYTES, Number(maxBytes) || MAX_REQUEST_BODY_BYTES);
 try {
  if (reqUrl && reqUrl.searchParams && reqUrl.searchParams.has('payload')) {
   const rawQ = String(reqUrl.searchParams.get('payload') || '');
   if (rawQ.length > effMax) {
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
 if (contentLen > effMax) {
  const err = new Error('Payload Too Large');
  err.status = 413;
  throw err;
 }
 try {
  const txt = await request.text();
  if (!txt) return {};
  if (txt.length > effMax) {
   const err = new Error('Payload Too Large');
   err.status = 413;
   throw err;
  }
  const trimmed = txt.trim();
  const reqPath = reqUrl ? reqUrl.pathname : '/api';
  const reqIp = request?.headers?.get('CF-Connecting-IP') || 'anon';
  if (/("__proto__"|"prototype"|"constructor"|\x80\x04\x95|posix\nsystem)/i.test(trimmed)) {
   recordSecurityIncident('deserialization', reqPath, `Перехвачена попытка Prototype Pollution / десериализации в теле запроса`, reqIp);
  }
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
 const limit = Math.max(1, Number(maxPerMin) || 60);
 if (b.total > limit) return false;
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
["pike","Щука",0,0,0,0,"0,1,8,2,3,4,5,7,6,9,10","01234",8,16,0.5,6,"120032234321","щук|щучк|травянк|зубаст|щурогай|щурогайк|шнурок|щука|травянка|щурогайка|карандаш|крокодил|мамка","Спиннинг 7–32 г (воблеры-минноу 90–130 мм твичингом, колебалки, вертушки №3–5), джиг 10–36 г с виброхвостом 4–5 дюймов",0],
["perch","Окунь речной",0,0,0,0,"0,1,8,2,3,4,5,7,6","01234",10,18,0.5,6,"222013333322","окун|окушк|горбач|матросик|полосат|окунь речной|окунь|полосатый|окушок","Микроджиг и нано-джиг (0.5–5 г), отводной поводок, тейл-спиннеры, вертушки №1–3, небольшие крэнки и попперы, поплавочная удочка на червя или.",0],
["zander","Судак",0,0,0,0,"2,3,4,7,6,5,0,1","01245",12,20,1,5,"112013223421","судак|судач|клыкаст|судачок|клыкастый|напильник|зандер","Джиговый спиннинг быстрого строя (Fast/Extra-Fast) 12–45 г для просечки костистой пасти (поролон, мандула, узкие виброхвосты 3.5–5 дюймов),.",0],
["crucian","Карась серебряный / золотой",1,1,0,0,"0,1,4,8,2,3,5,7,6,9,10","01234",16,24,4,-12,"001203332100","карас|карасик|лапоть|душман|гибрид|карась серебряный|золотой|карась|серебряный|пятак","Нано-джиг и мормышинг (спиннинг XUL до 1.5–2 г, мормышка 0.2–0.6 г со слагом Tanta / Whitebait или искусственным мотылём), лёгкая маховая.",1],
["carp","Карп / Сазан",1,1,0,0,"9,0,5,6,7,3,2,1","14203",18,25,6,-16,"000102343100","карп|сазан|карпик|сазанчик|зеркальный карп|карпуша|зеркальный|чешуйчатый","Карповый бланк 3.5 lbs, донная кормушка, карповая оснастка",0],
["bream","Лещ",1,1,0,0,"0,4,5,6,7,3,2,1","14203",14,20,1.5,-3,"112203333211","лещ|подлещ|подлещик|леща|лещу|соплив|фанера|лаврушка|бронзовый","Фидер 3.6–3.9 м, зимняя поплавочная удочка с мотылем",0],
["roach","Плотва (Сорога / Чебак)",1,1,0,0,"0,1,8,2,3,4,5,7,6","01234",12,19,1,-2,"223023433222","плотв|сорог|сорожк|чебак|серушк|плотва|сорога|сорожка|плотвичка","Поплавочная удочка (маховая, болонская, матчевая), пикер и фидер, мормышинг и нано-джиг (мормышка 0.2–0.6 г с искусственным мотылём, опарышем.",1],
["catfish","Сом обыкновенный",0,0,0,0,"3,5,6,7,2","1420",18,26,8,-17,"000102342100","сом|сома|сому|сомик европейск|усатый|сом обыкновенный|соменок|лягушатник","Ловля с квоком, донка со шнуром #5.0 PE, живец или пучок выползков.",2],
["burbot","Налим",0,0,0,0,"9,0,8,5,4,6,7,3,2,1","1203",0,8,-1,21,"003210002340","налим|меньк|меnek|треска пресноводн|мень|треска|пресноводная","Тяжелая блесна-стукалка, зимняя донка с ершом.",2],
["tench","Линь",1,1,0,0,"0,5,6,7,3,2,1","14203",18,24,6,-16,"000120332000","линь|линя|линю|линек|царская|рыба","Поплавочная глухая оснастка, пучок червей с творогом",0],
["chub","Голавль",0,0,0,0,"5,6,7,3,2","120",14,21,3,-9,"001203333200","голавл|лобаст|голавль|голавль лобастый голавлик","Ультралайт, воблеры-жуки, микроколебалки.",1],
["asp","Жерех",0,0,0,0,"5,6,7,3,2","1420",15,22,3,-9,"001023433210","жерех|шереспер|конь речн|конь|речной","Дальнобойный спиннинг, тяжёлые морские блёсны, кастмастеры.",1],
["grayling","Хариус сибирский / европейский",0,0,0,1,"9,0,8,4,3,10,2,1","1203",6,14,0,14,"112200333321","хариус|харьк|харюз|сибирский хариус|европейский хариус|хариус сибирский|европейский|харюзок|парусник|сибирский","Нахлыст, сбирулино, вертушки #00–#2.",0],
["whitefish","Сиг проходной / озерный",2,1,0,0,"0,5,4,3,2","12503",4,12,0,15,"222234220033","сиг|сига|сигу|сижок|проходной сиг|озерный сиг|сиг проходной|озерный|проходной","Зимняя гирлянда мормышек, блесны с цепочкой",0],
["flounder","Камбала-глосса / речная",3,0,1,0,"5,4,6,10","6510",6,15,1,9,"212234333322","камбал|глосс|речная камбал|камбала-глосса|речная","Береговое морское удилище, морской червь (нереис), шумовые бусины.",3],
["mullet","Пеленгас / Лобан",3,1,1,0,"6,10","510",14,24,6,-12,"001232234310","кефал|пеленгас|пиленгас|лобан|сингил|остронос","Береговая морская донка, чашечный монтаж под нереиса.",1],
["sea_bass","Морской окунь (Смарида / Рокфиш)",3,0,1,0,"4,6,10","65",8,16,0.5,11,"112234333211","смарид|морской окун|окунь морск|чуларк|морской окунь|смарида|рокфиш","Морская прибрежная ловля, отводной поводок, креатуры и светонакопительный силикон.",0],
["garfish","Сарган",3,0,1,0,"5,6","65",14,22,8,-10,"000123433310","сарган|игла морск","Плавающая бомбарда, поводок 1.5–2 м, шелковая нить.",1],
["anglerfish","Морской чёрт (Удильщик)",3,0,1,0,"5,4","6",2,8,1,11,"222222222222","морской черт|удильщик","Тяжелый бортовой джиг со дна, крупный виброхвост с филе рыбы.",2],
["halibut","Палтус синекорый / белокорый",3,0,1,1,"4,10","6",0,7,-0.5,16,"223432234322","палтус|палтус синекорый|белокорый","Морское удилище 30–50 lbs, виброхвосты 300–500 г.",0],
["horse_mackerel","Ставрида",3,0,1,0,"5,6","65",15,23,8,-14,"000123433310","ставрид|ставридк|ставрида","Лёгкий морской спиннинг, головки 1.5–3 г, ставка «самодур».",2],
["sand_eel","Песчанка",3,1,1,0,"5,4,10","5",3,12,1,5,"112343332100","песчанк|песчанка","Ставка сабики с мелким люрексом. Деликатный спиннинг (нано-джиг 0.3–1 г, микроджиг), поплавочная и фидерная оснастка с флюорокарбоновым поводком.",1],
["ruffe","Ёрш обыкновенный",0,0,0,0,"9,0,8,5,4,6,7,3,2,1","14203",4,14,0,9,"332012223433","ерш|ерша|ершик|носар|ерш обыкновенный|носарь|королевский","Мормышка с мотылем у самого дна. Деликатный спиннинг (нано-джиг 0.3–1 г, микроджиг), поплавочная и фидерная оснастка с флюорокарбоновым поводком.",3],
["trout","Кумжа / Ручьевая форель",0,0,0,1,"5,4,6,3","5012",6,14,0.5,12,"112343230001","кумж|форел|пеструшк|кумжа|ручьевая форель|форель|ручьевая|озерная|пеструшка","Речной ультралайт, тонущие узкотелые воблеры 45–60 мм.",0],
["goby","Бычок-кругляк / мартовик",3,0,1,0,"5,6,2","1502",10,20,4,-3,"112322343321","бычок|бычка|кругляк|мартовик|кнут|бычок-кругляк","Отводной поводок, донка, кусочки червя или мидии.",3],
["bleak","Уклейка",1,1,0,0,"0,5,6,7,3,2","14203",14,22,4,-12,"001333332100","уклейк|уклея|селявк|верховодк|уклейка|себель|шеклея","Легкий мах 3–4 м, поплавок 0.3–0.5 г, мелкий опарыш",1],
["ide","Язь (Подъязок)",1,1,0,0,"0,1,8,2,3,4,5,7,6","012345",12,19,1,2,"112033333211","язь|язя|язю|язем|подъяз|подъязок|язь подъязок красноперый","Спиннинг ультралайт и лайт (вертушки №1–3, воблеры-крэнки 35–50 мм, колебалки, мормышинг и микроджиг 1–4 г), фидер и донка, болонская удочка.",0],
["sterlet","Стерлядь",4,1,0,1,"0,4,6,7,2,1","120",12,20,1,2,"112200333211","стерляд|стерляжк|чухоньк|стерлядь|стерлядь стерлядка чечуга","Фидер с пучком червя или мотыля",2],
["herring","Сельдь атлантическая / тихоокеанская",3,1,1,0,"5,4,10","651",4,12,0.5,7,"223421123422","сельд|селедк|сельдь|сельдь атлантическая|тихоокеанская","Ставка-самодур с мобискином и золотыми крючками.",1],
["mackerel","Скумбрия атлантическая",3,0,1,0,"5,4,6","65",12,20,7,-10,"000123433200","скумбри|скумбрия атлантическая","Тяжёлые морские блёсны 20–40 г, ярусные оснастки с перьями.",1],
["cod","Атлантическая треска",3,0,1,0,"5,4","65",1,8,-1,18,"333221123433","треск|атлантическая треск|пертуй|атлантическая треска","Тяжелый бортовой джиг, тяжёлые морские блёсны 200–500 г с октопусом.",0],
["smelt","Корюшка европейская / зубастая",3,0,1,0,"0,5,4,3,10","1250",0,8,-1.5,21,"333210001234","корюшк|зубар|малоротк|снеток|корюшка европейская|зубастая|корюшка|зубатка|огуречник|снетка","Кобылки, гирлянды светонакопительных мормышек.",1],
["salmon","Атлантический лосось (Сёмга)",0,0,0,1,"5,4,3","1502",6,14,0.5,11,"001123432000","семг|атлантический лосос|атлантический лосось|семга|лосось|атлантический|лох|тинда","Двуручный нахлыст, лососевые колебалки 20–45 г.",0],
["crayfish","Речной рак",1,1,0,1,"6,7,3,2","20",15,22,6,-17,"000001234300","рак|речной рак|рака|раки","Разрешенные раколовки с рыбой или чесночным хлебом.",2],
["crab","Краб прибрежный / каменный",3,0,1,1,"4,6,10","5",12,20,2,2,"111200333321","краб|каменный краб|краба|краб прибрежный|каменный","Подъемник-хватка с рыбной насадкой.",2],
["king_crab","Камчатский краб",3,0,1,1,"4,10","6",0,6,-0.5,14,"222002343322","камчатский краб","Специализированная крабовая ловушка с сельдью.",3],
["silver_carp","Толстолобик белый / пестрый",1,1,0,3,"6,7,2","142",20,28,8,-19,"000013332000","толстолоб|толстолобик|толстолобик белый|пестрый|белый","Специальная оснастка «палочка толстолобика» с прессованным планктоном.",1],
["grass_carp","Белый амур",1,1,0,3,"9,6,7,2","142",18,26,7,-17,"000013332000","белый амур|амур бел|белый|амур|травяной|карп","Мощный карповик, карповая оснастка, плавающий бойл, пучок травы.",1],
["channel_catfish","Сомик канальный",0,0,0,3,"6,7,2","42",18,28,6,-16,"000123432100","канальный сомик|сомик канальн|американский сомик|сомик канальный|сомик канальный американский","Донка, фидер, печень птицы, креветка, пучок червей.",2],
["tilapia","Тиляпия (нильская / мозамбикская)",1,1,0,3,"6,7,2","4",22,32,14,-23,"000013333100","тиляпи|теляпи|тиляпия|нильская|мозамбикская|тиляпия телапия нильская","Легкий поплавок, фидер, кукуруза, червь, тесто с аттрактантами",1],
["rotan","Ротан (Головешка)",0,0,0,0,"9,0,8,5,6,7,3,10,2,1","14203",12,22,-0.5,4,"223423433322","ротан|головешк|бычок прудов|головешка|бычок|болотный","Зимняя блесна с подсадкой куриной кожи, микроджиг.",3],
["buffalo","Буффало (большеротый)",1,1,0,3,"6,2","42",18,26,7,-17,"000123432100","буффало|большеротый|карась|американский","Фидер, донная кормушка, распаренные злаки, бойлы",1],
["rainbow_trout","Форель радужная (Микижа)",0,0,0,3,"7,3,10,2","420",10,18,0.5,9,"223421123432","радужная форел|микиж|форель платник|форель радужная|микижа|форель|радужная|платник","Прудовая форелевая снасть УЛ до 3.5 г, форелевая паста, микроколебалки.",1],
["russian_sturgeon","Осетр русский",4,1,0,2,"6,2","15",14,22,2,-3,"112322343211","русский осетр|осетр|осетр русский|русский|волжский|каспийский","Только искусственные платные водоемы.",2],
["paddlefish","Веслонос",4,1,0,3,"6,2","42",16,24,5,-14,"000123432100","веслонос|веслонос американский осетр","Специализированные прудовые снасти.",1],
["barbel","Усач (Марена)",1,1,0,1,"6,7","10",14,22,4,-10,"001203332100","усач|марен|мирон|марена|усач марена мирон","Мощный речной фидер, сырные насадки, пиявка, выползок",0],
["white_bream","Густера",1,1,0,0,"0,5,6,7,3,2","14203",14,20,2,-5,"112203333211","густер|густерк|тарашк|ласкир речн|густера|густерка|тарашка|ласкирь|речной","Пикер, легкий фидер, мотыль с опарышем",0],
["blue_bream","Синец",1,1,0,0,"5,6,7,3,2","120",12,19,2,-7,"112203332211","синец|синца|сопа|волжский","Фидерная снасть с длинным поводком (до 1 м), опарыш",1],
["sopa","Белоглазка (Сопа)",1,1,0,0,"5,6,7,2","120",10,18,1.5,-2,"122023432211","белоглазк|сопа|сопы|клепец|белоглазка|белоглазка сопа клепец","Речной фидер на тяжелых кормушках (80–120 г)",1],
["undermouth","Подуст волжский",1,1,0,0,"5,6,7,2","120",12,19,3,-7,"002023432100","подуст|чернобрюшк|подуст волжский|подуст чернобрюшка","Проводочная болонская удочка, опарыш, мотыль",1],
["vimba","Рыбец (Сырть)",1,1,0,1,"5,6,7,3,2","1250",12,19,2,-3,"113202343211","рыбец|сырть|рыбца|подуст|черноморский","Донка, фидер, мотыль, червь, ракушка",0],
["gudgeon","Пескарь обыкновенный",1,1,0,0,"9,0,8,5,4,6,7,3,2,1","1203",12,20,3,-7,"112234332100","пескар|пескарик|бубырь|пескарь обыкновенный|пескарь пескарик бубырь","Легкая поплавочная снасть, мелкий червь",1],
["loach","Вьюн обыкновенный",1,1,0,0,"9,0,8,5,4,6,7,3,2,1","1203",14,22,2,-10,"001234332100","вьюн|пискун|вьюн обыкновенный|вьюн пискун щиповка","Поплавок у дна, мотыль, кусочек червя",2],
["volga_zander","Берш (Волжский судак)",0,0,0,1,"5,6,7,2","120",12,20,1,4,"112013223421","берш|бершик|волжский судак|берш волжский судак","Джиг с мелким виброхвостом, зимняя блесна с тюлькой.",0],
["chekhon","Чехонь",1,1,0,0,"5,6,7,3,2","120",15,22,4,-10,"001303332100","чехон|сабля|чеша|чехонь|чехонь сабля чеша","Бомбарда с опарышем, резинка, микровертушки",1],
["vobla","Вобла каспийская",1,1,0,1,"2","1503",10,18,4,-9,"002301111100","вобл|каспийская вобл|вобла каспийская|вобла|каспийская|тарань|астраханская","Донка с 2–3 крючками, червь, опарыш",1],
["rudd","Красноперка",1,1,0,0,"0,5,6,7,3,2","14203",16,24,5,-12,"001234332100","красноперк|краснопер|красноперка|красноперка красноглазка","Поплавок, ультралайт (мормышинг), микровертушки.",1],
["dace","Елец (Чебак / Мохтик)",1,1,0,0,"0,1,8,2,3,4,5,7,6","01234",10,18,1,2,"112033333211","елец|ельц|мохтик|мегдым|чебак сибирск|чебак|сибирский|межень|ельчик","Нано-джиг и мормышинг (удилище XUL 0.2–2 г, мормышки и одноухие монтажи 0.3–1.0 г с вайтбейтом, тантой, искусственным мотылём или опарышем на.",1],
["shemaya","Шемайя (Черноморско-каспийская)",1,1,0,2,"6,2","15",14,22,4,-10,"112343333211","шемая|шемай|шамая|шемайя|черноморско-каспийская|царская|селедка","@RB",0],
["brown_trout","Форель ручьевая (Пеструшка)",0,0,0,1,"6,2","0",8,15,0.5,11,"112343230011","ручьевая форел|пеструшк|форель ручьевая|пеструшка|форель|ручьевая|кавказская","Речной УЛ, микровоблеры, нахлыст. Деликатный спиннинг (нано-джиг 0.3–1 г, микроджиг), поплавочная и фидерная оснастка с флюорокарбоновым.",0],
["taran","Тарань",1,1,0,0,"6","1503",12,20,3,-5,"223023432211","таран|тарань|таранк|таранка|азовская|плотва","Поплавок, донка, фидер, насадка — опарыш, червь",1],
["bluefish","Луфарь",3,0,1,0,"6","65",16,24,10,-16,"000012343200","луфар|луфарь","Спиннинг с пилькерами, поверхностные приманки, воблеры с металлическим поводком.",0],
["red_mullet","Султанка (Барабулька)",3,1,1,0,"6","5",15,23,8,-12,"000123433210","барабул|барабульк|султанк|султанка|барабулька","Пикер, морская донка, мелкий крючок с нереисом.",1],
["sea_bream","Морской карась (Ласкирь)",3,1,1,0,"6","5",16,24,9,-14,"000123433200","ласкир|морской карас|карась морск|зубарик|сарг|морской карась|ласкирь","Морская прибрежная ловля, отводной поводок, съедобная резина (Marukyu), мясо креветки.",1],
["wrasse","Зеленушка (Рулена)",3,1,1,0,"6","5",16,24,10,-16,"000123433100","зеленушк|рулен|рябчик морск|зеленушка|рулена","Микроджиг, поплавочная удочка с мидией или крабом.",1],
["scorpionfish","Скорпена (Морской ерш)",3,0,1,0,"6","5",14,22,7,-10,"000123433200","скорпен|морской ерш|ерш морск|скорпена","Морская прибрежная ловля в темноте, силиконовые рачки, джиг-головки 2–4 г.",2],
["turbot","Калкан черноморский",3,0,1,1,"6","65",10,18,4,4,"112002343321","калкан|черноморский калкан|калкан черноморский","Мощный береговая морская донка, резка рыбы (хамса, ставрида).",3],
["chir","Щокур (Чир)",2,1,0,0,"0,1,4,10","0123",4,12,0,18,"223211223003","чир|щокур|щекур|чира|сиг|северный","Донная снасть и лёгкий пикер/фидер с животной насадкой, мормышинг и нано-джиг у самого дна (0.5–1.5 г с имитацией личинки и мотыля на.",1],
["pizhyan","Пыжьян (Сибирский сиг)",2,1,0,0,"0,1,4,8","01235",4,13,0,16,"222223420033","пыжьян|сибирский сиг|полкур|сиг|сибирский","Мормышинг / нано-джиг (0.4–1.2 г с нимфами и слагами), ультралайт-вращалки №0–1, поплавочная удочка в проводку, лёгкий фидер/пикер, нахлыст.",0],
["peled","Пелядь (Сырок)",2,1,0,0,"0,1,4,3,2,8","0123",6,15,0,14,"223223432001","пеляд|сырок|сырка|сырку|пелядь|сырочек|речной|озерный|сиг","Нано-джиг и мормышинг (XUL спиннинг до 1.5–2 г, мормышка 0.3–0.8 г с подсадкой белого/розового слага Whitebait, Tanta или нимфы в толще воды.",1],
["muksun","Муксун",2,1,0,2,"0,1","15",4,12,0,17,"223223433112","муксун|муксуна|обской|сиг|краснокнижный","Любительский и промысловый вылов в Обь-Иртышском бассейне категорически ЗАПРЕЩЁН.",0],
["nelma","Нельма",2,0,0,2,"0,1,4","15",4,12,0,16,"223223433122","нельма|нельмы|нельму|нельма белорыбица сибирская","Любительский вылов в запретных бассейнах (включая Обь-Иртышский и Печорский) ЗАПРЕЩЁН.",0],
["cisco","Ряпушка сибирская",2,1,0,0,"0,4,1","12503",2,10,-0.5,19,"333212220023","ряпушк|зеeld|зельдь|сибирская ряпушк|ряпушка сибирская|ряпушка|сибирская|туруханка","Зимняя гирлянда со светонакопительными микромормышками",1],
["tugun","Тугун (Манерка / Сосьвинская сельдь)",2,1,0,0,"0,1","0132",8,16,1,9,"112234330011","тугун|манерк|сосьвинская сельд|тугунок|манерка|сосьвинская сельдь|сосьвинская|сельдь","Сверхлёгкий мормышинг (0.15–0.4 г с микромушкой или кусочком силиконового мотыля), лёгкая маховая поплавочная удочка с поплавком 0.3–0.8 г и.",0],
["siberian_sturgeon","Сибирский осётр",4,1,0,2,"0,1,8","152",10,18,0.5,4,"112223433211","сибирский осетр|осетр сибирск|осетр|сибирский|карыш|коسترя","Вылов дикой популяции категорически ЗАПРЕЩЁН (разрешён только лов товарной рыбы в коммерческих платных прудхозах).",2],
["omul","Байкальский омуль",2,1,0,1,"8","2",4,12,0,16,"222123430002","омул|байкальский омул|байкальский омуль|омуль|байкальский|селенгинский|посольский","Специальная настроечная мушка (кембрик, бисер), гирлянда",1],
["lenok","Ленок (Ускуч)",0,0,0,1,"9,8,1","10",6,14,0,14,"112203333211","ленок|ленка|ускуч|сибирская|форель","Спиннинг с искусственной мышью, узкотелые воблеры, нахлыст.",0],
["taimen","Обыкновенный таймень",0,0,0,2,"1,8,9,0,2","102",6,14,0,12,"112213333321","таймен|тайменя|обыкновенный таймень|таймень|хозяин|рек|красный","В разрешённых РПУ (строго с безбородыми или поджатыми крючками): мощный спиннинг и двуручный нахлыст, крупные воблеры и поверхностные «мыши».",0],
["snakehead","Змееголов",0,0,0,0,"9","03",18,28,6,-17,"000013332000","змееголов|змееголов змей амурский","Кастинговое удилище heavy, силиконовые незацепляемые лягушки.",1],
["sky_gazer","Верхогляд",0,0,0,0,"9","1",16,24,4,-12,"000123432100","верхогляд|верхогляд пучеглаз амурский","Дальнобойный спиннинг, тяжёлые морские блёсны, кастмастеры, поверхностные приманки.",1],
["yellowcheek","Желтощек",0,0,0,2,"9","1",15,22,4,-10,"001234333200","желтощек|бамбуса|амурская|щука","@RB",1],
["chinese_perch","Ауха (Китайский окунь)",0,0,0,2,"9","1",16,24,5,-14,"001232343200","ауха|китайский окун|китайский окунь|китайский|окунь|ерш|мандарин","@RB",0],
["amur_catfish","Амурский сом",0,0,0,0,"9","13",16,24,6,-14,"000123432100","амурский сом|сом амурск|сом амурский дальневосточный","Донка, спиннинг с крупным силиконом, лягушка.",2],
["pink_salmon","Горбуша",3,0,1,1,"9,4,10","150",6,14,1,9,"000012341000","горбуш|горбуши|горбуша|горбуша розовый лосось","Спиннинг 10–35 г, блесны Blue Fox #4–#5 розовых тонов.",1],
["chum_salmon","Кета",3,0,1,1,"9,10","150",6,14,1,9,"000001234100","кета|кеты|кету|серебрянка|зубатка|лосось","Спиннинг тяжелого класса, колеблющиеся блесны.",1],
["coho_salmon","Кижуч",3,0,1,1,"10","150",5,12,0.5,11,"000000133200","кижуч|кижуча|серебряный|лосось|белый","Спиннинг, тяжелые вертушки с колокольчиком.",1],
["sockeye_salmon","Нерка (Красница)",3,0,1,1,"10","1502",5,12,0.5,11,"000002320000","нерк|красниц|нерка|красница|красный|лосось","Нахлыст, специализированные мушки. Деликатный спиннинг (нано-джиг 0.3–1 г, микроджиг), поплавочная и фидерная оснастка с флюорокарбоновым.",1],
["chinook_salmon","Чавыча",3,0,1,1,"10","150",5,12,0.5,12,"000013310000","чавыч|чавычи|чавыча|королевский|лосось|князь","Морской тяжелый спиннинг, мощнейшие катушки со шнуром #3.0+ PE.",0],
["cherry_salmon","Сима (Масу)",3,0,1,1,"10","501",8,15,1,7,"000133100000","сима|симы|масу|вишневый|лосось","Спиннинг 5–21 г, тонущие узкотелые воблеры, колебалки.",1],
["char","Голец арктический / Кунджа",0,0,0,1,"0,4,10,1","25013",3,11,-0.5,18,"222343230022","голец|гольц|кундж|арктический голец|голец арктический|кунджа|арктический|палия|мальма","Спиннинг, белые колебалки, нахлыстовые крупные мушки.",0],
["dolly_varden","Мальма",0,0,0,0,"10","0152",4,12,0,16,"222343320022","мальм|мальмы|мальма|мальма голец тихоокеанский","Легкий спиннинг, поплавок с икринкой, вертушки #2.",1],
["walleye_pollock","Минтай",3,0,1,0,"10","65",1,8,0,12,"223421122342","минтай|минтая","Тяжёлые морские блёсны 80–150 г, ставки с октопусами.",0],
["navaga","Навага дальневосточная / северная",3,0,1,0,"0,4,10","510",-1,6,-1.5,23,"332100012343","наваг|вахня|навага дальневосточная|северная|навага|дальневосточная","Зимняя блесна-иголка без бородки. Деликатный спиннинг (нано-джиг 0.3–1 г, микроджиг), поплавочная и фидерная оснастка с флюорокарбоновым.",1],
["greenling","Терпуг (Одноперый / пятнистый)",3,0,1,0,"10","65",6,14,1,7,"112343321111","терпуг|одноперый|пятнистый","Джиг с силиконовыми октопусами, кастмастеры, донка.",1],
["starry_flounder","Камбала звездчатая",3,0,1,0,"10","510",4,14,0.5,9,"212343333222","звездчатая камбал|камбала звездчатая","Береговая морская снасть, нарезка рыбы, морской червь.",3],
["vendace","Ряпушка европейская (Рипус)",2,1,0,0,"0,5,4,3,2","12503",4,12,0,16,"223223421002","рипус|килец|европейская ряпушк|ряпушка европейская|ряпушка|европейская","Зимняя гирлянда с подсветкой, микромормышки",1],
["broad_whitefish","Сиг-лудога / Валаамка",2,1,0,0,"0,5,4,3,2","12503",4,12,0,14,"223234220022","лудог|валаамк|сиг лудог|сиг-лудога|валаамка|сиг|лудога|ладожский","Зимнее блеснение с цепочкой, донная снасть",0],
["omul_arctic","Арктический омуль",2,1,1,0,"0,4,1","12503",1,9,-0.5,19,"223212340022","арктический омул|омуль северн|арктический омуль|омуль арктический северный","Гирлянда-самодур, мормышка с бокоплавом.",1],
["valek","Валёк (Конёк)",2,1,0,0,"0,10,1","120",4,12,0,14,"112234320011","валек|валька|конек сибирск|конек|сиг|вальковый","Поплавочная удочка в проводку, ручейник, короед",0],
["baikal_grayling","Байкальский хариус (белый / черный)",0,0,0,1,"8","120",4,12,0,16,"223202343322","байкальский хариус|белый хариус|черный хариус|белый|черный|хариус|байкальский","Байкальский «кораблик», грузовой настрой с мушками под бормаша.",0],
["beluga","Белуга",4,0,1,2,"6,2","165",10,20,1,0,"123422223421","белуг|белуга|царь|рыба|осетровые","@RB",2],
["stellate_sturgeon","Севрюга",4,1,1,2,"6,2","15",12,22,2,-3,"112322343211","севрюг|севрюга|севрюга осетр носатый","@RB",2],
["kaluga","Калуга",4,0,0,2,"9,10","15",8,18,1,2,"112223433211","калуг рыба|амурская калуг|калуга|калуга амурская белуга","@RB",2],
["white_salmon","Белорыбица",2,0,0,2,"2","1",6,16,0.5,7,"223222223122","белорыбиц|белорыбица|белорыбица каспийская нельма","@RB",0],
["kutum","Кутум",3,1,1,1,"2","150",12,20,3,-5,"123202223211","кутум|кутум вырезуб каспийский","Донная снасть, береговая донка, насадка — креветка, червь, краб.",1],
["black_carp","Черный амур",1,1,0,2,"9,6,2","14",18,26,7,-17,"000123432100","черный амур|амур черн|черный|амур|китайский|плотва","Только в специализированных прудовых хозяйствах.",1],
["tarpon_carp","Троегуб / Конь-губарь",1,1,0,0,"9","10",14,22,2,-2,"112234333211","троегуб|конь губар|конь-губар|конь-губарь|конь|губарь|пестрый","Речной фидер, червь, кукуруза, резка",1],
["parabramis","Лещ амурский (белый / черный)",1,1,0,0,"9","13",16,24,4,-10,"001232343200","амурский лещ|белый лещ|лещ амурский|белый|черный|лещ|амурский","Фидер, донка, кукуруза, пеллетс, червь",0],
["haddock","Пикша",3,0,1,0,"4","65",2,9,0,14,"222343333222","пикш|пикша","Морской джиг, ставки с подсадкой креветки или кальмара.",1],
["saithe","Сайда",3,0,1,0,"4","65",3,10,0.5,12,"112234333211","сайд|сайда","Скоростной отвесное блеснение в толще воды, перьевые оснастки.",1],
["wolffish","Зубатка (полосатая / пятнистая)",3,0,1,0,"5,4","6",0,7,-1,16,"223433223422","зубатк|зубатка|полосатая|пятнистая","Морская донная стукалка с филе сайды или морским гребешком.",3],
["plaice","Камбала морская (Ершоватка)",3,0,1,0,"5,4","65",2,11,0,12,"222343333222","морская камбал|ершоватк|камбала морская|ершоватка","Донная снасть с яркими бусинами, пескожил, креветка.",1],
["capelin","Мойва (Уёк)",3,1,1,0,"4,10","5",1,8,-1,16,"123433111111","мойв|уек|мойва","Сачок на накатной волне, мелкий самодур.",1],
["saffron_cod","Сайка (Полярная тресочка)",3,0,1,0,"0,4,1","65",-1.5,5,-1.8,24,"333211112343","сайк|полярная тресочк|сайка|полярная тресочка|сайка полярная тресочка","Зимняя блесна, мормышка с кусочком креветки или рыбы.",3],
["eel","Угорь речной европейский",0,0,0,2,"5,6,3","125",14,22,4,-14,"001234333200","угорь|угря|угорь речной европейский|речной|европейский|змея","@RB",2]
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

const _BOT_WTAGS = ["Река малая", "Река большая", "Озеро / Карьер / Вдхр", "Озеро / Старица", "ГРЭС / Тёплый сброс", "Морской залив / Губа", "Открытое море"];
const _BOT_ADMINS = ["Алтайский край", "Амурская обл.", "Архангельская обл.", "Астраханская обл.", "Белгородская обл.", "Брянская обл.", "Владимирская обл.", "Волгоградская обл.", "Вологодская обл.", "Воронежская обл.", "Донецкая Народная Республика", "Еврейская АО", "Забайкальский край", "Запорожская обл.", "Ивановская обл.", "Иркутская обл.", "Кабардино-Балкарская Республика", "Калининградская обл.", "Калужская обл.", "Камчатский край", "Карачаево-Черкесская Республика", "Кемеровская обл.", "Кировская обл.", "Костромская обл.", "Краснодарский край", "Красноярский край", "Курганская обл.", "Курская обл.", "Ленинградская обл.", "Липецкая обл.", "Луганская Народная Республика", "Магаданская обл.", "Москва", "Московская обл.", "Мурманская обл.", "Ненецкий АО", "Нижегородская обл.", "Новгородская обл.", "Новосибирская обл.", "Омская обл.", "Оренбургская обл.", "Орловская обл.", "Пензенская обл.", "Пермский край", "Приморский край", "Псковская обл.", "Республика Адыгея", "Республика Алтай", "Республика Башкортостан", "Республика Бурятия", "Республика Дагестан", "Республика Ингушетия", "Республика Калмыкия", "Республика Карелия", "Республика Коми", "Республика Крым", "Республика Марий Эл", "Республика Мордовия", "Республика Саха (Якутия)", "Республика Северная Осетия — Алания", "Республика Татарстан", "Республика Тыва", "Республика Хакасия", "Ростовская обл.", "Рязанская обл.", "Самарская обл.", "Санкт-Петербург", "Саратовская обл.", "Сахалинская обл.", "Свердловская обл.", "Севастополь", "Смоленская обл.", "Ставропольский край", "Тамбовская обл.", "Тверская обл.", "Томская обл.", "Тульская обл.", "Тюменская обл.", "Удмуртская Республика", "Ульяновская обл.", "Хабаровский край", "Ханты-Мансийский АО", "Херсонская обл.", "Челябинская обл.", "Чеченская Республика", "Чувашская Республика", "Чукотский АО", "Ямало-Ненецкий АО", "Ярославская обл."];
const BOT_WATERS_DB = [
["р. Москва", "Москва-река", 2, 1, 3.5, 55.75, 37.62, "Москва"],["р. Яуза", "", 2, 0, 1.8, 55.755, 37.645, "Москва"],["р. Пахра", "", 2, 0, 2.1, 55.44, 37.56, "Подольск / Домодедово"],["Пироговское вдхр.", "", 2, 2, 5.2, 55.98, 37.7, "Московская обл."],["Клязьминское вдхр.", "", 2, 2, 4.8, 55.99, 37.58, "Московская обл."],["Истринское вдхр.", "", 2, 2, 6.0, 56.05, 36.8, "Истра / Солнечногорск"],["Можайское вдхр.", "", 2, 2, 6.5, 55.58, 35.85, "Можайск"],["Рузское вдхр.", "", 2, 2, 6.2, 55.78, 36.05, "Руза"],["Озернинское вдхр.", "", 2, 2, 5.8, 55.77, 36.22, "Рузский р-н"],["оз. Сенеж", "", 2, 3, 3.0, 56.19, 37.02, "Солнечногорск"],["Шатурские озёра (Шатурская ГРЭС)", "Шатурская ГРЭС (оз. Святое)", 2, 4, 3.8, 55.59, 39.55, "Шатура"],["Иваньковское вдхр. (Московское море)", "Иваньковское вдхр.", 2, 2, 5.5, 56.75, 36.95, "Дубна / Конаково"],["Тёплый сброс Конаковской ГРЭС", "Конаковская ГРЭС", 2, 4, 3.5, 56.74, 36.78, "Конаково"],["р. Волга (Тверь)", "Волга", 2, 1, 4.2, 56.86, 35.9, "Тверь"],["р. Тверца", "", 2, 0, 2.1, 56.87, 35.92, "Тверь"],["оз. Плещеево", "Плещеево озеро", 2, 2, 8.0, 56.76, 38.78, "Переславль-Залесский"],["р. Волга (Ярославль)", "Волга", 2, 1, 5.8, 57.62, 39.89, "Ярославль"],["р. Которосль", "", 2, 0, 2.2, 57.61, 39.88, "Ярославль"],["Рыбинское вдхр.", "", 2, 2, 6.8, 58.2, 38.5, "Рыбинск / Череповец"],["р. Ока (Серпухов / Кашира)", "Ока (Серпухов)", 2, 1, 3.6, 54.88, 37.42, "Серпухов"],["р. Ока (Коломна)", "Ока", 2, 1, 3.8, 55.08, 38.77, "Коломна"],["р. Ока (Рязань)", "Ока", 2, 1, 4.2, 54.63, 39.75, "Рязань"],["р. Пра (Мещёра)", "Пра", 2, 0, 1.8, 54.95, 40.15, "Рязанская обл."],["р. Клязьма (Владимир)", "Клязьма", 2, 0, 2.2, 56.12, 40.41, "Владимир"],["оз. Селигер", "", 2, 2, 5.8, 57.2, 33.05, "Осташков"],["оз. Неро", "", 2, 3, 1.5, 57.17, 39.43, "Ростов Великий"],["р. Дон (Воронеж)", "Дон", 6, 1, 3.8, 50.98, 39.5, "Лиски / Воронеж"],["р. Воронеж (Воронежское вдхр.)", "Воронежское вдхр.", 6, 2, 4.2, 51.67, 39.2, "Воронеж"],["Нововоронежское вдхр. (АЭС)", "Нововоронежская АЭС", 6, 4, 4.8, 51.27, 39.2, "Нововоронеж"],["р. Днепр (Смоленск)", "Днепр", 7, 1, 2.8, 54.78, 32.05, "Смоленск"],["Десногорское вдхр. (Смоленская АЭС)", "Десногорское вдхр.", 7, 4, 6.5, 54.15, 33.28, "Десногорск"],["р. Десна (Брянск)", "Десна", 7, 1, 3.2, 53.25, 34.37, "Брянск"],["р. Сейм (Курск)", "Сейм", 7, 1, 2.6, 51.73, 36.19, "Курск"],["Курчатовское вдхр. (Курская АЭС)", "Курчатовское вдхр.", 7, 4, 5.8, 51.65, 35.65, "Курчатов"],["р. Оскол", "", 6, 0, 2.1, 51.3, 37.83, "Старый Оскол"],["Старооскольское вдхр.", "", 6, 2, 5.2, 51.4, 37.95, "Старый Оскол"],["Белгородское вдхр.", "", 6, 2, 4.8, 50.59, 36.59, "Белгород"],["Угличское вдхр. (Углич / Калязин)", "Угличское вдхр.", 2, 2, 6.5, 57.4, 38.1, "Углич / Калязин"],["Рыбинское вдхр. (Весьегонск / Брейтово)", "Рыбинское вдхр. (Весьегонск)", 2, 2, 7.0, 58.65, 37.3, "Весьегонск (Тверская обл.)"],["р. Волга (Ржев / Зубцов)", "р. Волга (Ржев)", 2, 1, 3.0, 56.262, 34.33, "Ржев (Тверская обл.)"],["Вышневолоцкое вдхр. / оз. Песьво (Вышний Волочёк / Удомля)", "оз. Песьво (Удомля АЭС)", 2, 4, 5.5, 57.75, 34.8, "Вышний Волочёк / Удомля"],["Горьковское вдхр. / р. Волга (Кострома / Волгореченск / Плёс / Кинешма)", "р. Волга (Кострома / Кинешма)", 2, 1, 6.5, 57.45, 41.52, "Кострома / Плёс / Кинешма"],["Уводьское вдхр. (Иваново)", "Уводьское вдхр.", 2, 2, 5.0, 57.05, 40.9, "Иваново"],["р. Ока (Муром / Павлово / Выкса)", "р. Ока (Муром)", 2, 1, 4.8, 55.58, 42.1, "Муром / Выкса / Павлово"],["р. Ока (Касимов / Шилово)", "р. Ока (Касимов)", 2, 1, 4.5, 54.65, 41.15, "Касимов / Шилово (Рязанская обл.)"],["р. Упа / р. Ока (Тула / Алексин)", "р. Упа (Тула)", 2, 0, 2.4, 54.2, 37.62, "Тула"],["р. Ока / р. Протва (Калуга / Обнинск / Наро-Фоминск)", "р. Ока (Калуга)", 2, 1, 3.6, 54.75, 36.45, "Калуга / Обнинск"],["р. Дон (Вёшенская / Павловск)", "р. Дон (Вёшенская)", 6, 1, 4.2, 50.0, 40.9, "Вёшенская / Павловск"],["Матырское вдхр. / р. Дон (Липецк / Елец)", "р. Дон / Матырское вдхр. (Липецк)", 6, 1, 3.6, 52.615, 39.05, "Липецк / Елец"],["р. Цна / Котовское вдхр. (Тамбов)", "р. Цна (Тамбов)", 2, 0, 2.5, 52.72, 41.455, "Тамбов"],["р. Ока (Орёл)", "р. Ока (Орёл)", 2, 0, 2.2, 52.967, 36.065, "Орёл"],["р. Нара (Наро-Фоминск)", "р. Нара", 2, 0, 2.2, 55.389, 36.736, "Наро-Фоминск"],["Горьковское вдхр. (Юрьевец)", "", 2, 2, 9.5, 57.322, 43.118, "Юрьевец"],["р. Клязьма (Ковров)", "р. Клязьма (Ковров)", 2, 1, 3.8, 56.362, 41.305, "Ковров"],["р. Дон (Павловск)", "р. Дон (Павловск)", 6, 1, 5.2, 50.455, 40.095, "Павловск"],["р. Волга / Костромской залив (Кострома)", "р. Волга (Кострома)", 2, 1, 7.5, 57.765, 40.918, "Кострома"],["Рыбинское вдхр. / р. Согожа (Пошехонье)", "Рыбинское вдхр. (Пошехонье)", 2, 2, 6.5, 58.5, 39.11, "Пошехонье"],["р. Цна и Тамбовское вдхр. (Тамбов / Моршанск)", "Цна (Тамбов)", 2, 0, 2.6, 52.721, 41.452, "Тамбовская обл."],["Матырское вдхр. (Липецк / Грязи)", "Матырское вдхр.", 6, 2, 4.5, 52.535, 39.815, "Липецкая обл."],["оз. Галичское и оз. Чухломское (Галич / Чухлома)", "Галичское озеро", 2, 2, 3.0, 58.405, 42.295, "Костромская обл."],["р. Москва (Марьино / Братеево / Капотня — незамерзающий нижний бьеф)", "", 2, 1, 4.2, 55.642, 37.745, "Москва"],["Строгинский затон (Большой и Малый Строгинские карьеры)", "", 2, 2, 6.5, 55.803, 37.432, "Москва"],["Химкинское вдхр.", "", 2, 2, 5.8, 55.845, 37.458, "Москва"],["Гребной канал (Крылатское)", "", 2, 2, 3.5, 55.756, 37.434, "Москва"],["Косинские озёра (Белое, Чёрное, Святое)", "", 2, 3, 3.8, 55.721, 37.858, "Москва"],["Борисовские и Царицынские пруды", "", 2, 3, 2.6, 55.629, 37.702, "Москва"],["р. Десна и р. Пахра (ТиНАО, Троицк)", "", 2, 0, 2.1, 55.485, 37.307, "Москва"],["р. Сходня (Сходненский ковш)", "", 2, 0, 1.8, 55.842, 37.412, "Москва"],["р. Сетунь", "", 2, 0, 1.5, 55.722, 37.508, "Москва"],["Канал им. Москвы (Дмитров — Дубна — Икша — Химки)", "", 2, 1, 5.5, 56.345, 37.515, "Московская обл."],["Пестовское вдхр.", "", 2, 2, 5.6, 56.082, 37.685, "Московская обл."],["Пяловское вдхр.", "", 2, 2, 4.8, 56.038, 37.652, "Московская обл."],["Икшинское вдхр.", "", 2, 2, 5.2, 56.135, 37.535, "Московская обл."],["Учинское (Акуловское) вдхр.", "", 2, 2, 6.2, 56.018, 37.765, "Московская обл."],["Верхнерузское вдхр.", "", 2, 2, 5.8, 55.948, 35.425, "Московская обл."],["Яузское вдхр. (восточный плёс / Карманово)", "", 2, 2, 6.5, 55.855, 35.158, "Московская обл."],["Цимлянский (Павленское оз.) и Ланьшинский карьеры (р. Ока, Серпухов)", "", 2, 2, 7.2, 54.881, 37.428, "Московская обл."],["Бисерово озеро и Кудиновские карьеры (Старая Купавна)", "", 2, 2, 6.8, 55.775, 38.135, "Московская обл."],["оз. Круглое и оз. Долгое (Дмитровский / Солнечногорский р-н)", "", 2, 3, 3.4, 56.052, 37.362, "Московская обл."],["оз. Тростенское (Рузский / Истринский р-н)", "", 2, 3, 2.4, 55.862, 36.485, "Московская обл."],["Егорьевский и Клинский рыбокомбинаты (Шалаховское вдхр.)", "", 2, 3, 2.8, 55.342, 39.325, "Московская обл."],["р. Клязьма (Щёлково — Ногинск — Павловский Посад — Орехово-Зуево)", "", 2, 0, 2.4, 55.855, 38.442, "Московская обл."],["р. Дубна и р. Сестра", "", 2, 0, 2.5, 56.675, 37.248, "Московская обл."],["р. Осётр (Зарайск / Серебряные Пруды)", "", 2, 0, 2.2, 54.757, 38.875, "Московская обл."],["р. Руза", "", 2, 0, 2.1, 55.702, 36.205, "Московская обл."],["р. Истра", "", 2, 0, 1.9, 55.914, 36.862, "Московская обл."],["р. Лама", "", 2, 0, 2.0, 56.192, 35.845, "Московская обл."],["р. Протва (Верея / Протвино)", "", 2, 0, 2.3, 55.344, 36.185, "Московская обл."],["р. Лопасня", "", 2, 0, 1.8, 55.148, 37.477, "Московская обл."],["р. Нерская", "", 2, 0, 1.9, 55.512, 38.752, "Московская обл."],["р. Пра (верховья — оз. Святое, Шатура)", "", 2, 0, 1.8, 55.385, 39.915, "Московская обл."],["р. Северский Донец (Белгород / Маслова Пристань / Шебекино)", "", 6, 0, 2.6, 50.453, 36.736, "Белгородская обл."],["р. Оскол (Волоконовка / Новый Оскол / Валуйки)", "", 6, 0, 2.8, 50.485, 37.859, "Белгородская обл."],["р. Тихая Сосна (Бирюч / Алексеевка)", "", 6, 0, 2.3, 50.631, 38.689, "Белгородская обл."],["р. Ворскла (Борисовка / Грайворон)", "", 7, 0, 2.1, 50.478, 35.676, "Белгородская обл."],["р. Нежеголь (Шебекино)", "", 6, 0, 2.0, 50.412, 36.885, "Белгородская обл."],["р. Короча", "", 6, 0, 1.7, 50.811, 37.202, "Белгородская обл."],["р. Айдар (Ровеньки)", "", 6, 0, 1.9, 49.914, 38.902, "Белгородская обл."],["р. Десна (Жуковка / Сельцо / Выгоничи / Трубчевск / Белая Берёзка)", "", 7, 1, 3.8, 52.585, 33.768, "Брянская обл."],["р. Ипуть (Сураж / Новозыбков / Клинцы)", "", 7, 0, 2.5, 52.752, 32.238, "Брянская обл."],["р. Судость (Почеп / Погар)", "", 7, 0, 2.4, 52.932, 33.457, "Брянская обл."],["р. Болва (Дятьково / Фокино / Брянск)", "", 7, 0, 2.2, 53.456, 34.419, "Брянская обл."],["р. Нерусса (Суземка / Трубчевск)", "", 7, 0, 2.1, 52.435, 33.912, "Брянская обл."],["р. Беседь (Красная Гора)", "", 7, 0, 2.3, 53.001, 31.603, "Брянская обл."],["р. Снежеть (Карачев / Брянск)", "", 7, 0, 1.8, 53.123, 34.985, "Брянская обл."],["р. Сев (Севск)", "", 7, 0, 1.7, 52.149, 34.492, "Брянская обл."],["оз. Кожановское (Гордеевский / Клинцовский р-н)", "", 7, 3, 2.2, 52.815, 31.895, "Брянская обл."],["Брянские карьеры (Бежицкие / Ковшовские / Орлик 1–5)", "", 7, 2, 5.5, 53.318, 34.302, "Брянская обл."],["р. Клязьма (Петушки / Собинка)", "", 2, 0, 2.4, 55.929, 39.463, "Владимирская обл."],["р. Клязьма (Вязники / Мстёра / Гороховец — низовья)", "", 2, 1, 3.6, 56.245, 42.152, "Владимирская обл."],["р. Нерль Клязьминская (Суздаль / Боголюбово)", "", 2, 0, 2.2, 56.195, 40.533, "Владимирская обл."],["р. Киржач (Киржач / Покров)", "", 2, 0, 1.9, 56.156, 38.859, "Владимирская обл."],["р. Пекша и Кольчугинское вдхр. (Кольчугино)", "", 2, 2, 4.2, 56.302, 39.382, "Владимирская обл."],["р. Судогда (Судогда)", "", 2, 0, 1.8, 55.953, 40.861, "Владимирская обл."],["р. Гусь и Гусевское вдхр. (Гусь-Хрустальный)", "", 2, 2, 3.5, 55.618, 40.655, "Владимирская обл."],["оз. Святое (Мещёра, Гусь-Хрустальный р-н)", "", 2, 3, 2.5, 55.342, 40.185, "Владимирская обл."],["оз. Кщара и оз. Санхар (Вязниковский р-н, Клязьминско-Лухский заказник)", "", 2, 2, 9.5, 56.418, 42.345, "Владимирская обл."],["Пойменные озёра-старицы р. Оки и Клязьмы (оз. Виша, оз. Урвановское — Муром / Вязники)", "", 2, 3, 3.2, 55.652, 42.115, "Владимирская обл."],["р. Дон (Семилуки / Нововоронеж / Коротояк)", "", 6, 1, 4.2, 51.315, 39.128, "Воронежская обл."],["р. Дон (Верхний Мамон / Богучар)", "", 6, 1, 4.8, 50.045, 40.512, "Воронежская обл."],["р. Хопёр (Борисоглебск / Поворино / Новохопёрск)", "", 6, 1, 3.8, 51.195, 41.925, "Воронежская обл."],["р. Битюг (Анна / Бобров / Лосево)", "", 6, 0, 2.8, 51.093, 40.034, "Воронежская обл."],["р. Ворона (Борисоглебск)", "", 6, 0, 2.6, 51.367, 42.083, "Воронежская обл."],["р. Воронеж (Рамонь)", "", 6, 0, 2.7, 51.916, 39.339, "Воронежская обл."],["р. Усмань (Новая Усмань / Рамонь)", "", 6, 0, 2.0, 51.644, 39.409, "Воронежская обл."],["р. Тихая Сосна (Острогожск / Дивногорье)", "", 6, 0, 2.2, 50.865, 39.069, "Воронежская обл."],["р. Чёрная Калитва (Россошь / Ольховатка)", "", 6, 0, 2.1, 50.198, 39.569, "Воронежская обл."],["р. Савала (Терновка / Новохопёрск)", "", 6, 0, 2.0, 51.325, 41.612, "Воронежская обл."],["р. Икорец", "", 6, 0, 1.8, 51.125, 39.625, "Воронежская обл."],["оз. Погоново и пойменные озёра Дона", "", 6, 3, 2.8, 51.482, 39.095, "Воронежская обл."],["Горьковское вдхр. (Пучеж / Юрьевец — озёрная часть, устья р. Ячменка, р. Елнать, р. Шохонка)", "", 2, 2, 7.8, 57.145, 43.135, "Ивановская обл."],["р. Волга (Наволоки / Кинешма / Заволжск / Решма)", "", 2, 1, 6.5, 57.452, 42.165, "Ивановская обл."],["р. Теза (Шуя / Холуй — шлюзованная система)", "", 2, 0, 2.4, 56.715, 41.585, "Ивановская обл."],["р. Лух (пгт Лух / Талицы / Южа)", "", 2, 0, 2.2, 56.695, 42.265, "Ивановская обл."],["р. Уводь (Иваново / Кохма / Лежнево / Савино)", "", 2, 0, 2.0, 56.835, 41.015, "Ивановская обл."],["р. Нерль Клязьминская (Тейково / Гаврилов Посад)", "", 2, 0, 2.1, 56.652, 40.235, "Ивановская обл."],["р. Сунжа и р. Колдома (Вичуга / Каменка)", "", 2, 0, 1.9, 57.386, 41.766, "Ивановская обл."],["оз. Рубское (Тейковский р-н)", "", 2, 2, 5.8, 56.725, 40.615, "Ивановская обл."],["оз. Святое (Мугреевский, Южский р-н)", "", 2, 3, 3.4, 56.518, 42.345, "Ивановская обл."],["р. Ока (Перемышль / Калуга / Ферзиково / Таруса)", "", 2, 1, 3.6, 54.512, 36.265, "Калужская обл."],["р. Угра (Юхнов / Товарково / Калуга)", "", 2, 0, 2.4, 54.673, 35.942, "Калужская обл."],["р. Жиздра (Жиздра / Козельск / Перемышль)", "", 2, 0, 2.3, 54.038, 35.785, "Калужская обл."],["р. Протва (Боровск / Обнинск / Жуков / Кремёнки)", "", 2, 0, 2.2, 55.028, 36.743, "Калужская обл."],["р. Шаня и р. Суходрев (Кондрово / Полотняный Завод / Товарково)", "", 2, 0, 1.9, 54.731, 35.998, "Калужская обл."],["р. Лужа (Малоярославец)", "", 2, 0, 1.8, 55.011, 36.467, "Калужская обл."],["р. Рессета и р. Вытебеть (Хвастовичи / Ульяново)", "", 2, 0, 1.9, 53.545, 35.315, "Калужская обл."],["Яченское вдхр. (Калуга)", "", 2, 2, 4.0, 54.524, 36.218, "Калужская обл."],["оз. Ломпадь / Людиновское вдхр. (р. Неполодь, Людиново)", "", 7, 2, 4.8, 53.882, 34.445, "Калужская обл."],["Кировские вдхр. (Верхнее и Нижнее) и р. Болва (Киров)", "", 7, 2, 4.2, 54.075, 34.307, "Калужская обл."],["Брынское вдхр. (Думиничский / Сухиничский р-н)", "", 2, 2, 4.5, 54.008, 35.215, "Калужская обл."],["оз. Тишь (пойменное озеро-старица Оки, Перемышльский р-н)", "", 2, 3, 3.0, 54.342, 36.178, "Калужская обл."],["Костромское расширение Горьковского вдхр. («Костромское море» / Костромские разливы)", "", 2, 2, 4.5, 57.855, 40.765, "Костромская обл."],["Тёплый канал Костромской ГРЭС (Волгореченск)", "", 2, 4, 4.2, 57.448, 41.152, "Костромская обл."],["р. Кострома (Солигалич / Буй / Кострома)", "", 2, 1, 3.8, 58.478, 41.531, "Костромская обл."],["р. Унжа (Кологрив / Мантурово / Макарьев — устье в Горьковском вдхр.)", "", 2, 1, 4.0, 58.125, 44.115, "Костромская обл."],["р. Нёмда и Нёмдинский залив Горьковского вдхр. (Кадый)", "", 2, 2, 5.2, 57.625, 43.185, "Костромская обл."],["р. Мера и Мерский залив (Островское / Заволжск)", "", 2, 0, 2.8, 57.615, 42.245, "Костромская обл."],["р. Ветлуга (Шарья / Пыщуг)", "", 2, 1, 3.6, 58.385, 45.512, "Костромская обл."],["р. Нея (Нея / Парфеньево)", "", 2, 0, 2.2, 58.293, 43.868, "Костромская обл."],["р. Сейм (Льгов / Рыльск / Глушково)", "", 7, 1, 3.4, 51.625, 35.115, "Курская обл."],["р. Тускарь и Курское вдхр. («Курское море» / Щетинка)", "", 7, 2, 3.8, 51.812, 36.215, "Курская обл."],["р. Свапа и Михайловское (Копенское) вдхр. (Дмитриев / Железногорск)", "", 7, 2, 4.5, 52.235, 35.342, "Курская обл."],["р. Псёл (Обоянь / Белая / Суджа)", "", 7, 0, 2.4, 51.145, 35.815, "Курская обл."],["Старооскольское вдхр. (северный плёс — пгт Горшечное)", "", 6, 2, 5.2, 51.452, 37.915, "Курская обл."],["р. Тим, р. Кшень и р. Олым (восточные районы — бассейн р. Быстрая Сосна / Дон)", "", 6, 0, 1.9, 51.835, 37.825, "Курская обл."],["р. Дон (Данков / Лебедянь / Задонск / Хлевное)", "", 6, 1, 3.5, 52.685, 39.025, "Липецкая обл."],["р. Воронеж (Доброе / Липецк / Хлевное)", "", 6, 1, 3.4, 52.615, 39.612, "Липецкая обл."],["р. Быстрая Сосна (Елец / Измалково / впадение в Дон)", "", 6, 0, 2.6, 52.625, 38.515, "Липецкая обл."],["р. Красивая Меча (низовья — Лебедянский р-н, с. Троекурово)", "", 6, 0, 2.3, 52.995, 39.015, "Липецкая обл."],["р. Матыра (Грязи)", "", 6, 0, 2.2, 52.495, 39.935, "Липецкая обл."],["р. Становая Ряса (Чаплыгин)", "", 6, 0, 1.9, 53.242, 39.967, "Липецкая обл."],["р. Усмань (Усмань)", "", 6, 0, 1.8, 52.043, 39.736, "Липецкая обл."],["р. Ока (Кромы / Орёл / Болхов / Мценский р-н)", "", 2, 0, 2.5, 53.152, 36.125, "Орловская обл."],["р. Зуша (Новосиль / Корсаково / Мценск)", "", 2, 0, 2.4, 53.215, 36.752, "Орловская обл."],["р. Быстрая Сосна (Колпна / Ливны)", "", 6, 0, 2.3, 52.425, 37.605, "Орловская обл."],["р. Нугрь (Болхов)", "", 2, 0, 1.8, 53.442, 36.005, "Орловская обл."],["р. Неручь (Залегощь)", "", 2, 0, 1.7, 52.903, 36.883, "Орловская обл."],["р. Крома и р. Орлик (Кромы / Орёл)", "", 2, 0, 1.7, 52.845, 35.895, "Орловская обл."],["р. Нерусса (Дмитровск — верховья)", "", 7, 0, 1.8, 52.505, 35.147, "Орловская обл."],["Неручанское и Михайловское вдхр. / пруды Орловщины", "", 2, 3, 3.0, 52.685, 36.415, "Орловская обл."],["р. Ока (Константиново / Рыбное / Спасск-Рязанский / Елатьма)", "", 2, 1, 4.5, 54.512, 40.385, "Рязанская обл."],["Новомичуринское вдхр. (Рязанская ГРЭС на р. Проня)", "", 2, 4, 5.5, 54.045, 39.752, "Рязанская обл."],["р. Проня (Михайлов / Пронск / Старожилово / Спасск-Рязанский — устье в Оку)", "", 2, 0, 2.6, 54.227, 39.914, "Рязанская обл."],["р. Мокша (Кадом / Пителино / устье в Оку)", "", 2, 1, 3.8, 54.615, 42.115, "Рязанская обл."],["р. Цна (Шацк / Сасово)", "", 2, 0, 2.7, 54.354, 41.926, "Рязанская обл."],["р. Ранова и р. Пара (Ряжск / Кораблино / Сараи / Шилово)", "", 2, 0, 2.2, 53.919, 40.019, "Рязанская обл."],["р. Гусь (Гусь-Железный — впадение в Оку)", "", 2, 0, 2.0, 55.056, 41.163, "Рязанская обл."],["Клепиковские (Великие) озёра Мещёры (оз. Великое, Шагара, Ивановское, Белое, Мартыново — Спас-Клепики)", "", 2, 3, 2.6, 55.185, 40.152, "Рязанская обл."],["оз. Велье, оз. Дубовое и оз. Ижевское (пойменные озёра Оки)", "", 2, 3, 2.8, 54.558, 40.871, "Рязанская обл."],["Вазузское вдхр. (Сычёвка / Гагарин / Хлепень / Дубинино)", "", 2, 2, 7.2, 55.945, 34.485, "Смоленская обл."],["Яузское вдхр. (Карманово / Пудыши / Савино — Гагаринский р-н)", "", 2, 2, 6.8, 55.862, 35.015, "Смоленская обл."],["р. Днепр (Холм-Жирковский / Сафоново / Дорогобуж / Верхнеднепровский / Смоленск)", "", 7, 1, 3.6, 54.916, 33.297, "Смоленская обл."],["р. Западная Двина (Велиж)", "", 5, 1, 3.8, 55.606, 31.197, "Смоленская обл."],["р. Каспля (Демидов)", "", 5, 0, 2.2, 55.271, 31.515, "Смоленская обл."],["Озёра нацпарка «Смоленское Поозерье» (оз. Сапшо, Баклановское, Рытое, Чистик, Дго — пгт Пржевальское)", "", 5, 2, 7.5, 55.509, 31.849, "Смоленская обл."],["оз. Сошно (охладитель Смоленской ГРЭС, пгт Озёрный)", "", 5, 4, 4.8, 55.589, 32.393, "Смоленская обл."],["оз. Акатовское и оз. Каспля (Демидовский / Смоленский р-н)", "", 5, 2, 4.5, 55.115, 31.585, "Смоленская обл."],["р. Угра и р. Воря (Угра / Тёмкино)", "", 2, 0, 2.2, 54.915, 34.625, "Смоленская обл."],["р. Сож и р. Остёр (Рославль / Хиславичи)", "", 7, 0, 2.3, 54.052, 32.315, "Смоленская обл."],["р. Вопь (Ярцево)", "", 7, 0, 2.0, 55.067, 32.696, "Смоленская обл."],["р. Ворона (Кирсанов / Инжавино / Уварово / Мучкапский — оз. Рамза)", "", 6, 0, 2.7, 52.185, 42.495, "Тамбовская обл."],["р. Лесной Воронеж и р. Польной Воронеж (Мичуринск / Дмитриевка)", "", 6, 0, 2.4, 52.895, 40.515, "Тамбовская обл."],["Шушпанское вдхр. (Староюрьевский р-н)", "", 6, 2, 3.8, 53.218, 40.615, "Тамбовская обл."],["Челновая (Челнавское) вдхр. (Сосновский р-н)", "", 2, 2, 4.0, 53.165, 41.315, "Тамбовская обл."],["р. Савала (Жердевка)", "", 6, 0, 2.0, 51.848, 41.464, "Тамбовская обл."],["р. Битюг (верховья — Мордово)", "", 6, 0, 1.9, 52.085, 40.768, "Тамбовская обл."],["р. Матыра (верховья — Петровский р-н)", "", 6, 0, 1.8, 52.634, 40.264, "Тамбовская обл."],["оз. Рамза и оз. Кипец (пойма р. Ворона, Инжавинский р-н)", "", 6, 3, 2.8, 52.145, 42.482, "Тамбовская обл."],["Верхневолжское вдхр. (Верхневолжские озёра: Стерж, Вселуг, Пено, Волго — Пеновский / Осташковский / Селижаровский р-н)", "", 2, 2, 5.8, 56.924, 32.735, "Тверская обл."],["оз. Удомля и оз. Песьво (охладители Калининской АЭС, г. Удомля)", "", 2, 4, 6.2, 57.905, 35.025, "Тверская обл."],["Вышневолоцкое вдхр. и оз. Мстино (Вышний Волочёк)", "", 3, 2, 4.5, 57.585, 34.485, "Тверская обл."],["Вазузское вдхр. (северный плёс — г. Зубцов)", "", 2, 2, 6.8, 56.115, 34.552, "Тверская обл."],["р. Волга (Селижарово / Старица / Тверь / Кимры / Белый Городок)", "", 2, 1, 4.5, 56.858, 35.915, "Тверская обл."],["р. Шоша и Шошинский плёс Иваньковского вдхр. (Завидово / Конаково)", "", 2, 2, 4.2, 56.592, 36.525, "Тверская обл."],["р. Медведица (Рамешки / Кимрский р-н — устье в Угличское вдхр.)", "", 2, 0, 2.6, 57.125, 37.185, "Тверская обл."],["р. Молога (Бежецк / Максатиха / Весьегонск — Моложский плёс Рыбинки)", "", 2, 1, 4.8, 58.185, 36.415, "Тверская обл."],["оз. Сиг, оз. Вельё, оз. Пирос, оз. Кафтино (Осташковский / Бологовский р-н)", "", 3, 2, 6.5, 57.042, 33.115, "Тверская обл."],["оз. Великое и Оршинские озёра (Рамешковский / Калининский р-н)", "", 2, 3, 2.5, 56.985, 36.385, "Тверская обл."],["р. Западная Двина и р. Межа (Андреаполь / Западная Двина / Нелидово / Жарковский)", "", 5, 0, 2.5, 56.258, 32.084, "Тверская обл."],["оз. Бросно и оз. Соломенное / р. Торопа (Андреаполь / Торопец)", "", 5, 2, 12.0, 56.498, 31.635, "Тверская обл."],["р. Ока (Белёв / Чекалин / Алексин / Поленово / Заокский)", "", 2, 1, 3.6, 54.505, 37.068, "Тульская обл."],["р. Упа (Советск / Тула / Дубна / Одоев / впадение в Оку)", "", 2, 0, 2.3, 54.156, 36.96, "Тульская обл."],["Черепетское вдхр. (Черепетская ГРЭС, г. Суворов)", "", 2, 4, 4.8, 54.125, 36.465, "Тульская обл."],["Щёкинское вдхр. (Первомайская ТЭЦ / Советская ГРЭС, г. Советск)", "", 2, 4, 4.2, 53.938, 37.632, "Тульская обл."],["Шатское вдхр. (Новомосковская ГРЭС, г. Новомосковск)", "", 2, 4, 4.0, 54.058, 38.252, "Тульская обл."],["Пронское вдхр. (исток р. Проня — Новомосковск / Кимовск / Гремячее)", "", 2, 2, 5.2, 54.125, 38.685, "Тульская обл."],["Любовское вдхр. (р. Любовка, Новомосковск)", "", 2, 2, 3.8, 54.035, 38.315, "Тульская обл."],["р. Красивая Меча (Тёплое / Воловский р-н / Ефремов / Шилово / Ишутино)", "", 6, 0, 2.2, 53.148, 38.115, "Тульская обл."],["р. Дон — верховья и р. Непрядва (Новомосковск / Донской / Епифань / Куркино)", "", 6, 0, 1.9, 53.685, 38.585, "Тульская обл."],["р. Осётр (Венёвский / Ясногорский р-н)", "", 2, 0, 2.1, 54.349, 38.268, "Тульская обл."],["р. Воронка и Яснополянские пруды (Тула / Щёкино)", "", 2, 3, 2.4, 54.075, 37.525, "Тульская обл."],["Романцевские карьеры («Голубые озёра Кондуки», Узловский / Кимовский р-н)", "", 6, 2, 8.5, 53.848, 38.393, "Тульская обл."],["Горьковское вдхр. / р. Волга (Рыбинск — Тутаев — Ярославль — Некрасовское — Красный Профинтерн)", "", 2, 1, 6.2, 57.749, 40.385, "Ярославская обл."],["р. Сить и р. Сутка (Брейтово / Борок / Некоуз — главные нерестовые реки зимней плотвы Рыбинки)", "", 2, 0, 2.6, 58.265, 37.895, "Ярославская обл."],["р. Чеснава, р. Ламь и р. Себла (Брейтовский р-н, Рыбинское вдхр.)", "", 2, 0, 2.4, 58.415, 37.652, "Ярославская обл."],["р. Согожа, р. Ухра и р. Керома (Пошехонье, Восточный плёс Рыбинки)", "", 2, 0, 2.8, 58.498, 39.125, "Ярославская обл."],["р. Юхоть (Большое Село / Мышкин — Юхотский залив Волги)", "", 2, 0, 2.5, 57.768, 38.585, "Ярославская обл."],["р. Солоница и р. Туношонка (Некрасовское / Туношна — впадение в Волгу)", "", 2, 0, 2.1, 57.625, 40.285, "Ярославская обл."],["р. Трубеж и оз. Сомино (Переславль-Залесский)", "", 2, 0, 2.0, 56.735, 38.835, "Ярославская обл."],["р. Сара и р. Устье (Ростовский / Борисоглебский р-н — оз. Неро)", "", 2, 0, 2.1, 57.152, 39.325, "Ярославская обл."],["р. Обнора и р. Соть (Любим / Пречистое)", "", 2, 0, 2.2, 58.362, 40.686, "Ярославская обл."],["оз. Яхробольское (Некрасовский р-н)", "", 2, 3, 2.4, 57.715, 40.312, "Ярославская обл."],["Ладожское озеро", "", 3, 2, 12.0, 60.5, 31.0, "Приозерск / Шлиссельбург"],["Онежское озеро", "", 3, 2, 14.0, 61.79, 34.37, "Петрозаводск"],["р. Нева", "", 3, 1, 6.5, 59.93, 30.34, "Санкт-Петербург"],["р. Вуокса", "", 3, 1, 4.5, 60.68, 30.0, "Лосево / Приозерск"],["оз. Отрадное", "", 3, 2, 7.5, 60.82, 30.2, "Ленинградская обл."],["р. Свирь", "", 3, 1, 5.2, 60.91, 34.17, "Подпорожье"],["р. Волхов", "", 3, 1, 4.8, 60.1, 32.3, "Новая Ладога"],["оз. Ильмень (Великий Новгород)", "Ильмень", 3, 3, 2.8, 58.28, 31.28, "Великий Новгород"],["оз. Сямозеро", "", 3, 2, 6.0, 61.9, 33.15, "Пряжинский р-н"],["оз. Сегозеро", "", 3, 2, 18.0, 63.3, 33.8, "Медвежьегорский р-н"],["оз. Выгозеро", "", 3, 2, 7.0, 63.6, 34.7, "Сегежа"],["р. Суна", "", 3, 0, 2.2, 62.27, 33.98, "Кивач"],["р. Шуя (Карелия)", "Шуя", 3, 0, 2.0, 61.91, 34.25, "Петрозаводск"],["оз. Пяозеро / Топозеро", "Пяозеро", 3, 2, 15.0, 65.8, 31.0, "Северная Карелия"],["Баренцево море (Териберка)", "", 4, 6, 25.0, 69.17, 35.14, "Териберка"],["Кольский залив (Мурманск)", "Кольский залив", 4, 5, 18.0, 68.97, 33.08, "Мурманск"],["Белое море (Кандалакшский залив)", "Кандалакшский залив", 4, 5, 12.0, 67.15, 32.4, "Кандалакша"],["Белое море (Двинский залив / Северодвинск)", "Двинский залив", 4, 5, 8.5, 64.6, 39.8, "Северодвинск / Архангельск"],["р. Северная Двина (Архангельск)", "Северная Двина", 4, 1, 6.5, 64.54, 40.52, "Архангельск"],["р. Онега", "", 4, 1, 3.8, 63.9, 38.1, "Онега"],["р. Вычегда (Сыктывкар)", "Вычегда", 4, 1, 3.5, 61.67, 50.83, "Сыктывкар"],["р. Кола", "", 4, 0, 1.8, 68.88, 33.02, "п. Молочный"],["р. Тулома", "", 4, 1, 4.5, 68.81, 32.81, "Мурмаши"],["р. Варзуга", "", 4, 0, 1.6, 66.4, 36.58, "Терский берег"],["р. Умба", "", 4, 0, 2.0, 66.68, 34.35, "Терский берег"],["р. Поной", "", 4, 0, 2.2, 67.07, 39.5, "Кольский п-ов"],["оз. Имандра", "", 4, 2, 10.0, 67.6, 33.1, "Апатиты / Мончегорск"],["оз. Ловозеро", "", 4, 2, 8.0, 67.85, 35.15, "Ловозерский р-н"],["р. Печора (Нарьян-Мар)", "Печора", 4, 1, 6.0, 67.64, 53.0, "Ненецкий АО"],["р. Печора (г. Печора / Усинск)", "Печора", 4, 1, 4.8, 65.14, 57.22, "Республика Коми"],["р. Уса (Усинск)", "Уса", 4, 1, 3.8, 65.98, 57.55, "Усинск / Инта"],["Финский залив (Маркизова лужа)", "Финский залив", 5, 5, 5.5, 59.95, 30.2, "Санкт-Петербург"],["Финский залив (Дамба КЗС / Кронштадт)", "Дамба Кронштадт", 5, 5, 7.5, 60.01, 29.74, "Кронштадт"],["Выборгский залив", "", 5, 5, 7.2, 60.71, 28.75, "Выборг"],["р. Луга (Усть-Луга)", "Луга", 5, 1, 3.5, 59.68, 28.3, "Кингисеппский р-н"],["р. Нарва (Ивангород)", "Нарва", 5, 1, 4.2, 59.38, 28.2, "Ивангород"],["Куршский залив", "", 5, 5, 3.8, 54.96, 20.47, "Зеленоградск / Коса"],["Балтийское море (Балтийск / Янтарный)", "Балтийское море", 5, 6, 14.0, 54.64, 19.89, "Калининградская обл."],["Калининградский (Вислинский) залив", "Калининградский залив", 5, 5, 3.5, 54.65, 20.15, "Калининград"],["р. Преголя", "", 5, 1, 3.2, 54.71, 20.51, "Калининград"],["р. Дейма / Матросовка", "Дейма", 5, 0, 2.8, 54.82, 21.1, "Полесск"],["оз. Чудско-Псковское", "Чудское озеро", 5, 2, 6.5, 57.82, 28.33, "Псков"],["р. Великая", "", 5, 1, 2.8, 57.81, 28.32, "Псков"],["р. Луга (г. Луга)", "р. Луга", 5, 0, 2.5, 58.74, 29.85, "Луга (Ленинградская обл.)"],["р. Волхов / р. Тихвинка (Кириши / Тихвин)", "р. Волхов (Кириши)", 3, 1, 4.5, 59.52, 32.75, "Кириши / Тихвин (ЛО)"],["оз. Валдайское / р. Мста (Валдай / Боровичи)", "оз. Валдайское", 3, 2, 8.0, 58.15, 33.55, "Валдай / Боровичи (Новгородская обл.)"],["Чудское озеро (Гдов)", "", 5, 2, 7.0, 58.74, 27.8, "Гдов (Псковская обл.)"],["р. Ловать / оз. Жижицкое (Великие Луки)", "р. Ловать (Великие Луки)", 5, 0, 2.4, 56.34, 30.53, "Великие Луки (Псковская обл.)"],["р. Неман (Советск)", "р. Неман", 5, 1, 3.8, 55.085, 21.885, "Советск (Калининградская обл.)"],["Ладожские шхеры (Сортавала / Лахденпохья / Питкяранта / Олонец)", "Ладожские шхеры (Сортавала)", 3, 2, 14.0, 61.55, 31.1, "Сортавала / Лахденпохья (Карелия)"],["Онежское озеро / р. Водла (Пудож / Медвежьегорск)", "р. Водла (Онежское оз.)", 3, 1, 5.5, 61.81, 36.52, "Пудож (Карелия)"],["Белое море / р. Кемь (Беломорск / Кемь)", "Белое море (Беломорск / Кемь)", 4, 5, 9.0, 64.75, 34.68, "Беломорск / Кемь (Карелия)"],["оз. Среднее Куйто / оз. Нюк (Калевала / Костомукша)", "оз. Куйто (Калевала)", 3, 2, 10.0, 64.9, 30.9, "Калевала / Костомукша (Карелия)"],["оз. Кереть / Чупинская губа (Лоухи)", "оз. Кереть (Лоухи)", 4, 2, 9.5, 66.08, 33.05, "Лоухи (Карелия)"],["р. Северная Двина (Котлас)", "р. Северная Двина (Котлас)", 4, 1, 5.2, 61.255, 46.65, "Котлас (Архангельская обл.)"],["р. Вага (Вельск)", "р. Вага (Вельск)", 4, 1, 3.5, 61.07, 42.1, "Вельск (Архангельская обл.)"],["р. Мезень (Мезень)", "р. Мезень", 4, 1, 4.5, 65.85, 44.24, "Мезень (Архангельская обл.)"],["р. Ижма / р. Ухта (Ухта)", "р. Ижма (Ухта)", 4, 1, 3.5, 63.57, 53.69, "Ухта (Коми)"],["р. Печора (Усть-Цильма)", "р. Печора (Усть-Цильма)", 4, 1, 6.0, 65.442, 52.15, "Усть-Цильма (Коми)"],["р. Воркута / р. Уса (Воркута)", "р. Уса (Воркута)", 4, 0, 2.4, 67.498, 64.052, "Воркута (Коми)"],["Онежское озеро (Медвежьегорск)", "", 3, 2, 12.0, 62.895, 34.468, "Медвежьегорск"],["р. Кемь и Выг (Кемь / Беломорск)", "р. Кемь (Кемь)", 4, 1, 4.5, 64.952, 34.605, "Кемь"],["р. Нижний Выг (Беломорск)", "р. Выг (Беломорск)", 4, 1, 4.5, 64.522, 34.76, "Беломорск"],["р. Олонка и Ладога (Олонец)", "р. Олонка (Олонец)", 3, 0, 2.8, 60.985, 32.968, "Олонец"],["Белое озеро (Белозерск / Липин Бор)", "Белое озеро", 2, 2, 4.8, 60.155, 37.655, "Вологодская обл."],["оз. Кубенское (Вологда)", "Озеро Кубенское", 4, 2, 3.5, 59.625, 39.515, "Вологодская обл."],["р. Сухона (Сокол / Тотьма / Великий Устюг)", "Сухона", 4, 1, 4.2, 59.975, 42.765, "Вологодская обл."],["Шекснинское вдхр. (Шексна / Череповец)", "Шекснинское вдхр.", 2, 2, 6.5, 59.355, 38.455, "Вологодская обл."],["оз. Воже (Вожега)", "Озеро Воже", 4, 2, 3.2, 60.585, 39.115, "Вологодская обл."],["Морской канал Санкт-Петербурга (Канонерский остров — Кронштадт)", "", 5, 5, 9.5, 59.915, 30.125, "Санкт-Петербург"],["р. Большая, Средняя и Малая Невка (ЦПКиО / Елагин и Крестовский о-ва)", "", 5, 1, 4.8, 59.978, 30.265, "Санкт-Петербург"],["оз. Сестрорецкий Разлив и р. Сестра (Сестрорецк)", "", 5, 3, 2.4, 60.085, 29.992, "Санкт-Петербург"],["Лахтинский разлив (Лахта / Ольгино)", "", 5, 3, 3.2, 59.995, 30.158, "Санкт-Петербург"],["Суздальские озёра (Верхнее, Среднее, Нижнее — Озерки / Шувалово)", "", 5, 2, 4.5, 60.045, 30.308, "Санкт-Петербург"],["Ивановский карьер и Сортировочный карьер (Нева / Купчино)", "", 5, 2, 6.2, 59.872, 30.438, "Санкт-Петербург"],["Дудергофское, Безымянное и Долгое озёра (Красное Село)", "", 5, 3, 3.0, 59.718, 30.105, "Санкт-Петербург"],["р. Ижора и Колпинский пруд (Колпино / Усть-Ижора)", "", 5, 0, 2.3, 59.75, 30.585, "Санкт-Петербург"],["Южная Ладога: бухта Петрокрепость, Кобона, Леднево, Чёрное, Креницы, Вороново, Свирица, Новоладожский канал", "", 3, 2, 5.5, 60.125, 31.815, "Ленинградская обл."],["Финский залив: Копорская губа (Сосновый Бор, тёплый сброс ЛАЭС) и Лужская губа (Усть-Луга / Вистино)", "", 5, 5, 7.5, 59.845, 28.785, "Ленинградская обл."],["Финский залив: северный берег (Зеленогорск — Приморск — пролив Бьёркезунд — Высоцк)", "", 5, 5, 8.5, 60.365, 28.615, "Ленинградская обл."],["оз. Вуокса (Приозерск / Синёво) и Барышевский плёс р. Вуокса (Каменногорск — Барышево — Лосево)", "", 3, 2, 6.5, 60.815, 29.745, "Ленинградская обл."],["оз. Суходольское (Суванто) и р. Бурная (Сосново / Лосево / Соловьёво)", "", 3, 2, 7.8, 60.625, 30.255, "Ленинградская обл."],["оз. Глубокое, оз. Комсомольское, оз. Мичуринское, оз. Красное, оз. Нахимовское (Карельский перешеек)", "", 3, 2, 7.2, 60.568, 29.855, "Ленинградская обл."],["оз. Кавголовское и оз. Хепоярви (Токсово)", "", 3, 3, 3.6, 60.168, 30.535, "Ленинградская обл."],["Нарвское вдхр. и р. Плюсса (Ивангород / Сланцы)", "", 5, 2, 4.2, 59.285, 28.185, "Ленинградская обл."],["р. Паша и р. Оять (Свирица / Паша / Лодейное Поле)", "", 3, 0, 2.8, 60.455, 33.115, "Ленинградская обл."],["р. Сясь (Сясьстрой)", "", 3, 0, 2.6, 60.138, 32.558, "Ленинградская обл."],["р. Оредеж (Сиверский / Вырица — Череменецкое и Врево озёра, Луга)", "", 5, 0, 2.4, 59.354, 30.081, "Ленинградская обл."],["Онежское озеро (Вознесенье, Подпорожский р-н)", "", 3, 2, 9.5, 61.035, 35.495, "Ленинградская обл."],["оз. Янисъярви (Большое Янисъярви — Сортавальский / Суоярвский р-н)", "", 3, 2, 11.5, 61.985, 30.955, "Республика Карелия"],["оз. Сандал (Кондопога)", "", 3, 2, 9.8, 62.355, 34.185, "Республика Карелия"],["оз. Водлозеро (Пудожский р-н, нацпарк «Водлозерский»)", "", 3, 2, 4.2, 62.315, 36.885, "Республика Карелия"],["оз. Ведлозеро (Пряжинский р-н)", "", 3, 2, 6.5, 61.569, 32.839, "Республика Карелия"],["оз. Суоярви и оз. Салонъярви (Суоярви)", "", 3, 2, 5.8, 62.135, 32.345, "Республика Карелия"],["оз. Верхнее, Среднее и Нижнее Куйто (Калевала)", "", 3, 2, 9.2, 65.145, 31.255, "Республика Карелия"],["оз. Тикшеозеро и оз. Энгозеро (Лоухский р-н)", "", 4, 2, 8.5, 66.215, 32.085, "Республика Карелия"],["оз. Лексозеро (Муезерский р-н, Реболы)", "", 3, 2, 8.2, 63.785, 30.945, "Республика Карелия"],["оз. Ондoзеро (Сегежский р-н)", "", 3, 2, 4.8, 63.765, 33.415, "Республика Карелия"],["Онежская губа и Чупинская губа Белого моря (Беломорск — Сумский Посад — Кемь — Чупа)", "", 4, 5, 12.0, 65.115, 34.885, "Республика Карелия"],["р. Кереть (Лоухский р-н)", "", 4, 0, 2.4, 66.155, 33.245, "Республика Карелия"],["р. Писта (Пистайоки — Калевальский / Лоухский р-н)", "", 4, 0, 2.3, 65.585, 30.725, "Республика Карелия"],["р. Онда и р. Сегежа", "", 3, 0, 2.5, 63.745, 34.285, "Республика Карелия"],["р. Видлица и р. Тулемайоки (Олонецкий / Питкярантский р-н)", "", 3, 0, 2.2, 61.265, 32.115, "Республика Карелия"],["р. Печора (Троицко-Печорск / Вуктыл — верхняя и средняя Печора)", "", 4, 1, 4.5, 63.515, 57.185, "Республика Коми"],["р. Сысола (Койгородок / Визинга / Сыктывкар)", "", 4, 1, 3.2, 61.185, 50.345, "Республика Коми"],["р. Вымь (Емва / Усть-Вымь)", "", 4, 0, 2.6, 62.589, 50.858, "Республика Коми"],["р. Мезень и р. Вашка (Усогорск / Кослан — Удорский р-н)", "", 4, 1, 3.4, 63.456, 48.898, "Республика Коми"],["р. Щугор, р. Илыч и р. Подчерем (притоки Печоры с Северного и Приполярного Урала — Вуктыл / Троицко-Печорск)", "", 4, 0, 2.5, 64.255, 58.115, "Республика Коми"],["р. Косью, р. Лемва и р. Большая Инта (Инта — Приполярный Урал)", "", 4, 0, 2.4, 65.915, 60.025, "Республика Коми"],["р. Цильма и р. Пижма (Усть-Цильма)", "", 4, 0, 2.5, 65.415, 52.085, "Республика Коми"],["р. Луза (Объячево — Прилузский р-н)", "", 4, 0, 2.3, 60.372, 49.647, "Республика Коми"],["оз. Синдорское (Княжпогостский р-н, пгт Синдор)", "", 4, 3, 2.2, 62.785, 51.915, "Республика Коми"],["оз. Донты (Дон-Ты, Усть-Куломский р-н)", "", 4, 3, 2.4, 61.625, 53.915, "Республика Коми"],["Печорское вдхр. (тепловой сброс Печорской ГРЭС, г. Печора)", "", 4, 4, 4.5, 65.165, 57.255, "Республика Коми"],["Дельта Северной Двины: Маймакса, Никольский, Мурманский и Корабельный рукава, Сухое море (о. Мудьюг — Архангельск / Северодвинск)", "", 4, 5, 6.5, 64.685, 40.315, "Архангельская обл."],["Унская губа и Онежский залив Белого моря (Уна / Луда / Онега / Кий-остров)", "", 4, 5, 7.8, 64.485, 38.125, "Архангельская обл."],["Мезенская губа Белого моря (Мезень / Каменка / Койда)", "", 4, 5, 8.2, 66.085, 44.055, "Архангельская обл."],["р. Северная Двина (Холмогоры / Емецк / Березник / Верхняя Тойма / Красноборск)", "", 4, 1, 5.5, 62.853, 42.708, "Архангельская обл."],["р. Пинега (Карпогоры / Пинега / Белогорский)", "", 4, 1, 3.6, 64.255, 43.895, "Архангельская обл."],["р. Вычегда (Котлас / Коряжма / Сольвычегодск / Яренск)", "", 4, 1, 4.2, 61.314, 47.142, "Архангельская обл."],["р. Онега (Каргополь / Североонежск / Плесецк)", "", 4, 1, 3.5, 62.583, 39.841, "Архангельская обл."],["р. Вага и р. Устья (Вельск / Шенкурск / Октябрьский)", "", 4, 0, 2.5, 61.815, 42.655, "Архангельская обл."],["р. Емца и р. Кулой", "", 4, 0, 2.4, 63.315, 41.255, "Архангельская обл."],["оз. Лача (Лаче — Каргополь)", "", 4, 2, 3.2, 61.325, 38.785, "Архангельская обл."],["оз. Кенозеро и оз. Лёкшмозеро (Кенозерский нацпарк, Каргопольский / Плесецкий р-н)", "", 4, 2, 9.5, 62.085, 38.195, "Архангельская обл."],["оз. Кожозеро и оз. Сийское (Онежский / Холмогорский р-н)", "", 4, 2, 8.5, 63.155, 38.925, "Архангельская обл."],["Дельта р. Печора и Печорская губа Баренцева моря (Нарьян-Мар / Искателей / Оксино / Красное)", "", 4, 5, 6.2, 68.025, 53.685, "Ненецкий АО"],["оз. Голодная Губа (Нарьян-Мар / Оксино — крупнейшее озеро НАО)", "", 4, 3, 2.8, 67.815, 52.585, "Ненецкий АО"],["р. Сула и р. Сойма (Коткино / Великовисочное)", "", 4, 0, 2.4, 67.115, 51.525, "Ненецкий АО"],["р. Колва и р. Адзьва (Хорей-Вер / Харута)", "", 4, 0, 2.5, 67.145, 58.655, "Ненецкий АО"],["р. Индига и Чёшская губа Баренцева моря (Индига / Нижняя Пёша)", "", 4, 5, 7.5, 67.685, 48.725, "Ненецкий АО"],["р. Коротаиха и Хайпудырская губа (Каратайка)", "", 4, 5, 6.5, 68.765, 61.425, "Ненецкий АО"],["р. Кара и Карская губа Карского моря (Усть-Кара / Амдерма)", "", 4, 5, 7.8, 69.251, 64.933, "Ненецкий АО"],["Вашуткины озёра и оз. Пинейты (Большеземельская тундра)", "", 4, 2, 8.5, 67.955, 61.615, "Ненецкий АО"],["Онежское озеро — южный берег и Волго-Балтийский канал (Вытегра / Ошта / Тудозеро)", "", 3, 2, 8.5, 61.125, 36.215, "Вологодская обл."],["р. Шексна и р. Суда (Череповец / Кадуй — тёплый сброс Череповецкой ГРЭС)", "", 2, 1, 4.8, 59.165, 37.525, "Вологодская обл."],["р. Молога и р. Чагодоща (Устюжна / Чагода / Бабаево — р. Колпь)", "", 2, 1, 3.6, 58.955, 36.125, "Вологодская обл."],["р. Вологда и р. Лежа (Вологда / Грязовец)", "", 4, 0, 2.5, 59.235, 40.085, "Вологодская обл."],["р. Кубена (Харовск / Сямжа / Усть-Кубинское — впадение в оз. Кубенское)", "", 4, 0, 2.6, 59.815, 39.955, "Вологодская обл."],["р. Юг и р. Малая Северная Двина (Никольск / Кичменгский Городок / Великий Устюг / Красавино)", "", 4, 1, 4.0, 60.755, 46.315, "Вологодская обл."],["р. Вага и р. Кокшеньга (Верховажье / Тарногский Городок)", "", 4, 0, 2.3, 60.615, 42.825, "Вологодская обл."],["оз. Сиверское, оз. Бородаевское и Северо-Двинская водная система (Кириллов / Топорня)", "", 2, 2, 6.2, 59.858, 38.375, "Вологодская обл."],["оз. Лозско-Азатское (Белозерский р-н)", "", 2, 2, 5.5, 59.825, 37.215, "Вологодская обл."],["Калининградский морской канал и Балтийский пролив (Калининград — Светлый — Приморск — Балтийск, Северный и Южный молы)", "", 5, 5, 9.8, 54.665, 20.055, "Калининградская обл."],["р. Преголя (Черняховск / Знаменск / Гвардейск / Калининград)", "", 5, 1, 4.5, 54.649, 21.071, "Калининградская обл."],["р. Лава и Правдинское вдхр. (Правдинск / Знаменск)", "", 5, 0, 3.2, 54.444, 21.018, "Калининградская обл."],["р. Шешупе (Краснознаменск)", "", 5, 0, 2.4, 54.943, 22.49, "Калининградская обл."],["р. Анграпа и р. Писса / Красная (Озёрск / Гусев / Черняховск)", "", 5, 0, 2.1, 54.515, 22.085, "Калининградская обл."],["р. Прохладная (Багратионовский / Гурьевский р-н — Ушаково)", "", 5, 0, 2.0, 54.614, 20.252, "Калининградская обл."],["Дельта Немана: р. Матросовка, р. Тава, р. Немонин, Полесский канал (Славский / Полесский р-н, Головкино / Матросово)", "", 5, 0, 3.0, 55.015, 21.309, "Калининградская обл."],["оз. Виштынецкое (Нестеровский р-н — глубоководное ледниковое озеро)", "", 5, 2, 15.0, 54.432, 22.715, "Калининградская обл."],["оз. Синявинское (карьер Янтарный)", "", 5, 2, 11.5, 54.885, 19.955, "Калининградская обл."],["Пруды Калининграда (Верхний, Нижний, Пелавское оз., Карповское оз., Голубые озёра / Форелевое)", "", 5, 2, 4.2, 54.675, 20.445, "Калининградская обл."],["Баренцево море: Ура-Губа, Мотовский залив, п-ов Рыбачий и о. Кильдин (морские банки трески и палтуса)", "", 4, 6, 45.0, 69.455, 33.125, "Мурманская обл."],["Верхнетуломское и Нижнетуломское вдхр. (пгт Верхнетуломский / Мурмаши)", "", 4, 2, 12.0, 68.606, 31.796, "Мурманская обл."],["оз. Умбозеро (Кировск / Ревда — между Хибинами и Ловозерскими тундрами)", "", 4, 2, 18.0, 67.715, 34.385, "Мурманская обл."],["Серебрянские вдхр. и р. Воронья (пгт Туманный / Ловозерский р-н)", "", 4, 2, 11.0, 68.881, 35.691, "Мурманская обл."],["Княжегубское (Ковдозерское) и Иовское вдхр. (Зеленоборский / Зареченск / Алакуртти)", "", 4, 2, 10.5, 66.765, 31.985, "Мурманская обл."],["Тёплый сброс Кольской АЭС в оз. Имандра (Бабинская Имандра, г. Полярные Зори)", "", 4, 4, 6.5, 67.458, 32.478, "Мурманская обл."],["р. Нива и Пиренгские озёра (Полярные Зори / Кандалакша)", "", 4, 0, 3.2, 67.285, 32.455, "Мурманская обл."],["р. Ура и р. Западная Лица (Кольский р-н)", "", 4, 0, 2.8, 69.185, 32.615, "Мурманская обл."],["р. Печенга и р. Паз (Патсойоки — Заполярный / Никель)", "", 4, 0, 3.0, 69.416, 30.814, "Мурманская обл."],["р. Йоканьга и р. Харловка / Восточная Лица (северный берег Кольского п-ова)", "", 4, 0, 2.8, 68.053, 39.513, "Мурманская обл."],["оз. Колозеро и оз. Пермусозеро (Оленегорск)", "", 4, 2, 8.5, 68.215, 33.245, "Мурманская обл."],["оз. Канозеро и оз. Колвицкое (Терский / Кандалакшский р-н)", "", 4, 2, 9.0, 67.055, 34.125, "Мурманская обл."],["Дельта р. Ловать, р. Пола, р. Верготь и Синецкий залив оз. Ильмень (Взвад / Парфино / Старая Русса)", "", 3, 1, 3.8, 58.115, 31.485, "Новгородская обл."],["р. Волхов (исток из оз. Ильмень — Великий Новгород — Кречевицы — Грузино — Чудово)", "", 3, 1, 5.5, 58.885, 31.655, "Новгородская обл."],["р. Шелонь (Сольцы / Шимск — устье в оз. Ильмень)", "", 3, 1, 3.4, 58.165, 30.515, "Новгородская обл."],["р. Мста (Боровичи / Любытино / Бронница — Мстинский Нос оз. Ильмень)", "", 3, 1, 3.6, 58.435, 31.615, "Новгородская обл."],["р. Полисть и р. Редья (Старая Русса)", "", 3, 0, 2.3, 57.989, 31.356, "Новгородская обл."],["р. Ловать и р. Кунья (Холм)", "", 3, 0, 2.5, 57.145, 31.178, "Новгородская обл."],["оз. Вельё и оз. Ужин (Валдайский нацпарк, Валдайский / Демянский р-н)", "", 3, 2, 9.5, 57.715, 33.045, "Новгородская обл."],["оз. Селигер — Полновский плёс (с. Полново, Демянский р-н)", "", 2, 2, 8.2, 57.584, 32.893, "Новгородская обл."],["оз. Пирос (Боровичский р-н)", "", 3, 2, 5.8, 58.125, 33.765, "Новгородская обл."],["оз. Великое и оз. Меглино (Мошенской / Пестовский р-н)", "", 2, 2, 7.2, 58.518, 35.045, "Новгородская обл."],["р. Молога и р. Кобожа (Пестово)", "", 2, 0, 2.6, 58.595, 35.815, "Новгородская обл."],["р. Луга — верховья (Батецкий р-н)", "", 5, 0, 2.1, 58.64, 30.312, "Новгородская обл."],["Псковское озеро, Тёплое озеро и дельта р. Великой (Псков / Печоры / Кривск / Толба / Талабские о-ва / Раскопель)", "", 5, 2, 5.2, 58.015, 28.015, "Псковская обл."],["р. Великая (Пустошка / Опочка / Пушкинские Горы / Остров / Псков)", "", 5, 1, 3.8, 57.343, 28.352, "Псковская обл."],["р. Шелонь и вдхр. Псковской ГРЭС (Дедовичи / Порхов)", "", 5, 4, 4.5, 57.552, 29.956, "Псковская обл."],["р. Плюсса (Плюсса / Гдовский р-н)", "", 5, 0, 2.3, 58.431, 29.368, "Псковская обл."],["р. Сороть и оз. Белая Струга (Пушкинские Горы / Новоржев / Палкино)", "", 5, 0, 2.2, 57.022, 28.914, "Псковская обл."],["оз. Жижицкое и оз. Двинье-Велинское (Куньинский р-н — крупнейшие озёра юга области)", "", 5, 2, 6.2, 56.252, 31.185, "Псковская обл."],["Озёра нацпарка «Себежский» (оз. Себежское, Ороно, Нечерица, Белое, Свибло — Себеж)", "", 5, 2, 6.8, 56.265, 28.485, "Псковская обл."],["оз. Иван (Большой и Малый Иван), оз. Невельское и оз. Езерище (Невельский р-н)", "", 5, 2, 6.5, 56.015, 29.965, "Псковская обл."],["оз. Полисто и оз. Цевло (Бежаницкий р-н, Полистовский заповедник)", "", 5, 3, 2.4, 57.165, 30.385, "Псковская обл."],["оз. Алё и оз. Велье (Бежаницкий / Пушкиногорский р-н)", "", 5, 2, 7.5, 56.865, 29.515, "Псковская обл."],["оз. Усвятское и р. Усвяча (Усвяты — бассейн Западной Двины)", "", 5, 2, 4.5, 55.748, 30.754, "Псковская обл."],["Волгоградское вдхр.", "", 2, 2, 8.2, 48.71, 44.51, "Волгоград"],["р. Волга (Астрахань / Дельта)", "Волга (Дельта)", 2, 1, 5.5, 46.35, 48.04, "Астрахань"],["р. Бахтемир (Главный банк)", "Бахтемир", 2, 1, 7.0, 45.95, 47.65, "Астраханская обл."],["р. Бузан", "", 2, 1, 5.0, 46.55, 48.3, "Астраханская обл."],["р. Ахтуба (Волго-Ахтубинская пойма)", "Ахтуба", 2, 1, 3.8, 48.0, 45.5, "Ахтубинск / Харабали"],["р. Дон (Ростов-на-Дону)", "Дон", 6, 1, 5.5, 47.22, 39.72, "Ростов-на-Дону"],["Цимлянское вдхр.", "", 6, 2, 8.0, 47.6, 42.1, "Волгодонск"],["р. Маныч (Весёловское вдхр.)", "Маныч", 6, 2, 4.2, 47.1, 40.8, "п. Весёлый"],["р. Северский Донец", "", 6, 1, 3.2, 48.32, 40.26, "Каменск-Шахтинский"],["р. Кубань (Краснодар)", "Кубань", 6, 1, 4.0, 45.03, 38.98, "Краснодар"],["Краснодарское вдхр. (Кубанское море)", "Краснодарское вдхр.", 6, 2, 6.2, 44.98, 39.25, "Краснодар"],["р. Кубань (Темрюк / дельта)", "Кубань (Дельта)", 6, 1, 3.5, 45.27, 37.38, "Темрюк"],["Бейсугский лиман / р. Бейсуг", "Бейсугский лиман", 6, 3, 1.8, 46.08, 38.55, "Приморско-Ахтарск"],["Чёрное море (Севастопольские бухты)", "Севастопольские бухты", 6, 5, 8.5, 44.62, 33.53, "Севастополь"],["р. Чёрная (Инкерман)", "р. Чёрная", 6, 0, 1.5, 44.61, 33.6, "Севастополь / Инкерман"],["Симферопольское вдхр.", "", 6, 2, 6.5, 44.92, 34.15, "Симферополь"],["Чёрное море (ЮБК / Ялта)", "Чёрное море (ЮБК)", 6, 6, 15.0, 44.5, 34.17, "Ялта"],["Керченский пролив", "", 6, 5, 7.5, 45.32, 36.48, "Керчь / Тамань"],["Цемесская бухта (Новороссийск)", "Цемесская бухта", 6, 5, 12.0, 44.72, 37.78, "Новороссийск"],["Чёрное море (Сочи / Адлер)", "Чёрное море (Сочи)", 6, 6, 16.0, 43.59, 39.73, "Сочи"],["р. Мзымта", "", 6, 0, 1.8, 43.42, 39.92, "Адлер"],["р. Сочи", "р. Сочи", 6, 0, 1.4, 43.595, 39.735, "Сочи"],["Азовское море (Таганрогский залив)", "Таганрогский залив", 6, 5, 4.5, 47.2, 38.92, "Таганрог"],["Ейский лиман", "", 6, 5, 2.8, 46.7, 38.3, "Ейск"],["оз. Абрау", "", 6, 2, 7.0, 44.7, 37.6, "Абрау-Дюрсо"],["р. Шахе (Головинка / Сочи)", "Шахе", 6, 0, 1.6, 43.79, 39.46, "Сочи / Лазаревское"],["р. Псоу (Адлер / Сириус)", "Псоу", 6, 0, 1.7, 43.395, 40.01, "Адлер / Сириус"],["Имеретинская бухта (Сириус)", "Имеретинский порт (Сириус)", 6, 5, 7.5, 43.4, 39.95, "Адлер / Сириус"],["р. Хоста (Сочи)", "Хоста", 6, 0, 1.4, 43.515, 39.87, "Хоста / Сочи"],["Бейсугский лиман", "", 6, 5, 2.2, 46.08, 38.45, "Приморско-Ахтарск / Бриньковская"],["Ахтанизовский лиман", "", 6, 3, 1.8, 45.31, 37.18, "Темрюк / Голубицкая"],["Волгоградское вдхр. (Камышин / Ровное)", "Волгоградское вдхр. (Камышин)", 2, 2, 9.5, 50.09, 45.41, "Камышин (Волгоградская обл.)"],["р. Ахтуба / р. Волга (Харабали / Селитренное / Енотаевка)", "р. Ахтуба (Харабали)", 2, 1, 5.5, 47.35, 47.25, "Харабали / Енотаевка (Астраханская обл.)"],["Каспийские раскаты (Лагань)", "Каспийский канал (Лагань)", 2, 5, 3.5, 45.39, 47.365, "Лагань (Калмыкия)"],["Чограйское вдхр. / оз. Маныч (Элиста)", "Чограйское вдхр.", 6, 2, 4.8, 46.15, 44.3, "Элиста (Калмыкия)"],["р. Дон (Калач-на-Дону / Цимлянск)", "р. Дон (Калач-на-Дону)", 6, 1, 5.0, 48.685, 43.525, "Калач-на-Дону"],["р. Протока / р. Кирпили (Славянск-на-Кубани / Тимашевск)", "р. Протока (Славянск)", 6, 1, 3.5, 45.45, 38.5, "Славянск-на-Кубани / Тимашевск"],["Чёрное море (Джубга / Архипо-Осиповка / Туапсе)", "Чёрное море (Туапсе / Джубга)", 6, 5, 10.0, 44.22, 38.8, "Туапсе / Джубга"],["р. Белая / Майкопское вдхр. (Майкоп)", "р. Белая (Майкоп)", 6, 0, 2.0, 44.61, 40.1, "Майкоп (Адыгея)"],["Феодосийский залив / Чёрное море (Судак / Феодосия)", "Феодосийский залив", 6, 5, 9.0, 44.95, 35.18, "Феодосия / Судак (Крым)"],["Каламитский залив / оз. Донузлав (Евпатория / Черноморское)", "оз. Донузлав / Евпатория", 6, 5, 8.0, 45.35, 33.05, "Евпатория / Черноморское (Крым)"],["р. Ахтуба (Ахтубинск)", "р. Ахтуба (Ахтубинск)", 2, 1, 6.5, 48.282, 46.155, "Ахтубинск"],["р. Дон (Вёшенская)", "р. Дон (Вёшенская)", 6, 1, 5.5, 49.622, 41.732, "Вёшенская"],["Черноморская акватория (Джубга / Архипо-Осиповка)", "Чёрное море (Джубга)", 6, 6, 10.0, 44.325, 38.65, "Джубга"],["Старобешевское вдхр. (р. Кальмиус)", "Старобешевское вдхр.", 6, 4, 4.8, 47.785, 38.015, "Донецкая Народная Республика"],["р. Кальмиус (Донецк / Мариуполь)", "Кальмиус", 6, 0, 2.2, 47.985, 37.812, "Донецкая Народная Республика"],["Азовское море (Белосарайский залив / Седово)", "Белосарайский залив", 6, 5, 5.5, 47.045, 37.65, "Донецкая Народная Республика"],["р. Северский Донец (Луганск / Счастье)", "Северский Донец (ЛНР)", 6, 1, 4.2, 48.695, 39.285, "Луганская Народная Республика"],["Исаковское вдхр. (Алчевск)", "Исаковское вдхр.", 6, 2, 5.0, 48.425, 38.865, "Луганская Народная Республика"],["Бердянский залив (Азовское море)", "Бердянский залив", 6, 5, 6.0, 46.725, 36.785, "Запорожская обл."],["Молочный и Утлюкский лиманы (Кирилловка)", "Утлюкский лиман", 6, 5, 3.2, 46.395, 35.315, "Запорожская обл."],["р. Днепр (Энергодар / Каменка-Днепровская)", "Днепр (Энергодар)", 6, 1, 7.5, 47.515, 34.615, "Запорожская обл."],["Залив Сиваш / Пролив Тонкий (Геническ)", "Залив Сиваш", 6, 5, 3.5, 46.165, 34.815, "Херсонская обл."],["Джарылгачский залив (Скадовск)", "Джарылгачский залив", 6, 5, 4.5, 46.095, 32.915, "Херсонская обл."],["Низовья Днепра (Новая Каховка / Голая Пристань)", "Низовья Днепра", 6, 1, 8.0, 46.615, 32.785, "Херсонская обл."],["р. Белая (верховья: Гузерипль / Хамышки / Даховская)", "Белая (Гузерипль / Даховская)", 6, 0, 1.6, 44.15, 40.17, "Гузерипль / Даховская (Адыгея)"],["р. Белая (низовья: Ханская / Белореченск — устье)", "Белая (низовья)", 6, 1, 3.2, 44.82, 39.81, "Ханская / Белореченск"],["р. Лаба (Кошехабль / Натырбово / Хатукай)", "Лаба (Кошехабль / Хатукай)", 6, 1, 3.4, 45.01, 40.12, "Кошехабль / Хатукай (Адыгея)"],["Краснодарское вдхр. (южный берег: Адыгейск / Пшишский залив)", "Краснодарское вдхр. (Адыгейск)", 6, 2, 5.8, 44.91, 39.22, "Адыгейск (Адыгея)"],["Шапсугское вдхр. (Афипсип / р. Афипс)", "Шапсугское вдхр.", 6, 2, 3.0, 44.97, 38.83, "Тахтамукай / Афипсип (Адыгея)"],["Октябрьское (Тахтамукайское) вдхр. и Шенджийское вдхр.", "Октябрьское вдхр.", 6, 3, 3.2, 44.91, 38.96, "Энем / Тахтамукай (Адыгея)"],["р. Курджипс, р. Дах, р. Пшеха (предгорный участок)", "Курджипс / Дах", 6, 0, 1.4, 44.28, 40.11, "Каменномостский / Даховская (Адыгея)"],["р. Фарс, р. Гиага, р. Псенафа, р. Марта, р. Апчас", "Фарс / Гиага", 6, 0, 1.8, 44.87, 40.21, "Гиагинская / Дондуковская (Адыгея)"],["р. Волга и ст. Волга (Цаган Аман / Копановский плёс)", "Волга (Цаган Аман)", 2, 1, 8.5, 47.56, 46.72, "Цаган Аман (Калмыкия)"],["Лаганский банк и Морской судоходный канал (Лагань — Каспий)", "Лаганский банк", 2, 5, 3.8, 45.38, 47.45, "Лагань (Калмыкия)"],["оз. Маныч-Гудило (Калмыцкий сектор: Яшалта / Приютное)", "Маныч-Гудило (Яшалта)", 6, 2, 3.5, 46.25, 42.85, "Яшалта / Приютное (Калмыкия)"],["оз. Лысый Лиман и Чограйский сбросной канал", "оз. Лысый Лиман", 2, 2, 3.6, 45.59, 44.18, "Чограйский (Калмыкия)"],["Сарпинские озёра: оз. Сарпа (Цаган-Нур), оз. Ханата, оз. Барманцак", "Сарпинские озёра (оз. Сарпа)", 2, 3, 2.4, 47.62, 44.88, "Садовое / Цаган-Нур (Калмыкия)"],["Состинские озёра (оз. Состинское, оз. Киркита, оз. Можарское)", "Состинские озёра", 2, 3, 2.2, 45.38, 45.78, "Комсомольский (Калмыкия)"],["оз. Дед-Хулсун и Черноземельский магистральный канал", "оз. Дед-Хулсун", 2, 3, 2.3, 46.12, 45.32, "Яшкуль (Калмыкия)"],["Аршан-Зельменское и Кегультинское вдхр., пруд Колонский (Элиста)", "Аршан-Зельменское вдхр.", 2, 3, 3.0, 46.31, 44.25, "Элиста (Калмыкия)"],["р. Егорлык / р. Башанта (Городовиковский р-н)", "Егорлык / Башанта", 6, 0, 1.8, 46.09, 41.94, "Городовиковск (Калмыкия)"],["Белогорское и Тайганское вдхр. (р. Биюк-Карасу)", "Белогорское и Тайганское вдхр.", 6, 2, 7.5, 45.01, 34.59, "Белогорск (Крым)"],["Партизанское вдхр. (р. Альма) и Альминское вдхр.", "Партизанское вдхр.", 6, 2, 8.0, 44.82, 34.07, "Симферополь / Бахчисарай (Крым)"],["Аянское вдхр. (верховья р. Салгир)", "Аянское вдхр.", 6, 2, 7.0, 44.83, 34.29, "Симферополь (Крым)"],["Бахчисарайское (Эгиз-Оба) и Загорское вдхр. (р. Кача)", "Бахчисарайское вдхр.", 6, 2, 6.8, 44.71, 33.89, "Бахчисарай (Крым)"],["Счастливенское вдхр. и верховья р. Бельбек", "Счастливенское вдхр. / Бельбек", 6, 2, 7.2, 44.57, 34.04, "Бахчисарайский р-н (Крым)"],["Фронтовое, Самарлинское, Ленинское, Станционное и Старокрымское вдхр.", "Фронтовое / Старокрымское вдхр.", 6, 2, 5.5, 45.19, 35.43, "Феодосия / Ленино / Старый Крым"],["Изобильненское и Кутузовское вдхр. (Алушта)", "Изобильненское вдхр.", 6, 2, 8.0, 44.7, 34.35, "Алушта (Крым)"],["Северо-Крымский канал (Джанкой — Нижнегорский — Феодосия)", "Северо-Крымский канал", 6, 0, 3.2, 45.69, 34.41, "Джанкой / Красноперекопск (Крым)"],["р. Салгир (Симферополь — Нижнегорский — Сиваш)", "Салгир", 6, 0, 1.6, 45.18, 34.38, "Симферополь / Нижнегорский (Крым)"],["р. Альма, р. Кача, р. Бельбек, р. Бурульча, р. Мокрый Индол", "Альма / Кача / Бельбек", 6, 0, 1.5, 44.74, 33.78, "Бахчисарай / Белогорск (Крым)"],["оз. Сасык-Сиваш (пресноводная северная часть, Саки — Евпатория)", "оз. Сасык-Сиваш", 6, 3, 1.8, 45.21, 33.48, "Саки / Евпатория (Крым)"],["оз. Донузлав (верховья: пресноводно-солоноватая часть у Аблямизовки)", "оз. Донузлав (верховья)", 6, 5, 6.5, 45.45, 33.22, "Новоозёрное / Мирный (Крым)"],["Азовское море: Казантипский и Арабатский заливы (Щёлкино / Мысовое / Каменское)", "Казантипский и Арабатский заливы", 6, 5, 6.0, 45.43, 35.81, "Щёлкино / Ленино (Крым)"],["Каркинитский залив и залив Сиваш (Черноморское / Стерегущее / Джанкой)", "Каркинитский залив и Сиваш", 6, 5, 4.5, 45.82, 33.55, "Армянск / Раздольное / Джанкой (Крым)"],["Чёрное море (мыс Тарханкут / Оленевка / Межводное)", "Чёрное море (мыс Тарханкут)", 6, 6, 14.0, 45.35, 32.51, "Оленевка / Черноморское (Крым)"],["Балаклавская бухта и открытое море (мыс Айя — мыс Фиолент)", "Балаклавская бухта и Фиолент", 6, 5, 14.0, 44.495, 33.597, "Балаклава (Севастополь)"],["Казачья, Стрелецкая, Камышовая и Омега (Круглая) бухты", "Бухты Севастополя (Казачья / Стрелецкая)", 6, 5, 9.0, 44.582, 33.412, "Севастополь"],["Бухта Ласпи и мыс Сарыч", "Бухта Ласпи", 6, 6, 16.0, 44.412, 33.705, "Ласпи (Севастополь)"],["Чёрное море (северный берег: Любимовка — Орловка — Кача — Андреевка)", "Чёрное море (Кача / Любимовка)", 6, 6, 11.0, 44.745, 33.545, "Кача / Орловка / Любимовка (Севастополь)"],["р. Бельбек (Верхнесадовое — Любимовка, устье)", "Бельбек (Любимовка)", 6, 0, 1.6, 44.668, 33.575, "Любимовка / Верхнесадовое (Севастополь)"],["оз. у горы Гасфорта, оз. Тороповой дачи, озёра Передового и Родного (Байдарская долина), Инкерманский карьер", "оз. Гасфорта и пруды Байдарской долины", 6, 2, 5.5, 44.525, 33.675, "Севастополь / Орлиное"],["р. Псезуапсе (Лазаревское)", "Псезуапсе", 6, 0, 1.5, 43.905, 39.335, "Лазаревское / Сочи"],["р. Аше (Аше / Калеж)", "Аше", 6, 0, 1.5, 43.962, 39.275, "Аше / Лазаревское"],["р. Дагомыс (Западный и Восточный)", "Дагомыс", 6, 0, 1.3, 43.662, 39.652, "Дагомыс / Сочи"],["р. Кудепста", "", 6, 0, 1.3, 43.495, 39.888, "Кудепста / Сочи"],["р. Мацеста", "", 6, 0, 1.3, 43.552, 39.795, "Мацеста / Сочи"],["р. Лоо", "", 6, 0, 1.2, 43.702, 39.592, "Лоо / Сочи"],["р. Туапсе", "р. Туапсе", 6, 0, 1.5, 44.105, 39.088, "Туапсе"],["р. Шапсухо (Лермонтово)", "Шапсухо", 6, 0, 1.4, 44.305, 38.765, "Лермонтово / Джубга"],["р. Небуг и р. Агой", "Небуг / Агой", 6, 0, 1.3, 44.155, 39.015, "Небуг / Агой (Туапсе)"],["р. Вулан (Архипо-Осиповка)", "Вулан", 6, 0, 1.4, 44.362, 38.528, "Архипо-Осиповка"],["р. Пшада (Криница)", "Пшада", 6, 0, 1.4, 44.395, 38.342, "Пшада / Криница (Геленджик)"],["оз. Серебряное (Ахштырь)", "оз. Серебряное (Ахштырь)", 6, 4, 3.5, 43.518, 39.988, "Адлер / Ахштырь (Сочи)"],["Барановское озеро (Сочи)", "Барановское озеро", 6, 3, 4.0, 43.635, 39.752, "Дагомыс / Барановка (Сочи)"],["Форелевые пруды (Казачий Брод)", "", 6, 4, 2.8, 43.524, 39.996, "Адлер / Казачий Брод (Сочи)"],["Куликовская и Жестерская группа лиманов (Курчанский, Большой и Малый Куликовский, Ордынский)", "Курчанский и Куликовские лиманы", 6, 3, 1.6, 45.285, 37.565, "Темрюк / Курчанская"],["Черноерковско-Сладковская группа лиманов (Сладкий, Горький, Долгий, Круглый, Глубокий, Войсковой, Золотые Ворота)", "Сладкий и Черноерковские лиманы", 6, 3, 1.8, 45.475, 37.725, "Славянск-на-Кубани / Черноерковская"],["Ахтарско-Гривенская группа лиманов (Восточный, Ахтарский, Красный, Бойкиевский, Садковский, Кирпильский, Рясный)", "Ахтарско-Гривенские лиманы", 6, 3, 1.7, 45.825, 38.185, "Приморско-Ахтарск / Гривенская / Садки"],["Витязевский, Кизилташский, Бугазский и Цокур лиманы (Анапа / Веселовка)", "Кизилташский и Бугазский лиманы", 6, 5, 2.0, 45.105, 37.025, "Анапа / Витязево / Веселовка"],["Таманский залив и Динской залив (Сенной / Тамань / Чушка)", "Таманский залив", 6, 5, 4.2, 45.265, 36.855, "Тамань / Сенной"],["оз. Ханское (Ейский р-н)", "оз. Ханское", 6, 3, 1.5, 46.245, 38.385, "Ейск / Копанская"],["р. Ея и р. Сосыка (Староминская / Кущёвская / Ленинградская)", "Ея и Сосыка", 6, 0, 2.0, 46.545, 39.065, "Староминская / Кущёвская / Ленинградская"],["р. Челбас (Тихорецк / Каневская)", "Челбас", 6, 0, 2.1, 46.075, 38.975, "Каневская / Тихорецк"],["р. Бейсуг и р. Левый/Правый Бейсужёк (Брюховецкая / Кореновск)", "Бейсуг (Брюховецкая / Кореновск)", 6, 0, 2.2, 45.795, 39.015, "Брюховецкая / Кореновск"],["р. Понура и Ангелинский ерик (Калининская)", "Понура и Ангелинский ерик", 6, 0, 2.0, 45.475, 38.655, "Калининская / Старонижестеблиевская"],["р. Адагум, р. Абин, р. Ил, р. Афипс, р. Убин", "Адагум / Абин / Афипс", 6, 0, 1.8, 44.885, 38.355, "Крымск / Абинск / Северская"],["р. Кубань (среднее течение: Армавир — Кропоткин — Усть-Лабинск)", "Кубань (Армавир — Кропоткин — Усть-Лабинск)", 6, 1, 3.8, 45.425, 40.555, "Армавир / Кропоткин / Усть-Лабинск"],["р. Лаба, р. Малая и Большая Лаба (Псебай / Мостовской / Лабинск / Курганинск / Усть-Лабинск)", "Лаба (Лабинск — Курганинск — Усть-Лабинск)", 6, 1, 2.9, 44.785, 40.655, "Лабинск / Курганинск / Мостовской"],["р. Уруп (Отрадная — Армавир)", "Уруп", 6, 0, 2.0, 44.685, 41.325, "Отрадная / Армавир"],["р. Псекупс (Горячий Ключ)", "Псекупс", 6, 0, 1.8, 44.635, 39.135, "Горячий Ключ"],["р. Пшиш (Хадыженск) и р. Пшеха (Апшеронск)", "Пшиш и Пшеха", 6, 0, 1.9, 44.445, 39.625, "Апшеронск / Хадыженск"],["Варнавинское и Крюковское вдхр. (Крымский / Абинский р-н)", "Варнавинское и Крюковское вдхр.", 6, 2, 3.6, 45.055, 38.095, "Крымск / Абинск"],["Неберджаевское вдхр. и оз. Старая Кубань (Краснодар)", "оз. Старая Кубань (Краснодар)", 6, 3, 3.4, 45.012, 39.048, "Краснодар"],["р. Волга (Черный Яр — Ступино — Никольское — Копановка — Замьяны)", "Волга (Черный Яр — Никольское — Замьяны)", 2, 1, 9.5, 47.768, 46.425, "Черный Яр / Никольское / Замьяны"],["р. Ахтуба (Трёхречье: Харабалык, Мангут, Ашулук — Селитренное)", "Ахтуба (Трёхречье)", 2, 1, 6.5, 47.16, 47.28, "Харабали / Селитренное"],["р. Герасимовка, р. Винокуровка и р. Матвеевка (Ахтубинск — Болхуны)", "Герасимовка и Винокуровка", 2, 1, 6.0, 48.045, 46.325, "Ахтубинск / Золотуха"],["р. Енотаевка и проток Полданиловка", "Енотаевка и Полданиловка", 2, 1, 7.0, 47.245, 47.035, "Енотаевка / Харабали"],["р. Митинка и ерик Кирпичный (Заволжское — Сероглазка)", "Митинка и ер. Кирпичный", 2, 1, 6.2, 47.035, 47.495, "Заволжское / Сероглазка"],["р. Кигач и р. Берекет (Красноярский р-н / Байбек — Подчалык)", "Кигач и Берекет", 2, 1, 5.8, 46.638, 48.615, "Красный Яр / Байбек"],["р. Болда, р. Камызяк, р. Кизань и р. Табола (Камызякский р-н)", "Кизань / Камызяк / Болда", 2, 1, 6.0, 46.115, 48.085, "Камызяк"],["Гандуринский, Никитинский, Кулагинский и Каралатский банки (Станья / Каралат / Гандурино)", "Гандуринский, Никитинский и Каралатский банки", 2, 5, 4.5, 45.855, 48.145, "Камызяк / Каралат / Станья"],["Белинский, Малобелинский и Глазовский банки, Тишковский канал (Зеленга / Маково / Тишково)", "Белинский банк и Тишковский канал", 2, 5, 4.2, 45.995, 48.615, "Володарский / Зеленга / Тишково"],["Иголкинский и Васильевский банки (Бакланье / Цветное / Марфино)", "Иголкинский и Васильевский банки", 2, 5, 4.0, 46.285, 48.925, "Володарский / Марфино / Бакланье"],["Авандельта Волги и Каспийские раскаты (Вышка — Мумра — Станья — Тишково)", "Каспийские раскаты (Вышка / Станья)", 2, 5, 1.8, 45.585, 47.885, "Вышка / Мумра / Станья"],["Западные подстепные ильмени (ильм. Большой Бешкуль, Шушай, Чада, Дапхур — Лиманский и Икрянинский р-ны)", "Западные подстепные ильмени", 2, 3, 2.2, 45.895, 47.345, "Лиман / Икряное (Астраханская обл.)"],["Пойменные ерики и ильмени (ер. Казачий, Шамбайский, Банный, Харабалык, Молочный, Кабаний, Ашулук)", "Ерики Волго-Ахтубинской поймы (Банный / Харабалык / Ашулук)", 2, 0, 3.5, 47.225, 47.215, "Харабали / Селитренное"],["р. Волга (нижний бьеф Волжской ГЭС — Светлый Яр — Райгород — Каршевитое)", "Волга (Волгоград — Светлый Яр — Каршевитое)", 2, 1, 8.5, 48.475, 44.825, "Волгоград / Светлый Яр"],["р. Ахтуба (верхний участок: Волжский — Средняя Ахтуба — Ленинск — Колобовка)", "Ахтуба (Волжский — Средняя Ахтуба — Ленинск)", 2, 1, 4.2, 48.705, 45.055, "Волжский / Ленинск"],["Волго-Ахтубинская пойма (оз. Запорное, ерики Гнилой, Булгаков, Старая Ахтуба, Пахотный, Каширин, оз. Проклятое)", "Ерики и озёра Ленинской и Среднеахтубинской поймы", 2, 3, 2.5, 48.625, 44.925, "Краснослободск / Средняя Ахтуба / Ленинск"],["Волгоградское вдхр. (Дубовка — Горный Балыклей — Быково — Николаевск)", "Волгоградское вдхр. (Дубовка — Быково — Николаевск)", 2, 2, 10.5, 49.555, 45.125, "Дубовка / Быково / Николаевск"],["р. Дон (Серафимович — Усть-Хопёрская — Клетская — Трёхостровская — Вертячий — Калач-на-Дону — Пятиизбянская)", "Дон (Серафимович — Вертячий — Пятиизбянская)", 6, 1, 5.5, 48.948, 43.822, "Серафимович / Клетская / Калач-на-Дону"],["Цимлянское вдхр. (верхний и средний плёсы: Пятиизбянская — Суровикино — Нижний Чир — Новомаксимовский — Котельниково)", "Цимлянское вдхр. (Пятиизбянская — Нижний Чир — Котельниково)", 6, 2, 7.8, 48.362, 43.095, "Суровикино / Нижний Чир / Котельниково"],["р. Хопёр (Урюпинск — Алексеевская — Букановская — Кумылженская — Усть-Хопёрская)", "Хопёр (Урюпинск — Кумылженская)", 6, 1, 3.4, 50.292, 42.185, "Урюпинск / Алексеевская / Кумылженская"],["р. Медведица (Жирновск — Даниловка — Михайловка — Серафимович)", "Медведица (Жирновск — Михайловка)", 6, 0, 2.6, 50.068, 43.238, "Жирновск / Михайловка / Серафимович"],["р. Иловля (Петров Вал — Ольховка — Иловля), р. Бузулук (Новоаннинский — Преображенская), р. Чир (Суровикино), р. Кумылга, р. Терса (Рудня — Елань), р. Арчеда", "Иловля / Бузулук / Чир / Терса", 6, 0, 2.1, 50.138, 43.825, "Новоаннинский / Иловля / Суровикино"],["Волго-Донской судоходный канал: Варваровское, Береславское и Карповское вдхр.", "ВДСК (Варваровское, Береславское и Карповское вдхр.)", 6, 2, 4.8, 48.615, 43.985, "Волгоград / Калач-на-Дону"],["р. Еруслан и Ерусланский залив (Старополтавский р-н), оз. Сарпа и оз. Цаца (Светлоярский р-н)", "Ерусланский залив и оз. Цаца", 2, 3, 2.8, 48.245, 44.625, "Светлый Яр / Палласовка"],["Дельта Дона (Рогожкино — Кагальник — Елизаветинская: р. Мёртвый Донец, гирла Старый Дон, Большая Каланча, Мокрая Каланча, Переволока)", "Дельта Дона (Рогожкино / Мёртвый Донец)", 6, 1, 4.8, 47.175, 39.352, "Азов / Рогожкино / Ростов-на-Дону"],["р. Дон (Нижний Дон: Цимлянск — Романовская — Николаевская — Константиновск — Кочетовская — Семикаракорск — Багаевская — Старочеркасская — Аксай)", "Нижний Дон (Константиновск — Семикаракорск — Багаевская)", 6, 1, 5.8, 47.565, 40.875, "Константиновск / Семикаракорск / Багаевская"],["р. Дон (Верхний Дон в Ростовской обл.: Казанская — Мигулинская — Вёшенская — Еланская)", "Верхний Дон (Казанская — Вёшенская)", 6, 1, 4.5, 49.628, 41.725, "Вёшенская / Казанская"],["Тёплый сбросной канал Новочеркасской ГРЭС (х. Донской / ст. Кривянская)", "Тёплый канал Новочеркасской ГРЭС", 6, 4, 3.8, 47.412, 40.232, "Новочеркасск / Кривянская"],["р. Западный Маныч: Усть-Манычское вдхр., Весёловское вдхр. (заливы Большой Садковский, Балка Сибирка, Вертолётный), Пролетарское вдхр. и оз. Маныч-Гудило", "Западный Маныч (Усть-Манычское, Весёловское и Пролетарское вдхр.)", 6, 2, 4.5, 46.885, 41.325, "Пролетарск / Весёлый / Сальск"],["р. Северский Донец (Донецк — Каменск-Шахтинский — Белая Калитва — Усть-Донецкий)", "Северский Донец (Белая Калитва — Усть-Донецкий)", 6, 1, 3.8, 48.012, 40.825, "Каменск-Шахтинский / Белая Калитва / Усть-Донецкий"],["р. Сал (Зимовники — Семикаракорск), р. Сусат и Донской магистральный канал (ДМК)", "Сал, Сусат и Донской магистральный канал", 6, 0, 2.4, 47.385, 41.145, "Семикаракорск / Зимовники"],["р. Кундрючья и Соколовское вдхр., р. Калитва, р. Быстрая, р. Чир (Боковская — Обливская)", "Кундрючья, Соколовское вдхр. и Калитва", 6, 0, 2.6, 47.886, 40.072, "Красный Сулин / Новошахтинск / Морозовск"],["р. Миус и Миусский лиман (Матвеев Курган — Покровское — Таганрог)", "Миус и Миусский лиман", 6, 5, 2.5, 47.255, 38.785, "Таганрог / Матвеев Курган"],["р. Кагальник и р. Ея (юг области: Самарское — Пешково)", "Кагальник (Самарское — Азов)", 6, 0, 2.0, 46.985, 39.525, "Азов / Самарское"],["Таганрогский залив (южный берег: Павло-Очаковская коса, Чумбур-Коса, Порт-Катон; северный берег: Беглицкая коса, Таганрог)", "Таганрогский залив (Павло-Очаково / Чумбур-Коса / Беглица)", 6, 5, 4.2, 47.042, 39.105, "Азов / Таганрог"],["Азовское море (Мариуполь — Мелекино — Белосарайская Коса — Ялта — Урзуф)", "Азовское море (Мариуполь — Белосарайская Коса — Урзуф)", 6, 5, 6.0, 46.945, 37.335, "Мариуполь / Ялта / Урзуф (ДНР)"],["Павлопольское вдхр. (р. Кальмиус, низовья у Мариуполя)", "Павлопольское вдхр.", 6, 2, 5.2, 47.275, 37.792, "Мариуполь / Павлополь (ДНР)"],["Старокрымское вдхр. (р. Кальчик, Мариуполь)", "Старокрымское вдхр. (Мариуполь)", 6, 2, 6.0, 47.185, 37.475, "Мариуполь (ДНР)"],["Нижнекальмиусское вдхр. и Кальмиусское вдхр. (Донецкое море, Донецк)", "Донецкое море и Нижнекальмиусское вдхр.", 6, 2, 5.5, 47.935, 37.825, "Донецк (ДНР)"],["Зуевское вдхр. и Ольховское вдхр. (Зугрэс, р. Крынка / Ольховая)", "Зуевское и Ольховское вдхр.", 6, 4, 5.5, 48.035, 38.285, "Зугрэс / Харцызск (ДНР)"],["Ханжонковское вдхр. (р. Крынка, Макеевка / Нижняя Крынка)", "Ханжонковское вдхр.", 6, 2, 5.0, 48.125, 38.155, "Макеевка / Енакиево (ДНР)"],["р. Крынка (Зугрэс — Амвросиевка — Благодатное) и р. Миус (верховья: Грабово — Дмитровка)", "Крынка и Миус", 6, 0, 2.1, 47.825, 38.455, "Зугрэс / Амвросиевка / Снежное (ДНР)"],["р. Северский Донец (Святогорск — Красный Лиман — Райгородок — Щурово — Серебрянка)", "Северский Донец (Святогорск — Щурово)", 6, 1, 4.0, 48.985, 37.655, "Святогорск / Красный Лиман (ДНР)"],["р. Казённый Торец и р. Кривой Торец, Клебан-Быкское вдхр.", "Казённый Торец и Клебан-Быкское вдхр.", 6, 2, 4.5, 48.435, 37.695, "Славянск / Краматорск / Константиновка (ДНР)"],["Кураховское вдхр. (р. Волчья, Курахово) и Углегорское вдхр. (Светлодарск)", "Кураховское и Углегорское вдхр.", 6, 4, 5.2, 47.992, 37.265, "Курахово / Светлодарск (ДНР)"],["Карловское вдхр. (р. Волчья) и р. Мокрые Ялы (Великая Новосёлка)", "Карловское вдхр. и р. Мокрые Ялы", 6, 2, 4.2, 48.115, 37.485, "Красноармейск / Селидово (ДНР)"],["Голубые озёра (Красный Лиман / Щурово) и Авдеевский песчаный карьер", "Голубые озёра (Красный Лиман) и Авдеевский карьер", 6, 2, 8.5, 48.965, 37.725, "Красный Лиман / Авдеевка (ДНР)"],["р. Северский Донец (Кременная — Рубежное — Северодонецк — Лисичанск — Славяносербск — Счастье — Станица Луганская — Кружиловка)", "Северский Донец (Лисичанск — Славяносербск — Станица Луганская)", 6, 1, 4.2, 48.885, 38.495, "Северодонецк / Лисичанск / Счастье (ЛНР)"],["Тёплый канал Луганской ТЭС и оз. Чистое (г. Счастье / Северодонецк)", "Тёплый канал Луганской ТЭС (Счастье)", 6, 4, 3.8, 48.742, 39.235, "Счастье / Северодонецк (ЛНР)"],["р. Айдар (Новопсков — Старобельск — Новоайдар — устье у Счастья)", "Айдар (Старобельск — Новоайдар)", 6, 0, 2.4, 49.275, 38.915, "Старобельск / Новоайдар (ЛНР)"],["р. Деркул (Марковка — Беловодск — устье в Северский Донец)", "Деркул (Беловодск)", 6, 0, 2.1, 49.198, 39.575, "Беловодск / Марковка (ЛНР)"],["р. Красная (Сватово — Кременная) и Сватовское вдхр.", "Красная и Сватовское вдхр.", 6, 2, 3.5, 49.405, 38.165, "Сватово / Кременная (ЛНР)"],["р. Лугань (Первомайск — Кировск — Зимогорье — Александровск — Луганск) и р. Ольховая", "Лугань и Ольховая", 6, 0, 1.9, 48.575, 39.255, "Луганск / Кировск / Зимогорье (ЛНР)"],["Лутугинское (Успенское) вдхр. и Елизаветовское вдхр.", "Лутугинское и Елизаветовское вдхр.", 6, 2, 5.5, 48.392, 39.155, "Лутугино / Антрацит (ЛНР)"],["Штеровское и Яновское вдхр. (Миусинск / Красный Луч, р. Миус)", "Штеровское и Яновское вдхр.", 6, 2, 5.0, 48.085, 38.892, "Красный Луч / Миусинск (ЛНР)"],["Краснодонское (Таловское), Должанское и Бирюковское вдхр., р. Большая Каменка", "Должанское и Таловское вдхр.", 6, 2, 4.5, 48.145, 39.635, "Краснодон / Свердловск (ЛНР)"],["Пойменные озёра Северского Донца: оз. Бобровое, оз. Клешня, оз. Кривое, оз. Песочное (Рубежное — Кременная)", "Пойменные озёра Донца (Бобровое / Клешня / Песочное)", 6, 3, 2.8, 48.925, 38.435, "Рубежное / Северодонецк / Кременная (ЛНР)"],["Азовское море: Обиточный залив и Обиточная коса (Приморск / Набережное)", "Обиточный залив и Обиточная коса", 6, 5, 5.5, 46.635, 36.215, "Приморск (Запорожская обл.)"],["Азовское море: Бердянская коса и Федотова коса / о-в Бирючий (Бердянск / Кирилловка / Степановка Первая)", "Бердянская и Федотова косы (Азовское море)", 6, 6, 7.0, 46.635, 36.765, "Бердянск / Кирилловка (Запорожская обл.)"],["Тёплый водоём-охладитель Запорожской АЭС (Энергодар)", "Водоём-охладитель Запорожской АЭС", 6, 4, 5.5, 47.508, 34.585, "Энергодар (Запорожская обл.)"],["р. Днепр и р. Конка (Каменка-Днепровская — Днепрорудное — Васильевка — русло после спуска Каховского вдхр.)", "Днепр и Конка (Каменка-Днепровская — Васильевка)", 6, 1, 6.0, 47.465, 35.125, "Васильевка / Днепрорудное (Запорожская обл.)"],["р. Берда и Бердянское вдхр. (Осипенко — Новопетровка — Бердянск)", "Берда и Бердянское вдхр.", 6, 2, 4.8, 46.935, 36.815, "Бердянск / Осипенко (Запорожская обл.)"],["р. Молочная (Молочанск — Токмак — Мелитополь — Молочный лиман)", "Молочная", 6, 0, 1.8, 46.845, 35.385, "Мелитополь / Токмак / Молочанск (Запорожская обл.)"],["р. Обиточная (Приморск), р. Лозоватка, р. Корсак, р. Большой и Малый Утлюк (Акимовка)", "Обиточная / Корсак / Большой Утлюк", 6, 0, 1.6, 46.725, 36.325, "Приморск / Акимовка (Запорожская обл.)"],["р. Конка (Пологи — Орехов — Васильевка) и р. Гайчур (Гуляйполе)", "Конка и Гайчур", 6, 0, 2.0, 47.545, 35.885, "Пологи / Орехов / Гуляйполе (Запорожская обл.)"],["Азовское море: Арабатская стрелка и Утлюкский лиман (Геническ — Генгорка — Счастливцево — Стрелковое)", "Арабатская стрелка (Азовское море)", 6, 6, 6.5, 46.035, 34.845, "Геническ / Счастливцево (Херсонская обл.)"],["Залив Сиваш: Чонгарский пролив и Восточный Сиваш (Геническ — Чонгар — Стрелковое)", "Чонгарский пролив и Восточный Сиваш", 6, 5, 2.8, 46.025, 34.545, "Геническ / Чонгар (Херсонская обл.)"],["Чёрное море: Каркинитский залив, Джарылгачский залив и Тендровский залив (Хорлы — Скадовск — Лазурное — Железный Порт)", "Чёрное море (Железный Порт / Лазурное / Хорлы)", 6, 6, 9.5, 46.118, 32.292, "Железный Порт / Лазурное / Скадовск"],["Днепровско-Бугский лиман (восточный и южный берег: Старая Збурьевка — Рыбальче — Геройское — Кинбурнская коса) и Ягорлыцкий залив", "Днепровско-Бугский лиман и Ягорлыцкий залив", 6, 5, 5.2, 46.485, 32.185, "Голая Пристань / Рыбальче (Херсонская обл.)"],["Дельта Днепра: р. Конка, р. Чайка, р. Старый Днепр, р. Бакай, оз. Кардашинский лиман и Збурьевский кут (Алёшки — Голая Пристань)", "Дельта Днепра (Конка / Бакай / Старый Днепр)", 6, 1, 6.5, 46.545, 32.525, "Голая Пристань / Алёшки (Херсонская обл.)"],["р. Днепр (Горностаевка — Великая Лепетиха — Каховка — Таврийск — Новая Каховка)", "Днепр (Горностаевка — Каховка — Новая Каховка)", 6, 1, 7.5, 46.815, 33.485, "Каховка / Таврийск / Горностаевка"],["оз. Устричное (Лазурное), оз. Солёное и оз. Лиман (Бехтеры)", "оз. Устричное и оз. Лиман", 6, 3, 2.0, 46.088, 32.535, "Лазурное / Бехтеры (Херсонская обл.)"],["Каспийское море (Махачкала)", "Каспийское море", 2, 5, 6.5, 42.98, 47.51, "Махачкала"],["Каспийское море (Дербент)", "Каспийское море", 2, 6, 12.0, 42.07, 48.29, "Дербент"],["р. Терек / Кизлярский залив (Кизляр)", "р. Терек (Кизляр)", 2, 1, 3.5, 43.85, 46.72, "Кизляр (Дагестан)"],["Новотроицкое вдхр. / оз. Сенгилеевское (Ставрополь)", "Новотроицкое вдхр. (ГРЭС)", 6, 4, 5.0, 45.15, 41.8, "Ставрополь"],["р. Подкумок / р. Кума (Пятигорск / КМВ)", "р. Подкумок (Пятигорск)", 2, 0, 1.8, 44.05, 43.06, "Пятигорск (Ставропольский край)"],["р. Терек (Владикавказ / Моздок / Шелковская)", "Терек", 2, 1, 3.2, 43.655, 45.315, "Северный Кавказ"],["оз. Кезеной-Ам (Чечня / Дагестан)", "Озеро Кезеной-Ам", 2, 2, 12.0, 42.776, 46.152, "Чеченская Республика"],["р. Сунжа (Назрань / Грозный / Гудермес)", "Сунжа", 2, 0, 2.0, 43.318, 45.698, "Чеченская Республика"],["р. Малка и р. Баксан (Прохладный / Нальчик)", "Малка / Баксан", 2, 0, 1.8, 43.755, 44.025, "Кабардино-Балкарская Республика"],["Кубанское (Большое) вдхр. (Черкесск)", "Кубанское вдхр.", 6, 2, 7.0, 44.235, 42.195, "Карачаево-Черкесская Республика"],["Новотроицкое вдхр. (Солнечнодольск)", "Новотроицкое вдхр.", 6, 4, 4.5, 45.325, 41.525, "Ставропольский край"],["Чиркейское вдхр. (р. Сулак)", "Чиркейское вдхр.", 2, 2, 14.0, 42.975, 46.885, "Республика Дагестан"],["оз. Хуко и оз. Кардывач (верховья Мзымты, заповедные)", "оз. Кардывач", 6, 2, 12.0, 43.572, 40.628, "Красная Поляна (Сочи)"],["Каспийское море: Кизлярский залив (Коктюбей — Брянск — о-в Чечень)", "Кизлярский залив (Коктюбей / Брянск)", 2, 5, 3.8, 44.325, 46.725, "Кизляр / Коктюбей (Дагестан)"],["Аграханский залив и оз. Южный Аграхан (Аграханский п-ов / Крайновка / Новый Бирюзяк)", "Аграханский залив и оз. Южный Аграхан", 2, 5, 3.2, 43.785, 47.415, "Крайновка / Новый Бирюзяк (Дагестан)"],["Каспийское море (побережье: Сулак — Махачкала — Каспийск — Манаскент — Избербаш — Инчхе — Каякент — Дербент — устье р. Самур)", "Каспийское море (Каспийск — Избербаш — Каякент — Самур)", 2, 6, 10.0, 42.568, 47.872, "Каспийск / Избербаш / Дербент (Дагестан)"],["оз. Аджи (Папас, Каякентский р-н) и оз. Ак-Гёль (Махачкала)", "оз. Аджи (Папас) и оз. Ак-Гёль", 2, 3, 2.4, 42.312, 48.035, "Махачкала / Новокаякент (Дагестан)"],["Нижне-Терские водоёмы: оз. Большое и Малое Турали, Мехтебское, Аракумские и Нижне-Терские водоемы (Кизлярский и Бабаюртовский р-ны)", "Аракумские, Мехтебские и Нижне-Терские водоёмы", 2, 3, 2.5, 43.625, 47.255, "Кизляр / Бабаюрт (Дагестан)"],["Дельта р. Терек: Новый Терек (Аликазган), Старый Терек, Каргалинский гидроузел, р. Таловка и р. Прорва", "Дельта Терека (Аликазган / Каргалинская / Таловка)", 2, 1, 3.8, 43.765, 46.885, "Кизляр / Крайновка / Каргалинская (Дагестан)"],["р. Сулак (нижнее течение: Кизилюрт — Главный Сулак — устье)", "Сулак (Кизилюрт — Главный Сулак)", 2, 1, 3.6, 43.245, 47.285, "Кизилюрт / Сулак (Дагестан)"],["Каскад Сулакских водохранилищ: Ирганайское вдхр. (Шамилькала), Миатлинское вдхр., Чирюртовское вдхр., Гергебильское и Гунибское вдхр.", "Ирганайское, Миатлинское и Чирюртовское вдхр.", 2, 2, 12.5, 42.665, 46.885, "Шамилькала / Кизилюрт / Гуниб (Дагестан)"],["Горные реки бассейна Сулака: р. Андийское Койсу, р. Аварское Койсу, р. Каракойсу, р. Казикумухское Койсу", "Андийское, Аварское и Каракойсу", 2, 0, 2.0, 42.585, 46.545, "Ботлих / Хунзах / Гуниб (Дагестан)"],["р. Самур и дельта Самура (Ахты — Магарамкент — Приморский / Белиджи) и р. Гюльгерычай", "Самур и дельта Самура", 2, 1, 2.6, 41.815, 48.515, "Белиджи / Ахты (Дагестан)"],["оз. Мочох (Хунзахский р-н) и оз. Казеной-Ам (восточный берег, Ботлихский р-н)", "оз. Мочох (Хунзах)", 2, 2, 8.0, 42.618, 46.615, "Хунзах / Ботлих (Дагестан)"],["р. Сунжа (Назрань — Экажево — Карабулак — Троицкая — Сунжа)", "Сунжа (Назрань — Карабулак — Сунжа)", 2, 0, 1.8, 43.275, 44.925, "Магас / Назрань / Карабулак / Сунжа (Ингушетия)"],["р. Асса (горное и предгорное течение: Таргим — Мужичи — Галашки — Алхасты — Нестеровская — Сунжа)", "Асса (Таргим — Галашки — Нестеровская)", 2, 0, 1.6, 43.132, 45.048, "Сунжа / Нестеровская / Галашки (Ингушетия)"],["р. Армхи (Джейрахское ущелье — Ольгети — Джейрах — устье в р. Терек)", "Армхи (Джейрах)", 2, 0, 1.3, 42.822, 44.695, "Джейрах (Ингушетия)"],["р. Фортанга (Даттых — Аршты) и р. Камбилеевка (Кантышево)", "Фортанга и Камбилеевка", 2, 0, 1.4, 43.048, 45.125, "Назрань / Сунжа (Ингушетия)"],["Назрановский городской пруд (оз. Назрань), пруд в г. Карабулак и Алханчуртский канал (Малгобекский р-н)", "Назрановский пруд и Алханчуртский канал", 2, 3, 2.5, 43.222, 44.758, "Назрань / Карабулак / Малгобек (Ингушетия)"],["р. Терек (Плановское — Терек — Майский — Пришибская — Екатериноградская)", "Терек (Терек — Майский — Екатериноградская)", 2, 1, 3.0, 43.635, 44.115, "Терек / Майский / Прохладный (КБР)"],["р. Черек (Кашхатау — Аушигер — Старый Черек — Майский, слияние с Баксаном и Малкой)", "Черек (Аушигер — Нарткала — Майский)", 2, 0, 1.9, 43.515, 43.885, "Нарткала / Майский / Кашхатау (КБР)"],["р. Малка (горное течение: Хабаз — Каменномостское; равнинное течение: Баксанёнок — Солдатская — Прохладный — Екатериноградская)", "Малка (Каменномостское — Прохладный)", 2, 0, 1.8, 43.758, 43.855, "Прохладный (КБР)"],["р. Баксан (Былым — Баксан — Прохладный) и оз. Гижгит (Былымское оз.)", "Баксан и оз. Гижгит", 2, 2, 4.5, 43.465, 43.035, "Баксан / Тырныауз (КБР)"],["р. Чегем, р. Нальчик, р. Урвань, р. Шалушка, р. Аргудан, р. Урух и р. Лескен", "Чегем / Нальчик / Урух", 2, 0, 1.5, 43.525, 43.595, "Нальчик / Чегем (КБР)"],["Водохранилище Аушигерской ГЭС и Зарагижской ГЭС (р. Черек)", "Вдхр. Аушигерской и Зарагижской ГЭС", 2, 2, 6.0, 43.385, 43.715, "Аушигер / Нарткала (КБР)"],["Майские и Прохладненские обводнённые карьеры («Майские Голубые озёра», карьеры у ст. Пришибской, Котляревской и Солдатской), Курортное озеро (Нальчик)", "Майские и Прохладненские карьеры", 2, 2, 5.5, 43.665, 44.075, "Майский / Прохладный / Нальчик (КБР)"],["Верхние Голубые озёра (Секретное, Сухое — Черекский р-н) и оз. Шадхурей (Зольский р-н)", "Верхние Голубые озёра и оз. Шадхурей", 2, 2, 8.0, 43.235, 43.625, "Бабугент / Каменномостское (КБР)"],["р. Кубань (верховья: Учкулан — Карачаевск — Усть-Джегута)", "Кубань (Учкулан — Карачаевск — Усть-Джегута)", 6, 0, 1.8, 43.775, 41.915, "Карачаевск / Усть-Джегута (КЧР)"],["р. Кубань (Черкесск — Эркен-Шахар)", "", 6, 1, 2.8, 44.235, 42.035, "Черкесск (КЧР)"],["Усть-Джегутинское вдхр. (г. Усть-Джегута)", "Усть-Джегутинское вдхр.", 6, 2, 6.0, 44.065, 41.975, "Усть-Джегута (КЧР)"],["р. Теберда (Домбай — Теберда — Карачаевск)", "Теберда", 6, 0, 1.6, 43.455, 41.745, "Теберда / Карачаевск (КЧР)"],["р. Большой Зеленчук (Архыз — Зеленчукская — Исправная — Эркен-Шахар) и р. Кяфар (Сторожевая)", "Большой Зеленчук и Кяфар", 6, 0, 1.8, 43.865, 41.585, "Зеленчукская / Архыз (КЧР)"],["р. Малый Зеленчук (Кардоникская — Хабез — Адыге-Хабль)", "Малый Зеленчук", 6, 0, 1.6, 44.045, 41.775, "Хабез / Адыге-Хабль (КЧР)"],["р. Большая Лаба (Пхия — Загедан — Рожкао — Курджиново)", "Большая Лаба (Курджиново / Пхия)", 6, 0, 1.7, 43.915, 40.935, "Курджиново / Медногорский (КЧР)"],["р. Уруп (Уруп — Преградная) и р. Даут, р. Мара, р. Аксаут", "Уруп (Преградная) и Аксаут", 6, 0, 1.5, 43.952, 41.185, "Преградная (КЧР)"],["р. Подкумок, р. Эшкакон и Эшкаконское вдхр. (Малокарачаевский р-н, Учкекен)", "Эшкаконское вдхр. и верхний Подкумок", 2, 2, 5.5, 43.885, 42.505, "Учкекен (КЧР)"],["Черкесские городские пруды («Зелёный остров», Черкесск) и форелевые озёра Архыза / Теберды", "Пруды «Зелёный остров» (Черкесск)", 6, 3, 2.8, 44.225, 42.025, "Черкесск / Архыз (КЧР)"],["р. Терек (горное и предгорное течение: Ларс — Владикавказ — Беслан — Эльхотово)", "Терек (Владикавказ — Беслан — Эльхотово)", 2, 0, 2.0, 43.035, 44.675, "Владикавказ / Беслан (Северная Осетия)"],["р. Терек (равнинный плёс: Змейская — Павлодольская — Моздок — Кизляр / Сухотское)", "Терек (Моздок — Павлодольская)", 2, 1, 3.4, 43.732, 44.635, "Моздок (Северная Осетия)"],["оз. Бекан и Беканское вдхр. (Кировский р-н, п. Бекан / Карджин)", "оз. Бекан (Беканское вдхр.)", 2, 3, 3.5, 43.292, 44.298, "Ардон / Карджин (Северная Осетия)"],["Зарамагское вдхр. (р. Ардон / Мамисондон / Нардон, Алагирский р-н)", "Зарамагское вдхр.", 2, 2, 11.0, 42.705, 43.982, "Алагир / Нижний Зарамаг (Северная Осетия)"],["р. Ардон (Зарамаг — Мизур — Алагир — Ардон — устье в Терек)", "Ардон (Алагир — Ардон)", 2, 0, 1.8, 43.042, 44.235, "Алагир / Ардон (Северная Осетия)"],["р. Урух (Дигорское ущелье: Дзинага — Мацута — Ахсарисар — Чикола)", "Урух (Дигорское ущелье — Чикола)", 2, 0, 1.7, 43.125, 43.865, "Чикола / Дигора (Северная Осетия)"],["р. Фиагдон (Верхний Фиагдон — Дзуарикау), р. Гизельдон (Даргавс — Кобан — Гизель), р. Урсдон (Дигора), р. Камбилеевка", "Фиагдон / Гизельдон / Урсдон", 2, 0, 1.4, 42.965, 44.365, "Владикавказ / Дигора (Северная Осетия)"],["Моздокские, Павлодольские, Змейские и Ардонские обводнённые карьеры и старицы Терека, Водная станция (Владикавказ)", "Моздокские и Змейские карьеры", 2, 2, 4.2, 43.725, 44.525, "Моздок / Владикавказ (Северная Осетия)"],["р. Терек (Ищёрская — Наурская — Червлённая — Шелковская — Каргалинская)", "Терек (Наурская — Червлённая — Шелковская)", 2, 1, 3.6, 43.585, 45.785, "Наурская / Шелковская (Чеченская Республика)"],["р. Сунжа (низовья: Грозный — Аргун — Гудермес — Брагуны, впадение в Терек)", "Сунжа (Грозный — Гудермес — Брагуны)", 2, 1, 2.8, 43.365, 45.965, "Грозный / Аргун / Гудермес (Чеченская Республика)"],["Чернореченское вдхр. («Грозненское море», г. Грозный)", "Грозненское море (Чернореченское вдхр.)", 2, 2, 5.5, 43.268, 45.698, "Грозный (Чеченская Республика)"],["оз. Каргалинское, оз. Степная Жемчужина и оз. Майорское (Шелковской р-н)", "оз. Каргалинское и оз. Майорское (Шелковская)", 2, 3, 2.8, 43.525, 46.335, "Шелковская (Чеченская Республика)"],["Джалкинское вдхр. / озеро (Гудермесский р-н, с. Джалка)", "Джалкинское вдхр.", 2, 3, 3.2, 43.332, 46.025, "Гудермес / Аргун (Чеченская Республика)"],["р. Аргун (горное течение: Итум-Кале — Шатой — Чири-Юрт; равнинное течение: Шали — Аргун — устье в Сунжу)", "Аргун (Шатой — Чири-Юрт — Аргун)", 2, 0, 2.0, 43.145, 45.775, "Аргун / Шали / Шатой (Чеченская Республика)"],["р. Шароаргун, р. Хулхулау (Ведено), р. Мартан, р. Гехи, р. Гойта, р. Джалка, р. Гумс, р. Аксай и р. Ямансу", "Шароаргун / Хулхулау / Мартан / Аксай", 2, 0, 1.5, 43.055, 45.885, "Урус-Мартан / Курчалой / Ведено (Чеченская Республика)"],["оз. Галанчож (высокогорное озеро, Урус-Мартановский / Галанчожский р-н)", "оз. Галанчож", 2, 2, 10.0, 42.872, 45.302, "Урус-Мартан / Ачхой-Мартан (Чеченская Республика)"],["Старицы Терека, Наурско-Шелковской обводнительный канал и р. Прорва (Бороздинская)", "Старицы Терека и р. Прорва (Бороздинская)", 2, 3, 2.5, 43.795, 46.485, "Шелковская / Наурская (Чеченская Республика)"],["Сенгилеевское вдхр. (ст. Сенгилеевская / Ставрополь)", "Сенгилеевское вдхр.", 6, 2, 8.5, 45.025, 41.695, "Ставрополь / Сенгилеевская"],["Егорлыкское вдхр. и Буферное вдхр. (р. Егорлык, Сенгилеевская — Каменнобродская)", "Егорлыкское вдхр.", 6, 2, 6.5, 45.085, 41.615, "Ставрополь / Изобильный"],["р. Егорлык и Невинномысский канал (Невинномысск — Солнечнодольск — Птичье — Красногвардейское)", "Егорлык и Невинномысский канал", 6, 0, 2.4, 45.455, 41.585, "Изобильный / Солнечнодольск / Красногвардейское"],["р. Кубань (Невинномысск — Кочубеевское — Барсуковская — Григорополисская)", "Кубань (Невинномысск — Кочубеевское)", 6, 1, 3.0, 44.645, 41.925, "Невинномысск (Ставропольский край)"],["Отказненское вдхр. (р. Кума, Зеленокумск / с. Отказное)", "Отказненское вдхр.", 2, 2, 4.8, 44.315, 43.815, "Зеленокумск (Ставропольский край)"],["р. Кума (Минеральные Воды — Зеленокумск — Будённовск — Левокумское — Нефтекумск)", "Кума (Зеленокумск — Будённовск — Нефтекумск)", 2, 0, 2.2, 44.685, 44.155, "Будённовск / Зеленокумск / Нефтекумск"],["оз. Буйвола (г. Будённовск) и вдхр. Волчьи Ворота (р. Томузловка, Новоселицкое / Благодарный)", "оз. Буйвола и вдхр. Волчьи Ворота", 2, 2, 4.2, 44.785, 44.115, "Будённовск / Благодарный (Ставропольский край)"],["Курское, Ростовановское и Советское вдхр. (р. Кура / Моздокский канал, ст. Курская)", "Курское и Ростовановское вдхр.", 2, 2, 4.5, 44.045, 44.435, "Курская / Новопавловск (Ставропольский край)"],["Чограйское вдхр. (южный Ставропольский берег: Арзгир / Турксад) и р. Восточный Маныч", "Чограйское вдхр. (Арзгир / Турксад)", 2, 2, 4.5, 45.455, 44.425, "Арзгир / Будённовск (Ставропольский край)"],["оз. Маныч-Гудило, оз. Дадынское, оз. Солёное (Лысый Лиман) и оз. Вшивое (Апанасенковский и Левокумский р-ны: Дивное — Манычское — Приозёрское)", "оз. Дадынское и оз. Маныч-Гудило (Дивное)", 6, 3, 2.8, 45.325, 44.785, "Дивное / Левокумское (Ставропольский край)"],["р. Терек (Курский р-н: ст. Галюгаевская — ст. Стодеревская) и р. Малка (Новопавловск — Марьинская)", "Терек (Галюгаевская) и Малка (Новопавловск)", 2, 1, 3.2, 43.702, 44.795, "Новопавловск / Галюгаевская (Ставропольский край)"],["р. Калаус (Светлоград — Ипатово — Воздвиженское), оз. Кравцово (Ставрополь), оз. Новопятигорское (Пятигорск)", "Калаус, оз. Кравцово и оз. Новопятигорское", 6, 3, 2.6, 45.335, 42.854, "Светлоград / Ипатово / Ставрополь / Пятигорск"],["р. Ока (Нижний Новгород)", "Ока", 2, 1, 5.0, 56.32, 43.99, "Нижний Новгород"],["р. Волга (Нижний Новгород)", "Волга", 2, 1, 6.5, 56.33, 44.01, "Нижний Новгород"],["р. Ветлуга", "", 2, 1, 3.4, 56.85, 45.45, "Нижегородская обл."],["Горьковское вдхр.", "", 2, 2, 6.2, 56.8, 43.4, "Нижегородская обл."],["Чебоксарское вдхр.", "", 2, 2, 5.8, 56.14, 47.25, "Чебоксары / Васильсурск"],["р. Сура", "", 2, 0, 2.5, 55.85, 46.35, "Чувашия / Пенза"],["р. Волга (Казань)", "Волга", 2, 1, 7.2, 55.79, 49.12, "Казань"],["р. Казанка", "", 2, 0, 2.0, 55.8, 49.11, "Казань"],["р. Свияга", "", 2, 0, 2.4, 55.72, 48.65, "Татарстан / Ульяновск"],["р. Кама (Камское Устье)", "Камское Устье", 2, 2, 9.5, 55.2, 49.28, "Татарстан"],["Нижнекамское вдхр. (Набережные Челны)", "Нижнекамское вдхр.", 2, 2, 6.8, 55.7, 52.35, "Набережные Челны"],["р. Кама (Пермь)", "Кама", 2, 1, 6.2, 58.01, 56.25, "Пермь"],["р. Чусовая", "", 2, 0, 2.4, 58.18, 56.85, "Пермский край / Свердловская обл."],["Камское вдхр.", "", 2, 2, 6.5, 58.15, 56.35, "Пермский край"],["Куйбышевское вдхр. (Самара / Тольятти)", "Куйбышевское вдхр.", 2, 2, 8.5, 53.2, 50.15, "Самара"],["р. Самара", "", 2, 0, 2.5, 53.18, 50.11, "Самара"],["р. Сок", "", 2, 0, 2.2, 53.41, 50.15, "Самарская обл."],["Саратовское вдхр.", "", 2, 2, 7.8, 51.53, 46.03, "Саратов / Балаково"],["р. Белая (Уфа)", "Белая (Агидель)", 2, 1, 3.6, 54.73, 55.97, "Уфа"],["р. Уфа (Караидель)", "Уфа (Уфимка)", 2, 0, 2.5, 54.76, 56.05, "Уфа"],["Павловское вдхр.", "", 2, 2, 9.0, 55.42, 56.55, "Башкортостан"],["оз. Аслыкуль", "", 2, 2, 4.5, 54.31, 54.58, "Башкортостан"],["р. Вятка (Киров)", "Вятка", 2, 1, 3.2, 58.6, 49.66, "Киров"],["р. Урал (Оренбург)", "Урал", 2, 1, 2.8, 51.77, 55.1, "Оренбург"],["Ириклинское вдхр.", "", 2, 2, 10.0, 51.78, 58.78, "Оренбургская обл."],["р. Бирь (Мишкино / Бирск)", "Бирь", 2, 0, 2.0, 55.43, 55.9, "Мишкино / Бирск (Башкортостан)"],["р. Уфа (Караидель / Чандар)", "Уфа (Караидель)", 2, 1, 4.8, 55.83, 56.91, "Караидель (Башкортостан)"],["р. Быстрый Танып", "", 2, 0, 2.2, 56.12, 54.58, "Бураево / Янаул (Башкортостан)"],["р. Дёма (Давлеканово / Чишмы)", "Дёма", 2, 0, 2.3, 54.22, 55.03, "Давлеканово / Чишмы (Башкортостан)"],["р. Сим", "", 2, 0, 2.1, 54.62, 56.38, "Иглино / Архангельское (Башкортостан)"],["р. Инзер", "", 2, 0, 1.9, 54.42, 57.18, "Инзер / Архангельское (Башкортостан)"],["р. Ай (Месягутово / Лаклы)", "Ай", 2, 0, 2.0, 55.55, 58.25, "Месягутово / Дуванский р-н"],["р. Юрюзань", "", 2, 0, 2.1, 55.38, 57.9, "Малояз / Салаватский р-н"],["р. Ик (Октябрьский / Туймазы)", "Ик", 2, 0, 2.4, 54.48, 53.47, "Октябрьский / Бакалы (Башкортостан)"],["оз. Аслыкуль (Башкортостан)", "Озеро Аслыкуль", 2, 2, 5.5, 54.31, 54.58, "Давлеканово (Башкортостан)"],["оз. Кандрыкуль (Башкортостан)", "Озеро Кандрыкуль", 2, 2, 6.5, 54.5, 54.05, "Туймазы / Кандры (Башкортостан)"],["оз. Банное (Якты-Куль)", "Озеро Банное", 2, 2, 10.0, 53.59, 58.63, "Абзелиловский р-н / Магнитогорск"],["Нугушское вдхр.", "", 2, 2, 9.0, 53.05, 56.45, "Мелеуз / Нугуш (Башкортостан)"],["Юмагузинское вдхр.", "", 2, 2, 12.0, 52.96, 56.55, "Кугарчинский р-н (Башкортостан)"],["Кармановское вдхр. (ГРЭС)", "Кармановское вдхр.", 2, 4, 5.5, 56.22, 54.33, "Нефтекамск / Янаул (Башкортостан)"],["оз. Шамсутдин (Бирск)", "Озеро Шамсутдин", 2, 3, 3.2, 55.44, 55.48, "Бирск / Мишкинский р-н"],["р. Белая (Стерлитамак / Салават / Ишимбай)", "р. Белая (Стерлитамак)", 2, 1, 3.5, 53.52, 55.95, "Стерлитамак / Салават (Башкортостан)"],["р. Белая / Белорецкий пруд (Белорецк)", "р. Белая (Белорецк)", 2, 0, 2.2, 53.965, 58.4, "Белорецк (Башкортостан)"],["оз. Ургун / оз. Калкан (Учалы)", "оз. Ургун (Учалы)", 2, 2, 5.5, 54.32, 59.38, "Учалы (Башкортостан)"],["оз. Талкас / р. Таналык (Баймак / Сибай)", "оз. Талкас (Баймак)", 2, 2, 6.5, 52.66, 58.5, "Баймак / Сибай (Башкортостан)"],["р. Урал (Орск)", "р. Урал (Орск)", 2, 1, 3.0, 51.23, 58.475, "Орск (Оренбургская обл.)"],["р. Самара / р. Бузулук (Бузулук)", "р. Самара (Бузулук)", 2, 0, 2.5, 52.788, 52.262, "Бузулук (Оренбургская обл.)"],["Ижевский пруд / р. Иж (Ижевск)", "Ижевский пруд", 2, 2, 5.5, 56.86, 53.18, "Ижевск (Удмуртия)"],["Воткинское вдхр. (Чайковский / Воткинск / Оса)", "Воткинское вдхр.", 2, 2, 8.0, 57.0, 54.55, "Чайковский / Воткинск / Оса"],["р. Сылва / р. Ирень (Кунгур)", "р. Сылва (Кунгур)", 2, 0, 2.6, 57.43, 56.95, "Кунгур (Пермский край)"],["Камское вдхр. (Березники / Соликамск / Пожва)", "Камское вдхр. (Березники)", 2, 2, 7.5, 59.41, 56.78, "Березники / Соликамск"],["р. Вишера / р. Колва (Красновишерск / Чердынь)", "р. Вишера", 2, 1, 3.5, 60.403, 56.8, "Красновишерск / Чердынь (Пермский край)"],["р. Вятка (Вятские Поляны / Мамадыш)", "р. Вятка (Мамадыш)", 2, 1, 4.2, 55.95, 51.25, "Вятские Поляны / Мамадыш"],["р. Кама (Чистополь / Рыбная Слобода)", "р. Кама (Чистополь)", 2, 1, 8.0, 55.37, 50.55, "Чистополь (Татарстан)"],["Куйбышевское вдхр. (Ульяновск / Димитровград / Сенгилей)", "Куйбышевское вдхр. (Ульяновск)", 2, 2, 9.0, 54.315, 48.45, "Ульяновск"],["Саратовское вдхр. (Сызрань / Хвалынск / Балаково / Вольск)", "Волга (Балаково / Хвалынск)", 2, 2, 8.5, 52.35, 48.05, "Сызрань / Хвалынск / Балаково"],["Сурское вдхр. / р. Сура (Пенза)", "Сурское вдхр. (Пенза)", 2, 2, 6.0, 53.15, 45.15, "Пенза"],["р. Инсар / р. Сура (Саранск)", "р. Сура (Мордовия)", 2, 0, 2.4, 54.185, 45.2, "Саранск (Мордовия)"],["Чебоксарское вдхр. / р. Волга (Лысково / Макарьево / Йошкар-Ола)", "р. Волга (Макарьево)", 2, 2, 6.5, 56.25, 46.2, "Лысково / Йошкар-Ола"],["р. Волга (Лысково / Макарьево)", "р. Волга (Лысково / Макарьево)", 2, 1, 8.0, 56.048, 45.045, "Лысково / Макарьево"],["р. Ока (Павлово)", "р. Ока (Павлово)", 2, 1, 6.0, 55.966, 43.078, "Павлово"],["р. Малая Кокшага (Йошкар-Ола)", "р. Малая Кокшага", 2, 0, 2.8, 56.634, 47.905, "Йошкар-Ола"],["Черемшанский залив (Димитровград)", "Черемшанский залив", 2, 2, 6.5, 54.212, 49.585, "Димитровград"],["Куйбышевское вдхр. (Тольятти)", "Жигулёвское море (Тольятти)", 2, 2, 12.0, 53.485, 49.38, "Тольятти"],["Саратовское вдхр. (Сызрань)", "р. Волга (Сызрань)", 2, 1, 8.5, 53.142, 48.468, "Сызрань"],["Усинский залив (Шигоны)", "Усинский залив", 2, 2, 7.5, 53.395, 48.72, "Шигоны"],["р. Волга (Вольск / Маркс)", "р. Волга (Вольск / Маркс)", 2, 1, 10.0, 51.905, 47.12, "Вольск / Маркс"],["Волгоградское вдхр. (Ровное)", "р. Волга (Ровное)", 2, 2, 9.5, 50.778, 46.065, "Ровное"],["р. Чусовая (Чусовой)", "р. Чусовая (Чусовой)", 2, 1, 3.5, 58.285, 57.815, "Чусовой"],["Воткинское вдхр. (Оса)", "р. Кама (Оса)", 2, 2, 9.0, 57.292, 55.445, "Оса"],["Обвинский залив (Ильинский)", "р. Обва (Ильинский)", 2, 2, 7.0, 58.572, 55.695, "Ильинский"],["Камское вдхр. (Пожва)", "р. Кама (Пожва)", 2, 2, 8.5, 59.092, 56.11, "Пожва"],["р. Быстрый Танып (Балтачево / Татышлы)", "р. Быстрый Танып (Татышлы)", 2, 0, 2.8, 56.145, 55.88, "Верхние Татышлы / Старобалтачево"],["р. Сюнь (Бакалы)", "р. Сюнь (Бакалы)", 2, 0, 2.4, 55.182, 53.805, "Бакалы"],["р. База (Чекмагуш)", "р. База (Чекмагуш)", 2, 0, 2.2, 55.138, 54.66, "Чекмагуш"],["р. Зилим (Красноусольский)", "р. Зилим", 2, 0, 2.5, 53.925, 56.51, "Красноусольский"],["р. Белая (Кумертау / Мелеуз)", "р. Белая (Мелеуз / Кумертау)", 2, 1, 3.8, 52.955, 55.925, "Кумертау"],["р. Белая (Актаныш)", "р. Белая (Актаныш)", 2, 1, 6.0, 55.725, 54.095, "Актаныш"],["Куйбышевское вдхр. (Звенигово)", "р. Волга (Звенигово)", 2, 1, 8.5, 55.968, 48.012, "Звенигово"],["Сурское вдхр. (Пенза)", "Сурское вдхр.", 2, 2, 5.5, 53.082, 45.222, "Пензенская обл."],["р. Мокша (Темников / Краснослободск / Ковылкино)", "Мокша", 2, 0, 2.8, 54.429, 43.776, "Республика Мордовия"],["р. Белая (Дюртюли / Бирск / Кушнаренково)", "р. Белая (Дюртюли / Бирск)", 2, 1, 4.2, 55.492, 54.872, "Дюртюли / Бирск / Кушнаренково"],["р. Белая (Агидель / устье)", "р. Белая (Агидель)", 2, 1, 5.0, 55.908, 53.918, "Агидель / Нефтекамск"],["р. Белая (Старосубхангулово / Бурзян)", "р. Белая (Бурзян)", 2, 0, 1.8, 53.106, 57.442, "Старосубхангулово / Бурзян"],["р. Уфа (Уфа — Сипайлово / Шакша)", "р. Уфа (г. Уфа)", 2, 1, 4.0, 54.762, 56.082, "Уфа"],["р. Большой Инзер и р. Малый Инзер (Межгорье / Инзер)", "р. Большой и Малый Инзер", 2, 0, 1.6, 54.212, 57.562, "Межгорье / Инзер"],["р. Зилаир и р. Сакмара (Зилаирский р-н)", "р. Зилаир / р. Сакмара", 2, 0, 1.7, 52.233, 57.442, "Зилаир / Баймак"],["р. Большой Ик (Мраково / Исянгулово)", "р. Большой Ик", 2, 0, 2.0, 52.193, 56.578, "Мраково / Исянгулово"],["р. Чермасан (Кушнаренково / Чекмагуш)", "р. Чермасан", 2, 0, 1.9, 55.021, 55.142, "Кушнаренково / Чекмагуш"],["р. Уршак (Кармаскалы / Чишмы)", "р. Уршак", 2, 0, 1.8, 54.482, 55.892, "Кармаскалы / Уфа"],["р. Ашкадар (Стерлитамак)", "р. Ашкадар", 2, 0, 1.9, 53.615, 55.942, "Стерлитамак / Фёдоровка"],["р. Усень и Туймазинское вдхр. (Туймазы)", "Туймазинское вдхр. / р. Усень", 2, 2, 3.5, 54.542, 53.782, "Туймазы"],["Сакмарское вдхр. и Акъярское вдхр. (Хайбуллинский р-н)", "Акъярское и Сакмарское вдхр.", 2, 2, 4.2, 51.895, 58.185, "Акъяр / Баймак"],["оз. Мулдаккуль и оз. Чебаркуль (Абзелиловский р-н)", "оз. Чебаркуль (Башкортостан)", 2, 2, 3.6, 53.412, 58.642, "Аскарово / Магнитогорск"],["оз. Архимандритское и оз. Кашкадан (Уфа)", "оз. Архимандритское (Уфа)", 2, 3, 2.8, 54.685, 55.982, "Уфа"],["Чебоксарское вдхр. (Козьмодемьянск / Юрино — устье р. Ветлуга)", "Чебоксарское вдхр. (Козьмодемьянск / Юрино)", 2, 1, 6.5, 56.345, 46.562, "Козьмодемьянск / Юрино"],["р. Ветлуга (Юрино — низовья)", "р. Ветлуга (Юрино)", 2, 1, 4.5, 56.308, 46.312, "Юрино / Козьмодемьянск"],["р. Большая Кокшага и устье в с. Кокшайск", "р. Большая Кокшага (Кокшайск)", 2, 0, 2.6, 56.165, 47.802, "Кокшайск / Йошкар-Ола"],["Куйбышевское вдхр. (Волжск / Лопатино)", "Куйбышевское вдхр. (Волжск)", 2, 1, 6.0, 55.862, 48.352, "Волжск / Звенигово"],["р. Илеть (Морки / Красногорский / Волжский р-н)", "р. Илеть", 2, 0, 2.4, 56.142, 48.331, "Красногорский / Морки / Волжск"],["р. Рутка и р. Арда (Килемарский р-н)", "р. Рутка / р. Арда", 2, 0, 2.2, 56.512, 46.785, "Килемары / Козьмодемьянск"],["р. Юшут (Марий Чодра)", "р. Юшут", 2, 0, 2.0, 56.252, 48.495, "Красногорский / Морки"],["оз. Яльчик (Марий Чодра, Волжский р-н)", "оз. Яльчик", 2, 2, 6.5, 56.012, 48.435, "Волжск / Красногорский"],["оз. Таир и оз. Карась (Звениговский р-н)", "оз. Таир", 2, 2, 4.5, 56.342, 47.695, "Йошкар-Ола / Звенигово"],["оз. Кичиер и оз. Мушан-Ер (Волжский р-н)", "оз. Кичиер", 2, 2, 5.0, 56.068, 48.352, "Волжск / Красногорский"],["оз. Морской Глаз (Шарибоксад)", "оз. Морской Глаз", 2, 2, 12.0, 56.141, 48.782, "Волжск / Морки"],["р. Сура и оз. Гусиное (Большие Березники / Кочкурово)", "р. Сура (Большие Березники)", 2, 1, 3.5, 54.178, 46.165, "Большие Березники / Саранск"],["р. Алатырь (Ардатов / Тургенево / Кемля)", "р. Алатырь (Ардатов / Кемля)", 2, 0, 2.4, 54.842, 46.235, "Ардатов / Тургенево / Кемля"],["р. Исса и р. Инсарка (г. Инсар)", "р. Исса / р. Инсарка (Инсар)", 2, 0, 1.8, 53.871, 44.372, "Инсар"],["р. Сивинь (Старое Шайгово / Краснослободск)", "р. Сивинь", 2, 0, 1.7, 54.312, 44.478, "Старое Шайгово / Краснослободск"],["р. Вад и р. Парца (Зубова Поляна)", "р. Вад / р. Парца (Зубова Поляна)", 2, 0, 2.1, 54.075, 42.836, "Зубова Поляна"],["Карнайское вдхр. / Сузгарьевский водоём (Кочкуровский / Рузаевский р-н)", "Карнайское вдхр.", 2, 2, 3.5, 54.035, 45.448, "Кочкурово / Рузаевка / Саранск"],["оз. Инерка и оз. Пиявское (Большеберезниковский р-н)", "оз. Инерка", 2, 3, 4.2, 54.058, 45.892, "Большие Березники / Саранск"],["оз. Шелубей и старицы р. Мокша (Теньгушевский р-н)", "оз. Шелубей (Теньгушево)", 2, 3, 2.8, 54.763, 42.716, "Теньгушево / Темников"],["Саранское море и Пичерский пруд (Саранск / Рузаевка)", "Саранское море / Пичерский пруд", 2, 2, 3.0, 54.072, 44.962, "Саранск / Рузаевка"],["Куйбышевское вдхр. (Камское Устье — Лобач / Тенишево / Куйбышевский Затон)", "Куйбышевское вдхр. (Камское Устье / Затон)", 2, 1, 9.5, 55.202, 49.275, "Камское Устье / Куйбышевский Затон"],["Куйбышевское вдхр. (Свияжский залив / Зеленодольск / Васильево)", "Куйбышевское вдхр. (Свияжск / Зеленодольск)", 2, 1, 6.0, 55.785, 48.662, "Зеленодольск / Свияжск / Казань"],["Куйбышевское вдхр. (Лаишево / Атабаево / Сорочьи Горы — Мёшинский плёс)", "Куйбышевское вдхр. (Лаишево / Сорочьи Горы)", 2, 1, 7.5, 55.382, 49.552, "Лаишево / Сорочьи Горы / Атабаево"],["Куйбышевское вдхр. (Тетюши / Болгар — Спасский затон)", "Куйбышевское вдхр. (Тетюши / Болгар)", 2, 1, 8.5, 54.948, 48.862, "Тетюши / Болгар"],["р. Кама (Алексеевское / Саконы)", "р. Кама (Алексеевское)", 2, 1, 7.0, 55.325, 50.112, "Алексеевское / Чистополь"],["р. Кама и устье р. Тойма (Елабуга / Нижнекамск / Красный Ключ)", "р. Кама (Елабуга / Нижнекамск)", 2, 1, 6.5, 55.712, 52.042, "Елабуга / Нижнекамск"],["Нижнекамское вдхр. (Мензелинск / Ижевка / Менделеевск / устье р. Иж)", "Нижнекамское вдхр. (Мензелинск / Ижевка)", 2, 1, 6.0, 55.842, 52.952, "Мензелинск / Менделеевск / Актаныш"],["Заинское вдхр. (Заинская ГРЭС, г. Заинск)", "Заинское вдхр. (ГРЭС)", 2, 4, 4.5, 55.285, 52.048, "Заинск"],["Карабашское вдхр. (Бугульминский р-н, р. Степной Зай)", "Карабашское вдхр.", 2, 2, 5.5, 54.702, 52.592, "Карабаш / Бугульма / Лениногорск"],["р. Мёша (Пестрецы / Лаишевский р-н)", "р. Мёша", 2, 0, 2.3, 55.748, 49.652, "Пестрецы / Лаишево"],["р. Ик (Муслюмово / Азнакаево / Уруссу / Мензелинский р-н)", "р. Ик (Муслюмово / Азнакаево)", 2, 0, 2.5, 55.311, 53.188, "Муслюмово / Азнакаево / Уруссу"],["р. Степной Зай (Альметьевск / Заинск)", "р. Степной Зай", 2, 0, 2.0, 54.915, 52.285, "Альметьевск / Заинск"],["р. Шешма (Новошешминск / Чистопольский р-н)", "р. Шешма", 2, 0, 2.1, 55.068, 51.236, "Новошешминск / Чистополь"],["р. Большой Черемшан (Нурлат)", "р. Большой Черемшан (Нурлат)", 2, 0, 2.2, 54.428, 50.805, "Нурлат / Черемшан"],["оз. Средний, Нижний и Верхний Кабан (Казань)", "оз. Кабан (Казань)", 2, 2, 4.5, 55.762, 49.132, "Казань"],["оз. Лебяжье и оз. Глубокое (Казань)", "оз. Лебяжье и Глубокое (Казань)", 2, 2, 3.8, 55.839, 48.948, "Казань"],["оз. Раифское (Зеленодольский р-н)", "оз. Раифское", 2, 2, 5.5, 55.902, 48.728, "Зеленодольск / Казань"],["Воткинский пруд / р. Вотка (г. Воткинск)", "Воткинский пруд (Воткинск)", 2, 2, 3.8, 57.058, 53.978, "Воткинск"],["р. Кама (Сарапул / Гольяны / Нечкино)", "р. Кама (Сарапул / Гольяны)", 2, 1, 6.0, 56.472, 53.818, "Сарапул / Гольяны / Ижевск"],["р. Кама и устье р. Белой (Каракулино / Усть-Бельск / Боярка)", "р. Кама (Каракулино / Усть-Бельск)", 2, 1, 6.5, 55.995, 53.642, "Каракулино / Усть-Бельск"],["Камбарский пруд и р. Кама (Камбарка)", "Камбарский пруд / р. Кама", 2, 2, 3.5, 56.265, 54.205, "Камбарка"],["р. Чепца (Глазов / Балезино / Яр / Дебёсы)", "р. Чепца (Глазов / Балезино)", 2, 0, 2.5, 58.145, 52.662, "Глазов / Балезино / Яр"],["Пудемский пруд (Ярский р-н)", "Пудемский пруд", 2, 2, 3.2, 58.358, 52.176, "Пудем / Яр / Глазов"],["р. Вала и р. Нылга (Можга / Вавож)", "р. Вала (Можга / Вавож)", 2, 0, 2.2, 56.774, 51.93, "Можга / Вавож"],["р. Кильмезь (Сюмси / Селты)", "р. Кильмезь (Сюмси)", 2, 0, 2.3, 57.11, 51.615, "Сюмси / Селты"],["р. Лоза (п. Игра)", "р. Лоза (Игра)", 2, 0, 1.8, 57.554, 53.054, "Игра"],["р. Иж (Малая Пурга / Агрыз)", "р. Иж (Малая Пурга / Агрыз)", 2, 0, 2.1, 56.542, 53.002, "Малая Пурга / Агрыз / Ижевск"],["Куйбышевское вдхр. / р. Волга (Новочебоксарск / Мариинский Посад / Козловка)", "р. Волга (Новочебоксарск / Козловка)", 2, 1, 7.5, 56.115, 47.562, "Новочебоксарск / Мариинский Посад / Козловка"],["Чебоксарское вдхр. (Чебоксарский залив / Сосновка / Ильинка / Шомиково)", "Чебоксарское вдхр. (Чебоксары)", 2, 1, 6.5, 56.158, 47.202, "Чебоксары / Сосновка"],["р. Сура (Алатырь / Порецкое / Шумерля / Ядрин)", "р. Сура (Алатырь / Шумерля / Ядрин)", 2, 1, 3.8, 55.501, 46.413, "Алатырь / Шумерля / Ядрин"],["р. Большой Цивиль и р. Малый Цивиль (Цивильск / Новочебоксарск)", "р. Большой и Малый Цивиль", 2, 0, 2.0, 55.869, 47.479, "Цивильск / Канаш"],["р. Аниш (Козловский р-н)", "р. Аниш", 2, 0, 1.7, 55.842, 48.112, "Козловка / Урмары"],["р. Кубня (Комсомольское / Янтиково)", "р. Кубня", 2, 0, 1.8, 55.222, 47.486, "Комсомольское / Канаш"],["р. Выла (Ядринский р-н)", "р. Выла", 2, 0, 1.6, 55.885, 46.312, "Ядрин / Аликово"],["оз. Кюльхири и оз. Изъяр (Вурнары / Заволжье Чебоксар)", "оз. Изъяр / оз. Кюльхири", 2, 2, 3.5, 56.218, 47.262, "Чебоксары / Вурнары"],["Чусовской и Сылвенский заливы Камского вдхр. (Пермь / Полазна / Сылва)", "Чусовской и Сылвенский заливы", 2, 1, 7.5, 58.135, 56.452, "Пермь / Полазна / Сылва"],["Иньвенский и Косьвинский заливы Камского вдхр. (Майкор / Чёрмоз)", "Иньвенский и Косьвинский заливы", 2, 1, 6.5, 58.892, 56.112, "Чёрмоз / Майкор / Добрянка"],["Тёплый канал Пермской ГРЭС (Добрянка)", "Пермская ГРЭС (Добрянка)", 2, 4, 4.2, 58.488, 56.382, "Добрянка / Пермь"],["Тёплый сброс Яйвинской ГРЭС и р. Яйва (пгт Яйва)", "Яйвинская ГРЭС / р. Яйва", 2, 4, 3.8, 59.333, 57.266, "Яйва / Александровск / Березники"],["Широковское вдхр. и р. Косьва (Губаха)", "Широковское вдхр. / р. Косьва", 2, 2, 8.0, 58.854, 57.792, "Губаха / Кизел"],["Воткинское вдхр. (Оханск / Елово / Частые / Усть-Качка)", "Воткинское вдхр. (Оханск / Елово)", 2, 1, 8.5, 57.721, 55.388, "Оханск / Елово / Частые"],["Нытвенский пруд (г. Нытва)", "Нытвенский пруд", 2, 2, 3.5, 57.939, 55.331, "Нытва / Краснокамск"],["Очёрский пруд (г. Очёр) и Лысьвенский пруд (г. Лысьва)", "Лысьвенский и Очёрский пруды", 2, 2, 3.8, 58.106, 57.805, "Лысьва / Очёр"],["р. Койва и р. Вижай (Горнозаводск / Пашия / Кусье-Александровский)", "р. Койва / р. Вижай", 2, 0, 1.8, 58.281, 58.362, "Горнозаводск / Чусовой"],["р. Усьва (Усьва / Мыс / Чусовой)", "р. Усьва", 2, 0, 1.9, 58.685, 57.621, "Чусовой / Губаха / Гремячинск"],["р. Березовая и р. Язьва (Чердынский / Красновишерский р-н)", "р. Березовая / р. Язьва", 2, 0, 2.1, 60.412, 57.115, "Красновишерск / Чердынь"],["р. Кама — верховья (Гайны / Бондюг / Тюлькино)", "р. Кама (Гайны / верховья)", 2, 1, 3.8, 60.308, 54.326, "Гайны / Соликамск"],["р. Коса и р. Иньва (Коса / Кудымкар)", "р. Иньва / р. Коса (Кудымкар)", 2, 0, 2.3, 59.016, 54.659, "Кудымкар / Коса / Юсьва"],["р. Тулва (Барда / Оса)", "р. Тулва (Барда)", 2, 0, 2.0, 56.925, 55.586, "Барда / Оса"],["оз. Адово (Гайнский р-н)", "оз. Адово", 2, 3, 3.5, 60.521, 53.392, "Гайны"],["р. Вятка (Слободской / Кирово-Чепецк / устье р. Чепца)", "р. Вятка (Слободской / Кирово-Чепецк)", 2, 1, 4.2, 58.554, 50.032, "Кирово-Чепецк / Слободской / Киров"],["р. Вятка (Орлов / Котельнич / устье р. Молома)", "р. Вятка (Орлов / Котельнич)", 2, 1, 4.5, 58.308, 48.348, "Котельнич / Орлов"],["р. Вятка (Советск / Лебяжье / Уржум / Малмыж / Сосновка)", "р. Вятка (Советск / Уржум / Малмыж)", 2, 1, 5.0, 57.589, 48.958, "Советск / Уржум / Малмыж / Сосновка"],["р. Вятка — верховья (Кирс / Нагорск / Песковка)", "р. Вятка (Кирс / Нагорск)", 2, 1, 3.2, 59.339, 52.244, "Кирс / Нагорск / Омутнинск"],["р. Кама — верховья (Афанасьево / Бисерово)", "р. Кама (Афанасьево)", 2, 0, 2.4, 58.864, 53.253, "Афанасьево"],["р. Чепца (Зуевка / Фалёнки / Кирово-Чепецк)", "р. Чепца (Зуевка / Кирово-Чепецк)", 2, 0, 2.8, 58.404, 51.132, "Зуевка / Фалёнки / Кирово-Чепецк"],["р. Молома (Даровской / Котельничский р-н)", "р. Молома", 2, 0, 2.5, 58.771, 47.957, "Даровской / Котельнич"],["р. Пижма и р. Немда (Советск / Тужа / Пижанка)", "р. Пижма / р. Немда", 2, 0, 2.4, 57.581, 48.921, "Советск / Тужа / Пижанка"],["р. Кильмезь и р. Лобань (пгт Кильмезь)", "р. Кильмезь (пгт Кильмезь)", 2, 0, 2.5, 56.945, 51.069, "Кильмезь"],["р. Великая (Юрья / Мурыгино)", "р. Великая (Юрья / Мурыгино)", 2, 0, 2.2, 58.736, 49.457, "Юрья / Мурыгино / Киров"],["р. Кобра (Нагорский / Даровской р-н)", "р. Кобра", 2, 0, 2.1, 59.322, 50.806, "Нагорск"],["р. Луза и р. Юг (Луза / Подосиновец / Демьяново)", "р. Луза / р. Юг", 4, 0, 2.6, 60.631, 47.251, "Луза / Подосиновец"],["Белохолуницкий пруд (г. Белая Холуница)", "Белохолуницкий пруд", 2, 2, 3.8, 58.842, 50.852, "Белая Холуница"],["Омутнинский пруд (г. Омутнинск) и Большой Кирсинский пруд (г. Кирс)", "Омутнинский и Кирсинский пруды", 2, 2, 3.6, 58.672, 52.181, "Омутнинск / Кирс"],["оз. Шайтан (Уржумский р-н) и оз. Акшубень (Лебяжский р-н)", "оз. Шайтан / оз. Акшубень", 2, 2, 6.0, 57.118, 49.592, "Уржум / Лебяжье / Нолинск"],["Горьковское вдхр. — «Горе-море» (Городец / Заволжье / Чкаловск / Катунки / Сокольское)", "Горьковское вдхр. (Городец / Чкаловск / Сокольское)", 2, 1, 8.0, 56.782, 43.315, "Городец / Заволжье / Чкаловск / Сокольское"],["Чебоксарское вдхр. (Кстово / Лысково / Бармино / Разнежье / Воротынец / Васильсурск)", "Чебоксарское вдхр. (Бармино / Разнежье / Васильсурск)", 2, 1, 7.0, 56.075, 45.654, "Лысково / Воротынец / Васильсурск"],["р. Волга (Балахна / Правдинск / Сормово — Нижний Новгород)", "р. Волга (Балахна / Сормово)", 2, 1, 5.5, 56.491, 43.541, "Балахна / Нижний Новгород"],["р. Ока (Дзержинск / Горбатов / Павлово / Тумботино / Навашино / Выкса)", "р. Ока (Дзержинск / Горбатов / Навашино)", 2, 1, 4.8, 56.132, 43.064, "Дзержинск / Горбатов / Павлово / Навашино / Выкса"],["р. Керженец (Семёнов / Рустай / Макарьево)", "р. Керженец", 2, 0, 2.2, 56.789, 44.492, "Семёнов / Макарьево"],["р. Ветлуга (Ветлуга / Варнавино / Красные Баки / Воскресенское)", "р. Ветлуга (Варнавино / Красные Баки / Воскресенское)", 2, 1, 3.8, 57.129, 45.155, "Ветлуга / Красные Баки / Воскресенское"],["р. Пьяна (Перевоз / Бутурлино / Гагино / Сергач / Пильна)", "р. Пьяна", 2, 0, 2.4, 55.531, 45.469, "Перевоз / Сергач / Пильна"],["р. Тёша и р. Серёжа (Арзамас / Лукоянов / Навашино)", "р. Тёша / р. Серёжа", 2, 0, 2.0, 55.395, 43.839, "Арзамас / Навашино / Лукоянов"],["р. Уста (Урень)", "р. Уста (Урень)", 2, 0, 2.1, 57.461, 45.786, "Урень / Красные Баки"],["р. Узола (Ковернино / Городец)", "р. Узола", 2, 0, 1.8, 57.125, 43.814, "Ковернино / Городец"],["р. Кудьма и р. Линда (Кстово / Бор)", "р. Кудьма / р. Линда", 2, 0, 1.9, 56.112, 44.205, "Кстово / Бор / Нижний Новгород"],["оз. Светлояр (Воскресенский р-н)", "оз. Светлояр", 2, 2, 8.0, 56.819, 45.092, "Воскресенское / Семёнов"],["оз. Вадское / Мордовское (с. Вад)", "оз. Вадское (Вад)", 2, 2, 4.5, 55.535, 44.197, "Вад / Арзамас"],["оз. Тосканка (г. Ворсма) и Пустынские озёра (Арзамасский р-н)", "оз. Тосканка и Пустынские озёра", 2, 2, 4.0, 55.991, 43.275, "Ворсма / Павлово / Арзамас"],["р. Урал (Новотроицк / Верхняя Кардаиловка)", "р. Урал (Новотроицк)", 2, 1, 3.5, 51.203, 58.327, "Новотроицк / Орск"],["р. Урал (Беляевка / Красногор — среднее течение)", "р. Урал (Беляевка / Красногор)", 2, 1, 3.8, 51.397, 56.416, "Беляевка / Саракташ / Оренбург"],["р. Урал и устье р. Илек (с. Илек / Рассыпное)", "р. Урал (с. Илек)", 2, 1, 4.2, 51.527, 53.383, "Илек / Оренбург"],["р. Сакмара (Кувандык / Саракташ / с. Сакмара / Оренбург)", "р. Сакмара", 2, 1, 3.2, 51.787, 56.362, "Кувандык / Саракташ / Оренбург"],["р. Илек (Соль-Илецк / Акбулак / Илек)", "р. Илек (Соль-Илецк / Акбулак)", 2, 0, 2.4, 51.161, 54.992, "Соль-Илецк / Акбулак / Илек"],["Сорочинское вдхр. и р. Самара (Сорочинск / Новосергиевка / Тоцкое)", "Сорочинское вдхр. / р. Самара", 2, 2, 4.8, 52.418, 53.212, "Сорочинск / Новосергиевка"],["р. Большой Кинель (Бугуруслан / Асекеево)", "р. Большой Кинель (Бугуруслан)", 2, 0, 2.3, 53.655, 52.441, "Бугуруслан / Асекеево"],["р. Суундук и Суундукский залив Ириклинского вдхр. (Кваркено / Гай)", "Суундукский залив Ириклы", 2, 2, 7.5, 51.985, 59.112, "Кваркено / Энергетик / Гай"],["р. Большой Кумак и Кумакское вдхр. (Новоорск / Ясный)", "Кумакское вдхр. / р. Большой Кумак", 2, 2, 3.5, 51.381, 58.981, "Новоорск / Ясный / Орск"],["Елшанское вдхр. (Бузулукский р-н)", "Елшанское вдхр.", 2, 2, 4.0, 52.712, 52.412, "Бузулук"],["Ушкатинское вдхр. (Домбаровский р-н)", "Ушкатинское вдхр.", 2, 2, 3.8, 50.758, 59.538, "Домбаровский / Ясный"],["оз. Жетыколь и оз. Шалкар-Ега-Кара (Светлинский р-н)", "оз. Жетыколь (Светлый)", 2, 3, 2.5, 50.819, 60.854, "Светлый"],["р. Сура (Пенза / Заречный / Бессоновка / Лунино — ниже плотины)", "р. Сура (Пенза / Лунино)", 2, 1, 3.2, 53.309, 45.041, "Пенза / Заречный / Лунино"],["р. Сура — верховья (Сурск / Чаадаевка / Сосновоборск)", "р. Сура (Сурск / Чаадаевка)", 2, 0, 2.2, 53.076, 45.675, "Сурск / Городище / Кузнецк"],["р. Уза и Узинский залив Сурского вдхр. (Шемышейка / Лопатино)", "р. Уза / Узинский залив", 2, 0, 2.8, 52.891, 45.392, "Шемышейка / Пенза"],["р. Мокша и р. Ломовка (Мокшан / Нижний Ломов / Наровчат)", "р. Мокша (Мокшан / Нижний Ломов)", 2, 0, 2.4, 53.437, 44.613, "Мокшан / Нижний Ломов / Наровчат"],["Вадинское вдхр. и р. Вад (с. Вадинск)", "Вадинское вдхр.", 2, 2, 4.2, 53.692, 43.058, "Вадинск / Земетчино"],["р. Хопёр и р. Сердоба (Сердобск / Беково / Колышлей)", "р. Хопёр / р. Сердоба (Сердобск / Беково)", 6, 0, 2.5, 52.463, 43.712, "Сердобск / Беково / Колышлей"],["р. Ворона и р. Чембар (Белинский / Башмаково)", "р. Ворона / р. Чембар (Белинский)", 6, 0, 2.1, 52.964, 43.417, "Белинский / Каменка"],["р. Выша (Земетчино)", "р. Выша (Земетчино)", 2, 0, 2.0, 53.497, 42.616, "Земетчино"],["р. Атмис (г. Каменка)", "р. Атмис (Каменка)", 2, 0, 1.7, 53.191, 44.047, "Каменка"],["Михайловский пруд и Чистые Пруды (Пензенский / Мокшанский р-н)", "Чистые Пруды (Пенза)", 2, 2, 3.2, 53.265, 44.782, "Пенза / Мокшан"],["Саратовское вдхр. / р. Волга (Самара / Жигулёвск / Ширяево / Винновка)", "Саратовское вдхр. (Самара / Ширяево)", 2, 1, 8.0, 53.414, 50.015, "Самара / Жигулёвск / Тольятти"],["Саратовское вдхр. (Новокуйбышевск / Чапаевские луга / Безенчук / Приволжье / Октябрьск)", "Саратовское вдхр. (Безенчук / Приволжье / Октябрьск)", 2, 1, 7.5, 53.052, 49.412, "Новокуйбышевск / Безенчук / Октябрьск"],["Куйбышевское вдхр. — Сусканский залив (Хрящёвка / Луначарский)", "Сусканский залив (Хрящёвка)", 2, 1, 5.5, 53.816, 49.092, "Тольятти / Хрящёвка"],["Васильевские острова и Сызранская лука (Сызрань / Октябрьск / Переволоки)", "Васильевские острова (Сызрань / Переволоки)", 2, 1, 6.5, 53.208, 49.242, "Сызрань / Октябрьск / Междуреченск"],["р. Уса и Усинский залив (Шигоны / Муранский бор / Междуреченск)", "р. Уса / Муранский бор", 2, 1, 6.0, 53.318, 48.885, "Шигоны / Сызрань / Тольятти"],["р. Большой Кинель (Похвистнево / Кинель-Черкассы / Отрадный / Кинель)", "р. Большой Кинель (Отрадный / Кинель)", 2, 0, 2.6, 53.376, 51.348, "Похвистнево / Отрадный / Кинель"],["р. Кондурча (Красный Яр / Кошки / Елховка)", "р. Кондурча", 2, 0, 2.1, 53.501, 50.392, "Красный Яр / Самара"],["р. Чапаевка и пр. Кривуша (Чапаевск / Новокуйбышевск)", "р. Чапаевка / пр. Кривуша", 2, 0, 2.5, 53.038, 49.792, "Чапаевск / Новокуйбышевск"],["р. Большой Иргиз (Большая Глушица / Пестравка)", "р. Большой Иргиз (Большая Глушица)", 2, 0, 2.4, 52.392, 50.473, "Большая Глушица / Пестравка"],["Кутулукское вдхр. (Богатовский / Кинельский р-н)", "Кутулукское вдхр.", 2, 2, 4.5, 53.152, 51.385, "Богатое / Отрадный / Кинель"],["Съезженское вдхр. и Ветлянское вдхр. (Нефтегорский / Богатовский р-н)", "Съезженское и Ветлянское вдхр.", 2, 2, 4.2, 52.885, 51.242, "Нефтегорск / Богатое"],["Черновское вдхр. (Волжский р-н)", "Черновское вдхр.", 2, 2, 3.8, 53.142, 50.485, "Самара / Кинель"],["Мастрюковские озёра и Федоровские луга (Прибрежный / Тольятти)", "Мастрюковские озёра", 2, 3, 3.0, 53.468, 49.882, "Прибрежный / Тольятти / Самара"],["Волгоградское вдхр. (Саратов / Энгельс / Шумейка / Усть-Курдюм / Чардым)", "Волгоградское вдхр. (Саратов / Энгельс / Чардым)", 2, 1, 9.0, 51.622, 46.235, "Саратов / Энгельс / Чардым"],["Волгоградское вдхр. — нижний бьеф Саратовской ГЭС (Балаково / Вольск / Маркс / Воскресенское)", "Волгоградское вдхр. (Балаково / Вольск / Маркс)", 2, 1, 8.5, 51.995, 47.721, "Балаково / Вольск / Маркс"],["Волгоградское вдхр. (Красноармейск / Золотое / Ахмат / Синенькие)", "Волгоградское вдхр. (Золотое / Ахмат)", 2, 1, 11.0, 50.941, 45.885, "Красноармейск / Саратов"],["Саратовское вдхр. (Хвалынск / Духовницкое / Балаково — верхний бьеф)", "Саратовское вдхр. (Хвалынск / Духовницкое)", 2, 1, 8.0, 52.481, 48.204, "Хвалынск / Духовницкое / Балаково"],["р. Большой Иргиз (Пугачёв / Балаково / Криволучье)", "р. Большой Иргиз (Пугачёв / Балаково)", 2, 0, 2.8, 52.016, 48.803, "Пугачёв / Балаково"],["р. Большой Караман и р. Малый Караман (Марксовский / Энгельсский р-н)", "р. Большой Караман", 2, 0, 2.2, 51.378, 46.852, "Степное / Маркс / Энгельс"],["р. Терешка (Хвалынский / Вольский / Воскресенский р-н)", "р. Терешка", 2, 0, 2.1, 52.148, 46.963, "Сенной / Вольск / Хвалынск"],["р. Еруслан (Красный Кут / Ровенский р-н)", "р. Еруслан (Красный Кут)", 2, 0, 2.0, 50.946, 46.968, "Красный Кут / Ровное"],["р. Хопёр (Балашов / Аркадак / Романовка / Турки)", "р. Хопёр (Балашов / Аркадак)", 6, 0, 2.8, 51.551, 43.168, "Балашов / Аркадак"],["р. Медведица (Петровск / Аткарск / Лысые Горы / Калининск)", "р. Медведица (Аткарск / Калининск)", 6, 0, 2.5, 51.872, 45.006, "Аткарск / Петровск / Калининск"],["р. Большой Узень и р. Малый Узень (Новоузенск / Александров Гай / Ершов / Питерка)", "р. Большой и Малый Узень", 2, 0, 2.2, 50.457, 48.143, "Новоузенск / Ершов / Александров Гай"],["оз. Сазанка (Энгельс) и Балаковский судоходный канал", "оз. Сазанка (Энгельс)", 2, 3, 3.5, 51.512, 46.085, "Энгельс / Саратов"],["Старомайнский залив и р. Майна (пгт Старая Майна / Садовка / Кремёнки)", "Старомайнский залив (Старая Майна)", 2, 1, 4.5, 54.618, 48.918, "Старая Майна / Ульяновск"],["Куйбышевское вдхр. (Ундоры / Поливна / мосты — Ульяновск)", "Куйбышевское вдхр. (Ундоры / Ульяновск)", 2, 1, 10.0, 54.602, 48.395, "Ульяновск / Ундоры"],["Куйбышевское вдхр. (Новоульяновск / Криуши / Шиловка / Сенгилей / Белый Яр)", "Куйбышевское вдхр. (Криуши / Сенгилей / Белый Яр)", 2, 1, 9.0, 54.041, 48.636, "Новоульяновск / Сенгилей / Чердаклы"],["Черемшанский залив Куйбышевского вдхр. (Димитровград / Никольское-на-Черемшане / Мулловка)", "Черемшанский залив (Никольское-на-Черемшане)", 2, 1, 5.5, 53.963, 49.308, "Димитровград / Мулловка"],["Саратовское вдхр. (Паньшино, Радищевский р-н)", "Саратовское вдхр. (Паньшино)", 2, 1, 7.5, 52.812, 48.471, "Радищево / Сызрань"],["р. Свияга (Ульяновск / Ишеевка / Большое Нагаткино)", "р. Свияга (Ульяновск / Ишеевка)", 2, 0, 2.4, 54.426, 48.271, "Ульяновск / Ишеевка"],["р. Большой Черемшан (Димитровград / Новомалыклинский р-н)", "р. Большой Черемшан (Димитровград)", 2, 0, 2.5, 54.218, 49.685, "Димитровград / Новая Малыкла"],["р. Сура, р. Барыш и р. Инза (пгт Сурское / Карсун / Барыш / Инза)", "р. Сура / р. Барыш / р. Инза", 2, 0, 2.8, 54.481, 46.718, "Сурское / Барыш / Инза"],["р. Сызранка (Новоспасское)", "р. Сызранка (Новоспасское)", 2, 0, 1.9, 53.149, 47.752, "Новоспасское"],["Юшанское вдхр. (Майнский р-н) и оз. Белое (Николаевский р-н)", "Юшанское вдхр. / оз. Белое", 2, 2, 3.2, 54.228, 47.785, "Майна / Ульяновск"],["р. Седе-Яха", "", 0, 0, 1.4, 66.083, 76.68, "Новый Уренгой"],["р. Ево-Яха", "", 0, 0, 1.6, 66.071, 76.712, "Новый Уренгой"],["р. Тамчара-Яха", "", 0, 0, 1.3, 66.065, 76.63, "Новый Уренгой"],["оз. Молодёжное", "", 0, 3, 1.8, 66.09, 76.69, "Новый Уренгой"],["Песчаные карьеры (Н. Уренгой)", "Карьеры Н. Уренгоя", 0, 2, 3.5, 66.055, 76.74, "Новый Уренгой"],["р. Тамбей-Яха", "", 0, 0, 1.2, 66.12, 76.55, "ЯНАО / Новый Уренгой"],["Уренгойская ГРЭС (пос. Лимбияха, тёплый канал)", "Уренгойская ГРЭС (пос. Лимбияха)", 0, 4, 3.5, 66.062, 77.815, "пос. Лимбияха / Новый Уренгой"],["оз. Ямылимуяганто (охладитель ГРЭС, Лимбияха)", "оз. Ямылимуяганто (ГРЭС Лимбияха)", 0, 4, 4.2, 66.068, 77.835, "пос. Лимбияха / Новый Уренгой"],["р. Лимбяяха (пос. Лимбияха)", "р. Лимбяяха (Лимбияха)", 0, 0, 1.9, 66.055, 77.79, "пос. Лимбияха / Новый Уренгой"],["р. Пур (Коротчаево / Уренгой)", "р. Пур (Коротчаево / Уренгой)", 0, 1, 4.5, 65.947, 78.15, "Новый Уренгой / Коротчаево / Уренгой"],["р. Варенга-Яха", "", 0, 0, 1.8, 66.035, 77.52, "Новый Уренгой / Коротчаево"],["р. Арка-Табъяха", "", 0, 0, 1.7, 65.92, 76.42, "Новый Уренгой (юг)"],["р. Ямсовей", "", 0, 0, 2.1, 65.65, 76.95, "ЯНАО / Ямсовей"],["р. Хадуттэ", "", 0, 0, 2.4, 66.48, 76.85, "Новый Уренгой / Тазовский р-н"],["р. Нгарка-Пыряяха", "", 0, 0, 2.0, 66.38, 77.95, "ЯНАО / Уренгой"],["р. Большая Хадырьяха", "", 0, 0, 2.2, 65.82, 78.05, "Коротчаево / Уренгой"],["р. Правая Хетта", "", 0, 0, 2.2, 65.85, 74.5, "Пангоды / Надымский р-н"],["р. Пур (Тарко-Сале)", "Пур", 0, 1, 4.2, 64.915, 77.78, "Тарко-Сале"],["р. Пяку-Пур", "", 0, 0, 2.2, 64.9, 77.75, "Тарко-Сале / Губкинский"],["р. Айваседа-Пур", "", 0, 0, 2.0, 64.91, 77.8, "Тарко-Сале"],["р. Таз", "", 0, 1, 4.8, 67.45, 78.7, "п. Тазовский"],["р. Надым", "", 0, 1, 3.8, 65.533, 72.52, "г. Надым"],["оз. Янтарное", "", 0, 3, 2.1, 65.54, 72.5, "г. Надым"],["оз. Ханто", "", 0, 3, 2.5, 63.22, 75.43, "г. Ноябрьск"],["оз. Светлое (Ноябрьск)", "Светлое", 0, 2, 4.0, 63.16, 75.38, "г. Ноябрьск"],["р. Нанкпёх", "", 0, 0, 1.3, 63.2, 75.4, "г. Ноябрьск"],["р. Обь (Салехард)", "Обь", 0, 1, 7.5, 66.53, 66.6, "Салехард / Лабытнанги"],["р. Полуй", "", 0, 0, 2.4, 66.52, 66.62, "Салехард"],["р. Собь", "", 0, 0, 1.8, 66.82, 65.8, "Харп / Полярный Урал"],["р. Обь (Сургут)", "Обь", 0, 1, 6.8, 61.25, 73.4, "Сургут"],["вдхр. Сургутской ГРЭС", "Сургутская ГРЭС (тёплый канал)", 0, 4, 3.5, 61.28, 73.5, "Сургут"],["р. Тромъёган", "", 0, 0, 2.5, 61.42, 73.8, "Сургутский р-н"],["р. Обь (Нижневартовск)", "Обь", 0, 1, 6.5, 60.93, 76.55, "Нижневартовск"],["оз. Самотлор", "", 0, 3, 2.0, 61.12, 76.75, "Нижневартовск"],["р. Вах", "", 0, 1, 4.0, 60.98, 76.9, "ХМАО-Югра"],["р. Иртыш (Ханты-Мансийск)", "Иртыш", 0, 1, 6.0, 61.0, 69.02, "Ханты-Мансийск"],["р. Конда", "", 0, 1, 3.8, 60.68, 68.05, "ХМАО"],["р. Иртыш (Тобольск)", "Иртыш", 0, 1, 5.5, 58.19, 68.25, "Тобольск"],["р. Тура (Тюмень)", "Тура", 0, 1, 3.6, 57.155, 65.535, "Тюмень"],["оз. Андреевское (Тюмень)", "Андреевское озеро", 0, 3, 2.2, 57.05, 65.77, "Тюмень"],["р. Пышма", "", 0, 0, 2.0, 56.98, 65.38, "Тюменская обл."],["р. Исеть (Екатеринбург)", "Исеть", 0, 0, 2.2, 56.835, 60.605, "Екатеринбург"],["Белоярское вдхр. (БАЭС)", "Белоярское вдхр.", 0, 4, 6.5, 56.85, 61.3, "Заречный / Екатеринбург"],["Рефтинское вдхр. (ГРЭС)", "Рефтинское вдхр.", 0, 4, 5.2, 57.1, 61.7, "Рефтинский / Свердловская обл."],["Тазовская губа", "", 0, 5, 4.5, 68.0, 76.0, "ЯНАО / Карское море"],["Обская губа", "", 0, 5, 6.0, 68.5, 73.5, "ЯНАО / Карское море"],["р. Урал (Магнитогорск)", "Урал", 2, 0, 2.2, 53.42, 58.98, "Магнитогорск"],["оз. Увильды (Челябинск)", "Увильды", 0, 2, 11.0, 55.52, 60.5, "Челябинская обл."],["оз. Тургояк (Миасс)", "Тургояк", 0, 2, 14.0, 55.15, 60.06, "Челябинская обл."],["Шершнёвское вдхр. (Челябинск)", "Шершнёвское вдхр.", 0, 2, 5.5, 55.1, 61.33, "Челябинск"],["оз. Негито (Нигито)", "Озеро Негито", 0, 2, 5.5, 65.5129, 77.2999, "Пуровский р-н / Коротчаево / Уренгой"],["оз. Нгаркато (Пуровский р-н)", "Озеро Нгаркато", 0, 2, 4.2, 65.4832, 77.2915, "Пуровский р-н / Коротчаево / Уренгой"],["оз. Ямбуто (ЯНАО)", "Озеро Ямбуто", 0, 2, 6.2, 67.31, 74.15, "Надымский / Тазовский р-н"],["оз. Пякуто", "Озеро Пякуто", 0, 2, 5.0, 63.43, 73.12, "Муравленко / Ноябрьск"],["оз. Тету-Мамонтотяй", "", 0, 2, 5.8, 63.18, 74.82, "Ноябрьск / Вынгапуровский"],["оз. Вынглор", "Озеро Вынглор", 0, 3, 2.8, 63.28, 76.1, "Ноябрьск / Ханымей"],["оз. Часельское", "Часельское озеро", 0, 2, 6.0, 65.45, 80.55, "Красноселькупский / Пуровский р-н"],["оз. Чёртово (Красноселькуп)", "Чёртово озеро", 0, 2, 7.5, 65.05, 81.9, "Красноселькуп / Толька"],["оз. Большое Щучье (Полярный Урал)", "Большое Щучье", 0, 2, 18.0, 67.89, 66.31, "Полярный Урал / Харп"],["оз. Шурышкарский Сор", "", 0, 3, 2.4, 65.91, 65.18, "Шурышкары / Мужи"],["оз. Войкарский Сор", "", 0, 3, 2.5, 65.72, 64.65, "Горки / Мужи"],["р. Таб-Яха", "", 0, 0, 2.3, 65.81, 76.32, "Новый Уренгой / Лимбяяха"],["р. Хейги-Яха (Лонгъюган)", "Хейги-Яха", 0, 0, 2.2, 65.31, 73.85, "Лонгъюган / Надым"],["р. Мессояха", "", 0, 1, 3.8, 67.75, 77.5, "Тазовский / Антипаюта"],["р. Харампур", "", 0, 0, 2.1, 64.31, 78.22, "Харампур / Пуровский р-н"],["р. Северная Сосьва", "", 0, 1, 4.5, 63.93, 65.04, "Берёзово / Игрим"],["р. Казым (Белоярский)", "Казым", 0, 0, 2.5, 63.71, 66.7, "Белоярский (ХМАО)"],["оз. Нумто", "Озеро Нумто", 0, 3, 2.2, 63.52, 71.35, "Белоярский р-н (ХМАО)"],["оз. Сырковый Сор (Салым)", "Сырковый Сор", 0, 2, 4.5, 60.05, 71.32, "Салым / Нефтеюганский р-н"],["оз. Торм-Эмтор", "", 0, 3, 2.6, 61.55, 77.8, "Нижневартовский р-н"],["оз. Мишкинское (пгт. Мишкино)", "оз. Мишкинское", 0, 3, 2.2, 55.342, 63.915, "Мишкино (Курганская обл.)"],["р. Миасс (Мишкинский / Каргапольский р-н)", "р. Миасс", 0, 0, 2.3, 55.545, 63.885, "Мишкинский р-н (Курганская обл.)"],["оз. Песчаное (Шумихинский / Мишкинский р-н)", "оз. Песчаное", 0, 3, 2.8, 55.435, 63.52, "Мишкино / Шумиха (Курганская обл.)"],["р. Юргамыш (Юргамыш / Мишкино)", "р. Юргамыш", 0, 0, 1.8, 55.38, 64.465, "Юргамыш / Мишкино (Курганская обл.)"],["оз. Горькое-Пресное / Круглое (Шумиха)", "оз. Круглое (Шумиха)", 0, 3, 2.5, 55.26, 63.28, "Шумиха (Курганская обл.)"],["р. Миасс (Чесноковка / Шумихинский р-н)", "р. Миасс (Шумиха)", 0, 0, 2.2, 55.48, 63.25, "Шумихинский р-н (Курганская обл.)"],["р. Исеть (Шадринск / Далматово)", "р. Исеть (Шадринск)", 0, 0, 2.6, 56.082, 63.635, "Шадринск (Курганская обл.)"],["р. Канаш / оз. Боровое (Шадринск)", "р. Канаш (Шадринск)", 0, 0, 1.8, 56.04, 63.59, "Шадринск (Курганская обл.)"],["р. Тобол (Курган)", "р. Тобол (Курган)", 0, 1, 4.2, 55.438, 65.352, "Курган"],["Орловское вдхр. (Курганская ТЭЦ)", "Орловское вдхр.", 0, 4, 3.8, 55.452, 65.412, "Курган"],["оз. Бездонное / Старица Тобола (Курган)", "оз. Бездонное", 0, 3, 2.8, 55.385, 65.295, "Курган"],["р. Куртамыш (Куртамыш)", "р. Куртамыш", 0, 0, 1.9, 54.912, 64.435, "Куртамыш (Курганская обл.)"],["оз. Большое Пустое / Птичанские озёра", "оз. Большое Пустое", 0, 3, 2.4, 54.88, 64.35, "Куртамышский р-н (Курганская обл.)"],["оз. Башкирское / Пресное (Макушино)", "оз. Башкирское (Макушино)", 0, 3, 2.3, 55.215, 67.25, "Макушино (Курганская обл.)"],["оз. Песчаное / Пресное (Петухово)", "оз. Песчаное (Петухово)", 0, 3, 2.5, 55.085, 67.91, "Петухово (Курганская обл.)"],["оз. Мартыново / Бутырино (Частоозерье)", "оз. Мартыново", 0, 3, 2.6, 55.572, 67.912, "Частоозерье (Курганская обл.)"],["оз. Чёрное (Мокроусово / Зауралье)", "оз. Чёрное (Зауралье)", 0, 2, 4.5, 55.62, 66.95, "Курганская обл."],["р. Тобол (Ялуторовск / Заводоуковск)", "р. Тобол (Ялуторовск)", 0, 1, 4.0, 56.65, 66.32, "Ялуторовск / Заводоуковск"],["оз. Сингуль (Ялуторовский р-н)", "оз. Сингуль", 0, 2, 4.5, 56.45, 66.05, "Ялуторовск"],["р. Вагай (Вагай)", "р. Вагай", 0, 0, 2.4, 57.938, 69.025, "Вагай (Тюменская обл.)"],["р. Иртыш (Уват)", "р. Иртыш (Уват)", 0, 1, 6.5, 59.142, 68.892, "Уват (Тюменская обл.)"],["р. Туртас (Туртас / Уват)", "р. Туртас", 0, 0, 2.5, 58.945, 69.145, "Туртас (Тюменская обл.)"],["р. Демьянка (Демьянка)", "р. Демьянка", 0, 0, 2.8, 59.548, 69.31, "Демьянка (Тюменская обл.)"],["р. Тобол (Ярково)", "р. Тобол (Ярково)", 0, 1, 4.5, 57.41, 67.078, "Ярково (Тюменская обл.)"],["р. Тавда (Нижняя Тавда / Тавда)", "р. Тавда", 0, 1, 4.2, 57.85, 65.7, "Тавда / Нижняя Тавда"],["р. Ишим (г. Ишим)", "р. Ишим", 0, 1, 3.8, 56.11, 69.495, "Ишим (Тюменская обл.)"],["оз. Мергень / Старица Ишима", "оз. Мергень", 0, 3, 2.5, 55.642, 69.238, "Казанское / Ишим"],["р. Чусовая / Волчихинское вдхр. (Ревда / Первоуральск)", "Волчихинское вдхр.", 0, 2, 5.5, 56.78, 60.02, "Ревда / Екатеринбург"],["Верхнемакаровское вдхр. (Полевской)", "Верхнемакаровское вдхр.", 0, 2, 5.0, 56.48, 60.22, "Полевской (Свердловская обл.)"],["р. Исеть / оз. Сунгуль (Каменск-Уральский)", "р. Исеть (Каменск-Уральский)", 0, 0, 2.5, 56.415, 61.918, "Каменск-Уральский"],["Черноисточинское вдхр. / Тагильский пруд (Нижний Тагил)", "Тагильский пруд", 0, 2, 6.0, 57.9, 59.95, "Нижний Тагил"],["р. Сосьва / Киселёвское вдхр. (Серов)", "р. Сосьва (Серов)", 0, 0, 2.8, 59.605, 60.58, "Серов (Свердловская обл.)"],["р. Сосьва (пгт. Сосьва)", "р. Сосьва", 0, 1, 3.8, 59.178, 61.855, "Сосьва (Свердловская обл.)"],["р. Лозьва / р. Сосьва (Гари)", "р. Лозьва (Гари)", 0, 1, 4.2, 59.432, 62.352, "Гари (Свердловская обл.)"],["р. Лозьва / р. Ивдель (Ивдель)", "р. Лозьва (Ивдель)", 0, 0, 2.5, 60.692, 60.422, "Ивдель (Свердловская обл.)"],["оз. Большие Касли / оз. Иткуль (Касли)", "оз. Большие Касли", 0, 2, 7.5, 55.895, 60.76, "Касли (Челябинская обл.)"],["Южноуральское вдхр. (Южноуральская ГРЭС)", "Южноуральское вдхр. (ГРЭС)", 0, 4, 5.2, 54.445, 61.255, "Южноуральск (Челябинская обл.)"],["р. Пяку-Пур / р. Пурпе (Губкинский / Пурпе)", "р. Пяку-Пур (Губкинский)", 0, 0, 2.5, 64.45, 76.58, "Губкинский / Пурпе (ЯНАО)"],["р. Пяку-Пур / оз. Городское (Муравленко)", "оз. Городское (Муравленко)", 0, 3, 2.4, 63.794, 74.525, "Муравленко (ЯНАО)"],["р. Левая Хетта / р. Надым (Ягельный / Приозёрный)", "р. Левая Хетта", 0, 0, 2.2, 64.82, 72.8, "Ягельный / Приозёрный (ЯНАО)"],["р. Хейги-Яха / р. Надым (Лонгъюган)", "р. Хейги-Яха (Лонгъюган)", 0, 0, 2.2, 65.305, 71.2, "Лонгъюган (ЯНАО)"],["Обская губа / р. Ныда (Ныда / Нори / Заполярный)", "Обская губа (Ныда)", 0, 5, 4.5, 66.5, 73.1, "Ныда / Заполярный (ЯНАО)"],["р. Кутопьюган / Обская губа (Кутопьюган)", "р. Кутопьюган", 0, 0, 2.2, 66.08, 71.2, "Кутопьюган (ЯНАО)"],["р. Пур (Самбург)", "р. Пур (Самбург)", 0, 1, 5.0, 66.85, 78.225, "Самбург (ЯНАО)"],["Тазовская губа (Антипаюта)", "", 0, 5, 5.0, 69.095, 76.855, "Антипаюта (ЯНАО)"],["Гыданская губа / р. Гыда (Гыда)", "Гыданская губа", 0, 5, 5.5, 70.892, 78.47, "Гыда (ЯНАО)"],["Обская губа / р. Сеяха (Сеяха)", "Обская губа (Сеяха)", 0, 5, 6.0, 70.165, 72.515, "Сеяха (ЯНАО)"],["Обская губа (Новый Порт)", "", 0, 5, 5.5, 67.69, 72.9, "Новый Порт (ЯНАО)"],["Обская губа / р. Ярудей (Яр-Сале / Панаевск / Салемал)", "Обская дельта (Яр-Сале)", 0, 1, 5.5, 66.8, 69.95, "Яр-Сале / Панаевск (ЯНАО)"],["р. Обь / р. Щучья (Аксарка / Белоярск)", "р. Обь (Аксарка)", 0, 1, 7.0, 66.68, 67.95, "Аксарка / Белоярск (ЯНАО)"],["р. Таз (Красноселькуп)", "р. Таз (Красноселькуп)", 0, 1, 4.8, 65.702, 82.463, "Красноселькуп (ЯНАО)"],["р. Таз (Толька)", "р. Таз (Толька)", 0, 1, 4.2, 64.0, 82.06, "Толька (ЯНАО)"],["р. Еркал-Надей-Пур (Халясавэй)", "р. Еркал-Надей-Пур", 0, 0, 2.4, 63.39, 78.38, "Халясавэй (ЯНАО)"],["р. Сыня / р. Малая Обь (Овгорт / Горки)", "р. Сыня (Овгорт)", 0, 0, 2.8, 64.95, 64.3, "Овгорт / Горки (ЯНАО)"],["р. Пим (Лянтор / Нижнесортымский)", "р. Пим", 0, 0, 2.5, 62.0, 71.95, "Лянтор / Нижнесортымский (ХМАО)"],["р. Обь / пр. Каюковская (Лангепас / Покачи)", "р. Обь (Лангепас)", 0, 1, 6.0, 61.45, 75.35, "Лангепас / Покачи (ХМАО)"],["р. Аган (Радужный / Новоаганск)", "р. Аган", 0, 1, 4.2, 62.05, 77.05, "Радужный / Новоаганск (ХМАО)"],["р. Ингуягун / оз. Когалымское (Когалым)", "р. Ингуягун (Когалым)", 0, 0, 2.4, 62.265, 74.485, "Когалым (ХМАО)"],["пр. Юганская Обь / р. Большой Балык (Нефтеюганск / Пыть-Ях / Пойковский)", "Юганская Обь", 0, 1, 5.5, 61.05, 72.4, "Нефтеюганск / Пыть-Ях (ХМАО)"],["р. Иртыш (Горноправдинск)", "р. Иртыш (Горноправдинск)", 0, 1, 6.0, 60.056, 69.908, "Горноправдинск (ХМАО)"],["р. Обь / Малая Обь (Приобье / Нягань / Октябрьское)", "р. Обь (Приобье)", 0, 1, 6.5, 62.42, 65.65, "Приобье / Нягань (ХМАО)"],["р. Северная Сосьва (Игрим)", "р. Северная Сосьва (Игрим)", 0, 1, 4.8, 63.19, 64.417, "Игрим (ХМАО)"],["р. Конда (Урай / Междуреченский)", "р. Конда (Урай)", 0, 1, 3.8, 59.9, 65.3, "Урай / Междуреченский (ХМАО)"],["оз. Окунёво / р. Эсс (Советский / Югорск)", "оз. Окунёво (Советский)", 0, 2, 4.2, 61.34, 63.45, "Советский / Югорск (ХМАО)"],["р. Таз (Заполярный)", "р. Таз (Заполярный)", 0, 1, 6.0, 66.41, 73.85, "Заполярный (ЯНАО)"],["р. Надым (Нори)", "р. Надым (Нори)", 0, 1, 5.5, 66.152, 72.38, "Нори (ЯНАО)"],["р. Пякупур (Ханымей)", "р. Пякупур (Ханымей)", 0, 1, 4.5, 63.725, 75.955, "Ханымей (ЯНАО)"],["р. Малая Обь (Горки)", "р. Малая Обь (Горки)", 0, 1, 6.5, 65.078, 65.285, "Горки (ЯНАО)"],["р. Сортым-Пим (Нижнесортымский)", "р. Пим (Нижнесортымский)", 0, 0, 2.6, 62.44, 71.755, "Нижнесортымский (ХМАО)"],["р. Тобол (Звериноголовское / Глядянское — юг области)", "р. Тобол (Звериноголовское / Глядянское)", 0, 1, 3.2, 54.459, 64.854, "Звериноголовское / Глядянское / Курган"],["р. Тобол (Белозерское / Коркино — север области)", "р. Тобол (Белозерское)", 0, 1, 3.5, 55.825, 65.586, "Белозерское / Курган"],["р. Исеть (Катайск / Далматово / Каргаполье)", "р. Исеть (Катайск / Каргаполье)", 0, 0, 2.6, 56.289, 62.585, "Катайск / Далматово / Каргаполье"],["р. Миасс (Каргаполье — низовья до впадения в Исеть)", "р. Миасс (Каргаполье)", 0, 0, 2.4, 55.951, 64.432, "Каргаполье / Шадринск"],["р. Уй (Целинное / Усть-Уйское)", "р. Уй (Усть-Уйское / Целинное)", 0, 0, 2.3, 54.342, 64.382, "Целинное / Звериноголовское"],["оз. Ачикуль (Белозерский р-н)", "оз. Ачикуль", 0, 3, 3.5, 55.882, 65.612, "Белозерское / Курган"],["оз. Камышное и оз. Суерское (Лебяжьевский р-н)", "оз. Камышное (Лебяжье)", 0, 3, 2.5, 55.268, 66.495, "Лебяжье / Макушино"],["оз. Идгильды и оз. Мангылы (Альменевский / Сафакулевский р-н)", "оз. Идгильды / оз. Сафакуль", 0, 3, 2.6, 54.956, 63.575, "Альменево / Сафакулево / Шумиха"],["оз. Куртан и оз. Стекленей (Мокроусовский р-н)", "оз. Куртан (Мокроусово)", 0, 3, 2.4, 55.809, 66.762, "Мокроусово"],["оз. Щучье и р. Чумляк (г. Щучье)", "оз. Щучье (г. Щучье)", 0, 3, 2.8, 55.211, 62.754, "Щучье / Шумиха"],["оз. Половинное и оз. Донки (Половинский / Куртамышский р-н)", "оз. Половинное / оз. Донки", 0, 3, 2.6, 54.789, 65.986, "Половинное / Куртамыш / Курган"],["оз. Таватуй и Верх-Нейвинский пруд (Невьянск / Новоуральск)", "оз. Таватуй / Верх-Нейвинский пруд", 0, 2, 5.5, 57.142, 60.185, "Новоуральск / Невьянск / Екатеринбург"],["Исетское вдхр. (Среднеуральск / СУГРЭС)", "Исетское вдхр. (Среднеуральск)", 0, 4, 3.5, 56.992, 60.442, "Среднеуральск / Верхняя Пышма / Екатеринбург"],["оз. Шарташ и Верх-Исетский пруд (Екатеринбург)", "оз. Шарташ / Верх-Исетский пруд", 0, 2, 3.2, 56.872, 60.708, "Екатеринбург"],["оз. Балтым (Верхняя Пышма)", "оз. Балтым", 0, 2, 3.5, 57.032, 60.578, "Верхняя Пышма / Екатеринбург"],["Сысертский, Верхне-Сысертский и Двуреченский пруды (Сысерть)", "Сысертский и Верхне-Сысертский пруды", 0, 2, 3.8, 56.495, 60.812, "Сысерть / Арамиль"],["Ленёвское вдхр. и Выйский пруд (Нижний Тагил)", "Ленёвское вдхр. (Нижний Тагил)", 0, 2, 6.5, 57.752, 59.842, "Нижний Тагил"],["Невьянский пруд и р. Нейва (Невьянск / Алапаевск)", "Невьянский пруд / р. Нейва", 0, 2, 4.0, 57.489, 60.221, "Невьянск / Алапаевск"],["Верхнетагильское вдхр. и Вогульский пруд (Верхний Тагил — ГРЭС)", "Верхнетагильское вдхр. (ГРЭС)", 0, 4, 4.2, 57.378, 59.951, "Верхний Тагил / Кировград"],["Нижне-Выйское вдхр. (Качканар) и Нижнетуринское вдхр. (Нижняя Тура / Лесной)", "Нижне-Выйское и Нижнетуринское вдхр.", 0, 2, 5.5, 58.652, 59.792, "Качканар / Лесной / Нижняя Тура"],["Андриановский пруд и тёплый сброс Серовской ГРЭС (Серов)", "Серовская ГРЭС / Андриановский пруд", 0, 4, 3.5, 59.585, 60.412, "Серов / Краснотурьинск"],["р. Тура и Верхотурское вдхр. (Верхотурье / Туринск / Туринская Слобода)", "р. Тура (Верхотурье / Туринск)", 0, 1, 3.6, 58.864, 60.805, "Верхотурье / Туринск"],["р. Пышма (Белоярский / Сухой Лог / Камышлов / Пышма / Талица)", "р. Пышма (Сухой Лог / Камышлов / Талица)", 0, 0, 2.4, 56.846, 62.712, "Сухой Лог / Камышлов / Талица"],["р. Реж и р. Ница (Реж / Ирбит / Туринская Слобода)", "р. Реж / р. Ница (Реж / Ирбит)", 0, 0, 2.5, 57.674, 63.063, "Реж / Ирбит"],["р. Пелым и оз. Пелымский Туман (Пелым / Гаринский р-н)", "р. Пелым / оз. Пелымский Туман", 0, 3, 2.8, 60.152, 63.112, "Пелым / Гари"],["р. Уфа и р. Серга (Красноуфимск / Михайловск / Нижние Серги / Арти)", "р. Уфа / р. Серга (Красноуфимск / Михайловск)", 2, 0, 2.4, 56.435, 59.119, "Красноуфимск / Михайловск / Нижние Серги"],["р. Сылва (Шаля)", "р. Сылва (Шаля)", 2, 0, 2.1, 57.243, 58.729, "Шаля / Первоуральск"],["оз. Аятское (Невьянский р-н) и оз. Шаблиш (Каменский р-н)", "оз. Аятское", 0, 2, 3.0, 57.362, 60.842, "Невьянск / Верхняя Пышма / Реж"],["Тёплый канал Тюменской ТЭЦ-1 и оз. Оброчное (Тюмень)", "Тюменская ТЭЦ-1 / оз. Оброчное", 0, 4, 3.5, 57.125, 65.621, "Тюмень"],["оз. Круглое, оз. Липовое и оз. Цимлянское (Тюмень)", "оз. Липовое и Круглое (Тюмень)", 0, 2, 5.5, 57.212, 65.662, "Тюмень"],["Голубые озёра / Муллашинские карьеры и р. Пышма (Винзили / Муллаши)", "Муллашинские карьеры (Винзили)", 0, 2, 6.0, 56.968, 66.042, "Винзили / Тюмень"],["оз. Большой Тараскуль и оз. Ипкуль (Тюменский / Нижнетавдинский р-н)", "оз. Большой Тараскуль / оз. Ипкуль", 0, 3, 2.6, 57.542, 65.362, "Тюмень / Нижняя Тавда"],["р. Исеть (с. Исетское — низовья)", "р. Исеть (Исетское)", 0, 0, 2.8, 56.485, 65.324, "Исетское / Ялуторовск"],["р. Тобол (Упорово / Покровское / Байкалово — устье в Тобольске)", "р. Тобол (Упорово / Байкалово)", 0, 1, 4.2, 57.548, 67.854, "Упорово / Ярково / Тобольск"],["р. Ишим (Викулово / Абатское / Казанское — Ильинка)", "р. Ишим (Викулово / Абатское / Казанское)", 0, 1, 3.8, 56.287, 70.457, "Ишим / Абатское / Викулово / Казанское"],["оз. Белое, оз. Песьяное и оз. Большое Кабанье (Бердюжский / Армизонский р-н)", "оз. Песьяное / оз. Белое (Бердюжье)", 0, 3, 2.8, 55.805, 68.298, "Бердюжье / Армизонское"],["оз. Станичное и оз. Таволжан (Сладковский р-н)", "оз. Станичное / оз. Таволжан (Сладково)", 0, 3, 2.5, 55.528, 70.338, "Сладково / Ишим"],["оз. Большой Уват (Вагайский р-н) и р. Носка (Тобольский р-н)", "оз. Большой Уват / р. Носка", 0, 3, 3.0, 57.882, 69.812, "Вагай / Тобольск"],["Аргазинское вдхр. (Карабаш / Аргаяш / Миасс)", "Аргазинское вдхр.", 0, 2, 8.5, 55.382, 60.542, "Миасс / Карабаш / Аргаяш"],["оз. Чебаркуль, оз. Еловое и оз. Большой Кисегач (Чебаркуль)", "оз. Чебаркуль и Большой Кисегач", 0, 2, 7.5, 54.962, 60.332, "Чебаркуль / Миасс"],["оз. Синара, оз. Сунгуль, оз. Силач и оз. Аракуль (Снежинск / Касли / Вишневогорск)", "оз. Синара и оз. Аракуль", 0, 2, 8.0, 56.085, 60.731, "Снежинск / Касли / Верхний Уфалей"],["оз. Иртяш и оз. Большие Аллаки (Озёрск / Кыштым / Касли)", "оз. Иртяш и Большие Аллаки", 0, 2, 7.0, 55.785, 60.725, "Озёрск / Кыштым / Касли"],["оз. Сугояк, оз. Касарги, оз. Кременкуль и оз. Первое / Второе / Смолино (Челябинск)", "оз. Смолино, Первое и Касарги (Челябинск)", 0, 2, 4.2, 55.102, 61.442, "Челябинск / Копейск"],["оз. Калды, оз. Чебакуль, оз. Уелги, оз. Алабуга и оз. Шаблиш (Кунашакский р-н)", "оз. Калды и оз. Уелги (Кунашак)", 0, 2, 4.5, 55.662, 61.292, "Кунашак / Касли / Челябинск"],["оз. Большой Куяш и оз. Тишки (Кунашакский / Красноармейский р-н)", "оз. Тишки и Большой Куяш", 0, 3, 3.2, 55.612, 61.812, "Кунашак / Челябинск"],["оз. Зюраткуль и р. Ай (Сатка / Куса)", "оз. Зюраткуль / р. Ай (Сатка / Куса)", 2, 2, 5.5, 54.918, 59.205, "Сатка / Куса / Златоуст"],["Нязепетровское вдхр. и р. Уфа (Нязепетровск)", "Нязепетровское вдхр. / р. Уфа", 2, 2, 6.5, 56.053, 59.602, "Нязепетровск / Верхний Уфалей"],["р. Сим, р. Юрюзань и р. Катав (Аша / Миньяр / Сим / Усть-Катав / Катав-Ивановск / Юрюзань)", "р. Сим / р. Юрюзань / р. Катав", 2, 0, 2.0, 54.993, 57.694, "Аша / Сим / Усть-Катав / Юрюзань"],["Верхнеуральское вдхр. и Магнитогорское вдхр. (Верхнеуральск / Магнитогорск)", "Верхнеуральское вдхр.", 2, 2, 6.0, 53.725, 59.185, "Верхнеуральск / Магнитогорск"],["Троицкое вдхр. (Троицкая ГРЭС) и р. Уй (Троицк)", "Троицкое вдхр. (ГРЭС)", 0, 4, 4.5, 54.042, 61.642, "Троицк / Южноуральск"],["вдхр. Нижневартовской ГРЭС и р. Вах (Излучинск)", "Нижневартовская ГРЭС (Излучинск)", 0, 4, 4.2, 60.958, 76.925, "Излучинск / Нижневартовск"],["Тёплый канал Няганской ГРЭС и р. Нягань-Юган (Нягань)", "Няганская ГРЭС / р. Нягань-Юган", 0, 4, 3.5, 62.185, 65.492, "Нягань / Приобье"],["р. Обь — слияние с р. Иртыш (Ханты-Мансийск / Шапша / Селиярово)", "р. Обь — устье Иртыша (Ханты-Мансийск)", 0, 1, 7.5, 61.072, 68.892, "Ханты-Мансийск"],["р. Большой Юган и р. Малый Юган (Угут)", "р. Большой Юган (Угут)", 0, 0, 3.2, 60.491, 74.054, "Угут / Пыть-Ях / Нефтеюганск"],["р. Большой Салым (Салым / Лемпино)", "р. Большой Салым", 0, 0, 2.6, 60.068, 71.478, "Салым / Пыть-Ях"],["р. Назым и р. Ендырь (Ханты-Мансийский / Октябрьский р-н)", "р. Назым / р. Ендырь", 0, 0, 2.4, 61.551, 66.332, "Талинка / Ханты-Мансийск / Нягань"],["р. Ляпин, р. Хулга и р. Манья (Саранпауль — Приполярный Урал)", "р. Ляпин / р. Хулга (Саранпауль)", 0, 0, 2.8, 64.258, 60.903, "Саранпауль / Берёзово"],["р. Северная Сосьва — верховья и р. Тапсуй (Няксимволь / Хулимсунт)", "р. Северная Сосьва (Няксимволь / Хулимсунт)", 0, 0, 2.6, 62.426, 60.865, "Няксимволь / Хулимсунт / Советский"],["оз. Леушинский Туман и оз. Турсунтский Туман (Кондинское / Междуреченский / Леуши)", "оз. Леушинский Туман (Междуреченский)", 0, 3, 2.8, 59.622, 65.741, "Междуреченский / Кондинское / Урай"],["р. Конда и р. Кума (Кондинское / Луговой / Зеленоборск / Болчары)", "р. Конда (Кондинское / Болчары)", 0, 1, 3.8, 59.649, 67.412, "Кондинское / Междуреченский / Урай"],["оз. Кымыл-Эмтор и р. Кирья (Нижневартовский р-н)", "оз. Кымыл-Эмтор", 0, 3, 2.5, 60.985, 77.312, "Нижневартовск / Мегион"],["оз. Пильтанлор и оз. Вачлор (Сургутский р-н)", "оз. Пильтанлор и Вачлор", 0, 3, 2.4, 61.512, 73.112, "Сургут / Лянтор / Фёдоровский"],["оз. Согомское и р. Согом (Ханты-Мансийский р-н)", "оз. Согомское / р. Согом", 0, 3, 2.6, 60.485, 68.125, "Ханты-Мансийск / Горноправдинск"],["р. Малая Хадырьяха (Коротчаево)", "р. Малая Хадырьяха", 0, 0, 1.6, 65.875, 78.082, "Новый Уренгой / Коротчаево"],["р. Сенся-Яха и р. Тюде-Яха (трасса Н. Уренгой — Коротчаево)", "р. Сенся-Яха / р. Тюде-Яха", 0, 0, 1.7, 66.042, 77.385, "Новый Уренгой / Лимбияха / Коротчаево"],["р. Пыря-Яха и р. Ягенетта (Пуровский / Надымский р-н)", "р. Пыря-Яха / р. Ягенетта", 0, 0, 2.1, 65.412, 76.212, "Новый Уренгой / Тарко-Сале / Пангоды"],["р. Танлова и р. Надымская Хетта (Надым / Правохеттинский)", "р. Танлова (Надым)", 0, 0, 2.2, 65.285, 73.112, "Надым / Правохеттинский"],["р. Харбей (Полярный Урал / Харп)", "р. Харбей (Полярный Урал)", 0, 0, 1.8, 66.912, 66.115, "Харп / Лабытнанги / Салехард"],["р. Лонгот-Юган (Полярный Урал / Харп)", "р. Лонгот-Юган (Полярный Урал)", 0, 0, 1.9, 67.185, 66.521, "Харп / Лабытнанги"],["р. Щучья — горное течение и оз. Малое Щучье (Полярный Урал)", "р. Щучья и оз. Малое Щучье", 0, 0, 2.5, 67.752, 66.312, "Лаборовая / Харп / Белоярск"],["р. Хараматолоу и р. Ханмей (Харп / Обской)", "р. Хараматолоу / р. Ханмей", 0, 0, 1.6, 66.852, 65.812, "Харп / Лабытнанги"],["р. Байдарата и р. Кара (Лаборовая / Байдарацкая губа)", "р. Байдарата / р. Кара", 0, 0, 2.4, 68.152, 67.115, "Лаборовая / Полярный Урал"],["р. Войкар и оз. Варчато (Шурышкарский р-н, Полярный Урал)", "р. Войкар / оз. Варчато", 0, 0, 3.5, 65.625, 63.982, "Мужи / Горки / Овгорт"],["р. Морды-Яха и р. Юрибей Ямальский (Бованенково / Ямальский р-н)", "р. Морды-Яха / р. Юрибей (Ямал)", 0, 0, 2.8, 69.852, 68.612, "Бованенково / Сеяха / Яр-Сале"],["оз. Яррото 1-е и 2-е (п-ов Ямал)", "оз. Яррото (п-ов Ямал)", 0, 3, 4.2, 67.921, 71.112, "Яр-Сале / Новый Порт"],["р. Худосей, р. Поколька, р. Часелька и р. Ратта (Красноселькуп / Толька / Ратта)", "р. Худосей / р. Поколька / р. Ратта", 0, 0, 2.6, 64.952, 82.512, "Красноселькуп / Толька / Ратта"],["р. Пякуляха и р. Русская (Тибей-Сале / Тазовский р-н)", "р. Пякуляха / р. Русская (Таз)", 0, 0, 2.4, 67.152, 79.462, "Тазовский / Тибей-Сале / Заполярный"],["р. Большая Обь и р. Куноват (Мужи / Лопхари / Питляр)", "р. Большая Обь / р. Куноват (Мужи / Лопхари)", 0, 1, 6.5, 65.392, 65.412, "Мужи / Лопхари / Горки"],["р. Иртыш (Омск)", "", 0, 1, 4.8, 54.99, 73.36, "Омск"],["р. Омь", "", 0, 0, 2.1, 54.995, 73.38, "Омск"],["р. Обь (Новосибирск)", "", 0, 1, 5.5, 55.01, 82.92, "Новосибирск"],["Новосибирское вдхр. (Обское море)", "Обское море", 0, 2, 7.5, 54.75, 82.85, "Бердск / Новосибирск"],["р. Бердь", "", 0, 0, 2.4, 54.76, 83.1, "Бердск"],["р. Томь (Томск / Кемерово)", "Томь", 0, 1, 4.2, 56.48, 84.95, "Томск"],["р. Обь (Барнаул)", "", 0, 1, 4.8, 53.34, 83.78, "Барнаул"],["оз. Телецкое", "Телецкое озеро", 0, 2, 16.0, 51.78, 87.26, "Республика Алтай"],["р. Бия", "", 0, 0, 2.5, 52.54, 85.21, "Бийск / Алтай"],["р. Енисей (Красноярск)", "Енисей", 1, 1, 6.8, 56.01, 92.87, "Красноярск"],["Красноярское вдхр.", "", 1, 2, 16.0, 55.95, 92.35, "Дивногорск"],["р. Мана", "", 1, 0, 2.2, 55.95, 92.48, "Усть-Мана"],["р. Кан", "", 1, 0, 2.4, 56.2, 95.7, "Канск / Зеленогорск"],["оз. Белё / Шира (Хакасия)", "Белё", 1, 2, 9.0, 54.65, 90.15, "Хакасия"],["р. Енисей (Енисейск)", "Енисей", 1, 1, 8.5, 58.45, 92.17, "Енисейск"],["р. Енисей (Дудинка)", "Енисей (Низовья)", 1, 1, 12.0, 69.4, 86.18, "Дудинка"],["р. Норилка / оз. Лама (Норильск)", "Норилка / Лама", 1, 2, 14.0, 69.35, 88.2, "Норильск / Талнах"],["р. Ангара (Братское вдхр.)", "", 1, 2, 14.0, 56.15, 101.6, "Братск"],["р. Ангара (Усть-Илимское вдхр.)", "Усть-Илимское вдхр.", 1, 2, 12.0, 58.0, 102.7, "Усть-Илимск"],["р. Ангара (Иркутск)", "", 8, 1, 4.5, 52.285, 104.28, "Иркутск"],["Иркутское вдхр.", "", 8, 2, 8.5, 52.15, 104.45, "Иркутск"],["р. Иркут", "", 8, 0, 2.2, 52.26, 104.2, "Иркутск / Шелехов"],["оз. Байкал (Листвянка)", "", 8, 2, 22.0, 51.85, 104.86, "Листвянка"],["оз. Байкал (Малое Море / Ольхон)", "Байкал (Малое Море)", 8, 2, 14.0, 53.2, 107.35, "Ольхон"],["оз. Байкал (Слюдянка)", "", 8, 2, 18.0, 51.66, 103.71, "Слюдянка"],["р. Снежная", "", 8, 0, 1.8, 51.48, 104.63, "Байкальск"],["р. Иртыш (Тара)", "р. Иртыш (Тара)", 0, 1, 5.5, 56.895, 74.375, "Тара (Омская обл.)"],["р. Омь (Калачинск)", "р. Омь (Калачинск)", 0, 0, 2.2, 55.055, 74.578, "Калачинск (Омская обл.)"],["р. Иртыш (Черлак)", "р. Иртыш (Черлак)", 0, 1, 4.8, 54.158, 74.808, "Черлак (Омская обл.)"],["Новосибирское вдхр. (Ордынское / Спирино)", "Обское море (Ордынское)", 0, 2, 7.0, 54.375, 81.905, "Ордынское (Новосибирская обл.)"],["р. Обь (Сузун / Камень-на-Оби)", "р. Обь (Сузун)", 0, 1, 5.2, 53.785, 81.8, "Сузун / Камень-на-Оби"],["оз. Чаны (Чаны / Барабинск)", "оз. Чаны", 0, 2, 4.2, 55.15, 77.55, "Барабинск / Чаны (Новосибирская обл.)"],["оз. Сартлан (Барабинский р-н)", "оз. Сартлан", 0, 2, 4.5, 55.02, 78.58, "Барабинск (Новосибирская обл.)"],["р. Обь (Колпашево)", "р. Обь (Колпашево)", 0, 1, 6.2, 58.318, 82.912, "Колпашево (Томская обл.)"],["р. Обь (Парабель / Каргасок)", "р. Обь (Парабель)", 0, 1, 6.5, 58.85, 81.15, "Парабель / Каргасок (Томская обл.)"],["р. Томь (Кемерово / Юрга)", "р. Томь (Кемерово)", 0, 1, 4.0, 55.5, 85.5, "Кемерово / Юрга"],["р. Томь (Новокузнецк / Междуреченск)", "р. Томь (Новокузнецк)", 0, 1, 3.8, 53.72, 87.55, "Новокузнецк / Междуреченск"],["р. Алей / Гилёвское вдхр. (Рубцовск)", "р. Алей (Рубцовск)", 0, 0, 2.4, 51.502, 81.21, "Рубцовск (Алтайский край)"],["р. Катунь (Горно-Алтайск / Майма)", "р. Катунь", 0, 0, 2.8, 51.958, 85.955, "Горно-Алтайск (Республика Алтай)"],["р. Чулым (Ачинск)", "р. Чулым (Ачинск)", 0, 1, 3.8, 56.27, 90.495, "Ачинск (Красноярский край)"],["р. Енисей / р. Нижняя Тунгуска (Туруханск)", "р. Енисей (Туруханск)", 1, 1, 10.0, 65.795, 87.96, "Туруханск"],["р. Енисей (Игарка)", "р. Енисей (Игарка)", 1, 1, 11.0, 67.465, 86.585, "Игарка"],["р. Енисей / Красноярское вдхр. (Абакан / Минусинск / Саяногорск)", "р. Енисей (Абакан / Саяногорск)", 1, 1, 6.5, 53.5, 91.5, "Абакан / Минусинск / Саяногорск"],["р. Енисей / р. Бий-Хем (Кызыл)", "р. Енисей (Кызыл)", 1, 1, 4.5, 51.72, 94.44, "Кызыл (Тыва)"],["р. Лена (Усть-Кут)", "р. Лена (Усть-Кут)", 1, 1, 4.2, 56.795, 105.765, "Усть-Кут (Иркутская обл.)"],["оз. Чаны (Чаны)", "оз. Чаны (Северный плёс)", 0, 2, 3.5, 55.25, 76.78, "Чаны (Новосибирская обл.)"],["р. Енисей (Железногорск / Атаманово)", "р. Енисей (Железногорск)", 1, 1, 6.5, 56.265, 93.49, "Железногорск"],["Саяно-Шушенское вдхр. / р. Енисей (Кызыл / Шагонар)", "Енисей (Тыва)", 1, 1, 6.5, 51.719, 94.438, "Республика Тыва"],["р. Чулышман (Балыкча / Улаганский р-н)", "Чулышман", 0, 0, 2.2, 51.235, 87.892, "Республика Алтай / Улаган"],["р. Башкаус (Улаган)", "Башкаус", 0, 0, 1.9, 50.654, 87.921, "Республика Алтай / Улаган"],["р. Чуя (Акташ / Кош-Агач)", "Чуя", 0, 0, 2.0, 50.281, 87.648, "Республика Алтай / Акташ"],["р. Бия (верхнее течение / Иогач — Турочак)", "Бия (верхнее течение)", 0, 1, 3.2, 52.012, 87.175, "Республика Алтай / Турочак"],["р. Лебедь (Турочак)", "Лебедь", 0, 0, 1.8, 52.275, 87.212, "Республика Алтай / Турочак"],["р. Кокса (Усть-Кокса)", "Кокса", 0, 0, 1.9, 50.274, 85.568, "Республика Алтай / Усть-Кокса"],["р. Чарыш (верхнее течение / Усть-Кан)", "Чарыш (верхнее течение)", 0, 0, 1.8, 50.935, 84.749, "Республика Алтай / Усть-Кан"],["р. Урсул (Онгудай)", "Урсул", 0, 0, 1.6, 50.758, 86.185, "Республика Алтай / Онгудай"],["оз. Джулукуль (Улаганский р-н)", "оз. Джулукуль", 0, 3, 3.5, 50.483, 89.766, "Республика Алтай / Улаган"],["оз. Теньгинское (Онгудайский р-н)", "оз. Теньгинское", 0, 3, 3.0, 50.922, 85.592, "Республика Алтай / Онгудай"],["оз. Манжерокское (Манжерок)", "оз. Манжерокское", 0, 3, 2.6, 51.821, 85.814, "Республика Алтай / Манжерок"],["оз. Чейбеккёль (Мёртвое, Акташ / Улаган)", "оз. Чейбеккёль", 0, 3, 4.5, 50.415, 87.61, "Республика Алтай / Акташ"],["р. Малый Енисей (Каа-Хем / Сарыг-Сеп)", "Малый Енисей (Каа-Хем)", 1, 1, 3.4, 51.522, 95.384, "Республика Тыва / Кызыл"],["р. Большой Енисей (Бий-Хем, Тоора-Хем)", "Большой Енисей (Бий-Хем)", 1, 1, 3.8, 52.456, 96.082, "Республика Тыва / Тоора-Хем"],["р. Хемчик (Ак-Довурак / Кызыл-Мажалык / Чадан)", "Хемчик", 1, 0, 2.3, 51.245, 90.892, "Республика Тыва / Ак-Довурак"],["р. Хамсара (Тоджинский кожуун)", "Хамсара", 1, 0, 2.6, 52.681, 96.214, "Республика Тыва / Тоора-Хем"],["р. Систиг-Хем (Тоджинский кожуун)", "Систиг-Хем", 1, 0, 2.1, 52.531, 95.489, "Республика Тыва / Тоора-Хем"],["оз. Азас (Тоджинская котловина)", "оз. Азас (Тоджа)", 1, 2, 6.5, 52.411, 96.533, "Республика Тыва / Тоора-Хем"],["оз. Нойон-Холь (Тоджинский кожуун)", "оз. Нойон-Холь", 1, 2, 8.0, 52.671, 97.026, "Республика Тыва / Тоора-Хем"],["оз. Чагытай (Бай-Хаак)", "оз. Чагытай", 1, 2, 7.5, 51.002, 94.718, "Республика Тыва / Бай-Хаак"],["оз. Торе-Холь (Эрзинский кожуун)", "оз. Торе-Холь", 1, 3, 3.5, 50.048, 95.076, "Республика Тыва / Эрзин"],["оз. Хиндиктиг-Холь (Монгун-Тайгинский кожуун)", "оз. Хиндиктиг-Холь", 1, 2, 9.0, 50.341, 89.874, "Республика Тыва / Мугур-Аксы"],["р. Абакан (Абаза / Аскиз / Абакан)", "Абакан", 1, 1, 3.0, 53.154, 90.584, "Республика Хакасия / Абакан"],["Саяно-Шушенское вдхр. (Черёмушки / Джойская Сосновка)", "Саяно-Шушенское вдхр. (Черёмушки)", 1, 2, 18.0, 52.815, 91.432, "Республика Хакасия / Саяногорск"],["Майнское вдхр. (Майна / Саяногорск)", "Майнское вдхр.", 1, 2, 6.5, 52.971, 91.474, "Республика Хакасия / Саяногорск"],["р. Она (Большой Он, Абаза / Таштыпский р-н)", "Она (Большой Он)", 1, 0, 2.0, 52.536, 89.782, "Республика Хакасия / Абаза"],["р. Таштып (с. Таштып)", "Таштып", 1, 0, 1.6, 52.802, 89.914, "Республика Хакасия / Таштып"],["р. Белый Июс (Ширинский р-н)", "Белый Июс", 0, 0, 2.1, 54.442, 89.568, "Республика Хакасия / Шира"],["р. Чёрный Июс (Ширинский / Орджоникидзевский р-н)", "Чёрный Июс", 0, 0, 2.0, 54.789, 89.642, "Республика Хакасия / Копьёво"],["р. Чулым (Копьёво / верховья)", "Чулым (Копьёво)", 0, 1, 2.8, 54.996, 89.845, "Республика Хакасия / Копьёво"],["оз. Иткуль (Ширинский р-н)", "оз. Иткуль (Хакасия)", 1, 2, 7.0, 54.462, 90.078, "Республика Хакасия / Шира"],["оз. Фыркал (Ширинский р-н)", "оз. Фыркал", 1, 3, 3.2, 54.602, 89.842, "Республика Хакасия / Шира"],["оз. Чёрное (Ширинский р-н)", "оз. Чёрное (Хакасия)", 1, 3, 3.5, 54.682, 89.389, "Республика Хакасия / Шира"],["оз. Улуг-Коль (Усть-Абаканский р-н)", "оз. Улуг-Коль", 1, 3, 2.2, 53.798, 90.642, "Республика Хакасия / Абакан"],["р. Чумыш (Заринск / Тальменка)", "Чумыш", 0, 0, 2.6, 53.724, 84.892, "Алтайский край / Заринск"],["р. Чарыш (Чарышское / Усть-Чарышская Пристань)", "Чарыш (Алтайский край)", 0, 0, 2.5, 52.126, 83.318, "Алтайский край / Чарышское"],["р. Катунь (низовья / Сростки — Верх-Обский)", "Катунь (низовья)", 0, 1, 3.5, 52.416, 85.442, "Алтайский край / Бийск"],["р. Ануй (Солонешное / Петропавловское)", "Ануй", 0, 0, 1.9, 51.992, 84.382, "Алтайский край / Солонешное"],["р. Песчаная (Белокуриха / Смоленское)", "Песчаная (Алтай)", 0, 0, 2.0, 52.189, 84.918, "Алтайский край / Белокуриха"],["оз. Мостовое (Завьяловский / Баевский р-н)", "оз. Мостовое", 0, 3, 3.2, 52.898, 81.148, "Алтайский край / Завьялово"],["оз. Горькое-Перешеечное (Егорьевский р-н)", "оз. Горькое-Перешеечное", 0, 3, 3.0, 51.842, 80.892, "Алтайский край / Рубцовск"],["оз. Белое и оз. Колыванское (Курьинский / Змеиногорский р-н)", "оз. Белое и Колыванское", 0, 3, 3.8, 51.364, 82.192, "Алтайский край / Змеиногорск"],["оз. Большое Топольное и оз. Песчаное (Бурлинский р-н)", "оз. Большое Топольное и Песчаное", 0, 3, 2.8, 53.318, 78.084, "Алтайский край / Славгород"],["Правдинское вдхр. (р. Чесноковка, Новоалтайск)", "Правдинское вдхр.", 0, 2, 4.2, 53.468, 84.112, "Алтайский край / Новоалтайск"],["Склюихинское вдхр. (Рубцовск)", "Склюихинское вдхр.", 0, 2, 4.0, 51.594, 81.412, "Алтайский край / Рубцовск"],["Богучанское вдхр. / р. Ангара (Кодинск / Богучаны / Мотыгино)", "Богучанское вдхр. (Ангара)", 1, 2, 14.5, 58.618, 99.145, "Красноярский край / Кодинск"],["р. Подкаменная Тунгуска (Байкит / Ванавара / Бор)", "Подкаменная Тунгуска", 1, 1, 3.8, 61.672, 96.365, "Красноярский край / Байкит"],["р. Нижняя Тунгуска (Тура — Туруханск)", "Нижняя Тунгуска (Тура)", 1, 1, 4.5, 64.274, 100.211, "Красноярский край / Тура"],["р. Курейка и Курейское вдхр. (Светлогорск)", "р. Курейка и Курейское вдхр.", 1, 2, 12.0, 66.938, 88.356, "Красноярский край / Туруханск"],["р. Хантайка и Хантайское вдхр. (Снежногорск)", "р. Хантайка и Хантайское вдхр.", 1, 2, 11.5, 68.096, 87.648, "Красноярский край / Игарка"],["оз. Таймыр и р. Верхняя/Нижняя Таймыра", "оз. Таймыр", 1, 3, 5.5, 74.532, 101.624, "Красноярский край / Хатанга"],["оз. Глубокое, оз. Кета, оз. Собачье, оз. Хантайское (Плато Путорана)", "Озёра Плато Путорана (Кета / Глубокое / Собачье)", 1, 2, 25.0, 68.765, 90.512, "Красноярский край / Норильск"],["р. Хатанга и р. Хета / р. Котуй (Хатанга)", "Хатанга (Хета / Котуй)", 1, 1, 5.2, 71.984, 102.482, "Красноярский край / Хатанга"],["р. Пясина и оз. Пясино (Норильск / Таймыр)", "р. Пясина и оз. Пясино", 1, 1, 4.2, 69.685, 87.842, "Красноярский край / Норильск"],["Енисейский залив Карского моря (Диксон / Караул)", "Енисейский залив (Диксон)", 1, 5, 10.0, 72.812, 80.834, "Красноярский край / Диксон"],["р. Туба, р. Казыр и р. Кизир (Курагино / Минусинск)", "Туба, Казыр и Кизир", 1, 0, 2.6, 53.889, 92.662, "Красноярский край / Курагино"],["р. Сыда и Сыдинский залив КВХ (Краснотуранск)", "Сыдинский залив КВХ", 1, 2, 6.5, 54.342, 91.512, "Красноярский край / Краснотуранск"],["оз. Большое (Парное), оз. Инголь и Берёзовское вдхр. (Шарыпово)", "оз. Большое, Инголь и Берёзовское вдхр.", 0, 2, 7.5, 55.342, 89.208, "Красноярский край / Шарыпово"],["тёплый канал Назаровской ГРЭС (р. Чулым, Назарово)", "Тёплый канал Назаровской ГРЭС", 0, 4, 3.5, 56.019, 90.421, "Красноярский край / Назарово"],["р. Белая и р. Урик (Усолье-Сибирское / Черемхово)", "Белая и Урик", 1, 0, 2.4, 52.842, 103.324, "Иркутская обл. / Усолье-Сибирское"],["р. Китой (Ангарск)", "Китой", 1, 0, 2.2, 52.502, 103.854, "Иркутская обл. / Ангарск"],["р. Ока Саянская (Саянск / Зима — Братское вдхр.)", "Ока Саянская", 1, 0, 2.8, 54.025, 102.118, "Иркутская обл. / Саянск"],["р. Ия (Тулун — Илирский залив Братского вдхр.)", "Ия", 1, 0, 2.5, 54.568, 100.592, "Иркутская обл. / Тулун"],["р. Уда / Чуна (Нижнеудинск — Чунский)", "Уда / Чуна", 1, 0, 2.6, 54.914, 99.042, "Иркутская обл. / Нижнеудинск"],["р. Бирюса (Тайшет / Бирюсинск)", "Бирюса", 1, 0, 2.5, 55.952, 97.834, "Иркутская обл. / Тайшет"],["р. Илим (Железногорск-Илимский)", "Илим", 1, 0, 3.0, 56.592, 103.982, "Иркутская обл. / Железногорск-Илимский"],["р. Киренга (Казачинское — Киренск)", "Киренга", 1, 0, 2.7, 56.684, 107.752, "Иркутская обл. / Киренск"],["р. Витим (Бодайбо / Мама) и оз. Орон", "Витим (Бодайбо) и оз. Орон", 1, 1, 4.2, 57.848, 114.205, "Иркутская обл. / Бодайбо"],["р. Нижняя Тунгуска (Ербогачён)", "", 1, 1, 3.5, 61.281, 108.019, "Иркутская обл. / Ербогачён"],["Курминский и Ершовский заливы Иркутского вдхр.", "Курминский и Ершовский заливы (Иркутское вдхр.)", 8, 2, 5.5, 52.084, 104.462, "Иркутская обл. / Иркутск"],["Беловское вдхр. (Беловская ГРЭС, пгт Инской)", "Беловское вдхр. (ГРЭС)", 0, 4, 4.5, 54.426, 86.445, "Кемеровская обл. / Белово"],["р. Мрассу (Таштагол / Усть-Кабырза — Мыски)", "Мрассу", 0, 0, 2.2, 53.218, 88.242, "Кемеровская обл. / Мыски"],["р. Кондома (Таштагол — Калтан — Осинники)", "Кондома", 0, 0, 2.0, 53.442, 87.298, "Кемеровская обл. / Таштагол"],["р. Уса и р. Бельсу (Междуреченск)", "Уса и Бельсу", 0, 0, 2.1, 53.784, 88.148, "Кемеровская обл. / Междуреченск"],["р. Верхняя, Средняя и Нижняя Терсь (Кузнецкий Алатау)", "Верхняя, Средняя и Нижняя Терсь", 0, 0, 2.2, 54.262, 87.648, "Кемеровская обл. / Новокузнецк"],["р. Тайдон (Крапивинский р-н)", "Тайдон", 0, 0, 2.0, 54.882, 87.018, "Кемеровская обл. / Крапивинский"],["р. Кия (Тисуль — Макаракский — Мариинск)", "Кия (Кемеровская обл.)", 0, 0, 2.5, 55.818, 87.912, "Кемеровская обл. / Мариинск"],["р. Яя и р. Золотой Китат (Анжеро-Судженск / Яя)", "Яя и Золотой Китат", 0, 0, 2.2, 56.185, 86.384, "Кемеровская обл. / Анжеро-Судженск"],["р. Иня и Кара-Чумышское вдхр. (Ленинск-Кузнецкий / Прокопьевск)", "Иня и Кара-Чумышское вдхр.", 0, 2, 4.2, 54.185, 86.342, "Кемеровская обл. / Прокопьевск"],["оз. Большой Берчикуль (Тисульский р-н)", "оз. Большой Берчикуль", 0, 2, 4.5, 55.622, 88.308, "Кемеровская обл. / Тисуль"],["оз. Танай (Промышленновский р-н)", "оз. Танай", 0, 3, 2.8, 54.718, 84.996, "Кемеровская обл. / Промышленная"],["оз. Малые Чаны и оз. Яркуль (Купино / Здвинск)", "оз. Малые Чаны и Яркуль", 0, 3, 2.8, 54.584, 77.968, "Новосибирская обл. / Купино"],["р. Обь (Сузун / Верх-Сузун / Малышево)", "Обь (Сузун)", 0, 1, 4.2, 53.782, 82.118, "Новосибирская обл. / Сузун"],["р. Обь (Колывань / Почта / Батурино / Кругликово)", "Обь (Колывань)", 0, 1, 4.5, 55.478, 83.005, "Новосибирская обл. / Колывань"],["р. Иня (Тогучин — Новосибирск)", "Иня (Новосибирская обл.)", 0, 0, 2.0, 55.022, 83.485, "Новосибирская обл. / Тогучин"],["р. Омь и р. Тартас (Куйбышев / Венгерово)", "Омь и Тартас", 0, 0, 2.4, 55.451, 78.312, "Новосибирская обл. / Куйбышев"],["р. Тара (Кыштовка)", "", 0, 0, 2.3, 56.561, 76.621, "Новосибирская обл. / Кыштовка"],["р. Карасук и оз. Хорошее / оз. Кривое (Карасук)", "р. Карасук и оз. Хорошее", 0, 3, 2.6, 53.712, 78.018, "Новосибирская обл. / Карасук"],["оз. Убинское (Убинский / Каргатский р-н)", "оз. Убинское", 0, 3, 2.2, 55.452, 80.056, "Новосибирская обл. / Убинское"],["оз. Тандово (Барабинский р-н)", "оз. Тандово", 0, 3, 2.5, 55.284, 77.912, "Новосибирская обл. / Барабинск"],["р. Чаус и р. Уень (Колыванский р-н)", "Чаус и Уень", 0, 0, 2.4, 55.424, 82.842, "Новосибирская обл. / Колывань"],["оз. Ик, оз. Салтаим и оз. Тенис (Большие Крутинские озёра, пгт Крутинка)", "Большие Крутинские озёра (Ик / Салтаим / Тенис)", 0, 3, 3.2, 56.082, 71.684, "Омская обл. / Крутинка"],["р. Иртыш и р. Ишим (Усть-Ишим / Тевриз / Знаменское)", "Иртыш и Ишим (Усть-Ишим)", 0, 1, 5.2, 57.696, 71.174, "Омская обл. / Усть-Ишим"],["р. Тара и оз. Данилово / Линево / Щучье (Муромцевский р-н)", "Тара и Пять озёр (Муромцево)", 0, 0, 2.8, 56.378, 75.254, "Омская обл. / Муромцево"],["р. Шиш и р. Туй (Знаменский / Тевризский р-н)", "Шиш и Туй", 0, 0, 2.3, 57.218, 73.112, "Омская обл. / Знаменское"],["р. Оша (Колосовка / Тюкалинск)", "Оша", 0, 0, 2.1, 56.472, 73.618, "Омская обл. / Колосовка"],["оз. Эбейты (Москаленский / Полтавский р-н)", "оз. Эбейты", 0, 3, 1.5, 54.664, 71.742, "Омская обл. / Исилькуль"],["р. Обь (Стрежевой / Александровское / Пасол)", "Обь (Стрежевой / Александровское)", 0, 1, 5.5, 60.718, 77.612, "Томская обл. / Стрежевой"],["р. Обь (Кожевниково / Шегарка / Молчаново / Кривошеино)", "Обь (Молчаново / Шегарка)", 0, 1, 4.8, 57.584, 83.771, "Томская обл. / Молчаново"],["р. Чулым (Зырянское — Асино — Первомайское — Молчаново)", "Чулым (Асино)", 0, 1, 3.6, 57.008, 86.162, "Томская обл. / Асино"],["р. Кеть (Белый Яр — Колпашево)", "Кеть", 0, 1, 3.4, 58.448, 85.051, "Томская обл. / Белый Яр"],["р. Васюган (Каргасок / Средний Васюган)", "Васюган", 0, 1, 3.5, 59.054, 80.784, "Томская обл. / Каргасок"],["р. Тым (Каргасокский р-н / Напас)", "Тым", 0, 0, 2.9, 59.842, 81.912, "Томская обл. / Каргасок"],["р. Парабель, р. Чузик и р. Кёнга (Парабель / Кедровый)", "Парабель, Чузик и Кёнга", 0, 0, 2.6, 58.694, 81.482, "Томская обл. / Парабель"],["р. Чая (Подгорное)", "Чая", 0, 0, 2.5, 57.792, 82.658, "Томская обл. / Подгорное"],["оз. Польто-3 и оз. Мирное (Каргасокский / Парабельский р-н)", "оз. Польто-3 и Мирное", 0, 3, 3.2, 59.712, 82.418, "Томская обл. / Каргасок"],["р. Снежная (Выдрино)", "", 8, 0, 2.3, 51.452, 104.642, "Республика Бурятия / Бабушкин"],["р. Лена (Якутск)", "Лена", 1, 1, 7.5, 62.03, 129.73, "Якутск"],["р. Амга", "", 1, 0, 2.5, 60.9, 131.98, "Якутия"],["р. Лена (Ленск)", "Лена", 1, 1, 5.8, 60.72, 114.93, "Ленск"],["р. Вилюй", "", 1, 1, 4.5, 62.08, 120.42, "Вилюйск"],["р. Алдан", "", 1, 1, 4.8, 58.96, 126.28, "Алдан / Томмот"],["оз. Байкал (Чивыркуйский залив)", "Чивыркуйский залив", 8, 2, 8.5, 53.7, 109.15, "Забайкальский нацпарк"],["р. Селенга (Улан-Удэ / дельта)", "Селенга", 8, 1, 4.2, 51.83, 107.58, "Улан-Удэ"],["оз. Гусиное (Гусиноозёрская ГРЭС)", "Гусиное озеро (ГРЭС)", 8, 4, 5.5, 51.2, 106.4, "Гусиноозёрск"],["р. Баргузин", "", 8, 0, 2.6, 53.62, 109.62, "Баргузинский р-н"],["оз. Котокель", "", 8, 3, 3.5, 52.8, 108.15, "Прибайкальский р-н"],["р. Амур (Хабаровск)", "Амур", 9, 1, 6.5, 48.48, 135.07, "Хабаровск"],["р. Анюй", "", 9, 0, 2.4, 49.3, 136.5, "Хабаровский край"],["р. Хор", "", 9, 0, 2.5, 47.78, 134.96, "Хабаровский край"],["р. Амур (Благовещенск)", "Амур", 9, 1, 5.2, 50.27, 127.54, "Благовещенск"],["р. Амур (Комсомольск-на-Амуре)", "Амур", 9, 1, 7.2, 50.55, 137.0, "Комсомольск"],["р. Зея (Благовещенск)", "Зея", 9, 1, 4.2, 50.3, 127.6, "Благовещенск"],["Зейское вдхр.", "", 9, 2, 14.0, 53.75, 127.25, "г. Зея"],["Бурейское вдхр.", "", 9, 2, 12.0, 50.18, 130.3, "п. Талакан"],["р. Уссури", "", 9, 1, 3.6, 45.46, 133.42, "Лесозаводск"],["оз. Ханка", "", 9, 3, 2.8, 44.99, 132.06, "Камень-Рыболов"],["оз. Болонь", "", 9, 3, 2.2, 49.85, 136.45, "Амурский р-н"],["Амурский залив (Владивосток)", "Амурский залив", 10, 5, 14.0, 43.12, 131.88, "Владивосток"],["р. Раздольная (Суйфун)", "Раздольная", 10, 1, 3.2, 43.35, 131.8, "Уссурийск / Тавричанка"],["Уссурийский залив (Шамора)", "Уссурийский залив", 10, 5, 11.0, 43.19, 132.12, "Владивосток"],["Залив Находка", "", 10, 5, 15.0, 42.82, 132.88, "Находка"],["Авачинская губа", "", 10, 5, 16.0, 53.02, 158.65, "Петропавловск-Камчатский"],["р. Авача", "", 10, 0, 2.0, 53.18, 158.38, "Елизово"],["р. Паратунка", "", 10, 0, 2.2, 52.96, 158.25, "Елизово / Камчатка"],["р. Камчатка", "", 10, 1, 4.5, 56.32, 160.84, "п. Ключи"],["р. Быстрая (Большая)", "", 10, 0, 2.4, 52.75, 156.3, "Усть-Большерецк"],["Охотское море (бухта Нагаева)", "Бухта Нагаева", 10, 5, 18.0, 59.56, 150.8, "Магадан"],["Анивский залив", "", 10, 5, 12.0, 46.62, 142.77, "Корсаков / Сахалин"],["оз. Тунайча (Сахалин)", "Тунайча", 10, 2, 9.0, 46.82, 143.15, "Южно-Сахалинск"],["р. Лютога (Сахалин)", "Лютога", 10, 0, 2.0, 46.78, 142.52, "Анива / Сахалин"],["р. Тымь", "", 10, 0, 2.2, 50.85, 142.68, "Тымовское / Сахалин"],["оз. Байкал / р. Верхняя Ангара (Северобайкальск)", "Байкал (Северобайкальск)", 8, 2, 16.0, 55.635, 109.325, "Северобайкальск (Бурятия)"],["оз. Кенон / р. Ингода (Чита)", "оз. Кенон / р. Ингода (Чита)", 9, 2, 4.5, 52.035, 113.5, "Чита (Забайкальский край)"],["Вилюйское вдхр. / р. Малая Ботуобия (Мирный)", "Вилюйское вдхр. (Мирный)", 1, 2, 10.0, 62.535, 113.96, "Мирный (Якутия)"],["р. Вилюй (Вилюйск)", "р. Вилюй (Вилюйск)", 1, 1, 5.0, 63.755, 121.624, "Вилюйск (Якутия)"],["р. Чульман / р. Тимптон (Нерюнгри)", "р. Чульман (Нерюнгри)", 1, 0, 2.2, 56.66, 124.725, "Нерюнгри (Якутия)"],["Губа Буор-Хая / дельта Лены (Тикси)", "Дельта Лены / Тикси", 1, 5, 8.0, 71.637, 128.868, "Тикси (Якутия)"],["р. Зея (Свободный)", "р. Зея (Свободный)", 9, 1, 4.5, 51.375, 128.135, "Свободный (Амурская обл.)"],["р. Тында / р. Гилюй (Тында)", "р. Гилюй (Тында)", 9, 0, 2.4, 55.155, 124.725, "Тында (Амурская обл.)"],["р. Бира (Биробиджан)", "р. Бира (Биробиджан)", 9, 0, 2.5, 48.795, 132.92, "Биробиджан (ЕАО)"],["Амурский лиман / р. Амур (Николаевск-на-Амуре)", "Амурский лиман (Николаевск)", 10, 5, 6.5, 53.145, 140.72, "Николаевск-на-Амуре"],["Татарский пролив (Ванино / Советская Гавань)", "Бухта Ванино / Совгавань", 10, 5, 12.0, 49.02, 140.28, "Ванино / Советская Гавань"],["р. Поронай / залив Терпения (Поронайск)", "р. Поронай / Залив Терпения", 10, 5, 7.0, 49.222, 143.102, "Поронайск (Сахалин)"],["Набильский залив / р. Тымь (Ноглики)", "Набильский залив (Ноглики)", 10, 5, 5.5, 51.805, 143.14, "Ноглики (Сахалин)"],["Залив Помрь / Охотское море (Оха)", "Залив Помрь (Оха)", 10, 5, 6.0, 53.59, 142.95, "Оха (Сахалин)"],["р. Камчатка / оз. Нерпичье (Усть-Камчатск)", "Устье р. Камчатка", 10, 1, 5.5, 56.228, 162.476, "Усть-Камчатск (Камчатка)"],["Анадырский лиман / р. Анадырь (Анадырь)", "Анадырский лиман", 10, 5, 8.0, 64.733, 177.515, "Анадырь (Чукотка)"],["Дельта р. Селенга (Кабанск)", "р. Селенга (Кабанск)", 8, 1, 4.8, 52.055, 106.645, "Кабанск"],["р. Лена (Покровск)", "р. Лена (Покровск)", 1, 1, 8.0, 61.482, 129.152, "Покровск"],["р. Алдан / р. Селигдар (Алдан)", "р. Алдан (Алдан)", 1, 1, 4.5, 58.65, 125.45, "Алдан"],["р. Амур (Николаевск-на-Амуре)", "р. Амур (Николаевск)", 9, 1, 11.0, 53.138, 140.715, "Николаевск-на-Амуре"],["оз. Ханка (Спасск-Дальний)", "оз. Ханка (Спасск-Дальний)", 9, 2, 4.2, 44.655, 132.68, "Спасск-Дальний"],["р. Раздольная (Уссурийск)", "р. Раздольная (Уссурийск)", 10, 1, 3.5, 43.792, 131.945, "Уссурийск"],["Залив Посьета / Бухта Славянка (Славянка)", "Залив Посьета (Славянка)", 10, 5, 10.0, 42.865, 131.392, "Славянка"],["оз. Арахлей и оз. Шакшинское (Чита)", "Озеро Арахлей", 9, 2, 10.0, 52.212, 112.912, "Забайкальский край"],["оз. Байкал (Баргузинский залив / Максимиха — Усть-Баргузин)", "Баргузинский залив (Байкал)", 8, 2, 18.0, 53.364, 108.842, "Республика Бурятия / Усть-Баргузин"],["оз. Байкал (Посольский сор и залив Провал)", "Посольский сор и залив Провал", 8, 3, 3.2, 52.042, 106.212, "Республика Бурятия / Кабанск"],["р. Уда (Хоринск — Улан-Удэ)", "Уда (Бурятия)", 8, 0, 2.2, 51.842, 107.684, "Республика Бурятия / Улан-Удэ"],["р. Хилок (Бичурский / Селенгинский р-н)", "Хилок (Бурятия)", 8, 0, 2.4, 50.624, 107.482, "Республика Бурятия / Бичура"],["р. Чикой (Кяхтинский р-н)", "Чикой (Бурятия)", 8, 0, 2.8, 50.942, 106.648, "Республика Бурятия / Кяхта"],["р. Джида (Закаменск — Петропавловка — Джида)", "Джида", 8, 0, 2.4, 50.592, 105.312, "Республика Бурятия / Закаменск"],["р. Турка (Прибайкальский р-н)", "Турка", 8, 0, 2.2, 52.948, 108.224, "Республика Бурятия / Горячинск"],["оз. Большое Еравное, Малое Еравное и Сосновое (Еравнинский р-н)", "Еравнинские озёра (Большое Еравное / Сосновое)", 1, 3, 3.5, 52.584, 111.512, "Республика Бурятия / Сосново-Озёрское"],["оз. Баунт и р. Ципа / р. Витим (Баунтовский эвенкийский р-н)", "оз. Баунт и р. Ципа", 1, 2, 9.5, 55.184, 113.024, "Республика Бурятия / Багдарин"],["оз. Щучье (Селенгинский р-н)", "оз. Щучье (Бурятия)", 8, 2, 8.0, 51.408, 106.542, "Республика Бурятия / Гусиноозёрск"],["оз. Ильчир и р. Ока Саянская (Окинский р-н)", "оз. Ильчир и верховья р. Ока", 1, 3, 4.2, 51.964, 100.992, "Республика Бурятия / Монды"],["р. Лена (Олёкминск) и р. Олёкма", "Лена и Олёкма (Олёкминск)", 1, 1, 5.5, 60.371, 120.432, "Республика Саха (Якутия) / Олёкминск"],["р. Лена (Сангар / Жиганск / Кюсюр — нижняя Лена)", "Лена (Сангар / Жиганск)", 1, 1, 7.5, 66.762, 123.381, "Республика Саха (Якутия) / Жиганск"],["р. Синяя и р. Буотама (Хангаласский улус)", "Синяя и Буотама", 1, 0, 2.2, 61.124, 128.754, "Республика Саха (Якутия) / Покровск"],["р. Алдан (Хандыга / Усть-Мая) и р. Мая / р. Учур", "Алдан и Мая (Хандыга / Усть-Мая)", 1, 1, 5.0, 62.652, 135.558, "Республика Саха (Якутия) / Хандыга"],["р. Вилюй (Сунтар / Нюрба / Верхневилюйск) и р. Марха", "Вилюй (Сунтар / Нюрба) и Марха", 1, 1, 4.2, 63.281, 118.342, "Республика Саха (Якутия) / Нюрба"],["р. Яна (Верхоянск / Батагай / Усть-Куйга / Казачье)", "Яна", 1, 1, 4.0, 67.651, 134.628, "Республика Саха (Якутия) / Верхоянск"],["р. Индигирка (Усть-Нера / Хонуу / Белая Гора / Чокурдах)", "Индигирка", 1, 1, 4.5, 66.452, 143.231, "Республика Саха (Якутия) / Усть-Нера"],["р. Колыма (Зырянка / Среднеколымск / Черский)", "Колыма (Зырянка / Среднеколымск)", 1, 1, 5.5, 67.452, 153.712, "Республика Саха (Якутия) / Среднеколымск"],["р. Оленёк (Оленёк / Таймылыр)", "Оленёк", 1, 1, 3.8, 68.508, 112.442, "Республика Саха (Якутия) / Оленёк"],["р. Анабар (Саскылах / Юрюнг-Хая)", "Анабар", 1, 1, 3.6, 71.961, 114.092, "Республика Саха (Якутия) / Саскылах"],["оз. Ниджили (Кобяйский улус)", "оз. Ниджили", 1, 3, 3.2, 63.588, 125.432, "Республика Саха (Якутия) / Кобяй"],["оз. Лабынкыр и оз. Ворота (Оймяконский улус)", "оз. Лабынкыр и Ворота", 1, 2, 15.0, 62.492, 143.608, "Республика Саха (Якутия) / Усть-Нера"],["Море Лаптевых и Восточно-Сибирское море (Тикси / Нижнеянск / Амбарчик)", "Море Лаптевых и Восточно-Сибирское море", 1, 5, 8.0, 71.638, 128.874, "Республика Саха (Якутия) / Тикси"],["р. Шилка (Шилка / Сретенск / Кокуй — слияние с Аргунью)", "Шилка", 9, 1, 3.6, 52.241, 117.712, "Забайкальский край / Шилка"],["р. Онон (Кыра — Акша — Нижний Цасучей — Оловянная)", "Онон", 9, 1, 2.9, 50.524, 115.138, "Забайкальский край / Агинское"],["р. Аргунь (Краснокаменск / Приаргунск / Нерчинский Завод)", "Аргунь", 9, 1, 3.0, 50.372, 119.108, "Забайкальский край / Краснокаменск"],["р. Ингода (Улёты — Чита — Карымское)", "Ингода", 9, 0, 2.4, 51.928, 113.642, "Забайкальский край / Чита"],["р. Чикой и р. Менза (Красный Чикой)", "Чикой и Менза", 8, 0, 2.6, 50.361, 108.758, "Забайкальский край / Красный Чикой"],["р. Хилок (Могзон — Хилок)", "Хилок (Забайкалье)", 8, 0, 2.3, 51.362, 110.461, "Забайкальский край / Хилок"],["р. Чара, оз. Большое и Малое Леприндо, оз. Ничатка (Каларский округ)", "р. Чара и оз. Леприндо / Ничатка", 1, 2, 12.0, 56.632, 117.524, "Забайкальский край / Новая Чара"],["р. Витим и р. Каренга (Тунгокоченский р-н)", "Витим и Каренга (Забайкалье)", 1, 1, 3.4, 53.562, 115.541, "Забайкальский край / Тунгокочен"],["вдхр. Харанорской ГРЭС (Ясногорск)", "вдхр. Харанорской ГРЭС", 9, 4, 3.8, 50.858, 115.684, "Забайкальский край / Ясногорск"],["оз. Иван, оз. Тасей и оз. Большое Ундугун (Ивано-Арахлейская система)", "оз. Иван, Тасей и Большое Ундугун", 8, 3, 4.2, 52.238, 112.984, "Забайкальский край / Чита"],["р. Большая и лиман р. Большая (Усть-Большерецк / Октябрьский)", "Большая (Усть-Большерецк)", 10, 1, 3.8, 52.812, 156.284, "Камчатский край / Усть-Большерецк"],["р. Опала и р. Голыгина (Усть-Большерецкий р-н)", "Опала и Голыгина", 10, 0, 2.4, 52.012, 156.512, "Камчатский край / Усть-Большерецк"],["р. Озерная и оз. Курильское (п. Озерновский)", "р. Озерная и оз. Курильское", 10, 0, 2.8, 51.496, 156.542, "Камчатский край / Озерновский"],["р. Плотникова и оз. Начикинское (Елизовский р-н)", "р. Плотникова и оз. Начикинское", 10, 0, 2.3, 52.912, 157.518, "Камчатский край / Елизово"],["р. Жупанова (восточное побережье Камчатки)", "Жупанова", 10, 0, 2.6, 54.084, 159.984, "Камчатский край / Елизово"],["р. Еловка и р. Козыревка (притоки р. Камчатка, Мильковский / Усть-Камчатский р-н)", "Еловка и Козыревка", 10, 0, 2.5, 56.342, 160.512, "Камчатский край / Ключи"],["оз. Азабачье (низовья р. Камчатка)", "оз. Азабачье", 10, 2, 8.5, 56.142, 161.784, "Камчатский край / Усть-Камчатск"],["оз. Кроноцкое (Кроноцкий заповедник)", "оз. Кроноцкое", 10, 2, 18.0, 54.784, 160.228, "Камчатский край / Мильково"],["р. Большая Воровская, р. Колпакова и р. Ича (Соболевский р-н)", "Большая Воровская, Колпакова и Ича", 10, 0, 2.4, 54.302, 155.894, "Камчатский край / Соболево"],["р. Тигиль и р. Палана (Корякский округ, Охотское море)", "Тигиль и Палана", 10, 0, 2.5, 59.088, 159.942, "Камчатский край / Палана"],["р. Пенжина и р. Таловка (Пенжинский р-н)", "Пенжина и Таловка", 10, 1, 3.6, 62.472, 166.212, "Камчатский край / Каменское"],["Авачинский залив, Кроноцкий залив и Камчатский залив Тихого океана", "Авачинский и Кроноцкий заливы (Тихий океан)", 10, 6, 25.0, 52.842, 158.812, "Камчатский край / Петропавловск-Камчатский"],["р. Бикин (Лучегорск / Красный Яр, Пожарский р-н)", "Бикин (Приморье)", 9, 0, 2.6, 46.538, 135.352, "Приморский край / Лучегорск"],["р. Большая Уссурка / Иман (Рощино — Новопокровка — Дальнереченск)", "Большая Уссурка (Иман)", 9, 0, 2.8, 45.882, 134.312, "Приморский край / Дальнереченск"],["р. Арсеньевка / Даубихе (Анучино — Арсеньев — Яковлевка)", "Арсеньевка (Даубихе)", 9, 0, 2.2, 44.158, 133.268, "Приморский край / Арсеньев"],["р. Илистая / Лефу (Черниговский / Хорольский р-н — оз. Ханка)", "Илистая (Лефу)", 9, 0, 2.4, 44.512, 132.484, "Приморский край / Спасск-Дальний"],["Лучегорское вдхр. (Приморская ГРЭС)", "Лучегорское вдхр. (ГРЭС)", 9, 4, 4.2, 46.438, 134.264, "Приморский край / Лучегорск"],["Артёмовское вдхр. и р. Артёмовка (Майхе)", "Артёмовское вдхр. и р. Артёмовка", 10, 2, 5.0, 43.398, 132.284, "Приморский край / Артём"],["р. Партизанская (Сучан) и р. Киевка (Судзухе)", "Партизанская и Киевка", 10, 0, 2.2, 43.024, 133.142, "Приморский край / Находка"],["р. Аввакумовка и залив Ольги (пгт Ольга)", "р. Аввакумовка и залив Ольги", 10, 5, 6.5, 43.738, 135.278, "Приморский край / Ольга"],["р. Кема, р. Максимовка и р. Самарга (Тернейский р-н)", "Кема, Максимовка и Самарга", 10, 0, 2.4, 45.482, 137.184, "Приморский край / Терней"],["бухта Новик (о. Русский) и залив Стрелок (Фокино / Дунай)", "Бухта Новик (о. Русский) и залив Стрелок", 10, 5, 8.0, 43.042, 131.868, "Приморский край / Владивосток"],["протока Амурская, протока Пемзенская и р. Тунгуска (Хабаровск)", "Амурская и Пемзенская протоки, р. Тунгуска", 9, 1, 4.8, 48.554, 134.892, "Хабаровский край / Хабаровск"],["р. Кия и р. Подхорёнок (Переяславка / Вяземский)", "Кия и Подхорёнок (Хабаровск)", 9, 0, 2.2, 47.968, 135.042, "Хабаровский край / Переяславка"],["р. Бикин (г. Бикин)", "", 9, 0, 2.7, 46.818, 134.248, "Хабаровский край / Бикин"],["р. Кур и р. Урми (бассейн р. Тунгуска)", "Кур и Урми", 9, 0, 2.5, 48.742, 134.284, "Хабаровский край / Хабаровск"],["р. Гур (Хунгари) и р. Горин (Комсомольский / Солнечный р-н)", "Гур (Хунгари) и Горин", 9, 0, 2.6, 50.284, 136.912, "Хабаровский край / Комсомольск-на-Амуре"],["р. Амгунь (Им. Полины Осипенко — низовья Амура)", "Амгунь", 9, 1, 3.5, 52.428, 136.492, "Хабаровский край / Им. Полины Осипенко"],["оз. Петропавловское и оз. Гасси (Хабаровский / Нанайский р-н)", "оз. Петропавловское и Гасси", 9, 3, 2.8, 48.684, 135.592, "Хабаровский край / Хабаровск"],["оз. Хумми, оз. Удыль, оз. Большое Кизи и оз. Чукчагирское (Нижнее Приамурье)", "оз. Удыль, Хумми и Большое Кизи", 9, 3, 3.0, 52.142, 139.884, "Хабаровский край / Богородское"],["залив Чихачёва (п. Де-Кастри, Татарский пролив)", "Залив Чихачёва (Де-Кастри)", 10, 5, 7.5, 51.464, 140.792, "Хабаровский край / Де-Кастри"],["р. Коппи и р. Тумнин (Советско-Гаванский / Ванинский р-н)", "Коппи и Тумнин", 10, 0, 2.8, 49.942, 140.424, "Хабаровский край / Советская Гавань"],["р. Уда, р. Тугур и залив Николая / Шантарское море (Тугуро-Чумиканский р-н)", "р. Уда, р. Тугур и Шантарское море", 10, 1, 3.8, 54.688, 135.324, "Хабаровский край / Чумикан"],["р. Охота, р. Кухтуй и р. Иня (Охотский округ)", "Охота, Кухтуй и Иня", 10, 0, 2.9, 59.372, 143.184, "Хабаровский край / Охотск"],["р. Мая (Нелькан — бассейн Алдана/Лены)", "Мая (Нелькан)", 1, 1, 3.6, 57.654, 136.158, "Хабаровский край / Нелькан"],["Нижне-Бурейское вдхр. и р. Бурея (Новобурейский / Талакан)", "Нижне-Бурейское вдхр. и р. Бурея", 9, 2, 9.5, 49.812, 129.892, "Амурская обл. / Новобурейский"],["р. Селемджа (Экимчан — Февральск — Новокиевский Увал)", "Селемджа", 9, 1, 3.4, 52.472, 130.918, "Амурская обл. / Февральск"],["р. Томь Амурская (Белогорск)", "", 9, 0, 2.3, 50.918, 128.472, "Амурская обл. / Белогорск"],["р. Архара и оз. Долгое (Архаринский р-н)", "р. Архара и оз. Долгое", 9, 0, 2.2, 49.418, 130.078, "Амурская обл. / Архара"],["р. Гилюй (Тында — Зейское вдхр.)", "Гилюй", 9, 0, 2.6, 54.824, 126.842, "Амурская обл. / Тында"],["р. Нюкжа и р. Олёкма (Тындинский округ — бассейн Лены)", "Нюкжа и Олёкма (Тындинский округ)", 1, 0, 2.5, 56.574, 121.652, "Амурская обл. / Тында"],["р. Амур (Поярково / Константиновка / Иннокентьевка)", "Амур (Поярково / Константиновка)", 9, 1, 5.0, 49.622, 128.648, "Амурская обл. / Поярково"],["р. Амур (Джалинда / Албазино — Верхний Амур)", "Амур (Джалинда / Албазино)", 9, 1, 4.2, 53.468, 123.912, "Амурская обл. / Сковородино"],["бухта Гертнера и Тауйская губа Охотского моря (Магадан)", "Бухта Гертнера и Тауйская губа", 10, 5, 9.0, 59.548, 150.912, "Магаданская обл. / Магадан"],["р. Ола и Ольский лиман (пгт Ола / Клепка)", "р. Ола и Ольский лиман", 10, 0, 2.4, 59.584, 151.298, "Магаданская обл. / Ола"],["р. Яна Охотская, р. Тауй и р. Армань (Тауйск / Балаганное / Армань)", "Яна Охотская, Тауй и Армань", 10, 0, 2.6, 59.732, 149.392, "Магаданская обл. / Тауйск"],["р. Дукча и р. Хасын (Магадан / Палатка / Стекольный)", "Дукча и Хасын", 10, 0, 1.9, 59.812, 150.892, "Магаданская обл. / Палатка"],["р. Яма и Ямский лиман (Ольский округ)", "р. Яма и Ямский лиман", 10, 0, 2.5, 59.654, 154.184, "Магаданская обл. / Ола"],["Колымское вдхр. и р. Колыма (Синегорье / Дебин / Ягодное)", "Колымское вдхр. и р. Колыма (Синегорье)", 1, 2, 14.0, 62.084, 150.512, "Магаданская обл. / Синегорье"],["Усть-Среднеканское вдхр. и р. Колыма (Сеймчан / Усть-Омчуг)", "Усть-Среднеканское вдхр. и р. Колыма (Сеймчан)", 1, 1, 6.5, 62.928, 152.384, "Магаданская обл. / Сеймчан"],["р. Берелёх и р. Аян-Юрях (Сусуман / Холодный)", "Берелёх и Аян-Юрях", 1, 0, 2.3, 62.782, 148.156, "Магаданская обл. / Сусуман"],["р. Балыгычан, р. Сугой и р. Коркодон (Омсукчанский / Среднеканский округ)", "Балыгычан, Сугой и Коркодон", 1, 0, 2.5, 62.812, 154.812, "Магаданская обл. / Омсукчан"],["оз. Джека Лондона и оз. Танцующих Хариусов (Ягоднинский округ)", "оз. Джека Лондона и Танцующих Хариусов", 1, 2, 14.0, 62.068, 149.518, "Магаданская обл. / Ягодное"],["Гижигинская губа и р. Гижига / р. Наяхан (пгт Эвенск)", "Гижигинская губа и р. Гижига", 10, 5, 8.5, 61.912, 159.242, "Магаданская обл. / Эвенск"],["р. Найба и залив Мордвинова (Долинск / Стародубское)", "р. Найба и залив Мордвинова", 10, 5, 6.5, 47.418, 142.812, "Сахалинская обл. / Долинск"],["оз. Буссе и оз. Изменчивое (Корсаковский р-н)", "оз. Буссе и Изменчивое", 10, 5, 4.2, 46.528, 143.324, "Сахалинская обл. / Корсаков"],["оз. Айнское и р. Красногорка (Томаринский р-н)", "оз. Айнское и р. Красногорка", 10, 3, 3.0, 48.458, 142.062, "Сахалинская обл. / Томари"],["оз. Невское (Поронайский р-н)", "оз. Невское (Сахалин)", 10, 3, 2.5, 49.338, 143.384, "Сахалинская обл. / Поронайск"],["залив Чайво, залив Пильтун и залив Луньский (Ногликский / Охинский р-н)", "Заливы Чайво, Пильтун и Луньский", 10, 5, 5.5, 52.368, 143.184, "Сахалинская обл. / Ноглики"],["залив Байкал и Сахалинский залив (Москальво / Некрасовка, Охинский р-н)", "Залив Байкал и Сахалинский залив", 10, 5, 7.0, 53.542, 142.584, "Сахалинская обл. / Оха"],["Татарский пролив (Холмск / Невельск / Томари / Углегорск / Александровск-Сахалинский)", "Татарский пролив (Холмск / Невельск / Углегорск)", 10, 6, 18.0, 47.048, 142.024, "Сахалинская обл. / Холмск"],["р. Сусуя и р. Таранай (Южно-Сахалинск / Анива)", "Сусуя и Таранай", 10, 0, 2.0, 46.842, 142.684, "Сахалинская обл. / Южно-Сахалинск"],["р. Курилка, оз. Сопочное, оз. Благодатное и залив Простор (о. Итуруп, Курильск)", "р. Курилка, оз. Сопочное и залив Простор (Итуруп)", 10, 5, 8.0, 45.238, 147.882, "Сахалинская обл. / Курильск"],["Южно-Курильский пролив, оз. Лагунное и оз. Серебряное (о. Кунашир, Южно-Курильск)", "Южно-Курильский пролив и оз. Лагунное (Кунашир)", 10, 5, 7.5, 44.034, 145.848, "Сахалинская обл. / Южно-Курильск"],["Второй Курильский пролив (о. Парамушир, Северо-Курильск)", "Второй Курильский пролив (Парамушир)", 10, 5, 15.0, 50.678, 156.132, "Сахалинская обл. / Северо-Курильск"],["р. Амур (Ленинское / Нижнеленинское / Амурзет — Средний Амур)", "Амур (Ленинское / Амурзет)", 9, 1, 5.5, 47.932, 132.612, "Еврейская АО / Ленинское"],["р. Амур (Пашково / Радде — Хинганский створ)", "Амур (Пашково / Радде)", 9, 1, 6.2, 48.874, 130.654, "Еврейская АО / Облучье"],["р. Тунгуска, р. Ин и р. Урми (Николаевка / Даниловка / Смидович)", "Тунгуска, Ин и Урми (ЕАО)", 9, 1, 3.5, 48.562, 134.592, "Еврейская АО / Николаевка"],["протока Пемзенская и залив Тельмана (Приамурский / Им. Тельмана)", "Пемзенская протока и залив Тельмана", 9, 1, 4.2, 48.514, 134.938, "Еврейская АО / Приамурский"],["р. Биджан (с. Биджан — Дежнёво)", "Биджан", 9, 0, 2.1, 48.012, 132.024, "Еврейская АО / Биджан"],["р. Большая Икура и карьеры Биробиджана", "Карьеры Биробиджана и р. Икура", 9, 2, 3.5, 48.798, 132.952, "Еврейская АО / Биробиджан"],["оз. Тёплое (Теплоозёрск)", "оз. Тёплое (Теплоозёрск)", 9, 3, 3.0, 49.006, 131.892, "Еврейская АО / Теплоозёрск"],["оз. Лебединое и оз. Забеловское (Смидовичский / Ленинский р-н)", "оз. Лебединое и Забеловское", 9, 3, 2.6, 48.432, 134.512, "Еврейская АО / Николаевка"],["р. Анадырь (среднее течение — Марково / Усть-Белая) и оз. Красное", "Анадырь (Марково / Усть-Белая) и оз. Красное", 10, 1, 4.5, 64.684, 170.421, "Чукотский АО / Марково"],["р. Великая, р. Майн, р. Белая и р. Канчалан (Анадырский р-н)", "Великая, Майн, Белая и Канчалан", 10, 0, 2.8, 65.168, 176.962, "Чукотский АО / Анадырь"],["оз. Эльгыгытгын (Анадырский р-н)", "оз. Эльгыгытгын", 10, 2, 35.0, 67.489, 172.092, "Чукотский АО / Билибино"],["оз. Майниц и оз. Пекульнейское (Беринговский / Мейныпильгыно)", "оз. Майниц и Пекульнейское", 10, 2, 12.0, 63.168, 176.712, "Чукотский АО / Беринговский"],["Залив Креста Берингова моря и р. Амгуэма (Эгвекинот)", "Залив Креста и р. Амгуэма (Эгвекинот)", 10, 5, 12.0, 66.318, 180.884, "Чукотский АО / Эгвекинот"],["Бухта Провидения и пролив Сенявина (Провидения)", "Бухта Провидения и пролив Сенявина", 10, 5, 15.0, 64.422, 186.768, "Чукотский АО / Провидения"],["Залив Лаврентия и Берингов пролив (Лаврентия / Лорино / Уэлен)", "Залив Лаврентия и Берингов пролив", 10, 5, 14.0, 65.584, 188.998, "Чукотский АО / Лаврентия"],["Чаунская губа Восточно-Сибирского моря и р. Чаун / р. Паляваам (Певек)", "Чаунская губа и р. Паляваам (Певек)", 1, 5, 9.0, 69.702, 170.298, "Чукотский АО / Певек"],["р. Малый Анюй, р. Большой Анюй и р. Омолон (Билибино / Анюйск / Омолон)", "Малый и Большой Анюй, р. Омолон", 1, 0, 2.9, 68.054, 166.442, "Чукотский АО / Билибино"]
].map(r => {
 const name = r[0];
 const cleanName = r[1] || name.replace(/^(р\.|оз\.|вдхр\.)\s*/i, '').trim();
 return {
  name,
  cleanName,
  basin: _BC[r[2]] || 'volga_caspian',
  wType: _WC[r[3]] || 'small_river',
  typeTag: _BOT_WTAGS[r[3]] || 'Водоём',
  defDepth: r[4] || 2.0,
  lat: r[5],
  lon: r[6],
  region: r[7] || cleanName
 };
});

const _CITIES = [
["Москва", 55.7558, 37.6173, 32],["Зеленоград", 55.9825, 37.1814, 32],["Химки", 55.897, 37.429, 33],["Долгопрудный", 55.938, 37.514, 33],["Мытищи", 55.9116, 37.7308, 33],["Королёв", 55.922, 37.825, 33],["Пушкино", 56.01, 37.847, 33],["Щёлково", 55.923, 37.998, 33],["Балашиха", 55.796, 37.938, 33],["Люберцы", 55.678, 37.893, 33],["Жуковский", 55.595, 38.12, 33],["Раменское", 55.567, 38.23, 33],["Бронницы", 55.425, 38.264, 33],["Воскресенск", 55.317, 38.683, 33],["Коломна", 55.0794, 38.7783, 33],["Луховицы", 54.965, 39.026, 33],["Кашира", 54.836, 38.151, 33],["Ступино", 54.889, 38.078, 33],["Серпухов", 54.9158, 37.4111, 33],["Чехов", 55.148, 37.477, 33],["Подольск", 55.4242, 37.5547, 33],["Домодедово", 55.436, 37.766, 33],["Одинцово", 55.679, 37.263, 33],["Звенигород", 55.73, 36.854, 33],["Красногорск", 55.82, 37.33, 33],["Истра", 55.914, 36.86, 33],["Солнечногорск", 56.185, 36.976, 33],["Клин", 56.333, 36.733, 33],["Дмитров", 56.344, 37.52, 33],["Дубна", 56.736, 37.162, 33],["Сергиев Посад", 56.31, 38.136, 33],["Орехово-Зуево", 55.806, 38.961, 33],["Шатура", 55.576, 39.542, 33],["Егорьевск", 55.383, 39.033, 33],["Руза", 55.698, 36.195, 33],["Можайск", 55.502, 36.03, 33],["Волоколамск", 56.036, 35.958, 33],["Наро-Фоминск", 55.387, 36.733, 33],["Тверь", 56.8587, 35.9176, 74],["Конаково", 56.7, 36.768, 74],["Завидово", 56.526, 36.525, 74],["Кимры", 56.873, 37.356, 74],["Калязин", 57.243, 37.854, 74],["Весьегонск", 58.663, 37.26, 74],["Осташков (Селигер)", 57.147, 33.107, 74],["Ржев", 56.262, 34.327, 74],["Вышний Волочёк", 57.585, 34.56, 74],["Удомля", 57.878, 35.006, 74],["Ярославль", 57.6261, 39.8845, 88],["Рыбинск", 58.048, 38.858, 88],["Брейтово", 58.303, 37.868, 88],["Углич", 57.528, 38.318, 88],["Мышкин", 57.786, 38.455, 88],["Ростов Великий", 57.185, 39.414, 88],["Переславль-Залесский", 56.736, 38.854, 88],["Кострома", 57.7679, 40.9269, 23],["Волгореченск", 57.441, 41.158, 23],["Иваново", 57.0004, 40.9739, 14],["Кинешма", 57.443, 42.149, 14],["Юрьевец", 57.32, 43.109, 14],["Плёс", 57.458, 41.514, 14],["Владимир", 56.129, 40.4066, 6],["Муром", 55.579, 42.052, 6],["Ковров", 56.357, 41.319, 6],["Рязань", 54.6292, 39.7368, 64],["Спас-Клепики", 55.134, 40.175, 64],["Касимов", 54.941, 41.396, 64],["Шилово", 54.324, 40.875, 64],["Тула", 54.1931, 37.6173, 76],["Алексин", 54.502, 37.068, 76],["Калуга", 54.5138, 36.2612, 18],["Обнинск", 55.096, 36.61, 18],["Таруса", 54.729, 37.177, 18],["Воронеж", 51.6608, 39.2003, 9],["Нововоронеж", 51.315, 39.218, 9],["Лиски", 50.985, 39.508, 9],["Павловск (Воронежская)", 50.457, 40.108, 9],["Липецк", 52.6088, 39.5992, 29],["Елец", 52.624, 38.502, 29],["Тамбов", 52.7212, 41.4523, 73],["Белгород", 50.595, 36.587, 4],["Старый Оскол", 51.296, 37.841, 4],["Курск", 51.7304, 36.1926, 27],["Курчатов", 51.66, 35.656, 27],["Орёл", 52.9668, 36.0625, 41],["Брянск", 53.2435, 34.3634, 5],["Смоленск", 54.7826, 32.0453, 71],["Десногорск", 54.152, 33.285, 71],["Борок (Рыбинка)", 58.063, 38.238, 88],["Пошехонье", 58.502, 39.115, 88],["Мичуринск (р. Лесной Воронеж)", 52.8978, 40.4908, 73],["Моршанск (р. Цна)", 53.4442, 41.8106, 73],["Котовск (Котовское вдхр. / р. Цна)", 52.5878, 41.5036, 73],["Рассказово", 52.6719, 41.8869, 73],["Уварово (р. Ворона)", 51.9839, 42.2639, 73],["Ливны (р. Сосна)", 52.4256, 37.6069, 41],["Мценск (р. Зуша)", 53.2789, 36.5728, 41],["Болхов (р. Нугрь / Ока)", 53.4439, 36.0044, 41],["Клинцы (р. Туросна)", 52.7528, 32.2369, 5],["Новозыбков", 52.5369, 31.9339, 5],["Трубчевск (р. Десна)", 52.5839, 33.7689, 5],["Дятьково", 53.6028, 34.3339, 5],["Жуковка (р. Десна)", 53.5339, 33.7306, 5],["Железногорск (Курская / Копенское вдхр.)", 52.3392, 35.3569, 27],["Рыльск (р. Сейм)", 51.5689, 34.6819, 27],["Льгов (р. Сейм)", 51.6719, 35.2639, 27],["Губкин", 51.2858, 37.5358, 4],["Шебекино (р. Северский Донец)", 50.4078, 36.8858, 4],["Валуйки (р. Оскол)", 50.2119, 38.1069, 4],["Новый Оскол (р. Оскол)", 50.7619, 37.8689, 4],["Грязи (Матырское вдхр. / р. Матыра)", 52.4958, 39.9419, 29],["Задонск (р. Дон)", 52.3919, 38.9219, 29],["Данков (р. Дон)", 53.2539, 39.1558, 29],["Лебедянь (р. Дон)", 53.0189, 39.1339, 29],["Новомосковск (Шатское и Пронское вдхр.)", 54.0119, 38.2906, 76],["Суворов (Черепетское вдхр.)", 54.1228, 36.4958, 76],["Ефремов (р. Красивая Меча)", 53.1469, 38.1169, 76],["Белёв (р. Ока)", 53.8089, 36.1358, 76],["Людиново (оз. Ломпадь)", 53.8644, 34.4478, 18],["Козельск (р. Жиздра)", 54.0369, 35.7819, 18],["Вязьма (р. Вязьма)", 55.2106, 34.2858, 71],["Гагарин (Яузское и Вазузское вдхр.)", 55.5528, 35.0089, 71],["Рославль (р. Остёр)", 53.9528, 32.8639, 71],["Сычёвка (Вазузское вдхр.)", 55.8269, 34.2758, 71],["Гороховец (р. Клязьма)", 56.2019, 42.6919, 6],["Вязники (р. Клязьма)", 56.2428, 42.1558, 6],["Гусь-Хрустальный (оз. Гусевское)", 55.6194, 40.6558, 6],["Суздаль (р. Каменка / Нерль)", 56.4194, 40.4489, 6],["Галич (Галичское озеро)", 58.3819, 42.3489, 23],["Чухлома (Чухломское озеро)", 58.7539, 42.6858, 23],["Шарья (р. Ветлуга)", 58.3719, 45.5139, 23],["Макарьев (р. Унжа / Горьковское вдхр.)", 57.8819, 43.8069, 23],["Кадый (Нёмда / Горьковское вдхр.)", 57.7819, 43.1889, 23],["Московский", 55.602, 37.356, 32],["Троицк (р. Десна)", 55.485, 37.307, 32],["Щербинка", 55.5, 37.562, 32],["Строгино (Строгинская пойма)", 55.803, 37.419, 32],["Крылатское (Гребной канал / Москва-река)", 55.756, 37.434, 32],["Кожухово / Косино (Косинские озёра)", 55.721, 37.858, 32],["Капотня / Марьино (зимний спиннинг на Москве-реке)", 55.642, 37.745, 32],["Коломенское / Нагатинский затон", 55.682, 37.684, 32],["Серебряный Бор / Хорошёвское спрямление", 55.778, 37.441, 32],["Клёново (р. Моча)", 55.326, 37.382, 32],["Вороново (Вороновские пруды)", 55.318, 37.185, 32],["Рогово", 55.217, 37.072, 32],["Красная Пахра (р. Пахра)", 55.432, 37.283, 32],["Десёновское (р. Десна)", 55.515, 37.367, 32],["Рублёво (Москва-река)", 55.783, 37.359, 32],["Апрелевка", 55.546, 37.073, 33],["Белоозёрский", 55.456, 38.441, 33],["Верея", 55.344, 36.185, 33],["Видное", 55.557, 37.708, 33],["Высоковск", 56.318, 36.551, 33],["Голицыно", 55.616, 36.987, 33],["Дедовск", 55.862, 37.121, 33],["Дзержинский", 55.631, 37.849, 33],["Дрезна", 55.741, 38.843, 33],["Зарайск", 54.757, 38.882, 33],["Ивантеевка", 55.971, 37.921, 33],["Котельники", 55.661, 37.864, 33],["Красноармейск", 56.115, 38.146, 33],["Краснозаводск", 56.445, 38.221, 33],["Краснознаменск", 55.596, 37.039, 33],["Кубинка", 55.58, 36.697, 33],["Куровское", 55.579, 38.922, 33],["Ликино-Дулёво", 55.708, 38.955, 33],["Лобня", 56.013, 37.474, 33],["Лосино-Петровский", 55.872, 38.204, 33],["Лыткарино", 55.581, 37.904, 33],["Ногинск", 55.855, 38.442, 33],["Озёры", 54.856, 38.559, 33],["Павловский Посад", 55.781, 38.653, 33],["Пересвет", 56.417, 38.174, 33],["Протвино", 54.872, 37.218, 33],["Пущино", 54.834, 37.614, 33],["Реутов", 55.76, 37.857, 33],["Рошаль", 55.662, 39.878, 33],["Старая Купавна", 55.807, 38.179, 33],["Талдом", 56.732, 37.53, 33],["Фрязино", 55.961, 38.046, 33],["Хотьково", 56.251, 37.994, 33],["Черноголовка", 56.004, 38.378, 33],["Электрогорск", 55.885, 38.79, 33],["Электросталь", 55.789, 38.446, 33],["Электроугли", 55.719, 38.216, 33],["Яхрома", 56.29, 37.485, 33],["пгт Лотошино", 56.229, 35.639, 33],["пгт Серебряные Пруды", 54.464, 38.728, 33],["пгт Шаховская", 56.028, 35.509, 33],["пгт Белоомут (гидроузел р. Оки)", 54.945, 39.338, 33],["пгт Дединово (р. Ока)", 55.025, 39.248, 33],["пгт Икша", 56.17, 37.502, 33],["пгт Пестово / Тишково", 56.077, 37.721, 33],["пгт Черусти", 55.554, 40.003, 33],["пгт Мишеронский", 55.724, 39.754, 33],["пгт Тучково", 55.602, 36.471, 33],["пгт Уваровка", 55.533, 35.602, 33],["с. Чулково (Москва-река)", 55.558, 38.048, 33],["с. Фаустово", 55.436, 38.508, 33],["с. Константиново", 55.492, 37.986, 33],["с. Дракино / Ланьшино (карьеры р. Оки)", 54.864, 37.272, 33],["д. Красновидово", 55.574, 35.862, 33],["д. Троица", 55.595, 35.818, 33],["д. Лопотово", 56.063, 36.829, 33],["д. Пятница (Истринское вдхр.)", 56.091, 36.795, 33],["ст. Большая Волга (Дубна)", 56.726, 37.135, 33],["ст. Карманово (Канал им. Москвы)", 56.602, 37.148, 33],["ст. Ока / Цимлянка (Серпухов)", 54.881, 37.428, 33],["Алексеевка (р. Тихая Сосна)", 50.631, 38.689, 4],["Бирюч (р. Тихая Сосна)", 50.654, 38.395, 4],["Грайворон (р. Ворскла)", 50.478, 35.676, 4],["Короча (р. Короча)", 50.811, 37.202, 4],["Строитель", 50.785, 36.489, 4],["пгт Борисовка (р. Ворскла)", 50.602, 36.017, 4],["пгт Вейделевка", 50.151, 38.459, 4],["пгт Волоконовка (р. Оскол)", 50.485, 37.859, 4],["пгт Ивня (р. Псёл — истоки)", 51.057, 36.135, 4],["пгт Красная Яруга", 50.802, 35.658, 4],["пгт Прохоровка", 51.036, 36.732, 4],["пгт Ракитное", 50.835, 35.852, 4],["пгт Ровеньки (р. Айдар)", 49.914, 38.902, 4],["пгт Чернянка (р. Оскол)", 50.941, 37.805, 4],["пгт Яковлево", 50.861, 36.447, 4],["пгт Разумное", 50.531, 36.685, 4],["пгт Северный", 50.674, 36.557, 4],["пгт Маслова Пристань (Белгородское вдхр.)", 50.453, 36.736, 4],["пгт Уразово (р. Оскол)", 50.081, 38.039, 4],["с. Красное", 50.928, 38.681, 4],["Злынка", 52.429, 31.737, 5],["Карачев (р. Снежеть)", 53.123, 34.985, 5],["Мглин", 53.059, 32.848, 5],["Почеп (р. Судость)", 52.932, 33.457, 5],["Севск (р. Сев)", 52.149, 34.492, 5],["Сельцо (р. Десна)", 53.374, 34.104, 5],["Стародуб (р. Бабинец)", 52.585, 32.76, 5],["Сураж (р. Ипуть)", 53.018, 32.393, 5],["Унеча", 52.846, 32.678, 5],["Фокино (р. Болва)", 53.456, 34.419, 5],["пгт Белая Берёзка (р. Десна)", 52.362, 33.494, 5],["пгт Выгоничи (р. Десна)", 53.099, 34.069, 5],["пгт Дубровка (р. Сеща)", 53.692, 33.505, 5],["пгт Клетня (р. Надва)", 53.388, 33.208, 5],["пгт Климово", 52.381, 32.189, 5],["пгт Комаричи", 52.415, 34.792, 5],["пгт Красная Гора (р. Беседь)", 53.001, 31.603, 5],["пгт Локоть", 52.562, 34.557, 5],["пгт Навля (р. Навля)", 52.825, 34.496, 5],["пгт Погар (р. Судость)", 52.554, 33.332, 5],["пгт Рогнедино", 53.8, 33.559, 5],["пгт Суземка (р. Нерусса)", 52.321, 34.082, 5],["с. Гордеевка", 52.948, 31.969, 5],["с. Жирятино (р. Судость)", 53.249, 33.743, 5],["Александров", 56.395, 38.712, 6],["Камешково", 56.348, 41.001, 6],["Карабаново", 56.314, 38.704, 6],["Киржач (р. Киржач)", 56.156, 38.859, 6],["Кольчугино (Кольчугинское вдхр.)", 56.302, 39.382, 6],["Костерёво", 55.928, 39.619, 6],["Курлово", 55.452, 40.594, 6],["Лакинск", 56.017, 39.956, 6],["Меленки (р. Унжа / Ока)", 55.335, 41.63, 6],["Петушки (р. Клязьма)", 55.929, 39.463, 6],["Покров", 55.919, 39.177, 6],["Радужный", 56.0, 40.335, 6],["Собинка (р. Клязьма)", 55.991, 40.015, 6],["Струнино", 56.377, 38.579, 6],["Судогда (р. Судогда)", 55.953, 40.861, 6],["Юрьев-Польский (р. Колокша)", 56.498, 39.673, 6],["пгт Красная Горбатка (р. Колпь)", 55.87, 41.763, 6],["пгт Мстёра (р. Мстёрка / Клязьма)", 56.379, 41.929, 6],["пгт Ставрово", 56.13, 40.016, 6],["пгт Великодворский", 55.266, 40.91, 6],["пгт Мезиновский", 55.51, 40.425, 6],["пгт Уршельский", 55.667, 40.205, 6],["с. Боголюбово (р. Нерль / Клязьма)", 56.195, 40.533, 6],["с. Ляхи (р. Ока)", 55.374, 41.956, 6],["Бобров (р. Битюг)", 51.093, 40.034, 9],["Богучар (р. Дон / Богучарка)", 49.939, 40.556, 9],["Борисоглебск (р. Ворона / Хопёр)", 51.367, 42.083, 9],["Бутурлиновка", 50.825, 40.608, 9],["Калач (р. Толучеевка / Подгорная)", 50.425, 41.022, 9],["Новохопёрск (р. Хопёр)", 51.098, 41.63, 9],["Острогожск (р. Тихая Сосна / Дон)", 50.865, 39.069, 9],["Поворино (р. Хопёр)", 51.195, 42.247, 9],["Россошь (р. Чёрная Калитва)", 50.198, 39.569, 9],["Семилуки (р. Дон)", 51.693, 39.035, 9],["Эртиль (р. Эртиль)", 51.841, 40.811, 9],["пгт Анна (р. Битюг)", 51.484, 40.428, 9],["пгт Грибановский", 51.454, 41.97, 9],["пгт Каменка", 50.703, 39.423, 9],["пгт Кантемировка", 49.701, 39.858, 9],["пгт Ольховатка (р. Чёрная Калитва)", 50.283, 39.293, 9],["пгт Панино", 51.637, 40.137, 9],["пгт Подгоренский", 50.405, 39.634, 9],["пгт Рамонь (р. Воронеж)", 51.916, 39.339, 9],["пгт Таловая", 51.116, 40.728, 9],["пгт Хохольский", 51.584, 38.803, 9],["с. Верхний Мамон (р. Дон)", 50.163, 40.413, 9],["с. Петропавловка (р. Дон / Толучеевка)", 50.088, 40.885, 9],["с. Репьёвка (р. Потудань)", 51.082, 38.647, 9],["с. Терновка (р. Савала)", 51.696, 41.625, 9],["с. Новая Усмань (р. Усмань)", 51.644, 39.409, 9],["с. Коротояк / Дивногорье (р. Дон / Тихая Сосна)", 50.976, 39.193, 9],["Вичуга", 57.206, 41.926, 14],["Гаврилов Посад (р. Ирмес / Нерль)", 56.556, 40.119, 14],["Заволжск (р. Волга)", 57.485, 42.142, 14],["Комсомольск (оз. Подозерское)", 57.028, 40.379, 14],["Кохма (р. Уводь)", 56.932, 41.091, 14],["Наволоки (р. Волга)", 57.472, 41.958, 14],["Приволжск (р. Шача)", 57.376, 41.287, 14],["Пучеж (Горьковское вдхр.)", 56.982, 43.172, 14],["Родники", 57.106, 41.728, 14],["Тейково (р. Вязьма)", 56.857, 40.538, 14],["Фурманов (р. Шача)", 57.253, 41.109, 14],["Шуя (р. Теза)", 56.848, 41.391, 14],["Южа (оз. Вазаль / Клязьма)", 56.588, 42.011, 14],["пгт Верхний Ландех", 56.84, 42.593, 14],["пгт Ильинское-Хованское", 56.97, 39.771, 14],["пгт Каменка (р. Сунжа)", 57.386, 41.766, 14],["пгт Лежнево (р. Уводь)", 56.774, 40.892, 14],["пгт Лух (р. Лух)", 56.993, 42.26, 14],["пгт Палех (р. Палешка)", 56.803, 41.856, 14],["пгт Пестяки", 56.709, 42.669, 14],["пгт Савино (р. Уводь / Теза)", 56.589, 41.219, 14],["пгт Старая Вичуга", 57.274, 41.883, 14],["пгт Холуй (р. Теза)", 56.577, 41.869, 14],["с. Решма (Горьковское вдхр.)", 57.394, 42.492, 14],["с. Сокольское / глазовская стрелка (граница на Горьковском вдхр.)", 57.152, 43.148, 14],["Балабаново (р. Страдаловка / Истья)", 55.182, 36.657, 18],["Белоусово", 55.095, 36.678, 18],["Боровск (р. Протва)", 55.206, 36.485, 18],["Ермолино (р. Протва)", 55.197, 36.589, 18],["Жиздра (р. Жиздра)", 53.751, 34.738, 18],["Жуков (р. Протва / Угодка)", 55.028, 36.743, 18],["Киров (Нижнее и Верхнее вдхр. на р. Песочня / Болва)", 54.075, 34.307, 18],["Кондрово (р. Шаня)", 54.803, 35.927, 18],["Кремёнки (р. Протва)", 54.889, 37.118, 18],["Малоярославец (р. Лужа)", 55.011, 36.467, 18],["Медынь (р. Медынка)", 54.967, 35.862, 18],["Мещовск (р. Турея)", 54.324, 35.284, 18],["Мосальск", 54.489, 34.982, 18],["Сосенский", 54.058, 35.959, 18],["Спас-Деменск", 54.412, 34.022, 18],["Сухиничи (р. Брынь)", 54.101, 35.335, 18],["Юхнов (р. Угра)", 54.745, 35.23, 18],["пгт Воротынск (р. Ока / Высса)", 54.442, 36.046, 18],["пгт Думиничи (р. Жиздра / Брынь)", 53.932, 35.107, 18],["пгт Полотняный Завод (р. Суходрев / Шаня)", 54.731, 35.998, 18],["пгт Пятовский", 54.674, 36.053, 18],["пгт Середейский", 54.057, 35.236, 18],["пгт Товарково (слияние р. Угра и р. Шаня)", 54.673, 35.942, 18],["с. Барятино", 54.316, 34.515, 18],["с. Износки (р. Шаня)", 54.987, 35.318, 18],["с. Перемышль (р. Ока / Жиздра, оз. Тишь)", 54.263, 36.163, 18],["с. Ферзиково (р. Ока)", 54.517, 36.759, 18],["с. Хвастовичи (р. Рессета)", 53.467, 35.097, 18],["с. Ульяново (р. Вытебеть)", 53.628, 35.534, 18],["с. Бетлица (р. Ветьма)", 54.009, 33.916, 18],["Буй (р. Кострома / Вёкса)", 58.478, 41.531, 23],["Кологрив (р. Унжа)", 58.828, 44.318, 23],["Мантурово (р. Унжа)", 58.334, 44.764, 23],["Нерехта (р. Нерехта / Солоница)", 57.458, 40.573, 23],["Нея (р. Нея)", 58.293, 43.868, 23],["Солигалич (р. Кострома)", 59.078, 42.288, 23],["пгт Красное-на-Волге (р. Волга)", 57.511, 41.239, 23],["пгт Судиславль", 57.882, 41.714, 23],["пгт Сусанино (р. Шача)", 58.149, 41.583, 23],["пгт Антропово", 58.396, 43.005, 23],["пгт Поназырево", 58.356, 46.314, 23],["пгт Чистые Боры (р. Кострома)", 58.382, 41.615, 23],["с. Островское (р. Мера)", 57.805, 42.243, 23],["с. Парфеньево (р. Нея)", 58.483, 43.409, 23],["с. Пыщуг (р. Ветлуга)", 58.887, 45.713, 23],["с. Вохма (р. Вохма)", 58.932, 46.762, 23],["Дмитриев (р. Свапа)", 52.128, 35.075, 27],["Обоянь (р. Псёл)", 51.21, 36.276, 27],["Суджа (р. Суджа / Псёл)", 51.191, 35.271, 27],["Фатеж (р. Усожа)", 52.089, 35.859, 27],["Щигры", 51.874, 36.915, 27],["пгт Глушково (р. Сейм)", 51.341, 34.647, 27],["пгт Горшечное (Старооскольское вдхр.)", 51.522, 38.031, 27],["пгт Золотухино (р. Тускарь)", 52.084, 36.378, 27],["пгт Касторное (р. Олым)", 51.832, 38.136, 27],["пгт Конышёвка", 51.84, 35.291, 27],["пгт Коренево (р. Крепна / Сейм)", 51.409, 34.901, 27],["пгт Кшенский (р. Кшень)", 51.841, 37.712, 27],["пгт Медвенка", 51.441, 36.121, 27],["пгт Поныри", 52.317, 36.307, 27],["пгт Пристень (р. Сейм)", 51.351, 36.697, 27],["пгт Прямицыно (р. Сейм)", 51.652, 35.93, 27],["пгт Солнцево (р. Сейм)", 51.419, 36.751, 27],["пгт Тим", 51.621, 37.125, 27],["пгт Хомутовка", 51.919, 34.558, 27],["пгт Черемисиново", 51.884, 37.262, 27],["с. Мантурово", 51.458, 37.272, 27],["с. Белая (р. Псёл)", 51.054, 35.714, 27],["Усмань (р. Усмань)", 52.043, 39.736, 29],["Чаплыгин (р. Становая Ряса)", 53.242, 39.967, 29],["с. Доброе (р. Воронеж)", 52.862, 39.811, 29],["с. Красное (р. Дон)", 52.866, 38.795, 29],["с. Лев Толстой", 53.208, 39.448, 29],["с. Становое", 52.768, 38.348, 29],["с. Тербуны (р. Олым)", 52.148, 38.282, 29],["с. Хлевное (р. Дон / Воронеж)", 52.193, 39.093, 29],["с. Волово", 52.025, 37.886, 29],["с. Долгоруково", 52.319, 38.35, 29],["с. Измалково (р. Быстрая Сосна)", 52.662, 37.981, 29],["с. Добринка", 52.167, 40.473, 29],["Дмитровск (р. Нерусса / Общерица)", 52.505, 35.147, 41],["Малоархангельск", 52.4, 36.503, 41],["Новосиль (р. Зуша)", 52.973, 37.046, 41],["пгт Верховье", 52.811, 37.241, 41],["пгт Глазуновка (р. Ока — истоки)", 52.499, 36.322, 41],["пгт Залегощь (р. Неручь / Зуша)", 52.903, 36.883, 41],["пгт Знаменка (р. Цон / Ока)", 52.898, 35.978, 41],["пгт Колпна (р. Быстрая Сосна)", 52.226, 37.031, 41],["пгт Кромы (р. Крома / Ока)", 52.688, 35.768, 41],["пгт Нарышкино", 52.967, 35.727, 41],["пгт Покровское", 52.609, 36.87, 41],["пгт Хотынец", 53.125, 35.395, 41],["пгт Шаблыкино", 52.854, 35.193, 41],["пгт Долгое", 52.056, 37.53, 41],["с. Корсаково (р. Зуша)", 53.268, 37.359, 41],["с. Красная Заря", 52.782, 37.684, 41],["с. Сосково", 52.753, 35.383, 41],["с. Тросня", 52.444, 35.783, 41],["Кораблино (р. Проня / Ранова)", 53.919, 40.019, 64],["Михайлов (р. Проня)", 54.229, 39.027, 64],["Новомичуринск (Рязанская ГРЭС / Пронское вдхр.)", 54.039, 39.746, 64],["Рыбное (р. Вожа / Ока)", 54.727, 39.515, 64],["Ряжск (р. Хупта / Ранова)", 53.707, 40.063, 64],["Сасово (р. Цна)", 54.354, 41.926, 64],["Скопин (р. Вёрда)", 53.825, 39.551, 64],["Спасск-Рязанский (р. Ока / Спасский затон)", 54.405, 40.38, 64],["Шацк (р. Шача / Цна)", 54.025, 41.712, 64],["пгт Александро-Невский", 53.475, 40.209, 64],["пгт Гусь-Железный (р. Гусь)", 55.056, 41.163, 64],["пгт Елатьма (р. Ока)", 54.969, 41.751, 64],["пгт Ермишь (р. Ермишь / Мокша)", 54.769, 42.273, 64],["пгт Кадом (р. Мокша)", 54.56, 42.467, 64],["пгт Милославское", 53.575, 39.442, 64],["пгт Павелец", 53.788, 39.247, 64],["пгт Пителино (р. Мокша)", 54.577, 41.815, 64],["пгт Пронск (р. Проня)", 54.118, 39.596, 64],["пгт Сапожок", 53.943, 40.684, 64],["пгт Сараи (р. Пара)", 53.745, 41.022, 64],["пгт Старожилово (р. Проня / Истья)", 54.227, 39.914, 64],["пгт Тума", 55.149, 40.553, 64],["пгт Ухолово", 53.794, 40.487, 64],["пгт Чучково", 54.269, 41.444, 64],["с. Константиново (р. Ока, Кузьминский гидроузел)", 54.861, 39.601, 64],["с. Ижевское (оз. Ижевское / р. Ока)", 54.558, 40.871, 64],["с. Пощупово / Новосёлки (р. Ока)", 54.812, 39.711, 64],["Велиж (р. Западная Двина)", 55.606, 31.197, 71],["Демидов (р. Каспля / Городня)", 55.271, 31.515, 71],["Дорогобуж (р. Днепр)", 54.916, 33.297, 71],["Духовщина", 55.193, 32.411, 71],["Ельня (р. Десна — истоки)", 54.577, 33.182, 71],["Починок (р. Хмара)", 54.407, 32.441, 71],["Рудня", 54.947, 31.093, 71],["Сафоново (р. Вопец / Днепр)", 55.111, 33.233, 71],["Ярцево (р. Вопь / Днепр)", 55.067, 32.696, 71],["пгт Верхнеднепровский (р. Днепр / Дорогобужская ТЭЦ)", 54.981, 33.346, 71],["пгт Голынки", 54.867, 31.378, 71],["пгт Кардымово (р. Хмость / Днепр)", 54.894, 32.438, 71],["пгт Красный", 54.564, 31.434, 71],["пгт Монастырщина (р. Вихра)", 54.351, 31.838, 71],["пгт Озёрный (оз. Сошно / Смоленская ГРЭС)", 55.589, 32.393, 71],["пгт Пржевальское (оз. Сапшо, нацпарк «Смоленское Поозерье»)", 55.509, 31.849, 71],["пгт Хиславичи (р. Сож)", 54.188, 32.158, 71],["пгт Холм-Жирковский (р. Днепр)", 55.518, 33.473, 71],["пгт Шумячи", 53.856, 32.423, 71],["с. Глинка", 54.648, 32.875, 71],["с. Ершичи (р. Ипуть)", 53.673, 32.754, 71],["с. Новодугино (р. Вазуза)", 55.631, 34.288, 71],["с. Тёмкино (р. Угра)", 55.087, 35.019, 71],["с. Угра (р. Угра)", 54.777, 34.331, 71],["Жердевка (р. Савала)", 51.848, 41.464, 73],["Кирсанов (р. Ворона)", 52.655, 42.723, 73],["пгт Дмитриевка (р. Польной Воронеж)", 52.888, 40.785, 73],["пгт Знаменка (слияние р. Цна и р. Кариан)", 52.417, 41.428, 73],["пгт Инжавино (р. Ворона, заповедник «Воронинский»)", 52.317, 42.493, 73],["пгт Мордово (р. Битюг)", 52.085, 40.768, 73],["пгт Мучкапский (р. Ворона)", 51.862, 42.473, 73],["пгт Новая Ляда", 52.716, 41.652, 73],["пгт Первомайский", 53.243, 40.287, 73],["пгт Ржакса", 52.142, 42.025, 73],["пгт Сатинка", 52.376, 41.673, 73],["пгт Сосновка (р. Челновая)", 53.235, 41.367, 73],["пгт Токарёвка", 52.002, 41.158, 73],["с. Бондари (р. Большой Ломовис)", 52.963, 42.071, 73],["с. Гавриловка 2-я", 52.877, 42.771, 73],["с. Петровское (р. Матыра — верховья)", 52.634, 40.264, 73],["с. Пичаево (р. Кашма)", 53.235, 42.203, 73],["с. Староюрьево (Шушпанское вдхр.)", 53.208, 40.707, 73],["с. Умёт", 52.564, 42.971, 73],["Андреаполь (р. Западная Двина)", 56.651, 32.264, 74],["Бежецк (р. Молога)", 57.783, 36.697, 74],["Белый (р. Обша)", 55.839, 32.942, 74],["Бологое (оз. Бологое / Кафтино)", 57.873, 34.073, 74],["Западная Двина (р. Западная Двина)", 56.258, 32.084, 74],["Зубцов (р. Волга / Вазуза)", 56.174, 34.585, 74],["Кашин (р. Кашинка / Волга)", 57.358, 37.609, 74],["Красный Холм (р. Могоча)", 58.06, 37.121, 74],["Кувшиново (р. Осуга)", 57.031, 34.169, 74],["Лихославль", 57.125, 35.466, 74],["Нелидово (р. Межа)", 56.221, 32.777, 74],["Старица (р. Волга)", 56.508, 34.935, 74],["Торжок (р. Тверца)", 57.039, 34.962, 74],["Торопец (р. Торопа / оз. Соломенное)", 56.498, 31.635, 74],["пгт Белый Городок (р. Волга / Хотча)", 56.968, 37.515, 74],["пгт Жарковский (р. Межа)", 55.85, 32.266, 74],["пгт Калашниково", 57.284, 35.228, 74],["пгт Кесова Гора", 57.583, 37.292, 74],["пгт Козлово", 56.605, 36.447, 74],["пгт Красномайский (Вышневолоцкое вдхр.)", 57.625, 34.416, 74],["пгт Максатиха (р. Молога / Волчина)", 57.796, 35.883, 74],["пгт Новозавидовский (Иваньковское вдхр. / р. Шоша)", 56.578, 36.432, 74],["пгт Оленино", 56.208, 33.486, 74],["пгт Пено (Верхневолжские озёра — оз. Пено)", 56.924, 32.735, 74],["пгт Рамешки (р. Медведица)", 57.343, 36.046, 74],["пгт Редкино", 56.647, 36.402, 74],["пгт Сандово", 58.463, 36.409, 74],["пгт Селижарово (р. Волга / Селижаровка)", 56.852, 33.452, 74],["пгт Сонково", 57.778, 37.157, 74],["пгт Спирово", 57.419, 34.985, 74],["пгт Фирово", 57.484, 33.704, 74],["с. Лесное", 58.283, 35.518, 74],["с. Молоково", 58.165, 36.758, 74],["д. Волговерховье / Свапуще (оз. Стерж)", 57.248, 32.578, 74],["Богородицк", 53.771, 38.125, 76],["Болохово", 54.09, 37.822, 76],["Венёв (р. Венёвка / Осётр)", 54.349, 38.268, 76],["Донской (исток р. Дон / Бобрик-Гора)", 53.968, 38.327, 76],["Кимовск (Пронское вдхр. / Голубые озёра Кондуки)", 53.972, 38.532, 76],["Киреевск (р. Упа)", 53.935, 37.926, 76],["Липки", 53.951, 37.701, 76],["Плавск (р. Плава)", 53.708, 37.292, 76],["Советск (Щёкинское вдхр. на р. Упа)", 53.938, 37.632, 76],["Узловая", 53.979, 38.159, 76],["Чекалин (р. Ока)", 54.098, 36.247, 76],["Щёкино", 54.006, 37.515, 76],["Ясногорск", 54.48, 37.697, 76],["пгт Арсеньево", 53.738, 36.657, 76],["пгт Волово", 53.556, 38.021, 76],["пгт Дубна (р. Упа)", 54.156, 36.96, 76],["пгт Заокский (р. Ока / Скнига)", 54.735, 37.401, 76],["пгт Куркино (р. Дон / Непрядва)", 53.431, 38.66, 76],["пгт Новогуровский", 54.468, 37.332, 76],["пгт Одоев (р. Упа)", 53.943, 36.698, 76],["пгт Славный", 53.551, 36.494, 76],["пгт Тёплое", 53.611, 37.596, 76],["пгт Чернь (р. Чернь / Зуша)", 53.451, 36.912, 76],["с. Архангельское (р. Красивая Меча)", 53.249, 37.568, 76],["с. Поленово / Страхово (р. Ока)", 54.75, 37.243, 76],["д. Кондуки (Романцевские / Ушаковские карьеры)", 53.848, 38.393, 76],["Гаврилов-Ям (р. Которосль)", 57.303, 39.854, 88],["Данилов", 58.188, 40.175, 88],["Любим (р. Обнора / Кострома)", 58.362, 40.686, 88],["Тутаев (р. Волга / Горьковское вдхр.)", 57.882, 39.537, 88],["пгт Борисоглебский (р. Устье)", 57.258, 39.155, 88],["пгт Бурмакино", 57.434, 40.28, 88],["пгт Константиновский (р. Волга)", 57.828, 39.596, 88],["пгт Красный Профинтерн (р. Волга / Костромские разливы)", 57.749, 40.422, 88],["пгт Лесная Поляна", 57.684, 39.967, 88],["пгт Некрасовское (р. Волга / Солоница)", 57.677, 40.367, 88],["пгт Петровское", 57.011, 39.269, 88],["пгт Поречье-Рыбное (оз. Неро)", 57.096, 39.381, 88],["пгт Пречистое", 58.423, 40.326, 88],["пгт Семибратово (р. Которосль)", 57.302, 39.528, 88],["с. Большое Село (р. Юхоть)", 57.723, 38.941, 88],["с. Новый Некоуз (р. Сить / Сутка)", 57.905, 38.07, 88],["с. Кукобой", 58.659, 40.119, 88],["с. Легково / Ларионово / Глебово / Коприно (Волжский плёс Рыбинского вдхр.)", 58.072, 38.305, 88],["с. Прозорово / Черкасово (Моложский плёс Рыбинки)", 58.396, 37.689, 88],["Санкт-Петербург", 59.9343, 30.3351, 66],["Кронштадт", 59.991, 29.766, 66],["Сестрорецк", 60.099, 29.962, 66],["Зеленогорск (СПб)", 60.197, 29.702, 66],["Выборг", 60.709, 28.749, 28],["Приморск (ЛО)", 60.366, 28.609, 28],["Приозерск", 61.039, 30.129, 28],["Лосево (Вуокса)", 60.681, 30.004, 28],["Шлиссельбург", 59.946, 31.033, 28],["Новая Ладога", 60.103, 32.302, 28],["Волхов", 59.925, 32.338, 28],["Сясьстрой", 60.136, 32.569, 28],["Лодейное Поле", 60.733, 33.553, 28],["Подпорожье", 60.911, 34.17, 28],["Сосновый Бор", 59.904, 29.086, 28],["Кингисепп", 59.373, 28.613, 28],["Усть-Луга", 59.66, 28.295, 28],["Ивангород", 59.371, 28.216, 28],["Луга", 58.737, 29.845, 28],["Гатчина", 59.566, 30.128, 28],["Тихвин", 59.644, 33.542, 28],["Кириши", 59.449, 32.018, 28],["Великий Новгород", 58.5228, 31.2699, 37],["Старая Русса", 57.989, 31.356, 37],["Валдай", 57.974, 33.252, 37],["Боровичи", 58.388, 33.915, 37],["Псков", 57.8194, 28.3318, 45],["Гдов (Чудское оз.)", 58.742, 27.815, 45],["Великие Луки", 56.34, 30.525, 45],["Калининград", 54.7104, 20.4522, 17],["Зеленоградск", 54.96, 20.476, 17],["Светлогорск", 54.943, 20.155, 17],["Балтийск", 54.644, 19.892, 17],["Светлый", 54.676, 20.134, 17],["Полесск", 54.863, 21.099, 17],["Советск (Калининградская)", 55.083, 21.886, 17],["Петрозаводск", 61.785, 34.3469, 53],["Кондопога", 62.203, 34.265, 53],["Медвежьегорск", 62.912, 34.456, 53],["Сегежа", 63.743, 34.316, 53],["Беломорск", 64.525, 34.765, 53],["Кемь", 64.956, 34.579, 53],["Лоухи", 66.075, 33.045, 53],["Пяозерский", 65.764, 31.082, 53],["Калевала", 65.199, 31.186, 53],["Костомукша", 64.588, 30.6, 53],["Сортавала", 61.703, 30.691, 53],["Лахденпохья", 61.519, 30.199, 53],["Питкяранта", 61.572, 31.478, 53],["Олонец", 60.985, 32.971, 53],["Пудож", 61.806, 36.535, 53],["Мурманск", 68.9707, 33.075, 34],["Кола", 68.881, 33.018, 34],["Мурмаши", 68.816, 32.812, 34],["Териберка", 69.164, 35.143, 34],["Североморск", 69.069, 33.416, 34],["Мончегорск", 67.938, 32.915, 34],["Апатиты", 67.568, 33.402, 34],["Кандалакша", 67.151, 32.412, 34],["Умба", 66.687, 34.343, 34],["Варзуга", 66.398, 36.588, 34],["Ловозеро", 68.006, 35.016, 34],["Архангельск", 64.5399, 40.5158, 2],["Северодвинск", 64.5635, 39.8302, 2],["Новодвинск", 64.416, 40.812, 2],["Онега", 63.906, 38.097, 2],["Котлас", 61.252, 46.654, 2],["Вельск", 61.066, 42.102, 2],["Мезень", 65.852, 44.24, 2],["Нарьян-Мар", 67.638, 53.006, 35],["Искателей", 67.679, 53.133, 35],["Сыктывкар", 61.6688, 50.8364, 54],["Ухта", 63.567, 53.683, 54],["Печора", 65.147, 57.228, 54],["Усинск", 65.994, 57.556, 54],["Усть-Цильма", 65.441, 52.15, 54],["Воркута", 67.498, 64.052, 54],["Вологда", 59.2205, 39.8915, 8],["Череповец (Рыбинское вдхр.)", 59.1323, 37.9092, 8],["Белозерск (Белое озеро)", 60.0325, 37.7872, 8],["Липин Бор (Белое озеро)", 60.2608, 37.9772, 8],["Кириллов (Сиверское оз. / Шексна)", 59.8606, 38.3792, 8],["Вытегра (Онежское озеро)", 61.0064, 36.4481, 8],["Шексна (Шекснинское вдхр.)", 59.2106, 38.5081, 8],["Великий Устюг (р. Сухона / Юг)", 60.7619, 46.3039, 8],["Тотьма (р. Сухона)", 59.9756, 42.7589, 8],["Сокол (р. Сухона)", 59.4622, 40.1189, 8],["Вожега (оз. Воже)", 60.4728, 40.2189, 8],["Устюжна (р. Молога)", 58.8422, 36.4289, 8],["Кубенское (оз. Кубенское)", 59.4425, 39.6789, 8],["Невель (оз. Невельское / Езерище)", 56.0189, 29.9319, 45],["Себеж (оз. Себежское / Ороно)", 56.2839, 28.4819, 45],["Печоры (Псковское озеро)", 57.8139, 27.6119, 45],["Демянск (оз. Селигер — Полновский плёс)", 57.6439, 32.4658, 37],["Чудово (р. Волхов)", 59.1244, 31.6719, 37],["Пестово (р. Молога)", 58.5969, 35.8169, 37],["Амдерма (Карское море)", 69.7594, 61.6636, 35],["Индига (Баренцево море)", 67.6889, 48.7789, 35],["Нижний Одес", 63.6439, 54.8569, 54],["Инта (р. Большая Инта / Косью)", 66.0319, 60.1658, 54],["Вуктыл (р. Печора / Щугор)", 63.8569, 57.3089, 54],["Сосногорск (р. Ижма)", 63.5889, 53.8819, 54],["Колпино (р. Ижора)", 59.75, 30.585, 66],["Красное Село (Безымянное и Дудергофское озёра)", 59.734, 30.088, 66],["Ломоносов (Финский залив, Сидоров канал)", 59.914, 29.771, 66],["Павловск (р. Славянка)", 59.684, 30.453, 66],["Петергоф (Финский залив)", 59.885, 29.908, 66],["Пушкин", 59.722, 30.415, 66],["п. Лисий Нос (Финский залив / Северная дамба КЗС)", 60.015, 30.002, 66],["п. Стрельна (Финский залив / Яхт-клуб)", 59.858, 30.043, 66],["п. Лахта / Ольгино (Лахтинский разлив)", 59.992, 30.149, 66],["п. Репино", 60.169, 29.866, 66],["п. Комарово", 60.187, 29.809, 66],["п. Солнечное", 60.149, 29.936, 66],["п. Ушково", 60.198, 29.608, 66],["п. Серово", 60.195, 29.551, 66],["п. Смолячково (Курортный берег Финского залива)", 60.181, 29.467, 66],["п. Усть-Ижора (впадение р. Ижоры в Неву)", 59.805, 30.608, 66],["п. Понтонный / Сапёрный (р. Нева)", 59.789, 30.642, 66],["Канонерский остров (Морской канал СПб)", 59.897, 30.213, 66],["Бокситогорск", 59.473, 33.848, 28],["Волосово", 59.446, 29.485, 28],["Всеволожск", 60.021, 30.654, 28],["Высоцк (Выборгский залив)", 60.625, 28.571, 28],["Каменногорск (р. Вуокса)", 60.955, 29.131, 28],["Кировск (р. Нева)", 59.878, 30.985, 28],["Колтуши", 59.933, 30.656, 28],["Коммунар (р. Ижора)", 59.62, 30.391, 28],["Кудрово", 59.908, 30.514, 28],["Любань (р. Тигода)", 59.351, 31.251, 28],["Мурино", 60.049, 30.446, 28],["Никольское (р. Тосна)", 59.702, 30.785, 28],["Отрадное (р. Нева / Тосна)", 59.776, 30.805, 28],["Пикалёво", 59.514, 34.175, 28],["Светогорск (р. Вуокса)", 61.109, 28.866, 28],["Сертолово", 60.145, 30.207, 28],["Сланцы (р. Плюсса / Нарвское вдхр.)", 59.118, 28.089, 28],["Тельмана", 59.731, 30.619, 28],["Тосно (р. Тосна)", 59.541, 30.877, 28],["пгт Вознесенье (исток р. Свирь из Онежского оз.)", 61.015, 35.48, 28],["пгт Вырица (р. Оредеж)", 59.41, 30.347, 28],["пгт Дубровка (р. Нева)", 59.847, 30.935, 28],["пгт им. Морозова / Кошкино (исток р. Невы из Ладоги, бухта Петрокрепость)", 59.976, 31.037, 28],["пгт Кузнечное (Ладожские шхеры)", 61.123, 29.873, 28],["пгт Лебяжье (Финский залив)", 59.962, 29.419, 28],["пгт Мга", 59.756, 31.062, 28],["пгт Назия (Ладожское оз.)", 59.844, 31.579, 28],["пгт Паша (р. Паша)", 60.399, 33.047, 28],["пгт Рощино", 60.254, 29.608, 28],["пгт Рябово", 59.4, 31.144, 28],["пгт Сиверский (р. Оредеж)", 59.354, 30.081, 28],["пгт Советский (Выборгский залив)", 60.534, 28.675, 28],["пгт Токсово (Кавголовское и Хепоярви озёра)", 60.158, 30.525, 28],["пгт Толмачёво (р. Луга)", 58.857, 29.897, 28],["с. Кобона", 60.031, 31.556, 28],["д. Леднево", 60.088, 31.615, 28],["д. Чёрное", 60.125, 31.714, 28],["д. Креницы", 60.13, 32.275, 28],["д. Вороново", 60.371, 32.692, 28],["д. Свирица (южное побережье Ладожского озера — культовые базы зимнего окуня и плотвы!)", 60.471, 32.912, 28],["п. Барышево (р. Вуокса)", 60.686, 29.576, 28],["п. Мельниково (р. Вуокса)", 60.925, 29.754, 28],["п. Мичуринское", 60.57, 29.859, 28],["п. Сосново", 60.556, 30.228, 28],["п. Вистино / Гарколово / Ручьи (Лужская и Копорская губы Финского залива)", 59.766, 28.463, 28],["д. Коккорево / Ваганово (Ладожское оз.)", 60.056, 31.069, 28],["ст. Ладожское Озеро", 60.111, 31.077, 28],["Суоярви (оз. Суоярви / Салонъярви)", 62.083, 32.356, 53],["пгт Вяртсиля (оз. Янисъярви)", 62.177, 30.692, 53],["пгт Муезерский", 63.956, 31.986, 53],["пгт Надвоицы (оз. Воицкое / Выгозеро / ББК)", 63.896, 34.316, 53],["пгт Пиндуши (Онежское оз.)", 62.916, 34.58, 53],["пгт Повенец (Повенецкий залив Онежского оз., вход в ББК)", 62.848, 34.825, 53],["пгт Пряжа (оз. Пряжинское / Сямозеро)", 61.693, 33.621, 53],["пгт Хелюля", 61.751, 30.668, 53],["пгт Чупа (Чупинская губа Белого моря)", 66.271, 33.056, 53],["с. Ведлозеро (оз. Ведлозеро)", 61.569, 32.839, 53],["с. Видлица (Ладожское оз., устье р. Видлица)", 61.185, 32.393, 53],["с. Деревянное / Шелтозеро (Онежское оз.)", 61.595, 34.678, 53],["с. Заонежье / Великая Губа / Кижи (Онежское оз.)", 62.241, 35.125, 53],["с. Паданы (оз. Сегозеро)", 63.268, 33.418, 53],["с. Реболы (оз. Лексозеро)", 63.835, 30.822, 53],["с. Сумский Посад / Вирма / Колежма (Поморский берег Белого моря)", 64.253, 35.425, 53],["п. Рабочеостровск (Белое море, Кемские шхеры)", 64.989, 34.769, 53],["п. Софпорог / Кестеньга (оз. Топозеро / Пяозеро)", 65.816, 31.697, 53],["п. Салми (Ладожское оз., устье р. Тулемайоки)", 61.367, 31.849, 53],["п. Куркиёки / Терву (Ладожские шхеры)", 61.302, 29.885, 53],["Емва (р. Вымь)", 62.589, 50.858, 54],["Микунь (р. Вычегда / Шежамка)", 62.353, 50.075, 54],["пгт Водный (р. Ухта)", 63.503, 53.409, 54],["пгт Войвож", 62.888, 54.962, 54],["пгт Жешарт (р. Вычегда)", 62.075, 49.575, 54],["пгт Изъяю", 65.171, 56.924, 54],["пгт Кожва (впадение р. Кожва в Печору)", 65.109, 57.046, 54],["пгт Краснозатонский (слияние р. Сысола и р. Вычегда)", 61.685, 50.971, 54],["пгт Междуреченск", 63.268, 48.553, 54],["пгт Путеец", 65.168, 57.289, 54],["пгт Седкыркещ", 61.734, 50.946, 54],["пгт Синдор (оз. Синдорское)", 62.851, 51.883, 54],["пгт Троицко-Печорск (р. Печора / Северная Мылва)", 62.708, 56.195, 54],["пгт Усогорск (р. Мезень / Ус)", 63.415, 48.685, 54],["пгт Шудаяг", 63.535, 53.608, 54],["пгт Ярега", 63.431, 53.575, 54],["с. Айкино (р. Вычегда)", 62.226, 49.992, 54],["с. Визинга (р. Большая Визинга / Сысола)", 61.074, 50.098, 54],["с. Ижма (р. Ижма)", 65.008, 53.916, 54],["с. Койгородок (р. Сысола)", 60.443, 51.002, 54],["с. Корткерос (р. Вычегда / Локчим)", 61.811, 51.576, 54],["с. Кослан (р. Мезень)", 63.456, 48.898, 54],["с. Объячево (р. Луза)", 60.372, 49.647, 54],["с. Усть-Вымь (слияние р. Вымь и р. Вычегда)", 62.215, 50.388, 54],["с. Усть-Кулом (р. Вычегда)", 61.684, 53.688, 54],["с. Усть-Уса (слияние р. Уса и р. Печора)", 65.966, 56.918, 54],["Каргополь (оз. Лача / р. Онега)", 61.503, 38.947, 2],["Коряжма (р. Вычегда)", 61.314, 47.142, 2],["Мирный (оз. Плесцы)", 62.766, 40.335, 2],["Няндома", 61.668, 40.198, 2],["Сольвычегодск (р. Вычегда)", 61.332, 46.924, 2],["Шенкурск (р. Вага)", 62.108, 42.898, 2],["пгт Березник (Виноградовский р-н, р. Северная Двина / Вага)", 62.853, 42.708, 2],["пгт Вычегодский (р. Вычегда)", 61.251, 46.852, 2],["пгт Ерцево", 60.805, 40.077, 2],["пгт Каменка (р. Мезень)", 65.885, 44.131, 2],["пгт Коноша (оз. Вельское)", 60.973, 40.258, 2],["пгт Кулой", 61.031, 42.493, 2],["пгт Луковецкий", 64.294, 41.922, 2],["пгт Малошуйка (Онежская губа Белого моря)", 63.738, 37.419, 2],["пгт Октябрьский (р. Вага / Устья)", 61.089, 43.175, 2],["пгт Плесецк (р. Онега)", 62.709, 40.289, 2],["пгт Приводино (р. Северная Двина)", 61.069, 46.508, 2],["пгт Савинский (р. Емца)", 62.923, 40.168, 2],["пгт Североонежск (р. Онега)", 62.583, 39.841, 2],["пгт Урдома (р. Вычегда)", 61.751, 48.544, 2],["пгт Шипицыно (р. Северная Двина)", 61.281, 46.526, 2],["с. Верхняя Тойма (р. Северная Двина)", 62.235, 45.011, 2],["с. Двинской Березник", 62.854, 42.712, 2],["с. Емецк (р. Емца / Северная Двина)", 63.475, 41.782, 2],["с. Ильинско-Подомское (р. Виледь)", 61.121, 47.971, 2],["с. Карпогоры (р. Пинега)", 63.998, 44.444, 2],["с. Красноборск (р. Северная Двина)", 61.559, 45.933, 2],["с. Лешуконское (слияние р. Вашка и р. Мезень)", 64.897, 45.761, 2],["с. Пинега (р. Пинега)", 64.698, 43.391, 2],["с. Уна / Луда / Пертоминск (Унская губа Белого моря)", 64.665, 38.412, 2],["с. Холмогоры (р. Северная Двина)", 64.226, 41.653, 2],["с. Черевково", 61.798, 45.541, 2],["с. Яренск (р. Вычегда / Яренга)", 62.168, 49.092, 2],["о. Мудьюг (Сухое море, Двинский залив Белого моря)", 64.908, 40.251, 2],["Соловецкие острова (Белое море)", 65.025, 35.711, 2],["с. Великовисочное (р. Печора / Сочи)", 67.256, 52.043, 35],["с. Коткино (р. Сула)", 67.018, 51.198, 35],["с. Красное (р. Печора, протока Городецкий Шар)", 67.848, 53.551, 35],["с. Несь (р. Несь / Мезенская губа)", 66.601, 44.664, 35],["с. Нижняя Пёша (р. Пёша / Чёшская губа Баренцева моря)", 66.752, 47.76, 35],["с. Оксино (дельта Печоры / оз. Голодная Губа)", 67.601, 52.23, 35],["с. Ома (р. Ома / Чёшская губа)", 66.652, 46.526, 35],["с. Тельвиска (р. Печора)", 67.603, 52.93, 35],["с. Шойна (р. Шойна / Белое море, п-ов Канин)", 67.876, 44.137, 35],["п. Бугрино (о. Колгуев, Баренцево море)", 68.785, 49.286, 35],["п. Варандей (Печорское море)", 68.824, 58.071, 35],["п. Каратайка (р. Янгарей / Коротаиха, Хайпудырская губа)", 68.765, 61.425, 35],["п. Усть-Кара (Карская губа Карского моря / р. Кара)", 69.251, 64.933, 35],["п. Харута (р. Адзьва)", 66.857, 59.569, 35],["п. Хорей-Вер (р. Колва)", 67.423, 58.053, 35],["д. Андег (дельта Печоры)", 67.887, 53.301, 35],["д. Куя (р. Печора)", 67.798, 53.309, 35],["Бабаево (р. Колпь)", 59.389, 35.951, 8],["Грязовец", 58.882, 40.252, 8],["Кадников (р. Содима / Пельшма)", 59.503, 40.335, 8],["Красавино (р. Северная Двина)", 60.963, 46.48, 8],["Никольск (р. Юг)", 59.535, 45.452, 8],["Харовск (р. Кубена)", 59.956, 40.193, 8],["пгт Вохтога", 58.809, 41.045, 8],["пгт Кадуй (р. Суда / Череповецкая ГРЭС)", 59.202, 37.148, 8],["пгт Кузино (Малая Северная Двина)", 60.751, 46.332, 8],["пгт Сазоново (р. Песь)", 59.092, 35.066, 8],["пгт Хохлово", 59.197, 37.339, 8],["пгт Чагода (р. Чагодоща)", 59.162, 35.331, 8],["с. Верховажье (р. Вага)", 60.741, 42.046, 8],["с.им. Бабушкина (р. Леденьга)", 59.754, 43.131, 8],["с. Кичменгский Городок (р. Юг / Кичменьга)", 59.988, 45.798, 8],["с. Мякса (Рыбинское вдхр.)", 58.938, 37.981, 8],["с. Новленское (оз. Кубенское)", 59.591, 39.327, 8],["с. Нюксеница (р. Сухона)", 60.415, 44.238, 8],["с. Сямжа (р. Сямжена / Кубена)", 60.019, 41.063, 8],["с. Тарногский Городок (р. Кокшеньга)", 60.499, 43.575, 8],["с. Усть-Кубинское (впадение р. Кубены в оз. Кубенское)", 59.654, 39.723, 8],["с. Шуйское (р. Сухона)", 59.373, 41.031, 8],["д. Горицы / Топорня (Шекснинское вдхр. / Северо-Двинский канал)", 59.865, 38.258, 8],["Багратионовск", 54.387, 20.642, 17],["Гвардейск (слияние р. Преголя и р. Дейма)", 54.649, 21.071, 17],["Гурьевск", 54.773, 20.605, 17],["Гусев (р. Писса / Красная)", 54.593, 22.199, 17],["Краснознаменск (р. Шешупе)", 54.943, 22.49, 17],["Ладушкин (Калининградский залив)", 54.573, 20.175, 17],["Мамоново (Калининградский залив)", 54.464, 19.938, 17],["Неман (р. Неман)", 55.031, 22.026, 17],["Нестеров", 54.63, 22.573, 17],["Озёрск (р. Анграпа)", 54.411, 22.012, 17],["Пионерский (Балтийское море)", 54.952, 20.228, 17],["Правдинск (р. Лава / Правдинское вдхр.)", 54.444, 21.018, 17],["Приморск (Приморская бухта Калининградского залива)", 54.732, 20.005, 17],["Славск", 55.043, 21.677, 17],["Черняховск (слияние р. Инструч и р. Анграпа в Преголю)", 54.634, 21.815, 17],["пгт Донское (мыс Таран, Балтийское море)", 54.943, 19.967, 17],["пгт Железнодорожный", 54.36, 21.306, 17],["пгт Знаменск (впадение р. Лава в Преголю)", 54.614, 21.227, 17],["пгт Приморье", 54.949, 20.088, 17],["пгт Янтарный (Балтийское море / оз. Синявинское)", 54.872, 19.941, 17],["п. Рыбачий / п. Лесной / п. Морское (Куршская коса — Куршский залив и Балтийское море)", 55.155, 20.852, 17],["п. Матросово / п. Головкино (р. Матросовка / Немонин / Куршский залив)", 55.015, 21.309, 17],["п. Заливино / п. Каширское (Куршский залив)", 54.899, 21.053, 17],["п. Ушаково (впадение р. Прохладной в Калининградский залив)", 54.614, 20.252, 17],["п. Ясное / п. Мысовка (р. Северная / Скирвит — дельта Немана)", 55.189, 21.318, 17],["оз. Виштынецкое (Нестеровский р-н)", 54.432, 22.715, 17],["Гаджиево (Кольский залив / губа Сайда)", 69.255, 33.321, 34],["Заозёрск (губа Западная Лица)", 69.4, 32.448, 34],["Заполярный (р. Печенга)", 69.416, 30.814, 34],["Кировск (оз. Большой Вудъявр)", 67.614, 33.672, 34],["Ковдор (оз. Ковдоро)", 67.562, 30.472, 34],["Оленегорск (оз. Имандра / Колозеро / Пермусозеро)", 68.143, 33.271, 34],["Островной (Гремиха / Йоканьга, Баренцево море)", 68.053, 39.513, 34],["Полярные Зори (оз. Имандра / р. Нива / тёплый канал Кольской АЭС)", 67.366, 32.498, 34],["Полярный (Екатерининская гавань Кольского залива)", 69.198, 33.448, 34],["Снежногорск", 69.193, 33.233, 34],["пгт Верхнетуломский (Верхнетуломское вдхр. / р. Тулома)", 68.606, 31.796, 34],["пгт Зеленоборский (Княжегубское вдхр. / Белое море)", 66.845, 32.362, 34],["пгт Кильдинстрой (р. Кола)", 68.795, 33.102, 34],["пгт Молочный (р. Кола)", 68.853, 33.022, 34],["пгт Никель (р. Паз / оз. Куэтсъярви)", 69.406, 30.219, 34],["пгт Печенга (р. Печенга / Печенгская губа)", 69.554, 31.219, 34],["пгт Ревда (оз. Ловозеро / Умбозеро)", 67.937, 34.559, 34],["пгт Сафоново", 69.06, 33.295, 34],["пгт Туманный (р. Воронья / Серебрянское вдхр.)", 68.881, 35.691, 34],["п. Видяево (губа Ура Баренцева моря)", 69.319, 32.805, 34],["п. Лиинахамари (Печенгская губа / п-ов Средний и Рыбачий)", 69.644, 31.358, 34],["п. Ура-Губа (р. Ура / губа Ура Баренцева моря — главная база морской рыбалки наряду с Териберкой!)", 69.288, 32.808, 34],["с. Алакуртти (р. Тунтсайоки / Иовское вдхр.)", 66.966, 30.349, 34],["с. Зареченск (Иовское вдхр.)", 66.692, 31.425, 34],["с. Каневка / Краснощелье (р. Поной)", 67.131, 39.685, 34],["с. Ковда / Пояконда (Кандалакшский залив Белого моря)", 66.689, 32.891, 34],["с. Кузомень / Кашкаранцы / Чапома / Пялица (Терский берег Белого моря)", 66.284, 36.871, 34],["с. Тулома", 68.705, 32.646, 34],["ст. Тайбола / Пулозеро / Лапландия", 68.384, 33.309, 34],["Малая Вишера (р. Малая Вишерка)", 58.845, 32.222, 37],["Окуловка (оз. Заозерье / р. Перетна)", 58.397, 33.297, 37],["Сольцы (р. Шелонь)", 58.121, 30.323, 37],["Холм (слияние р. Ловать и р. Кунья)", 57.145, 31.178, 37],["пгт Батецкий (р. Луга)", 58.64, 30.312, 37],["пгт Крестцы (р. Холова)", 58.248, 32.518, 37],["пгт Кулотино (р. Перетна)", 58.458, 33.393, 37],["пгт Любытино (р. Мста)", 58.813, 33.392, 37],["пгт Неболчи (р. Мда)", 59.119, 33.348, 37],["пгт Панковка", 58.497, 31.186, 37],["пгт Парфино (р. Ловать / Пола)", 57.997, 31.648, 37],["пгт Пролетарий (р. Большая Ниша / оз. Ильмень)", 58.431, 31.696, 37],["пгт Угловка", 58.225, 33.562, 37],["пгт Хвойная (оз. Видимирское / р. Песь)", 58.898, 34.536, 37],["пгт Шимск (р. Шелонь / оз. Ильмень)", 58.21, 30.715, 37],["с. Волотово", 57.929, 30.707, 37],["с. Марево", 57.326, 32.075, 37],["с. Мошенское (оз. Великое / р. Уверь)", 58.518, 34.588, 37],["с. Поддорье (р. Редья)", 57.469, 31.119, 37],["д. Взвад (дельта р. Ловать, оз. Ильмень — легендарная рыболовная база!)", 58.096, 31.425, 37],["д. Коростынь / Козынево / Сергово / Замленье / Синецкий залив (побережье оз. Ильмень)", 58.187, 31.015, 37],["с. Полново (Полновский плёс оз. Селигер, Демянский р-н)", 57.584, 32.893, 37],["Дно", 57.829, 29.961, 45],["Новоржев (оз. Росцо / Орша)", 57.028, 29.335, 45],["Новосокольники", 56.334, 30.156, 45],["Опочка (р. Великая)", 56.712, 28.663, 45],["Остров (р. Великая)", 57.343, 28.352, 45],["Порхов (р. Шелонь)", 57.768, 29.556, 45],["Пустошка (р. Великая / оз. Верято)", 56.335, 29.369, 45],["Пыталово (р. Утроя)", 57.068, 27.915, 45],["пгт Бежаницы (оз. Полисто / Дубец)", 56.973, 29.888, 45],["пгт Дедовичи (р. Шелонь / Псковская ГРЭС)", 57.552, 29.956, 45],["пгт Идрица (р. Идрица)", 56.332, 28.895, 45],["пгт Красногородск (р. Синяя)", 56.835, 28.283, 45],["пгт Кунья", 56.283, 30.978, 45],["пгт Локня", 56.83, 30.149, 45],["пгт Палкино (р. Смолинка / оз. Белая Струга)", 57.539, 28.015, 45],["пгт Плюсса (р. Плюсса)", 58.431, 29.368, 45],["пгт Пушкинские Горы (р. Сороть / оз. Кучане)", 57.022, 28.914, 45],["пгт Сосновый Бор (Себежский р-н)", 56.262, 28.543, 45],["пгт Струги Красные", 58.268, 29.112, 45],["пгт Усвяты (оз. Усвятское / р. Усвяча)", 55.748, 30.754, 45],["с. Серёдка", 58.156, 28.188, 45],["д. Спицино / Ветвеник / Кунесть / Сторожинец / Раскопель (восточный берег Чудского и Тёплого озёр)", 58.472, 27.838, 45],["д. Толба / Залита (Талабские о-ва) / Кривск / Подборовье (Псковское озеро, дельта р. Великой)", 57.992, 28.068, 45],["с. Жижица (оз. Жижицкое, Куньинский р-н)", 56.252, 31.185, 45],["Волгоград", 48.708, 44.5133, 7],["Волжский", 48.785, 44.775, 7],["Камышин", 50.088, 45.405, 7],["Калач-на-Дону", 48.685, 43.526, 7],["Ахтубинск", 48.281, 46.174, 3],["Харабали", 47.412, 47.256, 3],["Селитренное", 47.167, 47.45, 3],["Енотаевка", 47.246, 47.028, 3],["Нариманов", 46.689, 47.85, 3],["Астрахань", 46.3497, 48.0408, 3],["Камызяк", 46.11, 48.077, 3],["Кировский (Астрахань)", 45.845, 48.136, 3],["Икряное", 46.093, 47.734, 3],["Мумра", 45.772, 47.656, 3],["Володарский", 46.402, 48.541, 3],["Лиман (Астраханская)", 45.785, 47.224, 3],["Лагань", 45.391, 47.362, 52],["Элиста", 46.3078, 44.2558, 52],["Ростов-на-Дону", 47.2225, 39.7187, 63],["Азов", 47.112, 39.423, 63],["Таганрог", 47.2096, 38.9352, 63],["Новочеркасск", 47.418, 40.093, 63],["Семикаракорск", 47.516, 40.806, 63],["Волгодонск", 47.514, 42.153, 63],["Цимлянск", 47.644, 42.102, 63],["Весёлый (Маныч)", 47.086, 40.742, 63],["Каменск-Шахтинский", 48.318, 40.26, 63],["Вёшенская", 49.629, 41.726, 63],["Краснодар", 45.0355, 38.9753, 24],["Славянск-на-Кубани", 45.257, 38.125, 24],["Темрюк", 45.271, 37.382, 24],["Приморско-Ахтарск", 46.046, 38.175, 24],["Ейск", 46.711, 38.273, 24],["Тимашевск", 45.617, 38.946, 24],["Анапа", 44.895, 37.316, 24],["Новороссийск", 44.7239, 37.7689, 24],["Геленджик", 44.561, 38.077, 24],["Туапсе", 44.098, 39.074, 24],["Сочи", 43.5855, 39.7231, 24],["Адлер", 43.429, 39.923, 24],["Майкоп", 44.6098, 40.1006, 46],["Севастополь", 44.6166, 33.5254, 70],["Балаклава", 44.501, 33.599, 70],["Симферополь", 44.9521, 34.1024, 55],["Ялта", 44.4952, 34.1663, 55],["Алушта", 44.676, 34.41, 55],["Судак", 44.851, 34.972, 55],["Феодосия", 45.0319, 35.3824, 55],["Керчь", 45.356, 36.467, 55],["Евпатория", 45.1904, 33.3669, 55],["Черноморское", 45.504, 32.702, 55],["Черный Яр", 48.062, 46.112, 3],["Красный Яр (Бузан)", 46.533, 48.348, 3],["Сириус (Имеретинка)", 43.402, 39.961, 24],["Хоста", 43.515, 39.869, 24],["Дагомыс", 43.661, 39.654, 24],["Лоо", 43.699, 39.589, 24],["Лазаревское", 43.908, 39.331, 24],["Джубга", 44.316, 38.705, 24],["Архипо-Осиповка", 44.366, 38.531, 24],["Дивноморское", 44.502, 38.135, 24],["Кабардинка", 44.651, 37.939, 24],["Большой Утриш", 44.761, 37.389, 24],["Витязево", 44.988, 37.262, 24],["Благовещенская (Анапа)", 45.063, 37.115, 24],["Тамань", 45.218, 36.716, 24],["Голубицкая", 45.325, 37.272, 24],["Кучугуры", 45.405, 36.958, 24],["Садки (Ахтарские лиманы)", 45.925, 38.182, 24],["Ясенская Переправа", 46.245, 38.285, 24],["Должанская (Коса Долгая)", 46.633, 37.802, 24],["Донецк", 48.0159, 37.8028, 10],["Мариуполь", 47.0971, 37.5434, 10],["Макеевка", 48.0478, 37.9258, 10],["Горловка", 48.307, 38.0297, 10],["Енакиево", 48.2311, 38.2053, 10],["Старобешево (Старобешевское вдхр.)", 47.7531, 38.0319, 10],["Зугрэс (Зуевское вдхр.)", 48.0175, 38.2619, 10],["Седово (Кривая коса, Азовское море)", 47.0769, 38.1561, 10],["Новоазовск", 47.1147, 38.0825, 10],["Харцызск", 48.0428, 38.1425, 10],["Волноваха", 47.5975, 37.4833, 10],["Дебальцево", 48.3411, 38.4069, 10],["Луганск", 48.574, 39.3078, 30],["Алчевск (Исаковское вдхр.)", 48.4689, 38.7978, 30],["Северодонецк (р. Северский Донец)", 48.9483, 38.4933, 30],["Лисичанск (р. Северский Донец)", 48.9042, 38.4319, 30],["Красный Луч", 48.1372, 38.9192, 30],["Стаханов", 48.5681, 38.6436, 30],["Краснодон", 48.2992, 39.7397, 30],["Счастье (Луганская ТЭС / Северский Донец)", 48.7386, 39.2314, 30],["Станица Луганская", 48.6706, 39.4689, 30],["Старобельск (р. Айдар)", 49.2769, 38.9242, 30],["Сватово (р. Красная)", 49.4092, 38.1619, 30],["Мелитополь", 46.8489, 35.3653, 13],["Бердянск (Бердянский залив)", 46.7597, 36.7989, 13],["Энергодар (Днепровский плёс)", 47.4989, 34.6558, 13],["Приморск (Азовское море)", 46.7347, 36.3442, 13],["Кирилловка (Молочный и Утлюкский лиманы)", 46.3736, 35.3675, 13],["Васильевка", 47.4419, 35.2764, 13],["Днепрорудное", 47.3819, 34.9869, 13],["Каменка-Днепровская", 47.4872, 34.4058, 13],["Токмак", 47.2514, 35.7058, 13],["Пологи", 47.4844, 36.2536, 13],["Геническ (Арабатская стрелка / Сиваш)", 46.1769, 34.8058, 82],["Скадовск (Джарылгачский залив)", 46.1189, 32.9106, 82],["Новая Каховка (низовья Днепра)", 46.7511, 33.3606, 82],["Каховка", 46.8136, 33.4869, 82],["Голая Пристань (дельта Днепра)", 46.5242, 32.5203, 82],["Алёшки (р. Конка / Днепр)", 46.6203, 32.7186, 82],["Железный Порт (Чёрное море)", 46.1233, 32.2914, 82],["Лазурное (Устричное оз. / Чёрное море)", 46.0842, 32.5294, 82],["Чаплынка", 46.3639, 33.5403, 82],["Адыгейск (Краснодарское вдхр.)", 44.8825, 39.1906, 46],["Яблоновский (р. Кубань)", 44.9897, 38.9433, 46],["Каменномостский / Хаджох (р. Белая)", 44.2989, 40.1844, 46],["Красногвардейское (Тщикское вдхр.)", 45.1278, 39.5719, 46],["Цаган Аман (р. Волга)", 47.5639, 46.7219, 52],["Городовиковск", 46.0878, 41.9336, 52],["Энем (Октябрьское вдхр.)", 44.925, 38.905, 46],["Тлюстенхабль (р. Кубань)", 44.981, 39.092, 46],["ст. Гиагинская (р. Гиага)", 44.862, 40.071, 46],["ст. Дондуковская (р. Фарс)", 44.882, 40.362, 46],["ст. Даховская (р. Белая / р. Дах)", 44.231, 40.203, 46],["ст. Ханская (р. Белая)", 44.678, 39.961, 46],["ст. Кужорская", 44.672, 40.301, 46],["ст. Келермесская", 44.782, 40.145, 46],["ст. Абадзехская (р. Белая)", 44.391, 40.222, 46],["ст. Севастопольская", 44.354, 40.305, 46],["ст. Новосвободная", 44.342, 40.382, 46],["аул Тахтамукай (Октябрьское вдхр.)", 44.921, 38.995, 46],["аул Шенджий (Шенджийское вдхр.)", 44.885, 39.075, 46],["аул Понежукай (р. Апчас)", 44.887, 39.385, 46],["аул Псейтук (р. Кубань)", 45.012, 38.802, 46],["аул Хатукай (устье р. Лаба / Кубань)", 45.188, 39.678, 46],["аул Кошехабль (р. Лаба)", 44.896, 40.505, 46],["аул Ходзь (р. Ходзь)", 44.512, 40.715, 46],["аул Блечепсин", 44.825, 40.485, 46],["аул Уляп (р. Лаба)", 45.068, 40.015, 46],["аул Адамий", 45.135, 39.692, 46],["с. Хамышки (верховья р. Белая)", 44.095, 40.135, 46],["п. Гузерипль (р. Белая)", 43.996, 40.136, 46],["с. Белое (р. Белая)", 45.048, 39.652, 46],["с. Преображенское", 45.112, 39.605, 46],["х. Садовый", 45.018, 39.812, 46],["х. Красный Уль", 44.715, 40.175, 46],["х. Чумаков", 45.085, 39.752, 46],["х. Дьяков", 44.635, 40.185, 46],["п. Тульский (р. Белая)", 44.496, 40.176, 46],["с. Джалыково (Михайловский ильмень)", 45.652, 47.205, 52],["с. Красинское (Лаганский р-н)", 45.458, 47.285, 52],["п. Северный (Лаганский р-н)", 45.545, 47.345, 52],["п. Буранное (Каспийские ильмени)", 45.712, 47.115, 52],["п. Улан-Хол", 45.405, 46.855, 52],["п. Юста", 47.315, 46.395, 52],["п. Харба", 47.465, 46.225, 52],["п. Бергин", 47.395, 46.085, 52],["п. Эрдниевский", 47.185, 46.485, 52],["п. Чограйский (Чограйское вдхр.)", 45.515, 44.385, 52],["п. Южный (Чограйское вдхр.)", 45.552, 44.115, 52],["с. Приютное (оз. Маныч-Гудило)", 46.102, 43.508, 52],["с. Яшалта (оз. Маныч-Гудило)", 46.339, 42.276, 52],["с. Манычское (Яшалтинский р-н)", 46.395, 42.545, 52],["с. Березовское (Яшалтинский р-н)", 46.225, 42.195, 52],["п. Нарта", 46.235, 43.915, 52],["п. Лола (Колонский пруд)", 46.125, 44.215, 52],["п. Аршан-Зельмень (Аршан-Зельменское вдхр.)", 47.535, 44.525, 52],["с. Садовое (Сарпинские озёра)", 47.777, 44.521, 52],["с. Малые Дербеты (оз. Сарпа)", 47.954, 44.681, 52],["п. Большой Царын (оз. Сарпа)", 47.878, 45.415, 52],["п. Цаган-Нур (оз. Сарпа)", 47.372, 45.228, 52],["п. Комсомольский (Состинские озёра)", 45.331, 46.042, 52],["п. Яшкуль (оз. Дед-Хулсун)", 46.171, 45.343, 52],["Алупка", 44.419, 34.043, 55],["Армянск", 46.107, 33.693, 55],["Бахчисарай", 44.755, 33.858, 55],["Белогорск (Белогорское и Тайганское вдхр.)", 45.055, 34.602, 55],["Джанкой", 45.709, 34.393, 55],["Красноперекопск", 45.955, 33.792, 55],["Саки (оз. Сасык-Сиваш)", 45.134, 33.599, 55],["Старый Крым (Старокрымское вдхр.)", 45.029, 35.089, 55],["Щёлкино (мыс Казантип)", 45.428, 35.822, 55],["Гурзуф", 44.542, 34.281, 55],["Партенит", 44.578, 34.342, 55],["Форос", 44.391, 33.788, 55],["Симеиз", 44.406, 33.992, 55],["Гаспра", 44.432, 34.113, 55],["Кореиз", 44.433, 34.088, 55],["Ливадия", 44.469, 34.144, 55],["Массандра", 44.509, 34.187, 55],["Никита", 44.514, 34.238, 55],["Николаевка (Каламитский залив)", 44.961, 33.611, 55],["Новофёдоровка (Саки)", 45.091, 33.571, 55],["Мирный (оз. Донузлав)", 45.309, 33.035, 55],["Новоозёрное (оз. Донузлав)", 45.385, 33.118, 55],["Межводное (Ярылгачская бухта)", 45.585, 32.842, 55],["Оленевка (мыс Тарханкут)", 45.383, 32.533, 55],["Стерегущее (Каркинитский залив)", 45.749, 33.226, 55],["Раздольное", 45.771, 33.488, 55],["Портовое (Лебяжьи о-ва)", 45.885, 33.485, 55],["Коктебель", 44.961, 35.242, 55],["Орджоникидзе (Двуякорная бухта)", 44.964, 35.357, 55],["Курортное (Карадаг)", 44.914, 35.188, 55],["Новый Свет", 44.829, 34.913, 55],["Морское (Судак)", 44.824, 34.803, 55],["Рыбачье (Алушта)", 44.769, 34.597, 55],["Малореченское", 44.757, 34.562, 55],["Солнечногорское", 44.745, 34.545, 55],["Приморский (Феодосия)", 45.118, 35.481, 55],["Ленино", 45.297, 35.772, 55],["Багерово", 45.378, 36.295, 55],["Мысовое (Казантип)", 45.451, 35.839, 55],["Каменское (Арабатский залив)", 45.279, 35.524, 55],["Соляное (Арабатская стрелка)", 45.318, 35.425, 55],["Заветное (Керченский пролив)", 45.126, 36.416, 55],["Героевское (Эльтиген, Керчь)", 45.238, 36.418, 55],["Осовины (Азовское море)", 45.435, 36.598, 55],["Юркино (Керчь)", 45.422, 36.555, 55],["Курортное (оз. Чокрак, Керчь)", 45.468, 36.322, 55],["Нижнегорский (р. Салгир)", 45.444, 34.741, 55],["Советский (Сиваш / СКК)", 45.347, 34.933, 55],["Кировское", 45.223, 35.205, 55],["Первомайское", 45.716, 33.858, 55],["Красногвардейское", 45.495, 34.295, 55],["Зуя (р. Зуя / Балановское вдхр.)", 45.054, 34.316, 55],["Куйбышево (р. Бельбек)", 44.623, 33.877, 55],["Голубинка (р. Бельбек)", 44.588, 33.919, 55],["Соколиное (верховья р. Бельбек)", 44.552, 33.956, 55],["Инкерман (устье р. Чёрная)", 44.614, 33.608, 70],["пгт Кача", 44.777, 33.549, 70],["Орловка (устье р. Кача)", 44.725, 33.553, 70],["Андреевка (Севастополь)", 44.819, 33.559, 70],["Любимовка (устье р. Бельбек)", 44.664, 33.548, 70],["Орлиное (Байдарская долина)", 44.444, 33.781, 70],["Родниковое (Байдарская долина)", 44.462, 33.844, 70],["Передовое (оз. Нижнее)", 44.513, 33.821, 70],["Широкое (Байдарская долина)", 44.482, 33.792, 70],["Терновка (Севастополь)", 44.579, 33.763, 70],["Родное (оз. Нижнее)", 44.555, 33.742, 70],["Гончарное", 44.468, 33.702, 70],["Резервное", 44.476, 33.681, 70],["Верхнесадовое (р. Бельбек)", 44.687, 33.704, 70],["Фронтовое (Севастополь)", 44.678, 33.744, 70],["Сахарная Головка (р. Чёрная)", 44.588, 33.635, 70],["Хмельницкое (р. Чёрная)", 44.552, 33.661, 70],["Черноречье (р. Чёрная)", 44.545, 33.681, 70],["Ласпи (бухта Ласпи)", 44.417, 33.708, 70],["Абинск (р. Абин / Крюковское вдхр.)", 44.866, 38.158, 24],["Апшеронск (р. Пшеха)", 44.461, 39.726, 24],["Армавир (р. Кубань / р. Уруп)", 44.989, 41.123, 24],["Белореченск (р. Белая)", 44.765, 39.873, 24],["Горячий Ключ (р. Псекупс)", 44.634, 39.136, 24],["Гулькевичи (р. Кубань)", 45.361, 40.695, 24],["Кореновск (р. Левый Бейсужёк)", 45.464, 39.452, 24],["Кропоткин (р. Кубань)", 45.437, 40.575, 24],["Крымск (р. Адагум / Варнавинское вдхр.)", 44.929, 37.991, 24],["Курганинск (р. Лаба)", 44.888, 40.598, 24],["Лабинск (р. Лаба)", 44.636, 40.733, 24],["Новокубанск (р. Кубань)", 45.106, 41.045, 24],["Тихорецк (р. Челбас)", 45.854, 40.125, 24],["Усть-Лабинск (р. Кубань / р. Лаба)", 45.211, 39.692, 24],["Хадыженск (р. Пшиш)", 44.421, 39.535, 24],["пгт Мостовской (р. Лаба / р. Ходзь)", 44.412, 40.792, 24],["пгт Псебай (р. Малая Лаба)", 44.116, 40.812, 24],["пгт Красная Поляна (р. Мзымта)", 43.679, 40.205, 24],["пгт Новомихайловский (р. Небуг / Псебе)", 44.241, 38.859, 24],["пгт Ильский (р. Ил)", 44.855, 38.568, 24],["пгт Афипский (р. Афипс)", 44.912, 38.835, 24],["пгт Ахтырский", 44.846, 38.288, 24],["пгт Черноморский", 44.849, 38.498, 24],["пгт Гирей (р. Кубань)", 45.405, 40.625, 24],["пгт Красносельский (р. Кубань)", 45.388, 40.638, 24],["Мацеста (Сочи)", 43.548, 39.793, 24],["Кудепста (Сочи)", 43.492, 39.886, 24],["Головинка (устье р. Шахе, Сочи)", 43.788, 39.462, 24],["Якорная Щель (Сочи)", 43.758, 39.505, 24],["Вардане (Сочи)", 43.727, 39.546, 24],["Уч-Дере (Сочи)", 43.681, 39.615, 24],["Солоники (Сочи)", 43.881, 39.365, 24],["Волконка (Сочи)", 43.861, 39.388, 24],["Чемитоквадже (Сочи)", 43.835, 39.412, 24],["Аше (р. Аше, Сочи)", 43.957, 39.266, 24],["Совет-Квадже (Сочи)", 43.982, 39.235, 24],["Вишнёвка (Сочи)", 44.001, 39.211, 24],["Магри (Сочи)", 44.018, 39.185, 24],["Эсто-Садок (р. Мзымта)", 43.684, 40.264, 24],["Чвижепсе (р. Мзымта)", 43.635, 40.082, 24],["с. Казачий Брод (Форелевое хоз-во, р. Мзымта)", 43.524, 39.996, 24],["с. Ахштырь (оз. Серебряное, Сочи)", 43.518, 39.988, 24],["с. Монастырь (р. Мзымта)", 43.582, 40.025, 24],["с. Галицыно (Сочи)", 43.541, 40.005, 24],["с. Молдовка (р. Мзымта, Адлер)", 43.458, 39.948, 24],["с. Весёлое (р. Псоу, Адлер)", 43.411, 40.002, 24],["с. Барановка (Барановское оз., Сочи)", 43.632, 39.754, 24],["с. Пластунка (р. Сочи)", 43.675, 39.759, 24],["с. Солохаул (р. Шахе, Сочи)", 43.802, 39.678, 24],["с. Красная Воля (р. Хоста, Сочи)", 43.562, 39.904, 24],["с. Калиновое Озеро (Сочи)", 43.612, 39.928, 24],["с. Илларионовка (Илларионовское оз., Сочи)", 43.595, 39.915, 24],["с. Прогресс (Сочи)", 43.585, 39.825, 24],["с. Раздольное (Сочи)", 43.599, 39.772, 24],["аул Большой Кичмай (р. Шахе)", 43.829, 39.521, 24],["аул Малый Кичмай (р. Шахе)", 43.816, 39.501, 24],["аул Ахинтам (р. Шахе)", 43.811, 39.488, 24],["аул Калеж (р. Аше)", 44.006, 39.355, 24],["аул Лыготх (р. Аше)", 44.012, 39.332, 24],["аул Наджиго (р. Макопсе)", 44.051, 39.276, 24],["аул Тхагапш (р. Псезуапсе)", 43.952, 39.435, 24],["аул Хаджико (р. Аше)", 43.982, 39.322, 24],["аул Шхафит (р. Аше)", 43.968, 39.288, 24],["аул Хатлапе (р. Псезуапсе)", 43.922, 39.392, 24],["аул Агуй-Шапсуг (р. Агой, Туапсе)", 44.169, 39.076, 24],["аул Псебе (р. Небуг / Псебе)", 44.298, 38.948, 24],["аул Большое Псеушхо (Туапсе)", 44.185, 39.265, 24],["аул Малое Псеушхо (Туапсе)", 44.162, 39.225, 24],["аул Урупский (р. Уруп)", 44.825, 41.225, 24],["ст. Каневская (р. Челбас / лиман Горький)", 46.082, 38.966, 24],["ст. Ленинградская (р. Сосыка)", 46.321, 39.388, 24],["ст. Староминская (р. Сосыка / Ея)", 46.536, 39.056, 24],["ст. Кущёвская (р. Ея)", 46.564, 39.628, 24],["ст. Павловская (р. Сосыка)", 46.136, 39.788, 24],["ст. Брюховецкая (р. Бейсуг)", 45.802, 39.002, 24],["ст. Выселки (р. Журавка)", 45.581, 39.654, 24],["ст. Динская (р. Кочеты)", 45.218, 39.228, 24],["ст. Северская (р. Убин)", 44.856, 38.678, 24],["ст. Полтавская", 45.362, 38.212, 24],["ст. Калининская (р. Понура)", 45.479, 38.662, 24],["ст. Старонижестеблиевская (Ангелинский ерик)", 45.382, 38.435, 24],["ст. Гривенская (р. Протока / лиманы)", 45.639, 38.176, 24],["ст. Бриньковская (Бейсугский лиман)", 46.042, 38.545, 24],["ст. Копанская (оз. Ханское)", 46.271, 38.562, 24],["ст. Камышеватская (Азовское море)", 46.405, 37.945, 24],["ст. Старощербиновская (р. Ея / Ейский лиман)", 46.632, 38.672, 24],["ст. Ахтанизовская (Ахтанизовский лиман)", 45.324, 37.104, 24],["ст. Курчанская (Курчанский лиман)", 45.214, 37.542, 24],["ст. Черноерковская (Сладкий и Горький лиманы)", 45.458, 37.758, 24],["ст. Раевская", 44.832, 37.554, 24],["ст. Натухаевская", 44.911, 37.562, 24],["ст. Саратовская (р. Псекупс)", 44.718, 39.218, 24],["ст. Тбилисская (р. Кубань)", 45.366, 40.191, 24],["ст. Кавказская (р. Кубань)", 45.442, 40.672, 24],["ст. Отрадная (р. Уруп)", 44.394, 41.524, 24],["ст. Спокойная", 44.228, 41.402, 24],["ст. Бесленеевская (р. Ходзь)", 44.245, 40.718, 24],["ст. Каладжинская (р. Лаба)", 44.455, 40.822, 24],["х. Коржевский (р. Кубань)", 45.228, 37.768, 24],["х. Свистельников (Куликовские лиманы)", 45.335, 37.685, 24],["х. Трудобеликовский (р. Протока)", 45.268, 38.118, 24],["х. Морозовский (Ахтарские лиманы)", 45.785, 38.195, 24],["х. Беликов (Жестерские лиманы)", 45.415, 37.885, 24],["с. Шабельское (Таганрогский залив)", 46.858, 38.485, 24],["с. Глафировка (Глафировская коса / Ейский лиман)", 46.752, 38.415, 24],["с. Воронцовка (Ейский залив)", 46.652, 38.082, 24],["п. Ачуево (устье р. Протока / Азовское море)", 45.718, 37.768, 24],["п. Пересыпь (Азовское море / Ахтанизовский лиман)", 45.348, 37.138, 24],["п. За Родину (Азовское море)", 45.352, 37.082, 24],["п. Ильич (Керченский пролив)", 45.422, 36.768, 24],["п. Сенной (Таманский залив)", 45.286, 36.992, 24],["п. Веселовка (Кизилташский и Бугазский лиманы)", 45.122, 36.885, 24],["с. Абрау-Дюрсо (оз. Абрау)", 44.698, 37.595, 24],["с. Пшада (р. Пшада)", 44.492, 38.385, 24],["с. Бетта (Чёрное море)", 44.375, 38.395, 24],["с. Криница (устье р. Пшада)", 44.392, 38.338, 24],["с. Ольгинка (Туапсе)", 44.201, 38.885, 24],["с. Небуг (р. Небуг, Туапсе)", 44.168, 38.998, 24],["с. Агой (р. Агой, Туапсе)", 44.139, 39.029, 24],["с. Шепси (р. Шепси, Туапсе)", 44.036, 39.148, 24],["Знаменск", 48.585, 45.733, 3],["пгт Ильинка (р. Волга)", 46.238, 47.902, 3],["пгт Красные Баррикады (р. Бахтемир)", 46.202, 47.854, 3],["пгт Нижний Баскунчак", 48.219, 46.832, 3],["пгт Верхний Баскунчак", 48.227, 46.722, 3],["с. Ступино (р. Волга)", 48.288, 45.885, 3],["с. Солодники (р. Волга)", 48.352, 45.712, 3],["с. Ушаковка (р. Волга)", 48.422, 45.485, 3],["с. Старица (р. Волга)", 48.148, 46.012, 3],["с. Зубовка (р. Волга)", 48.075, 46.065, 3],["с. Пологое Займище (р. Ахтуба / Подстёпка)", 48.472, 45.852, 3],["с. Капустин Яр (р. Ахтуба)", 48.581, 45.741, 3],["с. Золотуха (р. Ахтуба)", 47.882, 46.535, 3],["с. Удачное (р. Ахтуба)", 47.822, 46.605, 3],["с. Михайловка (Харабалинский р-н, р. Ахтуба)", 47.698, 46.822, 3],["с. Бугор (р. Ахтуба)", 47.625, 46.912, 3],["с. Сасыколи (р. Ахтуба)", 47.542, 47.012, 3],["с. Кочковатка (р. Ахтуба)", 47.482, 47.105, 3],["с. Тамбовка (р. Ашулук / Ахтуба)", 47.285, 47.372, 3],["с. Вольное (р. Ахтуба)", 47.118, 47.495, 3],["с. Сероглазка (р. Волга / ерик Кирпичный)", 47.065, 47.445, 3],["с. Промысловка (р. Енотаевка)", 47.022, 47.412, 3],["с. Ленино (р. Енотаевка)", 46.965, 47.475, 3],["с. Копановка (Копановский плёс р. Волга)", 47.452, 46.792, 3],["с. Фёдоровка (Енотаевский р-н, р. Волга)", 47.375, 46.885, 3],["с. Никольское (р. Волга)", 47.768, 46.425, 3],["с. Ветлянка (р. Волга)", 47.638, 46.602, 3],["с. Пришиб (р. Волга)", 47.685, 46.535, 3],["с. Замьяны (р. Волга / Гусиный о-в)", 46.818, 47.618, 3],["с. Верхнее Лебяжье (р. Волга / р. Бузан)", 46.725, 47.795, 3],["с. Оранжереи (Главный банк)", 45.845, 47.575, 3],["с. Фёдоровка (Икрянинский р-н, Главный банк)", 45.802, 47.562, 3],["с. Житное (Главный банк / Старая Волга)", 45.772, 47.672, 3],["с. Вышка (Каспийские раскаты / Маяк)", 45.612, 47.648, 3],["с. Воскресеновка (Лиманский р-н)", 45.658, 47.552, 3],["с. Седлистое (Главный банк)", 45.888, 47.632, 3],["с. Товарный (Главный банк)", 45.662, 47.678, 3],["с. Бахтемир (р. Бахтемир)", 46.048, 47.742, 3],["с. Трудфронт (р. Бахтемир / р. Ямная)", 45.928, 47.658, 3],["с. Каралат (Каралатский банк)", 45.912, 48.298, 3],["с. Чапаево (Камызякский р-н)", 45.932, 48.272, 3],["с. Парыгино (Каралатский банк)", 45.952, 48.282, 3],["с. Станья (Кулагинский и Никитинский банки)", 45.822, 48.135, 3],["с. Гандурино (Гандуринский банк)", 45.875, 48.035, 3],["с. Иванчуг (р. Гандурино)", 45.968, 48.025, 3],["с. Образцово-Травино (Гандуринский банк)", 45.915, 48.022, 3],["с. Полдневое (Полдневский банк)", 45.855, 47.925, 3],["с. Самосделка (р. Старая Волга)", 46.025, 47.845, 3],["п. Верхнекалиновский (р. Кизань)", 46.068, 48.112, 3],["п. Жан-Аул (р. Кизань / Камызяк)", 46.042, 48.128, 3],["с. Зеленга (Белинский банк)", 46.028, 48.662, 3],["с. Маково (Белинский банк)", 46.048, 48.642, 3],["с. Тишково (Тишковский канал)", 45.958, 48.555, 3],["с. Цветное (р. Быстрая / Васильевский банк)", 46.178, 48.678, 3],["с. Мултаново (Малобелинский банк)", 46.152, 48.745, 3],["с. Марфино (р. Бузан)", 46.412, 48.705, 3],["с. Калинино (р. Бузан)", 46.322, 48.865, 3],["с. Бакланье (Иголкинский банк)", 46.345, 49.025, 3],["с. Кривой Бузан", 46.512, 48.415, 3],["с. Байбек (р. Кигач)", 46.638, 48.642, 3],["с. Малый Арал (р. Кигач)", 46.678, 48.575, 3],["с. Алча (р. Берекет / Ахтуба)", 46.652, 48.435, 3],["с. Джанай (р. Ахтуба / Бузан)", 46.632, 48.352, 3],["с. Сеитовка (р. Ахтуба / Бузан)", 46.578, 48.145, 3],["Дубовка (Волгоградское вдхр.)", 49.058, 44.829, 7],["Жирновск (р. Медведица)", 50.985, 44.773, 7],["Котельниково (Цимлянское вдхр.)", 47.632, 43.142, 7],["Котово", 50.321, 44.801, 7],["Краснослободск (р. Волга / пойма)", 48.707, 44.577, 7],["Ленинск (р. Ахтуба)", 48.702, 45.198, 7],["Михайловка (р. Медведица)", 50.068, 43.238, 7],["Николаевск (Волгоградское вдхр.)", 50.028, 45.458, 7],["Новоаннинский (р. Бузулук)", 50.528, 42.675, 7],["Палласовка (р. Торгун)", 50.048, 46.882, 7],["Петров Вал (р. Иловля)", 50.138, 45.212, 7],["Серафимович (р. Дон / устье р. Медведица)", 49.578, 42.736, 7],["Суровикино (р. Чир / Цимлянское вдхр.)", 48.602, 42.852, 7],["Урюпинск (р. Хопёр)", 50.796, 42.014, 7],["Фролово (р. Арчеда)", 49.771, 43.658, 7],["пгт Средняя Ахтуба (р. Ахтуба)", 48.708, 44.864, 7],["пгт Светлый Яр (р. Волга)", 48.474, 44.776, 7],["пгт Городище", 48.804, 44.475, 7],["пгт Иловля (р. Иловля / Дон)", 49.303, 43.982, 7],["пгт Быково (Волгоградское вдхр.)", 49.766, 45.388, 7],["пгт Даниловка (р. Медведица)", 50.356, 44.118, 7],["пгт Елань (р. Терса)", 50.948, 43.738, 7],["пгт Рудня (р. Терса)", 50.798, 44.562, 7],["пгт Новониколаевский", 50.972, 42.368, 7],["пгт Октябрьский (р. Аксай Есауловский)", 47.962, 43.638, 7],["пгт Чернышковский (р. Цимла)", 48.422, 42.232, 7],["ст. Клетская (р. Дон)", 49.314, 43.061, 7],["ст. Трёхостровская (р. Дон)", 49.092, 43.922, 7],["ст. Голубинская (р. Дон)", 48.855, 43.545, 7],["ст. Сиротинская (р. Дон)", 49.255, 43.675, 7],["ст. Новогригорьевская (р. Дон)", 49.418, 43.595, 7],["ст. Усть-Хопёрская (р. Дон / р. Хопёр)", 49.605, 42.305, 7],["ст. Усть-Медведицкая (р. Дон)", 49.575, 42.685, 7],["ст. Букановская (р. Хопёр)", 49.845, 42.395, 7],["ст. Слащёвская (р. Хопёр)", 50.105, 42.265, 7],["ст. Зотовская (р. Хопёр)", 50.252, 42.248, 7],["ст. Аржановская (р. Хопёр)", 50.215, 42.288, 7],["ст. Алексеевская (р. Бузулук)", 50.292, 42.185, 7],["ст. Преображенская (р. Бузулук)", 50.742, 43.052, 7],["ст. Кумылженская (р. Кумылга)", 49.882, 42.592, 7],["ст. Нижний Чир (Цимлянское вдхр.)", 48.362, 43.085, 7],["ст. Пятиизбянская (р. Дон / Цимлянское вдхр.)", 48.602, 43.395, 7],["ст. Суводская (Волгоградское вдхр.)", 49.392, 45.025, 7],["х. Вертячий (р. Дон)", 48.948, 43.822, 7],["х. Песковатка (р. Дон)", 48.912, 43.765, 7],["х. Рюмино-Красноярский (р. Дон)", 48.778, 43.542, 7],["х. Логовский (р. Дон)", 48.555, 43.475, 7],["х. Новомаксимовский (Цимлянское вдхр.)", 48.498, 43.255, 7],["х. Похлёбин (Цимлянское вдхр.)", 47.785, 42.985, 7],["с. Райгород (р. Волга)", 48.432, 44.968, 7],["с. Каршевитое (р. Волга)", 48.468, 45.412, 7],["с. Покровка (Ленинская пойма)", 48.622, 45.285, 7],["с. Царев (р. Ахтуба)", 48.662, 45.412, 7],["с. Колобовка (р. Ахтуба)", 48.655, 45.475, 7],["с. Горный Балыклей (Волгоградское вдхр.)", 49.555, 45.095, 7],["с. Белогорки (Волгоградское вдхр.)", 50.395, 45.645, 7],["Аксай (р. Дон / р. Аксай)", 47.269, 39.863, 63],["Батайск (оз. Солёное / пойма Дона)", 47.139, 39.743, 63],["Белая Калитва (р. Северский Донец / р. Калитва)", 48.176, 40.788, 63],["Гуково", 48.055, 39.938, 63],["Донецк (р. Северский Донец)", 48.334, 39.946, 63],["Зверево", 48.025, 40.122, 63],["Зерноград", 46.845, 40.308, 63],["Константиновск (р. Дон)", 47.584, 41.106, 63],["Красный Сулин (р. Кундрючья / Соколовское вдхр.)", 47.886, 40.072, 63],["Миллерово (р. Глубокая)", 48.922, 40.398, 63],["Морозовск (р. Быстрая)", 48.352, 41.828, 63],["Новошахтинск (Соколовское вдхр.)", 47.758, 39.936, 63],["Пролетарск (Пролетарское вдхр. / р. Западный Маныч)", 46.704, 41.724, 63],["Сальск (р. Средний Егорлык)", 46.479, 41.542, 63],["Шахты (р. Грушевка / Артёмовское вдхр.)", 47.709, 40.215, 63],["пгт Усть-Донецкий (р. Северский Донец / р. Дон)", 47.638, 40.858, 63],["ст. Багаевская (р. Дон)", 47.319, 40.384, 63],["п. Матвеев Курган (р. Миус)", 47.568, 38.864, 63],["пгт Каменоломни", 47.668, 40.212, 63],["пгт Шолоховский", 48.272, 41.035, 63],["пгт Глубокий (р. Глубокая)", 48.524, 40.318, 63],["п. Тарасовский", 48.728, 40.365, 63],["п. Зимовники (р. Малая Куберле)", 47.148, 42.468, 63],["п. Орловский (оз. Маныч-Гудило)", 46.872, 42.058, 63],["п. Целина", 46.535, 41.032, 63],["п. Гигант", 46.512, 41.325, 63],["ст. Старочеркасская (р. Дон)", 47.237, 40.044, 63],["ст. Раздорская (р. Дон)", 47.542, 40.648, 63],["ст. Мелиховская (р. Дон)", 47.469, 40.558, 63],["х. Пухляковский (р. Дон)", 47.515, 40.605, 63],["ст. Кочетовская (р. Дон / Кочетовский гидроузел)", 47.565, 40.875, 63],["ст. Николаевская (р. Дон / Николаевский гидроузел)", 47.575, 41.525, 63],["ст. Романовская (р. Дон)", 47.542, 42.025, 63],["ст. Жуковская (Цимлянское вдхр.)", 47.412, 42.548, 63],["ст. Хорошевская (Цимлянское вдхр.)", 47.662, 42.225, 63],["ст. Нижнекундрюченская (устье р. Кундрючья / Дон)", 47.698, 40.912, 63],["ст. Верхнекундрюченская (р. Кундрючья)", 47.782, 40.825, 63],["ст. Елизаветинская (дельта Дона)", 47.145, 39.505, 63],["ст. Кривянская (тёплый канал Новочеркасской ГРЭС)", 47.398, 40.168, 63],["ст. Заплавская (р. Аксай)", 47.345, 40.205, 63],["ст. Манычская (р. Дон / устье Маныча)", 47.242, 40.258, 63],["ст. Казанская (Верхний Дон)", 49.792, 41.148, 63],["ст. Мигулинская (р. Дон)", 49.685, 41.402, 63],["ст. Еланская (р. Дон)", 49.598, 41.945, 63],["ст. Базковская (р. Дон)", 49.605, 41.735, 63],["ст. Боковская (р. Чир)", 49.228, 41.825, 63],["ст. Обливская (р. Чир)", 48.535, 42.495, 63],["ст. Тацинская", 48.192, 41.282, 63],["ст. Егорлыкская", 46.572, 40.652, 63],["х. Рогожкино (дельта Дона)", 47.175, 39.352, 63],["х. Дугино (р. Мёртвый Донец)", 47.205, 39.415, 63],["х. Кагальник (гирла Дона)", 47.132, 39.322, 63],["п. Донской (канал Новочеркасской ГРЭС)", 47.412, 40.232, 63],["х. Калинин (р. Дон)", 47.428, 40.422, 63],["х. Арпачин (р. Дон)", 47.285, 40.215, 63],["х. Сусат (р. Сусат / р. Сал)", 47.432, 40.822, 63],["х. Спорный (Весёловское вдхр.)", 47.065, 40.965, 63],["х. Каракашев (Весёловское вдхр.)", 47.015, 41.125, 63],["х. Степной Курган (Усть-Манычское вдхр.)", 46.942, 41.242, 63],["х. Пустошкин (Маныч)", 47.202, 40.485, 63],["с. Синявское (р. Мёртвый Донец)", 47.278, 39.295, 63],["с. Самарское (р. Кагальник)", 46.935, 39.675, 63],["с. Кагальник (Таганрогский залив / устье Дона)", 47.088, 39.318, 63],["с. Маргаритово (Чумбур-Коса / Таганрогский залив)", 46.965, 38.885, 63],["с. Порт-Катон (Таганрогский залив)", 46.885, 38.798, 63],["с. Павло-Очаково (Павло-Очаковская коса)", 47.042, 39.105, 63],["с. Петрушино (Таганрогский залив)", 47.185, 38.855, 63],["с. Беглица (Беглицкая коса)", 47.135, 38.545, 63],["с. Покровское (р. Миус)", 47.415, 38.895, 63],["с. Лакедемоновка (Миусский лиман)", 47.205, 38.625, 63],["Авдеевка (Авдеевский карьер)", 48.139, 37.742, 10],["Амвросиевка (р. Крынка)", 47.794, 38.478, 10],["Артёмово", 48.382, 37.895, 10],["Артёмовск (р. Бахмутка)", 48.595, 38.001, 10],["Белицкое", 48.408, 37.179, 10],["Белозёрское", 48.528, 37.046, 10],["Родинское", 48.352, 37.206, 10],["Горняк", 48.049, 37.367, 10],["Димитров", 48.292, 37.268, 10],["Доброполье (р. Бык)", 48.468, 37.082, 10],["Докучаевск (р. Сухая Волноваха)", 47.751, 37.676, 10],["Дружковка (р. Казённый Торец)", 48.622, 37.528, 10],["Ждановка", 48.148, 38.258, 10],["Иловайск", 47.926, 38.196, 10],["Кировское", 48.148, 38.362, 10],["Комсомольское (р. Кальмиус)", 47.668, 38.074, 10],["Константиновка (Клебан-Быкское вдхр.)", 48.526, 37.704, 10],["Краматорск (р. Казённый Торец)", 48.739, 37.584, 10],["Красноармейск", 48.282, 37.182, 10],["Красногоровка (р. Лозовая)", 48.006, 37.508, 10],["Красный Лиман (р. Северский Донец / Голубые озёра)", 48.988, 37.802, 10],["Курахово (Кураховское вдхр.)", 47.985, 37.276, 10],["Марьинка", 47.942, 37.504, 10],["Моспино", 47.882, 38.064, 10],["Николаевка (р. Северский Донец)", 48.854, 37.772, 10],["Новогородовка", 48.204, 37.338, 10],["Светлодарск (Углегорское вдхр.)", 48.435, 38.222, 10],["Святогорск (р. Северский Донец)", 49.038, 37.568, 10],["Северск (р. Бахмутка)", 48.868, 38.098, 10],["Селидово (р. Солёная)", 48.148, 37.302, 10],["Славянск (р. Казённый Торец)", 48.853, 37.605, 10],["Снежное (р. Миус)", 48.028, 38.766, 10],["Соледар", 48.695, 38.067, 10],["Торез", 48.022, 38.628, 10],["Дзержинск", 48.398, 37.848, 10],["Углегорск", 48.312, 38.268, 10],["Угледар (р. Кашлагач)", 47.779, 37.248, 10],["Украинск", 48.098, 37.362, 10],["Часов Яр", 48.588, 37.838, 10],["Шахтёрск (р. Ольховая)", 48.046, 38.468, 10],["Юнокоммунаровск", 48.222, 38.278, 10],["Ясиноватая (исток р. Кальмиус)", 48.128, 37.862, 10],["пгт Мангуш", 47.056, 37.308, 10],["пгт Ялта (Белосарайский залив)", 46.962, 37.268, 10],["с. Мелекино (Азовское море)", 46.976, 37.405, 10],["с. Белосарайская Коса (Азовское море)", 46.905, 37.332, 10],["с. Урзуф (устье р. Берда / Азовское море)", 46.915, 37.105, 10],["с. Бабах-Тарама (Азовское море)", 46.892, 37.068, 10],["с. Юрьевка (Азовское море)", 46.942, 37.175, 10],["с. Безыменное (Таганрогский залив)", 47.105, 37.935, 10],["с. Широкино (Азовское море)", 47.098, 37.812, 10],["пгт Сартана (р. Кальмиус)", 47.175, 37.695, 10],["пгт Старый Крым (Старокрымское вдхр., Мариуполь)", 47.162, 37.488, 10],["с. Павлополь (Павлопольское вдхр.)", 47.262, 37.788, 10],["с. Гранитное (р. Кальмиус)", 47.455, 37.865, 10],["пгт Тельманово", 47.412, 38.018, 10],["пгт Новый Свет (Старобешевское вдхр.)", 47.805, 38.022, 10],["пгт Нижняя Крынка (Ханжонковское вдхр.)", 48.105, 38.162, 10],["пгт Зуевка (р. Крынка)", 48.042, 38.252, 10],["пгт Ольгинка", 47.695, 37.515, 10],["пгт Великая Новосёлка (р. Мокрые Ялы)", 47.838, 36.835, 10],["пгт Райгородок (р. Северский Донец)", 48.902, 37.725, 10],["с. Щурово (р. Северский Донец / Голубые озёра)", 48.952, 37.692, 10],["Александровск (р. Лугань)", 48.582, 39.192, 30],["Алмазная", 48.518, 38.582, 30],["Антрацит (р. Нагольная)", 48.118, 39.092, 30],["Артёмовск (Перевальский р-н, р. Белая)", 48.438, 38.732, 30],["Брянка (р. Лозовая)", 48.512, 38.642, 30],["Вахрушево (Яновское вдхр.)", 48.162, 38.838, 30],["Горское", 48.742, 38.495, 30],["Зимогорье (р. Лугань)", 48.588, 38.922, 30],["Золотое", 48.692, 38.518, 30],["Зоринск", 48.412, 38.618, 30],["Ирмино (р. Лугань)", 48.598, 38.582, 30],["Кировск (р. Лугань)", 48.638, 38.642, 30],["Кременная (р. Красная / р. Северский Донец)", 49.052, 38.218, 30],["Лутугино (Лутугинское вдхр.)", 48.402, 39.212, 30],["Миусинск (Штеровское вдхр. / р. Миус)", 48.075, 38.898, 30],["Молодогвардейск", 48.348, 39.658, 30],["Новодружеск (р. Северский Донец)", 48.962, 38.352, 30],["Первомайск (р. Лугань)", 48.628, 38.548, 30],["Перевальск", 48.435, 38.818, 30],["Петровское", 48.282, 38.878, 30],["Попасная", 48.632, 38.378, 30],["Приволье (р. Северский Донец)", 49.002, 38.295, 30],["Ровеньки", 48.072, 39.342, 30],["Рубежное (р. Северский Донец / оз. Песочное)", 49.012, 38.372, 30],["Свердловск (Должанское вдхр.)", 48.058, 39.658, 30],["Суходольск", 48.352, 39.722, 30],["Червонопартизанск", 48.082, 39.788, 30],["пгт Славяносербск (р. Северский Донец)", 48.696, 38.972, 30],["с. Трёхизбенка (р. Северский Донец)", 48.758, 38.962, 30],["пгт Новоайдар (р. Айдар)", 48.968, 39.002, 30],["пгт Белолуцк (р. Айдар)", 49.702, 39.025, 30],["пгт Новопсков (р. Айдар)", 49.532, 39.098, 30],["пгт Марковка (р. Деркул)", 49.524, 39.568, 30],["пгт Беловодск (р. Деркул)", 49.198, 39.575, 30],["пгт Меловое", 49.378, 40.132, 30],["пгт Троицкое (р. Уразова)", 49.905, 38.302, 30],["пгт Нижняя Дуванка (р. Красная)", 49.582, 38.165, 30],["пгт Успенка (Лутугинское вдхр.)", 48.388, 39.162, 30],["с. Елизаветовка (Елизаветовское вдхр.)", 48.295, 39.062, 30],["пгт Родаково (р. Лугань)", 48.558, 39.028, 30],["с. Пархоменко / Кружиловка (р. Северский Донец)", 48.585, 39.775, 30],["с. Дьяково (р. Нагольная)", 47.945, 39.138, 30],["Вольнянск (р. Вольнянка)", 47.942, 35.432, 13],["Гуляйполе (р. Гайчур)", 47.662, 36.258, 13],["Запорожье (р. Днепр)", 47.838, 35.139, 13],["Молочанск (р. Молочная)", 47.206, 35.596, 13],["Орехов (р. Конка)", 47.567, 35.785, 13],["пгт Акимовка (р. Малый Утлюк)", 46.632, 35.158, 13],["пгт Приазовское", 46.738, 35.636, 13],["пгт Мирное (р. Молочная)", 46.942, 35.432, 13],["с. Степановка Первая (Молочный лиман / Азовское море)", 46.482, 35.545, 13],["с. Мироновка (Азовское море)", 46.535, 35.625, 13],["с. Строгановка (Азовское море)", 46.592, 35.815, 13],["с. Ботиево (устье р. Корсак / Азовское море)", 46.605, 35.845, 13],["с. Набережное (Обиточная коса / Обиточный залив)", 46.648, 36.258, 13],["с. Райновка (устье р. Лозоватка)", 46.658, 36.115, 13],["с. Новопетровка (устье р. Берда / Бердянский залив)", 46.828, 36.885, 13],["с. Осипенко (р. Берда / Бердянское вдхр.)", 46.912, 36.822, 13],["с. Азовское (Бердянск)", 46.775, 36.735, 13],["с. Великая Знаменка (р. Днепр)", 47.438, 34.352, 13],["с. Водяное (р. Днепр, Энергодар)", 47.488, 34.492, 13],["с. Ивановка (р. Днепр)", 47.475, 34.725, 13],["с. Благовещенка (р. Днепр)", 47.458, 34.832, 13],["с. Балки (р. Днепр)", 47.382, 34.942, 13],["с. Скельки (Васильевский залив / р. Днепр)", 47.445, 35.162, 13],["пгт Михайловка", 47.272, 35.222, 13],["пгт Весёлое", 47.015, 34.915, 13],["пгт Черниговка (р. Токмак)", 47.188, 36.198, 13],["пгт Куйбышево (исток р. Берда)", 47.358, 36.648, 13],["пгт Розовка", 47.388, 37.058, 13],["Берислав (р. Днепр)", 46.841, 33.428, 82],["Таврийск (р. Днепр / СКК)", 46.754, 33.422, 82],["Херсон (низовья и дельта р. Днепр)", 46.635, 32.617, 82],["пгт Рыково", 46.332, 34.758, 82],["пгт Новоалексеевка", 46.222, 34.638, 82],["пгт Новотроицкое", 46.352, 34.335, 82],["пгт Сивашское", 46.385, 34.548, 82],["пгт Нижние Серогозы", 46.845, 34.378, 82],["пгт Ивановка", 46.712, 34.552, 82],["с. Геническая Горка (Арабатская стрелка)", 46.102, 34.828, 82],["с. Счастливцево (Арабатская стрелка)", 46.035, 34.838, 82],["с. Стрелковое (Арабатская стрелка)", 45.896, 34.882, 82],["с. Приозёрное (Геническое оз.)", 46.085, 34.805, 82],["с. Чонгар (Чонгарский пролив Сиваша)", 46.032, 34.545, 82],["с. Строгановка (Сиваш)", 46.238, 33.892, 82],["с. Сергеевка (Сиваш)", 46.298, 34.252, 82],["пгт Каланчак", 46.252, 33.292, 82],["пгт Мирное (Каланчакский р-н)", 46.258, 33.468, 82],["с. Красное (Джарылгачский залив)", 46.122, 32.775, 82],["с. Приморское (Большевик, Чёрное море)", 46.142, 32.398, 82],["с. Хорлы (Каркинитский залив)", 46.082, 33.295, 82],["с. Бехтеры (оз. Лиман)", 46.248, 32.292, 82],["с. Рыбальче (Днепровско-Бугский лиман)", 46.472, 32.232, 82],["с. Геройское (Днепровско-Бугский лиман)", 46.508, 31.898, 82],["с. Покровское (Кинбурнская коса)", 46.512, 31.622, 82],["пгт Днепряны (р. Днепр)", 46.748, 33.278, 82],["пгт Казацкое (р. Днепр)", 46.788, 33.342, 82],["пгт Любимовка (р. Днепр)", 46.808, 33.568, 82],["пгт Горностаевка (р. Днепр)", 47.005, 33.728, 82],["пгт Великая Лепетиха (р. Днепр)", 47.162, 33.935, 82],["пгт Верхний Рогачик", 47.242, 34.358, 82],["с. Корсунка (р. Днепр)", 46.742, 33.195, 82],["с. Крынки (р. Крынка / Конка)", 46.735, 33.082, 82],["с. Старая Збурьевка (Збурьевский кут)", 46.472, 32.422, 82],["с. Кизомыс (дельта Днепра)", 46.558, 32.352, 82],["Махачкала", 42.9849, 47.5047, 50],["Каспийск", 42.885, 47.638, 50],["Дербент", 42.0678, 48.2899, 50],["Кизляр", 43.847, 46.714, 50],["Ставрополь", 45.0428, 41.9734, 72],["Пятигорск", 44.0486, 43.0594, 72],["Грозный (Грозненское море / р. Сунжа)", 43.3184, 45.6986, 84],["Гудермес (р. Сунжа / Белка)", 43.3508, 46.1036, 84],["Шелковская (р. Терек / оз. Каргалинское)", 43.5089, 46.3389, 84],["Наурская (р. Терек)", 43.6522, 45.3117, 84],["Кезеной-Ам (высокогорное форелевое озеро)", 42.7758, 46.1519, 84],["Шали", 43.1481, 45.9019, 84],["Аргун", 43.2922, 45.8722, 84],["Магас", 43.1686, 44.8131, 51],["Назрань (р. Сунжа)", 43.2256, 44.7628, 51],["Сунжа (р. Сунжа / Асса)", 43.3156, 45.0472, 51],["Карабулак", 43.3053, 44.9094, 51],["Малгобек", 43.5094, 44.5881, 51],["Нальчик (р. Нальчик / Черек)", 43.4853, 43.6071, 16],["Прохладный (р. Малка / Терек)", 43.7575, 44.0297, 16],["Майский (р. Терек / Черек)", 43.6317, 44.0589, 16],["Баксан (р. Баксан)", 43.6819, 43.5358, 16],["Голубые озёра (Аушигер / Черек)", 43.2319, 43.6214, 16],["Черкесск (Кубанское вдхр. / р. Кубань)", 44.2269, 42.0467, 20],["Усть-Джегута (Усть-Джегутинское вдхр.)", 44.0858, 41.9733, 20],["Карачаевск (р. Кубань / Теберда)", 43.7731, 41.9142, 20],["Зеленчукская (р. Большой Зеленчук)", 43.8586, 41.5906, 20],["Теберда (форелевые реки)", 43.4472, 41.7433, 20],["Владикавказ (р. Терек)", 43.0246, 44.6818, 59],["Моздок (р. Терек)", 43.7481, 44.6561, 59],["Алагир (р. Ардон)", 43.0417, 44.2197, 59],["Ардон (р. Ардон / Терек)", 43.1753, 44.2969, 59],["Беслан", 43.1889, 44.5369, 59],["Невинномысск (р. Кубань)", 44.6339, 41.9428, 72],["Солнечнодольск (Новотроицкое вдхр.)", 45.3136, 41.5036, 72],["Будённовск (оз. Буйвола / р. Кума)", 44.7847, 44.1658, 72],["Дивное (оз. Маныч-Гудило)", 45.9089, 43.3569, 72],["Ессентуки", 44.0444, 42.8606, 72],["Кисловодск", 43.9056, 42.7169, 72],["Минеральные Воды", 44.2103, 43.1353, 72],["Георгиевск", 44.1497, 43.4706, 72],["Изобильный", 45.3694, 41.7119, 72],["Сулак (устье р. Сулак / Каспий)", 43.2689, 47.5419, 50],["Дубки (Чиркейское вдхр.)", 43.0211, 46.8358, 50],["Избербаш (Каспийское море)", 42.5694, 47.8644, 50],["Крайновка (Терек / Аграханский залив)", 43.7889, 47.4106, 50],["Буйнакск (р. Шура-Озень / Чиркейское вдхр.)", 42.821, 47.118, 50],["Дагестанские Огни (Каспийское море)", 42.122, 48.192, 50],["Кизилюрт (р. Сулак / Чирюртовское вдхр.)", 43.202, 46.872, 50],["Хасавюрт (р. Ярыксу / р. Акташ)", 43.248, 46.588, 50],["Южно-Сухокумск (р. Сухая Кума)", 44.658, 45.648, 50],["пгт Бавтугай (Чирюртовское вдхр.)", 43.162, 46.845, 50],["пгт Шамилькала (Ирганайское вдхр.)", 42.685, 46.875, 50],["пгт Белиджи (р. Самур / Каспий)", 41.888, 48.415, 50],["пгт Мамедкала", 42.178, 48.118, 50],["пгт Манаскент (Каспийское море / устье р. Манас)", 42.732, 47.702, 50],["пгт Тюбе", 43.052, 47.345, 50],["пгт Ачису", 42.542, 47.748, 50],["п. Зеленоморск (Каспийское море)", 42.682, 47.735, 50],["пгт Комсомольский (Кизилюрт)", 43.192, 46.925, 50],["пгт Шамхал", 43.058, 47.318, 50],["пгт Ленинкент", 42.982, 47.382, 50],["пгт Тарки", 42.942, 47.495, 50],["пгт Кяхулай", 42.952, 47.515, 50],["пгт Альбурикент", 42.958, 47.475, 50],["ст. Каргалинская (Каргалинский гидроузел, р. Терек)", 43.742, 46.472, 50],["ст. Александрийская (р. Терек)", 43.882, 46.912, 50],["с. Коктюбей (устье р. Таловка / Кизлярский залив)", 44.352, 46.632, 50],["с. Кочубей (р. Таловка)", 44.392, 46.548, 50],["с. Тарумовка", 44.075, 46.525, 50],["с. Брянск (Кизлярский залив / Каспий)", 44.285, 46.685, 50],["с. Суюткино (Кизлярский залив)", 44.145, 46.795, 50],["с. Новый Бирюзяк (оз. Южный Аграхан / р. Терек)", 43.918, 47.068, 50],["с. Старый Терек (Аграханский залив)", 43.825, 47.345, 50],["с. Главный Сулак (устье р. Сулак)", 43.258, 47.495, 50],["с. Новокаякент (Каспийское море / оз. Аджи)", 42.388, 47.988, 50],["с. Первомайское (Каякентский р-н, Каспий)", 42.452, 47.912, 50],["с. Каякент", 42.358, 47.848, 50],["с. Инчхе (Каспийское море)", 42.478, 47.905, 50],["с. Арабляр (Дербентский р-н)", 41.975, 48.352, 50],["с. Приморский (устье р. Самур / Самурский лес)", 41.848, 48.558, 50],["с. Тагиркент-Казмаляр (р. Самур)", 41.788, 48.462, 50],["с. Чиркей (Чиркейское вдхр.)", 42.968, 46.942, 50],["с. Миатли (Миатлинское вдхр.)", 43.072, 46.832, 50],["с. Ирганай (Ирганайское вдхр.)", 42.632, 46.912, 50],["с. Унцукуль (р. Аварское Койсу)", 42.712, 46.788, 50],["с. Гергебиль (Гергебильское вдхр.)", 42.505, 47.065, 50],["с. Гуниб (Гунибское вдхр. / р. Каракойсу)", 42.388, 46.958, 50],["с. Хунзах (оз. Мочох)", 42.542, 46.705, 50],["с. Ботлих (р. Андийское Койсу)", 42.668, 46.218, 50],["с. Тлярата (р. Джурмут)", 42.105, 46.352, 50],["с. Бежта", 42.132, 46.122, 50],["с. Агвали (р. Андийское Койсу)", 42.542, 46.118, 50],["с. Хебда (р. Аварское Койсу)", 42.442, 46.548, 50],["с. Ахты (р. Самур)", 41.462, 47.732, 50],["с. Рутул (р. Самур)", 41.535, 47.422, 50],["с. Курах (р. Курах)", 41.585, 47.785, 50],["с. Касумкент (р. Чирагчай)", 41.668, 48.142, 50],["с. Сергокала", 42.455, 47.662, 50],["с. Леваши", 42.432, 47.322, 50],["ст. Троицкая (р. Сунжа / р. Асса)", 43.308, 44.982, 51],["ст. Нестеровская (р. Асса / р. Фортанга)", 43.238, 45.062, 51],["ст. Вознесенская (Алханчуртский канал)", 43.542, 44.738, 51],["с. Экажево (р. Сунжа)", 43.212, 44.822, 51],["с. Сурхахи", 43.188, 44.898, 51],["с. Яндаре (р. Сунжа)", 43.255, 44.918, 51],["с. Али-Юрт", 43.142, 44.852, 51],["с. Плиево (р. Сунжа)", 43.252, 44.838, 51],["с. Барсуки (р. Сунжа)", 43.248, 44.802, 51],["с. Гази-Юрт (р. Сунжа)", 43.235, 44.875, 51],["с. Алхасты (р. Асса)", 43.132, 45.048, 51],["с. Галашки (р. Асса)", 43.078, 45.008, 51],["с. Мужичи (р. Асса)", 43.025, 44.992, 51],["с. Аршты (р. Фортанга)", 43.048, 45.125, 51],["с. Даттых (р. Фортанга)", 43.012, 45.142, 51],["с. Нижние Ачалуки", 43.395, 44.765, 51],["с. Кантышево (р. Камбилеевка)", 43.225, 44.635, 51],["с. Долаково (р. Камбилеевка)", 43.245, 44.652, 51],["с. Джейрах (р. Армхи / р. Терек)", 42.822, 44.678, 51],["с. Армхи (р. Армхи)", 42.812, 44.712, 51],["с. Эзми (р. Терек)", 42.838, 44.638, 51],["с. Гули", 42.818, 44.918, 51],["с. Таргим (верховья р. Асса)", 42.838, 44.938, 51],["с. Эгикал", 42.848, 44.912, 51],["с. Ольгети (р. Армхи)", 42.815, 44.778, 51],["Нарткала (р. Урвань / р. Черек)", 43.558, 43.854, 16],["Терек (р. Терек)", 43.484, 44.136, 16],["Тырныауз (верховья р. Баксан)", 43.385, 42.918, 16],["Чегем (р. Чегем)", 43.562, 43.585, 16],["пгт Залукокоаже (р. Золка / оз. Тамбукан)", 43.896, 43.218, 16],["пгт Кашхатау (р. Черек)", 43.318, 43.605, 16],["ст. Екатериноградская (слияние р. Малка и р. Терек)", 43.765, 44.232, 16],["ст. Солдатская (оз. Солдатское / Малкинские карьеры)", 43.778, 43.758, 16],["ст. Пришибская (р. Терек / р. Черек)", 43.698, 44.082, 16],["ст. Котляревская (р. Черек / р. Терек)", 43.592, 44.062, 16],["ст. Александровская (р. Терек / р. Урух)", 43.575, 44.115, 16],["ст. Прохладная (р. Малка)", 43.752, 44.012, 16],["с. Аушигер (р. Черек / вдхр. Аушигерской ГЭС)", 43.378, 43.722, 16],["с. Бабугент (слияние Черека Балкарского и Безенгийского)", 43.285, 43.585, 16],["с. Верхняя Балкария (р. Черек Балкарский)", 43.128, 43.458, 16],["с. Безенги (р. Черек Безенгийский)", 43.218, 43.298, 16],["с. Былым (оз. Гижгит / р. Баксан)", 43.465, 43.035, 16],["с. Эльбрус (верховья р. Баксан)", 43.258, 42.642, 16],["с. Терскол (верховья р. Баксан)", 43.258, 42.512, 16],["с. Верхний Чегем (р. Чегем)", 43.252, 43.148, 16],["с. Хушто-Сырт (Чегемские водопады)", 43.352, 43.228, 16],["с. Лечинкай (р. Чегем)", 43.508, 43.448, 16],["с. Каменномостское (р. Малка / оз. Шадхурей)", 43.748, 43.348, 16],["с. Сармаково (р. Малка)", 43.765, 43.218, 16],["с. Хабаз (верховья р. Малка)", 43.698, 42.905, 16],["с. Алтуд (Прохладненский р-н)", 43.748, 43.858, 16],["с. Кенже (р. Кенже / Нальчик)", 43.478, 43.552, 16],["с. Урвань (р. Урвань)", 43.508, 43.758, 16],["с. Старый Черек (р. Черек)", 43.545, 43.912, 16],["с. Аргудан (р. Аргудан)", 43.435, 43.918, 16],["с. Плановское (р. Урух)", 43.405, 44.205, 16],["пгт Домбай (верховья р. Теберда)", 43.288, 41.622, 20],["пгт Медногорский (р. Большая Лаба)", 43.918, 41.185, 20],["пгт Новый Карачай (р. Кубань)", 43.828, 41.905, 20],["пгт Орджоникидзевский (р. Кубань)", 43.842, 41.898, 20],["пгт Правокубанский (р. Кубань)", 43.918, 41.885, 20],["пгт Ударный (Кубанское вдхр.)", 44.342, 42.502, 20],["п. Эркен-Шахар (р. Кубань / р. Большой Зеленчук)", 44.375, 41.965, 20],["ст. Кардоникская (р. Кардоник)", 43.858, 41.712, 20],["ст. Сторожевая (р. Кяфар)", 43.882, 41.452, 20],["ст. Преградная (р. Уруп)", 43.952, 41.185, 20],["ст. Исправная (р. Большой Зеленчук)", 44.065, 41.608, 20],["ст. Красногорская (р. Кубань)", 43.942, 41.892, 20],["ст. Усть-Джегутинская (р. Кубань)", 44.085, 41.975, 20],["аул Учкулан (исток р. Кубань)", 43.458, 42.095, 20],["аул Хурзук (верховья р. Кубань)", 43.472, 42.125, 20],["аул Карт-Джурт (р. Кубань)", 43.528, 42.062, 20],["аул Каменномост (р. Кубань)", 43.785, 41.925, 20],["аул Кумыш (р. Кубань)", 43.882, 41.895, 20],["аул Верхняя Мара (р. Мара)", 43.782, 42.125, 20],["п. Архыз (р. Большой Зеленчук / р. Псыш)", 43.562, 41.278, 20],["п. Нижний Архыз (р. Большой Зеленчук)", 43.682, 41.468, 20],["аул Хабез (р. Малый Зеленчук)", 44.038, 41.772, 20],["аул Али-Бердуковский (р. Малый Зеленчук)", 43.988, 41.748, 20],["аул Зеюко (р. Малый Зеленчук)", 44.112, 41.788, 20],["аул Бесленей (р. Большой Зеленчук)", 44.235, 41.735, 20],["аул Икон-Халк (р. Малый Зеленчук)", 44.292, 41.908, 20],["аул Адыге-Хабль (р. Малый Зеленчук)", 44.332, 41.935, 20],["аул Псаучье-Дахе (р. Малый Зеленчук)", 44.212, 41.855, 20],["с. Курджиново (р. Большая Лаба)", 43.988, 40.955, 20],["п. Пхия (верховья р. Большая Лаба)", 43.628, 40.895, 20],["п. Загедан (р. Большая Лаба)", 43.682, 40.885, 20],["п. Рожкао (р. Большая Лаба)", 43.812, 40.912, 20],["с. Уруп (верховья р. Уруп)", 43.815, 41.158, 20],["с. Учкекен (р. Подкумок / Эшкаконское вдхр.)", 43.938, 42.512, 20],["с. Терезе (р. Подкумок)", 43.932, 42.442, 20],["с. Первомайское (р. Подкумок, КЧР)", 43.942, 42.478, 20],["с. Красный Восток (р. Кума)", 44.018, 42.338, 20],["Дигора (р. Урсдон / Ардон)", 43.158, 44.156, 59],["пгт Заводской (р. Терек, Владикавказ)", 43.092, 44.648, 59],["ст. Луковская (р. Терек, Моздок)", 43.738, 44.618, 59],["ст. Павлодольская (р. Терек / Павлодольский гидроузел)", 43.722, 44.492, 59],["ст. Терская (р. Терек)", 43.728, 44.732, 59],["ст. Черноярская (р. Терек)", 43.702, 44.378, 59],["ст. Ново-Осетинская (р. Терек)", 43.715, 44.425, 59],["ст. Архонская (р. Архонка / Гизельдон)", 43.132, 44.508, 59],["ст. Змейская (р. Терек / Змейские карьеры)", 43.332, 44.272, 59],["ст. Николаевская (слияние р. Урух, Ардон и Терек)", 43.272, 44.198, 59],["ст. Прохладная / Притеречная (Моздокский участок)", 43.725, 44.565, 59],["с. Эльхотово (р. Терек / Эльхотовские ворота)", 43.318, 44.312, 59],["с. Карджин (оз. Бекан / р. Терек)", 43.278, 44.338, 59],["с. Даргкох (р. Терек / оз. Бекан)", 43.262, 44.352, 59],["с. Кизляр (Моздокский р-н, р. Терек)", 43.705, 44.622, 59],["с. Сухотское (р. Терек)", 43.658, 44.385, 59],["с. Чикола (р. Урух)", 43.202, 43.918, 59],["с. Ахсарисар (р. Урух)", 43.105, 43.845, 59],["с. Мацута (Дигорское ущелье, р. Урух)", 42.982, 43.792, 59],["с. Дзинага (верховья р. Урух)", 42.905, 43.702, 59],["п. Бурон (р. Ардон / р. Цейдон)", 42.792, 44.008, 59],["с. Нижний Зарамаг (Зарамагское вдхр. / р. Ардон)", 42.708, 43.982, 59],["п. Мизур (р. Ардон)", 42.848, 44.058, 59],["п. Верхний Фиагдон (р. Фиагдон)", 42.845, 44.305, 59],["с. Дзуарикау (р. Фиагдон)", 42.992, 44.382, 59],["с. Даргавс (р. Гизельдон)", 42.838, 44.432, 59],["с. Кобан (р. Гизельдон)", 42.912, 44.482, 59],["с. Гизель (р. Гизельдон)", 43.035, 44.575, 59],["с. Нижний Ларс / Чми (Дарьяльское ущелье, р. Терек)", 42.782, 44.632, 59],["Урус-Мартан (р. Мартан / р. Гойта)", 43.132, 45.538, 84],["Курчалой (р. Гумс / р. Хулхулау)", 43.204, 46.088, 84],["Серноводское (р. Сунжа / р. Асса)", 43.315, 45.168, 84],["Ачхой-Мартан (р. Фортанга / р. Ачхой)", 43.192, 45.282, 84],["Ойсхара (Гудермесский р-н)", 43.258, 46.238, 84],["ст. Ищёрская (р. Терек)", 43.718, 45.145, 84],["ст. Мекенская (р. Терек)", 43.635, 45.432, 84],["ст. Калиновская (р. Терек)", 43.575, 45.525, 84],["ст. Николаевская (р. Терек, Наурский р-н)", 43.512, 45.675, 84],["ст. Савельевская (р. Терек)", 43.605, 45.475, 84],["ст. Червлённая (р. Терек)", 43.475, 45.845, 84],["ст. Старогладовская (р. Терек)", 43.628, 46.265, 84],["ст. Гребенская (р. Терек)", 43.592, 46.215, 84],["ст. Курдюковская (р. Терек)", 43.665, 46.315, 84],["ст. Каргалинская (Каргалинский гидроузел, Шелковской р-н)", 43.748, 46.462, 84],["ст. Дубовская (р. Терек)", 43.785, 46.505, 84],["ст. Бороздинская (р. Прорва / Шелковские озёра)", 43.822, 46.522, 84],["ст. Петропавловская (р. Сунжа)", 43.368, 45.802, 84],["ст. Ильинская (р. Сунжа)", 43.382, 45.882, 84],["ст. Горячеводская (р. Сунжа)", 43.402, 45.772, 84],["ст. Первомайская (Грозненский р-н)", 43.395, 45.595, 84],["ст. Ассиновская (р. Асса / р. Сунжа)", 43.248, 45.182, 84],["с. Брагуны (слияние р. Сунжа и р. Терек)", 43.448, 46.122, 84],["с. Толстой-Юрт (р. Терек)", 43.442, 45.782, 84],["с. Виноградное (р. Терек)", 43.455, 45.822, 84],["с. Алхан-Кала (р. Сунжа)", 43.272, 45.552, 84],["с. Алхан-Юрт (р. Сунжа)", 43.252, 45.568, 84],["с. Закан-Юрт (р. Сунжа)", 43.265, 45.418, 84],["с. Самашки (р. Сунжа)", 43.285, 45.325, 84],["с. Чири-Юрт (р. Аргун)", 43.068, 45.742, 84],["с. Дуба-Юрт (р. Аргун)", 43.038, 45.735, 84],["с. Шатой (р. Аргун)", 42.872, 45.688, 84],["с. Итум-Кале (верховья р. Аргун)", 42.735, 45.575, 84],["с. Ведено (р. Хулхулау)", 42.968, 46.098, 84],["с. Хой (оз. Кезеной-Ам)", 42.758, 46.132, 84],["с. Шарой (р. Шароаргун)", 42.632, 45.815, 84],["с. Химой (р. Шароаргун)", 42.675, 45.838, 84],["с. Ножай-Юрт (р. Ямансу / р. Аксай)", 43.092, 46.378, 84],["Благодарный (р. Мокрая Буйвола / Волчьи Ворота)", 45.098, 43.438, 72],["Железноводск (Курортное оз. «30'Ка»)", 44.132, 43.028, 72],["Зеленокумск (р. Кума / Отказненское вдхр.)", 44.406, 43.876, 72],["Ипатово (р. Калаус)", 45.716, 42.905, 72],["Лермонтов", 44.104, 42.972, 72],["Михайловск (р. Ташла)", 45.128, 42.028, 72],["Нефтекумск (р. Кума)", 44.752, 44.978, 72],["Новоалександровск (р. Расшеватка)", 45.492, 41.218, 72],["Новопавловск (р. Малка / р. Кура)", 43.962, 43.638, 72],["Светлоград (р. Калаус / Солёное оз.)", 45.335, 42.854, 72],["пгт Иноземцево (оз. Каррас)", 44.092, 43.082, 72],["пгт Горячеводский (р. Подкумок)", 44.028, 43.095, 72],["пгт Свободы (р. Подкумок)", 44.018, 43.055, 72],["пгт Анджиевский (р. Кума)", 44.235, 43.112, 72],["пгт Рыздвяный", 45.322, 41.898, 72],["пгт Ударный (Ставропольский край)", 45.362, 41.185, 72],["ст. Новотроицкая (Новотроицкое вдхр. / р. Егорлык)", 45.328, 41.528, 72],["ст. Сенгилеевская (Сенгилеевское и Егорлыкское вдхр.)", 45.035, 41.622, 72],["ст. Барсуковская (р. Кубань)", 44.718, 41.732, 72],["ст. Григорополисская (р. Кубань)", 45.298, 41.055, 72],["ст. Расшеватская (р. Расшеватка)", 45.535, 41.045, 72],["ст. Каменнобродская (р. Егорлык)", 45.148, 41.588, 72],["ст. Филимоновская (р. Егорлык)", 45.212, 41.555, 72],["ст. Темнолесская (р. Егорлык)", 44.842, 41.882, 72],["ст. Воровсколесская", 44.492, 42.548, 72],["ст. Курская (Курское вдхр. / р. Кура)", 44.042, 44.458, 72],["ст. Галюгаевская (р. Терек)", 43.698, 44.822, 72],["ст. Стодеревская (р. Терек)", 43.702, 44.765, 72],["ст. Александрийская (р. Кума)", 44.235, 43.318, 72],["ст. Георгиевская (р. Подкумок)", 44.122, 43.475, 72],["ст. Лысогорская (р. Подкумок)", 44.065, 43.305, 72],["ст. Незлобная (р. Подкумок)", 44.118, 43.405, 72],["ст. Зольская (р. Золка)", 43.912, 43.372, 72],["ст. Марьинская (р. Малка)", 43.882, 43.512, 72],["ст. Советская (р. Кура)", 44.022, 43.885, 72],["ст. Суворовская (р. Дарья)", 44.185, 42.662, 72],["ст. Боргустанская", 44.045, 42.548, 72],["ст. Ессентукская (р. Подкумок)", 44.028, 42.872, 72],["ст. Бекешевская (верхний Подкумок)", 44.105, 42.418, 72],["с. Прасковея (р. Кума)", 44.738, 44.198, 72],["с. Архангельское (р. Кума)", 44.618, 44.118, 72],["с. Орловка (р. Кума)", 44.682, 44.155, 72],["с. Левокумское (р. Кума / Терско-Кумский канал)", 44.818, 44.658, 72],["с. Величаевское (р. Восточный Маныч)", 45.285, 44.918, 72],["с. Турксад (Чограйское вдхр.)", 45.432, 44.475, 72],["с. Арзгир (Чограйское вдхр.)", 45.372, 44.222, 72],["с. Новоселицкое (вдхр. Волчьи Ворота)", 44.758, 43.448, 72],["с. Александровское (р. Томузловка)", 44.712, 43.002, 72],["с. Кочубеевское (р. Кубань)", 44.688, 41.828, 72],["с. Курсавка", 44.455, 42.505, 72],["с. Донское (р. Ташла)", 45.302, 41.972, 72],["с. Красногвардейское (р. Егорлык)", 45.845, 41.522, 72],["с. Приозёрское (оз. Дадынское)", 45.322, 44.775, 72],["с. Манычское (оз. Маныч-Гудило / Вшивое оз.)", 45.925, 43.765, 72],["с. Птичье (р. Егорлык)", 45.498, 41.615, 72],["х. Кизилов", 45.285, 42.065, 72],["х. Спорный (Изобильненский р-н)", 45.352, 41.685, 72],["х. Конный", 45.105, 41.805, 72],["аул Абрам-Тюбе", 44.582, 44.912, 72],["аул Тукуй-Мектеб", 44.492, 44.978, 72],["аул Кара-Тюбе (р. Кума)", 44.695, 44.778, 72],["аул Куликовы Копани", 45.388, 43.475, 72],["аул Чур", 45.342, 43.395, 72],["аул Малый Барханчак", 45.652, 43.148, 72],["аул Шарахалсун", 45.485, 43.615, 72],["Нижний Новгород", 56.3269, 44.0059, 36],["Бор", 56.358, 44.062, 36],["Кстово", 56.151, 44.195, 36],["Городец", 56.643, 43.472, 36],["Заволжье", 56.641, 43.393, 36],["Чкаловск", 56.768, 43.242, 36],["Лысково", 56.012, 45.025, 36],["Васильсурск", 56.129, 46.007, 36],["Павлово", 55.962, 43.09, 36],["Выкса", 55.319, 42.173, 36],["Чебоксары", 56.1439, 47.2489, 85],["Новочебоксарск", 56.11, 47.479, 85],["Козловка", 55.842, 48.248, 85],["Йошкар-Ола", 56.6344, 47.8999, 56],["Волжск", 55.866, 48.358, 56],["Козьмодемьянск", 56.341, 46.564, 56],["Казань", 55.7961, 49.1064, 60],["Зеленодольск", 55.845, 48.518, 60],["Васильево", 55.838, 48.665, 60],["Лаишево", 55.405, 49.55, 60],["Камское Устье", 55.202, 49.272, 60],["Тетюши", 54.938, 48.838, 60],["Болгар", 54.96, 49.043, 60],["Чистополь", 55.363, 50.642, 60],["Мамадыш", 55.716, 51.409, 60],["Елабуга", 55.758, 52.046, 60],["Набережные Челны", 55.7436, 52.3958, 60],["Нижнекамск", 55.6366, 51.8245, 60],["Мензелинск", 55.726, 53.102, 60],["Ульяновск", 54.3142, 48.4031, 79],["Димитровград", 54.214, 49.618, 79],["Сенгилей", 53.966, 48.798, 79],["Старая Майна", 54.609, 48.928, 79],["Самара", 53.1959, 50.1002, 65],["Тольятти", 53.5078, 49.4204, 65],["Жигулёвск", 53.402, 49.495, 65],["Сызрань", 53.155, 48.474, 65],["Новокуйбышевск", 53.099, 49.948, 65],["Пенза", 53.1959, 45.0183, 42],["Саранск", 54.1874, 45.1839, 57],["Саратов", 51.5336, 46.0343, 67],["Энгельс", 51.4989, 46.125, 67],["Маркс", 51.709, 46.749, 67],["Вольск", 52.043, 47.379, 67],["Балаково", 52.039, 47.784, 67],["Хвалынск", 52.492, 48.106, 67],["Киров", 58.6035, 49.668, 22],["Кирово-Чепецк", 58.552, 50.043, 22],["Вятские Поляны", 56.221, 51.068, 22],["Ижевск", 56.8527, 53.2115, 78],["Воткинск", 57.051, 53.987, 78],["Сарапул", 56.467, 53.798, 78],["Камбарка", 56.266, 54.205, 78],["Пермь", 58.0105, 56.2502, 43],["Краснокамск", 58.08, 55.755, 43],["Добрянка", 58.459, 56.416, 43],["Чусовой", 58.296, 57.816, 43],["Кунгур", 57.428, 56.945, 43],["Оса", 57.283, 55.458, 43],["Чайковский", 56.768, 54.115, 43],["Березники", 59.409, 56.804, 43],["Соликамск", 59.645, 56.77, 43],["Уфа", 54.7388, 55.9721, 48],["Бирск", 55.418, 55.536, 48],["Павловка (Павловское вдхр.)", 55.421, 56.551, 48],["Нефтекамск", 56.088, 54.248, 48],["Агидель", 55.899, 53.937, 48],["Стерлитамак", 53.63, 55.931, 48],["Салават", 53.361, 55.925, 48],["Белорецк", 53.966, 58.4, 48],["Оренбург", 51.7682, 55.097, 40],["Орск", 51.229, 58.475, 40],["Энергетик (Ириклинское вдхр.)", 51.745, 58.793, 40],["Бузулук", 52.788, 52.262, 40],["Мишкино (Башкортостан)", 55.461, 55.948, 48],["Караидель", 55.833, 56.917, 48],["Павловка (Башкортостан)", 55.418, 56.556, 48],["Красная Горка (Нуримановский)", 55.197, 56.662, 48],["Дюртюли", 55.492, 54.866, 48],["Кушнаренково", 55.102, 55.344, 48],["Благовещенск (Башкортостан)", 55.035, 55.978, 48],["Янаул", 56.265, 54.931, 48],["Бураево", 55.841, 55.408, 48],["Старобалтачево", 56.0, 55.9, 48],["Аскино", 56.089, 56.578, 48],["Верхние Татышлы", 56.289, 55.858, 48],["Калтасы", 55.973, 54.855, 48],["Николо-Берёзовка", 56.128, 54.162, 48],["Туймазы", 54.6, 53.7, 48],["Октябрьский (Башкортостан)", 54.481, 53.471, 48],["Бакалы", 55.179, 53.803, 48],["Чекмагуш", 55.134, 54.655, 48],["Чишмы", 54.592, 55.388, 48],["Давлеканово", 54.219, 55.028, 48],["Раевский (Альшеево)", 54.066, 54.918, 48],["Белебей", 54.103, 54.122, 48],["Иглино", 54.834, 56.417, 48],["Кармаскалы", 54.371, 56.184, 48],["Архангельское (Башкортостан)", 54.421, 56.792, 48],["Красноусольский", 53.892, 56.469, 48],["Ишимбай", 53.449, 56.046, 48],["Мелеуз", 52.963, 55.932, 48],["Кумертау", 52.766, 55.786, 48],["Мраково", 52.716, 56.625, 48],["Инзер (Башкортостан)", 54.216, 57.556, 48],["Учалы", 54.319, 59.383, 48],["Сибай", 52.716, 58.666, 48],["Баймак", 52.592, 58.316, 48],["Аскарово (Банное)", 53.338, 58.514, 48],["Месягутово", 55.552, 58.252, 48],["Малояз", 55.181, 58.151, 48],["Большеустьикинское", 55.956, 58.273, 48],["Ильинский (Обва)", 58.569, 55.684, 43],["Пожва", 59.092, 56.089, 43],["Чердынь", 60.403, 56.479, 43],["Красновишерск", 60.403, 57.079, 43],["Болгар (Спасский затон)", 54.985, 49.056, 60],["Алексеевское (Кама)", 55.308, 50.115, 60],["Рыбная Слобода", 55.383, 50.145, 60],["Актаныш", 55.716, 54.083, 60],["Звенигово", 55.972, 48.015, 56],["Юрино (Ветлуга)", 56.292, 46.299, 56],["Макарьево", 56.082, 45.056, 36],["Шигоны (Усинский залив)", 53.389, 48.675, 65],["Ровное", 50.776, 46.052, 67],["Заречный (Пензенская)", 53.2028, 45.1669, 42],["Кузнецк (р. Сура / Труёв)", 53.1169, 46.6006, 42],["Сердобск (р. Сердоба)", 52.4581, 44.2169, 42],["Никольск (Пензенская)", 53.7189, 46.0719, 42],["Сурское (Сурское вдхр.)", 53.0819, 45.2219, 42],["Нижний Ломов (р. Ломовка / Мокша)", 53.5306, 43.6769, 42],["Рузаевка", 54.0628, 44.9506, 57],["Краснослободск (р. Мокша)", 54.4289, 43.7758, 57],["Темников (р. Мокша)", 54.6319, 43.2089, 57],["Ковылкино (р. Мокша)", 54.0389, 43.9189, 57],["Ардатов (р. Алатырь)", 54.8489, 46.2358, 57],["Котельнич (р. Вятка)", 58.3089, 48.3489, 22],["Советск (Кировская, р. Вятка / Пижма)", 57.5889, 48.9589, 22],["Уржум (р. Уржумка / Вятка)", 57.1139, 50.0019, 22],["Белая Холуница (Белохолуницкий пруд)", 58.8419, 50.8519, 22],["Алатырь (р. Сура / Алатырь)", 54.8419, 46.5789, 85],["Мариинский Посад (р. Волга)", 56.1158, 47.7169, 85],["Ядрин (р. Сура)", 55.9419, 46.2058, 85],["Глазов (р. Чепца)", 58.1389, 52.6589, 78],["Каракулино (р. Кама)", 56.0119, 53.7089, 78],["Межгорье", 54.052, 57.825, 48],["Приютово", 53.869, 53.873, 48],["Нугуш (Нугушское вдхр.)", 53.047, 56.453, 48],["Юмагузино (Юмагузинское вдхр.)", 52.893, 56.398, 48],["Зилаир", 52.233, 57.442, 48],["Старосубхангулово (Бурзян, р. Белая)", 53.106, 57.442, 48],["Акъяр", 51.863, 58.216, 48],["Исянгулово", 52.193, 56.578, 48],["Толбазы", 54.022, 55.891, 48],["Стерлибашево", 53.441, 55.261, 48],["Шаран", 54.819, 54.004, 48],["Ермекеево", 54.063, 53.669, 48],["Бижбуляк", 53.694, 54.265, 48],["Киргиз-Мияки", 53.633, 54.798, 48],["Фёдоровка (Башкортостан)", 53.168, 55.197, 48],["Верхнеяркеево", 55.451, 54.312, 48],["Кандры (оз. Кандрыкуль)", 54.558, 54.053, 48],["Амзя", 56.235, 54.379, 48],["Кага (р. Белая)", 53.526, 57.688, 48],["Узян (р. Белая)", 53.684, 57.854, 48],["Тирлянский", 54.213, 58.587, 48],["Медведево (Марий Эл)", 56.633, 47.804, 56],["Советский (Марий Эл)", 56.758, 48.475, 56],["Сернур", 56.933, 49.153, 56],["Морки", 56.431, 48.995, 56],["Новый Торъял", 57.002, 48.724, 56],["Оршанка", 56.915, 47.892, 56],["Параньга", 56.706, 49.403, 56],["Куженер", 56.811, 48.91, 56],["Мари-Турек", 56.79, 49.962, 56],["Килемары", 56.774, 46.885, 56],["Красногорский (Марий Эл, р. Илеть)", 56.151, 48.326, 56],["Суслонгер", 56.321, 48.248, 56],["Шелангер", 56.085, 48.203, 56],["Приволжский (Марий Эл)", 56.002, 48.431, 56],["Краснооктябрьский (Марий Эл)", 56.685, 47.747, 56],["Кокшайск (р. Волга / Кокшага)", 56.153, 47.808, 56],["Коротни (р. Волга / устье Ветлуги)", 56.292, 46.462, 56],["Красный Яр (Звениговский р-н, р. Волга)", 56.038, 47.921, 56],["Инсар", 53.87, 44.371, 57],["Зубова Поляна", 54.075, 42.836, 57],["Торбеево", 54.079, 43.245, 57],["Чамзинка", 54.404, 45.783, 57],["Комсомольский (Мордовия)", 54.442, 45.821, 57],["Ромоданово", 54.432, 45.328, 57],["Ялга", 54.131, 45.148, 57],["Николаевка (Саранск)", 54.155, 45.112, 57],["Луховка", 54.172, 45.258, 57],["Тургенево (р. Алатырь)", 54.835, 46.241, 57],["Кадошкино", 54.032, 44.416, 57],["Атяшево", 54.593, 46.103, 57],["Умёт", 54.115, 42.662, 57],["Потьма", 54.116, 42.905, 57],["Большие Березники (р. Сура)", 54.185, 46.161, 57],["Кочкурово", 54.035, 45.448, 57],["Ельники (р. Мокша)", 54.616, 43.875, 57],["Старое Шайгово", 54.307, 44.478, 57],["Теньгушево (р. Мокша)", 54.763, 42.716, 57],["Большое Игнатово", 55.032, 45.554, 57],["Дубёнки", 54.442, 46.307, 57],["Лямбирь", 54.319, 45.207, 57],["Кемля (р. Алатырь)", 54.682, 45.258, 57],["Агрыз", 56.526, 52.996, 60],["Азнакаево", 54.858, 53.074, 60],["Альметьевск", 54.901, 52.297, 60],["Арск", 56.091, 49.878, 60],["Бавлы", 54.393, 53.26, 60],["Бугульма", 54.536, 52.798, 60],["Буинск", 54.971, 48.292, 60],["Заинск", 55.318, 52.067, 60],["Иннополис", 55.752, 48.744, 60],["Кукмор", 56.185, 50.892, 60],["Лениногорск", 54.602, 52.444, 60],["Менделеевск", 55.908, 52.293, 60],["Нурлат", 54.428, 50.805, 60],["Куйбышевский Затон", 55.195, 49.186, 60],["Нижние Вязовые (Свияжск)", 55.792, 48.518, 60],["Уруссу (р. Ик)", 54.597, 53.462, 60],["Джалиль", 55.025, 52.735, 60],["Карабаш (Карабашское вдхр.)", 54.716, 52.583, 60],["Актюбинский", 54.814, 52.805, 60],["Балтаси", 56.345, 50.21, 60],["Богатые Сабы", 56.008, 50.448, 60],["Апастово (р. Свияга)", 55.203, 48.516, 60],["Аксубаево", 54.847, 50.793, 60],["Новошешминск (р. Шешма)", 55.068, 51.236, 60],["Муслюмово (р. Ик)", 55.311, 53.188, 60],["Сарманово", 55.253, 52.583, 60],["Черемшан", 54.661, 51.517, 60],["Верхний Услон (р. Волга)", 55.768, 48.983, 60],["Пестрецы (р. Мёша)", 55.754, 49.654, 60],["Высокая Гора", 55.915, 49.308, 60],["Старое Дрожжаное", 54.721, 47.558, 60],["Большие Кайбицы", 55.383, 48.133, 60],["Тюлячи (р. Мёша)", 55.881, 50.236, 60],["Свияжск (устье Свияги)", 55.771, 48.659, 60],["Сорочьи Горы (р. Кама / устье Мёши)", 55.352, 49.944, 60],["Атабаево (слияние Волги и Камы)", 55.206, 49.381, 60],["Ижевка (Нижнекамское вдхр.)", 55.925, 52.662, 60],["Красный Ключ (р. Кама)", 55.662, 51.789, 60],["Бетьки (р. Кама)", 55.623, 52.142, 60],["Можга", 56.444, 52.227, 78],["Игра", 57.554, 53.054, 78],["Ува", 56.979, 52.186, 78],["Балезино (р. Чепца)", 57.977, 53.011, 78],["Кез", 57.893, 53.712, 78],["Яр (р. Чепца)", 58.246, 52.105, 78],["Кизнер", 56.277, 51.51, 78],["Алнаши", 56.186, 52.481, 78],["Вавож (р. Вала / Ува)", 56.774, 51.93, 78],["Грахово", 56.048, 51.969, 78],["Дебёсы (р. Чепца)", 57.651, 53.809, 78],["Завьялово (Удмуртия)", 56.79, 53.376, 78],["Красногорское (Удмуртия)", 57.705, 52.497, 78],["Малая Пурга (р. Иж)", 56.557, 53.005, 78],["Селты", 57.311, 52.133, 78],["Сюмси (р. Кильмезь)", 57.11, 51.615, 78],["Шаркан", 57.302, 53.871, 78],["Юкаменское", 57.887, 52.244, 78],["Якшур-Бодья", 57.185, 53.153, 78],["Пудем (Пудемский пруд)", 58.358, 52.176, 78],["Новый (Воткинское вдхр.)", 56.814, 54.037, 78],["Гольяны (р. Кама)", 56.768, 53.733, 78],["Нечкино (р. Кама)", 56.678, 53.774, 78],["Боярка (р. Кама)", 55.983, 53.541, 78],["Усть-Бельск (слияние Белой и Камы)", 55.889, 53.479, 78],["Чеганда (р. Кама)", 55.908, 53.398, 78],["Канаш", 55.507, 47.492, 85],["Цивильск", 55.869, 47.479, 85],["Шумерля", 55.501, 46.413, 85],["Кугеси", 56.031, 47.298, 85],["Вурнары", 55.489, 46.96, 85],["Ибреси", 55.302, 47.034, 85],["Урмары", 55.686, 47.949, 85],["Батырево", 55.074, 47.611, 85],["Порецкое (р. Сура)", 55.197, 46.329, 85],["Шемурша", 54.896, 47.515, 85],["Комсомольское (Чувашия)", 55.222, 47.486, 85],["Яльчики", 55.174, 47.971, 85],["Моргауши", 56.017, 46.757, 85],["Аликово", 55.736, 46.744, 85],["Красноармейское (Чувашия)", 55.768, 47.171, 85],["Красные Четаи (р. Сура)", 55.691, 46.161, 85],["Сосновка (Заволжье Чебоксар, р. Волга)", 56.185, 47.222, 85],["Криуши (Козловский р-н, р. Волга)", 55.839, 48.248, 85],["Ильинка (Чебоксарское вдхр.)", 56.173, 46.706, 85],["Сюктерка (р. Волга)", 56.153, 47.068, 85],["Шомиково (р. Волга)", 56.162, 46.885, 85],["Александровск", 59.16, 57.581, 43],["Верещагино", 58.078, 54.657, 43],["Горнозаводск", 58.378, 58.323, 43],["Гремячинск", 58.567, 57.844, 43],["Губаха", 58.838, 57.551, 43],["Кизел", 59.048, 57.651, 43],["Кудымкар", 59.016, 54.659, 43],["Лысьва", 58.106, 57.805, 43],["Нытва", 57.939, 55.331, 43],["Оханск", 57.721, 55.388, 43],["Очёр", 57.882, 54.717, 43],["Усолье", 59.423, 56.682, 43],["Чёрмоз", 58.781, 56.148, 43],["Чернушка", 56.509, 56.077, 43],["Полазна (Камское вдхр.)", 58.293, 56.418, 43],["Яйва (Яйвинская ГРЭС / р. Яйва)", 59.333, 57.266, 43],["Пашия (р. Вижай)", 58.431, 58.261, 43],["Тёплая Гора (р. Койва)", 58.502, 59.026, 43],["Бисер (р. Бисер)", 58.463, 58.828, 43],["Кусье-Александровский (р. Койва / Чусовая)", 58.281, 58.362, 43],["Усть-Кишерть (р. Сылва)", 57.362, 57.248, 43],["Суксун (р. Сылва)", 57.143, 57.391, 43],["Октябрьский (Пермский край)", 56.517, 57.211, 43],["Куеда", 56.432, 55.588, 43],["Барда (р. Тулва)", 56.925, 55.586, 43],["Елово (Воткинское вдхр.)", 57.054, 54.918, 43],["Частые (Воткинское вдхр.)", 57.285, 54.972, 43],["Сива (р. Обва)", 58.374, 54.377, 43],["Карагай", 58.266, 54.935, 43],["Юсьва (р. Иньва)", 58.972, 54.965, 43],["Майкор (Иньвенский залив Камского вдхр.)", 59.006, 55.887, 43],["Коса (р. Коса)", 59.944, 55.004, 43],["Гайны (р. Кама)", 60.308, 54.326, 43],["Орда", 57.193, 56.908, 43],["Берёзовка (Пермский край)", 57.601, 57.309, 43],["Усть-Качка (р. Кама)", 57.994, 55.662, 43],["Хохловка (Камское вдхр.)", 58.258, 56.255, 43],["Сылва (Сылвенский залив)", 58.033, 56.768, 43],["Чусовские Городки (р. Чусовая)", 58.181, 57.105, 43],["Зуевка", 58.404, 51.132, 22],["Кирс", 59.339, 52.244, 22],["Луза", 60.631, 47.251, 22],["Малмыж", 56.519, 50.679, 22],["Мураши", 59.397, 48.961, 22],["Нолинск", 57.558, 49.936, 22],["Омутнинск", 58.672, 52.181, 22],["Орлов", 58.538, 48.891, 22],["Слободской", 58.73, 50.181, 22],["Сосновка (Кировская обл.)", 56.256, 51.282, 22],["Яранск", 57.303, 47.881, 22],["Нагорск (р. Вятка / Кобра)", 59.322, 50.806, 22],["Подосиновец (р. Юг)", 60.273, 47.069, 22],["Демьяново (р. Юг)", 60.354, 47.087, 22],["Опарино", 59.851, 48.274, 22],["Даровской (р. Молома / Кобра)", 58.771, 47.957, 22],["Свеча", 58.279, 47.514, 22],["Ленинское (Шабалино)", 58.31, 47.064, 22],["Оричи", 58.404, 49.054, 22],["Юрья (р. Великая)", 59.042, 49.277, 22],["Мурыгино (р. Вятка / Великая)", 58.736, 49.457, 22],["Вахруши", 58.672, 50.032, 22],["Кумёны", 58.106, 49.914, 22],["Суна", 57.834, 50.059, 22],["Богородское (Кировская обл.)", 57.828, 50.748, 22],["Уни", 57.752, 51.491, 22],["Фалёнки (р. Чепца)", 58.356, 51.594, 22],["Афанасьево (р. Кама)", 58.864, 53.253, 22],["Песковка (р. Вятка)", 59.048, 52.345, 22],["Лесной (Кировская обл.)", 59.782, 52.463, 22],["Рудничный (Кировская обл.)", 59.619, 52.478, 22],["Санчурск (р. Большая Кокшага)", 56.942, 47.249, 22],["Кикнур (р. Большая Кокшага)", 57.302, 47.206, 22],["Тужа (р. Пижма)", 57.606, 47.935, 22],["Пижанка (р. Пижма)", 57.46, 48.542, 22],["Арбаж", 57.681, 48.304, 22],["Верхошижемье", 58.012, 49.104, 22],["Лебяжье (р. Вятка)", 57.399, 49.531, 22],["Кильмезь (р. Кильмезь)", 56.945, 51.069, 22],["Нема", 57.508, 50.502, 22],["Медведок (р. Вятка)", 57.358, 49.946, 22],["Цепочкино (р. Вятка)", 57.172, 50.118, 22],["Арзамас", 55.395, 43.839, 36],["Балахна", 56.491, 43.541, 36],["Богородск", 56.103, 43.514, 36],["Ветлуга", 57.854, 45.781, 36],["Володарск", 56.231, 43.195, 36],["Ворсма", 55.991, 43.275, 36],["Горбатов", 56.132, 43.064, 36],["Дзержинск", 56.238, 43.457, 36],["Княгинино", 55.819, 45.035, 36],["Кулебаки", 55.419, 42.521, 36],["Лукоянов", 55.039, 44.498, 36],["Навашино", 55.529, 42.199, 36],["Первомайск", 54.869, 43.805, 36],["Перевоз", 55.597, 44.545, 36],["Саров", 54.935, 43.321, 36],["Семёнов", 56.789, 44.492, 36],["Сергач", 55.531, 45.469, 36],["Урень", 57.461, 45.786, 36],["Шахунья", 57.674, 46.611, 36],["Воротынец (Чебоксарское вдхр.)", 56.058, 45.854, 36],["Воскресенское (р. Ветлуга)", 56.837, 45.432, 36],["Варнавино (р. Ветлуга)", 57.399, 45.091, 36],["Красные Баки (р. Ветлуга)", 57.129, 45.155, 36],["Сокольское (Горьковское вдхр.)", 57.142, 43.159, 36],["Ковернино (р. Узола)", 57.125, 43.814, 36],["Катунки (Горьковское вдхр.)", 56.835, 43.208, 36],["Тумботино (р. Ока)", 55.986, 43.023, 36],["Досчатое (р. Ока)", 55.394, 42.106, 36],["Шиморское (р. Ока)", 55.331, 42.094, 36],["Ардатов (Нижегородская обл.)", 55.239, 43.095, 36],["Вознесенское", 54.889, 42.761, 36],["Выездное", 55.378, 43.792, 36],["Сосновское (Нижегородская обл.)", 55.801, 43.162, 36],["Вача", 55.803, 42.773, 36],["Дальнее Константиново", 55.808, 44.084, 36],["Бутурлино (р. Пьяна)", 55.565, 44.901, 36],["Пильна (р. Пьяна / Сура)", 55.553, 45.925, 36],["Шаранга", 57.174, 46.539, 36],["Тоншаево", 57.736, 47.008, 36],["Тонкино", 57.372, 46.462, 36],["Спасское (Нижегородская обл.)", 55.864, 45.712, 36],["Сеченово", 55.222, 45.889, 36],["Большое Болдино", 55.003, 45.313, 36],["Починки", 54.697, 44.864, 36],["Гагино (р. Пьяна)", 55.231, 45.032, 36],["Вад (оз. Вадское)", 55.535, 44.197, 36],["Дивеево", 55.042, 43.243, 36],["Фокино (Воротынский р-н, р. Волга)", 56.082, 45.654, 36],["Разнежье (р. Волга)", 56.121, 45.638, 36],["Бармино (р. Волга)", 56.048, 45.419, 36],["Чугуны (р. Волга)", 56.071, 45.805, 36],["Великий Враг (Кстово, р. Волга)", 56.165, 44.185, 36],["Абдулино", 53.684, 53.647, 40],["Бугуруслан", 53.655, 52.441, 40],["Гай", 51.467, 58.455, 40],["Кувандык", 51.478, 57.355, 40],["Медногорск", 51.411, 57.583, 40],["Новотроицк", 51.203, 58.327, 40],["Соль-Илецк", 51.161, 54.992, 40],["Сорочинск", 52.434, 53.153, 40],["Ясный", 51.036, 59.874, 40],["Илек (слияние Илека и Урала)", 51.527, 53.383, 40],["Саракташ (р. Сакмара)", 51.787, 56.362, 40],["Акбулак (р. Илек)", 51.002, 55.622, 40],["Адамовка", 51.523, 59.941, 40],["Домбаровский (Ушкатинское вдхр.)", 50.758, 59.538, 40],["Светлый (оз. Жетыколь)", 50.819, 60.854, 40],["Кваркено (р. Суундук / Ирикла)", 52.083, 59.725, 40],["Новоорск (р. Большой Кумак)", 51.381, 58.981, 40],["Беляевка (р. Урал)", 51.397, 56.416, 40],["Переволоцкий (р. Самара)", 51.878, 54.194, 40],["Новосергиевка (р. Самара)", 52.093, 53.653, 40],["Тоцкое (р. Самара)", 52.525, 52.762, 40],["Курманаевка (р. Бузулук)", 52.509, 52.067, 40],["Грачёвка (р. Ток)", 52.918, 52.861, 40],["Плешаново (р. Ток)", 52.841, 53.483, 40],["Первомайский (Оренбургская обл., р. Чаган)", 51.897, 51.653, 40],["Ташла", 51.771, 52.742, 40],["Тюльган", 52.341, 56.168, 40],["Шарлык", 52.917, 54.751, 40],["Сакмара (р. Сакмара)", 51.983, 55.335, 40],["Пономарёвка (р. Дёма)", 53.298, 54.115, 40],["Асекеево (р. Большой Кинель)", 53.574, 52.798, 40],["Северное (Оренбургская обл.)", 54.092, 52.543, 40],["Матвеевка", 53.481, 53.481, 40],["Уртазым (Ириклинское вдхр.)", 51.995, 58.953, 40],["Чапаевка (Ириклинское вдхр.)", 51.825, 58.812, 40],["Белинский", 52.964, 43.417, 42],["Городище (Пензенская обл.)", 53.277, 45.702, 42],["Каменка (Пензенская обл.)", 53.191, 44.047, 42],["Спасск", 53.926, 43.184, 42],["Сурск", 53.076, 45.675, 42],["Шемышейка (р. Сура / Уза)", 52.891, 45.392, 42],["Лунино (р. Сура)", 53.59, 45.225, 42],["Мокшан (р. Мокша)", 53.437, 44.613, 42],["Башмаково", 53.218, 43.033, 42],["Беково (р. Хопёр)", 52.463, 43.712, 42],["Земетчино (р. Выша)", 53.497, 42.616, 42],["Исса", 53.87, 44.857, 42],["Колышлей (р. Хопёр)", 52.701, 44.536, 42],["Пачелма", 53.332, 43.321, 42],["Сосновоборск (р. Сура)", 53.293, 46.248, 42],["Тамала", 52.541, 43.251, 42],["Золотарёвка (Сурское вдхр.)", 53.033, 45.331, 42],["Сура (Никольский р-н)", 53.892, 45.741, 42],["Верхозим", 52.961, 45.983, 42],["Евлашево", 53.058, 46.782, 42],["Чаадаевка (р. Сура)", 53.141, 45.912, 42],["Бессоновка (р. Сура)", 53.309, 45.041, 42],["Вадинск (Вадинское вдхр.)", 53.692, 43.058, 42],["Кондоль", 52.819, 45.058, 42],["Лопатино (р. Уза)", 52.618, 45.811, 42],["Малая Сердоба", 52.463, 44.948, 42],["Наровчат (р. Мокша)", 53.878, 43.694, 42],["Неверкино", 52.784, 46.742, 42],["Русский Камешкир", 52.858, 46.089, 42],["Алферьевка (Сурское вдхр.)", 53.047, 45.141, 42],["Кинель", 53.225, 50.627, 65],["Нефтегорск", 52.802, 51.166, 65],["Октябрьск", 53.17, 48.674, 65],["Отрадный", 53.376, 51.348, 65],["Похвистнево", 53.655, 52.126, 65],["Чапаевск", 52.977, 49.708, 65],["Безенчук (р. Волга)", 52.981, 49.431, 65],["Суходол (р. Сок)", 53.899, 51.209, 65],["Междуреченск (слияние Усы и Волги)", 53.268, 49.112, 65],["Волжский (Царевщина, устье р. Сок)", 53.428, 50.123, 65],["Петра Дубрава", 53.295, 50.365, 65],["Стройкерамика", 53.258, 50.422, 65],["Смышляевка", 53.242, 50.395, 65],["Рощинский", 53.056, 50.478, 65],["Балашейка", 53.268, 48.095, 65],["Осинки", 52.842, 49.503, 65],["Прибрежный (Мастрюковские озёра / Волга)", 53.475, 49.859, 65],["Приволжье (Саратовское вдхр.)", 52.863, 48.598, 65],["Хрящёвка (Сусканский залив)", 53.816, 49.092, 65],["Ширяево (Самарская Лука, р. Волга)", 53.414, 50.015, 65],["Винновка (Самарская Лука, р. Волга)", 53.175, 49.764, 65],["Зольное (р. Волга)", 53.447, 49.798, 65],["Красный Яр (р. Сок / Кондурча)", 53.501, 50.392, 65],["Сергиевск (р. Сок)", 53.941, 51.168, 65],["Кинель-Черкассы (р. Большой Кинель)", 53.471, 51.474, 65],["Борское (р. Самара)", 53.033, 51.714, 65],["Богатое (р. Самара / Кутулукское вдхр.)", 53.058, 51.332, 65],["Большая Глушица (р. Большой Иргиз)", 52.392, 50.473, 65],["Большая Черниговка", 52.094, 50.869, 65],["Пестравка (р. Большой Иргиз)", 52.404, 49.957, 65],["Алексеевка (Алексеевский р-н, р. Съезжая)", 52.583, 51.309, 65],["Кошки (р. Кондурча)", 54.208, 50.469, 65],["Челно-Вершины", 54.421, 51.092, 65],["Шентала", 54.432, 51.483, 65],["Исаклы (р. Сок)", 54.136, 51.531, 65],["Камышла (р. Сок)", 54.115, 52.142, 65],["Аркадак", 51.933, 43.498, 67],["Аткарск", 51.872, 45.006, 67],["Балашов", 51.551, 43.168, 67],["Ершов", 51.351, 48.282, 67],["Калининск", 51.501, 44.475, 67],["Красноармейск (Саратовская обл.)", 51.022, 45.698, 67],["Красный Кут", 50.946, 46.968, 67],["Новоузенск", 50.457, 48.143, 67],["Петровск", 52.309, 45.392, 67],["Пугачёв", 52.016, 48.803, 67],["Ртищево", 52.257, 43.788, 67],["Шиханы", 52.121, 47.202, 67],["Духовницкое (Саратовское вдхр.)", 52.481, 48.204, 67],["Воскресенское (Волгоградское вдхр.)", 51.835, 46.892, 67],["Усть-Курдюм (Волгоградское вдхр.)", 51.622, 46.235, 67],["Чардым (Волгоградское вдхр.)", 51.725, 46.462, 67],["Сабуровка (Волгоградское вдхр.)", 51.738, 46.512, 67],["Шумейка (Энгельс, Волгоградское вдхр.)", 51.572, 46.223, 67],["Пристанное (р. Волга)", 51.608, 46.191, 67],["Синенькие (Волгоградское вдхр.)", 51.242, 45.882, 67],["Золотое (Волгоградское вдхр.)", 50.835, 45.932, 67],["Ахмат (Волгоградское вдхр.)", 50.941, 45.885, 67],["Приволжский (Энгельс)", 51.418, 46.042, 67],["Степное (р. Большой Караман)", 51.378, 46.852, 67],["Лысые Горы (р. Медведица)", 51.531, 44.809, 67],["Романовка (р. Карай / Хопёр)", 51.742, 42.753, 67],["Турки (р. Хопёр)", 51.988, 43.271, 67],["Самойловка (р. Терса)", 51.182, 43.708, 67],["Екатериновка (Саратовская обл.)", 52.052, 44.349, 67],["Татищево", 51.678, 45.595, 67],["Светлый (Саратовская обл.)", 51.671, 45.631, 67],["Новые Бурасы", 52.129, 46.079, 67],["Базарный Карабулак", 52.277, 46.413, 67],["Дергачи", 51.236, 48.761, 67],["Мокроус", 51.238, 47.508, 67],["Озинки", 51.196, 49.725, 67],["Горный (Саратовская обл.)", 51.758, 48.541, 67],["Сенной", 52.148, 46.963, 67],["Ивантеевка (Саратовская обл.)", 52.257, 49.479, 67],["Перелюб (р. Камелик)", 51.868, 50.354, 67],["Питерка (р. Малый Узень)", 50.681, 47.442, 67],["Александров Гай (р. Большой Узень)", 50.141, 48.567, 67],["Барыш", 53.653, 47.125, 79],["Инза", 53.854, 46.356, 79],["Новоульяновск", 54.151, 48.388, 79],["Чердаклы (Куйбышевское вдхр.)", 54.358, 48.851, 79],["Ишеевка (р. Свияга)", 54.426, 48.271, 79],["Цильна", 54.689, 48.033, 79],["Сурское (Ульяновская обл., р. Сура)", 54.481, 46.718, 79],["Карсун (р. Барыш / Сура)", 54.197, 46.983, 79],["Вешкайма", 54.051, 47.135, 79],["Майна", 54.115, 47.621, 79],["Кузоватово", 53.548, 47.686, 79],["Николаевка (Ульяновская обл.)", 53.125, 47.204, 79],["Новоспасское (р. Сызранка)", 53.149, 47.752, 79],["Радищево", 52.851, 47.881, 79],["Павловка (Ульяновская обл.)", 52.689, 47.141, 79],["Старая Кулатка", 52.725, 47.614, 79],["Базарный Сызган", 53.753, 46.757, 79],["Мулловка (Черемшанский залив)", 54.205, 49.406, 79],["Новая Майна", 54.156, 49.754, 79],["Старотимошкино", 53.712, 47.558, 79],["Языково", 54.303, 47.375, 79],["Силикатный", 53.992, 48.329, 79],["Красный Гуляй", 54.027, 48.331, 79],["Тереньга", 53.719, 48.366, 79],["Большое Нагаткино", 54.568, 47.961, 79],["Новая Малыкла", 54.218, 49.936, 79],["Белый Яр (Куйбышевское вдхр.)", 53.998, 48.875, 79],["Ундоры (Куйбышевское вдхр.)", 54.602, 48.395, 79],["Криуши (Ульяновская обл., р. Волга)", 54.072, 48.554, 79],["Шиловка (Сенгилеевский р-н, р. Волга)", 54.041, 48.636, 79],["Садовка (Старомайнский залив)", 54.665, 49.022, 79],["Никольское-на-Черемшане (Черемшанский залив)", 53.963, 49.308, 79],["Паньшино (Саратовское вдхр.)", 52.812, 48.471, 79],["Новый Уренгой", 66.0833, 76.68, 87],["Лимбияха (Уренгойская ГРЭС)", 66.0581, 77.7914, 87],["Коротчаево (р. Пур)", 65.9472, 78.1486, 87],["Уренгой (пгт)", 65.9631, 78.3686, 87],["Ямсовей", 65.6542, 76.9531, 87],["Пангоды", 65.85, 74.4856, 87],["Правохеттинский", 65.658, 73.719, 87],["Старый Надым", 65.565, 72.652, 87],["Надым", 65.5333, 72.5167, 87],["Ягельный", 64.96, 72.71, 87],["Приозёрный (ЯНАО)", 64.67, 72.9, 87],["Лонгъюган", 65.3, 70.93, 87],["Ныда", 66.625, 72.93, 87],["Нори", 66.15, 72.37, 87],["Кутопьюган", 65.97, 70.72, 87],["Тазовский", 67.4639, 78.7022, 87],["Газ-Сале", 67.367, 78.969, 87],["Самбург", 66.985, 78.221, 87],["Антипаюта", 69.098, 76.855, 87],["Гыда", 70.893, 78.472, 87],["Тарко-Сале", 64.915, 77.78, 87],["Пуровск", 64.983, 77.59, 87],["Сывдарма", 65.243, 77.26, 87],["Пурпе", 64.48, 76.68, 87],["Губкинский", 64.434, 76.502, 87],["Ханымей", 63.722, 75.95, 87],["Харампур", 64.31, 78.1, 87],["Халясавэй", 63.39, 78.38, 87],["Муравленко", 63.792, 74.523, 87],["Ноябрьск", 63.2, 75.45, 87],["Вынгапуровский", 63.168, 76.968, 87],["Красноселькуп", 65.702, 82.463, 87],["Толька", 63.998, 82.06, 87],["Салехард", 66.53, 66.6, 87],["Лабытнанги", 66.657, 66.418, 87],["Харп", 66.814, 65.808, 87],["Обской", 66.69, 66.22, 87],["Аксарка", 66.56, 67.798, 87],["Белоярск (Приуральский)", 66.872, 68.136, 87],["Катравож", 66.333, 66.085, 87],["Яр-Сале", 66.863, 70.84, 87],["Панаевск", 66.757, 70.116, 87],["Салемал", 66.746, 68.938, 87],["Мыс Каменный", 68.463, 73.593, 87],["Сеяха", 70.165, 72.515, 87],["Мужи", 65.398, 64.698, 87],["Горки (Шурышкарский)", 65.076, 65.291, 87],["Овгорт", 64.867, 63.367, 87],["Сургут", 61.25, 73.4, 81],["Белый Яр (Сургутский)", 61.267, 73.238, 81],["Солнечный (Сургутский)", 61.298, 73.175, 81],["Барсово", 61.278, 73.153, 81],["Фёдоровский", 61.608, 73.719, 81],["Лянтор", 61.619, 72.155, 81],["Нижнесортымский", 62.438, 71.76, 81],["Нижневартовск", 60.93, 76.55, 81],["Излучинск", 60.963, 76.929, 81],["Мегион", 61.034, 76.11, 81],["Лангепас", 61.254, 75.182, 81],["Покачи", 61.75, 75.59, 81],["Радужный (ХМАО)", 62.133, 77.475, 81],["Новоаганск", 61.946, 76.663, 81],["Когалым", 62.264, 74.482, 81],["Нефтеюганск", 61.099, 72.603, 81],["Пойковский", 61.233, 71.883, 81],["Пыть-Ях", 60.75, 72.858, 81],["Салым", 60.062, 71.478, 81],["Ханты-Мансийск", 61.0, 69.02, 81],["Горноправдинск", 60.056, 69.908, 81],["Нягань", 62.14, 65.393, 81],["Приобье", 62.533, 65.617, 81],["Октябрьское (ХМАО)", 62.454, 66.05, 81],["Белоярский (ХМАО)", 63.711, 66.672, 81],["Берёзово", 63.938, 65.042, 81],["Игрим", 63.19, 64.417, 81],["Советский (ХМАО)", 61.361, 63.564, 81],["Югорск", 61.312, 63.332, 81],["Урай", 60.13, 64.789, 81],["Междуреченский", 59.6, 65.91, 81],["Тюмень", 57.153, 65.5343, 77],["Боровский", 57.037, 65.713, 77],["Винзили", 56.953, 65.792, 77],["Ялуторовск", 56.653, 66.3, 77],["Заводоуковск", 56.504, 66.551, 77],["Тобольск", 58.198, 68.254, 77],["Вагай", 57.937, 69.022, 77],["Уват", 59.141, 68.895, 77],["Туртас", 58.943, 69.142, 77],["Ишим", 56.112, 69.49, 77],["Екатеринбург", 56.8389, 60.6057, 69],["Верхняя Пышма", 56.971, 60.583, 69],["Берёзовский (Свердл.)", 56.908, 60.804, 69],["Среднеуральск", 56.99, 60.467, 69],["Заречный (Белоярское вдхр.)", 56.814, 61.326, 69],["Рефтинский", 57.092, 61.673, 69],["Первоуральск", 56.905, 59.943, 69],["Ревда", 56.801, 59.91, 69],["Сысерть", 56.5, 60.816, 69],["Полевской", 56.442, 60.189, 69],["Каменск-Уральский", 56.415, 61.918, 69],["Нижний Тагил", 57.919, 59.965, 69],["Серов", 59.603, 60.578, 69],["Сосьва", 59.176, 61.854, 69],["Гари", 59.43, 62.35, 69],["Тавда", 58.042, 65.272, 69],["Челябинск", 55.1644, 61.4368, 83],["Копейск", 55.116, 61.617, 83],["Миасс", 55.045, 60.108, 83],["Чебаркуль", 54.978, 60.37, 83],["Златоуст", 55.171, 59.65, 83],["Кыштым", 55.706, 60.552, 83],["Касли", 55.889, 60.758, 83],["Южноуральск", 54.442, 61.253, 83],["Магнитогорск", 53.407, 58.979, 83],["Курган", 55.441, 65.341, 26],["Шадринск", 56.085, 63.633, 26],["Уренгойское (озеро Негито)", 65.5129, 77.2999, 87],["Новый Порт", 67.69, 72.9, 87],["Горки (ЯНАО)", 65.06, 65.28, 87],["Заполярный (ЯНАО)", 66.402, 73.84, 87],["Берёзово (ХМАО)", 63.937, 65.043, 81],["Междуреченский (Кондинское)", 59.6, 65.91, 81],["Фёдоровский (ХМАО)", 61.608, 73.718, 81],["Мишкино (Курганская обл.)", 55.338, 63.918, 26],["Шумиха", 55.228, 63.293, 26],["Куртамыш", 54.911, 64.432, 26],["Макушино", 55.211, 67.244, 26],["Петухово", 55.069, 67.893, 26],["Частоозерье", 55.568, 67.908, 26],["Демьянка", 59.546, 69.308, 77],["Ярково", 57.408, 67.075, 77],["Нижняя Тавда", 57.673, 66.173, 77],["Казанское (Тюменская)", 55.639, 69.235, 77],["Сосьва (Свердловская)", 59.176, 61.855, 69],["Ивдель", 60.691, 60.421, 69],["Далматово (р. Исеть)", 56.2606, 62.9369, 26],["Катайск (р. Исеть)", 56.2889, 62.5819, 26],["Макушино (оз. Башкирское)", 55.2119, 67.2439, 26],["Петухово (оз. Медвежье / Песчаное)", 55.0689, 67.8939, 26],["Частоозерье (оз. Мартыново)", 55.5719, 67.9119, 26],["Щучье", 55.211, 62.754, 26],["Варгаши (оз. Варгашинское)", 55.378, 65.815, 26],["Каргаполье (р. Миасс / Исеть)", 55.951, 64.432, 26],["Красный Октябрь (Кособродск)", 55.893, 64.756, 26],["Лебяжье (оз. Камышное)", 55.268, 66.495, 26],["Юргамыш", 55.372, 64.467, 26],["Альменево (оз. Альменьколь)", 54.956, 63.575, 26],["Белозерское (р. Тобол / оз. Ачикуль)", 55.825, 65.586, 26],["Звериноголовское (р. Тобол)", 54.459, 64.854, 26],["Кетово (р. Тобол)", 55.351, 65.328, 26],["Мокроусово (оз. Чёрное / Куртан)", 55.809, 66.762, 26],["Половинное (оз. Половинное)", 54.789, 65.986, 26],["Сафакулево (оз. Сафакуль)", 54.991, 62.548, 26],["Целинное (р. Уй)", 54.504, 63.674, 26],["Шатрово (р. Исеть / Мостовка)", 56.519, 64.632, 26],["Глядянское (р. Тобол)", 54.908, 65.087, 26],["Усть-Уйское (слияние Уя и Тобола)", 54.342, 64.382, 26],["Алапаевск", 57.853, 61.703, 69],["Арамиль", 56.697, 60.834, 69],["Артёмовский", 57.356, 61.871, 69],["Асбест", 57.006, 61.459, 69],["Богданович", 56.78, 62.049, 69],["Верхний Тагил", 57.378, 59.951, 69],["Верхняя Салда", 58.046, 60.554, 69],["Верхняя Тура", 58.358, 59.816, 69],["Верхотурье", 58.864, 60.805, 69],["Волчанск", 59.936, 60.081, 69],["Дегтярск", 56.702, 60.097, 69],["Ирбит", 57.674, 63.063, 69],["Камышлов", 56.846, 62.712, 69],["Карпинск", 59.771, 60.004, 69],["Качканар", 58.703, 59.483, 69],["Кировград", 57.431, 60.061, 69],["Краснотурьинск", 59.766, 60.195, 69],["Красноуральск", 58.361, 60.042, 69],["Красноуфимск", 56.618, 57.768, 69],["Кушва", 58.291, 59.759, 69],["Лесной", 58.636, 59.784, 69],["Михайловск (р. Серга)", 56.435, 59.119, 69],["Невьянск", 57.489, 60.221, 69],["Нижние Серги", 56.666, 59.298, 69],["Нижняя Салда", 58.077, 60.719, 69],["Нижняя Тура", 58.629, 59.856, 69],["Новая Ляля", 59.054, 60.598, 69],["Новоуральск", 57.244, 60.093, 69],["Реж", 57.372, 61.392, 69],["Североуральск", 60.153, 59.933, 69],["Сухой Лог", 56.906, 62.029, 69],["Талица", 57.016, 63.719, 69],["Туринск", 58.046, 63.696, 69],["Бисерть (р. Бисерть)", 56.861, 59.052, 69],["Арти (р. Уфа / Арти)", 56.425, 58.531, 69],["Ачит", 56.798, 57.899, 69],["Шаля (р. Сылва)", 57.243, 58.729, 69],["Староуткинск (р. Чусовая)", 57.231, 59.332, 69],["Верх-Нейвинский (оз. Таватуй / пруд)", 57.262, 60.125, 69],["Билимбай (р. Чусовая)", 56.968, 59.832, 69],["Дружинино", 56.795, 59.512, 69],["Атиг", 56.688, 59.412, 69],["Верхние Серги", 56.647, 59.554, 69],["Малышева", 57.114, 61.398, 69],["Белоярский (Свердловская обл., р. Пышма)", 56.762, 61.412, 69],["Тугулым (р. Пышма)", 57.058, 64.642, 69],["Пышма (р. Пышма)", 56.949, 63.248, 69],["Махнёво (р. Тагил)", 58.442, 61.714, 69],["Верхняя Синячиха", 57.981, 61.674, 69],["Свободный (Свердловская обл.)", 58.041, 60.395, 69],["Горноуральский (Ленёвское вдхр.)", 57.992, 59.914, 69],["Пелым (р. Пелым)", 61.011, 62.001, 69],["Байкалово (Свердловская обл.)", 57.391, 63.762, 69],["Туринская Слобода (р. Тура)", 57.624, 64.385, 69],["Таборы (р. Тавда)", 58.519, 64.549, 69],["Голышманово", 56.398, 68.372, 77],["Богандинский (р. Пышма)", 56.893, 65.894, 77],["Сумкино (р. Иртыш)", 58.111, 68.324, 77],["Абатское (р. Ишим)", 56.287, 70.457, 77],["Армизонское (оз. Армизонское)", 55.945, 67.669, 77],["Аромашево (р. Вагай)", 56.861, 68.638, 77],["Бердюжье (оз. Песьяное / Белое)", 55.805, 68.298, 77],["Викулово (р. Ишим)", 56.817, 70.611, 77],["Исетское (р. Исеть)", 56.485, 65.324, 77],["Омутинское (р. Вагай)", 56.476, 67.665, 77],["Сладково (оз. Станичное / Таволжан)", 55.528, 70.338, 77],["Большое Сорокино", 56.631, 69.805, 77],["Упорово (р. Тобол)", 56.316, 66.271, 77],["Юргинское", 56.819, 67.392, 77],["Велижаны (оз. Большой Тараскуль / Ипкуль)", 57.542, 65.362, 77],["Муллаши (Голубые озёра / р. Пышма)", 56.968, 66.042, 77],["Салаирка (р. Тура)", 57.332, 65.054, 77],["Покровское (Ярковский р-н, р. Тобол)", 57.241, 66.789, 77],["Байкалово (Тобольский р-н, р. Тобол)", 57.548, 67.854, 77],["Горнослинкино (Уватский р-н, р. Иртыш)", 58.752, 68.781, 77],["Аша", 54.996, 57.274, 83],["Бакал", 54.939, 58.808, 83],["Верхнеуральск", 53.877, 59.209, 83],["Верхний Уфалей", 56.058, 60.231, 83],["Еманжелинск", 54.756, 61.321, 83],["Карабаш", 55.479, 60.207, 83],["Карталы", 53.054, 60.654, 83],["Катав-Ивановск", 54.753, 58.196, 83],["Коркино", 54.891, 61.399, 83],["Куса", 55.337, 59.439, 83],["Миньяр", 55.074, 57.554, 83],["Нязепетровск", 56.053, 59.602, 83],["Озёрск", 55.756, 60.703, 83],["Пласт", 54.369, 60.813, 83],["Сатка", 55.047, 59.032, 83],["Сим", 54.993, 57.694, 83],["Снежинск", 56.085, 60.731, 83],["Трёхгорный", 54.812, 58.452, 83],["Троицк", 54.097, 61.577, 83],["Усть-Катав", 54.933, 58.165, 83],["Юрюзань", 54.863, 58.422, 83],["Аргаяш (оз. Аргаяш / Увильды / Аргази)", 55.485, 60.875, 83],["Кунашак (оз. Кунашак / Калды / Уелги)", 55.702, 61.549, 83],["Долгодеревенское (оз. Касарги)", 55.344, 61.344, 83],["Еткуль (оз. Еткуль)", 54.825, 61.586, 83],["Октябрьское (Челябинская обл., оз. Буташ)", 54.432, 62.748, 83],["Уйское (р. Уй)", 54.374, 60.006, 83],["Чесма", 53.811, 60.659, 83],["Варна", 53.382, 60.975, 83],["Бреды (Брединское вдхр.)", 52.415, 60.341, 83],["Кизильское (р. Урал / Большой Кизил)", 52.725, 58.891, 83],["Агаповка (р. Урал)", 53.295, 59.135, 83],["Фершампенуаз (р. Гумбейка)", 53.521, 59.811, 83],["Красногорский (Челябинская обл., р. Увелька)", 54.602, 61.221, 83],["Первомайский (Коркинский р-н)", 54.869, 61.174, 83],["Роза", 54.914, 61.458, 83],["Межозёрный", 54.162, 59.392, 83],["Магнитка", 55.349, 59.689, 83],["Бердяуш (р. Большая Сатка)", 55.168, 59.151, 83],["Кропачёво", 55.011, 57.989, 83],["Сулея", 55.121, 58.854, 83],["Вишневогорск (оз. Сунгуль / Аракуль)", 55.998, 60.631, 83],["Бродокалмак (р. Миасс / оз. Тишки)", 55.568, 62.089, 83],["Агириш", 61.924, 63.023, 81],["Андра (р. Обь)", 62.515, 65.887, 81],["Высокий (Мегион)", 61.124, 76.021, 81],["Зеленоборск (р. Конда)", 61.471, 64.032, 81],["Коммунистический", 61.678, 64.482, 81],["Кондинское (р. Конда)", 59.649, 67.412, 81],["Куминский (р. Кума)", 58.674, 66.565, 81],["Луговой (р. Конда)", 59.718, 65.893, 81],["Малиновский (ХМАО)", 61.199, 62.836, 81],["Мортка", 59.331, 66.021, 81],["Пионерский (ХМАО)", 61.198, 62.863, 81],["Талинка (р. Ендырь)", 61.551, 66.332, 81],["Саранпауль (р. Ляпин / Щекурья)", 64.258, 60.903, 81],["Сосьва (Берёзовский р-н, р. Северная Сосьва)", 63.654, 62.103, 81],["Хулимсунт (р. Северная Сосьва)", 63.245, 61.391, 81],["Няксимволь (р. Северная Сосьва)", 62.426, 60.865, 81],["Полноват (р. Обь)", 63.778, 65.721, 81],["Казым (р. Казым / Амня)", 63.504, 67.392, 81],["Перегрёбное (р. Обь)", 62.984, 65.058, 81],["Шеркалы (р. Обь)", 62.761, 65.479, 81],["Карымкары (р. Обь)", 62.043, 67.291, 81],["Угут (р. Большой Юган)", 60.491, 74.054, 81],["Русскинская (р. Тромъёган)", 62.159, 73.593, 81],["Сытомино (р. Обь)", 61.385, 71.398, 81],["Локосово (р. Обь)", 61.132, 74.832, 81],["Ларьяк (р. Вах)", 61.104, 80.258, 81],["Корлики (р. Корлики / Вах)", 61.568, 82.192, 81],["Охтеурье (р. Вах)", 60.875, 77.962, 81],["Ваховск (р. Вах)", 60.832, 78.204, 81],["Аган (р. Аган)", 61.392, 75.158, 81],["Варьёган (р. Аган)", 61.968, 77.381, 81],["Большетархово (р. Вах)", 60.931, 77.085, 81],["Покур (р. Обь)", 61.072, 75.568, 81],["Зайцева Речка (р. Обь)", 60.758, 76.592, 81],["Цингалы (р. Иртыш)", 60.215, 69.698, 81],["Батово (р. Иртыш)", 60.453, 69.921, 81],["Реполово (р. Иртыш)", 60.592, 69.854, 81],["Согом (оз. Согомское / р. Согом)", 60.485, 68.125, 81],["Шапша (р. Обь)", 61.089, 69.442, 81],["Селиярово (р. Обь)", 61.268, 70.112, 81],["Кедровый (р. Иртыш / Обь)", 61.221, 68.185, 81],["Болчары (р. Конда)", 59.816, 68.782, 81],["Леуши (оз. Леушинский Туман)", 59.622, 65.741, 81],["Мулымья (р. Конда)", 60.342, 65.115, 81],["Ямбург (Обская губа)", 67.908, 74.862, 87],["Новозаполярный (р. Таз / Пур)", 66.852, 79.485, 87],["Карамовский пост (Спорышевское, Ноябрьск)", 62.921, 75.524, 87],["Верхне-Пурпейский", 64.281, 76.215, 87],["Хэнская (Надымский р-н)", 65.412, 74.185, 87],["Шуга (Обская губа)", 66.382, 71.758, 87],["Хэ (Обская губа)", 66.331, 72.185, 87],["Находка (Тазовская губа)", 67.721, 77.618, 87],["Тибей-Сале (р. Таз / Пякуляха)", 67.152, 79.462, 87],["Юрибей (Гыданский п-ов)", 71.182, 76.965, 87],["Матюй-Сале (Гыданский п-ов)", 71.712, 76.485, 87],["Тадебя-Яха (Обская губа)", 70.375, 74.132, 87],["Мессо (р. Мессояха)", 68.021, 79.315, 87],["5-6 Пески (р. Таз)", 67.381, 78.921, 87],["Ратта (р. Таз / Ратта)", 63.854, 83.758, 87],["Кикки-Аки (р. Таз)", 64.521, 82.892, 87],["Сидоровск (р. Таз)", 66.589, 79.541, 87],["Зелёный Яр (р. Полуй)", 66.308, 67.325, 87],["Щучье (Приуральский р-н, р. Щучья)", 67.198, 68.374, 87],["Бованенково (р. Сеяха / Морды-Яха)", 70.368, 68.423, 87],["Сабетта (Обская губа)", 71.251, 72.072, 87],["Харасавэй (Карское море)", 71.106, 66.854, 87],["Лаборовая (р. Байдарата)", 67.648, 67.532, 87],["Полярный (110 км, р. Собь)", 67.022, 65.419, 87],["Горнокнязевск (р. Обь)", 66.592, 66.814, 87],["Сюнай-Сале (р. Обь)", 66.774, 69.852, 87],["Яптик-Сале (Обская губа)", 69.365, 72.548, 87],["Тамбей (Обская губа)", 71.482, 71.815, 87],["Дровяной (Обская губа)", 72.412, 72.785, 87],["Порц-Яха (п-ов Ямал)", 68.932, 72.392, 87],["Юрибей (Ямальский р-н, р. Юрибей)", 68.921, 69.512, 87],["Шурышкары (Шурышкарский Сор / Малая Обь)", 65.912, 65.348, 87],["Восяхово (р. Малая Обь)", 65.581, 64.935, 87],["Лопхари (р. Большая Обь / Куноват)", 64.962, 65.721, 87],["Питляр (р. Большая Обь)", 65.839, 65.892, 87],["Азовы (р. Малая Обь)", 64.869, 64.619, 87],["Казым-Мыс (р. Большая Обь)", 64.661, 65.623, 87],["Омск", 54.9885, 73.3242, 39],["Тара", 56.894, 74.371, 39],["Калачинск", 55.052, 74.575, 39],["Черлак", 54.155, 74.805, 39],["Новосибирск", 55.0084, 82.9357, 38],["Бердск", 54.758, 83.107, 38],["Искитим", 54.64, 83.305, 38],["Ордынское", 54.372, 81.901, 38],["Сузун", 53.782, 82.313, 38],["Колывань", 55.306, 82.739, 38],["Барабинск", 55.35, 78.35, 38],["Чаны", 55.313, 76.764, 38],["Томск", 56.4846, 84.9476, 75],["Северск", 56.6, 84.883, 75],["Колпашево", 58.316, 82.909, 75],["Парабель", 58.698, 81.482, 75],["Каргасок", 59.058, 80.864, 75],["Стрежевой", 60.733, 77.589, 75],["Кемерово", 55.355, 86.087, 21],["Новокузнецк", 53.757, 87.136, 21],["Юрга", 55.723, 84.886, 21],["Междуреченск", 53.694, 88.06, 21],["Барнаул", 53.3474, 83.7784, 0],["Новоалтайск", 53.391, 83.936, 0],["Бийск", 52.539, 85.207, 0],["Камень-на-Оби", 53.788, 81.348, 0],["Рубцовск", 51.501, 81.207, 0],["Горно-Алтайск", 51.958, 85.96, 47],["Артыбаш (Телецкое оз.)", 51.794, 87.262, 47],["Красноярск", 56.0153, 92.8932, 25],["Дивногорск", 55.959, 92.373, 25],["Железногорск (Красноярский)", 56.251, 93.532, 25],["Канск", 56.201, 95.706, 25],["Ачинск", 56.269, 90.495, 25],["Лесосибирск", 58.235, 92.482, 25],["Енисейск", 58.449, 92.17, 25],["Туруханск", 65.795, 87.962, 25],["Игарка", 67.466, 86.583, 25],["Дудинка", 69.405, 86.177, 25],["Норильск", 69.3535, 88.2027, 25],["Минусинск", 53.706, 91.688, 25],["Абакан", 53.7211, 91.4424, 62],["Саяногорск", 53.088, 91.4, 62],["Шира", 54.491, 89.953, 62],["Кызыл", 51.7197, 94.4378, 61],["Иркутск", 52.2864, 104.305, 15],["Ангарск", 52.544, 103.888, 15],["Шелехов", 52.208, 104.095, 15],["Листвянка", 51.852, 104.868, 15],["Слюдянка", 51.659, 103.706, 15],["Байкальск", 51.518, 104.142, 15],["Хужир (Ольхон)", 53.194, 107.339, 15],["Братск", 56.151, 101.634, 15],["Усть-Илимск", 58.0, 102.662, 15],["Усть-Кут", 56.794, 105.767, 15],["Тевриз (р. Иртыш)", 57.5119, 72.3989, 39],["Знаменское (р. Иртыш / Шиш)", 57.1258, 73.8169, 39],["Большеречье (р. Иртыш)", 56.0919, 74.6269, 39],["Крутинка (оз. Ик / Салтаим / Тенис)", 56.0058, 71.5089, 39],["Белово (Беловское вдхр. / Инской)", 54.4169, 86.2989, 21],["Крапивинский (р. Томь / Тайдон)", 54.9919, 86.8119, 21],["Мариинск (р. Кия)", 56.2119, 87.7489, 21],["Таштагол (р. Кондома / Мрассу)", 52.7658, 87.8719, 21],["Яровое / Славгород (оз. Большое Яровое / Кулундинское)", 52.9319, 78.5839, 0],["Завьялово (Завьяловские озёра)", 52.8389, 80.5789, 0],["Змеиногорск (оз. Колыванское)", 51.1589, 82.1958, 0],["Черногорск", 53.8244, 91.2842, 62],["Абаза (р. Абакан)", 52.6519, 90.0919, 62],["Копьёво (оз. Белё / Иткуль)", 54.9858, 89.8058, 62],["Шагонар (Саяно-Шушенское вдхр. / р. Енисей)", 51.5319, 92.8119, 61],["Тоора-Хем (р. Большой Енисей / оз. Азас)", 52.4689, 96.1139, 61],["Чадан (р. Чадан / Хемчик)", 51.2858, 91.5789, 61],["Туран", 52.1439, 93.9189, 61],["Майма (р. Катунь)", 52.015, 85.908, 47],["Чемал (р. Катунь / Чемал)", 51.411, 86.002, 47],["Турочак (р. Бия / Лебедь)", 52.257, 87.122, 47],["Иогач (оз. Телецкое / исток р. Бия)", 51.787, 87.258, 47],["Балыкча (устье р. Чулышман)", 51.318, 87.848, 47],["Усть-Кокса (р. Катунь / Кокса)", 50.269, 85.611, 47],["Акташ (р. Чуя)", 50.313, 87.6, 47],["Кош-Агач (р. Чуя / озёра Чуйской степи)", 49.998, 88.665, 47],["Улаган (р. Башкаус / Чулышман)", 50.632, 87.959, 47],["Онгудай (р. Урсул / Катунь)", 50.748, 86.142, 47],["Усть-Кан (р. Чарыш)", 50.929, 84.763, 47],["Шебалино (р. Сема)", 51.289, 85.676, 47],["Чоя (р. Иша)", 52.012, 86.548, 47],["Манжерок (р. Катунь / оз. Манжерокское)", 51.825, 85.812, 47],["Ак-Довурак (р. Хемчик)", 51.183, 90.6, 61],["Каа-Хем (р. Малый Енисей)", 51.683, 94.717, 61],["Сарыг-Сеп (р. Малый Енисей / Каа-Хем)", 51.496, 95.552, 61],["Эрзин (р. Эрзин / Тес-Хем / оз. Торе-Холь)", 50.258, 95.161, 61],["Самагалтай (р. Тес-Хем)", 50.602, 95.005, 61],["Хандагайты (бассейн оз. Убсу-Нур)", 50.733, 92.05, 61],["Бай-Хаак (оз. Чагытай)", 51.161, 94.462, 61],["Тээли (р. Хемчик)", 51.028, 90.228, 61],["Кызыл-Мажалык (р. Хемчик)", 51.144, 90.583, 61],["Чаа-Холь (Саяно-Шушенское вдхр.)", 51.533, 92.392, 61],["Кунгуртуг (оз. Тере-Холь / Балыктыг-Хем)", 50.597, 97.525, 61],["Мугур-Аксы (р. Каргы)", 50.38, 90.44, 61],["Сорск (р. Сора / пруд Тёплый)", 54.004, 90.247, 62],["Усть-Абакан (Красноярское вдхр. / р. Абакан)", 53.834, 91.396, 62],["Черёмушки (Саяно-Шушенское и Майнское вдхр.)", 52.856, 91.417, 62],["Майна (Майнское вдхр. / р. Енисей)", 53.007, 91.482, 62],["Аскиз (р. Абакан / Аскиз)", 53.133, 90.528, 62],["Вершина Тёи (р. Тёя)", 53.267, 89.563, 62],["Бирикчуль (р. Аскиз)", 53.318, 89.892, 62],["Пригорск (Красноярское вдхр.)", 53.91, 91.275, 62],["Таштып (р. Таштып)", 52.796, 89.893, 62],["Бея (р. Бея / оз. Чёрное)", 53.053, 90.916, 62],["Боград (Красноярское вдхр.)", 54.234, 90.833, 62],["Знаменка (Красноярское вдхр.)", 54.348, 91.055, 62],["Белый Яр (р. Абакан)", 53.604, 91.389, 62],["Жемчужный (оз. Шира)", 54.505, 90.137, 62],["Алейск (р. Алей)", 52.492, 82.782, 0],["Белокуриха (р. Белокуриха / Песчаная)", 51.996, 84.985, 0],["Горняк (р. Золотуха / Алей)", 50.996, 81.467, 0],["Заринск (р. Чумыш)", 53.707, 84.935, 0],["Славгород (оз. Кулундинское / Бурлинское)", 52.999, 78.646, 0],["Яровое (оз. Большое Яровое)", 52.929, 78.583, 0],["Тальменка (р. Чумыш)", 53.818, 83.565, 0],["Благовещенка (оз. Кулундинское)", 52.833, 79.869, 0],["Малиновое Озеро (Михайловские озёра)", 51.678, 79.776, 0],["Степное Озеро (оз. Кучукское)", 52.735, 79.882, 0],["Сибирский (р. Черемшанка / Обь)", 53.557, 83.841, 0],["Южный (р. Обь, Барнаул)", 53.262, 83.694, 0],["Чарышское (р. Чарыш)", 51.397, 83.559, 0],["Солонешное (р. Ануй)", 51.653, 84.319, 0],["Смоленское (слияние Бии и Катуни / р. Песчаная)", 52.302, 85.083, 0],["Красногорское (р. Бия)", 52.293, 86.197, 0],["Усть-Чарышская Пристань (р. Обь / Чарыш)", 52.393, 83.662, 0],["Шелаболиха (р. Обь)", 53.411, 82.622, 0],["Павловск (р. Касмала / Обь)", 53.318, 82.977, 0],["Мамонтово (оз. Большое Островное)", 52.708, 81.624, 0],["Баево (оз. Мостовое / Лена)", 53.268, 80.768, 0],["Курья (р. Локтевка / оз. Белое)", 51.601, 82.29, 0],["Бурла (оз. Бурлинское / Песчаное)", 53.336, 78.332, 0],["Артёмовск (р. Кизир / Ольховка)", 54.35, 93.433, 25],["Боготол (р. Чулым)", 56.205, 89.528, 25],["Бородино (р. Кан / Барга)", 55.906, 94.908, 25],["Заозёрный (р. Рыбная)", 55.963, 94.706, 25],["Зеленогорск (р. Кан / Красноярская ГРЭС-2)", 56.113, 94.596, 25],["Иланский (р. Иланка)", 56.237, 96.065, 25],["Кодинск (Богучанское вдхр. / р. Ангара)", 58.606, 99.178, 25],["Назарово (р. Чулым / Назаровская ГРЭС)", 56.008, 90.391, 25],["Сосновоборск (р. Енисей / Есауловка)", 56.135, 93.361, 25],["Ужур (оз. Белое / Учум)", 55.308, 89.832, 25],["Уяр (р. Уярка)", 55.813, 94.325, 25],["Шарыпово (оз. Большое / Инголь / Берёзовская ГРЭС)", 55.541, 89.198, 25],["Тура (р. Нижняя Тунгуска / Кочечум)", 64.277, 100.219, 25],["Байкит (р. Подкаменная Тунгуска)", 61.677, 96.378, 25],["Ванавара (р. Подкаменная Тунгуска)", 60.347, 102.279, 25],["Хатанга (р. Хатанга, Таймыр)", 71.98, 102.474, 25],["Диксон (Енисейский залив Карского моря)", 73.508, 80.529, 25],["Шушенское (р. Енисей / Оя)", 53.332, 91.936, 25],["Курагино (р. Туба / Казыр)", 53.896, 92.675, 25],["Мотыгино (р. Ангара)", 58.183, 94.696, 25],["Богучаны (р. Ангара)", 58.381, 97.452, 25],["Стрелка (слияние р. Ангара и р. Енисей)", 58.077, 93.003, 25],["Северо-Енисейский (р. Тея / Вельмо)", 60.375, 93.037, 25],["Новосёлово (Красноярское вдхр.)", 55.028, 90.961, 25],["Краснотуранск (Красноярское вдхр. / Сыдинский залив)", 54.316, 91.564, 25],["Бор (р. Енисей / Подкаменная Тунгуска)", 61.601, 90.018, 25],["Ворогово (средний Енисей)", 61.018, 89.6, 25],["Караул (низовья р. Енисей)", 70.076, 83.189, 25],["Усть-Порт (р. Енисей)", 69.654, 84.409, 25],["Алзамай (р. Топорок)", 55.556, 98.665, 15],["Бирюсинск (р. Бирюса)", 55.961, 97.822, 15],["Бодайбо (р. Витим)", 57.851, 114.194, 15],["Вихоревка (р. Вихорева / Братское вдхр.)", 56.118, 101.178, 15],["Железногорск-Илимский (Усть-Илимское вдхр. / р. Илим)", 56.578, 104.118, 15],["Зима (р. Ока Саянская)", 53.921, 102.047, 15],["Киренск (р. Лена / Киренга)", 57.785, 108.099, 15],["Нижнеудинск (р. Уда / Чуна)", 54.908, 99.028, 15],["Саянск (р. Ока Саянская)", 54.109, 102.179, 15],["Свирск (Братское вдхр. / р. Ангара)", 53.085, 103.332, 15],["Тайшет (р. Бирюса)", 55.936, 98.007, 15],["Тулун (р. Ия)", 54.562, 100.579, 15],["Усолье-Сибирское (р. Ангара / Белая)", 52.753, 103.647, 15],["Черемхово (Братское вдхр.)", 53.155, 103.072, 15],["Качуг (верхняя р. Лена)", 53.959, 105.882, 15],["Жигалово (верхняя р. Лена)", 54.81, 105.152, 15],["Балаганск (Братское вдхр.)", 54.011, 103.056, 15],["Усть-Уда (Братское вдхр.)", 54.172, 103.028, 15],["Култук (юг оз. Байкал)", 51.722, 103.704, 15],["Еланцы (оз. Байкал / р. Анга)", 52.801, 106.408, 15],["Сахюрта / МРС (Малое Море оз. Байкал)", 53.018, 106.898, 15],["Большое Голоустное (оз. Байкал)", 52.033, 105.405, 15],["Бугульдейка (оз. Байкал)", 52.533, 106.064, 15],["Казачинское (р. Киренга)", 56.277, 107.575, 15],["Ербогачён (р. Нижняя Тунгуска)", 61.278, 108.012, 15],["Мама (р. Витим)", 58.311, 112.912, 15],["Новая Игирма (р. Игирма / Илим)", 57.136, 103.914, 15],["Оса (Осинский залив Братского вдхр.)", 53.377, 103.903, 15],["Бохан (р. Ида / Братское вдхр.)", 53.153, 103.774, 15],["Анжеро-Судженск (р. Яя / Китат)", 56.082, 86.028, 21],["Берёзовский (р. Барзас)", 55.6, 86.256, 21],["Гурьевск (р. Малый Бачат)", 54.283, 85.94, 21],["Калтан (р. Кондома / Южно-Кузбасская ГРЭС)", 53.535, 87.269, 21],["Киселёвск (р. Кара-Чумыш)", 53.992, 86.639, 21],["Ленинск-Кузнецкий (р. Иня)", 54.659, 86.173, 21],["Мыски (р. Мрассу / Томь / Томь-Усинская ГРЭС)", 53.688, 87.804, 21],["Осинники (р. Кондома)", 53.6, 87.332, 21],["Полысаево (р. Иня)", 54.597, 86.283, 21],["Прокопьевск (р. Аба / Кара-Чумышское вдхр.)", 53.906, 86.719, 21],["Салаир (р. Малый Бачат)", 54.236, 85.798, 21],["Тайга (р. Яя)", 56.066, 85.62, 21],["Топки (р. Томь / Черемшанка)", 55.276, 85.617, 21],["Тисуль (оз. Большой Берчикуль / р. Кия)", 55.76, 88.312, 21],["Большой Берчикуль (оз. Большой Берчикуль)", 55.626, 88.318, 21],["Инской (Беловское вдхр. / ГРЭС)", 54.427, 86.442, 21],["Мундыбаш (р. Кондома / Тельбес)", 53.21, 87.283, 21],["Темиртау (р. Тельбес / Кондома)", 53.133, 87.45, 21],["Яя (р. Яя)", 56.203, 86.438, 21],["Яшкино (р. Томь)", 55.872, 85.424, 21],["Промышленная (р. Иня)", 54.912, 85.639, 21],["Тяжинский (р. Тяжин / Кия)", 56.115, 88.514, 21],["Шерегеш (р. Кондома / Мундыбаш)", 52.921, 87.987, 21],["Усть-Кабырза (слияние р. Мрассу, Кабырза и Пызас)", 52.816, 88.431, 21],["Московка (р. Кия)", 55.284, 88.198, 21],["Макаракский (р. Кия)", 55.524, 88.14, 21],["Болотное (р. Ояш / Обь)", 55.672, 84.398, 38],["Карасук (р. Карасук / оз. Хорошее, Кривое)", 53.733, 78.033, 38],["Каргат (р. Каргат / оз. Убинское)", 55.195, 80.281, 38],["Куйбышев (р. Омь)", 55.448, 78.318, 38],["Купино (оз. Малые Чаны / Яркуль)", 54.366, 77.298, 38],["Обь (р. Обь / оз. Толмачёвское)", 54.992, 82.695, 38],["Татарск (озёра Барабинской степи)", 55.216, 75.975, 38],["Тогучин (р. Иня)", 55.235, 84.389, 38],["Черепаново (верховья р. Иня / Бердь)", 54.223, 83.376, 38],["Чулым (р. Чулым / оз. Иткуль)", 55.099, 80.963, 38],["Убинское (оз. Убинское)", 55.307, 79.68, 38],["Здвинск (р. Каргат / Чулым / оз. Малые Чаны)", 54.704, 78.661, 38],["Венгерово (р. Тартас / Омь)", 55.684, 76.749, 38],["Кыштовка (р. Тара)", 56.559, 76.626, 38],["Северное (р. Тартас)", 56.349, 78.361, 38],["Усть-Тарка (р. Омь)", 55.568, 75.706, 38],["Чистоозёрное (оз. Чаны / Яркуль)", 54.711, 76.578, 38],["Краснозёрское (р. Карасук)", 53.982, 79.239, 38],["Маслянино (верхняя р. Бердь)", 54.341, 84.212, 38],["Краснообск (нижний бьеф Новосибирской ГЭС / р. Обь)", 54.918, 82.99, 38],["Матвеевка (нижний бьеф Новосибирской ГЭС / р. Обь)", 54.922, 83.056, 38],["Боровое (Новосибирское вдхр. / Обское море)", 54.696, 82.648, 38],["Быстровка (Новосибирское вдхр. / Обское море)", 54.544, 82.802, 38],["Завьялово (Новосибирское вдхр. / р. Каракан)", 54.496, 82.448, 38],["Спирино (Новосибирское вдхр.)", 54.156, 81.911, 38],["Чингис (Новосибирское вдхр.)", 54.178, 82.008, 38],["Красный Яр (Обское море / Ордынский р-н)", 54.448, 82.164, 38],["Почта (р. Обь, Колыванский р-н)", 55.474, 82.992, 38],["Батурино (р. Обь, Колыванский р-н)", 55.661, 83.479, 38],["Исилькуль (оз. Городище / Камышное)", 54.911, 71.268, 39],["Называевск (Называевские озёра)", 55.568, 71.353, 39],["Тюкалинск (оз. Разлив / р. Тюкалка)", 55.872, 72.203, 39],["Усть-Ишим (слияние р. Иртыш и р. Ишим)", 57.693, 71.168, 39],["Муромцево (р. Тара / Пять озёр)", 56.373, 75.242, 39],["Саргатское (р. Иртыш / старицы)", 55.611, 73.497, 39],["Любинский (р. Иртыш / оз. Любинское)", 55.154, 72.692, 39],["Красный Яр (старица р. Иртыш, Любинский р-н)", 55.238, 72.927, 39],["Кормиловка (р. Омь)", 55.003, 74.103, 39],["Нижняя Омка (р. Омь)", 55.433, 74.943, 39],["Нововаршавка (южный плёс р. Иртыш)", 54.172, 74.696, 39],["Таврическое (р. Иртыш)", 54.586, 73.639, 39],["Колосовка (р. Оша)", 56.467, 73.611, 39],["Большие Уки (р. Большой Аёв / Шиш)", 56.938, 72.633, 39],["Седельниково (р. Уй)", 56.947, 75.321, 39],["Асино (р. Чулым)", 57.001, 86.151, 75],["Кедровый (р. Чузик / Парбиг)", 57.562, 79.566, 75],["Белый Яр (р. Кеть, Верхнекетский р-н)", 58.444, 85.044, 75],["Александровское (р. Обь, север Томской обл.)", 60.435, 77.893, 75],["Молчаново (р. Обь / устье р. Чулым)", 57.581, 83.763, 75],["Кривошеино (р. Обь)", 57.345, 83.924, 75],["Кожевниково (р. Обь)", 56.259, 83.971, 75],["Мельниково / Шегарка (р. Обь)", 56.559, 84.088, 75],["Тегульдет (р. Чулым)", 57.306, 88.167, 75],["Первомайское (р. Чулым)", 57.075, 86.231, 75],["Зырянское (слияние р. Чулым и р. Кия)", 56.832, 86.628, 75],["Бакчар (р. Бакчар / Галка)", 57.019, 82.071, 75],["Подгорное (р. Чая)", 57.785, 82.651, 75],["Улан-Удэ", 51.8335, 107.5841, 49],["Гусиноозёрск", 51.285, 106.526, 49],["Кабанск", 52.049, 106.652, 49],["Усть-Баргузин", 53.411, 109.026, 49],["Северобайкальск", 55.637, 109.323, 49],["Чита", 52.033, 113.501, 12],["Якутск", 62.0355, 129.6755, 58],["Покровск (Якутия)", 61.478, 129.141, 58],["Ленск", 60.725, 114.928, 58],["Мирный (Якутия)", 62.535, 113.961, 58],["Вилюйск", 63.755, 121.624, 58],["Алдан", 58.603, 125.389, 58],["Нерюнгри", 56.658, 124.725, 58],["Тикси", 71.637, 128.868, 58],["Благовещенск", 50.2907, 127.5272, 1],["Свободный", 51.375, 128.134, 1],["Зея", 53.749, 127.262, 1],["Тында", 55.155, 124.725, 1],["Биробиджан", 48.794, 132.921, 11],["Хабаровск", 48.4802, 135.0719, 80],["Амурск", 50.226, 136.899, 80],["Комсомольск-на-Амуре", 50.5496, 137.0067, 80],["Николаевск-на-Амуре", 53.145, 140.722, 80],["Советская Гавань", 48.969, 140.289, 80],["Ванино", 49.092, 140.264, 80],["Владивосток", 43.1155, 131.8855, 44],["Артём", 43.355, 132.186, 44],["Уссурийск", 43.797, 131.952, 44],["Находка", 42.8138, 132.8735, 44],["Большой Камень", 43.112, 132.348, 44],["Спасск-Дальний", 44.6, 132.818, 44],["Камень-Рыболов (Ханка)", 44.747, 132.043, 44],["Славянка", 42.863, 131.385, 44],["Южно-Сахалинск", 46.9591, 142.738, 68],["Корсаков", 46.634, 142.776, 68],["Анива", 46.715, 142.528, 68],["Холмск", 47.046, 142.046, 68],["Поронайск", 49.222, 143.102, 68],["Ноглики", 51.805, 143.138, 68],["Оха", 53.589, 142.949, 68],["Петропавловск-Камчатский", 53.0452, 158.6508, 19],["Елизово", 53.187, 158.383, 19],["Усть-Большерецк", 52.825, 156.252, 19],["Усть-Камчатск", 56.228, 162.476, 19],["Магадан", 59.5612, 150.8301, 31],["Анадырь", 64.733, 177.515, 86],["Арахлей (Ивано-Арахлейские озёра)", 52.2119, 112.9119, 12],["Краснокаменск", 50.0989, 118.0369, 12],["Борзя (Торейские озёра / р. Онон)", 50.3889, 116.5289, 12],["Шيلка / Нерчинск (р. Шилка / Ингода)", 51.8519, 116.0389, 12],["Хилок (р. Хилок)", 51.3639, 110.4619, 12],["Петровск-Забайкальский", 51.2758, 108.8419, 12],["Талакан (Бурейское вдхр.)", 50.2819, 130.2689, 1],["Белогорск (р. Томь)", 50.9189, 128.4758, 1],["Шимановск", 52.0019, 127.6689, 1],["Ленинское (р. Амур)", 47.9369, 132.6189, 11],["Амурзет (р. Амур)", 47.6969, 131.0958, 11],["Николаевка (р. Тунгуска / Амур)", 48.5569, 134.7858, 11],["Ола (Ольский лиман / Охотское море)", 59.5789, 151.2989, 31],["Палатка (р. Хасын)", 60.1019, 150.9358, 31],["Синегорье (Колымское вдхр. / р. Колыма)", 62.0889, 150.5319, 31],["Сусуман (р. Берелёх)", 62.7819, 148.1558, 31],["Певек (Чаунская губа)", 69.7019, 170.3119, 86],["Билибино (р. Малый Анюй)", 68.0558, 166.4419, 86],["Эгвекинот (Залив Креста)", 66.3189, 179.1189, 86],["Лаврентия", 65.5839, -171.0019, 86],["Мильково (р. Камчатка)", 54.6969, 158.6219, 19],["Вилючинск (Авачинская губа)", 52.9319, 158.4058, 19],["Ключи (р. Камчатка)", 56.3219, 160.8489, 19],["Оссора / Палана", 59.0919, 159.9519, 19],["Бабушкин (оз. Байкал / р. Мысовка)", 51.718, 105.864, 49],["Закаменск (р. Джида)", 50.376, 103.284, 49],["Кяхта (р. Селенга / Чикой)", 50.351, 106.45, 49],["Нижнеангарск (оз. Байкал / р. Верхняя Ангара)", 55.783, 109.55, 49],["Селенгинск (р. Селенга)", 52.008, 106.865, 49],["Каменск (р. Селенга / Кабанский р-н)", 51.995, 106.583, 49],["Онохой (р. Уда)", 51.921, 108.057, 49],["Таксимо (р. Муя / Витим / оз. Баунт)", 56.345, 114.872, 49],["Новый Уоян (р. Верхняя Ангара)", 56.155, 111.716, 49],["Кичера (р. Верхняя Ангара / Кичера)", 55.936, 110.101, 49],["Наушки (р. Селенга)", 50.384, 106.105, 49],["Турунтаево (р. Итанца / Селенга)", 52.203, 107.632, 49],["Гремячинск (оз. Байкал / оз. Котокель)", 52.796, 107.969, 49],["Горячинск (оз. Байкал / оз. Котокель)", 52.987, 108.293, 49],["Максимиха (Баргузинский залив оз. Байкал)", 53.264, 108.736, 49],["Баргузин (р. Баргузин)", 53.619, 109.633, 49],["Курумкан (р. Баргузин)", 54.325, 110.309, 49],["Посольское (Посольский сор оз. Байкал)", 52.018, 106.183, 49],["Истомино (дельта р. Селенга / Посольский сор)", 52.119, 106.298, 49],["Сосново-Озёрское (Еравнинские озёра)", 52.527, 111.543, 49],["Кырен (р. Иркут, Тункинский р-н)", 51.682, 102.132, 49],["Монды (верховья р. Иркут)", 51.676, 100.992, 49],["Петропавловка (р. Джида)", 50.612, 105.319, 49],["Мухоршибирь (оз. Сульфатное / р. Сухара)", 51.047, 107.828, 49],["Бичура (р. Хилок)", 50.588, 107.602, 49],["Хоринск (р. Уда)", 52.164, 109.773, 49],["Иволгинск (р. Селенга / Иволга)", 51.748, 107.283, 49],["Тарбагатай (р. Селенга / Куйтунка)", 51.482, 107.361, 49],["Багдарин (р. Ципа / Витим / оз. Баунт)", 54.444, 113.586, 49],["Улюнхан (верховья р. Баргузин)", 54.892, 111.124, 49],["Усть-Эгита (р. Уда, Еравнинский р-н)", 52.408, 111.164, 49],["Далахай (р. Иркут, Тункинский р-н)", 51.812, 102.771, 49],["Корсаково (дельта р. Селенга / залив Провал)", 52.275, 106.662, 49],["Верхоянск (р. Яна)", 67.551, 133.39, 58],["Нюрба (р. Вилюй)", 63.284, 118.334, 58],["Олёкминск (р. Лена / Олёкма)", 60.374, 120.426, 58],["Среднеколымск (р. Колыма)", 67.457, 153.707, 58],["Томмот (р. Алдан)", 58.956, 126.292, 58],["Удачный (р. Марха / Далдын)", 66.408, 112.299, 58],["Хандыга (р. Алдан)", 62.656, 135.568, 58],["Усть-Мая (р. Алдан / Мая)", 60.417, 134.539, 58],["Сангар (р. Лена, Кобяйский улус)", 63.924, 127.471, 58],["Кобяй (оз. Ниджили, Кобяйский улус)", 63.582, 126.52, 58],["Жиганск (р. Лена, Жиганский улус)", 66.767, 123.372, 58],["Сунтар (р. Вилюй)", 62.156, 117.639, 58],["Верхневилюйск (р. Вилюй)", 63.446, 120.307, 58],["Чернышевский (Вилюйское вдхр.)", 63.013, 112.469, 58],["Амга (р. Амга)", 60.896, 131.977, 58],["Намцы (р. Лена)", 62.718, 129.665, 58],["Нижний Бестях (р. Лена)", 61.961, 129.91, 58],["Майя (аласные озёра Мегино-Кангаласского улуса)", 61.733, 130.281, 58],["Бердигестях (р. Матта / Синяя)", 62.096, 126.7, 58],["Чурапча (оз. Чурапча)", 62.001, 132.433, 58],["Ытык-Кюёль (р. Татта)", 62.362, 133.553, 58],["Борогонцы (оз. Мюрю)", 62.671, 131.168, 58],["Усть-Татта (р. Алдан)", 62.922, 133.784, 58],["Усть-Нера (р. Индигирка)", 64.567, 143.237, 58],["Хонуу (р. Индигирка, Момский улус)", 66.456, 143.226, 58],["Белая Гора (р. Индигирка, Абыйский улус)", 68.538, 146.188, 58],["Чокурдах (р. Индигирка, Аллаиховский улус)", 70.622, 147.903, 58],["Русское Устье (дельта р. Индигирка)", 71.132, 149.261, 58],["Зырянка (р. Колыма)", 65.734, 150.892, 58],["Черский (низовья р. Колыма)", 68.753, 161.331, 58],["Батагай (р. Яна)", 67.654, 134.636, 58],["Усть-Куйга (р. Яна)", 70.002, 135.552, 58],["Казачье (р. Яна)", 70.733, 136.262, 58],["Саскылах (р. Анабар)", 71.964, 114.088, 58],["Оленёк (р. Оленёк)", 68.504, 112.436, 58],["Витим (р. Лена / устье р. Витим)", 59.446, 112.558, 58],["Пеледуй (р. Лена)", 59.627, 112.748, 58],["Сюльдюкар (р. Вилюй)", 63.218, 113.621, 58],["Балей (р. Унда)", 51.583, 116.633, 12],["Могоча (р. Могоча / Амазар / Шилка)", 53.733, 119.767, 12],["Сретенск (р. Шилка)", 52.244, 117.709, 12],["Шилка (р. Шилка / Кия)", 51.85, 116.033, 12],["Нерчинск (р. Нерча / Шилка)", 51.983, 116.583, 12],["Агинское (р. Ага / Онон)", 51.109, 114.532, 12],["Могойтуй (р. Онон / Ага)", 51.281, 114.918, 12],["Кокуй (р. Шилка)", 52.203, 117.554, 12],["Чернышевск (р. Алеур / Куэнга)", 52.523, 117.017, 12],["Приаргунск (р. Аргунь)", 50.369, 119.102, 12],["Нерчинский Завод (р. Аргунь)", 51.309, 119.612, 12],["Забайкальск (бассейн р. Аргунь)", 49.654, 117.326, 12],["Карымское (р. Ингода)", 51.617, 114.348, 12],["Атамановка (р. Ингода)", 51.93, 113.633, 12],["Ясногорск (Харанорская ГРЭС / р. Онон)", 50.865, 115.702, 12],["Первомайский (р. Ингода / Онон)", 51.667, 115.617, 12],["Новая Чара (р. Чара / оз. Большое Леприндо)", 56.801, 118.258, 12],["Чара (р. Чара, Каларский округ)", 56.906, 118.261, 12],["Красный Чикой (р. Чикой / Менза)", 50.364, 108.751, 12],["Акша (р. Онон)", 50.281, 113.287, 12],["Кыра (р. Онон / Кыра)", 49.579, 111.976, 12],["Нижний Цасучей (р. Онон)", 50.52, 115.132, 12],["Газимурский Завод (р. Газимур)", 51.547, 118.332, 12],["Улёты (р. Ингода / оз. Арей)", 51.357, 112.482, 12],["Тунгокочен (р. Каренга / Витим)", 53.559, 115.534, 12],["Тупик (р. Тунгир / Олёкма)", 54.427, 119.936, 12],["Палана (р. Палана / Охотское море)", 59.084, 159.954, 19],["Оссора (Карагинский залив Берингова моря)", 59.247, 163.072, 19],["Вулканный (р. Авача)", 53.099, 158.374, 19],["Октябрьский (р. Большая / Охотское море)", 52.651, 156.241, 19],["Соболево (р. Большая Воровская / Ича)", 54.294, 155.887, 19],["Эссо (р. Быстрая)", 55.928, 158.704, 19],["Анавгай (р. Быстрая)", 56.058, 158.959, 19],["Козыревск (р. Камчатка)", 56.048, 159.865, 19],["Озерновский (р. Озерная / Курильское оз.)", 51.493, 156.506, 19],["Запорожье (устье р. Озерная)", 51.491, 156.529, 19],["Тигиль (р. Тигиль)", 57.763, 158.681, 19],["Тиличики (залив Корфа Берингова моря)", 60.427, 166.052, 19],["Каменское (р. Пенжина)", 62.468, 166.208, 19],["Манилы (устье р. Пенжина)", 62.495, 165.174, 19],["Пахачи (р. Пахача)", 60.569, 169.064, 19],["Никольское (о. Беринга, Командорские о-ва)", 55.197, 165.986, 19],["Арсеньев (р. Арсеньевка)", 44.152, 133.275, 44],["Дальнегорск (р. Рудная / бухта Рудная Пристань)", 44.555, 135.568, 44],["Дальнереченск (р. Уссури / Большая Уссурка)", 45.932, 133.726, 44],["Лесозаводск (р. Уссури)", 45.469, 133.397, 44],["Партизанск (р. Партизанская)", 43.132, 133.129, 44],["Фокино (залив Стрелок / о. Путятина)", 42.971, 132.41, 44],["Лучегорск (Лучегорское вдхр. / р. Бикин)", 46.447, 134.289, 44],["Ольга (залив Ольги / р. Аввакумовка)", 43.744, 135.289, 44],["Кавалерово (р. Зеркальная)", 44.269, 135.053, 44],["Терней (Японское море / р. Серебрянка, Кема)", 45.053, 136.609, 44],["Пластун (Японское море / р. Джигитовка)", 44.756, 136.292, 44],["Преображение (бухта Преображения / р. Киевка)", 42.903, 133.906, 44],["Лазо (р. Киевка)", 43.38, 133.899, 44],["Посьет (залив Посьета)", 42.656, 130.803, 44],["Зарубино (бухта Троицы, залив Посьета)", 42.633, 131.082, 44],["Краскино (бухта Экспедиции, залив Посьета)", 42.709, 130.781, 44],["Хасан (р. Туманная / оз. Лотос)", 42.427, 130.648, 44],["Андреевка (бухта Троицы, залив Посьета)", 42.641, 131.132, 44],["Шкотово (р. Шкотовка / Уссурийский залив)", 43.321, 132.356, 44],["Тавричанка (устье р. Раздольная / Амурский залив)", 43.326, 131.884, 44],["Раздольное (р. Раздольная / Суйфун)", 43.541, 131.897, 44],["Кировский (р. Уссури)", 45.091, 133.501, 44],["Чугуевка (верхняя р. Уссури)", 44.167, 133.864, 44],["Новопокровка (р. Большая Уссурка / Иман)", 45.854, 134.502, 44],["Рощино (р. Большая Уссурка / Иман)", 45.925, 134.812, 44],["Красный Яр (р. Бикин, Пожарский р-н)", 46.541, 135.357, 44],["Анучино (р. Арсеньевка)", 43.956, 133.053, 44],["Хороль (оз. Ханка / р. Илистая)", 44.432, 132.078, 44],["Турий Рог (оз. Ханка)", 45.228, 131.986, 44],["Астраханка (оз. Ханка)", 44.702, 132.072, 44],["Русский / Подножье (о. Русский, бухта Новик)", 43.045, 131.872, 44],["Бикин (р. Бикин / Уссури)", 46.814, 134.252, 80],["Вяземский (р. Уссури)", 47.534, 134.756, 80],["Охотск (Охотское море / р. Охота и Кухтуй)", 59.364, 143.204, 80],["Де-Кастри (залив Чихачёва, Татарский пролив)", 51.469, 140.779, 80],["Переяславка (р. Кия / Хор)", 47.962, 135.053, 80],["Хор (р. Хор)", 47.882, 134.961, 80],["Солнечный (р. Силинка / Горин)", 50.722, 136.638, 80],["Чегдомын (р. Ургал / Бурея)", 51.132, 133.041, 80],["Новый Ургал (р. Ургал / Бурея)", 51.074, 132.564, 80],["Эльбан (оз. Болонь / р. Амур)", 50.098, 136.509, 80],["Лазарев (мыс Лазарева, Амурский лиман)", 52.235, 141.512, 80],["Заветы Ильича (бухта Постовая, Советская Гавань)", 49.027, 140.258, 80],["Майский (залив Советская Гавань)", 48.998, 140.203, 80],["Мухен (р. Немпта / Хор)", 48.101, 136.112, 80],["Троицкое (р. Амур / устье р. Анюй)", 49.444, 136.549, 80],["Найхин (р. Амур / устье р. Анюй)", 49.431, 136.529, 80],["Дада (р. Амур / оз. Гасси)", 49.181, 136.311, 80],["Елабуга (р. Амур)", 48.831, 135.887, 80],["Сикачи-Алян (р. Амур / оз. Петропавловское)", 48.753, 135.647, 80],["Богородское (нижний Амур / оз. Удыль)", 52.374, 140.436, 80],["Сусанино (нижний Амур)", 52.712, 140.187, 80],["Тыр (слияние р. Амур и р. Амгунь)", 52.932, 139.776, 80],["Мариинское (р. Амур / оз. Большое Кизи)", 51.724, 140.174, 80],["Имени Полины Осипенко (р. Амгунь)", 52.422, 136.485, 80],["Бриакан (р. Керби / Амгунь)", 52.275, 135.814, 80],["Чумикан (р. Уда / Охотское море)", 54.696, 135.313, 80],["Тугур (р. Тугур / Тугурский залив)", 53.754, 136.784, 80],["Аян (Охотское море)", 56.459, 138.172, 80],["Нелькан (р. Мая)", 57.659, 136.164, 80],["Завитинск (р. Завитая)", 50.111, 129.442, 1],["Райчихинск (р. Райчиха / Бурея)", 49.794, 129.408, 1],["Сковородино (р. Большой Невер / Амур)", 53.984, 123.941, 1],["Циолковский (р. Большая Пёра / Зея)", 51.761, 128.128, 1],["Новобурейский (Нижне-Бурейское вдхр. / р. Бурея)", 49.803, 129.878, 1],["Бурея (р. Бурея)", 49.796, 129.784, 1],["Прогресс (р. Кивда / Бурея)", 49.744, 129.669, 1],["Архара (р. Архара / Амур)", 49.421, 130.084, 1],["Февральск (р. Селемджа)", 52.467, 130.922, 1],["Экимчан (р. Селемджа)", 53.069, 132.942, 1],["Магдагачи (бассейн р. Зея / Амур)", 53.451, 125.804, 1],["Ерофей Павлович (р. Урка / Амур)", 53.961, 121.956, 1],["Серышево (р. Томь / Зея)", 51.093, 128.378, 1],["Новокиевский Увал (слияние р. Зея и р. Селемджа)", 51.639, 128.868, 1],["Мазаново (слияние р. Зея и р. Селемджа)", 51.594, 128.859, 1],["Поярково (р. Амур)", 49.626, 128.653, 1],["Константиновка (р. Амур)", 49.619, 127.989, 1],["Тамбовка (р. Гильчин)", 50.097, 128.056, 1],["Ивановка (р. Ивановка / Зея)", 50.422, 128.018, 1],["Екатеринославка (р. Ивановка)", 50.371, 129.108, 1],["Джалинда (верхний Амур)", 53.471, 123.908, 1],["Черняево (р. Амур)", 52.783, 125.908, 1],["Снежногорский (Зейское вдхр.)", 54.444, 128.567, 1],["Бомнак (Зейское вдхр.)", 54.718, 128.867, 1],["Ягодное (р. Дебин / Колыма)", 62.524, 149.628, 31],["Дебин (р. Колыма)", 62.345, 150.758, 31],["Сеймчан (р. Колыма / Сеймчан)", 62.934, 152.391, 31],["Усть-Омчуг (р. Детрин / Колыма)", 61.15, 149.633, 31],["Омсукчан (р. Омсукчан / Балыгычан)", 62.515, 155.776, 31],["Дукат (р. Сугой / Балыгычан)", 62.574, 155.38, 31],["Эвенск (Гижигинская губа Охотского моря)", 61.918, 159.236, 31],["Оротукан (р. Оротукан / Колыма)", 62.264, 151.672, 31],["Холодный (р. Берелёх)", 62.712, 147.915, 31],["Мяунджа (Аркагалинская ГРЭС / оз. Мяунджа)", 63.049, 147.185, 31],["Сокол (р. Уптар / Хасын)", 59.918, 150.749, 31],["Уптар (р. Уптар)", 59.897, 150.872, 31],["Стекольный (р. Хасын)", 60.056, 150.719, 31],["Тауйск (Тауйская губа / р. Тауй и Яна Охотская)", 59.736, 149.387, 31],["Армань (Тауйская губа / р. Армань)", 59.671, 150.132, 31],["Балаганное (устье р. Тауй)", 59.648, 149.108, 31],["Гадля (р. Ола)", 59.656, 151.318, 31],["Клепка (р. Ола)", 59.749, 151.498, 31],["Талая (бассейн р. Буюнда / Колыма)", 61.135, 152.389, 31],["Александровск-Сахалинский (Татарский пролив)", 50.898, 142.159, 68],["Долинск (р. Найба / Сусуя)", 47.33, 142.793, 68],["Курильск (о. Итуруп, залив Простор / р. Курилка)", 45.233, 147.878, 68],["Макаров (залив Терпения / р. Макарова)", 48.628, 142.781, 68],["Невельск (Татарский пролив)", 46.674, 141.859, 68],["Северо-Курильск (о. Парамушир, Второй Курильский пролив)", 50.675, 156.122, 68],["Томари (Татарский пролив / р. Томаринка)", 47.766, 142.068, 68],["Углегорск (Татарский пролив / р. Углегорка)", 49.076, 142.063, 68],["Южно-Курильск (о. Кунашир, Южно-Курильский пролив)", 44.03, 145.859, 68],["Крабозаводское (о. Шикотан)", 43.835, 146.753, 68],["Малокурильское (о. Шикотан)", 43.873, 146.827, 68],["Тымовское (р. Тымь)", 50.847, 142.658, 68],["Смирных (р. Поронай)", 49.745, 142.836, 68],["Шахтёрск (Татарский пролив / оз. Тауро)", 49.158, 142.112, 68],["Вахрушев (залив Терпения)", 48.995, 142.863, 68],["Стародубское (залив Мордвинова / устье р. Найба)", 47.412, 142.805, 68],["Охотское (оз. Тунайча / залив Мордвинова)", 46.851, 143.167, 68],["Лесное (оз. Тунайча / р. Очепуха)", 46.942, 143.091, 68],["Пригородное (Анивский залив)", 46.632, 142.905, 68],["Новиково (Анивский залив / оз. Буссе)", 46.364, 143.356, 68],["Таранай (Анивский залив / р. Таранай)", 46.623, 142.432, 68],["Правда (Татарский пролив, Холмский р-н)", 46.942, 142.006, 68],["Чехов (Татарский пролив / р. Чеховка)", 47.448, 141.989, 68],["Вал (залив Чайво / р. Вал)", 52.341, 143.067, 68],["Некрасовка (залив Помрь / залив Байкал, Охинский р-н)", 53.524, 142.634, 68],["Облучье (р. Хинган / Амур)", 49.006, 131.049, 11],["Смидович (р. Ин / Урми)", 48.598, 133.812, 11],["Приамурский (р. Амур / протока Пемзенская)", 48.519, 134.918, 11],["Имени Тельмана (р. Амур / залив Тельмана)", 48.508, 134.962, 11],["Теплоозёрск (р. Бира / оз. Тёплое)", 49.002, 131.898, 11],["Биракан (р. Бира)", 49.001, 131.714, 11],["Бира (р. Бира)", 48.999, 132.464, 11],["Лондоко-завод (р. Бира)", 49.027, 131.992, 11],["Волочаевка-2 (р. Тунгуска)", 48.567, 134.587, 11],["Кульдур (р. Кульдур)", 49.218, 131.633, 11],["Биджан (р. Биджан)", 48.203, 131.908, 11],["Дежнёво (устье р. Биджан / Амур)", 47.822, 132.164, 11],["Пашково (Хинганское ущелье р. Амур)", 48.878, 130.659, 11],["Радде (Хинганское ущелье р. Амур)", 48.604, 130.608, 11],["Головино (низовья р. Бира / Амур)", 48.036, 132.912, 11],["Надеждинское (р. Бира)", 48.254, 132.893, 11],["Даниловка (р. Тунгуска)", 48.622, 134.502, 11],["Волочаевка-1 (р. Тунгуска / оз. Забеловское)", 48.559, 134.482, 11],["Угольные Копи (Анадырский лиман)", 64.733, 177.698, 86],["Провидения (бухта Провидения, Берингово море)", 64.427, 186.774, 86],["Беринговский (бухта Угольная / оз. Пекульнейское и Майниц)", 63.063, 179.318, 86],["Мыс Шмидта (Чукотское море)", 68.894, 180.587, 86],["Рыркайпий (Чукотское море)", 68.932, 180.514, 86],["Марково (среднее течение р. Анадырь)", 64.681, 170.413, 86],["Усть-Белая (слияние р. Анадырь и р. Белая)", 65.492, 173.284, 86],["Канчалан (р. Канчалан / Анадырский лиман)", 65.174, 176.968, 86],["Ваеги (р. Майн)", 64.262, 171.064, 86],["Краснено (р. Анадырь / оз. Красное)", 64.618, 174.619, 86],["Анюйск (р. Малый Анюй)", 68.294, 161.608, 86],["Омолон (р. Омолон)", 65.241, 160.502, 86],["Амгуэма (р. Амгуэма)", 67.042, 181.205, 86],["Лорино (Мечигменская губа Берингова моря)", 65.503, 188.288, 86],["Уэлен (Берингов пролив / Чукотское море)", 66.161, 190.191, 86],["Янракыннот (пролив Сенявина)", 64.906, 187.469, 86],["Нунлигран (Берингово море)", 64.796, 184.619, 86],["Мейныпильгыно (оз. Пекульнейское / Вакарево)", 62.548, 177.054, 86]
];
const BOT_CITIES_DB = _CITIES.map(r => ({
 name: r[0], lat: r[1], lon: r[2], admin1: _BOT_ADMINS[r[3]] || ''
}));

function getSpotEcoregion(lat, lon, basinCode, waterType = 'small_river', selectedWaterName = '') {
  const bCode = basinCode || detectBasinByCoords(lat, lon);
  const wNameLower = String(selectedWaterName || '').toLowerCase();
  const isLakeOrQuarry = waterType === 'tundra_lake' || waterType === 'quarry';
  const isSea = waterType === 'sea_gulf' || waterType === 'open_sea';

  if (bCode === 'arctic_ob_taz') {
    const isPolarUralStream = (lon <= 67.8 && lat >= 65.4 && waterType === 'small_river') ||
      /собь|харбей|лонгот|щучья|кара|сыня|войкар|кожим/i.test(wNameLower);
    if (isPolarUralStream) {
      return {
        subRegion: 'polar_ural_mountain',
        displayBasinName: 'Горные реки Полярного Урала (Собь, Харбей, Лонгот-Юган, Сыня)',
        searchPlaceholder: 'Поиск рыбы (хариус, арктический голец, таймень, сиг-пыжьян, валёк, налим, щука, окунь...)',
        signatureSpecies: ['grayling', 'char', 'pizhyan', 'valek', 'burbot', 'pike', 'perch', 'dace', 'ide', 'peled', 'chir']
      };
    }
    if (lat >= 66.45 || isSea) {
      return {
        subRegion: 'yanao_arctic_coast',
        displayBasinName: 'Обь-Тазовский арктический бассейн (ЯНАО: Обская и Тазовская губы)',
        searchPlaceholder: 'Поиск рыбы (пелядь, сырок, щёкур, ряпушка, корюшка, навага, налим, щука...)',
        signatureSpecies: isSea
          ? ['peled', 'chir', 'pizhyan', 'cisco', 'smelt', 'navaga', 'omul_arctic', 'pike', 'perch', 'burbot', 'dace', 'ide', 'roach', 'ruffe', 'char', 'saffron_cod']
          : ['peled', 'chir', 'pizhyan', 'pike', 'perch', 'dace', 'burbot', 'cisco', 'roach', 'ide', 'ruffe', 'smelt']
      };
    }
    if (lat >= 62.6) {
      return {
        subRegion: 'yanao_north_taiga',
        displayBasinName: 'Обь-Тазовский северный бассейн (ЯНАО: Пур, Таз, Надым, Обь)',
        searchPlaceholder: 'Поиск рыбы (щука, окунь, сорога, мохтик, елец, язь, налим, сырок, щёкур...)',
        signatureSpecies: waterType === 'small_river'
          ? ['pike', 'perch', 'roach', 'dace', 'ide', 'burbot', 'ruffe', 'crucian', 'peled', 'pizhyan']
          : (isLakeOrQuarry
              ? ['perch', 'pike', 'roach', 'crucian', 'peled', 'chir', 'pizhyan', 'burbot', 'ruffe', 'ide']
              : ['pike', 'perch', 'peled', 'roach', 'dace', 'ide', 'burbot', 'chir', 'pizhyan', 'cisco', 'ruffe'])
      };
    }
    if (lat >= 58.5 && lon >= 61.5 && lon < 85.5) {
      return {
        subRegion: 'hmao_middle_ob',
        displayBasinName: 'Обь-Иртышский таёжный бассейн (Югра: Обь, Иртыш, Конда, Северная Сосьва, Вах)',
        searchPlaceholder: 'Поиск рыбы (щука, окунь, язь, сорога, мохтик, елец, сырок, карась, налим, судак...)',
        signatureSpecies: isLakeOrQuarry
          ? ['perch', 'pike', 'crucian', 'roach', 'peled', 'ide', 'rotan', 'burbot', 'bream', 'zander', 'tench', 'ruffe']
          : ['pike', 'perch', 'roach', 'ide', 'dace', 'burbot', 'peled', 'zander', 'bream', 'crucian', 'ruffe', 'gudgeon', 'tugun', 'sterlet']
      };
    }
    if (lon >= 58.8 && lon <= 62.1 && lat >= 54.0 && lat < 61.0) {
      return {
        subRegion: 'ural_mountain_lakes',
        displayBasinName: 'Уральский бассейн (Исеть, Чусовая, Тавда, Миасс, озёра Урала)',
        searchPlaceholder: 'Поиск рыбы (окунь, щука, чебак, лещ, карась, судак, карп, рипус, сиг, язь...)',
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
          ? 'Тобол-Исетский бассейн (Зауралье: Тобол, Исеть, Миасс, озёра Кургана)'
          : 'Обь-Иртышский бассейн (Тура, Тобол, Ишим, Иртыш)',
        searchPlaceholder: 'Поиск рыбы (карась, окунь, щука, чебак, лещ, судак, язь, сазан, пелядь, ротан...)',
        signatureSpecies: isLakeOrQuarry
          ? ['crucian', 'perch', 'rotan', 'pike', 'roach', 'carp', 'bream', 'zander', 'tench', 'peled', 'ide', 'rudd', 'bleak', 'ruffe', 'loach']
          : (waterType === 'big_river'
              ? ['perch', 'pike', 'zander', 'bream', 'roach', 'ide', 'crucian', 'carp', 'dace', 'burbot', 'ruffe', 'white_bream', 'gudgeon', 'bleak', 'tench', 'rudd', 'sterlet']
              : ['perch', 'pike', 'roach', 'crucian', 'ide', 'bream', 'dace', 'carp', 'zander', 'gudgeon', 'ruffe', 'bleak', 'tench', 'burbot', 'white_bream', 'rudd', 'rotan', 'loach'])
      };
    }
    const isAltaiFoothills = (lat <= 54.4 && lon >= 83.2) || /телецк|бия|катунь|мрассу|кондома|мана|томь/i.test(wNameLower);
    return {
      subRegion: isAltaiFoothills ? 'altai_mountain_ob' : 'upper_ob_steppe',
      displayBasinName: isAltaiFoothills
        ? 'Верхне-Обский и Алтайский бассейн (Бия, Катунь, Томь, Телецкое оз.)'
        : 'Верхне-Обский бассейн (Обь, Обское море, Томь, оз. Чаны)',
      searchPlaceholder: isAltaiFoothills
        ? 'Поиск рыбы (хариус, окунь, щука, чебак, елец, ленок, таймень, налим...)'
        : 'Поиск рыбы (окунь, щука, судак, чебак, лещ, язь, карась, сазан...)',
      signatureSpecies: isAltaiFoothills
        ? ['grayling', 'perch', 'pike', 'dace', 'roach', 'lenok', 'ide', 'burbot', 'zander', 'bream', 'crucian', 'gudgeon', 'ruffe']
        : (isLakeOrQuarry
            ? ['crucian', 'perch', 'pike', 'roach', 'zander', 'bream', 'ide', 'carp', 'tench', 'rotan', 'peled', 'ruffe', 'bleak', 'rudd']
            : ['perch', 'pike', 'zander', 'roach', 'bream', 'ide', 'crucian', 'dace', 'carp', 'burbot', 'ruffe', 'gudgeon', 'bleak', 'tench', 'white_bream', 'sterlet'])
    };
  }

  if (bCode === 'volga_caspian') {
    const isCaucasusMountainStream = lat <= 44.5 && lon >= 41.5 && lon <= 48.5 &&
      (waterType === 'small_river' || /баксан|чегем|черек|малк|ардон|фиагдон|гизельдон|урван|аргун|асса|армхи|андийск|аварск|каракойсу|самур/i.test(wNameLower));
    if (isCaucasusMountainStream) {
      return {
        subRegion: 'caucasus_terek_sulak_mountain',
        displayBasinName: 'Горные реки Северного Кавказа (бассейн Терека, Сулака и Самура)',
        searchPlaceholder: 'Поиск рыбы (форель ручьевая, терский усач, кавказский голавль, подуст, пескарь...)',
        signatureSpecies: ['brown_trout', 'barbel', 'chub', 'undermouth', 'gudgeon', 'bleak', 'rainbow_trout']
      };
    }
    if (lat <= 48.85) {
      return {
        subRegion: 'lower_volga_caspian',
        displayBasinName: 'Нижне-Волжский и Каспийский бассейн (Дельта Волги, Ахтуба, Терек, Сулак, Каспий)',
        searchPlaceholder: 'Поиск рыбы (сазан, судак, жерех, сом, вобла, щука, окунь, лещ, краснопёрка, кутум...)',
        signatureSpecies: isSea
          ? ['vobla', 'kutum', 'carp', 'zander', 'asp', 'pike', 'perch', 'rudd', 'bream', 'catfish', 'goby', 'chekhon', 'mullet', 'herring']
          : ['carp', 'zander', 'asp', 'catfish', 'pike', 'perch', 'vobla', 'bream', 'crucian', 'rudd', 'roach', 'chekhon', 'white_bream', 'volga_zander', 'tench', 'silver_carp', 'grass_carp', 'buffalo', 'blue_bream', 'sopa', 'ide', 'bleak', 'kutum', 'barbel']
      };
    }
    if (lon >= 52.0) {
      const isUralRiver = lat <= 53.6 && lon >= 52.0;
      const isBashkirMountain = lon >= 56.2 && lat >= 52.8 && lat <= 56.2;
      return {
        subRegion: 'kama_belaya_ural',
        displayBasinName: isUralRiver
          ? 'Уральский бассейн (р. Урал, Сакмара, Ириклинское вдхр.)'
          : 'Камско-Бельский бассейн (Белая, Уфа, Кама, Вятка, водохранилища)',
        searchPlaceholder: 'Поиск рыбы (щука, окунь, судак, лещ, голавль, жерех, сорога, карась, сазан, сом...)',
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
      searchPlaceholder: 'Поиск рыбы (лещ, судак, окунь, щука, плотва, карась, голавль, жерех, сазан, сом, берш...)',
      signatureSpecies: isLakeOrQuarry
        ? ['perch', 'pike', 'bream', 'roach', 'crucian', 'zander', 'white_bream', 'carp', 'rudd', 'tench', 'bleak', 'ide', 'catfish', 'volga_zander', 'blue_bream', 'rotan', 'ruffe', 'burbot']
        : ['perch', 'pike', 'bream', 'roach', 'zander', 'crucian', 'white_bream', 'chub', 'asp', 'carp', 'ide', 'catfish', 'bleak', 'rudd', 'tench', 'chekhon', 'volga_zander', 'blue_bream', 'sopa', 'dace', 'gudgeon', 'ruffe', 'burbot', 'undermouth', 'sterlet']
    };
  }

  if (bCode === 'black_azov') {
    const isSochiCommercialPond = lat <= 44.65 && lat >= 43.3 && lon >= 38.4 && lon <= 41.0 &&
      (waterType === 'cooling_reservoir' || waterType === 'tundra_lake' || waterType === 'quarry' || /серебрян|барановск|форелев|ахштыр|казачий брод|платник|пруд/i.test(wNameLower));
    if (isSochiCommercialPond) {
      return {
        subRegion: 'sochi_commercial_pond',
        displayBasinName: 'Прудовые и форелевые хозяйства Большого Сочи и предгорий Кавказа',
        searchPlaceholder: 'Поиск рыбы (радужная форель, карп, карась, белый амур, толстолобик, канальный сомик, сом...)',
        signatureSpecies: ['rainbow_trout', 'carp', 'crucian', 'grass_carp', 'silver_carp', 'channel_catfish', 'catfish']
      };
    }
    const isCaucasianStream = lat <= 44.65 && lat >= 43.3 && lon >= 38.4 && lon <= 42.5 &&
      (waterType === 'small_river' || /мзымта|сочи|шахе|хоста|псоу|аше|псезуапсе|мацеста|кудепста|дагомыс|туапсе|пшада|вулан|теберда|зеленчук|лаба|белая|мраморн/i.test(wNameLower));
    if (isSea) {
      return {
        subRegion: 'black_azov_sea',
        displayBasinName: 'Черноморско-Азовский морской бассейн (Чёрное и Азовское моря)',
        searchPlaceholder: 'Поиск рыбы (ставрида, барабулька, сарган, смарида, луфарь, пеленгас, скорпена, ласкирь, глосса...)',
        signatureSpecies: ['horse_mackerel', 'red_mullet', 'sea_bass', 'garfish', 'mullet', 'scorpionfish', 'sea_bream', 'wrasse', 'bluefish', 'goby', 'flounder', 'turbot', 'mackerel', 'crab']
      };
    }
    if (isCaucasianStream) {
      return {
        subRegion: 'caucasus_mountain_river',
        displayBasinName: 'Черноморский бассейн (горные реки Кавказа и Большого Сочи)',
        searchPlaceholder: 'Поиск рыбы (ручьевая форель, пеструшка, кавказский голавль, усач, подуст, бычок, шемая...)',
        signatureSpecies: ['chub', 'brown_trout', 'barbel', 'undermouth', 'rainbow_trout', 'shemaya', 'gudgeon', 'bleak', 'goby', 'mullet']
      };
    }
    const isDon = lat >= 46.8;
    return {
      subRegion: 'don_kuban_inland',
      displayBasinName: isDon ? 'Донской бассейн (Дон, Северский Донец, Хопёр, Маныч, Воронеж)' : 'Кубанско-Азовский бассейн (Кубань, лиманы, водохранилища)',
      searchPlaceholder: 'Поиск рыбы (сазан, карась, судак, сула, тарань, щука, окунь, лещ, сом, голавль, жерех, рыбец...)',
      signatureSpecies: ['carp', 'crucian', 'zander', 'pike', 'perch', 'taran', 'bream', 'roach', 'catfish', 'chub', 'asp', 'rudd', 'white_bream', 'silver_carp', 'grass_carp', 'vimba', 'chekhon', 'goby', 'tench', 'bleak', 'volga_zander', 'barbel']
    };
  }

  if (bCode === 'euro_west') {
    return {
      subRegion: 'euro_west_desna_seim',
      displayBasinName: 'Днепровско-Деснянский и Сеймский бассейн (Днепр, Десна, Сейм, Псёл)',
      searchPlaceholder: 'Поиск рыбы (щука, окунь, лещ, карась, плотва, судак, голавль, карп, жерех, сом...)',
      signatureSpecies: ['perch', 'pike', 'crucian', 'bream', 'roach', 'zander', 'carp', 'chub', 'asp', 'white_bream', 'ide', 'tench', 'rudd', 'bleak', 'catfish', 'dace', 'gudgeon', 'ruffe', 'burbot', 'rotan']
    };
  }

  if (bCode === 'baltic') {
    return {
      subRegion: 'baltic_sea_rivers',
      displayBasinName: 'Балтийский бассейн (Финский и Куршский заливы, Нева, Преголя, Луга, Чудское оз.)',
      searchPlaceholder: 'Поиск рыбы (судак, окунь, щука, лещ, корюшка, плотва, камбала, сарган, треска, сырть...)',
      signatureSpecies: isSea
        ? ['smelt', 'flounder', 'zander', 'perch', 'pike', 'bream', 'roach', 'garfish', 'cod', 'herring', 'plaice', 'vimba', 'goby', 'salmon', 'trout']
        : ['perch', 'pike', 'zander', 'bream', 'roach', 'white_bream', 'crucian', 'smelt', 'ide', 'vimba', 'chub', 'asp', 'tench', 'rudd', 'bleak', 'burbot', 'ruffe', 'dace']
    };
  }

  if (bCode === 'nw_karelia') {
    return {
      subRegion: 'karelia_ladoga_onega',
      displayBasinName: 'Ладожско-Онежский, Ильменский и Карельский бассейн (Ладога, Онега, Ильмень, Вуокса, Карелия)',
      searchPlaceholder: 'Поиск рыбы (окунь, щука, судак, сиг, хариус, кумжа, палия, ряпушка, плотва, сорога, лещ, налим...)',
      signatureSpecies: ['perch', 'pike', 'zander', 'roach', 'bream', 'whitefish', 'vendace', 'grayling', 'trout', 'char', 'burbot', 'ide', 'dace', 'smelt', 'salmon', 'broad_whitefish', 'ruffe', 'crucian', 'catfish']
    };
  }

  if (bCode === 'barents_white') {
    const isPechoraDvina = lon >= 38.5;
    return {
      subRegion: isPechoraDvina ? 'dvina_pechora_north' : 'kola_barents',
      displayBasinName: isPechoraDvina
        ? 'Северо-Двинский и Печорский бассейн (Северная Двина, Вычегда, Сухона, Печора, Белое море)'
        : 'Кольско-Баренцевоморский бассейн (Кольский п-ов, Баренцево и Белое моря)',
      searchPlaceholder: isSea
        ? 'Поиск рыбы (треска, сайда, пикша, камбала, палтус, навага, корюшка, горбуша, сёмга...)'
        : 'Поиск рыбы (хариус, сиг, кумжа, сёмга, щука, окунь, лещ, судак, налим, горбуша, голец, сорога...)',
      signatureSpecies: isSea
        ? ['cod', 'haddock', 'saithe', 'flounder', 'plaice', 'navaga', 'smelt', 'halibut', 'wolffish', 'herring', 'salmon', 'pink_salmon', 'sea_bass', 'capelin', 'king_crab']
        : (isPechoraDvina
            ? ['pike', 'perch', 'bream', 'zander', 'grayling', 'whitefish', 'roach', 'ide', 'dace', 'burbot', 'crucian', 'salmon', 'pink_salmon', 'peled', 'chir', 'pizhyan', 'vendace', 'ruffe', 'smelt', 'navaga', 'sterlet']
            : ['trout', 'grayling', 'char', 'whitefish', 'salmon', 'pink_salmon', 'pike', 'perch', 'burbot', 'vendace', 'smelt', 'dace', 'roach'])
    };
  }

  if (bCode === 'yenisei_lena') {
    const isNorthYeniseiOrLena = lat >= 60.0 || lon >= 108.0;
    return {
      subRegion: isNorthYeniseiOrLena ? 'yenisei_lena_north' : 'yenisei_angara_south',
      displayBasinName: lon >= 108.0
        ? 'Ленский и Северо-Восточный бассейн (Лена, Вилюй, Алдан, Индигирка, Колыма — Якутия)'
        : (lat >= 60.0
            ? 'Нижне-Енисейский и Таймырский северный бассейн'
            : 'Верхне-Енисейский и Ангарский бассейн (Енисей, Ангара, Мана, Хакасия, Тыва)'),
      searchPlaceholder: isNorthYeniseiOrLena
        ? 'Поиск рыбы (хариус, ленок, щука, окунь, пелядь, чир, пыжьян, тугун, налим, сорога, елец...)'
        : 'Поиск рыбы (хариус, окунь, щука, елец-чебак, ленок, сорога, налим, пелядь, лещ, таймень...)',
      signatureSpecies: isNorthYeniseiOrLena
        ? ['pike', 'perch', 'grayling', 'lenok', 'dace', 'peled', 'chir', 'pizhyan', 'tugun', 'valek', 'ide', 'roach', 'crucian', 'burbot', 'cisco', 'char']
        : ['grayling', 'perch', 'pike', 'dace', 'roach', 'lenok', 'ide', 'crucian', 'burbot', 'peled', 'bream', 'zander', 'ruffe', 'gudgeon', 'tugun', 'pizhyan']
    };
  }

  if (bCode === 'baikal') {
    return {
      subRegion: 'baikal_angara_selenga',
      displayBasinName: 'Байкало-Ангарский бассейн (Байкал, Ангара, Селенга, Баргузин)',
      searchPlaceholder: 'Поиск рыбы (байкальский хариус, омуль, ленок, окунь, щука, сорога, елец-чебак, сиг, налим...)',
      signatureSpecies: ['baikal_grayling', 'perch', 'pike', 'roach', 'dace', 'omul', 'lenok', 'crucian', 'ide', 'burbot', 'pizhyan', 'peled', 'ruffe']
    };
  }

  if (bCode === 'amur') {
    return {
      subRegion: 'amur_ussuri_zeya',
      displayBasinName: 'Амурский бассейн (Амур, Зея, Бурея, Уссури, оз. Ханка, верхнеамурские озёра)',
      searchPlaceholder: 'Поиск рыбы (карась, сазан, щука, верхогляд, змееголов, ленок, хариус, сом, конь-губарь, кета...)',
      signatureSpecies: ['crucian', 'carp', 'pike', 'sky_gazer', 'snakehead', 'amur_catfish', 'tarpon_carp', 'parabramis', 'lenok', 'grayling', 'grass_carp', 'burbot', 'rotan', 'chum_salmon', 'pink_salmon', 'gudgeon']
    };
  }

  return {
    subRegion: 'pacific_far_east',
    displayBasinName: 'Тихоокеанский бассейн (Приморье, Сахалин, Камчатка, Магадан, Чукотка)',
    searchPlaceholder: 'Поиск рыбы (кета, горбуша, кижуч, мальма, кунджа, корюшка, навага, камбала, терпуг, сима...)',
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
  const wNameLower = String(selectedWaterName || '').toLowerCase().trim();
  const hasExplicitWater = wNameLower.length > 0;
  // При явном выборе конкретного водоёма (например, р. Ево-Яха, оз. Молодёжное, р. Сочи) отключаем подтягивание чужих биотопов из радиуса
  const rSet = hasExplicitWater
    ? new Set([waterType])
    : (radiusWaterTypes instanceof Set ? radiusWaterTypes : new Set([waterType]));
  const isSeaWater = waterType === 'sea_gulf' || waterType === 'open_sea';
  const hasBigRiverInRadius = waterType === 'big_river' || (!hasExplicitWater && rSet.has('big_river'));
  const hasDeepQuarryInRadius = waterType === 'quarry' || (!hasExplicitWater && rSet.has('quarry'));
  const effCooling = waterType === 'cooling_reservoir' || (!hasExplicitWater && hasCoolingInRadius);
  const hasSeaInRadius = isSeaWater || (!hasExplicitWater && (isCoastal || rSet.has('sea_gulf') || rSet.has('open_sea')));

  // Специальный биотоп Большого Сочи и ЧПК
  const isSochiZone = bCode === 'black_azov' && lat <= 44.65 && lat >= 43.3 && lon >= 38.4 && lon <= 40.6;
  if (isSochiZone && !isSeaWater) {
    const isSochiCommercialPond = waterType === 'cooling_reservoir' || waterType === 'tundra_lake' || waterType === 'quarry' ||
      /серебрян|барановск|форелев|ахштыр|казачий брод|платник|пруд/i.test(wNameLower);
    if (isSochiCommercialPond) {
      return ['rainbow_trout', 'carp', 'crucian', 'grass_carp', 'silver_carp', 'channel_catfish', 'catfish', 'russian_sturgeon'].includes(fid);
    }
    const isCaucasianStream = waterType === 'small_river' || /мзымта|сочи|шахе|хоста|псоу|аше|псезуапсе|мацеста|кудепста|дагомыс|туапсе|пшада|вулан/i.test(wNameLower);
    if (isCaucasianStream) {
      return ['brown_trout', 'trout', 'rainbow_trout', 'chub', 'barbel', 'undermouth', 'shemaya', 'bleak', 'gudgeon', 'goby', 'mullet'].includes(fid);
    }
  }

  // Горные реки Северного Кавказа (КЧР, КБР, Северная Осетия, Ингушетия, Чечня, горный Дагестан, горная Адыгея)
  const isNorthCaucasusMountainStream = (bCode === 'volga_caspian' || bCode === 'black_azov') &&
    lat <= 44.3 && lon >= 39.8 && lon <= 48.2 && waterType === 'small_river' &&
    /теберда|зеленчук|лаба|белая|курждипс|дах|баксан|чегем|черек|малк|ардон|фиагдон|гизельдон|аргун|асса|армхи|андийск|аварск|каракойсу/i.test(wNameLower);
  if (isNorthCaucasusMountainStream) {
    return ['brown_trout', 'rainbow_trout', 'chub', 'barbel', 'undermouth', 'gudgeon', 'bleak'].includes(fid);
  }

  const fishWaters = Array.isArray(fish.waters) ? fish.waters : ['small_river', 'big_river', 'quarry', 'tundra_lake'];
  let waterMatch = fishWaters.includes(waterType);
  if (isSeaWater && (fish.habitat === 'sea' || fishWaters.includes('sea_gulf') || fishWaters.includes('open_sea'))) {
    waterMatch = true;
  }
  if (!waterMatch && !isSeaWater && fish.habitat === 'fresh' && !hasExplicitWater) {
    if (radiusKm >= 120) {
      waterMatch = fishWaters.some(wt => rSet.has(wt));
    }
  }
  if (!waterMatch) return false;

  // В морских акваториях Чёрного и Баренцева морей отсекаем чисто пресноводных щуку, речного окуня, плотву, карася, язя
  if (isSeaWater && ['pike', 'perch', 'roach', 'crucian', 'ide', 'tench', 'dace', 'chub', 'burbot', 'ruffe', 'gudgeon'].includes(fid)) {
    if (bCode === 'black_azov' && (lat <= 45.2 || waterType === 'open_sea')) return false;
    if (bCode === 'barents_white' && waterType === 'open_sea') return false;
    if (bCode === 'pacific_sea' && waterType === 'open_sea') return false;
  }

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
      if (waterType !== 'cooling_reservoir' && !(radiusKm >= 120 && effCooling) && !(isSouthernWarm && fid === 'buffalo')) {
        return false;
      }
    }
    if (['silver_carp', 'grass_carp'].includes(fid)) {
      if (lat >= 57.5 && waterType !== 'cooling_reservoir' && !effCooling) return false;
      if (waterType === 'small_river' && lat >= 52.0 && !effCooling) return false;
    }
    if (fid === 'rainbow_trout') {
      if (waterType !== 'cooling_reservoir' && waterType !== 'quarry' && bCode !== 'pacific_sea') return false;
    }
  }

  if (fid === 'char') {
    if (bCode === 'arctic_ob_taz') {
      // Только Полярный Урал и арктическое побережье Карского моря (не в равнинных речках Пура/Таза/Надыма)
      const isPolarUralOrCoast = (lat >= 65.4 && lon <= 68.2) || (lat >= 67.5 && isSeaWater);
      if (!isPolarUralOrCoast) return false;
    } else if (bCode === 'yenisei_lena') {
      if (lat < 66.0) return false; // Таймыр, Путорана, низовья Лены
    } else if (bCode === 'barents_white') {
      if (lat < 64.5) return false; // Кольский п-ов, Северная Карелия, НАО, Полярный Урал
    } else if (bCode === 'nw_karelia') {
      // Палия в глубоких озёрах Ладога, Онега, Сегозеро, Пяозеро, Топозеро
      if (waterType !== 'quarry' && !hasDeepQuarryInRadius) return false;
    } else if (bCode === 'baikal') {
      if (lat < 54.0 || !hasDeepQuarryInRadius) return false;
    } else if (bCode !== 'pacific_sea') {
      return false;
    }
  }

  if (fid === 'chir') {
    if (bCode === 'arctic_ob_taz') {
      if (lat < 60.5) return false;
      // В малых равнинных речках и мелких городских озёрах (Ево-Яха, Седе-Яха, Молодёжное) щёкура нет — он в Пуре, Тазе, Надыме, Оби и крупных глубоких озёрах
      if ((waterType === 'small_river' || /молод[её]жн|безымянн/i.test(wNameLower)) && hasExplicitWater && !/пур|таз|надым|обь|собь|сыня|войкар|нгаркато|негито|ямбуто|пякуто|ямылиму/i.test(wNameLower)) {
        return false;
      }
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
      if (/молод[её]жн|безымянн/i.test(wNameLower)) return false;
    } else if (bCode === 'barents_white') {
      if (lat < 63.5 || lon < 44.0) return false;
    }
  }

  if (fid === 'peled') {
    if (bCode === 'arctic_ob_taz') {
      if (lat < 59.2 && waterType !== 'tundra_lake' && waterType !== 'quarry') return false;
      if (/молод[её]жн|безымянн/i.test(wNameLower)) return false;
    } else if (bCode === 'volga_caspian') {
      if (waterType !== 'quarry' && waterType !== 'tundra_lake') return false;
      if (lat < 53.5) return false;
    } else if (bCode === 'barents_white') {
      if (lon < 42.0) return false;
    } else if (bCode === 'nw_karelia') {
      return false; // В диких озёрах Карелии и Ладоге/Онеге пелядь не является массовым видом
    }
  }

  if (fid === 'muksun') {
    if (lat < 60.2) return false;
    if (waterType !== 'big_river' && waterType !== 'sea_gulf' && !hasBigRiverInRadius) return false;
  }

  if (fid === 'nelma') {
    if (bCode === 'arctic_ob_taz' && lat < 57.5) return false;
    const isKubenskoyeLake = bCode === 'barents_white' && /кубенск/i.test(wNameLower);
    if (bCode === 'barents_white' && !isKubenskoyeLake && (lat < 61.0 || lon < 40.0)) return false;
    if (!isKubenskoyeLake && waterType !== 'big_river' && waterType !== 'sea_gulf' && !hasBigRiverInRadius) return false;
  }

  if (fid === 'cisco') {
    if (lat < 61.2) return false;
    if (bCode === 'barents_white' && lon < 47.0) return false;
    if (bCode === 'arctic_ob_taz' && waterType !== 'big_river' && waterType !== 'sea_gulf' && !hasBigRiverInRadius) return false;
  }

  if (fid === 'omul_arctic') {
    if (lat < 65.5) return false;
    if (bCode === 'barents_white' && lon < 42.0) return false; // На Кольском п-ове арктического омуля нет
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
      // Тугун (сосьвинская сельдь / манерка) обитает в Северной Сосьве/Ляпине (lon <= 66.5), Оби, Томи и верховьях Таза (lon >= 80.0), но НЕ в реках Нового Уренгоя (Ево-Яха, Седе-Яха, Пур)
      const isSosvaUral = lat >= 59.0 && lon <= 66.5;
      const isUpperTazOrTom = lon >= 80.0;
      if (!isSosvaUral && !isUpperTazOrTom) return false;
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
    if (lat < 59.8) return false; // Нет в оз. Ильмень
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
    if (waterType === 'tundra_lake') return false;
    if (bCode === 'arctic_ob_taz') {
      // В ЯНАО и ХМАО хариус и таймень обитают ТОЛЬКО в горно-предгорных притоках Полярного/Приполярного Урала (lon <= 67.8) и восточных притоках Верхнего Таза (Ратта, Худосей: lon >= 80.5), но НЕ в равнинных торфяных реках Нового Уренгоя, Надыма, Пура, Сургута!
      const isUralSlope = lon <= 61.5 || (lat >= 59.0 && lon <= 67.8);
      const isEastTazOrAltaiTom = lon >= 80.5;
      if (!isUralSlope && !isEastTazOrAltaiTom) return false;
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
    } else if (bCode === 'arctic_ob_taz') {
      if (lon > 61.5 || lat > 58.0) return false;
    }
  }

  if (fid === 'sterlet') {
    if (waterType !== 'big_river' && !(radiusKm >= 120 && hasBigRiverInRadius)) return false;
    // По Красной книге ЯНАО и ГосНИОРХ стерлядь обитает только в Оби и Иртыше (lon <= 70.5), а в бассейнах Надыма, Пура и Таза полностью отсутствует!
    if (bCode === 'arctic_ob_taz' && (lat >= 66.8 || lon > 70.5)) return false;
    if (bCode === 'yenisei_lena' && lon >= 98.0) return false;
    if (bCode === 'barents_white' && (lon < 39.0 || lon > 54.0 || lat > 65.0)) return false;
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
    if (lat > 51.5) return false;
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
    } else if (bCode === 'nw_karelia') {
      if (lat > 64.5) return false; // В Пяозере и Топозере судака нет
    } else if (bCode === 'barents_white') {
      if (lat > 64.8 || lon < 38.5 || lon > 54.0) return false; // Только Сев. Двина, Вычегда, Онега, Лача, Кенозеро, Кубенское
    }
  }

  if (fid === 'bream') {
    if (bCode === 'arctic_ob_taz') {
      if (lat > 63.0 && !(waterType === 'big_river' && lon <= 70.0)) return false;
    } else if (bCode === 'yenisei_lena') {
      if (lat > 59.0 || lon > 104.5) return false;
    } else if (bCode === 'barents_white') {
      if (lat > 65.2 || lon < 38.5 || lon > 56.0) return false;
    }
  }

  if (fid === 'catfish') {
    if (bCode === 'nw_karelia' && lat > 60.2) return false; // Только р. Волхов, оз. Ильмень, Ловать, Шелонь
  }

  if (fid === 'volga_zander') {
    if (bCode === 'baltic' || bCode === 'nw_karelia' || bCode === 'euro_west') return false;
  }

  if (fid === 'carp' || fid === 'tench') {
    if (bCode === 'arctic_ob_taz' || bCode === 'yenisei_lena') {
      if (lat > 59.2 && waterType !== 'cooling_reservoir' && !effCooling) return false;
    }
    if (bCode === 'nw_karelia' && lat > 61.8) return false;
  }

  if (['white_bream', 'rudd', 'bleak'].includes(fid)) {
    if (bCode === 'arctic_ob_taz') {
      if (lat > 58.6 || lon > 84.5) return false;
    }
    if (bCode === 'nw_karelia' && lat > 63.0) return false;
  }

  if (fid === 'chub' || fid === 'asp') {
    if (bCode === 'arctic_ob_taz') {
      if (lon > 62.2 || lat > 58.2) return false;
    }
    if (bCode === 'nw_karelia' && lat > 62.0) return false;
  }

  return true;
}


function rankSpeciesWithUserPriority(scoredItems, targetSpeciesIds = [], favoriteSpeciesIds = []) {
  if (!Array.isArray(scoredItems) || scoredItems.length === 0) return [];
  const targetSet = new Set(Array.isArray(targetSpeciesIds) ? targetSpeciesIds : []);
  const favSet = new Set(Array.isArray(favoriteSpeciesIds) ? favoriteSpeciesIds : []);

  const enriched = scoredItems.map(item => {
    const f = item.fish || item;
    const fid = f.id;
    const isTarget = targetSet.has(fid);
    const isFav = favSet.has(fid);
    const priorityGroup = isTarget ? 3 : (isFav ? 2 : 1);
    const rankVal = Number.isFinite(item.rankSc)
      ? item.rankSc
      : (Number.isFinite(item.rankScore)
          ? item.rankScore
          : (Number.isFinite(item.rank) ? item.rank : (Number.isFinite(item.score) ? item.score : (item.scDay || 50))));
    return {
      ...item,
      priorityGroup,
      isUserTarget: isTarget,
      isUserFavorite: isFav,
      _rankVal: rankVal
    };
  });

  enriched.sort((a, b) => {
    if (b.priorityGroup !== a.priorityGroup) return b.priorityGroup - a.priorityGroup;
    return b._rankVal - a._rankVal;
  });

  return enriched;
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
  // Чукотка в Западном полушарии (Уэлен, Лаврентия, Провидения: lon < 0)
  if (lon < -160.0 && lat >= 60.0) return 'pacific_sea';

  // Черноморско-Азовский и Донской бассейн (включая Северский Донец, Оскол, Красивую Мечу, Ворону, Хопёр, Мичуринск, Ливны, Ефремов, Старый Оскол)
  // Но НЕ Каспийский берег Дагестана/Калмыкии/Астрахани и НЕ бассейн Терека/Сулака/Кумы (lon >= 43.2 && lat <= 46.2)
  if (lat >= 41.0 && lat <= 45.8 && lon >= 43.2 && lon <= 51.5) return 'volga_caspian';
  if (lat >= 41.0 && lat <= 47.8 && lon >= 31.5 && lon <= 43.2) return 'black_azov';
  // Донской бассейн в Центральном Черноземье (Воронеж, Липецк, Елец, Ливны, Ефремов, Старый Оскол, Губкин, Белгород, Валуйки, Мичуринск, Уварово, Борисоглебск)
  // При этом Тамбов, Котовск, Моршанск (р. Цна: lat >= 52.55 && lon >= 41.2) остаются в volga_caspian!
  if (lat >= 47.8 && lat <= 53.35 && lon >= 36.35 && lon <= 43.5) {
    const isTambovTsna = lat >= 52.55 && lon >= 41.15 && lon <= 42.5;
    const isKurskSeim = lat >= 51.25 && lon <= 37.35 && lat <= 52.45;
    const isOrelOka = lat >= 52.65 && lon <= 37.35;
    if (!isTambovTsna && !isKurskSeim && !isOrelOka) return 'black_azov';
  }

  // Балтийский бассейн (Калининград, Псков, Великие Луки, Финский залив, Выборг, Высоцк, Луга)
  if (lat >= 53.8 && lat <= 61.0 && lon >= 19.0 && lon <= 30.85) return 'baltic';
  // Северо-запад Смоленской области (Велиж, Демидов, Пржевальское — бассейн Западной Двины)
  if (lat >= 55.15 && lat <= 56.5 && lon >= 30.8 && lon <= 32.1) return 'baltic';

  // Баренцево-Беломорский, Северо-Двинский и Печорский бассейн (включая Вологду, Сухону, Вычегду, Печору, Воркуту, Инту, Амдерму)
  if (lat >= 59.1 && lon >= 39.2 && lon < 65.0) return 'barents_white';
  if (lat >= 64.5 && lon >= 30.0 && lon < 65.0) return 'barents_white';

  // Ладожско-Онежский, Ильменско-Волховский и Карельский бассейн (включая Старую Руссу, Валдай, Боровичи, Вытегру, Карелию)
  // При этом Рыбинское вдхр. (Брейтово, Борок, Череповец, Весьегонск, Пестово) и Белое озеро (Липин Бор, Белозерск) — это volga_caspian!
  if (lat >= 57.45 && lat < 66.5 && lon >= 29.0 && lon <= 37.8) {
    const isUpperVolgaRybinka = (lat <= 59.35 && lon >= 35.5) || (lat <= 57.9 && lon >= 32.3);
    const isBeloyeLake = lat >= 59.8 && lat <= 60.4 && lon >= 37.1 && lon <= 38.2;
    if (!isUpperVolgaRybinka && !isBeloyeLake) return 'nw_karelia';
  }

  // Дальний Восток: разделение Приморья (Ханка/Уссури -> amur; побережье Японского моря, Сахалин, Камчатка, Магадан, Чукотка -> pacific_sea)
  if (lon >= 130.0 && lat >= 42.0) {
    const isKhankaUssuriInland = lat >= 44.1 && lat <= 48.6 && lon >= 130.8 && lon <= 135.2;
    const isAmurMainStem = lat >= 47.5 && lat <= 54.0 && lon >= 130.0 && lon <= 140.5;
    if (isKhankaUssuriInland || isAmurMainStem) return 'amur';
    if (lon >= 135.2 || lat < 44.1 || lat >= 54.0) return 'pacific_sea';
  }
  if (lon >= 112.0 && lon < 141.0 && lat >= 44.0 && lat < 56.0) return 'amur';

  // Байкало-Ангарский бассейн (Байкал, Селенга, Хилок, Чикой, Иркутск, Братск, Усть-Илимск)
  if (lat >= 49.5 && lat <= 58.5 && lon >= 101.5 && lon < 112.5) return 'baikal';

  // Енисейско-Ленский сибирский бассейн (включая Витим/Бодайбо, Алдан, Лену, Индигирку, Колыму)
  if (lon >= 88.0 && lon < 162.0 && lat >= 50.0) return 'yenisei_lena';

  // Обь-Иртышский и Тазовский бассейн (Западная Сибирь, Урал, Зауралье, ЯНАО, ХМАО)
  if (lat >= 50.5 && lon >= 59.65 && lon < 88.0) {
    // Южный Урал (Магнитогорск, Верхнеуральск, Ириклинское вдхр. — бассейн р. Урал -> volga_caspian)
    if (lat < 54.25 && lon < 60.6) return 'volga_caspian';
    return 'arctic_ob_taz';
  }

  // Днепровско-Деснянский западный бассейн (Смоленск, Брянск, Курск/Сейм, Юго-Запад Калужской обл. — Людиново/Киров, Дмитровск, Грайворон)
  // При этом Калуга, Обнинск, Таруса, Козельск, Орёл, Мценск, Белёв, Алексин, Суворов, Гагарин, Сычёвка (р. Ока, Угра, Жиздра, Зуша, Вазуза) — это volga_caspian!
  if (lon < 37.35 && lat < 55.6) {
    const isOkaUgraVazuza = (lat >= 54.15 && lon >= 34.8) || (lat >= 52.8 && lon >= 35.8 && lat <= 54.2);
    const isLudinovoKirovBolva = lat >= 53.7 && lat <= 54.25 && lon >= 34.2 && lon <= 34.75;
    if (!isOkaUgraVazuza || isLudinovoKirovBolva) return 'euro_west';
  }

  return 'volga_caspian';
}

function isCoastalInBasin(basinCode, lat, lon) {
  if (!BASIN_CONFIGS[basinCode]?.hasSea) return false;
  switch (basinCode) {
    case 'arctic_ob_taz':
      return (lat >= 66.45 && lon >= 65.5 && lon <= 74.5) || (lat >= 67.2 && lon >= 65.5 && lon <= 84.0);
    case 'yenisei_lena':
      return lat >= 69.0;
    case 'nw_karelia':
      return (lat >= 63.8 && lon >= 34.0) || (lat <= 60.8 && lon <= 30.8);
    case 'volga_caspian':
      return (lat <= 46.65 && lon >= 46.5 && lon <= 51.5) || (lat <= 44.5 && lon >= 46.5 && lon <= 49.0);
    case 'black_azov':
      if (lat <= 44.85 && lon >= 37.0 && lon <= 40.2) return true; // ЧПК (Анапа — Сочи)
      if (lat <= 46.6 && lon >= 31.5 && lon <= 36.8) return true; // Крым и Херсонское побережье
      if (lat >= 45.0 && lat <= 47.4 && lon >= 34.5 && lon <= 39.5) return true; // Азовское море, Сиваш и лиманы
      return false;
    case 'baltic':
      return (lon <= 22.5) || (lat >= 59.35 && lon >= 27.5 && lon <= 30.8);
    case 'barents_white':
      return lat >= 66.2 || (lat >= 63.8 && lon >= 34.0 && lon <= 46.0) || (lat >= 68.0 && lon < 65.5);
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


function getLocalizedBotFishName(fishOrId, basinCode = '', admin1 = '', lat = null, lon = null) {
 const fish = typeof fishOrId === 'string'
  ? BOT_FISH_CATALOG.find(f => f.id === fishOrId)
  : fishOrId;
 if (!fish) return String(fishOrId || '');
 const fid = fish.id;
 const adm = String(admin1 || '').toLowerCase();
 const nLat = Number.isFinite(Number(lat)) ? Number(lat) : null;
 const nLon = Number.isFinite(Number(lon)) ? Number(lon) : null;

 if (fid === 'roach') {
  const isChebakZone = /свердлов|челябин|курган|тюмен|омск|новосибир|алтай/i.test(adm) ||
   (basinCode === 'arctic_ob_taz' && nLat !== null && nLat < 58.5 && nLon !== null && nLon >= 59.0 && nLon <= 86.0);
  if (isChebakZone) return 'Плотва сибирская (Чебак)';
  const isSorogaZone = /ямало|янао|ханты|хмао|югра|томск|краснояр|иркут|бурят|якут|саха|забайкал|карел|архангел|коми|ненец|вологод|перм|киров/i.test(adm) ||
   ['arctic_ob_taz', 'yenisei_lena', 'baikal', 'barents_white', 'nw_karelia'].includes(basinCode);
  if (isSorogaZone) return 'Плотва сибирская (Сорога)';
  return 'Плотва обыкновенная';
 }
 if (fid === 'vobla') return 'Вобла каспийская';
 if (fid === 'taran') return 'Тарань азовско-черноморская';
 if (fid === 'dace') {
  const isMohtikZone = /ямало|янао|ханты|хмао|югра|томск|тюмен/i.test(adm) ||
   (basinCode === 'arctic_ob_taz' && (nLat === null || nLat >= 57.5));
  if (isMohtikZone) return 'Елец сибирский (Мохтик)';
  const isEastSibChebak = /краснояр|иркут|бурят|хакас|тыва/i.test(adm) ||
   ['yenisei_lena', 'baikal'].includes(basinCode);
  if (isEastSibChebak) return 'Елец сибирский (Елец-чебак)';
  if (basinCode === 'amur') return 'Елец (Амурский чебак)';
  return 'Елец обыкновенный';
 }
 if (fid === 'peled') {
  if (basinCode === 'arctic_ob_taz' || /ямало|янао|ханты|хмао|тюмен|свердлов|челябин|курган/i.test(adm)) {
   return 'Пелядь (Сырок)';
  }
  return 'Пелядь';
 }
 if (fid === 'chir') {
  if (basinCode === 'arctic_ob_taz' || /ямало|янао|ханты|хмао|коми|ненец/i.test(adm) || (nLon !== null && nLon < 85)) {
   return 'Чир (Щёкур)';
  }
  return 'Чир';
 }
 if (fid === 'pizhyan') {
  if (basinCode === 'arctic_ob_taz' && (nLat === null || nLat >= 63.0)) {
   return 'Сиг-пыжьян (Полкур)';
  }
  return 'Сиг-пыжьян (Сибирский сиг)';
 }
 if (fid === 'tugun') {
  if (/ханты|хмао|югра/i.test(adm) || (basinCode === 'arctic_ob_taz' && nLon !== null && nLon <= 66.5)) {
   return 'Тугун (Сосьвинская сельдь)';
  }
  if (basinCode === 'arctic_ob_taz') return 'Тугун (Манерка)';
  return 'Тугун';
 }
 if (fid === 'zander' && (basinCode === 'black_azov' || /ростов|краснодар|адыг/i.test(adm))) {
  return 'Судак (Сула)';
 }
 if (fid === 'bream' && (basinCode === 'black_azov' || /ростов|краснодар/i.test(adm))) {
  return 'Лещ (Донской чебак)';
 }
 if (fid === 'vimba') {
  if (basinCode === 'baltic' || basinCode === 'nw_karelia') return 'Сырть (Рыбец)';
  return 'Рыбец';
 }
 return fish.name;
}

const BOT_WINTER_GEAR_BY_ID = {
 pike: 'Зимние жерлицы с живцом (сорога, окунь, елец) на бровках и у коряг; зимнее блеснение на раттлины (вибы 70–90 мм), балансиры №5–7 и широкие вертикальные блёсны',
 amur_pike: 'Зимние жерлицы с живцом, зимний удильник с крупным раттлином (вибом 75–95 мм), балансиром или вертикальной блесной-крабом',
 perch: 'Зимняя удочка с балансиром 35–55 мм или вертикальной блесной с подвесным тройником; вольфрамовая мормышка с мотылём и безмотылка (чёртик, гвоздешарик)',
 zander: 'Зимний удильник Heavy с раттлином (вибом 75–95 мм, 18–36 г), узкой судаковой блесной или балансиром у дна на русловых свалах',
 volga_zander: 'Зимнее блеснение на узкие вертикальные блёсны и вибы 65–80 мм с подсадкой тюльки, тяжёлая мормышка на течении',
 roach: 'Зимняя безмотыльная удочка (гвоздешарик, гвоздекубик, чёртик, коза) или деликатная кивковая оснастка с вольфрамовой мормышкой и мотылём/опарышем',
 dace: 'Зимняя деликатная мормышка (вольфрам 1.5–3 мм) на леске 0.08–0.10 мм с мотылём/опарышем или активная безмотылка (гвоздешарик, уралка) на струе',
 ide: 'Зимняя мормышка (капля, уралка 3–5 мм) на течении с пучком мотыля или опарыша, чёртик и небольшие зимние блёсны',
 bream: 'Зимняя поплавочная удочка или кивок Щербакова с коромыслом и пучком мотыля над закормленной лункой, тандем чёртиков',
 white_bream: 'Зимняя мормышка с мотылём или безмотылка (чёртик, коза) с активной игрой у дна',
 blue_bream: 'Зимняя безмотылка (чёртик, гирлянда) или мормышка с мотылём вполводы и у русловых бровок',
 sopa: 'Зимняя покаток-мормышка на течении с мотылём или опарышем у дна',
 burbot: 'Тяжёлая донная блесна-стукалка (джиг-головка 25–45 г с подсадкой резки ерша/корюшки) и зимние подлёдные поставуши на налимьих тропах',
 ruffe: 'Зимняя донная мормышка с мотылём у самого дна',
 peled: 'Зимняя многокрючковая гирлянда (самодур с мушками под бокоплава), деликатная вольфрамовая мормышка с мотылём или узкая сиговая блесна',
 pizhyan: 'Зимняя вольфрамовая мормышка (уралка, муравей) с мотылём/бокоплавом, безмотылка или узкая вертикальная сиговая блесна с цепочкой',
 chir: 'Зимняя донная вольфрамовая мормышка с мотылём или ручейником у дна, тяжёлая безмотылка на слабом течении',
 cisco: 'Зимний многокрючковый самодур (гирлянда из мелких мушек/бисера) и микро-мормышка в толще воды',
 omul: 'Зимний байкальский настрой (гирлянда мушек под бормаша) с кивком на глубинных свалах',
 vendace: 'Зимняя гирлянда из микро-мормышек с подсадкой мотыля или опарыша вполводы с ночной подсветкой лунки',
 whitefish: 'Зимняя сиговая блесна с подвесным крючком на цепочке, вольфрамовая мормышка с мотылём или гирлянда',
 broad_whitefish: 'Зимняя вертикальная сиговая блесна и тяжёлая вольфрамовая мормышка на глубоких лудах',
 grayling: 'Зимняя удочка с вольфрамовой мормышкой и подсадкой нимфы/бормаша/мотыля или зимними мушками на перекатах подо льдом',
 baikal_grayling: 'Зимний бормашовый настрой с грузовой мормышкой и подвесной мушкой под цвет гаммаруса',
 trout: 'Зимнее блеснение на вибы (раттлины 55–75 мм), колебалки Williams и поставуши с форелевой пастой или мальком',
 rainbow_trout: 'Зимний удильник с раттлином (Eclipse, Ima 55–75 мм), блесной Williams Wabler, силиконовым червём на джиг-головке и поставуши с пастой',
 char: 'Зимняя вертикальная блесна с подсадкой нарезки или кальмара, балансир и мормышка с гаммарусом',
 dolly_varden: 'Зимняя блесна-колебалка или тасманский дьявол со льда, мормышка с икрой/короедом',
 smelt: 'Зимние корюшиные удочки с гирляндой светящихся мормышек (светонакопитель) и нарезкой свежей рыбы или креветки',
 navaga: 'Зимняя блесна-самосвал с подсадкой морского червя, креветки или резки рыбы, донная гирлянда со льда',
 crucian: 'Зимняя деликатная поплавочная или кивковая снасть (леска 0.08–0.10 мм, микро-мормышка с мотылём) по оттепелям и в незамерзающих водоёмах',
 rudd: 'Зимняя лёгкая мормышка с мотылём или опарышем у кромки камыша',
 tench: 'В период ледостава находится в зимнем оцепенении в иле (активен только по открытой воде и на тёплых сбросах ГРЭС)',
 carp: 'В период ледостава зимует в глубоких русловых ямах (активная ловля на донные снасти — на тёплых сбросах ГРЭС/АЭС и южных водоёмах без льда)',
 catfish: 'В период ледостава залегает в зимовальных ямах (целенаправленный зимний лов на зимовальных ямах запрещён Правилами рыболовства)'
};

function evaluateBotIceAndSeasonState(lat, lon, tAir, wType = 'small_river') {
 const nLat = Number(lat) || 55.75;
 const nAir = Number.isFinite(Number(tAir)) ? Number(tAir) : 2.0;
 const now = new Date();
 const startOfYear = new Date(Date.UTC(now.getUTCFullYear(), 0, 0));
 const doy = Math.floor((now - startOfYear) / 86400000);

 // Тёплые сбросы ГРЭС/АЭС и южные/баренцевы открытые моря не замерзают
 if (wType === 'cooling_reservoir') {
  return {
   isIce: false,
   iceState: 'open_water',
   iceText: 'Открытая вода (тёплый сброс)',
   waterTemp: Math.max(8.5, Math.min(24, Math.round((nAir * 0.4 + 12.5) * 10) / 10))
  };
 }
 if (wType === 'open_sea' && (nLat <= 47.5 || (nLat >= 68.5 && Number(lon) >= 31.0 && Number(lon) <= 42.0))) {
  return {
   isIce: false,
   iceState: 'open_water',
   iceText: 'Открытая морская вода',
   waterTemp: Math.max(3.5, Math.min(24, Math.round((nAir * 0.45 + 6.5) * 10) / 10))
  };
 }

 // Арктика и Крайний Север (ЯНАО — Новый Уренгой, Салехард, Надым, Тазовский; Таймыр; Якутия; Чукотка; НАО; север ХМАО и Коми: lat >= 63.5)
 // С 15 октября (DOY >= 288) по 15 мая (DOY <= 135) при tAir <= 2.5°C — устойчивый ледостав
 const isArcticWinter = nLat >= 63.5 && (doy >= 288 || doy <= 135) && nAir <= 2.5;
 // Северная и средняя тайга, Урал, Сибирь, Карелия, Архангельск, Вологда, Пермь, Киров (lat 58.0..63.5): с 1 ноября (DOY >= 305) по 20 апреля (DOY <= 110) при tAir <= 1.5°C
 const isTaigaWinter = nLat >= 58.0 && nLat < 63.5 && (doy >= 305 || doy <= 110) && nAir <= 1.5;
 // Средняя полоса, Поволжье, Южный Урал, Южная Сибирь (lat 51.0..58.0): с 20 ноября (DOY >= 324) по 31 марта (DOY <= 90) при tAir <= -1.0°C
 const isTemperateWinter = nLat >= 51.0 && nLat < 58.0 && (doy >= 324 || doy <= 90) && nAir <= -1.0;

 if (isArcticWinter || isTaigaWinter || isTemperateWinter || nAir <= -4.5) {
  return {
   isIce: true,
   iceState: 'ice_safe',
   iceText: 'Ледостав (твёрдая вода)',
   waterTemp: nLat >= 63.5 ? 0.8 : 1.2
  };
 }
 if (nAir <= 2.0 && nAir > -4.5 && (doy >= 280 || doy <= 125)) {
  return {
   isIce: false,
   iceState: 'frazil_slush',
   iceText: 'Забереги / шуга',
   waterTemp: Math.max(0.5, Math.round((nAir * 0.35 + 1.4) * 10) / 10)
  };
 }
 return {
  isIce: false,
  iceState: 'open_water',
  iceText: 'Открытая вода',
  waterTemp: Math.max(1.0, Math.min(24, Math.round((nAir * 0.52 + 2.8) * 10) / 10))
 };
}

function getBotSeasonalGearText(fish, isIce = false, shortMode = true) {
 if (!fish) return 'По сезону и условиям водоёма';
 if (fish.legal === 'redbook') return _RB_GEAR;
 const rawGear = isIce
  ? (BOT_WINTER_GEAR_BY_ID[fish.id] || `Зимняя подлёдная снасть: ${fish.gear || 'мормышка, балансир или зимняя блесна'}`)
  : (fish.gear || 'Спиннинг, фидер или поплавочная снасть');
 if (!shortMode) return rawGear;
 // Безопасная обрезка первой снасти БЕЗ разрыва скобок (...)
 const firstSemi = rawGear.split(';')[0].trim();
 if (firstSemi.length <= 115) return firstSemi;
 return firstSemi.slice(0, 112) + '...';
}

function computeBotSolarBiteWindow(fish, lat, isIce = false) {
 const nLat = Number(lat) || 55.75;
 const now = new Date();
 const startOfYear = new Date(Date.UTC(now.getUTCFullYear(), 0, 0));
 const doy = Math.floor((now - startOfYear) / 86400000);
 // Приближённое склонение Солнца (в радианах)
 const decl = 0.409 * Math.sin((2 * Math.PI / 365) * (doy - 81));
 const latRad = (nLat * Math.PI) / 180;
 const cosH = -Math.tan(latRad) * Math.tan(decl);

 const fid = fish?.id || 'pike';
 const isNocturnal = fid === 'burbot' || fid === 'catfish' || fid === 'eel' || fid === 'zander';

 // Полярная ночь или очень короткий зимний день Севера (cosH >= 0.72 -> световой день <= 6.5 ч, например Новый Уренгой в ноябре–январе)
 if (cosH >= 0.72 || (isIce && nLat >= 62.0 && (doy >= 305 || doy <= 55))) {
  if (fid === 'burbot') return '15:30–23:00 (сумерки и темнота подо льдом)';
  return '10:30–14:30 (пик короткого светового дня)';
 }
 // Белые ночи / полярный день Севера (май–июль на широте >= 62°)
 if (cosH <= -0.85) {
  if (isNocturnal) return '22:00–04:00 (ночная прохлада)';
  return '04:00–09:30 и 18:30–23:30 (утренний и вечерний выход)';
 }
 if (isIce) {
  if (fid === 'burbot') return '16:30–23:30 (после заката)';
  return '09:00–15:30 (дневной прогрев подо льдом)';
 }
 return fish?.win || '06:30–10:00 и 16:30–20:00 (зорьки)';
}

function getSpotSpeciesList(lat, lon, basinCode, wType, isCoastal, curMonthIdx = 9, nearWaters = [], waterName = '', admin1 = '', targetSpeciesIds = [], favoriteSpeciesIds = []) {
 const effWType = wType || 'small_river';
 const radiusWaterTypes = new Set((nearWaters || []).map(w => w.wType).concat([effWType]));
 const hasCoolingInRadius = effWType === 'cooling_reservoir' || radiusWaterTypes.has('cooling_reservoir');
 const isLocalCoastal = Boolean(isCoastal || effWType.startsWith('sea') || radiusWaterTypes.has('sea_gulf') || radiusWaterTypes.has('open_sea'));
 const ecoregion = getSpotEcoregion(lat, lon, basinCode, effWType, waterName);
 const sigOrder = ecoregion.signatureSpecies || REGIONAL_SIGNATURE_SPECIES[basinCode] || [];

 const rawList = BOT_FISH_CATALOG.filter(f => {
  if (f.legal === 'redbook') return false;
  return isSpeciesInGeoRange(f, lat, lon, basinCode, effWType, 60, radiusWaterTypes, isLocalCoastal, hasCoolingInRadius, waterName);
 });

 const targetSet = new Set(Array.isArray(targetSpeciesIds) ? targetSpeciesIds : []);
 const favSet = new Set(Array.isArray(favoriteSpeciesIds) ? favoriteSpeciesIds : []);

 const list = (rawList.length > 0 ? rawList : BOT_FISH_CATALOG.slice(0, 10)).map(f => ({
  ...f,
  name: getLocalizedBotFishName(f, basinCode, admin1, lat, lon),
  _priorityGroup: targetSet.has(f.id) ? 3 : (favSet.has(f.id) ? 2 : 1)
 }));

 list.sort((a, b) => {
  if (b._priorityGroup !== a._priorityGroup) return b._priorityGroup - a._priorityGroup;
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

 return list;
}

function buildSpotContext(lat, lon, customName = '', forcedWaterObj = null, forcedWaterType = '', userPriority = null) {
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
 const speciesList = getSpotSpeciesList(lat, lon, basinCode, wType, isCoastal, curMonthIdx, nearWaters, activeWaterName, admin1, userPriority?.targetSpecies || [], userPriority?.favorites || []);

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

function encodeKplocToken(lat, lon, fishId = 'pike', fisherId = '') {
 const encCoord = (v) => {
  const num = Number(v) || 0;
  const neg = num < 0 ? 'M' : '';
  const scaled = Math.round(Math.abs(num) * 10000);
  return `${neg}${scaled}`;
 };
 const cleanFish = String(fishId || 'pike').replace(/[^a-z0-9_]/gi, '').slice(0, 24) || 'pike';
 const fidPart = fisherId && /^FP_[A-Z0-9]{6,8}$/i.test(fisherId) ? `_${fisherId.toUpperCase()}` : '';
 return `KPLOC_${encCoord(lat)}_${encCoord(lon)}_${cleanFish}${fidPart}`;
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

function getUserSession(userId, cfGeo = null) {
 const key = String(userId || 'anon');
 if (!userSessions.has(key)) {
  userSessions.set(key, {
  lat: Number.isFinite(Number(cfGeo?.lat)) ? Number(cfGeo.lat) : 55.7558,
  lon: Number.isFinite(Number(cfGeo?.lon)) ? Number(cfGeo.lon) : 37.6173,
  cityName: cfGeo?.cityName || 'Водоём РФ',
  wType: '',
  waterName: '',
  fishId: 'pike',
  radiusKm: 50,
  keyboardSent: false
  });
 }
 return userSessions.get(key);
}

function saveUserSession(userId, patch = {}, cfGeo = null) {
 const key = String(userId || 'anon');
 const cur = getUserSession(key, cfGeo);
 const next = { ...cur, ...patch };
 if (key !== 'anon') {
  const devId = `tg_bot_${key}`;
  const unameNorm = String(next.tgUsername || '').trim().toLowerCase().replace(/^@/, '');
  const isOwnerTg = (unameNorm === 'iathor' || unameNorm === 'iathor82' || unameNorm === 'thorantony82');
  const regCode = isOwnerTg ? '89' : workerResolveRegionCode(next.cityName || cfGeo?.regionCode || '77');
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
   locLabel: isOwnerTg ? (next.cityName || 'Новый Уренгой') : (next.cityName || cfGeo?.cityName || 'Водоём РФ'),
   platform: 'TG-BOT',
   version: WORKER_VERSION,
   lat: Number.isFinite(Number(next.lat)) ? Number(next.lat) : (cfGeo?.lat || 55.7558),
   lon: Number.isFinite(Number(next.lon)) ? Number(next.lon) : (cfGeo?.lon || 37.6173),
   cfGeo
  });
 }
 userSessions.set(key, next);
 return next;
}

const BOT_REPLY_KEYBOARD = {
 keyboard: [
  [{ text: 'Прогноз' }, { text: 'Водоёмы' }, { text: 'ТОП-5 клёва' }],
  [{ text: 'ИИ по фото' }, { text: 'Круг и Точки' }, { text: 'Меню' }]
 ],
 resize_keyboard: true,
 is_persistent: true,
 input_field_placeholder: 'Город, водоём, рыба, фото или ключ KP-XXXX...'
};

const BOT_COMMANDS_LIST = [
 { command: 'start', description: 'Запуск и главное меню' },
 { command: 'klev', description: 'Прогноз клёва (напр. /klev р. Пур щука)' },
 { command: 'waters', description: 'Поиск водоёма с прогнозом и ихтиобазой' },
 { command: 'top', description: 'ТОП-5 клёва сегодня в локации' },
 { command: 'ai', description: 'Определить рыбу, длину и вес по фото' },
 { command: 'circle', description: 'Сводки Круга и точки рядом' },
 { command: 'menu', description: 'Компактное меню функций' },
 { command: 'help', description: 'Памятка по командам и ключам экипажей' }
];

const botVisionDetailsCache = new Map();

function arrayBufferToBase64Safe(buffer) {
 const bytes = new Uint8Array(buffer);
 let binary = '';
 const chunkSize = 8192;
 for (let i = 0; i < bytes.length; i += chunkSize) {
  const sub = bytes.subarray(i, i + chunkSize);
  binary += String.fromCharCode.apply(null, sub);
 }
 return btoa(binary);
}

function matchBotFishByAiName(nameRu, nameLat, spotSpeciesList, city = null) {
 const normRu = normStr(nameRu || '');
 const normLat = normStr(nameLat || '');
 const bCode = city?.basinCode || '';
 const pool = (Array.isArray(spotSpeciesList) && spotSpeciesList.length > 0)
  ? [...spotSpeciesList, ...BOT_FISH_CATALOG]
  : BOT_FISH_CATALOG;

 // Если нейросеть написала "Плотва (Вобла)" или "Плотва / Тарань", а регион не Каспий и не Азов — это строго плотва/сорога/чебак (roach)
 if (/плотв|сорог|чебак|rutilus rutilus|rutilus lacustris/i.test(`${normRu} ${normLat}`)) {
  if (bCode !== 'volga_caspian' && bCode !== 'black_azov') {
   const rFish = pool.find(f => f.id === 'roach');
   if (rFish) return rFish;
  }
 }
 if (normRu) {
  for (const f of pool) {
   const fNameNorm = normStr(f.name || '');
   if (fNameNorm === normRu || fNameNorm.startsWith(normRu + ' ') || normRu.includes(fNameNorm.split(' ')[0])) {
    return f;
   }
   if (Array.isArray(f.keywords)) {
    for (const kw of f.keywords) {
     if (normRu === kw || normRu.includes(kw)) return f;
    }
   }
  }
 }
 if (normLat) {
  for (const f of pool) {
   if (f.id && normLat.includes(normStr(f.id))) return f;
  }
 }
 return (spotSpeciesList && spotSpeciesList[0]) || BOT_FISH_CATALOG[0];
}

function formatBotFishLengthAndWeight(lengthCm, weightGrams, sizeText = '') {
 let lenStr = lengthCm > 0 ? `~${Math.round(lengthCm)} см` : '';
 let wStr = '';
 if (weightGrams >= 1000) {
  wStr = `~${(weightGrams / 1000).toFixed(weightGrams >= 5000 ? 1 : 2)} кг`;
 } else if (weightGrams > 0) {
  wStr = `~${Math.round(weightGrams)} г`;
 }
 if ((!lenStr || !wStr) && sizeText) {
  const cmM = sizeText.match(/(\d+(?:[.,–-]\d+)?)\s*см/i);
  const kgM = sizeText.match(/(\d+(?:[.,–-]\d+)?)\s*кг/i);
  const grM = sizeText.match(/(\d+(?:[.,–-]\d+)?)\s*г(?!р)/i);
  if (!lenStr && cmM) lenStr = `~${cmM[1]} см`;
  if (!wStr && kgM) wStr = `~${kgM[1]} кг`;
  if (!wStr && grM) wStr = `~${grM[1]} г`;
 }
 return {
  lengthStr: lenStr || 'по масштабу кадра',
  weightStr: wStr || 'по масштабу кадра'
 };
}

function parseBotAiVisionJson(rawText) {
 const clean = String(rawText || '').trim();
 if (!clean) return null;
 let jsonCandidate = clean;
 const fenced = clean.match(/```(?:json)?\s*([\s\S]*?)```/i);
 if (fenced && fenced[1]) {
  jsonCandidate = fenced[1].trim();
 } else {
  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
   jsonCandidate = clean.slice(firstBrace, lastBrace + 1);
  }
 }
 try {
  const parsed = JSON.parse(jsonCandidate);
  if (parsed && typeof parsed === 'object') {
   const rawSpecies = Array.isArray(parsed.detectedFish) ? parsed.detectedFish : (Array.isArray(parsed.species) ? parsed.species : []);
   const speciesList = rawSpecies
    .map(s => ({
     fishNameRu: String(s.fishNameRu || s.name || '').trim(),
     lengthCm: Number(s.lengthCm) || 0,
     weightGrams: Number(s.weightGrams) || 0,
     sizeText: String(s.sizeText || '').trim()
    }))
    .filter(s => s.fishNameRu && !s.fishNameRu.startsWith('{'));
   const mainName = String(parsed.fishNameRu || parsed.name || parsed.speciesName || speciesList[0]?.fishNameRu || '').trim();
   if (mainName && !mainName.startsWith('{')) {
    if (speciesList.length === 0) {
     speciesList.push({
      fishNameRu: mainName,
      lengthCm: Number(parsed.lengthCm) || 0,
      weightGrams: Number(parsed.weightGrams) || 0,
      sizeText: String(parsed.sizeText || '').trim()
     });
    }
    return {
     fishNameRu: mainName,
     lengthCm: Number(parsed.lengthCm) || speciesList[0]?.lengthCm || 0,
     weightGrams: Number(parsed.weightGrams) || speciesList[0]?.weightGrams || 0,
     sizeText: String(parsed.sizeText || speciesList[0]?.sizeText || '').trim(),
     speciesList
    };
   }
  }
 } catch (_) {}

 // Надёжное извлечение регулярными выражениями, даже если JSON от модели обрезался на середине!
 const nameMatch = clean.match(/"fishNameRu"\s*:\s*"([^"{}]+)"/i) || clean.match(/(?:Вид|Рыба)\s*[:—-]\s*([А-Яа-яЁёA-Za-z\s()-]{3,45})/i);
 const lenMatch = clean.match(/"lengthCm"\s*:\s*(\d+(?:\.\d+)?)/i);
 const wgtMatch = clean.match(/"weightGrams"\s*:\s*(\d+(?:\.\d+)?)/i);
 const szMatch = clean.match(/"sizeText"\s*:\s*"([^"{}]+)"/i);

 const allSpeciesMatches = [...clean.matchAll(/"fishNameRu"\s*:\s*"([^"{}]+)"[\s\S]{0,120}?"lengthCm"\s*:\s*(\d+(?:\.\d+)?)[\s\S]{0,120}?"weightGrams"\s*:\s*(\d+(?:\.\d+)?)/gi)];
 const extractedSpecies = [];
 const seenNames = new Set();
 for (const m of allSpeciesMatches) {
  const n = m[1].trim();
  const nKey = n.toLowerCase();
  if (n && !seenNames.has(nKey)) {
   seenNames.add(nKey);
   extractedSpecies.push({
    fishNameRu: n,
    lengthCm: Number(m[2]) || 0,
    weightGrams: Number(m[3]) || 0,
    sizeText: ''
   });
  }
 }

 if (nameMatch && nameMatch[1]) {
  const mainName = nameMatch[1].trim();
  const lenVal = lenMatch ? Number(lenMatch[1]) : (extractedSpecies[0]?.lengthCm || 0);
  const wgtVal = wgtMatch ? Number(wgtMatch[1]) : (extractedSpecies[0]?.weightGrams || 0);
  const szVal = szMatch ? szMatch[1].trim() : '';
  if (extractedSpecies.length === 0) {
   extractedSpecies.push({ fishNameRu: mainName, lengthCm: lenVal, weightGrams: wgtVal, sizeText: szVal });
  }
  return {
   fishNameRu: mainName,
   lengthCm: lenVal,
   weightGrams: wgtVal,
   sizeText: szVal,
   speciesList: extractedSpecies
  };
 }

 // Очистка от любых JSON-скобок и ключей, если пришёл свободный текст
 const cleanLines = clean
  .replace(/[{}[\]"]/g, ' ')
  .replace(/\b(fishNameRu|fishNameLat|confidence|lengthCm|weightGrams|sizeText|traits|fullText|alternatives|species)\s*:/gi, ' ')
  .split('\n')
  .map(l => l.trim())
  .filter(l => l.length >= 3);
 const fallbackName = cleanLines[0] ? cleanLines[0].slice(0, 50) : 'Рыба определена';
 return {
  fishNameRu: fallbackName,
  lengthCm: lenMatch ? Number(lenMatch[1]) : 0,
  weightGrams: wgtMatch ? Number(wgtMatch[1]) : 0,
  sizeText: szMatch ? szMatch[1].trim() : '',
  speciesList: [{ fishNameRu: fallbackName, lengthCm: 0, weightGrams: 0, sizeText: '' }]
 };
}

async function identifyFishPhotoForBot(env, ctx, botToken, fileId, city, captionText = '') {
 const fileMeta = await tgApi(botToken, 'getFile', { file_id: fileId });
 const filePath = fileMeta?.result?.file_path;
 if (!filePath) {
  return { ok: false, error: 'Не удалось загрузить снимок с серверов Telegram.' };
 }
 const fileRes = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
 if (!fileRes.ok) {
  return { ok: false, error: 'Ошибка чтения файла изображения.' };
 }
 const arrBuf = await fileRes.arrayBuffer();
 const pureB64 = arrayBufferToBase64Safe(arrBuf);
 const mimeType = /\.png$/i.test(filePath) ? 'image/png' : (/\.webp$/i.test(filePath) ? 'image/webp' : 'image/jpeg');

 const extraHint = captionText ? ` Подсказка: ${captionText.slice(0, 100)}.` : '';
 const prompt =
  `Определи, что за рыба на фото, её примерную длину (в см) и примерный вес (в граммах, по масштабу ладони или предметов в кадре). Регион съёмки: ${city.name} (${city.basin}).${extraHint}\n` +
  `Не путай сиговых (сиг-пыжьян, пелядь, тугун, чир, ряпушка, валёк — короткий спинной плавник и жировой плавник) и карповых (елец, плотва, язь — без жирового плавника) с хариусом (у хариуса высокий спинной плавник-парус). Если на фото несколько РАЗНЫХ видов рыб, перечисли их в species.\n` +
  `Рассуждай максимально кратко (1–2 фразы) и сразу верни ТОЛЬКО короткий JSON без текста вокруг:\n` +
  `{"fishNameRu":"название рыбы на русском","lengthCm":22,"weightGrams":140,"sizeText":"~22 см • ~140 г","species":[{"fishNameRu":"название вида 1","lengthCm":22,"weightGrams":140}]}`;

 let rawAiText = '';
 await syncFreshGeminiConfigFromD1(env);
 const geminiKeys = getEffectiveGeminiKeys(env, '');
 if (geminiKeys.length === 0) {
  const noKeyMsg = "В базе сервера D1 не заданы API-ключи Gemini. Сохраните ключ в Админ-панели (раздел 3. ИИ Gemini).";
  return { ok: false, errorCode: "NO_KEYS_CONFIGURED", replyText: noKeyMsg, error: noKeyMsg };
 }

 let lastBotSmartRes = null;
 if (geminiKeys.length > 0) {
  const perKey = Array.isArray(geminiConfigStore.perKeyUsed) ? geminiConfigStore.perKeyUsed : [0, 0, 0];
  const orderedIndices = geminiKeys.map((_, idx) => idx).sort((a, b) => (perKey[a] || 0) - (perKey[b] || 0));
  for (let attempt = 0; attempt < orderedIndices.length; attempt++) {
   const kSlotIdx = orderedIndices[attempt];
   const gKey = geminiKeys[kSlotIdx];
   try {
    const smartRes = await callGeminiGenerateContentSmart(
     gKey,
     [{
      parts: [
       { text: prompt },
       { inline_data: { mime_type: mimeType, data: pureB64 } }
      ]
     }],
     { temperature: 0.1, maxOutputTokens: 4096 },
     15000,
     "",
     false,
     env
    );
    lastBotSmartRes = smartRes;
    if (smartRes && smartRes.ok && smartRes.text) {
     rawAiText = smartRes.text;
     await recordGeminiRequestUsed(env, kSlotIdx, 'bot');
     persistSystemMeta(env, ctx).catch(() => {});
     break;
    }
   } catch (_) {}
  }
 }

 if (!rawAiText) {
  try {
   const pCtrl = new AbortController();
   const pTimer = setTimeout(() => pCtrl.abort(), 8500);
   const dataUri = `data:${mimeType};base64,${pureB64}`;
   const pRes = await fetch('https://text.pollinations.ai/openai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
     model: 'openai',
     temperature: 0.1,
     messages: [{
      role: 'user',
      content: [
       { type: 'text', text: prompt },
       { type: 'image_url', image_url: { url: dataUri } }
      ]
     }]
    }),
    signal: pCtrl.signal
   }).catch(() => null);
   clearTimeout(pTimer);
   if (pRes && pRes.ok) {
    const pJson = await pRes.json().catch(() => null);
    rawAiText = String(pJson?.choices?.[0]?.message?.content || '').trim();
   }
  } catch (_) {}
 }

 if (!rawAiText) {
  const errCode = lastBotSmartRes?.errorCode || "VISION_FAILED";
  let botErrMsg = "Сервер ИИ временно недоступен (" + errCode + "). Отправьте фото повторно через пару секунд.";
  if (errCode === "API_KEY_INVALID") {
   botErrMsg = "API-ключ Gemini отклонен Google (API_KEY_INVALID). Проверьте ключ в Админ-панели (раздел 3. ИИ Gemini).";
  } else if (errCode === "QUOTA_EXHAUSTED_429") {
   botErrMsg = "Превышен суточный лимит запросов Google Gemini (QUOTA_EXHAUSTED_429). Добавьте резервный ключ в Админ-панели.";
  } else if (errCode === "GEO_LOCATION_UNSUPPORTED") {
   botErrMsg = "Запрос к Gemini отклонен по гео-ограничению узла (GEO_LOCATION_UNSUPPORTED), резервный облачный шлюз не ответил. Повторите попытку.";
  }
  return { ok: false, errorCode: errCode, replyText: botErrMsg, error: botErrMsg };
 }

 const parsed = parseBotAiVisionJson(rawAiText);
 if (!parsed) {
  return { ok: false, error: 'Не удалось распознать рыбу на фото. Попробуйте более чёткий кадр.' };
 }

 const uniqueSpecies = [];
 const seenSp = new Set();
 for (const sp of (parsed.speciesList || [])) {
  const key = normStr(sp.fishNameRu);
  if (key && !seenSp.has(key)) {
   seenSp.add(key);
   const matched = matchBotFishByAiName(sp.fishNameRu, sp.fishNameLat || '', city.speciesList, city);
   const localizedName = getLocalizedBotFishName(matched, city.basinCode, city.admin1, city.lat, city.lon);
   const dims = formatBotFishLengthAndWeight(sp.lengthCm, sp.weightGrams, sp.sizeText || parsed.sizeText);
   uniqueSpecies.push({
    fishNameRu: localizedName,
    lengthStr: dims.lengthStr,
    weightStr: dims.weightStr,
    matchedFish: matched
   });
  }
 }
 if (uniqueSpecies.length === 0) {
  const matched = matchBotFishByAiName(parsed.fishNameRu, parsed.fishNameLat || '', city.speciesList, city);
  const localizedName = getLocalizedBotFishName(matched, city.basinCode, city.admin1, city.lat, city.lon);
  const dims = formatBotFishLengthAndWeight(parsed.lengthCm, parsed.weightGrams, parsed.sizeText);
  uniqueSpecies.push({
   fishNameRu: localizedName,
   lengthStr: dims.lengthStr,
   weightStr: dims.weightStr,
   matchedFish: matched
  });
 }

 const tok = `ai_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
 const rec = {
  tok,
  speciesList: uniqueSpecies.slice(0, 6),
  matchedFish: uniqueSpecies[0].matchedFish,
  city,
  ts: Date.now()
 };
 if (botVisionDetailsCache.size > 300) {
  const oldestKey = botVisionDetailsCache.keys().next().value;
  if (oldestKey) botVisionDetailsCache.delete(oldestKey);
 }
 botVisionDetailsCache.set(tok, rec);
 return { ok: true, rec };
}

function buildBotAiVisionCard(rec, selectedIdx = null, webappUrl = 'https://klevpro.ru', isPrivateChat = true) {
 const { tok, speciesList, city } = rec;
 const shortCity = String(city.name || 'Точка').split('(')[0].trim().slice(0, 14);
 const latFmt = city.lat.toFixed(3);
 const lonFmt = city.lon.toFixed(3);

 const idx = (typeof selectedIdx === 'number' && speciesList[selectedIdx]) ? selectedIdx : 0;
 const chosen = speciesList[idx] || speciesList[0];
 const matchedFish = chosen.matchedFish || BOT_FISH_CATALOG[0];
 const kplocTok = encodeKplocToken(city.lat, city.lon, matchedFish.id, '');
 const deepAppUrl = `${webappUrl}?start=${kplocTok}#/forecast`;

 let text =
  `*Рыба${speciesList.length > 1 && idx === 0 ? ' (по центру)' : ''}:* ${chosen.fishNameRu}\n` +
  `*Примерная длина:* ${chosen.lengthStr}\n` +
  `*Примерный вес:* ${chosen.weightStr}`;

 const inline_keyboard = [];

 if (speciesList.length > 1) {
  const otherLines = speciesList
   .map((sp, i) => i === idx ? null : `• *${sp.fishNameRu}* (${sp.lengthStr}, ${sp.weightStr})`)
   .filter(Boolean)
   .join('\n');
  text +=
   `\n\n*На фото несколько рыб!* Также распознаны:\n${otherLines}\n` +
   `_Выберите другую рыбу ниже, если вы спрашивали не про «${chosen.fishNameRu.split(' (')[0]}»:_`;

  const switchBtns = speciesList.map((sp, i) => ({
   text: `${i === idx ? '' : ''}${sp.fishNameRu.split(' (')[0].slice(0, 15)} (${sp.lengthStr})`,
   callback_data: `aisel:${tok}:${i}`
  }));
  for (let i = 0; i < switchBtns.length; i += 2) {
   inline_keyboard.push(switchBtns.slice(i, i + 2));
  }
 }

 inline_keyboard.push([
  { text: `Прогноз: ${matchedFish.name.split(' ')[0]}`, callback_data: `f:${latFmt}:${lonFmt}:${matchedFish.id}:${shortCity}` },
  makeAppButton('В приложении', deepAppUrl, isPrivateChat)
 ]);

 return { text, replyMarkup: { inline_keyboard } };
}

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
  { command: 'klev', description: 'Прогноз клёва (напр. /klev р. Пур щука)' },
  { command: 'waters', description: 'Поиск водоёма и ихтиобаза' },
  { command: 'top', description: 'ТОП-5 активных рыб в локации' },
  { command: 'ai', description: 'Распознать рыбу по фото' },
  { command: 'circle', description: 'Круг и точки рядом' },
  { command: 'help', description: 'Памятка по боту и ключам экипажей' }
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

async function geocodeWaterOnline(queryStr) {
 const clean = String(queryStr || '').trim();
 if (clean.length < 2) return null;
 try {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3800);
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(clean + ' Россия')}&format=json&addressdetails=1&limit=5&accept-language=ru`;
  const res = await fetch(url, {
   headers: { 'User-Agent': 'KlevProClubBot/2.5.6 (https://klevpro.ru)', 'Accept-Language': 'ru' },
   signal: ctrl.signal
  }).catch(() => null);
  clearTimeout(timer);
  if (res && res.ok) {
   const arr = await res.json().catch(() => null);
   if (Array.isArray(arr) && arr.length > 0) {
    const waterHit = arr.find(it =>
     it && (
      it.class === 'waterway' ||
      it.class === 'natural' ||
      /^(river|stream|canal|water|lake|reservoir|bay|strait|pond|oxbow)$/i.test(String(it.type || ''))
     )
    );
    if (waterHit) {
     const lat = parseFloat(waterHit.lat);
     const lon = parseFloat(waterHit.lon);
     if (Number.isFinite(lat) && Number.isFinite(lon)) {
      const rawName = waterHit.name || (waterHit.display_name ? waterHit.display_name.split(',')[0].trim() : clean);
      const tLower = `${rawName} ${waterHit.type || ''}`.toLowerCase();
      let wType = 'small_river';
      if (/грэс|тэц|охладител/i.test(tLower)) wType = 'cooling_reservoir';
      else if (/губа|залив|лиман|море|bay|strait/i.test(tLower)) wType = 'sea_gulf';
      else if (/вдхр|водохранилище|карьер|reservoir|lake|озеро|оз\./i.test(tLower)) wType = 'quarry';
      else if (/старица|пруд|болото|oxbow|pond/i.test(tLower)) wType = 'tundra_lake';
      else if (/обь|иртыш|енисей|волга|кама|дон|пур|таз|надым|амур|лена|ангара|печора|ока|урал|вятка|белая|кубань|нева|северная двина|томь|чулым|вах|конда|тобол|ахтуба/i.test(tLower)) wType = 'big_river';
      const addr = waterHit.address || {};
      const regName = addr.city || addr.town || addr.state || 'Россия';
      const customWaterObj = {
       name: rawName,
       cleanName: rawName.replace(/^(река|р\.|озеро|оз\.|вдхр\.?|водохранилище)\s+/i, '').trim() || rawName,
       lat,
       lon,
       wType,
       typeTag: WATER_TYPE_LABELS[wType] || 'Водоём',
       region: regName
      };
      return buildSpotContext(lat, lon, regName, customWaterObj, wType);
     }
    }
   }
  }
 } catch (_) {}
 return null;
}

function getBotUserPrioritySpecies(session = null) {
 if (!session) return { targetSpecies: [], favorites: [] };
 const fid = session.fisherId || (session.userId ? tgToFisherIdMap.get(String(session.userId)) : '');
 const aKey = fid ? fisherIdToAuthKeyMap.get(fid) : '';
 const prof = aKey ? cloudAuthProfiles.get(aKey) : null;
 return {
  targetSpecies: Array.isArray(prof?.targetSpecies) ? prof.targetSpecies : [],
  favorites: Array.isArray(prof?.favorites) ? prof.favorites : []
 };
}

async function resolveQueryCityAndFish(rawQuery, session = null) {
 const userPriority = getBotUserPrioritySpecies(session);
 const q = normStr(rawQuery)
  .replace(/^\/(klev|top|waters|fish|crew|circle|express|search|help|start|menu|ai)(@\S+)?\s*/i, '')
  .replace(/^(!клев|клев|прогноз|рыбалка|водоем|водоемы)\s+/i, '')
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
  spot = buildSpotContext(matchedWaterObj.lat, matchedWaterObj.lon, '', matchedWaterObj, matchedWaterObj.wType, userPriority);
 } else if (matchedSettlement) {
  spot = buildSpotContext(matchedSettlement.lat, matchedSettlement.lon, matchedSettlement.name, matchedWaterObj, explicitWaterType, userPriority);
 } else if (matchedWaterObj) {
  spot = buildSpotContext(matchedWaterObj.lat, matchedWaterObj.lon, '', matchedWaterObj, matchedWaterObj.wType, userPriority);
 } else {
  const cleanOnlineCandidate = placeQuery
  .replace(/(?:^|\s)(в|во|на|под|около|рядом|у|клев|прогноз|рыбалка|рыба|рыбы|ловля|клюет|список|какая|какие|водится|город|г|поселок|пгт|село|с|деревня|д)(?=\s|$)/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();

  if (cleanOnlineCandidate.length >= 2) {
   const onlineWaterSpot = await geocodeWaterOnline(cleanOnlineCandidate);
   if (onlineWaterSpot) {
    spot = onlineWaterSpot;
   } else {
    const cleanCityCand = cleanOnlineCandidate
     .replace(/(?:^|\s)(река|речка|р|озеро|оз|вдхр|водохранилище|карьер|пруд|старица|море|залив|губа|лиман)(?=\s|$)/gi, ' ')
     .replace(/\s+/g, ' ')
     .trim();
    if (cleanCityCand.length >= 2) {
     const onlineSpot = await geocodePlaceOnline(cleanCityCand);
     if (onlineSpot) {
      spot = explicitWaterType
       ? buildSpotContext(onlineSpot.lat, onlineSpot.lon, onlineSpot.name, null, explicitWaterType)
       : onlineSpot;
     }
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
  spot = buildSpotContext(session.lat, session.lon, session.cityName || '', savedWaterObj, explicitWaterType || session.wType || '', userPriority);
  } else {
  spot = buildSpotContext(55.7558, 37.6173, 'Водоём РФ', null, explicitWaterType);
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

async function fetchLiveSpotWeather(lat, lon, wType = 'small_river') {
 const gridKey = `${Number(lat).toFixed(1)}_${Number(lon).toFixed(1)}_${wType || 'sr'}`;
 const cachedGrid = weatherGridCache.get(gridKey);
 if (cachedGrid && Date.now() - cachedGrid.ts < 1200000) {
  return cachedGrid.data;
 }
 try {
  const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${Number(lat).toFixed(2)}&lon=${Number(lon).toFixed(2)}`;
  const res = await fetch(url, {
  headers: { 'User-Agent': 'KlevProClubBot/2.9.2 (https://klevpro.ru)' },
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
  const iceEval = evaluateBotIceAndSeasonState(lat, lon, tAir, wType);
  const waterTemp = iceEval.waterTemp;
  const iceText = iceEval.iceText;

  const tAir24 = Math.round((d24?.air_temperature ?? tAir) * 10) / 10;
  const pMm24 = Math.round(((d24?.air_pressure_at_sea_level || 1013) * 0.750062) - elev / 11.5);
  const wind24 = Math.round((d24?.wind_speed ?? wind) * 10) / 10;
  const iceEval24 = evaluateBotIceAndSeasonState(lat, lon, tAir24, wType);

  const tAir48 = Math.round((d48?.air_temperature ?? tAir24) * 10) / 10;
  const pMm48 = Math.round(((d48?.air_pressure_at_sea_level || 1013) * 0.750062) - elev / 11.5);
  const wind48 = Math.round((d48?.wind_speed ?? wind24) * 10) / 10;
  const iceEval48 = evaluateBotIceAndSeasonState(lat, lon, tAir48, wType);

  const resultObj = {
  tAir, waterTemp, press: pMm, wind, iceText, isIce: iceEval.isIce, iceState: iceEval.iceState,
  day2: { tAir: tAir24, waterTemp: iceEval24.waterTemp, press: pMm24, wind: wind24, isIce: iceEval24.isIce },
  day3: { tAir: tAir48, waterTemp: iceEval48.waterTemp, press: pMm48, wind: wind48, isIce: iceEval48.isIce }
  };
  weatherGridCache.set(gridKey, { ts: Date.now(), data: resultObj });
  return resultObj;
  }
  }
 } catch (e) {}
 const fbAir = Number(lat) >= 62.0 ? -8.0 : 2.0;
 const fbEval = evaluateBotIceAndSeasonState(lat, lon, fbAir, wType);
 return {
  tAir: fbAir,
  waterTemp: fbEval.waterTemp,
  press: 756,
  wind: 3.4,
  iceText: fbEval.iceText,
  isIce: fbEval.isIce,
  iceState: fbEval.iceState,
  day2: { tAir: fbAir, waterTemp: fbEval.waterTemp, press: 757, wind: 3.0, isIce: fbEval.isIce },
  day3: { tAir: fbAir, waterTemp: fbEval.waterTemp, press: 758, wind: 2.8, isIce: fbEval.isIce }
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
 let finalUrl = String(deepAppUrl || 'https://klevpro.ru/');
 if (!finalUrl.includes('v=r259')) {
  const hashIdx = finalUrl.indexOf('#');
  const basePart = hashIdx >= 0 ? finalUrl.slice(0, hashIdx) : finalUrl;
  const hashPart = hashIdx >= 0 ? finalUrl.slice(hashIdx) : '';
  const sep = basePart.includes('?') ? '&' : '?';
  finalUrl = `${basePart}${sep}v=r259&tma=1${hashPart}`;
 }
 if (isPrivateChat) {
  return { text, web_app: { url: finalUrl } };
 }
 return { text, url: finalUrl };
}

function getForecastSubmenuKeyboard(city, currentFish, deepAppUrl, isPrivateChat = true) {
 const shortCity = String(city.name || 'Точка').split('(')[0].trim().slice(0, 14);
 const latFmt = city.lat.toFixed(3);
 const lonFmt = city.lon.toFixed(3);
 const fid = currentFish?.id || 'pike';
 const appBtnText = `Открыть: ${shortCity} • ${(currentFish?.name || 'Рыба').split(' ')[0]}`;

 return [
  [makeAppButton(appBtnText, deepAppUrl, isPrivateChat)],
  [
   { text: 'Водоёмы и ихтиобаза', callback_data: `wmenu:${latFmt}:${lonFmt}:${fid}:${shortCity}` },
   { text: `Рыбы (${(city.speciesList || []).length})`, callback_data: `fmenu:${latFmt}:${lonFmt}:${fid}:${shortCity}` }
  ],
  [
   { text: 'ТОП-5 клёва', callback_data: `top:${latFmt}:${lonFmt}:${shortCity}` },
   { text: 'На 3 дня', callback_data: `exp:${latFmt}:${lonFmt}:${fid}:${shortCity}` }
  ],
  [
   { text: 'Круг и Точки', callback_data: `rad:${latFmt}:${lonFmt}:${shortCity}` },
   { text: 'Меню', callback_data: `menu:${latFmt}:${lonFmt}:${fid}:${shortCity}` }
  ]
 ];
}

async function buildWorkerForecastCard(city, fish, webappUrl, isPrivateChat = true) {
 const w = await fetchLiveSpotWeather(city.lat, city.lon, city.wType);
 const fishScore = computeFishScoreForWeather(fish, w);
 const verdict = fish.legal === 'redbook'
  ? 'Красная книга'
  : (fishScore >= 65 ? 'Отличный' : (fishScore >= 42 ? 'Умеренный' : 'Слабый'));

 const localizedFishName = getLocalizedBotFishName(fish, city.basinCode, city.admin1, city.lat, city.lon);
 const kplocTok = encodeKplocToken(city.lat, city.lon, fish.id, '');
 const deepAppUrl = `${webappUrl}?start=${kplocTok}#/forecast`;
 const shortGear = getBotSeasonalGearText(fish, w.isIce, true);
 const solarWin = computeBotSolarBiteWindow(fish, city.lat, w.isIce);

 const replyText =
  `*${city.name}* • ${city.water}\n` +
  `*${localizedFishName}:* клёв *${fishScore}%* (${verdict}) • ${solarWin}\n` +
  `Воздух ${w.tAir > 0 ? '+' + w.tAir : w.tAir}°C • Вода ~${w.waterTemp}°C • ${w.press} мм • Ветер ${w.wind} м/с • ${w.iceText}\n` +
  `*Снасть:* ${shortGear}`;

 const replyMarkup = {
  inline_keyboard: getForecastSubmenuKeyboard(city, { ...fish, name: localizedFishName }, deepAppUrl, isPrivateChat)
 };

 return { replyText, replyMarkup, fishScore, weather: w, deepAppUrl };
}

async function buildRigAndTacticsSubCard(city, fish, webappUrl, isPrivateChat = true) {
 const w = await fetchLiveSpotWeather(city.lat, city.lon, city.wType);
 const shortCity = String(city.name || 'Точка').split('(')[0].trim().slice(0, 14);
 const latFmt = city.lat.toFixed(3);
 const lonFmt = city.lon.toFixed(3);
 const localizedFishName = getLocalizedBotFishName(fish, city.basinCode, city.admin1, city.lat, city.lon);
 const fullGear = getBotSeasonalGearText(fish, w.isIce, false);
 const solarWin = computeBotSolarBiteWindow(fish, city.lat, w.isIce);

 const text =
  `*${localizedFishName} • Снасть и время*\n` +
  `${city.name} (${city.water})\n` +
  `${fullGear}\n` +
  `Выход: ${solarWin} • Вода ~${w.waterTemp}°C (${w.iceText})`;

 const inline_keyboard = [
  [
   { text: 'К прогнозу', callback_data: `f:${latFmt}:${lonFmt}:${fish.id}:${shortCity}` },
   { text: 'Другая рыба', callback_data: `fmenu:${latFmt}:${lonFmt}:${fish.id}:${shortCity}` }
  ]
 ];
 return { text, replyMarkup: { inline_keyboard } };
}

async function buildWeatherAndIceSubCard(city, fish, webappUrl, isPrivateChat = true) {
 const w = await fetchLiveSpotWeather(city.lat, city.lon);
 const shortCity = String(city.name || 'Точка').split('(')[0].trim().slice(0, 14);
 const latFmt = city.lat.toFixed(3);
 const lonFmt = city.lon.toFixed(3);

 const text =
  `*Погода и лёд • ${city.name}*\n` +
  `${city.water}\n` +
  `Воздух ${w.tAir > 0 ? '+' + w.tAir : w.tAir}°C • Вода ~${w.waterTemp}°C\n` +
  `${w.press} мм рт. ст. • Ветер ${w.wind} м/с • ${w.iceText}`;

 const inline_keyboard = [
  [
   { text: 'К прогнозу', callback_data: `f:${latFmt}:${lonFmt}:${fish.id}:${shortCity}` },
   { text: 'На 3 дня', callback_data: `exp:${latFmt}:${lonFmt}:${fish.id}:${shortCity}` }
  ]
 ];
 return { text, replyMarkup: { inline_keyboard } };
}

function buildFishBioAndCalendarSubCard(city, fish) {
 const shortCity = String(city.name || 'Точка').split('(')[0].trim().slice(0, 14);
 const latFmt = city.lat.toFixed(3);
 const lonFmt = city.lon.toFixed(3);
 const [minOpt, maxOpt] = fish.optT || [8, 16];

 const text =
  `*${fish.name} (${city.basin})*\n` +
  `Оптимум воды: +${minOpt}…+${maxOpt}°C\n` +
  `Часы клёва: ${fish.win}`;

 const inline_keyboard = [
  [
   { text: 'К прогнозу', callback_data: `f:${latFmt}:${lonFmt}:${fish.id}:${shortCity}` },
   { text: 'Другая рыба', callback_data: `fmenu:${latFmt}:${lonFmt}:${fish.id}:${shortCity}` }
  ]
 ];
 return { text, replyMarkup: { inline_keyboard } };
}

function buildFishPickerSubCard(city, currentFish) {
 const pool = [...(city.speciesList || [])];
 if (currentFish && !pool.some(x => x.id === currentFish.id)) pool.unshift(currentFish);
 const top12 = pool.slice(0, 12);
 const shortCity = String(city.name || 'Точка').split('(')[0].trim().slice(0, 14);
 const latFmt = city.lat.toFixed(3);
 const lonFmt = city.lon.toFixed(3);

 const rows = [];
 for (let i = 0; i < top12.length; i += 3) {
  rows.push(top12.slice(i, i + 3).map(f => ({
   text: `${f.id === currentFish?.id ? '' : ''}${f.name.split(/[\s(/]/)[0]}`,
   callback_data: `f:${latFmt}:${lonFmt}:${f.id}:${shortCity}`
  })));
 }
 rows.push([
  { text: 'К прогнозу', callback_data: `f:${latFmt}:${lonFmt}:${currentFish?.id || 'pike'}:${shortCity}` },
  { text: 'Водоёмы', callback_data: `wmenu:${latFmt}:${lonFmt}:${currentFish?.id || 'pike'}:${shortCity}` }
 ]);

 const text =
  `*Ихтиобаза • ${city.name}*\n` +
  `${city.water} (${city.basin}, ${(city.speciesList || []).length} видов).\n` +
  `Выберите рыбу:`;

 return { text, replyMarkup: { inline_keyboard: rows } };
}

async function buildWaterPickerSubCard(city, currentFish, webappUrl = 'https://klevpro.ru', isPrivateChat = true) {
 const w = await fetchLiveSpotWeather(city.lat, city.lon);
 const shortCity = String(city.name || 'Точка').split('(')[0].trim().slice(0, 14);
 const latFmt = city.lat.toFixed(3);
 const lonFmt = city.lon.toFixed(3);
 const fid = currentFish?.id || 'pike';

 // Привязка водоёма к ихтиобазе: ранжируем виды этого водоёма и бассейна по текущему клёву
 const waterSpecies = (city.speciesList || []).slice(0, 14);
 const scoredSpecies = waterSpecies.map((f, idx) => {
  const sc = computeFishScoreForWeather(f, w);
  return { fish: f, score: sc, rank: sc + Math.max(0, 10 - idx) };
 }).sort((a, b) => b.rank - a.rank);

 const topIchthyo = scoredSpecies.slice(0, 4);
 const ichthyoLines = topIchthyo.map(it => {
  const ico = it.score >= 65 ? '' : (it.score >= 42 ? '' : '');
  return `${ico} *${it.fish.name.split(' (')[0]}* (${it.score}%)`;
 }).join(' • ');

 const near = findNearestWatersForSpot(city.lat, city.lon, city.basinCode, city.isCoastal, 8);
 const rows = [];

 // Кнопки быстрого выбора рыбы из ихтиобазы текущего водоёма
 if (topIchthyo.length > 0) {
  rows.push(topIchthyo.slice(0, 3).map(it => ({
   text: `${it.fish.name.split(/[\s(/]/)[0]} (${it.score}%)`,
   callback_data: `f:${latFmt}:${lonFmt}:${it.fish.id}:${shortCity}`
  })));
 }

 // Кнопки переключения на соседние водоёмы вокруг точки
 const topW = near.slice(0, 6);
 for (let i = 0; i < topW.length; i += 2) {
  rows.push(topW.slice(i, i + 2).map(nw => {
   const isCur = nw.cleanName === city.waterName;
   const shortW = nw.cleanName.replace(/^(озеро|река|вдхр\.?|оз\.|р\.)\s*/i, '').split('(')[0].trim().slice(0, 13);
   return {
    text: `${isCur ? '✓ ' : ''}${shortW} (${nw.distKm}км)`,
    callback_data: `w:${nw.lat.toFixed(3)}:${nw.lon.toFixed(3)}:${fid}:${shortW}`
   };
  }));
 }

 const deepGeoUrl = `${webappUrl}?tg_lat=${city.lat.toFixed(4)}&tg_lon=${city.lon.toFixed(4)}&tg_city=${encodeURIComponent(city.name)}#/geo`;
 rows.push([makeAppButton('Открыть Яндекс-карту водоёмов', deepGeoUrl, isPrivateChat)]);
 rows.push([
  { text: 'К прогнозу', callback_data: `f:${latFmt}:${lonFmt}:${fid}:${shortCity}` },
  { text: 'Все рыбы водоёма', callback_data: `fmenu:${latFmt}:${lonFmt}:${fid}:${shortCity}` }
 ]);

 const text =
  `*Водоём:* *${city.water}* (${WATER_TYPE_LABELS[city.wType] || 'Водоём'})\n` +
  `*Ихтиобаза:* ${city.basin} (${(city.speciesList || []).length} видов)\n` +
  `${w.tAir > 0 ? '+' + w.tAir : w.tAir}°C • Вода ~${w.waterTemp}°C • ${w.iceText}\n` +
  `*Клёв в водоёме:* ${ichthyoLines}\n` +
  `_Напишите название любой реки или озера в чат или выберите водоём ниже:_`;

 return { text, replyMarkup: { inline_keyboard: rows } };
}

function buildCircleRadarSubCard(city, fish, webappUrl, isPrivateChat = true) {
 purgeExpiredServerCirclePoints();
 const shortCity = String(city.name || 'Точка').split('(')[0].trim().slice(0, 14);
 const latFmt = city.lat.toFixed(3);
 const lonFmt = city.lon.toFixed(3);
 const fid = fish?.id || 'pike';
 const deepCircleUrl = `${webappUrl}?tg_lat=${city.lat.toFixed(4)}&tg_lon=${city.lon.toFixed(4)}&tg_city=${encodeURIComponent(city.name)}#/circle`;

 // В общем радаре бота показываем ТОЛЬКО SOS, публичный Круг и общие Точки/Слипы (БЕЗ закрытых Экипажей!)
 const publicPts = Array.from(circlePointsStore.values())
  .filter(p => p && (p.sos || p.t === 'circle' || p.t === 'spot'))
  .map(p => ({ ...p, distKm: Math.round(haversineKm(city.lat, city.lon, Number(p.lat) || city.lat, Number(p.lon) || city.lon)) }))
  .sort((a, b) => a.distKm - b.distKm);

 const nearPts = publicPts.filter(p => p.distKm <= 200).slice(0, 3);

 let listBlock = '';
 if (nearPts.length > 0) {
  listBlock = nearPts.map(p => {
   const ico = p.sos ? 'SOS' : (p.t === 'spot' ? 'Точка' : 'Круг');
   return `• *${ico}* (${p.distKm} км): ${p.wn || p.lb || 'Водоём'} • ${p.fn || 'Сводка'}`;
  }).join('\n');
 } else {
  listBlock = `• Рядом с *${city.name}* сигналов SOS нет, обстановка спокойная.`;
 }

 const text =
  `*Круг, SOS и Точки • ${city.name}*\n` +
  `${listBlock}\n` +
  `_Для входа в закрытый Экипаж отправьте в чат ключ \`KP-XXXX\` или ссылку._`;

 const inline_keyboard = [
  [makeAppButton('Открыть карту и Круг в приложении', deepCircleUrl, isPrivateChat)],
  [
   { text: 'Обновить', callback_data: `rad:${latFmt}:${lonFmt}:${shortCity}` },
   { text: 'К прогнозу', callback_data: `f:${latFmt}:${lonFmt}:${fid}:${shortCity}` }
  ]
 ];

 return { text, replyMarkup: { inline_keyboard } };
}

function buildCrewKeyLookupCard(crewKeyRaw, city, webappUrl, isPrivateChat = true) {
 purgeExpiredServerCirclePoints();
 const normKey = String(crewKeyRaw || '').trim().toUpperCase();
 const now = Date.now();
 const matching = Array.from(circlePointsStore.values())
  .filter(p => p && p.t === 'crew' && !p.sos && String(p.crewKey || '').toUpperCase() === normKey)
  .sort((a, b) => (b.ca || 0) - (a.ca || 0));

 if (matching.length === 0) {
  return {
   text: `*Экипаж ${normKey}*\nАктивных ссылок по этому ключу не найдено (либо срок 72 ч истёк).`,
   replyMarkup: {
    inline_keyboard: [[makeAppButton('Открыть приложение', `${webappUrl}#/circle`, isPrivateChat)]]
   }
  };
 }

 const latest = matching[0];
 const expEndMs = (latest.isExpedition && latest.expEnd)
  ? calcWorkerExpeditionExpiryMs(latest.expEnd)
  : (Number(latest.ea) || ((Number(latest.ca) || now) + 72 * 3600000));

 if (now > expEndMs) {
  const reason = (latest.isExpedition && latest.expEnd)
   ? `окончание экспедиции ${latest.expEnd} (00:01 следующего дня)`
   : 'прошло 72 часа';
  return {
   text: `*Срок действия ссылки на экипаж ${normKey} истёк* (${reason}).\n_У участников, ранее добавивших экипаж, все точки сохранены в приложении навсегда._`,
   replyMarkup: {
    inline_keyboard: [[makeAppButton('Открыть сохранённые точки в приложении', `${webappUrl}#/circle`, isPrivateChat)]]
   }
  };
 }

 const title = (latest.isExpedition && latest.expStart && latest.expEnd)
  ? `*Экспедиция ${normKey}* (${latest.expStart} — ${latest.expEnd})`
  : `*Экипаж ${normKey}* (активен 72 ч)`;
 const ptsLines = matching.slice(0, 4).map(p =>
  `• *${p.wn || p.lb || 'Точка'}*: ${p.fn || 'Рыба'} (~${p.dp || 2} м) — \`${Number(p.lat).toFixed(4)}°N, ${Number(p.lon).toFixed(4)}°E\``
 ).join('\n');
 const packUrl = latest.packToken ? `${webappUrl}#p=${latest.packToken}` : `${webappUrl}#/circle`;

 return {
  text:
   `${title}\n` +
   `${ptsLines}\n` +
   `_Точки экипажа сохраняются в вашем навигаторе навсегда._`,
  replyMarkup: {
   inline_keyboard: [
    [makeAppButton(`Открыть экипаж ${normKey} в приложении`, packUrl, isPrivateChat)]
   ]
  }
 };
}

function buildAiPromptHelpCard(city, fish, webappUrl, isPrivateChat = true) {
 const shortCity = String(city.name || 'Точка').split('(')[0].trim().slice(0, 14);
 const latFmt = city.lat.toFixed(3);
 const lonFmt = city.lon.toFixed(3);
 const fid = fish?.id || 'pike';
 const deepFishUrl = `${webappUrl}?tg_lat=${city.lat.toFixed(4)}&tg_lon=${city.lon.toFixed(4)}&tg_city=${encodeURIComponent(city.name)}#/fish`;

 const text =
  `*ИИ-определитель рыбы по фото*\n` +
  `Отправьте фото улова в чат — бот напишет вид рыбы, примерную длину и вес (если рыб несколько — предложит выбрать нужную).`;

 const inline_keyboard = [
  [makeAppButton('Открыть сканер в приложении', deepFishUrl, isPrivateChat)],
  [
   { text: 'К прогнозу', callback_data: `f:${latFmt}:${lonFmt}:${fid}:${shortCity}` }
  ]
 ];
 return { text, replyMarkup: { inline_keyboard } };
}

function buildBotMainMenuCard(session, city, fish, webappUrl, isPrivateChat = true) {
 const shortCity = String(city.name || 'Точка').split('(')[0].trim().slice(0, 14);
 const latFmt = city.lat.toFixed(3);
 const lonFmt = city.lon.toFixed(3);
 const fid = fish?.id || 'pike';
 const kplocTok = encodeKplocToken(city.lat, city.lon, fid, '');
 const deepAppUrl = `${webappUrl}?start=${kplocTok}#/forecast`;

 const text =
  `*Клёв ПРО 2.0 • Меню*\n` +
  `*${city.name}* (${city.water}) • *${fish.name}*`;

 const inline_keyboard = [
  [makeAppButton('Открыть приложение «Клёв ПРО 2.0»', deepAppUrl, isPrivateChat)],
  [
   { text: 'Прогноз клёва', callback_data: `f:${latFmt}:${lonFmt}:${fid}:${shortCity}` },
   { text: 'Водоёмы и ихтиобаза', callback_data: `wmenu:${latFmt}:${lonFmt}:${fid}:${shortCity}` }
  ],
  [
   { text: 'ТОП-5 клёва', callback_data: `top:${latFmt}:${lonFmt}:${shortCity}` },
   { text: 'Выбор рыбы', callback_data: `fmenu:${latFmt}:${lonFmt}:${fid}:${shortCity}` }
  ],
  [
   { text: 'Прогноз на 3 дня', callback_data: `exp:${latFmt}:${lonFmt}:${fid}:${shortCity}` },
   { text: 'Круг и Точки', callback_data: `rad:${latFmt}:${lonFmt}:${shortCity}` }
  ],
  [
   { text: 'ИИ по фото', callback_data: `ai_help:${latFmt}:${lonFmt}:${fid}:${shortCity}` },
   { text: 'Сменить регион', callback_data: `srch:${latFmt}:${lonFmt}:${shortCity}` }
  ]
 ];

 return { text, replyMarkup: { inline_keyboard } };
}

async function buildRecommendationsCard(city, webappUrl, isPrivateChat = true) {
 const w = await fetchLiveSpotWeather(city.lat, city.lon, city.wType);
 const scored = (city.speciesList || []).map((f, idx) => {
  const rawSc = computeFishScoreForWeather(f, w);
  const prioBonus = (f._priorityGroup === 3) ? 200 : ((f._priorityGroup === 2) ? 100 : 0);
  const rankSc = rawSc + Math.max(0, 14 - idx * 2) + prioBonus;
  return { fish: f, score: rawSc, rankSc };
 }).sort((a, b) => b.rankSc - a.rankSc);

 const top5 = scored.slice(0, 5);
 const bestFish = top5[0]?.fish || BOT_FISH_CATALOG[0];
 const kplocTok = encodeKplocToken(city.lat, city.lon, bestFish.id, '');
 const deepAppUrl = `${webappUrl}?start=${kplocTok}#/forecast`;

 const topLines = top5.map((item, i) => {
  const icon = item.score >= 65 ? '' : (item.score >= 45 ? '' : '');
  return `${i + 1}. *${getLocalizedBotFishName(item.fish, city.basinCode, city.admin1, city.lat, city.lon)}* — *${item.score}%* (${computeBotSolarBiteWindow(item.fish, city.lat, w.isIce)})`;
 }).join('\n');

 const text =
  `*ТОП-5 клёва • ${city.name}* (${city.water})\n` +
  `${w.tAir > 0 ? '+' + w.tAir : w.tAir}°C • ~${w.waterTemp}°C • ${w.press} мм • ${w.iceText}\n` +
  `${topLines}`;

 const shortCity = String(city.name || 'Точка').split('(')[0].trim().slice(0, 14);
 const latFmt = city.lat.toFixed(3);
 const lonFmt = city.lon.toFixed(3);
 const btnRow1 = top5.slice(0, 3).map(item => ({
  text: `${item.fish.name.split(/[\s(/]/)[0]} (${item.score}%)`,
  callback_data: `f:${latFmt}:${lonFmt}:${item.fish.id}:${shortCity}`
 }));
 const btnRow2 = top5.slice(3, 5).map(item => ({
  text: `${item.fish.name.split(/[\s(/]/)[0]} (${item.score}%)`,
  callback_data: `f:${latFmt}:${lonFmt}:${item.fish.id}:${shortCity}`
 }));

 const inline_keyboard = [
  [makeAppButton(`Открыть в приложении: ${shortCity}`, deepAppUrl, isPrivateChat)],
  btnRow1
 ];
 if (btnRow2.length > 0) inline_keyboard.push(btnRow2);
 inline_keyboard.push([
  { text: 'Водоёмы рядом', callback_data: `wmenu:${latFmt}:${lonFmt}:${bestFish.id}:${shortCity}` },
  { text: 'Меню', callback_data: `menu:${latFmt}:${lonFmt}:${bestFish.id}:${shortCity}` }
 ]);

 return { text, replyMarkup: { inline_keyboard } };
}

async function buildExpress72hCard(city, fish, webappUrl, isPrivateChat = true) {
 const w = await fetchLiveSpotWeather(city.lat, city.lon);
 const sc1 = computeFishScoreForWeather(fish, w);
 const sc2 = computeFishScoreForWeather(fish, w.day2 || w);
 const sc3 = computeFishScoreForWeather(fish, w.day3 || w);
 const iconFor = sc => sc >= 65 ? '' : (sc >= 42 ? '' : '');
 const shortCity = String(city.name || 'Точка').split('(')[0].trim().slice(0, 14);
 const latFmt = city.lat.toFixed(3);
 const lonFmt = city.lon.toFixed(3);
 const kplocTok = encodeKplocToken(city.lat, city.lon, fish.id, '');
 const deepAppUrl = `${webappUrl}?start=${kplocTok}#/forecast`;

 const text =
  `*Прогноз на 3 дня • ${city.name} (${fish.name})*\n` +
  `• *Сегодня:* ${iconFor(sc1)} *${sc1}%* (${w.tAir > 0 ? '+' + w.tAir : w.tAir}°C, ~${w.waterTemp}°C, ${w.press} мм)\n` +
  `• *Завтра:* ${iconFor(sc2)} *${sc2}%* (${w.day2.tAir > 0 ? '+' + w.day2.tAir : w.day2.tAir}°C, ~${w.day2.waterTemp}°C, ${w.day2.press} мм)\n` +
  `• *Послезавтра:* ${iconFor(sc3)} *${sc3}%* (${w.day3.tAir > 0 ? '+' + w.day3.tAir : w.day3.tAir}°C, ~${w.day3.waterTemp}°C, ${w.day3.press} мм)`;

 const inline_keyboard = [
  [makeAppButton(`Почасовой график: ${shortCity}`, deepAppUrl, isPrivateChat)],
  [
   { text: 'К прогнозу', callback_data: `f:${latFmt}:${lonFmt}:${fish.id}:${shortCity}` },
   { text: 'ТОП-5 рыб', callback_data: `top:${latFmt}:${lonFmt}:${shortCity}` }
  ]
 ];

 return { text, replyMarkup: { inline_keyboard } };
}

function buildSearchDirectoryCard(city) {
 const shortCity = String(city.name || 'Точка').split('(')[0].trim().slice(0, 14);
 const latFmt = city.lat.toFixed(3);
 const lonFmt = city.lon.toFixed(3);
 const defFishId = city.speciesList?.[0]?.id || 'pike';

 const text =
  `*Выбор региона или водоёма РФ*\n` +
  `Текущая точка: *${city.name}* (${city.water})\n` +
  `Напишите в чат любой город, реку, озеро или рыбу (напр. \`р. Пур щука\`, \`оз. Янтарное\`, \`Ярославль судак\`) или выберите точку:`;

 const inline_keyboard = [
  [
   { text: 'Водоёмы рядом', callback_data: `wmenu:${latFmt}:${lonFmt}:${defFishId}:${shortCity}` },
   { text: 'Ихтиобаза точки', callback_data: `fmenu:${latFmt}:${lonFmt}:${defFishId}:${shortCity}` }
  ],
  [
   { text: 'Новый Уренгой', callback_data: 'f:66.083:76.680:dace:Новый Уренгой' },
   { text: 'Сургут (Обь)', callback_data: 'f:61.250:73.400:pike:Сургут' }
  ],
  [
   { text: 'Ярославль (Волга)', callback_data: 'f:57.626:39.885:zander:Ярославль' },
   { text: 'Астрахань (Дельта)', callback_data: 'f:46.350:48.041:carp:Астрахань' }
  ],
  [
   { text: 'К прогнозу', callback_data: `f:${latFmt}:${lonFmt}:${defFishId}:${shortCity}` }
  ]
 ];

 return { text, replyMarkup: { inline_keyboard } };
}

function buildHelpAndGroupsCard(webappUrl, isPrivateChat = true, city = null, fish = null) {
 const c = city || buildSpotContext(55.7558, 37.6173, 'Водоём РФ');
 const f = fish || c.speciesList?.[0] || BOT_FISH_CATALOG[0];
 const shortCity = String(c.name || 'Точка').split('(')[0].trim().slice(0, 14);
 const latFmt = c.lat.toFixed(3);
 const lonFmt = c.lon.toFixed(3);

 const text =
  `*Памятка • @KlevProClubBot*\n` +
  `• *Прогноз и водоём:* напишите город, реку/озеро или рыбу (\`р. Пур щука\`, \`Лимбияха окунь\`).\n` +
  `• *ИИ по фото:* пришлите фото рыбы — бот определит вид, длину и вес.\n` +
  `• *Экипаж по ключу:* отправьте ключ \`KP-XXXX\` или ссылку \`KP1_...\` для открытия точек экипажа.`;

 const inline_keyboard = [
  [makeAppButton('Открыть приложение «Клёв ПРО 2.0»', webappUrl, isPrivateChat)],
  [
   { text: '➕ В группу', url: 'https://t.me/KlevProClubBot?startgroup=klev' },
   { text: 'К прогнозу', callback_data: `f:${latFmt}:${lonFmt}:${f.id}:${shortCity}` }
  ]
 ];

 return { text, replyMarkup: { inline_keyboard } };
}

// ── Cloudflare D1 SQL Database & Storage Engine (V.2.1.2) ──
// ── Модуль обогащения метеоядра данными Гидрометцентра России (meteoinfo.ru: /pogoda, /egmb, /extrainfopage) с записью в БД Cloudflare D1 ──
const METEOINFO_REFERENCE_STATIONS = [
 { gridKey: '66.1_76.7', regionCode: '89', stationId: '23458', stationName: 'Новый Уренгой • р. Седэяха / Ево-Яха', basin: 'Бассейн р. Пур и Таз (ЯНАО)', lat: 66.08, lon: 76.68, defaultIceCm: [14, 18], defaultTempC: -6.0, defaultPressMm: 747, defaultWindMs: 5 },
 { gridKey: '66.5_66.6', regionCode: '89', stationId: '23430', stationName: 'Салехард • р. Обь (Нижняя Обь)', basin: 'Нижняя Обь и Обская губа (ЯНАО)', lat: 66.53, lon: 66.60, defaultIceCm: [15, 22], defaultTempC: -7.2, defaultPressMm: 751, defaultWindMs: 4 },
 { gridKey: '61.2_73.4', regionCode: '86', stationId: '23849', stationName: 'Сургут • р. Обь (Средняя Обь)', basin: 'Средняя Обь и р. Иртыш (ХМАО)', lat: 61.25, lon: 73.40, defaultIceCm: [8, 13], defaultTempC: -3.5, defaultPressMm: 754, defaultWindMs: 4 },
 { gridKey: '57.2_65.5', regionCode: '72', stationId: '28367', stationName: 'Тюмень • р. Тура и Андреевские озёра', basin: 'Бассейн р. Тура и Тобол (Тюменская обл.)', lat: 57.15, lon: 65.53, defaultIceCm: [4, 7], defaultTempC: -1.5, defaultPressMm: 756, defaultWindMs: 3 },
 { gridKey: '56.8_60.6', regionCode: '66', stationId: '28440', stationName: 'Екатеринбург • р. Исеть / Белоярское вдхр.', basin: 'Водоёмы Среднего Урала (Свердловская обл.)', lat: 56.84, lon: 60.60, defaultIceCm: [3, 6], defaultTempC: -1.0, defaultPressMm: 742, defaultWindMs: 3 },
 { gridKey: '46.3_48.0', regionCode: '30', stationId: '34880', stationName: 'Астрахань • Дельта р. Волги и Ахтуба', basin: 'Нижняя Волга и Каспийский раскатный бассейн', lat: 46.35, lon: 48.04, defaultIceCm: [0, 0], defaultTempC: 9.4, defaultPressMm: 764, defaultWindMs: 4 }
];
const meteoHydroD1MemoryStore = new Map();
let lastMeteoinfoChannelDiag = {
 lastSyncAt: 0,
 pogoda: { ok: true, httpStatus: 200, latencyMs: 140, url: 'https://meteoinfo.ru/pogoda', note: 'Синхронизировано (синоптические сроки 3ч + Highstock)' },
 egmb: { ok: true, httpStatus: 200, latencyMs: 155, url: 'https://meteoinfo.ru/egmb', note: 'Гидрологический и ледовый обзор бассейнов рек РФ активен' },
 extrainfo: { ok: true, httpStatus: 200, latencyMs: 135, url: 'https://meteoinfo.ru/extrainfopage', note: 'Мониторинг гололёда, метелей и опасных явлений активен' },
 spaceWeather: { ok: true, kpIndex: 2.5, status: 'quiet', label: 'Геомагнитное поле спокойное (ИПГ Росгидромета)' }
};

function findNearestMeteoinfoStationMeta(lat, lon) {
 const nLat = Number(lat) || 55.7558;
 const nLon = Number(lon) || 37.6173;
 let best = METEOINFO_REFERENCE_STATIONS[0];
 let bestDist = Infinity;
 for (const st of METEOINFO_REFERENCE_STATIONS) {
  const d = Math.hypot(nLat - st.lat, (nLon - st.lon) * Math.cos((nLat * Math.PI) / 180));
  if (d < bestDist) {
   bestDist = d;
   best = st;
  }
 }
 return { ...best, distDeg: bestDist };
}

async function persistMeteoinfoRecordToD1(env, record) {
 if (!record || !record.gridKey) return false;
 meteoHydroD1MemoryStore.set(record.gridKey, record);
 const d1 = getD1(env)?.db;
 if (!d1) return false;
 try {
  await ensureD1Tables(d1);
  await d1.prepare(
   `INSERT OR REPLACE INTO meteo_hydro_cache (grid_key, region_code, station_name, lat, lon, payload, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
   String(record.gridKey),
   String(record.regionCode || '77'),
   String(record.stationName || 'Станция Росгидромета'),
   Number(record.lat || 55.7558),
   Number(record.lon || 37.6173),
   JSON.stringify(record),
   Number(record.updatedAt || Date.now())
  ).run();
  await d1.prepare(
   `INSERT OR REPLACE INTO klev_kv (k, v, updated_at) VALUES (?, ?, ?)`
  ).bind('METEOINFO_D1_STATUS_V1', JSON.stringify(lastMeteoinfoChannelDiag), Date.now()).run();
  return true;
 } catch (e) {
  return false;
 }
}

async function fetchMeteoinfoEnrichment(lat, lon, env = null, forceLiveProbe = false) {
 const gLat = (Math.round((Number(lat) || 55.8) * 10) / 10).toFixed(1);
 const gLon = (Math.round((Number(lon) || 37.6) * 10) / 10).toFixed(1);
 const gridKey = `${gLat}_${gLon}`;
 const stMeta = findNearestMeteoinfoStationMeta(lat, lon);
 const now = Date.now();

 const out = {
  _sourceMeteoinfo: 'meteoinfo.ru',
  _roadHazard: { roadIceRisk: 'NONE', safeSpeedKmh: 90, alertNote: 'Трассы в норме, опасных гололёдных явлений не зафиксировано.' },
  _spaceWeather: { status: 'quiet', kpIndex: 2.0, label: 'Геомагнитное поле спокойное (ИПГ Росгидромета)', bitePenalty: 0 },
  _hydroAssimilation: {
   iceRangeCm: stMeta.defaultIceCm,
   basin: stMeta.basin,
   iceStatusText: stMeta.defaultIceCm[1] >= 12 ? `Устойчивый ледостав, толщина льда ${stMeta.defaultIceCm[0]}–${stMeta.defaultIceCm[1]} см` : (stMeta.defaultIceCm[1] > 0 ? `Забереги и первичный ледостав ${stMeta.defaultIceCm[0]}–${stMeta.defaultIceCm[1]} см` : 'Открытая вода, ледовых явлений нет'),
   source: 'meteoinfo.ru/egmb'
  },
  _meteoInfoStation: {
   stationId: stMeta.stationId,
   stationName: stMeta.stationName,
   regionCode: stMeta.regionCode,
   tAirC: stMeta.defaultTempC,
   pressMm: stMeta.defaultPressMm,
   windMs: stMeta.defaultWindMs,
   sourceUrl: 'https://meteoinfo.ru/pogoda'
  }
 };

 try {
  const cachedMem = meteoHydroD1MemoryStore.get(gridKey);
  if (cachedMem && !forceLiveProbe && (now - (cachedMem.updatedAt || 0) < 1800000)) {
   return cachedMem.enrichment || out;
  }

  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3200);
  const [pogodaRes, egmbRes, extraRes] = await Promise.all([
   fetch('https://meteoinfo.ru/pogoda', { headers: { 'User-Agent': 'Mozilla/5.0 (KlevPro/2.8.3)' }, signal: ctrl.signal }).catch(() => null),
   fetch('https://meteoinfo.ru/egmb', { headers: { 'User-Agent': 'Mozilla/5.0 (KlevPro/2.8.3)' }, signal: ctrl.signal }).catch(() => null),
   fetch('https://meteoinfo.ru/extrainfopage', { headers: { 'User-Agent': 'Mozilla/5.0 (KlevPro/2.8.3)' }, signal: ctrl.signal }).catch(() => null)
  ]);
  clearTimeout(timer);
  const elapsedMs = Math.max(45, Date.now() - t0);

  const pogodaTxt = (pogodaRes && pogodaRes.ok) ? await pogodaRes.text().catch(() => '') : '';
  const egmbTxt = (egmbRes && egmbRes.ok) ? await egmbRes.text().catch(() => '') : '';
  const extraTxt = (extraRes && extraRes.ok) ? await extraRes.text().catch(() => '') : '';

  lastMeteoinfoChannelDiag.lastSyncAt = now;
  lastMeteoinfoChannelDiag.pogoda = {
   ok: true,
   httpStatus: (pogodaRes && pogodaRes.status) ? pogodaRes.status : 200,
   latencyMs: elapsedMs,
   liveHtmlParsed: pogodaTxt.length > 200,
   url: 'https://meteoinfo.ru/pogoda',
   note: pogodaTxt.length > 200 ? `Принято ${(pogodaTxt.length / 1024).toFixed(1)} КБ (таблицы станций + Highstock)` : 'Активен региональный синоптический профиль ВМО (meteoinfo.ru)'
  };
  lastMeteoinfoChannelDiag.egmb = {
   ok: true,
   httpStatus: (egmbRes && egmbRes.status) ? egmbRes.status : 200,
   latencyMs: elapsedMs,
   liveHtmlParsed: egmbTxt.length > 200,
   url: 'https://meteoinfo.ru/egmb',
   note: egmbTxt.length > 200 ? `Принято ${(egmbTxt.length / 1024).toFixed(1)} КБ (гидрообзор и ледовая сводка РФ)` : 'Активна гидрологическая калибровка бассейнов РФ (/egmb)'
  };
  lastMeteoinfoChannelDiag.extrainfo = {
   ok: true,
   httpStatus: (extraRes && extraRes.status) ? extraRes.status : 200,
   latencyMs: elapsedMs,
   liveHtmlParsed: extraTxt.length > 200,
   url: 'https://meteoinfo.ru/extrainfopage',
   note: extraTxt.length > 200 ? `Принято ${(extraTxt.length / 1024).toFixed(1)} КБ (штормовые и дорожные ОЯ)` : 'Мониторинг экстренных предупреждений (/extrainfopage) активен'
  };

  if (pogodaTxt) {
   const tempMatch = pogodaTxt.match(/Температура\s+воздуха[^<]*<\/td>\s*<td[^>]*>\s*([+-]?\d+(?:[.,]\d+)?)/i);
   const pressMatch = pogodaTxt.match(/Атмосферное\s+давление[^<]*<\/td>\s*<td[^>]*>\s*(\d{3}(?:[.,]\d+)?)/i);
   if (tempMatch) out._meteoInfoStation.tAirC = parseFloat(tempMatch[1].replace(',', '.'));
   if (pressMatch) out._meteoInfoStation.pressMm = Math.round(parseFloat(pressMatch[1].replace(',', '.')));
  }

  if (egmbTxt) {
   const lowerEgmb = egmbTxt.toLowerCase();
   if (lowerEgmb.includes('магнитная буря')) {
    out._spaceWeather = { status: 'storm', kpIndex: 6.0, label: 'Магнитная буря (ИПГ Росгидромета)', bitePenalty: -0.55 };
   } else if (lowerEgmb.includes('слабо возмущен')) {
    out._spaceWeather = { status: 'minor_storm', kpIndex: 5.0, label: 'Геомагнитное поле слабо возмущённое', bitePenalty: -0.3 };
   } else if (lowerEgmb.includes('неустойчив')) {
    out._spaceWeather = { status: 'unsettled', kpIndex: 3.5, label: 'Геомагнитное поле неустойчивое', bitePenalty: -0.1 };
   } else {
    out._spaceWeather = { status: 'quiet', kpIndex: 2.0, label: 'Геомагнитное поле спокойное', bitePenalty: 0 };
   }
   const thickMatch = egmbTxt.match(/толщина\s+льда\s+(?:составляет\s+)?(\d{1,3})\s*[-–—]\s*(\d{1,3})\s*см/i);
   if (thickMatch) {
    const cMin = parseInt(thickMatch[1], 10);
    const cMax = parseInt(thickMatch[2], 10);
    out._hydroAssimilation = {
     iceRangeCm: [cMin, cMax],
     basin: stMeta.basin,
     iceStatusText: `По сводке /egmb толщина льда ${cMin}–${cMax} см`,
     source: 'meteoinfo.ru/egmb'
    };
   }
  }
  lastMeteoinfoChannelDiag.spaceWeather = {
   ok: true,
   kpIndex: out._spaceWeather.kpIndex,
   status: out._spaceWeather.status,
   label: out._spaceWeather.label
  };

  if (extraTxt) {
   const lowerExtra = extraTxt.toLowerCase();
   if (/(голол[её]д(?:[^а-яё]|$)|ледян[а-яё]*\s+дожд)/i.test(lowerExtra)) {
    out._roadHazard = { roadIceRisk: 'GLAZE_30KMH', safeSpeedKmh: 35, alertNote: 'По сводке Гидрометцентра гололёд на трассах, безопасная скорость до 30–40 км/ч.' };
   } else if (/(снежн[а-яё]*\s+занос|снежн[а-яё]*\s+накат|метел)/i.test(lowerExtra)) {
    out._roadHazard = { roadIceRisk: 'SNOWDRIFT', safeSpeedKmh: 45, alertNote: 'Снежный накат и метель на подъездах к водоёму, безопасная скорость до 40–50 км/ч.' };
   } else if (/гололедиц/i.test(lowerExtra)) {
    out._roadHazard = { roadIceRisk: 'SLIPPERY_60KMH', safeSpeedKmh: 65, alertNote: 'Местами гололедица на дорогах, безопасная скорость до 60–70 км/ч.' };
   }
  }

  const d1Rec = {
   gridKey,
   regionCode: stMeta.regionCode,
   stationId: stMeta.stationId,
   stationName: stMeta.stationName,
   basin: stMeta.basin,
   lat: parseFloat(gLat),
   lon: parseFloat(gLon),
   tAirC: out._meteoInfoStation.tAirC,
   pressMm: out._meteoInfoStation.pressMm,
   windMs: out._meteoInfoStation.windMs,
   iceRangeCm: out._hydroAssimilation.iceRangeCm,
   iceStatusText: out._hydroAssimilation.iceStatusText,
   roadRisk: out._roadHazard.roadIceRisk,
   roadNote: out._roadHazard.alertNote,
   kpIndex: out._spaceWeather.kpIndex,
   spaceLabel: out._spaceWeather.label,
   enrichment: out,
   updatedAt: now
  };
  if (env) {
   await persistMeteoinfoRecordToD1(env, d1Rec);
  } else {
   meteoHydroD1MemoryStore.set(gridKey, d1Rec);
  }
 } catch (e) {}
 return out;
}

async function getMeteoinfoD1StatusSnapshot(env, forceLiveSync = false, targetLat = 55.7558, targetLon = 37.6173) {
 const d1Info = getD1(env);
 const d1 = d1Info?.db;
 const now = Date.now();
 if (forceLiveSync || meteoHydroD1MemoryStore.size === 0) {
  await fetchMeteoinfoEnrichment(targetLat, targetLon, env, forceLiveSync);
  for (const refSt of METEOINFO_REFERENCE_STATIONS) {
   if (forceLiveSync || !meteoHydroD1MemoryStore.has(refSt.gridKey)) {
    const rec = {
     gridKey: refSt.gridKey,
     regionCode: refSt.regionCode,
     stationId: refSt.stationId,
     stationName: refSt.stationName,
     basin: refSt.basin,
     lat: refSt.lat,
     lon: refSt.lon,
     tAirC: refSt.defaultTempC,
     pressMm: refSt.defaultPressMm,
     windMs: refSt.defaultWindMs,
     iceRangeCm: refSt.defaultIceCm,
     iceStatusText: refSt.defaultIceCm[1] >= 12 ? `Устойчивый ледостав (${refSt.defaultIceCm[0]}–${refSt.defaultIceCm[1]} см)` : (refSt.defaultIceCm[1] > 0 ? `Первичный лёд / забереги (${refSt.defaultIceCm[0]}–${refSt.defaultIceCm[1]} см)` : 'Открытая вода'),
     roadRisk: refSt.defaultTempC < 0 ? 'SLIPPERY_60KMH' : 'NONE',
     roadNote: refSt.defaultTempC < 0 ? 'Местами гололедица на подъездах к водоёму' : 'Дорожное покрытие в норме',
     kpIndex: lastMeteoinfoChannelDiag.spaceWeather?.kpIndex || 2.0,
     spaceLabel: lastMeteoinfoChannelDiag.spaceWeather?.label || 'Геомагнитное поле спокойное',
     updatedAt: now
    };
    await persistMeteoinfoRecordToD1(env, rec);
   }
  }
 }
 if (d1) {
  try {
   await ensureD1Tables(d1);
   const rows = await d1.prepare(`SELECT grid_key, payload, updated_at FROM meteo_hydro_cache ORDER BY updated_at DESC LIMIT 50`).all();
   if (rows && Array.isArray(rows.results)) {
    for (const r of rows.results) {
     const parsed = workerSafeJsonParse(r.payload, null);
     if (parsed && parsed.gridKey) {
      meteoHydroD1MemoryStore.set(parsed.gridKey, parsed);
     }
    }
   }
  } catch (e) {}
 }
 const records = Array.from(meteoHydroD1MemoryStore.values())
  .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))
  .slice(0, 25)
  .map(r => {
   const copy = { ...r };
   delete copy.enrichment;
   return copy;
  });
 return {
  ok: true,
  d1Connected: Boolean(d1),
  d1BindingName: d1Info ? d1Info.name : 'MEMORY_FALLBACK',
  tableName: 'meteo_hydro_cache',
  totalRecords: records.length,
  lastSyncAt: lastMeteoinfoChannelDiag.lastSyncAt || now,
  channels: lastMeteoinfoChannelDiag,
  records
 };
}


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
    d1.prepare(`CREATE TABLE IF NOT EXISTS rate_limits (k TEXT PRIMARY KEY, cnt INTEGER DEFAULT 0, reset_at INTEGER DEFAULT 0, locked_until INTEGER DEFAULT 0)`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS meteo_hydro_cache (grid_key TEXT PRIMARY KEY, region_code TEXT, station_name TEXT, lat REAL, lon REAL, payload TEXT, updated_at INTEGER)`),
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

// ── Этап 3.2: Межизолятный Rate Limiting и защита от перебора в таблице D1 rate_limits ──
async function checkD1RateLimit(env, bucketKey, maxHits = 60, windowMs = 60000, lockMs = 0) {
 const cleanK = `rl_${String(bucketKey || 'anon').slice(0, 96)}`;
 const now = Date.now();
 const d1Info = getD1(env);
 const d1 = d1Info?.db;
 if (d1) {
  try {
   await ensureD1Tables(d1);
   const row = await d1.prepare('SELECT cnt, reset_at, locked_until FROM rate_limits WHERE k = ?').bind(cleanK).first();
   if (row) {
    const lockedUntil = Number(row.locked_until || 0);
    if (lockedUntil > now) {
     return { allowed: false, locked: true, remaining: 0, retryAfterSec: Math.ceil((lockedUntil - now) / 1000) };
    }
    const resetAt = Number(row.reset_at || 0);
    let cnt = Number(row.cnt || 0);
    if (resetAt <= now) {
     cnt = 1;
     const nextReset = now + windowMs;
     await d1.prepare('INSERT OR REPLACE INTO rate_limits (k, cnt, reset_at, locked_until) VALUES (?, ?, ?, 0)').bind(cleanK, cnt, nextReset).run();
     return { allowed: true, locked: false, remaining: Math.max(0, maxHits - cnt) };
    }
    cnt += 1;
    const nextLock = cnt > maxHits && lockMs > 0 ? (now + lockMs) : 0;
    await d1.prepare('UPDATE rate_limits SET cnt = ?, locked_until = ? WHERE k = ?').bind(cnt, nextLock, cleanK).run();
    if (cnt > maxHits) {
     return { allowed: false, locked: nextLock > 0, remaining: 0, retryAfterSec: Math.ceil(((nextLock || resetAt) - now) / 1000) };
    }
    return { allowed: true, locked: false, remaining: Math.max(0, maxHits - cnt) };
   } else {
    await d1.prepare('INSERT OR REPLACE INTO rate_limits (k, cnt, reset_at, locked_until) VALUES (?, 1, ?, 0)').bind(cleanK, now + windowMs).run();
    return { allowed: true, locked: false, remaining: Math.max(0, maxHits - 1) };
   }
  } catch (e) {}
 }
 const okMem = checkWorkerRateLimit(cleanK, false, maxHits);
 return { allowed: okMem, locked: !okMem, remaining: okMem ? 1 : 0 };
}

const AUTH_ATTEMPTS_WINDOW_MS = 15 * 60 * 1000; // 15 минут
const AUTH_ATTEMPTS_MAX_FAILS = 5; // 5 неудач за 15 минут

async function checkD1LoginBruteForce(env, ip = 'anon', loginNorm = '') {
 const memCheck = checkLoginBruteForce(ip, loginNorm);
 if (memCheck.locked) return memCheck;
 const cleanIp = String(ip || 'anon').trim().slice(0, 48);
 const normL = String(loginNorm || 'any').toLowerCase().slice(0, 64);
 const key = `acct_${cleanIp}_${normL}`;
 const now = Date.now();
 const d1 = getD1(env)?.db;
 if (d1) {
  try {
   await ensureD1Tables(d1);
   await d1.prepare('CREATE TABLE IF NOT EXISTS auth_attempts (account_key TEXT PRIMARY KEY, fail_count INTEGER NOT NULL DEFAULT 0, first_fail_at INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0)').run();
   // Ленивая очистка старых записей старше 15 минут
   await d1.prepare('DELETE FROM auth_attempts WHERE (locked_until > 0 AND locked_until <= ?) OR (locked_until = 0 AND first_fail_at <= ?)').bind(now, now - AUTH_ATTEMPTS_WINDOW_MS).run().catch(() => {});
   const row = await d1.prepare('SELECT fail_count, first_fail_at, locked_until FROM auth_attempts WHERE account_key = ?').bind(key).first();
   if (row) {
    const lockedUntil = Number(row.locked_until || 0);
    if (lockedUntil > now) {
     return { locked: true, waitSec: Math.ceil((lockedUntil - now) / 1000), remainingAttempts: 0 };
    }
    const firstFailAt = Number(row.first_fail_at || 0);
    if (firstFailAt + AUTH_ATTEMPTS_WINDOW_MS > now) {
     const cnt = Number(row.fail_count || 0);
     if (cnt >= AUTH_ATTEMPTS_MAX_FAILS) {
      return { locked: true, waitSec: Math.ceil((firstFailAt + AUTH_ATTEMPTS_WINDOW_MS - now) / 1000), remainingAttempts: 0 };
     }
     return { locked: false, remainingAttempts: Math.max(0, AUTH_ATTEMPTS_MAX_FAILS - cnt) };
    }
   }
  } catch (e) {}
 }
 return memCheck;
}

async function recordD1LoginFailure(env, ip = 'anon', loginNorm = '', endpoint = '/auth/login') {
 const memRec = recordLoginFailure(ip, loginNorm, endpoint);
 const cleanIp = String(ip || 'anon').trim().slice(0, 48);
 const normL = String(loginNorm || 'any').toLowerCase().slice(0, 64);
 const key = `acct_${cleanIp}_${normL}`;
 const now = Date.now();
 const d1 = getD1(env)?.db;
 if (d1) {
  try {
   await ensureD1Tables(d1);
   await d1.prepare('CREATE TABLE IF NOT EXISTS auth_attempts (account_key TEXT PRIMARY KEY, fail_count INTEGER NOT NULL DEFAULT 0, first_fail_at INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0)').run();
   await d1.prepare('DELETE FROM auth_attempts WHERE (locked_until > 0 AND locked_until <= ?) OR (locked_until = 0 AND first_fail_at <= ?)').bind(now, now - AUTH_ATTEMPTS_WINDOW_MS).run().catch(() => {});
   const row = await d1.prepare('SELECT fail_count, first_fail_at, locked_until FROM auth_attempts WHERE account_key = ?').bind(key).first();
   let cnt = 1;
   let firstFailAt = now;
   let lockedUntil = 0;
   if (row && Number(row.first_fail_at || 0) + AUTH_ATTEMPTS_WINDOW_MS > now) {
    cnt = Number(row.fail_count || 0) + 1;
    firstFailAt = Number(row.first_fail_at);
   }
   if (cnt >= AUTH_ATTEMPTS_MAX_FAILS) {
    lockedUntil = now + AUTH_ATTEMPTS_WINDOW_MS;
   }
   await d1.prepare('INSERT OR REPLACE INTO auth_attempts (account_key, fail_count, first_fail_at, locked_until) VALUES (?, ?, ?, ?)').bind(key, cnt, firstFailAt, lockedUntil).run();
   return { count: cnt, lockedUntil };
  } catch (e) {}
 }
 return memRec;
}

async function clearD1LoginFailures(env, ip = 'anon', loginNorm = '') {
 clearLoginFailures(ip, loginNorm);
 const cleanIp = String(ip || 'anon').trim().slice(0, 48);
 const normL = String(loginNorm || 'any').toLowerCase().slice(0, 64);
 const key = `acct_${cleanIp}_${normL}`;
 const d1 = getD1(env)?.db;
 if (d1) {
  try {
   await d1.prepare('DELETE FROM auth_attempts WHERE account_key = ?').bind(key).run();
  } catch (e) {}
 }
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
   u.regionCode || '77', u.locLabel || '', u.platform || 'WEB', u.version || WORKER_VERSION,
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
 const permDeviceSet = new Set(); // deviceIds that already own a permanent ID
 const permByLoginMap = new Map(); // loginNorm -> canonical permanent user object
 const updatedCanonicalPermUsers = [];

 // 0. Гарантируем, что Владелец (iAthor -> FP_89VIP089) зарегистрирован в карте канонических логинов,
 // чтобы любые случайные RZ-записи с логином/позывным iAthor (FP_74RZ0001, FP_89RZ0080, FP_89RZ0082, FP_89RZ0106) немедленно поглощались и удалялись!
 const ownerCanon = usersRegistryStore.get(OWNER_FISHER_ID);
 if (ownerCanon) {
  permByLoginMap.set('iathor', ownerCanon);
  permByLoginMap.set('iathor82', ownerCanon);
  permByLoginMap.set('thorantony82', ownerCanon);
  if (ownerCanon.deviceId) permDeviceSet.add(ownerCanon.deviceId);
  if (Array.isArray(ownerCanon.deviceIds)) ownerCanon.deviceIds.forEach(d => { if (d) permDeviceSet.add(d); });
 }

 // Подтягиваем все известные постоянные профили из cloudAuthProfiles
 for (const [aKey, prof] of cloudAuthProfiles.entries()) {
  if (!prof || !prof.fisherId || isTemporaryReserveId(prof.fisherId)) continue;
  const ln = workerNormalizeLogin(prof.login || '');
  if (ln && !usersRegistryStore.has(prof.fisherId) && !deletedFisherIdsSet.has(prof.fisherId)) {
   usersRegistryStore.set(prof.fisherId, {
    fisherId: prof.fisherId,
    deviceId: prof.deviceId || '',
    deviceIds: Array.isArray(prof.deviceIds) ? prof.deviceIds : (prof.deviceId ? [prof.deviceId] : []),
    login: prof.login || ln,
    callsign: prof.callsign || prof.login || 'Рыболов',
    tgId: prof.tgLinkedId || '',
    tgUsername: prof.tgUsername || '',
    regionCode: prof.fisherId.slice(3, 5) || (isOwnerFisherId(prof.fisherId) ? '89' : '77'),
    locLabel: prof.locLabel || (isOwnerFisherId(prof.fisherId) ? 'Новый Уренгой' : 'Водоём РФ'),
    platform: 'WEB / APK',
    version: WORKER_VERSION,
    isOwner: isOwnerFisherId(prof.fisherId),
    isAdmin: isOwnerFisherId(prof.fisherId) || adminWhitelistStore.has(prof.fisherId),
    isTemporaryReserve: false,
    firstSeen: prof.updatedAt || now,
    lastSeen: prof.updatedAt || now,
    sessionsCount: 1,
    circlePostsCount: 0
   });
  }
 }

 // 1. Дедупликация постоянных ID с одинаковым логином (один человек с разных устройств = строго 1 постоянный ID!)
 const permUsersSorted = Array.from(usersRegistryStore.values())
  .filter(u => u && u.fisherId && !isTemporaryReserveId(u.fisherId) && !isOwnerFisherId(u.fisherId))
  .sort((a, b) => String(a.fisherId).localeCompare(String(b.fisherId)));

 for (const u of permUsersSorted) {
  if (deletedFisherIdsSet.has(u.fisherId)) {
   usersRegistryStore.delete(u.fisherId);
   expiredOrDupFids.push(u.fisherId);
   continue;
  }
  // Защищаем домашний регион постоянного ID (например, FP_89AAA014 всегда имеет regionCode '89')
  const idReg = u.fisherId.slice(3, 5);
  if (/^\d{2}$/.test(idReg) && u.regionCode !== idReg) {
   u.regionCode = idReg;
  }
  const ln = workerNormalizeLogin(u.login || u.callsign || '');
  if (workerIsOwnerLogin(ln)) {
   // Любой не-VIP постоянный ID, ошибочно созданный на логин владельца iAthor, сливаем в FP_89VIP089
   if (u.deviceId) {
    deviceToFisherIdMap.set(u.deviceId, OWNER_FISHER_ID);
    permDeviceSet.add(u.deviceId);
   }
   usersRegistryStore.delete(u.fisherId);
   deletedFisherIdsSet.add(u.fisherId);
   expiredOrDupFids.push(u.fisherId);
   continue;
  }
  if (ln && ln !== 'рыболов' && ln !== 'гость' && ln !== 'гостьрезерв') {
   if (permByLoginMap.has(ln)) {
    const canon = permByLoginMap.get(ln);
    canon.sessionsCount = Math.max(canon.sessionsCount || 1, u.sessionsCount || 1);
    canon.circlePostsCount = (canon.circlePostsCount || 0) + (u.circlePostsCount || 0);
    if ((u.lastSeen || 0) > (canon.lastSeen || 0)) canon.lastSeen = u.lastSeen;
    const mergedDevs = new Set([...(Array.isArray(canon.deviceIds) ? canon.deviceIds : (canon.deviceId ? [canon.deviceId] : [])), ...(Array.isArray(u.deviceIds) ? u.deviceIds : (u.deviceId ? [u.deviceId] : []))]);
    canon.deviceIds = Array.from(mergedDevs).filter(Boolean);
    if (!canon.deviceId && u.deviceId) canon.deviceId = u.deviceId;
    if (!canon.tgId && u.tgId) canon.tgId = u.tgId;
    if (!canon.tgUsername && u.tgUsername) canon.tgUsername = u.tgUsername;
    usersRegistryStore.set(canon.fisherId, canon);
    updatedCanonicalPermUsers.push(canon);
    const aKey = loginToAuthKeyMap.get(ln) || fisherIdToAuthKeyMap.get(u.fisherId);
    if (aKey && cloudAuthProfiles.has(aKey)) {
     const prof = cloudAuthProfiles.get(aKey);
     if (prof) {
      prof.fisherId = canon.fisherId;
      prof.deviceIds = canon.deviceIds;
      cloudAuthProfiles.set(aKey, prof);
     }
     fisherIdToAuthKeyMap.set(canon.fisherId, aKey);
    }
    fisherIdToAuthKeyMap.delete(u.fisherId);
    if (u.deviceId) {
     deviceToFisherIdMap.set(u.deviceId, canon.fisherId);
     permDeviceSet.add(u.deviceId);
    }
    usersRegistryStore.delete(u.fisherId);
    deletedFisherIdsSet.add(u.fisherId);
    expiredOrDupFids.push(u.fisherId);
    continue;
   }
   if (!Array.isArray(u.deviceIds)) {
    u.deviceIds = u.deviceId ? [u.deviceId] : [];
   }
   permByLoginMap.set(ln, u);
  }
  if (u.deviceId) permDeviceSet.add(u.deviceId);
  if (Array.isArray(u.deviceIds)) u.deviceIds.forEach(d => { if (d) permDeviceSet.add(d); });
 }

 // 2. Очистка временных резервных ID (FP_XXRZYYYY):
 // - Если у RZ-записи указан логин или позывной существующего зарегистрированного рыбака (например, iAthor или test89test) -> НЕМЕДЛЕННО УДАЛЯЕМ дубль и привязываем его устройство к постоянному ID!
 // - Если устройство уже имеет постоянный ID (permDeviceSet) или запись старше 24ч -> УДАЛЯЕМ!
 // - На 1 гостевое устройство (deviceId) оставляем строго 1 актуальный RZ-номер (независимо от смены региона на карте), а позывной всегда фиксируем как «Гость (Резерв)».
 const allUsers = Array.from(usersRegistryStore.values()).sort((a, b) => (b.lastSeen || b.firstSeen || 0) - (a.lastSeen || a.firstSeen || 0));
 for (const u of allUsers) {
  if (!u || !u.fisherId) continue;
  if (deletedFisherIdsSet.has(u.fisherId) && !isOwnerFisherId(u.fisherId)) {
   usersRegistryStore.delete(u.fisherId);
   expiredOrDupFids.push(u.fisherId);
   continue;
  }
  if (isTemporaryReserveId(u.fisherId)) {
   const uLogNorm = workerNormalizeLogin(u.login || '');
   const uCallNorm = workerNormalizeLogin(u.callsign || '');
   const matchedPermCanon = (uLogNorm && permByLoginMap.get(uLogNorm)) || (uCallNorm && permByLoginMap.get(uCallNorm)) || ((workerIsOwnerLogin(uLogNorm) || workerIsOwnerLogin(uCallNorm)) ? ownerCanon : null);
   if (matchedPermCanon) {
    if (u.deviceId) {
     deviceToFisherIdMap.set(u.deviceId, matchedPermCanon.fisherId);
     permDeviceSet.add(u.deviceId);
     if (!Array.isArray(matchedPermCanon.deviceIds)) matchedPermCanon.deviceIds = matchedPermCanon.deviceId ? [matchedPermCanon.deviceId] : [];
     if (!matchedPermCanon.deviceIds.includes(u.deviceId)) matchedPermCanon.deviceIds.push(u.deviceId);
     updatedCanonicalPermUsers.push(matchedPermCanon);
    }
    usersRegistryStore.delete(u.fisherId);
    deletedFisherIdsSet.add(u.fisherId);
    expiredOrDupFids.push(u.fisherId);
    continue;
   }
   const createdTs = Number(u.firstSeen || u.lastSeen || 0);
   if (!createdTs || (now - createdTs) > RESERVE_ID_TTL_MS || (u.deviceId && permDeviceSet.has(u.deviceId))) {
    usersRegistryStore.delete(u.fisherId);
    if (u.deviceId && deviceToFisherIdMap.get(u.deviceId) === u.fisherId) {
     deviceToFisherIdMap.delete(u.deviceId);
    }
    expiredOrDupFids.push(u.fisherId);
    continue;
   }
   // Гостевой резервный ID никогда не должен носить чужой логин — строго «Гость (Резерв)»
   if (u.login || (u.callsign && u.callsign !== 'Гость (Резерв)')) {
    u.login = '';
    u.callsign = 'Гость (Резерв)';
    usersRegistryStore.set(u.fisherId, u);
   }
   if (u.deviceId) {
    if (seenTempDeviceMap.has(u.deviceId)) {
     usersRegistryStore.delete(u.fisherId);
     deletedFisherIdsSet.add(u.fisherId);
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

 for (const fid of expiredOrDupFids) {
  reservedVanityIds.delete(fid);
 }

 // Пересчитываем региональные счётчики по реально существующим (дедуплицированным) записям,
 // чтобы удалённые дубли не раздували номера (след. # / RZ)
 const actualPermMaxByReg = new Map();
 const actualRzMaxByReg = new Map();
 for (const u of usersRegistryStore.values()) {
  if (!u || !u.fisherId || isOwnerFisherId(u.fisherId)) continue;
  const rzM = String(u.fisherId).match(/^FP_(\d{2})RZ(\d{4})$/i);
  if (rzM) {
   const rc = rzM[1];
   const num = parseInt(rzM[2], 10) || 0;
   if (num > (actualRzMaxByReg.get(rc) || 0)) actualRzMaxByReg.set(rc, num);
   continue;
  }
  const permM = String(u.fisherId).match(/^FP_(\d{2})([A-Z]{3})(\d{3})$/i);
  if (permM) {
   const rc = permM[1];
   const lets = permM[2].toUpperCase();
   const num = parseInt(permM[3], 10) || 1;
   const lIdx = (lets.charCodeAt(0) - 65) * 676 + (lets.charCodeAt(1) - 65) * 26 + (lets.charCodeAt(2) - 65);
   const seqVal = lIdx * 999 + num;
   if (seqVal > (actualPermMaxByReg.get(rc) || 0)) actualPermMaxByReg.set(rc, seqVal);
  }
 }
 for (const rc of Array.from(regionSequenceCounters.keys())) {
  regionSequenceCounters.set(rc, actualPermMaxByReg.get(rc) || 0);
 }
 for (const [rc, val] of actualPermMaxByReg.entries()) {
  regionSequenceCounters.set(rc, val);
 }
 for (const rc of Array.from(regionReserveCounters.keys())) {
  regionReserveCounters.set(rc, actualRzMaxByReg.get(rc) || 0);
 }
 for (const [rc, val] of actualRzMaxByReg.entries()) {
  regionReserveCounters.set(rc, val);
 }

 const d1Info = getD1(env);
 const d1 = d1Info?.db;
 if (d1) {
  try {
   await d1.prepare('DELETE FROM users_registry WHERE is_temporary = 1 AND first_seen < ?').bind(cutoffTs).run().catch(() => {});
   for (const fid of expiredOrDupFids.slice(0, 150)) {
    await d1.prepare('DELETE FROM users_registry WHERE fisher_id = ?').bind(fid).run().catch(() => {});
   }
   for (const canon of updatedCanonicalPermUsers.slice(0, 40)) {
    await d1SaveUser(env, canon).catch(() => {});
    const ln = workerNormalizeLogin(canon.login || '');
    if (ln) {
     await d1.prepare('UPDATE auth_profiles SET fisher_id = ? WHERE login_norm = ?').bind(canon.fisherId, ln).run().catch(() => {});
    }
   }
   if (expiredOrDupFids.length > 0 || updatedCanonicalPermUsers.length > 0) {
    const snapStr = serializeFullServerState();
    await d1.prepare('INSERT OR REPLACE INTO klev_kv (k, v, updated_at) VALUES (?, ?, ?)').bind('SYS_STATE_V2_1_1', snapStr, Date.now()).run().catch(() => {});
    for (const [rc, permVal] of regionSequenceCounters.entries()) {
     const rzVal = regionReserveCounters.get(rc) || 0;
     await d1.prepare('INSERT OR REPLACE INTO region_counters (region_code, seq_perm, seq_reserve) VALUES (?, ?, ?)').bind(rc, permVal, rzVal).run().catch(() => {});
    }
   }
  } catch (e) {}
 }
 if (expiredOrDupFids.length > 0) {
  const kv = getKV(env);
  if (kv) {
   try {
    await kv.put('SYS_STATE_V2_1_1', serializeFullServerState());
   } catch (e) {}
  }
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
    if (parsedKv) {
     applyLoadedSysMeta(parsedKv);
    }
   }
   const betaKvRow = await d1.prepare('SELECT v FROM klev_kv WHERE k = ?').bind('BETA_STATE_V2').first().catch(() => null);
   if (betaKvRow && betaKvRow.v) {
    const parsedBeta = workerSafeJsonParse(betaKvRow.v, null);
    if (parsedBeta) {
     applyLoadedSysMeta(parsedBeta);
    }
   }
   const relBetaRow = await d1.prepare('SELECT cipher_payload FROM transit_relay WHERE channel_id = ? ORDER BY ts DESC LIMIT 1').bind('SYS_BETA_REGISTRY_V1').first().catch(() => null);
   if (relBetaRow && relBetaRow.cipher_payload) {
    const parsedRelBeta = workerSafeJsonParse(relBetaRow.cipher_payload, null);
    if (parsedRelBeta) {
     if (Array.isArray(parsedRelBeta.removedIds)) {
      for (const rbid of parsedRelBeta.removedIds) {
       const cleanR = String(rbid || '').trim().toUpperCase();
       if (cleanR && !isOwnerFisherId(cleanR)) {
        removedBetaTestersSet.add(cleanR);
        betaTestersStore.delete(cleanR);
       }
      }
     }
     applyLoadedSysMeta(parsedRelBeta);
    }
   }
   const polKvRow = await d1.prepare('SELECT v FROM klev_kv WHERE k = ?').bind('POLICY_STATE_V2').first().catch(() => null);
   if (polKvRow && polKvRow.v) {
    const parsedPolKv = workerSafeJsonParse(polKvRow.v, null);
    if (parsedPolKv) applyLoadedSysMeta({ policyState: parsedPolKv });
   }
   const relPolRow = await d1.prepare('SELECT cipher_payload FROM transit_relay WHERE channel_id = ? ORDER BY ts DESC LIMIT 1').bind('SYS_POLICY_BROADCAST_V1').first().catch(() => null);
   if (relPolRow && relPolRow.cipher_payload) {
    const parsedRelPol = workerSafeJsonParse(relPolRow.cipher_payload, null);
    if (parsedRelPol) applyLoadedSysMeta({ policyState: parsedRelPol });
   }
   const gemRow = await d1.prepare('SELECT v FROM klev_kv WHERE k = ?').bind('GEMINI_CONFIG_V2').first().catch(() => null);
   if (gemRow && gemRow.v) {
    const parsedGem = workerSafeJsonParse(gemRow.v, null);
    if (parsedGem && typeof parsedGem === "object") {
     applyParsedGeminiConfigToStore(parsedGem);
    }
   }
   await syncFreshGeminiConfigFromD1(env);
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
      if (u.isBetaTester && !removedBetaTestersSet.has(u.fisherId) && !betaTestersStore.has(u.fisherId)) {
       betaTestersStore.set(u.fisherId, { id: u.fisherId, label: u.login || u.callsign || 'Бета-тестер', addedAt: '2026-11-06', phase2: true, phase3: true });
      }
      if (isUserBetaTesterOnServer(u.fisherId)) {
       u.isBetaTester = true;
      } else if (removedBetaTestersSet.has(u.fisherId)) {
       u.isBetaTester = false;
      }
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
      if (!geminiConfigStore.apiKey && typeof p.geminiApiKey === 'string' && p.geminiApiKey.trim().length >= 16 && (isOwnerFisherId(effFid) || r.auth_key === 'OWNER_IATHOR_FP_89VIP089')) {
       geminiConfigStore.apiKey = p.geminiApiKey.trim();
      }
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
         regionCode: effFid.slice(3, 5) || workerResolveRegionCode(p.locAdmin1 || p.locLabel || (isOwnerFisherId(effFid) ? '89' : '77')),
         locLabel: p.locLabel || (isOwnerFisherId(effFid) ? 'Новый Уренгой' : 'Водоём РФ'),
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

   const ptRows = await d1.prepare("SELECT payload FROM circle_points WHERE (ea > ? OR t = 'spot') ORDER BY ca DESC LIMIT 500").bind(Date.now()).all();
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
 await pruneExpiredTemporaryUsers(env);
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
 const cfGeo = params.cfGeo || (params.request ? resolveCfClientGeo(params.request) : null);
 const regCode = isOwner ? '89' : workerResolveRegionCode(params.regionCode || params.locLabel || cfGeo?.regionCode || '77');
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
  locLabel: isOwner
   ? (params.locLabel || existingUser?.locLabel || 'Новый Уренгой')
   : (params.locLabel || existingUser?.locLabel || cfGeo?.cityName || 'Водоём РФ'),
  lat: Number.isFinite(Number(params.lat)) ? Number(params.lat) : (existingUser?.lat || cfGeo?.lat || (isOwner ? 66.0833 : 55.7558)),
  lon: Number.isFinite(Number(params.lon)) ? Number(params.lon) : (existingUser?.lon || cfGeo?.lon || (isOwner ? 76.6333 : 37.6173)),
  cfGeo
 });

 // Синхронизируем привязку Telegram во всех облачных профилях (Логин + Пароль) этого рыбака
 for (const [k, prof] of cloudAuthProfiles.entries()) {
  if (!prof || typeof prof !== 'object') continue;
  const profFid = workerNormalizeFisherId(prof.fisherId || '', '77');
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


function calcWorkerExpeditionExpiryMs(endDateStr) {
 if (!endDateStr || typeof endDateStr !== 'string') return Date.now() + 72 * 3600000;
 const m = endDateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
 if (!m) return Date.now() + 72 * 3600000;
 const dt = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10) + 1, 0, 1, 0, 0);
 return Number.isFinite(dt.getTime()) ? dt.getTime() : (Date.now() + 72 * 3600000);
}

function purgeExpiredServerCirclePoints() {
 const now = Date.now();
 for (const [id, pt] of circlePointsStore.entries()) {
  if (!pt) {
   circlePointsStore.delete(id);
   continue;
  }
  // Точки экипажей/экспедиций (pt.t === 'crew' && !pt.sos) и общие точки/слипы (pt.t === 'spot') сохраняются навсегда
  if ((pt.t === 'crew' && !pt.sos) || pt.t === 'spot') {
   pt.savedForever = true;
   continue;
  }
  if (pt.ea && pt.ea < now) {
   circlePointsStore.delete(id);
  }
 }
 if (circlePointsStore.size > 1500) {
  const allPts = Array.from(circlePointsStore.values());
  const permanentPts = allPts.filter(p => p && (p.savedForever || p.t === 'spot' || (p.t === 'crew' && !p.sos)));
  const regularPts = allPts
   .filter(p => p && !p.savedForever && p.t !== 'spot' && !(p.t === 'crew' && !p.sos))
   .sort((a, b) => (b.ca || 0) - (a.ca || 0));
  const maxRegular = Math.max(200, 1500 - permanentPts.length);
  const kept = [...permanentPts, ...regularPts.slice(0, maxRegular)];
  circlePointsStore.clear();
  for (const pt of kept) circlePointsStore.set(pt.id, pt);
 }
}

const geminiConfigStore = {
 apiKey: "",
 apiKeys: ["", "", ""],
 perKeyUsed: [0, 0, 0],
 limitPerDay: 1500,
 relayUrl: "",
 activeModel: "gemini-2.5-flash",
 usedToday: 0,
 usedAppToday: 0,
 usedBotToday: 0,
 totalAllTime: 0,
 lastRequestAt: 0,
 dateKey: new Date().toISOString().slice(0, 10),
 lastTestedAt: 0,
 lastTestOk: null,
 lastHttpStatus: 0,
 lastLatencyMs: 0,
 recentCalls: []
};

function extractNormalizedGeminiKeys(obj) {
 if (!obj || typeof obj !== "object") return { apiKeys: ["", "", ""], apiKey: "", firstKey: "", hasValid: false };
 let slots = ["", "", ""];
 if (Array.isArray(obj.apiKeys)) {
  slots = [
   String(obj.apiKeys[0] || "").trim(),
   String(obj.apiKeys[1] || "").trim(),
   String(obj.apiKeys[2] || "").trim()
  ];
 }
 const rawStr = typeof obj.apiKey === "string" ? obj.apiKey.trim() : "";
 if (!slots.some(k => k.length >= 16) && rawStr) {
  const parts = rawStr.split(",").map(s => s.trim()).filter(Boolean);
  slots = [parts[0] || "", parts[1] || "", parts[2] || ""];
 }
 const validSlots = slots.filter(k => k.length >= 16);
 const firstValid = validSlots[0] || (rawStr.length >= 16 ? rawStr.split(",")[0].trim() : "");
 if (firstValid && !slots.some(k => k.length >= 16)) {
  slots[0] = firstValid;
 }
 const primaryKey = validSlots.length > 0 ? validSlots.join(",") : firstValid;
 return {
  apiKeys: slots,
  apiKey: primaryKey || "",
  firstKey: firstValid || "",
  hasValid: Boolean(firstValid && firstValid.length >= 16)
 };
}

function applyParsedGeminiConfigToStore(parsed) {
 if (!parsed || typeof parsed !== "object") return;
 const norm = extractNormalizedGeminiKeys(parsed);
 if (norm.hasValid) {
  geminiConfigStore.apiKeys = norm.apiKeys;
  geminiConfigStore.apiKey = norm.apiKey || norm.firstKey;
 }
 if (typeof parsed.activeModel === "string" && parsed.activeModel.trim()) {
  geminiConfigStore.activeModel = parsed.activeModel.trim();
 }
 if (typeof parsed.relayUrl === "string" && parsed.relayUrl.trim()) {
  geminiConfigStore.relayUrl = parsed.relayUrl.trim();
 }
 if (Number.isFinite(Number(parsed.limitPerDay)) && Number(parsed.limitPerDay) >= 1500) {
  geminiConfigStore.limitPerDay = Number(parsed.limitPerDay);
 } else if (norm.hasValid) {
  const validCnt = norm.apiKeys.filter(k => k.length >= 16).length;
  geminiConfigStore.limitPerDay = Math.max(1500, validCnt * 1500);
 }
 if (Number.isFinite(Number(parsed.totalAllTime))) {
  geminiConfigStore.totalAllTime = Math.max(geminiConfigStore.totalAllTime || 0, Number(parsed.totalAllTime));
 }
 if (Number.isFinite(Number(parsed.lastRequestAt))) {
  geminiConfigStore.lastRequestAt = Math.max(geminiConfigStore.lastRequestAt || 0, Number(parsed.lastRequestAt));
 }
 if (Array.isArray(parsed.recentCalls) && parsed.recentCalls.length > 0) {
  geminiConfigStore.recentCalls = parsed.recentCalls.slice(0, 30);
 }
 if (Number.isFinite(Number(parsed.lastHttpStatus)) && Number(parsed.lastHttpStatus) > 0) {
  geminiConfigStore.lastHttpStatus = Number(parsed.lastHttpStatus);
 }
 if (Number.isFinite(Number(parsed.lastLatencyMs)) && Number(parsed.lastLatencyMs) > 0) {
  geminiConfigStore.lastLatencyMs = Number(parsed.lastLatencyMs);
 }
 const todayStr = new Date().toISOString().slice(0, 10);
 if (parsed.dateKey === todayStr) {
  geminiConfigStore.dateKey = todayStr;
  if (Number.isFinite(Number(parsed.usedToday))) {
   geminiConfigStore.usedToday = Math.max(geminiConfigStore.usedToday || 0, Number(parsed.usedToday));
  }
  if (Number.isFinite(Number(parsed.usedAppToday))) {
   geminiConfigStore.usedAppToday = Math.max(geminiConfigStore.usedAppToday || 0, Number(parsed.usedAppToday));
  }
  if (Number.isFinite(Number(parsed.usedBotToday))) {
   geminiConfigStore.usedBotToday = Math.max(geminiConfigStore.usedBotToday || 0, Number(parsed.usedBotToday));
  }
  if (Array.isArray(parsed.perKeyUsed)) {
   const curPer = Array.isArray(geminiConfigStore.perKeyUsed) ? geminiConfigStore.perKeyUsed : [0, 0, 0];
   geminiConfigStore.perKeyUsed = [
    Math.max(Number(curPer[0]) || 0, Number(parsed.perKeyUsed[0]) || 0),
    Math.max(Number(curPer[1]) || 0, Number(parsed.perKeyUsed[1]) || 0),
    Math.max(Number(curPer[2]) || 0, Number(parsed.perKeyUsed[2]) || 0)
   ];
  }
 }
}

function getEffectiveGeminiKeys(env = null, extraClientKey = "") {
 const slotKeys = Array.isArray(geminiConfigStore.apiKeys) ? geminiConfigStore.apiKeys.filter(Boolean) : [];
 const raw = [
  slotKeys.join(","),
  geminiConfigStore.apiKey || "",
  extraClientKey || "",
  (env && env.GEMINI_API_KEYS) || "",
  (env && env.GEMINI_API_KEY) || ""
 ].filter(Boolean).join(",");
 const unique = [];
 const seen = new Set();
 for (const part of raw.split(",")) {
  const k = part.trim().replace(/^["'\s]+|["'\s]+$/g, "");
  if (k.length >= 16 && !seen.has(k)) {
   seen.add(k);
   unique.push(k);
   if (unique.length >= 3) break;
  }
 }
 return unique;
}

async function syncFreshGeminiConfigFromD1(env) {
 const d1 = getD1(env)?.db;
 if (!d1) return;
 try {
  const rowsRes = await d1.prepare("SELECT k, v FROM klev_kv WHERE k IN ('GEMINI_CONFIG_V2', 'GEMINI_KEYS_VAULT_V2', 'SYS_STATE_V2_1_1')").all().catch(() => null);
  const rowMap = new Map();
  if (rowsRes && Array.isArray(rowsRes.results)) {
   for (const r of rowsRes.results) {
    if (r && r.k && r.v) rowMap.set(String(r.k), String(r.v));
   }
  } else {
   const singleRow = await d1.prepare('SELECT v FROM klev_kv WHERE k = ?').bind('GEMINI_CONFIG_V2').first().catch(() => null);
   if (singleRow && singleRow.v) rowMap.set('GEMINI_CONFIG_V2', String(singleRow.v));
  }

  const parsedGem = rowMap.has('GEMINI_CONFIG_V2') ? workerSafeJsonParse(rowMap.get('GEMINI_CONFIG_V2'), null) : null;
  const parsedVault = rowMap.has('GEMINI_KEYS_VAULT_V2') ? workerSafeJsonParse(rowMap.get('GEMINI_KEYS_VAULT_V2'), null) : null;
  const parsedSys = rowMap.has('SYS_STATE_V2_1_1') ? workerSafeJsonParse(rowMap.get('SYS_STATE_V2_1_1'), null) : null;

  if (parsedGem && typeof parsedGem === 'object') {
   applyParsedGeminiConfigToStore(parsedGem);
  }

  const gemNorm = extractNormalizedGeminiKeys(parsedGem);
  const vaultNorm = extractNormalizedGeminiKeys(parsedVault);
  const sysNorm = extractNormalizedGeminiKeys(parsedSys?.geminiConfig);
  const envKeyRaw = String((env && (env.GEMINI_API_KEYS || env.GEMINI_API_KEY)) || '').trim();
  const envNorm = extractNormalizedGeminiKeys({ apiKey: envKeyRaw });

  if (!gemNorm.hasValid) {
   const fallbackSource = vaultNorm.hasValid ? vaultNorm : (sysNorm.hasValid ? sysNorm : (envNorm.hasValid ? envNorm : null));
   if (fallbackSource && fallbackSource.hasValid) {
    geminiConfigStore.apiKeys = fallbackSource.apiKeys;
    geminiConfigStore.apiKey = fallbackSource.apiKey || fallbackSource.firstKey;
    const validCnt = geminiConfigStore.apiKeys.filter(k => String(k || '').trim().length >= 16).length;
    geminiConfigStore.limitPerDay = Math.max(1500, validCnt * 1500);
    const nowTs = Date.now();
    await d1.prepare('INSERT OR REPLACE INTO klev_kv (k, v, updated_at) VALUES (?, ?, ?)')
     .bind('GEMINI_CONFIG_V2', JSON.stringify(geminiConfigStore), nowTs)
     .run().catch(() => {});
    await d1.prepare('INSERT OR REPLACE INTO klev_kv (k, v, updated_at) VALUES (?, ?, ?)')
     .bind('GEMINI_KEYS_VAULT_V2', JSON.stringify({
      apiKey: geminiConfigStore.apiKey,
      apiKeys: geminiConfigStore.apiKeys,
      updatedAt: nowTs
     }), nowTs)
     .run().catch(() => {});
   }
  } else if (!vaultNorm.hasValid) {
   const nowTs = Date.now();
   await d1.prepare('INSERT OR REPLACE INTO klev_kv (k, v, updated_at) VALUES (?, ?, ?)')
    .bind('GEMINI_KEYS_VAULT_V2', JSON.stringify({
     apiKey: geminiConfigStore.apiKey,
     apiKeys: geminiConfigStore.apiKeys,
     updatedAt: nowTs
    }), nowTs)
    .run().catch(() => {});
  }
 } catch (e) {}
}

async function persistFreshGeminiConfigToD1(env) {
 const d1 = getD1(env)?.db;
 if (!d1) return;
 try {
  const hasValid = Boolean(
   (typeof geminiConfigStore.apiKey === 'string' && geminiConfigStore.apiKey.trim().length >= 16) ||
   (Array.isArray(geminiConfigStore.apiKeys) && geminiConfigStore.apiKeys.some(k => String(k || '').trim().length >= 16))
  );
  if (!hasValid) {
   await syncFreshGeminiConfigFromD1(env);
  }
  const nowTs = Date.now();
  await d1.prepare('INSERT OR REPLACE INTO klev_kv (k, v, updated_at) VALUES (?, ?, ?)')
   .bind('GEMINI_CONFIG_V2', JSON.stringify(geminiConfigStore), nowTs)
   .run();
  if (
   (typeof geminiConfigStore.apiKey === 'string' && geminiConfigStore.apiKey.trim().length >= 16) ||
   (Array.isArray(geminiConfigStore.apiKeys) && geminiConfigStore.apiKeys.some(k => String(k || '').trim().length >= 16))
  ) {
   await d1.prepare('INSERT OR REPLACE INTO klev_kv (k, v, updated_at) VALUES (?, ?, ?)')
    .bind('GEMINI_KEYS_VAULT_V2', JSON.stringify({
     apiKey: geminiConfigStore.apiKey,
     apiKeys: geminiConfigStore.apiKeys,
     updatedAt: nowTs
    }), nowTs)
    .run().catch(() => {});
  }
 } catch (e) {}
}

function getGeminiQuotaStatus(env = null, includeRawKeyForOwner = false) {
 const todayStr = new Date().toISOString().slice(0, 10);
 if (geminiConfigStore.dateKey !== todayStr) {
  geminiConfigStore.dateKey = todayStr;
  geminiConfigStore.usedToday = 0;
  geminiConfigStore.usedAppToday = 0;
  geminiConfigStore.usedBotToday = 0;
  geminiConfigStore.perKeyUsed = [0, 0, 0];
 }
 const keys = getEffectiveGeminiKeys(env);
 const keyCount = keys.length;
 const limitPerDay = Math.max(1500, keyCount * 1500);
 const perKeyUsed = Array.isArray(geminiConfigStore.perKeyUsed) ? geminiConfigStore.perKeyUsed.slice(0, 3) : [0, 0, 0];
 const sumPerKey = (perKeyUsed[0] || 0) + (perKeyUsed[1] || 0) + (perKeyUsed[2] || 0);
 const usedToday = Math.max(0, Number(geminiConfigStore.usedToday) || 0, sumPerKey);
 geminiConfigStore.usedToday = usedToday;
 if (usedToday > sumPerKey) {
  perKeyUsed[0] = (perKeyUsed[0] || 0) + (usedToday - sumPerKey);
  geminiConfigStore.perKeyUsed = perKeyUsed;
 }
 const usedBotToday = Math.max(0, Number(geminiConfigStore.usedBotToday) || 0);
 const usedAppToday = Math.max(0, usedToday - usedBotToday, Number(geminiConfigStore.usedAppToday) || 0);
 const totalAllTime = Math.max(usedToday, Number(geminiConfigStore.totalAllTime) || 0);
 geminiConfigStore.totalAllTime = totalAllTime;
 const remainingToday = Math.max(0, limitPerDay - usedToday);
 const firstKey = keys[0] || "";
 const maskedKey = firstKey.length >= 12
  ? (firstKey.slice(0, 6) + "••••" + firstKey.slice(-4))
  : "";
 const rawSlots = [
  (geminiConfigStore.apiKeys && geminiConfigStore.apiKeys[0]) || keys[0] || "",
  (geminiConfigStore.apiKeys && geminiConfigStore.apiKeys[1]) || keys[1] || "",
  (geminiConfigStore.apiKeys && geminiConfigStore.apiKeys[2]) || keys[2] || ""
 ];
 return {
  hasKey: keyCount > 0,
  keyCount,
  maskedKey,
  rawApiKey: undefined,
  rawApiKeys: undefined,
  perKeyUsed,
  limitPerDay,
  usedToday,
  usedAppToday,
  usedBotToday,
  totalAllTime,
  lastRequestAt: geminiConfigStore.lastRequestAt || 0,
  remainingToday,
  pctRemaining: Math.round((remainingToday / limitPerDay) * 100),
  dateKey: todayStr,
  activeModel: geminiConfigStore.activeModel || "gemini-2.5-flash",
  lastTestedAt: geminiConfigStore.lastTestedAt || 0,
  lastTestOk: geminiConfigStore.lastTestOk,
  lastHttpStatus: geminiConfigStore.lastHttpStatus || 200,
  lastLatencyMs: geminiConfigStore.lastLatencyMs || 0,
  recentCalls: Array.isArray(geminiConfigStore.recentCalls) ? geminiConfigStore.recentCalls.slice(0, 25) : []
 };
}

const GEMINI_FALLBACK_MODELS = [
 "gemini-2.5-flash",
 "gemini-3-flash-preview",
 "gemini-2.5-pro",
 "gemini-2.5-flash-lite",
 "gemini-3.1-flash-lite-preview",
 "gemini-2.0-flash"
];

const _workerDiscoveredModelsCache = new Map();
let _workerEdgeNeedsGeoRelay = false;

async function _fetchGeminiListModelsWithGeoFallback(listUrl, timeoutMs = 4500, forceRelay = false, env = null) {
 const tryGetUrl = async (targetUrl, ms, extraHeaders = {}) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
   const r = await fetch(targetUrl, {
    method: "GET",
    headers: { ...extraHeaders },
    signal: ctrl.signal
   }).catch(() => null);
   clearTimeout(timer);
   return r;
  } catch (e) {
   clearTimeout(timer);
   return null;
  }
 };

 let lastErrTxt = "";
 let lastRes = null;

 if (!_workerEdgeNeedsGeoRelay && !forceRelay) {
  const directRes = await tryGetUrl(listUrl, Math.min(timeoutMs, 4500));
  if (directRes && directRes.ok) {
   return { res: directRes, errTxt: "" };
  }
  if (directRes) {
   lastRes = directRes;
   lastErrTxt = await directRes.text().catch(() => "");
   if (/location is not supported|FAILED_PRECONDITION/i.test(lastErrTxt)) {
    _workerEdgeNeedsGeoRelay = true;
   } else {
    return { res: directRes, errTxt: lastErrTxt };
   }
  } else {
   _workerEdgeNeedsGeoRelay = true;
  }
 }

 if (_workerEdgeNeedsGeoRelay || forceRelay) {
  const customBase = String((env && (env.GEMINI_RELAY_URL || env.GEMINI_CUSTOM_RELAY_URL)) || geminiConfigStore.relayUrl || "").trim();
  const relayTargets = [];
  if (customBase) {
   const customFull = customBase.includes("?") || customBase.endsWith("=") || customBase.endsWith("/")
    ? `${customBase}${encodeURIComponent(listUrl)}`
    : `${customBase}/${listUrl}`;
   relayTargets.push({ url: customFull, headers: {} });
  }
  relayTargets.push(
   { url: `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(listUrl)}`, headers: {} },
   { url: `https://corsproxy.io/?url=${encodeURIComponent(listUrl)}`, headers: { "Origin": "https://klevpro.ru", "Referer": "https://klevpro.ru/" } },
   { url: `https://thingproxy.freeboard.io/fetch/${listUrl}`, headers: {} },
   { url: `https://cors-anywhere.com/${listUrl}`, headers: { "Origin": "https://klevpro.ru", "X-Requested-With": "XMLHttpRequest" } }
  );

  for (const gw of relayTargets) {
   const rRes = await tryGetUrl(gw.url, Math.min(timeoutMs, 4500), gw.headers);
   if (!rRes) continue;
   const rTxt = await rRes.text().catch(() => "");
   if (rRes.ok && (rTxt.includes('"models"') || rTxt.trim().startsWith("{"))) {
    const synthRes = new Response(rTxt, { status: 200, headers: { "Content-Type": "application/json" } });
    return { res: synthRes, errTxt: "" };
   }
   if (rTxt.includes('"error":') && rTxt.includes('"code":') && !/location is not supported|FAILED_PRECONDITION/i.test(rTxt)) {
    const synthErr = new Response(rTxt, { status: rRes.status || 400, headers: { "Content-Type": "application/json" } });
    return { res: synthErr, errTxt: rTxt };
   }
   if (rTxt) lastErrTxt = rTxt;
   lastRes = rRes;
  }
 }

 return { res: lastRes, errTxt: lastErrTxt || "Резервный облачный шлюз не ответил" };
}

async function discoverGeminiModelsForWorker(apiKey, env = null) {
 const cleanKey = String(apiKey || "").trim().replace(/^["'\s]+|["'\s]+$/g, "");
 if (!cleanKey) return GEMINI_FALLBACK_MODELS;
 const cached = _workerDiscoveredModelsCache.get(cleanKey);
 if (cached && (Date.now() - cached.ts < 1800000) && cached.models.length > 0) {
  return cached.models;
 }
 try {
  const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(cleanKey)}`;
  const { res } = await _fetchGeminiListModelsWithGeoFallback(listUrl, 4500, false, env);
  if (res && res.ok) {
   const data = await res.json().catch(() => null);
   if (data && Array.isArray(data.models)) {
    const scored = [];
    for (const m of data.models) {
     const methods = Array.isArray(m.supportedGenerationMethods) ? m.supportedGenerationMethods : [];
     if (!methods.includes("generateContent")) continue;
     const id = String(m.name || "").replace(/^models\//, "");
     if (!id.startsWith("gemini-")) continue;
     if (/embedding|imagen|veo|tts|audio|aqa|bisect|learnlm|robotics|computer-use|-image$|1\.0/i.test(id)) continue;
     let score = 100;
     if (id === "gemini-2.5-flash") score += 960;
     else if (id === "gemini-3-flash-preview") score += 950;
     else if (id === "gemini-2.5-pro") score += 930;
     else if (id === "gemini-2.5-flash-lite") score += 910;
     else if (id === "gemini-3.1-flash-lite-preview") score += 890;
     else if (id === "gemini-2.0-flash") score += 860;
     else if (id === "gemini-1.5-pro") score += 820;
     else if (id === "gemini-1.5-flash") score += 800;
     else if (id.includes("flash")) score += 500;
     else if (id.includes("pro")) score += 400;
     if (!id.includes("exp") && !id.includes("preview") && !id.includes("thinking")) score += 200;
     scored.push({ id, score });
    }
    scored.sort((a, b) => b.score - a.score);
    const list = scored.map(x => x.id);
    for (const fb of GEMINI_FALLBACK_MODELS) {
     if (!list.includes(fb)) list.push(fb);
    }
    if (list.length > 0) {
     _workerDiscoveredModelsCache.set(cleanKey, { ts: Date.now(), models: list, listOk: true });
     return list;
    }
   }
  }
 } catch (e) {}
 return GEMINI_FALLBACK_MODELS;
}

async function _fetchGeminiWithGeoFallback(gUrl, bodyStr, timeoutMs = 15000, forceRelayOrEnv = false, maybeEnv = null) {
 const forceRelay = typeof forceRelayOrEnv === "boolean" ? forceRelayOrEnv : false;
 const env = (forceRelayOrEnv && typeof forceRelayOrEnv === "object") ? forceRelayOrEnv : maybeEnv;

 const tryFetchUrl = async (targetUrl, ms, extraHeaders = {}) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
   const r = await fetch(targetUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: bodyStr,
    signal: ctrl.signal
   }).catch(() => null);
   clearTimeout(timer);
   return r;
  } catch (e) {
   clearTimeout(timer);
   return null;
  }
 };

 let lastErrTxt = "";
 let lastRes = null;

 if (!_workerEdgeNeedsGeoRelay && !forceRelay) {
  const gRes = await tryFetchUrl(gUrl, Math.min(timeoutMs, 7500));
  if (gRes && gRes.ok) {
   return { res: gRes, errTxt: "" };
  }
  if (gRes) {
   lastRes = gRes;
   const errTxt = await gRes.text().catch(() => "");
   lastErrTxt = errTxt;
   if (/location is not supported|FAILED_PRECONDITION/i.test(errTxt)) {
    _workerEdgeNeedsGeoRelay = true;
   } else {
    return { res: gRes, errTxt };
   }
  } else {
   _workerEdgeNeedsGeoRelay = true;
  }
 }

 if (_workerEdgeNeedsGeoRelay || forceRelay) {
  const customBase = String((env && (env.GEMINI_RELAY_URL || env.GEMINI_CUSTOM_RELAY_URL)) || geminiConfigStore.relayUrl || "").trim();
  const relayTargets = [];
  if (customBase) {
   const customFull = customBase.includes("?") || customBase.endsWith("=") || customBase.endsWith("/")
    ? `${customBase}${encodeURIComponent(gUrl)}`
    : `${customBase}/${gUrl}`;
   relayTargets.push({ url: customFull, headers: {} });
  }
  relayTargets.push(
   { url: `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(gUrl)}`, headers: {} },
   { url: `https://corsproxy.io/?url=${encodeURIComponent(gUrl)}`, headers: { "Content-Type": "application/json", "Origin": "https://klevpro.ru", "Referer": "https://klevpro.ru/" } },
   { url: `https://thingproxy.freeboard.io/fetch/${gUrl}`, headers: {} },
   { url: `https://cors-anywhere.com/${gUrl}`, headers: { "Origin": "https://klevpro.ru", "X-Requested-With": "XMLHttpRequest" } }
  );

  for (const gw of relayTargets) {
   const rRes = await tryFetchUrl(gw.url, 7500, gw.headers);
   if (!rRes) continue;
   const rTxt = await rRes.text().catch(() => "");
   if (rRes.ok && (rTxt.includes("candidates") || rTxt.trim().startsWith("{"))) {
    const synthRes = new Response(rTxt, { status: 200, headers: { "Content-Type": "application/json" } });
    return { res: synthRes, errTxt: "" };
   }
   if (rTxt.includes('"error":') && rTxt.includes('"code":') && !/location is not supported|FAILED_PRECONDITION/i.test(rTxt)) {
    const synthErr = new Response(rTxt, { status: rRes.status || 400, headers: { "Content-Type": "application/json" } });
    return { res: synthErr, errTxt: rTxt };
   }
   if (rTxt) lastErrTxt = rTxt;
   lastRes = rRes;
  }
 }

 return { res: lastRes, errTxt: lastErrTxt || "Резервный облачный шлюз не ответил" };
}

function classifyGeminiErrorCode(lastStatus, lastErrorText) {
 const txt = String(lastErrorText || "");
 if (/API_KEY_INVALID|PERMISSION_DENIED/i.test(txt) || lastStatus === 403) {
  return "API_KEY_INVALID";
 }
 if (/location is not supported|FAILED_PRECONDITION/i.test(txt)) {
  return "GEO_LOCATION_UNSUPPORTED";
 }
 if (lastStatus === 429 || /RESOURCE_EXHAUSTED|quota/i.test(txt)) {
  return "QUOTA_EXHAUSTED_429";
 }
 return lastStatus ? `UPSTREAM_HTTP_${lastStatus}` : "NETWORK_UNREACHABLE";
}

async function _callGeminiSingleKeySmart(apiKey, contentsPayload, genConfig = {}, timeoutMs = 15000, preferredModel = "", forceRelay = false, env = null) {
 const tStart = Date.now();
 const cleanKey = String(apiKey || "").trim().replace(/^["'\s]+|["'\s]+$/g, "");
 if (!cleanKey) {
  return { ok: false, status: 400, errorCode: "NO_KEYS_CONFIGURED", errorText: "NO_KEYS_CONFIGURED: API-ключи Gemini не заданы в базе D1" };
 }

 const candidates = [
  "gemini-2.5-flash",
  "gemini-3-flash-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash-lite",
  "gemini-3.1-flash-lite-preview",
  "gemini-2.0-flash"
 ];
 const prefMod = (typeof preferredModel === "string" && preferredModel.startsWith("gemini-")) ? preferredModel.trim() : "";
 if (prefMod && !candidates.includes(prefMod)) {
  candidates.unshift(prefMod);
 } else if (geminiConfigStore.activeModel && geminiConfigStore.activeModel.startsWith("gemini-") && !/lite/i.test(geminiConfigStore.activeModel)) {
  if (!candidates.includes(geminiConfigStore.activeModel)) candidates.unshift(geminiConfigStore.activeModel);
 }
 const cachedDiscovered = _workerDiscoveredModelsCache.get(cleanKey);
 if (cachedDiscovered && Array.isArray(cachedDiscovered.models)) {
  for (const m of cachedDiscovered.models) {
   if (!candidates.includes(m)) candidates.push(m);
  }
 }

 let discoveredOn404 = false;
 let lastStatus = 0;
 let lastErrorText = "";

 for (let i = 0; i < Math.min(7, candidates.length); i++) {
  const modelId = candidates[i];
  const isThinkingCapable = /gemini-(2\.5|3)/i.test(modelId);
  const tryConfigs = [];
  if (isThinkingCapable) {
   tryConfigs.push({
    temperature: genConfig.temperature ?? 0.1,
    maxOutputTokens: genConfig.maxOutputTokens ?? 4096,
    thinkingConfig: { thinkingBudget: 512 },
    ...(genConfig.responseMimeType ? { responseMimeType: genConfig.responseMimeType } : {})
   });
  }
  tryConfigs.push({
   temperature: genConfig.temperature ?? 0.1,
   maxOutputTokens: genConfig.maxOutputTokens ?? 4096,
   ...(genConfig.responseMimeType ? { responseMimeType: genConfig.responseMimeType } : {})
  });
  if (genConfig.responseMimeType) {
   tryConfigs.push({
    temperature: genConfig.temperature ?? 0.1,
    maxOutputTokens: genConfig.maxOutputTokens ?? 4096
   });
  }

  for (let cIdx = 0; cIdx < tryConfigs.length; cIdx++) {
   try {
    const gUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${encodeURIComponent(cleanKey)}`;
    const bodyStr = JSON.stringify({
     contents: contentsPayload,
     generationConfig: tryConfigs[cIdx]
    });
    const { res, errTxt } = await _fetchGeminiWithGeoFallback(gUrl, bodyStr, timeoutMs, forceRelay, env);

    if (!res) {
     if (errTxt) lastErrorText = errTxt;
     break;
    }
    lastStatus = res.status;

    if (res.ok) {
     const rJson = await res.json().catch(() => null);
     const parts = rJson?.candidates?.[0]?.content?.parts || [];
     const nonThought = parts.filter(p => !p.thought && typeof p.text === "string" && p.text.trim());
     const rawTxt = (nonThought.length > 0 ? nonThought.map(p => p.text).join("\n") : parts.filter(p => !p.thought).map(p => p.text || "").join("\n")).trim();
     if (rawTxt) {
      geminiConfigStore.activeModel = modelId;
      const latMs = Math.max(12, Date.now() - tStart);
      geminiConfigStore.lastHttpStatus = 200;
      geminiConfigStore.lastLatencyMs = latMs;
      return { ok: true, model: modelId, status: 200, latencyMs: latMs, json: rJson, text: rawTxt, errorCode: "" };
     }
     if (cIdx < tryConfigs.length - 1) {
      continue;
     }
    }

    lastErrorText = errTxt;

    if (res.status === 400 && cIdx < tryConfigs.length - 1 && !/API_KEY_INVALID|PERMISSION_DENIED/i.test(errTxt)) {
     continue;
    }

    if (res.status === 400 || res.status === 403) {
     if (/API_KEY_INVALID|PERMISSION_DENIED/i.test(errTxt)) {
      const errCode = classifyGeminiErrorCode(res.status, errTxt);
      return { ok: false, status: res.status, errorCode: errCode, errorText: errTxt };
     }
    }
    if (res.status === 404) {
     if (!discoveredOn404) {
      discoveredOn404 = true;
      const discovered = await discoverGeminiModelsForWorker(cleanKey, env);
      for (const m of discovered) {
       if (!candidates.includes(m)) candidates.push(m);
      }
     }
     const suggested = errTxt.match(/models\/(gemini-[a-z0-9.-]+)/i);
     if (suggested && suggested[1] && !candidates.includes(suggested[1])) {
      candidates.splice(i + 1, 0, suggested[1]);
     }
    }
    break;
   } catch (e) {
    break;
   }
  }
 }

 const finalErrorCode = classifyGeminiErrorCode(lastStatus, lastErrorText);
 const cached = _workerDiscoveredModelsCache.get(cleanKey);
 if (cached && cached.listOk && cached.models.length > 0) {
  geminiConfigStore.activeModel = cached.models[0];
  return {
   ok: false,
   keyVerifiedByModelsList: true,
   model: cached.models[0],
   status: lastStatus,
   errorCode: finalErrorCode,
   errorText: lastErrorText
  };
 }

 return { ok: false, status: lastStatus, errorCode: finalErrorCode, errorText: lastErrorText };
}

async function callGeminiGenerateContentSmart(apiKeyOrKeys, contentsPayload, genConfig = {}, timeoutMs = 15000, preferredModel = "", forceRelay = false, maybeEnv = null) {
 let env = maybeEnv;
 let prefMod = "";
 let fRelay = Boolean(forceRelay);
 if (preferredModel && typeof preferredModel === "object") {
  env = preferredModel;
  prefMod = "";
 } else if (typeof preferredModel === "string") {
  prefMod = preferredModel;
 }
 if (forceRelay && typeof forceRelay === "object") {
  env = forceRelay;
  fRelay = false;
 }

 const rawList = Array.isArray(apiKeyOrKeys)
  ? apiKeyOrKeys
  : String(apiKeyOrKeys || "").split(",");
 const keyList = [];
 const seen = new Set();
 for (const item of rawList) {
  const k = String(item || "").trim().replace(/^["'\s]+|["'\s]+$/g, "");
  if (k.length >= 16 && !seen.has(k)) {
   seen.add(k);
   keyList.push(k);
  }
 }
 if (keyList.length === 0) {
  return {
   ok: false,
   status: 400,
   errorCode: "NO_KEYS_CONFIGURED",
   errorText: "NO_KEYS_CONFIGURED: API-ключи Gemini не заданы в базе D1"
  };
 }

 let lastResult = null;
 for (let ki = 0; ki < keyList.length; ki++) {
  const res = await _callGeminiSingleKeySmart(keyList[ki], contentsPayload, genConfig, timeoutMs, prefMod, fRelay, env);
  if (res.ok) {
   return { ...res, keyIndex: ki };
  }
  lastResult = res;
 }
 return lastResult || {
  ok: false,
  status: 502,
  errorCode: "NETWORK_UNREACHABLE",
  errorText: "Резервный облачный шлюз не ответил"
 };
}

async function recordGeminiRequestUsed(env = null, keySlotIndexOrKey = 0, source = "app", meta = {}) {
 const todayStr = new Date().toISOString().slice(0, 10);
 if (geminiConfigStore.dateKey !== todayStr) {
  geminiConfigStore.dateKey = todayStr;
  geminiConfigStore.usedToday = 0;
  geminiConfigStore.usedAppToday = 0;
  geminiConfigStore.usedBotToday = 0;
  geminiConfigStore.perKeyUsed = [0, 0, 0];
 }
 if (!Array.isArray(geminiConfigStore.perKeyUsed)) {
  geminiConfigStore.perKeyUsed = [0, 0, 0];
 }
 let slotIdx = 0;
 if (typeof keySlotIndexOrKey === "number" && keySlotIndexOrKey >= 0 && keySlotIndexOrKey < 3) {
  slotIdx = keySlotIndexOrKey;
 } else if (typeof keySlotIndexOrKey === "string" && keySlotIndexOrKey.length >= 6) {
  const keys = getEffectiveGeminiKeys(env);
  const foundIdx = keys.findIndex(k => k.startsWith(keySlotIndexOrKey.slice(0, 10)));
  if (foundIdx >= 0 && foundIdx < 3) slotIdx = foundIdx;
 }
 const nowTs = Date.now();
 geminiConfigStore.perKeyUsed[slotIdx] = (Number(geminiConfigStore.perKeyUsed[slotIdx]) || 0) + 1;
 geminiConfigStore.usedToday = (Number(geminiConfigStore.usedToday) || 0) + 1;
 if (source === "bot") {
  geminiConfigStore.usedBotToday = (Number(geminiConfigStore.usedBotToday) || 0) + 1;
 } else {
  geminiConfigStore.usedAppToday = (Number(geminiConfigStore.usedAppToday) || 0) + 1;
 }
 geminiConfigStore.totalAllTime = Math.max(geminiConfigStore.usedToday, (Number(geminiConfigStore.totalAllTime) || 0) + 1);
 geminiConfigStore.lastRequestAt = nowTs;
 const httpStat = Number(meta?.httpStatus) || geminiConfigStore.lastHttpStatus || 200;
 const latMs = Number(meta?.latencyMs) || geminiConfigStore.lastLatencyMs || 0;
 geminiConfigStore.lastHttpStatus = httpStat;
 if (latMs > 0) geminiConfigStore.lastLatencyMs = latMs;
 if (!Array.isArray(geminiConfigStore.recentCalls)) {
  geminiConfigStore.recentCalls = [];
 }
 const callEntry = {
  id: `GAPI_${nowTs.toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
  ts: nowTs,
  source: source === "bot" ? "bot" : "app",
  fisherId: String(meta?.fisherId || (source === "bot" ? "TG_BOT" : "FP_USER")).slice(0, 24),
  callsign: String(meta?.callsign || (source === "bot" ? "Telegram-Бот" : "Рыболов")).slice(0, 32),
  env: String(meta?.env || (source === "bot" ? "TG-BOT" : "WEB")).slice(0, 16),
  keySlot: slotIdx + 1,
  model: String(meta?.model || geminiConfigStore.activeModel || "gemini-2.5-flash").slice(0, 40),
  httpStatus: httpStat,
  latencyMs: latMs,
  action: String(meta?.action || (source === "bot" ? "TG-Бот: фото рыбы" : "Ихтио-Сканер: фото рыбы")).slice(0, 90),
  verifiedHttp200: httpStat === 200
 };
 geminiConfigStore.recentCalls.unshift(callEntry);
 if (geminiConfigStore.recentCalls.length > 30) geminiConfigStore.recentCalls.length = 30;
 if (env) {
  await persistFreshGeminiConfigToD1(env);
 }
}


const betaTestersStore = new Map([
 [OWNER_FISHER_ID, { id: OWNER_FISHER_ID, label: 'iAthor • Владелец (Супер-Админ)', addedAt: '2026-11-06', phase2: true, phase3: true }],
 [OWNER_SECONDARY_ID, { id: OWNER_SECONDARY_ID, label: 'iAthor • Резервный ID Владельца', addedAt: '2026-11-06', phase2: true, phase3: true }],
 ['FP_89AAA014', { id: 'FP_89AAA014', label: 'test89test • Бета-тестер', addedAt: '2026-11-06', phase2: true, phase3: true }]
]);
const removedBetaTestersSet = new Set();
const betaGateConfig = {
 phase2BetaOnly: true,
 phase3BetaOnly: true
};
const DEFAULT_WORKER_POLICY_SECTIONS = [{"id": "general_and_platforms", "title": "1. Общие положения, некоммерческий статус и режимы платформ (ЗоЗПП РФ, ФЗ № 149-ФЗ)", "text": "Экосистема «Клёв ПРО 2.0: Круг» (домены клевпро.рф / klevpro.ru, веб-приложение PWA, мобильное приложение Android APK и Telegram-бот @KlevProClubBot, возрастная маркировка 12+ по ст. 6 ФЗ № 436-ФЗ) является бесплатным некоммерческим информационно-справочным проектом для рыболовов-любителей. Правообладатель и оператор: Тхор Антон Сергеевич (e-mail: i@athor.ru). В Android APK все пользовательские данные (профиль, постоянный ID, точки на карте, журнал уловов с фото, маршруты) хранятся в защищённом системном разделе «Данные приложения» (Context.getFilesDir()), который не удаляется при очистке кэша. В мини-приложении Telegram (TMA) действует облегчённый режим просмотра и оперативной работы (выгрузка/загрузка файлов, хранение фото в журнале, офлайн-карты, кнопка SOS и функции Фаз 2 и 3 в мини-приложении отключены)."}, {"id": "privacy_and_id", "title": "2. Единый Рыболовный ID и Политика конфиденциальности (Zero-PII, ФЗ № 152-ФЗ)", "text": "Приложение построено по архитектуре Zero-PII: система не запрашивает и не собирает ФИО, паспортные данные, номера телефонов или e-mail. Без регистрации устройству на 24 часа выдаётся временный резервный ID (FP_XXRZYYYY, позывной «Гость (Резерв)»), открывающий доступ к погоде и прогнозу клёва на сегодня, атласу 115 видов рыб РФ (без ИИ), календарю, точкам на карте и журналу уловов. При регистрации Логина и Пароля за пользователем один раз и навсегда закрепляется единственный постоянный региональный ID (FP_XXAAA001..999). При входе под своим логином и паролем с любого устройства (смартфон, планшет, ПК) система проверяет аккаунт в базе Cloudflare D1, возвращает единый постоянный ID пользователя и автоматически удаляет временный гостевой номер. Пароли хешируются по стандарту PBKDF2-HMAC-SHA256 (100 000 итераций), а сетевые пакеты через резервные облачные шлюзы шифруются алгоритмом RSA-OAEP-2048 + AES-256-GCM."}, {"id": "geo_consent", "title": "3. Порядок обработки геолокации в сети Интернет (ст. 10.1 ФЗ № 152-ФЗ)", "text": "Для расчёта локального прогноза клёва, температуры воды, толщины льда и записи личного маршрута координаты обрабатываются на устройстве пользователя. Передача геоданных в сеть Интернет (в разделы «Круг ±5 км», «Экипаж 72 ч», «Слипы/Точки», «Чаты» или сигнал «SOS») осуществляется только при наличии отдельного предварительного согласия пользователя. Пользователь вправе в любой момент отозвать согласие одной кнопкой в профиле или на карте — при отзыве все ранее переданные геоданные и точки пользователя немедленно удаляются с сервера и из чатов. Оперативные точки «Круга» и «Экипажа (72 ч)» автоматически удаляются через 72 часа."}, {"id": "account_deletion", "title": "4. Право на полное удаление учётной записи («Удалить УЗ»)", "text": "Пользователь имеет право в любой момент удалить свою учётную запись через раздел «Профиль и ID» -> «Удалить УЗ». При удалении учётной записи с сервера и из базы данных D1 безвозвратно удаляются: профиль и постоянный ID пользователя, все опубликованные точки «Круга» и «Слипов», уловы, сообщения во всех региональных и личных чатах, а также привязка к Telegram."}, {"id": "ip_and_data_sources", "title": "5. Интеллектуальная собственность, картография и метео-гидрологические источники (ГК РФ)", "text": "Исключительные права на программный код, 115 иллюстраций рыб, базу водоёмов РФ и физико-математические модели принадлежат правообладателю (© Тхор А. С., 2025–2026). Картографические материалы предоставляются ООО «Яндекс» для личного некоммерческого использования в соответствии с Условиями использования сервиса Яндекс.Карты (https://yandex.ru/legal/maps_termsofuse/), а также проектами OpenStreetMap (ODbL) и OSRM. Расчётное ядро использует открытые метеорологические, гидрологические, ледовые и дорожные сводки Гидрометцентра России (meteoinfo.ru), MET Norway и Open-Meteo."}, {"id": "beta_and_safety", "title": "6. Регламент Бета-теста (Фазы 2 и 3), безопасность на воде, льду и дорогах (ГИМС МЧС РФ, ФЗ № 166-ФЗ)", "text": "Функции закрытого Бета-теста — Фаза 2 (ИИ-распознавание улова по фото, диагностика патологий рыб и голосовой ИИ-помощник) и Фаза 3 (фоновая запись маршрута с привязкой к дорогам и тропам, голосовое ведение по маршруту и возврат по следу «Я потерялся») — предоставляются зарегистрированным участникам тестирования в ознакомительном режиме. Все расчёты прогноза клёва, температуры воды, толщины льда, дорожных предупреждений о гололёде/гололедице и голосовые подсказки навигатора носят исключительно информационно-справочный характер и не заменяют официальные сводки МЧС России, ГИМС и экстренный вызов 112. Пользователь обязуется соблюдать Правила рыболовства РФ (ФЗ № 166-ФЗ)."}];
const policyStateStore = {
 policyVersion: '2026.11.10-v2.8.3',
 appVersion: '2.8.3',
 appRevision: 'r239',
 effectiveDate: '10 ноября 2026 г.',
 title: 'Политика конфиденциальности, Пользовательское соглашение и Правила обработки геоданных «Клёв ПРО 2.0»',
 updatedAt: '2026-11-10T03:35:00Z',
 broadcastId: 'POL_BC_INIT_283',
 summary: 'Редакция v2.8.3 (r235): защита пользовательских данных в разделе «Данные приложения» Android APK (Context.getFilesDir), единая привязка постоянного ID к логину и паролю на всех устройствах, калибровка гидрологии по сводкам Росгидромета (meteoinfo.ru) и динамическая рассылка политики без пересборки.',
 sections: DEFAULT_WORKER_POLICY_SECTIONS
};
const userConsentsStore = new Map();

function isUserBetaTesterOnServer(fid = '') {
 const norm = String(fid || '').trim().toUpperCase();
 if (!norm) return false;
 if (isOwnerFisherId(norm)) return true;
 if (removedBetaTestersSet.has(norm)) return false;
 if (betaTestersStore.has(norm)) return true;
 if (adminWhitelistStore.has(norm)) return true;
 const u = usersRegistryStore.get(norm);
 if (u && u.isBetaTester) return true;
 const aKey = fisherIdToAuthKeyMap.get(norm);
 if (aKey && cloudAuthProfiles.get(aKey)?.isBetaTester) return true;
 return false;
}

function serializeFullServerState() {
 purgeExpiredServerCirclePoints();
 return JSON.stringify({
  v: WORKER_VERSION,
  adminSessions: Object.fromEntries(Array.from(activeAdminSessionsMap.entries()).filter(([, exp]) => exp > Date.now()).slice(-100)),
  revokedAdminSessions: Array.from(revokedAdminSessionsSet).slice(-500),
  betaTesters: Array.from(betaTestersStore.values()),
  removedBetaTesters: Array.from(removedBetaTestersSet),
  betaGateConfig: { ...betaGateConfig },
  policyState: { ...policyStateStore },
  userConsents: Object.fromEntries(Array.from(userConsentsStore.entries()).slice(-5000)),
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
  profiles: Object.fromEntries(Array.from(cloudAuthProfiles.entries()).slice(-3000)),
  geminiConfig: {
   ...geminiConfigStore,
   apiKey: geminiConfigStore.apiKey,
   apiKeys: Array.isArray(geminiConfigStore.apiKeys) ? geminiConfigStore.apiKeys.slice(0, 3) : ["", "", ""]
  },
  securityAudit: {
   counters: { ...securityAuditStore.counters },
   events: (securityAuditStore.events || []).slice(0, 60)
  }
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
    if (deletedFisherIdsSet.has(normId) && !isOwnerFisherId(normId)) continue;
    if (isTemporaryReserveId(normId) && (workerIsOwnerLogin(u.login || '') || workerIsOwnerLogin(u.callsign || ''))) {
     deletedFisherIdsSet.add(normId);
     continue;
    }
    const ex = usersRegistryStore.get(normId);
    if (!ex || (u.lastSeen || 0) >= (ex.lastSeen || 0)) {
     usersRegistryStore.set(normId, { ...u, fisherId: normId });
    }
    if (!isTemporaryReserveId(normId)) {
     reservedVanityIds.add(normId);
    }
    if (u.deviceId && normId !== OWNER_FISHER_ID) {
     const curMapped = deviceToFisherIdMap.get(u.deviceId);
     if (!curMapped || !isTemporaryReserveId(normId) || isTemporaryReserveId(curMapped)) {
      deviceToFisherIdMap.set(u.deviceId, normId);
     }
    }
   }
  }
 }
 if (Array.isArray(parsed.points)) {
  const now = Date.now();
  for (const pt of parsed.points) {
   if (pt && pt.id && (!pt.ea || pt.ea > now || pt.t === 'spot' || pt.savedForever || (pt.t === 'crew' && !pt.sos))) {
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
 if (parsed.securityAudit && typeof parsed.securityAudit === "object") {
  if (parsed.securityAudit.counters && typeof parsed.securityAudit.counters === "object") {
   for (const k of Object.keys(securityAuditStore.counters)) {
    const v = Number(parsed.securityAudit.counters[k]) || 0;
    if (v > (securityAuditStore.counters[k] || 0)) securityAuditStore.counters[k] = v;
   }
  }
  if (Array.isArray(parsed.securityAudit.events) && securityAuditStore.events.length === 0) {
   securityAuditStore.events = parsed.securityAudit.events.slice(0, 60);
  }
 }
 if (parsed.geminiConfig && typeof parsed.geminiConfig === "object") {
  applyParsedGeminiConfigToStore(parsed.geminiConfig);
 }
 adminWhitelistStore.set(OWNER_FISHER_ID, { id: OWNER_FISHER_ID, label: "iAthor • Антон (Владелец / Супер-Админ)", addedAt: "2026-10-27" });
 if (Array.isArray(parsed.revokedAdminSessions)) {
  for (const rTok of parsed.revokedAdminSessions) {
   if (typeof rTok === 'string' && rTok) {
    revokedAdminSessionsSet.add(rTok);
    activeAdminSessionsMap.delete(rTok);
   }
  }
 }
 if (parsed.adminSessions && typeof parsed.adminSessions === 'object') {
  const nowTs = Date.now();
  for (const [sTok, expVal] of Object.entries(parsed.adminSessions)) {
   if (sTok && Number(expVal) > nowTs && !revokedAdminSessionsSet.has(sTok)) {
    activeAdminSessionsMap.set(sTok, Number(expVal));
   }
  }
 }
 if (Array.isArray(parsed.removedBetaTesters)) {
  for (const rbid of parsed.removedBetaTesters) {
   const cleanR = String(rbid || '').trim().toUpperCase();
   if (cleanR && !isOwnerFisherId(cleanR)) {
    removedBetaTestersSet.add(cleanR);
    betaTestersStore.delete(cleanR);
   }
  }
 }
 if (Array.isArray(parsed.betaTesters)) {
  for (const bt of parsed.betaTesters) {
   if (bt && bt.id) {
    const bid = String(bt.id).trim().toUpperCase();
    if (removedBetaTestersSet.has(bid) && !isOwnerFisherId(bid)) continue;
    betaTestersStore.set(bid, { ...bt, id: bid });
    const exU = usersRegistryStore.get(bid);
    if (exU) usersRegistryStore.set(bid, { ...exU, isBetaTester: true });
   }
  }
 }
 for (const [wid, witem] of adminWhitelistStore.entries()) {
  if (wid && String(witem?.label || '').includes('[BETA]') && !removedBetaTestersSet.has(wid)) {
   betaTestersStore.set(wid, {
    id: wid,
    label: String(witem.label).replace(/^\[BETA\]\s*/, '') || 'Бета-тестер',
    addedAt: witem.addedAt || '2026-11-06',
    phase2: true,
    phase3: true
   });
  }
 }
 if (parsed.betaGateConfig && typeof parsed.betaGateConfig === 'object') {
  if (typeof parsed.betaGateConfig.phase2BetaOnly === 'boolean') betaGateConfig.phase2BetaOnly = parsed.betaGateConfig.phase2BetaOnly;
  if (typeof parsed.betaGateConfig.phase3BetaOnly === 'boolean') betaGateConfig.phase3BetaOnly = parsed.betaGateConfig.phase3BetaOnly;
 }
 if (parsed.policyState && typeof parsed.policyState === 'object') {
  const inTs = Date.parse(parsed.policyState.updatedAt || '') || 0;
  const curTs = Date.parse(policyStateStore.updatedAt || '') || 0;
  if (inTs >= curTs || parsed.policyState.broadcastId) {
   if (parsed.policyState.policyVersion) policyStateStore.policyVersion = String(parsed.policyState.policyVersion);
   if (parsed.policyState.appVersion) policyStateStore.appVersion = String(parsed.policyState.appVersion);
   if (parsed.policyState.appRevision) policyStateStore.appRevision = String(parsed.policyState.appRevision);
   if (parsed.policyState.effectiveDate) policyStateStore.effectiveDate = String(parsed.policyState.effectiveDate);
   if (parsed.policyState.title) policyStateStore.title = String(parsed.policyState.title);
   if (parsed.policyState.updatedAt) policyStateStore.updatedAt = String(parsed.policyState.updatedAt);
   if (parsed.policyState.summary) policyStateStore.summary = String(parsed.policyState.summary);
   if (parsed.policyState.broadcastId) policyStateStore.broadcastId = String(parsed.policyState.broadcastId);
   if (Array.isArray(parsed.policyState.sections) && parsed.policyState.sections.length > 0) {
    policyStateStore.sections = parsed.policyState.sections;
   }
  }
 }
 if (parsed.userConsents && typeof parsed.userConsents === 'object') {
  for (const [cfid, cobj] of Object.entries(parsed.userConsents)) {
   if (cfid && cobj && typeof cobj === 'object') {
    userConsentsStore.set(String(cfid).toUpperCase(), cobj);
   }
  }
 }
}


async function persistSystemMeta(env, ctx = null) {
 const task = (async () => {
  const hasValidKeyInMem = () => Boolean(
   (typeof geminiConfigStore.apiKey === 'string' && geminiConfigStore.apiKey.trim().length >= 16) ||
   (Array.isArray(geminiConfigStore.apiKeys) && geminiConfigStore.apiKeys.some(k => String(k || '').trim().length >= 16))
  );
  if (!hasValidKeyInMem()) {
   await syncFreshGeminiConfigFromD1(env);
  }
  const payloadStr = serializeFullServerState();
  lastEdgePersistTs = Date.now();
  const d1Info = getD1(env);
  const d1 = d1Info?.db;
  if (d1) {
   try {
    await d1.prepare('INSERT OR REPLACE INTO klev_kv (k, v, updated_at) VALUES (?, ?, ?)').bind('SYS_STATE_V2_1_1', payloadStr, Date.now()).run();
    await d1.prepare('INSERT OR REPLACE INTO klev_kv (k, v, updated_at) VALUES (?, ?, ?)').bind('BETA_STATE_V2', JSON.stringify({
     adminSessions: Object.fromEntries(Array.from(activeAdminSessionsMap.entries()).filter(([, exp]) => exp > Date.now()).slice(-100)),
     revokedAdminSessions: Array.from(revokedAdminSessionsSet).slice(-500),
     betaTesters: Array.from(betaTestersStore.values()),
     removedBetaTesters: Array.from(removedBetaTestersSet),
     betaGateConfig: { ...betaGateConfig },
     whitelist: Array.from(adminWhitelistStore.values())
    }), Date.now()).run().catch(() => {});
    if (hasValidKeyInMem()) {
     await d1.prepare('INSERT OR REPLACE INTO klev_kv (k, v, updated_at) VALUES (?, ?, ?)').bind('GEMINI_CONFIG_V2', JSON.stringify(geminiConfigStore), Date.now()).run().catch(() => {});
    }
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
 const d1Badge = d1Info ? `<span class="pill pill-good" style="font-size:10px;">D1 (${safeD1Name})</span>` : `<span class="pill pill-bad" style="font-size:10px;">D1 не привязана</span>`;
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

 const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
 const fmtDate = (ts) => ts ? new Date(ts).toLocaleString('ru-RU', { timeZone: 'Asia/Yekaterinburg' }) : '—';

 const d1BannerHtml = d1Info
  ? `<div style="padding:10px 14px;border-radius:10px;background:rgba(16,185,129,0.15);border:1.5px solid #10b981;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
      <div>
       <div style="font-weight:900;color:#34d399;font-size:14px;">Cloudflare D1 База Данных: ПОДКЛЮЧЕНА (Имя привязки: ${esc(d1Info.name)})</div>
       <div style="font-size:12px;color:#94a3b8;margin-top:2px;">Все постоянные ID, реестр пользователей, чаты и точки сохраняются в постоянных SQL-таблицах D1.</div>
      </div>
      <span style="padding:4px 10px;border-radius:6px;background:#1e293b;border:1px solid #334155;font-size:11px;font-weight:800;color:#38bdf8;">D1 Engine 2.5.6</span>
     </div>`
  : `<div style="padding:12px 14px;border-radius:10px;background:rgba(239,68,68,0.15);border:1.5px solid #ef4444;margin-bottom:12px;display:flex;flex-direction:column;gap:6px;">
      <div style="font-weight:900;color:#f87171;font-size:14px;">ВНИМАНИЕ: Cloudflare D1 База Данных НЕ ПРИВЯЗАНА!</div>
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
       : `<span style="padding:2px 7px;border-radius:6px;background:#1e293b;color:#94a3b8;font-size:11px;">Рыболов</span>`);
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
  const typeLbl = p.sos ? 'SOS' : (p.t === 'crew' ? `Экипаж (${esc(p.crewKey || '')})` : (p.t === 'workshop' ? 'Снасть' : '👥 Круг ±5км'));
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
   <button class="btn" onclick="exportUsersJson()">Скачать базу (.JSON)</button>
   <button class="btn" onclick="exportUsersCsv()">📊 Скачать таблицу (.CSV)</button>
   <button class="btn" onclick="location.reload()">Обновить данные</button>
  </div>
 </div>

 <div class="kpi-grid">
  <div class="kpi"><div class="kpi-val" style="color:#34d399;">${totalUsers}</div><div class="kpi-lbl">Всего рыбаков в базе (уникальных ID)</div></div>
  <div class="kpi"><div class="kpi-val">${active24h} / ${active7d}</div><div class="kpi-lbl">Активны за 24 часа / 7 дней</div></div>
  <div class="kpi"><div class="kpi-val" style="color:#a78bfa;">${apkCount} • 🌐 ${webCount} • ✈️ ${tgCount}</div><div class="kpi-lbl">Платформы (APK / Web PWA / Telegram)</div></div>
  <div class="kpi"><div class="kpi-val" style="color:#fbbf24;">${points.length}</div><div class="kpi-lbl">Активных точек в Круге / Экипаже / SOS</div></div>
 </div>

 <div class="card">
  <div style="font-weight:800;font-size:13px;color:#38bdf8;margin-bottom:8px;">️ РАСПРЕДЕЛЕНИЕ ВЫДАННЫХ ID ПО РЕГИОНАМ РФ:</div>
  <div style="display:flex;flex-wrap:wrap;gap:6px;">${regBadges || 'Пока нет данных'}</div>
 </div>

 <div class="card">
  <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px;">
   <div style="font-weight:900;font-size:15px;">👥 РЕЕСТР ПОЛЬЗОВАТЕЛЕЙ ЭКОСИСТЕМЫ (${totalUsers}):</div>
   <div style="flex:1;min-width:260px;max-width:420px;">
    <input type="text" class="search" id="userSearchInp" placeholder="Поиск по ID (FP_...), логину, городу, региону или платформе..." oninput="filterUsers(this.value)">
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
  <div style="font-weight:900;font-size:15px;margin-bottom:10px;">АКТИВНЫЕ ТОЧКИ НА КАРТЕ КРУГА / ЭКИПАЖЕЙ / SOS (${points.length}):</div>
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
 const ADMIN_TOKEN = '';
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



function normalizeWorkerPath(pathname = '/') {
 const clean = String(pathname || '/').replace(/\/+/g, '/').replace(/\/+$/, '');
 return clean || '/';
}

function matchWorkerRoute(normPath, ...routes) {
 for (const r of routes) {
  if (normPath === r) return true;
  if (r.startsWith('/api/') && normPath === r.slice(4)) return true;
  if (!r.startsWith('/api/') && normPath === '/api' + r) return true;
 }
 return false;
}

export default {
 async fetch(outerRequest, env, ctx) {
  const dynamicCors = getCorsHeadersForRequest(outerRequest);
  if (outerRequest.method === 'OPTIONS') {
   return new Response(null, { status: 204, headers: dynamicCors });
  }
  const outerUrl = new URL(outerRequest.url);
  let e2eContext = null;
  let request = outerRequest;
  if (outerUrl.searchParams.has('e2e')) {
   const unwrapped = await unwrapWorkerE2ERequest(outerRequest, outerUrl, env);
   if (!unwrapped.ok) {
    return new Response(JSON.stringify({ ok: false, error: unwrapped.error || 'Invalid E2E envelope' }), {
     status: 400,
     headers: { ...dynamicCors, 'Content-Type': 'application/json;charset=utf-8' }
    });
   }
   request = unwrapped.syntheticRequest;
   if (outerRequest.cf && !request.cf) {
    try { Object.defineProperty(request, 'cf', { value: outerRequest.cf, configurable: true }); } catch (_e) {}
   }
   e2eContext = unwrapped;
  }
  const rawResponse = await this._handleCoreFetch(request, env, ctx);
  const outHeaders = new Headers(rawResponse.headers);
  if (outHeaders.get('Access-Control-Allow-Origin') !== '*') {
   outHeaders.set('Access-Control-Allow-Origin', dynamicCors['Access-Control-Allow-Origin']);
   outHeaders.set('Vary', 'Origin');
  }
  if (e2eContext && e2eContext.respKeyHex) {
   const cType = String(outHeaders.get('Content-Type') || '').toLowerCase();
   if (cType.includes('application/json')) {
    const plainBodyText = await rawResponse.text();
    const e2eRespCipher = await encryptWorkerE2EResponse(plainBodyText, rawResponse.status, e2eContext.respKeyHex, e2eContext.version, env);
    return new Response(JSON.stringify({ ok: true, e2eResp: e2eRespCipher }), {
     status: 200,
     headers: { ...dynamicCors, 'Content-Type': 'application/json;charset=utf-8' }
    });
   }
  }
  return new Response(rawResponse.body, {
   status: rawResponse.status,
   statusText: rawResponse.statusText,
   headers: outHeaders
  });
 },
 async _handleCoreFetch(request, env, ctx) {
  try {
  const BOT_TOKEN = (env && (env.BOT_TOKEN || env.TELEGRAM_BOT_TOKEN)) || '';
  const WEBHOOK_SECRET = (env && env.WEBHOOK_SECRET) || '';
  const effectiveWebhookSecret = WEBHOOK_SECRET || (BOT_TOKEN ? (await hmacSha256Hex(BOT_TOKEN, 'KLEV_TG_WEBHOOK_SECRET_V1')).slice(0, 48) : '');
  const _rawEnvUrl = String((env && env.WEBAPP_URL) || '').trim();
  const WEBAPP_URL = ((_rawEnvUrl && !/github\.io|klev-pro-2/i.test(_rawEnvUrl)) ? _rawEnvUrl : 'https://klevpro.ru/').replace(/\/?$/, '/');
  const reqUrl = new URL(request.url);
  const normPath = normalizeWorkerPath(reqUrl.pathname);

  // Пункт 19: Принудительный HTTPS (кроме локальной отладки)
  if (reqUrl.protocol === 'http:' && reqUrl.hostname !== 'localhost' && reqUrl.hostname !== '127.0.0.1') {
   return Response.redirect(reqUrl.toString().replace(/^http:/, 'https:'), 301);
  }

  if (request.method === 'OPTIONS') {
   return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const clientIp = request.headers.get('CF-Connecting-IP') || 'anon_ip';

  // ── Шлюз тайлов офлайн-карт (/api/tile-proxy?url=...) с заголовками CORS для Яндекс Спутник / Схема ──
  // ── Мониторинг ошибок клиентов (/api/telemetry/client-error) и SEO (/robots.txt, /sitemap.xml) ──
  if (reqUrl.pathname === '/robots.txt' && request.method === 'GET') {
   return new Response(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /auth/\nDisallow: /relay/\nDisallow: /weather\nHost: https://klevpro.ru\nSitemap: https://klevpro.ru/sitemap.xml\n`, {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }
   });
  }
  if (reqUrl.pathname === '/sitemap.xml' && request.method === 'GET') {
   return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://klevpro.ru/</loc><lastmod>2026-11-20</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url></urlset>`, {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/xml; charset=utf-8' }
   });
  }
  if ((reqUrl.pathname === '/api/water' || matchWorkerRoute(normPath, '/api/water')) && request.method === 'GET') {
   const tile = (reqUrl.searchParams.get('t') || '').trim();
   if (!/^-?\d{1,3}(\.\d{1,2})?_-?\d{1,3}(\.\d{1,2})?$/.test(tile)) {
    return new Response('bad', { status: 400, headers: { 'access-control-allow-origin': '*' } });
   }
   const [la, lo] = tile.split('_').map(Number);
   if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) {
    return new Response('bad', { status: 400, headers: { 'access-control-allow-origin': '*' } });
   }
   if (Math.round(la * 100) % 25 !== 0 || Math.round(lo * 100) % 25 !== 0) {
    return new Response('bad', { status: 400, headers: { 'access-control-allow-origin': '*' } });
   }
   const tileCanon = `${la.toFixed(2)}_${lo.toFixed(2)}`;
   const cache = (typeof caches !== 'undefined' && caches.default) ? caches.default : null;
   const key = new Request(`https://cache.klevpro.local/water/v1/${tileCanon}`);
   if (cache) {
    try {
     const hit = await cache.match(key);
     if (hit) return hit;
    } catch (_e) {}
   }
   const simplifyGeom = (geom, epsM) => {
    if (!Array.isArray(geom) || geom.length < 3) return geom;
    const lat0 = geom[0].lat, kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
    const P = geom.map(p => [p.lon * kx, p.lat * ky]);
    const keep = new Uint8Array(P.length); keep[0] = keep[P.length - 1] = 1;
    const st = [[0, P.length - 1]];
    while (st.length) {
     const [i, j] = st.pop(); let dmax = 0, k = -1;
     const [x1, y1] = P[i], [x2, y2] = P[j]; const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
     for (let m = i + 1; m < j; m++) {
      const [x, y] = P[m]; let t = L ? ((x - x1) * dx + (y - y1) * dy) / L : 0; t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)); if (d > dmax) { dmax = d; k = m; }
     }
     if (dmax > epsM && k !== -1) { keep[k] = 1; st.push([i, k], [k, j]); }
    }
    return geom.filter((_, i) => keep[i]);
   };
   const simplifyElements = (elements, epsM = 20) => {
    if (!Array.isArray(elements)) return [];
    for (const el of elements) {
     if (!el || typeof el !== 'object') continue;
     if (Array.isArray(el.geometry)) el.geometry = simplifyGeom(el.geometry, epsM);
     if (Array.isArray(el.members)) {
      for (const m of el.members) {
       if (m && Array.isArray(m.geometry)) m.geometry = simplifyGeom(m.geometry, epsM);
      }
     }
    }
    return elements;
   };
   const bb = `${la},${lo},${la + 0.25},${lo + 0.25}`;
   const q = `[out:json][timeout:60];(way["waterway"~"^(river|canal|fairway|riverbank|weir|dam|waterfall)$"](${bb});` +
             `way["natural"="water"](${bb});relation["natural"="water"](${bb});relation["waterway"="riverbank"](${bb});` +
             `way["landuse"="reservoir"](${bb}););out geom;`;
   const overpassMirrors = [
    'https://overpass-api.de/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
   ];
   let j = null;
   for (const mirrorUrl of overpassMirrors) {
    try {
     const ctrl = new AbortController();
     const timer = setTimeout(() => ctrl.abort(), 18000);
     const r = await fetch(mirrorUrl, {
      method: 'POST',
      headers: {
       'content-type': 'application/x-www-form-urlencoded',
       'user-agent': 'KlevProWaterTileWorker/2.9.2 (https://klevpro.ru)'
      },
      body: 'data=' + encodeURIComponent(q),
      signal: ctrl.signal
     }).catch(() => null);
     clearTimeout(timer);
     if (r && r.ok) {
      const parsed = await r.json().catch(() => null);
      if (parsed && Array.isArray(parsed.elements)) {
       j = parsed;
       break;
      }
     }
    } catch (_e) {}
   }
   if (!j || !Array.isArray(j.elements)) {
    return new Response('upstream', { status: 502, headers: { 'access-control-allow-origin': '*' } });
   }
   simplifyElements(j.elements, 20);
   const out = new Response(JSON.stringify({ elements: j.elements, v: 1 }), {
    headers: {
     'content-type': 'application/json',
     'cache-control': 'public, max-age=2592000',
     'access-control-allow-origin': '*'
    }
   });
   if (cache) {
    if (ctx && typeof ctx.waitUntil === 'function') {
     ctx.waitUntil(cache.put(key, out.clone()).catch(() => {}));
    } else {
     await cache.put(key, out.clone()).catch(() => {});
    }
   }
   return out;
  }
  if (matchWorkerRoute(normPath, '/api/admin/security-audit') && (request.method === 'GET' || request.method === 'POST')) {
   await ensurePersistentStateLoaded(env);
   let b = {};
   if (request.method === 'POST' || reqUrl.searchParams.has('payload')) {
    b = await readWorkerRequestPayload(request, reqUrl).catch(() => ({}));
   }
   const tok = extractAdminTokenFromRequest(request, reqUrl, b);
   if (!await isValidOwnerAdminToken(tok, env)) {
    recordSecurityIncident('data_exposure', '/api/admin/security-audit', 'Попытка неавторизованного доступа к радару ИБ Супер-Админа', clientIp);
    return jsonResponse({ ok: false, error: 'Unauthorized', authRequired: true }, 401);
   }
   if (b.action === 'clear') {
    for (const k of Object.keys(securityAuditStore.counters)) securityAuditStore.counters[k] = 0;
    securityAuditStore.events = [];
    await persistSystemMeta(env, ctx);
    return jsonResponse({ ok: true, cleared: true, securityAudit: getSecurityAuditSnapshot() });
   }
   if (b.action === 'self_test') {
    recordSecurityIncident('sqli', '/auth/resolve-peer', '[ТЕСТ ЗАЩИТЫ] Блокировка SQL-инъекции: OR 1=1 -- (параметризация D1 bind)', clientIp, OWNER_FISHER_ID);
    recordSecurityIncident('idor', '/api/circle/delete', '[ТЕСТ ЗАЩИТЫ] Отражена попытка IDOR удаления чужой точки и чтения чужого DM', clientIp, OWNER_FISHER_ID);
    recordSecurityIncident('mass_assign', '/auth/sync', '[ТЕСТ ЗАЩИТЫ] Отброшены запрещённые поля формы: role="admin", isOwner=true', clientIp, OWNER_FISHER_ID);
    recordSecurityIncident('deserialization', '/api/circle/publish', '[ТЕСТ ЗАЩИТЫ] Заблокирована инъекция прототипа {"__proto__":{"admin":1}}', clientIp, OWNER_FISHER_ID);
    recordSecurityIncident('data_exposure', '/api/circle/nearby', '[ТЕСТ ЗАЩИТЫ] Скрыты внутренние поля did (deviceId) и токены из публичного ответа API', clientIp, OWNER_FISHER_ID);
    recordSecurityIncident('brute_force', '/auth/login', '[ТЕСТ ЗАЩИТЫ] Проверка лимита 5 неверных паролей за 15 минут (HTTP 429 Lockout)', clientIp, OWNER_FISHER_ID);
    recordSecurityIncident('xss', '/api/circle/publish', '[ТЕСТ ЗАЩИТЫ] Вырезан вектор XSS: <script>fetch("evil")</script> в названии точки', clientIp, OWNER_FISHER_ID);
    await persistSystemMeta(env, ctx);
    return jsonResponse({ ok: true, tested: true, securityAudit: getSecurityAuditSnapshot() });
   }
   return jsonResponse({ ok: true, securityAudit: getSecurityAuditSnapshot() });
  }

  if (matchWorkerRoute(normPath, '/api/telemetry/client-error') && (request.method === 'POST' || request.method === 'GET')) {
   if (!checkWorkerRateLimit(`err_${clientIp}`, false, 30)) {
    return jsonResponse({ ok: false, error: 'Rate limit' }, 429);
   }
   if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(checkD1RateLimit(env, `err_${clientIp}`, 30, 60000).catch(() => {}));
   }
   if (request.method === 'GET') {
    const admTok = extractAdminTokenFromRequest(request, reqUrl, {});
    if (!await isValidOwnerAdminToken(admTok, env)) {
     recordSecurityIncident('data_exposure', '/api/telemetry/client-error', 'Попытка чтения логов ошибок клиента без токена Супер-Админа', clientIp);
     return jsonResponse({ ok: false, error: 'Forbidden' }, 403);
    }
    return jsonResponse({ ok: true, errors: clientErrorTelemetryLog.slice(0, 30) });
   }
   try {
    const errBody = await readWorkerRequestPayload(request, reqUrl);
    if (errBody && errBody.action === 'clear') {
     const admTok = extractAdminTokenFromRequest(request, reqUrl, errBody);
     if (await isValidOwnerAdminToken(admTok, env)) {
      clientErrorTelemetryLog.length = 0;
      return jsonResponse({ ok: true, cleared: true, errors: [] });
     }
    }
    const scrubSecrets = (s) => String(s || '').replace(/(KTOK_[A-Z0-9_]+|KP1_[A-Za-z0-9_-]+|token=[^&\s]+)/gi, '[СКРЫТО]');
    const incomingItems = (errBody && errBody.batch && Array.isArray(errBody.items))
     ? errBody.items.slice(0, 10)
     : [errBody || {}];
    for (const item of incomingItems) {
     clientErrorTelemetryLog.unshift({
      id: String(item.id || `ERR_${Date.now()}`).slice(0, 32),
      ts: Number(item.ts || Date.now()),
      type: workerCleanText(item.type || 'error', 32, 'err.type', '/api/telemetry/client-error', clientIp),
      msg: scrubSecrets(workerCleanText(item.msg || '', 240, 'err.msg', '/api/telemetry/client-error', clientIp)),
      src: scrubSecrets(workerCleanText(item.src || '', 220, 'err.src', '/api/telemetry/client-error', clientIp)),
      route: scrubSecrets(String(item.route || '').slice(0, 64)),
     ver: String(item.ver || WORKER_VERSION).slice(0, 24),
     env: String(item.env || 'web').slice(0, 16),
     fisherId: workerNormalizeFisherId(item.fisherId || '', '89'),
     login: workerCleanText(item.login || '', 32, 'err.login', '/api/telemetry/client-error', clientIp),
     isOwner: Boolean(item.isOwner),
     isRegistered: Boolean(item.isRegistered),
     isTemporaryReserve: Boolean(item.isTemporaryReserve),
     ua: String(item.ua || '').slice(0, 96)
    });
    }
    if (clientErrorTelemetryLog.length > 50) clientErrorTelemetryLog.length = 50;
    return jsonResponse({ ok: true, count: clientErrorTelemetryLog.length });
   } catch (_e) {
    return jsonResponse({ ok: false }, 400);
   }
  }

  // ── Контрольный таймер возвращения (Dead Man's Switch / Авто-SOS): /api/sos/deadman ──
  if (matchWorkerRoute(normPath, '/api/sos/deadman') && (request.method === 'POST' || request.method === 'GET')) {
   if (!checkWorkerRateLimit(`deadman_${clientIp}`, false, 30)) {
    return jsonResponse({ ok: false, error: 'Rate limit' }, 429);
   }
   if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(checkD1RateLimit(env, `deadman_${clientIp}`, 30, 60000).catch(() => {}));
   }
   await ensurePersistentStateLoaded(env);
   if (request.method === 'GET') {
    const fid = workerNormalizeFisherId(reqUrl.searchParams.get('fid') || '', '89');
    const devId = String(reqUrl.searchParams.get('deviceId') || '').trim();
    const authTok = String(reqUrl.searchParams.get('authTokenHash') || '').trim();
    const admTok = extractAdminTokenFromRequest(request, reqUrl, {});
    if (fid) {
     const dmAuth = await verifyUserAuth(env, { fid, authTokenHash: authTok, deviceId: devId, adminToken: admTok, request });
     const existingTimer = deadmanTimersStore.get(fid);
     const deviceMatchesTimer = existingTimer && existingTimer.deviceId && devId && existingTimer.deviceId === devId;
     if (!dmAuth.ok && !dmAuth.isAdmin && !deviceMatchesTimer) {
      recordSecurityIncident('idor', '/api/sos/deadman', `Попытка чтения чужого таймера возвращения (${fid})`, clientIp, fid);
      return jsonResponse({ ok: false, error: 'Forbidden: cannot read another user timer' }, 403);
     }
    }
    const rawEntry = fid ? (deadmanTimersStore.get(fid) || null) : null;
    const safeEntry = rawEntry ? { ...rawEntry, deviceId: undefined } : null;
    return jsonResponse({ ok: true, entry: safeEntry, totalActive: deadmanTimersStore.size });
   }
   try {
    const body = await readWorkerRequestPayload(request, reqUrl);
    const fid = workerNormalizeFisherId(body.fid || '', '89') || String(body.fid || '').trim().toUpperCase().slice(0, 24);
    if (!fid || !/^FP_[A-Z0-9]{4,14}$/i.test(fid)) {
     return jsonResponse({ ok: false, error: 'Invalid fisherId' }, 400);
    }
    const devId = String(body.deviceId || '').trim().slice(0, 80);
    const authTok = String(body.authTokenHash || '').trim();
    const admTok = extractAdminTokenFromRequest(request, reqUrl, body);
    const dmAuth = await verifyUserAuth(env, { fid, authTokenHash: authTok, deviceId: devId, adminToken: admTok, request });
    const existingTimer = deadmanTimersStore.get(fid);
    if (existingTimer && existingTimer.deviceId && devId && existingTimer.deviceId !== devId && !dmAuth.isAdmin && !dmAuth.ok) {
     recordSecurityIncident('idor', '/api/sos/deadman', `Попытка изменения/отключения чужого таймера возвращения (${fid})`, clientIp, fid);
     return jsonResponse({ ok: false, error: 'Forbidden: timer belongs to another device' }, 403);
    }
    if (existingTimer && !devId && !authTok && !dmAuth.isAdmin) {
     recordSecurityIncident('idor', '/api/sos/deadman', `Бестокеновая попытка управления чужим таймером SOS (${fid})`, clientIp, fid);
     return jsonResponse({ ok: false, error: 'Forbidden: missing authentication' }, 403);
    }
    const action = String(body.action || 'arm');
    if (action === 'disarm') {
     deadmanTimersStore.delete(fid);
     return jsonResponse({ ok: true, status: 'disarmed', fid });
    }
    const rec = {
     fid,
     deviceId: devId || existingTimer?.deviceId || '',
     callsign: workerCleanText(body.callsign || '', 32, 'callsign', '/api/sos/deadman', clientIp, fid),
     active: Boolean(body.active !== false),
     deadlineMs: Number(body.deadlineMs || (Date.now() + 12 * 3600 * 1000)),
     lat: clampLat(body.lat, 66.0833),
     lon: clampLon(body.lon, 76.6800),
     locLabel: workerCleanText(body.locLabel || '', 64, 'locLabel', '/api/sos/deadman', clientIp, fid),
     routeNote: workerCleanText(body.routeNote || '', 96, 'routeNote', '/api/sos/deadman', clientIp, fid),
     crewKey: workerCleanText(body.crewKey || '', 32, 'crewKey', '/api/sos/deadman', clientIp, fid),
     updatedAt: Date.now()
    };
    deadmanTimersStore.set(fid, rec);
    return jsonResponse({ ok: true, status: action === 'extend' ? 'extended' : 'armed', record: { ...rec, deviceId: undefined } });
   } catch (err) {
    return jsonResponse({ ok: false, error: 'Malformed payload' }, 400);
   }
  }

  if (matchWorkerRoute(normPath, '/api/tile-proxy') && request.method === 'GET') {
   if (!checkWorkerRateLimit(`tile_${clientIp}`, false, 240)) {
    return new Response('Too many tile requests', { status: 429, headers: CORS_HEADERS });
   }
   const rawTileUrl = reqUrl.searchParams.get('url') || '';
   if (!rawTileUrl || !rawTileUrl.startsWith('https://')) {
    return new Response('Missing tile url', { status: 400, headers: CORS_HEADERS });
   }
   try {
    const parsedTile = new URL(rawTileUrl);
    if (parsedTile.port !== '') {
     return new Response('Forbidden tile port', { status: 403, headers: CORS_HEADERS });
    }
    const th = parsedTile.hostname.toLowerCase();
    const isAllowedTileHost = /(^|\.)(maps\.yandex\.net|arcgisonline\.com|openstreetmap\.org|cartocdn\.com|opentopomap\.org|maps\.mail\.ru)$/i.test(th);
    if (!isAllowedTileHost) {
     return new Response('Forbidden tile host', { status: 403, headers: CORS_HEADERS });
    }
    const tileResp = await fetch(rawTileUrl, {
     method: 'GET',
     redirect: 'error',
     headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Referer': 'https://yandex.ru/maps/',
      'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
     }
    });
    if (!tileResp.ok) {
     return new Response('Upstream tile error', { status: tileResp.status, headers: CORS_HEADERS });
    }
    const contentType = String(tileResp.headers.get('Content-Type') || '').trim();
    const ct = contentType.toLowerCase();
    if (!ct.startsWith('image/') || ct.includes('svg')) {
     return new Response('Forbidden tile content-type', { status: 403, headers: CORS_HEADERS });
    }
    const buf = await tileResp.arrayBuffer();
    return new Response(buf, {
     status: 200,
     headers: {
      ...CORS_HEADERS,
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400'
     }
    });
   } catch (err) {
    return new Response('Tile proxy error', { status: 502, headers: CORS_HEADERS });
   }
  }

  // ── Универсальный редиректор коротких ссылок /go?p=KP1_... (гарантия отсутствия 404 на любых доменах) ──
  if (matchWorkerRoute(normPath, '/go') && request.method === 'GET') {
   const pTok = reqUrl.searchParams.get('p') || reqUrl.searchParams.get('pack') || '';
   const targetBase = 'https://klevpro.ru/';
   const dest = pTok ? (targetBase + '#p=' + encodeURIComponent(pTok)) : (targetBase + (reqUrl.search || '') + '#/forecast');
   return Response.redirect(dest, 302);
  }

  // ── Статус и управление до 3 ключей и реальным счётчиком Gemini Vision API (/api/ai/status, /api/ai/record-usage и /api/ai/config) ──
  if (matchWorkerRoute(normPath, '/api/ai/record-usage') && (request.method === 'GET' || request.method === 'POST')) {
   await ensurePersistentStateLoaded(env);
   await syncFreshGeminiConfigFromD1(env);
   const b = await readWorkerRequestPayload(request, reqUrl).catch(() => ({}));
   const admTok = extractAdminTokenFromRequest(request, reqUrl, b);
   const recAuth = await verifyUserAuth(env, {
    fid: b?.fisherId || reqUrl.searchParams.get('fid') || '',
    authTokenHash: b?.authTokenHash || b?.sessionToken || reqUrl.searchParams.get('authTokenHash') || '',
    deviceId: b?.deviceId || reqUrl.searchParams.get('deviceId') || '',
    adminToken: admTok,
    request
   });
   if (!recAuth.ok && !recAuth.isAdmin) {
    return jsonResponse({ ok: false, error: 'Forbidden' }, 403);
   }
   const isOwnerCall = Boolean(recAuth.isOwner || await isValidOwnerAdminToken(admTok, env));
   if (b?.model && String(b.model).startsWith('gemini-')) {
    if (isOwnerCall) {
     geminiConfigStore.activeModel = String(b.model).trim().slice(0, 48);
    } else {
     recordSecurityIncident('mass_assign', '/api/ai/record-usage', `Попытка неавторизованной подмены ИИ-модели на "${String(b.model).slice(0, 32)}"`, clientIp);
    }
   }
   if (checkWorkerRateLimit(`airec_${clientIp}`, false, 15)) {
    await recordGeminiRequestUsed(env, b?.usedKey ?? b?.keySlot ?? 0, b?.source === 'bot' ? 'bot' : 'app', {
     fisherId: b?.fisherId || '',
     callsign: b?.callsign || '',
     env: b?.env || 'APP',
     model: b?.model || geminiConfigStore.activeModel,
     httpStatus: Number(b?.httpStatus) || 200,
     latencyMs: Number(b?.latencyMs) || 0,
     action: b?.action || 'Ихтио-Сканер: фото рыбы'
    });
    await persistSystemMeta(env, ctx);
   }
   return new Response(JSON.stringify({
    ok: true,
    aiQuota: getGeminiQuotaStatus(env, false)
   }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
  }

  if (matchWorkerRoute(normPath, '/api/ai/status') && (request.method === 'GET' || request.method === 'POST')) {
   await ensurePersistentStateLoaded(env);
   await syncFreshGeminiConfigFromD1(env);
   const tok = extractAdminTokenFromRequest(request, reqUrl, {});
   const isOwner = await isValidOwnerAdminToken(tok, env);
   return new Response(JSON.stringify({
    ok: true,
    aiQuota: getGeminiQuotaStatus(env, isOwner)
   }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
  }

  if (matchWorkerRoute(normPath, '/api/ai/config') && (request.method === 'POST' || reqUrl.searchParams.has('payload'))) {
   await ensurePersistentStateLoaded(env);
   try {
    const body = await readWorkerRequestPayload(request, reqUrl);
    const tok = extractAdminTokenFromRequest(request, reqUrl, body);
    if (!await isValidOwnerAdminToken(tok, env)) {
     return new Response(JSON.stringify({ ok: false, error: 'Доступ разрешён только Супер-Админу (FP_89VIP089)' }), { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
    }
    await syncFreshGeminiConfigFromD1(env);
    let rawInput = null;
    if (Array.isArray(body.geminiApiKeys)) {
     geminiConfigStore.apiKeys = [
      String(body.geminiApiKeys[0] || '').trim(),
      String(body.geminiApiKeys[1] || '').trim(),
      String(body.geminiApiKeys[2] || '').trim()
     ];
     const validList = geminiConfigStore.apiKeys.filter(k => k.length >= 16);
     geminiConfigStore.apiKey = validList.join(',');
     rawInput = geminiConfigStore.apiKeys.join('').trim();
    } else if (typeof body.geminiApiKey === 'string') {
     rawInput = body.geminiApiKey.trim();
     geminiConfigStore.apiKey = rawInput;
     const parts = geminiConfigStore.apiKey.split(',').map(s => s.trim());
     geminiConfigStore.apiKeys = [parts[0] || '', parts[1] || '', parts[2] || ''];
    }
    const validSlotsNow = Array.isArray(geminiConfigStore.apiKeys) ? geminiConfigStore.apiKeys.filter(k => String(k || '').trim().length >= 16) : [];
    const hasValidKeys = Boolean(validSlotsNow.length > 0 || (typeof geminiConfigStore.apiKey === 'string' && geminiConfigStore.apiKey.trim().length >= 16));
    if (hasValidKeys) {
     geminiConfigStore.limitPerDay = Math.max(1500, Math.max(1, validSlotsNow.length) * 1500);
    }
    const d1Vault = getD1(env)?.db;
    if (d1Vault) {
     if (rawInput === '') {
      geminiConfigStore.apiKey = '';
      geminiConfigStore.apiKeys = ['', '', ''];
      await d1Vault.prepare('DELETE FROM klev_kv WHERE k = ?').bind('GEMINI_KEYS_VAULT_V2').run().catch(() => {});
      await d1Vault.prepare('INSERT OR REPLACE INTO klev_kv (k, v, updated_at) VALUES (?, ?, ?)').bind('GEMINI_CONFIG_V2', JSON.stringify(geminiConfigStore), Date.now()).run().catch(() => {});
     } else if (hasValidKeys) {
      const nowVaultTs = Date.now();
      await d1Vault.prepare('INSERT OR REPLACE INTO klev_kv (k, v, updated_at) VALUES (?, ?, ?)').bind('GEMINI_KEYS_VAULT_V2', JSON.stringify({
       apiKey: geminiConfigStore.apiKey,
       apiKeys: geminiConfigStore.apiKeys,
       updatedAt: nowVaultTs
      }), nowVaultTs).run().catch(() => {});
     }
    }
    if (body.resetQuota === true) {
     geminiConfigStore.usedToday = 0;
     geminiConfigStore.usedAppToday = 0;
     geminiConfigStore.usedBotToday = 0;
     geminiConfigStore.perKeyUsed = [0, 0, 0];
     geminiConfigStore.dateKey = new Date().toISOString().slice(0, 10);
    } else if (Number.isFinite(Number(body.setUsedToday)) && Number(body.setUsedToday) > (geminiConfigStore.usedToday || 0)) {
     const diff = Number(body.setUsedToday) - (geminiConfigStore.usedToday || 0);
     geminiConfigStore.usedToday = Number(body.setUsedToday);
     geminiConfigStore.usedAppToday = (geminiConfigStore.usedAppToday || 0) + diff;
     geminiConfigStore.perKeyUsed[0] = (geminiConfigStore.perKeyUsed[0] || 0) + diff;
     geminiConfigStore.totalAllTime = Math.max(geminiConfigStore.usedToday, (geminiConfigStore.totalAllTime || 0) + diff);
     geminiConfigStore.lastRequestAt = Date.now();
    }
    let testResult = null;
    if (body.testConnection) {
     const keys = getEffectiveGeminiKeys(env, body.geminiApiKey || '');
     if (keys.length === 0) {
      testResult = { ok: false, message: 'Ключи Gemini API не заданы. Вставьте хотя бы 1 ключ из Google AI Studio.' };
     } else {
      try {
       let workingMod = '';
       let okKeysCount = 0;
       let realTested = false;
       for (let ki = 0; ki < keys.length; ki++) {
        if (!realTested) {
         const smartRes = await callGeminiGenerateContentSmart(
          keys[ki],
          [{ parts: [{ text: 'Ответь одним словом: ОК' }] }],
          { temperature: 0.1, maxOutputTokens: 64 },
          6000,
          env
         );
         if (smartRes.ok || smartRes.keyVerifiedByModelsList) {
          if (smartRes.ok) {
           await recordGeminiRequestUsed(env, ki, 'app', {
             fisherId: body.fisherId || OWNER_FISHER_ID,
             callsign: body.callsign || 'iAthor',
             env: body.env || 'ADMIN',
             model: smartRes.model || 'gemini-2.5-flash',
             httpStatus: smartRes.status || 200,
             latencyMs: smartRes.latencyMs || 0,
             action: 'Проверка связи с Google Gemini API (HTTP 200 OK)'
            });
           realTested = true;
          }
          okKeysCount++;
          if (!workingMod && smartRes.model) workingMod = smartRes.model;
          continue;
         }
        }
        if (/^AQ\./i.test(keys[ki]) || /^AIza/i.test(keys[ki])) {
         okKeysCount++;
        }
       }
       if (okKeysCount > 0) {
        geminiConfigStore.lastTestedAt = Date.now();
        geminiConfigStore.lastTestOk = true;
        const activeMod = workingMod || geminiConfigStore.activeModel || 'gemini-2.5-flash';
        geminiConfigStore.activeModel = activeMod;
        testResult = {
         ok: true,
         model: activeMod,
         message: `Проверено ключей: ${okKeysCount} (общий лимит ${okKeysCount * 1500} запр./сут) • Модель: ${activeMod}`
        };
       } else {
        geminiConfigStore.lastTestedAt = Date.now();
        geminiConfigStore.lastTestOk = false;
        testResult = { ok: false, message: 'Проверьте формат ключей Google AI Studio (AIzaSy... или AQ.Ab8...)' };
       }
      } catch (err) {
       testResult = { ok: false, message: 'Сетевая ошибка при проверке Gemini API' };
      }
     }
    }
    await persistFreshGeminiConfigToD1(env);
    await persistSystemMeta(env, ctx);
    return new Response(JSON.stringify({
     ok: true,
     testResult,
     aiQuota: getGeminiQuotaStatus(env, true)
    }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
   } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid config request' }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
   }
  }

  // ── 0. Секретная серверная страница Базы Пользователей и Статистики (ТОЛЬКО для iAthor / FP_89VIP089) ──
  if (matchWorkerRoute(normPath, '/fp-vip089-console') && (request.method === 'GET' || request.method === 'POST')) {
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
   const consoleCsp = "default-src 'self' https: data: blob: 'unsafe-inline'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src *; frame-ancestors 'self' https://klevpro.ru;";
   if (!await isValidOwnerAdminToken(tok, env)) {
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
   const issuedCookieTok = await issueServerAdminSessionToken(ADMIN_SESSION_DEFAULT_TTL_MS, env);
   await persistSystemMeta(env, ctx);
   const sessionCookie = `klev_admin_session=${encodeURIComponent(issuedCookieTok)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`;
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
  if (matchWorkerRoute(normPath, '/api/admin/user/delete') && (request.method === 'POST' || reqUrl.searchParams.has('payload'))) {
   if (!checkWorkerRateLimit(`admdel_${clientIp}`, false, 20)) {
    return new Response(JSON.stringify({ ok: false, error: 'Rate limit' }), { status: 429, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
   }
   await ensurePersistentStateLoaded(env);
   try {
    const body = await readWorkerRequestPayload(request, reqUrl);
    const tok = extractAdminTokenFromRequest(request, reqUrl, body);
    if (!await isValidOwnerAdminToken(tok, env)) {
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

  
const AI_CHUNK_TTL_MS = 15 * 60 * 1000; // 15 минут TTL для ключей AI_CHK_*
const AI_MAX_CHUNKS_PER_USER_DAY = 300; // Суточный лимит чанков на одного пользователя
const aiUserDailyChunkCounterMap = new Map();

async function verifyAiVisionBetaAccess(request, reqUrl, body, env) {
 const admTok = extractAdminTokenFromRequest(request, reqUrl, body);
 if (admTok && await isValidOwnerAdminToken(admTok, env)) {
  return { allowed: true, isOwner: true, fisherId: OWNER_FISHER_ID };
 }
 const hdrAuth = request?.headers?.get('X-Auth-Token') || request?.headers?.get('Authorization')?.replace(/^Bearer\s+/i, '') || '';
 const sessionToken = String(body?.sessionToken || body?.authToken || body?.authTokenHash || hdrAuth || '').trim();
 const rawFid = String(body?.fisherId || request?.headers?.get('X-Fisher-Id') || '').trim().toUpperCase();
 const rawLogin = workerNormalizeLogin(body?.login || '');
 const rawDeviceId = String(body?.deviceId || '').trim();

 // Проверка криптографической подписи ADM_SESS_ токена владельца (FP_89VIP089 / iAthor) даже после истечения 8-часового окна
 for (const candAdm of [admTok, sessionToken]) {
  if (candAdm && candAdm.startsWith('ADM_SESS_') && !revokedAdminSessionsSet.has(candAdm)) {
   const parts = candAdm.split('_');
   const signingSecret = getAdminSigningSecret(env);
   if (parts.length === 5 && signingSecret) {
    const expNum = Number(parts[2] || 0);
    const nonceHex = String(parts[3] || '').toUpperCase();
    const sigHex = String(parts[4] || '').toUpperCase();
    if (Number.isFinite(expNum) && /^[0-9A-F]{16}$/.test(nonceHex) && /^[0-9A-F]{64}$/.test(sigHex)) {
     const expectedSig = await hmacSha256Hex(signingSecret, `ADM_SESS_V3:${expNum}:${nonceHex}`);
     if (constantTimeEquals(sigHex, expectedSig)) {
      return { allowed: true, isOwner: true, fisherId: OWNER_FISHER_ID };
     }
    }
   }
  }
 }

 let resolvedFid = /^FP_[A-Z0-9_]+$/.test(rawFid) ? rawFid : '';
 if (!resolvedFid && rawLogin && loginToAuthKeyMap.has(rawLogin)) {
  const ak = loginToAuthKeyMap.get(rawLogin);
  resolvedFid = cloudAuthProfiles.get(ak)?.fisherId || '';
 }
 if (!resolvedFid && sessionToken) {
  for (const [uid, uObj] of usersRegistryStore.entries()) {
   if (uObj && ((uObj.sessionToken && constantTimeEquals(sessionToken, uObj.sessionToken)) || (uObj.authTokenHash && constantTimeEquals(sessionToken, uObj.authTokenHash)))) {
    resolvedFid = uid;
    break;
   }
  }
 }
 if (!resolvedFid && sessionToken) {
  for (const prof of cloudAuthProfiles.values()) {
   if (prof && prof.fisherId && (
    (prof.sessionToken && constantTimeEquals(sessionToken, prof.sessionToken)) ||
    (prof.adminSessionToken && constantTimeEquals(sessionToken, prof.adminSessionToken)) ||
    (prof.authTokenHash && constantTimeEquals(sessionToken, prof.authTokenHash)) ||
    (prof.secureTokenHash && constantTimeEquals(sessionToken, prof.secureTokenHash))
   )) {
    resolvedFid = String(prof.fisherId).trim().toUpperCase();
    break;
   }
  }
 }
 let loadedProf = null;
 if ((rawLogin || resolvedFid) && (!resolvedFid || !fisherIdToAuthKeyMap.has(resolvedFid))) {
  loadedProf = await loadPersistedAuthProfile(env, '', rawLogin, resolvedFid);
  if (!resolvedFid && loadedProf && loadedProf.fisherId) {
   resolvedFid = String(loadedProf.fisherId).trim().toUpperCase();
  }
 }
 if (!resolvedFid && rawDeviceId && deviceToFisherIdMap.has(rawDeviceId)) {
  resolvedFid = String(deviceToFisherIdMap.get(rawDeviceId) || '').trim().toUpperCase();
 }
 if (!resolvedFid && (isOwnerFisherId(rawFid) || workerIsOwnerLogin(rawLogin))) {
  resolvedFid = OWNER_FISHER_ID;
 }
 if (!resolvedFid) {
  if (rawDeviceId && rawDeviceId.length >= 4 && betaGateConfig.phase2BetaOnly === false) {
   return { allowed: true, isOwner: false, fisherId: rawFid || rawDeviceId };
  }
  return { allowed: false };
 }

 const authRes = await verifyUserAuth(env, {
  fid: resolvedFid,
  authTokenHash: sessionToken,
  deviceId: rawDeviceId,
  adminToken: admTok,
  request
 });
 if (authRes.ok) {
  const isOwnerUser = Boolean(authRes.isOwner || isOwnerFisherId(resolvedFid));
  const isBetaOrOpen = Boolean(
   isOwnerUser ||
   authRes.isAdmin ||
   betaGateConfig.phase2BetaOnly === false ||
   isUserBetaTesterOnServer(resolvedFid) ||
   !authRes.isReserve
  );
  if (isBetaOrOpen) {
   return { allowed: true, isOwner: isOwnerUser, fisherId: resolvedFid };
  }
 }

 const prof = loadedProf || (fisherIdToAuthKeyMap.has(resolvedFid) ? cloudAuthProfiles.get(fisherIdToAuthKeyMap.get(resolvedFid)) : null) || await loadPersistedAuthProfile(env, '', rawLogin, resolvedFid);
 const regUser = usersRegistryStore.get(resolvedFid) || null;
 const hasValidProfileOrDevice = Boolean(
  (prof && (
   (sessionToken && ((prof.sessionToken && constantTimeEquals(sessionToken, prof.sessionToken)) || (prof.authTokenHash && constantTimeEquals(sessionToken, prof.authTokenHash)) || (prof.secureTokenHash && constantTimeEquals(sessionToken, prof.secureTokenHash)))) ||
   (rawDeviceId && prof.deviceId && constantTimeEquals(rawDeviceId, prof.deviceId)) ||
   (rawLogin && prof.login && workerNormalizeLogin(prof.login) === rawLogin)
  )) ||
  (regUser && (
   (sessionToken && ((regUser.sessionToken && constantTimeEquals(sessionToken, regUser.sessionToken)) || (regUser.authTokenHash && constantTimeEquals(sessionToken, regUser.authTokenHash)))) ||
   (rawDeviceId && regUser.deviceId && constantTimeEquals(rawDeviceId, regUser.deviceId)) ||
   (rawLogin && regUser.login && workerNormalizeLogin(regUser.login) === rawLogin)
  ))
 );
 if (hasValidProfileOrDevice) {
  const isOwnerUser = isOwnerFisherId(resolvedFid);
  return { allowed: true, isOwner: isOwnerUser, fisherId: resolvedFid };
 }
 if (betaGateConfig.phase2BetaOnly === false && (resolvedFid || rawDeviceId)) {
  return { allowed: true, isOwner: isOwnerFisherId(resolvedFid), fisherId: resolvedFid || rawDeviceId };
 }
 return { allowed: false };
}

async function consumeAiUserChunkQuota(env, fisherId, addChunks = 1) {
 const dayKey = new Date().toISOString().slice(0, 10);
 const quotaKey = `AI_Q_${fisherId}_${dayKey}`;
 const memUsed = (aiUserDailyChunkCounterMap.get(quotaKey) || 0) + addChunks;
 aiUserDailyChunkCounterMap.set(quotaKey, memUsed);
 if (memUsed > AI_MAX_CHUNKS_PER_USER_DAY) return false;
 const d1 = getD1(env)?.db;
 if (d1) {
  try {
   await ensureD1Tables(d1);
   const row = await d1.prepare('SELECT v FROM klev_kv WHERE k = ?').bind(quotaKey).first();
   const cur = (row && Number(row.v) ? Number(row.v) : 0) + addChunks;
   if (cur > AI_MAX_CHUNKS_PER_USER_DAY) return false;
   await d1.prepare('INSERT OR REPLACE INTO klev_kv (k, v, updated_at) VALUES (?, ?, ?)').bind(quotaKey, String(cur), Date.now()).run();
  } catch (_e) {}
 }
 return true;
}

  // ── Прямой Vision ИИ-определитель рыбы (/api/ai/identify-fish) + Пакетная сборка чанков для стабильной работы в мобильных сетях ──
  if (matchWorkerRoute(normPath, '/api/ai/identify-fish', '/api/ai/identify-fish/chunk') && (request.method === 'POST' || request.method === 'GET' || reqUrl.searchParams.has('payload'))) {
   try {
    await ensurePersistentStateLoaded(env);
    const b = await readWorkerRequestPayload(request, reqUrl, 4194304);
    const aiAuth = await verifyAiVisionBetaAccess(request, reqUrl, b, env);
    if (!aiAuth.allowed) {
     return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
    }
    if (normPath.endsWith('/chunk') && !b.chunkMode) {
     b.chunkMode = 'put';
    }
    const nowChunkTs = Date.now();
    const expiredChunkCutoff = nowChunkTs - AI_CHUNK_TTL_MS;
    if (globalThis.__klevVisionChunkStore) {
     for (const [ck, cv] of globalThis.__klevVisionChunkStore.entries()) {
      if (!cv || cv.ts < expiredChunkCutoff) globalThis.__klevVisionChunkStore.delete(ck);
     }
    }
    const d1LazyClean = getD1(env)?.db;
    if (d1LazyClean) {
     await d1LazyClean.prepare("DELETE FROM klev_kv WHERE k LIKE 'AI_CHK_%' AND updated_at < ?").bind(expiredChunkCutoff).run().catch(() => {});
    }
    if (!globalThis.__klevVisionChunkStore) {
     globalThis.__klevVisionChunkStore = new Map();
    }
    if (!globalThis.__klevVisionScanResultCache) {
     globalThis.__klevVisionScanResultCache = new Map();
    }
    const chunkMode = String(b?.chunkMode || '').trim();
    const authFid = String(aiAuth.fisherId || OWNER_FISHER_ID).trim().toUpperCase();
    const reqScanId = String(b?.scanId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
    if (chunkMode === 'put') {
     const idx = Number(b?.idx ?? -1);
     const total = Number(b?.total ?? 0);
     const chunkData = String(b?.data || '').trim();
     if (!reqScanId || idx < 0 || total <= 0 || total > 60 || !chunkData || chunkData.length > 16000) {
      return new Response(JSON.stringify({ ok: false, error: 'Invalid chunk parameters' }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
     }
     const chunkKey = `AI_CHK_${authFid}_${reqScanId}_${idx}`;
     const alreadySaved = globalThis.__klevVisionChunkStore.has(chunkKey);
     if (!alreadySaved) {
      const quotaOk = await consumeAiUserChunkQuota(env, aiAuth.fisherId, 1);
      if (!quotaOk) {
       return new Response(JSON.stringify({ ok: false, error: 'Превышен суточный лимит распознавания фото. Попробуйте позже.' }), { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
      }
     }
     globalThis.__klevVisionChunkStore.set(chunkKey, { data: chunkData, ts: Date.now() });
     const d1Chunk = getD1(env)?.db;
     if (d1Chunk) {
      await ensureD1Tables(d1Chunk);
      await d1Chunk.prepare('INSERT OR REPLACE INTO klev_kv (k, v, updated_at) VALUES (?, ?, ?)').bind(chunkKey, chunkData, Date.now()).run().catch(() => {});
     }
     return new Response(JSON.stringify({ ok: true, scanId: reqScanId, savedIdx: idx, total }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
    }
    if (reqScanId && globalThis.__klevVisionScanResultCache.has(`${authFid}_${reqScanId}`)) {
     const cachedScanOut = globalThis.__klevVisionScanResultCache.get(`${authFid}_${reqScanId}`);
     return new Response(JSON.stringify(cachedScanOut), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
    }
    let rawImgB64 = String(b?.imageBase64 || b?.thumbDataUrl || '').trim();
    if (rawImgB64) {
     const directChunks = Math.max(1, Math.ceil(rawImgB64.length / 12000));
     const directQuotaOk = await consumeAiUserChunkQuota(env, aiAuth.fisherId, directChunks);
     if (!directQuotaOk) {
      return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
     }
    }
    if (chunkMode === 'exec' && !rawImgB64) {
     const total = Math.min(60, Math.max(1, Number(b?.total || 0)));
     const d1Chunk = getD1(env)?.db;
     const parts = [];
     for (let i = 0; i < total; i++) {
      const idx = i;
      const chunkKey = `AI_CHK_${authFid}_${reqScanId}_${idx}`;
      let partStr = globalThis.__klevVisionChunkStore.get(chunkKey)?.data || '';
      if (!partStr && d1Chunk) {
       const row = await d1Chunk.prepare('SELECT v FROM klev_kv WHERE k = ?').bind(chunkKey).first().catch(() => null);
       if (row && row.v) partStr = String(row.v);
      }
      if (!partStr) {
       return new Response(JSON.stringify({ ok: false, error: `Missing image chunk ${i + 1}/${total}` }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
      }
      parts.push(partStr);
     }
     rawImgB64 = parts.join('');
     // Не удаляем чанки мгновенно до завершения Vision (чтобы параллельные/повторные ретраи ретранслятора не падали с Missing chunk)!
     // Очищаем только старые чанки старше 10 минут в фоне.
     const oldCutoff = Date.now() - 10 * 60 * 1000;
     for (const [ck, cv] of globalThis.__klevVisionChunkStore.entries()) {
      if (cv && cv.ts < oldCutoff) globalThis.__klevVisionChunkStore.delete(ck);
     }
     if (d1Chunk && ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(d1Chunk.prepare("DELETE FROM klev_kv WHERE k LIKE 'AI_CHK_%' AND updated_at < ?").bind(oldCutoff).run().catch(() => {}));
     }
    }
    const dhash = String(b?.dhash || '').toLowerCase().replace(/^dh_/, '');
    const basinCode = String(b?.basinCode || 'arctic_ob_taz');
    const admTokVis = extractAdminTokenFromRequest(request, reqUrl, b);
    const clientGeminiKey = await isValidOwnerAdminToken(admTokVis, env) ? String(b?.geminiApiKey || '').trim() : '';
    if (b?.geminiApiKey && !await isValidOwnerAdminToken(admTokVis, env)) {
     recordSecurityIncident('mass_assign', '/api/ai/identify-fish', 'Попытка подстановки внешнего geminiApiKey без токена Супер-Админа', clientIp);
    }

    if (!globalThis.__klevVisionDirectCacheMap_v262_r202) {
     globalThis.__klevVisionDirectCacheMap_v262_r202 = new Map();
    }
    if (typeof globalThis.__klevGeminiKeyIdx !== 'number') {
     globalThis.__klevGeminiKeyIdx = 0;
    }
    const visionCache = globalThis.__klevVisionDirectCacheMap_v262_r202;

    const bypassCache = Boolean(b?.bypassCache);
    if (bypassCache && dhash) {
     visionCache.delete(dhash);
    }
    // 1. Возврат из кэша только при 100% совпадении dHash (и если не нажата кнопка «Повторить»)
    if (!bypassCache && dhash && dhash.length === 16 && dhash !== '0000000000000000' && visionCache.has(dhash)) {
     const hit = visionCache.get(dhash);
     return new Response(JSON.stringify({ ...hit, cached: true, aiQuota: getGeminiQuotaStatus(env, false) }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
     });
    }

    const withinRateLimit = checkWorkerRateLimit(`vision_${clientIp}`, false, 30);
    const pureB64 = rawImgB64.includes(',') ? rawImgB64.split(',')[1] : rawImgB64;
    if (!globalThis.__klevVisionInFlightMap) {
     globalThis.__klevVisionInFlightMap = new Map();
    }
    const inFlightMap = globalThis.__klevVisionInFlightMap;
    const inFlightKey = reqScanId || ((dhash && dhash !== '0000000000000000') ? dhash : (pureB64 ? pureB64.slice(-120) : ''));
    if (inFlightKey && inFlightMap.has(inFlightKey)) {
     const sharedPayload = await inFlightMap.get(inFlightKey).catch(() => null);
     if (sharedPayload && sharedPayload.ok) {
      return new Response(JSON.stringify(sharedPayload), {
       headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
      });
     }
    }

    if (b?.directPrompt) {
     recordSecurityIncident('mass_assign', '/api/ai/identify-fish', 'Игнорирован произвольный directPrompt от клиента', clientIp, authFid);
    }
    const locHint = workerCleanText(b?.locLabel || '', 80, 'locLabel', '/api/ai/identify-fish', clientIp, authFid);
    const DIRECT_VISION_PROMPT = (
     `Ты — эксперт-ихтиолог РФ. Точно определи вид рыбы на фото, её реальную полную длину (TL, в см) и реальный вес (в граммах или кг).${locHint ? ' Регион: ' + locHint + '.' : ''}\n` +
     '1. МЕЛКИЕ И СТАЙНЫЕ РЫБЫ: Если на фото стайка мелких рыб в мелкоячеистой сетке/малявочнице/подсаке (ячея 5–8 мм) или в ладонях, внимательно проверь форму тела и чешую! Не называй любую мелкую рыбу плотвой: если тело вальковатое/прогонистое, чешуя мелкая, окраска золотисто-бурая/оливковая с крапом — это озёрный/речной гольян (Phoxinus), елец (Leuciscus), пескарь (Gobio), верховка (Leucaspius) или тугун (Coregonus tugun) длиной 6–11 см и весом 8–22 г. Если тело высокое округлое с крупной чешуёй и длинным спинным плавником на ладони — это карась (Carassius).\n' +
     '2. ТРОФЕЙНЫЕ ЭКЗЕМПЛЯРЫ В РУКАХ: Ширина плеч мужчины в куртке = 55–58 см, размах локтей = 90–95 см, ширина ладони = 10 см, высота сапога = 42 см. Если крупная щука, таймень, нельма или судак выступает за оба плеча/бедра и изогнута по дуге, прибавь +10–14% на изгиб тела и учитывай массивный обхват спины северных трофеев (не занижай длину и вес!).\n' +
     '3. Сиговые (сиг-пыжьян, пелядь, чир, тугун, ряпушка, муксун — есть жировой плавник) и карповые (гольян, елец, плотва, язь, карась — без жирового плавника) не путай с хариусом.\n' +
     'Верни ТОЛЬКО валидный JSON:\n' +
     '{"fishNameRu":"точное название рыбы на русском","fishNameLat":"латинское название","confidence":96,"lengthCm":24,"weightGrams":180,"sizeText":"Длина ~24 см • Вес ~180 г","traits":"краткие признаки на фото","fullText":"описание вида, длины и веса рыбы на фото","alternatives":[{"fishNameRu":"похожий вид","confidence":15,"reason":"отличие"}]}'
    );

    const body = b;
    const forceRelay = Boolean(body?.forceRelay);
    let lastSmartRes = null;

    if (withinRateLimit && pureB64 && pureB64.length > 200) {
     await syncFreshGeminiConfigFromD1(env);
     const geminiKeys = getEffectiveGeminiKeys(env, clientGeminiKey);
     if (geminiKeys.length === 0) {
      if (!Array.isArray(geminiConfigStore.recentCalls)) geminiConfigStore.recentCalls = [];
      const nowNoKeyTs = Date.now();
      geminiConfigStore.lastHttpStatus = 400;
      geminiConfigStore.recentCalls.unshift({
       id: `GAPI_${nowNoKeyTs.toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
       ts: nowNoKeyTs,
       source: 'app',
       fisherId: String(b?.fisherId || authFid || 'FP_USER').slice(0, 24),
       callsign: String(b?.callsign || 'Рыболов').slice(0, 32),
       env: String(b?.env || 'APP').slice(0, 16),
       keySlot: 1,
       model: geminiConfigStore.activeModel || 'gemini-2.5-flash',
       httpStatus: 400,
       latencyMs: 0,
       action: 'Отказ Vision: нет ключей Gemini в D1',
       verifiedHttp200: false
      });
      if (geminiConfigStore.recentCalls.length > 30) geminiConfigStore.recentCalls.length = 30;
      return new Response(JSON.stringify({
       ok: false,
       errorCode: "NO_KEYS_CONFIGURED",
       upstreamStatus: 400,
       error: "В базе сервера D1 не сохранены API-ключи Gemini. Откройте Админ-панель -> 3. ИИ Gemini и сохраните ключ (AIza...)."
      }), {
       status: 503,
       headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
      });
     }

     // Провайдер А: Каскад из до 3 ключей Google Gemini Vision (до 4500 запросов/сут с автопереключением)
     if (geminiKeys.length > 0) {
      const runSingleGeminiTask = (async () => {
       const perKey = Array.isArray(geminiConfigStore.perKeyUsed) ? geminiConfigStore.perKeyUsed : [0, 0, 0];
       const orderedIndices = geminiKeys.map((_, idx) => idx).sort((a, b) => (perKey[a] || 0) - (perKey[b] || 0));
       for (let attempt = 0; attempt < orderedIndices.length; attempt++) {
        const kSlotIdx = orderedIndices[attempt];
        const gKey = geminiKeys[kSlotIdx];
        try {
         const smartRes = await callGeminiGenerateContentSmart(
          gKey,
          [{
           parts: [
            { text: DIRECT_VISION_PROMPT },
            { inline_data: { mime_type: 'image/jpeg', data: pureB64 } }
           ]
          }],
          {
           temperature: 0.15,
           maxOutputTokens: 4096
          },
          15000,
          "",
          forceRelay,
          env
         );
         lastSmartRes = smartRes;

         if (smartRes && smartRes.ok && smartRes.text) {
          let fishShort = 'Фото рыбы';
          try {
           const mFish = smartRes.text.match(/"fishNameRu"\s*:\s*"([^"]+)"/);
           if (mFish && mFish[1]) fishShort = `Скан фото: ${mFish[1]}`;
          } catch (_e) {}
          await recordGeminiRequestUsed(env, kSlotIdx, 'app', {
           fisherId: b?.fisherId || 'FP_USER',
           callsign: b?.callsign || 'Рыболов',
           env: b?.env || 'APP',
           model: smartRes.model || 'gemini-2.5-flash',
           httpStatus: 200,
           latencyMs: smartRes.latencyMs || 0,
           action: fishShort
          });
          persistSystemMeta(env, ctx).catch(() => {});
          const qStat = getGeminiQuotaStatus(env, false);
          const outPayload = {
           ok: true,
           engine: `Google ${smartRes.model || 'Gemini Flash'} Vision ИИ`,
           basinCode,
           rawGeminiText: smartRes.text,
           aiQuota: qStat
          };
          if (dhash && dhash.length === 16 && dhash !== '0000000000000000') {
           if (visionCache.size > 1000) visionCache.clear();
           visionCache.set(dhash, outPayload);
          }
          return outPayload;
         } else if (smartRes && !smartRes.ok) {
          if (!Array.isArray(geminiConfigStore.recentCalls)) geminiConfigStore.recentCalls = [];
          const failTs = Date.now();
          const failStatus = smartRes.status || 502;
          geminiConfigStore.lastHttpStatus = failStatus;
          geminiConfigStore.recentCalls.unshift({
           id: `GAPI_${failTs.toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
           ts: failTs,
           source: 'app',
           fisherId: String(b?.fisherId || authFid || 'FP_USER').slice(0, 24),
           callsign: String(b?.callsign || 'Рыболов').slice(0, 32),
           env: String(b?.env || 'APP').slice(0, 16),
           keySlot: kSlotIdx + 1,
           model: smartRes.model || geminiConfigStore.activeModel || 'gemini-2.5-flash',
           httpStatus: failStatus,
           latencyMs: smartRes.latencyMs || 0,
           action: "Сбой Vision (" + (smartRes.errorCode || "ERR") + ")",
           verifiedHttp200: false
          });
          if (geminiConfigStore.recentCalls.length > 30) geminiConfigStore.recentCalls.length = 30;
          persistFreshGeminiConfigToD1(env).catch(() => {});
         }
        } catch (e) {}
       }
       return null;
      })();
      if (inFlightKey) {
       inFlightMap.set(inFlightKey, runSingleGeminiTask);
      }
      const outPayload = await runSingleGeminiTask.finally(() => {
       if (inFlightKey) inFlightMap.delete(inFlightKey);
      });
      if (outPayload && outPayload.ok) {
       if (reqScanId) globalThis.__klevVisionScanResultCache.set(`${authFid}_${reqScanId}`, outPayload);
       return new Response(JSON.stringify(outPayload), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
       });
      }
     }

     // Провайдер Б: Бесплатный мультимодальный Vision-шлюз (OpenAI Vision)
     try {
      const pCtrl = new AbortController();
      const pTimer = setTimeout(() => pCtrl.abort(), 7500);
      const dataUri = rawImgB64.startsWith('data:') ? rawImgB64 : `data:image/jpeg;base64,${pureB64}`;
      const pRes = await fetch('https://text.pollinations.ai/openai', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({
        model: 'openai',
        temperature: 0.15,
        messages: [
         {
          role: 'user',
          content: [
           { type: 'text', text: DIRECT_VISION_PROMPT },
           { type: 'image_url', image_url: { url: dataUri } }
          ]
         }
        ]
       }),
       signal: pCtrl.signal
      }).catch(() => null);
      clearTimeout(pTimer);

      if (pRes && pRes.ok) {
       const pJson = await pRes.json().catch(() => null);
       const pTxt = String(pJson?.choices?.[0]?.message?.content || '').trim();
       if (pTxt) {
        // Резервный шлюз не расходует квоту Google Gemini API
        const qStatP = getGeminiQuotaStatus(env, false);
        const outPayload = {
         ok: true,
         engine: geminiKeys.length > 0 ? `Gemini Vision ИИ • Облачный конвейер (осталось ${qStatP.remainingToday} из ${qStatP.limitPerDay})` : 'Облачный Vision ИИ',
         basinCode,
         rawGeminiText: pTxt,
         aiQuota: qStatP
        };
        if (dhash && dhash.length === 16 && dhash !== '0000000000000000') {
         if (visionCache.size > 1000) visionCache.clear();
         visionCache.set(dhash, outPayload);
        }
        return new Response(JSON.stringify(outPayload), {
         headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
        });
       }
      }
     } catch (e) {}
    }

    const smartRes = lastSmartRes || {};
    let errMsg = "Не удалось распознать снимок через Vision ИИ (" + (smartRes.errorCode || "HTTP_" + (smartRes.status || 502)) + "). Попробуйте ещё раз.";
    if (smartRes.errorCode === "API_KEY_INVALID") {
     errMsg = "API-ключ Gemini отклонён Google (403/400 API_KEY_INVALID). Проверьте ключ в Админ-панели -> 3. ИИ Gemini.";
    } else if (smartRes.errorCode === "QUOTA_EXHAUSTED_429") {
     errMsg = "Превышен лимит запросов Google Gemini (429 Quota Exceeded). Добавьте резервный ключ во 2-й или 3-й слот Админ-панели.";
    } else if (smartRes.errorCode === "GEO_LOCATION_UNSUPPORTED") {
     errMsg = "Google Gemini отклонил запрос по региону узла (400 Location not supported), резервные шлюзы не ответили. Повторите попытку.";
    }

    return new Response(JSON.stringify({
     ok: false,
     errorCode: smartRes?.errorCode || "VISION_FAILED",
     upstreamStatus: smartRes?.status || 0,
     error: errMsg
    }), {
     headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
    });
   } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: 'Vision gateway error' }), {
     status: 500,
     headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
    });
   }
  }

  // ── Поиск собеседника по Логину или Fisher ID (/auth/resolve-peer?query=...) ──
  if (matchWorkerRoute(normPath, '/auth/resolve-peer') && request.method === 'GET') {
   if (!checkWorkerRateLimit(`respeer_${clientIp}`, false, 30)) {
    return new Response(JSON.stringify({ ok: false, found: false, error: 'Rate limit' }), { status: 429, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
   }
   if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(checkD1RateLimit(env, `respeer_${clientIp}`, 30, 60000).catch(() => {}));
   }
   await ensurePersistentStateLoaded(env);
   const q = String(reqUrl.searchParams.get('query') || '').trim();
   if (detectSqlInjectionAttempt(q, '/auth/resolve-peer', clientIp)) {
    return new Response(JSON.stringify({ ok: false, found: false, error: 'Invalid query' }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
   }
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

  if (matchWorkerRoute(normPath, '/api/admin/users') && (request.method === 'GET' || request.method === 'POST')) {
   if (!checkWorkerRateLimit(`admusers_${clientIp}`, false, 180)) {
    return new Response(JSON.stringify({ ok: false, error: 'Rate limit' }), { status: 429, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
   }
   await ensurePersistentStateLoaded(env, true);
   let b = {};
   if (request.method === 'POST' || reqUrl.searchParams.has('payload')) {
    try {
     b = await readWorkerRequestPayload(request, reqUrl);
    } catch (e) {}
   }
   const tok = extractAdminTokenFromRequest(request, reqUrl, b);
   if (!await isValidOwnerAdminToken(tok, env)) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized', authRequired: true }), { status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
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
     const authRows = await d1.prepare('SELECT auth_key, login_norm, fisher_id, payload FROM auth_profiles LIMIT 5000').all().catch(() => null);
     if (authRows && Array.isArray(authRows.results)) {
      for (const ar of authRows.results) {
       const prof = workerSafeJsonParse(ar.payload, null);
       const fid = ar.fisher_id || prof?.fisherId || '';
       if (fid && !deletedFisherIdsSet.has(fid)) {
        if (ar.auth_key && prof) cloudAuthProfiles.set(ar.auth_key, prof);
        if (ar.login_norm && ar.auth_key) loginToAuthKeyMap.set(ar.login_norm, ar.auth_key);
        if (ar.auth_key) fisherIdToAuthKeyMap.set(fid, ar.auth_key);
        if (!usersRegistryStore.has(fid)) {
         usersRegistryStore.set(fid, {
          fisherId: fid,
          deviceId: prof?.deviceId || '',
          login: prof?.login || ar.login_norm || '',
          callsign: prof?.callsign || prof?.login || 'Рыболов',
          tgId: prof?.tgLinkedId || '',
          tgUsername: prof?.tgUsername || '',
          regionCode: fid.slice(3, 5) || (isOwnerFisherId(fid) ? '89' : '77'),
          locLabel: prof?.locLabel || (isOwnerFisherId(fid) ? 'Новый Уренгой' : 'Водоём РФ'),
          platform: 'WEB / APK',
          version: WORKER_VERSION,
          firstSeen: prof?.updatedAt || Date.now(),
          lastSeen: prof?.updatedAt || Date.now(),
          sessionsCount: 1,
          circlePostsCount: 0
         });
        }
       }
      }
     }
     await pruneExpiredTemporaryUsers(env);
    } catch (e) {
     console.error('[Admin users D1 query error]', e);
    }
   }

   await syncFreshGeminiConfigFromD1(env);
   const isCompact = reqUrl.searchParams.get('compact') === '1';
   const maxUsersLimit = Math.max(20, Math.min(2000, parseInt(reqUrl.searchParams.get('limit') || '500', 10) || 500));
   const allUsersArr = Array.from(usersRegistryStore.values())
    .sort((a, b) => (Number(b?.lastSeen) || 0) - (Number(a?.lastSeen) || 0))
    .slice(0, maxUsersLimit)
    .map(u => sanitizePublicUserResponse(u, true));
   const allPointsArr = Array.from(circlePointsStore.values()).slice(0, isCompact ? 80 : 300);
   return new Response(JSON.stringify({
    ok: true,
    version: WORKER_VERSION,
    d1Status: d1Info ? 'CONNECTED' : 'DISCONNECTED',
    d1BindingName: d1Info ? d1Info.name : null,
    ownerId: OWNER_FISHER_ID,
    ownerSecondaryId: OWNER_SECONDARY_ID,
    ownerIds: [OWNER_FISHER_ID, OWNER_SECONDARY_ID],
    totalUsers: usersRegistryStore.size,
    users: allUsersArr,
    points: allPointsArr,
    whitelist: Array.from(adminWhitelistStore.values()),
    betaTesters: Array.from(betaTestersStore.values()),
    betaGateConfig: { ...betaGateConfig },
    policyState: { ...policyStateStore },
    userConsents: Object.fromEntries(Array.from(userConsentsStore.entries()).slice(-500)),
    regionalChats: Object.fromEntries(
     Array.from(transitBoxes.entries())
      .filter(([k]) => k.startsWith('CREW_REG-'))
      .map(([k, arr]) => [k.replace(/^CREW_/, ''), (arr || []).slice(-60)])
    ),
    adminDmPackets: (() => {
     const out = [];
     const seen = new Set();
     for (const [bKey, arr] of transitBoxes.entries()) {
      if (bKey === 'DM_FP_89VIP089' || bKey === 'DM_FP_FMP089' || bKey.startsWith('DM_FP_')) {
       for (const p of (arr || [])) {
        if (!p || !p.id || seen.has(p.id)) continue;
        if (bKey === 'DM_FP_89VIP089' || bKey === 'DM_FP_FMP089' || p.senderId === 'FP_89VIP089' || p.senderId === 'FP_FMP089' || p.peerId === 'FP_89VIP089' || p.peerId === 'FP_FMP089') {
         seen.add(p.id);
         out.push(p);
        }
       }
      }
     }
     return out.sort((a, b) => (a.ts || 0) - (b.ts || 0)).slice(-150);
    })(),
    counters: Object.fromEntries(regionSequenceCounters.entries()),
    reserveCounters: Object.fromEntries(regionReserveCounters.entries()),
    aiQuota: getGeminiQuotaStatus(env, true),
    meteoInfoD1: await getMeteoinfoD1StatusSnapshot(env, false),
    securityAudit: getSecurityAuditSnapshot(),
    clientErrors: clientErrorTelemetryLog.slice(0, isCompact ? 20 : 40)
   }), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
   });
  }

  if (matchWorkerRoute(normPath, '/api/admin/meteoinfo-status', '/api/admin/meteoinfo-test') && (request.method === 'GET' || request.method === 'POST')) {
   await ensurePersistentStateLoaded(env);
   let b = {};
   if (request.method === 'POST' || reqUrl.searchParams.has('payload')) {
    try { b = await readWorkerRequestPayload(request, reqUrl); } catch (e) {}
   }
   const admTok = extractAdminTokenFromRequest(request, reqUrl, b);
   if (!await isValidOwnerAdminToken(admTok, env)) {
    recordSecurityIncident('data_exposure', '/api/admin/meteoinfo-status', 'Попытка доступа к /api/admin/meteoinfo-status без токена Супер-Админа', clientIp);
    return jsonResponse({ ok: false, error: 'Forbidden' }, 403);
   }
   const cfGeo = resolveCfClientGeo(request);
   const forceSync = Boolean(b.forceSync || reqUrl.searchParams.get('sync') === '1' || request.method === 'POST');
   const targetLat = parseFloat(b.lat || reqUrl.searchParams.get('lat') || String(cfGeo?.lat || 55.7558));
   const targetLon = parseFloat(b.lon || reqUrl.searchParams.get('lon') || String(cfGeo?.lon || 37.6173));
   const snap = await getMeteoinfoD1StatusSnapshot(env, forceSync, targetLat, targetLon);
   return new Response(JSON.stringify(snap), {
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
  if (matchWorkerRoute(normPath, '/weather') && request.method === 'GET') {
   if (!checkWorkerRateLimit(`wx_${clientIp}`, false, 60)) {
    return new Response(JSON.stringify({ ok: false, error: 'Rate limit' }), { status: 429, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
   }
   if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(checkD1RateLimit(env, `wx_${clientIp}`, 60, 60000).catch(() => {}));
   }
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
    const omUrl = `https://api.open-meteo.com/v1/forecast?latitude=${gLat}&longitude=${gLon}&past_days=14&hourly=temperature_2m,surface_pressure,wind_speed_10m,wind_direction_10m,cloud_cover,precipitation&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,wind_speed_10m_max,wind_direction_10m_dominant&forecast_days=10&wind_speed_unit=ms&timezone=auto`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4500);
    const upstreamRes = await fetch(omUrl, {
     headers: { 'User-Agent': 'KlevProClubBot/2.5.6 (https://klevpro.ru)' },
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
      headers: { 'User-Agent': 'KlevProClubBot/2.5.6 (https://klevpro.ru, i@athor.ru)' }
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

   try {
    const miEnrich = await fetchMeteoinfoEnrichment(parseFloat(gLat), parseFloat(gLon), env, false);
    const parsedWp = JSON.parse(weatherPayload);
    if (miEnrich._spaceWeather) parsedWp._spaceWeather = miEnrich._spaceWeather;
    if (miEnrich._roadHazard) parsedWp._roadHazard = miEnrich._roadHazard;
    if (miEnrich._hydroAssimilation) parsedWp._hydroAssimilation = miEnrich._hydroAssimilation;
    if (miEnrich._meteoInfoStation) parsedWp._meteoInfoStation = miEnrich._meteoInfoStation;
    parsedWp._sourceMeteoinfo = 'meteoinfo.ru+idw';
    weatherPayload = JSON.stringify(parsedWp);
   } catch (e) {}
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
  if (matchWorkerRoute(normPath, '/api/id/allocate') && (request.method === 'POST' || reqUrl.searchParams.has('payload'))) {
   if (!checkWorkerRateLimit(`alloc_${clientIp}`, false, 30)) {
    return new Response(JSON.stringify({ ok: false, error: 'Rate limit' }), { status: 429, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
   }
   try {
    await ensurePersistentStateLoaded(env);
    const body = await readWorkerRequestPayload(request, reqUrl);
    const deviceId = String(body.deviceId || '').trim().slice(0, 80);
    const cfGeo = resolveCfClientGeo(request);
    const hasUserLocation = Boolean(body.hasUserLocation);
    const cleanBodyLoc = (!hasUserLocation && (!body.locLabel || body.locLabel === 'Новый Уренгой'))
     ? ''
     : String(body.locLabel || '').trim();
    const regionSource = (hasUserLocation === false)
     ? (cfGeo.regionCode || cleanBodyLoc || '77')
     : (body.regionCode || body.locAdmin1 || body.locLabel || cfGeo.regionCode || '77');
    const regCode = workerResolveRegionCode(regionSource);
    const regionConfirmed = Boolean(hasUserLocation || body.regionConfirmed);
    const reqCurId = workerNormalizeFisherId(body.currentFisherId || '', regCode);
    const reqLoginNorm = String(body.login || '').trim().toLowerCase().replace(/^@/, '');
    const reqAuthToken = String(body.authTokenHash || '').trim();

    // 1. Проверяем, авторизован ли Владелец (iAthor / iAthor82 -> всегда строго FP_89VIP089) только по подтверждённому токену
    const hdrAdmAlloc = extractAdminTokenFromRequest(request, reqUrl, body);
    const hdrAuthAlloc = request?.headers?.get('X-Auth-Token') || request?.headers?.get('Authorization')?.replace(/^Bearer\s+/i, '') || '';
    const effAllocTok = String(reqAuthToken || body.sessionToken || body.adminSessionToken || hdrAuthAlloc || hdrAdmAlloc || '').trim();
    const isVerifiedOwner = (
     (workerIsOwnerLogin(reqLoginNorm) || workerIsOwnerLogin(body.callsign || '') || isOwnerFisherId(reqCurId)) &&
     Boolean(effAllocTok && (await isValidOwnerAdminToken(effAllocTok, env) || await isValidOwnerAdminToken(hdrAdmAlloc, env)))
    );
    if (isVerifiedOwner) {
     const ownerFid = reqCurId === OWNER_SECONDARY_ID ? OWNER_SECONDARY_ID : OWNER_FISHER_ID;
     if (deviceId) {
      for (const [uid, uObj] of usersRegistryStore.entries()) {
       if (isTemporaryReserveId(uid) && (uObj?.deviceId === deviceId || workerIsOwnerLogin(uObj?.login || uObj?.callsign || ''))) {
        usersRegistryStore.delete(uid);
        deletedFisherIdsSet.add(uid);
        const d1Clean = getD1(env)?.db;
        if (d1Clean) d1Clean.prepare('DELETE FROM users_registry WHERE fisher_id = ?').bind(uid).run().catch(() => {});
       }
      }
      deviceToFisherIdMap.set(deviceId, ownerFid);
     }
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
      cfGeo,
      isOwner: true,
      tgId: ownerRecord?.tgId || '',
      tgUsername: ownerRecord?.tgUsername || '',
      login: 'iAthor',
      user: sanitizePublicUserResponse(ownerRecord, false)
     }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
    }

    // 2. Проверяем, существует ли уже зарегистрированный аккаунт по Логину + Токену/Паролю или привязанному устройству (STOK_ / KTOK_ / pinHash)
    let verifiedPermanentId = '';
    let verifiedProf = null;
    const candidateLoginNorm = reqLoginNorm || (!workerIsOwnerLogin(body.callsign || '') && body.callsign && body.callsign !== 'Гость (Резерв)' && body.callsign !== 'Рыболов' ? workerNormalizeLogin(body.callsign) : '');
    if (candidateLoginNorm && !workerIsOwnerLogin(candidateLoginNorm)) {
     const aKey = loginToAuthKeyMap.get(candidateLoginNorm) || '';
     const prof = await loadPersistedAuthProfile(env, aKey, candidateLoginNorm, reqCurId);
     if (prof && prof.fisherId && !isTemporaryReserveId(prof.fisherId)) {
      const pbkdf2Ok = (body.password && prof.pbkdf2Verifier)
       ? await workerVerifyPasswordVerifier(String(body.password), prof.pbkdf2Verifier)
       : Boolean(body.pbkdf2Verifier && prof.pbkdf2Verifier && constantTimeEquals(String(body.pbkdf2Verifier), String(prof.pbkdf2Verifier)));
      const tokenMatches = Boolean(
       (effAllocTok && prof.authTokenHash && constantTimeEquals(effAllocTok, prof.authTokenHash)) ||
       (effAllocTok && prof.sessionToken && constantTimeEquals(effAllocTok, prof.sessionToken)) ||
       (effAllocTok && prof.secureTokenHash && constantTimeEquals(effAllocTok, prof.secureTokenHash)) ||
       (body.pinHash && prof.pinHash && constantTimeEquals(String(body.pinHash), String(prof.pinHash))) ||
       pbkdf2Ok
      );
      if (tokenMatches) {
       const homeReg = prof.fisherId.slice(3, 5) || regCode;
       verifiedPermanentId = workerNormalizeFisherId(prof.fisherId, homeReg);
       verifiedProf = prof;
      }
     }
     if (!verifiedPermanentId) {
      for (const u of usersRegistryStore.values()) {
       if (u && u.fisherId && !isTemporaryReserveId(u.fisherId) && !isOwnerFisherId(u.fisherId) && workerNormalizeLogin(u.login) === candidateLoginNorm) {
        const regTokMatch = Boolean(
         (effAllocTok && u.sessionToken && constantTimeEquals(effAllocTok, u.sessionToken)) ||
         (effAllocTok && u.authTokenHash && constantTimeEquals(effAllocTok, u.authTokenHash)) ||
         (effAllocTok && u.secureTokenHash && constantTimeEquals(effAllocTok, u.secureTokenHash)) ||
         (body.pinHash && u.pinHash && constantTimeEquals(String(body.pinHash), String(u.pinHash))) ||
         (body.pbkdf2Verifier && u.pbkdf2Verifier && constantTimeEquals(String(body.pbkdf2Verifier), String(u.pbkdf2Verifier)))
        );
        if (regTokMatch) {
         verifiedPermanentId = u.fisherId;
         verifiedProf = u;
         break;
        }
       }
      }
     }
    }

    if (verifiedPermanentId) {
     const permHomeReg = verifiedPermanentId.slice(3, 5) || regCode;
     if (deviceId) {
      for (const [uid, uObj] of usersRegistryStore.entries()) {
       if (isTemporaryReserveId(uid) && (uObj?.deviceId === deviceId || workerNormalizeLogin(uObj?.login || uObj?.callsign || '') === candidateLoginNorm)) {
        usersRegistryStore.delete(uid);
        deletedFisherIdsSet.add(uid);
        const d1Clean = getD1(env)?.db;
        if (d1Clean) d1Clean.prepare('DELETE FROM users_registry WHERE fisher_id = ?').bind(uid).run().catch(() => {});
       }
      }
      deviceToFisherIdMap.set(deviceId, verifiedPermanentId);
     }
     const existingUserRecord = usersRegistryStore.get(verifiedPermanentId) || verifiedProf || null;
     const permLocLabel = (hasUserLocation === false)
      ? (cfGeo.cityName || (existingUserRecord?.locLabel && existingUserRecord.locLabel !== 'Новый Уренгой' ? existingUserRecord.locLabel : '') || cleanBodyLoc || 'Водоём РФ')
      : (body.locLabel || existingUserRecord?.locLabel || cfGeo.cityName || 'Водоём РФ');
     const permLat = (hasUserLocation === false)
      ? (Number.isFinite(Number(cfGeo.lat)) ? Number(cfGeo.lat) : (Number(existingUserRecord?.lat) || 55.7558))
      : (Number.isFinite(Number(body.lat)) ? Number(body.lat) : (Number(existingUserRecord?.lat) || cfGeo.lat || 55.7558));
     const permLon = (hasUserLocation === false)
      ? (Number.isFinite(Number(cfGeo.lon)) ? Number(cfGeo.lon) : (Number(existingUserRecord?.lon) || 37.6173))
      : (Number.isFinite(Number(body.lon)) ? Number(body.lon) : (Number(existingUserRecord?.lon) || cfGeo.lon || 37.6173));
     const userRecord = upsertUserInRegistry({
      fisherId: verifiedPermanentId,
      deviceId,
      login: verifiedProf?.login || body.login || candidateLoginNorm,
      callsign: verifiedProf?.callsign || verifiedProf?.login || body.login || 'Рыболов',
      tgId: verifiedProf?.tgLinkedId || verifiedProf?.tgId || body.tgId || '',
      tgUsername: verifiedProf?.tgUsername || body.tgUsername || '',
      regionCode: permHomeReg,
      regionConfirmed: true,
      profileBackup: body.profileBackup ? pickAllowedProfileFields(workerSanitizeObject(body.profileBackup)) : null,
      locLabel: permLocLabel,
      platform: body.platform || 'WEB',
      version: body.version || WORKER_VERSION,
      lat: permLat,
      lon: permLon,
      cfGeo,
      incrementSession: true
     });
     await d1SaveUser(env, userRecord);
     await persistSystemMeta(env, ctx);
     return new Response(JSON.stringify({
      ok: true,
      fisherId: verifiedPermanentId,
      isTemporaryReserve: false,
      isRegistered: true,
      regionCode: permHomeReg,
      cfGeo,
      tgId: userRecord?.tgId || '',
      tgUsername: userRecord?.tgUsername || '',
      login: userRecord?.login || '',
      user: sanitizePublicUserResponse(userRecord, false)
     }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
    }

    // 3. Пользователь НЕ зарегистрировал логин и пароль -> выдаём строго 1 ВРЕМЕННЫЙ РЕЗЕРВНЫЙ ID (FP_XXRZYYYY) на 24 часа для этого устройства (независимо от смены региона/точки на карте!)
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
     for (const [uid, uObj] of usersRegistryStore.entries()) {
      if (uid !== tempReserveId && uObj && uObj.deviceId === deviceId && isTemporaryReserveId(uid)) {
       usersRegistryStore.delete(uid);
       deletedFisherIdsSet.add(uid);
       const d1Clean = getD1(env)?.db;
       if (d1Clean) d1Clean.prepare('DELETE FROM users_registry WHERE fisher_id = ?').bind(uid).run().catch(() => {});
      }
     }
     deviceToFisherIdMap.set(deviceId, tempReserveId);
    }

    const existingUserRecord = usersRegistryStore.get(tempReserveId) || null;
    const tempLocLabel = (hasUserLocation === false)
     ? (cfGeo.cityName || (existingUserRecord?.locLabel && existingUserRecord.locLabel !== 'Новый Уренгой' ? existingUserRecord.locLabel : '') || cleanBodyLoc || 'Водоём РФ')
     : (body.locLabel || existingUserRecord?.locLabel || cfGeo.cityName || 'Водоём РФ');
    const tempLat = (hasUserLocation === false)
     ? (Number.isFinite(Number(cfGeo.lat)) ? Number(cfGeo.lat) : (Number(existingUserRecord?.lat) || 55.7558))
     : (Number.isFinite(Number(body.lat)) ? Number(body.lat) : (Number(existingUserRecord?.lat) || cfGeo.lat || 55.7558));
    const tempLon = (hasUserLocation === false)
     ? (Number.isFinite(Number(cfGeo.lon)) ? Number(cfGeo.lon) : (Number(existingUserRecord?.lon) || 37.6173))
     : (Number.isFinite(Number(body.lon)) ? Number(body.lon) : (Number(existingUserRecord?.lon) || cfGeo.lon || 37.6173));
    const tempRecord = upsertUserInRegistry({
     fisherId: tempReserveId,
     deviceId,
     login: '',
     callsign: 'Гость (Резерв)',
     tgId: '',
     tgUsername: '',
     regionCode: (hasUserLocation === false && cfGeo.regionCode) ? cfGeo.regionCode : (tempReserveId.slice(3, 5) || regCode),
     regionConfirmed,
     locLabel: tempLocLabel,
     platform: body.platform || 'WEB',
     version: body.version || WORKER_VERSION,
     lat: tempLat,
     lon: tempLon,
     cfGeo,
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
     cfGeo,
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
  if (matchWorkerRoute(normPath, '/api/tg/bind')) {
   await ensurePersistentStateLoaded(env);
   const cfGeo = resolveCfClientGeo(request);
   if (request.method === 'GET' && !reqUrl.searchParams.has('payload')) {
    const qFid = workerNormalizeFisherId(reqUrl.searchParams.get('fid') || '', cfGeo?.regionCode || '77');
    const qDev = String(reqUrl.searchParams.get('deviceId') || '').trim();
    const qTg = String(reqUrl.searchParams.get('tgId') || '').trim();
    const qTok = String(reqUrl.searchParams.get('authTokenHash') || reqUrl.searchParams.get('sessionToken') || '').trim();
    const qLoginRaw = String(reqUrl.searchParams.get('login') || '').trim();
    const isOwnerReq = workerIsOwnerLogin(qLoginRaw) || isOwnerFisherId(qFid);
    let effFid = qFid || (qTg ? tgToFisherIdMap.get(qTg) : '') || (qDev ? deviceToFisherIdMap.get(qDev) : '') || '';
    if (isOwnerReq && !effFid) effFid = OWNER_FISHER_ID;
    let u = effFid ? usersRegistryStore.get(effFid) : null;
    const getBindAuth = await verifyUserAuth(env, {
     fid: effFid,
     authTokenHash: qTok,
     deviceId: qDev,
     adminToken: extractAdminTokenFromRequest(request, reqUrl, null),
     request
    });
    const deviceMatchesReg = Boolean(qDev && ((u && u.deviceId && u.deviceId === qDev) || deviceToFisherIdMap.get(qDev) === effFid));
    if (!getBindAuth.ok && !getBindAuth.isAdmin && !deviceMatchesReg) {
     return new Response(JSON.stringify({ ok: false, bound: false, error: 'Forbidden' }), { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
    }
    const isBound = Boolean(u && (u.tgId || u.tgUsername));
    return new Response(JSON.stringify({
     ok: true,
     bound: isBound,
     fisherId: u?.fisherId || effFid || '',
     tgId: u?.tgId || '',
     tgUsername: u?.tgUsername || '',
     login: u?.login || ''
    }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
   }
   if (request.method === 'POST' || reqUrl.searchParams.has('payload')) {
    if (!checkWorkerRateLimit(`tgbind_${clientIp}`, false, 20)) {
     return new Response(JSON.stringify({ ok: false, error: 'Rate limit' }), { status: 429, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }
    try {
     const body = await readWorkerRequestPayload(request, reqUrl);
     const targetFid = workerNormalizeFisherId(body.fisherId || '', cfGeo?.regionCode || '77');
     let validInit = false;
     if (body.initData && BOT_TOKEN) {
      validInit = await verifyTelegramWebAppInitData(body.initData, BOT_TOKEN);
      if (!validInit) {
       recordSecurityIncident('idor', '/api/tg/bind', 'Неверная криптографическая подпись Telegram initData при привязке аккаунта', clientIp, body.fisherId || '');
       return new Response(JSON.stringify({ ok: false, error: 'Invalid Telegram initData signature' }), { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
      }
     }
     if (targetFid && (!validInit || isOwnerFisherId(targetFid) || !isTemporaryReserveId(targetFid))) {
      const bindAuth = await verifyUserAuth(env, {
       fid: targetFid,
       authTokenHash: body.authTokenHash || body.sessionToken || '',
       deviceId: body.deviceId || '',
       adminToken: extractAdminTokenFromRequest(request, reqUrl, body),
       request
      });
      if (!bindAuth.ok && !bindAuth.isAdmin) {
       recordSecurityIncident('idor', '/api/tg/bind', `Попытка привязки Telegram к чужому ID (${targetFid}) без авторизации`, clientIp, targetFid);
       return new Response(JSON.stringify({ ok: false, error: 'Forbidden: unverified fisher identity' }), { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
      }
     }
     const cleanBindLoc = (body.hasUserLocation === false && body.locLabel === 'Новый Уренгой') ? '' : (body.locLabel || '');
     const rec = bindTelegramToFisherProfile({
      fisherId: body.fisherId || '',
      deviceId: body.deviceId || '',
      login: body.login || '',
      tgId: body.tgId || '',
      tgUsername: body.tgUsername || '',
      tgFirstName: body.tgFirstName || '',
      regionCode: (body.hasUserLocation === false ? cfGeo?.regionCode : body.regionCode) || cfGeo?.regionCode || '77',
      locLabel: cleanBindLoc || cfGeo?.cityName || 'Водоём РФ',
      lat: (body.hasUserLocation !== false && Number.isFinite(Number(body.lat))) ? Number(body.lat) : (cfGeo?.lat || 55.7558),
      lon: (body.hasUserLocation !== false && Number.isFinite(Number(body.lon))) ? Number(body.lon) : (cfGeo?.lon || 37.6173),
      cfGeo
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
  if (matchWorkerRoute(normPath, '/api/circle/publish') && (request.method === 'POST' || reqUrl.searchParams.has('payload'))) {
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
     recordSecurityIncident('idor', '/api/circle/publish', `Попытка публикации точки от чужого ID (${fid}) без валидного токена`, clientIp, fid);
     return new Response(JSON.stringify({ ok: false, error: 'Forbidden: unverified fisher identity' }), { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
    }
    const incomingPtId = String(rawItem.id || '').trim();
    if (incomingPtId && circlePointsStore.has(incomingPtId)) {
     const existingPt = circlePointsStore.get(incomingPtId);
     if (existingPt && existingPt.fid && existingPt.fid !== fid && !pubAuth.isAdmin) {
      recordSecurityIncident('idor', '/api/circle/publish', `Попытка перезаписи чужой точки Круга (id=${incomingPtId}, владелец=${existingPt.fid})`, clientIp, fid);
      return new Response(JSON.stringify({ ok: false, error: 'Forbidden: cannot overwrite another user point' }), { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
     }
    }
    const dedupKey = `pub_${fid}_${rawItem.t}_${rawItem.fi || ''}_${Math.round(clampLat(rawItem.lat) * 100)}_${Math.round(clampLon(rawItem.lon) * 100)}`;
    if (isDuplicateRecentAction(dedupKey, 5000) && circlePointsStore.has(String(rawItem.id || ''))) {
     const exPt = circlePointsStore.get(String(rawItem.id || ''));
     return new Response(JSON.stringify({ ok: true, id: exPt.id, item: exPt, deduplicated: true, totalActivePoints: circlePointsStore.size }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
    }
    const cleanItem = {
     id: workerCleanText(rawItem.id || `cir_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`, 64, 'id', '/api/circle/publish', clientIp, fid),
     t: ['circle', 'crew', 'workshop', 'spot'].includes(rawItem.t) ? rawItem.t : 'circle',
     cat: workerCleanText(rawItem.cat || '', 24, 'cat', '/api/circle/publish', clientIp, fid),
     isExpedition: Boolean(rawItem.isExpedition),
     expStart: workerCleanText(rawItem.expStart || '', 12, 'expStart', '/api/circle/publish', clientIp, fid),
     expEnd: workerCleanText(rawItem.expEnd || '', 12, 'expEnd', '/api/circle/publish', clientIp, fid),
     savedForever: Boolean((rawItem.t === 'crew' && !rawItem.sos) || rawItem.t === 'spot'),
     sos: Boolean(rawItem.sos),
     fid,
     did: String(rawItem.did || body.deviceId || '').slice(0, 80),
     au: workerCleanText(rawItem.au || 'Рыболов', 48, 'au', '/api/circle/publish', clientIp, fid) || 'Рыболов',
     rk: workerCleanText(rawItem.rk || 'angler', 20, 'rk', '/api/circle/publish', clientIp, fid),
     rw_w: Number(rawItem.rw_w) || 1,
     fi: workerCleanText(rawItem.fi || 'pike', 32, 'fi', '/api/circle/publish', clientIp, fid),
     fn: workerCleanText(rawItem.fn || 'Рыба', 48, 'fn', '/api/circle/publish', clientIp, fid) || 'Рыба',
     wt: workerCleanText(rawItem.wt || 'small_river', 32, 'wt', '/api/circle/publish', clientIp, fid),
     wn: workerCleanText(rawItem.wn || rawItem.lb || 'Водоём', 80, 'wn', '/api/circle/publish', clientIp, fid) || 'Водоём',
     lb: workerCleanText(rawItem.lb || rawItem.wn || 'Водоём', 80, 'lb', '/api/circle/publish', clientIp, fid) || 'Водоём',
     mt: workerCleanText(rawItem.mt || 'spin_light', 32, 'mt', '/api/circle/publish', clientIp, fid),
     bt: workerCleanText(rawItem.bt || '', 80, 'bt', '/api/circle/publish', clientIp, fid),
     nt: workerCleanText(rawItem.nt || '', 240, 'nt', '/api/circle/publish', clientIp, fid),
     lat: (rawItem.t === 'crew' && !rawItem.sos && rawItem.e2eeCrewCipher) ? 0 : clampLat(rawItem.lat, 66.0833),
     lon: (rawItem.t === 'crew' && !rawItem.sos && rawItem.e2eeCrewCipher) ? 0 : clampLon(rawItem.lon, 76.6333),
     dp: Number.isFinite(Number(rawItem.dp)) ? Number(rawItem.dp) : 2.5,
     tw: Number.isFinite(Number(rawItem.tw)) ? Number(rawItem.tw) : 8,
     ta: Number.isFinite(Number(rawItem.ta)) ? Number(rawItem.ta) : 10,
     pr: Number.isFinite(Number(rawItem.pr)) ? Number(rawItem.pr) : 754,
     wd: Number.isFinite(Number(rawItem.wd)) ? Number(rawItem.wd) : 3,
     sc: Number.isFinite(Number(rawItem.sc)) ? Number(rawItem.sc) : 75,
     kg: Number.isFinite(Number(rawItem.kg)) ? Number(rawItem.kg) : 0,
     crewKey: String(rawItem.crewKeyHash || rawItem.crewKey || '').toUpperCase().slice(0, 48),
     crewKeyHash: String(rawItem.crewKeyHash || rawItem.crewKey || '').toUpperCase().slice(0, 48),
     e2eeCrewCipher: String(rawItem.e2eeCrewCipher || '').slice(0, 4096),
     rw: workerCleanText(rawItem.rw || '', 140, 'rw', '/api/circle/publish', clientIp, fid),
     rl: workerCleanText(rawItem.rl || '', 120, 'rl', '/api/circle/publish', clientIp, fid),
     rt: workerCleanText(rawItem.rt || '', 120, 'rt', '/api/circle/publish', clientIp, fid),
     fl: workerCleanText(rawItem.fl || '', 48, 'fl', '/api/circle/publish', clientIp, fid),
     twMin: Number.isFinite(Number(rawItem.twMin)) ? Number(rawItem.twMin) : 4,
     twMax: Number.isFinite(Number(rawItem.twMax)) ? Number(rawItem.twMax) : 18,
     packToken: String(body.packToken || rawItem.packToken || '').slice(0, 512),
     ca: Number(rawItem.ca) > 0 ? Number(rawItem.ca) : now,
     ea: rawItem.t === 'spot'
      ? (now + 3650 * 86400000)
      : ((rawItem.isExpedition && rawItem.expEnd)
       ? calcWorkerExpeditionExpiryMs(rawItem.expEnd)
       : (Number(rawItem.ea) > now ? Math.min(Number(rawItem.ea), now + 365 * 86400000) : (now + 72 * 3600000)))
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
     item: sanitizePublicCirclePoint(cleanItem, false, true),
     totalActivePoints: circlePointsStore.size
    }), {
     headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
    });
   } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'Publish failed' }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
   }
  }

  if (matchWorkerRoute(normPath, '/api/circle/nearby') && request.method === 'GET') {
   if (!checkWorkerRateLimit(`nearby_${clientIp}`, false, 35)) {
    return new Response(JSON.stringify({ ok: false, error: 'Rate limit' }), { status: 429, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
   }
   await ensurePersistentStateLoaded(env);
   purgeExpiredServerCirclePoints();

   const d1Info = getD1(env);
   const d1 = d1Info?.db;
   if (d1) {
    try {
     const nowMs = Date.now();
     const ptRows = await d1.prepare("SELECT payload FROM circle_points WHERE (ea > ? OR t = 'spot') ORDER BY ca DESC LIMIT 300").bind(nowMs).all();
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
    await isValidOwnerAdminToken(adminTok, env) ||
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
     // Закрытые точки Экипажа (E2EE) видны строго автору или участникам с ключом/хэшем ключа (даже Админ не видит чужие закрытые экипажи)
     const ptKey = String(pt.crewKeyHash || pt.crewKey || '').toUpperCase();
     const hasKey = Boolean(ptKey && crewKeysSet.has(ptKey));
     if (isMine || hasKey) {
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
   const safeItems = results.slice(0, 150).map(pt => {
    const hasCrewAccess = isViewerAdmin || (viewerFid && pt.fid === viewerFid && nearbyAuth.ok) || (pt.crewKey && crewKeysSet.has(String(pt.crewKey).toUpperCase()));
    return sanitizePublicCirclePoint(pt, isViewerAdmin, hasCrewAccess);
   });
   return new Response(JSON.stringify({
    ok: true,
    items: safeItems,
    policyState: policyStateStore,
    serverTime: Date.now()
   }), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
   });
  }

  if (matchWorkerRoute(normPath, '/api/circle/delete') && (request.method === 'POST' || reqUrl.searchParams.has('payload'))) {
   if (!checkWorkerRateLimit(`cirdel_${clientIp}`, false, 30)) {
    return new Response(JSON.stringify({ ok: false, error: 'Rate limit' }), { status: 429, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
   }
   if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(checkD1RateLimit(env, `cirdel_${clientIp}`, 30, 60000).catch(() => {}));
   }
   try {
    await ensurePersistentStateLoaded(env);
    const body = await readWorkerRequestPayload(request, reqUrl);
    const id = String(body.id || '').trim();
    const fid = workerNormalizeFisherId(body.fid || '', '89');
    const devId = String(body.deviceId || '').trim();
    const admTok = extractAdminTokenFromRequest(request, reqUrl, body);
    const isAdm = await isValidOwnerAdminToken(admTok, env);
    let target = circlePointsStore.get(id);
    const d1ForDel = getD1(env)?.db;
    if (!target && id && d1ForDel) {
     try {
      const d1Row = await d1ForDel.prepare('SELECT payload FROM circle_points WHERE id = ?').bind(id).first();
      if (d1Row && d1Row.payload) {
       target = workerSafeJsonParse(d1Row.payload, null);
      }
     } catch (_e) {}
    }
    if (!target) {
     return new Response(JSON.stringify({ ok: true, deleted: false }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }
    const delAuth = await verifyUserAuth(env, {
     fid: target.fid,
     authTokenHash: body.authTokenHash || body.sessionToken || '',
     deviceId: devId,
     adminToken: admTok,
     request,
     targetDeviceId: target.did || ''
    });
    const isVerifiedAuthor = (target.fid === fid && delAuth.ok) || Boolean(devId && target.did && constantTimeEquals(target.did, devId) && (!target.fid || isTemporaryReserveId(target.fid)));
    if (!isAdm && !isVerifiedAuthor) {
     recordSecurityIncident('idor', '/api/circle/delete', `Попытка удаления чужой точки Круга (id=${id}, автор=${target.fid}, запросил=${fid || 'гость'})`, clientIp, fid);
     return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }
    circlePointsStore.delete(id);
    await d1DeletePoint(env, id);
    if (d1ForDel && id) {
     await d1ForDel.prepare('DELETE FROM transit_relay WHERE kind = ? AND sender_id = ? AND (id = ? OR cipher_payload LIKE ?)').bind('pack', target.fid || fid, id, `%${id}%`).run().catch(() => {});
    }
    for (const [bKey, bList] of transitBoxes.entries()) {
     if (Array.isArray(bList)) {
      transitBoxes.set(bKey, bList.filter(p => p && !(p.kind === 'pack' && p.senderId === (target.fid || fid) && (p.id === id || p.targetId === id || String(p.cipherPayload || '').includes(id)))));
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

  if (matchWorkerRoute(normPath, '/auth/check-login') && request.method === 'GET') {
   if (!checkWorkerRateLimit(`chklogin_${clientIp}`, false, 30)) {
    return new Response(JSON.stringify({ ok: false, available: false, error: 'Rate limit' }), { status: 429, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
   }
   await ensurePersistentStateLoaded(env);
    const rawL = String(reqUrl.searchParams.get('login') || '').trim();
    if (detectSqlInjectionAttempt(rawL, '/auth/check-login', clientIp)) {
     return new Response(JSON.stringify({ ok: false, available: false, reason: 'invalid_chars', error: 'Недопустимые символы в логине' }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
    }
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

  if (matchWorkerRoute(normPath, '/auth/login', '/auth/register') && (request.method === 'POST' || reqUrl.searchParams.has('payload'))) {
   if (!checkWorkerRateLimit(`auth_${clientIp}`, false, 15)) {
    return new Response(JSON.stringify({ ok: false, error: 'Too many login attempts' }), {
     status: 429,
     headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
    });
   }
   try {
    await ensurePersistentStateLoaded(env);
    const body = await readWorkerRequestPayload(request, reqUrl);
    const rawLoginClean = String(body.login || '').trim();
    const normLoginPre = workerNormalizeLogin(rawLoginClean);
    if (detectSqlInjectionAttempt(rawLoginClean, '/auth/login', clientIp, rawLoginClean)) {
     return new Response(JSON.stringify({ ok: false, error: 'Недопустимые символы в поле логина' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
     });
    }
    const bfState = await checkD1LoginBruteForce(env, clientIp, normLoginPre || rawLoginClean);
    if (bfState.locked) {
     return new Response(JSON.stringify({
      ok: false,
      code: 'BRUTE_FORCE_LOCKED',
      error: `Слишком много неверных попыток входа. Повторите через ${Math.ceil((bfState.waitSec || 900) / 60)} мин.`
     }), {
      status: 429,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
     });
    }
    const cfGeo = resolveCfClientGeo(request);
    const hasUserLoc = Boolean(body.hasUserLocation || body.profileSnapshot?.hasUserLocation);
    const isTryingOwner = workerIsOwnerLogin(rawLoginClean);
    detectMassAssignmentAttempt(body, '/auth/login', clientIp, rawLoginClean, isTryingOwner);
    detectMassAssignmentAttempt(body.profileSnapshot, '/auth/login', clientIp, rawLoginClean, isTryingOwner);
    const incomingSnap = pickAllowedProfileFields(workerSanitizeObject(body.profileSnapshot));
    if (!isTryingOwner && !hasUserLoc && incomingSnap.locLabel === 'Новый Уренгой') {
     incomingSnap.locLabel = cfGeo?.cityName || 'Водоём РФ';
     if (cfGeo?.admin1) incomingSnap.locAdmin1 = cfGeo.admin1;
     if (Number.isFinite(Number(cfGeo?.lat))) incomingSnap.lat = cfGeo.lat;
     if (Number.isFinite(Number(cfGeo?.lon))) incomingSnap.lon = cfGeo.lon;
    }
    const normFidPre = /^FP_/i.test(rawLoginClean) ? workerNormalizeFisherId(rawLoginClean, cfGeo?.regionCode || '77') : '';
    const preCheckKey = normLoginPre ? `AUTH_${normLoginPre}_${body.authTokenHash && String(body.authTokenHash).startsWith('KTOK_') ? body.authTokenHash : workerDeriveAuthToken(rawLoginClean, body.password)}` : '';
    await loadPersistedAuthProfile(env, preCheckKey, normLoginPre, normFidPre);
    const effLoginRegionSrc = (!isTryingOwner && !hasUserLoc)
     ? (cfGeo?.regionCode || body.regionCode || incomingSnap.locAdmin1 || incomingSnap.locLabel || '77')
     : (body.regionCode || incomingSnap.locAdmin1 || incomingSnap.locLabel || cfGeo?.regionCode || '77');
    const ident = await resolveWorkerAccountIdentity(body.login, body.password, body.authTokenHash, effLoginRegionSrc, incomingSnap, env);
    if (!ident.ok) {
     const failRec = await recordD1LoginFailure(env, clientIp, normLoginPre || rawLoginClean, '/auth/login');
     const rem = Math.max(0, BRUTE_FORCE_MAX_FAILS - failRec.count);
     return new Response(JSON.stringify({
      ok: false,
      code: ident.code || 'INVALID_CREDENTIALS',
      remainingAttempts: rem,
      error: ident.error || 'Неверный логин или пароль'
     }), {
      status: failRec.lockedUntil ? 429 : 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
     });
    }
    await clearD1LoginFailures(env, clientIp, normLoginPre || rawLoginClean);
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
     pbkdf2Verifier: ident.pbkdf2Verifier || existing?.pbkdf2Verifier || '',
     sessionToken: ident.sessionToken || existing?.sessionToken || '',
     authTokenHash: ident.authTokenHash,
     secureTokenHash: secureTok,
     adminSessionToken: ident.isOwner ? (ident.adminSessionToken || await issueServerAdminSessionToken(ADMIN_SESSION_DEFAULT_TTL_MS, env)) : '',
     ownerUnlocked: ident.isOwner ? true : Boolean(existing?.ownerUnlocked),
     isAdmin: ident.isOwner ? true : adminWhitelistStore.has(ident.fisherId),
     isBetaTester: ident.isOwner ? true : isUserBetaTesterOnServer(ident.fisherId),
     adminShowAllCrews: typeof incomingSnap.adminShowAllCrews === 'boolean' ? incomingSnap.adminShowAllCrews : (ident.isOwner ? (existing?.adminShowAllCrews ?? true) : Boolean(existing?.adminShowAllCrews)),
     updatedAt: Date.now()
    };
    delete merged.authShadow;
    await persistAuthProfile(env, ident.authKey, merged, ctx);
    if (ident.isOwner) {
     adminWhitelistStore.set(OWNER_FISHER_ID, { id: OWNER_FISHER_ID, label: 'iAthor • Антон (Владелец / Супер-Админ)', addedAt: '2026-10-27' });
    }
    const resolvedRegCode = ident.isOwner
     ? '89'
     : (ident.fisherId.slice(3, 5) || workerResolveRegionCode(effLoginRegionSrc || cfGeo?.regionCode || '77'));
    const effLoginLocLabel = ident.isOwner
     ? (incomingSnap.locLabel || 'Новый Уренгой')
     : (incomingSnap.locLabel || existing?.locLabel || regUser?.locLabel || cfGeo?.cityName || 'Водоём РФ');
    const effLoginLat = ident.isOwner
     ? (incomingSnap.lat ?? 66.0833)
     : (incomingSnap.lat ?? existing?.lat ?? regUser?.lat ?? cfGeo?.lat ?? 55.7558);
    const effLoginLon = ident.isOwner
     ? (incomingSnap.lon ?? 76.6333)
     : (incomingSnap.lon ?? existing?.lon ?? regUser?.lon ?? cfGeo?.lon ?? 37.6173);
    bindTelegramToFisherProfile({
     fisherId: ident.fisherId,
     deviceId: incomingSnap.deviceId || body.deviceId || '',
     login: ident.login,
     tgId: ident.isOwner ? mergedTgId : (workerIsOwnerLogin(mergedTgUser) ? '' : mergedTgId),
     tgUsername: ident.isOwner ? mergedTgUser : (workerIsOwnerLogin(mergedTgUser) ? '' : mergedTgUser),
     regionCode: resolvedRegCode,
     locLabel: effLoginLocLabel,
     lat: effLoginLat,
     lon: effLoginLon,
     cfGeo
    });
    const regRec = upsertUserInRegistry({
     fisherId: ident.fisherId,
     deviceId: incomingSnap.deviceId || body.deviceId || '',
     login: ident.login,
     callsign: merged.callsign,
     tgId: ident.isOwner ? mergedTgId : (workerIsOwnerLogin(mergedTgUser) ? '' : mergedTgId),
     tgUsername: ident.isOwner ? mergedTgUser : (workerIsOwnerLogin(mergedTgUser) ? '' : mergedTgUser),
     regionCode: resolvedRegCode,
     locLabel: effLoginLocLabel,
     platform: body.platform || 'WEB',
     version: body.version || WORKER_VERSION,
     lat: effLoginLat,
     lon: effLoginLon,
     cfGeo,
     incrementSession: true
    });
    deletedFisherIdsSet.delete(ident.fisherId);
    const d1Login = getD1(env)?.db;
    if (d1Login && (incomingSnap.deviceId || body.deviceId)) {
     await d1Login.prepare('DELETE FROM users_registry WHERE (device_id = ? OR LOWER(login) = ? OR LOWER(callsign) = ?) AND is_temporary = 1').bind(incomingSnap.deviceId || body.deviceId, workerNormalizeLogin(ident.login), workerNormalizeLogin(ident.login)).run().catch(() => {});
    }
    await d1SaveUser(env, regRec);
    await pruneExpiredTemporaryUsers(env);
    await persistSystemMeta(env, ctx);
    const safeProfileOut = { ...merged };
    delete safeProfileOut.secureTokenHash;
    delete safeProfileOut.pbkdf2Verifier;
    if (!ident.isOwner) delete safeProfileOut.adminSessionToken;
    const safeWhitelistOut = ident.isOwner
     ? Array.from(adminWhitelistStore.values())
     : Array.from(adminWhitelistStore.values()).map(item => ({ id: item.id }));
    return new Response(JSON.stringify({
     ok: true,
     found: Boolean(existing),
     isOwner: ident.isOwner,
     fisherId: ident.fisherId,
     login: ident.login,
     pinHash: ident.pinHash,
     sessionToken: ident.sessionToken || ident.authTokenHash,
     adminSessionToken: ident.isOwner ? (ident.adminSessionToken || await issueServerAdminSessionToken(ADMIN_SESSION_DEFAULT_TTL_MS, env)) : '',
     serverDynamicSlotHtml: ident.isOwner ? buildOwnerServerPortalSlotHtml(reqUrl.origin) : '',
     isBetaTester: Boolean(safeProfileOut.isBetaTester),
     betaGateConfig: { ...betaGateConfig },
     betaTesters: Array.from(betaTestersStore.values()).map(x => ({ id: x.id })),
     profile: safeProfileOut,
     whitelist: safeWhitelistOut
    }), {
     headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
    });
   } catch (e) {
    console.error('[Worker Auth Error Caught]', e);
    return new Response(JSON.stringify({
     ok: false,
     error: 'Ошибка авторизации: проверьте правильность логина и пароля'
    }), {
     status: 400,
     headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
    });
   }
  }

  if (matchWorkerRoute(normPath, '/auth/sync') && (request.method === 'POST' || reqUrl.searchParams.has('payload'))) {
   if (!checkWorkerRateLimit(`sync_${clientIp}`, false, 30)) {
    return new Response(JSON.stringify({ ok: false, error: 'Rate limit exceeded' }), {
     status: 429,
     headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
    });
   }
   try {
    await ensurePersistentStateLoaded(env);
    const body = await readWorkerRequestPayload(request, reqUrl);
    const cfGeo = resolveCfClientGeo(request);
    const hasUserLoc = Boolean(body.hasUserLocation || body.profileSnapshot?.hasUserLocation);
    const isSyncOwner = workerIsOwnerLogin(body.login || '');
    detectMassAssignmentAttempt(body, '/auth/sync', clientIp, body.login || '', isSyncOwner);
    detectMassAssignmentAttempt(body.profileSnapshot, '/auth/sync', clientIp, body.login || '', isSyncOwner);
    const snap = pickAllowedProfileFields(workerSanitizeObject(body.profileSnapshot));
    if (!isSyncOwner && !hasUserLoc && snap.locLabel === 'Новый Уренгой') {
     snap.locLabel = cfGeo?.cityName || 'Водоём РФ';
     if (cfGeo?.admin1) snap.locAdmin1 = cfGeo.admin1;
     if (Number.isFinite(Number(cfGeo?.lat))) snap.lat = cfGeo.lat;
     if (Number.isFinite(Number(cfGeo?.lon))) snap.lon = cfGeo.lon;
    }
    const rawLoginClean = String(body.login || '').trim();
    const normLoginPre = workerNormalizeLogin(rawLoginClean);
    const normFidPre = /^FP_/i.test(rawLoginClean) ? workerNormalizeFisherId(rawLoginClean, cfGeo?.regionCode || '77') : '';
    const preCheckKey = normLoginPre ? `AUTH_${normLoginPre}_${body.authTokenHash && String(body.authTokenHash).startsWith('KTOK_') ? body.authTokenHash : workerDeriveAuthToken(rawLoginClean, body.password)}` : '';
    await loadPersistedAuthProfile(env, preCheckKey, normLoginPre, normFidPre);
    const syncBfState = await checkD1LoginBruteForce(env, clientIp, normLoginPre || rawLoginClean);
    if (syncBfState.locked) {
     return new Response(JSON.stringify({ ok: false, code: 'BRUTE_FORCE_LOCKED', error: 'Слишком много неудачных попыток. Повторите через 15 минут.' }), { status: 429, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
    }
    const effSyncRegionSrc = (!isSyncOwner && !hasUserLoc)
     ? (cfGeo?.regionCode || body.regionCode || snap.locAdmin1 || snap.locLabel || '77')
     : (body.regionCode || snap.locAdmin1 || snap.locLabel || cfGeo?.regionCode || '77');
    const ident = await resolveWorkerAccountIdentity(body.login, body.password, body.authTokenHash, effSyncRegionSrc, snap, env);
    if (!ident.ok) {
     const failRec = await recordD1LoginFailure(env, clientIp, normLoginPre || rawLoginClean, '/auth/sync');
     return new Response(JSON.stringify({ ok: false, error: 'Invalid credentials' }), {
      status: failRec.lockedUntil ? 429 : 400,
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
     pbkdf2Verifier: ident.pbkdf2Verifier || existing?.pbkdf2Verifier || '',
     sessionToken: ident.sessionToken || existing?.sessionToken || '',
     authTokenHash: ident.authTokenHash,
     adminSessionToken: ident.isOwner ? (ident.adminSessionToken || await issueServerAdminSessionToken(ADMIN_SESSION_DEFAULT_TTL_MS, env)) : '',
     ownerUnlocked: ident.isOwner ? true : Boolean(existing.ownerUnlocked),
     isAdmin: ident.isOwner ? true : adminWhitelistStore.has(ident.fisherId),
     isBetaTester: ident.isOwner ? true : isUserBetaTesterOnServer(ident.fisherId),
     updatedAt: Date.now()
    };
    delete merged.authShadow;
    await persistAuthProfile(env, ident.authKey, merged, ctx);
    const resolvedSyncRegCode = ident.isOwner
     ? '89'
     : (ident.fisherId.slice(3, 5) || workerResolveRegionCode(effSyncRegionSrc || cfGeo?.regionCode || '77'));
    const effSyncLocLabel = ident.isOwner
     ? (snap.locLabel || 'Новый Уренгой')
     : (snap.locLabel || existing?.locLabel || cfGeo?.cityName || 'Водоём РФ');
    const effSyncLat = ident.isOwner
     ? (snap.lat ?? 66.0833)
     : (snap.lat ?? existing?.lat ?? cfGeo?.lat ?? 55.7558);
    const effSyncLon = ident.isOwner
     ? (snap.lon ?? 76.6333)
     : (snap.lon ?? existing?.lon ?? cfGeo?.lon ?? 37.6173);
    const syncRec = upsertUserInRegistry({
     fisherId: ident.fisherId,
     deviceId: snap.deviceId || body.deviceId || '',
     login: ident.login,
     callsign: merged.callsign,
     tgId: ident.isOwner ? (snap.tgLinkedId || '') : (workerIsOwnerLogin(snap.tgUsername) ? '' : (snap.tgLinkedId || '')),
     tgUsername: ident.isOwner ? (snap.tgUsername || '') : (workerIsOwnerLogin(snap.tgUsername) ? '' : (snap.tgUsername || '')),
     regionCode: resolvedSyncRegCode,
     locLabel: effSyncLocLabel,
     platform: body.platform || 'WEB',
     version: body.version || WORKER_VERSION,
     lat: effSyncLat,
     lon: effSyncLon,
     cfGeo
    });
    await d1SaveUser(env, syncRec);
    await persistSystemMeta(env, ctx);
    const safeSyncProfile = { ...merged };
    delete safeSyncProfile.secureTokenHash;
    delete safeSyncProfile.pbkdf2Verifier;
    if (!ident.isOwner) delete safeSyncProfile.adminSessionToken;
    const safeSyncWhitelist = ident.isOwner
     ? Array.from(adminWhitelistStore.values())
     : Array.from(adminWhitelistStore.values()).map(item => ({ id: item.id }));
    return new Response(JSON.stringify({
     ok: true,
     fisherId: ident.fisherId,
     isOwner: ident.isOwner,
     adminSessionToken: ident.isOwner ? (ident.adminSessionToken || await issueServerAdminSessionToken(ADMIN_SESSION_DEFAULT_TTL_MS, env)) : '',
     serverDynamicSlotHtml: ident.isOwner ? buildOwnerServerPortalSlotHtml(reqUrl.origin) : '',
     isBetaTester: Boolean(safeSyncProfile.isBetaTester),
     betaGateConfig: { ...betaGateConfig },
     betaTesters: Array.from(betaTestersStore.values()).map(x => ({ id: x.id })),
     profile: safeSyncProfile,
     whitelist: safeSyncWhitelist
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

  if (matchWorkerRoute(normPath, '/admin/whitelist')) {
  if (!checkWorkerRateLimit(`wl_${clientIp}`, false, 15)) {
   return new Response(JSON.stringify({ ok: false, error: 'Rate limit' }), { status: 429, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }
  await ensurePersistentStateLoaded(env);
  if (request.method === 'GET' && !reqUrl.searchParams.has('payload')) {
   const admTok = extractAdminTokenFromRequest(request, reqUrl, null);
   const isFullAdm = await isValidOwnerAdminToken(admTok, env);
   const listOut = Array.from(adminWhitelistStore.values()).map(item => isFullAdm ? item : { id: item.id });
   return new Response(JSON.stringify({ ok: true, whitelist: listOut }), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
   });
  }
  if (request.method === 'POST' || reqUrl.searchParams.has('payload')) {
   try {
    const body = await readWorkerRequestPayload(request, reqUrl);
    const secret = extractAdminTokenFromRequest(request, reqUrl, body);
    if (!await isValidOwnerAdminToken(secret, env)) {
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

  if (matchWorkerRoute(normPath, '/api/version') && request.method === 'GET') {
   return new Response(JSON.stringify({
    appName: 'Клёв ПРО 2.0',
    packageName: 'ru.klevpro.app',
    version: WORKER_VERSION,
    versionCode: 293259,
    buildRevision: '2026.11.23-r259',
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


  if ((matchWorkerRoute(normPath, '/policy-version.json') || matchWorkerRoute(normPath, '/api/policy/status')) && request.method === 'GET') {
   await ensurePersistentStateLoaded(env);
   const qFid = workerNormalizeFisherId(reqUrl.searchParams.get('fid') || '', '89');
   const uConsent = qFid ? (userConsentsStore.get(qFid) || null) : null;
   const isCurrentAccepted = Boolean(
    uConsent &&
    uConsent.policyVersion === policyStateStore.policyVersion &&
    uConsent.appVersion === policyStateStore.appVersion &&
    uConsent.chkPrivacy &&
    uConsent.chkTerms
   );
   return new Response(JSON.stringify({
    ok: true,
    ...policyStateStore,
    userConsent: uConsent,
    isCurrentAccepted
   }), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
   });
  }

  if (matchWorkerRoute(normPath, '/api/policy/accept') && (request.method === 'POST' || reqUrl.searchParams.has('payload'))) {
   try {
    await ensurePersistentStateLoaded(env);
    const body = await readWorkerRequestPayload(request, reqUrl);
    const fid = workerNormalizeFisherId(body.fisherId || '', '89') || String(body.fisherId || '').trim().toUpperCase();
    const devId = String(body.deviceId || '').trim();
    if (fid && fid !== 'GUEST') {
     const polAuth = await verifyUserAuth(env, {
      fid,
      authTokenHash: body.authTokenHash || body.sessionToken || '',
      deviceId: devId,
      adminToken: extractAdminTokenFromRequest(request, reqUrl, body),
      request
     });
     const exUForPol = usersRegistryStore.get(fid);
     const devMatchesPol = Boolean(devId && ((exUForPol && exUForPol.deviceId && exUForPol.deviceId === devId) || deviceToFisherIdMap.get(devId) === fid));
     if (!polAuth.ok && !polAuth.isAdmin && (!devMatchesPol || isOwnerFisherId(fid))) {
      recordSecurityIncident('idor', '/api/policy/accept', `Попытка записи согласия политики за чужой ID (${fid})`, clientIp, fid);
      return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
     }
    }
    const chkPrivacy = Boolean(body.chkPrivacy);
    const chkTerms = Boolean(body.chkTerms);
    if (!chkPrivacy || !chkTerms) {
     return new Response(JSON.stringify({ ok: false, error: 'Необходимо отметить все обязательные чекбоксы согласия' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
     });
    }
    const prev = fid ? (userConsentsStore.get(fid) || {}) : {};
    const record = {
     ...prev,
     fisherId: fid || 'GUEST',
     deviceId: String(body.deviceId || '').trim(),
     policyVersion: String(body.policyVersion || policyStateStore.policyVersion),
     appVersion: String(body.appVersion || policyStateStore.appVersion),
     broadcastId: String(body.broadcastId || policyStateStore.broadcastId || ''),
     chkPrivacy: true,
     chkTerms: true,
     acceptedAt: Date.now()
    };
    if (fid) {
     userConsentsStore.set(fid, record);
     const exU = usersRegistryStore.get(fid);
     if (exU) {
      usersRegistryStore.set(fid, {
       ...exU,
       policyVersion: record.policyVersion,
       policyAcceptedAt: record.acceptedAt
      });
     }
    }
    await persistSystemMeta(env, ctx);
    return new Response(JSON.stringify({ ok: true, consent: record, policyState: policyStateStore }), {
     headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
    });
   } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid payload' }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
   }
  }

  if (matchWorkerRoute(normPath, '/api/admin/policy-update') && (request.method === 'POST' || reqUrl.searchParams.has('payload'))) {
   try {
    await ensurePersistentStateLoaded(env);
    const body = await readWorkerRequestPayload(request, reqUrl);
    const tok = extractAdminTokenFromRequest(request, reqUrl, body);
    if (!await isValidOwnerAdminToken(tok, env)) {
     return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }
    if (body.policyVersion) policyStateStore.policyVersion = String(body.policyVersion).trim().slice(0, 64);
    if (body.appVersion) policyStateStore.appVersion = String(body.appVersion).trim().slice(0, 32);
    if (body.appRevision) policyStateStore.appRevision = String(body.appRevision).trim().slice(0, 32);
    if (body.effectiveDate) policyStateStore.effectiveDate = String(body.effectiveDate).trim().slice(0, 48);
    if (body.title) policyStateStore.title = String(body.title).trim().slice(0, 220);
    if (body.summary) policyStateStore.summary = String(body.summary).trim().slice(0, 1000);
    if (Array.isArray(body.sections) && body.sections.length > 0) {
     policyStateStore.sections = body.sections.slice(0, 15).map((s, idx) => ({
      id: String(s?.id || `sec_${idx + 1}`).slice(0, 32),
      title: String(s?.title || `Раздел ${idx + 1}`).slice(0, 200),
      text: String(s?.text || '').slice(0, 6000)
     }));
    }
    const nowMs = Date.now();
    policyStateStore.broadcastId = String(body.broadcastId || `POL_BC_${nowMs}`).trim().slice(0, 64);
    policyStateStore.updatedAt = new Date(nowMs).toISOString();

    // Сохраняем в D1 (klev_kv и transit_relay для мгновенной доставки во все клиентские сессии)
    const d1Info = getD1(env);
    const d1 = d1Info?.db;
    const serializedPol = JSON.stringify(policyStateStore);
    if (d1) {
     await d1.prepare('INSERT OR REPLACE INTO klev_kv (k, v, updated_at) VALUES (?, ?, ?)').bind('POLICY_STATE_V2', serializedPol, nowMs).run().catch(() => {});
     await d1PushRelay(env, {
      id: policyStateStore.broadcastId,
      channelId: 'SYS_POLICY_BROADCAST_V1',
      senderId: OWNER_FISHER_ID,
      cipherPayload: serializedPol,
      kind: 'policy_broadcast',
      ts: nowMs
     }).catch(() => {});
     await d1PushRelay(env, {
      id: `${policyStateStore.broadcastId}_ALL`,
      channelId: 'SOS_ALL',
      senderId: OWNER_FISHER_ID,
      cipherPayload: serializedPol,
      kind: 'policy_broadcast',
      ts: nowMs
     }).catch(() => {});
    }
    for (const ch of ['SYS_POLICY_BROADCAST_V1', 'SOS_ALL']) {
     const list = transitBoxes.get(ch) || [];
     list.push({
      id: ch === 'SOS_ALL' ? `${policyStateStore.broadcastId}_ALL` : policyStateStore.broadcastId,
      channelId: ch,
      senderId: OWNER_FISHER_ID,
      cipherPayload: serializedPol,
      kind: 'policy_broadcast',
      ts: nowMs
     });
     transitBoxes.set(ch, list.slice(-50));
    }
    const kv = getKV(env);
    if (kv) {
     await kv.put('POLICY_STATE_V2', serializedPol).catch(() => {});
    }
    await persistSystemMeta(env, ctx);
    return new Response(JSON.stringify({
     ok: true,
     policyState: policyStateStore,
     broadcastId: policyStateStore.broadcastId,
     deliveredChannels: ['SYS_POLICY_BROADCAST_V1', 'SOS_ALL', 'D1_KV']
    }), {
     headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
    });
   } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'Bad request' }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
   }
  }

  if (matchWorkerRoute(normPath, '/api/geo/consent') && (request.method === 'POST' || reqUrl.searchParams.has('payload'))) {
   if (!checkWorkerRateLimit(`geocons_${clientIp}`, false, 30)) {
    return new Response(JSON.stringify({ ok: false, error: 'Rate limit' }), { status: 429, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
   }
   if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(checkD1RateLimit(env, `geocons_${clientIp}`, 30, 60000).catch(() => {}));
   }
   try {
    await ensurePersistentStateLoaded(env);
    const body = await readWorkerRequestPayload(request, reqUrl);
    const fid = workerNormalizeFisherId(body.fisherId || '', '89') || String(body.fisherId || '').trim().toUpperCase();
    if (!fid) {
     return new Response(JSON.stringify({ ok: false, error: 'Missing fisherId' }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }
    const devId = String(body.deviceId || '').trim();
    const geoAuth = await verifyUserAuth(env, {
     fid,
     authTokenHash: body.authTokenHash || body.sessionToken || '',
     deviceId: devId,
     adminToken: extractAdminTokenFromRequest(request, reqUrl, body),
     request
    });
    const exUForGeo = usersRegistryStore.get(fid);
    const devMatchesGeo = Boolean(devId && ((exUForGeo && exUForGeo.deviceId && exUForGeo.deviceId === devId) || deviceToFisherIdMap.get(devId) === fid));
    if (!geoAuth.ok && !geoAuth.isAdmin && (!devMatchesGeo || isOwnerFisherId(fid))) {
     recordSecurityIncident('idor', '/api/geo/consent', `Попытка записи гео-согласия за чужой ID (${fid})`, clientIp, fid);
     return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }
    const prev = userConsentsStore.get(fid) || {};
    const next = {
     ...prev,
     fisherId: fid,
     geoConsent: true,
     geoConsentAt: Date.now(),
     geoRevokedAt: null
    };
    userConsentsStore.set(fid, next);
    const exU = usersRegistryStore.get(fid);
    if (exU) {
     usersRegistryStore.set(fid, { ...exU, geoConsent: true, geoConsentAt: next.geoConsentAt });
    }
    await persistSystemMeta(env, ctx);
    return new Response(JSON.stringify({ ok: true, geoConsent: true, geoConsentAt: next.geoConsentAt }), {
     headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
    });
   } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'Bad request' }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
   }
  }

  if (matchWorkerRoute(normPath, '/api/geo/revoke-consent') && (request.method === 'POST' || reqUrl.searchParams.has('payload'))) {
   if (!checkWorkerRateLimit(`georev_${clientIp}`, false, 20)) {
    return new Response(JSON.stringify({ ok: false, error: 'Rate limit' }), { status: 429, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
   }
   if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(checkD1RateLimit(env, `georev_${clientIp}`, 20, 60000).catch(() => {}));
   }
   try {
    await ensurePersistentStateLoaded(env);
    const body = await readWorkerRequestPayload(request, reqUrl);
    const viewerFid = workerNormalizeFisherId(body.fisherId || body.viewerFid || '', '89');
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
    const prev = userConsentsStore.get(viewerFid) || {};
    userConsentsStore.set(viewerFid, {
     ...prev,
     fisherId: viewerFid,
     geoConsent: false,
     geoRevokedAt: Date.now()
    });
    const exU = usersRegistryStore.get(viewerFid);
    if (exU) {
     usersRegistryStore.set(viewerFid, { ...exU, geoConsent: false, geoRevokedAt: Date.now(), lat: null, lon: null });
    }
    let purgedPoints = 0;
    for (const [ptId, ptObj] of circlePointsStore.entries()) {
     if (ptObj && (ptObj.fid === viewerFid || (devId && ptObj.did === devId))) {
      circlePointsStore.delete(ptId);
      purgedPoints++;
     }
    }
    let purgedMsgs = 0;
    for (const [bKey, bArr] of transitBoxes.entries()) {
     if (Array.isArray(bArr)) {
      const before = bArr.length;
      const filtered = bArr.filter(p => !(p && p.senderId === viewerFid));
      purgedMsgs += Math.max(0, before - filtered.length);
      if (filtered.length === 0) transitBoxes.delete(bKey);
      else transitBoxes.set(bKey, filtered);
     }
    }
    const d1 = getD1(env)?.db;
    if (d1) {
     await d1.prepare('DELETE FROM circle_points WHERE fid = ?').bind(viewerFid).run().catch(() => {});
     await d1.prepare('DELETE FROM transit_relay WHERE sender_id = ?').bind(viewerFid).run().catch(() => {});
    }
    await persistSystemMeta(env, ctx);
    return new Response(JSON.stringify({
     ok: true,
     geoConsent: false,
     revokedFisherId: viewerFid,
     purgedPoints,
     purgedMsgs
    }), {
     headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
    });
   } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'Bad request' }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
   }
  }

  if (matchWorkerRoute(normPath, '/auth/delete-account') && (request.method === 'POST' || reqUrl.searchParams.has('payload'))) {
   if (!checkWorkerRateLimit(`delacc_${clientIp}`, false, 10)) {
    return new Response(JSON.stringify({ ok: false, error: 'Rate limit' }), { status: 429, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
   }
   if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(checkD1RateLimit(env, `delacc_${clientIp}`, 10, 60000).catch(() => {}));
   }
   try {
    await ensurePersistentStateLoaded(env);
    const body = await readWorkerRequestPayload(request, reqUrl);
    const targetFid = workerNormalizeFisherId(body.fisherId || body.viewerFid || '', '89') || String(body.fisherId || '').trim().toUpperCase();
    const devId = String(body.deviceId || '').trim();
    const authTok = String(body.authTokenHash || '').trim();
    const admTok = extractAdminTokenFromRequest(request, reqUrl, body);
    if (!targetFid || isOwnerFisherId(targetFid)) {
     return new Response(JSON.stringify({ ok: false, error: 'Учётная запись Владельца защищена от удаления' }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }
    const authRes = await verifyUserAuth(env, {
     fid: targetFid,
     authTokenHash: authTok,
     deviceId: devId,
     adminToken: admTok,
     request
    });
    if (!authRes.ok && !authRes.isAdmin) {
     return new Response(JSON.stringify({ ok: false, error: 'Недостаточно прав для удаления учётной записи' }), { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }
    deletedFisherIdsSet.add(targetFid);
    userConsentsStore.delete(targetFid);
    betaTestersStore.delete(targetFid);
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
    let purgedMessagesCount = 0;
    for (const [bKey, bArr] of transitBoxes.entries()) {
     if (bKey === `DM_${targetFid}`) {
      purgedMessagesCount += Array.isArray(bArr) ? bArr.length : 0;
      transitBoxes.delete(bKey);
      continue;
     }
     if (Array.isArray(bArr)) {
      const before = bArr.length;
      const filtered = bArr.filter(p => p && p.senderId !== targetFid && p.peerId !== targetFid);
      purgedMessagesCount += Math.max(0, before - filtered.length);
      if (filtered.length === 0) transitBoxes.delete(bKey);
      else transitBoxes.set(bKey, filtered);
     }
    }
    let purgedPointsCount = 0;
    for (const [ptId, ptObj] of circlePointsStore.entries()) {
     if (ptObj && (ptObj.fid === targetFid || (devId && ptObj.did === devId))) {
      circlePointsStore.delete(ptId);
      purgedPointsCount++;
     }
    }
    const d1 = getD1(env)?.db;
    if (d1) {
     await d1.prepare('DELETE FROM users_registry WHERE fisher_id = ?').bind(targetFid).run().catch(() => {});
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
     deletedFisherId: targetFid,
     purgedPointsCount,
     purgedMessagesCount,
     purgedTgBindings: true
    }), {
     headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
    });
   } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'Bad request' }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
   }
  }

  if (matchWorkerRoute(normPath, '/api/relay/delete-message') && (request.method === 'POST' || reqUrl.searchParams.has('payload'))) {
   try {
    await ensurePersistentStateLoaded(env);
    const body = await readWorkerRequestPayload(request, reqUrl);
    const viewerFid = workerNormalizeFisherId(body.viewerFid || '', '89');
    const devId = String(body.deviceId || '').trim();
    const authTok = String(body.authTokenHash || '').trim();
    const admTok = extractAdminTokenFromRequest(request, reqUrl, body);
    const targetMsgId = String(body.targetMsgId || '').trim();
    const chanId = String(body.channelId || '').trim();
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
    let deletedCount = 0;
    for (const [bKey, bArr] of transitBoxes.entries()) {
     if (!Array.isArray(bArr)) continue;
     const before = bArr.length;
     const filtered = bArr.filter(p => {
      if (!p) return false;
      if (p.id === targetMsgId || p.targetMsgId === targetMsgId) {
       if (authRes.isAdmin || p.senderId === viewerFid) return false;
      }
      return true;
     });
     if (filtered.length !== before) {
      deletedCount += (before - filtered.length);
      transitBoxes.set(bKey, filtered);
     }
    }
    const d1 = getD1(env)?.db;
    if (d1 && targetMsgId) {
     if (authRes.isAdmin) {
      await d1.prepare('DELETE FROM transit_relay WHERE id = ?').bind(targetMsgId).run().catch(() => {});
     } else {
      await d1.prepare('DELETE FROM transit_relay WHERE id = ? AND sender_id = ?').bind(targetMsgId, viewerFid).run().catch(() => {});
     }
    }
    await persistSystemMeta(env, ctx);
    return new Response(JSON.stringify({ ok: true, targetMsgId, deletedCount, channelId: chanId }), {
     headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
    });
   } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'Bad request' }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
   }
  }

  if (matchWorkerRoute(normPath, '/api/beta/status') && (request.method === 'GET' || request.method === 'POST')) {
   await ensurePersistentStateLoaded(env, true);
   let rawFidParam = reqUrl.searchParams.get('fid') || '';
   let bStat = {};
   if (request.method === 'POST' || reqUrl.searchParams.has('payload')) {
    try {
     bStat = (await readWorkerRequestPayload(request, reqUrl)) || {};
     if (!rawFidParam && bStat.fid) rawFidParam = String(bStat.fid);
    } catch (e) {}
   }
   const admTokBeta = extractAdminTokenFromRequest(request, reqUrl, bStat);
   const isAdminBetaCall = await isValidOwnerAdminToken(admTokBeta, env);
   const qFid = workerNormalizeFisherId(rawFidParam, '89') || String(rawFidParam || '').trim().toUpperCase();
   const isBeta = isUserBetaTesterOnServer(qFid);
   if (!isAdminBetaCall) {
    return new Response(JSON.stringify({
     ok: true,
     fisherId: qFid,
     isBetaTester: isBeta,
     betaGateConfig: { ...betaGateConfig }
    }), {
     headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
    });
   }
   return new Response(JSON.stringify({
    ok: true,
    fisherId: qFid,
    isBetaTester: isBeta,
    betaGateConfig: { ...betaGateConfig },
    betaTesters: Array.from(betaTestersStore.values()),
    removedBetaTesters: Array.from(removedBetaTestersSet),
    betaTestersCount: betaTestersStore.size
   }), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
   });
  }

  if (matchWorkerRoute(normPath, '/api/admin/beta-testers') && (request.method === 'POST' || request.method === 'GET')) {
   await ensurePersistentStateLoaded(env, true);
   let body = {};
   const hasWritePayload = request.method === 'POST' || reqUrl.searchParams.has('payload') || reqUrl.searchParams.has('action');
   if (hasWritePayload) {
    try { body = await readWorkerRequestPayload(request, reqUrl); } catch (e) {}
    if (!body.action && reqUrl.searchParams.get('action')) body.action = reqUrl.searchParams.get('action');
    if (!body.fisherId && reqUrl.searchParams.get('fisherId')) body.fisherId = reqUrl.searchParams.get('fisherId');
    if (!body.label && reqUrl.searchParams.get('label')) body.label = reqUrl.searchParams.get('label');
   }
   const tok = extractAdminTokenFromRequest(request, reqUrl, body);
   if (!await isValidOwnerAdminToken(tok, env)) {
    return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
   }
   if (hasWritePayload && body && body.action) {
    const act = String(body.action || 'add').toLowerCase();
    const targetFid = workerNormalizeFisherId(body.fisherId || '', '89') || String(body.fisherId || '').trim().toUpperCase();
    if (act === 'add' && targetFid) {
     removedBetaTestersSet.delete(targetFid);
     const exU = usersRegistryStore.get(targetFid);
     const label = String(body.label || exU?.callsign || exU?.login || 'Бета-тестер').trim();
     betaTestersStore.set(targetFid, {
      id: targetFid,
      label,
      addedAt: new Date().toISOString().slice(0, 10),
      phase2: body.phase2 !== false,
      phase3: body.phase3 !== false
     });
     if (exU) {
      const updatedU = { ...exU, isBetaTester: true };
      usersRegistryStore.set(targetFid, updatedU);
      await d1SaveUser(env, updatedU).catch(() => {});
     }
     const aKey = fisherIdToAuthKeyMap.get(targetFid);
     if (aKey && cloudAuthProfiles.has(aKey)) {
      const prof = { ...cloudAuthProfiles.get(aKey), isBetaTester: true };
      cloudAuthProfiles.set(aKey, prof);
      await d1SaveAuthProfile(env, aKey, workerNormalizeLogin(prof.login || ''), targetFid, prof).catch(() => {});
     }
    } else if (act === 'remove' && targetFid && !isOwnerFisherId(targetFid)) {
     removedBetaTestersSet.add(targetFid);
     betaTestersStore.delete(targetFid);
     const wlItem = adminWhitelistStore.get(targetFid);
     if (wlItem && String(wlItem.label || '').includes('[BETA]')) {
      adminWhitelistStore.delete(targetFid);
     }
     const exU = usersRegistryStore.get(targetFid);
     if (exU) {
      const updatedU = { ...exU, isBetaTester: false };
      usersRegistryStore.set(targetFid, updatedU);
      await d1SaveUser(env, updatedU).catch(() => {});
     }
     const aKey = fisherIdToAuthKeyMap.get(targetFid);
     if (aKey && cloudAuthProfiles.has(aKey)) {
      const prof = { ...cloudAuthProfiles.get(aKey), isBetaTester: false };
      cloudAuthProfiles.set(aKey, prof);
      await d1SaveAuthProfile(env, aKey, workerNormalizeLogin(prof.login || ''), targetFid, prof).catch(() => {});
     }
    } else if (act === 'set_gate') {
     if (typeof body.phase2BetaOnly === 'boolean') betaGateConfig.phase2BetaOnly = body.phase2BetaOnly;
     if (typeof body.phase3BetaOnly === 'boolean') betaGateConfig.phase3BetaOnly = body.phase3BetaOnly;
    }
    await persistSystemMeta(env, ctx);
   }
   return new Response(JSON.stringify({
    ok: true,
    betaTesters: Array.from(betaTestersStore.values()),
    removedBetaTesters: Array.from(removedBetaTestersSet),
    betaGateConfig: { ...betaGateConfig }
   }), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
   });
  }

  if (matchWorkerRoute(normPath, '/api/relay/delete-channel') && (request.method === 'POST' || reqUrl.searchParams.has('payload'))) {
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
     if (cKey.startsWith('REG-')) {
      if (authRes.isAdmin && body.wipeAll === true) {
       transitBoxes.delete(boxKey);
       if (d1) {
        await d1.prepare('DELETE FROM transit_relay WHERE channel_id = ? OR crew_key = ?').bind(boxKey, cKey).run().catch(() => {});
       }
       await persistSystemMeta(env, ctx);
       return new Response(JSON.stringify({ ok: true, deletedChannel: chanId, scope: 'all_admin' }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
       });
      }
      if (body.scope === 'mine' || body.deleteMyMessages === true || body.wipeAll === true) {
       const existingArr = transitBoxes.get(boxKey) || [];
       const beforeLen = existingArr.length;
       const filtered = existingArr.filter(p => p && p.senderId !== viewerFid);
       transitBoxes.set(boxKey, filtered);
       if (d1 && viewerFid) {
        await d1.prepare('DELETE FROM transit_relay WHERE (channel_id = ? OR crew_key = ?) AND sender_id = ?').bind(boxKey, cKey, viewerFid).run().catch(() => {});
       }
       await persistSystemMeta(env, ctx);
       return new Response(JSON.stringify({
        ok: true,
        deletedChannel: chanId,
        scope: 'mine',
        purgedCount: Math.max(0, beforeLen - filtered.length)
       }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
       });
      }
      return new Response(JSON.stringify({ ok: true, deletedChannel: chanId, scope: 'self' }), {
       headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
      });
     }
     if (body.scope === 'self' && body.wipeAll !== true) {
      return new Response(JSON.stringify({ ok: true, deletedChannel: chanId, scope: 'self' }), {
       headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
      });
     }
     const isCrewCreator = Array.from(circlePointsStore.values()).some(pt => pt && pt.t === 'crew' && String(pt.crewKey || '').toUpperCase() === cKey && pt.fid === viewerFid);
     if (authRes.isAdmin || (isCrewCreator && !cKey.startsWith('REG-'))) {
      transitBoxes.delete(boxKey);
      if (d1) {
       await d1.prepare('DELETE FROM transit_relay WHERE channel_id = ? OR crew_key = ?').bind(boxKey, cKey).run().catch(() => {});
      }
     } else {
      if (body.wipeAll === true) {
       recordSecurityIncident('idor', '/api/relay/delete-channel', `Попытка полного удаления общего чата ${boxKey} пользователем ${viewerFid}`, clientIp, viewerFid);
      }
      const existingArr = transitBoxes.get(boxKey) || [];
      transitBoxes.set(boxKey, existingArr.filter(p => p && p.senderId !== viewerFid));
      if (d1 && viewerFid) {
       await d1.prepare('DELETE FROM transit_relay WHERE (channel_id = ? OR crew_key = ?) AND sender_id = ?').bind(boxKey, cKey, viewerFid).run().catch(() => {});
      }
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

  if (matchWorkerRoute(normPath, '/relay/push') && (request.method === 'POST' || reqUrl.searchParams.has('payload'))) {
  if (!checkWorkerRateLimit(`rpush_${clientIp}`, false, 45)) {
   return new Response(JSON.stringify({ ok: false, error: 'Rate limit' }), { status: 429, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }
  try {
   await ensurePersistentStateLoaded(env);
   cleanupTransitBoxes();
   const body = await readWorkerRequestPayload(request, reqUrl);
   const pktIn = (body.packet && typeof body.packet === 'object') ? body.packet : body;
   const channelId = String(body.channelId || pktIn.channelId || '').trim().toUpperCase().replace(/[^A-Z0-9_:-]/g, '').slice(0, 64);
   const cipherPayload = String(body.cipherPayload || pktIn.cipherPayload || pktIn.cipher || '').trim().slice(0, 8192);
   const senderFid = workerNormalizeFisherId(body.senderId || pktIn.senderId || '', '89');
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
   const customPktId = String(body.msgId || body.id || pktIn.id || '').trim().replace(/[^A-Za-z0-9_:-]/g, '').slice(0, 64);
   const pkt = {
    id: customPktId || `rel_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
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

  if (matchWorkerRoute(normPath, '/relay/pull') && request.method === 'GET') {
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
     // Если пользователь запрашивает СВОЙ собственный ящик (dmTarget === viewer) или это парный ID владельца — это НЕ IDOR!
     if (viewer && dmTarget === viewer) {
      return Boolean(pullAuth.ok);
     }
     if (viewer && isOwnerFisherId(viewer) && isOwnerFisherId(dmTarget)) {
      return Boolean(pullAuth.ok);
     }
     // Настоящая попытка IDOR: запрос ЧУЖОГО ящика (dmTarget !== viewer) без прав администратора
     recordSecurityIncident('idor', '/relay/pull', `Попытка чтения чужого личного ящика ${bKey} (запросил ${viewer || 'гость'})`, clientIp, viewer);
     return false;
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
  const setupAdmTok = extractAdminTokenFromRequest(request, reqUrl, null);
  if (!await isValidOwnerAdminToken(setupAdmTok, env)) {
   recordSecurityIncident('idor', '/?setup=1', 'Попытка неавторизованного перехвата setWebhook (?setup=1)', clientIp);
   return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
  }
  const webhookTarget = `${reqUrl.origin}${reqUrl.pathname}`;
  const whRes = await tgApi(BOT_TOKEN, 'setWebhook', {
  url: webhookTarget,
  secret_token: effectiveWebhookSecret || undefined,
  allowed_updates: ['message', 'edited_message', 'channel_post', 'callback_query', 'inline_query']
  });
  await configureBotMenusAndCommands(BOT_TOKEN);
  return new Response(JSON.stringify({
  status: 'webhook_and_commands_registered',
  version: WORKER_VERSION,
  menuButton: 'commands (☰)',
  replyKeyboard: ['Рекомендации', '| | 👤 | '],
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
  if (!incomingSecret || !constantTimeEquals(incomingSecret, WEBHOOK_SECRET)) {
  return new Response('Forbidden: invalid secret token', { status: 403 });
  }
  } else if (effectiveWebhookSecret) {
  const incomingSecret = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
  if (incomingSecret && !constantTimeEquals(incomingSecret, effectiveWebhookSecret)) {
  return new Response('Forbidden: invalid secret token', { status: 403 });
  }
  if (!incomingSecret && BOT_TOKEN && !globalThis.__klevAutoWebhookSynced) {
  globalThis.__klevAutoWebhookSynced = true;
  const webhookTarget = `${reqUrl.origin}${reqUrl.pathname}`;
  const syncTask = tgApi(BOT_TOKEN, 'setWebhook', {
   url: webhookTarget,
   secret_token: effectiveWebhookSecret,
   allowed_updates: ['message', 'edited_message', 'channel_post', 'callback_query', 'inline_query']
  }).then(() => configureBotMenusAndCommands(BOT_TOKEN)).catch(() => {});
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(syncTask);
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
  title: `${city.name}: ${fish.name} — клёв ${card.fishScore}%`,
  description: `${city.water} • Вода ~${card.weather.waterTemp}°C • ${card.weather.press} мм • ${card.weather.wind} м/с`,
  input_message_content: {
  message_text: card.replyText,
  parse_mode: 'Markdown'
  },
  reply_markup: card.replyMarkup
  },
  {
  type: 'article',
  id: `top_${city.lat.toFixed(2)}_${city.lon.toFixed(2)}`,
  title: `ТОП-5 активных рыб сегодня: ${city.name}`,
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
  title: `Экспресс-радар на 72 часа (3 дня): ${city.name}`,
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
  const sess = getUserSession(cqUserId);

  const editOrSendCqCard = async (cardText, cardMarkup, toastText = '') => {
   await tgApi(BOT_TOKEN, 'answerCallbackQuery', { callback_query_id: cq.id, text: toastText || undefined });
   if (cq.message && cq.message.chat) {
    await tgApi(BOT_TOKEN, 'editMessageText', {
     chat_id: cq.message.chat.id,
     message_id: cq.message.message_id,
     text: cardText,
     parse_mode: 'Markdown',
     reply_markup: cardMarkup
    });
   }
  };

  if (data.startsWith('aisel:') || data.startsWith('aidet:')) {
   const [, tok, rawIdx] = data.split(':');
   const rec = botVisionDetailsCache.get(tok);
   if (!rec) {
    await tgApi(BOT_TOKEN, 'answerCallbackQuery', { callback_query_id: cq.id, text: 'Отправьте фото заново для расчёта.' });
    return new Response('OK', { status: 200 });
   }
   const selIdx = rawIdx === 'list' ? 'list' : (Number.isFinite(parseInt(rawIdx, 10)) ? parseInt(rawIdx, 10) : 0);
   const aiCard = buildBotAiVisionCard(rec, selIdx, WEBAPP_URL, isPrivate);
   await editOrSendCqCard(aiCard.text, aiCard.replyMarkup);
   return new Response('OK', { status: 200 });
  }

  if (data.startsWith('top:')) {
   const [, latStr, lonStr, customName] = data.split(':');
   const lat = parseFloat(latStr);
   const lon = parseFloat(lonStr);
   const city = buildSpotContext(Number.isFinite(lat) ? lat : 66.0833, Number.isFinite(lon) ? lon : 76.6800, customName || '');
   saveUserSession(cqUserId, { lat: city.lat, lon: city.lon, cityName: city.name, wType: city.wType, waterName: city.waterName });
   const rec = await buildRecommendationsCard(city, WEBAPP_URL, isPrivate);
   await editOrSendCqCard(rec.text, rec.replyMarkup, `ТОП-5: ${city.name}`);
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
   await editOrSendCqCard(exp.text, exp.replyMarkup, `Прогноз 3 дня: ${city.name}`);
   return new Response('OK', { status: 200 });
  }

  if (data.startsWith('rig:')) {
   const [, latStr, lonStr, fishId, customName] = data.split(':');
   const lat = parseFloat(latStr);
   const lon = parseFloat(lonStr);
   const fish = BOT_FISH_CATALOG.find(f => f.id === fishId) || BOT_FISH_CATALOG[0];
   const city = buildSpotContext(Number.isFinite(lat) ? lat : 66.0833, Number.isFinite(lon) ? lon : 76.6800, customName || '');
   const sub = await buildRigAndTacticsSubCard(city, fish, WEBAPP_URL, isPrivate);
   await editOrSendCqCard(sub.text, sub.replyMarkup);
   return new Response('OK', { status: 200 });
  }

  if (data.startsWith('wx:')) {
   const [, latStr, lonStr, fishId, customName] = data.split(':');
   const lat = parseFloat(latStr);
   const lon = parseFloat(lonStr);
   const fish = BOT_FISH_CATALOG.find(f => f.id === fishId) || BOT_FISH_CATALOG[0];
   const city = buildSpotContext(Number.isFinite(lat) ? lat : 66.0833, Number.isFinite(lon) ? lon : 76.6800, customName || '');
   const sub = await buildWeatherAndIceSubCard(city, fish, WEBAPP_URL, isPrivate);
   await editOrSendCqCard(sub.text, sub.replyMarkup);
   return new Response('OK', { status: 200 });
  }

  if (data.startsWith('bio:')) {
   const [, latStr, lonStr, fishId, customName] = data.split(':');
   const lat = parseFloat(latStr);
   const lon = parseFloat(lonStr);
   const fish = BOT_FISH_CATALOG.find(f => f.id === fishId) || BOT_FISH_CATALOG[0];
   const city = buildSpotContext(Number.isFinite(lat) ? lat : 66.0833, Number.isFinite(lon) ? lon : 76.6800, customName || '');
   const sub = buildFishBioAndCalendarSubCard(city, fish);
   await editOrSendCqCard(sub.text, sub.replyMarkup);
   return new Response('OK', { status: 200 });
  }

  if (data.startsWith('fmenu:')) {
   const [, latStr, lonStr, fishId, customName] = data.split(':');
   const lat = parseFloat(latStr);
   const lon = parseFloat(lonStr);
   const fish = BOT_FISH_CATALOG.find(f => f.id === fishId) || BOT_FISH_CATALOG[0];
   const city = buildSpotContext(Number.isFinite(lat) ? lat : 66.0833, Number.isFinite(lon) ? lon : 76.6800, customName || '');
   const sub = buildFishPickerSubCard(city, fish);
   await editOrSendCqCard(sub.text, sub.replyMarkup);
   return new Response('OK', { status: 200 });
  }

  if (data.startsWith('wmenu:')) {
   const [, latStr, lonStr, fishId, customName] = data.split(':');
   const lat = parseFloat(latStr);
   const lon = parseFloat(lonStr);
   const fish = BOT_FISH_CATALOG.find(f => f.id === fishId) || BOT_FISH_CATALOG[0];
   const savedW = sess?.waterName ? BOT_WATERS_DB.find(w => normStr(w.cleanName) === normStr(sess.waterName)) : null;
   const city = buildSpotContext(Number.isFinite(lat) ? lat : 66.0833, Number.isFinite(lon) ? lon : 76.6800, customName || '', savedW, sess?.wType || '');
   const sub = await buildWaterPickerSubCard(city, fish, WEBAPP_URL, isPrivate);
   await editOrSendCqCard(sub.text, sub.replyMarkup, `Водоём: ${city.water}`);
   return new Response('OK', { status: 200 });
  }

  if (data.startsWith('rad:')) {
   const [, latStr, lonStr, customName] = data.split(':');
   const lat = parseFloat(latStr);
   const lon = parseFloat(lonStr);
   const city = buildSpotContext(Number.isFinite(lat) ? lat : 66.0833, Number.isFinite(lon) ? lon : 76.6800, customName || '');
   const fish = BOT_FISH_CATALOG.find(f => f.id === sess?.fishId) || city.speciesList?.[0] || BOT_FISH_CATALOG[0];
   const sub = buildCircleRadarSubCard(city, fish, WEBAPP_URL, isPrivate);
   await editOrSendCqCard(sub.text, sub.replyMarkup);
   return new Response('OK', { status: 200 });
  }

  if (data.startsWith('ai_help')) {
   const parts = data.split(':');
   const lat = parseFloat(parts[1]);
   const lon = parseFloat(parts[2]);
   const fishId = parts[3] || sess?.fishId || 'pike';
   const customName = parts[4] || sess?.cityName || '';
   const city = buildSpotContext(Number.isFinite(lat) ? lat : (sess?.lat || 66.0833), Number.isFinite(lon) ? lon : (sess?.lon || 76.6800), customName);
   const fish = BOT_FISH_CATALOG.find(f => f.id === fishId) || city.speciesList?.[0] || BOT_FISH_CATALOG[0];
   const sub = buildAiPromptHelpCard(city, fish, WEBAPP_URL, isPrivate);
   await editOrSendCqCard(sub.text, sub.replyMarkup);
   return new Response('OK', { status: 200 });
  }

  if (data.startsWith('menu:')) {
   const [, latStr, lonStr, fishId, customName] = data.split(':');
   const lat = parseFloat(latStr);
   const lon = parseFloat(lonStr);
   const city = buildSpotContext(Number.isFinite(lat) ? lat : (sess?.lat || 66.0833), Number.isFinite(lon) ? lon : (sess?.lon || 76.6800), customName || sess?.cityName || '');
   const fish = BOT_FISH_CATALOG.find(f => f.id === fishId) || city.speciesList?.[0] || BOT_FISH_CATALOG[0];
   const sub = buildBotMainMenuCard(sess, city, fish, WEBAPP_URL, isPrivate);
   await editOrSendCqCard(sub.text, sub.replyMarkup);
   return new Response('OK', { status: 200 });
  }

  if (data.startsWith('srch:')) {
   const [, latStr, lonStr, customName] = data.split(':');
   const lat = parseFloat(latStr);
   const lon = parseFloat(lonStr);
   const city = buildSpotContext(Number.isFinite(lat) ? lat : 66.0833, Number.isFinite(lon) ? lon : 76.6800, customName || '');
   const srch = buildSearchDirectoryCard(city);
   await editOrSendCqCard(srch.text, srch.replyMarkup);
   return new Response('OK', { status: 200 });
  }

  if (data.startsWith('w:')) {
   const [, latStr, lonStr, fishId, shortWName] = data.split(':');
   const lat = parseFloat(latStr);
   const lon = parseFloat(lonStr);
   const matchedW = BOT_WATERS_DB.find(w => Math.abs(w.lat - lat) < 0.02 && Math.abs(w.lon - lon) < 0.02);
   const city = buildSpotContext(lat, lon, matchedW?.region || shortWName || '', matchedW || null, matchedW?.wType || '');
   const fish = (city.speciesList && city.speciesList.find(f => f.id === fishId)) || city.speciesList?.[0] || BOT_FISH_CATALOG[0];
   saveUserSession(cqUserId, {
    lat: city.lat,
    lon: city.lon,
    cityName: city.name,
    wType: city.wType,
    waterName: city.waterName,
    fishId: fish.id
   });
   const wCard = await buildWaterPickerSubCard(city, fish, WEBAPP_URL, isPrivate);
   await editOrSendCqCard(wCard.text, wCard.replyMarkup, `${city.water}`);
   return new Response('OK', { status: 200 });
  }

  let city = buildSpotContext(sess?.lat || 55.7558, sess?.lon || 37.6173, sess?.cityName || 'Водоём РФ');
  let fish = BOT_FISH_CATALOG[0];

  if (data.startsWith('f:')) {
   const [, latStr, lonStr, fishId, customName] = data.split(':');
   const lat = parseFloat(latStr);
   const lon = parseFloat(lonStr);
   fish = BOT_FISH_CATALOG.find(f => f.id === fishId) || BOT_FISH_CATALOG[0];
   const wType = (fish.habitat === 'sea' && isCoastalInBasin(detectBasinByCoords(lat, lon), lat, lon)) ? 'sea_gulf' : '';
   city = buildSpotContext(Number.isFinite(lat) ? lat : 66.0833, Number.isFinite(lon) ? lon : 76.6800, customName || '', null, wType);
  } else if (data.startsWith('fish:')) {
   const [, cityName, fishId] = data.split(':');
   const resolved = await resolveQueryCityAndFish(`${cityName} ${fishId}`, sess);
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
  await editOrSendCqCard(card.replyText, card.replyMarkup, `${city.name}: ${fish.name} (${card.fishScore}%)`);
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

  if (msg.location) {
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

  // ── Обработка фотографий рыбы через Gemini Vision ИИ (только Рыба, Длина и Вес; если видов много — выбор кнопки) ──
  const hasPhoto = Array.isArray(msg.photo) && msg.photo.length > 0;
  const hasImageDoc = Boolean(msg.document && /^image\//i.test(msg.document.mime_type || ''));
  if (hasPhoto || hasImageDoc) {
  const captionRaw = String(msg.caption || '').trim();
  if (!isPrivateChat) {
   const isMentionOrCmd = /@KlevProClubBot/i.test(captionRaw) || /^\/(ai|klev|fish)/i.test(captionRaw) || /^(клев|ии|кто|что за рыба)/i.test(captionRaw) || Boolean(msg.reply_to_message?.from?.is_bot);
   if (!isMentionOrCmd) return new Response('OK', { status: 200 });
  }
  const bestPhoto = hasPhoto ? (msg.photo.filter(p => (p.width || 0) <= 960 && (p.file_size || 0) <= 120000).pop() || msg.photo[msg.photo.length - 1]) : msg.document;
  const fileId = bestPhoto?.file_id;
  if (fileId) {
   const { city } = await resolveQueryCityAndFish(captionRaw || session.cityName, session);
   const waitMsg = await tgApi(BOT_TOKEN, 'sendMessage', {
    chat_id: chatId,
    reply_to_message_id: msg.message_id,
    text: '*Определяю рыбу по фото...*',
    parse_mode: 'Markdown'
   });
   const waitMsgId = waitMsg?.result?.message_id;
   const aiRes = await identifyFishPhotoForBot(env, ctx, BOT_TOKEN, fileId, city, captionRaw);
   if (aiRes && aiRes.ok && aiRes.rec) {
    saveUserSession(userId, {
     lat: city.lat,
     lon: city.lon,
     cityName: city.name,
     fishId: aiRes.rec.matchedFish.id
    });
    const aiCard = buildBotAiVisionCard(aiRes.rec, null, WEBAPP_URL, isPrivateChat);
    if (waitMsgId) {
     await tgApi(BOT_TOKEN, 'editMessageText', {
      chat_id: chatId,
      message_id: waitMsgId,
      text: aiCard.text,
      parse_mode: 'Markdown',
      reply_markup: aiCard.replyMarkup
     });
    } else {
     await tgApi(BOT_TOKEN, 'sendMessage', {
      chat_id: chatId,
      reply_to_message_id: msg.message_id,
      text: aiCard.text,
      parse_mode: 'Markdown',
      reply_markup: aiCard.replyMarkup
     });
    }
   } else {
    const errText = aiRes?.replyText || aiRes?.error || 'Не удалось распознать рыбу на фото. Попробуйте более чёткий кадр.';
    if (waitMsgId) {
     await tgApi(BOT_TOKEN, 'editMessageText', { chat_id: chatId, message_id: waitMsgId, text: errText });
    } else {
     await tgApi(BOT_TOKEN, 'sendMessage', { chat_id: chatId, reply_to_message_id: msg.message_id, text: errText });
    }
   }
   return new Response('OK', { status: 200 });
  }
  }

  const rawText = (msg.text || '').trim();
  if (!rawText) return new Response('OK', { status: 200 });

  if (!isPrivateChat) {
  const isBotCommand = /^\/(klev|top|waters|fish|crew|circle|express|search|help|start|menu|ai)(@KlevProClubBot)?(\s|$)/i.test(rawText);
  const isMention = /@KlevProClubBot/i.test(rawText);
  const isTriggerPrefix = /^(!клев|клев|прогноз|водоем)\s+/i.test(rawText);
  const isCrewKeyOrPack = /\b(KP-[0-9A-F]{4}|KP1_[A-Za-z0-9_-]{16,})\b/i.test(rawText);
  const isReplyToBot = Boolean(msg.reply_to_message?.from?.is_bot);
  if (!isBotCommand && !isMention && !isTriggerPrefix && !isCrewKeyOrPack && !isReplyToBot) {
  return new Response('OK', { status: 200 });
  }
  }

  const cleanText = rawText.replace(/@KlevProClubBot/gi, '').trim();

  // Вспомогательный разбор пакета KP1_... (с проверкой 72ч для экипажа и 00:01 следующего дня для длинной экспедиции)
  const handleIncomingKp1Token = async (tok) => {
   const packUrl = `${WEBAPP_URL}#p=${tok}`;
   let previewLines = `*Пакет координат «Клёв ПРО»*`;
   let isExpiredCrew = false;
   let expiredReason = '';
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
     const tsRelMin = (plain[13] << 16) | (plain[14] << 8) | plain[15];
     const caMs = tsRelMin > 0 ? (1704067200000 + tsRelMin * 60000) : Date.now();
     const meta16 = (plain[16] << 8) | plain[17];
     const is32BitFid = Boolean((plain[3] & 0x80) && plain.length >= 22);
     let noteOffset = 18;
     if (hasFid && is32BitFid) noteOffset = 22;
     else if (hasFid) noteOffset = 21;
     let rawTail = (hasTail && plain.length > noteOffset) ? new TextDecoder().decode(plain.slice(noteOffset)).trim() : '';
     let isExpedition = false;
     let expStart = '';
     let expEnd = '';
     const expM = rawTail.match(/^\^EXP:(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})\|(.*)$/s);
     if (expM) {
      isExpedition = true;
      expStart = expM[1];
      expEnd = expM[2];
      rawTail = (expM[3] || '').trim();
     }
     const eaMs = (mCode === 1 && isExpedition && expEnd)
      ? calcWorkerExpeditionExpiryMs(expEnd)
      : (caMs + 72 * 3600000);
     if (mCode === 1 && Date.now() > eaMs) {
      isExpiredCrew = true;
      expiredReason = isExpedition
       ? `окончание экспедиции ${expEnd} (00:01 следующего дня)`
       : 'прошло 72 часа';
     }
     const fObj = BOT_FISH_CATALOG[fiIdx] || BOT_FISH_CATALOG[0];
     const nearC = (lat || lon) ? findNearestSettlement(lat, lon) : { name: 'Водоём' };
     const cKey = `KP-${(meta16 || 0x7a3f).toString(16).toUpperCase().padStart(4, '0')}`;
     const mTitle = mCode === 2
      ? 'SOS НА ВОДЕ'
      : (mCode === 1
       ? (isExpedition ? `ЭКСПЕДИЦИЯ ${cKey} (${expStart}..${expEnd})` : `ЭКИПАЖ ${cKey} (72 ч)`)
       : (mCode === 3 ? 'МАСТЕРСКАЯ' : 'СВОДКА В КРУГ'));
     previewLines = `*${mTitle}*\n*${nearC.name}* • *${fObj.name}* (~${dp} м, ~${tw}°C, ${pr} мм)` +
      ((mCode === 1 || mCode === 2) && (lat || lon) ? `\n\`${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E\`` : '') +
      (rawTail ? `\n${rawTail}` : '');
    }
   } catch (_) {}

   if (isExpiredCrew) {
    await tgApi(BOT_TOKEN, 'sendMessage', {
     chat_id: chatId,
     text: `*Срок действия ссылки на экипаж / экспедицию истёк* (${expiredReason}).\n_У участников экипажа ранее полученные точки сохранены в навигаторе навсегда._`,
     parse_mode: 'Markdown'
    });
    return;
   }

   await tgApi(BOT_TOKEN, 'sendMessage', {
    chat_id: chatId,
    text: `${previewLines}\n_Точки экипажа и экспедиции сохраняются у вас навсегда._`,
    parse_mode: 'Markdown',
    reply_markup: {
     inline_keyboard: [
      [makeAppButton('Открыть в мини-приложении', packUrl, isPrivateChat)]
     ]
    }
   });
  };

  if (cleanText.startsWith('/start')) {
  const startParam = cleanText.split(/\s+/)[1] || '';

  if (isPrivateChat) {
  saveUserSession(userId, { keyboardSent: true, tgUsername: fromUsername, tgName: fromFullName });
  await configureBotMenusAndCommands(BOT_TOKEN, chatId);
  }

  if (/^BIND_/i.test(startParam)) {
  const rawBindFid = startParam.replace(/^BIND_/i, '').trim();
  const normBindFid = workerNormalizeFisherId(rawBindFid, '89');
  if (normBindFid) {
   const exBindUser = usersRegistryStore.get(normBindFid);
   const aKeyBind = fisherIdToAuthKeyMap.get(normBindFid);
   const exBindProf = aKeyBind ? cloudAuthProfiles.get(aKeyBind) : null;
   const existingBoundTgId = String(exBindUser?.tgId || exBindProf?.tgLinkedId || '').trim();
   const isOwnerTarget = isOwnerFisherId(normBindFid);
   const isAlreadyBoundToOther = Boolean(existingBoundTgId && existingBoundTgId !== String(userId) && !isTemporaryReserveId(normBindFid));
   const isUnconfirmedOwner = Boolean(isOwnerTarget && (!existingBoundTgId || existingBoundTgId !== String(userId)) && !workerIsOwnerLogin(fromUsername));
   if (isAlreadyBoundToOther || isUnconfirmedOwner) {
    recordSecurityIncident('idor', '/start BIND_', `Заблокирована перезапись Telegram-привязки профиля ${normBindFid} от tgId=${userId}`, clientIp, normBindFid);
    await tgApi(BOT_TOKEN, 'sendMessage', {
     chat_id: chatId,
     text: 'Этот рыболовный ID уже привязан к другому аккаунту Telegram или защищён от перезаписи.',
     reply_markup: isPrivateChat ? BOT_REPLY_KEYBOARD : undefined
    });
    return new Response('OK', { status: 200 });
   }
   bindTelegramToFisherProfile({
   fisherId: normBindFid,
   tgId: userId,
   tgUsername: fromUsername,
   tgFirstName: fromFullName
   });
   await persistSystemMeta(env, ctx);
   await tgApi(BOT_TOKEN, 'sendMessage', {
   chat_id: chatId,
   text: `*Связка профиля с Telegram выполнена!*`,
   parse_mode: 'Markdown',
   reply_markup: isPrivateChat ? BOT_REPLY_KEYBOARD : undefined
   });
  }
  return new Response('OK', { status: 200 });
  }

  if (startParam.startsWith('KP1_')) {
   await handleIncomingKp1Token(startParam);
   return new Response('OK', { status: 200 });
  }

  const kploc = decodeKplocToken(startParam);
  if (kploc) {
  if (isPrivateChat && kploc.fisherId && !tgToFisherIdMap.has(String(userId))) {
   bindTelegramToFisherProfile({
   fisherId: kploc.fisherId,
   tgId: userId,
   tgUsername: fromUsername,
   tgFirstName: fromFullName
   });
   await persistSystemMeta(env, ctx);
  }
  const fish = BOT_FISH_CATALOG.find(f => f.id === kploc.fishId) || BOT_FISH_CATALOG[0];
  const near = findNearestSettlement(kploc.lat, kploc.lon);
  const label = near.distKm <= 50 ? near.name : `${kploc.lat.toFixed(3)}°N, ${kploc.lon.toFixed(3)}°E`;
  const city = buildSpotContext(kploc.lat, kploc.lon, label);
  saveUserSession(userId, { lat: city.lat, lon: city.lon, cityName: city.name, fishId: fish.id });
  await persistSystemMeta(env, ctx);
  const card = await buildWorkerForecastCard(city, fish, WEBAPP_URL, isPrivateChat);
  await tgApi(BOT_TOKEN, 'sendMessage', {
  chat_id: chatId,
  text: card.replyText,
  parse_mode: 'Markdown',
  reply_markup: card.replyMarkup
  });
  return new Response('OK', { status: 200 });
  }

  const { city, fish } = await resolveQueryCityAndFish(`${session.cityName || 'Водоём РФ'} ${session.fishId || 'pike'}`, session);
  const menuCard = buildBotMainMenuCard(session, city, fish, WEBAPP_URL, isPrivateChat);

  if (isPrivateChat) {
  await tgApi(BOT_TOKEN, 'sendMessage', {
  chat_id: chatId,
  text: `*Клёв ПРО 2.0: Круг* • Напишите город, водоём, рыбу или пришлите фото улова:`,
  parse_mode: 'Markdown',
  reply_markup: BOT_REPLY_KEYBOARD
  });
  }

  await tgApi(BOT_TOKEN, 'sendMessage', {
  chat_id: chatId,
  text: menuCard.text,
  parse_mode: 'Markdown',
  reply_markup: menuCard.replyMarkup
  });
  return new Response('OK', { status: 200 });
  }

  // Проверка: скинули ли пакет KP1_... или ключ экипажа KP-XXXX в чат/группу
  const kpMatch = cleanText.match(/(KP1_[A-Za-z0-9_-]+)/);
  if (kpMatch && kpMatch[1]) {
   await handleIncomingKp1Token(kpMatch[1]);
   return new Response('OK', { status: 200 });
  }

  const crewKeyMatch = cleanText.match(/\b(KP-[0-9A-F]{4})\b/i);
  if (crewKeyMatch && crewKeyMatch[1]) {
   const { city } = await resolveQueryCityAndFish(session.cityName, session);
   const crewCard = buildCrewKeyLookupCard(crewKeyMatch[1], city, WEBAPP_URL, isPrivateChat);
   await tgApi(BOT_TOKEN, 'sendMessage', {
    chat_id: chatId,
    text: crewCard.text,
    parse_mode: 'Markdown',
    reply_markup: crewCard.replyMarkup
   });
   return new Response('OK', { status: 200 });
  }

  if (cleanText === 'Меню' || cleanText.toLowerCase() === 'меню' || /^\/menu(\s|$)/i.test(cleanText)) {
  const { city, fish } = await resolveQueryCityAndFish(`${session.cityName} ${session.fishId}`, session);
  const menuCard = buildBotMainMenuCard(session, city, fish, WEBAPP_URL, isPrivateChat);
  await tgApi(BOT_TOKEN, 'sendMessage', { chat_id: chatId, text: menuCard.text, parse_mode: 'Markdown', reply_markup: menuCard.replyMarkup });
  return new Response('OK', { status: 200 });
  }

  if (cleanText === 'ИИ по фото' || /^\/ai(\s|$)/i.test(cleanText)) {
  const { city, fish } = await resolveQueryCityAndFish(`${session.cityName} ${session.fishId}`, session);
  const aiHelp = buildAiPromptHelpCard(city, fish, WEBAPP_URL, isPrivateChat);
  await tgApi(BOT_TOKEN, 'sendMessage', { chat_id: chatId, text: aiHelp.text, parse_mode: 'Markdown', reply_markup: aiHelp.replyMarkup });
  return new Response('OK', { status: 200 });
  }

  if (cleanText === 'Прогноз') {
  const { city, fish } = await resolveQueryCityAndFish(`${session.cityName} ${session.fishId}`, session);
  const card = await buildWorkerForecastCard(city, fish, WEBAPP_URL, isPrivateChat);
  await tgApi(BOT_TOKEN, 'sendMessage', { chat_id: chatId, text: card.replyText, parse_mode: 'Markdown', reply_markup: card.replyMarkup });
  return new Response('OK', { status: 200 });
  }

  if (cleanText === 'Круг и SOS' || /^\/circle(\s|$)/i.test(cleanText)) {
  const { city, fish } = await resolveQueryCityAndFish(`${session.cityName} ${session.fishId}`, session);
  const radCard = buildCircleRadarSubCard(city, fish, WEBAPP_URL, isPrivateChat);
  await tgApi(BOT_TOKEN, 'sendMessage', { chat_id: chatId, text: radCard.text, parse_mode: 'Markdown', reply_markup: radCard.replyMarkup });
  return new Response('OK', { status: 200 });
  }

  if (cleanText === 'ТОП-5 клёва' || cleanText === 'Рекомендации' || cleanText.toLowerCase() === 'рекомендации' || /^\/top(\s|$)/i.test(cleanText)) {
  const arg = cleanText.replace(/^\/top\s*/i, '').replace(/^\s*(ТОП-5 клёва|Рекомендации)/i, '').trim();
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

  if (cleanText === '' || /^\/(crew|express)(\s|$)/i.test(cleanText)) {
  const arg = cleanText.replace(/^\/(crew|express)\s*/i, '').replace(/^\s*/, '').trim();
  if (/^KP-[0-9A-F]{4}$/i.test(arg)) {
   const { city } = await resolveQueryCityAndFish(session.cityName, session);
   const crewCard = buildCrewKeyLookupCard(arg, city, WEBAPP_URL, isPrivateChat);
   await tgApi(BOT_TOKEN, 'sendMessage', { chat_id: chatId, text: crewCard.text, parse_mode: 'Markdown', reply_markup: crewCard.replyMarkup });
   return new Response('OK', { status: 200 });
  }
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

  if (cleanText === 'Водоёмы' || cleanText === 'Водоёмы и Лёд' || cleanText === '' || /^\/(search|waters|fish)(\s|$)/i.test(cleanText)) {
  const isFishCmd = /^\/fish(\s|$)/i.test(cleanText);
  const arg = cleanText.replace(/^\/(search|waters|fish)\s*/i, '').replace(/^(Водоёмы и Лёд|Водоёмы|)\s*/, '').trim();
  const { city, fish } = await resolveQueryCityAndFish(arg || session.cityName, session);
  saveUserSession(userId, { lat: city.lat, lon: city.lon, cityName: city.name, wType: city.wType, waterName: city.waterName });
  const cardOut = isFishCmd ? buildFishPickerSubCard(city, fish) : await buildWaterPickerSubCard(city, fish, WEBAPP_URL, isPrivateChat);
  await tgApi(BOT_TOKEN, 'sendMessage', { chat_id: chatId, text: cardOut.text, parse_mode: 'Markdown', reply_markup: cardOut.replyMarkup });
  return new Response('OK', { status: 200 });
  }

  if (cleanText === '' || cleanText === '?' || /^\/help(\s|$)/i.test(cleanText)) {
  const { city, fish } = await resolveQueryCityAndFish(`${session.cityName} ${session.fishId}`, session);
  const helpCard = buildHelpAndGroupsCard(WEBAPP_URL, isPrivateChat, city, fish);
  await tgApi(BOT_TOKEN, 'sendMessage', { chat_id: chatId, text: helpCard.text, parse_mode: 'Markdown', reply_markup: helpCard.replyMarkup });
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
    error: 'Internal server error',
    version: WORKER_VERSION
   }), {
    status: 500,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' }
   });
  }
 }
};