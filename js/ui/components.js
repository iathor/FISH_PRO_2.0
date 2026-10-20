// js/ui/components.js

// === Icons ===
export const icons = {
  fish:     '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M2 12c2-4 6-7 10-7 3 0 6 2 8 4l2-3v12l-2-3c-2 2-5 4-8 4-4 0-8-3-10-7zm12-4a1 1 0 100 2 1 1 0 000-2z"/></svg>',
  map:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 3L3 5v16l6-2 6 2 6-2V3l-6 2-6-2z"/><path d="M9 3v16M15 5v16"/></svg>',
  weather:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/></svg>',
  forecast: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  log:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 3h12v18l-6-3-6 3V3z"/></svg>',
  location: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 2a7 7 0 00-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 00-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>',
  refresh:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12a9 9 0 11-3-6.7M21 4v6h-6"/></svg>'
};

// === DOM helper (FIXED: innerHTML, textContent, flat(Infinity)) ===
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'innerHTML') { node.innerHTML = v; }
    else if (k === 'textContent') { node.textContent = v; }
    else if (k.startsWith('on') && typeof v === 'function')
      node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

// === Chip ===
export function createChip(label, { variant = '', active = false, onClick } = {}) {
  const cls = ['chip'];
  if (variant) cls.push(`chip--${variant}`);
  if (active) cls.push('chip--active');
  return el('button', { class: cls.join(' '), type: 'button', onClick }, label);
}

// === Card ===
export function createCard({ title, value, children } = {}) {
  const card = el('div', { class: 'card' });
  if (title) card.append(el('div', { class: 'card__title' }, title));
  if (value) card.append(el('div', { class: 'card__value' }, value));
  if (children) card.append(children);
  return card;
}

// === Toast ===
export function toast(message, type = 'info', ms = 3200) {
  const container = document.getElementById('app-toasts');
  if (!container) return;
  const t = el('div', {
    class: `toast${type === 'error' ? ' toast--error' : ''}`,
    role: 'status'
  }, message);
  container.append(t);
  setTimeout(() => {
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 300);
  }, ms);
}

// === Placeholder ===
export function placeholder(icon, title, description) {
  return el('div', { class: 'module-placeholder' },
    el('div', { class: 'module-placeholder__icon', innerHTML: icons[icon] || icons.fish }),
    el('h2', {}, title),
    el('p', {}, description)
  );
}

// === Rating (5 fish icons) ===
let __ratingUid = 0;
export function renderRating(score, size = 16) {
  const rating = Math.max(0, Math.min(5, (score / 100) * 5));
  const color = rating < 1.8 ? 'var(--bad)' : rating < 3.3 ? 'var(--warn)' : 'var(--good)';
  const dPath = 'M2,8 Q8,2 15,5 L21,2 L19,8 L21,14 L15,11 Q8,14 2,8 Z';
  let html = `<div class="rating" role="img" aria-label="Клёв ${rating.toFixed(1)} из 5" style="display:inline-flex;gap:2px;align-items:center;">`;
  for (let i = 1; i <= 5; i++) {
    const frac = Math.max(0, Math.min(1, rating - (i - 1)));
    const cid = `clip_${++__ratingUid}_${Date.now().toString(36)}`;
    html += `<svg width="${size}" height="${Math.round(size * 0.68)}" viewBox="0 0 23 16" aria-hidden="true">
      <defs><clipPath id="${cid}"><rect x="0" y="0" width="${23 * frac}" height="16"/></clipPath></defs>
      <path d="${dPath}" fill="var(--border)"/>
      ${frac > 0 ? `<path d="${dPath}" fill="${color}" clip-path="url(#${cid})"/>` : ''}
    </svg>`;
  }
  return html + '</div>';
}