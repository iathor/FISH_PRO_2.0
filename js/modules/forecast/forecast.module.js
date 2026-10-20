// js/modules/forecast/forecast.module.js
import { placeholder } from '../../ui/components.js';

export const forecastModule = {
  render(main) {
    main.append(
      placeholder('forecast', 'Прогноз клёва',
        'Экспресс-сводка, 14-дневная лента, почасовой график, декомпозиция — неделя 3.'
      )
    );
  }
};