// js/modules/geo/geo.module.js
import { placeholder } from '../../ui/components.js';

export const geoModule = {
  render(main) {
    main.append(
      placeholder('map', 'Геолокация',
        'Карта, поиск места и сохранённые точки — неделя 2. ' +
        'Фиксы hasSea и black_azov уже работают в ядре.'
      )
    );
  }
};