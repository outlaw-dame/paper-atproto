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
  totalWriterAttempts: number;
  overallModelSuccessRate: number;
  overallFallbackRate: number;
  stageTimings: Record<string, StageTimingAccumulator>;
}

// ─── State ────────────────────────────────────────────────────────────────

const MODES: SummaryMode[] = ['normal', 'descriptive_fallback', 'minimal_fallback'];

const modeState: Record<SummaryMode, ModeAccumulator> = {
  normal: zeroAccumulator(),
  descriptive_fallback: zeroAccumulator(),
  minimal_fallback: zeroAccumulator(),
};

const gate: GateAccumulator = { passed: 0, skipped: 0 };
const stageTimings = new Map<string, StageTimingAccumulator>();

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

function publish(): void {
  if (typeof window === 'undefined') return;
  try {
    (window as Window & { __GLYMPSE_INTERPOLATOR_METRICS__?: InterpolatorMetricsSnapshot })
      .__GLYMPSE_INTERPOLATOR_METRICS__ = getInterpolatorMetricsSnapshot();
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
    totalWriterAttempts,
    overallModelSuccessRate: totalWriterAttempts > 0 ? totalModelCount / totalWriterAttempts : 0,
    overallFallbackRate: totalWriterAttempts > 0 ? totalFallbackCount / totalWriterAttempts : 0,
    stageTimings: stageTimingSnapshot,
  };
}
