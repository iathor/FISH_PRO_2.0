/**
 * @file circle.ownership.js
 * @description Логика владения, скрытия, доступа к закрытым Экипажам и фильтрации «Все / Мои / Чужие» для модуля Круг.
 */
import { store } from '../../core/store.js?v=2.9.2-r258';
import {
  getCurrentFisherIdentity,
  normalizeCrewSecretKey,
  hashCrewKeyForServer
} from './circle.module.js?v=2.9.2-r258';

/**
 * Определяет, принадлежит ли точка Круга/Слипа/Экипажа текущему пользователю.
 */
export function isCircleItemMine(item, stateObj = null, deps = {}) {
  if (!item) return false;
  if (item.isDemoSeed || item.isLockedExternalCrew) return false;
  const s = stateObj || store.getState();
  const resolveIdentity = typeof deps.getCurrentFisherIdentity === 'function'
    ? deps.getCurrentFisherIdentity
    : getCurrentFisherIdentity;
  const ident = resolveIdentity(s);
  const itemFid = String(item.fid || '').trim().toUpperCase();
  const myFid = String(ident.fisherId || '').trim().toUpperCase();
  if (itemFid && myFid && itemFid === myFid) {
    return true;
  }
  const itemHasRegFid = Boolean(itemFid && !itemFid.includes('RZ'));
  const myHasRegFid = Boolean(myFid && !myFid.includes('RZ'));
  if (itemHasRegFid && myHasRegFid && itemFid !== myFid) {
    return false;
  }
  const itemAu = String(item.au || '').trim().toLowerCase();
  const myLogin = String(ident.login || ident.callsign || '').trim().toLowerCase();
  if ((!itemHasRegFid || itemFid === myFid) && ident.isRegistered && myLogin && itemAu && itemAu === myLogin && itemAu !== 'рыболов' && !itemAu.startsWith('гость')) {
    return true;
  }
  const hasForeignRegisteredOwner =
    (itemHasRegFid && myFid && itemFid !== myFid) ||
    (ident.isRegistered && myLogin && itemAu && itemAu !== myLogin && itemAu !== 'рыболов' && !itemAu.startsWith('гость'));
  if (!hasForeignRegisteredOwner && !item.importedAt && item.did && item.did === ident.deviceId && item.did !== 'ext_v3' && item.did !== 'ext') {
    return true;
  }
  return false;
}

/**
 * Проверяет, скрыта ли чужая точка/событие пользователем.
 */
export function isCircleItemHidden(_item, _stateObj = null) {
  return false;
}

/**
 * Проверяет доступ к закрытой точке «Экипажа (72 ч)»:
 * - Сигналы SOS видны ВСЕМ.
 * - Сводки Круга и Мастерской видны всем.
 * - Закрытые Экипажи видны ТОЛЬКО создателю, участникам с ключом KP-XXXX и Администраторам из базы.
 */
export function canUserAccessCrewItem(item, stateObj = null, deps = {}) {
  if (!item) return false;
  if (item.t !== 'crew') return true;
  if (item.sos) return true;
  const s = stateObj || store.getState();
  if (isCircleItemMine(item, s, deps)) return true;
  const resolveIdentity = typeof deps.getCurrentFisherIdentity === 'function'
    ? deps.getCurrentFisherIdentity
    : getCurrentFisherIdentity;
  const normCrewKey = typeof deps.normalizeCrewSecretKey === 'function'
    ? deps.normalizeCrewSecretKey
    : normalizeCrewSecretKey;
  const hashCrewKey = typeof deps.hashCrewKeyForServer === 'function'
    ? deps.hashCrewKeyForServer
    : hashCrewKeyForServer;
  const ident = resolveIdentity(s);
  const itemKey = normCrewKey(item.crewKey) || String(item.crewKey || '').toUpperCase();
  const itemKeyHash = item.crewKeyHash || (itemKey ? hashCrewKey(itemKey) : '');
  const unlockedRaw = ident.unlockedCrewKeys.map(k => String(k).toUpperCase());
  const unlockedNorm = ident.unlockedCrewKeys.map(k => normCrewKey(k) || String(k).toUpperCase());
  const unlockedHashes = ident.unlockedCrewKeys.map(k => hashCrewKey(k));
  if (itemKey && (unlockedRaw.includes(itemKey) || unlockedNorm.includes(itemKey))) return true;
  if (itemKeyHash && unlockedHashes.includes(itemKeyHash)) return true;
  if (item.id && unlockedRaw.includes(String(item.id).toUpperCase())) return true;
  return false;
}

/**
 * Фильтрует список точек Круга по доступу, скрытию, принадлежности («Все / Мои / Чужие») и категории.
 */
export function filterCircleItemsByOwnership(items = [], stateObj = null, ownershipFilter = 'all', categoryFilter = 'all', deps = {}) {
  const s = stateObj || store.getState();
  const list = Array.isArray(items) ? items : [];
  const accessibleItems = list.filter(item => {
    if (!item) return false;
    if (item.t === 'crew' && !item.sos) return canUserAccessCrewItem(item, s, deps);
    return true;
  });
  const hiddenLockedCrewsCount = list.filter(x => x && x.t === 'crew' && !x.sos && !canUserAccessCrewItem(x, s, deps)).length;
  const nonHiddenItems = accessibleItems.filter(x => !isCircleItemHidden(x, s));
  const hiddenItems = accessibleItems.filter(x => isCircleItemHidden(x, s));
  const mineItems = nonHiddenItems.filter(x => isCircleItemMine(x, s, deps));
  const foreignItems = nonHiddenItems.filter(x => !isCircleItemMine(x, s, deps));

  let baseList = nonHiddenItems;
  if (ownershipFilter === 'mine') baseList = mineItems;
  else if (ownershipFilter === 'foreign') baseList = foreignItems;
  else if (ownershipFilter === 'hidden') baseList = hiddenItems;

  const radarBaseList = baseList.filter(item => item.t !== 'workshop');
  const filteredList = baseList.filter(item => {
    if (categoryFilter === 'sos') return item.t === 'crew' && Boolean(item.sos);
    if (categoryFilter === 'crew') return item.t === 'crew' && !item.sos;
    if (categoryFilter === 'circle') return item.t === 'circle';
    if (categoryFilter === 'spot') return item.t === 'spot';
    if (categoryFilter === 'workshop') return item.t === 'workshop';
    return item.t !== 'workshop';
  });

  return {
    accessibleItems,
    hiddenLockedCrewsCount,
    nonHiddenItems,
    hiddenItems,
    mineItems,
    foreignItems,
    baseList,
    radarBaseList,
    filteredList
  };
}
