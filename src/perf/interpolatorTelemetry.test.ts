import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getInterpolatorMetricsSnapshot,
  recordConversationHydrationRun,
  recordConversationWatchConnectionState,
  recordConversationWatchInvalidation,
  recordConversationWatchStatus,
  recordInterpolatorDeltaResolution,
  recordInterpolatorSummaryProjectionFallback,
  resetInterpolatorTelemetryForTests,
  subscribeInterpolatorMetrics,
} from './interpolatorTelemetry';

describe('interpolatorTelemetry delta metrics', () => {
  beforeEach(() => {
    resetInterpolatorTelemetryForTests();
  });

  it('tracks delta rebuilds and self-heals without content payloads', () => {
    recordInterpolatorDeltaResolution({ usedStored: true, selfHealed: false });
    recordInterpolatorDeltaResolution({ usedStored: false, selfHealed: true });

    const snapshot = getInterpolatorMetricsSnapshot();
    expect(snapshot.delta.resolutionCount).toBe(2);
    expect(snapshot.delta.storedReuseRate).toBe(0.5);
    expect(snapshot.delta.rebuildRate).toBe(0.5);
    expect(snapshot.delta.selfHealRate).toBe(0.5);
  });

  it('deduplicates projection fallback metrics by key', () => {
    recordInterpolatorSummaryProjectionFallback('thread-1:2026-04-08T12:00:00.000Z');
    recordInterpolatorSummaryProjectionFallback('thread-1:2026-04-08T12:00:00.000Z');
    recordInterpolatorSummaryProjectionFallback('thread-1:2026-04-08T12:01:00.000Z');

    const snapshot = getInterpolatorMetricsSnapshot();
    expect(snapshot.delta.summaryFallbackCount).toBe(2);
  });

  it('publishes delta snapshot updates to subscribers', () => {
    vi.stubGlobal('window', Object.assign(new EventTarget(), {}));

    const seen: number[] = [];
    const unsubscribe = subscribeInterpolatorMetrics((snapshot) => {
      seen.push(snapshot.delta.resolutionCount);
    });

    recordInterpolatorDeltaResolution({ usedStored: true, selfHealed: false });
    recordInterpolatorDeltaResolution({ usedStored: false, selfHealed: true });

    unsubscribe();
    expect(seen).toEqual([0, 1, 2]);
  });

  it('tracks live thread watch and hydration mix without content payloads', () => {
    recordConversationWatchConnectionState('connecting');
    recordConversationWatchConnectionState('ready', { observedAt: '2026-04-08T18:10:00.000Z' });
    recordConversationWatchInvalidation('2026-04-08T18:10:05.000Z');
    recordConversationWatchStatus({ state: 'degraded', code: 'upstream_5xx' });
    recordConversationWatchStatus({ state: 'reconnect', code: 'timeout' });
    recordConversationHydrationRun({ phase: 'initial', outcome: 'success' });
    recordConversationHydrationRun({ phase: 'event', outcome: 'success' });
    recordConversationHydrationRun({ phase: 'poll', outcome: 'failure' });

    const snapshot = getInterpolatorMetricsSnapshot();
    expect(snapshot.watch.connectionAttempts).toBe(1);
    expect(snapshot.watch.readyCount).toBe(1);
    expect(snapshot.watch.invalidationCount).toBe(1);
    expect(snapshot.watch.degradedCount).toBe(1);
    expect(snapshot.watch.reconnectCount).toBe(1);
    expect(snapshot.watch.lastStatusCode).toBe('timeout');
    expect(snapshot.hydration.totalAttempts).toBe(3);
    expect(snapshot.hydration.totalSuccesses).toBe(2);
    expect(snapshot.hydration.totalFailures).toBe(1);
    expect(snapshot.hydration.eventShare).toBeCloseTo(1 / 3);
    expect(snapshot.hydration.pollShare).toBeCloseTo(1 / 3);
  });
});
