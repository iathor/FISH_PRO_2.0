/* Klev PRO v2.5.3 r190 (Protected Build) */
import { RU } from '../i18n/ru.js?v=2.5.3';
export function formatLocalYYYYMMDD(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
export function fmtHM(floatHr) {
  const h = Math.floor(floatHr);
  const m = Math.round((floatHr - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
export function fmtTemp(t) {
  const n = Math.round(t * 10) / 10;
  return `${n > 0 ? '+' + n : n}°C`;
}
export function fmtDeltaPress(dp) {
  const n = Math.round(dp * 10) / 10;
  if (n > 0.4) return `↑ +${n} мм`;
  if (n < -0.4) return `↓ ${n} мм`;
  return `→ ${n} мм`;
}
export function getRatingWord(score0to100) {
  if (score0to100 >= 76) return RU.ratingWords.excellent;
  if (score0to100 >= 55) return RU.ratingWords.good;
  if (score0to100 >= 35) return RU.ratingWords.moderate;
  if (score0to100 >= 12) return RU.ratingWords.weak;
  return RU.ratingWords.none;
}
export function pluralize(n, one, few, many) {
  const abs = Math.abs(n) % 100;
  const n1 = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (n1 > 1 && n1 < 5) return few;
  if (n1 === 1) return one;
  return many;
}
export function generateSpawnICS(fish, basinName, shiftWeeks = 0) {
  const year = new Date().getFullYear();
  const months = fish.spawnMonth && fish.spawnMonth.length ? fish.spawnMonth : [5];
  const startMonth = months[0];
  const endMonth = months[months.length - 1];
  const shiftDays = shiftWeeks * 7;
  const startDt = new Date(Date.UTC(year, startMonth - 1, 1 + shiftDays));
  const endDt = new Date(Date.UTC(year, endMonth, 1 + shiftDays));
  const fmtICSDate = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//KlevPRO 2.0//Ichthyology Calendar RU//RU',
    'BEGIN:VEVENT',
    `UID:spawn-${fish.id}-${year}@klevpro.local`,
    `DTSTAMP:${fmtICSDate(new Date())}T080000Z`,
    `DTSTART;VALUE=DATE:${fmtICSDate(startDt)}`,
    `DTEND;VALUE=DATE:${fmtICSDate(endDt)}`,
    `SUMMARY:Нерестовый период / Ограничение: ${fish.name}`,
    `DESCRIPTION:Бассейн: ${basinName}. Статус: ${fish.banMonths}. Региональный сдвиг: ${shiftWeeks > 0 ? '+' + shiftWeeks : shiftWeeks} нед.`,
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
}
