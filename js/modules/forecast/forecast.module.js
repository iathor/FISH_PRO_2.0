import { RU } from '../../i18n/ru.js?v=2.0.14';
import { getSeasonalBaitsForContext, getCompatibleMethods } from '../../core/config.js?v=2.0.14';
import { events } from '../../core/events.js?v=2.0.14';
import { storage } from '../../core/storage.js?v=2.0.14';
import { store } from '../../core/store.js?v=2.0.14';
import { formatLocalYYYYMMDD, fmtDeltaPress, fmtHM } from '../../core/format.js?v=2.0.14';
import { WATER_PROFILES, getAvailableWaterTypes } from '../../data/waters.js?v=2.0.14';
import { FISH_DB } from '../../data/species.js?v=2.0.14';
import { renderFiveFish } from '../../ui/svg.js?v=2.0.14';
import { createPill, showToast } from '../../ui/components.js?v=2.0.14';

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
export function getPreceding5DaysForTarget(day, state = null) {
  const st = state || store.getState();
  if (!day || !day.date) return [];
  const targetDate = day.date;

  const mapByDate = {};
  if (Array.isArray(st.weatherDays)) {
    st.weatherDays.forEach(d => {
      if (d && d.date && d.date < targetDate) mapByDate[d.date] = d;
    });
  }
  if (Array.isArray(st.weatherArchive5Days)) {
    st.weatherArchive5Days.forEach(d => {
      if (d && d.date && d.date < targetDate) mapByDate[d.date] = d;
    });
  }
  const geoArch = storage.getArchiveDaysForLocation(st.lat, st.lon, 10, targetDate);
  if (Array.isArray(geoArch.allArchiveDays)) {
    geoArch.allArchiveDays.forEach(d => {
      if (d && d.date && d.date < targetDate) mapByDate[d.date] = d;
    });
  }

  return Object.keys(mapByDate)
    .sort()
    .slice(-5)
    .map(k => mapByDate[k]);
}

/**
 * 7-й ФАКТОР ПРОГНОЗИРОВАНИЯ (Ревизия 2.0.14):
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
 * Аналитика Личного журнала рыболова для калибровки прогноза клёва (Ревизия 2.0.14):
 * Сравнивает текущие условия (температура воды, давление, ветер, снасть, час) с реальными уловами пользователя из журнала.
 */
export function evaluateLogbookInsight(fish, day, hrObj, method, water, catches = []) {
  if (!Array.isArray(catches) || catches.length === 0 || !fish) {
    return {
      val: 0,
      hasData: false,
      note: 'Журнал уловов: пока нет записей для личной калибровки',
      commentary: 'Добавляйте свои уловы через кнопку «🎣 Я поймал» (доступна запись за последние 5 дней по календарю), чтобы прогноз автоматически учитывал вашу личную статистику по водоёмам и приманкам.'
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
 * Ревизия 2.0.14:
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
export function computeHourFactors(fish, day, hrObj, method, water, depth, normPress = 752, globalIceState = 'open_water') {
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

  // 3. 7-й ФАКТОР: 5-дневный метеоархив (10 км) и барический шок
  const prev5Days = getPreceding5DaysForTarget(day, st);
  const hasRealArchive = st.hasRealArchive !== false;
  const archiveEval = evaluate5DayArchiveAndBaricShock(fish, day, prev5Days, hasRealArchive);
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
  }
  const windNote = `Ветер ${hrObj.windDir} ${hrObj.wind} м/с`;

  // 5. Сезонный биоритм, нерест и речной ход морских/проходных рыб
  const dtMonthIdx = new Date(day.date + 'T00:00:00').getMonth();
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
  const logInsight = evaluateLogbookInsight(fish, day, hrObj, method, water, st.catches || []);

  const baseScore = 52;
  let rawTotal = baseScore + tempDelta + pressDelta + archiveDelta + windDelta + seasonDelta + gearDelta + moonDelta + logInsight.val;
  if (isIceDanger) {
    rawTotal = Math.min(28, rawTotal - 18);
  }
  const total = Math.max(4, Math.min(98, Math.round(rawTotal)));

  const factors = [
    { id: 'temp', name: '1. Температура воды (с учётом течения)', val: tempDelta, note: tempNote },
    { id: 'press', name: '2. Давление и его текущий ход', val: pressDelta, note: pressNote },
    { id: 'archive_shock', name: '3. Метеоархив (5 дней) и барический шок', val: archiveDelta, note: archiveNote },
    { id: 'season', name: '4. Сезон, биоритм и миграция', val: seasonDelta, note: seasonNote },
    { id: 'gear', name: '5. Глубина, свет и снасть', val: gearDelta, note: gearNote },
    { id: 'wind', name: '6. Ветер и волнение', val: windDelta, note: windNote },
    { id: 'moon', name: (isSeaWater || runInfo) ? '7. Фаза Луны и прилив' : '7. Фаза Луны', val: moonDelta, note: moonNote }
  ];

  if (logInsight.hasData) {
    factors.push({
      id: 'logbook',
      name: '📓 Калибровка по вашему Журналу уловов',
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
    factors
  };
}

function getMethodCompatibility(fish, method, water = 'small_river') {
  const isRiverEntering = Boolean(RIVER_ENTERING_SPECIES[fish.id]);
  if (method === 'winter_livebait') return fish.type === 'predator' ? 7 : -14;
  if (method === 'winter_lure') return ['perch', 'pike', 'zander', 'grayling', 'smelt', 'trout', 'cod', 'navaga', 'lenok', 'volga_zander', 'char', 'broad_whitefish', 'saffron_cod', 'peled', 'chir', 'pizhyan', 'whitefish', 'omul', 'baikal_grayling', 'kundzha', 'nelma', 'taimen'].includes(fish.id) ? 8 : -10;
  if (method === 'winter_jig') return ['chir', 'pizhyan', 'peled', 'cisco', 'roach', 'perch', 'whitefish', 'ruffe', 'smelt', 'bream', 'ide', 'dace', 'white_bream', 'vendace', 'omul', 'omul_arctic', 'valek', 'baikal_grayling', 'tugun', 'crucian', 'rudd', 'gudgeon', 'muksun'].includes(fish.id) ? 8 : -5;
  if (method === 'winter_stuka') return ['burbot', 'cod', 'halibut', 'navaga', 'wolffish'].includes(fish.id) ? 10 : -12;
  if (method === 'winter_cisco') return ['cisco', 'peled', 'smelt', 'whitefish', 'herring', 'vendace', 'omul', 'omul_arctic', 'tugun', 'chir', 'pizhyan', 'muksun'].includes(fish.id) ? 10 : -10;

  if (method === 'spin_micro') {
    const nanoMasters = [
      'perch', 'roach', 'crucian', 'dace', 'peled', 'rudd', 'bleak', 'chub', 'ide',
      'grayling', 'baikal_grayling', 'trout', 'brown_trout', 'rainbow_trout', 'rotan',
      'gudgeon', 'bream', 'white_bream', 'blue_bream', 'sopa', 'tench', 'carp', 'chekhon',
      'vimba', 'vobla', 'taran', 'undermouth', 'chir', 'pizhyan', 'tugun', 'whitefish',
      'cisco', 'vendace', 'broad_whitefish', 'omul', 'omul_arctic', 'valek', 'smelt',
      'ruffe', 'minnow', 'verkhovka', 'bitterling', 'horse_mackerel', 'sea_bass',
      'scorpionfish', 'wrasse', 'sea_bream', 'red_mullet', 'goby', 'shemaya', 'muksun'
    ];
    if (nanoMasters.includes(fish.id)) return 9;
    return fish.type === 'predator' ? 5 : 4;
  }

  if (method === 'spin_jig') return ['zander', 'pike', 'perch', 'catfish', 'volga_zander', 'amur_catfish', 'channel_catfish', 'burbot', 'cod', 'halibut', 'greenling', 'asp', 'chub', 'ide', 'nelma', 'taimen', 'chinese_perch', 'yellowcheek'].includes(fish.id) ? 8 : (fish.type === 'predator' ? 4 : -10);
  if (method === 'spin_lure') return (fish.type === 'predator' || ['ide', 'dace', 'chekhon', 'peled', 'chir', 'pizhyan', 'whitefish', 'tugun', 'rudd', 'bleak', 'roach', 'bream'].includes(fish.id)) ? 8 : -8;
  if (method === 'bottom') return (fish.type === 'peace' || isRiverEntering || ['catfish', 'burbot', 'channel_catfish', 'amur_catfish', 'ruffe', 'flounder', 'starry_flounder', 'turbot', 'plaice', 'goby', 'perch', 'pike', 'zander', 'beluga', 'kaluga'].includes(fish.id)) ? 8 : -5;
  if (method === 'float') return (fish.type === 'peace' || isRiverEntering || ['perch', 'rotan', 'ruffe', 'chub', 'grayling', 'baikal_grayling', 'trout', 'dolly_varden', 'garfish'].includes(fish.id)) ? 8 : -5;
  if (method === 'fly') return ['grayling', 'baikal_grayling', 'lenok', 'salmon', 'trout', 'chub', 'ide', 'tugun', 'dace', 'peled', 'chir', 'pizhyan', 'whitefish', 'cisco', 'valek', 'brown_trout', 'sockeye_salmon', 'char', 'dolly_varden', 'bleak', 'rudd', 'chekhon', 'roach', 'taimen', 'nelma'].includes(fish.id) ? 9 : -8;
  if (method.startsWith('sea_')) return (fish.habitat === 'sea' || isRiverEntering || water === 'sea_gulf' || water === 'open_sea') ? 8 : -12;
  return 0;
}

export function calcHourly(fish, day, hrObj, method, water, depth, normPress = 752, iceState = 'open_water') {
  return computeHourFactors(fish, day, hrObj, method, water, depth, normPress, iceState).total;
}

export function calcDayBest(fish, day, method, water, depth, normPress = 752, iceState = 'open_water') {
  if (!fish || !day?.hours?.length) return 0;
  const scores = day.hours.map(hr => calcHourly(fish, day, hr, method, water, depth, normPress, iceState)).sort((a, b) => b - a);
  return Math.round((scores[0] + scores[1] + scores[2] + scores[3]) / 4);
}

export function getBestBiteWindowText(fish, day, method, water, depth, normPress = 752, iceState = 'open_water') {
  if (!fish || !day?.hours?.length) return '06:00–09:00';
  let bestHr = 7;
  let bestScore = -1;
  for (const hr of day.hours) {
    const sc = calcHourly(fish, day, hr, method, water, depth, normPress, iceState);
    if (sc > bestScore) {
      bestScore = sc;
      bestHr = hr.hour;
    }
  }
  const endHr = (bestHr + 2) % 24;
  return `${String(bestHr).padStart(2, '0')}:00–${String(endHr).padStart(2, '0')}:00 (${bestScore}%)`;
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
  const sizeBlock = fish.sizeInfo ? `<div style="margin-top:6px;color:var(--accent);font-weight:700;">📏 ${fish.sizeInfo}</div>` : '';
  const traitsBlock = fish.idTraits ? `<div style="margin-top:5px;color:var(--muted);">🔍 <b>Приметы вида:</b> ${fish.idTraits}</div>` : '';
  const runInfo = RIVER_ENTERING_SPECIES[fish.id];
  const migrationBlock = runInfo
    ? `<div style="margin-top:5px;color:var(--good);font-weight:700;">🌊 <b>Миграция и заход в реки:</b> ${runInfo.reason}.</div>`
    : '';

  let standAdvice = '';
  if (fish.legal === 'redbook') {
    standAdvice = `⛔ <b>КРАСНАЯ КНИГА (ПОЙМАЛ — ОТПУСТИ):</b> ${fish.baseAdvice} ${fish.handlingAdvice || 'При случайной поимке в прилове бережно отпустите рыбу в воду!'}${migrationBlock}${sizeBlock}${traitsBlock}`;
  } else if (fish.legal === 'introduced') {
    standAdvice = `⚡ <b>Вселенец / Аквакультура:</b> ${fish.baseAdvice} При остывании воды ниже ${fish.tMinStop}°C впадает в оцепенение.${sizeBlock}${traitsBlock}`;
  } else if (iceState === 'ice_safe') {
    standAdvice = `❄️ <b>Подлёдный горизонт (лёд ~${iceThickness} см, рабочая глубина ${depth.toFixed(1)} м):</b> ${fish.baseAdvice}${migrationBlock}${sizeBlock}${traitsBlock}`;
  } else if (iceState === 'ice_danger') {
    standAdvice = `⚠️ <b>Опасный лёд:</b> ${day.iceNote || 'Выход на лёд запрещён!'} С берега: ${fish.baseAdvice}${sizeBlock}`;
  } else if (iceState === 'ice_slush') {
    standAdvice = `🌊❄️ <b>Шуга и забереги (колебания -3..+3°C):</b> ледостава нет, рыба стоит в придонных ямах и затишках на глубине ${depth.toFixed(1)} м. ${fish.baseAdvice}${migrationBlock}${sizeBlock}`;
  } else {
    standAdvice = `📍 <b>Биотоп (${WATER_PROFILES[water]?.shortName || 'водоём'}, горизонт ${depth.toFixed(1)} м):</b> ${fish.baseAdvice}${migrationBlock}${sizeBlock}${traitsBlock}`;
  }

  const rigInfo = calcDynamicRig(method, water, depth, day.windMax, fish, day.waterTemp, iceState);
  const tackleAdvice = fish.legal === 'redbook'
    ? `<div><b>Вероятность прилова на снасть:</b> ${rigInfo.weight} (${rigInfo.line}).</div><div style="margin-top:5px;color:var(--bad);font-weight:700;">⚠️ Целенаправленное изъятие запрещено! Используйте безбородые крючки и отпускайте рыбу прямо в воде.</div>`
    : `<div><b>Оптимальный монтаж сейчас:</b> ${rigInfo.weight} (${rigInfo.line}).</div><div style="margin-top:5px;"><b>Подача и анимация:</b> ${rigInfo.tactic}.</div><div style="margin-top:5px;color:var(--muted);"><b>Арсенал по виду:</b> ${fish.topGear}</div>`;

  let baitAdvice = '';
  const seasonTone = iceState === 'ice_safe'
    ? `❄️ <b>Подлёдный сезон (вода ~${day.waterTemp}°C):</b> приоритет животным насадкам (мотыль, мормыш/бокоплав, опарыш, резка) и деликатным зимним приманкам.`
    : (day.waterTemp <= 10.0
        ? `💧 <b>Холодная вода (~${day.waterTemp}°C):</b> рыба избирательна — лучше всего работают животные насадки, нано-джиг с пассивными слагами/нимфами (0.2–0.8 г) и приманки на длинной паузе.`
        : `☀️ <b>Прогретая вода (~${day.waterTemp}°C):</b> высокая кормовая активность в толще и у дна, отлично работают как животные/растительные насадки, так и мормышинг (нано-джиг), вертушки и мушки.`);
  baitAdvice = `<div>${fish.feedBase || 'Естественный бентос, зоопланктон и сезонные приманки.'}</div><div style="margin-top:6px;color:var(--accent);">${seasonTone}</div>`;

  return { standAdvice, tackleAdvice, baitAdvice };
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
      verdict = `⛔ Кр. книга (прилов ~${score}%)`;
      verdictTone = 'bad';
      customRatingWord = `Активность ${score}% • Отпусти`;
    } else if (isIceDanger) {
      verdict = d.iceSubState === 'spring_rotten_ice'
        ? `⚠️ Рыхлый лёд и промоины`
        : `⚠️ Опасный лёд (~${d.iceThickness} см)`;
      verdictTone = 'bad';
      customRatingWord = 'Выход на лёд опасен';
    } else if (isPressJump) {
      verdict = `⚠️ Скачок давления (${d.dP > 0 ? '+' : ''}${d.dP} мм)`;
      verdictTone = Math.abs(d.dP) >= 8 ? 'bad' : 'warn';
      customRatingWord = score < 35 ? 'Клёва нет' : (score < 50 ? 'Слабый клёв' : 'Умеренный клёв • Нестабильно');
    } else if (isArchiveShock && score < 62) {
      verdict = `⚠️ Барический «шок» (архив)`;
      verdictTone = 'warn';
      customRatingWord = score < 40 ? 'Слабый клёв • В «шоке»' : 'Осторожный клёв';
    } else if (isGale) {
      verdict = `⚠️ Штормовой ветер (${d.windMax} м/с)`;
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
          ${createPill({ icon: '💧', text: `Вода ${d.waterTemp}°C`, tone: wtTone })}
          ${createPill({ icon: '🧭', text: `${d.pressAvg} мм (${fmtDeltaPress(d.dP)})`, tone: pTone })}
          ${createPill({ icon: '💨', text: `${d.windDir} ${d.windMax} м/с`, tone: wTone })}
          ${createPill({ icon: d.moon.phaseIcon, text: `${d.moon.moonDay} л.д.`, tone: 'neutral' })}
          ${createPill({ icon: dayIce === 'open_water' ? '🌊' : '❄️', text: iceText, tone: iceTone })}
        </div>
        <p style="font-size:var(--fs-xs);color:var(--muted);line-height:1.42;">
          ${fish.legal === 'redbook'
            ? `⛔ Поймал — отпусти! Биоактивность вида: ${topNotes}.`
            : (dayIce === 'ice_danger'
                ? (d.iceNote || '⚠️ Выход на тонкий или весенний рыхлый лёд смертельно опасен! Допустима только береговая ловля.')
                : `${topNotes}.`)}
        </p>
        <div style="display:flex;justify-content:space-between;align-items:center;padding-top:8px;border-top:1px solid var(--border);gap:8px;">
          <div>
            ${renderFiveFish(score, 17, curTheme, true, customRatingWord)}
          </div>
          ${dayIdx === 2 && fish.legal !== 'redbook'
            ? `<button type="button" class="btn btn-sm btn-good" data-catch-today="2">🎣 Я поймал</button>`
            : `<span style="font-size:var(--fs-xs);color:var(--muted);font-weight:700;">${fish.legal === 'redbook' ? 'Красная книга' : '7 факторов'}</span>`}
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div>
      <div class="section-head">
        <span class="section-title">⚡ Экспресс-сводка (3 дня • 7-факторная модель + Журнал)</span>
        <span style="font-size:var(--fs-xs);color:var(--muted);">Клик по карточке открывает почасовой разбор дня</span>
      </div>
      <div class="express-grid">${cardsHtml}</div>
    </div>
  `;
}

/**
 * Плитки в прогнозе не меняем: остаются 2 архивных (Позавчера, Вчера), Сегодняшний и 9 будущих (всего 12 плиток).
 */
export function renderWeek(container) {
  if (!container) return;
  const prevScroll = container.querySelector('.week-strip')?.scrollLeft || 0;
  const s = store.getState();
  const fish = FISH_DB.find(f => f.id === s.fishId) || FISH_DB[0];
  const curTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const days = s.weatherDays || [];

  container.innerHTML = `
    <div class="card">
      <div class="section-head">
        <div>
          <span class="section-title">📆 Прогноз клёва (10 дней) и архив (2 дня + 5-дневный кэш 10 км) • ${fish.name}</span>
          <div style="font-size:var(--fs-xs);color:var(--muted);">Позавчера и Вчера — быстрый вход в архив записи улова (по календарю доступно до 5 дней и глубже) • Сегодня и Завтра — расширенный разбор</div>
        </div>
        <button type="button" class="btn btn-sm" id="fcCleanArchiveBtn" title="Очистить старый архив погоды, кроме последних 5 дней">🧹 Очистить архив погоды</button>
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
                <div style="font-weight:800;font-size:11.5px;color:var(--muted);">📓 ${d.relTitle}</div>
                <div style="font-weight:700;font-size:12px;">${d.label}</div>
                <div style="font-size:var(--fs-sm);font-weight:800;">${d.tDay > 0 ? '+' + d.tDay : d.tDay}° / ${d.tNight > 0 ? '+' + d.tNight : d.tNight}°C</div>
                <div style="font-size:11px;color:var(--muted);line-height:1.3;">
                  💧 ${d.waterTemp}°C • 🧭 ${d.pressAvg} мм
                </div>
                <div style="margin-top:auto;padding-top:4px;border-top:1px dashed var(--border);">
                  <span style="color:var(--accent);font-size:11px;font-weight:800;">🎣 Внести улов →</span>
                </div>
              </div>
            `;
          }

          const topBadge = idx === 2
            ? `<span class="pill pill-good" style="font-size:11px;padding:2px 8px;">🔥 Сегодня</span>`
            : (idx === 3
                ? `<span class="pill pill-ice" style="font-size:11px;padding:2px 8px;">⚡ Завтра</span>`
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
                💧 Вода ${d.waterTemp}°C<br>
                🧭 ${d.pressAvg} мм (${fmtDeltaPress(d.dP)})<br>
                💨 ${d.windDir} ${d.windMax} м/с
              </div>
              ${isPriority ? `
                <div style="padding:4px 7px;border-radius:6px;background:var(--panel);border:1px solid var(--border);font-size:11.5px;line-height:1.35;">
                  <div style="color:var(--accent);font-weight:800;">⏰ Пик клёва: ${bestWindow}</div>
                  <div style="color:var(--muted);">🌅 ${fmtHM(d.sunriseHr)}–${fmtHM(d.sunsetHr)} • ${d.moon.phaseIcon} ${d.moon.moonDay} л.д.</div>
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
    <div class="card">
      <div class="section-head">
        <span class="section-title">⏱️ Почасовой график клёва (0–24 ч) • ${day.relTitle ? day.relTitle + ' (' + day.label + ')' : day.label}</span>
        <span style="font-size:var(--fs-xs);color:var(--muted);">🌅 Зорьки и 🌕 лунные выходы отмечены значками • Нажмите на час для подробностей</span>
      </div>

      ${fish.legal === 'redbook' ? `
        <div style="padding:10px 12px;margin-bottom:10px;border-radius:var(--r-sm);background:var(--pill-bad-bg);border:1px solid var(--bad);color:var(--pill-bad-text);font-weight:700;line-height:1.42;font-size:var(--fs-xs);">
          ⛔ <b>${fish.name} — Красная книга (изъятие запрещено).</b> Ниже показан биологический прогноз активности вида (вероятность поклёвки в прилове). При поимке бережно отпустите рыбу!
        </div>
      ` : ''}

      <div class="bite-timeline" role="listbox" aria-label="Почасовой график клёва">
        ${day.hours.map(hr => {
          const sc = calcHourly(fish, day, hr, s.method, s.water, s.depth, s.normPress, s.iceState);
          const col = sc >= 60 ? 'var(--good)' : (sc >= 38 ? 'var(--warn)' : 'var(--bad)');
          const isNow = s.dayIdx === 2 && hr.hour === curH;
          const isTw = Math.abs(hr.hour + 0.5 - day.sunriseHr) <= 1.1 || Math.abs(hr.hour + 0.5 - day.sunsetHr) <= 1.1;
          const isLunar = hr.hour === day.moon.transitHour || hr.hour === day.moon.underfootHour;
          const mark = isTw ? '🌅' : (isLunar ? '🌕' : '·');
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
            Воздух ${selHrObj.tAir > 0 ? '+' + selHrObj.tAir : selHrObj.tAir}°C • Вода ~${day.waterTemp}°C • 🧭 ${selHrObj.press} мм (за 3ч: ${fmtDeltaPress(selHrObj.dp3h)}) • 💨 ${selHrObj.windDir} ${selHrObj.wind} м/с
          </div>
          <div style="font-size:var(--fs-xs);color:var(--accent);margin-top:5px;line-height:1.42;">
            Рекомендуемая оснастка: <b>${rig.weight}</b> (${rig.line}) • ${rig.tactic}
          </div>
          <div style="margin-top:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <label for="fcSeasonalBaitSel" style="font-size:var(--fs-xs);color:var(--muted);font-weight:700;">СЕЗОННАЯ НАЖИВКА / ПРИМАНКА:</label>
            <select id="fcSeasonalBaitSel" style="max-width:360px;min-height:36px;padding:4px 10px;font-size:var(--fs-xs);">
              ${seasonalBaits.map(b => `<option value="${b}" ${b === activeBait ? 'selected' : ''}>${b}</option>`).join('')}
            </select>
          </div>
        </div>
        <div>
          ${renderFiveFish(selBreakdown.total, 19, curTheme, true, fish.legal === 'redbook' ? `Активность ${selBreakdown.total}% • Отпусти` : null)}
        </div>
      </div>

      <details open style="margin-top:12px;">
        <summary style="cursor:pointer;font-weight:800;font-size:var(--fs-md);color:var(--accent);">
          🔍 Почему такой прогноз? (7-факторный анализ + кэш 10 км и Журнал на ${String(selH).padStart(2, '0')}:00 — Итог ${selBreakdown.total}%)
        </summary>
        <div style="margin-top:8px;padding:12px;background:var(--card);border-radius:var(--r-sm);">
          ${selBreakdown.hasRealArchive === false ? `
            <div style="padding:9px 11px;margin-bottom:10px;border-radius:var(--r-sm);background:var(--pill-warn-bg);border:1px solid var(--warn);color:var(--pill-warn-text);font-size:var(--fs-xs);font-weight:800;line-height:1.42;">
              ⚠️ Прогноз может быть менее точным из-за отсутствия архивных данных по погоде (это первый запрос в данной локации 10 км при недоступности внешнего сервера архива; со следующего дня архив накопится автоматически на вашем устройстве).
            </div>
          ` : ''}

          <div style="padding:9px 11px;margin-bottom:10px;border-radius:var(--r-sm);background:var(--panel);border:1px solid var(--border);font-size:var(--fs-xs);line-height:1.45;">
            <div><b>📊 Анализ 5-дневного метеоархива (радиус 10 км):</b> ${selBreakdown.archiveEval?.commentary || ''}</div>
            <div style="margin-top:5px;color:var(--accent);"><b>📓 Анализ вашего Журнала уловов:</b> ${selBreakdown.logInsight?.commentary || ''}</div>
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
            ⚖️ ${RU.forecastDisclaimer}
          </p>
        </div>
      </details>

      <div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border);">
        <div class="section-title">🧭 Ихтиология, снасти и кормовая база: ${fish.name} (${s.depth.toFixed(1)} м)</div>
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
    .filter(f => f.legal !== 'redbook' && f.basins.includes(s.basinCode))
    .sort((a, b) => (favSet.has(b.id) ? 1 : 0) - (favSet.has(a.id) ? 1 : 0));

  container.innerHTML = `
    <div class="card" style="border-color:var(--accent);">
      <div class="section-head">
        <div>
          <span class="section-title">📓 Архив погоды (10 км) и запись улова за предыдущие 5 дней (${activeDayObj.label || activeDateStr})</span>
          <div style="font-size:var(--fs-xs);color:var(--muted);margin-top:2px;">
            Выберите любую дату за последние 5 дней (или через обычный календарь) — почасовой прогноз из кэша локации подставится автоматически!
          </div>
        </div>
        ${createPill({ text: `Архив: ${activeDateStr}`, tone: 'purple', icon: '📅' })}
      </div>

      <div style="margin-bottom:12px;padding:10px 12px;background:var(--card);border:1px solid var(--border);border-radius:var(--r-sm);">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
          <label for="archCalendarDate" style="font-size:var(--fs-xs);font-weight:800;color:var(--accent);">📅 ВЫБЕРИТЕ ДАТУ ВЫЕЗДА (КАЛЕНДАРЬ ИЛИ БЫСТРЫЕ 5 ДНЕЙ):</label>
          <input type="date" id="archCalendarDate" class="input" value="${activeDateStr}" max="${todayStr}" style="max-width:190px;min-height:34px;padding:4px 10px;">
        </div>
        <div class="chip-scroll-row">
          ${past5Dates.map(item => `
            <button type="button" class="w-chip ${item.date === activeDateStr ? 'active' : ''}" data-arch-quick-date="${item.date}">
              📅 ${item.title} (${item.label}) ${item.dayObj ? `• ${item.dayObj.tDay > 0 ? '+' + item.dayObj.tDay : item.dayObj.tDay}°C, ${item.dayObj.pressAvg} мм` : ''}
            </button>
          `).join('')}
        </div>
      </div>

      <div style="padding:10px 12px;border-radius:var(--r-sm);background:var(--card);margin-bottom:12px;font-size:var(--fs-xs);color:var(--accent);font-weight:700;">
        📸 Почасовой метеоархив из кэша 10 км (${activeDayObj.label || activeDateStr}, ${String(selH).padStart(2, '0')}:00): Воздух ${selHrObj.tAir > 0 ? '+' + selHrObj.tAir : selHrObj.tAir}°C • Вода ~${activeDayObj.waterTemp}°C • 🧭 ${selHrObj.press} мм (Δ ${fmtDeltaPress(activeDayObj.dP)}) • 💨 ${selHrObj.windDir} ${selHrObj.wind} м/с • ${activeDayObj.moon?.phaseIcon || '🌒'} ${activeDayObj.moon?.moonDay || 12} л.д.
      </div>

      <div class="controls-grid" style="margin-bottom:12px;">
        <div>
          <label style="display:block;font-size:var(--fs-xs);color:var(--muted);font-weight:700;margin-bottom:3px;">ШАГ 1. ПОЙМАННАЯ РЫБА (ИЗБРАННЫЕ ВВЕРХУ)</label>
          <select id="archFishSel">
            ${legalSpecies.map(f => `<option value="${f.id}" ${f.id === currentFish.id ? 'selected' : ''}>${favSet.has(f.id) ? '⭐ ' : ''}${f.name}</option>`).join('')}
          </select>
        </div>

        <div>
          <label style="display:block;font-size:var(--fs-xs);color:var(--muted);font-weight:700;margin-bottom:3px;">ШАГ 2. СНАСТЬ (ПОДХОДЯЩАЯ ПОД РЫБУ)</label>
          <select id="archMethodSel">
            ${compatibleMethods.map(m => `<option value="${m.val}" ${m.val === currentMethodVal ? 'selected' : ''}>${m.text}</option>`).join('')}
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
            ${(s.nearbyWaters || []).map(w => `<option value="${w.wType}|${w.name || w.label}" ${s.selectedWaterName === w.name ? 'selected' : ''}>${w.label}</option>`).join('')}
            ${availWaters.map(w => `<option value="${w.id}|${w.shortName}">${w.name}</option>`).join('')}
          </select>
        </div>

        <div>
          <label style="display:block;font-size:var(--fs-xs);color:var(--muted);font-weight:700;margin-bottom:3px;">ШАГ 5. ЧАС ПОИМКИ (ПОЧАСОВОЙ КЭШ НА ${activeDateStr})</label>
          <select id="archHourSel">
            ${(activeDayObj.hours || []).map(hr => `<option value="${hr.hour}" ${hr.hour === selH ? 'selected' : ''}>${String(hr.hour).padStart(2, '0')}:00 (воздух ${hr.tAir > 0 ? '+' + hr.tAir : hr.tAir}°C, ${hr.press} мм, ${hr.windDir} ${hr.wind} м/с)</option>`).join('')}
          </select>
        </div>

        <div style="display:flex;align-items:flex-end;">
          <button type="button" class="btn btn-good" id="archOpenCatchBtn" data-arch-active-date="${activeDateStr}" style="width:100%;">🎣 Записать улов (${activeDayObj.label || activeDateStr}, ${String(selH).padStart(2, '0')}:00)</button>
        </div>
      </div>
    </div>
  `;
}

function clampHour(h) {
  const n = parseInt(h, 10);
  return Number.isFinite(n) ? Math.max(0, Math.min(23, n)) : 12;
}

export function render(container) {
  if (!container) return;
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
}

function bindForecastEvents(container) {
  container.querySelectorAll('[data-express-day]').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-catch-today]')) return;
      selectedArchiveDateOverride = null;
      const idx = parseInt(card.getAttribute('data-express-day'), 10);
      store.dispatch({ type: 'SET_DAY', payload: idx });
    });
  });

  const catchTodayBtn = container.querySelector('[data-catch-today]');
  if (catchTodayBtn) {
    catchTodayBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedArchiveDateOverride = null;
      store.dispatch({ type: 'SET_DAY', payload: 2 });
      const s = store.getState();
      events.emit('forecast:hourSelected', { dayIdx: 2, date: s.weatherDays[2]?.date, hour: s.selectedHour, bait: s.selectedBait });
    });
  }

  container.querySelectorAll('[data-week-day]').forEach(card => {
    card.addEventListener('click', () => {
      selectedArchiveDateOverride = null;
      const idx = parseInt(card.getAttribute('data-week-day'), 10);
      store.dispatch({ type: 'SET_DAY', payload: idx });
    });
  });

  const cleanBtn = container.querySelector('#fcCleanArchiveBtn');
  if (cleanBtn) {
    cleanBtn.addEventListener('click', () => {
      const res = storage.clearWeatherArchiveKeep5Days();
      showToast(`🧹 Архив погоды очищен: удалено старых записей — ${res.removedCount}, сохранены последние 5 дней архива (${res.keptArchiveCount} дн.)`, 'good');
      render(container);
    });
  }

  container.querySelectorAll('[data-scrub-hour]').forEach(btn => {
    btn.addEventListener('click', () => {
      const hr = parseInt(btn.getAttribute('data-scrub-hour'), 10);
      store.dispatch({ type: 'SET_HOUR', payload: hr });
    });
  });

  const baitSel = container.querySelector('#fcSeasonalBaitSel');
  if (baitSel) {
    baitSel.addEventListener('change', (e) => {
      store.dispatch({ type: 'SET_BAIT', payload: e.target.value });
    });
  }

  // Обработчики выбора даты в 5-дневном архиве и обычном календаре
  const archCalInput = container.querySelector('#archCalendarDate');
  if (archCalInput) {
    archCalInput.addEventListener('change', (e) => {
      if (e.target.value) {
        selectedArchiveDateOverride = e.target.value;
        renderHourly(container.querySelector('#fcHourlyBox'));
        bindForecastEvents(container);
      }
    });
  }

  container.querySelectorAll('[data-arch-quick-date]').forEach(btn => {
    btn.addEventListener('click', () => {
      const dStr = btn.getAttribute('data-arch-quick-date');
      if (dStr) {
        selectedArchiveDateOverride = dStr;
        renderHourly(container.querySelector('#fcHourlyBox'));
        bindForecastEvents(container);
      }
    });
  });

  const archFish = container.querySelector('#archFishSel');
  const archMethod = container.querySelector('#archMethodSel');
  const archBait = container.querySelector('#archBaitSel');

  if (archFish) {
    archFish.addEventListener('change', (e) => {
      const newFishId = e.target.value;
      const s = store.getState();
      const fObj = FISH_DB.find(x => x.id === newFishId) || FISH_DB[0];
      store.dispatch({ type: 'SET_FISH', payload: newFishId });

      const dayObj = s.weatherDays[s.dayIdx] || s.weatherDays[2] || s.weatherDays[0] || {};
      const newMethods = getCompatibleMethods(fObj, dayObj.iceState || s.iceState, s.water, dayObj.waterTemp ?? 12);
      if (archMethod) {
        archMethod.innerHTML = newMethods.map(m => `<option value="${m.val}">${m.text}</option>`).join('');
        const chosenMethod = newMethods[0]?.val;
        store.dispatch({ type: 'SET_METHOD', payload: chosenMethod });

        const day = s.weatherDays[s.dayIdx] || s.weatherDays[2] || s.weatherDays[0] || {};
        const newBaits = getSeasonalBaitsForContext(fObj, chosenMethod, day.waterTemp ?? 12, day.iceState || s.iceState);
        if (archBait) {
          archBait.innerHTML = newBaits.map(b => `<option value="${b}">${b}</option>`).join('');
          store.dispatch({ type: 'SET_BAIT', payload: newBaits[0] || '' });
        }
      }
    });
  }

  if (archMethod) {
    archMethod.addEventListener('change', (e) => {
      const chosenMethod = e.target.value;
      store.dispatch({ type: 'SET_METHOD', payload: chosenMethod });
      const s = store.getState();
      const fObj = FISH_DB.find(x => x.id === s.fishId) || FISH_DB[0];
      const day = s.weatherDays[s.dayIdx] || s.weatherDays[2] || s.weatherDays[0] || {};
      const newBaits = getSeasonalBaitsForContext(fObj, chosenMethod, day.waterTemp ?? 12, day.iceState || s.iceState);
      if (archBait) {
        archBait.innerHTML = newBaits.map(b => `<option value="${b}">${b}</option>`).join('');
        store.dispatch({ type: 'SET_BAIT', payload: newBaits[0] || '' });
      }
    });
  }

  if (archBait) {
    archBait.addEventListener('change', (e) => {
      store.dispatch({ type: 'SET_BAIT', payload: e.target.value });
    });
  }

  const archHour = container.querySelector('#archHourSel');
  if (archHour) {
    archHour.addEventListener('change', (e) => {
      store.dispatch({ type: 'SET_HOUR', payload: parseInt(e.target.value, 10) });
    });
  }

  const archWater = container.querySelector('#archWaterSel');
  if (archWater) {
    archWater.addEventListener('change', (e) => {
      const [wType, wName] = e.target.value.split('|');
      store.dispatch({ type: 'SET_WATER', payload: { water: wType, selectedWaterName: wName } });
    });
  }

  const archBtn = container.querySelector('#archOpenCatchBtn');
  if (archBtn) {
    archBtn.addEventListener('click', () => {
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
    });
  }
}

let unsub = null;

export function init(container) {
  render(container);
  unsub = store.subscribe(
    s => ({
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
      catches: s.catches,
      iceState: s.iceState,
      theme: s.theme
    }),
    () => render(container)
  );
}

export function destroy() {
  if (unsub) unsub();
}

export const forecastModule = {
  RIVER_ENTERING_SPECIES,
  getPreceding5DaysForTarget,
  evaluate5DayArchiveAndBaricShock,
  evaluateLogbookInsight,
  computeHourFactors,
  calcHourly,
  calcDayBest,
  getBestBiteWindowText,
  getFactorBreakdown,
  calcDynamicRig,
  generateAdaptiveGuides,
  renderExpress,
  renderWeek,
  renderHourly,
  init,
  render,
  destroy
};
