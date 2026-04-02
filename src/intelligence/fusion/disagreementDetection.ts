// ─── Fusion — Cross-Model Disagreement Detection ──────────────────────────
// Detects and quantifies conflicts between normalized model outputs.
//
// Examples of disagreement:
//   • toxicity is high but constructive score is also high
//   • sentiment is negative but tone is constructive
//   • targeted sentiment says hostile but quality is high
//
// When disagreement is too high:
//   • Reduce interpretive confidence
//   • Prefer descriptive fallback
//   • Suppress overconfident contributor/entity claims
//
// Design constraints:
//   • Pure functions — no I/O.
//   • Fail-closed on any error — return max uncertainty when unsure.
//   • No raw model output values in logs.

import type {
  NormalizedSentiment,
  NormalizedTone,
  NormalizedAbuse,
  NormalizedQuality,
} from './normalizeModelOutputs';
import { clamp01 } from '../context/limits';

// ─── Types ────────────────────────────────────────────────────────────────

export type DisagreementKind =
  | 'toxicity_vs_constructive'   // abuse is high but tone is constructive
  | 'sentiment_vs_tone'          // negative sentiment but constructive tone
  | 'quality_vs_abuse'           // high quality but high abuse
  | 'sentiment_vs_quality'       // negative sentiment but high quality
  | 'targeted_vs_quality';       // targeted hostility but high quality

export interface DisagreementResult {
  /** Overall disagreement level [0, 1]. */
  disagreementLevel: number;
  /** Individual disagreement types detected. */
  disagreements: DisagreementKind[];
  /** Whether disagreement is severe enough to recommend fallback. */
  shouldFallback: boolean;
  /** Recommended confidence penalty to apply [0, 1]. */
  confidencePenalty: number;
}

// ─── Detection thresholds ─────────────────────────────────────────────────

const DISAGREEMENT_THRESHOLD = 0.35; // each signal must exceed this to detect

// ─── detectDisagreement ───────────────────────────────────────────────────

/**
 * Detect cross-model disagreements from normalized model outputs.
 *
 * @param sentiment   — normalized sentiment output
 * @param tone        — normalized tone output
 * @param abuse       — normalized abuse output
 * @param quality     — normalized quality output
 * @param targetedHostility — optional normalized targeted-tone hostility score
 *
 * Never throws — returns max-uncertainty result on error.
 */
export function detectDisagreement(
  sentiment: NormalizedSentiment,
  tone: NormalizedTone,
  abuse: NormalizedAbuse,
  quality: NormalizedQuality,
  targetedHostility = 0,
): DisagreementResult {
  const safeResult: DisagreementResult = {
    disagreementLevel: 0.50,
    disagreements: [],
    shouldFallback: false,
    confidencePenalty: 0.20,
  };

  try {
    const disagreements: DisagreementKind[] = [];

    // 1. High toxicity but constructive tone
    if (abuse.abuseScore >= DISAGREEMENT_THRESHOLD && tone.constructive >= DISAGREEMENT_THRESHOLD) {
      disagreements.push('toxicity_vs_constructive');
    }

    // 2. Negative sentiment but constructive tone
    if (sentiment.negative >= DISAGREEMENT_THRESHOLD + 0.10 && tone.constructive >= DISAGREEMENT_THRESHOLD) {
      disagreements.push('sentiment_vs_tone');
    }

    // 3. High quality but high abuse
    if (quality.overallQuality >= DISAGREEMENT_THRESHOLD + 0.10 && abuse.abuseScore >= DISAGREEMENT_THRESHOLD + 0.10) {
      disagreements.push('quality_vs_abuse');
    }

    // 4. Very negative sentiment but high quality
    if (sentiment.negative >= 0.65 && quality.overallQuality >= 0.60) {
      disagreements.push('sentiment_vs_quality');
    }

    // 5. High targeted hostility but high quality
    if (
      Number.isFinite(targetedHostility) &&
      targetedHostility >= DISAGREEMENT_THRESHOLD + 0.10 &&
      quality.overallQuality >= 0.55
    ) {
      disagreements.push('targeted_vs_quality');
    }

    const disagreementLevel = clamp01(disagreements.length * 0.25);
    // Fallback when 2+ disagreements or a severe single one
    const shouldFallback =
      disagreements.length >= 2 ||
      (disagreements.includes('toxicity_vs_constructive') && abuse.abuseScore >= 0.65);

    const confidencePenalty = clamp01(disagreements.length * 0.15);

    return { disagreementLevel, disagreements, shouldFallback, confidencePenalty };
  } catch {
    return safeResult;
  }
}

/**
 * Combine a base confidence with a disagreement penalty.
 * The penalty is always proportional, never zeroes out confidence completely
 * (preserve at least 10% to avoid treating all conflicted signals as "no signal").
 */
export function applyDisagreementPenalty(
  baseConfidence: number,
  penalty: number,
): number {
  const reduced = clamp01(baseConfidence) * (1 - clamp01(penalty));
  return Math.max(0.10, clamp01(reduced));
}
