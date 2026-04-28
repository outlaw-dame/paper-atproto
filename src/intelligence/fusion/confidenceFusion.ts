// ─── Fusion — Confidence Fusion ───────────────────────────────────────────
// Centralizes weighted score fusion for:
//   • Composer UI states
//   • Thread role/usefulness shaping
//   • Later stance/coverage/entity algorithm inputs
//
// All fusion here is explicit and documented — no hidden model magic.
// The fusion weights are intentionally conservative to avoid overconfidence.
//
// Design constraints:
//   • Pure functions — no I/O, no randomness.
//   • Fail-closed on any error.
//   • All outputs clamped to [0, 1].
//   • Weights must sum to 1 within each formula.

import type { NormalizedSentiment, NormalizedTone, NormalizedAbuse, NormalizedQuality } from './normalizeModelOutputs';
import type { DisagreementResult } from './disagreementDetection';
import { clamp01 } from '../context/limits';
import { applyDisagreementPenalty } from './disagreementDetection';

// ─── Types ────────────────────────────────────────────────────────────────

export interface FusedCommentSignal {
  /**
   * Final fused usefulness score [0, 1].
   * Combines quality, tone constructiveness, source evidence, and low toxicity.
   */
  usefulnessScore: number;
  /**
   * Heat contribution [0, 1].
   * High when tone is hostile or toxicity is elevated.
   */
  heatContribution: number;
  /**
   * Evidence signal strength [0, 1].
   * Derived from quality specificity and source signals.
   */
  evidenceStrength: number;
  /**
   * Whether the fused signal is reliable enough to act on.
   * False when disagreement is too high.
   */
  isReliable: boolean;
}

export interface FusedThreadSignal {
  /**
   * Overall thread usefulness [0, 1].
   */
  threadUsefulness: number;
  /**
   * Overall thread heat [0, 1].
   */
  threadHeat: number;
  /**
   * Whether the thread is interpretable [0, 1].
   */
  interpretability: number;
  /**
   * Recommended confidence multiplier [0, 1] to apply before model invocation.
   */
  confidenceMultiplier: number;
}

// ─── fuseCommentSignals ───────────────────────────────────────────────────

/**
 * Fuse model outputs for a single comment into a unified signal set.
 *
 * @param quality     — normalized quality output
 * @param tone        — normalized tone output
 * @param abuse       — normalized abuse output
 * @param sourceScore — heuristic source quality [0, 1]
 * @param disagreement — cross-model disagreement result
 *
 * Never throws — returns safe defaults on error.
 */
export function fuseCommentSignals(
  quality: NormalizedQuality,
  tone: NormalizedTone,
  abuse: NormalizedAbuse,
  sourceScore: number,
  disagreement: DisagreementResult,
): FusedCommentSignal {
  const zero: FusedCommentSignal = {
    usefulnessScore: 0,
    heatContribution: 0,
    evidenceStrength: 0,
    isReliable: false,
  };

  try {
    const src = clamp01(sourceScore);

    // Usefulness formula:
    //   0.40 × overall quality
    //   0.25 × constructive tone
    //   0.20 × source score
    //   0.15 × low abuse (inverted)
    const rawUsefulness = clamp01(
      0.40 * quality.overallQuality +
      0.25 * tone.constructive +
      0.20 * src +
      0.15 * (1 - abuse.abuseScore),
    );

    const usefulnessScore = applyDisagreementPenalty(
      rawUsefulness,
      disagreement.confidencePenalty,
    );

    // Heat:
    //   0.60 × hostile tone
    //   0.40 × abuse score
    const heatContribution = clamp01(
      0.60 * tone.hostile +
      0.40 * abuse.abuseScore,
    );

    // Evidence strength:
    //   0.50 × quality specificity
    //   0.50 × source score
    const evidenceStrength = clamp01(
      0.50 * quality.specificity +
      0.50 * src,
    );

    const isReliable = !disagreement.shouldFallback &&
      disagreement.disagreementLevel < 0.40;

    return { usefulnessScore, heatContribution, evidenceStrength, isReliable };
  } catch {
    return zero;
  }
}

// ─── fuseThreadSignals ────────────────────────────────────────────────────

/**
 * Aggregate fused comment signals across a thread into a single thread-level signal.
 *
 * @param commentSignals — array of FusedCommentSignal, one per reply
 * @param heuristicRepetitionLevel — repetition level [0, 1] from InterpolatorState
 * @param heuristicHeat — heat level [0, 1] from InterpolatorState
 *
 * Never throws — returns safe defaults on error.
 */
export function fuseThreadSignals(
  commentSignals: FusedCommentSignal[],
  heuristicRepetitionLevel: number,
  heuristicHeat: number,
): FusedThreadSignal {
  const safe: FusedThreadSignal = {
    threadUsefulness: 0,
    threadHeat: 0,
    interpretability: 0,
    confidenceMultiplier: 0.50,
  };

  if (!commentSignals?.length) return safe;

  try {
    const n = commentSignals.length;
    const avgUsefulness = clamp01(
      commentSignals.reduce((s, c) => s + c.usefulnessScore, 0) / n,
    );
    const avgHeat = clamp01(
      commentSignals.reduce((s, c) => s + c.heatContribution, 0) / n,
    );
    const reliableCount = commentSignals.filter(c => c.isReliable).length;
    const reliableFraction = clamp01(reliableCount / n);

    // Thread heat blends ML signal with heuristic
    const threadHeat = clamp01(
      avgHeat * 0.60 + clamp01(heuristicHeat) * 0.40,
    );

    // Thread usefulness penalized by repetition
    const threadUsefulness = clamp01(
      avgUsefulness * (1 - clamp01(heuristicRepetitionLevel) * 0.30),
    );

    // Interpretability: fraction of reliable signals + useful evidence
    const avgEvidence = clamp01(
      commentSignals.reduce((s, c) => s + c.evidenceStrength, 0) / n,
    );
    const interpretability = clamp01(
      reliableFraction * 0.50 + avgEvidence * 0.30 + threadUsefulness * 0.20,
    );

    // Confidence multiplier: applied before sending to model
    const confidenceMultiplier = clamp01(
      interpretability * 0.60 + reliableFraction * 0.40,
    );

    return { threadUsefulness, threadHeat, interpretability, confidenceMultiplier };
  } catch {
    return safe;
  }
}

// ─── calibrateConfidence ─────────────────────────────────────────────────

/**
 * Calibrate a raw confidence score using Platt scaling approximation.
 * Used when raw model confidence is known to be over- or under-calibrated.
 *
 * @param raw — raw model confidence [0, 1]
 * @param slope — calibration slope (default 1 = no change)
 * @param intercept — calibration intercept (default 0)
 */
export function calibrateConfidence(
  raw: number,
  slope = 1.0,
  intercept = 0.0,
): number {
  try {
    // Platt scaling: p_cal = 1 / (1 + exp(-(A * raw + B)))
    const logit = slope * clamp01(raw) + intercept;
    return clamp01(1 / (1 + Math.exp(-logit * 4))); // *4 sharpens the sigmoid slightly
  } catch {
    return clamp01(raw);
  }
}

// ─── weightedAverage ─────────────────────────────────────────────────────

/**
 * Compute a weighted average of score-weight pairs.
 * Weights need not sum to 1 — they are normalized internally.
 * Returns 0 on empty or invalid input.
 */
export function weightedAverage(
  pairs: Array<{ score: number; weight: number }>,
): number {
  if (!pairs?.length) return 0;
  try {
    let weightedSum = 0;
    let totalWeight = 0;
    for (const { score, weight } of pairs) {
      const s = clamp01(Number.isFinite(score) ? score : 0);
      const w = Math.max(0, Number.isFinite(weight) ? weight : 0);
      weightedSum += s * w;
      totalWeight += w;
    }
    return totalWeight > 0 ? clamp01(weightedSum / totalWeight) : 0;
  } catch {
    return 0;
  }
}
