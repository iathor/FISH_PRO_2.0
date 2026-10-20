// js/modules/log/log.module.js
import { placeholder } from '../../ui/components.js';

export const logModule = {
  render(main) {
    main.append(
      placeholder('log', 'Журнал уловов',
        'Логирование с авто-снимком условий. IndexedDB уже готова в core/storage.js.'
      )
    );
  }
};