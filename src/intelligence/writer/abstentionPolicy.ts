// ─── Writer — Abstention Policy ───────────────────────────────────────────
// Decides when the writer should abstain from making confident interpretive
// claims, and what fallback language to use instead.
//
// This module is specific to the writer layer (post-model output).
// The fusion/abstention module handles pre-model signal abstention.
//
// Design constraints:
//   • Pure functions — no I/O.
//   • Fail-closed: on any error, recommend abstention.

import type { ThreadStateForWriter, InterpolatorWriteResult } from '../llmContracts';
import { FORMING_PHRASES, UNCERTAINTY_PHRASES } from './styleGuide';

// ─── Types ────────────────────────────────────────────────────────────────

export interface WriterAbstentionDecision {
  /** True if the writer should not produce interpretive claims. */
  abstain: boolean;
  /** Human-readable reason (for diagnostics only). */
  reason: string;
  /** Suggested hedge phrase to append to the summary. */
  hedgePhrase: string;
  /** True if naming specific contributors should be suppressed. */
  suppressNaming: boolean;
}

// ─── Thresholds ───────────────────────────────────────────────────────────

const SPARSE_REPLY_THRESHOLD = 2;
const LOW_CONFIDENCE_THRESHOLD = 0.25;
const LOW_SURFACE_THRESHOLD = 0.30;

// ─── evaluateWriterAbstention ─────────────────────────────────────────────

/**
 * Evaluate whether the writer should abstain from confident claims,
 * based on the ThreadStateForWriter.
 *
 * Called before deciding to use the writer model or the deterministic fallback.
 * Never throws — returns "should abstain" on error.
 */
export function evaluateWriterAbstention(
  input: ThreadStateForWriter,
): WriterAbstentionDecision {
  const safe: WriterAbstentionDecision = {
    abstain: true,
    reason: 'error-fallback',
    hedgePhrase: FORMING_PHRASES[0]!,
    suppressNaming: true,
  };

  try {
    const replyCount = input.visibleReplyCount ?? input.selectedComments.length;
    const ic = input.confidence.interpretiveConfidence;
    const sc = input.confidence.surfaceConfidence;
    const mode = input.summaryMode;

    // Sparse thread
    if (replyCount < SPARSE_REPLY_THRESHOLD) {
      return {
        abstain: false, // still produce output, but hedge
        reason: 'sparse-thread',
        hedgePhrase: FORMING_PHRASES[Math.floor(Math.random() * FORMING_PHRASES.length)]!,
        suppressNaming: true,
      };
    }

    // Low interpretive confidence
    if (ic < LOW_CONFIDENCE_THRESHOLD) {
      return {
        abstain: false,
        reason: `low-interpretive-confidence:${ic.toFixed(2)}`,
        hedgePhrase: UNCERTAINTY_PHRASES[0]!,
        suppressNaming: ic < 0.15,
      };
    }

    // Low surface confidence — use minimal fallback phrasing
    if (sc < LOW_SURFACE_THRESHOLD && mode === 'minimal_fallback') {
      return {
        abstain: false,
        reason: `low-surface-confidence:${sc.toFixed(2)}`,
        hedgePhrase: 'Limited thread data available.',
        suppressNaming: true,
      };
    }

    return {
      abstain: false,
      reason: 'ok',
      hedgePhrase: '',
      suppressNaming: false,
    };
  } catch {
    return safe;
  }
}

/**
 * Apply a hedge phrase to a model-produced summary if warranted.
 * Returns the summary unchanged if no hedge is needed.
 */
export function applyHedgePhrase(
  summary: string,
  hedgePhrase: string,
): string {
  if (!hedgePhrase || !summary) return summary;
  const trimmed = summary.trim();
  if (trimmed.toLowerCase().includes(hedgePhrase.toLowerCase().slice(0, 20))) {
    return trimmed; // already contains it
  }
  return `${trimmed} ${hedgePhrase}`.trim();
}

/**
 * True if the writer result indicates the model abstained with no content.
 */
export function isEmptyAbstention(result: InterpolatorWriteResult): boolean {
  return result.abstained === true && !result.collapsedSummary?.trim();
}
