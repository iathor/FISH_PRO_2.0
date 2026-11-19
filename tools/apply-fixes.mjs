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
const V_NUM = String(VER.version || '2.9.1').trim();
const V_REV = String(VER.revision || 'r241').trim();
const V_BUILD = Number(VER.buildNumber || 241);
const V_CODE = Number(VER.versionCode || 293241);
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
    obj.subtitle = 'Обновлённый интерфейс Tactile Glassmorphism: живой радар-сонар клёва на главном экране, компактное меню, полный экран погоды с кнопкой «Назад», горизонтальный режим для планшетов/раскладушек и поддержка мини-экрана.';
    obj.summary = 'Живой радар-сонар клёва с градиентной шкалой и рыбками-целями, 4 вкладки прогноза (Обзор, Снасти, 10 дней, Погода), нижний док из 4 кнопок, компактное меню с защищённым свайп-ползунком SOS и мини-экран.';
    obj.changelog = [
      'Живой радар-сонар на главном экране: плавное вращение луча, полупрозрачная градиентная шкала и рыбки-цели по проценту клёва без лишних надписей.',
      'Новая навигация: нижний док из 4 разделов (Прогноз, Карта, Журнал, Меню) и компактное всплывающее Меню (Погода, Чаты, Рыбы, Календарь, Настройки) с гибридным свайп-ползунком SOS.',
      'Удобный прогноз и снасти: просмотр часов движением пальца прямо по графику 00:00–24:00, сезонный переключатель открытой воды для карты свима и таймера перезаброса.',
      'Полный экран «Погода» и компактные плашки карты: возврат кнопкой «< Назад» и свайпом с края экрана, 6 однострочных плашек на карте, горизонтальный вид для планшетов/Flip и поддержка мини-экрана.'
    ];
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
    wf = wf.replace(/apk\/klev-pro-v[0-9.a-zA-Z_-]+\.apk/g, `apk/${V_APK_FILE}`);
    wf = wf.replace(/apk\/klev-pro-admin-v[0-9.a-zA-Z_-]+\.apk/g, `apk/${V_ADMIN_APK_FILE}`);
    wf = wf.replace(/\/tmp\/klev-apk-dist\/klev-pro-v[0-9.a-zA-Z_-]+\.apk/g, `/tmp/klev-apk-dist/${V_APK_FILE}`);
    wf = wf.replace(/\/tmp\/klev-apk-dist\/klev-pro-admin-v[0-9.a-zA-Z_-]+\.apk/g, `/tmp/klev-apk-dist/${V_ADMIN_APK_FILE}`);
    wf = wf.replace(/\$REL_DIR\/klev-pro-v[0-9.a-zA-Z_-]+\.apk/g, `$REL_DIR/${V_APK_FILE}`);
    wf = wf.replace(/\$REL_DIR\/klev-pro-admin-v[0-9.a-zA-Z_-]+\.apk/g, `$REL_DIR/${V_ADMIN_APK_FILE}`);
    wf = wf.replace(/KlevPro-User-v[0-9.a-zA-Z_-]+-Android-APK/g, `KlevPro-User-v${V_NUM}-Android-APK`);
    wf = wf.replace(/KlevPro-Admin-v[0-9.a-zA-Z_-]+-Android-APK/g, `KlevPro-Admin-v${V_NUM}-Android-APK`);
    wf = wf.replace(/Build Signed User APK \(klev-pro-v[0-9.a-zA-Z_-]+\.apk/g, `Build Signed User APK (${V_APK_FILE}`);
    wf = wf.replace(/Build Signed Owner Admin APK \(klev-pro-admin-v[0-9.a-zA-Z_-]+\.apk/g, `Build Signed Owner Admin APK (${V_ADMIN_APK_FILE}`);
    wf = wf.replace(/Upload Signed User APK Artifact \(klev-pro-v[0-9.a-zA-Z_-]+\.apk\)/g, `Upload Signed User APK Artifact (${V_APK_FILE})`);
    wf = wf.replace(/Upload Signed Owner Admin APK Artifact \(klev-pro-admin-v[0-9.a-zA-Z_-]+\.apk\)/g, `Upload Signed Owner Admin APK Artifact (${V_ADMIN_APK_FILE})`);
    wf = wf.replace(/rm -rf android\/app\/src\/main\/assets\/www android\/build/g, 'rm -rf android/buildSrc android/app/src/main/assets/www android/build');
    if (!wf.includes('FORCE_JAVASCRIPT_ACTIONS_TO_NODE24')) {
      wf = wf.replace('permissions:', "env:\n  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: 'true'\n\npermissions:");
    }
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
  // Экранируем пользовательские подстроки (название водоёма / ключ экипажа) внутри формирования title чата, не ломая SVG-иконку <svg class="k-ico">
  runtimeCode = runtimeCode.replace(
    'Экипаж ${e}${s?` • ${s.wn||s.lb}`:""}',
    'Экипаж ${esc(e)}${s?` • ${esc(s.wn||s.lb)}`:""}'
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


  // --- 6) Редизайн v2.9.1 (r241) Tactile Glassmorphism в runtimeCode и index.html ---
  // 6.1: Кнопка «< Назад» вместо «На карту» в разделе Погода с возвратом на предыдущий экран
  runtimeCode = runtimeCode.replace(
    'id="weatherStickyBackToMapBtn" style="height:36px;padding:0 13px;border-radius:12px;display:inline-flex;align-items:center;gap:6px;font-weight:800;font-size:12.5px;cursor:pointer;">\n            <svg class="k-ico" viewBox="0 0 24 24" fill="none"><polyline points="15 18 9 12 15 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>\n            <span>На карту</span>',
    'id="weatherStickyBackToMapBtn" style="height:36px;padding:0 13px;border-radius:12px;display:inline-flex;align-items:center;gap:6px;font-weight:800;font-size:12.5px;cursor:pointer;">\n            <svg class="k-ico" viewBox="0 0 24 24" fill="none"><polyline points="15 18 9 12 15 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>\n            <span>Назад</span>'
  );
  runtimeCode = runtimeCode.replace(
    'id="arcCloseWeatherModalBtn" style="height:38px;padding:0 14px;border-radius:13px;display:inline-flex;align-items:center;gap:6px;font-weight:800;font-size:13px;cursor:pointer;">\n              <svg class="k-ico" viewBox="0 0 24 24" fill="none"><polyline points="15 18 9 12 15 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>\n              <span>На карту</span>',
    'id="arcCloseWeatherModalBtn" style="height:38px;padding:0 14px;border-radius:13px;display:inline-flex;align-items:center;gap:6px;font-weight:800;font-size:13px;cursor:pointer;">\n              <svg class="k-ico" viewBox="0 0 24 24" fill="none"><polyline points="15 18 9 12 15 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>\n              <span>Назад</span>'
  );
  runtimeCode = runtimeCode.replace(
    'e.querySelector("#weatherStickyBackToMapBtn")?.addEventListener("click",(()=>{' + '"undefined"!=typeof window&&"function"==typeof window.__KLEV_NAVIGATE_SECTION__&&window.__KLEV_NAVIGATE_SECTION__("geo")' + '}))',
    'e.querySelector("#weatherStickyBackToMapBtn")?.addEventListener("click",(()=>{if("undefined"!=typeof window&&"function"==typeof window.__KLEV_HANDLE_BACK__&&window.__KLEV_HANDLE_BACK__("weather_back"))return;"undefined"!=typeof window&&"function"==typeof window.__KLEV_NAVIGATE_SECTION__&&window.__KLEV_NAVIGATE_SECTION__("forecast")}))'
  );

  // 6.2: Удаление кнопки «Очистить кэш» (#fcCleanArchiveBtn) из 10-дневного прогноза
  runtimeCode = runtimeCode.replace(
    /<button type="button" class="btn btn-sm" id="fcCleanArchiveBtn"[^>]*>[\s\S]*?Очистить кэш<\/button>/g,
    ''
  );

  // 6.3: Замена спидометра в #bentoSwipeHeroCard на Живой Радар-Сонар (#bentoHeroSonarCanvas)
  const oldGaugeBoxRe = /<div class="bento-gauge-svg-box">[\s\S]*?<div class="bento-tackle-summary">/;
  const newSonarHeroBox = "<div class=\"bento-hero-sonar-stage\" id=\"bentoHeroSonarStage\">\n              <canvas id=\"bentoHeroSonarCanvas\" class=\"bento-hero-sonar-canvas\" width=\"456\" height=\"456\" data-sonar-score=\"${w}\"></canvas>\n              <div class=\"bento-hero-sonar-center-pct\" id=\"bentoHeroSonarPctText\">${w}%</div>\n            </div>\n            <div id=\"bentoHeroWaterIceLink\" role=\"button\" tabindex=\"0\" title=\"\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u043f\u043e\u0434\u0440\u043e\u0431\u043d\u044b\u0439 \u044d\u043a\u0440\u0430\u043d \u041f\u043e\u0433\u043e\u0434\u0430 \u0438 \u0441\u043e\u0441\u0442\u043e\u044f\u043d\u0438\u0435 \u0432\u043e\u0434\u043e\u0451\u043c\u0430\" style=\"font-size:11px;font-weight:800;color:var(--accent);text-align:center;margin:2px 0 6px;cursor:pointer;text-decoration:underline;text-underline-offset:3px;\">\n              \u0412\u043e\u0434\u0430 ${se} \u2022 ${de} (\u041f\u043e\u0433\u043e\u0434\u0430 \u2192)\n            </div>\n            <div class=\"bento-hero-peaks-duo\">\n              <div class=\"bento-hero-peak-pill\">\n                <div style=\"font-size:10.5px;color:var(--muted);font-weight:800;\">\u0423\u0442\u0440\u043e<br><b style=\"font-size:12.5px;color:var(--good);\">${String(T).padStart(2,\"0\")}:00 (${j.sc}%)</b></div>\n              </div>\n              <div class=\"bento-hero-peak-pill\">\n                <div style=\"font-size:10.5px;color:var(--muted);font-weight:800;\">\u0412\u0435\u0447\u0435\u0440<br><b style=\"font-size:12.5px;color:var(--accent);\">${String(C).padStart(2,\"0\")}:00 (${I.sc}%)</b></div>\n              </div>\n            </div>\n            <div class=\"bento-tackle-summary\">";
  if (oldGaugeBoxRe.test(runtimeCode) && !runtimeCode.includes('id="bentoHeroSonarCanvas"')) {
    runtimeCode = runtimeCode.replace(oldGaugeBoxRe, newSonarHeroBox);
  }

  // 6.4: Компактные однострочные 6 плашек внизу карты (#arcBottomPlaquesMount)
  const oldMapDuoChunk = "<div class=\"klev-arc-duo-viewport\" id=\"arcDuoSwipeViewport\">\\n            <div class=\"klev-arc-duo-track\" id=\"arcDuoSwipeTrack\" style=\"transform:translate3d(-${33.333333*Yu}%, 0, 0);\">\\n              \\x3c!-- \u042d\u041a\u0420\u0410\u041d 1: 8.1 \u041a\u043b\u0451\u0432 / \u0422\u041e\u041f-10 \u0440\u044b\u0431 + 8.2 \u0411\u0430\u0437\u0430 / \u041c\u0430\u0440\u0448\u0440\u0443\u0442\u044b (\u0431\u0435\u0437 \u0432\u0435\u0440\u0445\u043d\u0435\u0433\u043e \u0437\u0430\u0433\u043e\u043b\u043e\u0432\u043a\u0430 \u0434\u043e \u0440\u0430\u0441\u043a\u0440\u044b\u0442\u0438\u044f, \u0443\u043a\u0440\u0443\u043f\u043d\u0435\u043d\u043e \u0438 \u043e\u0442\u0446\u0435\u043d\u0442\u0440\u043e\u0432\u0430\u043d\u043e) --\\x3e\\n              <div class=\"klev-arc-duo-page\">\\n                <div class=\"klev-arc-glass klev-arc-plaque\" data-arc-open-plaque=\"8.1\">\\n                  ${u?`\\n                    <div class=\"klev-arc-plaque-metric\" style=\"color:var(--good);\">${h}%</div>\\n                    <div class=\"klev-arc-plaque-sub\">\\n                      <span class=\"arc-fish-svg-slot\" style=\"width:28px;height:15px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;\">${Wt(u)}</span>\\n                      <span style=\"overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:110px;\">${Be(u.name)}</span>\\n                    </div>\\n                  `:`\\n                    <div class=\"klev-arc-plaque-metric\" style=\"color:var(--good);\">${d}%</div>\\n                    <div class=\"klev-arc-plaque-sub\" style=\"color:var(--accent);\">\u041a\u043b\u0451\u0432 \u2022 \u0422\u041e\u041f-10 \u0440\u044b\u0431</div>\\n                  `}\\n                </div>\\n\\n                <div class=\"klev-arc-glass klev-arc-plaque\" data-arc-open-plaque=\"8.2\">\\n                  ${g?`\\n                    <div class=\"klev-arc-plaque-metric\" style=\"color:var(--accent);\">${g.distKm.toFixed(1).replace(\".\",\",\")} \u043a\u043c</div>\\n                    <div class=\"klev-arc-plaque-sub\" style=\"overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px;\">${Be(g.name)} \u2022 \u041c\u0430\u0440\u0448\u0440\u0443\u0442</div>\\n                  `:'\\n                    <div class=\"klev-arc-plaque-metric\" style=\"font-size:19px;color:var(--warn);\">\u041c\u0430\u0440\u0448\u0440\u0443\u0442</div>\\n                    <div class=\"klev-arc-plaque-sub\">\u0423\u043a\u0430\u0436\u0438\u0442\u0435 \u0431\u0430\u0437\u0443 \u043d\u0430 \u043a\u0430\u0440\u0442\u0435</div>\\n                  '}\\n                </div>\\n              </div>\\n\\n              \\x3c!-- \u042d\u041a\u0420\u0410\u041d 2: 8.3 \u0422\u043e\u0447\u043a\u0438 \u043d\u0430 \u043a\u0430\u0440\u0442\u0435 + 8.4 \u041e\u0444\u043b\u0430\u0439\u043d \u043a\u0430\u0440\u0442\u044b --\\x3e\\n              <div class=\"klev-arc-duo-page\">\\n                <div class=\"klev-arc-glass klev-arc-plaque\" data-arc-open-plaque=\"8.3\">\\n                  <div class=\"klev-arc-plaque-metric\">${y}</div>\\n                  <div class=\"klev-arc-plaque-sub\" style=\"color:var(--accent);\">\u0422\u043e\u0447\u043a\u0438 \u2022 \u0424\u0438\u043b\u044c\u0442\u0440</div>\\n                </div>\\n\\n                <div class=\"klev-arc-glass klev-arc-plaque\" data-arc-open-plaque=\"8.4\">\\n                  <div style=\"display:flex;align-items:center;justify-content:center;gap:8px;\">\\n                    <svg class=\"k-ico\" style=\"width:28px;height:28px;color:${b&&nc?\"#10b981\":\"#ef4444\"};\" viewBox=\"0 0 24 24\" fill=\"none\">\\n                      <circle cx=\"12\" cy=\"12\" r=\"9\" stroke=\"currentColor\" stroke-width=\"2.2\"/>\\n                      <circle cx=\"12\" cy=\"12\" r=\"4.2\" fill=\"currentColor\"/>\\n                    </svg>\\n                    <span class=\"klev-arc-plaque-metric\" style=\"font-size:18px;color:${b&&nc?\"var(--good)\":\"var(--bad)\"};\">${b?nc?\"50/120 \u041e\u041a\":\"\u0412\u042b\u041a\u041b\":\"\u041e\u0444\u043b\u0430\u0439\u043d\"}</span>\\n                  </div>\\n                  <div class=\"klev-arc-plaque-sub\">${b?nc?\"\u041a\u0430\u0440\u0442\u0430 \u0432 \u043f\u0430\u043c\u044f\u0442\u0438\":\"\u041e\u0444\u043b\u0430\u0439\u043d-\u0441\u043b\u043e\u0439 \u0441\u043a\u0440\u044b\u0442\":\"\u0421\u043a\u0430\u0447\u0430\u0442\u044c 50 / 120 \u043a\u043c\"}</div>\\n                </div>\\n              </div>\\n\\n              \\x3c!-- \u042d\u041a\u0420\u0410\u041d 3: 8.5 \u0413\u043b\u0443\u0431\u0438\u043d\u044b + 8.6 \u0423\u043b\u043e\u0432 --\\x3e\\n              <div class=\"klev-arc-duo-page\">\\n                <div class=\"klev-arc-glass klev-arc-plaque\" data-arc-open-plaque=\"8.5\">\\n                  <div style=\"display:flex;align-items:center;justify-content:center;gap:7px;\">\\n                    <svg class=\"k-ico\" style=\"width:26px;height:26px;color:${v?\"#10b981\":\"#ef4444\"};\" viewBox=\"0 0 24 24\" fill=\"none\">\\n                      <circle cx=\"12\" cy=\"12\" r=\"9\" stroke=\"currentColor\" stroke-width=\"2.2\"/>\\n                      <path d=\"M12 12l5-5\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\"/>\\n                      <circle cx=\"12\" cy=\"12\" r=\"2.2\" fill=\"currentColor\"/>\\n                    </svg>\\n                    <span class=\"klev-arc-plaque-metric\" style=\"font-size:21px;\">~${t.depth.toFixed(1)} \u043c</span>\\n                  </div>\\n                  <div class=\"klev-arc-plaque-sub\">\u0413\u043b\u0443\u0431\u0438\u043d\u044b \u2022 \u0418\u0437\u043e\u0431\u0430\u0442\u044b</div>\\n                </div>\\n\\n                <div class=\"klev-arc-glass klev-arc-plaque\" data-arc-open-plaque=\"8.6\">\\n                  <div class=\"klev-arc-plaque-metric\" style=\"color:var(--good);\">${w}</div>\\n                  <div class=\"klev-arc-plaque-sub\" style=\"color:var(--accent);\">\u0423\u043b\u043e\u0432\u044b \u2022 120 \u043a\u043c</div>\\n                </div>\\n              </div>\\n            </div>\\n          </div>\\n\\n          \\x3c!-- \u0418\u043d\u0434\u0438\u043a\u0430\u0442\u043e\u0440\u044b \u0441\u0432\u0430\u0439\u043f\u0430 3 \u044d\u043a\u0440\u0430\u043d\u043e\u0432 --\\x3e\\n          <div style=\"display:flex;justify-content:center;align-items:center;gap:6px;\">\\n            ${[0,1,2].map((e=>`\\n              <button type=\"button\" data-arc-page-dot=\"${e}\" style=\"height:6px;width:${Yu===e?\"22px\":\"6px\"};border-radius:999px;border:none;background:${Yu===e?\"var(--accent)\":\"rgba(148,163,184,0.45)\"};transition:all 0.25s ease;cursor:pointer;padding:0;\" aria-label=\"\u042d\u043a\u0440\u0430\u043d ${e+1}\"></button>\\n            `)).join(\"\")}\\n          </div>\\n        `}\\n      </div>\\n\\n      \\x3c!-- \u041f. 2.3: \u041d\u0438\u0436\u043d\u0438\u0439 \u044f\u0437\u044b\u0447\u043e\u043a \u00ab\u0411\u044b\u0441\u0442\u0440\u044b\u0439 \u0434\u043e\u0441\u0442\u0443\u043f\u00bb --\\x3e\\n      ";
  const newMapSinglePills = "<div class=\"klev-arc-single-pills-strip\" id=\"arcCompactPillsStrip\">\n            <button type=\"button\" class=\"klev-arc-single-pill\" data-arc-open-plaque=\"8.1\">\u041a\u043b\u0451\u0432 ${u?h:d}%</button>\n            <button type=\"button\" class=\"klev-arc-single-pill\" data-arc-open-plaque=\"8.2\">${g?\"\u0411\u0430\u0437\u0430 \"+g.distKm.toFixed(1).replace(\".\",\",\")+\" \u043a\u043c\":\"\u041c\u0430\u0440\u0448\u0440\u0443\u0442\"}</button>\n            <button type=\"button\" class=\"klev-arc-single-pill\" data-arc-open-plaque=\"8.3\">\u0422\u043e\u0447\u043a\u0438 (${y})</button>\n            <button type=\"button\" class=\"klev-arc-single-pill\" data-arc-open-plaque=\"8.4\">\u041e\u0444\u043b\u0430\u0439\u043d (${(_cachedPacksList||[]).length})</button>\n            <button type=\"button\" class=\"klev-arc-single-pill\" data-arc-open-plaque=\"8.5\">\u0413\u043b\u0443\u0431\u0438\u043d\u044b ~${t.depth.toFixed(1)}\u043c</button>\n            <button type=\"button\" class=\"klev-arc-single-pill\" data-arc-open-plaque=\"8.6\">\u0423\u043b\u043e\u0432 (${w})</button>\n          </div>\n        `}\n      </div>\n\n      ";
  if (runtimeCode.includes(oldMapDuoChunk) && !runtimeCode.includes('id="arcCompactPillsStrip"')) {
    runtimeCode = runtimeCode.replace(oldMapDuoChunk, newMapSinglePills);
  }

  // 6.5: Обязательный блок миниатюры фото улова в карточках Журнала уловов
  if (!runtimeCode.includes('catch-photo-thumb-placeholder')) {
    runtimeCode = runtimeCode.replace(
      ':""}\n              </div>\n            `).join("")}',
      ":'<div class=\"catch-photo-thumb-placeholder\" style=\"margin-top:4px;padding:7px 10px;border-radius:10px;background:var(--panel);border:1px dashed var(--border);display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px;color:var(--muted);\"><span>\u0424\u043e\u0442\u043e \u0443\u043b\u043e\u0432\u0430: \u043d\u0435 \u043f\u0440\u0438\u043a\u0440\u0435\u043f\u043b\u0435\u043d\u043e (\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u043e \u0432 \u0437\u0430\u043f\u0438\u0441\u0438/\u0418\u0418-\u0441\u043a\u0430\u043d\u0435\u0440\u0435)</span><span style=\"color:var(--accent);font-weight:800;\">\u0424\u043e\u0442\u043e</span></div>'}\n              </div>\n            `).join(\"\")}"
    );
  }

  // 6.6: Добавление контроллера v2.9.1 (живой сонар, 4 подвкладки прогноза, компактное меню, гибридный SOS, мини-экран)
  if (!runtimeCode.includes('window.__KLEV_REDESIGN_V291_ACTIVE__')) {
    runtimeCode = runtimeCode.trim() + "\n" + "\n/* === \u041a\u041b\u0401\u0412 \u041f\u0420\u041e 2.0 \u2022 v2.9.1 (r241) LIVE SONAR, COMPACT MENU, HYBRID SOS, LANDSCAPE & REAR SCREEN CONTROLLER === */\n(function initKlevRedesignV291Controller() {\n  if (typeof window === 'undefined' || typeof document === 'undefined') return;\n  if (window.__KLEV_REDESIGN_V291_ACTIVE__) return;\n  window.__KLEV_REDESIGN_V291_ACTIVE__ = true;\n\n  var SONAR_RAD_PER_SEC = 0.52; // \u0421\u043f\u043e\u043a\u043e\u0439\u043d\u0430\u044f \u0441\u043a\u043e\u0440\u043e\u0441\u0442\u044c \u0432\u0440\u0430\u0449\u0435\u043d\u0438\u044f \u0441\u043e\u043d\u0430\u0440\u0430 (~12 \u0441\u0435\u043a \u043d\u0430 \u043f\u043e\u043b\u043d\u044b\u0439 \u043e\u0431\u043e\u0440\u043e\u0442)\n  var sonarAngle = 0.65;\n  var lastFrameTs = 0;\n  var activeSubTab = 'overview';\n  var openWaterOverride = false;\n\n  var SONAR_THEMES = {\n    dark: {\n      id: 'dark',\n      outerRingColor: '#00e5ff',\n      gridColor: 'rgba(0, 229, 255, 0.34)',\n      degreeColor: 'rgba(125, 211, 252, 0.78)',\n      beamColorRgb: [0, 240, 255],\n      fishIdleColor: 'rgba(56, 189, 248, 0.22)',\n      fishLitColor: '#7dd3fc',\n      fishGlowColor: '#00f0ff',\n      hexCoreBg: 'rgba(0, 229, 255, 0.08)',\n      hexCoreBorder: 'rgba(0, 229, 255, 0.35)',\n      scaleColors: ['rgba(14, 165, 233, 0.24)', 'rgba(16, 185, 129, 0.40)']\n    },\n    contrast: {\n      id: 'contrast',\n      outerRingColor: '#00f5d4',\n      gridColor: 'rgba(0, 245, 212, 0.42)',\n      degreeColor: 'rgba(251, 191, 36, 0.88)',\n      beamColorRgb: [0, 245, 212],\n      fishIdleColor: 'rgba(245, 158, 11, 0.24)',\n      fishLitColor: '#fef08a',\n      fishGlowColor: '#fbbf24',\n      hexCoreBg: 'rgba(15, 23, 42, 0.72)',\n      hexCoreBorder: 'rgba(0, 245, 212, 0.45)',\n      scaleColors: ['rgba(245, 158, 11, 0.26)', 'rgba(0, 245, 212, 0.44)']\n    },\n    light: {\n      id: 'light',\n      outerRingColor: '#0284c7',\n      gridColor: 'rgba(2, 132, 199, 0.32)',\n      degreeColor: 'rgba(3, 105, 161, 0.78)',\n      beamColorRgb: [14, 165, 233],\n      fishIdleColor: 'rgba(2, 132, 199, 0.22)',\n      fishLitColor: '#ffffff',\n      fishGlowColor: '#0284c7',\n      hexCoreBg: 'rgba(255, 255, 255, 0.65)',\n      hexCoreBorder: 'rgba(2, 132, 199, 0.34)',\n      scaleColors: ['rgba(2, 132, 199, 0.22)', 'rgba(16, 185, 129, 0.36)']\n    }\n  };\n\n  var baseAngles = [12, 32, 52, 74, 96, 118, 140, 162, 184, 206, 228, 250, 272, 294, 316, 338, 22, 128];\n  var baseRadii  = [0.80, 0.62, 0.74, 0.52, 0.82, 0.68, 0.76, 0.56, 0.72, 0.47, 0.81, 0.64, 0.45, 0.55, 0.83, 0.59, 0.70, 0.49];\n  var baseSizes  = [1.02, 0.85, 0.90, 0.78, 1.06, 0.82, 1.02, 0.84, 0.88, 0.76, 0.94, 0.86, 0.74, 0.80, 0.98, 0.84, 0.88, 0.78];\n  var sonarFishPool = [];\n  for (var i = 0; i < 18; i++) {\n    sonarFishPool.push({\n      angleRad: (baseAngles[i] * Math.PI) / 180,\n      radiusNorm: baseRadii[i],\n      sizeScale: baseSizes[i],\n      headingSign: (i % 2 === 0) ? 1 : -1,\n      swimSpeed: (0.0012 + (i % 4) * 0.0004) * ((i % 2 === 0) ? 1 : -1),\n      depthMeters: (2.2 + (i * 1.1) % 8.4).toFixed(1)\n    });\n  }\n\n  function drawSonarFishIcon(ctx, x, y, size, dirSign, fillStyle, glowColor, glowStrength) {\n    ctx.save();\n    ctx.translate(x, y);\n    ctx.scale(dirSign * size, size);\n    if (glowStrength > 0.08 && glowColor) {\n      ctx.shadowColor = glowColor;\n      ctx.shadowBlur = 10 * glowStrength;\n    }\n    ctx.fillStyle = fillStyle;\n    ctx.beginPath();\n    ctx.moveTo(9.5, 0);\n    ctx.quadraticCurveTo(3.5, -4.4, -4.2, -2.1);\n    ctx.lineTo(-9.5, -5.2);\n    ctx.lineTo(-7.6, 0);\n    ctx.lineTo(-9.5, 5.2);\n    ctx.lineTo(-4.2, 2.1);\n    ctx.quadraticCurveTo(3.5, 4.4, 9.5, 0);\n    ctx.closePath();\n    ctx.fill();\n    ctx.restore();\n  }\n\n  function renderSonarCanvasInstance(canvas, scorePct, showDegrees) {\n    if (!canvas || !canvas.getContext) return;\n    var ctx = canvas.getContext('2d');\n    if (!ctx) return;\n    var cssW = canvas.clientWidth || 228;\n    var cssH = canvas.clientHeight || 228;\n    var dpr = Math.min(window.devicePixelRatio || 1, 2);\n    var targetW = Math.round(cssW * dpr);\n    var targetH = Math.round(cssH * dpr);\n    if (canvas.width !== targetW || canvas.height !== targetH) {\n      canvas.width = targetW;\n      canvas.height = targetH;\n    }\n    ctx.save();\n    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);\n    ctx.clearRect(0, 0, cssW, cssH);\n\n    var themeKey = document.documentElement.getAttribute('data-theme') || 'dark';\n    var t = SONAR_THEMES[themeKey] || SONAR_THEMES.dark;\n    var cx = cssW * 0.5;\n    var cy = cssH * 0.5;\n    var R = Math.min(cssW, cssH) * 0.45;\n    var score = Math.max(5, Math.min(100, Number(scorePct) || 72));\n\n    // 1. \u041a\u043e\u043d\u0446\u0435\u043d\u0442\u0440\u0438\u0447\u0435\u0441\u043a\u0438\u0435 \u043a\u043e\u043b\u044c\u0446\u0430 (1.0, 0.92, 0.74, 0.54, 0.34)\n    var rings = [1.0, 0.92, 0.74, 0.54, 0.34];\n    for (var rIdx = 0; rIdx < rings.length; rIdx++) {\n      ctx.beginPath();\n      ctx.arc(cx, cy, R * rings[rIdx], 0, Math.PI * 2);\n      ctx.strokeStyle = (rIdx === 1) ? t.outerRingColor : t.gridColor;\n      ctx.lineWidth = (rIdx === 1) ? 2.0 : 1.0;\n      ctx.stroke();\n    }\n\n    // 2. \u0412 \u0442\u0435\u043c\u0435 contrast \u2014 4 \u0441\u0435\u0433\u043c\u0435\u043d\u0442\u0438\u0440\u043e\u0432\u0430\u043d\u043d\u044b\u0445 \u043f\u0443\u043d\u043a\u0442\u0438\u0440\u043d\u044b\u0445 \u043a\u043e\u043b\u044c\u0446\u0430 \u043a\u0430\u043a \u043d\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043e\u0447\u043d\u043e\u043c \u0441\u043e\u043d\u0430\u0440\u0435\n    if (t.id === 'contrast') {\n      var segConfigs = [\n        { r: 0.90, w: 4.5, dash: [11, 5], col: 'rgba(0, 245, 212, 0.85)' },\n        { r: 0.81, w: 5.5, dash: [15, 7], col: 'rgba(245, 158, 11, 0.82)' },\n        { r: 0.70, w: 4.5, dash: [13, 8], col: 'rgba(245, 158, 11, 0.46)' },\n        { r: 0.59, w: 4.0, dash: [9, 7],  col: 'rgba(0, 245, 212, 0.36)' }\n      ];\n      for (var sIdx = 0; sIdx < segConfigs.length; sIdx++) {\n        var sc = segConfigs[sIdx];\n        ctx.save();\n        ctx.beginPath();\n        ctx.arc(cx, cy, R * sc.r, 0, Math.PI * 2);\n        ctx.strokeStyle = sc.col;\n        ctx.lineWidth = sc.w;\n        ctx.setLineDash(sc.dash);\n        ctx.stroke();\n        ctx.restore();\n      }\n    }\n\n    // 3. \u041f\u043e\u043b\u0443\u043f\u0440\u043e\u0437\u0440\u0430\u0447\u043d\u0430\u044f (\u043d\u0435 \u043a\u0438\u0441\u043b\u043e\u0442\u043d\u0430\u044f) \u0437\u0430\u043f\u043e\u043b\u043d\u044f\u0435\u043c\u0430\u044f \u0433\u0440\u0430\u0434\u0438\u0435\u043d\u0442\u043d\u0430\u044f \u0448\u043a\u0430\u043b\u0430 \u043a\u043b\u0451\u0432\u0430 \u043f\u043e \u0432\u043d\u0435\u0448\u043d\u0435\u043c\u0443 \u043a\u043e\u043b\u044c\u0446\u0443\n    var startArc = -Math.PI * 0.5;\n    var endArc = startArc + (Math.PI * 2) * (score / 100);\n    var arcGrad = ctx.createLinearGradient(cx - R, cy + R, cx + R, cy - R);\n    arcGrad.addColorStop(0, t.scaleColors[0]);\n    arcGrad.addColorStop(1, t.scaleColors[1]);\n    ctx.save();\n    ctx.beginPath();\n    ctx.arc(cx, cy, R * 0.84, startArc, endArc, false);\n    ctx.strokeStyle = arcGrad;\n    ctx.lineWidth = Math.max(6, R * 0.085);\n    ctx.lineCap = 'round';\n    ctx.stroke();\n    ctx.restore();\n\n    // 4. \u041f\u0435\u0440\u0435\u043a\u0440\u0435\u0441\u0442\u0438\u0435 \u0438 \u0448\u043a\u0430\u043b\u0430 \u0433\u0440\u0430\u0434\u0443\u0441\u043e\u0432 0..350\n    ctx.save();\n    ctx.strokeStyle = t.gridColor;\n    ctx.lineWidth = 0.9;\n    ctx.beginPath();\n    ctx.moveTo(cx - R * 0.92, cy);\n    ctx.lineTo(cx + R * 0.92, cy);\n    ctx.moveTo(cx, cy - R * 0.92);\n    ctx.lineTo(cx, cy + R * 0.92);\n    ctx.stroke();\n    ctx.restore();\n\n    if (showDegrees) {\n      ctx.save();\n      ctx.font = '700 ' + Math.max(7.5, Math.round(R * 0.072)) + 'px system-ui, sans-serif';\n      ctx.fillStyle = t.degreeColor;\n      ctx.textAlign = 'center';\n      ctx.textBaseline = 'middle';\n      for (var deg = 0; deg < 360; deg += 10) {\n        var rad = (deg - 90) * Math.PI / 180;\n        var isMajor = (deg % 30 === 0);\n        var rIn = R * (isMajor ? 0.92 : 0.945);\n        var rOut = R * 0.985;\n        ctx.beginPath();\n        ctx.moveTo(cx + Math.cos(rad) * rIn, cy + Math.sin(rad) * rIn);\n        ctx.lineTo(cx + Math.cos(rad) * rOut, cy + Math.sin(rad) * rOut);\n        ctx.strokeStyle = t.gridColor;\n        ctx.lineWidth = isMajor ? 1.3 : 0.8;\n        ctx.stroke();\n        if (isMajor) {\n          var rTxt = R * 0.96;\n          ctx.save();\n          ctx.translate(cx + Math.cos(rad) * rTxt, cy + Math.sin(rad) * rTxt);\n          ctx.rotate(rad + Math.PI / 2);\n          ctx.fillText(String(deg), 0, -R * 0.035);\n          ctx.restore();\n        }\n      }\n      ctx.restore();\n    }\n\n    // 5. \u0421\u0435\u043a\u0442\u043e\u0440 \u0441\u043a\u0430\u043d\u0438\u0440\u0443\u044e\u0449\u0435\u0433\u043e \u043b\u0443\u0447\u0430 \u0441\u043e\u043d\u0430\u0440\u0430 (48 \u0448\u0430\u0433\u043e\u0432 \u043c\u044f\u0433\u043a\u043e\u0433\u043e \u0437\u0430\u0442\u0443\u0445\u0430\u043d\u0438\u044f)\n    var sweepSpan = 1.05;\n    var steps = 36;\n    var br = t.beamColorRgb[0], bg = t.beamColorRgb[1], bb = t.beamColorRgb[2];\n    for (var b = 0; b < steps; b++) {\n      var frac0 = b / steps;\n      var frac1 = (b + 1) / steps;\n      var a0 = sonarAngle - sweepSpan * (1 - frac0);\n      var a1 = sonarAngle - sweepSpan * (1 - frac1);\n      var alpha = Math.pow(frac1, 1.85) * 0.24;\n      ctx.beginPath();\n      ctx.moveTo(cx, cy);\n      ctx.arc(cx, cy, R * 0.91, a0, a1);\n      ctx.closePath();\n      ctx.fillStyle = 'rgba(' + br + ',' + bg + ',' + bb + ',' + alpha.toFixed(3) + ')';\n      ctx.fill();\n    }\n\n    // \u041f\u0435\u0440\u0435\u0434\u043d\u044f\u044f \u043b\u0438\u043d\u0438\u044f \u043b\u0443\u0447\u0430\n    ctx.save();\n    ctx.beginPath();\n    ctx.moveTo(cx, cy);\n    ctx.lineTo(cx + Math.cos(sonarAngle) * R * 0.92, cy + Math.sin(sonarAngle) * R * 0.92);\n    ctx.strokeStyle = t.outerRingColor;\n    ctx.lineWidth = 2.1;\n    ctx.shadowColor = t.outerRingColor;\n    ctx.shadowBlur = 8;\n    ctx.stroke();\n    ctx.restore();\n\n    // 6. \u0420\u044b\u0431\u043a\u0438-\u0446\u0435\u043b\u0438 (\u043a\u043e\u043b\u0438\u0447\u0435\u0441\u0442\u0432\u043e \u0437\u0430\u0432\u0438\u0441\u0438\u0442 \u043e\u0442 % \u043f\u0440\u043e\u0433\u043d\u043e\u0437\u0430 \u043a\u043b\u0451\u0432\u0430: \u043e\u0442 2 \u0434\u043e 18)\n    var visibleFishCount = Math.max(2, Math.min(18, Math.round((score / 100) * 18)));\n    for (var fIdx = 0; fIdx < visibleFishCount; fIdx++) {\n      var f = sonarFishPool[fIdx];\n      var fx = cx + Math.cos(f.angleRad) * (R * f.radiusNorm);\n      var fy = cy + Math.sin(f.angleRad) * (R * f.radiusNorm);\n      var diff = (sonarAngle - f.angleRad) % (Math.PI * 2);\n      if (diff < 0) diff += Math.PI * 2;\n      var glow = diff < 1.35 ? Math.max(0, 1 - diff / 1.35) : 0;\n      var fCol = glow > 0.15 ? t.fishLitColor : t.fishIdleColor;\n      drawSonarFishIcon(ctx, fx, fy, (R / 140) * f.sizeScale * 0.85, f.headingSign, fCol, t.fishGlowColor, glow);\n      if (glow > 0.32 && showDegrees) {\n        ctx.save();\n        ctx.beginPath();\n        ctx.arc(fx, fy, R * 0.085, 0, Math.PI * 2);\n        ctx.strokeStyle = t.outerRingColor;\n        ctx.globalAlpha = glow * 0.82;\n        ctx.lineWidth = 1.1;\n        ctx.stroke();\n        ctx.font = '800 ' + Math.max(8, Math.round(R * 0.075)) + 'px system-ui, sans-serif';\n        ctx.fillStyle = t.fishLitColor;\n        ctx.fillText(f.depthMeters + '\u043c', fx + R * 0.095, fy + 2);\n        ctx.restore();\n      }\n    }\n\n    // 7. \u0426\u0435\u043d\u0442\u0440\u0430\u043b\u044c\u043d\u044b\u0439 \u0433\u0435\u043a\u0441\u0430\u0433\u043e\u043d (\u0432\u043d\u0443\u0442\u0440\u0438 \u043e\u0442\u043e\u0431\u0440\u0430\u0436\u0430\u0435\u0442\u0441\u044f \u0442\u043e\u043b\u044c\u043a\u043e % \u043f\u0440\u043e\u0433\u043d\u043e\u0437\u0430 \u043a\u043b\u0451\u0432\u0430 \u0431\u0435\u0437 \u0449\u0443\u043a\u0438 \u0438 \u043b\u0438\u0448\u043d\u0438\u0445 \u043d\u0430\u0434\u043f\u0438\u0441\u0435\u0439)\n    var hexR = R * 0.33;\n    ctx.save();\n    ctx.beginPath();\n    for (var h = 0; h < 6; h++) {\n      var ha = (h * 60 - 30) * Math.PI / 180;\n      var hx = cx + Math.cos(ha) * hexR;\n      var hy = cy + Math.sin(ha) * hexR;\n      if (h === 0) ctx.moveTo(hx, hy);\n      else ctx.lineTo(hx, hy);\n    }\n    ctx.closePath();\n    ctx.fillStyle = t.hexCoreBg;\n    ctx.fill();\n    ctx.strokeStyle = t.hexCoreBorder;\n    ctx.lineWidth = 1.6;\n    ctx.stroke();\n    ctx.restore();\n\n    ctx.restore();\n  }\n\n  function stepLiveSonars(ts) {\n    if (!lastFrameTs) lastFrameTs = ts;\n    var dt = Math.min(0.06, Math.max(0.001, (ts - lastFrameTs) / 1000));\n    lastFrameTs = ts;\n    sonarAngle = (sonarAngle + dt * SONAR_RAD_PER_SEC) % (Math.PI * 2);\n    for (var i = 0; i < sonarFishPool.length; i++) {\n      sonarFishPool[i].angleRad = (sonarFishPool[i].angleRad + sonarFishPool[i].swimSpeed * dt * 12 + Math.PI * 2) % (Math.PI * 2);\n    }\n\n    var heroCanvas = document.getElementById('bentoHeroSonarCanvas');\n    if (heroCanvas && heroCanvas.offsetParent !== null) {\n      var scoreAttr = Number(heroCanvas.getAttribute('data-sonar-score') || 78);\n      renderSonarCanvasInstance(heroCanvas, scoreAttr, true);\n    }\n\n    var rearHud = document.getElementById('klevRearScreenHud');\n    var rearCanvas = document.getElementById('klevRearSonarCanvas');\n    if (rearHud && rearCanvas && window.getComputedStyle(rearHud).display !== 'none') {\n      var rearScore = Number(rearCanvas.getAttribute('data-sonar-score') || 78);\n      renderSonarCanvasInstance(rearCanvas, rearScore, false);\n    }\n\n    requestAnimationFrame(stepLiveSonars);\n  }\n\n  // \u0421\u0438\u043d\u0445\u0440\u043e\u043d\u0438\u0437\u0430\u0446\u0438\u044f 4 \u0432\u043d\u0443\u0442\u0440\u0435\u043d\u043d\u0438\u0445 \u0432\u043a\u043b\u0430\u0434\u043e\u043a \u044d\u043a\u0440\u0430\u043d\u0430 \u041f\u0440\u043e\u0433\u043d\u043e\u0437 \u0438 \u0441\u0435\u0437\u043e\u043d\u043d\u043e\u0433\u043e \u0442\u0443\u043c\u0431\u043b\u0435\u0440\u0430 \u043e\u0442\u043a\u0440\u044b\u0442\u043e\u0439 \u0432\u043e\u0434\u044b\n  function syncForecastSubTabsAndSeasonalSwim() {\n    var secFc = document.getElementById('secForecast');\n    if (!secFc) return;\n    if (!secFc.getAttribute('data-fc-subtab')) {\n      secFc.setAttribute('data-fc-subtab', activeSubTab);\n    }\n    var heroCard = document.getElementById('bentoSwipeHeroCard');\n    if (heroCard && !document.getElementById('fcSegmentedSubTabs')) {\n      var tabsBar = document.createElement('div');\n      tabsBar.id = 'fcSegmentedSubTabs';\n      tabsBar.className = 'klev-fc-subtabs-bar';\n      tabsBar.setAttribute('role', 'tablist');\n      tabsBar.innerHTML =\n        '<button type=\"button\" class=\"klev-fc-subtab-btn ' + (activeSubTab === 'overview' ? 'active' : '') + '\" data-fc-subtab-btn=\"overview\">\u041e\u0431\u0437\u043e\u0440</button>' +\n        '<button type=\"button\" class=\"klev-fc-subtab-btn ' + (activeSubTab === 'tackle' ? 'active' : '') + '\" data-fc-subtab-btn=\"tackle\">\u0421\u043d\u0430\u0441\u0442\u0438</button>' +\n        '<button type=\"button\" class=\"klev-fc-subtab-btn ' + (activeSubTab === 'days10' ? 'active' : '') + '\" data-fc-subtab-btn=\"days10\">10 \u0434\u043d\u0435\u0439</button>' +\n        '<button type=\"button\" class=\"klev-fc-subtab-btn ' + (activeSubTab === 'weather' ? 'active' : '') + '\" data-fc-subtab-btn=\"weather\">\u041f\u043e\u0433\u043e\u0434\u0430</button>';\n      heroCard.insertAdjacentElement('afterend', tabsBar);\n    }\n\n    // \u0421\u0435\u0437\u043e\u043d\u043d\u044b\u0439 \u043f\u0435\u0440\u0435\u043a\u043b\u044e\u0447\u0430\u0442\u0435\u043b\u044c \u00ab\u0421\u0435\u0437\u043e\u043d \u043e\u0442\u043a\u0440\u044b\u0442\u043e\u0439 \u0432\u043e\u0434\u044b (\u0424\u0438\u0434\u0435\u0440 / \u041a\u0430\u0440\u043f)\u00bb \u0434\u043b\u044f \u0431\u043b\u043e\u043a\u0430 \u043a\u0430\u0440\u0442\u044b \u0441\u0432\u0438\u043c\u0430 \u0438 \u0442\u0430\u0439\u043c\u0435\u0440\u0430 \u043f\u0435\u0440\u0435\u0437\u0430\u0431\u0440\u043e\u0441\u0430\n    var clipInp = document.getElementById('fcCarpClipInput');\n    if (clipInp) {\n      var swimRow = clipInp.closest('div[style*=\"justify-content:space-between\"]');\n      if (swimRow) {\n        var st = window.__KLEV_STORE__ ? window.__KLEV_STORE__.getState() : null;\n        var curDay = st && st.weatherDays ? (st.weatherDays[st.dayIdx] || st.weatherDays[2] || st.weatherDays[0]) : null;\n        var iceState = (curDay && curDay.iceState) || (st && st.iceState) || 'open_water';\n        var isOpenWaterNow = (iceState === 'open_water') || openWaterOverride;\n        if (!document.getElementById('fcOpenWaterCarpToggleWrap')) {\n          var toggleWrap = document.createElement('label');\n          toggleWrap.id = 'fcOpenWaterCarpToggleWrap';\n          toggleWrap.style.cssText = 'margin-top:8px;padding:7px 10px;border-radius:11px;background:var(--panel);border:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:11.5px;font-weight:800;cursor:pointer;';\n          toggleWrap.innerHTML =\n            '<span>\u0421\u0435\u0437\u043e\u043d \u043e\u0442\u043a\u0440\u044b\u0442\u043e\u0439 \u0432\u043e\u0434\u044b (\u041a\u0430\u0440\u0442\u0430 \u0441\u0432\u0438\u043c\u0430 \u0438 \u0442\u0430\u0439\u043c\u0435\u0440 \u043f\u0435\u0440\u0435\u0437\u0430\u0431\u0440\u043e\u0441\u0430)</span>' +\n            '<input type=\"checkbox\" class=\"klev-switch\" id=\"fcOpenWaterCarpToggle\" ' + (isOpenWaterNow ? 'checked' : '') + '>';\n          swimRow.parentNode.insertBefore(toggleWrap, swimRow);\n        }\n        var chk = document.getElementById('fcOpenWaterCarpToggle');\n        if (chk) chk.checked = isOpenWaterNow;\n        swimRow.style.display = isOpenWaterNow ? 'flex' : 'none';\n      }\n    }\n\n    // \u041e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u0435 Rear Screen HUD (Xiaomi 18 Pro Max / Flip)\n    var stNow = window.__KLEV_STORE__ ? window.__KLEV_STORE__.getState() : null;\n    if (stNow) {\n      var rearLoc = document.getElementById('klevRearLocText');\n      if (rearLoc) rearLoc.textContent = stNow.selectedWaterName || stNow.locLabel || '\u0412\u043e\u0434\u043e\u0451\u043c \u0420\u0424';\n      var heroScoreEl = document.getElementById('bentoHeroSonarPctText');\n      var scoreText = heroScoreEl ? heroScoreEl.textContent : '78%';\n      var scoreNum = parseInt(scoreText, 10) || 78;\n      var rearPct = document.getElementById('klevRearPctText');\n      if (rearPct) rearPct.textContent = scoreNum + '%';\n      var rearCanv = document.getElementById('klevRearSonarCanvas');\n      if (rearCanv) rearCanv.setAttribute('data-sonar-score', String(scoreNum));\n      var dObj = stNow.weatherDays ? (stNow.weatherDays[stNow.dayIdx] || stNow.weatherDays[2] || stNow.weatherDays[0]) : null;\n      var rearWI = document.getElementById('klevRearWaterIce');\n      if (rearWI && dObj) {\n        var iceTxt = dObj.iceState === 'open_water' ? '\u041e\u0442\u043a\u0440\u044b\u0442\u0430\u044f \u0432\u043e\u0434\u0430' : ('\u041b\u0451\u0434 ~' + (dObj.iceThickness || 18) + ' \u0441\u043c');\n        rearWI.textContent = '\u0412\u043e\u0434\u0430 ' + (dObj.waterTemp > 0 ? '+' + dObj.waterTemp : dObj.waterTemp) + '\u00b0C \u2022 ' + iceTxt;\n      }\n    }\n  }\n\n  // \u0414\u0435\u043b\u0435\u0433\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435 \u043a\u043b\u0438\u043a\u043e\u0432 \u0434\u043b\u044f \u043f\u043e\u0434\u0432\u043a\u043b\u0430\u0434\u043e\u043a \u041f\u0440\u043e\u0433\u043d\u043e\u0437\u0430, \u043a\u043e\u043c\u043f\u0430\u043a\u0442\u043d\u043e\u0433\u043e \u041c\u0435\u043d\u044e \u0438 \u043c\u0438\u043d\u0438-\u044d\u043a\u0440\u0430\u043d\u0430\n  document.addEventListener('click', function(e) {\n    var t = e.target;\n    if (!t || typeof t.closest !== 'function') return;\n\n    var subBtn = t.closest('[data-fc-subtab-btn]');\n    if (subBtn) {\n      activeSubTab = subBtn.getAttribute('data-fc-subtab-btn') || 'overview';\n      var secFc = document.getElementById('secForecast');\n      if (secFc) secFc.setAttribute('data-fc-subtab', activeSubTab);\n      document.querySelectorAll('[data-fc-subtab-btn]').forEach(function(b) {\n        b.classList.toggle('active', b.getAttribute('data-fc-subtab-btn') === activeSubTab);\n      });\n      return;\n    }\n\n    if (t.closest('#bentoHeroWaterIceLink')) {\n      if (typeof window.__KLEV_NAVIGATE_SECTION__ === 'function') {\n        window.__KLEV_NAVIGATE_SECTION__('weather');\n      }\n      return;\n    }\n\n    if (t.closest('#bottomNavMenuTriggerBtn')) {\n      e.preventDefault();\n      e.stopPropagation();\n      var menuBd = document.getElementById('klevCompactMenuBackdrop');\n      if (menuBd) menuBd.classList.toggle('open');\n      return;\n    }\n\n    if (t.closest('#klevCompactMenuCloseBtn') || (t.id === 'klevCompactMenuBackdrop')) {\n      var menuBdClose = document.getElementById('klevCompactMenuBackdrop');\n      if (menuBdClose) menuBdClose.classList.remove('open');\n      return;\n    }\n\n    var menuRouteBtn = t.closest('[data-klev-menu-route]');\n    if (menuRouteBtn) {\n      var targetRoute = menuRouteBtn.getAttribute('data-klev-menu-route');\n      var menuBdNav = document.getElementById('klevCompactMenuBackdrop');\n      if (menuBdNav) menuBdNav.classList.remove('open');\n      if (targetRoute === 'chats') {\n        var chatBtn = document.getElementById('navCircleChatsHubBtn');\n        if (chatBtn) { chatBtn.click(); return; }\n      }\n      if (typeof window.__KLEV_NAVIGATE_SECTION__ === 'function') {\n        window.__KLEV_NAVIGATE_SECTION__(targetRoute);\n      }\n      return;\n    }\n\n    var menuActBtn = t.closest('[data-klev-menu-action=\"settings\"]');\n    if (menuActBtn) {\n      var menuBdSet = document.getElementById('klevCompactMenuBackdrop');\n      if (menuBdSet) menuBdSet.classList.remove('open');\n      var setBtn = document.getElementById('topNavSettingsBtn');\n      if (setBtn) setBtn.click();\n      return;\n    }\n\n    var themeChip = t.closest('[data-klev-menu-theme]');\n    if (themeChip) {\n      var nextTheme = themeChip.getAttribute('data-klev-menu-theme');\n      document.documentElement.setAttribute('data-theme', nextTheme);\n      if (window.__KLEV_STORE__) {\n        window.__KLEV_STORE__.dispatch({ type: 'SET_THEME', payload: nextTheme });\n      }\n      return;\n    }\n\n    var glassChip = t.closest('[data-klev-menu-glass]');\n    if (glassChip) {\n      var isGlass = glassChip.getAttribute('data-klev-menu-glass') === '1';\n      document.documentElement.setAttribute('data-liquid-glass', isGlass ? '1' : '0');\n      if (window.__KLEV_STORE__) {\n        window.__KLEV_STORE__.dispatch({ type: 'SET_LIQUID_GLASS', payload: isGlass });\n      }\n      return;\n    }\n\n    if (t.closest('#klevMenuRearScreenToggleBtn')) {\n      var menuBdRear = document.getElementById('klevCompactMenuBackdrop');\n      if (menuBdRear) menuBdRear.classList.remove('open');\n      var isRear = document.documentElement.getAttribute('data-rear-screen') === '1';\n      document.documentElement.setAttribute('data-rear-screen', isRear ? '0' : '1');\n      return;\n    }\n\n    if (t.closest('#klevRearExitBtn')) {\n      document.documentElement.setAttribute('data-rear-screen', '0');\n      return;\n    }\n\n    if (t.closest('#klevRearNextFishBtn')) {\n      var nextFishBtn = document.getElementById('bentoNextFishBtn');\n      if (nextFishBtn) nextFishBtn.click();\n      return;\n    }\n\n    if (t.closest('#klevRearQuickSosBtn')) {\n      document.documentElement.setAttribute('data-rear-screen', '0');\n      var sosBtn = document.getElementById('bottomQuickSosBtn');\n      if (sosBtn) sosBtn.click();\n      return;\n    }\n  });\n\n  document.addEventListener('change', function(e) {\n    if (e.target && e.target.id === 'fcOpenWaterCarpToggle') {\n      openWaterOverride = Boolean(e.target.checked);\n      syncForecastSubTabsAndSeasonalSwim();\n    }\n  });\n\n  // \u0413\u0438\u0431\u0440\u0438\u0434\u043d\u044b\u0439 \u043f\u043e\u043b\u0437\u0443\u043d\u043e\u043a SOS (\u0441\u0432\u0430\u0439\u043f \u0432\u043f\u0440\u0430\u0432\u043e >= 75% \u0418\u041b\u0418 \u0443\u0434\u0435\u0440\u0436\u0430\u043d\u0438\u0435 2.0 \u0441\u0435\u043a)\n  function initHybridSosSlider() {\n    var track = document.getElementById('klevHybridSosTrack');\n    var knob = document.getElementById('klevHybridSosKnob');\n    var fill = document.getElementById('klevHybridSosFill');\n    var label = document.getElementById('klevHybridSosLabel');\n    if (!track || !knob || track.__sosBound) return;\n    track.__sosBound = true;\n\n    var dragging = false;\n    var startX = 0;\n    var holdTimer = null;\n    var holdInterval = null;\n    var holdStartMs = 0;\n\n    function fireSosAction() {\n      resetSosSlider();\n      var menuBd = document.getElementById('klevCompactMenuBackdrop');\n      if (menuBd) menuBd.classList.remove('open');\n      var origSosBtn = document.getElementById('bottomQuickSosBtn');\n      if (origSosBtn) origSosBtn.click();\n    }\n\n    function resetSosSlider() {\n      dragging = false;\n      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }\n      if (holdInterval) { clearInterval(holdInterval); holdInterval = null; }\n      knob.style.transform = 'translateX(0px)';\n      if (fill) fill.style.width = '0%';\n      if (label) label.textContent = '\u0421\u0432\u0430\u0439\u043f \u0432\u043f\u0440\u0430\u0432\u043e \u0438\u043b\u0438 2 \u0441\u0435\u043a \u0434\u043b\u044f SOS';\n    }\n\n    function onStart(clientX) {\n      dragging = true;\n      startX = clientX;\n      holdStartMs = Date.now();\n      if (holdTimer) clearTimeout(holdTimer);\n      if (holdInterval) clearInterval(holdInterval);\n      holdInterval = setInterval(function() {\n        if (!dragging) return;\n        var elapsed = Date.now() - holdStartMs;\n        var pct = Math.min(100, Math.round((elapsed / 2000) * 100));\n        if (fill && pct > 10) fill.style.width = pct + '%';\n        if (label && elapsed > 250) {\n          label.textContent = '\u0423\u0434\u0435\u0440\u0436\u0430\u043d\u0438\u0435 SOS: ' + Math.max(0.1, ((2000 - elapsed) / 1000)).toFixed(1) + ' \u0441\u0435\u043a...';\n        }\n      }, 80);\n      holdTimer = setTimeout(function() {\n        if (dragging) fireSosAction();\n      }, 2000);\n    }\n\n    function onMove(clientX) {\n      if (!dragging) return;\n      var maxDx = Math.max(80, (track.clientWidth || 260) - 46);\n      var dx = Math.max(0, Math.min(maxDx, clientX - startX));\n      var ratio = dx / maxDx;\n      knob.style.transform = 'translateX(' + Math.round(dx) + 'px)';\n      if (fill) fill.style.width = Math.round(ratio * 100) + '%';\n      if (ratio >= 0.78) {\n        fireSosAction();\n      }\n    }\n\n    track.addEventListener('touchstart', function(e) {\n      if (e.touches && e.touches[0]) onStart(e.touches[0].clientX);\n    }, { passive: true });\n    track.addEventListener('touchmove', function(e) {\n      if (e.touches && e.touches[0]) onMove(e.touches[0].clientX);\n    }, { passive: true });\n    track.addEventListener('touchend', resetSosSlider, { passive: true });\n    track.addEventListener('touchcancel', resetSosSlider, { passive: true });\n\n    track.addEventListener('mousedown', function(e) {\n      if (e.button === 0) onStart(e.clientX);\n    });\n    window.addEventListener('mousemove', function(e) {\n      if (dragging) onMove(e.clientX);\n    });\n    window.addEventListener('mouseup', function() {\n      if (dragging) resetSosSlider();\n    });\n  }\n\n  // \u0423\u043d\u0438\u0432\u0435\u0440\u0441\u0430\u043b\u044c\u043d\u044b\u0439 \u0436\u0435\u0441\u0442 \u00ab\u041d\u0430\u0437\u0430\u0434\u00bb \u0441\u0432\u0430\u0439\u043f\u043e\u043c \u043e\u0442 \u043b\u0435\u0432\u043e\u0433\u043e \u043a\u0440\u0430\u044f \u044d\u043a\u0440\u0430\u043d\u0430 (\u0432\u043e\u0437\u0432\u0440\u0430\u0442 \u0438\u0437 \u041f\u043e\u0433\u043e\u0434\u044b \u0438 \u0434\u0440\u0443\u0433\u0438\u0445 \u0440\u0430\u0437\u0434\u0435\u043b\u043e\u0432 \u043d\u0430 \u043f\u0440\u0435\u0434\u044b\u0434\u0443\u0449\u0438\u0439 \u044d\u043a\u0440\u0430\u043d)\n  var edgeSwipeStartX = 0;\n  var edgeSwipeStartY = 0;\n  document.addEventListener('touchstart', function(e) {\n    if (!e.touches || e.touches.length !== 1) { edgeSwipeStartX = 0; return; }\n    var x = e.touches[0].clientX;\n    if (x <= 24) {\n      edgeSwipeStartX = x;\n      edgeSwipeStartY = e.touches[0].clientY;\n    } else {\n      edgeSwipeStartX = 0;\n    }\n  }, { passive: true });\n  document.addEventListener('touchend', function(e) {\n    if (!edgeSwipeStartX || !e.changedTouches || !e.changedTouches[0]) return;\n    var dx = e.changedTouches[0].clientX - edgeSwipeStartX;\n    var dy = Math.abs(e.changedTouches[0].clientY - edgeSwipeStartY);\n    edgeSwipeStartX = 0;\n    if (dx > 64 && dx > dy * 1.6) {\n      if (typeof window.__KLEV_HANDLE_BACK__ === 'function') {\n        window.__KLEV_HANDLE_BACK__('edge_swipe');\n      }\n    }\n  }, { passive: true });\n\n  // \u0410\u0432\u0442\u043e-\u0432\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u0435 \u0440\u0435\u0436\u0438\u043c\u0430 \u043c\u0438\u043d\u0438-\u044d\u043a\u0440\u0430\u043d\u0430 \u043f\u0440\u0438 ?rear=1\n  if (window.location.search.indexOf('rear=1') !== -1) {\n    document.documentElement.setAttribute('data-rear-screen', '1');\n  }\n\n  function onDomReady() {\n    initHybridSosSlider();\n    syncForecastSubTabsAndSeasonalSwim();\n    if (window.__KLEV_STORE__ && typeof window.__KLEV_STORE__.subscribe === 'function') {\n      window.__KLEV_STORE__.subscribe(\n        function(s) { return { r: s.route, d: s.dayIdx, f: s.fishId, w: s.water, i: s.iceState }; },\n        function() { setTimeout(syncForecastSubTabsAndSeasonalSwim, 20); }\n      );\n    }\n    var obsTarget = document.getElementById('secForecast');\n    if (obsTarget && typeof MutationObserver !== 'undefined') {\n      var mo = new MutationObserver(function() {\n        syncForecastSubTabsAndSeasonalSwim();\n      });\n      mo.observe(obsTarget, { childList: true, subtree: true });\n    }\n    requestAnimationFrame(stepLiveSonars);\n  }\n\n  if (document.readyState === 'loading') {\n    document.addEventListener('DOMContentLoaded', onDomReady);\n  } else {\n    setTimeout(onDomReady, 0);\n  }\n})();\n" + "\n";
  }
  writeTextIfChanged('js/app.bundle.js', runtimeCode.trim() + '\n');

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

  // 6.7: Спокойная скорость вращения загрузочного сонара (0.52 вместо 1.8)
  idx = idx.replace(/var SONAR_SPEED_MULT = 1\.8;/g, 'var SONAR_SPEED_MULT = 0.52;');

  // 6.8: Вставка CSS редизайна v2.9.1 в index.html
  if (!idx.includes('КЛЁВ ПРО 2.0 • v2.9.1 (r241) TACTILE GLASSMORPHISM')) {
    idx = idx.replace('  </style>', "\n/* ==========================================================================\n   \u041a\u041b\u0401\u0412 \u041f\u0420\u041e 2.0 \u2022 v2.9.1 (r241) TACTILE GLASSMORPHISM & ADAPTIVE VIEWPORTS\n   \u0414\u0435\u0441\u043a\u0442\u043e\u043f\u043d\u044b\u0439 \u0440\u0435\u0436\u0438\u043c (html[data-desktop-web=\"1\"]) \u0441\u043e\u0445\u0440\u0430\u043d\u0451\u043d \u0431\u0435\u0437 \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u0439.\n   ========================================================================== */\n\n/* 1. \u0417\u0430\u043c\u0435\u043d\u0430 \u0432\u0441\u0435\u0445 \u0447\u0435\u043a\u0431\u043e\u043a\u0441\u043e\u0432 \u043d\u0430 \u0441\u0442\u0435\u043a\u043b\u044f\u043d\u043d\u044b\u0435 \u0442\u0443\u043c\u0431\u043b\u0435\u0440\u044b-\u043f\u0435\u0440\u0435\u043a\u043b\u044e\u0447\u0430\u0442\u0435\u043b\u0438 (.klev-switch) */\ninput[type=\"checkbox\"],\n.klev-switch {\n  appearance: none !important;\n  -webkit-appearance: none !important;\n  width: 38px !important;\n  height: 22px !important;\n  min-width: 38px !important;\n  min-height: 22px !important;\n  border-radius: 999px !important;\n  background: rgba(148, 163, 184, 0.28) !important;\n  border: 1px solid rgba(148, 163, 184, 0.45) !important;\n  position: relative !important;\n  cursor: pointer !important;\n  transition: background 0.22s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.22s ease, box-shadow 0.22s ease !important;\n  flex-shrink: 0 !important;\n  vertical-align: middle !important;\n  margin: 0 !important;\n  outline: none !important;\n}\ninput[type=\"checkbox\"]::after,\n.klev-switch::after {\n  content: \"\" !important;\n  position: absolute !important;\n  top: 2px !important;\n  left: 2px !important;\n  width: 16px !important;\n  height: 16px !important;\n  border-radius: 50% !important;\n  background: #ffffff !important;\n  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.32) !important;\n  transition: transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1) !important;\n}\ninput[type=\"checkbox\"]:checked,\n.klev-switch:checked {\n  background: linear-gradient(135deg, var(--accent, #38bdf8), var(--good, #10b981)) !important;\n  border-color: var(--accent, #38bdf8) !important;\n  box-shadow: 0 0 10px rgba(56, 189, 248, 0.35) !important;\n}\ninput[type=\"checkbox\"]:checked::after,\n.klev-switch:checked::after {\n  transform: translateX(16px) !important;\n}\n\n/* 2. \u0411\u0435\u0437\u043e\u043f\u0430\u0441\u043d\u0430\u044f \u043f\u043e\u0437\u0438\u0446\u0438\u044f \u0442\u043e\u0441\u0442-\u0443\u0432\u0435\u0434\u043e\u043c\u043b\u0435\u043d\u0438\u0439 \u043d\u0430\u0434 \u043d\u0438\u0436\u043d\u0438\u043c \u0434\u043e\u043a\u043e\u043c (bottom: 84px) */\n.toast-container,\n#toastContainer {\n  bottom: calc(84px + env(safe-area-inset-bottom, 0px)) !important;\n  max-width: min(420px, 92vw) !important;\n  z-index: 2200 !important;\n}\n\n/* 3. \u0416\u0438\u0432\u043e\u0439 \u0441\u043e\u043d\u0430\u0440 \u043d\u0430 \u0433\u043b\u0430\u0432\u043d\u043e\u043c \u044d\u043a\u0440\u0430\u043d\u0435 \u043f\u0440\u043e\u0433\u043d\u043e\u0437\u0430 (#bentoHeroSonarStage) */\n.bento-hero-sonar-stage {\n  position: relative;\n  width: 228px;\n  height: 228px;\n  margin: 4px auto 8px;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  flex-shrink: 0;\n}\n.bento-hero-sonar-canvas {\n  width: 228px;\n  height: 228px;\n  display: block;\n}\n.bento-hero-sonar-center-pct {\n  position: absolute;\n  inset: 0;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  pointer-events: none;\n  font-weight: 900;\n  font-size: 32px;\n  letter-spacing: -0.03em;\n  color: var(--text, #f8fafc);\n  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);\n}\n[data-theme=\"light\"] .bento-hero-sonar-center-pct {\n  color: #0f172a;\n  text-shadow: 0 1px 4px rgba(255, 255, 255, 0.85);\n}\n[data-theme=\"contrast\"] .bento-hero-sonar-center-pct {\n  color: #ffffff;\n  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.9);\n}\n\n/* \u0423\u0442\u0440\u0435\u043d\u043d\u0438\u0439 \u0438 \u0432\u0435\u0447\u0435\u0440\u043d\u0438\u0439 \u043f\u0438\u043a\u0438 \u043f\u043e\u0434 \u0436\u0438\u0432\u044b\u043c \u0441\u043e\u043d\u0430\u0440\u043e\u043c */\n.bento-hero-peaks-duo {\n  display: grid;\n  grid-template-columns: repeat(2, minmax(0, 1fr));\n  gap: 8px;\n  width: 100%;\n  margin-top: 6px;\n}\n.bento-hero-peak-pill {\n  padding: 8px 10px;\n  border-radius: 14px;\n  background: var(--panel, rgba(15, 23, 42, 0.72));\n  border: 1px solid var(--border, rgba(56, 189, 248, 0.25));\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n\n/* 4. \u0412\u043d\u0443\u0442\u0440\u0435\u043d\u043d\u0438\u0435 4 \u0432\u043a\u043b\u0430\u0434\u043a\u0438 \u044d\u043a\u0440\u0430\u043d\u0430 \u00ab\u041f\u0440\u043e\u0433\u043d\u043e\u0437\u00bb (\u041e\u0431\u0437\u043e\u0440 | \u0421\u043d\u0430\u0441\u0442\u0438 | 10 \u0434\u043d\u0435\u0439 | \u041f\u043e\u0433\u043e\u0434\u0430) */\n.klev-fc-subtabs-bar {\n  display: grid;\n  grid-template-columns: repeat(4, minmax(0, 1fr));\n  gap: 4px;\n  padding: 4px;\n  border-radius: 14px;\n  background: var(--panel, rgba(15, 23, 42, 0.78));\n  border: 1px solid var(--border, rgba(56, 189, 248, 0.24));\n  margin: 8px 0 10px;\n}\n.klev-fc-subtab-btn {\n  appearance: none;\n  border: 1px solid transparent;\n  background: transparent;\n  color: var(--muted, #94a3b8);\n  font-family: inherit;\n  font-size: 12px;\n  font-weight: 800;\n  min-height: 34px;\n  padding: 4px 2px;\n  border-radius: 10px;\n  cursor: pointer;\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  transition: all 0.2s cubic-bezier(0.22, 1, 0.36, 1);\n}\n.klev-fc-subtab-btn.active {\n  background: var(--card, rgba(30, 41, 59, 0.92));\n  color: var(--text, #f8fafc);\n  border-color: var(--accent, #38bdf8);\n  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.22);\n}\n\n/* \u041d\u0430 \u0434\u0435\u0441\u043a\u0442\u043e\u043f\u0435 (html[data-desktop-web=\"1\"]) 4 \u043f\u043e\u0434\u0432\u043a\u043b\u0430\u0434\u043a\u0438 \u0441\u043a\u0440\u044b\u0442\u044b, \u0432\u0441\u0435 \u0431\u043b\u043e\u043a\u0438 \u043f\u0440\u043e\u0433\u043d\u043e\u0437\u0430 \u0432\u0438\u0434\u043d\u044b \u043e\u0434\u043d\u043e\u0432\u0440\u0435\u043c\u0435\u043d\u043d\u043e */\nhtml[data-desktop-web=\"1\"] .klev-fc-subtabs-bar,\nhtml[data-desktop-web=\"1\"] .klev-mobile-only-loc-bar {\n  display: none !important;\n}\n\n/* \u041d\u0430 \u043c\u043e\u0431\u0438\u043b\u044c\u043d\u044b\u0445, \u043f\u043b\u0430\u043d\u0448\u0435\u0442\u0430\u0445 \u0438 \u0440\u0430\u0441\u043a\u043b\u0430\u0434\u0443\u0448\u043a\u0430\u0445 (html:not([data-desktop-web=\"1\"])) \u2014 \u0447\u0438\u0441\u0442\u0430\u044f \u0448\u0430\u043f\u043a\u0430 \u0438 \u0444\u0438\u043b\u044c\u0442\u0440\u0430\u0446\u0438\u044f \u043f\u043e 4 \u0432\u043a\u043b\u0430\u0434\u043a\u0430\u043c */\nhtml:not([data-desktop-web=\"1\"]):not([data-admin-contour=\"1\"]) #topSectionNavBar {\n  display: none !important;\n}\nhtml:not([data-desktop-web=\"1\"]) #secForecast[data-fc-subtab=\"overview\"] #fcTackleControlsCard,\nhtml:not([data-desktop-web=\"1\"]) #secForecast[data-fc-subtab=\"overview\"] .bento-tactical-advice-wrap,\nhtml:not([data-desktop-web=\"1\"]) #secForecast[data-fc-subtab=\"overview\"] #fcWeekBox,\nhtml:not([data-desktop-web=\"1\"]) #secForecast[data-fc-subtab=\"overview\"] .bento-bottom-duo {\n  display: none !important;\n}\nhtml:not([data-desktop-web=\"1\"]) #secForecast[data-fc-subtab=\"tackle\"] #bentoWaveChartCard,\nhtml:not([data-desktop-web=\"1\"]) #secForecast[data-fc-subtab=\"tackle\"] #fcHourlyBox,\nhtml:not([data-desktop-web=\"1\"]) #secForecast[data-fc-subtab=\"tackle\"] #fcWeekBox,\nhtml:not([data-desktop-web=\"1\"]) #secForecast[data-fc-subtab=\"tackle\"] .bento-bottom-duo {\n  display: none !important;\n}\nhtml:not([data-desktop-web=\"1\"]) #secForecast[data-fc-subtab=\"days10\"] #bentoWaveChartCard,\nhtml:not([data-desktop-web=\"1\"]) #secForecast[data-fc-subtab=\"days10\"] #fcTackleControlsCard,\nhtml:not([data-desktop-web=\"1\"]) #secForecast[data-fc-subtab=\"days10\"] .bento-tactical-advice-wrap,\nhtml:not([data-desktop-web=\"1\"]) #secForecast[data-fc-subtab=\"days10\"] .bento-bottom-duo {\n  display: none !important;\n}\nhtml:not([data-desktop-web=\"1\"]) #secForecast[data-fc-subtab=\"weather\"] #bentoWaveChartCard,\nhtml:not([data-desktop-web=\"1\"]) #secForecast[data-fc-subtab=\"weather\"] #fcHourlyBox,\nhtml:not([data-desktop-web=\"1\"]) #secForecast[data-fc-subtab=\"weather\"] #fcTackleControlsCard,\nhtml:not([data-desktop-web=\"1\"]) #secForecast[data-fc-subtab=\"weather\"] .bento-tactical-advice-wrap,\nhtml:not([data-desktop-web=\"1\"]) #secForecast[data-fc-subtab=\"weather\"] #fcWeekBox {\n  display: none !important;\n}\n\n/* 5. \u041d\u0438\u0436\u043d\u0438\u0439 \u0434\u043e\u043a \u0438\u0437 4 \u0440\u0430\u0437\u0434\u0435\u043b\u043e\u0432 \u043d\u0430 \u043c\u043e\u0431\u0438\u043b\u044c\u043d\u044b\u0445/\u043f\u043b\u0430\u043d\u0448\u0435\u0442\u0430\u0445 (\u041f\u0440\u043e\u0433\u043d\u043e\u0437 | \u041a\u0430\u0440\u0442\u0430 | \u0416\u0443\u0440\u043d\u0430\u043b | \u041c\u0435\u043d\u044e) */\nhtml:not([data-desktop-web=\"1\"]) .bottom-nav #navCircleChatsHubBtn,\nhtml:not([data-desktop-web=\"1\"]) .bottom-nav #bottomQuickSosBtn {\n  display: none !important;\n}\nhtml:not([data-desktop-web=\"1\"]) .bottom-nav-inner {\n  display: grid !important;\n  grid-template-columns: repeat(4, minmax(0, 1fr)) !important;\n  height: 64px !important;\n  min-height: 64px !important;\n  align-items: center !important;\n}\nhtml[data-desktop-web=\"1\"] #bottomNavMenuTriggerBtn {\n  display: none !important;\n}\n\n/* 6. \u041a\u043e\u043c\u043f\u0430\u043a\u0442\u043d\u043e\u0435 \u0432\u0441\u043f\u043b\u044b\u0432\u0430\u044e\u0449\u0435\u0435 \u043e\u043a\u043d\u043e \u00ab\u041c\u0435\u043d\u044e\u00bb (#klevCompactMenuBackdrop \u2014 \u041d\u0415 \u043f\u0435\u0440\u0435\u043a\u0440\u044b\u0432\u0430\u0435\u0442 \u0432\u0435\u0441\u044c \u044d\u043a\u0440\u0430\u043d, \u0431\u0435\u0437 \u0434\u0443\u0431\u043b\u0435\u0439) */\n#klevCompactMenuBackdrop {\n  position: fixed;\n  inset: 0;\n  z-index: 1950;\n  background: rgba(2, 6, 23, 0.36);\n  backdrop-filter: blur(4px);\n  -webkit-backdrop-filter: blur(4px);\n  display: none;\n  align-items: flex-end;\n  justify-content: center;\n  padding: 12px 12px calc(76px + env(safe-area-inset-bottom, 0px));\n}\n#klevCompactMenuBackdrop.open {\n  display: flex;\n}\n.klev-compact-menu-sheet {\n  width: 100%;\n  max-width: 386px;\n  border-radius: 22px;\n  padding: 13px 14px;\n  background: var(--panel, rgba(15, 23, 42, 0.92));\n  border: 1px solid var(--border, rgba(56, 189, 248, 0.34));\n  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.16);\n  backdrop-filter: blur(18px);\n  -webkit-backdrop-filter: blur(18px);\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n  animation: klevMenuPopUp 0.22s cubic-bezier(0.22, 1, 0.36, 1);\n}\n@keyframes klevMenuPopUp {\n  from { opacity: 0; transform: translateY(16px) scale(0.97); }\n  to { opacity: 1; transform: translateY(0) scale(1); }\n}\n.klev-compact-menu-grid5 {\n  display: grid;\n  grid-template-columns: repeat(5, minmax(0, 1fr));\n  gap: 6px;\n}\n.klev-compact-menu-item {\n  appearance: none;\n  background: var(--card, rgba(30, 41, 59, 0.75));\n  border: 1px solid var(--border, rgba(56, 189, 248, 0.24));\n  border-radius: 14px;\n  padding: 8px 3px 7px;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  justify-content: center;\n  gap: 5px;\n  color: var(--text, #f8fafc);\n  font-family: inherit;\n  font-size: 10.5px;\n  font-weight: 800;\n  cursor: pointer;\n  transition: transform 0.16s ease, border-color 0.16s ease, background 0.16s ease;\n}\n.klev-compact-menu-item:active,\n.klev-compact-menu-item.active {\n  transform: scale(0.96);\n  border-color: var(--accent, #38bdf8);\n}\n.klev-compact-menu-ico {\n  width: 34px;\n  height: 34px;\n  border-radius: 11px;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  background: rgba(56, 189, 248, 0.12);\n  color: var(--accent, #38bdf8);\n}\n.klev-compact-menu-ico svg {\n  width: 20px;\n  height: 20px;\n}\n\n/* \u0413\u0438\u0431\u0440\u0438\u0434\u043d\u044b\u0439 \u0437\u0430\u0449\u0438\u0449\u0451\u043d\u043d\u044b\u0439 \u043f\u043e\u043b\u0437\u0443\u043d\u043e\u043a SOS (\u0441\u0432\u0430\u0439\u043f \u0432\u043f\u0440\u0430\u0432\u043e \u0418\u041b\u0418 \u0443\u0434\u0435\u0440\u0436\u0430\u043d\u0438\u0435 2 \u0441\u0435\u043a) */\n.klev-hybrid-sos-track {\n  position: relative;\n  height: 46px;\n  border-radius: 999px;\n  background: linear-gradient(90deg, rgba(127, 29, 29, 0.72), rgba(220, 38, 38, 0.28));\n  border: 1.5px solid rgba(239, 68, 68, 0.58);\n  display: flex;\n  align-items: center;\n  padding: 3px;\n  overflow: hidden;\n  user-select: none;\n  -webkit-user-select: none;\n  touch-action: pan-y;\n}\n.klev-hybrid-sos-fill {\n  position: absolute;\n  left: 0;\n  top: 0;\n  bottom: 0;\n  width: 0%;\n  background: linear-gradient(90deg, rgba(239, 68, 68, 0.65), rgba(220, 38, 38, 0.85));\n  pointer-events: none;\n  transition: width 0.08s linear;\n}\n.klev-hybrid-sos-knob {\n  position: relative;\n  z-index: 2;\n  width: 38px;\n  height: 38px;\n  border-radius: 50%;\n  background: linear-gradient(135deg, #ef4444, #b91c1c);\n  border: 1.5px solid #fca5a5;\n  color: #ffffff;\n  font-weight: 900;\n  font-size: 11px;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  box-shadow: 0 3px 10px rgba(220, 38, 38, 0.55);\n  cursor: grab;\n  flex-shrink: 0;\n}\n.klev-hybrid-sos-label {\n  position: absolute;\n  inset: 0;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  padding-left: 34px;\n  font-size: 11.5px;\n  font-weight: 800;\n  color: #fecaca;\n  pointer-events: none;\n  text-align: center;\n}\n\n/* 7. \u041a\u043e\u043c\u043f\u0430\u043a\u0442\u043d\u0430\u044f \u043e\u0434\u043d\u043e\u0441\u0442\u0440\u043e\u0447\u043d\u0430\u044f \u043b\u0435\u043d\u0442\u0430 6 \u043f\u043b\u0430\u0448\u0435\u043a \u0432\u043d\u0438\u0437\u0443 \u043a\u0430\u0440\u0442\u044b (#arcCompactPillsStrip) */\n.klev-arc-single-pills-strip {\n  display: flex;\n  align-items: center;\n  gap: 7px;\n  overflow-x: auto;\n  padding: 4px 2px 6px;\n  scrollbar-width: none;\n  -ms-overflow-style: none;\n}\n.klev-arc-single-pills-strip::-webkit-scrollbar {\n  display: none;\n}\n.klev-arc-single-pill {\n  appearance: none;\n  height: 36px;\n  padding: 0 12px;\n  border-radius: 999px;\n  background: var(--panel, rgba(15, 23, 42, 0.86));\n  border: 1px solid var(--border, rgba(56, 189, 248, 0.32));\n  color: var(--text, #f8fafc);\n  font-family: inherit;\n  font-size: 12px;\n  font-weight: 800;\n  white-space: nowrap;\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  cursor: pointer;\n  flex-shrink: 0;\n  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.14);\n  backdrop-filter: blur(14px);\n  -webkit-backdrop-filter: blur(14px);\n}\n.klev-arc-single-pill.active {\n  border-color: var(--accent, #38bdf8);\n  color: var(--accent, #38bdf8);\n}\n\n/* 8. \u0413\u043e\u0440\u0438\u0437\u043e\u043d\u0442\u0430\u043b\u044c\u043d\u044b\u0439 \u0440\u0435\u0436\u0438\u043c (Landscape) \u0434\u043b\u044f \u043f\u043b\u0430\u043d\u0448\u0435\u0442\u043e\u0432, \u0431\u043e\u043b\u044c\u0448\u0438\u0445 \u0441\u043c\u0430\u0440\u0442\u0444\u043e\u043d\u043e\u0432 \u0438 \u0441\u043a\u043b\u0430\u0434\u043d\u044b\u0445 \u044d\u043a\u0440\u0430\u043d\u043e\u0432 (Flip / Fold) */\n@media (orientation: landscape) and (max-width: 1180px) {\n  html:not([data-desktop-web=\"1\"]) #secForecast .bento-dashboard-wrap {\n    display: grid !important;\n    grid-template-columns: minmax(275px, 340px) minmax(0, 1fr) !important;\n    gap: 12px !important;\n    align-items: start !important;\n  }\n  html:not([data-desktop-web=\"1\"]) #secForecast .bento-top-species-strip,\n  html:not([data-desktop-web=\"1\"]) #secForecast .klev-fc-subtabs-bar {\n    grid-column: 1 / -1 !important;\n  }\n  html:not([data-desktop-web=\"1\"]) #secForecast #bentoSwipeHeroCard {\n    grid-column: 1 / 2 !important;\n    position: sticky !important;\n    top: 64px !important;\n    margin-bottom: 0 !important;\n  }\n  html:not([data-desktop-web=\"1\"]) #secForecast #bentoWaveChartCard,\n  html:not([data-desktop-web=\"1\"]) #secForecast #fcTackleControlsCard,\n  html:not([data-desktop-web=\"1\"]) #secForecast .bento-tactical-advice-wrap,\n  html:not([data-desktop-web=\"1\"]) #secForecast .bento-bottom-duo {\n    grid-column: 2 / 3 !important;\n  }\n  html:not([data-desktop-web=\"1\"]) .bento-hero-sonar-stage,\n  html:not([data-desktop-web=\"1\"]) .bento-hero-sonar-canvas {\n    width: 196px !important;\n    height: 196px !important;\n  }\n}\n\n/* 9. \u0417\u0430\u0434\u043d\u0438\u0439 / \u0412\u043d\u0435\u0448\u043d\u0438\u0439 \u043c\u0438\u043d\u0438-\u044d\u043a\u0440\u0430\u043d (Xiaomi 18 Pro Max Rear Screen & Flip Cover Screen: <= 340x360 \u0438\u043b\u0438 data-rear-screen=\"1\") */\n#klevRearScreenHud {\n  display: none;\n  position: fixed;\n  inset: 0;\n  z-index: 2600;\n  background: var(--bg, #07111f);\n  background-image: var(--bg-grad);\n  color: var(--text, #f8fafc);\n  padding: 10px;\n  flex-direction: column;\n  align-items: center;\n  justify-content: space-between;\n  text-align: center;\n  overflow: hidden;\n}\nhtml[data-rear-screen=\"1\"] #klevRearScreenHud {\n  display: flex !important;\n}\n@media (max-width: 340px) and (max-height: 360px) {\n  #klevRearScreenHud {\n    display: flex !important;\n  }\n}\n" + '\n  </style>');
  }

  // 6.9: Вставка спрайта 26 векторных SVG-иконок
  if (!idx.includes('id="klevRedesignSvgSprite"')) {
    idx = idx.replace('<body', "  <!-- \u0421\u041f\u0420\u0410\u0419\u0422 26 \u0412\u0415\u041a\u0422\u041e\u0420\u041d\u042b\u0425 \u0418\u041a\u041e\u041d\u041e\u041a \u041a\u041b\u0401\u0412 \u041f\u0420\u041e 2.0 (v2.9.1 r241 Tactile Glassmorphism: 9 \u043c\u0435\u043d\u044e + 17 \u043a\u0430\u0440\u0442\u0430) -->\n  <svg id=\"klevRedesignSvgSprite\" xmlns=\"http://www.w3.org/2000/svg\" style=\"display:none\" aria-hidden=\"true\">\n    <!-- 9 \u0418\u041a\u041e\u041d\u041e\u041a \u041c\u0415\u041d\u042e + \u0418\u041a\u041e\u041d\u041a\u0410 \u0421\u0415\u0422\u041a\u0418 \u041c\u0415\u041d\u042e -->\n    <symbol id=\"icon-map\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n      <polygon points=\"3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21 3 6\"/>\n      <line x1=\"9\" y1=\"3\" x2=\"9\" y2=\"18\"/>\n      <line x1=\"15\" y1=\"6\" x2=\"15\" y2=\"21\"/>\n    </symbol>\n    <symbol id=\"icon-weather\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n      <path d=\"M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z\"/>\n      <path d=\"M12 3v1.5M5.6 5.6l1.1 1.1M3 12h1.5\"/>\n    </symbol>\n    <symbol id=\"icon-forecast\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n      <path d=\"M4 20C5 11 11 5 20 4\"/>\n      <path d=\"M20 4v7c0 1.7-1.3 3-3 3s-3-1.3-3-3\"/>\n      <circle cx=\"14\" cy=\"16\" r=\"2.2\"/>\n    </symbol>\n    <symbol id=\"icon-chats\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n      <path d=\"M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z\"/>\n    </symbol>\n    <symbol id=\"icon-sos\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n      <circle cx=\"12\" cy=\"12\" r=\"9\"/>\n      <path d=\"M8.5 10.5c-.8-.6-2-.2-2 .7 0 1.3 2.5.9 2.5 2.3 0 .9-1.2 1.3-2 .7\"/>\n      <circle cx=\"12\" cy=\"12\" r=\"1.7\"/>\n      <path d=\"M17.5 10.5c-.8-.6-2-.2-2 .7 0 1.3 2.5.9 2.5 2.3 0 .9-1.2 1.3-2 .7\"/>\n    </symbol>\n    <symbol id=\"icon-journal\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n      <rect x=\"5\" y=\"3\" width=\"14\" height=\"18\" rx=\"2.5\"/>\n      <line x1=\"9\" y1=\"8\" x2=\"15\" y2=\"8\"/>\n      <line x1=\"9\" y1=\"12\" x2=\"15\" y2=\"12\"/>\n      <line x1=\"9\" y1=\"16\" x2=\"13\" y2=\"16\"/>\n      <line x1=\"3\" y1=\"7\" x2=\"5\" y2=\"7\"/>\n      <line x1=\"3\" y1=\"12\" x2=\"5\" y2=\"12\"/>\n      <line x1=\"3\" y1=\"17\" x2=\"5\" y2=\"17\"/>\n    </symbol>\n    <symbol id=\"icon-fish\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n      <path d=\"M3 12s4-6 10.5-6c4 0 6.8 2.4 8.5 6-1.7 3.6-4.5 6-8.5 6C7 18 3 12 3 12Z\"/>\n      <path d=\"M3 12 1.2 8.8M3 12l-1.8 3.2\"/>\n      <circle cx=\"16.5\" cy=\"10.8\" r=\"1\"/>\n    </symbol>\n    <symbol id=\"icon-calendar\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n      <rect x=\"3\" y=\"5\" width=\"18\" height=\"16\" rx=\"2.5\"/>\n      <line x1=\"3\" y1=\"10\" x2=\"21\" y2=\"10\"/>\n      <line x1=\"8\" y1=\"3\" x2=\"8\" y2=\"6.5\"/>\n      <line x1=\"16\" y1=\"3\" x2=\"16\" y2=\"6.5\"/>\n      <circle cx=\"8.5\" cy=\"14.5\" r=\"1\"/>\n      <circle cx=\"12\" cy=\"14.5\" r=\"1\"/>\n      <circle cx=\"15.5\" cy=\"14.5\" r=\"1\"/>\n    </symbol>\n    <symbol id=\"icon-settings\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n      <circle cx=\"12\" cy=\"12\" r=\"3\"/>\n      <path d=\"M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.77 1.05 1.41 1.19H21a2 2 0 1 1 0 4h-.09c-.64.14-1.15.59-1.51 1.21z\"/>\n    </symbol>\n    <symbol id=\"icon-menu-grid\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n      <rect x=\"4\" y=\"4\" width=\"6.5\" height=\"6.5\" rx=\"1.8\"/>\n      <rect x=\"13.5\" y=\"4\" width=\"6.5\" height=\"6.5\" rx=\"1.8\"/>\n      <rect x=\"4\" y=\"13.5\" width=\"6.5\" height=\"6.5\" rx=\"1.8\"/>\n      <rect x=\"13.5\" y=\"13.5\" width=\"6.5\" height=\"6.5\" rx=\"1.8\"/>\n    </symbol>\n\n    <!-- 17 \u0418\u041a\u041e\u041d\u041e\u041a \u041a\u0410\u0420\u0422\u042b \u0418 \u0422\u0420\u0410\u041d\u0421\u041f\u041e\u0420\u0422\u0410 -->\n    <symbol id=\"map-gps\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n      <circle cx=\"12\" cy=\"12\" r=\"7\"/>\n      <circle cx=\"12\" cy=\"12\" r=\"2.2\"/>\n      <line x1=\"12\" y1=\"2\" x2=\"12\" y2=\"5\"/>\n      <line x1=\"12\" y1=\"19\" x2=\"12\" y2=\"22\"/>\n      <line x1=\"2\" y1=\"12\" x2=\"5\" y2=\"12\"/>\n      <line x1=\"19\" y1=\"12\" x2=\"22\" y2=\"12\"/>\n    </symbol>\n    <symbol id=\"map-compass\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n      <circle cx=\"12\" cy=\"12\" r=\"9\"/>\n      <polygon points=\"15.8 8.2 13.5 13.5 8.2 15.8 10.5 10.5 15.8 8.2\"/>\n    </symbol>\n    <symbol id=\"map-pins\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n      <path d=\"M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10Z\"/>\n      <line x1=\"12\" y1=\"8.5\" x2=\"12\" y2=\"13.5\"/>\n      <line x1=\"9.5\" y1=\"11\" x2=\"14.5\" y2=\"11\"/>\n    </symbol>\n    <symbol id=\"map-layers\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n      <polygon points=\"12 3 3 8 12 13 21 8 12 3\"/>\n      <polyline points=\"3 13 12 18 21 13\"/>\n      <polyline points=\"3 17.5 12 22.5 21 17.5\"/>\n    </symbol>\n    <symbol id=\"map-search\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n      <circle cx=\"11\" cy=\"11\" r=\"7\"/>\n      <line x1=\"16.2\" y1=\"16.2\" x2=\"21\" y2=\"21\"/>\n    </symbol>\n    <symbol id=\"point-slip\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n      <path d=\"M3 17l18 3\"/>\n      <path d=\"M6 12h11l3 4H8l-2-4Z\"/>\n      <path d=\"M9 12l2-3h4l1 3\"/>\n    </symbol>\n    <symbol id=\"point-snag\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n      <path d=\"M3 18c2-1.2 4-1.2 6 0s4 1.2 6 0 4-1.2 6 0\"/>\n      <path d=\"M11 18V7l-4-3M11 12l5-4M14 10l3 2\"/>\n    </symbol>\n    <symbol id=\"point-camp\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n      <polygon points=\"12 4 3 19 21 19 12 4\"/>\n      <polyline points=\"9.5 19 12 13.5 14.5 19\"/>\n    </symbol>\n    <symbol id=\"point-danger\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n      <polygon points=\"12 3.5 2.8 19.5 21.2 19.5 12 3.5\"/>\n      <line x1=\"12\" y1=\"9\" x2=\"12\" y2=\"14\"/>\n      <circle cx=\"12\" cy=\"16.8\" r=\"0.8\"/>\n    </symbol>\n    <symbol id=\"point-spot\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n      <path d=\"M12 4v11a3.5 3.5 0 0 1-7 0v-1\"/>\n      <polyline points=\"5 14 5 11.5 7.5 13\"/>\n      <circle cx=\"12\" cy=\"4\" r=\"1.5\"/>\n      <path d=\"M15 9s2-1.5 4.5 0c-1 1.5-2.5 2-4.5 0Z\"/>\n    </symbol>\n    <symbol id=\"point-shop\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n      <path d=\"M6 8h12l-1 12H7L6 8Z\"/>\n      <path d=\"M9 8V6a3 3 0 0 1 6 0v2\"/>\n    </symbol>\n    <symbol id=\"map-weather\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n      <path d=\"M14 14.76V5.5a2.5 2.5 0 0 0-5 0v9.26a4.5 4.5 0 1 0 5 0Z\"/>\n      <line x1=\"11.5\" y1=\"8\" x2=\"11.5\" y2=\"16\"/>\n    </symbol>\n    <symbol id=\"transport-car\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n      <path d=\"M5 16l1.5-5.5A2 2 0 0 1 8.4 9h7.2a2 2 0 0 1 1.9 1.5L19 16\"/>\n      <rect x=\"3\" y=\"15\" width=\"18\" height=\"4\" rx=\"1.5\"/>\n      <circle cx=\"7\" cy=\"19\" r=\"1.8\"/>\n      <circle cx=\"17\" cy=\"19\" r=\"1.8\"/>\n    </symbol>\n    <symbol id=\"transport-snowmobile\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n      <path d=\"M4 15h11l3-4-4-2-3 2H6l-2 4Z\"/>\n      <path d=\"M14 9l-2-3H9\"/>\n      <rect x=\"3\" y=\"17\" width=\"11\" height=\"2.5\" rx=\"1.2\"/>\n      <path d=\"M15 19.5h6l1.5-1.5\"/>\n    </symbol>\n    <symbol id=\"transport-boat\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n      <path d=\"M3 14h18l-3 4H6l-3-4Z\"/>\n      <path d=\"M12 4v10M12 5l6 6h-6\"/>\n    </symbol>\n    <symbol id=\"transport-bicycle\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n      <circle cx=\"6.5\" cy=\"17.5\" r=\"3.2\"/>\n      <circle cx=\"17.5\" cy=\"17.5\" r=\"3.2\"/>\n      <path d=\"M6.5 17.5 10 11h5l2.5 6.5M10 11l2 6.5h-5.5\"/>\n    </symbol>\n    <symbol id=\"transport-walk\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n      <circle cx=\"12\" cy=\"4.5\" r=\"1.8\"/>\n      <path d=\"M10 9.5 12 8l3 2.5 1.8 3M12 8l-1 5.5 3.5 3 1 4.5M11 13.5 8 21\"/>\n    </symbol>\n  </svg>" + '\n<body');
  }

  // 6.10: Кнопка «Меню» (#bottomNavMenuTriggerBtn) в нижнем доке (4 кнопки на мобильных: Прогноз, Карта, Журнал, Меню)
  if (!idx.includes('id="bottomNavMenuTriggerBtn"')) {
    const menuDockBtnHtml = `      <button type="button" class="nav-tab" id="bottomNavMenuTriggerBtn" aria-label="Меню и инструменты">
        <span class="dock-ico">
          <svg class="k-ico" width="16" height="16" viewBox="0 0 24 24" fill="none"><use href="#icon-menu-grid"/></svg>
        </span>
        <span>Меню</span>
      </button>\n    </div>\n  </nav>`;
    idx = idx.replace(/\s*<\/div>\s*<\/nav>/, '\n' + menuDockBtnHtml);
  }

  // 6.11: Компактное всплывающее окно «Меню» (#klevCompactMenuBackdrop) и Мини-экран (#klevRearScreenHud)
  if (!idx.includes('id="klevCompactMenuBackdrop"')) {
    idx = idx.replace('  <script id="klevBundledAppRuntime"', "  <!-- \u041a\u041e\u041c\u041f\u0410\u041a\u0422\u041d\u041e\u0415 \u0412\u0421\u041f\u041b\u042b\u0412\u0410\u042e\u0429\u0415\u0415 \u041c\u0415\u041d\u042e v2.9.1 (5 \u0443\u043d\u0438\u043a\u0430\u043b\u044c\u043d\u044b\u0445 \u0440\u0430\u0437\u0434\u0435\u043b\u043e\u0432 \u0431\u0435\u0437 \u0434\u0443\u0431\u043b\u0435\u0439 \u043d\u0438\u0436\u043d\u0435\u0433\u043e \u0434\u043e\u043a\u0430 + \u0433\u0438\u0431\u0440\u0438\u0434\u043d\u044b\u0439 \u043f\u043e\u043b\u0437\u0443\u043d\u043e\u043a SOS) -->\n  <div id=\"klevCompactMenuBackdrop\" aria-hidden=\"true\">\n    <div class=\"klev-compact-menu-sheet\" role=\"dialog\" aria-label=\"\u041c\u0435\u043d\u044e \u0438 \u0438\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u044b\">\n      <div style=\"display:flex;justify-content:space-between;align-items:center;gap:8px;\">\n        <span style=\"font-size:12px;font-weight:900;letter-spacing:0.04em;color:var(--accent);\">\u041c\u0415\u041d\u042e \u0418 \u0418\u041d\u0421\u0422\u0420\u0423\u041c\u0415\u041d\u0422\u042b</span>\n        <div style=\"display:flex;align-items:center;gap:6px;\">\n          <button type=\"button\" class=\"btn btn-sm\" id=\"klevMenuRearScreenToggleBtn\" style=\"min-height:26px;padding:2px 8px;font-size:10.5px;font-weight:800;\" title=\"\u0420\u0435\u0436\u0438\u043c \u0432\u043d\u0435\u0448\u043d\u0435\u0433\u043e \u043c\u0438\u043d\u0438-\u044d\u043a\u0440\u0430\u043d\u0430 (Xiaomi 18 Pro Max / Flip)\">\u041c\u0438\u043d\u0438-\u044d\u043a\u0440\u0430\u043d</button>\n          <button type=\"button\" class=\"btn btn-sm\" id=\"klevCompactMenuCloseBtn\" style=\"min-height:26px;padding:2px 8px;font-size:12px;font-weight:900;\" aria-label=\"\u0417\u0430\u043a\u0440\u044b\u0442\u044c \u043c\u0435\u043d\u044e\">&times;</button>\n        </div>\n      </div>\n\n      <!-- \u0411\u044b\u0441\u0442\u0440\u044b\u0435 \u043f\u0435\u0440\u0435\u043a\u043b\u044e\u0447\u0430\u0442\u0435\u043b\u0438 \u0422\u0435\u043c\u044b \u0438 \u0420\u0435\u0436\u0438\u043c\u0430 \u0441\u0442\u0435\u043a\u043b\u0430 -->\n      <div style=\"display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;\">\n        <button type=\"button\" class=\"btn btn-sm\" data-klev-menu-theme=\"dark\" style=\"min-height:30px;font-size:11px;font-weight:800;\">\u0422\u0451\u043c\u043d\u0430\u044f</button>\n        <button type=\"button\" class=\"btn btn-sm\" data-klev-menu-theme=\"light\" style=\"min-height:30px;font-size:11px;font-weight:800;\">\u0421\u0432\u0435\u0442\u043b\u0430\u044f</button>\n        <button type=\"button\" class=\"btn btn-sm\" data-klev-menu-theme=\"contrast\" style=\"min-height:30px;font-size:11px;font-weight:800;\">\u041a\u043e\u043d\u0442\u0440\u0430\u0441\u0442</button>\n      </div>\n      <div style=\"display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;\">\n        <button type=\"button\" class=\"btn btn-sm\" data-klev-menu-glass=\"1\" style=\"min-height:28px;font-size:11px;font-weight:800;\">\u0421\u0442\u0435\u043a\u043b\u043e (Glass)</button>\n        <button type=\"button\" class=\"btn btn-sm\" data-klev-menu-glass=\"0\" style=\"min-height:28px;font-size:11px;font-weight:800;\">\u041e\u0431\u044b\u0447\u043d\u044b\u0439 (Tactile)</button>\n      </div>\n\n      <!-- 5 \u0443\u043d\u0438\u043a\u0430\u043b\u044c\u043d\u044b\u0445 \u0440\u0430\u0437\u0434\u0435\u043b\u043e\u0432 (\u0431\u0435\u0437 \u0434\u0443\u0431\u043b\u0435\u0439 \u041a\u0430\u0440\u0442\u0430 / \u041f\u0440\u043e\u0433\u043d\u043e\u0437 / \u0416\u0443\u0440\u043d\u0430\u043b / \u0446\u0435\u043d\u0442\u0440\u0430\u043b\u044c\u043d\u043e\u0439 \u043a\u043d\u043e\u043f\u043a\u0438 SOS) -->\n      <div class=\"klev-compact-menu-grid5\">\n        <button type=\"button\" class=\"klev-compact-menu-item\" data-klev-menu-route=\"weather\">\n          <span class=\"klev-compact-menu-ico\"><svg viewBox=\"0 0 24 24\"><use href=\"#icon-weather\"/></svg></span>\n          <span>\u041f\u043e\u0433\u043e\u0434\u0430</span>\n        </button>\n        <button type=\"button\" class=\"klev-compact-menu-item\" data-klev-menu-route=\"chats\">\n          <span class=\"klev-compact-menu-ico\"><svg viewBox=\"0 0 24 24\"><use href=\"#icon-chats\"/></svg></span>\n          <span>\u0427\u0430\u0442\u044b</span>\n        </button>\n        <button type=\"button\" class=\"klev-compact-menu-item\" data-klev-menu-route=\"fish\">\n          <span class=\"klev-compact-menu-ico\"><svg viewBox=\"0 0 24 24\"><use href=\"#icon-fish\"/></svg></span>\n          <span>\u0420\u044b\u0431\u044b</span>\n        </button>\n        <button type=\"button\" class=\"klev-compact-menu-item\" data-klev-menu-route=\"calendar\">\n          <span class=\"klev-compact-menu-ico\"><svg viewBox=\"0 0 24 24\"><use href=\"#icon-calendar\"/></svg></span>\n          <span>\u041a\u0430\u043b\u0435\u043d\u0434\u0430\u0440\u044c</span>\n        </button>\n        <button type=\"button\" class=\"klev-compact-menu-item\" data-klev-menu-action=\"settings\">\n          <span class=\"klev-compact-menu-ico\"><svg viewBox=\"0 0 24 24\"><use href=\"#icon-settings\"/></svg></span>\n          <span>\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438</span>\n        </button>\n      </div>\n\n      <!-- \u0413\u0438\u0431\u0440\u0438\u0434\u043d\u044b\u0439 \u0437\u0430\u0449\u0438\u0449\u0451\u043d\u043d\u044b\u0439 \u043f\u043e\u043b\u0437\u0443\u043d\u043e\u043a SOS (\u0441\u0432\u0430\u0439\u043f \u0432\u043f\u0440\u0430\u0432\u043e \u0418\u041b\u0418 \u0443\u0434\u0435\u0440\u0436\u0430\u043d\u0438\u0435 2 \u0441\u0435\u043a) -->\n      <div class=\"klev-hybrid-sos-track\" id=\"klevHybridSosTrack\" role=\"slider\" aria-label=\"\u042d\u043a\u0441\u0442\u0440\u0435\u043d\u043d\u044b\u0439 \u0441\u0438\u0433\u043d\u0430\u043b SOS: \u0441\u0432\u0430\u0439\u043f \u0432\u043f\u0440\u0430\u0432\u043e \u0438\u043b\u0438 \u0443\u0434\u0435\u0440\u0436\u0430\u043d\u0438\u0435 2 \u0441\u0435\u043a\u0443\u043d\u0434\u044b\" aria-valuemin=\"0\" aria-valuemax=\"100\" aria-valuenow=\"0\">\n        <div class=\"klev-hybrid-sos-fill\" id=\"klevHybridSosFill\"></div>\n        <div class=\"klev-hybrid-sos-knob\" id=\"klevHybridSosKnob\">SOS</div>\n        <div class=\"klev-hybrid-sos-label\" id=\"klevHybridSosLabel\">\u0421\u0432\u0430\u0439\u043f \u0432\u043f\u0440\u0430\u0432\u043e \u0438\u043b\u0438 2 \u0441\u0435\u043a \u0434\u043b\u044f SOS</div>\n      </div>\n    </div>\n  </div>\n\n  <!-- \u0420\u0415\u0416\u0418\u041c \u0417\u0410\u0414\u041d\u0415\u0413\u041e / \u0412\u041d\u0415\u0428\u041d\u0415\u0413\u041e \u041c\u0418\u041d\u0418-\u042d\u041a\u0420\u0410\u041d\u0410 (Xiaomi 18 Pro Max Rear Screen & Flip Cover Screen) -->\n  <div id=\"klevRearScreenHud\" aria-label=\"\u041c\u0438\u043d\u0438-\u044d\u043a\u0440\u0430\u043d \u041a\u043b\u0451\u0432 \u041f\u0420\u041e 2.0\">\n    <div style=\"width:100%;display:flex;justify-content:space-between;align-items:center;gap:6px;font-size:11px;font-weight:800;\">\n      <span id=\"klevRearLocText\" style=\"color:var(--accent);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;\">\u0412\u043e\u0434\u043e\u0451\u043c \u0420\u0424</span>\n      <button type=\"button\" class=\"btn btn-sm\" id=\"klevRearExitBtn\" style=\"min-height:22px;padding:1px 7px;font-size:10px;font-weight:800;\">\u041d\u0430 \u043e\u0441\u043d\u043e\u0432\u043d\u043e\u0439</button>\n    </div>\n    <div style=\"position:relative;width:138px;height:138px;display:flex;align-items:center;justify-content:center;margin:2px auto;\">\n      <canvas id=\"klevRearSonarCanvas\" width=\"276\" height=\"276\" style=\"width:138px;height:138px;display:block;\"></canvas>\n      <div id=\"klevRearPctText\" style=\"position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:900;pointer-events:none;\">78%</div>\n    </div>\n    <div style=\"width:100%;display:flex;flex-direction:column;gap:3px;\">\n      <div id=\"klevRearFishAndWin\" style=\"font-size:12px;font-weight:900;\">\u0429\u0443\u043a\u0430 \u2022 \u041f\u0438\u043a 07:00\u201310:00</div>\n      <div id=\"klevRearWaterIce\" style=\"font-size:10.5px;color:var(--muted);font-weight:800;\">\u0412\u043e\u0434\u0430 +0.4\u00b0C \u2022 \u041b\u0451\u0434 ~24 \u0441\u043c</div>\n    </div>\n    <div style=\"width:100%;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;\">\n      <button type=\"button\" class=\"btn btn-sm btn-accent\" id=\"klevRearNextFishBtn\" style=\"min-height:28px;font-size:10.5px;font-weight:800;\">\u0421\u043c\u0435\u043d\u0438\u0442\u044c \u0440\u044b\u0431\u0443</button>\n      <button type=\"button\" class=\"btn btn-sm\" id=\"klevRearQuickSosBtn\" style=\"min-height:28px;font-size:10.5px;font-weight:900;border-color:var(--bad);color:var(--bad);\">SOS \u043d\u0430 \u0432\u043e\u0434\u0435</button>\n    </div>\n  </div>" + '\n\n  <script id="klevBundledAppRuntime"');
  }

  idx = idx.replace(/"softwareVersion":\s*"[^"]+"/g, `"softwareVersion": "${V_FULL}"`);
  idx = idx.replace(/https:\/\/klevpro\.ru\/apk\/klev-pro-v[0-9.a-zA-Z_-]+\.apk/g, V_APK_URL);
  idx = idx.replace(/Система Клёв ПРО 2\.0 \(v2\.[0-9]+\.[0-9]+\)/g, `Система Клёв ПРО 2.0 (v${V_NUM})`);
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


function syncAndroidAssetsWww() {
  const wwwDir = path.join(ROOT, 'android/app/src/main/assets/www');
  if (!fs.existsSync(wwwDir)) return;
  for (const rel of ['index.html', 'kp-control-89.html', 'app-runtime.js', 'VERSION', 'version.json', 'policy-version.json', 'manifest.json', 'sw.js', 'robots.txt']) {
    const src = path.join(ROOT, rel);
    if (fs.existsSync(src)) {
      writeTextIfChanged(path.join('android/app/src/main/assets/www', rel), fs.readFileSync(src, 'utf8'));
    }
  }
  for (const sub of ['css/tokens.css', 'css/base.css', 'css/components.css', 'css/layout.css', 'apk/apk-version.json', 'js/app.bundle.js']) {
    const src = path.join(ROOT, sub);
    if (fs.existsSync(src)) {
      writeTextIfChanged(path.join('android/app/src/main/assets/www', sub), fs.readFileSync(src, 'utf8'));
    }
  }
}

cleanTrashFilesAndGitignore();
patchRobotsTxt();
patchWorker();
patchVersionAndAndroidFiles();
patchFrontendAndServiceWorker();
syncAndroidAssetsWww();

console.log(`[apply-fixes] Все исправления P1–P3 для версии ${V_DISPLAY} (код ${V_CODE}) успешно применены.`);
