// ─── Routing — Narwhal v3 ─────────────────────────────────────────────────
// Multimodal score, summary mode routing, and inclusion threshold helpers.
// All functions are pure and synchronous.

import type { SummaryMode } from './llmContracts';

// ─── Multimodal routing ───────────────────────────────────────────────────

export interface MultimodalSignals {
  /** 1 if root post or high-impact reply has image/screenshot/chart/document, else 0. */
  hasMedia: number;
  /** Estimated fraction of media that is OCR-heavy or screenshot-heavy (0–1). */
  mediaTextDensity: number;
  /** Fraction of replies that reference "this screenshot", "the image", etc. (0–1). */
  mediaReferenceDensity: number;
  /** 1 if text-only understanding would miss the core claim, else 0. */
  mediaClaimDependency: number;
  /** 1 if verification system flagged media-context risk or provenance ambiguity, else 0. */
  mediaVerificationFlag: number;
  /** How much text-only confidence is reduced by missing visual context (0–1). */
  nonTextSignalGap: number;
}

export function computeMultimodalScore(s: MultimodalSignals): number {
  return Math.max(0, Math.min(1,
    0.20 * s.hasMedia +
    0.20 * s.mediaTextDensity +
    0.20 * s.mediaReferenceDensity +
    0.20 * s.mediaClaimDependency +
    0.10 * s.mediaVerificationFlag +
    0.10 * s.nonTextSignalGap,
  ));
}

/** Returns true when Qwen3-VL should run for this thread. */
export function shouldRunMultimodal(s: MultimodalSignals): boolean {
  return computeMultimodalScore(s) >= 0.55;
}

// ─── Summary mode ─────────────────────────────────────────────────────────

/**
 * Selects the appropriate summary mode for the writer.
 *
 * normal             → full structured summary
 * descriptive_fallback → root post + observable replies + high-confidence
 *                        contributors/entities + uncertainty sentence
 * minimal_fallback   → minimal root-post summary + limited reply activity
 */
export function chooseSummaryMode(input: {
  surfaceConfidence: number;
  interpretiveConfidence: number;
}): SummaryMode {
  if (input.interpretiveConfidence < 0.45 && input.surfaceConfidence >= 0.60) {
    return 'descriptive_fallback';
  }
  if (input.interpretiveConfidence < 0.45 && input.surfaceConfidence < 0.60) {
    return 'minimal_fallback';
  }
  return 'normal';
}

// ─── Inclusion thresholds ─────────────────────────────────────────────────

/**
 * Whether a contributor may be named in the summary.
 * OP may always be named. Non-OP thresholds tighten in fallback mode.
 */
export function contributorMayBeNamed(
  impactScore: number,
  isOp: boolean,
  summaryMode: SummaryMode,
): boolean {
  if (isOp) return true;
  if (summaryMode === 'normal') return impactScore >= 0.50;
  return impactScore >= 0.68;
}

/**
 * Whether an entity may be named in the summary.
 * Thresholds tighten significantly in fallback mode.
 */
export function entityMayBeNamed(
  entityConfidence: number,
  entityImpact: number,
  summaryMode: SummaryMode,
): boolean {
  if (summaryMode === 'normal') return entityConfidence >= 0.50 && entityImpact >= 0.30;
  return entityConfidence >= 0.78 && entityImpact >= 0.60;
}

// ─── Comment selection ────────────────────────────────────────────────────

/**
 * Returns the top N comments by impact score for the writer.
 * Comment count is capped tightly in fallback modes to prevent over-interpretation.
 */
export function selectTopCommentsForWriter<T extends { impactScore: number }>(
  comments: T[],
  mode: SummaryMode,
): T[] {
  const sorted = [...comments].sort((a, b) => b.impactScore - a.impactScore);
  if (mode === 'normal') return sorted.slice(0, 10);
  if (mode === 'descriptive_fallback') return sorted.slice(0, 5);
  return sorted.slice(0, 3);
}
