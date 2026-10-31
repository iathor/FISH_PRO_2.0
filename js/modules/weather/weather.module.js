import { RU } from '../../i18n/ru.js?v=2.5.0';
import { events } from '../../core/events.js?v=2.5.0';
import { storage } from '../../core/storage.js?v=2.5.0';
import { store } from '../../core/store.js?v=2.5.0';
import { fetchWithTimeout, fallbackChain } from '../../core/http.js?v=2.5.0';
import { formatLocalYYYYMMDD, fmtHM, fmtDeltaPress } from '../../core/format.js?v=2.5.0';
import { WATER_PROFILES } from '../../data/waters.js?v=2.5.0';
import { createPill, showToast } from '../../ui/components.js?v=2.5.0';

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
  let phaseIcon = '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" fill="#fbbf24" stroke="#f59e0b" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  if (moonDay === 1 || moonDay >= 29) { phaseName = 'Новолуние'; phaseIcon = '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" fill="#fbbf24" stroke="#f59e0b" stroke-width="1.6" stroke-linejoin="round"/></svg>'; }
  else if (moonDay >= 14 && moonDay <= 16) { phaseName = 'Полнолуние'; phaseIcon = '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4.5" fill="#fbbf24" stroke="#f59e0b" stroke-width="1.6"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" stroke="#fbbf24" stroke-width="1.8" stroke-linecap="round"/></svg>'; }
  else if (moonDay >= 7 && moonDay <= 8) { phaseName = 'Первая четверть'; phaseIcon = '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" fill="#fbbf24" stroke="#f59e0b" stroke-width="1.6" stroke-linejoin="round"/></svg>'; }
  else if (moonDay >= 22 && moonDay <= 23) { phaseName = 'Последняя четверть'; phaseIcon = '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" fill="#fbbf24" stroke="#f59e0b" stroke-width="1.6" stroke-linejoin="round"/></svg>'; }
  else if (moonDay > 16) { phaseName = 'Убывающая луна'; phaseIcon = '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" fill="#fbbf24" stroke="#f59e0b" stroke-width="1.6" stroke-linejoin="round"/></svg>'; }
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
 * предотвращает мгновенное переохлаждение поверхности при околонулевых качелях (-4..+3 °C).
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
export function evaluateDayIce(historyMeanTemps, tDayMax, tNightMin, waterTemp, waterType = 'small_river', dateStr = '', windSpeed = 3, precip = 0) {
  if (waterType === 'cooling_reservoir') {
    return {
      iceState: 'open_water',
      iceSubState: 'warm_discharge',
      iceThickness: 0,
      iceNote: '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg> Тёплый сброс ГРЭС/АЭС — круглогодично открытая вода (ледостава нет)'
    };
  }

  const prof = WATER_PROFILES[waterType] || WATER_PROFILES.small_river;
  const flow = Number.isFinite(prof.flow) ? prof.flow : 1.0;
  const flowLabel = flow >= 1.8 ? 'быстрое течение' : (flow >= 1.1 ? 'умеренное течение' : 'стоячая вода / слабый ток');
  const wind = Number.isFinite(windSpeed) ? windSpeed : 3;

  const dt = dateStr ? new Date(dateStr + 'T12:00:00') : new Date();
  const monthNum = dt.getMonth() + 1;
  const isSpring = monthNum >= 3 && monthNum <= 5;
  const isAutumn = monthNum >= 9 && monthNum <= 11;

  const recent = Array.isArray(historyMeanTemps) && historyMeanTemps.length > 0
    ? historyMeanTemps
    : [(tDayMax + tNightMin) / 2];

  const tCurMean = (tDayMax + tNightMin) / 2;

  // 1. ЗАКОН ТЕПЛОЗАПАСА: При температуре воды выше +0.5 °C сплошной ледостав ФИЗИЧЕСКИ НЕВОЗМОЖЕН!
  // Идёт предзимнее конвективное перемешивание водной толщи.
  if (waterTemp > 0.5) {
    if (tNightMin <= -0.5) {
      if (wind >= 5.5) {
        return {
          iceState: 'ice_slush',
          iceSubState: 'wind_wave_slush',
          iceThickness: 0,
          iceNote: `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2v20M2 12h20M4.9 4.9l14.2 14.2M19.1 4.9L4.9 19.1" stroke="#7dd3fc" stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="12" r="2.2" fill="#38bdf8"/></svg> Ветро-волновое перемешивание: вода остывает (+${waterTemp.toFixed(1)}°C), ветер ${wind} м/с сбивает кристаллы в шугу (${flowLabel}, сплошного льда нет)`
        };
      }
      return {
        iceState: 'ice_slush',
        iceSubState: 'slush_shore_ice',
        iceThickness: 0,
        iceNote: `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2v20M2 12h20M4.9 4.9l14.2 14.2M19.1 4.9L4.9 19.1" stroke="#7dd3fc" stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="12" r="2.2" fill="#38bdf8"/></svg> Забереги и редкая шуга вдоль берега: вода остывает (+${waterTemp.toFixed(1)}°C), ледостава нет (${flowLabel})`
      };
    }
    return {
      iceState: 'open_water',
      iceSubState: 'cooling_open_water',
      iceThickness: 0,
      iceNote: `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg> Открытая вода: предзимнее охлаждение водоёма (+${waterTemp.toFixed(1)}°C, ${flowLabel}, льда нет)`
    };
  }

  // 2. ВОДА ОСТЫЛА ДО ПРЕДЕЛА ЗАМЕРЗАНИЯ (waterTemp <= 0.4 °C)
  // Считаем строго НЕПРЕРЫВНЫЕ морозные дни ПОСЛЕ охлаждения воды
  let consecFreezeDays = 0;
  let freezeSum = 0;
  let recentWarmDays = 0;
  let warmDegreeDays = 0;

  for (let i = recent.length - 1; i >= 0; i--) {
    const m = recent[i];
    const daysAgo = recent.length - 1 - i;
    if (m <= -0.5) {
      consecFreezeDays++;
      const effFreeze = Math.max(0, Math.abs(m) - (flow > 1.5 ? 1.5 : (flow > 1.0 ? 0.6 : 0)));
      freezeSum += effFreeze;
    } else {
      if (daysAgo <= 3 && m > 0.5) {
        recentWarmDays++;
        warmDegreeDays += m;
      }
      if (daysAgo <= 2 && m > 1.5) {
        break; // Недавняя оттепель разорвала цепочку ледостава
      }
    }
  }

  // Весеннее разрушение льда при потеплении
  if ((isSpring || recentWarmDays >= 2) && (tDayMax >= 3.0 || tCurMean >= 1.0 || warmDegreeDays >= 4)) {
    const remThick = Math.max(3, Math.min(25, Math.round(15 - warmDegreeDays * 1.2)));
    return {
      iceState: 'ice_danger',
      iceSubState: 'spring_rotten_ice',
      iceThickness: remThick,
      iceNote: `<svg class="k-ico" style="color:var(--warn);" viewBox="0 0 24 24" fill="none"><path d="M12 3L2.5 19.5h19L12 3z" fill="rgba(245,158,11,0.24)" stroke="#f59e0b" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 9v5M12 17h.01" stroke="#fbbf24" stroke-width="2" stroke-linecap="round"/></svg> Опасный весенний лёд (~${remThick} см, ${flowLabel}): дневной прогрев до +${tDayMax}°C, рыхлый игольчатый лёд, промоины и закраины — выход на лёд смертельно опасен!`
    };
  }

  // Расчёт толщины льда по модели Стефана-Зубова с поправками на течение и ветровое волнение:
  // flowFactor: 1.0 для стоячей воды, 0.75 для среднего течения, 0.55 для быстрого течения
  const flowFactor = 1.35 / (1.0 + 0.45 * flow);
  const windPenalty = wind >= 6.5 ? 0.70 : (wind >= 4.5 ? 0.85 : 1.0);
  const rawIceCm = Math.round(1.55 * Math.sqrt(Math.max(0, freezeSum)) * flowFactor * windPenalty - warmDegreeDays * 0.9);
  const effectiveIceCm = Math.max(0, Math.min(130, rawIceCm));

  // Пороги безопасного монолитного льда
  const minSafeCm = flow >= 1.8 ? 12 : (flow >= 1.1 ? 10 : 8);
  const minFreezeDays = flow >= 1.8 ? 5 : (flow >= 1.1 ? 4 : 3);
  const minFreezeSum = flow >= 1.8 ? 55 : (flow >= 1.1 ? 40 : 28);

  // 3. Устойчивый безопасный ледостав
  if (consecFreezeDays >= minFreezeDays && freezeSum >= minFreezeSum && effectiveIceCm >= minSafeCm && tDayMax <= 0.5) {
    return {
      iceState: 'ice_safe',
      iceSubState: 'solid_freeze',
      iceThickness: effectiveIceCm,
      iceNote: `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2v20M2 12h20M4.9 4.9l14.2 14.2M19.1 4.9L4.9 19.1" stroke="#7dd3fc" stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="12" r="2.2" fill="#38bdf8"/></svg> Устойчивый ледостав: безопасный монолитный лёд ~${effectiveIceCm} см (с учётом течения: ${flowLabel})`
    };
  }

  // 4. Тонкий перволёдок (первые 1–3 дня мороза)
  if (consecFreezeDays >= 1 && (tCurMean <= -0.5 || tNightMin <= -3.0)) {
    if (consecFreezeDays === 1) {
      return {
        iceState: 'ice_danger',
        iceSubState: 'first_day_ice',
        iceThickness: 1,
        iceNote: `<svg class="k-ico" style="color:var(--warn);" viewBox="0 0 24 24" fill="none"><path d="M12 3L2.5 19.5h19L12 3z" fill="rgba(245,158,11,0.24)" stroke="#f59e0b" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 9v5M12 17h.01" stroke="#fbbf24" stroke-width="2" stroke-linecap="round"/></svg> Первый день мороза: тончайшая ледяная корка ~1 см (${flowLabel}) — выход на лёд смертельно опасен!`
      };
    }
    const thinCm = Math.max(2, Math.min(minSafeCm - 1, effectiveIceCm || (consecFreezeDays * 1.5)));
    return {
      iceState: 'ice_danger',
      iceSubState: 'thin_first_ice',
      iceThickness: Math.round(thinCm),
      iceNote: `<svg class="k-ico" style="color:var(--warn);" viewBox="0 0 24 24" fill="none"><path d="M12 3L2.5 19.5h19L12 3z" fill="rgba(245,158,11,0.24)" stroke="#f59e0b" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 9v5M12 17h.01" stroke="#fbbf24" stroke-width="2" stroke-linecap="round"/></svg> Тонкий перволёдок (~${Math.round(thinCm)} см, ${flowLabel}): лёд хрупкий и не набрал безопасную толщину (${minSafeCm} см) — выход на лёд запрещён!`
    };
  }

  // 5. Околонулевые колебания (шуга / открытая вода)
  if (tNightMin <= -0.5 && tDayMax >= 0.0) {
    return {
      iceState: 'ice_slush',
      iceSubState: 'slush_shore_ice',
      iceThickness: 0,
      iceNote: `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2v20M2 12h20M4.9 4.9l14.2 14.2M19.1 4.9L4.9 19.1" stroke="#7dd3fc" stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="12" r="2.2" fill="#38bdf8"/></svg> Забереги и шуга (${flowLabel}, ледостава нет)`
    };
  }

  return {
    iceState: 'open_water',
    iceSubState: 'open_water',
    iceThickness: 0,
    iceNote: `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg> Открытая вода (льда нет, ${flowLabel})`
  };
}

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
      vehicleVerdict: "<svg class=\"k-ico\" style=\"color:var(--bad);\" viewBox=\"0 0 24 24\" fill=\"none\"><circle cx=\"12\" cy=\"12\" r=\"9\" fill=\"rgba(239,68,68,0.22)\" stroke=\"#ef4444\" stroke-width=\"1.9\"/><path d=\"M6 6l12 12\" stroke=\"#ef4444\" stroke-width=\"2.1\" stroke-linecap=\"round\"/></svg> Пешком и на технике ЗАПРЕЩЕНО!",
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
      ? `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> Пешком: РАЗРЕШЕНО (≥${minFootCm} см) • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> Мотобуксировщик/снегоход: РАЗРЕШЕНО (≥${minSledCm} см)`
      : `<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> Пешком со спасалками: РАЗРЕШЕНО (≥${minFootCm} см) • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> Техника/снегоход: ОПАСНО (нужно ≥${minSledCm} см!)`,
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
    const wMaxVal = Math.round(data.daily.wind_speed_10m_max?.[i] || 3);
    const ice = evaluateDayIce(dailyMeans.slice(0, i + 1), tMax, tMin, waterTemp, waterType, dStr, wMaxVal);

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
 * сегодняшнего дня MET.no, пересчитывает waterTemp (с учётом течения flow) и ледостав, и выставляет hasRealArchive = false!
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
    const ice = evaluateDayIce(seriesMeans.slice(0, idx + 1), d.tDay, d.tNight, d.waterTemp, waterType, d.date, d.windMax || 3);
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
    const ice = evaluateDayIce(hist, d.tDay, d.tNight, wt, waterType, d.date, d.windMax || 3);
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
const WORKER_WEATHER_EDGE_URL = 'https://klevprohbot.thorantony82.workers.dev/weather';
const inFlightWeatherRequests = new Map();

function snapCoord10km(val) {
  return (Math.round((Number(val) || 0) * 10) / 10).toFixed(1);
}

async function fetchMissingArchiveDays(lat, lon, waterType) {
  const todayDt = new Date();
  todayDt.setHours(0, 0, 0, 0);
  const startDt = new Date(todayDt.getTime() - 5 * 86400000);
  const endDt = new Date(todayDt.getTime() - 1 * 86400000);
  const startStr = formatLocalYYYYMMDD(startDt);
  const endStr = formatLocalYYYYMMDD(endDt);
  const gLat = snapCoord10km(lat);
  const gLon = snapCoord10km(lon);

  const histForecastUrl = `https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=${gLat}&longitude=${gLon}&start_date=${startStr}&end_date=${endStr}&hourly=temperature_2m,surface_pressure,wind_speed_10m,wind_direction_10m,cloud_cover,precipitation&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,wind_speed_10m_max,wind_direction_10m_dominant&wind_speed_unit=ms&timezone=auto`;
  const archiveApiUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${gLat}&longitude=${gLon}&start_date=${startStr}&end_date=${endStr}&hourly=temperature_2m,surface_pressure,wind_speed_10m,wind_direction_10m,cloud_cover,precipitation&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,wind_speed_10m_max,wind_direction_10m_dominant&wind_speed_unit=ms&timezone=auto`;
  const workerEdgeUrl = `${WORKER_WEATHER_EDGE_URL}?lat=${gLat}&lon=${gLon}`;

  const candidates = [
    histForecastUrl,
    archiveApiUrl,
    workerEdgeUrl,
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

  const gLat = snapCoord10km(lat);
  const gLon = snapCoord10km(lon);
  const gridDedupKey = `${gLat}_${gLon}_${st.water || 'small_river'}`;
  if (inFlightWeatherRequests.has(gridDedupKey) && !forceNetwork) {
    return inFlightWeatherRequests.get(gridDedupKey);
  }

  const omUrl = `https://api.open-meteo.com/v1/forecast?latitude=${gLat}&longitude=${gLon}&past_days=7&hourly=temperature_2m,surface_pressure,wind_speed_10m,wind_direction_10m,cloud_cover,precipitation&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,wind_speed_10m_max,wind_direction_10m_dominant&forecast_days=10&wind_speed_unit=ms&timezone=auto`;
  const workerEdgeWeatherUrl = `${WORKER_WEATHER_EDGE_URL}?lat=${gLat}&lon=${gLon}`;
  const metUrl = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${gLat}&lon=${gLon}`;

  const networkPromise = (async () => {
  try {
    const res = await fallbackChain([
      {
        name: `${RU.online} (Edge 10 км)`,
        run: async () => {
          const raceTask = (url, ms) => fetchWithTimeout(url, ms).then(d => {
            const norm = d && d.hourly && d.daily ? normalizeOpenMeteo(d, st.water) : null;
            if (!norm) throw new Error('Invalid weather payload');
            return norm;
          });
          if (typeof Promise.any === 'function') {
            return await Promise.any([
              raceTask(workerEdgeWeatherUrl, 3800),
              raceTask(omUrl, 3800)
            ]);
          }
          const d = await fetchWithTimeout(workerEdgeWeatherUrl, 4200);
          return d && d.hourly && d.daily ? normalizeOpenMeteo(d, st.water) : null;
        }
      },
      {
        name: `${RU.online} (Edge 10 км)`,
        run: async () => {
          const d = await fetchWithTimeout(workerEdgeWeatherUrl, 5500);
          return d && d.hourly && d.daily ? normalizeOpenMeteo(d, st.water) : null;
        }
      },
      {
        name: RU.online,
        run: async () => {
          const d = await fetchWithTimeout(omUrl, 5000);
          return d && d.hourly && d.daily ? normalizeOpenMeteo(d, st.water) : null;
        }
      },
      {
        name: RU.onlineMetNo,
        run: async () => {
          const d = await fetchWithTimeout(metUrl, 7000);
          if (!d || !d.properties?.timeseries) return null;

          // Проверяем, есть ли в 10-км кэше минимум 3 архивных дня для этой локации
          let archiveSeed = localArchiveInfo.days || [];
          if (archiveSeed.filter(x => x && x.isReal !== false).length < 3) {
            const fetchedArchive = await fetchMissingArchiveDays(lat, lon, st.water);
            if (Array.isArray(fetchedArchive) && fetchedArchive.length >= 3) {
              archiveSeed = fetchedArchive;
            }
          }
          return normalizeMetNo(d, lat, st.water, archiveSeed);
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
  } finally {
    inFlightWeatherRequests.delete(gridDedupKey);
  }
  })();
  inFlightWeatherRequests.set(gridDedupKey, networkPromise);
  return networkPromise;
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
      route: s.route,
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
  const days = s.weatherDays || [];
  const dayIdx = Number.isFinite(s.dayIdx) ? s.dayIdx : 2;
  const day = days[dayIdx] || days[2] || days[0];
  if (!day) return;
  const m = day.moon || computeMoon(day.date || '2026-10-30');
  const prof = WATER_PROFILES[s.water] || WATER_PROFILES.small_river;
  const flowLabel = prof.flow >= 1.8 ? 'быстрое течение' : (prof.flow >= 1.1 ? 'умеренное течение' : 'стоячая вода');
  const archiveStats = storage.getWeatherArchiveStats(s.lat, s.lon);
  const safety = computeIceSafetyIndex(day, s.water);
  const waterTitle = s.selectedWaterName || prof.shortName || 'Водоём';

  // Автоматическое сезонное название и режим (летом — Открытая вода, в межсезонье — Забереги и шуга, зимой — Ледовый режим)
  const isIceSeason = day.iceState === 'ice_safe' || day.iceState === 'ice_danger';
  const isSlushSeason = day.iceState === 'ice_slush';
  const heroTitle = isIceSeason
    ? '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2v20M2 12h20M4.9 4.9l14.2 14.2M19.1 4.9L4.9 19.1" stroke="#7dd3fc" stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="12" r="2.2" fill="#38bdf8"/></svg> Погода и Ледовая обстановка'
    : (isSlushSeason ? '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2v20M2 12h20M4.9 4.9l14.2 14.2M19.1 4.9L4.9 19.1" stroke="#7dd3fc" stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="12" r="2.2" fill="#38bdf8"/></svg> Погода и Предзимний режим водоёма' : '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg> Погода и Режим открытой воды');

  const heroVerdictShort = day.iceState === 'ice_safe'
    ? `БЕЗОПАСНЫЙ ЛЁД (~${day.iceThickness || 12} СМ)`
    : (day.iceState === 'ice_danger'
        ? `ОПАСНЫЙ ЛЁД (~${day.iceThickness || 4} СМ)`
        : (day.iceState === 'ice_slush' ? 'ЗАБЕРЕГИ И ШУГА' : 'ОТКРЫТАЯ ВОДА'));

  const heroTone = (day.iceState === 'ice_safe' || day.iceState === 'open_water')
    ? 'var(--good)'
    : (day.iceState === 'ice_slush' ? 'var(--warn)' : 'var(--bad)');

  // Расчёт индекса для полукруглой шкалы сонара:
  // В ледостав/шугу показываем Индекс безопасности льда (0..100), по открытой воде — Индекс метеокомфорта акватории
  const openWaterComfort = Math.max(15, Math.min(98, Math.round(92 - Math.max(0, (day.windMax || 3) - 3) * 8 - Math.abs(day.dP || 0) * 3)));
  const gaugeScore = (isIceSeason || isSlushSeason) ? safety.index : openWaterComfort;
  const gaugeArcLen = Math.round((Math.max(6, Math.min(100, gaugeScore)) / 100) * 188.5);
  const gaugeSubTitle = (isIceSeason || isSlushSeason) ? 'Индекс льда:' : 'Комфорт воды:';
  const gaugeLvlWord = (isIceSeason || isSlushSeason)
    ? (safety.footSafe ? 'Пешком можно' : 'Только берег')
    : ((day.windMax || 3) <= 5 ? 'Лодка и берег' : 'Волна у берега');

  // Почасовой график температуры воздуха и давления (00:00–24:00)
  const hrs = Array.isArray(day.hours) && day.hours.length ? day.hours : Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    tAir: Math.round((day.tNight + (day.tDay - day.tNight) * Math.sin(Math.max(0, (h - 5) / 14) * Math.PI)) * 10) / 10,
    press: day.pressAvg || 752
  }));
  const tVals = hrs.map(h => Number(h.tAir ?? day.tDay ?? 0));
  const minT = Math.min(...tVals);
  const maxT = Math.max(...tVals);
  const spanT = Math.max(2, maxT - minT);
  const svgW = 320, svgH = 88, padL = 12, padR = 12, padT = 18, padB = 16;
  const plotW = svgW - padL - padR;
  const plotH = svgH - padT - padB;
  const pts = hrs.map((h, idx) => {
    const x = Math.round((padL + (idx / Math.max(1, hrs.length - 1)) * plotW) * 10) / 10;
    const norm = (Number(h.tAir ?? 0) - minT) / spanT;
    const y = Math.round((padT + (1 - norm) * plotH) * 10) / 10;
    return { x, y, t: h.tAir, p: h.press, hr: h.hour };
  });
  let wavePathD = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i], p1 = pts[i + 1];
    const cx = Math.round(((p0.x + p1.x) / 2) * 10) / 10;
    wavePathD += ` C ${cx} ${p0.y}, ${cx} ${p1.y}, ${p1.x} ${p1.y}`;
  }
  const waveAreaD = `${wavePathD} L ${pts[pts.length - 1].x} ${svgH - 4} L ${pts[0].x} ${svgH - 4} Z`;
  const coldPt = pts[6] || pts[0];
  const warmPt = pts[14] || pts[Math.floor(pts.length / 2)];

  const tDayStr = `${day.tDay > 0 ? '+' + day.tDay : day.tDay}°C`;
  const tNightStr = `${day.tNight > 0 ? '+' + day.tNight : day.tNight}°C`;
  const wTempStr = `${day.waterTemp > 0 ? '+' + day.waterTemp : day.waterTemp}°C`;

  container.innerHTML = `
    <div class="bento-dashboard-wrap">
      <!-- Горизонтальная лента быстрого выбора дня прямо во вкладке Погода -->
      <div class="chip-scroll-row" id="weatherDaysStrip" style="padding-bottom:2px;">
        ${days.map((d, idx) => {
          const isAct = idx === dayIdx;
          const dTitle = idx === 2 ? '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2c1.5 3.5 4.5 5.5 4.5 10a5.5 5.5 0 1 1-11 0c0-3 2-5.5 3.5-7 0 2 1.5 3 1.5 3S12 5.5 12 2z" fill="#f97316" stroke="#fbbf24" stroke-width="1.5" stroke-linejoin="round"/></svg> Сегодня' : (idx === 3 ? '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><polygon points="13,2 4,14 11,14 10,22 20,10 13,10" fill="#fbbf24" stroke="#f59e0b" stroke-width="1.5" stroke-linejoin="round"/></svg> Завтра' : (d.relTitle || d.label));
          const dTemp = `${d.tDay > 0 ? '+' + d.tDay : d.tDay}°`;
          return `
            <button type="button" class="w-chip ${isAct ? 'active' : ''}" data-weather-pick-day="${idx}" style="padding:5px 11px;min-height:36px;">
              <span>${dTitle}</span>
              <span style="opacity:0.85;font-weight:800;">${dTemp}</span>
            </button>
          `;
        }).join('')}
      </div>

      <!-- КАРТОЧКА 1 (Bento Hero): Сезонный режим водоёма и безопасность воды/льда -->
      <div class="bento-card bento-hero-card">
        <div class="bento-card-head">
          <div>
            <div class="bento-card-title">
              <span>${heroTitle}</span>
            </div>
            <div class="bento-card-sub">
              <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z" fill="rgba(239,68,68,0.22)" stroke="#ef4444" stroke-width="1.9"/><circle cx="12" cy="11" r="2.3" fill="#ef4444"/></svg> ${s.locLabel} (${waterTitle} • ${flowLabel}) • ${day.relTitle ? day.relTitle + ' (' + day.label + ')' : day.label}
            </div>
          </div>
          ${createPill({ text: s.weatherSource || RU.offlineMode, tone: (s.weatherSource || '').includes('Онлайн') ? 'good' : 'warn', icon: '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="5" stroke="#38bdf8" stroke-width="1.5"/><path d="M12 12l6-6" stroke="#10b981" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="1.8" fill="#10b981"/></svg>' })}
        </div>

        <div class="bento-hero-grid">
          <div class="bento-hero-left">
            <div class="bento-status-verdict" style="color:${heroTone};margin-bottom:4px;">
              ${heroVerdictShort}
            </div>
            <div style="font-size:12.5px;font-weight:800;color:var(--text);line-height:1.38;margin-bottom:6px;">
              ${day.iceNote || (day.iceState === 'open_water' ? `Открытая вода (~${day.waterTemp}°C), льда нет (${flowLabel})` : safety.vehicleVerdict)}
            </div>
            <div style="padding:8px 10px;border-radius:12px;background:var(--panel);border:1px solid var(--border);font-size:11.5px;line-height:1.38;">
              <div style="font-weight:800;color:var(--text);margin-bottom:2px;">${safety.vehicleVerdict}</div>
              <div style="color:var(--muted);"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" fill="rgba(56,189,248,0.18)" stroke="#38bdf8" stroke-width="1.8"/><path d="M12 11v5M12 8h.01" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg> ${safety.recommendation}</div>
            </div>
          </div>

          <div class="bento-gauge-col">
            <div class="bento-gauge-svg-box">
              <svg viewBox="0 0 156 90" width="156" height="90" fill="none" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="weatherGaugeGrad" x1="0%" y1="100%" x2="100%" y2="0%">
                    <stop offset="0%" stop-color="var(--gauge-start, #3b82f6)"/>
                    <stop offset="100%" stop-color="var(--gauge-end, #10b981)"/>
                  </linearGradient>
                </defs>
                <path d="M 18 78 A 60 60 0 0 1 138 78" stroke="var(--gauge-track, #dbe7f3)" stroke-width="12" stroke-linecap="round" fill="none"/>
                <path d="M 18 78 A 60 60 0 0 1 138 78" stroke="url(#weatherGaugeGrad)" stroke-width="12" stroke-linecap="round" fill="none" stroke-dasharray="${gaugeArcLen} 200"/>
              </svg>
              <div class="bento-gauge-center-text">
                <span class="bento-gauge-sub">${gaugeSubTitle}</span>
                <span class="bento-gauge-lvl">${gaugeLvlWord}</span>
                <span class="bento-gauge-pct">${gaugeScore}%</span>
              </div>
            </div>
            <div class="bento-tackle-summary">
              <span style="color:var(--muted);font-size:11px;">Вода с учётом течения:</span><br>
              <b style="font-size:14px;color:var(--accent);"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3c0 0-6 7.1-6 11.5a6 6 0 0 0 12 0C18 10.1 12 3 12 3z" fill="rgba(56,189,248,0.32)" stroke="#38bdf8" stroke-width="1.8"/><path d="M9.5 15.5c.5 1.2 1.7 2 3 2" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg> ${wTempStr}</b>
            </div>
          </div>
        </div>
      </div>

      <!-- КАРТОЧКА 2 (Двойной Bento-ряд 50% / 50%): Температура + Давление и Ветер -->
      <div class="bento-bottom-duo">
        <div class="bento-card bento-weather-card" style="cursor:default;">
          <div class="bento-card-title" style="margin-bottom:8px;font-size:14.5px;">
            <span><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M14 14.76V5a2 2 0 1 0-4 0v9.76a4 4 0 1 0 4 0z" fill="rgba(56,189,248,0.22)" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="17.5" r="1.8" fill="#ef4444"/></svg></span>
            <span>Воздух & Вода</span>
          </div>
          <div class="bento-weather-rows">
            <div class="bento-temp-split">
              <div>
                <div class="bento-temp-air">${tDayStr}</div>
                <div style="font-size:10.5px;color:var(--muted);font-weight:700;">Днём (ночью ${tNightStr})</div>
              </div>
              <div class="bento-temp-water-box">
                <div style="font-size:15px;font-weight:900;color:var(--accent);"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3c0 0-6 7.1-6 11.5a6 6 0 0 0 12 0C18 10.1 12 3 12 3z" fill="rgba(56,189,248,0.32)" stroke="#38bdf8" stroke-width="1.8"/><path d="M9.5 15.5c.5 1.2 1.7 2 3 2" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg> ${wTempStr}</div>
                <div style="font-size:10.5px;color:var(--muted);font-weight:700;">Вода (${flowLabel})</div>
              </div>
            </div>
            <div class="bento-weather-item-row">
              <span style="font-size:16px;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg></span>
              <div>
                <div style="font-weight:800;color:var(--text);">Биотоп: ${waterTitle}</div>
                <div style="font-size:10.5px;color:var(--muted);">Глубина в точке: ~${s.depth.toFixed(1)} м</div>
              </div>
            </div>
          </div>
        </div>

        <div class="bento-card bento-radar-card" style="cursor:default;">
          <div class="bento-card-title" style="margin-bottom:8px;font-size:14.5px;">
            <span><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><polygon points="16,8 13.5,13.5 8,16 10.5,10.5" fill="#38bdf8" stroke="currentColor" stroke-width="1.3"/></svg></span>
            <span>Барометр & Ветер</span>
          </div>
          <div class="bento-weather-rows">
            <div class="bento-temp-split">
              <div>
                <div class="bento-temp-air" style="font-size:21px;">${day.pressAvg} <span style="font-size:12px;font-weight:700;">мм</span></div>
                <div style="font-size:10.5px;color:var(--muted);font-weight:700;">Тренд: ${fmtDeltaPress(day.dP)}</div>
              </div>
              <div class="bento-temp-water-box">
                <div style="font-size:14px;font-weight:900;color:var(--good);"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> ${day.windDir} ${day.windMax} м/с</div>
                <div style="font-size:10.5px;color:var(--muted);font-weight:700;">Ветер и волна</div>
              </div>
            </div>
            <div class="bento-weather-item-row">
              <span style="font-size:16px;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M3 20L10 6l5 9 3-5 3 10H3z" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg></span>
              <div>
                <div style="font-weight:800;color:var(--text);">Норма: ${s.normPress} мм (${s.elevation} м)</div>
                <div style="font-size:10.5px;color:var(--muted);">Осадки за сутки: ${day.precip || 0} мм</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- КАРТОЧКА 3 (Bento Chart): Суточный ход температуры и давления 00:00–24:00 -->
      <div class="bento-card bento-chart-card">
        <div class="bento-card-head" style="margin-bottom:4px;">
          <div class="bento-card-title">
            <span><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M3 3v18h18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M7 15l4-5 4 3 5-7" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
            <span>Суточный ход температуры воздуха и давления</span>
          </div>
          <span style="font-size:12px;font-weight:800;color:var(--muted);">00:00–24:00</span>
        </div>
        <div style="width:100%;overflow:hidden;">
          <svg viewBox="0 0 ${svgW} ${svgH}" width="100%" height="90" preserveAspectRatio="none" style="display:block;overflow:visible;">
            <defs>
              <linearGradient id="weatherWaveFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="var(--wave-fill-top, rgba(59,130,246,0.35))"/>
                <stop offset="100%" stop-color="var(--wave-fill-bot, rgba(59,130,246,0.02))"/>
              </linearGradient>
            </defs>
            <line x1="${padL}" y1="${padT + plotH * 0.5}" x2="${svgW - padR}" y2="${padT + plotH * 0.5}" stroke="var(--border)" stroke-dasharray="3 3" stroke-width="0.8" opacity="0.6"/>
            <path d="${waveAreaD}" fill="url(#weatherWaveFill)"/>
            <path d="${wavePathD}" fill="none" stroke="var(--wave-stroke, #2563eb)" stroke-width="2.6" stroke-linecap="round"/>
            <circle cx="${coldPt.x}" cy="${coldPt.y}" r="4" fill="#ffffff" stroke="var(--wave-stroke, #2563eb)" stroke-width="2.2"/>
            <circle cx="${warmPt.x}" cy="${warmPt.y}" r="4" fill="#ffffff" stroke="var(--wave-stroke, #2563eb)" stroke-width="2.2"/>
            <text x="${coldPt.x}" y="${Math.max(11, coldPt.y - 6)}" text-anchor="middle" fill="var(--text)" font-size="9.5" font-weight="800">06:00 (${coldPt.t > 0 ? '+' + coldPt.t : coldPt.t}°C)</text>
            <text x="${warmPt.x}" y="${Math.max(11, warmPt.y - 6)}" text-anchor="middle" fill="var(--text)" font-size="9.5" font-weight="800">14:00 (${warmPt.t > 0 ? '+' + warmPt.t : warmPt.t}°C)</text>
          </svg>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:2px 10px 0;font-size:11px;font-weight:800;color:var(--muted);">
            <span>00:00</span>
            <span><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4.5" fill="#fbbf24" stroke="#f59e0b" stroke-width="1.6"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" stroke="#fbbf24" stroke-width="1.8" stroke-linecap="round"/></svg> Восход ${fmtHM(day.sunriseHr)}</span>
            <span>12:00 (${day.pressAvg} мм)</span>
            <span><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4.5" fill="#fbbf24" stroke="#f59e0b" stroke-width="1.6"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" stroke="#fbbf24" stroke-width="1.8" stroke-linecap="round"/></svg> Закат ${fmtHM(day.sunsetHr)}</span>
            <span>24:00</span>
          </div>
        </div>
      </div>

      <!-- КАРТОЧКА 4 (Bento Solunar & Archive): Луна, Солунарные окна и 5-дневный кэш 10 км -->
      <div class="bento-card">
        <div class="bento-card-head">
          <div>
            <div class="bento-card-title">
              <span>${m.phaseIcon}</span>
              <span>Луна: ${m.phaseName} (${m.moonDay} л.д., освещённость ${m.illum}%)</span>
            </div>
            <div class="bento-card-sub">
              <svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4.5" fill="#fbbf24" stroke="#f59e0b" stroke-width="1.6"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" stroke="#fbbf24" stroke-width="1.8" stroke-linecap="round"/></svg> Восход ${fmtHM(day.sunriseHr)} • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4.5" fill="#fbbf24" stroke="#f59e0b" stroke-width="1.6"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" stroke="#fbbf24" stroke-width="1.8" stroke-linecap="round"/></svg> Закат ${fmtHM(day.sunsetHr)} • Приоритет: термика и барометр важнее фазы Луны
            </div>
          </div>
          <button type="button" class="btn btn-sm" id="weatherCleanArchiveBtn" title="Очистить старый архив погоды, кроме последних 5 дней"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> Очистить кэш</button>
        </div>

        <div class="bento-metrics-grid" style="margin-bottom:8px;">
          <div class="bento-metric-tile">
            <div class="bento-metric-label"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4.5" fill="#fbbf24" stroke="#f59e0b" stroke-width="1.6"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" stroke="#fbbf24" stroke-width="1.8" stroke-linecap="round"/></svg> Главные лунные выходы</div>
            <div class="bento-metric-val" style="font-size:14.5px;color:var(--good);">${m.majorWindows.join(' • ')}</div>
            <div class="bento-metric-sub">Верхняя и нижняя кульминация Луны</div>
          </div>
          <div class="bento-metric-tile">
            <div class="bento-metric-label"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" fill="#fbbf24" stroke="#f59e0b" stroke-width="1.6" stroke-linejoin="round"/></svg> Малые лунные окна</div>
            <div class="bento-metric-val" style="font-size:14.5px;color:var(--accent);">${m.minorWindows.join(' • ')}</div>
            <div class="bento-metric-sub">Восход и заход Луны над горизонтом</div>
          </div>
          <div class="bento-metric-tile">
            <div class="bento-metric-label"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> Метеоархив (радиус 10 км)</div>
            <div class="bento-metric-val" style="font-size:14.5px;">${archiveStats.localArchiveDays} арх. дн.</div>
            <div class="bento-metric-sub">${s.hasRealArchive === false ? '<svg class="k-ico" style="color:var(--warn);" viewBox="0 0 24 24" fill="none"><path d="M12 3L2.5 19.5h19L12 3z" fill="rgba(245,158,11,0.24)" stroke="#f59e0b" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 9v5M12 17h.01" stroke="#fbbf24" stroke-width="2" stroke-linecap="round"/></svg> Накапливается' : '<svg class="k-ico" style="color:var(--good);" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" fill="rgba(16,185,129,0.24)" stroke="#10b981" stroke-width="1.9"/><path d="M8 12.5l2.7 2.7L16.5 9.5" stroke="#10b981" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg> 5-дневный архив активен'} (всего ${archiveStats.totalArchiveDays} дн.)</div>
          </div>
        </div>

        <details style="font-size:12px;color:var(--muted);">
          <summary style="cursor:pointer;font-weight:800;color:var(--accent);"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" fill="rgba(56,189,248,0.18)" stroke="#38bdf8" stroke-width="1.8"/><path d="M12 11v5M12 8h.01" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg> Как фазы Луны и барический шок влияют на рыбу</summary>
          <p style="margin-top:6px;line-height:1.45;">${RU.solunarDisclaimer}</p>
        </details>
      </div>
    </div>
  `;

  container.querySelectorAll('[data-weather-pick-day]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-weather-pick-day'), 10);
      if (Number.isFinite(idx)) {
        store.dispatch({ type: 'SET_DAY', payload: idx });
      }
    });
  });

  const cleanBtn = container.querySelector('#weatherCleanArchiveBtn');
  if (cleanBtn) {
    cleanBtn.addEventListener('click', () => {
      const res = storage.clearWeatherArchiveKeep5Days();
      showToast(` Архив погоды очищен: удалено старых записей — ${res.removedCount}, сохранены последние 5 дней архива (${res.keptArchiveCount} дн.)`, 'good');
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
    if (next.route && next.route !== 'weather') {
      if (container) container._weatherNeedsRender = true;
      return;
    }
    if (container) container._weatherNeedsRender = false;
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
