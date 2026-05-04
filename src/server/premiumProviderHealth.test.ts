import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let healthModule: typeof import('../../server/src/ai/premiumProviderHealth.js');

describe('premiumProviderHealth', () => {
  afterEach(() => {
    vi.useRealTimers();
    healthModule?.resetPremiumAiProviderHealthForTests();
  });

  beforeEach(async () => {
    healthModule = await import(`../../server/src/ai/premiumProviderHealth.js?test=${Date.now()}`);
    healthModule.resetPremiumAiProviderHealthForTests();
  });

  it('honors retry-after on transient rate limits and self-heals after the cooldown', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-08T12:00:00.000Z'));

    healthModule.recordPremiumAiProviderFailure(
      'gemini',
      Object.assign(new Error('rate limit exceeded'), {
        status: 429,
        headers: {
          'retry-after': '7',
        },
      }),
    );

    expect(healthModule.isPremiumAiProviderOperational('gemini')).toBe(false);

    vi.advanceTimersByTime(6_999);
    expect(healthModule.isPremiumAiProviderOperational('gemini')).toBe(false);

    vi.advanceTimersByTime(1);
    expect(healthModule.isPremiumAiProviderOperational('gemini')).toBe(true);
  });

  it('marks model-not-found failures as temporarily unavailable and self-heals after cooldown', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-08T12:00:00.000Z'));

    healthModule.recordPremiumAiProviderFailure(
      'openai',
      Object.assign(new Error('model unavailable'), {
        status: 404,
        code: 'model_not_found',
      }),
    );

    expect(healthModule.isPremiumAiProviderOperational('openai')).toBe(false);

    vi.advanceTimersByTime(2 * 60 * 1000 - 1);
    expect(healthModule.isPremiumAiProviderOperational('openai')).toBe(false);

    vi.advanceTimersByTime(1);
    expect(healthModule.isPremiumAiProviderOperational('openai')).toBe(true);
  });

  it('treats premium quality validation failures as short-lived provider unavailability', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-08T12:00:00.000Z'));

    healthModule.recordPremiumAiProviderFailure(
      'gemini',
      Object.assign(new Error('Deep interpolator returned a non-additive summary'), {
        status: 502,
        code: 'deep_interpolator_non_additive_output',
      }),
    );

    expect(healthModule.isPremiumAiProviderOperational('gemini')).toBe(false);

    vi.advanceTimersByTime(60_000);
    expect(healthModule.isPremiumAiProviderOperational('gemini')).toBe(true);
  });

  it('treats invalid structured output as short-lived quality unavailability', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-08T12:00:00.000Z'));

    healthModule.recordPremiumAiProviderFailure(
      'gemini',
      Object.assign(new Error('Gemini premium AI returned invalid structured output'), {
        status: 502,
        code: 'DEEP_INTERPOLATOR_INVALID_STRUCTURED_OUTPUT',
      }),
    );

    expect(healthModule.isPremiumAiProviderOperational('gemini')).toBe(false);

    vi.advanceTimersByTime(60_000);
    expect(healthModule.isPremiumAiProviderOperational('gemini')).toBe(true);
  });
});
