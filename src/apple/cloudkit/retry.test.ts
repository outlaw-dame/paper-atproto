import { afterEach, describe, expect, it, vi } from 'vitest';

import { CloudKitTransportError } from './errors';
import {
  getBreakerState,
  resetBreakerForTests,
  retryWithFullJitter,
} from './retry';

describe('cloudkit retry breaker', () => {
  afterEach(() => {
    resetBreakerForTests();
    vi.useRealTimers();
  });

  it('opens after repeated operation failures and blocks new calls', async () => {
    const policy = { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1 };

    for (let i = 0; i < 5; i += 1) {
      await expect(
        retryWithFullJitter(async () => {
          throw new CloudKitTransportError('network unavailable');
        }, policy),
      ).rejects.toBeInstanceOf(CloudKitTransportError);
    }

    expect(getBreakerState()).toBe('open');

    await expect(
      retryWithFullJitter(async () => 'ok', policy),
    ).rejects.toThrow(/circuit breaker open/i);
  });

  it('permits only one half-open probe at a time', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-04-07T00:00:00.000Z');
    vi.setSystemTime(now);

    const policy = { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1 };

    for (let i = 0; i < 5; i += 1) {
      await expect(
        retryWithFullJitter(async () => {
          throw new CloudKitTransportError('network unavailable');
        }, policy),
      ).rejects.toBeInstanceOf(CloudKitTransportError);
    }

    expect(getBreakerState()).toBe('open');

    vi.setSystemTime(new Date(now.getTime() + (5 * 60 * 1000) + 1));

    let resolveProbe: () => void = () => {};
    const probePromise = retryWithFullJitter(
      () => new Promise<void>((resolve) => {
        resolveProbe = resolve;
      }),
      policy,
    );

    await expect(
      retryWithFullJitter(async () => 'secondary-probe', policy),
    ).rejects.toThrow(/circuit breaker open/i);

    resolveProbe();
    await probePromise;
  });
});
