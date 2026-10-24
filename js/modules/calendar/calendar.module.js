import { RU } from '../../i18n/ru.js?v=2.0.162';
import { store } from '../../core/store.js?v=2.0.162';
import { generateSpawnICS } from '../../core/format.js?v=2.0.162';
import { BASIN_CONFIGS } from '../../data/basins.js?v=2.0.162';
import { FISH_DB } from '../../data/species.js?v=2.0.162';
import { showToast } from '../../ui/components.js?v=2.0.162';

const COMPARE_COLORS = ['#10b981', '#38bdf8', '#a855f7'];

export function getSpawnWindows(fishId, basinCode) {
  const fish = FISH_DB.find(f => f.id === fishId) || FISH_DB[0];
  const shiftWeeks = BASIN_CONFIGS[basinCode]?.spawnShiftWeeks || 0;
  const baseMonths = fish.spawnMonth || [];
  const shiftNote = shiftWeeks === 0
    ? 'Базовый (без региональной поправки)'
    : `Региональная поправка бассейна: ${shiftWeeks > 0 ? '+' + shiftWeeks : shiftWeeks} нед.`;

  const monthShift = shiftWeeks >= 2 ? 1 : (shiftWeeks <= -2 ? -1 : 0);
  const shiftedSpawn = baseMonths.map(m => {
    const next = ((m - 1 + monthShift) % 12 + 12) % 12 + 1;
    return next;
  });

  const shiftedActivity = fish.monthActivity.map((_, idx) => {
    const srcIdx = ((idx - monthShift) % 12 + 12) % 12;
    return fish.monthActivity[srcIdx];
  });

  return {
    fish,
    shiftWeeks,
    shiftNote,
    spawnMonths: shiftedSpawn,
    monthActivity: shiftedActivity
  };
}

export function compareSpecies(ids) {
  const s = store.getState();
  const validIds = (ids && ids.length ? ids : s.compareSpeciesIds).slice(0, 3);
  return validIds.map((id, idx) => ({
    ...getSpawnWindows(id, s.basinCode),
    color: COMPARE_COLORS[idx % COMPARE_COLORS.length]
  }));
}

export function renderCalendar(container, fishId) {
  if (!container) return;
  const prevMonthScroll = container.querySelector('.month-grid')?.scrollLeft || 0;
  const s = store.getState();
  const targetId = fishId || s.fishId || 'pike';
  const info = getSpawnWindows(targetId, s.basinCode);
  const fish = info.fish;
  const curMonth = new Date().getMonth();

  const maxAct = Math.max(...info.monthActivity);
  const bestMonths = (maxAct > 0
        ? info.monthActivity.map((v, i) => v === maxAct ? RU.monthsShort[i] : null).filter(Boolean).join(', ')
        : 'Круглогодично');
  const spawnText = info.spawnMonths.length
    ? info.spawnMonths.map(m => RU.monthsShort[m - 1]).join(' — ')
    : 'Не выражен';

  const singleHtml = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin-bottom:12px;">
      <div class="card" style="background:var(--card);padding:10px 12px;">
        <div style="font-size:var(--fs-xs);color:var(--muted);font-weight:700;">ПЕРИОД НЕРЕСТА</div>
        <div style="font-size:var(--fs-md);font-weight:800;color:#f43f5e;margin-top:2px;">${spawnText}</div>
      </div>
      <div class="card" style="background:var(--card);padding:10px 12px;">
        <div style="font-size:var(--fs-xs);color:var(--muted);font-weight:700;">ПРАВОВОЙ СТАТУС</div>
        <div style="font-size:var(--fs-sm);font-weight:800;color:${fish.legal === 'redbook' ? 'var(--bad)' : 'var(--warn)'};margin-top:2px;">${fish.banMonths}</div>
      </div>
      <div class="card" style="background:var(--card);padding:10px 12px;">
        <div style="font-size:var(--fs-xs);color:var(--muted);font-weight:700;">СЕЗОН МАКСИМАЛЬНОГО КЛЁВА</div>
        <div style="font-size:var(--fs-md);font-weight:800;color:var(--good);margin-top:2px;">${bestMonths}</div>
      </div>
      <div class="card" style="background:var(--card);padding:10px 12px;">
        <div style="font-size:var(--fs-xs);color:var(--muted);font-weight:700;">РАБОЧИЙ ГОРИЗОНТ ГЛУБИН</div>
        <div style="font-size:var(--fs-md);font-weight:800;color:var(--accent);margin-top:2px;">${fish.depthOpt[0]}–${fish.depthOpt[1]} м (макс. ${fish.depthMax} м)</div>
      </div>
    </div>

    <div class="month-grid">
      ${RU.monthsShort.map((mName, idx) => {
        const act = info.monthActivity[idx];
        const isSpawn = info.spawnMonths.includes(idx + 1);
        let bg = 'var(--border)';
        let label = 'Спад';
        if (isSpawn) { bg = '#e11d48'; label = 'Нерест'; }
        else if (act === 3) { bg = 'var(--good)'; label = 'Жор'; }
        else if (act === 2) { bg = 'var(--warn)'; label = 'Клёв'; }
        else if (act === 1) { bg = '#64748b'; label = 'Слабо'; }
        return `
          <div class="month-cell ${idx === curMonth ? 'current' : ''}">
            <span style="font-weight:800;font-size:var(--fs-xs);">${mName}</span>
            <div style="height:10px;border-radius:4px;background:${bg};"></div>
            <span style="font-size:var(--fs-xs);color:var(--muted);font-weight:700;">${label}</span>
          </div>
        `;
      }).join('')}
    </div>
  `;

  const compared = compareSpecies(s.compareSpeciesIds);
  const compareHtml = `
    <!-- Пояснение формирования списка видов (Point 5) -->
    <div style="padding:8px 10px;background:var(--card);border-radius:var(--r-sm);margin-bottom:10px;font-size:var(--fs-xs);color:var(--muted);">
      ℹ️ <b>Формирование списка:</b> в выборке представлены только виды, обитающие в вашем регионе ловли (<b>${s.basinName}</b>) и разрешённые к любительскому вылову. Красная книга исключена из сравнения.
    </div>

    <div style="margin-bottom:10px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
      <span style="font-size:var(--fs-xs);color:var(--muted);font-weight:700;">Сравнить до 3 видов рыб:</span>
      ${FISH_DB.filter(f => f.basins.includes(s.basinCode) && f.legal !== 'redbook').slice(0, 16).map(f => {
        const active = s.compareSpeciesIds.includes(f.id);
        return `<button type="button" class="btn btn-sm ${active ? 'btn-accent' : ''}" data-cal-cmp="${f.id}">${f.name}</button>`;
      }).join('')}
    </div>

    <!-- Адаптивная легенда сравниваемых видов -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:8px;margin-bottom:10px;">
      ${compared.map(c => `
        <div style="padding:8px 10px;background:var(--card);border-left:4px solid ${c.color};border-radius:4px;font-size:var(--fs-xs);">
          <div style="font-weight:800;font-size:var(--fs-sm);color:${c.color};">${c.fish.name}</div>
          <div style="color:var(--muted);margin-top:2px;">
            💧 Вода: ${c.fish.tWaterOpt[0]}–${c.fish.tWaterOpt[1]}°C • 🌿 Нерест: ${(c.spawnMonths || []).map(m => RU.monthsShort[m - 1]).join(', ') || 'нет'}
          </div>
        </div>
      `).join('')}
    </div>

    <div class="month-grid">
      ${RU.monthsShort.map((mName, idx) => {
        const isJointPeak = compared.length >= 2 && compared.every(c => c.monthActivity[idx] >= 2 && !c.spawnMonths.includes(idx + 1));
        return `
          <div class="month-cell ${idx === curMonth ? 'current' : ''}" style="${isJointPeak ? 'border-color:var(--good);background:rgba(16,185,129,0.08);' : ''}">
            <span style="font-weight:800;font-size:var(--fs-xs);">${mName} ${isJointPeak ? '🔥' : ''}</span>
            <div style="display:flex;flex-direction:column;gap:3px;margin:4px 0;">
              ${compared.map(c => {
                const act = c.monthActivity[idx];
                const isSpawn = c.spawnMonths.includes(idx + 1);
                const hPct = isSpawn ? 25 : (act === 3 ? 100 : (act === 2 ? 70 : (act === 1 ? 40 : 15)));
                const barColor = isSpawn ? '#e11d48' : c.color;
                return `<div title="${c.fish.name}: ${isSpawn ? 'Нерест' : act + '/3'}" style="height:7px;width:${hPct}%;background:${barColor};border-radius:3px;"></div>`;
              }).join('')}
            </div>
            <span style="font-size:12px;color:${isJointPeak ? 'var(--good)' : 'var(--muted)'};font-weight:${isJointPeak ? '800' : '500'};">${isJointPeak ? 'Общий жор' : ''}</span>
          </div>
        `;
      }).join('')}
    </div>

    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:10px;font-size:var(--fs-xs);color:var(--muted);padding-top:6px;border-top:1px solid var(--border);">
      <span>🔥 <b>Общий жор</b> — месяцы совпадения высокой кормовой активности всех выбранных видов</span>
    </div>
  `;

  container.innerHTML = `
    <div class="card">
      <div class="section-head">
        <div>
          <span class="section-title">📅 Годовой биологический календарь${s.calendarMode === 'compare' ? ' (Сравнение видов)' : ': ' + fish.name}</span>
          <div style="font-size:var(--fs-xs);color:var(--accent);font-weight:700;margin-top:2px;">${info.shiftNote}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" class="btn btn-sm ${s.calendarMode === 'single' ? 'btn-accent' : ''}" data-cal-mode="single">Одна рыба</button>
          <button type="button" class="btn btn-sm ${s.calendarMode === 'compare' ? 'btn-accent' : ''}" data-cal-mode="compare">Сравнить 2–3 вида</button>
          ${s.calendarMode === 'single' ? `<button type="button" class="btn btn-sm" id="calExportIcsBtn">📥 Скачать .ics (Нерест)</button>` : ''}
        </div>
      </div>

      ${s.calendarMode === 'compare' ? compareHtml : singleHtml}

      ${s.calendarMode === 'single' ? `
        <div style="margin-top:12px;padding-top:8px;border-top:1px solid var(--border);font-size:var(--fs-xs);color:var(--muted);display:flex;gap:14px;flex-wrap:wrap;">
          <span><b style="color:var(--good);">■</b> Жор (пик активности)</span>
          <span><b style="color:var(--warn);">■</b> Клёв (умеренное питание)</span>
          <span><b style="color:#64748b;">■</b> Слабо (зимовка)</span>
          <span><b style="color:var(--border);">■</b> Спад (оцепенение)</span>
          <span><b style="color:#e11d48;">■</b> Нерест / Сезонный запрет</span>
        </div>
      ` : ''}
    </div>
  `;

  bindCalendarEvents(container, info);
  if (prevMonthScroll > 0) {
    const mg = container.querySelector('.month-grid');
    if (mg) mg.scrollLeft = prevMonthScroll;
  }
}

function bindCalendarEvents(container, info) {
  container.querySelectorAll('[data-cal-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      store.dispatch({ type: 'SET_CALENDAR_MODE', payload: btn.getAttribute('data-cal-mode') });
    });
  });

  container.querySelectorAll('[data-cal-cmp]').forEach(btn => {
    btn.addEventListener('click', () => {
      store.dispatch({ type: 'TOGGLE_COMPARE_SPECIES', payload: btn.getAttribute('data-cal-cmp') });
    });
  });

  const icsBtn = container.querySelector('#calExportIcsBtn');
  if (icsBtn) {
    icsBtn.addEventListener('click', () => {
      const s = store.getState();
      const icsText = generateSpawnICS(info.fish, s.basinName, info.shiftWeeks);
      const blob = new Blob([icsText], { type: 'text/calendar;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `spawn-${info.fish.id}-${s.basinCode}.ics`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast(`Календарь нереста (${info.fish.name}) выгружен в .ics`, 'good');
    });
  }
}

export function render(container) {
  renderCalendar(container, store.getState().fishId);
}

let unsub = null;
export function init(container) {
  render(container);
  unsub = store.subscribe(
    s => ({
      fishId: s.fishId,
      basinCode: s.basinCode,
      calendarMode: s.calendarMode,
      compareSpeciesIds: s.compareSpeciesIds
    }),
    () => render(container)
  );
}

export function destroy() {
  if (unsub) unsub();
}

export const calendarModule = {
  getSpawnWindows,
  compareSpecies,
  renderCalendar,
  init,
  render,
  destroy
};
