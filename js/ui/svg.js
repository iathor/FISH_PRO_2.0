import { APP_VERSION, IMG_SEARCH_DIRS } from '../core/config.js?v=2.1.21';
import { getRatingWord } from '../core/format.js?v=2.1.21';
import { FISH_DB } from '../data/species.js?v=2.1.21';
let clipSeq = 0;
const pngStatusCache = new Map();
const PNG_CACHE_STORAGE_KEY = 'klev_pro_png_status_v2_166';
try {
if (typeof sessionStorage !== 'undefined') {
const raw = sessionStorage.getItem(PNG_CACHE_STORAGE_KEY);
if (raw) {
const parsed = JSON.parse(raw);
if (parsed && typeof parsed === 'object') {
Object.keys(parsed).forEach(k => pngStatusCache.set(k, parsed[k]));
}
}
}
} catch (_) {}
function savePngStatus(fid, status) {
if (!fid) return;
pngStatusCache.set(fid, status);
try {
if (typeof sessionStorage !== 'undefined') {
const obj = {};
pngStatusCache.forEach((v, k) => { obj[k] = v; });
sessionStorage.setItem(PNG_CACHE_STORAGE_KEY, JSON.stringify(obj));
}
} catch (_) {}
}
export function renderFishVisual(f) {
const fish = f || { id: 'pike', name: 'Рыба' };
const fid = fish.id || 'pike';
const status = pngStatusCache.get(fid);
if (status === 'missing' || !IMG_SEARCH_DIRS || IMG_SEARCH_DIRS.length === 0) {
return getFishCustomSVG(fish);
}
const firstSrc = `${IMG_SEARCH_DIRS[0]}${fid}.png?v=${APP_VERSION}`;
return `<div class="fish-visual-hybrid has-png" data-fid="${fid}" style="position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden;">` +
`<img class="fish-visual-img" src="${firstSrc}" alt="${fish.name || fid}" loading="lazy" decoding="async" data-fid="${fid}" data-try="0" ` +
`style="width:100%;height:100%;max-width:100%;max-height:100%;object-fit:contain;display:block;margin:0 auto;opacity:1;" ` +
`onload="window.handleFishImgLoad && window.handleFishImgLoad(this)" ` +
`onerror="window.handleFishImgError && window.handleFishImgError(this)">` +
`</div>`;
}
export function handleFishImgLoad(imgEl) {
if (!imgEl) return;
const fid = imgEl.getAttribute('data-fid');
if (fid) savePngStatus(fid, 'ok');
imgEl.style.opacity = '1';
imgEl.style.position = 'relative';
const wrap = imgEl.closest('.fish-visual-hybrid');
if (wrap) {
wrap.classList.add('has-png');
const svgLayer = wrap.querySelector('.fish-visual-svg-layer');
if (svgLayer) {
svgLayer.setAttribute('data-hidden', '1');
svgLayer.style.display = 'none';
svgLayer.remove();
}
}
}
export function handleFishImgError(imgEl, fishObj) {
if (!imgEl) return;
const fid = imgEl.getAttribute('data-fid');
const nextTry = parseInt(imgEl.getAttribute('data-try') || '0', 10) + 1;
if (nextTry < IMG_SEARCH_DIRS.length) {
imgEl.setAttribute('data-try', String(nextTry));
imgEl.src = `${IMG_SEARCH_DIRS[nextTry]}${fid}.png?v=${APP_VERSION}`;
} else {
if (fid) savePngStatus(fid, 'missing');
const wrap = imgEl.closest('.fish-visual-hybrid');
if (wrap) {
const svgLayer = wrap.querySelector('.fish-visual-svg-layer');
if (svgLayer) svgLayer.style.display = 'flex';
imgEl.remove();
} else {
const found = FISH_DB.find(item => item.id === fid);
imgEl.outerHTML = getFishCustomSVG(fishObj || found || { id: fid || 'pike', name: fid || 'Рыба' });
}
}
}
if (typeof window !== 'undefined') {
window.handleFishImgError = handleFishImgError;
window.handleFishImgLoad = handleFishImgLoad;
}
export function renderFiveFish(score0to100, size = 18, theme = 'dark', showWord = false, customWord = null) {
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
const SPECIES_VISUAL_PROFILES = {
pike:              { m: 'pike', c: ['#1e3a1e', '#4d7c2b', '#fef9c3', '#c2410c', '#365314', '#facc15'], p: 'spots_gold' },
amur_pike:         { m: 'pike', c: ['#3f6212', '#a3b18a', '#f8fafc', '#b45309', '#4d7c0f', '#fde047'], p: 'spots_pike_black' },
perch:             { m: 'perch', c: ['#14532d', '#65a30d', '#fef08a', '#dc2626', '#365314', '#f59e0b'], p: 'bars_perch' },
ruffe:             { m: 'ruffe', c: ['#3f3f2c', '#a8a26e', '#fde68a', '#78716c', '#57534e', '#c084fc'], p: 'spots_dark' },
chinese_perch:     { m: 'perch', c: ['#422006', '#ca8a04', '#fef08a', '#9a3412', '#713f12', '#ef4444'], p: 'marbled' },
rotan:             { m: 'goby',  c: ['#1c1917', '#57534e', '#a8a29e', '#44403c', '#292524', '#f59e0b'], p: 'marbled' },
goby:              { m: 'goby',  c: ['#451a03', '#78350f', '#d6d3d1', '#57534e', '#44403c', '#fbbf24'], p: 'spots_dark' },
zander:            { m: 'zander', c: ['#1e293b', '#64748b', '#f8fafc', '#475569', '#334155', '#e2e8f0'], p: 'bars_zander' },
volga_zander:      { m: 'zander', c: ['#27374d', '#7c8da5', '#f1f5f9', '#64748b', '#334155', '#fbbf24'], p: 'bars_zander_bold' },
bream:             { m: 'bream', c: ['#292524', '#b45309', '#fef3c7', '#44403c', '#292524', '#facc15'], p: 'mesh_gold' },
white_bream:       { m: 'bream', c: ['#334155', '#94a3b8', '#f8fafc', '#ea580c', '#475569', '#fde047'], p: 'mesh_silver' },
blue_bream:        { m: 'bream', c: ['#1e3a8a', '#64748b', '#f8fafc', '#475569', '#334155', '#e2e8f0'], p: 'mesh_silver' },
sopa:              { m: 'bream', c: ['#334155', '#94a3b8', '#ffffff', '#64748b', '#334155', '#f8fafc'], p: 'mesh_silver' },
parabramis:        { m: 'bream', c: ['#1e293b', '#64748b', '#f8fafc', '#475569', '#334155', '#fde047'], p: 'mesh_silver' },
crucian:           { m: 'carp', c: ['#3f2e18', '#ca8a04', '#fef9c3', '#92400e', '#78350f', '#facc15'], p: 'mesh_gold' },
carp:              { m: 'carp_barbel', c: ['#291d0e', '#b45309', '#fde68a', '#b91c1c', '#78350f', '#f59e0b'], p: 'mesh_gold' },
buffalo:           { m: 'carp', c: ['#27272a', '#71717a', '#e4e4e7', '#52525b', '#3f3f46', '#fbbf24'], p: 'mesh_silver' },
black_carp:        { m: 'cyprinid_power', c: ['#090d16', '#334155', '#94a3b8', '#1e293b', '#0f172a', '#94a3b8'], p: 'mesh_silver' },
tench:             { m: 'tench', c: ['#14532d', '#4d7c0f', '#fde047', '#3f6212', '#1a2e05', '#dc2626'], p: 'fine_gold' },
tilapia:           { m: 'carp', c: ['#334155', '#94a3b8', '#fce7f3', '#be123c', '#475569', '#fbbf24'], p: 'bars_zander' },
roach:             { m: 'roach', c: ['#1e293b', '#94a3b8', '#ffffff', '#dc2626', '#475569', '#ef4444'], p: 'mesh_silver' },
vobla:             { m: 'roach', c: ['#1e3a5f', '#94a3b8', '#ffffff', '#b91c1c', '#334155', '#f97316'], p: 'mesh_silver' },
taran:             { m: 'roach', c: ['#0f172a', '#94a3b8', '#ffffff', '#dc2626', '#334155', '#ef4444'], p: 'mesh_silver' },
rudd:              { m: 'roach', c: ['#365314', '#eab308', '#fef9c3', '#dc2626', '#991b1b', '#f97316'], p: 'mesh_gold' },
dace:              { m: 'dace',  c: ['#1e3a5f', '#94a3b8', '#ffffff', '#eab308', '#475569', '#fde047'], p: 'mesh_silver' },
ide:               { m: 'cyprinid_power', c: ['#1e293b', '#ca8a04', '#fef9c3', '#dc2626', '#475569', '#fde047'], p: 'mesh_gold' },
chub:              { m: 'cyprinid_power', c: ['#14532d', '#94a3b8', '#f8fafc', '#dc2626', '#1e293b', '#fbbf24'], p: 'mesh_bold' },
asp:               { m: 'asp',   c: ['#1e293b', '#94a3b8', '#ffffff', '#64748b', '#334155', '#fde047'], p: 'mesh_silver' },
grass_carp:        { m: 'cyprinid_power', c: ['#365314', '#84cc16', '#fef9c3', '#65a30d', '#3f6212', '#fde047'], p: 'mesh_bold' },
silver_carp:       { m: 'silver_carp', c: ['#334155', '#cbd5e1', '#ffffff', '#64748b', '#475569', '#e2e8f0'], p: 'fine_silver' },
kutum:             { m: 'asp',   c: ['#1e3a5f', '#94a3b8', '#ffffff', '#64748b', '#334155', '#fde047'], p: 'mesh_silver' },
undermouth:        { m: 'barbel', c: ['#1e293b', '#94a3b8', '#ffffff', '#ea580c', '#475569', '#fde047'], p: 'mesh_silver' },
vimba:             { m: 'barbel', c: ['#1e3a8a', '#94a3b8', '#fed7aa', '#ea580c', '#334155', '#fde047'], p: 'mesh_silver' },
barbel:            { m: 'barbel_whiskers', c: ['#3f3f2c', '#a8a26e', '#fef3c7', '#c2410c', '#57534e', '#fbbf24'], p: 'spots_dark' },
gudgeon:           { m: 'barbel_whiskers', c: ['#334155', '#94a3b8', '#fef9c3', '#64748b', '#475569', '#fde047'], p: 'spots_lateral' },
tarpon_carp:       { m: 'barbel_whiskers', c: ['#334155', '#94a3b8', '#f8fafc', '#64748b', '#475569', '#fde047'], p: 'spots_lateral' },
sky_gazer:         { m: 'chekhon', c: ['#1e293b', '#cbd5e1', '#ffffff', '#dc2626', '#475569', '#f8fafc'], p: 'mesh_silver' },
yellowcheek:       { m: 'asp',   c: ['#1e3a5f', '#cbd5e1', '#ffffff', '#eab308', '#475569', '#facc15'], p: 'lateral_gold' },
chekhon:           { m: 'chekhon', c: ['#1e3a5f', '#cbd5e1', '#ffffff', '#94a3b8', '#475569', '#e2e8f0'], p: 'sabre_line' },
bleak:             { m: 'smelt', c: ['#1e3a8a', '#cbd5e1', '#ffffff', '#94a3b8', '#64748b', '#e2e8f0'], p: 'fine_silver' },
shemaya:           { m: 'smelt', c: ['#0f766e', '#94a3b8', '#ffffff', '#64748b', '#334155', '#fde047'], p: 'fine_silver' },
peled:             { m: 'whitefish_high', c: ['#1e3a5f', '#cbd5e1', '#ffffff', '#64748b', '#334155', '#e2e8f0'], p: 'spots_head' },
chir:              { m: 'whitefish_hump', c: ['#1e293b', '#94a3b8', '#fef9c3', '#475569', '#334155', '#fde047'], p: 'mesh_silver' },
pizhyan:           { m: 'whitefish_hump', c: ['#1e3a5f', '#cbd5e1', '#ffffff', '#64748b', '#334155', '#e2e8f0'], p: 'mesh_silver' },
muksun:            { m: 'whitefish_hump', c: ['#0f172a', '#cbd5e1', '#ffffff', '#475569', '#1e293b', '#e2e8f0'], p: 'mesh_silver' },
whitefish:         { m: 'whitefish', c: ['#1e3a5f', '#cbd5e1', '#ffffff', '#64748b', '#334155', '#e2e8f0'], p: 'mesh_silver' },
broad_whitefish:   { m: 'whitefish_hump', c: ['#1e293b', '#94a3b8', '#ffffff', '#475569', '#334155', '#e2e8f0'], p: 'mesh_silver' },
omul:              { m: 'whitefish', c: ['#0f766e', '#cbd5e1', '#ffffff', '#64748b', '#334155', '#e2e8f0'], p: 'fine_silver' },
omul_arctic:       { m: 'whitefish', c: ['#1e3a5f', '#cbd5e1', '#ffffff', '#64748b', '#334155', '#e2e8f0'], p: 'fine_silver' },
cisco:             { m: 'whitefish_slim', c: ['#1e3a8a', '#cbd5e1', '#ffffff', '#64748b', '#334155', '#e2e8f0'], p: 'fine_silver' },
vendace:           { m: 'whitefish_slim', c: ['#0f766e', '#cbd5e1', '#ffffff', '#64748b', '#334155', '#e2e8f0'], p: 'fine_silver' },
tugun:             { m: 'whitefish_slim', c: ['#334155', '#cbd5e1', '#ffffff', '#94a3b8', '#475569', '#fde047'], p: 'fine_silver' },
valek:             { m: 'whitefish_slim', c: ['#3f3f2c', '#94a3b8', '#f8fafc', '#ca8a04', '#475569', '#fbbf24'], p: 'spots_head' },
nelma:             { m: 'salmon_pred', c: ['#1e3a5f', '#e2e8f0', '#ffffff', '#64748b', '#334155', '#e2e8f0'], p: 'fine_silver' },
white_salmon:      { m: 'salmon_pred', c: ['#0f172a', '#e2e8f0', '#ffffff', '#64748b', '#334155', '#e2e8f0'], p: 'fine_silver' },
grayling:          { m: 'grayling', c: ['#312e81', '#94a3b8', '#f8fafc', '#7c3aed', '#be123c', '#fbbf24'], p: 'grayling_sail' },
baikal_grayling:   { m: 'grayling', c: ['#0f172a', '#64748b', '#e2e8f0', '#0284c7', '#dc2626', '#fbbf24'], p: 'grayling_sail' },
salmon:            { m: 'salmon_pred', c: ['#1e3a8a', '#94a3b8', '#ffffff', '#475569', '#334155', '#fde047'], p: 'spots_salmon' },
trout:             { m: 'salmon_pred', c: ['#3f2e18', '#b45309', '#fef08a', '#b91c1c', '#451a03', '#fbbf24'], p: 'spots_trout' },
brown_trout:       { m: 'salmon_pred', c: ['#451a03', '#ca8a04', '#fef9c3', '#dc2626', '#78350f', '#facc15'], p: 'spots_trout' },
rainbow_trout:     { m: 'salmon_pred', c: ['#065f46', '#94a3b8', '#ffffff', '#ec4899', '#334155', '#fde047'], p: 'lateral_pink' },
char:              { m: 'salmon_pred', c: ['#0f172a', '#334155', '#f97316', '#dc2626', '#1e293b', '#fbbf24'], p: 'spots_char' },
dolly_varden:      { m: 'salmon_pred', c: ['#115e59', '#475569', '#fb923c', '#ea580c', '#1e293b', '#fbbf24'], p: 'spots_char' },
lenok:             { m: 'salmon_pred', c: ['#422006', '#a16207', '#fef08a', '#b91c1c', '#451a03', '#f59e0b'], p: 'spots_trout' },
taimen:            { m: 'taimen', c: ['#292524', '#78716c', '#f5f5f4', '#dc2626', '#991b1b', '#f59e0b'], p: 'spots_salmon' },
pink_salmon:       { m: 'salmon_hump', c: ['#0f766e', '#94a3b8', '#ffffff', '#334155', '#1e293b', '#fde047'], p: 'spots_tail' },
chum_salmon:       { m: 'salmon_pred', c: ['#1e3a5f', '#94a3b8', '#f8fafc', '#be123c', '#334155', '#fde047'], p: 'bars_chum' },
coho_salmon:       { m: 'salmon_pred', c: ['#1e293b', '#b91c1c', '#f8fafc', '#991b1b', '#334155', '#fde047'], p: 'spots_salmon' },
sockeye_salmon:    { m: 'salmon_pred', c: ['#14532d', '#dc2626', '#fca5a5', '#15803d', '#991b1b', '#fde047'], p: 'fine_silver' },
chinook_salmon:    { m: 'taimen', c: ['#1e3a5f', '#64748b', '#f8fafc', '#334155', '#1e293b', '#fde047'], p: 'spots_salmon' },
cherry_salmon:     { m: 'salmon_pred', c: ['#1e293b', '#94a3b8', '#fecdd3', '#be123c', '#334155', '#fde047'], p: 'bars_chum' },
burbot:            { m: 'burbot', c: ['#291d0e', '#854d0e', '#fef08a', '#713f12', '#422006', '#facc15'], p: 'marbled' },
catfish:           { m: 'catfish', c: ['#1c1917', '#57534e', '#e7e5e4', '#44403c', '#292524', '#facc15'], p: 'marbled' },
amur_catfish:      { m: 'catfish', c: ['#14532d', '#4d7c0f', '#ecfccb', '#365314', '#1a2e05', '#facc15'], p: 'marbled' },
channel_catfish:   { m: 'channel_cat', c: ['#1e293b', '#64748b', '#f8fafc', '#475569', '#334155', '#fde047'], p: 'spots_salmon' },
snakehead:         { m: 'burbot', c: ['#1c1917', '#65a30d', '#fef9c3', '#3f6212', '#1a2e05', '#ef4444'], p: 'marbled_bold' },
loach:             { m: 'eel',    c: ['#451a03', '#ca8a04', '#fef08a', '#78350f', '#451a03', '#f59e0b'], p: 'spots_lateral' },
eel:               { m: 'eel',    c: ['#0f172a', '#3f6212', '#fef08a', '#1e293b', '#0f172a', '#fbbf24'], p: 'fine_silver' },
wolffish:          { m: 'burbot', c: ['#1e293b', '#475569', '#cbd5e1', '#334155', '#0f172a', '#facc15'], p: 'bars_zander_bold' },
cod:               { m: 'cod',    c: ['#3f2e18', '#854d0e', '#f8fafc', '#713f12', '#422006', '#fde047'], p: 'cod_line' },
haddock:           { m: 'cod',    c: ['#1e293b', '#94a3b8', '#ffffff', '#475569', '#334155', '#fde047'], p: 'spot_haddock' },
saithe:            { m: 'cod',    c: ['#0f172a', '#475569', '#f1f5f9', '#334155', '#1e293b', '#e2e8f0'], p: 'cod_line' },
navaga:            { m: 'cod',    c: ['#422006', '#a16207', '#fef9c3', '#713f12', '#451a03', '#fbbf24'], p: 'spots_dark' },
walleye_pollock:   { m: 'cod',    c: ['#1e3a5f', '#94a3b8', '#ffffff', '#475569', '#334155', '#fde047'], p: 'marbled' },
saffron_cod:       { m: 'cod',    c: ['#1e293b', '#64748b', '#f8fafc', '#475569', '#334155', '#e2e8f0'], p: 'spots_dark' },
sterlet:           { m: 'sturgeon', c: ['#292524', '#78716c', '#fef08a', '#57534e', '#44403c', '#facc15'], p: 'scutes' },
russian_sturgeon:  { m: 'sturgeon', c: ['#1e293b', '#64748b', '#fef9c3', '#475569', '#334155', '#facc15'], p: 'scutes' },
siberian_sturgeon: { m: 'sturgeon', c: ['#27272a', '#71717a', '#f4f4f5', '#52525b', '#3f3f46', '#fde047'], p: 'scutes' },
beluga:            { m: 'sturgeon_giant', c: ['#0f172a', '#64748b', '#ffffff', '#334155', '#1e293b', '#e2e8f0'], p: 'scutes' },
kaluga:            { m: 'sturgeon_giant', c: ['#14532d', '#64748b', '#fef9c3', '#3f6212', '#1e293b', '#fde047'], p: 'scutes' },
stellate_sturgeon: { m: 'sturgeon_long', c: ['#1e293b', '#475569', '#fef08a', '#334155', '#0f172a', '#fde047'], p: 'scutes_bright' },
paddlefish:        { m: 'paddlefish', c: ['#1e293b', '#64748b', '#f8fafc', '#334155', '#0f172a', '#e2e8f0'], p: 'fine_silver' },
flounder:          { m: 'flatfish', c: ['#422006', '#78350f', '#d6d3d1', '#92400e', '#451a03', '#facc15'], p: 'spots_plaice' },
plaice:            { m: 'flatfish', c: ['#451a03', '#78350f', '#e7e5e4', '#ea580c', '#451a03', '#facc15'], p: 'spots_plaice_bright' },
starry_flounder:   { m: 'flatfish', c: ['#292524', '#57534e', '#fef08a', '#facc15', '#090d16', '#facc15'], p: 'starry_fins' },
turbot:            { m: 'turbot',   c: ['#334155', '#64748b', '#e2e8f0', '#475569', '#1e293b', '#fde047'], p: 'spots_turbot' },
halibut:           { m: 'halibut',  c: ['#0f172a', '#334155', '#cbd5e1', '#1e293b', '#090d16', '#fde047'], p: 'marbled' },
smelt:             { m: 'smelt_adipose', c: ['#065f46', '#cbd5e1', '#ffffff', '#94a3b8', '#475569', '#fde047'], p: 'fine_silver' },
capelin:           { m: 'smelt_adipose', c: ['#0f766e', '#cbd5e1', '#ffffff', '#94a3b8', '#475569', '#fde047'], p: 'fine_silver' },
herring:           { m: 'herring', c: ['#1e3a8a', '#cbd5e1', '#ffffff', '#64748b', '#334155', '#e2e8f0'], p: 'fine_silver' },
sand_eel:          { m: 'sand_eel', c: ['#0f766e', '#94a3b8', '#ffffff', '#64748b', '#334155', '#fde047'], p: 'fine_silver' },
garfish:           { m: 'garfish', c: ['#047857', '#6ee7b7', '#ffffff', '#10b981', '#065f46', '#fde047'], p: 'fine_silver' },
mackerel:          { m: 'mackerel', c: ['#0284c7', '#38bdf8', '#ffffff', '#0369a1', '#0f172a', '#e2e8f0'], p: 'stripes_mackerel' },
horse_mackerel:    { m: 'mackerel', c: ['#1e3a8a', '#94a3b8', '#ffffff', '#eab308', '#334155', '#fde047'], p: 'scutes_lateral' },
mullet:            { m: 'mullet',  c: ['#1e293b', '#94a3b8', '#ffffff', '#64748b', '#334155', '#f97316'], p: 'stripes_horizontal' },
bluefish:          { m: 'zander',  c: ['#0f766e', '#94a3b8', '#ffffff', '#475569', '#1e293b', '#facc15'], p: 'fine_silver' },
sea_bass:          { m: 'perch',   c: ['#334155', '#94a3b8', '#f8fafc', '#0284c7', '#475569', '#f59e0b'], p: 'spot_flank' },
red_mullet:        { m: 'red_mullet', c: ['#be123c', '#fb7185', '#fef08a', '#eab308', '#9f1239', '#facc15'], p: 'lateral_gold' },
sea_bream:         { m: 'sea_bream', c: ['#334155', '#cbd5e1', '#ffffff', '#eab308', '#0f172a', '#fde047'], p: 'spot_tail_ring' },
wrasse:            { m: 'wrasse',  c: ['#15803d', '#84cc16', '#fef08a', '#0284c7', '#dc2626', '#f97316'], p: 'lateral_red_blue' },
scorpionfish:      { m: 'scorpion', c: ['#7f1d1d', '#b91c1c', '#fca5a5', '#ea580c', '#450a0a', '#facc15'], p: 'marbled_bold' },
greenling:         { m: 'perch',   c: ['#451a03', '#ca8a04', '#fef08a', '#b45309', '#78350f', '#f97316'], p: 'bars_perch' },
anglerfish:        { m: 'angler',  c: ['#291d0e', '#57534e', '#a8a29e', '#44403c', '#1c1917', '#38bdf8'], p: 'marbled' },
crayfish:          { m: 'crayfish', c: ['#1e3a1e', '#4d7c2b', '#a3b18a', '#b45309', '#14532d', '#0f172a'], p: 'none' },
crab:              { m: 'crab',     c: ['#7c2d12', '#c2410c', '#fdba74', '#9a3412', '#431407', '#0f172a'], p: 'none' },
king_crab:         { m: 'king_crab', c: ['#991b1b', '#dc2626', '#fca5a5', '#b91c1c', '#7f1d1d', '#0f172a'], p: 'none' }
};
function renderPatternOverlay(p, c, uid) {
switch (p) {
case 'spots_gold':
return `<g fill="#fef08a" opacity="0.82">
<circle cx="30" cy="21" r="1.3"/><circle cx="36" cy="19" r="1.5"/><circle cx="42" cy="22" r="1.4"/><circle cx="48" cy="19.5" r="1.6"/>
<circle cx="54" cy="22" r="1.3"/><circle cx="60" cy="19" r="1.5"/><circle cx="66" cy="21.5" r="1.4"/><circle cx="72" cy="20" r="1.2"/>
<circle cx="34" cy="24" r="1.2"/><circle cx="45" cy="24.5" r="1.4"/><circle cx="57" cy="24" r="1.3"/><circle cx="68" cy="23.5" r="1.2"/>
</g>`;
case 'spots_pike_black':
return `<g fill="#1e293b" opacity="0.82">
<circle cx="29" cy="20" r="1.4"/><circle cx="35" cy="22" r="1.6"/><circle cx="41" cy="19" r="1.5"/><circle cx="47" cy="22" r="1.5"/>
<circle cx="53" cy="19.5" r="1.4"/><circle cx="59" cy="22" r="1.6"/><circle cx="65" cy="20" r="1.4"/><circle cx="71" cy="21.5" r="1.3"/>
</g>`;
case 'bars_perch':
return `<g fill="#0f172a" opacity="0.58">
<path d="M27,11 L30,11 L29,25 L27,23 Z"/>
<path d="M35,10 L38.5,10 L37,27 L34.5,25 Z"/>
<path d="M44,11 L47.5,11 L46,27 L43.5,25 Z"/>
<path d="M53,12 L56,12 L55,26 L52.5,25 Z"/>
<path d="M62,14 L64.5,14 L64,25 L61.5,24 Z"/>
<path d="M70,16 L72,16 L71.5,24 L69.5,23 Z"/>
</g>`;
case 'bars_zander':
case 'bars_zander_bold': {
const op = p === 'bars_zander_bold' ? '0.62' : '0.42';
return `<g fill="#0f172a" opacity="${op}">
<path d="M26,14 L28.5,14 L28,23 L25.5,22 Z"/>
<path d="M33,13 L36,13 L35,24 L32.5,23 Z"/>
<path d="M40,13 L43,13 L42,24 L39.5,23 Z"/>
<path d="M48,14 L51,14 L50,24 L47.5,23 Z"/>
<path d="M56,14.5 L59,14.5 L58,24 L55.5,23 Z"/>
<path d="M64,15.5 L66.5,15.5 L66,23.5 L63.5,23 Z"/>
<path d="M71,16.5 L73.5,16.5 L73,23 L70.5,22.5 Z"/>
</g>`;
}
case 'mesh_gold':
case 'mesh_silver':
case 'mesh_bold': {
const st = p === 'mesh_bold' ? '#0f172a' : (p === 'mesh_gold' ? '#78350f' : '#475569');
const op = p === 'mesh_bold' ? '0.48' : '0.32';
return `<g stroke="${st}" stroke-width="0.7" fill="none" opacity="${op}">
<path d="M28,16 Q31,19 28,22 M34,14 Q37,18 34,22 M40,13 Q43,17 40,21 M46,13 Q49,17 46,21 M52,14 Q55,18 52,22 M58,15 Q61,19 58,23 M64,16 Q67,19 64,22"/>
<path d="M31,20 Q34,24 31,28 M37,19 Q40,23 37,27 M43,19 Q46,23 43,27 M49,19 Q52,23 49,27 M55,20 Q58,24 55,27 M61,20 Q64,23 61,26"/>
</g>`;
}
case 'spots_trout':
return `<g>
<circle cx="31" cy="18" r="1.4" fill="#0f172a"/><circle cx="38" cy="16.5" r="1.3" fill="#0f172a"/><circle cx="46" cy="17.5" r="1.4" fill="#0f172a"/><circle cx="55" cy="17" r="1.3" fill="#0f172a"/><circle cx="64" cy="18.5" r="1.2" fill="#0f172a"/>
<circle cx="34" cy="21.5" r="1.5" fill="#dc2626" stroke="#fef08a" stroke-width="0.5"/>
<circle cx="43" cy="21" r="1.6" fill="#dc2626" stroke="#fef08a" stroke-width="0.5"/>
<circle cx="52" cy="21.5" r="1.5" fill="#dc2626" stroke="#fef08a" stroke-width="0.5"/>
<circle cx="61" cy="21" r="1.4" fill="#dc2626" stroke="#fef08a" stroke-width="0.5"/>
<circle cx="69" cy="21" r="1.2" fill="#0f172a"/>
</g>`;
case 'spots_char':
return `<g fill="#fb923c" opacity="0.9">
<circle cx="31" cy="19" r="1.3"/><circle cx="38" cy="17.5" r="1.2"/><circle cx="45" cy="20" r="1.4"/><circle cx="52" cy="18" r="1.3"/><circle cx="59" cy="20.5" r="1.3"/><circle cx="66" cy="19" r="1.2"/>
<circle cx="35" cy="23" r="1.2" fill="#fef08a"/><circle cx="48" cy="23" r="1.3" fill="#fef08a"/><circle cx="62" cy="23" r="1.1" fill="#fef08a"/>
</g>`;
case 'lateral_pink':
return `<g>
<path d="M22,20.5 Q48,19 76,20.5" stroke="#ec4899" stroke-width="3.2" stroke-linecap="round" opacity="0.72"/>
<g fill="#0f172a" opacity="0.75">
<circle cx="29" cy="17" r="1"/><circle cx="35" cy="16" r="1.1"/><circle cx="42" cy="17" r="1"/><circle cx="49" cy="16" r="1.1"/><circle cx="56" cy="17" r="1"/><circle cx="63" cy="17.5" r="1"/><circle cx="70" cy="18" r="1"/>
<circle cx="33" cy="20" r="0.9"/><circle cx="45" cy="20.5" r="1"/><circle cx="58" cy="20" r="0.9"/>
</g>
</g>`;
case 'spots_salmon':
case 'spots_tail':
return `<g fill="#0f172a" opacity="0.72">
<circle cx="29" cy="17.5" r="1.1"/><circle cx="36" cy="16.5" r="1.2"/><circle cx="44" cy="17" r="1.1"/><circle cx="52" cy="16.5" r="1.2"/><circle cx="60" cy="17.5" r="1.1"/><circle cx="68" cy="18.5" r="1.1"/>
<circle cx="39" cy="20" r="1"/><circle cx="55" cy="20" r="1"/><circle cx="72" cy="20.5" r="1.1"/>
</g>`;
case 'bars_chum':
return `<g fill="#be123c" opacity="0.52">
<path d="M32,15 L35,15 L34,25 L31,24 Z"/><path d="M41,14 L44,14 L43,26 L40,25 Z"/><path d="M50,15 L53,15 L52,26 L49,25 Z"/><path d="M59,16 L62,16 L61,25 L58,24 Z"/><path d="M67,17 L70,17 L69,24 L66,23 Z"/>
</g>`;
case 'marbled':
case 'marbled_bold':
return `<g fill="#1c1917" opacity="${p === 'marbled_bold' ? '0.62' : '0.45'}">
<ellipse cx="30" cy="19" rx="3.2" ry="1.8"/><ellipse cx="39" cy="21" rx="3.8" ry="2"/><ellipse cx="49" cy="18.5" rx="3.5" ry="1.8"/>
<ellipse cx="58" cy="21.5" rx="3.6" ry="1.9"/><ellipse cx="67" cy="19.5" rx="3.2" ry="1.7"/><ellipse cx="74" cy="21" rx="2.5" ry="1.4"/>
</g>`;
case 'scutes':
case 'scutes_bright': {
const scCol = p === 'scutes_bright' ? '#fef08a' : '#fde047';
return `<g fill="${scCol}" stroke="#0f172a" stroke-width="0.4">
<polygon points="27,16 30,13 33,16"/><polygon points="36,15.5 39,12.5 42,15.5"/><polygon points="45,16 48,13 51,16"/><polygon points="54,16.5 57,13.5 60,16.5"/><polygon points="63,17 66,14.5 69,17"/><polygon points="71,18 73.5,15.5 76,18"/>
<circle cx="29" cy="21" r="1"/><circle cx="35" cy="21" r="1"/><circle cx="41" cy="21" r="1"/><circle cx="47" cy="21" r="1"/><circle cx="53" cy="21" r="1"/><circle cx="59" cy="21" r="1"/><circle cx="65" cy="21" r="1"/><circle cx="71" cy="21" r="0.9"/>
</g>`;
}
case 'spots_plaice':
case 'spots_plaice_bright': {
const spC = p === 'spots_plaice_bright' ? '#f97316' : '#d97706';
return `<g fill="${spC}" stroke="#0f172a" stroke-width="0.45" opacity="0.9">
<circle cx="36" cy="15" r="2"/><circle cx="46" cy="13" r="2.2"/><circle cx="57" cy="15" r="2"/><circle cx="66" cy="17" r="1.8"/>
<circle cx="38" cy="27" r="2"/><circle cx="49" cy="29" r="2.2"/><circle cx="60" cy="27" r="1.9"/><circle cx="51" cy="21" r="1.8"/>
</g>`;
}
case 'spots_turbot':
return `<g fill="#e2e8f0" stroke="#1e293b" stroke-width="0.5" opacity="0.85">
<circle cx="37" cy="16" r="1.6"/><circle cx="47" cy="14" r="1.8"/><circle cx="56" cy="17" r="1.5"/><circle cx="43" cy="22" r="1.7"/><circle cx="53" cy="25" r="1.6"/><circle cx="38" cy="27" r="1.5"/>
</g>`;
case 'stripes_mackerel':
return `<g stroke="#0f172a" stroke-width="1.3" stroke-linecap="round" opacity="0.68">
<path d="M27,13 Q29,17 27,20"/><path d="M32,12.5 Q34,17 32,20"/><path d="M37,12 Q39,17 37,20"/><path d="M42,12 Q44,17 42,20"/>
<path d="M47,12.5 Q49,17 47,20"/><path d="M52,13 Q54,17 52,20"/><path d="M57,13.5 Q59,17 57,20"/><path d="M62,14 Q64,17.5 62,20"/>
<path d="M67,15 Q68.5,18 67,20"/>
</g>`;
case 'spot_haddock':
return `<g>
<path d="M23,18 Q48,15.5 78,20" stroke="#0f172a" stroke-width="1.1" fill="none" opacity="0.75"/>
<ellipse cx="32" cy="18.5" rx="3.2" ry="2.4" fill="#0f172a"/>
</g>`;
case 'cod_line':
return `<path d="M23,18.5 Q48,16 78,20.5" stroke="#fef9c3" stroke-width="1.2" fill="none" opacity="0.85"/>`;
case 'spot_tail_ring':
return `<g>
<ellipse cx="73" cy="21" rx="2.8" ry="3.6" fill="#0f172a" stroke="#fef08a" stroke-width="0.7"/>
<path d="M30,13 L29,29 M38,12 L37,30 M46,12 L45,30 M54,13 L53,29 M62,14 L61,28" stroke="#475569" stroke-width="0.7" opacity="0.4"/>
</g>`;
case 'spot_flank':
return `<rect x="44" y="18.5" width="5" height="4" rx="1" fill="#0f172a" opacity="0.85"/>`;
case 'lateral_gold':
return `<path d="M22,21 L76,21" stroke="#facc15" stroke-width="2.2" stroke-linecap="round" opacity="0.82"/>`;
case 'lateral_red_blue':
return `<g>
<path d="M22,19.5 L75,19.5" stroke="#0284c7" stroke-width="2" stroke-linecap="round" opacity="0.8"/>
<path d="M22,22 L75,22" stroke="#dc2626" stroke-width="1.8" stroke-linecap="round" opacity="0.75"/>
</g>`;
case 'sabre_line':
return `<path d="M22,21 Q32,26 52,25.5 Q66,24.5 77,21" stroke="#475569" stroke-width="0.9" stroke-dasharray="2,1.5" fill="none" opacity="0.75"/>`;
case 'spots_lateral':
return `<g fill="#0f172a" opacity="0.68">
<circle cx="28" cy="21" r="1.4"/><circle cx="35" cy="21" r="1.5"/><circle cx="42" cy="21" r="1.5"/><circle cx="49" cy="21" r="1.5"/><circle cx="56" cy="21" r="1.4"/><circle cx="63" cy="21" r="1.4"/><circle cx="70" cy="21" r="1.3"/>
</g>`;
case 'spots_dark':
return `<g fill="#0f172a" opacity="0.55">
<circle cx="29" cy="18" r="1.2"/><circle cx="36" cy="16.5" r="1.3"/><circle cx="43" cy="18.5" r="1.2"/><circle cx="50" cy="17" r="1.3"/><circle cx="57" cy="19" r="1.2"/><circle cx="64" cy="18" r="1.1"/><circle cx="71" cy="19.5" r="1.1"/>
<circle cx="33" cy="21.5" r="1.1"/><circle cx="46" cy="22" r="1.2"/><circle cx="59" cy="22" r="1.1"/>
</g>`;
default:
return `<path d="M23,20.5 Q50,21.5 76,20.5" stroke="${c[0]}" stroke-width="0.65" fill="none" opacity="0.38"/>`;
}
}
export function getFishCustomSVG(f) {
const fish = f || { id: 'pike', name: 'Рыба' };
const fid = fish.id || 'pike';
const uid = `f_${fid}_${++clipSeq}`;
const prof = SPECIES_VISUAL_PROFILES[fid] || {
m: fish.group === 'whitefish' ? 'whitefish' : (fish.group === 'sturgeon' ? 'sturgeon' : (fish.type === 'predator' ? 'zander' : 'roach')),
c: ['#1e293b', '#94a3b8', '#ffffff', '#dc2626', '#475569', '#fde047'],
p: 'mesh_silver'
};
const [topC, midC, botC, finC, tailC, eyeC] = prof.c;
const m = prof.m;
const svgAttrs = `class="fish-visual-svg" viewBox="0 0 100 44" role="img" aria-label="${fish.name || fid}" style="width:100%;height:100%;max-width:100%;max-height:100%;display:block;margin:0 auto;"`;
const defs = `<defs>
<linearGradient id="${uid}_b" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="${topC}"/>
<stop offset="54%" stop-color="${midC}"/>
<stop offset="100%" stop-color="${botC}"/>
</linearGradient>
<linearGradient id="${uid}_f" x1="0" y1="0" x2="1" y2="1">
<stop offset="0%" stop-color="${finC}"/>
<stop offset="100%" stop-color="${tailC}"/>
</linearGradient>
</defs>`;
if (m === 'crayfish') {
return `<svg ${svgAttrs}>${defs}
<g stroke="#0f172a" stroke-width="0.9" stroke-linejoin="round">
<path d="M24,18 Q10,10 3,6 M24,24 Q10,32 3,36" stroke="${finC}" stroke-width="1.1" fill="none"/>
<path d="M27,15 L14,8 L7,11 L13,14 L8,16 L16,17 Z" fill="url(#${uid}_f)"/>
<path d="M27,29 L14,36 L7,33 L13,30 L8,28 L16,27 Z" fill="url(#${uid}_f)"/>
<path d="M38,16 L32,7 M43,16 L40,6 M48,16 L47,7 M53,17 L54,8" stroke="${topC}" stroke-width="1.4" stroke-linecap="round"/>
<path d="M38,28 L32,37 M43,28 L40,38 M48,28 L47,37 M53,27 L54,36" stroke="${topC}" stroke-width="1.4" stroke-linecap="round"/>
<path d="M22,22 L30,15 L56,15 L56,29 L30,29 Z" fill="url(#${uid}_b)"/>
<path d="M56,16 L64,17 L64,27 L56,28 Z M64,17 L71,18 L71,26 L64,27 Z M71,18 L78,19 L78,25 L71,26 Z" fill="${midC}"/>
<path d="M78,19 L89,13 L87,22 L89,31 L78,25 Z" fill="url(#${uid}_f)"/>
<circle cx="24" cy="19" r="1.5" fill="#000"/><circle cx="24" cy="25" r="1.5" fill="#000"/>
</g>
</svg>`;
}
if (m === 'crab' || m === 'king_crab') {
const legLen = m === 'king_crab' ? 18 : 11;
return `<svg ${svgAttrs}>${defs}
<g stroke="#0f172a" stroke-width="1" stroke-linejoin="round">
<path d="M34,18 L${24 - legLen},9 M33,22 L${20 - legLen},20 M34,26 L${22 - legLen},31 M38,29 L${28 - legLen},38" stroke="${finC}" stroke-width="2" stroke-linecap="round"/>
<path d="M66,18 L${76 + legLen},9 M67,22 L${80 + legLen},20 M66,26 L${78 + legLen},31 M62,29 L${72 + legLen},38" stroke="${finC}" stroke-width="2" stroke-linecap="round"/>
<path d="M40,14 L31,5 L25,9 L31,12 L27,14 L35,16 Z" fill="url(#${uid}_f)"/>
<path d="M60,14 L69,5 L75,9 L69,12 L73,14 L65,16 Z" fill="url(#${uid}_f)"/>
<ellipse cx="50" cy="23" rx="${m === 'king_crab' ? 15 : 19}" ry="12" fill="url(#${uid}_b)"/>
<circle cx="45" cy="13" r="1.6" fill="#000"/><circle cx="55" cy="13" r="1.6" fill="#000"/>
</g>
</svg>`;
}
if (m === 'flatfish' || m === 'turbot' || m === 'halibut') {
const ry = m === 'turbot' ? 16.5 : (m === 'halibut' ? 12.5 : 14.5);
const finFringe = prof.p === 'starry_fins'
? `fill="#facc15" stroke="#090d16" stroke-width="1.4" stroke-dasharray="3,2"`
: `fill="url(#${uid}_f)" stroke="#0f172a" stroke-width="0.8"`;
return `<svg ${svgAttrs}>${defs}
<path d="M20,14 Q48,${19 - ry - 5} 77,17 L77,27 Q48,${25 + ry + 5} 20,30 Z" ${finFringe}/>
<path d="M77,18 L93,12 L90,22 L93,32 L77,26 Z" ${finFringe}/>
<ellipse cx="47" cy="22" rx="32" ry="${ry}" fill="url(#${uid}_b)" stroke="#0f172a" stroke-width="1.1"/>
<path d="M18,22 Q34,15 48,21 T77,22" stroke="#0f172a" stroke-width="0.9" fill="none" opacity="0.6"/>
${renderPatternOverlay(prof.p, prof.c, uid)}
<path d="M28,19 Q34,17 37,22 Q32,24 28,19 Z" fill="${finC}" opacity="0.85"/>
<circle cx="24" cy="17.5" r="2.2" fill="${eyeC}" stroke="#0f172a" stroke-width="0.6"/><circle cx="24" cy="17.5" r="1.1" fill="#000"/>
<circle cx="29" cy="14.5" r="2.2" fill="${eyeC}" stroke="#0f172a" stroke-width="0.6"/><circle cx="29" cy="14.5" r="1.1" fill="#000"/>
</svg>`;
}
if (m === 'sturgeon' || m === 'sturgeon_giant' || m === 'sturgeon_long' || m === 'paddlefish') {
const snoutX = m === 'paddlefish' ? 1 : (m === 'sturgeon_long' ? 2 : 6);
const bodyTop = m === 'sturgeon_giant' ? 12 : 14.5;
return `<svg ${svgAttrs}>${defs}
<path d="M62,16 L67,9 L73,17 Z" fill="${tailC}"/>
<path d="M58,25 L63,32 L69,24 Z" fill="${finC}"/>
<path d="M40,26 L44,32 L50,26 Z" fill="${finC}"/>
<path d="M77,18 L96,5 L89,20 L93,31 L77,23 Z" fill="url(#${uid}_f)" stroke="#0f172a" stroke-width="0.9"/>
<path d="M${snoutX},22 L21,${bodyTop} Q46,${bodyTop - 1.5} 78,18 L78,23.5 L22,26.5 Q12,26.5 ${snoutX},22 Z" fill="url(#${uid}_b)" stroke="#0f172a" stroke-width="1.1"/>
<path d="M23,25 L18,33 L29,26 Z" fill="${finC}"/>
<path d="M13,24 L12,28 M15,24.5 L14.5,29" stroke="${botC}" stroke-width="1" stroke-linecap="round"/>
${renderPatternOverlay(prof.p, prof.c, uid)}
<circle cx="20" cy="19.5" r="1.8" fill="${eyeC}"/><circle cx="20" cy="19.5" r="0.9" fill="#000"/>
</svg>`;
}
if (m === 'pike') {
return `<svg ${svgAttrs}>${defs}
<path d="M62,15 L70,7 L76,16 Z" fill="url(#${uid}_f)" stroke="#0f172a" stroke-width="0.7"/>
<path d="M62,26 L69,34 L75,25 Z" fill="url(#${uid}_f)" stroke="#0f172a" stroke-width="0.7"/>
<path d="M42,26.5 L46,33 L52,26.5 Z" fill="${finC}"/>
<path d="M77,16.5 L94,8 L88,21 L94,34 L77,25 Z" fill="url(#${uid}_f)" stroke="#0f172a" stroke-width="0.9"/>
<path d="M4,21.5 L17,16.5 Q42,13 65,15 L78,17 L78,24.5 L64,26.5 Q38,28 16,25 L4,21.5 Z" fill="url(#${uid}_b)" stroke="#0f172a" stroke-width="1.1"/>
<path d="M21,24.5 L26,32 L31,25.5 Z" fill="${finC}"/>
<path d="M5,21.8 L16,22.5" stroke="#0f172a" stroke-width="0.9"/>
<path d="M22,17.5 Q25,21 21,24.5" stroke="#0f172a" stroke-width="0.9" fill="none" opacity="0.65"/>
${renderPatternOverlay(prof.p, prof.c, uid)}
<circle cx="15.5" cy="19" r="2.2" fill="${eyeC}" stroke="#0f172a" stroke-width="0.5"/><circle cx="15.5" cy="19" r="1.1" fill="#000"/>
</svg>`;
}
if (m === 'perch' || m === 'ruffe') {
return `<svg ${svgAttrs}>${defs}
<path d="M28,13 L33,4 L41,5 L48,12 Z" fill="${tailC}" stroke="#0f172a" stroke-width="0.8"/>
<circle cx="45.5" cy="9.5" r="2" fill="#090d16"/>
<path d="M50,12.5 L57,6.5 L65,14.5 Z" fill="${tailC}" stroke="#0f172a" stroke-width="0.7"/>
<path d="M55,27 L61,35 L68,25.5 Z" fill="${finC}"/>
<path d="M33,27.5 L38,36 L45,28 Z" fill="${finC}"/>
<path d="M76,16.5 L92,9 L87,21 L92,33 L76,25 Z" fill="url(#${uid}_f)" stroke="#0f172a" stroke-width="0.9"/>
<path d="M8,21.5 Q20,14 33,11 Q50,10 67,15.5 L77,17 L77,24.5 L65,26.5 Q44,30.5 22,27 Q13,25 8,21.5 Z" fill="url(#${uid}_b)" stroke="#0f172a" stroke-width="1.1"/>
<path d="M24,23.5 L31,30 L33,24.5 Z" fill="${finC}" opacity="0.92"/>
<path d="M22,15.5 Q25,21 21,26" stroke="#0f172a" stroke-width="0.9" fill="none" opacity="0.65"/>
${renderPatternOverlay(prof.p, prof.c, uid)}
<circle cx="16.5" cy="19.5" r="2.4" fill="${eyeC}" stroke="#0f172a" stroke-width="0.6"/><circle cx="16.5" cy="19.5" r="1.1" fill="#000"/>
</svg>`;
}
if (m === 'zander') {
return `<svg ${svgAttrs}>${defs}
<path d="M29,14 L34,6 L44,7.5 L49,13.5 Z" fill="${tailC}" stroke="#0f172a" stroke-width="0.75"/>
<path d="M52,13.5 L59,7.5 L68,15.5 Z" fill="${tailC}" stroke="#0f172a" stroke-width="0.75"/>
<path d="M56,26 L62,33.5 L69,24.5 Z" fill="${finC}"/>
<path d="M31,26 L36,33 L43,26.5 Z" fill="${finC}"/>
<path d="M77,17 L93,9 L87,21 L93,33 L77,24.5 Z" fill="url(#${uid}_f)" stroke="#0f172a" stroke-width="0.9"/>
<path d="M6,21 Q22,12.5 44,13 Q62,13.5 78,17.5 L78,24 L62,26 Q38,28 19,25.5 Q11,24 6,21 Z" fill="url(#${uid}_b)" stroke="#0f172a" stroke-width="1.1"/>
<path d="M23,23.5 L30,29 L31,24 Z" fill="${finC}"/>
<path d="M21,16 Q24,20.5 20,25" stroke="#0f172a" stroke-width="0.9" fill="none" opacity="0.65"/>
${renderPatternOverlay(prof.p, prof.c, uid)}
<circle cx="15" cy="19" r="2.2" fill="${eyeC}" stroke="#0f172a" stroke-width="0.6"/><circle cx="15" cy="19" r="1" fill="#000"/>
</svg>`;
}
if (m === 'bream') {
return `<svg ${svgAttrs}>${defs}
<path d="M40,9 L47,1.5 L54,11 Z" fill="${tailC}" stroke="#0f172a" stroke-width="0.8"/>
<path d="M49,32 L57,39 L73,25.5 L66,25 Z" fill="${finC}" stroke="#0f172a" stroke-width="0.7"/>
<path d="M34,31 L39,38 L45,32 Z" fill="${finC}"/>
<path d="M75,17.5 L93,7 L85,21.5 L94,36 L75,25 Z" fill="url(#${uid}_f)" stroke="#0f172a" stroke-width="0.9"/>
<path d="M9,22 Q20,16 32,10 Q43,6 54,11 Q66,15 76,18 L76,24.5 Q64,29 48,33 Q32,34 19,27.5 Q12,25 9,22 Z" fill="url(#${uid}_b)" stroke="#0f172a" stroke-width="1.1"/>
<path d="M23,25 L30,31.5 L31,26 Z" fill="${finC}"/>
<path d="M21,16.5 Q24,22 20,27" stroke="#0f172a" stroke-width="0.9" fill="none" opacity="0.65"/>
${renderPatternOverlay(prof.p, prof.c, uid)}
<circle cx="16.5" cy="20.5" r="2.2" fill="${eyeC}" stroke="#0f172a" stroke-width="0.6"/><circle cx="16.5" cy="20.5" r="1.1" fill="#000"/>
</svg>`;
}
if (m === 'carp' || m === 'carp_barbel' || m === 'tench') {
const tailShape = m === 'tench'
? `M75,16.5 L91,10 Q93,21.5 91,33 L75,26 Z`
: `M75,17 L92,8 L86,21.5 L92,35 L75,25.5 Z`;
const barbels = (m === 'carp_barbel' || m === 'tench')
? `<path d="M10,23 L7,27.5 M12,23.5 L10,28" stroke="${finC}" stroke-width="1.2" stroke-linecap="round"/>`
: '';
return `<svg ${svgAttrs}>${defs}
<path d="M32,11 L37,4 Q51,5 65,14.5 L63,16 Z" fill="url(#${uid}_f)" stroke="#0f172a" stroke-width="0.8"/>
<path d="M55,29 L61,36 L68,26.5 Z" fill="${finC}"/>
<path d="M35,30 L41,37 L47,30.5 Z" fill="${finC}"/>
<path d="${tailShape}" fill="url(#${uid}_f)" stroke="#0f172a" stroke-width="0.9"/>
<path d="M9,21.5 Q20,10 42,10 Q61,11 76,17.5 L76,25 Q61,31 41,31.5 Q21,31 9,21.5 Z" fill="url(#${uid}_b)" stroke="#0f172a" stroke-width="1.1"/>
${barbels}
<path d="M23,25 L30,31.5 L32,26 Z" fill="${finC}"/>
<path d="M22,15 Q25,21.5 21,27.5" stroke="#0f172a" stroke-width="0.9" fill="none" opacity="0.65"/>
${renderPatternOverlay(prof.p, prof.c, uid)}
<circle cx="16.5" cy="19.5" r="2.2" fill="${eyeC}" stroke="#0f172a" stroke-width="0.6"/><circle cx="16.5" cy="19.5" r="1.1" fill="#000"/>
</svg>`;
}
if (m === 'grayling') {
return `<svg ${svgAttrs}>${defs}
<!-- Знаменитый парус хариуса -->
<path d="M29,14 L33,2 Q46,1 57,5 L59,15 Z" fill="url(#${uid}_f)" stroke="#0f172a" stroke-width="0.85"/>
<g fill="#38bdf8" opacity="0.9">
<circle cx="36" cy="6" r="1.2"/><circle cx="42" cy="5.5" r="1.3"/><circle cx="48" cy="6" r="1.3"/><circle cx="53" cy="7.5" r="1.2"/>
<circle cx="38" cy="10" r="1.2" fill="#f43f5e"/><circle cx="45" cy="9.5" r="1.3" fill="#f43f5e"/><circle cx="51" cy="10.5" r="1.2" fill="#f43f5e"/>
</g>
<!-- Жировой плавник -->
<path d="M67,15.5 Q70,12 72,16.5 Z" fill="${tailC}"/>
<path d="M56,26 L62,33 L68,25 Z" fill="${finC}"/>
<path d="M36,26.5 L42,34.5 L49,27 Z" fill="url(#${uid}_f)"/>
<path d="M77,17 L93,8.5 L86,21 L93,33.5 L77,24.5 Z" fill="url(#${uid}_f)" stroke="#0f172a" stroke-width="0.9"/>
<path d="M8,21 Q24,12 46,13 Q64,14 78,17.5 L78,24 Q62,27 42,27.5 Q22,27.5 8,21 Z" fill="url(#${uid}_b)" stroke="#0f172a" stroke-width="1.1"/>
<g fill="#0f172a" opacity="0.78">
<circle cx="27" cy="18" r="1.1"/><circle cx="32" cy="19.5" r="1.2"/><circle cx="36" cy="17.5" r="1.1"/><circle cx="41" cy="19" r="1.1"/><circle cx="30" cy="22" r="1"/>
</g>
<path d="M22,23.5 L28,29.5 L30,24.5 Z" fill="${finC}"/>
<path d="M20,15.5 Q23,20.5 19.5,25" stroke="#0f172a" stroke-width="0.9" fill="none" opacity="0.65"/>
<circle cx="15.5" cy="19" r="2.2" fill="${eyeC}" stroke="#0f172a" stroke-width="0.6"/><circle cx="15.5" cy="19" r="1.1" fill="#000"/>
</svg>`;
}
if (m.startsWith('whitefish') || m === 'smelt_adipose') {
const isHump = m === 'whitefish_hump';
const isHigh = m === 'whitefish_high';
const isSlim = m === 'whitefish_slim' || m === 'smelt_adipose';
const topY = isHump ? 10 : (isHigh ? 10.5 : (isSlim ? 15 : 12.5));
const botY = isHigh ? 29.5 : (isSlim ? 25.5 : 27.5);
const bodyPath = isHump
? `M8,21.5 Q15,17 24,${topY} Q44,${topY - 1} 66,15.5 L78,17.5 L78,24 Q62,${botY} 40,${botY} Q20,${botY} 8,21.5 Z`
: `M7,21 Q25,${topY} 47,${topY + 0.5} Q65,14.5 78,17.5 L78,24 Q62,${botY} 42,${botY} Q22,${botY} 7,21 Z`;
return `<svg ${svgAttrs}>${defs}
<path d="M36,${topY + 2} L43,${topY - 6.5} L52,${topY + 2.5} Z" fill="${tailC}" stroke="#0f172a" stroke-width="0.75"/>
<!-- Характерный жировой плавник сиговых и корюшковых -->
<path d="M67,15.8 Q70,12.2 72.5,16.8 Z" fill="${midC}" stroke="#0f172a" stroke-width="0.55"/>
<path d="M57,${botY - 2} L63,${botY + 5.5} L70,${botY - 3} Z" fill="${finC}"/>
<path d="M38,${botY - 1.5} L43,${botY + 6} L49,${botY - 1.5} Z" fill="${finC}"/>
<path d="M77,17 L93,8 L85,21 L93,34 L77,24.5 Z" fill="url(#${uid}_f)" stroke="#0f172a" stroke-width="0.9"/>
<path d="${bodyPath}" fill="url(#${uid}_b)" stroke="#0f172a" stroke-width="1.05"/>
<path d="M22,23.5 L28,29.5 L30,24.5 Z" fill="${finC}"/>
<path d="M20,16 Q23,20.5 19.5,25" stroke="#0f172a" stroke-width="0.85" fill="none" opacity="0.65"/>
${renderPatternOverlay(prof.p, prof.c, uid)}
<circle cx="15" cy="19.5" r="2.1" fill="${eyeC}" stroke="#0f172a" stroke-width="0.55"/><circle cx="15" cy="19.5" r="1" fill="#000"/>
</svg>`;
}
if (m === 'salmon_pred' || m === 'taimen' || m === 'salmon_hump') {
const humpY = m === 'salmon_hump' ? 7.5 : 12.5;
return `<svg ${svgAttrs}>${defs}
<path d="M37,${humpY + 1.5} L44,${humpY - 6} L54,${humpY + 2} Z" fill="${tailC}" stroke="#0f172a" stroke-width="0.75"/>
<!-- Жировой плавник лососёвых -->
<path d="M67,15.5 Q70.5,11.8 73,16.5 Z" fill="${finC}" stroke="#0f172a" stroke-width="0.55"/>
<path d="M57,25.5 L63,32.5 L69,24.5 Z" fill="${finC}"/>
<path d="M38,26 L43,32.5 L49,26.5 Z" fill="${finC}"/>
<path d="M77,16.5 L93,8.5 L88,21 L93,33.5 L77,25 Z" fill="url(#${uid}_f)" stroke="#0f172a" stroke-width="0.9"/>
<path d="M6,21 Q22,${humpY} 45,${humpY} Q64,14 78,17 L78,24.5 Q62,27 42,27.5 Q21,27 6,21 Z" fill="url(#${uid}_b)" stroke="#0f172a" stroke-width="1.1"/>
<path d="M22,23.5 L28,29.5 L30,24.5 Z" fill="${finC}"/>
<path d="M7,21.5 L17,22" stroke="#0f172a" stroke-width="0.85"/>
<path d="M21,15.5 Q24,20.5 20,25.5" stroke="#0f172a" stroke-width="0.9" fill="none" opacity="0.65"/>
${renderPatternOverlay(prof.p, prof.c, uid)}
<circle cx="15" cy="19" r="2.1" fill="${eyeC}" stroke="#0f172a" stroke-width="0.55"/><circle cx="15" cy="19" r="1" fill="#000"/>
</svg>`;
}
if (m === 'burbot' || m === 'catfish' || m === 'channel_cat' || m === 'eel') {
if (m === 'channel_cat') {
return `<svg ${svgAttrs}>${defs}
<path d="M32,14 L38,6 L46,14.5 Z" fill="${tailC}"/>
<path d="M67,16 Q70,12.5 72.5,17 Z" fill="${finC}"/>
<path d="M52,25.5 L59,32.5 L71,24.5 Z" fill="${finC}"/>
<path d="M77,17 L93,8.5 L86,21 L93,33.5 L77,24.5 Z" fill="url(#${uid}_f)"/>
<path d="M7,21.5 Q22,13 46,14 L78,17.5 L78,24 L46,26.5 Q22,27.5 7,21.5 Z" fill="url(#${uid}_b)" stroke="#0f172a" stroke-width="1.1"/>
<path d="M9,21 L2,26 M11,23 L4,30 M10,19 L4,15" stroke="#0f172a" stroke-width="1.1" stroke-linecap="round"/>
${renderPatternOverlay(prof.p, prof.c, uid)}
<circle cx="15.5" cy="19" r="2" fill="${eyeC}"/><circle cx="15.5" cy="19" r="1" fill="#000"/>
</svg>`;
}
const isCat = m === 'catfish';
const whiskers = isCat
? `<path d="M8,20.5 Q1,25 -1,31 M11,23.5 L5,30 M13,24 L9,29" stroke="#1c1917" stroke-width="1.3" fill="none" stroke-linecap="round"/>`
: `<path d="M10,23.5 L7,28.5" stroke="#1c1917" stroke-width="1.3" stroke-linecap="round"/>`;
const dorsal1 = !isCat ? `<path d="M31,15 L35,10.5 L40,15 Z" fill="${tailC}"/>` : `<path d="M29,15.5 L32,11 L35,15.5 Z" fill="${tailC}"/>`;
return `<svg ${svgAttrs}>${defs}
${dorsal1}
<path d="M42,15 L45,10.5 L79,13.5 L79,17.5 Z" fill="url(#${uid}_f)" stroke="#0f172a" stroke-width="0.7"/>
<path d="M44,25.5 L48,30.5 L79,28 L79,24 Z" fill="url(#${uid}_f)" stroke="#0f172a" stroke-width="0.7"/>
<path d="M78,15.5 C95,14 95,28 78,26.5 Z" fill="url(#${uid}_f)" stroke="#0f172a" stroke-width="0.9"/>
<path d="M6,21.5 Q18,14 38,15 L80,17 L80,25 L38,26.5 Q18,28 6,21.5 Z" fill="url(#${uid}_b)" stroke="#0f172a" stroke-width="1.1"/>
${whiskers}
<path d="M21,23.5 L27,29 L29,24.5 Z" fill="${finC}"/>
${renderPatternOverlay(prof.p, prof.c, uid)}
<circle cx="14.5" cy="19" r="1.9" fill="${eyeC}" stroke="#0f172a" stroke-width="0.5"/><circle cx="14.5" cy="19" r="0.95" fill="#000"/>
</svg>`;
}
if (m === 'cod') {
return `<svg ${svgAttrs}>${defs}
<path d="M26,14 L32,6.5 L40,13.5 Z" fill="${tailC}" stroke="#0f172a" stroke-width="0.7"/>
<path d="M42,13.5 L49,7 L60,15 Z" fill="${tailC}" stroke="#0f172a" stroke-width="0.7"/>
<path d="M62,15 L68,9.5 L75,17 Z" fill="${tailC}" stroke="#0f172a" stroke-width="0.7"/>
<path d="M43,26.5 L50,33.5 L59,25.5 Z" fill="${finC}" stroke="#0f172a" stroke-width="0.65"/>
<path d="M62,25 L68,31.5 L75,24 Z" fill="${finC}" stroke="#0f172a" stroke-width="0.65"/>
<path d="M77,17 L92,10 L89,21 L92,32 L77,24.5 Z" fill="url(#${uid}_f)" stroke="#0f172a" stroke-width="0.9"/>
<path d="M6,21 Q20,12 42,13.5 Q62,15 78,17.5 L78,24 Q60,26.5 40,27 Q20,27.5 6,21 Z" fill="url(#${uid}_b)" stroke="#0f172a" stroke-width="1.1"/>
<path d="M10,23.5 L8,28.5" stroke="#0f172a" stroke-width="1.2" stroke-linecap="round"/>
<path d="M22,23 L28,28.5 L30,24 Z" fill="${finC}"/>
${renderPatternOverlay(prof.p, prof.c, uid)}
<circle cx="15" cy="18.5" r="2.2" fill="${eyeC}" stroke="#0f172a" stroke-width="0.55"/><circle cx="15" cy="18.5" r="1.1" fill="#000"/>
</svg>`;
}
if (m === 'garfish') {
return `<svg ${svgAttrs}>${defs}
<path d="M66,17.5 L73,11 L79,18.5 Z" fill="${tailC}"/>
<path d="M65,24.5 L72,31 L78,23.5 Z" fill="${finC}"/>
<path d="M80,18.5 L94,11 L89,21 L94,31 L80,23.5 Z" fill="url(#${uid}_f)" stroke="#0f172a" stroke-width="0.8"/>
<path d="M1,20.8 L19,18.5 L81,18.5 L81,23.5 L19,23.5 L1,21.5 Z" fill="url(#${uid}_b)" stroke="#0f172a" stroke-width="1"/>
<circle cx="21" cy="20.5" r="1.8" fill="${eyeC}"/><circle cx="21" cy="20.5" r="0.9" fill="#000"/>
</svg>`;
}
if (m === 'angler') {
return `<svg ${svgAttrs}>${defs}
<path d="M22,14 Q14,4 8,9" stroke="#0f172a" stroke-width="1.2" fill="none"/>
<circle cx="7.5" cy="9.5" r="2.4" fill="#38bdf8" stroke="#e0f2fe" stroke-width="0.8"/>
<path d="M48,13 L56,6 L68,15.5 Z" fill="${tailC}"/>
<path d="M76,17 L91,11 L89,21.5 L91,32 L76,25 Z" fill="url(#${uid}_f)" stroke="#0f172a" stroke-width="0.9"/>
<path d="M8,23 Q14,10 38,11 Q58,12 77,17.5 L77,24.5 Q56,29 36,31 Q14,32 8,23 Z" fill="url(#${uid}_b)" stroke="#0f172a" stroke-width="1.15"/>
<path d="M9,22.5 L20,24.5" stroke="#0f172a" stroke-width="1.2"/>
${renderPatternOverlay(prof.p, prof.c, uid)}
<circle cx="19" cy="16.5" r="2.1" fill="${eyeC}"/><circle cx="19" cy="16.5" r="1" fill="#000"/>
</svg>`;
}
if (m === 'chekhon') {
return `<svg ${svgAttrs}>${defs}
<path d="M52,14.5 L57,8 L63,15 Z" fill="${tailC}"/>
<path d="M52,27.5 L59,34 L73,24.5 Z" fill="${finC}"/>
<path d="M77,16.5 L93,8 L85,20.5 L93,33 L77,24 Z" fill="url(#${uid}_f)" stroke="#0f172a" stroke-width="0.9"/>
<path d="M7,18.5 Q38,14 78,16.8 L78,23.5 Q52,31 28,28.5 Q14,26 7,18.5 Z" fill="url(#${uid}_b)" stroke="#0f172a" stroke-width="1.05"/>
<path d="M21,23 L33,35 L36,26.5 Z" fill="${finC}" stroke="#0f172a" stroke-width="0.6"/>
${renderPatternOverlay(prof.p, prof.c, uid)}
<circle cx="15" cy="18.5" r="2.2" fill="${eyeC}" stroke="#0f172a" stroke-width="0.55"/><circle cx="15" cy="18.5" r="1.1" fill="#000"/>
</svg>`;
}
const isDeep = m === 'roach' || m === 'sea_bream' || m === 'wrasse' || m === 'scorpion' || m === 'silver_carp';
const isPower = m === 'cyprinid_power' || m === 'asp' || m === 'mullet';
const isSlim = m === 'smelt' || m === 'sand_eel' || m === 'dace' || m === 'herring';
const topY = isDeep ? 10.5 : (isPower ? 12 : (isSlim ? 15 : 13));
const botY = isDeep ? 30 : (isPower ? 28 : (isSlim ? 25.5 : 27.5));
const whiskers = (m === 'barbel_whiskers' || m === 'red_mullet')
? `<path d="M9,22.5 L6,27.5 M11.5,23 L9.5,28" stroke="${finC}" stroke-width="1.2" stroke-linecap="round"/>`
: '';
const secondDorsal = (m === 'mackerel' || m === 'mullet' || m === 'red_mullet' || m === 'goby')
? `<path d="M54,${topY + 2} L60,${topY - 4} L67,${topY + 3.5} Z" fill="${tailC}" stroke="#0f172a" stroke-width="0.65"/>`
: '';
return `<svg ${svgAttrs}>${defs}
<path d="M35,${topY + 1.5} L43,${topY - 7} L53,${topY + 2} Z" fill="${tailC}" stroke="#0f172a" stroke-width="0.75"/>
${secondDorsal}
<path d="M55,${botY - 2} L62,${botY + 6} L69,${botY - 3} Z" fill="${finC}" stroke="#0f172a" stroke-width="0.65"/>
<path d="M35,${botY - 1} L41,${botY + 6.5} L48,${botY - 1.5} Z" fill="${finC}" stroke="#0f172a" stroke-width="0.65"/>
<path d="M76,17 L93,8 L85,21 L93,34 L76,24.5 Z" fill="url(#${uid}_f)" stroke="#0f172a" stroke-width="0.9"/>
<path d="M8,21 Q23,${topY} 45,${topY} Q64,14 77,17.5 L77,24 Q61,${botY} 42,${botY} Q22,${botY} 8,21 Z" fill="url(#${uid}_b)" stroke="#0f172a" stroke-width="1.1"/>
${whiskers}
<path d="M22,23.5 L29,30 L31,24.5 Z" fill="${finC}"/>
<path d="M20.5,15.5 Q23.5,21 19.5,26" stroke="#0f172a" stroke-width="0.9" fill="none" opacity="0.65"/>
${renderPatternOverlay(prof.p, prof.c, uid)}
<circle cx="15.5" cy="19.5" r="2.3" fill="${eyeC}" stroke="#0f172a" stroke-width="0.6"/><circle cx="15.5" cy="19.5" r="1.1" fill="#000"/>
</svg>`;
}
