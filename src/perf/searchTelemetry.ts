export type HybridSearchTimeoutFallbackEvent = {
  scope: 'search' | 'searchAll' | 'searchFeedItems' | 'searchTranscriptSegments';
  retryDelayMs: number;
  timeoutMs: number;
  triggeredAt: string;
};

export type DiscoveryRetryTelemetryEvent = {
  operation: string;
  attempt: number;
  maxAttempts: number;
  statusCode: number | null;
  reasonCategory: 'status' | 'network' | 'timeout' | 'temporary' | 'unknown';
  exhausted: boolean;
  triggeredAt: string;
};

export type HybridSearchTelemetrySnapshot = {
  timeoutFallbackCount: number;
  lastTimeoutFallback: HybridSearchTimeoutFallbackEvent | null;
  discoveryIntentCounts: Record<string, number>;
  discoveryRetryAttemptCount: number;
  discoveryRetryExhaustedCount: number;
  discoveryRetryOperations: Record<string, number>;
  lastDiscoveryRetryEvent: DiscoveryRetryTelemetryEvent | null;
};

const state: HybridSearchTelemetrySnapshot = {
  timeoutFallbackCount: 0,
  lastTimeoutFallback: null,
  discoveryIntentCounts: {},
  discoveryRetryAttemptCount: 0,
  discoveryRetryExhaustedCount: 0,
  discoveryRetryOperations: {},
  lastDiscoveryRetryEvent: null,
};

type SearchTelemetryWindow = Window & {
  __GLYMPSE_HYBRID_SEARCH_METRICS__?: HybridSearchTelemetrySnapshot;
};

function publish(): void {
  if (typeof window === 'undefined') return;
  (window as SearchTelemetryWindow).__GLYMPSE_HYBRID_SEARCH_METRICS__ = getHybridSearchTelemetrySnapshot();
}

export function recordHybridSearchTimeoutFallback(event: Omit<HybridSearchTimeoutFallbackEvent, 'triggeredAt'>): void {
  state.timeoutFallbackCount += 1;
  state.lastTimeoutFallback = {
    ...event,
    triggeredAt: new Date().toISOString(),
  };
  publish();
}

function incrementCounter(counter: Record<string, number>, key: string): void {
  if (!key) return;
  counter[key] = (counter[key] ?? 0) + 1;
}

function toSafeReasonCategory(raw: string): DiscoveryRetryTelemetryEvent['reasonCategory'] {
  if (raw === 'status' || raw === 'network' || raw === 'timeout' || raw === 'temporary' || raw === 'unknown') {
    return raw;
  }
  return 'unknown';
}

export function recordDiscoveryIntentTelemetry(intentKind: string): void {
  const normalized = intentKind.trim().toLowerCase().slice(0, 24);
  if (!normalized) return;
  incrementCounter(state.discoveryIntentCounts, normalized);
  publish();
}

export function recordDiscoveryRetryTelemetry(event: {
  operation: string;
  attempt: number;
  maxAttempts: number;
  statusCode?: number | null;
  reasonCategory: string;
  exhausted: boolean;
}): void {
  const operation = event.operation.trim().slice(0, 48) || 'unknown-operation';
  const attempt = Number.isFinite(event.attempt) ? Math.max(1, Math.trunc(event.attempt)) : 1;
  const maxAttempts = Number.isFinite(event.maxAttempts) ? Math.max(attempt, Math.trunc(event.maxAttempts)) : attempt;
  const statusCode = Number.isFinite(event.statusCode) ? Number(event.statusCode) : null;
  const reasonCategory = toSafeReasonCategory(event.reasonCategory);

  state.discoveryRetryAttemptCount += 1;
  incrementCounter(state.discoveryRetryOperations, operation);
  if (event.exhausted) {
    state.discoveryRetryExhaustedCount += 1;
  }

  state.lastDiscoveryRetryEvent = {
    operation,
    attempt,
    maxAttempts,
    statusCode,
    reasonCategory,
    exhausted: Boolean(event.exhausted),
    triggeredAt: new Date().toISOString(),
  };
  publish();
}

export function getHybridSearchTelemetrySnapshot(): HybridSearchTelemetrySnapshot {
  return {
    timeoutFallbackCount: state.timeoutFallbackCount,
    lastTimeoutFallback: state.lastTimeoutFallback,
    discoveryIntentCounts: { ...state.discoveryIntentCounts },
    discoveryRetryAttemptCount: state.discoveryRetryAttemptCount,
    discoveryRetryExhaustedCount: state.discoveryRetryExhaustedCount,
    discoveryRetryOperations: { ...state.discoveryRetryOperations },
    lastDiscoveryRetryEvent: state.lastDiscoveryRetryEvent,
  };
}

export function resetSearchTelemetryForTests(): void {
  state.timeoutFallbackCount = 0;
  state.lastTimeoutFallback = null;
  state.discoveryIntentCounts = {};
  state.discoveryRetryAttemptCount = 0;
  state.discoveryRetryExhaustedCount = 0;
  state.discoveryRetryOperations = {};
  state.lastDiscoveryRetryEvent = null;
}
