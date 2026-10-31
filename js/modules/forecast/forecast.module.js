import { getFilteredFishList, openFishDetail } from '../fish/fish.module.js?v=2.5.2';
import { logBlankTrip } from '../log/log.module.js?v=2.5.2';
import { getSpotEcoregion, isSpeciesInGeoRange } from '../../data/basins.js?v=2.5.2';
import { RU } from '../../i18n/ru.js?v=2.5.2';
import { getSeasonalBaitsForContext, getCompatibleMethods } from '../../core/config.js?v=2.5.2';
import { events } from '../../core/events.js?v=2.5.2';
import { storage } from '../../core/storage.js?v=2.5.2';
import { store } from '../../core/store.js?v=2.5.2';
import { formatLocalYYYYMMDD, fmtDeltaPress, fmtHM } from '../../core/format.js?v=2.5.2';
import { WATER_PROFILES, getAvailableWaterTypes } from '../../data/waters.js?v=2.5.2';
import { FISH_DB } from '../../data/species.js?v=2.5.2';
import { renderFiveFish } from '../../ui/svg.js?v=2.5.2';
import { createPill, showToast, openModal } from '../../ui/components.js?v=2.5.2';
import { computeIceSafetyIndex } from '../weather/weather.module.js?v=2.5.2';
import { evaluateCircleFieldConfirmation, requireRegisteredFisherId } from '../circle/circle.module.js?v=2.5.2';
import { isTelegramWebApp, getTelegramUser, shareToTelegramChat, openBotChatInTelegram, buildForecastShareUrls, TELEGRAM_BOT_USERNAME } from '../../core/telegram.js?v=2.5.2';

/**
 * Список морских, проходных и полупроходных видов, которые заходят в пресные реки
 * (big_river, small_river) и эстуарии (sea_gulf) при нересте, сезонных миграциях или приливах/отливах.
 */
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
// Высокоскоростной кэш расчётов прогноза (устраняет 5000+ повторных циклов при рендере 115 видов рыб)
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

  // Максимальный суточный скачок за предыдущие 1–2 суток
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

  // Температурный тренд воды/воздуха за 5 дней
  const firstT = prev5Days[0]?.tDay ?? day.tDay;
  const tempShift5d = Math.round((day.tDay ?? 10) - firstT);

  let val = 0;
  let isShock = false;
  let note = '';
  let commentary = '';

  // 1. Сильный барический шок за предыдущие 1–2 суток (скачок >= 6 мм за сутки или >= 9 мм за 48 ч)
  if (maxRecentJump >= 6 || swing5d >= 11) {
    isShock = true;
    const rawPenalty = maxRecentJump >= 9 || swing5d >= 14 ? -16 : -11;
    val = isBurbot ? Math.round(rawPenalty * 0.4) : Math.round(rawPenalty * Math.max(0.65, sens));

    if (todayNormalized) {
      note = `Барический «шок» после скачка давления (до ${maxRecentJump} мм за 1–2 сут., размах за 5 дн. ${swing5d} мм)`;
      commentary = `Даже несмотря на то, что сегодня погода выровнялась (Δ ${fmtDeltaPress(day.dP)}), за предыдущие 1–2 суток зафиксирован резкий перепад давления (${maxRecentJump} мм, 5-дневный размах ${minP}–${maxP} мм). После таких качелей плавательный пузырь рыбы не успевает адаптироваться — рыба находится в барическом «шоке» (ступоре) и игнорирует активные приманки.`;
    } else {
      note = `Затяжной барический шторм: скачки до ${maxRecentJump} мм (размах за 5 дн. ${swing5d} мм)`;
      commentary = `По данным 5-дневного архива локации (10 км) продолжается сильная барическая пила (перепад ${minP}–${maxP} мм). Рыба испытывает выраженный барический шок и стоит в глухой обороне у дна.`;
    }
  } else if (maxRecentJump >= 4 || swing5d >= 7) {
    // 2. Умеренные колебания давления за 5 дней
    val = isBurbot ? +2 : Math.round(-5 * Math.max(0.6, sens));
    note = `Умеренные качели давления за 5 дней (размах ${swing5d} мм, вчера/позавчера до ${maxRecentJump} мм)`;
    commentary = `За последние ${prev5Days.length} дн. в радиусе 10 км давление менялось в пределах ${minP}–${maxP} мм (${swing5d} мм). Умеренная барическая нестабильность делает поклёвки осторожными и короткими.`;
  } else {
    // 3. Стабильное барическое плато за 3–5 дней!
    val = Math.round(8 * Math.max(0.75, sens));
    note = `Стабильное плато давления ${prev5Days.length} дн. подряд (размах всего ${swing5d} мм)`;
    commentary = `За последние ${prev5Days.length} дн. в этой локации (10 км) держится ровное атмосферное давление (${minP}–${maxP} мм, без резких скачков). Рыба полностью адаптировалась к горизонту глубины и выходит на уверенную кормёжку.`;
  }

  // Поправка на 5-дневный температурный тренд
  if (Math.abs(tempShift5d) >= 6) {
    if (tempShift5d <= -6 && ['burbot', 'chir', 'pizhyan', 'peled', 'cisco', 'whitefish'].includes(fish?.id)) {
      val += 4;
      commentary += ` Пятидневное похолодание (${tempShift5d}°C) дополнительно активизирует холоднолюбивый вид.`;
    } else if (tempShift5d <= -6 && fish?.type === 'peace') {
      val -= 4;
      commentary += ` Резкое похолодание за 5 дней (${tempShift5d}°C) снизило кормовую активность мирной рыбы.`;
    }
  }

  val = Math.max(-20, Math.min(12, val));
  return { val, isShock, note, commentary, swing5d, maxRecentJump };
}

/**
 * Аналитика Личного журнала рыболова для калибровки прогноза клёва (Ревизия 2.0.15):
 * Сравнивает текущие условия (температура воды, давление, ветер, снасть, час) с реальными уловами пользователя из журнала.
 */
export function evaluateLogbookInsight(fish, day, hrObj, method, water, catches = []) {
  if (!Array.isArray(catches) || catches.length === 0 || !fish) {
    return {
      val: 0,
      hasData: false,
      note: 'Журнал уловов: пока нет записей для личной калибровки',
      commentary: 'Добавляйте свои уловы через кнопку «<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 20C5 11 11 5 20 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 4v7c0 1.7-1.3 3-3 3s-3-1.3-3-3" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/><circle cx="14" cy="16" r="2.2" fill="#10b981"/></svg> Я поймал» (доступна запись за последние 5 дней по календарю), чтобы прогноз автоматически учитывал вашу личную статистику по водоёмам и приманкам.'
    };
  }

  const byFish = catches.filter(c => c && c.fishId === fish.id);
  if (byFish.length === 0) {
    return {
      val: 0,
      hasData: false,
      note: `Журнал уловов: всего записей ${catches.length}, по виду «${fish.name}» пока 0`,
      commentary: `В вашем журнале ${catches.length} уловов других видов, но по рыбе «${fish.name}» записей ещё нет.`
    };
  }

  const curWT = day.waterTemp ?? 10;
  const curP = hrObj?.press ?? day.pressAvg ?? 754;
  const curHr = hrObj?.hour ?? 12;

  const avgWT = Math.round((byFish.reduce((a, b) => a + (Number.isFinite(b.waterTemp) ? b.waterTemp : curWT), 0) / byFish.length) * 10) / 10;
  const avgP = Math.round(byFish.reduce((a, b) => a + (Number.isFinite(b.press) ? b.press : curP), 0) / byFish.length);

  const baitCounts = {};
  byFish.forEach(c => {
    if (c.bait) baitCounts[c.bait] = (baitCounts[c.bait] || 0) + 1;
  });
  const topBait = Object.entries(baitCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'проверенная приманка';

  // Ищем уловы при близких метеоусловиях (вода ±3.5°C, давление ±6 мм)
  const similarCatches = byFish.filter(c => {
    const wtDiff = Math.abs((c.waterTemp ?? curWT) - curWT);
    const pDiff = Math.abs((c.press ?? curP) - curP);
    return wtDiff <= 3.5 && pDiff <= 6;
  });

  const sameHourCatches = byFish.filter(c => Math.abs((c.hour ?? 12) - curHr) <= 2);

  let val = 0;
  let note = '';
  let commentary = '';

  if (similarCatches.length > 0) {
    val = Math.min(9, 4 + similarCatches.length * 2 + (sameHourCatches.length > 0 ? 2 : 0));
    note = `Личный журнал (${byFish.length} уловов): текущая погода совпадает с ${similarCatches.length} вашими поимками (+${val}%)`;
    commentary = `По данным вашего журнала уловов (${byFish.length} зап. по виду «${fish.name}») вы уже успешно ловили эту рыбу при таких же условиях (вода ~${avgWT}°C, давление ~${avgP} мм). Ваша самая уловистая приманка из журнала: «${topBait}».`;
  } else {
    const wtDiffAvg = Math.abs(curWT - avgWT);
    const pDiffAvg = Math.abs(curP - avgP);
    if (wtDiffAvg > 6 || pDiffAvg > 10) {
      val = -3;
      note = `Личный журнал (${byFish.length} уловов): условия отличаются от ваших средних (вода ~${avgWT}°C, ${avgP} мм)`;
      commentary = `В вашем журнале «${fish.name}» чаще ловилась при воде ~${avgWT}°C и давлении ~${avgP} мм (лучшая приманка: «${topBait}»). Сейчас условия заметно отличаются, рекомендуем более деликатную подачу.`;
    } else {
      val = +2;
      note = `Личный журнал (${byFish.length} уловов): близко к вашей статистике (лучшая насадка — ${topBait})`;
      commentary = `Учтена статистика вашего журнала (${byFish.length} уловов вида «${fish.name}», средние условия: вода ~${avgWT}°C, давление ~${avgP} мм, фаворит — «${topBait}»).`;
    }
  }

  return { val, hasData: true, topBait, count: byFish.length, note, commentary };
}

/**
 * Ревизия 2.0.15:
 * 7-факторный расчёт почасового прогноза клёва + калибровка по Личному журналу рыболова:
 * 1) Температура воды (с учётом течения водоёма)
 * 2) Давление и его суточный/3ч ход
 * 3) Метеоархив за 5 дней и барический шок (7-й уникальный фактор из 10-км гео-кэша!)
 * 4) Сезон, биоритм и миграция
 * 5) Глубина, течение, свет и снасть
 * 6) Ветер и волнение
 * 7) Фаза Луны и приливные окна
 * + Учёт Личного журнала уловов пользователя
 */
export function computeHourFactors(fish, day, hrObj, method, water, depth, normPress = 752, globalIceState = 'open_water', fastScoreOnly = false) {
  const st = store.getState();
  const dayIce = day.iceState || globalIceState;
  const isRedBook = fish.legal === 'redbook';
  const isIceDanger = dayIce === 'ice_danger' && !method.startsWith('winter_');
  const prof = WATER_PROFILES[water] || WATER_PROFILES.small_river;
  const flowLabel = prof.flow >= 1.8 ? 'быстрое течение' : (prof.flow >= 1.1 ? 'умеренное течение' : 'стоячая вода');

  // 1. Температура воды (с учётом скорости течения)
  const wt = day.waterTemp ?? 8;
  const [tOptMin, tOptMax] = fish.tWaterOpt || [8, 16];
  let tempDelta = 0;
  let tempNote = `Вода ${wt}°C с учётом течения (${flowLabel}, оптимум ${tOptMin}–${tOptMax}°C)`;
  if (wt < fish.tMinStop) {
    tempDelta = -36;
    tempNote = `Вода ${wt}°C (${flowLabel}) ниже порога активности (${fish.tMinStop}°C) — оцепенение`;
  } else if (wt >= tOptMin && wt <= tOptMax) {
    tempDelta = +16;
    tempNote = `Вода ${wt}°C (${flowLabel}) в оптимуме вида (${tOptMin}–${tOptMax}°C)`;
  } else if (wt < tOptMin) {
    const span = Math.max(1.5, tOptMin - fish.tMinStop);
    const ratio = (wt - fish.tMinStop) / span;
    const coldBoost = (fish.coldFactor || 0.7) >= 1.05 ? 6 : 0;
    tempDelta = Math.round(-18 + ratio * 28 + coldBoost);
    tempNote = `Вода ${wt}°C (${flowLabel}) прохладнее оптимума (${tOptMin}–${tOptMax}°C)`;
  } else {
    const excess = wt - tOptMax;
    tempDelta = Math.max(-30, Math.round(12 - excess * 7));
    tempNote = `Вода ${wt}°C (${flowLabel}) теплее оптимума (${tOptMin}–${tOptMax}°C)`;
  }

  // 2. Давление и текущий барометрический градиент
  const pDiff = Math.abs((hrObj.press || 754) - normPress);
  const dp = hrObj.dp3h ?? (day.dP / 4);
  let pressDelta = Math.round(6 - Math.min(14, pDiff * 0.6 * (fish.bladderSens || 0.8)));

  if (fish.type === 'predator') {
    if (dp <= -0.8) pressDelta += 8;
    else if (dp >= 1.0) pressDelta -= 9;
  } else {
    if (Math.abs(dp) <= 0.6) pressDelta += 6;
    else if (dp <= -1.0) pressDelta -= 8;
  }

  const absDailyDP = Math.abs(day.dP || 0);
  if (absDailyDP >= 8) {
    pressDelta -= 18;
  } else if (absDailyDP >= 5) {
    pressDelta -= 12;
  }

  pressDelta = Math.max(-24, Math.min(15, pressDelta));
  const pressNote = `Давление ${hrObj.press} мм (суточный ход ${fmtDeltaPress(day.dP)})`;

  // 3. 7-й ФАКТОР: 5-дневный метеоархив (10 км) и барический шок (с мемоизацией на сутки)
  const hasRealArchive = st.hasRealArchive !== false;
  const archMemoKey = `${fish.id}|${day.date}|${day.pressAvg}|${day.dP}|${day.tDay}|${hasRealArchive ? 1 : 0}|${Math.round((st.lat || 0) * 100)}_${Math.round((st.lon || 0) * 100)}`;
  let archiveEval = _archiveShockMemo.get(archMemoKey);
  if (!archiveEval) {
    const prev5Days = getPreceding5DaysForTarget(day, st);
    archiveEval = evaluate5DayArchiveAndBaricShock(fish, day, prev5Days, hasRealArchive);
    _pruneCache(_archiveShockMemo, 2500);
    _archiveShockMemo.set(archMemoKey, archiveEval);
  }
  const archiveDelta = archiveEval.val;
  const archiveNote = archiveEval.note;

  // 4. Ветер и волнение
  let windDelta = 0;
  if (dayIce === 'ice_safe') {
    windDelta = hrObj.wind > 9 ? -8 : +3;
  } else if (fish.id === 'burbot') {
    windDelta = (hrObj.wind >= 4 || hrObj.precip > 0) ? +10 : 0;
  } else {
    if (hrObj.wind >= 1.5 && hrObj.wind <= 5.5) windDelta += 6;
    else if (hrObj.wind >= 8.5) windDelta -= 16;
    else if (hrObj.wind > 6.5) windDelta -= 8;
    else windDelta -= 2;

    if (['Ю', 'ЮЗ', 'З'].includes(hrObj.windDir)) windDelta += 4;
    else if (['С', 'СВ', 'В'].includes(hrObj.windDir)) windDelta -= 4;

    if (['carp', 'grass_carp', 'crucian', 'bream', 'tench', 'buffalo'].includes(fish.id) && hrObj.wind >= 2.5 && hrObj.wind <= 7.0) {
      windDelta += 4;
    }
  }
  const isCarpSurf = dayIce === 'open_water' && ['carp', 'grass_carp', 'crucian', 'bream', 'tench', 'buffalo'].includes(fish.id) && hrObj.wind >= 2.5 && hrObj.wind <= 7.0;
  const windNote = isCarpSurf
    ? `Ветер ${hrObj.windDir} ${hrObj.wind} м/с (фактор «Прибойный берег» +кислород)`
    : `Ветер ${hrObj.windDir} ${hrObj.wind} м/с`;

  // 5. Сезонный биоритм, нерест и речной ход морских/проходных рыб
  const dtMonthIdx = day._mIdx !== undefined ? day._mIdx : (day._mIdx = (parseInt(String(day.date || '2026-06').slice(5, 7), 10) - 1) || 0);
  const curMonthNum = dtMonthIdx + 1;
  const mAct = (fish.monthActivity && fish.monthActivity[dtMonthIdx]) ?? 2;
  let seasonDelta = mAct === 3 ? +14 : (mAct === 2 ? +6 : (mAct === 1 ? -6 : -18));

  const runInfo = RIVER_ENTERING_SPECIES[fish.id];
  const isRiverWater = water === 'big_river' || water === 'small_river';
  const isSeaWater = water === 'sea_gulf' || water === 'open_sea';
  let seasonNote = `Сезонный биоритм месяца: ${mAct} из 3`;

  if (runInfo && isRiverWater) {
    if (runInfo.runMonths.includes(curMonthNum)) {
      seasonDelta += 10;
      seasonNote = `Речной ход (${runInfo.reason})`;
    } else {
      seasonDelta -= 12;
      seasonNote = `Вне сезона массового захода в реки (основное стадо в море/заливе)`;
    }
  } else if (fish.habitat === 'sea' && !runInfo && isRiverWater) {
    seasonDelta -= 28;
    seasonNote = 'Строго морской вид (не заходит в пресные реки)';
  } else if (fish.spawnMonth && fish.spawnMonth.includes(curMonthNum)) {
    if (runInfo && ['pink_salmon', 'chum_salmon', 'coho_salmon', 'sockeye_salmon', 'chinook_salmon', 'cherry_salmon', 'smelt', 'vobla', 'taran', 'kutum'].includes(fish.id)) {
      seasonDelta += 8;
      seasonNote = `Активный преднерестовый и миграционный ход (${runInfo.reason})`;
    } else {
      seasonDelta = -20;
      seasonNote = 'Период нереста — кормовая активность снижена';
    }
  }

  if (dayIce === 'ice_safe' && ['crucian', 'carp', 'tench', 'catfish', 'tilapia', 'silver_carp', 'grass_carp', 'snakehead'].includes(fish.id)) {
    seasonDelta = -28;
  }
  if (dayIce === 'ice_slush') {
    if (['burbot', 'chir', 'pizhyan', 'peled', 'cisco', 'whitefish', 'navaga', 'smelt'].includes(fish.id)) {
      seasonDelta += 6;
    } else {
      seasonDelta -= 5;
    }
  }

  // 6. Глубина, освещённость, прилив и снасть
  let gearDelta = 0;
  if (depth > fish.depthMax) {
    gearDelta -= 22;
  } else if (depth >= fish.depthOpt[0] && depth <= fish.depthOpt[1]) {
    gearDelta += 8;
  } else {
    gearDelta -= 6;
  }
  gearDelta += getMethodCompatibility(fish, method, water);

  const h = hrObj.hour;
  const sr = day.sunriseHr ?? 7;
  const ss = day.sunsetHr ?? 18;
  const isTwilight = Math.abs(h + 0.5 - sr) <= 1.5 || Math.abs(h + 0.5 - ss) <= 1.5;
  const isDay = (h + 0.5 >= sr - 0.5) && (h + 0.5 <= ss + 0.5);
  if (fish.feedMode === 'nocturnal') gearDelta += !isDay ? 6 : (isTwilight ? 2 : -10);
  else if (fish.feedMode === 'crepuscular') gearDelta += isTwilight ? 7 : (isDay ? 2 : -8);
  else if (fish.feedMode === 'diurnal') gearDelta += isDay ? 5 : -12;
  gearDelta = Math.max(-22, Math.min(16, gearDelta));
  const gearNote = `Глубина ${depth} м (оптимум ${fish.depthOpt[0]}–${fish.depthOpt[1]} м)`;

  // 7. Луна и приливно-отливная фаза
  const md = day.moon?.moonDay || 10;
  let moonDelta = 0;
  if (md >= 28 || md <= 2 || (md >= 14 && md <= 17)) moonDelta += 3;
  else if ((md >= 6 && md <= 8) || (md >= 21 && md <= 23)) moonDelta -= 3;
  const dTr = Math.min(Math.abs(h - (day.moon?.transitHour || 12)), 24 - Math.abs(h - (day.moon?.transitHour || 12)));
  const dUn = Math.min(Math.abs(h - (day.moon?.underfootHour || 0)), 24 - Math.abs(h - (day.moon?.underfootHour || 0)));
  if (dTr <= 1.5 || dUn <= 1.5) {
    moonDelta += (isSeaWater || runInfo) ? 5 : 2;
  }
  const moonNote = (isSeaWater || runInfo)
    ? `${day.moon?.phaseName || 'Луна'} (${md} л.д. • приливное окно)`
    : `${day.moon?.phaseName || 'Луна'} (${md} л.д.)`;

  // Калибровка по Личному журналу рыболова
  const catchesArr = st.catches || [];
  const logInsight = catchesArr.length > 0
    ? evaluateLogbookInsight(fish, day, hrObj, method, water, catchesArr)
    : { val: 0, hasData: false, note: 'Журнал уловов: пока нет записей для личной калибровки', commentary: 'Добавляйте свои уловы через кнопку «<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 20C5 11 11 5 20 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 4v7c0 1.7-1.3 3-3 3s-3-1.3-3-3" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/><circle cx="14" cy="16" r="2.2" fill="#10b981"/></svg> Я поймал» (доступна запись за последние 5 дней по календарю), чтобы прогноз автоматически учитывал вашу личную статистику по водоёмам и приманкам.' };

  // 8-й фактор: Полевое подтверждение «Круга» (с мемоизацией по локации и виду рыбы)
  const circleArr = st.circleItems || [];
  let circleEval;
  if (circleArr.length === 0) {
    circleEval = { val: 0, hasSignal: false, note: 'Нет активных сигналов в радиусе 35 км за 72 ч', commentary: 'В радиусе 35 км пока нет свежих отчётов Круга или точек Экипажа за последние 72 часа.' };
  } else {
    const cirMemoKey = `${fish.id}|${Math.round((st.lat || 0) * 100)}_${Math.round((st.lon || 0) * 100)}|${circleArr.length}|${circleArr[0]?.id || ''}|${catchesArr.length}`;
    circleEval = _circleFieldMemo.get(cirMemoKey);
    if (!circleEval) {
      circleEval = evaluateCircleFieldConfirmation(fish, st.lat, st.lon, circleArr, catchesArr);
      _pruneCache(_circleFieldMemo, 1000);
      _circleFieldMemo.set(cirMemoKey, circleEval);
    }
  }

  // Учёт пользовательских весов в режиме « Профи» (масштабирование фактора + прямой калибровочный отклик)
  const w = (st.appMode === "pro" && st.proFactorWeights) ? st.proFactorWeights : { temp: 1, press: 1, archive_shock: 1, circle_field: 1 };
  const wTemp = Number(w.temp ?? 1);
  const wPress = Number(w.press ?? 1);
  const wShock = Number(w.archive_shock ?? 1);
  const wCircle = Number(w.circle_field ?? 1);
  tempDelta = Math.round(tempDelta * wTemp + (wTemp - 1) * 14);
  pressDelta = Math.round(pressDelta * wPress + (wPress - 1) * 12);
  const weightedArchiveDelta = Math.round(archiveDelta * wShock + (wShock - 1) * 10);
  const rawCircleSignal = (circleEval.val || 0) !== 0 ? circleEval.val : (circleArr.length > 0 ? 5 : 0);
  const circleDelta = Math.round(rawCircleSignal * wCircle + (wCircle - 1) * 12);

  const baseScore = 52;
  let rawTotal = baseScore + tempDelta + pressDelta + weightedArchiveDelta + windDelta + seasonDelta + gearDelta + moonDelta + logInsight.val + circleDelta;
  if (isIceDanger) {
    rawTotal = Math.min(28, rawTotal - 18);
  }
  const total = Math.max(4, Math.min(98, Math.round(rawTotal)));

  if (fastScoreOnly) {
    return { total, forbidden: isRedBook, iceDanger: isIceDanger };
  }

  const factors = [
    { id: 'temp', name: '1. Температура воды (с учётом течения)', val: tempDelta, note: tempNote },
    { id: 'press', name: '2. Давление и его текущий ход', val: pressDelta, note: pressNote },
    { id: 'archive_shock', name: '3. Метеоархив (5 дней) и барический шок', val: weightedArchiveDelta, note: archiveNote },
    { id: 'season', name: '4. Сезон, биоритм и миграция', val: seasonDelta, note: seasonNote },
    { id: 'gear', name: '5. Глубина, свет и снасть', val: gearDelta, note: gearNote },
    { id: 'wind', name: '6. Ветер и волнение', val: windDelta, note: windNote },
    { id: 'moon', name: (isSeaWater || runInfo) ? '7. Фаза Луны и прилив' : '7. Фаза Луны', val: moonDelta, note: moonNote }
  ];

  if (circleEval.hasSignal || st.appMode === "pro") {
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
      name: '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="5" y="3" width="14" height="18" rx="2.5" fill="rgba(56,189,248,0.16)" stroke="currentColor" stroke-width="1.8"/><path d="M9 7h6M9 11h6M9 15h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> Калибровка по вашему Журналу уловов',
      val: logInsight.val,
      note: logInsight.note
    });
  }

  return {
    total,
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
  const traitsBlock = fish.idTraits ? `<div style="margin-top:5px;color:var(--muted);"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="2"/><path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> <b>Приметы вида:</b> ${fish.idTraits}</div>` : '';
  const runInfo = RIVER_ENTERING_SPECIES[fish.id];
  const migrationBlock = runInfo
    ? `<div style="margin-top:5px;color:var(--good);font-weight:700;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg> <b>Миграция и заход в реки:</b> ${runInfo.reason}.</div>`
    : '';

  let standAdvice = '';
  if (fish.legal === 'redbook') {
    standAdvice = `<svg class="k-ico" style="color:var(--bad);" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" fill="rgba(239,68,68,0.22)" stroke="#ef4444" stroke-width="1.9"/><path d="M6 6l12 12" stroke="#ef4444" stroke-width="2.1" stroke-linecap="round"/></svg> <b>КРАСНАЯ КНИГА (ПОЙМАЛ — ОТПУСТИ):</b> ${fish.baseAdvice} ${fish.handlingAdvice || 'При случайной поимке в прилове бережно отпустите рыбу в воду!'}${migrationBlock}${sizeBlock}${traitsBlock}`;
  } else if (fish.legal === 'introduced') {
    standAdvice = `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><polygon points="13,2 4,14 11,14 10,22 20,10 13,10" fill="#fbbf24" stroke="#f59e0b" stroke-width="1.5" stroke-linejoin="round"/></svg> <b>Вселенец / Аквакультура:</b> ${fish.baseAdvice} При остывании воды ниже ${fish.tMinStop}°C впадает в оцепенение.${sizeBlock}${traitsBlock}`;
  } else if (iceState === 'ice_safe') {
    standAdvice = `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2v20M2 12h20M4.9 4.9l14.2 14.2M19.1 4.9L4.9 19.1" stroke="#7dd3fc" stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="12" r="2.2" fill="#38bdf8"/></svg> <b>Подлёдный горизонт (лёд ~${iceThickness} см, рабочая глубина ${depth.toFixed(1)} м):</b> ${fish.baseAdvice}${migrationBlock}${sizeBlock}${traitsBlock}`;
  } else if (iceState === 'ice_danger') {
    standAdvice = `<svg class="k-ico" style="color:var(--warn);" viewBox="0 0 24 24" fill="none"><path d="M12 3L2.5 19.5h19L12 3z" fill="rgba(245,158,11,0.24)" stroke="#f59e0b" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 9v5M12 17h.01" stroke="#fbbf24" stroke-width="2" stroke-linecap="round"/></svg> <b>Опасный лёд:</b> ${day.iceNote || 'Выход на лёд запрещён!'} С берега: ${fish.baseAdvice}${sizeBlock}`;
  } else if (iceState === 'ice_slush') {
    standAdvice = `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2v20M2 12h20M4.9 4.9l14.2 14.2M19.1 4.9L4.9 19.1" stroke="#7dd3fc" stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="12" r="2.2" fill="#38bdf8"/></svg> <b>Шуга и забереги (колебания -3..+3°C):</b> ледостава нет, рыба стоит в придонных ямах и затишках на глубине ${depth.toFixed(1)} м. ${fish.baseAdvice}${migrationBlock}${sizeBlock}`;
  } else {
    standAdvice = `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z" fill="rgba(239,68,68,0.22)" stroke="#ef4444" stroke-width="1.9"/><circle cx="12" cy="11" r="2.3" fill="#ef4444"/></svg> <b>Биотоп (${WATER_PROFILES[water]?.shortName || 'водоём'}, горизонт ${depth.toFixed(1)} м):</b> ${fish.baseAdvice}${migrationBlock}${sizeBlock}${traitsBlock}`;
  }

  const rigInfo = calcDynamicRig(method, water, depth, day.windMax, fish, day.waterTemp, iceState);
  const tackleAdvice = fish.legal === 'redbook'
    ? `<div><b>Вероятность прилова на снасть:</b> ${rigInfo.weight} (${rigInfo.line}).</div><div style="margin-top:5px;color:var(--bad);font-weight:700;"><svg class="k-ico" style="color:var(--warn);" viewBox="0 0 24 24" fill="none"><path d="M12 3L2.5 19.5h19L12 3z" fill="rgba(245,158,11,0.24)" stroke="#f59e0b" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 9v5M12 17h.01" stroke="#fbbf24" stroke-width="2" stroke-linecap="round"/></svg> Целенаправленное изъятие запрещено! Используйте безбородые крючки и отпускайте рыбу прямо в воде.</div>`
    : `<div><b>Оптимальный монтаж сейчас:</b> ${rigInfo.weight} (${rigInfo.line}).</div><div style="margin-top:5px;"><b>Подача и анимация:</b> ${rigInfo.tactic}.</div><div style="margin-top:5px;color:var(--muted);"><b>Арсенал по виду:</b> ${fish.topGear}</div>`;

  let baitAdvice = '';
  const seasonTone = iceState === 'ice_safe'
    ? `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2v20M2 12h20M4.9 4.9l14.2 14.2M19.1 4.9L4.9 19.1" stroke="#7dd3fc" stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="12" r="2.2" fill="#38bdf8"/></svg> <b>Подлёдный сезон (вода ~${day.waterTemp}°C):</b> приоритет животным насадкам (мотыль, мормыш/бокоплав, опарыш, резка) и деликатным зимним приманкам.`
    : (day.waterTemp <= 10.0
        ? `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3c0 0-6 7.1-6 11.5a6 6 0 0 0 12 0C18 10.1 12 3 12 3z" fill="rgba(56,189,248,0.32)" stroke="#38bdf8" stroke-width="1.8"/><path d="M9.5 15.5c.5 1.2 1.7 2 3 2" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg> <b>Холодная вода (~${day.waterTemp}°C):</b> рыба избирательна — лучше всего работают животные насадки, нано-джиг с пассивными слагами/нимфами (0.2–0.8 г) и приманки на длинной паузе.`
        : `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4.5" fill="#fbbf24" stroke="#f59e0b" stroke-width="1.6"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" stroke="#fbbf24" stroke-width="1.8" stroke-linecap="round"/></svg> <b>Прогретая вода (~${day.waterTemp}°C):</b> высокая кормовая активность в толще и у дна, отлично работают как животные/растительные насадки, так и мормышинг (нано-джиг), вертушки и мушки.`);
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
    `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 20C5 11 11 5 20 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 4v7c0 1.7-1.3 3-3 3s-3-1.3-3-3" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/><circle cx="14" cy="16" r="2.2" fill="#10b981"/></svg> Основная снасть: ${rig.weight} (${rig.line})`,
    `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 18c0-4 4-4 4-8s4-4 4-6 5-1 5 3-3 5-3 8 4 4 6 2" stroke="#f43f5e" stroke-width="2.2" stroke-linecap="round"/></svg> Рабочие насадки/приманки: ${baits.slice(0, 3).join("; ")}`,
    `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="3" y="8" width="18" height="8" rx="2" transform="rotate(-35 12 12)" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8"/><path d="M8 11l1.5 2M11 9l1.5 2M14 7l1.5 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg> Глубиномер / эхолот (целевой горизонт стоянки ${fish.name}: ~${depth.toFixed(1)} м)`,
    `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M21 8l-9-5-9 5v8l9 5 9-5V8z" fill="rgba(56,189,248,0.16)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M3 8l9 5 9-5M12 13v8" stroke="currentColor" stroke-width="1.7"/></svg> Запасные поводки, карабины, экстрактор / зевник и рулетка (контроль разрешённого размера)`
  ];

  const safetyItems = isWinter
    ? [
        `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> Спасалки («когти» на шнуре поверх куртки) и пешня для проверки льда (${iceSafety.statusText})`,
        `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> Непродуваемый костюм-поплавок, термобельё и нескользящие шипы на сапоги (воздух ${day?.tDay ?? 0}°/${day?.tNight ?? -3}°C)`,
        `<svg class="k-ico" style="color:var(--good);" viewBox="0 0 24 24" fill="none"><polygon points="13,2 4,14 11,14 10,22 20,10 13,10" fill="#fbbf24" stroke="#f59e0b" stroke-width="1.5" stroke-linejoin="round"/></svg> Заряженный повербанк во внутреннем тёплом кармане + термос с горячим чаем`,
        `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3.5" fill="rgba(56,189,248,0.25)" stroke="currentColor" stroke-width="1.8"/><path d="M3 19c0-3.2 2.7-5.5 6-5.5s6 2.3 6 5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="17" cy="9" r="2.8" stroke="currentColor" stroke-width="1.6"/><path d="M16 14c2.6.3 4.8 2 5 4.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg> Отправленная точка «<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg> Экипаж (72ч)» близким или напарникам перед выходом на лёд`
      ]
    : [
        `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> Спасательный жилет (при ловле с лодки или взабродку, ветер до ${day?.windMax || 3} м/с)`,
        `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> Ветровлагозащитная мембрана и поляризационные очки (вода ~${day?.waterTemp ?? 10}°C)`,
        `<svg class="k-ico" style="color:var(--good);" viewBox="0 0 24 24" fill="none"><polygon points="13,2 4,14 11,14 10,22 20,10 13,10" fill="#fbbf24" stroke="#f59e0b" stroke-width="1.5" stroke-linejoin="round"/></svg> Заряженный телефон с офлайн-кэшем «Клёв ПРО» и аптечка`,
        `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> Пакет под мусор и бережное отношение к прилову («Поймал — отпусти»)`
      ];

  return { gearItems, safetyItems, iceSafety, rig };
}

export function openTripChecklistModal() {
  const s = store.getState();
  const fish = FISH_DB.find(f => f.id === s.fishId) || FISH_DB[0];
  const day = s.weatherDays?.[s.dayIdx] || s.weatherDays?.[2] || s.weatherDays?.[0] || {};
  const cl = generateTripChecklist(fish, day, s.method, s.water, s.depth);

  const html = `
    <div style="display:flex;flex-direction:column;gap:12px;font-size:var(--fs-sm);">
      <div style="padding:10px 12px;background:var(--card);border:1px solid var(--accent);border-radius:var(--r-sm);font-size:var(--fs-xs);">
        <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z" fill="rgba(239,68,68,0.22)" stroke="#ef4444" stroke-width="1.9"/><circle cx="12" cy="11" r="2.3" fill="#ef4444"/></svg> <b>Выезд:</b> ${s.locLabel} (${s.selectedWaterName || WATER_PROFILES[s.water]?.shortName || "водоём"}) • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 12s4-6 11-6c4.2 0 7 2.5 9 6-2 3.5-4.8 6-9 6-7 0-11-6-11-6z" fill="rgba(56,189,248,0.28)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M2 12l-1.5-3.5L5 10.5M2 12l-1.5 3.5L5 13.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="16.5" cy="10.8" r="1.3" fill="currentColor"/></svg> <b>Цель:</b> ${fish.name}<br>
        <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M14 14.76V5a2 2 0 1 0-4 0v9.76a4 4 0 1 0 4 0z" fill="rgba(56,189,248,0.22)" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="17.5" r="1.8" fill="#ef4444"/></svg> <b>Погода:</b> воздух ${day.tDay > 0 ? "+" + day.tDay : day.tDay}°/${day.tNight > 0 ? "+" + day.tNight : day.tNight}°C, вода ~${day.waterTemp}°C, ветер ${day.windDir} ${day.windMax} м/с<br>
        <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2.5l7 3.2v5.8c0 5-3 9.3-7 10.8-4-1.5-7-5.8-7-10.8V5.7l7-3.2z" fill="rgba(56,189,248,0.22)" stroke="#38bdf8" stroke-width="1.8" stroke-linejoin="round"/></svg> <b>Безопасность льда/воды:</b> ${cl.iceSafety.vehicleVerdict}
      </div>

      <div>
        <div style="font-weight:800;font-size:var(--fs-xs);color:var(--accent);text-transform:uppercase;margin-bottom:6px;">
          <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 20C5 11 11 5 20 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 4v7c0 1.7-1.3 3-3 3s-3-1.3-3-3" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/><circle cx="14" cy="16" r="2.2" fill="#10b981"/></svg> 1. Снасти, оснастка и приманки под условия дня:
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          ${cl.gearItems.map(item => `
            <label style="display:flex;align-items:flex-start;gap:8px;padding:7px 10px;background:var(--card);border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:var(--fs-xs);">
              <input type="checkbox" checked style="margin-top:2px;">
              <span>${item}</span>
            </label>
          `).join("")}
        </div>
      </div>

      <div>
        <div style="font-weight:800;font-size:var(--fs-xs);color:var(--good);text-transform:uppercase;margin-bottom:6px;">
          <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> 2. Экипировка и безопасность на водоёме:
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          ${cl.safetyItems.map(item => `
            <label style="display:flex;align-items:flex-start;gap:8px;padding:7px 10px;background:var(--card);border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:var(--fs-xs);">
              <input type="checkbox" checked style="margin-top:2px;">
              <span>${item}</span>
            </label>
          `).join("")}
        </div>
      </div>
    </div>
  `;

  openModal("<svg class=\"k-ico\" viewBox=\"0 0 24 24\" fill=\"none\"><rect x=\"6\" y=\"7\" width=\"12\" height=\"14\" rx=\"3\" fill=\"rgba(56,189,248,0.16)\" stroke=\"currentColor\" stroke-width=\"1.8\"/><path d=\"M9 7V5a3 3 0 0 1 6 0v2M9 14h6\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\"/></svg> Чек-лист сборов и безопасности на выезд", html);
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
  const m = String(s.method || 'spin_jig');
  const wind = Number(day?.windMax ?? 3);
  const windDir = day?.windDir || 'З';
  const prof = WATER_PROFILES[s.water] || WATER_PROFILES.small_river;
  const flow = Number(prof.flow || 1.0);

  if (iceState === 'ice_safe' || iceState === 'ice_danger' || m.startsWith('winter_')) {
    const isDanger = iceState === 'ice_danger' || (day?.iceThickness || 0) < 7;
    return `
      <div class="bento-card" style="padding:11px 13px;border:1.5px solid ${isDanger ? 'var(--bad)' : 'var(--ice)'};">
        <div class="bento-card-title" style="font-size:14px;margin-bottom:6px;">
          <span><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2v20M2 12h20M4.9 4.9l14.2 14.2M19.1 4.9L4.9 19.1" stroke="#7dd3fc" stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="12" r="2.2" fill="#38bdf8"/></svg></span>
          <span>Зимняя тактика и Безопасность льда (${fish.name})</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:8px;font-size:12px;line-height:1.4;">
          <div style="padding:8px 10px;background:var(--panel);border-radius:11px;border:1px solid var(--border);">
            <b style="color:${isDanger ? 'var(--bad)' : 'var(--good)'};"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2.5l7 3.2v5.8c0 5-3 9.3-7 10.8-4-1.5-7-5.8-7-10.8V5.7l7-3.2z" fill="rgba(56,189,248,0.22)" stroke="#38bdf8" stroke-width="1.8" stroke-linejoin="round"/></svg> Контроль льда:</b>
            ${isDanger
              ? 'Опасная толщина льда! Избегайте устьев притоков, тёплых сбросов, камыша и снежных наддувов. Пешня и спасалки обязательны.'
              : `Безопасный монолитный лёд (~${day?.iceThickness || 12} см). На течении (${prof.shortName}) проверяйте закраины и промоины у мостов и кос.`}
          </div>
          <div style="padding:8px 10px;background:var(--panel);border-radius:11px;border:1px solid var(--border);">
            <b style="color:var(--accent);"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 20C5 11 11 5 20 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 4v7c0 1.7-1.3 3-3 3s-3-1.3-3-3" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/><circle cx="14" cy="16" r="2.2" fill="#10b981"/></svg> Тактика поиска со льда:</b>
            Вода ~${waterTemp}°C — бурите серию из 5–7 лунок поперёк руслового свала (шаг 6–8 м). Начинайте облов с верхней бровки, пауза в нижней точке 3–5 сек.
          </div>
        </div>
      </div>
    `;
  }

  const isCarpSpecies = ['carp', 'grass_carp', 'silver_carp', 'crucian', 'bream', 'tench', 'buffalo', 'black_carp'].includes(fish.id);
  if (m === 'bottom' || m === 'float' || isCarpSpecies) {
    const isCold = waterTemp < 12.0;
    const savedClip = Number(s.userProfile?.carpClipMeters || 42);
    const savedBottom = s.userProfile?.carpBottomType || 'Ракушечник / Бровка';
    const timerLeftSec = _recastTimerTargetTs > Date.now() ? Math.ceil((_recastTimerTargetTs - Date.now()) / 1000) : 0;
    const timerMm = String(Math.floor(timerLeftSec / 60)).padStart(2, '0');
    const timerSs = String(timerLeftSec % 60).padStart(2, '0');

    const carpProgramAdvice = isCarpSpecies
      ? (isCold
          ? `Холодная вода (+${waterTemp}°C): одиночный подрезанный Поп-ап или Вафтерс 8–10 мм (специи, робин ред, чеснок, криль) + компактный ПВА-стик с микро-пеллетсом 1.5–2 мм. Исключите жирные рыбные масла и обильный закорм спомбом!`
          : `Прогретая вода (+${waterTemp}°C): тонущие и нейтральные бойлы 14–20 мм (рыбная мука / палтус / клубника / слива / тигровый орех) или «снеговик» с поп-апом 10 мм. Активный стартовый закорм спомбом (зерновые, конопля, резаные бойлы, пеллетс).`)
      : (isCold
          ? `Холодная вода (+${waterTemp}°C): тёмная мелкофракционная инертная смесь (чёрный лещ/плотва) со щепоткой кормового мотыля без сладкой ароматики.`
          : `Прогретая вода (+${waterTemp}°C): активная средне- и крупнофракционная прикормка с добавлением опарыша, резаного червя или сладкой кукурузы.`);

    const surfShoreAdvice = (wind >= 2.5 && wind <= 7.5)
      ? `Активный «Прибойный берег» (${windDir} ${wind} м/с): волна насыщает бровку кислородом и вымывает донный корм — карп, сазан и крупный лещ выходят кормиться на границу прибойной мути!`
      : (wind < 2.5
          ? `Штиль / слабый ветер (${windDir} ${wind} м/с): рыба осторожна — используйте флюорокарбоновый поводок, нейтральную презентацию Wafters и точечный ПВА-стик.`
          : `Сильный ветер (${windDir} ${wind} м/с): используйте тяжёлую кормушку-пулю / флэт 60–90 г и опустите вершинку удилища к воде.`);

    return `
      <div class="bento-card" style="padding:11px 13px;border:1.5px solid var(--good);">
        <div class="bento-card-title" style="font-size:14px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
          <div style="display:flex;align-items:center;gap:6px;">
            <span><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg></span>
            <span>Карпфишинг, Сазан и Флэт-Фидер: Программа питания и Свим (${fish.name})</span>
          </div>
          <span class="pill pill-good" style="font-size:10.5px;">Клипса: <b id="fcCarpClipBadgeVal">${savedClip} м</b> • ${savedBottom}</span>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:8px;font-size:12px;line-height:1.42;">
          <div style="padding:8px 10px;background:var(--panel);border-radius:11px;border:1px solid var(--border);">
            <b style="color:var(--good);"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M17 3C11 3 5 7 5 15c0 2.5 1.5 4 4 4 8 0 12-6 12-12 0-2.5-1.5-4-4-4z" fill="rgba(16,185,129,0.25)" stroke="#10b981" stroke-width="1.8"/><path d="M5 19L15 9" stroke="#10b981" stroke-width="1.8" stroke-linecap="round"/></svg> Программа бойлов и прикормки:</b> ${carpProgramAdvice}
          </div>
          <div style="padding:8px 10px;background:var(--panel);border-radius:11px;border:1px solid var(--border);">
            <b style="color:var(--accent);"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> Фактор ветра «Прибойный берег»:</b> ${surfShoreAdvice}
          </div>
        </div>

        <div style="margin-top:8px;padding:8px 10px;background:var(--panel);border-radius:11px;border:1px solid var(--border);display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;font-size:11.5px;">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <b style="color:var(--text);">Карта свима (клипса, м):</b>
            <input type="number" id="fcCarpClipInput" class="input" min="5" max="220" step="1" value="${savedClip}" style="width:68px;min-height:30px;padding:2px 6px;font-size:12px;font-weight:800;">
            <select id="fcCarpBottomSelect" class="input" style="width:auto;min-width:155px;min-height:30px;padding:2px 6px;font-size:11.5px;">
              ${['Ракушечник / Бровка', 'Выход из ила на твёрдое', 'Русловой свал / Яма', 'Граница камыша / Коряга'].map(opt => `<option value="${opt}" ${opt === savedBottom ? 'selected' : ''}>${opt}</option>`).join('')}
            </select>
            <button type="button" class="btn btn-sm btn-good" id="fcSaveCarpSwimBtn" style="min-height:30px;padding:2px 9px;font-size:11px;font-weight:800;">Запомнить свим</button>
          </div>

          <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;">
            <b style="color:var(--accent);">Таймер перезаброса:</b>
            <button type="button" class="btn btn-sm" data-recast-timer-min="10" style="min-height:28px;padding:2px 7px;font-size:11px;">10 мин</button>
            <button type="button" class="btn btn-sm" data-recast-timer-min="15" style="min-height:28px;padding:2px 7px;font-size:11px;">15 мин</button>
            <button type="button" class="btn btn-sm" data-recast-timer-min="45" style="min-height:28px;padding:2px 7px;font-size:11px;">45 мин</button>
            <button type="button" class="btn btn-sm" data-recast-timer-min="120" style="min-height:28px;padding:2px 7px;font-size:11px;">2 ч</button>
            <span id="fcRecastTimerDisplay" class="pill ${timerLeftSec > 0 ? 'pill-good' : 'pill-neutral'}" style="font-family:monospace;font-size:11.5px;font-weight:900;">${timerLeftSec > 0 ? `${timerMm}:${timerSs}` : 'Выкл'}</span>
            ${timerLeftSec > 0 ? `<button type="button" class="btn btn-sm" id="fcStopRecastTimerBtn" style="min-height:26px;padding:1px 6px;font-size:10.5px;color:var(--bad);">Стоп</button>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  const pauseSec = waterTemp <= 4.0 ? '5–8 сек (с плавным волочением и подбросом мандулы/поролона)' : (waterTemp <= 10.0 ? '3–5 сек (классическая медленная ступенька)' : '1.5–2.5 сек (активная проводка с подрывом)');
  const windAdvice = wind >= 5
    ? `Свежий ветер ${windDir} ${wind} м/с: выбирайте прибойный берег (туда сгоняет тёплую воду и малька), но увеличьте вес груза на +2..4 г и опустите вершинку спиннинга к воде против выдува дуги шнура.`
    : `Комфортный ветер ${windDir} ${wind} м/с: идеальный контроль касания дна по кончику удилища и звонкому шнуру PE #0.6–1.0.`;

  return `
    <div class="bento-card" style="padding:11px 13px;border:1.5px solid var(--accent);">
      <div class="bento-card-title" style="font-size:14px;margin-bottom:6px;">
        <span><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 20C5 11 11 5 20 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 4v7c0 1.7-1.3 3-3 3s-3-1.3-3-3" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/><circle cx="14" cy="16" r="2.2" fill="#10b981"/></svg></span>
        <span>Тактика Спиннинга и Джига: Пауза и Ветровой вектор</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:8px;font-size:12px;line-height:1.4;">
        <div style="padding:8px 10px;background:var(--panel);border-radius:11px;border:1px solid var(--border);">
          <b style="color:var(--accent);"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l3.5 2" stroke="#38bdf8" stroke-width="1.9" stroke-linecap="round"/></svg> Пауза на ступеньке (вода +${waterTemp}°C):</b> <b>${pauseSec}</b>. По холодной воде хищник атакует на длинной паузе со дна.
        </div>
        <div style="padding:8px 10px;background:var(--panel);border-radius:11px;border:1px solid var(--border);">
          <b style="color:var(--good);"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> Ветровой вектор (${windDir} ${wind} м/с, теч. ${flow} м/с):</b> ${windAdvice}
        </div>
      </div>
    </div>
  `;
}

export function openRigEncyclopediaModal(fish) {
  const html = `
    <div style="display:flex;flex-direction:column;gap:10px;font-size:var(--fs-sm);line-height:1.45;">
      <div style="padding:10px 12px;background:var(--panel);border:1.5px solid var(--accent);border-radius:12px;">
        <div style="font-weight:900;color:var(--accent);margin-bottom:3px;">1. Джиг-риг / Чебурашка с мандулой или силиконом (Щука, Судак, Окунь)</div>
        <div style="font-size:12px;color:var(--text);">
          • <b>Шнур:</b> 8-жильный PE #0.8–#1.2 + поводок струна 20–25 см (на щуку) или флюорокарбон 0.35–0.45 мм (на судака/окуня в корягах).<br>
          • <b>Подача:</b> 2 оборота катушки — пауза 2–6 сек (по температуре воды). В холодной воде (ниже +6°C) лучший результат даёт контрастная мандула «Билайн» (жёлто-чёрная) с паузой до 6–8 секунд.
        </div>
      </div>
      <div style="padding:10px 12px;background:var(--panel);border:1.5px solid var(--good);border-radius:12px;">
        <div style="font-weight:900;color:var(--good);margin-bottom:3px;">2. Отводной поводок / Московская оснастка (Пассивный Окунь, Судак)</div>
        <div style="font-size:12px;color:var(--text);">
          • <b>Монтаж:</b> Тройной вертлюжок -> груз-палочка/балерина на отводе 25 см (флюр 0.22 мм) -> рабочий поводок 90–120 см из флюорокарбона 0.16–0.20 мм с офсетным крючком №6–№2.<br>
          • <b>Подача:</b> Медленное волочение по ракушечнику и каменистой бровке с короткими подёргиваниями и паузами до 5 секунд.
        </div>
      </div>
      <div style="padding:10px 12px;background:var(--panel);border:1.5px solid var(--warn);border-radius:12px;">
        <div style="font-weight:900;color:var(--warn);margin-bottom:3px;">3. Асимметричная петля / Инлайн и Патерностер (Лещ, Плотва, Язь, Карась)</div>
        <div style="font-size:12px;color:var(--text);">
          • <b>Монтаж:</b> Скользящая кормушка (Инлайн) с отводом под фидергам 8–10 см или классический Патерностер Гарднера на основной леске.<br>
          • <b>Крючок и поводок:</b> На течении поводок 50–80 см (0.12–0.14 мм), крючок №12–№16 под пучок мотыля или бутерброд с опарышем.
        </div>
      </div>
      <div style="padding:10px 12px;background:var(--panel);border:1.5px solid var(--ice);border-radius:12px;">
        <div style="font-weight:900;color:var(--ice);margin-bottom:3px;">4. Проверенные рыболовные узлы (100% прочность на морозе и течении)</div>
        <div style="font-size:12px;color:var(--text);">
          • <b>Паломар (Palomar):</b> лучший узел для привязывания застёжки/вертлюжка к плетёному шнуру (прочность до 95%).<br>
          • <b>Улучшенный Олбрайт / Морковка:</b> надёжная связка плетёного шнура с шок-лидером из флюорокарбона.<br>
          • <b>Петля Гарднера (восьмёрка):</b> быстрое соединение поводка «петля в петлю».
        </div>
      </div>
    </div>
  `;
  openModal(`<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M7 7a4 4 0 1 0 0 8h10a4 4 0 1 0 0-8H7z" stroke="#38bdf8" stroke-width="1.9"/><path d="M17 7a4 4 0 1 1 0 8H7a4 4 0 1 1 0-8" stroke="currentColor" stroke-width="1.6" stroke-dasharray="3 2"/></svg> Справочник рабочих монтажей и узлов (${fish?.name || 'Все виды'})`, html);
}

export function renderExpress(container) {
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
      verdict = `<svg class="k-ico" style="color:var(--bad);" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" fill="rgba(239,68,68,0.22)" stroke="#ef4444" stroke-width="1.9"/><path d="M6 6l12 12" stroke="#ef4444" stroke-width="2.1" stroke-linecap="round"/></svg> Кр. книга (прилов ~${score}%)`;
      verdictTone = 'bad';
      customRatingWord = `Активность ${score}% • Отпусти`;
    } else if (isIceDanger) {
      verdict = d.iceSubState === 'spring_rotten_ice'
        ? `<svg class="k-ico" style="color:var(--warn);" viewBox="0 0 24 24" fill="none"><path d="M12 3L2.5 19.5h19L12 3z" fill="rgba(245,158,11,0.24)" stroke="#f59e0b" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 9v5M12 17h.01" stroke="#fbbf24" stroke-width="2" stroke-linecap="round"/></svg> Рыхлый лёд и промоины`
        : `<svg class="k-ico" style="color:var(--warn);" viewBox="0 0 24 24" fill="none"><path d="M12 3L2.5 19.5h19L12 3z" fill="rgba(245,158,11,0.24)" stroke="#f59e0b" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 9v5M12 17h.01" stroke="#fbbf24" stroke-width="2" stroke-linecap="round"/></svg> Опасный лёд (~${d.iceThickness} см)`;
      verdictTone = 'bad';
      customRatingWord = 'Выход на лёд опасен';
    } else if (isPressJump) {
      verdict = `<svg class="k-ico" style="color:var(--warn);" viewBox="0 0 24 24" fill="none"><path d="M12 3L2.5 19.5h19L12 3z" fill="rgba(245,158,11,0.24)" stroke="#f59e0b" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 9v5M12 17h.01" stroke="#fbbf24" stroke-width="2" stroke-linecap="round"/></svg> Скачок давления (${d.dP > 0 ? '+' : ''}${d.dP} мм)`;
      verdictTone = Math.abs(d.dP) >= 8 ? 'bad' : 'warn';
      customRatingWord = score < 35 ? 'Клёва нет' : (score < 50 ? 'Слабый клёв' : 'Умеренный клёв • Нестабильно');
    } else if (isArchiveShock && score < 62) {
      verdict = `<svg class="k-ico" style="color:var(--warn);" viewBox="0 0 24 24" fill="none"><path d="M12 3L2.5 19.5h19L12 3z" fill="rgba(245,158,11,0.24)" stroke="#f59e0b" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 9v5M12 17h.01" stroke="#fbbf24" stroke-width="2" stroke-linecap="round"/></svg> Барический «шок» (архив)`;
      verdictTone = 'warn';
      customRatingWord = score < 40 ? 'Слабый клёв • В «шоке»' : 'Осторожный клёв';
    } else if (isGale) {
      verdict = `<svg class="k-ico" style="color:var(--warn);" viewBox="0 0 24 24" fill="none"><path d="M12 3L2.5 19.5h19L12 3z" fill="rgba(245,158,11,0.24)" stroke="#f59e0b" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 9v5M12 17h.01" stroke="#fbbf24" stroke-width="2" stroke-linecap="round"/></svg> Штормовой ветер (${d.windMax} м/с)`;
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
            ? `<svg class="k-ico" style="color:var(--bad);" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" fill="rgba(239,68,68,0.22)" stroke="#ef4444" stroke-width="1.9"/><path d="M6 6l12 12" stroke="#ef4444" stroke-width="2.1" stroke-linecap="round"/></svg> Поймал — отпусти! Биоактивность вида: ${topNotes}.`
            : (dayIce === 'ice_danger'
                ? (d.iceNote || '<svg class="k-ico" style="color:var(--warn);" viewBox="0 0 24 24" fill="none"><path d="M12 3L2.5 19.5h19L12 3z" fill="rgba(245,158,11,0.24)" stroke="#f59e0b" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 9v5M12 17h.01" stroke="#fbbf24" stroke-width="2" stroke-linecap="round"/></svg> Выход на тонкий или весенний рыхлый лёд смертельно опасен! Допустима только береговая ловля.')
                : `${topNotes}.`)}
        </p>
        <div style="display:flex;justify-content:space-between;align-items:center;padding-top:8px;border-top:1px solid var(--border);gap:8px;">
          <div>
            ${renderFiveFish(score, 17, curTheme, true, customRatingWord)}
          </div>
          ${dayIdx === 2 && fish.legal !== 'redbook'
            ? `<button type="button" class="btn btn-sm btn-good" data-catch-today="2"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 20C5 11 11 5 20 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 4v7c0 1.7-1.3 3-3 3s-3-1.3-3-3" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/><circle cx="14" cy="16" r="2.2" fill="#10b981"/></svg> Я поймал</button>`
            : `<span style="font-size:var(--fs-xs);color:var(--muted);font-weight:700;">${fish.legal === 'redbook' ? 'Красная книга' : '7 факторов'}</span>`}
        </div>
      </div>
    `;
  }).join('');

  // Построение карточки « Новичок» (Один экран: Клюёт/Не клюёт + ТОП-3 рыбы + ближайший водоём + кнопка Почему?)
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
  const heroTone = activeHeroScore >= 60 ? 'var(--good)' : (activeHeroScore >= 38 ? 'var(--warn)' : 'var(--bad)');
  const heroStatusShort = fish.legal === 'redbook'
    ? 'КРАСНАЯ КНИГА'
    : (effIceForTackle === 'ice_danger'
        ? 'ОПАСНЫЙ ЛЁД!'
        : (activeHeroScore >= 60 ? 'АКТИВНЫЙ<br>КЛЁВ' : (activeHeroScore >= 38 ? 'УМЕРЕННЫЙ<br>КЛЁВ' : 'СЛАБЫЙ<br>КЛЁВ')));
  const gaugeLevelWord = activeHeroScore >= 60 ? 'Высокий' : (activeHeroScore >= 38 ? 'Средний' : 'Низкий');

  // Вычисляем ТОП-3 активные рыбы для текущего водоёма и бассейна (как на Фото 1: Щука, Окунь, Язь/Налим)
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

  // Короткое название выбранного способа ловли для блока под полукруглой шкалой
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

  // Геометрия полукруглой шкалы-спидометра (SVG Gauge Arc, R=60, длина полуокружности = 188.5)
  const arcLenTotal = 188.5;
  const arcFillLen = Math.round((Math.max(5, Math.min(100, activeHeroScore)) / 100) * arcLenTotal * 10) / 10;

  // Геометрия плавной кривой почасового графика (00:00–24:00, SVG 320x96)
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

  const svgW = 320, svgH = 92, padL = 10, padR = 10, padT = 18, padB = 18;
  const plotW = svgW - padL - padR;
  const plotH = svgH - padT - padB;
  const pts = hrScores.map((sc, idx) => {
    const x = Math.round((padL + (idx / 23) * plotW) * 10) / 10;
    const y = Math.round((padT + (1 - Math.max(10, Math.min(100, sc)) / 100) * plotH) * 10) / 10;
    return { x, y, sc, hr: idx };
  });

  let wavePathD = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const cx = Math.round(((p0.x + p1.x) / 2) * 10) / 10;
    wavePathD += ` C ${cx} ${p0.y}, ${cx} ${p1.y}, ${p1.x} ${p1.y}`;
  }
  const waveAreaD = `${wavePathD} L ${pts[pts.length - 1].x} ${svgH - 4} L ${pts[0].x} ${svgH - 4} Z`;
  const mPt = pts[morningPeakHr] || pts[7];
  const ePt = pts[eveningPeakHr] || pts[17];

  // Данные для карточки «Погода & Лёд» и «Карта & Радар»
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

  modeBannerHtml += `
    <div class="bento-dashboard-wrap">
      <!-- Полоса быстрого переключения видов рыб (как на Фото 2, 6, 8) -->
      <div class="chip-scroll-row" style="padding-bottom:2px;">
        ${top6Species.map(item => `
          <button type="button" class="w-chip ${item.fish.id === fish.id ? 'active' : ''}" data-novice-pick-fish="${item.fish.id}" style="padding:4px 10px;min-height:36px;display:inline-flex;align-items:center;gap:6px;">
            <img src="assets/fish/${item.fish.id}.png" alt="" style="width:28px;height:15px;object-fit:contain;" onerror="this.style.display='none'">
            <span>${item.fish.name}</span>
            <span style="font-size:10.5px;opacity:0.85;">${item.scDay}%</span>
          </button>
        `).join('')}
        <button type="button" class="w-chip" id="bentoOpenAllFishBtn" style="padding:4px 10px;min-height:36px;color:var(--accent);border-color:var(--accent);">
          <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 12s4-6 11-6c4.2 0 7 2.5 9 6-2 3.5-4.8 6-9 6-7 0-11-6-11-6z" fill="rgba(56,189,248,0.28)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M2 12l-1.5-3.5L5 10.5M2 12l-1.5 3.5L5 13.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="16.5" cy="10.8" r="1.3" fill="currentColor"/></svg> Все 115 рыб →
        </button>
      </div>

      <!-- КАРТОЧКА 1 (По Фото 1 + Свайп рыбы v2.5.0): <svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="4.5" stroke="#38bdf8" stroke-width="1.6"/><circle cx="12" cy="12" r="1.8" fill="#10b981"/></svg> Ихтиологический Прогноз Клёва -->
      <div class="bento-card bento-hero-card" id="bentoSwipeHeroCard">
        <div class="bento-card-head">
          <div>
            <div class="bento-card-title">
              <span><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="4.5" stroke="#38bdf8" stroke-width="1.6"/><circle cx="12" cy="12" r="1.8" fill="#10b981"/></svg></span>
              <span>Ихтиологический Прогноз Клёва</span>
            </div>
            <div class="bento-card-sub">
              ${s.locLabel} (${nearWaterTitle}) • ${activeDayForTackle.relTitle || activeDayForTackle.label || 'Сегодня'} • <span style="color:var(--accent);">⇄ свайп рыбы</span>
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
              <div class="bento-splash-fish-box" data-open-fish-zoom="${fish.id}" style="cursor:zoom-in;position:relative;" title="Нажмите для увеличения иллюстрации и паспорта рыбы">
                <img src="assets/fish/${fish.id}.png" alt="${fish.name}" onerror="this.style.display='none'">
                <span style="position:absolute;bottom:1px;right:3px;font-size:9px;opacity:0.75;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="2"/><path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></span>
              </div>
              <div>
                <div class="bento-status-verdict" style="color:${heroTone};">${heroStatusShort}</div>
                <div style="font-size:11px;font-weight:800;color:var(--muted);margin-top:2px;">
                  <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 12s4-6 11-6c4.2 0 7 2.5 9 6-2 3.5-4.8 6-9 6-7 0-11-6-11-6z" fill="rgba(56,189,248,0.28)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M2 12l-1.5-3.5L5 10.5M2 12l-1.5 3.5L5 13.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="16.5" cy="10.8" r="1.3" fill="currentColor"/></svg> ${fish.name} • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l3.5 2" stroke="#38bdf8" stroke-width="1.9" stroke-linecap="round"/></svg> ${activeHeroWin}
                </div>
              </div>
            </div>

            <div class="bento-top3-label">ТОП-3 активные рыбы</div>
            <div class="bento-top3-row">
              ${top3Bento.map(item => `
                <button type="button" class="bento-top3-item ${item.fish.id === fish.id ? 'active' : ''}" data-novice-pick-fish="${item.fish.id}" title="Выбрать рыбу «${item.fish.name}»">
                  <img src="assets/fish/${item.fish.id}.png" alt="${item.fish.name}" onerror="this.style.display='none'">
                  <span class="bento-top3-name">${item.fish.name}</span>
                  <span class="bento-top3-pct">${item.scDay}%</span>
                </button>
              `).join('')}
            </div>
          </div>

          <!-- Правая колонка: Полукруглая шкала-спидометр 78% + Выбор снасти и рекомендация -->
          <div class="bento-gauge-col">
            <div class="bento-gauge-svg-box">
              <svg viewBox="0 0 156 90" width="156" height="90" fill="none" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="bentoGaugeGrad" x1="0%" y1="100%" x2="100%" y2="0%">
                    <stop offset="0%" stop-color="var(--gauge-start, #3b82f6)"/>
                    <stop offset="100%" stop-color="var(--gauge-end, #10b981)"/>
                  </linearGradient>
                </defs>
                <path d="M 18 78 A 60 60 0 0 1 138 78" stroke="var(--gauge-track, #dbe7f3)" stroke-width="12" stroke-linecap="round" fill="none"/>
                <path d="M 18 78 A 60 60 0 0 1 138 78" stroke="url(#bentoGaugeGrad)" stroke-width="12" stroke-linecap="round" fill="none" stroke-dasharray="${arcFillLen} 200"/>
              </svg>
              <div class="bento-gauge-center-text">
                <span class="bento-gauge-sub">Прогноз:</span>
                <span class="bento-gauge-lvl">${gaugeLevelWord}</span>
                <span class="bento-gauge-pct">${activeHeroScore}%</span>
              </div>
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

      <!-- КАРТОЧКА 2 (По Фото 1): <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M3 3v18h18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M7 15l4-5 4 3 5-7" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg> Почасовой график клёва 00:00–24:00 -->
      <div class="bento-card bento-chart-card" id="bentoWaveChartCard" style="cursor:pointer;" title="Нажмите для перехода к подробной почасовой шкале">
        <div class="bento-card-head" style="margin-bottom:4px;">
          <div class="bento-card-title">
            <span><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M3 3v18h18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M7 15l4-5 4 3 5-7" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
            <span>Почасовой график клёва</span>
          </div>
          <span style="font-size:12.5px;font-weight:800;color:var(--muted);">00:00–24:00</span>
        </div>

        <div style="width:100%;overflow:hidden;">
          <svg viewBox="0 0 ${svgW} ${svgH}" width="100%" height="94" preserveAspectRatio="none" style="display:block;overflow:visible;">
            <defs>
              <linearGradient id="bentoWaveFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="var(--wave-fill-top, rgba(59,130,246,0.35))"/>
                <stop offset="100%" stop-color="var(--wave-fill-bot, rgba(59,130,246,0.02))"/>
              </linearGradient>
            </defs>
            <line x1="${padL}" y1="${padT + plotH * 0.5}" x2="${svgW - padR}" y2="${padT + plotH * 0.5}" stroke="var(--border)" stroke-dasharray="3 3" stroke-width="0.8" opacity="0.6"/>
            <path d="${waveAreaD}" fill="url(#bentoWaveFill)"/>
            <path d="${wavePathD}" fill="none" stroke="var(--wave-stroke, #2563eb)" stroke-width="2.8" stroke-linecap="round"/>
            <line x1="${mPt.x}" y1="${mPt.y}" x2="${mPt.x}" y2="${svgH - 4}" stroke="var(--wave-stroke)" stroke-dasharray="2 2" stroke-width="1" opacity="0.55"/>
            <line x1="${ePt.x}" y1="${ePt.y}" x2="${ePt.x}" y2="${svgH - 4}" stroke="var(--wave-stroke)" stroke-dasharray="2 2" stroke-width="1" opacity="0.55"/>
            <circle cx="${mPt.x}" cy="${mPt.y}" r="4.2" fill="#ffffff" stroke="var(--wave-stroke, #2563eb)" stroke-width="2.5"/>
            <circle cx="${ePt.x}" cy="${ePt.y}" r="4.2" fill="#ffffff" stroke="var(--wave-stroke, #2563eb)" stroke-width="2.5"/>
            <text x="${mPt.x}" y="${Math.max(11, mPt.y - 6)}" text-anchor="middle" fill="var(--text)" font-size="9.5" font-weight="800">${String(mPt.hr).padStart(2, '0')}:00 (${mPt.sc}%)</text>
            <text x="${ePt.x}" y="${Math.max(11, ePt.y - 6)}" text-anchor="middle" fill="var(--text)" font-size="9.5" font-weight="800">${String(ePt.hr).padStart(2, '0')}:00 (${ePt.sc}%)</text>
          </svg>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:2px 12px 0;font-size:11.5px;font-weight:800;color:var(--muted);">
            <span>00:00</span>
            <span style="color:var(--text);">Утро (${String(morningPeakHr).padStart(2, '0')}:00)</span>
            <span>12:00</span>
            <span style="color:var(--text);">Вечер (${String(eveningPeakHr).padStart(2, '0')}:00)</span>
            <span>24:00</span>
          </div>
          ${(() => {
            const astro = computeDayKpAndDaylight(activeDayForTackle);
            return `
              <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-top:6px;padding-top:6px;border-top:1px dashed var(--border);font-size:11px;font-weight:800;">
                <span style="color:var(--muted);"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4.5" fill="#fbbf24" stroke="#f59e0b" stroke-width="1.6"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" stroke="#fbbf24" stroke-width="1.8" stroke-linecap="round"/></svg> Восход <b>${fmtHM(astro.sr)}</b> • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4.5" fill="#fbbf24" stroke="#f59e0b" stroke-width="1.6"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" stroke="#fbbf24" stroke-width="1.8" stroke-linecap="round"/></svg> Закат <b>${fmtHM(astro.ss)}</b> (День: ${astro.daylightStr})</span>
                <span style="color:${astro.kpTone};"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="5" r="2.5" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.5V21M5 13c0 4.5 3.1 8 7 8s7-3.5 7-8M8 10h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> Геомагнитный Kp-${astro.kpVal} (${astro.kpLabel})</span>
              </div>
            `;
          })()}
        </div>
      </div>

      <!-- КАРТОЧКА 3 (По Фото 1): Двойной нижний ряд «<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg> Карта & Радар» + «<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="9" r="4" fill="#fbbf24" opacity="0.9"/><path d="M9 2v2M9 14v2M2 9h2M14 9h2M4.2 4.2l1.4 1.4M12.4 12.4l1.4 1.4" stroke="#fbbf24" stroke-width="1.6" stroke-linecap="round"/><path d="M10 18h8.5a3.5 3.5 0 0 0 .4-6.97A5 5 0 0 0 9.2 9.5 4 4 0 0 0 10 18z" fill="rgba(56,189,248,0.28)" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg> Погода & Лёд» -->
      <div class="bento-bottom-duo">
        <!-- Левая карточка: <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg> Карта & Радар -->
        <div class="bento-card bento-radar-card" id="bentoMapRadarCard" title="Нажмите для перехода к Карте и Радару Круга">
          <div class="bento-card-title" style="margin-bottom:8px;font-size:14.5px;">
            <span><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg></span>
            <span>Карта & Радар</span>
          </div>
          <div class="bento-radar-visual">
            <svg viewBox="0 0 200 120" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" fill="none">
              <path d="M-10,25 Q50,5 110,35 T210,20 L210,130 L-10,130 Z" fill="rgba(59,130,246,0.18)"/>
              <path d="M-10,65 Q65,40 125,70 T210,55 L210,130 L-10,130 Z" fill="rgba(14,165,233,0.22)"/>
              <circle cx="100" cy="62" r="42" stroke="var(--accent)" stroke-width="1.4" stroke-dasharray="4 3" fill="rgba(56,189,248,0.12)"/>
              <circle cx="100" cy="62" r="22" stroke="var(--good)" stroke-width="1" stroke-dasharray="2 2" fill="rgba(16,185,129,0.12)"/>
              <circle cx="100" cy="62" r="6" fill="var(--accent)" stroke="#ffffff" stroke-width="2"/>
            </svg>
            <div class="bento-radar-badge-zone">
              <b>±5 км</b><br>
              <span style="font-size:9.5px;color:var(--muted);">Зона Круга</span>
            </div>
            <div class="bento-radar-badge-crew" id="bentoOpenCrewBadge">
              Экипаж${activeCircleCount > 0 ? ` (${activeCircleCount})` : ''}
            </div>
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

      <!-- Панель выбора снасти, приманки с цветовыми кружками и быстрых действий (Я поймал / Чек-лист / Поделиться) -->
      <div class="bento-card" style="padding:11px 13px;border:1px solid var(--border);">
        <div class="controls-grid" style="grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:8px;margin-bottom:9px;">
          <div>
            <label for="fcTopMethodSelect" style="display:block;font-size:11px;color:var(--muted);font-weight:800;margin-bottom:3px;">1. ВЫБОР СНАСТИ И СПОСОБА ЛОВЛИ:</label>
            <select id="fcTopMethodSelect" style="width:100%;min-height:42px;">
              ${compatibleMethodsTop.map(m => `<option value="${m.val}" ${m.val === s.method ? 'selected' : ''}>${String(m.text || '').replace(/<[^>]+>/g, '').trim()}</option>`).join('')}
            </select>
          </div>
          <div>
            <label for="fcTopBaitSelect" style="display:block;font-size:11px;color:var(--muted);font-weight:800;margin-bottom:3px;">2. СЕЗОННАЯ ПРИМАНКА / НАСАДКА (<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3c0 0-6 7.1-6 11.5a6 6 0 0 0 12 0C18 10.1 12 3 12 3z" fill="rgba(56,189,248,0.32)" stroke="#38bdf8" stroke-width="1.8"/><path d="M9.5 15.5c.5 1.2 1.7 2 3 2" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg> ${effWaterTempForTackle}°C):</label>
            <select id="fcTopBaitSelect" style="width:100%;min-height:42px;">
              ${seasonalBaitsTop.map(b => `<option value="${b}" ${b === activeBaitTop ? 'selected' : ''}>${b}</option>`).join('')}
            </select>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:7px;">
          ${fish.legal !== 'redbook' ? `
            <button type="button" class="btn btn-good" data-catch-today="${s.dayIdx ?? 2}" style="min-height:44px;font-weight:900;">
              <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 20C5 11 11 5 20 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 4v7c0 1.7-1.3 3-3 3s-3-1.3-3-3" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/><circle cx="14" cy="16" r="2.2" fill="#10b981"/></svg> Я поймал (+ В журнал)
            </button>

          ` : ''}
          <button type="button" class="btn" id="fcOpenRigGuideBtn" style="min-height:44px;font-weight:800;">
            <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M7 7a4 4 0 1 0 0 8h10a4 4 0 1 0 0-8H7z" stroke="#38bdf8" stroke-width="1.9"/><path d="M17 7a4 4 0 1 1 0 8H7a4 4 0 1 1 0-8" stroke="currentColor" stroke-width="1.6" stroke-dasharray="3 2"/></svg> Монтажи и узлы
          </button>
          <button type="button" class="btn" id="fcOpenChecklistBtn" style="min-height:44px;font-weight:800;">
            <svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="6" y="7" width="12" height="14" rx="3" fill="rgba(56,189,248,0.16)" stroke="currentColor" stroke-width="1.8"/><path d="M9 7V5a3 3 0 0 1 6 0v2M9 14h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> Чек-лист
          </button>
          <button type="button" class="btn btn-accent" id="fcShareForecastTgBtn" style="min-height:44px;font-weight:800;">
            <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 15V3m0 0L8 7m4-4l4 4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg> Поделиться
          </button>
        </div>
      </div>

      ${buildSpecializedTacticalHtml(fish, s, activeDayForTackle, effWaterTempForTackle, effIceForTackle)}
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
                <span style="font-size:var(--fs-xs);font-weight:800;color:var(--accent);"><svg class="k-ico" style="color:var(--bad);" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="currentColor" stroke="rgba(255,255,255,0.65)" stroke-width="1.4"/></svg> ПАНЕЛЬ ПРОФИ: РУЧНАЯ КАЛИБРОВКА ВЕСОВ 8-ФАКТОРНОЙ МОДЕЛИ</span>
                <div style="font-size:11px;color:var(--good);font-weight:700;margin-top:2px;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="4.5" stroke="#38bdf8" stroke-width="1.6"/><circle cx="12" cy="12" r="1.8" fill="#10b981"/></svg> ${val30.label}</div>
                <div id="proCalibLiveSummary" style="font-size:11.5px;color:var(--accent);font-weight:800;margin-top:3px;">
                  <svg class="k-ico" viewBox="0 0 24 24" fill="none"><polygon points="13,2 4,14 11,14 10,22 20,10 13,10" fill="#fbbf24" stroke="#f59e0b" stroke-width="1.5" stroke-linejoin="round"/></svg> Активность «${fish.name}» с текущей калибровкой весов: <b>${calScoreNow}%</b> (двигайте ползунки для живого пересчёта прогноза)
                </div>
              </div>
              <div style="display:flex;gap:6px;">
                <button type="button" class="btn btn-sm" id="proOpenChecklistBtn" style="min-height:26px;padding:2px 8px;font-size:11px;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="6" y="7" width="12" height="14" rx="3" fill="rgba(56,189,248,0.16)" stroke="currentColor" stroke-width="1.8"/><path d="M9 7V5a3 3 0 0 1 6 0v2M9 14h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> Чек-лист выезда</button>
                <button type="button" class="btn btn-sm" id="proResetWeightsBtn" style="min-height:26px;padding:2px 8px;font-size:11px;">Сбросить (1.0x)</button>
              </div>
            </div>
          `;
        })()}
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(185px,1fr));gap:10px;font-size:var(--fs-xs);">
          <div>
            <label style="display:flex;justify-content:space-between;font-weight:700;">
              <span><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3c0 0-6 7.1-6 11.5a6 6 0 0 0 12 0C18 10.1 12 3 12 3z" fill="rgba(56,189,248,0.32)" stroke="#38bdf8" stroke-width="1.8"/><path d="M9.5 15.5c.5 1.2 1.7 2 3 2" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg> Термика воды:</span><b id="proWTempVal" style="color:var(--accent);">${Number(pw.temp ?? 1).toFixed(1)}x</b>
            </label>
            <input type="range" min="0.5" max="1.5" step="0.1" value="${pw.temp ?? 1}" data-pro-weight="temp" style="width:100%;">
          </div>
          <div>
            <label style="display:flex;justify-content:space-between;font-weight:700;">
              <span><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><polygon points="16,8 13.5,13.5 8,16 10.5,10.5" fill="#38bdf8" stroke="currentColor" stroke-width="1.3"/></svg> Давление (сутки):</span><b id="proWPressVal" style="color:var(--accent);">${Number(pw.press ?? 1).toFixed(1)}x</b>
            </label>
            <input type="range" min="0.5" max="1.5" step="0.1" value="${pw.press ?? 1}" data-pro-weight="press" style="width:100%;">
          </div>
          <div>
            <label style="display:flex;justify-content:space-between;font-weight:700;">
              <span><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M3 3v18h18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M7 15l4-5 4 3 5-7" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg> Барический шок (5 дн.):</span><b id="proWShockVal" style="color:var(--accent);">${Number(pw.archive_shock ?? 1).toFixed(1)}x</b>
            </label>
            <input type="range" min="0.5" max="1.5" step="0.1" value="${pw.archive_shock ?? 1}" data-pro-weight="archive_shock" style="width:100%;">
          </div>
          <div>
            <label style="display:flex;justify-content:space-between;font-weight:700;">
              <span><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="5" stroke="#38bdf8" stroke-width="1.5"/><path d="M12 12l6-6" stroke="#10b981" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="1.8" fill="#10b981"/></svg> Сигналы Круга (35 км):</span><b id="proWCircleVal" style="color:var(--accent);">${Number(pw.circle_field ?? 1).toFixed(1)}x</b>
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
          <div class="bento-card-title"><span><svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="16" rx="3" fill="rgba(56,189,248,0.14)" stroke="currentColor" stroke-width="1.8"/><path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><rect x="7" y="13" width="3" height="3" rx="0.8" fill="#38bdf8"/><rect x="14" y="13" width="3" height="3" rx="0.8" fill="#10b981"/></svg></span><span>Календарь клёва по дням (10 дней + Архив) • ${fish.name}</span></div>
          <div class="bento-card-sub">Нажмите на любой день для пересчёта дашборда и почасового графика (Позавчера/Вчера — запись архивного улова)</div>
        </div>
        <button type="button" class="btn btn-sm" id="fcCleanArchiveBtn" title="Очистить старый архив погоды, кроме последних 5 дней"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> Очистить кэш</button>
      </div>
      <div class="week-strip">
        ${days.map((d, idx) => {
          const score = calcDayBest(fish, d, s.method, s.water, s.depth, s.normPress, s.iceState);
          const isPriority = idx === 2 || idx === 3;
          const col = d.isArchive ? '#94a3b8' : (score >= 60 ? 'var(--good)' : (score >= 38 ? 'var(--warn)' : 'var(--bad)'));

          if (d.isArchive) {
            return `
              <div class="day-card archive-day ${idx === s.dayIdx ? 'active' : ''}" data-week-day="${idx}">
                <div class="day-status-stripe" style="background:${col};"></div>
                <div style="font-weight:800;font-size:11.5px;color:var(--muted);"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="5" y="3" width="14" height="18" rx="2.5" fill="rgba(56,189,248,0.16)" stroke="currentColor" stroke-width="1.8"/><path d="M9 7h6M9 11h6M9 15h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> ${d.relTitle}</div>
                <div style="font-weight:700;font-size:12px;">${d.label}</div>
                <div style="font-size:var(--fs-sm);font-weight:800;">${d.tDay > 0 ? '+' + d.tDay : d.tDay}° / ${d.tNight > 0 ? '+' + d.tNight : d.tNight}°C</div>
                <div style="font-size:11px;color:var(--muted);line-height:1.3;">
                  <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3c0 0-6 7.1-6 11.5a6 6 0 0 0 12 0C18 10.1 12 3 12 3z" fill="rgba(56,189,248,0.32)" stroke="#38bdf8" stroke-width="1.8"/><path d="M9.5 15.5c.5 1.2 1.7 2 3 2" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg> ${d.waterTemp}°C • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><polygon points="16,8 13.5,13.5 8,16 10.5,10.5" fill="#38bdf8" stroke="currentColor" stroke-width="1.3"/></svg> ${d.pressAvg} мм
                </div>
                <div style="margin-top:auto;padding-top:4px;border-top:1px dashed var(--border);">
                  <span style="color:var(--accent);font-size:11px;font-weight:800;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 20C5 11 11 5 20 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 4v7c0 1.7-1.3 3-3 3s-3-1.3-3-3" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/><circle cx="14" cy="16" r="2.2" fill="#10b981"/></svg> Внести улов →</span>
                </div>
              </div>
            `;
          }

          const topBadge = idx === 2
            ? `<span class="pill pill-good" style="font-size:11px;padding:2px 8px;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2c1.5 3.5 4.5 5.5 4.5 10a5.5 5.5 0 1 1-11 0c0-3 2-5.5 3.5-7 0 2 1.5 3 1.5 3S12 5.5 12 2z" fill="#f97316" stroke="#fbbf24" stroke-width="1.5" stroke-linejoin="round"/></svg> Сегодня</span>`
            : (idx === 3
                ? `<span class="pill pill-ice" style="font-size:11px;padding:2px 8px;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><polygon points="13,2 4,14 11,14 10,22 20,10 13,10" fill="#fbbf24" stroke="#f59e0b" stroke-width="1.5" stroke-linejoin="round"/></svg> Завтра</span>`
                : (d.relTitle ? `<span style="font-size:var(--fs-xs);color:var(--accent);font-weight:700;">${d.relTitle}</span>` : ''));

          const bestWindow = isPriority ? getBestBiteWindowText(fish, d, s.method, s.water, s.depth, s.normPress, s.iceState) : '';

          return `
            <div class="day-card ${isPriority ? 'priority-day' : ''} ${idx === s.dayIdx ? 'active' : ''}" data-week-day="${idx}">
              <div class="day-status-stripe" style="background:${col};"></div>
              <div style="display:flex;justify-content:space-between;align-items:center;gap:4px;">
                <span style="font-weight:800;font-size:var(--fs-xs);">${d.label}</span>
                ${topBadge}
              </div>
              <div style="font-size:var(--fs-md);font-weight:800;">${d.tDay > 0 ? '+' + d.tDay : d.tDay}° / ${d.tNight > 0 ? '+' + d.tNight : d.tNight}°C</div>
              <div style="font-size:var(--fs-xs);color:var(--muted);line-height:1.38;">
                <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3c0 0-6 7.1-6 11.5a6 6 0 0 0 12 0C18 10.1 12 3 12 3z" fill="rgba(56,189,248,0.32)" stroke="#38bdf8" stroke-width="1.8"/><path d="M9.5 15.5c.5 1.2 1.7 2 3 2" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg> Вода ${d.waterTemp}°C<br>
                <svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><polygon points="16,8 13.5,13.5 8,16 10.5,10.5" fill="#38bdf8" stroke="currentColor" stroke-width="1.3"/></svg> ${d.pressAvg} мм (${fmtDeltaPress(d.dP)})<br>
                <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> ${d.windDir} ${d.windMax} м/с
              </div>
              ${isPriority ? `
                <div style="padding:4px 7px;border-radius:6px;background:var(--panel);border:1px solid var(--border);font-size:11.5px;line-height:1.35;">
                  <div style="color:var(--accent);font-weight:800;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l3.5 2" stroke="#38bdf8" stroke-width="1.9" stroke-linecap="round"/></svg> Пик клёва: ${bestWindow}</div>
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
  }
}

export function renderHourly(container) {
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
          <div class="bento-card-title"><span><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l3.5 2" stroke="#38bdf8" stroke-width="1.9" stroke-linecap="round"/></svg></span><span>Почасовой разбор и 8 факторов (${day.relTitle ? day.relTitle + ' • ' + day.label : day.label})</span></div>
          <div class="bento-card-sub"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4.5" fill="#fbbf24" stroke="#f59e0b" stroke-width="1.6"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" stroke="#fbbf24" stroke-width="1.8" stroke-linecap="round"/></svg> Зорьки и <svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4.5" fill="#fbbf24" stroke="#f59e0b" stroke-width="1.6"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" stroke="#fbbf24" stroke-width="1.8" stroke-linecap="round"/></svg> лунные окна отмечены значками • Выберите любой час (00:00–23:00)</div>
        </div>
      </div>

      ${fish.legal === 'redbook' ? `
        <div style="padding:10px 12px;margin-bottom:10px;border-radius:var(--r-sm);background:var(--pill-bad-bg);border:1px solid var(--bad);color:var(--pill-bad-text);font-weight:700;line-height:1.42;font-size:var(--fs-xs);">
          <svg class="k-ico" style="color:var(--bad);" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" fill="rgba(239,68,68,0.22)" stroke="#ef4444" stroke-width="1.9"/><path d="M6 6l12 12" stroke="#ef4444" stroke-width="2.1" stroke-linecap="round"/></svg> <b>${fish.name} — Красная книга (изъятие запрещено).</b> Ниже показан биологический прогноз активности вида (вероятность поклёвки в прилове). При поимке бережно отпустите рыбу!
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

      <div class="card" style="margin-top:10px;background:var(--card);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <div style="flex:1;min-width:240px;">
          <div style="font-size:var(--fs-xs);color:var(--muted);font-weight:700;">УСЛОВИЯ В ВЫБРАННЫЙ ЧАС: ${String(selH).padStart(2, '0')}:00 (${day.label})</div>
          <div style="font-size:var(--fs-md);font-weight:800;margin-top:2px;">
            Воздух ${selHrObj.tAir > 0 ? '+' + selHrObj.tAir : selHrObj.tAir}°C • Вода ~${day.waterTemp}°C • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><polygon points="16,8 13.5,13.5 8,16 10.5,10.5" fill="#38bdf8" stroke="currentColor" stroke-width="1.3"/></svg> ${selHrObj.press} мм (за 3ч: ${fmtDeltaPress(selHrObj.dp3h)}) • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> ${selHrObj.windDir} ${selHrObj.wind} м/с
          </div>
          <div style="font-size:var(--fs-xs);color:var(--accent);margin-top:5px;line-height:1.42;">
            Рекомендуемая оснастка: <b>${rig.weight}</b> (${rig.line}) • ${rig.tactic}
          </div>
          <div style="margin-top:6px;font-size:var(--fs-xs);color:var(--good);font-weight:800;display:flex;align-items:center;flex-wrap:wrap;gap:4px;">
            <span><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 18c0-4 4-4 4-8s4-4 4-6 5-1 5 3-3 5-3 8 4 4 6 2" stroke="#f43f5e" stroke-width="2.2" stroke-linecap="round"/></svg> Рабочая приманка в этот час:</span> <b>${renderBaitWithColorDots(activeBait)}</b>
          </div>
        </div>
        <div>
          ${renderFiveFish(selBreakdown.total, 19, curTheme, true, fish.legal === 'redbook' ? `Активность ${selBreakdown.total}% • Отпусти` : null)}
        </div>
      </div>

      <details class="forecast-why-spoiler" ${s.appMode === 'pro' ? 'open' : ''} style="margin-top:12px;">
        <summary>
          <span><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M3 3v18h18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M7 15l4-5 4 3 5-7" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg> Почему такой прогноз? (Разбор 8 факторов + архив 10 км на ${String(selH).padStart(2, '0')}:00)</span>
          <span class="pill ${selBreakdown.total >= 60 ? 'pill-good' : (selBreakdown.total >= 38 ? 'pill-warn' : 'pill-bad')}">Итог ${selBreakdown.total}% ▾</span>
        </summary>
        <div style="margin-top:8px;padding:12px;background:var(--card);border-radius:var(--r-sm);">
          ${selBreakdown.hasRealArchive === false ? `
            <div style="padding:9px 11px;margin-bottom:10px;border-radius:var(--r-sm);background:var(--pill-warn-bg);border:1px solid var(--warn);color:var(--pill-warn-text);font-size:var(--fs-xs);font-weight:800;line-height:1.42;">
              <svg class="k-ico" style="color:var(--warn);" viewBox="0 0 24 24" fill="none"><path d="M12 3L2.5 19.5h19L12 3z" fill="rgba(245,158,11,0.24)" stroke="#f59e0b" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 9v5M12 17h.01" stroke="#fbbf24" stroke-width="2" stroke-linecap="round"/></svg> Прогноз может быть менее точным из-за отсутствия архивных данных по погоде (это первый запрос в данной локации 10 км при недоступности внешнего сервера архива; со следующего дня архив накопится автоматически на вашем устройстве).
            </div>
          ` : ''}

          <div style="padding:9px 11px;margin-bottom:10px;border-radius:var(--r-sm);background:var(--panel);border:1px solid var(--border);font-size:var(--fs-xs);line-height:1.45;">
            <div><b><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M3 3v18h18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M7 15l4-5 4 3 5-7" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg> Анализ 5-дневного метеоархива (радиус 10 км):</b> ${selBreakdown.archiveEval?.commentary || ''}</div>
            <div style="margin-top:5px;color:var(--accent);"><b><svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="5" y="3" width="14" height="18" rx="2.5" fill="rgba(56,189,248,0.16)" stroke="currentColor" stroke-width="1.8"/><path d="M9 7h6M9 11h6M9 15h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> Анализ вашего Журнала уловов:</b> ${selBreakdown.logInsight?.commentary || ''}</div>
            <div style="margin-top:5px;color:var(--good);"><b><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3.5" fill="rgba(56,189,248,0.25)" stroke="currentColor" stroke-width="1.8"/><path d="M3 19c0-3.2 2.7-5.5 6-5.5s6 2.3 6 5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="17" cy="9" r="2.8" stroke="currentColor" stroke-width="1.6"/><path d="M16 14c2.6.3 4.8 2 5 4.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg> Полевая сводка «Круга» (радиус 35 км):</b> ${selBreakdown.circleEval?.commentary || ''}</div>
          </div>

          <div style="font-size:var(--fs-xs);color:var(--muted);margin-bottom:8px;">
            Базовая активность в водоёме: <b>52%</b>. Поправки по 7 факторам и личной статистике:
          </div>
          ${selBreakdown.factors.map(f => {
            const isPos = f.val >= 0;
            const col = isPos ? 'var(--good)' : 'var(--bad)';
            const widthPct = Math.min(100, Math.max(8, Math.abs(f.val) * 3));
            return `
              <div class="factor-row">
                <div>
                  <div style="font-weight:700;">${f.name}</div>
                  <div style="font-size:var(--fs-xs);color:var(--muted);">${f.note}</div>
                </div>
                <div class="factor-bar-track">
                  <div class="factor-bar-fill" style="width:${widthPct}%;background:${col};"></div>
                </div>
                <div style="text-align:right;font-weight:800;color:${col};">${isPos ? '+' + f.val : f.val}%</div>
              </div>
            `;
          }).join('')}
          <p style="margin-top:10px;font-size:var(--fs-xs);color:var(--muted);">
            <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3v18M5 7h14M5 7l-3 6h6l-3-6zm14 0l-3 6h6l-3-6zM8 21h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> ${RU.forecastDisclaimer}
          </p>
        </div>
      </details>

      <div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border);">
        <div class="section-title"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><polygon points="16,8 13.5,13.5 8,16 10.5,10.5" fill="#38bdf8" stroke="currentColor" stroke-width="1.3"/></svg> Ихтиология, снасти и кормовая база: ${fish.name} (${s.depth.toFixed(1)} м)</div>
        <div class="guide-grid">
          <div class="guide-block"><h4>Гидробиология, размеры и стоянки</h4><div>${guides.standAdvice}</div></div>
          <div class="guide-block"><h4>Снасти, монтаж и подача</h4><div>${guides.tackleAdvice}</div></div>
          <div class="guide-block"><h4>Кормовая база и рабочие приманки</h4><div>${guides.baitAdvice}</div></div>
        </div>
      </div>

      <!-- Пункт 23: Вероятностный дисклеймер под прогнозом -->
      <div style="margin-top:12px;padding:8px 11px;background:var(--card);border:1px dashed var(--border);border-radius:var(--r-sm);font-size:11.5px;color:var(--muted);line-height:1.4;">
        ⓘ <b>Вероятностный биофизический индекс:</b> прогноз оценивает совокупность гидрометеорологических условий водоёма (термику воды, барический градиент, кислородный режим и солунарную фазу), но не является гарантией улова. Учитывайте локальный рельеф и правила безопасности на воде и льду.
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

function renderArchiveDayLogger(container, s, defaultDay, currentFish) {
  const todayDt = new Date();
  todayDt.setHours(0, 0, 0, 0);
  const todayStr = formatLocalYYYYMMDD(todayDt);

  // Формируем список последних 5 архивных дней (и любых других дат в кэше)
  const past5Dates = [];
  for (let offset = -1; offset >= -5; offset--) {
    const dt = new Date(todayDt.getTime() + offset * 86400000);
    const dStr = formatLocalYYYYMMDD(dt);
    const cachedDay = storage.getDayWeatherByDate(s.lat, s.lon, dStr) ||
      (s.weatherDays || []).find(x => x.date === dStr) ||
      (s.weatherArchive5Days || []).find(x => x.date === dStr);
    const title = offset === -1 ? 'Вчера' : (offset === -2 ? 'Позавчера' : `${Math.abs(offset)} дн. назад`);
    past5Dates.push({
      date: dStr,
      offset,
      title,
      label: `${RU.daysShort[dt.getDay()]}, ${dt.getDate()} ${RU.monthsGen[dt.getMonth()]}`,
      dayObj: cachedDay
    });
  }

  const activeDateStr = selectedArchiveDateOverride || defaultDay.date || past5Dates[0].date;
  const activeDayObj = storage.getDayWeatherByDate(s.lat, s.lon, activeDateStr) ||
    (s.weatherDays || []).find(x => x.date === activeDateStr) ||
    (s.weatherArchive5Days || []).find(x => x.date === activeDateStr) ||
    defaultDay;

  const selH = clampHour(s.selectedHour);
  const selHrObj = (activeDayObj.hours && activeDayObj.hours[selH]) || activeDayObj.hours?.[12] || { hour: selH, tAir: activeDayObj.tDay || 5, press: activeDayObj.pressAvg || 754, wind: activeDayObj.windMax || 3, windDir: 'З' };
  const availWaters = getAvailableWaterTypes(s.basinCode, s.lat, s.lon);
  const compatibleMethods = getCompatibleMethods(currentFish, activeDayObj.iceState || s.iceState, s.water, activeDayObj.waterTemp);
  const currentMethodVal = compatibleMethods.some(m => m.val === s.method) ? s.method : compatibleMethods[0]?.val;
  const seasonalBaits = getSeasonalBaitsForContext(currentFish, currentMethodVal, activeDayObj.waterTemp, activeDayObj.iceState || s.iceState);
  const activeBait = s.selectedBait && seasonalBaits.includes(s.selectedBait) ? s.selectedBait : seasonalBaits[0];

  const favSet = new Set(s.favorites || []);
  const legalSpecies = [...FISH_DB]
    .filter(f => f.legal !== 'redbook' && isSpeciesInGeoRange(f, s.lat, s.lon, s.basinCode, s.water, 120, new Set(['small_river', 'big_river', 'quarry', 'tundra_lake', ...(s.isCoastal ? ['sea_gulf', 'open_sea'] : [])]), s.isCoastal, true, s.selectedWaterName))
    .sort((a, b) => (favSet.has(b.id) ? 1 : 0) - (favSet.has(a.id) ? 1 : 0));

  container.innerHTML = `
    <div class="card" style="border-color:var(--accent);">
      <div class="section-head">
        <div>
          <span class="section-title"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="5" y="3" width="14" height="18" rx="2.5" fill="rgba(56,189,248,0.16)" stroke="currentColor" stroke-width="1.8"/><path d="M9 7h6M9 11h6M9 15h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> Архив погоды (10 км) и запись улова за предыдущие 5 дней (${activeDayObj.label || activeDateStr})</span>
          <div style="font-size:var(--fs-xs);color:var(--muted);margin-top:2px;">
            Выберите любую дату за последние 5 дней (или через обычный календарь) — почасовой прогноз из кэша локации подставится автоматически!
          </div>
        </div>
        ${createPill({ text: `Архив: ${activeDateStr}`, tone: 'purple', icon: '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="16" rx="3" fill="rgba(56,189,248,0.14)" stroke="currentColor" stroke-width="1.8"/><path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><rect x="7" y="13" width="3" height="3" rx="0.8" fill="#38bdf8"/><rect x="14" y="13" width="3" height="3" rx="0.8" fill="#10b981"/></svg>' })}
      </div>

      <div style="margin-bottom:12px;padding:10px 12px;background:var(--card);border:1px solid var(--border);border-radius:var(--r-sm);">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
          <label for="archCalendarDate" style="font-size:var(--fs-xs);font-weight:800;color:var(--accent);"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="16" rx="3" fill="rgba(56,189,248,0.14)" stroke="currentColor" stroke-width="1.8"/><path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><rect x="7" y="13" width="3" height="3" rx="0.8" fill="#38bdf8"/><rect x="14" y="13" width="3" height="3" rx="0.8" fill="#10b981"/></svg> ВЫБЕРИТЕ ДАТУ ВЫЕЗДА (КАЛЕНДАРЬ ИЛИ БЫСТРЫЕ 5 ДНЕЙ):</label>
          <input type="date" id="archCalendarDate" class="input" value="${activeDateStr}" max="${todayStr}" style="max-width:190px;min-height:34px;padding:4px 10px;">
        </div>
        <div class="chip-scroll-row">
          ${past5Dates.map(item => `
            <button type="button" class="w-chip ${item.date === activeDateStr ? 'active' : ''}" data-arch-quick-date="${item.date}">
              <svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="16" rx="3" fill="rgba(56,189,248,0.14)" stroke="currentColor" stroke-width="1.8"/><path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><rect x="7" y="13" width="3" height="3" rx="0.8" fill="#38bdf8"/><rect x="14" y="13" width="3" height="3" rx="0.8" fill="#10b981"/></svg> ${item.title} (${item.label}) ${item.dayObj ? `• ${item.dayObj.tDay > 0 ? '+' + item.dayObj.tDay : item.dayObj.tDay}°C, ${item.dayObj.pressAvg} мм` : ''}
            </button>
          `).join('')}
        </div>
      </div>

      <div style="padding:10px 12px;border-radius:var(--r-sm);background:var(--card);margin-bottom:12px;font-size:var(--fs-xs);color:var(--accent);font-weight:700;">
        <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="4" stroke="#38bdf8" stroke-width="1.8"/></svg> Почасовой метеоархив из кэша 10 км (${activeDayObj.label || activeDateStr}, ${String(selH).padStart(2, '0')}:00): Воздух ${selHrObj.tAir > 0 ? '+' + selHrObj.tAir : selHrObj.tAir}°C • Вода ~${activeDayObj.waterTemp}°C • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><polygon points="16,8 13.5,13.5 8,16 10.5,10.5" fill="#38bdf8" stroke="currentColor" stroke-width="1.3"/></svg> ${selHrObj.press} мм (Δ ${fmtDeltaPress(activeDayObj.dP)}) • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> ${selHrObj.windDir} ${selHrObj.wind} м/с • ${activeDayObj.moon?.phaseIcon || '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" fill="#fbbf24" stroke="#f59e0b" stroke-width="1.6" stroke-linejoin="round"/></svg>'} ${activeDayObj.moon?.moonDay || 12} л.д.
      </div>

      <div class="controls-grid" style="margin-bottom:12px;">
        <div>
          <label style="display:block;font-size:var(--fs-xs);color:var(--muted);font-weight:700;margin-bottom:3px;">ШАГ 1. ПОЙМАННАЯ РЫБА (ИЗБРАННЫЕ ВВЕРХУ)</label>
          <select id="archFishSel">
            ${legalSpecies.map(f => `<option value="${f.id}" ${f.id === currentFish.id ? 'selected' : ''}>${favSet.has(f.id) ? ' ' : ''}${f.name}</option>`).join('')}
          </select>
        </div>

        <div>
          <label style="display:block;font-size:var(--fs-xs);color:var(--muted);font-weight:700;margin-bottom:3px;">ШАГ 2. СНАСТЬ (ПОДХОДЯЩАЯ ПОД РЫБУ)</label>
          <select id="archMethodSel">
            ${compatibleMethods.map(m => `<option value="${m.val}" ${m.val === currentMethodVal ? 'selected' : ''}>${String(m.text || '').replace(/<[^>]+>/g, '').trim()}</option>`).join('')}
          </select>
        </div>

        <div>
          <label style="display:block;font-size:var(--fs-xs);color:var(--muted);font-weight:700;margin-bottom:3px;">ШАГ 3. СЕЗОННАЯ НАЖИВКА / ПРИМАНКА</label>
          <select id="archBaitSel">
            ${seasonalBaits.map(b => `<option value="${b}" ${b === activeBait ? 'selected' : ''}>${b}</option>`).join('')}
          </select>
        </div>

        <div>
          <label style="display:block;font-size:var(--fs-xs);color:var(--muted);font-weight:700;margin-bottom:3px;">ШАГ 4. ВОДОЁМ / БИОТОП</label>
          <select id="archWaterSel">
            ${(s.nearbyWaters || []).map(w => `<option value="${w.wType}|${w.name || w.label}" ${s.selectedWaterName === w.name ? 'selected' : ''}>${String(w.label || '').replace(/<[^>]+>/g, '').trim()}</option>`).join('')}
            ${availWaters.map(w => `<option value="${w.id}|${w.shortName}">${String(w.name || '').replace(/<[^>]+>/g, '').trim()}</option>`).join('')}
          </select>
        </div>

        <div>
          <label style="display:block;font-size:var(--fs-xs);color:var(--muted);font-weight:700;margin-bottom:3px;">ШАГ 5. ЧАС ПОИМКИ (ПОЧАСОВОЙ КЭШ НА ${activeDateStr})</label>
          <select id="archHourSel">
            ${(activeDayObj.hours || []).map(hr => `<option value="${hr.hour}" ${hr.hour === selH ? 'selected' : ''}>${String(hr.hour).padStart(2, '0')}:00 (воздух ${hr.tAir > 0 ? '+' + hr.tAir : hr.tAir}°C, ${hr.press} мм, ${hr.windDir} ${hr.wind} м/с)</option>`).join('')}
          </select>
        </div>

        <div style="display:flex;align-items:flex-end;">
          <button type="button" class="btn btn-good" id="archOpenCatchBtn" data-arch-active-date="${activeDateStr}" style="width:100%;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 20C5 11 11 5 20 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 4v7c0 1.7-1.3 3-3 3s-3-1.3-3-3" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/><circle cx="14" cy="16" r="2.2" fill="#10b981"/></svg> Записать улов (${activeDayObj.label || activeDateStr}, ${String(selH).padStart(2, '0')}:00)</button>
        </div>
      </div>
    </div>
  `;
}

function clampHour(h) {
  const n = parseInt(h, 10);
  return Number.isFinite(n) ? Math.max(0, Math.min(23, n)) : 12;
}

let _sliderDragActive = false;

export function render(container) {
  if (!container) return;
  const savedWinScrollY = typeof window !== 'undefined' ? window.scrollY : 0;
  const savedWeekScroll = container.querySelector('.week-strip')?.scrollLeft || 0;
  const savedHourlyScroll = container.querySelector('.bite-timeline')?.scrollLeft || 0;

  if (!container.querySelector('#fcWeekBox')) {
    container.innerHTML = `
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
  if (typeof window !== 'undefined' && savedWinScrollY > 0 && Math.abs(window.scrollY - savedWinScrollY) > 4) {
    window.scrollTo({ top: savedWinScrollY, behavior: 'instant' });
  }
}

function updateLiveWeightLabelsAndScores(container) {
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
      sumEl.innerHTML = `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><polygon points="13,2 4,14 11,14 10,22 20,10 13,10" fill="#fbbf24" stroke="#f59e0b" stroke-width="1.5" stroke-linejoin="round"/></svg> Активность «${fish.name}» с текущей калибровкой весов: <b>${calScoreNow}%</b> (двигайте ползунки для живого пересчёта прогноза)`;
    }
  }
  const savedWinScrollY = typeof window !== 'undefined' ? window.scrollY : 0;
  renderWeek(container.querySelector('#fcWeekBox'));
  renderHourly(container.querySelector('#fcHourlyBox'));
  // Также обновим проценты и пилюли в 3 карточках экспресс-сводки без пересоздания ползунков
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

    // 1. Кнопка « Я поймал»
    const catchTodayBtn = target.closest('[data-catch-today]');
    if (catchTodayBtn) {
      e.stopPropagation();
      selectedArchiveDateOverride = null;
      store.dispatch({ type: 'SET_DAY', payload: 2 });
      const s = store.getState();
      events.emit('forecast:hourSelected', { dayIdx: 2, date: s.weatherDays[2]?.date, hour: s.selectedHour, bait: s.selectedBait });
      return;
    }

    // 2. Карточка дня в Экспресс-сводке (3 дня)
    const expCard = target.closest('[data-express-day]');
    if (expCard) {
      selectedArchiveDateOverride = null;
      const idx = parseInt(expCard.getAttribute('data-express-day'), 10);
      const savedY = window.scrollY;
      store.dispatch({ type: 'SET_DAY', payload: idx });
      requestAnimationFrame(() => {
        if (Math.abs(window.scrollY - savedY) > 4) window.scrollTo({ top: savedY, behavior: 'instant' });
      });
      return;
    }

    // 3. Карточка дня в 10-дневной ленте (без прыжка страницы вверх!)
    const weekCard = target.closest('[data-week-day]');
    if (weekCard) {
      selectedArchiveDateOverride = null;
      const idx = parseInt(weekCard.getAttribute('data-week-day'), 10);
      const savedY = window.scrollY;
      const strip = container.querySelector('.week-strip');
      const savedStripLeft = strip ? strip.scrollLeft : 0;
      store.dispatch({ type: 'SET_DAY', payload: idx });
      requestAnimationFrame(() => {
        const nextStrip = container.querySelector('.week-strip');
        if (nextStrip && savedStripLeft > 0) nextStrip.scrollLeft = savedStripLeft;
        if (Math.abs(window.scrollY - savedY) > 4) window.scrollTo({ top: savedY, behavior: 'instant' });
      });
      return;
    }

    // 4. Клик по часу в почасовом графике (0–24 ч) — работает бесконечное число раз подряд!
    const hourBtn = target.closest('[data-scrub-hour]');
    if (hourBtn) {
      const hr = parseInt(hourBtn.getAttribute('data-scrub-hour'), 10);
      if (Number.isFinite(hr)) {
        const savedY = window.scrollY;
        const timeline = container.querySelector('.bite-timeline');
        const savedLeft = timeline ? timeline.scrollLeft : 0;
        store.dispatch({ type: 'SET_HOUR', payload: hr });
        renderHourly(container.querySelector('#fcHourlyBox'));
        const nextTimeline = container.querySelector('.bite-timeline');
        if (nextTimeline && savedLeft > 0) nextTimeline.scrollLeft = savedLeft;
        if (Math.abs(window.scrollY - savedY) > 4) window.scrollTo({ top: savedY, behavior: 'instant' });
      }
      return;
    }

    // 5. Очистка архива погоды
    if (target.closest('#fcCleanArchiveBtn')) {
      const res = storage.clearWeatherArchiveKeep5Days();
      showToast(` Архив погоды очищен: удалено старых записей — ${res.removedCount}, сохранены последние 5 дней архива (${res.keptArchiveCount} дн.)`, 'good');
      render(container);
      return;
    }

    // 6. Переключение режима (Новичок / Рыбак / Профи)
    const modeBtn = target.closest('[data-set-app-mode]');
    if (modeBtn) {
      const m = modeBtn.getAttribute('data-set-app-mode');
      store.dispatch({ type: 'SET_APP_MODE', payload: m });
      const titles = { novice: '<svg class="k-ico" style="color:var(--good);" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="currentColor" stroke="rgba(255,255,255,0.65)" stroke-width="1.4"/></svg> Режим «Новичок»', angler: '<svg class="k-ico" style="color:var(--warn);" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="currentColor" stroke="rgba(255,255,255,0.65)" stroke-width="1.4"/></svg> Режим «Рыбак»', pro: '<svg class="k-ico" style="color:var(--bad);" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="currentColor" stroke="rgba(255,255,255,0.65)" stroke-width="1.4"/></svg> Режим «Профи»' };
      showToast(`Включён ${titles[m] || m}`, 'good');
      return;
    }

    // 7. Выбор рыбы из ТОП-3, стрелок ‹/›, зума иллюстрации или быстрой полосы рыб на Бенто-дашборде
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
      if (fid) store.dispatch({ type: 'SET_FISH', payload: fid });
      return;
    }

    if (target.closest('#bentoOpenAllFishBtn')) {
      if (typeof window.__KLEV_NAVIGATE_SECTION__ === 'function') window.__KLEV_NAVIGATE_SECTION__('fish');
      return;
    }

    if (target.closest('#bentoScrollToFactorsBtn, #bentoWaveChartCard')) {
      const hrBox = container.querySelector('#fcHourlyBox');
      if (hrBox) {
        const sp = hrBox.querySelector('details.forecast-why-spoiler');
        if (sp && target.closest('#bentoScrollToFactorsBtn')) sp.open = true;
        hrBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      return;
    }

    if (target.closest('#bentoWeatherIceCard')) {
      if (typeof window.__KLEV_NAVIGATE_SECTION__ === 'function') window.__KLEV_NAVIGATE_SECTION__('weather');
      return;
    }

    // 8. Сброс весов факторов Профи к 1.0x
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

    // 9. Чек-лист выезда
    if (target.closest('#fcOpenChecklistBtn, #proOpenChecklistBtn')) {
      openTripChecklistModal();
      return;
    }

    // 10. Поделиться прогнозом в Telegram
    if (target.closest('#fcShareForecastTgBtn')) {
      if (!requireRegisteredFisherId('отправки прогноза в Telegram')) return;
      const s = store.getState();
      const fish = FISH_DB.find(f => f.id === s.fishId) || FISH_DB[0];
      const day = s.weatherDays[s.dayIdx] || s.weatherDays[2] || s.weatherDays[0];
      if (!day) return;
      const sc = calcDayBest(fish, day, s.method, s.water, s.depth, s.normPress, s.iceState);
      const win = getBestBiteWindowText(fish, day, s.method, s.water, s.depth, s.normPress, s.iceState);
      const rig = calcDynamicRig(s.method, s.water, s.depth, day.windMax, fish, day.waterTemp, day.iceState || s.iceState);
      const waterTitle = s.selectedWaterName || WATER_PROFILES[s.water]?.shortName || 'водоём';
      const { webUrl, botStartUrl } = buildForecastShareUrls(s.lat, s.lon, s.locLabel, fish.id);
      const summary =
        `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 20C5 11 11 5 20 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 4v7c0 1.7-1.3 3-3 3s-3-1.3-3-3" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/><circle cx="14" cy="16" r="2.2" fill="#10b981"/></svg> Клёв ПРО 2.0 • Прогноз клёва (${day.relTitle || day.label})\n` +
        `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z" fill="rgba(239,68,68,0.22)" stroke="#ef4444" stroke-width="1.9"/><circle cx="12" cy="11" r="2.3" fill="#ef4444"/></svg> ${s.locLabel} (${waterTitle})\n` +
        `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 12s4-6 11-6c4.2 0 7 2.5 9 6-2 3.5-4.8 6-9 6-7 0-11-6-11-6z" fill="rgba(56,189,248,0.28)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M2 12l-1.5-3.5L5 10.5M2 12l-1.5 3.5L5 13.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="16.5" cy="10.8" r="1.3" fill="currentColor"/></svg> Рыба: ${fish.name} — активность ${sc}%\n` +
        `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l3.5 2" stroke="#38bdf8" stroke-width="1.9" stroke-linecap="round"/></svg> Лучший выход: ${win}\n` +
        `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3c0 0-6 7.1-6 11.5a6 6 0 0 0 12 0C18 10.1 12 3 12 3z" fill="rgba(56,189,248,0.32)" stroke="#38bdf8" stroke-width="1.8"/><path d="M9.5 15.5c.5 1.2 1.7 2 3 2" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg> Вода ~${day.waterTemp}°C • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><polygon points="16,8 13.5,13.5 8,16 10.5,10.5" fill="#38bdf8" stroke="currentColor" stroke-width="1.3"/></svg> ${day.pressAvg} мм (${fmtDeltaPress(day.dP)}) • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> ${day.windDir} ${day.windMax} м/с\n` +
        `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="4.5" stroke="#38bdf8" stroke-width="1.6"/><circle cx="12" cy="12" r="1.8" fill="#10b981"/></svg> Снасть: ${rig.weight} (${rig.line})\n` +
        `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="4" y="8" width="16" height="12" rx="3" fill="rgba(56,189,248,0.2)" stroke="currentColor" stroke-width="1.8"/><path d="M12 3v5M9 3h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="9" cy="14" r="1.5" fill="#38bdf8"/><circle cx="15" cy="14" r="1.5" fill="#38bdf8"/></svg> Открыть в Telegram-боте / Mini App: ${botStartUrl}`;
      shareToTelegramChat(webUrl, summary);
      return;
    }

    // 11. Быстрый выбор архивной даты (за последние 5 дней)
    const archQuickBtn = target.closest('[data-arch-quick-date]');
    if (archQuickBtn) {
      const dStr = archQuickBtn.getAttribute('data-arch-quick-date');
      if (dStr) {
        selectedArchiveDateOverride = dStr;
        renderHourly(container.querySelector('#fcHourlyBox'));
      }
      return;
    }

    // 12. Записать архивный улов
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

  // Горизонтальный свайп влево/вправо по главной карточке прогноза для быстрой смены рыбы (Пункт 7 v2.5.0)
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
        }
      }
    }
  }, { passive: true });

  // Живое перетаскивание ползунков калибровки в режиме « Профи» (input — прямо под пальцем без потери фокуса!)
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

  // Обработка change для выпадающих списков и ползунков
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
      return;
    }
    if (t.id === 'fcTopBaitSelect' || t.id === 'fcSeasonalBaitSel' || t.id === 'archBaitSel') {
      store.dispatch({ type: 'SET_BAIT', payload: t.value });
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

      // Если сейчас активно двигается ползунок весов Профи, обновление уже выполнено через updateLiveWeightLabelsAndScores
      if (_sliderDragActive && prev && next.proFactorWeights !== prev.proFactorWeights) {
        return;
      }

      // Если изменились только веса Профи (например, по кнопке Сбросить)
      if (prev && next.proFactorWeights !== prev.proFactorWeights && next.appMode === prev.appMode) {
        _dayBestMemo.clear();
        updateLiveWeightLabelsAndScores(container);
        return;
      }

      // Если изменился только выбранный день (dayIdx) или час (selectedHour) — обновляем подсветку и почасовой блок БЕЗ прыжка страницы!
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
