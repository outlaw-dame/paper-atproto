import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeError } from './errors';
import { withRetry } from './retry';

describe('normalizeError', () => {
  it('parses Retry-After delay seconds', () => {
    const error = normalizeError({
      status: 429,
      headers: { get: (name: string) => (name === 'Retry-After' ? '2' : null) },
      message: 'Rate limited',
    });

    expect(error.kind).toBe('rate_limit');
    expect(error.retryAfterMs).toBe(2000);
  });

  it('parses Retry-After HTTP dates', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-29T00:00:00Z'));

    const error = normalizeError({
      status: 429,
      headers: { get: (name: string) => (name === 'Retry-After' ? 'Mon, 29 Mar 2026 00:00:03 GMT' : null) },
      message: 'Rate limited',
    });

    expect(error.kind).toBe('rate_limit');
    expect(error.retryAfterMs).toBe(3000);
  });
});

describe('withRetry', () => {
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { navigator?: Navigator }).navigator;
  });

  it('stops retrying network failures when navigator reports offline', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { onLine: false },
    });

    let attempts = 0;
    await expect(
      withRetry(async () => {
        attempts += 1;
        throw new TypeError('Failed to fetch');
      }),
    ).rejects.toThrow('Failed to fetch');

    expect(attempts).toBe(1);
  });

  it('retries transient network failures with backoff', async () => {
    vi.useFakeTimers();

    let attempts = 0;
    const promise = withRetry(async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new TypeError('Failed to fetch');
      }
      return 'ok';
    }, { baseDelayMs: 1, capDelayMs: 2, maxAttempts: 3 });

    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe('ok');
    expect(attempts).toBe(3);
  });
});
