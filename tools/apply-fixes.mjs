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
const V_NUM = String(VER.version || '2.9.2').trim();
const V_REV = String(VER.revision || 'r258').trim();
const V_BUILD = Number(VER.buildNumber || 258);
const V_CODE = Number(VER.versionCode || 293258);
const V_DISPLAY = String(VER.displayVersion || `v${V_NUM} ${V_REV}`).trim();
const V_FULL = String(VER.fullVersion || `${V_NUM}-${V_REV}`).trim();
const V_POLICY = String(VER.policyVersion || `2026.11.22-v${V_NUM}`).trim();
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

  // Синхронизируем bot/cloudflare-worker-bot.js с корневым cloudflare-worker-bot.js
  const rootWorkerRaw = readText('cloudflare-worker-bot.js');
  if (rootWorkerRaw) {
    writeTextIfChanged('bot/cloudflare-worker-bot.js', rootWorkerRaw);
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
 const cleanIp = String(ip || 'anon').trim().slice(0, 48);
 const normL = String(loginNorm || 'any').toLowerCase().slice(0, 64);
 const key = \`acct_\${cleanIp}_\${normL}\`;
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
 const key = \`acct_\${cleanIp}_\${normL}\`;
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
 const key = \`acct_\${cleanIp}_\${normL}\`;
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

  // 3.3: Регулярка шлюз тайлов с левой границей (^|\.)
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
      /const chunkKey = `AI_CHK_(?:\${authFid}_)?\${reqScanId}_\${idx}`;/,
      `const quotaOk = await consumeAiUserChunkQuota(env, aiAuth.fisherId, 1);
     if (!quotaOk) {
      return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json;charset=utf-8' } });
     }
     const chunkKey = \`AI_CHK_\${authFid}_\${reqScanId}_\${idx}\`;`
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
  writeTextIfChanged('bot/cloudflare-worker-bot.js', w);
}

// ============================================================================
// 4. P1 (3.4) & P2 (4.8): Синхронизация version.json, apk/apk-version.json, policy-version.json, manifest.json, build.gradle, MainActivity.java, build-android-apk.yml
// ============================================================================
function patchVersionAndAndroidFiles() {
  const wfRel = '.github/workflows/build-android-apk.yml';
  {
    let wf = readText(wfRel);
    if (wf) {
    if (!wf.includes('FORCE_JAVASCRIPT_ACTIONS_TO_NODE24')) {
      wf = wf.replace('permissions:', "env:\n  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: 'true'\n\npermissions:");
    }
    wf = wf.replace(/apk\/klev-pro-v2\.[0-9]+\.[0-9]+\.apk/g, `apk/${V_APK_FILE}`);
    wf = wf.replace(/apk\/klev-pro-admin-v2\.[0-9]+\.[0-9]+\.apk/g, `apk/${V_ADMIN_APK_FILE}`);
    wf = wf.replace(/versionName "2\.[0-9]+\.[0-9]+-r\d+"/g, `versionName "${V_FULL}"`);
    wf = wf.replace(/VER_CODE=\$\(\(293\d+ \+ RUN_NUM\)\)/g, `VER_CODE=$((${V_CODE} + RUN_NUM))`);
    wf = wf.replace(/chore\(release\): publish v2\.[0-9]+\.[0-9]+-r\d+ web & signed apks/g, `chore(release): publish v${V_FULL} web & signed apks`);
    writeTextIfChanged(wfRel, wf);
    }
  }
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
    if (!obj.subtitle || String(obj.subtitle).includes('Точечная защита')) {
      obj.subtitle = 'Стабильная работа ИИ-определителя рыбы по фото, импорт маршрутов в форматах GPX, KML и KMZ, обновлённые офлайн-карты и улучшенная контрастная тема.';
    }
    if (!obj.summary || String(obj.summary).includes('Синхронизированы блоки погоды')) {
      obj.summary = 'Повышена надёжность распознавания улова по фото с понятными подсказками, добавлен импорт пользовательских маршрутов, очищены квадраты офлайн-карт и улучшено оформление экранов.';
    }
    if (Array.isArray(obj.changelog)) {
      const noteItem = `Стабильная ветка v${V_NUM} (${V_REV}): при скачивании с сайта или обновлении внутри приложения ориентируйтесь на номер ревизии (${V_REV}).`;
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
    pol.summary = `Редакция ${V_DISPLAY}: сохранность пользовательских данных при очистке кэша, единый постоянный ID рыбака на всех устройствах по логину и паролю, расчёт гидрологии и льда по данным Росгидромета (meteoinfo.ru).`;
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
    gradle = gradle.replace(/versionCode\s+\d+/g, 'versionCode effVerCode').replace(/def effVerCode = \d+/g, `def effVerCode = ${V_CODE}`);
    gradle = gradle.replace(/versionName\s+"[^"]+"(?:\s*\/\/\s*versionName\s+"[^"]+")?/g, `versionName "${V_FULL}"`);
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
      `private boolean isTelegramUri(Uri uri) {`,
      `${ind4}if (uri == null) return false;`,
      `${ind4}String scheme = uri.getScheme() != null ? uri.getScheme().trim().toLowerCase(Locale.ROOT) : "";`,
      `${ind4}if ("tg".equals(scheme)) return true;`,
      `${ind4}if ("http".equals(scheme) || "https".equals(scheme)) {`,
      `${ind8}String host = uri.getHost() != null ? uri.getHost().trim().toLowerCase(Locale.ROOT) : "";`,
      `${ind8}return "t.me".equals(host) || "www.t.me".equals(host) || "telegram.me".equals(host) || "www.telegram.me".equals(host) || "telegram.dog".equals(host);`,
      `${ind4}}`,
      `${ind4}return false;`,
      `${ind}}`,
      ``,
      `${ind}private boolean isAllowedExternalUri(Uri uri) {`,
      `${ind4}if (uri == null) return false;`,
      `${ind4}if (isTelegramUri(uri)) return true;`,
      `${ind4}String scheme = uri.getScheme();`,
      `${ind4}if (scheme == null) return false;`,
      `${ind4}String s = scheme.trim().toLowerCase(Locale.ROOT);`,
      `${ind4}if (!"https".equals(s) && !"http".equals(s)) return false;`,
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
      `${ind8}if (isTelegramUri(uri)) {`,
      `${ind8}    Uri tgUri = uri;`,
      `${ind8}    String scheme = uri.getScheme() != null ? uri.getScheme().trim().toLowerCase(Locale.ROOT) : "";`,
      `${ind8}    if (!"tg".equals(scheme)) {`,
      `${ind8}        String tgPath = uri.getPath() != null ? uri.getPath().trim() : "";`,
      `${ind8}        if (tgPath.startsWith("/")) tgPath = tgPath.substring(1);`,
      `${ind8}        if (tgPath.toLowerCase(Locale.ROOT).startsWith("share")) {`,
      `${ind8}            Uri.Builder b = Uri.parse("tg://msg_url").buildUpon();`,
      `${ind8}            String uParam = uri.getQueryParameter("url");`,
      `${ind8}            String tParam = uri.getQueryParameter("text");`,
      `${ind8}            if (uParam != null) b.appendQueryParameter("url", uParam);`,
      `${ind8}            if (tParam != null) b.appendQueryParameter("text", tParam);`,
      `${ind8}            tgUri = b.build();`,
      `${ind8}        } else {`,
      `${ind8}            String domain = tgPath.contains("/") ? tgPath.substring(0, tgPath.indexOf('/')) : tgPath;`,
      `${ind8}            if (domain.isEmpty()) domain = "KlevProClubBot";`,
      `${ind8}            Uri.Builder b = Uri.parse("tg://resolve").buildUpon().appendQueryParameter("domain", domain);`,
      `${ind8}            String startParam = uri.getQueryParameter("start");`,
      `${ind8}            if (startParam != null && !startParam.isEmpty()) b.appendQueryParameter("start", startParam);`,
      `${ind8}            tgUri = b.build();`,
      `${ind8}        }`,
      `${ind8}    }`,
      `${ind8}    String[] tgPkgs = new String[]{"org.telegram.messenger", "org.telegram.messenger.web", "org.thunderdog.challegram", "org.telegram.plus"};`,
      `${ind8}    for (String pkg : tgPkgs) {`,
      `${ind8}        try {`,
      `${ind8}            Intent pkgIntent = new Intent(Intent.ACTION_VIEW, tgUri);`,
      `${ind8}            pkgIntent.setPackage(pkg);`,
      `${ind8}            pkgIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);`,
      `${ind8}            ctx.startActivity(pkgIntent);`,
      `${ind8}            return;`,
      `${ind8}        } catch (Exception ignored) {}`,
      `${ind8}    }`,
      `${ind8}    try {`,
      `${ind8}        Intent genericTgIntent = new Intent(Intent.ACTION_VIEW, tgUri);`,
      `${ind8}        genericTgIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);`,
      `${ind8}        ctx.startActivity(genericTgIntent);`,
      `${ind8}        return;`,
      `${ind8}    } catch (Exception ignored) {}`,
      `${ind8}}`,
      `${ind8}Intent intent = new Intent(Intent.ACTION_VIEW, uri);`,
      `${ind8}intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);`,
      `${ind8}ctx.startActivity(intent);`,
      `${ind4}} catch (Exception ignored) {}`,
      `${ind}}`
    ].join("\n");

    const oldMethodsRe = /(?:private boolean isTelegramUri[\s\S]*?)?(?:private boolean isAllowedExternalUri[\s\S]*?)?@JavascriptInterface\s+public void downloadApkUpdate\(String url\)\s*\{[\s\S]*?@JavascriptInterface\s+public void openExternalUrl\(String url\)\s*\{[\s\S]*?ctx\.startActivity\(intent\);\s*\} catch \(Exception ignored\) \{\}\s*\}/;
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
  if (!runtimeCode.includes('window.esc=')) {
    runtimeCode = runtimeCode.replace(
      /function ([A-Za-z0-9_$]+)\(e\)\{return null==e\?"":String\(e\)\.replace\(\/&\/g,"&amp;"\)\.replace\(\/<\/g,"&lt;"\)\.replace\(\/>\/g,"&gt;"\)\.replace\(\/"\/g,"&quot;"\)\.replace\(\/'\/g,"&#39;"\)\}/,
      'function $1(e){return null==e?"":String(e).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/\'/g,"&#39;")}const esc=$1;if("undefined"!=typeof window)window.esc=$1;'
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

  // 4) 3.3: Перевод клиента на прямую загрузку тайлов Яндекса, шлюз через воркер — только как резерв за флагом window.__KLEV_USE_TILE_PROXY_FALLBACK__
  runtimeCode = runtimeCode.replace(
    'if("unavailable"!==lc){const e=`https://klevprohbot.thorantony82.workers.dev/api/tile-proxy?url=${encodeURIComponent(a)}`',
    'if("unavailable"!==lc&&"undefined"!=typeof window&&!0===window.__KLEV_USE_TILE_PROXY_FALLBACK__){const e=`https://klevprohbot.thorantony82.workers.dev/api/tile-proxy?url=${encodeURIComponent(a)}`'
  );

  // 5) 4.6: Погода — астрономический расчёт восхода/заката для полярных широт (66.08°N), единый источник данных и «Нет данных» при isReal === false
  if (!runtimeCode.includes('function calcPolarSunTimes(')) {
    const polarSunFn = `function calcPolarSunTimes(dateStr,lat=66.08,lon=76.68){try{const s=String(dateStr||"").slice(0,10),dt=s?new Date(s+"T12:00:00Z"):new Date(),start=new Date(Date.UTC(dt.getUTCFullYear(),0,0)),doy=Math.floor((dt-start)/864e5),tz=Math.round(Number(lon||76.68)/15),g=2*Math.PI/365*(doy-1+.5),eq=229.18*(75e-6+.001868*Math.cos(g)-.032077*Math.sin(g)-.014615*Math.cos(2*g)-.040849*Math.sin(2*g)),decl=.006918-.399912*Math.cos(g)+.070257*Math.sin(g)-.006758*Math.cos(2*g)+.000907*Math.sin(2*g)-.002697*Math.cos(3*g)+.00148*Math.sin(3*g),latR=Math.max(-89.5,Math.min(89.5,Number(lat)||66.08))*Math.PI/180,zen=90.833*Math.PI/180,cosH=Math.cos(zen)/(Math.cos(latR)*Math.cos(decl))-Math.tan(latR)*Math.tan(decl);if(cosH>1)return{sunriseHr:12,sunsetHr:12,polarNight:!0,polarDay:!1};if(cosH<-1)return{sunriseHr:0,sunsetHr:24,polarNight:!1,polarDay:!0};const ha=180*Math.acos(cosH)/Math.PI,sr=((720-4*(Number(lon||76.68)+ha)-eq)/60+tz+24)%24,ss=((720-4*(Number(lon||76.68)-ha)-eq)/60+tz+24)%24;return{sunriseHr:Math.round(100*sr)/100,sunsetHr:Math.round(100*ss)/100,polarNight:!1,polarDay:!1}}catch(e){return{sunriseHr:8.8,sunsetHr:14.48,polarNight:!1,polarDay:!1}}}`;
    if (runtimeCode.includes('function Un(')) {
      runtimeCode = runtimeCode.replace('function Un(', polarSunFn + 'function Un(');
    } else {
      runtimeCode = runtimeCode.replace('(()=>{"use strict";', '(()=>{"use strict";' + polarSunFn);
    }
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
    writeTextIfChanged('js/app.bundle.js', runtimeCode.trim() + '\n');
    const extTag = `<script id="klevBundledAppRuntime" src="app-runtime.js?v=${V_FULL}"></script>`;
    if (inlineRuntimeRe.test(idx)) {
      idx = idx.replace(inlineRuntimeRe, extTag);
    } else if (externalRuntimeRe.test(idx)) {
      idx = idx.replace(externalRuntimeRe, extTag);
    }
  }

  // --- Патчим HTML-оболочку index.html ---

  // 6.1: Спокойная скорость вращения загрузочного сонара (0.52 вместо 1.8)
  idx = idx.replace(/var SONAR_SPEED_MULT = 1\.8;/g, 'var SONAR_SPEED_MULT = 0.52;');

  // 6.2: Вставка CSS редизайна v2.9.1 в index.html (идемпотентно)
  const v291CssMarker = 'КЛЁВ ПРО 2.0 • v2.9.1 (r245) TACTILE GLASSMORPHISM REDESIGN';
  if (!idx.includes(v291CssMarker)) {
    idx = idx.replace('  </style>', "\n/* ==========================================================================\n   \u041a\u041b\u0401\u0412 \u041f\u0420\u041e 2.0 \u2022 v2.9.1 (r245) TACTILE GLASSMORPHISM REDESIGN\n   \u041c\u043e\u0431\u0438\u043b\u044c\u043d\u0430\u044f, \u043f\u043b\u0430\u043d\u0448\u0435\u0442\u043d\u0430\u044f \u0438 \u0441\u043a\u043b\u0430\u0434\u043d\u0430\u044f (Flip/Fold) \u0432\u0435\u0440\u0441\u0438\u0438 \u043f\u043e \u044d\u0442\u0430\u043b\u043e\u043d\u0443 \u0412\u0438\u0434\u0435\u043e 1\n   \u0441 \u043f\u043e\u043b\u043d\u044b\u043c \u0441\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u0438\u0435\u043c \u0434\u0435\u0441\u043a\u0442\u043e\u043f\u043d\u043e\u0439 \u0432\u0435\u0431-\u0432\u0435\u0440\u0441\u0438\u0438 (html[data-desktop-web=\"1\"])\n   ========================================================================== */\n\n/* 1. \u041e\u0442\u043a\u043b\u044e\u0447\u0430\u0435\u043c \u0442\u044f\u0436\u0451\u043b\u0443\u044e GPU-\u043f\u0435\u0440\u0435\u0440\u0430\u0441\u0442\u0435\u0440\u0438\u0437\u0430\u0446\u0438\u044e \u043e\u0433\u0440\u043e\u043c\u043d\u044b\u0445 \u0441\u0435\u043a\u0446\u0438\u0439 (\u0443\u0441\u0442\u0440\u0430\u043d\u0435\u043d\u0438\u0435 \u0442\u043e\u0440\u043c\u043e\u0437\u043e\u0432 \u0438 \u0444\u0440\u0438\u0437\u043e\u0432 \u043f\u0440\u0438 \u043f\u0435\u0440\u0435\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u0438 \u0432\u043a\u043b\u0430\u0434\u043e\u043a) */\n.klev-sec-slide-right,\n.klev-sec-slide-left,\n.klev-sec-slide-fade {\n  animation: none !important;\n  transform: none !important;\n  will-change: auto !important;\n  opacity: 1 !important;\n}\n\n/* 2. \u041d\u0430 \u043c\u043e\u0431\u0438\u043b\u044c\u043d\u044b\u0445 \u0438 \u043f\u043b\u0430\u043d\u0448\u0435\u0442\u0430\u0445 \u0441\u043a\u0440\u044b\u0432\u0430\u0435\u043c \u0441\u0442\u0430\u0440\u0443\u044e \u0434\u0432\u0443\u0445\u044d\u0442\u0430\u0436\u043d\u0443\u044e \u0448\u0430\u043f\u043a\u0443 .app-header */\nhtml:not([data-desktop-web=\"1\"]):not([data-admin-contour=\"1\"]) .app-header {\n  display: none !important;\n}\n\nhtml:not([data-desktop-web=\"1\"]):not([data-admin-contour=\"1\"]) body {\n  padding-top: max(8px, env(safe-area-inset-top, 8px)) !important;\n  padding-bottom: calc(74px + env(safe-area-inset-bottom, 0px)) !important;\n}\n\n/* \u041d\u0430 \u0434\u0435\u0441\u043a\u0442\u043e\u043f\u0435 \u0441\u043a\u0440\u044b\u0432\u0430\u0435\u043c \u043c\u043e\u0431\u0438\u043b\u044c\u043d\u044b\u0435 \u0448\u0430\u043f\u043a\u0438 \u0432\u043b\u043e\u0436\u0435\u043d\u043d\u044b\u0445 \u044d\u043a\u0440\u0430\u043d\u043e\u0432 \u0438 \u043a\u043d\u043e\u043f\u043a\u0443 \u041c\u0435\u043d\u044e \u043d\u0438\u0436\u043d\u0435\u0433\u043e \u0434\u043e\u043a\u0430 */\nhtml[data-desktop-web=\"1\"] .klev-mobile-subscreen-bar,\nhtml[data-desktop-web=\"1\"] .klev-fc-subtabs-bar,\nhtml[data-desktop-web=\"1\"] #bottomNavMenuTriggerBtn,\nhtml[data-desktop-web=\"1\"] #klevCompactMenuBackdrop {\n  display: none !important;\n}\n\n/* 3. \u041f\u043e\u0441\u0442\u043e\u044f\u043d\u043d\u044b\u0439 \u043d\u0438\u0436\u043d\u0438\u0439 \u0434\u043e\u043a \u0438\u0437 4 \u0440\u0430\u0437\u0434\u0435\u043b\u043e\u0432 (\u041f\u0440\u043e\u0433\u043d\u043e\u0437, \u041a\u0430\u0440\u0442\u0430, \u0416\u0443\u0440\u043d\u0430\u043b, \u041c\u0435\u043d\u044e) \u0432\u044b\u0441\u043e\u0442\u043e\u0439 64px \u0441 \u043c\u043e\u043d\u043e\u0445\u0440\u043e\u043c\u043d\u044b\u043c\u0438 SVG-\u0438\u043a\u043e\u043d\u043a\u0430\u043c\u0438 UX_UI */\nhtml:not([data-desktop-web=\"1\"]):not([data-admin-contour=\"1\"]) .bottom-nav {\n  position: fixed !important;\n  left: 0 !important;\n  right: 0 !important;\n  bottom: 0 !important;\n  height: calc(64px + env(safe-area-inset-bottom, 0px)) !important;\n  padding: 0 8px env(safe-area-inset-bottom, 0px) !important;\n  background: rgba(15, 23, 42, 0.90) !important;\n  backdrop-filter: blur(16px) !important;\n  -webkit-backdrop-filter: blur(16px) !important;\n  border-top: 1px solid rgba(148, 163, 184, 0.18) !important;\n  border-radius: 0 !important;\n  z-index: 4600 !important;\n  transform: none !important;\n  opacity: 1 !important;\n  visibility: visible !important;\n  pointer-events: auto !important;\n  display: flex !important;\n  align-items: center !important;\n}\n\nhtml[data-theme=\"light\"]:not([data-desktop-web=\"1\"]):not([data-admin-contour=\"1\"]) .bottom-nav {\n  background: rgba(255, 255, 255, 0.92) !important;\n  border-top-color: rgba(15, 23, 42, 0.12) !important;\n}\n\nhtml[data-theme=\"contrast\"]:not([data-desktop-web=\"1\"]):not([data-admin-contour=\"1\"]) .bottom-nav {\n  background: rgba(8, 8, 8, 0.96) !important;\n  border-top-color: rgba(245, 158, 11, 0.28) !important;\n}\n\nhtml:not([data-desktop-web=\"1\"]):not([data-admin-contour=\"1\"]) .bottom-nav .quick-dock-tab-label,\nhtml:not([data-desktop-web=\"1\"]):not([data-admin-contour=\"1\"]) .bottom-nav #navCircleChatsHubBtn,\nhtml:not([data-desktop-web=\"1\"]):not([data-admin-contour=\"1\"]) .bottom-nav #bottomQuickSosBtn,\nhtml:not([data-desktop-web=\"1\"]):not([data-admin-contour=\"1\"]) .bottom-nav .klev-nav-glider {\n  display: none !important;\n}\n\nhtml:not([data-desktop-web=\"1\"]):not([data-admin-contour=\"1\"]) .bottom-nav-inner {\n  width: 100% !important;\n  display: grid !important;\n  grid-template-columns: repeat(4, 1fr) !important;\n  align-items: center !important;\n  gap: 4px !important;\n}\n\nhtml:not([data-desktop-web=\"1\"]):not([data-admin-contour=\"1\"]) .bottom-nav #navForecastMainBtn { order: 1; }\nhtml:not([data-desktop-web=\"1\"]):not([data-admin-contour=\"1\"]) .bottom-nav [data-nav-tab=\"geo\"] { order: 2; }\nhtml:not([data-desktop-web=\"1\"]):not([data-admin-contour=\"1\"]) .bottom-nav [data-nav-tab=\"log\"] { order: 3; }\nhtml:not([data-desktop-web=\"1\"]):not([data-admin-contour=\"1\"]) .bottom-nav #bottomNavMenuTriggerBtn { order: 4; }\n\nhtml:not([data-desktop-web=\"1\"]):not([data-admin-contour=\"1\"]) .bottom-nav .nav-tab {\n  background: transparent !important;\n  border: none !important;\n  box-shadow: none !important;\n  color: var(--muted) !important;\n  display: flex !important;\n  flex-direction: column !important;\n  align-items: center !important;\n  justify-content: center !important;\n  gap: 3px !important;\n  padding: 4px 2px !important;\n  font-size: 11px !important;\n  font-weight: 700 !important;\n}\n\nhtml:not([data-desktop-web=\"1\"]):not([data-admin-contour=\"1\"]) .bottom-nav .nav-tab.active {\n  color: var(--accent) !important;\n  font-weight: 800 !important;\n}\n\nhtml:not([data-desktop-web=\"1\"]):not([data-admin-contour=\"1\"]) .bottom-nav .nav-tab.active .dock-ico svg {\n  filter: drop-shadow(0 0 8px rgba(56, 189, 248, 0.45));\n}\n\nhtml[data-theme=\"contrast\"]:not([data-desktop-web=\"1\"]):not([data-admin-contour=\"1\"]) .bottom-nav .nav-tab.active .dock-ico svg {\n  filter: drop-shadow(0 0 8px rgba(245, 158, 11, 0.55));\n}\n\n/* 4. \u041a\u043d\u043e\u043f\u043a\u0438 \u0438 \u043f\u0430\u043d\u0435\u043b\u0438 \u043d\u0430 \u041a\u0430\u0440\u0442\u0435 (#secGeo) \u0432 \u0435\u0434\u0438\u043d\u043e\u043c \u0441\u0442\u0438\u043b\u0435 UX_UI Tactile Glassmorphism */\n.klev-arc-map-stage .klev-arc-icon-btn {\n  width: 46px !important;\n  height: 46px !important;\n  border-radius: 50% !important;\n  color: var(--text) !important;\n}\n\n.klev-arc-map-stage .klev-arc-icon-btn svg,\n.klev-arc-map-stage #arcBtnWeather svg,\n.klev-arc-map-stage #arcBtnSearchToggle svg {\n  stroke: currentColor !important;\n  fill: none !important;\n}\n\n.klev-arc-map-stage #arcPopoverTransport .btn,\n.klev-arc-map-stage #arcPopoverLayers .btn,\n.klev-arc-map-stage #arcPopoverSpotGrid .btn {\n  background: var(--card) !important;\n  border: 1px solid var(--border) !important;\n  border-radius: 14px !important;\n  color: var(--text) !important;\n  box-shadow: none !important;\n}\n\n.klev-arc-map-stage #arcPopoverTransport .btn.btn-accent,\n.klev-arc-map-stage #arcPopoverLayers .btn.btn-accent,\n.klev-arc-map-stage #arcPopoverSpotGrid .btn.btn-accent {\n  background: rgba(56, 189, 248, 0.16) !important;\n  border-color: var(--accent) !important;\n  color: var(--accent) !important;\n  box-shadow: 0 0 12px rgba(56, 189, 248, 0.24) !important;\n}\n\n/* 5. \u041a\u043e\u043c\u043f\u043e\u043d\u0435\u043d\u0442\u044b Tactile Glassmorphism (\u043b\u0438\u043d\u0437\u044b, \u043f\u0438\u043b\u044e\u043b\u0438, \u0441\u0435\u0433\u043c\u0435\u043d\u0442\u044b, \u043f\u0435\u0440\u0435\u043a\u043b\u044e\u0447\u0430\u0442\u0435\u043b\u0438 .klev-switch) */\n.k-svg {\n  width: 22px;\n  height: 22px;\n  stroke: currentColor;\n  stroke-width: 1.6px;\n  stroke-linecap: round;\n  stroke-linejoin: round;\n  fill: none;\n  flex-shrink: 0;\n}\n\n.status-dot {\n  width: 8px;\n  height: 8px;\n  border-radius: 50%;\n  background: var(--good, #10B981);\n  box-shadow: 0 0 8px var(--good, #10B981);\n  display: inline-block;\n  flex-shrink: 0;\n}\n\n.code-tag {\n  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;\n  font-size: 11px;\n  font-weight: 700;\n  padding: 2px 7px;\n  border-radius: 7px;\n  background: rgba(56, 189, 248, 0.14);\n  color: var(--accent, #38BDF8);\n  white-space: nowrap;\n}\n\n.subscreen-nav-bar {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  padding-bottom: 7px;\n  border-bottom: 1px solid var(--border);\n}\n\n.glass-panel {\n  background: var(--card);\n  border: 1px solid var(--border);\n  border-radius: 18px;\n  transition: border-color 0.18s ease;\n}\n\n.pill-btn {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  gap: 7px;\n  padding: 7px 13px;\n  border-radius: 9999px;\n  font-size: 12.5px;\n  font-weight: 700;\n  cursor: pointer;\n  background: var(--card);\n  border: 1px solid var(--border);\n  color: var(--text);\n  transition: border-color 0.18s ease, color 0.18s ease;\n}\n\n.pill-btn.active {\n  border-color: var(--accent);\n  color: var(--accent);\n  box-shadow: 0 0 14px rgba(56, 189, 248, 0.22);\n}\n\n.seg-bar {\n  display: flex;\n  align-items: center;\n  background: rgba(15, 23, 42, 0.42);\n  border: 1px solid var(--border);\n  border-radius: 9999px;\n  padding: 3px;\n  gap: 3px;\n}\n\nhtml[data-theme=\"light\"] .seg-bar {\n  background: rgba(226, 232, 240, 0.78);\n}\n\n.seg-btn {\n  flex: 1;\n  min-width: 0;\n  border: 1px solid transparent;\n  background: transparent;\n  color: var(--muted);\n  font-size: 11.5px;\n  font-weight: 700;\n  padding: 7px 4px;\n  border-radius: 9999px;\n  cursor: pointer;\n  transition: all 0.16s ease;\n  text-align: center;\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n\n.seg-btn.active {\n  background: var(--card);\n  border-color: var(--accent);\n  color: var(--text);\n  font-weight: 800;\n  box-shadow: 0 2px 10px rgba(56, 189, 248, 0.22);\n}\n\n.cta-full-btn {\n  width: 100%;\n  padding: 12px 16px;\n  border-radius: 16px;\n  font-size: 13.5px;\n  font-weight: 800;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  gap: 9px;\n  cursor: pointer;\n  background: var(--card);\n  border: 1.5px solid var(--accent);\n  color: var(--text);\n  box-shadow: 0 4px 16px rgba(56, 189, 248, 0.18);\n}\n\n.chart-floating-badge {\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  padding: 5px 11px;\n  border-radius: 9999px;\n  font-size: 11.5px;\n  font-weight: 800;\n  background: var(--panel);\n  border: 1px solid var(--accent);\n  color: var(--text);\n  font-variant-numeric: tabular-nums;\n}\n\n/* \u0422\u0443\u043c\u0431\u043b\u0435\u0440-\u043f\u0435\u0440\u0435\u043a\u043b\u044e\u0447\u0430\u0442\u0435\u043b\u044c (.klev-switch + \u0433\u043b\u043e\u0431\u0430\u043b\u044c\u043d\u0430\u044f \u0437\u0430\u043c\u0435\u043d\u0430 \u0432\u0441\u0435\u0445 \u0447\u0435\u043a\u0431\u043e\u043a\u0441\u043e\u0432 \u043d\u0430 \u043f\u0435\u0440\u0435\u043a\u043b\u044e\u0447\u0430\u0442\u0435\u043b\u044c) */\n.klev-switch {\n  position: relative;\n  display: inline-block;\n  width: 44px;\n  height: 24px;\n  flex-shrink: 0;\n  cursor: pointer;\n}\n.klev-switch input {\n  opacity: 0;\n  width: 0;\n  height: 0;\n  position: absolute;\n}\n.klev-switch-slider {\n  position: absolute;\n  inset: 0;\n  border-radius: 999px;\n  background: rgba(148, 163, 184, 0.28);\n  border: 1px solid var(--border);\n  transition: all 0.22s ease;\n}\n.klev-switch-slider::before {\n  content: \"\";\n  position: absolute;\n  width: 18px;\n  height: 18px;\n  left: 2px;\n  top: 2px;\n  border-radius: 50%;\n  background: #E2E8F0;\n  box-shadow: 0 2px 5px rgba(0,0,0,0.35);\n  transition: transform 0.22s cubic-bezier(0.22, 1, 0.36, 1), background 0.22s ease;\n}\n.klev-switch input:checked + .klev-switch-slider {\n  background: rgba(56, 189, 248, 0.28);\n  border-color: var(--accent);\n}\n.klev-switch input:checked + .klev-switch-slider::before {\n  transform: translateX(20px);\n  background: var(--accent);\n}\n\ninput[type=\"checkbox\"]:not(.klev-switch input) {\n  appearance: none;\n  -webkit-appearance: none;\n  width: 40px !important;\n  height: 22px !important;\n  border-radius: 999px !important;\n  background: rgba(148, 163, 184, 0.28) !important;\n  border: 1px solid var(--border) !important;\n  position: relative !important;\n  cursor: pointer !important;\n  flex-shrink: 0 !important;\n  vertical-align: middle !important;\n  transition: all 0.2s ease !important;\n}\ninput[type=\"checkbox\"]:not(.klev-switch input)::before {\n  content: \"\";\n  position: absolute;\n  width: 16px;\n  height: 16px;\n  left: 2px;\n  top: 2px;\n  border-radius: 50%;\n  background: #E2E8F0;\n  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);\n  transition: transform 0.2s cubic-bezier(0.22, 1, 0.36, 1), background 0.2s ease;\n}\ninput[type=\"checkbox\"]:not(.klev-switch input):checked {\n  background: rgba(56, 189, 248, 0.32) !important;\n  border-color: var(--accent) !important;\n}\ninput[type=\"checkbox\"]:not(.klev-switch input):checked::before {\n  transform: translateX(18px);\n  background: var(--accent);\n}\n\n/* 6. 6 \u043e\u0434\u043d\u043e\u0441\u0442\u0440\u043e\u0447\u043d\u044b\u0445 \u043c\u0438\u043d\u0438-\u043f\u043b\u0430\u0448\u0435\u043a \u0432\u043d\u0438\u0437\u0443 \u043a\u0430\u0440\u0442\u044b */\n.map-single-pill {\n  flex-shrink: 0;\n  padding: 9px 14px;\n  border-radius: 9999px;\n  font-size: 12.5px;\n  font-weight: 800;\n  white-space: nowrap;\n  cursor: pointer;\n  background: var(--card);\n  backdrop-filter: blur(14px);\n  -webkit-backdrop-filter: blur(14px);\n  border: 1px solid var(--border);\n  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);\n  color: var(--text);\n  transition: transform 0.15s ease, border-color 0.15s ease;\n}\n.map-single-pill.active {\n  border-color: var(--accent);\n  color: var(--accent);\n}\n\n/* 7. \u041a\u043e\u043c\u043f\u0430\u043a\u0442\u043d\u043e\u0435 \u0432\u0441\u043f\u043b\u044b\u0432\u0430\u044e\u0449\u0435\u0435 \u041c\u0435\u043d\u044e \u043d\u0430\u0434 \u043d\u0438\u0436\u043d\u0438\u043c \u0434\u043e\u043a\u043e\u043c (\u0432\u0441\u0435\u0433\u0434\u0430 \u0444\u0438\u043a\u0441\u0438\u0440\u043e\u0432\u0430\u043d\u043e \u0432\u043e \u0432\u044c\u044e\u043f\u043e\u0440\u0442\u0435, z-index 4500) */\n.compact-menu-backdrop {\n  position: fixed !important;\n  left: 0 !important;\n  right: 0 !important;\n  top: 0 !important;\n  bottom: calc(64px + env(safe-area-inset-bottom, 0px)) !important;\n  z-index: 4500 !important;\n  background: rgba(4, 9, 18, 0.48);\n  display: none;\n  align-items: flex-end;\n  justify-content: center;\n  padding: 10px 12px;\n}\n.compact-menu-backdrop.open {\n  display: flex !important;\n}\n.compact-menu-popover {\n  width: 100%;\n  max-width: 410px;\n  padding: 13px 14px 14px;\n  border-radius: 24px;\n  background: var(--bg);\n  backdrop-filter: blur(18px);\n  -webkit-backdrop-filter: blur(18px);\n  border: 1.5px solid var(--accent);\n  box-shadow: 0 -10px 34px rgba(0, 0, 0, 0.55), 0 0 22px rgba(56, 189, 248, 0.22);\n  display: flex;\n  flex-direction: column;\n  gap: 11px;\n}\n.sheet-grabber {\n  width: 38px;\n  height: 4px;\n  border-radius: 99px;\n  background: rgba(148, 163, 184, 0.38);\n  margin: 0 auto 2px;\n}\n.menu-grid-5 {\n  display: grid;\n  grid-template-columns: repeat(5, 1fr);\n  gap: 8px 6px;\n  padding: 4px 0;\n  justify-items: center;\n}\n.lens-item-wrap {\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  justify-content: center;\n  text-align: center;\n  cursor: pointer;\n  user-select: none;\n}\n.lens-btn {\n  width: 52px;\n  height: 52px;\n  border-radius: 50%;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  cursor: pointer;\n  padding: 0;\n  background: var(--card);\n  border: 1px solid var(--border);\n  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);\n  color: var(--text);\n  transition: transform 0.16s ease, border-color 0.2s ease;\n}\n.lens-btn.active {\n  border-color: var(--accent);\n  color: var(--accent);\n  box-shadow: 0 0 18px rgba(56, 189, 248, 0.32);\n}\n.lens-btn svg {\n  width: 23px;\n  height: 23px;\n  stroke: currentColor;\n  stroke-width: 1.6px;\n  stroke-linecap: round;\n  stroke-linejoin: round;\n  fill: none;\n}\n.lens-label {\n  margin-top: 5px;\n  font-size: 11.5px;\n  font-weight: 700;\n  color: var(--accent);\n  line-height: 1.2;\n}\n.sos-hold-track {\n  position: relative;\n  width: 100%;\n  height: 48px;\n  border-radius: 9999px;\n  background: linear-gradient(135deg, rgba(127, 29, 29, 0.78), rgba(69, 10, 10, 0.90));\n  border: 1px solid rgba(248, 113, 113, 0.50);\n  box-shadow: 0 0 18px rgba(239, 68, 68, 0.24);\n  display: flex;\n  align-items: center;\n  padding: 5px;\n  overflow: hidden;\n  cursor: pointer;\n  user-select: none;\n  touch-action: none;\n}\n.sos-hold-progress {\n  position: absolute;\n  left: 0;\n  top: 0;\n  bottom: 0;\n  width: 0%;\n  background: linear-gradient(90deg, rgba(239, 68, 68, 0.65), rgba(245, 158, 11, 0.75));\n  pointer-events: none;\n}\n.sos-hold-knob {\n  position: relative;\n  z-index: 2;\n  width: 38px;\n  height: 38px;\n  border-radius: 50%;\n  background: radial-gradient(circle at 30% 25%, #F87171, #DC2626);\n  border: 1px solid rgba(255, 255, 255, 0.5);\n  box-shadow: 0 0 12px rgba(239, 68, 68, 0.6);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  color: #FFFFFF;\n  flex-shrink: 0;\n}\n.sos-hold-text {\n  position: relative;\n  z-index: 2;\n  flex: 1;\n  text-align: center;\n  font-size: 12.5px;\n  font-weight: 800;\n  color: #FEE2E2;\n  padding-right: 18px;\n}\n\n/* 8. \u0413\u043e\u0440\u0438\u0437\u043e\u043d\u0442\u0430\u043b\u044c\u043d\u044b\u0439 \u0440\u0435\u0436\u0438\u043c (Landscape) \u0434\u043b\u044f \u043f\u043b\u0430\u043d\u0448\u0435\u0442\u043e\u0432, \u0431\u043e\u043b\u044c\u0448\u0438\u0445 \u0441\u043c\u0430\u0440\u0442\u0444\u043e\u043d\u043e\u0432 \u0438 \u0440\u0430\u0441\u043a\u043b\u0430\u0434\u0443\u0448\u0435\u043a (Flip / Fold) */\n.klev-fc-mobile-bento-grid {\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n}\n@media (orientation: landscape) and (max-width: 1180px) {\n  html:not([data-desktop-web=\"1\"]):not([data-admin-contour=\"1\"]) .klev-fc-mobile-bento-grid {\n    display: grid !important;\n    grid-template-columns: minmax(260px, 320px) minmax(0, 1fr) !important;\n    gap: 12px !important;\n    align-items: start !important;\n  }\n  html:not([data-desktop-web=\"1\"]):not([data-admin-contour=\"1\"]) #bentoHeroSonarStage,\n  html:not([data-desktop-web=\"1\"]):not([data-admin-contour=\"1\"]) #bentoHeroSonarCanvas {\n    width: 196px !important;\n    height: 196px !important;\n  }\n}\n" + '\n  </style>');
  }

  // 6.3: Вставка спрайта SVG-иконок (#klevRedesignSvgSprite)
  if (!idx.includes('id="klevRedesignSvgSprite"')) {
    idx = idx.replace('<body', '  ' + "<svg id=\"klevRedesignSvgSprite\" xmlns=\"http://www.w3.org/2000/svg\" style=\"display:none;\" aria-hidden=\"true\">\n  <!-- === 9 \u0418\u041a\u041e\u041d\u041e\u041a \u0413\u041b\u0410\u0412\u041d\u041e\u0413\u041e \u041c\u0415\u041d\u042e \u0418 \u0414\u041e\u041a\u0410 === -->\n  <symbol id=\"icon-map\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n    <polygon points=\"3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21 3 6\"/>\n    <line x1=\"9\" y1=\"3\" x2=\"9\" y2=\"18\"/>\n    <line x1=\"15\" y1=\"6\" x2=\"15\" y2=\"21\"/>\n    <path d=\"M12 11.5s2.5-2.2 2.5-4a2.5 2.5 0 0 0-5 0c0 1.8 2.5 4 2.5 4z\"/>\n    <circle cx=\"12\" cy=\"7.5\" r=\"0.8\"/>\n  </symbol>\n  <symbol id=\"icon-weather\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n    <path d=\"M17.5 19H9a5 5 0 1 1 4.9-6H17.5a3.5 3.5 0 0 1 0 7z\"/>\n    <path d=\"M15 7a3 3 0 0 1 4.2 3.8\"/>\n    <line x1=\"17\" y1=\"3\" x2=\"17\" y2=\"4.5\"/>\n    <line x1=\"21\" y1=\"7\" x2=\"19.5\" y2=\"7\"/>\n    <line x1=\"20\" y1=\"4\" x2=\"19\" y2=\"5\"/>\n  </symbol>\n  <symbol id=\"icon-forecast\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n    <path d=\"M4 20L18 6c1.5-1.5 3-.5 2.5 1.5L19 11\"/>\n    <circle cx=\"7\" cy=\"17\" r=\"1.5\"/>\n    <path d=\"M11 19c1.5-3 3-3 4.5 0s3 3 4.5 0\"/>\n  </symbol>\n  <symbol id=\"icon-chats\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n    <path d=\"M14 9a2 2 0 0 1-2 2H6l-3 3V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v4z\"/>\n    <path d=\"M18 9h1a2 2 0 0 1 2 2v9l-3-3h-6a2 2 0 0 1-2-2v-1\"/>\n    <circle cx=\"7\" cy=\"7\" r=\"0.5\" fill=\"currentColor\"/>\n    <circle cx=\"9.5\" cy=\"7\" r=\"0.5\" fill=\"currentColor\"/>\n    <circle cx=\"14\" cy=\"13\" r=\"0.5\" fill=\"currentColor\"/>\n    <circle cx=\"16.5\" cy=\"13\" r=\"0.5\" fill=\"currentColor\"/>\n  </symbol>\n  <symbol id=\"icon-sos\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n    <text x=\"12\" y=\"15\" text-anchor=\"middle\" font-size=\"8\" font-family=\"sans-serif\" font-weight=\"800\" stroke=\"none\" fill=\"currentColor\">SOS</text>\n  </symbol>\n  <symbol id=\"icon-journal\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n    <rect x=\"6\" y=\"3\" width=\"13\" height=\"18\" rx=\"2\"/>\n    <path d=\"M4 7h2M4 11h2M4 15h2M4 19h2\"/>\n    <path d=\"M13 3v7l2-1.5L17 10V3\"/>\n  </symbol>\n  <symbol id=\"icon-fish\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n    <path d=\"M3 12c3.5-4.5 9.5-5 14-1.5L21 8v8l-4-2.5C12.5 17 6.5 16.5 3 12z\"/>\n    <path d=\"M10 8.5c-1 2-1 5 0 7\"/>\n    <circle cx=\"7\" cy=\"11.5\" r=\"0.8\" fill=\"currentColor\"/>\n  </symbol>\n  <symbol id=\"icon-calendar\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n    <rect x=\"4\" y=\"5\" width=\"16\" height=\"16\" rx=\"2\"/>\n    <line x1=\"8\" y1=\"3\" x2=\"8\" y2=\"7\"/>\n    <line x1=\"16\" y1=\"3\" x2=\"16\" y2=\"7\"/>\n    <line x1=\"4\" y1=\"10\" x2=\"20\" y2=\"10\"/>\n    <text x=\"12\" y=\"17.5\" text-anchor=\"middle\" font-size=\"6.5\" font-family=\"sans-serif\" font-weight=\"600\" stroke=\"none\" fill=\"currentColor\">17</text>\n  </symbol>\n  <symbol id=\"icon-settings\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n    <circle cx=\"12\" cy=\"12\" r=\"3\"/>\n    <path d=\"M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z\"/>\n  </symbol>\n  <symbol id=\"icon-menu-grid\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n    <rect x=\"4\" y=\"4\" width=\"6.5\" height=\"6.5\" rx=\"1.8\"/>\n    <rect x=\"13.5\" y=\"4\" width=\"6.5\" height=\"6.5\" rx=\"1.8\" transform=\"rotate(15 16.75 7.25)\"/>\n    <rect x=\"4\" y=\"13.5\" width=\"6.5\" height=\"6.5\" rx=\"1.8\"/>\n    <rect x=\"13.5\" y=\"13.5\" width=\"6.5\" height=\"6.5\" rx=\"1.8\"/>\n  </symbol>\n\n  <!-- === 16 \u042d\u0422\u0410\u041b\u041e\u041d\u041d\u042b\u0425 \u0418\u041a\u041e\u041d\u041e\u041a \u041a\u0410\u0420\u0422\u042b \u041f\u041e \u0420\u0415\u0424\u0415\u0420\u0415\u041d\u0421\u0410\u041c 1000138411-413.JPG (\u0411\u0415\u0417 \u041a\u0420\u0423\u0413\u041b\u041e\u0413\u041e \u041e\u0411\u041e\u0414\u041a\u0410, \u0422\u041e\u041b\u042c\u041a\u041e \u0417\u041d\u0410\u0427\u041e\u041a) === -->\n  <!-- 1. GPS (\u043f\u0440\u0438\u0446\u0435\u043b + \u0441\u0442\u0440\u0435\u043b\u043a\u0430 \u043a\u0443\u0440\u0441\u043e\u0440\u0430 \u0431\u0435\u0437 \u0432\u043d\u0435\u0448\u043d\u0435\u0433\u043e \u043e\u0431\u043e\u0434\u043a\u0430 \u043a\u043d\u043e\u043f\u043a\u0438) -->\n  <symbol id=\"map-gps\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n    <circle cx=\"12\" cy=\"12\" r=\"6.8\"/>\n    <line x1=\"12\" y1=\"2.2\" x2=\"12\" y2=\"7.2\"/>\n    <line x1=\"12\" y1=\"16.8\" x2=\"12\" y2=\"21.8\"/>\n    <line x1=\"2.2\" y1=\"12\" x2=\"7.2\" y2=\"12\"/>\n    <line x1=\"16.8\" y1=\"12\" x2=\"21.8\" y2=\"12\"/>\n    <polygon points=\"14.6 9.4 12.6 15.2 11.4 12.6 8.8 11.4 14.6 9.4\"/>\n  </symbol>\n\n  <!-- 2. \u041a\u043e\u043c\u043f\u0430\u0441 (\u0448\u043a\u0430\u043b\u0430 \u0440\u0443\u043c\u0431\u043e\u0432 \u0438 \u0441\u0442\u0440\u0435\u043b\u043a\u0430 \u043a\u043e\u043c\u043f\u0430\u0441\u0430 \u0431\u0435\u0437 \u0432\u043d\u0435\u0448\u043d\u0435\u0433\u043e \u043e\u0431\u043e\u0434\u043a\u0430 \u043a\u043d\u043e\u043f\u043a\u0438) -->\n  <symbol id=\"map-compass\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n    <polygon points=\"16.2 7.8 13.6 13.6 7.8 16.2 10.4 10.4 16.2 7.8\"/>\n    <circle cx=\"12\" cy=\"12\" r=\"1.1\"/>\n    <line x1=\"12\" y1=\"3\" x2=\"12\" y2=\"4.8\"/>\n    <line x1=\"12\" y1=\"19.2\" x2=\"12\" y2=\"21\"/>\n    <line x1=\"3\" y1=\"12\" x2=\"4.8\" y2=\"12\"/>\n    <line x1=\"19.2\" y1=\"12\" x2=\"21\" y2=\"12\"/>\n    <line x1=\"5.6\" y1=\"5.6\" x2=\"6.9\" y2=\"6.9\"/>\n    <line x1=\"18.4\" y1=\"5.6\" x2=\"17.1\" y2=\"6.9\"/>\n    <line x1=\"5.6\" y1=\"18.4\" x2=\"6.9\" y2=\"17.1\"/>\n    <line x1=\"18.4\" y1=\"18.4\" x2=\"17.1\" y2=\"17.1\"/>\n  </symbol>\n\n  <!-- 3. \u0422\u043e\u0447\u043a\u0438 (3 \u043f\u0438\u043d\u0430 \u043b\u043e\u043a\u0430\u0446\u0438\u0438 \u0431\u0435\u0437 \u043a\u0440\u0443\u0433\u043b\u043e\u0433\u043e \u043e\u0431\u043e\u0434\u043a\u0430) -->\n  <symbol id=\"map-pins\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n    <path d=\"M6.8 11.8s2.6-2.3 2.6-4.2a2.6 2.6 0 0 0-5.2 0c0 1.9 2.6 4.2 2.6 4.2z\"/>\n    <circle cx=\"6.8\" cy=\"7.6\" r=\"0.7\"/>\n    <path d=\"M17.2 11.8s2.6-2.3 2.6-4.2a2.6 2.6 0 0 0-5.2 0c0 1.9 2.6 4.2 2.6 4.2z\"/>\n    <circle cx=\"17.2\" cy=\"7.6\" r=\"0.7\"/>\n    <path d=\"M12 20.5s3.2-2.8 3.2-5a3.2 3.2 0 0 0-6.4 0c0 2.2 3.2 5 3.2 5z\"/>\n    <circle cx=\"12\" cy=\"15.5\" r=\"0.9\"/>\n  </symbol>\n\n  <!-- 4. \u0421\u043b\u0438\u043f (\u043b\u043e\u0434\u043a\u0430 \u043d\u0430 \u043d\u0430\u043a\u043b\u043e\u043d\u043d\u043e\u043c \u043f\u0430\u043d\u0434\u0443\u0441\u0435 \u0441 \u0432\u043e\u043b\u043d\u0430\u043c\u0438) -->\n  <symbol id=\"point-slip\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n    <polygon points=\"3 18.5 3 12 18.5 18.5 3 18.5\"/>\n    <path d=\"M8.2 10.2l9.8 4.1 2.2-1.8-9.2-3.8-2.8 1.5z\"/>\n    <path d=\"M12.5 8.8l2.2-.8 1.4 2.1\"/>\n    <path d=\"M15.5 16.5c1.2-.6 2.4-.6 3.6 0s2.4.6 3.4 0\"/>\n  </symbol>\n\n  <!-- 5. \u041a\u043e\u0440\u044f\u0433\u0430 (\u0432\u0435\u0442\u0432\u0438\u0441\u0442\u0430\u044f \u043a\u043e\u0440\u044f\u0433\u0430 \u043d\u0430\u0434 \u0438 \u043f\u043e\u0434 \u0432\u043e\u0434\u043e\u0439) -->\n  <symbol id=\"point-snag\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n    <path d=\"M6.5 19.5l5-6.2 4.8-8.3\"/>\n    <path d=\"M13.5 9.8L10.5 5.5\"/>\n    <path d=\"M14.8 7.5l3.4-1.5\"/>\n    <path d=\"M11.5 13.3l5.2-2.1\"/>\n    <path d=\"M3 13.8c2-.9 4 .9 6 0\"/>\n    <path d=\"M15.5 13.8c1.8-.8 3.6.8 5.5 0\"/>\n    <path d=\"M4.5 16.8c2-.7 4 .7 6 0\"/>\n  </symbol>\n\n  <!-- 6. \u0421\u0442\u043e\u044f\u043d\u043a\u0430 (\u0437\u043d\u0430\u043a P, \u044f\u043a\u043e\u0440\u044c \u0438 \u043f\u0430\u043b\u0430\u0442\u043a\u0430) -->\n  <symbol id=\"point-camp\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n    <rect x=\"3.5\" y=\"4\" width=\"6.8\" height=\"7.5\" rx=\"1.4\"/>\n    <path d=\"M5.7 9.5V6.2h1.6a1.1 1.1 0 0 1 0 2.2H5.7\"/>\n    <line x1=\"6.9\" y1=\"13.2\" x2=\"6.9\" y2=\"18.8\"/>\n    <line x1=\"5.3\" y1=\"14.8\" x2=\"8.5\" y2=\"14.8\"/>\n    <path d=\"M4.6 17.2a2.4 2.4 0 0 0 4.6 0\"/>\n    <polygon points=\"15.8 9.2 10.5 19 21 19 15.8 9.2\"/>\n    <polyline points=\"13.8 19 15.8 14.8 17.8 19\"/>\n  </symbol>\n\n  <!-- 7. \u041e\u043f\u0430\u0441\u043d\u043e\u0441\u0442\u044c (\u0442\u0440\u0435\u0443\u0433\u043e\u043b\u044c\u043d\u0438\u043a \u0441 \u0432\u043e\u0441\u043a\u043b\u0438\u0446\u0430\u0442\u0435\u043b\u044c\u043d\u044b\u043c \u0437\u043d\u0430\u043a\u043e\u043c) -->\n  <symbol id=\"point-danger\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n    <path d=\"M10.3 4.2L2.3 18a2 2 0 0 0 1.7 3h16a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z\"/>\n    <line x1=\"12\" y1=\"9.2\" x2=\"12\" y2=\"14.2\"/>\n    <circle cx=\"12\" cy=\"17.4\" r=\"0.7\" fill=\"currentColor\"/>\n  </symbol>\n\n  <!-- 8. \u041a\u043b\u0451\u0432 (\u0440\u044b\u0431\u0430 \u0441 \u0430\u043a\u0443\u0441\u0442\u0438\u0447\u0435\u0441\u043a\u0438\u043c\u0438 \u0434\u0443\u0433\u0430\u043c\u0438 \u0441\u043e\u043d\u0430\u0440\u0430 \u0431\u0435\u0437 \u0432\u043d\u0435\u0448\u043d\u0435\u0433\u043e \u043a\u0440\u0443\u0433\u043b\u043e\u0433\u043e \u043e\u0431\u043e\u0434\u043a\u0430) -->\n  <symbol id=\"point-spot\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n    <path d=\"M6.8 12c2.2-2.8 6-3.1 8.8-.9L18.2 9v6l-2.6-2.1c-2.8 2.2-6.6 1.9-8.8-.9z\"/>\n    <circle cx=\"9.2\" cy=\"11.6\" r=\"0.6\" fill=\"currentColor\"/>\n    <path d=\"M4.2 8.2a6.5 6.5 0 0 0 0 7.6\"/>\n    <path d=\"M19.8 8.2a6.5 6.5 0 0 1 0 7.6\"/>\n  </symbol>\n\n  <!-- 9. \u041c\u0430\u0433\u0430\u0437\u0438\u043d (\u044f\u0449\u0438\u043a \u0441\u043e \u0441\u043d\u0430\u0441\u0442\u044f\u043c\u0438) -->\n  <symbol id=\"point-shop\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n    <rect x=\"3.5\" y=\"7.5\" width=\"17\" height=\"11.5\" rx=\"2\"/>\n    <path d=\"M8.8 7.5V5.6a1.8 1.8 0 0 1 1.8-1.8h2.8a1.8 1.8 0 0 1 1.8 1.8v1.9\"/>\n    <line x1=\"3.5\" y1=\"12.2\" x2=\"20.5\" y2=\"12.2\"/>\n    <rect x=\"10.8\" y=\"10.7\" width=\"2.4\" height=\"3.2\" rx=\"0.6\"/>\n  </symbol>\n\n  <!-- 10. \u041f\u043e\u0433\u043e\u0434\u0430 \u043d\u0430 \u043a\u0430\u0440\u0442\u0435 -->\n  <symbol id=\"map-weather\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n    <path d=\"M17.5 19H8.8a4.8 4.8 0 1 1 4.7-5.8H17.5a3.4 3.4 0 0 1 0 6.8z\"/>\n    <path d=\"M14.8 7.2a3 3 0 0 1 4.2 3.8\"/>\n    <line x1=\"17\" y1=\"3.2\" x2=\"17\" y2=\"4.7\"/>\n    <line x1=\"21\" y1=\"7.2\" x2=\"19.5\" y2=\"7.2\"/>\n    <line x1=\"20\" y1=\"4.2\" x2=\"18.9\" y2=\"5.3\"/>\n  </symbol>\n\n  <!-- 11. \u0421\u043b\u043e\u0438 \u043a\u0430\u0440\u0442\u044b (3 \u0440\u043e\u043c\u0431\u043e\u0432\u0438\u0434\u043d\u044b\u0445 \u0441\u043b\u043e\u044f) -->\n  <symbol id=\"map-layers\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n    <polygon points=\"12 3.5 21 8.5 12 13.5 3 8.5 12 3.5\"/>\n    <polyline points=\"3 12.5 12 17.5 21 12.5\"/>\n    <polyline points=\"3 16.2 12 21.2 21 16.2\"/>\n  </symbol>\n\n  <!-- 12. \u041c\u0430\u0448\u0438\u043d\u0430 (\u0432\u043d\u0435\u0434\u043e\u0440\u043e\u0436\u043d\u0438\u043a \u0432 \u043f\u0440\u043e\u0444\u0438\u043b\u044c \u0438\u0437 1000138411-413.jpg) -->\n  <symbol id=\"transport-car\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n    <path d=\"M3.5 15.5V9.2a1.2 1.2 0 0 1 1.2-1.2h8.8l2.4 3.2h3.4a1.5 1.5 0 0 1 1.5 1.5v2.8h-2.1\"/>\n    <line x1=\"9.2\" y1=\"15.5\" x2=\"14.5\" y2=\"15.5\"/>\n    <line x1=\"3.5\" y1=\"15.5\" x2=\"4.6\" y2=\"15.5\"/>\n    <rect x=\"5.2\" y=\"9.4\" width=\"3.4\" height=\"2.4\" rx=\"0.4\"/>\n    <polygon points=\"10 9.4 12.8 9.4 14.3 11.8 10 11.8 10 9.4\"/>\n    <rect x=\"2.3\" y=\"10.2\" width=\"1.2\" height=\"3.6\" rx=\"0.5\"/>\n    <circle cx=\"6.9\" cy=\"15.8\" r=\"2.3\"/>\n    <circle cx=\"6.9\" cy=\"15.8\" r=\"0.8\"/>\n    <circle cx=\"16.6\" cy=\"15.8\" r=\"2.3\"/>\n    <circle cx=\"16.6\" cy=\"15.8\" r=\"0.8\"/>\n  </symbol>\n\n  <!-- 13. \u0421\u043d\u0435\u0433\u043e\u0445\u043e\u0434 (\u0441\u043d\u0435\u0433\u043e\u0445\u043e\u0434 \u0432 \u043f\u0440\u043e\u0444\u0438\u043b\u044c \u0441 \u0433\u0443\u0441\u0435\u043d\u0438\u0446\u0435\u0439 \u0438 \u043b\u044b\u0436\u0435\u0439 \u0438\u0437 1000138411-413.jpg) -->\n  <symbol id=\"transport-snowmobile\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n    <path d=\"M4 14.2h10.5l3.2-3.4-3.6-2.4-1.8 1.8H5.5L4 14.2z\"/>\n    <path d=\"M12.2 8.4l-1.4-2\"/>\n    <rect x=\"3.5\" y=\"14.5\" width=\"9.8\" height=\"2.8\" rx=\"1.4\"/>\n    <circle cx=\"5.2\" cy=\"15.9\" r=\"0.5\" fill=\"currentColor\"/>\n    <circle cx=\"7.3\" cy=\"15.9\" r=\"0.5\" fill=\"currentColor\"/>\n    <circle cx=\"9.4\" cy=\"15.9\" r=\"0.5\" fill=\"currentColor\"/>\n    <circle cx=\"11.5\" cy=\"15.9\" r=\"0.5\" fill=\"currentColor\"/>\n    <line x1=\"15.5\" y1=\"12.5\" x2=\"17.4\" y2=\"17.2\"/>\n    <path d=\"M14.2 17.3h5.6c1.1 0 1.8-.7 2-1.6\"/>\n  </symbol>\n\n  <!-- 14. \u041b\u043e\u0434\u043a\u0430 (\u043c\u043e\u0442\u043e\u0440\u043d\u0430\u044f \u043b\u043e\u0434\u043a\u0430 \u043d\u0430 \u0432\u043e\u043b\u043d\u0430\u0445 \u0438\u0437 1000138411-413.jpg) -->\n  <symbol id=\"transport-boat\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n    <path d=\"M5.2 12.2h15.3l-2.6 3.8H6.6l-1.4-3.8z\"/>\n    <rect x=\"3\" y=\"10.4\" width=\"2.2\" height=\"3.2\" rx=\"0.5\"/>\n    <polyline points=\"11.2 12.2 13.6 9.2 15.8 12.2\"/>\n    <path d=\"M3 18.2c1.8-.9 3.6-.9 5.4 0s3.6.9 5.4 0 3.6-.9 5.4 0\"/>\n    <path d=\"M4.5 20.4c1.8-.7 3.6-.7 5.4 0s3.6.7 5.4 0 3.6-.7 4.8 0\"/>\n  </symbol>\n\n  <!-- 15. \u0412\u0435\u043b\u043e\u0441\u0438\u043f\u0435\u0434 (\u0438\u0437 1000138411-413.jpg) -->\n  <symbol id=\"transport-bicycle\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n    <circle cx=\"6.2\" cy=\"15.8\" r=\"3.4\"/>\n    <circle cx=\"17.8\" cy=\"15.8\" r=\"3.4\"/>\n    <polyline points=\"6.2 15.8 10.4 10.2 15.4 10.2 11.6 15.8 6.2 15.8\"/>\n    <line x1=\"10.4\" y1=\"10.2\" x2=\"11.6\" y2=\"15.8\"/>\n    <line x1=\"9.2\" y1=\"8.4\" x2=\"11.4\" y2=\"8.4\"/>\n    <polyline points=\"14.6 7.8 16.4 7.8 17.8 15.8\"/>\n  </symbol>\n\n  <!-- 16. \u041f\u0435\u0448\u043a\u043e\u043c (\u0440\u044b\u0431\u043e\u043b\u043e\u0432 \u0441 \u0440\u044e\u043a\u0437\u0430\u043a\u043e\u043c \u0438\u0437 1000138411-413.jpg) -->\n  <symbol id=\"transport-walk\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n    <circle cx=\"13\" cy=\"4.8\" r=\"1.9\"/>\n    <path d=\"M11.8 8.2l-1.2 5.4-2.6 5.4\"/>\n    <path d=\"M11 13.6l3.2 2.4 1.2 3.2\"/>\n    <path d=\"M12.2 8.6l2.6 2.4 2.2.8\"/>\n    <rect x=\"7.8\" y=\"8.2\" width=\"3.2\" height=\"5.2\" rx=\"1.1\"/>\n  </symbol>\n\n  <!-- === \u0414\u041e\u041f\u041e\u041b\u041d\u0418\u0422\u0415\u041b\u042c\u041d\u042b\u0415 \u0418\u041a\u041e\u041d\u041a\u0418 UI \u0411\u0415\u0417 \u041a\u0420\u0423\u0413\u041b\u041e\u0413\u041e \u041e\u0411\u041e\u0414\u041a\u0410 === -->\n  <symbol id=\"map-search\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n    <circle cx=\"11\" cy=\"11\" r=\"6.8\"/>\n    <line x1=\"19.8\" y1=\"19.8\" x2=\"15.9\" y2=\"15.9\"/>\n  </symbol>\n  <symbol id=\"ui-sunrise\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n    <path d=\"M17 18a5 5 0 0 0-10 0\"/>\n    <line x1=\"12\" y1=\"9\" x2=\"12\" y2=\"11\"/>\n    <line x1=\"4.2\" y1=\"13.2\" x2=\"5.6\" y2=\"14.6\"/>\n    <line x1=\"1\" y1=\"18\" x2=\"23\" y2=\"18\"/>\n    <line x1=\"18.4\" y1=\"14.6\" x2=\"19.8\" y2=\"13.2\"/>\n  </symbol>\n  <symbol id=\"ui-moon\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n    <path d=\"M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z\"/>\n    <line x1=\"3\" y1=\"20\" x2=\"21\" y2=\"20\"/>\n  </symbol>\n  <symbol id=\"ui-pin\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n    <path d=\"M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z\"/>\n    <circle cx=\"12\" cy=\"11\" r=\"2.2\"/>\n  </symbol>\n  <symbol id=\"ui-plus\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n    <line x1=\"12\" y1=\"6\" x2=\"12\" y2=\"18\"/>\n    <line x1=\"6\" y1=\"12\" x2=\"18\" y2=\"12\"/>\n  </symbol>\n  <symbol id=\"ui-arrow-left\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n    <polyline points=\"15 18 9 12 15 6\"/>\n  </symbol>\n  <symbol id=\"ui-arrow-right\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n    <line x1=\"5\" y1=\"12\" x2=\"19\" y2=\"12\"/>\n    <polyline points=\"13 6 19 12 13 18\"/>\n  </symbol>\n  <symbol id=\"ui-camera\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n    <path d=\"M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z\"/>\n    <circle cx=\"12\" cy=\"13\" r=\"4\"/>\n  </symbol>\n  <symbol id=\"ui-scale\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n    <rect x=\"4\" y=\"6\" width=\"16\" height=\"14\" rx=\"2\"/>\n    <circle cx=\"12\" cy=\"13\" r=\"4\"/>\n    <line x1=\"12\" y1=\"13\" x2=\"14\" y2=\"11\"/>\n  </symbol>\n</svg>" + '\n<body');
  }

  // 6.4: Обновление всех иконок нижнего дока (.bottom-nav) на единые монохромные векторные значки UX_UI + 4-я кнопка «Меню»
  idx = idx.replace(/<nav class="bottom-nav"[\s\S]*?<\/nav>/, "<nav class=\"bottom-nav\" aria-label=\"\u0411\u044b\u0441\u0442\u0440\u044b\u0439 \u0434\u043e\u0441\u0442\u0443\u043f\">\n    <div class=\"quick-dock-tab-label\">\u0411\u044b\u0441\u0442\u0440\u044b\u0439 \u0434\u043e\u0441\u0442\u0443\u043f</div>\n    <div class=\"bottom-nav-inner\">\n      <button type=\"button\" class=\"nav-tab\" data-nav-tab=\"geo\" aria-label=\"\u041a\u0430\u0440\u0442\u0430 \u0432\u043e\u0434\u043e\u0451\u043c\u043e\u0432\">\n        <span class=\"dock-ico\">\n          <svg class=\"k-svg\" width=\"22\" height=\"22\" viewBox=\"0 0 24 24\" fill=\"none\"><use href=\"#icon-map\"/></svg>\n        </span>\n        <span>\u041a\u0430\u0440\u0442\u0430</span>\n      </button>\n      <button type=\"button\" class=\"nav-tab\" data-nav-tab=\"chats\" id=\"navCircleChatsHubBtn\" aria-label=\"\u0427\u0430\u0442\u044b, \u041a\u0440\u0443\u0433 \u0438 \u042d\u043a\u0438\u043f\u0430\u0436\u0438\">\n        <span class=\"dock-ico\">\n          <svg class=\"k-svg\" width=\"22\" height=\"22\" viewBox=\"0 0 24 24\" fill=\"none\"><use href=\"#icon-chats\"/></svg>\n        </span>\n        <span>\u0427\u0430\u0442\u044b\u00b7\u041a\u0440\u0443\u0433</span>\n      </button>\n      <button type=\"button\" class=\"nav-tab active\" data-nav-tab=\"forecast\" id=\"navForecastMainBtn\" aria-label=\"\u0413\u043b\u0430\u0432\u043d\u044b\u0439 \u044d\u043a\u0440\u0430\u043d \u041f\u0440\u043e\u0433\u043d\u043e\u0437 \u043a\u043b\u0451\u0432\u0430\">\n        <span class=\"dock-ico\">\n          <svg class=\"k-svg\" width=\"22\" height=\"22\" viewBox=\"0 0 24 24\" fill=\"none\"><use href=\"#icon-forecast\"/></svg>\n        </span>\n        <span>\u041f\u0440\u043e\u0433\u043d\u043e\u0437</span>\n      </button>\n      <button type=\"button\" class=\"nav-tab nav-sos-btn\" id=\"bottomQuickSosBtn\" aria-label=\"\u042d\u043a\u0441\u0442\u0440\u0435\u043d\u043d\u044b\u0439 \u0441\u0438\u0433\u043d\u0430\u043b SOS \u043d\u0430 \u0432\u043e\u0434\u0435\">\n        <span class=\"sos-red-circle\">SOS</span>\n        <span class=\"sos-lbl-text\">SOS</span>\n      </button>\n      <button type=\"button\" class=\"nav-tab\" data-nav-tab=\"log\" aria-label=\"\u0416\u0443\u0440\u043d\u0430\u043b \u0443\u043b\u043e\u0432\u043e\u0432\">\n        <span class=\"dock-ico\">\n          <svg class=\"k-svg\" width=\"22\" height=\"22\" viewBox=\"0 0 24 24\" fill=\"none\"><use href=\"#icon-journal\"/></svg>\n        </span>\n        <span>\u0416\u0443\u0440\u043d\u0430\u043b</span>\n      </button>\n      <button type=\"button\" class=\"nav-tab\" id=\"bottomNavMenuTriggerBtn\" aria-label=\"\u041c\u0435\u043d\u044e \u0438 \u0438\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u044b\">\n        <span class=\"dock-ico\">\n          <svg class=\"k-svg\" width=\"22\" height=\"22\" viewBox=\"0 0 24 24\" fill=\"none\"><use href=\"#icon-menu-grid\"/></svg>\n        </span>\n        <span>\u041c\u0435\u043d\u044e</span>\n      </button>\n    </div>\n  </nav>");

  // 6.5: Компактное всплывающее Меню (#klevCompactMenuBackdrop) с гибридным ползунком SOS (#klevHybridSosTrack)
  if (!idx.includes('id="klevCompactMenuBackdrop"')) {
    idx = idx.replace('  <script id="klevBundledAppRuntime"', "  <!-- \u041a\u041e\u041c\u041f\u0410\u041a\u0422\u041d\u041e\u0415 \u0412\u0421\u041f\u041b\u042b\u0412\u0410\u042e\u0429\u0415\u0415 \u041c\u0415\u041d\u042e v2.9.1 (5 \u0420\u0410\u0417\u0414\u0415\u041b\u041e\u0412 \u0411\u0415\u0417 \u0414\u0423\u0411\u041b\u0415\u0419 + \u0413\u0418\u0411\u0420\u0418\u0414\u041d\u042b\u0419 \u041f\u041e\u041b\u0417\u0423\u041d\u041e\u041a SOS) -->\n  <div class=\"compact-menu-backdrop\" id=\"klevCompactMenuBackdrop\" role=\"dialog\" aria-label=\"\u0411\u044b\u0441\u0442\u0440\u043e\u0435 \u043c\u0435\u043d\u044e \u0438\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u043e\u0432\">\n    <div class=\"compact-menu-popover\">\n      <div class=\"sheet-grabber\"></div>\n      <div style=\"display:flex;align-items:center;justify-content:space-between;gap:8px;\">\n        <span style=\"font-size:13px;font-weight:800;letter-spacing:0.4px;\">\u0418\u041d\u0421\u0422\u0420\u0423\u041c\u0415\u041d\u0422\u042b \u0418 \u0420\u0410\u0417\u0414\u0415\u041b\u042b</span>\n        <span style=\"font-size:11px;color:var(--muted);display:inline-flex;align-items:center;gap:5px;\">\n          <span class=\"status-dot\"></span><span id=\"klevMenuOnlineStatusLbl\">\u041e\u043d\u043b\u0430\u0439\u043d \u2022 \u041e\u0444\u043b\u0430\u0439\u043d-\u043a\u0430\u0440\u0442\u044b</span>\n        </span>\n      </div>\n\n      <!-- 5 \u0443\u043d\u0438\u043a\u0430\u043b\u044c\u043d\u044b\u0445 \u0440\u0430\u0437\u0434\u0435\u043b\u043e\u0432 \u0431\u0435\u0437 \u0434\u0443\u0431\u043b\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u044f \u043d\u0438\u0436\u043d\u0435\u0433\u043e \u0434\u043e\u043a\u0430 (\u041f\u043e\u0433\u043e\u0434\u0430, \u0427\u0430\u0442\u044b, \u0420\u044b\u0431\u044b, \u041a\u0430\u043b\u0435\u043d\u0434\u0430\u0440\u044c, \u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438) -->\n      <div class=\"menu-grid-5\" role=\"navigation\" aria-label=\"\u0418\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u044b\">\n        <div class=\"lens-item-wrap\" data-klev-menu-route=\"weather\">\n          <button type=\"button\" class=\"lens-btn\" aria-label=\"\u041f\u043e\u0433\u043e\u0434\u0430\">\n            <svg><use href=\"#icon-weather\"></use></svg>\n          </button>\n          <span class=\"lens-label\">\u041f\u043e\u0433\u043e\u0434\u0430</span>\n        </div>\n\n        <div class=\"lens-item-wrap\" data-klev-menu-route=\"chats\">\n          <button type=\"button\" class=\"lens-btn\" aria-label=\"\u0427\u0430\u0442\u044b \u0438 \u041a\u0440\u0443\u0433\">\n            <svg><use href=\"#icon-chats\"></use></svg>\n          </button>\n          <span class=\"lens-label\">\u0427\u0430\u0442\u044b</span>\n        </div>\n\n        <div class=\"lens-item-wrap\" data-klev-menu-route=\"fish\">\n          <button type=\"button\" class=\"lens-btn\" aria-label=\"\u0420\u044b\u0431\u044b\">\n            <svg><use href=\"#icon-fish\"></use></svg>\n          </button>\n          <span class=\"lens-label\">\u0420\u044b\u0431\u044b</span>\n        </div>\n\n        <div class=\"lens-item-wrap\" data-klev-menu-route=\"calendar\">\n          <button type=\"button\" class=\"lens-btn\" aria-label=\"\u041a\u0430\u043b\u0435\u043d\u0434\u0430\u0440\u044c\">\n            <svg><use href=\"#icon-calendar\"></use></svg>\n          </button>\n          <span class=\"lens-label\">\u041a\u0430\u043b\u0435\u043d\u0434\u0430\u0440\u044c</span>\n        </div>\n\n        <div class=\"lens-item-wrap\" data-klev-menu-route=\"settings\">\n          <button type=\"button\" class=\"lens-btn\" aria-label=\"\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438\">\n            <svg><use href=\"#icon-settings\"></use></svg>\n          </button>\n          <span class=\"lens-label\">\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438</span>\n        </div>\n      </div>\n\n      <!-- \u041a\u043e\u043c\u043f\u0430\u043a\u0442\u043d\u044b\u0439 \u0440\u044f\u0434 \u043f\u0435\u0440\u0435\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u044f \u0422\u0435\u043c\u044b \u0438 \u0420\u0435\u0436\u0438\u043c\u0430 \u0441\u0442\u0435\u043a\u043b\u0430 -->\n      <div style=\"display:grid;grid-template-columns:1.45fr 1fr;gap:6px;\">\n        <div class=\"seg-bar\" aria-label=\"\u0412\u044b\u0431\u043e\u0440 \u0442\u0435\u043c\u044b\">\n          <button type=\"button\" class=\"seg-btn active\" data-klev-menu-theme=\"dark\">\u0422\u0451\u043c\u043d\u0430\u044f</button>\n          <button type=\"button\" class=\"seg-btn\" data-klev-menu-theme=\"light\">\u0421\u0432\u0435\u0442\u043b\u0430\u044f</button>\n          <button type=\"button\" class=\"seg-btn\" data-klev-menu-theme=\"contrast\">OLED</button>\n        </div>\n        <div class=\"seg-bar\" aria-label=\"\u0420\u0435\u0436\u0438\u043c \u0441\u0442\u0435\u043a\u043b\u0430\">\n          <button type=\"button\" class=\"seg-btn active\" data-klev-menu-glass=\"1\">\u0421\u0442\u0435\u043a\u043b\u043e</button>\n          <button type=\"button\" class=\"seg-btn\" data-klev-menu-glass=\"0\">\u041e\u0431\u044b\u0447\u043d\u044b\u0439</button>\n        </div>\n      </div>\n\n      <!-- \u0417\u0430\u0449\u0438\u0449\u0451\u043d\u043d\u044b\u0439 \u0433\u0438\u0431\u0440\u0438\u0434\u043d\u044b\u0439 \u043f\u043e\u043b\u0437\u0443\u043d\u043e\u043a SOS: \u0441\u0432\u0430\u0439\u043f \u0432\u043f\u0440\u0430\u0432\u043e \u0418\u041b\u0418 \u0443\u0434\u0435\u0440\u0436\u0430\u043d\u0438\u0435 2 \u0441\u0435\u043a -->\n      <div class=\"sos-hold-track\" id=\"klevHybridSosTrack\" role=\"button\" tabindex=\"0\" aria-label=\"\u0421\u0432\u0430\u0439\u043f \u0432\u043f\u0440\u0430\u0432\u043e \u0438\u043b\u0438 \u0443\u0434\u0435\u0440\u0436\u0430\u043d\u0438\u0435 2 \u0441\u0435\u043a\u0443\u043d\u0434\u044b \u0434\u043b\u044f SOS\">\n        <div class=\"sos-hold-progress\" id=\"klevHybridSosFill\"></div>\n        <div class=\"sos-hold-knob\" id=\"klevHybridSosKnob\">\n          <svg class=\"k-svg\" style=\"width:18px;height:18px;\"><use href=\"#ui-arrow-right\"></use></svg>\n        </div>\n        <div class=\"sos-hold-text\" id=\"klevHybridSosLabel\">\u0421\u0432\u0430\u0439\u043f \u0432\u043f\u0440\u0430\u0432\u043e \u0438\u043b\u0438 2 \u0441\u0435\u043a \u0434\u043b\u044f SOS</div>\n      </div>\n    </div>\n  </div>" + '\n\n  <script id="klevBundledAppRuntime"');
  }

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
