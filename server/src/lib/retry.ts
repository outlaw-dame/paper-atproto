export type RetryOptions = {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: boolean;
  shouldRetry?: (error: unknown) => boolean;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultShouldRetry(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const anyErr = error as { status?: number; code?: string };
  if (anyErr.status && [408, 409, 425, 429, 500, 502, 503, 504].includes(anyErr.status)) return true;
  return anyErr.code === 'ETIMEDOUT' || anyErr.code === 'ECONNRESET';
}

function computeDelay(attempt: number, baseDelayMs: number, maxDelayMs: number, jitter: boolean): number {
  const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  if (!jitter) return exp;
  const spread = Math.floor(exp * 0.3);
  const min = Math.max(0, exp - spread);
  const max = exp + spread;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const shouldRetry = options.shouldRetry ?? defaultShouldRetry;
  let lastError: unknown;

  for (let attempt = 0; attempt < options.attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const isLast = attempt === options.attempts - 1;
      if (!shouldRetry(error) || isLast) break;
      const retryAfterMs = (error as { details?: { retryAfterMs?: unknown } }).details?.retryAfterMs;
      const serverDelay = typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs)
        ? Math.max(0, Math.min(options.maxDelayMs, Math.floor(retryAfterMs)))
        : null;
      await sleep(serverDelay ?? computeDelay(attempt, options.baseDelayMs, options.maxDelayMs, options.jitter));
    }
  }

  throw lastError;
}
