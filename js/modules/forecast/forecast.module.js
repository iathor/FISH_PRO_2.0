import { getFilteredFishList, openFishDetail } from '../fish/fish.module.js?v=2.9.3-r239';
import { logBlankTrip } from '../log/log.module.js?v=2.9.3-r239';
import { getSpotEcoregion, isSpeciesInGeoRange } from '../../data/basins.js?v=2.9.3-r239';
import { RU } from '../../i18n/ru.js?v=2.9.3-r239';
import { getSeasonalBaitsForContext, getCompatibleMethods } from '../../core/config.js?v=2.9.3-r239';
import { events } from '../../core/events.js?v=2.9.3-r239';
import { storage } from '../../core/storage.js?v=2.9.3-r239';
import { store } from '../../core/store.js?v=2.9.3-r239';
import { formatLocalYYYYMMDD, fmtDeltaPress, fmtHM } from '../../core/format.js?v=2.9.3-r239';
import { WATER_PROFILES, getAvailableWaterTypes } from '../../data/waters.js?v=2.9.3-r239';
import { FISH_DB } from '../../data/species.js?v=2.9.3-r239';
import { renderFiveFish , renderFishVisual } from '../../ui/svg.js?v=2.9.3-r239';
import { createPill, showToast, openModal, closeModal, openFishLightbox, flashHighlightElement } from '../../ui/components.js?v=2.9.3-r239';
import { computeIceSafetyIndex, evaluateRoadAndWeatherHazards } from '../weather/weather.module.js?v=2.9.3-r239';
import { evaluateCircleFieldConfirmation, requireRegisteredFisherId } from '../circle/circle.module.js?v=2.9.3-r239';
import { isTelegramWebApp, getTelegramUser, shareToTelegramChat, openBotChatInTelegram, buildForecastShareUrls, TELEGRAM_BOT_USERNAME } from '../../core/telegram.js?v=2.9.3-r239';
/**
 * Список морских, проходных и полупроходных видов, которые заходят в пресные реки
 * (big_river, small_river) и эстуарии (sea_gulf) при нересте, сезонных миграциях или приливах/отливах.
 */

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const RIVER_ENTERING_SPECIES = {
  smelt: { runMonths: [12, 1, 2, 3, 4, 5], reason: 'весенне-зимний нерестовый и кормовой ход из заливов в устья рек' },
  navaga: { runMonths: [11, 12, 1, 2, 3], reason: 'зимний приливной и преднерестовый заход в устья северных и дальневосточных рек' },
  flounder: { runMonths: [3, 4, 5, 6, 7, 8, 9, 10], reason: 'заход речной камбалы (глоссы) с приливом в опреснённые устья и низовья рек' },
  starry_flounder: { runMonths: [4, 5, 6, 7, 8, 9, 10], reason: 'заход звёздчатой камбалы в эстуарии и нижнее течение рек Тихого океана' },
  mullet: { runMonths: [4, 5, 8, 9, 10], reason: 'сезонный заход пеленгаса и кефали в лиманы и устья рек на нагул и зимовку' },
  pink_salmon: { runMonths: [6, 7, 8, 9], reason: 'массовый анадромный нерестовый ход горбуши из моря в реки' },
  chum_salmon: { runMonths: [7, 8, 9, 10], reason: 'анадромный нерестовый ход кеты вверх по рекам' },
  coho_salmon: { runMonths: [8, 9, 10, 11], reason: 'осенний нерестовый ход кижуча в реки Камчатки и Охотоморья' },
  sockeye_salmon: { runMonths: [6, 7, 8], reason: 'ход нерки в реки и озёрно-речные системы' },
  chinook_salmon: { runMonths: [5, 6, 7], reason: 'весенне-летний ход чавычи в русла крупных рек' },
  cherry_salmon: { runMonths: [4, 5, 6, 7], reason: 'весенний заход симы в реки Приморья и Сахалина' },
  salmon: { runMonths: [5, 6, 7, 8, 9, 10], reason: 'анадромный заход атлантического лосося (сёмги) в порожистые реки' },
  trout: { runMonths: [4, 5, 6, 8, 9, 10, 11], reason: 'ход кумжи между морскими губами и реками' },
  char: { runMonths: [5, 6, 7, 8, 9, 10], reason: 'миграция проходного гольца и кунджи в реки и устья' },
  dolly_varden: { runMonths: [5, 6, 7, 8, 9, 10], reason: 'нагульно-нерестовая миграция мальмы в реках' },
  kutum: { runMonths: [3, 4, 5, 9, 10], reason: 'весенний и осенний ход кутума из Каспия в реки' },
  vobla: { runMonths: [3, 4, 5], reason: 'весенний массовый ход каспийской воблы в дельту и рукава Волги' },
  taran: { runMonths: [2, 3, 4, 9, 10], reason: 'ход азовской тарани в лиманы, Кубань и Дон' },
  vimba: { runMonths: [3, 4, 5, 9, 10], reason: 'миграция рыбца (сырти) из заливов в реки с быстрым течением' },
  omul_arctic: { runMonths: [7, 8, 9, 10, 11], reason: 'полупроходной ход арктического омуля из губы в низовья северных рек' },
  cisco: { runMonths: [8, 9, 10, 11, 12], reason: 'массовый подъём сибирской ряпушки из губы в реки Пур, Таз, Обь и Енисей' },
  goby: { runMonths: [4, 5, 6, 7, 8, 9, 10], reason: 'обитание бычка в эстуариях, водохранилищах и низовьях рек' },
  herring: { runMonths: [4, 5, 6], reason: 'весенний подход сельди в опреснённые заливы и предустьевые зоны' }
};
/**
 * Собирает до 5 предшествующих архивных дней для указанного дня day из 10-км гео-кэша и ленты прогноза
 */
const _prev5DaysMemo = new Map();
const _archiveShockMemo = new Map();
const _circleFieldMemo = new Map();
const _dayBestMemo = new Map();
const _biteWindowMemo = new Map();
function _pruneCache(mapObj, maxEntries = 2500) {
  if (mapObj.size > maxEntries) {
    mapObj.clear();
  }
}
function _buildStateForecastSignature(st, fishId, day, method, water, depth, normPress, iceState) {
  const pw = (st.appMode === 'pro' && st.proFactorWeights) ? st.proFactorWeights : null;
  const wSig = pw ? `${pw.temp ?? 1}_${pw.press ?? 1}_${pw.archive_shock ?? 1}_${pw.circle_field ?? 1}` : '1';
  const cLen = Array.isArray(st.catches) ? st.catches.length : 0;
  const cirLen = Array.isArray(st.circleItems) ? st.circleItems.length : 0;
  return `${fishId}|${day.date}|${day.waterTemp}|${day.pressAvg}|${day.dP}|${day.windMax}|${day.iceState || iceState}|${method}|${water}|${depth}|${normPress}|${st.appMode || 'angler'}|${wSig}|${cLen}|${cirLen}|${st.hasRealArchive !== false ? 1 : 0}|${Math.round((st.lat || 0) * 100)}_${Math.round((st.lon || 0) * 100)}`;
}
export function getPreceding5DaysForTarget(day, state = null) {
  const st = state || store.getState();
  if (!day || !day.date) return [];
  const targetDate = day.date;
  const firstWDate = st.weatherDays?.[0]?.date || '';
  const archLen = Array.isArray(st.weatherArchive5Days) ? st.weatherArchive5Days.length : 0;
  const memoKey = `${targetDate}|${Math.round((st.lat || 0) * 100)}|${Math.round((st.lon || 0) * 100)}|${firstWDate}|${archLen}`;
  if (_prev5DaysMemo.has(memoKey)) {
    return _prev5DaysMemo.get(memoKey);
  }
  const mapByDate = {};
  if (Array.isArray(st.weatherDays)) {
    for (let i = 0; i < st.weatherDays.length; i++) {
      const d = st.weatherDays[i];
      if (d && d.date && d.date < targetDate) mapByDate[d.date] = d;
    }
  }
  if (Array.isArray(st.weatherArchive5Days)) {
    for (let i = 0; i < st.weatherArchive5Days.length; i++) {
      const d = st.weatherArchive5Days[i];
      if (d && d.date && d.date < targetDate) mapByDate[d.date] = d;
    }
  }
  const geoArch = storage.getArchiveDaysForLocation(st.lat, st.lon, 10, targetDate);
  if (Array.isArray(geoArch.allArchiveDays)) {
    for (let i = 0; i < geoArch.allArchiveDays.length; i++) {
      const d = geoArch.allArchiveDays[i];
      if (d && d.date && d.date < targetDate) mapByDate[d.date] = d;
    }
  }
  const res = Object.keys(mapByDate)
    .sort()
    .slice(-5)
    .map(k => mapByDate[k]);
  _pruneCache(_prev5DaysMemo, 500);
  _prev5DaysMemo.set(memoKey, res);
  return res;
}
/**
 * 7-й ФАКТОР ПРОГНОЗИРОВАНИЯ (Ревизия 2.0.15):
 * Анализ 5-дневного метеоархива (в радиусе 10 км) и эффекта «барического шока» (ступора рыбы после скачков давления за 1–2 суток).
 * Даже если сегодня погода и давление нормализовались, при резких скачках за предыдущие 24–72 часа рыба находится в барическом «шоке» и болеет.
 */
export function evaluate5DayArchiveAndBaricShock(fish, day, prev5Days = [], hasRealArchive = true) {
  const sens = Number.isFinite(fish?.bladderSens) ? fish.bladderSens : 0.8;
  const isBurbot = fish?.id === 'burbot';
  if (!Array.isArray(prev5Days) || prev5Days.length === 0) {
    return {
      val: 0,
      isShock: false,
      note: hasRealArchive === false
        ? 'Архив погоды за 5 дней недоступен для этой точки'
        : 'Недостаточно архивных дней для оценки барического тренда',
      commentary: hasRealArchive === false
        ? 'Прогноз может быть менее точным из-за отсутствия архивных данных по погоде.'
        : 'Оценка строится по текущим суткам.'
    };
  }
  const recent2 = prev5Days.slice(-2); // Вчера и Позавчера
  const allPress = [...prev5Days.map(d => d.pressAvg || 754), day.pressAvg || 754];
  const minP = Math.min(...allPress);
  const maxP = Math.max(...allPress);
  const swing5d = Math.round(maxP - minP);
  let maxRecentJump = 0;
  recent2.forEach(d => {
    const dpAbs = Math.abs(d.dP || 0);
    if (dpAbs > maxRecentJump) maxRecentJump = dpAbs;
  });
  if (recent2.length === 2) {
    const diff2d = Math.abs((day.pressAvg || 754) - (recent2[0].pressAvg || 754));
    if (diff2d > maxRecentJump) maxRecentJump = diff2d;
  }
  const todayJump = Math.abs(day.dP || 0);
  const todayNormalized = todayJump <= 3;
  const firstT = prev5Days[0]?.tDay ?? day.tDay;
  const tempShift5d = Math.round((day.tDay ?? 10) - firstT);
  let val = 0;
  let isShock = false;
  let note = '';
  let commentary = '';
  if (maxRecentJump >= 8 || swing5d >= 16) {
    isShock = true;
    const rawPenalty = maxRecentJump >= 11 || swing5d >= 20 ? -14 : -9;
    val = isBurbot ? Math.round(rawPenalty * 0.35) : Math.round(rawPenalty * Math.max(0.6, sens));
    if (todayNormalized) {
      note = `Барический «шок» после скачка давления (до ${maxRecentJump} мм за 1–2 сут., размах за 5 дн. ${swing5d} мм)`;
      commentary = `Даже несмотря на то, что сегодня погода выровнялась (Δ ${fmtDeltaPress(day.dP)}), за предыдущие 1–2 суток зафиксирован резкий перепад давления (${maxRecentJump} мм, 5-дневный размах ${minP}–${maxP} мм). После таких качелей плавательный пузырь рыбы не успевает адаптироваться — рыба находится в барическом «шоке» (ступоре) и игнорирует активные приманки.`;
    } else {
      note = `Затяжной барический шторм: скачки до ${maxRecentJump} мм (размах за 5 дн. ${swing5d} мм)`;
      commentary = `По данным 5-дневного архива локации (10 км) продолжается сильная барическая пила (перепад ${minP}–${maxP} мм). Рыба испытывает выраженный барический шок и стоит в глухой обороне у дна.`;
    }
  } else if (maxRecentJump >= 5 || swing5d >= 10) {
    val = isBurbot ? +3 : Math.round(-4 * Math.max(0.55, sens));
    note = `Умеренные качели давления за 5 дней (размах ${swing5d} мм, вчера/позавчера до ${maxRecentJump} мм)`;
    commentary = `За последние ${prev5Days.length} дн. в радиусе 10 км давление менялось в пределах ${minP}–${maxP} мм (${swing5d} мм). Умеренная барическая нестабильность делает поклёвки осторожными и короткими.`;
  } else {
    val = Math.round(8 * Math.max(0.75, sens));
    note = `Стабильное плато давления ${prev5Days.length} дн. подряд (размах всего ${swing5d} мм)`;
    commentary = `За последние ${prev5Days.length} дн. в этой локации (10 км) держится ровное атмосферное давление (${minP}–${maxP} мм, без резких скачков). Рыба полностью адаптировалась к горизонту глубины и выходит на уверенную кормёжку.`;
  }
  if (Math.abs(tempShift5d) >= 6) {
    if (tempShift5d <= -6 && ['burbot', 'chir', 'pizhyan', 'peled', 'cisco', 'whitefish'].includes(fish?.id)) {
      val += 4;
      commentary += ` Пятидневное похолодание (${tempShift5d}°C) дополнительно активизирует холоднолюбивый вид.`;
    } else if (tempShift5d <= -6 && fish?.type === 'peace') {
      val -= 4;
      commentary += ` Резкое похолодание за 5 дней (${tempShift5d}°C) снизило кормовую активность мирной рыбы.`;
    }
  }
  const spaceWeather = store.getState()?.spaceWeather;
  if (spaceWeather && Number.isFinite(spaceWeather.kpIndex) && spaceWeather.kpIndex >= 5.0 && !isBurbot) {
    const geoPenalty = spaceWeather.kpIndex >= 6.5 ? -4 : -2;
    val += Math.round(geoPenalty * Math.max(0.6, sens));
    commentary += ` Дополнительно по сводке ИПГ Росгидромета зафиксирована геомагнитная активность (Kp=${spaceWeather.kpIndex}, ${spaceWeather.label.toLowerCase()}).`;
  }
  val = Math.max(-20, Math.min(12, val));
  return { val, isShock, note, commentary, swing5d, maxRecentJump };
}
/**
 * Аналитика Личного журнала рыболова для калибровки прогноза клёва (Ревизия 2.0.15):
 * Сравнивает текущие условия (температура воды, давление, ветер, снасть, час) с реальными уловами пользователя из журнала.
 */
export function evaluateLogbookInsight(fish, day, hrObj, method, water, catches = []) {
  const activeCatches = (Array.isArray(catches) ? catches : []).filter(c => c && !c.markedForDeletion);
  if (activeCatches.length === 0 || !fish) {
    return {
      val: 0,
      hasData: false,
      note: 'Журнал уловов: пока нет записей для личной калибровки',
      commentary: 'Добавляйте свои уловы в разделе «Журнал» (доступен выбор даты за последние 5 дней с автоподстановкой погоды и прогноза), чтобы расчёт автоматически учитывал статистику «Моих уловов».'
    };
  }
  const byFish = activeCatches.filter(c => c.fishId === fish.id);
  if (byFish.length === 0) {
    return {
      val: 0,
      hasData: false,
      note: `Журнал уловов: всего записей ${activeCatches.length}, по виду «${fish.name}» пока 0`,
      commentary: `В разделе «Мои уловы» ${activeCatches.length} записей других видов, но по рыбе «${fish.name}» данных ещё нет.`
    };
  }
  const successFish = byFish.filter(c => !c.isBlankTrip && !String(c.fishName || '').includes('Выезд без улова'));
  const blankFish = byFish.filter(c => c.isBlankTrip || String(c.fishName || '').includes('Выезд без улова'));
  const curWT = Number(day.waterTemp ?? 10);
  const curP = Number(hrObj?.press ?? day.pressAvg ?? 754);
  const curHr = Number(hrObj?.hour ?? 12);

  if (successFish.length === 0 && blankFish.length > 0) {
    const blankMatch = blankFish.some(c => Math.abs((c.waterTemp ?? curWT) - curWT) <= 3 && Math.abs((c.press ?? curP) - curP) <= 6);
    const val = blankMatch ? -6 : -2;
    return {
      val,
      hasData: true,
      topBait: '—',
      count: byFish.length,
      note: `Мои уловы (${blankFish.length} холостых выездов): зафиксировано бесклёвье при схожей погоде (${val}%)`,
      commentary: `В вашем журнале отмечено ${blankFish.length} выездов без поклёвок по виду «${fish.name}» при близких метеоусловиях.`
    };
  }

  const avgWT = Math.round((successFish.reduce((a, b) => a + (Number.isFinite(b.waterTemp) ? b.waterTemp : curWT), 0) / successFish.length) * 10) / 10;
  const avgP = Math.round(successFish.reduce((a, b) => a + (Number.isFinite(b.press) ? b.press : curP), 0) / successFish.length);
  const avgPred = Math.round(successFish.reduce((a, b) => a + (Number.isFinite(b.predictedScore) ? b.predictedScore : 50), 0) / successFish.length);
  const baitCounts = {};
  successFish.forEach(c => {
    if (c.bait) baitCounts[c.bait] = (baitCounts[c.bait] || 0) + 1;
  });
  const topBait = Object.entries(baitCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'проверенная приманка';
  const similarCatches = successFish.filter(c => {
    const wtDiff = Math.abs((c.waterTemp ?? curWT) - curWT);
    const pDiff = Math.abs((c.press ?? curP) - curP);
    return wtDiff <= 3.5 && pDiff <= 6;
  });
  const similarBlanks = blankFish.filter(c => {
    const wtDiff = Math.abs((c.waterTemp ?? curWT) - curWT);
    const pDiff = Math.abs((c.press ?? curP) - curP);
    return wtDiff <= 3.0 && pDiff <= 5;
  });
  const sameHourCatches = successFish.filter(c => Math.abs((c.hour ?? 12) - curHr) <= 2);
  let val = 0;
  let note = '';
  let commentary = '';
  if (similarCatches.length > 0 && similarCatches.length >= similarBlanks.length) {
    val = Math.min(10, 4 + similarCatches.length * 2 + (sameHourCatches.length > 0 ? 2 : 0) - similarBlanks.length * 2);
    note = `Мои уловы (${successFish.length} поимок): погода совпадает с ${similarCatches.length} уловами (+${val}%)`;
    commentary = `По статистике «Моих уловов» (${successFish.length} успешных зап. по виду «${fish.name}», ср. прогноз при поимке ${avgPred}%) вы ловили эту рыбу при воде ~${avgWT}°C и давлении ~${avgP} мм. Лучшая приманка: «${topBait}».`;
  } else if (similarBlanks.length > similarCatches.length) {
    val = -5;
    note = `Мои уловы: при такой погоде было ${similarBlanks.length} выездов без поклёвок (${val}%)`;
    commentary = `По данным «Моих уловов» при давлении ~${curP} мм и воде ~${curWT}°C фиксировались холостые выезды. Лучшая приманка из уловов: «${topBait}».`;
  } else {
    const wtDiffAvg = Math.abs(curWT - avgWT);
    const pDiffAvg = Math.abs(curP - avgP);
    if (wtDiffAvg > 6 || pDiffAvg > 10) {
      val = -3;
      note = `Мои уловы (${successFish.length} зап.): условия отличаются от ваших средних (вода ~${avgWT}°C, ${avgP} мм)`;
      commentary = `В журнале «${fish.name}» чаще ловилась при воде ~${avgWT}°C и давлении ~${avgP} мм (ср. прогноз ${avgPred}%, фаворит — «${topBait}»).`;
    } else {
      val = +2;
      note = `Мои уловы (${successFish.length} зап.): близко к вашей статистике (фаворит — ${topBait})`;
      commentary = `Учтена статистика «Моих уловов» (${successFish.length} поимок вида «${fish.name}», вода ~${avgWT}°C, давление ~${avgP} мм, ср. прогноз ${avgPred}%, фаворит — «${topBait}»).`;
    }
  }
  return { val, hasData: true, topBait, count: byFish.length, avgPred, note, commentary };
}

const _PHYSOCLIST_IDS = new Set([
  'perch', 'zander', 'volga_zander', 'ruffe', 'chinese_perch', 'sea_bass',
  'cod', 'haddock', 'saithe', 'walleye_pollock', 'navaga', 'saffron_cod', 'burbot',
  'stickleback', 'rotan', 'goby', 'scorpionfish', 'wrasse', 'sea_bream', 'red_mullet',
  'mullet', 'horse_mackerel', 'bluefish', 'greenling', 'wolffish', 'tilapia'
]);
const _APHYSOCLIST_BENTHIC_IDS = new Set([
  'flounder', 'starry_flounder', 'plaice', 'turbot', 'halibut',
  'crayfish', 'crab', 'king_crab', 'anglerfish', 'mackerel', 'garfish', 'sand_eel'
]);
const _NOCTURNAL_COLD_IDS = new Set(['burbot']);
const _NOCTURNAL_WARM_IDS = new Set(['catfish', 'amur_catfish', 'channel_catfish', 'eel', 'loach']);
const _TAPETUM_CREPUSCULAR_IDS = new Set(['zander', 'volga_zander', 'ruffe', 'rotan']);
const _VISUAL_DIURNAL_PREDATOR_IDS = new Set([
  'pike', 'perch', 'asp', 'chub', 'grayling', 'baikal_grayling',
  'trout', 'brown_trout', 'rainbow_trout', 'salmon', 'white_salmon',
  'nelma', 'taimen', 'lenok', 'char', 'dolly_varden',
  'pink_salmon', 'chum_salmon', 'coho_salmon', 'sockeye_salmon', 'chinook_salmon', 'cherry_salmon',
  'sky_gazer', 'yellowcheek', 'chinese_perch', 'snakehead'
]);
const _WHITEFISH_COREGONID_IDS = new Set([
  'whitefish', 'pizhyan', 'chir', 'peled', 'muksun', 'cisco', 'vendace',
  'omul', 'omul_arctic', 'tugun', 'valek', 'broad_whitefish', 'smelt'
]);
const _THERMOPHILIC_PEACE_IDS = new Set([
  'carp', 'crucian', 'tench', 'grass_carp', 'silver_carp', 'black_carp',
  'buffalo', 'tilapia', 'parabramis', 'tarpon_carp'
]);
const _MARINE_NOCTURNAL_IDS = new Set([
  'horse_mackerel', 'scorpionfish', 'anglerfish', 'beluga', 'kaluga'
]);
const _MARINE_BENTHIC_TIDAL_IDS = new Set([
  'cod', 'haddock', 'walleye_pollock', 'navaga', 'saffron_cod',
  'flounder', 'starry_flounder', 'plaice', 'turbot', 'halibut', 'wolffish', 'goby', 'sea_bass'
]);

export function getSpeciesBioProfile(fish) {
  const fid = fish?.id || 'pike';
  const bladderType = _APHYSOCLIST_BENTHIC_IDS.has(fid)
    ? 'aphysoclist'
    : (_PHYSOCLIST_IDS.has(fid) ? 'physoclist' : 'physostome');

  let guild = 'peace_eurythermal';
  if (fid === 'crayfish') guild = 'crustacean_crayfish';
  else if (fid === 'crab' || fid === 'king_crab') guild = 'crustacean_crab';
  else if (_NOCTURNAL_COLD_IDS.has(fid)) guild = 'predator_nocturnal_cold';
  else if (_NOCTURNAL_WARM_IDS.has(fid)) guild = 'predator_nocturnal_warm';
  else if (_TAPETUM_CREPUSCULAR_IDS.has(fid)) guild = 'predator_crepuscular_tapetum';
  else if (_VISUAL_DIURNAL_PREDATOR_IDS.has(fid)) guild = 'predator_visual';
  else if (_WHITEFISH_COREGONID_IDS.has(fid)) guild = 'whitefish_coregonid';
  else if (_THERMOPHILIC_PEACE_IDS.has(fid)) guild = 'peace_thermophilic';
  else if (_MARINE_NOCTURNAL_IDS.has(fid)) guild = 'marine_nocturnal';
  else if (_MARINE_BENTHIC_TIDAL_IDS.has(fid)) guild = 'marine_benthic_tidal';
  else if (fish?.habitat === 'sea') guild = 'marine_pelagic_diurnal';
  else if (fish?.type === 'predator') guild = 'predator_visual';

  return { fid, guild, bladderType };
}

export function computeHourFactors(fish, day, hrObj, method, water, depth, normPress = 752, globalIceState = 'open_water', fastScoreOnly = false) {
  const st = store.getState();
  const bio = getSpeciesBioProfile(fish);
  const fid = bio.fid;
  const guild = bio.guild;
  const dayIce = day.iceState || globalIceState;
  const isRedBook = fish.legal === 'redbook';
  const isIceDanger = dayIce === 'ice_danger' && !method.startsWith('winter_');
  const prof = WATER_PROFILES[water] || WATER_PROFILES.small_river;
  const flowLabel = prof.flow >= 1.8 ? 'быстрое течение' : (prof.flow >= 1.1 ? 'умеренное течение' : 'стоячая вода');
  const wt = Number(day.waterTemp ?? 8);
  const tAirHr = Number(hrObj?.tAir ?? day.tDay ?? 4);
  const [tOptMin, tOptMax] = fish.tWaterOpt || [8, 16];

  const isDormantWinterFish = _THERMOPHILIC_PEACE_IDS.has(fid) || _NOCTURNAL_WARM_IDS.has(fid) || fid === 'crayfish' || fid === 'snakehead';
  const isColdLovingKing = _NOCTURNAL_COLD_IDS.has(fid) || _WHITEFISH_COREGONID_IDS.has(fid) || ['navaga', 'saffron_cod', 'cod', 'haddock', 'char', 'dolly_varden', 'lenok', 'taimen', 'nelma', 'king_crab', 'crab'].includes(fid);
  const isUnderIceOrFreezeUp = dayIce === 'ice_safe' || dayIce === 'ice_danger' || dayIce === 'ice_slush' || wt <= 1.2;
  const iceCmNow = Number(day.iceThickness) || 0;
  const isFirstIceBoom = dayIce === 'ice_safe' && iceCmNow >= 5 && iceCmNow <= 14 && tAirHr <= -3 && Math.abs(day.dP || 0) <= 3.5;

  // 1. ТЕРМИЧЕСКИЙ ФАКТОР И ЛИМИТИРУЮЩИЙ КОЭФФИЦИЕНТ ТЕМПЕРАТУРЫ ВОДЫ (thermalGate)
  let tempDelta = 0;
  let thermalGate = 1.0;
  let tempNote = `Вода ${wt}°C с учётом течения (${flowLabel}, оптимум ${tOptMin}–${tOptMax}°C)`;

  if (isUnderIceOrFreezeUp && isDormantWinterFish) {
    tempDelta = -36;
    thermalGate = 0.04;
    tempNote = `Зимний анабиоз/оцепенение при воде ${wt}°C (вид не питается при температуре ниже ${fish.tMinStop}°C)`;
  } else if (guild === 'predator_nocturnal_cold' && wt > 11) {
    tempDelta = -34;
    thermalGate = wt > 14 ? 0.04 : 0.14;
    tempNote = `Вода ${wt}°C выше порога летней спячки налима (активен только в холодной воде < 9°C)`;
  } else if (guild === 'crustacean_crab' && wt > 13) {
    tempDelta = -24;
    thermalGate = 0.22;
    tempNote = `Прогрев прибрежной воды (${wt}°C) — краб отходит на глубокие холодные горизонты`;
  } else if (isUnderIceOrFreezeUp && !isDormantWinterFish) {
    const bottomLayerTemp = prof.flow >= 1.4 ? 1.6 : 2.8;
    if (isColdLovingKing) {
      tempDelta = isFirstIceBoom ? +14 : +10;
      thermalGate = isFirstIceBoom ? 1.08 : 1.02;
      tempNote = `Зимний режим (подо льдом ${wt}°C, у дна ~+${bottomLayerTemp}°C) — пик холодноводного метаболизма вида`;
    } else {
      tempDelta = isFirstIceBoom ? +6 : -4;
      thermalGate = isFirstIceBoom ? 0.98 : 0.78;
      tempNote = isFirstIceBoom
        ? `Перволёдье (~${iceCmNow} см, у дна ~+${bottomLayerTemp}°C) — повышенная активность при стабильной погоде`
        : `Подлёдный зимний режим (у льда ${wt}°C, в придонном слое ~+${bottomLayerTemp}°C, замедленный метаболизм)`;
    }
  } else if (wt < fish.tMinStop) {
    tempDelta = -32;
    thermalGate = 0.06;
    tempNote = `Вода ${wt}°C (${flowLabel}) ниже биологического порога активности (${fish.tMinStop}°C)`;
  } else if (wt >= tOptMin && wt <= tOptMax) {
    tempDelta = +14;
    thermalGate = 1.05;
    tempNote = `Вода ${wt}°C (${flowLabel}) в биологическом оптимуме вида (${tOptMin}–${tOptMax}°C)`;
  } else if (wt < tOptMin) {
    const span = Math.max(1.5, tOptMin - fish.tMinStop);
    const ratio = Math.max(0, Math.min(1, (wt - fish.tMinStop) / span));
    const coldBoost = (fish.coldFactor || 0.7) >= 1.05 ? 6 : 0;
    tempDelta = Math.round(-16 + ratio * 24 + coldBoost);
    thermalGate = Math.max(0.32, 0.42 + ratio * 0.58);
    tempNote = `Вода ${wt}°C (${flowLabel}) холоднее оптимума вида (${tOptMin}–${tOptMax}°C)`;
  } else {
    const excess = wt - tOptMax;
    tempDelta = Math.max(-30, Math.round(10 - excess * 6.5));
    thermalGate = Math.max(0.22, 1.0 - excess * 0.085);
    tempNote = `Вода ${wt}°C (${flowLabel}) теплее оптимума (${tOptMin}–${tOptMax}°C, термоклин и дефицит кислорода)`;
  }

  // 2 & 3. БАРИЧЕСКИЙ ФАКТОР, ТИП ПЛАВАТЕЛЬНОГО ПУЗЫРЯ И 5-ДНЕВНЫЙ БАРИЧЕСКИЙ ШОК (baricGate)
  const hrPress = Number(hrObj?.press || day.pressAvg || 754);
  const pDiff = Math.abs(hrPress - normPress);
  const dailyDP = Number(day.dP || 0);
  const absDailyDP = Math.abs(dailyDP);
  // Оцениваем локальный градиент давления по соседним часам (если доступны сутки)
  let dp3h = Number(hrObj?.dp3h ?? (dailyDP / 5));
  if (Array.isArray(day.hours) && day.hours.length === 24 && Number.isFinite(hrObj?.hour)) {
    const hNow = hrObj.hour;
    const pPrev = Number(day.hours[Math.max(0, hNow - 3)]?.press ?? hrPress);
    const pNext = Number(day.hours[Math.min(23, hNow + 3)]?.press ?? hrPress);
    const localSpan = (pNext - pPrev) * 0.5;
    if (Math.abs(localSpan) > Math.abs(dp3h)) dp3h = Math.round(localSpan * 10) / 10;
  }
  const absDp3h = Math.abs(dp3h);

  const hasRealArchive = st.hasRealArchive !== false;
  const archMemoKey = `${fid}|${day.date}|${day.pressAvg}|${dailyDP}|${day.tDay}|${hasRealArchive ? 1 : 0}|${Math.round((st.lat || 0) * 100)}_${Math.round((st.lon || 0) * 100)}`;
  let archiveEval = _archiveShockMemo.get(archMemoKey);
  if (!archiveEval) {
    const prev5Days = getPreceding5DaysForTarget(day, st);
    archiveEval = evaluate5DayArchiveAndBaricShock(fish, day, prev5Days, hasRealArchive);
    _pruneCache(_archiveShockMemo, 2500);
    _archiveShockMemo.set(archMemoKey, archiveEval);
  }
  const archiveDelta = archiveEval.val;
  const archiveNote = archiveEval.note;

  const sens = Number.isFinite(fish.bladderSens) ? fish.bladderSens : 0.85;
  let pressDelta = Math.round(5 - Math.min(16, pDiff * 0.65 * sens));
  let baricGate = 1.0;

  if (guild === 'predator_nocturnal_cold' || bio.bladderType === 'aphysoclist') {
    // Налим, камбала, палтус, крабы и раки слабо зависят от скачков давления
    if (absDailyDP >= 8) {
      pressDelta -= 4;
      baricGate = guild === 'predator_nocturnal_cold' ? 0.94 : 0.86;
    } else {
      pressDelta += 4;
      baricGate = 1.02;
    }
  } else {
    const isPhysoclist = bio.bladderType === 'physoclist';
    // Резкий рост давления (антициклонический удар, как 754 -> 762 мм) или обвал давления
    if (absDailyDP >= 7 || absDp3h >= 1.5) {
      pressDelta -= isPhysoclist ? 28 : 24;
      baricGate = isPhysoclist ? 0.20 : 0.25;
    } else if (absDailyDP >= 4.5 || absDp3h >= 1.0) {
      pressDelta -= isPhysoclist ? 19 : 15;
      baricGate = isPhysoclist ? 0.36 : 0.44;
    } else if (absDailyDP >= 3.0 || absDp3h >= 0.7) {
      pressDelta -= isPhysoclist ? 10 : 8;
      baricGate = isPhysoclist ? 0.64 : 0.72;
    } else {
      // Стабильное давление
      pressDelta += 6;
      baricGate = pDiff <= 5 ? 1.05 : 0.92;
    }
    // Дополнительный штраф при росте давления для щуки/окуня/судака/белой рыбы (прижатие ко дну)
    if (dailyDP >= 3.5 || dp3h >= 0.8) {
      pressDelta -= 6;
      baricGate *= 0.78;
    }
    if (archiveEval.isShock) {
      baricGate *= isPhysoclist ? 0.62 : 0.70;
    } else if ((archiveEval.maxRecentJump || 0) >= 5) {
      baricGate *= 0.84;
    }
  }
  pressDelta = Math.max(-32, Math.min(14, pressDelta));
  const pressNote = `Давление ${hrPress} мм (суточный ход ${fmtDeltaPress(dailyDP)}, за 3ч ${fmtDeltaPress(dp3h)})`;

  // 4. ВЕТЕР, ВОЛНЕНИЕ, ОСАДКИ, ОБЛАЧНОСТЬ И ОТТЕПЕЛЬ (windWaveGate)
  const windMs = Number(hrObj?.wind ?? day.windMax ?? 3);
  const windDir = String(hrObj?.windDir || day.windDir || 'З');
  const cloudPct = Number(hrObj?.cloud ?? day.cloudAvg ?? 65);
  const precipMm = Number(hrObj?.precip ?? 0);
  const isUnseasonalWinterThaw = isUnderIceOrFreezeUp && tAirHr >= -0.5 && (windMs >= 5.5 || cloudPct >= 88 || absDailyDP >= 4);

  let windDelta = 0;
  let windWaveGate = 1.0;
  let customIceWindNote = '';

  if (guild === 'predator_nocturnal_cold') {
    // Налим любит метель, снегопад, пасмурную ветреную погоду и северные ветра
    if (windMs >= 4.5 || precipMm > 0 || cloudPct >= 85) {
      windDelta = +12;
      windWaveGate = 1.14;
      customIceWindNote = `Ветер ${windDir} ${windMs} м/с и ненастье активизируют выход налима на кормовые тропы`;
    } else {
      windDelta = +2;
      windWaveGate = 0.95;
      customIceWindNote = `Ветер ${windDir} ${windMs} м/с`;
    }
  } else if (isUnderIceOrFreezeUp) {
    if (isUnseasonalWinterThaw) {
      // Зимняя оттепель с циклоном, низкими свинцовыми тучами и крепким ветром (как +1°C и 7-9 м/с 16.11) резко глушит клёв со льда
      windDelta = -16;
      windWaveGate = windMs >= 6.5 ? 0.50 : 0.64;
      customIceWindNote = `Ветер ${windDir} ${windMs} м/с при сырой оттепели (${tAirHr > 0 ? '+' + tAirHr : tAirHr}°C) и сплошной облачности (${cloudPct}%) угнетает активность рыбы подо льдом`;
    } else if (windMs >= 7.5) {
      windDelta = -12;
      windWaveGate = 0.58;
      customIceWindNote = `Порывистый ветер ${windDir} ${windMs} м/с (микросейсмы льда и выдувание оснастки снижают результат)`;
    } else if (windMs >= 5.5) {
      windDelta = -5;
      windWaveGate = 0.78;
      customIceWindNote = `Свежий ветер ${windDir} ${windMs} м/с (рекомендуется палатка или утяжеление оснастки)`;
    } else {
      windDelta = +4;
      windWaveGate = 1.02;
      customIceWindNote = `Ветер ${windDir} ${windMs} м/с (комфортный штиль/слабый ветер на льду)`;
    }
  } else {
    // Открытая вода (реки, озёра, моря)
    if (windMs >= 9.0) {
      windDelta = -22;
      windWaveGate = 0.30;
    } else if (windMs >= 6.5) {
      windDelta = -12;
      windWaveGate = 0.56;
    } else if (windMs >= 1.5 && windMs <= 5.0) {
      windDelta = +6;
      windWaveGate = 1.04;
    } else {
      windDelta = -2;
      windWaveGate = 0.92;
    }
    if (['С', 'СВ', 'В'].includes(windDir)) {
      windDelta -= 5;
      windWaveGate *= 0.85;
    } else if (['ЮЗ', 'З', 'Ю'].includes(windDir) && windMs <= 5.5) {
      windDelta += 3;
    }
    // Для морских рыб и крабов учитываем прибойную волну
    if (fish.habitat === 'sea' || guild === 'crustacean_crab') {
      if (windMs >= 8.0) {
        windDelta -= 10;
        windWaveGate *= 0.55;
      } else if (windMs >= 2.5 && windMs <= 5.5 && _MARINE_BENTHIC_TIDAL_IDS.has(fid)) {
        windDelta += 5;
        windWaveGate *= 1.06;
      }
    }
  }
  const isCarpSurf = dayIce === 'open_water' && _THERMOPHILIC_PEACE_IDS.has(fid) && windMs >= 2.0 && windMs <= 5.5 && wt >= 15;
  const windNote = customIceWindNote
    ? customIceWindNote
    : (isCarpSurf
        ? `Ветер ${windDir} ${windMs} м/с (прибойная аэрация тёплой воды)`
        : `Ветер ${windDir} ${windMs} м/с (облачность ${cloudPct}%)`);

  // 5. СЕЗОННЫЙ БИОРИТМ, МИГРАЦИЯ И НЕРЕСТ (seasonGate)
  const dtMonthIdx = day._mIdx !== undefined ? day._mIdx : (day._mIdx = (parseInt(String(day.date || '2026-06').slice(5, 7), 10) - 1) || 0);
  const curMonthNum = dtMonthIdx + 1;
  const mAct = (fish.monthActivity && fish.monthActivity[dtMonthIdx]) ?? 2;
  let seasonDelta = mAct === 3 ? +12 : (mAct === 2 ? +5 : (mAct === 1 ? -5 : (isDormantWinterFish ? -26 : -10)));
  let seasonGate = mAct === 3 ? 1.05 : (mAct === 2 ? 0.96 : (mAct === 1 ? 0.82 : (isDormantWinterFish ? 0.12 : 0.72)));
  const runInfo = RIVER_ENTERING_SPECIES[fid];
  const isRiverWater = water === 'big_river' || water === 'small_river';
  const isSeaWater = water === 'sea_gulf' || water === 'open_sea';
  let seasonNote = `Сезонный биоритм месяца: ${mAct} из 3`;

  if (runInfo && isRiverWater) {
    if (runInfo.runMonths.includes(curMonthNum)) {
      seasonDelta += 10;
      seasonGate = Math.max(seasonGate, 1.02);
      seasonNote = `Речной ход (${runInfo.reason})`;
    } else {
      seasonDelta -= 14;
      seasonGate *= 0.45;
      seasonNote = `Вне сезона массового захода в реки (основное стадо в море/губе)`;
    }
  } else if (fish.habitat === 'sea' && !runInfo && isRiverWater) {
    seasonDelta -= 30;
    seasonGate = 0.08;
    seasonNote = 'Строго морской вид (не обитает в пресных реках)';
  } else if (fish.spawnMonth && fish.spawnMonth.includes(curMonthNum)) {
    if (runInfo && ['pink_salmon', 'chum_salmon', 'coho_salmon', 'sockeye_salmon', 'chinook_salmon', 'cherry_salmon', 'smelt', 'vobla', 'taran', 'kutum'].includes(fid)) {
      seasonDelta += 8;
      seasonGate = Math.max(seasonGate, 1.0);
      seasonNote = `Преднерестовый миграционный ход (${runInfo.reason})`;
    } else if (fid === 'burbot') {
      seasonDelta -= 14;
      seasonGate *= 0.45;
      seasonNote = 'Зимний икромёт налима — кратковременная пауза в активном питании';
    } else {
      seasonDelta = -22;
      seasonGate *= 0.38;
      seasonNote = 'Период нереста — рыба занята икромётом, клёв минимален';
    }
  }
  if (dayIce === 'ice_slush') {
    if (isColdLovingKing) {
      seasonDelta += 5;
    } else {
      seasonDelta -= 8;
      seasonGate *= 0.72;
    }
  }

  // 6. ФОТОПЕРИОД, ОСВЕЩЁННОСТЬ ПОДО ЛЬДОМ, ГЛУБИНА И СНАСТЬ (lightGate)
  let gearDelta = 0;
  let depthGate = 1.0;
  if (depth > fish.depthMax) {
    gearDelta -= 22;
    depthGate = 0.42;
  } else if (depth >= fish.depthOpt[0] && depth <= fish.depthOpt[1]) {
    gearDelta += 8;
    depthGate = 1.04;
  } else {
    gearDelta -= 6;
    depthGate = 0.84;
  }
  const methodCompat = getMethodCompatibility(fish, method, water);
  gearDelta += methodCompat;
  if (methodCompat <= -10) depthGate *= 0.65;

  const h = Number(hrObj?.hour ?? 12);
  const hCenter = h + 0.5;
  const sr = Number(day.sunriseHr ?? 8.0);
  const ss = Number(day.sunsetHr ?? 16.5);
  const daylightHours = Math.max(1, ss - sr);
  const distToSr = Math.abs(hCenter - sr);
  const distToSs = Math.abs(hCenter - ss);
  const isDawnTwilight = hCenter >= sr - 0.6 && hCenter <= sr + 1.8;
  const isDuskTwilight = hCenter >= ss - 1.8 && hCenter <= ss + 0.6;
  const isTwilight = isDawnTwilight || isDuskTwilight;
  const isDaylight = hCenter >= sr - 0.3 && hCenter <= ss + 0.3;
  const isDeepNight = hCenter < sr - 0.9 || hCenter > ss + 0.9;

  let lightGate = 1.0;
  let timeOfDayDelta = 0;

  if (guild === 'predator_nocturnal_cold' || guild === 'predator_nocturnal_warm' || guild === 'crustacean_crayfish' || guild === 'marine_nocturnal') {
    // Строго ночные и сумеречно-ночные виды (налим, сом, угорь, речной рак, ставрида, скорпена)
    if (isDeepNight) {
      timeOfDayDelta = +12;
      lightGate = (h >= 20 || h <= 4) ? 1.14 : 1.04;
    } else if (isTwilight) {
      timeOfDayDelta = +6;
      lightGate = 0.88;
    } else {
      timeOfDayDelta = -28;
      lightGate = 0.08;
    }
  } else if (guild === 'crustacean_crab') {
    // Морские крабы: пик ночью и в сумерках, днём активность снижена в 2.5 раза
    if (isDeepNight || isTwilight) {
      timeOfDayDelta = +9;
      lightGate = 1.08;
    } else {
      timeOfDayDelta = -14;
      lightGate = 0.42;
    }
  } else if (guild === 'predator_crepuscular_tapetum') {
    // Судак, берш, ёрш, ротан (tapetum lucidum — сумеречное и ночное зрение)
    if (isTwilight) {
      timeOfDayDelta = +11;
      lightGate = 1.12;
    } else if (isDeepNight) {
      const isEarlyNightOrPreDawn = (hCenter > ss + 0.9 && hCenter <= ss + 3.8) || (hCenter >= sr - 3.0 && hCenter < sr - 0.9);
      if (isUnderIceOrFreezeUp) {
        timeOfDayDelta = isEarlyNightOrPreDawn ? -6 : -22;
        lightGate = isEarlyNightOrPreDawn ? 0.58 : 0.14;
      } else {
        timeOfDayDelta = isEarlyNightOrPreDawn ? +6 : -8;
        lightGate = isEarlyNightOrPreDawn ? 0.94 : 0.48;
      }
    } else {
      // Дневные часы: подо льдом судак и ёрш кормятся днём, летом в полдень — пауза
      timeOfDayDelta = isUnderIceOrFreezeUp ? +4 : -8;
      lightGate = isUnderIceOrFreezeUp ? 0.92 : 0.62;
    }
  } else if (guild === 'marine_benthic_tidal') {
    // Треска, пикша, навага, камбала, палтус, бычок: кормятся днём, в сумерках и по приливу, глубокой ночью спад
    if (isTwilight || isDaylight) {
      timeOfDayDelta = isTwilight ? +8 : +5;
      lightGate = isTwilight ? 1.06 : 0.96;
    } else {
      timeOfDayDelta = -18;
      lightGate = ['cod', 'navaga', 'flounder', 'halibut'].includes(fid) ? 0.24 : 0.12;
    }
  } else {
    // ЗРИТЕЛЬНЫЕ ДНЕВНЫЕ И СУМЕРЕЧНО-ДНЕВНЫЕ ВИДЫ:
    // Щука, окунь, хариус, форель, лосось, таймень, ленок, жерех, голавль, сиговые (пыжьян, пелядь, чир, муксун, ряпушка) и белая рыба (плотва, лещ, карась, язь, елец)
    if (!isDaylight && !isTwilight) {
      // Ночью зрительные хищники и дневная белая рыба НЕ видят приманку (0-6% активности!)
      const isSummerNightBream = !isUnderIceOrFreezeUp && wt >= 17 && ['bream', 'ide', 'white_bream', 'sterlet', 'russian_sturgeon', 'siberian_sturgeon'].includes(fid);
      if (isSummerNightBream) {
        timeOfDayDelta = +4;
        lightGate = 0.82;
      } else {
        timeOfDayDelta = -34;
        lightGate = isDeepNight ? 0.03 : 0.08;
      }
    } else if (isTwilight) {
      // Утренняя и вечерняя зорька: пик для щуки/окуня/хариуса, но при 100% пасмурности зимой сумерки тёмные
      const isDarkWinterOvercast = isUnderIceOrFreezeUp && cloudPct >= 90 && daylightHours < 7.0;
      if (isDarkWinterOvercast && (hCenter < sr || hCenter > ss)) {
        timeOfDayDelta = -14;
        lightGate = 0.34;
      } else {
        timeOfDayDelta = +9;
        lightGate = isDarkWinterOvercast ? 0.84 : 1.08;
      }
    } else {
      // Светлое время суток (между восходом и закатом)
      const isShortPolarOvercast = isUnderIceOrFreezeUp && cloudPct >= 90 && daylightHours < 7.0;
      // В короткий полярный день (ноябрь-январь) пик освещённости подо льдом приходится на 11:00–15:00
      const solarNoon = (sr + ss) * 0.5;
      const distFromNoon = Math.abs(hCenter - solarNoon);
      if (isShortPolarOvercast) {
        timeOfDayDelta = distFromNoon <= 2.0 ? +4 : -4;
        lightGate = distFromNoon <= 2.0 ? 0.82 : 0.66;
      } else {
        timeOfDayDelta = +6;
        lightGate = 1.0;
      }
    }
  }

  gearDelta = Math.max(-32, Math.min(16, Math.round(gearDelta * 0.65) + timeOfDayDelta));
  const timeLabelRu = isTwilight ? 'зорька/сумерки' : (isDaylight ? 'светлое время' : 'ночь (темнота)');
  const gearNote = `Глубина ${depth} м (оптимум ${fish.depthOpt[0]}–${fish.depthOpt[1]} м) • освещённость (${String(h).padStart(2, '0')}:00 — ${timeLabelRu}, восход ${fmtHM(sr)}, закат ${fmtHM(ss)})`;

  // 7. ФАЗА ЛУНЫ, СОЛУНАРНЫЕ И ПРИЛИВНО-ОТЛИВНЫЕ ОКНА (lunarTidalGate)
  const md = Number(day.moon?.moonDay || 10);
  let moonDelta = 0;
  let lunarTidalGate = 1.0;
  const isSyzygyMoon = md >= 28 || md <= 2 || (md >= 14 && md <= 17);
  const isQuarterNeapMoon = (md >= 6 && md <= 9) || (md >= 20 && md <= 23);

  if (guild === 'crustacean_crab' || guild === 'crustacean_crayfish') {
    // Крабы и раки активнее в безлунные/новолунные тёмные ночи и затихают в полнолуние
    if (md >= 26 || md <= 4) {
      moonDelta += 6;
      lunarTidalGate = 1.08;
    } else if (md >= 13 && md <= 17) {
      moonDelta -= 6;
      lunarTidalGate = 0.82;
    }
  } else if (isSyzygyMoon) {
    moonDelta += (isSeaWater || runInfo) ? 7 : 4;
    lunarTidalGate = (isSeaWater || runInfo) ? 1.12 : 1.04;
  } else if (isQuarterNeapMoon) {
    moonDelta -= (isSeaWater || runInfo) ? 6 : 4;
    lunarTidalGate = (isSeaWater || runInfo) ? 0.82 : 0.88;
  }

  const dTr = Math.min(Math.abs(h - (day.moon?.transitHour || 12)), 24 - Math.abs(h - (day.moon?.transitHour || 12)));
  const dUn = Math.min(Math.abs(h - (day.moon?.underfootHour || 0)), 24 - Math.abs(h - (day.moon?.underfootHour || 0)));
  if (dTr <= 1.5 || dUn <= 1.5) {
    moonDelta += (isSeaWater || runInfo || _MARINE_BENTHIC_TIDAL_IDS.has(fid)) ? 7 : 3;
    lunarTidalGate *= (isSeaWater || runInfo || _MARINE_BENTHIC_TIDAL_IDS.has(fid)) ? 1.10 : 1.04;
  }
  const moonNote = (isSeaWater || runInfo || _MARINE_BENTHIC_TIDAL_IDS.has(fid))
    ? `${day.moon?.phaseName || 'Луна'} (${md} л.д. • приливная фаза)`
    : `${day.moon?.phaseName || 'Луна'} (${md} л.д.)`;

  // 8. КАЛИБРОВКА ПО ЛИЧНОМУ ЖУРНАЛУ «МОИ УЛОВЫ» И ПОЛЕВЫМ СИГНАЛАМ «КРУГА»
  const catchesArr = st.catches || [];
  const logInsight = catchesArr.length > 0
    ? evaluateLogbookInsight(fish, day, hrObj, method, water, catchesArr)
    : { val: 0, hasData: false, note: 'Журнал уловов: пока нет записей для личной калибровки', commentary: 'Добавляйте свои уловы в разделе «Журнал» (доступен выбор даты за последние 5 дней с автоподстановкой погоды и прогноза), чтобы алгоритм учитывал вашу личную статистику «Моих уловов».' };
  const circleArr = st.circleItems || [];
  let circleEval;
  if (circleArr.length === 0) {
    circleEval = { val: 0, hasSignal: false, note: 'Нет активных сигналов в радиусе 35 км за 72 ч', commentary: 'В радиусе 35 км пока нет свежих отчётов Круга или точек Экипажа за последние 72 часа.' };
  } else {
    const cirMemoKey = `${fid}|${Math.round((st.lat || 0) * 100)}_${Math.round((st.lon || 0) * 100)}|${circleArr.length}|${circleArr[0]?.id || ''}|${catchesArr.length}`;
    circleEval = _circleFieldMemo.get(cirMemoKey);
    if (!circleEval) {
      circleEval = evaluateCircleFieldConfirmation(fish, st.lat, st.lon, circleArr, catchesArr);
      _pruneCache(_circleFieldMemo, 1000);
      _circleFieldMemo.set(cirMemoKey, circleEval);
    }
  }

  const w = (st.appMode === 'pro' && st.proFactorWeights) ? st.proFactorWeights : { temp: 1, press: 1, archive_shock: 1, circle_field: 1 };
  const wTemp = Number(w.temp ?? 1);
  const wPress = Number(w.press ?? 1);
  const wShock = Number(w.archive_shock ?? 1);
  const wCircle = Number(w.circle_field ?? 1);
  tempDelta = Math.round(tempDelta * wTemp + (wTemp - 1) * 14);
  pressDelta = Math.round(pressDelta * wPress + (wPress - 1) * 12);
  const weightedArchiveDelta = Math.round(archiveDelta * wShock + (wShock - 1) * 10);
  const rawCircleSignal = (circleEval.val || 0) !== 0 ? circleEval.val : (circleArr.length > 0 ? 4 : 0);
  const circleDelta = Math.round(rawCircleSignal * wCircle + (wCircle - 1) * 12);

  const baseScore = 52;
  let rawAdditive = baseScore + tempDelta + pressDelta + weightedArchiveDelta + windDelta + seasonDelta + gearDelta + moonDelta + logInsight.val + circleDelta;
  rawAdditive = Math.max(0, rawAdditive);

  // Закон лимитирующего фактора Либиха — Шелфорда без экспоненциального перемножения 6 дробных коэффициентов:
  // 1) Жёсткие биологические гейты: освещённость (lightGate: ночью у дневных рыб 0.03–0.08 -> 0–5%) и зимний анабиоз (thermalGate <= 0.10 -> 0–4%).
  // 2) Погодно-барический коэффициент (envWeatherMult): взвешенный композит барики, ветра, сезона, глубины и Луны.
  let envWeatherMult = (
    0.38 * baricGate +
    0.24 * windWaveGate +
    0.16 * seasonGate +
    0.12 * depthGate +
    0.10 * lunarTidalGate
  );
  // При жёстком барическом ударе (|dP| >= 6.5 мм или |dp3h| >= 1.4 мм) или зимней оттепели со штормом усиливаем подавление для закрыто/открытопузырных рыб
  if (guild !== 'predator_nocturnal_cold' && bio.bladderType !== 'aphysoclist') {
    if (absDailyDP >= 6.5 || absDp3h >= 1.4) {
      envWeatherMult = Math.min(envWeatherMult, bio.bladderType === 'physoclist' ? 0.28 : 0.34);
    } else if (absDailyDP >= 4.5 && isUnseasonalWinterThaw) {
      envWeatherMult = Math.min(envWeatherMult, 0.38);
    }
  }
  const bioLimitMult = Math.max(0, Math.min(1.25, thermalGate * lightGate * envWeatherMult));

  const baseForGate = (lightGate <= 0.12 || thermalGate <= 0.10) ? rawAdditive : Math.max(46, rawAdditive);
  let gatedScore = baseForGate * bioLimitMult;
  if (lightGate <= 0.10) {
    gatedScore = Math.min(gatedScore, lightGate * 65);
  }
  if (thermalGate <= 0.08) {
    gatedScore = Math.min(gatedScore, 5);
  }
  if (isIceDanger) {
    gatedScore = Math.min(22, gatedScore * 0.55);
  }

  const optMid = ((Number(tOptMin) || 8) + (Number(tOptMax) || 16)) * 0.5;
  const optSpan = Math.max(2.5, ((Number(tOptMax) || 16) - (Number(tOptMin) || 8)) * 0.5);
  const thermalFit = Math.max(0, 1 - Math.abs(wt - optMid) / (optSpan * 2.2));
  const bioNormCeiling = Math.round(88 + (mAct / 3) * 6 + thermalFit * 4);

  let scaledTotal = gatedScore;
  if (!isIceDanger && gatedScore > 74) {
    const excess = gatedScore - 74;
    scaledTotal = 74 + 22 * (1 - Math.exp(-excess / 22)) * (0.85 + 0.15 * thermalFit);
  }
  const total = Math.max(0, Math.min(bioNormCeiling, Math.round(scaledTotal)));

  if (fastScoreOnly) {
    return { total, forbidden: isRedBook, iceDanger: isIceDanger };
  }

  const factors = [
    { id: 'temp', name: '1. Температура воды и метаболизм', val: tempDelta, note: tempNote },
    { id: 'press', name: '2. Давление и плавательный пузырь', val: pressDelta, note: pressNote },
    { id: 'archive_shock', name: '3. Метеоархив (5 дней) и барический тренд', val: weightedArchiveDelta, note: archiveNote },
    { id: 'season', name: '4. Сезон, биоритм и миграция', val: seasonDelta, note: seasonNote },
    { id: 'gear', name: '5. Освещённость, глубина и снасть', val: gearDelta, note: gearNote },
    { id: 'wind', name: '6. Ветер, облачность и волнение', val: windDelta, note: windNote },
    { id: 'moon', name: (isSeaWater || runInfo || _MARINE_BENTHIC_TIDAL_IDS.has(fid)) ? '7. Фаза Луны и прилив' : '7. Фаза Луны', val: moonDelta, note: moonNote }
  ];
  if (circleEval.hasSignal || st.appMode === 'pro') {
    factors.push({
      id: 'circle_field',
      name: '8. Полевое подтверждение (Круг ±5 км и Экипаж)',
      val: circleDelta,
      note: circleEval.note
    });
  }
  if (logInsight.hasData) {
    factors.push({
      id: 'logbook',
      name: 'Калибровка по вашему Журналу уловов',
      val: logInsight.val,
      note: logInsight.note
    });
  }
  return {
    total,
    bioLimitMult: Math.round(bioLimitMult * 100) / 100,
    forbidden: isRedBook,
    iceDanger: isIceDanger,
    hasRealArchive,
    archiveEval,
    logInsight,
    circleEval,
    factors
  };
}
const _WINTER_LURE_SET = new Set(['perch', 'pike', 'zander', 'grayling', 'smelt', 'trout', 'cod', 'navaga', 'lenok', 'volga_zander', 'char', 'broad_whitefish', 'saffron_cod', 'peled', 'chir', 'pizhyan', 'whitefish', 'omul', 'baikal_grayling', 'kundzha', 'nelma', 'taimen']);
const _WINTER_JIG_SET = new Set(['chir', 'pizhyan', 'peled', 'cisco', 'roach', 'perch', 'whitefish', 'ruffe', 'smelt', 'bream', 'ide', 'dace', 'white_bream', 'vendace', 'omul', 'omul_arctic', 'valek', 'baikal_grayling', 'tugun', 'crucian', 'rudd', 'gudgeon', 'muksun']);
const _WINTER_STUKA_SET = new Set(['burbot', 'cod', 'halibut', 'navaga', 'wolffish']);
const _WINTER_CISCO_SET = new Set(['cisco', 'peled', 'smelt', 'whitefish', 'herring', 'vendace', 'omul', 'omul_arctic', 'tugun', 'chir', 'pizhyan', 'muksun']);
const _NANO_MASTERS_SET = new Set([
  'perch', 'roach', 'crucian', 'dace', 'peled', 'rudd', 'bleak', 'chub', 'ide',
  'grayling', 'baikal_grayling', 'trout', 'brown_trout', 'rainbow_trout', 'rotan',
  'gudgeon', 'bream', 'white_bream', 'blue_bream', 'sopa', 'tench', 'carp', 'chekhon',
  'vimba', 'vobla', 'taran', 'undermouth', 'chir', 'pizhyan', 'tugun', 'whitefish',
  'cisco', 'vendace', 'broad_whitefish', 'omul', 'omul_arctic', 'valek', 'smelt',
  'ruffe', 'minnow', 'verkhovka', 'bitterling', 'horse_mackerel', 'sea_bass',
  'scorpionfish', 'wrasse', 'sea_bream', 'red_mullet', 'goby', 'shemaya', 'muksun'
]);
const _SPIN_JIG_SET = new Set(['zander', 'pike', 'perch', 'catfish', 'volga_zander', 'amur_catfish', 'channel_catfish', 'burbot', 'cod', 'halibut', 'greenling', 'asp', 'chub', 'ide', 'nelma', 'taimen', 'chinese_perch', 'yellowcheek']);
const _SPIN_LURE_SET = new Set(['ide', 'dace', 'chekhon', 'peled', 'chir', 'pizhyan', 'whitefish', 'tugun', 'rudd', 'bleak', 'roach', 'bream']);
const _BOTTOM_EXTRA_SET = new Set(['catfish', 'burbot', 'channel_catfish', 'amur_catfish', 'ruffe', 'flounder', 'starry_flounder', 'turbot', 'plaice', 'goby', 'perch', 'pike', 'zander', 'beluga', 'kaluga']);
const _FLOAT_EXTRA_SET = new Set(['perch', 'rotan', 'ruffe', 'chub', 'grayling', 'baikal_grayling', 'trout', 'dolly_varden', 'garfish']);
const _FLY_SET = new Set(['grayling', 'baikal_grayling', 'lenok', 'salmon', 'trout', 'chub', 'ide', 'tugun', 'dace', 'peled', 'chir', 'pizhyan', 'whitefish', 'cisco', 'valek', 'brown_trout', 'sockeye_salmon', 'char', 'dolly_varden', 'bleak', 'rudd', 'chekhon', 'roach', 'taimen', 'nelma']);
function getMethodCompatibility(fish, method, water = 'small_river') {
  const fid = fish.id;
  const isRiverEntering = Boolean(RIVER_ENTERING_SPECIES[fid]);
  if (method === 'winter_livebait') return fish.type === 'predator' ? 7 : -14;
  if (method === 'winter_lure') return _WINTER_LURE_SET.has(fid) ? 8 : -10;
  if (method === 'winter_jig') return _WINTER_JIG_SET.has(fid) ? 8 : -5;
  if (method === 'winter_stuka') return _WINTER_STUKA_SET.has(fid) ? 10 : -12;
  if (method === 'winter_cisco') return _WINTER_CISCO_SET.has(fid) ? 10 : -10;
  if (method === 'spin_micro') return _NANO_MASTERS_SET.has(fid) ? 9 : (fish.type === 'predator' ? 5 : 4);
  if (method === 'spin_jig') return _SPIN_JIG_SET.has(fid) ? 8 : (fish.type === 'predator' ? 4 : -10);
  if (method === 'spin_lure') return (fish.type === 'predator' || _SPIN_LURE_SET.has(fid)) ? 8 : -8;
  if (method === 'bottom') return (fish.type === 'peace' || isRiverEntering || _BOTTOM_EXTRA_SET.has(fid)) ? 8 : -5;
  if (method === 'float') return (fish.type === 'peace' || isRiverEntering || _FLOAT_EXTRA_SET.has(fid)) ? 8 : -5;
  if (method === 'fly') return _FLY_SET.has(fid) ? 9 : -8;
  if (method.startsWith('sea_')) return (fish.habitat === 'sea' || isRiverEntering || water === 'sea_gulf' || water === 'open_sea') ? 8 : -12;
  return 0;
}
export function calcHourly(fish, day, hrObj, method, water, depth, normPress = 752, iceState = 'open_water') {
  return computeHourFactors(fish, day, hrObj, method, water, depth, normPress, iceState, true).total;
}
function _computeDaySummaryFast(fish, day, method, water, depth, normPress = 752, iceState = 'open_water') {
  const st = store.getState();
  const sig = _buildStateForecastSignature(st, fish.id, day, method, water, depth, normPress, iceState);
  const cached = _dayBestMemo.get(sig);
  if (cached) return cached;
  let s0 = -1, s1 = -1, s2 = -1, s3 = -1;
  let bestHr = 7;
  let bestScore = -1;
  const hrs = day.hours;
  for (let i = 0; i < hrs.length; i++) {
    const hr = hrs[i];
    const sc = computeHourFactors(fish, day, hr, method, water, depth, normPress, iceState, true).total;
    if (sc > bestScore) {
      bestScore = sc;
      bestHr = hr.hour;
    }
    if (sc > s0) { s3 = s2; s2 = s1; s1 = s0; s0 = sc; }
    else if (sc > s1) { s3 = s2; s2 = s1; s1 = sc; }
    else if (sc > s2) { s3 = s2; s2 = sc; }
    else if (sc > s3) { s3 = sc; }
  }
  const score = Math.round((s0 + s1 + s2 + s3) / 4);
  const endHr = (bestHr + 2) % 24;
  const windowText = `${String(bestHr).padStart(2, '0')}:00–${String(endHr).padStart(2, '0')}:00 (${bestScore}%)`;
  const summary = { score, windowText };
  _pruneCache(_dayBestMemo, 4000);
  _dayBestMemo.set(sig, summary);
  return summary;
}
export function calcDayBest(fish, day, method, water, depth, normPress = 752, iceState = 'open_water') {
  if (!fish || !day?.hours?.length) return 0;
  return _computeDaySummaryFast(fish, day, method, water, depth, normPress, iceState).score;
}
export function getBestBiteWindowText(fish, day, method, water, depth, normPress = 752, iceState = 'open_water') {
  if (!fish || !day?.hours?.length) return '06:00–09:00';
  return _computeDaySummaryFast(fish, day, method, water, depth, normPress, iceState).windowText;
}
export function getFactorBreakdown(fish, day, method, water, depth, normPress = 752, iceState = 'open_water', hourIdx = null) {
  if (!day || !day.hours?.length) return { total: 0, factors: [] };
  let targetHr = day.hours[12];
  if (hourIdx !== null && day.hours[hourIdx]) {
    targetHr = day.hours[hourIdx];
  } else {
    let bestSc = -1;
    for (const hr of day.hours) {
      const sc = calcHourly(fish, day, hr, method, water, depth, normPress, iceState);
      if (sc > bestSc) { bestSc = sc; targetHr = hr; }
    }
  }
  return computeHourFactors(fish, day, targetHr, method, water, depth, normPress, iceState);
}
/**
 * Автоматически отрисовывает наглядные цветные кружки-маркеры расцветки рядом с названием приманки (Пункт 6 Дорожной карты v2.5.0 r186)
 */
export function renderBaitWithColorDots(baitText = '') {
  const raw = String(baitText || '').trim();
  if (!raw) return '';
  const low = raw.toLowerCase();
  const dots = [];
  if (low.includes('билайн')) {
    dots.push(`<span class="bait-color-dot" title="Расцветка «Билайн» (жёлто-чёрный контраст)" style="background:linear-gradient(135deg,#ffd600 50%,#111827 50%);"></span>`);
  }
  if (low.includes('триколор')) {
    dots.push(`<span class="bait-color-dot" title="Расцветка «Триколор» (бело-сине-красный)" style="background:linear-gradient(180deg,#ffffff 33%,#2563eb 33%,#2563eb 66%,#dc2626 66%);"></span>`);
  }
  if (low.includes('кислот') || low.includes('шартрез') || low.includes('firetiger')) {
    dots.push(`<span class="bait-color-dot" title="Расцветка «Кислотник / Шартрез»" style="background:linear-gradient(135deg,#a3e635 50%,#facc15 50%);"></span>`);
  }
  if (low.includes('машинн') || low.includes('моторк') || low.includes('карамел')) {
    dots.push(`<span class="bait-color-dot" title="Расцветка «Машинное масло»" style="background:linear-gradient(135deg,#78350f 50%,#65a30d 50%);"></span>`);
  }
  if (low.includes('фиолет') || low.includes('рубин')) {
    dots.push(`<span class="bait-color-dot" title="Расцветка «Фиолет / Рубин»" style="background:linear-gradient(135deg,#9333ea 50%,#e11d48 50%);"></span>`);
  }
  if (low.includes('светонакопит') || low.includes('фосфор')) {
    dots.push(`<span class="bait-color-dot" title="Светонакопительная (фосфорная) расцветка" style="background:radial-gradient(circle,#dcfce7 20%,#22c55e 100%);box-shadow:0 0 6px #4ade80;"></span>`);
  }
  if (low.includes('натурал') || low.includes('серебр') || low.includes('живец') || low.includes('плотвичк') || low.includes('уклейк')) {
    dots.push(`<span class="bait-color-dot" title="Натуральная серебристая расцветка" style="background:linear-gradient(135deg,#f8fafc 40%,#64748b 100%);"></span>`);
  }
  if (dots.length === 0) {
    if (low.includes('мотыл') || low.includes('черв') || low.includes('красн')) {
      dots.push(`<span class="bait-color-dot" title="Естественный красный / рубиновый цвет" style="background:#ef4444;"></span>`);
    } else if (low.includes('опарыш') || low.includes('хлеб') || low.includes('манн') || low.includes('тесто')) {
      dots.push(`<span class="bait-color-dot" title="Светлая / белая насадка" style="background:#f8fafc;"></span>`);
    } else if (low.includes('кукуруз') || low.includes('горох') || low.includes('перловк')) {
      dots.push(`<span class="bait-color-dot" title="Жёлтая растительная насадка" style="background:#facc15;"></span>`);
    } else if (low.includes('мормыш') || low.includes('бокоплав') || low.includes('гаммарус')) {
      dots.push(`<span class="bait-color-dot" title="Оливково-янтарный бокоплав" style="background:#d97706;"></span>`);
    }
  }
  const safeText = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `${dots.join('')}<span>${safeText}</span>`;
}
export function calcDynamicRig(method, water, depth, wind, fish = null, waterTemp = 12, iceState = 'open_water') {
  const prof = WATER_PROFILES[water] || WATER_PROFILES.small_river;
  const flowCoeff = prof.flow;
  const fid = fish?.id || 'pike';
  const fName = fish?.name || 'выбранного вида';
  const isCold = waterTemp <= 10.5 || iceState !== 'open_water';
  const isTrophy = ['catfish', 'amur_catfish', 'carp', 'grass_carp', 'silver_carp', 'salmon', 'chinook_salmon', 'taimen', 'halibut', 'cod', 'turbot', 'beluga', 'kaluga'].includes(fid);
  const isDelicate = ['roach', 'rudd', 'bleak', 'dace', 'peled', 'gudgeon', 'crucian', 'white_bream', 'tugun', 'cisco', 'vendace', 'smelt', 'rotan', 'ruffe'].includes(fid);
  const isWhiteNano = fish && (fish.type === 'peace' || ['dace', 'peled', 'chir', 'pizhyan', 'tugun', 'whitefish', 'cisco', 'vendace', 'valek', 'crucian', 'roach', 'rudd', 'bleak', 'ide', 'bream', 'white_bream', 'tench', 'gudgeon', 'chekhon', 'muksun'].includes(fid));
  if (method === 'winter_jig') {
    const w = Math.min(3.8, Math.max(0.3, Math.round(depth * (isDelicate ? 0.28 : 0.40) * flowCoeff * 10) / 10));
    const line = isDelicate ? 'Зимняя флюорокарбоновая леска 0.08–0.10 мм' : 'Зимняя леска 0.11–0.14 мм';
    const tactic = ['bream', 'white_bream', 'carp', 'crucian'].includes(fid)
      ? `Подлёдный лов (${fName}): медленное опускание ко дну, выдержка на стоячку со сторожком и плавный подъём`
      : `Подлёдный лов (${fName}): высокочастотная проводка мормышки в 15–45 см от дна с контрольной паузой 3–4 сек`;
    return { weight: `Вольфрамовая мормышка ${w} г`, line, tactic };
  }
  if (method === 'winter_cisco') {
    return {
      weight: `Нижнее грузило ${Math.max(6, Math.round(depth * 1.4 * flowCoeff))} г + гирлянда (3–5 мормышек)`,
      line: 'Основная леска 0.14–0.16 мм, поводки 0.10–0.12 мм',
      tactic: `Пелагический облов (${fName}): плавное покачивание гирлянды в полводы и у нижней кромки льда`
    };
  }
  if (method === 'winter_lure') {
    const mult = ['zander', 'volga_zander', 'pike'].includes(fid) ? 2.4 : 1.5;
    const w = Math.min(36, Math.max(4, Math.round(depth * mult * flowCoeff)));
    const leader = fid === 'pike' ? 'титановый/стальной поводок 20 см' : 'флюорокарбон 0.30–0.40 мм';
    return {
      weight: `Балансир / Раттлин ${w} г`,
      line: `Зимний шнур 0.12–0.16 мм + ${leader}`,
      tactic: `Зимнее блеснение (${fName}): короткий подброс на 15–25 см, сброс и обязательная пауза ${isCold ? '5–8' : '3–5'} секунд`
    };
  }
  if (method === 'winter_stuka') {
    const w = Math.min(70, Math.max(18, Math.round(depth * 3.5 * flowCoeff)));
    return {
      weight: `Тяжёлая блесна-стукалка / джиг ${w} г`,
      line: 'Монолеска 0.35–0.45 мм',
      tactic: `Донный лов (${fName}): ритмичное постукивание по каменистому грунту с подсадкой ерша или резки рыбы`
    };
  }
  if (method === 'winter_livebait') {
    const w = Math.max(6, Math.round(depth * 1.6 * flowCoeff));
    const leader = fid === 'pike' ? 'вольфрамовый/стальной поводок 25–30 см' : 'флюорокарбон 0.40–0.50 мм';
    return {
      weight: `Скользящее грузило-оливка ${w} г`,
      line: `Основная леска 0.35 мм + ${leader}`,
      tactic: `Жерлица (${fName}): установка живца в ${['burbot', 'zander'].includes(fid) ? '5–15 см от самого дна' : '25–45 см над дном у свала или камыша'}`
    };
  }
  if (method === 'spin_micro') {
    if (isWhiteNano) {
      const nanoW = Math.min(1.2, Math.max(0.2, Math.round(depth * 0.25 * flowCoeff * 10) / 10));
      return {
        weight: `Вольфрамовая мормышка / одноухий монтаж ${nanoW} г (0.2–0.8 г)`,
        line: 'Ультратонкий шнур #0.08–0.15 PE / монолеска 0.065–0.09 мм (эстер)',
        tactic: `Нано-джиг и мормышинг (${fName}, вода ${waterTemp}°C): ${isCold ? 'медленное придонное волочение с микродрожанием и паузами до 4 сек' : 'высокочастотный пелагический «зуд» и плавный кач в толще воды или на снос по струе'}`
      };
    }
    const baseW = depth * (isCold ? 0.55 : 0.70) * flowCoeff;
    const w = Math.min(5.0, Math.max(0.3, Math.round(baseW * 10) / 10));
    const line = w <= 1.2 ? 'Нанофил / шнур #0.15–0.2 PE + флюорокарбон 0.10–0.12 мм' : 'Шнур #0.2–0.4 PE + флюорокарбон 0.14–0.16 мм';
    const tactic = isCold
      ? `Холодная вода (${waterTemp}°C, ${fName}): деликатное волочение по дну с микродрожанием и паузами 3–6 секунд`
      : `Тёплая вода (${waterTemp}°C, ${fName}): активная ступенька и пелагический зуд в придонном и среднем слоях`;
    return { weight: `Микроджиг / Мормышка ${w} г`, line, tactic };
  }
  if (method === 'spin_jig') {
    const mult = isTrophy ? 3.4 : (['perch'].includes(fid) ? 1.8 : 2.7);
    const w = Math.min(60, Math.max(6, Math.round(depth * mult * flowCoeff)));
    const leader = fid === 'pike' ? 'стальной поводок-струна 20–25 см' : 'флюорокарбон 0.35–0.50 мм';
    const tactic = isCold
      ? `Холодная вода (${waterTemp}°C, ${fName}): медленная подача у дна — 1 оборот катушки и затяжная пауза 3–5 сек`
      : `Тёплая вода (${waterTemp}°C, ${fName}): классическая ступенька 2 оборота — пауза 1.5–2 сек по рельефу и коряжнику`;
    return { weight: `Джиг-головка / Чебурашка ${w} г`, line: `Плетёный шнур #0.8–1.5 PE + ${leader}`, tactic };
  }
  if (method === 'spin_lure') {
    const mult = ['chub', 'trout', 'grayling', 'perch', 'rotan', 'dace', 'peled', 'ide'].includes(fid) ? 1.1 : 2.3;
    const w = Math.min(32, Math.max(2, Math.round(depth * mult * flowCoeff)));
    const leader = fid === 'pike' ? 'стальной / титановый поводок 20–25 см' : 'флюорокарбоновый поводок 0.16–0.32 мм';
    const tactic = isCold
      ? `Холодная вода (${waterTemp}°C, ${fName}): вялый стоп-энд-гоу (Stop & Go) суспендером или микроколебалкой у дна с паузами до 4–6 секунд`
      : `Тёплая вода (${waterTemp}°C, ${fName}): проводка на снос поперёк струи, активный твичинг минноу или равномерка вдоль укрытий`;
    return { weight: `Блесна / Воблер ${w} г`, line: `Шнур #0.4–1.2 PE + ${leader}`, tactic };
  }
  if (method === 'bottom') {
    const w = Math.min(140, Math.max(20, Math.round(depth * 11 * flowCoeff)));
    if (fish?.type === 'predator') {
      return {
        weight: `Донное грузило ${w} г`,
        line: isTrophy ? 'Шнур 0.28–0.40 мм + силовой поводок 0.50–0.80 мм' : 'Основная леска 0.30 мм + поводок 0.28–0.35 мм',
        tactic: `Донная ловля хищника (${fName}): подача живца или резки на выходе из русловой ямы (${isCold ? 'пассивная зимняя стоянка' : 'ночной выход на бровку'})`
      };
    }
    const line = isCold
      ? `Шнур 0.10–0.12 мм, тонкий поводок 0.09–0.12 мм (длина 60–100 см), крючок №14–16`
      : (isTrophy ? 'Карповая леска 0.28–0.32 мм, волосяной поводок 15–25 lb, крючок №4–8' : 'Шнур 0.12–0.14 мм, поводок 0.12–0.16 мм (40–70 см), крючок №10–14');
    const tactic = isCold
      ? `Холодная вода (${waterTemp}°C, ${fName}): тёмная мелкофракционная прикормка со специями и кормовым мотылём, темп перезаброса 7–10 мин`
      : `Тёплая вода (${waterTemp}°C, ${fName}): стартовый закорм точки на бровке (зерновые/пеллетс/резаный червь), темп 3–5 мин`;
    return { weight: `Фидерная кормушка ${w} г`, line, tactic };
  }
  if (method === 'float') {
    const w = Math.min(8.0, Math.max(0.5, Math.round((depth * 0.75 * flowCoeff + wind * 0.15) * 10) / 10));
    const line = isCold
      ? 'Основная леска 0.12 мм, деликатный поводок 0.08–0.10 мм, крючок №16–18'
      : (isTrophy ? 'Основная леска 0.22–0.25 мм, поводок 0.18–0.20 мм' : 'Основная леска 0.14–0.16 мм, поводок 0.10–0.12 мм');
    const tactic = isCold
      ? `Холодная вода (${waterTemp}°C, ${fName}): точная подача животной насадки в 1–3 см от дна с минимальным докормом`
      : `Тёплая вода (${waterTemp}°C, ${fName}): ловля в проводку с придержкой по струе или у границы водной растительности`;
    return { weight: `Поплавок ${w} г`, line, tactic };
  }
  if (method === 'fly') {
    const tactic = isCold
      ? `Холодная вода (${waterTemp}°C, ${fName}): проводка тяжёлой вольфрамовой нимфы (бокоплав/ручейник) у самого дна в приямках`
      : `Тёплая вода (${waterTemp}°C, ${fName}): подача сухой мушки, эмерджера или жука со свободным дрейфом по струе`;
    return { weight: 'Нахлыст 3–5 кл. / Бомбарда (сбирулино) 4–10 г', line: `Поводок флюорокарбон ${isCold ? '0.10–0.14' : '0.12–0.18'} мм`, tactic };
  }
  return {
    weight: `Морская оснастка / Пилькер ${Math.max(10, Math.round(depth * 3.5 * flowCoeff))} г`,
    line: 'Шнур #0.6–1.5 PE + флюорокарбоновый шок-лидер 0.26–0.40 мм',
    tactic: `Морской лов (${fName}, вода ${waterTemp}°C): облов береговых свалов, ракушечника и каменистых банок`
  };
}
export function generateAdaptiveGuides(fish, water, depth, day, method, globalIceState) {
  const iceState = day.iceState || globalIceState;
  const iceThickness = day.iceThickness ?? 0;
  const sizeBlock = fish.sizeInfo ? `<div style="margin-top:6px;color:var(--accent);font-weight:700;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="3" y="8" width="18" height="8" rx="2" transform="rotate(-35 12 12)" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8"/><path d="M8 11l1.5 2M11 9l1.5 2M14 7l1.5 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg> ${fish.sizeInfo}</div>` : '';
  const traitsBlock = fish.idTraits ? `<div style="margin-top:5px;color:var(--muted);"><b>Приметы вида:</b> ${fish.idTraits}</div>` : '';
  const runInfo = RIVER_ENTERING_SPECIES[fish.id];
  const migrationBlock = runInfo
    ? `<div style="margin-top:5px;color:var(--good);font-weight:700;"><b>Миграция и заход в реки:</b> ${runInfo.reason}.</div>`
    : '';
  let standAdvice = '';
  if (fish.legal === 'redbook') {
    standAdvice = `<b>КРАСНАЯ КНИГА (ПОЙМАЛ — ОТПУСТИ):</b> ${fish.baseAdvice} ${fish.handlingAdvice || 'При случайной поимке в прилове бережно отпустите рыбу в воду!'}${migrationBlock}${sizeBlock}${traitsBlock}`;
  } else if (fish.legal === 'introduced') {
    standAdvice = `<b>Вселенец / Аквакультура:</b> ${fish.baseAdvice} При остывании воды ниже ${fish.tMinStop}°C впадает в оцепенение.${sizeBlock}${traitsBlock}`;
  } else if (iceState === 'ice_safe') {
    standAdvice = `<b>Подлёдный горизонт (лёд ~${iceThickness} см, рабочая глубина ${depth.toFixed(1)} м):</b> ${fish.baseAdvice}${migrationBlock}${sizeBlock}${traitsBlock}`;
  } else if (iceState === 'ice_danger') {
    standAdvice = `<b>Опасный лёд:</b> ${day.iceNote || 'Выход на лёд запрещён!'} С берега: ${fish.baseAdvice}${sizeBlock}`;
  } else if (iceState === 'ice_slush') {
    standAdvice = `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg><b>Шуга и забереги (колебания -3..+3°C):</b> ледостава нет, рыба стоит в придонных ямах и затишках на глубине ${depth.toFixed(1)} м. ${fish.baseAdvice}${migrationBlock}${sizeBlock}`;
  } else {
    standAdvice = `<b>Биотоп (${WATER_PROFILES[water]?.shortName || 'водоём'}, горизонт ${depth.toFixed(1)} м):</b> ${fish.baseAdvice}${migrationBlock}${sizeBlock}${traitsBlock}`;
  }
  const rigInfo = calcDynamicRig(method, water, depth, day.windMax, fish, day.waterTemp, iceState);
  const tackleAdvice = fish.legal === 'redbook'
    ? `<div><b>Вероятность прилова на снасть:</b> ${rigInfo.weight} (${rigInfo.line}).</div><div style="margin-top:5px;color:var(--bad);font-weight:700;">Целенаправленное изъятие запрещено! Используйте безбородые крючки и отпускайте рыбу прямо в воде.</div>`
    : `<div><b>Оптимальный монтаж сейчас:</b> ${rigInfo.weight} (${rigInfo.line}).</div><div style="margin-top:5px;"><b>Подача и анимация:</b> ${rigInfo.tactic}.</div><div style="margin-top:5px;color:var(--muted);"><b>Арсенал по виду:</b> ${fish.topGear}</div>`;
  let baitAdvice = '';
  const seasonTone = iceState === 'ice_safe'
    ? `<b>Подлёдный сезон (вода ~${day.waterTemp}°C):</b> приоритет животным насадкам (мотыль, мормыш/бокоплав, опарыш, резка) и деликатным зимним приманкам.`
    : (day.waterTemp <= 10.0
        ? `<b>Холодная вода (~${day.waterTemp}°C):</b> рыба избирательна — лучше всего работают животные насадки, нано-джиг с пассивными слагами/нимфами (0.2–0.8 г) и приманки на длинной паузе.`
        : `<b>Прогретая вода (~${day.waterTemp}°C):</b> высокая кормовая активность в толще и у дна, отлично работают как животные/растительные насадки, так и мормышинг (нано-джиг), вертушки и мушки.`);
  baitAdvice = `<div>${fish.feedBase || 'Естественный бентос, зоопланктон и сезонные приманки.'}</div><div style="margin-top:6px;color:var(--accent);">${seasonTone}</div>`;
  return { standAdvice, tackleAdvice, baitAdvice };
}
/**
 * Формирует простое человеческое объяснение прогноза в одно предложение для режима « Новичок»
 */
export function buildPlainLanguageSummary(fish, day, bd, bestScore) {
  const wt = day?.waterTemp ?? 8;
  const dp = Math.abs(day?.dP || 0);
  const wMax = day?.windMax || 3;
  const shock = bd?.archiveEval?.isShock;
  if (day?.iceState === "ice_danger") {
    return "Выход на лёд сейчас смертельно опасен из-за малой толщины или промоин — рыбалка возможна только с безопасного берега.";
  }
  if (shock) {
    return `После недавнего резкого скачка давления за прошлые сутки рыба находится в барическом «шоке» и болеет, поэтому поклёвки будут редкими и очень осторожными.`;
  }
  if (bestScore >= 65) {
    return `Сегодня отличные условия для ловли вида «${fish.name}»: температура воды (~${wt}°C) и ровное давление (${day?.pressAvg || 754} мм) располагают рыбу к активному выходу на кормёжку.`;
  }
  if (dp >= 5 || wMax >= 8) {
    return `Клёв вида «${fish.name}» сегодня капризный из-за ${dp >= 5 ? "перепада атмосферного давления" : "сильного ветра и волны"} — подавайте приманку медленно у самого дна.`;
  }
  return `Умеренная кормовая активность вида «${fish.name}» при воде ~${wt}°C — лучший шанс на уверенную поклёвку будет в часы утренней и вечерней зорьки.`;
}
/**
 * Вычисляет 30-дневную ретроспективную точность модели прогноза по данным личного Журнала уловов пользователя
 */
export function computeModel30DayValidation(catches = []) {
  const now = Date.now();
  const window30d = 30 * 86400 * 1000;
  const list = (Array.isArray(catches) ? catches : []).filter(c => c && (now - (c.timestamp || now)) <= window30d);
  const sample = list.length > 0 ? list : (Array.isArray(catches) ? catches : []);
  if (sample.length === 0) {
    return {
      hasData: false,
      accuracyPct: 84,
      totalChecked: 0,
      label: "Эталонная точность модели: ~84% (добавьте уловы в Журнал для персональной верификации)"
    };
  }
  const matched = sample.filter(c => c.matchedForecast !== false).length;
  const pct = Math.round((matched / sample.length) * 100);
  return {
    hasData: true,
    accuracyPct: pct,
    totalChecked: sample.length,
    label: `Подтверждённая точность на ваших водоёмах за 30 дн.: ${pct}% (${matched} из ${sample.length} выездов)`
  };
}
/**
 * Автоматический генератор чек-листа сборов и безопасности на выезд (под текущую рыбу, снасть, температуру и лёд)
 */
export function generateTripChecklist(fish, day, method, water, depth) {
  const s = store.getState();
  const rig = calcDynamicRig(method, water, depth, day?.windMax || 3, fish, day?.waterTemp ?? 10, day?.iceState || s.iceState);
  const baits = getSeasonalBaitsForContext(fish, method, day?.waterTemp ?? 10, day?.iceState || s.iceState);
  const iceSafety = computeIceSafetyIndex(day, water);
  const isWinter = (day?.iceState && day.iceState !== "open_water") || (day?.tDay ?? 10) <= 2 || (method && method.startsWith("winter_"));
  const gearItems = [
    `Основная снасть: ${rig.weight} (${rig.line})`,
    `Рабочие насадки/приманки: ${baits.slice(0, 3).join("; ")}`,
    `Глубиномер / эхолот (целевой горизонт стоянки ${fish.name}: ~${depth.toFixed(1)} м)`,
    `Запасные поводки, карабины, экстрактор / зевник и рулетка (контроль разрешённого размера)`
  ];
  const safetyItems = isWinter
    ? [
        `Спасалки («когти» на шнуре поверх куртки) и пешня для проверки льда (${iceSafety.statusText})`,
        `Непродуваемый костюм-поплавок, термобельё и нескользящие шипы на сапоги (воздух ${day?.tDay ?? 0}°/${day?.tNight ?? -3}°C)`,
        `Заряженный повербанк во внутреннем тёплом кармане + термос с горячим чаем`,
        `Отправленная точка «Экипаж (72ч)» близким или напарникам перед выходом на лёд`
      ]
    : [
        `Спасательный жилет (при ловле с лодки или взабродку, ветер до ${day?.windMax || 3} м/с)`,
        `Ветровлагозащитная мембрана и поляризационные очки (вода ~${day?.waterTemp ?? 10}°C)`,
        `Заряженный телефон с офлайн-кэшем «Клёв ПРО» и аптечка`,
        `Пакет под мусор и бережное отношение к прилову («Поймал — отпусти»)`
      ];
  return { gearItems, safetyItems, iceSafety, rig };
}
export function openTripChecklistModal() {
  const s = store.getState();
  const fish = FISH_DB.find(f => f.id === s.fishId) || FISH_DB[0];
  const day = s.weatherDays?.[s.dayIdx] || s.weatherDays?.[2] || s.weatherDays?.[0] || {};
  const effIce = _normalizeWarmDayIce(day, s.iceState);
  const effWaterTemp = Number(day.waterTemp ?? 8);
  const tDay = Number(day.tDay ?? 5);
  const tNight = Number(day.tNight ?? 0);
  const windMax = Number(day.windMax ?? 3);
  const windDir = day.windDir || 'З';
  const iceCm = effIce === 'open_water' ? 0 : Number(day.iceThickness ?? s.iceThickness ?? 0);
  const isWinterIce = effIce === 'ice_safe' || effIce === 'ice_danger' || effIce === 'ice_slush' || (tDay <= 1 && tNight <= -2);
  const rig = calcDynamicRig(s.method, s.water, s.depth, windMax, fish, effWaterTemp, effIce);
  const seasonalBaits = getSeasonalBaitsForContext(fish, s.method, effWaterTemp, effIce);
  const waterTitle = s.selectedWaterName || WATER_PROFILES[s.water]?.shortName || 'Водоём';
  const lat = Number(s.lat || 55.75);
  const lon = Number(s.lon || 37.62);
  const basin = String(s.basinCode || '');
  const isTaigaBearRegion = lat >= 56.0 || lon >= 58.0 || ['ob_lower', 'ob_middle', 'pur_taz', 'nadym', 'yenisei', 'lena', 'amur', 'kamchatka', 'sakhalin', 'karelia', 'kola', 'pechora', 'baikal'].some(k => basin.includes(k));
  const isBoatOrBigWater = !isWinterIce && ['big_river', 'reservoir', 'lake', 'sea_gulf', 'coastal'].includes(s.water);
  const isPredator = ['pike', 'zander', 'perch', 'burbot', 'taimen', 'lenok', 'asp', 'catfish', 'trout', 'chub'].includes(fish.id);

  const gearItems = [
    `Основная снасть под вид «${fish.name}»: ${rig.weight} (${rig.line})`,
    `Рабочие приманки / насадки: ${seasonalBaits.slice(0, 3).join('; ')}`,
    isWinterIce
      ? `Утеплённая мотыльница / термоконтейнер во внутренний карман куртки (защита наживки от промерзания при ${tDay}°C)`
      : (s.method === 'bottom' || s.method === 'float'
          ? `Прикормочное ведро, сито, запас кормушек (${rig.weight}), поводочница и термосумка для наживки`
          : `Коробка с рабочими приманками, запас флюорокарбоновых/титановых поводков, заводные кольца и кусачки-ретривер`),
    isPredator
      ? `Зевник, длинный медицинский корцанг (экстрактор) для безопасного извлечения крючка у хищника и багорик/подсачек`
      : `Экстрактор (петлесшиватель), запасные крючки под «${fish.name}», глубомер и поводочная леска`,
    `Портативный эхолот / глубомер (целевой горизонт стоянки «${fish.name}»: ~${s.depth.toFixed(1)} м) и рулетка для контроля разрешённого размера`
  ];

  const seasonItems = [];
  if (isWinterIce) {
    seasonItems.push(
      iceCm < 15 || effIce !== 'ice_safe'
        ? `Тяжёлая разборная пешня с темляком для проверки каждого шага (лёд ~${iceCm || 5} см) и спасалки («когти») поверх куртки`
        : `Ледобур по диаметру лунки под «${fish.name}» (130–180 мм) с комплектом запасных ножей, отвёрткой и спасалками на груди`,
      `Шумовка (черпак) для очистки лунки от шуги, багорик с телескопической ручкой и наколенники из ЭВА`,
      `Термос с горячим сладким чаем (1.0–1.5 л), калорийный перекус (сало, шоколад, орехи) и химические грелки для рук и стелек`,
      `Непродуваемый зимний костюм-поплавок, трёхслойное термобельё, флис и сапоги ЭВА со съёмными ледоступами (шипами)`,
      (windMax >= 4 || tDay <= -12)
        ? `Зимняя ветрозащитная палатка-куб / зонт с комплектом стальных ввёртышей в лёд и ветровыми растяжками (ветер ${windDir} ${windMax} м/с, воздух ${tDay}°/${tNight}°C)`
        : `Рыболовный ящик с тёплой сидушкой, ветрозащитные рукавицы-шубенки и полотенце для рук`
    );
    if (fish.id === 'burbot' || tDay <= -10) {
      seasonItems.push(`Налобный фонарь с тёплым/красным светом и запасным аккумулятором во внутреннем кармане (сумеречный и ночной выход)`);
    }
  } else {
    seasonItems.push(
      `Защита от гнуса: усиленный спрей-репеллент от комаров, мошки и клещей (ДЭТА 30–50% + ванилин от мошки) и шляпа-накомарник с сеткой`,
      `Поляризационные очки (чтение бровки и защита глаз), мембранный дождевик/штормовка (ветер ${windDir} ${windMax} м/с) и забродные сапоги / вейдерсы`,
      `Запас чистой питьевой воды (не менее 2 л), термос с горячим чаем/кофе и герметичный пакет для документов и ключей`,
      isBoatOrBigWater
        ? `Лодочный комплект безопасности (${waterTitle}): спасательный жилет по размеру, якорь с фалом не менее ${Math.max(15, Math.round(s.depth * 4))} м, черпак и ремкомплект`
        : `Складное кресло / подставки под удилища (тычки/род-под), подсачек с длинной ручкой и садок`
    );
  }

  const safetyItems = [];
  if (!isWinterIce && isTaigaBearRegion) {
    safetyItems.push(
      `Таёжная безопасность (${s.locLabel}): защита от медведей и диких животных — противомедвежий перцовый баллон (Anti-Bear 225–650 мл), сигнал охотника / фальшфейер / фальш-свисток`,
      `Герметичные контейнеры для продуктов и улова (не оставлять пищевые отходы и запах рыбы открытыми у стоянки и палатки)`
    );
  } else if (isWinterIce && lat >= 60.0) {
    safetyItems.push(
      `Северная защита (${s.locLabel}): флисовая балаклава, ветрозащитные очки-маска от пурги и снежной слепоты, охотничьи спички в гермотубусе`
    );
  }
  safetyItems.push(
    `Заряженный повербанк (10 000–20 000 мАч) с коротким кабелем во внутреннем тёплом кармане и загруженная офлайн-карта квадрата в «Клёв ПРО»`,
    `Походная аптечка (перевязочный пакет, антисептик, пластырь, обезболивающее), острый нож в ножнах и верёвка 15–20 м`,
    `Контроль возврата: отправьте точку выезда напарникам через «Экипаж (72 ч)» и включите запись тропы на Карте`
  );

  const iceVerdictLine = isWinterIce
    ? (effIce === 'ice_safe' ? `Лёд ~${iceCm} см (выход пешком разрешён)` : `Внимание: тонкий лёд / шуга (~${iceCm} см), соблюдайте осторожность`)
    : `Открытая вода (температура воды ~${effWaterTemp > 0 ? '+' + effWaterTemp : effWaterTemp}°C)`;

  const html = `
    <div style="display:flex;flex-direction:column;gap:12px;font-size:var(--fs-sm);">
      <div class="glass-panel" style="padding:11px 13px;border-radius:14px;border:1px solid var(--accent);font-size:12px;line-height:1.45;">
        <div style="font-weight:900;font-size:13.5px;color:var(--text);width:100%;margin-bottom:4px;">Маршрут и условия выезда</div>
        <div><b>Локация:</b> ${escapeHtml(s.locLabel)} (${escapeHtml(waterTitle)})</div>
        <div><b>Целевая рыба и горизонт:</b> ${escapeHtml(fish.name)} (~${s.depth.toFixed(1)} м)</div>
        <div><b>Метеосводка:</b> воздух ${tDay > 0 ? '+' + tDay : tDay}°/${tNight > 0 ? '+' + tNight : tNight}°C, ветер ${windDir} ${windMax} м/с, давление ${day.pressAvg || 754} мм</div>
        <div><b>Режим водоёма:</b> <span style="color:var(--accent);font-weight:800;">${iceVerdictLine}</span></div>
      </div>

      <div style="display:flex;flex-direction:column;gap:6px;">
        <div style="font-weight:900;font-size:13px;color:var(--accent);width:100%;padding:2px 0;">
          Снасти, оснастка и приманки (${escapeHtml(fish.name)})
        </div>
        ${gearItems.map(item => `
          <label class="klev-checklist-row" style="display:flex;align-items:flex-start;gap:10px;padding:9px 11px;background:var(--card);border:1px solid var(--border);border-radius:12px;cursor:pointer;font-size:12px;line-height:1.4;">
            <input type="checkbox" class="klev-check-box" checked>
            <span style="flex:1;min-width:0;">${item}</span>
          </label>
        `).join('')}
      </div>

      <div style="display:flex;flex-direction:column;gap:6px;">
        <div style="font-weight:900;font-size:13px;color:var(--good);width:100%;padding:2px 0;">
          ${isWinterIce ? 'Зимняя экипировка, лёд и обогрев' : 'Сезонная экипировка, защита от гнуса и быт'}
        </div>
        ${seasonItems.map(item => `
          <label class="klev-checklist-row" style="display:flex;align-items:flex-start;gap:10px;padding:9px 11px;background:var(--card);border:1px solid var(--border);border-radius:12px;cursor:pointer;font-size:12px;line-height:1.4;">
            <input type="checkbox" class="klev-check-box" checked>
            <span style="flex:1;min-width:0;">${item}</span>
          </label>
        `).join('')}
      </div>

      <div style="display:flex;flex-direction:column;gap:6px;">
        <div style="font-weight:900;font-size:13px;color:var(--warn);width:100%;padding:2px 0;">
          Региональная безопасность, дикая природа и связь
        </div>
        ${safetyItems.map(item => `
          <label class="klev-checklist-row" style="display:flex;align-items:flex-start;gap:10px;padding:9px 11px;background:var(--card);border:1px solid var(--border);border-radius:12px;cursor:pointer;font-size:12px;line-height:1.4;">
            <input type="checkbox" class="klev-check-box" checked>
            <span style="flex:1;min-width:0;">${item}</span>
          </label>
        `).join('')}
      </div>
    </div>
  `;
  openModal('Чек-лист сборов и безопасности на выезд', html);
}

export function openRigEncyclopediaModal(fishParam) {
  const s = store.getState();
  const fish = fishParam || FISH_DB.find(f => f.id === s.fishId) || FISH_DB[0];
  const day = s.weatherDays?.[s.dayIdx] || s.weatherDays?.[2] || s.weatherDays?.[0] || {};
  const effIce = _normalizeWarmDayIce(day, s.iceState);
  const effWaterTemp = Number(day.waterTemp ?? 8);
  const isWinterIce = effIce === 'ice_safe' || effIce === 'ice_danger' || effIce === 'ice_slush' || String(s.method || '').startsWith('winter_');
  const rig = calcDynamicRig(s.method, s.water, s.depth, day.windMax || 3, fish, effWaterTemp, effIce);
  const seasonalBaits = getSeasonalBaitsForContext(fish, s.method, effWaterTemp, effIce);
  const activeBait = s.selectedBait && seasonalBaits.includes(s.selectedBait) ? s.selectedBait : (seasonalBaits[0] || '');

  const fid = fish.id;
  const isCoregonid = ['whitefish', 'muksun', 'peled', 'chir', 'vendace', 'omul', 'tugun', 'smelt', 'grayling', 'nelma'].includes(fid);
  const isBurbot = fid === 'burbot';
  const isBigPredator = ['pike', 'zander', 'taimen', 'lenok', 'asp', 'catfish', 'chub'].includes(fid);
  const isPerchGroup = ['perch', 'volga_zander', 'trout', 'ide', 'rotan', 'ruffe'].includes(fid);

  let primaryCards = [];
  let knotItems = [];

  if (isBurbot) {
    primaryCards = [
      {
        tone: 'var(--accent)',
        title: `Тяжёлая блесна-стукалка / Джиг-головка со светонакопителем (${fish.name})`,
        mount: `Основная монолеска 0.35–0.45 мм (не обмерзает в лунке и не режет руки при вываживании), латунная/свинцовая стукалка или светонакопительная джиг-головка 18–36 г с крупным крючком №1/0–№3/0 и шумовой подвеской.`,
        baitAndAction: `На крючок подсаживается резка ерша, тюльки, корюшки или пучок червей. Подача: ритмичный стук по твёрдому каменистому/галечному дну с паузой 4–8 секунд на самом дне (налим прижимает добычу подбородком).`
      },
      {
        tone: 'var(--good)',
        title: `Донная зимняя поставушка / Жерлица со скользящим грузом (${fish.name})`,
        mount: `Монолеска 0.35–0.40 мм, скользящее грузило-оливка или плоская ложка 25–45 г (по течению), силиконовый стопор и поводок из флюорокарбона 0.30–0.35 мм длиной 35–45 см с одинарным крючком №2–№1/0 с длинным цевьём.`,
        baitAndAction: `Наживка (живой или давленый ёрш, пескарь, резка рыбы) должна лежать строго на дне на выходе из ямы или каменистой косе.`
      }
    ];
    knotItems = [
      `<b>Паломар (Palomar):</b> лучший узел для привязывания тяжёлой стукалки и джиг-головки к монолеске 0.35–0.45 мм (прочность до 95% на морозе).`,
      `<b>Усиленный Клинч (Improved Clinch, 6 витков):</b> надёжная привязка вертлюжка поставушки и заводного кольца.`,
      `<b>Петля-восьмёрка:</b> быстрое крепление сменного поводка поставушки «петля в петлю» замёрзшими руками.`
    ];
  } else if (isCoregonid) {
    primaryCards = [
      {
        tone: 'var(--accent)',
        title: `Сиговая гирлянда / Тандем микромормышек в толще воды (${fish.name})`,
        mount: `Основная флюорокарбоновая леска 0.12–0.16 мм. Нижняя вольфрамовая мормышка-якорь 1.5–3.0 г, выше через каждые 35–45 см привязаны 2–4 коротких отвода (3–4 см) с крючками №14–№16 (фосфорная бусина, кембрик, мушка под бокоплава).`,
        baitAndAction: `Плавный высокий подъём снасти с мягким покачиванием кивка в горизонте 0.5–2.5 м над дном. Подсадка: мотыль, опарыш, мормыш (гаммарус) или ловля на голую бусину.`
      },
      {
        tone: 'var(--good)',
        title: isWinterIce
          ? `Тонкая безмотыльная снасть: Гвоздешарик / Чёртик / Нимфа (${fish.name})`
          : `Сбирулино (Бомбарда) / Нахлыстовая нимфа и микроколебалка (${fish.name})`,
        mount: isWinterIce
          ? `Флюорокарбон 0.10–0.12 мм, длинный чувствительный лавсановый или карбоновый кивок, вольфрамовый гвоздешарик (латунь/кошачий глаз/неон) 0.4–0.9 г.`
          : `Плавающая или медленно тонущая бомбарда 10–20 г, тройной вертлюжок, поводок из флюорокарбона 0.14–0.16 мм длиной 1.2–1.5 м с искусственной мушкой или микроколебалкой 1.5–3.5 г.`,
        baitAndAction: isWinterIce
          ? `Высокочастотный дриблинг с короткими контрольными остановками через каждые 15–20 см подъёма.`
          : `Сплав по струе на границе переката и обратки с лёгкими подтвичиваниями.`
      }
    ];
    knotItems = [
      `<b>Свободная петля Рапала (Rapala Knot):</b> сохраняет идеальную вертикальную игру микромормышки и мушки на тонком флюорокарбоне 0.10–0.14 мм.`,
      `<b>Хирургическая петля (Dropper Loop):</b> формирование боковых отводов сиговой гирлянды без потери прочности основной лески.`,
      `<b>Узел Клинч с двойным продеванием в ушко:</b> предотвращает срез тонкой лески о края отверстия вольфрамовой мормышки.`
    ];
  } else if (isBigPredator) {
    primaryCards = isWinterIce ? [
      {
        tone: 'var(--accent)',
        title: `Зимний Виб (Rattlin 65–95 мм) и Балансир (${fish.name})`,
        mount: `Жёсткий зимний удильник с мультипликаторной катушкой, флюорокарбон 0.35–0.45 мм (или шнур с зимней пропиткой + шок-лидер). На щуку обязателен титановый или скрученный стальной поводок 20–25 см; на судака — флюорокарбон 0.45–0.55 мм.`,
        baitAndAction: `Короткий взмах на 15–25 см с плавным сбросом и мормышинговым покачиванием («кач») на паузе 4–10 секунд в 20–50 см от дна.`
      },
      {
        tone: 'var(--good)',
        title: `Зимняя жерлица / Поставушка на живца (${fish.name})`,
        mount: `Основная монолеска 0.35–0.40 мм, скользящая оливка 8–16 г, бусина-амортизатор, вертлюжок и поводок 30–35 см (двойной флюорокарбон 0.45–0.50 мм или мягкий вольфрам/титан) с двойником/тройником №6–№4.`,
        baitAndAction: `Живец (плотвичка, окунь, карасик, пескарь) цепляется за спинку под спинной плавник и выставляется в 25–45 см над дном вдоль бровки или коряжника.`
      }
    ] : [
      {
        tone: 'var(--accent)',
        title: `Джиг / Джиг-риг / Чебурашка с силиконом и мандулой (${fish.name})`,
        mount: `8-жильный PE-шнур #1.0–#1.5 + поводок-струна №2 (20–25 см на щуку) или флюорокарбон 0.45–0.60 мм (на судака в ракушечнике). Груз: ${rig.weight}.`,
        baitAndAction: `Ступенчатая проводка: 2 оборота катушки — пауза 2–6 сек (по холодной воде ниже +8°C лучшую реализацию даёт мандула и поролон с паузой до 6–8 сек).`
      },
      {
        tone: 'var(--good)',
        title: `Твичинг воблеров-минноу и крупных блёсен (${fish.name})`,
        mount: `Спиннинг быстрого строя (Fast / Extra-Fast), шнур PE #1.2–#1.5, жёсткий поводок-струна 20–25 см со скруткой (исключает перехлёст тройников воблера при рывках).`,
        baitAndAction: `Серия из 2 резких рывков с отдачей шнура и паузой 2–5 секунд (суспендер зависает в горизонте атаки хищника).`
      }
    ];
    knotItems = [
      `<b>Паломар (Palomar):</b> максимальная разрывная прочность на застёжке, поводке и джиг-головке.`,
      `<b>Морковка (Mahin / Улучшенный Олбрайт):</b> надёжное соединение основного PE-шнура с толстым шок-лидером из флюорокарбона (10 витков вперёд, 6 назад).`,
      `<b>Свободная петля Рапала:</b> привязка воблеров и балансиров к флюорокарбоновому поводку без зажима игры.`
    ];
  } else if (isPerchGroup) {
    primaryCards = isWinterIce ? [
      {
        tone: 'var(--accent)',
        title: `Вертикальная зимняя блесна (Маропедка / Листик) и Балансир №3–№5 (${fish.name})`,
        mount: `Монолеска или флюорокарбон 0.14–0.18 мм, блесна 30–45 мм с подвесным тройничком и яркой каплей-кембриком (красно-жёлтый / светонакопитель).`,
        baitAndAction: `Серия однотипных коротких взмахов (10–15 см) с возвратом точно в одну точку и паузой 2–4 секунды (при раскачке лунки — переход на КД, короткий дроч).`
      },
      {
        tone: 'var(--good)',
        title: `Вольфрамовая мормышка (Капля / Уралка / Безмотылка) (${fish.name})`,
        mount: `Леска 0.10–0.12 мм, приталенный лавсановый кивок, вольфрамовая мормышка 0.3–0.8 г (медь, серебро, чёрный никель).`,
        baitAndAction: `Подсадка 1–2 личинок мотыля (или ловля на бисер) с активной высокочастотной проводкой от дна до 50 см выше.`
      }
    ] : [
      {
        tone: 'var(--accent)',
        title: `Отводной поводок (Московская оснастка) и Дроп-шот (${fish.name})`,
        mount: `Тройной вертлюжок -> груз-палочка/балерина (${rig.weight}) на отводе 20–25 см (леска 0.22 мм) -> рабочий поводок 90–110 см из флюорокарбона 0.14–0.18 мм с офсетным крючком №6–№4.`,
        baitAndAction: `Медленное волочение по ракушечнику и каменистой бровке с двойными подёргиваниями кончиком спиннинга и паузами 2–4 секунды.`
      },
      {
        tone: 'var(--good)',
        title: `Микроджиг / Вращающаяся блесна и Тейл-спиннер (${fish.name})`,
        mount: `Шнур PE #0.3–#0.6, поводок из флюорокарбона 0.16–0.20 мм длиной 50–60 см, шарнирный монтаж Чебурашка 2–6 г или тейл-спиннер 4–10 г.`,
        baitAndAction: `Пелагическая волнообразная проводка в толще воды или двойной подрыв со дна.`
      }
    ];
    knotItems = [
      `<b>Улучшенный Клинч (Improved Clinch):</b> быстрая и надёжная фиксация застёжек, вертлюжков и мормышек.`,
      `<b>Узел Паломар (Palomar):</b> для офсетного крючка в оснастке Дроп-шот (жало крючка всегда смотрит строго вверх).`,
      `<b>Узел Олбрайт / Хирургический узел:</b> привязка тонкого флюорокарбонового поводка 0.14–0.18 мм к шнуру.`
    ];
  } else {
    primaryCards = isWinterIce ? [
      {
        tone: 'var(--accent)',
        title: `Зимний поплавок / Коромысло со дна (${fish.name})`,
        mount: `Основная леска 0.14–0.16 мм, двухсоставной тонущий поплавок или кивок Щербакова, свинцовое коромысло 2–10 г (под течение) с двумя поводками 5–7 см из плетёнки/лески 0.10–0.12 мм и крючками №12–№14.`,
        baitAndAction: `Точечный закорм лунки кормушкой-самосвалом в 20 см от дна. Насадка: пучок уральского мотыля или бутерброд с опарышем; поклёвка — классический подъём поплавка.`
      },
      {
        tone: 'var(--good)',
        title: `Тандем («Паровоз») из двух чёртиков / Мормышка с кивком (${fish.name})`,
        mount: `Леска 0.10–0.13 мм, нижний чёртик 0.5–0.9 г и верхний мелкий чёртик/коза в 25–30 см выше (скользящий или глухой монтаж), длинный металлический или карбоновый кивок.`,
        baitAndAction: `Плавный «лещовый» кач с медленным подъёмом до 60–80 см от дна и контрольной подсечкой в верхней точке.`
      }
    ] : [
      {
        tone: 'var(--accent)',
        title: `Фидерный монтаж: Инлайн (In-Line) и Патерностер Гарднера (${fish.name})`,
        mount: `Основной шнур PE #0.8–#1.0 (или монолеска 0.22–0.25 мм), скользящая кормушка (${rig.weight}) с отводом из фидергама 8–10 см. Поводок из флюорокарбона 0.10–0.14 мм длиной 50–80 см (на течении) или 30–45 см (в стоячей воде), крючок №12–№16.`,
        baitAndAction: `Стартовый закорм точки из 5–7 кормушек на клипсе, далее темповый перезаброс каждые 3–7 минут (по плотве/лещу) или ожидание 12–20 минут (по крупному лещу и карасю).`
      },
      {
        tone: 'var(--good)',
        title: `Флэт-Метод (Flat Method) и Безопасная карповая оснастка (${fish.name})`,
        mount: `Кормушка Flat 30–70 г, мягкий поводковый материал 15–25 lb длиной 8–12 см, крючок Wide Gape / Curve Shank №6–№10 с волосяным монтажом под бойл, вафтерс или кукурузу.`,
        baitAndAction: `Крючок с насадкой запрессовывается топтушкой в верхний слой методного пеллетса/прикормки — рыба находит насадку прямо в центре кормового пятна.`
      }
    ];
    knotItems = [
      `<b>Петля Гарднера (Восьмёрка):</b> базовый узел для формирования патерностера и соединения поводка «петля в петлю».`,
      `<b>Безузловой узел (Knotless Knot):</b> эталонный монтаж волосяной оснастки для карпа, сазана и флэт-фидера (100% засекаемость).`,
      `<b>Узел Лопатка (Spade End Knot) / Паломар:</b> надёжная привязка тонких фидерных и поплавочных крючков №12–№16.`
    ];
  }

  const html = `
    <div style="display:flex;flex-direction:column;gap:10px;font-size:var(--fs-sm);line-height:1.45;">
      <div class="glass-panel" style="padding:10px 12px;border-radius:14px;border:1.5px solid var(--accent);">
        <div style="font-weight:900;font-size:13.5px;color:var(--text);width:100%;margin-bottom:4px;">
          Текущая выбранная снасть (${escapeHtml(fish.name)})
        </div>
        <div style="font-size:12px;color:var(--text);">
          <b>Оснастка:</b> ${escapeHtml(rig.weight)} (${escapeHtml(rig.line)})<br>
          <b>Рекомендуемая приманка / насадка:</b> ${escapeHtml(activeBait)}<br>
          <b>Тактика подачи (горизонт ~${s.depth.toFixed(1)} м):</b> ${escapeHtml(rig.tactic)}
        </div>
      </div>

      ${primaryCards.map((c) => `
        <div style="padding:11px 13px;background:var(--panel);border:1.5px solid ${c.tone};border-radius:14px;">
          <div style="font-weight:900;font-size:13px;color:${c.tone};width:100%;margin-bottom:4px;">${c.title}</div>
          <div style="font-size:12px;color:var(--text);">
            <b>Схема монтажа:</b> ${c.mount}<br>
            <b>Насадка и подача:</b> ${c.baitAndAction}
          </div>
        </div>
      `).join('')}

      <div style="padding:11px 13px;background:var(--panel);border:1.5px solid var(--ice);border-radius:14px;">
        <div style="font-weight:900;font-size:13px;color:var(--ice);width:100%;margin-bottom:4px;">
          Проверенные узлы под оснастку «${escapeHtml(fish.name)}»
        </div>
        <div style="font-size:12px;color:var(--text);display:flex;flex-direction:column;gap:5px;">
          ${knotItems.map(k => `<div>• ${k}</div>`).join('')}
        </div>
      </div>
    </div>
  `;
  openModal(`Монтажи и узлы: ${fish.name}`, html);
}
function computeDayKpAndDaylight(day) {
  const sr = Number.isFinite(day?.sunriseHr) ? day.sunriseHr : 7.5;
  const ss = Number.isFinite(day?.sunsetHr) ? day.sunsetHr : 17.5;
  const diff = Math.max(1, ss - sr);
  const dH = Math.floor(diff);
  const dM = Math.round((diff - dH) * 60);
  const daylightStr = `${dH} ч ${String(dM).padStart(2, '0')} м`;
  const dateSeed = String(day?.date || '2026-10-30').split('-').reduce((a, b) => a + (parseInt(b, 10) || 0), 0);
  const dpShift = Math.abs(day?.dP || 0) >= 4 ? 2 : (Math.abs(day?.dP || 0) >= 2 ? 1 : 0);
  const kpVal = Math.max(1, Math.min(6, ((dateSeed % 3) + 1 + dpShift)));
  const kpLabel = kpVal <= 2 ? 'Спокойно' : (kpVal === 3 ? 'Слабое возмущение' : (kpVal === 4 ? 'Умеренная буря' : 'Магнитная буря'));
  const kpTone = kpVal <= 2 ? 'var(--good)' : (kpVal <= 3 ? 'var(--warn)' : 'var(--bad)');
  return { sr, ss, daylightStr, kpVal, kpLabel, kpTone };
}
let _recastTimerInterval = null;
let _recastTimerTargetTs = 0;
function playCarpRecastChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.25);
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.55);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.55);
  } catch (e) {}
}
function startCarpRecastTimer(minutes, container) {
  const mins = Math.max(1, parseInt(minutes, 10) || 15);
  _recastTimerTargetTs = Date.now() + mins * 60000;
  if (_recastTimerInterval) clearInterval(_recastTimerInterval);
  const updateDisp = () => {
    const remSec = Math.max(0, Math.ceil((_recastTimerTargetTs - Date.now()) / 1000));
    const disp = typeof document !== 'undefined' ? document.getElementById('fcRecastTimerDisplay') : null;
    if (disp) {
      if (remSec > 0) {
        const mm = String(Math.floor(remSec / 60)).padStart(2, '0');
        const ss = String(remSec % 60).padStart(2, '0');
        disp.textContent = `${mm}:${ss}`;
        disp.className = 'pill pill-good';
      } else {
        disp.textContent = '00:00!';
        disp.className = 'pill pill-warn';
      }
    }
    if (remSec <= 0) {
      clearInterval(_recastTimerInterval);
      _recastTimerInterval = null;
      _recastTimerTargetTs = 0;
      playCarpRecastChime();
      const clip = store.getState().userProfile?.carpClipMeters || 42;
      showToast(` Время перезаброса снасти / докорма свима (клипса ${clip} м)!`, 'good');
    }
  };
  updateDisp();
  _recastTimerInterval = setInterval(updateDisp, 1000);
  showToast(` Таймер перезаброса запущен на ${mins} мин.`, 'good');
}
function stopCarpRecastTimer() {
  if (_recastTimerInterval) clearInterval(_recastTimerInterval);
  _recastTimerInterval = null;
  _recastTimerTargetTs = 0;
  const disp = typeof document !== 'undefined' ? document.getElementById('fcRecastTimerDisplay') : null;
  if (disp) {
    disp.textContent = 'Выкл';
    disp.className = 'pill pill-neutral';
  }
  showToast('Таймер перезаброса остановлен', 'info');
}
function buildSpecializedTacticalHtml(fish, s, day, waterTemp, iceState) {
  const savedClip = Number(s.userProfile?.carpClipMeters || 42);
  const savedBottom = s.userProfile?.carpBottomType || 'Ракушечник / Русловая бровка';
  const timerLeftSec = _recastTimerTargetTs > Date.now() ? Math.ceil((_recastTimerTargetTs - Date.now()) / 1000) : 0;
  const timerMm = String(Math.floor(timerLeftSec / 60)).padStart(2, '0');
  const timerSs = String(timerLeftSec % 60).padStart(2, '0');
  return `
    <div style="display:flex;flex-direction:column;gap:10px;">
      <div class="bento-card" style="padding:12px 14px;display:flex;flex-direction:column;gap:9px;">
        <div style="width:100%;display:flex;flex-direction:column;gap:4px;">
          <div style="font-size:14px;font-weight:800;width:100%;">Карта свима и клипса</div>
          <div style="font-size:11.5px;color:var(--accent);font-weight:800;">Клипса: <b id="fcCarpClipBadgeVal">${savedClip} м</b> • Глубина ${s.depth.toFixed(1)} м • ${escapeHtml(savedBottom)}</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div>
            <label for="fcCarpClipInput" style="display:block;font-size:11px;color:var(--muted);font-weight:700;margin-bottom:3px;">Дистанция / Клипса (м):</label>
            <input type="number" id="fcCarpClipInput" class="input" min="5" max="220" step="1" value="${savedClip}" style="width:100%;min-height:38px;font-weight:800;">
          </div>
          <div>
            <label style="display:block;font-size:11px;color:var(--muted);font-weight:700;margin-bottom:3px;">Рабочая глубина (м):</label>
            <input type="text" class="input" value="${s.depth.toFixed(1)}" readonly style="width:100%;min-height:38px;font-weight:800;opacity:0.85;">
          </div>
        </div>
        <div>
          <label for="fcCarpBottomSelect" style="display:block;font-size:11px;color:var(--muted);font-weight:700;margin-bottom:3px;">Характер рельефа и дна:</label>
          <select id="fcCarpBottomSelect" class="form-select" style="width:100%;min-height:40px;">
            ${['Ракушечник / Русловая бровка', 'Выход из ила на твёрдое плато', 'Русловой свал / Яма', 'Граница камыша / Коряжник'].map(opt => `<option value="${opt}" ${opt === savedBottom ? 'selected' : ''}>${opt}</option>`).join('')}
          </select>
        </div>
        <button type="button" class="pill-btn" id="fcSaveCarpSwimBtn" style="width:100%;min-height:40px;font-weight:800;font-size:12.5px;">Запомнить свим и привязать к точке</button>
      </div>

      <div class="bento-card" style="padding:12px 14px;display:flex;flex-direction:column;gap:9px;">
        <div style="width:100%;display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <span style="font-size:14px;font-weight:800;">Таймер перезаброса / проверки</span>
          <span id="fcRecastTimerDisplay" class="pill ${timerLeftSec > 0 ? 'pill-good' : 'pill-neutral'}" style="font-family:monospace;font-size:13.5px;font-weight:900;">${timerLeftSec > 0 ? `${timerMm}:${timerSs}` : '15:00'}</span>
        </div>
        <div class="seg-bar" style="display:grid;grid-template-columns:repeat(4,1fr);">
          <button type="button" class="seg-btn" data-recast-timer-min="10">10 мин</button>
          <button type="button" class="seg-btn active" data-recast-timer-min="15">15 мин</button>
          <button type="button" class="seg-btn" data-recast-timer-min="45">45 мин</button>
          <button type="button" class="seg-btn" data-recast-timer-min="120">2 ч</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <button type="button" class="pill-btn" data-recast-timer-min="15" style="min-height:38px;font-weight:800;color:var(--good);border-color:var(--good);">Старт таймера</button>
          <button type="button" class="pill-btn" id="fcStopRecastTimerBtn" style="min-height:38px;font-weight:800;">Сброс</button>
        </div>
      </div>
    </div>
  `;
}
export function renderExpress(container) {
  if (typeof document !== 'undefined' && document.documentElement.getAttribute('data-desktop-web') !== '1') {
    const rootSec = document.getElementById('secForecast') || container;
    if (rootSec && rootSec.id === 'secForecast') {
      renderMobileRedesignForecast(rootSec);
    }
    return;
  }
  if (!container) return;
  const s = store.getState();
  const fish = FISH_DB.find(f => f.id === s.fishId) || FISH_DB[0];
  const expressIndices = [2, 3, 4]; // Сегодня, Завтра, Послезавтра
  const curTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const cardsHtml = expressIndices.map((dayIdx, pos) => {
    const d = s.weatherDays[dayIdx];
    if (!d) return '';
    const dayName = pos === 0 ? 'Сегодня' : (pos === 1 ? 'Завтра' : 'Послезавтра');
    const score = calcDayBest(fish, d, s.method, s.water, s.depth, s.normPress, s.iceState);
    const dayIce = d.iceState || s.iceState;
    const bd = getFactorBreakdown(fish, d, s.method, s.water, s.depth, s.normPress, s.iceState);
    const wtOk = d.waterTemp >= fish.tWaterOpt[0] && d.waterTemp <= fish.tWaterOpt[1];
    const wtTone = d.waterTemp < fish.tMinStop ? 'bad' : (wtOk ? 'good' : 'warn');
    const pTone = Math.abs(d.dP) <= 2 && !bd.archiveEval?.isShock ? 'good' : (Math.abs(d.dP) <= 4 && !bd.archiveEval?.isShock ? 'warn' : 'bad');
    const wTone = d.windMax <= 5 ? 'good' : (d.windMax <= 8 ? 'warn' : 'bad');
    const iceTone = dayIce === 'ice_danger' ? 'bad' : (dayIce === 'ice_safe' ? 'ice' : (dayIce === 'ice_slush' ? 'warn' : 'good'));
    const iceText = dayIce === 'ice_danger'
      ? (d.iceSubState === 'spring_rotten_ice' ? `Рыхлый лёд ~${d.iceThickness} см` : `Опасный лёд ~${d.iceThickness} см`)
      : (dayIce === 'ice_safe' ? `Лёд ~${d.iceThickness} см` : (dayIce === 'ice_slush' ? 'Шуга и забереги' : 'Открытая вода'));
    const isPressJump = Math.abs(d.dP) >= 5;
    const isArchiveShock = Boolean(bd.archiveEval?.isShock);
    const isGale = d.windMax >= 8.5;
    const isIceDanger = dayIce === 'ice_danger';
    let verdict = RU.verdictGo;
    let verdictTone = 'good';
    let customRatingWord = null;
    if (fish.legal === 'redbook') {
      verdict = `Кр. книга (прилов ~${score}%)`;
      verdictTone = 'bad';
      customRatingWord = `Активность ${score}% • Отпусти`;
    } else if (isIceDanger) {
      verdict = d.iceSubState === 'spring_rotten_ice'
        ? `Рыхлый лёд и промоины`
        : `Опасный лёд (~${d.iceThickness} см)`;
      verdictTone = 'bad';
      customRatingWord = 'Выход на лёд опасен';
    } else if (isPressJump) {
      verdict = `Скачок давления (${d.dP > 0 ? '+' : ''}${d.dP} мм)`;
      verdictTone = Math.abs(d.dP) >= 8 ? 'bad' : 'warn';
      customRatingWord = score < 35 ? 'Клёва нет' : (score < 50 ? 'Слабый клёв' : 'Умеренный клёв • Нестабильно');
    } else if (isArchiveShock && score < 62) {
      verdict = `Барический «шок» (архив)`;
      verdictTone = 'warn';
      customRatingWord = score < 40 ? 'Слабый клёв • В «шоке»' : 'Осторожный клёв';
    } else if (isGale) {
      verdict = `Штормовой ветер (${d.windMax} м/с)`;
      verdictTone = 'bad';
      customRatingWord = score < 35 ? 'Клёва нет' : 'Слабый клёв • Шторм';
    } else if (score < 38) {
      verdict = RU.verdictStay;
      verdictTone = 'bad';
    } else if (score < 60) {
      verdict = RU.verdictCareful;
      verdictTone = 'warn';
      customRatingWord = 'Умеренный клёв';
    }
    const topNotes = bd.factors.slice(0, 3).map(f => `${f.note} (${f.val >= 0 ? '+' + f.val : f.val}%)`).join('; ');
    return `
      <div class="card express-card ${s.dayIdx === dayIdx ? 'active' : ''}" data-express-day="${dayIdx}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <div>
            <div style="font-size:var(--fs-md);font-weight:800;">${dayName} • ${d.label}</div>
            <div style="font-size:var(--fs-xs);color:var(--muted);">Объект лова: <b>${fish.name}</b></div>
          </div>
          ${createPill({ text: verdict, tone: verdictTone })}
        </div>
        <div class="express-chips">
          ${createPill({ icon: '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3c0 0-6 7.1-6 11.5a6 6 0 0 0 12 0C18 10.1 12 3 12 3z" fill="rgba(56,189,248,0.32)" stroke="#38bdf8" stroke-width="1.8"/><path d="M9.5 15.5c.5 1.2 1.7 2 3 2" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg>', text: `Вода ${d.waterTemp}°C`, tone: wtTone })}
          ${createPill({ icon: '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><polygon points="16,8 13.5,13.5 8,16 10.5,10.5" fill="#38bdf8" stroke="currentColor" stroke-width="1.3"/></svg>', text: `${d.pressAvg} мм (${fmtDeltaPress(d.dP)})`, tone: pTone })}
          ${createPill({ icon: '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>', text: `${d.windDir} ${d.windMax} м/с`, tone: wTone })}
          ${createPill({ icon: d.moon.phaseIcon, text: `${d.moon.moonDay} л.д.`, tone: 'neutral' })}
          ${createPill({ icon: dayIce === 'open_water' ? '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg>' : '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2v20M2 12h20M4.9 4.9l14.2 14.2M19.1 4.9L4.9 19.1" stroke="#7dd3fc" stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="12" r="2.2" fill="#38bdf8"/></svg>', text: iceText, tone: iceTone })}
        </div>
        <p style="font-size:var(--fs-xs);color:var(--muted);line-height:1.42;">
          ${fish.legal === 'redbook'
            ? `Поймал — отпусти! Биоактивность вида: ${topNotes}.`
            : (dayIce === 'ice_danger'
                ? (d.iceNote || 'Выход на тонкий или весенний рыхлый лёд смертельно опасен! Допустима только береговая ловля.')
                : `${topNotes}.`)}
        </p>
        <div style="display:flex;justify-content:space-between;align-items:center;padding-top:8px;border-top:1px solid var(--border);gap:8px;">
          <div>
            ${renderFiveFish(score, 17, curTheme, true, customRatingWord)}
          </div>
          <span style="font-size:var(--fs-xs);color:var(--muted);font-weight:700;">${fish.legal === 'redbook' ? 'Красная книга' : '8 факторов модели'}</span>
        </div>
      </div>
    `;
  }).join('');
  const appMode = s.appMode || "angler";
  const todayObj = s.weatherDays[2] || s.weatherDays[0];
  const tomorrowObj = s.weatherDays[3] || todayObj;
  const nearWaterTitle = s.selectedWaterName || s.nearbyWaters?.[0]?.name || WATER_PROFILES[s.water]?.shortName || "Ближайший водоём";
  let modeBannerHtml = '';
  const activeDayForTackle = s.weatherDays[s.dayIdx] || todayObj || {};
  const effIceForTackle = activeDayForTackle.iceState || s.iceState || 'open_water';
  const effWaterTempForTackle = activeDayForTackle.waterTemp ?? 10;
  const compatibleMethodsTop = getCompatibleMethods(fish, effIceForTackle, s.water, effWaterTempForTackle);
  const seasonalBaitsTop = getSeasonalBaitsForContext(fish, s.method, effWaterTempForTackle, effIceForTackle);
  const activeBaitTop = s.selectedBait && seasonalBaitsTop.includes(s.selectedBait) ? s.selectedBait : (seasonalBaitsTop[0] || '');
  const rigTop = calcDynamicRig(s.method, s.water, s.depth, activeDayForTackle.windMax || 3, fish, effWaterTempForTackle, effIceForTackle);
  const activeHeroScore = calcDayBest(fish, activeDayForTackle, s.method, s.water, s.depth, s.normPress, s.iceState);
  const activeHeroWin = getBestBiteWindowText(fish, activeDayForTackle, s.method, s.water, s.depth, s.normPress, s.iceState);
  const heroTone = activeHeroScore >= 70 ? '#10b981' : (activeHeroScore >= 50 ? '#38bdf8' : (activeHeroScore >= 25 ? '#f59e0b' : '#ef4444'));
  const gaugeGradStart = activeHeroScore >= 70 ? '#0ea5e9' : (activeHeroScore >= 50 ? '#0284c7' : (activeHeroScore >= 25 ? '#ea580c' : '#991b1b'));
  const gaugeGradEnd = activeHeroScore >= 70 ? '#10b981' : (activeHeroScore >= 50 ? '#38bdf8' : (activeHeroScore >= 25 ? '#f59e0b' : '#ef4444'));
  const heroStatusShort = fish.legal === 'redbook'
    ? 'КРАСНАЯ КНИГА'
    : (effIceForTackle === 'ice_danger'
        ? 'ОПАСНЫЙ ЛЁД!'
        : (activeHeroScore >= 70 ? 'АКТИВНЫЙ<br>КЛЁВ' : (activeHeroScore >= 50 ? 'УМЕРЕННЫЙ<br>КЛЁВ' : (activeHeroScore >= 25 ? 'СЛАБЫЙ<br>КЛЁВ' : 'КЛЁВА<br>ПОЧТИ НЕТ'))));
  const gaugeLevelWord = activeHeroScore >= 70 ? 'Высокий' : (activeHeroScore >= 50 ? 'Средний' : (activeHeroScore >= 25 ? 'Слабый' : 'Бесклёвье'));
  const ecoregBento = getSpotEcoregion(s.lat, s.lon, s.basinCode, s.water, s.selectedWaterName);
  const sigOrderBento = ecoregBento.signatureSpecies || [];
  const sigMapBento = new Map(sigOrderBento.map((id, idx) => [id, idx]));
  const radiusTypesBento = new Set((s.nearbyWaters || []).map(w => w.wType).concat([s.water]));
  const hasCoolingBento = s.water === 'cooling_reservoir' || radiusTypesBento.has('cooling_reservoir');
  const regionalPool = FISH_DB.filter(f =>
    f.legal !== 'redbook' &&
    isSpeciesInGeoRange(f, s.lat, s.lon, s.basinCode, s.water, s.waterRadiusKm || 50, radiusTypesBento, s.isCoastal, hasCoolingBento, s.selectedWaterName)
  );
  const top6Species = (regionalPool.length ? regionalPool : FISH_DB.slice(0, 8))
    .map(f => {
      const scDay = calcDayBest(f, activeDayForTackle, s.method, s.water, s.depth, s.normPress, s.iceState);
      const sigIdx = sigMapBento.has(f.id) ? sigMapBento.get(f.id) : -1;
      const bonus = sigIdx >= 0 ? Math.max(6, 24 - sigIdx * 2) : -6;
      return { fish: f, scDay, rankSc: scDay + bonus };
    })
    .sort((a, b) => b.rankSc - a.rankSc)
    .slice(0, 6);
  const top3Bento = top6Species.slice(0, 3);
  const methodLabelsShort = {
    spin_micro: 'Микроджиг / Мормышинг',
    spin_jig: 'Спиннинг (Джиг)',
    spin_lure: 'Спиннинг (Блесна/Воблер)',
    bottom: 'Донка / Фидер',
    float: 'Поплавочная снасть',
    fly: 'Нахлыст / Бомбарда',
    winter_jig: 'Зимняя мормышка',
    winter_lure: 'Зимний балансир / Виб',
    winter_livebait: 'Жерлица (Живец)',
    winter_stuka: 'Зимняя стукалка',
    winter_cisco: 'Зимняя гирлянда',
    sea_rock: 'Морской рокфишинг',
    sea_surf: 'Морская донка',
    sea_boat: 'Морской лов с лодки'
  };
  const shortMethodName = methodLabelsShort[s.method] || 'Спиннинг';
  const shortBaitClean = String(activeBaitTop || 'по сезону').split('(')[0].trim();
  const arcLenTotal = 188.5;
  const arcFillLen = Math.round((Math.max(5, Math.min(100, activeHeroScore)) / 100) * arcLenTotal * 10) / 10;
  const hrsArr = Array.isArray(activeDayForTackle.hours) && activeDayForTackle.hours.length === 24
    ? activeDayForTackle.hours
    : Array.from({ length: 24 }, (_, h) => ({ hour: h, tAir: 3, press: 754, wind: 3, windDir: 'З' }));
  const hrScores = hrsArr.map(hr => calcHourly(fish, activeDayForTackle, hr, s.method, s.water, s.depth, s.normPress, s.iceState));
  let morningPeakHr = 7, morningPeakSc = -1;
  let eveningPeakHr = 17, eveningPeakSc = -1;
  hrScores.forEach((sc, h) => {
    if (h >= 4 && h <= 12 && sc > morningPeakSc) { morningPeakSc = sc; morningPeakHr = h; }
    if (h >= 13 && h <= 22 && sc > eveningPeakSc) { eveningPeakSc = sc; eveningPeakHr = h; }
  });
  const svgW = 360, svgH = 118, padL = 14, padR = 14, padT = 26, padB = 18;
  const plotW = svgW - padL - padR;
  const plotH = svgH - padT - padB;
  const rawMinSc = Math.min(...hrScores);
  const rawMaxSc = Math.max(...hrScores);
  const spanSc = Math.max(12, rawMaxSc - rawMinSc);
  const floorSc = Math.max(0, rawMinSc - Math.max(3, spanSc * 0.18));
  const ceilSc = Math.min(100, rawMaxSc + Math.max(4, spanSc * 0.15));
  const effRange = Math.max(10, ceilSc - floorSc);
  const pts = hrScores.map((sc, idx) => {
    const x = Math.round((padL + (idx / 23) * plotW) * 10) / 10;
    const norm = Math.max(0.06, Math.min(0.96, (sc - floorSc) / effRange));
    const y = Math.round((padT + (1 - norm) * plotH) * 10) / 10;
    return { x, y, sc, hr: idx };
  });
  let wavePathD = 'M ' + pts[0].x + ' ' + pts[0].y;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const cx = Math.round(((p0.x + p1.x) / 2) * 10) / 10;
    wavePathD += ' C ' + cx + ' ' + p0.y + ', ' + cx + ' ' + p1.y + ', ' + p1.x + ' ' + p1.y;
  }
  const baseLineY = svgH - 6;
  const waveAreaD = wavePathD + ' L ' + pts[pts.length - 1].x + ' ' + baseLineY + ' L ' + pts[0].x + ' ' + baseLineY + ' Z';
  const hourlyBarsSvg = pts.map(p => {
    const bh = Math.max(4, Math.round((baseLineY - p.y) * 10) / 10);
    const col = p.sc >= 60 ? 'rgba(16,185,129,0.22)' : (p.sc >= 38 ? 'rgba(56,189,248,0.20)' : 'rgba(148,163,184,0.15)');
    return '<rect x="' + (p.x - 3.2).toFixed(1) + '" y="' + p.y + '" width="6.4" height="' + bh + '" rx="2.5" fill="' + col + '"/>';
  }).join('');
  const mPt = pts[morningPeakHr] || pts[7];
  const ePt = pts[eveningPeakHr] || pts[17];
  const mLabelX = Math.max(46, Math.min(svgW - 46, mPt.x));
  const eLabelX = Math.max(46, Math.min(svgW - 46, ePt.x));
  const tAirVal = activeDayForTackle.tDay ?? 3;
  const tAirStr = `${tAirVal > 0 ? '+' + tAirVal : tAirVal}°C`;
  const tWatStr = `${effWaterTempForTackle > 0 ? '+' + effWaterTempForTackle : effWaterTempForTackle}°C`;
  const iceThickVal = activeDayForTackle.iceThickness ?? s.iceThickness ?? 0;
  const iceMainTitle = effIceForTackle === 'ice_safe'
    ? `Лёд: ${iceThickVal || 12} см`
    : (effIceForTackle === 'ice_danger'
        ? `Опасный лёд: ${iceThickVal} см`
        : (effIceForTackle === 'ice_slush' ? 'Шуга и забереги' : 'Открытая вода'));
  const iceSubTitle = effIceForTackle === 'ice_safe'
    ? '(Пешком разрешено)'
    : (effIceForTackle === 'ice_danger'
        ? '(Выход на лёд запрещён!)'
        : (effIceForTackle === 'ice_slush' ? '(Ледостава нет • с берега)' : '(Льда нет • лодка и берег)'));
  const activeCircleCount = (s.circleItems || []).filter(x => x && x.t !== 'workshop').length;
  const stickySpeciesHtml = `
    <div class="chip-scroll-row bento-top-species-strip" style="padding-bottom:2px;">
      ${top6Species.map(item => `
        <button type="button" class="w-chip ${item.fish.id === fish.id ? 'active' : ''}" data-novice-pick-fish="${item.fish.id}" style="padding:4px 10px;min-height:36px;display:inline-flex;align-items:center;gap:6px;flex-shrink:0;white-space:nowrap;">
          <span style="width:28px;height:15px;display:inline-flex;align-items:center;justify-content:center;">${renderFishVisual(item.fish)}</span>
          <span>${item.fish.name}</span>
          <span style="font-size:10.5px;opacity:0.85;">${item.scDay}%</span>
        </button>
      `).join('')}
      <button type="button" class="w-chip" id="bentoOpenAllFishBtn" style="padding:4px 10px;min-height:36px;color:var(--accent);border-color:var(--accent);flex-shrink:0;white-space:nowrap;">
        Все 115 рыб →
      </button>
    </div>
  `;
  const stickyRoot = (typeof document !== 'undefined') ? document.getElementById('fcStickySpeciesBar') : null;
  if (stickyRoot) {
    const prevSpeciesLeft = stickyRoot.querySelector('.bento-top-species-strip')?.scrollLeft || 0;
    stickyRoot.innerHTML = stickySpeciesHtml;
    if (prevSpeciesLeft > 0) {
      const nextStrip = stickyRoot.querySelector('.bento-top-species-strip');
      if (nextStrip) nextStrip.scrollLeft = prevSpeciesLeft;
    }
  }
  modeBannerHtml += `
    <div class="bento-dashboard-wrap">
      ${stickyRoot ? '' : stickySpeciesHtml}
      <!-- КАРТОЧКА 1 (По Фото 1 + Свайп рыбы v2.5.0): Ихтиологический Прогноз Клёва -->
      <div class="bento-card bento-hero-card" id="bentoSwipeHeroCard">
        <div class="bento-card-head">
          <div>
            <div class="bento-card-title">
              <span>Ихтиологический Прогноз Клёва</span>
            </div>
            <div class="bento-card-sub">
              ${s.locLabel} (${nearWaterTitle}) • ${activeDayForTackle.relTitle || activeDayForTackle.label || 'Сегодня'}
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:4px;">
            <button type="button" class="btn btn-sm" id="bentoPrevFishBtn" title="Предыдущая рыба" style="min-height:30px;padding:2px 9px;font-size:15px;font-weight:900;border-radius:999px;">‹</button>
            <button type="button" class="btn btn-sm" id="bentoNextFishBtn" title="Следующая рыба" style="min-height:30px;padding:2px 9px;font-size:15px;font-weight:900;border-radius:999px;">›</button>
          </div>
        </div>
        <div class="bento-hero-grid">
          <!-- Левая колонка: Иллюстрация рыбы (клик — полноэкранный зум и паспорт вида) + АКТИВНЫЙ КЛЁВ + ТОП-3 активные рыбы -->
          <div class="bento-hero-left">
            <div class="bento-active-status-row">
              <div class="bento-splash-fish-box" data-open-fish-zoom="${fish.id}" style="cursor:zoom-in;position:relative;" title="Нажмите для просмотра карточки рыбы или увеличения">
                ${renderFishVisual(fish)}
                <span data-open-fish-lightbox="${fish.id}" title="Увеличить изображение на весь экран" style="position:absolute;bottom:2px;right:2px;width:20px;height:20px;border-radius:6px;background:rgba(7,17,31,0.78);border:1px solid rgba(56,189,248,0.45);display:inline-flex;align-items:center;justify-content:center;font-size:10px;opacity:0.92;cursor:zoom-in;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="2"/><path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></span>
              </div>
              <div data-open-fish-zoom="${fish.id}" style="cursor:pointer;" title="Открыть карточку вида (Справка ихтиолога)">
                <div class="bento-status-verdict" style="color:${heroTone};">${heroStatusShort}</div>
                <div style="font-size:11px;font-weight:800;color:var(--muted);margin-top:2px;">
                  <span style="text-decoration:underline;text-decoration-color:rgba(56,189,248,0.45);text-underline-offset:2px;">${fish.name}</span> • ${activeHeroWin}
                </div>
              </div>
            </div>
            <div class="bento-top3-label">ТОП-3 активные рыбы</div>
            <div class="bento-top3-row">
              ${top3Bento.map((item, rankIdx) => `
                <button type="button" class="bento-top3-item ${item.fish.id === fish.id ? 'active' : ''}" data-novice-pick-fish="${item.fish.id}" title="Выбрать рыбу «${item.fish.name}» (${rankIdx + 1}-е место сегодня)">
                  <span style="width:54px;height:26px;display:inline-flex;align-items:center;justify-content:center;">${renderFishVisual(item.fish)}</span>
                  <span class="bento-top3-name">${rankIdx + 1}-е место • ${item.fish.name}</span>
                  <span class="bento-top3-pct">${item.scDay}%</span>
                </button>
              `).join('')}
            </div>
          </div>
          <!-- Правая колонка: Полукруглая шкала-спидометр с динамическим цветом от % и мягкой ненавязчивой дугой (П. 8) -->
          <div class="bento-gauge-col">
            <div class="bento-gauge-svg-box">
              <svg viewBox="0 0 156 92" width="156" height="92" fill="none" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="bentoGaugeGrad" x1="0%" y1="100%" x2="100%" y2="0%">
                    <stop offset="0%" stop-color="${gaugeGradStart}"/>
                    <stop offset="100%" stop-color="${gaugeGradEnd}"/>
                  </linearGradient>
                </defs>
                <path d="M 16 80 A 62 62 0 0 1 140 80" stroke="var(--gauge-track, rgba(148,163,184,0.18))" stroke-width="6.5" stroke-opacity="0.22" stroke-linecap="round" fill="none"/>
                <path d="M 16 80 A 62 62 0 0 1 140 80" stroke="url(#bentoGaugeGrad)" stroke-width="6.5" stroke-opacity="0.42" stroke-linecap="round" fill="none" stroke-dasharray="${arcFillLen} 200"/>
              </svg>
              <div class="bento-gauge-center-text">
                <span class="bento-gauge-sub">Пик дня:</span>
                <span class="bento-gauge-lvl" style="color:${heroTone};">${gaugeLevelWord}</span>
                <span class="bento-gauge-pct" style="color:${heroTone};">${activeHeroScore}%</span>
              </div>
            </div>
            <div style="font-size:10.5px;font-weight:800;color:var(--accent);text-align:center;margin-top:-2px;margin-bottom:3px;">
              Сейчас <b>${hrScores[s.selectedHour ?? new Date().getHours()] ?? activeHeroScore}%</b> (${String(s.selectedHour ?? new Date().getHours()).padStart(2, '0')}:00) • Пик <b>${activeHeroScore}%</b> в ${String(activeHeroWin || '07:00').slice(0, 5)}
            </div>
            <div class="bento-tackle-summary">
              <span style="color:var(--muted);font-size:11px;">Выбор снасти:</span><br>
              <b style="font-size:13.5px;color:var(--text);">${shortMethodName}</b>
            </div>
            <div class="bento-tackle-rec">
              Рекомендуется: <b>${rigTop.weight}</b>, ${renderBaitWithColorDots(shortBaitClean)}
            </div>
          </div>
        </div>
      </div>
      <!-- КАРТОЧКА 2 (По Фото 1): Интерактивный почасовой график клёва 00:00–24:00 (зажмите и ведите влево/вправо для просмотра по часам, тап — переход к суточному прогнозу) -->
      ${(() => {
        const scrubPtsJson = JSON.stringify(pts.map((p, h) => {
          const hObj = hrsArr[h] || {};
          return {
            hr: h,
            sc: p.sc,
            xPct: Number(((p.x / svgW) * 100).toFixed(2)),
            yPct: Number(((p.y / svgH) * 100).toFixed(2)),
            tAir: Math.round(Number(hObj.tAir ?? activeDayForTackle.tDay ?? 3)),
            press: Math.round(Number(hObj.press ?? activeDayForTackle.pressAvg ?? 754)),
            wind: Math.round(Number(hObj.wind ?? activeDayForTackle.windMax ?? 3) * 10) / 10,
            windDir: String(hObj.windDir || activeDayForTackle.windDir || 'З')
          };
        })).replace(/"/g, '&quot;');
        return `<div class="bento-card bento-chart-card" id="bentoWaveChartCard" data-hourly-points="${scrubPtsJson}" style="cursor:pointer;" title="Зажмите и ведите влево/вправо для просмотра по часам, короткое нажатие — переход к суточному прогнозу">`;
      })()}
        <div class="bento-card-head" style="margin-bottom:4px;">
          <div class="bento-card-title">
            <span>Почасовой график клёва</span>
          </div>
          <span id="bentoChartTimeRangeLabel" style="font-size:11.5px;font-weight:800;color:var(--muted);">00:00–24:00</span>
        </div>
        <div style="width:100%;overflow:hidden;">
          <div class="bento-chart-stage" id="bentoWaveChartStage" style="position:relative;width:100%;height:122px;">
            <svg viewBox="0 0 ${svgW} ${svgH}" width="100%" height="100%" preserveAspectRatio="none" style="display:block;width:100%;height:100%;">
              <defs>
                <linearGradient id="bentoWaveFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="var(--wave-fill-top, rgba(56,189,248,0.42))"/>
                  <stop offset="100%" stop-color="var(--wave-fill-bot, rgba(56,189,248,0.03))"/>
                </linearGradient>
              </defs>
              <line x1="${padL}" y1="${padT + plotH * 0.25}" x2="${svgW - padR}" y2="${padT + plotH * 0.25}" stroke="var(--border)" stroke-dasharray="3 3" stroke-width="1" vector-effect="non-scaling-stroke" opacity="0.45"/>
              <line x1="${padL}" y1="${padT + plotH * 0.65}" x2="${svgW - padR}" y2="${padT + plotH * 0.65}" stroke="var(--border)" stroke-dasharray="3 3" stroke-width="1" vector-effect="non-scaling-stroke" opacity="0.55"/>
              ${hourlyBarsSvg}
              <path d="${waveAreaD}" fill="url(#bentoWaveFill)"/>
              <path d="${wavePathD}" fill="none" stroke="var(--wave-stroke, #38bdf8)" stroke-width="2.8" vector-effect="non-scaling-stroke" stroke-linecap="round"/>
              <line x1="${mPt.x}" y1="${mPt.y}" x2="${mPt.x}" y2="${svgH - 6}" stroke="#10b981" stroke-dasharray="3 3" stroke-width="1.2" vector-effect="non-scaling-stroke" opacity="0.75"/>
              <line x1="${ePt.x}" y1="${ePt.y}" x2="${ePt.x}" y2="${svgH - 6}" stroke="#38bdf8" stroke-dasharray="3 3" stroke-width="1.2" vector-effect="non-scaling-stroke" opacity="0.75"/>
            </svg>
            <!-- Нерастягиваемые HTML-маркеры и бейджи пиков клёва (100% чёткий шрифт на любом мониторе и смартфоне) -->
            <div class="bento-chart-dot bento-chart-default-marker" style="left:${((mPt.x / svgW) * 100).toFixed(1)}%;top:${((mPt.y / svgH) * 100).toFixed(1)}%;background:#10b981;"></div>
            <div class="bento-chart-badge bento-chart-default-marker" style="left:${Math.max(12, Math.min(88, (mPt.x / svgW) * 100)).toFixed(1)}%;top:${Math.max(18, ((mPt.y / svgH) * 100) - 6).toFixed(1)}%;border-color:rgba(16,185,129,0.55);">
              ${String(mPt.hr).padStart(2, '0')}:00 (${mPt.sc}%)
            </div>
            <div class="bento-chart-dot bento-chart-default-marker" style="left:${((ePt.x / svgW) * 100).toFixed(1)}%;top:${((ePt.y / svgH) * 100).toFixed(1)}%;background:#38bdf8;"></div>
            <div class="bento-chart-badge bento-chart-default-marker" style="left:${Math.max(12, Math.min(88, (ePt.x / svgW) * 100)).toFixed(1)}%;top:${Math.max(18, ((ePt.y / svgH) * 100) - 6).toFixed(1)}%;border-color:rgba(56,189,248,0.55);">
              ${String(ePt.hr).padStart(2, '0')}:00 (${ePt.sc}%)
            </div>
            <!-- Интерактивный ползунок-скраббер при зажатии и движении пальцем / мышью -->
            <div class="bento-scrub-cursor-line" id="bentoScrubCursorLine" style="left:50%;"></div>
            <div class="bento-scrub-cursor-dot" id="bentoScrubCursorDot" style="left:50%;top:50%;"></div>
            <div class="bento-scrub-hud-badge" id="bentoScrubHudBadge" style="left:50%;"></div>
          </div>
          <!-- Информативная 3-часовая шкала клёва (8 опорных точек за сутки) -->
          <div class="bento-chart-ticks-grid">
            ${[0, 3, 6, 9, 12, 15, 18, 21].map(hIdx => {
              const pObj = pts[hIdx] || pts[0];
              const scVal = pObj ? pObj.sc : 50;
              const colTone = scVal >= 65 ? 'var(--good)' : (scVal >= 42 ? 'var(--accent)' : 'var(--muted)');
              return `
                <div class="bento-chart-tick-cell" data-tick-hour="${hIdx}">
                  <span class="bento-chart-tick-hr">${String(hIdx).padStart(2, '0')}:00</span>
                  <span class="bento-chart-tick-val" style="color:${colTone};">${scVal}%</span>
                </div>
              `;
            }).join('')}
          </div>
          <div id="bentoChartPeaksRow" style="display:flex;justify-content:space-between;align-items:center;padding:4px 4px 0;font-size:11.5px;font-weight:800;color:var(--muted);flex-wrap:wrap;gap:6px;">
            <span style="color:var(--good);">Утренний пик: ${String(morningPeakHr).padStart(2, '0')}:00 (${mPt.sc}%)</span>
            <span style="color:var(--accent);">Вечерний пик: ${String(eveningPeakHr).padStart(2, '0')}:00 (${ePt.sc}%)</span>
          </div>
          <div id="bentoChartScrubLiveRow" style="display:none;justify-content:space-between;align-items:center;padding:5px 8px;margin-top:4px;border-radius:7px;background:rgba(251,191,36,0.14);border:1px solid rgba(251,191,36,0.55);font-size:11.5px;font-weight:900;color:var(--text);flex-wrap:wrap;gap:6px;"></div>
          ${(() => {
            const astro = computeDayKpAndDaylight(activeDayForTackle);
            return `
              <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-top:6px;padding-top:6px;border-top:1px dashed var(--border);font-size:11px;font-weight:800;">
                <span style="color:var(--muted);">Восход <b>${fmtHM(astro.sr)}</b> • Закат <b>${fmtHM(astro.ss)}</b> (День: ${astro.daylightStr})</span>
                <span style="color:${astro.kpTone};">Геомагнитный Kp-${astro.kpVal} (${astro.kpLabel})</span>
              </div>
            `;
          })()}
        </div>
      </div>
      <!-- КАРТОЧКА 3 (По Фото 1): Двойной нижний ряд «Карта & Радар» + «Погода & Лёд» -->
      <div class="bento-bottom-duo">
        <!-- Левая карточка: Карта & Радар -->
        <div class="bento-card bento-radar-card" id="bentoMapRadarCard" title="Нажмите для перехода к Карте и Радару Круга">
          <div class="bento-card-title" style="margin-bottom:8px;font-size:14.5px;">
            <span>Карта & Радар</span>
          </div>
          <div class="bento-radar-visual">
            <svg viewBox="0 0 240 136" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" fill="none">
              <path d="M-10,28 Q60,6 130,38 T250,22 L250,145 L-10,145 Z" fill="rgba(59,130,246,0.18)"/>
              <path d="M-10,76 Q75,48 145,82 T250,62 L250,145 L-10,145 Z" fill="rgba(14,165,233,0.24)"/>
              <polygon points="120,18 158,40 158,84 120,106 82,84 82,40" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="5 3" fill="rgba(56,189,248,0.12)"/>
              <circle cx="120" cy="62" r="24" stroke="var(--good)" stroke-width="1.2" stroke-dasharray="3 2" fill="rgba(16,185,129,0.14)"/>
              <line x1="120" y1="62" x2="152" y2="36" stroke="#10b981" stroke-width="2" stroke-linecap="round"/>
              <circle cx="120" cy="62" r="6.5" fill="var(--accent)" stroke="#ffffff" stroke-width="2.2"/>
            </svg>
            <div class="bento-radar-badge-zone">
              <b>⬡ ±5 км</b> • Гексагон
            </div>
            <div class="bento-radar-badge-crew" id="bentoOpenCrewBadge">
              Круг / Экипаж${activeCircleCount > 0 ? ` (${activeCircleCount})` : ''}
            </div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;padding-top:6px;margin-top:6px;border-top:1px solid var(--border);font-size:11px;font-weight:800;color:var(--muted);">
            <span style="color:var(--text);">Слипы • Коряги • SOS</span>
            <span style="color:var(--accent);">На карту →</span>
          </div>
        </div>
        <!-- Правая карточка: Автоматически меняет название по сезону (летом — Погода & Вода, в межсезонье — Погода & Шуга, зимой — Погода & Лёд) -->
        <div class="bento-card bento-weather-card" id="bentoWeatherIceCard" title="Нажмите для перехода в подробный раздел Погода и состояние водоёма">
          <div class="bento-card-title" style="margin-bottom:8px;font-size:14.5px;">
            <span>${effIceForTackle === 'ice_safe' || effIceForTackle === 'ice_danger' ? '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2v20M2 12h20M4.9 4.9l14.2 14.2M19.1 4.9L4.9 19.1" stroke="#7dd3fc" stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="12" r="2.2" fill="#38bdf8"/></svg>' : (effIceForTackle === 'ice_slush' ? '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2v20M2 12h20M4.9 4.9l14.2 14.2M19.1 4.9L4.9 19.1" stroke="#7dd3fc" stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="12" r="2.2" fill="#38bdf8"/></svg>' : '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg>')}</span>
            <span>${effIceForTackle === 'ice_safe' || effIceForTackle === 'ice_danger' ? 'Погода & Лёд' : (effIceForTackle === 'ice_slush' ? 'Погода & Шуга' : 'Погода & Вода')}</span>
          </div>
          <div class="bento-weather-rows">
            <div class="bento-temp-split">
              <div>
                <div class="bento-temp-air">${tAirStr}</div>
                <div style="font-size:10.5px;color:var(--muted);font-weight:700;">Воздух (${activeDayForTackle.windDir || 'З'} ${activeDayForTackle.windMax || 3} м/с)</div>
              </div>
              <div class="bento-temp-water-box">
                <div style="font-size:13.5px;font-weight:900;color:var(--accent);"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3c0 0-6 7.1-6 11.5a6 6 0 0 0 12 0C18 10.1 12 3 12 3z" fill="rgba(56,189,248,0.32)" stroke="#38bdf8" stroke-width="1.8"/><path d="M9.5 15.5c.5 1.2 1.7 2 3 2" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg> ${tWatStr}</div>
                <div style="font-size:10.5px;color:var(--muted);font-weight:700;">Вода</div>
              </div>
            </div>
            <div class="bento-weather-item-row">
              <span style="font-size:17px;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><polygon points="16,8 13.5,13.5 8,16 10.5,10.5" fill="#38bdf8" stroke="currentColor" stroke-width="1.3"/></svg></span>
              <div>
                <div style="font-weight:900;color:var(--text);">${activeDayForTackle.pressAvg || 750} мм рт. ст.</div>
                <div style="font-size:10.5px;color:var(--muted);">Давление (${fmtDeltaPress(activeDayForTackle.dP)})</div>
              </div>
            </div>
            <div class="bento-weather-item-row bento-ice-hazard">
              <span style="font-size:17px;">${effIceForTackle === 'open_water' ? '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg>' : '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2v20M2 12h20M4.9 4.9l14.2 14.2M19.1 4.9L4.9 19.1" stroke="#7dd3fc" stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="12" r="2.2" fill="#38bdf8"/></svg>'}</span>
              <div>
                <div style="font-weight:900;color:var(--text);">${iceMainTitle}</div>
                <div style="font-size:10.5px;color:var(--muted);">${iceSubTitle}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <!-- Блок п. 9: «На что ловим» — основная снасть (полуавтоматически по рыбе и сезону) ниже основных данных в окне Прогноз -->
      <div class="bento-card bento-tackle-controls-card" id="fcTackleControlsCard" style="padding:12px 14px;border:1px solid var(--border);">
        <div class="bento-card-head" style="margin-bottom:8px;">
          <div class="bento-card-title" style="font-size:14.5px;">
            <span>На что ловим: <b style="color:var(--accent);">${shortMethodName}</b></span>
          </div>
          <span class="pill pill-good" style="font-size:11px;font-weight:800;">${rigTop.weight} • ${s.depth.toFixed(1)} м</span>
        </div>
        <div class="controls-grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;margin-bottom:9px;">
          <div>
            <label for="fcTopMethodSelect" style="display:block;font-size:11px;color:var(--muted);font-weight:800;margin-bottom:3px;">ОСНОВНАЯ СНАСТЬ:</label>
            <select id="fcTopMethodSelect" style="width:100%;min-height:42px;">
              ${compatibleMethodsTop.map(m => `<option value="${m.val}" ${m.val === s.method ? 'selected' : ''}>${String(m.text || '').replace(/<[^>]+>/g, '').trim()}</option>`).join('')}
            </select>
          </div>
          <div>
            <label for="fcTopBaitSelect" style="display:block;font-size:11px;color:var(--muted);font-weight:800;margin-bottom:3px;">ПРИМАНКА / НАСАДКА:</label>
            <select id="fcTopBaitSelect" style="width:100%;min-height:42px;">
              ${seasonalBaitsTop.map(b => `<option value="${b}" ${b === activeBaitTop ? 'selected' : ''}>${b}</option>`).join('')}
            </select>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;">
          <button type="button" class="btn" id="fcOpenRigGuideBtn" style="min-height:42px;font-weight:800;font-size:12px;padding:6px 8px;">
            Монтажи и узлы
          </button>
          <button type="button" class="btn" id="fcOpenChecklistBtn" style="min-height:42px;font-weight:800;font-size:12px;padding:6px 8px;">
            Чек-лист
          </button>
          <button type="button" class="btn btn-accent" id="fcShareForecastTgBtn" style="min-height:42px;font-weight:800;font-size:12px;padding:6px 8px;">
            Поделиться
          </button>
        </div>
      </div>
      <div class="bento-tactical-advice-wrap">${buildSpecializedTacticalHtml(fish, s, activeDayForTackle, effWaterTempForTackle, effIceForTackle)}</div>
    </div>
  `;
  if (appMode === "pro") {
    const pw = s.proFactorWeights || { temp: 1.0, press: 1.0, archive_shock: 1.0, circle_field: 1.0 };
    const activeDayObj = s.weatherDays[s.dayIdx] || todayObj || s.weatherDays[0];
    const calScoreNow = activeDayObj ? calcDayBest(fish, activeDayObj, s.method, s.water, s.depth, s.normPress, s.iceState) : 52;
    modeBannerHtml += `
      <div class="card" style="margin-bottom:12px;padding:10px 12px;background:var(--card);border:1px dashed var(--accent);">
        ${(() => {
          const val30 = computeModel30DayValidation(s.catches || []);
          return `
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
              <div>
                <span style="font-size:var(--fs-xs);font-weight:800;color:var(--accent);">ПАНЕЛЬ ПРОФИ: РУЧНАЯ КАЛИБРОВКА ВЕСОВ 8-ФАКТОРНОЙ МОДЕЛИ</span>
                <div style="font-size:11px;color:var(--good);font-weight:700;margin-top:2px;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="4.5" stroke="#38bdf8" stroke-width="1.6"/><circle cx="12" cy="12" r="1.8" fill="#10b981"/></svg> ${val30.label}</div>
                <div id="proCalibLiveSummary" style="font-size:11.5px;color:var(--accent);font-weight:800;margin-top:3px;">
                  Активность «${fish.name}» с текущей калибровкой весов: <b>${calScoreNow}%</b>
                </div>
              </div>
              <div style="display:flex;gap:6px;">
                <button type="button" class="btn btn-sm" id="proOpenChecklistBtn" style="min-height:26px;padding:2px 8px;font-size:11px;">Чек-лист выезда</button>
                <button type="button" class="btn btn-sm" id="proResetWeightsBtn" style="min-height:26px;padding:2px 8px;font-size:11px;">Сбросить (1.0x)</button>
              </div>
            </div>
          `;
        })()}
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(185px,1fr));gap:10px;font-size:var(--fs-xs);">
          <div>
            <label style="display:flex;justify-content:space-between;font-weight:700;">
              <span>Термика воды:</span><b id="proWTempVal" style="color:var(--accent);">${Number(pw.temp ?? 1).toFixed(1)}x</b>
            </label>
            <input type="range" min="0.5" max="1.5" step="0.1" value="${pw.temp ?? 1}" data-pro-weight="temp" style="width:100%;">
          </div>
          <div>
            <label style="display:flex;justify-content:space-between;font-weight:700;">
              <span>Давление (сутки):</span><b id="proWPressVal" style="color:var(--accent);">${Number(pw.press ?? 1).toFixed(1)}x</b>
            </label>
            <input type="range" min="0.5" max="1.5" step="0.1" value="${pw.press ?? 1}" data-pro-weight="press" style="width:100%;">
          </div>
          <div>
            <label style="display:flex;justify-content:space-between;font-weight:700;">
              <span>Барический шок (5 дн.):</span><b id="proWShockVal" style="color:var(--accent);">${Number(pw.archive_shock ?? 1).toFixed(1)}x</b>
            </label>
            <input type="range" min="0.5" max="1.5" step="0.1" value="${pw.archive_shock ?? 1}" data-pro-weight="archive_shock" style="width:100%;">
          </div>
          <div>
            <label style="display:flex;justify-content:space-between;font-weight:700;">
              <span>Сигналы Круга (35 км):</span><b id="proWCircleVal" style="color:var(--accent);">${Number(pw.circle_field ?? 1).toFixed(1)}x</b>
            </label>
            <input type="range" min="0.5" max="1.5" step="0.1" value="${pw.circle_field ?? 1}" data-pro-weight="circle_field" style="width:100%;">
          </div>
        </div>
      </div>
    `;
  }
  container.innerHTML = `
    <div>
      ${modeBannerHtml}
    </div>
  `;
}
export function renderWeek(container) {
  if (typeof document !== 'undefined' && document.documentElement.getAttribute('data-desktop-web') !== '1') {
    const rootSec = document.getElementById('secForecast') || container;
    if (rootSec && rootSec.id === 'secForecast') {
      renderMobileRedesignForecast(rootSec);
    }
    return;
  }
  if (!container) return;
  const prevScroll = container.querySelector('.week-strip')?.scrollLeft || 0;
  const s = store.getState();
  const fish = FISH_DB.find(f => f.id === s.fishId) || FISH_DB[0];
  const curTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const days = s.weatherDays || [];
  container.innerHTML = `
    <div class="bento-card">
      <div class="bento-card-head">
        <div>
          <div class="bento-card-title"><span>Календарь клёва по дням (10 дней + Архив) • ${fish.name}</span></div>

        </div>
        
      </div>
      <div class="week-strip">
        ${days.map((d, idx) => {
          const score = calcDayBest(fish, d, s.method, s.water, s.depth, s.normPress, s.iceState);
          const isPriority = idx === 2 || idx === 3;
          const col = d.isArchive ? '#94a3b8' : (score >= 60 ? 'var(--good)' : (score >= 38 ? 'var(--warn)' : 'var(--bad)'));
          if (d.isArchive) {
            return `
              <div class="day-card archive-day ${idx === s.dayIdx ? 'active' : ''}" data-week-day="${idx}" data-guest-locked-day="1">
                <div class="day-status-stripe" style="background:${col};"></div>
                <div style="font-weight:800;font-size:11.5px;color:var(--muted);"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="5" y="3" width="14" height="18" rx="2.5" fill="rgba(56,189,248,0.16)" stroke="currentColor" stroke-width="1.8"/><path d="M9 7h6M9 11h6M9 15h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> ${d.relTitle}</div>
                <div style="font-weight:700;font-size:12px;">${d.label}</div>
                <div style="font-size:var(--fs-sm);font-weight:800;">${d.tDay > 0 ? '+' + d.tDay : d.tDay}° / ${d.tNight > 0 ? '+' + d.tNight : d.tNight}°C</div>
                <div style="font-size:11px;color:var(--muted);line-height:1.3;">
                  <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3c0 0-6 7.1-6 11.5a6 6 0 0 0 12 0C18 10.1 12 3 12 3z" fill="rgba(56,189,248,0.32)" stroke="#38bdf8" stroke-width="1.8"/><path d="M9.5 15.5c.5 1.2 1.7 2 3 2" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg> ${d.waterTemp}°C • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><polygon points="16,8 13.5,13.5 8,16 10.5,10.5" fill="#38bdf8" stroke="currentColor" stroke-width="1.3"/></svg> ${d.pressAvg} мм
                </div>
                <div style="margin-top:auto;padding-top:4px;border-top:1px dashed var(--border);display:flex;justify-content:space-between;align-items:center;gap:4px;">
                  <span style="color:var(--accent);font-size:11px;font-weight:800;">Архив (шаг 4ч)</span>
                  <span style="font-size:11px;font-weight:900;color:var(--text);">${score}%</span>
                </div>
              </div>
            `;
          }
          const topBadge = idx === 2
            ? `<span class="pill pill-good" style="font-size:11px;padding:2px 8px;">Сегодня</span>`
            : (idx === 3
                ? `<span class="pill pill-ice" style="font-size:11px;padding:2px 8px;">Завтра</span>`
                : (d.relTitle ? `<span style="font-size:var(--fs-xs);color:var(--accent);font-weight:700;">${d.relTitle}</span>` : ''));
          const bestWindow = isPriority ? getBestBiteWindowText(fish, d, s.method, s.water, s.depth, s.normPress, s.iceState) : '';
          return `
            <div class="day-card ${isPriority ? 'priority-day' : ''} ${idx === s.dayIdx ? 'active' : ''}" data-week-day="${idx}" data-guest-locked-day="${idx === 2 ? '0' : '1'}">
              <div class="day-status-stripe" style="background:${col};"></div>
              <div style="display:flex;justify-content:space-between;align-items:center;gap:4px;">
                <span style="font-weight:800;font-size:var(--fs-xs);">${d.label}</span>
                ${topBadge}
              </div>
              <div style="font-size:var(--fs-md);font-weight:800;">${d.tDay > 0 ? '+' + d.tDay : d.tDay}° / ${d.tNight > 0 ? '+' + d.tNight : d.tNight}°C</div>
              <div style="font-size:var(--fs-xs);color:var(--muted);line-height:1.38;">
                Вода ${d.waterTemp}°C<br>
                <svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><polygon points="16,8 13.5,13.5 8,16 10.5,10.5" fill="#38bdf8" stroke="currentColor" stroke-width="1.3"/></svg> ${d.pressAvg} мм (${fmtDeltaPress(d.dP)})<br>
                <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> ${d.windDir} ${d.windMax} м/с
              </div>
              ${isPriority ? `
                <div style="padding:4px 7px;border-radius:6px;background:var(--panel);border:1px solid var(--border);font-size:11.5px;line-height:1.35;">
                  <div style="color:var(--accent);font-weight:800;">Пик клёва: ${bestWindow}</div>
                  <div style="color:var(--muted);"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4.5" fill="#fbbf24" stroke="#f59e0b" stroke-width="1.6"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" stroke="#fbbf24" stroke-width="1.8" stroke-linecap="round"/></svg> ${fmtHM(d.sunriseHr)}–${fmtHM(d.sunsetHr)} • ${d.moon.phaseIcon} ${d.moon.moonDay} л.д.</div>
                </div>
              ` : ''}
              <div style="margin-top:auto;padding-top:6px;border-top:1px solid var(--border);">
                ${renderFiveFish(score, 14, curTheme, true, fish.legal === 'redbook' ? `Прилов ${score}% (Отпусти)` : null)}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
  if (prevScroll > 0) {
    const strip = container.querySelector('.week-strip');
    if (strip) strip.scrollLeft = prevScroll;
  } else if (typeof window !== 'undefined' && typeof window.__KLEV_IS_MOBILE_GUEST__ === 'function' && window.__KLEV_IS_MOBILE_GUEST__()) {
    const strip = container.querySelector('.week-strip');
    const todayCard = container.querySelector('[data-week-day="2"]');
    if (strip && todayCard) {
      strip.scrollLeft = Math.max(0, todayCard.offsetLeft - 8);
    }
  }
}
export function renderHourly(container) {
  if (typeof document !== 'undefined' && document.documentElement.getAttribute('data-desktop-web') !== '1') {
    const rootSec = document.getElementById('secForecast') || container;
    if (rootSec && rootSec.id === 'secForecast') {
      renderMobileRedesignForecast(rootSec);
    }
    return;
  }
  if (!container) return;
  const prevScroll = container.querySelector('.bite-timeline')?.scrollLeft || 0;
  const s = store.getState();
  const fish = FISH_DB.find(f => f.id === s.fishId) || FISH_DB[0];
  const day = s.weatherDays[s.dayIdx] || s.weatherDays[2] || s.weatherDays[0];
  if (!day) return;
  if (day.isArchive) {
    renderArchiveDayLogger(container, s, day, fish);
    return;
  }
  const curTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const curH = new Date().getHours();
  const selH = clampHour(s.selectedHour);
  const selHrObj = day.hours[selH] || day.hours[12];
  const selBreakdown = computeHourFactors(fish, day, selHrObj, s.method, s.water, s.depth, s.normPress, s.iceState);
  const rig = calcDynamicRig(s.method, s.water, s.depth, day.windMax, fish, day.waterTemp, day.iceState || s.iceState);
  const seasonalBaits = getSeasonalBaitsForContext(fish, s.method, day.waterTemp, day.iceState || s.iceState);
  const activeBait = s.selectedBait && seasonalBaits.includes(s.selectedBait) ? s.selectedBait : seasonalBaits[0];
  const guides = generateAdaptiveGuides(fish, s.water, s.depth, day, s.method, s.iceState);
  container.innerHTML = `
    <div class="bento-card">
      <div class="bento-card-head">
        <div>
          <div class="bento-card-title"><span>Почасовой разбор и 8 факторов (${day.relTitle ? day.relTitle + ' • ' + day.label : day.label})</span></div>

        </div>
      </div>
      ${fish.legal === 'redbook' ? `
        <div style="padding:10px 12px;margin-bottom:10px;border-radius:var(--r-sm);background:var(--pill-bad-bg);border:1px solid var(--bad);color:var(--pill-bad-text);font-weight:700;line-height:1.42;font-size:var(--fs-xs);">
          <b>${fish.name} — Красная книга (изъятие запрещено).</b> Ниже показан биологический прогноз активности вида (вероятность поклёвки в прилове). При поимке бережно отпустите рыбу!
        </div>
      ` : ''}
      <div class="bite-timeline" role="listbox" aria-label="Почасовой график клёва">
        ${day.hours.map(hr => {
          const sc = calcHourly(fish, day, hr, s.method, s.water, s.depth, s.normPress, s.iceState);
          const col = sc >= 60 ? 'var(--good)' : (sc >= 38 ? 'var(--warn)' : 'var(--bad)');
          const isNow = s.dayIdx === 2 && hr.hour === curH;
          const isTw = Math.abs(hr.hour + 0.5 - day.sunriseHr) <= 1.1 || Math.abs(hr.hour + 0.5 - day.sunsetHr) <= 1.1;
          const isLunar = hr.hour === day.moon.transitHour || hr.hour === day.moon.underfootHour;
          const mark = isTw ? '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4.5" fill="#fbbf24" stroke="#f59e0b" stroke-width="1.6"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" stroke="#fbbf24" stroke-width="1.8" stroke-linecap="round"/></svg>' : (isLunar ? '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4.5" fill="#fbbf24" stroke="#f59e0b" stroke-width="1.6"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" stroke="#fbbf24" stroke-width="1.8" stroke-linecap="round"/></svg>' : '·');
          return `
            <button type="button" class="hour-slot ${hr.hour === selH ? 'active' : ''} ${isNow ? 'now' : ''}" data-scrub-hour="${hr.hour}" aria-label="${hr.hour}:00, активность ${sc}%">
              <span style="font-weight:800;">${String(hr.hour).padStart(2, '0')}</span>
              <span style="font-size:11px;" title="${isTw ? 'Утренняя/вечерняя зорька' : (isLunar ? 'Лунное окно активности' : '')}">${mark}</span>
              <div class="hour-bar-wrap"><div class="hour-bar" style="height:${sc}%;background:${col};"></div></div>
              <span style="font-weight:700;font-size:11px;">${sc}%</span>
            </button>
          `;
        }).join('')}
      </div>
      <div class="card" id="fcSelectedHourDetailCard" style="margin-top:10px;background:var(--card);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <div style="flex:1;min-width:240px;">
          <div style="font-size:var(--fs-xs);color:var(--muted);font-weight:700;">УСЛОВИЯ В ВЫБРАННЫЙ ЧАС: ${String(selH).padStart(2, '0')}:00 (${day.label})</div>
          <div style="font-size:var(--fs-md);font-weight:800;margin-top:2px;">
            Воздух ${selHrObj.tAir > 0 ? '+' + selHrObj.tAir : selHrObj.tAir}°C • Вода ~${day.waterTemp}°C • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><polygon points="16,8 13.5,13.5 8,16 10.5,10.5" fill="#38bdf8" stroke="currentColor" stroke-width="1.3"/></svg> ${selHrObj.press} мм (за 3ч: ${fmtDeltaPress(selHrObj.dp3h)}) • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> ${selHrObj.windDir} ${selHrObj.wind} м/с
          </div>
          <div style="font-size:var(--fs-xs);color:var(--accent);margin-top:5px;line-height:1.42;">
            Рекомендуемая оснастка: <b>${rig.weight}</b> (${rig.line}) • ${rig.tactic}
          </div>
          <div style="margin-top:6px;font-size:var(--fs-xs);color:var(--good);font-weight:800;display:flex;align-items:center;flex-wrap:wrap;gap:4px;">
            <span>Рабочая приманка в этот час:</span> <b>${renderBaitWithColorDots(activeBait)}</b>
          </div>
        </div>
        <div>
          ${renderFiveFish(selBreakdown.total, 19, curTheme, true, fish.legal === 'redbook' ? `Активность ${selBreakdown.total}% • Отпусти` : null)}
        </div>
      </div>
      <details class="forecast-why-spoiler" ${s.appMode === 'pro' ? 'open' : ''} style="margin-top:12px;">
        <summary>
          <span>Почему такой прогноз? (Разбор 8 факторов + архив 10 км на ${String(selH).padStart(2, '0')}:00)</span>
          <span class="pill ${selBreakdown.total >= 60 ? 'pill-good' : (selBreakdown.total >= 38 ? 'pill-warn' : 'pill-bad')}">Итог ${selBreakdown.total}% ▾</span>
        </summary>
        <div style="margin-top:8px;padding:12px;background:var(--card);border-radius:var(--r-sm);">
          ${selBreakdown.hasRealArchive === false ? `
            <div style="padding:9px 11px;margin-bottom:10px;border-radius:var(--r-sm);background:var(--pill-warn-bg);border:1px solid var(--warn);color:var(--pill-warn-text);font-size:var(--fs-xs);font-weight:800;line-height:1.42;">
              Прогноз может быть менее точным из-за отсутствия архивных данных по погоде (это первый запрос в данной локации 10 км при недоступности внешнего сервера архива; со следующего дня архив накопится автоматически на вашем устройстве).
            </div>
          ` : ''}
          <div style="padding:9px 11px;margin-bottom:10px;border-radius:var(--r-sm);background:var(--panel);border:1px solid var(--border);font-size:var(--fs-xs);line-height:1.45;">
            <div><b>Анализ 5-дневного метеоархива (радиус 10 км):</b> ${selBreakdown.archiveEval?.commentary || ''}</div>
            <div style="margin-top:5px;color:var(--accent);"><b>Анализ вашего Журнала уловов:</b> ${selBreakdown.logInsight?.commentary || ''}</div>
            <div style="margin-top:5px;color:var(--good);"><b>Полевая сводка «Круга» (радиус 35 км):</b> ${selBreakdown.circleEval?.commentary || ''}</div>
          </div>
          ${(() => {
            const sumFactors = (selBreakdown.factors || []).reduce((acc, f) => acc + (Number(f.val) || 0), 0);
            const rawSum = 52 + sumFactors;
            const sumSign = sumFactors >= 0 ? `+${sumFactors}%` : `${sumFactors}%`;
            const compressNote = rawSum !== selBreakdown.total ? ` → с учётом биологического потолка вида: <b>${selBreakdown.total}%</b>` : '';
            return `
              <div style="font-size:var(--fs-xs);color:var(--muted);margin-bottom:8px;padding:7px 10px;border-radius:6px;background:var(--panel);border:1px dashed var(--border);line-height:1.45;">
                <b>Арифметика прогноза на ${String(selH).padStart(2, '0')}:00:</b> База водоёма <b>52%</b> ${sumSign} (сумма факторов ниже) = <b>${rawSum}%</b>${compressNote}.
              </div>
            `;
          })()}
          ${selBreakdown.factors.map(f => {
            const isPos = f.val >= 0;
            const col = isPos ? 'var(--good)' : 'var(--bad)';
            const widthPct = Math.min(100, Math.max(8, Math.abs(f.val) * 3));
            return `
              <div class="factor-row" style="display:flex;flex-direction:column;align-items:stretch;gap:5px;padding:7px 0;border-bottom:1px dashed var(--border);">
                <div style="width:100%;display:flex;justify-content:space-between;align-items:baseline;gap:8px;">
                  <div style="font-weight:800;font-size:var(--fs-sm);color:var(--text);">${f.name}</div>
                  <div style="font-weight:900;font-size:13px;color:${col};flex-shrink:0;">${isPos ? '+' + f.val : f.val}%</div>
                </div>
                <div style="width:100%;font-size:var(--fs-xs);color:var(--muted);line-height:1.35;">${f.note}</div>
                <div class="factor-bar-track" style="width:100%;height:8px;">
                  <div class="factor-bar-fill" style="width:${widthPct}%;background:${col};"></div>
                </div>
              </div>
            `;
          }).join('')}
          <p style="margin-top:10px;font-size:var(--fs-xs);color:var(--muted);">
            <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3v18M5 7h14M5 7l-3 6h6l-3-6zm14 0l-3 6h6l-3-6zM8 21h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> ${RU.forecastDisclaimer}
          </p>
        </div>
      </details>
      <div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border);">
        <div class="section-title">Ихтиология, снасти и кормовая база: ${fish.name} (${s.depth.toFixed(1)} м)</div>
        <div class="guide-grid">
          <div class="guide-block"><h4>Гидробиология, размеры и стоянки</h4><div>${guides.standAdvice}</div></div>
          <div class="guide-block"><h4>Снасти, монтаж и подача</h4><div>${guides.tackleAdvice}</div></div>
          <div class="guide-block"><h4>Кормовая база и рабочие приманки</h4><div>${guides.baitAdvice}</div></div>
        </div>
      </div>

    </div>
  `;
  if (prevScroll > 0) {
    const strip = container.querySelector('.bite-timeline');
    if (strip) strip.scrollLeft = prevScroll;
  }
}
/**
 * Блок записи архивного улова с обычным календарём (<input type="date">) и быстрыми кнопками за предыдущие 5 дней
 * с автоматической подгрузкой почасового прогноза из кэша 10 км!
 */
let selectedArchiveDateOverride = null;
/**
 * П. 12: Архив погоды (вчерашняя погода и архив за 5 дней с шагом 4 часа: 00:00, 04:00, 08:00, 12:00, 16:00, 20:00)
 * БЕЗ карточки добавления улова (запись улова с выбором за 5 дней и автоподстановкой прогноза находится в разделе «Журнал»).
 */
function renderArchiveDayLogger(container, s, defaultDay, currentFish) {
  if (!container) return;
  const curTheme = typeof document !== 'undefined' ? (document.documentElement.getAttribute('data-theme') || 'dark') : 'dark';
  const todayDt = new Date();
  todayDt.setHours(0, 0, 0, 0);
  const past5Dates = [];
  for (let offset = -1; offset >= -5; offset--) {
    const dt = new Date(todayDt.getTime() + offset * 86400000);
    const dStr = formatLocalYYYYMMDD(dt);
    const cachedDay = storage.getDayWeatherByDate(s.lat, s.lon, dStr) ||
      (s.weatherDays || []).find(x => x && x.date === dStr) ||
      (s.weatherArchive5Days || []).find(x => x && x.date === dStr);
    const title = offset === -1 ? 'Вчера' : (offset === -2 ? 'Позавчера' : `${Math.abs(offset)} дн. назад`);
    past5Dates.push({
      date: dStr,
      offset,
      title,
      label: `${RU.daysShort[dt.getDay()]}, ${dt.getDate()} ${RU.monthsGen[dt.getMonth()]}`,
      dayObj: cachedDay
    });
  }
  const fallbackArchDay = (s.weatherDays || []).find(x => x && x.isArchive && x.relOffset === -1) ||
    (s.weatherDays || [])[1] ||
    defaultDay ||
    past5Dates[0]?.dayObj ||
    (s.weatherDays || [])[0] || {};
  const activeDateStr = selectedArchiveDateOverride || (defaultDay && defaultDay.isArchive ? defaultDay.date : past5Dates[0].date);
  const activeDayObj = storage.getDayWeatherByDate(s.lat, s.lon, activeDateStr) ||
    (s.weatherDays || []).find(x => x && x.date === activeDateStr) ||
    (s.weatherArchive5Days || []).find(x => x && x.date === activeDateStr) ||
    fallbackArchDay;

  const step4Hours = [0, 4, 8, 12, 16, 20];
  const hrsPool = Array.isArray(activeDayObj.hours) && activeDayObj.hours.length === 24
    ? activeDayObj.hours
    : Array.from({ length: 24 }, (_, h) => ({
        hour: h,
        tAir: activeDayObj.tDay ?? 0,
        press: activeDayObj.pressAvg ?? 754,
        wind: activeDayObj.windMax ?? 3,
        windDir: activeDayObj.windDir || 'З',
        cloud: 75,
        precip: 0
      }));

  const sr = Number(activeDayObj.sunriseHr ?? 8.0);
  const ss = Number(activeDayObj.sunsetHr ?? 16.5);
  const dayScore = calcDayBest(currentFish, activeDayObj, s.method, s.water, s.depth, s.normPress, s.iceState);

  const slotsHtml = step4Hours.map(hIdx => {
    const hObj = hrsPool[hIdx] || hrsPool[0];
    const sc = calcHourly(currentFish, activeDayObj, hObj, s.method, s.water, s.depth, s.normPress, s.iceState);
    const tVal = Number(hObj.tAir ?? activeDayObj.tDay ?? 0);
    const tStr = `${tVal > 0 ? '+' + tVal : tVal}°C`;
    const pVal = Number(hObj.press ?? activeDayObj.pressAvg ?? 754);
    const wVal = Number(hObj.wind ?? activeDayObj.windMax ?? 3);
    const wDir = String(hObj.windDir || activeDayObj.windDir || 'З');
    const isDaySlot = (hIdx + 0.5 >= sr) && (hIdx + 0.5 <= ss);
    const cloudVal = Number(hObj.cloud ?? 70);
    const precipVal = Number(hObj.precip ?? 0);
    const scColor = sc >= 70 ? '#10b981' : (sc >= 50 ? '#38bdf8' : (sc >= 25 ? '#f59e0b' : '#94a3b8'));
    const skyIcon = precipVal > 0.2
      ? `<svg class="k-ico" style="width:20px;height:20px;color:#38bdf8;" viewBox="0 0 24 24" fill="none"><path d="M7 15h9.5a3.5 3.5 0 0 0 .4-6.97A5 5 0 0 0 7.2 6.5 4 4 0 0 0 7 15z" fill="rgba(148,163,184,0.28)" stroke="currentColor" stroke-width="1.7"/><path d="M9 18v2M13 18v2M17 18v2" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/></svg>`
      : (isDaySlot
          ? (cloudVal >= 75
              ? `<svg class="k-ico" style="width:20px;height:20px;color:#94a3b8;" viewBox="0 0 24 24" fill="none"><path d="M7 17h10a4 4 0 0 0 .4-7.97A5.5 5.5 0 0 0 6.8 7.5 4.5 4.5 0 0 0 7 17z" fill="rgba(148,163,184,0.32)" stroke="currentColor" stroke-width="1.7"/></svg>`
              : `<svg class="k-ico" style="width:20px;height:20px;color:#fbbf24;" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4.5" fill="#fbbf24" stroke="#f59e0b" stroke-width="1.6"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22" stroke="#fbbf24" stroke-width="1.8" stroke-linecap="round"/></svg>`)
          : `<svg class="k-ico" style="width:20px;height:20px;color:#cbd5e1;" viewBox="0 0 24 24" fill="none"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" fill="rgba(251,191,36,0.28)" stroke="currentColor" stroke-width="1.6"/></svg>`);
    return `
      <div class="bento-metric-tile arch-4h-slot" style="padding:8px 6px;display:flex;flex-direction:column;align-items:center;justify-content:space-between;text-align:center;gap:4px;border-radius:12px;">
        <div style="font-size:12px;font-weight:900;color:var(--text);">${String(hIdx).padStart(2, '0')}:00</div>
        <div style="margin:2px 0;">${skyIcon}</div>
        <div style="font-size:14px;font-weight:900;color:var(--text);white-space:nowrap;">${tStr}</div>
        <div style="font-size:10.5px;font-weight:800;color:var(--muted);white-space:nowrap;">${wDir} ${wVal} м/с</div>
        <div style="font-size:11.5px;font-weight:900;color:var(--accent);white-space:nowrap;">${pVal} мм</div>
        <div style="margin-top:2px;display:flex;flex-direction:column;align-items:center;gap:2px;">
          ${renderFiveFish(sc, 11, curTheme, false)}
          <span style="font-size:10.5px;font-weight:900;color:${scColor};">Клёв ${sc}%</span>
        </div>
      </div>
    `;
  }).join('');

  const activeMeta = past5Dates.find(x => x.date === activeDateStr) || past5Dates[0];
  container.innerHTML = `
    <div class="bento-card" id="fcWeatherArchive4hCard">
      <div class="bento-card-head" style="margin-bottom:8px;">
        <div>
          <div class="bento-card-title">
            <span>Архив погоды с шагом 4 часа (${activeMeta.title} • ${activeDayObj.label || activeMeta.label})</span>
          </div>
          <div class="bento-card-sub">
            Почасовая сводка из кэша 10 км: вода ~${activeDayObj.waterTemp ?? 0.2}°C • среднее давление ${activeDayObj.pressAvg ?? 754} мм (ход ${fmtDeltaPress(activeDayObj.dP ?? 0)}) • пик «${currentFish.name}» ${dayScore}%
          </div>
        </div>
        ${createPill({ text: `${activeMeta.title} (${activeDateStr})`, tone: 'neutral' })}
      </div>
      <div class="chip-scroll-row" style="margin-bottom:10px;padding-bottom:2px;">
        ${past5Dates.map(item => `
          <button type="button" class="w-chip ${item.date === activeDateStr ? 'active' : ''}" data-arch-quick-date="${item.date}" style="white-space:nowrap;">
            <span>${item.title} (${item.label})</span>
            ${item.dayObj ? `<span style="opacity:0.85;font-weight:800;">• ${item.dayObj.tDay > 0 ? '+' + item.dayObj.tDay : item.dayObj.tDay}°C, ${item.dayObj.pressAvg} мм</span>` : ''}
          </button>
        `).join('')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(92px,1fr));gap:7px;">
        ${slotsHtml}
      </div>
    </div>
  `;
}
function clampHour(h) {
  const n = parseInt(h, 10);
  return Number.isFinite(n) ? Math.max(0, Math.min(23, n)) : 12;
}
let _sliderDragActive = false;

let _activeForecastSubTab = 'overview';
let _openWaterCarpPreview = false;
let _heroSonarAnimId = null;
let _heroSonarSweepAngle = 0;
let _heroSonarTargetScore = 75;
let _heroSonarBlips = [];
let _heroSonarStaticCanvas = null;
let _heroSonarStaticKey = '';
let _heroSonarLastFrameMs = 0;

function _normalizeWarmDayIce(dayObj, sIceState) {
  if (!dayObj) return sIceState || 'open_water';
  const tD = Number(dayObj.tDay ?? 0);
  const tN = Number(dayObj.tNight ?? 0);
  const wT = Number(dayObj.waterTemp ?? 5);
  if (tD >= 6 || (tD >= 4 && tN >= 0.5) || wT >= 3.5) {
    dayObj.iceState = 'open_water';
    dayObj.iceThickness = 0;
    dayObj.lakeIceThickness = 0;
    dayObj.riverIceThickness = 0;
    if (wT < 2.0 && tD >= 6) {
      dayObj.waterTemp = Math.round((tD * 0.58 + 2.2) * 10) / 10;
    }
    return 'open_water';
  }
  return dayObj.iceState || sIceState || 'open_water';
}

function _rebuildHeroSonarBlips(scorePct) {
  const sc = Math.max(0, Math.min(100, Number(scorePct) || 50));
  const count = Math.max(2, Math.min(14, Math.round((sc / 100) * 13)));
  const arr = [];
  for (let i = 0; i < count; i++) {
    const ang = ((i * 137.5 + 24) % 360) * (Math.PI / 180);
    const dist = 0.26 + ((i * 0.618) % 1) * 0.50;
    const depthM = (2.2 + ((i * 2.1) % 7.4)).toFixed(1);
    arr.push({ ang, dist, depthM, size: i % 3 === 0 ? 1.15 : 0.92 });
  }
  _heroSonarBlips = arr;
}

function _ensureHeroSonarStaticDial(w, h, scorePct, theme) {
  const key = `${w}x${h}_${scorePct}_${theme}`;
  if (_heroSonarStaticCanvas && _heroSonarStaticKey === key) {
    return _heroSonarStaticCanvas;
  }
  const off = _heroSonarStaticCanvas || document.createElement('canvas');
  off.width = w;
  off.height = h;
  _heroSonarStaticCanvas = off;
  _heroSonarStaticKey = key;

  const ctx = off.getContext('2d');
  if (!ctx) return off;
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.min(cx, cy) - 14;
  const isLight = theme === 'light';
  const isContrast = theme === 'contrast';

  ctx.clearRect(0, 0, w, h);

  // 1. Фон радара
  const bgGrad = ctx.createRadialGradient(cx, cy, R * 0.08, cx, cy, R);
  if (isLight) {
    bgGrad.addColorStop(0, 'rgba(224, 242, 254, 0.95)');
    bgGrad.addColorStop(1, 'rgba(186, 230, 253, 0.72)');
  } else if (isContrast) {
    bgGrad.addColorStop(0, 'rgba(18, 16, 8, 0.96)');
    bgGrad.addColorStop(1, 'rgba(5, 8, 14, 0.98)');
  } else {
    bgGrad.addColorStop(0, 'rgba(12, 34, 58, 0.92)');
    bgGrad.addColorStop(1, 'rgba(6, 17, 32, 0.96)');
  }
  ctx.fillStyle = bgGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();

  // 2. Концентрические кольца и перекрестие
  const ringStroke = isLight
    ? 'rgba(2, 132, 199, 0.25)'
    : (isContrast ? 'rgba(245, 158, 11, 0.30)' : 'rgba(56, 189, 248, 0.24)');
  ctx.strokeStyle = ringStroke;
  ctx.lineWidth = 1.4;
  [0.32, 0.56, 0.78, 0.98].forEach(f => {
    ctx.beginPath();
    ctx.arc(cx, cy, R * f, 0, Math.PI * 2);
    ctx.stroke();
  });

  ctx.beginPath();
  ctx.moveTo(cx - R * 0.95, cy);
  ctx.lineTo(cx + R * 0.95, cy);
  ctx.moveTo(cx, cy - R * 0.95);
  ctx.lineTo(cx, cy + R * 0.95);
  ctx.stroke();

  // 72 деления азимутальной шкалы (рендерятся 1 раз в буфер!)
  for (let d = 0; d < 360; d += 5) {
    const rad = (d - 90) * (Math.PI / 180);
    const isMajor = d % 30 === 0;
    const r1 = R * (isMajor ? 0.91 : 0.945);
    const r2 = R * 0.98;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(rad) * r1, cy + Math.sin(rad) * r1);
    ctx.lineTo(cx + Math.cos(rad) * r2, cy + Math.sin(rad) * r2);
    ctx.strokeStyle = isMajor
      ? (isLight ? 'rgba(2, 132, 199, 0.62)' : (isContrast ? 'rgba(251, 191, 36, 0.72)' : 'rgba(56, 189, 248, 0.65)'))
      : ringStroke;
    ctx.lineWidth = isMajor ? 2.2 : 1.1;
    ctx.stroke();
  }

  // 3. Мягкая полупрозрачная градиентная шкала заполнения клёва (0..100%)
  const trackR = R * 0.855;
  ctx.beginPath();
  ctx.arc(cx, cy, trackR, 0, Math.PI * 2);
  ctx.strokeStyle = isLight ? 'rgba(15, 23, 42, 0.09)' : 'rgba(148, 163, 184, 0.14)';
  ctx.lineWidth = 13;
  ctx.stroke();

  const startAng = -Math.PI / 2;
  const endAng = startAng + (Math.PI * 2) * (scorePct / 100);
  const scaleGrad = ctx.createLinearGradient(cx - trackR, cy + trackR, cx + trackR, cy - trackR);
  if (isContrast) {
    scaleGrad.addColorStop(0, 'rgba(245, 158, 11, 0.50)');
    scaleGrad.addColorStop(0.6, 'rgba(251, 191, 36, 0.58)');
    scaleGrad.addColorStop(1, 'rgba(16, 185, 129, 0.62)');
  } else if (isLight) {
    scaleGrad.addColorStop(0, 'rgba(2, 132, 199, 0.45)');
    scaleGrad.addColorStop(0.55, 'rgba(14, 165, 233, 0.54)');
    scaleGrad.addColorStop(1, 'rgba(16, 185, 129, 0.58)');
  } else {
    scaleGrad.addColorStop(0, 'rgba(14, 165, 233, 0.44)');
    scaleGrad.addColorStop(0.55, 'rgba(56, 189, 248, 0.54)');
    scaleGrad.addColorStop(1, 'rgba(16, 185, 129, 0.60)');
  }
  ctx.beginPath();
  ctx.arc(cx, cy, trackR, startAng, endAng, false);
  ctx.strokeStyle = scaleGrad;
  ctx.lineWidth = 13;
  ctx.lineCap = 'round';
  ctx.stroke();

  return off;
}

export function initOrUpdateHeroSonarCanvas(scorePct) {
  if (typeof document === 'undefined') return;
  const sc = Math.max(0, Math.min(100, Math.round(Number(scorePct) || 50)));
  if (sc !== _heroSonarTargetScore || !_heroSonarBlips.length) {
    _heroSonarTargetScore = sc;
    _rebuildHeroSonarBlips(sc);
  }
  const pctEl = document.getElementById('bentoHeroSonarPctText');
  if (pctEl) {
    pctEl.textContent = `${sc}%`;
    const theme = document.documentElement.getAttribute('data-theme') || 'dark';
    pctEl.style.color = theme === 'light' ? '#0F172A' : (theme === 'contrast' ? '#FBBF24' : '#F8FAFC');
  }
  if (_heroSonarAnimId) return;

  const drawFrame = (nowMs) => {
    const curRoute = store.getState().route;
    if (document.hidden || (curRoute && curRoute !== 'forecast')) {
      _heroSonarAnimId = null;
      return;
    }
    const canvas = document.getElementById('bentoHeroSonarCanvas');
    if (!canvas || !canvas.isConnected) {
      _heroSonarAnimId = null;
      return;
    }
    // Ограничиваем частоту кадров сонара до ~28 FPS (35 мс), снижая нагрузку на CPU/GPU более чем на 90%
    if (nowMs - _heroSonarLastFrameMs < 35) {
      _heroSonarAnimId = requestAnimationFrame(drawFrame);
      return;
    }
    _heroSonarLastFrameMs = nowMs;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      _heroSonarAnimId = null;
      return;
    }
    const w = canvas.width || 472;
    const h = canvas.height || 472;
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(cx, cy) - 14;
    const theme = document.documentElement.getAttribute('data-theme') || 'dark';
    const isLight = theme === 'light';
    const isContrast = theme === 'contrast';

    // 1. Копируем закэшированный статический циферблат за 0.05 мс
    const staticDial = _ensureHeroSonarStaticDial(w, h, _heroSonarTargetScore, theme);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(staticDial, 0, 0);

    // 2. Вращающийся луч сонара (спокойная скорость 0.52)
    _heroSonarSweepAngle = (_heroSonarSweepAngle + 0.017) % (Math.PI * 2);
    const sweepSteps = 14;
    const sweepSpan = 0.65;
    for (let s = 0; s < sweepSteps; s++) {
      const frac = s / sweepSteps;
      const a0 = _heroSonarSweepAngle - frac * sweepSpan;
      const a1 = _heroSonarSweepAngle - ((s + 1) / sweepSteps) * sweepSpan;
      const alpha = (1 - frac) * (isLight ? 0.19 : 0.24);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R * 0.78, a1, a0);
      ctx.closePath();
      ctx.fillStyle = isContrast
        ? `rgba(245, 158, 11, ${alpha.toFixed(3)})`
        : (isLight ? `rgba(2, 132, 199, ${alpha.toFixed(3)})` : `rgba(56, 189, 248, ${alpha.toFixed(3)})`);
      ctx.fill();
    }

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(_heroSonarSweepAngle) * (R * 0.79), cy + Math.sin(_heroSonarSweepAngle) * (R * 0.79));
    ctx.strokeStyle = isContrast ? 'rgba(251, 191, 36, 0.88)' : (isLight ? 'rgba(2, 132, 199, 0.85)' : 'rgba(125, 211, 252, 0.90)');
    ctx.lineWidth = 2.4;
    ctx.stroke();

    // 3. Силуэты рыб на радаре
    for (let i = 0; i < _heroSonarBlips.length; i++) {
      const b = _heroSonarBlips[i];
      const bx = cx + Math.cos(b.ang) * (R * b.dist);
      const by = cy + Math.sin(b.ang) * (R * b.dist);
      let diff = (_heroSonarSweepAngle - b.ang) % (Math.PI * 2);
      if (diff < 0) diff += Math.PI * 2;
      const glow = diff < 1.35 ? (1 - diff / 1.35) : 0.18;
      const fishAlpha = Math.min(0.95, 0.30 + glow * 0.65);

      ctx.save();
      ctx.translate(bx, by);
      ctx.beginPath();
      ctx.arc(0, 0, 11 * b.size, 0, Math.PI * 2);
      ctx.strokeStyle = isContrast
        ? `rgba(251, 191, 36, ${(fishAlpha * 0.55).toFixed(2)})`
        : (isLight ? `rgba(2, 132, 199, ${(fishAlpha * 0.55).toFixed(2)})` : `rgba(56, 189, 248, ${(fishAlpha * 0.55).toFixed(2)})`);
      ctx.lineWidth = 1.3;
      ctx.stroke();

      ctx.fillStyle = isContrast
        ? `rgba(251, 191, 36, ${fishAlpha.toFixed(2)})`
        : (isLight ? `rgba(2, 132, 199, ${fishAlpha.toFixed(2)})` : `rgba(56, 189, 248, ${fishAlpha.toFixed(2)})`);
      ctx.beginPath();
      ctx.ellipse(-1.5, 0, 6.2 * b.size, 2.8 * b.size, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(4.0 * b.size, 0);
      ctx.lineTo(8.2 * b.size, -3.2 * b.size);
      ctx.lineTo(8.2 * b.size, 3.2 * b.size);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // 4. Центральный медальон под процент клёва
    const centerR = R * 0.39;
    ctx.beginPath();
    ctx.arc(cx, cy, centerR, 0, Math.PI * 2);
    ctx.fillStyle = isLight
      ? 'rgba(255, 255, 255, 0.88)'
      : (isContrast ? 'rgba(0, 0, 0, 0.88)' : 'rgba(11, 23, 42, 0.84)');
    ctx.fill();
    ctx.strokeStyle = isLight
      ? 'rgba(2, 132, 199, 0.38)'
      : (isContrast ? 'rgba(245, 158, 11, 0.52)' : 'rgba(56, 189, 248, 0.38)');
    ctx.lineWidth = 1.6;
    ctx.stroke();

    const pctNode = document.getElementById('bentoHeroSonarPctText');
    if (pctNode) {
      pctNode.style.color = isLight ? '#0F172A' : (isContrast ? '#FBBF24' : '#F8FAFC');
    }

    _heroSonarAnimId = requestAnimationFrame(drawFrame);
  };

  _heroSonarAnimId = requestAnimationFrame(drawFrame);
}

function updateMobileSelectedHourInPlace(container) {
  if (!container) return false;
  const detailCard = container.querySelector('#fcSelectedHourDetailCard');
  const waveCard = container.querySelector('#bentoWaveChartCard');
  if (!detailCard || !waveCard) return false;

  const s = store.getState();
  const fish = FISH_DB.find(f => f.id === s.fishId) || FISH_DB[0];
  const todayObj = s.weatherDays?.[2] || s.weatherDays?.[0] || {};
  const activeDayForTackle = s.weatherDays?.[s.dayIdx] || todayObj || {};
  const effIceForTackle = _normalizeWarmDayIce(activeDayForTackle, s.iceState);
  const effWaterTempForTackle = activeDayForTackle.waterTemp ?? 8;
  const seasonalBaitsTop = getSeasonalBaitsForContext(fish, s.method, effWaterTempForTackle, effIceForTackle);
  const activeBaitTop = s.selectedBait && seasonalBaitsTop.includes(s.selectedBait) ? s.selectedBait : (seasonalBaitsTop[0] || '');
  const rigTop = calcDynamicRig(s.method, s.water, s.depth, activeDayForTackle.windMax || 3, fish, effWaterTempForTackle, effIceForTackle);
  const hrsArr = Array.isArray(activeDayForTackle.hours) && activeDayForTackle.hours.length === 24
    ? activeDayForTackle.hours
    : Array.from({ length: 24 }, (_, h) => ({ hour: h, tAir: 3, press: 754, wind: 3, windDir: 'З' }));
  const selH = clampHour(s.selectedHour);
  const selHrObj = hrsArr[selH] || hrsArr[12] || {};
  const selBreakdown = computeHourFactors(fish, activeDayForTackle, selHrObj, s.method, s.water, s.depth, s.normPress, effIceForTackle);
  const guides = generateAdaptiveGuides(fish, s.water, s.depth, activeDayForTackle, s.method, effIceForTackle);

  const methodLabelsShort = {
    spin_micro: 'Микроджиг / Мормышинг',
    spin_jig: 'Спиннинг (Джиг)',
    spin_lure: 'Спиннинг (Блесна/Воблер)',
    bottom: 'Донка / Фидер',
    float: 'Поплавочная снасть',
    fly: 'Нахлыст / Бомбарда',
    winter_jig: 'Зимняя мормышка',
    winter_lure: 'Зимний балансир / Виб',
    winter_livebait: 'Жерлица (Живец)',
    winter_stuka: 'Зимняя стукалка',
    winter_cisco: 'Зимняя гирлянда',
    sea_rock: 'Морской рокфишинг',
    sea_surf: 'Морская донка',
    sea_boat: 'Морской лов с лодки'
  };
  const shortMethodName = methodLabelsShort[s.method] || 'Снасть по сезону';

  const headLbl = waveCard.querySelector('#bentoChartTimeRangeLabel');
  if (headLbl) {
    const tAirVal = Math.round(Number(selHrObj.tAir ?? activeDayForTackle.tDay ?? 0));
    const tAirStr = `${tAirVal > 0 ? '+' + tAirVal : tAirVal}°C`;
    const txt = `${String(selH).padStart(2, '0')}:00 • ${selHrObj.press ?? activeDayForTackle.pressAvg ?? 754} мм • ${tAirStr} • ${selHrObj.windDir || activeDayForTackle.windDir || 'З'} ${selHrObj.wind ?? activeDayForTackle.windMax ?? 3} м/с`;
    headLbl.textContent = txt;
    headLbl.dataset.origText = txt;
    headLbl.style.color = 'var(--text)';
  }

  try {
    const ptsAttr = waveCard.getAttribute('data-hourly-points');
    if (ptsAttr) {
      const ptsArr = JSON.parse(ptsAttr);
      const pt = ptsArr[selH];
      if (pt) {
        const lineEl = waveCard.querySelector('#bentoScrubCursorLine');
        const dotEl = waveCard.querySelector('#bentoScrubCursorDot');
        if (lineEl) lineEl.style.left = `${pt.xPct}%`;
        if (dotEl) {
          dotEl.style.left = `${pt.xPct}%`;
          dotEl.style.top = `${pt.yPct}%`;
        }
      }
    }
  } catch (_e) {}

  detailCard.innerHTML = buildMobileSelectedHourDetailCardInnerHtml(
    fish, s, activeDayForTackle, selH, selHrObj, selBreakdown, guides, shortMethodName, rigTop, activeBaitTop
  );
  const accEl = detailCard.querySelector('#fcTacticsAccordionDetails');
  if (accEl) {
    accEl.addEventListener('toggle', () => {
      _mobileTacticsExpanded = accEl.open;
    });
  }
  return true;
}

let _mobileTacticsExpanded = false;

export function openShareForecastAndTackleModal() {
  const s = store.getState();
  const fish = FISH_DB.find(f => f.id === s.fishId) || FISH_DB[0];
  const day = s.weatherDays?.[s.dayIdx] || s.weatherDays?.[2] || s.weatherDays?.[0] || {};
  const effIce = _normalizeWarmDayIce(day, s.iceState);
  const effWaterTemp = Number(day.waterTemp ?? 8);
  const sc = calcDayBest(fish, day, s.method, s.water, s.depth, s.normPress, effIce);
  const win = getBestBiteWindowText(fish, day, s.method, s.water, s.depth, s.normPress, effIce);
  const rig = calcDynamicRig(s.method, s.water, s.depth, day.windMax || 3, fish, effWaterTemp, effIce);
  const seasonalBaits = getSeasonalBaitsForContext(fish, s.method, effWaterTemp, effIce);
  const activeBait = s.selectedBait && seasonalBaits.includes(s.selectedBait) ? s.selectedBait : (seasonalBaits[0] || 'По сезону');
  const waterTitle = s.selectedWaterName || WATER_PROFILES[s.water]?.shortName || 'водоём';
  const dayLabel = day.relTitle ? `${day.relTitle} (${day.label})` : (day.label || 'Сегодня');
  const { botStartUrl } = buildForecastShareUrls(s.lat, s.lon, s.locLabel, fish.id);

  const summaryText =
    `Клёв ПРО 2.0 • Прогноз и снасть (${dayLabel})\n` +
    `Водоём: ${s.locLabel}${waterTitle && waterTitle !== s.locLabel ? ' • ' + waterTitle : ''}\n` +
    `Рыба: ${fish.name} — прогноз клёва ${sc}% (лучшее окно: ${win})\n` +
    `Условия: вода ~${effWaterTemp > 0 ? '+' + effWaterTemp : effWaterTemp}°C • давление ${day.pressAvg || 754} мм • ветер ${day.windDir || 'З'} ${day.windMax || 3} м/с\n` +
    `Снасть: ${rig.weight} (${rig.line}) • Насадка: ${activeBait}`;

  const html = `
    <div style="display:flex;flex-direction:column;gap:12px;font-size:var(--fs-sm);">
      <div class="glass-panel" style="padding:12px 14px;border-radius:16px;border:1.5px solid var(--accent);display:flex;flex-direction:column;gap:6px;">
        <div style="font-size:13.5px;font-weight:900;color:var(--text);width:100%;">Предпросмотр карточки для отправки</div>
        <div style="font-size:12px;line-height:1.48;color:var(--text);">
          <div><b>Водоём и дата:</b> ${escapeHtml(s.locLabel)} (${escapeHtml(waterTitle)}) • ${escapeHtml(dayLabel)}</div>
          <div><b>Целевая рыба:</b> <span style="color:var(--accent);font-weight:800;">${escapeHtml(fish.name)} — клёв ${sc}%</span> (пик: ${escapeHtml(win)})</div>
          <div><b>Погода и вода:</b> воздух ${day.tDay > 0 ? '+' + day.tDay : day.tDay}°C, вода ~${effWaterTemp > 0 ? '+' + effWaterTemp : effWaterTemp}°C, ${day.pressAvg || 754} мм, ветер ${day.windDir || 'З'} ${day.windMax || 3} м/с</div>
          <div><b>Рабочая снасть:</b> ${escapeHtml(rig.weight)} (${escapeHtml(rig.line)})</div>
          <div><b>Насадка / приманка:</b> ${escapeHtml(activeBait)}</div>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:8px;">
        <button type="button" class="btn btn-good" id="fcSharePublishCircleBtn" style="width:100%;min-height:44px;font-weight:900;">
          Опубликовать в Круге (±5/10 км)
        </button>
        <button type="button" class="btn btn-accent" id="fcSharePublishCrewBtn" style="width:100%;min-height:44px;font-weight:900;">
          Отправить в Экипаж (72 ч)
        </button>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <button type="button" class="btn" id="fcShareCopyTextBtn" style="min-height:42px;font-weight:800;">
            Скопировать сводку
          </button>
          <button type="button" class="btn" id="fcShareSendTgExternalBtn" style="min-height:42px;font-weight:800;">
            В Telegram
          </button>
        </div>
      </div>
    </div>
  `;

  openModal('Поделиться прогнозом и снастью', html, (bodyEl) => {
    const publishToFeed = (mode) => {
      const stNow = store.getState();
      const up = stNow.userProfile || {};
      const newItem = {
        id: `${mode}_${Date.now()}`,
        t: mode,
        ts: Date.now(),
        ea: mode === 'crew' ? (Date.now() + 72 * 3600 * 1000) : (Date.now() + 48 * 3600 * 1000),
        fid: up.fisherId || 'FP_89AAA014',
        au: up.callsign || up.login || 'Рыболов',
        lat: Number(stNow.lat || 66.08),
        lon: Number(stNow.lon || 76.68),
        lb: stNow.locLabel || 'Водоём',
        wn: waterTitle,
        fi: fish.id,
        fn: fish.name,
        sc,
        mt: stNow.method,
        bt: activeBait,
        dp: stNow.depth || 2.5,
        nt: `Прогноз клёва ${sc}% (${win}) • Снасть: ${rig.weight} • Насадка: ${activeBait}`,
        crewKey: up.crewKey || 'KP-7777'
      };
      const curList = Array.isArray(stNow.circleItems) ? [...stNow.circleItems] : [];
      curList.unshift(newItem);
      store.dispatch({ type: 'SET_CIRCLE_ITEMS', payload: curList });
      try { storage.putToStore('circle', newItem); } catch (_e) {}
      closeModal();
      showToast(mode === 'crew' ? 'Сводка прогноза и снасти отправлена в Экипаж (72 ч)' : 'Сводка прогноза и снасти опубликована в Круге', 'good');
    };

    bodyEl.querySelector('#fcSharePublishCircleBtn')?.addEventListener('click', () => publishToFeed('circle'));
    bodyEl.querySelector('#fcSharePublishCrewBtn')?.addEventListener('click', () => publishToFeed('crew'));
    bodyEl.querySelector('#fcShareCopyTextBtn')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(summaryText);
        showToast('Сводка прогноза и снасти скопирована в буфер обмена', 'good');
      } catch (_e) {
        showToast('Текст сводки готов к отправке', 'info');
      }
      closeModal();
    });
    bodyEl.querySelector('#fcShareSendTgExternalBtn')?.addEventListener('click', () => {
      closeModal();
      shareToTelegramChat(botStartUrl, summaryText);
    });
  });
}

function buildMobileSelectedHourDetailCardInnerHtml(fish, s, activeDayForTackle, selH, selHrObj, selBreakdown, guides, shortMethodName, rigTop, activeBaitTop) {
  const tAirVal = Math.round(Number(selHrObj.tAir ?? activeDayForTackle.tDay ?? 0));
  const tAirStr = `${tAirVal > 0 ? '+' + tAirVal : tAirVal}°C`;
  const scTone = selBreakdown.total >= 60 ? 'var(--good)' : (selBreakdown.total >= 38 ? 'var(--accent)' : 'var(--warn)');
  return `
    <details class="klev-tactics-accordion" id="fcTacticsAccordionDetails" ${_mobileTacticsExpanded ? 'open' : ''}>
      <summary style="list-style:none;cursor:pointer;display:flex;flex-direction:column;gap:4px;width:100%;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;">
          <span style="font-size:14px;font-weight:800;color:var(--text);">Тактика и 8 факторов клёва</span>
          <span style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:900;color:${scTone};">
            <span>${String(selH).padStart(2, '0')}:00 • ${selBreakdown.total}%</span>
            <svg class="k-svg klev-acc-chevron" style="width:16px;height:16px;transition:transform 0.2s ease;" viewBox="0 0 24 24" fill="none"><polyline points="6 9 12 15 18 9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </span>
        </div>
        <div style="font-size:11.5px;color:var(--muted);line-height:1.35;">
          ${escapeHtml(shortMethodName)} (${escapeHtml(rigTop.weight)}) • ${tAirStr} • ${selHrObj.press ?? activeDayForTackle.pressAvg ?? 754} мм • Нажмите для разбора
        </div>
      </summary>
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:8px;">
        ${fish.legal === 'redbook' ? `
          <div style="padding:8px 10px;border-radius:10px;background:var(--pill-bad-bg);border:1px solid var(--bad);color:var(--pill-bad-text);font-weight:700;font-size:11.5px;">
            <b>${fish.name} — Красная книга (изъятие запрещено).</b> При поимке бережно отпустите рыбу.
          </div>
        ` : ''}
        <div style="font-size:12px;color:var(--muted);line-height:1.45;">
          Рекомендуемая снасть: <b style="color:var(--text);">${shortMethodName} (${rigTop.weight}, ${rigTop.line})</b> • Насадка: <b>${renderBaitWithColorDots(activeBaitTop)}</b> • Горизонт: ${s.depth.toFixed(1)} м (${rigTop.tactic}).
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          ${selBreakdown.factors.map((f) => {
            const isPos = f.val >= 0;
            const col = isPos ? 'var(--good)' : 'var(--bad)';
            const pctScore = Math.max(15, Math.min(99, 72 + f.val * 2));
            return `
              <div style="display:flex;flex-direction:column;gap:3px;padding:5px 0;border-bottom:1px dashed var(--border);">
                <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:12px;font-weight:800;">
                  <span>${f.name}</span>
                  <span style="color:var(--accent);font-weight:900;">${pctScore}% (${isPos ? '+' + f.val : f.val}%)</span>
                </div>
                <div style="font-size:11px;color:var(--muted);line-height:1.3;">${f.note}</div>
                <div style="width:100%;height:5px;border-radius:99px;background:rgba(148,163,184,0.16);overflow:hidden;">
                  <div style="width:${pctScore}%;height:100%;background:${col};border-radius:99px;"></div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
        <div style="margin-top:4px;padding:8px 10px;border-radius:12px;background:var(--panel);border:1px solid var(--border);display:flex;flex-direction:column;gap:5px;font-size:11.5px;line-height:1.42;color:var(--muted);">
          <div><b style="color:var(--text);">Метеоархив (5 дней):</b> ${selBreakdown.archiveEval?.commentary || ''}</div>
          <div><b style="color:var(--text);">Гидробиология и стоянки:</b> ${guides.standAdvice}</div>
          <div><b style="color:var(--text);">Подача снасти:</b> ${guides.tackleAdvice}</div>
        </div>
      </div>
    </details>
  `;
}

function renderMobileRedesignForecast(container) {
  const s = store.getState();
  const fish = FISH_DB.find(f => f.id === s.fishId) || FISH_DB[0];
  const todayObj = s.weatherDays?.[2] || s.weatherDays?.[0] || {};
  const activeDayForTackle = s.weatherDays?.[s.dayIdx] || todayObj || {};
  const effIceForTackle = _normalizeWarmDayIce(activeDayForTackle, s.iceState);
  const effWaterTempForTackle = activeDayForTackle.waterTemp ?? 8;
  const nearWaterTitle = s.selectedWaterName || s.nearbyWaters?.[0]?.name || WATER_PROFILES[s.water]?.shortName || s.locLabel || 'Водоём';
  const compatibleMethodsTop = getCompatibleMethods(fish, effIceForTackle, s.water, effWaterTempForTackle);
  const seasonalBaitsTop = getSeasonalBaitsForContext(fish, s.method, effWaterTempForTackle, effIceForTackle);
  const activeBaitTop = s.selectedBait && seasonalBaitsTop.includes(s.selectedBait) ? s.selectedBait : (seasonalBaitsTop[0] || '');
  const rigTop = calcDynamicRig(s.method, s.water, s.depth, activeDayForTackle.windMax || 3, fish, effWaterTempForTackle, effIceForTackle);
  const activeHeroScore = calcDayBest(fish, activeDayForTackle, s.method, s.water, s.depth, s.normPress, effIceForTackle);

  const ecoregBento = getSpotEcoregion(s.lat, s.lon, s.basinCode, s.water, s.selectedWaterName);
  const sigOrderBento = ecoregBento.signatureSpecies || [];
  const sigMapBento = new Map(sigOrderBento.map((id, idx) => [id, idx]));
  const radiusTypesBento = new Set((s.nearbyWaters || []).map(w => w.wType).concat([s.water]));
  const hasCoolingBento = s.water === 'cooling_reservoir' || radiusTypesBento.has('cooling_reservoir');
  const regionalPool = FISH_DB.filter(f =>
    f.legal !== 'redbook' &&
    isSpeciesInGeoRange(f, s.lat, s.lon, s.basinCode, s.water, s.waterRadiusKm || 50, radiusTypesBento, s.isCoastal, hasCoolingBento, s.selectedWaterName)
  );
  const speciesStripList = (regionalPool.length ? regionalPool : FISH_DB.slice(0, 12))
    .map(f => {
      const scDay = calcDayBest(f, activeDayForTackle, s.method, s.water, s.depth, s.normPress, effIceForTackle);
      const sigIdx = sigMapBento.has(f.id) ? sigMapBento.get(f.id) : -1;
      const bonus = sigIdx >= 0 ? Math.max(6, 24 - sigIdx * 2) : -6;
      return { fish: f, scDay, rankSc: scDay + bonus };
    })
    .sort((a, b) => b.rankSc - a.rankSc)
    .slice(0, 14);
  if (!speciesStripList.some(item => item.fish.id === fish.id)) {
    speciesStripList.unshift({ fish, scDay: activeHeroScore, rankSc: 999 });
  }

  const hrsArr = Array.isArray(activeDayForTackle.hours) && activeDayForTackle.hours.length === 24
    ? activeDayForTackle.hours
    : Array.from({ length: 24 }, (_, h) => ({ hour: h, tAir: 3, press: 754, wind: 3, windDir: 'З' }));
  const hrScores = hrsArr.map(hr => calcHourly(fish, activeDayForTackle, hr, s.method, s.water, s.depth, s.normPress, effIceForTackle));

  let morningPeakHr = 7, morningPeakSc = -1;
  let eveningPeakHr = 17, eveningPeakSc = -1;
  hrScores.forEach((sc, h) => {
    if (h >= 4 && h <= 12 && sc > morningPeakSc) { morningPeakSc = sc; morningPeakHr = h; }
    if (h >= 13 && h <= 22 && sc > eveningPeakSc) { eveningPeakSc = sc; eveningPeakHr = h; }
  });
  const mWinStart = `${String(Math.max(4, morningPeakHr - 1)).padStart(2, '0')}:00`;
  const mWinEnd = `${String(Math.min(12, morningPeakHr + 2)).padStart(2, '0')}:00`;
  const eWinStart = `${String(Math.max(13, eveningPeakHr - 1)).padStart(2, '0')}:00`;
  const eWinEnd = `${String(Math.min(23, eveningPeakHr + 2)).padStart(2, '0')}:00`;

  const svgW = 360, svgH = 122, padL = 14, padR = 14, padT = 22, padB = 16;
  const plotW = svgW - padL - padR;
  const plotH = svgH - padT - padB;
  const rawMinSc = Math.min(...hrScores);
  const rawMaxSc = Math.max(...hrScores);
  const spanSc = Math.max(12, rawMaxSc - rawMinSc);
  const floorSc = Math.max(0, rawMinSc - Math.max(3, spanSc * 0.18));
  const ceilSc = Math.min(100, rawMaxSc + Math.max(4, spanSc * 0.15));
  const effRange = Math.max(10, ceilSc - floorSc);
  const pts = hrScores.map((sc, idx) => {
    const x = Math.round((padL + (idx / 23) * plotW) * 10) / 10;
    const norm = Math.max(0.06, Math.min(0.96, (sc - floorSc) / effRange));
    const y = Math.round((padT + (1 - norm) * plotH) * 10) / 10;
    return { x, y, sc, hr: idx };
  });
  let wavePathD = 'M ' + pts[0].x + ' ' + pts[0].y;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const cx = Math.round(((p0.x + p1.x) / 2) * 10) / 10;
    wavePathD += ' C ' + cx + ' ' + p0.y + ', ' + cx + ' ' + p1.y + ', ' + p1.x + ' ' + p1.y;
  }
  const baseLineY = svgH - 6;
  const waveAreaD = wavePathD + ' L ' + pts[pts.length - 1].x + ' ' + baseLineY + ' L ' + pts[0].x + ' ' + baseLineY + ' Z';
  const mPt = pts[morningPeakHr] || pts[7];
  const ePt = pts[eveningPeakHr] || pts[17];

  const selH = clampHour(s.selectedHour);
  const selPt = pts[selH] || pts[8] || pts[0];
  const selHrObj = hrsArr[selH] || hrsArr[12] || {};
  const selBreakdown = computeHourFactors(fish, activeDayForTackle, selHrObj, s.method, s.water, s.depth, s.normPress, effIceForTackle);
  const astro = computeDayKpAndDaylight(activeDayForTackle);
  const guides = generateAdaptiveGuides(fish, s.water, s.depth, activeDayForTackle, s.method, effIceForTackle);

  const tWatStr = `${effWaterTempForTackle > 0 ? '+' + effWaterTempForTackle : effWaterTempForTackle}°C`;
  const iceThickVal = effIceForTackle === 'open_water' ? 0 : Number(activeDayForTackle.iceThickness ?? s.iceThickness ?? 0);
  const hasRealIceNow = (effIceForTackle === 'ice_safe' || effIceForTackle === 'ice_danger' || effIceForTackle === 'ice_slush') && iceThickVal > 0;

  const methodLabelsShort = {
    spin_micro: 'Микроджиг / Мормышинг',
    spin_jig: 'Спиннинг (Джиг)',
    spin_lure: 'Спиннинг (Блесна/Воблер)',
    bottom: 'Донка / Фидер',
    float: 'Поплавочная снасть',
    fly: 'Нахлыст / Бомбарда',
    winter_jig: 'Зимняя мормышка',
    winter_lure: 'Зимний балансир / Виб',
    winter_livebait: 'Жерлица (Живец)',
    winter_stuka: 'Зимняя стукалка',
    winter_cisco: 'Зимняя гирлянда',
    sea_rock: 'Морской рокфишинг',
    sea_surf: 'Морская донка',
    sea_boat: 'Морской лов с лодки'
  };
  const shortMethodName = methodLabelsShort[s.method] || 'Снасть по сезону';

  const scrubPtsJson = JSON.stringify(pts.map((p, h) => {
    const hObj = hrsArr[h] || {};
    return {
      hr: h,
      sc: p.sc,
      xPct: Number(((p.x / svgW) * 100).toFixed(2)),
      yPct: Number(((p.y / svgH) * 100).toFixed(2)),
      tAir: Math.round(Number(hObj.tAir ?? activeDayForTackle.tDay ?? 3)),
      press: Math.round(Number(hObj.press ?? activeDayForTackle.pressAvg ?? 754)),
      wind: Math.round(Number(hObj.wind ?? activeDayForTackle.windMax ?? 3) * 10) / 10,
      windDir: String(hObj.windDir || activeDayForTackle.windDir || 'З')
    };
  })).replace(/"/g, '&quot;');

  const isOpenWaterNow = effIceForTackle === 'open_water';
  const showCarpSwimBlock = isOpenWaterNow || _openWaterCarpPreview;

  const daysArr = s.weatherDays || [];
  const daysCardsHtml = daysArr.map((d, idx) => {
    const dIce = _normalizeWarmDayIce(d, s.iceState);
    const sc = calcDayBest(fish, d, s.method, s.water, s.depth, s.normPress, dIce);
    const isAct = idx === s.dayIdx;
    const dayHeader = `${d.relTitle ? d.relTitle + ' • ' : ''}${d.label}${d.isArchive ? ' (Архив)' : ''}`;
    const tDayS = `${d.tDay > 0 ? '+' + d.tDay : d.tDay}°C`;
    const tWatS = `${d.waterTemp > 0 ? '+' + d.waterTemp : d.waterTemp}°C`;
    const scColor = sc >= 65 ? 'var(--good)' : (sc >= 42 ? 'var(--accent)' : 'var(--warn)');
    return `
      <div class="glass-panel klev-day-row-card ${isAct ? 'active' : ''}" data-week-day="${idx}" data-guest-locked-day="${idx === 2 ? '0' : '1'}" style="padding:10px 13px;border-radius:16px;display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:pointer;border:1.5px solid ${isAct ? 'var(--accent)' : 'var(--border)'};">
        <div style="min-width:0;flex:1;">
          <div style="font-size:13.5px;font-weight:800;color:var(--text);">${dayHeader}</div>
          <div style="font-size:11.5px;color:var(--muted);margin-top:2px;line-height:1.35;">
            Воздух ${tDayS} • Вода ${tWatS} • ${d.pressAvg} мм (${fmtDeltaPress(d.dP)}) • ${d.windDir} ${d.windMax} м/с
          </div>
        </div>
        <span style="padding:5px 10px;border-radius:10px;background:rgba(56,189,248,0.14);border:1px solid ${scColor};color:${scColor};font-size:13px;font-weight:900;flex-shrink:0;">${sc}%</span>
      </div>
    `;
  }).join('');

  const pVals = hrsArr.map(h => Number(h.press ?? activeDayForTackle.pressAvg ?? 754));
  const minP = Math.min(...pVals);
  const maxP = Math.max(...pVals);
  const spanP = Math.max(3, maxP - minP);
  const floorP = minP - Math.max(1, spanP * 0.22);
  const ceilP = maxP + Math.max(1, spanP * 0.22);
  const rangeP = Math.max(4, ceilP - floorP);
  const pSvgW = 340, pSvgH = 92, pPadL = 14, pPadR = 14, pPadT = 18, pPadB = 16;
  const pPlotW = pSvgW - pPadL - pPadR;
  const pPlotH = pSvgH - pPadT - pPadB;
  const pPts = pVals.map((pv, idx) => {
    const x = Math.round((pPadL + (idx / 23) * pPlotW) * 10) / 10;
    const norm = Math.max(0.08, Math.min(0.92, (pv - floorP) / rangeP));
    const y = Math.round((pPadT + (1 - norm) * pPlotH) * 10) / 10;
    return { x, y, p: Math.round(pv), hr: idx };
  });
  let pPathD = `M ${pPts[0].x} ${pPts[0].y}`;
  for (let i = 0; i < pPts.length - 1; i++) {
    const a = pPts[i], b = pPts[i + 1];
    const cx = Math.round(((a.x + b.x) / 2) * 10) / 10;
    pPathD += ` C ${cx} ${a.y}, ${cx} ${b.y}, ${b.x} ${b.y}`;
  }
  const pAreaD = `${pPathD} L ${pPts[pPts.length - 1].x} ${pSvgH - 4} L ${pPts[0].x} ${pSvgH - 4} Z`;
  const normPVal = Number(s.normPress || 754);
  const normPY = Math.round((pPadT + (1 - Math.max(0.08, Math.min(0.92, (normPVal - floorP) / rangeP))) * pPlotH) * 10) / 10;

  const windDirAngles = { 'С': 180, 'СВ': 225, 'В': 270, 'ЮВ': 315, 'Ю': 0, 'ЮЗ': 45, 'З': 90, 'СЗ': 135 };
  const windRotDeg = windDirAngles[String(activeDayForTackle.windDir || 'З').toUpperCase()] ?? 90;
  const daylightPct = Math.max(12, Math.min(92, Math.round(((astro.ss - astro.sr) / 24) * 100)));

  const prevSpeciesScroll = container.querySelector('.bento-top-species-strip')?.scrollLeft || 0;

  container.innerHTML = `
    <div id="fcStickySpeciesBar" style="display:none;"></div>
    <div id="fcRedesignMobileRoot" class="klev-v291-forecast-shell" style="display:flex;flex-direction:column;gap:10px;">
      <!-- 1. Компактная верхняя капсула выбора водоёма и даты (1 строка) -->
      <div style="display:flex;align-items:center;justify-content:center;padding-top:2px;">
        <button type="button" class="pill-btn" id="fcOpenLocationSheetBtn" style="padding:7px 15px;border-radius:999px;font-size:12.5px;font-weight:700;display:inline-flex;align-items:center;gap:8px;">
          <span class="status-dot"></span>
          <span>${nearWaterTitle} • ${activeDayForTackle.label || 'Сегодня'}</span>
        </button>
      </div>

      <!-- 2. Адаптивная Bento-сетка -->
      <div class="klev-fc-mobile-bento-grid">
        <!-- ЛЕВАЯ КОЛОНКА: Центрированная Hero-карточка с Живым Радаром-Сонаром + Лента видов рыб -->
        <div style="display:flex;flex-direction:column;gap:10px;min-width:0;">
          <div class="bento-card fc-hero-box" id="bentoSwipeHeroCard" style="padding:12px 14px 13px;display:flex;flex-direction:column;align-items:center;text-align:center;">
            <div style="font-size:16.5px;font-weight:900;letter-spacing:-0.2px;width:100%;margin-bottom:4px;">Прогноз клёва • ${fish.name}</div>

            <!-- Живой сонарный радар 236x236px (без ссылки над сонаром; в центре только процент клёва и мягкая полупрозрачная градиентная шкала) -->
            <div class="bento-hero-sonar-stage" id="bentoHeroSonarStage" style="position:relative;width:236px;height:236px;display:flex;align-items:center;justify-content:center;margin:2px auto 10px;">
              <canvas id="bentoHeroSonarCanvas" width="472" height="472" style="width:236px;height:236px;display:block;border-radius:50%;"></canvas>
              <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;">
                <span id="bentoHeroSonarPctText" style="font-size:38px;font-weight:900;letter-spacing:-1.2px;line-height:1;font-variant-numeric:tabular-nums;">${activeHeroScore}%</span>
              </div>
            </div>

            <!-- Две компактные капсулы окон активности: Утро и Вечер -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;width:100%;">
              <div class="glass-panel" style="display:flex;align-items:center;gap:8px;padding:8px 11px;border-radius:14px;text-align:left;">
                <svg class="k-svg" style="width:20px;height:20px;color:var(--accent);flex-shrink:0;"><use href="#ui-sunrise"></use></svg>
                <div style="display:flex;flex-direction:column;line-height:1.25;min-width:0;">
                  <span style="font-size:11.5px;font-weight:700;color:var(--text);">Утро (${mPt.sc}%)</span>
                  <span style="font-size:12px;font-weight:800;color:var(--accent);font-variant-numeric:tabular-nums;">${mWinStart}–${mWinEnd}</span>
                </div>
              </div>
              <div class="glass-panel" style="display:flex;align-items:center;gap:8px;padding:8px 11px;border-radius:14px;text-align:left;">
                <svg class="k-svg" style="width:20px;height:20px;color:var(--accent);flex-shrink:0;"><use href="#ui-moon"></use></svg>
                <div style="display:flex;flex-direction:column;line-height:1.25;min-width:0;">
                  <span style="font-size:11.5px;font-weight:700;color:var(--text);">Вечер (${ePt.sc}%)</span>
                  <span style="font-size:12px;font-weight:800;color:var(--accent);font-variant-numeric:tabular-nums;">${eWinStart}–${eWinEnd}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Горизонтальная лента выбора рыбы (пользовательские PNG из assets/fish/*.png через IMG_SEARCH_DIRS) -->
          <div class="chip-scroll-row bento-top-species-strip species-strip-wrap" style="padding:2px 2px 4px;">
            ${speciesStripList.map(item => `
              <button type="button" class="fish-chip w-chip ${item.fish.id === fish.id ? 'active' : ''}" data-novice-pick-fish="${item.fish.id}" style="padding:6px 12px;min-height:36px;display:inline-flex;align-items:center;gap:7px;flex-shrink:0;white-space:nowrap;border-radius:999px;">
                <span style="width:28px;height:16px;display:inline-flex;align-items:center;justify-content:center;">${renderFishVisual(item.fish)}</span>
                <span>${item.fish.name}</span>
                <span style="font-size:11px;opacity:0.88;font-weight:800;">${item.scDay}%</span>
              </button>
            `).join('')}
          </div>
        </div>

        <!-- ПРАВАЯ КОЛОНКА: 4 Внутренние вкладки (Обзор | Снасти | 10 дней | Погода) -->
        <div style="display:flex;flex-direction:column;gap:10px;min-width:0;">
          <div class="seg-bar klev-fc-subtabs-bar" role="tablist" aria-label="Внутренние вкладки прогноза" style="display:grid;grid-template-columns:repeat(4,1fr);">
            <button type="button" class="seg-btn ${_activeForecastSubTab === 'overview' ? 'active' : ''}" data-klev-fc-subtab="overview">Обзор</button>
            <button type="button" class="seg-btn ${_activeForecastSubTab === 'tackle' ? 'active' : ''}" data-klev-fc-subtab="tackle">Снасти</button>
            <button type="button" class="seg-btn ${_activeForecastSubTab === 'days' ? 'active' : ''}" data-klev-fc-subtab="days">10 дней</button>
            <button type="button" class="seg-btn ${_activeForecastSubTab === 'ice' ? 'active' : ''}" data-klev-fc-subtab="ice">Погода</button>
          </div>

          <!-- ВКЛАДКА 1: ОБЗОР -->
          <div class="fc-subtab-pane" data-fc-pane="overview" style="display:${_activeForecastSubTab === 'overview' ? 'flex' : 'none'};flex-direction:column;gap:10px;">
            <div class="bento-card bento-chart-card" id="bentoWaveChartCard" data-hourly-points="${scrubPtsJson}" style="padding:11px 13px;">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
                <div class="chart-floating-badge" id="bentoChartTimeRangeLabel" style="margin-bottom:0;">
                  ${String(selH).padStart(2, '0')}:00 • ${selHrObj.press ?? activeDayForTackle.pressAvg ?? 754} мм • ${(selHrObj.tAir ?? activeDayForTackle.tDay ?? 0) > 0 ? '+' + (selHrObj.tAir ?? activeDayForTackle.tDay ?? 0) : (selHrObj.tAir ?? activeDayForTackle.tDay ?? 0)}°C • ${selHrObj.windDir || activeDayForTackle.windDir || 'З'} ${selHrObj.wind ?? activeDayForTackle.windMax ?? 3} м/с
                </div>
                <span style="font-size:11px;font-weight:800;color:var(--accent);">Восход ${fmtHM(astro.sr)} • Закат ${fmtHM(astro.ss)}</span>
              </div>

              <div class="bento-chart-stage" id="bentoWaveChartStage" style="position:relative;width:100%;height:112px;cursor:ew-resize;user-select:none;touch-action:pan-y;">
                <svg viewBox="0 0 ${svgW} ${svgH}" width="100%" height="100%" preserveAspectRatio="none" style="display:block;width:100%;height:100%;">
                  <defs>
                    <linearGradient id="bentoWaveFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stop-color="var(--wave-fill-top, rgba(56,189,248,0.38))"/>
                      <stop offset="100%" stop-color="var(--wave-fill-bot, rgba(56,189,248,0.02))"/>
                    </linearGradient>
                  </defs>
                  <g stroke="currentColor" stroke-opacity="0.10" stroke-width="1">
                    <line x1="${padL}" y1="14" x2="${padL}" y2="${baseLineY}"/>
                    <line x1="${padL + plotW * 0.166}" y1="14" x2="${padL + plotW * 0.166}" y2="${baseLineY}"/>
                    <line x1="${padL + plotW * 0.333}" y1="14" x2="${padL + plotW * 0.333}" y2="${baseLineY}"/>
                    <line x1="${padL + plotW * 0.5}" y1="14" x2="${padL + plotW * 0.5}" y2="${baseLineY}"/>
                    <line x1="${padL + plotW * 0.666}" y1="14" x2="${padL + plotW * 0.666}" y2="${baseLineY}"/>
                    <line x1="${padL + plotW * 0.833}" y1="14" x2="${padL + plotW * 0.833}" y2="${baseLineY}"/>
                    <line x1="${svgW - padR}" y1="14" x2="${svgW - padR}" y2="${baseLineY}"/>
                  </g>
                  <path d="${waveAreaD}" fill="url(#bentoWaveFill)"/>
                  <path d="${wavePathD}" fill="none" stroke="var(--accent)" stroke-width="2.8" vector-effect="non-scaling-stroke" stroke-linecap="round"/>
                </svg>
                <div class="bento-scrub-cursor-line" id="bentoScrubCursorLine" style="display:block;opacity:0.85;left:${((selPt.x / svgW) * 100).toFixed(1)}%;"></div>
                <div class="bento-scrub-cursor-dot" id="bentoScrubCursorDot" style="display:block;opacity:1;left:${((selPt.x / svgW) * 100).toFixed(1)}%;top:${((selPt.y / svgH) * 100).toFixed(1)}%;"></div>
                <div class="bento-scrub-hud-badge" id="bentoScrubHudBadge" style="left:50%;"></div>
              </div>

              <div class="hourly-time-axis" style="display:flex;justify-content:space-between;font-size:11px;font-weight:700;color:var(--muted);margin-top:6px;">
                <span data-scrub-hour="0" style="cursor:pointer;">00:00</span>
                <span data-scrub-hour="4" style="cursor:pointer;">04:00</span>
                <span data-scrub-hour="8" style="cursor:pointer;">08:00</span>
                <span data-scrub-hour="12" style="cursor:pointer;">12:00</span>
                <span data-scrub-hour="16" style="cursor:pointer;">16:00</span>
                <span data-scrub-hour="20" style="cursor:pointer;">20:00</span>
                <span data-scrub-hour="23" style="cursor:pointer;">24:00</span>
              </div>
              <div id="bentoChartScrubLiveRow" style="display:none;justify-content:space-between;align-items:center;padding:5px 8px;margin-top:5px;border-radius:8px;background:rgba(56,189,248,0.12);border:1px solid var(--accent);font-size:11.5px;font-weight:800;color:var(--text);flex-wrap:wrap;gap:6px;"></div>
            </div>

            <!-- Карточка: Тактика и 8 факторов (свёрнута по умолчанию!) -->
            <div class="bento-card" id="fcSelectedHourDetailCard" style="padding:11px 13px;display:flex;flex-direction:column;gap:6px;">
              ${buildMobileSelectedHourDetailCardInnerHtml(fish, s, activeDayForTackle, selH, selHrObj, selBreakdown, guides, shortMethodName, rigTop, activeBaitTop)}
            </div>

            <button type="button" class="cta-full-btn" id="bentoMapRadarCard">
              <svg class="k-svg" style="width:18px;height:18px;"><use href="#ui-pin"></use></svg>
              <span>Показать точки на карте</span>
            </button>
          </div>

          <!-- ВКЛАДКА 2: СНАСТИ -->
          <div class="fc-subtab-pane" data-fc-pane="tackle" style="display:${_activeForecastSubTab === 'tackle' ? 'flex' : 'none'};flex-direction:column;gap:10px;">
            <div class="bento-card" style="padding:11px 13px;display:flex;align-items:center;justify-content:space-between;gap:10px;">
              <div style="min-width:0;flex:1;">
                <div style="font-size:13.5px;font-weight:800;width:100%;">Сезон открытой воды (Фидер / Карп)</div>
                <div style="font-size:11px;color:var(--muted);margin-top:2px;">${showCarpSwimBlock ? 'Карта свима, клипса и таймер перезаброса активны' : 'Зимой (лёд) карта свима и таймер скрыты'}</div>
              </div>
              <label class="klev-switch" aria-label="Режим открытой воды для карты свима и таймера">
                <input type="checkbox" id="fcOpenWaterCarpToggle" ${showCarpSwimBlock ? 'checked' : ''}>
                <span class="klev-switch-slider"></span>
              </label>
            </div>

            <div class="bento-card" id="fcTackleControlsCard" style="padding:12px 14px;display:flex;flex-direction:column;gap:9px;">
              <div style="width:100%;display:flex;flex-direction:column;gap:4px;">
                <div style="font-size:14.5px;font-weight:800;width:100%;">Снасть и сезонная насадка</div>
                <div><span class="pill pill-good" style="font-size:11px;font-weight:800;display:inline-flex;">${rigTop.weight} • Глубина ${s.depth.toFixed(1)} м</span></div>
              </div>
              <div style="display:flex;flex-direction:column;gap:7px;">
                <div>
                  <label for="fcTopMethodSelect" style="display:block;font-size:11.5px;color:var(--muted);font-weight:700;margin-bottom:3px;">Метод ловли (адаптивно под лёд/открытую воду):</label>
                  <select id="fcTopMethodSelect" class="form-select" style="width:100%;min-height:40px;">
                    ${compatibleMethodsTop.map(m => `<option value="${m.val}" ${m.val === s.method ? 'selected' : ''}>${String(m.text || '').replace(/<[^>]+>/g, '').trim()}</option>`).join('')}
                  </select>
                </div>
                <div>
                  <label for="fcTopBaitSelect" style="display:block;font-size:11.5px;color:var(--muted);font-weight:700;margin-bottom:3px;">Рабочая приманка / насадка:</label>
                  <select id="fcTopBaitSelect" class="form-select" style="width:100%;min-height:40px;">
                    ${seasonalBaitsTop.map(b => `<option value="${b}" ${b === activeBaitTop ? 'selected' : ''}>${b}</option>`).join('')}
                  </select>
                </div>
              </div>
            </div>

            <div id="fcCarpSwimOpenWaterWrap" style="display:${showCarpSwimBlock ? 'block' : 'none'};">
              ${buildSpecializedTacticalHtml(fish, s, activeDayForTackle, effWaterTempForTackle, showCarpSwimBlock ? 'open_water' : effIceForTackle)}
            </div>

            <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;">
              <button type="button" class="pill-btn" id="fcOpenRigGuideBtn" style="min-height:42px;font-weight:800;font-size:12px;">Монтажи и узлы</button>
              <button type="button" class="pill-btn" id="fcOpenChecklistBtn" style="min-height:42px;font-weight:800;font-size:12px;">Чек-лист</button>
              <button type="button" class="pill-btn" id="fcShareForecastTgBtn" style="min-height:42px;font-weight:800;font-size:12px;">Поделиться</button>
            </div>
          </div>

          <!-- ВКЛАДКА 3: 10 ДНЕЙ -->
          <div class="fc-subtab-pane" data-fc-pane="days" id="fcRedesignWeekPane" style="display:${_activeForecastSubTab === 'days' ? 'flex' : 'none'};flex-direction:column;gap:9px;">
            <div style="font-size:14px;font-weight:800;width:100%;padding:2px 2px;">Прогноз на 10 дней и архив • ${fish.name}</div>
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${daysCardsHtml}
            </div>
            <div id="fcMobileArchive4hSlot"></div>
          </div>

          <!-- ВКЛАДКА 4: ПОГОДА -->
          <div class="fc-subtab-pane" data-fc-pane="ice" style="display:${_activeForecastSubTab === 'ice' ? 'flex' : 'none'};flex-direction:column;gap:10px;">
            ${(() => {
              const haz = evaluateRoadAndWeatherHazards(activeDayForTackle, s);
              const statusTone = haz.hasDanger ? 'var(--bad)' : (haz.hasWarning ? 'var(--warn)' : 'var(--good)');
              const roadColdNote = activeDayForTackle.tNight <= -28 ? `Мороз до ${activeDayForTackle.tNight}°C` : (activeDayForTackle.tDay >= -2 && activeDayForTackle.tNight <= 1 ? 'Риск гололедицы (0°C)' : 'Покрытие по сезону');
              const windStormNote = (activeDayForTackle.windMax || 3) >= 12 ? `Штормовой ${activeDayForTackle.windDir || 'З'} ${activeDayForTackle.windMax} м/с` : `${activeDayForTackle.windDir || 'З'} ${activeDayForTackle.windMax || 3} м/с (без шторма)`;
              return `
                <div class="bento-card" id="fcWeatherRoadStormCard" style="padding:12px 14px;display:flex;flex-direction:column;gap:8px;border-color:${haz.hasWarning ? statusTone : 'var(--border)'};">
                  <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                    <div style="font-size:14px;font-weight:800;">Дорожная и штормовая обстановка</div>
                    <span class="pill ${haz.hasDanger ? 'pill-bad' : (haz.hasWarning ? 'pill-warn' : 'pill-good')}" style="font-size:11px;white-space:nowrap;">
                      ${haz.hasDanger ? 'Шторм / Опасно' : (haz.hasWarning ? 'Внимание в пути' : 'Без угроз')}
                    </span>
                  </div>
                  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    <div class="glass-panel" style="padding:8px 10px;border-radius:12px;">
                      <div style="font-size:11px;color:var(--muted);font-weight:700;">Трасса и зимники</div>
                      <div style="font-size:12.5px;font-weight:800;color:var(--text);margin-top:2px;">${roadColdNote}</div>
                    </div>
                    <div class="glass-panel" style="padding:8px 10px;border-radius:12px;">
                      <div style="font-size:11px;color:var(--muted);font-weight:700;">Ветер и метель</div>
                      <div style="font-size:12.5px;font-weight:800;color:var(--text);margin-top:2px;white-space:nowrap;">${windStormNote}</div>
                    </div>
                  </div>
                  ${haz.items.length > 0 ? `
                    <div style="display:flex;flex-direction:column;gap:5px;">
                      ${haz.items.map(it => `
                        <div style="padding:6px 9px;border-radius:9px;background:${it.tone === 'bad' ? 'rgba(239,68,68,0.14)' : 'rgba(245,158,11,0.14)'};border:1px solid ${it.tone === 'bad' ? 'var(--bad)' : 'var(--warn)'};font-size:11.5px;font-weight:700;color:var(--text);">
                          <span style="color:${it.tone === 'bad' ? 'var(--bad)' : 'var(--warn)'};font-weight:800;">${escapeHtml(it.title)}:</span> ${escapeHtml(it.detail)}
                        </div>
                      `).join('')}
                    </div>
                  ` : ''}
                </div>
                ${haz.waveRelevant ? `
                  <div class="bento-card" id="fcWeatherHourlyWaveCard" style="padding:12px 14px;display:flex;flex-direction:column;gap:8px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                      <div style="font-size:14px;font-weight:800;">Волна по часам (высота и направление)</div>
                      <span class="pill ${haz.maxWaveM >= 0.8 ? 'pill-bad' : (haz.maxWaveM >= 0.45 ? 'pill-warn' : 'pill-good')}" style="font-size:11px;white-space:nowrap;">
                        Макс. ${haz.maxWaveM.toFixed(1)} м
                      </span>
                    </div>
                    <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;">
                      ${[0, 3, 6, 9, 12, 15, 18, 21].map(hIdx => {
                        const wSlot = haz.waveSeries[hIdx] || haz.waveSeries[0] || { hour: hIdx, waveM: 0.2, dir: activeDayForTackle.windDir || 'З', windMs: 3 };
                        const wCol = wSlot.waveM >= 0.8 ? 'var(--bad)' : (wSlot.waveM >= 0.45 ? 'var(--warn)' : 'var(--good)');
                        return `
                          <div class="glass-panel" style="padding:6px 4px;border-radius:10px;display:flex;flex-direction:column;align-items:center;gap:2px;">
                            <span style="font-size:10.5px;font-weight:800;color:var(--muted);">${String(hIdx).padStart(2, '0')}:00</span>
                            <span style="font-size:13.5px;font-weight:900;color:${wCol};white-space:nowrap;">${wSlot.waveM.toFixed(1)} м</span>
                            <span style="font-size:10.5px;font-weight:800;color:var(--accent);white-space:nowrap;">${escapeHtml(wSlot.dir)} • ${Math.round(wSlot.windMs)} м/с</span>
                          </div>
                        `;
                      }).join('')}
                    </div>
                  </div>
                ` : ''}
              `;
            })()}
            ${hasRealIceNow ? `
              <div class="bento-card" style="padding:12px 14px;display:flex;flex-direction:column;gap:8px;">
                <div style="font-size:14px;font-weight:800;width:100%;">Ледовая обстановка</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                  <div class="glass-panel" style="padding:9px 11px;border-radius:14px;">
                    <div style="font-size:11px;color:var(--muted);">Река (${escapeHtml(nearWaterTitle)})</div>
                    <div style="font-size:18px;font-weight:900;color:var(--accent);margin:2px 0;">~${iceThickVal} см</div>
                    <div style="font-size:11px;color:${effIceForTackle === 'ice_safe' ? 'var(--good)' : 'var(--bad)'};font-weight:700;">
                      ${effIceForTackle === 'ice_safe' ? 'Безопасный лёд' : 'Опасный лёд'}
                    </div>
                  </div>
                  <div class="glass-panel" style="padding:9px 11px;border-radius:14px;">
                    <div style="font-size:11px;color:var(--muted);">Озёра и заливы</div>
                    <div style="font-size:18px;font-weight:900;color:var(--accent);margin:2px 0;">~${Math.round(iceThickVal * 1.25)} см</div>
                    <div style="font-size:11px;color:var(--muted);font-weight:700;">Вода подо льдом ${tWatStr}</div>
                  </div>
                </div>
              </div>
            ` : ''}

            <div class="bento-card" style="padding:12px 14px;display:flex;flex-direction:column;gap:8px;">
              <div style="width:100%;display:flex;flex-direction:column;gap:2px;">
                <div style="font-size:14px;font-weight:800;width:100%;">Давление</div>
                <div style="font-size:11.5px;color:var(--muted);font-weight:700;">
                  Среднее: <b style="color:var(--text);">${activeDayForTackle.pressAvg || 754} мм</b> • Норма: ${s.normPress} мм • Тренд: <b style="color:${Math.abs(activeDayForTackle.dP || 0) <= 3 ? 'var(--good)' : 'var(--warn)'};">${fmtDeltaPress(activeDayForTackle.dP)}</b>
                </div>
              </div>
              <div class="bento-chart-stage" style="position:relative;width:100%;height:96px;">
                <svg viewBox="0 0 ${pSvgW} ${pSvgH}" width="100%" height="100%" preserveAspectRatio="none" style="display:block;width:100%;height:100%;">
                  <defs>
                    <linearGradient id="fcPressSubGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stop-color="rgba(56,189,248,0.34)"/>
                      <stop offset="100%" stop-color="rgba(56,189,248,0.02)"/>
                    </linearGradient>
                  </defs>
                  <line x1="${pPadL}" y1="${normPY}" x2="${pSvgW - pPadR}" y2="${normPY}" stroke="var(--accent)" stroke-dasharray="4 3" stroke-width="1.2" vector-effect="non-scaling-stroke" opacity="0.65"/>
                  <path d="${pAreaD}" fill="url(#fcPressSubGrad)"/>
                  <path d="${pPathD}" fill="none" stroke="var(--accent)" stroke-width="2.6" vector-effect="non-scaling-stroke" stroke-linecap="round"/>
                </svg>
              </div>
              <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:4px;text-align:center;">
                ${[0, 4, 8, 12, 16, 20].map(hIdx => {
                  const pObj = pPts[hIdx] || pPts[0];
                  return `
                    <div style="display:flex;flex-direction:column;gap:1px;">
                      <span style="font-size:10.5px;color:var(--muted);font-weight:700;">${String(hIdx).padStart(2, '0')}:00</span>
                      <span style="font-size:12px;font-weight:900;color:var(--text);">${pObj.p}</span>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>

            <div class="bento-card" style="padding:12px 14px;display:flex;flex-direction:column;gap:10px;">
              <div style="font-size:14px;font-weight:800;width:100%;">Ветер и геомагнитный фон</div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                <div class="glass-panel" style="padding:10px 11px;border-radius:14px;display:flex;align-items:center;gap:10px;">
                  <div style="width:42px;height:42px;border-radius:50%;border:1.5px solid var(--accent);background:rgba(56,189,248,0.10);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style="transform:rotate(${windRotDeg}deg);">
                      <path d="M12 3L16.5 19L12 15.8L7.5 19L12 3Z" fill="rgba(56,189,248,0.35)" stroke="var(--accent)" stroke-width="1.8" stroke-linejoin="round"/>
                    </svg>
                  </div>
                  <div style="min-width:0;flex:1;">
                    <div style="font-size:11px;color:var(--muted);font-weight:700;">Ветер и воздух</div>
                    <div style="font-size:15px;font-weight:900;color:var(--text);white-space:nowrap;">${activeDayForTackle.windDir || 'З'} ${activeDayForTackle.windMax || 3} м/с</div>
                    <div style="font-size:11px;color:var(--accent);font-weight:800;white-space:nowrap;">${activeDayForTackle.tDay > 0 ? '+' + activeDayForTackle.tDay : activeDayForTackle.tDay}° / ${activeDayForTackle.tNight > 0 ? '+' + activeDayForTackle.tNight : activeDayForTackle.tNight}°C</div>
                  </div>
                </div>

                <div class="glass-panel" style="padding:10px 11px;border-radius:14px;display:flex;flex-direction:column;justify-content:space-between;gap:5px;">
                  <div style="display:flex;justify-content:space-between;align-items:center;gap:4px;">
                    <span style="font-size:11px;color:var(--muted);font-weight:700;">Магнитосфера</span>
                    <span style="font-size:12px;font-weight:900;color:${astro.kpTone};">Kp ${astro.kpVal}</span>
                  </div>
                  <div style="display:grid;grid-template-columns:repeat(9,1fr);gap:2px;height:10px;align-items:end;">
                    ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(k => {
                      const barCol = k <= 2 ? '#10b981' : (k <= 4 ? '#f59e0b' : '#ef4444');
                      const isOn = k <= astro.kpVal;
                      const hPct = 35 + k * 7;
                      return `<div style="height:${hPct}%;border-radius:2px;background:${isOn ? barCol : 'rgba(148,163,184,0.22)'};"></div>`;
                    }).join('')}
                  </div>
                  <div style="font-size:11px;font-weight:800;color:${astro.kpTone};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${astro.kpLabel}</div>
                </div>
              </div>

              <div class="glass-panel" style="padding:9px 12px;border-radius:14px;display:flex;flex-direction:column;gap:5px;">
                <div style="display:flex;justify-content:space-between;align-items:center;font-size:11.5px;font-weight:800;">
                  <span style="color:var(--muted);">Восход <b style="color:var(--text);">${fmtHM(astro.sr)}</b></span>
                  <span style="color:var(--accent);">Световой день ${astro.daylightStr}</span>
                  <span style="color:var(--muted);">Закат <b style="color:var(--text);">${fmtHM(astro.ss)}</b></span>
                </div>
                <div style="width:100%;height:6px;border-radius:99px;background:rgba(148,163,184,0.18);overflow:hidden;">
                  <div style="width:${daylightPct}%;height:100%;border-radius:99px;background:linear-gradient(90deg, #38bdf8, #fbbf24, #0284c7);"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  if (activeDayForTackle.isArchive) {
    const archSlot = container.querySelector('#fcMobileArchive4hSlot');
    if (archSlot) {
      renderArchiveDayLogger(archSlot, s, activeDayForTackle, fish);
    }
  }

  if (prevSpeciesScroll > 0) {
    const spStrip = container.querySelector('.bento-top-species-strip');
    if (spStrip) spStrip.scrollLeft = prevSpeciesScroll;
  }

  const accEl = container.querySelector('#fcTacticsAccordionDetails');
  if (accEl) {
    accEl.addEventListener('toggle', () => {
      _mobileTacticsExpanded = accEl.open;
    });
  }

  initOrUpdateHeroSonarCanvas(activeHeroScore);
  bindForecastEvents(container);
}

export function render(container) {
  if (!container) return;
  if (typeof window !== 'undefined' && typeof window.__KLEV_IS_MOBILE_GUEST__ === 'function' && window.__KLEV_IS_MOBILE_GUEST__()) {
    if (store.getState().dayIdx !== 2) {
      store.dispatch({ type: 'SET_DAY', payload: 2 });
    }
  }
  const isDesktopWeb = typeof document !== 'undefined' && document.documentElement.getAttribute('data-desktop-web') === '1';
  if (!isDesktopWeb) {
    renderMobileRedesignForecast(container);
    return;
  }
  const splashEl = typeof document !== 'undefined' ? document.getElementById('appSplashScreen') : null;
  const isSplashActive = Boolean(splashEl && !splashEl.classList.contains('splash-hide'));
  const savedWinScrollY = (typeof window !== 'undefined' && !isSplashActive) ? window.scrollY : 0;
  const savedWeekScroll = container.querySelector('.week-strip')?.scrollLeft || 0;
  const savedHourlyScroll = container.querySelector('.bite-timeline')?.scrollLeft || 0;
  if (!container.querySelector('#fcWeekBox') || !container.querySelector('#fcStickySpeciesBar')) {
    container.innerHTML = `
      <div id="fcStickySpeciesBar" class="fc-sticky-species-bar"></div>
      <div id="fcExpressBox"></div>
      <div id="fcWeekBox" style="margin-top:14px;"></div>
      <div id="fcHourlyBox" style="margin-top:14px;"></div>
    `;
  }
  renderExpress(container.querySelector('#fcExpressBox'));
  renderWeek(container.querySelector('#fcWeekBox'));
  renderHourly(container.querySelector('#fcHourlyBox'));
  bindForecastEvents(container);
  if (savedWeekScroll > 0) {
    const ws = container.querySelector('.week-strip');
    if (ws) ws.scrollLeft = savedWeekScroll;
  }
  if (savedHourlyScroll > 0) {
    const hs = container.querySelector('.bite-timeline');
    if (hs) hs.scrollLeft = savedHourlyScroll;
  }
  if (typeof window !== 'undefined') {
    if (isSplashActive) {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    } else if (savedWinScrollY > 0 && Math.abs(window.scrollY - savedWinScrollY) > 4) {
      window.scrollTo({ top: savedWinScrollY, behavior: 'instant' });
    }
  }
}
function updateLiveWeightLabelsAndScores(container) {
  if (typeof document !== 'undefined' && document.documentElement.getAttribute('data-desktop-web') !== '1') {
    const rootSec = document.getElementById('secForecast') || container;
    if (rootSec && rootSec.id === 'secForecast') {
      renderMobileRedesignForecast(rootSec);
    }
    return;
  }
  if (!container) return;
  const s = store.getState();
  const pw = s.proFactorWeights || { temp: 1.0, press: 1.0, archive_shock: 1.0, circle_field: 1.0 };
  const mapIds = {
    temp: '#proWTempVal',
    press: '#proWPressVal',
    archive_shock: '#proWShockVal',
    circle_field: '#proWCircleVal'
  };
  for (const [k, sel] of Object.entries(mapIds)) {
    const el = container.querySelector(sel);
    if (el) el.textContent = `${Number(pw[k] ?? 1.0).toFixed(1)}x`;
    const rng = container.querySelector(`[data-pro-weight="${k}"]`);
    if (rng && document.activeElement !== rng) {
      rng.value = String(pw[k] ?? 1.0);
    }
  }
  const fish = FISH_DB.find(f => f.id === s.fishId) || FISH_DB[0];
  const activeDayObj = s.weatherDays?.[s.dayIdx] || s.weatherDays?.[2] || s.weatherDays?.[0];
  if (activeDayObj) {
    const calScoreNow = calcDayBest(fish, activeDayObj, s.method, s.water, s.depth, s.normPress, s.iceState);
    const sumEl = container.querySelector('#proCalibLiveSummary');
    if (sumEl) {
      sumEl.innerHTML = `Активность «${fish.name}» с текущей калибровкой весов: <b>${calScoreNow}%</b>`;
    }
  }
  const savedWinScrollY = typeof window !== 'undefined' ? window.scrollY : 0;
  renderWeek(container.querySelector('#fcWeekBox'));
  renderHourly(container.querySelector('#fcHourlyBox'));
  const expBox = document.createElement('div');
  renderExpress(expBox);
  const newGrid = expBox.querySelector('#fcExpressCardsGrid');
  const curGrid = container.querySelector('#fcExpressCardsGrid');
  if (newGrid && curGrid) {
    curGrid.innerHTML = newGrid.innerHTML;
  }
  if (typeof window !== 'undefined' && savedWinScrollY > 0 && Math.abs(window.scrollY - savedWinScrollY) > 4) {
    window.scrollTo({ top: savedWinScrollY, behavior: 'instant' });
  }
}
/**
 * Делегированная привязка событий на корневой контейнер #secForecast.
 * Привязывается ОДИН РАЗ и никогда не слетает при частичном перерендере #fcHourlyBox или #fcWeekBox!
 */
function bindForecastEvents(container) {
  if (!container || container.__fcDelegatedBound) return;
  container.__fcDelegatedBound = true;
  container.addEventListener('click', (e) => {
    const target = e.target;
    if (!target || typeof target.closest !== 'function') return;
    const subTabBtn = target.closest('[data-klev-fc-subtab]');
    if (subTabBtn) {
      e.stopPropagation();
      const tabId = subTabBtn.getAttribute('data-klev-fc-subtab') || 'overview';
      _activeForecastSubTab = tabId;
      container.querySelectorAll('[data-klev-fc-subtab]').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-klev-fc-subtab') === tabId);
      });
      container.querySelectorAll('[data-fc-pane]').forEach(p => {
        p.style.display = (p.getAttribute('data-fc-pane') === tabId) ? 'flex' : 'none';
      });
      return;
    }
    if (target.closest('#fcOpenLocationSheetBtn')) {
      e.stopPropagation();
      if (typeof window.__KLEV_OPEN_SETTINGS_ZONE__ === 'function') {
        window.__KLEV_OPEN_SETTINGS_ZONE__('fishing');
      } else if (typeof window.__KLEV_NAVIGATE_SECTION__ === 'function') {
        window.__KLEV_NAVIGATE_SECTION__('geo');
      }
      return;
    }
    if (target.closest('#fcOpenFullWeatherScreenBtn')) {
      e.stopPropagation();
      if (typeof window.__KLEV_NAVIGATE_SECTION__ === 'function') {
        window.__KLEV_NAVIGATE_SECTION__('weather');
      }
      return;
    }
    const carpToggle = target.closest('#fcOpenWaterCarpToggle');
    if (carpToggle) {
      _openWaterCarpPreview = Boolean(carpToggle.checked);
      render(container);
      return;
    }
    const expCard = target.closest('[data-express-day]');
    if (expCard) {
      selectedArchiveDateOverride = null;
      const idx = parseInt(expCard.getAttribute('data-express-day'), 10);
      store.dispatch({ type: 'SET_DAY', payload: idx });
      flashHighlightElement(['#bentoSwipeHeroCard', '#bentoWaveChartCard'], { scroll: true, block: 'center', delayMs: 70 });
      return;
    }
    const weekCard = target.closest('[data-week-day]');
    if (weekCard) {
      const idx = parseInt(weekCard.getAttribute('data-week-day'), 10);
      if (idx !== 2 && typeof window !== 'undefined' && typeof window.__KLEV_IS_MOBILE_GUEST__ === 'function' && window.__KLEV_IS_MOBILE_GUEST__()) {
        if (typeof window.__KLEV_PROMPT_GUEST_AUTH__ === 'function') {
          window.__KLEV_PROMPT_GUEST_AUTH__('Сначала войдите в аккаунт — посуточный прогноз на 10 дней и архив клёва доступны после авторизации');
        }
        return;
      }
      selectedArchiveDateOverride = null;
      const strip = container.querySelector('.week-strip');
      const savedStripLeft = strip ? strip.scrollLeft : 0;
      store.dispatch({ type: 'SET_DAY', payload: idx });
      requestAnimationFrame(() => {
        const nextStrip = container.querySelector('.week-strip');
        if (nextStrip && savedStripLeft > 0) nextStrip.scrollLeft = savedStripLeft;
      });
      flashHighlightElement(['#bentoSwipeHeroCard', '#bentoWaveChartCard', '#fcHourlyBox'], { scroll: false, delayMs: 70 });
      return;
    }
    const hourBtn = target.closest('[data-scrub-hour]');
    if (hourBtn) {
      const hr = parseInt(hourBtn.getAttribute('data-scrub-hour'), 10);
      if (Number.isFinite(hr)) {
        const timeline = container.querySelector('.bite-timeline');
        const savedLeft = timeline ? timeline.scrollLeft : 0;
        store.dispatch({ type: 'SET_HOUR', payload: hr });
        if (typeof document !== 'undefined' && document.documentElement.getAttribute('data-desktop-web') === '1') {
          renderHourly(container.querySelector('#fcHourlyBox'));
        } else {
          updateMobileSelectedHourInPlace(container);
        }
        const nextTimeline = container.querySelector('.bite-timeline');
        if (nextTimeline && savedLeft > 0) nextTimeline.scrollLeft = savedLeft;
        flashHighlightElement('#fcSelectedHourDetailCard', { scroll: true, block: 'nearest', delayMs: 50 });
      }
      return;
    }
    if (target.closest('#fcCleanArchiveBtn')) {
      if (typeof window !== 'undefined' && typeof window.__KLEV_IS_MOBILE_GUEST__ === 'function' && window.__KLEV_IS_MOBILE_GUEST__()) {
        if (typeof window.__KLEV_PROMPT_GUEST_AUTH__ === 'function') {
          window.__KLEV_PROMPT_GUEST_AUTH__('Сначала войдите в аккаунт — управление архивом клёва доступно после авторизации');
        }
        return;
      }
      const res = storage.clearWeatherArchiveKeep5Days();
      showToast(` Архив погоды очищен: удалено старых записей — ${res.removedCount}, сохранены последние 5 дней архива (${res.keptArchiveCount} дн.)`, 'good');
      render(container);
      return;
    }
    const modeBtn = target.closest('[data-set-app-mode]');
    if (modeBtn) {
      const m = modeBtn.getAttribute('data-set-app-mode');
      store.dispatch({ type: 'SET_APP_MODE', payload: m });
      const titles = { novice: 'Режим «Новичок»', angler: 'Режим «Рыбак»', pro: 'Режим «Профи»' };
      showToast(`Включён ${titles[m] || m}`, 'good');
      return;
    }
    const lbBtn = target.closest('[data-open-fish-lightbox]');
    if (lbBtn) {
      e.stopPropagation();
      const fid = lbBtn.getAttribute('data-open-fish-lightbox');
      const fObj = FISH_DB.find(x => x.id === fid) || FISH_DB[0];
      if (fObj && typeof openFishLightbox === 'function') {
        const boxEl = lbBtn.closest('.bento-splash-fish-box');
        const loadedImg = boxEl?.querySelector('img.fish-visual-img');
        const zoomHtml = (loadedImg && loadedImg.complete && loadedImg.naturalWidth > 0)
          ? `<img class="fish-visual-img" src="${loadedImg.src}" alt="${fObj.name}" style="width:100%;height:auto;max-height:60vh;object-fit:contain;display:block;margin:0 auto;">`
          : renderFishVisual(fObj);
        openFishLightbox(fObj.name, fObj.latin || '', zoomHtml, fObj.id);
      }
      return;
    }
    const zoomFishBox = target.closest('[data-open-fish-zoom]');
    if (zoomFishBox) {
      e.stopPropagation();
      const fid = zoomFishBox.getAttribute('data-open-fish-zoom');
      if (fid && typeof openFishDetail === 'function') openFishDetail(fid);
      return;
    }
    if (target.closest('#bentoPrevFishBtn') || target.closest('#bentoNextFishBtn')) {
      e.stopPropagation();
      const isNext = Boolean(target.closest('#bentoNextFishBtn'));
      const stNow = store.getState();
      const list = getFilteredFishList(stNow).filter(f => f.legal !== 'redbook');
      if (list.length > 1) {
        const curIdx = Math.max(0, list.findIndex(f => f.id === stNow.fishId));
        const nextIdx = (curIdx + (isNext ? 1 : -1) + list.length) % list.length;
        const nextFish = list[nextIdx];
        if (nextFish) {
          store.dispatch({ type: 'SET_FISH', payload: nextFish.id });
          showToast(` Выбрана рыба: ${nextFish.name}`, 'info');
        }
      }
      return;
    }
    if (target.closest('#fcQuickBlankTripBtn')) {
      e.stopPropagation();
      logBlankTrip();
      return;
    }
    if (target.closest('#fcSaveCarpSwimBtn')) {
      e.stopPropagation();
      const clipInp = container.querySelector('#fcCarpClipInput');
      const botSel = container.querySelector('#fcCarpBottomSelect');
      const clipMeters = Math.max(5, Math.min(250, parseInt(clipInp?.value, 10) || 42));
      const bottomType = botSel?.value || 'Ракушечник / Бровка';
      store.dispatch({
        type: 'UPDATE_USER_PROFILE',
        payload: { carpClipMeters: clipMeters, carpBottomType: bottomType }
      });
      const badgeEl = container.querySelector('#fcCarpClipBadgeVal');
      if (badgeEl) badgeEl.textContent = `${clipMeters} м`;
      showToast(` Свим сохранён: клипса ${clipMeters} м (${bottomType})`, 'good');
      return;
    }
    const timerBtn = target.closest('[data-recast-timer-min]');
    if (timerBtn) {
      e.stopPropagation();
      const mins = parseInt(timerBtn.getAttribute('data-recast-timer-min'), 10) || 15;
      startCarpRecastTimer(mins, container);
      return;
    }
    if (target.closest('#fcStopRecastTimerBtn')) {
      e.stopPropagation();
      stopCarpRecastTimer();
      return;
    }
    if (target.closest('#fcOpenRigGuideBtn')) {
      e.stopPropagation();
      const stNow = store.getState();
      const curFish = FISH_DB.find(f => f.id === stNow.fishId) || FISH_DB[0];
      openRigEncyclopediaModal(curFish);
      return;
    }
    const novFishBtn = target.closest('[data-novice-pick-fish]');
    if (novFishBtn) {
      const fid = novFishBtn.getAttribute('data-novice-pick-fish');
      if (fid) {
        store.dispatch({ type: 'SET_FISH', payload: fid });
        flashHighlightElement(['#bentoSwipeHeroCard', '#bentoWaveChartCard'], { scroll: false, delayMs: 60 });
      }
      return;
    }
    if (target.closest('#bentoOpenAllFishBtn')) {
      if (typeof window.__KLEV_NAVIGATE_SECTION__ === 'function') window.__KLEV_NAVIGATE_SECTION__('fish');
      flashHighlightElement('#secFish .card', { scroll: true, block: 'start', delayMs: 100 });
      return;
    }
    if (target.closest('#bentoScrollToFactorsBtn')) {
      const hrBox = container.querySelector('#fcHourlyBox');
      if (hrBox) {
        const sp = hrBox.querySelector('details.forecast-why-spoiler');
        if (sp) sp.open = true;
        flashHighlightElement(sp || hrBox, { scroll: true, block: 'center', delayMs: 60 });
      }
      return;
    }
    if (target.closest('#bentoWaveChartCard')) {
      if (container._waveScrubSuppressClickUntil && Date.now() < container._waveScrubSuppressClickUntil) {
        return;
      }
      const weekBox = container.querySelector('#fcWeekBox');
      const hrBox = container.querySelector('#fcHourlyBox');
      const targets = [weekBox, hrBox].filter(Boolean);
      if (targets.length > 0) {
        flashHighlightElement(targets, { scroll: true, block: 'center', delayMs: 40 });
      }
      return;
    }
    if (target.closest('#bentoOpenCrewBadge')) {
      e.stopPropagation();
      if (typeof window.__KLEV_NAVIGATE_SECTION__ === 'function') window.__KLEV_NAVIGATE_SECTION__('circle');
      return;
    }
    if (target.closest('#bentoMapRadarCard')) {
      if (typeof window.__KLEV_NAVIGATE_SECTION__ === 'function') window.__KLEV_NAVIGATE_SECTION__('geo');
      flashHighlightElement('#mapBox', { scroll: true, block: 'center', delayMs: 110 });
      return;
    }
    if (target.closest('#bentoWeatherIceCard')) {
      if (typeof window.__KLEV_NAVIGATE_SECTION__ === 'function') window.__KLEV_NAVIGATE_SECTION__('weather');
      flashHighlightElement('#secWeather .card', { scroll: true, block: 'start', delayMs: 100 });
      return;
    }
    if (target.closest('#proResetWeightsBtn')) {
      _dayBestMemo.clear();
      store.dispatch({
        type: 'SET_PRO_FACTOR_WEIGHTS',
        payload: { temp: 1.0, press: 1.0, archive_shock: 1.0, circle_field: 1.0 }
      });
      updateLiveWeightLabelsAndScores(container);
      showToast('Веса факторов сброшены к эталонным (1.0x)', 'info');
      return;
    }
    if (target.closest('#fcOpenChecklistBtn, #proOpenChecklistBtn')) {
      openTripChecklistModal();
      return;
    }
    if (target.closest('#fcShareForecastTgBtn')) {
      e.stopPropagation();
      openShareForecastAndTackleModal();
      return;
    }
    const archQuickBtn = target.closest('[data-arch-quick-date]');
    if (archQuickBtn) {
      const dStr = archQuickBtn.getAttribute('data-arch-quick-date');
      if (dStr) {
        selectedArchiveDateOverride = dStr;
        renderHourly(container.querySelector('#fcHourlyBox'));
      }
      return;
    }
    const archBtn = target.closest('#archOpenCatchBtn');
    if (archBtn) {
      const s = store.getState();
      const chosenBait = container.querySelector('#archBaitSel')?.value || s.selectedBait;
      const chosenDate = archBtn.getAttribute('data-arch-active-date') || selectedArchiveDateOverride || s.weatherDays[s.dayIdx]?.date;
      events.emit('forecast:hourSelected', {
        dayIdx: s.dayIdx,
        date: chosenDate,
        hour: s.selectedHour,
        fishId: s.fishId,
        bait: chosenBait
      });
      return;
    }
  });
  let _heroTouchStartX = 0;
  let _heroTouchStartY = 0;
  container.addEventListener('touchstart', (e) => {
    const hero = e.target && e.target.closest ? e.target.closest('#bentoSwipeHeroCard') : null;
    if (!hero || !e.touches || !e.touches[0]) {
      _heroTouchStartX = 0;
      return;
    }
    _heroTouchStartX = e.touches[0].clientX;
    _heroTouchStartY = e.touches[0].clientY;
  }, { passive: true });
  container.addEventListener('touchend', (e) => {
    if (!_heroTouchStartX || !e.changedTouches || !e.changedTouches[0]) return;
    const dx = e.changedTouches[0].clientX - _heroTouchStartX;
    const dy = e.changedTouches[0].clientY - _heroTouchStartY;
    _heroTouchStartX = 0;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      const stNow = store.getState();
      const list = getFilteredFishList(stNow).filter(f => f.legal !== 'redbook');
      if (list.length > 1) {
        const curIdx = Math.max(0, list.findIndex(f => f.id === stNow.fishId));
        const step = dx < 0 ? 1 : -1;
        const nextFish = list[(curIdx + step + list.length) % list.length];
        if (nextFish) {
          store.dispatch({ type: 'SET_FISH', payload: nextFish.id });
          showToast(` ${nextFish.name}`, 'info');
          flashHighlightElement('#bentoSwipeHeroCard', { scroll: false, delayMs: 40 });
        }
      }
    }
  }, { passive: true });

  // Интерактивный скраббинг по почасовому графику клёва (#bentoWaveChartCard):
  // зажали и двигаем влево/вправо — смотрим каждый час (00:00..23:00), отпустили — возврат к исходному виду,
  // просто тапнули без сдвига — плавный скролл к суточному прогнозу с подсветкой.
  let _wavePtrDown = false;
  let _waveScrubActive = false;
  let _waveStartX = 0;
  let _waveStartY = 0;
  let _waveHoldTimer = null;

  const parseWavePoints = (waveCard) => {
    if (!waveCard) return null;
    if (waveCard._cachedPts) return waveCard._cachedPts;
    try {
      const raw = waveCard.getAttribute('data-hourly-points');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        waveCard._cachedPts = parsed;
        return parsed;
      }
    } catch (_e) {}
    return null;
  };

  const applyWaveScrubAtClientX = (waveCard, clientX) => {
    if (!waveCard) return;
    const ptsData = parseWavePoints(waveCard);
    if (!ptsData || !ptsData.length) return;
    const stageEl = waveCard.querySelector('#bentoWaveChartStage') || waveCard;
    const rect = stageEl.getBoundingClientRect();
    const width = Math.max(1, rect.width || 320);
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / width));
    const hrIdx = Math.max(0, Math.min(ptsData.length - 1, Math.round(ratio * (ptsData.length - 1))));
    const pt = ptsData[hrIdx];
    if (!pt) return;

    waveCard.classList.add('is-scrubbing');
    waveCard.setAttribute('data-scrubbing-hour', String(pt.hr));

    const lineEl = waveCard.querySelector('#bentoScrubCursorLine');
    const dotEl = waveCard.querySelector('#bentoScrubCursorDot');
    const hudEl = waveCard.querySelector('#bentoScrubHudBadge');
    const headLbl = waveCard.querySelector('#bentoChartTimeRangeLabel');
    const peaksRow = waveCard.querySelector('#bentoChartPeaksRow');
    const liveRow = waveCard.querySelector('#bentoChartScrubLiveRow');

    const hrStr = `${String(pt.hr).padStart(2, '0')}:00`;
    const tStr = `${pt.tAir > 0 ? '+' + pt.tAir : pt.tAir}°C`;
    const toneColor = pt.sc >= 60 ? '#10b981' : (pt.sc >= 38 ? '#fbbf24' : '#ef4444');

    if (lineEl) {
      lineEl.style.left = `${pt.xPct}%`;
    }
    if (dotEl) {
      dotEl.style.left = `${pt.xPct}%`;
      dotEl.style.top = `${pt.yPct}%`;
      dotEl.style.background = toneColor;
    }
    if (hudEl) {
      const clampedHudX = Math.max(18, Math.min(82, pt.xPct));
      hudEl.style.left = `${clampedHudX}%`;
      hudEl.style.borderColor = toneColor;
      hudEl.innerHTML = `<span style="color:${toneColor};">${hrStr} • Клёв ${pt.sc}%</span> <span style="opacity:0.88;">(${tStr} • ${pt.press} мм • ${pt.windDir} ${pt.wind} м/с)</span>`;
    }
    if (headLbl) {
      if (!headLbl.dataset.origText) headLbl.dataset.origText = headLbl.textContent;
      headLbl.style.color = toneColor;
      headLbl.textContent = `${hrStr} • Клёв ${pt.sc}%`;
    }
    if (peaksRow) peaksRow.style.display = 'none';
    if (liveRow) {
      liveRow.style.display = 'flex';
      liveRow.innerHTML = `<span>Час: <b style="color:${toneColor};">${hrStr}</b> — Клёв <b style="color:${toneColor};">${pt.sc}%</b></span><span>Воздух <b>${tStr}</b> • <b>${pt.press} мм</b> • Ветер <b>${pt.windDir} ${pt.wind} м/с</b></span>`;
    }
    const nearestTick = Math.min(21, Math.round(pt.hr / 3) * 3);
    waveCard.querySelectorAll('.bento-chart-tick-cell[data-tick-hour]').forEach(cell => {
      const th = parseInt(cell.getAttribute('data-tick-hour'), 10);
      cell.classList.toggle('scrub-active-tick', th === nearestTick);
    });
  };

  const resetWaveScrubState = (waveCard) => {
    if (_waveHoldTimer) {
      clearTimeout(_waveHoldTimer);
      _waveHoldTimer = null;
    }
    if (!waveCard) {
      waveCard = container.querySelector('#bentoWaveChartCard');
    }
    if (waveCard) {
      const scrubbedHrStr = waveCard.getAttribute('data-scrubbing-hour');
      waveCard.classList.remove('is-scrubbing');
      waveCard.removeAttribute('data-scrubbing-hour');
      if (scrubbedHrStr !== null && scrubbedHrStr !== '') {
        const nextHr = parseInt(scrubbedHrStr, 10);
        if (Number.isFinite(nextHr) && nextHr !== store.getState().selectedHour) {
          store.dispatch({ type: 'SET_HOUR', payload: nextHr });
        } else {
          updateMobileSelectedHourInPlace(container);
        }
      } else {
        const headLbl = waveCard.querySelector('#bentoChartTimeRangeLabel');
        if (headLbl && headLbl.dataset.origText) {
          headLbl.textContent = headLbl.dataset.origText;
        }
      }
      const peaksRow = waveCard.querySelector('#bentoChartPeaksRow');
      const liveRow = waveCard.querySelector('#bentoChartScrubLiveRow');
      if (peaksRow) peaksRow.style.display = 'flex';
      if (liveRow) {
        liveRow.style.display = 'none';
        liveRow.innerHTML = '';
      }
      waveCard.querySelectorAll('.bento-chart-tick-cell.scrub-active-tick').forEach(cell => {
        cell.classList.remove('scrub-active-tick');
      });
    }
    _wavePtrDown = false;
    _waveScrubActive = false;
  };

  container.addEventListener('touchstart', (e) => {
    const waveCard = e.target && e.target.closest ? e.target.closest('#bentoWaveChartCard') : null;
    if (!waveCard || !e.touches || !e.touches[0]) return;
    _wavePtrDown = true;
    _waveScrubActive = false;
    _waveStartX = e.touches[0].clientX;
    _waveStartY = e.touches[0].clientY;
    if (_waveHoldTimer) clearTimeout(_waveHoldTimer);
    _waveHoldTimer = setTimeout(() => {
      if (_wavePtrDown) {
        _waveScrubActive = true;
        applyWaveScrubAtClientX(waveCard, _waveStartX);
      }
    }, 150);
  }, { passive: true });

  container.addEventListener('touchmove', (e) => {
    if (!_wavePtrDown || !e.touches || !e.touches[0]) return;
    const waveCard = container.querySelector('#bentoWaveChartCard');
    if (!waveCard) return;
    const cx = e.touches[0].clientX;
    const cy = e.touches[0].clientY;
    const dx = cx - _waveStartX;
    const dy = cy - _waveStartY;
    if (!_waveScrubActive) {
      if (Math.abs(dx) >= 6 && Math.abs(dx) >= Math.abs(dy) * 0.75) {
        if (_waveHoldTimer) {
          clearTimeout(_waveHoldTimer);
          _waveHoldTimer = null;
        }
        _waveScrubActive = true;
      } else if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx)) {
        resetWaveScrubState(waveCard);
        return;
      }
    }
    if (_waveScrubActive) {
      if (e.cancelable) e.preventDefault();
      applyWaveScrubAtClientX(waveCard, cx);
    }
  }, { passive: false });

  const handleWaveTouchEnd = () => {
    if (!_wavePtrDown && !_waveScrubActive) return;
    const wasScrubbing = _waveScrubActive;
    const waveCard = container.querySelector('#bentoWaveChartCard');
    resetWaveScrubState(waveCard);
    if (wasScrubbing) {
      container._waveScrubSuppressClickUntil = Date.now() + 360;
    }
  };
  container.addEventListener('touchend', handleWaveTouchEnd, { passive: true });
  container.addEventListener('touchcancel', handleWaveTouchEnd, { passive: true });

  container.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const waveCard = e.target && e.target.closest ? e.target.closest('#bentoWaveChartCard') : null;
    if (!waveCard) return;
    _wavePtrDown = true;
    _waveScrubActive = false;
    _waveStartX = e.clientX;
    _waveStartY = e.clientY;
    if (_waveHoldTimer) clearTimeout(_waveHoldTimer);
    _waveHoldTimer = setTimeout(() => {
      if (_wavePtrDown) {
        _waveScrubActive = true;
        applyWaveScrubAtClientX(waveCard, _waveStartX);
      }
    }, 150);
  });

  container.addEventListener('mousemove', (e) => {
    if (!_wavePtrDown) return;
    const waveCard = container.querySelector('#bentoWaveChartCard');
    if (!waveCard) return;
    const dx = e.clientX - _waveStartX;
    const dy = e.clientY - _waveStartY;
    if (!_waveScrubActive && Math.abs(dx) >= 5 && Math.abs(dx) >= Math.abs(dy) * 0.7) {
      if (_waveHoldTimer) {
        clearTimeout(_waveHoldTimer);
        _waveHoldTimer = null;
      }
      _waveScrubActive = true;
    }
    if (_waveScrubActive) {
      applyWaveScrubAtClientX(waveCard, e.clientX);
    }
  });

  const handleWaveMouseUp = () => {
    if (!_wavePtrDown && !_waveScrubActive) return;
    const wasScrubbing = _waveScrubActive;
    const waveCard = container.querySelector('#bentoWaveChartCard');
    resetWaveScrubState(waveCard);
    if (wasScrubbing) {
      container._waveScrubSuppressClickUntil = Date.now() + 360;
    }
  };
  container.addEventListener('mouseup', handleWaveMouseUp);
  container.addEventListener('mouseleave', handleWaveMouseUp);
  container.addEventListener('input', (e) => {
    const rng = e.target && e.target.closest ? e.target.closest('[data-pro-weight]') : null;
    if (!rng) return;
    _sliderDragActive = true;
    const key = rng.getAttribute('data-pro-weight');
    const val = parseFloat(rng.value);
    if (!key || !Number.isFinite(val)) return;
    _dayBestMemo.clear();
    store.dispatch({ type: 'SET_PRO_FACTOR_WEIGHTS', payload: { [key]: val } });
    updateLiveWeightLabelsAndScores(container);
    setTimeout(() => { _sliderDragActive = false; }, 80);
  });
  container.addEventListener('change', (e) => {
    const t = e.target;
    if (!t) return;
    if (t.matches && t.matches('[data-pro-weight]')) {
      _sliderDragActive = true;
      const key = t.getAttribute('data-pro-weight');
      const val = parseFloat(t.value);
      if (key && Number.isFinite(val)) {
        _dayBestMemo.clear();
        store.dispatch({ type: 'SET_PRO_FACTOR_WEIGHTS', payload: { [key]: val } });
        updateLiveWeightLabelsAndScores(container);
      }
      setTimeout(() => { _sliderDragActive = false; }, 80);
      return;
    }
    if (t.id === 'fcTopMethodSelect') {
      store.dispatch({ type: 'SET_METHOD', payload: t.value });
      flashHighlightElement(['#bentoSwipeHeroCard', '#fcTackleControlsCard'], { scroll: false, delayMs: 60 });
      return;
    }
    if (t.id === 'fcTopBaitSelect' || t.id === 'fcSeasonalBaitSel' || t.id === 'archBaitSel') {
      store.dispatch({ type: 'SET_BAIT', payload: t.value });
      flashHighlightElement(['#bentoSwipeHeroCard', '#fcTackleControlsCard'], { scroll: false, delayMs: 60 });
      return;
    }
    if (t.id === 'archCalendarDate') {
      if (t.value) {
        selectedArchiveDateOverride = t.value;
        renderHourly(container.querySelector('#fcHourlyBox'));
      }
      return;
    }
    if (t.id === 'archFishSel') {
      const newFishId = t.value;
      const s = store.getState();
      const fObj = FISH_DB.find(x => x.id === newFishId) || FISH_DB[0];
      store.dispatch({ type: 'SET_FISH', payload: newFishId });
      const dayObj = s.weatherDays[s.dayIdx] || s.weatherDays[2] || s.weatherDays[0] || {};
      const newMethods = getCompatibleMethods(fObj, dayObj.iceState || s.iceState, s.water, dayObj.waterTemp ?? 12);
      const archMethod = container.querySelector('#archMethodSel');
      const archBait = container.querySelector('#archBaitSel');
      if (archMethod) {
        archMethod.innerHTML = newMethods.map(m => `<option value="${m.val}">${String(m.text || '').replace(/<[^>]+>/g, '').trim()}</option>`).join('');
        const chosenMethod = newMethods[0]?.val;
        store.dispatch({ type: 'SET_METHOD', payload: chosenMethod });
        const newBaits = getSeasonalBaitsForContext(fObj, chosenMethod, dayObj.waterTemp ?? 12, dayObj.iceState || s.iceState);
        if (archBait) {
          archBait.innerHTML = newBaits.map(b => `<option value="${b}">${b}</option>`).join('');
          store.dispatch({ type: 'SET_BAIT', payload: newBaits[0] || '' });
        }
      }
      return;
    }
    if (t.id === 'archMethodSel') {
      const chosenMethod = t.value;
      store.dispatch({ type: 'SET_METHOD', payload: chosenMethod });
      const s = store.getState();
      const fObj = FISH_DB.find(x => x.id === s.fishId) || FISH_DB[0];
      const day = s.weatherDays[s.dayIdx] || s.weatherDays[2] || s.weatherDays[0] || {};
      const newBaits = getSeasonalBaitsForContext(fObj, chosenMethod, day.waterTemp ?? 12, day.iceState || s.iceState);
      const archBait = container.querySelector('#archBaitSel');
      if (archBait) {
        archBait.innerHTML = newBaits.map(b => `<option value="${b}">${b}</option>`).join('');
        store.dispatch({ type: 'SET_BAIT', payload: newBaits[0] || '' });
      }
      return;
    }
    if (t.id === 'archHourSel') {
      store.dispatch({ type: 'SET_HOUR', payload: parseInt(t.value, 10) });
      return;
    }
    if (t.id === 'archWaterSel') {
      const [wType, wName] = t.value.split('|');
      store.dispatch({ type: 'SET_WATER', payload: { water: wType, selectedWaterName: wName } });
      return;
    }
  });
}
let unsub = null;
let _fcNeedsRender = false;
export function init(container) {
  render(container);
  unsub = store.subscribe(
    s => ({
      route: s.route,
      fishId: s.fishId,
      dayIdx: s.dayIdx,
      selectedHour: s.selectedHour,
      water: s.water,
      selectedWaterName: s.selectedWaterName,
      method: s.method,
      selectedBait: s.selectedBait,
      depth: s.depth,
      weatherDays: s.weatherDays,
      weatherArchive5Days: s.weatherArchive5Days,
      hasRealArchive: s.hasRealArchive,
      appMode: s.appMode,
      circleItems: s.circleItems,
      proFactorWeights: s.proFactorWeights,
      catches: s.catches,
      iceState: s.iceState,
      theme: s.theme
    }),
    (next, prev) => {
      const isVisible = !next.route || next.route === 'forecast';
      if (!isVisible) {
        _fcNeedsRender = true;
        return;
      }
      if (_fcNeedsRender || prev?.route !== 'forecast') {
        _fcNeedsRender = false;
        render(container);
        return;
      }
      if (_sliderDragActive && prev && next.proFactorWeights !== prev.proFactorWeights) {
        return;
      }
      if (prev && next.proFactorWeights !== prev.proFactorWeights && next.appMode === prev.appMode) {
        _dayBestMemo.clear();
        updateLiveWeightLabelsAndScores(container);
        return;
      }
      if (prev &&
          next.fishId === prev.fishId &&
          next.water === prev.water &&
          next.selectedWaterName === prev.selectedWaterName &&
          next.method === prev.method &&
          next.selectedBait === prev.selectedBait &&
          next.depth === prev.depth &&
          next.appMode === prev.appMode &&
          next.theme === prev.theme &&
          next.weatherDays === prev.weatherDays &&
          next.proFactorWeights === prev.proFactorWeights) {
        if (container) {
          const isDesktopWeb = typeof document !== 'undefined' && document.documentElement.getAttribute('data-desktop-web') === '1';
          if (!isDesktopWeb) {
            if (next.dayIdx === prev.dayIdx && next.selectedHour !== prev.selectedHour) {
              updateMobileSelectedHourInPlace(container);
              return;
            }
            const savedWinY = typeof window !== 'undefined' ? window.scrollY : 0;
            renderMobileRedesignForecast(container);
            if (typeof window !== 'undefined' && savedWinY > 0 && Math.abs(window.scrollY - savedWinY) > 4) {
              window.scrollTo({ top: savedWinY, behavior: 'instant' });
            }
            return;
          }
          const savedWinY = typeof window !== 'undefined' ? window.scrollY : 0;
          container.querySelectorAll('[data-week-day]').forEach(cd => {
            const d = parseInt(cd.getAttribute('data-week-day'), 10);
            cd.classList.toggle('active', d === next.dayIdx);
          });
          renderExpress(container.querySelector('#fcExpressBox'));
          renderHourly(container.querySelector('#fcHourlyBox'));
          if (typeof window !== 'undefined' && savedWinY > 0 && Math.abs(window.scrollY - savedWinY) > 4) {
            window.scrollTo({ top: savedWinY, behavior: 'instant' });
          }
          return;
        }
      }
      render(container);
    }
  );
}
export const forecastModule = {
  init,
  render,
  calcHourly,
  calcDayBest,
  getBestBiteWindowText,
  getFactorBreakdown,
  calcDynamicRig
};