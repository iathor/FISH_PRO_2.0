/**
 * @file circle.api.js
 * @description Сетевое взаимодействие с Cloudflare Worker (workerFetch, E2E-шлюзы, /relay/pull с заголовками X-Auth-Token/X-Admin-Token и syncNearbyCirclePointsFromServer).
 */
import { events, KLEV_EVENTS } from '../../core/events.js?v=2.9.2-r256';
import { store } from '../../core/store.js?v=2.9.2-r256';
import { storage, calcGeoDistanceKm } from '../../core/storage.js?v=2.9.2-r256';
import { APP_VERSION } from '../../core/config.js?v=2.9.2-r256';
import { showToast } from '../../ui/components.js?v=2.9.2-r256';
import { RELAY_WORKER_URL } from '../../core/telegram.js?v=2.9.2-r256';
import {
  isAdminContourActive,
  getActiveAdminToken,
  isOwnerAdmin,
  setAdminAuthRequired
} from '../admin/admin.auth.js?v=2.9.2-r256';
import {
  isCircleItemMine
} from './circle.ownership.js?v=2.9.2-r256';
import {
  getCurrentFisherIdentity,
  normalizeCrewSecretKey,
  hashCrewKeyForServer,
  detectClientPlatformLabel,
  purgeExpiredCircleItems,
  flushPendingOutboxToServer,
  publishCircleItemToServer,
  decryptPayloadAesGcm,
  getEffectiveCircleRadiusKm,
  computeHexPolygonForCircle,
  pushAppNotification,
  syncCircleNavBadge,
  renderAdminSection,
  fetchSuperAdminDashboardData,
  getAdminRuntimeSnapshot,
  patchAdminRuntimeSnapshot,
  getRelaySyncRuntimeRefs,
  persistRelaySyncState
} from './circle.module.js?v=2.9.2-r256';

const PINNED_DB_GATEWAY_STORAGE_KEY = 'klev_pinned_db_gateway_kind_v2';
const LAST_WORKING_DB_GATEWAY_SESSION_KEY = 'klev_last_working_db_gateway_v2';
const CUSTOM_DB_RELAY_URL_STORAGE_KEY = 'klev_custom_db_relay_url_v1';

export const DB_GATEWAY_CATALOG = [
  { kind: 'relay_hexlet_raw', label: 'Шлюз РФ Hexlet Raw (E2E AES-256-GCM)', host: 'allorigins.hexlet.app/raw', isRelay: true, note: 'Российский узел вне Cloudflare (сквозное шифрование конверта ?e2e=)' },
  { kind: 'relay_hexlet_json', label: 'Шлюз РФ Hexlet JSON (E2E AES-256-GCM)', host: 'allorigins.hexlet.app/get', isRelay: true, note: 'Зашифрованный контейнер D1 через российский узел Hexlet' },
  { kind: 'relay_vercel_seven', label: 'Шлюз Vercel AWS (E2E AES-256-GCM)', host: 'corsproxy-seven.vercel.app', isRelay: true, note: 'Серверлесс-шлюз AWS в режиме сквозного шифрования ?e2e=' },
  { kind: 'relay_everyorigin', label: 'Шлюз EveryOrigin AWS (E2E AES-256-GCM)', host: 'every-origin.vercel.app', isRelay: true, note: 'Резервный зашифрованный канал на базе AWS / Vercel' },
  { kind: 'direct_get_payload', label: 'Прямой E2E GET-пакет D1 (?e2e=...)', host: 'klevprohbot.thorantony82.workers.dev', isRelay: false, note: 'Прямой зашифрованный GET-канал Cloudflare D1' },
  { kind: 'direct', label: 'Прямой канал D1 / Edge (POST/GET)', host: 'klevprohbot.thorantony82.workers.dev', isRelay: false, note: 'Стандартное прямое HTTPS-соединение с Cloudflare Worker' }
];

let _preferredRelayProxyUntil = Date.now() + 900000;
let _customDbRelayBridgeUrl = (() => {
  try {
    if (typeof localStorage !== 'undefined') {
      return String(localStorage.getItem(CUSTOM_DB_RELAY_URL_STORAGE_KEY) || '').trim();
    }
  } catch (_e) {}
  return '';
})();
let _lastWorkingGatewayKind = (() => {
  try {
    if (typeof sessionStorage !== 'undefined') {
      return sessionStorage.getItem(LAST_WORKING_DB_GATEWAY_SESSION_KEY) || '';
    }
  } catch (_e) {}
  return '';
})();
let _pinnedDbGatewayKind = (() => {
  try {
    if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem(PINNED_DB_GATEWAY_STORAGE_KEY) || 'auto';
      return (v === 'auto' || v === 'relay_custom_bridge' || DB_GATEWAY_CATALOG.some(g => g.kind === v)) ? v : 'auto';
    }
  } catch (_e) {}
  return 'auto';
})();
let _lastWorkingGatewayLabel = _lastWorkingGatewayKind
  ? (DB_GATEWAY_CATALOG.find(g => g.kind === _lastWorkingGatewayKind)?.label || 'Авто-каскад шлюзов РФ (облачный каскад)')
  : 'Авто-каскад шлюзов РФ (Hexlet / Vercel AWS / D1)';
let _lastDbGatewayDiagReport = null;
let _dbGatewayDiagRunning = false;

let _lastNearbyCircleSyncTs = 0;
let _nearbySyncInFlight = false;

export function getGatewayDiagnosticsState() {
  return {
    dbGatewayDiagRunning: _dbGatewayDiagRunning,
    lastDbGatewayDiagReport: _lastDbGatewayDiagReport,
    lastWorkingGatewayKind: _lastWorkingGatewayKind
  };
}

export function resetNearbySyncInFlight() {
  _nearbySyncInFlight = false;
}

export function getCustomDbRelayBridgeUrl() {
  return _customDbRelayBridgeUrl;
}

export function setCustomDbRelayBridgeUrl(rawUrl = '') {
  _customDbRelayBridgeUrl = String(rawUrl || '').trim();
  try {
    if (typeof localStorage !== 'undefined') {
      if (_customDbRelayBridgeUrl) localStorage.setItem(CUSTOM_DB_RELAY_URL_STORAGE_KEY, _customDbRelayBridgeUrl);
      else localStorage.removeItem(CUSTOM_DB_RELAY_URL_STORAGE_KEY);
    }
  } catch (_e) {}
  return _customDbRelayBridgeUrl;
}

export function getEffectiveGatewayCatalog() {
  if (_customDbRelayBridgeUrl && _customDbRelayBridgeUrl.startsWith('https://')) {
    let hostLabel = 'script.google.com / Личный мост';
    try { hostLabel = new URL(_customDbRelayBridgeUrl).hostname; } catch (_e) {}
    return [
      { kind: 'relay_custom_bridge', label: 'Личный мост Супер-Админа (Google / Yandex / Vercel)', host: hostLabel, isRelay: true, note: 'Персональный приватный HTTPS-ретранслятор без лимитов' },
      ...DB_GATEWAY_CATALOG
    ];
  }
  return DB_GATEWAY_CATALOG;
}

export function getLastActiveDbGatewayLabel() {
  return _lastWorkingGatewayLabel;
}

export function getPinnedDbGatewayKind() {
  return _pinnedDbGatewayKind || 'auto';
}

export function setPinnedDbGatewayKind(kind = 'auto') {
  const catalog = getEffectiveGatewayCatalog();
  const valid = kind === 'auto' || catalog.some(g => g.kind === kind);
  _pinnedDbGatewayKind = valid ? kind : 'auto';
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PINNED_DB_GATEWAY_STORAGE_KEY, _pinnedDbGatewayKind);
    }
  } catch (_e) {}
  if (_pinnedDbGatewayKind !== 'auto') {
    const found = catalog.find(g => g.kind === _pinnedDbGatewayKind);
    if (found) {
      _lastWorkingGatewayKind = found.kind;
      _lastWorkingGatewayLabel = found.label;
      _preferredRelayProxyUntil = found.isRelay ? (Date.now() + 1800000) : 0;
    }
  }
  return _pinnedDbGatewayKind;
}

const VALID_BUSINESS_ERROR_CODES = new Set([
  'REGISTRATION_REQUIRED',
  'LOGIN_TAKEN',
  'BRUTE_FORCE_LOCKED',
  'INVALID_CREDENTIALS'
]);

function _unwrapRelayContainerText(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';
  const trimmed = rawText.trim();
  if (!trimmed.startsWith('{')) return rawText;
  try {
    const outer = JSON.parse(trimmed);
    if (outer && typeof outer === 'object' && typeof outer.contents === 'string' && !('ok' in outer) && !('d1Status' in outer)) {
      const innerTrim = outer.contents.trim();
      if (innerTrim.startsWith('{') && (innerTrim.includes('"ok"') || innerTrim.includes('"error"'))) {
        return outer.contents;
      }
      const upstreamStatus = Number(outer?.status?.http_code ?? outer?.statusCode ?? 200);
      if (upstreamStatus >= 400 || upstreamStatus === 0) {
        throw new Error(`Upstream HTTP ${upstreamStatus}`);
      }
      return outer.contents;
    }
    if (outer && typeof outer === 'object' && typeof outer.body === 'string' && !('ok' in outer) && ('statusCode' in outer || 'status' in outer)) {
      const innerTrim = outer.body.trim();
      if (innerTrim.startsWith('{') && (innerTrim.includes('"ok"') || innerTrim.includes('"error"'))) {
        return outer.body;
      }
      const upstreamStatus = Number(outer.statusCode ?? outer.status ?? 200);
      if (upstreamStatus >= 400 || upstreamStatus === 0) {
        throw new Error(`Upstream HTTP ${upstreamStatus}`);
      }
      return outer.body;
    }
  } catch (e) {
    if (String(e?.message || '').startsWith('Upstream HTTP')) throw e;
  }
  return rawText;
}

function _isValidWorkerPayloadText(rawText, isHtmlExpected = false) {
  if (!rawText || typeof rawText !== 'string') return false;
  const trimmed = rawText.trim();
  if (!trimmed) return false;
  if (isHtmlExpected && (trimmed.includes('Клёв ПРО') || trimmed.includes('Веб-Консоль') || trimmed.includes('ЗАКРЫТАЯ БАЗА'))) {
    return true;
  }
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object') return false;
    if (parsed.ok === false) {
      if (parsed.authRequired === true || parsed.error === 'Unauthorized' || parsed.error === 'Forbidden') return true;
      if (parsed.code && VALID_BUSINESS_ERROR_CODES.has(parsed.code)) return true;
      if (typeof parsed.error === 'string' && /[А-Яа-яЁё]/.test(parsed.error)) return true;
      return false;
    }
    if ('error' in parsed && parsed.ok !== true) {
      return false;
    }
    const keys = ['ok', 'version', 'items', 'users', 'fisherId', 'whitelist', 'packets', 'bound', 'deleted', 'deletedChannel', 'appName', 'totalUsers', 'd1Status', 'aiQuota', 'securityAudit', 'betaTesters', 'policyState'];
    return keys.some(k => k in parsed);
  } catch (e) {
    return false;
  }
}

function _formatGatewayErrorRu(err) {
  const msg = String(err?.message || err || '').trim();
  if (/aborted|AbortError|timeout/i.test(msg)) {
    return 'Превышено время ожидания ответа от сервера';
  }
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
    return 'Сброс сетевого соединения с узлом';
  }
  if (/HTTP (4\d\d|5\d\d)/i.test(msg)) {
    const m = msg.match(/HTTP (\d+)/i);
    return `Отказ транзитного узла (HTTP ${m ? m[1] : 'ошибка'})`;
  }
  if (/Invalid gateway payload/i.test(msg)) {
    return 'Некорректный формат ответа вместо JSON базы D1';
  }
  return msg.slice(0, 64) || 'Канал недоступен';
}

const WORKER_ENVELOPE_PUBLIC_JWK = {"key_ops":["encrypt"],"ext":true,"kty":"RSA","n":"tLqIvyZO8p_qT0zDChD0QfWFXQ2BPhJX8k1-JKnafxxTUoK_SMYS3ggSGP-e84EW4JpNIHUqFliTfs49PrisvwzqXOGFQ1OflUf1j98MjO3ETnEnA1LYmjUuomR9HFoslj7nGgkeVRtV9oWxGvRDdDko4nHybIOZ8BvvyhWvtS58qG1JO-wVjrT8IGx8TLMr4hOUxLzqyKqXvX5jtb0ct_wgLZsE8FL1Vl6jZBzMn2pC3hD6F-peHkzWm3ON_ooiyFghelGoQewT8ZC5Np3eD6_Ci5eHkVsbyfsA95k9lf6_Wx2i37cLRn5bhziASGTc898NRpb_OS5QpYP9kNk1YQ","e":"AQAB","alg":"RSA-OAEP-256"};
let _cachedWorkerPubCryptoKey = null;

function _bytesToB64Url(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function _b64UrlToBytes(b64url = '') {
  const b64 = String(b64url || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function _randomHex(byteLen = 16) {
  const b = new Uint8Array(byteLen);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(b);
  } else {
    for (let i = 0; i < byteLen; i++) b[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function _hexToBytes(hex = '') {
  const clean = String(hex || '').trim();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16) || 0;
  return out;
}

async function _getWorkerEnvelopePublicKey() {
  if (_cachedWorkerPubCryptoKey) return _cachedWorkerPubCryptoKey;
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.importKey === 'function') {
    _cachedWorkerPubCryptoKey = await crypto.subtle.importKey(
      'jwk',
      WORKER_ENVELOPE_PUBLIC_JWK,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['encrypt']
    );
    return _cachedWorkerPubCryptoKey;
  }
  return null;
}

async function _buildE2EEnvelopeParam(method, origSearch, bodyStr, customHeaders = null) {
  const respKeyHex = _randomHex(32);
  const nonceHex = _randomHex(12);
  const hdrs = {};
  if (customHeaders && typeof customHeaders === 'object') {
    if (customHeaders['X-Auth-Token']) hdrs['X-Auth-Token'] = String(customHeaders['X-Auth-Token']);
    if (customHeaders['X-Admin-Token']) hdrs['X-Admin-Token'] = String(customHeaders['X-Admin-Token']);
  }
  const envelopePayload = JSON.stringify({
    v: 1,
    m: String(method || 'GET').toUpperCase(),
    q: String(origSearch || ''),
    b: bodyStr !== undefined ? String(bodyStr) : '',
    h: hdrs,
    rk: respKeyHex,
    ts: Date.now(),
    n: nonceHex
  });
  const plainBytes = new TextEncoder().encode(envelopePayload);
  const pubKey = await _getWorkerEnvelopePublicKey().catch(() => null);
  if (pubKey && typeof crypto !== 'undefined' && crypto.subtle) {
    const aesRaw = new Uint8Array(32);
    const iv = new Uint8Array(12);
    crypto.getRandomValues(aesRaw);
    crypto.getRandomValues(iv);
    const aesKey = await crypto.subtle.importKey('raw', aesRaw, { name: 'AES-GCM' }, false, ['encrypt']);
    const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, plainBytes);
    const wrappedKeyBuf = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pubKey, aesRaw);
    return {
      e2eParam: `E2E1.${_bytesToB64Url(new Uint8Array(wrappedKeyBuf))}.${_bytesToB64Url(iv)}.${_bytesToB64Url(new Uint8Array(cipherBuf))}`,
      respKeyHex
    };
  }
  throw new Error('WebCrypto RSA-OAEP/AES-GCM required for E2E relay envelope');
}

async function _decryptWorkerE2EResponse(e2eRespStr, respKeyHex) {
  const raw = String(e2eRespStr || '').trim();
  if (raw.startsWith('E2E1.')) {
    const parts = raw.split('.');
    if (parts.length !== 3) throw new Error('Invalid E2E1 response format');
    const iv = _b64UrlToBytes(parts[1]);
    const cipherBytes = _b64UrlToBytes(parts[2]);
    const keyBytes = _hexToBytes(respKeyHex);
    const aesKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
    const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, cipherBytes);
    const decoded = JSON.parse(new TextDecoder().decode(plainBuf));
    return decoded;
  }
  throw new Error('Unsupported E2E response container');
}

async function _executeSingleGatewayRequest(kind, fullUrl, method, bodyStr, canUseGetPayload, timeoutMs, tag, recordWinner = true, customHeaders = null) {
  const parsedUrl = new URL(fullUrl);
  const origSearch = parsedUrl.search || '';
  const baseEndpointUrl = `${parsedUrl.origin}${parsedUrl.pathname}`;
  let targetUrl = fullUrl;
  let reqMethod = method;
  let e2eSession = null;

  if (kind === 'direct') {
    reqMethod = method;
    if (reqMethod === 'GET') {
      const sep = fullUrl.includes('?') ? '&' : '?';
      targetUrl = fullUrl.includes('_t=') ? `${fullUrl}&_r=${tag}` : `${fullUrl}${sep}_t=${Date.now()}_${tag}`;
    } else {
      targetUrl = fullUrl;
    }
  } else {
    e2eSession = await _buildE2EEnvelopeParam(method, origSearch, bodyStr, customHeaders);
    const innerUrl = `${baseEndpointUrl}?e2e=${encodeURIComponent(e2eSession.e2eParam)}&_t=${Date.now()}_${kind}_${tag}`;
    reqMethod = 'GET';
    if (kind === 'direct_get_payload') {
      targetUrl = innerUrl;
    } else if (kind === 'relay_custom_bridge' && _customDbRelayBridgeUrl) {
      const bSep = _customDbRelayBridgeUrl.includes('?') ? (_customDbRelayBridgeUrl.endsWith('=') || _customDbRelayBridgeUrl.endsWith('?') || _customDbRelayBridgeUrl.endsWith('&') ? '' : '&url=') : '?url=';
      targetUrl = `${_customDbRelayBridgeUrl}${bSep}${encodeURIComponent(innerUrl)}`;
    } else if (kind === 'relay_hexlet_raw') {
      targetUrl = `https://allorigins.hexlet.app/raw?disableCache=true&url=${encodeURIComponent(innerUrl)}`;
    } else if (kind === 'relay_hexlet_json') {
      targetUrl = `https://allorigins.hexlet.app/get?disableCache=true&url=${encodeURIComponent(innerUrl)}&_t=${Date.now()}`;
    } else if (kind === 'relay_vercel_seven') {
      targetUrl = `https://corsproxy-seven.vercel.app/api?url=${encodeURIComponent(innerUrl)}`;
    } else if (kind === 'relay_everyorigin') {
      targetUrl = `https://every-origin.vercel.app/api/get?url=${encodeURIComponent(innerUrl)}&_t=${Date.now()}`;
    } else {
      throw new Error(`Unsupported or deprecated gateway kind: ${kind}`);
    }
  }

  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, timeoutMs) : null;
  try {
    const fetchOpts = {
      method: reqMethod,
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      signal: ctrl ? ctrl.signal : undefined
    };
    if (kind === 'direct' && customHeaders && typeof customHeaders === 'object') {
      fetchOpts.headers = { ...customHeaders };
    }
    if (kind === 'direct' && reqMethod === 'POST' && bodyStr !== undefined) {
      fetchOpts.headers = {
        ...(fetchOpts.headers || {}),
        'Content-Type': customHeaders?.['Content-Type'] ? customHeaders['Content-Type'] : 'application/json;charset=UTF-8'
      };
      fetchOpts.body = bodyStr;
    }
    const res = await fetch(targetUrl, fetchOpts);
    if (timer) clearTimeout(timer);
    if (!res) throw new Error('Empty response');
    let textBody = await res.text();
    textBody = _unwrapRelayContainerText(textBody);
    let finalStatus = res.status;

    if (e2eSession) {
      const parsedOuter = JSON.parse(textBody);
      if (!parsedOuter || typeof parsedOuter.e2eResp !== 'string') {
        throw new Error(`Untrusted unencrypted response from gateway ${kind}`);
      }
      const decResp = await _decryptWorkerE2EResponse(parsedOuter.e2eResp, e2eSession.respKeyHex);
      textBody = String(decResp.body ?? '');
      finalStatus = Number(decResp.status || 200);
    }

    const isHtmlConsole = fullUrl.includes('/fp-vip089-console');
    if (finalStatus >= 400) {
      if (!_isValidWorkerPayloadText(textBody, isHtmlConsole)) {
        throw new Error(`Gateway ${kind} HTTP ${finalStatus}`);
      }
    }
    if (!_isValidWorkerPayloadText(textBody, isHtmlConsole)) {
      throw new Error(`Invalid gateway payload from ${kind}`);
    }
    if (recordWinner) {
      const catalog = getEffectiveGatewayCatalog();
      const gwMeta = catalog.find(g => g.kind === kind);
      _lastWorkingGatewayKind = kind;
      _lastWorkingGatewayLabel = gwMeta ? gwMeta.label : (kind.startsWith('relay_') ? `Резервный E2E шлюз (${kind.replace('relay_', '')})` : 'Прямой канал D1 / Edge');
      try {
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.setItem(LAST_WORKING_DB_GATEWAY_SESSION_KEY, kind);
        }
      } catch (_e) {}
      if (kind.startsWith('relay_')) {
        _preferredRelayProxyUntil = Date.now() + 900000;
      }
    }
    return new Response(textBody, {
      status: finalStatus,
      headers: {
        'Content-Type': isHtmlConsole ? 'text/html;charset=utf-8' : 'application/json;charset=utf-8',
        'X-Klev-Gateway': kind
      }
    });
  } catch (err) {
    if (timer) clearTimeout(timer);
    throw err;
  }
}

export async function workerFetch(endpointOrUrl, options = {}, timeoutMs = 6500, retries = 2) {
  const fullUrl = String(endpointOrUrl || '').startsWith('http')
    ? endpointOrUrl
    : `${RELAY_WORKER_URL}${endpointOrUrl}`;
  const method = String(options.method || 'GET').toUpperCase();
  const bodyStr = typeof options.body === 'string' ? options.body : (options.body ? JSON.stringify(options.body) : undefined);
  const isAuthEndpoint = fullUrl.includes('/auth/login') || fullUrl.includes('/auth/sync') || fullUrl.includes('/auth/register');
  const reqHeaders = { ...(options.headers || {}) };
  if (isAdminContourActive() || isOwnerAdmin()) {
    const admTok = getActiveAdminToken();
    if (admTok && !reqHeaders['X-Admin-Token']) reqHeaders['X-Admin-Token'] = admTok;
  }
  const authTok = store.getState()?.userProfile?.authTokenHash || '';
  if (authTok && !reqHeaders['X-Auth-Token']) reqHeaders['X-Auth-Token'] = authTok;
  const canUseGetPayload = (method === 'POST' && (!bodyStr || bodyStr.length < 7500));
  const relayReady = (method === 'GET') || canUseGetPayload;
  const isAiVisionCall = fullUrl.includes('/api/ai/identify-fish');
  const perRelayTimeout = isAiVisionCall
    ? Math.max(11000, Math.min(24000, timeoutMs + 2000))
    : Math.max(5500, Math.min(9500, timeoutMs + 1500));

  if (isAuthEndpoint) {
    const authGateways = Array.from(new Set([
      ...(_pinnedDbGatewayKind && _pinnedDbGatewayKind !== 'auto' ? [_pinnedDbGatewayKind] : []),
      ...(_lastWorkingGatewayKind ? [_lastWorkingGatewayKind] : []),
      ...(_customDbRelayBridgeUrl ? ['relay_custom_bridge'] : []),
      'relay_hexlet_json',
      'relay_hexlet_raw',
      'relay_everyorigin',
      'relay_vercel_seven',
      'direct_get_payload',
      'direct'
    ]));
    let lastAuthErr = null;
    for (const gwKind of authGateways) {
      try {
        const res = await _executeSingleGatewayRequest(gwKind, fullUrl, method, bodyStr, canUseGetPayload, 5200, 'auth_seq', true, reqHeaders);
        return res;
      } catch (err) {
        lastAuthErr = err;
      }
    }
    throw lastAuthErr || new Error('Auth network timeout');
  }

  const runParallelRelayRace = (raceTag = 'r0', excludeKind = '') => {
    const relayOrder = [
      ...(_customDbRelayBridgeUrl ? ['relay_custom_bridge'] : []),
      'relay_hexlet_raw',
      'relay_hexlet_json',
      'relay_vercel_seven',
      'relay_everyorigin'
    ].filter(k => k !== excludeKind);
    const candidates = relayOrder.map(k =>
      _executeSingleGatewayRequest(k, fullUrl, method, bodyStr, canUseGetPayload, perRelayTimeout, raceTag, true, reqHeaders)
    );
    if (method === 'POST' && canUseGetPayload && excludeKind !== 'direct_get_payload') {
      candidates.push(_executeSingleGatewayRequest('direct_get_payload', fullUrl, method, bodyStr, canUseGetPayload, Math.min(timeoutMs, 3800), raceTag, true, reqHeaders));
    } else if (excludeKind !== 'direct') {
      candidates.push(_executeSingleGatewayRequest('direct', fullUrl, method, bodyStr, canUseGetPayload, Math.min(timeoutMs, 3800), raceTag, true, reqHeaders));
    }
    return Promise.any(candidates);
  };

  const executeAttempt = async (attemptIdx) => {
    const aTag = `a${attemptIdx}`;
    if (_pinnedDbGatewayKind && _pinnedDbGatewayKind !== 'auto') {
      if (!_pinnedDbGatewayKind.startsWith('relay_') || relayReady) {
        try {
          const pinTimeout = isAiVisionCall ? perRelayTimeout : Math.min(perRelayTimeout, 4800);
          return await _executeSingleGatewayRequest(_pinnedDbGatewayKind, fullUrl, method, bodyStr, canUseGetPayload, pinTimeout, `pin_${aTag}`, true, reqHeaders);
        } catch (_pinErr) {
          if (relayReady) return await runParallelRelayRace(`pin_fb_${aTag}`, _pinnedDbGatewayKind);
          throw _pinErr;
        }
      }
    }

    if (relayReady && _lastWorkingGatewayKind) {
      let hedgeTimer = null;
      let rejectHedge = null;
      const hedgeDelayMs = isAiVisionCall ? 4500 : 950;
      const stickyPromise = _executeSingleGatewayRequest(_lastWorkingGatewayKind, fullUrl, method, bodyStr, canUseGetPayload, perRelayTimeout, `sticky_${aTag}`, true, reqHeaders);
      const hedgePromise = new Promise((resolve, reject) => {
        rejectHedge = reject;
        hedgeTimer = setTimeout(() => {
          runParallelRelayRace(`hedge_${aTag}`, _lastWorkingGatewayKind).then(resolve).catch(reject);
        }, hedgeDelayMs);
      });
      hedgePromise.catch(() => {});
      try {
        const res = await Promise.any([
          stickyPromise.catch(() => {
            if (hedgeTimer) { clearTimeout(hedgeTimer); hedgeTimer = null; }
            if (typeof rejectHedge === 'function') rejectHedge(new Error('Sticky failed'));
            return runParallelRelayRace(`sticky_fb_${aTag}`, _lastWorkingGatewayKind);
          }),
          hedgePromise
        ]);
        if (hedgeTimer) clearTimeout(hedgeTimer);
        return res;
      } catch (_e) {
        if (hedgeTimer) clearTimeout(hedgeTimer);
      }
    }

    if (relayReady) {
      return await runParallelRelayRace(`race_${aTag}`);
    }

    return await _executeSingleGatewayRequest('direct', fullUrl, method, bodyStr, canUseGetPayload, timeoutMs, `d_${aTag}`, true, reqHeaders);
  };

  let lastErr = null;
  const maxAttempts = Math.max(1, Math.min(3, (Number(retries) || 0) + 1));
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await executeAttempt(i);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Network timeout');
}

/**
 * Запрос пакетов ретранслятора /relay/pull с передачей X-Auth-Token и X-Admin-Token строго в заголовках.
 */
export async function pullRelayPackets({
  boxes = [],
  since = 0,
  viewer = '',
  deviceId = '',
  authToken = '',
  adminToken = '',
  timeoutMs = 4500,
  retries = 0
} = {}) {
  const pullHeaders = {};
  if (authToken) pullHeaders['X-Auth-Token'] = String(authToken).trim();
  if (adminToken) pullHeaders['X-Admin-Token'] = String(adminToken).trim();
  const boxesStr = Array.isArray(boxes) ? boxes.join(',') : String(boxes || '');
  const qs = new URLSearchParams({
    boxes: boxesStr,
    since: String(Number(since) || 0),
    viewer: String(viewer || '')
  });
  if (deviceId) qs.set('deviceId', String(deviceId));
  const url = `${RELAY_WORKER_URL}/relay/pull?${qs.toString()}`;
  return workerFetch(url, { method: 'GET', headers: pullHeaders }, timeoutMs, retries);
}

export async function runAdminGatewayDatabaseDiagnostics(triggerToast = true) {
  if (_dbGatewayDiagRunning) return _lastDbGatewayDiagReport;
  _dbGatewayDiagRunning = true;
  renderAdminSection();
  const s = store.getState();
  const tok = getActiveAdminToken(s);
  const probeEndpoint = '/api/admin/users';
  const fullUrl = `${RELAY_WORKER_URL}${probeEndpoint}`;
  const reqBodyStr = JSON.stringify({ adminToken: tok, compact: 1, limit: 250 });
  const catalog = getEffectiveGatewayCatalog();

  const testSingleGateway = async (gw) => {
    const t0 = Date.now();
    try {
      const res = await _executeSingleGatewayRequest(gw.kind, fullUrl, 'POST', reqBodyStr, true, 6200, 'diag', false, tok ? { 'X-Admin-Token': tok } : null);
      const latencyMs = Math.max(1, Date.now() - t0);
      const rawText = await res.text();
      const parsed = JSON.parse(rawText);
      const ok = Boolean(parsed && parsed.ok === true && Array.isArray(parsed.users));
      const snap = getAdminRuntimeSnapshot();
      if (ok && (!snap.adminDashboardCache || (parsed.users.length >= (snap.adminDashboardCache.users?.length || 0)))) {
        patchAdminRuntimeSnapshot({ adminDashboardCache: { ...parsed, authRequired: false } });
        setAdminAuthRequired(false);
      }
      return {
        kind: gw.kind,
        label: gw.label,
        host: gw.host,
        isRelay: gw.isRelay,
        note: gw.note,
        ok,
        httpStatus: ok ? 200 : 502,
        latencyMs,
        bytes: rawText.length,
        detail: ok ? `БД D1: ${parsed.totalUsers ?? parsed.users.length} польз. (${rawText.length} байт)` : 'Некорректный ответ D1',
        checkedAt: Date.now()
      };
    } catch (err) {
      const latencyMs = Math.max(1, Date.now() - t0);
      return {
        kind: gw.kind,
        label: gw.label,
        host: gw.host,
        isRelay: gw.isRelay,
        note: gw.note,
        ok: false,
        httpStatus: 0,
        latencyMs,
        bytes: 0,
        detail: _formatGatewayErrorRu(err),
        checkedAt: Date.now()
      };
    }
  };

  const batch1 = catalog.slice(0, 4);
  const batch2 = catalog.slice(4);
  const res1 = await Promise.all(batch1.map(gw => testSingleGateway(gw)));
  const res2 = batch2.length > 0 ? await Promise.all(batch2.map(gw => testSingleGateway(gw))) : [];
  const results = [...res1, ...res2];

  const working = results.filter(r => r.ok).sort((a, b) => a.latencyMs - b.latencyMs);
  const fastest = working[0] || null;

  if (fastest) {
    _lastWorkingGatewayKind = fastest.kind;
    _lastWorkingGatewayLabel = fastest.label;
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(LAST_WORKING_DB_GATEWAY_SESSION_KEY, fastest.kind);
      }
    } catch (_e) {}
    if (_pinnedDbGatewayKind !== 'auto') {
      const pinnedRes = results.find(r => r.kind === _pinnedDbGatewayKind);
      if (!pinnedRes || !pinnedRes.ok) {
        setPinnedDbGatewayKind('auto');
      }
    }
    if (fastest.isRelay) {
      _preferredRelayProxyUntil = Date.now() + 1800000;
    } else {
      _preferredRelayProxyUntil = 0;
    }
  } else {
    const snap = getAdminRuntimeSnapshot();
    if (snap.adminDashboardCache) {
      snap.adminDashboardCache.d1Status = 'DISCONNECTED_GATEWAY';
    }
  }

  _lastDbGatewayDiagReport = {
    checkedAt: Date.now(),
    totalGateways: results.length,
    workingCount: working.length,
    fastestKind: fastest ? fastest.kind : '',
    fastestLabel: fastest ? fastest.label : 'Нет доступных каналов',
    fastestLatencyMs: fastest ? fastest.latencyMs : 0,
    results
  };
  _dbGatewayDiagRunning = false;

  if (working.length > 0) {
    if (triggerToast) {
      showToast(`Связь с облачной БД подтверждена: доступно ${working.length} из ${results.length} шлюзов. Активен: ${fastest.label} (${fastest.latencyMs} мс)`, 'good');
    }
    await fetchSuperAdminDashboardData(false);
  } else {
    if (triggerToast) {
      showToast('Резервные облачные узлы временно недоступны. Подключите личный мост Google в карточке диагностики.', 'warn');
    }
    renderAdminSection();
  }
  return _lastDbGatewayDiagReport;
}

/**
 * Загружает с сервера все активные точки Круга, открытых Экипажей, SOS и Мастерской рядом (/api/circle/nearby).
 */
export async function syncNearbyCirclePointsFromServer(showFeedbackToast = false, forceImmediate = false) {
  const now = Date.now();
  if (!showFeedbackToast && !forceImmediate && (now - _lastNearbyCircleSyncTs < 5000 || _nearbySyncInFlight)) return false;
  _lastNearbyCircleSyncTs = now;
  _nearbySyncInFlight = true;
  try {
    await flushPendingOutboxToServer();
    const s = store.getState();
    const ident = getCurrentFisherIdentity(s);
    const radiusKm = Math.max(120, Number(s.waterRadiusKm) || 120);
    const crewKeyTags = Array.from(new Set([
      ...ident.unlockedCrewKeys.map(k => hashCrewKeyForServer(k)).filter(Boolean),
      ...ident.unlockedCrewKeys.map(k => (normalizeCrewSecretKey(k) || String(k).toUpperCase())).filter(Boolean)
    ])).join(',');
    const qs = new URLSearchParams({
      lat: String(Number(s.lat || 55.7558).toFixed(4)),
      lon: String(Number(s.lon || 37.6173).toFixed(4)),
      radius: String(radiusKm),
      fid: ident.fisherId,
      deviceId: ident.deviceId,
      crewKeys: crewKeyTags,
      platform: detectClientPlatformLabel(),
      version: APP_VERSION,
      locLabel: (s.hasUserLocation && s.locLabel && !String(s.locLabel).includes('определяется')) ? s.locLabel : ''
    });
    const res = await workerFetch(`/api/circle/nearby?${qs.toString()}`, { method: 'GET' }, 4800, 1);
    if (!res.ok) {
      _nearbySyncInFlight = false;
      return false;
    }
    const data = await res.json();
    if (!data || !data.ok || !Array.isArray(data.items)) {
      _nearbySyncInFlight = false;
      return false;
    }
    const { explicitlyDeletedLocalIds, recentlyPublishedLocalIds } = getRelaySyncRuntimeRefs();
    const curList = purgeExpiredCircleItems(store.getState().circleItems || []);
    const serverIds = new Set(data.items.map(x => x.id));
    const mergedMap = new Map();
    let prunedCount = 0;
    const unconfirmedMineToRepublish = [];
    curList.forEach(it => {
      if (!it || !it.id) return;
      if (explicitlyDeletedLocalIds.has(it.id)) {
        prunedCount++;
        return;
      }
      const isMine = isCircleItemMine(it, s) && !it.isDemoSeed;
      const recentPubTs = recentlyPublishedLocalIds.get(it.id) || it.publishedAt || it.ca || 0;
      const isProtectedMine = isMine && (it.offlinePending || (now - recentPubTs < 300000));
      const hasCoords = Number.isFinite(it.lat) && Number.isFinite(it.lon);
      const dist = hasCoords ? calcGeoDistanceKm(s.lat, s.lon, it.lat, it.lon) : 0;
      const inRadius = dist <= radiusKm;
      if (inRadius && !serverIds.has(it.id) && !isProtectedMine) {
        explicitlyDeletedLocalIds.add(it.id);
        prunedCount++;
        return;
      }
      if (isMine && !serverIds.has(it.id) && (it.offlinePending || (now - recentPubTs < 120000))) {
        unconfirmedMineToRepublish.push(it);
      }
      mergedMap.set(it.id, it);
    });
    if (unconfirmedMineToRepublish.length > 0 && ident.isRegistered && !ident.isTemporaryReserve) {
      unconfirmedMineToRepublish.slice(0, 3).forEach(pt => {
        publishCircleItemToServer(pt, pt.packToken || '').catch(() => {});
      });
    }
    let newExternalCount = 0;
    for (const srvItem of data.items) {
      if (!srvItem || !srvItem.id) continue;
      const itemCopy = { ...srvItem };
      if (itemCopy.t === 'crew' && !itemCopy.sos && itemCopy.e2eeCrewCipher) {
        let decryptedCrew = null;
        for (const candKey of ident.unlockedCrewKeys) {
          decryptedCrew = await decryptPayloadAesGcm(itemCopy.e2eeCrewCipher, candKey);
          if (decryptedCrew && Number.isFinite(Number(decryptedCrew.lat))) {
            itemCopy.lat = Number(decryptedCrew.lat);
            itemCopy.lon = Number(decryptedCrew.lon);
            if (decryptedCrew.wn) itemCopy.wn = decryptedCrew.wn;
            if (decryptedCrew.lb) itemCopy.lb = decryptedCrew.lb;
            if (decryptedCrew.nt !== undefined) itemCopy.nt = decryptedCrew.nt;
            if (decryptedCrew.dp !== undefined) itemCopy.dp = Number(decryptedCrew.dp);
            if (decryptedCrew.bt) itemCopy.bt = decryptedCrew.bt;
            itemCopy.crewKey = normalizeCrewSecretKey(decryptedCrew.crewKey || candKey) || candKey;
            break;
          }
        }
        if (!decryptedCrew) continue;
      }
      if (itemCopy.t === 'circle' && Number.isFinite(itemCopy.lat) && Number.isFinite(itemCopy.lon) && !Array.isArray(itemCopy.poly)) {
        const effR = getEffectiveCircleRadiusKm(itemCopy, now);
        const hex = computeHexPolygonForCircle(itemCopy.lat, itemCopy.lon, effR, itemCopy.id);
        itemCopy.lat = hex.cellLat;
        itemCopy.lon = hex.cellLon;
        itemCopy.poly = hex.vertices;
      }
      const existingItem = mergedMap.get(itemCopy.id);
      if (existingItem && existingItem.did && !itemCopy.did) {
        itemCopy.did = existingItem.did;
      }
      const isMine = isCircleItemMine(itemCopy, s) || (existingItem ? isCircleItemMine(existingItem, s) : false);
      if (existingItem && existingItem.importedAt !== undefined) {
        itemCopy.importedAt = isMine ? 0 : existingItem.importedAt;
      }
      if (!existingItem) {
        itemCopy.importedAt = isMine ? 0 : now;
        if (!isMine) {
          newExternalCount++;
          if (itemCopy.sos) {
            pushAppNotification({
              category: 'sos',
              title: `СИГНАЛ SOS НА ВОДЕ (${itemCopy.wn || itemCopy.lb})`,
              body: `Координаты: ${Number(itemCopy.lat).toFixed(4)}°N, ${Number(itemCopy.lon).toFixed(4)}°E • От ${itemCopy.fid}`,
              subTab: 'radar',
              itemId: itemCopy.id || '',
              lat: itemCopy.lat,
              lon: itemCopy.lon,
              silentToast: false
            });
          } else if (itemCopy.t === 'crew') {
            pushAppNotification({
              category: 'crew',
              title: `Точка Экипажа (${itemCopy.crewKey || '72ч'})`,
              body: `${itemCopy.wn || itemCopy.lb}: ${itemCopy.fn} (~${itemCopy.dp} м) • От ${itemCopy.fid}`,
              subTab: 'radar',
              lat: itemCopy.lat,
              lon: itemCopy.lon,
              silentToast: true
            });
          } else if (itemCopy.t === 'circle') {
            pushAppNotification({
              category: 'circle',
              title: `Новая сводка в Круге (${itemCopy.wn || itemCopy.lb})`,
              body: `${itemCopy.fn} на «${itemCopy.bt || 'по сезону'}» • От ${itemCopy.fid}`,
              subTab: 'radar',
              lat: itemCopy.lat,
              lon: itemCopy.lon,
              silentToast: true
            });
          }
        }
      }
      mergedMap.set(itemCopy.id, itemCopy);
    }
    const mergedList = Array.from(mergedMap.values())
      .sort((a, b) => (b.ca || 0) - (a.ca || 0))
      .slice(0, 120);
    if (prunedCount > 0) {
      persistRelaySyncState();
    }
    if (newExternalCount > 0 || prunedCount > 0 || mergedList.length !== curList.length) {
      storage.saveCircleItems(mergedList);
      store.dispatch({ type: 'SET_CIRCLE_ITEMS', payload: mergedList });
      syncCircleNavBadge();
      events.emit(KLEV_EVENTS.CIRCLE_UPDATED, {
        items: mergedList,
        newExternalCount,
        prunedCount,
        source: 'sync'
      });
    }
    if (showFeedbackToast) {
      showToast(
        newExternalCount > 0
          ? ` Радар Круга обновлён: получено ${newExternalCount} новых точек!`
          : ` Радар Круга синхронизирован (активных точек: ${mergedList.length})`,
        'good'
      );
    }
    _nearbySyncInFlight = false;
    return true;
  } catch (e) {
    _nearbySyncInFlight = false;
    if (showFeedbackToast) {
      showToast('Автономный режим радара Круга (показаны сохранённые точки)', 'info');
    }
    return false;
  }
}
