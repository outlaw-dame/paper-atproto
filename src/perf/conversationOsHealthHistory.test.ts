import { beforeEach, describe, expect, it } from 'vitest';

import {
  appendConversationOsHealthHistory,
  clearConversationOsHealthHistory,
  readConversationOsHealthHistory,
} from './conversationOsHealthHistory';
import type { InterpolatorMetricsSnapshot } from './interpolatorTelemetry';

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

function createSnapshot(overrides: Partial<InterpolatorMetricsSnapshot> = {}): InterpolatorMetricsSnapshot {
  return {
    modes: {
      normal: { count: 4, modelRate: 0.8, fallbackRate: 0.2, avgSurfaceConfidence: 0.7, avgInterpretiveConfidence: 0.65 },
      descriptive_fallback: { count: 2, modelRate: 0.4, fallbackRate: 0.6, avgSurfaceConfidence: 0.5, avgInterpretiveConfidence: 0.42 },
      minimal_fallback: { count: 1, modelRate: 0, fallbackRate: 1, avgSurfaceConfidence: 0.2, avgInterpretiveConfidence: 0.12 },
    },
    gate: { passed: 5, skipped: 2 },
    delta: {
      resolutionCount: 7,
      storedReuseCount: 4,
      rebuiltCount: 3,
      selfHealCount: 1,
      storedReuseRate: 4 / 7,
      rebuildRate: 3 / 7,
      selfHealRate: 1 / 7,
      summaryFallbackCount: 1,
    },
    watch: {
      currentState: 'ready',
      connectionAttempts: 2,
      readyCount: 2,
      invalidationCount: 3,
      degradedCount: 0,
      reconnectCount: 0,
      closedCount: 0,
      lastReadyAt: '2026-04-08T20:00:00.000Z',
      lastInvalidationAt: '2026-04-08T20:01:00.000Z',
      lastStatusCode: null,
    },
    hydration: {
      phases: {
        initial: { attempts: 1, successes: 1, failures: 0 },
        poll: { attempts: 1, successes: 1, failures: 0 },
        event: { attempts: 2, successes: 2, failures: 0 },
      },
      totalAttempts: 4,
      totalSuccesses: 4,
      totalFailures: 0,
      successRate: 1,
      eventShare: 0.5,
      pollShare: 0.25,
      lastPhase: 'event',
      lastOutcome: 'success',
    },
    totalWriterAttempts: 6,
    overallModelSuccessRate: 0.75,
    overallFallbackRate: 0.25,
    stageTimings: {},
    ...overrides,
  };
}

describe('conversationOsHealthHistory', () => {
  const storage = createMemoryStorage();

  beforeEach(() => {
    clearConversationOsHealthHistory(storage);
  });

  it('persists sanitized bounded history snapshots', () => {
    appendConversationOsHealthHistory(createSnapshot(), {
      storage,
      recordedAt: '2026-04-08T20:00:00.000Z',
      minSampleIntervalMs: 0,
    });
    appendConversationOsHealthHistory(createSnapshot({
      delta: {
        resolutionCount: 10,
        storedReuseCount: 5,
        rebuiltCount: 5,
        selfHealCount: 2,
        storedReuseRate: 0.5,
        rebuildRate: 0.5,
        selfHealRate: 0.2,
        summaryFallbackCount: 2,
      },
    }), {
      storage,
      recordedAt: '2026-04-08T20:02:00.000Z',
      minSampleIntervalMs: 0,
    });

    const history = readConversationOsHealthHistory(storage);
    expect(history).toHaveLength(2);
    expect(history[1]?.delta.selfHealCount).toBe(2);
    expect(history[1]?.modes.normal).toBe(4);
  });

  it('replaces the most recent entry inside the sampling window', () => {
    appendConversationOsHealthHistory(createSnapshot(), {
      storage,
      recordedAt: '2026-04-08T20:00:00.000Z',
      minSampleIntervalMs: 60_000,
    });
    appendConversationOsHealthHistory(createSnapshot({
      watch: {
        currentState: 'retrying',
        connectionAttempts: 3,
        readyCount: 2,
        invalidationCount: 3,
        degradedCount: 1,
        reconnectCount: 1,
        closedCount: 0,
        lastReadyAt: '2026-04-08T20:00:00.000Z',
        lastInvalidationAt: '2026-04-08T20:01:00.000Z',
        lastStatusCode: 'timeout',
      },
    }), {
      storage,
      recordedAt: '2026-04-08T20:00:30.000Z',
      minSampleIntervalMs: 60_000,
    });

    const history = readConversationOsHealthHistory(storage);
    expect(history).toHaveLength(1);
    expect(history[0]?.watch.currentState).toBe('retrying');
    expect(history[0]?.watch.degradedCount).toBe(1);
  });
});
