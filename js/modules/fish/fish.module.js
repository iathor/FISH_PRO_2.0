import { RU } from '../../i18n/ru.js?v=2.0.15';
import { events } from '../../core/events.js?v=2.0.15';
import { store } from '../../core/store.js?v=2.0.15';
import { BASIN_CONFIGS, detectBasinByCoords, isCoastalInBasin } from '../../data/basins.js?v=2.0.15';
import { WATER_PROFILES, getAvailableWaterTypes } from '../../data/waters.js?v=2.0.15';
import { RUSSIA_CITIES, findNearestRussianSettlement, getNearestRussianWaters } from '../../data/russia-waters.js?v=2.0.15';
import { FISH_DB } from '../../data/species.js?v=2.0.15';
import { renderFishVisual, renderFiveFish } from '../../ui/svg.js?v=2.0.15';
import { createPill, showToast, openModal, closeModal, openFishLightbox } from '../../ui/components.js?v=2.0.15';
import { setLocation, detectUserPosition } from '../geo/geo.module.js?v=2.0.15';
import { calcDayBest } from '../forecast/forecast.module.js?v=2.0.15';

/**
 * Региональные приоритетные виды для каждого бассейна РФ,
 * чтобы самые популярные и характерные для региона виды (например, Елец и Пелядь/Сырок в Новом Уренгое)
 * всегда находились на видном месте в начале списка.
 */
const REGIONAL_SIGNATURE_SPECIES = {
  arctic_ob_taz: ['pike', 'perch', 'dace', 'peled', 'chir', 'pizhyan', 'ide', 'roach', 'crucian', 'burbot', 'grayling', 'tugun', 'cisco', 'ruffe', 'smelt'],
  yenisei_lena: ['pike', 'perch', 'grayling', 'lenok', 'dace', 'peled', 'chir', 'pizhyan', 'tugun', 'valek', 'ide', 'roach', 'crucian', 'burbot', 'char'],
  volga_caspian: ['pike', 'perch', 'zander', 'bream', 'roach', 'crucian', 'carp', 'chub', 'asp', 'ide', 'white_bream', 'catfish', 'chekhon', 'dace', 'tench', 'rudd', 'bleak'],
  nw_karelia: ['pike', 'perch', 'zander', 'whitefish', 'grayling', 'trout', 'roach', 'bream', 'ide', 'dace', 'burbot', 'vendace', 'smelt', 'salmon'],
  barents_white: ['cod', 'salmon', 'trout', 'char', 'grayling', 'whitefish', 'pike', 'perch', 'dace', 'burbot', 'navaga', 'flounder', 'haddock', 'saithe', 'halibut'],
  baltic: ['pike', 'perch', 'zander', 'bream', 'roach', 'smelt', 'flounder', 'cod', 'garfish', 'vimba', 'white_bream', 'ide', 'dace', 'tench'],
  black_azov: ['pike', 'perch', 'zander', 'carp', 'crucian', 'bream', 'taran', 'roach', 'chub', 'sea_bass', 'horse_mackerel', 'mullet', 'red_mullet', 'garfish', 'goby'],
  euro_west: ['pike', 'perch', 'zander', 'bream', 'crucian', 'carp', 'roach', 'chub', 'asp', 'ide', 'dace', 'tench', 'rudd', 'white_bream', 'catfish'],
  baikal: ['baikal_grayling', 'omul', 'lenok', 'pike', 'perch', 'dace', 'roach', 'ide', 'crucian', 'burbot', 'char', 'peled'],
  amur: ['pike', 'amur_pike', 'snakehead', 'sky_gazer', 'carp', 'crucian', 'amur_catfish', 'lenok', 'grayling', 'tarpon_carp', 'parabramis', 'grass_carp'],
  pacific_sea: ['coho_salmon', 'chum_salmon', 'pink_salmon', 'char', 'dolly_varden', 'cherry_salmon', 'chinook_salmon', 'sockeye_salmon', 'kundzha', 'smelt', 'navaga', 'greenling', 'starry_flounder', 'halibut']
};

export function normalizeSearchText(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[-()/.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchesFishQuery(fish, rawQuery) {
  const q = normalizeSearchText(rawQuery);
  if (!q) return true;
  const tokens = q.split(' ').filter(Boolean);
  const haystack = normalizeSearchText([
    fish.name,
    fish.latin || '',
    ...(Array.isArray(fish.aliases) ? fish.aliases : []),
    fish.id || ''
  ].join(' '));
  return tokens.every(tok => haystack.includes(tok));
}

export function pickBestDefaultFish(regionalList) {
  const list = regionalList && regionalList.length ? regionalList : FISH_DB;
  const curMonth = new Date().getMonth();
  const sorted = [...list]
    .filter(f => f.legal !== 'redbook')
    .sort((a, b) => (b.monthActivity[curMonth] || 0) - (a.monthActivity[curMonth] || 0));
  return sorted[0]?.id || list[0]?.id || 'pike';
}

export function getFilteredFishList(state) {
  const s = state || store.getState();
  const q = normalizeSearchText(s.fishSearch || "");
  const isSearching = q.length > 0;
  const radiusKm = s.waterRadiusKm === 120 ? 120 : 50;
  const day = (s.weatherDays && (s.weatherDays[s.dayIdx] || s.weatherDays[2] || s.weatherDays[0])) || null;

  // Определяем все типы водоёмов, реально присутствующие в радиусе 50 км или 120 км вокруг выбранной точки
  const nearbyWatersList = (Array.isArray(s.nearbyWaters) && s.nearbyWaters.length > 0)
    ? s.nearbyWaters.filter(w => !Number.isFinite(w.distKm) || w.distKm <= radiusKm + 5)
    : getNearestRussianWaters(s.lat, s.lon, s.basinCode, s.isCoastal, 14, radiusKm);
  const radiusWaterTypes = new Set(nearbyWatersList.map(w => w.wType));
  radiusWaterTypes.add(s.water);

  // Региональная проверка: быстрые горные реки Черноморского побережья Кавказа (Мзымта, Сочи)
  const isCaucasianMountainStream = s.basinCode === "black_azov" &&
    s.lat <= 44.6 && s.lat >= 43.3 && s.lon >= 38.5 && s.lon <= 40.5 &&
    (s.water === "small_river" || (s.selectedWaterName || "").toLowerCase().includes("мзымта"));

  // Широтные и ареальные зоны по точным координатам локации (Пункт 8a)
  const isFarNorth = s.lat >= 63.5;
  const isWarmSouth = s.lat <= 50.5;
  const hasCoolingInRadius = s.water === "cooling_reservoir" || radiusWaterTypes.has("cooling_reservoir");
  const hasSeaOrEstuaryInRadius = s.isCoastal || s.water === "sea_gulf" || s.water === "open_sea" || radiusWaterTypes.has("sea_gulf") || radiusWaterTypes.has("open_sea");

  let list;
  if (isSearching) {
    const basinMatches = FISH_DB.filter(f => f.basins.includes(s.basinCode) && matchesFishQuery(f, q));
    list = basinMatches.length > 0
      ? basinMatches
      : FISH_DB.filter(f => matchesFishQuery(f, q));
  } else {
    list = s.showAllSpecies
      ? [...FISH_DB]
      : FISH_DB.filter(f => {
          const basinMatch = f.basins.includes(s.basinCode);
          if (!basinMatch) return false;

          // Проверка соответствия выбранному типу водоёма и водоёмам в радиусе 50/120 км (Пункт 8a, 8c)
          const fishWaters = Array.isArray(f.waters) ? f.waters : ["small_river", "big_river", "quarry", "tundra_lake"];
          let waterMatch = fishWaters.includes(s.water);

          // В радиусе 120 км дополнительно учитываем смежные речные и озёрные биотопы радиуса (например, заход из крупной реки в приток или старицу)
          if (!waterMatch && radiusKm >= 120) {
            const isFreshContext = s.water !== "open_sea" && s.water !== "sea_gulf";
            if (isFreshContext && f.habitat === "fresh" && fishWaters.some(wt => radiusWaterTypes.has(wt))) {
              waterMatch = true;
            }
          }

          // Для морских рыб в пресных реках оставляем только те виды, которые реально заходят в реки (riverEntry: корюшка, навага, лососи, камбала-глосса, пеленгас, кутум, вобла, тарань, рыбец, омуль, ряпушка)
          if (f.habitat === "sea" && s.water !== "sea_gulf" && s.water !== "open_sea") {
            if (!f.riverEntry) return false;
            if (!hasSeaOrEstuaryInRadius && radiusKm < 120 && !["smelt", "salmon", "pink_salmon", "chum_salmon", "coho_salmon", "sockeye_salmon", "chinook_salmon", "cherry_salmon", "vobla", "taran", "vimba", "kutum", "cisco", "omul_arctic", "goby"].includes(f.id)) {
              return false;
            }
          }

          // Теплолюбивые вселенцы (тиляпия, канальный сомик, буффало) обитают в тёплых сбросах ГРЭС/АЭС или южных водоёмах
          if (f.legal === "introduced" && !hasCoolingInRadius && !isWarmSouth) {
            if (!["carp", "silver_carp", "grass_carp", "crucian", "rainbow_trout"].includes(f.id)) return false;
          }

          // На Крайнем Севере (ЯНАО, Таймыр, lat >= 63.5) вне тёплых сбросов ГРЭС исключаем южных теплолюбивых рыб
          if (isFarNorth && !hasCoolingInRadius && ["catfish", "carp", "silver_carp", "grass_carp", "tench", "chub", "asp", "rudd", "bleak"].includes(f.id)) {
            return false;
          }

          if (isCaucasianMountainStream && ["pike", "perch", "zander", "bream"].includes(f.id)) {
            return false;
          }

          return waterMatch;
        });

    if (s.onlyFavoritesFilter) {
      const favSet = new Set(s.favorites || []);
      list = list.filter(f => favSet.has(f.id));
    }

    if (s.fishGroup && s.fishGroup !== "all") {
      list = list.filter(f => f.group === s.fishGroup);
    }
  }

  const favSet = new Set(s.favorites || []);
  const sigOrder = REGIONAL_SIGNATURE_SPECIES[s.basinCode] || [];
  const sigMap = new Map(sigOrder.map((id, idx) => [id, idx]));

  // Предварительно вычисляем вероятность поимки (максимальный вылов в выбранной локации и радиусе — Пункт 8b)
  const scoreCache = new Map();
  if (day) {
    for (const f of list) {
      const baseSc = calcDayBest(f, day, s.method, s.water, s.depth, s.normPress, s.iceState);
      // Учитываем региональную численность вида в радиусе 50/120 км (характерные виды водоёма получают бонус плотности популяции)
      const sigIdx = sigMap.has(f.id) ? sigMap.get(f.id) : -1;
      const abundanceBonus = sigIdx >= 0 ? Math.max(2, 12 - Math.floor(sigIdx * 0.7)) : 0;
      const directWaterBonus = (Array.isArray(f.waters) && f.waters.includes(s.water)) ? 4 : 0;
      scoreCache.set(f.id, baseSc + abundanceBonus + directWaterBonus);
    }
  }

  list.sort((a, b) => {
    // 1. Точное совпадение начала названия при поиске
    if (isSearching) {
      const aStarts = normalizeSearchText(a.name).startsWith(q) ? 1 : 0;
      const bStarts = normalizeSearchText(b.name).startsWith(q) ? 1 : 0;
      if (aStarts !== bStarts) return bStarts - aStarts;
    }
    // 2. Избранные пользователем рыбы всегда первыми
    const aFav = favSet.has(a.id) ? 1 : 0;
    const bFav = favSet.has(b.id) ? 1 : 0;
    if (aFav !== bFav) return bFav - aFav;

    // 3. Разрешённые виды выше краснокнижных (чтобы вверху стояли виды с максимальным разрешённым выловом)
    const aRed = a.legal === "redbook" ? 1 : 0;
    const bRed = b.legal === "redbook" ? 1 : 0;
    if (aRed !== bRed) return aRed - bRed;

    // 4. Сортировка по максимально возможному вылову и вероятности поимки в локации (Пункт 8b)
    const aScore = scoreCache.get(a.id) ?? 50;
    const bScore = scoreCache.get(b.id) ?? 50;
    if (Math.abs(bScore - aScore) >= 3) return bScore - aScore;

    // 5. Региональный приоритет характерных видов бассейна
    const aSig = sigMap.has(a.id) ? sigMap.get(a.id) : 999;
    const bSig = sigMap.has(b.id) ? sigMap.get(b.id) : 999;
    if (aSig !== bSig) return aSig - bSig;

    return bScore - aScore;
  });

  return list;
}

/**
 * Ревизия 2.0.15 (Пункты 1a, 1b, 1c, 1d, 1e):
 * - 1a: Изображение рыбы увеличено до удобного полноширинного баннера в верхней части карточки (розовая рамка).
 * - 1b: Названия, латынь, народные названия и пилл статуса смещены вниз под изображение рыбы (без обрезания текста).
 * - 1c: Кнопка «Закрыть» перенесена вниз формы и закреплена на нижней полосе (sticky footer) рядом с кнопкой «🎣 Я поймал».
 * - 1d: При нажатии на рыбку открывается полноразмерное изображение, подогнанное под экран (50% по горизонтали на ПК, во весь экран на смартфоне).
 * - 1e: Заголовок формы «Справка ихтиолога» не дублирует наименование рыбы.
 */
export function openFishDetail(fishId) {
  const f = FISH_DB.find(x => x.id === fishId);
  if (!f) return;
  const isRed = f.legal === "redbook";
  const isLic = f.legal === "license";
  const spawnMonthsText = (f.spawnMonth || []).map(m => RU.monthsShort[m - 1]).join(", ") || "По прогреву воды";
  const aliasesText = Array.isArray(f.aliases) && f.aliases.length > 0
    ? f.aliases.slice(0, 6).join(", ")
    : "";

  const visualHtml = renderFishVisual(f);

  const html = `
    <div class="fish-detail-modal-content" style="display:flex;flex-direction:column;gap:12px;padding-bottom:6px;">
      <!-- Верхний блок: крупная картинка рыбы в розовой рамке (1a) и смещённые под неё названия (1b) -->
      <div class="fish-detail-header">
        <div class="fish-detail-img-banner" id="detailFishImgZoomBtn" role="button" tabindex="0" aria-label="Увеличить изображение ${f.name}" title="Нажмите для полноразмерного просмотра">
          ${visualHtml}
          <span class="fish-detail-zoom-hint">🔍 Нажмите для увеличения</span>
        </div>
        <div class="fish-detail-title-col">
          <div style="font-size:var(--fs-lg);font-weight:800;line-height:1.22;color:var(--text);">${f.name}</div>
          <div style="font-size:var(--fs-xs);color:var(--muted);font-style:italic;">${f.latin || ""}</div>
          ${aliasesText ? `<div style="font-size:var(--fs-xs);color:var(--accent);margin-top:2px;">Народные названия: <b>${aliasesText}</b></div>` : ""}
          <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
            ${isRed
              ? createPill({ text: "⛔ Красная книга • Поймал — отпусти", tone: "bad" })
              : (isLic
                  ? createPill({ text: "🎫 По путёвке / Лицензионный вид", tone: "warn" })
                  : (f.legal === "introduced"
                      ? createPill({ text: "⚡ Вселенец / Аквакультура", tone: "purple" })
                      : createPill({ text: "✅ Свободный любительский лов", tone: "good" })))}
          </div>
        </div>
      </div>

      <!-- Памятка рыболову -->
      ${f.handlingAdvice ? `
        <div class="card" style="padding:12px;border-radius:var(--r-sm);background:${isRed ? "var(--pill-bad-bg)" : (isLic ? "var(--pill-warn-bg)" : "rgba(56,189,248,0.10)")};border:1.5px solid ${isRed ? "var(--bad)" : (isLic ? "var(--warn)" : "var(--accent)")};color:${isRed ? "var(--pill-bad-text)" : "var(--text)"};font-size:var(--fs-sm);line-height:1.45;">
          <div style="font-weight:800;margin-bottom:4px;">
            ${isRed ? "🚨 ВНИМАНИЕ! КРАСНАЯ КНИГА — ЧТО ДЕЛАТЬ ПРИ ПОИМКЕ:" : (isLic ? "⚖️ ПРАВИЛА ЛИЦЕНЗИОННОГО ЛОВА И ОБРАЩЕНИЯ С РЫБОЙ:" : "💡 ПРАКТИЧЕСКАЯ ПАМЯТКА РЫБОЛОВУ:")}
          </div>
          <div>${f.handlingAdvice}</div>
        </div>
      ` : ""}

      <!-- Ключевые параметры ихтиологии -->
      <div class="fish-detail-stats-grid">
        <div class="card" style="background:var(--card);padding:10px 12px;">
          <div style="font-size:var(--fs-xs);color:var(--muted);font-weight:700;">Оптимальная температура воды</div>
          <div style="font-weight:800;font-size:var(--fs-sm);margin-top:3px;">${f.tWaterOpt[0]}–${f.tWaterOpt[1]} °C (оцепенение при ${f.tMinStop} °C)</div>
        </div>
        <div class="card" style="background:var(--card);padding:10px 12px;">
          <div style="font-size:var(--fs-xs);color:var(--muted);font-weight:700;">Рабочая глубина стоянки</div>
          <div style="font-weight:800;font-size:var(--fs-sm);margin-top:3px;">${f.depthOpt[0]}–${f.depthOpt[1]} м (макс. до ${f.depthMax} м)</div>
        </div>
        <div class="card" style="background:var(--card);padding:10px 12px;">
          <div style="font-size:var(--fs-xs);color:var(--muted);font-weight:700;">Сроки нереста</div>
          <div style="font-weight:800;font-size:var(--fs-sm);margin-top:3px;">${spawnMonthsText}</div>
        </div>
        <div class="card" style="background:var(--card);padding:10px 12px;">
          <div style="font-size:var(--fs-xs);color:var(--muted);font-weight:700;">Правила рыболовства</div>
          <div style="font-weight:800;font-size:var(--fs-sm);margin-top:3px;">${f.banMonths}</div>
        </div>
      </div>

      ${f.sizeInfo ? `
        <div class="card" style="background:var(--card);padding:11px 12px;font-size:var(--fs-sm);line-height:1.45;">
          <div style="font-size:var(--fs-xs);font-weight:800;color:var(--accent);text-transform:uppercase;margin-bottom:3px;">📏 Размеры в уловах и трофейный потенциал</div>
          <div>${f.sizeInfo}</div>
        </div>
      ` : ""}

      ${f.idTraits ? `
        <div class="card" style="background:var(--card);padding:11px 12px;font-size:var(--fs-sm);line-height:1.45;">
          <div style="font-size:var(--fs-xs);font-weight:800;color:var(--accent);text-transform:uppercase;margin-bottom:3px;">🔍 Как распознать вид (отличительные признаки)</div>
          <div>${f.idTraits}</div>
        </div>
      ` : ""}

      <div class="card" style="background:var(--card);padding:12px;font-size:var(--fs-sm);line-height:1.48;display:flex;flex-direction:column;gap:10px;">
        <div>
          <div style="font-size:var(--fs-xs);font-weight:800;color:var(--accent);text-transform:uppercase;margin-bottom:3px;">🌊 Места стоянки, биотопы и сезонные повадки</div>
          <div>${f.baseAdvice}</div>
        </div>
        <div style="padding-top:8px;border-top:1px solid var(--border);">
          <div style="font-size:var(--fs-xs);font-weight:800;color:var(--accent);text-transform:uppercase;margin-bottom:3px;">🎣 Рекомендуемые снасти, оснастки и способы лова</div>
          <div>${f.topGear}</div>
        </div>
        ${f.feedBase ? `
          <div style="padding-top:8px;border-top:1px solid var(--border);">
            <div style="font-size:var(--fs-xs);font-weight:800;color:var(--accent);text-transform:uppercase;margin-bottom:3px;">🪱 Природная кормовая база и рабочие приманки</div>
            <div>${f.feedBase}</div>
          </div>
        ` : ""}
      </div>
    </div>
  `;

  // Нижняя закреплённая полоса (Пункт 1c): кнопка «Я поймал» и рядом кнопка «Закрыть»
  const stickyFooterHtml = `
    ${!isRed ? `<button type="button" class="btn btn-good" id="detailCatchFishBtn" style="flex:1.4;">🎣 Я поймал</button>` : ""}
    <button type="button" class="btn" id="detailBottomCloseBtn" data-modal-close style="flex:1;">✕ Закрыть</button>
  `;

  // Заголовок формы без дублирования названия рыбы (Пункт 1e)
  openModal("Справка ихтиолога", html, (bodyEl, footerEl) => {
    const zoomBox = bodyEl?.querySelector("#detailFishImgZoomBtn");
    if (zoomBox) {
      const triggerZoom = () => openFishLightbox(f.name, f.latin || "", renderFishVisual(f));
      zoomBox.addEventListener("click", triggerZoom);
      zoomBox.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          triggerZoom();
        }
      });
    }

    const catchBtn = (footerEl || bodyEl)?.querySelector("#detailCatchFishBtn");
    if (catchBtn) {
      catchBtn.addEventListener("click", () => {
        store.dispatch({ type: "SET_FISH", payload: f.id });
        closeModal();
        const st = store.getState();
        events.emit("forecast:hourSelected", { dayIdx: st.dayIdx, hour: st.selectedHour, fishId: f.id });
      });
    }
  }, true, {
    hideTopClose: true,
    footerHtml: stickyFooterHtml
  });
}

export function openFavoritesEditorModal() {
  const s = store.getState();
  const favSet = new Set(s.favorites || []);
  const regional = FISH_DB.filter(f => f.basins.includes(s.basinCode));

  const sorted = [...regional].sort((a, b) => {
    const aFav = favSet.has(a.id) ? 1 : 0;
    const bFav = favSet.has(b.id) ? 1 : 0;
    if (aFav !== bFav) return bFav - aFav;
    return a.name.localeCompare(b.name, 'ru');
  });

  const html = `
    <div style="display:flex;flex-direction:column;gap:10px;font-size:var(--fs-sm);">
      <p style="color:var(--muted);font-size:var(--fs-xs);">
        Отметьте целевые виды рыб. По умолчанию список избранного пуст — добавьте сюда только те виды, на которые вы реально охотитесь.
      </p>

      <input type="search" id="favModalSearch" class="input" placeholder="🔍 Быстрый поиск рыбы (елец, сырок, щука, судак, чир...)" style="min-height:40px;padding:6px 12px;font-size:var(--fs-sm);">

      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button type="button" class="btn btn-sm ${s.onlyFavoritesFilter ? 'btn-accent' : ''}" id="favModalToggleFilterBtn">
          ${s.onlyFavoritesFilter ? '✅ Включён фильтр «Только избранные»' : '🔍 Показать на ленте только избранные'}
        </button>
        <button type="button" class="btn btn-sm" id="favModalClearAllBtn">
          🗑️ Очистить избранное
        </button>
      </div>

      <div id="favModalList" style="max-height:320px;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:6px;padding:4px 0;">
        ${sorted.map(f => {
          const checked = favSet.has(f.id);
          const searchStr = normalizeSearchText(`${f.name} ${f.latin || ''} ${(f.aliases || []).join(' ')}`);
          return `
            <label class="fav-item-label" data-fav-id="${f.id}" data-fav-name="${searchStr}" style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--card);border:1px solid ${checked ? 'var(--accent)' : 'var(--border)'};border-radius:var(--r-sm);cursor:pointer;font-size:var(--fs-xs);font-weight:700;">
              <input type="checkbox" value="${f.id}" class="fav-edit-chk" ${checked ? 'checked' : ''}>
              <span>${checked ? '⭐ ' : ''}${f.name}</span>
            </label>
          `;
        }).join('')}
      </div>

      <button type="button" class="btn btn-accent" id="favModalSaveBtn">💾 Сохранить список избранного</button>
    </div>
  `;

  openModal('⭐ Избранные виды рыб', html, (bodyEl) => {
    const searchInput = bodyEl.querySelector('#favModalSearch');
    const items = bodyEl.querySelectorAll('.fav-item-label');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const query = normalizeSearchText(e.target.value || '');
        items.forEach(el => {
          const name = el.getAttribute('data-fav-name') || '';
          el.style.display = (!query || name.includes(query)) ? 'flex' : 'none';
        });
      });
    }

    const clearBtn = bodyEl.querySelector('#favModalClearAllBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        bodyEl.querySelectorAll('.fav-edit-chk').forEach(chk => { chk.checked = false; });
      });
    }

    const filterBtn = bodyEl.querySelector('#favModalToggleFilterBtn');
    if (filterBtn) {
      filterBtn.addEventListener('click', () => {
        store.dispatch({ type: 'TOGGLE_ONLY_FAVORITES' });
        closeModal();
      });
    }

    const saveBtn = bodyEl.querySelector('#favModalSaveBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        const selected = Array.from(bodyEl.querySelectorAll('.fav-edit-chk:checked')).map(el => el.value);
        store.dispatch({ type: 'SET_FAVORITES_LIST', payload: selected });
        closeModal();
        showToast(selected.length ? `Список избранного обновлён (${selected.length} видов)` : 'Список избранного очищен', 'good');
      });
    }
  });
}

export function openOnboardingModal(isEditMode = false) {
  const s = store.getState();
  let currentLat = s.lat;
  let currentLon = s.lon;
  let currentBasin = s.basinCode || 'arctic_ob_taz';
  let currentCityName = s.locLabel || s.locAdmin2 || 'Москва';

  const selectedWaters = new Set(
    (s.userProfile?.preferredWaters && s.userProfile.preferredWaters.length)
      ? s.userProfile.preferredWaters
      : [s.water || 'small_river']
  );

  const selectedMethods = new Set(
    (s.userProfile?.preferredMethods && s.userProfile.preferredMethods.length)
      ? s.userProfile.preferredMethods
      : [s.method || 'spin_micro']
  );

  // По умолчанию в стартовой настройке избранных рыб НЕТ (пустой список), пока рыбак сам их не выберет
  const selectedFishes = new Set(
    isEditMode && s.favoritesExplicitlySet ? (s.favorites || []) : []
  );

  const TACKLE_OPTIONS = [
    { val: 'spin_micro', text: '🎣 Нано-джиг / Мормышинг / Ультралайт (0.2–5 г)' },
    { val: 'spin_jig', text: '🎣 Спиннинг джиговый (средний и тяжёлый)' },
    { val: 'spin_lure', text: '🎣 Спиннинг: блёсны и воблеры (твичинг / перекат)' },
    { val: 'bottom', text: '🪵 Донная снасть (фидер / пикер / кормушка)' },
    { val: 'float', text: '🪶 Поплавочная удочка (маховая / в проводку)' },
    { val: 'winter_jig', text: '❄️ Зимняя мормышка / безмотылка' },
    { val: 'winter_lure', text: '❄️ Зимнее блеснение (балансир / виб)' },
    { val: 'fly', text: '🪰 Нахлыст / Бомбарда (мушка / нимфа)' },
    { val: 'sea_rock', text: '⚓ Морской рокфишинг / прибрежный джиг' }
  ];

  function getSortedRegionalSpecies(basin) {
    const sigOrder = REGIONAL_SIGNATURE_SPECIES[basin] || [];
    const sigMap = new Map(sigOrder.map((id, idx) => [id, idx]));
    return FISH_DB
      .filter(f => f.basins.includes(basin) && f.legal !== 'redbook')
      .sort((a, b) => {
        const aSig = sigMap.has(a.id) ? sigMap.get(a.id) : 999;
        const bSig = sigMap.has(b.id) ? sigMap.get(b.id) : 999;
        if (aSig !== bSig) return aSig - bSig;
        return a.name.localeCompare(b.name, 'ru');
      });
  }

  function getModalBodyHtml() {
    const availWaters = getAvailableWaterTypes(currentBasin, currentLat, currentLon);
    const regionalSpecies = getSortedRegionalSpecies(currentBasin);
    const isSeaCoastal = isCoastalInBasin(currentBasin, currentLat, currentLon);

    return `
      <div style="display:flex;flex-direction:column;gap:14px;font-size:var(--fs-sm);">
        <div style="padding:10px 12px;background:rgba(56,189,248,0.12);border:1px solid var(--accent);border-radius:var(--r-sm);">
          <div style="font-weight:800;font-size:var(--fs-md);color:var(--accent);">
            ${isEditMode ? '👤 Профиль рыболова' : '👋 Добро пожаловать в «Клёв ПРО 2.0»!'}
          </div>
          <div style="font-size:var(--fs-xs);color:var(--muted);margin-top:3px;line-height:1.45;">
            ${isEditMode
              ? 'Настройте домашний регион, предпочитаемые биотопы, снасти и список избранных рыб.'
              : 'Укажите ваш регион и предпочтения. Если пропустить настройку («Заполню позже»), список Избранного останется пустым.'}
          </div>
        </div>

        <!-- ШАГ 1: ЛОКАЦИЯ И РЕГИОН -->
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
            <label style="font-weight:800;font-size:var(--fs-xs);color:var(--muted);">ШАГ 1. ВАШ ГОРОД / РЕГИОН ЛОВЛИ</label>
            <button type="button" class="btn btn-sm" id="onbGpsBtn">🎯 Мой GPS</button>
          </div>
          <select id="onbCitySelect" style="width:100%;">
            ${RUSSIA_CITIES.map(c => `
              <option value="${c.lat},${c.lon},${c.name},${c.admin1}" ${(c.name === currentCityName || c.name === s.locLabel) ? 'selected' : ''}>
                📍 ${c.name} (${c.admin1})
              </option>
            `).join('')}
          </select>
          <div id="onbLocHint" style="font-size:var(--fs-xs);color:var(--accent);margin-top:4px;font-weight:700;">
            Бассейн: ${BASIN_CONFIGS[currentBasin]?.name || 'РФ'} ${isSeaCoastal ? '• 🌊 Морское побережье' : '• 💧 Пресноводный бассейн'}
          </div>
        </div>

        <!-- ШАГ 2: ТИПЫ ВОДОЁМОВ -->
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
            <label style="font-weight:800;font-size:var(--fs-xs);color:var(--muted);">ШАГ 2. ТИПЫ ВОДОЁМОВ</label>
            <span style="font-size:var(--fs-xs);color:var(--accent);font-weight:700;">отмечено: <span id="onbWatersCount">${selectedWaters.size}</span></span>
          </div>
          <div id="onbWatersContainer" style="display:flex;flex-wrap:wrap;gap:6px;">
            ${availWaters.map(w => {
              const active = selectedWaters.has(w.id);
              return `<button type="button" class="w-chip ${active ? 'active' : ''}" data-onb-water="${w.id}">
                ${active ? '✓ ' : ''}${w.name}
              </button>`;
            }).join('')}
          </div>
        </div>

        <!-- ШАГ 3: СНАСТИ -->
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
            <label style="font-weight:800;font-size:var(--fs-xs);color:var(--muted);">ШАГ 3. ВАШИ СНАСТИ</label>
            <span style="font-size:var(--fs-xs);color:var(--accent);font-weight:700;">отмечено: <span id="onbMethodsCount">${selectedMethods.size}</span></span>
          </div>
          <div id="onbMethodsContainer" style="display:flex;flex-wrap:wrap;gap:6px;">
            ${TACKLE_OPTIONS.map(m => {
              const active = selectedMethods.has(m.val);
              return `<button type="button" class="w-chip ${active ? 'active' : ''}" data-onb-method="${m.val}">
                ${active ? '✓ ' : ''}${m.text}
              </button>`;
            }).join('')}
          </div>
        </div>

        <!-- ШАГ 4: ЦЕЛЕВЫЕ РЫБЫ В ИЗБРАННОЕ -->
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;flex-wrap:wrap;gap:6px;">
            <label style="font-weight:800;font-size:var(--fs-xs);color:var(--muted);">ШАГ 4. ДОБАВИТЬ РЫБ В ИЗБРАННОЕ (ПО УМОЛЧАНИЮ ПУСТО)</label>
            <div style="display:flex;gap:6px;">
              <button type="button" class="btn btn-sm btn-accent" id="onbSelectTypicalBtn">
                ✨ Характерные рыбы региона
              </button>
              <button type="button" class="btn btn-sm" id="onbClearFishBtn">
                Очистить
              </button>
            </div>
          </div>
          <div id="onbSpeciesChips" style="display:flex;flex-wrap:wrap;gap:6px;max-height:165px;overflow-y:auto;padding:4px 0;">
            ${regionalSpecies.map(f => {
              const active = selectedFishes.has(f.id);
              return `
                <button type="button" class="w-chip ${active ? 'active' : ''}" data-onb-fish="${f.id}">
                  ${active ? '⭐ ' : ''}${f.name}
                </button>
              `;
            }).join('')}
          </div>
        </div>

        <!-- КНОПКИ ВНИЗУ -->
        <div style="display:flex;gap:8px;margin-top:6px;padding-top:10px;border-top:1px solid var(--border);flex-wrap:wrap;">
          <button type="button" class="btn" id="onbLaterBtn" style="flex:1;min-width:140px;">
            Заполню позже
          </button>
          <button type="button" class="btn btn-accent" id="onbSaveBtn" style="flex:2;min-width:210px;">
            ${isEditMode ? '💾 Сохранить профиль' : 'Сохранить профиль и перейти к прогнозу'}
          </button>
        </div>
      </div>
    `;
  }

  openModal(isEditMode ? '👤 Профиль рыболова' : '🚀 Стартовая настройка рыболова', getModalBodyHtml(), (bodyEl) => {
    function bindWaters(container) {
      if (!container) return;
      container.querySelectorAll('[data-onb-water]').forEach(btn => {
        btn.addEventListener('click', () => {
          const wid = btn.getAttribute('data-onb-water');
          if (selectedWaters.has(wid)) {
            if (selectedWaters.size > 1) {
              selectedWaters.delete(wid);
              btn.classList.remove('active');
              btn.textContent = btn.textContent.replace('✓ ', '');
            } else {
              showToast('Должен быть выбран хотя бы один тип водоёма', 'warn');
            }
          } else {
            selectedWaters.add(wid);
            btn.classList.add('active');
            if (!btn.textContent.includes('✓')) btn.textContent = '✓ ' + btn.textContent.trim();
          }
          const cnt = bodyEl.querySelector('#onbWatersCount');
          if (cnt) cnt.textContent = selectedWaters.size;
        });
      });
    }

    function bindMethods(container) {
      if (!container) return;
      container.querySelectorAll('[data-onb-method]').forEach(btn => {
        btn.addEventListener('click', () => {
          const mid = btn.getAttribute('data-onb-method');
          if (selectedMethods.has(mid)) {
            if (selectedMethods.size > 1) {
              selectedMethods.delete(mid);
              btn.classList.remove('active');
              btn.textContent = btn.textContent.replace('✓ ', '');
            } else {
              showToast('Должна быть выбрана хотя бы одна снасть', 'warn');
            }
          } else {
            selectedMethods.add(mid);
            btn.classList.add('active');
            if (!btn.textContent.includes('✓')) btn.textContent = '✓ ' + btn.textContent.trim();
          }
          const cnt = bodyEl.querySelector('#onbMethodsCount');
          if (cnt) cnt.textContent = selectedMethods.size;
        });
      });
    }

    function bindFishChips(container) {
      if (!container) return;
      container.querySelectorAll('[data-onb-fish]').forEach(btn => {
        btn.addEventListener('click', () => {
          const fid = btn.getAttribute('data-onb-fish');
          if (selectedFishes.has(fid)) {
            selectedFishes.delete(fid);
            btn.classList.remove('active');
            btn.textContent = btn.textContent.replace('⭐ ', '');
          } else {
            selectedFishes.add(fid);
            btn.classList.add('active');
            if (!btn.textContent.includes('⭐')) btn.textContent = '⭐ ' + btn.textContent.trim();
          }
        });
      });
    }

    bindWaters(bodyEl.querySelector('#onbWatersContainer'));
    bindMethods(bodyEl.querySelector('#onbMethodsContainer'));
    bindFishChips(bodyEl.querySelector('#onbSpeciesChips'));

    const selectTypicalBtn = bodyEl.querySelector('#onbSelectTypicalBtn');
    if (selectTypicalBtn) {
      selectTypicalBtn.addEventListener('click', () => {
        const regionalSpecies = getSortedRegionalSpecies(currentBasin);
        const typical = regionalSpecies.slice(0, 7).map(f => f.id);
        selectedFishes.clear();
        typical.forEach(id => selectedFishes.add(id));
        const speciesContainer = bodyEl.querySelector('#onbSpeciesChips');
        if (speciesContainer) {
          speciesContainer.querySelectorAll('[data-onb-fish]').forEach(btn => {
            const fid = btn.getAttribute('data-onb-fish');
            const active = selectedFishes.has(fid);
            btn.classList.toggle('active', active);
            btn.textContent = (active ? '⭐ ' : '') + btn.textContent.replace('⭐ ', '').trim();
          });
        }
        showToast(`Отмечено ${typical.length} характерных видов региона`, 'good');
      });
    }

    const clearFishBtn = bodyEl.querySelector('#onbClearFishBtn');
    if (clearFishBtn) {
      clearFishBtn.addEventListener('click', () => {
        selectedFishes.clear();
        const speciesContainer = bodyEl.querySelector('#onbSpeciesChips');
        if (speciesContainer) {
          speciesContainer.querySelectorAll('[data-onb-fish]').forEach(btn => {
            btn.classList.remove('active');
            btn.textContent = btn.textContent.replace('⭐ ', '').trim();
          });
        }
        showToast('Список избранных рыб очищен', 'info');
      });
    }

    const citySelect = bodyEl.querySelector('#onbCitySelect');

    function applyModalLocation(latVal, lonVal, cName, cAdmin, sourceType = 'manual') {
      currentLat = Math.round(latVal * 10000) / 10000;
      currentLon = Math.round(lonVal * 10000) / 10000;
      currentCityName = cName;
      currentBasin = detectBasinByCoords(currentLat, currentLon);

      store.dispatch({
        type: 'SET_LOCATION_LABELS',
        payload: { locLabel: cName, locAdmin1: cAdmin || cName, locAdmin2: cName }
      });
      setLocation(currentLat, currentLon, sourceType === 'manual');

      if (citySelect) {
        const opts = Array.from(citySelect.options);
        const matchOpt = opts.find(o => o.value.split(',')[2] === cName);
        if (matchOpt) {
          citySelect.value = matchOpt.value;
        } else {
          const customVal = `${currentLat},${currentLon},${cName},${cAdmin || 'Россия'}`;
          let customOpt = bodyEl.querySelector('#onbCustomGpsOpt');
          if (!customOpt) {
            customOpt = document.createElement('option');
            customOpt.id = 'onbCustomGpsOpt';
            citySelect.prepend(customOpt);
          }
          customOpt.value = customVal;
          customOpt.textContent = `📍 ${cName} (${cAdmin || 'По геолокации'})`;
          citySelect.value = customVal;
        }
      }

      const isSeaCoastal = isCoastalInBasin(currentBasin, currentLat, currentLon);
      const hint = bodyEl.querySelector('#onbLocHint');
      if (hint) {
        const coordPart = sourceType !== 'manual' ? `📍 ${cName} (${currentLat.toFixed(2)}°N, ${currentLon.toFixed(2)}°E) • ` : '';
        hint.textContent = `${coordPart}Бассейн: ${BASIN_CONFIGS[currentBasin]?.name || 'РФ'} ${isSeaCoastal ? '• 🌊 Морское побережье' : '• 💧 Пресноводный бассейн'}`;
      }

      const availWaters = getAvailableWaterTypes(currentBasin, currentLat, currentLon);
      const validWaterIds = new Set(availWaters.map(w => w.id));
      const filteredWaters = Array.from(selectedWaters).filter(w => validWaterIds.has(w));
      selectedWaters.clear();
      if (filteredWaters.length) {
        filteredWaters.forEach(w => selectedWaters.add(w));
      } else if (availWaters.length) {
        selectedWaters.add(availWaters[0].id);
      }

      const watersContainer = bodyEl.querySelector('#onbWatersContainer');
      if (watersContainer) {
        watersContainer.innerHTML = availWaters.map(w => {
          const active = selectedWaters.has(w.id);
          return `<button type="button" class="w-chip ${active ? 'active' : ''}" data-onb-water="${w.id}">
            ${active ? '✓ ' : ''}${w.name}
          </button>`;
        }).join('');
        bindWaters(watersContainer);
        const cnt = bodyEl.querySelector('#onbWatersCount');
        if (cnt) cnt.textContent = selectedWaters.size;
      }

      const regionalSpecies = getSortedRegionalSpecies(currentBasin);
      const speciesContainer = bodyEl.querySelector('#onbSpeciesChips');
      if (speciesContainer) {
        speciesContainer.innerHTML = regionalSpecies.map(f => {
          const active = selectedFishes.has(f.id);
          return `<button type="button" class="w-chip ${active ? 'active' : ''}" data-onb-fish="${f.id}">
            ${active ? '⭐ ' : ''}${f.name}
          </button>`;
        }).join('');
        bindFishChips(speciesContainer);
      }
    }

    if (citySelect) {
      citySelect.addEventListener('change', (e) => {
        const [latStr, lonStr, cName, cAdmin] = e.target.value.split(',');
        applyModalLocation(parseFloat(latStr), parseFloat(lonStr), cName, cAdmin, 'manual');
      });
    }

    const gpsBtn = bodyEl.querySelector('#onbGpsBtn');
    if (gpsBtn) {
      gpsBtn.addEventListener('click', async () => {
        gpsBtn.textContent = '⏳ Поиск...';
        gpsBtn.disabled = true;
        try {
          const geoRes = await detectUserPosition();
          gpsBtn.disabled = false;
          if (geoRes && Number.isFinite(geoRes.lat) && Number.isFinite(geoRes.lon)) {
            const near = findNearestRussianSettlement(geoRes.lat, geoRes.lon);
            const cName = (near && near.distKm <= 75) ? near.name : (geoRes.city || 'Моя точка');
            const cAdmin = (near && near.distKm <= 75) ? near.admin1 : (geoRes.region || 'Россия');
            applyModalLocation(geoRes.lat, geoRes.lon, cName, cAdmin, geoRes.source);
            gpsBtn.textContent = geoRes.source === 'ip' ? '✅ По сети' : '✅ Найдено';
            if (geoRes.source === 'ip' && geoRes.permissionDenied) {
              showToast(`📍 Доступ к GPS в браузере закрыт — определён город по сети: ${cName}`, 'info');
            } else {
              showToast(`📍 Локация определена: ${cName}`, 'good');
            }
          } else {
            const nearCur = findNearestRussianSettlement(currentLat, currentLon);
            const fallbackName = nearCur ? nearCur.name : currentCityName;
            gpsBtn.textContent = '📍 Выберите в списке';
            const hint = bodyEl.querySelector('#onbLocHint');
            if (hint) {
              hint.textContent = `ℹ️ Доступ к геоданным отключён в настройках браузера (значок 🔒 у адреса сайта). Выберите город в списке выше (сейчас: ${fallbackName}).`;
            }
            showToast('Разрешите доступ к геоданным в браузере или выберите город в списке Шага 1', 'info');
          }
        } catch (e) {
          gpsBtn.disabled = false;
          gpsBtn.textContent = '📍 Выберите в списке';
        }
      });
    }

    // Если настройка пропущена («Заполню позже») — список Избранного гарантированно пустой!
    const laterBtn = bodyEl.querySelector('#onbLaterBtn');
    if (laterBtn) {
      laterBtn.addEventListener('click', () => {
        store.dispatch({
          type: 'SAVE_ONBOARDING',
          payload: {
            water: s.water,
            method: s.method,
            fishId: s.fishId || 'pike',
            targetSpecies: isEditMode ? (s.favorites || []) : []
          }
        });
        closeModal();
        showToast('Профиль сохранён (список Избранного пуст)', 'info');
      });
    }

    const saveBtn = bodyEl.querySelector('#onbSaveBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        const preferredWatersArr = Array.from(selectedWaters);
        const preferredMethodsArr = Array.from(selectedMethods);
        const primaryWater = preferredWatersArr[0] || s.water || 'small_river';
        const primaryMethod = preferredMethodsArr[0] || s.method || 'spin_micro';
        const favArray = Array.from(selectedFishes);
        const regionalSpecies = getSortedRegionalSpecies(currentBasin);
        const targetFish = favArray[0] || s.fishId || regionalSpecies[0]?.id || 'pike';

        store.dispatch({
          type: 'SAVE_ONBOARDING',
          payload: {
            water: primaryWater,
            method: primaryMethod,
            fishId: targetFish,
            targetSpecies: favArray,
            preferredWaters: preferredWatersArr,
            preferredMethods: preferredMethodsArr
          }
        });
        store.dispatch({ type: 'SET_FAVORITES_LIST', payload: favArray });
        store.dispatch({ type: 'SET_WATER', payload: { water: primaryWater, depth: WATER_PROFILES[primaryWater]?.defD || 1.5, selectedWaterName: '' } });
        store.dispatch({ type: 'SET_METHOD', payload: primaryMethod });
        store.dispatch({ type: 'SET_FISH', payload: targetFish });

        closeModal();
        showToast(isEditMode ? 'Профиль рыболова успешно обновлён!' : 'Настройка завершена! Добро пожаловать к прогнозу!', 'good');
      });
    }
  }, isEditMode);
}

/**
 * Рендерит только внутреннюю область карточек рыб (#fishResultsArea),
 * НЕ пересоздавая поле ввода #fishSearchInput, чтобы клавиатура смартфона НИКОГДА не сворачивалась!
 */
function buildFishResultsHtml(s, list) {
  const day = s.weatherDays[s.dayIdx] || s.weatherDays[2] || s.weatherDays[0];
  const curTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const favSet = new Set(s.favorites || []);
  const prof = WATER_PROFILES[s.water] || WATER_PROFILES.small_river;
  const hasSearch = (s.fishSearch || '').trim().length > 0;

  if (list.length === 0) {
    if (hasSearch) {
      return `
        <div style="padding:16px 12px;background:var(--card);border:1px dashed var(--border);border-radius:var(--r-sm);text-align:center;margin:6px 0;">
          <div style="font-size:var(--fs-sm);font-weight:700;color:var(--text);margin-bottom:4px;">
            🔍 По запросу «${s.fishSearch}» рыб не найдено
          </div>
          <div style="font-size:var(--fs-xs);color:var(--muted);margin-bottom:10px;">
            Проверьте написание (например: елец, сырок, пелядь, щука, окунь, хариус, щокур) или сбросьте строку поиска.
          </div>
          <button type="button" class="btn btn-sm btn-accent" id="fishClearSearchBtnEmpty">
            ✕ Очистить поиск
          </button>
        </div>
      `;
    }
    return `
      <div style="padding:16px 12px;background:var(--card);border:1px dashed var(--border);border-radius:var(--r-sm);text-align:center;margin:6px 0;">
        <div style="font-size:var(--fs-sm);font-weight:700;color:var(--text);margin-bottom:4px;">
          ⭐ Ваш список Избранного пока пуст (или этих рыб нет в водоёме)
        </div>
        <div style="font-size:var(--fs-xs);color:var(--muted);margin-bottom:10px;">
          По умолчанию в Избранном нет рыб. Нажмите «☆» на карточке нужной рыбы или отключите фильтр «Избранное», чтобы увидеть все виды биотопа «${prof.shortName}».
        </div>
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
          <button type="button" class="btn btn-sm btn-accent" id="fishResetFavFilterBtn">
            🐟 Показать все рыбы водоёма
          </button>
          <button type="button" class="btn btn-sm" id="fishOpenFavModalEmptyBtn">
            ✎ Выбрать избранных рыб
          </button>
        </div>
      </div>
    `;
  }

  return `
    <div id="fishDockSentinel" style="height:1px;width:100%;pointer-events:none;"></div>
    <div class="fish-strip-placeholder" id="fishStripPlaceholder">
      <div class="fish-strip-dock-wrap" id="fishStripDockWrap">
        <div class="fish-strip" id="mainFishStrip" role="listbox" aria-label="Рыбы в месте ловли">
          ${list.map(f => {
            const isRed = f.legal === 'redbook';
            const isFav = favSet.has(f.id);
            const sc = day ? calcDayBest(f, day, s.method, s.water, s.depth, s.normPress, s.iceState) : 0;
            let badge = '';
            if (isRed) badge = createPill({ text: 'Красная книга', tone: 'bad' });
            else if (f.legal === 'license') badge = createPill({ text: 'По путёвке', tone: 'warn' });
            else if (f.legal === 'introduced') badge = createPill({ text: 'Вселенец', tone: 'purple' });

            return `
              <div class="fish-card ${f.id === s.fishId ? 'active' : ''} ${isRed ? 'redbook-muted' : ''}" data-select-fish="${f.id}" role="option" aria-selected="${f.id === s.fishId}">
                <button type="button" class="fav-btn" data-fav-fish="${f.id}" aria-label="${isFav ? 'Убрать из избранного' : 'В избранное'} ${f.name}">${isFav ? '⭐' : '☆'}</button>
                <div class="fish-img-wrap">${renderFishVisual(f)}</div>
                <div class="fish-name">${f.name}</div>
                <div class="fish-latin">${f.latin || ''}</div>
                <div class="fish-badge-wrap" style="margin:2px 0;">${badge}</div>
                ${renderFiveFish(sc, 14, curTheme, true, isRed ? `Прилов ${sc}% • Отпусти` : null)}
                <button type="button" class="btn btn-sm" style="width:100%;margin-top:6px;" data-info-fish="${f.id}">ℹ️ Подробнее</button>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </div>
  `;
}

function updateFishDynamicParts(container, s, list) {
  const prof = WATER_PROFILES[s.water] || WATER_PROFILES.small_river;
  const hasSearch = (s.fishSearch || '').trim().length > 0;

  const titleEl = container.querySelector('#fishSectionTitleText');
  if (titleEl) {
    titleEl.textContent = `🐟 Рыбы в месте ловли (${list.length} видов)`;
  }

  const subEl = container.querySelector('#fishSectionSubText');
  if (subEl) {
    subEl.textContent = hasSearch
      ? `Результаты поиска по запросу «${s.fishSearch.trim()}»`
      : (s.showAllSpecies
          ? 'Показан полный справочник РФ (все 115 видов)'
          : `Локация (радиус до ${s.waterRadiusKm || 50} км) • ${prof.shortName} • Ранжировано по улову`);
  }

  const favBtn = container.querySelector('#fishFavFilterBtn');
  if (favBtn) {
    favBtn.className = `btn btn-sm ${s.onlyFavoritesFilter ? 'btn-accent' : ''}`;
    favBtn.textContent = `⭐ Избранное (${(s.favorites || []).length})`;
  }

  const showAllBtn = container.querySelector('#fishShowAllBtn');
  if (showAllBtn) {
    showAllBtn.className = `btn btn-sm ${s.showAllSpecies ? 'btn-accent' : ''}`;
    showAllBtn.textContent = s.showAllSpecies ? 'По региону' : 'Весь атлас РФ';
  }

  const clearBtn = container.querySelector('#fishSearchClearBtn');
  if (clearBtn) {
    clearBtn.style.display = hasSearch ? 'inline-flex' : 'none';
  }

  const searchInput = container.querySelector('#fishSearchInput');
  if (searchInput && document.activeElement !== searchInput && searchInput.value !== (s.fishSearch || '')) {
    searchInput.value = s.fishSearch || '';
  }

  container.querySelectorAll('[data-fish-group]').forEach(btn => {
    const gk = btn.getAttribute('data-fish-group');
    btn.classList.toggle('active', s.fishGroup === gk);
  });

  const resultsArea = container.querySelector('#fishResultsArea');
  if (resultsArea) {
    const prevFishScroll = resultsArea.querySelector('.fish-strip')?.scrollLeft || 0;
    resultsArea.innerHTML = buildFishResultsHtml(s, list);
    bindFishResultEvents(container, resultsArea);
    const newFishStrip = resultsArea.querySelector('.fish-strip');
    if (newFishStrip && prevFishScroll > 0) newFishStrip.scrollLeft = prevFishScroll;
  }

  if (typeof window.syncFishDockState === 'function') window.syncFishDockState();
}

export function renderFishStrip(container, state) {
  if (!container) return;
  const s = state || store.getState();
  const list = getFilteredFishList(s);
  const hasSearch = (s.fishSearch || '').trim().length > 0;

  if (!s.fishId || (!hasSearch && !s.onlyFavoritesFilter && !list.some(f => f.id === s.fishId) && list.length > 0)) {
    const nextId = pickBestDefaultFish(list);
    if (nextId && nextId !== s.fishId) {
      setTimeout(() => store.dispatch({ type: 'SET_FISH', payload: nextId }), 0);
    }
  }

  // Если каркас уже отрисован — обновляем ТОЛЬКО результаты и счётчики, не трогая #fishSearchInput!
  if (container.querySelector('#fishSearchInput') && container.querySelector('#fishResultsArea')) {
    updateFishDynamicParts(container, s, list);
    return;
  }

  const prof = WATER_PROFILES[s.water] || WATER_PROFILES.small_river;

  container.innerHTML = `
    <div class="card">
      <div class="section-head" style="margin-bottom:8px;">
        <div>
          <span class="section-title" id="fishSectionTitleText">🐟 Рыбы в месте ловли (${list.length} видов)</span>
          <div id="fishSectionSubText" style="font-size:var(--fs-xs);color:var(--muted);margin-top:2px;">
            ${s.showAllSpecies
              ? 'Показан полный справочник РФ (все 115 видов)'
              : `Локация (радиус до ${s.waterRadiusKm || 50} км) • ${prof.shortName} • Ранжировано по улову`}
          </div>
        </div>
      </div>

      <!-- Кнопки Избранное, Список и По региону / Весь атлас строго в одну строку -->
      <div class="fish-toolbar-onerow">
        <button type="button" class="btn btn-sm ${s.onlyFavoritesFilter ? 'btn-accent' : ''}" id="fishFavFilterBtn">
          ⭐ Избранное (${(s.favorites || []).length})
        </button>
        <button type="button" class="btn btn-sm" id="fishFavEditBtn" title="Редактировать список избранных рыб">
          ✎ Список
        </button>
        <button type="button" class="btn btn-sm ${s.showAllSpecies ? 'btn-accent' : ''}" id="fishShowAllBtn">
          ${s.showAllSpecies ? 'По региону' : 'Весь атлас РФ'}
        </button>
      </div>

      <!-- Строка 1: Полноразмерный поиск с кнопкой очистки (без потери фокуса на смартфонах!) -->
      <div id="fishSearchWrap" style="position:relative;margin-bottom:8px;display:flex;align-items:center;">
        <input type="text" inputmode="search" enterkeyhint="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" id="fishSearchInput" class="input" style="width:100%;min-height:42px;padding:8px 38px 8px 12px;font-size:var(--fs-sm);" placeholder="🔍 Поиск рыбы (елец, сырок, пелядь, щука, окунь, судак...)" value="${s.fishSearch || ''}">
        <button type="button" id="fishSearchClearBtn" aria-label="Очистить поиск" style="display:${hasSearch ? 'inline-flex' : 'none'};position:absolute;right:6px;width:30px;height:30px;border:none;background:var(--card);color:var(--muted);border-radius:999px;align-items:center;justify-content:center;cursor:pointer;font-size:14px;font-weight:800;">✕</button>
      </div>

      <!-- Строка 2: Выбор групп рыб -->
      <div class="chip-scroll-row" id="fishGroupsRow" style="margin-bottom:10px;width:100%;">
        ${Object.entries(RU.groups).map(([gk, gLabel]) => `
          <button type="button" class="w-chip ${s.fishGroup === gk ? 'active' : ''}" data-fish-group="${gk}">${gLabel}</button>
        `).join('')}
      </div>

      <!-- Динамическая область карточек -->
      <div id="fishResultsArea">
        ${buildFishResultsHtml(s, list)}
      </div>
    </div>
  `;

  bindFishStaticEvents(container);
  bindFishResultEvents(container, container.querySelector('#fishResultsArea'));
  if (typeof window.syncFishDockState === 'function') window.syncFishDockState();
}

function bindFishStaticEvents(container) {
  const showAllBtn = container.querySelector('#fishShowAllBtn');
  if (showAllBtn) {
    showAllBtn.addEventListener('click', () => store.dispatch({ type: 'TOGGLE_SHOW_ALL' }));
  }

  const favFilterBtn = container.querySelector('#fishFavFilterBtn');
  if (favFilterBtn) {
    favFilterBtn.addEventListener('click', () => {
      const s = store.getState();
      if (!s.onlyFavoritesFilter && (!s.favorites || s.favorites.length === 0)) {
        showToast('Список Избранного пока пуст. Отметьте звёздочкой «☆» нужных рыб или выберите их в списке!', 'info');
        openFavoritesEditorModal();
        return;
      }
      store.dispatch({ type: 'TOGGLE_ONLY_FAVORITES' });
      const active = store.getState().onlyFavoritesFilter;
      showToast(active ? 'Показаны только избранные виды рыб' : 'Показаны все рыбы водоёма', 'info');
    });
  }

  const favEditBtn = container.querySelector('#fishFavEditBtn');
  if (favEditBtn) {
    favEditBtn.addEventListener('click', () => openFavoritesEditorModal());
  }

  const searchInput = container.querySelector('#fishSearchInput');
  const clearBtn = container.querySelector('#fishSearchClearBtn');

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const val = e.target.value;
      // Мгновенно обновляем состояние в store; благодаря проверке в renderFishStrip
      // сам элемент #fishSearchInput НЕ пересоздается, фокус и клавиатура на телефоне сохраняются!
      store.dispatch({ type: 'SET_FISH_SEARCH', payload: val });
    });
  }

  if (clearBtn && searchInput) {
    clearBtn.addEventListener('click', () => {
      searchInput.value = '';
      store.dispatch({ type: 'SET_FISH_SEARCH', payload: '' });
      searchInput.focus();
    });
  }

  container.querySelectorAll('[data-fish-group]').forEach(btn => {
    btn.addEventListener('click', () => {
      store.dispatch({ type: 'SET_FISH_GROUP', payload: btn.getAttribute('data-fish-group') });
    });
  });
}

function bindFishResultEvents(container, resultsArea) {
  if (!resultsArea) return;

  const resetFavBtn = resultsArea.querySelector('#fishResetFavFilterBtn');
  if (resetFavBtn) {
    resetFavBtn.addEventListener('click', () => {
      store.dispatch({ type: 'TOGGLE_ONLY_FAVORITES' });
      showToast('Фильтр избранного отключён: показаны все рыбы водоёма', 'info');
    });
  }

  const openFavEmptyBtn = resultsArea.querySelector('#fishOpenFavModalEmptyBtn');
  if (openFavEmptyBtn) {
    openFavEmptyBtn.addEventListener('click', () => openFavoritesEditorModal());
  }

  const clearSearchEmptyBtn = resultsArea.querySelector('#fishClearSearchBtnEmpty');
  if (clearSearchEmptyBtn) {
    clearSearchEmptyBtn.addEventListener('click', () => {
      const searchInput = container.querySelector('#fishSearchInput');
      if (searchInput) searchInput.value = '';
      store.dispatch({ type: 'SET_FISH_SEARCH', payload: '' });
    });
  }

  resultsArea.querySelectorAll('[data-select-fish]').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-fav-fish]') || e.target.closest('[data-info-fish]')) return;
      const fid = card.getAttribute('data-select-fish');
      const fishObj = FISH_DB.find(x => x.id === fid);
      store.dispatch({ type: 'SET_FISH', payload: fid });
      if (fishObj && fishObj.legal === 'redbook') {
        openFishDetail(fid);
      }
    });
  });

  resultsArea.querySelectorAll('[data-fav-fish]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const fid = btn.getAttribute('data-fav-fish');
      const fishObj = FISH_DB.find(x => x.id === fid);
      const wasFav = store.getState().favorites.includes(fid);
      store.dispatch({ type: 'TOGGLE_FAVORITE', payload: fid });
      const name = fishObj ? fishObj.name : fid;
      if (wasFav) {
        showToast(`☆ «${name}» убрана из Избранного`, 'info');
      } else {
        showToast(`⭐ «${name}» добавлена в Избранное`, 'good');
      }
    });
  });

  resultsArea.querySelectorAll('[data-info-fish]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openFishDetail(btn.getAttribute('data-info-fish'));
    });
  });
}

export function render(container) {
  renderFishStrip(container, store.getState());
}

let unsub = null;

export function init(container) {
  const s = store.getState();
  if (!s.fishId) {
    const defId = pickBestDefaultFish(getFilteredFishList(s));
    store.dispatch({ type: 'SET_FISH', payload: defId });
  }
  render(container);

  unsub = store.subscribe(
    st => ({
      lat: st.lat,
      lon: st.lon,
      basinCode: st.basinCode,
      water: st.water,
      waterRadiusKm: st.waterRadiusKm,
      nearbyWaters: st.nearbyWaters,
      method: st.method,
      depth: st.depth,
      fishId: st.fishId,
      dayIdx: st.dayIdx,
      showAllSpecies: st.showAllSpecies,
      onlyFavoritesFilter: st.onlyFavoritesFilter,
      fishSearch: st.fishSearch,
      fishGroup: st.fishGroup,
      favorites: st.favorites,
      weatherDays: st.weatherDays,
      theme: st.theme
    }),
    () => render(container)
  );
}

export function destroy() {
  if (unsub) unsub();
}

export const fishModule = {
  normalizeSearchText,
  matchesFishQuery,
  pickBestDefaultFish,
  getFilteredFishList,
  openFishDetail,
  openFavoritesEditorModal,
  openOnboardingModal,
  renderFishStrip,
  init,
  render,
  destroy
};
