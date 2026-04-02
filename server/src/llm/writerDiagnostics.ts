type WriterClientOutcome = 'model' | 'fallback';

export type WriterClientReason =
  | 'success'
  | 'abstained-response-fallback'
  | 'root-only-response-fallback'
  | 'failure-fallback';

type WriterDiagnosticsState = {
  startedAt: string;
  lastUpdatedAt: string;
  telemetryEvents: number;
  clientOutcomeCounts: Record<WriterClientOutcome, number>;
  fallbackReasonCounts: Record<Exclude<WriterClientReason, 'success'>, number>;
  safetyFilter: {
    runs: number;
    mutated: number;
    blocked: number;
  };
};

function nowIso(): string {
  return new Date().toISOString();
}

function createInitialState(): WriterDiagnosticsState {
  const timestamp = nowIso();
  return {
    startedAt: timestamp,
    lastUpdatedAt: timestamp,
    telemetryEvents: 0,
    clientOutcomeCounts: {
      model: 0,
      fallback: 0,
    },
    fallbackReasonCounts: {
      'abstained-response-fallback': 0,
      'root-only-response-fallback': 0,
      'failure-fallback': 0,
    },
    safetyFilter: {
      runs: 0,
      mutated: 0,
      blocked: 0,
    },
  };
}

let state: WriterDiagnosticsState = createInitialState();

function safeRatio(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return Number((numerator / denominator).toFixed(4));
}

export function recordWriterClientOutcome(params: {
  outcome: WriterClientOutcome;
  reason: WriterClientReason;
}): void {
  state.telemetryEvents += 1;
  state.lastUpdatedAt = nowIso();
  state.clientOutcomeCounts[params.outcome] += 1;

  if (params.reason !== 'success') {
    state.fallbackReasonCounts[params.reason] += 1;
  }
}

export function recordWriterSafetyFilterRun(params: {
  mutated: boolean;
  blocked: boolean;
}): void {
  state.lastUpdatedAt = nowIso();
  state.safetyFilter.runs += 1;
  if (params.mutated) state.safetyFilter.mutated += 1;
  if (params.blocked) state.safetyFilter.blocked += 1;
}

export function getWriterDiagnostics(): Record<string, unknown> {
  const modelCount = state.clientOutcomeCounts.model;
  const fallbackCount = state.clientOutcomeCounts.fallback;
  const totalOutcomeCount = modelCount + fallbackCount;
  const safetyRuns = state.safetyFilter.runs;

  return {
    startedAt: state.startedAt,
    lastUpdatedAt: state.lastUpdatedAt,
    telemetryEvents: state.telemetryEvents,
    clientOutcomes: {
      model: modelCount,
      fallback: fallbackCount,
      total: totalOutcomeCount,
      modelToFallbackRatio: fallbackCount > 0
        ? Number((modelCount / fallbackCount).toFixed(4))
        : modelCount > 0 ? Number.POSITIVE_INFINITY : 0,
      fallbackRate: safeRatio(fallbackCount, totalOutcomeCount),
    },
    fallbackReasonDistribution: {
      ...state.fallbackReasonCounts,
      totalFallbacks: fallbackCount,
    },
    safetyFilter: {
      ...state.safetyFilter,
      mutationRate: safeRatio(state.safetyFilter.mutated, safetyRuns),
      blockRate: safeRatio(state.safetyFilter.blocked, safetyRuns),
    },
  };
}

export function resetWriterDiagnostics(): void {
  state = createInitialState();
}
