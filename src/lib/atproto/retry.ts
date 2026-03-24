// ─── Retry with Exponential Backoff + Decorrelated Jitter ─────────────────
// Implements the "decorrelated jitter" algorithm from the AWS architecture blog.
// This avoids thundering-herd behaviour when many clients retry simultaneously.
//
// Formula:  sleep = min(cap, random_between(base, prev_sleep * 3))

import { normalizeError, isRetryable, type AtpError } from './errors.js';

export interface RetryOptions {
  maxAttempts?: number;   // default 3
  baseDelayMs?: number;   // default 300 ms
  capDelayMs?: number;    // default 10 000 ms (10 s)
  signal?: AbortSignal;
}

function jitteredDelay(base: number, prev: number, cap: number): number {
  const lo = base;
  const hi = Math.min(cap, prev * 3);
  return lo + Math.random() * (hi - lo);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    const id = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(id); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
  });
}

export async function withRetry<T>(
  fn: (attempt: number, signal?: AbortSignal) => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 300,
    capDelayMs = 10_000,
    signal,
  } = opts;

  let prevDelay = baseDelayMs;
  let lastError: AtpError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt, signal);
    } catch (raw) {
      const err = normalizeError(raw);
      lastError = err;

      // Never retry non-retryable errors
      if (!isRetryable(err)) throw raw;

      // On the last attempt, give up
      if (attempt === maxAttempts) throw raw;

      // If the server told us when to retry, respect it
      const delay = err.retryAfterMs ?? jitteredDelay(baseDelayMs, prevDelay, capDelayMs);
      prevDelay = delay;

      await sleep(delay, signal);
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError?.original ?? new Error('Retry exhausted');
}
