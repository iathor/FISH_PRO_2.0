import { RU } from '../../i18n/ru.js?v=2.0.15';
import { getSeasonalBaitsForContext, getCompatibleMethods } from '../../core/config.js?v=2.0.15';
import { events } from '../../core/events.js?v=2.0.15';
import { storage } from '../../core/storage.js?v=2.0.15';
import { store } from '../../core/store.js?v=2.0.15';
import { formatLocalYYYYMMDD, fmtDeltaPress } from '../../core/format.js?v=2.0.15';
import { WATER_PROFILES, getAvailableWaterTypes } from '../../data/waters.js?v=2.0.15';
import { FISH_DB } from '../../data/species.js?v=2.0.15';
import { createPill, showToast, openModal, closeModal } from '../../ui/components.js?v=2.0.15';
import { computeMoon } from '../weather/weather.module.js?v=2.0.15';
import { calcHourly } from '../forecast/forecast.module.js?v=2.0.15';

let currentFilter = { fishId: 'all', cond: 'all' };

/**
 * Находит суточный и почасовой (24 ч) метеопрогноз из 10-км кэша локации по выбранной календарной дате YYYY-MM-DD
 */
export function resolveDayWeatherForDate(s, dateStr = null, fallbackDayIdx = null) {
  const todayDt = new Date();
  todayDt.setHours(0, 0, 0, 0);
  const todayStr = formatLocalYYYYMMDD(todayDt);

  let targetDate = dateStr;
  if (!targetDate && Number.isFinite(fallbackDayIdx) && s.weatherDays?.[fallbackDayIdx]) {
    targetDate = s.weatherDays[fallbackDayIdx].date;
  }
  if (!targetDate) targetDate = todayStr;

  // 1. Проверяем 10-км гео-кэш и архив погоды (GeoWeatherArchive)
  const fromGeoCache = storage.getDayWeatherByDate(s.lat, s.lon, targetDate);
  if (fromGeoCache && Array.isArray(fromGeoCache.hours) && fromGeoCache.hours.length > 0) {
    return fromGeoCache;
  }

  // 2. Проверяем массив 5-дневного архива и 12 дней прогноза в store
  const fromArchive5 = (s.weatherArchive5Days || []).find(d => d && d.date === targetDate);
  if (fromArchive5 && Array.isArray(fromArchive5.hours) && fromArchive5.hours.length > 0) {
    return fromArchive5;
  }

  const fromWeatherDays = (s.weatherDays || []).find(d => d && d.date === targetDate);
  if (fromWeatherDays && Array.isArray(fromWeatherDays.hours) && fromWeatherDays.hours.length > 0) {
    return fromWeatherDays;
  }

  // 3. Если выбрана произвольная дата в календаре, которой ещё нет в кэше — строим расчётный день на основе ближайшего дня в кэше
  const refDay = s.weatherDays?.[2] || s.weatherDays?.[0] || {};
  const dt = new Date(targetDate + 'T00:00:00');
  const diffDays = Math.round((dt.getTime() - todayDt.getTime()) / 86400000);
  const relTitle = diffDays === 0 ? 'Сегодня' : (diffDays === -1 ? 'Вчера' : (diffDays === -2 ? 'Позавчера' : (diffDays < 0 ? `${Math.abs(diffDays)} дн. назад` : '')));
  const label = `${RU.daysShort[dt.getDay()]}, ${dt.getDate()} ${RU.monthsGen[dt.getMonth()]}`;
  const moon = computeMoon(targetDate);
  const baseHours = Array.isArray(refDay.hours) && refDay.hours.length === 24 ? refDay.hours : [];
  const hours = [];
  for (let h = 0; h < 24; h++) {
    const bh = baseHours[h] || { tAir: refDay.tDay || 8, press: refDay.pressAvg || 754, dp3h: 0, wind: refDay.windMax || 3, windDir: 'З', cloud: 50, precip: 0 };
    hours.push({ ...bh, hour: h });
  }

  return {
    date: targetDate,
    relTitle,
    label,
    tDay: refDay.tDay ?? 8,
    tNight: refDay.tNight ?? 2,
    waterTemp: refDay.waterTemp ?? 8,
    pressAvg: refDay.pressAvg ?? 754,
    dP: refDay.dP ?? 0,
    windMax: refDay.windMax ?? 3,
    windDir: refDay.windDir || 'З',
    iceState: refDay.iceState || s.iceState || 'open_water',
    moon,
    hours
  };
}

export async function logCatch(catchData) {
  const s = store.getState();
  const day = resolveDayWeatherForDate(s, catchData.date, catchData.dayIdx ?? s.dayIdx);
  const chosenHour = Number.isFinite(catchData.hour) ? catchData.hour : s.selectedHour;
  const hr = (day.hours && day.hours[chosenHour]) || {
    hour: chosenHour ?? new Date().getHours(),
    tAir: day.tDay || 10,
    press: day.pressAvg || 754,
    dp3h: 0,
    wind: day.windMax || 3,
    windDir: day.windDir || 'З'
  };
  const fish = FISH_DB.find(f => f.id === (catchData.fishId || s.fishId)) || FISH_DB[0];
  const predScore = day.hours ? calcHourly(fish, day, hr, catchData.method || s.method, s.water, s.depth, s.normPress, s.iceState) : 50;
  const waterTitle = catchData.waterName || s.selectedWaterName || WATER_PROFILES[s.water]?.shortName || s.locLabel;

  const dt = new Date((day.date || new Date().toISOString().slice(0, 10)) + 'T00:00:00');
  const todayDt = new Date();
  todayDt.setHours(0, 0, 0, 0);
  const diffDays = Math.round((dt.getTime() - todayDt.getTime()) / 86400000);
  const relPrefix = diffDays === 0 ? 'Сегодня' : (diffDays === -1 ? 'Вчера' : (diffDays === -2 ? 'Позавчера' : (diffDays < 0 && diffDays >= -5 ? `${Math.abs(diffDays)} дн. назад` : '')));
  const formattedLabel = day.label || `${RU.daysShort[dt.getDay()]}, ${dt.getDate()} ${RU.monthsGen[dt.getMonth()]}`;

  const record = {
    id: `catch_${Date.now()}`,
    timestamp: Date.now(),
    date: day.date || new Date().toISOString().slice(0, 10),
    dateLabel: relPrefix ? `${relPrefix} (${formattedLabel})` : `${formattedLabel} (${day.date})`,
    hour: hr.hour,
    fishId: fish.id,
    fishName: fish.name,
    weightKg: parseFloat(catchData.weightKg) || 0,
    lengthCm: parseFloat(catchData.lengthCm) || 0,
    method: catchData.method || s.method,
    bait: (catchData.bait || '').trim() || 'Сезонная оснастка',
    matchedForecast: catchData.matchedForecast !== false,
    photoDataUrl: catchData.photoDataUrl || '',
    locLabel: `${s.locLabel} • ${waterTitle}`,
    lat: s.lat,
    lon: s.lon,
    water: s.water,
    depth: s.depth,
    tAir: hr.tAir ?? day.tDay ?? 10,
    waterTemp: day.waterTemp ?? 10,
    press: hr.press ?? 754,
    dP: day.dP ?? 0,
    wind: hr.wind ?? 3,
    windDir: hr.windDir || 'З',
    moonDay: day.moon?.moonDay || 15,
    moonPhase: day.moon?.phaseName || 'Луна',
    predictedScore: predScore
  };

  await storage.putToStore('catches', record);
  const all = await storage.getAllFromStore('catches');
  all.sort((a, b) => b.timestamp - a.timestamp);
  store.dispatch({ type: 'SET_CATCHES', payload: all });
  showToast(`🎣 Улов (${fish.name}, ${record.dateLabel}) записан в журнал и учтён в прогнозе клёва!`, 'good');
  return record;
}

export async function deleteCatch(id) {
  await storage.deleteFromStore('catches', id);
  const all = await storage.getAllFromStore('catches');
  all.sort((a, b) => b.timestamp - a.timestamp);
  store.dispatch({ type: 'SET_CATCHES', payload: all });
}

export function getCatches(filter = {}) {
  const list = store.getState().catches || [];
  return list.filter(c => {
    if (filter.fishId && filter.fishId !== 'all' && c.fishId !== filter.fishId) return false;
    if (filter.cond === 'press_drop' && c.dP >= -1) return false;
    if (filter.cond === 'full_moon' && (c.moonDay < 14 || c.moonDay > 17)) return false;
    if (filter.cond === 'wind_strong' && c.wind <= 5) return false;
    return true;
  });
}

export function getPersonalStats(fishId) {
  const all = store.getState().catches || [];
  const byFish = fishId && fishId !== 'all' ? all.filter(c => c.fishId === fishId) : all;
  if (!byFish.length) {
    return {
      count: 0,
      matchRate: null,
      avgWaterTemp: null,
      avgPress: null,
      topBait: '—'
    };
  }
  const matched = byFish.filter(c => c.matchedForecast).length;
  const matchRate = Math.round((matched / byFish.length) * 100);
  const avgWaterTemp = Math.round((byFish.reduce((a, b) => a + (b.waterTemp || 10), 0) / byFish.length) * 10) / 10;
  const avgPress = Math.round(byFish.reduce((a, b) => a + (b.press || 754), 0) / byFish.length);
  const baitCounts = {};
  byFish.forEach(c => { baitCounts[c.bait] = (baitCounts[c.bait] || 0) + 1; });
  const topBait = Object.entries(baitCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';

  return { count: byFish.length, matchRate, avgWaterTemp, avgPress, topBait };
}

/**
 * Ревизия 2.0.15:
 * Окно записи улова «🎣 Я поймал» с обычным календарём (<input type="date">),
 * быстрыми кнопками выбора за предыдущие 5 дней (и Сегодня) и автоматической подгрузкой почасового прогноза из кэша 10 км!
 */
export function openCatchWizard(prefill = {}) {
  const s = store.getState();
  const todayDt = new Date();
  todayDt.setHours(0, 0, 0, 0);
  const todayStr = formatLocalYYYYMMDD(todayDt);

  const initialDayIdx = prefill.dayIdx ?? s.dayIdx;
  const initialDateStr = prefill.date || s.weatherDays[initialDayIdx]?.date || todayStr;
  let activeDateStr = initialDateStr > todayStr ? todayStr : initialDateStr;
  let activeHour = prefill.hour ?? s.selectedHour;
  const targetFishId = prefill.fishId || s.fishId;

  // Формируем быстрые чипсы: Сегодня + предыдущие 5 дней (Вчера, Позавчера, -3, -4, -5 дн.)
  const quickDates = [];
  for (let offset = 0; offset >= -5; offset--) {
    const dt = new Date(todayDt.getTime() + offset * 86400000);
    const dStr = formatLocalYYYYMMDD(dt);
    const title = offset === 0 ? 'Сегодня' : (offset === -1 ? 'Вчера' : (offset === -2 ? 'Позавчера' : `${Math.abs(offset)} дн. назад`));
    const shortLbl = `${RU.daysShort[dt.getDay()]}, ${dt.getDate()} ${RU.monthsGen[dt.getMonth()]}`;
    quickDates.push({ date: dStr, title, shortLbl });
  }

  let day = resolveDayWeatherForDate(s, activeDateStr, initialDayIdx);
  let hr = (day.hours && day.hours[activeHour]) || { hour: activeHour, tAir: day.tDay || 8, press: day.pressAvg || 754, wind: day.windMax || 3, windDir: 'З' };
  const currentFish = FISH_DB.find(f => f.id === targetFishId) || FISH_DB[0];

  const favSet = new Set(s.favorites || []);
  const sortedSpecies = [...FISH_DB]
    .filter(f => f.legal !== 'redbook' && f.basins.includes(s.basinCode))
    .sort((a, b) => (favSet.has(b.id) ? 1 : 0) - (favSet.has(a.id) ? 1 : 0));

  const compatibleMethods = getCompatibleMethods(currentFish, day.iceState || s.iceState, s.water, day.waterTemp);
  const currentMethodVal = compatibleMethods.some(m => m.val === s.method) ? s.method : compatibleMethods[0]?.val;
  const seasonalBaits = getSeasonalBaitsForContext(currentFish, currentMethodVal, day.waterTemp ?? 12, day.iceState || s.iceState);
  const defaultBait = prefill.bait || s.selectedBait || seasonalBaits[0];

  const availWaters = getAvailableWaterTypes(s.basinCode, s.lat, s.lon);
  const initialWaterName = s.selectedWaterName || (s.nearbyWaters && s.nearbyWaters[0]?.name) || WATER_PROFILES[s.water]?.shortName || 'Река / озеро';

  let photoDataUrl = '';

  const formatSummaryBanner = (dObj, hObj) => {
    const tAirStr = (hObj.tAir > 0 ? '+' + hObj.tAir : hObj.tAir) + '°C';
    return `📸 <b>Метеосводка из кэша 10 км (${dObj.date}, ${String(hObj.hour).padStart(2, '0')}:00):</b> Воздух ${tAirStr} • Вода ~${dObj.waterTemp ?? 10}°C • 🧭 ${hObj.press} мм (Δ ${fmtDeltaPress(dObj.dP ?? 0)}) • 💨 ${hObj.windDir} ${hObj.wind} м/с • ${dObj.moon?.phaseIcon || '🌒'} ${dObj.moon?.moonDay || 12} л.д.`;
  };

  const html = `
    <div style="display:flex;flex-direction:column;gap:10px;font-size:var(--fs-sm);">
      <div id="cwWeatherSummaryBox" style="padding:9px 11px;border-radius:var(--r-sm);background:var(--card);border:1px solid var(--border);font-size:var(--fs-xs);color:var(--accent);line-height:1.4;">
        ${formatSummaryBanner(day, hr)}
      </div>

      <div style="padding:9px 11px;border-radius:var(--r-sm);background:var(--card);border:1px solid var(--border);">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:6px;">
          <label for="cwDateInput" style="font-weight:800;font-size:var(--fs-xs);color:var(--accent);">📅 ДАТА УЛОВА (ОБЫЧНЫЙ КАЛЕНДАРЬ ИЛИ ПРЕДЫДУЩИЕ 5 ДНЕЙ):</label>
          <input type="date" id="cwDateInput" class="input" value="${activeDateStr}" max="${todayStr}" style="max-width:175px;min-height:34px;padding:3px 8px;">
        </div>
        <div class="chip-scroll-row" id="cwQuickDatesRow">
          ${quickDates.map(qd => `
            <button type="button" class="w-chip ${qd.date === activeDateStr ? 'active' : ''}" data-cw-quick-date="${qd.date}">
              ${qd.title} (${qd.shortLbl})
            </button>
          `).join('')}
        </div>
      </div>

      <div style="border-left:3px solid var(--accent);padding-left:8px;margin-bottom:2px;">
        <span style="font-size:var(--fs-xs);color:var(--muted);font-weight:700;">СТРОГАЯ ЦЕПОЧКА ПОИМКИ (УЧИТЫВАЕТСЯ В ПРОГНОЗЕ КЛЁВА):</span>
      </div>

      <div>
        <label style="font-weight:700;font-size:var(--fs-xs);color:var(--muted);">ШАГ 1. ПОЙМАННАЯ РЫБА (ИЗБРАННЫЕ ВВЕРХУ)</label>
        <select id="cwFishId" style="margin-top:3px;">
          ${sortedSpecies.map(f => `<option value="${f.id}" ${f.id === currentFish.id ? 'selected' : ''}>${favSet.has(f.id) ? '⭐ ' : ''}${f.name}</option>`).join('')}
        </select>
      </div>

      <div>
        <label style="font-weight:700;font-size:var(--fs-xs);color:var(--muted);">ШАГ 2. СНАСТЬ (ПОДХОДЯЩАЯ ПОД РЫБУ)</label>
        <select id="cwMethod" style="margin-top:3px;">
          ${compatibleMethods.map(m => `<option value="${m.val}" ${m.val === currentMethodVal ? 'selected' : ''}>${m.text}</option>`).join('')}
        </select>
      </div>

      <div>
        <label style="font-weight:700;font-size:var(--fs-xs);color:var(--muted);">ШАГ 3. СЕЗОННАЯ НАЖИВКА / ПРИМАНКА</label>
        <select id="cwBaitSelect" style="margin-top:3px;">
          ${seasonalBaits.map(b => `<option value="${b}" ${b === defaultBait ? 'selected' : ''}>${b}</option>`).join('')}
          <option value="__custom__">✍️ Свой вариант наживки / воблера...</option>
        </select>
        <input type="text" id="cwBaitCustom" class="input" value="${defaultBait}" placeholder="Уточните модель воблера, насадку или цвет..." style="margin-top:6px;">
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div>
          <label style="font-weight:700;font-size:var(--fs-xs);color:var(--muted);">ШАГ 4. БЛИЖАЙШИЙ ВОДОЁМ</label>
          <select id="cwWaterSelect" style="margin-top:3px;">
            ${(s.nearbyWaters || []).map(w => `<option value="${w.name || w.label}" ${s.selectedWaterName === w.name ? 'selected' : ''}>${w.label}</option>`).join('')}
            ${availWaters.map(w => `<option value="${w.shortName}">${w.name}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="font-weight:700;font-size:var(--fs-xs);color:var(--muted);">ТОЧНОЕ НАЗВАНИЕ ВОДОЁМА</label>
          <input type="text" id="cwWaterName" class="input" value="${initialWaterName}" style="margin-top:3px;">
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div>
          <label style="font-weight:700;font-size:var(--fs-xs);color:var(--muted);">ШАГ 5. ЧАС ПОИМКИ (ПОЧАСОВОЙ КЭШ)</label>
          <select id="cwHour" style="margin-top:3px;">
            ${(day.hours || []).map(h => `<option value="${h.hour}" ${h.hour === activeHour ? 'selected' : ''}>${String(h.hour).padStart(2, '0')}:00 (${h.tAir > 0 ? '+' + h.tAir : h.tAir}°C, ${h.press} мм, ${h.wind} м/с)</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="font-weight:700;font-size:var(--fs-xs);color:var(--muted);">ВЕС ТРОФЕЯ (КГ)</label>
          <input type="number" id="cwWeight" class="input" step="0.05" min="0" placeholder="Напр. 1.85" style="margin-top:3px;">
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div>
          <label style="font-weight:700;font-size:var(--fs-xs);color:var(--muted);">ДЛИНА (СМ, ПО ЖЕЛАНИЮ)</label>
          <input type="number" id="cwLength" class="input" step="1" min="0" placeholder="Напр. 52" style="margin-top:3px;">
        </div>
        <div>
          <label style="font-weight:700;font-size:var(--fs-xs);color:var(--muted);">СОВПАДЕНИЕ С ПРОГНОЗОМ</label>
          <select id="cwMatch" style="margin-top:3px;">
            <option value="yes" selected>👍 Прогноз оправдался</option>
            <option value="no">👎 Клёв вопреки прогнозу</option>
          </select>
        </div>
      </div>

      <div>
        <label style="font-weight:700;font-size:var(--fs-xs);color:var(--muted);">ФОТОГРАФИЯ УЛОВА</label>
        <input type="file" id="cwPhoto" accept="image/*" class="input" style="margin-top:3px;padding:5px;">
      </div>

      <button type="button" class="btn btn-good" id="cwSubmitBtn" style="margin-top:6px;">💾 Записать улов в журнал</button>
    </div>
  `;

  openModal('🎣 Запись улова «Я поймал» (календарь + 5-дневный кэш)', html, (bodyEl) => {
    const dateInput = bodyEl.querySelector('#cwDateInput');
    const summaryBox = bodyEl.querySelector('#cwWeatherSummaryBox');
    const hourSel = bodyEl.querySelector('#cwHour');
    const fishSel = bodyEl.querySelector('#cwFishId');
    const methodSel = bodyEl.querySelector('#cwMethod');
    const baitSel = bodyEl.querySelector('#cwBaitSelect');
    const baitCustom = bodyEl.querySelector('#cwBaitCustom');
    const waterSel = bodyEl.querySelector('#cwWaterSelect');
    const waterNameInput = bodyEl.querySelector('#cwWaterName');

    const syncDateAndHourWeather = (nextDateStr, nextHourVal) => {
      if (nextDateStr) activeDateStr = nextDateStr;
      if (Number.isFinite(nextHourVal)) activeHour = nextHourVal;

      day = resolveDayWeatherForDate(store.getState(), activeDateStr, initialDayIdx);
      hr = (day.hours && day.hours[activeHour]) || day.hours?.[12] || { hour: activeHour, tAir: day.tDay || 8, press: day.pressAvg || 754, wind: day.windMax || 3, windDir: 'З' };

      if (dateInput && dateInput.value !== activeDateStr) {
        dateInput.value = activeDateStr;
      }

      bodyEl.querySelectorAll('[data-cw-quick-date]').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-cw-quick-date') === activeDateStr);
      });

      if (hourSel && Array.isArray(day.hours)) {
        hourSel.innerHTML = day.hours.map(h =>
          `<option value="${h.hour}" ${h.hour === activeHour ? 'selected' : ''}>${String(h.hour).padStart(2, '0')}:00 (${h.tAir > 0 ? '+' + h.tAir : h.tAir}°C, ${h.press} мм, ${h.wind} м/с)</option>`
        ).join('');
      }

      if (summaryBox) {
        summaryBox.innerHTML = formatSummaryBanner(day, hr);
      }
    };

    if (dateInput) {
      dateInput.addEventListener('change', (e) => {
        if (e.target.value) {
          syncDateAndHourWeather(e.target.value, activeHour);
        }
      });
    }

    bodyEl.querySelectorAll('[data-cw-quick-date]').forEach(btn => {
      btn.addEventListener('click', () => {
        const dStr = btn.getAttribute('data-cw-quick-date');
        if (dStr) syncDateAndHourWeather(dStr, activeHour);
      });
    });

    if (hourSel) {
      hourSel.addEventListener('change', (e) => {
        syncDateAndHourWeather(activeDateStr, parseInt(e.target.value, 10));
      });
    }

    if (fishSel) {
      fishSel.addEventListener('change', (e) => {
        const chosenId = e.target.value;
        const fObj = FISH_DB.find(x => x.id === chosenId) || FISH_DB[0];
        const newMethods = getCompatibleMethods(fObj, day.iceState || s.iceState, s.water, day.waterTemp);

        if (methodSel) {
          methodSel.innerHTML = newMethods.map(m => `<option value="${m.val}">${m.text}</option>`).join('');
          const mVal = newMethods[0]?.val;
          const newBaits = getSeasonalBaitsForContext(fObj, mVal, day.waterTemp ?? 12, day.iceState || s.iceState);
          if (baitSel) {
            baitSel.innerHTML = newBaits.map(b => `<option value="${b}">${b}</option>`).join('') + '<option value="__custom__">✍️ Свой вариант...</option>';
            if (baitCustom) baitCustom.value = newBaits[0] || '';
          }
        }
      });
    }

    if (methodSel) {
      methodSel.addEventListener('change', (e) => {
        const chosenMethod = e.target.value;
        const chosenFishId = fishSel?.value || currentFish.id;
        const fObj = FISH_DB.find(x => x.id === chosenFishId) || currentFish;
        const newBaits = getSeasonalBaitsForContext(fObj, chosenMethod, day.waterTemp ?? 12, day.iceState || s.iceState);
        if (baitSel) {
          baitSel.innerHTML = newBaits.map(b => `<option value="${b}">${b}</option>`).join('') + '<option value="__custom__">✍️ Свой вариант...</option>';
          if (baitCustom) baitCustom.value = newBaits[0] || '';
        }
      });
    }

    if (baitSel && baitCustom) {
      baitSel.addEventListener('change', (e) => {
        if (e.target.value !== '__custom__') {
          baitCustom.value = e.target.value;
        } else {
          baitCustom.value = '';
          baitCustom.focus();
        }
      });
    }

    if (waterSel && waterNameInput) {
      waterSel.addEventListener('change', (e) => {
        waterNameInput.value = e.target.value;
      });
    }

    const fileInput = bodyEl.querySelector('#cwPhoto');
    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => { photoDataUrl = String(reader.result || ''); };
        reader.readAsDataURL(file);
      });
    }

    const submitBtn = bodyEl.querySelector('#cwSubmitBtn');
    if (submitBtn) {
      submitBtn.addEventListener('click', async () => {
        const chosenHr = parseInt(bodyEl.querySelector('#cwHour')?.value ?? activeHour, 10);
        const chosenDate = bodyEl.querySelector('#cwDateInput')?.value || activeDateStr;
        await logCatch({
          date: chosenDate,
          dayIdx: initialDayIdx,
          hour: chosenHr,
          waterName: bodyEl.querySelector('#cwWaterName')?.value || '',
          fishId: bodyEl.querySelector('#cwFishId')?.value || currentFish.id,
          method: bodyEl.querySelector('#cwMethod')?.value || currentMethodVal,
          weightKg: bodyEl.querySelector('#cwWeight')?.value || 0,
          lengthCm: bodyEl.querySelector('#cwLength')?.value || 0,
          bait: bodyEl.querySelector('#cwBaitCustom')?.value || defaultBait,
          matchedForecast: bodyEl.querySelector('#cwMatch')?.value === 'yes',
          photoDataUrl
        });
        closeModal();
      });
    }
  });
}

export function renderLog(container) {
  if (!container) return;
  const s = store.getState();
  const activeFish = FISH_DB.find(f => f.id === s.fishId) || FISH_DB[0];
  const filtered = getCatches(currentFilter);
  const statsAll = getPersonalStats('all');
  const statsFish = getPersonalStats(activeFish.id);

  container.innerHTML = `
    <div class="card">
      <div class="section-head">
        <div>
          <span class="section-title">📓 Журнал уловов и личная калибровка прогноза</span>
          <div style="font-size:var(--fs-xs);color:var(--muted);">Уловы можно вносить за сегодня и за предыдущие 5 дней (по календарю с почасовым прогнозом из кэша 10 км). Данные автоматически учитываются в прогнозе клёва!</div>
        </div>
        <div class="toolbar-row">
          <button type="button" class="btn btn-sm btn-good" id="logOpenWizardBtn">🎣 + Записать улов (календарь)</button>
          <button type="button" class="btn btn-sm" id="logExportJsonBtn">📤 Выгрузить файл</button>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px;margin-bottom:12px;">
        <div class="card" style="background:var(--card);padding:10px 12px;">
          <div style="font-size:var(--fs-xs);color:var(--muted);font-weight:700;">СОВПАДЕНИЕ С ПРОГНОЗОМ</div>
          <div style="font-size:var(--fs-lg);font-weight:800;color:var(--good);margin-top:2px;">
            ${statsAll.matchRate !== null ? `Точность прогноза у вас: ${statsAll.matchRate}%` : 'Пока нет записей'}
          </div>
          <div style="font-size:var(--fs-xs);color:var(--muted);margin-top:2px;">Всего уловов в журнале: ${statsAll.count} (участвуют в расчёте клёва)</div>
        </div>
        <div class="card" style="background:var(--card);padding:10px 12px;">
          <div style="font-size:var(--fs-xs);color:var(--muted);font-weight:700;">ЛУЧШИЕ УСЛОВИЯ ПО ВИДУ: ${activeFish.name.toUpperCase()}</div>
          <div style="font-size:var(--fs-sm);font-weight:800;margin-top:4px;">
            ${statsFish.count ? `💧 Вода ~${statsFish.avgWaterTemp}°C • 🧭 ${statsFish.avgPress} мм` : 'Добавьте улов по этому виду'}
          </div>
          <div style="font-size:var(--fs-xs);color:var(--accent);margin-top:2px;">Лучшая наживка/снасть: ${statsFish.topBait}</div>
        </div>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
        <select id="logFilterFish" style="max-width:220px;">
          <option value="all" ${currentFilter.fishId === 'all' ? 'selected' : ''}>Все рыбы (${(s.catches || []).length})</option>
          ${FISH_DB.filter(f => (s.catches || []).some(c => c.fishId === f.id)).map(f => `
            <option value="${f.id}" ${currentFilter.fishId === f.id ? 'selected' : ''}>${f.name}</option>
          `).join('')}
        </select>
        <select id="logFilterCond" style="max-width:240px;">
          <option value="all" ${currentFilter.cond === 'all' ? 'selected' : ''}>Любая погода</option>
          <option value="press_drop" ${currentFilter.cond === 'press_drop' ? 'selected' : ''}>Падение давления (Δ < −1 мм)</option>
          <option value="full_moon" ${currentFilter.cond === 'full_moon' ? 'selected' : ''}>Полнолуние (14–17 л.д.)</option>
          <option value="wind_strong" ${currentFilter.cond === 'wind_strong' ? 'selected' : ''}>Свежий ветер (> 5 м/с)</option>
        </select>
      </div>

      ${filtered.length === 0 ? `
        <div style="padding:16px;text-align:center;background:var(--card);border-radius:var(--r-sm);color:var(--muted);font-size:var(--fs-sm);">
          Записей пока нет. Нажмите <b>«🎣 + Записать улов (календарь)»</b>, чтобы выбрать дату за последние 5 дней (или сегодня) — почасовой прогноз из кэша локации подставится автоматически!
        </div>
      ` : `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(265px,1fr));gap:10px;">
          ${filtered.map(c => `
            <div class="card" style="background:var(--card);padding:10px 12px;display:flex;flex-direction:column;gap:5px;">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="font-weight:800;font-size:var(--fs-md);">${c.fishName} ${c.weightKg ? `• ${c.weightKg} кг` : ''} ${c.lengthCm ? `(${c.lengthCm} см)` : ''}</span>
                <button type="button" class="btn btn-sm" style="min-height:28px;padding:2px 7px;color:var(--bad);" data-del-catch="${c.id}" aria-label="Удалить запись">✕</button>
              </div>
              <div style="font-size:var(--fs-xs);color:var(--muted);">
                📅 ${c.dateLabel}, ${String(c.hour).padStart(2, '0')}:00 • 📍 ${c.locLabel} (${c.depth} м)
              </div>
              <div style="display:flex;gap:4px;flex-wrap:wrap;">
                ${createPill({ text: `Вода ${c.waterTemp}°C`, tone: 'neutral' })}
                ${createPill({ text: `${c.press} мм (Δ${c.dP})`, tone: 'neutral' })}
                ${createPill({ text: `${c.windDir} ${c.wind} м/с`, tone: 'neutral' })}
                ${createPill({ text: c.matchedForecast ? '👍 Совпал' : '👎 Вопреки', tone: c.matchedForecast ? 'good' : 'warn' })}
              </div>
              <div style="font-size:var(--fs-xs);color:var(--accent);">Наживка / приманка: <b>${c.bait}</b></div>
              ${c.photoDataUrl ? `<img src="${c.photoDataUrl}" alt="Улов ${c.fishName}" style="max-height:110px;border-radius:6px;object-fit:cover;margin-top:4px;">` : ''}
            </div>
          `).join('')}
        </div>
      `}
    </div>
  `;

  bindLogEvents(container);
}

function bindLogEvents(container) {
  const openBtn = container.querySelector('#logOpenWizardBtn');
  if (openBtn) openBtn.addEventListener('click', () => openCatchWizard());

  const expBtn = container.querySelector('#logExportJsonBtn');
  if (expBtn) {
    expBtn.addEventListener('click', () => {
      const sanitized = (store.getState().catches || []).map(({ photoDataUrl, ...rest }) => rest);
      const blob = new Blob([JSON.stringify(sanitized, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `klev-pro-catches-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast('Журнал уловов сохранён в файл', 'good');
    });
  }

  const fFish = container.querySelector('#logFilterFish');
  if (fFish) {
    fFish.addEventListener('change', (e) => {
      currentFilter.fishId = e.target.value;
      renderLog(container);
    });
  }

  const fCond = container.querySelector('#logFilterCond');
  if (fCond) {
    fCond.addEventListener('change', (e) => {
      currentFilter.cond = e.target.value;
      renderLog(container);
    });
  }

  container.querySelectorAll('[data-del-catch]').forEach(btn => {
    btn.addEventListener('click', () => deleteCatch(btn.getAttribute('data-del-catch')));
  });
}

export function render(container) {
  renderLog(container);
}

let unsub = null;
let unsubEvent = null;

export async function init(container) {
  // 1. Мгновенная синхронная подгрузка из резерва и первичная отрисовка Журнала (0 мс, без ожидания IndexedDB!)
  const localCatches = storage.getLocalBackup ? storage.getLocalBackup('catches') : [];
  if (Array.isArray(localCatches) && localCatches.length > 0) {
    localCatches.sort((a, b) => b.timestamp - a.timestamp);
    store.dispatch({ type: 'SET_CATCHES', payload: localCatches });
  }

  render(container);

  if (unsub) unsub();
  unsub = store.subscribe(
    s => ({ catches: s.catches, fishId: s.fishId }),
    () => render(container)
  );

  if (unsubEvent) unsubEvent();
  unsubEvent = events.on('forecast:hourSelected', (payload) => {
    openCatchWizard(payload);
  });

  // 2. Асинхронная синхронизация с IndexedDB после отрисовки интерфейса
  try {
    const all = await storage.getAllFromStore('catches');
    if (Array.isArray(all)) {
      all.sort((a, b) => b.timestamp - a.timestamp);
      store.dispatch({ type: 'SET_CATCHES', payload: all });
    }
  } catch (e) {}
}

export function destroy() {
  if (unsub) unsub();
  if (unsubEvent) unsubEvent();
}

export const logModule = {
  resolveDayWeatherForDate,
  logCatch,
  deleteCatch,
  getCatches,
  getPersonalStats,
  openCatchWizard,
  renderLog,
  init,
  render,
  destroy
};
