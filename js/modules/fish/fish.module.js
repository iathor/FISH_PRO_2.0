import { store } from '../../core/store.js';
import { events } from '../../core/events.js';
import { FISH_DB } from '../../data/fish-db.js';
import { RU } from '../../i18n/ru.js';
import { renderFishVisual, renderFiveFish } from '../../ui/icons.js';
import { createPill, openModal, closeModal, showToast } from '../../ui/components.js';
import { calcDayBest } from '../forecast/forecast.module.js';
import { WATER_PROFILES, getAvailableWaterTypes } from '../../data/water-profiles.js';
import { getCompatibleMethods } from '../../data/constants.js';
import { RUSSIA_CITIES } from '../../data/russia-waters.js';
import { detectBasinByCoords, isCoastalInBasin, BASIN_CONFIGS } from '../../data/basin-configs.js';
import { setLocation } from '../geo/geo.module.js';
let searchDebounceTimer = null;

export function pickBestDefaultFish(regionalList) {
  const list = regionalList && regionalList.length ? regionalList : FISH_DB;
  const curMonth = new Date().getMonth();
  const sorted = [...list]
    .filter(f => f.legal !== 'redbook')
    .sort((a, b) => (b.monthActivity[curMonth] || 0) - (a.monthActivity[curMonth] || 0));
  return sorted[0]?.id || list[0]?.id || 'pike';
}

export function getFilteredFishList(state) {
  const s = state || store.getState();
  // Regional fauna check: Caucasian Black Sea mountain streams (Sochi, Mzymta, Matsesta)
  const isCaucasianMountainStream = s.basinCode === 'black_azov' &&
    s.lat <= 44.6 && s.lat >= 43.3 && s.lon >= 38.5 && s.lon <= 40.5 &&
    (s.water === 'small_river' || (s.selectedWaterName || '').toLowerCase().includes('мзымта'));

  let list = s.showAllSpecies
    ? [...FISH_DB]
    : FISH_DB.filter(f => {
        const basinMatch = f.basins.includes(s.basinCode);
        let waterMatch = !f.waters || f.waters.includes(s.water);
        if (!waterMatch && (s.water === 'tundra_lake' || s.water === 'quarry') && ['crucian', 'carp', 'silver_carp', 'grass_carp', 'perch', 'pike', 'roach', 'bream'].includes(f.id)) {
          waterMatch = true;
        }
        if (f.legal === 'introduced' && s.water !== 'cooling_reservoir' && s.water !== 'quarry') {
          if (!['carp', 'silver_carp', 'grass_carp'].includes(f.id)) return false;
        }
        // In rapid Caucasian mountain rivers (Mzymta, etc.), pike, perch and zander do not live; trout, chub, barbel, goby dominate
        if (isCaucasianMountainStream && ['pike', 'perch', 'zander', 'bream'].includes(f.id)) {
          return false;
        }
        return basinMatch && waterMatch;
      });

  if (s.onlyFavoritesFilter) {
    const favSet = new Set(s.favorites || []);
    list = list.filter(f => favSet.has(f.id));
  }

  if (s.fishGroup && s.fishGroup !== 'all') {
    list = list.filter(f => f.group === s.fishGroup);
  }

  const q = (s.fishSearch || '').trim().toLowerCase();
  if (q) {
    list = list.filter(f => f.name.toLowerCase().includes(q) || (f.latin || '').toLowerCase().includes(q));
  }

  const favSet = new Set(s.favorites || []);
  list.sort((a, b) => {
    const aFav = favSet.has(a.id) ? 1 : 0;
    const bFav = favSet.has(b.id) ? 1 : 0;
    return bFav - aFav;
  });

  return list;
}

export function openFishDetail(fishId) {
  const f = FISH_DB.find(x => x.id === fishId);
  if (!f) return;
  const isRed = f.legal === 'redbook';
  const spawnMonthsText = (f.spawnMonth || []).map(m => RU.monthsShort[m - 1]).join(', ') || 'По прогреву воды';

  const html = `
    <div style="display:flex;flex-direction:column;gap:12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:12px;">
          <div style="width:105px;height:50px;">${renderFishVisual(f)}</div>
          <div>
            <div style="font-size:var(--fs-lg);font-weight:800;">${f.name}</div>
            <div style="font-size:var(--fs-xs);color:var(--muted);font-style:italic;">${f.latin || ''}</div>
            <div style="margin-top:4px;">
              ${isRed
                ? createPill({ text: 'Красная книга • Вылов запрещён', tone: 'bad' })
                : (f.legal === 'license'
                    ? createPill({ text: 'По путёвке / Лицензионный вид', tone: 'warn' })
                    : (f.legal === 'introduced'
                        ? createPill({ text: 'Вселенец / Товарное рыбоводство', tone: 'purple' })
                        : createPill({ text: 'Свободный любительский лов', tone: 'good' })))}
            </div>
          </div>
        </div>
        ${!isRed ? `<button type="button" class="btn btn-good" id="detailCatchFishBtn">🎣 Я поймал (${f.name})</button>` : ''}
      </div>

      ${isRed ? `
        <div style="padding:12px;border-radius:var(--r-sm);background:var(--pill-bad-bg);color:var(--pill-bad-text);font-size:var(--fs-sm);font-weight:700;">
          ⚠️ <b>Памятка рыбаку (охрана биоресурсов):</b><br>
          ${RU.redbookLaw}
        </div>
      ` : ''}

      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;font-size:var(--fs-sm);">
        <div class="card" style="background:var(--card);padding:10px;">
          <div style="font-size:var(--fs-xs);color:var(--muted);">Оптимальная температура воды</div>
          <div style="font-weight:800;margin-top:2px;">${f.tWaterOpt[0]}–${f.tWaterOpt[1]} °C (оцепенение при ${f.tMinStop} °C)</div>
        </div>
        <div class="card" style="background:var(--card);padding:10px;">
          <div style="font-size:var(--fs-xs);color:var(--muted);">Рабочая глубина стоянки</div>
          <div style="font-weight:800;margin-top:2px;">${f.depthOpt[0]}–${f.depthOpt[1]} м (до ${f.depthMax} м)</div>
        </div>
        <div class="card" style="background:var(--card);padding:10px;">
          <div style="font-size:var(--fs-xs);color:var(--muted);">Сроки нереста</div>
          <div style="font-weight:800;margin-top:2px;">${spawnMonthsText}</div>
        </div>
        <div class="card" style="background:var(--card);padding:10px;">
          <div style="font-size:var(--fs-xs);color:var(--muted);">Правила рыболовства</div>
          <div style="font-weight:800;margin-top:2px;">${f.banMonths}</div>
        </div>
      </div>

      <div class="card" style="background:var(--card);padding:12px;font-size:var(--fs-sm);">
        <div><b>Места стоянки и повадки:</b> ${f.baseAdvice}</div>
        <div style="margin-top:6px;"><b>Рекомендуемые снасти и насадки:</b> ${f.topGear}</div>
      </div>
    </div>
  `;

  openModal(`Справка ихтиолога: ${f.name}`, html, (bodyEl) => {
    const catchBtn = bodyEl.querySelector('#detailCatchFishBtn');
    if (catchBtn) {
      catchBtn.addEventListener('click', () => {
        store.dispatch({ type: 'SET_FISH', payload: f.id });
        closeModal();
        const st = store.getState();
        events.emit('forecast:hourSelected', { dayIdx: st.dayIdx, hour: st.selectedHour, fishId: f.id });
      });
    }
  });
}

export function openFavoritesEditorModal() {
  const s = store.getState();
  const favSet = new Set(s.favorites || []);
  const regional = FISH_DB.filter(f => f.basins.includes(s.basinCode));

  // Pinned favorites at top, then alphabetized
  const sorted = [...regional].sort((a, b) => {
    const aFav = favSet.has(a.id) ? 1 : 0;
    const bFav = favSet.has(b.id) ? 1 : 0;
    if (aFav !== bFav) return bFav - aFav;
    return a.name.localeCompare(b.name, 'ru');
  });

  const html = `
    <div style="display:flex;flex-direction:column;gap:10px;font-size:var(--fs-sm);">
      <p style="color:var(--muted);font-size:var(--fs-xs);">
        Отметьте целевые виды рыб. Избранные виды закрепляются первыми в ленте и при записи улова.
      </p>

      <input type="search" id="favModalSearch" class="input" placeholder="🔍 Быстрый поиск рыбы (щука, судак, окунь, чир...)" style="min-height:36px;padding:6px 10px;font-size:var(--fs-xs);">

      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button type="button" class="btn btn-sm ${s.onlyFavoritesFilter ? 'btn-accent' : ''}" id="favModalToggleFilterBtn">
          ${s.onlyFavoritesFilter ? '✅ Включён фильтр «Только избранные»' : '🔍 Показать на ленте только избранные'}
        </button>
      </div>

      <div id="favModalList" style="max-height:320px;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:6px;padding:4px 0;">
        ${sorted.map(f => {
          const checked = favSet.has(f.id);
          return `
            <label class="fav-item-label" data-fav-id="${f.id}" data-fav-name="${f.name.toLowerCase()} ${(f.latin || '').toLowerCase()}" style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--card);border:1px solid ${checked ? 'var(--accent)' : 'var(--border)'};border-radius:var(--r-sm);cursor:pointer;font-size:var(--fs-xs);font-weight:700;">
              <input type="checkbox" value="${f.id}" class="fav-edit-chk" ${checked ? 'checked' : ''}>
              <span>${checked ? '⭐ ' : ''}${f.name}</span>
            </label>
          `;
        }).join('')}
      </div>

      <button type="button" class="btn btn-accent" id="favModalSaveBtn">💾 Сохранить список избранного</button>
    </div>
  `;

  openModal('⭐ Избранные виды рыб', html, (bodyEl) => {
    const searchInput = bodyEl.querySelector('#favModalSearch');
    const items = bodyEl.querySelectorAll('.fav-item-label');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const query = (e.target.value || '').trim().toLowerCase();
        items.forEach(el => {
          const name = el.getAttribute('data-fav-name') || '';
          el.style.display = (!query || name.includes(query)) ? 'flex' : 'none';
        });
      });
    }

    const filterBtn = bodyEl.querySelector('#favModalToggleFilterBtn');
    if (filterBtn) {
      filterBtn.addEventListener('click', () => {
        store.dispatch({ type: 'TOGGLE_ONLY_FAVORITES' });
        closeModal();
      });
    }

    const saveBtn = bodyEl.querySelector('#favModalSaveBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        const selected = Array.from(bodyEl.querySelectorAll('.fav-edit-chk:checked')).map(el => el.value);
        store.dispatch({ type: 'SET_FAVORITES_LIST', payload: selected });
        closeModal();
        showToast(`Список избранного обновлён (${selected.length} видов)`, 'good');
      });
    }
  });
}

export function openOnboardingModal(isEditMode = false) {
  const s = store.getState();
  let currentLat = s.lat;
  let currentLon = s.lon;
  let currentBasin = s.basinCode || 'arctic_ob_taz';
  let currentCityName = s.locLabel || s.locAdmin2 || 'Москва';

  // Multi-select state:
  const selectedWaters = new Set(
    (s.userProfile?.preferredWaters && s.userProfile.preferredWaters.length)
      ? s.userProfile.preferredWaters
      : [s.water || 'small_river']
  );

  const selectedMethods = new Set(
    (s.userProfile?.preferredMethods && s.userProfile.preferredMethods.length)
      ? s.userProfile.preferredMethods
      : [s.method || 'spin_micro']
  );

  const selectedFishes = new Set(
    isEditMode ? (s.favorites || []) : []
  );

  const TACKLE_OPTIONS = [
    { val: 'spin_micro', text: '🎣 Спиннинг ультралайт (микроджиг / мормышинг)' },
    { val: 'spin_jig', text: '🎣 Спиннинг джиговый (средний и тяжёлый)' },
    { val: 'spin_lure', text: '🎣 Спиннинг: блёсны и воблеры (твичинг / равномерка)' },
    { val: 'bottom', text: '🪵 Донная снасть (фидер / пикер / кормушка)' },
    { val: 'float', text: '🪶 Поплавочная удочка (маховая / матчевая)' },
    { val: 'winter_jig', text: '❄️ Зимняя мормышка / безмотылка' },
    { val: 'winter_lure', text: '❄️ Зимнее блеснение (балансир / виб)' },
    { val: 'fly', text: '🪰 Нахлыст (ловля на мушку)' },
    { val: 'sea_rock', text: '⚓ Морской рокфишинг / прибрежный джиг' }
  ];

  function getModalBodyHtml() {
    const availWaters = getAvailableWaterTypes(currentBasin, currentLat, currentLon);
    const regionalSpecies = FISH_DB.filter(f => f.basins.includes(currentBasin) && f.legal !== 'redbook');
    const isSeaCoastal = isCoastalInBasin(currentBasin, currentLat, currentLon);

    return `
      <div style="display:flex;flex-direction:column;gap:13px;font-size:var(--fs-sm);">
        <div style="padding:10px 12px;background:rgba(56,189,248,0.12);border:1px solid var(--accent);border-radius:var(--r-sm);">
          <div style="font-weight:800;font-size:var(--fs-md);color:var(--accent);">
            ${isEditMode ? '👤 Профиль рыболова' : '👋 Добро пожаловать в «Клёв ПРО 2.0»!'}
          </div>
          <div style="font-size:var(--fs-xs);color:var(--muted);margin-top:3px;line-height:1.4;">
            ${isEditMode
              ? 'Настройте домашний регион, предпочитаемые биотопы, снасти и целевую рыбу.'
              : 'Укажите ваш регион и рыболовные предпочтения для точного персонального расчёта прогноза.'}
          </div>
        </div>

        <!-- ШАГ 1: ЛОКАЦИЯ И РЕГИОН -->
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <label style="font-weight:800;font-size:var(--fs-xs);color:var(--muted);">ШАГ 1. ВАШ ГОРОД / РЕГИОН ЛОВЛИ</label>
            <button type="button" class="btn btn-sm" id="onbGpsBtn" style="min-height:26px;padding:2px 8px;font-size:10px;">🎯 Мой GPS</button>
          </div>
          <select id="onbCitySelect" style="width:100%;">
            ${RUSSIA_CITIES.map(c => `
              <option value="${c.lat},${c.lon},${c.name},${c.admin1}" ${(c.name === currentCityName || c.name === s.locLabel) ? 'selected' : ''}>
                📍 ${c.name} (${c.admin1})
              </option>
            `).join('')}
          </select>
          <div id="onbLocHint" style="font-size:10px;color:var(--accent);margin-top:3px;font-weight:700;">
            Бассейн: ${BASIN_CONFIGS[currentBasin]?.name || 'РФ'} ${isSeaCoastal ? '• 🌊 Доступно морское побережье (Каспий/моря)' : '• 💧 Пресноводный бассейн'}
          </div>
        </div>

        <!-- ШАГ 2: ТИПЫ ВОДОЁМОВ (МНОЖЕСТВЕННЫЙ ВЫБОР) -->
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <label style="font-weight:800;font-size:var(--fs-xs);color:var(--muted);">ШАГ 2. ТИПЫ ВОДОЁМОВ (МНОЖЕСТВЕННЫЙ ВЫБОР)</label>
            <span style="font-size:10px;color:var(--accent);font-weight:700;">отмечено: <span id="onbWatersCount">${selectedWaters.size}</span></span>
          </div>
          <div id="onbWatersContainer" style="display:flex;flex-wrap:wrap;gap:6px;">
            ${availWaters.map(w => {
              const active = selectedWaters.has(w.id);
              return `<button type="button" class="w-chip ${active ? 'active' : ''}" data-onb-water="${w.id}">
                ${active ? '✓ ' : ''}${w.name}
              </button>`;
            }).join('')}
          </div>
        </div>

        <!-- ШАГ 3: СНАСТИ (МНОЖЕСТВЕННЫЙ ВЫБОР) -->
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <label style="font-weight:800;font-size:var(--fs-xs);color:var(--muted);">ШАГ 3. ВАШИ СНАСТИ (МНОЖЕСТВЕННЫЙ ВЫБОР)</label>
            <span style="font-size:10px;color:var(--accent);font-weight:700;">отмечено: <span id="onbMethodsCount">${selectedMethods.size}</span></span>
          </div>
          <div id="onbMethodsContainer" style="display:flex;flex-wrap:wrap;gap:6px;">
            ${TACKLE_OPTIONS.map(m => {
              const active = selectedMethods.has(m.val);
              return `<button type="button" class="w-chip ${active ? 'active' : ''}" data-onb-method="${m.val}">
                ${active ? '✓ ' : ''}${m.text}
              </button>`;
            }).join('')}
          </div>
        </div>

        <!-- ШАГ 4: ЦЕЛЕВЫЕ РЫБЫ -->
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;flex-wrap:wrap;gap:4px;">
            <label style="font-weight:800;font-size:var(--fs-xs);color:var(--muted);">ШАГ 4. ЦЕЛЕВЫЕ РЫБЫ (ВЫБЕРИТЕ ИЗ СПИСКА)</label>
            <button type="button" class="btn btn-sm btn-accent" id="onbSelectTypicalBtn" style="min-height:24px;padding:1px 8px;font-size:10px;">
              ✨ Выбрать характерные рыбы региона
            </button>
          </div>
          <div id="onbSpeciesChips" style="display:flex;flex-wrap:wrap;gap:6px;max-height:150px;overflow-y:auto;padding:4px 0;">
            ${regionalSpecies.map(f => {
              const active = selectedFishes.has(f.id);
              return `
                <button type="button" class="w-chip ${active ? 'active' : ''}" data-onb-fish="${f.id}" style="font-size:11px;">
                  ${active ? '⭐ ' : ''}${f.name}
                </button>
              `;
            }).join('')}
          </div>
        </div>

        <!-- КНОПКИ ВНИЗУ (Point 1: «Заполню позже» и «Сохранить профиль и перейти к прогнозу») -->
        <div style="display:flex;gap:8px;margin-top:6px;padding-top:10px;border-top:1px solid var(--border);">
          <button type="button" class="btn" id="onbLaterBtn" style="flex:1;">
            Заполню позже
          </button>
          <button type="button" class="btn btn-accent" id="onbSaveBtn" style="flex:2;">
            ${isEditMode ? '💾 Сохранить профиль' : 'Сохранить профиль и перейти к прогнозу'}
          </button>
        </div>
      </div>
    `;
  }

  // Initial onboarding removes top close button (Point 1)
  openModal(isEditMode ? '👤 Профиль рыболова' : '🚀 Стартовая настройка рыболова', getModalBodyHtml(), (bodyEl) => {
    function bindWaters(container) {
      container.querySelectorAll('[data-onb-water]').forEach(btn => {
        btn.addEventListener('click', () => {
          const wid = btn.getAttribute('data-onb-water');
          if (selectedWaters.has(wid)) {
            if (selectedWaters.size > 1) {
              selectedWaters.delete(wid);
              btn.classList.remove('active');
              btn.textContent = btn.textContent.replace('✓ ', '');
            } else {
              showToast('Должен быть выбран хотя бы один тип водоёма', 'warn');
            }
          } else {
            selectedWaters.add(wid);
            btn.classList.add('active');
            if (!btn.textContent.includes('✓')) btn.textContent = '✓ ' + btn.textContent.trim();
          }
          const cnt = bodyEl.querySelector('#onbWatersCount');
          if (cnt) cnt.textContent = selectedWaters.size;
        });
      });
    }

    function bindMethods(container) {
      container.querySelectorAll('[data-onb-method]').forEach(btn => {
        btn.addEventListener('click', () => {
          const mid = btn.getAttribute('data-onb-method');
          if (selectedMethods.has(mid)) {
            if (selectedMethods.size > 1) {
              selectedMethods.delete(mid);
              btn.classList.remove('active');
              btn.textContent = btn.textContent.replace('✓ ', '');
            } else {
              showToast('Должна быть выбрана хотя бы одна снасть', 'warn');
            }
          } else {
            selectedMethods.add(mid);
            btn.classList.add('active');
            if (!btn.textContent.includes('✓')) btn.textContent = '✓ ' + btn.textContent.trim();
          }
          const cnt = bodyEl.querySelector('#onbMethodsCount');
          if (cnt) cnt.textContent = selectedMethods.size;
        });
      });
    }

    function bindFishChips(container) {
      container.querySelectorAll('[data-onb-fish]').forEach(btn => {
        btn.addEventListener('click', () => {
          const fid = btn.getAttribute('data-onb-fish');
          if (selectedFishes.has(fid)) {
            selectedFishes.delete(fid);
            btn.classList.remove('active');
            btn.textContent = btn.textContent.replace('⭐ ', '');
          } else {
            selectedFishes.add(fid);
            btn.classList.add('active');
            if (!btn.textContent.includes('⭐')) btn.textContent = '⭐ ' + btn.textContent.trim();
          }
        });
      });
    }

    bindWaters(bodyEl.querySelector('#onbWatersContainer'));
    bindMethods(bodyEl.querySelector('#onbMethodsContainer'));
    bindFishChips(bodyEl.querySelector('#onbSpeciesChips'));

    // Select typical regional fish button
    const selectTypicalBtn = bodyEl.querySelector('#onbSelectTypicalBtn');
    if (selectTypicalBtn) {
      selectTypicalBtn.addEventListener('click', () => {
        const regionalSpecies = FISH_DB.filter(f => f.basins.includes(currentBasin) && f.legal !== 'redbook');
        const typical = regionalSpecies.slice(0, 6).map(f => f.id);
        selectedFishes.clear();
        typical.forEach(id => selectedFishes.add(id));
        const speciesContainer = bodyEl.querySelector('#onbSpeciesChips');
        if (speciesContainer) {
          speciesContainer.querySelectorAll('[data-onb-fish]').forEach(btn => {
            const fid = btn.getAttribute('data-onb-fish');
            const active = selectedFishes.has(fid);
            btn.classList.toggle('active', active);
            btn.textContent = (active ? '⭐ ' : '') + btn.textContent.replace('⭐ ', '').trim();
          });
        }
        showToast(`Выбрано ${typical.length} характерных видов региона`, 'good');
      });
    }

    // Dynamic re-render on city change (Point 1: Astrakhan/Caspian sea access!)
    const citySelect = bodyEl.querySelector('#onbCitySelect');
    if (citySelect) {
      citySelect.addEventListener('change', (e) => {
        const [latStr, lonStr, cName, cAdmin] = e.target.value.split(',');
        currentLat = parseFloat(latStr);
        currentLon = parseFloat(lonStr);
        currentCityName = cName;
        currentBasin = detectBasinByCoords(currentLat, currentLon);

        store.dispatch({
          type: 'SET_LOCATION_LABELS',
          payload: { locLabel: cName, locAdmin1: cAdmin, locAdmin2: cName }
        });
        setLocation(currentLat, currentLon, true);

        // Update locHint
        const isSeaCoastal = isCoastalInBasin(currentBasin, currentLat, currentLon);
        const hint = bodyEl.querySelector('#onbLocHint');
        if (hint) {
          hint.textContent = `Бассейн: ${BASIN_CONFIGS[currentBasin]?.name || 'РФ'} ${isSeaCoastal ? '• 🌊 Доступно морское побережье (Каспий/моря)' : '• 💧 Пресноводный бассейн'}`;
        }

        // Dynamically re-render water container
        const availWaters = getAvailableWaterTypes(currentBasin, currentLat, currentLon);
        const validWaterIds = new Set(availWaters.map(w => w.id));
        const filteredWaters = Array.from(selectedWaters).filter(w => validWaterIds.has(w));
        selectedWaters.clear();
        if (filteredWaters.length) {
          filteredWaters.forEach(w => selectedWaters.add(w));
        } else if (availWaters.length) {
          selectedWaters.add(availWaters[0].id);
        }

        const watersContainer = bodyEl.querySelector('#onbWatersContainer');
        if (watersContainer) {
          watersContainer.innerHTML = availWaters.map(w => {
            const active = selectedWaters.has(w.id);
            return `<button type="button" class="w-chip ${active ? 'active' : ''}" data-onb-water="${w.id}">
              ${active ? '✓ ' : ''}${w.name}
            </button>`;
          }).join('');
          bindWaters(watersContainer);
          const cnt = bodyEl.querySelector('#onbWatersCount');
          if (cnt) cnt.textContent = selectedWaters.size;
        }

        // Dynamically re-render regional fish species
        const regionalSpecies = FISH_DB.filter(f => f.basins.includes(currentBasin) && f.legal !== 'redbook');
        const speciesContainer = bodyEl.querySelector('#onbSpeciesChips');
        if (speciesContainer) {
          speciesContainer.innerHTML = regionalSpecies.map(f => {
            const active = selectedFishes.has(f.id);
            return `<button type="button" class="w-chip ${active ? 'active' : ''}" data-onb-fish="${f.id}" style="font-size:11px;">
              ${active ? '⭐ ' : ''}${f.name}
            </button>`;
          }).join('');
          bindFishChips(speciesContainer);
        }
      });
    }

    // GPS button
    const gpsBtn = bodyEl.querySelector('#onbGpsBtn');
    if (gpsBtn && navigator.geolocation) {
      gpsBtn.addEventListener('click', () => {
        gpsBtn.textContent = '⏳ Поиск...';
        navigator.geolocation.getCurrentPosition(
          pos => {
            currentLat = pos.coords.latitude;
            currentLon = pos.coords.longitude;
            currentBasin = detectBasinByCoords(currentLat, currentLon);
            setLocation(currentLat, currentLon, false);
            gpsBtn.textContent = '✅ Найдено';
            const isSeaCoastal = isCoastalInBasin(currentBasin, currentLat, currentLon);
            const hint = bodyEl.querySelector('#onbLocHint');
            if (hint) {
              hint.textContent = `Координаты: ${currentLat.toFixed(2)}°N, ${currentLon.toFixed(2)}°E (${BASIN_CONFIGS[currentBasin]?.name || 'РФ'}) ${isSeaCoastal ? '• 🌊 Морское побережье' : ''}`;
            }
          },
          () => {
            gpsBtn.textContent = '❌ Ошибка GPS';
          },
          { enableHighAccuracy: true, timeout: 6000 }
        );
      });
    }

    // "Заполню позже" button (Point 1)
    const laterBtn = bodyEl.querySelector('#onbLaterBtn');
    if (laterBtn) {
      laterBtn.addEventListener('click', () => {
        store.dispatch({
          type: 'SAVE_ONBOARDING',
          payload: {
            water: s.water,
            method: s.method,
            fishId: s.fishId || 'pike',
            targetSpecies: s.favorites || []
          }
        });
        closeModal();
        showToast('Профиль сохранён со стандартными настройками', 'info');
      });
    }

    // "Сохранить профиль и перейти к прогнозу" button (Point 1)
    const saveBtn = bodyEl.querySelector('#onbSaveBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        const preferredWatersArr = Array.from(selectedWaters);
        const preferredMethodsArr = Array.from(selectedMethods);
        const primaryWater = preferredWatersArr[0] || s.water || 'small_river';
        const primaryMethod = preferredMethodsArr[0] || s.method || 'spin_micro';
        const favArray = Array.from(selectedFishes);
        const regionalSpecies = FISH_DB.filter(f => f.basins.includes(currentBasin) && f.legal !== 'redbook');
        const targetFish = favArray[0] || s.fishId || regionalSpecies[0]?.id || 'pike';

        store.dispatch({
          type: 'SAVE_ONBOARDING',
          payload: {
            water: primaryWater,
            method: primaryMethod,
            fishId: targetFish,
            targetSpecies: favArray,
            preferredWaters: preferredWatersArr,
            preferredMethods: preferredMethodsArr
          }
        });
        store.dispatch({ type: 'SET_FAVORITES_LIST', payload: favArray.length ? favArray : s.favorites });
        store.dispatch({ type: 'SET_WATER', payload: { water: primaryWater, depth: WATER_PROFILES[primaryWater]?.defD || 1.5, selectedWaterName: '' } });
        store.dispatch({ type: 'SET_METHOD', payload: primaryMethod });
        store.dispatch({ type: 'SET_FISH', payload: targetFish });

        closeModal();
        showToast(isEditMode ? 'Профиль рыболова успешно обновлён!' : 'Настройка завершена! Добро пожаловать к прогнозу!', 'good');
      });
    }
  }, isEditMode);
}

export function renderFishStrip(container, state) {
  if (!container) return;
  const prevFishScroll = container.querySelector('.fish-strip')?.scrollLeft || 0;
  const prevGroupScroll = container.querySelector('.chip-scroll-row')?.scrollLeft || 0;
  const s = state || store.getState();
  const list = getFilteredFishList(s);
  const day = s.weatherDays[s.dayIdx] || s.weatherDays[2] || s.weatherDays[0];
  const curTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const favSet = new Set(s.favorites || []);
  const prof = WATER_PROFILES[s.water] || WATER_PROFILES.small_river;

  if (!s.fishId || (!list.some(f => f.id === s.fishId) && list.length > 0)) {
    const nextId = pickBestDefaultFish(list);
    if (nextId && nextId !== s.fishId) {
      setTimeout(() => store.dispatch({ type: 'SET_FISH', payload: nextId }), 0);
    }
  }

  container.innerHTML = `
    <div class="card">
      <div class="section-head" style="margin-bottom:6px;">
        <div>
          <span class="section-title">🐟 Рыбы в месте ловли (${list.length} видов)</span>
          <div style="font-size:10px;color:var(--muted);">
            ${s.showAllSpecies
              ? 'Показан полный справочник РФ (все виды)'
              : `Обитатели бассейна «${s.basinName}» • ${prof.shortName}`}
          </div>
        </div>
      </div>

      <!-- Кнопки Избранное, Список и По региону / Весь атлас строго в одну строку (Point 3) -->
      <div class="fish-toolbar-onerow">
        <button type="button" class="btn btn-sm ${s.onlyFavoritesFilter ? 'btn-accent' : ''}" id="fishFavFilterBtn">
          ⭐ Избранное (${(s.favorites || []).length})
        </button>
        <button type="button" class="btn btn-sm" id="fishFavEditBtn" title="Редактировать список избранных рыб">
          ✎ Список
        </button>
        <button type="button" class="btn btn-sm ${s.showAllSpecies ? 'btn-accent' : ''}" id="fishShowAllBtn">
          ${s.showAllSpecies ? 'По региону' : 'Весь атлас РФ'}
        </button>
      </div>

      <!-- Строка 1: Полноразмерный поиск -->
      <div style="margin-bottom:6px;">
        <input type="search" id="fishSearchInput" class="input" style="width:100%;min-height:36px;padding:6px 12px;font-size:var(--fs-xs);" placeholder="🔍 Поиск рыбы по названию (щука, лещ, форель, хариус, судак...)" value="${s.fishSearch || ''}">
      </div>

      <!-- Строка 2: Выбор групп рыб строго под поисковой строкой -->
      <div class="chip-scroll-row" style="margin-bottom:10px;width:100%;">
        ${Object.entries(RU.groups).map(([gk, gLabel]) => `
          <button type="button" class="w-chip ${s.fishGroup === gk ? 'active' : ''}" data-fish-group="${gk}">${gLabel}</button>
        `).join('')}
      </div>

      ${list.length === 0 ? `
        <div style="padding:16px 12px;background:var(--card);border:1px dashed var(--border);border-radius:var(--r-sm);text-align:center;margin:6px 0;">
          <div style="font-size:var(--fs-sm);font-weight:700;color:var(--text);margin-bottom:4px;">
            ⭐ В данном водоёме нет рыб из вашего Избранного
          </div>
          <div style="font-size:var(--fs-xs);color:var(--muted);margin-bottom:10px;">
            Включён фильтр «Только избранные», но ни один из отмеченных вами видов не водится в биотопе «${prof.shortName}».
          </div>
          <button type="button" class="btn btn-sm btn-accent" id="fishResetFavFilterBtn">
            🐟 Показать все рыбы водоёма
          </button>
        </div>
      ` : `
        <div id="fishDockSentinel" style="height:1px;width:100%;pointer-events:none;"></div>
        <div class="fish-strip-placeholder" id="fishStripPlaceholder">
          <div class="fish-strip-dock-wrap" id="fishStripDockWrap">
            <div class="fish-strip" id="mainFishStrip" role="listbox" aria-label="Рыбы в месте ловли">
              ${list.map(f => {
                const isRed = f.legal === 'redbook';
                const isFav = favSet.has(f.id);
                const sc = (!isRed && day) ? calcDayBest(f, day, s.method, s.water, s.depth, s.normPress, s.iceState) : 0;
                let badge = '';
                if (isRed) badge = createPill({ text: 'Красная книга', tone: 'bad' });
                else if (f.legal === 'license') badge = createPill({ text: 'По путёвке', tone: 'warn' });
                else if (f.legal === 'introduced') badge = createPill({ text: 'Вселенец', tone: 'purple' });

                return `
                  <div class="fish-card ${f.id === s.fishId ? 'active' : ''} ${isRed ? 'redbook-muted' : ''}" data-select-fish="${f.id}" role="option" aria-selected="${f.id === s.fishId}">
                    <button type="button" class="fav-btn" data-fav-fish="${f.id}" aria-label="${isFav ? 'Убрать из избранного' : 'В избранное'} ${f.name}">${isFav ? '⭐' : '☆'}</button>
                    <div class="fish-img-wrap">${renderFishVisual(f)}</div>
                    <div class="fish-name">${f.name}</div>
                    <div class="fish-latin">${f.latin || ''}</div>
                    <div class="fish-badge-wrap" style="margin:2px 0;">${badge}</div>
                    ${isRed
                      ? `<div class="fish-redbook-ban" style="margin-top:4px;"><span class="pill pill-bad">${RU.redbookBan}</span></div>`
                      : renderFiveFish(sc, 13, curTheme, true)}
                    <button type="button" class="btn btn-sm" style="width:100%;margin-top:5px;" data-info-fish="${f.id}">ℹ️ Подробнее</button>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        </div>
      `}
    </div>
  `;

  bindFishEvents(container);
  const newFishStrip = container.querySelector('.fish-strip');
  if (newFishStrip && prevFishScroll > 0) newFishStrip.scrollLeft = prevFishScroll;
  const newGroupRow = container.querySelector('.chip-scroll-row');
  if (newGroupRow && prevGroupScroll > 0) newGroupRow.scrollLeft = prevGroupScroll;
  if (typeof window.syncFishDockState === 'function') window.syncFishDockState();
}

function bindFishEvents(container) {
  const showAllBtn = container.querySelector('#fishShowAllBtn');
  if (showAllBtn) {
    showAllBtn.addEventListener('click', () => store.dispatch({ type: 'TOGGLE_SHOW_ALL' }));
  }

  const favFilterBtn = container.querySelector('#fishFavFilterBtn');
  if (favFilterBtn) {
    favFilterBtn.addEventListener('click', () => {
      store.dispatch({ type: 'TOGGLE_ONLY_FAVORITES' });
      const active = store.getState().onlyFavoritesFilter;
      showToast(active ? 'Показаны только избранные виды рыб' : 'Показаны все рыбы водоёма', 'info');
    });
  }

  const resetFavBtn = container.querySelector('#fishResetFavFilterBtn');
  if (resetFavBtn) {
    resetFavBtn.addEventListener('click', () => {
      store.dispatch({ type: 'TOGGLE_ONLY_FAVORITES' });
      showToast('Фильтр избранного отключён: показаны все рыбы водоёма', 'info');
    });
  }

  const favEditBtn = container.querySelector('#fishFavEditBtn');
  if (favEditBtn) {
    favEditBtn.addEventListener('click', () => openFavoritesEditorModal());
  }



  const searchInput = container.querySelector('#fishSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const val = e.target.value;
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        store.dispatch({ type: 'SET_FISH_SEARCH', payload: val });
      }, 200);
    });
  }

  container.querySelectorAll('[data-fish-group]').forEach(btn => {
    btn.addEventListener('click', () => {
      store.dispatch({ type: 'SET_FISH_GROUP', payload: btn.getAttribute('data-fish-group') });
    });
  });

  container.querySelectorAll('[data-select-fish]').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-fav-fish]') || e.target.closest('[data-info-fish]')) return;
      const fid = card.getAttribute('data-select-fish');
      const fishObj = FISH_DB.find(x => x.id === fid);
      store.dispatch({ type: 'SET_FISH', payload: fid });
      if (fishObj && fishObj.legal === 'redbook') {
        openFishDetail(fid);
      }
    });
  });

  container.querySelectorAll('[data-fav-fish]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const fid = btn.getAttribute('data-fav-fish');
      const fishObj = FISH_DB.find(x => x.id === fid);
      const wasFav = store.getState().favorites.includes(fid);
      store.dispatch({ type: 'TOGGLE_FAVORITE', payload: fid });
      const name = fishObj ? fishObj.name : fid;
      if (wasFav) {
        showToast(`☆ «${name}» убрана из Избранного`, 'info');
      } else {
        showToast(`⭐ «${name}» добавлена в Избранное`, 'good');
      }
    });
  });

  container.querySelectorAll('[data-info-fish]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openFishDetail(btn.getAttribute('data-info-fish'));
    });
  });
}

export function render(container) {
  renderFishStrip(container, store.getState());
}

let unsub = null;

export function init(container) {
  const s = store.getState();
  if (!s.fishId) {
    const defId = pickBestDefaultFish(getFilteredFishList(s));
    store.dispatch({ type: 'SET_FISH', payload: defId });
  }
  render(container);

  unsub = store.subscribe(
    st => ({
      basinCode: st.basinCode,
      water: st.water,
      method: st.method,
      depth: st.depth,
      fishId: st.fishId,
      dayIdx: st.dayIdx,
      showAllSpecies: st.showAllSpecies,
      onlyFavoritesFilter: st.onlyFavoritesFilter,
      fishSearch: st.fishSearch,
      fishGroup: st.fishGroup,
      favorites: st.favorites,
      weatherDays: st.weatherDays,
      theme: st.theme
    }),
    () => render(container)
  );
}

export function destroy() {
  if (unsub) unsub();
}
