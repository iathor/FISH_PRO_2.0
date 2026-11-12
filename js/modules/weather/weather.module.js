import { RU } from '../../i18n/ru.js?v=2.9.1-r236';
import { events } from '../../core/events.js?v=2.9.1-r236';
import { storage } from '../../core/storage.js?v=2.9.1-r236';
import { store } from '../../core/store.js?v=2.9.1-r236';
import { fetchWithTimeout, fallbackChain } from '../../core/http.js?v=2.9.1-r236';
import { formatLocalYYYYMMDD, fmtHM, fmtDeltaPress } from '../../core/format.js?v=2.9.1-r236';
import { WATER_PROFILES } from '../../data/waters.js?v=2.9.1-r236';
import { createPill, showToast } from '../../ui/components.js?v=2.9.1-r236';
const DIRS = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];

/**
 * ── ЯДРО ГИДРОМЕТЦЕНТРА РОССИИ (METEOINFO.RU) • РЕВИЗИЯ 2.8.3 (r235) ──
 * 1. 4 микро-парсера (StationWeatherParser, HydroReviewNLPParser, RoadAndStormAlertParser, SpaceWeatherParser)
 * 2. Геопоиск 3 ближайших опорных метеостанций РФ и интерполяция методом обратных взвешенных расстояний (IDW)
 *    с барометрической и высотной поправкой (dT = -0.0065 * dz, dP = -dz / 11.5)
 * 3. Рекуррентная модель теплового баланса воды Монингера/Ньютона с ветровым перемешиванием и осенней гомотермией (+4.0 °C)
 * 4. Модифицированная модель льда Стефана — Быдина с теплоизоляцией снега, методикой Шуляковского (FDD),
 *    весенним игольчатым распадом (TDD >= 15..25 °C*сут) и ассимиляцией данных (Data Assimilation) сводок Гидрометцентра.
 */
export const METEOINFO_RU_STATIONS = [
  { id: '23358', slug: 'yamalo-nenetskiy-avtonomnyy-okrug/novyy-urengoy', name: 'Новый Уренгой', region: 'Ямало-Ненецкий АО', basin: 'pur_taz', lat: 66.0833, lon: 76.6800, elev: 45, climoNovT: -15.5, hydroIceRangeCm: [20, 33] },
  { id: '23330', slug: 'yamalo-nenetskiy-avtonomnyy-okrug/salekhard', name: 'Салехард', region: 'Ямало-Ненецкий АО', basin: 'ob_lower', lat: 66.5300, lon: 66.6000, elev: 16, climoNovT: -13.8, hydroIceRangeCm: [12, 30] },
  { id: '23445', slug: 'yamalo-nenetskiy-avtonomnyy-okrug/nadym', name: 'Надым', region: 'Ямало-Ненецкий АО', basin: 'nadym', lat: 65.5333, lon: 72.5167, elev: 19, climoNovT: -14.8, hydroIceRangeCm: [13, 31] },
  { id: '23552', slug: 'yamalo-nenetskiy-avtonomnyy-okrug/tarko-sale', name: 'Тарко-Сале', region: 'Ямало-Ненецкий АО', basin: 'pur_taz', lat: 64.9167, lon: 77.7667, elev: 27, climoNovT: -14.2, hydroIceRangeCm: [12, 29] },
  { id: '23662', slug: 'yamalo-nenetskiy-avtonomnyy-okrug/noyabrsk', name: 'Ноябрьск', region: 'Ямало-Ненецкий АО', basin: 'ob_middle', lat: 63.2000, lon: 75.4500, elev: 115, climoNovT: -12.4, hydroIceRangeCm: [11, 26] },
  { id: '23849', slug: 'khanty-mansiyskiy-avtonomnyy-okrug/surgut', name: 'Сургут', region: 'Ханты-Мансийский АО', basin: 'ob_middle', lat: 61.2500, lon: 73.4167, elev: 44, climoNovT: -9.8, hydroIceRangeCm: [6, 18] },
  { id: '23933', slug: 'khanty-mansiyskiy-avtonomnyy-okrug/khanty-mansiysk', name: 'Ханты-Мансийск', region: 'Ханты-Мансийский АО', basin: 'ob_irtysh', lat: 61.0000, lon: 69.0167, elev: 46, climoNovT: -8.9, hydroIceRangeCm: [5, 16] },
  { id: '28367', slug: 'tyumenskaya-oblast/tyumen', name: 'Тюмень', region: 'Тюменская область', basin: 'tob_irtysh', lat: 57.1500, lon: 65.5333, elev: 102, climoNovT: -5.2, hydroIceRangeCm: [0, 10] },
  { id: '28440', slug: 'sverdlovskaya-oblast/ekaterinburg', name: 'Екатеринбург', region: 'Свердловская область', basin: 'ural_kama', lat: 56.8333, lon: 60.6000, elev: 283, climoNovT: -4.8, hydroIceRangeCm: [0, 9] },
  { id: '29634', slug: 'novosibirskaya-oblast/novosibirsk', name: 'Новосибирск', region: 'Новосибирская область', basin: 'ob_upper', lat: 55.0167, lon: 82.9167, elev: 162, climoNovT: -6.5, hydroIceRangeCm: [2, 12] },
  { id: '29570', slug: 'krasnoyarskiy-kray/krasnoyarsk', name: 'Красноярск', region: 'Красноярский край', basin: 'yenisei', lat: 56.0167, lon: 92.8667, elev: 276, climoNovT: -6.1, hydroIceRangeCm: [2, 14] },
  { id: '24959', slug: 'respublika-sakha-yakutiya/yakutsk', name: 'Якутск', region: 'Республика Саха (Якутия)', basin: 'lena', lat: 62.0333, lon: 129.7333, elev: 101, climoNovT: -26.4, hydroIceRangeCm: [18, 38] },
  { id: '22113', slug: 'murmanskaya-oblast/murmansk', name: 'Мурманск', region: 'Мурманская область', basin: 'kola_white', lat: 68.9667, lon: 33.0833, elev: 51, climoNovT: -4.5, hydroIceRangeCm: [3, 14] },
  { id: '22550', slug: 'arkhangelskaya-oblast/arkhangelsk', name: 'Архангельск', region: 'Архангельская область', basin: 'dvina_north', lat: 64.5333, lon: 40.5333, elev: 8, climoNovT: -4.2, hydroIceRangeCm: [2, 12] },
  { id: '26063', slug: 'leningradskaya-oblast/sankt-peterburg', name: 'Санкт-Петербург', region: 'Ленинградская область', basin: 'neva_baltic', lat: 59.9333, lon: 30.3333, elev: 6, climoNovT: 0.8, hydroIceRangeCm: [0, 0] },
  { id: '27612', slug: 'mosковская-oblast/moskva', name: 'Москва (ВДНХ)', region: 'Московская область', basin: 'oka_volga', lat: 55.8333, lon: 37.6167, elev: 156, climoNovT: -0.9, hydroIceRangeCm: [0, 2] },
  { id: '27595', slug: 'respublika-tatarstan/kazan', name: 'Казань', region: 'Республика Татарстан', basin: 'volga_middle', lat: 55.7833, lon: 49.1167, elev: 116, climoNovT: -2.4, hydroIceRangeCm: [0, 5] },
  { id: '34880', slug: 'astrakhanskaya-oblast/astrakhan', name: 'Астрахань', region: 'Астраханская область', basin: 'volga_lower', lat: 46.3500, lon: 48.0333, elev: -22, climoNovT: 3.6, hydroIceRangeCm: [0, 0] },
  { id: '30710', slug: 'irkutskaya-oblast/irkutsk', name: 'Иркутск', region: 'Иркутская область', basin: 'angara_baikal', lat: 52.2833, lon: 104.3000, elev: 469, climoNovT: -7.8, hydroIceRangeCm: [4, 16] },
  { id: '31510', slug: 'amurskaya-oblast/blagoveshchensk', name: 'Благовещенск', region: 'Амурская область', basin: 'amur', lat: 50.2667, lon: 127.5333, elev: 137, climoNovT: -10.2, hydroIceRangeCm: [11, 28] }
];

export function findNearestMeteoinfoStations(lat, lon, k = 3) {
  const effLat = Number.isFinite(lat) ? lat : 66.0833;
  const effLon = Number.isFinite(lon) ? lon : 76.6800;
  const withDist = METEOINFO_RU_STATIONS.map(st => {
    const dLat = ((st.lat - effLat) * Math.PI) / 180;
    const dLon = ((st.lon - effLon) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos((effLat * Math.PI) / 180) * Math.cos((st.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    const distKm = Math.max(0.5, 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
    return { ...st, distKm: Math.round(distKm * 10) / 10, idwWeight: 1 / (distKm ** 1.6) };
  }).sort((a, b) => a.distKm - b.distKm);
  const topK = withDist.slice(0, Math.max(1, k));
  const sumW = topK.reduce((s, x) => s + x.idwWeight, 0) || 1;
  return topK.map(x => ({ ...x, normWeight: x.idwWeight / sumW }));
}

export const MeteoInfoRuParsers = {
  /**
   * 1. StationWeatherParser: Извлекает 6-часовые ряды Highcharts 6.0.7 со страниц /forecasts5000 и /pogoda
   * и достраивает хвост +8..+10 суток методом релаксации к климатической норме станции с учётом декадной аномалии.
   */
  parseHighchartsForecastHtml(htmlText, stationMeta = null, decadalAnomalyC = 0.0) {
    if (!htmlText || typeof htmlText !== 'string') return null;
    try {
      const extractNumberArray = (labelPattern) => {
        const rx = new RegExp(labelPattern + '[\\s\\S]{0,240}?data\\s*:\\s*\\[([0-9.,\\s+-]+)\\]', 'i');
        const m = htmlText.match(rx);
        if (!m || !m[1]) return [];
        return m[1].split(',').map(v => parseFloat(v.trim())).filter(Number.isFinite);
      };
      let temps6h = extractNumberArray('(?:Температура|t_air|temp)');
      let press6h = extractNumberArray('(?:Давление|pressure|press)');
      let hum6h = extractNumberArray('(?:Влажность|humidity|hum)');
      let precip6h = extractNumberArray('(?:Осадки|precip)');

      if (temps6h.length < 4) {
        const genericSeries = [...htmlText.matchAll(/data\s*:\s*\[([0-9.,\s+-]{12,})\]/g)]
          .map(m => m[1].split(',').map(v => parseFloat(v.trim())).filter(Number.isFinite))
          .filter(arr => arr.length >= 8);
        for (const arr of genericSeries) {
          const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
          if (avg >= 680 && avg <= 815 && press6h.length === 0) press6h = arr;
          else if (avg >= -55 && avg <= 45 && temps6h.length === 0) temps6h = arr;
          else if (avg >= 25 && avg <= 100 && hum6h.length === 0) hum6h = arr;
          else if (avg >= 0 && avg <= 35 && precip6h.length === 0) precip6h = arr;
        }
      }
      if (temps6h.length < 4) return null;

      // Достраиваем +8..+10 суток (12 шестичасовых слотов = 3 суток) методом релаксации к климатической норме:
      // w(t) плавно затухает от 0.6 на 8-е сутки до 0.2 на 10-е сутки
      const climoT = Number.isFinite(stationMeta?.climoNovT) ? stationMeta.climoNovT : -4.0;
      const climoP = Math.round(760 - (stationMeta?.elev || 60) / 11.5);
      const lastT = temps6h[temps6h.length - 1];
      const lastP = press6h.length > 0 ? press6h[press6h.length - 1] : climoP;
      const extendedTemps6h = [...temps6h];
      const extendedPress6h = press6h.length > 0 ? [...press6h] : temps6h.map(() => climoP);
      const extendedPrecip6h = precip6h.length > 0 ? [...precip6h] : temps6h.map(() => 0);

      for (let step = 0; step < 12; step++) {
        const w = 0.6 - (step / 11) * 0.4; // 0.6 -> 0.2
        const diurnal = Math.sin(((step % 4) - 1) * (Math.PI / 2)) * 2.2;
        const targetClimo = climoT + decadalAnomalyC + diurnal;
        extendedTemps6h.push(Math.round((w * lastT + (1 - w) * targetClimo) * 10) / 10);
        extendedPress6h.push(Math.round(w * lastP + (1 - w) * climoP));
        extendedPrecip6h.push(0);
      }
      return {
        temps6h: extendedTemps6h,
        press6h: extendedPress6h,
        hum6h,
        precip6h: extendedPrecip6h,
        stationId: stationMeta?.id || 'unknown'
      };
    } catch (e) {
      return null;
    }
  },

  /**
   * 2. HydroReviewNLPParser: Извлекает из Гидрологических обзоров и /egmb фактическую толщину льда (см),
   * скачки уровня воды dH (м), ледовые заторы/зажоры и прогнозные даты появления льда / вскрытия рек.
   */
  parseHydroReviewText(text) {
    if (!text || typeof text !== 'string') return { events: [], thicknessRanges: [] };
    const clean = text.replace(/\s+/g, ' ');
    const thicknessRanges = [];
    const events = [];

    // Толщина льда: «На замерзших реках ... толщина льда составляет 11-33 см»
    const thickRx = /([А-ЯЁа-яё\-\s,()]{5,110}?)\s*толщина\s+льда\s+(?:составляет\s+)?(\d{1,3})\s*(?:[-–—]\s*(\d{1,3}))?\s*см/gi;
    for (const m of clean.matchAll(thickRx)) {
      const regionText = m[1].trim();
      const minCm = parseInt(m[2], 10);
      const maxCm = m[3] ? parseInt(m[3], 10) : minCm;
      if (Number.isFinite(minCm) && minCm >= 1 && maxCm <= 250) {
        thicknessRanges.push({
          regionText,
          minCm: Math.min(minCm, maxCm),
          maxCm: Math.max(minCm, maxCm),
          midCm: Math.round((minCm + maxCm) / 2)
        });
      }
    }

    // Даты появления льда / вскрытия рек: «3-9 ноября ожидается появление льда на р. Обь ...»
    const iceDateRx = /(\d{1,2})\s*(?:[-–—]\s*(\d{1,2}))?\s+(января|февраля|марта|апреля|мая|октября|ноября|декабря)\s+ожидается\s+(появление\s+льда|становление\s+ледостава|вскрытие)\s+на\s+(.{5,180}?(?:\)|(?=\s+\d{1,2}\s*[-–—])|$))/gi;
    for (const m of clean.matchAll(iceDateRx)) {
      events.push({
        type: m[4].toLowerCase().includes('вскрытие') ? 'river_breakup_forecast' : 'ice_appearance_forecast',
        dayStart: parseInt(m[1], 10),
        dayEnd: m[2] ? parseInt(m[2], 10) : parseInt(m[1], 10),
        monthName: m[3].toLowerCase(),
        phenomenon: m[4],
        reachText: m[5].trim()
      });
    }

    // Заторы / зажоры и подъём уровня воды dH: «Зажор льда сформировался на р. Ока ... к росту уровня воды на (0,7-1,0 м)»
    const jamRx = /(затор|зажор)\s+льда[\s\S]{0,160}?(?:росту|подъему|повышению)\s+уровня\s+воды\s+на\s*\(?(\d+[.,]\d+)\s*(?:[-–—]\s*(\d+[.,]\d+))?\s*м\)?/gi;
    for (const m of clean.matchAll(jamRx)) {
      const d1 = parseFloat(m[2].replace(',', '.'));
      const d2 = m[3] ? parseFloat(m[3].replace(',', '.')) : d1;
      events.push({
        type: 'ice_jam_surge',
        jamKind: m[1].toLowerCase(),
        deltaLevelMinM: d1,
        deltaLevelMaxM: d2,
        deltaLevelAvgM: Math.round(((d1 + d2) / 2) * 100) / 100,
        rawText: m[0].trim()
      });
    }

    return { thicknessRanges, events };
  },

  /**
   * 3. RoadAndStormAlertParser: Классифицирует дорожные и штормовые угрозы по РД 52.27.724
   * (NONE / SLIPPERY_60KMH / GLAZE_30KMH / SNOWDRIFT)
   */
  parseRoadAndStormAlerts(text, tMax = null, tMin = null, windMax = 3, precipMm = 0) {
    const clean = String(text || '').toLowerCase();
    let roadIceRisk = 'NONE';
    let safeSpeedKmh = 90;
    let alertNote = '';

    if (/(голол[её]д(?:[^а-яё]|$)|ледян[а-яё]*\s+дожд|переохлажден[а-яё]*\s+дожд|отложени[а-яё]*\s+на\s+проводах)/i.test(clean)) {
      roadIceRisk = 'GLAZE_30KMH';
      safeSpeedKmh = 35;
      alertNote = 'Внимание: по данным Гидрометцентра зафиксирован гололёд (намерзание переохлаждённых осадков). Безопасная скорость на трассе до 30–40 км/ч.';
    } else if (/(снежн[а-яё]*\s+занос|снежн[а-яё]*\s+накат|метел[а-яё]*|видимост[а-яё]*\s+(?:менее\s+|до\s+)?500\s*м|перем[её]т)/i.test(clean)) {
      roadIceRisk = 'SNOWDRIFT';
      safeSpeedKmh = 45;
      alertNote = 'Внимание: снежный накат, метель и риск перемётов на подъездах к водоёму. Безопасная скорость до 40–50 км/ч.';
    } else if (/(гололедиц|налипани[а-яё]*\s+мокрого\s+снега)/i.test(clean)) {
      roadIceRisk = 'SLIPPERY_60KMH';
      safeSpeedKmh = 65;
      alertNote = 'Внимание: местами гололедица на дорогах. Безопасная скорость движения снижается до 60–70 км/ч.';
    } else if (Number.isFinite(tMax) && Number.isFinite(tMin) && tMax >= -0.5 && tMin <= 0.5 && (precipMm > 0.4 || windMax >= 8)) {
      roadIceRisk = 'SLIPPERY_60KMH';
      safeSpeedKmh = 65;
      alertNote = 'Переход температуры через 0 °C с осадками: на трассе возможна гололедица (рекомендуемая скорость до 60–70 км/ч).';
    }

    const waterWindRisk = windMax >= 15 || /(шквал|ветер\s+(?:1[5-9]|2\d)\s*[-–]?\s*\d*\s*м\/с)/i.test(clean);
    return {
      roadIceRisk,
      safeSpeedKmh,
      waterWindRisk,
      alertNote
    };
  },

  /**
   * 4. SpaceWeatherParser: Извлекает геомагнитную обстановку ИПГ из нижней части Гидрометеобюллетеня /egmb
   */
  parseSpaceWeatherEgmb(text) {
    const clean = String(text || '').toLowerCase();
    if (/(сильн[а-яё]*\s+магнитн[а-яё]*\s+бур|экстремальн[а-яё]*\s+возмущен)/i.test(clean)) {
      return { status: 'severe_storm', kpIndex: 7.5, label: 'Сильная магнитная буря (ИПГ)', bitePenalty: -0.9 };
    }
    if (/(магнитн[а-яё]*\s+бур|умеренно\s+возмущен)/i.test(clean)) {
      return { status: 'storm', kpIndex: 6.0, label: 'Магнитная буря (ИПГ)', bitePenalty: -0.55 };
    }
    if (/(слабо\s+возмущен)/i.test(clean)) {
      return { status: 'minor_storm', kpIndex: 5.0, label: 'Геомагнитное поле слабо возмущённое', bitePenalty: -0.3 };
    }
    if (/(неустойчив[а-яё]*\s+геомагнитн|геомагнитное\s+поле\s+неустойчив)/i.test(clean)) {
      return { status: 'unsettled', kpIndex: 3.5, label: 'Геомагнитное поле неустойчивое', bitePenalty: -0.1 };
    }
    return { status: 'quiet', kpIndex: 2.0, label: 'Геомагнитное поле спокойное', bitePenalty: 0 };
  }
};
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

export function computeWaterTempSeries(dailyMeans, dailyMaxs, dailyMins, waterType = 'small_river', lat = null, dailyWinds = [], dailyClouds = []) {
  if (!Array.isArray(dailyMeans) || dailyMeans.length === 0) return [8.0];
  const prof = WATER_PROFILES[waterType] || WATER_PROFILES.small_river;
  const flow = Number.isFinite(prof.flow) ? prof.flow : 1.0;
  if (waterType === 'cooling_reservoir') {
    return dailyMeans.map(m => Math.max(8.0, Math.min(30.0, Math.round((m * 0.22 + 18.0) * 10) / 10)));
  }
  // Эффективная глубина эпилимниона H_эфф (м) по морфометрии водоёма
  const hEff = waterType === 'tundra_lake'
    ? 1.8
    : (waterType === 'small_river'
        ? 2.8
        : (waterType === 'quarry' ? 5.8 : (waterType === 'big_river' ? 5.2 : 4.2)));
  const flowThermalBonus = flow >= 1.8 ? 0.55 : (flow >= 1.1 ? 0.30 : 0.0);

  const headSlice = dailyMeans.slice(0, Math.min(5, dailyMeans.length));
  const avgHead = headSlice.reduce((a, b) => a + b, 0) / headSlice.length;
  let runningWT;
  if (dailyMeans[0] <= -1.2 || avgHead <= -0.6) {
    runningWT = 0.2;
  } else if (dailyMeans[0] <= 0.5 || avgHead <= 1.0) {
    runningWT = 0.4;
  } else {
    runningWT = Math.max(0.4, Math.min(25.0, avgHead * 0.58 + 1.8 + flowThermalBonus));
  }

  const result = [];
  for (let i = 0; i < dailyMeans.length; i++) {
    const m = dailyMeans[i];
    const windV = Number.isFinite(dailyWinds?.[i]) ? dailyWinds[i] : 3.5;
    const cloudPct = Number.isFinite(dailyClouds?.[i]) ? dailyClouds[i] : 60;
    // Коэффициент турбулентного теплообмена от скорости ветра: K_обм = 15 + 3.5 * V (Вт/(м²·К))
    const kExch = 15.0 + 3.5 * Math.min(18, Math.max(0.5, windV));
    // Время термической релаксации водоёма tau (в сутках): tau ~ (rho*c_p*H_eff) / (K_exch * 86400)
    const tauDays = Math.max(1.8, Math.min(10.5, (48.4 * hEff) / kExch + (flow >= 1.2 ? 0.8 : 0)));
    const alphaStep = 1 - Math.exp(-1 / tauDays);

    if (m <= -0.3) {
      // При переходе к морозам учитываем точку максимальной плотности пресной воды (+4.0 °C — осенняя гомотермия):
      // пока столб выше +4.0 °C, конвективное перемешивание замедляет остывание; ниже +4.0 °C поверхностный слой быстро уходит к 0.2 °C
      if (runningWT > 4.0) {
        const coolStep = Math.max(0.45, Math.abs(m) * 0.24 * (1 + alphaStep * 1.5));
        runningWT = Math.max(3.4, runningWT - coolStep);
      } else {
        runningWT = runningWT <= 0.8 ? 0.2 : Math.max(0.2, runningWT * 0.42 + 0.2 * 0.58);
      }
    } else {
      const solarBonus = Math.max(0, (100 - cloudPct) / 100) * 1.15;
      const tEq = Math.max(0.2, Math.min(25.8, m * 0.58 + 1.45 + flowThermalBonus + solarBonus));
      runningWT = runningWT + (tEq - runningWT) * alphaStep;
    }
    const wt = Math.max(0.2, Math.min(25.5, Math.round(runningWT * 10) / 10));
    result.push(wt);
  }
  return result;
}
/**
 * Ревизия 2.5.6 (r193): Выверенная гидрологическая модель Стефана-Зубова с учётом широты (ЯНАО/Сибирь/Север РФ),
 * сезонного накопления градусо-дней мороза (FDD) с начала ледостава и скорости течения (flow).
 */
export function evaluateDayIce(historyMeanTemps, tDayMax, tNightMin, waterTemp, waterType = 'small_river', dateStr = '', windSpeed = 3, precip = 0, lat = null, hydroAssimilation = null) {
  if (waterType === 'cooling_reservoir') {
    return {
      iceState: 'open_water',
      iceSubState: 'warm_discharge',
      iceThickness: 0,
      lakeIceThickness: 0,
      riverIceThickness: 0,
      iceNote: 'Тёплый сброс ГРЭС/АЭС — круглогодично открытая вода'
    };
  }
  const prof = WATER_PROFILES[waterType] || WATER_PROFILES.small_river;
  const flow = Number.isFinite(prof.flow) ? prof.flow : 1.0;
  const flowLabel = flow >= 1.8 ? 'быстрое течение' : (flow >= 1.1 ? 'умеренное течение' : 'стоячая вода');
  const wind = Number.isFinite(windSpeed) ? windSpeed : 3;
  const effLat = Math.abs(Number.isFinite(lat) ? lat : (store.getState()?.lat ?? 66.08));
  const effLon = Number.isFinite(store.getState()?.lon) ? store.getState().lon : 76.68;
  const dt = dateStr ? new Date(dateStr + 'T12:00:00') : new Date();
  const monthNum = dt.getMonth() + 1;
  const startOfYear = new Date(dt.getFullYear(), 0, 0);
  const dayOfYear = Math.max(1, Math.floor((dt - startOfYear) / 86400000));
  const isSpring = (monthNum >= 4 && monthNum <= 5) || (monthNum === 3 && effLat < 58);
  const recent = Array.isArray(historyMeanTemps) && historyMeanTemps.length > 0
    ? historyMeanTemps
    : [(tDayMax + tNightMin) / 2];
  const tCurMean = (tDayMax + tNightMin) / 2;
  const tailSlice = recent.slice(-Math.min(6, recent.length));
  const avgTailMean = tailSlice.reduce((a, b) => a + b, 0) / tailSlice.length;
  const isWinterSeason = (monthNum >= 10 || monthNum <= 4);

  if (!isWinterSeason && waterTemp > 2.4 && avgTailMean > 1.2 && tCurMean > 0.5) {
    return {
      iceState: 'open_water',
      iceSubState: 'open_water',
      iceThickness: 0,
      lakeIceThickness: 0,
      riverIceThickness: 0,
      iceNote: `Открытая вода (+${waterTemp.toFixed(1)}°C, ${flowLabel})`
    };
  }

  // 1. Ассимиляция данных Гидрометцентра России (meteoinfo.ru/egmb и опорных гидропостов РФ)
  const nearStations = findNearestMeteoinfoStations(effLat, effLon, 1);
  const nearestSt = nearStations[0] || null;
  const officialRange = (hydroAssimilation && Array.isArray(hydroAssimilation.iceRangeCm))
    ? hydroAssimilation.iceRangeCm
    : (nearestSt && nearestSt.distKm <= 320 && (monthNum === 10 || monthNum === 11 || monthNum === 12 || monthNum <= 4) ? nearestSt.hydroIceRangeCm : null);
  const deltaLevelM = Number.isFinite(hydroAssimilation?.deltaLevelM) ? hydroAssimilation.deltaLevelM : 0;

  // Гидрологическая поправка Шуляковского на сильный ветер (>8 м/с) и колебания уровня воды:
  const windFddShift = wind > 8 ? 6 : 0;
  const levelSurgeMultiplier = deltaLevelM > 0.5 ? 0.92 : (deltaLevelM < -0.3 ? 1.05 : 1.0);

  // Теплоизоляция снежного покрова на льду (по формуле Стефана — Быдина):
  // В октябре-ноябре снег на молодом льду тонкий (2-5 см), поэтому коэффициент нарастания высокий (~2.15)
  const estSnowDepthCm = Math.min(40, Math.max(0, (precip > 0 && tCurMean < 0 ? precip * 0.9 : 0) + (monthNum >= 1 && monthNum <= 3 ? 14 : (monthNum === 12 ? 8 : 3))));
  const snowInsulationFactor = 1 / (1 + 0.011 * estSnowDepthCm);

  // 2. Реалистичная дата начала осеннего перехода через 0°C и ледостава по широте:
  // В ЯНАО (>=65° с.ш., Новый Уренгой / Салехард / Надым) озёра и карьеры встают с 12 октября (DOY 285)!
  const freezeStartDoy = effLat >= 65 ? 285 : (effLat >= 61 ? 298 : (effLat >= 57 ? 312 : (effLat >= 53 ? 326 : 342)));
  const firstHistoryDoy = dayOfYear - (recent.length - 1);
  let priorHistoryFDD = 0;
  if (monthNum >= 10 || monthNum <= 4) {
    const priorDays = monthNum >= 10
      ? Math.max(0, firstHistoryDoy - freezeStartDoy)
      : Math.max(0, (365 - freezeStartDoy) + firstHistoryDoy);
    const climoDailyFrost = effLat >= 65 ? 9.8 : (effLat >= 61 ? 7.8 : (effLat >= 57 ? 5.8 : 4.2));
    priorHistoryFDD = Math.min(140, priorDays) * climoDailyFrost;
  }

  // 3. Хронологическое накопление градусо-дней мороза (accumFDD)
  let accumFDD = priorHistoryFDD;
  let windowWarmSum = 0;
  let recentWarmDays = 0;
  for (let i = 0; i < recent.length; i++) {
    const m = recent[i];
    const daysAgo = recent.length - 1 - i;
    if (m <= -0.2) {
      accumFDD += Math.abs(m);
    } else if (m > 0.3) {
      const meltFactor = isSpring ? 2.4 : 1.5;
      accumFDD = Math.max(0, accumFDD - m * meltFactor);
      windowWarmSum += m;
      if (daysAgo <= 3) recentWarmDays++;
    }
  }

  // Вспомогательный расчёт толщины льда для заданного типа водоёма (с ассимиляцией сводки Гидрометцентра)
  const calcThicknessForProfile = (wType, wFlow) => {
    const lagFdd = (wType === 'tundra_lake' || wType === 'pond')
      ? 14
      : (wType === 'quarry' || wType === 'reservoir'
          ? 20
          : (wType === 'small_river' ? 30 : (wType === 'big_river' ? 44 : 36))) + windFddShift;
    const netFdd = Math.max(0, accumFDD - lagFdd);
    const fFactor = wFlow >= 2.0 ? 0.66 : (wFlow >= 1.4 ? 0.74 : (wFlow >= 1.05 ? 0.82 : 1.0));
    const stefanAlpha = 1.92 * snowInsulationFactor * levelSurgeMultiplier;
    let physCm = netFdd > 0 ? Math.round(stefanAlpha * Math.sqrt(netFdd) * fFactor) : 0;

    // Ассимиляция опорного диапазона Гидрометцентра (officialRange = [minRiverCm, maxStandingLakeCm])
    if (Array.isArray(officialRange) && officialRange.length === 2 && officialRange[1] > 0 && (monthNum === 11 || monthNum === 12 || monthNum <= 4)) {
      const [minOff, maxOff] = officialRange;
      // Для стоячих водоёмов (карьеры, озёра) ориентир — верхняя часть сводки (~31-32 см в ЯНАО в середине ноября),
      // для малых рек с умеренным течением — ~21-23 см, для крупных рек — нижняя граница (~19-20 см)
      const targetOff = wFlow <= 0.45
        ? Math.round(minOff * 0.12 + maxOff * 0.88)
        : (wFlow <= 1.4 ? Math.round(minOff * 0.82 + maxOff * 0.18) : minOff);
      // Плавный сдвиг по дням внутри прогноза (относительно сегодняшнего дня)
      const todayDoy = Math.max(1, Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 86400000));
      const dayDelta = Math.max(-5, Math.min(10, dayOfYear - todayDoy));
      const dailyGrowthCm = tCurMean < -1 ? Math.max(0.4, Math.min(1.4, Math.abs(tCurMean) * 0.07)) : 0;
      const assimilatedTarget = Math.max(0, Math.round(targetOff + dayDelta * dailyGrowthCm));
      physCm = physCm > 0 ? Math.round(physCm * 0.25 + assimilatedTarget * 0.75) : assimilatedTarget;
    }
    return Math.max(0, Math.min(145, physCm));
  };

  const effectiveIceCm = calcThicknessForProfile(waterType, flow);
  const lakeIceCm = calcThicknessForProfile('tundra_lake', 0.2);
  const riverIceCm = calcThicknessForProfile('small_river', 1.3);

  const minSafeCm = flow >= 1.8 ? 10 : (flow >= 1.1 ? 8 : 7);
  if ((isSpring || recentWarmDays >= 3) && (tDayMax >= 4.0 && tCurMean >= 2.0 && windowWarmSum >= 6) && effectiveIceCm >= 3) {
    const remThick = Math.max(3, Math.min(30, Math.round(effectiveIceCm * 0.65)));
    return {
      iceState: 'ice_danger',
      iceSubState: 'spring_rotten_ice',
      iceThickness: remThick,
      lakeIceThickness: Math.round(lakeIceCm * 0.7),
      riverIceThickness: remThick,
      iceNote: `Рыхлый лёд: промоины и закраины (+${tDayMax}°C)`
    };
  }
  if (effectiveIceCm >= minSafeCm && tCurMean <= 2.0) {
    return {
      iceState: 'ice_safe',
      iceSubState: 'solid_freeze',
      iceThickness: effectiveIceCm,
      lakeIceThickness: Math.max(effectiveIceCm, lakeIceCm),
      riverIceThickness: Math.min(effectiveIceCm, riverIceCm) || effectiveIceCm,
      iceNote: `Река (течение): ~${riverIceCm} см • Озёра и карьеры: ~${lakeIceCm} см`
    };
  }
  if (effectiveIceCm >= 2 && effectiveIceCm < minSafeCm && (tCurMean <= 0.5 || tNightMin <= -1.5)) {
    return {
      iceState: 'ice_danger',
      iceSubState: 'thin_first_ice',
      iceThickness: effectiveIceCm,
      lakeIceThickness: lakeIceCm,
      riverIceThickness: riverIceCm,
      iceNote: `Тонкий перволёдок (~${effectiveIceCm} см, озёра ~${lakeIceCm} см)`
    };
  }
  if ((accumFDD >= 6 || tNightMin <= -0.5) && (waterTemp <= 2.2 || tCurMean <= 0.5)) {
    return {
      iceState: 'ice_slush',
      iceSubState: 'slush_shore_ice',
      iceThickness: Math.max(1, effectiveIceCm),
      lakeIceThickness: lakeIceCm,
      riverIceThickness: riverIceCm,
      iceNote: `Забереги и шуга (вода +${waterTemp.toFixed(1)}°C)`
    };
  }
  return {
    iceState: 'open_water',
    iceSubState: 'open_water',
    iceThickness: 0,
    lakeIceThickness: 0,
    riverIceThickness: 0,
    iceNote: `Открытая вода (+${waterTemp.toFixed(1)}°C, ${flowLabel})`
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
    const ice = evaluateDayIce(histSlice, tMax, tMin, waterTemp, waterType, dStr, wMax, 0, lat);
    const effWt = ice.iceState === 'ice_safe' ? Math.min(waterTemp, 0.3) : (ice.iceState === 'ice_danger' ? Math.min(waterTemp, 0.4) : waterTemp);
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
      waterTemp: effWt,
      iceState: ice.iceState,
      iceSubState: ice.iceSubState,
      iceThickness: ice.iceThickness,
      lakeIceThickness: ice.lakeIceThickness,
      riverIceThickness: ice.riverIceThickness,
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
 * Ревизия 2.0.15: Нормализация ответа Open-Meteo (past_days=14, forecast_days=10)
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
    const rawWaterTemp = wtSeries[i];
    const wMaxVal = Math.round(data.daily.wind_speed_10m_max?.[i] || 3);
    const dayPrecipSum = hours.reduce((acc, h) => acc + (Number(h.precip) || 0), 0);
    const ice = evaluateDayIce(dailyMeans.slice(0, i + 1), tMax, tMin, rawWaterTemp, waterType, dStr, wMaxVal, dayPrecipSum, data.latitude, data._hydroAssimilation);
    const waterTemp = ice.iceState === 'ice_safe' ? Math.min(rawWaterTemp, 0.3) : (ice.iceState === 'ice_danger' ? Math.min(rawWaterTemp, 0.4) : rawWaterTemp);
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
      lakeIceThickness: ice.lakeIceThickness,
      riverIceThickness: ice.riverIceThickness,
      iceNote: ice.iceNote,
      moon: computeMoon(dStr),
      hours
    });
  }
  const startIdx = Math.max(0, Math.min(totalDays - 12, todayIdx - 2));
  const days = allNormalizedDays.slice(startIdx, startIdx + 12).map((d, idx) => ({
    ...d,
    relOffset: idx - 2,
    isArchive: idx < 2,
    relTitle: getRelativeDayTitle(idx - 2)
  }));
  const archive5Days = allNormalizedDays.filter(d => d.date < todayStr).slice(-5);
  const todayObj = days[2] || days[0];
  const roadHazard = data._roadHazard || MeteoInfoRuParsers.parseRoadAndStormAlerts(
    data._stormText || '',
    todayObj?.tDay,
    todayObj?.tNight,
    todayObj?.windMax || 3,
    (todayObj?.hours || []).reduce((s, h) => s + (h.precip || 0), 0)
  );
  const spaceWeather = data._spaceWeather || MeteoInfoRuParsers.parseSpaceWeatherEgmb(data._egmbText || '');
  if (typeof window !== 'undefined' && data && (data._sourceMeteoinfo || data._hydroAssimilation || data._spaceWeather || data._roadHazard)) {
    window.__KLEV_METEOINFO_LATEST__ = {
      source: data._sourceMeteoinfo || 'meteoinfo.ru',
      hydro: data._hydroAssimilation || null,
      spaceWeather: data._spaceWeather || null,
      roadHazard: data._roadHazard || null,
      station: data._meteoInfoStation || null,
      ts: Date.now()
    };
  }
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
    iceNote: todayObj?.iceNote || '',
    roadHazard,
    spaceWeather,
    meteoStationsIdw: data._meteoStationsIdw || findNearestMeteoinfoStations(data.latitude || 66.08, data.longitude || 76.68, 3)
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
  let anchorHours = null;
  for (let rel = 0; rel <= 3; rel++) {
    const dStr = formatLocalYYYYMMDD(new Date(todayDt.getTime() + rel * 86400000));
    if (byDate[dStr] && Object.keys(byDate[dStr]).length > 0) {
      anchorHours = byDate[dStr];
      break;
    }
  }
  const fullSeries = [];
  for (let rel = -5; rel <= 9; rel++) {
    const cur = new Date(todayDt.getTime() + rel * 86400000);
    const dStr = formatLocalYYYYMMDD(cur);
    let mapH = byDate[dStr];
    const hasReal = Boolean(isRealDateMap[dStr] && mapH && Object.keys(mapH).length > 0);
    if (!mapH || Object.keys(mapH).length === 0) {
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
  const seriesMaxs = fullSeries.map(d => d.tDay);
  const seriesMins = fullSeries.map(d => d.tNight);
  const seriesMeans = fullSeries.map(d => (d.tDay + d.tNight) / 2);
  const wtSeries = computeWaterTempSeries(seriesMeans, seriesMaxs, seriesMins, waterType);
  fullSeries.forEach((d, idx) => {
    const rawWt = wtSeries[idx];
    const ice = evaluateDayIce(seriesMeans.slice(0, idx + 1), d.tDay, d.tNight, rawWt, waterType, d.date, d.windMax || 3, 0, lat);
    d.waterTemp = ice.iceState === 'ice_safe' ? Math.min(rawWt, 0.3) : (ice.iceState === 'ice_danger' ? Math.min(rawWt, 0.4) : rawWt);
    d.iceState = ice.iceState;
    d.iceSubState = ice.iceSubState;
    d.iceThickness = ice.iceThickness;
    d.iceNote = ice.iceNote;
  });
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
  const s = store.getState();
  const firstDayDate = days[0]?.date || '';
  const prefixArchive = Array.isArray(archive5Days)
    ? archive5Days.filter(a => a && a.date && a.date < firstDayDate)
    : [];
  const combined = [...prefixArchive, ...days];
  const maxs = combined.map(d => d.tDay);
  const mins = combined.map(d => d.tNight);
  const means = combined.map(d => (d.tDay + d.tNight) / 2);
  const wtSeries = computeWaterTempSeries(means, maxs, mins, waterType);
  const hydroAssim = (typeof window !== 'undefined' && window.__KLEV_METEOINFO_LATEST__?.hydro) ? window.__KLEV_METEOINFO_LATEST__.hydro : null;
  const updatedCombined = combined.map((d, idx) => {
    const rawWt = wtSeries[idx];
    const hist = means.slice(0, idx + 1);
    const dayPrecip = Array.isArray(d.hours) ? d.hours.reduce((acc, h) => acc + (Number(h.precip) || 0), 0) : 0;
    const ice = evaluateDayIce(hist, d.tDay, d.tNight, rawWt, waterType, d.date, d.windMax || 3, dayPrecip, s?.lat, hydroAssim);
    const finalWt = ice.iceState === 'ice_safe' ? Math.min(rawWt, 0.3) : (ice.iceState === 'ice_danger' ? Math.min(rawWt, 0.4) : rawWt);
    return {
      ...d,
      waterTemp: finalWt,
      iceState: ice.iceState,
      iceSubState: ice.iceSubState,
      iceThickness: ice.iceThickness,
      lakeIceThickness: ice.lakeIceThickness,
      riverIceThickness: ice.riverIceThickness,
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
    `https://allorigins.hexlet.app/raw?disableCache=true&url=${encodeURIComponent(histForecastUrl)}`,
    `https://corsproxy-seven.vercel.app/api?url=${encodeURIComponent(histForecastUrl)}`
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
  if (cached && cached.days && cached.days.length === 12) {
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
    if (!forceNetwork && !cached.isExpired) return;
  }
  const gLat = snapCoord10km(lat);
  const gLon = snapCoord10km(lon);
  const gridDedupKey = `${gLat}_${gLon}_${st.water || 'small_river'}`;
  if (inFlightWeatherRequests.has(gridDedupKey) && !forceNetwork) {
    return inFlightWeatherRequests.get(gridDedupKey);
  }
  const omUrl = `https://api.open-meteo.com/v1/forecast?latitude=${gLat}&longitude=${gLon}&past_days=14&hourly=temperature_2m,surface_pressure,wind_speed_10m,wind_direction_10m,cloud_cover,precipitation&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,wind_speed_10m_max,wind_direction_10m_dominant&forecast_days=10&wind_speed_unit=ms&timezone=auto`;
  const workerEdgeWeatherUrl = `${WORKER_WEATHER_EDGE_URL}?lat=${gLat}&lon=${gLon}`;
  const metUrl = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${gLat}&lon=${gLon}`;
  const isAndroidApkEnv = typeof window !== 'undefined' && Boolean(window.AndroidBridge);
  const apkProxyWrap = (targetUrl) => `https://appassets.androidplatform.net/__klev_net_proxy__?url=${encodeURIComponent(targetUrl)}`;
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
          const d = await fetchWithTimeout(isAndroidApkEnv ? apkProxyWrap(metUrl) : metUrl, 7000).catch(() => fetchWithTimeout(metUrl, 6000));
          if (!d || !d.properties?.timeseries) return null;
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
          const proxy1 = `https://allorigins.hexlet.app/raw?disableCache=true&url=${encodeURIComponent(omUrl)}`;
          const d = await fetchWithTimeout(proxy1, 7000);
          return d && d.hourly && d.daily ? normalizeOpenMeteo(d, st.water) : null;
        }
      },
      {
        name: RU.online,
        run: async () => {
          const proxy2 = `https://corsproxy-seven.vercel.app/api?url=${encodeURIComponent(omUrl)}`;
          const d = await fetchWithTimeout(proxy2, 7500);
          return d && d.hourly && d.daily ? normalizeOpenMeteo(d, st.water) : null;
        }
      }
    ]);
    const updatedCluster = storage.saveWeatherCache(lat, lon, res.data, res.data.extraArchiveDays || res.data.archive5Days || []);
    const mergedArchiveInfo = storage.getArchiveDaysForLocation(lat, lon, 5);
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
function isWeatherBetaUser(s = null) {
  try {
    const st = s || store.getState();
    const fid = String(st?.userProfile?.fisherId || '').trim().toUpperCase();
    if (fid === 'FP_89VIP089' || fid === 'FP_FMP089' || st?.userProfile?.ownerUnlocked || st?.userProfile?.isBetaTester) return true;
    if (typeof window !== 'undefined' && window.__KLEV_ADMIN_CONTOUR__ === true) return true;
    if (typeof localStorage !== 'undefined' && localStorage.getItem('klev_pro_beta_tester_granted_v1') === '1') return true;
  } catch (e) {}
  return false;
}
export function subscribeWeather(cb) {
  return store.subscribe(
    s => ({
      route: s.route,
      lat: s.lat,
      lon: s.lon,
      locLabel: s.locLabel,
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
// Проверка актуальности прогноза волны: ТОЛЬКО для морских/приморских регионов, крупных водохранилищ и больших рек при открытой воде!
export function isWaveForecastRelevantForContext(s, day) {
  if (!s || !day) return false;
  // Если стоит монолитный безопасный лёд — открытой волны нет, блок скрываем
  if (day.iceState === 'ice_safe') return false;
  const wType = String(s.water || '');
  const wName = String(s.selectedWaterName || s.locLabel || '');
  const isLargeWaterOrSea = Boolean(s.isCoastal) ||
    ['sea_gulf', 'open_sea', 'reservoir', 'big_river'].includes(wType) ||
    /(море|залив|губа|лиман|пролив|бухта|вдхр|водохранилище|обь|иртыш|енисей|волга|кама|лена|амур|дон|печора|пур|таз|надым|ладож|онеж|байкал|рыбинск|куйбышев|камск|цимлянск|новосибирск|братск|красноярск|белоярск|шершнев|аргазин|увильды|чаны|ильмень|чудск|селигер)/i.test(wName);
  return isLargeWaterOrSea;
}

// Расчёт почасовой высоты и направления волны (модель Свердрупа — Мунка — Бретшнейдера по разгону волны fetch)
export function computeHourlyWaveSeries(day, waterType = 'big_river', isCoastal = false, waterName = '') {
  const hrs = Array.isArray(day?.hours) ? day.hours : [];
  const wName = String(waterName || '');
  let fetchCoeff = 0.036; // большая река (разгон 4-6 км)
  if (waterType === 'open_sea' || /(чёрное|баренцево|белое|балтийское|охотское|японское|каспийское|азовское)\s*море/i.test(wName)) {
    fetchCoeff = 0.092;
  } else if (waterType === 'sea_gulf' || isCoastal || /(губа|залив|лиман|ладож|онеж|байкал|рыбинск|куйбышев)/i.test(wName)) {
    fetchCoeff = 0.068;
  } else if (waterType === 'reservoir' || /(вдхр|водохранилище)/i.test(wName)) {
    fetchCoeff = 0.050;
  }
  return hrs.map(h => {
    const u = Math.max(0, Number(h.wind ?? day.windMax ?? 3));
    const rawH = u <= 1.2 ? 0.05 : fetchCoeff * Math.pow(u, 1.14);
    const waveHeightM = Math.round(Math.min(4.5, rawH) * 10) / 10;
    return {
      hour: h.hour,
      waveM: waveHeightM,
      windMs: u,
      dir: h.windDir || day.windDir || 'З'
    };
  });
}

// Комплексная оценка дорожных и погодных опасностей (гололедица, шторм/метель, экстремальный мороз/жара, высокая волна, тонкий лёд)
export function evaluateRoadAndWeatherHazards(day, s = null) {
  const st = s || store.getState();
  if (!day) return { items: [], hasDanger: false, hasWarning: false, summaryText: 'Спокойная обстановка' };
  const tMax = Number(day.tDay ?? 0);
  const tMin = Number(day.tNight ?? 0);
  const wind = Number(day.windMax ?? 3);
  const precip = Number(day.precip ?? (Array.isArray(day.hours) ? day.hours.reduce((acc, h) => acc + (Number(h.precip) || 0), 0) : 0));
  const dP = Math.abs(Number(day.dP ?? 0));
  const waveRelevant = isWaveForecastRelevantForContext(st, day);
  const waveSeries = waveRelevant ? computeHourlyWaveSeries(day, st.water, st.isCoastal, st.selectedWaterName) : [];
  const maxWaveM = waveSeries.length ? Math.max(...waveSeries.map(w => w.waveM)) : 0;

  const items = [];

  // 1. Гололедица / гололёд / снежный накат
  if (tMax >= -3 && tMin <= 1 && (precip >= 0.2 || wind >= 6)) {
    items.push({
      id: 'glaze',
      tone: 'warn',
      modes: ['car', 'bike', 'walk', 'snowmobile'],
      title: 'Гололедица на дорогах',
      shortRouteAlert: 'Гололедица (переход через 0°C)',
      detail: `Температура ${tMax > 0 ? '+' + tMax : tMax}..${tMin}°C с осадками: скользкое покрытие, держите дистанцию (до 60 км/ч)`
    });
  } else if (tMax < -3 && precip >= 2.0 && wind >= 8) {
    items.push({
      id: 'snowdrift',
      tone: 'warn',
      modes: ['car', 'snowmobile', 'bike', 'walk'],
      title: 'Снежный накат и перемёты',
      shortRouteAlert: 'Снежные перемёты и метель',
      detail: `Осадки ${precip.toFixed(1)} мм при ветре ${wind} м/с: ухудшение видимости на зимниках и трассах`
    });
  }

  // 2. Штормовое предупреждение / сильный ветер / буря
  if (wind >= 15) {
    items.push({
      id: 'storm_wind',
      tone: 'bad',
      modes: ['car', 'snowmobile', 'bike', 'walk', 'boat'],
      title: `Штормовое предупреждение (${day.windDir || ''} ${wind} м/с)`,
      shortRouteAlert: `Шторм ${day.windDir || ''} ${wind} м/с`,
      detail: `Штормовой ветер ${wind} м/с${tMax < 0 ? ', сильная метель' : ''}. Выход на воду и дальние выезды опасны`
    });
  } else if (wind >= 10) {
    items.push({
      id: 'strong_wind',
      tone: 'warn',
      modes: ['snowmobile', 'bike', 'walk', 'boat'],
      title: `Сильный ветер ${day.windDir || ''} ${wind} м/с`,
      shortRouteAlert: `Сильный ветер ${day.windDir || ''} ${wind} м/с`,
      detail: tMax < 0 ? `Позёмка и ветровой холод (ощущается как ${Math.round(tMin - wind * 0.7)}°C)` : `Порывистый ветер до ${wind} м/с`
    });
  }

  // 3. Экстремально низкая или экстремально высокая температура
  if (tMin <= -28 || tMax <= -24) {
    items.push({
      id: 'extreme_cold',
      tone: tMin <= -35 ? 'bad' : 'warn',
      modes: ['car', 'snowmobile', 'bike', 'walk', 'boat'],
      title: `Экстремальный мороз (до ${tMin}°C)`,
      shortRouteAlert: `Экстремальный мороз ${tMin}°C`,
      detail: `Риск обморожения и просадки АКБ. Обязателен запас топлива, тёплая экипировка и заряженный телефон`
    });
  } else if (tMax >= 32) {
    items.push({
      id: 'extreme_heat',
      tone: 'warn',
      modes: ['car', 'bike', 'walk', 'boat'],
      title: `Экстремальная жара (+${tMax}°C)`,
      shortRouteAlert: `Жара +${tMax}°C`,
      detail: `Высокая тепловая нагрузка в дневные часы (11:00–17:00), необходим запас питьевой воды`
    });
  }

  // 4. Высокая волна (только там, где актуально)
  if (waveRelevant && maxWaveM >= 0.5) {
    items.push({
      id: 'high_wave',
      tone: maxWaveM >= 0.9 ? 'bad' : 'warn',
      modes: ['boat'],
      title: `Волна до ${maxWaveM.toFixed(1)} м (${day.windDir || 'З'})`,
      shortRouteAlert: `Волна ${maxWaveM.toFixed(1)} м (${day.windDir || 'З'})`,
      detail: maxWaveM >= 0.9
        ? `Опасное волнение до ${maxWaveM.toFixed(1)} м: выход на маломерных и ПВХ-лодках запрещён`
        : `Умеренная волна до ${maxWaveM.toFixed(1)} м: держитесь подветренного берега`
    });
  }

  // 5. Ледовая опасность для снегохода / пешего хода
  if (day.iceState === 'ice_danger') {
    items.push({
      id: 'thin_ice',
      tone: 'bad',
      modes: ['snowmobile', 'walk'],
      title: `Опасный лёд (~${day.iceThickness || 4} см)`,
      shortRouteAlert: `Опасный тонкий лёд (~${day.iceThickness || 4} см)`,
      detail: `Выход и выезд техники на лёд опасен`
    });
  }

  const hasDanger = items.some(x => x.tone === 'bad');
  const hasWarning = items.length > 0;
  return {
    items,
    hasDanger,
    hasWarning,
    waveRelevant,
    waveSeries,
    maxWaveM,
    summaryText: items.length > 0 ? items.map(x => x.shortRouteAlert).join(' • ') : 'Дорожная и метеообстановка спокойная'
  };
}

if (typeof window !== 'undefined') {
  window.__KLEV_GET_ROUTE_WEATHER_HAZARDS__ = (transportMode = 'car') => {
    try {
      const s = store.getState();
      let days = s.weatherDays;
      if (!Array.isArray(days) || days.length === 0) {
        days = buildFallback(s.lat ?? 66.0833, s.lon ?? 76.6333, s.water || 'small_river', Boolean(s.isCoastal), s.elevationM ?? 46, s.selectedWaterName || '');
      }
      const day = days[s.dayIdx ?? 2] || days[2] || days[0];
      const ev = evaluateRoadAndWeatherHazards(day, s);
      const filtered = ev.items.filter(it => !transportMode || it.modes.includes(transportMode));
      // Проверяем выезд на снегоходе при толщине льда на реке < 22 см
      if (transportMode === 'snowmobile' && day && (day.iceState === 'ice_safe' || day.iceState === 'ice_danger')) {
        const rivCm = Number(day.riverIceThickness || day.iceThickness || 0);
        if (rivCm > 0 && rivCm < 22 && !filtered.some(x => x.id === 'thin_ice')) {
          filtered.push({
            id: 'snowmobile_river_ice',
            tone: 'warn',
            shortRouteAlert: `Лёд на реке ~${rivCm} см (для снегохода нужно >=22 см, держитесь суши/озёр)`
          });
        }
      }
      // Проверяем построение маршрута на лодке в период ледостава
      if (transportMode === 'boat' && day && (day.iceState === 'ice_safe' || day.iceState === 'ice_danger')) {
        filtered.push({
          id: 'boat_ice_closed',
          tone: 'bad',
          shortRouteAlert: `Ледостав (~${day.iceThickness || 20} см): навигация для лодок закрыта`
        });
      }
      const hasDanger = filtered.some(x => x.tone === 'bad');
      return {
        hasHazards: filtered.length > 0,
        severity: hasDanger ? 'bad' : (filtered.length > 0 ? 'warn' : 'good'),
        activeForMode: filtered,
        items: filtered,
        summaryText: filtered.map(x => x.shortRouteAlert).join(' • ')
      };
    } catch (_e) {
      return { hasHazards: false, severity: 'good', activeForMode: [], items: [], summaryText: '' };
    }
  };
}

export function render(container) {
  if (!container) return;
  if (typeof window !== 'undefined' && typeof window.__KLEV_IS_MOBILE_GUEST__ === 'function' && window.__KLEV_IS_MOBILE_GUEST__()) {
    if (store.getState().dayIdx !== 2) {
      store.dispatch({ type: 'SET_DAY', payload: 2 });
    }
  }
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
  const openWaterComfort = Math.max(15, Math.min(98, Math.round(92 - Math.max(0, (day.windMax || 3) - 3) * 8 - Math.abs(day.dP || 0) * 3)));
  const gaugeScore = (isIceSeason || isSlushSeason) ? safety.index : openWaterComfort;
  const gaugeArcLen = Math.round((Math.max(6, Math.min(100, gaugeScore)) / 100) * 188.5);
  const gaugeSubTitle = (isIceSeason || isSlushSeason) ? 'Индекс льда:' : 'Комфорт воды:';
  const gaugeLvlWord = (isIceSeason || isSlushSeason)
    ? (safety.footSafe ? 'Пешком можно' : 'Только берег')
    : ((day.windMax || 3) <= 5 ? 'Лодка и берег' : 'Волна у берега');
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
      <!-- КАРТОЧКА 1 (Bento Hero): Компактный сезонный режим водоёма (радар справа вверху, инфо-блок на всю ширину внизу) -->
      <div class="bento-card bento-hero-card" style="padding:10px 12px;">
        <div class="bento-card-head" style="margin-bottom:6px;gap:6px;align-items:flex-start;">
          <div style="min-width:0;flex:1;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
              <div class="bento-card-title" style="font-size:15px;">
                <span>${heroTitle}</span>
              </div>
              ${isWeatherBetaUser(s) ? `
              <div style="display:inline-flex;align-items:center;gap:5px;flex-wrap:wrap;">
                <button type="button" class="btn btn-sm" id="weatherHeroRefreshBtn" style="min-height:26px;padding:2px 8px;font-size:11px;font-weight:800;" title="Обновить погоду (Бета-тест)">
                  <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M20 11a8 8 0 0 0-14.5-4.5L4 8m0-5v5h5M4 13a8 8 0 0 0 14.5 4.5L20 16m0 5v-5h-5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  <span>Обновить погоду [БЕТА]</span>
                </button>
              </div>
              ` : ''}
            </div>
            <div class="bento-card-sub" style="font-size:11px;margin-top:2px;line-height:1.25;">
              <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z" fill="rgba(239,68,68,0.22)" stroke="#ef4444" stroke-width="1.9"/><circle cx="12" cy="11" r="2.3" fill="#ef4444"/></svg> ${s.locLabel} (${waterTitle} • ${flowLabel}) • ${day.relTitle ? day.relTitle + ' (' + day.label + ')' : day.label}
            </div>
          </div>
        </div>
        <!-- Верхний ряд: слева статус льда/воды, справа вверху — радар индекса льда и температура воды -->
        <div style="display:grid;grid-template-columns:1.12fr 0.88fr;gap:8px;align-items:center;margin-bottom:6px;">
          <div style="min-width:0;">
            <div class="bento-status-verdict" style="color:${heroTone};font-size:15px;line-height:1.18;margin-bottom:3px;">
              ${heroVerdictShort}
            </div>
            <div style="font-size:11.5px;font-weight:800;color:var(--text);line-height:1.3;">
              ${day.iceNote || (day.iceState === 'open_water' ? `Открытая вода (~${day.waterTemp}°C), льда нет (${flowLabel})` : safety.vehicleVerdict)}
            </div>
          </div>
          <div class="bento-gauge-col" style="padding:0;justify-content:flex-start;align-items:center;">
            <div class="bento-gauge-svg-box" style="width:138px;height:74px;margin:0 auto;">
              <svg viewBox="0 0 156 90" width="138" height="74" fill="none" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="weatherGaugeGrad" x1="0%" y1="100%" x2="100%" y2="0%">
                    <stop offset="0%" stop-color="var(--gauge-start, #3b82f6)"/>
                    <stop offset="100%" stop-color="var(--gauge-end, #10b981)"/>
                  </linearGradient>
                </defs>
                <path d="M 18 78 A 60 60 0 0 1 138 78" stroke="var(--gauge-track, #dbe7f3)" stroke-width="12" stroke-linecap="round" fill="none"/>
                <path d="M 18 78 A 60 60 0 0 1 138 78" stroke="url(#weatherGaugeGrad)" stroke-width="12" stroke-linecap="round" fill="none" stroke-dasharray="${gaugeArcLen} 200"/>
              </svg>
              <div class="bento-gauge-center-text" style="bottom:0;">
                <span class="bento-gauge-sub" style="font-size:9.5px;">${gaugeSubTitle}</span>
                <span class="bento-gauge-lvl" style="font-size:11px;">${gaugeLvlWord}</span>
                <span class="bento-gauge-pct" style="font-size:20px;">${gaugeScore}%</span>
              </div>
            </div>
            <div class="bento-tackle-summary" style="margin-top:2px;font-size:10.5px;line-height:1.2;text-align:center;">
              <span style="color:var(--muted);">Вода с учётом течения:</span>
              <b style="font-size:12.5px;color:var(--accent);margin-left:3px;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3c0 0-6 7.1-6 11.5a6 6 0 0 0 12 0C18 10.1 12 3 12 3z" fill="rgba(56,189,248,0.32)" stroke="#38bdf8" stroke-width="1.8"/><path d="M9.5 15.5c.5 1.2 1.7 2 3 2" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg> ${wTempStr}</b>
            </div>
          </div>
        </div>
        <!-- Нижний ряд на ВСЮ ШИРИНУ карточки (без дублирующего 4-строчного абзаца) -->
        <div style="width:100%;padding:7px 10px;border-radius:10px;background:var(--panel);border:1px solid var(--border);font-size:11.5px;line-height:1.3;">
          <div style="font-weight:800;color:var(--text);">${safety.vehicleVerdict}</div>
        </div>
      </div>
      ${(() => {
        const haz = evaluateRoadAndWeatherHazards(day, s);
        const statusTone = haz.hasDanger ? 'var(--bad)' : (haz.hasWarning ? 'var(--warn)' : 'var(--good)');
        const roadColdNote = day.tNight <= -28 ? `Мороз до ${day.tNight}°C` : (day.tDay >= -2 && day.tNight <= 1 ? 'Риск гололедицы (0°C)' : 'Покрытие по сезону');
        const windStormNote = (day.windMax || 3) >= 12 ? `Штормовой ${day.windDir} ${day.windMax} м/с` : `${day.windDir || 'З'} ${day.windMax || 3} м/с (без шторма)`;
        return `
          <!-- Дорожная и штормовая сводка (гололедица, метель, шторм, экстремальные температуры) -->
          <div class="bento-card" id="weatherRoadStormCard" style="padding:10px 12px;border-color:${haz.hasWarning ? statusTone : 'var(--border)'};">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">
              <div class="bento-card-title" style="font-size:14px;">
                <svg class="k-ico" style="color:${statusTone};" viewBox="0 0 24 24" fill="none"><path d="M12 3L2.5 19.5h19L12 3z" fill="rgba(245,158,11,0.18)" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><path d="M12 9v5M12 17h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                <span>Дорожная и штормовая обстановка</span>
              </div>
              <span class="pill ${haz.hasDanger ? 'pill-bad' : (haz.hasWarning ? 'pill-warn' : 'pill-good')}" style="font-size:10.5px;">
                ${haz.hasDanger ? 'Шторм / Опасно' : (haz.hasWarning ? 'Внимание в пути' : 'Без угроз')}
              </span>
            </div>
            <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;">
              <div style="padding:7px 9px;border-radius:10px;background:var(--panel);border:1px solid var(--border);">
                <div style="font-size:10.5px;color:var(--muted);font-weight:800;">Трасса и зимники</div>
                <div style="font-size:12.5px;font-weight:900;color:var(--text);margin-top:2px;">${roadColdNote}</div>
              </div>
              <div style="padding:7px 9px;border-radius:10px;background:var(--panel);border:1px solid var(--border);">
                <div style="font-size:10.5px;color:var(--muted);font-weight:800;">Ветер и метель</div>
                <div style="font-size:12.5px;font-weight:900;color:var(--text);margin-top:2px;">${windStormNote}</div>
              </div>
            </div>
            ${haz.items.length > 0 ? `
              <div style="display:flex;flex-direction:column;gap:5px;margin-top:7px;">
                ${haz.items.map(it => `
                  <div style="padding:6px 9px;border-radius:9px;background:${it.tone === 'bad' ? 'rgba(239,68,68,0.14)' : 'rgba(245,158,11,0.14)'};border:1px solid ${it.tone === 'bad' ? 'var(--bad)' : 'var(--warn)'};font-size:11.5px;font-weight:800;color:var(--text);">
                    <span style="color:${it.tone === 'bad' ? 'var(--bad)' : 'var(--warn)'};">${it.title}:</span> ${it.detail}
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>
          ${haz.waveRelevant ? `
            <!-- Почасовая высота и направление волны (выводится ТОЛЬКО для морских/приморских зон, водохранилищ и крупных рек при открытой воде) -->
            <div class="bento-card" id="weatherHourlyWaveCard" style="padding:10px 12px;">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">
                <div class="bento-card-title" style="font-size:14px;">
                  <svg class="k-ico" style="color:#38bdf8;" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                  <span>Волна по часам (высота и направление)</span>
                </div>
                <span class="pill ${haz.maxWaveM >= 0.8 ? 'pill-bad' : (haz.maxWaveM >= 0.45 ? 'pill-warn' : 'pill-good')}" style="font-size:10.5px;">
                  Макс. ${haz.maxWaveM.toFixed(1)} м
                </span>
              </div>
              <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;">
                ${[0, 3, 6, 9, 12, 15, 18, 21].map(hIdx => {
                  const wSlot = haz.waveSeries[hIdx] || haz.waveSeries[0] || { hour: hIdx, waveM: 0.2, dir: day.windDir || 'З', windMs: 3 };
                  const wCol = wSlot.waveM >= 0.8 ? 'var(--bad)' : (wSlot.waveM >= 0.45 ? 'var(--warn)' : 'var(--good)');
                  return `
                    <div style="padding:6px 4px;border-radius:10px;background:var(--panel);border:1px solid var(--border);display:flex;flex-direction:column;align-items:center;gap:2px;">
                      <span style="font-size:10px;font-weight:800;color:var(--muted);">${String(hIdx).padStart(2, '0')}:00</span>
                      <span style="font-size:14px;font-weight:900;color:${wCol};">${wSlot.waveM.toFixed(1)} м</span>
                      <span style="font-size:10.5px;font-weight:800;color:var(--accent);">${wSlot.dir} • ${Math.round(wSlot.windMs)} м/с</span>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          ` : ''}
        `;
      })()}
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
                <div style="font-size:10.5px;color:var(--muted);font-weight:700;">${isWaveForecastRelevantForContext(s, day) ? "Ветер и волна" : "Направление и скорость"}</div>
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
          <div class="bento-chart-stage" style="position:relative;width:100%;height:106px;">
            <svg viewBox="0 0 ${svgW} ${svgH}" width="100%" height="100%" preserveAspectRatio="none" style="display:block;width:100%;height:100%;">
              <defs>
                <linearGradient id="weatherWaveFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="var(--wave-fill-top, rgba(59,130,246,0.35))"/>
                  <stop offset="100%" stop-color="var(--wave-fill-bot, rgba(59,130,246,0.02))"/>
                </linearGradient>
              </defs>
              <line x1="${padL}" y1="${padT + plotH * 0.5}" x2="${svgW - padR}" y2="${padT + plotH * 0.5}" stroke="var(--border)" stroke-dasharray="3 3" stroke-width="1" vector-effect="non-scaling-stroke" opacity="0.6"/>
              <path d="${waveAreaD}" fill="url(#weatherWaveFill)"/>
              <path d="${wavePathD}" fill="none" stroke="var(--wave-stroke, #38bdf8)" stroke-width="2.6" vector-effect="non-scaling-stroke" stroke-linecap="round"/>
            </svg>
            <div class="bento-chart-dot" style="left:${((coldPt.x / svgW) * 100).toFixed(1)}%;top:${((coldPt.y / svgH) * 100).toFixed(1)}%;background:#38bdf8;"></div>
            <div class="bento-chart-badge" style="left:${Math.max(13, Math.min(87, (coldPt.x / svgW) * 100)).toFixed(1)}%;top:${Math.max(20, ((coldPt.y / svgH) * 100) - 6).toFixed(1)}%;border-color:rgba(56,189,248,0.55);">
              06:00 (${coldPt.t > 0 ? '+' + coldPt.t : coldPt.t}°C)
            </div>
            <div class="bento-chart-dot" style="left:${((warmPt.x / svgW) * 100).toFixed(1)}%;top:${((warmPt.y / svgH) * 100).toFixed(1)}%;background:#10b981;"></div>
            <div class="bento-chart-badge" style="left:${Math.max(13, Math.min(87, (warmPt.x / svgW) * 100)).toFixed(1)}%;top:${Math.max(20, ((warmPt.y / svgH) * 100) - 6).toFixed(1)}%;border-color:rgba(16,185,129,0.55);">
              14:00 (${warmPt.t > 0 ? '+' + warmPt.t : warmPt.t}°C)
            </div>
          </div>
          <div class="bento-chart-ticks-grid">
            ${[0, 3, 6, 9, 12, 15, 18, 21].map(hIdx => {
              const pObj = pts[hIdx] || pts[0];
              const tVal = pObj ? pObj.t : day.tDay;
              const tStr = `${tVal > 0 ? '+' + tVal : tVal}°`;
              return `
                <div class="bento-chart-tick-cell">
                  <span class="bento-chart-tick-hr">${String(hIdx).padStart(2, '0')}:00</span>
                  <span class="bento-chart-tick-val" style="color:var(--text);">${tStr}</span>
                </div>
              `;
            }).join('')}
          </div>
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
      <div class="bento-card bento-solunar-card">
        <div class="bento-card-head">
          <div>
            <div class="bento-card-title">
              <span>${m.phaseIcon}</span>
              <span>Луна: ${m.phaseName} (${m.moonDay} л.д., освещённость ${m.illum}%)</span>
            </div>
            <div class="bento-card-sub">
              <svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4.5" fill="#fbbf24" stroke="#f59e0b" stroke-width="1.6"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" stroke="#fbbf24" stroke-width="1.8" stroke-linecap="round"/></svg> Восход ${fmtHM(day.sunriseHr)} • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4.5" fill="#fbbf24" stroke="#f59e0b" stroke-width="1.6"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" stroke="#fbbf24" stroke-width="1.8" stroke-linecap="round"/></svg> Закат ${fmtHM(day.sunsetHr)}
            </div>
          </div>
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
      if (idx !== 2 && typeof window !== 'undefined' && typeof window.__KLEV_IS_MOBILE_GUEST__ === 'function' && window.__KLEV_IS_MOBILE_GUEST__()) {
        if (typeof window.__KLEV_PROMPT_GUEST_AUTH__ === 'function') {
          window.__KLEV_PROMPT_GUEST_AUTH__('При временном ID погода доступна только на сегодня. Войдите в аккаунт для просмотра прогноза на 10 дней.');
        }
        return;
      }
      if (Number.isFinite(idx)) {
        store.dispatch({ type: 'SET_DAY', payload: idx });
      }
    });
  });
  const refreshNowBtn = container.querySelector('#weatherHeroRefreshBtn');
  if (refreshNowBtn) {
    refreshNowBtn.addEventListener('click', async () => {
      const stNow = store.getState();
      refreshNowBtn.disabled = true;
      refreshNowBtn.textContent = 'Обновление...';
      await fetchWeather(stNow.lat, stNow.lon, true);
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
  } else {
    const recalcInit = recalculateIceForWaterType(st.weatherDays, st.water, st.weatherArchive5Days);
    if (recalcInit) {
      store.dispatch({
        type: 'SET_WEATHER_DATA',
        payload: {
          days: recalcInit.days,
          archive5Days: recalcInit.archive5Days,
          iceState: recalcInit.iceState,
          iceSubState: recalcInit.iceSubState,
          iceThickness: recalcInit.iceThickness,
          iceNote: recalcInit.iceNote,
          source: st.weatherSource
        }
      });
    }
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
    if (prev && (Math.abs((Number(next.lat) || 0) - (Number(prev.lat) || 0)) > 0.002 || Math.abs((Number(next.lon) || 0) - (Number(prev.lon) || 0)) > 0.002)) {
      fetchWeather(next.lat, next.lon, true).catch(() => {});
    }
  });
  events.on('location:changed', (loc) => {
    if (loc && Number.isFinite(Number(loc.lat)) && Number.isFinite(Number(loc.lon))) {
      fetchWeather(Number(loc.lat), Number(loc.lon), true).catch(() => {});
    }
  });
  // Динамическое обновление погоды при входе в приложение (в фоне без блокировки экрана)
  fetchWeather(st.lat, st.lon, true).catch(() => {});
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        const cur = store.getState();
        const ageMs = Date.now() - (Number(cur.weatherUpdatedAt) || 0);
        if (ageMs > 15 * 60 * 1000) {
          fetchWeather(cur.lat, cur.lon, true).catch(() => {});
        }
      }
    });
  }
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