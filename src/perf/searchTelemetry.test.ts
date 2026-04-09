import { beforeEach, describe, expect, it } from 'vitest';
import {
  getHybridSearchTelemetrySnapshot,
  recordDiscoveryIntentTelemetry,
  recordDiscoveryRetryTelemetry,
  recordHybridSearchTimeoutFallback,
  resetSearchTelemetryForTests,
} from './searchTelemetry';

describe('searchTelemetry', () => {
  beforeEach(() => {
    resetSearchTelemetryForTests();
  });

  it('tracks timeout fallback events', () => {
    recordHybridSearchTimeoutFallback({
      scope: 'search',
      retryDelayMs: 120,
      timeoutMs: 2000,
    });

    const snapshot = getHybridSearchTelemetrySnapshot();
    expect(snapshot.timeoutFallbackCount).toBe(1);
    expect(snapshot.lastTimeoutFallback?.scope).toBe('search');
  });

  it('aggregates discovery intent counts', () => {
    recordDiscoveryIntentTelemetry('people');
    recordDiscoveryIntentTelemetry('people');
    recordDiscoveryIntentTelemetry('source');

    const snapshot = getHybridSearchTelemetrySnapshot();
    expect(snapshot.discoveryIntentCounts.people).toBe(2);
    expect(snapshot.discoveryIntentCounts.source).toBe(1);
  });

  it('tracks retry attempts and exhausted failures without storing query text', () => {
    recordDiscoveryRetryTelemetry({
      operation: 'searchActors',
      attempt: 1,
      maxAttempts: 3,
      statusCode: 503,
      reasonCategory: 'status',
      exhausted: false,
    });
    recordDiscoveryRetryTelemetry({
      operation: 'searchActors',
      attempt: 3,
      maxAttempts: 3,
      statusCode: 503,
      reasonCategory: 'status',
      exhausted: true,
    });

    const snapshot = getHybridSearchTelemetrySnapshot();
    expect(snapshot.discoveryRetryAttemptCount).toBe(2);
    expect(snapshot.discoveryRetryExhaustedCount).toBe(1);
    expect(snapshot.discoveryRetryOperations.searchActors).toBe(2);
    expect(snapshot.lastDiscoveryRetryEvent?.operation).toBe('searchActors');
    expect(snapshot.lastDiscoveryRetryEvent?.statusCode).toBe(503);
    expect(snapshot.lastDiscoveryRetryEvent?.reasonCategory).toBe('status');
  });
});
