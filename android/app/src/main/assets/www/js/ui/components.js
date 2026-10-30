/**
 * Экранирует пользовательские строки перед вставкой в HTML (защита от DOM XSS и инъекций тегов)
 */
export function escapeHtml(raw) {
  if (raw === null || raw === undefined) return '';
  return String(raw)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Проверяет, что рыболовный позывной (логин) не содержит персональных данных (номера телефона или e-mail)
 * для соблюдения архитектуры Zero-PII в соответствии со ст. 3 и ст. 22 ФЗ № 152-ФЗ «О персональных данных».
 */
export function isAnonymousCallsignValid(rawLogin = '') {
  const s = String(rawLogin || '').trim();
  if (!s) return { ok: true };
  if (/^FP_/i.test(s)) return { ok: true };
  const withoutLeadingAt = s.replace(/^@+/, '');
  const hasEmailPattern = withoutLeadingAt.includes('@') || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  const digitsOnly = s.replace(/\D/g, '');
  const hasPhonePattern = /(?:\+7|7|8)[\s\-()]?\d{3}[\s\-()]?\d{3}[\s\-()]?\d{2}/.test(s) || digitsOnly.length >= 9;
  if (hasEmailPattern || hasPhonePattern) {
    return {
      ok: false,
      error: 'В целях конфиденциальности (152-ФЗ) запрещено указывать номер телефона или e-mail в качестве позывного. Используйте вымышленный рыболовный никнейм.'
    };
  }
  return { ok: true };
}

export function createPill({ text, tone = 'neutral', icon = '', ariaLabel = '' }) {
  const cls = `pill pill-${tone}`;
  const aria = ariaLabel ? ` aria-label="${ariaLabel}"` : '';
  return `<span class="${cls}"${aria}>${icon ? `<span aria-hidden="true">${icon}</span>` : ''}<span>${text}</span></span>`;
}

export function createChip({ label, active = false, attrs = '' }) {
  return `<button type="button" class="btn btn-sm chip-interactive ${active ? 'btn-accent' : ''}" ${attrs}>${label}</button>`;
}

export function createCard({ title = '', rightHtml = '', bodyHtml = '', extraClass = '' }) {
  const head = (title || rightHtml)
    ? `<div class="section-head"><span class="section-title">${title}</span><div>${rightHtml}</div></div>`
    : '';
  return `<div class="card ${extraClass}">${head}${bodyHtml}</div>`;
}

export function createSkeleton(lines = 3) {
  let out = '<div class="card" aria-busy="true">';
  for (let i = 0; i < lines; i++) {
    out += `<div style="height:14px;background:var(--border);border-radius:6px;margin-bottom:8px;width:${90 - i * 15}%;"></div>`;
  }
  return out + '</div>';
}

export function showToast(message, tone = 'info') {
  let box = document.getElementById('toastContainer');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toastContainer';
    box.className = 'toast-container';
    box.setAttribute('aria-live', 'polite');
    document.body.appendChild(box);
  }
  const item = document.createElement('div');
  item.className = 'toast';
  if (tone === 'bad') item.style.borderColor = 'var(--bad)';
  if (tone === 'good') item.style.borderColor = 'var(--good)';
  item.textContent = message;
  box.appendChild(item);
  setTimeout(() => {
    item.remove();
  }, 3800);
}

/**
 * Автокопирование Рыболовного ID (FP_FMP089 / FP_89AAA001) или ключа Экипажа (KP-XXXX) в буфер обмена
 * в 1 нажатие (работает в браузере, Android APK WebView, iOS Safari и Telegram Mini App)
 */
export async function copyFisherIdToClipboard(rawId, labelPrefix = 'ID рыбака') {
  const cleanId = String(rawId || '').trim();
  if (!cleanId) return false;
  let copied = false;

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      const clipPromise = navigator.clipboard.writeText(cleanId);
      const timeoutPromise = new Promise(resolve => setTimeout(() => resolve(false), 600));
      const res = await Promise.race([clipPromise.then(() => true).catch(() => false), timeoutPromise]);
      copied = Boolean(res);
    }
  } catch (e) {}

  if (!copied && typeof document !== 'undefined') {
    try {
      const ta = document.createElement('textarea');
      ta.value = cleanId;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;pointer-events:none;';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, cleanId.length);
      copied = Boolean(document.execCommand('copy'));
      ta.remove();
    } catch (e) {}
  }

  showToast(`📋 ${labelPrefix} ${cleanId} скопирован!`, 'good');
  return copied;
}

if (typeof document !== 'undefined' && !window.__KLEV_COPY_ID_BOUND__) {
  window.__KLEV_COPY_ID_BOUND__ = true;
  document.addEventListener('click', (e) => {
    const target = e.target && e.target.closest ? e.target.closest('[data-copy-fisher-id]') : null;
    if (!target) return;
    e.stopPropagation();
    const fid = target.getAttribute('data-copy-fisher-id');
    const lbl = target.getAttribute('data-copy-label') || (String(fid || '').startsWith('KP-') ? 'Ключ экипажа' : 'ID рыбака');
    if (fid) {
      copyFisherIdToClipboard(fid, lbl);
      const origTitle = target.getAttribute('title') || '';
      target.classList.add('copied-flash');
      setTimeout(() => {
        target.classList.remove('copied-flash');
        if (origTitle) target.setAttribute('title', origTitle);
      }, 900);
    }
  });
}

/**
 * Открывает адаптивное модальное окно / подменю.
 * - Все кнопки «✕ Закрыть» расположены внизу в закреплённом нижнем баре (.modal-sticky-footer).
 * - При открытии ставится защитная запись в history (Back-Guard), чтобы боковой свайп «Назад»
 *   аккуратно закрывал подменю/модалку (или возвращал в хаб настроек), а не сворачивал приложение.
 */
export function openModal(title, contentHtml, onMount = null, canClose = true, options = {}) {
  let backdrop = document.getElementById('appModalBackdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'appModalBackdrop';
    backdrop.className = 'modal-backdrop';
    document.body.appendChild(backdrop);
  }
  backdrop.onclick = (e) => {
    if (canClose && e.target === backdrop) closeModal();
  };

  const onBackFn = (options && typeof options.onBack === 'function') ? options.onBack : null;
  if (typeof window !== 'undefined') {
    window.__KLEV_MODAL_BACK_FN__ = onBackFn;
  }

  let footerHtml = (options && options.footerHtml) ? String(options.footerHtml) : '';
  if (!footerHtml && canClose) {
    const backBtnPart = onBackFn
      ? `<button type="button" class="btn" id="modalBackToHubBtn" style="flex:1;min-width:0;">← К разделам</button>`
      : '';
    footerHtml = `
      ${backBtnPart}
      <button type="button" class="btn" id="modalCloseBtn" data-modal-close style="flex:1;min-width:0;">✕ Закрыть</button>
    `;
  } else if (footerHtml && canClose && !footerHtml.includes('data-modal-close') && !footerHtml.includes('modalCloseBtn')) {
    footerHtml += `<button type="button" class="btn" id="modalCloseBtn" data-modal-close style="flex:1;min-width:0;">✕ Закрыть</button>`;
  }

  const headerRightHtml = (options && options.headerRightHtml) ? String(options.headerRightHtml) : '';

  backdrop.innerHTML = `
    <div class="modal-box ${footerHtml ? 'modal-has-sticky-footer' : ''}" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="section-head" style="margin-bottom:10px;">
        <h3 style="font-size:var(--fs-lg);font-weight:800;line-height:1.25;min-width:0;word-break:break-word;">${title}</h3>
        ${headerRightHtml}
      </div>
      <div id="modalDynamicBody" class="modal-dynamic-body">${contentHtml}</div>
      ${footerHtml ? `<div class="modal-sticky-footer" id="modalStickyFooter">${footerHtml}</div>` : ''}
    </div>
  `;
  backdrop.classList.add('open');

  if (typeof window !== 'undefined' && typeof window.__KLEV_PUSH_BACK_GUARD__ === 'function') {
    window.__KLEV_PUSH_BACK_GUARD__('modal');
  }

  const closeBtn = backdrop.querySelector('#modalCloseBtn');
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  backdrop.querySelectorAll('[data-modal-close]').forEach(btn => {
    if (btn !== closeBtn) btn.addEventListener('click', closeModal);
  });
  const backHubBtn = backdrop.querySelector('#modalBackToHubBtn');
  if (backHubBtn && onBackFn) {
    backHubBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const fn = onBackFn;
      window.__KLEV_MODAL_BACK_FN__ = null;
      fn();
    });
  }

  if (typeof onMount === 'function') {
    onMount(backdrop.querySelector('#modalDynamicBody'), backdrop.querySelector('#modalStickyFooter'));
  }
}

export function closeModal() {
  if (typeof window !== 'undefined') {
    window.__KLEV_MODAL_BACK_FN__ = null;
  }
  const backdrop = document.getElementById('appModalBackdrop');
  if (backdrop) backdrop.classList.remove('open');
}

/**
 * Универсальное модальное окно подтверждения удаления (для Супер-Админа, Журнала уловов, Чатов, Карты и Круга).
 * Отрисовывается поверх любых открытых окон (z-index: 12500), не сбрасывая текущее состояние экрана.
 */
export function openConfirmDeleteModal({
  title = '⚠️ Подтверждение удаления',
  message = 'Вы уверены, что хотите выполнить удаление?',
  confirmLabel = '🗑️ Да, удалить',
  cancelLabel = 'Отмена',
  extraCheckboxLabel = '',
  extraCheckboxDefault = true,
  onConfirm = null,
  onCancel = null
} = {}) {
  if (typeof document === 'undefined') return;
  let overlay = document.getElementById('klevConfirmDeleteBackdrop');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'klevConfirmDeleteBackdrop';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:12500;background:rgba(4,9,20,0.78);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px;';
    document.body.appendChild(overlay);
  }

  const closeConfirm = () => {
    overlay.style.display = 'none';
    overlay.innerHTML = '';
  };

  overlay.style.display = 'flex';
  overlay.innerHTML = `
    <div class="card" role="alertdialog" aria-modal="true" style="max-width:420px;width:100%;background:var(--panel);border:2px solid var(--bad);border-radius:var(--r-md);padding:16px;box-shadow:0 16px 40px rgba(0,0,0,0.65);display:flex;flex-direction:column;gap:12px;">
      <div style="font-size:var(--fs-md);font-weight:900;color:var(--bad);line-height:1.3;">
        ${title}
      </div>
      <div style="font-size:var(--fs-sm);color:var(--text);line-height:1.45;">
        ${message}
      </div>
      ${extraCheckboxLabel ? `
        <label style="display:flex;align-items:flex-start;gap:8px;padding:9px 10px;background:var(--card);border:1px solid var(--border);border-radius:var(--r-sm);font-size:var(--fs-xs);cursor:pointer;line-height:1.38;">
          <input type="checkbox" id="klevConfirmExtraChk" ${extraCheckboxDefault ? 'checked' : ''} style="margin-top:2px;flex-shrink:0;">
          <span>${extraCheckboxLabel}</span>
        </label>
      ` : ''}
      <div style="display:flex;gap:8px;margin-top:4px;">
        <button type="button" class="btn" id="klevConfirmCancelBtn" style="flex:1;min-height:40px;font-weight:800;">
          ${cancelLabel}
        button>
        <button type="button" class="btn" id="klevConfirmOkBtn" style="flex:1.2;min-height:40px;font-weight:900;background:rgba(239,68,68,0.18);border-color:var(--bad);color:var(--bad);">
          ${confirmLabel}
        </button>
      </div>
    </div>
  `;

  overlay.onclick = (e) => {
    if (e.target === overlay) {
      closeConfirm();
      if (typeof onCancel === 'function') onCancel();
    }
  };

  overlay.querySelector('#klevConfirmCancelBtn')?.addEventListener('click', () => {
    closeConfirm();
    if (typeof onCancel === 'function') onCancel();
  });

  overlay.querySelector('#klevConfirmOkBtn')?.addEventListener('click', async () => {
    const extraChecked = Boolean(overlay.querySelector('#klevConfirmExtraChk')?.checked);
    closeConfirm();
    if (typeof onConfirm === 'function') {
      await onConfirm(extraChecked);
    }
  });
}

export const USER_AGREEMENT_STORAGE_KEY = 'klev_pro_ua_accepted_v213';
export const USER_AGREEMENT_MIN_READ_SECONDS = 15;

export function isUserAgreementAccepted() {
  try {
    return Boolean(typeof localStorage !== 'undefined' && localStorage.getItem(USER_AGREEMENT_STORAGE_KEY));
  } catch (e) {
    return false;
  }
}

/**
 * Отдельное окно «📜 Пользовательское соглашение и Политика конфиденциальности (152-ФЗ)» при регистрации и в настройках профиля.
 * При регистрации (requireVerification === true) требует:
 * 1) Прокрутки текста соглашения до самого конца («Пролистано до конца»)
 * 2) Минимального времени чтения текста (таймер не менее USER_AGREEMENT_MIN_READ_SECONDS секунд)
 */
export function openUserAgreementModal({
  requireVerification = false,
  onAccepted = null,
  onClose = null
} = {}) {
  if (typeof document === 'undefined') return;
  let overlay = document.getElementById('klevUserAgreementBackdrop');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'klevUserAgreementBackdrop';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:12400;background:rgba(4,9,20,0.86);backdrop-filter:blur(5px);display:flex;align-items:center;justify-content:center;padding:12px;';
    document.body.appendChild(overlay);
  }

  let timerInterval = null;
  let secondsLeft = requireVerification ? USER_AGREEMENT_MIN_READ_SECONDS : 0;
  let scrolledToBottom = !requireVerification;

  const cleanupAndClose = () => {
    if (timerInterval) clearInterval(timerInterval);
    overlay.style.display = 'none';
    overlay.innerHTML = '';
    if (typeof onClose === 'function') onClose();
  };

  overlay.style.display = 'flex';
  overlay.innerHTML = `
    <div class="card" role="dialog" aria-modal="true" aria-label="Пользовательское соглашение Клёв ПРО 2.0" style="max-width:540px;width:100%;max-height:92vh;background:var(--panel);border:1.5px solid var(--accent);border-radius:var(--r-md);padding:14px;display:flex;flex-direction:column;gap:10px;box-shadow:0 18px 48px rgba(0,0,0,0.75);">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;border-bottom:1px solid var(--border);padding-bottom:8px;">
        <div style="min-width:0;flex:1;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;">
            <div style="font-size:var(--fs-md);font-weight:900;color:var(--accent);">📜 Пользовательское соглашение и Политика (152-ФЗ)</div>
            <span class="pill" style="font-size:10.5px;font-weight:900;padding:2px 7px;">12+</span>
          </div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;">
            ${requireVerification
              ? 'Для завершения регистрации внимательно прочитайте соглашение и пролистайте его до конца'
              : 'Правовой статус (ЗоЗПП / 149-ФЗ), защита данных (152-ФЗ), авторские права (ГК РФ) и безопасность'}
          </div>
        </div>
      </div>

      ${requireVerification ? `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px;">
          <div id="uaScrollStatusBox" style="padding:6px 8px;border-radius:6px;background:rgba(245,158,11,0.12);border:1px solid var(--warn);color:var(--warn);font-weight:800;text-align:center;">
            📜 Пролистайте текст до конца
          </div>
          <div id="uaTimerStatusBox" style="padding:6px 8px;border-radius:6px;background:rgba(56,189,248,0.12);border:1px solid var(--accent);color:var(--accent);font-weight:800;text-align:center;">
            ⏱️ Время чтения: ${secondsLeft} сек.
          </div>
        </div>
      ` : ''}

      <div id="uaScrollTextContainer" style="flex:1;min-height:220px;max-height:54vh;overflow-y:auto;padding:12px;background:var(--card);border:1px solid var(--border);border-radius:var(--r-sm);font-size:12.5px;line-height:1.52;color:var(--text);display:flex;flex-direction:column;gap:10px;">
        <div>
          <b style="color:var(--accent);">1. Общие положения и некоммерческий статус (ст. 9 ЗоЗПП РФ, ст. 10 ФЗ № 149-ФЗ)</b><br>
          Экосистема «Клёв ПРО 2.0: Круг» (домены <code>клевпро.рф</code> / <code>klevpro.ru</code>, веб-приложение PWA и Android-приложение, возрастная маркировка <b>12+</b> по ст. 6 ФЗ № 436-ФЗ) является бесплатным некоммерческим информационно-справочным проектом для рыболовов-любителей.<br>
          На ресурсе не осуществляются возмездная продажа товаров, выполнение платных работ или оказание платных услуг потребителям, в связи с чем положения ст. 9 Закона РФ № 2300-1 «О защите прав потребителей» об указании коммерческих реквизитов продавца (ИНН / ОГРН / ОГРНИП) не применяются. Сведения о владельце сайта и правообладателе (ч. 2 ст. 10 ФЗ № 149-ФЗ): Тхор Антон Сергеевич, электронная почта для юридически значимых обращений: <a href="mailto:i@athor.ru" style="color:var(--accent);">i@athor.ru</a>.
        </div>
        <div>
          <b style="color:var(--accent);">2. Политика конфиденциальности и архитектура Zero-PII (ФЗ № 152-ФЗ ст. 3, 12, 18.1, 22)</b><br>
          Сервис спроектирован по принципу <b>Privacy by Design (Zero-PII)</b> и не осуществляет сбор, хранение или обработку персональных данных, позволяющих прямо или косвенно идентифицировать физическое лицо по смыслу п. 1 ст. 3 и ст. 22 ФЗ № 152-ФЗ «О персональных данных»:<br>
          • Система не запрашивает и не хранит ФИО, паспортные данные, номера телефонов, адреса электронной почты, платёжные реквизиты или точные домашние адреса.<br>
          • Для синхронизации профиля используется исключительно вымышленный рыболовный позывной (никнейм), необратимый криптографический хеш пароля и технический региональный индекс вида <code>FP_89AAA001</code>. Пользователю запрещается указывать в качестве позывного свой номер телефона или e-mail.<br>
          • При публикации рыболовных точек в раздел «Круг» точные GPS-координаты принудительно размываются алгоритмом гексагональной сетки в радиусе <b>±5..10 км</b>. При прикреплении фотографий уловов все метаданные геолокации и устройства (EXIF/GPS) автоматически удаляются на стороне устройства пользователя до отправки.<br>
          • На сайте отсутствуют сторонние рекламные и трекинговые счётчики. Принимая соглашение, пользователь выражает согласие на маршрутизацию обезличенных технических пакетов и кэширование статических ресурсов через распределённую сеть доставки контента (CDN GitHub Pages / Cloudflare Workers, ст. 12 ФЗ № 152-ФЗ).
        </div>
        <div>
          <b style="color:var(--accent);">3. Интеллектуальная собственность (Часть IV ГК РФ, ст. 1259, 1260, 1261, 1334, 1465) и открытые лицензии</b><br>
          Исключительные права на исходный и объектный код приложения (ст. 1261 ГК РФ), 115 авторских графических иллюстраций рыб в каталоге <code>assets/fish/</code> (ст. 1259 ГК РФ), структурированную базу данных 115 видов рыб, 491 водоёма и 609 населённых пунктов по 8 рыбохозяйственным бассейнам РФ (ст. 1260 и ст. 1334 ГК РФ), а также математическую модель и весовые коэффициенты расчёта клёва (ст. 1465 ГК РФ) принадлежат правообладателю (© Тхор А. С., 2025–2026). Автоматический парсинг (скрейпинг), копирование базы данных и графических иллюстраций без письменного разрешения правообладателя запрещены.<br>
          Сторонние открытые компоненты используются в соответствии с их лицензиями: картографическое ядро © <a href="https://leafletjs.com/" target="_blank" rel="noopener" style="color:var(--accent);">Leaflet</a> (BSD-2-Clause), картографические данные © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener" style="color:var(--accent);">OpenStreetMap contributors</a> (ODbL) / © OpenTopoMap (CC-BY-SA), метеорологические сводки <a href="https://open-meteo.com/" target="_blank" rel="noopener" style="color:var(--accent);">Open-Meteo.com</a> и <a href="https://api.met.no/" target="_blank" rel="noopener" style="color:var(--accent);">MET Norway</a> (CC-BY 4.0).
        </div>
        <div>
          <b style="color:var(--accent);">4. Правила применения рекомендательных технологий (ст. 10.2-2 ФЗ № 149-ФЗ)</b><br>
          Расчёт «Индекса клёва (0–100%)» и подбор рекомендуемых видов рыб, приманок и оснасток выполняются локальным 8-факторным математическим алгоритмом на основе публичных метеорологических параметров (динамика атмосферного давления, температура воды и воздуха, растворённый кислород, скорость ветра, фаза Луны, время суток и сезон), гидрологического типа выбранного пользователем водоёма и отмеченных пользователем избранных видов рыб.
        </div>
        <div>
          <b style="color:var(--accent);">5. Безопасность на водоёмах и соблюдение правил рыболовства (ГИМС МЧС РФ и ФЗ № 166-ФЗ)</b><br>
          Все расчёты погодных условий, высоты волны, скорости ветра, температуры воды и ориентировочной толщины льда носят исключительно информационно-справочный характер и не заменяют официальные сводки МЧС России и Гидрометцентра. Решение о выходе на воду или на лёд принимается пользователем самостоятельно под личную ответственность.<br>
          Пользователь обязуется соблюдать действующие Правила рыболовства соответствующего рыбохозяйственного бассейна РФ (ФЗ № 166-ФЗ), суточные нормы вылова, промысловую меру и нерестовые ограничения. Виды рыб, занесённые в Красную книгу РФ и регионов, подлежат немедленному выпуску в живом виде.
        </div>
        <div>
          <b style="color:var(--accent);">6. Правила сообщества, чатов и сигнала «SOS на воде»</b><br>
          В разделах «Круг», «Экипаж» и в чатах запрещены оскорбления, спам, публикация заведомо ложных координат опасных участков льда и неправомерное использование экстренного сигнала «🆘 SOS на воде». Сигнал SOS предназначен исключительно для реальных нештатных ситуаций на водоёме, требующих помощи находящихся рядом рыболовов. За нарушение правил администрация вправе заблокировать или удалить учётную запись.
        </div>
        <div id="uaBottomSentinel" style="padding:8px 10px;background:rgba(16,185,129,0.10);border:1px dashed var(--good);border-radius:6px;font-size:11.5px;color:var(--good);font-weight:800;text-align:center;">
          ✓ Конец текста Пользовательского соглашения и Политики конфиденциальности «Клёв ПРО 2.0»
        </div>
      </div>

      <div style="display:grid;grid-template-columns:minmax(100px,1fr) minmax(150px,1.6fr);gap:8px;padding-top:4px;width:100%;">
        <button type="button" class="btn btn-sm" id="uaCancelCloseBtn" style="width:100%;min-height:42px;padding:6px 10px;font-size:13px;font-weight:800;">
          ✕ Закрыть
        </button>
        ${requireVerification ? `
          <button type="button" class="btn btn-sm" id="uaAcceptConfirmBtn" disabled style="width:100%;min-height:42px;padding:6px 10px;font-size:12.5px;font-weight:800;line-height:1.2;white-space:normal;text-align:center;opacity:0.55;cursor:not-allowed;">
            ⏳ Прочитайте (${secondsLeft} с)
          </button>
        ` : `
          <button type="button" class="btn btn-sm btn-good" id="uaAcceptConfirmBtn" style="width:100%;min-height:42px;padding:6px 10px;font-size:13px;font-weight:800;line-height:1.2;white-space:normal;text-align:center;">
            ✓ ${isUserAgreementAccepted() ? 'Понятно (Принято)' : 'Принять соглашение'}
          </button>
        `}
      </div>
    </div>
  `;

  const scrollBox = overlay.querySelector('#uaScrollTextContainer');
  const scrollBadge = overlay.querySelector('#uaScrollStatusBox');
  const timerBadge = overlay.querySelector('#uaTimerStatusBox');
  const acceptBtn = overlay.querySelector('#uaAcceptConfirmBtn');

  const updateAcceptButtonState = () => {
    if (!requireVerification) return;
    if (scrollBadge) {
      if (scrolledToBottom) {
        scrollBadge.style.background = 'rgba(16,185,129,0.15)';
        scrollBadge.style.borderColor = 'var(--good)';
        scrollBadge.style.color = 'var(--good)';
        scrollBadge.textContent = '✅ Пролистано до конца';
      } else {
        scrollBadge.textContent = '📜 Пролистайте до конца ↓';
      }
    }
    if (timerBadge) {
      if (secondsLeft <= 0) {
        timerBadge.style.background = 'rgba(16,185,129,0.15)';
        timerBadge.style.borderColor = 'var(--good)';
        timerBadge.style.color = 'var(--good)';
        timerBadge.textContent = '✅ Время чтения выполнено';
      } else {
        timerBadge.textContent = `⏱️ Время чтения: ${secondsLeft} сек.`;
      }
    }
    if (acceptBtn) {
      const unlocked = scrolledToBottom && secondsLeft <= 0;
      acceptBtn.disabled = !unlocked;
      if (unlocked) {
        acceptBtn.className = 'btn btn-sm btn-good';
        acceptBtn.style.opacity = '1';
        acceptBtn.style.cursor = 'pointer';
        acceptBtn.textContent = '✓ Принять и продолжить';
      } else if (!scrolledToBottom && secondsLeft > 0) {
        acceptBtn.textContent = `⏳ Листайте вниз (${secondsLeft} с)`;
      } else if (!scrolledToBottom) {
        acceptBtn.textContent = '📜 Пролистайте до конца ↓';
      } else {
        acceptBtn.textContent = `⏳ Чтение (${secondsLeft} с)...`;
      }
    }
  };

  if (requireVerification && scrollBox) {
    const checkScrollPos = () => {
      if (scrollBox.scrollTop + scrollBox.clientHeight >= scrollBox.scrollHeight - 18) {
        scrolledToBottom = true;
        updateAcceptButtonState();
      }
    };
    scrollBox.addEventListener('scroll', checkScrollPos, { passive: true });
    setTimeout(checkScrollPos, 150);

    timerInterval = setInterval(() => {
      secondsLeft = Math.max(0, secondsLeft - 1);
      updateAcceptButtonState();
      if (secondsLeft <= 0 && timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
    }, 1000);
  }

  overlay.querySelector('#uaCancelCloseBtn')?.addEventListener('click', () => {
    cleanupAndClose();
  });

  acceptBtn?.addEventListener('click', () => {
    if (requireVerification && (!scrolledToBottom || secondsLeft > 0)) return;
    try {
      localStorage.setItem(USER_AGREEMENT_STORAGE_KEY, String(Date.now()));
    } catch (e) {}
    if (timerInterval) clearInterval(timerInterval);
    overlay.style.display = 'none';
    overlay.innerHTML = '';
    if (typeof onAccepted === 'function') {
      onAccepted();
    }
  });
}

if (typeof window !== 'undefined') {
  window.openLegalModal = () => openUserAgreementModal({ requireVerification: false });
}

export function openFishLightbox(fishTitle, latinTitle, visualHtml) {
  let lb = document.getElementById('fishImageLightbox');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'fishImageLightbox';
    lb.className = 'fish-lightbox-backdrop';
    document.body.appendChild(lb);
  }
  lb.innerHTML = `
    <div class="fish-lightbox-box" role="dialog" aria-modal="true" aria-label="Увеличенное изображение: ${fishTitle}">
      <div class="fish-lightbox-head">
        <div style="min-width:0;">
          <div style="font-weight:800;font-size:var(--fs-md);color:var(--text);">${fishTitle}</div>
          ${latinTitle ? `<div style="font-size:var(--fs-xs);color:var(--muted);font-style:italic;">${latinTitle}</div>` : ''}
        </div>
      </div>
      <div class="fish-lightbox-stage" id="fishLightboxStage" title="Нажмите, чтобы закрыть">
        ${visualHtml}
      </div>
      <div style="font-size:var(--fs-xs);color:var(--muted);text-align:center;margin-top:8px;">
        Нажмите на изображение или кнопку внизу для возврата к карточке
      </div>
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);display:flex;">
        <button type="button" class="btn" id="fishLightboxCloseBtn" aria-label="Закрыть просмотр" style="width:100%;">✕ Закрыть</button>
      </div>
    </div>
  `;
  lb.classList.add('open');
  if (typeof window !== 'undefined' && typeof window.__KLEV_PUSH_BACK_GUARD__ === 'function') {
    window.__KLEV_PUSH_BACK_GUARD__('lightbox');
  }
  const closeLb = () => lb.classList.remove('open');
  lb.onclick = (e) => {
    if (e.target === lb) closeLb();
  };
  lb.querySelector('#fishLightboxCloseBtn')?.addEventListener('click', closeLb);
  lb.querySelector('#fishLightboxStage')?.addEventListener('click', closeLb);
}


/**
 * Кроссплатформенная выгрузка файла на устройство (100% работает в Android APK, iOS Safari/PWA, Telegram Mini App и браузере ПК).
 * В Android APK сохраняет файл напрямую в системную папку «Загрузки» (Downloads) и отправляет системное уведомление.
 */
export function downloadFileCrossPlatform(filename, content, mimeType = 'application/octet-stream') {
  const cleanName = String(filename || 'klev-pro-export.txt').trim();
  const strContent = typeof content === 'string' ? content : JSON.stringify(content, null, 2);

  try {
    if (typeof window !== 'undefined' && window.AndroidBridge && typeof window.AndroidBridge.saveFileToDownloads === 'function') {
      const ok = window.AndroidBridge.saveFileToDownloads(cleanName, strContent, mimeType, false);
      if (ok) return true;
    }
  } catch (e) {}

  try {
    const blob = new Blob([strContent], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = cleanName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 1500);
    return true;
  } catch (e) {
    try {
      const dataUrl = `data:${mimeType};charset=utf-8,` + encodeURIComponent(strContent);
      window.open(dataUrl, '_blank');
      return true;
    } catch (err) {}
  }
  return false;
}

/**
 * Отправляет системное уведомление в шторку Android (через AndroidBridge) или через Web Notification API / Service Worker.
 */
export function triggerSystemNotificationCrossPlatform(title, body, category = 'alerts') {
  const cleanTitle = String(title || 'Клёв ПРО 2.0').trim();
  const cleanBody = String(body || '').trim();
  try {
    if (typeof window !== 'undefined' && window.AndroidBridge && typeof window.AndroidBridge.showSystemNotification === 'function') {
      window.AndroidBridge.showSystemNotification(cleanTitle, cleanBody, String(category || 'alerts'));
      return true;
    }
  } catch (e) {}

  try {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      if ('serviceWorker' in navigator && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(reg => {
          if (reg && typeof reg.showNotification === 'function') {
            reg.showNotification(cleanTitle, {
              body: cleanBody,
              icon: 'icon-192.png',
              badge: 'icon-192.png',
              tag: `klev_${category}_${Date.now()}`
            });
          }
        }).catch(() => {});
        return true;
      }
      new Notification(cleanTitle, { body: cleanBody, icon: 'icon-192.png' });
      return true;
    }
  } catch (e) {}
  return false;
}

/**
 * Запрашивает системное разрешение на показ уведомлений в шторке смартфона (Android 13+ / iOS / Web)
 * или открывает системный экран настроек уведомлений приложения.
 */
export async function requestSystemNotificationsAccess() {
  try {
    if (typeof window !== 'undefined' && window.AndroidBridge) {
      if (typeof window.AndroidBridge.requestNotificationPermission === 'function') {
        window.AndroidBridge.requestNotificationPermission();
        showToast('🔔 Запрос системных уведомлений Android выполнен! Проверьте шторку уведомлений.', 'good');
        return true;
      }
      if (typeof window.AndroidBridge.openNotificationSettings === 'function') {
        window.AndroidBridge.openNotificationSettings();
        return true;
      }
    }
  } catch (e) {}

  if (typeof window !== 'undefined' && 'Notification' in window) {
    try {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        triggerSystemNotificationCrossPlatform('Клёв ПРО 2.0 • Уведомления включены', 'Системные оповещения Круга, Экипажа, Чатов и SOS активны!', 'alerts');
        showToast('✅ Системные уведомления разрешены и протестированы!', 'good');
        return true;
      }
      showToast('⚠️ Разрешение на системные уведомления отклонено браузером. Разрешите уведомления в настройках сайта.', 'warn');
      return false;
    } catch (e) {}
  }

  showToast('🔔 Активны звуковые и всплывающие уведомления внутри приложения', 'info');
  return false;
}
