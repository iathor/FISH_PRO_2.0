# Релиз Клёв ПРО 2.0 — v2.9.2 (r257)
Код сборки Android: `293257` (`buildNumber: 257`)
Дата выпуска: 23.11.2026

## Что изменено и зачем

1. **Офлайн-квадраты на карте без текстовых плашек (Пункт 1)**:
   - В `js/modules/geo/geo.module.js` (`renderOfflinePackPerimetersOnMap`) удалено создание углового текстового маркера `klev-offline-pack-corner-label`. На карте отображаются только чистые пунктирные границы загруженных квадратов (`L.rectangle`).

2. **Импорт сторонних треков (.GPX, .GPX.BIN, .KML, .KMZ, .GeoJSON, .JSON) и ведение по треку (Пункт 2)**:
   - В `js/modules/geo/geo.routing.js` и `js/modules/geo/geo.module.js` реализованы функции `parseTrackFromExternalFileText` и `extractKmlFromKmzBuffer`:
     - поддержка GPX 1.0 / 1.1 (`<trk>/<trkseg>/<trkpt>`, `<rte>/<rtept>`, нестандартные теги `<acc>`, `<length>`, `<color>`, метки времени `<time>` в миллисекундах epoch, секундах и ISO-8601), а также файлов с двойным расширением `.gpx.bin`;
     - поддержка KML (`<gx:Track>/<gx:coord>` и `<LineString>/<coordinates>`) и прямое извлечение `doc.kml` из бинарных ZIP-архивов `.kmz` (включая потоковые архивы с General Purpose Bit 3 из «Геотрекера»);
     - автоматическое определение точки Старта (А) и точки Финиша (Б), расчет точной дистанции по всем исходным точкам и геометрическое упрощение Дугласа — Пекера (`simplifyTrackRdp`, допуск 5.5 м) для длинных треков (6000–9700 точек сжимаются до ~920–960 узлов с сохранением старта, финиша и изгибов);
     - адаптивный шаг уплотнения в `_densifyPolylineToMaxStep` для маршрутов длиннее 25 км;
     - автоперенаправление файлов с треками из `importSpotsFromFileText` в импорт маршрута (`importExternalTrackFromFileText`), исключающее превращение трека в тысячи одиночных закладок.
   - На карте для загруженных и активных треков отображаются маркеры **Старт (А)** и **Финиш (Б)** с координатами и названием трека, стрелки направления движения вдоль линии трека и промежуточный пин **Старт трека (А)** при построении участка подхода.
   - В окне «Мои маршруты» (`openPhase3RoutesModal`) добавлена кнопка **«Загрузить трек (.GPX / .KML / .KMZ)»**, кнопки **«Старт по треку»**, **«Вести назад»** и выгрузка в **«GPX»**.
   - Реализован диалог выбора старта `promptLoadedTrackStartChoice` с переключением направления (`Прямое: Старт А -> Финиш Б` / `Обратное: Финиш Б -> Старт А`) и двумя вариантами запуска:
     - **«С точки отправления в самом треке»** — старт ведения непосредственно по линии трека с голосовым и визуальным оповещением о старте маршрута по треку;
     - **«Достроить до старта от вашего местоположения»** — автоматическое построение маршрута подхода от текущего GPS пользователя до точки старта трека с учетом активного транспорта (авто/пешком/лодка/снегоход), оповещением о начале движения к старту трека и отдельным голосовым и экранным уведомлением при прибытии на точку старта трека (`<= 40 м`).

3. **Переименование и стилизация кнопки «Мои маршруты» в меню базы (Пункт 3)**:
   - В мобильной плашке `8.2` (`#arcPlaqueBtnLost`) и десктопной панели (`#geoOpenPhase3RoutesBtn`) в `js/modules/geo/geo.module.js` первая кнопка переименована из «Я потерялся» в **«Мои маршруты»**, удалена оранжевая окантовка (`border-color:var(--warn)`), применен стиль в цвет активной темы (`btn btn-sm btn-accent` с `border-color:transparent`).

4. **Ревизия UX/UI дизайна и исправление режимов «Стекло / Обычный» в контрастной теме OLED (Пункт 4)**:
   - В `css/tokens.css`, `css/components.css`, `css/layout.css` и встроенном блоке `<style id="klevCoreBundledCss">` в `index.html` и `kp-control-89.html`:
     - добавлены тематические токены `--accent-soft-bg`, `--accent-glow`, `--font-mono`;
     - для режима `Обычный` (`html[data-liquid-glass="0"]`) задан плотный непрозрачный фон `.compact-menu-popover` (`var(--panel)`), усилено затемнение `.compact-menu-backdrop` (`rgba(4, 9, 18, 0.72)`) и уплотнены фоны `.seg-bar`, `.lens-btn`, `.pill-btn`, исключающие просвечивание карточек Журнала сквозь меню;
     - для режима `Стекло` в контрастной теме (`html[data-liquid-glass="1"][data-theme="contrast"]`) прописана единая графитово-янтарная палитра без смешения с голубым неоном темной темы.
   - В `js/modules/fish/scanner.js`, `js/modules/log/log.module.js`, `js/modules/fish/fish.module.js`, `js/modules/forecast/forecast.module.js`, `js/modules/circle/circle.module.js`, `js/modules/circle/circle.chat.js`, `js/modules/weather/weather.module.js`, `js/modules/calendar/calendar.module.js`, `js/ui/components.js` и `js/core/pwa.js`:
     - в модальном окне ИИ-определителя рыбы убраны двойные акцентные рамки `.card` и старые разноцветные кнопки (`btn-good` / `btn-accent`), все кнопки переведены на `.pill-btn` и `.pill-btn.active`;
     - в Журнале уловов кнопки действий в карточках переведены на `.pill-btn`, а вложенные карточки — на `.glass-panel`;
     - в `fish.module.js` добавлена подпись `contrast: 'OLED (Контраст)'` в `themeLabels`;
     - все захардкоженные голубые плашки `rgba(56, 189, 248, ...)` переведены на `var(--accent-soft-bg)`, а мелкие шрифты `9px–10.5px` увеличены до `11px–12px`.

5. **Исправление конвейера «По фото (ИИ)» на клиенте и сервере (Пункт 5)**:
   - В `js/modules/fish/scanner.js` и `js/modules/circle/circle.api.js` добавлена функция `getScannerAuthContext()`, передающая `fisherId`, `login`, `deviceId`, `sessionToken`, `authTokenHash` и заголовки `X-Auth-Token`, `X-Fisher-Id` во все запросы к `/api/ai/identify-fish`; удалено поле `directPrompt`; таймаут `callDirectPostFast` увеличен с `2500` мс до `12000` мс.
   - В `cloudflare-worker-bot.js`:
     - в `verifyAiVisionBetaAccess` добавлен поиск сессии по `cloudAuthProfiles`, догрузка профиля из D1 (`loadPersistedAuthProfile`) на холодном старте, проверка HMAC-подписи `ADM_SESS_` токена владельца без обрыва через 8 часов, учет `betaGateConfig.phase2BetaOnly === false` и допуск авторизованных пользователей/устройств приложения;
     - в обработчике чанков `/api/ai/identify-fish` (`chunkMode === 'put'`) добавлена дедупликация по `globalThis.__klevVisionChunkStore.has(chunkKey)` перед списанием квоты `consumeAiUserChunkQuota`;
     - в `callGeminiGenerateContentSmart` и `_fetchGeminiWithGeoFallback` проброшен параметр `env`, убран залипающий флаг `_workerUseGeoRelay`, удален блокирующий вызов `discoverGeminiModelsForWorker` перед отправкой снимка, исправлен переход к следующей модели при таймауте и повтор без `thinkingConfig` при HTTP 400.

## Как проверить
1. Запустить автотесты:
   - `node --test tests/fixes.test.mjs` (25/25 тестов пройдены)
   - `node --test tests/boat-router.test.mjs` (8/8 проверок пройдены)
2. На карте проверить отсутствие текстовых плашек на границах офлайн-квадратов, нажатие на кнопку `База ... км` -> `Мои маршруты` (в цвет темы без оранжевой рамки) и загрузку треков `.gpx`, `.gpx.bin`, `.kml`, `.kmz` с выбором старта («С точки отправления в самом треке» или «Достроить до старта от вашего местоположения»).
3. Переключить тему на `OLED` и проверить режимы `Обычный` и `Стекло` в компактном меню, Журнале и модалке ИИ-сканера.
4. Открыть «По фото (ИИ)» и выполнить распознавание снимка рыбы.

## Как откатить
Развернуть предыдущий архив `v2.9.2 r256` (`buildNumber: 256`, `versionCode: 293256`) из папки `FISHING` на Google Диске и опубликовать `cloudflare-worker-bot.js` ревизии `r256`.
