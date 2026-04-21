/**
 * Retry Policy — exponential backoff with optional circuit breaker.
 *
 * Used for calls that may transiently fail: LLM provider, workstation API,
 * MCP tools. Not for idempotency-unsafe writes unless explicitly opted in.
 */

/**
 * Sleep with jitter.
 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function jitter(ms, factor = 0.2) {
  const delta = ms * factor;
  return ms + (Math.random() * 2 - 1) * delta;
}

/**
 * Retry an async operation with exponential backoff.
 *
 * @param {function} fn - async operation, called with (attempt: number)
 * @param {object} [opts]
 * @param {number} [opts.maxAttempts=3]
 * @param {number} [opts.baseDelayMs=500]
 * @param {number} [opts.maxDelayMs=30_000]
 * @param {number} [opts.backoffMultiplier=2]
 * @param {function} [opts.shouldRetry] - (err, attempt) => boolean; default true for all errors
 * @param {function} [opts.onRetry]     - (err, attempt, delayMs) => void
 * @returns {Promise<any>} - resolves with fn's result, or rejects with the last error
 */
export async function retry(fn, opts = {}) {
  const {
    maxAttempts = 3,
    baseDelayMs = 500,
    maxDelayMs = 30_000,
    backoffMultiplier = 2,
    shouldRetry = () => true,
    onRetry = null,
  } = opts;

  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts) break;
      if (!shouldRetry(err, attempt)) break;

      const raw = baseDelayMs * Math.pow(backoffMultiplier, attempt - 1);
      const delay = Math.min(jitter(raw), maxDelayMs);
      if (onRetry) onRetry(err, attempt, delay);
      await sleep(delay);
    }
  }
  throw lastErr;
}

/**
 * Circuit breaker — opens after N consecutive failures in a window,
 * blocks further calls for cooldown, then half-opens for a single probe.
 */
export function createCircuitBreaker({ failureThreshold = 5, cooldownMs = 30_000 } = {}) {
  let state = 'closed'; // 'closed' | 'open' | 'half_open'
  let failures = 0;
  let openedAt = 0;

  return {
    state: () => state,
    async run(fn) {
      if (state === 'open') {
        if (Date.now() - openedAt < cooldownMs) {
          const err = new Error('circuit_open');
          err.code = 'circuit_open';
          throw err;
        }
        state = 'half_open';
      }

      try {
        const result = await fn();
        if (state === 'half_open') {
          state = 'closed';
          failures = 0;
        } else if (failures > 0) {
          failures = 0;
        }
        return result;
      } catch (err) {
        failures++;
        if (state === 'half_open' || failures >= failureThreshold) {
          state = 'open';
          openedAt = Date.now();
        }
        throw err;
      }
    },
    reset() {
      state = 'closed';
      failures = 0;
      openedAt = 0;
    },
  };
}

/**
 * Helper: classify a typical HTTP/fetch error as retryable.
 */
export function isTransientError(err) {
  if (!err) return false;
  if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED') return true;
  if (err.name === 'AbortError') return true;
  const msg = (err.message || '').toLowerCase();
  if (msg.includes('network') || msg.includes('timeout') || msg.includes('socket')) return true;
  if (err.status && [408, 429, 500, 502, 503, 504].includes(err.status)) return true;
  return false;
}

export default { retry, createCircuitBreaker, isTransientError };
