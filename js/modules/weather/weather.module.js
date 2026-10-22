import { RU } from '../../i18n/ru.js';
import { events } from '../../core/events.js';
import { storage } from '../../core/storage.js';
import { store } from '../../core/store.js';
import { fetchWithTimeout, fallbackChain } from '../../core/http.js';
import { formatLocalYYYYMMDD, fmtHM, fmtDeltaPress } from '../../core/format.js';
import { createPill } from '../../ui/components.js';

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
export function evaluateDayIce(historyMeanTemps, tDayMax, tNightMin, waterTemp, waterType) {
  if (waterType === 'cooling_reservoir') {
    return { iceState: 'open_water', iceThickness: 0 };
  }
  let freezeSum = 0;
  let freezeDays = 0;
  for (let i = historyMeanTemps.length - 1; i >= 0; i--) {
    const m = historyMeanTemps[i];
    if (m <= 0) {
      freezeDays++;
      freezeSum += Math.abs(m);
    } else if (historyMeanTemps.length - 1 - i <= 2) {
      break;
    }
  }
  const tCurMean = (tDayMax + tNightMin) / 2;
  if (freezeDays >= 4 && freezeSum >= 38 && tDayMax <= -2) {
    return {
      iceState: 'ice_safe',
      iceThickness: Math.min(110, Math.max(12, Math.round(2.1 * Math.sqrt(freezeSum))))
    };
  }
  if ((tCurMean <= -1.2 || (tDayMax <= 0.5 && tNightMin <= -4)) && waterTemp <= 1.5 && freezeSum >= 6) {
    return {
      iceState: 'ice_danger',
      iceThickness: Math.min(8, Math.max(2, Math.round(0.9 * Math.sqrt(freezeSum))))
    };
  }
  return { iceState: 'open_water', iceThickness: 0 };
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
    const ice = evaluateDayIce(histSlice, tMax, tMin, waterTemp, waterType);
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
      iceThickness: ice.iceThickness,
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
    iceThickness: todayObj.iceThickness
  };
}
function normalizeOpenMeteo(data, waterType) {
  const elevation = Math.round(data.elevation || 90);
  const normPress = Math.round(760 - elevation / 11.5);
  const allP = data.hourly.surface_pressure.map(v => (v || 1010) * 0.750062);
  const totalDays = data.daily.time.length;
  const startIdx = Math.max(0, totalDays - 12);
  const dailyMeans = data.daily.time.map((_, idx) => (
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
    const rel = outIdx - 2; // -2, -1, 0, +1..+9
    const dStr = data.daily.time[i];
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
    const ice = evaluateDayIce(dailyMeans.slice(0, i + 1), tMax, tMin, waterTemp, waterType);
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
      iceThickness: ice.iceThickness,
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
    iceThickness: todayObj?.iceThickness || 0
  };
}
function normalizeMetNo(metNo, lat, waterType) {
  const fb = buildFallback(lat, waterType);
  const coords = metNo.geometry?.coordinates || [];
  const elevation = Math.round(coords[2] || 90);
  const normPress = Math.round(760 - elevation / 11.5);
  const byDate = {};
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
  });
  return {
    days: fb.days,
    elevation,
    normPress,
    iceState: fb.days[2]?.iceState || fb.days[0].iceState,
    iceThickness: fb.days[2]?.iceThickness || 0
  };
}
export async function fetchWeather(lat, lon, forceNetwork = false) {
  const st = store.getState();
  const cached = storage.loadWeatherCache(lat, lon);
  if (cached && cached.days && cached.days.length === 12 && !forceNetwork) {
    const mins = cached.ageMinutes || 1;
    const label = mins >= 60 ? `${RU.cachedPrefix} (${Math.round(mins / 60)} ч назад)` : `${RU.cachedPrefix} (${mins} мин назад)`;
    store.dispatch({ type: 'SET_WEATHER_DATA',
      payload: { ...cached, source: label, updatedAt: cached.timestamp } });
    events.emit('weather:updated', store.getState());
    if (!cached.isExpired) return;
  }
  const omUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&past_days=5&hourly=temperature_2m,surface_pressure,wind_speed_10m,wind_direction_10m,cloud_cover,precipitation&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,wind_speed_10m_max,wind_direction_10m_dominant&forecast_days=10&wind_speed_unit=ms&timezone=auto`;
  const metUrl = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
  try {
    const res = await fallbackChain([
      {
        name: RU.online,
        run: async () => {
          const d = await fetchWithTimeout(omUrl, 7000);
          return d && d.hourly && d.daily ? normalizeOpenMeteo(d, st.water) : null;
        }
      },
      {
        name: RU.online,
        run: async () => {
          const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(omUrl)}`;
          const d = await fetchWithTimeout(proxyUrl, 7500);
          return d && d.hourly && d.daily ? normalizeOpenMeteo(d, st.water) : null;
        }
      },
      {
        name: RU.onlineMetNo,
        run: async () => {
          const d = await fetchWithTimeout(metUrl, 7000);
          return d && d.properties?.timeseries ? normalizeMetNo(d, lat, st.water) : null;
        }
      }
    ]);
    storage.saveWeatherCache(lat, lon, res.data);
    store.dispatch({ type: 'SET_WEATHER_DATA',
      payload: { ...res.data, source: res.source, updatedAt: Date.now() } });
    events.emit('weather:updated', store.getState());
  } catch (err) {
    if (!cached || !cached.days?.length) {
      const fb = buildFallback(lat, st.water);
      store.dispatch({ type: 'SET_WEATHER_DATA',
        payload: { ...fb, source: RU.offlineMode, updatedAt: Date.now() } });
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
  return store.subscribe(s => ({ days: s.weatherDays, dayIdx: s.dayIdx, source: s.weatherSource }), cb);
}
export function render(container) {
  if (!container) return;
  const prevScrolls = Array.from(container.querySelectorAll('.chip-scroll-row')).map(el => el.scrollLeft);
  const s = store.getState();
  const day = s.weatherDays[s.dayIdx] || s.weatherDays[2] || s.weatherDays[0];
  if (!day) return;
  const m = day.moon;
  container.innerHTML = `
    <div class="card">
      <div class="section-head">
        <span class="section-title">🌦️ Погода, температура воды и Луна (${day.relTitle ? day.relTitle + ' • ' : ''}${day.label})</span>
        ${createPill({ text: s.weatherSource || RU.offlineMode, tone: (s.weatherSource || '').includes('Онлайн') ? 'good' : 'warn', icon: '📡' })}
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
    store.dispatch({ type: 'SET_WEATHER_DATA',
      payload: { ...fb, source: RU.syncing, updatedAt: Date.now() } });
  }
  render(container);
  unsub = subscribeWeather(() => render(container));
  fetchWeather(st.lat, st.lon);
}
export function destroy() {
  if (unsub) unsub();
}

export const weatherModule = {
  computeMoon,
  evaluateDayIce,
  buildFallback,
  fetchWeather,
  getWeatherState,
  subscribeWeather,
  init,
  render,
  destroy
};
