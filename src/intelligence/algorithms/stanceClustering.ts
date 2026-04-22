/**
 * Stance Coverage Clustering Algorithm
 *
 * Groups contributors by their stance/role in the conversation and ensures
 * diverse representation across different viewpoints.
 *
 * Stance dimensions:
 * - Supporter: agrees with dominant narrative
 * - Questioner: asks clarifying questions
 * - Counterpoint: presents alternative view
 * - Clarifier: provides factual context
 * - Mediator: bridges disagreement
 * - Critic: challenges assertions
 *
 * Output:
 * - Stance clusters with members
 * - Diversity score across stances
 * - Recommendations: which stances need more coverage
 * - Suppression info: which contributors are redundant within same stance
 *
 * Privacy: Uses DIDs and roles, never logs contributor content
 * Error handling: Graceful degradation for missing inferred stances
 * Performance: Bounded to 50 unique stance assignments
 */

import type { ContributionScores, ContributorImpact } from '../interpolatorTypes';
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

function logStanceError(event: string, error: unknown): void {
  console.error(`[stanceClustering] ${event}`, toSafeErrorMeta(error));
}

// ─── Type Contracts ──────────────────────────────────────────────────────────

export type StanceType =
  | 'supporter'
  | 'questioner'
  | 'counterpoint'
  | 'clarifier'
  | 'mediator'
  | 'critic';

export interface StanceCluster {
  stance: StanceType;
  description: string; // Human-readable name

  // Members in this cluster
  contributors: ContributorStance[];

  // Metrics
  diversity: number; // 0–1, how different are members in this cluster?
  coverage: number; // 0–1, how much of the thread's total impact is this stance?
  saturation: number; // 0–1, how redundant are members? (1 = all clones, 0 = all unique)

  // Recommendations
  needsMore: boolean; // Should we include more from this stance?
  tooRedundant: boolean; // Should we suppress some members?
}

export interface ContributorStance {
  did: string;
  inferredStance: StanceType;
  stanceConfidence: number; // 0–1
  uniqueness: number; // 0–1, how different from other members in same cluster?
  impact: number; // 0–1, contribution score
  shouldInclude: boolean; // Based on diversity/saturation analysis
  suppressReason?: string; // Why exclude if shouldInclude = false
}

export interface StanceCoverageClustering {
  clusters: StanceCluster[];

  // Global metrics
  stanceDiversity: number; // 0–1, spread across all stances
  coverageBalance: number; // 0–1, are stances equally represented?
  redundancyLevel: number; // 0–1, how much duplication overall?

  // Diversity gap analysis
  underrepresentedStances: StanceType[]; // Which stances are missing/weak?
  overrepresentedStances: StanceType[]; // Which stances are redundant?

  // Suppressions
  suggestedSuppressions: ContributorStance[]; // Contributors to deprioritize
}

// ─── Stance Inference ──────────────────────────────────────────────────────

/**
 * Infer stance from contribution scores.
 *
 * Logic:
 * - High clarification + high source support → clarifier
 * - High counter-support + low agreement → counterpoint
 * - High question markers → questioner
 * - Low disagreement + high impact → supporter
 * - High thread shift (introduces new angle) → critic/mediator
 */
function inferStance(scores: ContributionScores): { stance: StanceType; confidence: number } {
  try {
    const clarification = scores.clarificationValue ?? 0;
    const sourceSupport = scores.sourceSupport ?? 0;
    const counterSupport = scores.role === 'useful_counterpoint' ? 0.8 : scores.role === 'provocative' ? 0.7 : 0.2;
    const agreement = scores.role === 'direct_response' || scores.role === 'story_worthy' ? 0.7 : 0.3;
    const threadShift = scores.role === 'new_information' || scores.role === 'useful_counterpoint' ? 0.75 : 0.35;

    // Normalize inputs to 0–1
    const norm = (x: number) => clamp01(x ?? 0);

    const clar = norm(clarification);
    const source = norm(sourceSupport);
    const counter = norm(counterSupport);
    const agree = norm(agreement);
    const shift = norm(threadShift);

    let bestStance: StanceType = 'supporter';
    let bestConfidence = 0;

    // Clarifier: high clarification + source support
    const clarifierScore = clar * 0.6 + source * 0.4;
    if (clarifierScore > bestConfidence) {
      bestStance = 'clarifier';
      bestConfidence = clarifierScore;
    }

    // Counterpoint: high counter-support, low agreement
    const counterpointScore = counter * 0.7 + Math.max(0, 0.5 - agree) * 0.3;
    if (counterpointScore > bestConfidence) {
      bestStance = 'counterpoint';
      bestConfidence = counterpointScore;
    }

    // Questioner: high clarification but lower source support (asking vs. telling)
    const questionerScore = clar * 0.7 + Math.max(0, 0.3 - source) * 0.3;
    if (questionerScore > bestConfidence) {
      bestStance = 'questioner';
      bestConfidence = questionerScore;
    }

    // Critic: high thread shift
    const criticScore = shift * 0.8 + counter * 0.2;
    if (criticScore > bestConfidence) {
      bestStance = 'critic';
      bestConfidence = criticScore;
    }

    // Mediator: balanced between agreement and counter-support
    const mediatorScore = Math.abs(agree - counter) < 0.3 ? 0.5 : 0;
    if (mediatorScore > bestConfidence) {
      bestStance = 'mediator';
      bestConfidence = mediatorScore;
    }

    // Default: Supporter (high agreement)
    const supporterScore = agree * 0.8 + Math.max(0, 0.5 - counter) * 0.2;
    if (supporterScore >= bestConfidence || bestConfidence === 0) {
      bestStance = 'supporter';
      bestConfidence = supporterScore;
    }

    return { stance: bestStance, confidence: clamp01(bestConfidence) };
  } catch (err) {
    logStanceError('infer_stance_failed', err);
    return { stance: 'supporter', confidence: 0.3 };
  }
}

// ─── Stance Clustering ────────────────────────────────────────────────────────

/**
 * Build stance clusters from contributors.
 */
function buildStanceClusters(
  contributors: ContributorImpact[],
  scores: Record<string, ContributionScores>,
): Map<StanceType, ContributorStance[]> {
  const clusters = new Map<StanceType, ContributorStance[]>();

  const stances: StanceType[] = ['supporter', 'questioner', 'counterpoint', 'clarifier', 'mediator', 'critic'];
  for (const stance of stances) {
    clusters.set(stance, []);
  }

  for (const contributor of contributors) {
    const score = scores[contributor.did];
    if (!score) continue;

    const { stance, confidence } = inferStance(score);
    const cluster = clusters.get(stance) ?? [];

    cluster.push({
      did: contributor.did,
      inferredStance: stance,
      stanceConfidence: confidence,
      uniqueness: 0.5, // Will compute below
      impact: clamp01(contributor.avgUsefulnessScore ?? 0),
      shouldInclude: true, // Will finalize below
    });
  }

  return clusters;
}

/**
 * Compute uniqueness within a cluster.
 * Simplified: contributors with similar scores within cluster are less unique.
 */
function computeClusterUniqueness(members: ContributorStance[]): void {
  if (members.length === 0) return;

  for (let i = 0; i < members.length; i++) {
    let simCount = 0;
    const baseMember = members[i];
    if (!baseMember) continue;
    const baseImpact = baseMember.impact;

    for (let j = 0; j < members.length; j++) {
      if (i === j) continue;
      const compareMember = members[j];
      if (!compareMember) continue;
      const diff = Math.abs(baseImpact - compareMember.impact);
      if (diff < 0.15) simCount += 1; // Considers "similar impact" if within 0.15
    }

    // If many members have similar impact, uniqueness is low
    baseMember.uniqueness = clamp01(1 - simCount / Math.max(1, members.length - 1));
  }
}

/**
 * Compute saturation of a cluster (redundancy).
 * High uniqueness spread = low saturation. Low uniqueness spread = high saturation.
 */
function computeClusterSaturation(members: ContributorStance[]): number {
  if (members.length <= 1) return 0;

  const uniquenesses = members.map(m => m.uniqueness);
  const avgUniqueness = uniquenesses.reduce((a, b) => a + b, 0) / uniquenesses.length;

  // If avg uniqueness is low, saturation is high
  return clamp01(1 - avgUniqueness);
}

/**
 * Compute coverage of a cluster (its share of total impact).
 */
function computeClusterCoverage(members: ContributorStance[], totalImpact: number): number {
  if (totalImpact === 0) return 0;

  const clusterImpact = members.reduce((sum, m) => sum + m.impact, 0);
  return clamp01(clusterImpact / totalImpact);
}

/**
 * Compute diversity of a cluster (how different are its members?).
 */
function computeClusterDiversity(members: ContributorStance[]): number {
  if (members.length === 0) return 0;
  if (members.length === 1) return 0.5; // Single member, moderate diversity

  const uniquenesses = members.map(m => m.uniqueness);
  const variance =
    uniquenesses.reduce((sum, u) => sum + Math.pow(u - 0.5, 2), 0) / uniquenesses.length;

  return clamp01(Math.sqrt(variance) * 2); // Scale up variance for visibility
}

// ─── Coverage Analysis ────────────────────────────────────────────────────────

/**
 * Analyze which stances need more/less coverage.
 */
function analyzeCoverageGaps(
  clusters: StanceCluster[],
): { underrepresented: StanceType[]; overrepresented: StanceType[] } {
  const underrepresented: StanceType[] = [];
  const overrepresented: StanceType[] = [];

  const avgCoverage = clusters.reduce((sum, c) => sum + c.coverage, 0) / Math.max(1, clusters.length);

  for (const cluster of clusters) {
    if (cluster.coverage < avgCoverage * 0.5 && cluster.contributors.length > 0) {
      underrepresented.push(cluster.stance);
    }
    if (cluster.saturation > 0.7 && cluster.coverage > avgCoverage * 1.5) {
      overrepresented.push(cluster.stance);
    }
  }

  return { underrepresented, overrepresented };
}

/**
 * Mark contributors for suppression if they're redundant.
 * Suppress contributors with low uniqueness in saturated clusters.
 */
function markSuppressionCandidates(clusters: StanceCluster[]): ContributorStance[] {
  const suppressions: ContributorStance[] = [];

  for (const cluster of clusters) {
    if (cluster.saturation < 0.6) continue; // Only suppress in very saturated clusters

    // Sort by uniqueness, suppress the bottom 30%
    const sorted = [...cluster.contributors].sort((a, b) => a.uniqueness - b.uniqueness);
    const suppressCount = Math.max(0, Math.floor(sorted.length * 0.3));

    for (let i = 0; i < suppressCount; i++) {
      const contributor = sorted[i];
      if (!contributor) continue;
      contributor.shouldInclude = false;
      contributor.suppressReason = `redundant_in_${cluster.stance}_cluster`;
      suppressions.push(contributor);
    }
  }

  return suppressions;
}

// ─── Main Clustering Function ────────────────────────────────────────────────

/**
 * Cluster contributors by stance and analyze coverage diversity.
 */
export function clusterStanceCoverage(
  contributors: ContributorImpact[],
  scores: Record<string, ContributionScores>,
): StanceCoverageClustering {
  try {
    // Validate inputs
    if (!Array.isArray(contributors) || contributors.length === 0) {
      return {
        clusters: [],
        stanceDiversity: 0,
        coverageBalance: 0,
        redundancyLevel: 0,
        underrepresentedStances: [],
        overrepresentedStances: [],
        suggestedSuppressions: [],
      };
    }

    // Bound to 50 contributors max
    const limitedContributors = contributors.slice(0, 50);
    const totalImpact = limitedContributors.reduce((sum, c) => sum + clamp01(c.avgUsefulnessScore ?? 0), 0);

    // Build clusters
    const clusterMap = buildStanceClusters(limitedContributors, scores);

    // Compute metrics for each cluster
    const clusters: StanceCluster[] = [];
    const stanceDescriptions: Record<StanceType, string> = {
      supporter: 'Agrees & supports',
      questioner: 'Asks & clarifies',
      counterpoint: 'Presents alternative',
      clarifier: 'Provides context',
      mediator: 'Bridges disagreement',
      critic: 'Challenges & questions',
    };

    for (const [stance, members] of clusterMap) {
      if (members.length === 0) continue;

      computeClusterUniqueness(members);
      const saturation = computeClusterSaturation(members);
      const coverage = computeClusterCoverage(members, totalImpact);
      const diversity = computeClusterDiversity(members);

      clusters.push({
        stance,
        description: stanceDescriptions[stance],
        contributors: members,
        diversity,
        coverage,
        saturation,
        needsMore: coverage < 0.1 && members.length < 3,
        tooRedundant: saturation > 0.65,
      });
    }

    // Sort clusters by coverage descending
    clusters.sort((a, b) => b.coverage - a.coverage);

    // Analyze coverage gaps
    const { underrepresented, overrepresented } = analyzeCoverageGaps(clusters);

    // Mark suppressions
    const suppressions = markSuppressionCandidates(clusters);

    // Compute global metrics
    const stanceDiversity = clusters.length > 0
      ? clamp01(
          clusters.reduce((sum, c) => sum + c.diversity * c.coverage, 0) /
            Math.max(1, clusters.reduce((sum, c) => sum + c.coverage, 0)),
        )
      : 0;

    const coverageVariance =
      clusters.length > 1
        ? Math.sqrt(
            clusters.reduce((sum, c) => sum + Math.pow(c.coverage - 1 / clusters.length, 2), 0) /
              clusters.length,
          )
        : 0;
    const coverageBalance = clamp01(1 - coverageVariance);

    const redundancyLevel = clusters.length > 0
      ? clamp01(clusters.reduce((sum, c) => sum + c.saturation * c.coverage, 0) / clusters.length)
      : 0;

    return {
      clusters,
      stanceDiversity,
      coverageBalance,
      redundancyLevel,
      underrepresentedStances: underrepresented,
      overrepresentedStances: overrepresented,
      suggestedSuppressions: suppressions,
    };
  } catch (err) {
    logStanceError('clustering_fatal_error', err);
    return {
      clusters: [],
      stanceDiversity: 0,
      coverageBalance: 0,
      redundancyLevel: 0,
      underrepresentedStances: [],
      overrepresentedStances: [],
      suggestedSuppressions: [],
    };
  }
}

/**
 * Filter contributors based on stance coverage analysis.
 * Returns contributors that should be included to maximize diversity.
 */
export function filterByStanceDiversity(
  clustering: StanceCoverageClustering,
  maxCount: number = 5,
): string[] {
  try {
    const selectedDids: string[] = [];
    const suppressedDids = new Set(clustering.suggestedSuppressions.map(s => s.did));

    // Sort clusters by coverage balance (include from all stances)
    const sortedClusters = [...clustering.clusters].sort((a, b) => b.coverage - a.coverage);

    // Greedy selection: pick from each stance up to max
    for (const cluster of sortedClusters) {
      const available = cluster.contributors.filter(
        c => !suppressedDids.has(c.did) && !selectedDids.includes(c.did),
      );

      if (available.length > 0) {
        // Pick the highest-impact, most-unique one
        const best = [...available].sort((a, b) => {
          const scoreA = a.impact * 0.6 + a.uniqueness * 0.4;
          const scoreB = b.impact * 0.6 + b.uniqueness * 0.4;
          return scoreB - scoreA;
        })[0];

        if (!best) continue;

        selectedDids.push(best.did);

        if (selectedDids.length >= maxCount) break;
      }
    }

    return selectedDids;
  } catch (err) {
    logStanceError('diversity_filter_failed', err);
    return [];
  }
}

/**
 * Get recommendations for improving stance coverage.
 */
export function getStanceCoverageRecommendations(
  clustering: StanceCoverageClustering,
): string[] {
  const recommendations: string[] = [];

  if (clustering.underrepresentedStances.length > 0) {
    const stances = clustering.underrepresentedStances.slice(0, 2).join(', ');
    recommendations.push(`Add more ${stances} perspectives for better balance`);
  }

  if (clustering.redundancyLevel > 0.6) {
    recommendations.push(`Simplify contributor list: ${Math.round(clustering.redundancyLevel * 100)}% redundancy detected`);
  }

  if (clustering.stanceDiversity < 0.4) {
    recommendations.push('Thread needs more viewpoint diversity to represent all sides fairly');
  }

  return recommendations;
}
