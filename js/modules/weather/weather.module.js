import { placeholder } from '../../ui/components.js';

export const weatherModule = {
  render(main) {
    main.append(
      placeholder('weather', 'Погода и Луна',
        'Open-Meteo, MET.no, расчёт фаз луны и solunar-окон — неделя 2. ' +
        'Кэш с TTL 2 часа, офлайн-режим.'
      )
    );
  }
};