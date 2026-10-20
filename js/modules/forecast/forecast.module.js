import { placeholder } from '../../ui/components.js';

export const forecastModule = {
  render(main) {
    main.append(
      placeholder('forecast', 'Прогноз клёва',
        'Экспресс-сводка, 14-дневная лента, почасовой график ' +
        'с декомпозицией факторов — неделя 3.'
      )
    );
  }
};