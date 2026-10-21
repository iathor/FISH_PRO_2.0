import { RU } from '../../i18n/ru.js';
import { getSeasonalBaitsForContext, getCompatibleMethods } from '../../core/config.js';
import { events } from '../../core/events.js';
import { store } from '../../core/store.js';
import { fmtDeltaPress } from '../../core/format.js';
import { WATER_PROFILES, getAvailableWaterTypes } from '../../data/waters.js';
import { FISH_DB } from '../../data/species.js';
import { renderFiveFish } from '../../ui/svg.js';
import { createPill } from '../../ui/components.js';

export function computeHourFactors(fish, day, hrObj, method, water, depth, normPress = 752, globalIceState = 'open_water') {
  const dayIce = day.iceState || globalIceState;
  if (fish.legal === 'redbook') {
    return { total: 0, forbidden: true, iceDanger: false, factors: [] };
  }
  if (dayIce === 'ice_danger' && !method.startsWith('winter_')) {
    return { total: 8, forbidden: false, iceDanger: true, factors: [] };
  }

  const wt = day.waterTemp ?? 8;
  const [tOptMin, tOptMax] = fish.tWaterOpt || [8, 16];
  let tempDelta = 0;
  let tempNote = `Вода ${wt}°C (оптимум ${tOptMin}–${tOptMax}°C)`;
  if (wt < fish.tMinStop) {
    tempDelta = -36;
    tempNote = `Вода ${wt}°C ниже порога активности (${fish.tMinStop}°C) — оцепенение`;
  } else if (wt >= tOptMin && wt <= tOptMax) {
    tempDelta = +16;
    tempNote = `Вода ${wt}°C в оптимуме вида (${tOptMin}–${tOptMax}°C)`;
  } else if (wt < tOptMin) {
    const span = Math.max(1.5, tOptMin - fish.tMinStop);
    const ratio = (wt - fish.tMinStop) / span;
    const coldBoost = (fish.coldFactor || 0.7) >= 1.05 ? 6 : 0;
    tempDelta = Math.round(-18 + ratio * 28 + coldBoost);
    tempNote = `Вода ${wt}°C прохладнее оптимума (${tOptMin}–${tOptMax}°C)`;
  } else {
    const excess = wt - tOptMax;
    tempDelta = Math.max(-30, Math.round(12 - excess * 7));
    tempNote = `Вода ${wt}°C теплее оптимума (${tOptMin}–${tOptMax}°C)`;
  }

  // Pressure calculations - strengthened for barometric breakdown
  const pDiff = Math.abs((hrObj.press || 754) - normPress);
  const dp = hrObj.dp3h ?? (day.dP / 4);
  let pressDelta = Math.round(6 - Math.min(14, pDiff * 0.6 * (fish.bladderSens || 0.8)));

  if (fish.type === 'predator') {
    if (dp <= -0.8) pressDelta += 8;
    else if (dp >= 1.0) pressDelta -= 9;
  } else {
    if (Math.abs(dp) <= 0.6) pressDelta += 6;
    else if (dp <= -1.0) pressDelta -= 8;
  }

  // Severe daily jump impact (barometric stress on swim bladder)
  const absDailyDP = Math.abs(day.dP || 0);
  if (absDailyDP >= 8) {
    pressDelta -= 18;
  } else if (absDailyDP >= 5) {
    pressDelta -= 12;
  }

  pressDelta = Math.max(-24, Math.min(15, pressDelta));
  const pressNote = `Давление ${hrObj.press} мм (суточный ход ${fmtDeltaPress(day.dP)})`;

  // Wind calculations
  let windDelta = 0;
  if (dayIce === 'ice_safe') {
    windDelta = hrObj.wind > 9 ? -8 : +3;
  } else if (fish.id === 'burbot') {
    windDelta = (hrObj.wind >= 4 || hrObj.precip > 0) ? +10 : 0;
  } else {
    if (hrObj.wind >= 1.5 && hrObj.wind <= 5.5) windDelta += 6;
    else if (hrObj.wind >= 8.5) windDelta -= 16;
    else if (hrObj.wind > 6.5) windDelta -= 8;
    else windDelta -= 2;

    if (['Ю', 'ЮЗ', 'З'].includes(hrObj.windDir)) windDelta += 4;
    else if (['С', 'СВ', 'В'].includes(hrObj.windDir)) windDelta -= 4;
  }
  const windNote = `Ветер ${hrObj.windDir} ${hrObj.wind} м/с`;

  // Seasonal and spawn
  const dtMonthIdx = new Date(day.date + 'T00:00:00').getMonth();
  const curMonthNum = dtMonthIdx + 1;
  const mAct = (fish.monthActivity && fish.monthActivity[dtMonthIdx]) ?? 2;
  let seasonDelta = mAct === 3 ? +14 : (mAct === 2 ? +6 : (mAct === 1 ? -6 : -18));
  if (fish.spawnMonth && fish.spawnMonth.includes(curMonthNum)) {
    seasonDelta = -22;
  }
  if (dayIce === 'ice_safe' && ['crucian', 'carp', 'tench', 'catfish', 'tilapia', 'silver_carp', 'grass_carp', 'snakehead'].includes(fish.id)) {
    seasonDelta = -28;
  }
  const seasonNote = fish.spawnMonth?.includes(curMonthNum)
    ? 'Период нереста — кормовая активность снижена'
    : `Сезонный биоритм месяца: ${mAct} из 3`;

  // Gear & Depth
  let gearDelta = 0;
  if (depth > fish.depthMax) {
    gearDelta -= 22;
  } else if (depth >= fish.depthOpt[0] && depth <= fish.depthOpt[1]) {
    gearDelta += 8;
  } else {
    gearDelta -= 6;
  }
  gearDelta += getMethodCompatibility(fish, method);

  const h = hrObj.hour;
  const sr = day.sunriseHr ?? 7;
  const ss = day.sunsetHr ?? 18;
  const isTwilight = Math.abs(h + 0.5 - sr) <= 1.5 || Math.abs(h + 0.5 - ss) <= 1.5;
  const isDay = (h + 0.5 >= sr - 0.5) && (h + 0.5 <= ss + 0.5);
  if (fish.feedMode === 'nocturnal') gearDelta += !isDay ? 6 : (isTwilight ? 2 : -10);
  else if (fish.feedMode === 'crepuscular') gearDelta += isTwilight ? 7 : (isDay ? 2 : -8);
  else if (fish.feedMode === 'diurnal') gearDelta += isDay ? 5 : -12;
  gearDelta = Math.max(-22, Math.min(16, gearDelta));
  const gearNote = `Глубина ${depth} м (оптимум ${fish.depthOpt[0]}–${fish.depthOpt[1]} м)`;

  // Moon
  const md = day.moon?.moonDay || 10;
  let moonDelta = 0;
  if (md >= 28 || md <= 2 || (md >= 14 && md <= 17)) moonDelta += 3;
  else if ((md >= 6 && md <= 8) || (md >= 21 && md <= 23)) moonDelta -= 3;
  const dTr = Math.min(Math.abs(h - (day.moon?.transitHour || 12)), 24 - Math.abs(h - (day.moon?.transitHour || 12)));
  if (dTr <= 1.5) moonDelta += 2;
  const moonNote = `${day.moon?.phaseName || 'Луна'} (${md} л.д.)`;

  const baseScore = 52;
  const rawTotal = baseScore + tempDelta + pressDelta + windDelta + seasonDelta + gearDelta + moonDelta;
  const total = Math.max(4, Math.min(98, Math.round(rawTotal)));

  return {
    total,
    forbidden: false,
    iceDanger: false,
    factors: [
      { id: 'temp', name: 'Температура воды', val: tempDelta, note: tempNote },
      { id: 'press', name: 'Давление и его ход', val: pressDelta, note: pressNote },
      { id: 'season', name: 'Сезонный биоритм', val: seasonDelta, note: seasonNote },
      { id: 'gear', name: 'Глубина, свет и снасть', val: gearDelta, note: gearNote },
      { id: 'wind', name: 'Ветер и волнение', val: windDelta, note: windNote },
      { id: 'moon', name: 'Фаза Луны', val: moonDelta, note: moonNote }
    ]
  };
}

function getMethodCompatibility(fish, method) {
  if (method === 'winter_livebait') return fish.type === 'predator' ? 7 : -14;
  if (method === 'winter_lure') return ['perch', 'pike', 'zander', 'grayling', 'smelt', 'trout', 'cod', 'navaga', 'lenok', 'volga_zander', 'char', 'broad_whitefish', 'saffron_cod'].includes(fish.id) ? 8 : -10;
  if (method === 'winter_jig') return ['chir', 'pizhyan', 'peled', 'cisco', 'roach', 'perch', 'whitefish', 'ruffe', 'smelt', 'bream', 'ide', 'dace', 'white_bream', 'vendace', 'omul', 'omul_arctic', 'valek', 'baikal_grayling'].includes(fish.id) ? 8 : -5;
  if (method === 'winter_stuka') return ['burbot', 'cod', 'halibut', 'navaga', 'wolffish'].includes(fish.id) ? 10 : -12;
  if (method === 'winter_cisco') return ['cisco', 'peled', 'smelt', 'whitefish', 'herring', 'vendace', 'omul', 'omul_arctic'].includes(fish.id) ? 10 : -10;
  if (method === 'spin_micro') return ['perch', 'roach', 'crucian', 'rudd', 'bleak', 'chub', 'grayling', 'trout', 'brown_trout', 'rainbow_trout', 'rotan', 'gudgeon', 'dace', 'ide', 'horse_mackerel', 'sea_bass', 'scorpionfish', 'wrasse'].includes(fish.id) ? 8 : (fish.type === 'predator' ? 3 : -6);
  if (method === 'spin_jig') return ['zander', 'pike', 'perch', 'catfish', 'volga_zander', 'amur_catfish', 'channel_catfish', 'burbot', 'cod', 'halibut', 'greenling'].includes(fish.id) ? 8 : (fish.type === 'predator' ? 4 : -14);
  if (method === 'spin_lure') return fish.type === 'predator' ? 7 : -12;
  if (method === 'bottom') return (fish.type === 'peace' || ['catfish', 'burbot', 'channel_catfish', 'amur_catfish', 'ruffe', 'flounder', 'starry_flounder', 'turbot', 'plaice', 'goby'].includes(fish.id)) ? 8 : -7;
  if (method === 'float') return (fish.type === 'peace' || ['perch', 'rotan', 'ruffe', 'chub', 'grayling', 'trout', 'dolly_varden', 'garfish'].includes(fish.id)) ? 7 : -6;
  if (method === 'fly') return ['grayling', 'baikal_grayling', 'lenok', 'salmon', 'trout', 'chub', 'ide', 'tugun', 'dace', 'brown_trout', 'sockeye_salmon', 'char', 'dolly_varden', 'bleak', 'rudd', 'chekhon'].includes(fish.id) ? 9 : -10;
  if (method.startsWith('sea_')) return fish.habitat === 'sea' ? 8 : -12;
  return 0;
}

export function calcHourly(fish, day, hrObj, method, water, depth, normPress = 752, iceState = 'open_water') {
  return computeHourFactors(fish, day, hrObj, method, water, depth, normPress, iceState).total;
}

export function calcDayBest(fish, day, method, water, depth, normPress = 752, iceState = 'open_water') {
  if (!fish || fish.legal === 'redbook' || !day?.hours?.length) return 0;
  const scores = day.hours.map(hr => calcHourly(fish, day, hr, method, water, depth, normPress, iceState)).sort((a, b) => b - a);
  return Math.round((scores[0] + scores[1] + scores[2] + scores[3]) / 4);
}

export function getFactorBreakdown(fish, day, method, water, depth, normPress = 752, iceState = 'open_water', hourIdx = null) {
  if (!day || !day.hours?.length) return { total: 0, factors: [] };
  let targetHr = day.hours[12];
  if (hourIdx !== null && day.hours[hourIdx]) {
    targetHr = day.hours[hourIdx];
  } else {
    let bestSc = -1;
    for (const hr of day.hours) {
      const sc = calcHourly(fish, day, hr, method, water, depth, normPress, iceState);
      if (sc > bestSc) { bestSc = sc; targetHr = hr; }
    }
  }
  return computeHourFactors(fish, day, targetHr, method, water, depth, normPress, iceState);
}

export function calcDynamicRig(method, water, depth, wind) {
  const prof = WATER_PROFILES[water] || WATER_PROFILES.small_river;
  const flowCoeff = prof.flow;
  if (method === 'winter_jig') return { weight: `Вольфрамовая мормышка ${Math.min(3.5, Math.max(0.4, Math.round(depth * 0.35 * flowCoeff * 10) / 10))} г`, line: 'Зимняя леска 0.09–0.12 мм', tactic: 'Плавный подъём с мелкой игрой на 30–50 см от дна и короткой паузой' };
  if (method === 'winter_cisco') return { weight: 'Нижнее грузило 6–14 г + гирлянда', line: 'Основная леска 0.14 мм, поводки 0.10 мм', tactic: 'Плавное покачивание гирлянды мормышек в полводы и у кромки льда' };
  if (method === 'winter_lure') return { weight: `Балансир / Раттлин ${Math.min(32, Math.max(5, Math.round(depth * 2.0 * flowCoeff)))} г`, line: 'Плетёный шнур 0.14 мм + флюорокарбон 0.35 мм', tactic: 'Короткий взмах удильником на 15–20 см, сброс и выдержка паузы 4–6 секунд' };
  if (method === 'winter_stuka') return { weight: `Блесна-стукалка ${Math.min(65, Math.max(20, Math.round(depth * 3.5 * flowCoeff)))} г`, line: 'Монолеска 0.35–0.45 мм', tactic: 'Ритмичное постукивание по каменистому дну с подсадкой кусочка рыбы' };
  if (method === 'winter_livebait') return { weight: `Скользящее грузило ${Math.max(6, Math.round(depth * 1.6 * flowCoeff))} г`, line: 'Леска 0.35 мм + поводок 0.45 мм / металл', tactic: 'Установка живца в 25–40 см от дна на бровке или у камыша' };
  if (method === 'spin_micro') return { weight: `Груз-чебурашка / Мормышка ${Math.min(4.5, Math.max(0.3, Math.round(depth * 0.65 * flowCoeff * 10) / 10))} г`, line: 'Тонкий шнур 0.06–0.08 мм + поводок 0.12–0.14 мм', tactic: 'Мелкая анимация кончиком удилища в придонном слое с паузами до 3 секунд' };
  if (method === 'spin_jig') return { weight: `Джиг-головка ${Math.min(56, Math.max(8, Math.round(depth * 2.8 * flowCoeff)))} г`, line: 'Плетёный шнур 0.14–0.18 мм + поводок', tactic: 'Классическая ступенька: два оборота катушки — пауза 2 секунды с касанием дна' };
  if (method === 'spin_lure') return { weight: `Блесна / Воблер ${Math.min(28, Math.max(4, Math.round(depth * 2.2 * flowCoeff)))} г`, line: 'Шнур 0.12–0.16 мм + стальной/титановый поводок', tactic: 'Равномерная проводка вдоль кромки травы или рывковая анимация с паузами' };
  if (method === 'bottom') return { weight: `Донная кормушка ${Math.min(130, Math.max(25, Math.round(depth * 12 * flowCoeff)))} г`, line: 'Шнур 0.14 мм, поводок 0.12–0.18 мм (50–70 см)', tactic: 'Точное закармливание точки на ракушечнике или нижней русловой бровке' };
  if (method === 'float') return { weight: `Поплавок ${Math.min(8.0, Math.max(0.5, Math.round((depth * 0.8 * flowCoeff + wind * 0.15) * 10) / 10))} г`, line: 'Основная леска 0.14–0.16 мм, поводок 0.10–0.12 мм', tactic: 'Проводка насадки в придонном слое с лёгким притормаживанием поплавка' };
  if (method === 'fly') return { weight: 'Нахлыстовый шнур 4–5 класса + подлесок 2.7 м', line: 'Поводковая леска 0.12–0.16 мм', tactic: 'Подача мушки вверх или поперёк струи со свободным проплывом без борозды' };
  return { weight: `Морское грузило / Блесна ${Math.max(12, Math.round(depth * 3.8 * flowCoeff))} г`, line: 'Шнур 0.14–0.20 мм + флюорокарбоновый поводок', tactic: 'Ступенчатая проводка у каменистого рельефа и береговых свалов' };
}

export function generateAdaptiveGuides(fish, water, depth, day, method, globalIceState) {
  const iceState = day.iceState || globalIceState;
  const iceThickness = day.iceThickness ?? 0;
  let standAdvice = '';
  if (fish.legal === 'redbook') {
    standAdvice = `⛔ <b>ОСОБЫЙ СТАТУС:</b> ${fish.name} включена в Красную книгу РФ или региональные Красные книги. Вылов категорически запрещён! При случайной поимке особь необходимо бережно выпустить в водоём.`;
  } else if (fish.legal === 'introduced') {
    standAdvice = `⚡ <b>Вселенец / Теплолюбивый вид:</b> ${fish.name} обитает в водоёмах-охладителях ГРЭС/АЭС, прудовых хозяйствах и южных реках. При температуре воды ниже ${fish.tMinStop}°C впадает в оцепенение и не кормится.`;
  } else if (iceState === 'ice_safe') {
    standAdvice = `❄️ <b>Подлёдный горизонт (лёд ~${iceThickness} см):</b> ${fish.name} держится на глубине ${depth.toFixed(1)} м. Зимой ключевую роль играют проточные участки, выходы русловых родников и плёсы с достаточным кислородом.`;
  } else if (iceState === 'ice_danger') {
    standAdvice = `⚠️ <b>Опасный период ледостава:</b> Выход на тонкий лёд смертельно опасен, а открытая вода у берегов забита шугой и заберегами.`;
  } else if (fish.habitat === 'sea') {
    standAdvice = `🌊 <b>Морская акватория:</b> ${fish.name} занимает каменистые гряды, рифы и песчаные банки на горизонте ${depth.toFixed(1)} м. ${fish.baseAdvice}`;
  } else {
    standAdvice = `На глубине ${depth.toFixed(1)} м (${WATER_PROFILES[water]?.shortName || 'водоём'}) ${fish.name} занимает характерный микрорельеф. ${fish.baseAdvice}`;
  }

  const rigInfo = calcDynamicRig(method, water, depth, day.windMax);
  const tackleAdvice = fish.legal === 'redbook'
    ? 'Любые любительские снасти по данному виду запрещены к применению.'
    : `Рекомендуемый монтаж: <b>${rigInfo.weight}</b> (${rigInfo.line}). ${rigInfo.tactic}. Профильная снасть: ${fish.topGear}`;

  let baitAdvice = '';
  if (fish.legal === 'redbook') baitAdvice = 'Вид под строгой государственной охраной.';
  else if (['silver_carp'].includes(fish.id)) baitAdvice = 'Специализированный прессованный технопланктон (зелёный, оригинальный, топлёное молоко), создающий облако мути.';
  else if (['grass_carp'].includes(fish.id)) baitAdvice = 'Молодой камыш, сочный огурец, водоросли, сладкая кукуруза, плавающие травяные бойлы.';
  else if (['tilapia', 'channel_catfish', 'buffalo'].includes(fish.id)) baitAdvice = 'Куриная печень, резка рыбы, креветка, пучок навозных червей, кукуруза с коноплёй.';
  else if (['crayfish', 'crab', 'king_crab'].includes(fish.id)) baitAdvice = 'Приманка: свежая рыба, мясо мидии или чесночный хлеб в сетчатой кормушке.';
  else if (fish.habitat === 'sea') baitAdvice = 'Морской рацион: нереис (пескожил), полоски свежей рыбы, мясо креветки или мидии, светонакопительный силикон.';
  else if (['chir', 'pizhyan', 'peled', 'cisco', 'whitefish', 'vendace', 'omul', 'omul_arctic', 'valek'].includes(fish.id)) baitAdvice = 'Северный рацион сиговых: пучок свежего мотыля, бокоплав (мормыш/гаммарус), личинка короеда, опарыш, подвески из бисера.';
  else if (method === 'winter_livebait') baitAdvice = 'Живец под хищника — мелкая плотвичка (сорожка), карасик, окунёк или ёрш у самого дна.';
  else if (iceState === 'ice_safe') baitAdvice = 'Зимний рацион: живой уральский мотыль, бокоплав, кусочки тюльки/ерша, безнасадочные мормышки (гвоздешарик, чёртик).';
  else baitAdvice = day.waterTemp <= 9.0
    ? 'Холодная вода (~' + day.waterTemp + '°C): животный рацион (мотыль, червь, опарыш, резка рыбы), деликатная подача с паузами до 4–6 сек.'
    : 'Тёплая вода (~' + day.waterTemp + '°C): активные приманки и сезонные насадки (кукуруза, перловка, опарыш, червь, бойлы или воблеры/силикон по хищнику).';

  return { standAdvice, tackleAdvice, baitAdvice };
}

export function renderExpress(container) {
  if (!container) return;
  const s = store.getState();
  const fish = FISH_DB.find(f => f.id === s.fishId) || FISH_DB[0];
  const expressIndices = [2, 3, 4]; // Сегодня, Завтра, Послезавтра
  const curTheme = document.documentElement.getAttribute('data-theme') || 'dark';

  const cardsHtml = expressIndices.map((dayIdx, pos) => {
    const d = s.weatherDays[dayIdx];
    if (!d) return '';
    const dayName = pos === 0 ? 'Сегодня' : (pos === 1 ? 'Завтра' : 'Послезавтра');
    const score = calcDayBest(fish, d, s.method, s.water, s.depth, s.normPress, s.iceState);
    const dayIce = d.iceState || s.iceState;

    const wtOk = d.waterTemp >= fish.tWaterOpt[0] && d.waterTemp <= fish.tWaterOpt[1];
    const wtTone = d.waterTemp < fish.tMinStop ? 'bad' : (wtOk ? 'good' : 'warn');
    const pTone = Math.abs(d.dP) <= 2 ? 'good' : (Math.abs(d.dP) <= 4 ? 'warn' : 'bad');
    const wTone = d.windMax <= 5 ? 'good' : (d.windMax <= 8 ? 'warn' : 'bad');
    const iceTone = dayIce === 'ice_danger' ? 'bad' : (dayIce === 'ice_safe' ? 'ice' : 'good');
    const iceText = dayIce === 'ice_danger' ? `Опасный лёд ~${d.iceThickness} см` : (dayIce === 'ice_safe' ? `Лёд ~${d.iceThickness} см` : 'Открытая вода');

    // Adverse weather conditions check
    const isPressJump = Math.abs(d.dP) >= 5;
    const isGale = d.windMax >= 8.5;
    const isIceDanger = dayIce === 'ice_danger';

    let verdict = RU.verdictGo;
    let verdictTone = 'good';
    let customRatingWord = null;

    if (fish.legal === 'redbook') {
      verdict = RU.verdictBan;
      verdictTone = 'bad';
    } else if (isIceDanger) {
      verdict = `⚠️ Опасный лёд (~${d.iceThickness} см)`;
      verdictTone = 'bad';
      customRatingWord = 'Выход на лёд опасен';
    } else if (isPressJump) {
      verdict = `⚠️ Скачок давления (${d.dP > 0 ? '+' : ''}${d.dP} мм)`;
      verdictTone = Math.abs(d.dP) >= 8 ? 'bad' : 'warn';
      customRatingWord = score < 35 ? 'Клёва нет' : (score < 50 ? 'Слабый клёв' : 'Умеренный клёв • Нестабильно');
    } else if (isGale) {
      verdict = `⚠️ Штормовой ветер (${d.windMax} м/с)`;
      verdictTone = 'bad';
      customRatingWord = score < 35 ? 'Клёва нет' : 'Слабый клёв • Шторм';
    } else if (score < 38) {
      verdict = RU.verdictStay;
      verdictTone = 'bad';
    } else if (score < 60) {
      verdict = RU.verdictCareful;
      verdictTone = 'warn';
      customRatingWord = 'Умеренный клёв';
    }

    const bd = getFactorBreakdown(fish, d, s.method, s.water, s.depth, s.normPress, s.iceState);
    const topNotes = bd.factors.slice(0, 2).map(f => `${f.note} (${f.val >= 0 ? '+' + f.val : f.val}%)`).join('; ');

    return `
      <div class="card express-card ${s.dayIdx === dayIdx ? 'active' : ''}" data-express-day="${dayIdx}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <div>
            <div style="font-size:var(--fs-md);font-weight:800;">${dayName} • ${d.label}</div>
            <div style="font-size:var(--fs-xs);color:var(--muted);">Объект лова: <b>${fish.name}</b></div>
          </div>
          ${createPill({ text: verdict, tone: verdictTone })}
        </div>
        <div class="express-chips">
          ${createPill({ icon: '💧', text: `Вода ${d.waterTemp}°C`, tone: wtTone })}
          ${createPill({ icon: '🧭', text: `${d.pressAvg} мм (${fmtDeltaPress(d.dP)})`, tone: pTone })}
          ${createPill({ icon: '💨', text: `${d.windDir} ${d.windMax} м/с`, tone: wTone })}
          ${createPill({ icon: d.moon.phaseIcon, text: `${d.moon.moonDay} л.д.`, tone: 'neutral' })}
          ${createPill({ icon: dayIce === 'open_water' ? '🌊' : '❄️', text: iceText, tone: iceTone })}
        </div>
        <p style="font-size:var(--fs-xs);color:var(--muted);line-height:1.38;">
          ${fish.legal === 'redbook'
            ? RU.redbookLaw
            : (dayIce === 'ice_danger'
                ? '⚠️ Выход на тонкий лёд смертельно опасен! Допустима только береговая ловля.'
                : `${topNotes}.`)}
        </p>
        <div style="display:flex;justify-content:space-between;align-items:center;padding-top:8px;border-top:1px solid var(--border);gap:8px;">
          <div>
            ${fish.legal === 'redbook'
              ? `<span class="pill pill-bad">${RU.redbookBan}</span>`
              : renderFiveFish(score, 16, curTheme, true, customRatingWord)}
          </div>
          ${dayIdx === 2
            ? `<button type="button" class="btn btn-sm btn-good" data-catch-today="2">🎣 Я поймал</button>`
            : `<span style="font-size:10px;color:var(--muted);font-weight:700;">Прогноз</span>`}
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div>
      <div class="section-head">
        <span class="section-title">⚡ Экспресс-сводка (3 дня)</span>
        <span style="font-size:var(--fs-xs);color:var(--muted);">Клик по карточке открывает почасовой разбор дня</span>
      </div>
      <div class="express-grid">${cardsHtml}</div>
    </div>
  `;
}

export function renderWeek(container) {
  if (!container) return;
  const prevScroll = container.querySelector('.week-strip')?.scrollLeft || 0;
  const s = store.getState();
  const fish = FISH_DB.find(f => f.id === s.fishId) || FISH_DB[0];
  const curTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const days = s.weatherDays || [];

  const compareHtml = s.pinnedDays.length >= 2 ? `
    <div class="card" style="margin-top:10px;background:var(--card);">
      <div class="section-head">
        <span class="section-title">📌 Сравнение выбранных дней (${s.pinnedDays.length} из 3)</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(195px,1fr));gap:8px;">
        ${s.pinnedDays.map(pIdx => {
          const pd = days[pIdx];
          if (!pd) return '';
          const pSc = calcDayBest(fish, pd, s.method, s.water, s.depth, s.normPress, s.iceState);
          return `
            <div style="padding:8px 10px;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--panel);">
              <div style="font-weight:800;font-size:var(--fs-sm);">${pd.relTitle ? pd.relTitle + ' • ' : ''}${pd.label}</div>
              <div style="font-size:var(--fs-xs);color:var(--muted);margin:3px 0;">
                💧 Вода ${pd.waterTemp}°C • 🧭 ${pd.pressAvg} мм (${fmtDeltaPress(pd.dP)})<br>
                💨 ${pd.windDir} ${pd.windMax} м/с • ${pd.moon.phaseIcon} ${pd.moon.moonDay} л.д.
              </div>
              <div>${fish.legal === 'redbook' ? RU.redbookBan : renderFiveFish(pSc, 14, curTheme, true)}</div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  ` : '';

  container.innerHTML = `
    <div class="card">
      <div class="section-head">
        <div>
          <span class="section-title">📆 Прогноз клёва (10 дней) и архив (2 дня) • ${fish.name}</span>
          <div style="font-size:10px;color:var(--muted);">Позавчера и Вчера — архив погоды для записи прошлых уловов • Сегодня активен по умолчанию</div>
        </div>
      </div>
      <div class="week-strip">
        ${days.map((d, idx) => {
          const score = calcDayBest(fish, d, s.method, s.water, s.depth, s.normPress, s.iceState);
          const col = d.isArchive ? '#94a3b8' : (fish.legal === 'redbook' ? 'var(--bad)' : (score >= 60 ? 'var(--good)' : (score >= 38 ? 'var(--warn)' : 'var(--bad)')));
          const isPinned = s.pinnedDays.includes(idx);
          const topBadge = d.isArchive
            ? `<span class="pill pill-neutral" style="font-size:9px;padding:1px 6px;">📓 Архив: ${d.relTitle}</span>`
            : (idx === 2 ? `<span class="pill pill-good" style="font-size:9px;padding:1px 6px;">Сегодня</span>` : (d.relTitle ? `<span style="font-size:10px;color:var(--accent);font-weight:700;">${d.relTitle}</span>` : ''));
          return `
            <div class="day-card ${idx === s.dayIdx ? 'active' : ''} ${d.isArchive ? 'archive-day' : ''}" data-week-day="${idx}">
              <div class="day-status-stripe" style="background:${col};"></div>
              <div style="display:flex;justify-content:space-between;align-items:center;gap:4px;">
                <span style="font-weight:800;font-size:var(--fs-xs);">${d.label}</span>
                <button type="button" class="btn btn-sm" style="min-height:26px;padding:1px 5px;" data-pin-day="${idx}" title="Закрепить для сравнения" aria-label="Закрепить ${d.label}">${isPinned ? '📌' : '📍'}</button>
              </div>
              <div>${topBadge}</div>
              <div style="font-size:var(--fs-md);font-weight:800;">${d.tDay > 0 ? '+' + d.tDay : d.tDay}° / ${d.tNight > 0 ? '+' + d.tNight : d.tNight}°C</div>
              <div style="font-size:11px;color:var(--muted);">
                💧 Вода ${d.waterTemp}°C<br>
                🧭 ${d.pressAvg} мм (${fmtDeltaPress(d.dP)})<br>
                💨 ${d.windDir} ${d.windMax} м/с
              </div>
              <div style="margin-top:auto;padding-top:5px;border-top:1px solid var(--border);">
                ${d.isArchive
                  ? `<span style="color:var(--accent);font-size:10px;font-weight:800;">🎣 Записать улов за ${d.relTitle.toLowerCase()} →</span>`
                  : (fish.legal === 'redbook'
                      ? `<span style="color:var(--bad);font-size:10px;font-weight:800;">${RU.redbookBan}</span>`
                      : renderFiveFish(score, 13, curTheme, true))}
              </div>
            </div>
          `;
        }).join('')}
      </div>
      ${compareHtml}
    </div>
  `;
  if (prevScroll > 0) {
    const strip = container.querySelector('.week-strip');
    if (strip) strip.scrollLeft = prevScroll;
  }
}

export function renderHourly(container) {
  if (!container) return;
  const prevScroll = container.querySelector('.bite-timeline')?.scrollLeft || 0;
  const s = store.getState();
  const fish = FISH_DB.find(f => f.id === s.fishId) || FISH_DB[0];
  const day = s.weatherDays[s.dayIdx] || s.weatherDays[2] || s.weatherDays[0];
  if (!day) return;

  if (day.isArchive) {
    renderArchiveDayLogger(container, s, day, fish);
    return;
  }

  const curTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const curH = new Date().getHours();
  const selH = clampHour(s.selectedHour);
  const selHrObj = day.hours[selH] || day.hours[12];
  const selBreakdown = computeHourFactors(fish, day, selHrObj, s.method, s.water, s.depth, s.normPress, s.iceState);
  const rig = calcDynamicRig(s.method, s.water, s.depth, day.windMax);
  const seasonalBaits = getSeasonalBaitsForContext(fish, s.method, day.waterTemp, day.iceState || s.iceState);
  const activeBait = s.selectedBait && seasonalBaits.includes(s.selectedBait) ? s.selectedBait : seasonalBaits[0];

  container.innerHTML = `
    <div class="card">
      <div class="section-head">
        <span class="section-title">⏱️ Почасовой график клёва (0–24 ч) • ${day.relTitle ? day.relTitle + ' (' + day.label + ')' : day.label}</span>
        <span style="font-size:var(--fs-xs);color:var(--muted);">🌅 Зорьки и 🌕 лунные выходы отмечены значками • Нажмите на час для подробностей</span>
      </div>

      ${fish.legal === 'redbook' ? `
        <div style="padding:12px;border-radius:var(--r-sm);background:var(--pill-bad-bg);color:var(--pill-bad-text);font-weight:700;">
          ⛔ <b>${fish.name} — ${RU.redbookBan}</b><br>
          <span style="font-size:var(--fs-xs);">${RU.redbookLaw}</span>
        </div>
      ` : `
        <div class="bite-timeline" role="listbox" aria-label="Почасовой график клёва">
          ${day.hours.map(hr => {
            const sc = calcHourly(fish, day, hr, s.method, s.water, s.depth, s.normPress, s.iceState);
            const col = sc >= 60 ? 'var(--good)' : (sc >= 38 ? 'var(--warn)' : 'var(--bad)');
            const isNow = s.dayIdx === 2 && hr.hour === curH;
            const isTw = Math.abs(hr.hour + 0.5 - day.sunriseHr) <= 1.1 || Math.abs(hr.hour + 0.5 - day.sunsetHr) <= 1.1;
            const isLunar = hr.hour === day.moon.transitHour || hr.hour === day.moon.underfootHour;
            const mark = isTw ? '🌅' : (isLunar ? '🌕' : '·');
            return `
              <button type="button" class="hour-slot ${hr.hour === selH ? 'active' : ''} ${isNow ? 'now' : ''}" data-scrub-hour="${hr.hour}" aria-label="${hr.hour}:00, активность ${sc}%">
                <span style="font-weight:800;">${String(hr.hour).padStart(2, '0')}</span>
                <span style="font-size:10px;" title="${isTw ? 'Утренняя/вечерняя зорька' : (isLunar ? 'Лунное окно активности' : '')}">${mark}</span>
                <div class="hour-bar-wrap"><div class="hour-bar" style="height:${sc}%;background:${col};"></div></div>
                <span style="font-weight:700;font-size:10px;">${sc}%</span>
              </button>
            `;
          }).join('')}
        </div>

        <div class="card" style="margin-top:10px;background:var(--card);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
          <div style="flex:1;min-width:240px;">
            <div style="font-size:10px;color:var(--muted);font-weight:700;">УСЛОВИЯ В ВЫБРАННЫЙ ЧАС: ${String(selH).padStart(2, '0')}:00 (${day.label})</div>
            <div style="font-size:var(--fs-md);font-weight:800;margin-top:2px;">
              Воздух ${selHrObj.tAir > 0 ? '+' + selHrObj.tAir : selHrObj.tAir}°C • Вода ~${day.waterTemp}°C • 🧭 ${selHrObj.press} мм (за 3ч: ${fmtDeltaPress(selHrObj.dp3h)}) • 💨 ${selHrObj.windDir} ${selHrObj.wind} м/с
            </div>
            <div style="font-size:var(--fs-xs);color:var(--accent);margin-top:4px;">
              Рекомендуемая оснастка: <b>${rig.weight}</b> (${rig.line}) • ${rig.tactic}
            </div>
            <div style="margin-top:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
              <label for="fcSeasonalBaitSel" style="font-size:10px;color:var(--muted);font-weight:700;">СЕЗОННАЯ НАЖИВКА / ПРИМАНКА:</label>
              <select id="fcSeasonalBaitSel" style="max-width:310px;min-height:32px;padding:3px 8px;font-size:var(--fs-xs);">
                ${seasonalBaits.map(b => `<option value="${b}" ${b === activeBait ? 'selected' : ''}>${b}</option>`).join('')}
              </select>
            </div>
          </div>
          <div>
            ${renderFiveFish(selBreakdown.total, 18, curTheme, true)}
          </div>
        </div>

        <details open style="margin-top:12px;">
          <summary style="cursor:pointer;font-weight:800;font-size:var(--fs-md);color:var(--accent);">
            🔍 Почему такой прогноз? (Влияние погоды и условий на ${String(selH).padStart(2, '0')}:00 — Итог ${selBreakdown.total}%)
          </summary>
          <div style="margin-top:8px;padding:12px;background:var(--card);border-radius:var(--r-sm);">
            <div style="font-size:var(--fs-xs);color:var(--muted);margin-bottom:8px;">
              Базовая активность в водоёме: <b>52%</b>. Поправки от текущих погодных и гидрологических условий:
            </div>
            ${selBreakdown.factors.map(f => {
              const isPos = f.val >= 0;
              const col = isPos ? 'var(--good)' : 'var(--bad)';
              const widthPct = Math.min(100, Math.max(8, Math.abs(f.val) * 3));
              return `
                <div class="factor-row">
                  <div>
                    <div style="font-weight:700;">${f.name}</div>
                    <div style="font-size:10px;color:var(--muted);">${f.note}</div>
                  </div>
                  <div class="factor-bar-track">
                    <div class="factor-bar-fill" style="width:${widthPct}%;background:${col};"></div>
                  </div>
                  <div style="text-align:right;font-weight:800;color:${col};">${isPos ? '+' + f.val : f.val}%</div>
                </div>
              `;
            }).join('')}
            <p style="margin-top:10px;font-size:var(--fs-xs);color:var(--muted);">
              ⚖️ ${RU.forecastDisclaimer}
            </p>
          </div>
        </details>

        ${(() => {
          const guides = generateAdaptiveGuides(fish, s.water, s.depth, day, s.method, s.iceState);
          return `
            <div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border);">
              <div class="section-title">🧭 Ихтиология, снасти и кормовая база: ${fish.name} (${s.depth.toFixed(1)} м)</div>
              <div class="guide-grid">
                <div class="guide-block"><h4>Гидробиология и стоянки</h4><p>${guides.standAdvice}</p></div>
                <div class="guide-block"><h4>Снасти и подача</h4><p>${guides.tackleAdvice}</p></div>
                <div class="guide-block"><h4>Кормовая база и насадки</h4><p>${guides.baitAdvice}</p></div>
              </div>
            </div>
          `;
        })()}
      `}
    </div>
  `;
  if (prevScroll > 0) {
    const strip = container.querySelector('.bite-timeline');
    if (strip) strip.scrollLeft = prevScroll;
  }
}

function renderArchiveDayLogger(container, s, day, currentFish) {
  const selH = clampHour(s.selectedHour);
  const selHrObj = day.hours[selH] || day.hours[12];
  const availWaters = getAvailableWaterTypes(s.basinCode, s.lat, s.lon);
  const compatibleMethods = getCompatibleMethods(currentFish, day.iceState || s.iceState, s.water);
  const currentMethodVal = compatibleMethods.some(m => m.val === s.method) ? s.method : compatibleMethods[0]?.val;
  const seasonalBaits = getSeasonalBaitsForContext(currentFish, currentMethodVal, day.waterTemp, day.iceState || s.iceState);
  const activeBait = s.selectedBait && seasonalBaits.includes(s.selectedBait) ? s.selectedBait : seasonalBaits[0];

  const favSet = new Set(s.favorites || []);
  const legalSpecies = [...FISH_DB]
    .filter(f => f.legal !== 'redbook' && f.basins.includes(s.basinCode))
    .sort((a, b) => (favSet.has(b.id) ? 1 : 0) - (favSet.has(a.id) ? 1 : 0));

  container.innerHTML = `
    <div class="card" style="border-color:var(--accent);">
      <div class="section-head">
        <div>
          <span class="section-title">📓 Архив погоды и запись улова за ${day.relTitle.toLowerCase()} (${day.label})</span>
          <div style="font-size:var(--fs-xs);color:var(--muted);margin-top:2px;">
            Зафиксируйте выезд по строгой цепочке: <b>Рыба → Снасть → Наживка → Водоём</b> (метеоусловия выбранного часа подставятся автоматически)
          </div>
        </div>
        ${createPill({ text: `Архив: ${day.relTitle}`, tone: 'purple', icon: '🕰️' })}
      </div>

      <div style="padding:10px 12px;border-radius:var(--r-sm);background:var(--card);margin-bottom:12px;font-size:var(--fs-xs);color:var(--accent);font-weight:700;">
        📸 Метеоархив (${day.label}, ${String(selH).padStart(2, '0')}:00): Воздух ${selHrObj.tAir > 0 ? '+' + selHrObj.tAir : selHrObj.tAir}°C • Вода ~${day.waterTemp}°C • 🧭 ${selHrObj.press} мм (Δ ${fmtDeltaPress(day.dP)}) • 💨 ${selHrObj.windDir} ${selHrObj.wind} м/с • ${day.moon.phaseIcon} ${day.moon.moonDay} л.д.
      </div>

      <div class="controls-grid" style="margin-bottom:12px;">
        <div>
          <label style="display:block;font-size:10px;color:var(--muted);font-weight:700;margin-bottom:3px;">ШАГ 1. ПОЙМАННАЯ РЫБА (ИЗБРАННЫЕ ВВЕРХУ)</label>
          <select id="archFishSel">
            ${legalSpecies.map(f => `<option value="${f.id}" ${f.id === currentFish.id ? 'selected' : ''}>${favSet.has(f.id) ? '⭐ ' : ''}${f.name}</option>`).join('')}
          </select>
        </div>

        <div>
          <label style="display:block;font-size:10px;color:var(--muted);font-weight:700;margin-bottom:3px;">ШАГ 2. СНАСТЬ (ПОДХОДЯЩАЯ ПОД РЫБУ)</label>
          <select id="archMethodSel">
            ${compatibleMethods.map(m => `<option value="${m.val}" ${m.val === currentMethodVal ? 'selected' : ''}>${m.text}</option>`).join('')}
          </select>
        </div>

        <div>
          <label style="display:block;font-size:10px;color:var(--muted);font-weight:700;margin-bottom:3px;">ШАГ 3. СЕЗОННАЯ НАЖИВКА / ПРИМАНКА</label>
          <select id="archBaitSel">
            ${seasonalBaits.map(b => `<option value="${b}" ${b === activeBait ? 'selected' : ''}>${b}</option>`).join('')}
          </select>
        </div>

        <div>
          <label style="display:block;font-size:10px;color:var(--muted);font-weight:700;margin-bottom:3px;">ШАГ 4. ВОДОЁМ / БИОТОП</label>
          <select id="archWaterSel">
            ${(s.nearbyWaters || []).map(w => `<option value="${w.wType}|${w.name || w.label}" ${s.selectedWaterName === w.name ? 'selected' : ''}>${w.label}</option>`).join('')}
            ${availWaters.map(w => `<option value="${w.id}|${w.shortName}">${w.name}</option>`).join('')}
          </select>
        </div>

        <div>
          <label style="display:block;font-size:10px;color:var(--muted);font-weight:700;margin-bottom:3px;">ШАГ 5. ЧАС ПОИМКИ (${day.relTitle.toUpperCase()})</label>
          <select id="archHourSel">
            ${day.hours.map(hr => `<option value="${hr.hour}" ${hr.hour === selH ? 'selected' : ''}>${String(hr.hour).padStart(2, '0')}:00 (воздух ${hr.tAir > 0 ? '+' + hr.tAir : hr.tAir}°C, ${hr.press} мм)</option>`).join('')}
          </select>
        </div>

        <div style="display:flex;align-items:flex-end;">
          <button type="button" class="btn btn-good" id="archOpenCatchBtn" style="width:100%;">🎣 Записать улов (${day.relTitle}, ${String(selH).padStart(2, '0')}:00)</button>
        </div>
      </div>
    </div>
  `;
}

function clampHour(h) {
  const n = parseInt(h, 10);
  return Number.isFinite(n) ? Math.max(0, Math.min(23, n)) : 12;
}

export function render(container) {
  if (!container) return;
  if (!container.querySelector('#fcWeekBox')) {
    container.innerHTML = `
      <div id="fcExpressBox"></div>
      <div id="fcWeekBox" style="margin-top:14px;"></div>
      <div id="fcHourlyBox" style="margin-top:14px;"></div>
    `;
  }
  renderExpress(container.querySelector('#fcExpressBox'));
  renderWeek(container.querySelector('#fcWeekBox'));
  renderHourly(container.querySelector('#fcHourlyBox'));
  bindForecastEvents(container);
}

function bindForecastEvents(container) {
  container.querySelectorAll('[data-express-day]').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-catch-today]')) return;
      const idx = parseInt(card.getAttribute('data-express-day'), 10);
      store.dispatch({ type: 'SET_DAY', payload: idx });
    });
  });

  const catchTodayBtn = container.querySelector('[data-catch-today]');
  if (catchTodayBtn) {
    catchTodayBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      store.dispatch({ type: 'SET_DAY', payload: 2 });
      const s = store.getState();
      events.emit('forecast:hourSelected', { dayIdx: 2, hour: s.selectedHour, bait: s.selectedBait });
    });
  }

  container.querySelectorAll('[data-week-day]').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-pin-day]')) return;
      const idx = parseInt(card.getAttribute('data-week-day'), 10);
      store.dispatch({ type: 'SET_DAY', payload: idx });
    });
  });

  container.querySelectorAll('[data-pin-day]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-pin-day'), 10);
      store.dispatch({ type: 'TOGGLE_PIN_DAY', payload: idx });
    });
  });

  container.querySelectorAll('[data-scrub-hour]').forEach(btn => {
    btn.addEventListener('click', () => {
      const hr = parseInt(btn.getAttribute('data-scrub-hour'), 10);
      store.dispatch({ type: 'SET_HOUR', payload: hr });
    });
  });

  const baitSel = container.querySelector('#fcSeasonalBaitSel');
  if (baitSel) {
    baitSel.addEventListener('change', (e) => {
      store.dispatch({ type: 'SET_BAIT', payload: e.target.value });
    });
  }

  // Reactive dependency chain in Archive logger
  const archFish = container.querySelector('#archFishSel');
  const archMethod = container.querySelector('#archMethodSel');
  const archBait = container.querySelector('#archBaitSel');

  if (archFish) {
    archFish.addEventListener('change', (e) => {
      const newFishId = e.target.value;
      const s = store.getState();
      const fObj = FISH_DB.find(x => x.id === newFishId) || FISH_DB[0];
      store.dispatch({ type: 'SET_FISH', payload: newFishId });

      // Update methods for this fish
      const newMethods = getCompatibleMethods(fObj, s.iceState, s.water);
      if (archMethod) {
        archMethod.innerHTML = newMethods.map(m => `<option value="${m.val}">${m.text}</option>`).join('');
        const chosenMethod = newMethods[0]?.val;
        store.dispatch({ type: 'SET_METHOD', payload: chosenMethod });

        // Update baits
        const day = s.weatherDays[s.dayIdx] || s.weatherDays[2] || s.weatherDays[0] || {};
        const newBaits = getSeasonalBaitsForContext(fObj, chosenMethod, day.waterTemp ?? 12, day.iceState || s.iceState);
        if (archBait) {
          archBait.innerHTML = newBaits.map(b => `<option value="${b}">${b}</option>`).join('');
          store.dispatch({ type: 'SET_BAIT', payload: newBaits[0] || '' });
        }
      }
    });
  }

  if (archMethod) {
    archMethod.addEventListener('change', (e) => {
      const chosenMethod = e.target.value;
      store.dispatch({ type: 'SET_METHOD', payload: chosenMethod });
      const s = store.getState();
      const fObj = FISH_DB.find(x => x.id === s.fishId) || FISH_DB[0];
      const day = s.weatherDays[s.dayIdx] || s.weatherDays[2] || s.weatherDays[0] || {};
      const newBaits = getSeasonalBaitsForContext(fObj, chosenMethod, day.waterTemp ?? 12, day.iceState || s.iceState);
      if (archBait) {
        archBait.innerHTML = newBaits.map(b => `<option value="${b}">${b}</option>`).join('');
        store.dispatch({ type: 'SET_BAIT', payload: newBaits[0] || '' });
      }
    });
  }

  if (archBait) {
    archBait.addEventListener('change', (e) => {
      store.dispatch({ type: 'SET_BAIT', payload: e.target.value });
    });
  }

  const archHour = container.querySelector('#archHourSel');
  if (archHour) {
    archHour.addEventListener('change', (e) => {
      store.dispatch({ type: 'SET_HOUR', payload: parseInt(e.target.value, 10) });
    });
  }

  const archWater = container.querySelector('#archWaterSel');
  if (archWater) {
    archWater.addEventListener('change', (e) => {
      const [wType, wName] = e.target.value.split('|');
      store.dispatch({ type: 'SET_WATER', payload: { water: wType, selectedWaterName: wName } });
    });
  }

  const archBtn = container.querySelector('#archOpenCatchBtn');
  if (archBtn) {
    archBtn.addEventListener('click', () => {
      const s = store.getState();
      const chosenBait = container.querySelector('#archBaitSel')?.value || s.selectedBait;
      events.emit('forecast:hourSelected', {
        dayIdx: s.dayIdx,
        hour: s.selectedHour,
        fishId: s.fishId,
        bait: chosenBait
      });
    });
  }
}

let unsub = null;

export function init(container) {
  render(container);
  unsub = store.subscribe(
    s => ({
      fishId: s.fishId,
      dayIdx: s.dayIdx,
      selectedHour: s.selectedHour,
      water: s.water,
      selectedWaterName: s.selectedWaterName,
      method: s.method,
      selectedBait: s.selectedBait,
      depth: s.depth,
      weatherDays: s.weatherDays,
      pinnedDays: s.pinnedDays,
      iceState: s.iceState,
      theme: s.theme
    }),
    () => render(container)
  );
}

export function destroy() {
  if (unsub) unsub();
}

export const forecastModule = {
  computeHourFactors,
  calcHourly,
  calcDayBest,
  getFactorBreakdown,
  calcDynamicRig,
  generateAdaptiveGuides,
  renderExpress,
  renderWeek,
  renderHourly,
  init,
  render,
  destroy
};
