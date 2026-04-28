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

function parseRetryAfterHeader(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const numericSeconds = Number(value);
  if (Number.isFinite(numericSeconds) && numericSeconds >= 0) {
    return Math.max(0, Math.floor(numericSeconds * 1000));
  }
  const targetTime = Date.parse(value);
  if (!Number.isFinite(targetTime)) return null;
  return Math.max(0, targetTime - Date.now());
}

function getHeaderValue(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== 'object') return null;
  if (headers instanceof Headers) {
    return headers.get(name);
  }

  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (key.toLowerCase() !== target || typeof value !== 'string') continue;
    return value;
  }
  return null;
}

export function extractRetryAfterMs(error: unknown): number | null {
  const directRetryAfterMs = (error as { retryAfterMs?: unknown })?.retryAfterMs;
  if (typeof directRetryAfterMs === 'number' && Number.isFinite(directRetryAfterMs)) {
    return Math.max(0, Math.floor(directRetryAfterMs));
  }

  const detailsRetryAfterMs = (error as { details?: { retryAfterMs?: unknown } })?.details?.retryAfterMs;
  if (typeof detailsRetryAfterMs === 'number' && Number.isFinite(detailsRetryAfterMs)) {
    return Math.max(0, Math.floor(detailsRetryAfterMs));
  }

  const retryAfterMsHeader = getHeaderValue((error as { headers?: unknown })?.headers, 'retry-after-ms')
    ?? getHeaderValue((error as { cause?: { headers?: unknown } })?.cause?.headers, 'retry-after-ms');
  if (retryAfterMsHeader) {
    const parsed = Number(retryAfterMsHeader);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.floor(parsed));
    }
  }

  const retryAfterHeader = getHeaderValue((error as { headers?: unknown })?.headers, 'retry-after')
    ?? getHeaderValue((error as { cause?: { headers?: unknown } })?.cause?.headers, 'retry-after');
  return parseRetryAfterHeader(retryAfterHeader);
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
      const retryAfterMs = extractRetryAfterMs(error);
      const serverDelay = typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs)
        ? Math.max(0, Math.min(options.maxDelayMs, Math.floor(retryAfterMs)))
        : null;
      await sleep(serverDelay ?? computeDelay(attempt, options.baseDelayMs, options.maxDelayMs, options.jitter));
    }
  }

  throw lastError;
}
