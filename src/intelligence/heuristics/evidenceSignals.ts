// ─── Heuristics — Evidence Quality Signals ────────────────────────────────
// Deterministic evidence quality assessment for a post.
// Complements extractDeterministicEvidence with higher-level quality scoring.
//
// Design constraints:
//   • Pure functions — no I/O.
//   • Fail-closed on any error.
//   • No raw text in logs.

import type { DeterministicEvidence } from '../context/extractDeterministicEvidence';
import type { CanonicalSource } from '../context/canonicalizeSources';
import { clamp01 } from '../context/limits';

// ─── Types ────────────────────────────────────────────────────────────────

export interface EvidenceQualitySignals {
  /** Overall evidence quality [0, 1]. */
  quality: number;
  /** True if at least one high-quality source is cited (news/official/academic). */
  hasPrimarySource: boolean;
  /** True if a policy/rule/law is cited. */
  hasPolicyRef: boolean;
  /** True if a quoted span is present. */
  hasQuote: boolean;
  /** True if contrastive/correction cues are present. */
  isCorrection: boolean;
  /** True if at least one numeric data point is cited. */
  hasDataPoint: boolean;
  /** Best source quality [0, 1] (0 if no sources). */
  bestSourceQuality: number;
  /** Count of distinct evidence types present. */
  evidenceTypeCount: number;
}

const EMPTY_SIGNALS: EvidenceQualitySignals = {
  quality: 0,
  hasPrimarySource: false,
  hasPolicyRef: false,
  hasQuote: false,
  isCorrection: false,
  hasDataPoint: false,
  bestSourceQuality: 0,
  evidenceTypeCount: 0,
};

// ─── computeEvidenceQuality ───────────────────────────────────────────────

/**
 * Compute evidence quality signals from an array of DeterministicEvidence.
 *
 * Never throws — returns EMPTY_SIGNALS on error.
 */
export function computeEvidenceQuality(
  evidence: DeterministicEvidence[],
): EvidenceQualitySignals {
  if (!evidence?.length) return EMPTY_SIGNALS;

  try {
    const types = new Set(evidence.map(e => e.kind));

    const urlEvidence = evidence.filter(e => e.kind === 'url');
    const sources = urlEvidence
      .map(e => e.source)
      .filter((s): s is CanonicalSource => s !== undefined);

    const bestSourceQuality = sources.reduce(
      (max, s) => Math.max(max, s.quality),
      0,
    );
    const hasPrimarySource = sources.some(s => s.type === 'news' || s.type === 'official' || s.type === 'academic');
    const hasPolicyRef = types.has('policy_ref');
    const hasQuote = types.has('quoted_span');
    const isCorrection = types.has('contrastive');
    const hasDataPoint = types.has('data_point');
    const evidenceTypeCount = types.size;

    // Weighted quality formula:
    // primary source URL is the strongest signal, followed by policy ref and quotes.
    const quality = clamp01(
      (hasPrimarySource ? 0.40 : 0) +
      (bestSourceQuality * 0.20) +
      (hasPolicyRef ? 0.25 : 0) +
      (hasQuote ? 0.10 : 0) +
      (isCorrection ? 0.10 : 0) +
      (hasDataPoint ? 0.05 : 0) +
      (Math.min(0.05, evidenceTypeCount * 0.01)),
    );

    return {
      quality,
      hasPrimarySource,
      hasPolicyRef,
      hasQuote,
      isCorrection,
      hasDataPoint,
      bestSourceQuality: clamp01(bestSourceQuality),
      evidenceTypeCount,
    };
  } catch {
    return EMPTY_SIGNALS;
  }
}

/**
 * Quick gate: does this text contain any strong evidence cues at all?
 * Cheaper than full extraction — for pre-screening.
 */
export function hasEvidenceCue(text: string): boolean {
  if (!text) return false;
  try {
    return (
      /https?:\/\//i.test(text) ||
      /\b(?:according to|cited|citing|sourced|evidence|the (?:rule|law|policy|regulation))\b/i.test(text) ||
      /\b(?:section|§)\s*\d/i.test(text) ||
      /"[^"]{10,}"/.test(text)
    );
  } catch {
    return false;
  }
}
