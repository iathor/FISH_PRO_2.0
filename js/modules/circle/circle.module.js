/**
 * @file circle.module.js
 * @description Модуль «Клёв ПРО: Круг» (Ревизия 2.0.164):
 * - Анти-триангуляция 2.0: привязка точек к фиксированной гексагональной сетке полигонов (вместо кругов вокруг смещённой точки) +
 *   временное размытие (свежие отчёты до 24ч — радиус ~5 км, старше 24ч — автоматическое расширение полигона до ±10 км).
 * - Региональный порог k-anonymity (≥3 отчётов за 72 ч для публичного регионального тренда) без блокировки личного доверенного Круга.
 * - Честный 8-й фактор прогноза («📡 Полевое подтверждение Круга»): строгий потолок ±10%, линейное затухание веса по возрасту отчёта
 *   (1.0 в момент публикации -> 0.3 к 72 часам), исключение собственных отчётов устройства (защита от петли самоподтверждения)
 *   и верификация мастерства автора («🏅 Эксперт Круга» ×1.5 при точности личного журнала ≥80% и ≥5 уловах).
 * - Физическая паспортизация в «🛠️ Мастерской снастей»: привязка каждого монтажа к диапазону температур воды, давления, течения и глубины
 *   + кнопка «🎯 Подобрать оснастки Мастерской под сегодня».
 * - «🆘 SOS / Сигнал Экипажу на воде»: экстренный пакет координат с уровнем заряда батареи и состоянием льда/ветра в 1 клик.
 */

import { store } from '../../core/store.js?v=2.0.164';
import { storage, calcGeoDistanceKm } from '../../core/storage.js?v=2.0.164';
import { router } from '../../core/router.js?v=2.0.164';
import { WATER_PROFILES } from '../../data/waters.js?v=2.0.164';
import { FISH_DB } from '../../data/species.js?v=2.0.164';
import { createPill, showToast, openModal, closeModal } from '../../ui/components.js?v=2.0.164';
import {
  buildShareUrls,
  shareToTelegramChat,
  shareOrCopyPack,
  getTelegramUser,
  syncToTelegramCloud,
  readFromTelegramCloud,
  triggerHaptic
} from '../../core/telegram.js?v=2.0.164';
import { setLocation } from '../geo/geo.module.js?v=2.0.164';
import { calcDynamicRig } from '../forecast/forecast.module.js?v=2.0.164';

export const CREW_TTL_MS = 72 * 60 * 60 * 1000; // 72 часа
export const CIRCLE_BLUR_RADIUS_KM = 5.0; // Базовый радиус свежего отчёта (< 24 ч)
export const CIRCLE_OLDER_BLUR_RADIUS_KM = 10.0; // Расширенный радиус для отчётов старше 24 ч (временное размытие)
export const REGIONAL_K_ANONYMITY_THRESHOLD = 3; // Порог k-anonymity для регионального тренда
const PACK_PREFIX = 'KP1_';
const CIPHER_SALT = 'KlevProCircle_v2.1_Salt_RU';

let filterWorkshopForToday = false;

/**
 * Вычисляет эффективный радиус размытия с учётом возраста отчёта (Временное размытие P0):
 * - До 24 часов: ±5 км
 * - Старше 24 часов: автоматически расширяется до ±10 км
 */
export function getEffectiveCircleRadiusKm(item, nowMs = Date.now()) {
  const baseRadius = Number(item?.br) || CIRCLE_BLUR_RADIUS_KM;
  const createdMs = Number(item?.ca) || nowMs;
  const ageHours = Math.max(0, (nowMs - createdMs) / 3600000);
  if (ageHours >= 24) {
    return Math.max(baseRadius, CIRCLE_OLDER_BLUR_RADIUS_KM);
  }
  return baseRadius;
}

/**
 * Привязывает координаты к центру фиксированной ячейки сетки и строит 6-угольный полигон (гексагон)
 * с детерминированным гео-сглаживанием вершин.
 * Поскольку координаты сначала квантуются к фиксированному узлу сетки, пересечение нескольких полигонов
 * от разных участников указывает только на общую ячейку водоёма, а НЕ на секретную яму!
 */
export function computeHexPolygonForCircle(lat, lon, radiusKm = 5.0, seedStr = '') {
  const gridLatStep = 0.045; // ~5 км по широте
  const cosLat = Math.max(0.22, Math.cos((lat * Math.PI) / 180));
  const gridLonStep = 0.045 / cosLat;

  const cellLat = Math.round(lat / gridLatStep) * gridLatStep;
  const cellLon = Math.round(lon / gridLonStep) * gridLonStep;

  const seedInput = `${cellLat.toFixed(3)}_${cellLon.toFixed(3)}_${seedStr || 'hex'}`;
  let hash = 2166136261;
  for (let i = 0; i < seedInput.length; i++) {
    hash ^= seedInput.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const unsigned = hash >>> 0;
  const rotationDeg = (unsigned % 60) - 30;
  const vertices = [];

  for (let k = 0; k < 6; k++) {
    const baseAngleDeg = k * 60 + rotationDeg;
    const rad = (baseAngleDeg * Math.PI) / 180;
    // Лёгкая нерегулярность граней (0.88 .. 1.08 радиуса), чтобы полигон не был идеальным кругом
    const jitter = 0.88 + (((unsigned >>> (k * 4)) & 0x0f) / 15) * 0.20;
    const rKm = radiusKm * jitter;
    const vLat = Math.round((cellLat + (rKm * Math.cos(rad)) / 111.32) * 10000) / 10000;
    const vLon = Math.round((cellLon + (rKm * Math.sin(rad)) / (111.32 * cosLat)) * 10000) / 10000;
    vertices.push([vLat, vLon]);
  }

  return {
    cellLat: Math.round(cellLat * 1000) / 1000,
    cellLon: Math.round(cellLon * 1000) / 1000,
    vertices
  };
}

/**
 * Смещает координаты точки для режима «👥 Круг (±5 км)» и привязывает к фиксированной гексагональной сетке,
 * чтобы реальная точка гарантированно находилась внутри полигона, но никогда не в его геометрическом центре.
 */
export function blurCoordsForCircle(lat, lon, seedStr = '') {
  const seedInput = `${lat.toFixed(3)}_${lon.toFixed(3)}_${seedStr || 'klev'}`;
  let hash = 2166136261;
  for (let i = 0; i < seedInput.length; i++) {
    hash ^= seedInput.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const unsigned = hash >>> 0;
  const angleRad = ((unsigned % 360) * Math.PI) / 180;
  const offsetKm = 1.4 + ((unsigned >>> 8) % 150) / 100; // 1.40 .. 2.90 км

  const dLat = (offsetKm * Math.cos(angleRad)) / 111.32;
  const cosLat = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const dLon = (offsetKm * Math.sin(angleRad)) / (111.32 * cosLat);

  const shiftedLat = lat + dLat;
  const shiftedLon = lon + dLon;
  const hex = computeHexPolygonForCircle(shiftedLat, shiftedLon, CIRCLE_BLUR_RADIUS_KM, seedStr);

  return {
    blurredLat: Math.round(shiftedLat * 1000) / 1000,
    blurredLon: Math.round(shiftedLon * 1000) / 1000,
    cellLat: hex.cellLat,
    cellLon: hex.cellLon,
    polygon: hex.vertices,
    blurRadiusKm: CIRCLE_BLUR_RADIUS_KM,
    offsetKm: Math.round(offsetKm * 10) / 10
  };
}

/**
 * Определяет квалификационный статус рыболова («🏅 Эксперт Круга», «🎣 Проверенный рыбак», «🟢 Участник»)
 * на основе подтверждённой точности его личного журнала уловов.
 */
export function getUserExpertRank(catches = []) {
  const list = Array.isArray(catches) ? catches : [];
  const total = list.length;
  if (total === 0) {
    return {
      tier: 'new',
      badge: '🟢 Участник Круга',
      weight: 0.75,
      matchRate: 0,
      totalCatches: 0
    };
  }
  const matched = list.filter(c => c && c.matchedForecast !== false).length;
  const matchRate = Math.round((matched / total) * 100);

  if (total >= 5 && matchRate >= 80) {
    return {
      tier: 'expert',
      badge: `🏅 Эксперт Круга (${matchRate}%)`,
      weight: 1.5,
      matchRate,
      totalCatches: total
    };
  }
  if (total >= 2 && matchRate >= 60) {
    return {
      tier: 'angler',
      badge: `🎣 Опытный рыбак (${matchRate}%)`,
      weight: 1.0,
      matchRate,
      totalCatches: total
    };
  }
  return {
    tier: 'new',
    badge: `🟢 Рыболов (${matchRate}%)`,
    weight: 0.75,
    matchRate,
    totalCatches: total
  };
}

/**
 * Проверяет совместимость паспорта оснастки из «Мастерской снастей» с сегодняшними условиями водоёма
 */
export function evaluateWorkshopRigMatch(rigItem, currentWaterType, currentDepth, currentWaterTemp, currentPress) {
  if (!rigItem) return { isMatch: false, score: 0, reasons: [] };
  let score = 100;
  const reasons = [];

  const rigWT = Number.isFinite(rigItem.tw) ? rigItem.tw : 10;
  const tempMin = Number.isFinite(rigItem.twMin) ? rigItem.twMin : (rigWT - 4.5);
  const tempMax = Number.isFinite(rigItem.twMax) ? rigItem.twMax : (rigWT + 4.5);

  if (currentWaterTemp >= tempMin && currentWaterTemp <= tempMax) {
    reasons.push(`💧 Вода ${currentWaterTemp}°C входит в рабочий коридор (${tempMin.toFixed(0)}..${tempMax.toFixed(0)}°C)`);
  } else {
    const diff = Math.min(Math.abs(currentWaterTemp - tempMin), Math.abs(currentWaterTemp - tempMax));
    score -= Math.min(45, Math.round(diff * 6));
  }

  if (rigItem.wt && rigItem.wt === currentWaterType) {
    reasons.push('🌊 Точное совпадение типа водоёма и течения');
  } else {
    score -= 15;
  }

  const rigDepth = Number.isFinite(rigItem.dp) ? rigItem.dp : currentDepth;
  if (Math.abs(rigDepth - currentDepth) <= 2.0) {
    reasons.push(`📏 Близкий горизонт глубины (~${rigDepth} м)`);
  } else {
    score -= 15;
  }

  return {
    isMatch: score >= 65,
    score: Math.max(10, score),
    tempRangeText: `${Math.max(0, Math.round(tempMin))}–${Math.round(tempMax)}°C`,
    reasons
  };
}

/**
 * Кодирует и обфусцирует пакет обмена в компактный токен KP1_...
 */
export function encodeSharePack(payloadObj) {
  const jsonStr = JSON.stringify(payloadObj);
  const utf8Bytes = new TextEncoder().encode(jsonStr);
  const saltBytes = new TextEncoder().encode(CIPHER_SALT);
  const out = new Uint8Array(utf8Bytes.length);
  for (let i = 0; i < utf8Bytes.length; i++) {
    out[i] = utf8Bytes[i] ^ saltBytes[i % saltBytes.length] ^ ((i * 31) & 0xff);
  }
  let bin = '';
  for (let i = 0; i < out.length; i++) {
    bin += String.fromCharCode(out[i]);
  }
  const b64 = typeof btoa === 'function'
    ? btoa(bin)
    : Buffer.from(out).toString('base64');
  const b64url = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${PACK_PREFIX}${b64url}`;
}

/**
 * Декодирует токен KP1_...
 */
export function decodeSharePack(rawInput) {
  if (!rawInput || typeof rawInput !== 'string') return null;
  const trimmed = rawInput.trim();
  const match = trimmed.match(/KP1_[A-Za-z0-9_-]+/);
  const token = match ? match[0] : (trimmed.startsWith(PACK_PREFIX) ? trimmed : null);
  if (!token) return null;

  try {
    const b64url = token.slice(PACK_PREFIX.length);
    let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';

    let bytes;
    if (typeof atob === 'function') {
      const bin = atob(b64);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else {
      bytes = new Uint8Array(Buffer.from(b64, 'base64'));
    }

    const saltBytes = new TextEncoder().encode(CIPHER_SALT);
    const plainBytes = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      plainBytes[i] = bytes[i] ^ saltBytes[i % saltBytes.length] ^ ((i * 31) & 0xff);
    }

    const jsonStr = new TextDecoder().decode(plainBytes);
    const parsed = JSON.parse(jsonStr);
    if (!parsed || typeof parsed !== 'object' || !parsed.t) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

/**
 * Создаёт зашифрованный пакет для сценариев:
 * - mode = 'crew' («🌊 Экипаж 72ч» — точные координаты с таймером самоуничтожения 72 часа)
 * - mode = 'sos' («🆘 SOS / Сигнал Экипажу» — экстренные точные координаты + статус льда/ветра/батареи)
 * - mode = 'circle' («👥 Круг ±5/10 км» — гексагональный полигон со смещением центра + верификация эксперта)
 * - mode = 'workshop' («🛠️ Мастерская снастей» — рабочий монтаж с физическим паспортом условий без GPS)
 */
export function createSharePackFromContext(mode = 'circle', customNote = '', overrideCatch = null) {
  const s = store.getState();
  const fish = FISH_DB.find(f => f.id === (overrideCatch?.fishId || s.fishId)) || FISH_DB[0];
  const day = s.weatherDays?.[s.dayIdx] || s.weatherDays?.[2] || s.weatherDays?.[0] || {};
  const prof = WATER_PROFILES[s.water] || WATER_PROFILES.small_river;
  const rig = calcDynamicRig(s.method, s.water, s.depth, day.windMax || 3, fish, day.waterTemp ?? 10, day.iceState || s.iceState);
  const tgUser = getTelegramUser();
  const author = s.userProfile?.callsign || tgUser?.displayName || 'Рыболов Круга';
  const deviceId = storage.getDeviceId ? storage.getDeviceId() : 'dev_local';
  const expertInfo = getUserExpertRank(s.catches || []);
  const now = Date.now();
  const waterName = overrideCatch?.locLabel || s.selectedWaterName || prof.shortName || s.locLabel;

  if (mode === 'sos') {
    const expiresAt = now + CREW_TTL_MS;
    const packObj = {
      t: 'crew',
      sos: true,
      id: `sos_${now.toString(36)}`,
      did: deviceId,
      ca: now,
      ea: expiresAt,
      au: author,
      rk: expertInfo.tier,
      lb: s.locLabel,
      wn: waterName,
      wt: s.water,
      lat: Math.round(s.lat * 10000) / 10000,
      lon: Math.round(s.lon * 10000) / 10000,
      dp: s.depth,
      fi: fish.id,
      fn: fish.name,
      tw: day.waterTemp ?? 4,
      pr: day.pressAvg ?? 754,
      wnd: `${day.windDir || 'З'} ${day.windMax || 4} м/с`,
      ice: day.iceNote || s.iceNote || 'Открытая вода',
      nt: (customNote || '').trim() || '🆘 ТРЕБУЕТСЯ ПОМОЩЬ НА ВОДЕ / ЛЬДУ! Проверьте мои координаты'
    };
    const token = encodeSharePack(packObj);
    const { webUrl, tgMiniAppUrl } = buildShareUrls(token);
    const summaryText =
      `🆘 ЭКСТРЕННЫЙ СИГНАЛ ЭКИПАЖУ (SOS) • Клёв ПРО\n` +
      `👤 От: ${author} • 📍 Район: ${s.locLabel} (${waterName})\n` +
      `🎯 ТОЧНЫЕ КООРДИНАТЫ GPS: ${packObj.lat.toFixed(4)}°N, ${packObj.lon.toFixed(4)}°E\n` +
      `🧊 Обстановка: ${packObj.ice} • 💨 Ветер: ${packObj.wnd} • 💧 Вода ~${packObj.tw}°C\n` +
      `💬 Сообщение: ${packObj.nt}\n` +
      `📞 Экстренные службы РФ: 112 (единый номер МЧС)`;

    return { mode: 'sos', packObj, token, webUrl, tgMiniAppUrl, summaryText };
  }

  if (mode === 'crew') {
    const expiresAt = now + CREW_TTL_MS;
    const packObj = {
      t: 'crew',
      id: `crew_${now.toString(36)}`,
      did: deviceId,
      ca: now,
      ea: expiresAt,
      au: author,
      rk: expertInfo.tier,
      rw_w: expertInfo.weight,
      lb: s.locLabel,
      wn: waterName,
      wt: s.water,
      lat: Math.round(s.lat * 10000) / 10000,
      lon: Math.round(s.lon * 10000) / 10000,
      dp: s.depth,
      fi: fish.id,
      fn: fish.name,
      mt: s.method,
      bt: s.selectedBait || '',
      tw: day.waterTemp ?? 10,
      pr: day.pressAvg ?? 754,
      nt: (customNote || '').trim() || 'Точка сбора экипажа на 72 часа'
    };
    const token = encodeSharePack(packObj);
    const { webUrl, tgMiniAppUrl } = buildShareUrls(token);
    const summaryText =
      `🌊 ЭКИПАЖ (72 ч) • Клёв ПРО\n` +
      `📍 Водоём: ${s.locLabel} (${waterName})\n` +
      `🎯 Точные координаты: ${packObj.lat.toFixed(4)}°N, ${packObj.lon.toFixed(4)}°E (глубина ${s.depth.toFixed(1)} м)\n` +
      `🐟 Целевая рыба: ${fish.name} • 💧 Вода ~${packObj.tw}°C • 🧭 ${packObj.pr} мм\n` +
      `🎣 Снасть: ${rig.weight}, наживка: ${packObj.bt || 'по сезону'}\n` +
      `⏳ Точка активна 72 часа и автоматически удалится после выезда` +
      (customNote ? `\n💬 Комментарий: ${customNote}` : '');

    return { mode, packObj, token, webUrl, tgMiniAppUrl, summaryText };
  }

  if (mode === 'workshop') {
    const curWT = day.waterTemp ?? 10;
    const curP = day.pressAvg ?? 754;
    const flowLabel = prof.flow >= 1.8 ? 'быстрое течение' : (prof.flow >= 1.1 ? 'умеренное течение' : 'стоячая вода');
    const twMin = Math.max(0.2, Math.round((curWT - 3.5) * 10) / 10);
    const twMax = Math.min(28.0, Math.round((curWT + 3.5) * 10) / 10);

    const packObj = {
      t: 'workshop',
      id: `ws_${now.toString(36)}`,
      did: deviceId,
      ca: now,
      au: author,
      rk: expertInfo.tier,
      fi: fish.id,
      fn: fish.name,
      wt: s.water,
      fl: flowLabel,
      dp: s.depth,
      mt: s.method,
      bt: overrideCatch?.bait || s.selectedBait || '',
      rw: rig.weight,
      rl: rig.line,
      rt: rig.tactic,
      tw: curWT,
      twMin,
      twMax,
      pr: curP,
      nt: (customNote || '').trim() || `Проверенный монтаж на ${fish.name} (${flowLabel}, вода ${twMin}..${twMax}°C)`
    };
    const token = encodeSharePack(packObj);
    const { webUrl, tgMiniAppUrl } = buildShareUrls(token);
    const summaryText =
      `🛠️ МАСТЕРСКАЯ СНАСТЕЙ • Клёв ПРО (без координат)\n` +
      `🐟 Рыба: ${fish.name} • 🏅 Автор: ${author} (${expertInfo.badge})\n` +
      `📋 Паспорт условий: ${prof.shortName} (${flowLabel}), глубина ~${s.depth.toFixed(1)} м, вода ${twMin}–${twMax}°C, давление ~${curP} мм\n` +
      `⚖️ Монтаж: ${rig.weight}\n` +
      `🧵 Леска/шнур: ${rig.line}\n` +
      `🪱 Насадка/приманка: ${packObj.bt || 'сезонная'}\n` +
      `🧭 Подача: ${rig.tactic}` +
      (customNote ? `\n💬 Заметка: ${customNote}` : '');

    return { mode, packObj, token, webUrl, tgMiniAppUrl, summaryText };
  }

  // По умолчанию: mode === 'circle' («👥 Круг ±5/10 км» с привязкой к гексагональной сетке!)
  const baseLat = overrideCatch?.lat ?? s.lat;
  const baseLon = overrideCatch?.lon ?? s.lon;
  const blurred = blurCoordsForCircle(baseLat, baseLon, `${now}_${fish.id}`);

  const packObj = {
    t: 'circle',
    id: `cir_${now.toString(36)}`,
    did: deviceId,
    ca: now,
    au: author,
    rk: expertInfo.tier,
    rw_w: expertInfo.weight,
    lb: s.locLabel,
    wn: waterName,
    wt: overrideCatch?.water || s.water,
    lat: blurred.cellLat,
    lon: blurred.cellLon,
    br: blurred.blurRadiusKm,
    poly: blurred.polygon,
    dp: overrideCatch?.depth ?? s.depth,
    fi: fish.id,
    fn: fish.name,
    kg: overrideCatch?.weightKg || 0,
    mt: overrideCatch?.method || s.method,
    bt: overrideCatch?.bait || s.selectedBait || '',
    tw: overrideCatch?.waterTemp ?? day.waterTemp ?? 10,
    pr: overrideCatch?.press ?? day.pressAvg ?? 754,
    ph: overrideCatch?.photoHash || '',
    nt: (customNote || '').trim() || (overrideCatch ? `Поимка: ${fish.name} (${overrideCatch.weightKg || 0.8} кг)` : `Разведка Круга по виду ${fish.name}`)
  };

  const token = encodeSharePack(packObj);
  const { webUrl, tgMiniAppUrl } = buildShareUrls(token);
  const summaryText =
    `👥 СВОДКА В КРУГ (гексагон ±5 км, анти-триангуляция) • Клёв ПРО\n` +
    `📍 Сектор: ${s.locLabel} • ${waterName} (привязка к ячейке сетки без пина, через 24ч размытие до ±10 км)\n` +
    `🐟 Рыба: ${fish.name}${packObj.kg ? ` • Трофей: ${packObj.kg} кг` : ''} • От: ${author} (${expertInfo.badge})\n` +
    `💧 Вода ~${packObj.tw}°C • 🧭 ${packObj.pr} мм • Глубина ~${packObj.dp} м\n` +
    `🪱 Рабочая приманка: ${packObj.bt || 'сезонная'}\n` +
    `🔒 Секретная точка защищена гексагональным полигоном «Круга»` +
    (customNote ? `\n💬 Заметка: ${customNote}` : '');

  return { mode: 'circle', packObj, token, webUrl, tgMiniAppUrl, summaryText };
}

/**
 * Очищает просроченные сессии «Экипажа (72ч)» из хранилища
 */
export function purgeExpiredCircleItems(items = []) {
  const now = Date.now();
  return (Array.isArray(items) ? items : []).filter(item => {
    if (!item) return false;
    if (item.t === 'crew' && Number.isFinite(item.ea) && item.ea < now) {
      return false;
    }
    return true;
  });
}

/**
 * Импортирует пакет KP1_... в локальное хранилище Круга и обновляет Store.
 * Включает защиту от перекрёстной триангуляции и дубликатов.
 */
export async function importSharePackToken(rawInput, silent = false) {
  const decoded = decodeSharePack(rawInput);
  if (!decoded) {
    if (!silent) showToast('❌ Не удалось распознать код пакета «Клёв ПРО: Круг». Проверьте скопированную ссылку или код KP1_...', 'bad');
    return null;
  }

  const now = Date.now();
  if (decoded.t === 'crew' && Number.isFinite(decoded.ea) && decoded.ea < now) {
    if (!silent) showToast('⌛ Срок действия этой точки «Экипажа» (72 часа) уже истёк — координаты автоматически уничтожены.', 'warn');
    return null;
  }

  // Гарантируем, что у любого отчёта circle есть гексагональный полигон с учётом возраста отчёта
  if (decoded.t === 'circle' && Number.isFinite(decoded.lat) && Number.isFinite(decoded.lon)) {
    const effR = getEffectiveCircleRadiusKm(decoded, now);
    const hex = computeHexPolygonForCircle(decoded.lat, decoded.lon, effR, decoded.id || 'cir');
    decoded.lat = hex.cellLat;
    decoded.lon = hex.cellLon;
    decoded.poly = hex.vertices;
  }

  const existing = purgeExpiredCircleItems(store.getState().circleItems || []);
  const filtered = existing.filter(x => x.id !== decoded.id);
  const updated = [{ ...decoded, importedAt: now }, ...filtered].slice(0, 60);

  storage.saveCircleItems(updated);
  store.dispatch({ type: 'SET_CIRCLE_ITEMS', payload: updated });
  syncToTelegramCloud('klev_circle_v2', updated.slice(0, 8));

  triggerHaptic('success');
  if (!silent) {
    const typeLabel = decoded.sos
      ? `🆘 Экстренный сигнал Экипажа: ${decoded.wn || decoded.lb}`
      : (decoded.t === 'crew'
          ? `🌊 Точка Экипажа (72ч): ${decoded.wn || decoded.lb}`
          : (decoded.t === 'workshop'
              ? `🛠️ Снасть из Мастерской: ${decoded.fn}`
              : `👥 Сводка Круга (полигон ±${getEffectiveCircleRadiusKm(decoded, now)} км): ${decoded.fn}`));
    showToast(`✅ Добавлено в ваш Круг: ${typeLabel}`, 'good');
  }
  return decoded;
}

/**
 * Честный 8-й фактор прогноза клёва — «📡 Полевое подтверждение Круга» (Ревизия 2.0.164):
 * 1) Исключает собственные отчёты текущего устройства (`item.did === myDeviceId`), чтобы исключить петлю самоподтверждения!
 *    (Личные уловы пользователя учитываются отдельно в калибровке Журнала уловов).
 * 2) Применяет линейное затухание веса по возрасту отчёта: 1.0 в момент публикации (0 ч) -> 0.3 к 72 часам.
 * 3) Учитывает квалификационный вес автора отчёта: Эксперт Круга (×1.5), Опытный рыбак (×1.0), Новичок (×0.75).
 * 4) Строго ограничивает вклад 8-го фактора потолком ±10% (не может перебить ледостав или барический шок).
 */
export function evaluateCircleFieldConfirmation(fish, lat, lon, circleItems = [], catches = []) {
  const now = Date.now();
  const maxAgeMs = 72 * 3600 * 1000; // 72 часа
  const radiusKm = 35;
  const myDeviceId = storage.getDeviceId ? storage.getDeviceId() : 'dev_local';

  const validExternalCircle = purgeExpiredCircleItems(circleItems).filter(item => {
    if (item.t !== 'circle' && item.t !== 'crew') return false;
    if (!Number.isFinite(item.lat) || !Number.isFinite(item.lon)) return false;
    const ageMs = Math.max(0, now - (item.ca || now));
    if (ageMs > maxAgeMs) return false;
    // Защита от самоподтверждения (P0): исключаем собственные пакеты этого устройства, кроме явно загруженных демо-пакетов
    if (item.did && item.did === myDeviceId && !item.isDemoSeed) return false;
    return calcGeoDistanceKm(lat, lon, item.lat, item.lon) <= radiusKm;
  });

  const matchingSpeciesCircle = validExternalCircle.filter(item => item.fi === fish?.id);
  const kAnonReady = validExternalCircle.length >= REGIONAL_K_ANONYMITY_THRESHOLD;

  if (matchingSpeciesCircle.length === 0 && validExternalCircle.length === 0) {
    return {
      hasSignal: false,
      val: 0,
      kAnonCount: 0,
      kAnonReady: false,
      note: 'Полевые сводки Круга: нет внешних сигналов от других участников в радиусе 35 км за 72 ч',
      commentary: 'Независимых отчётов от других участников вашего Круга в радиусе 35 км за последние 72 ч пока нет (ваши собственные уловы учитываются отдельно в блоке Журнала без петли самоподтверждения).'
    };
  }

  if (matchingSpeciesCircle.length > 0) {
    let weightedSum = 0;
    let expertCount = 0;

    for (const item of matchingSpeciesCircle) {
      const ageHours = Math.max(0, Math.min(72, (now - (item.ca || now)) / 3600000));
      // Линейное затухание: 1.0 при 0ч -> 0.3 при 72ч
      const timeDecay = 1.0 - (ageHours / 72) * 0.7;
      const authorWeight = Number.isFinite(item.rw_w) ? item.rw_w : (item.rk === 'expert' ? 1.5 : 1.0);
      if (item.rk === 'expert') expertCount++;
      weightedSum += 3.8 * timeDecay * authorWeight;
    }

    // Строгий потолок ±10% (P0)
    const boost = Math.max(2, Math.min(10, Math.round(weightedSum)));
    const bestBait = matchingSpeciesCircle[0]?.bt || 'по сезону';
    const authors = Array.from(new Set(matchingSpeciesCircle.map(x => x.au).filter(Boolean))).slice(0, 2).join(', ');
    const expertBadgeNote = expertCount > 0 ? `, из них ${expertCount} от 🏅 Экспертов` : '';

    return {
      hasSignal: true,
      val: boost,
      kAnonCount: validExternalCircle.length,
      kAnonReady,
      note: `Полевое подтверждение Круга: +${boost}% (${matchingSpeciesCircle.length} независ. отч. за 72ч${expertBadgeNote}, лимит ±10%)`,
      commentary: `За последние 72 ч в радиусе 35 км получено ${matchingSpeciesCircle.length} независимых подтверждений по виду «${fish.name}»${authors ? ` (от: ${authors}${expertBadgeNote})` : ''} с учётом временного затухания. Лучшая приманка на воде: «${bestBait}» (+${boost}% из макс. 10%).`
    };
  }

  const otherFishNames = Array.from(new Set(validExternalCircle.map(x => x.fn).filter(Boolean))).slice(0, 2).join(', ');
  return {
    hasSignal: true,
    val: +2,
    kAnonCount: validExternalCircle.length,
    kAnonReady,
    note: `Активность в секторе Круга (+2%, клюёт: ${otherFishNames || 'соседние виды'})`,
    commentary: `В радиусе 35 км есть свежие независимые сигналы Круга по соседним видам (${otherFishNames}), общая кормовая активность водоёма подтверждена.`
  };
}

/**
 * Открывает модальное окно создания и отправки пакета («🌊 Экипаж 72ч», «👥 Круг ±5/10 км», «🛠️ Мастерская снастей», «🆘 SOS»)
 */
export function openShareModalForCurrentContext(initialMode = 'circle', overrideCatch = null) {
  let currentMode = initialMode;
  let customNote = '';

  function renderModalContent(bodyEl) {
    const pack = createSharePackFromContext(currentMode, customNote, overrideCatch);

    bodyEl.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:12px;font-size:var(--fs-sm);">
        <div style="padding:10px 12px;background:rgba(56,189,248,0.10);border:1px solid var(--accent);border-radius:var(--r-sm);font-size:var(--fs-xs);line-height:1.45;">
          🛡️ <b>Анти-триангуляция 2.0 («Клёв ПРО: Круг»):</b> в режиме «Круг» точка привязывается к фиксированному 6-угольному полигону сетки (без центра пина) и через 24 ч автоматически расширяется с ±5 км до ±10 км.
        </div>

        <!-- Выбор уровня приватности (4 режима шаринга, включая SOS) -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:6px;">
          <button type="button" class="btn btn-sm ${currentMode === 'circle' ? 'btn-accent' : ''}" data-share-mode="circle" style="min-height:44px;flex-direction:column;gap:2px;">
            <span>👥 В Круг (±5/10 км)</span>
            <span style="font-size:10px;opacity:0.85;">Гексагон без пина</span>
          </button>
          <button type="button" class="btn btn-sm ${currentMode === 'crew' ? 'btn-accent' : ''}" data-share-mode="crew" style="min-height:44px;flex-direction:column;gap:2px;">
            <span>🌊 Экипаж (72 ч)</span>
            <span style="font-size:10px;opacity:0.85;">Точный пин на выезд</span>
          </button>
          <button type="button" class="btn btn-sm ${currentMode === 'workshop' ? 'btn-accent' : ''}" data-share-mode="workshop" style="min-height:44px;flex-direction:column;gap:2px;">
            <span>🛠️ Мастерская</span>
            <span style="font-size:10px;opacity:0.85;">Паспорт снасти</span>
          </button>
          <button type="button" class="btn btn-sm ${currentMode === 'sos' ? 'btn-good' : ''}" data-share-mode="sos" style="min-height:44px;flex-direction:column;gap:2px;border-color:var(--bad);color:${currentMode === 'sos' ? '#fff' : 'var(--bad)'};background:${currentMode === 'sos' ? 'var(--bad)' : 'var(--card)'};">
            <span>🆘 SOS Экипажу</span>
            <span style="font-size:10px;opacity:0.9;">Экстренный пеленг</span>
          </button>
        </div>

        <div>
          <label for="shareCustomNoteInput" style="display:block;font-size:var(--fs-xs);color:var(--muted);font-weight:700;margin-bottom:4px;">
            💬 КОММЕНТАРИЙ ДЛЯ ДРУЗЕЙ / ЭКИПАЖА:
          </label>
          <input type="text" id="shareCustomNoteInput" class="input" value="${customNote}" placeholder="${currentMode === 'sos' ? 'Укажите ситуацию: заглох мотор, нужна буксировка, промоина...' : 'Напр.: Выход на вечерней зорьке у коряжника, работает фиолетовая танта 0.4 г...'}">
        </div>

        <!-- Предпросмотр формируемой карточки -->
        <div class="card" style="background:var(--card);padding:10px 12px;border:1px solid ${currentMode === 'sos' ? 'var(--bad)' : 'var(--border)'};font-size:var(--fs-xs);white-space:pre-line;line-height:1.45;color:var(--text);" id="sharePreviewBox">${pack.summaryText}</div>

        <!-- Кнопки отправки -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;margin-top:4px;">
          <button type="button" class="btn ${currentMode === 'sos' ? 'btn-good' : 'btn-accent'}" id="shareSendTelegramBtn" style="${currentMode === 'sos' ? 'background:var(--bad);border-color:var(--bad);' : ''}">
            ✈️ Отправить в Telegram
          </button>
          <button type="button" class="btn btn-good" id="shareCopyOrNativeBtn">
            📋 Скопировать ссылку и код
          </button>
        </div>

        <div style="padding-top:8px;border-top:1px dashed var(--border);display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="font-size:11px;color:var(--muted);">Также сохранить эту запись в мою ленту «Круга» на устройстве:</span>
          <button type="button" class="btn btn-sm" id="shareSaveLocalCircleBtn">➕ Сохранить у себя в Круге</button>
        </div>
      </div>
    `;

    bodyEl.querySelectorAll('[data-share-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        currentMode = btn.getAttribute('data-share-mode');
        const noteEl = bodyEl.querySelector('#shareCustomNoteInput');
        if (noteEl) customNote = noteEl.value;
        renderModalContent(bodyEl);
      });
    });

    const noteInput = bodyEl.querySelector('#shareCustomNoteInput');
    if (noteInput) {
      noteInput.addEventListener('input', (e) => {
        customNote = e.target.value;
        const updatedPack = createSharePackFromContext(currentMode, customNote, overrideCatch);
        const prevBox = bodyEl.querySelector('#sharePreviewBox');
        if (prevBox) prevBox.textContent = updatedPack.summaryText;
      });
    }

    bodyEl.querySelector('#shareSendTelegramBtn')?.addEventListener('click', () => {
      const finalPack = createSharePackFromContext(currentMode, customNote, overrideCatch);
      importSharePackToken(finalPack.token, true);
      shareToTelegramChat(finalPack.webUrl, `${finalPack.summaryText}\n\n🔑 Код для импорта: ${finalPack.token}`);
    });

    bodyEl.querySelector('#shareCopyOrNativeBtn')?.addEventListener('click', async () => {
      const finalPack = createSharePackFromContext(currentMode, customNote, overrideCatch);
      await importSharePackToken(finalPack.token, true);
      await shareOrCopyPack({
        title: currentMode === 'sos' ? '🆘 SOS Сигнал Экипажу • Клёв ПРО' : 'Клёв ПРО: Круг',
        text: finalPack.summaryText,
        url: finalPack.webUrl,
        token: finalPack.token
      });
    });

    bodyEl.querySelector('#shareSaveLocalCircleBtn')?.addEventListener('click', async () => {
      const finalPack = createSharePackFromContext(currentMode, customNote, overrideCatch);
      await importSharePackToken(finalPack.token, false);
      closeModal();
    });
  }

  openModal('🤝 Поделиться в «Круг / Экипаж / Мастерскую»', '<div id="shareModalMount"></div>', (bodyEl) => {
    renderModalContent(bodyEl);
  });
}

/**
 * Открывает окно ручного импорта пакета по коду KP1_...
 */
export function openImportPackModal() {
  const html = `
    <div style="display:flex;flex-direction:column;gap:12px;font-size:var(--fs-sm);">
      <p style="font-size:var(--fs-xs);color:var(--muted);line-height:1.45;">
        Вставьте сообщение от друга, ссылку <code>#klev_pack=...</code> или зашифрованный код <code>KP1_...</code>, полученный в Telegram, MAX или ВК.
      </p>
      <textarea id="importPackTextarea" class="input" rows="4" placeholder="Вставьте сюда текст сообщения или код KP1_..." style="min-height:96px;font-family:monospace;font-size:12px;"></textarea>
      <div style="display:flex;gap:8px;">
        <button type="button" class="btn btn-good" id="importPackConfirmBtn" style="flex:2;">📥 Расшифровать и добавить в Круг</button>
        <button type="button" class="btn" data-modal-close style="flex:1;">Отмена</button>
      </div>
    </div>
  `;

  openModal('📥 Принять точку Экипажа / сводку Круга', html, (bodyEl) => {
    const ta = bodyEl.querySelector('#importPackTextarea');
    const btn = bodyEl.querySelector('#importPackConfirmBtn');
    if (btn && ta) {
      btn.addEventListener('click', async () => {
        const res = await importSharePackToken(ta.value, false);
        if (res) {
          closeModal();
        }
      });
    }
  });
}

function formatRemainingHours(expiresAt) {
  const diffMs = (expiresAt || 0) - Date.now();
  if (diffMs <= 0) return 'Истекло';
  const hrs = Math.floor(diffMs / 3600000);
  const mins = Math.floor((diffMs % 3600000) / 60000);
  return `${hrs} ч ${mins} мин`;
}

export function render(container) {
  if (!container) return;
  const s = store.getState();
  const now = Date.now();
  const day = s.weatherDays?.[s.dayIdx] || s.weatherDays?.[2] || s.weatherDays?.[0] || {};
  const curWT = day.waterTemp ?? 10;
  const curP = day.pressAvg ?? 754;

  const allItems = purgeExpiredCircleItems(s.circleItems || []);
  const crewItems = allItems.filter(x => x.t === 'crew');
  const circleReports = allItems.filter(x => x.t === 'circle');
  const rawWorkshopRigs = allItems.filter(x => x.t === 'workshop');
  const workshopRigs = filterWorkshopForToday
    ? rawWorkshopRigs.filter(item => evaluateWorkshopRigMatch(item, s.water, s.depth, curWT, curP).isMatch)
    : rawWorkshopRigs;

  const tgUser = getTelegramUser();
  const callsign = s.userProfile?.callsign || tgUser?.displayName || 'Рыболов';
  const expertRank = getUserExpertRank(s.catches || []);
  const kAnonReady = circleReports.length >= REGIONAL_K_ANONYMITY_THRESHOLD;

  container.innerHTML = `
    <div class="card">
      <div class="section-head">
        <div>
          <span class="section-title">👥 «Клёв ПРО: Круг» • Закрытый клубный навигатор (Ревизия 2.0.164)</span>
          <div style="font-size:var(--fs-xs);color:var(--accent);font-weight:700;margin-top:2px;">
            Гексагональная защита от триангуляции • Временное размытие (&gt;24ч ➔ ±10 км) • Экипаж 72ч • Паспорта Мастерской
          </div>
        </div>
        <div class="toolbar-row">
          <button type="button" class="btn btn-sm btn-good" id="circleCreatePackBtn">🤝 Поделиться</button>
          <button type="button" class="btn btn-sm" id="circleSosBtn" style="border-color:var(--bad);color:var(--bad);font-weight:800;">🆘 SOS Экипажу</button>
          <button type="button" class="btn btn-sm btn-accent" id="circleImportPackBtn">📥 Ввести код KP1</button>
        </div>
      </div>

      <!-- Панель позывного, ранга Эксперта и статуса k-anonymity -->
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;padding:10px 12px;background:var(--card);border:1px solid var(--border);border-radius:var(--r-sm);margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="font-size:var(--fs-xs);color:var(--muted);font-weight:700;">ВАШ ПОЗЫВНОЙ:</span>
          <input type="text" id="circleCallsignInput" class="input" value="${callsign}" placeholder="Ваш позывной..." style="max-width:175px;min-height:32px;padding:3px 8px;font-size:var(--fs-xs);font-weight:800;">
          <button type="button" class="btn btn-sm" id="circleSaveCallsignBtn" style="min-height:32px;">💾 Сохранить</button>
          ${createPill({ text: `${expertRank.badge} • вес ×${expertRank.weight}`, tone: expertRank.tier === 'expert' ? 'good' : 'neutral' })}
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          ${createPill({
            icon: '🛡️',
            text: kAnonReady ? `Региональный пул k-anonymity: ${circleReports.length} отч. (активен)` : `Личный Круг (${circleReports.length}/${REGIONAL_K_ANONYMITY_THRESHOLD} до пула тренда)`,
            tone: kAnonReady ? 'good' : 'warn'
          })}
          <button type="button" class="btn btn-sm" id="circleDemoSeedBtn" title="Загрузить независимые тестовые пакеты Круга, Экипажа и Мастерской для текущей локации">✨ Тестовый пакет региона</button>
        </div>
      </div>

      <!-- Три быстрые карточки создания пакета -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px;margin-bottom:14px;">
        <div class="card" style="background:var(--card);padding:11px 12px;border-left:3px solid var(--accent);">
          <div style="font-weight:800;font-size:var(--fs-sm);color:var(--accent);">🌊 Экипаж на 72 часа</div>
          <div style="font-size:var(--fs-xs);color:var(--muted);margin:4px 0 8px;line-height:1.4;">
            Точные координаты вашей точки (${s.lat.toFixed(3)}°N, ${s.lon.toFixed(3)}°E) для напарников по выезду. Автоматически уничтожаются через 72 ч.
          </div>
          <button type="button" class="btn btn-sm btn-accent" data-quick-share="crew" style="width:100%;">🌊 Создать выезд Экипажа (72ч)</button>
        </div>

        <div class="card" style="background:var(--card);padding:11px 12px;border-left:3px solid var(--good);">
          <div style="font-weight:800;font-size:var(--fs-sm);color:var(--good);">👥 Сводка в Круг (гексагон ±5/10 км)</div>
          <div style="font-size:var(--fs-xs);color:var(--muted);margin:4px 0 8px;line-height:1.4;">
            Привязка к фиксированному 6-угольному полигону сетки (вычислить яму пересечением кругов невозможно). Через 24 ч полигон расширяется до ±10 км.
          </div>
          <button type="button" class="btn btn-sm btn-good" data-quick-share="circle" style="width:100%;">👥 Отправить сводку в Круг</button>
        </div>

        <div class="card" style="background:var(--card);padding:11px 12px;border-left:3px solid var(--warn);">
          <div style="font-weight:800;font-size:var(--fs-sm);color:var(--warn);">🛠️ Мастерская снастей (с паспортом)</div>
          <div style="font-size:var(--fs-xs);color:var(--muted);margin:4px 0 8px;line-height:1.4;">
            Передача проверенного монтажа без GPS-координат с автопривязкой к температуре воды (${curWT}°C), течению и горизонту глубины.
          </div>
          <button type="button" class="btn btn-sm" data-quick-share="workshop" style="width:100%;border-color:var(--warn);color:var(--warn);">🛠️ Поделиться оснасткой</button>
        </div>
      </div>

      <!-- Секция 1: Активные точки Экипажа (72 ч) и SOS -->
      <div style="margin-bottom:14px;">
        <div class="section-head" style="margin-bottom:6px;">
          <span class="section-title">🌊 Активные точки «Экипажа» и сигналы SOS (автоудаление через 72 ч) — ${crewItems.length}</span>
        </div>
        ${crewItems.length === 0 ? `
          <div style="padding:12px;background:var(--card);border:1px dashed var(--border);border-radius:var(--r-sm);font-size:var(--fs-xs);color:var(--muted);">
            Активных 72-часовых выездов сейчас нет. Нажмите <b>«🌊 Создать выезд Экипажа (72ч)»</b> или импортируйте код <code>KP1_...</code> от напарника.
          </div>
        ` : `
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:8px;">
            ${crewItems.map(item => `
              <div class="card" style="background:var(--card);padding:10px 12px;border:1.5px solid ${item.sos ? 'var(--bad)' : 'var(--accent)'};">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;">
                  <div>
                    <span class="pill ${item.sos ? 'pill-bad' : 'pill-ice'}" style="font-size:10px;">
                      ${item.sos ? '🆘 ЭКСТРЕННЫЙ SOS' : '🌊 Экипаж'} • ⏳ ${formatRemainingHours(item.ea)}
                    </span>
                    <div style="font-weight:800;font-size:var(--fs-sm);margin-top:4px;">📍 ${item.lb || 'Точка сбора'} • ${item.wn || ''}</div>
                  </div>
                  <button type="button" class="btn btn-sm" data-del-circle="${item.id}" style="min-height:26px;padding:2px 6px;color:var(--bad);">✕</button>
                </div>
                <div style="font-size:var(--fs-xs);color:var(--muted);margin-top:4px;">
                  Координаты: <b>${Number(item.lat).toFixed(4)}°N, ${Number(item.lon).toFixed(4)}°E</b> (глубина ${item.dp || 2} м)<br>
                  Рыба: <b>${item.fn || 'Щука'}</b> • Вода ~${item.tw ?? 8}°C • 🧭 ${item.pr ?? 754} мм • От: <b>${item.au || 'Напарник'}</b>
                </div>
                ${item.nt ? `<div style="font-size:var(--fs-xs);color:${item.sos ? 'var(--bad)' : 'var(--accent)'};font-weight:700;margin-top:4px;">💬 ${item.nt}</div>` : ''}
                <div style="display:flex;gap:6px;margin-top:8px;">
                  <button type="button" class="btn btn-sm btn-accent" data-goto-circle="${item.id}" style="flex:1;">🗺️ Показать на карте</button>
                </div>
              </div>
            `).join('')}
          </div>
        `}
      </div>

      <!-- Секция 2: Сводки Доверенного Круга (гексагоны ±5/10 км) -->
      <div style="margin-bottom:14px;">
        <div class="section-head" style="margin-bottom:6px;">
          <span class="section-title">👥 Сводки «Круга» (гексагоны ±5/10 км • честный 8-й фактор до ±10%) — ${circleReports.length}</span>
        </div>
        ${circleReports.length === 0 ? `
          <div style="padding:12px;background:var(--card);border:1px dashed var(--border);border-radius:var(--r-sm);font-size:var(--fs-xs);color:var(--muted);">
            В вашем Круге пока нет сводок. Нажмите <b>«✨ Тестовый пакет региона»</b> выше, чтобы протестировать 6-угольные полигоны анти-триангуляции на карте и 8-й фактор полевого подтверждения!
          </div>
        ` : `
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:8px;">
            ${circleReports.map(item => {
              const effR = getEffectiveCircleRadiusKm(item, now);
              const ageHrs = Math.max(0, Math.round((now - (item.ca || now)) / 3600000));
              const rkBadge = item.rk === 'expert' ? '🏅 Эксперт ×1.5' : '🎣 Рыбак';
              return `
                <div class="card" style="background:var(--card);padding:10px 12px;border:1px solid var(--border);">
                  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;">
                    <div>
                      <span class="pill pill-good" style="font-size:10px;">⬡ Полигон ±${effR} км (${ageHrs}ч назад) • ${rkBadge}</span>
                      <div style="font-weight:800;font-size:var(--fs-sm);margin-top:4px;">🐟 ${item.fn || 'Рыба'}${item.kg ? ` • ${item.kg} кг` : ''} (${item.wn || item.lb})</div>
                    </div>
                    <button type="button" class="btn btn-sm" data-del-circle="${item.id}" style="min-height:26px;padding:2px 6px;color:var(--bad);">✕</button>
                  </div>
                  <div style="font-size:var(--fs-xs);color:var(--muted);margin-top:4px;">
                    💧 Вода ~${item.tw ?? 8}°C • 🧭 ${item.pr ?? 754} мм • Глубина ~${item.dp || 2} м<br>
                    🪱 Приманка: <b style="color:var(--accent);">${item.bt || 'по сезону'}</b> • Автор: <b>${item.au || 'Друг'}</b>
                  </div>
                  ${item.nt ? `<div style="font-size:var(--fs-xs);color:var(--text);margin-top:4px;">💬 ${item.nt}</div>` : ''}
                  <div style="display:flex;gap:6px;margin-top:8px;">
                    <button type="button" class="btn btn-sm" data-goto-circle="${item.id}" style="flex:1;">🗺️ Гексагон ±${effR} км на карте</button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `}
      </div>

      <!-- Секция 3: Мастерская снастей с фильтрацией по паспорту условий -->
      <div>
        <div class="section-head" style="margin-bottom:6px;">
          <span class="section-title">🛠️ «Мастерская снастей» (с физическим паспортом условий) — ${workshopRigs.length} из ${rawWorkshopRigs.length}</span>
          <button type="button" class="btn btn-sm ${filterWorkshopForToday ? 'btn-accent' : ''}" id="circleFilterWorkshopTodayBtn">
            ${filterWorkshopForToday ? '🎯 Показаны подходящие под сегодня (Сбросить)' : `🎯 Подобрать под сегодня (вода ~${curWT}°C)`}
          </button>
        </div>
        ${workshopRigs.length === 0 ? `
          <div style="padding:12px;background:var(--card);border:1px dashed var(--border);border-radius:var(--r-sm);font-size:var(--fs-xs);color:var(--muted);">
            ${filterWorkshopForToday
              ? `Среди сохранённых карточек нет оснасток под температуру воды ~${curWT}°C. Нажмите кнопку выше, чтобы показать все оснастки.`
              : 'Сохранённых карточек оснасток пока нет.'}
          </div>
        ` : `
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:8px;">
            ${workshopRigs.map(item => {
              const matchInfo = evaluateWorkshopRigMatch(item, s.water, s.depth, curWT, curP);
              return `
                <div class="card" style="background:var(--card);padding:10px 12px;border:1px solid ${matchInfo.isMatch ? 'var(--good)' : 'var(--border)'};">
                  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;">
                    <div>
                      <span class="pill ${matchInfo.isMatch ? 'pill-good' : 'pill-warn'}" style="font-size:10px;">
                        🛠️ Паспорт: вода ${matchInfo.tempRangeText} • Совместимость ${matchInfo.score}%
                      </span>
                      <div style="font-weight:800;font-size:var(--fs-sm);margin-top:4px;">🎣 ${item.fn}: ${item.rw || 'Оснастка'}</div>
                    </div>
                    <button type="button" class="btn btn-sm" data-del-circle="${item.id}" style="min-height:26px;padding:2px 6px;color:var(--bad);">✕</button>
                  </div>
                  <div style="font-size:var(--fs-xs);color:var(--muted);margin-top:4px;line-height:1.4;">
                    🌊 <b>Условия:</b> ${item.fl || 'умеренное течение'}, глубина ~${item.dp || 2} м, от: <b>${item.au || 'Профи'}</b><br>
                    🧵 <b>Леска/поводок:</b> ${item.rl || '—'}<br>
                    🪱 <b>Приманка:</b> <span style="color:var(--accent);font-weight:700;">${item.bt || '—'}</span><br>
                    🧭 <b>Подача:</b> ${item.rt || '—'}
                  </div>
                  <div style="display:flex;gap:6px;margin-top:8px;">
                    <button type="button" class="btn btn-sm btn-good" data-apply-workshop="${item.id}" style="flex:1;">✅ Применить эту снасть</button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `}
      </div>
    </div>
  `;

  bindCircleEvents(container);
}

function bindCircleEvents(container) {
  container.querySelector('#circleCreatePackBtn')?.addEventListener('click', () => {
    openShareModalForCurrentContext('circle');
  });

  container.querySelector('#circleSosBtn')?.addEventListener('click', () => {
    openShareModalForCurrentContext('sos');
  });

  container.querySelector('#circleImportPackBtn')?.addEventListener('click', () => {
    openImportPackModal();
  });

  container.querySelector('#circleFilterWorkshopTodayBtn')?.addEventListener('click', () => {
    filterWorkshopForToday = !filterWorkshopForToday;
    render(container);
  });

  container.querySelectorAll('[data-quick-share]').forEach(btn => {
    btn.addEventListener('click', () => {
      openShareModalForCurrentContext(btn.getAttribute('data-quick-share'));
    });
  });

  const saveCallsignBtn = container.querySelector('#circleSaveCallsignBtn');
  const callsignInput = container.querySelector('#circleCallsignInput');
  if (saveCallsignBtn && callsignInput) {
    saveCallsignBtn.addEventListener('click', () => {
      const val = (callsignInput.value || '').trim() || 'Рыболов';
      store.dispatch({ type: 'SET_USER_CALLSIGN', payload: val });
      showToast(`Позывной в Круге сохранён: ${val}`, 'good');
    });
  }

  const demoBtn = container.querySelector('#circleDemoSeedBtn');
  if (demoBtn) {
    demoBtn.addEventListener('click', async () => {
      const s = store.getState();
      const p1 = createSharePackFromContext('circle', 'Уверенный выход на свале 2.5 м после обеда, брала с паузой 4 сек');
      p1.packObj.did = 'demo_external_expert_1';
      p1.packObj.au = 'Северянин-89';
      p1.packObj.rk = 'expert';
      p1.packObj.rw_w = 1.5;
      p1.packObj.isDemoSeed = true;
      const t1 = encodeSharePack(p1.packObj);

      const p2 = createSharePackFromContext('crew', 'Сбор у лодочного спуска в 06:30, точка проверена эхолотом');
      p2.packObj.did = 'demo_external_crew_2';
      p2.packObj.au = 'Капитан Обь';
      p2.packObj.isDemoSeed = true;
      const t2 = encodeSharePack(p2.packObj);

      const p3 = createSharePackFromContext('workshop', 'Лучший монтаж под текущую прозрачность воды и течение');
      p3.packObj.did = 'demo_external_ws_3';
      p3.packObj.au = 'Мастер XUL';
      p3.packObj.rk = 'expert';
      p3.packObj.isDemoSeed = true;
      const t3 = encodeSharePack(p3.packObj);

      await importSharePackToken(t1, true);
      await importSharePackToken(t2, true);
      await importSharePackToken(t3, true);
      showToast(`✨ В ваш Круг добавлены 3 независимых пакета для локации «${s.locLabel}» (проверьте 6-угольник на карте и 8-й фактор прогноза!)`, 'good');
    });
  }

  container.querySelectorAll('[data-del-circle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-del-circle');
      const next = (store.getState().circleItems || []).filter(x => x.id !== id);
      storage.saveCircleItems(next);
      store.dispatch({ type: 'SET_CIRCLE_ITEMS', payload: next });
      showToast('Запись удалена из Круга', 'info');
    });
  });

  container.querySelectorAll('[data-goto-circle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-goto-circle');
      const item = (store.getState().circleItems || []).find(x => x.id === id);
      if (item && Number.isFinite(item.lat) && Number.isFinite(item.lon)) {
        setLocation(item.lat, item.lon, true);
        router.navigate('geo');
        showToast(item.t === 'crew' ? `Переход к точной точке Экипажа: ${item.wn || item.lb}` : `Переход к гексагону Круга (±${getEffectiveCircleRadiusKm(item)} км): ${item.wn || item.lb}`, 'info');
      }
    });
  });

  container.querySelectorAll('[data-apply-workshop]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-apply-workshop');
      const item = (store.getState().circleItems || []).find(x => x.id === id);
      if (item) {
        if (item.fi) store.dispatch({ type: 'SET_FISH', payload: item.fi });
        if (item.mt) store.dispatch({ type: 'SET_METHOD', payload: item.mt });
        if (item.bt) store.dispatch({ type: 'SET_BAIT', payload: item.bt });
        if (Number.isFinite(item.dp)) store.dispatch({ type: 'SET_DEPTH', payload: item.dp });
        showToast(`✅ Применена оснастка из Мастерской для вида «${item.fn}»!`, 'good');
        router.navigate('forecast');
      }
    });
  });
}

let unsub = null;

export async function init(container) {
  const savedItems = purgeExpiredCircleItems(storage.loadCircleItems ? storage.loadCircleItems() : []);
  store.dispatch({ type: 'SET_CIRCLE_ITEMS', payload: savedItems });

  render(container);

  if (unsub) unsub();
  unsub = store.subscribe(
    st => ({
      route: st.route,
      circleItems: st.circleItems,
      lat: st.lat,
      lon: st.lon,
      locLabel: st.locLabel,
      fishId: st.fishId,
      water: st.water,
      method: st.method,
      depth: st.depth,
      catches: st.catches,
      userProfile: st.userProfile
    }),
    (next) => {
      if (next.route && next.route !== 'circle') {
        if (container) container._circleNeedsRender = true;
        return;
      }
      if (container) container._circleNeedsRender = false;
      render(container);
    }
  );

  try {
    const cloudItems = await readFromTelegramCloud('klev_circle_v2');
    if (Array.isArray(cloudItems) && cloudItems.length > 0) {
      const mergedMap = new Map();
      [...savedItems, ...purgeExpiredCircleItems(cloudItems)].forEach(it => {
        if (it && it.id) mergedMap.set(it.id, it);
      });
      const merged = Array.from(mergedMap.values()).sort((a, b) => (b.ca || 0) - (a.ca || 0));
      storage.saveCircleItems(merged);
      store.dispatch({ type: 'SET_CIRCLE_ITEMS', payload: merged });
    }
  } catch (e) {}
}

export function destroy() {
  if (unsub) unsub();
}

export const circleModule = {
  CREW_TTL_MS,
  CIRCLE_BLUR_RADIUS_KM,
  CIRCLE_OLDER_BLUR_RADIUS_KM,
  REGIONAL_K_ANONYMITY_THRESHOLD,
  getEffectiveCircleRadiusKm,
  computeHexPolygonForCircle,
  blurCoordsForCircle,
  getUserExpertRank,
  evaluateWorkshopRigMatch,
  encodeSharePack,
  decodeSharePack,
  createSharePackFromContext,
  purgeExpiredCircleItems,
  importSharePackToken,
  evaluateCircleFieldConfirmation,
  openShareModalForCurrentContext,
  openImportPackModal,
  init,
  render,
  destroy
};
