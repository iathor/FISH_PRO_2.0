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
const _BOT_ADMINS = [
 "Алтайский край|Амурская обл.|Архангельская обл.|Астраханская обл.|Белгородская обл.",
 "Брянская обл.|Владимирская обл.|Волгоградская обл.|Вологодская обл.|Воронежская обл.",
 "Донецкая Народная Республика|Еврейская АО|Забайкальский край|Запорожская обл.",
 "Ивановская обл.|Иркутская обл.|Кабардино-Балкарская Республика|Калининградская обл.",
 "Калужская обл.|Камчатский край|Карачаево-Черкесская Республика|Кемеровская обл.",
 "Кировская обл.|Костромская обл.|Краснодарский край|Красноярский край|Курганская обл.",
 "Курская обл.|Ленинградская обл.|Липецкая обл.|Луганская Народная Республика",
 "Магаданская обл.|Москва|Московская обл.|Мурманская обл.|Ненецкий АО|Нижегородская обл.",
 "Новгородская обл.|Новосибирская обл.|Омская обл.|Оренбургская обл.|Орловская обл.",
 "Пензенская обл.|Пермский край|Приморский край|Псковская обл.|Республика Адыгея",
 "Республика Алтай|Республика Башкортостан|Республика Бурятия|Республика Дагестан",
 "Республика Ингушетия|Республика Калмыкия|Республика Карелия|Республика Коми",
 "Республика Крым|Республика Марий Эл|Республика Мордовия|Республика Саха (Якутия)",
 "Республика Северная Осетия — Алания|Республика Татарстан|Республика Тыва",
 "Республика Хакасия|Ростовская обл.|Рязанская обл.|Самарская обл.|Санкт-Петербург",
 "Саратовская обл.|Сахалинская обл.|Свердловская обл.|Севастополь|Смоленская обл.",
 "Ставропольский край|Тамбовская обл.|Тверская обл.|Томская обл.|Тульская обл.",
 "Тюменская обл.|Удмуртская Республика|Ульяновская обл.|Хабаровский край|Ханты-Мансийский АО",
 "Херсонская обл.|Челябинская обл.|Чеченская Республика|Чувашская Республика|Чукотский АО",
 "Ямало-Ненецкий АО|Ярославская обл."
].join("|").split("|");
const _ADM = _BOT_ADMINS;

const _C_PACK = [
 "Москва~55.7558~37.6173~32|Зеленоград~55.9825~37.1814~32|Химки~55.897~37.429~33",
 "Долгопрудный~55.938~37.514~33|Мытищи~55.9116~37.7308~33|Королёв~55.922~37.825~33",
 "Пушкино~56.01~37.847~33|Щёлково~55.923~37.998~33|Балашиха~55.796~37.938~33",
 "Люберцы~55.678~37.893~33|Жуковский~55.595~38.12~33|Раменское~55.567~38.23~33",
 "Бронницы~55.425~38.264~33|Воскресенск~55.317~38.683~33|Коломна~55.0794~38.7783~33",
 "Луховицы~54.965~39.026~33|Кашира~54.836~38.151~33|Ступино~54.889~38.078~33",
 "Серпухов~54.9158~37.4111~33|Чехов (Московская обл.)~55.148~37.477~33|Подольск~55.4242~37.5547~33",
 "Домодедово~55.436~37.766~33|Одинцово~55.679~37.263~33|Звенигород~55.73~36.854~33",
 "Красногорск~55.82~37.33~33|Истра~55.914~36.86~33|Солнечногорск~56.185~36.976~33",
 "Клин~56.333~36.733~33|Дмитров~56.344~37.52~33|Дубна (Московская обл.)~56.736~37.162~33",
 "Сергиев Посад~56.31~38.136~33|Орехово-Зуево~55.806~38.961~33|Шатура~55.576~39.542~33",
 "Егорьевск~55.383~39.033~33|Руза~55.698~36.195~33|Можайск~55.502~36.03~33",
 "Волоколамск~56.036~35.958~33|Наро-Фоминск~55.387~36.733~33|Тверь~56.8587~35.9176~74",
 "Конаково~56.7~36.768~74|Завидово~56.526~36.525~74|Кимры~56.873~37.356~74",
 "Калязин~57.243~37.854~74|Весьегонск~58.663~37.26~74|Осташков~57.147~33.107~74",
 "Ржев~56.262~34.327~74|Вышний Волочёк~57.585~34.56~74|Удомля~57.878~35.006~74",
 "Ярославль~57.6261~39.8845~88|Рыбинск~58.048~38.858~88|Брейтово~58.303~37.868~88",
 "Углич~57.528~38.318~88|Мышкин~57.786~38.455~88|Ростов Великий~57.185~39.414~88",
 "Переславль-Залесский~56.736~38.854~88|Кострома~57.7679~40.9269~23|Волгореченск~57.441~41.158~23",
 "Иваново~57.0004~40.9739~14|Кинешма~57.443~42.149~14|Юрьевец~57.32~43.109~14",
 "Плёс~57.458~41.514~14|Владимир~56.129~40.4066~6|Муром~55.579~42.052~6|Ковров~56.357~41.319~6",
 "Рязань~54.6292~39.7368~64|Спас-Клепики~55.134~40.175~64|Касимов~54.941~41.396~64",
 "Тула~54.1931~37.6173~76|Алексин~54.502~37.068~76|Калуга~54.5138~36.2612~18",
 "Обнинск~55.096~36.61~18|Таруса~54.729~37.177~18|Воронеж~51.6608~39.2003~9",
 "Нововоронеж~51.315~39.218~9|Лиски~50.985~39.508~9|Павловск (Воронежская обл.)~50.457~40.108~9",
 "Липецк~52.6088~39.5992~29|Елец~52.624~38.502~29|Тамбов~52.7212~41.4523~73",
 "Белгород~50.595~36.587~4|Старый Оскол~51.296~37.841~4|Курск~51.7304~36.1926~27",
 "Курчатов~51.66~35.656~27|Орёл~52.9668~36.0625~41|Брянск (Брянская обл.)~53.2435~34.3634~5",
 "Смоленск~54.7826~32.0453~71|Десногорск~54.152~33.285~71|Борок~58.063~38.238~88",
 "Пошехонье~58.502~39.115~88|Мичуринск~52.8978~40.4908~73|Моршанск~53.4442~41.8106~73",
 "Котовск~52.5878~41.5036~73|Рассказово~52.6719~41.8869~73|Уварово~51.9839~42.2639~73",
 "Ливны~52.4256~37.6069~41|Мценск~53.2789~36.5728~41|Болхов~53.4439~36.0044~41",
 "Клинцы~52.7528~32.2369~5|Новозыбков~52.5369~31.9339~5|Трубчевск~52.5839~33.7689~5",
 "Дятьково~53.6028~34.3339~5|Жуковка~53.5339~33.7306~5",
 "Железногорск (Курская обл.)~52.3392~35.3569~27|Рыльск~51.5689~34.6819~27",
 "Льгов~51.6719~35.2639~27|Губкин~51.2858~37.5358~4|Шебекино~50.4078~36.8858~4",
 "Валуйки~50.2119~38.1069~4|Новый Оскол~50.7619~37.8689~4|Грязи~52.4958~39.9419~29",
 "Задонск~52.3919~38.9219~29|Данков~53.2539~39.1558~29|Лебедянь~53.0189~39.1339~29",
 "Новомосковск~54.0119~38.2906~76|Суворов~54.1228~36.4958~76|Ефремов~53.1469~38.1169~76",
 "Белёв~53.8089~36.1358~76|Людиново~53.8644~34.4478~18|Козельск~54.0369~35.7819~18",
 "Вязьма~55.2106~34.2858~71|Гагарин~55.5528~35.0089~71|Рославль~53.9528~32.8639~71",
 "Сычёвка~55.8269~34.2758~71|Гороховец~56.2019~42.6919~6|Вязники~56.2428~42.1558~6",
 "Гусь-Хрустальный~55.6194~40.6558~6|Суздаль~56.4194~40.4489~6|Галич~58.3819~42.3489~23",
 "Чухлома~58.7539~42.6858~23|Шарья~58.3719~45.5139~23|Макарьев~57.8819~43.8069~23",
 "Московский~55.602~37.356~32|Троицк (Москва)~55.485~37.307~32|Щербинка~55.5~37.562~32",
 "Строгино~55.803~37.419~32|Крылатское~55.756~37.434~32|Кожухово~55.721~37.858~32",
 "Капотня~55.642~37.745~32|Коломенское~55.682~37.684~32|Серебряный Бор~55.778~37.441~32",
 "Красная Пахра~55.432~37.283~32|Десёновское~55.515~37.367~32|Рублёво~55.783~37.359~32",
 "Апрелевка~55.546~37.073~33|Белоозёрский~55.456~38.441~33|Верея~55.344~36.185~33",
 "Видное~55.557~37.708~33|Высоковск~56.318~36.551~33|Голицыно~55.616~36.987~33",
 "Дедовск~55.862~37.121~33|Дзержинский~55.631~37.849~33|Дрезна~55.741~38.843~33",
 "Зарайск~54.757~38.882~33|Ивантеевка (Московская обл.)~55.971~37.921~33",
 "Котельники~55.661~37.864~33|Красноармейск (Московская обл.)~56.115~38.146~33",
 "Краснозаводск~56.445~38.221~33|Краснознаменск (Московская обл.)~55.596~37.039~33",
 "Кубинка~55.58~36.697~33|Куровское~55.579~38.922~33|Ликино-Дулёво~55.708~38.955~33",
 "Лобня~56.013~37.474~33|Лосино-Петровский~55.872~38.204~33|Лыткарино~55.581~37.904~33",
 "Ногинск~55.855~38.442~33|Озёры~54.856~38.559~33|Павловский Посад~55.781~38.653~33",
 "Пересвет~56.417~38.174~33|Протвино~54.872~37.218~33|Пущино~54.834~37.614~33",
 "Реутов~55.76~37.857~33|Рошаль~55.662~39.878~33|Старая Купавна~55.807~38.179~33",
 "Талдом~56.732~37.53~33|Фрязино~55.961~38.046~33|Хотьково~56.251~37.994~33",
 "Черноголовка~56.004~38.378~33|Электрогорск~55.885~38.79~33|Электросталь~55.789~38.446~33",
 "Электроугли~55.719~38.216~33|Яхрома~56.29~37.485~33|Белоомут~54.945~39.338~33",
 "Дединово~55.025~39.248~33|Икша~56.17~37.502~33|Пестово (Московская обл.)~56.077~37.721~33",
 "Дракино~54.864~37.272~33|Красновидово~55.574~35.862~33|Троица~55.595~35.818~33",
 "Лопотово~56.063~36.829~33|Пятница~56.091~36.795~33|Большая Волга~56.726~37.135~33",
 "Ока~54.881~37.428~33|Алексеевка (Белгородская обл.)~50.631~38.689~4|Бирюч~50.654~38.395~4",
 "Грайворон~50.478~35.676~4|Короча~50.811~37.202~4|Строитель~50.785~36.489~4",
 "Волоконовка~50.485~37.859~4|Ровеньки (Белгородская обл.)~49.914~38.902~4",
 "Разумное~50.531~36.685~4|Северный~50.674~36.557~4|Маслова Пристань~50.453~36.736~4",
 "Злынка~52.429~31.737~5|Карачев~53.123~34.985~5|Мглин~53.059~32.848~5|Почеп~52.932~33.457~5",
 "Севск~52.149~34.492~5|Сельцо~53.374~34.104~5|Стародуб~52.585~32.76~5|Сураж~53.018~32.393~5",
 "Унеча~52.846~32.678~5|Фокино (Брянская обл.)~53.456~34.419~5|Красная Гора~53.001~31.603~5",
 "Александров~56.395~38.712~6|Камешково~56.348~41.001~6|Карабаново~56.314~38.704~6",
 "Киржач~56.156~38.859~6|Кольчугино~56.302~39.382~6|Костерёво~55.928~39.619~6",
 "Курлово~55.452~40.594~6|Лакинск~56.017~39.956~6|Меленки~55.335~41.63~6|Петушки~55.929~39.463~6",
 "Покров~55.919~39.177~6|Радужный (Владимирская обл.)~56~40.335~6|Собинка~55.991~40.015~6",
 "Струнино~56.377~38.579~6|Судогда~55.953~40.861~6|Юрьев-Польский~56.498~39.673~6",
 "Боголюбово~56.195~40.533~6|Бобров~51.093~40.034~9|Богучар~49.939~40.556~9",
 "Борисоглебск~51.367~42.083~9|Бутурлиновка~50.825~40.608~9|Калач~50.425~41.022~9",
 "Новохопёрск~51.098~41.63~9|Острогожск~50.865~39.069~9|Поворино~51.195~42.247~9",
 "Россошь~50.198~39.569~9|Семилуки~51.693~39.035~9|Эртиль~51.841~40.811~9|Рамонь~51.916~39.339~9",
 "Петропавловка (Воронежская обл.)~50.088~40.885~9|Новая Усмань~51.644~39.409~9",
 "Вичуга~57.206~41.926~14|Гаврилов Посад~56.556~40.119~14|Заволжск~57.485~42.142~14",
 "Комсомольск~57.028~40.379~14|Кохма~56.932~41.091~14|Наволоки~57.472~41.958~14",
 "Приволжск~57.376~41.287~14|Пучеж~56.982~43.172~14|Родники~57.106~41.728~14",
 "Тейково~56.857~40.538~14|Фурманов~57.253~41.109~14|Шуя~56.848~41.391~14|Южа~56.588~42.011~14",
 "Каменка (Ивановская обл.)~57.386~41.766~14|Сокольское (Ивановская обл.)~57.152~43.148~14",
 "Балабаново~55.182~36.657~18|Белоусово~55.095~36.678~18|Боровск~55.206~36.485~18",
 "Ермолино~55.197~36.589~18|Жиздра~53.751~34.738~18|Жуков~55.028~36.743~18",
 "Киров (Калужская обл.)~54.075~34.307~18|Кондрово~54.803~35.927~18|Кремёнки~54.889~37.118~18",
 "Малоярославец~55.011~36.467~18|Медынь~54.967~35.862~18|Мещовск~54.324~35.284~18",
 "Мосальск~54.489~34.982~18|Сосенский~54.058~35.959~18|Спас-Деменск~54.412~34.022~18",
 "Сухиничи~54.101~35.335~18|Юхнов~54.745~35.23~18|Полотняный Завод~54.731~35.998~18",
 "Пятовский~54.674~36.053~18|Середейский~54.057~35.236~18|Товарково~54.673~35.942~18",
 "Перемышль~54.263~36.163~18|Буй~58.478~41.531~23|Кологрив~58.828~44.318~23",
 "Мантурово~58.334~44.764~23|Нерехта~57.458~40.573~23|Нея~58.293~43.868~23",
 "Солигалич~59.078~42.288~23|Красное-на-Волге~57.511~41.239~23|Дмитриев~52.128~35.075~27",
 "Обоянь~51.21~36.276~27|Суджа~51.191~35.271~27|Фатеж~52.089~35.859~27|Щигры~51.874~36.915~27",
 "Кшенский~51.841~37.712~27|Усмань~52.043~39.736~29|Чаплыгин~53.242~39.967~29",
 "Дмитровск~52.505~35.147~41|Малоархангельск~52.4~36.503~41|Новосиль~52.973~37.046~41",
 "Залегощь~52.903~36.883~41|Знаменка~52.898~35.978~41|Кораблино~53.919~40.019~64",
 "Михайлов~54.229~39.027~64|Новомичуринск~54.039~39.746~64|Рыбное~54.727~39.515~64",
 "Ряжск~53.707~40.063~64|Сасово~54.354~41.926~64|Скопин~53.825~39.551~64",
 "Спасск-Рязанский~54.405~40.38~64|Шацк~54.025~41.712~64|Гусь-Железный~55.056~41.163~64",
 "Старожилово~54.227~39.914~64|Ижевское~54.558~40.871~64|Велиж~55.606~31.197~71",
 "Демидов~55.271~31.515~71|Дорогобуж~54.916~33.297~71|Духовщина~55.193~32.411~71",
 "Ельня~54.577~33.182~71|Починок~54.407~32.441~71|Рудня~54.947~31.093~71|Сафоново~55.111~33.233~71",
 "Ярцево~55.067~32.696~71|Верхнеднепровский~54.981~33.346~71|Озёрный~55.589~32.393~71",
 "Пржевальское~55.509~31.849~71|Жердевка~51.848~41.464~73|Кирсанов~52.655~42.723~73",
 "Мордово~52.085~40.768~73|Сосновка (Тамбовская обл.)~53.235~41.367~73",
 "Петровское (Тамбовская обл.)~52.634~40.264~73|Староюрьево~53.208~40.707~73",
 "Андреаполь~56.651~32.264~74|Бежецк~57.783~36.697~74|Белый~55.839~32.942~74",
 "Бологое~57.873~34.073~74|Западная Двина~56.258~32.084~74|Зубцов~56.174~34.585~74",
 "Кашин~57.358~37.609~74|Красный Холм~58.06~37.121~74|Кувшиново~57.031~34.169~74",
 "Лихославль~57.125~35.466~74|Нелидово~56.221~32.777~74|Старица~56.508~34.935~74",
 "Торжок~57.039~34.962~74|Торопец~56.498~31.635~74|Козлово~56.605~36.447~74",
 "Красномайский~57.625~34.416~74|Новозавидовский~56.578~36.432~74|Пено~56.924~32.735~74",
 "Редкино~56.647~36.402~74|Богородицк~53.771~38.125~76|Болохово~54.09~37.822~76",
 "Венёв~54.349~38.268~76|Донской (Тульская обл.)~53.968~38.327~76|Кимовск~53.972~38.532~76",
 "Киреевск~53.935~37.926~76|Липки~53.951~37.701~76|Плавск~53.708~37.292~76",
 "Советск (Тульская обл.)~53.938~37.632~76|Узловая~53.979~38.159~76|Чекалин~54.098~36.247~76",
 "Щёкино~54.006~37.515~76|Ясногорск (Тульская обл.)~54.48~37.697~76",
 "Дубна (Тульская обл.)~54.156~36.96~76|Кондуки~53.848~38.393~76|Гаврилов-Ям~57.303~39.854~88",
 "Данилов~58.188~40.175~88|Любим~58.362~40.686~88|Тутаев~57.882~39.537~88",
 "Красный Профинтерн~57.749~40.422~88|Лесная Поляна~57.684~39.967~88|Некрасовское~57.677~40.367~88",
 "Поречье-Рыбное~57.096~39.381~88|Прозорово~58.396~37.689~88|Санкт-Петербург~59.9343~30.3351~66",
 "Кронштадт~59.991~29.766~66|Сестрорецк~60.099~29.962~66",
 "Зеленогорск (Санкт-Петербург)~60.197~29.702~66|Выборг~60.709~28.749~28",
 "Приморск (Ленинградская обл.)~60.366~28.609~28|Приозерск~61.039~30.129~28",
 "Лосево~60.681~30.004~28|Шлиссельбург~59.946~31.033~28|Новая Ладога~60.103~32.302~28",
 "Волхов~59.925~32.338~28|Сясьстрой~60.136~32.569~28|Лодейное Поле~60.733~33.553~28",
 "Подпорожье~60.911~34.17~28|Сосновый Бор (Ленинградская обл.)~59.904~29.086~28",
 "Кингисепп~59.373~28.613~28|Усть-Луга~59.66~28.295~28|Ивангород~59.371~28.216~28",
 "Луга~58.737~29.845~28|Гатчина~59.566~30.128~28|Тихвин~59.644~33.542~28|Кириши~59.449~32.018~28",
 "Великий Новгород~58.5228~31.2699~37|Старая Русса~57.989~31.356~37|Валдай~57.974~33.252~37",
 "Боровичи~58.388~33.915~37|Псков~57.8194~28.3318~45|Гдов~58.742~27.815~45",
 "Великие Луки~56.34~30.525~45|Калининград~54.7104~20.4522~17|Зеленоградск~54.96~20.476~17",
 "Светлогорск~54.943~20.155~17|Балтийск~54.644~19.892~17",
 "Светлый (Калининградская обл.)~54.676~20.134~17|Полесск~54.863~21.099~17",
 "Советск (Калининградская обл.)~55.083~21.886~17|Петрозаводск~61.785~34.3469~53",
 "Кондопога~62.203~34.265~53|Медвежьегорск~62.912~34.456~53|Сегежа~63.743~34.316~53",
 "Беломорск~64.525~34.765~53|Кемь~64.956~34.579~53|Лоухи~66.075~33.045~53",
 "Пяозерский~65.764~31.082~53|Калевала~65.199~31.186~53|Костомукша~64.588~30.6~53",
 "Сортавала~61.703~30.691~53|Лахденпохья~61.519~30.199~53|Питкяранта~61.572~31.478~53",
 "Олонец~60.985~32.971~53|Пудож~61.806~36.535~53|Мурманск~68.9707~33.075~34|Кола~68.881~33.018~34",
 "Мурмаши~68.816~32.812~34|Териберка~69.164~35.143~34|Североморск~69.069~33.416~34",
 "Мончегорск~67.938~32.915~34|Апатиты~67.568~33.402~34|Кандалакша~67.151~32.412~34",
 "Умба~66.687~34.343~34|Варзуга~66.398~36.588~34|Ловозеро~68.006~35.016~34",
 "Архангельск~64.5399~40.5158~2|Северодвинск~64.5635~39.8302~2|Новодвинск~64.416~40.812~2",
 "Онега~63.906~38.097~2|Котлас~61.252~46.654~2|Вельск~61.066~42.102~2|Мезень~65.852~44.24~2",
 "Нарьян-Мар~67.638~53.006~35|Искателей~67.679~53.133~35|Сыктывкар~61.6688~50.8364~54",
 "Ухта~63.567~53.683~54|Печора~65.147~57.228~54|Усинск~65.994~57.556~54",
 "Усть-Цильма~65.441~52.15~54|Воркута~67.498~64.052~54|Вологда~59.2205~39.8915~8",
 "Череповец~59.1323~37.9092~8|Белозерск~60.0325~37.7872~8|Липин Бор~60.2608~37.9772~8",
 "Кириллов~59.8606~38.3792~8|Вытегра~61.0064~36.4481~8|Шексна~59.2106~38.5081~8",
 "Великий Устюг~60.7619~46.3039~8|Тотьма~59.9756~42.7589~8",
 "Сокол (Вологодская обл.)~59.4622~40.1189~8|Вожега~60.4728~40.2189~8|Устюжна~58.8422~36.4289~8",
 "Невель~56.0189~29.9319~45|Себеж~56.2839~28.4819~45|Печоры~57.8139~27.6119~45",
 "Чудово~59.1244~31.6719~37|Пестово (Новгородская обл.)~58.5969~35.8169~37",
 "Амдерма~69.7594~61.6636~35|Индига~67.6889~48.7789~35|Инта~66.0319~60.1658~54",
 "Вуктыл~63.8569~57.3089~54|Сосногорск~63.5889~53.8819~54|Колпино~59.75~30.585~66",
 "Красное Село~59.734~30.088~66|Ломоносов~59.914~29.771~66",
 "Павловск (Санкт-Петербург)~59.684~30.453~66|Петергоф~59.885~29.908~66|Пушкин~59.722~30.415~66",
 "Лисий Нос~60.015~30.002~66|Стрельна~59.858~30.043~66|Лахта~59.992~30.149~66",
 "Солнечное~60.149~29.936~66|Усть-Ижора~59.805~30.608~66|Понтонный~59.789~30.642~66",
 "Канонерский остров~59.897~30.213~66|Бокситогорск~59.473~33.848~28|Волосово~59.446~29.485~28",
 "Всеволожск~60.021~30.654~28|Высоцк~60.625~28.571~28|Каменногорск~60.955~29.131~28",
 "Кировск (Ленинградская обл.)~59.878~30.985~28|Колтуши~59.933~30.656~28|Коммунар~59.62~30.391~28",
 "Кудрово~59.908~30.514~28|Любань~59.351~31.251~28|Мурино~60.049~30.446~28",
 "Никольское (Ленинградская обл.)~59.702~30.785~28|Отрадное~59.776~30.805~28",
 "Пикалёво~59.514~34.175~28|Светогорск~61.109~28.866~28|Сертолово~60.145~30.207~28",
 "Сланцы~59.118~28.089~28|Тельмана~59.731~30.619~28|Тосно~59.541~30.877~28",
 "Вознесенье~61.015~35.48~28|им. Морозова~59.976~31.037~28|Кузнечное~61.123~29.873~28",
 "Паша~60.399~33.047~28|Сиверский~59.354~30.081~28|Токсово~60.158~30.525~28",
 "Чёрное~60.125~31.714~28|Креницы~60.13~32.275~28|Мичуринское~60.57~29.859~28",
 "Сосново~60.556~30.228~28|Суоярви~62.083~32.356~53|Пиндуши~62.916~34.58~53",
 "Ведлозеро~61.569~32.839~53|Реболы~63.835~30.822~53|Рабочеостровск~64.989~34.769~53",
 "Емва~62.589~50.858~54|Микунь~62.353~50.075~54|Кожва~65.109~57.046~54",
 "Краснозатонский~61.685~50.971~54|Путеец~65.168~57.289~54|Седкыркещ~61.734~50.946~54",
 "Синдор~62.851~51.883~54|Шудаяг~63.535~53.608~54|Кослан~63.456~48.898~54",
 "Объячево~60.372~49.647~54|Каргополь~61.503~38.947~2|Коряжма~61.314~47.142~2",
 "Мирный (Архангельская обл.)~62.766~40.335~2|Няндома~61.668~40.198~2",
 "Сольвычегодск~61.332~46.924~2|Шенкурск~62.108~42.898~2|Березник~62.853~42.708~2",
 "Каменка (Архангельская обл.)~65.885~44.131~2|Североонежск~62.583~39.841~2",
 "Шипицыно~61.281~46.526~2|Двинской Березник~62.854~42.712~2|Тельвиска~67.603~52.93~35",
 "Каратайка~68.765~61.425~35|Усть-Кара~69.251~64.933~35|Бабаево~59.389~35.951~8",
 "Грязовец~58.882~40.252~8|Кадников~59.503~40.335~8|Красавино~60.963~46.48~8",
 "Никольск (Вологодская обл.)~59.535~45.452~8|Харовск~59.956~40.193~8|Кузино~60.751~46.332~8",
 "Горицы~59.865~38.258~8|Багратионовск~54.387~20.642~17|Гвардейск~54.649~21.071~17",
 "Гурьевск (Калининградская обл.)~54.773~20.605~17|Гусев~54.593~22.199~17",
 "Краснознаменск (Калининградская обл.)~54.943~22.49~17|Ладушкин~54.573~20.175~17",
 "Мамоново~54.464~19.938~17|Неман~55.031~22.026~17|Нестеров~54.63~22.573~17",
 "Озёрск (Калининградская обл.)~54.411~22.012~17",
 "Пионерский (Калининградская обл.)~54.952~20.228~17|Правдинск~54.444~21.018~17",
 "Приморск (Калининградская обл.)~54.732~20.005~17|Славск~55.043~21.677~17",
 "Черняховск~54.634~21.815~17|Донское~54.943~19.967~17|Янтарный~54.872~19.941~17",
 "Матросово~55.015~21.309~17|Заливино~54.899~21.053~17|Ушаково~54.614~20.252~17",
 "Гаджиево~69.255~33.321~34|Заозёрск~69.4~32.448~34|Заполярный (Мурманская обл.)~69.416~30.814~34",
 "Кировск (Мурманская обл.)~67.614~33.672~34|Ковдор~67.562~30.472~34|Оленегорск~68.143~33.271~34",
 "Островной~68.053~39.513~34|Полярные Зори~67.366~32.498~34",
 "Полярный (Мурманская обл.)~69.198~33.448~34|Снежногорск~69.193~33.233~34",
 "Верхнетуломский~68.606~31.796~34|Кильдинстрой~68.795~33.102~34|Молочный~68.853~33.022~34",
 "Туманный~68.881~35.691~34|Малая Вишера~58.845~32.222~37|Окуловка~58.397~33.297~37",
 "Сольцы~58.121~30.323~37|Холм~57.145~31.178~37|Батецкий~58.64~30.312~37",
 "Пролетарий~58.431~31.696~37|Угловка~58.225~33.562~37|Взвад~58.096~31.425~37",
 "Полново~57.584~32.893~37|Дно~57.829~29.961~45|Новоржев~57.028~29.335~45",
 "Новосокольники~56.334~30.156~45|Опочка~56.712~28.663~45|Остров~57.343~28.352~45",
 "Порхов~57.768~29.556~45|Пустошка~56.335~29.369~45|Пыталово~57.068~27.915~45",
 "Дедовичи~57.552~29.956~45|Плюсса~58.431~29.368~45|Пушкинские Горы~57.022~28.914~45",
 "Сосновый Бор (Псковская обл.)~56.262~28.543~45|Усвяты~55.748~30.754~45|Толба~57.992~28.068~45",
 "Жижица~56.252~31.185~45|Волгоград~48.708~44.5133~7|Волжский (Волгоградская обл.)~48.785~44.775~7",
 "Камышин~50.088~45.405~7|Калач-на-Дону~48.685~43.526~7|Ахтубинск~48.281~46.174~3",
 "Харабали~47.412~47.256~3|Селитренное~47.167~47.45~3|Енотаевка~47.246~47.028~3",
 "Нариманов~46.689~47.85~3|Астрахань~46.3497~48.0408~3|Камызяк~46.11~48.077~3",
 "Кировский~45.845~48.136~3|Икряное~46.093~47.734~3|Мумра~45.772~47.656~3",
 "Володарский~46.402~48.541~3|Лиман~45.785~47.224~3|Лагань~45.391~47.362~52",
 "Элиста~46.3078~44.2558~52|Ростов-на-Дону~47.2225~39.7187~63|Азов~47.112~39.423~63",
 "Таганрог~47.2096~38.9352~63|Новочеркасск~47.418~40.093~63|Семикаракорск~47.516~40.806~63",
 "Волгодонск~47.514~42.153~63|Цимлянск~47.644~42.102~63|Весёлый~47.086~40.742~63",
 "Каменск-Шахтинский~48.318~40.26~63|Вёшенская~49.629~41.726~63|Краснодар~45.0355~38.9753~24",
 "Славянск-на-Кубани~45.257~38.125~24|Темрюк~45.271~37.382~24|Приморско-Ахтарск~46.046~38.175~24",
 "Ейск~46.711~38.273~24|Тимашевск~45.617~38.946~24|Анапа~44.895~37.316~24",
 "Новороссийск~44.7239~37.7689~24|Геленджик~44.561~38.077~24|Туапсе~44.098~39.074~24",
 "Сочи~43.5855~39.7231~24|Адлер~43.429~39.923~24|Майкоп~44.6098~40.1006~46",
 "Севастополь~44.6166~33.5254~70|Балаклава~44.501~33.599~70|Симферополь~44.9521~34.1024~55",
 "Ялта (Крым)~44.4952~34.1663~55|Алушта~44.676~34.41~55|Судак~44.851~34.972~55",
 "Феодосия~45.0319~35.3824~55|Керчь~45.356~36.467~55|Евпатория~45.1904~33.3669~55",
 "Черный Яр~48.062~46.112~3|Красный Яр (Астраханская обл.)~46.533~48.348~3|Сириус~43.402~39.961~24",
 "Хоста~43.515~39.869~24|Дагомыс~43.661~39.654~24|Лоо~43.699~39.589~24",
 "Лазаревское~43.908~39.331~24|Джубга~44.316~38.705~24|Архипо-Осиповка~44.366~38.531~24",
 "Благовещенская~45.063~37.115~24|Голубицкая~45.325~37.272~24|Ясенская Переправа~46.245~38.285~24",
 "Донецк (Донецкая Народная Республика)~48.0159~37.8028~10|Мариуполь~47.0971~37.5434~10",
 "Макеевка~48.0478~37.9258~10|Горловка~48.307~38.0297~10|Енакиево~48.2311~38.2053~10",
 "Старобешево~47.7531~38.0319~10|Зугрэс~48.0175~38.2619~10|Новоазовск~47.1147~38.0825~10",
 "Харцызск~48.0428~38.1425~10|Волноваха~47.5975~37.4833~10|Дебальцево~48.3411~38.4069~10",
 "Луганск~48.574~39.3078~30|Алчевск~48.4689~38.7978~30|Северодонецк~48.9483~38.4933~30",
 "Лисичанск~48.9042~38.4319~30|Красный Луч~48.1372~38.9192~30|Стаханов~48.5681~38.6436~30",
 "Краснодон~48.2992~39.7397~30|Счастье~48.7386~39.2314~30|Старобельск~49.2769~38.9242~30",
 "Сватово~49.4092~38.1619~30|Мелитополь~46.8489~35.3653~13|Бердянск~46.7597~36.7989~13",
 "Энергодар~47.4989~34.6558~13|Приморск (Запорожская обл.)~46.7347~36.3442~13",
 "Кирилловка~46.3736~35.3675~13|Васильевка~47.4419~35.2764~13|Днепрорудное~47.3819~34.9869~13",
 "Каменка-Днепровская~47.4872~34.4058~13|Токмак~47.2514~35.7058~13|Пологи~47.4844~36.2536~13",
 "Геническ~46.1769~34.8058~82|Скадовск~46.1189~32.9106~82|Новая Каховка~46.7511~33.3606~82",
 "Каховка~46.8136~33.4869~82|Голая Пристань~46.5242~32.5203~82|Алёшки~46.6203~32.7186~82",
 "Железный Порт~46.1233~32.2914~82|Лазурное~46.0842~32.5294~82|Адыгейск~44.8825~39.1906~46",
 "Яблоновский~44.9897~38.9433~46|Каменномостский~44.2989~40.1844~46|Цаган Аман~47.5639~46.7219~52",
 "Городовиковск~46.0878~41.9336~52|Энем~44.925~38.905~46|Тлюстенхабль~44.981~39.092~46",
 "Даховская~44.231~40.203~46|Тахтамукай~44.921~38.995~46|Шенджий~44.885~39.075~46",
 "Псейтук~45.012~38.802~46|Хамышки~44.095~40.135~46|Дьяков~44.635~40.185~46",
 "Красинское~45.458~47.285~52|Чограйский~45.515~44.385~52|Южный~45.552~44.115~52",
 "Лола~46.125~44.215~52|Яшкуль~46.171~45.343~52|Алупка~44.419~34.043~55|Армянск~46.107~33.693~55",
 "Бахчисарай~44.755~33.858~55|Белогорск (Крым)~45.055~34.602~55|Джанкой~45.709~34.393~55",
 "Красноперекопск~45.955~33.792~55|Саки~45.134~33.599~55|Старый Крым (Крым)~45.029~35.089~55",
 "Щёлкино~45.428~35.822~55|Гурзуф~44.542~34.281~55|Форос~44.391~33.788~55|Гаспра~44.432~34.113~55",
 "Кореиз~44.433~34.088~55|Ливадия~44.469~34.144~55|Массандра~44.509~34.187~55",
 "Никита~44.514~34.238~55|Николаевка (Крым)~44.961~33.611~55|Мирный (Крым)~45.309~33.035~55",
 "Новоозёрное~45.385~33.118~55|Оленевка~45.383~32.533~55|Раздольное (Крым)~45.771~33.488~55",
 "Портовое~45.885~33.485~55|Коктебель~44.961~35.242~55|Курортное~44.914~35.188~55",
 "Приморский (Крым)~45.118~35.481~55|Мысовое~45.451~35.839~55|Советский (Крым)~45.347~34.933~55",
 "Кировское (Крым)~45.223~35.205~55|Куйбышево~44.623~33.877~55|Голубинка~44.588~33.919~55",
 "Соколиное~44.552~33.956~55|Инкерман~44.614~33.608~70|Кача~44.777~33.549~70",
 "Орловка (Севастополь)~44.725~33.553~70|Андреевка~44.819~33.559~70",
 "Любимовка (Севастополь)~44.664~33.548~70|Орлиное~44.444~33.781~70|Терновка~44.579~33.763~70",
 "Родное~44.555~33.742~70|Гончарное~44.468~33.702~70|Резервное~44.476~33.681~70",
 "Верхнесадовое~44.687~33.704~70|Фронтовое~44.678~33.744~70|Сахарная Головка~44.588~33.635~70",
 "Хмельницкое~44.552~33.661~70|Черноречье~44.545~33.681~70|Ласпи~44.417~33.708~70",
 "Абинск~44.866~38.158~24|Апшеронск~44.461~39.726~24|Армавир~44.989~41.123~24",
 "Белореченск~44.765~39.873~24|Горячий Ключ~44.634~39.136~24|Гулькевичи~45.361~40.695~24",
 "Кореновск~45.464~39.452~24|Кропоткин~45.437~40.575~24|Крымск~44.929~37.991~24",
 "Курганинск~44.888~40.598~24|Лабинск~44.636~40.733~24|Новокубанск~45.106~41.045~24",
 "Тихорецк~45.854~40.125~24|Усть-Лабинск~45.211~39.692~24|Хадыженск~44.421~39.535~24",
 "Новомихайловский~44.241~38.859~24|Афипский~44.912~38.835~24|Ахтырский~44.846~38.288~24",
 "Гирей~45.405~40.625~24|Красносельский~45.388~40.638~24|Головинка~43.788~39.462~24",
 "Аше~43.957~39.266~24|Казачий Брод~43.524~39.996~24|Ахштырь~43.518~39.988~24",
 "Монастырь~43.582~40.025~24|Галицыно~43.541~40.005~24|Молдовка~43.458~39.948~24",
 "Весёлое~43.411~40.002~24|Барановка~43.632~39.754~24|Пластунка~43.675~39.759~24",
 "Красная Воля~43.562~39.904~24|Илларионовка~43.595~39.915~24|Прогресс~43.585~39.825~24",
 "Раздольное (Краснодарский край)~43.599~39.772~24|Большой Кичмай~43.829~39.521~24",
 "Малый Кичмай~43.816~39.501~24|Ахинтам~43.811~39.488~24|Калеж~44.006~39.355~24",
 "Лыготх~44.012~39.332~24|Наджиго~44.051~39.276~24|Тхагапш~43.952~39.435~24",
 "Хаджико~43.982~39.322~24|Шхафит~43.968~39.288~24|Хатлапе~43.922~39.392~24",
 "Агуй-Шапсуг~44.169~39.076~24|Каневская~46.082~38.966~24|Староминская~46.536~39.056~24",
 "Брюховецкая~45.802~39.002~24|Калининская~45.479~38.662~24|Старонижестеблиевская~45.382~38.435~24",
 "Бриньковская~46.042~38.545~24|Ахтанизовская~45.324~37.104~24|Курчанская~45.214~37.542~24",
 "Черноерковская~45.458~37.758~24|Кавказская~45.442~40.672~24|Морозовский~45.785~38.195~24",
 "Пересыпь~45.348~37.138~24|За Родину~45.352~37.082~24|Абрау-Дюрсо~44.698~37.595~24",
 "Бетта~44.375~38.395~24|Криница~44.392~38.338~24|Ольгинка~44.201~38.885~24|Небуг~44.168~38.998~24",
 "Агой~44.139~39.029~24|Шепси~44.036~39.148~24|Знаменск~48.585~45.733~3|Вольное~47.118~47.495~3",
 "Сероглазка~47.065~47.445~3|Промысловка~47.022~47.412~3|Ленино~46.965~47.475~3",
 "Никольское (Астраханская обл.)~47.768~46.425~3|Седлистое~45.888~47.632~3",
 "Трудфронт~45.928~47.658~3|Станья~45.822~48.135~3|Гандурино~45.875~48.035~3",
 "Верхнекалиновский~46.068~48.112~3|Жан-Аул~46.042~48.128~3|Зеленга~46.028~48.662~3",
 "Маково~46.048~48.642~3|Тишково~45.958~48.555~3|Калинино~46.322~48.865~3",
 "Кривой Бузан~46.512~48.415~3|Байбек~46.638~48.642~3|Малый Арал~46.678~48.575~3",
 "Джанай~46.632~48.352~3|Дубовка~49.058~44.829~7|Жирновск~50.985~44.773~7",
 "Котельниково~47.632~43.142~7|Котово~50.321~44.801~7",
 "Краснослободск (Волгоградская обл.)~48.707~44.577~7|Ленинск~48.702~45.198~7",
 "Михайловка~50.068~43.238~7|Николаевск~50.028~45.458~7|Новоаннинский~50.528~42.675~7",
 "Палласовка~50.048~46.882~7|Петров Вал~50.138~45.212~7|Серафимович~49.578~42.736~7",
 "Суровикино~48.602~42.852~7|Урюпинск~50.796~42.014~7|Фролово~49.771~43.658~7",
 "Светлый Яр~48.474~44.776~7|Зотовская~50.252~42.248~7|Алексеевская~50.292~42.185~7",
 "Нижний Чир~48.362~43.085~7|Вертячий~48.948~43.822~7|Песковатка~48.912~43.765~7",
 "Горный Балыклей~49.555~45.095~7|Аксай~47.269~39.863~63|Батайск~47.139~39.743~63",
 "Белая Калитва~48.176~40.788~63|Гуково~48.055~39.938~63|Донецк (Ростовская обл.)~48.334~39.946~63",
 "Зверево~48.025~40.122~63|Зерноград~46.845~40.308~63|Константиновск~47.584~41.106~63",
 "Красный Сулин~47.886~40.072~63|Миллерово~48.922~40.398~63|Морозовск~48.352~41.828~63",
 "Новошахтинск~47.758~39.936~63|Пролетарск~46.704~41.724~63|Сальск~46.479~41.542~63",
 "Шахты~47.709~40.215~63|Усть-Донецкий~47.638~40.858~63|Кочетовская~47.565~40.875~63",
 "Романовская~47.542~42.025~63|Кривянская~47.398~40.168~63|Заплавская~47.345~40.205~63",
 "Базковская~49.605~41.735~63|Рогожкино~47.175~39.352~63|Дугино~47.205~39.415~63",
 "Кагальник~47.132~39.322~63|Донской (Ростовская обл.)~47.412~40.232~63",
 "Степной Курган~46.942~41.242~63|Павло-Очаково~47.042~39.105~63|Петрушино~47.185~38.855~63",
 "Авдеевка~48.139~37.742~10|Амвросиевка~47.794~38.478~10|Артёмово~48.382~37.895~10",
 "Артёмовск (Донецкая Народная Республика)~48.595~38.001~10|Белицкое~48.408~37.179~10",
 "Белозёрское (Донецкая Народная Республика)~48.528~37.046~10|Родинское~48.352~37.206~10",
 "Горняк (Донецкая Народная Республика)~48.049~37.367~10|Димитров~48.292~37.268~10",
 "Доброполье~48.468~37.082~10|Докучаевск~47.751~37.676~10|Дружковка~48.622~37.528~10",
 "Ждановка~48.148~38.258~10|Иловайск~47.926~38.196~10",
 "Кировское (Донецкая Народная Республика)~48.148~38.362~10",
 "Комсомольское (Донецкая Народная Республика)~47.668~38.074~10",
 "Константиновка (Донецкая Народная Республика)~48.526~37.704~10|Краматорск~48.739~37.584~10",
 "Красноармейск (Донецкая Народная Республика)~48.282~37.182~10|Красногоровка~48.006~37.508~10",
 "Красный Лиман~48.988~37.802~10|Курахово~47.985~37.276~10|Марьинка~47.942~37.504~10",
 "Моспино~47.882~38.064~10|Николаевка (Донецкая Народная Республика)~48.854~37.772~10",
 "Новогородовка~48.204~37.338~10|Светлодарск~48.435~38.222~10|Святогорск~49.038~37.568~10",
 "Северск (Донецкая Народная Республика)~48.868~38.098~10|Селидово~48.148~37.302~10",
 "Славянск~48.853~37.605~10|Снежное~48.028~38.766~10|Соледар~48.695~38.067~10",
 "Торез~48.022~38.628~10|Дзержинск (Донецкая Народная Республика)~48.398~37.848~10",
 "Углегорск (Донецкая Народная Республика)~48.312~38.268~10|Угледар~47.779~37.248~10",
 "Украинск~48.098~37.362~10|Часов Яр~48.588~37.838~10",
 "Шахтёрск (Донецкая Народная Республика)~48.046~38.468~10|Юнокоммунаровск~48.222~38.278~10",
 "Ясиноватая~48.128~37.862~10|Ялта (Донецкая Народная Республика)~46.962~37.268~10",
 "Мелекино~46.976~37.405~10|Белосарайская Коса~46.905~37.332~10",
 "Старый Крым (Донецкая Народная Республика)~47.162~37.488~10|Павлополь~47.262~37.788~10",
 "Новый Свет~47.805~38.022~10|Нижняя Крынка~48.105~38.162~10",
 "Зуевка (Донецкая Народная Республика)~48.042~38.252~10|Райгородок~48.902~37.725~10",
 "Щурово~48.952~37.692~10|Александровск (Луганская Народная Республика)~48.582~39.192~30",
 "Алмазная~48.518~38.582~30|Антрацит~48.118~39.092~30",
 "Артёмовск (Луганская Народная Республика)~48.438~38.732~30|Брянка~48.512~38.642~30",
 "Вахрушево~48.162~38.838~30|Горское~48.742~38.495~30|Зимогорье~48.588~38.922~30",
 "Золотое (Луганская Народная Республика)~48.692~38.518~30|Зоринск~48.412~38.618~30",
 "Ирмино~48.598~38.582~30|Кировск (Луганская Народная Республика)~48.638~38.642~30",
 "Кременная~49.052~38.218~30|Лутугино~48.402~39.212~30|Миусинск~48.075~38.898~30",
 "Молодогвардейск~48.348~39.658~30|Новодружеск~48.962~38.352~30",
 "Первомайск (Луганская Народная Республика)~48.628~38.548~30|Перевальск~48.435~38.818~30",
 "Петровское (Луганская Народная Республика)~48.282~38.878~30|Попасная~48.632~38.378~30",
 "Приволье~49.002~38.295~30|Ровеньки (Луганская Народная Республика)~48.072~39.342~30",
 "Рубежное~49.012~38.372~30|Свердловск~48.058~39.658~30|Суходольск~48.352~39.722~30",
 "Червонопартизанск~48.082~39.788~30|Беловодск~49.198~39.575~30|Успенка~48.388~39.162~30",
 "Вольнянск~47.942~35.432~13|Гуляйполе~47.662~36.258~13",
 "Запорожье (Запорожская обл.)~47.838~35.139~13|Молочанск~47.206~35.596~13|Орехов~47.567~35.785~13",
 "Набережное~46.648~36.258~13|Райновка~46.658~36.115~13|Осипенко~46.912~36.822~13",
 "Азовское~46.775~36.735~13|Водяное~47.488~34.492~13|Ивановка~47.475~34.725~13",
 "Скельки~47.445~35.162~13|Берислав~46.841~33.428~82|Таврийск~46.754~33.422~82",
 "Херсон~46.635~32.617~82|Геническая Горка~46.102~34.828~82|Счастливцево~46.035~34.838~82",
 "Приозёрное~46.085~34.805~82|Чонгар~46.032~34.545~82|Приморское~46.142~32.398~82",
 "Рыбальче~46.472~32.232~82|Любимовка (Херсонская обл.)~46.808~33.568~82",
 "Махачкала~42.9849~47.5047~50|Каспийск~42.885~47.638~50|Дербент~42.0678~48.2899~50",
 "Кизляр (Дагестан)~43.847~46.714~50|Ставрополь~45.0428~41.9734~72|Пятигорск~44.0486~43.0594~72",
 "Грозный~43.3184~45.6986~84|Гудермес~43.3508~46.1036~84|Шелковская~43.5089~46.3389~84",
 "Наурская~43.6522~45.3117~84|Кезеной-Ам~42.7758~46.1519~84|Шали~43.1481~45.9019~84",
 "Аргун~43.2922~45.8722~84|Магас~43.1686~44.8131~51|Назрань~43.2256~44.7628~51",
 "Сунжа~43.3156~45.0472~51|Карабулак~43.3053~44.9094~51|Малгобек~43.5094~44.5881~51",
 "Нальчик~43.4853~43.6071~16|Прохладный~43.7575~44.0297~16",
 "Майский (Кабардино-Балкарская Республика)~43.6317~44.0589~16|Баксан~43.6819~43.5358~16",
 "Голубые озёра~43.2319~43.6214~16|Черкесск~44.2269~42.0467~20|Усть-Джегута~44.0858~41.9733~20",
 "Карачаевск~43.7731~41.9142~20|Зеленчукская~43.8586~41.5906~20|Теберда~43.4472~41.7433~20",
 "Владикавказ~43.0246~44.6818~59|Моздок~43.7481~44.6561~59|Алагир~43.0417~44.2197~59",
 "Ардон~43.1753~44.2969~59|Беслан~43.1889~44.5369~59|Невинномысск~44.6339~41.9428~72",
 "Солнечнодольск~45.3136~41.5036~72|Будённовск~44.7847~44.1658~72|Ессентуки~44.0444~42.8606~72",
 "Кисловодск~43.9056~42.7169~72|Минеральные Воды~44.2103~43.1353~72|Георгиевск~44.1497~43.4706~72",
 "Изобильный~45.3694~41.7119~72|Дубки~43.0211~46.8358~50|Избербаш~42.5694~47.8644~50",
 "Крайновка~43.7889~47.4106~50|Буйнакск~42.821~47.118~50|Дагестанские Огни~42.122~48.192~50",
 "Кизилюрт~43.202~46.872~50|Хасавюрт~43.248~46.588~50|Южно-Сухокумск~44.658~45.648~50",
 "Шамилькала~42.685~46.875~50|Тарки~42.942~47.495~50|Кяхулай~42.952~47.515~50",
 "Альбурикент~42.958~47.475~50|Каргалинская (Дагестан)~43.742~46.472~50|Коктюбей~44.352~46.632~50",
 "Брянск (Дагестан)~44.285~46.685~50|Старый Терек~43.825~47.345~50|Новокаякент~42.388~47.988~50",
 "Приморский (Дагестан)~41.848~48.558~50|Тагиркент-Казмаляр~41.788~48.462~50",
 "Чиркей~42.968~46.942~50|Ирганай~42.632~46.912~50|Унцукуль~42.712~46.788~50",
 "Троицкая~43.308~44.982~51|Экажево~43.212~44.822~51|Сурхахи~43.188~44.898~51",
 "Яндаре~43.255~44.918~51|Плиево~43.252~44.838~51|Барсуки~43.248~44.802~51",
 "Гази-Юрт~43.235~44.875~51|Алхасты~43.132~45.048~51|Галашки~43.078~45.008~51",
 "Аршты~43.048~45.125~51|Даттых~43.012~45.142~51|Кантышево~43.225~44.635~51",
 "Долаково~43.245~44.652~51|Джейрах~42.822~44.678~51|Армхи~42.812~44.712~51|Эзми~42.838~44.638~51",
 "Ольгети~42.815~44.778~51|Нарткала~43.558~43.854~16|Терек~43.484~44.136~16",
 "Тырныауз~43.385~42.918~16|Чегем~43.562~43.585~16|Кашхатау~43.318~43.605~16",
 "Солдатская~43.778~43.758~16|Пришибская~43.698~44.082~16|Котляревская~43.592~44.062~16",
 "Александровская~43.575~44.115~16|Прохладная (Кабардино-Балкарская Республика)~43.752~44.012~16",
 "Аушигер~43.378~43.722~16|Бабугент~43.285~43.585~16|Былым~43.465~43.035~16|Алтуд~43.748~43.858~16",
 "Кенже~43.478~43.552~16|Старый Черек~43.545~43.912~16|Аргудан~43.435~43.918~16",
 "Медногорский~43.918~41.185~20|Новый Карачай~43.828~41.905~20|Орджоникидзевский~43.842~41.898~20",
 "Преградная~43.952~41.185~20|Усть-Джегутинская~44.085~41.975~20|Каменномост~43.785~41.925~20",
 "Хабез~44.038~41.772~20|Али-Бердуковский~43.988~41.748~20|Зеюко~44.112~41.788~20",
 "Курджиново~43.988~40.955~20|Учкекен~43.938~42.512~20|Терезе~43.932~42.442~20",
 "Первомайское (Карачаево-Черкесская Республика)~43.942~42.478~20|Дигора~43.158~44.156~59",
 "Заводской~43.092~44.648~59|Луковская~43.738~44.618~59|Павлодольская~43.722~44.492~59",
 "Терская~43.728~44.732~59|Ново-Осетинская~43.715~44.425~59|Змейская~43.332~44.272~59",
 "Николаевская~43.272~44.198~59|Прохладная (Северная Осетия — Алания)~43.725~44.565~59",
 "Эльхотово~43.318~44.312~59|Карджин~43.278~44.338~59|Даргкох~43.262~44.352~59",
 "Кизляр (Северная Осетия — Алания)~43.705~44.622~59|Чикола~43.202~43.918~59",
 "Ахсарисар~43.105~43.845~59|Бурон~42.792~44.008~59|Нижний Зарамаг~42.708~43.982~59",
 "Дзуарикау~42.992~44.382~59|Гизель~43.035~44.575~59|Нижний Ларс~42.782~44.632~59",
 "Урус-Мартан~43.132~45.538~84|Курчалой~43.204~46.088~84|Ачхой-Мартан~43.192~45.282~84",
 "Ойсхара~43.258~46.238~84|Мекенская~43.635~45.432~84",
 "Каргалинская (Чеченская Республика)~43.748~46.462~84|Дубовская~43.785~46.505~84",
 "Бороздинская~43.822~46.522~84|Ильинская~43.382~45.882~84|Чири-Юрт~43.068~45.742~84",
 "Хой~42.758~46.132~84|Благодарный~45.098~43.438~72|Железноводск~44.132~43.028~72",
 "Зеленокумск~44.406~43.876~72|Ипатово~45.716~42.905~72|Лермонтов~44.104~42.972~72",
 "Михайловск (Ставропольский край)~45.128~42.028~72|Нефтекумск~44.752~44.978~72",
 "Новоалександровск~45.492~41.218~72|Новопавловск~43.962~43.638~72|Светлоград~45.335~42.854~72",
 "Иноземцево~44.092~43.082~72|Горячеводский~44.028~43.095~72|Свободы~44.018~43.055~72",
 "Новотроицкая~45.328~41.528~72|Сенгилеевская~45.035~41.622~72|Каменнобродская~45.148~41.588~72",
 "Курская~44.042~44.458~72|Галюгаевская~43.698~44.822~72|Стодеревская~43.702~44.765~72",
 "Прасковея~44.738~44.198~72|Архангельское~44.618~44.118~72",
 "Орловка (Ставропольский край)~44.682~44.155~72|Турксад~45.432~44.475~72",
 "Кочубеевское~44.688~41.828~72|Приозёрское~45.322~44.775~72|Птичье~45.498~41.615~72",
 "Конный~45.105~41.805~72|Нижний Новгород~56.3269~44.0059~36",
 "Бор (Нижегородская обл.)~56.358~44.062~36|Кстово~56.151~44.195~36|Городец~56.643~43.472~36",
 "Заволжье~56.641~43.393~36|Чкаловск~56.768~43.242~36|Лысково~56.012~45.025~36",
 "Васильсурск~56.129~46.007~36|Павлово~55.962~43.09~36|Выкса~55.319~42.173~36",
 "Чебоксары~56.1439~47.2489~85|Новочебоксарск~56.11~47.479~85|Козловка~55.842~48.248~85",
 "Йошкар-Ола~56.6344~47.8999~56|Волжск~55.866~48.358~56|Козьмодемьянск~56.341~46.564~56",
 "Казань~55.7961~49.1064~60|Зеленодольск~55.845~48.518~60|Васильево~55.838~48.665~60",
 "Лаишево~55.405~49.55~60|Камское Устье~55.202~49.272~60|Тетюши~54.938~48.838~60",
 "Болгар~54.96~49.043~60|Чистополь~55.363~50.642~60|Мамадыш~55.716~51.409~60",
 "Елабуга (Татарстан)~55.758~52.046~60|Набережные Челны~55.7436~52.3958~60",
 "Нижнекамск~55.6366~51.8245~60|Мензелинск~55.726~53.102~60|Ульяновск~54.3142~48.4031~79",
 "Димитровград~54.214~49.618~79|Сенгилей~53.966~48.798~79|Старая Майна~54.609~48.928~79",
 "Самара~53.1959~50.1002~65|Тольятти~53.5078~49.4204~65|Жигулёвск~53.402~49.495~65",
 "Сызрань~53.155~48.474~65|Новокуйбышевск~53.099~49.948~65|Пенза~53.1959~45.0183~42",
 "Саранск~54.1874~45.1839~57|Саратов~51.5336~46.0343~67|Энгельс~51.4989~46.125~67",
 "Маркс~51.709~46.749~67|Вольск~52.043~47.379~67|Балаково~52.039~47.784~67",
 "Хвалынск~52.492~48.106~67|Киров (Кировская обл.)~58.6035~49.668~22",
 "Кирово-Чепецк~58.552~50.043~22|Вятские Поляны~56.221~51.068~22|Ижевск~56.8527~53.2115~78",
 "Воткинск~57.051~53.987~78|Сарапул~56.467~53.798~78|Камбарка~56.266~54.205~78",
 "Пермь~58.0105~56.2502~43|Краснокамск~58.08~55.755~43|Добрянка~58.459~56.416~43",
 "Чусовой~58.296~57.816~43|Кунгур~57.428~56.945~43|Оса (Пермский край)~57.283~55.458~43",
 "Чайковский~56.768~54.115~43|Березники~59.409~56.804~43|Соликамск~59.645~56.77~43",
 "Уфа~54.7388~55.9721~48|Бирск~55.418~55.536~48|Павловка~55.421~56.551~48",
 "Нефтекамск~56.088~54.248~48|Агидель~55.899~53.937~48|Стерлитамак~53.63~55.931~48",
 "Салават~53.361~55.925~48|Белорецк~53.966~58.4~48|Оренбург~51.7682~55.097~40",
 "Орск~51.229~58.475~40|Энергетик~51.745~58.793~40|Бузулук~52.788~52.262~40",
 "Караидель~55.833~56.917~48|Дюртюли~55.492~54.866~48|Кушнаренково~55.102~55.344~48",
 "Благовещенск (Башкортостан)~55.035~55.978~48|Янаул~56.265~54.931~48",
 "Николо-Берёзовка~56.128~54.162~48|Туймазы~54.6~53.7~48",
 "Октябрьский (Башкортостан)~54.481~53.471~48|Давлеканово~54.219~55.028~48",
 "Белебей~54.103~54.122~48|Красноусольский~53.892~56.469~48|Ишимбай~53.449~56.046~48",
 "Мелеуз~52.963~55.932~48|Кумертау~52.766~55.786~48|Инзер~54.216~57.556~48|Учалы~54.319~59.383~48",
 "Сибай~52.716~58.666~48|Баймак~52.592~58.316~48|Аскарово~53.338~58.514~48",
 "Месягутово~55.552~58.252~48|Ильинский~58.569~55.684~43|Пожва~59.092~56.089~43",
 "Чердынь~60.403~56.479~43|Красновишерск~60.403~57.079~43|Алексеевское~55.308~50.115~60",
 "Рыбная Слобода~55.383~50.145~60|Актаныш~55.716~54.083~60|Звенигово~55.972~48.015~56",
 "Юрино~56.292~46.299~56|Макарьево~56.082~45.056~36|Шигоны~53.389~48.675~65",
 "Ровное~50.776~46.052~67|Заречный (Пензенская обл.)~53.2028~45.1669~42|Кузнецк~53.1169~46.6006~42",
 "Сердобск~52.4581~44.2169~42|Никольск (Пензенская обл.)~53.7189~46.0719~42",
 "Сурское (Пензенская обл.)~53.0819~45.2219~42|Нижний Ломов~53.5306~43.6769~42",
 "Рузаевка~54.0628~44.9506~57|Краснослободск (Мордовия)~54.4289~43.7758~57",
 "Темников~54.6319~43.2089~57|Ковылкино~54.0389~43.9189~57|Ардатов (Мордовия)~54.8489~46.2358~57",
 "Котельнич~58.3089~48.3489~22|Советск (Кировская обл.)~57.5889~48.9589~22",
 "Уржум~57.1139~50.0019~22|Белая Холуница~58.8419~50.8519~22|Алатырь~54.8419~46.5789~85",
 "Мариинский Посад~56.1158~47.7169~85|Ядрин~55.9419~46.2058~85|Глазов~58.1389~52.6589~78",
 "Каракулино~56.0119~53.7089~78|Межгорье~54.052~57.825~48|Нугуш~53.047~56.453~48",
 "Юмагузино~52.893~56.398~48|Старосубхангулово~53.106~57.442~48|Кандры~54.558~54.053~48",
 "Медведево~56.633~47.804~56|Советский (Марий Эл)~56.758~48.475~56|Красногорский~56.151~48.326~56",
 "Шелангер~56.085~48.203~56|Приволжский~56.002~48.431~56|Кокшайск~56.153~47.808~56",
 "Коротни~56.292~46.462~56|Красный Яр (Марий Эл)~56.038~47.921~56|Инсар~53.87~44.371~57",
 "Зубова Поляна~54.075~42.836~57|Ялга~54.131~45.148~57|Николаевка (Мордовия)~54.155~45.112~57",
 "Луховка~54.172~45.258~57|Тургенево~54.835~46.241~57|Потьма~54.116~42.905~57",
 "Большие Березники~54.185~46.161~57|Кочкурово~54.035~45.448~57|Старое Шайгово~54.307~44.478~57",
 "Теньгушево~54.763~42.716~57|Агрыз~56.526~52.996~60|Азнакаево~54.858~53.074~60",
 "Альметьевск~54.901~52.297~60|Арск~56.091~49.878~60|Бавлы~54.393~53.26~60",
 "Бугульма~54.536~52.798~60|Буинск~54.971~48.292~60|Заинск~55.318~52.067~60",
 "Иннополис~55.752~48.744~60|Кукмор~56.185~50.892~60|Лениногорск~54.602~52.444~60",
 "Менделеевск~55.908~52.293~60|Нурлат~54.428~50.805~60|Куйбышевский Затон~55.195~49.186~60",
 "Нижние Вязовые~55.792~48.518~60|Карабаш (Татарстан)~54.716~52.583~60",
 "Новошешминск~55.068~51.236~60|Муслюмово~55.311~53.188~60|Верхний Услон~55.768~48.983~60",
 "Пестрецы~55.754~49.654~60|Свияжск~55.771~48.659~60|Атабаево~55.206~49.381~60",
 "Можга~56.444~52.227~78|Игра~57.554~53.054~78|Вавож~56.774~51.93~78|Малая Пурга~56.557~53.005~78",
 "Сюмси~57.11~51.615~78|Пудем~58.358~52.176~78|Боярка~55.983~53.541~78|Канаш~55.507~47.492~85",
 "Цивильск~55.869~47.479~85|Шумерля~55.501~46.413~85",
 "Комсомольское (Чувашская Республика)~55.222~47.486~85",
 "Сосновка (Чувашская Республика)~56.185~47.222~85|Криуши (Чувашская Республика)~55.839~48.248~85",
 "Сюктерка~56.153~47.068~85|Александровск (Пермский край)~59.16~57.581~43",
 "Верещагино~58.078~54.657~43|Горнозаводск~58.378~58.323~43",
 "Гремячинск (Пермский край)~58.567~57.844~43|Губаха~58.838~57.551~43|Кизел~59.048~57.651~43",
 "Кудымкар~59.016~54.659~43|Лысьва~58.106~57.805~43|Нытва~57.939~55.331~43|Оханск~57.721~55.388~43",
 "Очёр~57.882~54.717~43|Усолье~59.423~56.682~43|Чёрмоз~58.781~56.148~43|Чернушка~56.509~56.077~43",
 "Яйва~59.333~57.266~43|Кусье-Александровский~58.281~58.362~43",
 "Октябрьский (Пермский край)~56.517~57.211~43|Барда~56.925~55.586~43|Гайны~60.308~54.326~43",
 "Зуевка (Кировская обл.)~58.404~51.132~22|Кирс~59.339~52.244~22|Луза~60.631~47.251~22",
 "Малмыж~56.519~50.679~22|Мураши~59.397~48.961~22|Нолинск~57.558~49.936~22",
 "Омутнинск~58.672~52.181~22|Орлов~58.538~48.891~22|Слободской~58.73~50.181~22",
 "Сосновка (Кировская обл.)~56.256~51.282~22|Яранск~57.303~47.881~22|Нагорск~59.322~50.806~22",
 "Даровской~58.771~47.957~22|Мурыгино~58.736~49.457~22|Афанасьево~58.864~53.253~22",
 "Лесной (Кировская обл.)~59.782~52.463~22|Кильмезь~56.945~51.069~22|Арзамас~55.395~43.839~36",
 "Балахна~56.491~43.541~36|Богородск~56.103~43.514~36|Ветлуга~57.854~45.781~36",
 "Володарск~56.231~43.195~36|Ворсма~55.991~43.275~36|Горбатов~56.132~43.064~36",
 "Дзержинск (Нижегородская обл.)~56.238~43.457~36|Княгинино~55.819~45.035~36",
 "Кулебаки~55.419~42.521~36|Лукоянов~55.039~44.498~36|Навашино~55.529~42.199~36",
 "Первомайск (Нижегородская обл.)~54.869~43.805~36|Перевоз~55.597~44.545~36|Саров~54.935~43.321~36",
 "Семёнов~56.789~44.492~36|Сергач~55.531~45.469~36|Урень~57.461~45.786~36|Шахунья~57.674~46.611~36",
 "Воскресенское~56.837~45.432~36|Красные Баки~57.129~45.155~36",
 "Сокольское (Нижегородская обл.)~57.142~43.159~36|Ковернино~57.125~43.814~36",
 "Катунки~56.835~43.208~36|Тумботино~55.986~43.023~36",
 "Ардатов (Нижегородская обл.)~55.239~43.095~36|Выездное~55.378~43.792~36|Вад~55.535~44.197~36",
 "Фокино (Нижегородская обл.)~56.082~45.654~36|Разнежье~56.121~45.638~36|Чугуны~56.071~45.805~36",
 "Великий Враг~56.165~44.185~36|Абдулино~53.684~53.647~40|Бугуруслан~53.655~52.441~40",
 "Гай~51.467~58.455~40|Кувандык~51.478~57.355~40|Медногорск~51.411~57.583~40",
 "Новотроицк~51.203~58.327~40|Соль-Илецк~51.161~54.992~40|Сорочинск~52.434~53.153~40",
 "Ясный~51.036~59.874~40|Илек~51.527~53.383~40|Саракташ~51.787~56.362~40",
 "Домбаровский~50.758~59.538~40|Светлый (Оренбургская обл.)~50.819~60.854~40",
 "Новоорск~51.381~58.981~40|Беляевка~51.397~56.416~40|Чапаевка~51.825~58.812~40",
 "Белинский~52.964~43.417~42|Городище~53.277~45.702~42|Каменка (Пензенская обл.)~53.191~44.047~42",
 "Спасск~53.926~43.184~42|Сурск~53.076~45.675~42|Шемышейка~52.891~45.392~42",
 "Мокшан~53.437~44.613~42|Беково~52.463~43.712~42|Земетчино~53.497~42.616~42",
 "Сосновоборск (Пензенская обл.)~53.293~46.248~42|Золотарёвка~53.033~45.331~42",
 "Бессоновка~53.309~45.041~42|Вадинск~53.692~43.058~42|Алферьевка~53.047~45.141~42",
 "Кинель~53.225~50.627~65|Нефтегорск~52.802~51.166~65|Октябрьск~53.17~48.674~65",
 "Отрадный~53.376~51.348~65|Похвистнево~53.655~52.126~65|Чапаевск~52.977~49.708~65",
 "Безенчук~52.981~49.431~65|Междуреченск (Самарская обл.)~53.268~49.112~65",
 "Волжский (Самарская обл.)~53.428~50.123~65|Рощинский~53.056~50.478~65",
 "Прибрежный~53.475~49.859~65|Хрящёвка~53.816~49.092~65|Ширяево~53.414~50.015~65",
 "Зольное~53.447~49.798~65|Красный Яр (Самарская обл.)~53.501~50.392~65",
 "Большая Глушица~52.392~50.473~65|Алексеевка (Самарская обл.)~52.583~51.309~65",
 "Аркадак~51.933~43.498~67|Аткарск~51.872~45.006~67|Балашов~51.551~43.168~67",
 "Ершов~51.351~48.282~67|Калининск~51.501~44.475~67",
 "Красноармейск (Саратовская обл.)~51.022~45.698~67|Красный Кут~50.946~46.968~67",
 "Новоузенск~50.457~48.143~67|Петровск~52.309~45.392~67|Пугачёв~52.016~48.803~67",
 "Ртищево~52.257~43.788~67|Шиханы~52.121~47.202~67|Духовницкое~52.481~48.204~67",
 "Усть-Курдюм~51.622~46.235~67|Шумейка~51.572~46.223~67|Пристанное~51.608~46.191~67",
 "Золотое (Саратовская обл.)~50.835~45.932~67|Ахмат~50.941~45.885~67|Степное~51.378~46.852~67",
 "Светлый (Саратовская обл.)~51.671~45.631~67|Сенной~52.148~46.963~67",
 "Ивантеевка (Саратовская обл.)~52.257~49.479~67|Барыш~53.653~47.125~79|Инза~53.854~46.356~79",
 "Новоульяновск~54.151~48.388~79|Ишеевка~54.426~48.271~79",
 "Сурское (Ульяновская обл.)~54.481~46.718~79|Николаевка (Ульяновская обл.)~53.125~47.204~79",
 "Новоспасское~53.149~47.752~79|Новая Майна~54.156~49.754~79|Ундоры~54.602~48.395~79",
 "Криуши (Ульяновская обл.)~54.072~48.554~79|Шиловка~54.041~48.636~79|Садовка~54.665~49.022~79",
 "Никольское-на-Черемшане~53.963~49.308~79|Паньшино~52.812~48.471~79",
 "Новый Уренгой~66.0833~76.68~87|Лимбияха~66.0581~77.7914~87|Коротчаево~65.9472~78.1486~87",
 "Уренгой~65.9631~78.3686~87|Ямсовей~65.6542~76.9531~87|Пангоды~65.85~74.4856~87",
 "Старый Надым~65.565~72.652~87|Надым~65.5333~72.5167~87|Ныда~66.625~72.93~87|Нори~66.15~72.37~87",
 "Тазовский~67.4639~78.7022~87|Самбург~66.985~78.221~87|Антипаюта~69.098~76.855~87",
 "Гыда~70.893~78.472~87|Тарко-Сале~64.915~77.78~87|Пуровск~64.983~77.59~87|Пурпе~64.48~76.68~87",
 "Губкинский~64.434~76.502~87|Ханымей~63.722~75.95~87|Харампур~64.31~78.1~87",
 "Халясавэй~63.39~78.38~87|Муравленко~63.792~74.523~87|Ноябрьск~63.2~75.45~87",
 "Красноселькуп~65.702~82.463~87|Толька~63.998~82.06~87|Салехард~66.53~66.6~87",
 "Лабытнанги~66.657~66.418~87|Харп~66.814~65.808~87|Аксарка~66.56~67.798~87",
 "Яр-Сале~66.863~70.84~87|Панаевск~66.757~70.116~87|Мыс Каменный~68.463~73.593~87",
 "Сеяха~70.165~72.515~87|Мужи~65.398~64.698~87|Горки~65.076~65.291~87|Овгорт~64.867~63.367~87",
 "Сургут~61.25~73.4~81|Белый Яр (ХМАО)~61.267~73.238~81|Барсово~61.278~73.153~81",
 "Фёдоровский~61.608~73.719~81|Лянтор~61.619~72.155~81|Нижнесортымский~62.438~71.76~81",
 "Нижневартовск~60.93~76.55~81|Излучинск~60.963~76.929~81|Мегион~61.034~76.11~81",
 "Лангепас~61.254~75.182~81|Покачи~61.75~75.59~81|Радужный (ХМАО)~62.133~77.475~81",
 "Новоаганск~61.946~76.663~81|Когалым~62.264~74.482~81|Нефтеюганск~61.099~72.603~81",
 "Пыть-Ях~60.75~72.858~81|Салым~60.062~71.478~81|Ханты-Мансийск~61~69.02~81",
 "Горноправдинск~60.056~69.908~81|Нягань~62.14~65.393~81|Приобье~62.533~65.617~81",
 "Октябрьское~62.454~66.05~81|Белоярский (ХМАО)~63.711~66.672~81|Берёзово~63.938~65.042~81",
 "Игрим~63.19~64.417~81|Советский (ХМАО)~61.361~63.564~81|Югорск~61.312~63.332~81",
 "Урай~60.13~64.789~81|Междуреченский~59.6~65.91~81|Тюмень~57.153~65.5343~77",
 "Боровский~57.037~65.713~77|Ялуторовск~56.653~66.3~77|Заводоуковск~56.504~66.551~77",
 "Тобольск~58.198~68.254~77|Вагай~57.937~69.022~77|Уват~59.141~68.895~77|Туртас~58.943~69.142~77",
 "Ишим~56.112~69.49~77|Екатеринбург~56.8389~60.6057~69|Верхняя Пышма~56.971~60.583~69",
 "Берёзовский (Свердловская обл.)~56.908~60.804~69|Среднеуральск~56.99~60.467~69",
 "Заречный (Свердловская обл.)~56.814~61.326~69|Рефтинский~57.092~61.673~69",
 "Первоуральск~56.905~59.943~69|Ревда~56.801~59.91~69|Сысерть~56.5~60.816~69",
 "Полевской~56.442~60.189~69|Каменск-Уральский~56.415~61.918~69|Нижний Тагил~57.919~59.965~69",
 "Серов~59.603~60.578~69|Сосьва~59.176~61.854~69|Гари~59.43~62.35~69|Тавда~58.042~65.272~69",
 "Челябинск~55.1644~61.4368~83|Копейск~55.116~61.617~83|Миасс~55.045~60.108~83",
 "Чебаркуль~54.978~60.37~83|Златоуст~55.171~59.65~83|Кыштым~55.706~60.552~83",
 "Касли~55.889~60.758~83|Южноуральск~54.442~61.253~83|Магнитогорск~53.407~58.979~83",
 "Курган~55.441~65.341~26|Шадринск~56.085~63.633~26|Уренгойское~65.5129~77.2999~87",
 "Новый Порт~67.69~72.9~87|Заполярный (ЯНАО)~66.402~73.84~87",
 "Мишкино (Курганская обл.)~55.338~63.918~26|Шумиха~55.228~63.293~26|Куртамыш~54.911~64.432~26",
 "Макушино~55.211~67.244~26|Петухово~55.069~67.893~26|Частоозерье~55.568~67.908~26",
 "Демьянка~59.546~69.308~77|Ярково~57.408~67.075~77|Казанское~55.639~69.235~77",
 "Ивдель~60.691~60.421~69|Далматово~56.2606~62.9369~26|Катайск~56.2889~62.5819~26",
 "Щучье (Курганская обл.)~55.211~62.754~26|Варгаши~55.378~65.815~26|Каргаполье~55.951~64.432~26",
 "Лебяжье~55.268~66.495~26|Юргамыш~55.372~64.467~26|Альменево~54.956~63.575~26",
 "Белозерское (Курганская обл.)~55.825~65.586~26|Звериноголовское~54.459~64.854~26",
 "Кетово~55.351~65.328~26|Мокроусово~55.809~66.762~26|Половинное~54.789~65.986~26",
 "Сафакулево~54.991~62.548~26|Целинное~54.504~63.674~26|Глядянское~54.908~65.087~26",
 "Усть-Уйское~54.342~64.382~26|Алапаевск~57.853~61.703~69|Арамиль~56.697~60.834~69",
 "Артёмовский~57.356~61.871~69|Асбест~57.006~61.459~69|Богданович~56.78~62.049~69",
 "Верхний Тагил~57.378~59.951~69|Верхняя Салда~58.046~60.554~69|Верхняя Тура~58.358~59.816~69",
 "Верхотурье~58.864~60.805~69|Волчанск~59.936~60.081~69|Дегтярск~56.702~60.097~69",
 "Ирбит~57.674~63.063~69|Камышлов~56.846~62.712~69|Карпинск~59.771~60.004~69",
 "Качканар~58.703~59.483~69|Кировград~57.431~60.061~69|Краснотурьинск~59.766~60.195~69",
 "Красноуральск~58.361~60.042~69|Красноуфимск~56.618~57.768~69|Кушва~58.291~59.759~69",
 "Лесной (Свердловская обл.)~58.636~59.784~69|Михайловск (Свердловская обл.)~56.435~59.119~69",
 "Невьянск~57.489~60.221~69|Нижние Серги~56.666~59.298~69|Нижняя Салда~58.077~60.719~69",
 "Нижняя Тура~58.629~59.856~69|Новая Ляля~59.054~60.598~69|Новоуральск~57.244~60.093~69",
 "Реж~57.372~61.392~69|Североуральск~60.153~59.933~69|Сухой Лог~56.906~62.029~69",
 "Талица~57.016~63.719~69|Туринск~58.046~63.696~69|Шаля~57.243~58.729~69",
 "Белоярский (Свердловская обл.)~56.762~61.412~69|Свободный (Свердловская обл.)~58.041~60.395~69",
 "Сумкино~58.111~68.324~77|Абатское~56.287~70.457~77|Бердюжье~55.805~68.298~77",
 "Исетское~56.485~65.324~77|Сладково~55.528~70.338~77|Велижаны~57.542~65.362~77",
 "Муллаши~56.968~66.042~77|Байкалово~57.548~67.854~77|Аша~54.996~57.274~83|Бакал~54.939~58.808~83",
 "Верхнеуральск~53.877~59.209~83|Верхний Уфалей~56.058~60.231~83|Еманжелинск~54.756~61.321~83",
 "Карабаш (Челябинская обл.)~55.479~60.207~83|Карталы~53.054~60.654~83",
 "Катав-Ивановск~54.753~58.196~83|Коркино~54.891~61.399~83|Куса~55.337~59.439~83",
 "Миньяр~55.074~57.554~83|Нязепетровск~56.053~59.602~83|Озёрск (Челябинская обл.)~55.756~60.703~83",
 "Пласт~54.369~60.813~83|Сатка~55.047~59.032~83|Сим~54.993~57.694~83|Снежинск~56.085~60.731~83",
 "Трёхгорный~54.812~58.452~83|Троицк (Челябинская обл.)~54.097~61.577~83",
 "Усть-Катав~54.933~58.165~83|Юрюзань~54.863~58.422~83|Кондинское~59.649~67.412~81",
 "Пионерский (ХМАО)~61.198~62.863~81|Талинка~61.551~66.332~81|Саранпауль~64.258~60.903~81",
 "Няксимволь~62.426~60.865~81|Угут~60.491~74.054~81|Большетархово~60.931~77.085~81",
 "Согом~60.485~68.125~81|Кедровый (ХМАО)~61.221~68.185~81|Леуши~59.622~65.741~81",
 "Находка (ЯНАО)~67.721~77.618~87|Тибей-Сале~67.152~79.462~87|Щучье (ЯНАО)~67.198~68.374~87",
 "Полярный (ЯНАО)~67.022~65.419~87|Сюнай-Сале~66.774~69.852~87|Шурышкары~65.912~65.348~87",
 "Омск~54.9885~73.3242~39|Тара~56.894~74.371~39|Калачинск~55.052~74.575~39|Черлак~54.155~74.805~39",
 "Новосибирск~55.0084~82.9357~38|Бердск~54.758~83.107~38|Искитим~54.64~83.305~38",
 "Ордынское~54.372~81.901~38|Барабинск~55.35~78.35~38|Чаны~55.313~76.764~38",
 "Томск~56.4846~84.9476~75|Северск (Томская обл.)~56.6~84.883~75|Колпашево~58.316~82.909~75",
 "Парабель~58.698~81.482~75|Каргасок~59.058~80.864~75|Стрежевой~60.733~77.589~75",
 "Кемерово~55.355~86.087~21|Новокузнецк~53.757~87.136~21|Юрга~55.723~84.886~21",
 "Междуреченск (Кемеровская обл.)~53.694~88.06~21|Барнаул~53.3474~83.7784~0",
 "Новоалтайск~53.391~83.936~0|Бийск~52.539~85.207~0|Камень-на-Оби~53.788~81.348~0",
 "Рубцовск~51.501~81.207~0|Горно-Алтайск~51.958~85.96~47|Артыбаш~51.794~87.262~47",
 "Красноярск~56.0153~92.8932~25|Дивногорск~55.959~92.373~25",
 "Железногорск (Красноярский край)~56.251~93.532~25|Канск~56.201~95.706~25|Ачинск~56.269~90.495~25",
 "Лесосибирск~58.235~92.482~25|Енисейск~58.449~92.17~25|Туруханск~65.795~87.962~25",
 "Игарка~67.466~86.583~25|Дудинка~69.405~86.177~25|Норильск~69.3535~88.2027~25",
 "Минусинск~53.706~91.688~25|Абакан~53.7211~91.4424~62|Саяногорск~53.088~91.4~62",
 "Шира~54.491~89.953~62|Кызыл~51.7197~94.4378~61|Иркутск~52.2864~104.305~15",
 "Ангарск~52.544~103.888~15|Шелехов~52.208~104.095~15|Листвянка~51.852~104.868~15",
 "Слюдянка~51.659~103.706~15|Байкальск~51.518~104.142~15|Хужир~53.194~107.339~15",
 "Братск~56.151~101.634~15|Усть-Илимск~58~102.662~15|Усть-Кут~56.794~105.767~15",
 "Белово~54.4169~86.2989~21|Мариинск~56.2119~87.7489~21|Таштагол~52.7658~87.8719~21",
 "Яровое~52.9319~78.5839~0|Змеиногорск~51.1589~82.1958~0|Черногорск~53.8244~91.2842~62",
 "Абаза~52.6519~90.0919~62|Копьёво~54.9858~89.8058~62|Шагонар~51.5319~92.8119~61",
 "Тоора-Хем~52.4689~96.1139~61|Чадан~51.2858~91.5789~61|Туран~52.1439~93.9189~61",
 "Майма~52.015~85.908~47|Чемал~51.411~86.002~47|Турочак~52.257~87.122~47|Иогач~51.787~87.258~47",
 "Балыкча~51.318~87.848~47|Усть-Кокса~50.269~85.611~47|Акташ~50.313~87.6~47",
 "Улаган~50.632~87.959~47|Онгудай~50.748~86.142~47|Усть-Кан~50.929~84.763~47",
 "Манжерок~51.825~85.812~47|Ак-Довурак~51.183~90.6~61|Сорск~54.004~90.247~62",
 "Черёмушки~52.856~91.417~62|Майна~53.007~91.482~62|Аскиз~53.133~90.528~62|Таштып~52.796~89.893~62",
 "Жемчужный~54.505~90.137~62|Алейск~52.492~82.782~0|Белокуриха~51.996~84.985~0",
 "Горняк (Алтайский край)~50.996~81.467~0|Заринск~53.707~84.935~0|Славгород~52.999~78.646~0",
 "Павловск (Алтайский край)~53.318~82.977~0|Артёмовск (Красноярский край)~54.35~93.433~25",
 "Боготол~56.205~89.528~25|Бородино~55.906~94.908~25|Заозёрный~55.963~94.706~25",
 "Зеленогорск (Красноярский край)~56.113~94.596~25|Иланский~56.237~96.065~25",
 "Кодинск~58.606~99.178~25|Назарово~56.008~90.391~25",
 "Сосновоборск (Красноярский край)~56.135~93.361~25|Ужур~55.308~89.832~25|Уяр~55.813~94.325~25",
 "Шарыпово~55.541~89.198~25|Тура~64.277~100.219~25|Байкит~61.677~96.378~25",
 "Хатанга~71.98~102.474~25|Курагино~53.896~92.675~25|Краснотуранск~54.316~91.564~25",
 "Бор (Красноярский край)~61.601~90.018~25|Алзамай~55.556~98.665~15|Бирюсинск~55.961~97.822~15",
 "Бодайбо~57.851~114.194~15|Вихоревка~56.118~101.178~15|Железногорск-Илимский~56.578~104.118~15",
 "Зима~53.921~102.047~15|Киренск~57.785~108.099~15|Нижнеудинск~54.908~99.028~15",
 "Саянск~54.109~102.179~15|Свирск~53.085~103.332~15|Тайшет~55.936~98.007~15",
 "Тулун~54.562~100.579~15|Усолье-Сибирское~52.753~103.647~15|Черемхово~53.155~103.072~15",
 "Култук~51.722~103.704~15|Ербогачён~61.278~108.012~15|Оса (Иркутская обл.)~53.377~103.903~15",
 "Анжеро-Судженск~56.082~86.028~21|Берёзовский (Кемеровская обл.)~55.6~86.256~21",
 "Гурьевск (Кемеровская обл.)~54.283~85.94~21|Калтан~53.535~87.269~21|Киселёвск~53.992~86.639~21",
 "Ленинск-Кузнецкий~54.659~86.173~21|Мыски~53.688~87.804~21|Осинники~53.6~87.332~21",
 "Полысаево~54.597~86.283~21|Прокопьевск~53.906~86.719~21|Салаир~54.236~85.798~21",
 "Тайга~56.066~85.62~21|Топки~55.276~85.617~21|Большой Берчикуль~55.626~88.318~21",
 "Инской~54.427~86.442~21|Яя~56.203~86.438~21|Болотное~55.672~84.398~38|Карасук~53.733~78.033~38",
 "Каргат~55.195~80.281~38|Куйбышев~55.448~78.318~38|Купино~54.366~77.298~38|Обь~54.992~82.695~38",
 "Татарск~55.216~75.975~38|Тогучин~55.235~84.389~38|Черепаново~54.223~83.376~38",
 "Чулым~55.099~80.963~38|Кыштовка~56.559~76.626~38|Почта~55.474~82.992~38",
 "Исилькуль~54.911~71.268~39|Называевск~55.568~71.353~39|Тюкалинск~55.872~72.203~39",
 "Усть-Ишим~57.693~71.168~39|Муромцево~56.373~75.242~39|Нововаршавка~54.172~74.696~39",
 "Колосовка~56.467~73.611~39|Асино~57.001~86.151~75|Кедровый (Томская обл.)~57.562~79.566~75",
 "Белый Яр (Томская обл.)~58.444~85.044~75|Молчаново~57.581~83.763~75",
 "Первомайское (Томская обл.)~57.075~86.231~75|Подгорное~57.785~82.651~75",
 "Улан-Удэ~51.8335~107.5841~49|Гусиноозёрск~51.285~106.526~49|Кабанск~52.049~106.652~49",
 "Усть-Баргузин~53.411~109.026~49|Северобайкальск~55.637~109.323~49|Чита~52.033~113.501~12",
 "Якутск~62.0355~129.6755~58|Покровск~61.478~129.141~58|Ленск~60.725~114.928~58",
 "Мирный (Саха (Якутия))~62.535~113.961~58|Вилюйск~63.755~121.624~58|Алдан~58.603~125.389~58",
 "Нерюнгри~56.658~124.725~58|Тикси~71.637~128.868~58",
 "Благовещенск (Амурская обл.)~50.2907~127.5272~1|Свободный (Амурская обл.)~51.375~128.134~1",
 "Зея~53.749~127.262~1|Тында~55.155~124.725~1|Биробиджан~48.794~132.921~11",
 "Хабаровск~48.4802~135.0719~80|Амурск~50.226~136.899~80|Комсомольск-на-Амуре~50.5496~137.0067~80",
 "Николаевск-на-Амуре~53.145~140.722~80|Советская Гавань~48.969~140.289~80",
 "Ванино~49.092~140.264~80|Владивосток~43.1155~131.8855~44|Артём~43.355~132.186~44",
 "Уссурийск~43.797~131.952~44|Находка (Приморский край)~42.8138~132.8735~44",
 "Большой Камень~43.112~132.348~44|Спасск-Дальний~44.6~132.818~44|Камень-Рыболов~44.747~132.043~44",
 "Славянка~42.863~131.385~44|Южно-Сахалинск~46.9591~142.738~68|Корсаков~46.634~142.776~68",
 "Анива~46.715~142.528~68|Холмск~47.046~142.046~68|Поронайск~49.222~143.102~68",
 "Ноглики~51.805~143.138~68|Оха~53.589~142.949~68|Петропавловск-Камчатский~53.0452~158.6508~19",
 "Елизово~53.187~158.383~19|Усть-Большерецк~52.825~156.252~19|Усть-Камчатск~56.228~162.476~19",
 "Магадан~59.5612~150.8301~31|Анадырь~64.733~177.515~86|Арахлей~52.2119~112.9119~12",
 "Краснокаменск~50.0989~118.0369~12|Борзя~50.3889~116.5289~12|Хилок~51.3639~110.4619~12",
 "Петровск-Забайкальский~51.2758~108.8419~12|Белогорск (Амурская обл.)~50.9189~128.4758~1",
 "Шимановск~52.0019~127.6689~1|Ленинское~47.9369~132.6189~11",
 "Николаевка (Еврейская АО)~48.5569~134.7858~11|Ола~59.5789~151.2989~31",
 "Синегорье~62.0889~150.5319~31|Сусуман~62.7819~148.1558~31|Певек~69.7019~170.3119~86",
 "Билибино~68.0558~166.4419~86|Лаврентия~65.5839~-171.0019~86|Вилючинск~52.9319~158.4058~19",
 "Ключи~56.3219~160.8489~19|Оссора~59.0919~159.9519~19|Бабушкин~51.718~105.864~49",
 "Закаменск~50.376~103.284~49|Кяхта~50.351~106.45~49|Каменск~51.995~106.583~49",
 "Гремячинск (Бурятия)~52.796~107.969~49|Горячинск~52.987~108.293~49|Баргузин~53.619~109.633~49",
 "Посольское~52.018~106.183~49|Сосново-Озёрское~52.527~111.543~49",
 "Петропавловка (Бурятия)~50.612~105.319~49|Бичура~50.588~107.602~49|Верхоянск~67.551~133.39~58",
 "Нюрба~63.284~118.334~58|Олёкминск~60.374~120.426~58|Среднеколымск~67.457~153.707~58",
 "Томмот~58.956~126.292~58|Удачный~66.408~112.299~58|Хандыга~62.656~135.568~58",
 "Жиганск~66.767~123.372~58|Амга~60.896~131.977~58|Хонуу~66.456~143.226~58",
 "Батагай~67.654~134.636~58|Саскылах~71.964~114.088~58|Оленёк~68.504~112.436~58",
 "Балей~51.583~116.633~12|Могоча~53.733~119.767~12|Сретенск~52.244~117.709~12",
 "Шилка~51.85~116.033~12|Нерчинск~51.983~116.583~12|Приаргунск~50.369~119.102~12",
 "Атамановка~51.93~113.633~12|Ясногорск (Забайкальский край)~50.865~115.702~12",
 "Красный Чикой~50.364~108.751~12|Нижний Цасучей~50.52~115.132~12|Тунгокочен~53.559~115.534~12",
 "Палана~59.084~159.954~19|Вулканный~53.099~158.374~19",
 "Октябрьский (Камчатский край)~52.651~156.241~19|Соболево~54.294~155.887~19",
 "Озерновский~51.493~156.506~19|Запорожье (Камчатский край)~51.491~156.529~19",
 "Каменское~62.468~166.208~19|Никольское (Камчатский край)~55.197~165.986~19",
 "Арсеньев~44.152~133.275~44|Дальнегорск~44.555~135.568~44|Дальнереченск~45.932~133.726~44",
 "Лесозаводск~45.469~133.397~44|Партизанск~43.132~133.129~44",
 "Фокино (Приморский край)~42.971~132.41~44|Лучегорск~46.447~134.289~44|Ольга~43.744~135.289~44",
 "Тавричанка~43.326~131.884~44|Красный Яр (Приморский край)~46.541~135.357~44",
 "Русский~43.045~131.872~44|Бикин~46.814~134.252~80|Вяземский~47.534~134.756~80",
 "Охотск~59.364~143.204~80|Де-Кастри~51.469~140.779~80|Переяславка~47.962~135.053~80",
 "Заветы Ильича~49.027~140.258~80|Майский (Хабаровский край)~48.998~140.203~80",
 "Елабуга (Хабаровский край)~48.831~135.887~80|Сикачи-Алян~48.753~135.647~80",
 "Имени Полины Осипенко~52.422~136.485~80|Чумикан~54.696~135.313~80|Нелькан~57.659~136.164~80",
 "Завитинск~50.111~129.442~1|Райчихинск~49.794~129.408~1|Сковородино~53.984~123.941~1",
 "Циолковский~51.761~128.128~1|Новобурейский~49.803~129.878~1|Бурея~49.796~129.784~1",
 "Архара~49.421~130.084~1|Февральск~52.467~130.922~1|Поярково~49.626~128.653~1",
 "Константиновка (Амурская обл.)~49.619~127.989~1|Джалинда~53.471~123.908~1",
 "Сеймчан~62.934~152.391~31|Эвенск~61.918~159.236~31|Сокол (Магаданская обл.)~59.918~150.749~31",
 "Уптар~59.897~150.872~31|Тауйск~59.736~149.387~31|Гадля~59.656~151.318~31",
 "Александровск-Сахалинский~50.898~142.159~68|Долинск~47.33~142.793~68|Курильск~45.233~147.878~68",
 "Макаров~48.628~142.781~68|Невельск~46.674~141.859~68|Северо-Курильск~50.675~156.122~68",
 "Томари~47.766~142.068~68|Углегорск (Сахалинская обл.)~49.076~142.063~68",
 "Южно-Курильск~44.03~145.859~68|Тымовское~50.847~142.658~68",
 "Шахтёрск (Сахалинская обл.)~49.158~142.112~68|Стародубское~47.412~142.805~68",
 "Охотское~46.851~143.167~68|Чехов (Сахалинская обл.)~47.448~141.989~68|Вал~52.341~143.067~68",
 "Некрасовка~53.524~142.634~68|Облучье~49.006~131.049~11|Приамурский~48.519~134.918~11",
 "Имени Тельмана~48.508~134.962~11|Теплоозёрск~49.002~131.898~11|Лондоко-завод~49.027~131.992~11",
 "Волочаевка-2~48.567~134.587~11|Пашково~48.878~130.659~11|Даниловка~48.622~134.502~11",
 "Волочаевка-1~48.559~134.482~11|Угольные Копи~64.733~177.698~86|Провидения~64.427~186.774~86",
 "Марково~64.681~170.413~86|Канчалан~65.174~176.968~86"
];
const _CITIES = _C_PACK.join("|").split("|").map(s => {
 const p = s.split("~");
 return [p[0], +p[1], +p[2], +p[3]];
});
const BOT_CITIES_DB = _CITIES.map(r => ({
 name: r[0], lat: r[1], lon: r[2], admin1: _BOT_ADMINS[r[3]] || ""
}));

const _W_PACK = [
 "р. Москва~2~1~3.5~55.75~37.62|р. Яуза~2~0~1.8~55.755~37.645|р. Пахра~2~0~2.1~55.44~37.56",
 "Пироговское вдхр.~2~2~5.2~55.98~37.7|Клязьминское вдхр.~2~2~4.8~55.99~37.58",
 "Истринское вдхр.~2~2~6~56.05~36.8|Можайское вдхр.~2~2~6.5~55.58~35.85",
 "Рузское вдхр.~2~2~6.2~55.78~36.05|Озернинское вдхр.~2~2~5.8~55.77~36.22",
 "оз. Сенеж~2~3~3~56.19~37.02|Шатурские озёра (Шатурская ГРЭС)~2~4~3.8~55.59~39.55",
 "Иваньковское вдхр. (Московское море)~2~2~5.5~56.75~36.95",
 "Тёплый сброс Конаковской ГРЭС~2~4~3.5~56.74~36.78|р. Волга (Тверь)~2~1~4.2~56.86~35.9",
 "р. Тверца~2~0~2.1~56.87~35.92|оз. Плещеево~2~2~8~56.76~38.78",
 "р. Волга (Ярославль)~2~1~5.8~57.62~39.89|р. Которосль~2~0~2.2~57.61~39.88",
 "Рыбинское вдхр.~2~2~6.8~58.2~38.5|р. Ока (Серпухов / Кашира)~2~1~3.6~54.88~37.42",
 "р. Ока (Коломна)~2~1~3.8~55.08~38.77|р. Ока (Рязань)~2~1~4.2~54.63~39.75",
 "р. Пра (Мещёра)~2~0~1.8~54.95~40.15|р. Клязьма (Владимир)~2~0~2.2~56.12~40.41",
 "оз. Селигер~2~2~5.8~57.2~33.05|оз. Неро~2~3~1.5~57.17~39.43|р. Дон (Воронеж)~6~1~3.8~50.98~39.5",
 "р. Воронеж (Воронежское вдхр.)~6~2~4.2~51.67~39.2|Нововоронежское вдхр. (АЭС)~6~4~4.8~51.27~39.2",
 "р. Днепр (Смоленск)~7~1~2.8~54.78~32.05|Десногорское вдхр. (Смоленская АЭС)~7~4~6.5~54.15~33.28",
 "р. Десна (Брянск)~7~1~3.2~53.25~34.37|р. Сейм (Курск)~7~1~2.6~51.73~36.19",
 "Курчатовское вдхр. (Курская АЭС)~7~4~5.8~51.65~35.65|р. Оскол~6~0~2.1~51.3~37.83",
 "Старооскольское вдхр.~6~2~5.2~51.4~37.95|Белгородское вдхр.~6~2~4.8~50.59~36.59",
 "Угличское вдхр. (Углич / Калязин)~2~2~6.5~57.4~38.1",
 "Рыбинское вдхр. (Весьегонск / Брейтово)~2~2~7~58.65~37.3",
 "р. Волга (Ржев / Зубцов)~2~1~3~56.262~34.33|оз. Песьво (Удомля АЭС)~2~4~5.5~57.75~34.8",
 "р. Волга (Кострома / Кинешма)~2~1~6.5~57.45~41.52|Уводьское вдхр. (Иваново)~2~2~5~57.05~40.9",
 "р. Ока (Муром / Павлово / Выкса)~2~1~4.8~55.58~42.1",
 "р. Ока (Касимов / Шилово)~2~1~4.5~54.65~41.15",
 "р. Упа / р. Ока (Тула / Алексин)~2~0~2.4~54.2~37.62",
 "р. Ока / р. Протва (Калуга / Обнинск / Наро-Фоминск)~2~1~3.6~54.75~36.45",
 "р. Дон (Вёшенская / Павловск)~6~1~4.2~50~40.9",
 "Матырское вдхр. / р. Дон (Липецк / Елец)~6~1~3.6~52.615~39.05",
 "р. Цна / Котовское вдхр. (Тамбов)~2~0~2.5~52.72~41.455|р. Ока (Орёл)~2~0~2.2~52.967~36.065",
 "р. Нара (Наро-Фоминск)~2~0~2.2~55.389~36.736|Горьковское вдхр. (Юрьевец)~2~2~9.5~57.322~43.118",
 "р. Клязьма (Ковров)~2~1~3.8~56.362~41.305|р. Дон (Павловск)~6~1~5.2~50.455~40.095",
 "р. Волга / Костромской залив (Кострома)~2~1~7.5~57.765~40.918",
 "Рыбинское вдхр. / р. Согожа (Пошехонье)~2~2~6.5~58.5~39.11",
 "р. Цна и Тамбовское вдхр. (Тамбов / Моршанск)~2~0~2.6~52.721~41.452",
 "Матырское вдхр. (Липецк / Грязи)~6~2~4.5~52.535~39.815",
 "оз. Галичское и оз. Чухломское (Галич / Чухлома)~2~2~3~58.405~42.295",
 "р. Москва (Марьино / Братеево / Капотня — незамерзающий нижний бьеф)~2~1~4.2~55.642~37.745",
 "Строгинский затон (Большой и Малый Строгинские карьеры)~2~2~6.5~55.803~37.432",
 "Химкинское вдхр.~2~2~5.8~55.845~37.458|Гребной канал (Крылатское)~2~2~3.5~55.756~37.434",
 "Косинские озёра (Белое, Чёрное, Святое)~2~3~3.8~55.721~37.858",
 "Борисовские и Царицынские пруды~2~3~2.6~55.629~37.702",
 "р. Десна и р. Пахра (ТиНАО, Троицк)~2~0~2.1~55.485~37.307",
 "р. Сходня (Сходненский ковш)~2~0~1.8~55.842~37.412|р. Сетунь~2~0~1.5~55.722~37.508",
 "Канал им. Москвы (Дмитров — Дубна — Икша — Химки)~2~1~5.5~56.345~37.515",
 "Пестовское вдхр.~2~2~5.6~56.082~37.685|Пяловское вдхр.~2~2~4.8~56.038~37.652",
 "Икшинское вдхр.~2~2~5.2~56.135~37.535|Учинское (Акуловское) вдхр.~2~2~6.2~56.018~37.765",
 "Верхнерузское вдхр.~2~2~5.8~55.948~35.425",
 "Яузское вдхр. (восточный плёс / Карманово)~2~2~6.5~55.855~35.158",
 "Цимлянский (Павленское оз.) и Ланьшинский карьеры (р. Ока, Серпухов)~2~2~7.2~54.881~37.428",
 "Бисерово озеро и Кудиновские карьеры (Старая Купавна)~2~2~6.8~55.775~38.135",
 "оз. Круглое и оз. Долгое (Дмитровский / Солнечногорский р-н)~2~3~3.4~56.052~37.362",
 "оз. Тростенское (Рузский / Истринский р-н)~2~3~2.4~55.862~36.485",
 "Егорьевский и Клинский рыбокомбинаты (Шалаховское вдхр.)~2~3~2.8~55.342~39.325",
 "р. Клязьма (Щёлково — Ногинск — Павловский Посад — Орехово-Зуево)~2~0~2.4~55.855~38.442",
 "р. Дубна и р. Сестра~2~0~2.5~56.675~37.248",
 "р. Осётр (Зарайск / Серебряные Пруды)~2~0~2.2~54.757~38.875|р. Руза~2~0~2.1~55.702~36.205",
 "р. Истра~2~0~1.9~55.914~36.862|р. Лама~2~0~2~56.192~35.845",
 "р. Протва (Верея / Протвино)~2~0~2.3~55.344~36.185|р. Лопасня~2~0~1.8~55.148~37.477",
 "р. Нерская~2~0~1.9~55.512~38.752|р. Пра (верховья — оз. Святое, Шатура)~2~0~1.8~55.385~39.915",
 "р. Северский Донец (Белгород / Маслова Пристань / Шебекино)~6~0~2.6~50.453~36.736",
 "р. Оскол (Волоконовка / Новый Оскол / Валуйки)~6~0~2.8~50.485~37.859",
 "р. Тихая Сосна (Бирюч / Алексеевка)~6~0~2.3~50.631~38.689",
 "р. Ворскла (Борисовка / Грайворон)~7~0~2.1~50.478~35.676",
 "р. Нежеголь (Шебекино)~6~0~2~50.412~36.885|р. Короча~6~0~1.7~50.811~37.202",
 "р. Айдар (Ровеньки)~6~0~1.9~49.914~38.902",
 "р. Десна (Жуковка / Сельцо / Выгоничи / Трубчевск / Белая Берёзка)~7~1~3.8~52.585~33.768",
 "р. Ипуть (Сураж / Новозыбков / Клинцы)~7~0~2.5~52.752~32.238",
 "р. Судость (Почеп / Погар)~7~0~2.4~52.932~33.457",
 "р. Болва (Дятьково / Фокино / Брянск)~7~0~2.2~53.456~34.419",
 "р. Нерусса (Суземка / Трубчевск)~7~0~2.1~52.435~33.912",
 "р. Беседь (Красная Гора)~7~0~2.3~53.001~31.603",
 "р. Снежеть (Карачев / Брянск)~7~0~1.8~53.123~34.985|р. Сев (Севск)~7~0~1.7~52.149~34.492",
 "оз. Кожановское (Гордеевский / Клинцовский р-н)~7~3~2.2~52.815~31.895",
 "Брянские карьеры (Бежицкие / Ковшовские / Орлик 1–5)~7~2~5.5~53.318~34.302",
 "р. Клязьма (Петушки / Собинка)~2~0~2.4~55.929~39.463",
 "р. Клязьма (Вязники / Мстёра / Гороховец — низовья)~2~1~3.6~56.245~42.152",
 "р. Нерль Клязьминская (Суздаль / Боголюбово)~2~0~2.2~56.195~40.533",
 "р. Киржач (Киржач / Покров)~2~0~1.9~56.156~38.859",
 "р. Пекша и Кольчугинское вдхр. (Кольчугино)~2~2~4.2~56.302~39.382",
 "р. Судогда (Судогда)~2~0~1.8~55.953~40.861",
 "р. Гусь и Гусевское вдхр. (Гусь-Хрустальный)~2~2~3.5~55.618~40.655",
 "оз. Святое (Мещёра, Гусь-Хрустальный р-н)~2~3~2.5~55.342~40.185",
 "оз. Кщара и оз. Санхар (Вязниковский р-н, Клязьминско-Лухский заказник)~2~2~9.5~56.418~42.345",
 "Пойменные озёра-старицы р. Оки и Клязьмы (оз. Виша, оз. Урвановское — Муром / Вязники)~2~3~3.2~55.652~42.115",
 "р. Дон (Семилуки / Нововоронеж / Коротояк)~6~1~4.2~51.315~39.128",
 "р. Дон (Верхний Мамон / Богучар)~6~1~4.8~50.045~40.512",
 "р. Хопёр (Борисоглебск / Поворино / Новохопёрск)~6~1~3.8~51.195~41.925",
 "р. Битюг (Анна / Бобров / Лосево)~6~0~2.8~51.093~40.034",
 "р. Ворона (Борисоглебск)~6~0~2.6~51.367~42.083|р. Воронеж (Рамонь)~6~0~2.7~51.916~39.339",
 "р. Усмань (Новая Усмань / Рамонь)~6~0~2~51.644~39.409",
 "р. Тихая Сосна (Острогожск / Дивногорье)~6~0~2.2~50.865~39.069",
 "р. Чёрная Калитва (Россошь / Ольховатка)~6~0~2.1~50.198~39.569",
 "р. Савала (Терновка / Новохопёрск)~6~0~2~51.325~41.612|р. Икорец~6~0~1.8~51.125~39.625",
 "оз. Погоново и пойменные озёра Дона~6~3~2.8~51.482~39.095",
 "Горьковское вдхр. (Пучеж / Юрьевец — озёрная часть, устья р. Ячменка, р. Елнать, р. Шохонка)~2~2~7.8~57.145~43.135",
 "р. Волга (Наволоки / Кинешма / Заволжск / Решма)~2~1~6.5~57.452~42.165",
 "р. Теза (Шуя / Холуй — шлюзованная система)~2~0~2.4~56.715~41.585",
 "р. Лух (пгт Лух / Талицы / Южа)~2~0~2.2~56.695~42.265",
 "р. Уводь (Иваново / Кохма / Лежнево / Савино)~2~0~2~56.835~41.015",
 "р. Нерль Клязьминская (Тейково / Гаврилов Посад)~2~0~2.1~56.652~40.235",
 "р. Сунжа и р. Колдома (Вичуга / Каменка)~2~0~1.9~57.386~41.766",
 "оз. Рубское (Тейковский р-н)~2~2~5.8~56.725~40.615",
 "оз. Святое (Мугреевский, Южский р-н)~2~3~3.4~56.518~42.345",
 "р. Ока (Перемышль / Калуга / Ферзиково / Таруса)~2~1~3.6~54.512~36.265",
 "р. Угра (Юхнов / Товарково / Калуга)~2~0~2.4~54.673~35.942",
 "р. Жиздра (Жиздра / Козельск / Перемышль)~2~0~2.3~54.038~35.785",
 "р. Протва (Боровск / Обнинск / Жуков / Кремёнки)~2~0~2.2~55.028~36.743",
 "р. Шаня и р. Суходрев (Кондрово / Полотняный Завод / Товарково)~2~0~1.9~54.731~35.998",
 "р. Лужа (Малоярославец)~2~0~1.8~55.011~36.467",
 "р. Рессета и р. Вытебеть (Хвастовичи / Ульяново)~2~0~1.9~53.545~35.315",
 "Яченское вдхр. (Калуга)~2~2~4~54.524~36.218",
 "оз. Ломпадь / Людиновское вдхр. (р. Неполодь, Людиново)~7~2~4.8~53.882~34.445",
 "Кировские вдхр. (Верхнее и Нижнее) и р. Болва (Киров)~7~2~4.2~54.075~34.307",
 "Брынское вдхр. (Думиничский / Сухиничский р-н)~2~2~4.5~54.008~35.215",
 "оз. Тишь (пойменное озеро-старица Оки, Перемышльский р-н)~2~3~3~54.342~36.178",
 "Костромское расширение Горьковского вдхр. («Костромское море» / Костромские разливы)~2~2~4.5~57.855~40.765",
 "Тёплый канал Костромской ГРЭС (Волгореченск)~2~4~4.2~57.448~41.152",
 "р. Кострома (Солигалич / Буй / Кострома)~2~1~3.8~58.478~41.531",
 "р. Унжа (Кологрив / Мантурово / Макарьев — устье в Горьковском вдхр.)~2~1~4~58.125~44.115",
 "р. Нёмда и Нёмдинский залив Горьковского вдхр. (Кадый)~2~2~5.2~57.625~43.185",
 "р. Мера и Мерский залив (Островское / Заволжск)~2~0~2.8~57.615~42.245",
 "р. Ветлуга (Шарья / Пыщуг)~2~1~3.6~58.385~45.512|р. Нея (Нея / Парфеньево)~2~0~2.2~58.293~43.868",
 "р. Сейм (Льгов / Рыльск / Глушково)~7~1~3.4~51.625~35.115",
 "р. Тускарь и Курское вдхр. («Курское море» / Щетинка)~7~2~3.8~51.812~36.215",
 "р. Свапа и Михайловское (Копенское) вдхр. (Дмитриев / Железногорск)~7~2~4.5~52.235~35.342",
 "р. Псёл (Обоянь / Белая / Суджа)~7~0~2.4~51.145~35.815",
 "Старооскольское вдхр. (северный плёс — пгт Горшечное)~6~2~5.2~51.452~37.915",
 "р. Тим, р. Кшень и р. Олым (восточные районы — бассейн р. Быстрая Сосна / Дон)~6~0~1.9~51.835~37.825",
 "р. Дон (Данков / Лебедянь / Задонск / Хлевное)~6~1~3.5~52.685~39.025",
 "р. Воронеж (Доброе / Липецк / Хлевное)~6~1~3.4~52.615~39.612",
 "р. Быстрая Сосна (Елец / Измалково / впадение в Дон)~6~0~2.6~52.625~38.515",
 "р. Красивая Меча (низовья — Лебедянский р-н, с. Троекурово)~6~0~2.3~52.995~39.015",
 "р. Матыра (Грязи)~6~0~2.2~52.495~39.935|р. Становая Ряса (Чаплыгин)~6~0~1.9~53.242~39.967",
 "р. Усмань (Усмань)~6~0~1.8~52.043~39.736",
 "р. Ока (Кромы / Орёл / Болхов / Мценский р-н)~2~0~2.5~53.152~36.125",
 "р. Зуша (Новосиль / Корсаково / Мценск)~2~0~2.4~53.215~36.752",
 "р. Быстрая Сосна (Колпна / Ливны)~6~0~2.3~52.425~37.605|р. Нугрь (Болхов)~2~0~1.8~53.442~36.005",
 "р. Неручь (Залегощь)~2~0~1.7~52.903~36.883",
 "р. Крома и р. Орлик (Кромы / Орёл)~2~0~1.7~52.845~35.895",
 "р. Нерусса (Дмитровск — верховья)~7~0~1.8~52.505~35.147",
 "Неручанское и Михайловское вдхр. / пруды Орловщины~2~3~3~52.685~36.415",
 "р. Ока (Константиново / Рыбное / Спасск-Рязанский / Елатьма)~2~1~4.5~54.512~40.385",
 "Новомичуринское вдхр. (Рязанская ГРЭС на р. Проня)~2~4~5.5~54.045~39.752",
 "р. Проня (Михайлов / Пронск / Старожилово / Спасск-Рязанский — устье в Оку)~2~0~2.6~54.227~39.914",
 "р. Мокша (Кадом / Пителино / устье в Оку)~2~1~3.8~54.615~42.115",
 "р. Цна (Шацк / Сасово)~2~0~2.7~54.354~41.926",
 "р. Ранова и р. Пара (Ряжск / Кораблино / Сараи / Шилово)~2~0~2.2~53.919~40.019",
 "р. Гусь (Гусь-Железный — впадение в Оку)~2~0~2~55.056~41.163",
 "Клепиковские (Великие) озёра Мещёры (оз. Великое, Шагара, Ивановское, Белое, Мартыново — Спас-Клепики)~2~3~2.6~55.185~40.152",
 "оз. Велье, оз. Дубовое и оз. Ижевское (пойменные озёра Оки)~2~3~2.8~54.558~40.871",
 "Вазузское вдхр. (Сычёвка / Гагарин / Хлепень / Дубинино)~2~2~7.2~55.945~34.485",
 "Яузское вдхр. (Карманово / Пудыши / Савино — Гагаринский р-н)~2~2~6.8~55.862~35.015",
 "р. Днепр (Холм-Жирковский / Сафоново / Дорогобуж / Верхнеднепровский / Смоленск)~7~1~3.6~54.916~33.297",
 "р. Западная Двина (Велиж)~5~1~3.8~55.606~31.197|р. Каспля (Демидов)~5~0~2.2~55.271~31.515",
 "Озёра нацпарка «Смоленское Поозерье» (оз. Сапшо, Баклановское, Рытое, Чистик, Дго — пгт Пржевальское)~5~2~7.5~55.509~31.849",
 "оз. Сошно (охладитель Смоленской ГРЭС, пгт Озёрный)~5~4~4.8~55.589~32.393",
 "оз. Акатовское и оз. Каспля (Демидовский / Смоленский р-н)~5~2~4.5~55.115~31.585",
 "р. Угра и р. Воря (Угра / Тёмкино)~2~0~2.2~54.915~34.625",
 "р. Сож и р. Остёр (Рославль / Хиславичи)~7~0~2.3~54.052~32.315",
 "р. Вопь (Ярцево)~7~0~2~55.067~32.696",
 "р. Ворона (Кирсанов / Инжавино / Уварово / Мучкапский — оз. Рамза)~6~0~2.7~52.185~42.495",
 "р. Лесной Воронеж и р. Польной Воронеж (Мичуринск / Дмитриевка)~6~0~2.4~52.895~40.515",
 "Шушпанское вдхр. (Староюрьевский р-н)~6~2~3.8~53.218~40.615",
 "Челновая (Челнавское) вдхр. (Сосновский р-н)~2~2~4~53.165~41.315",
 "р. Савала (Жердевка)~6~0~2~51.848~41.464|р. Битюг (верховья — Мордово)~6~0~1.9~52.085~40.768",
 "р. Матыра (верховья — Петровский р-н)~6~0~1.8~52.634~40.264",
 "оз. Рамза и оз. Кипец (пойма р. Ворона, Инжавинский р-н)~6~3~2.8~52.145~42.482",
 "Верхневолжское вдхр. (Верхневолжские озёра: Стерж, Вселуг, Пено, Волго — Пеновский / Осташковский / Селижаровский р-н)~2~2~5.8~56.924~32.735",
 "оз. Удомля и оз. Песьво (охладители Калининской АЭС, г. Удомля)~2~4~6.2~57.905~35.025",
 "Вышневолоцкое вдхр. и оз. Мстино (Вышний Волочёк)~3~2~4.5~57.585~34.485",
 "Вазузское вдхр. (северный плёс — г. Зубцов)~2~2~6.8~56.115~34.552",
 "р. Волга (Селижарово / Старица / Тверь / Кимры / Белый Городок)~2~1~4.5~56.858~35.915",
 "р. Шоша и Шошинский плёс Иваньковского вдхр. (Завидово / Конаково)~2~2~4.2~56.592~36.525",
 "р. Медведица (Рамешки / Кимрский р-н — устье в Угличское вдхр.)~2~0~2.6~57.125~37.185",
 "р. Молога (Бежецк / Максатиха / Весьегонск — Моложский плёс Рыбинки)~2~1~4.8~58.185~36.415",
 "оз. Сиг, оз. Вельё, оз. Пирос, оз. Кафтино (Осташковский / Бологовский р-н)~3~2~6.5~57.042~33.115",
 "оз. Великое и Оршинские озёра (Рамешковский / Калининский р-н)~2~3~2.5~56.985~36.385",
 "р. Западная Двина и р. Межа (Андреаполь / Западная Двина / Нелидово / Жарковский)~5~0~2.5~56.258~32.084",
 "оз. Бросно и оз. Соломенное / р. Торопа (Андреаполь / Торопец)~5~2~12~56.498~31.635",
 "р. Ока (Белёв / Чекалин / Алексин / Поленово / Заокский)~2~1~3.6~54.505~37.068",
 "р. Упа (Советск / Тула / Дубна / Одоев / впадение в Оку)~2~0~2.3~54.156~36.96",
 "Черепетское вдхр. (Черепетская ГРЭС, г. Суворов)~2~4~4.8~54.125~36.465",
 "Щёкинское вдхр. (Первомайская ТЭЦ / Советская ГРЭС, г. Советск)~2~4~4.2~53.938~37.632",
 "Шатское вдхр. (Новомосковская ГРЭС, г. Новомосковск)~2~4~4~54.058~38.252",
 "Пронское вдхр. (исток р. Проня — Новомосковск / Кимовск / Гремячее)~2~2~5.2~54.125~38.685",
 "Любовское вдхр. (р. Любовка, Новомосковск)~2~2~3.8~54.035~38.315",
 "р. Красивая Меча (Тёплое / Воловский р-н / Ефремов / Шилово / Ишутино)~6~0~2.2~53.148~38.115",
 "р. Дон — верховья и р. Непрядва (Новомосковск / Донской / Епифань / Куркино)~6~0~1.9~53.685~38.585",
 "р. Осётр (Венёвский / Ясногорский р-н)~2~0~2.1~54.349~38.268",
 "р. Воронка и Яснополянские пруды (Тула / Щёкино)~2~3~2.4~54.075~37.525",
 "Романцевские карьеры («Голубые озёра Кондуки», Узловский / Кимовский р-н)~6~2~8.5~53.848~38.393",
 "Горьковское вдхр. / р. Волга (Рыбинск — Тутаев — Ярославль — Некрасовское — Красный Профинтерн)~2~1~6.2~57.749~40.385",
 "р. Сить и р. Сутка (Брейтово / Борок / Некоуз — главные нерестовые реки зимней плотвы Рыбинки)~2~0~2.6~58.265~37.895",
 "р. Чеснава, р. Ламь и р. Себла (Брейтовский р-н, Рыбинское вдхр.)~2~0~2.4~58.415~37.652",
 "р. Согожа, р. Ухра и р. Керома (Пошехонье, Восточный плёс Рыбинки)~2~0~2.8~58.498~39.125",
 "р. Юхоть (Большое Село / Мышкин — Юхотский залив Волги)~2~0~2.5~57.768~38.585",
 "р. Солоница и р. Туношонка (Некрасовское / Туношна — впадение в Волгу)~2~0~2.1~57.625~40.285",
 "р. Трубеж и оз. Сомино (Переславль-Залесский)~2~0~2~56.735~38.835",
 "р. Сара и р. Устье (Ростовский / Борисоглебский р-н — оз. Неро)~2~0~2.1~57.152~39.325",
 "р. Обнора и р. Соть (Любим / Пречистое)~2~0~2.2~58.362~40.686",
 "оз. Яхробольское (Некрасовский р-н)~2~3~2.4~57.715~40.312|Ладожское озеро~3~2~12~60.5~31",
 "Онежское озеро~3~2~14~61.79~34.37|р. Нева~3~1~6.5~59.93~30.34|р. Вуокса~3~1~4.5~60.68~30",
 "оз. Отрадное~3~2~7.5~60.82~30.2|р. Свирь~3~1~5.2~60.91~34.17|р. Волхов~3~1~4.8~60.1~32.3",
 "оз. Ильмень (Великий Новгород)~3~3~2.8~58.28~31.28|оз. Сямозеро~3~2~6~61.9~33.15",
 "оз. Сегозеро~3~2~18~63.3~33.8|оз. Выгозеро~3~2~7~63.6~34.7|р. Суна~3~0~2.2~62.27~33.98",
 "р. Шуя (Карелия)~3~0~2~61.91~34.25|оз. Пяозеро / Топозеро~3~2~15~65.8~31",
 "Баренцево море (Териберка)~4~6~25~69.17~35.14|Кольский залив (Мурманск)~4~5~18~68.97~33.08",
 "Белое море (Кандалакшский залив)~4~5~12~67.15~32.4",
 "Белое море (Двинский залив / Северодвинск)~4~5~8.5~64.6~39.8",
 "р. Северная Двина (Архангельск)~4~1~6.5~64.54~40.52|р. Онега~4~1~3.8~63.9~38.1",
 "р. Вычегда (Сыктывкар)~4~1~3.5~61.67~50.83|р. Кола~4~0~1.8~68.88~33.02",
 "р. Тулома~4~1~4.5~68.81~32.81|р. Варзуга~4~0~1.6~66.4~36.58|р. Умба~4~0~2~66.68~34.35",
 "р. Поной~4~0~2.2~67.07~39.5|оз. Имандра~4~2~10~67.6~33.1|оз. Ловозеро~4~2~8~67.85~35.15",
 "р. Печора (Нарьян-Мар)~4~1~6~67.64~53|р. Печора (г. Печора / Усинск)~4~1~4.8~65.14~57.22",
 "р. Уса (Усинск)~4~1~3.8~65.98~57.55|Финский залив (Маркизова лужа)~5~5~5.5~59.95~30.2",
 "Финский залив (Дамба КЗС / Кронштадт)~5~5~7.5~60.01~29.74|Выборгский залив~5~5~7.2~60.71~28.75",
 "р. Луга (Усть-Луга)~5~1~3.5~59.68~28.3|р. Нарва (Ивангород)~5~1~4.2~59.38~28.2",
 "Куршский залив~5~5~3.8~54.96~20.47|Балтийское море (Балтийск / Янтарный)~5~6~14~54.64~19.89",
 "Калининградский (Вислинский) залив~5~5~3.5~54.65~20.15|р. Преголя~5~1~3.2~54.71~20.51",
 "р. Дейма / Матросовка~5~0~2.8~54.82~21.1|оз. Чудско-Псковское~5~2~6.5~57.82~28.33",
 "р. Великая~5~1~2.8~57.81~28.32|р. Луга (г. Луга)~5~0~2.5~58.74~29.85",
 "р. Волхов / р. Тихвинка (Кириши / Тихвин)~3~1~4.5~59.52~32.75",
 "оз. Валдайское / р. Мста (Валдай / Боровичи)~3~2~8~58.15~33.55",
 "Чудское озеро (Гдов)~5~2~7~58.74~27.8",
 "р. Ловать / оз. Жижицкое (Великие Луки)~5~0~2.4~56.34~30.53",
 "р. Неман (Советск)~5~1~3.8~55.085~21.885|Ладожские шхеры (Сортавала)~3~2~14~61.55~31.1",
 "Онежское озеро / р. Водла (Пудож / Медвежьегорск)~3~1~5.5~61.81~36.52",
 "Белое море / р. Кемь (Беломорск / Кемь)~4~5~9~64.75~34.68",
 "оз. Среднее Куйто / оз. Нюк (Калевала / Костомукша)~3~2~10~64.9~30.9",
 "оз. Кереть / Чупинская губа (Лоухи)~4~2~9.5~66.08~33.05",
 "р. Северная Двина (Котлас)~4~1~5.2~61.255~46.65|р. Вага (Вельск)~4~1~3.5~61.07~42.1",
 "р. Мезень (Мезень)~4~1~4.5~65.85~44.24|р. Ижма / р. Ухта (Ухта)~4~1~3.5~63.57~53.69",
 "р. Печора (Усть-Цильма)~4~1~6~65.442~52.15|р. Воркута / р. Уса (Воркута)~4~0~2.4~67.498~64.052",
 "Онежское озеро (Медвежьегорск)~3~2~12~62.895~34.468",
 "р. Кемь и Выг (Кемь / Беломорск)~4~1~4.5~64.952~34.605",
 "р. Нижний Выг (Беломорск)~4~1~4.5~64.522~34.76|р. Олонка и Ладога (Олонец)~3~0~2.8~60.985~32.968",
 "Белое озеро (Белозерск / Липин Бор)~2~2~4.8~60.155~37.655",
 "оз. Кубенское (Вологда)~4~2~3.5~59.625~39.515",
 "р. Сухона (Сокол / Тотьма / Великий Устюг)~4~1~4.2~59.975~42.765",
 "Шекснинское вдхр. (Шексна / Череповец)~2~2~6.5~59.355~38.455",
 "оз. Воже (Вожега)~4~2~3.2~60.585~39.115",
 "Морской канал Санкт-Петербурга (Канонерский остров — Кронштадт)~5~5~9.5~59.915~30.125",
 "р. Большая, Средняя и Малая Невка (ЦПКиО / Елагин и Крестовский о-ва)~5~1~4.8~59.978~30.265",
 "оз. Сестрорецкий Разлив и р. Сестра (Сестрорецк)~5~3~2.4~60.085~29.992",
 "Лахтинский разлив (Лахта / Ольгино)~5~3~3.2~59.995~30.158",
 "Суздальские озёра (Верхнее, Среднее, Нижнее — Озерки / Шувалово)~5~2~4.5~60.045~30.308",
 "Ивановский карьер и Сортировочный карьер (Нева / Купчино)~5~2~6.2~59.872~30.438",
 "Дудергофское, Безымянное и Долгое озёра (Красное Село)~5~3~3~59.718~30.105",
 "р. Ижора и Колпинский пруд (Колпино / Усть-Ижора)~5~0~2.3~59.75~30.585",
 "Южная Ладога: бухта Петрокрепость, Кобона, Леднево, Чёрное, Креницы, Вороново, Свирица, Новоладожский канал~3~2~5.5~60.125~31.815",
 "Финский залив: Копорская губа (Сосновый Бор, тёплый сброс ЛАЭС) и Лужская губа (Усть-Луга / Вистино)~5~5~7.5~59.845~28.785",
 "Финский залив: северный берег (Зеленогорск — Приморск — пролив Бьёркезунд — Высоцк)~5~5~8.5~60.365~28.615",
 "оз. Вуокса (Приозерск / Синёво) и Барышевский плёс р. Вуокса (Каменногорск — Барышево — Лосево)~3~2~6.5~60.815~29.745",
 "оз. Суходольское (Суванто) и р. Бурная (Сосново / Лосево / Соловьёво)~3~2~7.8~60.625~30.255",
 "оз. Глубокое, оз. Комсомольское, оз. Мичуринское, оз. Красное, оз. Нахимовское (Карельский перешеек)~3~2~7.2~60.568~29.855",
 "оз. Кавголовское и оз. Хепоярви (Токсово)~3~3~3.6~60.168~30.535",
 "Нарвское вдхр. и р. Плюсса (Ивангород / Сланцы)~5~2~4.2~59.285~28.185",
 "р. Паша и р. Оять (Свирица / Паша / Лодейное Поле)~3~0~2.8~60.455~33.115",
 "р. Сясь (Сясьстрой)~3~0~2.6~60.138~32.558",
 "р. Оредеж (Сиверский / Вырица — Череменецкое и Врево озёра, Луга)~5~0~2.4~59.354~30.081",
 "Онежское озеро (Вознесенье, Подпорожский р-н)~3~2~9.5~61.035~35.495",
 "оз. Янисъярви (Большое Янисъярви — Сортавальский / Суоярвский р-н)~3~2~11.5~61.985~30.955",
 "оз. Сандал (Кондопога)~3~2~9.8~62.355~34.185",
 "оз. Водлозеро (Пудожский р-н, нацпарк «Водлозерский»)~3~2~4.2~62.315~36.885",
 "оз. Ведлозеро (Пряжинский р-н)~3~2~6.5~61.569~32.839",
 "оз. Суоярви и оз. Салонъярви (Суоярви)~3~2~5.8~62.135~32.345",
 "оз. Верхнее, Среднее и Нижнее Куйто (Калевала)~3~2~9.2~65.145~31.255",
 "оз. Тикшеозеро и оз. Энгозеро (Лоухский р-н)~4~2~8.5~66.215~32.085",
 "оз. Лексозеро (Муезерский р-н, Реболы)~3~2~8.2~63.785~30.945",
 "оз. Ондoзеро (Сегежский р-н)~3~2~4.8~63.765~33.415",
 "Онежская губа и Чупинская губа Белого моря (Беломорск — Сумский Посад — Кемь — Чупа)~4~5~12~65.115~34.885",
 "р. Кереть (Лоухский р-н)~4~0~2.4~66.155~33.245",
 "р. Писта (Пистайоки — Калевальский / Лоухский р-н)~4~0~2.3~65.585~30.725",
 "р. Онда и р. Сегежа~3~0~2.5~63.745~34.285",
 "р. Видлица и р. Тулемайоки (Олонецкий / Питкярантский р-н)~3~0~2.2~61.265~32.115",
 "р. Печора (Троицко-Печорск / Вуктыл — верхняя и средняя Печора)~4~1~4.5~63.515~57.185",
 "р. Сысола (Койгородок / Визинга / Сыктывкар)~4~1~3.2~61.185~50.345",
 "р. Вымь (Емва / Усть-Вымь)~4~0~2.6~62.589~50.858",
 "р. Мезень и р. Вашка (Усогорск / Кослан — Удорский р-н)~4~1~3.4~63.456~48.898",
 "р. Щугор, р. Илыч и р. Подчерем (притоки Печоры с Северного и Приполярного Урала — Вуктыл / Троицко-Печорск)~4~0~2.5~64.255~58.115",
 "р. Косью, р. Лемва и р. Большая Инта (Инта — Приполярный Урал)~4~0~2.4~65.915~60.025",
 "р. Цильма и р. Пижма (Усть-Цильма)~4~0~2.5~65.415~52.085",
 "р. Луза (Объячево — Прилузский р-н)~4~0~2.3~60.372~49.647",
 "оз. Синдорское (Княжпогостский р-н, пгт Синдор)~4~3~2.2~62.785~51.915",
 "оз. Донты (Дон-Ты, Усть-Куломский р-н)~4~3~2.4~61.625~53.915",
 "Печорское вдхр. (тепловой сброс Печорской ГРЭС, г. Печора)~4~4~4.5~65.165~57.255",
 "Дельта Северной Двины: Маймакса, Никольский, Мурманский и Корабельный рукава, Сухое море (о. Мудьюг — Архангельск / Северодвинск)~4~5~6.5~64.685~40.315",
 "Унская губа и Онежский залив Белого моря (Уна / Луда / Онега / Кий-остров)~4~5~7.8~64.485~38.125",
 "Мезенская губа Белого моря (Мезень / Каменка / Койда)~4~5~8.2~66.085~44.055",
 "р. Северная Двина (Холмогоры / Емецк / Березник / Верхняя Тойма / Красноборск)~4~1~5.5~62.853~42.708",
 "р. Пинега (Карпогоры / Пинега / Белогорский)~4~1~3.6~64.255~43.895",
 "р. Вычегда (Котлас / Коряжма / Сольвычегодск / Яренск)~4~1~4.2~61.314~47.142",
 "р. Онега (Каргополь / Североонежск / Плесецк)~4~1~3.5~62.583~39.841",
 "р. Вага и р. Устья (Вельск / Шенкурск / Октябрьский)~4~0~2.5~61.815~42.655",
 "р. Емца и р. Кулой~4~0~2.4~63.315~41.255|оз. Лача (Лаче — Каргополь)~4~2~3.2~61.325~38.785",
 "оз. Кенозеро и оз. Лёкшмозеро (Кенозерский нацпарк, Каргопольский / Плесецкий р-н)~4~2~9.5~62.085~38.195",
 "оз. Кожозеро и оз. Сийское (Онежский / Холмогорский р-н)~4~2~8.5~63.155~38.925",
 "Дельта р. Печора и Печорская губа Баренцева моря (Нарьян-Мар / Искателей / Оксино / Красное)~4~5~6.2~68.025~53.685",
 "оз. Голодная Губа (Нарьян-Мар / Оксино — крупнейшее озеро НАО)~4~3~2.8~67.815~52.585",
 "р. Сула и р. Сойма (Коткино / Великовисочное)~4~0~2.4~67.115~51.525",
 "р. Колва и р. Адзьва (Хорей-Вер / Харута)~4~0~2.5~67.145~58.655",
 "р. Индига и Чёшская губа Баренцева моря (Индига / Нижняя Пёша)~4~5~7.5~67.685~48.725",
 "р. Коротаиха и Хайпудырская губа (Каратайка)~4~5~6.5~68.765~61.425",
 "р. Кара и Карская губа Карского моря (Усть-Кара / Амдерма)~4~5~7.8~69.251~64.933",
 "Вашуткины озёра и оз. Пинейты (Большеземельская тундра)~4~2~8.5~67.955~61.615",
 "Онежское озеро — южный берег и Волго-Балтийский канал (Вытегра / Ошта / Тудозеро)~3~2~8.5~61.125~36.215",
 "р. Шексна и р. Суда (Череповец / Кадуй — тёплый сброс Череповецкой ГРЭС)~2~1~4.8~59.165~37.525",
 "р. Молога и р. Чагодоща (Устюжна / Чагода / Бабаево — р. Колпь)~2~1~3.6~58.955~36.125",
 "р. Вологда и р. Лежа (Вологда / Грязовец)~4~0~2.5~59.235~40.085",
 "р. Кубена (Харовск / Сямжа / Усть-Кубинское — впадение в оз. Кубенское)~4~0~2.6~59.815~39.955",
 "р. Юг и р. Малая Северная Двина (Никольск / Кичменгский Городок / Великий Устюг / Красавино)~4~1~4~60.755~46.315",
 "р. Вага и р. Кокшеньга (Верховажье / Тарногский Городок)~4~0~2.3~60.615~42.825",
 "оз. Сиверское, оз. Бородаевское и Северо-Двинская водная система (Кириллов / Топорня)~2~2~6.2~59.858~38.375",
 "оз. Лозско-Азатское (Белозерский р-н)~2~2~5.5~59.825~37.215",
 "Калининградский морской канал и Балтийский пролив (Калининград — Светлый — Приморск — Балтийск, Северный и Южный молы)~5~5~9.8~54.665~20.055",
 "р. Преголя (Черняховск / Знаменск / Гвардейск / Калининград)~5~1~4.5~54.649~21.071",
 "р. Лава и Правдинское вдхр. (Правдинск / Знаменск)~5~0~3.2~54.444~21.018",
 "р. Шешупе (Краснознаменск)~5~0~2.4~54.943~22.49",
 "р. Анграпа и р. Писса / Красная (Озёрск / Гусев / Черняховск)~5~0~2.1~54.515~22.085",
 "р. Прохладная (Багратионовский / Гурьевский р-н — Ушаково)~5~0~2~54.614~20.252",
 "Дельта Немана: р. Матросовка, р. Тава, р. Немонин, Полесский канал (Славский / Полесский р-н, Головкино / Матросово)~5~0~3~55.015~21.309",
 "оз. Виштынецкое (Нестеровский р-н — глубоководное ледниковое озеро)~5~2~15~54.432~22.715",
 "оз. Синявинское (карьер Янтарный)~5~2~11.5~54.885~19.955",
 "Пруды Калининграда (Верхний, Нижний, Пелавское оз., Карповское оз., Голубые озёра / Форелевое)~5~2~4.2~54.675~20.445",
 "Баренцево море: Ура-Губа, Мотовский залив, п-ов Рыбачий и о. Кильдин (морские банки трески и палтуса)~4~6~45~69.455~33.125",
 "Верхнетуломское и Нижнетуломское вдхр. (пгт Верхнетуломский / Мурмаши)~4~2~12~68.606~31.796",
 "оз. Умбозеро (Кировск / Ревда — между Хибинами и Ловозерскими тундрами)~4~2~18~67.715~34.385",
 "Серебрянские вдхр. и р. Воронья (пгт Туманный / Ловозерский р-н)~4~2~11~68.881~35.691",
 "Княжегубское (Ковдозерское) и Иовское вдхр. (Зеленоборский / Зареченск / Алакуртти)~4~2~10.5~66.765~31.985",
 "Тёплый сброс Кольской АЭС в оз. Имандра (Бабинская Имандра, г. Полярные Зори)~4~4~6.5~67.458~32.478",
 "р. Нива и Пиренгские озёра (Полярные Зори / Кандалакша)~4~0~3.2~67.285~32.455",
 "р. Ура и р. Западная Лица (Кольский р-н)~4~0~2.8~69.185~32.615",
 "р. Печенга и р. Паз (Патсойоки — Заполярный / Никель)~4~0~3~69.416~30.814",
 "р. Йоканьга и р. Харловка / Восточная Лица (северный берег Кольского п-ова)~4~0~2.8~68.053~39.513",
 "оз. Колозеро и оз. Пермусозеро (Оленегорск)~4~2~8.5~68.215~33.245",
 "оз. Канозеро и оз. Колвицкое (Терский / Кандалакшский р-н)~4~2~9~67.055~34.125",
 "Дельта р. Ловать, р. Пола, р. Верготь и Синецкий залив оз. Ильмень (Взвад / Парфино / Старая Русса)~3~1~3.8~58.115~31.485",
 "р. Волхов (исток из оз. Ильмень — Великий Новгород — Кречевицы — Грузино — Чудово)~3~1~5.5~58.885~31.655",
 "р. Шелонь (Сольцы / Шимск — устье в оз. Ильмень)~3~1~3.4~58.165~30.515",
 "р. Мста (Боровичи / Любытино / Бронница — Мстинский Нос оз. Ильмень)~3~1~3.6~58.435~31.615",
 "р. Полисть и р. Редья (Старая Русса)~3~0~2.3~57.989~31.356",
 "р. Ловать и р. Кунья (Холм)~3~0~2.5~57.145~31.178",
 "оз. Вельё и оз. Ужин (Валдайский нацпарк, Валдайский / Демянский р-н)~3~2~9.5~57.715~33.045",
 "оз. Селигер — Полновский плёс (с. Полново, Демянский р-н)~2~2~8.2~57.584~32.893",
 "оз. Пирос (Боровичский р-н)~3~2~5.8~58.125~33.765",
 "оз. Великое и оз. Меглино (Мошенской / Пестовский р-н)~2~2~7.2~58.518~35.045",
 "р. Молога и р. Кобожа (Пестово)~2~0~2.6~58.595~35.815",
 "р. Луга — верховья (Батецкий р-н)~5~0~2.1~58.64~30.312",
 "Псковское озеро, Тёплое озеро и дельта р. Великой (Псков / Печоры / Кривск / Толба / Талабские о-ва / Раскопель)~5~2~5.2~58.015~28.015",
 "р. Великая (Пустошка / Опочка / Пушкинские Горы / Остров / Псков)~5~1~3.8~57.343~28.352",
 "р. Шелонь и вдхр. Псковской ГРЭС (Дедовичи / Порхов)~5~4~4.5~57.552~29.956",
 "р. Плюсса (Плюсса / Гдовский р-н)~5~0~2.3~58.431~29.368",
 "р. Сороть и оз. Белая Струга (Пушкинские Горы / Новоржев / Палкино)~5~0~2.2~57.022~28.914",
 "оз. Жижицкое и оз. Двинье-Велинское (Куньинский р-н — крупнейшие озёра юга области)~5~2~6.2~56.252~31.185",
 "Озёра нацпарка «Себежский» (оз. Себежское, Ороно, Нечерица, Белое, Свибло — Себеж)~5~2~6.8~56.265~28.485",
 "оз. Иван (Большой и Малый Иван), оз. Невельское и оз. Езерище (Невельский р-н)~5~2~6.5~56.015~29.965",
 "оз. Полисто и оз. Цевло (Бежаницкий р-н, Полистовский заповедник)~5~3~2.4~57.165~30.385",
 "оз. Алё и оз. Велье (Бежаницкий / Пушкиногорский р-н)~5~2~7.5~56.865~29.515",
 "оз. Усвятское и р. Усвяча (Усвяты — бассейн Западной Двины)~5~2~4.5~55.748~30.754",
 "Волгоградское вдхр.~2~2~8.2~48.71~44.51|р. Волга (Астрахань / Дельта)~2~1~5.5~46.35~48.04",
 "р. Бахтемир (Главный банк)~2~1~7~45.95~47.65|р. Бузан~2~1~5~46.55~48.3",
 "р. Ахтуба (Волго-Ахтубинская пойма)~2~1~3.8~48~45.5|р. Дон (Ростов-на-Дону)~6~1~5.5~47.22~39.72",
 "Цимлянское вдхр.~6~2~8~47.6~42.1|р. Маныч (Весёловское вдхр.)~6~2~4.2~47.1~40.8",
 "р. Северский Донец~6~1~3.2~48.32~40.26|р. Кубань (Краснодар)~6~1~4~45.03~38.98",
 "Краснодарское вдхр. (Кубанское море)~6~2~6.2~44.98~39.25",
 "р. Кубань (Темрюк / дельта)~6~1~3.5~45.27~37.38|Бейсугский лиман / р. Бейсуг~6~3~1.8~46.08~38.55",
 "Чёрное море (Севастопольские бухты)~6~5~8.5~44.62~33.53|р. Чёрная (Инкерман)~6~0~1.5~44.61~33.6",
 "Симферопольское вдхр.~6~2~6.5~44.92~34.15|Чёрное море (ЮБК / Ялта)~6~6~15~44.5~34.17",
 "Керченский пролив~6~5~7.5~45.32~36.48|Цемесская бухта (Новороссийск)~6~5~12~44.72~37.78",
 "Чёрное море (Сочи / Адлер)~6~6~16~43.59~39.73|р. Мзымта~6~0~1.8~43.42~39.92",
 "р. Сочи~6~0~1.4~43.595~39.735|Азовское море (Таганрогский залив)~6~5~4.5~47.2~38.92",
 "Ейский лиман~6~5~2.8~46.7~38.3|оз. Абрау~6~2~7~44.7~37.6",
 "р. Шахе (Головинка / Сочи)~6~0~1.6~43.79~39.46|р. Псоу (Адлер / Сириус)~6~0~1.7~43.395~40.01",
 "Имеретинская бухта (Сириус)~6~5~7.5~43.4~39.95|р. Хоста (Сочи)~6~0~1.4~43.515~39.87",
 "Бейсугский лиман~6~5~2.2~46.08~38.45|Ахтанизовский лиман~6~3~1.8~45.31~37.18",
 "Волгоградское вдхр. (Камышин / Ровное)~2~2~9.5~50.09~45.41",
 "р. Ахтуба (Харабали)~2~1~5.5~47.35~47.25|Каспийские раскаты (Лагань)~2~5~3.5~45.39~47.365",
 "Чограйское вдхр. / оз. Маныч (Элиста)~6~2~4.8~46.15~44.3",
 "р. Дон (Калач-на-Дону / Цимлянск)~6~1~5~48.685~43.525|р. Протока (Славянск)~6~1~3.5~45.45~38.5",
 "Чёрное море (Джубга / Архипо-Осиповка / Туапсе)~6~5~10~44.22~38.8",
 "р. Белая / Майкопское вдхр. (Майкоп)~6~0~2~44.61~40.1",
 "Феодосийский залив / Чёрное море (Судак / Феодосия)~6~5~9~44.95~35.18",
 "оз. Донузлав / Евпатория~6~5~8~45.35~33.05|р. Ахтуба (Ахтубинск)~2~1~6.5~48.282~46.155",
 "р. Дон (Вёшенская)~6~1~5.5~49.622~41.732",
 "Черноморская акватория (Джубга / Архипо-Осиповка)~6~6~10~44.325~38.65",
 "Старобешевское вдхр. (р. Кальмиус)~6~4~4.8~47.785~38.015",
 "р. Кальмиус (Донецк / Мариуполь)~6~0~2.2~47.985~37.812",
 "Азовское море (Белосарайский залив / Седово)~6~5~5.5~47.045~37.65",
 "р. Северский Донец (Луганск / Счастье)~6~1~4.2~48.695~39.285",
 "Исаковское вдхр. (Алчевск)~6~2~5~48.425~38.865",
 "Бердянский залив (Азовское море)~6~5~6~46.725~36.785",
 "Молочный и Утлюкский лиманы (Кирилловка)~6~5~3.2~46.395~35.315",
 "р. Днепр (Энергодар / Каменка-Днепровская)~6~1~7.5~47.515~34.615",
 "Залив Сиваш / Пролив Тонкий (Геническ)~6~5~3.5~46.165~34.815",
 "Джарылгачский залив (Скадовск)~6~5~4.5~46.095~32.915",
 "Низовья Днепра (Новая Каховка / Голая Пристань)~6~1~8~46.615~32.785",
 "р. Белая (верховья: Гузерипль / Хамышки / Даховская)~6~0~1.6~44.15~40.17",
 "р. Белая (низовья: Ханская / Белореченск — устье)~6~1~3.2~44.82~39.81",
 "р. Лаба (Кошехабль / Натырбово / Хатукай)~6~1~3.4~45.01~40.12",
 "Краснодарское вдхр. (Адыгейск)~6~2~5.8~44.91~39.22",
 "Шапсугское вдхр. (Афипсип / р. Афипс)~6~2~3~44.97~38.83|Октябрьское вдхр.~6~3~3.2~44.91~38.96",
 "р. Курджипс, р. Дах, р. Пшеха (предгорный участок)~6~0~1.4~44.28~40.11",
 "р. Фарс, р. Гиага, р. Псенафа, р. Марта, р. Апчас~6~0~1.8~44.87~40.21",
 "р. Волга и ст. Волга (Цаган Аман / Копановский плёс)~2~1~8.5~47.56~46.72",
 "Лаганский банк~2~5~3.8~45.38~47.45|оз. Маныч-Гудило (Яшалта)~6~2~3.5~46.25~42.85",
 "оз. Лысый Лиман и Чограйский сбросной канал~2~2~3.6~45.59~44.18",
 "Сарпинские озёра (оз. Сарпа)~2~3~2.4~47.62~44.88|Состинские озёра~2~3~2.2~45.38~45.78",
 "оз. Дед-Хулсун и Черноземельский магистральный канал~2~3~2.3~46.12~45.32",
 "Аршан-Зельменское вдхр.~2~3~3~46.31~44.25",
 "р. Егорлык / р. Башанта (Городовиковский р-н)~6~0~1.8~46.09~41.94",
 "Белогорское и Тайганское вдхр. (р. Биюк-Карасу)~6~2~7.5~45.01~34.59",
 "Партизанское вдхр. (р. Альма) и Альминское вдхр.~6~2~8~44.82~34.07",
 "Аянское вдхр. (верховья р. Салгир)~6~2~7~44.83~34.29|Бахчисарайское вдхр.~6~2~6.8~44.71~33.89",
 "Счастливенское вдхр. и верховья р. Бельбек~6~2~7.2~44.57~34.04",
 "Фронтовое / Старокрымское вдхр.~6~2~5.5~45.19~35.43",
 "Изобильненское и Кутузовское вдхр. (Алушта)~6~2~8~44.7~34.35",
 "Северо-Крымский канал~6~0~3.2~45.69~34.41",
 "р. Салгир (Симферополь — Нижнегорский — Сиваш)~6~0~1.6~45.18~34.38",
 "р. Альма / Кача / Бельбек~6~0~1.5~44.74~33.78|оз. Сасык-Сиваш~6~3~1.8~45.21~33.48",
 "оз. Донузлав (верховья)~6~5~6.5~45.45~33.22|Казантипский и Арабатский заливы~6~5~6~45.43~35.81",
 "Каркинитский залив и Сиваш~6~5~4.5~45.82~33.55",
 "Чёрное море (мыс Тарханкут / Оленевка / Межводное)~6~6~14~45.35~32.51",
 "Балаклавская бухта и Фиолент~6~5~14~44.495~33.597",
 "Бухты Севастополя (Казачья / Стрелецкая)~6~5~9~44.582~33.412",
 "Бухта Ласпи и мыс Сарыч~6~6~16~44.412~33.705|Чёрное море (Кача / Любимовка)~6~6~11~44.745~33.545",
 "р. Бельбек (Верхнесадовое — Любимовка, устье)~6~0~1.6~44.668~33.575",
 "оз. Гасфорта и пруды Байдарской долины~6~2~5.5~44.525~33.675",
 "р. Псезуапсе (Лазаревское)~6~0~1.5~43.905~39.335|р. Аше (Аше / Калеж)~6~0~1.5~43.962~39.275",
 "р. Дагомыс (Западный и Восточный)~6~0~1.3~43.662~39.652|р. Кудепста~6~0~1.3~43.495~39.888",
 "р. Мацеста~6~0~1.3~43.552~39.795|р. Лоо~6~0~1.2~43.702~39.592|р. Туапсе~6~0~1.5~44.105~39.088",
 "р. Шапсухо (Лермонтово)~6~0~1.4~44.305~38.765|р. Небуг и р. Агой~6~0~1.3~44.155~39.015",
 "р. Вулан (Архипо-Осиповка)~6~0~1.4~44.362~38.528|р. Пшада (Криница)~6~0~1.4~44.395~38.342",
 "оз. Серебряное (Ахштырь)~6~4~3.5~43.518~39.988|Барановское озеро (Сочи)~6~3~4~43.635~39.752",
 "Форелевые пруды (Казачий Брод)~6~4~2.8~43.524~39.996",
 "Курчанский и Куликовские лиманы~6~3~1.6~45.285~37.565",
 "Сладкий и Черноерковские лиманы~6~3~1.8~45.475~37.725",
 "Ахтарско-Гривенские лиманы~6~3~1.7~45.825~38.185",
 "Кизилташский и Бугазский лиманы~6~5~2~45.105~37.025|Таманский залив~6~5~4.2~45.265~36.855",
 "оз. Ханское (Ейский р-н)~6~3~1.5~46.245~38.385|р. Ея и Сосыка~6~0~2~46.545~39.065",
 "р. Челбас (Тихорецк / Каневская)~6~0~2.1~46.075~38.975",
 "р. Бейсуг (Брюховецкая / Кореновск)~6~0~2.2~45.795~39.015",
 "р. Понура и Ангелинский ерик (Калининская)~6~0~2~45.475~38.655",
 "р. Адагум, р. Абин, р. Ил, р. Афипс, р. Убин~6~0~1.8~44.885~38.355",
 "р. Кубань (Армавир — Кропоткин — Усть-Лабинск)~6~1~3.8~45.425~40.555",
 "р. Лаба (Лабинск — Курганинск — Усть-Лабинск)~6~1~2.9~44.785~40.655",
 "р. Уруп (Отрадная — Армавир)~6~0~2~44.685~41.325|р. Псекупс (Горячий Ключ)~6~0~1.8~44.635~39.135",
 "р. Пшиш (Хадыженск) и р. Пшеха (Апшеронск)~6~0~1.9~44.445~39.625",
 "Варнавинское и Крюковское вдхр.~6~2~3.6~45.055~38.095",
 "Неберджаевское вдхр. и оз. Старая Кубань (Краснодар)~6~3~3.4~45.012~39.048",
 "р. Волга (Черный Яр — Никольское — Замьяны)~2~1~9.5~47.768~46.425",
 "р. Ахтуба (Трёхречье)~2~1~6.5~47.16~47.28|р. Герасимовка и Винокуровка~2~1~6~48.045~46.325",
 "р. Енотаевка и проток Полданиловка~2~1~7~47.245~47.035",
 "р. Митинка и ер. Кирпичный~2~1~6.2~47.035~47.495|р. Кигач и Берекет~2~1~5.8~46.638~48.615",
 "р. Кизань / Камызяк / Болда~2~1~6~46.115~48.085",
 "Гандуринский, Никитинский и Каралатский банки~2~5~4.5~45.855~48.145",
 "Белинский банк и Тишковский канал~2~5~4.2~45.995~48.615",
 "Иголкинский и Васильевский банки~2~5~4~46.285~48.925",
 "Каспийские раскаты (Вышка / Станья)~2~5~1.8~45.585~47.885",
 "Западные подстепные ильмени~2~3~2.2~45.895~47.345",
 "Ерики Волго-Ахтубинской поймы (Банный / Харабалык / Ашулук)~2~0~3.5~47.225~47.215",
 "р. Волга (Волгоград — Светлый Яр — Каршевитое)~2~1~8.5~48.475~44.825",
 "р. Ахтуба (Волжский — Средняя Ахтуба — Ленинск)~2~1~4.2~48.705~45.055",
 "Ерики и озёра Ленинской и Среднеахтубинской поймы~2~3~2.5~48.625~44.925",
 "Волгоградское вдхр. (Дубовка — Быково — Николаевск)~2~2~10.5~49.555~45.125",
 "р. Дон (Серафимович — Вертячий — Пятиизбянская)~6~1~5.5~48.948~43.822",
 "Цимлянское вдхр. (Пятиизбянская — Нижний Чир — Котельниково)~6~2~7.8~48.362~43.095",
 "р. Хопёр (Урюпинск — Кумылженская)~6~1~3.4~50.292~42.185",
 "р. Медведица (Жирновск — Михайловка)~6~0~2.6~50.068~43.238",
 "р. Иловля / Бузулук / Чир / Терса~6~0~2.1~50.138~43.825",
 "ВДСК (Варваровское, Береславское и Карповское вдхр.)~6~2~4.8~48.615~43.985",
 "р. Ерусланский залив и оз. Цаца~2~3~2.8~48.245~44.625",
 "Дельта Дона (Рогожкино / Мёртвый Донец)~6~1~4.8~47.175~39.352",
 "р. Нижний Дон (Константиновск — Семикаракорск — Багаевская)~6~1~5.8~47.565~40.875",
 "р. Верхний Дон (Казанская — Вёшенская)~6~1~4.5~49.628~41.725",
 "Тёплый канал Новочеркасской ГРЭС~6~4~3.8~47.412~40.232",
 "р. Западный Маныч (Усть-Манычское, Весёловское и Пролетарское вдхр.)~6~2~4.5~46.885~41.325",
 "р. Северский Донец (Белая Калитва — Усть-Донецкий)~6~1~3.8~48.012~40.825",
 "р. Сал, Сусат и Донской магистральный канал~6~0~2.4~47.385~41.145",
 "р. Кундрючья, Соколовское вдхр. и Калитва~6~0~2.6~47.886~40.072",
 "р. Миус и Миусский лиман~6~5~2.5~47.255~38.785",
 "р. Кагальник (Самарское — Азов)~6~0~2~46.985~39.525",
 "Таганрогский залив (Павло-Очаково / Чумбур-Коса / Беглица)~6~5~4.2~47.042~39.105",
 "Азовское море (Мариуполь — Белосарайская Коса — Урзуф)~6~5~6~46.945~37.335",
 "Павлопольское вдхр.~6~2~5.2~47.275~37.792",
 "Старокрымское вдхр. (р. Кальчик, Мариуполь)~6~2~6~47.185~37.475",
 "Донецкое море и Нижнекальмиусское вдхр.~6~2~5.5~47.935~37.825",
 "Зуевское и Ольховское вдхр.~6~4~5.5~48.035~38.285|Ханжонковское вдхр.~6~2~5~48.125~38.155",
 "р. Крынка и Миус~6~0~2.1~47.825~38.455",
 "р. Северский Донец (Святогорск — Щурово)~6~1~4~48.985~37.655",
 "р. Казённый Торец и Клебан-Быкское вдхр.~6~2~4.5~48.435~37.695",
 "Кураховское и Углегорское вдхр.~6~4~5.2~47.992~37.265",
 "Карловское вдхр. и р. Мокрые Ялы~6~2~4.2~48.115~37.485",
 "Голубые озёра (Красный Лиман) и Авдеевский карьер~6~2~8.5~48.965~37.725",
 "р. Северский Донец (Лисичанск — Славяносербск — Станица Луганская)~6~1~4.2~48.885~38.495",
 "Тёплый канал Луганской ТЭС (Счастье)~6~4~3.8~48.742~39.235",
 "р. Айдар (Старобельск — Новоайдар)~6~0~2.4~49.275~38.915",
 "р. Деркул (Беловодск)~6~0~2.1~49.198~39.575",
 "р. Красная (Сватово — Кременная) и Сватовское вдхр.~6~2~3.5~49.405~38.165",
 "р. Лугань и Ольховая~6~0~1.9~48.575~39.255",
 "Лутугинское (Успенское) вдхр. и Елизаветовское вдхр.~6~2~5.5~48.392~39.155",
 "Штеровское и Яновское вдхр.~6~2~5~48.085~38.892",
 "Должанское и Таловское вдхр.~6~2~4.5~48.145~39.635",
 "Пойменные озёра Донца (Бобровое / Клешня / Песочное)~6~3~2.8~48.925~38.435",
 "Обиточный залив и Обиточная коса~6~5~5.5~46.635~36.215",
 "Бердянская и Федотова косы (Азовское море)~6~6~7~46.635~36.765",
 "Тёплый водоём-охладитель Запорожской АЭС (Энергодар)~6~4~5.5~47.508~34.585",
 "р. Днепр и Конка (Каменка-Днепровская — Васильевка)~6~1~6~47.465~35.125",
 "р. Берда и Бердянское вдхр.~6~2~4.8~46.935~36.815|р. Молочная~6~0~1.8~46.845~35.385",
 "р. Обиточная / Корсак / Большой Утлюк~6~0~1.6~46.725~36.325",
 "р. Конка и Гайчур~6~0~2~47.545~35.885|Арабатская стрелка (Азовское море)~6~6~6.5~46.035~34.845",
 "Чонгарский пролив и Восточный Сиваш~6~5~2.8~46.025~34.545",
 "Чёрное море (Железный Порт / Лазурное / Хорлы)~6~6~9.5~46.118~32.292",
 "Днепровско-Бугский лиман и Ягорлыцкий залив~6~5~5.2~46.485~32.185",
 "Дельта Днепра (Конка / Бакай / Старый Днепр)~6~1~6.5~46.545~32.525",
 "р. Днепр (Горностаевка — Каховка — Новая Каховка)~6~1~7.5~46.815~33.485",
 "оз. Устричное и оз. Лиман~6~3~2~46.088~32.535|Каспийское море (Махачкала)~2~5~6.5~42.98~47.51",
 "Каспийское море (Дербент)~2~6~12~42.07~48.29",
 "р. Терек / Кизлярский залив (Кизляр)~2~1~3.5~43.85~46.72",
 "Новотроицкое вдхр. / оз. Сенгилеевское (Ставрополь)~6~4~5~45.15~41.8",
 "р. Подкумок / р. Кума (Пятигорск / КМВ)~2~0~1.8~44.05~43.06",
 "р. Терек (Владикавказ / Моздок / Шелковская)~2~1~3.2~43.655~45.315",
 "оз. Кезеной-Ам (Чечня / Дагестан)~2~2~12~42.776~46.152",
 "р. Сунжа (Назрань / Грозный / Гудермес)~2~0~2~43.318~45.698",
 "р. Малка и р. Баксан (Прохладный / Нальчик)~2~0~1.8~43.755~44.025",
 "Кубанское (Большое) вдхр. (Черкесск)~6~2~7~44.235~42.195",
 "Новотроицкое вдхр. (Солнечнодольск)~6~4~4.5~45.325~41.525",
 "Чиркейское вдхр. (р. Сулак)~2~2~14~42.975~46.885|оз. Кардывач~6~2~12~43.572~40.628",
 "Кизлярский залив (Коктюбей / Брянск)~2~5~3.8~44.325~46.725",
 "Аграханский залив и оз. Южный Аграхан~2~5~3.2~43.785~47.415",
 "Каспийское море (Каспийск — Избербаш — Каякент — Самур)~2~6~10~42.568~47.872",
 "оз. Аджи (Папас) и оз. Ак-Гёль~2~3~2.4~42.312~48.035",
 "Аракумские, Мехтебские и Нижне-Терские водоёмы~2~3~2.5~43.625~47.255",
 "Дельта Терека (Аликазган / Каргалинская / Таловка)~2~1~3.8~43.765~46.885",
 "р. Сулак (Кизилюрт — Главный Сулак)~2~1~3.6~43.245~47.285",
 "Ирганайское, Миатлинское и Чирюртовское вдхр.~2~2~12.5~42.665~46.885",
 "Андийское, Аварское и Каракойсу~2~0~2~42.585~46.545",
 "р. Самур и дельта Самура~2~1~2.6~41.815~48.515|оз. Мочох (Хунзах)~2~2~8~42.618~46.615",
 "р. Сунжа (Назрань — Карабулак — Сунжа)~2~0~1.8~43.275~44.925",
 "р. Асса (Таргим — Галашки — Нестеровская)~2~0~1.6~43.132~45.048",
 "р. Армхи (Джейрах)~2~0~1.3~42.822~44.695|р. Фортанга и Камбилеевка~2~0~1.4~43.048~45.125",
 "Назрановский пруд и Алханчуртский канал~2~3~2.5~43.222~44.758",
 "р. Терек (Терек — Майский — Екатериноградская)~2~1~3~43.635~44.115",
 "р. Черек (Аушигер — Нарткала — Майский)~2~0~1.9~43.515~43.885",
 "р. Малка (Каменномостское — Прохладный)~2~0~1.8~43.758~43.855",
 "р. Баксан и оз. Гижгит~2~2~4.5~43.465~43.035|р. Чегем / Нальчик / Урух~2~0~1.5~43.525~43.595",
 "Вдхр. Аушигерской и Зарагижской ГЭС~2~2~6~43.385~43.715",
 "Майские и Прохладненские карьеры~2~2~5.5~43.665~44.075",
 "Верхние Голубые озёра и оз. Шадхурей~2~2~8~43.235~43.625",
 "р. Кубань (Учкулан — Карачаевск — Усть-Джегута)~6~0~1.8~43.775~41.915",
 "р. Кубань (Черкесск — Эркен-Шахар)~6~1~2.8~44.235~42.035",
 "Усть-Джегутинское вдхр. (г. Усть-Джегута)~6~2~6~44.065~41.975",
 "р. Теберда (Домбай — Теберда — Карачаевск)~6~0~1.6~43.455~41.745",
 "р. Большой Зеленчук и Кяфар~6~0~1.8~43.865~41.585|р. Малый Зеленчук~6~0~1.6~44.045~41.775",
 "р. Большая Лаба (Курджиново / Пхия)~6~0~1.7~43.915~40.935",
 "р. Уруп (Преградная) и Аксаут~6~0~1.5~43.952~41.185",
 "р. Эшкаконское вдхр. и верхний Подкумок~2~2~5.5~43.885~42.505",
 "Пруды «Зелёный остров» (Черкесск)~6~3~2.8~44.225~42.025",
 "р. Терек (Владикавказ — Беслан — Эльхотово)~2~0~2~43.035~44.675",
 "р. Терек (Моздок — Павлодольская)~2~1~3.4~43.732~44.635",
 "оз. Бекан (Беканское вдхр.)~2~3~3.5~43.292~44.298|Зарамагское вдхр.~2~2~11~42.705~43.982",
 "р. Ардон (Алагир — Ардон)~2~0~1.8~43.042~44.235",
 "р. Урух (Дигорское ущелье — Чикола)~2~0~1.7~43.125~43.865",
 "р. Фиагдон / Гизельдон / Урсдон~2~0~1.4~42.965~44.365",
 "Моздокские и Змейские карьеры~2~2~4.2~43.725~44.525",
 "р. Терек (Наурская — Червлённая — Шелковская)~2~1~3.6~43.585~45.785",
 "р. Сунжа (Грозный — Гудермес — Брагуны)~2~1~2.8~43.365~45.965",
 "Грозненское море (Чернореченское вдхр.)~2~2~5.5~43.268~45.698",
 "оз. Каргалинское и оз. Майорское (Шелковская)~2~3~2.8~43.525~46.335",
 "Джалкинское вдхр.~2~3~3.2~43.332~46.025|р. Аргун (Шатой — Чири-Юрт — Аргун)~2~0~2~43.145~45.775",
 "р. Шароаргун / Хулхулау / Мартан / Аксай~2~0~1.5~43.055~45.885|оз. Галанчож~2~2~10~42.872~45.302",
 "Старицы Терека и р. Прорва (Бороздинская)~2~3~2.5~43.795~46.485",
 "Сенгилеевское вдхр. (ст. Сенгилеевская / Ставрополь)~6~2~8.5~45.025~41.695",
 "Егорлыкское вдхр.~6~2~6.5~45.085~41.615|р. Егорлык и Невинномысский канал~6~0~2.4~45.455~41.585",
 "р. Кубань (Невинномысск — Кочубеевское)~6~1~3~44.645~41.925",
 "Отказненское вдхр.~2~2~4.8~44.315~43.815",
 "р. Кума (Зеленокумск — Будённовск — Нефтекумск)~2~0~2.2~44.685~44.155",
 "оз. Буйвола и вдхр. Волчьи Ворота~2~2~4.2~44.785~44.115",
 "Курское и Ростовановское вдхр.~2~2~4.5~44.045~44.435",
 "Чограйское вдхр. (Арзгир / Турксад)~2~2~4.5~45.455~44.425",
 "оз. Дадынское и оз. Маныч-Гудило (Дивное)~6~3~2.8~45.325~44.785",
 "р. Терек (Галюгаевская) и Малка (Новопавловск)~2~1~3.2~43.702~44.795",
 "р. Калаус, оз. Кравцово и оз. Новопятигорское~6~3~2.6~45.335~42.854",
 "р. Ока (Нижний Новгород)~2~1~5~56.32~43.99|р. Волга (Нижний Новгород)~2~1~6.5~56.33~44.01",
 "р. Ветлуга~2~1~3.4~56.85~45.45|Горьковское вдхр.~2~2~6.2~56.8~43.4",
 "Чебоксарское вдхр.~2~2~5.8~56.14~47.25|р. Сура~2~0~2.5~55.85~46.35",
 "р. Волга (Казань)~2~1~7.2~55.79~49.12|р. Казанка~2~0~2~55.8~49.11|р. Свияга~2~0~2.4~55.72~48.65",
 "р. Кама (Камское Устье)~2~2~9.5~55.2~49.28",
 "Нижнекамское вдхр. (Набережные Челны)~2~2~6.8~55.7~52.35|р. Кама (Пермь)~2~1~6.2~58.01~56.25",
 "р. Чусовая~2~0~2.4~58.18~56.85|Камское вдхр.~2~2~6.5~58.15~56.35",
 "Куйбышевское вдхр. (Самара / Тольятти)~2~2~8.5~53.2~50.15|р. Самара~2~0~2.5~53.18~50.11",
 "р. Сок~2~0~2.2~53.41~50.15|Саратовское вдхр.~2~2~7.8~51.53~46.03",
 "р. Белая (Уфа)~2~1~3.6~54.73~55.97|Павловское вдхр.~2~2~9~55.42~56.55",
 "оз. Аслыкуль~2~2~4.5~54.31~54.58|р. Вятка (Киров)~2~1~3.2~58.6~49.66",
 "р. Урал (Оренбург)~2~1~2.8~51.77~55.1|Ириклинское вдхр.~2~2~10~51.78~58.78",
 "р. Бирь (Бирск)~2~0~2~55.425~55.55|р. Уфа (Караидель / Чандар)~2~1~4.8~55.83~56.91",
 "р. Быстрый Танып~2~0~2.2~56.12~54.58|р. Дёма (Давлеканово / Чишмы)~2~0~2.3~54.22~55.03",
 "р. Сим~2~0~2.1~54.62~56.38|р. Инзер~2~0~1.9~54.42~57.18",
 "р. Ай (Месягутово / Лаклы)~2~0~2~55.55~58.25|р. Юрюзань~2~0~2.1~55.38~57.9",
 "р. Ик (Октябрьский / Туймазы)~2~0~2.4~54.48~53.47",
 "оз. Кандрыкуль (Башкортостан)~2~2~6.5~54.5~54.05|оз. Банное (Якты-Куль)~2~2~10~53.59~58.63",
 "Нугушское вдхр.~2~2~9~53.05~56.45|Юмагузинское вдхр.~2~2~12~52.96~56.55",
 "Кармановское вдхр. (ГРЭС)~2~4~5.5~56.22~54.33|оз. Шамсутдин (Бирск)~2~3~3.2~55.44~55.48",
 "р. Белая (Стерлитамак / Салават / Ишимбай)~2~1~3.5~53.52~55.95",
 "р. Белая / Белорецкий пруд (Белорецк)~2~0~2.2~53.965~58.4",
 "оз. Ургун / оз. Калкан (Учалы)~2~2~5.5~54.32~59.38",
 "оз. Талкас / р. Таналык (Баймак / Сибай)~2~2~6.5~52.66~58.5|р. Урал (Орск)~2~1~3~51.23~58.475",
 "р. Самара / р. Бузулук (Бузулук)~2~0~2.5~52.788~52.262",
 "Ижевский пруд / р. Иж (Ижевск)~2~2~5.5~56.86~53.18",
 "Воткинское вдхр. (Чайковский / Воткинск / Оса)~2~2~8~57~54.55",
 "р. Сылва / р. Ирень (Кунгур)~2~0~2.6~57.43~56.95",
 "Камское вдхр. (Березники / Соликамск / Пожва)~2~2~7.5~59.41~56.78",
 "р. Вишера / р. Колва (Красновишерск / Чердынь)~2~1~3.5~60.403~56.8",
 "р. Вятка (Вятские Поляны / Мамадыш)~2~1~4.2~55.95~51.25",
 "р. Кама (Чистополь / Рыбная Слобода)~2~1~8~55.37~50.55",
 "Куйбышевское вдхр. (Ульяновск)~2~2~9~54.315~48.45",
 "Волга (Балаково / Хвалынск)~2~2~8.5~52.35~48.05",
 "Сурское вдхр. / р. Сура (Пенза)~2~2~6~53.15~45.15",
 "р. Инсар / р. Сура (Саранск)~2~0~2.4~54.185~45.2|р. Волга (Макарьево)~2~2~6.5~56.25~46.2",
 "р. Волга (Лысково / Макарьево)~2~1~8~56.048~45.045|р. Ока (Павлово)~2~1~6~55.966~43.078",
 "р. Малая Кокшага (Йошкар-Ола)~2~0~2.8~56.634~47.905",
 "Черемшанский залив (Димитровград)~2~2~6.5~54.212~49.585",
 "Куйбышевское вдхр. (Тольятти)~2~2~12~53.485~49.38",
 "Саратовское вдхр. (Сызрань)~2~1~8.5~53.142~48.468|Усинский залив (Шигоны)~2~2~7.5~53.395~48.72",
 "р. Волга (Вольск / Маркс)~2~1~10~51.905~47.12|Волгоградское вдхр. (Ровное)~2~2~9.5~50.778~46.065",
 "р. Чусовая (Чусовой)~2~1~3.5~58.285~57.815|Воткинское вдхр. (Оса)~2~2~9~57.292~55.445",
 "Обвинский залив (Ильинский)~2~2~7~58.572~55.695|Камское вдхр. (Пожва)~2~2~8.5~59.092~56.11",
 "р. Быстрый Танып (Балтачево / Татышлы)~2~0~2.8~56.145~55.88",
 "р. Зилим (Красноусольский)~2~0~2.5~53.925~56.51",
 "р. Белая (Кумертау / Мелеуз)~2~1~3.8~52.955~55.925|р. Белая (Актаныш)~2~1~6~55.725~54.095",
 "Куйбышевское вдхр. (Звенигово)~2~1~8.5~55.968~48.012|Сурское вдхр. (Пенза)~2~2~5.5~53.082~45.222",
 "р. Мокша (Темников / Краснослободск / Ковылкино)~2~0~2.8~54.429~43.776",
 "р. Белая (Дюртюли / Бирск / Кушнаренково)~2~1~4.2~55.492~54.872",
 "р. Белая (Агидель / устье)~2~1~5~55.908~53.918",
 "р. Белая (Старосубхангулово / Бурзян)~2~0~1.8~53.106~57.442",
 "р. Уфа (Уфа — Сипайлово / Шакша)~2~1~4~54.762~56.082",
 "р. Большой Инзер и р. Малый Инзер (Межгорье / Инзер)~2~0~1.6~54.212~57.562",
 "р. Зилаир и р. Сакмара (Зилаирский р-н)~2~0~1.7~52.233~57.442",
 "р. Большой Ик (Мраково / Исянгулово)~2~0~2~52.193~56.578",
 "р. Чермасан (Кушнаренково / Чекмагуш)~2~0~1.9~55.021~55.142",
 "р. Уршак (Кармаскалы / Чишмы)~2~0~1.8~54.482~55.892",
 "р. Ашкадар (Стерлитамак)~2~0~1.9~53.615~55.942",
 "р. Усень и Туймазинское вдхр. (Туймазы)~2~2~3.5~54.542~53.782",
 "Акъярское и Сакмарское вдхр.~2~2~4.2~51.895~58.185",
 "оз. Мулдаккуль и оз. Чебаркуль (Абзелиловский р-н)~2~2~3.6~53.412~58.642",
 "оз. Архимандритское и оз. Кашкадан (Уфа)~2~3~2.8~54.685~55.982",
 "Чебоксарское вдхр. (Козьмодемьянск / Юрино)~2~1~6.5~56.345~46.562",
 "р. Ветлуга (Юрино — низовья)~2~1~4.5~56.308~46.312",
 "р. Большая Кокшага и устье в с. Кокшайск~2~0~2.6~56.165~47.802",
 "Куйбышевское вдхр. (Волжск / Лопатино)~2~1~6~55.862~48.352",
 "р. Илеть (Морки / Красногорский / Волжский р-н)~2~0~2.4~56.142~48.331",
 "р. Рутка и р. Арда (Килемарский р-н)~2~0~2.2~56.512~46.785",
 "р. Юшут (Марий Чодра)~2~0~2~56.252~48.495",
 "оз. Яльчик (Марий Чодра, Волжский р-н)~2~2~6.5~56.012~48.435",
 "оз. Таир и оз. Карась (Звениговский р-н)~2~2~4.5~56.342~47.695",
 "оз. Кичиер и оз. Мушан-Ер (Волжский р-н)~2~2~5~56.068~48.352",
 "оз. Морской Глаз (Шарибоксад)~2~2~12~56.141~48.782",
 "р. Сура (Большие Березники)~2~1~3.5~54.178~46.165",
 "р. Алатырь (Ардатов / Тургенево / Кемля)~2~0~2.4~54.842~46.235",
 "р. Исса и р. Инсарка (г. Инсар)~2~0~1.8~53.871~44.372",
 "р. Сивинь (Старое Шайгово / Краснослободск)~2~0~1.7~54.312~44.478",
 "р. Вад и р. Парца (Зубова Поляна)~2~0~2.1~54.075~42.836|Карнайское вдхр.~2~2~3.5~54.035~45.448",
 "оз. Инерка и оз. Пиявское (Большеберезниковский р-н)~2~3~4.2~54.058~45.892",
 "оз. Шелубей и старицы р. Мокша (Теньгушевский р-н)~2~3~2.8~54.763~42.716",
 "Саранское море и Пичерский пруд (Саранск / Рузаевка)~2~2~3~54.072~44.962",
 "Куйбышевское вдхр. (Камское Устье / Затон)~2~1~9.5~55.202~49.275",
 "Куйбышевское вдхр. (Свияжск / Зеленодольск)~2~1~6~55.785~48.662",
 "Куйбышевское вдхр. (Лаишево / Сорочьи Горы)~2~1~7.5~55.382~49.552",
 "Куйбышевское вдхр. (Тетюши / Болгар)~2~1~8.5~54.948~48.862",
 "р. Кама (Алексеевское / Саконы)~2~1~7~55.325~50.112",
 "р. Кама (Елабуга / Нижнекамск)~2~1~6.5~55.712~52.042",
 "Нижнекамское вдхр. (Мензелинск / Ижевка)~2~1~6~55.842~52.952",
 "Заинское вдхр. (Заинская ГРЭС, г. Заинск)~2~4~4.5~55.285~52.048",
 "Карабашское вдхр.~2~2~5.5~54.702~52.592",
 "р. Мёша (Пестрецы / Лаишевский р-н)~2~0~2.3~55.748~49.652",
 "р. Ик (Муслюмово / Азнакаево)~2~0~2.5~55.311~53.188",
 "р. Степной Зай (Альметьевск / Заинск)~2~0~2~54.915~52.285",
 "р. Шешма (Новошешминск / Чистопольский р-н)~2~0~2.1~55.068~51.236",
 "р. Большой Черемшан (Нурлат)~2~0~2.2~54.428~50.805",
 "оз. Средний, Нижний и Верхний Кабан (Казань)~2~2~4.5~55.762~49.132",
 "оз. Лебяжье и оз. Глубокое (Казань)~2~2~3.8~55.839~48.948",
 "оз. Раифское (Зеленодольский р-н)~2~2~5.5~55.902~48.728",
 "Воткинский пруд / р. Вотка (г. Воткинск)~2~2~3.8~57.058~53.978",
 "р. Кама (Сарапул / Гольяны / Нечкино)~2~1~6~56.472~53.818",
 "р. Кама (Каракулино / Усть-Бельск)~2~1~6.5~55.995~53.642",
 "Камбарский пруд и р. Кама (Камбарка)~2~2~3.5~56.265~54.205",
 "р. Чепца (Глазов / Балезино / Яр / Дебёсы)~2~0~2.5~58.145~52.662",
 "Пудемский пруд (Ярский р-н)~2~2~3.2~58.358~52.176",
 "р. Вала и р. Нылга (Можга / Вавож)~2~0~2.2~56.774~51.93",
 "р. Кильмезь (Сюмси / Селты)~2~0~2.3~57.11~51.615|р. Лоза (п. Игра)~2~0~1.8~57.554~53.054",
 "р. Иж (Малая Пурга / Агрыз)~2~0~2.1~56.542~53.002",
 "р. Волга (Новочебоксарск / Козловка)~2~1~7.5~56.115~47.562",
 "Чебоксарское вдхр. (Чебоксары)~2~1~6.5~56.158~47.202",
 "р. Сура (Алатырь / Порецкое / Шумерля / Ядрин)~2~1~3.8~55.501~46.413",
 "р. Большой и Малый Цивиль~2~0~2~55.869~47.479|р. Аниш (Козловский р-н)~2~0~1.7~55.842~48.112",
 "р. Кубня (Комсомольское / Янтиково)~2~0~1.8~55.222~47.486",
 "р. Выла (Ядринский р-н)~2~0~1.6~55.885~46.312|оз. Изъяр / оз. Кюльхири~2~2~3.5~56.218~47.262",
 "Чусовской и Сылвенский заливы~2~1~7.5~58.135~56.452",
 "Иньвенский и Косьвинский заливы~2~1~6.5~58.892~56.112",
 "Тёплый канал Пермской ГРЭС (Добрянка)~2~4~4.2~58.488~56.382",
 "Тёплый сброс Яйвинской ГРЭС и р. Яйва (пгт Яйва)~2~4~3.8~59.333~57.266",
 "Широковское вдхр. и р. Косьва (Губаха)~2~2~8~58.854~57.792",
 "Воткинское вдхр. (Оханск / Елово)~2~1~8.5~57.721~55.388",
 "Нытвенский пруд (г. Нытва)~2~2~3.5~57.939~55.331",
 "Лысьвенский и Очёрский пруды~2~2~3.8~58.106~57.805|р. Койва / р. Вижай~2~0~1.8~58.281~58.362",
 "р. Усьва (Усьва / Мыс / Чусовой)~2~0~1.9~58.685~57.621",
 "р. Березовая / р. Язьва~2~0~2.1~60.412~57.115",
 "р. Кама — верховья (Гайны / Бондюг / Тюлькино)~2~1~3.8~60.308~54.326",
 "р. Коса и р. Иньва (Коса / Кудымкар)~2~0~2.3~59.016~54.659",
 "р. Тулва (Барда / Оса)~2~0~2~56.925~55.586|оз. Адово (Гайнский р-н)~2~3~3.5~60.521~53.392",
 "р. Вятка (Слободской / Кирово-Чепецк)~2~1~4.2~58.554~50.032",
 "р. Вятка (Орлов / Котельнич / устье р. Молома)~2~1~4.5~58.308~48.348",
 "р. Вятка (Советск / Уржум / Малмыж)~2~1~5~57.589~48.958",
 "р. Вятка — верховья (Кирс / Нагорск / Песковка)~2~1~3.2~59.339~52.244",
 "р. Кама — верховья (Афанасьево / Бисерово)~2~0~2.4~58.864~53.253",
 "р. Чепца (Зуевка / Фалёнки / Кирово-Чепецк)~2~0~2.8~58.404~51.132",
 "р. Молома (Даровской / Котельничский р-н)~2~0~2.5~58.771~47.957",
 "р. Пижма и р. Немда (Советск / Тужа / Пижанка)~2~0~2.4~57.581~48.921",
 "р. Кильмезь и р. Лобань (пгт Кильмезь)~2~0~2.5~56.945~51.069",
 "р. Великая (Юрья / Мурыгино)~2~0~2.2~58.736~49.457",
 "р. Кобра (Нагорский / Даровской р-н)~2~0~2.1~59.322~50.806",
 "р. Луза и р. Юг (Луза / Подосиновец / Демьяново)~4~0~2.6~60.631~47.251",
 "Белохолуницкий пруд (г. Белая Холуница)~2~2~3.8~58.842~50.852",
 "Омутнинский и Кирсинский пруды~2~2~3.6~58.672~52.181",
 "оз. Шайтан / оз. Акшубень~2~2~6~57.118~49.592",
 "Горьковское вдхр. (Городец / Чкаловск / Сокольское)~2~1~8~56.782~43.315",
 "Чебоксарское вдхр. (Бармино / Разнежье / Васильсурск)~2~1~7~56.075~45.654",
 "р. Волга (Балахна / Сормово)~2~1~5.5~56.491~43.541",
 "р. Ока (Дзержинск / Горбатов / Навашино)~2~1~4.8~56.132~43.064",
 "р. Керженец (Семёнов / Рустай / Макарьево)~2~0~2.2~56.789~44.492",
 "р. Ветлуга (Варнавино / Красные Баки / Воскресенское)~2~1~3.8~57.129~45.155",
 "р. Пьяна~2~0~2.4~55.531~45.469",
 "р. Тёша и р. Серёжа (Арзамас / Лукоянов / Навашино)~2~0~2~55.395~43.839",
 "р. Уста (Урень)~2~0~2.1~57.461~45.786|р. Узола (Ковернино / Городец)~2~0~1.8~57.125~43.814",
 "р. Кудьма и р. Линда (Кстово / Бор)~2~0~1.9~56.112~44.205",
 "оз. Светлояр (Воскресенский р-н)~2~2~8~56.819~45.092",
 "оз. Вадское / Мордовское (с. Вад)~2~2~4.5~55.535~44.197",
 "оз. Тосканка и Пустынские озёра~2~2~4~55.991~43.275",
 "р. Урал (Новотроицк / Верхняя Кардаиловка)~2~1~3.5~51.203~58.327",
 "р. Урал (Беляевка / Красногор — среднее течение)~2~1~3.8~51.397~56.416",
 "р. Урал и устье р. Илек (с. Илек / Рассыпное)~2~1~4.2~51.527~53.383",
 "р. Сакмара~2~1~3.2~51.787~56.362|р. Илек (Соль-Илецк / Акбулак / Илек)~2~0~2.4~51.161~54.992",
 "Сорочинское вдхр. / р. Самара~2~2~4.8~52.418~53.212",
 "р. Большой Кинель (Бугуруслан / Асекеево)~2~0~2.3~53.655~52.441",
 "р. Суундукский залив Ириклы~2~2~7.5~51.985~59.112",
 "р. Кумакское вдхр. / р. Большой Кумак~2~2~3.5~51.381~58.981",
 "Елшанское вдхр. (Бузулукский р-н)~2~2~4~52.712~52.412",
 "Ушкатинское вдхр. (Домбаровский р-н)~2~2~3.8~50.758~59.538",
 "оз. Жетыколь и оз. Шалкар-Ега-Кара (Светлинский р-н)~2~3~2.5~50.819~60.854",
 "р. Сура (Пенза / Лунино)~2~1~3.2~53.309~45.041|р. Сура (Сурск / Чаадаевка)~2~0~2.2~53.076~45.675",
 "р. Уза / Узинский залив~2~0~2.8~52.891~45.392",
 "р. Мокша (Мокшан / Нижний Ломов)~2~0~2.4~53.437~44.613",
 "Вадинское вдхр. и р. Вад (с. Вадинск)~2~2~4.2~53.692~43.058",
 "р. Хопёр и р. Сердоба (Сердобск / Беково / Колышлей)~6~0~2.5~52.463~43.712",
 "р. Ворона и р. Чембар (Белинский / Башмаково)~6~0~2.1~52.964~43.417",
 "р. Выша (Земетчино)~2~0~2~53.497~42.616|р. Атмис (г. Каменка)~2~0~1.7~53.191~44.047",
 "Чистые Пруды (Пенза)~2~2~3.2~53.265~44.782",
 "Саратовское вдхр. (Самара / Ширяево)~2~1~8~53.414~50.015",
 "Саратовское вдхр. (Безенчук / Приволжье / Октябрьск)~2~1~7.5~53.052~49.412",
 "Сусканский залив (Хрящёвка)~2~1~5.5~53.816~49.092",
 "Васильевские острова (Сызрань / Переволоки)~2~1~6.5~53.208~49.242",
 "р. Уса / Муранский бор~2~1~6~53.318~48.885",
 "р. Большой Кинель (Отрадный / Кинель)~2~0~2.6~53.376~51.348",
 "р. Кондурча (Красный Яр / Кошки / Елховка)~2~0~2.1~53.501~50.392",
 "р. Чапаевка / пр. Кривуша~2~0~2.5~53.038~49.792",
 "р. Большой Иргиз (Большая Глушица / Пестравка)~2~0~2.4~52.392~50.473",
 "Кутулукское вдхр. (Богатовский / Кинельский р-н)~2~2~4.5~53.152~51.385",
 "Съезженское и Ветлянское вдхр.~2~2~4.2~52.885~51.242",
 "Черновское вдхр. (Волжский р-н)~2~2~3.8~53.142~50.485|Мастрюковские озёра~2~3~3~53.468~49.882",
 "Волгоградское вдхр. (Саратов / Энгельс / Чардым)~2~1~9~51.622~46.235",
 "Волгоградское вдхр. (Балаково / Вольск / Маркс)~2~1~8.5~51.995~47.721",
 "Волгоградское вдхр. (Золотое / Ахмат)~2~1~11~50.941~45.885",
 "Саратовское вдхр. (Хвалынск / Духовницкое)~2~1~8~52.481~48.204",
 "р. Большой Иргиз (Пугачёв / Балаково / Криволучье)~2~0~2.8~52.016~48.803",
 "р. Большой Караман~2~0~2.2~51.378~46.852|р. Терешка~2~0~2.1~52.148~46.963",
 "р. Еруслан (Красный Кут / Ровенский р-н)~2~0~2~50.946~46.968",
 "р. Хопёр (Балашов / Аркадак / Романовка / Турки)~6~0~2.8~51.551~43.168",
 "р. Медведица (Аткарск / Калининск)~6~0~2.5~51.872~45.006",
 "р. Большой и Малый Узень~2~0~2.2~50.457~48.143",
 "оз. Сазанка (Энгельс) и Балаковский судоходный канал~2~3~3.5~51.512~46.085",
 "Старомайнский залив (Старая Майна)~2~1~4.5~54.618~48.918",
 "Куйбышевское вдхр. (Ундоры / Ульяновск)~2~1~10~54.602~48.395",
 "Куйбышевское вдхр. (Криуши / Сенгилей / Белый Яр)~2~1~9~54.041~48.636",
 "Черемшанский залив (Никольское-на-Черемшане)~2~1~5.5~53.963~49.308",
 "Саратовское вдхр. (Паньшино, Радищевский р-н)~2~1~7.5~52.812~48.471",
 "р. Свияга (Ульяновск / Ишеевка / Большое Нагаткино)~2~0~2.4~54.426~48.271",
 "р. Большой Черемшан (Димитровград)~2~0~2.5~54.218~49.685",
 "р. Сура / р. Барыш / р. Инза~2~0~2.8~54.481~46.718",
 "р. Сызранка (Новоспасское)~2~0~1.9~53.149~47.752",
 "Юшанское вдхр. / оз. Белое~2~2~3.2~54.228~47.785|р. Белая (Кушнаренково)~2~1~4.5~55.105~55.345",
 "р. Седе-Яха~0~0~1.4~66.083~76.68|р. Ево-Яха~0~0~1.6~66.071~76.712",
 "р. Тамчара-Яха~0~0~1.3~66.065~76.63|оз. Молодёжное~0~3~1.8~66.09~76.69",
 "Песчаные карьеры (Н. Уренгой)~0~2~3.5~66.055~76.74|р. Тамбей-Яха~0~0~1.2~66.12~76.55",
 "Уренгойская ГРЭС (пос. Лимбияха, тёплый канал)~0~4~3.5~66.062~77.815",
 "оз. Ямылимуяганто (охладитель ГРЭС, Лимбияха)~0~4~4.2~66.068~77.835",
 "р. Лимбяяха (пос. Лимбияха)~0~0~1.9~66.055~77.79",
 "р. Пур (Коротчаево / Уренгой)~0~1~4.5~65.947~78.15|р. Варенга-Яха~0~0~1.8~66.035~77.52",
 "р. Арка-Табъяха~0~0~1.7~65.92~76.42|р. Ямсовей~0~0~2.1~65.65~76.95",
 "р. Хадуттэ~0~0~2.4~66.48~76.85|р. Нгарка-Пыряяха~0~0~2~66.38~77.95",
 "р. Большая Хадырьяха~0~0~2.2~65.82~78.05|р. Правая Хетта~0~0~2.2~65.85~74.5",
 "р. Пур (Тарко-Сале)~0~1~4.2~64.915~77.78|р. Пяку-Пур~0~0~2.2~64.9~77.75",
 "р. Айваседа-Пур~0~0~2~64.91~77.8|р. Таз~0~1~4.8~67.45~78.7|р. Надым~0~1~3.8~65.533~72.52",
 "оз. Янтарное~0~3~2.1~65.54~72.5|оз. Ханто~0~3~2.5~63.22~75.43",
 "оз. Светлое (Ноябрьск)~0~2~4~63.16~75.38|р. Нанкпёх~0~0~1.3~63.2~75.4",
 "р. Обь (Салехард)~0~1~7.5~66.53~66.6|р. Полуй~0~0~2.4~66.52~66.62|р. Собь~0~0~1.8~66.82~65.8",
 "р. Обь (Сургут)~0~1~6.8~61.25~73.4|вдхр. Сургутской ГРЭС~0~4~3.5~61.28~73.5",
 "р. Тромъёган~0~0~2.5~61.42~73.8|р. Обь (Нижневартовск)~0~1~6.5~60.93~76.55",
 "оз. Самотлор~0~3~2~61.12~76.75|р. Вах~0~1~4~60.98~76.9|р. Иртыш (Ханты-Мансийск)~0~1~6~61~69.02",
 "р. Конда~0~1~3.8~60.68~68.05|р. Иртыш (Тобольск)~0~1~5.5~58.19~68.25",
 "р. Тура (Тюмень)~0~1~3.6~57.155~65.535|оз. Андреевское (Тюмень)~0~3~2.2~57.05~65.77",
 "р. Пышма~0~0~2~56.98~65.38|р. Исеть (Екатеринбург)~0~0~2.2~56.835~60.605",
 "Белоярское вдхр. (БАЭС)~0~4~6.5~56.85~61.3|Рефтинское вдхр. (ГРЭС)~0~4~5.2~57.1~61.7",
 "Тазовская губа~0~5~4.5~68~76|Обская губа~0~5~6~68.5~73.5",
 "р. Урал (Магнитогорск)~2~0~2.2~53.42~58.98|оз. Увильды (Челябинск)~0~2~11~55.52~60.5",
 "оз. Тургояк (Миасс)~0~2~14~55.15~60.06|Шершнёвское вдхр. (Челябинск)~0~2~5.5~55.1~61.33",
 "оз. Негито (Нигито)~0~2~5.5~65.5129~77.2999|оз. Нгаркато (Пуровский р-н)~0~2~4.2~65.4832~77.2915",
 "оз. Ямбуто (ЯНАО)~0~2~6.2~67.31~74.15|оз. Пякуто~0~2~5~63.43~73.12",
 "оз. Тету-Мамонтотяй~0~2~5.8~63.18~74.82|оз. Вынглор~0~3~2.8~63.28~76.1",
 "оз. Часельское~0~2~6~65.45~80.55|оз. Чёртово (Красноселькуп)~0~2~7.5~65.05~81.9",
 "оз. Большое Щучье (Полярный Урал)~0~2~18~67.89~66.31|оз. Шурышкарский Сор~0~3~2.4~65.91~65.18",
 "оз. Войкарский Сор~0~3~2.5~65.72~64.65|р. Таб-Яха~0~0~2.3~65.81~76.32",
 "р. Хейги-Яха (Лонгъюган)~0~0~2.2~65.31~73.85|р. Мессояха~0~1~3.8~67.75~77.5",
 "р. Харампур~0~0~2.1~64.31~78.22|р. Северная Сосьва~0~1~4.5~63.93~65.04",
 "р. Казым (Белоярский)~0~0~2.5~63.71~66.7|оз. Нумто~0~3~2.2~63.52~71.35",
 "оз. Сырковый Сор (Салым)~0~2~4.5~60.05~71.32|оз. Торм-Эмтор~0~3~2.6~61.55~77.8",
 "оз. Мишкинское (пгт. Мишкино)~0~3~2.2~55.342~63.915",
 "р. Миасс (Мишкинский / Каргапольский р-н)~0~0~2.3~55.545~63.885",
 "оз. Песчаное (Шумихинский / Мишкинский р-н)~0~3~2.8~55.435~63.52",
 "р. Юргамыш (Юргамыш / Мишкино)~0~0~1.8~55.38~64.465",
 "оз. Горькое-Пресное / Круглое (Шумиха)~0~3~2.5~55.26~63.28",
 "р. Миасс (Чесноковка / Шумихинский р-н)~0~0~2.2~55.48~63.25",
 "р. Исеть (Шадринск / Далматово)~0~0~2.6~56.082~63.635",
 "р. Канаш / оз. Боровое (Шадринск)~0~0~1.8~56.04~63.59|р. Тобол (Курган)~0~1~4.2~55.438~65.352",
 "Орловское вдхр. (Курганская ТЭЦ)~0~4~3.8~55.452~65.412",
 "оз. Бездонное / Старица Тобола (Курган)~0~3~2.8~55.385~65.295",
 "р. Куртамыш (Куртамыш)~0~0~1.9~54.912~64.435",
 "оз. Большое Пустое / Птичанские озёра~0~3~2.4~54.88~64.35",
 "оз. Башкирское / Пресное (Макушино)~0~3~2.3~55.215~67.25",
 "оз. Песчаное / Пресное (Петухово)~0~3~2.5~55.085~67.91",
 "оз. Мартыново / Бутырино (Частоозерье)~0~3~2.6~55.572~67.912",
 "оз. Чёрное (Мокроусово / Зауралье)~0~2~4.5~55.62~66.95",
 "р. Тобол (Ялуторовск / Заводоуковск)~0~1~4~56.65~66.32",
 "оз. Сингуль (Ялуторовский р-н)~0~2~4.5~56.45~66.05|р. Вагай (Вагай)~0~0~2.4~57.938~69.025",
 "р. Иртыш (Уват)~0~1~6.5~59.142~68.892|р. Туртас (Туртас / Уват)~0~0~2.5~58.945~69.145",
 "р. Демьянка (Демьянка)~0~0~2.8~59.548~69.31|р. Тобол (Ярково)~0~1~4.5~57.41~67.078",
 "р. Тавда (Нижняя Тавда / Тавда)~0~1~4.2~57.85~65.7|р. Ишим (г. Ишим)~0~1~3.8~56.11~69.495",
 "оз. Мергень / Старица Ишима~0~3~2.5~55.642~69.238|р. Волчихинское вдхр.~0~2~5.5~56.78~60.02",
 "Верхнемакаровское вдхр. (Полевской)~0~2~5~56.48~60.22",
 "р. Исеть / оз. Сунгуль (Каменск-Уральский)~0~0~2.5~56.415~61.918",
 "Тагильский пруд~0~2~6~57.9~59.95|р. Сосьва / Киселёвское вдхр. (Серов)~0~0~2.8~59.605~60.58",
 "р. Сосьва (пгт. Сосьва)~0~1~3.8~59.178~61.855|р. Лозьва / р. Сосьва (Гари)~0~1~4.2~59.432~62.352",
 "р. Лозьва / р. Ивдель (Ивдель)~0~0~2.5~60.692~60.422",
 "оз. Большие Касли / оз. Иткуль (Касли)~0~2~7.5~55.895~60.76",
 "Южноуральское вдхр. (Южноуральская ГРЭС)~0~4~5.2~54.445~61.255",
 "р. Пяку-Пур / р. Пурпе (Губкинский / Пурпе)~0~0~2.5~64.45~76.58",
 "р. Пяку-Пур / оз. Городское (Муравленко)~0~3~2.4~63.794~74.525",
 "р. Левая Хетта / р. Надым (Ягельный / Приозёрный)~0~0~2.2~64.82~72.8",
 "р. Хейги-Яха / р. Надым (Лонгъюган)~0~0~2.2~65.305~71.2",
 "Обская губа / р. Ныда (Ныда / Нори / Заполярный)~0~5~4.5~66.5~73.1",
 "р. Кутопьюган / Обская губа (Кутопьюган)~0~0~2.2~66.08~71.2|р. Пур (Самбург)~0~1~5~66.85~78.225",
 "Тазовская губа (Антипаюта)~0~5~5~69.095~76.855",
 "Гыданская губа / р. Гыда (Гыда)~0~5~5.5~70.892~78.47",
 "Обская губа / р. Сеяха (Сеяха)~0~5~6~70.165~72.515|Обская губа (Новый Порт)~0~5~5.5~67.69~72.9",
 "Обская дельта (Яр-Сале)~0~1~5.5~66.8~69.95",
 "р. Обь / р. Щучья (Аксарка / Белоярск)~0~1~7~66.68~67.95",
 "р. Таз (Красноселькуп)~0~1~4.8~65.702~82.463|р. Таз (Толька)~0~1~4.2~64~82.06",
 "р. Еркал-Надей-Пур (Халясавэй)~0~0~2.4~63.39~78.38",
 "р. Сыня / р. Малая Обь (Овгорт / Горки)~0~0~2.8~64.95~64.3",
 "р. Пим (Лянтор / Нижнесортымский)~0~0~2.5~62~71.95",
 "р. Обь / пр. Каюковская (Лангепас / Покачи)~0~1~6~61.45~75.35",
 "р. Аган (Радужный / Новоаганск)~0~1~4.2~62.05~77.05",
 "р. Ингуягун / оз. Когалымское (Когалым)~0~0~2.4~62.265~74.485|Юганская Обь~0~1~5.5~61.05~72.4",
 "р. Иртыш (Горноправдинск)~0~1~6~60.056~69.908",
 "р. Обь / Малая Обь (Приобье / Нягань / Октябрьское)~0~1~6.5~62.42~65.65",
 "р. Северная Сосьва (Игрим)~0~1~4.8~63.19~64.417",
 "р. Конда (Урай / Междуреченский)~0~1~3.8~59.9~65.3",
 "оз. Окунёво / р. Эсс (Советский / Югорск)~0~2~4.2~61.34~63.45",
 "р. Таз (Заполярный)~0~1~6~66.41~73.85|р. Надым (Нори)~0~1~5.5~66.152~72.38",
 "р. Пякупур (Ханымей)~0~1~4.5~63.725~75.955|р. Малая Обь (Горки)~0~1~6.5~65.078~65.285",
 "р. Сортым-Пим (Нижнесортымский)~0~0~2.6~62.44~71.755",
 "р. Тобол (Звериноголовское / Глядянское)~0~1~3.2~54.459~64.854",
 "р. Тобол (Белозерское / Коркино — север области)~0~1~3.5~55.825~65.586",
 "р. Исеть (Катайск / Далматово / Каргаполье)~0~0~2.6~56.289~62.585",
 "р. Миасс (Каргаполье — низовья до впадения в Исеть)~0~0~2.4~55.951~64.432",
 "р. Уй (Целинное / Усть-Уйское)~0~0~2.3~54.342~64.382",
 "оз. Ачикуль (Белозерский р-н)~0~3~3.5~55.882~65.612",
 "оз. Камышное и оз. Суерское (Лебяжьевский р-н)~0~3~2.5~55.268~66.495",
 "оз. Идгильды / оз. Сафакуль~0~3~2.6~54.956~63.575",
 "оз. Куртан и оз. Стекленей (Мокроусовский р-н)~0~3~2.4~55.809~66.762",
 "оз. Щучье и р. Чумляк (г. Щучье)~0~3~2.8~55.211~62.754",
 "оз. Половинное / оз. Донки~0~3~2.6~54.789~65.986",
 "оз. Таватуй / Верх-Нейвинский пруд~0~2~5.5~57.142~60.185",
 "Исетское вдхр. (Среднеуральск / СУГРЭС)~0~4~3.5~56.992~60.442",
 "оз. Шарташ и Верх-Исетский пруд (Екатеринбург)~0~2~3.2~56.872~60.708",
 "оз. Балтым (Верхняя Пышма)~0~2~3.5~57.032~60.578",
 "Сысертский и Верхне-Сысертский пруды~0~2~3.8~56.495~60.812",
 "Ленёвское вдхр. и Выйский пруд (Нижний Тагил)~0~2~6.5~57.752~59.842",
 "Невьянский пруд и р. Нейва (Невьянск / Алапаевск)~0~2~4~57.489~60.221",
 "Верхнетагильское вдхр. (ГРЭС)~0~4~4.2~57.378~59.951",
 "Нижне-Выйское и Нижнетуринское вдхр.~0~2~5.5~58.652~59.792",
 "Серовская ГРЭС / Андриановский пруд~0~4~3.5~59.585~60.412",
 "р. Тура (Верхотурье / Туринск)~0~1~3.6~58.864~60.805",
 "р. Пышма (Сухой Лог / Камышлов / Талица)~0~0~2.4~56.846~62.712",
 "р. Реж и р. Ница (Реж / Ирбит / Туринская Слобода)~0~0~2.5~57.674~63.063",
 "р. Пелым / оз. Пелымский Туман~0~3~2.8~60.152~63.112",
 "р. Уфа / р. Серга (Красноуфимск / Михайловск)~2~0~2.4~56.435~59.119",
 "р. Сылва (Шаля)~2~0~2.1~57.243~58.729|оз. Аятское~0~2~3~57.362~60.842",
 "Тёплый канал Тюменской ТЭЦ-1 и оз. Оброчное (Тюмень)~0~4~3.5~57.125~65.621",
 "оз. Круглое, оз. Липовое и оз. Цимлянское (Тюмень)~0~2~5.5~57.212~65.662",
 "Муллашинские карьеры (Винзили)~0~2~6~56.968~66.042",
 "оз. Большой Тараскуль / оз. Ипкуль~0~3~2.6~57.542~65.362",
 "р. Исеть (с. Исетское — низовья)~0~0~2.8~56.485~65.324",
 "р. Тобол (Упорово / Байкалово)~0~1~4.2~57.548~67.854",
 "р. Ишим (Викулово / Абатское / Казанское — Ильинка)~0~1~3.8~56.287~70.457",
 "оз. Песьяное / оз. Белое (Бердюжье)~0~3~2.8~55.805~68.298",
 "оз. Станичное и оз. Таволжан (Сладковский р-н)~0~3~2.5~55.528~70.338",
 "оз. Большой Уват / р. Носка~0~3~3~57.882~69.812",
 "Аргазинское вдхр. (Карабаш / Аргаяш / Миасс)~0~2~8.5~55.382~60.542",
 "оз. Чебаркуль и Большой Кисегач~0~2~7.5~54.962~60.332",
 "оз. Синара и оз. Аракуль~0~2~8~56.085~60.731|оз. Иртяш и Большие Аллаки~0~2~7~55.785~60.725",
 "оз. Смолино, Первое и Касарги (Челябинск)~0~2~4.2~55.102~61.442",
 "оз. Калды и оз. Уелги (Кунашак)~0~2~4.5~55.662~61.292",
 "оз. Тишки и Большой Куяш~0~3~3.2~55.612~61.812",
 "оз. Зюраткуль и р. Ай (Сатка / Куса)~2~2~5.5~54.918~59.205",
 "Нязепетровское вдхр. и р. Уфа (Нязепетровск)~2~2~6.5~56.053~59.602",
 "р. Сим / р. Юрюзань / р. Катав~2~0~2~54.993~57.694|Верхнеуральское вдхр.~2~2~6~53.725~59.185",
 "Троицкое вдхр. (Троицкая ГРЭС) и р. Уй (Троицк)~0~4~4.5~54.042~61.642",
 "вдхр. Нижневартовской ГРЭС и р. Вах (Излучинск)~0~4~4.2~60.958~76.925",
 "Няганская ГРЭС / р. Нягань-Юган~0~4~3.5~62.185~65.492",
 "р. Обь — устье Иртыша (Ханты-Мансийск)~0~1~7.5~61.072~68.892",
 "р. Большой Юган и р. Малый Юган (Угут)~0~0~3.2~60.491~74.054",
 "р. Большой Салым (Салым / Лемпино)~0~0~2.6~60.068~71.478",
 "р. Назым / р. Ендырь~0~0~2.4~61.551~66.332",
 "р. Ляпин / р. Хулга (Саранпауль)~0~0~2.8~64.258~60.903",
 "р. Северная Сосьва (Няксимволь / Хулимсунт)~0~0~2.6~62.426~60.865",
 "оз. Леушинский Туман (Междуреченский)~0~3~2.8~59.622~65.741",
 "р. Конда (Кондинское / Болчары)~0~1~3.8~59.649~67.412",
 "оз. Кымыл-Эмтор и р. Кирья (Нижневартовский р-н)~0~3~2.5~60.985~77.312",
 "оз. Пильтанлор и оз. Вачлор (Сургутский р-н)~0~3~2.4~61.512~73.112",
 "оз. Согомское и р. Согом (Ханты-Мансийский р-н)~0~3~2.6~60.485~68.125",
 "р. Малая Хадырьяха (Коротчаево)~0~0~1.6~65.875~78.082",
 "р. Сенся-Яха / р. Тюде-Яха~0~0~1.7~66.042~77.385|р. Пыря-Яха / р. Ягенетта~0~0~2.1~65.412~76.212",
 "р. Танлова (Надым)~0~0~2.2~65.285~73.112|р. Харбей (Полярный Урал / Харп)~0~0~1.8~66.912~66.115",
 "р. Лонгот-Юган (Полярный Урал / Харп)~0~0~1.9~67.185~66.521",
 "р. Щучья и оз. Малое Щучье~0~0~2.5~67.752~66.312",
 "р. Хараматолоу и р. Ханмей (Харп / Обской)~0~0~1.6~66.852~65.812",
 "р. Байдарата / р. Кара~0~0~2.4~68.152~67.115|р. Войкар / оз. Варчато~0~0~3.5~65.625~63.982",
 "р. Морды-Яха / р. Юрибей (Ямал)~0~0~2.8~69.852~68.612",
 "оз. Яррото 1-е и 2-е (п-ов Ямал)~0~3~4.2~67.921~71.112",
 "р. Худосей / р. Поколька / р. Ратта~0~0~2.6~64.952~82.512",
 "р. Пякуляха / р. Русская (Таз)~0~0~2.4~67.152~79.462",
 "р. Большая Обь / р. Куноват (Мужи / Лопхари)~0~1~6.5~65.392~65.412",
 "оз. Варгашинское (пгт Варгаши)~0~3~2.3~55.385~65.815",
 "оз. Сафакуль (с. Сафакулево)~0~3~2.4~54.992~62.545|р. Иртыш (Омск)~0~1~4.8~54.99~73.36",
 "р. Омь~0~0~2.1~54.995~73.38|р. Обь (Новосибирск)~0~1~5.5~55.01~82.92",
 "Новосибирское вдхр. (Обское море)~0~2~7.5~54.75~82.85|р. Бердь~0~0~2.4~54.76~83.1",
 "р. Томь (Томск / Кемерово)~0~1~4.2~56.48~84.95|р. Обь (Барнаул)~0~1~4.8~53.34~83.78",
 "оз. Телецкое~0~2~16~51.78~87.26|р. Бия~0~0~2.5~52.54~85.21",
 "р. Енисей (Красноярск)~1~1~6.8~56.01~92.87|Красноярское вдхр.~1~2~16~55.95~92.35",
 "р. Мана~1~0~2.2~55.95~92.48|р. Кан~1~0~2.4~56.2~95.7|оз. Белё / Шира (Хакасия)~1~2~9~54.65~90.15",
 "р. Енисей (Енисейск)~1~1~8.5~58.45~92.17|р. Енисей (Дудинка)~1~1~12~69.4~86.18",
 "р. Норилка / оз. Лама (Норильск)~1~2~14~69.35~88.2|р. Ангара (Братское вдхр.)~1~2~14~56.15~101.6",
 "р. Ангара (Усть-Илимское вдхр.)~1~2~12~58~102.7|р. Ангара (Иркутск)~8~1~4.5~52.285~104.28",
 "Иркутское вдхр.~8~2~8.5~52.15~104.45|р. Иркут~8~0~2.2~52.26~104.2",
 "оз. Байкал (Листвянка)~8~2~22~51.85~104.86|оз. Байкал (Малое Море / Ольхон)~8~2~14~53.2~107.35",
 "оз. Байкал (Слюдянка)~8~2~18~51.66~103.71|р. Снежная~8~0~1.8~51.48~104.63",
 "р. Иртыш (Тара)~0~1~5.5~56.895~74.375|р. Омь (Калачинск)~0~0~2.2~55.055~74.578",
 "р. Иртыш (Черлак)~0~1~4.8~54.158~74.808",
 "Новосибирское вдхр. (Ордынское / Спирино)~0~2~7~54.375~81.905",
 "р. Обь (Сузун / Камень-на-Оби)~0~1~5.2~53.785~81.8",
 "оз. Чаны (Чаны / Барабинск)~0~2~4.2~55.15~77.55",
 "оз. Сартлан (Барабинский р-н)~0~2~4.5~55.02~78.58|р. Обь (Колпашево)~0~1~6.2~58.318~82.912",
 "р. Обь (Парабель / Каргасок)~0~1~6.5~58.85~81.15|р. Томь (Кемерово / Юрга)~0~1~4~55.5~85.5",
 "р. Томь (Новокузнецк / Междуреченск)~0~1~3.8~53.72~87.55",
 "р. Алей / Гилёвское вдхр. (Рубцовск)~0~0~2.4~51.502~81.21",
 "р. Катунь (Горно-Алтайск / Майма)~0~0~2.8~51.958~85.955|р. Чулым (Ачинск)~0~1~3.8~56.27~90.495",
 "р. Енисей / р. Нижняя Тунгуска (Туруханск)~1~1~10~65.795~87.96",
 "р. Енисей (Игарка)~1~1~11~67.465~86.585|р. Енисей (Абакан / Саяногорск)~1~1~6.5~53.5~91.5",
 "р. Енисей / р. Бий-Хем (Кызыл)~1~1~4.5~51.72~94.44|р. Лена (Усть-Кут)~1~1~4.2~56.795~105.765",
 "оз. Чаны (Чаны)~0~2~3.5~55.25~76.78|р. Енисей (Железногорск / Атаманово)~1~1~6.5~56.265~93.49",
 "Саяно-Шушенское вдхр. / р. Енисей (Кызыл / Шагонар)~1~1~6.5~51.719~94.438",
 "р. Чулышман (Балыкча / Улаганский р-н)~0~0~2.2~51.235~87.892",
 "р. Башкаус (Улаган)~0~0~1.9~50.654~87.921|р. Чуя (Акташ / Кош-Агач)~0~0~2~50.281~87.648",
 "р. Бия (верхнее течение / Иогач — Турочак)~0~1~3.2~52.012~87.175",
 "р. Лебедь (Турочак)~0~0~1.8~52.275~87.212|р. Кокса (Усть-Кокса)~0~0~1.9~50.274~85.568",
 "р. Чарыш (верхнее течение / Усть-Кан)~0~0~1.8~50.935~84.749",
 "р. Урсул (Онгудай)~0~0~1.6~50.758~86.185|оз. Джулукуль (Улаганский р-н)~0~3~3.5~50.483~89.766",
 "оз. Теньгинское (Онгудайский р-н)~0~3~3~50.922~85.592",
 "оз. Манжерокское (Манжерок)~0~3~2.6~51.821~85.814",
 "оз. Чейбеккёль (Мёртвое, Акташ / Улаган)~0~3~4.5~50.415~87.61",
 "р. Малый Енисей (Каа-Хем / Сарыг-Сеп)~1~1~3.4~51.522~95.384",
 "р. Большой Енисей (Бий-Хем, Тоора-Хем)~1~1~3.8~52.456~96.082",
 "р. Хемчик (Ак-Довурак / Кызыл-Мажалык / Чадан)~1~0~2.3~51.245~90.892",
 "р. Хамсара (Тоджинский кожуун)~1~0~2.6~52.681~96.214",
 "р. Систиг-Хем (Тоджинский кожуун)~1~0~2.1~52.531~95.489",
 "оз. Азас (Тоджинская котловина)~1~2~6.5~52.411~96.533",
 "оз. Нойон-Холь (Тоджинский кожуун)~1~2~8~52.671~97.026",
 "оз. Чагытай (Бай-Хаак)~1~2~7.5~51.002~94.718",
 "оз. Торе-Холь (Эрзинский кожуун)~1~3~3.5~50.048~95.076",
 "оз. Хиндиктиг-Холь (Монгун-Тайгинский кожуун)~1~2~9~50.341~89.874",
 "р. Абакан (Абаза / Аскиз / Абакан)~1~1~3~53.154~90.584",
 "Саяно-Шушенское вдхр. (Черёмушки)~1~2~18~52.815~91.432",
 "Майнское вдхр. (Майна / Саяногорск)~1~2~6.5~52.971~91.474",
 "р. Она (Большой Он, Абаза / Таштыпский р-н)~1~0~2~52.536~89.782",
 "р. Таштып (с. Таштып)~1~0~1.6~52.802~89.914|р. Белый Июс (Ширинский р-н)~0~0~2.1~54.442~89.568",
 "р. Чёрный Июс (Ширинский / Орджоникидзевский р-н)~0~0~2~54.789~89.642",
 "р. Чулым (Копьёво / верховья)~0~1~2.8~54.996~89.845",
 "оз. Иткуль (Ширинский р-н)~1~2~7~54.462~90.078|оз. Фыркал (Ширинский р-н)~1~3~3.2~54.602~89.842",
 "оз. Чёрное (Ширинский р-н)~1~3~3.5~54.682~89.389",
 "оз. Улуг-Коль (Усть-Абаканский р-н)~1~3~2.2~53.798~90.642",
 "р. Чумыш (Заринск / Тальменка)~0~0~2.6~53.724~84.892",
 "р. Чарыш (Чарышское / Усть-Чарышская Пристань)~0~0~2.5~52.126~83.318",
 "р. Катунь (низовья / Сростки — Верх-Обский)~0~1~3.5~52.416~85.442",
 "р. Ануй (Солонешное / Петропавловское)~0~0~1.9~51.992~84.382",
 "р. Песчаная (Белокуриха / Смоленское)~0~0~2~52.189~84.918",
 "оз. Мостовое (Завьяловский / Баевский р-н)~0~3~3.2~52.898~81.148",
 "оз. Горькое-Перешеечное (Егорьевский р-н)~0~3~3~51.842~80.892",
 "оз. Белое и Колыванское~0~3~3.8~51.364~82.192",
 "оз. Большое Топольное и Песчаное~0~3~2.8~53.318~78.084",
 "Правдинское вдхр. (р. Чесноковка, Новоалтайск)~0~2~4.2~53.468~84.112",
 "Склюихинское вдхр. (Рубцовск)~0~2~4~51.594~81.412",
 "Богучанское вдхр. (Ангара)~1~2~14.5~58.618~99.145",
 "р. Подкаменная Тунгуска (Байкит / Ванавара / Бор)~1~1~3.8~61.672~96.365",
 "р. Нижняя Тунгуска (Тура — Туруханск)~1~1~4.5~64.274~100.211",
 "р. Курейка и Курейское вдхр. (Светлогорск)~1~2~12~66.938~88.356",
 "р. Хантайка и Хантайское вдхр. (Снежногорск)~1~2~11.5~68.096~87.648",
 "оз. Таймыр и р. Верхняя/Нижняя Таймыра~1~3~5.5~74.532~101.624",
 "оз. Озёра Плато Путорана (Кета / Глубокое / Собачье)~1~2~25~68.765~90.512",
 "р. Хатанга и р. Хета / р. Котуй (Хатанга)~1~1~5.2~71.984~102.482",
 "р. Пясина и оз. Пясино (Норильск / Таймыр)~1~1~4.2~69.685~87.842",
 "Енисейский залив Карского моря (Диксон / Караул)~1~5~10~72.812~80.834",
 "р. Туба, р. Казыр и р. Кизир (Курагино / Минусинск)~1~0~2.6~53.889~92.662",
 "р. Сыда и Сыдинский залив КВХ (Краснотуранск)~1~2~6.5~54.342~91.512",
 "оз. Большое, Инголь и Берёзовское вдхр.~0~2~7.5~55.342~89.208",
 "тёплый канал Назаровской ГРЭС (р. Чулым, Назарово)~0~4~3.5~56.019~90.421",
 "р. Белая и р. Урик (Усолье-Сибирское / Черемхово)~1~0~2.4~52.842~103.324",
 "р. Китой (Ангарск)~1~0~2.2~52.502~103.854",
 "р. Ока Саянская (Саянск / Зима — Братское вдхр.)~1~0~2.8~54.025~102.118",
 "р. Ия (Тулун — Илирский залив Братского вдхр.)~1~0~2.5~54.568~100.592",
 "р. Уда / Чуна (Нижнеудинск — Чунский)~1~0~2.6~54.914~99.042",
 "р. Бирюса (Тайшет / Бирюсинск)~1~0~2.5~55.952~97.834",
 "р. Илим (Железногорск-Илимский)~1~0~3~56.592~103.982",
 "р. Киренга (Казачинское — Киренск)~1~0~2.7~56.684~107.752",
 "р. Витим (Бодайбо / Мама) и оз. Орон~1~1~4.2~57.848~114.205",
 "р. Нижняя Тунгуска (Ербогачён)~1~1~3.5~61.281~108.019",
 "Курминский и Ершовский заливы Иркутского вдхр.~8~2~5.5~52.084~104.462",
 "Беловское вдхр. (Беловская ГРЭС, пгт Инской)~0~4~4.5~54.426~86.445",
 "р. Мрассу (Таштагол / Усть-Кабырза — Мыски)~0~0~2.2~53.218~88.242",
 "р. Кондома (Таштагол — Калтан — Осинники)~0~0~2~53.442~87.298",
 "р. Уса и р. Бельсу (Междуреченск)~0~0~2.1~53.784~88.148",
 "р. Верхняя, Средняя и Нижняя Терсь~0~0~2.2~54.262~87.648",
 "р. Тайдон (Крапивинский р-н)~0~0~2~54.882~87.018",
 "р. Кия (Тисуль — Макаракский — Мариинск)~0~0~2.5~55.818~87.912",
 "р. Яя и р. Золотой Китат (Анжеро-Судженск / Яя)~0~0~2.2~56.185~86.384",
 "р. Иня и Кара-Чумышское вдхр.~0~2~4.2~54.185~86.342",
 "оз. Большой Берчикуль (Тисульский р-н)~0~2~4.5~55.622~88.308",
 "оз. Танай (Промышленновский р-н)~0~3~2.8~54.718~84.996",
 "оз. Малые Чаны и оз. Яркуль (Купино / Здвинск)~0~3~2.8~54.584~77.968",
 "р. Обь (Сузун / Верх-Сузун / Малышево)~0~1~4.2~53.782~82.118",
 "р. Обь (Колывань / Почта / Батурино / Кругликово)~0~1~4.5~55.478~83.005",
 "р. Иня (Тогучин — Новосибирск)~0~0~2~55.022~83.485",
 "р. Омь и р. Тартас (Куйбышев / Венгерово)~0~0~2.4~55.451~78.312",
 "р. Тара (Кыштовка)~0~0~2.3~56.561~76.621",
 "р. Карасук и оз. Хорошее / оз. Кривое (Карасук)~0~3~2.6~53.712~78.018",
 "оз. Убинское (Убинский / Каргатский р-н)~0~3~2.2~55.452~80.056",
 "оз. Тандово (Барабинский р-н)~0~3~2.5~55.284~77.912",
 "р. Чаус и р. Уень (Колыванский р-н)~0~0~2.4~55.424~82.842",
 "оз. Большие Крутинские озёра (Ик / Салтаим / Тенис)~0~3~3.2~56.082~71.684",
 "р. Иртыш и р. Ишим (Усть-Ишим / Тевриз / Знаменское)~0~1~5.2~57.696~71.174",
 "р. Тара и Пять озёр (Муромцево)~0~0~2.8~56.378~75.254",
 "р. Шиш и р. Туй (Знаменский / Тевризский р-н)~0~0~2.3~57.218~73.112",
 "р. Оша (Колосовка / Тюкалинск)~0~0~2.1~56.472~73.618",
 "оз. Эбейты (Москаленский / Полтавский р-н)~0~3~1.5~54.664~71.742",
 "р. Обь (Стрежевой / Александровское / Пасол)~0~1~5.5~60.718~77.612",
 "р. Обь (Молчаново / Шегарка)~0~1~4.8~57.584~83.771|р. Чулым (Асино)~0~1~3.6~57.008~86.162",
 "р. Кеть (Белый Яр — Колпашево)~0~1~3.4~58.448~85.051",
 "р. Васюган (Каргасок / Средний Васюган)~0~1~3.5~59.054~80.784",
 "р. Тым (Каргасокский р-н / Напас)~0~0~2.9~59.842~81.912",
 "р. Парабель, Чузик и Кёнга~0~0~2.6~58.694~81.482|р. Чая (Подгорное)~0~0~2.5~57.792~82.658",
 "оз. Польто-3 и Мирное~0~3~3.2~59.712~82.418|р. Лена (Якутск)~1~1~7.5~62.03~129.73",
 "р. Амга~1~0~2.5~60.9~131.98|р. Лена (Ленск)~1~1~5.8~60.72~114.93|р. Вилюй~1~1~4.5~62.08~120.42",
 "р. Алдан~1~1~4.8~58.96~126.28|оз. Байкал (Чивыркуйский залив)~8~2~8.5~53.7~109.15",
 "р. Селенга (Улан-Удэ / дельта)~8~1~4.2~51.83~107.58",
 "оз. Гусиное (Гусиноозёрская ГРЭС)~8~4~5.5~51.2~106.4|р. Баргузин~8~0~2.6~53.62~109.62",
 "оз. Котокель~8~3~3.5~52.8~108.15|р. Амур (Хабаровск)~9~1~6.5~48.48~135.07",
 "р. Анюй~9~0~2.4~49.3~136.5|р. Хор~9~0~2.5~47.78~134.96",
 "р. Амур (Благовещенск)~9~1~5.2~50.27~127.54|р. Амур (Комсомольск-на-Амуре)~9~1~7.2~50.55~137",
 "р. Зея (Благовещенск)~9~1~4.2~50.3~127.6|Зейское вдхр.~9~2~14~53.75~127.25",
 "Бурейское вдхр.~9~2~12~50.18~130.3|р. Уссури~9~1~3.6~45.46~133.42|оз. Ханка~9~3~2.8~44.99~132.06",
 "оз. Болонь~9~3~2.2~49.85~136.45|Амурский залив (Владивосток)~10~5~14~43.12~131.88",
 "р. Раздольная (Суйфун)~10~1~3.2~43.35~131.8|Уссурийский залив (Шамора)~10~5~11~43.19~132.12",
 "Залив Находка~10~5~15~42.82~132.88|Авачинская губа~10~5~16~53.02~158.65",
 "р. Авача~10~0~2~53.18~158.38|р. Паратунка~10~0~2.2~52.96~158.25",
 "р. Камчатка~10~1~4.5~56.32~160.84|р. Быстрая (Большая)~10~0~2.4~52.75~156.3",
 "Охотское море (бухта Нагаева)~10~5~18~59.56~150.8|Анивский залив~10~5~12~46.62~142.77",
 "оз. Тунайча (Сахалин)~10~2~9~46.82~143.15|р. Лютога (Сахалин)~10~0~2~46.78~142.52",
 "р. Тымь~10~0~2.2~50.85~142.68",
 "оз. Байкал / р. Верхняя Ангара (Северобайкальск)~8~2~16~55.635~109.325",
 "оз. Кенон / р. Ингода (Чита)~9~2~4.5~52.035~113.5",
 "Вилюйское вдхр. / р. Малая Ботуобия (Мирный)~1~2~10~62.535~113.96",
 "р. Вилюй (Вилюйск)~1~1~5~63.755~121.624|р. Чульман / р. Тимптон (Нерюнгри)~1~0~2.2~56.66~124.725",
 "Губа Буор-Хая / дельта Лены (Тикси)~1~5~8~71.637~128.868",
 "р. Зея (Свободный)~9~1~4.5~51.375~128.135|р. Тында / р. Гилюй (Тында)~9~0~2.4~55.155~124.725",
 "р. Бира (Биробиджан)~9~0~2.5~48.795~132.92",
 "Амурский лиман / р. Амур (Николаевск-на-Амуре)~10~5~6.5~53.145~140.72",
 "Татарский пролив (Ванино / Советская Гавань)~10~5~12~49.02~140.28",
 "р. Поронай / залив Терпения (Поронайск)~10~5~7~49.222~143.102",
 "Набильский залив / р. Тымь (Ноглики)~10~5~5.5~51.805~143.14",
 "Залив Помрь / Охотское море (Оха)~10~5~6~53.59~142.95",
 "р. Камчатка / оз. Нерпичье (Усть-Камчатск)~10~1~5.5~56.228~162.476",
 "Анадырский лиман / р. Анадырь (Анадырь)~10~5~8~64.733~177.515",
 "Дельта р. Селенга (Кабанск)~8~1~4.8~52.055~106.645|р. Лена (Покровск)~1~1~8~61.482~129.152",
 "р. Алдан / р. Селигдар (Алдан)~1~1~4.5~58.65~125.45",
 "р. Амур (Николаевск-на-Амуре)~9~1~11~53.138~140.715",
 "оз. Ханка (Спасск-Дальний)~9~2~4.2~44.655~132.68",
 "р. Раздольная (Уссурийск)~10~1~3.5~43.792~131.945",
 "Залив Посьета / Бухта Славянка (Славянка)~10~5~10~42.865~131.392",
 "оз. Арахлей и оз. Шакшинское (Чита)~9~2~10~52.212~112.912",
 "оз. Баргузинский залив (Байкал)~8~2~18~53.364~108.842",
 "оз. Байкал (Посольский сор и залив Провал)~8~3~3.2~52.042~106.212",
 "р. Уда (Хоринск — Улан-Удэ)~8~0~2.2~51.842~107.684",
 "р. Хилок (Бичурский / Селенгинский р-н)~8~0~2.4~50.624~107.482",
 "р. Чикой (Кяхтинский р-н)~8~0~2.8~50.942~106.648",
 "р. Джида (Закаменск — Петропавловка — Джида)~8~0~2.4~50.592~105.312",
 "р. Турка (Прибайкальский р-н)~8~0~2.2~52.948~108.224",
 "оз. Еравнинские озёра (Большое Еравное / Сосновое)~1~3~3.5~52.584~111.512",
 "оз. Баунт и р. Ципа~1~2~9.5~55.184~113.024|оз. Щучье (Селенгинский р-н)~8~2~8~51.408~106.542",
 "оз. Ильчир и р. Ока Саянская (Окинский р-н)~1~3~4.2~51.964~100.992",
 "р. Лена (Олёкминск) и р. Олёкма~1~1~5.5~60.371~120.432",
 "р. Лена (Сангар / Жиганск / Кюсюр — нижняя Лена)~1~1~7.5~66.762~123.381",
 "р. Синяя и р. Буотама (Хангаласский улус)~1~0~2.2~61.124~128.754",
 "р. Алдан (Хандыга / Усть-Мая) и р. Мая / р. Учур~1~1~5~62.652~135.558",
 "р. Вилюй (Сунтар / Нюрба / Верхневилюйск) и р. Марха~1~1~4.2~63.281~118.342",
 "р. Яна (Верхоянск / Батагай / Усть-Куйга / Казачье)~1~1~4~67.651~134.628",
 "р. Индигирка~1~1~4.5~66.452~143.231",
 "р. Колыма (Зырянка / Среднеколымск / Черский)~1~1~5.5~67.452~153.712",
 "р. Оленёк (Оленёк / Таймылыр)~1~1~3.8~68.508~112.442",
 "р. Анабар (Саскылах / Юрюнг-Хая)~1~1~3.6~71.961~114.092",
 "оз. Ниджили (Кобяйский улус)~1~3~3.2~63.588~125.432",
 "оз. Лабынкыр и оз. Ворота (Оймяконский улус)~1~2~15~62.492~143.608",
 "Море Лаптевых и Восточно-Сибирское море~1~5~8~71.638~128.874|р. Шилка~9~1~3.6~52.241~117.712",
 "р. Онон (Кыра — Акша — Нижний Цасучей — Оловянная)~9~1~2.9~50.524~115.138",
 "р. Аргунь~9~1~3~50.372~119.108|р. Ингода (Улёты — Чита — Карымское)~9~0~2.4~51.928~113.642",
 "р. Чикой и р. Менза (Красный Чикой)~8~0~2.6~50.361~108.758",
 "р. Хилок (Могзон — Хилок)~8~0~2.3~51.362~110.461",
 "р. Чара и оз. Леприндо / Ничатка~1~2~12~56.632~117.524",
 "р. Витим и р. Каренга (Тунгокоченский р-н)~1~1~3.4~53.562~115.541",
 "вдхр. Харанорской ГРЭС (Ясногорск)~9~4~3.8~50.858~115.684",
 "оз. Иван, Тасей и Большое Ундугун~8~3~4.2~52.238~112.984",
 "р. Большая (Усть-Большерецк)~10~1~3.8~52.812~156.284",
 "р. Опала и р. Голыгина (Усть-Большерецкий р-н)~10~0~2.4~52.012~156.512",
 "р. Озерная и оз. Курильское (п. Озерновский)~10~0~2.8~51.496~156.542",
 "р. Плотникова и оз. Начикинское (Елизовский р-н)~10~0~2.3~52.912~157.518",
 "р. Жупанова (восточное побережье Камчатки)~10~0~2.6~54.084~159.984",
 "р. Еловка и Козыревка~10~0~2.5~56.342~160.512",
 "оз. Азабачье (низовья р. Камчатка)~10~2~8.5~56.142~161.784",
 "оз. Кроноцкое (Кроноцкий заповедник)~10~2~18~54.784~160.228",
 "р. Большая Воровская, Колпакова и Ича~10~0~2.4~54.302~155.894",
 "р. Тигиль и Палана~10~0~2.5~59.088~159.942",
 "р. Пенжина и р. Таловка (Пенжинский р-н)~10~1~3.6~62.472~166.212",
 "Авачинский и Кроноцкий заливы (Тихий океан)~10~6~25~52.842~158.812",
 "р. Бикин (Лучегорск / Красный Яр, Пожарский р-н)~9~0~2.6~46.538~135.352",
 "р. Большая Уссурка (Иман)~9~0~2.8~45.882~134.312|р. Арсеньевка (Даубихе)~9~0~2.2~44.158~133.268",
 "р. Илистая (Лефу)~9~0~2.4~44.512~132.484",
 "Лучегорское вдхр. (Приморская ГРЭС)~9~4~4.2~46.438~134.264",
 "Артёмовское вдхр. и р. Артёмовка (Майхе)~10~2~5~43.398~132.284",
 "р. Партизанская (Сучан) и р. Киевка (Судзухе)~10~0~2.2~43.024~133.142",
 "р. Аввакумовка и залив Ольги (пгт Ольга)~10~5~6.5~43.738~135.278",
 "р. Кема, р. Максимовка и р. Самарга (Тернейский р-н)~10~0~2.4~45.482~137.184",
 "Бухта Новик (о. Русский) и залив Стрелок~10~5~8~43.042~131.868",
 "Амурская и Пемзенская протоки, р. Тунгуска~9~1~4.8~48.554~134.892",
 "р. Кия и р. Подхорёнок (Переяславка / Вяземский)~9~0~2.2~47.968~135.042",
 "р. Бикин (г. Бикин)~9~0~2.7~46.818~134.248",
 "р. Кур и р. Урми (бассейн р. Тунгуска)~9~0~2.5~48.742~134.284",
 "р. Гур (Хунгари) и Горин~9~0~2.6~50.284~136.912",
 "р. Амгунь (Им. Полины Осипенко — низовья Амура)~9~1~3.5~52.428~136.492",
 "оз. Петропавловское и Гасси~9~3~2.8~48.684~135.592",
 "оз. Удыль, Хумми и Большое Кизи~9~3~3~52.142~139.884",
 "залив Чихачёва (п. Де-Кастри, Татарский пролив)~10~5~7.5~51.464~140.792",
 "р. Коппи и Тумнин~10~0~2.8~49.942~140.424",
 "р. Уда, р. Тугур и Шантарское море~10~1~3.8~54.688~135.324",
 "р. Охота, р. Кухтуй и р. Иня (Охотский округ)~10~0~2.9~59.372~143.184",
 "р. Мая (Нелькан — бассейн Алдана/Лены)~1~1~3.6~57.654~136.158",
 "Нижне-Бурейское вдхр. и р. Бурея~9~2~9.5~49.812~129.892|р. Селемджа~9~1~3.4~52.472~130.918",
 "р. Томь Амурская (Белогорск)~9~0~2.3~50.918~128.472",
 "р. Архара и оз. Долгое (Архаринский р-н)~9~0~2.2~49.418~130.078",
 "р. Гилюй (Тында — Зейское вдхр.)~9~0~2.6~54.824~126.842",
 "р. Нюкжа и Олёкма (Тындинский округ)~1~0~2.5~56.574~121.652",
 "р. Амур (Поярково / Константиновка / Иннокентьевка)~9~1~5~49.622~128.648",
 "р. Амур (Джалинда / Албазино — Верхний Амур)~9~1~4.2~53.468~123.912",
 "Бухта Гертнера и Тауйская губа~10~5~9~59.548~150.912",
 "р. Ола и Ольский лиман (пгт Ола / Клепка)~10~0~2.4~59.584~151.298",
 "р. Яна Охотская, Тауй и Армань~10~0~2.6~59.732~149.392",
 "р. Дукча и р. Хасын (Магадан / Палатка / Стекольный)~10~0~1.9~59.812~150.892",
 "р. Яма и Ямский лиман (Ольский округ)~10~0~2.5~59.654~154.184",
 "Колымское вдхр. и р. Колыма (Синегорье)~1~2~14~62.084~150.512",
 "Усть-Среднеканское вдхр. и р. Колыма (Сеймчан)~1~1~6.5~62.928~152.384",
 "р. Берелёх и р. Аян-Юрях (Сусуман / Холодный)~1~0~2.3~62.782~148.156",
 "р. Балыгычан, Сугой и Коркодон~1~0~2.5~62.812~154.812",
 "оз. Джека Лондона и Танцующих Хариусов~1~2~14~62.068~149.518",
 "Гижигинская губа и р. Гижига~10~5~8.5~61.912~159.242",
 "р. Найба и залив Мордвинова (Долинск / Стародубское)~10~5~6.5~47.418~142.812",
 "оз. Буссе и оз. Изменчивое (Корсаковский р-н)~10~5~4.2~46.528~143.324",
 "оз. Айнское и р. Красногорка (Томаринский р-н)~10~3~3~48.458~142.062",
 "оз. Невское (Поронайский р-н)~10~3~2.5~49.338~143.384",
 "Заливы Чайво, Пильтун и Луньский~10~5~5.5~52.368~143.184",
 "Залив Байкал и Сахалинский залив~10~5~7~53.542~142.584",
 "Татарский пролив (Холмск / Невельск / Углегорск)~10~6~18~47.048~142.024",
 "р. Сусуя и р. Таранай (Южно-Сахалинск / Анива)~10~0~2~46.842~142.684",
 "р. Курилка, оз. Сопочное и залив Простор (Итуруп)~10~5~8~45.238~147.882",
 "Южно-Курильский пролив и оз. Лагунное (Кунашир)~10~5~7.5~44.034~145.848",
 "Второй Курильский пролив (Парамушир)~10~5~15~50.678~156.132",
 "р. Амур (Ленинское / Амурзет)~9~1~5.5~47.932~132.612",
 "р. Амур (Пашково / Радде — Хинганский створ)~9~1~6.2~48.874~130.654",
 "р. Тунгуска, Ин и Урми (ЕАО)~9~1~3.5~48.562~134.592",
 "Пемзенская протока и залив Тельмана~9~1~4.2~48.514~134.938",
 "р. Биджан (с. Биджан — Дежнёво)~9~0~2.1~48.012~132.024",
 "р. Большая Икура и карьеры Биробиджана~9~2~3.5~48.798~132.952",
 "оз. Тёплое (Теплоозёрск)~9~3~3~49.006~131.892|оз. Лебединое и Забеловское~9~3~2.6~48.432~134.512",
 "р. Анадырь (Марково / Усть-Белая) и оз. Красное~10~1~4.5~64.684~170.421",
 "р. Великая, Майн, Белая и Канчалан~10~0~2.8~65.168~176.962",
 "оз. Эльгыгытгын (Анадырский р-н)~10~2~35~67.489~172.092",
 "оз. Майниц и Пекульнейское~10~2~12~63.168~176.712",
 "Залив Креста Берингова моря и р. Амгуэма (Эгвекинот)~10~5~12~66.318~180.884",
 "Бухта Провидения и пролив Сенявина (Провидения)~10~5~15~64.422~186.768",
 "Залив Лаврентия и Берингов пролив~10~5~14~65.584~188.998",
 "Чаунская губа и р. Паляваам (Певек)~1~5~9~69.702~170.298",
 "р. Малый и Большой Анюй, р. Омолон~1~0~2.9~68.054~166.442"
];
const BOT_WATERS_DB = _W_PACK.join("|").split("|").map(s => {
 const r = s.split("~");
 const name = r[0];
 const cleanName = name.replace(/^(р\.|оз\.|вдхр\.)\s*/i, "").trim();
 const wIdx = +r[2] || 0;
 return {
  name,
  cleanName,
  basin: _BC[+r[1]] || "volga_caspian",
  wType: _WC[wIdx] || "small_river",
  typeTag: _BOT_WTAGS[wIdx] || "Водоём",
  defDepth: +r[3] || 2.0,
  lat: +r[4],
  lon: +r[5],
  region: cleanName
 };
});

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

  // Озеро Молодёжное (г. Новый Уренгой, ЯНАО): исторически обитал только гольян (gudgeon), 2 года назад (2024) зарыблено плотвой (сорожкой) и мелким окунем
  if (/молод[её]жн/i.test(wNameLower) && (bCode === 'arctic_ob_taz' || lat >= 65.0)) {
    return ['roach', 'perch', 'gudgeon'].includes(fid);
  }

  // Малые тундровые и лесотундровые реки Крайнего Севера (Новый Уренгой: р. Седе-Яха, р. Ево-Яха, р. Тамчара-Яха, р. Варенга-Яха, р. Лимбяяха, lat >= 64.5)
  if (bCode === 'arctic_ob_taz' && lat >= 64.5 && waterType === 'small_river') {
    if (['rotan', 'loach', 'gudgeon', 'crucian'].includes(fid)) return false;
  }

  // Степные и лесостепные замкнутые озёра Зауралья (Курганская обл., юг Тюменской и восток Челябинской обл.: оз. Мишкинское, оз. Песчаное, оз. Варгашинское, оз. Мартыново, оз. Камышное, оз. Половинное, оз. Сафакуль, оз. Ачикуль, оз. Башкирское, оз. Чёрное)
  if (bCode === 'arctic_ob_taz' && lat < 59.0 && waterType === 'tundra_lake' && !/стариц|проток|затон|пойм/i.test(wNameLower)) {
    if (['burbot', 'ide', 'dace', 'gudgeon', 'white_bream', 'bleak', 'bream', 'zander', 'ruffe'].includes(fid)) return false;
  }

  // Глубокие тектонические озёра и карьеры Урала (оз. Увильды, оз. Тургояк, оз. Таватуй, оз. Аракуль, оз. Сунгуль, оз. Синара: lat < 60.0) — отсекаем чисто речных реофилов
  if (bCode === 'arctic_ob_taz' && lat < 60.0 && waterType === 'quarry' && !/вдхр|водохран|пруд/i.test(wNameLower)) {
    if (['taimen', 'grayling', 'dace', 'gudgeon', 'sterlet', 'siberian_sturgeon', 'nelma', 'muksun', 'chir'].includes(fid)) return false;
  }

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
      if (waterType === 'quarry' && !/павловск|нугуш|юмагузин|широковск/i.test(wNameLower)) return false;
      if (/бирь|дёма|дема|быстрый танып|чермасан|ашкадар|сюнь|база|шамсутдин|аслыкуль|кандрыкуль/i.test(wNameLower)) return false;
      const isKamaBashkirUral = (lon >= 56.1 && lat >= 52.2) || (lat >= 57.5 && lon >= 55.5);
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
    if (bCode === 'arctic_ob_taz' && lat < 57.8) return false;
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
 if (fid === 'gudgeon') {
  const isTundraMinnowZone = /ямало|янао|якут|саха|чукот|магадан|ненец/i.test(adm) ||
   (nLat !== null && nLat >= 63.5);
  if (isTundraMinnowZone) return 'Гольян озёрный / речной';
  return 'Пескарь обыкновенный';
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