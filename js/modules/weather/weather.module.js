import { RU } from '../../i18n/ru.js?v=2.0.161';
import { events } from '../../core/events.js?v=2.0.161';
import { storage } from '../../core/storage.js?v=2.0.161';
import { store } from '../../core/store.js?v=2.0.161';
import { fetchWithTimeout, fallbackChain } from '../../core/http.js?v=2.0.161';
import { formatLocalYYYYMMDD, fmtHM, fmtDeltaPress } from '../../core/format.js?v=2.0.161';
import { WATER_PROFILES } from '../../data/waters.js?v=2.0.161';
import { createPill, showToast } from '../../ui/components.js?v=2.0.161';

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
 * Ревизия 2.0.15: Физический расчёт температуры воды с учётом тепловой инерции за прошлые дни И скорости течения (flow).
 * - На реках с умеренным и быстрым течением (flow >= 1.1) турбулентное перемешивание водной толщи
 *   предотвращает мгновенное переохлаждение поверхности при околонулевых качелях (-4..+3 °C).
 * - В стоячих мелководных озёрах (flow <= 0.4) вода быстрее остывает осенью и быстрее прогревается весной.
 */
export function computeWaterTempSeries(dailyMeans, dailyMaxs, dailyMins, waterType = 'small_river') {
  if (!Array.isArray(dailyMeans) || dailyMeans.length === 0) return [8.0];
  const prof = WATER_PROFILES[waterType] || WATER_PROFILES.small_river;
  const flow = Number.isFinite(prof.flow) ? prof.flow : 1.0;

  if (waterType === 'cooling_reservoir') {
    return dailyMeans.map(m => Math.max(8.0, Math.min(30.0, Math.round((m * 0.22 + 18.0) * 10) / 10)));
  }

  // Коэффициент тепловой инерции зависит от объёма и скорости течения
  const inertia = waterType === 'quarry' || waterType === 'big_river'
    ? 0.78
    : (flow >= 1.2 ? 0.72 : 0.68);
  const flowThermalBonus = flow >= 1.8 ? 0.75 : (flow >= 1.1 ? 0.45 : 0.0);

  let runningWT = Math.max(0.4, Math.min(25.0, dailyMeans[0] * 0.54 + 2.6 + flowThermalBonus));
  const result = [];

  for (let i = 0; i < dailyMeans.length; i++) {
    const m = dailyMeans[i];
    const tMax = Array.isArray(dailyMaxs) && Number.isFinite(dailyMaxs[i]) ? dailyMaxs[i] : (m + 2.5);
    const tMin = Array.isArray(dailyMins) && Number.isFinite(dailyMins[i]) ? dailyMins[i] : (m - 2.5);

    const targetWT = Math.max(0.2, Math.min(25.5, m * 0.54 + 2.6 + flowThermalBonus));
    runningWT = runningWT * inertia + targetWT * (1 - inertia);

    // Если дневная температура плюсовая или около нуля (например +1/-5 °C), на течении вода не падает до 0.2 °C
    let minFloor = 0.2;
    if (tMax >= -0.5 && m >= -3.8) {
      minFloor = flow >= 1.8 ? 1.5 : (flow >= 1.1 ? 1.2 : 0.7);
    } else if (m >= -6.0 && flow >= 1.1) {
      minFloor = 0.6;
    }

    const wt = Math.max(minFloor, Math.min(25.5, Math.round(runningWT * 10) / 10));
    result.push(wt);
  }

  return result;
}

/**
 * Ревизия 2.0.15: Физически точный расчёт ледостава и сезона ловли с учётом архива погоды и скорости течения водоёма (flow)
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
  const flowFactor = 1 / Math.pow(Math.max(0.4, flow), 0.45);
  const flowLabel = flow >= 1.8 ? 'быстрое течение' : (flow >= 1.1 ? 'умеренное течение' : 'стоячая вода / слабый ток');

  const dt = dateStr ? new Date(dateStr + 'T12:00:00') : new Date();
  const monthNum = dt.getMonth() + 1;
  const isSpring = monthNum >= 3 && monthNum <= 5;
  const isWinterOrSpring = monthNum === 12 || monthNum <= 5;

  const recent = Array.isArray(historyMeanTemps) && historyMeanTemps.length > 0
    ? historyMeanTemps
    : [(tDayMax + tNightMin) / 2];

  let freezeSum = 0;
  let freezeDays = 0;
  let recentWarmDays = 0;
  let warmDegreeDays = 0;

  for (let i = recent.length - 1; i >= 0; i--) {
    const m = recent[i];
    const daysAgo = recent.length - 1 - i;
    if (m <= -0.5) {
      freezeDays++;
      const effFreeze = Math.max(0, Math.abs(m) - (flow > 1.5 ? 1.2 : (flow > 1.0 ? 0.5 : 0)));
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
    last4.every(m => m >= -3.8 && m <= 3.5) &&
    tDayMax >= -2.5 && tDayMax <= 4.0 &&
    tNightMin >= -6.0 && tNightMin <= 2.5;

  const rawIceCm = Math.round(2.35 * Math.sqrt(Math.max(0, freezeSum)) * flowFactor - warmDegreeDays * 0.85);
  const effectiveIceCm = Math.max(0, Math.min(120, rawIceCm));

  // 1. Весеннее потепление при наличии льда -> опасный рыхлый лёд и промоины
  if ((isSpring || recentWarmDays >= 2) && (effectiveIceCm >= 5 || freezeDays >= 4) && (tDayMax >= 3.0 || tCurMean >= 0.8 || warmDegreeDays >= 4)) {
    const remThick = Math.max(4, effectiveIceCm || 12);
    return {
      iceState: 'ice_danger',
      iceSubState: 'spring_rotten_ice',
      iceThickness: remThick,
      iceNote: `⚠️ Опасный весенний лёд (~${remThick} см, ${flowLabel}): дневной прогрев до +${tDayMax}°C, рыхлый игольчатый лёд, промоины и закраины — выход на лёд смертельно опасен!`
    };
  }

  // 2. Колебания температуры около нуля (например +1 / -5 °C) -> ледостава нет, шуга и забереги
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

  // 3. Устойчивый минус несколько дней подряд -> безопасный ледостав с учётом течения
  const minSafeCm = flow >= 1.8 ? 12 : (flow >= 1.1 ? 10 : 8);
  const minFreezeDays = flow >= 1.8 ? 4 : 3;

  if (freezeDays >= minFreezeDays && effectiveIceCm >= minSafeCm && tDayMax <= 0.5) {
    return {
      iceState: 'ice_safe',
      iceSubState: 'solid_freeze',
      iceThickness: effectiveIceCm,
      iceNote: `❄️ Устойчивый ледостав: безопасный монолитный лёд ~${effectiveIceCm} см (с учётом течения: ${flowLabel})`
    };
  }

  // 4. Тонкий перволёдок
  if ((tCurMean <= -2.0 || (tDayMax <= -0.5 && tNightMin <= -4.0)) && (effectiveIceCm >= 2 || freezeSum >= 6) && waterTemp <= 2.2) {
    const thinCm = Math.max(2, Math.min(minSafeCm - 1, effectiveIceCm || 4));
    return {
      iceState: 'ice_danger',
      iceSubState: 'thin_first_ice',
      iceThickness: thinCm,
      iceNote: `⚠️ Тонкий перволёдок (~${thinCm} см, ${flowLabel}): лёд ещё не набрал безопасную толщину (${minSafeCm} см) — выход на лёд запрещён!`
    };
  }

  // 5. Переходный околонулевой режим (ночные заморозки при плюсе днём) -> забереги и шуга
  if (tNightMin <= -1.0 && tDayMax >= -1.0 && waterTemp <= 2.8) {
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

/**
 * Ревизия 2.0.161: Расчёт комплексного Индекса безопасности льда (0–100) и порогов нагрузки (Пешком vs Снегоход/Мотобуксировщик)
 */
export function computeIceSafetyIndex(day, waterType = "small_river") {
  const prof = WATER_PROFILES[waterType] || WATER_PROFILES.small_river;
  const flow = Number.isFinite(prof.flow) ? prof.flow : 1.0;
  const iceState = day?.iceState || "open_water";
  const thick = Number(day?.iceThickness) || 0;
  const wind = Number(day?.windMax) || 3;
  const tDay = Number(day?.tDay) || 0;

  if (iceState === "open_water") {
    return {
      index: 100,
      hasIce: false,
      footSafe: false,
      sledSafe: false,
      minFootCm: flow >= 1.5 ? 12 : 10,
      minSledCm: flow >= 1.5 ? 25 : 20,
      statusText: "Открытая вода (ледостава нет)",
      vehicleVerdict: "Ловля с берега или лодки (спасжилет обязателен при волне)",
      recommendation: "Льда нет. При выходе на лодке учитывайте ветер (" + wind + " м/с) и температуру воды (~" + (day?.waterTemp ?? 8) + "°C)."
    };
  }

  const minFootCm = flow >= 1.8 ? 12 : (flow >= 1.1 ? 10 : 8);
  const minSledCm = flow >= 1.8 ? 25 : (flow >= 1.1 ? 22 : 18);

  if (iceState === "ice_danger" || iceState === "ice_slush") {
    const rawIdx = iceState === "ice_slush" ? 25 : Math.max(5, Math.min(38, Math.round((thick / minFootCm) * 35)));
    return {
      index: rawIdx,
      hasIce: true,
      footSafe: false,
      sledSafe: false,
      minFootCm,
      minSledCm,
      statusText: iceState === "ice_slush" ? "Шуга и забереги (выход запрещён)" : `Опасный лёд ~${thick} см (индекс ${rawIdx}/100)`,
      vehicleVerdict: "⛔ Пешком и на технике ЗАПРЕЩЕНО!",
      recommendation: `Несущая способность льда критически низкая (~${thick} см при норме от ${minFootCm} см на течении). Допустима только береговая ловля!`
    };
  }

  // ice_safe
  let score = Math.min(98, Math.round(55 + (thick - minFootCm) * 2.2));
  if (flow >= 1.8) score -= 8;
  if (tDay > 0) score -= 12;
  if (wind >= 9) score -= 6;
  score = Math.max(45, Math.min(98, score));

  const footSafe = thick >= minFootCm && tDay <= 2;
  const sledSafe = thick >= minSledCm && tDay <= 0;

  return {
    index: score,
    hasIce: true,
    footSafe,
    sledSafe,
    minFootCm,
    minSledCm,
    statusText: `Безопасный лёд ~${thick} см (индекс надёжности ${score}/100)`,
    vehicleVerdict: sledSafe
      ? `🚶 Пешком: РАЗРЕШЕНО (≥${minFootCm} см) • 🛷 Мотобуксировщик/снегоход: РАЗРЕШЕНО (≥${minSledCm} см)`
      : `🚶 Пешком со спасалками: РАЗРЕШЕНО (≥${minFootCm} см) • 🛷 Техника/снегоход: ОПАСНО (нужно ≥${minSledCm} см!)`,
    recommendation: sledSafe
      ? "Монолитный лёд достаточной толщины для пешего перехода и лёгкой мототехники. Избегайте устьев притоков и быстрин."
      : `Толщина ~${thick} см достаточна для одиночного пешего выхода с пешнёй и спасалками, но выезд на мотобуксировщике или снегоходе запрещён (требуется от ${minSledCm} см).`
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
  const meanT = 22 - (latBase - 40) * 0.82;
  const amplitude = 10 + (latBase - 40) * 0.38;
  const allMeanT = [];
  const allMaxT = [];
  const allMinT = [];
  for (let rel = -7; rel <= 9; rel++) {
    const tMax = Math.round(meanT + seasonOffset * amplitude - rel * 0.2);
    const tMin = tMax - 5;
    allMaxT.push(tMax);
    allMinT.push(tMin);
    allMeanT.push((tMax + tMin) / 2);
  }
  const wtSeries = computeWaterTempSeries(allMeanT, allMaxT, allMinT, waterType);

  const days = [];
  for (let idx = 0; idx < 12; idx++) {
    const rel = idx - 2; // -2 .. +9
    const cur = new Date(todayDt.getTime() + rel * 86400000);
    const dStr = formatLocalYYYYMMDD(cur);
    const moon = computeMoon(dStr);
    const seriesIdx = idx + 5;
    const tMax = allMaxT[seriesIdx];
    const tMin = allMinT[seriesIdx];
    const waterTemp = wtSeries[seriesIdx];
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
    const histSlice = allMeanT.slice(0, seriesIdx + 1);
    const ice = evaluateDayIce(histSlice, tMax, tMin, waterTemp, waterType, dStr);
    days.push({
      date: dStr,
      relOffset: rel,
      isArchive: rel < 0,
      isReal: false,
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
    archive5Days: days.slice(0, 2),
    hasRealArchive: false,
    elevation: 90,
    normPress: 752,
    iceState: todayObj.iceState,
    iceSubState: todayObj.iceSubState,
    iceThickness: todayObj.iceThickness,
    iceNote: todayObj.iceNote
  };
}

/**
 * Ревизия 2.0.15: Нормализация ответа Open-Meteo (past_days=7, forecast_days=10)
 * Возвращает как 12 плиток прогноза (2 архивных + Сегодня + 9 будущих), так и полный 5-дневный архив (archive5Days) для кэша 10 км!
 */
export function normalizeOpenMeteo(data, waterType) {
  const elevation = Math.round(data.elevation || 90);
  const normPress = Math.round(760 - elevation / 11.5);
  const allP = (data.hourly?.surface_pressure || []).map(v => (v || 1010) * 0.750062);
  const times = Array.isArray(data.daily?.time) ? data.daily.time : [];
  const totalDays = times.length;
  if (totalDays === 0) return null;

  const todayStr = formatLocalYYYYMMDD(new Date());
  let todayIdx = times.indexOf(todayStr);
  if (todayIdx < 0) {
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

  const dailyMaxs = times.map((_, idx) => Math.round(data.daily.temperature_2m_max[idx] ?? 8));
  const dailyMins = times.map((_, idx) => Math.round(data.daily.temperature_2m_min[idx] ?? 2));
  const dailyMeans = times.map((_, idx) => (dailyMaxs[idx] + dailyMins[idx]) / 2);
  const wtSeries = computeWaterTempSeries(dailyMeans, dailyMaxs, dailyMins, waterType);

  const allNormalizedDays = [];
  for (let i = 0; i < totalDays; i++) {
    const rel = i - todayIdx;
    const dStr = times[i];
    const dt = new Date(dStr + 'T00:00:00');
    const srD = data.daily.sunrise?.[i] ? new Date(data.daily.sunrise[i]) : new Date(dStr + 'T07:00:00');
    const ssD = data.daily.sunset?.[i] ? new Date(data.daily.sunset[i]) : new Date(dStr + 'T18:00:00');
    const hours = [];
    let sumP = 0;
    for (let h = 0; h < 24; h++) {
      const g = i * 24 + h;
      const pMm = allP[g] || 754;
      sumP += pMm;
      hours.push({
        hour: h,
        tAir: Math.round((data.hourly.temperature_2m?.[g] ?? 0) * 10) / 10,
        press: Math.round(pMm),
        dp3h: Math.round((pMm - (g >= 3 ? (allP[g - 3] || pMm) : pMm)) * 10) / 10,
        wind: Math.round((data.hourly.wind_speed_10m?.[g] ?? 3) * 10) / 10,
        windDir: DIRS[Math.round(((data.hourly.wind_direction_10m?.[g] || 0) / 45)) % 8],
        cloud: data.hourly.cloud_cover?.[g] ?? 50,
        precip: data.hourly.precipitation?.[g] ?? 0
      });
    }
    const pAvg = Math.round(sumP / 24);
    const prevAvg = i > 0
      ? Math.round(allP.slice((i - 1) * 24, i * 24).reduce((a, b) => a + b, 0) / 24)
      : pAvg;
    const tMax = dailyMaxs[i];
    const tMin = dailyMins[i];
    const waterTemp = wtSeries[i];
    const ice = evaluateDayIce(dailyMeans.slice(0, i + 1), tMax, tMin, waterTemp, waterType, dStr);

    allNormalizedDays.push({
      date: dStr,
      relOffset: rel,
      isArchive: rel < 0,
      isReal: true,
      relTitle: getRelativeDayTitle(rel),
      label: `${RU.daysShort[dt.getDay()]}, ${dt.getDate()} ${RU.monthsGen[dt.getMonth()]}`,
      tDay: tMax,
      tNight: tMin,
      pressAvg: pAvg,
      dP: pAvg - prevAvg,
      windMax: Math.round(data.daily.wind_speed_10m_max?.[i] || 3),
      windDir: DIRS[Math.round(((data.daily.wind_direction_10m_dominant?.[i] || 0) / 45)) % 8],
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

  // Плитки в прогнозе: строго 2 архивных (Позавчера, Вчера) + Сегодня + 9 будущих (всего 12 плиток)
  const startIdx = Math.max(0, Math.min(totalDays - 12, todayIdx - 2));
  const days = allNormalizedDays.slice(startIdx, startIdx + 12).map((d, idx) => ({
    ...d,
    relOffset: idx - 2,
    isArchive: idx < 2,
    relTitle: getRelativeDayTitle(idx - 2)
  }));

  // 5-дневный архив (все дни до Сегодня, до 5–7 дней)
  const archive5Days = allNormalizedDays.filter(d => d.date < todayStr).slice(-5);
  const todayObj = days[2] || days[0];

  return {
    days,
    archive5Days,
    extraArchiveDays: allNormalizedDays.filter(d => d.date < todayStr),
    hasRealArchive: archive5Days.length >= 3,
    elevation,
    normPress,
    iceState: todayObj?.iceState || 'open_water',
    iceSubState: todayObj?.iceSubState || 'open_water',
    iceThickness: todayObj?.iceThickness || 0,
    iceNote: todayObj?.iceNote || ''
  };
}

/**
 * Ревизия 2.0.15: Полностью переработанная нормализация MET.no (работа без VPN в РФ):
 * - Никогда не оставляет синтетические морозы (-13..-20 °C) из buildFallback() во «Вчера» и «Позавчера»!
 * - Подтягивает реальные архивные дни за последние 5 дней из 10-км гео-кэша (GeoWeatherArchive) или из архивного API.
 * - Если это первый запрос в локации и архивный сервер не ответил, плавно реконструирует прошлые дни от реального
 *   сегодняшнего дня MET.no, пересчитывает waterTemp (с учётом течения flow) и ледостав, и выставляет hasRealArchive = false!
 */
export function normalizeMetNo(metNo, lat, waterType, prevArchiveDays = []) {
  const coords = metNo.geometry?.coordinates || [];
  const elevation = Math.round(coords[2] || 90);
  const normPress = Math.round(760 - elevation / 11.5);
  const byDate = {};
  const isRealDateMap = {};

  if (Array.isArray(prevArchiveDays)) {
    prevArchiveDays.forEach(cd => {
      if (cd && cd.date && Array.isArray(cd.hours) && cd.hours.length === 24 && cd.isReal !== false) {
        byDate[cd.date] = {};
        cd.hours.forEach((hObj, hIdx) => {
          byDate[cd.date][hIdx] = { ...hObj };
        });
        isRealDateMap[cd.date] = true;
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
    isRealDateMap[dStr] = true;
  }

  const todayDt = new Date();
  todayDt.setHours(0, 0, 0, 0);
  const todayStr = formatLocalYYYYMMDD(todayDt);

  // Находим первый день с реальными данными MET.no (обычно Сегодня, rel = 0)
  let anchorHours = null;
  for (let rel = 0; rel <= 3; rel++) {
    const dStr = formatLocalYYYYMMDD(new Date(todayDt.getTime() + rel * 86400000));
    if (byDate[dStr] && Object.keys(byDate[dStr]).length > 0) {
      anchorHours = byDate[dStr];
      break;
    }
  }

  // Строим 15-дневную серию: от -5 дней (5-дневный архив) до +9 дней (будущий прогноз)
  const fullSeries = [];
  for (let rel = -5; rel <= 9; rel++) {
    const cur = new Date(todayDt.getTime() + rel * 86400000);
    const dStr = formatLocalYYYYMMDD(cur);
    let mapH = byDate[dStr];
    const hasReal = Boolean(isRealDateMap[dStr] && mapH && Object.keys(mapH).length > 0);

    if (!mapH || Object.keys(mapH).length === 0) {
      // Если для прошлого дня нет реального архива — строим непрерывный суточный ход от реального anchorHours MET.no (БЕЗ фейковых -20°C!)
      mapH = {};
      const baseList = anchorHours ? Object.values(anchorHours) : [{ tAir: 4, press: normPress, wind: 3, windDir: 'З', cloud: 60, precip: 0 }];
      const baseTAvg = baseList.reduce((a, b) => a + b.tAir, 0) / baseList.length;
      const baseP = Math.round(baseList.reduce((a, b) => a + b.press, 0) / baseList.length);
      const baseW = Math.round(baseList.reduce((a, b) => a + b.wind, 0) / baseList.length * 10) / 10;
      const baseDir = baseList[Math.floor(baseList.length / 2)]?.windDir || 'З';

      for (let h = 0; h < 24; h++) {
        const refH = anchorHours && anchorHours[h] ? anchorHours[h] : null;
        const wave = Math.sin(((h - 5) / 24) * 2 * Math.PI);
        const tAir = refH ? refH.tAir : Math.round((baseTAvg + wave * 2.5) * 10) / 10;
        mapH[h] = {
          hour: h,
          tAir,
          press: refH ? refH.press : baseP,
          dp3h: 0,
          wind: refH ? refH.wind : baseW,
          windDir: refH ? refH.windDir : baseDir,
          cloud: refH ? refH.cloud : 60,
          precip: 0
        };
      }
    }

    const hours = [];
    let last = Object.values(mapH)[0] || { hour: 0, tAir: 2, press: normPress, dp3h: 0, wind: 3, windDir: 'З', cloud: 50, precip: 0 };
    for (let h = 0; h < 24; h++) {
      if (mapH[h]) last = mapH[h];
      hours.push({ ...last, hour: h });
    }
    for (let h = 0; h < 24; h++) {
      const prevP = h >= 3 ? hours[h - 3].press : (fullSeries.length > 0 ? fullSeries[fullSeries.length - 1].hours[21 + h]?.press || hours[0].press : hours[0].press);
      hours[h].dp3h = Math.round((hours[h].press - prevP) * 10) / 10;
    }

    const tArr = hours.map(x => x.tAir);
    const pArr = hours.map(x => x.press);
    const wArr = hours.map(x => x.wind);
    const tMax = Math.round(Math.max(...tArr));
    const tMin = Math.round(Math.min(...tArr));
    const pAvg = Math.round(pArr.reduce((a, b) => a + b, 0) / 24);
    const prevP = fullSeries.length > 0 ? fullSeries[fullSeries.length - 1].pressAvg : pAvg;

    fullSeries.push({
      date: dStr,
      relOffset: rel,
      isArchive: rel < 0,
      isReal: hasReal,
      relTitle: getRelativeDayTitle(rel),
      label: `${RU.daysShort[cur.getDay()]}, ${cur.getDate()} ${RU.monthsGen[cur.getMonth()]}`,
      tDay: tMax,
      tNight: tMin,
      pressAvg: pAvg,
      dP: pAvg - prevP,
      windMax: Math.max(1, Math.round(Math.max(...wArr))),
      windDir: hours[12]?.windDir || 'З',
      sunriseHr: 7.0,
      sunsetHr: 17.8,
      waterTemp: 4.0,
      iceState: 'open_water',
      iceSubState: 'open_water',
      iceThickness: 0,
      iceNote: '',
      moon: computeMoon(dStr),
      hours
    });
  }

  // Пересчитываем температуру воды (с учётом течения flow) и состояние льда по реальному ряду температур!
  const seriesMaxs = fullSeries.map(d => d.tDay);
  const seriesMins = fullSeries.map(d => d.tNight);
  const seriesMeans = fullSeries.map(d => (d.tDay + d.tNight) / 2);
  const wtSeries = computeWaterTempSeries(seriesMeans, seriesMaxs, seriesMins, waterType);

  fullSeries.forEach((d, idx) => {
    d.waterTemp = wtSeries[idx];
    const ice = evaluateDayIce(seriesMeans.slice(0, idx + 1), d.tDay, d.tNight, d.waterTemp, waterType, d.date);
    d.iceState = ice.iceState;
    d.iceSubState = ice.iceSubState;
    d.iceThickness = ice.iceThickness;
    d.iceNote = ice.iceNote;
  });

  // 12 плиток прогноза: от rel = -2 (Позавчера) до rel = +9 (10 дней вперёд)
  const days = fullSeries.filter(d => d.relOffset >= -2 && d.relOffset <= 9);
  const archive5Days = fullSeries.filter(d => d.date < todayStr);
  const realPastCount = archive5Days.filter(d => d.isReal).length;
  const todayObj = days[2] || days[0];

  return {
    days,
    archive5Days,
    extraArchiveDays: archive5Days.filter(d => d.isReal),
    hasRealArchive: realPastCount >= 3,
    elevation,
    normPress,
    iceState: todayObj?.iceState || 'open_water',
    iceSubState: todayObj?.iceSubState || 'open_water',
    iceThickness: todayObj?.iceThickness || 0,
    iceNote: todayObj?.iceNote || ''
  };
}

/**
 * Пересчитывает температуру воды (с учётом скорости течения flow) и ледовую обстановку при смене типа водоёма
 */
export function recalculateIceForWaterType(days, waterType, archive5Days = []) {
  if (!Array.isArray(days) || days.length === 0) return null;

  // Объединяем более ранние дни из 5-дневного архива (если есть) и 12 дней прогноза для точной тепловой инерции
  const firstDayDate = days[0]?.date || '';
  const prefixArchive = Array.isArray(archive5Days)
    ? archive5Days.filter(a => a && a.date && a.date < firstDayDate)
    : [];
  const combined = [...prefixArchive, ...days];

  const maxs = combined.map(d => d.tDay);
  const mins = combined.map(d => d.tNight);
  const means = combined.map(d => (d.tDay + d.tNight) / 2);
  const wtSeries = computeWaterTempSeries(means, maxs, mins, waterType);

  const updatedCombined = combined.map((d, idx) => {
    const wt = wtSeries[idx];
    const hist = means.slice(0, idx + 1);
    const ice = evaluateDayIce(hist, d.tDay, d.tNight, wt, waterType, d.date);
    return {
      ...d,
      waterTemp: wt,
      iceState: ice.iceState,
      iceSubState: ice.iceSubState,
      iceThickness: ice.iceThickness,
      iceNote: ice.iceNote
    };
  });

  const updatedDays = updatedCombined.slice(prefixArchive.length);
  const updatedArchive5 = updatedCombined.filter(d => d.isArchive).slice(-5);
  const todayObj = updatedDays[2] || updatedDays[0];

  return {
    days: updatedDays,
    archive5Days: updatedArchive5,
    iceState: todayObj.iceState,
    iceSubState: todayObj.iceSubState,
    iceThickness: todayObj.iceThickness,
    iceNote: todayObj.iceNote
  };
}

/**
 * При первом запросе в локации (когда в 10-км кэше ещё нет архивных данных за прошлые дни)
 * запрашивает реальный архив погоды минимум за 3–5 предыдущих дней у проверенных источников.
 */
async function fetchMissingArchiveDays(lat, lon, waterType) {
  const todayDt = new Date();
  todayDt.setHours(0, 0, 0, 0);
  const startDt = new Date(todayDt.getTime() - 5 * 86400000);
  const endDt = new Date(todayDt.getTime() - 1 * 86400000);
  const startStr = formatLocalYYYYMMDD(startDt);
  const endStr = formatLocalYYYYMMDD(endDt);

  const histForecastUrl = `https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&start_date=${startStr}&end_date=${endStr}&hourly=temperature_2m,surface_pressure,wind_speed_10m,wind_direction_10m,cloud_cover,precipitation&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,wind_speed_10m_max,wind_direction_10m_dominant&wind_speed_unit=ms&timezone=auto`;
  const archiveApiUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${startStr}&end_date=${endStr}&hourly=temperature_2m,surface_pressure,wind_speed_10m,wind_direction_10m,cloud_cover,precipitation&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,wind_speed_10m_max,wind_direction_10m_dominant&wind_speed_unit=ms&timezone=auto`;

  const candidates = [
    histForecastUrl,
    archiveApiUrl,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(histForecastUrl)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(histForecastUrl)}`
  ];

  for (const url of candidates) {
    try {
      const data = await fetchWithTimeout(url, 5500);
      if (data && data.hourly && data.daily && Array.isArray(data.daily.time) && data.daily.time.length >= 3) {
        const parsed = normalizeOpenMeteo(data, waterType);
        if (parsed && Array.isArray(parsed.extraArchiveDays) && parsed.extraArchiveDays.length >= 3) {
          return parsed.extraArchiveDays;
        }
      }
    } catch (e) {}
  }
  return null;
}

export async function fetchWeather(lat, lon, forceNetwork = false) {
  const st = store.getState();
  const cached = storage.loadWeatherCache(lat, lon);
  const localArchiveInfo = storage.getArchiveDaysForLocation(lat, lon, 5);

  if (cached && cached.days && cached.days.length === 12 && !forceNetwork) {
    const mins = cached.ageMinutes || 1;
    const label = mins >= 60 ? `${RU.cachedPrefix} 10 км (${Math.round(mins / 60)} ч назад)` : `${RU.cachedPrefix} 10 км (${mins} мин назад)`;
    const recalc = recalculateIceForWaterType(cached.days, st.water, cached.archive5Days || localArchiveInfo.days);
    store.dispatch({
      type: 'SET_WEATHER_DATA',
      payload: {
        ...cached,
        ...(recalc || {}),
        hasRealArchive: cached.hasRealArchive ?? localArchiveInfo.hasRealArchive,
        source: label,
        updatedAt: cached.timestamp
      }
    });
    events.emit('weather:updated', store.getState());
    if (!cached.isExpired) return;
  }

  const omUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&past_days=7&hourly=temperature_2m,surface_pressure,wind_speed_10m,wind_direction_10m,cloud_cover,precipitation&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,wind_speed_10m_max,wind_direction_10m_dominant&forecast_days=10&wind_speed_unit=ms&timezone=auto`;
  const metUrl = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;

  try {
    const res = await fallbackChain([
      {
        name: RU.online,
        run: async () => {
          const d = await fetchWithTimeout(omUrl, 6500);
          return d && d.hourly && d.daily ? normalizeOpenMeteo(d, st.water) : null;
        }
      },
      {
        name: RU.online,
        run: async () => {
          const proxy1 = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(omUrl)}`;
          const d = await fetchWithTimeout(proxy1, 7000);
          return d && d.hourly && d.daily ? normalizeOpenMeteo(d, st.water) : null;
        }
      },
      {
        name: RU.online,
        run: async () => {
          const proxy2 = `https://api.allorigins.win/raw?url=${encodeURIComponent(omUrl)}`;
          const d = await fetchWithTimeout(proxy2, 7500);
          return d && d.hourly && d.daily ? normalizeOpenMeteo(d, st.water) : null;
        }
      },
      {
        name: RU.onlineMetNo,
        run: async () => {
          const d = await fetchWithTimeout(metUrl, 7500);
          if (!d || !d.properties?.timeseries) return null;

          // Проверяем, есть ли в 10-км кэше минимум 3 архивных дня для этой локации
          let archiveSeed = localArchiveInfo.days || [];
          if (archiveSeed.filter(x => x && x.isReal !== false).length < 3) {
            // Если это первый запрос в локации — запрашиваем реальный архив погоды (минимум 3–5 дней) у проверенного источника
            const fetchedArchive = await fetchMissingArchiveDays(lat, lon, st.water);
            if (Array.isArray(fetchedArchive) && fetchedArchive.length >= 3) {
              archiveSeed = fetchedArchive;
            }
          }
          return normalizeMetNo(d, lat, st.water, archiveSeed);
        }
      }
    ]);

    // Сохраняем в 10-км гео-архив (прошлые дни сохраняются как архив, а текущий и будущие обновляются!)
    const updatedCluster = storage.saveWeatherCache(lat, lon, res.data, res.data.extraArchiveDays || res.data.archive5Days || []);
    const mergedArchiveInfo = storage.getArchiveDaysForLocation(lat, lon, 5);

    // Если в 10-км кэше уже были реальные данные за Позавчера/Вчера, подставляем их в карточки 0 и 1
    const syncedDays = res.data.days.map((d, idx) => {
      if (idx < 2 && updatedCluster?.daysByDate?.[d.date]) {
        return {
          ...updatedCluster.daysByDate[d.date],
          relOffset: idx - 2,
          isArchive: true,
          relTitle: idx === 0 ? "Позавчера" : "Вчера"
        };
      }
      return d;
    });
    const recalc = recalculateIceForWaterType(syncedDays, st.water, mergedArchiveInfo.days);

    store.dispatch({
      type: 'SET_WEATHER_DATA',
      payload: {
        ...res.data,
        ...(recalc || {}),
        archive5Days: mergedArchiveInfo.days,
        hasRealArchive: updatedCluster?.hasRealArchive ?? res.data.hasRealArchive,
        source: res.source,
        updatedAt: Date.now()
      }
    });
    events.emit('weather:updated', store.getState());
  } catch (err) {
    if (!cached || !cached.days?.length) {
      const fb = buildFallback(lat, st.water);
      store.dispatch({
        type: 'SET_WEATHER_DATA',
        payload: { ...fb, hasRealArchive: false, source: RU.offlineMode, updatedAt: Date.now() }
      });
      events.emit('weather:updated', store.getState());
    }
  }
}

export function getWeatherState() {
  const s = store.getState();
  return {
    days: s.weatherDays,
    archive5Days: s.weatherArchive5Days,
    hasRealArchive: s.hasRealArchive,
    source: s.weatherSource,
    normPress: s.normPress,
    elevation: s.elevation,
    iceState: s.iceState,
    iceThickness: s.iceThickness
  };
}

export function subscribeWeather(cb) {
  return store.subscribe(
    s => ({
      days: s.weatherDays,
      archive5Days: s.weatherArchive5Days,
      hasRealArchive: s.hasRealArchive,
      dayIdx: s.dayIdx,
      source: s.weatherSource,
      water: s.water
    }),
    cb
  );
}

export function render(container) {
  if (!container) return;
  const s = store.getState();
  const day = s.weatherDays[s.dayIdx] || s.weatherDays[2] || s.weatherDays[0];
  if (!day) return;
  const m = day.moon;
  const prof = WATER_PROFILES[s.water] || WATER_PROFILES.small_river;
  const flowLabel = prof.flow >= 1.8 ? 'быстрое течение' : (prof.flow >= 1.1 ? 'умеренное течение' : 'стоячая вода');
  const archiveStats = storage.getWeatherArchiveStats(s.lat, s.lon);

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
        <span class="section-title">🌦️ Погода, ледовый режим, кэш (10 км) и Луна (${day.relTitle ? day.relTitle + ' • ' : ''}${day.label})</span>
        <div class="toolbar-row">
          ${createPill({ text: s.weatherSource || RU.offlineMode, tone: (s.weatherSource || '').includes('Онлайн') ? 'good' : 'warn', icon: '📡' })}
          <button type="button" class="btn btn-sm" id="weatherCleanArchiveBtn" title="Очистить старый архив погоды, кроме последних 5 дней">🧹 Очистить архив погоды</button>
        </div>
      </div>

      ${(() => {
        const safety = computeIceSafetyIndex(day, s.water);
        return `
          <div style="margin-bottom:10px;padding:10px 12px;border-radius:var(--r-sm);background:${iceBannerTone};border:1px solid var(--border);font-size:var(--fs-xs);">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;font-weight:800;">
              <span>${iceBannerText} • Водоём: <b>${s.selectedWaterName || prof.shortName}</b> (${flowLabel})</span>
              <span class="pill ${safety.footSafe || !safety.hasIce ? 'pill-good' : 'pill-bad'}">🛡️ Индекс льда: ${safety.index}/100</span>
            </div>
            <div style="margin-top:5px;font-weight:700;color:var(--text);">
              ${safety.vehicleVerdict}
            </div>
            <div style="margin-top:3px;color:var(--muted);">
              ℹ️ ${safety.recommendation}
            </div>
          </div>
        `;
      })()}

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;">
        <div class="card" style="background:var(--card);padding:10px 12px;">
          <div style="font-size:var(--fs-xs);color:var(--muted);font-weight:700;">ТЕМПЕРАТУРА ВОЗДУХА И ВОДЫ</div>
          <div style="font-size:var(--fs-md);font-weight:800;margin-top:4px;">Воздух: ${day.tDay > 0 ? '+' + day.tDay : day.tDay}° / ${day.tNight > 0 ? '+' + day.tNight : day.tNight}°C</div>
          <div style="font-size:var(--fs-sm);color:var(--accent);font-weight:700;margin-top:2px;">💧 Вода (с учётом течения): ~${day.waterTemp}°C</div>
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

      <div style="margin-top:10px;padding:9px 12px;border-radius:var(--r-sm);background:var(--card);border:1px solid var(--border);font-size:var(--fs-xs);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <div>
          🗄️ <b>Метеоархив в радиусе 10 км (${s.locLabel}):</b> накоплено <b>${archiveStats.localArchiveDays}</b> арх. дн.
          (всего в памяти устройства: ${archiveStats.totalArchiveDays} арх. дн. по ${archiveStats.totalLocations} лок.)
          ${s.hasRealArchive === false ? `<span style="color:var(--warn);font-weight:700;"> • ⚠️ Прогноз может быть менее точным из-за отсутствия архивных данных по погоде</span>` : `<span style="color:var(--good);font-weight:700;"> • ✅ 5-дневный архив активен</span>`}
        </div>
        <span style="color:var(--muted);">Хранится бессрочно до очистки (очищается всё, кроме последних 5 дней)</span>
      </div>

      <div style="margin-top:8px;padding:8px 12px;border-radius:var(--r-sm);background:var(--card);font-size:var(--fs-xs);color:var(--muted);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <span>ℹ️ <b>Приоритет факторов:</b> ${RU.moonPriorityNote}</span>
        <span><b>Главные лунные окна:</b> ${m.majorWindows.join(', ')} • <b>Малые окна:</b> ${m.minorWindows.join(', ')}</span>
      </div>
      <details style="margin-top:8px;font-size:var(--fs-xs);color:var(--muted);">
        <summary style="cursor:pointer;font-weight:700;color:var(--accent);">Памятка рыбаку о влиянии фаз Луны и барического шока</summary>
        <p style="margin-top:6px;line-height:1.45;">${RU.solunarDisclaimer}</p>
      </details>
    </div>
  `;

  const cleanBtn = container.querySelector('#weatherCleanArchiveBtn');
  if (cleanBtn) {
    cleanBtn.addEventListener('click', () => {
      const res = storage.clearWeatherArchiveKeep5Days();
      showToast(`🧹 Архив погоды очищен: удалено старых записей — ${res.removedCount}, сохранены последние 5 дней архива (${res.keptArchiveCount} дн.)`, 'good');
      render(container);
    });
  }
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
      const recalc = recalculateIceForWaterType(next.days, next.water, next.archive5Days);
      if (recalc) {
        store.dispatch({
          type: 'SET_WEATHER_DATA',
          payload: {
            days: recalc.days,
            archive5Days: recalc.archive5Days,
            iceState: recalc.iceState,
            iceSubState: recalc.iceSubState,
            iceThickness: recalc.iceThickness,
            iceNote: recalc.iceNote,
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
  computeIceSafetyIndex,
  computeWaterTempSeries,
  evaluateDayIce,
  recalculateIceForWaterType,
  buildFallback,
  normalizeOpenMeteo,
  normalizeMetNo,
  fetchWeather,
  getWeatherState,
  subscribeWeather,
  init,
  render,
  destroy
};
