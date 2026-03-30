// ─── Confidence — Narwhal v3 ──────────────────────────────────────────────
// Three explicit confidence values used for summary mode routing and
// inclusion threshold decisions.
//
// surfaceConfidence    — how well we can describe what is plainly observable
// entityConfidence     — confidence in resolved entities
// interpretiveConfidence — confidence in the deeper thread meaning
//
// All functions are pure and synchronous.

import type { ConfidenceState } from './llmContracts';
import type { InterpolatorState, ContributionScores } from './interpolatorTypes';

// ─── Interpretive confidence ──────────────────────────────────────────────

export interface InterpretiveConfidenceInputs {
  themeConfidence: number;
  contributorConfidence: number;
  entityConfidence: number;
  evidenceConfidence: number;
  signalDensity: number;
  repetitionLevel: number;
}

/**
 * Weighted formula from the architecture spec:
 * 0.25*theme + 0.20*contributors + 0.20*entities + 0.15*evidence
 *   + 0.10*signal_density − 0.10*repetition
 */
export function computeInterpretiveConfidence(i: InterpretiveConfidenceInputs): number {
  return Math.max(0, Math.min(1,
    0.25 * i.themeConfidence +
    0.20 * i.contributorConfidence +
    0.20 * i.entityConfidence +
    0.15 * i.evidenceConfidence +
    0.10 * i.signalDensity -
    0.10 * i.repetitionLevel,
  ));
}

// ─── Surface confidence ───────────────────────────────────────────────────

/**
 * Derived from observable signals only — no entity resolution or theme inference.
 * Based on root text quality, reply count, and reaction pattern consistency.
 */
export function computeSurfaceConfidence(state: InterpolatorState): number {
  const hasRootText = (state.salientClaims[0]?.length ?? 0) > 20 ? 1 : 0.3;
  const replyCount = Object.keys(state.replyScores).length;
  const replySignal = Math.min(1, replyCount / 5);
  const lowRepetition = 1 - state.repetitionLevel;
  return Math.max(0, Math.min(1,
    0.40 * hasRootText +
    0.35 * replySignal +
    0.25 * lowRepetition,
  ));
}

// ─── Entity confidence ────────────────────────────────────────────────────

/**
 * Aggregate quality of the resolved entity landscape.
 * Based on average match confidence of the top 5 entities plus a density bonus.
 */
export function computeEntityConfidence(state: InterpolatorState): number {
  if (state.entityLandscape.length === 0) return 0;
  const topEntities = state.entityLandscape.slice(0, 5);
  const avgMatch = topEntities.reduce(
    (sum, e) => sum + (e.matchConfidence ?? 0.4), 0,
  ) / topEntities.length;
  const densityBonus = Math.min(0.20, topEntities.length * 0.04);
  return Math.max(0, Math.min(1, avgMatch + densityBonus));
}

// ─── Combined confidence state ────────────────────────────────────────────

/**
 * Computes all three confidence values from a completed InterpolatorState.
 * Called after the Phase 1/3 pipeline has run and before building writer input.
 */
export function computeConfidenceState(
  state: InterpolatorState,
  _scores: Record<string, ContributionScores>,
): ConfidenceState {
  const surfaceConfidence = computeSurfaceConfidence(state);
  const entityConfidence = computeEntityConfidence(state);

  const replyCount = Object.keys(state.replyScores).length;
  const highImpactContributors = state.topContributors.filter(
    c => c.avgUsefulnessScore >= 0.60,
  ).length;

  const interpretiveConfidence = computeInterpretiveConfidence({
    themeConfidence: state.factualSignalPresent ? 0.70 : 0.40,
    contributorConfidence: Math.min(1, highImpactContributors / 3),
    entityConfidence,
    evidenceConfidence: state.evidencePresent ? 0.70 : 0.20,
    signalDensity: Math.min(1, replyCount / 10),
    repetitionLevel: state.repetitionLevel,
  });

  return { surfaceConfidence, entityConfidence, interpretiveConfidence };
}
