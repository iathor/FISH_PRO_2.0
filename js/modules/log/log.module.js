import { placeholder } from '../../ui/components.js';

export const logModule = {
  render(main) {
    main.append(
      placeholder('log', 'Журнал уловов',
        'Логирование с авто-снимком условий (давление, луна, вода) — неделя 4. ' +
        'IndexedDB уже инициализирована в core/storage.js.'
      )
    );
  }
};