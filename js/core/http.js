export async function fetchWithTimeout(url, ms = 6800, options = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      ...options,
      signal: ctrl.signal
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}
export async function retry(fn, attempts = 2, delayMs = 350) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn(i);
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }
  throw lastErr;
}
export async function fallbackChain(steps) {
  let lastErr = null;
  for (const step of steps) {
    try {
      if (step.onStart) step.onStart();
      const result = await step.run();
      if (result !== null && result !== undefined) {
        return { data: result, source: step.name || 'online' };
      }
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('All fallback endpoints failed');
}