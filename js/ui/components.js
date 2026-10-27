
export function escapeHtml(raw) {
  if (raw === null || raw === undefined) return '';
  return String(raw)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
 * в 1 нажатие (работает в браузере, Android APK WebView и Telegram Mini App без ручного выделения)
 */
export async function copyFisherIdToClipboard(rawId, labelPrefix = 'ID рыбака') {
  const cleanId = String(rawId || '').trim();
  if (!cleanId) return false;
  let copied = false;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(cleanId);
      copied = true;
    }
  } catch (e) {}
  if (!copied && typeof document !== 'undefined') {
    try {
      const ta = document.createElement('textarea');
      ta.value = cleanId;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, cleanId.length);
      copied = Boolean(document.execCommand('copy'));
      ta.remove();
    } catch (e) {}
  }
  showToast(`📋 ${labelPrefix} ${cleanId} скопирован в буфер обмена!`, 'good');
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
 * Ревизия 2.1.00:
 * - Все кнопки «✕ Закрыть» спущены вниз в закреплённый нижний бар (.modal-sticky-footer),
 *   чтобы до них всегда было легко дотянуться большим пальцем одной руки.
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
