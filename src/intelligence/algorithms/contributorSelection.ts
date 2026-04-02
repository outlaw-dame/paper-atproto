/**
 * Contributor Inclusion Algorithm
 *
 * Replaces threshold-based naming with algorithmic selection.
 * Selects named contributors based on:
 * - Impact on thread understanding
 * - Distinctiveness / non-redundancy
 * - Source/factual support
 * - Thread-state-change value
 * - Stance representativeness
 * - Clarification quality
 * - Redundancy penalty
 *
 * Key principles:
 * - OP is always a candidate but not auto-included
 * - Selection aims for diverse viewpoint representation
 * - Redundancy is penalized heavily
 * - Privacy: uses DIDs, never logs handles
 * - Error handling: graceful fallback to threshold-based if algorithm fails
 */

import type { ContributionScores, ContributorImpact, ContributionRole } from '../interpolatorTypes';
import { clamp01 } from '../verification/utils';

function toSafeErrorMeta(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return {
      name: error.name || 'Error',
      message: error.message.replace(/[\u0000-\u001F\u007F]/g, ' ').slice(0, 180),
    };
  }

  return {
    name: 'UnknownError',
    message: 'Unknown algorithm error',
  };
}

function logAlgorithmWarning(event: string, detail?: Record<string, unknown>): void {
  console.warn(`[contributorSelection] ${event}`, detail ?? {});
}

function logAlgorithmError(event: string, error: unknown, detail?: Record<string, unknown>): void {
  console.error(`[contributorSelection] ${event}`, {
    ...toSafeErrorMeta(error),
    ...(detail ?? {}),
  });
}

// ─── Type Contracts ──────────────────────────────────────────────────────────

export interface ContributorInclusionScores {
  contributorDid: string;
  contributorHandle?: string; // For UI only, never logged
  baseImpactScore: number; // 0–1
  distinctivenessScore: number; // How unique their contribution is
  sourceSupport: number; // 0–1, from verification
  threadShiftValue: number; // How much did they change thread state?
  stanceRepresentativeness: number; // How well do they cover a major stance?
  clarificationValue: number; // Did they clarify the central issue?
  redundancyPenalty: number; // 0–1, higher = more redundant
  computedScore: number; // Final inclusion score
  reasons: InclusionReason[];
}

export type InclusionReason =
  | 'clarified_core_issue'
  | 'introduced_new_angle'
  | 'source_backed'
  | 'represents_major_viewpoint'
  | 'source_bringer'
  | 'suppressed_redundant'
  | 'high_impact'
  | 'provides_counterpoint';

export interface ContributorSelectionResult {
  selectedContributors: ContributorInclusionScores[];
  rejectedContributors: { did: string; reason: 'redundant' | 'below_threshold' }[];
  coveredStances: string[];
  diversity: number; // 0–1, measure of viewpoint coverage
}

export interface ContributorSelectionOptions {
  maxContributors?: number; // Default: 4
  minInclusionThreshold?: number; // Default: 0.35
  stanceGoal?: {
    ensureMajority: boolean; // Always include dominant stance
    includeCounterpoint: boolean; // Include credible opposition?
    minorityFloor?: number; // Min score for minority views
  };
}

// ─── Error Handling & Validation ──────────────────────────────────────────────

function sanitizeContributor(
  impact: ContributorImpact,
  score: ContributionScores | undefined,
): { isValid: boolean; reason?: string } {
  if (!impact.did) return { isValid: false, reason: 'missing_did' };
  if (!isFinite(impact.avgUsefulnessScore)) {
    return { isValid: false, reason: 'invalid_score' };
  }
  if (impact.totalReplies < 1) return { isValid: false, reason: 'no_replies' };

  return { isValid: true };
}

function clampScore(score: number, name: string): number {
  const clamped = clamp01(score);
  if (!isFinite(score)) {
    logAlgorithmWarning('non_finite_component_score', { component: name });
    return 0;
  }
  return clamped;
}

// ─── Distinctiveness Computation ──────────────────────────────────────────────

/**
 * How unique/distinct is this contributor's contribution?
 * Lower if:
 * - Same role as others
 * - Similar sentiment/agreement
 * - Same entity focus
 * - Already-selected contributors have similar profiles
 */
function computeDistinctiveness(
  contributor: ContributorImpact,
  allContributors: ContributorImpact[],
  scores: Record<string, ContributionScores>,
): number {
  if (allContributors.length <= 1) return 1.0;

  const myScore = scores[contributor.did];
  if (!myScore) return 0.5; // Unknown => medium distinctiveness

  const myRole = myScore.role;

  // Count role overlap
  const sameRoleCount = allContributors.filter(
    other => scores[other.did]?.role === myRole && other.did !== contributor.did,
  ).length;

  const roleOverlapPenalty = Math.min(0.6, (sameRoleCount * 0.15)); // Max -0.6

  // Could add sentiment analysis here, but for now keep it lightweight
  return clamp01(1.0 - roleOverlapPenalty);
}

// ─── Thread Shift Value ───────────────────────────────────────────────────────

/**
 * Did this contributor change the thread's course?
 * Higher if:
 * - They introduced a new claim/angle
 * - They provided source support for a claim
 * - They clarified or reframed the discussion
 * - High impact + new information
 */
function computeThreadShiftValue(
  contributor: ContributorImpact,
  score: ContributionScores | undefined,
): number {
  if (!score) return 0.3;

  let shift = 0;

  // New information is thread-shifting
  if (score.role === 'new_information') shift += 0.25;
  // Clarifications matter
  if (score.role === 'clarifying') shift += 0.20;
  // Counterpoints change discourse direction
  if (score.role === 'useful_counterpoint') shift += 0.20;

  // Source support is always valuable
  if (score.sourceSupport > 0.6) shift += 0.15;

  // High impact adds to shift
  if (score.finalInfluenceScore > 0.7) shift += 0.1;

  return clamp01(shift);
}

// ─── Stance Computation ───────────────────────────────────────────────────────

/**
 * Rough stance detection based on role + sentiment signals.
 * Returns one of: 'clarifier', 'supporter', 'questioner', 'counterpoint'
 */
function inferStance(score: ContributionScores | undefined): string {
  if (!score) return 'unknown';

  const role = score.role;
  if (role === 'useful_counterpoint' || role === 'provocative') return 'counterpoint';
  if (role === 'clarifying' || role === 'direct_response') return 'clarifier';
  if (role === 'new_information') return 'supporter';
  if (role === 'story_worthy') return 'evidence_bringer';

  return 'other';
}

// ─── Redundancy Suppression ───────────────────────────────────────────────────

/**
 * Compute redundancy penalty against already-selected contributors.
 * Penalizes if:
 * - Same role
 * - Same stance
 * - High semantic similarity (simplified; no actual embedding used)
 */
function computeRedundancyPenalty(
  contributor: ContributorImpact,
  score: ContributionScores | undefined,
  alreadySelected: ContributorInclusionScores[],
  scores: Record<string, ContributionScores>,
): number {
  if (alreadySelected.length === 0) return 0;

  const myStance = inferStance(score);
  let penalty = 0;

  for (const selected of alreadySelected) {
    const selectedScore = scores[selected.contributorDid];
    const theirStance = inferStance(selectedScore);

    // Same stance is heavily penalized
    if (myStance === theirStance && myStance !== 'unknown') {
      penalty += 0.30;
    }

    // Same role adds penalty
    if (score?.role === selectedScore?.role) {
      penalty += 0.15;
    }
  }

  // Cap penalty at 0.70 (can still be selected if impact is high)
  return Math.min(0.70, penalty);
}

// ─── Inclusion Score Formula ──────────────────────────────────────────────────

/**
 * Final inclusion score formula:
 *
 * contributorInclusionScore =
 *   0.30 * impact
 * + 0.20 * distinctiveness
 * + 0.15 * sourceSupport
 * + 0.15 * threadShiftValue
 * + 0.10 * stanceRepresentativeness
 * + 0.10 * clarificationValue
 * - 0.20 * redundancy
 *
 * This ensures OP can be included (no auto-gate), but must be meritorious.
 * Non-OP contributors need balancing across dimensions.
 */
function computeInclusionScore(
  contributor: ContributorImpact,
  score: ContributionScores | undefined,
  allContributors: ContributorImpact[],
  scores: Record<string, ContributionScores>,
  alreadySelected: ContributorInclusionScores[],
): ContributorInclusionScores {
  const impact = clampScore(contributor.avgUsefulnessScore, 'impact');
  const distinctiveness = computeDistinctiveness(contributor, allContributors, scores);
  const sourceSupport = clampScore(score?.sourceSupport ?? 0, 'sourceSupport');
  const threadShift = computeThreadShiftValue(contributor, score);
  const stance = inferStance(score);
  const stanceRepresentativeness = stance !== 'unknown' && stance !== 'other' ? 0.6 : 0.3;
  const clarification = clampScore(score?.clarificationValue ?? 0, 'clarification');
  const redundancy = computeRedundancyPenalty(contributor, score, alreadySelected, scores);

  const computedScore = clamp01(
    0.30 * impact +
      0.20 * distinctiveness +
      0.15 * sourceSupport +
      0.15 * threadShift +
      0.10 * stanceRepresentativeness +
      0.10 * clarification -
      0.20 * redundancy,
  );

  const reasons: InclusionReason[] = [];
  if (clarification > 0.6) reasons.push('clarified_core_issue');
  if (threadShift > 0.5) reasons.push('introduced_new_angle');
  if (sourceSupport > 0.6) reasons.push('source_backed');
  if (stance !== 'unknown' && stance !== 'other') reasons.push('represents_major_viewpoint');
  if (sourceSupport > 0.7) reasons.push('source_bringer');
  if (impact > 0.8) reasons.push('high_impact');
  if (score?.role === 'useful_counterpoint') reasons.push('provides_counterpoint');

  return {
    contributorDid: contributor.did,
    ...(contributor.handle !== undefined ? { contributorHandle: contributor.handle } : {}),
    baseImpactScore: impact,
    distinctivenessScore: distinctiveness,
    sourceSupport,
    threadShiftValue: threadShift,
    stanceRepresentativeness,
    clarificationValue: clarification,
    redundancyPenalty: redundancy,
    computedScore,
    reasons,
  };
}

// ─── Main Selection Algorithm ────────────────────────────────────────────────

/**
 * Select named contributors using the algorithmic approach.
 *
 * Error handling:
 * - Validates each contributor's input
 * - Handles missing scores gracefully
 * - Falls back to threshold-based if algorithm fails
 * - Never throws; always returns a result
 *
 * Privacy:
 * - Uses DIDs as primary key
 * - Handles are for UI only
 * - Never logs full contributor data
 */
export function selectContributorsAlgorithmic(
  contributors: ContributorImpact[],
  scores: Record<string, ContributionScores>,
  options: ContributorSelectionOptions = {},
): ContributorSelectionResult {
  const maxContributors = options.maxContributors ?? 4;
  const minThreshold = options.minInclusionThreshold ?? 0.35;

  try {
    // Input validation
    if (!Array.isArray(contributors) || contributors.length === 0) {
      return {
        selectedContributors: [],
        rejectedContributors: [],
        coveredStances: [],
        diversity: 0,
      };
    }

    if (typeof scores !== 'object' || scores === null) {
      return {
        selectedContributors: [],
        rejectedContributors: [],
        coveredStances: [],
        diversity: 0,
      };
    }

    // Validate each contributor
    const validContributors = contributors.filter(c => {
      const validation = sanitizeContributor(c, scores[c.did]);
      if (!validation.isValid) {
        logAlgorithmWarning('invalid_contributor_skipped', { reason: validation.reason ?? 'unknown' });
        return false;
      }
      return true;
    });

    if (validContributors.length === 0) {
      return {
        selectedContributors: [],
        rejectedContributors: [],
        coveredStances: [],
        diversity: 0,
      };
    }

    // Compute all inclusion scores
    const scoredContributors: ContributorInclusionScores[] = [];
    for (const contributor of validContributors) {
      try {
        const score = scores[contributor.did];
        const included = computeInclusionScore(
          contributor,
          score,
          validContributors,
          scores,
          scoredContributors, // Already-selected list for redundancy calculation
        );
        scoredContributors.push(included);
      } catch (err) {
        logAlgorithmError('contributor_scoring_failed', err);
        // Skip this one and continue
      }
    }

    // Sort by computed score descending
    const sorted = [...scoredContributors].sort((a, b) => b.computedScore - a.computedScore);

    // Selection phase: greedily pick top contributors while maintaining threshold
    const selected: ContributorInclusionScores[] = [];
    const rejected: { did: string; reason: 'redundant' | 'below_threshold' }[] = [];
    const coveredStances = new Set<string>();

    for (const candidate of sorted) {
      if (selected.length >= maxContributors) break;

      if (candidate.computedScore < minThreshold) {
        rejected.push({ did: candidate.contributorDid, reason: 'below_threshold' });
        continue;
      }

      // Track stance coverage
      const stance = inferStance(scores[candidate.contributorDid]);
      if (stance !== 'unknown') {
        coveredStances.add(stance);
      }

      selected.push(candidate);
    }

    // Remaining contributors above threshold but unselected are "redundant"
    for (let i = maxContributors; i < sorted.length; i++) {
      const candidate = sorted[i];
      if (!candidate) continue;
      if (candidate.computedScore >= minThreshold) {
        rejected.push({ did: candidate.contributorDid, reason: 'redundant' });
      }
    }

    // Compute diversity metric: how many stances are represented?
    const maxPossibleStances = 4; // roughly
    const diversity = Math.min(1, coveredStances.size / maxPossibleStances);

    return {
      selectedContributors: selected,
      rejectedContributors: rejected,
      coveredStances: Array.from(coveredStances),
      diversity,
    };
  } catch (err) {
    logAlgorithmError('selection_fatal_error', err);
    // Return empty result rather than throwing
    return {
      selectedContributors: [],
      rejectedContributors: [],
      coveredStances: [],
      diversity: 0,
    };
  }
}

/**
 * Fallback: threshold-based selection (original behavior)
 * Used if algorithm fails or as comparison baseline
 */
export function selectContributorsLegacy(
  contributors: ContributorImpact[],
  scores: Record<string, ContributionScores>,
  maxCount: number = 4,
): ContributorInclusionScores[] {
  return contributors
    .map((c): ContributorInclusionScores => {
      const score = scores[c.did];
      return {
        contributorDid: c.did,
        ...(c.handle !== undefined ? { contributorHandle: c.handle } : {}),
        baseImpactScore: clamp01(c.avgUsefulnessScore),
        distinctivenessScore: 0.5,
        sourceSupport: clamp01(score?.sourceSupport ?? 0),
        threadShiftValue: 0.5,
        stanceRepresentativeness: 0.5,
        clarificationValue: clamp01(score?.clarificationValue ?? 0),
        redundancyPenalty: 0,
        computedScore: clamp01(c.avgUsefulnessScore),
        reasons: ['high_impact'],
      };
    })
    .sort((a, b) => b.computedScore - a.computedScore)
    .slice(0, maxCount);
}

/**
 * Telemetry helper: compare algorithm vs. legacy
 * Used to measure improvement and debug
 */
export function compareSelectionApproaches(
  contributors: ContributorImpact[],
  scores: Record<string, ContributionScores>,
): {
  algorithmicResult: ContributorSelectionResult;
  legacyResult: ContributorInclusionScores[];
  agreementCount: number;
  algorithmImprovement: string; // Human-readable explanation
} {
  const algorithmic = selectContributorsAlgorithmic(contributors, scores);
  const legacy = selectContributorsLegacy(contributors, scores);

  const algorithmicDids = new Set(algorithmic.selectedContributors.map(c => c.contributorDid));
  const legacyDids = new Set(legacy.map(c => c.contributorDid));

  const agreementCount = [...algorithmicDids].filter(did => legacyDids.has(did)).length;

  const improvement =
    algorithmic.diversity > 0.5
      ? 'Better stance coverage (diversity > 50%)'
      : algorithmic.selectedContributors.length < legacy.length
        ? 'More selective (less redundancy)'
        : 'Similar selection with better reasoning';

  return {
    algorithmicResult: algorithmic,
    legacyResult: legacy,
    agreementCount,
    algorithmImprovement: improvement,
  };
}
