// ─── Fusion — Abstention Policy ───────────────────────────────────────────
// Determines when the system should abstain from making confident claims.
//
// Abstention is appropriate when:
//   • Disagreement is too high across model outputs
//   • Confidence is below the threshold for the current summary mode
//   • The thread is too sparse or incoherent to interpret reliably
//   • Media context is ambiguous and would be needed to interpret correctly
//
// Abstention ≠ silence. The system degrades gracefully to descriptive mode
// rather than producing overconfident claims.
//
// Design constraints:
//   • Pure functions — no I/O.
//   • Fail-closed — on error, recommend abstention (safe default).

import type { SummaryMode } from '../llmContracts';
import { clamp01 } from '../context/limits';

// ─── Types ────────────────────────────────────────────────────────────────

export interface AbstentionInput {
  /** Overall disagreement level [0, 1] from detectDisagreement. */
  disagreementLevel: number;
  /** Interpretive confidence [0, 1] from computeConfidenceState. */
  interpretiveConfidence: number;
  /** Surface confidence [0, 1] from computeConfidenceState. */
  surfaceConfidence: number;
  /** Current summary mode. */
  summaryMode: SummaryMode;
  /** True if the thread has fewer than 3 visible replies. */
  isSparse: boolean;
  /** True if multimodal context is required to understand the thread. */
  requiresMediaContext: boolean;
  /** True if the root post itself is ambiguous without media. */
  rootIsAmbiguous: boolean;
}

export interface AbstentionDecision {
  /** Whether the system should abstain from interpretive claims. */
  shouldAbstain: boolean;
  /** Whether to suppress contributor/entity naming. */
  suppressNaming: boolean;
  /** Whether to add an uncertainty hedge to the summary. */
  addUncertaintyHedge: boolean;
  /** Recommended summary mode (may be downgraded from input). */
  recommendedMode: SummaryMode;
  /** Human-readable reason for abstention (for diagnostics, not shown to user). */
  reason: string;
}

// ─── Thresholds ───────────────────────────────────────────────────────────

/** Minimum interpretive confidence to produce a 'normal' summary. */
const NORMAL_INTERPRETIVE_MIN = 0.35;
/** Minimum surface confidence even for descriptive fallback. */
const DESCRIPTIVE_SURFACE_MIN = 0.30;
/** Disagreement level at which we recommend abstention. */
const DISAGREEMENT_ABSTAIN_THRESHOLD = 0.50;
/** Disagreement level at which we suppress naming. */
const DISAGREEMENT_SUPPRESS_THRESHOLD = 0.30;

// ─── evaluateAbstention ───────────────────────────────────────────────────

/**
 * Evaluate whether the system should abstain from interpretive claims.
 *
 * Never throws — returns "should abstain" on error (safest default).
 */
export function evaluateAbstention(input: AbstentionInput): AbstentionDecision {
  const safeAbstain: AbstentionDecision = {
    shouldAbstain: true,
    suppressNaming: true,
    addUncertaintyHedge: true,
    recommendedMode: 'minimal_fallback',
    reason: 'error-fallback',
  };

  try {
    const {
      disagreementLevel,
      interpretiveConfidence,
      surfaceConfidence,
      summaryMode,
      isSparse,
      requiresMediaContext,
      rootIsAmbiguous,
    } = input;

    const d = clamp01(disagreementLevel);
    const ic = clamp01(interpretiveConfidence);
    const sc = clamp01(surfaceConfidence);

    // ── Hard abstention cases ──────────────────────────────────────────────

    if (d >= DISAGREEMENT_ABSTAIN_THRESHOLD) {
      return {
        shouldAbstain: true,
        suppressNaming: true,
        addUncertaintyHedge: true,
        recommendedMode: 'descriptive_fallback',
        reason: `high-disagreement:${d.toFixed(2)}`,
      };
    }

    if (isSparse && ic < 0.25) {
      return {
        shouldAbstain: true,
        suppressNaming: false,
        addUncertaintyHedge: true,
        recommendedMode: 'minimal_fallback',
        reason: 'sparse-and-low-confidence',
      };
    }

    if (requiresMediaContext && rootIsAmbiguous) {
      return {
        shouldAbstain: true,
        suppressNaming: false,
        addUncertaintyHedge: true,
        recommendedMode: 'descriptive_fallback',
        reason: 'requires-media-context',
      };
    }

    // ── Soft degradation cases ─────────────────────────────────────────────

    const suppressNaming = d >= DISAGREEMENT_SUPPRESS_THRESHOLD || ic < 0.25;
    const addUncertaintyHedge =
      d >= 0.20 || ic < NORMAL_INTERPRETIVE_MIN || isSparse || requiresMediaContext;

    let recommendedMode: SummaryMode = summaryMode;
    if (summaryMode === 'normal' && ic < NORMAL_INTERPRETIVE_MIN) {
      recommendedMode = 'descriptive_fallback';
    }
    if (recommendedMode === 'descriptive_fallback' && sc < DESCRIPTIVE_SURFACE_MIN) {
      recommendedMode = 'minimal_fallback';
    }

    return {
      shouldAbstain: false,
      suppressNaming,
      addUncertaintyHedge,
      recommendedMode,
      reason: 'ok',
    };
  } catch {
    return safeAbstain;
  }
}

/**
 * Build the uncertainty hedge phrase appropriate for the given context.
 * Returns an empty string if no hedge is needed.
 */
export function buildUncertaintyHedge(
  mode: SummaryMode,
  reason: string,
): string {
  if (mode === 'minimal_fallback') return 'Limited thread data available.';
  if (reason.startsWith('requires-media')) return 'Visual context may be needed for full understanding.';
  if (mode === 'descriptive_fallback') return 'This is an early or developing thread.';
  return '';
}
