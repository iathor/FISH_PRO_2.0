import { APP_VERSION, IMG_SEARCH_DIRS } from '../core/config.js';
import { getRatingWord } from '../core/format.js';

let clipSeq = 0;
const missingImagesSet = new Set();

export function renderFishVisual(f) {
  if (!f || missingImagesSet.has(f.id)) return getFishCustomSVG(f || { id: 'pike', name: 'Рыба' });
  return getFishCustomSVG(f);
}

export function handleFishImgError(imgEl, fishObj) {
  const fid = imgEl.getAttribute('data-fid');
  const nextTry = parseInt(imgEl.getAttribute('data-try') || '0', 10) + 1;
  if (nextTry < IMG_SEARCH_DIRS.length) {
    imgEl.setAttribute('data-try', String(nextTry));
    imgEl.src = `${IMG_SEARCH_DIRS[nextTry]}${fid}.png?v=${APP_VERSION}`;
  } else {
    missingImagesSet.add(fid);
    imgEl.outerHTML = getFishCustomSVG(fishObj || { id: fid, name: fid });
  }
}

export function renderFiveFish(score0to100, size = 17, theme = 'dark', showWord = false, customWord = null) {
  const rating = Math.max(0, Math.min(5, (score0to100 / 100) * 5));
  const word = customWord || getRatingWord(score0to100);
  let col = '#10b981';
  if (rating < 1.8 || (customWord && customWord.includes('нет'))) col = '#ef4444';
  else if (rating < 3.3 || (customWord && (customWord.includes('Нестабильно') || customWord.includes('Слабый')))) col = '#f59e0b';
  else col = '#10b981';
  const bgCol = theme === 'light' ? '#cbd5e1' : '#334155';
  const dPath = 'M2,8 Q8,2 15,5 L21,2 L19,8 L21,14 L15,11 Q8,14 2,8 Z';

  let iconsHtml = `<div class="fish-scale" role="img" aria-label="Рейтинг клёва ${rating.toFixed(1)} из 5: ${word}" title="${rating.toFixed(1)} / 5 • ${word}" style="display:inline-flex;gap:2px;align-items:center;">`;
  for (let i = 1; i <= 5; i++) {
    const frac = Math.max(0, Math.min(1, rating - (i - 1)));
    const w = (23 * frac).toFixed(1);
    const cid = `clip_${++clipSeq}`;
    iconsHtml += `<svg width="${size}" height="${Math.round(size * 0.68)}" viewBox="0 0 23 16" aria-hidden="true">
      <defs><clipPath id="${cid}"><rect x="0" y="0" width="${w}" height="16"/></clipPath></defs>
      <path d="${dPath}" fill="${bgCol}"/>${frac > 0 ? `<path d="${dPath}" fill="${col}" clip-path="url(#${cid})"/>` : ''}
    </svg>`;
  }
  iconsHtml += `</div>`;

  if (!showWord) return iconsHtml;
  return `<div class="fish-rating-box">${iconsHtml}<span class="fish-rating-label">${rating.toFixed(1)}/5 • ${word}</span></div>`;
}

export function getFishCustomSVG(f) {
  const uid = `f_${f.id}_${++clipSeq}`;
  if (['flounder', 'halibut', 'turbot', 'starry_flounder', 'plaice'].includes(f.id)) {
    const col = f.id === 'halibut' ? '#334155' : (f.id === 'turbot' ? '#64748b' : '#854d0e');
    return `<svg viewBox="0 0 100 44" role="img" aria-label="${f.name}"><defs><linearGradient id="${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${col}"/><stop offset="100%" stop-color="#cbd5e1"/></linearGradient></defs><ellipse cx="48" cy="22" rx="34" ry="17" fill="url(#${uid})" stroke="#0f172a" stroke-width="1.2"/><path d="M82,22 L94,14 L91,22 L94,30 Z" fill="${col}"/><circle cx="28" cy="18" r="2.2" fill="#facc15"/><circle cx="28" cy="18" r="1.1" fill="#000"/><circle cx="34" cy="15" r="2.2" fill="#facc15"/><circle cx="34" cy="15" r="1.1" fill="#000"/></svg>`;
  }
  if (['sterlet', 'siberian_sturgeon', 'russian_sturgeon', 'paddlefish', 'beluga', 'stellate_sturgeon', 'kaluga'].includes(f.id)) {
    const snout = f.id === 'paddlefish' ? 'M-6,22 L22,15' : 'M3,23 L22,15';
    return `<svg viewBox="0 0 100 44" role="img" aria-label="${f.name}"><defs><linearGradient id="${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#334155"/><stop offset="65%" stop-color="#64748b"/><stop offset="100%" stop-color="#fef08a"/></linearGradient></defs><path d="${snout} L78,17 L95,7 L88,22 L93,31 L78,24 L22,26 Z" fill="url(#${uid})" stroke="#0f172a" stroke-width="1.1"/><path d="M28,16 L32,13 L35,16 M42,16 L46,13 L49,16 M56,17 L60,14 L63,17" fill="#fde047"/><circle cx="21" cy="20" r="1.6" fill="#000"/></svg>`;
  }
  if (['catfish', 'amur_catfish', 'channel_catfish', 'burbot', 'eel', 'wolffish', 'loach'].includes(f.id)) {
    const bColor = f.id === 'channel_catfish' ? '#475569' : '#2a180a';
    return `<svg viewBox="0 0 100 44" role="img" aria-label="${f.name}"><defs><linearGradient id="${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${bColor}"/><stop offset="60%" stop-color="#694b2a"/><stop offset="100%" stop-color="#cbd5e1"/></linearGradient></defs><path d="M7,22 Q20,13 42,16 L84,17 C95,17 95,25 84,25 L42,26 Q20,29 7,22 Z" fill="url(#${uid})" stroke="#0f172a" stroke-width="1.1"/><path d="M10,25 L3,32 M12,24 L4,27" stroke="#334155" stroke-width="1.5" stroke-linecap="round"/><circle cx="15" cy="19" r="1.8" fill="#fde047"/><circle cx="15" cy="19" r="0.9" fill="#000"/></svg>`;
  }
  let topC = '#334155', midC = '#94a3b8', finC = '#dc2626', eyeC = '#ef4444';
  if (['silver_carp', 'grass_carp', 'buffalo', 'tilapia', 'black_carp', 'snakehead'].includes(f.id)) {
    topC = '#3f3f46'; midC = '#a1a1aa'; finC = '#71717a'; eyeC = '#fbbf24';
  } else if (['salmon', 'trout', 'rainbow_trout', 'brown_trout', 'char', 'pink_salmon', 'chum_salmon', 'coho_salmon', 'sockeye_salmon', 'chinook_salmon', 'cherry_salmon', 'taimen', 'lenok', 'white_salmon'].includes(f.id)) {
    topC = '#1e3a8a'; midC = '#f43f5e'; finC = '#be123c'; eyeC = '#fde047';
  }
  return `<svg viewBox="0 0 100 44" role="img" aria-label="${f.name}"><defs><linearGradient id="${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${topC}"/><stop offset="55%" stop-color="${midC}"/><stop offset="100%" stop-color="#ffffff"/></linearGradient></defs><path d="M38,12 L47,4 L58,12 Z" fill="#475569"/><path d="M33,27 L40,35 L47,28 Z" fill="${finC}"/><path d="M78,17 L92,9 L86,21 L92,33 L78,25 Z" fill="${finC}"/><path d="M9,21 Q34,10 62,14 L79,17 L79,25 L62,27 Q34,31 9,21 Z" fill="url(#${uid})" stroke="#1e293b" stroke-width="1.1"/><circle cx="17" cy="19.5" r="2.2" fill="${eyeC}"/><circle cx="17" cy="19.5" r="1.1" fill="#0f172a"/></svg>`;
}
