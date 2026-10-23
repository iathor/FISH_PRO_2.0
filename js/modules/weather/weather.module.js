import { RU } from '../../i18n/ru.js?v=2.0.13';
import { events } from '../../core/events.js?v=2.0.13';
import { storage } from '../../core/storage.js?v=2.0.13';
import { store } from '../../core/store.js?v=2.0.13';
import { fetchWithTimeout, fallbackChain } from '../../core/http.js?v=2.0.13';
import { formatLocalYYYYMMDD, fmtHM, fmtDeltaPress } from '../../core/format.js?v=2.0.13';
import { WATER_PROFILES } from '../../data/waters.js?v=2.0.13';
import { createPill } from '../../ui/components.js?v=2.0.13';

const DIRS = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];

export function computeMoon(dateStr) {
  const dt = new Date(dateStr + 'T12:00:00Z');
  const syn = 29.53058867;
  const KNOWN_NEW_MOON = new Date('2026-10-10T15:50:00Z');
  const age = (((dt - KNOWN_NEW_MOON) / 86400000) % syn + syn) % syn;
  const ratio = age / syn;
  const illum = Math.round((1 - Math.cos(ratio * 2 * Math.PI)) * 50);
  const moonDay = Math.max(1, Math.min(30, Math.floor(age) + 1));
  const transitHour = Math.round((12 + ratio * 24) % 24);
  const underfootHour = (transitHour + 12) % 24;
  const riseHour = (transitHour + 18) % 24;
  const setHour = (transitHour + 6) % 24;
  let phaseName = 'Растущая луна';
  let phaseIcon = '🌒';
  if (moonDay === 1 || moonDay >= 29) { phaseName = 'Новолуние'; phaseIcon = '🌑'; }
  else if (moonDay >= 14 && moonDay <= 16) { phaseName = 'Полнолуние'; phaseIcon = '🌕'; }
  else if (moonDay >= 7 && moonDay <= 8) { phaseName = 'Первая четверть'; phaseIcon = '🌓'; }
  else if (moonDay >= 22 && moonDay <= 23) { phaseName = 'Последняя четверть'; phaseIcon = '🌗'; }
  else if (moonDay > 16) { phaseName = 'Убывающая луна'; phaseIcon = '🌘'; }
  return {
    moonDay,
    illum,
    transitHour,
    underfootHour,
    riseHour,
    setHour,
    phaseName,
    phaseIcon,
    majorWindows: [`${String(transitHour).padStart(2, '0')}:00–${String((transitHour + 2) % 24).padStart(2, '0')}:00`, `${String(underfootHour).padStart(2, '0')}:00–${String((underfootHour + 2) % 24).padStart(2, '0')}:00`],
    minorWindows: [`${String(riseHour).padStart(2, '0')}:00–${String((riseHour + 1) % 24).padStart(2, '0')}:00`, `${String(setHour).padStart(2, '0')}:00–${String((setHour + 1) % 24).padStart(2, '0')}:00`]
  };
}

/**
 * Ревизия 2.0.13 (Пункт 5a): Физически точный расчёт ледостава и сезона ловли
 * - Учитывает скорость течения водоёма (flow из WATER_PROFILES): на быстрых реках лёд встаёт позже и тоньше
 * - При колебаниях температуры в пределах -3..+3 °C ледостава нет — режим «Шуга и забереги» (ice_slush)
 * - Весной (март–май) при наличии накопленного льда и высокой дневной температуре (+3 °C и выше) — режим опасности «Рыхлый весенний лёд и промоины» (ice_danger)
 * - При устойчивом многодневном минусе — расчёт толщины льда по формуле Стефана-Быдина с поправкой на течение
 */
export function evaluateDayIce(historyMeanTemps, tDayMax, tNightMin, waterTemp, waterType = 'small_river', dateStr = '') {
  if (waterType === 'cooling_reservoir') {
    return {
      iceState: 'open_water',
      iceSubState: 'warm_discharge',
      iceThickness: 0,
      iceNote: '🌊 Тёплый сброс ГРЭС/АЭС — круглогодично открытая вода'
    };
  }

  const prof = WATER_PROFILES[waterType] || WATER_PROFILES.small_river;
  const flow = Number.isFinite(prof.flow) ? prof.flow : 1.0;
  // На течении (flow > 1) нарастание льда замедляется, в стоячей воде (flow < 1) ускоряется
  const flowFactor = 1 / Math.pow(Math.max(0.4, flow), 0.45);
  const flowLabel = flow >= 1.8 ? 'быстрое течение' : (flow >= 1.1 ? 'умеренное течение' : 'стоячая вода / слабый ток');

  const dt = dateStr ? new Date(dateStr + 'T12:00:00') : new Date();
  const monthNum = dt.getMonth() + 1; // 1..12
  const isSpring = monthNum >= 3 && monthNum <= 5;
  const isWinterOrSpring = monthNum === 12 || monthNum <= 5;

  const recent = Array.isArray(historyMeanTemps) && historyMeanTemps.length > 0
    ? historyMeanTemps
    : [(tDayMax + tNightMin) / 2];

  // Считаем накопленные градусо-сутки мороза (FDD) и тепла (TDD)
  let freezeSum = 0;
  let freezeDays = 0;
  let recentWarmDays = 0;
  let warmDegreeDays = 0;

  for (let i = recent.length - 1; i >= 0; i--) {
    const m = recent[i];
    const daysAgo = recent.length - 1 - i;
    if (m <= -0.3) {
      freezeDays++;
      // Быстрое течение требует более сильного мороза для образования кристаллической решётки
      const effFreeze = Math.max(0, Math.abs(m) - (flow > 1.5 ? 1.1 : (flow > 1.0 ? 0.4 : 0)));
      freezeSum += effFreeze;
    } else {
      if (daysAgo <= 3 && m > 0.5) {
        recentWarmDays++;
        warmDegreeDays += m;
      }
      if (daysAgo <= 2 && m > 2.5 && !isWinterOrSpring) {
        break;
      }
    }
  }

  const tCurMean = (tDayMax + tNightMin) / 2;
  const last4 = recent.slice(-4);
  const isOscillatingAroundZero =
    last4.every(m => m >= -3.3 && m <= 3.3) &&
    tDayMax >= -2.5 && tDayMax <= 3.5 &&
    tNightMin >= -4.8 && tNightMin <= 2.5;

  // Оценка накопленной толщины льда с учётом скорости течения и весеннего стаивания
  const rawIceCm = Math.round(2.35 * Math.sqrt(Math.max(0, freezeSum)) * flowFactor - warmDegreeDays * 0.85);
  const effectiveIceCm = Math.max(0, Math.min(120, rawIceCm));

  // 1. ВЕСЕННЕЕ ПОТЕПЛЕНИЕ ПРИ НАЛИЧИИ ЛЬДА -> ОПАСНЫЙ РЫХЛЫЙ ЛЁД И ПРОМОИНЫ
  if ((isSpring || recentWarmDays >= 2) && (effectiveIceCm >= 5 || freezeDays >= 4) && (tDayMax >= 3.0 || tCurMean >= 0.8 || warmDegreeDays >= 4)) {
    const remThick = Math.max(4, effectiveIceCm || 12);
    return {
      iceState: 'ice_danger',
      iceSubState: 'spring_rotten_ice',
      iceThickness: remThick,
      iceNote: `⚠️ Опасный весенний лёд (~${remThick} см, ${flowLabel}): дневной прогрев до +${tDayMax}°C, рыхлый игольчатый лёд, промоины и закраины — выход на лёд смертельно опасен!`
    };
  }

  // 2. КОЛЕБАНИЯ ТЕМПЕРАТУРЫ В ПРЕДЕЛАХ -3 .. +3 °C (без накопленного толстого монолита) -> ЛЕДОСТАВА НЕТ, ШУГА И ЗАБЕРЕГИ
  if (isOscillatingAroundZero && effectiveIceCm < 10 && freezeSum < 28) {
    if (tNightMin <= 0.5 || tCurMean <= 1.8 || waterTemp <= 2.5) {
      return {
        iceState: 'ice_slush',
        iceSubState: 'slush_shore_ice',
        iceThickness: 0,
        iceNote: `🌊❄️ Шуга и забереги (колебания ${tNightMin > 0 ? '+' + tNightMin : tNightMin}..${tDayMax > 0 ? '+' + tDayMax : tDayMax}°C, ${flowLabel}): сплошного ледостава нет, береговая ловля по холодной воде`
      };
    }
    return {
      iceState: 'open_water',
      iceSubState: 'cold_open_water',
      iceThickness: 0,
      iceNote: `🌊 Открытая прохладная вода (${flowLabel}, льда нет)`
    };
  }

  // 3. УСТОЙЧИВЫЙ МИНУС НЕСКОЛЬКО ДНЕЙ ПОДРЯД -> РАСЧЁТ СТЕПЕНИ ЛЕДОСТАВА С УЧЁТОМ ТЕЧЕНИЯ
  const minSafeCm = flow >= 1.8 ? 12 : (flow >= 1.1 ? 10 : 8);
  const minFreezeDays = flow >= 1.8 ? 4 : 3;

  if (freezeDays >= minFreezeDays && effectiveIceCm >= minSafeCm && tDayMax <= 1.5) {
    return {
      iceState: 'ice_safe',
      iceSubState: 'solid_freeze',
      iceThickness: effectiveIceCm,
      iceNote: `❄️ Устойчивый ледостав: безопасный монолитный лёд ~${effectiveIceCm} см (с учётом течения: ${flowLabel})`
    };
  }

  // 4. ТОНКИЙ ПЕРВОЛЁДОК (мороз стоит, но с учётом течения лёд ещё тоньше безопасного порога)
  if ((tCurMean <= -1.5 || (tDayMax <= 0 && tNightMin <= -3.5)) && (effectiveIceCm >= 2 || freezeSum >= 6) && waterTemp <= 2.2) {
    const thinCm = Math.max(2, Math.min(minSafeCm - 1, effectiveIceCm || 4));
    return {
      iceState: 'ice_danger',
      iceSubState: 'thin_first_ice',
      iceThickness: thinCm,
      iceNote: `⚠️ Тонкий перволёдок (~${thinCm} см, ${flowLabel}): лёд ещё не набрал безопасную толщину (${minSafeCm} см) — выход на лёд запрещён!`
    };
  }

  // 5. Переходный околонулевой режим (ночные заморозки при плюсе днём) -> забереги и шуга
  if (tNightMin <= -1.0 && tDayMax >= -1.0 && waterTemp <= 2.5) {
    return {
      iceState: 'ice_slush',
      iceSubState: 'slush_shore_ice',
      iceThickness: 0,
      iceNote: `🌊❄️ Забереги и редкая шуга (${flowLabel}, ледостава нет)`
    };
  }

  return {
    iceState: 'open_water',
    iceSubState: 'open_water',
    iceThickness: 0,
    iceNote: `🌊 Открытая вода (льда нет, ${flowLabel})`
  };
}

function getRelativeDayTitle(relOffset) {
  if (relOffset === -2) return 'Позавчера';
  if (relOffset === -1) return 'Вчера';
  if (relOffset === 0) return 'Сегодня';
  if (relOffset === 1) return 'Завтра';
  if (relOffset === 2) return 'Послезавтра';
  return '';
}

export function buildFallback(lat = 55.75, waterType = 'small_river') {
  const todayDt = new Date();
  todayDt.setHours(0, 0, 0, 0);
  const dayOfYear = Math.floor((todayDt - new Date(todayDt.getFullYear(), 0, 0)) / 86400000);
  const seasonOffset = -Math.cos(((dayOfYear + 10) / 365) * 2 * Math.PI);
  const latBase = Math.abs(lat);
  const meanT = 22 - (latBase - 40) * 0.9;
  const amplitude = 11 + (latBase - 40) * 0.45;
  const allMeanT = [];
  for (let rel = -7; rel <= 9; rel++) {
    const tMax = Math.round(meanT + seasonOffset * amplitude - rel * 0.2);
    const tMin = tMax - 6;
    allMeanT.push((tMax + tMin) / 2);
  }
  let runningWaterT = Math.max(0.2, Math.min(24, allMeanT[0] * 0.52 + 2.5));
  for (let k = 0; k < 5; k++) {
    const tgt = Math.max(0.2, Math.min(25, allMeanT[k] * 0.52 + 2.5));
    runningWaterT = runningWaterT * 0.72 + tgt * 0.28;
  }
  const days = [];
  for (let idx = 0; idx < 12; idx++) {
    const rel = idx - 2; // -2 .. +9
    const cur = new Date(todayDt.getTime() + rel * 86400000);
    const dStr = formatLocalYYYYMMDD(cur);
    const moon = computeMoon(dStr);
    const meanDayT = allMeanT[idx + 5];
    const tMax = Math.round(meanDayT + 3);
    const tMin = Math.round(meanDayT - 3);
    const targetWT = Math.max(0.2, Math.min(25, meanDayT * 0.52 + 2.5));
    runningWaterT = runningWaterT * 0.72 + targetWT * 0.28;
    const waterTemp = waterType === 'cooling_reservoir'
      ? Math.max(8, Math.min(30, Math.round((tMax * 0.2 + 18) * 10) / 10))
      : Math.max(0.2, Math.min(25, Math.round(runningWaterT * 10) / 10));
    const pAvg = Math.round(754 + Math.sin(idx * 0.7) * 4);
    const dP = Math.round(Math.cos(idx) * 3);
    const wMax = Math.round(3 + Math.abs(Math.sin(idx)) * 3);
    const hours = [];
    for (let h = 0; h < 24; h++) {
      const wave = Math.sin(((h - 5) / 24) * 2 * Math.PI);
      hours.push({
        hour: h,
        tAir: Math.round((tMin + (tMax - tMin) * ((wave + 1) / 2)) * 10) / 10,
        press: Math.round(pAvg + (dP * (h - 12)) / 24),
        dp3h: Math.round((dP / 8) * 10) / 10,
        wind: Math.max(1, wMax),
        windDir: DIRS[(idx + h) % 8],
        cloud: 65,
        precip: 0
      });
    }
    const histSlice = allMeanT.slice(0, idx + 6);
    const ice = evaluateDayIce(histSlice, tMax, tMin, waterTemp, waterType, dStr);
    days.push({
      date: dStr,
      relOffset: rel,
      isArchive: rel < 0,
      relTitle: getRelativeDayTitle(rel),
      label: `${RU.daysShort[cur.getDay()]}, ${cur.getDate()} ${RU.monthsGen[cur.getMonth()]}`,
      tDay: tMax,
      tNight: tMin,
      pressAvg: pAvg,
      dP,
      windMax: Math.max(1, wMax),
      windDir: hours[12].windDir,
      sunriseHr: 6.8 + idx * 0.02,
      sunsetHr: 18.2 - idx * 0.02,
      waterTemp,
      iceState: ice.iceState,
      iceSubState: ice.iceSubState,
      iceThickness: ice.iceThickness,
      iceNote: ice.iceNote,
      moon,
      hours
    });
  }
  const todayObj = days[2] || days[0];
  return {
    days,
    elevation: 90,
    normPress: 752,
    iceState: todayObj.iceState,
    iceSubState: todayObj.iceSubState,
    iceThickness: todayObj.iceThickness,
    iceNote: todayObj.iceNote
  };
}

/**
 * Ревизия 2.0.13 (Пункт 5a): Точная привязка архивных дней («Позавчера», «Вчера») и «Сегодня»
 * по локальной календарной дате YYYY-MM-DD (при past_days=7 у нас есть полная 7-дневная история для расчёта льда и воды,
 * а массив 12 карточек начинается строго с todayIdx - 2 = Позавчера!).
 */
function normalizeOpenMeteo(data, waterType) {
  const elevation = Math.round(data.elevation || 90);
  const normPress = Math.round(760 - elevation / 11.5);
  const allP = data.hourly.surface_pressure.map(v => (v || 1010) * 0.750062);
  const times = Array.isArray(data.daily?.time) ? data.daily.time : [];
  const totalDays = times.length;
  if (totalDays === 0) return null;

  const todayStr = formatLocalYYYYMMDD(new Date());
  let todayIdx = times.indexOf(todayStr);
  if (todayIdx < 0) {
    // Если часовой пояс точки отличается от системного на границе суток, ищем ближайшую дату к todayStr
    const todayMs = new Date(todayStr + 'T00:00:00').getTime();
    let bestDiff = Infinity;
    times.forEach((tStr, idx) => {
      const diff = Math.abs(new Date(tStr + 'T00:00:00').getTime() - todayMs);
      if (diff < bestDiff) {
        bestDiff = diff;
        todayIdx = idx;
      }
    });
  }
  // Стартуем ровно за 2 дня до Сегодня (idx=0 -> Позавчера, idx=1 -> Вчера, idx=2 -> Сегодня)
  const startIdx = Math.max(0, Math.min(totalDays - 12, todayIdx - 2));

  const dailyMeans = times.map((_, idx) => (
    (data.daily.temperature_2m_max[idx] + data.daily.temperature_2m_min[idx]) / 2
  ));

  let runningWT = Math.max(0.2, Math.min(25, dailyMeans[0] * 0.52 + 2.5));
  for (let k = 0; k < startIdx; k++) {
    const tgt = Math.max(0.2, Math.min(25, dailyMeans[k] * 0.52 + 2.5));
    runningWT = runningWT * 0.72 + tgt * 0.28;
  }

  const days = [];
  for (let i = startIdx; i < totalDays && days.length < 12; i++) {
    const outIdx = days.length;
    const rel = outIdx - 2; // -2=Позавчера, -1=Вчера, 0=Сегодня, +1=Завтра...
    const dStr = times[i];
    const dt = new Date(dStr + 'T00:00:00');
    const srD = new Date(data.daily.sunrise[i]);
    const ssD = new Date(data.daily.sunset[i]);
    const hours = [];
    let sumP = 0;
    for (let h = 0; h < 24; h++) {
      const g = i * 24 + h;
      const pMm = allP[g] || 754;
      sumP += pMm;
      hours.push({
        hour: h,
        tAir: Math.round((data.hourly.temperature_2m[g] ?? 0) * 10) / 10,
        press: Math.round(pMm),
        dp3h: Math.round((pMm - (g >= 3 ? allP[g - 3] : pMm)) * 10) / 10,
        wind: Math.round((data.hourly.wind_speed_10m[g] ?? 3) * 10) / 10,
        windDir: DIRS[Math.round(((data.hourly.wind_direction_10m[g] || 0) / 45)) % 8],
        cloud: data.hourly.cloud_cover[g] ?? 50,
        precip: data.hourly.precipitation[g] ?? 0
      });
    }
    const pAvg = Math.round(sumP / 24);
    const prevAvg = i > 0
      ? Math.round(allP.slice((i - 1) * 24, i * 24).reduce((a, b) => a + b, 0) / 24)
      : pAvg;
    const tMax = Math.round(data.daily.temperature_2m_max[i]);
    const tMin = Math.round(data.daily.temperature_2m_min[i]);
    const tgtWT = Math.max(0.2, Math.min(25, dailyMeans[i] * 0.52 + 2.5));
    runningWT = runningWT * 0.72 + tgtWT * 0.28;
    const waterTemp = waterType === 'cooling_reservoir'
      ? Math.max(8, Math.min(30, Math.round((((tMax + tMin) / 2) * 0.2 + 18) * 10) / 10))
      : Math.max(0.2, Math.min(25, Math.round(runningWT * 10) / 10));
    const ice = evaluateDayIce(dailyMeans.slice(0, i + 1), tMax, tMin, waterTemp, waterType, dStr);
    days.push({
      date: dStr,
      relOffset: rel,
      isArchive: rel < 0,
      relTitle: getRelativeDayTitle(rel),
      label: `${RU.daysShort[dt.getDay()]}, ${dt.getDate()} ${RU.monthsGen[dt.getMonth()]}`,
      tDay: tMax,
      tNight: tMin,
      pressAvg: pAvg,
      dP: pAvg - prevAvg,
      windMax: Math.round(data.daily.wind_speed_10m_max[i] || 3),
      windDir: DIRS[Math.round(((data.daily.wind_direction_10m_dominant[i] || 0) / 45)) % 8],
      sunriseHr: srD.getHours() + srD.getMinutes() / 60,
      sunsetHr: ssD.getHours() + ssD.getMinutes() / 60,
      waterTemp,
      iceState: ice.iceState,
      iceSubState: ice.iceSubState,
      iceThickness: ice.iceThickness,
      iceNote: ice.iceNote,
      moon: computeMoon(dStr),
      hours
    });
  }
  const todayObj = days[2] || days[0];
  return {
    days,
    elevation,
    normPress,
    iceState: todayObj?.iceState || 'open_water',
    iceSubState: todayObj?.iceSubState || 'open_water',
    iceThickness: todayObj?.iceThickness || 0,
    iceNote: todayObj?.iceNote || ''
  };
}

function normalizeMetNo(metNo, lat, waterType, prevCachedDays = null) {
  const fb = buildFallback(lat, waterType);
  const coords = metNo.geometry?.coordinates || [];
  const elevation = Math.round(coords[2] || 90);
  const normPress = Math.round(760 - elevation / 11.5);
  const byDate = {};

  // Подставляем сохранённые архивные дни за позавчера/вчера из кэша, если они есть по этой дате
  if (Array.isArray(prevCachedDays)) {
    prevCachedDays.forEach(cd => {
      if (cd && cd.date && Array.isArray(cd.hours) && cd.hours.length === 24) {
        byDate[cd.date] = {};
        cd.hours.forEach((hObj, hIdx) => {
          byDate[cd.date][hIdx] = { ...hObj };
        });
      }
    });
  }

  for (const item of (metNo.properties?.timeseries || [])) {
    const dt = new Date(item.time);
    const dStr = formatLocalYYYYMMDD(dt);
    const hr = dt.getHours();
    if (!byDate[dStr]) byDate[dStr] = {};
    const inst = item.data?.instant?.details || {};
    const pSea = inst.air_pressure_at_sea_level || 1013.25;
    const pMm = pSea * 0.750062 - elevation / 11.5;
    byDate[dStr][hr] = {
      hour: hr,
      tAir: Math.round((inst.air_temperature ?? 0) * 10) / 10,
      press: Math.round(pMm),
      dp3h: 0,
      wind: Math.round((inst.wind_speed ?? 3) * 10) / 10,
      windDir: DIRS[Math.round(((inst.wind_from_direction || 0) / 45)) % 8],
      cloud: Math.round(inst.cloud_area_fraction ?? 50),
      precip: item.data?.next_1_hours?.details?.precipitation_amount ?? 0
    };
  }

  const histMeans = [];
  fb.days.forEach((dayObj, i) => {
    const mapH = byDate[dayObj.date];
    if (mapH) {
      let last = Object.values(mapH)[0];
      for (let h = 0; h < 24; h++) {
        if (mapH[h]) last = mapH[h];
        else if (last) mapH[h] = { ...last, hour: h };
        if (mapH[h]) dayObj.hours[h] = mapH[h];
      }
      for (let h = 0; h < 24; h++) {
        const prevP = h >= 3 ? dayObj.hours[h - 3].press : dayObj.hours[0].press;
        dayObj.hours[h].dp3h = Math.round((dayObj.hours[h].press - prevP) * 10) / 10;
      }
      const tArr = dayObj.hours.map(x => x.tAir);
      const pArr = dayObj.hours.map(x => x.press);
      const wArr = dayObj.hours.map(x => x.wind);
      dayObj.tDay = Math.round(Math.max(...tArr));
      dayObj.tNight = Math.round(Math.min(...tArr));
      dayObj.pressAvg = Math.round(pArr.reduce((a, b) => a + b, 0) / 24);
      dayObj.dP = i > 0 ? (dayObj.pressAvg - fb.days[i - 1].pressAvg) : 0;
      dayObj.windMax = Math.round(Math.max(...wArr));
      dayObj.windDir = dayObj.hours[12].windDir;
    }
    histMeans.push((dayObj.tDay + dayObj.tNight) / 2);
    const ice = evaluateDayIce(histMeans, dayObj.tDay, dayObj.tNight, dayObj.waterTemp, waterType, dayObj.date);
    dayObj.iceState = ice.iceState;
    dayObj.iceSubState = ice.iceSubState;
    dayObj.iceThickness = ice.iceThickness;
    dayObj.iceNote = ice.iceNote;
  });

  const todayObj = fb.days[2] || fb.days[0];
  return {
    days: fb.days,
    elevation,
    normPress,
    iceState: todayObj?.iceState || 'open_water',
    iceSubState: todayObj?.iceSubState || 'open_water',
    iceThickness: todayObj?.iceThickness || 0,
    iceNote: todayObj?.iceNote || ''
  };
}

/**
 * Пересчитывает ледовую обстановку при смене типа водоёма (например, быстрая река vs стоячее озеро/карьер)
 */
export function recalculateIceForWaterType(days, waterType) {
  if (!Array.isArray(days) || days.length === 0) return null;
  const means = days.map(d => (d.tDay + d.tNight) / 2);
  const updatedDays = days.map((d, idx) => {
    const hist = means.slice(0, idx + 1);
    const ice = evaluateDayIce(hist, d.tDay, d.tNight, d.waterTemp, waterType, d.date);
    return {
      ...d,
      iceState: ice.iceState,
      iceSubState: ice.iceSubState,
      iceThickness: ice.iceThickness,
      iceNote: ice.iceNote
    };
  });
  const todayObj = updatedDays[2] || updatedDays[0];
  return {
    days: updatedDays,
    iceState: todayObj.iceState,
    iceSubState: todayObj.iceSubState,
    iceThickness: todayObj.iceThickness,
    iceNote: todayObj.iceNote
  };
}

export async function fetchWeather(lat, lon, forceNetwork = false) {
  const st = store.getState();
  const cached = storage.loadWeatherCache(lat, lon);
  if (cached && cached.days && cached.days.length === 12 && !forceNetwork) {
    const mins = cached.ageMinutes || 1;
    const label = mins >= 60 ? `${RU.cachedPrefix} (${Math.round(mins / 60)} ч назад)` : `${RU.cachedPrefix} (${mins} мин назад)`;
    const recalc = recalculateIceForWaterType(cached.days, st.water);
    store.dispatch({
      type: 'SET_WEATHER_DATA',
      payload: { ...cached, ...(recalc || {}), source: label, updatedAt: cached.timestamp }
    });
    events.emit('weather:updated', store.getState());
    if (!cached.isExpired) return;
  }

  // past_days=7 даёт 7 реальных архивных дней для точного расчёта тепловой инерции воды, ледостава и точного извлечения Позавчера (todayIdx-2) и Вчера (todayIdx-1)
  const omUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&past_days=7&hourly=temperature_2m,surface_pressure,wind_speed_10m,wind_direction_10m,cloud_cover,precipitation&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,wind_speed_10m_max,wind_direction_10m_dominant&forecast_days=10&wind_speed_unit=ms&timezone=auto`;
  const metUrl = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;

  try {
    const res = await fallbackChain([
      {
        name: RU.online,
        run: async () => {
          const d = await fetchWithTimeout(omUrl, 8500);
          return d && d.hourly && d.daily ? normalizeOpenMeteo(d, st.water) : null;
        }
      },
      {
        name: RU.online,
        run: async () => {
          const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(omUrl)}`;
          const d = await fetchWithTimeout(proxyUrl, 9000);
          return d && d.hourly && d.daily ? normalizeOpenMeteo(d, st.water) : null;
        }
      },
      {
        name: RU.onlineMetNo,
        run: async () => {
          const d = await fetchWithTimeout(metUrl, 8000);
          return d && d.properties?.timeseries ? normalizeMetNo(d, lat, st.water, cached?.days) : null;
        }
      }
    ]);
    storage.saveWeatherCache(lat, lon, res.data);
    store.dispatch({
      type: 'SET_WEATHER_DATA',
      payload: { ...res.data, source: res.source, updatedAt: Date.now() }
    });
    events.emit('weather:updated', store.getState());
  } catch (err) {
    if (!cached || !cached.days?.length) {
      const fb = buildFallback(lat, st.water);
      store.dispatch({
        type: 'SET_WEATHER_DATA',
        payload: { ...fb, source: RU.offlineMode, updatedAt: Date.now() }
      });
      events.emit('weather:updated', store.getState());
    }
  }
}

export function getWeatherState() {
  const s = store.getState();
  return {
    days: s.weatherDays,
    source: s.weatherSource,
    normPress: s.normPress,
    elevation: s.elevation,
    iceState: s.iceState,
    iceThickness: s.iceThickness
  };
}

export function subscribeWeather(cb) {
  return store.subscribe(s => ({ days: s.weatherDays, dayIdx: s.dayIdx, source: s.weatherSource, water: s.water }), cb);
}

export function render(container) {
  if (!container) return;
  const s = store.getState();
  const day = s.weatherDays[s.dayIdx] || s.weatherDays[2] || s.weatherDays[0];
  if (!day) return;
  const m = day.moon;
  const prof = WATER_PROFILES[s.water] || WATER_PROFILES.small_river;
  const iceBannerTone = day.iceState === 'ice_safe'
    ? 'var(--pill-ice-bg)'
    : (day.iceState === 'ice_danger' ? 'var(--pill-bad-bg)' : (day.iceState === 'ice_slush' ? 'var(--pill-warn-bg)' : 'var(--pill-good-bg)'));
  const iceBannerText = day.iceNote || (day.iceState === 'ice_safe'
    ? `❄️ Подлёдный сезон: безопасный лёд ~${day.iceThickness} см`
    : (day.iceState === 'ice_danger'
        ? `⚠️ Опасный лёд (~${day.iceThickness} см) — выход на лёд запрещён!`
        : (day.iceState === 'ice_slush' ? '🌊❄️ Шуга и забереги (ледостава нет)' : '🌊 Открытая вода (льда нет)')));

  container.innerHTML = `
    <div class="card">
      <div class="section-head">
        <span class="section-title">🌦️ Погода, ледовый режим и Луна (${day.relTitle ? day.relTitle + ' • ' : ''}${day.label})</span>
        ${createPill({ text: s.weatherSource || RU.offlineMode, tone: (s.weatherSource || '').includes('Онлайн') ? 'good' : 'warn', icon: '📡' })}
      </div>

      <div style="margin-bottom:10px;padding:9px 12px;border-radius:var(--r-sm);background:${iceBannerTone};border:1px solid var(--border);font-size:var(--fs-xs);font-weight:800;">
        ${iceBannerText} • Водоём: <b>${s.selectedWaterName || prof.shortName}</b>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;">
        <div class="card" style="background:var(--card);padding:10px 12px;">
          <div style="font-size:var(--fs-xs);color:var(--muted);font-weight:700;">ТЕМПЕРАТУРА ВОЗДУХА И ВОДЫ</div>
          <div style="font-size:var(--fs-md);font-weight:800;margin-top:4px;">Воздух: ${day.tDay > 0 ? '+' + day.tDay : day.tDay}° / ${day.tNight > 0 ? '+' + day.tNight : day.tNight}°C</div>
          <div style="font-size:var(--fs-sm);color:var(--accent);font-weight:700;margin-top:2px;">💧 Вода (с учётом тепловой инерции): ~${day.waterTemp}°C</div>
        </div>
        <div class="card" style="background:var(--card);padding:10px 12px;">
          <div style="font-size:var(--fs-xs);color:var(--muted);font-weight:700;">ДАВЛЕНИЕ И ВЕТЕР</div>
          <div style="font-size:var(--fs-md);font-weight:800;margin-top:4px;">🧭 ${day.pressAvg} мм (${fmtDeltaPress(day.dP)})</div>
          <div style="font-size:var(--fs-xs);color:var(--muted);margin-top:2px;">Норма местности (${s.elevation} м): ${s.normPress} мм • 💨 ${day.windDir} ${day.windMax} м/с</div>
        </div>
        <div class="card" style="background:var(--card);padding:10px 12px;">
          <div style="font-size:var(--fs-xs);color:var(--muted);font-weight:700;">ФАЗА ЛУНЫ И СВЕТОВОЙ ДЕНЬ</div>
          <div style="font-size:var(--fs-md);font-weight:800;margin-top:4px;">${m.phaseIcon} ${m.phaseName} (${m.moonDay} л.д., ${m.illum}%)</div>
          <div style="font-size:var(--fs-xs);color:var(--muted);margin-top:2px;">🌅 Восход ${fmtHM(day.sunriseHr)} • 🌇 Закат ${fmtHM(day.sunsetHr)}</div>
        </div>
      </div>
      <div style="margin-top:10px;padding:8px 12px;border-radius:var(--r-sm);background:var(--card);font-size:var(--fs-xs);color:var(--muted);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <span>ℹ️ <b>Приоритет факторов:</b> ${RU.moonPriorityNote}</span>
        <span><b>Главные лунные окна:</b> ${m.majorWindows.join(', ')} • <b>Малые окна:</b> ${m.minorWindows.join(', ')}</span>
      </div>
      <details style="margin-top:8px;font-size:var(--fs-xs);color:var(--muted);">
        <summary style="cursor:pointer;font-weight:700;color:var(--accent);">Памятка рыбаку о влиянии фаз Луны</summary>
        <p style="margin-top:6px;line-height:1.45;">${RU.solunarDisclaimer}</p>
      </details>
    </div>
  `;
}

let unsub = null;
export function init(container) {
  const st = store.getState();
  if (!st.weatherDays || st.weatherDays.length !== 12) {
    const fb = buildFallback(st.lat, st.water);
    store.dispatch({
      type: 'SET_WEATHER_DATA',
      payload: { ...fb, source: RU.syncing, updatedAt: Date.now() }
    });
  }
  render(container);
  unsub = subscribeWeather((next, prev) => {
    if (prev && next.water !== prev.water && Array.isArray(next.days) && next.days.length === 12) {
      const recalc = recalculateIceForWaterType(next.days, next.water);
      if (recalc) {
        store.dispatch({
          type: 'SET_WEATHER_DATA',
          payload: {
            days: recalc.days,
            iceState: recalc.iceState,
            iceThickness: recalc.iceThickness,
            source: store.getState().weatherSource
          }
        });
        return;
      }
    }
    render(container);
  });
  fetchWeather(st.lat, st.lon);
}

export function destroy() {
  if (unsub) unsub();
}

export const weatherModule = {
  computeMoon,
  evaluateDayIce,
  recalculateIceForWaterType,
  buildFallback,
  fetchWeather,
  getWeatherState,
  subscribeWeather,
  init,
  render,
  destroy
};
