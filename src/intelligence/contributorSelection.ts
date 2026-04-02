// ─── Contributor Inclusion Algorithm ─────────────────────────────────────────
// Selects contributors because they materially help explain the thread —
// not merely because they scored highest.
//
// contributor_inclusion_score =
//   0.30 * impact
// + 0.20 * distinctiveness
// + 0.15 * source_support
// + 0.15 * thread_shift_value
// + 0.10 * stance_representativeness
// + 0.10 * clarification_value
// - 0.20 * redundancy

import type { ContributorImpact, ContributionRole, ContributionScores } from './interpolatorTypes';
import type { ThreadNode } from '../lib/resolver/atproto';
import type { SummaryMode } from './llmContracts';

// ─── Reason types ─────────────────────────────────────────────────────────

export type ContributorInclusionReason =
  | 'clarified_core_issue'
  | 'introduced_new_angle'
  | 'cited_source'
  | 'represented_major_viewpoint'
  | 'shifted_thread_direction'
  | 'op_participated';

export interface ScoredContributor {
  contributor: ContributorImpact;
  inclusionScore: number;
  reasons: ContributorInclusionReason[];
}

// ─── Role signal tables ───────────────────────────────────────────────────

function roleDistinctiveness(role: ContributionRole): number {
  switch (role) {
    case 'source_bringer':      return 0.90;
    case 'rule_source':         return 0.90;
    case 'useful_counterpoint': return 0.85;
    case 'clarifying':          return 0.75;
    case 'new_information':     return 0.70;
    case 'story_worthy':        return 0.60;
    case 'direct_response':     return 0.35;
    case 'provocative':         return 0.25;
    case 'repetitive':          return 0.10;
    default:                    return 0.20;
  }
}

function roleThreadShiftValue(role: ContributionRole): number {
  switch (role) {
    case 'useful_counterpoint': return 0.90;
    case 'clarifying':          return 0.75;
    case 'new_information':     return 0.70;
    case 'source_bringer':      return 0.65;
    case 'rule_source':         return 0.65;
    case 'story_worthy':        return 0.50;
    case 'direct_response':     return 0.30;
    case 'provocative':         return 0.20;
    default:                    return 0.10;
  }
}

function roleClarificationValue(role: ContributionRole): number {
  switch (role) {
    case 'clarifying':          return 1.00;
    case 'source_bringer':      return 0.60;
    case 'rule_source':         return 0.60;
    case 'new_information':     return 0.40;
    case 'useful_counterpoint': return 0.35;
    default:                    return 0.10;
  }
}

function reasonForRole(role: ContributionRole): ContributorInclusionReason | null {
  switch (role) {
    case 'clarifying':          return 'clarified_core_issue';
    case 'new_information':     return 'introduced_new_angle';
    case 'source_bringer':
    case 'rule_source':         return 'cited_source';
    case 'useful_counterpoint': return 'shifted_thread_direction';
    case 'story_worthy':
    case 'direct_response':     return 'represented_major_viewpoint';
    default:                    return null;
  }
}

// ─── Aggregate per-contributor signals from reply scores ─────────────────

function aggregateContributorSignals(
  contributor: ContributorImpact,
  replies: ThreadNode[],
  scores: Record<string, ContributionScores>,
): { clarificationValue: number; sourceSupport: number } {
  const contributorReplies = replies.filter(r => r.authorDid === contributor.did);
  if (contributorReplies.length === 0) {
    return {
      clarificationValue: roleClarificationValue(contributor.dominantRole),
      sourceSupport: contributor.factualContributions / Math.max(1, contributor.totalReplies),
    };
  }

  let totalClarification = 0;
  let totalSource = 0;
  let count = 0;

  for (const reply of contributorReplies) {
    const score = scores[reply.uri];
    if (!score) continue;
    totalClarification += score.clarificationValue;
    totalSource += score.sourceSupport;
    count += 1;
  }

  if (count === 0) {
    return {
      clarificationValue: roleClarificationValue(contributor.dominantRole),
      sourceSupport: contributor.factualContributions / Math.max(1, contributor.totalReplies),
    };
  }

  return {
    clarificationValue: totalClarification / count,
    sourceSupport: totalSource / count,
  };
}

// ─── Redundancy penalty ───────────────────────────────────────────────────

function computeRedundancy(
  contributor: ContributorImpact,
  selected: ContributorImpact[],
): number {
  if (selected.length === 0) return 0;
  const sameRoleCount = selected.filter(s => s.dominantRole === contributor.dominantRole).length;
  // 0.5 penalty per same-role contributor already selected, capped at 1.0
  return Math.min(1.0, sameRoleCount * 0.5);
}

// ─── Stance representativeness ────────────────────────────────────────────

function computeStanceRepresentativeness(
  contributor: ContributorImpact,
  selected: ContributorImpact[],
  all: ContributorImpact[],
): number {
  const totalSameRole = all.filter(c => c.dominantRole === contributor.dominantRole).length;
  const selectedSameRole = selected.filter(s => s.dominantRole === contributor.dominantRole).length;
  const coverage = selectedSameRole === 0 ? 1.0 : 0.30;
  const prevalence = Math.min(1.0, (totalSameRole / Math.max(1, all.length)) * 4);
  return coverage * Math.max(0.30, prevalence);
}

// ─── Core score function ──────────────────────────────────────────────────

function scoreContributor(
  contributor: ContributorImpact,
  replies: ThreadNode[],
  scores: Record<string, ContributionScores>,
  selected: ContributorImpact[],
  all: ContributorImpact[],
  isOp: boolean,
): ScoredContributor {
  const { clarificationValue, sourceSupport } = aggregateContributorSignals(contributor, replies, scores);
  const impact = contributor.avgUsefulnessScore;
  const distinctiveness = roleDistinctiveness(contributor.dominantRole);
  const threadShiftValue = roleThreadShiftValue(contributor.dominantRole);
  const stanceRepresentativeness = computeStanceRepresentativeness(contributor, selected, all);
  const redundancy = computeRedundancy(contributor, selected);

  const inclusionScore = Math.max(0, Math.min(1,
    0.30 * impact
    + 0.20 * distinctiveness
    + 0.15 * sourceSupport
    + 0.15 * threadShiftValue
    + 0.10 * stanceRepresentativeness
    + 0.10 * clarificationValue
    - 0.20 * redundancy,
  ));

  const reasons: ContributorInclusionReason[] = [];
  if (isOp) reasons.push('op_participated');
  const roleReason = reasonForRole(contributor.dominantRole);
  if (roleReason !== null && !reasons.includes(roleReason)) reasons.push(roleReason);

  return { contributor, inclusionScore, reasons };
}

// ─── Selection limits ─────────────────────────────────────────────────────

function maxContributorsForMode(mode: SummaryMode): number {
  if (mode === 'normal') return 4;
  if (mode === 'descriptive_fallback') return 3;
  return 2;
}

function minInclusionScore(mode: SummaryMode, isOp: boolean): number {
  if (isOp) return 0.10;
  if (mode === 'normal') return 0.35;
  return 0.50;
}

// ─── selectContributors ───────────────────────────────────────────────────

/**
 * Selects the best non-redundant contributor set for the writer.
 * Uses a greedy re-scoring loop: after each selection, remaining candidates are
 * re-scored against the updated selected set so redundancy is applied correctly.
 *
 * Returns scored contributors in selection order (strongest first).
 */
export function selectContributors(
  contributors: ContributorImpact[],
  replies: ThreadNode[],
  scores: Record<string, ContributionScores>,
  opHandle: string,
  mode: SummaryMode,
): ScoredContributor[] {
  const max = maxContributorsForMode(mode);
  const selected: ContributorImpact[] = [];
  const result: ScoredContributor[] = [];
  const remaining = [...contributors];

  while (result.length < max && remaining.length > 0) {
    // Re-score all remaining candidates against the current selected set
    const rescored = remaining.map(c =>
      scoreContributor(c, replies, scores, selected, contributors, c.handle === opHandle),
    );
    rescored.sort((a, b) => b.inclusionScore - a.inclusionScore);

    const best = rescored[0];
    if (!best) break;

    const isOp = best.contributor.handle === opHandle;
    if (best.inclusionScore < minInclusionScore(mode, isOp)) break;

    selected.push(best.contributor);
    result.push(best);

    const idx = remaining.indexOf(best.contributor);
    if (idx !== -1) remaining.splice(idx, 1);
  }

  return result;
}
