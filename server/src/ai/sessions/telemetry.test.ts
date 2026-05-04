import { beforeEach, describe, expect, it } from 'vitest';

let telemetryModule: typeof import('./telemetry.js');

describe('ai session telemetry derived hydration metrics', () => {
  beforeEach(async () => {
    telemetryModule = await import(`./telemetry.js?test=${Date.now()}`);
    telemetryModule.resetAiSessionTelemetry();
  });

  it('computes rates and replay throughput metrics from hydration events', () => {
    telemetryModule.recordDurableHydrationAttempt();
    telemetryModule.recordDurableHydrationSuccess({
      durationMs: 120,
      replayedItems: { events: 10, state: 6, presence: 2 },
      replayedPages: { events: 2, state: 1, presence: 1 },
    });

    telemetryModule.recordDurableHydrationAttempt();
    telemetryModule.recordDurableHydrationSuccess({
      durationMs: 80,
      replayedItems: { events: 4, state: 2, presence: 0 },
      replayedPages: { events: 1, state: 1, presence: 0 },
    });

    telemetryModule.recordDurableHydrationAttempt();
    telemetryModule.recordDurableHydrationMiss(15);

    telemetryModule.recordDurableHydrationAttempt();
    telemetryModule.recordDurableHydrationFailure(30);

    const telemetry = telemetryModule.getAiSessionTelemetry();

    expect(telemetry.durableHydration.attempts).toBe(4);
    expect(telemetry.durableHydration.successes).toBe(2);
    expect(telemetry.durableHydration.totalDurationMs).toBe(200);

    expect(telemetry.durableHydrationDerived.successRate).toBe(0.5);
    expect(telemetry.durableHydrationDerived.missRate).toBe(0.25);
    expect(telemetry.durableHydrationDerived.failureRate).toBe(0.25);
    expect(telemetry.durableHydrationDerived.averageSuccessDurationMs).toBe(100);

    expect(telemetry.durableHydrationDerived.replayedItemsPerSuccess).toEqual({
      events: 7,
      state: 4,
      presence: 1,
    });

    expect(telemetry.durableHydrationDerived.replayedPagesPerSuccess).toEqual({
      events: 1.5,
      state: 1,
      presence: 0.5,
    });

    expect(telemetry.durableHydrationDerived.replayedItemsPerPage).toEqual({
      events: 14 / 3,
      state: 4,
      presence: 2,
    });
  });

  it('returns zeroed derived metrics without hydration attempts', () => {
    const telemetry = telemetryModule.getAiSessionTelemetry();

    expect(telemetry.durableHydrationDerived).toEqual({
      successRate: 0,
      missRate: 0,
      failureRate: 0,
      averageSuccessDurationMs: 0,
      replayedItemsPerSuccess: { events: 0, state: 0, presence: 0 },
      replayedPagesPerSuccess: { events: 0, state: 0, presence: 0 },
      replayedItemsPerPage: { events: 0, state: 0, presence: 0 },
    });
  });
});
