// js/modules/weather/weather.module.js
import { placeholder } from '../../ui/components.js';

export const weatherModule = {
  render(main) {
    main.append(
      placeholder('weather', 'Погода и Луна',
        'Open-Meteo + MET.no, фазы луны, solunar-окна — неделя 2. TTL-кэш 2 часа.'
      )
    );
  }
};