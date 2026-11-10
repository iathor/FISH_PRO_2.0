import { svgIcon } from './icons.js?v=2.8.3-r230';
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
  if (tone === 'warn') item.style.borderColor = 'var(--warn)';
  const cleanText = String(message || '').replace(/<svg[\s\S]*?<\/svg>/gi, '').replace(/<[^>]+>/g, '').trim();
  const icoName = tone === 'good' ? 'check' : (tone === 'bad' || tone === 'warn' ? 'warn' : 'info');
  const icoColor = tone === 'good' ? 'var(--good)' : (tone === 'bad' ? 'var(--bad)' : (tone === 'warn' ? 'var(--warn)' : 'var(--accent)'));
  item.innerHTML = `${svgIcon(icoName, icoColor)}<span>${escapeHtml(cleanText)}</span>`;
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
  showToast(` ${labelPrefix} ${cleanId} скопирован!`, 'good');
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
 * - Все кнопки «<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2z" fill="rgba(251,191,36,0.32)" stroke="#fbbf24" stroke-width="1.8" stroke-linejoin="round"/></svg> Закрыть» расположены внизу в закреплённом нижнем баре (.modal-sticky-footer).
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
      <button type="button" class="btn" id="modalCloseBtn" data-modal-close style="flex:1;min-width:0;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg> Закрыть</button>
    `;
  } else if (footerHtml && canClose && !footerHtml.includes('data-modal-close') && !footerHtml.includes('modalCloseBtn')) {
    footerHtml += `<button type="button" class="btn" id="modalCloseBtn" data-modal-close style="flex:1;min-width:0;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg> Закрыть</button>`;
  }
  const headerRightHtml = (options && options.headerRightHtml) ? String(options.headerRightHtml) : '';
  backdrop.innerHTML = `
    <div class="modal-box ${footerHtml ? 'modal-has-sticky-footer' : ''}" role="dialog" aria-modal="true" aria-label="${escapeHtml(String(title || '').replace(/<[^>]+>/g, '').trim())}">
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
  title = '<svg class="k-ico" style="color:var(--warn);" viewBox="0 0 24 24" fill="none"><path d="M12 3L2.5 19.5h19L12 3z" fill="rgba(245,158,11,0.24)" stroke="#f59e0b" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 9v5M12 17h.01" stroke="#fbbf24" stroke-width="2" stroke-linecap="round"/></svg> Подтверждение удаления',
  message = 'Вы уверены, что хотите выполнить удаление?',
  confirmLabel = '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Да, удалить',
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
        </button>
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
export const USER_AGREEMENT_STORAGE_KEY = 'klev_pro_ua_accepted_v260_r220';
export const POLICY_CONSENT_META_KEY = 'klev_pro_policy_consent_meta_v260';
export const REMOTE_POLICY_ENV_STORAGE_KEY = 'klev_pro_remote_policy_env_v1';
export const ACTIVE_POLICY_VERSION_DEFAULT = '2026.11.10-v2.8.3';
export const ACTIVE_APP_VERSION_DEFAULT = '2.8.3';
export const GEO_DISTRIBUTION_CONSENT_KEY = 'klev_pro_geo_internet_consent_v1';

export const DEFAULT_POLICY_SECTIONS = [{"id": "general_and_platforms", "title": "1. Общие положения, некоммерческий статус и режимы платформ (ЗоЗПП РФ, ФЗ № 149-ФЗ)", "text": "Экосистема «Клёв ПРО 2.0: Круг» (домены клевпро.рф / klevpro.ru, веб-приложение PWA, мобильное приложение Android APK и Telegram-бот @KlevProClubBot, возрастная маркировка 12+ по ст. 6 ФЗ № 436-ФЗ) является бесплатным некоммерческим информационно-справочным проектом для рыболовов-любителей. Правообладатель и оператор: Тхор Антон Сергеевич (e-mail: i@athor.ru). В Android APK все пользовательские данные (профиль, постоянный ID, точки на карте, журнал уловов с фото, маршруты) хранятся в защищённом системном разделе «Данные приложения» (Context.getFilesDir()), который не удаляется при очистке кэша. В мини-приложении Telegram (TMA) действует облегчённый режим просмотра и оперативной работы (выгрузка/загрузка файлов, хранение фото в журнале, офлайн-карты, кнопка SOS и функции Фаз 2 и 3 в мини-приложении отключены)."}, {"id": "privacy_and_id", "title": "2. Единый Рыболовный ID и Политика конфиденциальности (Zero-PII, ФЗ № 152-ФЗ)", "text": "Приложение построено по архитектуре Zero-PII: система не запрашивает и не собирает ФИО, паспортные данные, номера телефонов или e-mail. Без регистрации устройству на 24 часа выдаётся временный резервный ID (FP_XXRZYYYY, позывной «Гость (Резерв)»), открывающий доступ к погоде и прогнозу клёва на сегодня, атласу 115 видов рыб РФ (без ИИ), календарю, точкам на карте и журналу уловов. При регистрации Логина и Пароля за пользователем один раз и навсегда закрепляется единственный постоянный региональный ID (FP_XXAAA001..999). При входе под своим логином и паролем с любого устройства (смартфон, планшет, ПК) система проверяет аккаунт в базе Cloudflare D1, возвращает единый постоянный ID пользователя и автоматически удаляет временный гостевой номер. Пароли хешируются по стандарту PBKDF2-HMAC-SHA256 (100 000 итераций), а сетевые пакеты через резервные анти-DPI шлюзы шифруются алгоритмом RSA-OAEP-2048 + AES-256-GCM."}, {"id": "geo_consent", "title": "3. Порядок обработки геолокации в сети Интернет (ст. 10.1 ФЗ № 152-ФЗ)", "text": "Для расчёта локального прогноза клёва, температуры воды, толщины льда и записи личного маршрута координаты обрабатываются на устройстве пользователя. Передача геоданных в сеть Интернет (в разделы «Круг ±5 км», «Экипаж 72 ч», «Слипы/Точки», «Чаты» или сигнал «SOS») осуществляется только при наличии отдельного предварительного согласия пользователя. Пользователь вправе в любой момент отозвать согласие одной кнопкой в профиле или на карте — при отзыве все ранее переданные геоданные и точки пользователя немедленно удаляются с сервера и из чатов. Оперативные точки «Круга» и «Экипажа (72 ч)» автоматически удаляются через 72 часа."}, {"id": "account_deletion", "title": "4. Право на полное удаление учётной записи («Удалить УЗ»)", "text": "Пользователь имеет право в любой момент удалить свою учётную запись через раздел «Профиль и ID» -> «Удалить УЗ». При удалении учётной записи с сервера и из базы данных D1 безвозвратно удаляются: профиль и постоянный ID пользователя, все опубликованные точки «Круга» и «Слипов», уловы, сообщения во всех региональных и личных чатах, а также привязка к Telegram."}, {"id": "ip_and_data_sources", "title": "5. Интеллектуальная собственность, картография и метео-гидрологические источники (ГК РФ)", "text": "Исключительные права на программный код, 115 иллюстраций рыб, базу водоёмов РФ и физико-математические модели принадлежат правообладателю (© Тхор А. С., 2025–2026). Картографические материалы предоставляются ООО «Яндекс» для личного некоммерческого использования в соответствии с Условиями использования сервиса Яндекс.Карты (https://yandex.ru/legal/maps_termsofuse/), а также проектами OpenStreetMap (ODbL) и OSRM. Расчётное ядро использует открытые метеорологические, гидрологические, ледовые и дорожные сводки Гидрометцентра России (meteoinfo.ru), MET Norway и Open-Meteo."}, {"id": "beta_and_safety", "title": "6. Регламент Бета-теста (Фазы 2 и 3), безопасность на воде, льду и дорогах (ГИМС МЧС РФ, ФЗ № 166-ФЗ)", "text": "Функции закрытого Бета-теста — Фаза 2 (ИИ-распознавание улова по фото, диагностика патологий рыб и голосовой ИИ-помощник) и Фаза 3 (фоновая запись маршрута с привязкой к дорогам и тропам, голосовое ведение по маршруту и возврат по следу «Я потерялся») — предоставляются зарегистрированным участникам тестирования в ознакомительном режиме. Все расчёты прогноза клёва, температуры воды, толщины льда, дорожных предупреждений о гололёде/гололедице и голосовые подсказки навигатора носят исключительно информационно-справочный характер и не заменяют официальные сводки МЧС России, ГИМС и экстренный вызов 112. Пользователь обязуется соблюдать Правила рыболовства РФ (ФЗ № 166-ФЗ)."}];

export function parsePolicySectionsFromEditableText(rawText = '') {
  const txt = String(rawText || '').trim();
  if (!txt) return DEFAULT_POLICY_SECTIONS;
  const blocks = txt.split(/\n(?=\s*(?:===|\d+\.\s))/g).map(b => b.trim()).filter(Boolean);
  if (blocks.length === 0) return DEFAULT_POLICY_SECTIONS;
  const out = [];
  blocks.forEach((blk, idx) => {
    const lines = blk.split('\n');
    let firstLine = lines[0].replace(/^===\s*|\s*===$/g, '').trim();
    let bodyLines = lines.slice(1).join('\n').trim();
    if (!bodyLines && firstLine.includes(':')) {
      const parts = firstLine.split(':');
      firstLine = parts[0].trim();
      bodyLines = parts.slice(1).join(':').trim();
    }
    out.push({
      id: `sec_${idx + 1}`,
      title: firstLine || `Раздел ${idx + 1}`,
      text: bodyLines || firstLine
    });
  });
  return out.length > 0 ? out : DEFAULT_POLICY_SECTIONS;
}

export function formatPolicySectionsToEditableText(sections = DEFAULT_POLICY_SECTIONS) {
  const arr = Array.isArray(sections) && sections.length > 0 ? sections : DEFAULT_POLICY_SECTIONS;
  return arr.map(s => `=== ${s.title || 'Раздел'} ===\n${s.text || ''}`).join('\n\n');
}

export function getRemotePolicyFromClientEnv() {
  const fallback = {
    policyVersion: ACTIVE_POLICY_VERSION_DEFAULT,
    appVersion: ACTIVE_APP_VERSION_DEFAULT,
    appRevision: 'r230',
    effectiveDate: '10 ноября 2026 г.',
    title: 'Политика конфиденциальности, Пользовательское соглашение и Правила обработки геоданных «Клёв ПРО 2.0»',
    summary: 'Редакция v2.8.3 (r230): защита данных в разделе «Данные приложения» Android APK (Context.getFilesDir), единый постоянный ID на всех устройствах, калибровка гидрологии по сводкам Росгидромета (meteoinfo.ru) и динамическое обновление политики без пересборки.',
    sections: DEFAULT_POLICY_SECTIONS,
    broadcastId: ''
  };
  try {
    if (typeof window !== 'undefined' && window.__KLEV_REMOTE_POLICY_ENV__ && typeof window.__KLEV_REMOTE_POLICY_ENV__ === 'object') {
      const wEnv = window.__KLEV_REMOTE_POLICY_ENV__;
      return {
        ...fallback,
        ...wEnv,
        sections: Array.isArray(wEnv.sections) && wEnv.sections.length > 0 ? wEnv.sections : fallback.sections
      };
    }
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(REMOTE_POLICY_ENV_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          const merged = {
            ...fallback,
            ...parsed,
            sections: Array.isArray(parsed.sections) && parsed.sections.length > 0 ? parsed.sections : fallback.sections
          };
          if (typeof window !== 'undefined') window.__KLEV_REMOTE_POLICY_ENV__ = merged;
          return merged;
        }
      }
    }
  } catch (e) {}
  return fallback;
}

export function saveRemotePolicyToClientEnv(policyPayload) {
  if (!policyPayload || typeof policyPayload !== 'object') return getRemotePolicyFromClientEnv();
  const current = getRemotePolicyFromClientEnv();
  const nextSections = Array.isArray(policyPayload.sections) && policyPayload.sections.length > 0
    ? policyPayload.sections
    : (typeof policyPayload.sectionsText === 'string' && policyPayload.sectionsText.trim()
        ? parsePolicySectionsFromEditableText(policyPayload.sectionsText)
        : current.sections);
  const updated = {
    policyVersion: String(policyPayload.policyVersion || current.policyVersion || ACTIVE_POLICY_VERSION_DEFAULT).trim(),
    appVersion: String(policyPayload.appVersion || current.appVersion || ACTIVE_APP_VERSION_DEFAULT).trim(),
    appRevision: String(policyPayload.appRevision || current.appRevision || 'r230').trim(),
    effectiveDate: String(policyPayload.effectiveDate || current.effectiveDate || '10 ноября 2026 г.').trim(),
    title: String(policyPayload.title || current.title).trim(),
    summary: String(policyPayload.summary || current.summary).trim(),
    sections: nextSections,
    broadcastId: String(policyPayload.broadcastId || current.broadcastId || '').trim(),
    updatedAt: String(policyPayload.updatedAt || new Date().toISOString()),
    savedToEnvAt: Date.now()
  };
  try {
    if (typeof window !== 'undefined') {
      window.__KLEV_REMOTE_POLICY_ENV__ = updated;
      window.__KLEV_ACTIVE_POLICY_VERSION__ = updated.policyVersion;
      window.__KLEV_ACTIVE_APP_VERSION__ = updated.appVersion;
      window.__KLEV_ACTIVE_POLICY_BROADCAST_ID__ = updated.broadcastId;
    }
    if (typeof localStorage !== 'undefined') {
      const serialized = JSON.stringify(updated);
      localStorage.setItem(REMOTE_POLICY_ENV_STORAGE_KEY, serialized);
      if (typeof window !== 'undefined' && window.AndroidBridge && typeof window.AndroidBridge.saveAppDataKey === 'function') {
        window.AndroidBridge.saveAppDataKey(REMOTE_POLICY_ENV_STORAGE_KEY, serialized);
      }
    }
  } catch (e) {}
  return updated;
}

export function getSavedPolicyConsentMeta() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(POLICY_CONSENT_META_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

export function isPolicyVersionAccepted(expectedPolicyVer = null, expectedAppVer = null, expectedBroadcastId = null) {
  const meta = getSavedPolicyConsentMeta();
  if (!meta || !meta.chkPrivacy || !meta.chkTerms) return false;
  const envPol = getRemotePolicyFromClientEnv();
  const targetVer = expectedPolicyVer || (typeof window !== 'undefined' && window.__KLEV_ACTIVE_POLICY_VERSION__) || envPol.policyVersion || ACTIVE_POLICY_VERSION_DEFAULT;
  const targetBcId = expectedBroadcastId !== null
    ? expectedBroadcastId
    : ((typeof window !== 'undefined' && window.__KLEV_ACTIVE_POLICY_BROADCAST_ID__) || envPol.broadcastId || '');
  if (meta.policyVersion !== targetVer) return false;
  if (targetBcId && meta.broadcastId !== targetBcId) return false;
  return true;
}

export function isGeoDistributionConsentActive() {
  try {
    if (typeof localStorage === 'undefined') return false;
    const raw = localStorage.getItem(GEO_DISTRIBUTION_CONSENT_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return Boolean(parsed && parsed.granted === true && parsed.chkInternetSpread === true);
  } catch (e) {
    return false;
  }
}

export function getGeoDistributionConsentMeta() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(GEO_DISTRIBUTION_CONSENT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function setGeoDistributionConsentState(granted = true) {
  try {
    if (typeof localStorage === 'undefined') return;
    if (granted) {
      const envPol = getRemotePolicyFromClientEnv();
      const rec = {
        granted: true,
        chkLocationAccess: true,
        chkInternetSpread: true,
        grantedAt: Date.now(),
        policyVersion: envPol.policyVersion || ACTIVE_POLICY_VERSION_DEFAULT
      };
      localStorage.setItem(GEO_DISTRIBUTION_CONSENT_KEY, JSON.stringify(rec));
    } else {
      localStorage.removeItem(GEO_DISTRIBUTION_CONSENT_KEY);
    }
  } catch (e) {}
}

export function ensureGeoDistributionConsent(actionLabel = 'отправки геопозиции в сеть', onGranted = null) {
  if (isGeoDistributionConsentActive()) {
    if (typeof onGranted === 'function') onGranted();
    return true;
  }
  if (typeof document === 'undefined') return false;
  let overlay = document.getElementById('klevGeoConsentBackdrop');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'klevGeoConsentBackdrop';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:12650;background:rgba(4,9,20,0.88);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:12px;';
    document.body.appendChild(overlay);
  }
  overlay.style.display = 'flex';
  overlay.innerHTML = `
    <div class="card" role="dialog" aria-modal="true" style="max-width:500px;width:100%;background:var(--panel);border:1.5px solid var(--accent);border-radius:var(--r-md);padding:15px;display:flex;flex-direction:column;gap:11px;box-shadow:0 20px 50px rgba(0,0,0,0.82);">
      <div style="display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--border);padding-bottom:8px;">
        <svg class="k-ico" style="color:var(--accent);width:22px;height:22px;flex-shrink:0;" viewBox="0 0 24 24" fill="none"><path d="M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z" fill="rgba(56,189,248,0.22)" stroke="#38bdf8" stroke-width="1.9"/><circle cx="12" cy="11" r="2.3" fill="#38bdf8"/></svg>
        <div>
          <div style="font-size:var(--fs-md);font-weight:900;color:var(--accent);">Согласие на передачу геоданных в сеть Интернет</div>
          <div style="font-size:11px;color:var(--muted);">Требуется для действия: ${escapeHtml(actionLabel)} (ст. 10.1 ФЗ № 152-ФЗ)</div>
        </div>
      </div>
      <div style="padding:10px 12px;background:var(--card);border:1px solid var(--border);border-radius:var(--r-sm);font-size:12px;line-height:1.48;color:var(--text);">
        Вы собираетесь передать данные о своём местоположении (координаты точки или водоёма) на сервер «Клёв ПРО 2.0» для отображения другим пользователям в выбранном разделе («Круг», «Экипаж», «Слипы/Точки», «Чаты» или «SOS»).<br><br>
        Вы можете в любой момент <b>отозвать это согласие</b> в профиле или на карте — при отзыве все ранее переданные вами геоданные и точки будут автоматически удалены из чатов, кругов и базы данных.
      </div>
      <label style="display:flex;align-items:flex-start;gap:9px;padding:9px 10px;background:rgba(56,189,248,0.08);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:12px;line-height:1.4;">
        <input type="checkbox" id="geoConsentChk1" style="margin-top:2px;width:18px;height:18px;accent-color:#10b981;flex-shrink:0;">
        <span>Разрешаю приложению определить и использовать мои координаты GPS/ГЛОНАСС для выполнения операции.</span>
      </label>
      <label style="display:flex;align-items:flex-start;gap:9px;padding:9px 10px;background:rgba(16,185,129,0.08);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:12px;line-height:1.4;">
        <input type="checkbox" id="geoConsentChk2" style="margin-top:2px;width:18px;height:18px;accent-color:#10b981;flex-shrink:0;">
        <span><b>Даю согласие на распространение моих геоданных в сети Интернет</b> в рамках выбранного мною раздела приложения (ст. 10.1 ФЗ № 152-ФЗ).</span>
      </label>
      <div style="display:grid;grid-template-columns:1fr 1.3fr;gap:8px;margin-top:2px;">
        <button type="button" class="btn" id="geoConsentCancelBtn" style="min-height:40px;font-weight:800;">Отмена</button>
        <button type="button" class="btn btn-good" id="geoConsentConfirmBtn" disabled style="min-height:40px;font-weight:900;opacity:0.5;">Подтвердить согласие</button>
      </div>
    </div>
  `;
  const chk1 = overlay.querySelector('#geoConsentChk1');
  const chk2 = overlay.querySelector('#geoConsentChk2');
  const confirmBtn = overlay.querySelector('#geoConsentConfirmBtn');
  const syncBtn = () => {
    const ok = Boolean(chk1?.checked && chk2?.checked);
    if (confirmBtn) {
      confirmBtn.disabled = !ok;
      confirmBtn.style.opacity = ok ? '1' : '0.5';
    }
  };
  chk1?.addEventListener('change', syncBtn);
  chk2?.addEventListener('change', syncBtn);
  overlay.querySelector('#geoConsentCancelBtn')?.addEventListener('click', () => {
    overlay.style.display = 'none';
    overlay.innerHTML = '';
  });
  confirmBtn?.addEventListener('click', () => {
    if (!chk1?.checked || !chk2?.checked) return;
    setGeoDistributionConsentState(true);
    overlay.style.display = 'none';
    overlay.innerHTML = '';
    showToast('Согласие на передачу геоданных подтверждено', 'good');
    if (typeof window !== 'undefined' && typeof window.__KLEV_ON_GEO_CONSENT_CHANGED__ === 'function') {
      try { window.__KLEV_ON_GEO_CONSENT_CHANGED__(true); } catch (e) {}
    }
    if (typeof onGranted === 'function') onGranted();
  });
  return false;
}

export const USER_AGREEMENT_MIN_READ_SECONDS = 15;
export function isUserAgreementAccepted() {
  try {
    return isPolicyVersionAccepted() || Boolean(typeof localStorage !== 'undefined' && localStorage.getItem(USER_AGREEMENT_STORAGE_KEY) && isPolicyVersionAccepted());
  } catch (e) {
    return false;
  }
}

export function openUserAgreementModal({
  requireVerification = false,
  isRemotePushUpdate = false,
  onAccepted = null,
  onClose = null
} = {}) {
  if (typeof document === 'undefined') return;
  const envPol = getRemotePolicyFromClientEnv();
  const alreadyAcceptedCurrent = isPolicyVersionAccepted(envPol.policyVersion, envPol.appVersion, envPol.broadcastId);
  const needCheckboxes = Boolean(requireVerification || isRemotePushUpdate || !alreadyAcceptedCurrent);

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

  const sectionsHtml = (Array.isArray(envPol.sections) && envPol.sections.length > 0 ? envPol.sections : DEFAULT_POLICY_SECTIONS)
    .map(sec => `
      <div>
        <b style="color:var(--accent);">${escapeHtml(sec.title || 'Раздел')}</b><br>
        ${escapeHtml(sec.text || '').replace(/\n/g, '<br>')}
      </div>
    `).join('');

  overlay.style.display = 'flex';
  overlay.innerHTML = `
    <div class="card" role="dialog" aria-modal="true" aria-label="Пользовательское соглашение Клёв ПРО 2.0" style="max-width:540px;width:100%;max-height:92vh;background:var(--panel);border:1.5px solid var(--accent);border-radius:var(--r-md);padding:14px;display:flex;flex-direction:column;gap:10px;box-shadow:0 18px 48px rgba(0,0,0,0.75);">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;border-bottom:1px solid var(--border);padding-bottom:8px;">
        <div style="min-width:0;flex:1;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;">
            <div style="font-size:var(--fs-md);font-weight:900;color:var(--accent);">Пользовательское соглашение и Политика (152-ФЗ)</div>
            <div style="display:flex;gap:4px;align-items:center;">
              <span class="pill pill-good" style="font-size:10px;font-weight:900;padding:2px 7px;">Ред. ${escapeHtml(envPol.policyVersion)}</span>
              <span class="pill" style="font-size:10.5px;font-weight:900;padding:2px 7px;">12+</span>
            </div>
          </div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;">
            ${requireVerification
              ? 'Для завершения регистрации внимательно прочитайте соглашение и пролистайте его до конца'
              : (isRemotePushUpdate ? 'Администратор обновил редакцию Политики и Пользовательского соглашения — ознакомьтесь и подтвердите согласие' : 'Правовой статус (ЗоЗПП / 149-ФЗ), защита данных (152-ФЗ), авторские права (ГК РФ) и безопасность')}
          </div>
        </div>
      </div>
      ${envPol.summary ? `
        <div style="padding:8px 10px;border-radius:8px;background:rgba(56,189,248,0.10);border:1px solid rgba(56,189,248,0.35);font-size:11.5px;line-height:1.4;color:var(--text);">
          <b style="color:var(--accent);">Актуальная сводка редакции (${escapeHtml(envPol.policyVersion)}):</b> ${escapeHtml(envPol.summary)}
        </div>
      ` : ''}
      ${requireVerification ? `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px;">
          <div id="uaScrollStatusBox" style="padding:6px 8px;border-radius:6px;background:rgba(245,158,11,0.12);border:1px solid var(--warn);color:var(--warn);font-weight:800;text-align:center;">
            Пролистайте текст до конца
          </div>
          <div id="uaTimerStatusBox" style="padding:6px 8px;border-radius:6px;background:rgba(56,189,248,0.12);border:1px solid var(--accent);color:var(--accent);font-weight:800;text-align:center;">
            Время чтения: ${secondsLeft} сек.
          </div>
        </div>
      ` : ''}
      <div id="uaScrollTextContainer" style="flex:1;min-height:190px;max-height:46vh;overflow-y:auto;padding:12px;background:var(--card);border:1px solid var(--border);border-radius:var(--r-sm);font-size:12.5px;line-height:1.52;color:var(--text);display:flex;flex-direction:column;gap:10px;">
        ${sectionsHtml}
        <div id="uaBottomSentinel" style="padding:8px 10px;background:rgba(16,185,129,0.10);border:1px dashed var(--good);border-radius:6px;font-size:11.5px;color:var(--good);font-weight:800;text-align:center;">
          Конец текста Пользовательского соглашения и Политики конфиденциальности «Клёв ПРО 2.0» (Редакция ${escapeHtml(envPol.policyVersion)})
        </div>
      </div>
      ${needCheckboxes ? `
        <div style="display:flex;flex-direction:column;gap:6px;font-size:11.5px;">
          <label style="display:flex;align-items:flex-start;gap:8px;padding:7px 9px;background:rgba(56,189,248,0.08);border:1px solid var(--border);border-radius:8px;cursor:pointer;line-height:1.35;">
            <input type="checkbox" id="uaChkPrivacy" checked style="margin-top:2px;width:16px;height:16px;accent-color:#10b981;flex-shrink:0;">
            <span>Я ознакомился(лась) и принимаю Политику конфиденциальности (ФЗ № 152-ФЗ)</span>
          </label>
          <label style="display:flex;align-items:flex-start;gap:8px;padding:7px 9px;background:rgba(16,185,129,0.08);border:1px solid var(--border);border-radius:8px;cursor:pointer;line-height:1.35;">
            <input type="checkbox" id="uaChkTerms" checked style="margin-top:2px;width:16px;height:16px;accent-color:#10b981;flex-shrink:0;">
            <span>Я ознакомился(лась) и принимаю Пользовательское соглашение, условия Бета-теста и правила безопасности на воде</span>
          </label>
        </div>
      ` : ''}
      <div style="display:grid;grid-template-columns:minmax(100px,1fr) minmax(150px,1.6fr);gap:8px;padding-top:4px;width:100%;">
        <button type="button" class="btn btn-sm" id="uaCancelCloseBtn" style="width:100%;min-height:42px;padding:6px 10px;font-size:13px;font-weight:800;">
          Закрыть
        </button>
        ${requireVerification ? `
          <button type="button" class="btn btn-sm" id="uaAcceptConfirmBtn" disabled style="width:100%;min-height:42px;padding:6px 10px;font-size:12.5px;font-weight:800;line-height:1.2;white-space:normal;text-align:center;opacity:0.55;cursor:not-allowed;">
            Прочитайте (${secondsLeft} с)
          </button>
        ` : `
          <button type="button" class="btn btn-sm btn-good" id="uaAcceptConfirmBtn" style="width:100%;min-height:42px;padding:6px 10px;font-size:13px;font-weight:800;line-height:1.2;white-space:normal;text-align:center;">
            ${alreadyAcceptedCurrent && !isRemotePushUpdate ? 'Понятно (Принято)' : 'Принять соглашение'}
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
        scrollBadge.textContent = 'Пролистано до конца';
      } else {
        scrollBadge.textContent = 'Пролистайте до конца ↓';
      }
    }
    if (timerBadge) {
      if (secondsLeft <= 0) {
        timerBadge.style.background = 'rgba(16,185,129,0.15)';
        timerBadge.style.borderColor = 'var(--good)';
        timerBadge.style.color = 'var(--good)';
        timerBadge.textContent = 'Время чтения выполнено';
      } else {
        timerBadge.textContent = `Время чтения: ${secondsLeft} сек.`;
      }
    }
    if (acceptBtn) {
      const unlocked = scrolledToBottom && secondsLeft <= 0;
      acceptBtn.disabled = !unlocked;
      if (unlocked) {
        acceptBtn.className = 'btn btn-sm btn-good';
        acceptBtn.style.opacity = '1';
        acceptBtn.style.cursor = 'pointer';
        acceptBtn.textContent = 'Принять и продолжить';
      } else if (!scrolledToBottom && secondsLeft > 0) {
        acceptBtn.textContent = `Листайте вниз (${secondsLeft} с)`;
      } else if (!scrolledToBottom) {
        acceptBtn.textContent = 'Пролистайте до конца ↓';
      } else {
        acceptBtn.textContent = `Чтение (${secondsLeft} с)...`;
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
      const cPriv = overlay.querySelector('#uaChkPrivacy');
      const cTerms = overlay.querySelector('#uaChkTerms');
      if ((cPriv && !cPriv.checked) || (cTerms && !cTerms.checked)) {
        showToast('Отметьте оба чекбокса согласия с Политикой и Пользовательским соглашением', 'warn');
        return;
      }
      localStorage.setItem(USER_AGREEMENT_STORAGE_KEY, String(Date.now()));
      const latestPol = getRemotePolicyFromClientEnv();
      const curPolVer = latestPol.policyVersion || ACTIVE_POLICY_VERSION_DEFAULT;
      const curAppVer = latestPol.appVersion || ACTIVE_APP_VERSION_DEFAULT;
      const curBcId = latestPol.broadcastId || '';
      localStorage.setItem(POLICY_CONSENT_META_KEY, JSON.stringify({
        policyVersion: curPolVer,
        appVersion: curAppVer,
        broadcastId: curBcId,
        chkPrivacy: true,
        chkTerms: true,
        acceptedAt: Date.now()
      }));
      if (typeof window !== 'undefined' && typeof window.__KLEV_ON_POLICY_ACCEPTED__ === 'function') {
        try { window.__KLEV_ON_POLICY_ACCEPTED__({ policyVersion: curPolVer, appVersion: curAppVer, broadcastId: curBcId }); } catch (_e) {}
      }
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
        <button type="button" class="btn" id="fishLightboxCloseBtn" aria-label="Закрыть просмотр" style="width:100%;"><svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg> Закрыть</button>
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
  if (typeof document !== 'undefined' && (document.documentElement.getAttribute('data-tg-miniapp') === '1' || document.documentElement.getAttribute('data-tg-webapp') === '1')) {
    showToast('В мини-приложении Telegram выгрузка файлов отключена', 'info');
    return false;
  }
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
  if (typeof document !== 'undefined' && (document.documentElement.getAttribute('data-tg-miniapp') === '1' || document.documentElement.getAttribute('data-tg-webapp') === '1')) {
    // В Telegram Mini App уведомления работают только внутри запущенного приложения (без системных фоновых Push)
    return false;
  }
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
  if (typeof document !== 'undefined' && (document.documentElement.getAttribute('data-tg-miniapp') === '1' || document.documentElement.getAttribute('data-tg-webapp') === '1')) {
    showToast('В мини-приложении Telegram уведомления отображаются автоматически, пока приложение запущено', 'info');
    return false;
  }
  try {
    if (typeof window !== 'undefined' && window.AndroidBridge) {
      if (typeof window.AndroidBridge.requestNotificationPermission === 'function') {
        window.AndroidBridge.requestNotificationPermission();
        showToast(' Запрос системных уведомлений Android выполнен! Проверьте шторку уведомлений.', 'good');
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
        showToast(' Системные уведомления разрешены и протестированы!', 'good');
        return true;
      }
      showToast(' Разрешение на системные уведомления отклонено браузером. Разрешите уведомления в настройках сайта.', 'warn');
      return false;
    } catch (e) {}
  }
  showToast(' Активны звуковые и всплывающие уведомления внутри приложения', 'info');
  return false;
}
/**
 * Кастомный 3D Liquid Glass выпадающий список (заменяет системное тёмно-коричневое окно Android <select>)
 */
export function openCustomSelectSheet(selectEl) {
  if (!selectEl || typeof document === "undefined" || selectEl.disabled) return;
  let backdrop = document.getElementById("klevCustomSelectBackdrop");
  if (!backdrop) {
    backdrop = document.createElement("div");
    backdrop.id = "klevCustomSelectBackdrop";
    backdrop.className = "klev-select-backdrop";
    document.body.appendChild(backdrop);
  }

  // Находим заголовок поля
  let titleText = selectEl.getAttribute("data-select-title") || selectEl.getAttribute("title") || "";
  if (!titleText && selectEl.id) {
    const lbl = document.querySelector(`label[for="${selectEl.id}"]`);
    if (lbl) titleText = lbl.textContent.replace(/\s+/g, " ").replace(/:$/, "").trim();
  }
  if (!titleText && selectEl.parentElement) {
    const prevLbl = selectEl.parentElement.querySelector("label");
    if (prevLbl) titleText = prevLbl.textContent.replace(/\s+/g, " ").replace(/:$/, "").trim();
  }
  if (!titleText) titleText = "Выберите из списка";

  const items = [];
  const children = Array.from(selectEl.children || []);
  for (const child of children) {
    const tag = (child.tagName || "").toUpperCase();
    if (tag === "OPTGROUP") {
      const grpLabel = child.getAttribute("label") || "";
      const grpOpts = Array.from(child.querySelectorAll("option")).map(opt => ({
        value: opt.value,
        label: (opt.textContent || "").trim(),
        selected: opt.value === selectEl.value || opt.selected,
        disabled: opt.disabled
      }));
      if (grpOpts.length > 0) {
        items.push({ type: "group", label: grpLabel, options: grpOpts });
      }
    } else if (tag === "OPTION") {
      items.push({
        type: "option",
        value: child.value,
        label: (child.textContent || "").trim(),
        selected: child.value === selectEl.value || child.selected,
        disabled: child.disabled
      });
    }
  }

  const totalOptions = items.reduce((acc, it) => acc + (it.type === "group" ? it.options.length : 1), 0);
  const showSearch = totalOptions >= 7;

  const renderOptionsHtml = (filterStr = "") => {
    const q = String(filterStr || "").trim().toLowerCase().replace(/ё/g, "е");
    let htmlOut = "";
    let countVisible = 0;

    const renderSingleOpt = (opt) => {
      if (q && !opt.label.toLowerCase().replace(/ё/g, "е").includes(q)) return "";
      countVisible++;
      const isSel = String(opt.value) === String(selectEl.value);
      return `
        <button type="button" class="klev-select-opt ${isSel ? "selected" : ""}" data-klev-opt-val="${escapeHtml(opt.value)}" ${opt.disabled ? "disabled" : ""}>
          <span style="min-width:0;flex:1;word-break:normal;">${escapeHtml(opt.label)}</span>
          <span class="klev-select-check">${isSel ? "✓" : ""}</span>
        </button>
      `;
    };

    for (const item of items) {
      if (item.type === "group") {
        const subHtml = item.options.map(renderSingleOpt).join("");
        if (subHtml) {
          htmlOut += `<div class="klev-select-group-lbl">${escapeHtml(item.label)}</div>${subHtml}`;
        }
      } else {
        htmlOut += renderSingleOpt(item);
      }
    }
    if (countVisible === 0) {
      htmlOut = `<div style="padding:18px;text-align:center;color:var(--muted);font-size:12.5px;">Ничего не найдено по запросу «${escapeHtml(filterStr)}»</div>`;
    }
    return htmlOut;
  };

  backdrop.innerHTML = `
    <div class="klev-select-sheet" role="listbox" aria-label="${escapeHtml(titleText)}">
      <div class="klev-select-head">
        <div class="klev-select-title">${escapeHtml(titleText)}</div>
        <button type="button" class="btn btn-sm" id="klevSelectCloseBtn" style="min-height:30px;padding:2px 9px;font-weight:900;">✕</button>
      </div>
      ${showSearch ? `
        <div class="klev-select-search-wrap">
          <input type="search" class="input" id="klevSelectSearchInp" placeholder="Быстрый поиск по списку..." style="min-height:36px;font-size:12.5px;">
        </div>
      ` : ""}
      <div class="klev-select-list" id="klevSelectListBox">
        ${renderOptionsHtml("")}
      </div>
    </div>
  `;

  backdrop.classList.add("open");

  const closeSheet = () => {
    backdrop.classList.remove("open");
    backdrop.innerHTML = "";
  };

  backdrop.onclick = (e) => {
    if (e.target === backdrop) closeSheet();
  };
  backdrop.querySelector("#klevSelectCloseBtn")?.addEventListener("click", closeSheet);

  const listBox = backdrop.querySelector("#klevSelectListBox");
  const bindOptionClicks = () => {
    if (!listBox) return;
    listBox.querySelectorAll("[data-klev-opt-val]").forEach(btn => {
      btn.addEventListener("click", () => {
        const val = btn.getAttribute("data-klev-opt-val");
        if (val !== null && selectEl.value !== val) {
          selectEl.value = val;
          selectEl.dispatchEvent(new Event("input", { bubbles: true }));
          selectEl.dispatchEvent(new Event("change", { bubbles: true }));
        }
        closeSheet();
      });
    });
  };
  bindOptionClicks();

  // Автопрокрутка к выбранному пункту
  setTimeout(() => {
    const selBtn = listBox?.querySelector(".klev-select-opt.selected");
    if (selBtn && typeof selBtn.scrollIntoView === "function") {
      selBtn.scrollIntoView({ block: "nearest" });
    }
  }, 20);

  const searchInp = backdrop.querySelector("#klevSelectSearchInp");
  if (searchInp && listBox) {
    searchInp.addEventListener("input", (e) => {
      listBox.innerHTML = renderOptionsHtml(e.target.value || "");
      bindOptionClicks();
    });
  }
}

if (typeof document !== "undefined" && !window.__KLEV_CUSTOM_SELECT_BOUND__) {
  window.__KLEV_CUSTOM_SELECT_BOUND__ = true;
  document.addEventListener("mousedown", (e) => {
    const sel = e.target && e.target.closest ? e.target.closest("select") : null;
    if (sel && !sel.disabled) {
      e.preventDefault();
    }
  }, true);
  document.addEventListener("click", (e) => {
    const sel = e.target && e.target.closest ? e.target.closest("select") : null;
    if (sel && !sel.disabled) {
      e.preventDefault();
      e.stopPropagation();
      try { sel.blur(); } catch (_) {}
      openCustomSelectSheet(sel);
    }
  }, true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      const sel = e.target && e.target.closest ? e.target.closest("select") : null;
      if (sel && !sel.disabled) {
        e.preventDefault();
        openCustomSelectSheet(sel);
      }
    } else if (e.key === "Escape") {
      const bd = document.getElementById("klevCustomSelectBackdrop");
      if (bd && bd.classList.contains("open")) {
        bd.classList.remove("open");
        bd.innerHTML = "";
      }
    }
  }, true);
}

/**
 * Плавно прокручивает экран к целевому блоку, в котором произошли изменения,
 * и подсвечивает его заметным световым импульсом с плавным угасанием (~1.3 сек).
 */
export function flashHighlightElement(targetOrTargets, options = {}) {
  if (typeof document === 'undefined') return;
  const { scroll = true, block = 'center', delayMs = 80 } = options || {};
  const runHighlight = () => {
    const rawList = Array.isArray(targetOrTargets) ? targetOrTargets : [targetOrTargets];
    const resolvedEls = [];
    for (const item of rawList) {
      if (!item) continue;
      if (typeof item === 'string') {
        document.querySelectorAll(item).forEach(el => {
          if (el && el.offsetParent !== null && !resolvedEls.includes(el)) {
            resolvedEls.push(el);
          }
        });
      } else if (item && item.nodeType === 1) {
        if (item.offsetParent !== null && !resolvedEls.includes(item)) {
          resolvedEls.push(item);
        }
      }
    }
    if (resolvedEls.length === 0) return;
    if (scroll) {
      const primaryEl = resolvedEls[0];
      try {
        primaryEl.scrollIntoView({ behavior: 'smooth', block });
      } catch (_e) {
        try { primaryEl.scrollIntoView(); } catch (_e2) {}
      }
    }
    resolvedEls.forEach(el => {
      el.classList.remove('klev-flash-highlight');
      void el.offsetWidth;
      el.classList.add('klev-flash-highlight');
      if (el._klevFlashTimer) clearTimeout(el._klevFlashTimer);
      el._klevFlashTimer = setTimeout(() => {
        el.classList.remove('klev-flash-highlight');
        el._klevFlashTimer = null;
      }, 1350);
    });
  };
  if (delayMs > 0) {
    setTimeout(runHighlight, delayMs);
  } else {
    runHighlight();
  }
}
if (typeof window !== 'undefined') {
  window.__KLEV_FLASH_HIGHLIGHT__ = flashHighlightElement;
}

