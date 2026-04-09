// ─── Interpolator Telemetry — Narwhal v3 ──────────────────────────────────
// Tracks per-session summary-mode distribution, writer-outcome ratios, and
// quality-gate decisions.
//
// All counters are in-memory and session-scoped (cleared on page reload).
// Exposed on window.__GLYMPSE_INTERPOLATOR_METRICS__ for dashboard/debugging.
// Never emits user content — only numeric counters and computed ratios.
//
// Design constraints:
//   • No I/O — pure in-memory accumulation.
//   • Never throws — all recording functions are fire-and-forget.
//   • No user-identifiable data in any bucket key or label.

import type { SummaryMode, ConfidenceState } from '../intelligence/llmContracts';

// ─── Types ────────────────────────────────────────────────────────────────

type Outcome = 'model' | 'fallback';

interface ModeAccumulator {
  /** How many threads were routed to this mode (including gate-skipped). */
  count: number;
  /** Writer returned a live model result. */
  modelCount: number;
  /** Writer returned a deterministic fallback. */
  fallbackCount: number;
  /** Running sum of surfaceConfidence for avg computation. */
  surfaceConfidenceSum: number;
  /** Running sum of interpretiveConfidence for avg computation. */
  interpretiveConfidenceSum: number;
}

interface GateAccumulator {
  /** Threads that passed the quality gate and called the model. */
  passed: number;
  /** Threads that were skipped at the gate (insufficient signal / forced fallback). */
  skipped: number;
}

interface StageTimingAccumulator {
  count: number;
  totalMs: number;
  maxMs: number;
  lastMs: number;
}

interface DeltaAccumulator {
  resolutionCount: number;
  reusedStoredCount: number;
  rebuiltCount: number;
  selfHealCount: number;
  summaryFallbackCount: number;
}

interface WatchAccumulator {
  currentState: 'idle' | 'connecting' | 'ready' | 'retrying' | 'closed';
  connectionAttempts: number;
  readyCount: number;
  invalidationCount: number;
  degradedCount: number;
  reconnectCount: number;
  closedCount: number;
  lastReadyAt: string | null;
  lastInvalidationAt: string | null;
  lastStatusCode: string | null;
}

interface HydrationPhaseAccumulator {
  attempts: number;
  successes: number;
  failures: number;
}

interface HydrationAccumulator {
  phases: Record<'initial' | 'poll' | 'event', HydrationPhaseAccumulator>;
  lastPhase: 'initial' | 'poll' | 'event' | null;
  lastOutcome: 'success' | 'failure' | null;
}

export interface InterpolatorModeMetrics {
  count: number;
  modelRate: number;
  fallbackRate: number;
  avgSurfaceConfidence: number;
  avgInterpretiveConfidence: number;
}

export interface InterpolatorMetricsSnapshot {
  modes: Record<SummaryMode, InterpolatorModeMetrics>;
  gate: GateAccumulator;
  delta: {
    resolutionCount: number;
    storedReuseCount: number;
    rebuiltCount: number;
    selfHealCount: number;
    storedReuseRate: number;
    rebuildRate: number;
    selfHealRate: number;
    summaryFallbackCount: number;
  };
  watch: {
    currentState: 'idle' | 'connecting' | 'ready' | 'retrying' | 'closed';
    connectionAttempts: number;
    readyCount: number;
    invalidationCount: number;
    degradedCount: number;
    reconnectCount: number;
    closedCount: number;
    lastReadyAt: string | null;
    lastInvalidationAt: string | null;
    lastStatusCode: string | null;
  };
  hydration: {
    phases: Record<'initial' | 'poll' | 'event', HydrationPhaseAccumulator>;
    totalAttempts: number;
    totalSuccesses: number;
    totalFailures: number;
    successRate: number;
    eventShare: number;
    pollShare: number;
    lastPhase: 'initial' | 'poll' | 'event' | null;
    lastOutcome: 'success' | 'failure' | null;
  };
  totalWriterAttempts: number;
  overallModelSuccessRate: number;
  overallFallbackRate: number;
  stageTimings: Record<string, StageTimingAccumulator>;
}

// ─── State ────────────────────────────────────────────────────────────────

const MODES: SummaryMode[] = ['normal', 'descriptive_fallback', 'minimal_fallback'];
const INTERPOLATOR_METRICS_EVENT = 'glympse:interpolator-metrics';

const modeState: Record<SummaryMode, ModeAccumulator> = {
  normal: zeroAccumulator(),
  descriptive_fallback: zeroAccumulator(),
  minimal_fallback: zeroAccumulator(),
};

const gate: GateAccumulator = { passed: 0, skipped: 0 };
const deltaState: DeltaAccumulator = {
  resolutionCount: 0,
  reusedStoredCount: 0,
  rebuiltCount: 0,
  selfHealCount: 0,
  summaryFallbackCount: 0,
};
const watchState: WatchAccumulator = {
  currentState: 'idle',
  connectionAttempts: 0,
  readyCount: 0,
  invalidationCount: 0,
  degradedCount: 0,
  reconnectCount: 0,
  closedCount: 0,
  lastReadyAt: null,
  lastInvalidationAt: null,
  lastStatusCode: null,
};
const hydrationState: HydrationAccumulator = {
  phases: {
    initial: { attempts: 0, successes: 0, failures: 0 },
    poll: { attempts: 0, successes: 0, failures: 0 },
    event: { attempts: 0, successes: 0, failures: 0 },
  },
  lastPhase: null,
  lastOutcome: null,
};
const stageTimings = new Map<string, StageTimingAccumulator>();
const summaryFallbackKeys = new Set<string>();
const summaryFallbackKeyOrder: string[] = [];

// ─── Internal helpers ─────────────────────────────────────────────────────

function zeroAccumulator(): ModeAccumulator {
  return {
    count: 0,
    modelCount: 0,
    fallbackCount: 0,
    surfaceConfidenceSum: 0,
    interpretiveConfidenceSum: 0,
  };
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}

function buildModeMetrics(acc: ModeAccumulator): InterpolatorModeMetrics {
  const writerAttempts = acc.modelCount + acc.fallbackCount;
  return {
    count: acc.count,
    modelRate: writerAttempts > 0 ? acc.modelCount / writerAttempts : 0,
    fallbackRate: writerAttempts > 0 ? acc.fallbackCount / writerAttempts : 0,
    avgSurfaceConfidence: acc.count > 0 ? acc.surfaceConfidenceSum / acc.count : 0,
    avgInterpretiveConfidence: acc.count > 0 ? acc.interpretiveConfidenceSum / acc.count : 0,
  };
}

function buildDeltaMetrics() {
  return {
    resolutionCount: deltaState.resolutionCount,
    storedReuseCount: deltaState.reusedStoredCount,
    rebuiltCount: deltaState.rebuiltCount,
    selfHealCount: deltaState.selfHealCount,
    storedReuseRate: deltaState.resolutionCount > 0
      ? deltaState.reusedStoredCount / deltaState.resolutionCount
      : 0,
    rebuildRate: deltaState.resolutionCount > 0
      ? deltaState.rebuiltCount / deltaState.resolutionCount
      : 0,
    selfHealRate: deltaState.resolutionCount > 0
      ? deltaState.selfHealCount / deltaState.resolutionCount
      : 0,
    summaryFallbackCount: deltaState.summaryFallbackCount,
  };
}

function buildHydrationMetrics() {
  const totalAttempts = hydrationState.phases.initial.attempts
    + hydrationState.phases.poll.attempts
    + hydrationState.phases.event.attempts;
  const totalSuccesses = hydrationState.phases.initial.successes
    + hydrationState.phases.poll.successes
    + hydrationState.phases.event.successes;
  const totalFailures = hydrationState.phases.initial.failures
    + hydrationState.phases.poll.failures
    + hydrationState.phases.event.failures;

  return {
    phases: {
      initial: { ...hydrationState.phases.initial },
      poll: { ...hydrationState.phases.poll },
      event: { ...hydrationState.phases.event },
    },
    totalAttempts,
    totalSuccesses,
    totalFailures,
    successRate: totalAttempts > 0 ? totalSuccesses / totalAttempts : 0,
    eventShare: totalAttempts > 0 ? hydrationState.phases.event.attempts / totalAttempts : 0,
    pollShare: totalAttempts > 0 ? hydrationState.phases.poll.attempts / totalAttempts : 0,
    lastPhase: hydrationState.lastPhase,
    lastOutcome: hydrationState.lastOutcome,
  };
}

function normalizeMetricKey(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 160);
}

function normalizeTelemetryCode(value: string | null | undefined, maxLength = 64): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, maxLength);
  return normalized || null;
}

function publish(): void {
  if (typeof window === 'undefined') return;
  try {
    const snapshot = getInterpolatorMetricsSnapshot();
    (window as Window & { __GLYMPSE_INTERPOLATOR_METRICS__?: InterpolatorMetricsSnapshot })
      .__GLYMPSE_INTERPOLATOR_METRICS__ = snapshot;
    window.dispatchEvent(new CustomEvent<InterpolatorMetricsSnapshot>(INTERPOLATOR_METRICS_EVENT, {
      detail: snapshot,
    }));
  } catch {
    // publish is best-effort; never throw
  }
}

// ─── Public recording API ─────────────────────────────────────────────────

/**
 * Record the quality-gate decision for a thread.
 * Call once per thread, immediately after shouldRunInterpolatorWriter().
 */
export function recordInterpolatorGateDecision(passed: boolean): void {
  try {
    if (passed) gate.passed += 1;
    else gate.skipped += 1;
    publish();
  } catch {
    /* best-effort */
  }
}

/**
 * Record which summary mode was chosen for a thread, along with its confidence.
 * Call once per thread when mode is known (after buildThreadStateForWriter or chooseSummaryMode).
 */
export function recordInterpolatorModeDecision(
  mode: SummaryMode,
  confidence: ConfidenceState,
): void {
  try {
    const acc = modeState[mode];
    if (!acc) return;

    acc.count += 1;
    acc.surfaceConfidenceSum += clamp01(confidence.surfaceConfidence);
    acc.interpretiveConfidenceSum += clamp01(confidence.interpretiveConfidence);
    publish();
  } catch {
    /* best-effort */
  }
}

/**
 * Record whether the writer model was used or the deterministic fallback was applied.
 * Call once per writer invocation, after the result is determined.
 */
export function recordInterpolatorWriterOutcome(
  mode: SummaryMode,
  outcome: Outcome,
): void {
  try {
    const acc = modeState[mode];
    if (!acc) return;

    if (outcome === 'model') acc.modelCount += 1;
    else acc.fallbackCount += 1;
    publish();
  } catch {
    /* best-effort */
  }
}

export function recordInterpolatorDeltaResolution(params: {
  usedStored: boolean;
  selfHealed: boolean;
}): void {
  try {
    deltaState.resolutionCount += 1;
    if (params.usedStored) {
      deltaState.reusedStoredCount += 1;
    } else {
      deltaState.rebuiltCount += 1;
    }
    if (params.selfHealed) {
      deltaState.selfHealCount += 1;
    }
    publish();
  } catch {
    /* best-effort */
  }
}

export function recordInterpolatorSummaryProjectionFallback(key: string): void {
  try {
    const normalizedKey = normalizeMetricKey(key);
    if (!normalizedKey || summaryFallbackKeys.has(normalizedKey)) return;

    summaryFallbackKeys.add(normalizedKey);
    summaryFallbackKeyOrder.push(normalizedKey);
    deltaState.summaryFallbackCount += 1;

    while (summaryFallbackKeyOrder.length > 200) {
      const oldest = summaryFallbackKeyOrder.shift();
      if (oldest) {
        summaryFallbackKeys.delete(oldest);
      }
    }
    publish();
  } catch {
    /* best-effort */
  }
}

export function recordConversationWatchConnectionState(
  state: WatchAccumulator['currentState'],
  options?: { observedAt?: string; code?: string | null },
): void {
  try {
    watchState.currentState = state;
    watchState.lastStatusCode = normalizeTelemetryCode(options?.code) ?? watchState.lastStatusCode;

    if (state === 'connecting') {
      watchState.connectionAttempts += 1;
    } else if (state === 'ready') {
      watchState.readyCount += 1;
      watchState.lastReadyAt = normalizeTelemetryCode(options?.observedAt, 64) ?? new Date().toISOString();
      watchState.lastStatusCode = null;
    } else if (state === 'retrying') {
      watchState.reconnectCount += 1;
    } else if (state === 'closed') {
      watchState.closedCount += 1;
    }
    publish();
  } catch {
    /* best-effort */
  }
}

export function recordConversationWatchStatus(params: {
  state: 'degraded' | 'reconnect';
  code?: string | null | undefined;
}): void {
  try {
    if (params.state === 'degraded') {
      watchState.degradedCount += 1;
    } else {
      watchState.reconnectCount += 1;
      watchState.currentState = 'retrying';
    }
    watchState.lastStatusCode = normalizeTelemetryCode(params.code) ?? watchState.lastStatusCode;
    publish();
  } catch {
    /* best-effort */
  }
}

export function recordConversationWatchInvalidation(observedAt?: string): void {
  try {
    watchState.invalidationCount += 1;
    watchState.lastInvalidationAt = normalizeTelemetryCode(observedAt, 64) ?? new Date().toISOString();
    publish();
  } catch {
    /* best-effort */
  }
}

export function recordConversationHydrationRun(params: {
  phase: 'initial' | 'poll' | 'event';
  outcome: 'success' | 'failure';
}): void {
  try {
    const phaseState = hydrationState.phases[params.phase];
    phaseState.attempts += 1;
    if (params.outcome === 'success') {
      phaseState.successes += 1;
    } else {
      phaseState.failures += 1;
    }
    hydrationState.lastPhase = params.phase;
    hydrationState.lastOutcome = params.outcome;
    publish();
  } catch {
    /* best-effort */
  }
}

/**
 * Record a stage duration in milliseconds for coarse-grained performance tracing.
 * Stage keys are caller-defined and intentionally free-form.
 */
export function recordInterpolatorStageTiming(stage: string, durationMs: number): void {
  try {
    if (typeof stage !== 'string') return;
    const key = stage.trim().slice(0, 80);
    if (!key) return;
    const duration = Number(durationMs);
    if (!Number.isFinite(duration) || duration < 0) return;

    const current = stageTimings.get(key) ?? {
      count: 0,
      totalMs: 0,
      maxMs: 0,
      lastMs: 0,
    };

    current.count += 1;
    current.totalMs += duration;
    current.maxMs = Math.max(current.maxMs, duration);
    current.lastMs = duration;
    stageTimings.set(key, current);
    publish();
  } catch {
    /* best-effort */
  }
}

// ─── Snapshot ─────────────────────────────────────────────────────────────

export function getInterpolatorMetricsSnapshot(): InterpolatorMetricsSnapshot {
  let totalModelCount = 0;
  let totalFallbackCount = 0;

  const modes = {} as Record<SummaryMode, InterpolatorModeMetrics>;
  for (const mode of MODES) {
    const acc = modeState[mode];
    modes[mode] = buildModeMetrics(acc);
    totalModelCount += acc.modelCount;
    totalFallbackCount += acc.fallbackCount;
  }

  const totalWriterAttempts = totalModelCount + totalFallbackCount;
  const stageTimingSnapshot = Object.fromEntries(stageTimings.entries());

  return {
    modes,
    gate: { ...gate },
    delta: buildDeltaMetrics(),
    watch: { ...watchState },
    hydration: buildHydrationMetrics(),
    totalWriterAttempts,
    overallModelSuccessRate: totalWriterAttempts > 0 ? totalModelCount / totalWriterAttempts : 0,
    overallFallbackRate: totalWriterAttempts > 0 ? totalFallbackCount / totalWriterAttempts : 0,
    stageTimings: stageTimingSnapshot,
  };
}

export function subscribeInterpolatorMetrics(
  listener: (snapshot: InterpolatorMetricsSnapshot) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<InterpolatorMetricsSnapshot>;
    listener(customEvent.detail ?? getInterpolatorMetricsSnapshot());
  };

  window.addEventListener(INTERPOLATOR_METRICS_EVENT, handler as EventListener);

  try {
    listener(
      (window as Window & { __GLYMPSE_INTERPOLATOR_METRICS__?: InterpolatorMetricsSnapshot })
        .__GLYMPSE_INTERPOLATOR_METRICS__ ?? getInterpolatorMetricsSnapshot(),
    );
  } catch {
    // listener is user-land; swallow to preserve telemetry pipeline
  }

  return () => {
    window.removeEventListener(INTERPOLATOR_METRICS_EVENT, handler as EventListener);
  };
}

export function resetInterpolatorTelemetryForTests(): void {
  for (const mode of MODES) {
    modeState[mode] = zeroAccumulator();
  }
  gate.passed = 0;
  gate.skipped = 0;
  deltaState.resolutionCount = 0;
  deltaState.reusedStoredCount = 0;
  deltaState.rebuiltCount = 0;
  deltaState.selfHealCount = 0;
  deltaState.summaryFallbackCount = 0;
  watchState.currentState = 'idle';
  watchState.connectionAttempts = 0;
  watchState.readyCount = 0;
  watchState.invalidationCount = 0;
  watchState.degradedCount = 0;
  watchState.reconnectCount = 0;
  watchState.closedCount = 0;
  watchState.lastReadyAt = null;
  watchState.lastInvalidationAt = null;
  watchState.lastStatusCode = null;
  hydrationState.phases.initial = { attempts: 0, successes: 0, failures: 0 };
  hydrationState.phases.poll = { attempts: 0, successes: 0, failures: 0 };
  hydrationState.phases.event = { attempts: 0, successes: 0, failures: 0 };
  hydrationState.lastPhase = null;
  hydrationState.lastOutcome = null;
  stageTimings.clear();
  summaryFallbackKeys.clear();
  summaryFallbackKeyOrder.length = 0;
}
