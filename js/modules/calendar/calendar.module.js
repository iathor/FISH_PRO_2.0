import { RU } from '../../i18n/ru.js?v=2.5.0';
import { store } from '../../core/store.js?v=2.5.0';
import { generateSpawnICS } from '../../core/format.js?v=2.5.0';
import { BASIN_CONFIGS, getSpotEcoregion, isSpeciesInGeoRange } from '../../data/basins.js?v=2.5.0';
import { FISH_DB } from '../../data/species.js?v=2.5.0';
import { showToast } from '../../ui/components.js?v=2.5.0';

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
    <div class="bento-metrics-grid" style="margin-bottom:12px;">
      <div class="bento-metric-tile">
        <div class="bento-metric-label"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M17 3C11 3 5 7 5 15c0 2.5 1.5 4 4 4 8 0 12-6 12-12 0-2.5-1.5-4-4-4z" fill="rgba(16,185,129,0.25)" stroke="#10b981" stroke-width="1.8"/><path d="M5 19L15 9" stroke="#10b981" stroke-width="1.8" stroke-linecap="round"/></svg> Период нереста</div>
        <div class="bento-metric-val" style="color:#f43f5e;">${spawnText}</div>
      </div>
      <div class="bento-metric-tile">
        <div class="bento-metric-label"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3v18M5 7h14M5 7l-3 6h6l-3-6zm14 0l-3 6h6l-3-6zM8 21h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Правовой статус</div>
        <div class="bento-metric-val" style="font-size:14px;color:${fish.legal === 'redbook' ? 'var(--bad)' : 'var(--warn)'};">${fish.banMonths}</div>
      </div>
      <div class="bento-metric-tile">
        <div class="bento-metric-label"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2c1.5 3.5 4.5 5.5 4.5 10a5.5 5.5 0 1 1-11 0c0-3 2-5.5 3.5-7 0 2 1.5 3 1.5 3S12 5.5 12 2z" fill="#f97316" stroke="#fbbf24" stroke-width="1.5" stroke-linejoin="round"/></svg> Пик годового клёва</div>
        <div class="bento-metric-val" style="color:var(--good);">${bestMonths}</div>
      </div>
      <div class="bento-metric-tile">
        <div class="bento-metric-label"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg> Рабочий горизонт</div>
        <div class="bento-metric-val" style="color:var(--accent);">${fish.depthOpt[0]}–${fish.depthOpt[1]} м <span style="font-size:11px;color:var(--muted);">(до ${fish.depthMax} м)</span></div>
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
      <svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" fill="rgba(56,189,248,0.18)" stroke="#38bdf8" stroke-width="1.8"/><path d="M12 11v5M12 8h.01" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg> <b>Формирование списка:</b> в выборке представлены только виды, обитающие в вашем регионе ловли (<b>${s.basinName}</b>) и разрешённые к любительскому вылову. Красная книга исключена из сравнения.
    </div>

    <div style="margin-bottom:10px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
      <span style="font-size:var(--fs-xs);color:var(--muted);font-weight:700;">Сравнить до 3 видов рыб:</span>
      ${(() => {
        const ecoreg = getSpotEcoregion(s.lat, s.lon, s.basinCode, s.water, s.selectedWaterName);
        const sigMap = new Map((ecoreg.signatureSpecies || []).map((id, i) => [id, i]));
        const rTypes = new Set((s.nearbyWaters || []).map(w => w.wType).concat([s.water]));
        return FISH_DB
          .filter(f => f.legal !== 'redbook' && isSpeciesInGeoRange(f, s.lat, s.lon, s.basinCode, s.water, s.waterRadiusKm || 50, rTypes, s.isCoastal, rTypes.has('cooling_reservoir'), s.selectedWaterName))
          .sort((a, b) => (sigMap.has(a.id) ? sigMap.get(a.id) : 999) - (sigMap.has(b.id) ? sigMap.get(b.id) : 999))
          .slice(0, 16);
      })().map(f => {
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
            <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3c0 0-6 7.1-6 11.5a6 6 0 0 0 12 0C18 10.1 12 3 12 3z" fill="rgba(56,189,248,0.32)" stroke="#38bdf8" stroke-width="1.8"/><path d="M9.5 15.5c.5 1.2 1.7 2 3 2" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg> Вода: ${c.fish.tWaterOpt[0]}–${c.fish.tWaterOpt[1]}°C • <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M17 3C11 3 5 7 5 15c0 2.5 1.5 4 4 4 8 0 12-6 12-12 0-2.5-1.5-4-4-4z" fill="rgba(16,185,129,0.25)" stroke="#10b981" stroke-width="1.8"/><path d="M5 19L15 9" stroke="#10b981" stroke-width="1.8" stroke-linecap="round"/></svg> Нерест: ${(c.spawnMonths || []).map(m => RU.monthsShort[m - 1]).join(', ') || 'нет'}
          </div>
        </div>
      `).join('')}
    </div>

    <div class="month-grid">
      ${RU.monthsShort.map((mName, idx) => {
        const isJointPeak = compared.length >= 2 && compared.every(c => c.monthActivity[idx] >= 2 && !c.spawnMonths.includes(idx + 1));
        return `
          <div class="month-cell ${idx === curMonth ? 'current' : ''}" style="${isJointPeak ? 'border-color:var(--good);background:rgba(16,185,129,0.08);' : ''}">
            <span style="font-weight:800;font-size:var(--fs-xs);">${mName} ${isJointPeak ? '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2c1.5 3.5 4.5 5.5 4.5 10a5.5 5.5 0 1 1-11 0c0-3 2-5.5 3.5-7 0 2 1.5 3 1.5 3S12 5.5 12 2z" fill="#f97316" stroke="#fbbf24" stroke-width="1.5" stroke-linejoin="round"/></svg>' : ''}</span>
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
      <span><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2c1.5 3.5 4.5 5.5 4.5 10a5.5 5.5 0 1 1-11 0c0-3 2-5.5 3.5-7 0 2 1.5 3 1.5 3S12 5.5 12 2z" fill="#f97316" stroke="#fbbf24" stroke-width="1.5" stroke-linejoin="round"/></svg> <b>Общий жор</b> — месяцы совпадения высокой кормовой активности всех выбранных видов</span>
    </div>
  `;

  container.innerHTML = `
    <div class="card">
      <div class="section-head">
        <div>
          <span class="section-title"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="16" rx="3" fill="rgba(56,189,248,0.14)" stroke="currentColor" stroke-width="1.8"/><path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><rect x="7" y="13" width="3" height="3" rx="0.8" fill="#38bdf8"/><rect x="14" y="13" width="3" height="3" rx="0.8" fill="#10b981"/></svg> Годовой биологический календарь${s.calendarMode === 'compare' ? ' (Сравнение видов)' : ': ' + fish.name}</span>
          <div style="font-size:var(--fs-xs);color:var(--accent);font-weight:700;margin-top:2px;">${info.shiftNote}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" class="btn btn-sm ${s.calendarMode === 'single' ? 'btn-accent' : ''}" data-cal-mode="single">Одна рыба</button>
          <button type="button" class="btn btn-sm ${s.calendarMode === 'compare' ? 'btn-accent' : ''}" data-cal-mode="compare">Сравнить 2–3 вида</button>
          ${s.calendarMode === 'single' ? `<button type="button" class="btn btn-sm" id="calExportIcsBtn"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg> Скачать .ics (Нерест)</button>` : ''}
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
      downloadFileCrossPlatform(`spawn-${info.fish.id}-${s.basinCode}.ics`, icsText, 'text/calendar;charset=utf-8');
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
      route: s.route,
      fishId: s.fishId,
      basinCode: s.basinCode,
      calendarMode: s.calendarMode,
      compareSpeciesIds: s.compareSpeciesIds
    }),
    (next) => {
      if (next.route && next.route !== 'calendar') {
        if (container) container._calNeedsRender = true;
        return;
      }
      if (container) container._calNeedsRender = false;
      render(container);
    }
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
