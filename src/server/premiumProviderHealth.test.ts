import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isPremiumAiProviderOperational,
  recordPremiumAiProviderFailure,
  resetPremiumAiProviderHealthForTests,
} from '../../server/src/ai/premiumProviderHealth.js';

describe('premiumProviderHealth', () => {
  afterEach(() => {
    vi.useRealTimers();
    resetPremiumAiProviderHealthForTests();
  });

  it('honors retry-after on transient rate limits and self-heals after the cooldown', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-08T12:00:00.000Z'));

    recordPremiumAiProviderFailure(
      'gemini',
      Object.assign(new Error('rate limit exceeded'), {
        status: 429,
        headers: {
          'retry-after': '7',
        },
      }),
    );

    expect(isPremiumAiProviderOperational('gemini')).toBe(false);

    vi.advanceTimersByTime(6_999);
    expect(isPremiumAiProviderOperational('gemini')).toBe(false);

    vi.advanceTimersByTime(1);
    expect(isPremiumAiProviderOperational('gemini')).toBe(true);
  });
});
