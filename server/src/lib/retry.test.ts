import { describe, expect, it, vi, afterEach } from 'vitest';

import { withRetry } from './retry.js';

describe('withRetry', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('honors retry-after-ms headers from upstream errors', async () => {
    vi.useFakeTimers();

    const fn = vi.fn<() => Promise<string>>()
      .mockRejectedValueOnce({
        status: 503,
        headers: {
          'retry-after-ms': '1200',
        },
      })
      .mockResolvedValueOnce('ok');

    const promise = withRetry(
      () => fn(),
      {
        attempts: 2,
        baseDelayMs: 100,
        maxDelayMs: 5000,
        jitter: false,
      },
    );

    expect(fn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1199);
    expect(fn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
