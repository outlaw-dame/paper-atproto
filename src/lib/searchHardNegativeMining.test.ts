import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildHardNegativeDataset,
  clearHardNegativeSignals,
  recordSearchCorrectionSignal,
} from './searchHardNegativeMining';

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

describe('searchHardNegativeMining stale signal handling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-02T00:00:00.000Z'));
    const storage = createMemoryStorage();
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('window', { localStorage: storage });
    clearHardNegativeSignals();
  });

  it('excludes stale signals beyond retention window', () => {
    recordSearchCorrectionSignal({
      query: 'query',
      resultId: 'neg-old',
      relevance: 'irrelevant',
      confidenceScore: 0.8,
    });

    vi.advanceTimersByTime(1000 * 60 * 60 * 24 * 31);

    recordSearchCorrectionSignal({
      query: 'query',
      resultId: 'pos-new',
      relevance: 'relevant',
      confidenceScore: 0.9,
    });

    const dataset = buildHardNegativeDataset();
    expect(dataset).toEqual([]);
  });

  it('keeps fresh relevant and irrelevant signals', () => {
    recordSearchCorrectionSignal({
      query: 'query',
      resultId: 'neg',
      relevance: 'irrelevant',
      confidenceScore: 0.7,
    });

    vi.advanceTimersByTime(1000);

    recordSearchCorrectionSignal({
      query: 'query',
      resultId: 'pos',
      relevance: 'relevant',
      confidenceScore: 0.9,
    });

    const dataset = buildHardNegativeDataset();
    expect(dataset).toHaveLength(1);
    expect(dataset[0]?.query).toBe('query');
    expect(dataset[0]?.positives.map((p) => p.id)).toContain('pos');
    expect(dataset[0]?.negatives.map((n) => n.id)).toContain('neg');
  });
});
