/**
 * Офлайн-база гидрографической сети Российской Федерации.
 * Обеспечивает мгновенное отображение ближайших водоёмов даже при отсутствии сети
 * или блокировках Overpass API. Охватывает все 11 рыбохозяйственных бассейнов РФ.
 */

export const RUSSIA_WATERS = [
  // ==========================================
  // ОБЬ-ТАЗОВСКИЙ БАССЕЙН (ЯНАО, ХМАО, Обь, Пур, Таз)
  // ==========================================
  { name: 'р. Седе-Яха', cleanName: 'Седе-Яха', basin: 'arctic_ob_taz', wType: 'small_river', defDepth: 1.4, lat: 66.083, lon: 76.680, region: 'Новый Уренгой' },
  { name: 'р. Варенга-Яха', cleanName: 'Варенга-Яха', basin: 'arctic_ob_taz', wType: 'small_river', defDepth: 1.6, lat: 66.035, lon: 77.520, region: 'Новый Уренгой / Коротчаево' },
  { name: 'р. Тамчара-Яха', cleanName: 'Тамчара-Яха', basin: 'arctic_ob_taz', wType: 'small_river', defDepth: 1.3, lat: 66.065, lon: 76.630, region: 'Новый Уренгой' },
  { name: 'р. Пур (Коротчаево / Уренгой)', cleanName: 'Пур (Коротчаево)', basin: 'arctic_ob_taz', wType: 'big_river', defDepth: 4.5, lat: 65.945, lon: 78.180, region: 'Коротчаево / пгт. Уренгой' },
  { name: 'р. Хадуттэ', cleanName: 'Хадуттэ', basin: 'arctic_ob_taz', wType: 'small_river', defDepth: 2.2, lat: 66.480, lon: 76.850, region: 'Новый Уренгой / Тазовский р-н' },
  { name: 'р. Правая Хетта', cleanName: 'Правая Хетта', basin: 'arctic_ob_taz', wType: 'small_river', defDepth: 2.0, lat: 65.850, lon: 74.500, region: 'Пангоды / Надымский р-н' },
  { name: 'Песчаные карьеры (Н. Уренгой)', cleanName: 'Карьеры Н. Уренгоя', basin: 'arctic_ob_taz', wType: 'quarry', defDepth: 3.5, lat: 66.055, lon: 76.740, region: 'Новый Уренгой' },
  { name: 'р. Ево-Яха', cleanName: 'Ево-Яха', basin: 'arctic_ob_taz', wType: 'small_river', defDepth: 1.6, lat: 66.071, lon: 76.712, region: 'Новый Уренгой' },
  { name: 'оз. Молодёжное', cleanName: 'Молодёжное', basin: 'arctic_ob_taz', wType: 'tundra_lake', defDepth: 1.8, lat: 66.090, lon: 76.690, region: 'Новый Уренгой' },
  { name: 'р. Тамбей-Яха', cleanName: 'Тамбей-Яха', basin: 'arctic_ob_taz', wType: 'small_river', defDepth: 1.2, lat: 66.120, lon: 76.550, region: 'ЯНАО / Уренгой' },
  { name: 'р. Пур', cleanName: 'Пур', basin: 'arctic_ob_taz', wType: 'big_river', defDepth: 4.2, lat: 64.915, lon: 77.780, region: 'пгт. Уренгой / Тарко-Сале' },
  { name: 'р. Пяку-Пур', cleanName: 'Пяку-Пур', basin: 'arctic_ob_taz', wType: 'small_river', defDepth: 2.2, lat: 64.900, lon: 77.750, region: 'Тарко-Сале' },
  { name: 'р. Айваседа-Пур', cleanName: 'Айваседа-Пур', basin: 'arctic_ob_taz', wType: 'small_river', defDepth: 2.0, lat: 64.910, lon: 77.800, region: 'Тарко-Сале' },
  { name: 'р. Таз', cleanName: 'Таз', basin: 'arctic_ob_taz', wType: 'big_river', defDepth: 4.8, lat: 67.450, lon: 78.700, region: 'п. Тазовский' },
  { name: 'р. Надым', cleanName: 'Надым', basin: 'arctic_ob_taz', wType: 'big_river', defDepth: 3.8, lat: 65.533, lon: 72.520, region: 'г. Надым' },
  { name: 'оз. Янтарное', cleanName: 'Янтарное', basin: 'arctic_ob_taz', wType: 'tundra_lake', defDepth: 2.1, lat: 65.540, lon: 72.500, region: 'г. Надым' },
  { name: 'оз. Ханто', cleanName: 'Ханто', basin: 'arctic_ob_taz', wType: 'tundra_lake', defDepth: 2.5, lat: 63.220, lon: 75.430, region: 'г. Ноябрьск' },
  { name: 'р. Нанкпёх', cleanName: 'Нанкпёх', basin: 'arctic_ob_taz', wType: 'small_river', defDepth: 1.3, lat: 63.200, lon: 75.400, region: 'г. Ноябрьск' },
  { name: 'р. Обь (Салехард)', cleanName: 'Обь', basin: 'arctic_ob_taz', wType: 'big_river', defDepth: 7.5, lat: 66.530, lon: 66.600, region: 'Салехард / Лабытнанги' },
  { name: 'р. Полуй', cleanName: 'Полуй', basin: 'arctic_ob_taz', wType: 'small_river', defDepth: 2.4, lat: 66.520, lon: 66.620, region: 'Салехард' },
  { name: 'р. Собь', cleanName: 'Собь', basin: 'arctic_ob_taz', wType: 'small_river', defDepth: 1.8, lat: 66.820, lon: 65.800, region: 'Харп / Полярный Урал' },
  { name: 'р. Обь (Сургут)', cleanName: 'Обь', basin: 'arctic_ob_taz', wType: 'big_river', defDepth: 6.8, lat: 61.250, lon: 73.400, region: 'Сургут' },
  { name: 'р. Обь (Нижневартовск)', cleanName: 'Обь', basin: 'arctic_ob_taz', wType: 'big_river', defDepth: 6.5, lat: 60.930, lon: 76.550, region: 'Нижневартовск' },
  { name: 'р. Вах', cleanName: 'Вах', basin: 'arctic_ob_taz', wType: 'big_river', defDepth: 4.0, lat: 60.980, lon: 76.900, region: 'ХМАО-Югра' },
  { name: 'р. Иртыш (Ханты-Мансийск)', cleanName: 'Иртыш', basin: 'arctic_ob_taz', wType: 'big_river', defDepth: 6.0, lat: 61.000, lon: 69.020, region: 'Ханты-Мансийск' },
  { name: 'р. Иртыш (Тобольск)', cleanName: 'Иртыш', basin: 'arctic_ob_taz', wType: 'big_river', defDepth: 5.5, lat: 58.190, lon: 68.250, region: 'Тобольск' },
  { name: 'Тазовская губа', cleanName: 'Тазовская губа', basin: 'arctic_ob_taz', wType: 'sea_gulf', defDepth: 4.5, lat: 68.000, lon: 76.000, region: 'ЯНАО / Карское море' },
  { name: 'Обская губа', cleanName: 'Обская губа', basin: 'arctic_ob_taz', wType: 'sea_gulf', defDepth: 6.0, lat: 68.500, lon: 73.500, region: 'ЯНАО / Карское море' },

  // ==========================================
  // ВОЛЖСКО-КАСПИЙСКИЙ БАССЕЙН (Волга, Ока, Кама, Урал)
  // ==========================================
  { name: 'р. Москва', cleanName: 'Москва-река', basin: 'volga_caspian', wType: 'big_river', defDepth: 3.5, lat: 55.750, lon: 37.620, region: 'Москва' },
  { name: 'р. Яуза', cleanName: 'Яуза', basin: 'volga_caspian', wType: 'small_river', defDepth: 1.8, lat: 55.755, lon: 37.645, region: 'Москва' },
  { name: 'Пироговское вдхр.', cleanName: 'Пироговское вдхр.', basin: 'volga_caspian', wType: 'quarry', defDepth: 5.2, lat: 55.980, lon: 37.700, region: 'Московская обл.' },
  { name: 'Клязьминское вдхр.', cleanName: 'Клязьминское вдхр.', basin: 'volga_caspian', wType: 'quarry', defDepth: 4.8, lat: 55.990, lon: 37.580, region: 'Московская обл.' },
  { name: 'Иваньковское вдхр. (Московское море)', cleanName: 'Иваньковское вдхр.', basin: 'volga_caspian', wType: 'quarry', defDepth: 5.5, lat: 56.750, lon: 36.950, region: 'Дубна / Тверь' },
  { name: 'р. Волга (Тверь)', cleanName: 'Волга', basin: 'volga_caspian', wType: 'big_river', defDepth: 4.2, lat: 56.860, lon: 35.900, region: 'Тверь' },
  { name: 'р. Тверца', cleanName: 'Тверца', basin: 'volga_caspian', wType: 'small_river', defDepth: 2.1, lat: 56.870, lon: 35.920, region: 'Тверь' },
  { name: 'р. Волга (Ярославль)', cleanName: 'Волга', basin: 'volga_caspian', wType: 'big_river', defDepth: 5.8, lat: 57.620, lon: 39.890, region: 'Ярославль' },
  { name: 'р. Которосль', cleanName: 'Которосль', basin: 'volga_caspian', wType: 'small_river', defDepth: 2.2, lat: 57.610, lon: 39.880, region: 'Ярославль' },
  { name: 'Рыбинское вдхр.', cleanName: 'Рыбинское вдхр.', basin: 'volga_caspian', wType: 'quarry', defDepth: 6.8, lat: 58.200, lon: 38.500, region: 'Рыбинск' },
  { name: 'р. Ока (Коломна)', cleanName: 'Ока', basin: 'volga_caspian', wType: 'big_river', defDepth: 3.8, lat: 55.080, lon: 38.770, region: 'Коломна' },
  { name: 'р. Ока (Рязань)', cleanName: 'Ока', basin: 'volga_caspian', wType: 'big_river', defDepth: 4.2, lat: 54.630, lon: 39.750, region: 'Рязань' },
  { name: 'р. Ока (Нижний Новгород)', cleanName: 'Ока', basin: 'volga_caspian', wType: 'big_river', defDepth: 5.0, lat: 56.320, lon: 43.990, region: 'Нижний Новгород' },
  { name: 'р. Волга (Нижний Новгород)', cleanName: 'Волга', basin: 'volga_caspian', wType: 'big_river', defDepth: 6.5, lat: 56.330, lon: 44.010, region: 'Нижний Новгород' },
  { name: 'Горьковское вдхр.', cleanName: 'Горьковское вдхр.', basin: 'volga_caspian', wType: 'quarry', defDepth: 6.2, lat: 56.800, lon: 43.400, region: 'Нижегородская обл.' },
  { name: 'Чебоксарское вдхр.', cleanName: 'Чебоксарское вдхр.', basin: 'volga_caspian', wType: 'quarry', defDepth: 5.8, lat: 56.140, lon: 47.250, region: 'Чебоксары' },
  { name: 'р. Волга (Казань)', cleanName: 'Волга', basin: 'volga_caspian', wType: 'big_river', defDepth: 7.2, lat: 55.790, lon: 49.120, region: 'Казань' },
  { name: 'р. Казанка', cleanName: 'Казанка', basin: 'volga_caspian', wType: 'small_river', defDepth: 2.0, lat: 55.800, lon: 49.110, region: 'Казань' },
  { name: 'р. Кама (Пермь)', cleanName: 'Кама', basin: 'volga_caspian', wType: 'big_river', defDepth: 6.2, lat: 58.010, lon: 56.250, region: 'Пермь' },
  { name: 'Камское вдхр.', cleanName: 'Камское вдхр.', basin: 'volga_caspian', wType: 'quarry', defDepth: 6.5, lat: 58.150, lon: 56.350, region: 'Пермский край' },
  { name: 'Куйбышевское вдхр. (Самара)', cleanName: 'Куйбышевское вдхр.', basin: 'volga_caspian', wType: 'quarry', defDepth: 8.5, lat: 53.200, lon: 50.150, region: 'Самара' },
  { name: 'р. Самара', cleanName: 'Самара', basin: 'volga_caspian', wType: 'small_river', defDepth: 2.5, lat: 53.180, lon: 50.110, region: 'Самара' },
  { name: 'Саратовское вдхр.', cleanName: 'Саратовское вдхр.', basin: 'volga_caspian', wType: 'quarry', defDepth: 7.8, lat: 51.530, lon: 46.030, region: 'Саратов' },
  { name: 'Волгоградское вдхр.', cleanName: 'Волгоградское вдхр.', basin: 'volga_caspian', wType: 'quarry', defDepth: 8.2, lat: 48.710, lon: 44.510, region: 'Волгоград' },
  { name: 'р. Волга (Астрахань / Дельта)', cleanName: 'Волга (Дельта)', basin: 'volga_caspian', wType: 'big_river', defDepth: 5.5, lat: 46.350, lon: 48.040, region: 'Астрахань' },
  { name: 'р. Ахтуба (Волго-Ахтубинская пойма)', cleanName: 'Ахтуба', basin: 'volga_caspian', wType: 'big_river', defDepth: 3.8, lat: 48.000, lon: 45.500, region: 'Ахтубинск / Харабали' },
  { name: 'р. Белая (Уфа)', cleanName: 'Белая (Агидель)', basin: 'volga_caspian', wType: 'big_river', defDepth: 3.6, lat: 54.730, lon: 55.970, region: 'Уфа' },
  { name: 'р. Вятка (Киров)', cleanName: 'Вятка', basin: 'volga_caspian', wType: 'big_river', defDepth: 3.2, lat: 58.600, lon: 49.660, region: 'Киров' },
  { name: 'р. Урал (Оренбург)', cleanName: 'Урал', basin: 'volga_caspian', wType: 'big_river', defDepth: 2.8, lat: 51.770, lon: 55.100, region: 'Оренбург' },
  { name: 'р. Урал (Магнитогорск)', cleanName: 'Урал', basin: 'volga_caspian', wType: 'small_river', defDepth: 2.2, lat: 53.420, lon: 58.980, region: 'Магнитогорск' },
  { name: 'оз. Селигер', cleanName: 'Селигер', basin: 'volga_caspian', wType: 'quarry', defDepth: 5.8, lat: 57.200, lon: 33.050, region: 'Осташков' },
  { name: 'оз. Неро', cleanName: 'Неро', basin: 'volga_caspian', wType: 'tundra_lake', defDepth: 1.5, lat: 57.170, lon: 39.430, region: 'Ростов Великий' },
  { name: 'Каспийское море (Махачкала)', cleanName: 'Каспийское море', basin: 'volga_caspian', wType: 'sea_gulf', defDepth: 6.5, lat: 42.980, lon: 47.510, region: 'Махачкала' },
  { name: 'Каспийское море (Дербент)', cleanName: 'Каспийское море', basin: 'volga_caspian', wType: 'open_sea', defDepth: 12.0, lat: 42.070, lon: 48.290, region: 'Дербент' },

  // ==========================================
  // ЛАДОЖСКО-ОНЕЖСКИЙ И КАРЕЛЬСКИЙ БАССЕЙН
  // ==========================================
  { name: 'Ладожское озеро', cleanName: 'Ладожское озеро', basin: 'nw_karelia', wType: 'quarry', defDepth: 12.0, lat: 60.500, lon: 31.000, region: 'Приозерск / Шлиссельбург' },
  { name: 'Онежское озеро', cleanName: 'Онежское озеро', basin: 'nw_karelia', wType: 'quarry', defDepth: 14.0, lat: 61.790, lon: 34.370, region: 'Петрозаводск' },
  { name: 'р. Нева', cleanName: 'Нева', basin: 'nw_karelia', wType: 'big_river', defDepth: 6.5, lat: 59.930, lon: 30.340, region: 'Санкт-Петербург' },
  { name: 'р. Вуокса', cleanName: 'Вуокса', basin: 'nw_karelia', wType: 'big_river', defDepth: 4.5, lat: 60.680, lon: 30.000, region: 'Лосево / Приозерск' },
  { name: 'р. Свирь', cleanName: 'Свирь', basin: 'nw_karelia', wType: 'big_river', defDepth: 5.2, lat: 60.910, lon: 34.170, region: 'Подпорожье' },
  { name: 'р. Волхов', cleanName: 'Волхов', basin: 'nw_karelia', wType: 'big_river', defDepth: 4.8, lat: 60.100, lon: 32.300, region: 'Новая Ладога' },
  { name: 'оз. Сямозеро', cleanName: 'Сямозеро', basin: 'nw_karelia', wType: 'quarry', defDepth: 6.0, lat: 61.900, lon: 33.150, region: 'Пряжинский р-н' },
  { name: 'оз. Сегозеро', cleanName: 'Сегозеро', basin: 'nw_karelia', wType: 'quarry', defDepth: 18.0, lat: 63.300, lon: 33.800, region: 'Медвежьегорский р-н' },
  { name: 'оз. Выгозеро', cleanName: 'Выгозеро', basin: 'nw_karelia', wType: 'quarry', defDepth: 7.0, lat: 63.600, lon: 34.700, region: 'Сегежа' },
  { name: 'р. Суна', cleanName: 'Суна', basin: 'nw_karelia', wType: 'small_river', defDepth: 2.2, lat: 62.270, lon: 33.980, region: 'Кивач' },
  { name: 'оз. Пяозеро / Топозеро', cleanName: 'Пяозеро', basin: 'nw_karelia', wType: 'quarry', defDepth: 15.0, lat: 65.800, lon: 31.000, region: 'Северная Карелия' },

  // ==========================================
  // БАРЕНЦЕВО-БЕЛОМОРСКИЙ АРКТИЧЕСКИЙ БАССЕЙН
  // ==========================================
  { name: 'Баренцево море (Териберка)', cleanName: 'Баренцево море (Териберка)', basin: 'barents_white', wType: 'open_sea', defDepth: 25.0, lat: 69.170, lon: 35.140, region: 'Териберка' },
  { name: 'Кольский залив (Мурманск)', cleanName: 'Кольский залив', basin: 'barents_white', wType: 'sea_gulf', defDepth: 18.0, lat: 68.970, lon: 33.080, region: 'Мурманск' },
  { name: 'Белое море (Кандалакшский залив)', cleanName: 'Кандалакшский залив', basin: 'barents_white', wType: 'sea_gulf', defDepth: 12.0, lat: 67.150, lon: 32.400, region: 'Кандалакша' },
  { name: 'Белое море (Онежская губа)', cleanName: 'Онежская губа', basin: 'barents_white', wType: 'sea_gulf', defDepth: 9.0, lat: 64.000, lon: 37.500, region: 'Онега' },
  { name: 'р. Кола', cleanName: 'Кола', basin: 'barents_white', wType: 'small_river', defDepth: 1.8, lat: 68.880, lon: 33.020, region: 'п. Молочный' },
  { name: 'р. Тулома', cleanName: 'Тулома', basin: 'barents_white', wType: 'big_river', defDepth: 4.5, lat: 68.810, lon: 32.810, region: 'Мурмаши' },
  { name: 'р. Варзуга', cleanName: 'Варзуга', basin: 'barents_white', wType: 'small_river', defDepth: 1.6, lat: 66.400, lon: 36.580, region: 'Терский берег' },
  { name: 'р. Умба', cleanName: 'Умба', basin: 'barents_white', wType: 'small_river', defDepth: 2.0, lat: 66.680, lon: 34.350, region: 'Терский берег' },
  { name: 'р. Поной', cleanName: 'Поной', basin: 'barents_white', wType: 'small_river', defDepth: 2.2, lat: 67.070, lon: 39.500, region: 'Кольский п-ов' },
  { name: 'оз. Имандра', cleanName: 'Имандра', basin: 'barents_white', wType: 'quarry', defDepth: 10.0, lat: 67.600, lon: 33.100, region: 'Апатиты / Мончегорск' },
  { name: 'оз. Ловозеро', cleanName: 'Ловозеро', basin: 'barents_white', wType: 'quarry', defDepth: 8.0, lat: 67.850, lon: 35.150, region: 'Ловозерский р-н' },
  { name: 'р. Печора (Нарьян-Мар)', cleanName: 'Печора', basin: 'barents_white', wType: 'big_river', defDepth: 6.0, lat: 67.640, lon: 53.000, region: 'Ненецкий АО' },
  { name: 'р. Печора (г. Печора)', cleanName: 'Печора', basin: 'barents_white', wType: 'big_river', defDepth: 4.8, lat: 65.140, lon: 57.220, region: 'Республика Коми' },

  // ==========================================
  // ЧЕРНОМОРСКО-АЗОВСКИЙ БАССЕЙН (Дон, Кубань, Крым, Кавказ)
  // ==========================================
  { name: 'р. Дон (Ростов-на-Дону)', cleanName: 'Дон', basin: 'black_azov', wType: 'big_river', defDepth: 5.5, lat: 47.220, lon: 39.720, region: 'Ростов-на-Дону' },
  { name: 'р. Дон (Воронеж)', cleanName: 'Дон', basin: 'black_azov', wType: 'big_river', defDepth: 3.8, lat: 50.980, lon: 39.500, region: 'Лиски / Воронеж' },
  { name: 'р. Воронеж', cleanName: 'Воронеж', basin: 'black_azov', wType: 'small_river', defDepth: 2.2, lat: 51.670, lon: 39.200, region: 'Воронеж' },
  { name: 'Цимлянское вдхр.', cleanName: 'Цимлянское вдхр.', basin: 'black_azov', wType: 'quarry', defDepth: 8.0, lat: 47.600, lon: 42.100, region: 'Волгодонск' },
  { name: 'р. Маныч (Весёловское вдхр.)', cleanName: 'Маныч', basin: 'black_azov', wType: 'quarry', defDepth: 4.2, lat: 47.100, lon: 40.800, region: 'п. Весёлый' },
  { name: 'р. Северский Донец', cleanName: 'Северский Донец', basin: 'black_azov', wType: 'big_river', defDepth: 3.2, lat: 48.320, lon: 40.260, region: 'Каменск-Шахтинский' },
  { name: 'р. Кубань (Краснодар)', cleanName: 'Кубань', basin: 'black_azov', wType: 'big_river', defDepth: 4.0, lat: 45.030, lon: 38.980, region: 'Краснодар' },
  { name: 'Краснодарское вдхр. (Кубанское море)', cleanName: 'Краснодарское вдхр.', basin: 'black_azov', wType: 'quarry', defDepth: 6.2, lat: 44.980, lon: 39.250, region: 'Краснодар' },
  { name: 'р. Кубань (Темрюк / дельта)', cleanName: 'Кубань (Дельта)', basin: 'black_azov', wType: 'big_river', defDepth: 3.5, lat: 45.270, lon: 37.380, region: 'Темрюк' },
  { name: 'Чёрное море (Севастопольские бухты)', cleanName: 'Севастопольские бухты', basin: 'black_azov', wType: 'sea_gulf', defDepth: 8.5, lat: 44.620, lon: 33.530, region: 'Севастополь' },
  { name: 'р. Чёрная (Инкерман)', cleanName: 'р. Чёрная', basin: 'black_azov', wType: 'small_river', defDepth: 1.5, lat: 44.610, lon: 33.600, region: 'Севастополь / Инкерман' },
  { name: 'Чёрное море (ЮБК / Ялта)', cleanName: 'Чёрное море (ЮБК)', basin: 'black_azov', wType: 'open_sea', defDepth: 15.0, lat: 44.500, lon: 34.170, region: 'Ялта' },
  { name: 'Цемесская бухта (Новороссийск)', cleanName: 'Цемесская бухта', basin: 'black_azov', wType: 'sea_gulf', defDepth: 12.0, lat: 44.720, lon: 37.780, region: 'Новороссийск' },
  { name: 'Чёрное море (Сочи / Адлер)', cleanName: 'Чёрное море (Сочи)', basin: 'black_azov', wType: 'open_sea', defDepth: 16.0, lat: 43.590, lon: 39.730, region: 'Сочи' },
  { name: 'р. Мзымта', cleanName: 'Мзымта', basin: 'black_azov', wType: 'small_river', defDepth: 1.8, lat: 43.420, lon: 39.920, region: 'Адлер' },
  { name: 'Азовское море (Таганрогский залив)', cleanName: 'Таганрогский залив', basin: 'black_azov', wType: 'sea_gulf', defDepth: 4.5, lat: 47.200, lon: 38.920, region: 'Таганрог' },
  { name: 'Ейский лиман', cleanName: 'Ейский лиман', basin: 'black_azov', wType: 'sea_gulf', defDepth: 2.8, lat: 46.700, lon: 38.300, region: 'Ейск' },
  { name: 'оз. Абрау', cleanName: 'Абрау', basin: 'black_azov', wType: 'quarry', defDepth: 7.0, lat: 44.700, lon: 37.600, region: 'Абрау-Дюрсо' },

  // ==========================================
  // БАЛТИЙСКИЙ МОРСКОЙ БАССЕЙН
  // ==========================================
  { name: 'Финский залив (Маркизова лужа)', cleanName: 'Финский залив', basin: 'baltic', wType: 'sea_gulf', defDepth: 5.5, lat: 59.950, lon: 30.200, region: 'Санкт-Петербург' },
  { name: 'Выборгский залив', cleanName: 'Выборгский залив', basin: 'baltic', wType: 'sea_gulf', defDepth: 7.2, lat: 60.710, lon: 28.750, region: 'Выборг' },
  { name: 'р. Луга (Усть-Луга)', cleanName: 'Луга', basin: 'baltic', wType: 'big_river', defDepth: 3.5, lat: 59.680, lon: 28.300, region: 'Кингисеппский р-н' },
  { name: 'р. Нарва (Ивангород)', cleanName: 'Нарва', basin: 'baltic', wType: 'big_river', defDepth: 4.2, lat: 59.380, lon: 28.200, region: 'Ивангород' },
  { name: 'Куршский залив', cleanName: 'Куршский залив', basin: 'baltic', wType: 'sea_gulf', defDepth: 3.8, lat: 54.960, lon: 20.470, region: 'Зеленоградск / Коса' },
  { name: 'Балтийское море (Балтийск / Янтарный)', cleanName: 'Балтийское море', basin: 'baltic', wType: 'open_sea', defDepth: 14.0, lat: 54.640, lon: 19.890, region: 'Калининградская обл.' },
  { name: 'Калининградский (Вислинский) залив', cleanName: 'Калининградский залив', basin: 'baltic', wType: 'sea_gulf', defDepth: 3.5, lat: 54.650, lon: 20.150, region: 'Калининград' },
  { name: 'р. Преголя', cleanName: 'Преголя', basin: 'baltic', wType: 'big_river', defDepth: 3.2, lat: 54.710, lon: 20.510, region: 'Калининград' },
  { name: 'оз. Чудско-Псковское', cleanName: 'Чудское озеро', basin: 'baltic', wType: 'quarry', defDepth: 6.5, lat: 57.820, lon: 28.330, region: 'Псков' },
  { name: 'р. Великая', cleanName: 'Великая', basin: 'baltic', wType: 'big_river', defDepth: 2.8, lat: 57.810, lon: 28.320, region: 'Псков' },

  // ==========================================
  // ЕНИСЕЙСКО-ЛЕНСКИЙ БАССЕЙН (Сибирь, Якутия)
  // ==========================================
  { name: 'р. Енисей (Красноярск)', cleanName: 'Енисей', basin: 'yenisei_lena', wType: 'big_river', defDepth: 6.8, lat: 56.010, lon: 92.870, region: 'Красноярск' },
  { name: 'Красноярское вдхр.', cleanName: 'Красноярское вдхр.', basin: 'yenisei_lena', wType: 'quarry', defDepth: 16.0, lat: 55.950, lon: 92.350, region: 'Дивногорск' },
  { name: 'р. Мана', cleanName: 'Мана', basin: 'yenisei_lena', wType: 'small_river', defDepth: 2.2, lat: 55.950, lon: 92.480, region: 'Усть-Мана' },
  { name: 'р. Енисей (Енисейск)', cleanName: 'Енисей', basin: 'yenisei_lena', wType: 'big_river', defDepth: 8.5, lat: 58.450, lon: 92.170, region: 'Енисейск' },
  { name: 'р. Енисей (Дудинка)', cleanName: 'Енисей (Низовья)', basin: 'yenisei_lena', wType: 'big_river', defDepth: 12.0, lat: 69.400, lon: 86.180, region: 'Дудинка' },
  { name: 'р. Ангара (Братское вдхр.)', cleanName: 'Ангара (Братское вдхр.)', basin: 'yenisei_lena', wType: 'quarry', defDepth: 14.0, lat: 56.150, lon: 101.600, region: 'Братск' },
  { name: 'р. Ангара (Усть-Илимское вдхр.)', cleanName: 'Усть-Илимское вдхр.', basin: 'yenisei_lena', wType: 'quarry', defDepth: 12.0, lat: 58.000, lon: 102.700, region: 'Усть-Илимск' },
  { name: 'р. Лена (Якутск)', cleanName: 'Лена', basin: 'yenisei_lena', wType: 'big_river', defDepth: 7.5, lat: 62.030, lon: 129.730, region: 'Якутск' },
  { name: 'р. Лена (Ленск)', cleanName: 'Лена', basin: 'yenisei_lena', wType: 'big_river', defDepth: 5.8, lat: 60.720, lon: 114.930, region: 'Ленск' },
  { name: 'р. Вилюй', cleanName: 'Вилюй', basin: 'yenisei_lena', wType: 'big_river', defDepth: 4.5, lat: 62.080, lon: 120.420, region: 'Вилюйск' },
  { name: 'р. Алдан', cleanName: 'Алдан', basin: 'yenisei_lena', wType: 'big_river', defDepth: 4.8, lat: 58.960, lon: 126.280, region: 'Алдан / Томмот' },

  // ==========================================
  // БАЙКАЛО-АНГАРСКИЙ БАССЕЙН
  // ==========================================
  { name: 'оз. Байкал (Листвянка)', cleanName: 'Байкал (Листвянка)', basin: 'baikal', wType: 'quarry', defDepth: 22.0, lat: 51.850, lon: 104.860, region: 'Листвянка' },
  { name: 'оз. Байкал (Малое Море / Ольхон)', cleanName: 'Байкал (Малое Море)', basin: 'baikal', wType: 'quarry', defDepth: 14.0, lat: 53.200, lon: 107.350, region: 'Ольхон' },
  { name: 'оз. Байкал (Чивыркуйский залив)', cleanName: 'Чивыркуйский залив', basin: 'baikal', wType: 'quarry', defDepth: 8.5, lat: 53.700, lon: 109.150, region: 'Забайкальский нацпарк' },
  { name: 'оз. Байкал (Слюдянка)', cleanName: 'Байкал (Слюдянка)', basin: 'baikal', wType: 'quarry', defDepth: 18.0, lat: 51.660, lon: 103.710, region: 'Слюдянка' },
  { name: 'р. Селенга (Улан-Удэ / дельта)', cleanName: 'Селенга', basin: 'baikal', wType: 'big_river', defDepth: 4.2, lat: 51.830, lon: 107.580, region: 'Улан-Удэ' },
  { name: 'р. Баргузин', cleanName: 'Баргузин', basin: 'baikal', wType: 'small_river', defDepth: 2.6, lat: 53.620, lon: 109.620, region: 'Баргузинский р-н' },
  { name: 'р. Снежная', cleanName: 'Снежная', basin: 'baikal', wType: 'small_river', defDepth: 1.8, lat: 51.480, lon: 104.630, region: 'Байкальск' },
  { name: 'оз. Котокель', cleanName: 'Котокель', basin: 'baikal', wType: 'tundra_lake', defDepth: 3.5, lat: 52.800, lon: 108.150, region: 'Прибайкальский р-н' },

  // ==========================================
  // АМУРСКИЙ БАССЕЙН
  // ==========================================
  { name: 'р. Амур (Хабаровск)', cleanName: 'Амур', basin: 'amur', wType: 'big_river', defDepth: 6.5, lat: 48.480, lon: 135.070, region: 'Хабаровск' },
  { name: 'р. Амур (Благовещенск)', cleanName: 'Амур', basin: 'amur', wType: 'big_river', defDepth: 5.2, lat: 50.270, lon: 127.540, region: 'Благовещенск' },
  { name: 'р. Амур (Комсомольск-на-Амуре)', cleanName: 'Амур', basin: 'amur', wType: 'big_river', defDepth: 7.2, lat: 50.550, lon: 137.000, region: 'Комсомольск' },
  { name: 'р. Зея (Благовещенск)', cleanName: 'Зея', basin: 'amur', wType: 'big_river', defDepth: 4.2, lat: 50.300, lon: 127.600, region: 'Благовещенск' },
  { name: 'Зейское вдхр.', cleanName: 'Зейское вдхр.', basin: 'amur', wType: 'quarry', defDepth: 14.0, lat: 53.750, lon: 127.250, region: 'г. Зея' },
  { name: 'Бурейское вдхр.', cleanName: 'Бурейское вдхр.', basin: 'amur', wType: 'quarry', defDepth: 12.0, lat: 50.180, lon: 130.300, region: 'п. Талакан' },
  { name: 'р. Уссури', cleanName: 'Уссури', basin: 'amur', wType: 'big_river', defDepth: 3.6, lat: 45.460, lon: 133.420, region: 'Лесозаводск' },
  { name: 'оз. Ханка', cleanName: 'Ханка', basin: 'amur', wType: 'tundra_lake', defDepth: 2.8, lat: 44.990, lon: 132.060, region: 'Камень-Рыболов' },
  { name: 'оз. Болонь', cleanName: 'Болонь', basin: 'amur', wType: 'tundra_lake', defDepth: 2.2, lat: 49.850, lon: 136.450, region: 'Амурский р-н' },

  // ==========================================
  // ТИХООКЕАНСКИЙ БАССЕЙН (Приморье, Камчатка, Сахалин)
  // ==========================================
  { name: 'Залив Петра Великого (Владивосток)', cleanName: 'Залив Петра Великого', basin: 'pacific_sea', wType: 'sea_gulf', defDepth: 14.0, lat: 43.120, lon: 131.880, region: 'Владивосток' },
  { name: 'Уссурийский залив (Шамора)', cleanName: 'Уссурийский залив', basin: 'pacific_sea', wType: 'sea_gulf', defDepth: 11.0, lat: 43.190, lon: 132.120, region: 'Владивосток' },
  { name: 'Залив Находка', cleanName: 'Залив Находка', basin: 'pacific_sea', wType: 'sea_gulf', defDepth: 15.0, lat: 42.820, lon: 132.880, region: 'Находка' },
  { name: 'Авачинская губа', cleanName: 'Авачинская губа', basin: 'pacific_sea', wType: 'sea_gulf', defDepth: 16.0, lat: 53.020, lon: 158.650, region: 'Петропавловск-Камчатский' },
  { name: 'р. Авача', cleanName: 'Авача', basin: 'pacific_sea', wType: 'small_river', defDepth: 2.0, lat: 53.180, lon: 158.380, region: 'Елизово' },
  { name: 'р. Камчатка', cleanName: 'Камчатка', basin: 'pacific_sea', wType: 'big_river', defDepth: 4.5, lat: 56.320, lon: 160.840, region: 'п. Ключи' },
  { name: 'р. Быстрая (Большая)', cleanName: 'Быстрая (Большая)', basin: 'pacific_sea', wType: 'small_river', defDepth: 2.4, lat: 52.750, lon: 156.300, region: 'Усть-Большерецк' },
  { name: 'Охотское море (бухта Нагаева)', cleanName: 'Бухта Нагаева', basin: 'pacific_sea', wType: 'sea_gulf', defDepth: 18.0, lat: 59.560, lon: 150.800, region: 'Магадан' },
  { name: 'Анивский залив', cleanName: 'Анивский залив', basin: 'pacific_sea', wType: 'sea_gulf', defDepth: 12.0, lat: 46.620, lon: 142.770, region: 'Корсаков / Сахалин' },
  { name: 'р. Тымь', cleanName: 'Тымь', basin: 'pacific_sea', wType: 'small_river', defDepth: 2.2, lat: 50.850, lon: 142.680, region: 'Тымовское / Сахалин' },

  // ==========================================
  // ДНЕПРОВСКО-ДОНСКОЙ (ЮГО-ЗАПАДНЫЙ) БАССЕЙН
  // ==========================================
  { name: 'р. Днепр (Смоленск)', cleanName: 'Днепр', basin: 'euro_west', wType: 'big_river', defDepth: 2.8, lat: 54.780, lon: 32.050, region: 'Смоленск' },
  { name: 'Десногорское вдхр. (Смоленская АЭС)', cleanName: 'Десногорское вдхр.', basin: 'euro_west', wType: 'cooling_reservoir', defDepth: 6.5, lat: 54.150, lon: 33.280, region: 'Десногорск' },
  { name: 'р. Десна (Брянск)', cleanName: 'Десна', basin: 'euro_west', wType: 'big_river', defDepth: 3.2, lat: 53.250, lon: 34.370, region: 'Брянск' },
  { name: 'р. Сейм (Курск)', cleanName: 'Сейм', basin: 'euro_west', wType: 'big_river', defDepth: 2.6, lat: 51.730, lon: 36.190, region: 'Курск' },
  { name: 'Курчатовское вдхр. (Курская АЭС)', cleanName: 'Курчатовское вдхр.', basin: 'euro_west', wType: 'cooling_reservoir', defDepth: 5.8, lat: 51.650, lon: 35.650, region: 'Курчатов' },
  { name: 'р. Оскол', cleanName: 'Оскол', basin: 'euro_west', wType: 'small_river', defDepth: 2.1, lat: 51.300, lon: 37.830, region: 'Старый Оскол' },
  { name: 'Белгородское вдхр.', cleanName: 'Белгородское вдхр.', basin: 'euro_west', wType: 'quarry', defDepth: 4.8, lat: 50.590, lon: 36.590, region: 'Белгород' }
];

export const RUSSIA_CITIES = [
  { name: 'Новый Уренгой', lat: 66.083, lon: 76.680, admin1: 'Ямало-Ненецкий АО' },
  { name: 'Салехард', lat: 66.530, lon: 66.600, admin1: 'Ямало-Ненецкий АО' },
  { name: 'Надым', lat: 65.533, lon: 72.520, admin1: 'Ямало-Ненецкий АО' },
  { name: 'Ноябрьск', lat: 63.200, lon: 75.450, admin1: 'Ямало-Ненецкий АО' },
  { name: 'Тарко-Сале', lat: 64.915, lon: 77.780, admin1: 'Ямало-Ненецкий АО' },
  { name: 'Сургут', lat: 61.250, lon: 73.400, admin1: 'Ханты-Мансийский АО' },
  { name: 'Нижневартовск', lat: 60.930, lon: 76.550, admin1: 'Ханты-Мансийский АО' },
  { name: 'Ханты-Мансийск', lat: 61.000, lon: 69.020, admin1: 'Ханты-Мансийский АО' },
  { name: 'Москва', lat: 55.7558, lon: 37.6173, admin1: 'Москва' },
  { name: 'Санкт-Петербург', lat: 59.9343, lon: 30.3351, admin1: 'Санкт-Петербург' },
  { name: 'Петрозаводск', lat: 61.7850, lon: 34.3469, admin1: 'Республика Карелия' },
  { name: 'Мурманск', lat: 68.9707, lon: 33.0750, admin1: 'Мурманская обл.' },
  { name: 'Севастополь', lat: 44.6166, lon: 33.5254, admin1: 'Севастополь' },
  { name: 'Ялта', lat: 44.4952, lon: 34.1663, admin1: 'Республика Крым' },
  { name: 'Сочи', lat: 43.5855, lon: 39.7231, admin1: 'Краснодарский край' },
  { name: 'Краснодар', lat: 45.0355, lon: 38.9753, admin1: 'Краснодарский край' },
  { name: 'Ростов-на-Дону', lat: 47.2225, lon: 39.7187, admin1: 'Ростовская обл.' },
  { name: 'Астрахань', lat: 46.3497, lon: 48.0408, admin1: 'Астраханская обл.' },
  { name: 'Казань', lat: 55.7961, lon: 49.1064, admin1: 'Республика Татарстан' },
  { name: 'Нижний Новгород', lat: 56.3269, lon: 44.0059, admin1: 'Нижегородская обл.' },
  { name: 'Самара', lat: 53.1959, lon: 50.1002, admin1: 'Самарская обл.' },
  { name: 'Пермь', lat: 58.0105, lon: 56.2502, admin1: 'Пермский край' },
  { name: 'Екатеринбург', lat: 56.8389, lon: 60.6057, admin1: 'Свердловская обл.' },
  { name: 'Тюмень', lat: 57.1530, lon: 65.5343, admin1: 'Тюменская обл.' },
  { name: 'Омск', lat: 54.9885, lon: 73.3242, admin1: 'Омская обл.' },
  { name: 'Новосибирск', lat: 55.0084, lon: 82.9357, admin1: 'Новосибирская обл.' },
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

export function getNearestRussianWaters(lat, lon, basinCode, isCoastal, maxCount = 8) {
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
  const top = calculated.slice(0, maxCount);

  return top.map(w => {
    const isRiver = w.name.startsWith('р.');
    const prefix = isRiver ? '🌊 ' : (w.wType.startsWith('sea') ? '⚓ ' : '💧 ');
    const distStr = w.distKm < 1 ? `${Math.round(w.distKm * 1000)} м` : `${w.distKm} км`;
    return {
      name: w.cleanName,
      label: `${prefix}${w.name} • ${distStr} (${w.region})`,
      wType: w.wType,
      defDepth: w.defDepth,
      distKm: w.distKm,
      lat: w.lat,
      lon: w.lon
    };
  });
}
