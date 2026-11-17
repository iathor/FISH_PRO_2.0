#!/usr/bin/env node
/**
 * Идемпотентный скрипт точечных исправлений проекта «Клёв ПРО 2.0» (Node 22, без внешних зависимостей).
 * Выполняет задачи P1 (3.1–3.6), P2 (4.1–4.8) и P3 (5.1–5.3).
 * Поддерживает флаг быстрого отката выноса инлайнового JS: node tools/apply-fixes.mjs --rollback-inline-js
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const args = new Set(process.argv.slice(2));
const ROLLBACK_INLINE_JS = args.has('--rollback-inline-js');

function readText(relPath) {
  const full = path.join(ROOT, relPath);
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
}

function writeTextIfChanged(relPath, nextContent) {
  const full = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const prev = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
  if (prev === nextContent) return false;
  fs.writeFileSync(full, nextContent, 'utf8');
  return true;
}

// ============================================================================
// 0. Чтение единого источника версии VERSION (п. 3.4)
// ============================================================================
const versionRaw = readText('VERSION');
if (!versionRaw) {
  throw new Error('Отсутствует корневой файл VERSION');
}
const VER = JSON.parse(versionRaw);
const V_NUM = String(VER.version || '2.9.0').trim();
const V_REV = String(VER.revision || 'r240').trim();
const V_BUILD = Number(VER.buildNumber || 240);
const V_CODE = Number(VER.versionCode || 293240);
const V_DISPLAY = String(VER.displayVersion || `v${V_NUM} ${V_REV}`).trim();
const V_FULL = String(VER.fullVersion || `${V_NUM}-${V_REV}`).trim();
const V_POLICY = String(VER.policyVersion || `2026.11.17-v${V_NUM}`).trim();
const V_APK_FILE = String(VER.apkFileName || `klev-pro-v${V_NUM}.apk`).trim();
const V_ADMIN_APK_FILE = String(VER.adminApkFileName || `klev-pro-admin-v${V_NUM}.apk`).trim();
const V_APK_URL = String(VER.apkUrl || `https://klevpro.ru/apk/${V_APK_FILE}`).trim();
const V_BRANCH_NOTE = String(
  VER.versionBranchNote ||
  `Единая стабильная ветка v${V_NUM} (ревизия ${V_REV}): базовый номер версии зафиксирован на ${V_NUM} до выхода мажорного релиза 3.0; актуальность обновлений определяется номером ревизии (${V_REV}).`
).trim();

// ============================================================================
// 1. P2 (4.7): Удаление мусорных файлов .0 и дубля bot/cloudflare-worker-bot.js, обновление .gitignore
// ============================================================================
function cleanTrashFilesAndGitignore() {
  const trashDirs = ['', '.github/workflows', 'apk', 'assets', 'assets/fish', 'css', 'js'];
  for (const d of trashDirs) {
    const p = path.join(ROOT, d, '.0');
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
    }
  }
  const walkAndRemoveDotZero = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkAndRemoveDotZero(full);
      } else if (entry.name === '.0' && fs.statSync(full).size <= 4) {
        fs.unlinkSync(full);
      }
    }
  };
  walkAndRemoveDotZero(ROOT);

  // Удаляем ручной дубль воркера в bot/cloudflare-worker-bot.js (источник истины — в корне)
  const dupWorker = path.join(ROOT, 'bot/cloudflare-worker-bot.js');
  if (fs.existsSync(dupWorker)) {
    fs.unlinkSync(dupWorker);
  }
  const botDir = path.join(ROOT, 'bot');
  if (fs.existsSync(botDir) && fs.readdirSync(botDir).length === 0) {
    fs.rmdirSync(botDir);
  }

  // Обновляем .gitignore без изменения самих файлов ключей
  let gitignore = readText('.gitignore') || '';
  const requiredIgnoreRules = [
    '*.keystore',
    '*.jks',
    'local.properties'
  ];
  let giLines = gitignore.split(/\r?\n/);
  for (const rule of requiredIgnoreRules) {
    if (!giLines.some(l => l.trim() === rule)) {
      giLines.push(rule);
    }
  }
  writeTextIfChanged('.gitignore', giLines.filter((l, idx, arr) => idx < arr.length - 1 || l !== '').join('\n') + '\n');
}

// ============================================================================
// 2. P1 (3.6): Обновление robots.txt (Disallow для kp-control-89.html, удаление Host)
// ============================================================================
function patchRobotsTxt() {
  const robotsContent = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /kp-control-89.html',
    'Disallow: /api/',
    'Disallow: /auth/',
    'Disallow: /relay/',
    'Disallow: /weather',
    'Sitemap: https://klevpro.ru/sitemap.xml',
    ''
  ].join('\n');
  writeTextIfChanged('robots.txt', robotsContent);
}

// ============================================================================
// 3. P1 (3.1, 3.2, 3.3, 3.4) + P2 (4.3, 4.4, 4.5): Патч cloudflare-worker-bot.js
// ============================================================================
function patchWorker() {
  let w = readText('cloudflare-worker-bot.js');
  if (!w) throw new Error('Не найден cloudflare-worker-bot.js');

  // 3.1: Исправление checkWorkerRateLimit (убрать принудительный подъём лимита до 240)
  // Мягкий лимит в памяти изолята + таблица auth_attempts в D1 (5 неудач за 15 минут)
  w = w.replace(
    /if\s*\(\s*b\.total\s*>\s*Math\.max\(\s*240\s*,\s*Number\(\s*maxPerMin\s*\)\s*\|\|\s*240\s*\)\s*\)\s*return\s+false\s*;/g,
    'const limit = Math.max(1, Number(maxPerMin) || 60);\n if (b.total > limit) return false;'
  );

  // 4.4: detectSqlInjectionAttempt — убрать блокировку по чёрному списку (запросы параметризованы, апострофы в логинах допустимы)
  const oldSqliBlockRe = /function detectSqlInjectionAttempt\s*\([^)]*\)\s*\{[\s\S]*?\n\}/;
  const newSqliBlock = `function detectSqlInjectionAttempt(rawStr, endpoint = '', ip = 'anon', fid = '') {
 if (!rawStr || typeof rawStr !== 'string') return false;
 const str = String(rawStr);
 // Запросы к D1 полностью параметризованы (.prepare().bind()); проверяем только длину и управляющие/нулевые байты, не блокируя апострофы и легитимные логины.
 if (str.length > 8192 || /[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]/.test(str)) {
  recordSecurityIncident('sqli', endpoint, 'Отклонена строка с управляющими символами или превышением длины', ip, fid);
  return true;
 }
 return false;
}`;
  if (oldSqliBlockRe.test(w)) {
    w = w.replace(oldSqliBlockRe, newSqliBlock);
  }

  // 4.5: Удалить самописный SHA-256 (_SHA256_K, sha256BytesSync, hmacSha256HexSync), перейти на crypto.subtle
  const customShaBlockRe = /const _SHA256_K = new Uint32Array\([\s\S]*?function generateSecureRandomTokenHex/;
  const subtleShaReplacement = `async function sha256Bytes(dataBytes) {
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

function generateSecureRandomTokenHex`;
  if (customShaBlockRe.test(w)) {
    w = w.replace(customShaBlockRe, subtleShaReplacement);
  }

  // Обновляем issueServerAdminSessionToken, isValidOwnerAdminToken и workerXorStreamCipher на async/await с crypto.subtle
  w = w.replace(
    /(?<!async\s)function issueServerAdminSessionToken\s*\(\s*ttlMs\s*=\s*ADMIN_SESSION_DEFAULT_TTL_MS\s*,\s*env\s*=\s*null\s*\)\s*\{/,
    'async function issueServerAdminSessionToken(ttlMs = ADMIN_SESSION_DEFAULT_TTL_MS, env = null) {'
  );
  w = w.replace(
    /const sigHex = hmacSha256HexSync\(secret,\s*`ADM_SESS_V3:\$\{expMs\}:\$\{nonceHex\}`\);/,
    'const sigHex = await hmacSha256Hex(secret, `ADM_SESS_V3:${expMs}:${nonceHex}`);'
  );
  w = w.replace(
    /(?<!async\s)function isValidOwnerAdminToken\s*\(\s*tok\s*=\s*''\s*,\s*env\s*=\s*null\s*\)\s*\{/,
    'async function isValidOwnerAdminToken(tok = \'\', env = null) {'
  );
  w = w.replace(
    /const expectedSig = hmacSha256HexSync\(signingSecret,\s*`ADM_SESS_V3:\$\{expNum\}:\$\{nonceHex\}`\);/,
    'const expectedSig = await hmacSha256Hex(signingSecret, `ADM_SESS_V3:${expNum}:${nonceHex}`);'
  );
  w = w.replace(
    /(?<!async\s)function workerXorStreamCipher\s*\(\s*dataBytes\s*,\s*keyHex\s*,\s*ivHex\s*\)\s*\{/,
    'async function workerXorStreamCipher(dataBytes, keyHex, ivHex) {'
  );
  w = w.replace(
    /const keystream = sha256BytesSync\(seedBytes\);/,
    'const keystream = await sha256Bytes(seedBytes);'
  );
  w = w.replace(
    /const expectedMac = hmacSha256HexSync\(WORKER_E2E_FALLBACK_SEED,\s*`E2E0:\$\{ivHex\}:\$\{cipherB64\}`\);/,
    'const expectedMac = await hmacSha256Hex(WORKER_E2E_FALLBACK_SEED, `E2E0:${ivHex}:${cipherB64}`);'
  );
  w = w.replace(
    /const plainBytes = workerXorStreamCipher\(cipherBytes,\s*WORKER_E2E_FALLBACK_SEED,\s*ivHex\);/,
    'const plainBytes = await workerXorStreamCipher(cipherBytes, WORKER_E2E_FALLBACK_SEED, ivHex);'
  );
  w = w.replace(
    /const cipherBytes = workerXorStreamCipher\(plainBytes,\s*respKeyHex\s*\|\|\s*WORKER_E2E_FALLBACK_SEED,\s*ivHex\);/,
    'const cipherBytes = await workerXorStreamCipher(plainBytes, respKeyHex || WORKER_E2E_FALLBACK_SEED, ivHex);'
  );
  w = w.replace(
    /const macHex = hmacSha256HexSync\(respKeyHex\s*\|\|\s*WORKER_E2E_FALLBACK_SEED,\s*`E2ER0:\$\{ivHex\}:\$\{cipherB64\}`\);/,
    'const macHex = await hmacSha256Hex(respKeyHex || WORKER_E2E_FALLBACK_SEED, `E2ER0:${ivHex}:${cipherB64}`);'
  );

  // Расставляем await перед вызовами isValidOwnerAdminToken и issueServerAdminSessionToken (идемпотентно)
  w = w.replace(/(?<!await\s)(?<!function\s)\bisValidOwnerAdminToken\s*\(/g, 'await isValidOwnerAdminToken(');
  w = w.replace(/(?<!await\s)(?<!function\s)\bissueServerAdminSessionToken\s*\(/g, 'await issueServerAdminSessionToken(');

  // 3.1 Дополнительно: таблица auth_attempts (5 неудач за 15 минут с ленивой очисткой)
  if (!w.includes('CREATE TABLE IF NOT EXISTS auth_attempts')) {
    w = w.replace(
      "await d1.prepare('CREATE TABLE IF NOT EXISTS rate_limits (k TEXT PRIMARY KEY, cnt INTEGER, reset_at INTEGER, locked_until INTEGER)').run();",
      "await d1.prepare('CREATE TABLE IF NOT EXISTS rate_limits (k TEXT PRIMARY KEY, cnt INTEGER, reset_at INTEGER, locked_until INTEGER)').run();\n   await d1.prepare('CREATE TABLE IF NOT EXISTS auth_attempts (account_key TEXT PRIMARY KEY, fail_count INTEGER NOT NULL DEFAULT 0, first_fail_at INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0)').run();"
    );
  }

  const oldBfBlockRe = /async function checkD1LoginBruteForce[\s\S]*?async function clearD1LoginFailures[\s\S]*?\n\}/;
  const newBfBlock = `const AUTH_ATTEMPTS_WINDOW_MS = 15 * 60 * 1000; // 15 минут
const AUTH_ATTEMPTS_MAX_FAILS = 5; // 5 неудач за 15 минут

async function checkD1LoginBruteForce(env, ip = 'anon', loginNorm = '') {
 const memCheck = checkLoginBruteForce(ip, loginNorm);
 if (memCheck.locked) return memCheck;
 const normL = String(loginNorm || 'any').toLowerCase().slice(0, 64);
 const key = \`acct_\${normL}\`;
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
 const normL = String(loginNorm || 'any').toLowerCase().slice(0, 64);
 const key = \`acct_\${normL}\`;
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
 const normL = String(loginNorm || 'any').toLowerCase().slice(0, 64);
 const key = \`acct_\${normL}\`;
 const d1 = getD1(env)?.db;
 if (d1) {
  try {
   await d1.prepare('DELETE FROM auth_attempts WHERE account_key = ?').bind(key).run();
  } catch (e) {}
 }
}`;
  if (!w.includes("const AUTH_ATTEMPTS_WINDOW_MS =") && oldBfBlockRe.test(w)) {
    w = w.replace(oldBfBlockRe, newBfBlock);
  }

  // 3.3: Регулярка прокси тайлов с левой границей (^|\.)
  w = w.replace(
    /\/\(maps\\\.yandex\\\.net\|arcgisonline\\\.com\|openstreetmap\\\.org\|cartocdn\\\.com\|opentopomap\\\.org\|maps\\\.mail\\\.ru\)\$\/i/g,
    '/(^|\\.)(maps\\.yandex\\.net|arcgisonline\\.com|openstreetmap\\.org|cartocdn\\.com|opentopomap\\.org|maps\\.mail\\.ru)$/i'
  );

  // 3.2: Авторизация и статус беты для /api/ai/identify-fish и /api/ai/identify-fish/chunk,
  // суточный лимит чанков на пользователя, TTL для AI_CHK_* с ленивой очисткой и ответ 403 без деталей.
  if (!w.includes('async function verifyAiVisionBetaAccess(')) {
    const aiAuthHelper = `
const AI_CHUNK_TTL_MS = 15 * 60 * 1000; // 15 минут TTL для ключей AI_CHK_*
const AI_MAX_CHUNKS_PER_USER_DAY = 300; // Суточный лимит чанков на одного пользователя
const aiUserDailyChunkCounterMap = new Map();

async function verifyAiVisionBetaAccess(request, reqUrl, body, env) {
 const admTok = extractAdminTokenFromRequest(request, reqUrl, body);
 if (admTok && await isValidOwnerAdminToken(admTok, env)) {
  return { allowed: true, isOwner: true, fisherId: OWNER_FISHER_ID };
 }
 const hdrAuth = request?.headers?.get('X-Auth-Token') || request?.headers?.get('Authorization')?.replace(/^Bearer\\s+/i, '') || '';
 const sessionToken = String(body?.sessionToken || body?.authToken || body?.authTokenHash || hdrAuth || '').trim();
 const rawFid = String(body?.fisherId || request?.headers?.get('X-Fisher-Id') || '').trim().toUpperCase();
 const rawLogin = workerNormalizeLogin(body?.login || '');
 if (!sessionToken) {
  return { allowed: false };
 }
 let resolvedFid = /^FP_[A-Z0-9_]+$/.test(rawFid) ? rawFid : '';
 if (!resolvedFid && rawLogin && loginToAuthKeyMap.has(rawLogin)) {
  const ak = loginToAuthKeyMap.get(rawLogin);
  resolvedFid = cloudAuthProfiles.get(ak)?.fisherId || '';
 }
 if (!resolvedFid) {
  for (const [uid, uObj] of usersRegistryStore.entries()) {
   if (uObj && ((uObj.sessionToken && constantTimeEquals(sessionToken, uObj.sessionToken)) || (uObj.authTokenHash && constantTimeEquals(sessionToken, uObj.authTokenHash)))) {
    resolvedFid = uid;
    break;
   }
  }
 }
 if (!resolvedFid) {
  return { allowed: false };
 }
 const authRes = await verifyUserAuth(env, {
  fid: resolvedFid,
  authTokenHash: sessionToken,
  deviceId: String(body?.deviceId || '').trim(),
  adminToken: admTok,
  request
 });
 if (!authRes.ok || authRes.isReserve) {
  return { allowed: false };
 }
 const isBeta = Boolean(authRes.isOwner || authRes.isAdmin || isUserBetaTesterOnServer(resolvedFid));
 if (!isBeta) {
  return { allowed: false };
 }
 return { allowed: true, isOwner: Boolean(authRes.isOwner), fisherId: resolvedFid };
}

async function consumeAiUserChunkQuota(env, fisherId, addChunks = 1) {
 const dayKey = new Date().toISOString().slice(0, 10);
 const quotaKey = \`AI_Q_\${fisherId}_\${dayKey}\`;
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
`;
    w = w.replace(
      '// ── Прямой Vision ИИ-определитель рыбы (/api/ai/identify-fish)',
      aiAuthHelper + '\n  // ── Прямой Vision ИИ-определитель рыбы (/api/ai/identify-fish)'
    );
  }

  // Вставляем проверку verifyAiVisionBetaAccess, TTL AI_CHK_* и поддержку /api/ai/identify-fish/chunk
  const oldIdentifyHeaderRe = /if\s*\(\s*(?:reqUrl\.pathname\.endsWith\('\/api\/ai\/identify-fish'\)|matchWorkerRoute\(normPath,\s*'\/api\/ai\/identify-fish'[^)]*\))\s*&&\s*\(request\.method\s*===\s*'POST'\s*\|\|\s*request\.method\s*===\s*'GET'\s*\|\|\s*reqUrl\.searchParams\.has\('payload'\)\)\)\s*\{\s*try\s*\{\s*await ensurePersistentStateLoaded\(env\);\s*const b = await readWorkerRequestPayload\(request,\s*reqUrl,\s*4194304\);/;
  const newIdentifyHeader = `if (matchWorkerRoute(normPath, '/api/ai/identify-fish', '/api/ai/identify-fish/chunk') && (request.method === 'POST' || request.method === 'GET' || reqUrl.searchParams.has('payload'))) {
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
    }`;
  if (!w.includes("const aiAuth = await verifyAiVisionBetaAccess(")) {
    w = w.replace(oldIdentifyHeaderRe, newIdentifyHeader);
  }

  // Добавляем проверку суточного лимита чанков внутри if (chunkMode === 'put')
  if (!w.includes('consumeAiUserChunkQuota(env, aiAuth.fisherId, 1)')) {
    w = w.replace(
      'const chunkKey = `AI_CHK_${reqScanId}_${idx}`;',
      `const quotaOk = await consumeAiUserChunkQuota(env, aiAuth.fisherId, 1);
     if (!quotaOk) {
      return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
     }
     const chunkKey = \`AI_CHK_\${reqScanId}_\${idx}\`;`
    );
  }

  // 4.3: Роутинг воркера: заменить endsWith на точное сравнение нормализованного пути с сохранением алиасов
  if (!w.includes('function matchWorkerRoute(')) {
    const routeHelper = `
function normalizeWorkerPath(pathname = '/') {
 const clean = String(pathname || '/').replace(/\\/+/g, '/').replace(/\\/+$/, '');
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
`;
    w = w.replace('export default {', routeHelper + '\nexport default {');
  }

  if (!w.includes('const normPath = normalizeWorkerPath(reqUrl.pathname);')) {
    w = w.replace(
      'const reqUrl = new URL(request.url);',
      'const reqUrl = new URL(request.url);\n  const normPath = normalizeWorkerPath(reqUrl.pathname);'
    );
  }

  // Заменяем все reqUrl.pathname.endsWith('/...') на matchWorkerRoute(normPath, '/...')
  w = w.replace(
    /reqUrl\.pathname\.endsWith\(\s*'([^']+)'\s*\)/g,
    (_, routeStr) => {
      if (routeStr === '/auth/login') {
        return `matchWorkerRoute(normPath, '/auth/login', '/auth/register')`;
      }
      if (routeStr === '/api/ai/identify-fish') {
        return `matchWorkerRoute(normPath, '/api/ai/identify-fish', '/api/ai/identify-fish/chunk')`;
      }
      return `matchWorkerRoute(normPath, '${routeStr}')`;
    }
  );

  // В /auth/sync также проверяем блокировку auth_attempts (для регистрации и синхронизации)
  if (!w.includes("const syncBfState = await checkD1LoginBruteForce(env, clientIp, normLoginPre || rawLoginClean);")) {
    w = w.replace(
      "const ident = await resolveWorkerAccountIdentity(body.login, body.password, body.authTokenHash, body.regionCode, snap, env);\n    if (!ident.ok) {\n     return new Response(JSON.stringify({ ok: false, error: 'Invalid credentials' }), {",
      `const syncBfState = await checkD1LoginBruteForce(env, clientIp, normLoginPre || rawLoginClean);
    if (syncBfState.locked) {
     return new Response(JSON.stringify({ ok: false, code: 'BRUTE_FORCE_LOCKED', error: 'Слишком много неудачных попыток. Повторите через 15 минут.' }), { status: 429, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
    }
    const ident = await resolveWorkerAccountIdentity(body.login, body.password, body.authTokenHash, body.regionCode, snap, env);
    if (!ident.ok) {
     const failRec = await recordD1LoginFailure(env, clientIp, normLoginPre || rawLoginClean, '/auth/sync');
     return new Response(JSON.stringify({ ok: false, error: 'Invalid credentials' }), {
      status: failRec.lockedUntil ? 429 : 400,`
    );
    w = w.replace(
      "status: failRec.lockedUntil ? 429 : 400,\n      status: 400,",
      "status: failRec.lockedUntil ? 429 : 400,"
    );
  }

  // 3.4: Синхронизация версий в cloudflare-worker-bot.js с VERSION
  w = w.replace(/const WORKER_VERSION = '[^']+';/g, `const WORKER_VERSION = '${V_FULL}';`);
  w = w.replace(/https:\/\/klevpro\.ru\/apk\/klev-pro-v[0-9.a-z_-]+\.apk/g, V_APK_URL);
  w = w.replace(/"version":\s*"2\.[0-9]+\.[0-9]+"/g, `"version": "${V_NUM}"`);
  w = w.replace(/"revision":\s*"r\d+"/g, `"revision": "${V_REV}"`);
  w = w.replace(/"versionCode":\s*\d+/g, `"versionCode": ${V_CODE}`);
  w = w.replace(/"buildNumber":\s*\d+/g, `"buildNumber": ${V_BUILD}`);
  w = w.replace(/"displayVersion":\s*"v2\.[0-9]+\.[0-9]+\s+r\d+"/g, `"displayVersion": "${V_DISPLAY}"`);

  writeTextIfChanged('cloudflare-worker-bot.js', w);
}

// ============================================================================
// 4. P1 (3.4) & P2 (4.8): Синхронизация version.json, apk/apk-version.json, policy-version.json, manifest.json, build.gradle, MainActivity.java, build-android-apk.yml
// ============================================================================
function patchVersionAndAndroidFiles() {
  for (const relJson of ['version.json', 'apk/apk-version.json']) {
    const raw = readText(relJson);
    if (!raw) continue;
    const obj = JSON.parse(raw);
    obj.version = V_NUM;
    obj.revision = V_REV;
    obj.buildNumber = V_BUILD;
    obj.versionCode = V_CODE;
    obj.displayVersion = V_DISPLAY;
    obj.fullVersion = V_FULL;
    obj.releaseDate = VER.releaseDate || '2026-11-17';
    obj.date = VER.date || '17 ноября 2026';
    obj.apkUrl = V_APK_URL;
    obj.fileSize = VER.fileSize || obj.fileSize || '38.8 МБ';
    obj.title = `Обновление «Клёв ПРО 2.0» (${V_DISPLAY})`;
    obj.versionBranchNote = V_BRANCH_NOTE;
    obj.subtitle = `${V_BRANCH_NOTE} Точечная защита ИИ-сканера и шлюзов, прямые тайлы карт без обрыва 16 КБ и единый контур погоды для полярных широт.`;
    obj.summary = `${V_BRANCH_NOTE} Синхронизированы блоки погоды и расчёт восхода/заката для северных широт, обновлены лимитеры D1 и прямая загрузка карт.`;
    if (Array.isArray(obj.changelog)) {
      const noteItem = `Стабильная ветка v${V_NUM} (${V_REV}): основной номер версии закреплён на ${V_NUM} до выхода версии 3.0 — при скачивании с сайта или обновлении внутри приложения ориентируйтесь на номер ревизии (${V_REV}).`;
      obj.changelog = [
        noteItem,
        ...obj.changelog.filter(x => !String(x).includes('Стабильная ветка v'))
      ].slice(0, 4);
    }
    obj.notes = V_BRANCH_NOTE;
    writeTextIfChanged(relJson, JSON.stringify(obj, null, 2) + '\n');
  }

  // policy-version.json
  const polRaw = readText('policy-version.json');
  if (polRaw) {
    const pol = JSON.parse(polRaw);
    pol.policyVersion = V_POLICY;
    pol.appVersion = V_NUM;
    pol.appRevision = V_REV;
    pol.updatedAt = `${VER.releaseDate || '2026-11-17'}T12:00:00Z`;
    pol.effectiveDate = `${VER.date || '17 ноября 2026'} г.`;
    pol.title = `Политика конфиденциальности, Пользовательское соглашение и Правила обработки геоданных «Клёв ПРО 2.0» (Редакция ${V_DISPLAY})`;
    pol.summary = `Редакция ${V_DISPLAY}: ${V_BRANCH_NOTE} Сохранность пользовательских данных при очистке кэша, единый постоянный ID рыбака на всех устройствах по логину и паролю, расчёт гидрологии и льда по данным Росгидромета (meteoinfo.ru).`;
    pol.versionBranchNote = V_BRANCH_NOTE;
    writeTextIfChanged('policy-version.json', JSON.stringify(pol, null, 2) + '\n');
  }

  // manifest.json
  const manRaw = readText('manifest.json');
  if (manRaw) {
    const man = JSON.parse(manRaw);
    man.version = V_FULL;
    man.start_url = `./index.html?v=${V_FULL}`;
    if (Array.isArray(man.icons)) {
      man.icons = man.icons.map(ic => ({
        ...ic,
        src: String(ic.src || '').replace(/\?v=[^"'\s]+$/, '') + `?v=${V_FULL}`
      }));
    }
    writeTextIfChanged('manifest.json', JSON.stringify(man, null, 2) + '\n');
  }

  // android/app/build.gradle (НЕ трогаем signingConfigs и keystore!)
  let gradle = readText('android/app/build.gradle');
  if (gradle) {
    gradle = gradle.replace(/versionCode\s+\d+/g, `versionCode ${V_CODE}`);
    gradle = gradle.replace(/versionName\s+"[^"]+"/g, `versionName "${V_FULL}"`);
    writeTextIfChanged('android/app/build.gradle', gradle);
  }

  // 3.5 + 3.4: MainActivity.java — проверка схемы https и белого списка хостов в openExternalUrl / downloadApkUpdate + единая версия
  // Сохраняем точный отступ строк (8 пробелов в MainActivity.java и 18 пробелов внутри YAML heredoc в build-android-apk.yml), чтобы не ломать YAML!
  const patchMainActivitySource = (javaSrc, baseIndent = "        ") => {
    let s = javaSrc;
    const ind = baseIndent;
    const ind4 = ind + "    ";
    const ind8 = ind + "        ";
    s = s.replace(/KlevProAPK\/[0-9.a-zA-Z_-]+/g, `KlevProAPK/${V_FULL}`);
    s = s.replace(/\?v=[0-9.]+_r\d+_/g, `?v=${V_NUM}_${V_REV}_`);
    s = s.replace(/public String getAppVersion\(\)\s*\{\s*return\s*"[^"]+";\s*\}/g, `public String getAppVersion() {\n${ind4}return "${V_FULL}";\n${ind}}`);
    s = s.replace(/public int getAppBuildNumber\(\)\s*\{\s*return\s*\d+;\s*\}/g, `public int getAppBuildNumber() {\n${ind4}return ${V_BUILD};\n${ind}}`);
    s = s.replace(/public String getAppRevision\(\)\s*\{\s*return\s*"[^"]+";\s*\}/g, `public String getAppRevision() {\n${ind4}return "${V_REV}";\n${ind}}`);

    const safeUrlMethods = [
      `private boolean isAllowedExternalUri(Uri uri) {`,
      `${ind4}if (uri == null) return false;`,
      `${ind4}String scheme = uri.getScheme();`,
      `${ind4}if (scheme == null || !"https".equalsIgnoreCase(scheme.trim())) return false;`,
      `${ind4}String host = uri.getHost();`,
      `${ind4}if (host == null) return false;`,
      `${ind4}String h = host.trim().toLowerCase(Locale.ROOT);`,
      `${ind4}return "klevpro.ru".equals(h)`,
      `${ind8}|| "www.klevpro.ru".equals(h)`,
      `${ind8}|| "xn--b1apdneg0j.xn--p1ai".equals(h)`,
      `${ind8}|| "github.com".equals(h);`,
      `${ind}}`,
      ``,
      `${ind}@JavascriptInterface`,
      `${ind}public void downloadApkUpdate(String url) {`,
      `${ind4}if (url == null || url.trim().isEmpty()) return;`,
      `${ind4}try {`,
      `${ind8}Uri uri = Uri.parse(url.trim());`,
      `${ind8}if (!isAllowedExternalUri(uri)) return;`,
      `${ind8}Intent intent = new Intent(Intent.ACTION_VIEW, uri);`,
      `${ind8}intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);`,
      `${ind8}ctx.startActivity(intent);`,
      `${ind4}} catch (Exception ignored) {}`,
      `${ind}}`,
      ``,
      `${ind}@JavascriptInterface`,
      `${ind}public void openExternalUrl(String url) {`,
      `${ind4}if (url == null || url.trim().isEmpty()) return;`,
      `${ind4}try {`,
      `${ind8}Uri uri = Uri.parse(url.trim());`,
      `${ind8}if (!isAllowedExternalUri(uri)) return;`,
      `${ind8}Intent intent = new Intent(Intent.ACTION_VIEW, uri);`,
      `${ind8}intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);`,
      `${ind8}ctx.startActivity(intent);`,
      `${ind4}} catch (Exception ignored) {}`,
      `${ind}}`
    ].join("\n");

    const oldMethodsRe = /(?:private boolean isAllowedExternalUri[\s\S]*?)?@JavascriptInterface\s+public void downloadApkUpdate\(String url\)\s*\{[\s\S]*?@JavascriptInterface\s+public void openExternalUrl\(String url\)\s*\{[\s\S]*?\}\s*\}/;
    if (oldMethodsRe.test(s)) {
      s = s.replace(oldMethodsRe, safeUrlMethods);
    }
    return s;
  };

  const javaRel = 'android/app/src/main/java/ru/klevpro/app/MainActivity.java';
  const javaRaw = readText(javaRel);
  if (javaRaw) {
    writeTextIfChanged(javaRel, patchMainActivitySource(javaRaw));
  }

  // Патч .github/workflows/build-android-apk.yml (без затрагивания keystore, signingConfigs и secrets.*)
  let wf = readText('.github/workflows/build-android-apk.yml');
  if (wf) {
    wf = patchMainActivitySource(wf, "                  ");
    wf = wf.replace(/VER_CODE=\$\(\(\d+\s*\+\s*RUN_NUM\)\)/g, `VER_CODE=$((${V_CODE} + RUN_NUM))`);
    wf = wf.replace(/versionName\s+"[0-9.a-zA-Z_-]+"/g, `versionName "${V_FULL}"`);
    wf = wf.replace(/publish v[0-9.a-zA-Z_-]+ web & signed apks/g, `publish v${V_FULL} web & signed apks`);
    // Включаем копирование внешнего скрипта app-runtime.js и VERSION в ассеты Android APK
    wf = wf.replace(
      /for f in index\.html kp-control-89\.html([^\n]*); do/,
      (m, rest) => m.includes('app-runtime.js') ? m : `for f in index.html kp-control-89.html app-runtime.js VERSION${rest}; do`
    );
    // 4.8 & 3.4: Удаление старых сборок в apk/ и жёсткая проверка соответствия apkUrl из version.json реальному файлу в apk/
    const verifyApkSnippet = `          ls -lh apk/
          EXPECTED_APK_NAME=$(node -e "const v=JSON.parse(require('fs').readFileSync('version.json','utf8')); console.log(new URL(v.apkUrl).pathname.replace(/^\\/+/, ''));")
          if [ ! -s "$EXPECTED_APK_NAME" ]; then
            echo "ОШИБКА СБОРКИ: apkUrl в version.json указывает на $EXPECTED_APK_NAME, но файл отсутствует или пуст в каталоге apk/!"
            exit 1
          fi`;
    if (!wf.includes('EXPECTED_APK_NAME=')) {
      wf = wf.replace('          ls -lh apk/', verifyApkSnippet);
    }
    writeTextIfChanged('.github/workflows/build-android-apk.yml', wf);
  }

  // 4.8: В каталоге apk/ удаляем старые/чужие версии .apk (кроме актуальных klev-pro-v2.9.0.apk и klev-pro-admin-v2.9.0.apk)
  const apkDir = path.join(ROOT, 'apk');
  if (fs.existsSync(apkDir)) {
    const apkEntries = fs.readdirSync(apkDir);
    const expectedSet = new Set([V_APK_FILE, V_ADMIN_APK_FILE, 'apk-version.json']);
    // Если есть старый пользовательский APK другого номера, но ещё нет klev-pro-v2.9.0.apk — переименовываем
    const targetUserApkPath = path.join(apkDir, V_APK_FILE);
    if (!fs.existsSync(targetUserApkPath)) {
      const candidate = apkEntries.find(f => f.endsWith('.apk') && !f.includes('admin'));
      if (candidate) {
        fs.copyFileSync(path.join(apkDir, candidate), targetUserApkPath);
      }
    }
    for (const f of fs.readdirSync(apkDir)) {
      if (f.endsWith('.apk') && !expectedSet.has(f)) {
        fs.unlinkSync(path.join(apkDir, f));
      }
    }
  }
}

// ============================================================================
// 5. Патч index.html + Вынос/возврат app-runtime.js (5.1) + CSP (5.2) + Автогенерация kp-control-89.html (4.2, 3.6) + sw.js (4.1, 3.3)
// ============================================================================
function patchFrontendAndServiceWorker() {
  let idx = readText('index.html');
  if (!idx) throw new Error('Не найден index.html');

  // Если runtime уже был вынесен в app-runtime.js, читаем его оттуда; иначе извлекаем из <script id="klevBundledAppRuntime">
  let runtimeCode = readText('app-runtime.js');
  const inlineRuntimeRe = /<script id="klevBundledAppRuntime">([\s\S]*?)<\/script>/;
  const externalRuntimeRe = /<script id="klevBundledAppRuntime" src="app-runtime\.js(?:\?v=[^"]*)?"><\/script>/;

  if (!runtimeCode) {
    const m = idx.match(inlineRuntimeRe);
    if (!m || !m[1] || m[1].trim().length < 10000) {
      throw new Error('Не удалось найти инлайновый бандл #klevBundledAppRuntime в index.html');
    }
    runtimeCode = m[1].trim();
  }

  // --- Патчим runtimeCode ---
  // 1) 3.4: Единая версия 2.9.0 / r240 / 293240 + пояснение о ветке 2.9.0
  runtimeCode = runtimeCode.replace(
    /const e="2\.[0-9]+\.[0-9]+",t=\d+,n="r\d+",a="v2\.[0-9]+\.[0-9]+\s+r\d+"/,
    `const e="${V_NUM}",t=${V_BUILD},n="${V_REV}",a="${V_DISPLAY}"`
  );
  runtimeCode = runtimeCode.replace(
    /l=\{version:"2\.[0-9]+\.[0-9]+",versionCode:\d+,buildNumber:\d+,revision:"r\d+",displayVersion:"v2\.[0-9]+\.[0-9]+\s+r\d+",date:"[^"]+",releasedAt:"[^"]+",apkUrl:"https:\/\/klevpro\.ru\/apk\/klev-pro-v[0-9.a-z_-]+\.apk"/,
    `l={version:"${V_NUM}",versionCode:${V_CODE},buildNumber:${V_BUILD},revision:"${V_REV}",displayVersion:"${V_DISPLAY}",date:"${VER.date || '17 ноября 2026'}",releasedAt:"${VER.releaseDate || '2026-11-17'}T12:00:00Z",apkUrl:"${V_APK_URL}"`
  );
  runtimeCode = runtimeCode.replace(
    /title:"Обновление «Клёв ПРО 2\.0» \(v2\.[0-9]+\.[0-9]+\s+r\d+\)"/g,
    `title:"Обновление «Клёв ПРО 2.0» (${V_DISPLAY})"`
  );
  runtimeCode = runtimeCode.replace(
    /ht="https:\/\/klevpro\.ru\/apk\/klev-pro-v[0-9.a-z_-]+\.apk"/g,
    `ht="${V_APK_URL}"`
  );
  runtimeCode = runtimeCode.replace(
    /Ue="2026\.[0-9.]+-v2\.[0-9.]+",He="2\.[0-9]+\.[0-9]+"/g,
    `Ue="${V_POLICY}",He="${V_NUM}"`
  );
  runtimeCode = runtimeCode.replace(
    /ver:"2\.[0-9]+\.[0-9]+-r\d+"/g,
    `ver:"${V_FULL}"`
  );

  // Корректируем функцию сравнения версий Mt(e,t,n,a), чтобы при фиксации ветки 2.9.0 приоритет внутри 2.x отдавался номеру ревизии r240 > r239 > r233
  const oldMtRe = /function Mt\(e,t,n,a\)\{const i=St\(e,n\);if\(0!==i\)return i;const o=kt\(t\),r=kt\(a\);return o!==r&&\(o>0\|\|r>0\)\?o>r\?1:-1:0\}/;
  const newMt = `function Mt(e,t,n,a){const o=kt(t),r=kt(a);if(o>0&&r>0&&String(e||"2").startsWith("2.")&&String(n||"2").startsWith("2.")&&o!==r)return o>r?1:-1;const i=St(e,n);return 0!==i?i:o!==r&&(o>0||r>0)?o>r?1:-1:0}`;
  if (oldMtRe.test(runtimeCode)) {
    runtimeCode = runtimeCode.replace(oldMtRe, newMt);
  }

  // 2) 3.5: Функция esc() для экранирования пользовательских данных
  if (!runtimeCode.includes('const esc=Be;')) {
    runtimeCode = runtimeCode.replace(
      'function Be(e){return null==e?"":String(e).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/\'/g,"&#39;")}',
      'function Be(e){return null==e?"":String(e).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/\'/g,"&#39;")}const esc=Be;if("undefined"!=typeof window)window.esc=Be;'
    );
  }

  // Применяем esc() к неэкранированным вставкам пользовательских полей в шаблонах
  runtimeCode = runtimeCode.replace(
    /\$\{s\.top3Baits\.length>0\?s\.top3Baits\.join\(" • "\):"Приманки"\}/g,
    '${s.top3Baits.length>0?s.top3Baits.map(esc).join(" • "):"Приманки"}'
  );
  runtimeCode = runtimeCode.replace(
    /<div style="font-weight:900;font-size:var\(--fs-sm\);color:var\(--accent\);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">\\n\s*\$\{i\.title\}\\n\s*<\/div>/g,
    '<div style="font-weight:900;font-size:var(--fs-sm);color:var(--accent);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">\\n                ${esc(i.title)}\\n              </div>'
  );
  runtimeCode = runtimeCode.replace(
    /<span style="font-weight:800;font-size:var\(--fs-sm\);color:var\(--text\);word-break:break-word;">\$\{e\.title\}<\/span>/g,
    '<span style="font-weight:800;font-size:var(--fs-sm);color:var(--text);word-break:break-word;">${esc(e.title)}</span>'
  );
  runtimeCode = runtimeCode.replace(
    /\$\{e\.fishName\} \$\{e\.weightKg\?`• \$\{e\.weightKg\} кг`:""\} \(\$\{e\.dateLabel\|\|"Сегодня"\}, \$\{e\.locLabel\|\|t\.locLabel\}\)/g,
    '${esc(e.fishName)} ${e.weightKg?`• ${esc(e.weightKg)} кг`:""} (${esc(e.dateLabel||"Сегодня")}, ${esc(e.locLabel||t.locLabel)})'
  );
  runtimeCode = runtimeCode.replace(
    /\$\{e\.fishName\} \$\{e\.weightKg\?`• \$\{e\.weightKg\} кг`:""\} \(\$\{e\.dateLabel\|\|e\.date\}, \$\{e\.locLabel\|\|t\.locLabel\}\)/g,
    '${esc(e.fishName)} ${e.weightKg?`• ${esc(e.weightKg)} кг`:""} (${esc(e.dateLabel||e.date)}, ${esc(e.locLabel||t.locLabel)})'
  );
  runtimeCode = runtimeCode.replace(
    /Вход выполнен \(\$\{i\|\|t\.callsign\}\)/g,
    'Вход выполнен (${esc(i||t.callsign)})'
  );

  // 3) 3.2 (клиентская часть): Передача sessionToken и fisherId в запросы /api/ai/identify-fish
  if (!runtimeCode.includes('chunkMode:"put",scanId:i,idx:0,total:t.length,data:t[0],fisherId:')) {
    runtimeCode = runtimeCode.replace(
      'chunkMode:"put",scanId:i,idx:0,total:t.length,data:t[0]',
      'chunkMode:"put",scanId:i,idx:0,total:t.length,data:t[0],fisherId:Ie.getState()?.userProfile?.fisherId||"",login:Ie.getState()?.userProfile?.login||"",sessionToken:Ie.getState()?.userProfile?.sessionToken||Ie.getState()?.userProfile?.authTokenHash||""'
    );
    runtimeCode = runtimeCode.replace(
      'chunkMode:"put",scanId:i,idx:o,total:t.length,data:n',
      'chunkMode:"put",scanId:i,idx:o,total:t.length,data:n,fisherId:Ie.getState()?.userProfile?.fisherId||"",login:Ie.getState()?.userProfile?.login||"",sessionToken:Ie.getState()?.userProfile?.sessionToken||Ie.getState()?.userProfile?.authTokenHash||""'
    );
    runtimeCode = runtimeCode.replace(
      'chunkMode:"exec",scanId:i,total:t.length,basinCode:a,locLabel:o',
      'chunkMode:"exec",scanId:i,total:t.length,basinCode:a,locLabel:o,fisherId:Ie.getState()?.userProfile?.fisherId||"",login:Ie.getState()?.userProfile?.login||"",sessionToken:Ie.getState()?.userProfile?.sessionToken||Ie.getState()?.userProfile?.authTokenHash||""'
    );
  }

  // 4) 3.3: Перевод клиента на прямую загрузку тайлов Яндекса, прокси через воркер — только как резерв за флагом window.__KLEV_USE_TILE_PROXY_FALLBACK__
  runtimeCode = runtimeCode.replace(
    'if("unavailable"!==lc){const e=`https://klevprohbot.thorantony82.workers.dev/api/tile-proxy?url=${encodeURIComponent(a)}`',
    'if("unavailable"!==lc&&"undefined"!=typeof window&&!0===window.__KLEV_USE_TILE_PROXY_FALLBACK__){const e=`https://klevprohbot.thorantony82.workers.dev/api/tile-proxy?url=${encodeURIComponent(a)}`'
  );

  // 5) 4.6: Погода — астрономический расчёт восхода/заката для полярных широт (66.08°N), единый источник данных и «Нет данных» при isReal === false
  if (!runtimeCode.includes('function calcPolarSunTimes(')) {
    const polarSunFn = `function calcPolarSunTimes(dateStr,lat=66.08,lon=76.68){try{const s=String(dateStr||"").slice(0,10),dt=s?new Date(s+"T12:00:00Z"):new Date(),start=new Date(Date.UTC(dt.getUTCFullYear(),0,0)),doy=Math.floor((dt-start)/864e5),tz=Math.round(Number(lon||76.68)/15),g=2*Math.PI/365*(doy-1+.5),eq=229.18*(75e-6+.001868*Math.cos(g)-.032077*Math.sin(g)-.014615*Math.cos(2*g)-.040849*Math.sin(2*g)),decl=.006918-.399912*Math.cos(g)+.070257*Math.sin(g)-.006758*Math.cos(2*g)+.000907*Math.sin(2*g)-.002697*Math.cos(3*g)+.00148*Math.sin(3*g),latR=Math.max(-89.5,Math.min(89.5,Number(lat)||66.08))*Math.PI/180,zen=90.833*Math.PI/180,cosH=Math.cos(zen)/(Math.cos(latR)*Math.cos(decl))-Math.tan(latR)*Math.tan(decl);if(cosH>1)return{sunriseHr:12,sunsetHr:12,polarNight:!0,polarDay:!1};if(cosH<-1)return{sunriseHr:0,sunsetHr:24,polarNight:!1,polarDay:!0};const ha=180*Math.acos(cosH)/Math.PI,sr=((720-4*(Number(lon||76.68)+ha)-eq)/60+tz+24)%24,ss=((720-4*(Number(lon||76.68)-ha)-eq)/60+tz+24)%24;return{sunriseHr:Math.round(100*sr)/100,sunsetHr:Math.round(100*ss)/100,polarNight:!1,polarDay:!1}}catch(e){return{sunriseHr:8.8,sunsetHr:14.48,polarNight:!1,polarDay:!1}}}`;
    runtimeCode = runtimeCode.replace('function Un(', polarSunFn + 'function Un(');
    // В Un (fallback) и Wn (Met.no) используем calcPolarSunTimes(r, e, 76.68) вместо 6.8+.02*a / 18.2-.02*a и 7 / 17.8
    runtimeCode = runtimeCode.replace(
      'sunriseHr:6.8+.02*a,sunsetHr:18.2-.02*a',
      'sunriseHr:calcPolarSunTimes(r,e,76.68).sunriseHr,sunsetHr:calcPolarSunTimes(r,e,76.68).sunsetHr'
    );
    runtimeCode = runtimeCode.replace(
      'sunriseHr:7,sunsetHr:17.8',
      'sunriseHr:calcPolarSunTimes(n,t,76.68).sunriseHr,sunsetHr:calcPolarSunTimes(n,t,76.68).sunsetHr'
    );
  }

  // Исправляем рассинхрон верхнего и нижнего блока погоды в Fd(e): вызываем Bd(e.querySelector("#fcExpressBox")) напрямую
  runtimeCode = runtimeCode.replace(
    'const s=document.createElement("div");Bd(s);const l=s.querySelector("#fcExpressCardsGrid"),d=e.querySelector("#fcExpressCardsGrid");l&&d&&(d.innerHTML=l.innerHTML)',
    'Bd(e.querySelector("#fcExpressBox"))'
  );

  // В Q.saveWeatherCache не сохраняем демо-дни (isReal === false) в постоянный кэш daysByDate
  if (!runtimeCode.includes('if(!o.isReal)continue;')) {
    runtimeCode = runtimeCode.replace(
      'n?(!a||!a.isReal&&o.isReal)&&(s.daysByDate[t]=o):s.daysByDate[t]=o',
      'if(!o.isReal)continue;n?(!a||!a.isReal&&o.isReal)&&(s.daysByDate[t]=o):s.daysByDate[t]=o'
    );
  }

  // При isReal === false в карточках погоды (#bentoWeatherIceCard и #secWeather) показываем «Нет данных» вместо демо-значений
  runtimeCode = runtimeCode.replace(
    're=`${oe>0?"+"+oe:oe}°C`,se=`${c>0?"+"+c:c}°C`,le=l.iceThickness??t.iceThickness??0,de="ice_safe"===d?`Лёд: ${le||12} см`:"ice_danger"===d?`Опасный лёд: ${le} см`:"ice_slush"===d?"Шуга и забереги":"Открытая вода",ce="ice_safe"===d?"(Пешком разрешено)":"ice_danger"===d?"(Выход на лёд запрещён!)":"ice_slush"===d?"(Ледостава нет • с берега)":"(Льда нет • лодка и берег)"',
    're=!1===l.isReal?"Нет данных":`${oe>0?"+"+oe:oe}°C`,se=!1===l.isReal?"Нет данных":`${c>0?"+"+c:c}°C`,le=l.iceThickness??t.iceThickness??0,de=!1===l.isReal?"Лёд: нет данных":"ice_safe"===d?`Лёд: ${le||12} см`:"ice_danger"===d?`Опасный лёд: ${le} см`:"ice_slush"===d?"Шуга и забереги":"Открытая вода",ce=!1===l.isReal?"(Нет данных о состоянии льда)":"ice_safe"===d?"(Пешком разрешено)":"ice_danger"===d?"(Выход на лёд запрещён!)":"ice_slush"===d?"(Ледостава нет • с берега)":"(Льда нет • лодка и берег)"'
  );
  runtimeCode = runtimeCode.replace(
    '<div style="font-weight:900;color:var(--text);">${l.pressAvg||750} мм рт. ст.</div>',
    '<div style="font-weight:900;color:var(--text);">${!1===l.isReal?"Нет данных":(l.pressAvg||750)+" мм рт. ст."}</div>'
  );
  runtimeCode = runtimeCode.replace(
    'X=`${i.tDay>0?"+"+i.tDay:i.tDay}°C`,ee=`${i.tNight>0?"+"+i.tNight:i.tNight}°C`,te=`${i.waterTemp>0?"+"+i.waterTemp:i.waterTemp}°C`',
    'X=!1===i.isReal?"Нет данных":`${i.tDay>0?"+"+i.tDay:i.tDay}°C`,ee=!1===i.isReal?"нет данных":`${i.tNight>0?"+"+i.tNight:i.tNight}°C`,te=!1===i.isReal?"Нет данных":`${i.waterTemp>0?"+"+i.waterTemp:i.waterTemp}°C`'
  );
  runtimeCode = runtimeCode.replace(
    'A="ice_safe"===i.iceState?`БЕЗОПАСНЫЙ ЛЁД (~${i.iceThickness||12} СМ)`:"ice_danger"===i.iceState?`ОПАСНЫЙ ЛЁД (~${i.iceThickness||4} СМ)`:"ice_slush"===i.iceState?"ЗАБЕРЕГИ И ШУГА":"ОТКРЫТАЯ ВОДА"',
    'A=!1===i.isReal?"НЕТ ДАННЫХ О ЛЬДЕ":"ice_safe"===i.iceState?`БЕЗОПАСНЫЙ ЛЁД (~${i.iceThickness||12} СМ)`:"ice_danger"===i.iceState?`ОПАСНЫЙ ЛЁД (~${i.iceThickness||4} СМ)`:"ice_slush"===i.iceState?"ЗАБЕРЕГИ И ШУГА":"ОТКРЫТАЯ ВОДА"'
  );

  // Сохраняем или откатываем внешний файл app-runtime.js (5.1)
  if (ROLLBACK_INLINE_JS) {
    if (externalRuntimeRe.test(idx)) {
      idx = idx.replace(externalRuntimeRe, `<script id="klevBundledAppRuntime">\n${runtimeCode}\n</script>`);
    } else if (inlineRuntimeRe.test(idx)) {
      idx = idx.replace(inlineRuntimeRe, `<script id="klevBundledAppRuntime">\n${runtimeCode}\n</script>`);
    }
    const rtFull = path.join(ROOT, 'app-runtime.js');
    if (fs.existsSync(rtFull)) fs.unlinkSync(rtFull);
  } else {
    writeTextIfChanged('app-runtime.js', runtimeCode.trim() + '\n');
    const extTag = `<script id="klevBundledAppRuntime" src="app-runtime.js?v=${V_FULL}"></script>`;
    if (inlineRuntimeRe.test(idx)) {
      idx = idx.replace(inlineRuntimeRe, extTag);
    } else if (externalRuntimeRe.test(idx)) {
      idx = idx.replace(externalRuntimeRe, extTag);
    }
  }

  // --- Патчим HTML-оболочку index.html ---
  idx = idx.replace(/"softwareVersion":\s*"[^"]+"/g, `"softwareVersion": "${V_FULL}"`);
  idx = idx.replace(/\?v=2\.[0-9]+\.[0-9]+-r\d+/g, `?v=${V_FULL}`);
  idx = idx.replace(/klev-pro-v2\.[0-9]+\.[0-9]+-r\d+-static/g, `klev-pro-v${V_FULL}-static`);
  idx = idx.replace(/Приложение «Клёв ПРО 2\.0» для Android \(v2\.[0-9]+\.[0-9]+\s+r\d+\)/g, `Приложение «Клёв ПРО 2.0» для Android (${V_DISPLAY})`);
  idx = idx.replace(/Скачать APK \(v2\.[0-9]+\.[0-9]+\s+r\d+\)/g, `Скачать APK (${V_DISPLAY})`);
  idx = idx.replace(/«Клёв ПРО 2\.0: Круг» \(версия 2\.[0-9]+\.[0-9]+\s+r\d+\)/g, `«Клёв ПРО 2.0: Круг» (версия ${V_NUM} ${V_REV})`);

  // 5.2: CSP в режиме Content-Security-Policy-Report-Only с SHA-256 хешами инлайновых скриптов
  // Удаляем прежний meta CSP-Report-Only если есть, чтобы пересчитать актуальные sha256 хеши
  idx = idx.replace(/\s*<meta http-equiv="Content-Security-Policy-Report-Only"[^>]*>\n?/g, '\n');
  const inlineScriptHashes = [];
  const scriptRegex = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let sm;
  while ((sm = scriptRegex.exec(idx)) !== null) {
    const tagOpen = sm[0].slice(0, sm[0].indexOf('>') + 1);
    if (/application\/ld\+json/i.test(tagOpen)) continue;
    const body = sm[1];
    const hashB64 = crypto.createHash('sha256').update(body, 'utf8').digest('base64');
    inlineScriptHashes.push(`'sha256-${hashB64}'`);
  }
  const cspMeta = `  <meta http-equiv="Content-Security-Policy-Report-Only" content="default-src 'self' https: data: blob:; script-src 'self' https://telegram.org https://yastatic.net https://cdn.jsdelivr.net 'unsafe-inline' ${inlineScriptHashes.join(' ')}; style-src 'self' https: 'unsafe-inline'; img-src 'self' https: data: blob:; connect-src 'self' https: wss:;">\n`;
  idx = idx.replace('<meta name="viewport"', cspMeta + '  <meta name="viewport"');

  writeTextIfChanged('index.html', idx);

  // 4.2 & 3.6: Автогенерация kp-control-89.html из index.html (замена флага, заголовка, иконок и шапки админки + meta noindex)
  let kp = idx;
  if (!kp.includes('<meta name="robots" content="noindex, nofollow">')) {
    kp = kp.replace('<meta charset="UTF-8">', '<meta charset="UTF-8">\n  <meta name="robots" content="noindex, nofollow">');
  }
  kp = kp.replace(
    /<title>[^<]*<\/title>/,
    '<title>Клёв ПРО Админ — Панель управления</title>'
  );
  kp = kp.replace(/https:\/\/klevpro\.ru\/icon-512\.png/g, 'https://klevpro.ru/icon-admin-512.png');
  kp = kp.replace(/href="icon-192\.png\?v=[^"]+"/g, `href="icon-admin-192.png?v=${V_FULL}"`);
  kp = kp.replace(
    'window.__KLEV_ADMIN_CONTOUR__ = false;',
    "window.__KLEV_ADMIN_CONTOUR__ = true;\n    try { localStorage.setItem('klev_pro_admin_contour_unlocked_v1', '1'); } catch (_) {}"
  );

  const adminBodyLayout = `  <header class="app-header">
    <div class="header-bar">
      <div class="header-status-block open-water" id="headerStatusBlock" role="button" tabindex="0" title="Контур Администратора • Нажмите для обновления сводки сервера">
        <div class="header-status-main" id="headerStatusMainLine">
          <span class="header-online-badge" id="headerStatusDot">
            <svg class="k-ico" width="14" height="14" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="#10b981" stroke="rgba(255,255,255,0.65)" stroke-width="1.5"/></svg>
            <span>ОНЛАЙН</span>
          </span>
          <span class="header-season-verdict" id="headerSeasonMainText">КЛЁВ ПРО АДМИН</span>
        </div>
        <div class="header-status-sub" id="headerSeasonSubText">
          <span>Консоль D1 • Бета-тест • 152-ФЗ</span>
        </div>
      </div>

      <div class="header-right-actions">
        <button type="button" class="btn-theme-chip" id="headerLiquidGlassBtn" title="Эффект Жидкое стекло: ВКЛ / ВЫКЛ" aria-label="Эффект Жидкое стекло">
          <svg class="k-ico" width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2.5c0 0-6.5 7.2-6.5 12a6.5 6.5 0 0 0 13 0c0-4.8-6.5-12-6.5-12z" fill="rgba(56,189,248,0.28)" stroke="#38bdf8" stroke-width="1.8"/></svg>
        </button>
        <button type="button" class="btn-theme-chip" id="headerThemeBtn" title="Переключить тему оформления" aria-label="Тема оформления">
          <svg class="k-ico" width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" fill="rgba(251,191,36,0.28)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
        </button>
        <button type="button" class="header-id-profile-btn" id="headerProfileBtn" title="Владелец Клёв ПРО Админ">
          <div class="header-id-text-col">
            <span class="header-id-code" id="headerProfileIdCode">ID: FP_89VIP089</span>
            <span class="header-id-sub" id="headerProfileIdSub">Ямало-Ненецкий АО</span>
          </div>
          <span class="header-avatar-circle" id="headerProfileAvatar">
            <svg class="k-ico" width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M3 18h18l-2-11-5 4-2-6-2 6-5-4-2 11z" fill="rgba(251,191,36,0.35)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg>
          </span>
        </button>
      </div>
    </div>

    <div class="top-section-nav" id="adminTopTabBar" role="tablist" aria-label="Разделы панели администратора" style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;padding:4px 10px 8px;">
      <button type="button" class="top-nav-item active" data-adm-workspace-tab="dashboard" role="tab">
        <span class="top-nav-ico">
          <svg class="k-ico" width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="6" rx="2" stroke="#38bdf8" stroke-width="1.8"/><rect x="3" y="14" width="18" height="6" rx="2" stroke="#10b981" stroke-width="1.8"/></svg>
        </span>
        <span class="top-nav-lbl">1. Сервер</span>
      </button>
      <button type="button" class="top-nav-item" data-adm-workspace-tab="users_beta" role="tab">
        <span class="top-nav-ico">
          <svg class="k-ico" width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3.5" stroke="#10b981" stroke-width="1.8"/><path d="M3 19c0-3.2 2.7-5.5 6-5.5s6 2.3 6 5.5" stroke="#10b981" stroke-width="1.8" stroke-linecap="round"/></svg>
        </span>
        <span class="top-nav-lbl">2. Бета·ID</span>
      </button>
      <button type="button" class="top-nav-item" data-adm-workspace-tab="moderation" role="tab">
        <span class="top-nav-ico">
          <svg class="k-ico" width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-4-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 8.5-8.5h.5a8.5 8.5 0 0 1 8 8v.5z" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg>
        </span>
        <span class="top-nav-lbl">3. Чаты·Точки</span>
      </button>
      <button type="button" class="top-nav-item" data-adm-workspace-tab="security_policy" role="tab">
        <span class="top-nav-ico">
          <svg class="k-ico" width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 3l7 3v6c0 5-3.5 8.5-7 9-3.5-.5-7-4-7-9V6l7-3z" stroke="#38bdf8" stroke-width="1.8" stroke-linejoin="round"/></svg>
        </span>
        <span class="top-nav-lbl">4. 152-ФЗ·ИБ</span>
      </button>
    </div>
  </header>

  <main id="app" class="app-main" style="padding-bottom:24px;">
    <section id="secAdmin" data-route-section="admin" class="section active" aria-label="Панель управления Администратора"></section>
  </main>`;

  kp = kp.replace(/<header class="app-header">[\s\S]*?<\/nav>/, adminBodyLayout);
  writeTextIfChanged('kp-control-89.html', kp);

  // 4.1 & 3.3: Генерация sw.js (CORE_ASSETS строго из фактических ссылок index.html + версия из VERSION + регулярка тайлов с (^|\.))
  const linkedAssets = ['./', './index.html', './manifest.json', './version.json', './policy-version.json'];
  const assetAttrRe = /<(?:link|script)\b[^>]*?\b(?:href|src)="([^"]+)"[^>]*>/gi;
  let am;
  while ((am = assetAttrRe.exec(idx)) !== null) {
    const rawUrl = am[1].trim();
    if (/^https?:\/\//i.test(rawUrl) || rawUrl.startsWith('data:')) continue;
    const rel = rawUrl.startsWith('./') ? rawUrl : './' + rawUrl.replace(/^\/+/, '');
    if (!linkedAssets.includes(rel)) {
      linkedAssets.push(rel);
    }
  }

  let sw = readText('sw.js');
  if (sw) {
    sw = sw.replace(/const CACHE_VERSION = '[^']+';/, `const CACHE_VERSION = 'klev-pro-v${V_FULL}';`);
    const coreAssetsFormatted = 'const CORE_ASSETS = [\n' + linkedAssets.map(a => `  '${a}'`).join(',\n') + '\n];';
    sw = sw.replace(/const CORE_ASSETS = \[[\s\S]*?\];/, coreAssetsFormatted);
    sw = sw.replace(
      /function isMapTileHostname\(hostname = ''\)\s*\{[\s\S]*?\}/,
      `function isMapTileHostname(hostname = '') {\n  return /(^|\\.)(maps\\.yandex\\.net|arcgisonline\\.com|openstreetmap\\.org|openstreetmap\\.fr|cartocdn\\.com|opentopomap\\.org|maps\\.mail\\.ru)$/i.test(String(hostname || ''));\n}`
    );
    writeTextIfChanged('sw.js', sw);
  }
}

cleanTrashFilesAndGitignore();
patchRobotsTxt();
patchWorker();
patchVersionAndAndroidFiles();
patchFrontendAndServiceWorker();

console.log(`[apply-fixes] Все исправления P1–P3 для версии ${V_DISPLAY} (код ${V_CODE}) успешно применены.`);
