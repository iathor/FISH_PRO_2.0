import { placeholder } from '../../ui/components.js';

export const geoModule = {
  render(main) {
    main.append(
      placeholder('map', 'Геолокация',
        'Карта, поиск места и сохранённые точки будут подключены на неделе 2. ' +
        'Фиксы hasSea и black_azov уже в ядре — проверьте Новый Уренгой и Севастополь.'
      )
    );
  }
};