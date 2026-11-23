/**
 * @file admin.auth.js
 * @description Изолированный модуль авторизации и управления админ-сессией (ADM_SESS_..., klev_pro_admin_saved_creds_v2, без хранения пароля).
 */
import { store } from '../../core/store.js?v=2.9.2-r257';

export const OWNER_BOUND_LOGIN = 'iAthor';
export const OWNER_BOUND_PIN_HASH = 'owner_iathor_vip089';
export const OWNER_BOUND_FISHER_ID = 'FP_89VIP089';
export const OWNER_SECONDARY_FISHER_ID = 'FP_FMP089';
export const ADMIN_SAVED_CREDS_KEY = 'klev_pro_admin_saved_creds_v2';

let _serverAdminSessionToken = '';
let _adminAuthRequired = false;

try {
  if (typeof localStorage !== 'undefined') {
    const rawSavedAdm = localStorage.getItem(ADMIN_SAVED_CREDS_KEY);
    if (rawSavedAdm) {
      const parsedAdm = JSON.parse(rawSavedAdm);
      if (parsedAdm && typeof parsedAdm === 'object') {
        if (parsedAdm.adminSessionToken) {
          _serverAdminSessionToken = String(parsedAdm.adminSessionToken).trim();
        }
        if ('password' in parsedAdm) {
          delete parsedAdm.password;
          localStorage.setItem(ADMIN_SAVED_CREDS_KEY, JSON.stringify(parsedAdm));
        }
      }
    }
  }
} catch (_e) {}

export function getServerAdminSessionToken() {
  return _serverAdminSessionToken;
}

export function setServerAdminSessionToken(token = '') {
  _serverAdminSessionToken = String(token || '').trim();
  return _serverAdminSessionToken;
}

export function isAdminAuthRequired() {
  return _adminAuthRequired;
}

export function setAdminAuthRequired(required = false) {
  _adminAuthRequired = Boolean(required);
  return _adminAuthRequired;
}

export function getSavedAdminCredentials() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(ADMIN_SAVED_CREDS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && 'password' in parsed) {
      delete parsed.password;
      try { localStorage.setItem(ADMIN_SAVED_CREDS_KEY, JSON.stringify(parsed)); } catch (_e) {}
    }
    return parsed;
  } catch (_e) {
    return null;
  }
}

export const loadSavedAdminCredentials = getSavedAdminCredentials;

export function saveAdminCredentialsToStorage({ login = 'iAthor', adminSessionToken = '' } = {}) {
  try {
    if (typeof localStorage === 'undefined') return;
    const prev = getSavedAdminCredentials() || {};
    const nextToken = adminSessionToken !== undefined
      ? String(adminSessionToken || '').trim()
      : String(prev.adminSessionToken || _serverAdminSessionToken || '').trim();
    const rec = {
      login: login || prev.login || 'iAthor',
      adminSessionToken: nextToken,
      savedAt: Date.now()
    };
    if (rec.adminSessionToken) _serverAdminSessionToken = rec.adminSessionToken;
    localStorage.setItem(ADMIN_SAVED_CREDS_KEY, JSON.stringify(rec));
  } catch (_e) {}
}

export function isAdminContourActive() {
  return Boolean(typeof window !== 'undefined' && window.__KLEV_ADMIN_CONTOUR__ === true);
}

export function getActiveAdminToken(stateObj = null) {
  const s = stateObj || store.getState();
  const saved = getSavedAdminCredentials();
  return String(
    _serverAdminSessionToken ||
    s?.userProfile?.adminSessionToken ||
    saved?.adminSessionToken ||
    ''
  ).trim();
}

export function isOwnerFisherId(fid = '') {
  const clean = String(fid || '').trim().toUpperCase();
  return clean === OWNER_BOUND_FISHER_ID || clean === OWNER_SECONDARY_FISHER_ID || clean === 'FP_89A01';
}

export function isLoginOwnerMatch(rawLogin = '') {
  const clean = String(rawLogin || '').trim().toLowerCase().replace(/[@\s]/g, '');
  return (
    clean === 'iathor' ||
    clean === 'iathor82' ||
    clean === 'thorantony82' ||
    clean === 'fp_89vip089' ||
    clean === 'fp_fmp089' ||
    clean === 'antonthor' ||
    clean === '89vip089' ||
    clean === 'fmp089'
  );
}

/**
 * Проверяет, является ли текущий пользователь Владельцем — ТОЛЬКО в отдельном админ-контуре и при наличии серверного сессионного токена (ADM_SESS_...).
 */
export function isOwnerAdmin(stateObj = null) {
  const s = stateObj || store.getState();
  const activeTok = getActiveAdminToken(s);
  if (isAdminContourActive()) {
    if (_adminAuthRequired === true) return false;
    return Boolean(activeTok && activeTok.length >= 4);
  }
  const up = s?.userProfile || {};
  return Boolean(up.ownerUnlocked === true && activeTok && activeTok.startsWith('ADM_SESS_'));
}
