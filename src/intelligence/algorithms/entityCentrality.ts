/**
 * Entity Centrality Algorithm
 *
 * Ranks entities by their importance to the conversation using a centrality model.
 * Replaces surface-local entity extraction with a unified multi-dimensional scoring.
 *
 * Dimensions:
 * - Root presence: is the entity mentioned in root post?
 * - Weighted mentions: total mentions weighted by contributor impact
 * - Contributor impact mentions: mentions by high-impact contributors
 * - Source association: linked or cited with fact-checked sources
 * - Temporal burst: sudden spike in mentions
 * - Cluster alignment: entity central to dominant theme
 * - Canonical confidence: how certain is disambiguation/linking?
 *
 * Output:
 * - Ranked canonical entities (central vs. incidental)
 * - Why inclusion for each entity
 * - Confidence scores
 *
 * Privacy: Uses canonical IDs, never logs user text
 * Error handling: Graceful degradation for missing data
 * Performance: Bounded to top 20 entities to prevent unbounded computation
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

function logEntityCentralityWarning(event: string, detail?: Record<string, unknown>): void {
  console.warn(`[entityCentrality] ${event}`, detail ?? {});
}

function logEntityCentralityError(event: string, error: unknown): void {
  console.error(`[entityCentrality] ${event}`, toSafeErrorMeta(error));
}

// ─── Type Contracts ──────────────────────────────────────────────────────────

export interface EntityInfo {
  id: string; // Canonical ID (e.g., Wikidata ID)
  label: string; // Display name
  type: 'topic' | 'event' | 'person' | 'team' | 'organization' | 'product' | 'rule' | 'source';
  mentionCount: number;
}

export interface EntityCentralityScore {
  entityId: string;
  entityLabel: string;
  entityType: 'topic' | 'event' | 'person' | 'team' | 'organization' | 'product' | 'rule' | 'source';

  // Component scores (0–1)
  rootPresence: number; // 0 or 1, or partial
  weightedMentions: number; // 0–1, relative
  contributorImpactMentions: number; // 0–1, how much impact-heavy contributors cited it
  sourceAssociation: number; // 0–1, linked with sources
  temporalBurst: number; // 0–1, sudden spike?
  clusterAlignment: number; // 0–1, central to dominant theme?
  canonicalConfidence: number; // 0–1, how sure are we it's the right entity?

  // Composite & meta
  centralityScore: number; // 0–1, final ranking
  centrality: 'central' | 'peripheral' | 'incidental';
  whyIncluded: EntityInclusionReason[];
  confidence: number; // Overall confidence in this entity's importance
}

export type EntityInclusionReason =
  | 'mentioned_in_root'
  | 'high_frequency'
  | 'cited_by_high_impact'
  | 'source_backed'
  | 'temporal_spike'
  | 'represents_theme';

export interface EntityCentralityResult {
  entities: EntityCentralityScore[];
  topCentral: EntityCentralityScore[]; // Top 3–5 central entities
  themes: string[]; // Descriptive theme names derived from top entities
  entityDiversity: number; // 0–1, how diverse is the entity landscape?
}

// ─── Input Validation ──────────────────────────────────────────────────────

function sanitizeEntity(entity: EntityInfo): { isValid: boolean; reason?: string } {
  if (!entity.id) return { isValid: false, reason: 'missing_id' };
  if (!entity.label || typeof entity.label !== 'string') {
    return { isValid: false, reason: 'invalid_label' };
  }
  if (entity.mentionCount < 0 || !isFinite(entity.mentionCount)) {
    return { isValid: false, reason: 'invalid_mention_count' };
  }
  return { isValid: true };
}

// ─── Component Score Computation ──────────────────────────────────────────────

/**
 * Root presence: 0 if not mentioned, 0.5 if implicitly about it, 1 if explicitly mentioned
 */
function computeRootPresence(
  entityId: string,
  rootText: string,
  rootMentionedEntities: Set<string>,
): number {
  if (!rootText) return 0;

  if (rootMentionedEntities.has(entityId)) return 1.0; // Explicit mention

  // Could add fuzzy matching here, but keep it simple for now
  return 0;
}

/**
 * Weighted mentions: total mentions, but normalized and weighted by contributor importance
 */
function computeWeightedMentions(
  entityId: string,
  contributors: ContributorImpact[],
  scores: Record<string, ContributionScores>,
  mentionsByContributor: Map<string, Set<string>>, // did -> set of mentioned entity IDs
): number {
  let totalWeight = 0;
  let maxPossibleWeight = 0;

  for (const contributor of contributors) {
    const cScore = scores[contributor.did];
    const impact = clamp01(contributor.avgUsefulnessScore);
    maxPossibleWeight += impact;

    const mentionedByThisContributor = mentionsByContributor.get(contributor.did) ?? new Set();
    if (mentionedByThisContributor.has(entityId)) {
      totalWeight += impact;
    }
  }

  return maxPossibleWeight === 0 ? 0 : clamp01(totalWeight / maxPossibleWeight);
}

/**
 * Contributor impact mentions: how many top contributors mentioned this?
 */
function computeContributorImpactMentions(
  entityId: string,
  contributors: ContributorImpact[],
  scores: Record<string, ContributionScores>,
  mentionsByContributor: Map<string, Set<string>>,
): number {
  const topContributors = contributors.slice(0, 5); // Only top 5
  let count = 0;

  for (const contributor of topContributors) {
    const mentioned = mentionsByContributor.get(contributor.did) ?? new Set();
    if (mentioned.has(entityId)) count += 1;
  }

  return clamp01(count / Math.max(1, topContributors.length));
}

/**
 * Source association: is this entity mentioned in source-backed comments?
 */
function computeSourceAssociation(
  entityId: string,
  contributors: ContributorImpact[],
  scores: Record<string, ContributionScores>,
  mentionsByContributor: Map<string, Set<string>>,
): number {
  let sourceBackedMentions = 0;
  let totalSourceBacked = 0;

  for (const contributor of contributors) {
    const cScore = scores[contributor.did];
    if (!cScore) continue;

    // Check if this is a source-backed contribution
    const isSourceBacked = (cScore.sourceSupport ?? 0) > 0.6;
    if (isSourceBacked) {
      totalSourceBacked += 1;

      const mentioned = mentionsByContributor.get(contributor.did) ?? new Set();
      if (mentioned.has(entityId)) {
        sourceBackedMentions += 1;
      }
    }
  }

  return totalSourceBacked === 0 ? 0 : clamp01(sourceBackedMentions / totalSourceBacked);
}

/**
 * Temporal burst: did mentions spike recently?
 * Simplified: check if recent contributors (last 1/3 of replies) mention it
 */
function computeTemporalBurst(
  entityId: string,
  replyOrder: string[],
  mentionsByContributor: Map<string, Set<string>>,
): number {
  if (replyOrder.length === 0) return 0;

  const recentWindow = Math.max(1, Math.floor(replyOrder.length / 3));
  const recentReplies = replyOrder.slice(-recentWindow);

  let burstMentions = 0;
  for (const did of recentReplies) {
    const mentioned = mentionsByContributor.get(did) ?? new Set();
    if (mentioned.has(entityId)) burstMentions += 1;
  }

  const burstRate = burstMentions / recentWindow;
  const baselineReplies = replyOrder.slice(0, Math.max(0, replyOrder.length - recentWindow));
  let baselineMentions = 0;
  for (const did of baselineReplies) {
    const mentioned = mentionsByContributor.get(did) ?? new Set();
    if (mentioned.has(entityId)) baselineMentions += 1;
  }

  const baselineRate = baselineReplies.length > 0 ? baselineMentions / baselineReplies.length : 0.1;

  // Require at least two recent mentions and a significant lift over baseline.
  return burstMentions >= 2 && burstRate > baselineRate * 1.5 ? clamp01(burstRate) : 0;
}

/**
 * Cluster alignment: is this entity central to the dominant theme?
 * Simplified: if top contributors frequently mention it, it's aligned
 */
function computeClusterAlignment(
  entityId: string,
  contributors: ContributorImpact[],
  mentionsByContributor: Map<string, Set<string>>,
): number {
  const topContributors = contributors.slice(0, 3);
  let alignmentScore = 0;

  for (const contributor of topContributors) {
    const mentioned = mentionsByContributor.get(contributor.did) ?? new Set();
    if (mentioned.has(entityId)) alignmentScore += 0.33;
  }

  return clamp01(alignmentScore);
}

/**
 * Canonical confidence: how certain are we about the entity's identity?
 * Would be higher if disambiguation/linking service confirms it.
 * For now, use a default or pass in from external service.
 */
function computeCanonicalConfidence(
  entityId: string,
  confidenceFromLinker?: number,
): number {
  return clamp01(confidenceFromLinker ?? 0.7); // Default OK confidence
}

// ─── Centrality Classification ───────────────────────────────────────────────

function classifyCentrality(score: number): 'central' | 'peripheral' | 'incidental' {
  if (score >= 0.65) return 'central';
  if (score >= 0.35) return 'peripheral';
  return 'incidental';
}

// ─── Main Centrality Scoring ────────────────────────────────────────────────

/**
 * Compute entity centrality using the formula:
 *
 * entityCentrality =
 *   0.25 * rootPresence
 * + 0.20 * weightedMentions
 * + 0.15 * contributorImpactMentions
 * + 0.15 * sourceAssociation
 * + 0.10 * temporalBurst
 * + 0.10 * clusterAlignment
 * + 0.05 * canonicalConfidence
 */
export function computeEntityCentralityScores(
  entities: EntityInfo[],
  rootText: string,
  rootMentionedEntities: Set<string>,
  contributors: ContributorImpact[],
  scores: Record<string, ContributionScores>,
  replyOrder: string[], // DIDs in reply order
  mentionsByContributor: Map<string, Set<string>>, // did -> entity IDs
  linkedEntityConfidences?: Map<string, number>, // Optional: entity ID -> confidence
): EntityCentralityScore[] {
  try {
    // Validate inputs
    if (!Array.isArray(entities) || entities.length === 0) {
      return [];
    }

    const validEntities = entities.filter(e => {
      const validation = sanitizeEntity(e);
      if (!validation.isValid) {
        logEntityCentralityWarning('invalid_entity_skipped', { reason: validation.reason ?? 'unknown' });
        return false;
      }
      return true;
    });

    // Bound to 100 entities max to prevent unbounded computation
    const allEntities = validEntities.slice(0, 100);

    // Compute centrality scores for all entities
    const centralities: EntityCentralityScore[] = [];

    for (const entity of allEntities) {
      try {
        const root = computeRootPresence(entity.id, rootText, rootMentionedEntities);
        const weighted = computeWeightedMentions(entity.id, contributors, scores, mentionsByContributor);
        const impactMentions = computeContributorImpactMentions(entity.id, contributors, scores, mentionsByContributor);
        const source = computeSourceAssociation(entity.id, contributors, scores, mentionsByContributor);
        const temporal = computeTemporalBurst(entity.id, replyOrder, mentionsByContributor);
        const cluster = computeClusterAlignment(entity.id, contributors, mentionsByContributor);
        const canonical = computeCanonicalConfidence(entity.id, linkedEntityConfidences?.get(entity.id));

        const centralityScore = clamp01(
          0.25 * root +
            0.20 * weighted +
            0.15 * impactMentions +
            0.15 * source +
            0.10 * temporal +
            0.10 * cluster +
            0.05 * canonical,
        );

        const reasons: EntityInclusionReason[] = [];
        if (root > 0) reasons.push('mentioned_in_root');
        if (weighted > 0.5) reasons.push('high_frequency');
        if (impactMentions > 0.4) reasons.push('cited_by_high_impact');
        if (source > 0.5) reasons.push('source_backed');
        if (temporal > 0.3) reasons.push('temporal_spike');
        if (cluster > 0.5) reasons.push('represents_theme');

        const confidence = clamp01(
          centralityScore * 0.6 + canonical * 0.3 + (reasons.length > 0 ? 0.1 : 0),
        );

        centralities.push({
          entityId: entity.id,
          entityLabel: entity.label.slice(0, 128), // Bound label length
          entityType: entity.type,
          rootPresence: root,
          weightedMentions: weighted,
          contributorImpactMentions: impactMentions,
          sourceAssociation: source,
          temporalBurst: temporal,
          clusterAlignment: cluster,
          canonicalConfidence: canonical,
          centralityScore,
          centrality: classifyCentrality(centralityScore),
          whyIncluded: reasons,
          confidence,
        });
      } catch (err) {
        logEntityCentralityError('entity_scoring_failed', err);
        // Skip and continue
      }
    }

    // Sort by centrality score descending
    centralities.sort((a, b) => b.centralityScore - a.centralityScore);

    return centralities;
  } catch (err) {
    logEntityCentralityError('centrality_fatal_error', err);
    return [];
  }
}

// ─── High-Level Result Builder ───────────────────────────────────────────────

/**
 * Build the final entity centrality result with themes and diversity.
 */
export function buildEntityCentralityResult(
  scores: EntityCentralityScore[],
): EntityCentralityResult {
  const topCentral = scores.filter(e => e.centrality === 'central').slice(0, 5);

  // Derive theme names from top entities
  const themes = topCentral
    .filter(e => e.whyIncluded.length > 0)
    .map(e => {
      const reason = e.whyIncluded[0];
      if (reason === 'represents_theme') return e.entityLabel;
      if (reason === 'cited_by_high_impact') return `${e.entityLabel} (fact-checked)`;
      return e.entityLabel;
    })
    .slice(0, 3);

  // Diversity: how many central entities?
  const diversity = Math.min(1, topCentral.length / 5);

  return {
    entities: scores,
    topCentral,
    themes,
    entityDiversity: diversity,
  };
}

/**
 * Get top N entities, bounded.
 */
export function getTopCentralEntities(
  scores: EntityCentralityScore[],
  limit: number = 5,
): EntityCentralityScore[] {
  return scores
    .filter(e => e.centrality === 'central' || e.centrality === 'peripheral')
    .slice(0, Math.max(1, Math.min(20, limit)));
}
