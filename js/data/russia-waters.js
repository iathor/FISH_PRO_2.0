/**
 * Офлайн-база гидрографической сети Российской Федерации (Ревизия 2.0.13).
 * Обеспечивает мгновенное отображение ближайших водоёмов в радиусе «До 50 км» или «До 120 км»
 * с точным типом биотопа (Озеро / Карьер / ГРЭС / Река-малая / Река-большая / Старица / Морской залив)
 * даже без VPN или при слабой связи, а также дополняется данными локализованного Overpass API (maps.mail.ru).
 */

export const RUSSIA_WATERS = [
  // ==========================================
  // ОБЬ-ТАЗОВСКИЙ БАССЕЙН (ЯНАО, ХМАО, Тюмень, Обь, Иртыш, Пур, Таз, Надым)
  // ==========================================
  { name: 'р. Седе-Яха', cleanName: 'Седе-Яха', basin: 'arctic_ob_taz', wType: 'small_river', typeTag: 'Река малая', defDepth: 1.4, lat: 66.083, lon: 76.680, region: 'Новый Уренгой' },
  { name: 'р. Ево-Яха', cleanName: 'Ево-Яха', basin: 'arctic_ob_taz', wType: 'small_river', typeTag: 'Река малая', defDepth: 1.6, lat: 66.071, lon: 76.712, region: 'Новый Уренгой' },
  { name: 'р. Тамчара-Яха', cleanName: 'Тамчара-Яха', basin: 'arctic_ob_taz', wType: 'small_river', typeTag: 'Река малая', defDepth: 1.3, lat: 66.065, lon: 76.630, region: 'Новый Уренгой' },
  { name: 'оз. Молодёжное', cleanName: 'Молодёжное', basin: 'arctic_ob_taz', wType: 'tundra_lake', typeTag: 'Озеро', defDepth: 1.8, lat: 66.090, lon: 76.690, region: 'Новый Уренгой' },
  { name: 'Песчаные карьеры (Н. Уренгой)', cleanName: 'Карьеры Н. Уренгоя', basin: 'arctic_ob_taz', wType: 'quarry', typeTag: 'Карьер', defDepth: 3.5, lat: 66.055, lon: 76.740, region: 'Новый Уренгой' },
  { name: 'р. Тамбей-Яха', cleanName: 'Тамбей-Яха', basin: 'arctic_ob_taz', wType: 'small_river', typeTag: 'Река малая', defDepth: 1.2, lat: 66.120, lon: 76.550, region: 'ЯНАО / Новый Уренгой' },
  { name: 'р. Варенга-Яха', cleanName: 'Варенга-Яха', basin: 'arctic_ob_taz', wType: 'small_river', typeTag: 'Река малая', defDepth: 1.8, lat: 66.035, lon: 77.520, region: 'Новый Уренгой / Коротчаево' },
  { name: 'р. Арка-Табъяха', cleanName: 'Арка-Табъяха', basin: 'arctic_ob_taz', wType: 'small_river', typeTag: 'Река малая', defDepth: 1.7, lat: 65.920, lon: 76.420, region: 'Новый Уренгой (юг)' },
  { name: 'р. Ямсовей', cleanName: 'Ямсовей', basin: 'arctic_ob_taz', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.1, lat: 65.650, lon: 76.950, region: 'ЯНАО / Ямсовей' },
  { name: 'р. Хадуттэ', cleanName: 'Хадуттэ', basin: 'arctic_ob_taz', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.4, lat: 66.480, lon: 76.850, region: 'Новый Уренгой / Тазовский р-н' },
  { name: 'р. Нгарка-Пыряяха', cleanName: 'Нгарка-Пыряяха', basin: 'arctic_ob_taz', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.0, lat: 66.380, lon: 77.950, region: 'ЯНАО / Уренгой' },
  { name: 'р. Большая Хадырьяха', cleanName: 'Большая Хадырьяха', basin: 'arctic_ob_taz', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.2, lat: 65.820, lon: 78.050, region: 'Коротчаево / Уренгой' },
  { name: 'р. Пур (Коротчаево / Уренгой)', cleanName: 'Пур (Коротчаево)', basin: 'arctic_ob_taz', wType: 'big_river', typeTag: 'Река большая', defDepth: 4.5, lat: 65.945, lon: 78.180, region: 'Коротчаево / пгт. Уренгой' },
  { name: 'оз. Ямылимуяганто', cleanName: 'Ямылимуяганто', basin: 'arctic_ob_taz', wType: 'quarry', typeTag: 'Озеро глубокое', defDepth: 4.2, lat: 65.780, lon: 77.350, region: 'Пуровский р-н' },
  { name: 'р. Правая Хетта', cleanName: 'Правая Хетта', basin: 'arctic_ob_taz', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.2, lat: 65.850, lon: 74.500, region: 'Пангоды / Надымский р-н' },
  { name: 'р. Пур (Тарко-Сале)', cleanName: 'Пур', basin: 'arctic_ob_taz', wType: 'big_river', typeTag: 'Река большая', defDepth: 4.2, lat: 64.915, lon: 77.780, region: 'Тарко-Сале' },
  { name: 'р. Пяку-Пур', cleanName: 'Пяку-Пур', basin: 'arctic_ob_taz', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.2, lat: 64.900, lon: 77.750, region: 'Тарко-Сале / Губкинский' },
  { name: 'р. Айваседа-Пур', cleanName: 'Айваседа-Пур', basin: 'arctic_ob_taz', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.0, lat: 64.910, lon: 77.800, region: 'Тарко-Сале' },
  { name: 'р. Таз', cleanName: 'Таз', basin: 'arctic_ob_taz', wType: 'big_river', typeTag: 'Река большая', defDepth: 4.8, lat: 67.450, lon: 78.700, region: 'п. Тазовский' },
  { name: 'р. Надым', cleanName: 'Надым', basin: 'arctic_ob_taz', wType: 'big_river', typeTag: 'Река большая', defDepth: 3.8, lat: 65.533, lon: 72.520, region: 'г. Надым' },
  { name: 'оз. Янтарное', cleanName: 'Янтарное', basin: 'arctic_ob_taz', wType: 'tundra_lake', typeTag: 'Озеро', defDepth: 2.1, lat: 65.540, lon: 72.500, region: 'г. Надым' },
  { name: 'оз. Ханто', cleanName: 'Ханто', basin: 'arctic_ob_taz', wType: 'tundra_lake', typeTag: 'Озеро', defDepth: 2.5, lat: 63.220, lon: 75.430, region: 'г. Ноябрьск' },
  { name: 'оз. Светлое (Ноябрьск)', cleanName: 'Светлое', basin: 'arctic_ob_taz', wType: 'quarry', typeTag: 'Озеро / Карьер', defDepth: 4.0, lat: 63.160, lon: 75.380, region: 'г. Ноябрьск' },
  { name: 'р. Нанкпёх', cleanName: 'Нанкпёх', basin: 'arctic_ob_taz', wType: 'small_river', typeTag: 'Река малая', defDepth: 1.3, lat: 63.200, lon: 75.400, region: 'г. Ноябрьск' },
  { name: 'р. Обь (Салехард)', cleanName: 'Обь', basin: 'arctic_ob_taz', wType: 'big_river', typeTag: 'Река большая', defDepth: 7.5, lat: 66.530, lon: 66.600, region: 'Салехард / Лабытнанги' },
  { name: 'р. Полуй', cleanName: 'Полуй', basin: 'arctic_ob_taz', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.4, lat: 66.520, lon: 66.620, region: 'Салехард' },
  { name: 'р. Собь', cleanName: 'Собь', basin: 'arctic_ob_taz', wType: 'small_river', typeTag: 'Река малая', defDepth: 1.8, lat: 66.820, lon: 65.800, region: 'Харп / Полярный Урал' },
  { name: 'р. Обь (Сургут)', cleanName: 'Обь', basin: 'arctic_ob_taz', wType: 'big_river', typeTag: 'Река большая', defDepth: 6.8, lat: 61.250, lon: 73.400, region: 'Сургут' },
  { name: 'вдхр. Сургутской ГРЭС', cleanName: 'Сургутская ГРЭС (тёплый канал)', basin: 'arctic_ob_taz', wType: 'cooling_reservoir', typeTag: 'ГРЭС', defDepth: 3.5, lat: 61.280, lon: 73.500, region: 'Сургут' },
  { name: 'р. Тромъёган', cleanName: 'Тромъёган', basin: 'arctic_ob_taz', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.5, lat: 61.420, lon: 73.800, region: 'Сургутский р-н' },
  { name: 'р. Обь (Нижневартовск)', cleanName: 'Обь', basin: 'arctic_ob_taz', wType: 'big_river', typeTag: 'Река большая', defDepth: 6.5, lat: 60.930, lon: 76.550, region: 'Нижневартовск' },
  { name: 'оз. Самотлор', cleanName: 'Самотлор', basin: 'arctic_ob_taz', wType: 'tundra_lake', typeTag: 'Озеро', defDepth: 2.0, lat: 61.120, lon: 76.750, region: 'Нижневартовск' },
  { name: 'р. Вах', cleanName: 'Вах', basin: 'arctic_ob_taz', wType: 'big_river', typeTag: 'Река большая', defDepth: 4.0, lat: 60.980, lon: 76.900, region: 'ХМАО-Югра' },
  { name: 'р. Иртыш (Ханты-Мансийск)', cleanName: 'Иртыш', basin: 'arctic_ob_taz', wType: 'big_river', typeTag: 'Река большая', defDepth: 6.0, lat: 61.000, lon: 69.020, region: 'Ханты-Мансийск' },
  { name: 'р. Конда', cleanName: 'Конда', basin: 'arctic_ob_taz', wType: 'big_river', typeTag: 'Река большая', defDepth: 3.8, lat: 60.680, lon: 68.050, region: 'ХМАО' },
  { name: 'р. Иртыш (Тобольск)', cleanName: 'Иртыш', basin: 'arctic_ob_taz', wType: 'big_river', typeTag: 'Река большая', defDepth: 5.5, lat: 58.190, lon: 68.250, region: 'Тобольск' },
  { name: 'р. Тура (Тюмень)', cleanName: 'Тура', basin: 'arctic_ob_taz', wType: 'big_river', typeTag: 'Река большая', defDepth: 3.6, lat: 57.155, lon: 65.535, region: 'Тюмень' },
  { name: 'оз. Андреевское (Тюмень)', cleanName: 'Андреевское озеро', basin: 'arctic_ob_taz', wType: 'tundra_lake', typeTag: 'Озеро', defDepth: 2.2, lat: 57.050, lon: 65.770, region: 'Тюмень' },
  { name: 'р. Пышма', cleanName: 'Пышма', basin: 'arctic_ob_taz', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.0, lat: 56.980, lon: 65.380, region: 'Тюменская обл.' },
  { name: 'р. Исеть (Екатеринбург)', cleanName: 'Исеть', basin: 'arctic_ob_taz', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.2, lat: 56.835, lon: 60.605, region: 'Екатеринбург' },
  { name: 'Белоярское вдхр. (БАЭС)', cleanName: 'Белоярское вдхр.', basin: 'arctic_ob_taz', wType: 'cooling_reservoir', typeTag: 'ГРЭС/АЭС', defDepth: 6.5, lat: 56.850, lon: 61.300, region: 'Заречный / Екатеринбург' },
  { name: 'Рефтинское вдхр. (ГРЭС)', cleanName: 'Рефтинское вдхр.', basin: 'arctic_ob_taz', wType: 'cooling_reservoir', typeTag: 'ГРЭС', defDepth: 5.2, lat: 57.100, lon: 61.700, region: 'Рефтинский / Свердловская обл.' },
  { name: 'р. Иртыш (Омск)', cleanName: 'Иртыш (Омск)', basin: 'arctic_ob_taz', wType: 'big_river', typeTag: 'Река большая', defDepth: 4.8, lat: 54.990, lon: 73.360, region: 'Омск' },
  { name: 'р. Омь', cleanName: 'Омь', basin: 'arctic_ob_taz', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.1, lat: 54.995, lon: 73.380, region: 'Омск' },
  { name: 'р. Обь (Новосибирск)', cleanName: 'Обь (Новосибирск)', basin: 'arctic_ob_taz', wType: 'big_river', typeTag: 'Река большая', defDepth: 5.5, lat: 55.010, lon: 82.920, region: 'Новосибирск' },
  { name: 'Новосибирское вдхр. (Обское море)', cleanName: 'Обское море', basin: 'arctic_ob_taz', wType: 'quarry', typeTag: 'Водохранилище', defDepth: 7.5, lat: 54.750, lon: 82.850, region: 'Бердск / Новосибирск' },
  { name: 'р. Бердь', cleanName: 'Бердь', basin: 'arctic_ob_taz', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.4, lat: 54.760, lon: 83.100, region: 'Бердск' },
  { name: 'р. Томь (Томск / Кемерово)', cleanName: 'Томь', basin: 'arctic_ob_taz', wType: 'big_river', typeTag: 'Река большая', defDepth: 4.2, lat: 56.480, lon: 84.950, region: 'Томск' },
  { name: 'р. Обь (Барнаул)', cleanName: 'Обь (Барнаул)', basin: 'arctic_ob_taz', wType: 'big_river', typeTag: 'Река большая', defDepth: 4.8, lat: 53.340, lon: 83.780, region: 'Барнаул' },
  { name: 'оз. Телецкое', cleanName: 'Телецкое озеро', basin: 'arctic_ob_taz', wType: 'quarry', typeTag: 'Озеро глубокое', defDepth: 16.0, lat: 51.780, lon: 87.260, region: 'Республика Алтай' },
  { name: 'р. Бия', cleanName: 'Бия', basin: 'arctic_ob_taz', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.5, lat: 52.540, lon: 85.210, region: 'Бийск / Алтай' },
  { name: 'Тазовская губа', cleanName: 'Тазовская губа', basin: 'arctic_ob_taz', wType: 'sea_gulf', typeTag: 'Морская губа', defDepth: 4.5, lat: 68.000, lon: 76.000, region: 'ЯНАО / Карское море' },
  { name: 'Обская губа', cleanName: 'Обская губа', basin: 'arctic_ob_taz', wType: 'sea_gulf', typeTag: 'Морская губа', defDepth: 6.0, lat: 68.500, lon: 73.500, region: 'ЯНАО / Карское море' },

  // ==========================================
  // ВОЛЖСКО-КАСПИЙСКИЙ БАССЕЙН (Волга, Ока, Кама, Урал)
  // ==========================================
  { name: 'р. Москва', cleanName: 'Москва-река', basin: 'volga_caspian', wType: 'big_river', typeTag: 'Река большая', defDepth: 3.5, lat: 55.750, lon: 37.620, region: 'Москва' },
  { name: 'р. Яуза', cleanName: 'Яуза', basin: 'volga_caspian', wType: 'small_river', typeTag: 'Река малая', defDepth: 1.8, lat: 55.755, lon: 37.645, region: 'Москва' },
  { name: 'р. Пахра', cleanName: 'Пахра', basin: 'volga_caspian', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.1, lat: 55.440, lon: 37.560, region: 'Подольск / Домодедово' },
  { name: 'Пироговское вдхр.', cleanName: 'Пироговское вдхр.', basin: 'volga_caspian', wType: 'quarry', typeTag: 'Водохранилище', defDepth: 5.2, lat: 55.980, lon: 37.700, region: 'Московская обл.' },
  { name: 'Клязьминское вдхр.', cleanName: 'Клязьминское вдхр.', basin: 'volga_caspian', wType: 'quarry', typeTag: 'Водохранилище', defDepth: 4.8, lat: 55.990, lon: 37.580, region: 'Московская обл.' },
  { name: 'Истринское вдхр.', cleanName: 'Истринское вдхр.', basin: 'volga_caspian', wType: 'quarry', typeTag: 'Водохранилище', defDepth: 6.0, lat: 56.050, lon: 36.800, region: 'Истра / Солнечногорск' },
  { name: 'Можайское вдхр.', cleanName: 'Можайское вдхр.', basin: 'volga_caspian', wType: 'quarry', typeTag: 'Водохранилище', defDepth: 6.5, lat: 55.580, lon: 35.850, region: 'Можайск' },
  { name: 'Рузское вдхр.', cleanName: 'Рузское вдхр.', basin: 'volga_caspian', wType: 'quarry', typeTag: 'Водохранилище', defDepth: 6.2, lat: 55.780, lon: 36.050, region: 'Руза' },
  { name: 'Озернинское вдхр.', cleanName: 'Озернинское вдхр.', basin: 'volga_caspian', wType: 'quarry', typeTag: 'Водохранилище', defDepth: 5.8, lat: 55.770, lon: 36.220, region: 'Рузский р-н' },
  { name: 'оз. Сенеж', cleanName: 'Сенеж', basin: 'volga_caspian', wType: 'tundra_lake', typeTag: 'Озеро', defDepth: 3.0, lat: 56.190, lon: 37.020, region: 'Солнечногорск' },
  { name: 'Шатурские озёра (Шатурская ГРЭС)', cleanName: 'Шатурская ГРЭС (оз. Святое)', basin: 'volga_caspian', wType: 'cooling_reservoir', typeTag: 'ГРЭС', defDepth: 3.8, lat: 55.590, lon: 39.550, region: 'Шатура' },
  { name: 'Иваньковское вдхр. (Московское море)', cleanName: 'Иваньковское вдхр.', basin: 'volga_caspian', wType: 'quarry', typeTag: 'Водохранилище', defDepth: 5.5, lat: 56.750, lon: 36.950, region: 'Дубна / Конаково' },
  { name: 'Тёплый сброс Конаковской ГРЭС', cleanName: 'Конаковская ГРЭС', basin: 'volga_caspian', wType: 'cooling_reservoir', typeTag: 'ГРЭС', defDepth: 3.5, lat: 56.740, lon: 36.780, region: 'Конаково' },
  { name: 'р. Волга (Тверь)', cleanName: 'Волга', basin: 'volga_caspian', wType: 'big_river', typeTag: 'Река большая', defDepth: 4.2, lat: 56.860, lon: 35.900, region: 'Тверь' },
  { name: 'р. Тверца', cleanName: 'Тверца', basin: 'volga_caspian', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.1, lat: 56.870, lon: 35.920, region: 'Тверь' },
  { name: 'оз. Плещеево', cleanName: 'Плещеево озеро', basin: 'volga_caspian', wType: 'quarry', typeTag: 'Озеро глубокое', defDepth: 8.0, lat: 56.760, lon: 38.780, region: 'Переславль-Залесский' },
  { name: 'р. Волга (Ярославль)', cleanName: 'Волга', basin: 'volga_caspian', wType: 'big_river', typeTag: 'Река большая', defDepth: 5.8, lat: 57.620, lon: 39.890, region: 'Ярославль' },
  { name: 'р. Которосль', cleanName: 'Которосль', basin: 'volga_caspian', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.2, lat: 57.610, lon: 39.880, region: 'Ярославль' },
  { name: 'Рыбинское вдхр.', cleanName: 'Рыбинское вдхр.', basin: 'volga_caspian', wType: 'quarry', typeTag: 'Водохранилище', defDepth: 6.8, lat: 58.200, lon: 38.500, region: 'Рыбинск / Череповец' },
  { name: 'р. Ока (Серпухов / Кашира)', cleanName: 'Ока (Серпухов)', basin: 'volga_caspian', wType: 'big_river', typeTag: 'Река большая', defDepth: 3.6, lat: 54.880, lon: 37.420, region: 'Серпухов' },
  { name: 'р. Ока (Коломна)', cleanName: 'Ока', basin: 'volga_caspian', wType: 'big_river', typeTag: 'Река большая', defDepth: 3.8, lat: 55.080, lon: 38.770, region: 'Коломна' },
  { name: 'р. Ока (Рязань)', cleanName: 'Ока', basin: 'volga_caspian', wType: 'big_river', typeTag: 'Река большая', defDepth: 4.2, lat: 54.630, lon: 39.750, region: 'Рязань' },
  { name: 'р. Пра (Мещёра)', cleanName: 'Пра', basin: 'volga_caspian', wType: 'small_river', typeTag: 'Река малая', defDepth: 1.8, lat: 54.950, lon: 40.150, region: 'Рязанская обл.' },
  { name: 'р. Клязьма (Владимир)', cleanName: 'Клязьма', basin: 'volga_caspian', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.2, lat: 56.120, lon: 40.410, region: 'Владимир' },
  { name: 'р. Ока (Нижний Новгород)', cleanName: 'Ока', basin: 'volga_caspian', wType: 'big_river', typeTag: 'Река большая', defDepth: 5.0, lat: 56.320, lon: 43.990, region: 'Нижний Новгород' },
  { name: 'р. Волга (Нижний Новгород)', cleanName: 'Волга', basin: 'volga_caspian', wType: 'big_river', typeTag: 'Река большая', defDepth: 6.5, lat: 56.330, lon: 44.010, region: 'Нижний Новгород' },
  { name: 'р. Ветлуга', cleanName: 'Ветлуга', basin: 'volga_caspian', wType: 'big_river', typeTag: 'Река большая', defDepth: 3.4, lat: 56.850, lon: 45.450, region: 'Нижегородская обл.' },
  { name: 'Горьковское вдхр.', cleanName: 'Горьковское вдхр.', basin: 'volga_caspian', wType: 'quarry', typeTag: 'Водохранилище', defDepth: 6.2, lat: 56.800, lon: 43.400, region: 'Нижегородская обл.' },
  { name: 'Чебоксарское вдхр.', cleanName: 'Чебоксарское вдхр.', basin: 'volga_caspian', wType: 'quarry', typeTag: 'Водохранилище', defDepth: 5.8, lat: 56.140, lon: 47.250, region: 'Чебоксары / Васильсурск' },
  { name: 'р. Сура', cleanName: 'Сура', basin: 'volga_caspian', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.5, lat: 55.850, lon: 46.350, region: 'Чувашия / Пенза' },
  { name: 'р. Волга (Казань)', cleanName: 'Волга', basin: 'volga_caspian', wType: 'big_river', typeTag: 'Река большая', defDepth: 7.2, lat: 55.790, lon: 49.120, region: 'Казань' },
  { name: 'р. Казанка', cleanName: 'Казанка', basin: 'volga_caspian', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.0, lat: 55.800, lon: 49.110, region: 'Казань' },
  { name: 'р. Свияга', cleanName: 'Свияга', basin: 'volga_caspian', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.4, lat: 55.720, lon: 48.650, region: 'Татарстан / Ульяновск' },
  { name: 'р. Кама (Камское Устье)', cleanName: 'Камское Устье', basin: 'volga_caspian', wType: 'quarry', typeTag: 'Водохранилище', defDepth: 9.5, lat: 55.200, lon: 49.280, region: 'Татарстан' },
  { name: 'Нижнекамское вдхр. (Набережные Челны)', cleanName: 'Нижнекамское вдхр.', basin: 'volga_caspian', wType: 'quarry', typeTag: 'Водохранилище', defDepth: 6.8, lat: 55.700, lon: 52.350, region: 'Набережные Челны' },
  { name: 'р. Кама (Пермь)', cleanName: 'Кама', basin: 'volga_caspian', wType: 'big_river', typeTag: 'Река большая', defDepth: 6.2, lat: 58.010, lon: 56.250, region: 'Пермь' },
  { name: 'р. Чусовая', cleanName: 'Чусовая', basin: 'volga_caspian', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.4, lat: 58.180, lon: 56.850, region: 'Пермский край / Свердловская обл.' },
  { name: 'Камское вдхр.', cleanName: 'Камское вдхр.', basin: 'volga_caspian', wType: 'quarry', typeTag: 'Водохранилище', defDepth: 6.5, lat: 58.150, lon: 56.350, region: 'Пермский край' },
  { name: 'Куйбышевское вдхр. (Самара / Тольятти)', cleanName: 'Куйбышевское вдхр.', basin: 'volga_caspian', wType: 'quarry', typeTag: 'Водохранилище', defDepth: 8.5, lat: 53.200, lon: 50.150, region: 'Самара' },
  { name: 'р. Самара', cleanName: 'Самара', basin: 'volga_caspian', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.5, lat: 53.180, lon: 50.110, region: 'Самара' },
  { name: 'р. Сок', cleanName: 'Сок', basin: 'volga_caspian', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.2, lat: 53.410, lon: 50.150, region: 'Самарская обл.' },
  { name: 'Саратовское вдхр.', cleanName: 'Саратовское вдхр.', basin: 'volga_caspian', wType: 'quarry', typeTag: 'Водохранилище', defDepth: 7.8, lat: 51.530, lon: 46.030, region: 'Саратов / Балаково' },
  { name: 'Волгоградское вдхр.', cleanName: 'Волгоградское вдхр.', basin: 'volga_caspian', wType: 'quarry', typeTag: 'Водохранилище', defDepth: 8.2, lat: 48.710, lon: 44.510, region: 'Волгоград' },
  { name: 'р. Волга (Астрахань / Дельта)', cleanName: 'Волга (Дельта)', basin: 'volga_caspian', wType: 'big_river', typeTag: 'Река большая', defDepth: 5.5, lat: 46.350, lon: 48.040, region: 'Астрахань' },
  { name: 'р. Бахтемир (Главный банк)', cleanName: 'Бахтемир', basin: 'volga_caspian', wType: 'big_river', typeTag: 'Река большая', defDepth: 7.0, lat: 45.950, lon: 47.650, region: 'Астраханская обл.' },
  { name: 'р. Бузан', cleanName: 'Бузан', basin: 'volga_caspian', wType: 'big_river', typeTag: 'Река большая', defDepth: 5.0, lat: 46.550, lon: 48.300, region: 'Астраханская обл.' },
  { name: 'р. Ахтуба (Волго-Ахтубинская пойма)', cleanName: 'Ахтуба', basin: 'volga_caspian', wType: 'big_river', typeTag: 'Река большая', defDepth: 3.8, lat: 48.000, lon: 45.500, region: 'Ахтубинск / Харабали' },
  { name: 'р. Белая (Уфа)', cleanName: 'Белая (Агидель)', basin: 'volga_caspian', wType: 'big_river', typeTag: 'Река большая', defDepth: 3.6, lat: 54.730, lon: 55.970, region: 'Уфа' },
  { name: 'р. Уфа (Караидель)', cleanName: 'Уфа (Уфимка)', basin: 'volga_caspian', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.5, lat: 54.760, lon: 56.050, region: 'Уфа' },
  { name: 'Павловское вдхр.', cleanName: 'Павловское вдхр.', basin: 'volga_caspian', wType: 'quarry', typeTag: 'Водохранилище', defDepth: 9.0, lat: 55.420, lon: 56.550, region: 'Башкортостан' },
  { name: 'оз. Аслыкуль', cleanName: 'Аслыкуль', basin: 'volga_caspian', wType: 'quarry', typeTag: 'Озеро', defDepth: 4.5, lat: 54.310, lon: 54.580, region: 'Башкортостан' },
  { name: 'р. Вятка (Киров)', cleanName: 'Вятка', basin: 'volga_caspian', wType: 'big_river', typeTag: 'Река большая', defDepth: 3.2, lat: 58.600, lon: 49.660, region: 'Киров' },
  { name: 'р. Урал (Оренбург)', cleanName: 'Урал', basin: 'volga_caspian', wType: 'big_river', typeTag: 'Река большая', defDepth: 2.8, lat: 51.770, lon: 55.100, region: 'Оренбург' },
  { name: 'Ириклинское вдхр.', cleanName: 'Ириклинское вдхр.', basin: 'volga_caspian', wType: 'quarry', typeTag: 'Водохранилище', defDepth: 10.0, lat: 51.780, lon: 58.780, region: 'Оренбургская обл.' },
  { name: 'р. Урал (Магнитогорск)', cleanName: 'Урал', basin: 'volga_caspian', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.2, lat: 53.420, lon: 58.980, region: 'Магнитогорск' },
  { name: 'оз. Увильды (Челябинск)', cleanName: 'Увильды', basin: 'volga_caspian', wType: 'quarry', typeTag: 'Озеро глубокое', defDepth: 11.0, lat: 55.520, lon: 60.500, region: 'Челябинская обл.' },
  { name: 'оз. Тургояк (Миасс)', cleanName: 'Тургояк', basin: 'volga_caspian', wType: 'quarry', typeTag: 'Озеро глубокое', defDepth: 14.0, lat: 55.150, lon: 60.060, region: 'Челябинская обл.' },
  { name: 'Шершнёвское вдхр. (Челябинск)', cleanName: 'Шершнёвское вдхр.', basin: 'volga_caspian', wType: 'quarry', typeTag: 'Водохранилище', defDepth: 5.5, lat: 55.100, lon: 61.330, region: 'Челябинск' },
  { name: 'оз. Селигер', cleanName: 'Селигер', basin: 'volga_caspian', wType: 'quarry', typeTag: 'Озеро глубокое', defDepth: 5.8, lat: 57.200, lon: 33.050, region: 'Осташков' },
  { name: 'оз. Неро', cleanName: 'Неро', basin: 'volga_caspian', wType: 'tundra_lake', typeTag: 'Озеро', defDepth: 1.5, lat: 57.170, lon: 39.430, region: 'Ростов Великий' },
  { name: 'Каспийское море (Махачкала)', cleanName: 'Каспийское море', basin: 'volga_caspian', wType: 'sea_gulf', typeTag: 'Морской залив', defDepth: 6.5, lat: 42.980, lon: 47.510, region: 'Махачкала' },
  { name: 'Каспийское море (Дербент)', cleanName: 'Каспийское море', basin: 'volga_caspian', wType: 'open_sea', typeTag: 'Море', defDepth: 12.0, lat: 42.070, lon: 48.290, region: 'Дербент' },

  // ==========================================
  // ЛАДОЖСКО-ОНЕЖСКИЙ И КАРЕЛЬСКИЙ БАССЕЙН
  // ==========================================
  { name: 'Ладожское озеро', cleanName: 'Ладожское озеро', basin: 'nw_karelia', wType: 'quarry', typeTag: 'Озеро глубокое', defDepth: 12.0, lat: 60.500, lon: 31.000, region: 'Приозерск / Шлиссельбург' },
  { name: 'Онежское озеро', cleanName: 'Онежское озеро', basin: 'nw_karelia', wType: 'quarry', typeTag: 'Озеро глубокое', defDepth: 14.0, lat: 61.790, lon: 34.370, region: 'Петрозаводск' },
  { name: 'р. Нева', cleanName: 'Нева', basin: 'nw_karelia', wType: 'big_river', typeTag: 'Река большая', defDepth: 6.5, lat: 59.930, lon: 30.340, region: 'Санкт-Петербург' },
  { name: 'р. Вуокса', cleanName: 'Вуокса', basin: 'nw_karelia', wType: 'big_river', typeTag: 'Река большая', defDepth: 4.5, lat: 60.680, lon: 30.000, region: 'Лосево / Приозерск' },
  { name: 'оз. Отрадное', cleanName: 'Отрадное', basin: 'nw_karelia', wType: 'quarry', typeTag: 'Озеро глубокое', defDepth: 7.5, lat: 60.820, lon: 30.200, region: 'Ленинградская обл.' },
  { name: 'р. Свирь', cleanName: 'Свирь', basin: 'nw_karelia', wType: 'big_river', typeTag: 'Река большая', defDepth: 5.2, lat: 60.910, lon: 34.170, region: 'Подпорожье' },
  { name: 'р. Волхов', cleanName: 'Волхов', basin: 'nw_karelia', wType: 'big_river', typeTag: 'Река большая', defDepth: 4.8, lat: 60.100, lon: 32.300, region: 'Новая Ладога' },
  { name: 'оз. Ильмень (Великий Новгород)', cleanName: 'Ильмень', basin: 'nw_karelia', wType: 'tundra_lake', typeTag: 'Озеро', defDepth: 2.8, lat: 58.280, lon: 31.280, region: 'Великий Новгород' },
  { name: 'оз. Сямозеро', cleanName: 'Сямозеро', basin: 'nw_karelia', wType: 'quarry', typeTag: 'Озеро глубокое', defDepth: 6.0, lat: 61.900, lon: 33.150, region: 'Пряжинский р-н' },
  { name: 'оз. Сегозеро', cleanName: 'Сегозеро', basin: 'nw_karelia', wType: 'quarry', typeTag: 'Озеро глубокое', defDepth: 18.0, lat: 63.300, lon: 33.800, region: 'Медвежьегорский р-н' },
  { name: 'оз. Выгозеро', cleanName: 'Выгозеро', basin: 'nw_karelia', wType: 'quarry', typeTag: 'Озеро глубокое', defDepth: 7.0, lat: 63.600, lon: 34.700, region: 'Сегежа' },
  { name: 'р. Суна', cleanName: 'Суна', basin: 'nw_karelia', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.2, lat: 62.270, lon: 33.980, region: 'Кивач' },
  { name: 'р. Шуя (Карелия)', cleanName: 'Шуя', basin: 'nw_karelia', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.0, lat: 61.910, lon: 34.250, region: 'Петрозаводск' },
  { name: 'оз. Пяозеро / Топозеро', cleanName: 'Пяозеро', basin: 'nw_karelia', wType: 'quarry', typeTag: 'Озеро глубокое', defDepth: 15.0, lat: 65.800, lon: 31.000, region: 'Северная Карелия' },

  // ==========================================
  // БАРЕНЦЕВО-БЕЛОМОРСКИЙ АРКТИЧЕСКИЙ БАССЕЙН
  // ==========================================
  { name: 'Баренцево море (Териберка)', cleanName: 'Баренцево море (Териберка)', basin: 'barents_white', wType: 'open_sea', typeTag: 'Море', defDepth: 25.0, lat: 69.170, lon: 35.140, region: 'Териберка' },
  { name: 'Кольский залив (Мурманск)', cleanName: 'Кольский залив', basin: 'barents_white', wType: 'sea_gulf', typeTag: 'Морской залив', defDepth: 18.0, lat: 68.970, lon: 33.080, region: 'Мурманск' },
  { name: 'Белое море (Кандалакшский залив)', cleanName: 'Кандалакшский залив', basin: 'barents_white', wType: 'sea_gulf', typeTag: 'Морской залив', defDepth: 12.0, lat: 67.150, lon: 32.400, region: 'Кандалакша' },
  { name: 'Белое море (Двинский залив / Северодвинск)', cleanName: 'Двинский залив', basin: 'barents_white', wType: 'sea_gulf', typeTag: 'Морской залив', defDepth: 8.5, lat: 64.600, lon: 39.800, region: 'Северодвинск / Архангельск' },
  { name: 'р. Северная Двина (Архангельск)', cleanName: 'Северная Двина', basin: 'barents_white', wType: 'big_river', typeTag: 'Река большая', defDepth: 6.5, lat: 64.540, lon: 40.520, region: 'Архангельск' },
  { name: 'р. Онега', cleanName: 'Онега', basin: 'barents_white', wType: 'big_river', typeTag: 'Река большая', defDepth: 3.8, lat: 63.900, lon: 38.100, region: 'Онега' },
  { name: 'р. Вычегда (Сыктывкар)', cleanName: 'Вычегда', basin: 'barents_white', wType: 'big_river', typeTag: 'Река большая', defDepth: 3.5, lat: 61.670, lon: 50.830, region: 'Сыктывкар' },
  { name: 'р. Кола', cleanName: 'Кола', basin: 'barents_white', wType: 'small_river', typeTag: 'Река малая', defDepth: 1.8, lat: 68.880, lon: 33.020, region: 'п. Молочный' },
  { name: 'р. Тулома', cleanName: 'Тулома', basin: 'barents_white', wType: 'big_river', typeTag: 'Река большая', defDepth: 4.5, lat: 68.810, lon: 32.810, region: 'Мурмаши' },
  { name: 'р. Варзуга', cleanName: 'Варзуга', basin: 'barents_white', wType: 'small_river', typeTag: 'Река малая', defDepth: 1.6, lat: 66.400, lon: 36.580, region: 'Терский берег' },
  { name: 'р. Умба', cleanName: 'Умба', basin: 'barents_white', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.0, lat: 66.680, lon: 34.350, region: 'Терский берег' },
  { name: 'р. Поной', cleanName: 'Поной', basin: 'barents_white', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.2, lat: 67.070, lon: 39.500, region: 'Кольский п-ов' },
  { name: 'оз. Имандра', cleanName: 'Имандра', basin: 'barents_white', wType: 'quarry', typeTag: 'Озеро глубокое', defDepth: 10.0, lat: 67.600, lon: 33.100, region: 'Апатиты / Мончегорск' },
  { name: 'оз. Ловозеро', cleanName: 'Ловозеро', basin: 'barents_white', wType: 'quarry', typeTag: 'Озеро глубокое', defDepth: 8.0, lat: 67.850, lon: 35.150, region: 'Ловозерский р-н' },
  { name: 'р. Печора (Нарьян-Мар)', cleanName: 'Печора', basin: 'barents_white', wType: 'big_river', typeTag: 'Река большая', defDepth: 6.0, lat: 67.640, lon: 53.000, region: 'Ненецкий АО' },
  { name: 'р. Печора (г. Печора / Усинск)', cleanName: 'Печора', basin: 'barents_white', wType: 'big_river', typeTag: 'Река большая', defDepth: 4.8, lat: 65.140, lon: 57.220, region: 'Республика Коми' },
  { name: 'р. Уса (Усинск)', cleanName: 'Уса', basin: 'barents_white', wType: 'big_river', typeTag: 'Река большая', defDepth: 3.8, lat: 65.980, lon: 57.550, region: 'Усинск / Инта' },

  // ==========================================
  // ЧЕРНОМОРСКО-АЗОВСКИЙ БАССЕЙН (Дон, Кубань, Крым, Кавказ)
  // ==========================================
  { name: 'р. Дон (Ростов-на-Дону)', cleanName: 'Дон', basin: 'black_azov', wType: 'big_river', typeTag: 'Река большая', defDepth: 5.5, lat: 47.220, lon: 39.720, region: 'Ростов-на-Дону' },
  { name: 'р. Дон (Воронеж)', cleanName: 'Дон', basin: 'black_azov', wType: 'big_river', typeTag: 'Река большая', defDepth: 3.8, lat: 50.980, lon: 39.500, region: 'Лиски / Воронеж' },
  { name: 'р. Воронеж (Воронежское вдхр.)', cleanName: 'Воронежское вдхр.', basin: 'black_azov', wType: 'quarry', typeTag: 'Водохранилище', defDepth: 4.2, lat: 51.670, lon: 39.200, region: 'Воронеж' },
  { name: 'Нововоронежское вдхр. (АЭС)', cleanName: 'Нововоронежская АЭС', basin: 'black_azov', wType: 'cooling_reservoir', typeTag: 'ГРЭС/АЭС', defDepth: 4.8, lat: 51.270, lon: 39.200, region: 'Нововоронеж' },
  { name: 'Цимлянское вдхр.', cleanName: 'Цимлянское вдхр.', basin: 'black_azov', wType: 'quarry', typeTag: 'Водохранилище', defDepth: 8.0, lat: 47.600, lon: 42.100, region: 'Волгодонск' },
  { name: 'р. Маныч (Весёловское вдхр.)', cleanName: 'Маныч', basin: 'black_azov', wType: 'quarry', typeTag: 'Водохранилище', defDepth: 4.2, lat: 47.100, lon: 40.800, region: 'п. Весёлый' },
  { name: 'р. Северский Донец', cleanName: 'Северский Донец', basin: 'black_azov', wType: 'big_river', typeTag: 'Река большая', defDepth: 3.2, lat: 48.320, lon: 40.260, region: 'Каменск-Шахтинский' },
  { name: 'р. Кубань (Краснодар)', cleanName: 'Кубань', basin: 'black_azov', wType: 'big_river', typeTag: 'Река большая', defDepth: 4.0, lat: 45.030, lon: 38.980, region: 'Краснодар' },
  { name: 'Краснодарское вдхр. (Кубанское море)', cleanName: 'Краснодарское вдхр.', basin: 'black_azov', wType: 'quarry', typeTag: 'Водохранилище', defDepth: 6.2, lat: 44.980, lon: 39.250, region: 'Краснодар' },
  { name: 'р. Кубань (Темрюк / дельта)', cleanName: 'Кубань (Дельта)', basin: 'black_azov', wType: 'big_river', typeTag: 'Река большая', defDepth: 3.5, lat: 45.270, lon: 37.380, region: 'Темрюк' },
  { name: 'Бейсугский лиман / р. Бейсуг', cleanName: 'Бейсугский лиман', basin: 'black_azov', wType: 'tundra_lake', typeTag: 'Лиман / Старица', defDepth: 1.8, lat: 46.080, lon: 38.550, region: 'Приморско-Ахтарск' },
  { name: 'Чёрное море (Севастопольские бухты)', cleanName: 'Севастопольские бухты', basin: 'black_azov', wType: 'sea_gulf', typeTag: 'Морской залив', defDepth: 8.5, lat: 44.620, lon: 33.530, region: 'Севастополь' },
  { name: 'р. Чёрная (Инкерман)', cleanName: 'р. Чёрная', basin: 'black_azov', wType: 'small_river', typeTag: 'Река малая', defDepth: 1.5, lat: 44.610, lon: 33.600, region: 'Севастополь / Инкерман' },
  { name: 'Симферопольское вдхр.', cleanName: 'Симферопольское вдхр.', basin: 'black_azov', wType: 'quarry', typeTag: 'Водохранилище', defDepth: 6.5, lat: 44.920, lon: 34.150, region: 'Симферополь' },
  { name: 'Чёрное море (ЮБК / Ялта)', cleanName: 'Чёрное море (ЮБК)', basin: 'black_azov', wType: 'open_sea', typeTag: 'Море', defDepth: 15.0, lat: 44.500, lon: 34.170, region: 'Ялта' },
  { name: 'Керченский пролив', cleanName: 'Керченский пролив', basin: 'black_azov', wType: 'sea_gulf', typeTag: 'Морской пролив', defDepth: 7.5, lat: 45.320, lon: 36.480, region: 'Керчь / Тамань' },
  { name: 'Цемесская бухта (Новороссийск)', cleanName: 'Цемесская бухта', basin: 'black_azov', wType: 'sea_gulf', typeTag: 'Морской залив', defDepth: 12.0, lat: 44.720, lon: 37.780, region: 'Новороссийск' },
  { name: 'Чёрное море (Сочи / Адлер)', cleanName: 'Чёрное море (Сочи)', basin: 'black_azov', wType: 'open_sea', typeTag: 'Море', defDepth: 16.0, lat: 43.590, lon: 39.730, region: 'Сочи' },
  { name: 'р. Мзымта', cleanName: 'Мзымта', basin: 'black_azov', wType: 'small_river', typeTag: 'Река малая', defDepth: 1.8, lat: 43.420, lon: 39.920, region: 'Адлер' },
  { name: 'р. Сочи', cleanName: 'р. Сочи', basin: 'black_azov', wType: 'small_river', typeTag: 'Река малая', defDepth: 1.4, lat: 43.595, lon: 39.735, region: 'Сочи' },
  { name: 'Азовское море (Таганрогский залив)', cleanName: 'Таганрогский залив', basin: 'black_azov', wType: 'sea_gulf', typeTag: 'Морской залив', defDepth: 4.5, lat: 47.200, lon: 38.920, region: 'Таганрог' },
  { name: 'Ейский лиман', cleanName: 'Ейский лиман', basin: 'black_azov', wType: 'sea_gulf', typeTag: 'Морской лиман', defDepth: 2.8, lat: 46.700, lon: 38.300, region: 'Ейск' },
  { name: 'оз. Абрау', cleanName: 'Абрау', basin: 'black_azov', wType: 'quarry', typeTag: 'Озеро глубокое', defDepth: 7.0, lat: 44.700, lon: 37.600, region: 'Абрау-Дюрсо' },

  // ==========================================
  // БАЛТИЙСКИЙ МОРСКОЙ БАССЕЙН
  // ==========================================
  { name: 'Финский залив (Маркизова лужа)', cleanName: 'Финский залив', basin: 'baltic', wType: 'sea_gulf', typeTag: 'Морской залив', defDepth: 5.5, lat: 59.950, lon: 30.200, region: 'Санкт-Петербург' },
  { name: 'Финский залив (Дамба КЗС / Кронштадт)', cleanName: 'Дамба Кронштадт', basin: 'baltic', wType: 'sea_gulf', typeTag: 'Морской залив', defDepth: 7.5, lat: 60.010, lon: 29.740, region: 'Кронштадт' },
  { name: 'Выборгский залив', cleanName: 'Выборгский залив', basin: 'baltic', wType: 'sea_gulf', typeTag: 'Морской залив', defDepth: 7.2, lat: 60.710, lon: 28.750, region: 'Выборг' },
  { name: 'р. Луга (Усть-Луга)', cleanName: 'Луга', basin: 'baltic', wType: 'big_river', typeTag: 'Река большая', defDepth: 3.5, lat: 59.680, lon: 28.300, region: 'Кингисеппский р-н' },
  { name: 'р. Нарва (Ивангород)', cleanName: 'Нарва', basin: 'baltic', wType: 'big_river', typeTag: 'Река большая', defDepth: 4.2, lat: 59.380, lon: 28.200, region: 'Ивангород' },
  { name: 'Куршский залив', cleanName: 'Куршский залив', basin: 'baltic', wType: 'sea_gulf', typeTag: 'Морской залив', defDepth: 3.8, lat: 54.960, lon: 20.470, region: 'Зеленоградск / Коса' },
  { name: 'Балтийское море (Балтийск / Янтарный)', cleanName: 'Балтийское море', basin: 'baltic', wType: 'open_sea', typeTag: 'Море', defDepth: 14.0, lat: 54.640, lon: 19.890, region: 'Калининградская обл.' },
  { name: 'Калининградский (Вислинский) залив', cleanName: 'Калининградский залив', basin: 'baltic', wType: 'sea_gulf', typeTag: 'Морской залив', defDepth: 3.5, lat: 54.650, lon: 20.150, region: 'Калининград' },
  { name: 'р. Преголя', cleanName: 'Преголя', basin: 'baltic', wType: 'big_river', typeTag: 'Река большая', defDepth: 3.2, lat: 54.710, lon: 20.510, region: 'Калининград' },
  { name: 'р. Дейма / Матросовка', cleanName: 'Дейма', basin: 'baltic', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.8, lat: 54.820, lon: 21.100, region: 'Полесск' },
  { name: 'оз. Чудско-Псковское', cleanName: 'Чудское озеро', basin: 'baltic', wType: 'quarry', typeTag: 'Озеро глубокое', defDepth: 6.5, lat: 57.820, lon: 28.330, region: 'Псков' },
  { name: 'р. Великая', cleanName: 'Великая', basin: 'baltic', wType: 'big_river', typeTag: 'Река большая', defDepth: 2.8, lat: 57.810, lon: 28.320, region: 'Псков' },

  // ==========================================
  // ЕНИСЕЙСКО-ЛЕНСКИЙ БАССЕЙН (Сибирь, Таймыр, Якутия)
  // ==========================================
  { name: 'р. Енисей (Красноярск)', cleanName: 'Енисей', basin: 'yenisei_lena', wType: 'big_river', typeTag: 'Река большая', defDepth: 6.8, lat: 56.010, lon: 92.870, region: 'Красноярск' },
  { name: 'Красноярское вдхр.', cleanName: 'Красноярское вдхр.', basin: 'yenisei_lena', wType: 'quarry', typeTag: 'Водохранилище', defDepth: 16.0, lat: 55.950, lon: 92.350, region: 'Дивногорск' },
  { name: 'р. Мана', cleanName: 'Мана', basin: 'yenisei_lena', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.2, lat: 55.950, lon: 92.480, region: 'Усть-Мана' },
  { name: 'р. Кан', cleanName: 'Кан', basin: 'yenisei_lena', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.4, lat: 56.200, lon: 95.700, region: 'Канск / Зеленогорск' },
  { name: 'оз. Белё / Шира (Хакасия)', cleanName: 'Белё', basin: 'yenisei_lena', wType: 'quarry', typeTag: 'Озеро глубокое', defDepth: 9.0, lat: 54.650, lon: 90.150, region: 'Хакасия' },
  { name: 'р. Енисей (Енисейск)', cleanName: 'Енисей', basin: 'yenisei_lena', wType: 'big_river', typeTag: 'Река большая', defDepth: 8.5, lat: 58.450, lon: 92.170, region: 'Енисейск' },
  { name: 'р. Енисей (Дудинка)', cleanName: 'Енисей (Низовья)', basin: 'yenisei_lena', wType: 'big_river', typeTag: 'Река большая', defDepth: 12.0, lat: 69.400, lon: 86.180, region: 'Дудинка' },
  { name: 'р. Норилка / оз. Лама (Норильск)', cleanName: 'Норилка / Лама', basin: 'yenisei_lena', wType: 'quarry', typeTag: 'Озеро глубокое', defDepth: 14.0, lat: 69.350, lon: 88.200, region: 'Норильск / Талнах' },
  { name: 'р. Ангара (Братское вдхр.)', cleanName: 'Ангара (Братское вдхр.)', basin: 'yenisei_lena', wType: 'quarry', typeTag: 'Водохранилище', defDepth: 14.0, lat: 56.150, lon: 101.600, region: 'Братск' },
  { name: 'р. Ангара (Усть-Илимское вдхр.)', cleanName: 'Усть-Илимское вдхр.', basin: 'yenisei_lena', wType: 'quarry', typeTag: 'Водохранилище', defDepth: 12.0, lat: 58.000, lon: 102.700, region: 'Усть-Илимск' },
  { name: 'р. Лена (Якутск)', cleanName: 'Лена', basin: 'yenisei_lena', wType: 'big_river', typeTag: 'Река большая', defDepth: 7.5, lat: 62.030, lon: 129.730, region: 'Якутск' },
  { name: 'р. Амга', cleanName: 'Амга', basin: 'yenisei_lena', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.5, lat: 60.900, lon: 131.980, region: 'Якутия' },
  { name: 'р. Лена (Ленск)', cleanName: 'Лена', basin: 'yenisei_lena', wType: 'big_river', typeTag: 'Река большая', defDepth: 5.8, lat: 60.720, lon: 114.930, region: 'Ленск' },
  { name: 'р. Вилюй', cleanName: 'Вилюй', basin: 'yenisei_lena', wType: 'big_river', typeTag: 'Река большая', defDepth: 4.5, lat: 62.080, lon: 120.420, region: 'Вилюйск' },
  { name: 'р. Алдан', cleanName: 'Алдан', basin: 'yenisei_lena', wType: 'big_river', typeTag: 'Река большая', defDepth: 4.8, lat: 58.960, lon: 126.280, region: 'Алдан / Томмот' },

  // ==========================================
  // БАЙКАЛО-АНГАРСКИЙ БАССЕЙН
  // ==========================================
  { name: 'р. Ангара (Иркутск)', cleanName: 'Ангара (Иркутск)', basin: 'baikal', wType: 'big_river', typeTag: 'Река большая', defDepth: 4.5, lat: 52.285, lon: 104.280, region: 'Иркутск' },
  { name: 'Иркутское вдхр.', cleanName: 'Иркутское вдхр.', basin: 'baikal', wType: 'quarry', typeTag: 'Водохранилище', defDepth: 8.5, lat: 52.150, lon: 104.450, region: 'Иркутск' },
  { name: 'р. Иркут', cleanName: 'Иркут', basin: 'baikal', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.2, lat: 52.260, lon: 104.200, region: 'Иркутск / Шелехов' },
  { name: 'оз. Байкал (Листвянка)', cleanName: 'Байкал (Листвянка)', basin: 'baikal', wType: 'quarry', typeTag: 'Озеро глубокое', defDepth: 22.0, lat: 51.850, lon: 104.860, region: 'Листвянка' },
  { name: 'оз. Байкал (Малое Море / Ольхон)', cleanName: 'Байкал (Малое Море)', basin: 'baikal', wType: 'quarry', typeTag: 'Озеро глубокое', defDepth: 14.0, lat: 53.200, lon: 107.350, region: 'Ольхон' },
  { name: 'оз. Байкал (Чивыркуйский залив)', cleanName: 'Чивыркуйский залив', basin: 'baikal', wType: 'quarry', typeTag: 'Озеро глубокое', defDepth: 8.5, lat: 53.700, lon: 109.150, region: 'Забайкальский нацпарк' },
  { name: 'оз. Байкал (Слюдянка)', cleanName: 'Байкал (Слюдянка)', basin: 'baikal', wType: 'quarry', typeTag: 'Озеро глубокое', defDepth: 18.0, lat: 51.660, lon: 103.710, region: 'Слюдянка' },
  { name: 'р. Селенга (Улан-Удэ / дельта)', cleanName: 'Селенга', basin: 'baikal', wType: 'big_river', typeTag: 'Река большая', defDepth: 4.2, lat: 51.830, lon: 107.580, region: 'Улан-Удэ' },
  { name: 'оз. Гусиное (Гусиноозёрская ГРЭС)', cleanName: 'Гусиное озеро (ГРЭС)', basin: 'baikal', wType: 'cooling_reservoir', typeTag: 'ГРЭС', defDepth: 5.5, lat: 51.200, lon: 106.400, region: 'Гусиноозёрск' },
  { name: 'р. Баргузин', cleanName: 'Баргузин', basin: 'baikal', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.6, lat: 53.620, lon: 109.620, region: 'Баргузинский р-н' },
  { name: 'р. Снежная', cleanName: 'Снежная', basin: 'baikal', wType: 'small_river', typeTag: 'Река малая', defDepth: 1.8, lat: 51.480, lon: 104.630, region: 'Байкальск' },
  { name: 'оз. Котокель', cleanName: 'Котокель', basin: 'baikal', wType: 'tundra_lake', typeTag: 'Озеро', defDepth: 3.5, lat: 52.800, lon: 108.150, region: 'Прибайкальский р-н' },

  // ==========================================
  // АМУРСКИЙ БАССЕЙН
  // ==========================================
  { name: 'р. Амур (Хабаровск)', cleanName: 'Амур', basin: 'amur', wType: 'big_river', typeTag: 'Река большая', defDepth: 6.5, lat: 48.480, lon: 135.070, region: 'Хабаровск' },
  { name: 'р. Анюй', cleanName: 'Анюй', basin: 'amur', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.4, lat: 49.300, lon: 136.500, region: 'Хабаровский край' },
  { name: 'р. Хор', cleanName: 'Хор', basin: 'amur', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.5, lat: 47.780, lon: 134.960, region: 'Хабаровский край' },
  { name: 'р. Амур (Благовещенск)', cleanName: 'Амур', basin: 'amur', wType: 'big_river', typeTag: 'Река большая', defDepth: 5.2, lat: 50.270, lon: 127.540, region: 'Благовещенск' },
  { name: 'р. Амур (Комсомольск-на-Амуре)', cleanName: 'Амур', basin: 'amur', wType: 'big_river', typeTag: 'Река большая', defDepth: 7.2, lat: 50.550, lon: 137.000, region: 'Комсомольск' },
  { name: 'р. Зея (Благовещенск)', cleanName: 'Зея', basin: 'amur', wType: 'big_river', typeTag: 'Река большая', defDepth: 4.2, lat: 50.300, lon: 127.600, region: 'Благовещенск' },
  { name: 'Зейское вдхр.', cleanName: 'Зейское вдхр.', basin: 'amur', wType: 'quarry', typeTag: 'Водохранилище', defDepth: 14.0, lat: 53.750, lon: 127.250, region: 'г. Зея' },
  { name: 'Бурейское вдхр.', cleanName: 'Бурейское вдхр.', basin: 'amur', wType: 'quarry', typeTag: 'Водохранилище', defDepth: 12.0, lat: 50.180, lon: 130.300, region: 'п. Талакан' },
  { name: 'р. Уссури', cleanName: 'Уссури', basin: 'amur', wType: 'big_river', typeTag: 'Река большая', defDepth: 3.6, lat: 45.460, lon: 133.420, region: 'Лесозаводск' },
  { name: 'оз. Ханка', cleanName: 'Ханка', basin: 'amur', wType: 'tundra_lake', typeTag: 'Озеро', defDepth: 2.8, lat: 44.990, lon: 132.060, region: 'Камень-Рыболов' },
  { name: 'оз. Болонь', cleanName: 'Болонь', basin: 'amur', wType: 'tundra_lake', typeTag: 'Озеро', defDepth: 2.2, lat: 49.850, lon: 136.450, region: 'Амурский р-н' },

  // ==========================================
  // ТИХООКЕАНСКИЙ БАССЕЙН (Приморье, Камчатка, Сахалин, Магадан)
  // ==========================================
  { name: 'Амурский залив (Владивосток)', cleanName: 'Амурский залив', basin: 'pacific_sea', wType: 'sea_gulf', typeTag: 'Морской залив', defDepth: 14.0, lat: 43.120, lon: 131.880, region: 'Владивосток' },
  { name: 'р. Раздольная (Суйфун)', cleanName: 'Раздольная', basin: 'pacific_sea', wType: 'big_river', typeTag: 'Река большая', defDepth: 3.2, lat: 43.350, lon: 131.800, region: 'Уссурийск / Тавричанка' },
  { name: 'Уссурийский залив (Шамора)', cleanName: 'Уссурийский залив', basin: 'pacific_sea', wType: 'sea_gulf', typeTag: 'Морской залив', defDepth: 11.0, lat: 43.190, lon: 132.120, region: 'Владивосток' },
  { name: 'Залив Находка', cleanName: 'Залив Находка', basin: 'pacific_sea', wType: 'sea_gulf', typeTag: 'Морской залив', defDepth: 15.0, lat: 42.820, lon: 132.880, region: 'Находка' },
  { name: 'Авачинская губа', cleanName: 'Авачинская губа', basin: 'pacific_sea', wType: 'sea_gulf', typeTag: 'Морская губа', defDepth: 16.0, lat: 53.020, lon: 158.650, region: 'Петропавловск-Камчатский' },
  { name: 'р. Авача', cleanName: 'Авача', basin: 'pacific_sea', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.0, lat: 53.180, lon: 158.380, region: 'Елизово' },
  { name: 'р. Паратунка', cleanName: 'Паратунка', basin: 'pacific_sea', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.2, lat: 52.960, lon: 158.250, region: 'Елизово / Камчатка' },
  { name: 'р. Камчатка', cleanName: 'Камчатка', basin: 'pacific_sea', wType: 'big_river', typeTag: 'Река большая', defDepth: 4.5, lat: 56.320, lon: 160.840, region: 'п. Ключи' },
  { name: 'р. Быстрая (Большая)', cleanName: 'Быстрая (Большая)', basin: 'pacific_sea', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.4, lat: 52.750, lon: 156.300, region: 'Усть-Большерецк' },
  { name: 'Охотское море (бухта Нагаева)', cleanName: 'Бухта Нагаева', basin: 'pacific_sea', wType: 'sea_gulf', typeTag: 'Морской залив', defDepth: 18.0, lat: 59.560, lon: 150.800, region: 'Магадан' },
  { name: 'Анивский залив', cleanName: 'Анивский залив', basin: 'pacific_sea', wType: 'sea_gulf', typeTag: 'Морской залив', defDepth: 12.0, lat: 46.620, lon: 142.770, region: 'Корсаков / Сахалин' },
  { name: 'оз. Тунайча (Сахалин)', cleanName: 'Тунайча', basin: 'pacific_sea', wType: 'quarry', typeTag: 'Озеро глубокое', defDepth: 9.0, lat: 46.820, lon: 143.150, region: 'Южно-Сахалинск' },
  { name: 'р. Лютога (Сахалин)', cleanName: 'Лютога', basin: 'pacific_sea', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.0, lat: 46.780, lon: 142.520, region: 'Анива / Сахалин' },
  { name: 'р. Тымь', cleanName: 'Тымь', basin: 'pacific_sea', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.2, lat: 50.850, lon: 142.680, region: 'Тымовское / Сахалин' },

  // ==========================================
  // ДНЕПРОВСКО-ДОНСКОЙ (ЮГО-ЗАПАДНЫЙ) БАССЕЙН
  // ==========================================
  { name: 'р. Днепр (Смоленск)', cleanName: 'Днепр', basin: 'euro_west', wType: 'big_river', typeTag: 'Река большая', defDepth: 2.8, lat: 54.780, lon: 32.050, region: 'Смоленск' },
  { name: 'Десногорское вдхр. (Смоленская АЭС)', cleanName: 'Десногорское вдхр.', basin: 'euro_west', wType: 'cooling_reservoir', typeTag: 'ГРЭС/АЭС', defDepth: 6.5, lat: 54.150, lon: 33.280, region: 'Десногорск' },
  { name: 'р. Десна (Брянск)', cleanName: 'Десна', basin: 'euro_west', wType: 'big_river', typeTag: 'Река большая', defDepth: 3.2, lat: 53.250, lon: 34.370, region: 'Брянск' },
  { name: 'р. Сейм (Курск)', cleanName: 'Сейм', basin: 'euro_west', wType: 'big_river', typeTag: 'Река большая', defDepth: 2.6, lat: 51.730, lon: 36.190, region: 'Курск' },
  { name: 'Курчатовское вдхр. (Курская АЭС)', cleanName: 'Курчатовское вдхр.', basin: 'euro_west', wType: 'cooling_reservoir', typeTag: 'ГРЭС/АЭС', defDepth: 5.8, lat: 51.650, lon: 35.650, region: 'Курчатов' },
  { name: 'р. Оскол', cleanName: 'Оскол', basin: 'euro_west', wType: 'small_river', typeTag: 'Река малая', defDepth: 2.1, lat: 51.300, lon: 37.830, region: 'Старый Оскол' },
  { name: 'Старооскольское вдхр.', cleanName: 'Старооскольское вдхр.', basin: 'euro_west', wType: 'quarry', typeTag: 'Водохранилище', defDepth: 5.2, lat: 51.400, lon: 37.950, region: 'Старый Оскол' },
  { name: 'Белгородское вдхр.', cleanName: 'Белгородское вдхр.', basin: 'euro_west', wType: 'quarry', typeTag: 'Водохранилище', defDepth: 4.8, lat: 50.590, lon: 36.590, region: 'Белгород' }
];

export const RUSSIA_CITIES = [
  { name: 'Новый Уренгой', lat: 66.083, lon: 76.680, admin1: 'Ямало-Ненецкий АО' },
  { name: 'Салехард', lat: 66.530, lon: 66.600, admin1: 'Ямало-Ненецкий АО' },
  { name: 'Надым', lat: 65.533, lon: 72.520, admin1: 'Ямало-Ненецкий АО' },
  { name: 'Ноябрьск', lat: 63.200, lon: 75.450, admin1: 'Ямало-Ненецкий АО' },
  { name: 'Тарко-Сале', lat: 64.915, lon: 77.780, admin1: 'Ямало-Ненецкий АО' },
  { name: 'Губкинский', lat: 64.434, lon: 76.502, admin1: 'Ямало-Ненецкий АО' },
  { name: 'Сургут', lat: 61.250, lon: 73.400, admin1: 'Ханты-Мансийский АО' },
  { name: 'Нижневартовск', lat: 60.930, lon: 76.550, admin1: 'Ханты-Мансийский АО' },
  { name: 'Ханты-Мансийск', lat: 61.000, lon: 69.020, admin1: 'Ханты-Мансийский АО' },
  { name: 'Москва', lat: 55.7558, lon: 37.6173, admin1: 'Москва' },
  { name: 'Санкт-Петербург', lat: 59.9343, lon: 30.3351, admin1: 'Санкт-Петербург' },
  { name: 'Петрозаводск', lat: 61.7850, lon: 34.3469, admin1: 'Республика Карелия' },
  { name: 'Мурманск', lat: 68.9707, lon: 33.0750, admin1: 'Мурманская обл.' },
  { name: 'Архангельск', lat: 64.5399, lon: 40.5158, admin1: 'Архангельская обл.' },
  { name: 'Калининград', lat: 54.7104, lon: 20.4522, admin1: 'Калининградская обл.' },
  { name: 'Севастополь', lat: 44.6166, lon: 33.5254, admin1: 'Севастополь' },
  { name: 'Ялта', lat: 44.4952, lon: 34.1663, admin1: 'Республика Крым' },
  { name: 'Сочи', lat: 43.5855, lon: 39.7231, admin1: 'Краснодарский край' },
  { name: 'Краснодар', lat: 45.0355, lon: 38.9753, admin1: 'Краснодарский край' },
  { name: 'Ростов-на-Дону', lat: 47.2225, lon: 39.7187, admin1: 'Ростовская обл.' },
  { name: 'Воронеж', lat: 51.6608, lon: 39.2003, admin1: 'Воронежская обл.' },
  { name: 'Астрахань', lat: 46.3497, lon: 48.0408, admin1: 'Астраханская обл.' },
  { name: 'Волгоград', lat: 48.7080, lon: 44.5133, admin1: 'Волгоградская обл.' },
  { name: 'Саратов', lat: 51.5336, lon: 46.0343, admin1: 'Саратовская обл.' },
  { name: 'Казань', lat: 55.7961, lon: 49.1064, admin1: 'Республика Татарстан' },
  { name: 'Нижний Новгород', lat: 56.3269, lon: 44.0059, admin1: 'Нижегородская обл.' },
  { name: 'Самара', lat: 53.1959, lon: 50.1002, admin1: 'Самарская обл.' },
  { name: 'Уфа', lat: 54.7388, lon: 55.9721, admin1: 'Республика Башкортостан' },
  { name: 'Пермь', lat: 58.0105, lon: 56.2502, admin1: 'Пермский край' },
  { name: 'Екатеринбург', lat: 56.8389, lon: 60.6057, admin1: 'Свердловская обл.' },
  { name: 'Челябинск', lat: 55.1644, lon: 61.4368, admin1: 'Челябинская обл.' },
  { name: 'Тюмень', lat: 57.1530, lon: 65.5343, admin1: 'Тюменская обл.' },
  { name: 'Омск', lat: 54.9885, lon: 73.3242, admin1: 'Омская обл.' },
  { name: 'Новосибирск', lat: 55.0084, lon: 82.9357, admin1: 'Новосибирская обл.' },
  { name: 'Барнаул', lat: 53.3474, lon: 83.7784, admin1: 'Алтайский край' },
  { name: 'Красноярск', lat: 56.0153, lon: 92.8932, admin1: 'Красноярский край' },
  { name: 'Иркутск', lat: 52.2864, lon: 104.3050, admin1: 'Иркутская обл.' },
  { name: 'Улан-Удэ', lat: 51.8335, lon: 107.5841, admin1: 'Республика Бурятия' },
  { name: 'Якутск', lat: 62.0355, lon: 129.6755, admin1: 'Республика Саха (Якутия)' },
  { name: 'Хабаровск', lat: 48.4802, lon: 135.0719, admin1: 'Хабаровский край' },
  { name: 'Владивосток', lat: 43.1155, lon: 131.8855, admin1: 'Приморский край' },
  { name: 'Петропавловск-Камчатский', lat: 53.0452, lon: 158.6508, admin1: 'Камчатский край' },
  { name: 'Южно-Сахалинск', lat: 46.9591, lon: 142.7380, admin1: 'Сахалинская обл.' }
];

export function calcHaversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

export function getWaterTypeShortTag(wType) {
  switch (wType) {
    case 'big_river': return 'Река большая';
    case 'small_river': return 'Река малая';
    case 'quarry': return 'Озеро / Карьер / Вдхр';
    case 'tundra_lake': return 'Озеро / Старица';
    case 'cooling_reservoir': return 'ГРЭС / Тёплый сброс';
    case 'sea_gulf': return 'Морской залив / Губа';
    case 'open_sea': return 'Открытое море';
    default: return 'Водоём';
  }
}

export function getNearestRussianWaters(lat, lon, basinCode, isCoastal, maxCount = 14, radiusKm = 50) {
  const effRadius = Number.isFinite(radiusKm) && radiusKm > 0 ? radiusKm : 50;

  const calculated = RUSSIA_WATERS.map(w => {
    const distKm = calcHaversine(lat, lon, w.lat, w.lon);
    let penalty = 0;
    if (w.basin !== basinCode) penalty += 500;
    if (!isCoastal && (w.wType === 'sea_gulf' || w.wType === 'open_sea')) penalty += 2000;
    return {
      ...w,
      distKm,
      sortScore: distKm + penalty
    };
  });

  calculated.sort((a, b) => a.sortScore - b.sortScore);

  // Сначала берём водоёмы строго внутри выбранного радиуса («До 50 км» или «До 120 км»)
  let withinRadius = calculated.filter(w => w.distKm <= effRadius && (isCoastal || !w.wType.startsWith('sea')));
  // Если точка поставлена в удалённой тундре/тайге, где в базе нет объектов ближе effRadius, показываем ближайшие 4 водоёма бассейна с честным расстоянием
  if (withinRadius.length === 0) {
    withinRadius = calculated.slice(0, 4);
  } else {
    withinRadius = withinRadius.slice(0, maxCount);
  }

  return withinRadius.map(w => {
    const isRiver = w.wType === 'big_river' || w.wType === 'small_river' || w.name.startsWith('р.');
    const prefix = isRiver ? '🌊 ' : (w.wType.startsWith('sea') ? '⚓ ' : (w.wType === 'cooling_reservoir' ? '♨️ ' : '💧 '));
    const distStr = w.distKm < 1 ? `${Math.round(w.distKm * 1000)} м` : `${w.distKm} км`;
    const tag = w.typeTag || getWaterTypeShortTag(w.wType);
    return {
      name: w.cleanName,
      label: `${prefix}${w.name} [${tag}] • ${distStr}`,
      wType: w.wType,
      typeTag: tag,
      defDepth: w.defDepth,
      distKm: w.distKm,
      lat: w.lat,
      lon: w.lon
    };
  });
}
