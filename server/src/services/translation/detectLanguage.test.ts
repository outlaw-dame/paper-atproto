import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  detectLanguage,
  getLanguageDetectionCacheStats,
  resetLanguageDetectionCache,
} from './detectLanguage.js';

describe('detectLanguage cache hygiene', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-02T00:00:00.000Z'));
    resetLanguageDetectionCache();
  });

  it('adds entries to cache and reuses them while fresh', () => {
    const first = detectLanguage('Hello this is a simple english sentence.');
    const second = detectLanguage('Hello this is a simple english sentence.');

    expect(first.language).toBe('en');
    expect(second.language).toBe('en');
    expect(getLanguageDetectionCacheStats().size).toBe(1);
  });

  it('prunes stale cache entries after ttl', () => {
    detectLanguage('Hello this is a simple english sentence.');
    expect(getLanguageDetectionCacheStats().size).toBe(1);

    vi.advanceTimersByTime(1000 * 60 * 60 * 6 + 1);

    // Any subsequent detect call triggers stale prune.
    detectLanguage('مرحبا كيف حالك');
    expect(getLanguageDetectionCacheStats().size).toBe(1);
  });
});
