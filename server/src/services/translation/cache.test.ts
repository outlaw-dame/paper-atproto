import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getTranslationCache,
  getTranslationCacheStats,
  resetTranslationCache,
  setTranslationCache,
  translationCacheKey,
} from './cache.js';
import type { TranslationResult } from './types.js';

function sampleResult(id = 'x'): TranslationResult {
  return {
    id,
    translatedText: 'hola',
    sourceLang: 'en',
    targetLang: 'es',
    provider: 'm2m100',
    cached: false,
    modelVersion: 'm2m100:v1',
    qualityTier: 'default',
  };
}

describe('translation cache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-02T00:00:00.000Z'));
    resetTranslationCache();
  });

  it('builds cache keys independent from request id', () => {
    const keyA = translationCacheKey({
      sourceLang: 'EN',
      targetLang: 'es',
      modelVersion: 'route:auto',
      sourceText: 'Hello world',
    });
    const keyB = translationCacheKey({
      sourceLang: 'en',
      targetLang: 'ES',
      modelVersion: 'route:auto',
      sourceText: 'Hello world',
    });

    expect(keyA).toBe(keyB);
  });

  it('expires stale entries based on ttl', () => {
    const key = translationCacheKey({
      sourceLang: 'en',
      targetLang: 'es',
      modelVersion: 'route:auto',
      sourceText: 'Hello world',
    });

    setTranslationCache(key, sampleResult('one'), 1000);
    expect(getTranslationCache(key)?.translatedText).toBe('hola');

    vi.advanceTimersByTime(1001);
    expect(getTranslationCache(key)).toBeNull();
    expect(getTranslationCacheStats().size).toBe(0);
  });
});
