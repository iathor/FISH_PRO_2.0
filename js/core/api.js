export class ApiError extends Error {
  constructor(message, { status, url, cause } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.url = url;
    this.cause = cause;
  }
}

export async function fetchWithTimeout(url, { timeoutMs = 8000, ...init } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new ApiError(`Timeout ${timeoutMs}ms`, { url });
    throw new ApiError('Network error', { url, cause: err });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson(url, options = {}) {
  const res = await fetchWithTimeout(url, options);
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, { status: res.status, url });
  return res.json();
}

export async function retry(fn, { attempts = 2, delayMs = 400, backoff = 2 } = {}) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(i); }
    catch (err) {
      last = err;
      if (i < attempts - 1) {
        await new Promise(r => setTimeout(r, delayMs * Math.pow(backoff, i)));
      }
    }
  }
  throw last;
}

export async function fallbackChain(providers, { onAttempt } = {}) {
  const errors = [];
  for (const p of providers) {
    try {
      if (onAttempt) onAttempt(p.label || '');
      const result = await p.run();
      if (result != null) return { result, provider: p.label, errors };
    } catch (err) {
      errors.push({ provider: p.label, error: err });
    }
  }
  throw new ApiError('All providers failed', { cause: errors });
}