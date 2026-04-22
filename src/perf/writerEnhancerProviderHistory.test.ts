import { beforeEach, describe, expect, it } from 'vitest';

import {
  appendWriterEnhancerProviderHistory,
  clearWriterEnhancerProviderHistory,
  readWriterEnhancerProviderHistory,
} from './writerEnhancerProviderHistory';

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

function createSnapshot(overrides?: Partial<{
  gemini: {
    reviews: number;
    failures: number;
    candidate: number;
    rescue: number;
    latencyTotal: number;
  };
  openai: {
    reviews: number;
    failures: number;
    candidate: number;
    rescue: number;
    latencyTotal: number;
  };
}>) {
  return {
    enhancer: {
      providers: {
        gemini: {
          reviews: overrides?.gemini?.reviews ?? 4,
          failures: overrides?.gemini?.failures ?? 1,
          appliedTakeovers: {
            candidate: overrides?.gemini?.candidate ?? 2,
            rescue: overrides?.gemini?.rescue ?? 0,
          },
          latencyMs: {
            total: overrides?.gemini?.latencyTotal ?? 500,
          },
        },
        openai: {
          reviews: overrides?.openai?.reviews ?? 3,
          failures: overrides?.openai?.failures ?? 0,
          appliedTakeovers: {
            candidate: overrides?.openai?.candidate ?? 1,
            rescue: overrides?.openai?.rescue ?? 0,
          },
          latencyMs: {
            total: overrides?.openai?.latencyTotal ?? 360,
          },
        },
      },
    },
  };
}

describe('writerEnhancerProviderHistory', () => {
  const storage = createMemoryStorage();

  beforeEach(() => {
    clearWriterEnhancerProviderHistory(storage);
  });

  it('persists sanitized provider snapshots', () => {
    const t0 = new Date(Date.now() - 120_000).toISOString();
    const t1 = new Date(Date.now() - 60_000).toISOString();

    appendWriterEnhancerProviderHistory(createSnapshot(), {
      storage,
      recordedAt: t0,
      minSampleIntervalMs: 0,
    });
    appendWriterEnhancerProviderHistory(createSnapshot({
      gemini: {
        reviews: 6,
        failures: 2,
        candidate: 3,
        rescue: 1,
        latencyTotal: 900,
      },
    }), {
      storage,
      recordedAt: t1,
      minSampleIntervalMs: 0,
    });

    const history = readWriterEnhancerProviderHistory(storage);
    expect(history).toHaveLength(2);
    expect(history[1]?.providers.gemini.failures).toBe(2);
    expect(history[1]?.providers.openai.reviews).toBe(3);
  });

  it('replaces the latest sample inside the bounded sampling window', () => {
    const t0 = new Date(Date.now() - 90_000).toISOString();
    const t1 = new Date(Date.now() - 60_000).toISOString();

    appendWriterEnhancerProviderHistory(createSnapshot(), {
      storage,
      recordedAt: t0,
      minSampleIntervalMs: 60_000,
    });
    appendWriterEnhancerProviderHistory(createSnapshot({
      openai: {
        reviews: 5,
        failures: 1,
        candidate: 2,
        rescue: 0,
        latencyTotal: 640,
      },
    }), {
      storage,
      recordedAt: t1,
      minSampleIntervalMs: 60_000,
    });

    const history = readWriterEnhancerProviderHistory(storage);
    expect(history).toHaveLength(1);
    expect(history[0]?.providers.openai.reviews).toBe(5);
    expect(history[0]?.providers.openai.failures).toBe(1);
  });
});
