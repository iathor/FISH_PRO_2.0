import { RU } from '../../i18n/ru.js?v=2.1.00';
import { events } from '../../core/events.js?v=2.1.00';
import { store } from '../../core/store.js?v=2.1.00';
import { BASIN_CONFIGS, detectBasinByCoords, isCoastalInBasin, getSpotEcoregion, isSpeciesInGeoRange } from '../../data/basins.js?v=2.1.00';
import { WATER_PROFILES, getAvailableWaterTypes } from '../../data/waters.js?v=2.1.00';
import { RUSSIA_CITIES, findNearestRussianSettlement, getNearestRussianWaters } from '../../data/russia-waters.js?v=2.1.00';
import { FISH_DB } from '../../data/species.js?v=2.1.00';
import { renderFishVisual, renderFiveFish } from '../../ui/svg.js?v=2.1.00';
import { createPill, showToast, openModal, closeModal, openFishLightbox } from '../../ui/components.js?v=2.1.00';
import { setLocation, detectUserPosition } from '../geo/geo.module.js?v=2.1.00';
import { installShortcut, isApkOrTmaContainer, isAppInstalledOrShortcutPresent } from '../../core/pwa.js?v=2.1.00';
import {
  openAuthAndBackupModal,
  openNotificationsModal,
  getCurrentFisherIdentity,
  isOwnerAdmin,
  isUserAdmin,
  syncCurrentProfileToCloudIfLoggedIn,
  renderSettingsZoneTabsHtml,
  bindSettingsZoneTabs
} from '../circle/circle.module.js?v=2.1.00';
import { fetchWeather } from '../weather/weather.module.js?v=2.1.00';
import { checkForReleaseUpdate } from '../../core/updater.js?v=2.1.00';
import { calcDayBest } from '../forecast/forecast.module.js?v=2.1.00';

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
  // Список regionalList уже отсортирован по региональной численности, биотопу и вероятности вылова в точке
  const bestFree = list.find(f => f.legal === 'free');
  if (bestFree) return bestFree.id;
  const bestNonRed = list.find(f => f.legal !== 'redbook');
  return bestNonRed?.id || list[0]?.id || 'pike';
}

export function getFilteredFishList(state) {
  const s = state || store.getState();
  const q = normalizeSearchText(s.fishSearch || "");
  const isSearching = q.length > 0;
  const radiusKm = s.waterRadiusKm === 120 ? 120 : 50;
  const day = (s.weatherDays && (s.weatherDays[s.dayIdx] || s.weatherDays[2] || s.weatherDays[0])) || null;

  // Определяем все типы водоёмов, реально присутствующие в радиусе 50 км или 120 км вокруг выбранной точки (с кэшем по координатам)
  let nearbyWatersList;
  if (Array.isArray(s.nearbyWaters) && s.nearbyWaters.length > 0) {
    nearbyWatersList = s.nearbyWaters.filter(w => !Number.isFinite(w.distKm) || w.distKm <= radiusKm + 5);
  } else {
    const wCacheKey = `${Math.round((s.lat || 0) * 100)}_${Math.round((s.lon || 0) * 100)}_${s.basinCode}_${radiusKm}`;
    if (getFilteredFishList._wCacheKey === wCacheKey && getFilteredFishList._wCacheVal) {
      nearbyWatersList = getFilteredFishList._wCacheVal;
    } else {
      nearbyWatersList = getNearestRussianWaters(s.lat, s.lon, s.basinCode, s.isCoastal, 14, radiusKm);
      getFilteredFishList._wCacheKey = wCacheKey;
      getFilteredFishList._wCacheVal = nearbyWatersList;
    }
  }
  const radiusWaterTypes = new Set(nearbyWatersList.map(w => w.wType));
  radiusWaterTypes.add(s.water);

  const hasCoolingInRadius = s.water === "cooling_reservoir" || radiusWaterTypes.has("cooling_reservoir");
  const isLocalCoastal = Boolean(s.isCoastal || s.water === "sea_gulf" || s.water === "open_sea" || radiusWaterTypes.has("sea_gulf") || radiusWaterTypes.has("open_sea"));
  const ecoregion = getSpotEcoregion(s.lat, s.lon, s.basinCode, s.water, s.selectedWaterName);

  let list;
  if (isSearching) {
    const geoMatches = FISH_DB.filter(f =>
      isSpeciesInGeoRange(f, s.lat, s.lon, s.basinCode, s.water, 120, radiusWaterTypes, isLocalCoastal, hasCoolingInRadius, s.selectedWaterName) &&
      matchesFishQuery(f, q)
    );
    if (geoMatches.length > 0) {
      list = geoMatches;
    } else {
      const basinMatches = FISH_DB.filter(f => f.basins.includes(s.basinCode) && matchesFishQuery(f, q));
      list = basinMatches.length > 0
        ? basinMatches
        : FISH_DB.filter(f => matchesFishQuery(f, q));
    }
  } else {
    list = s.showAllSpecies
      ? [...FISH_DB]
      : FISH_DB.filter(f =>
          isSpeciesInGeoRange(f, s.lat, s.lon, s.basinCode, s.water, radiusKm, radiusWaterTypes, isLocalCoastal, hasCoolingInRadius, s.selectedWaterName)
        );

    if (s.onlyFavoritesFilter) {
      const favSet = new Set(s.favorites || []);
      list = list.filter(f => favSet.has(f.id));
    }

    if (s.fishGroup && s.fishGroup !== "all") {
      list = list.filter(f => f.group === s.fishGroup);
    }
  }

  const favSet = new Set(s.favorites || []);
  const sigOrder = ecoregion.signatureSpecies || REGIONAL_SIGNATURE_SPECIES[s.basinCode] || [];
  const sigMap = new Map(sigOrder.map((id, idx) => [id, idx]));
  const curMonth = new Date().getMonth();

  // Предварительно вычисляем ранг уловистости с учётом реальной региональной численности вида в экорегионе и биотопе (50 / 120 км)
  const scoreCache = new Map();
  for (const f of list) {
    const baseSc = day
      ? calcDayBest(f, day, s.method, s.water, s.depth, s.normPress, s.iceState)
      : (Array.isArray(f.monthActivity) ? (f.monthActivity[curMonth] || 55) : 55);
    const sigIdx = sigMap.has(f.id) ? sigMap.get(f.id) : -1;
    const abundanceBonus = sigIdx >= 0 ? Math.max(8, 32 - sigIdx * 2) : -8;
    const isSeaBiotope = s.water === "sea_gulf" || s.water === "open_sea";
    const matchesBiotope = Array.isArray(f.waters) && (
      f.waters.includes(s.water) ||
      (isSeaBiotope && (f.habitat === "sea" || f.waters.includes("sea_gulf") || f.waters.includes("open_sea")))
    );
    const directWaterBonus = matchesBiotope ? 10 : -8;
    const isTopSignature = sigIdx >= 0 && sigIdx <= 4;
    const legalAdjust = (f.legal === "license" && !isTopSignature) ? -6 : (f.legal === "redbook" ? -20 : (f.legal === "introduced" && !hasCoolingInRadius ? -8 : 0));
    scoreCache.set(f.id, baseSc + abundanceBonus + directWaterBonus + legalAdjust);
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

    // 3. Разрешённые виды выше краснокнижных
    const aRed = a.legal === "redbook" ? 1 : 0;
    const bRed = b.legal === "redbook" ? 1 : 0;
    if (aRed !== bRed) return aRed - bRed;

    // 4. Сортировка по комплексному рангу вылова и численности в экорегионе
    const aScore = scoreCache.get(a.id) ?? 50;
    const bScore = scoreCache.get(b.id) ?? 50;
    if (Math.abs(bScore - aScore) >= 3) return bScore - aScore;

    // 5. Приоритет фоновых видов субрегиона
    const aSig = sigMap.has(a.id) ? sigMap.get(a.id) : 999;
    const bSig = sigMap.has(b.id) ? sigMap.get(b.id) : 999;
    if (aSig !== bSig) return aSig - bSig;

    return bScore - aScore;
  });

  return list;
}

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
      const triggerZoom = () => {
        const loadedImg = zoomBox.querySelector("img.fish-visual-img");
        const zoomHtml = (loadedImg && loadedImg.complete && loadedImg.naturalWidth > 0)
          ? `<img class="fish-visual-img" src="${loadedImg.src}" alt="${f.name}" style="width:100%;height:auto;max-height:60vh;object-fit:contain;display:block;margin:0 auto;">`
          : renderFishVisual(f);
        openFishLightbox(f.name, f.latin || "", zoomHtml);
      };
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
  let showAllInModal = false;
  let searchQuery = "";

  function renderFavModalContent(bodyEl) {
    const s = store.getState();
    const favSet = new Set(s.favorites || []);
    const ecoregion = getSpotEcoregion(s.lat, s.lon, s.basinCode, s.water, s.selectedWaterName);
    const allLocalTypes = new Set(["small_river", "big_river", "quarry", "tundra_lake", ...(s.isCoastal ? ["sea_gulf", "open_sea"] : [])]);
    const regional = FISH_DB.filter(f => isSpeciesInGeoRange(f, s.lat, s.lon, s.basinCode, s.water, 120, allLocalTypes, s.isCoastal, true, s.selectedWaterName));
    const basePool = showAllInModal ? [...FISH_DB] : (regional.length > 0 ? regional : [...FISH_DB]);

    const sorted = [...basePool].sort((a, b) => {
      const aFav = favSet.has(a.id) ? 1 : 0;
      const bFav = favSet.has(b.id) ? 1 : 0;
      if (aFav !== bFav) return bFav - aFav;
      return a.name.localeCompare(b.name, "ru");
    });

    bodyEl.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:10px;font-size:var(--fs-sm);">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;padding:8px 10px;background:var(--card);border:1px solid var(--border);border-radius:var(--r-sm);">
          <span style="font-size:var(--fs-xs);color:var(--muted);">
            ⭐ Отметьте галочкой нужные виды рыб (сохраняется мгновенно):
          </span>
          <span class="pill pill-good" id="favSelectedCountPill">Выбрано: ${favSet.size}</span>
        </div>

        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button type="button" class="btn btn-sm ${!showAllInModal ? "btn-accent" : ""}" id="favModalScopeRegBtn">
            📍 По региону (${regional.length})
          </button>
          <button type="button" class="btn btn-sm ${showAllInModal ? "btn-accent" : ""}" id="favModalScopeAllBtn">
            🌍 Весь атлас РФ (${FISH_DB.length})
          </button>
          <button type="button" class="btn btn-sm" id="favModalSelectPopularBtn">
            ✨ Топ-6 региона
          </button>
          <button type="button" class="btn btn-sm" id="favModalClearAllBtn" style="color:var(--bad);">
            🗑️ Очистить
          </button>
        </div>

        <input type="search" id="favModalSearch" class="input" value="${searchQuery}" placeholder="${ecoregion.searchPlaceholder || "🔍 Быстрый поиск рыбы (щука, окунь, плотва, карась, лещ...)"}" style="min-height:40px;padding:6px 12px;font-size:var(--fs-sm);">

        <div id="favModalList" style="max-height:310px;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:6px;padding:4px 0;">
          ${sorted.map(f => {
            const checked = favSet.has(f.id);
            const searchStr = normalizeSearchText(`${f.name} ${f.latin || ""} ${(f.aliases || []).join(" ")}`);
            const qNorm = normalizeSearchText(searchQuery);
            const isHidden = qNorm && !searchStr.includes(qNorm);
            return `
              <label class="fav-item-label" data-fav-id="${f.id}" data-fav-name="${searchStr}" style="display:${isHidden ? "none" : "flex"};align-items:center;gap:8px;padding:8px 10px;background:var(--card);border:1.5px solid ${checked ? "var(--accent)" : "var(--border)"};border-radius:var(--r-sm);cursor:pointer;font-size:var(--fs-xs);font-weight:700;">
                <input type="checkbox" value="${f.id}" class="fav-edit-chk" ${checked ? "checked" : ""}>
                <span class="fav-item-title">${checked ? "⭐ " : ""}${f.name}</span>
              </label>
            `;
          }).join("")}
        </div>

        <div style="display:flex;gap:8px;flex-wrap:wrap;padding-top:6px;border-top:1px solid var(--border);">
          <button type="button" class="btn btn-sm ${s.onlyFavoritesFilter ? "btn-good" : ""}" id="favModalToggleFilterBtn" style="flex:1;">
            ${s.onlyFavoritesFilter ? "✅ Фильтр «Только избранные» ВКЛ" : "🔍 Включить фильтр «Только избранные»"}
          </button>
          <button type="button" class="btn btn-accent" id="favModalSaveBtn" style="flex:1;">
            💾 Готово (${favSet.size})
          </button>
        </div>
      </div>
    `;

    const syncCheckedToStore = () => {
      const selected = Array.from(bodyEl.querySelectorAll(".fav-edit-chk:checked")).map(el => el.value);
      store.dispatch({ type: "SET_FAVORITES_LIST", payload: selected });
      const pill = bodyEl.querySelector("#favSelectedCountPill");
      if (pill) pill.textContent = `Выбрано: ${selected.length}`;
      const saveBtn = bodyEl.querySelector("#favModalSaveBtn");
      if (saveBtn) saveBtn.textContent = `💾 Готово (${selected.length})`;
      return selected;
    };

    bodyEl.querySelectorAll(".fav-edit-chk").forEach(chk => {
      chk.addEventListener("change", () => {
        const label = chk.closest(".fav-item-label");
        const titleSpan = label?.querySelector(".fav-item-title");
        const fishObj = FISH_DB.find(x => x.id === chk.value);
        if (label) {
          label.style.borderColor = chk.checked ? "var(--accent)" : "var(--border)";
        }
        if (titleSpan && fishObj) {
          titleSpan.textContent = `${chk.checked ? "⭐ " : ""}${fishObj.name}`;
        }
        syncCheckedToStore();
      });
    });

    const searchInput = bodyEl.querySelector("#favModalSearch");
    const items = bodyEl.querySelectorAll(".fav-item-label");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        searchQuery = e.target.value || "";
        const query = normalizeSearchText(searchQuery);
        items.forEach(el => {
          const name = el.getAttribute("data-fav-name") || "";
          el.style.display = (!query || name.includes(query)) ? "flex" : "none";
        });
      });
    }

    bodyEl.querySelector("#favModalScopeRegBtn")?.addEventListener("click", () => {
      showAllInModal = false;
      renderFavModalContent(bodyEl);
    });

    bodyEl.querySelector("#favModalScopeAllBtn")?.addEventListener("click", () => {
      showAllInModal = true;
      renderFavModalContent(bodyEl);
    });

    bodyEl.querySelector("#favModalSelectPopularBtn")?.addEventListener("click", () => {
      const sig = (ecoregion.signatureSpecies || REGIONAL_SIGNATURE_SPECIES[s.basinCode] || []).slice(0, 6);
      const nextFavs = Array.from(new Set([...(store.getState().favorites || []), ...sig]));
      store.dispatch({ type: "SET_FAVORITES_LIST", payload: nextFavs });
      showToast(`✨ В Избранное добавлено ${sig.length} популярных видов региона`, "good");
      renderFavModalContent(bodyEl);
    });

    bodyEl.querySelector("#favModalClearAllBtn")?.addEventListener("click", () => {
      store.dispatch({ type: "SET_FAVORITES_LIST", payload: [] });
      showToast("Список избранного очищен", "info");
      renderFavModalContent(bodyEl);
    });

    bodyEl.querySelector("#favModalToggleFilterBtn")?.addEventListener("click", () => {
      const selected = syncCheckedToStore();
      if (selected.length === 0 && !store.getState().onlyFavoritesFilter) {
        showToast("Сначала отметьте галочкой хотя бы 1 рыбу в списке выше", "warn");
        return;
      }
      store.dispatch({ type: "TOGGLE_ONLY_FAVORITES" });
      closeModal();
      showToast(store.getState().onlyFavoritesFilter ? "Показаны только избранные виды рыб" : "Показаны все рыбы водоёма", "good");
    });

    bodyEl.querySelector("#favModalSaveBtn")?.addEventListener("click", () => {
      const selected = syncCheckedToStore();
      closeModal();
      showToast(selected.length ? `✅ Список избранного сохранён (${selected.length} видов)` : "Список избранного очищен", "good");
    });
  }

  openModal("⭐ Список избранных видов рыб", "<div id=\"favModalMount\"></div>", (bodyEl) => {
    if (bodyEl) renderFavModalContent(bodyEl);
  });
}

/**
 * Зона 3: «⚙️ Параметры приложения и Тема оформления» (отдельно от рыб, снастей и логина/пароля)
 */
export function openAppParamsModal(onBackToHub = null) {
  const backFn = typeof onBackToHub === 'function' ? onBackToHub : (() => openProfileHubModal());

  function renderParamsBody(bodyEl) {
    const s = store.getState();
    let currentAppMode = s.appMode || 'angler';
    const curTheme = s.theme || 'auto';

    bodyEl.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:12px;font-size:var(--fs-sm);">
        ${renderSettingsZoneTabsHtml('app')}

        <div class="card" style="background:var(--card);padding:12px;border:1px solid var(--border);display:flex;flex-direction:column;gap:8px;">
          <label style="display:block;font-weight:800;font-size:var(--fs-xs);color:var(--accent);">🎛️ УРОВЕНЬ РЫБАКА И РЕЖИМ ПРОГНОЗА</label>
          <div id="onbModeContainer" class="modal-grid-3">
            <button type="button" class="btn btn-sm ${currentAppMode === 'novice' ? 'btn-good' : ''}" data-onb-mode="novice" style="flex-direction:column;min-height:50px;gap:2px;">
              <span>🟢 Новичок</span>
              <span style="font-size:10px;opacity:0.85;">Светофор + ТОП-3</span>
            </button>
            <button type="button" class="btn btn-sm ${currentAppMode === 'angler' ? 'btn-accent' : ''}" data-onb-mode="angler" style="flex-direction:column;min-height:50px;gap:2px;">
              <span>🟡 Рыбак</span>
              <span style="font-size:10px;opacity:0.85;">Полный + Круг</span>
            </button>
            <button type="button" class="btn btn-sm ${currentAppMode === 'pro' ? 'btn-accent' : ''}" data-onb-mode="pro" style="flex-direction:column;min-height:50px;gap:2px;">
              <span>🔴 Профи</span>
              <span style="font-size:10px;opacity:0.85;">8 факт. + GPX</span>
            </button>
          </div>
          <div id="onbModeDescBox" style="padding:8px 10px;background:var(--panel);border:1px solid var(--border);border-radius:var(--r-sm);font-size:var(--fs-xs);line-height:1.42;color:var(--text);">
            ${currentAppMode === 'novice'
              ? '🟢 <b>Новичок:</b> Лаконичный экран «Клюёт / Не клюёт», ТОП-3 активные рыбы на сегодня и завтра, готовая рекомендация по снасти и кнопка «Почему?» простыми словами.'
              : (currentAppMode === 'pro'
                  ? '🔴 <b>Профи:</b> Полный доступ ко всем 8 факторам ихтиомодели с ручной калибровкой весов, импортом/экспортом точек эхолота (.GPX), выгрузкой в календарь (.ICS) и верификацией точности за 30 дней.'
                  : '🟡 <b>Рыбак (оптимально по умолчанию):</b> Почасовой прогноз клёва с архивом погоды за 2 дня, карта водоёмов и глубин, справочник рыб, закрытый клуб «Круг» и личный журнал уловов.')}
          </div>
        </div>

        <div class="card" style="background:var(--card);padding:12px;border:1px solid var(--border);display:flex;flex-direction:column;gap:8px;">
          <div style="font-weight:800;font-size:var(--fs-xs);color:var(--accent);">🎨 ТЕМА ОФОРМЛЕНИЯ ЭКРАНА</div>
          <div class="modal-grid-3" id="onbThemeContainer">
            <button type="button" class="btn btn-sm ${curTheme === 'auto' ? 'btn-accent' : ''}" data-onb-theme="auto">🌓 Авто</button>
            <button type="button" class="btn btn-sm ${curTheme === 'dark' ? 'btn-accent' : ''}" data-onb-theme="dark">🌙 Тёмная</button>
            <button type="button" class="btn btn-sm ${curTheme === 'light' ? 'btn-accent' : ''}" data-onb-theme="light">☀️ Светлая</button>
          </div>
          <div style="font-size:11px;color:var(--muted);line-height:1.38;">
            В режиме «🌓 Авто» тема автоматически переключается по астрономическому восходу и закату в вашей точке ловли, а также по системной теме смартфона.
          </div>
        </div>

        <div class="card" style="background:var(--card);padding:12px;border:1px solid var(--border);display:flex;flex-direction:column;gap:8px;">
          <div style="font-weight:800;font-size:var(--fs-xs);color:var(--accent);">🔄 СЕРВИС И ОБНОВЛЕНИЕ ДАННЫХ</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:6px;">
            <button type="button" class="btn btn-sm" id="onbRefreshWeatherBtn">🔄 Обновить погоду</button>
            <button type="button" class="btn btn-sm" id="onbVersionCheckBtn">📦 Версия и кэш</button>
            ${(isApkOrTmaContainer() || isAppInstalledOrShortcutPresent()) ? '' : '<button type="button" class="btn btn-sm" id="onbInstallAppBtn" data-install-app>📲 На экран</button>'}
          </div>
        </div>

        <div style="padding:10px 12px;background:var(--card);border:1px solid var(--border);border-radius:var(--r-sm);display:flex;flex-direction:column;gap:6px;font-size:11.5px;">
          <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;line-height:1.38;">
            <input type="checkbox" id="onbConsentLocalFirst" checked style="margin-top:2px;flex-shrink:0;">
            <span>🔒 <b>Приватность и 152-ФЗ (Local-First / Zero-Knowledge):</b> мои личные точки и уловы хранятся локально на моём устройстве и в моём личном зашифрованном облаке без передачи третьим лицам.</span>
          </label>
          <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;line-height:1.38;">
            <input type="checkbox" id="onbConsentIceSafety" checked style="margin-top:2px;flex-shrink:0;">
            <span>❄️ <b>Безопасность на водоёме и льду:</b> расчёт толщины льда и клёва носит информационно-расчётный характер; выход на лёд осуществляется после фактической проверки пешнёй и сводок МЧС РФ.</span>
          </label>
        </div>
      </div>
    `;

    bindSettingsZoneTabs(bodyEl);

    bodyEl.querySelectorAll('[data-onb-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        currentAppMode = btn.getAttribute('data-onb-mode') || 'angler';
        store.dispatch({ type: 'SET_APP_MODE', payload: currentAppMode });
        syncCurrentProfileToCloudIfLoggedIn();
        bodyEl.querySelectorAll('[data-onb-mode]').forEach(b => {
          const m = b.getAttribute('data-onb-mode');
          b.classList.remove('btn-good', 'btn-accent');
          if (m === currentAppMode) {
            b.classList.add(m === 'novice' ? 'btn-good' : 'btn-accent');
          }
        });
        const descBox = bodyEl.querySelector('#onbModeDescBox');
        if (descBox) {
          descBox.innerHTML = currentAppMode === 'novice'
            ? '🟢 <b>Новичок:</b> Лаконичный экран «Клюёт / Не клюёт», ТОП-3 активные рыбы на сегодня и завтра, готовая рекомендация по снасти и кнопка «Почему?» простыми словами.'
            : (currentAppMode === 'pro'
                ? '🔴 <b>Профи:</b> Полный доступ ко всем 8 факторам ихтиомодели с ручной калибровкой весов, импортом/экспортом точек эхолота (.GPX), выгрузкой в календарь (.ICS) и верификацией точности за 30 дней.'
                : '🟡 <b>Рыбак (оптимально по умолчанию):</b> Почасовой прогноз клёва с архивом погоды за 2 дня, карта водоёмов и глубин, справочник рыб, закрытый клуб «Круг» и личный журнал уловов.');
        }
        showToast('Режим прогноза сохранён', 'good');
      });
    });

    bodyEl.querySelectorAll('[data-onb-theme]').forEach(btn => {
      btn.addEventListener('click', () => {
        const nextTheme = btn.getAttribute('data-onb-theme') || 'auto';
        store.dispatch({ type: 'SET_THEME', payload: nextTheme });
        syncCurrentProfileToCloudIfLoggedIn();
        if (typeof window.__KLEV_APPLY_THEME__ === 'function') {
          window.__KLEV_APPLY_THEME__(nextTheme, true);
        }
        bodyEl.querySelectorAll('[data-onb-theme]').forEach(b => {
          b.classList.toggle('btn-accent', b.getAttribute('data-onb-theme') === nextTheme);
        });
      });
    });

    bodyEl.querySelector('#onbRefreshWeatherBtn')?.addEventListener('click', () => {
      const st = store.getState();
      closeModal();
      fetchWeather(st.lat, st.lon, true);
    });

    bodyEl.querySelector('#onbInstallAppBtn')?.addEventListener('click', () => {
      installShortcut();
    });

    bodyEl.querySelector('#onbVersionCheckBtn')?.addEventListener('click', () => {
      closeModal();
      checkForReleaseUpdate({ manual: true });
    });
  }

  openModal('⚙️ Параметры приложения и Тема', '<div id="appParamsMount"></div>', (bodyEl) => {
    if (bodyEl) renderParamsBody(bodyEl);
  }, true, { onBack: backFn });
}

/**
 * Зона 2: «🎣 Моя рыбалка: Локация, Водоёмы, Снасти и Рыбы» (отдельно от логина/пароля и параметров приложения)
 */
export function openFishingPrefsModal(isEditMode = true, onBackToHub = null) {
  const s = store.getState();
  let currentLat = s.lat;
  let currentLon = s.lon;
  let currentBasin = s.basinCode || 'arctic_ob_taz';
  let currentCityName = s.locLabel || s.locAdmin2 || 'Москва';
  const currentAppMode = s.appMode || 'angler';

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
    const isSea = isCoastalInBasin(basin, currentLat, currentLon);
    const primaryW = Array.from(selectedWaters)[0] || s.water || 'small_river';
    const ecoreg = getSpotEcoregion(currentLat, currentLon, basin, primaryW, '');
    const sigOrder = ecoreg.signatureSpecies || REGIONAL_SIGNATURE_SPECIES[basin] || [];
    const sigMap = new Map(sigOrder.map((id, idx) => [id, idx]));
    const localTypes = new Set(['small_river', 'big_river', 'quarry', 'tundra_lake', ...(isSea ? ['sea_gulf', 'open_sea'] : [])]);
    return FISH_DB
      .filter(f => f.legal !== 'redbook' && isSpeciesInGeoRange(f, currentLat, currentLon, basin, primaryW, 120, localTypes, isSea, false, ''))
      .sort((a, b) => {
        const aSig = sigMap.has(a.id) ? sigMap.get(a.id) : 999;
        const bSig = sigMap.has(b.id) ? sigMap.get(b.id) : 999;
        if (aSig !== bSig) return aSig - bSig;
        return a.name.localeCompare(b.name, 'ru');
      });
  }

  function getFishingBodyHtml() {
    const availWaters = getAvailableWaterTypes(currentBasin, currentLat, currentLon);
    const regionalSpecies = getSortedRegionalSpecies(currentBasin);
    const isSeaCoastal = isCoastalInBasin(currentBasin, currentLat, currentLon);

    return `
      <div style="display:flex;flex-direction:column;gap:12px;font-size:var(--fs-sm);">
        ${renderSettingsZoneTabsHtml('fishing')}

        <!-- ШАГ 1: ЛОКАЦИЯ И РЕГИОН -->
        <div class="card" style="background:var(--card);padding:11px 12px;border:1px solid var(--border);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:6px;flex-wrap:wrap;">
            <label style="font-weight:800;font-size:var(--fs-xs);color:var(--accent);">📍 1. ГОРОД / РЕГИОН ЛОВЛИ</label>
            <button type="button" class="btn btn-sm" id="onbGpsBtn">🎯 Мой GPS</button>
          </div>
          <select id="onbCitySelect" style="width:100%;">
            ${RUSSIA_CITIES.map(c => `
              <option value="${c.lat},${c.lon},${c.name},${c.admin1}" ${(c.name === currentCityName || c.name === s.locLabel) ? 'selected' : ''}>
                📍 ${c.name} (${c.admin1})
              </option>
            `).join('')}
          </select>
          <div id="onbLocHint" style="font-size:var(--fs-xs);color:var(--accent);margin-top:5px;font-weight:700;line-height:1.35;">
            Бассейн: ${getSpotEcoregion(currentLat, currentLon, currentBasin, s.water, '').displayBasinName || BASIN_CONFIGS[currentBasin]?.name || 'РФ'} ${isSeaCoastal ? '• 🌊 Морское побережье' : '• 💧 Пресноводный бассейн'}
          </div>
        </div>

        <!-- ШАГ 2: ТИПЫ ВОДОЁМОВ -->
        <div class="card" style="background:var(--card);padding:11px 12px;border:1px solid var(--border);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:6px;flex-wrap:wrap;">
            <label style="font-weight:800;font-size:var(--fs-xs);color:var(--accent);">🌊 2. ТИПЫ ВОДОЁМОВ</label>
            <span style="font-size:var(--fs-xs);color:var(--muted);font-weight:700;">отмечено: <b id="onbWatersCount">${selectedWaters.size}</b></span>
          </div>
          <div id="onbWatersContainer" class="modal-chip-wrap">
            ${availWaters.map(w => {
              const active = selectedWaters.has(w.id);
              return `<button type="button" class="w-chip ${active ? 'active' : ''}" data-onb-water="${w.id}">${active ? '✓ ' : ''}${w.name}</button>`;
            }).join('')}
          </div>
        </div>

        <!-- ШАГ 3: СНАСТИ -->
        <div class="card" style="background:var(--card);padding:11px 12px;border:1px solid var(--border);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:6px;flex-wrap:wrap;">
            <label style="font-weight:800;font-size:var(--fs-xs);color:var(--accent);">🎣 3. ВАШИ СНАСТИ</label>
            <span style="font-size:var(--fs-xs);color:var(--muted);font-weight:700;">отмечено: <b id="onbMethodsCount">${selectedMethods.size}</b></span>
          </div>
          <div id="onbMethodsContainer" class="modal-chip-wrap">
            ${TACKLE_OPTIONS.map(m => {
              const active = selectedMethods.has(m.val);
              return `<button type="button" class="w-chip ${active ? 'active' : ''}" data-onb-method="${m.val}">${active ? '✓ ' : ''}${m.text}</button>`;
            }).join('')}
          </div>
        </div>

        <!-- ШАГ 4: ЦЕЛЕВЫЕ РЫБЫ В ИЗБРАННОЕ -->
        <div class="card" style="background:var(--card);padding:11px 12px;border:1px solid var(--border);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;flex-wrap:wrap;gap:6px;">
            <label style="font-weight:800;font-size:var(--fs-xs);color:var(--accent);">🐟 4. ИЗБРАННЫЕ ВИДЫ РЫБ РЕГИОНА</label>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <button type="button" class="btn btn-sm btn-accent" id="onbSelectTypicalBtn">✨ Топ-7 региона</button>
              <button type="button" class="btn btn-sm" id="onbClearFishBtn">Очистить</button>
            </div>
          </div>
          <div id="onbSpeciesChips" class="modal-chip-wrap" style="max-height:175px;overflow-y:auto;padding:4px 0;">
            ${regionalSpecies.map(f => {
              const active = selectedFishes.has(f.id);
              return `<button type="button" class="w-chip ${active ? 'active' : ''}" data-onb-fish="${f.id}">${active ? '⭐ ' : ''}${f.name}</button>`;
            }).join('')}
          </div>
        </div>

        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${!isEditMode ? `
            <button type="button" class="btn" id="onbLaterBtn" style="flex:1;min-width:130px;">Заполню позже</button>
          ` : ''}
          <button type="button" class="btn btn-good" id="onbSaveBtn" style="flex:2;width:100%;white-space:normal;line-height:1.25;">
            💾 Сохранить настройки рыбалки (локация, водоёмы, снасти, рыбы)
          </button>
        </div>
      </div>
    `;
  }

  const backFn = typeof onBackToHub === 'function' ? onBackToHub : (isEditMode ? (() => openProfileHubModal()) : null);

  openModal(
    isEditMode ? '🎣 Моя рыбалка: Локация, Снасти и Рыбы' : '🚀 Стартовая настройка рыбалки',
    getFishingBodyHtml(),
    (bodyEl) => {
      if (!bodyEl) return;
      bindSettingsZoneTabs(bodyEl);

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

      bodyEl.querySelector('#onbSelectTypicalBtn')?.addEventListener('click', () => {
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

      bodyEl.querySelector('#onbClearFishBtn')?.addEventListener('click', () => {
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
          hint.textContent = `${coordPart}Бассейн: ${getSpotEcoregion(currentLat, currentLon, currentBasin, s.water, '').displayBasinName || BASIN_CONFIGS[currentBasin]?.name || 'РФ'} ${isSeaCoastal ? '• 🌊 Морское побережье' : '• 💧 Пресноводный бассейн'}`;
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
            return `<button type="button" class="w-chip ${active ? 'active' : ''}" data-onb-water="${w.id}">${active ? '✓ ' : ''}${w.name}</button>`;
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
            return `<button type="button" class="w-chip ${active ? 'active' : ''}" data-onb-fish="${f.id}">${active ? '⭐ ' : ''}${f.name}</button>`;
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
              showToast(`📍 Локация определена: ${cName}`, 'good');
            } else {
              gpsBtn.textContent = '📍 Выберите в списке';
              showToast('Выберите город в списке Шага 1', 'info');
            }
          } catch (e) {
            gpsBtn.disabled = false;
            gpsBtn.textContent = '📍 Выберите в списке';
          }
        });
      }

      bodyEl.querySelector('#onbLaterBtn')?.addEventListener('click', () => {
        store.dispatch({
          type: 'SAVE_ONBOARDING',
          payload: {
            appMode: currentAppMode,
            water: s.water,
            method: s.method,
            fishId: s.fishId || 'pike',
            targetSpecies: isEditMode ? (s.favorites || []) : []
          }
        });
        closeModal();
        showToast('Профиль сохранён', 'info');
      });

      bodyEl.querySelector('#onbSaveBtn')?.addEventListener('click', () => {
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
            appMode: store.getState().appMode || currentAppMode,
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
        syncCurrentProfileToCloudIfLoggedIn();

        closeModal();
        showToast('✅ Настройки рыбалки (локация, водоёмы, снасти, рыбы) сохранены!', 'good');
      });
    },
    true,
    { onBack: backFn }
  );
}

/**
 * Центральный хаб «👤 Профиль и настройки» с разделением на 4 отдельные зоны ответственности
 */
export function openProfileHubModal() {
  const s = store.getState();
  const ident = getCurrentFisherIdentity(s);
  const ownerMode = isOwnerAdmin(s);
  const adminMode = isUserAdmin(s);
  const savedLogin = s.userProfile?.login || (ident.callsign !== 'Рыболов' ? ident.callsign : '');
  const modeLabels = { novice: '🟢 Новичок', angler: '🟡 Рыбак', pro: '🔴 Профи' };
  const themeLabels = { auto: '🌓 Авто (День/Ночь)', dark: '🌙 Тёмная', light: '☀️ Светлая' };
  const favCount = Array.isArray(s.favorites) ? s.favorites.length : 0;

  const html = `
    <div style="display:flex;flex-direction:column;gap:10px;font-size:var(--fs-sm);">
      <div style="padding:10px 12px;background:rgba(56,189,248,0.12);border:1.5px solid var(--accent);border-radius:var(--r-sm);">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
          <div style="font-weight:800;font-size:var(--fs-md);color:var(--accent);">
            👤 ${savedLogin || ident.callsign} ${ownerMode ? '• 👑 Владелец' : (adminMode ? '• 🛡️ Админ' : '')}
          </div>
          <button type="button" class="btn btn-sm btn-good fisher-id-copy-badge" data-copy-fisher-id="${ident.fisherId}" title="Нажмите для автокопирования вашего ID рыбака" style="min-height:30px;padding:3px 10px;font-family:monospace;font-weight:900;">
            🆔 ${ident.fisherId} 📋 Копировать ID
          </button>
        </div>
        <div style="font-size:var(--fs-xs);color:var(--muted);margin-top:4px;line-height:1.4;">
          Выберите нужный раздел настроек ниже (все зоны разделены для удобства):
        </div>
      </div>

      <!-- ЗОНА 1: ЛОГИН, ПАРОЛЬ И МОЙ ID -->
      <button type="button" class="settings-hub-card" data-open-hub-zone="auth">
        <div class="settings-hub-card-icon">🔐</div>
        <div class="settings-hub-card-body">
          <div class="settings-hub-card-title">1. Логин, Пароль и Мой ID (${ident.fisherId})</div>
          <div class="settings-hub-card-sub">
            ${ident.isAuthenticated
              ? `🟢 Вход выполнен (${savedLogin || ident.callsign}) • Доступ со всех устройств, ${ownerMode ? 'База Супер-Админа и ' : ''}Бэкап`
              : 'Вход по логину и паролю на всех устройствах, автокопирование ID и резервная копия'}
          </div>
        </div>
        <div class="settings-hub-card-arrow">›</div>
      </button>

      <!-- ЗОНА 2: МОЯ РЫБАЛКА (ЛОКАЦИЯ, ВОДОЁМЫ, СНАСТИ, РЫБЫ) -->
      <button type="button" class="settings-hub-card" data-open-hub-zone="fishing">
        <div class="settings-hub-card-icon">🎣</div>
        <div class="settings-hub-card-body">
          <div class="settings-hub-card-title">2. Моя рыбалка: Локация, Снасти и Рыбы</div>
          <div class="settings-hub-card-sub">
            📍 ${s.locLabel} • Избранных рыб: ${favCount} • Выбрать водоёмы, рабочие снасти и виды рыб
          </div>
        </div>
        <div class="settings-hub-card-arrow">›</div>
      </button>

      <!-- ЗОНА 3: ПАРАМЕТРЫ ПРИЛОЖЕНИЯ -->
      <button type="button" class="settings-hub-card" data-open-hub-zone="app">
        <div class="settings-hub-card-icon">⚙️</div>
        <div class="settings-hub-card-body">
          <div class="settings-hub-card-title">3. Параметры приложения и Тема</div>
          <div class="settings-hub-card-sub">
            Режим: ${modeLabels[s.appMode] || '🟡 Рыбак'} • Тема: ${themeLabels[s.theme || 'auto']} • Погода и версия
          </div>
        </div>
        <div class="settings-hub-card-arrow">›</div>
      </button>

      <!-- ЗОНА 4: УВЕДОМЛЕНИЯ -->
      <button type="button" class="settings-hub-card" data-open-hub-zone="notif">
        <div class="settings-hub-card-icon">🔔</div>
        <div class="settings-hub-card-body">
          <div class="settings-hub-card-title">4. Уведомления и Сигналы Круга</div>
          <div class="settings-hub-card-sub">
            Раздельная настройка оповещений: 🆘 SOS на воде, 🌊 Экипаж, 👥 Круг, 🛠️ Мастерская, 💬 Чаты
          </div>
        </div>
        <div class="settings-hub-card-arrow">›</div>
      </button>
    </div>
  `;

  openModal('👤 Профиль и настройки (4 раздела)', html, (bodyEl) => {
    if (!bodyEl) return;
    bodyEl.querySelectorAll('[data-open-hub-zone]').forEach(card => {
      card.addEventListener('click', () => {
        const zone = card.getAttribute('data-open-hub-zone');
        openOnboardingModal(true, zone);
      });
    });
  }, true);
}

/**
 * Универсальная точка входа в настройки профиля и зон ответственности:
 * - При первом запуске (isEditMode === false): открывает настройку рыбалки («🎣 Моя рыбалка») с вкладками всех 4 зон.
 * - При вызове из меню (isEditMode === true): открывает либо указанную зону ('auth' | 'fishing' | 'app' | 'notif'), либо хаб из 4 разделов!
 */
export function openOnboardingModal(isEditMode = false, initialZone = '') {
  if (!isEditMode) {
    openFishingPrefsModal(false, () => openProfileHubModal());
    return;
  }
  if (initialZone === 'auth') {
    openAuthAndBackupModal(() => openProfileHubModal());
    return;
  }
  if (initialZone === 'fishing') {
    openFishingPrefsModal(true, () => openProfileHubModal());
    return;
  }
  if (initialZone === 'app') {
    openAppParamsModal(() => openProfileHubModal());
    return;
  }
  if (initialZone === 'notif') {
    openNotificationsModal(() => openProfileHubModal());
    return;
  }
  openProfileHubModal();
}

if (typeof window !== 'undefined') {
  window.__KLEV_OPEN_SETTINGS_ZONE__ = (zone) => {
    openOnboardingModal(true, zone);
  };
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
  const favEditBtn = container.querySelector('#fishFavEditBtn');
  if (favEditBtn && !favEditBtn.onclick) {
    favEditBtn.onclick = (e) => {
      e.stopPropagation();
      openFavoritesEditorModal();
    };
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

  const ecoregion = getSpotEcoregion(s.lat, s.lon, s.basinCode, s.water, s.selectedWaterName);
  const searchInput = container.querySelector('#fishSearchInput');
  if (searchInput) {
    const nextPlaceholder = ecoregion.searchPlaceholder || '🔍 Поиск рыбы (щука, окунь, плотва, карась, лещ, судак...)';
    if (searchInput.getAttribute('placeholder') !== nextPlaceholder) {
      searchInput.setAttribute('placeholder', nextPlaceholder);
    }
    if (document.activeElement !== searchInput && searchInput.value !== (s.fishSearch || '')) {
      searchInput.value = s.fishSearch || '';
    }
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
        <input type="text" inputmode="search" enterkeyhint="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" id="fishSearchInput" class="input" style="width:100%;min-height:42px;padding:8px 38px 8px 12px;font-size:var(--fs-sm);" placeholder="${getSpotEcoregion(s.lat, s.lon, s.basinCode, s.water, s.selectedWaterName).searchPlaceholder || '🔍 Поиск рыбы (щука, окунь, плотва, карась, лещ, судак...)'}" value="${s.fishSearch || ''}">
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
    showAllBtn.onclick = (e) => {
      e.stopPropagation();
      store.dispatch({ type: 'TOGGLE_SHOW_ALL' });
    };
  }

  const favFilterBtn = container.querySelector('#fishFavFilterBtn');
  if (favFilterBtn) {
    favFilterBtn.onclick = (e) => {
      e.stopPropagation();
      const s = store.getState();
      if (!s.onlyFavoritesFilter && (!s.favorites || s.favorites.length === 0)) {
        showToast('Список Избранного пока пуст. Отметьте галочкой нужных рыб в списке!', 'info');
        openFavoritesEditorModal();
        return;
      }
      store.dispatch({ type: 'TOGGLE_ONLY_FAVORITES' });
      const active = store.getState().onlyFavoritesFilter;
      showToast(active ? 'Показаны только избранные виды рыб' : 'Показаны все рыбы водоёма', 'info');
    };
  }

  const favEditBtn = container.querySelector('#fishFavEditBtn');
  if (favEditBtn) {
    favEditBtn.onclick = (e) => {
      e.stopPropagation();
      openFavoritesEditorModal();
    };
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
let _fishNeedsRender = false;

function updateActiveFishSelectionOnly(container, activeFishId) {
  if (!container) return false;
  const cards = container.querySelectorAll('[data-select-fish]');
  if (!cards.length) return false;
  cards.forEach(c => {
    const isAct = c.getAttribute('data-select-fish') === activeFishId;
    c.classList.toggle('active', isAct);
    c.setAttribute('aria-selected', isAct ? 'true' : 'false');
  });
  return true;
}

export function init(container) {
  const s = store.getState();
  if (!s.fishId) {
    const defId = pickBestDefaultFish(getFilteredFishList(s));
    store.dispatch({ type: 'SET_FISH', payload: defId });
  }
  render(container);

  unsub = store.subscribe(
    st => ({
      route: st.route,
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
    (next, prev) => {
      const visibleRoutes = ['fish', 'forecast', 'calendar'];
      const isVisible = !next.route || visibleRoutes.includes(next.route);
      if (!isVisible) {
        _fishNeedsRender = true;
        return;
      }
      if (_fishNeedsRender) {
        _fishNeedsRender = false;
        render(container);
        return;
      }
      // Быстрый путь (0.05 мс): если изменилась только выбранная рыба или вкладка внутри видимых, не перестраиваем 115 SVG-карточек!
      if (prev &&
          next.lat === prev.lat &&
          next.lon === prev.lon &&
          next.basinCode === prev.basinCode &&
          next.water === prev.water &&
          next.waterRadiusKm === prev.waterRadiusKm &&
          next.nearbyWaters === prev.nearbyWaters &&
          next.method === prev.method &&
          next.depth === prev.depth &&
          next.dayIdx === prev.dayIdx &&
          next.showAllSpecies === prev.showAllSpecies &&
          next.onlyFavoritesFilter === prev.onlyFavoritesFilter &&
          next.fishSearch === prev.fishSearch &&
          next.fishGroup === prev.fishGroup &&
          next.favorites === prev.favorites &&
          next.weatherDays === prev.weatherDays &&
          next.theme === prev.theme) {
        if (next.fishId !== prev.fishId && updateActiveFishSelectionOnly(container, next.fishId)) {
          return;
        }
        if (next.route !== prev.route) {
          if (typeof window.syncFishDockState === 'function') window.syncFishDockState();
          return;
        }
      }
      render(container);
    }
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
  openProfileHubModal,
  openFishingPrefsModal,
  openAppParamsModal,
  openOnboardingModal,
  renderFishStrip,
  init,
  render,
  destroy
};
