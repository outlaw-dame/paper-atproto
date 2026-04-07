export type HybridSearchTimeoutFallbackEvent = {
  scope: 'search' | 'searchAll' | 'searchFeedItems';
  retryDelayMs: number;
  timeoutMs: number;
  triggeredAt: string;
};

export type HybridSearchTelemetrySnapshot = {
  timeoutFallbackCount: number;
  lastTimeoutFallback: HybridSearchTimeoutFallbackEvent | null;
};

const state: HybridSearchTelemetrySnapshot = {
  timeoutFallbackCount: 0,
  lastTimeoutFallback: null,
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

export function getHybridSearchTelemetrySnapshot(): HybridSearchTelemetrySnapshot {
  return {
    timeoutFallbackCount: state.timeoutFallbackCount,
    lastTimeoutFallback: state.lastTimeoutFallback,
  };
}
