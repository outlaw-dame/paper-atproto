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
import type { InterpolatorState, InterpolatorDecisionScore } from './interpolatorTypes';
import type { ChangeReason } from './changeDetection';

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function getScoreInfluence(score: InterpolatorDecisionScore): number {
  return score.finalInfluenceScore ?? score.usefulnessScore;
}

function getScoreSourceSupport(score: InterpolatorDecisionScore): number {
  return score.sourceSupport ?? score.factualContribution ?? 0;
}

function getScoreClarificationValue(score: InterpolatorDecisionScore): number {
  if (typeof score.clarificationValue === 'number') {
    return score.clarificationValue;
  }

  if (score.role === 'clarifying') {
    return Math.max(score.usefulnessScore, 0.6);
  }

  const citationStrength = score.evidenceSignals
    .filter((signal) => signal.kind === 'citation')
    .reduce((sum, signal) => sum + signal.confidence, 0);
  return Math.min(1, citationStrength * 0.4);
}

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
  scores: Record<string, InterpolatorDecisionScore>,
): ConfidenceState {
  const surfaceConfidence = computeSurfaceConfidence(state);
  const entityConfidence = computeEntityConfidence(state);
  const scoreList = Object.values(scores);

  const replyCount = scoreList.length;
  const highImpactContributors = state.topContributors.filter(
    c => c.avgUsefulnessScore >= 0.60,
  ).length;
  const distinctContributorRoles = new Set(
    state.topContributors
      .map((contributor) => contributor.dominantRole)
      .filter(Boolean),
  ).size;
  const sourceBackedCount = scoreList.filter(
    (score) => getScoreSourceSupport(score) >= 0.5 || (score.factual?.factualConfidence ?? 0) >= 0.55,
  ).length;
  const verifiedCount = scoreList.filter((score) => score.factual !== null).length;
  const highSignalCount = scoreList.filter(
    (score) => getScoreInfluence(score) >= 0.58 || getScoreClarificationValue(score) >= 0.55,
  ).length;
  const sourceBackedRatio = replyCount > 0 ? sourceBackedCount / replyCount : 0;
  const verifiedRatio = replyCount > 0 ? verifiedCount / replyCount : 0;
  const highSignalRatio = replyCount > 0 ? highSignalCount / replyCount : 0;
  const themeConfidence = clamp01(
    0.18
      + (state.factualSignalPresent ? 0.20 : 0)
      + Math.min(0.18, state.newAnglesAdded.length * 0.05)
      + Math.min(0.12, state.clarificationsAdded.length * 0.04)
      + sourceBackedRatio * 0.20
      + verifiedRatio * 0.12,
  );
  const contributorConfidence = clamp01(
    Math.min(1, highImpactContributors / 3) * 0.7
      + Math.min(1, distinctContributorRoles / 4) * 0.3,
  );
  const evidenceConfidence = clamp01(
    0.12
      + sourceBackedRatio * 0.38
      + verifiedRatio * 0.30
      + highSignalRatio * 0.20,
  );
  const signalDensity = clamp01(
    Math.min(1, replyCount / 10) * 0.55 + highSignalRatio * 0.45,
  );
  const sparseUnsupportedPenalty =
    replyCount <= 2 && sourceBackedCount === 0 && !state.factualSignalPresent
      ? 0.34
      : 0;

  const interpretiveConfidence = clamp01(
    computeInterpretiveConfidence({
      themeConfidence,
      contributorConfidence,
      entityConfidence,
      evidenceConfidence,
      signalDensity,
      repetitionLevel: state.repetitionLevel,
    }) - sparseUnsupportedPenalty,
  );

  return { surfaceConfidence, entityConfidence, interpretiveConfidence };
}

// ─── Change-reason confidence boosts ─────────────────────────────────────
// Applies structured change-reason signals to lift confidence before routing.
// Keeps boosts small (≤ 0.08 per reason) to avoid over-promoting low-signal threads.
// This bridges the gap between rich change-detection data and the routing decision.

export function applyChangeReasonBoosts(
  base: ConfidenceState,
  changeReasons: ChangeReason[],
): ConfidenceState {
  if (changeReasons.length === 0) return base;

  let { surfaceConfidence, entityConfidence, interpretiveConfidence } = base;

  for (const reason of changeReasons) {
    switch (reason) {
      case 'source_backed_clarification':
        // A verifiable, cited clarification lifts both interpretive depth and entity trust
        interpretiveConfidence = clamp01(interpretiveConfidence + 0.08);
        entityConfidence = clamp01(entityConfidence + 0.04);
        break;
      case 'factual_highlight_added':
        interpretiveConfidence = clamp01(interpretiveConfidence + 0.06);
        break;
      case 'new_angle_introduced':
      case 'new_stance_appeared':
        // New perspectives widen interpretive range
        interpretiveConfidence = clamp01(interpretiveConfidence + 0.05);
        break;
      case 'central_entity_changed':
        // Entity landscape shift — new canonical entity confirmed
        entityConfidence = clamp01(entityConfidence + 0.06);
        break;
      case 'major_contributor_entered':
        // High-impact contributor raises contributor confidence component
        interpretiveConfidence = clamp01(interpretiveConfidence + 0.04);
        break;
      // heat_shift and thread_direction_reversed don't lift interpretive confidence
      default:
        break;
    }
  }

  return { surfaceConfidence, entityConfidence, interpretiveConfidence };
}
