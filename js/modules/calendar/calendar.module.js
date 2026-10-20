import { placeholder } from '../../ui/components.js';

export const calendarModule = {
  render(main) {
    main.append(
      placeholder('calendar', 'Годовой календарь',
        '12-месячная шкала по всем видам + сравнение видов — неделя 4.'
      )
    );
  }
};