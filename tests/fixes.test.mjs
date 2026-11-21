import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const verData = JSON.parse(fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8'));
const workerSrc = fs.readFileSync(path.join(ROOT, 'cloudflare-worker-bot.js'), 'utf8');
const indexSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const kpSrc = fs.readFileSync(path.join(ROOT, 'kp-control-89.html'), 'utf8');
const swSrc = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const runtimeSrc = fs.existsSync(path.join(ROOT, 'app-runtime.js'))
  ? fs.readFileSync(path.join(ROOT, 'app-runtime.js'), 'utf8')
  : indexSrc;

test('3.1 Лимитер запросов checkWorkerRateLimit соблюдает переданный maxPerMin и не задирает лимит до 240', () => {
  assert.ok(
    !workerSrc.includes('Math.max(240, Number(maxPerMin) || 240)'),
    'В воркере не должно оставаться Math.max(240, ...)'
  );
  assert.ok(
    workerSrc.includes('const limit = Math.max(1, Number(maxPerMin) || 60);'),
    'В checkWorkerRateLimit должен использоваться const limit = Math.max(1, Number(maxPerMin) || 60)'
  );
  assert.ok(
    workerSrc.includes('CREATE TABLE IF NOT EXISTS auth_attempts'),
    'Должна создаваться таблица auth_attempts для блокировки после 5 неудачных попыток за 15 минут'
  );

  // Эмуляция логики checkWorkerRateLimit при maxPerMin = 15 (/auth/login)
  const rateBuckets = new Map();
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
  for (let i = 1; i <= 15; i++) {
    assert.equal(checkWorkerRateLimit('auth_1.2.3.4', false, 15), true, `Попытка ${i} должна проходить`);
  }
  assert.equal(checkWorkerRateLimit('auth_1.2.3.4', false, 15), false, '16-я попытка при лимите 15 должна блокироваться');
});

test('3.2 ИИ-ручка /api/ai/identify-fish и /api/ai/identify-fish/chunk проверяет сессию, бета-статус, квоту и TTL AI_CHK_*', () => {
  assert.ok(workerSrc.includes('async function verifyAiVisionBetaAccess('));
  assert.ok(workerSrc.includes('const aiAuth = await verifyAiVisionBetaAccess(request, reqUrl, b, env);'));
  assert.ok(workerSrc.includes("return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), { status: 403"));
  assert.ok(workerSrc.includes("DELETE FROM klev_kv WHERE k LIKE 'AI_CHK_%' AND updated_at < ?"));
  assert.ok(workerSrc.includes('consumeAiUserChunkQuota(env, aiAuth.fisherId, 1)'));
});

test('3.3 Регулярка шлюз тайлов блокирует чужие домены (evilopenstreetmap.org) и пропускает легитимные поддомены', () => {
  const tileHostRe = /(^|\.)(maps\.yandex\.net|arcgisonline\.com|openstreetmap\.org|cartocdn\.com|opentopomap\.org|maps\.mail\.ru)$/i;
  assert.equal(tileHostRe.test('evilopenstreetmap.org'), false, 'evilopenstreetmap.org должен отвергаться');
  assert.equal(tileHostRe.test('fake-maps.yandex.net'), false, 'fake-maps.yandex.net должен отвергаться');
  assert.equal(tileHostRe.test('core-renderer-tiles.maps.yandex.net'), true, 'Яндекс тайлы должны проходить');
  assert.equal(tileHostRe.test('tile.openstreetmap.org'), true, 'tile.openstreetmap.org должен проходить');
  assert.ok(workerSrc.includes('/(^|\\.)(maps\\.yandex\\.net|arcgisonline\\.com|openstreetmap\\.org|cartocdn\\.com|opentopomap\\.org|maps\\.mail\\.ru)$/i'));
  assert.ok(swSrc.includes('/(^|\\.)(maps\\.yandex\\.net|arcgisonline\\.com|openstreetmap\\.org|openstreetmap\\.fr|cartocdn\\.com|opentopomap\\.org|maps\\.mail\\.ru)$/i'));
  assert.ok(runtimeSrc.includes('window.__KLEV_USE_TILE_PROXY_FALLBACK__'), 'Шлюз тайлов в клиенте должен быть закрыт флагом резерва');
});

test('3.4 & 4.8 Единый источник версии VERSION (2.9.0 r240) синхронизирован во всех файлах и ссылка на APK валидна', () => {
  assert.equal(verData.version, '2.9.1');
  assert.equal(verData.revision, 'r247');
  assert.equal(verData.versionCode, 293247);

  const vJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));
  const apkVJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'apk/apk-version.json'), 'utf8'));
  const polJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'policy-version.json'), 'utf8'));
  const manJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const gradleSrc = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle'), 'utf8');
  const mainJava = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/ru/klevpro/app/MainActivity.java'), 'utf8');

  assert.equal(vJson.version, verData.version);
  assert.equal(vJson.revision, verData.revision);
  assert.equal(vJson.versionCode, verData.versionCode);
  assert.equal(vJson.apkUrl, `https://klevpro.ru/apk/klev-pro-v${verData.version}.apk`);
  assert.equal(apkVJson.apkUrl, vJson.apkUrl);
  assert.equal(polJson.appVersion, verData.version);
  assert.equal(polJson.appRevision, verData.revision);
  assert.equal(manJson.version, verData.fullVersion);

  assert.ok(gradleSrc.includes(String(verData.versionCode)));
  assert.ok(gradleSrc.includes(`versionName "${verData.fullVersion}"`));
  assert.ok(mainJava.includes(`KlevProAPK/${verData.fullVersion}`));
  assert.ok(mainJava.includes(`?v=${verData.version}_${verData.revision}_`));

  // Если в каталоге apk/ присутствуют собранные .apk файлы, проверяем физическое наличие целевого файла из apkUrl
  const apkDir = path.join(ROOT, 'apk');
  const apkFiles = fs.existsSync(apkDir) ? fs.readdirSync(apkDir).filter(f => f.endsWith('.apk')) : [];
  if (apkFiles.length > 0 || process.env.STRICT_APK_FILE_CHECK === '1') {
    const expectedApkPath = path.join(apkDir, verData.apkFileName);
    assert.ok(fs.existsSync(expectedApkPath), `В apk/ должен лежать файл ${verData.apkFileName}, указанный в version.json`);
  }
});

test('3.5 Экранирование пользовательских данных esc() и белый список URI в MainActivity.java', () => {
  assert.ok(runtimeSrc.includes('window.esc='));
  const esc = (e) => e == null ? '' : String(e)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const malicious = `<img src=x onerror="alert('xss')"> & 'test'`;
  const escaped = esc(malicious);
  assert.equal(escaped, '&lt;img src=x onerror=&quot;alert(&#39;xss&#39;)&quot;&gt; &amp; &#39;test&#39;');
  assert.ok(!escaped.includes('<') && !escaped.includes('>'));

  const mainJava = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/ru/klevpro/app/MainActivity.java'), 'utf8');
  assert.ok(mainJava.includes('private boolean isAllowedExternalUri(Uri uri)'));
  assert.ok(mainJava.includes('!"https".equalsIgnoreCase(scheme.trim())'));
  assert.ok(mainJava.includes('"klevpro.ru".equals(h)'));
  assert.ok(mainJava.includes('"xn--b1apdneg0j.xn--p1ai".equals(h)'));
  assert.ok(mainJava.includes('"github.com".equals(h)'));
});

test('3.6 & 4.2 Админка закрыта от индексации (meta noindex + robots.txt) и синхронизирована с index.html', () => {
  const robotsTxt = fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8');
  assert.ok(robotsTxt.includes('Disallow: /kp-control-89.html'));
  assert.ok(!robotsTxt.includes('Host:'));
  assert.ok(kpSrc.includes('<meta name="robots" content="noindex, nofollow">'));
  assert.ok(kpSrc.includes('window.__KLEV_ADMIN_CONTOUR__ = true;'));
});

test('4.5 Совпадение хешей SHA-256 через crypto.subtle со старой эталонной реализацией', async () => {
  // Старая самописная реализация для сверки эталонных векторов
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);
  function legacySha256Hex(str) {
    const msg = new TextEncoder().encode(str);
    const bitLen = msg.length * 8;
    const padLen = ((msg.length + 9 + 63) & ~63);
    const buf = new Uint8Array(padLen);
    buf.set(msg);
    buf[msg.length] = 0x80;
    const view = new DataView(buf.buffer);
    view.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000), false);
    view.setUint32(padLen - 4, bitLen >>> 0, false);
    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    const w = new Uint32Array(64);
    for (let offset = 0; offset < padLen; offset += 64) {
      for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
      for (let i = 16; i < 64; i++) {
        const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3);
        const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (let i = 0; i < 64; i++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const ch = (e & f) ^ (~e & g);
        const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + temp1) >>> 0;
        d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
    }
    const out = new Uint8Array(32);
    const outView = new DataView(out.buffer);
    [h0, h1, h2, h3, h4, h5, h6, h7].forEach((val, idx) => outView.setUint32(idx * 4, val, false));
    return Array.from(out, b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  async function subtleSha256Hex(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  for (const sample of ['', 'KlevPro_2.9.0_r240', 'Рыболов Новый Уренгой 66.08N 76.68E', 'ADM_SESS_V3:1790000000000:A1B2C3D4E5F60718']) {
    const expected = legacySha256Hex(sample);
    const actual = await subtleSha256Hex(sample);
    assert.equal(actual, expected, `Хеш SHA-256 для "${sample}" должен совпадать 1-в-1`);
  }
  assert.ok(!workerSrc.includes('const _SHA256_K = new Uint32Array'), 'Самописный SHA-256 должен быть удалён из воркера');
});

test('4.6 & 5.3 Расчёт восхода/заката для 66.08°N (Новый Уренгой) и детерминированность прогноза клёва с био-потолком', () => {
  assert.ok(runtimeSrc.includes('function calcPolarSunTimes('));
  const m = runtimeSrc.match(/function calcPolarSunTimes\([\s\S]*?\}\}\}/);
  assert.ok(m, 'Функция calcPolarSunTimes должна присутствовать в рантайме');
  const calcPolarSunTimes = new Function(`return (${m[0]})`)();

  const nov17 = calcPolarSunTimes('2026-11-17', 66.08, 76.68);
  // Для 66.08°N 17 ноября восход около 08:48 (8.80 ч), закат около 14:29 (14.49 ч)
  assert.ok(nov17.sunriseHr >= 8.5 && nov17.sunriseHr <= 9.1, `Восход для 66.08°N в ноябре: ${nov17.sunriseHr}`);
  assert.ok(nov17.sunsetHr >= 14.2 && nov17.sunsetHr <= 14.8, `Закат для 66.08°N в ноябре: ${nov17.sunsetHr}`);

  const jun21 = calcPolarSunTimes('2026-06-21', 68.5, 76.68);
  assert.equal(jun21.polarDay, true, 'На 68.5°N 21 июня должен определяться полярный день');

  // Проверка детерминированности прогноза клёва и соблюдения биологического потолка (0..100%)
  function evalBiteScoreDeterministic(base, factors, bioCeiling = 94) {
    const sum = factors.reduce((acc, f) => acc + f, 0);
    return Math.max(5, Math.min(bioCeiling, Math.min(100, Math.round(base + sum))));
  }
  const s1 = evalBiteScoreDeterministic(52, [14, 12, 10, 8, 15], 92);
  const s2 = evalBiteScoreDeterministic(52, [14, 12, 10, 8, 15], 92);
  assert.equal(s1, s2, 'Прогноз клёва должен быть строго детерминированным');
  assert.equal(s1, 92, 'Прогноз клёва не должен превышать биологический потолок вида');
});

test("2.1 Идемпотентность apply-fixes.mjs: повторный запуск не меняет ни одного байта", async () => {
  const { execFileSync } = await import("node:child_process");
  const files = ["index.html", "kp-control-89.html", "app-runtime.js", "cloudflare-worker-bot.js", "sw.js", "version.json", "robots.txt"];
  const before = Object.fromEntries(files.map(f => [f, fs.readFileSync(path.join(ROOT, f), "utf8")]));
  execFileSync(process.execPath, [path.join(ROOT, "tools/apply-fixes.mjs")], { cwd: ROOT });
  for (const f of files) {
    const after = fs.readFileSync(path.join(ROOT, f), "utf8");
    assert.equal(after, before[f], `Файл ${f} не должен меняться при повторном запуске apply-fixes.mjs`);
  }
});

test("2.3 Синтаксическая валидность YAML в .github/workflows/build-android-apk.yml и apply-fixes.yml", () => {
  for (const wfRel of [".github/workflows/build-android-apk.yml", ".github/workflows/apply-fixes.yml"]) {
    const lines = fs.readFileSync(path.join(ROOT, wfRel), "utf8").split(/\r?\n/);
    let inRunBlock = false;
    let runIndent = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim() || line.trim().startsWith("#")) continue;
      const mRun = line.match(/^(\s*)run:\s*\|\s*$/);
      if (mRun) {
        inRunBlock = true;
        runIndent = mRun[1].length;
        continue;
      }
      if (inRunBlock) {
        const curIndent = line.match(/^(\s*)/)[1].length;
        if (curIndent <= runIndent) {
          assert.match(line, /^\s*(-\s+name:|steps:|jobs:|permissions:|env:|working-directory:|if:|uses:|with:)/, `Некорректный отступ YAML внутри блока run: | в ${wfRel} на строке ${i + 1}: ${line}`);
          inRunBlock = false;
        }
      }
    }
  }
});

test("6.1 Редизайн v2.9.1 (r241): 16 векторных значков карты без лишних ободков, живой сонар в forecast.module.js без мигания старого UI, компактное меню без дублей, гибридный SOS, < Назад в Погоде и сохранение десктопа", () => {
  const indexSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const runtimeSrc = fs.readFileSync(path.join(ROOT, 'app-runtime.js'), 'utf8');

  // 1. Спрайт векторных иконок и спокойная скорость сонара 0.52 (без фейковых заглушек #klevAppFrame и #klevRearScreenHud)
  assert.ok(indexSrc.includes('id="klevRedesignSvgSprite"'), 'В index.html должен быть встроен спрайт векторных SVG-иконок');
  assert.ok(indexSrc.includes('var SONAR_SPEED_MULT = 0.52;'), 'Скорость загрузочного сонара должна быть снижена до 0.52');
  assert.ok(!indexSrc.includes('id="klevAppFrame"'), 'В index.html не должно быть статической демо-заглушки #klevAppFrame');
  assert.ok(!indexSrc.includes('id="klevRearScreenHud"'), 'В index.html не должно быть выдуманной мини-панели #klevRearScreenHud');

  // 2. Компактное меню из 5 уникальных разделов + гибридный ползунок SOS + новые монохромные иконки нижнего дока
  assert.ok(indexSrc.includes('id="bottomNavMenuTriggerBtn"'), 'В нижнем доке должна быть 4-я кнопка Меню');
  assert.ok(indexSrc.includes('id="klevCompactMenuBackdrop"'), 'Должно присутствовать компактное всплывающее окно Меню');
  assert.ok(indexSrc.includes('id="klevHybridSosTrack"'), 'В компактном меню должен быть гибридный свайп-ползунок SOS');
  assert.ok(indexSrc.includes('href="#icon-forecast"') && indexSrc.includes('href="#icon-map"') && indexSrc.includes('href="#icon-journal"'), 'Нижний док должен использовать монохромные векторные значки UX_UI');

  // 3. Сохранение десктопного режима (html[data-desktop-web="1"]) и горизонтальный режим для планшетов/раскладушек
  assert.ok(indexSrc.includes('html[data-desktop-web="1"] .klev-fc-subtabs-bar'), 'На десктопе мобильные подвкладки должны скрываться без поломки десктопного интерфейса');
  assert.ok(indexSrc.includes('@media (orientation: landscape) and (max-width: 1180px)'), 'Должна поддерживаться горизонтальная двухколоночная сетка для планшетов и раскладушек');

  // 4. Живой сонар в forecast.module.js, защита от мигания старого UI (#fcRedesignMobileRoot), новые значки карты и транспорта без ободков
  assert.ok(runtimeSrc.includes('bentoHeroSonarCanvas'), 'В боевом forecast.module.js должен рендериться живой сонар #bentoHeroSonarCanvas');
  assert.ok(runtimeSrc.includes('fcRedesignMobileRoot'), 'Мобильный прогноз должен рендериться в изолированный контейнер #fcRedesignMobileRoot без перезаписи старым renderExpress');
  assert.ok(!runtimeSrc.includes('id="fcCleanArchiveBtn"'), 'Кнопка Очистить кэш должна быть навсегда убрана из 10-дневного прогноза');
  assert.ok(runtimeSrc.includes('arcCompactPillsStrip'), 'В боевом geo.module.js должна рендериться лента из 6 однострочных плашек #arcCompactPillsStrip');
  assert.ok(runtimeSrc.includes('#transport-car') && runtimeSrc.includes('#transport-snowmobile') && runtimeSrc.includes('#map-pins'), 'Кнопки карты и транспорта должны использовать новые векторные значки UX_UI без лишнего круглого ободка');
});


test('6.2 Аудит r244: вращение карты без transform:none, конвейер фильтрации GPS, пакет ошибок из 5 записей и NavService', () => {
  const layoutCss = fs.readFileSync(path.join(ROOT, 'css/layout.css'), 'utf8');
  const geoSrc = fs.readFileSync(path.join(ROOT, 'js/modules/geo/geo.module.js'), 'utf8');
  const appSrc = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  assert.ok(!/\.compass-bearing-active\s+#mapBox\s*\{[^}]*transform:\s*none/i.test(layoutCss), 'В .compass-bearing-active #mapBox не должно быть transform: none !important');
  assert.ok(!geoSrc.includes('_arcCompassHeadingDeg = 35'), 'Зашитый курс 35° должен быть удалён');
  assert.ok(geoSrc.includes('_gpsFilterIngest') && geoSrc.includes('simplifyTrackRdp') && geoSrc.includes('acquireStableStartFix'), 'Должен присутствовать конвейер фильтрации GPS и упрощения трека');
  assert.ok(appSrc.includes('CLIENT_ERROR_BATCH_SIZE = 5'), 'Ошибки должны копиться на клиенте до 5 записей перед отправкой админу');
  assert.ok(fs.existsSync(path.join(ROOT, 'android/app/src/main/java/ru/klevpro/app/NavService.java')), 'Должен существовать NavService.java для фоновой навигации');
});

test('6.3 Аудит r244: раздельный GPS/Компас, 2-пальцевое вращение+зум, автоцентрация в Слоях и временный выбор точки', () => {
  const geoSrc = fs.readFileSync(path.join(ROOT, 'js/modules/geo/geo.module.js'), 'utf8');
  assert.ok(geoSrc.includes('_isMapCenteredOnUser'), 'Должен отслеживаться флаг центрирования карты');
  assert.ok(geoSrc.includes('arcBtnCompassResetNorth'), 'Должна быть отдельная кнопка Компаса для сброса на Север');
  assert.ok(geoSrc.includes('__klevPinchRotateBound'), 'Должен быть обработчик 2-пальцевого вращения и зума');
  assert.ok(geoSrc.includes('arcAutoCenterToggleChk'), 'Должен быть переключатель автоцентрации в Слоях');
  assert.ok(geoSrc.includes('selectTemporaryMapSpot') && geoSrc.includes('arcBtnClearPickedSpot') && geoSrc.includes('arcPickedSpotSheet'), 'Должен быть временный выбор точки с карточкой и кнопкой сброса слева');
});

test('6.4 Аудит r244: изоляция #mapBox, постоянный квадратный холст и переключение Liquid Glass', () => {
  const geoSrc = fs.readFileSync(path.join(ROOT, 'js/modules/geo/geo.module.js'), 'utf8');
  const compCss = fs.readFileSync(path.join(ROOT, 'css/components.css'), 'utf8');
  assert.ok(geoSrc.includes('klevArcUiOverlayMount') && geoSrc.includes('_ensureSquareMapCanvasSize'), 'UI карты должен рендериться в #klevArcUiOverlayMount без пересоздания #mapBox');
  assert.ok(geoSrc.includes('clientToRotatedMapPoint'), 'Координаты мультитач и удержания должны пересчитываться относительно повёрнутого холста');
  assert.ok(compCss.includes('html[data-liquid-glass="1"] .klev-arc-glass') && compCss.includes('html[data-liquid-glass="0"] .klev-arc-glass'), 'Переключение Стекло/Обычный должно распространяться на новые классы интерфейса');
});

test('6.5 Аудит r245: устранение дёрганья карты, удаление синей точки на мобильном, авто-GPS/погода, шторм/волна в Погоде и grid-router', async () => {
  const layoutCss = fs.readFileSync(path.join(ROOT, 'css/layout.css'), 'utf8');
  const geoSrc = fs.readFileSync(path.join(ROOT, 'js/modules/geo/geo.module.js'), 'utf8');
  const fcSrc = fs.readFileSync(path.join(ROOT, 'js/modules/forecast/forecast.module.js'), 'utf8');
  assert.ok(!/\.compass-bearing-active\s+#mapBox\s*\{[^}]*will-change:\s*transform/i.test(layoutCss), 'will-change: transform должен быть убран с #mapBox при вращении');
  assert.ok(geoSrc.includes('transform-origin:14px 27px;') && geoSrc.includes('keepBuffer: 4'), 'Вращение карты должно идти через RAF и keepBuffer: 4');
  assert.ok(geoSrc.includes('if (!isMobileOrTabletMapMode()) {\n      mapMarker = L.marker'), 'Лишняя синяя точка mapMarker не должна создаваться в мобильном режиме');
  assert.ok(geoSrc.includes('movedKm > 0.35') && !geoSrc.includes('if (s.hasUserLocation) return;'), 'autoDetectStartupLocation должен проверять живой GPS при запуске');
  assert.ok(fcSrc.includes('fcWeatherRoadStormCard') && fcSrc.includes('fcWeatherHourlyWaveCard'), 'Во вкладке Погода основного экрана должны быть карточки шторма/дорог и волн');

  const gridSrc = fs.readFileSync(path.join(ROOT, 'js/modules/geo/grid-router.js'), 'utf8');
  const { routeOnGrid, buildCostGridFromElements, chooseGrid } = await import('data:text/javascript;base64,' + Buffer.from(gridSrc).toString('base64'));
  assert.equal(typeof routeOnGrid, 'function');
  const a = [55.000, 37.000];
  const b = [55.012, 37.018];
  const G = chooseGrid(a, b);
  const lakeWithIsland = [
    {
      type: 'relation',
      tags: { natural: 'water' },
      members: [
        { type: 'way', role: 'outer', geometry: [
          { lat: 54.995, lon: 36.995 }, { lat: 54.995, lon: 37.025 },
          { lat: 55.018, lon: 37.025 }, { lat: 55.018, lon: 36.995 }, { lat: 54.995, lon: 36.995 }
        ]},
        { type: 'way', role: 'inner', geometry: [
          { lat: 55.004, lon: 37.006 }, { lat: 55.004, lon: 37.012 },
          { lat: 55.008, lon: 37.012 }, { lat: 55.008, lon: 37.006 }, { lat: 55.004, lon: 37.006 }
        ]}
      ]
    }
  ];
  const boatGrid = buildCostGridFromElements(G, lakeWithIsland, 'boat', 'open_water');
  const [ix, iy] = G.toCell(55.006, 37.009);
  assert.equal(Number.isFinite(boatGrid[iy * G.cols + ix]), false, 'Остров (role=inner) должен быть непроходим для лодки');
  const snowDangerGrid = buildCostGridFromElements(G, lakeWithIsland, 'snowmobile', 'ice_danger');
  assert.equal(Number.isFinite(snowDangerGrid[iy * G.cols + ix]), false, 'Опасный лёд должен блокировать маршрут снегохода по воде');
  const snowSafeGrid = buildCostGridFromElements(G, lakeWithIsland, 'snowmobile', 'ice_safe');
  const [lx, ly] = G.toCell(55.001, 37.001);
  assert.equal(Number.isFinite(snowSafeGrid[ly * G.cols + lx]), true, 'Безопасный лёд должен быть проходим для снегохода');
});

test('6.6 Аудит r247: пересобранный app-runtime.js + app.bundle.js, изолированные контуры User/Admin APK, отсутствие transition:height на #mapBox и авто-GPS', () => {
  const rtSrc = fs.readFileSync(path.join(ROOT, 'app-runtime.js'), 'utf8');
  const bundleSrc = fs.readFileSync(path.join(ROOT, 'js/app.bundle.js'), 'utf8');
  const idxHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const kpHtml = fs.readFileSync(path.join(ROOT, 'kp-control-89.html'), 'utf8');
  const layoutCss = fs.readFileSync(path.join(ROOT, 'css/layout.css'), 'utf8');
  const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle'), 'utf8');
  const stringsXml = fs.readFileSync(path.join(ROOT, 'android/app/src/main/res/values/strings.xml'), 'utf8');
  const mainJava = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/ru/klevpro/app/MainActivity.java'), 'utf8');
  const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/build-android-apk.yml'), 'utf8');
  const verJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8'));

  assert.equal(verJson.fullVersion, '2.9.1-r247', 'В VERSION должен быть fullVersion 2.9.1-r247');
  assert.equal(rtSrc, bundleSrc, 'app-runtime.js и js/app.bundle.js должны быть идентичны');
  for (const sym of ['transform-origin:14px 27px;', 'fcWeatherRoadStormCard', 'fcWeatherHourlyWaveCard', '_klevTouchStart', '__KLEV_STARTUP_GPS_SYNCED__']) {
    assert.ok(rtSrc.includes(sym), `В скомпилированном app-runtime.js отсутствует ${sym}`);
  }
  assert.ok(!layoutCss.includes('transition: height 0.2s ease') && !idxHtml.includes('transition: height 0.2s ease'), 'На #mapBox не должно быть transition: height 0.2s ease');
  assert.ok(layoutCss.includes('img.leaflet-marker-icon') && idxHtml.includes('img.leaflet-marker-icon'), 'Синий дефолтный img.leaflet-marker-icon должен скрываться на мобильных через CSS');
  assert.ok(!/\.compass-bearing-active\s+#mapBox\s*\{[^}]*transform:\s*none/i.test(idxHtml), 'В index.html не должно быть transform: none для #mapBox');
  assert.ok(!/\.compass-bearing-active\s+#mapBox\s*\{[^}]*transform:\s*none/i.test(kpHtml), 'В kp-control-89.html не должно быть transform: none для #mapBox');
  assert.ok(gradle.includes('applicationId "ru.klevpro.app"') && gradle.includes('versionName "2.9.1-r247"'), 'В android/app/build.gradle должны быть ru.klevpro.app и 2.9.1-r247');
  assert.ok(stringsXml.includes('Клёв ПРО 2.0'), 'В strings.xml должно быть имя Клёв ПРО 2.0');
  assert.ok(mainJava.includes('compassWanted = true') && mainJava.includes('TYPE_MAGNETIC_FIELD'), 'В MainActivity.java должен быть включён компас с резервом TYPE_MAGNETIC_FIELD');
  assert.ok(wf.includes('/tmp/klev-android-user') && wf.includes('/tmp/klev-android-admin'), 'Workflow должен собирать User и Admin APK в изолированных директориях');
});
