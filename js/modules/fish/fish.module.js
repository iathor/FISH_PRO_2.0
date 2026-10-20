// js/modules/fish/fish.module.js
import { store } from '../../core/state.js';
import { FISH_DB } from '../../data/fish-db.js';
import { getBasinName } from '../../data/basin-configs.js';
import { el, renderRating } from '../../ui/components.js';

export const fishModule = {
  render(main) {
    const s = store.getState();
    const loc = s.location;
    const basinName = getBasinName(loc.basinCode);
    const basinFish = FISH_DB.filter(f => f.basins.includes(loc.basinCode));

    main.append(
      el('section', { class: 'section' },
        el('div', { class: 'section__header' },
          el('div', { class: 'section__title' }, `Ихтиофауна: ${basinName}`),
          el('span', { class: 'pill pill--info' }, `${basinFish.length} видов`)
        ),
        el('div', { class: 'strip' },
          ...basinFish.map(f => el('div', {
            class: 'card',
            style: 'min-width: 160px; cursor: pointer;'
          },
            el('div', { style: 'font-weight: 700; font-size: 14px; margin-bottom: 6px;' }, f.name),
            f.legal === 'redbook'
              ? el('span', { class: 'pill pill--bad' }, 'Красная книга')
              : f.legal === 'license'
                ? el('span', { class: 'pill pill--warn' }, 'Лицензия')
                : f.legal === 'introduced'
                  ? el('span', { class: 'pill pill--purple' }, 'Интродуцент')
                  : el('span', { class: 'pill pill--good' }, 'Свободный лов'),
            el('div', { style: 'margin-top: 8px;', innerHTML: f.legal === 'redbook'
              ? '<span style="font-size:11px;color:var(--bad);font-weight:700;">ВЫЛОВ ЗАПРЕЩЁН</span>'
              : renderRating(75) })
          ))
        )
      ),
      el('section', { class: 'section' },
        el('div', { class: 'card' },
          el('div', { class: 'card__title' }, 'Демо-набор недели 1'),
          el('p', { style: 'font-size: 13px; color: var(--text-muted); line-height: 1.5;' },
            `Показано ${basinFish.length} видов для бассейна «${basinName}». `,
            'Полный массив 115 видов переносится на неделе 3 — формат FISH_DB совместим.'
          )
        )
      )
    );
  }
};