const MONTHS_SHORT = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
const DAYS_SHORT = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];

function toDate(dt) {
  if (dt instanceof Date) return dt;
  if (typeof dt === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dt)) {
    return new Date(dt.length === 10 ? dt + 'T00:00:00' : dt);
  }
  return new Date(dt);
}

export const fmt = {
  dateShort: (dt) => { const d = toDate(dt); return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`; },
  weekdayDate: (dt) => {
    const d = toDate(dt);
    return `${DAYS_SHORT[d.getDay()]}, ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
  },
  weekday: (dt) => DAYS_SHORT[toDate(dt).getDay()],
  time: (h) => {
    const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  },
  hour: (h) => `${String(h).padStart(2, '0')}:00`,
  temp: (t) => (t == null || isNaN(t)) ? '—' : `${t > 0 ? '+' : ''}${Math.round(t)}°`,
  tempC: (t) => `${fmt.temp(t)}C`,
  pressure: (p, delta) => {
    if (p == null) return '—';
    const base = `${Math.round(p)} мм`;
    if (delta == null) return base;
    const arrow = delta > 1 ? '↑' : delta < -1 ? '↓' : '→';
    const sign = delta > 0 ? '+' : '';
    return `${base} ${arrow}${sign}${Math.round(delta)}`;
  },
  wind: (dir, speed) => speed == null ? '—' : `${dir || ''} ${Math.round(speed)} м/с`.trim(),
  yyyymmdd: (dt) => {
    const d = toDate(dt);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },
  plural: (n, one, few, many) => {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }
};