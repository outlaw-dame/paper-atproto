// ─── Redundancy Suppression ───────────────────────────────────────────────────
// Penalizes comments that are too similar in stance, entity focus, source usage,
// or lexical content. Applied after initial impact-based sorting so the writer
// receives a diverse, informative comment set rather than the N highest-scoring
// posts making the same point.

import type { WriterComment } from './llmContracts';

// ─── Tokenization ─────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'her',
  'was', 'one', 'our', 'out', 'had', 'his', 'has', 'him', 'its', 'who',
  'did', 'how', 'get', 'from', 'they', 'this', 'that', 'with', 'have',
  'will', 'what', 'been', 'when', 'were', 'more', 'than', 'also', 'just',
  'into', 'very', 'said', 'like', 'your', 'about', 'there', 'would',
  'could', 'their', 'which', 'some', 'then',
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 3 && !STOP_WORDS.has(t)),
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ─── Role group similarity ────────────────────────────────────────────────
// Roles in the same group are semantically similar; selecting two from the
// same group increases redundancy.

const ROLE_GROUP: Partial<Record<string, number>> = {
  clarifying: 1,
  new_information: 2,
  direct_response: 3,
  repetitive: 3,
  provocative: 4,
  useful_counterpoint: 5,
  story_worthy: 6,
  rule_source: 7,
  source_bringer: 7,
};

function roleGroupOf(role: string | undefined): number | undefined {
  if (!role) return undefined;
  return ROLE_GROUP[role];
}

function sameRoleGroup(a: string | undefined, b: string | undefined): boolean {
  const ga = roleGroupOf(a);
  const gb = roleGroupOf(b);
  return ga !== undefined && gb !== undefined && ga === gb;
}

// ─── commentRedundancyScore ───────────────────────────────────────────────

/**
 * Returns a redundancy score (0–1) for `candidate` relative to the already-
 * selected comment set. 0 = not redundant, 1 = completely redundant.
 */
export function commentRedundancyScore(
  candidate: WriterComment,
  selected: WriterComment[],
): number {
  if (selected.length === 0) return 0;

  const candidateTokens = tokenize(candidate.text);
  let maxSimilarity = 0;

  for (const s of selected) {
    const textSimilarity = jaccardSimilarity(candidateTokens, tokenize(s.text));
    const roleBonus = sameRoleGroup(candidate.role, s.role) ? 0.15 : 0;
    const similarity = Math.min(1, textSimilarity + roleBonus);
    if (similarity > maxSimilarity) maxSimilarity = similarity;
  }

  return maxSimilarity;
}

// ─── selectDiverseComments ────────────────────────────────────────────────

/**
 * Selects up to `maxCount` comments using a diversity-aware greedy approach.
 *
 * Candidates must be pre-sorted by impact (descending). Each candidate's
 * effective score is penalised by its redundancy relative to what's already
 * been selected. The first non-empty comment is always included to anchor the
 * selection; subsequent candidates must clear a minimum effective-score gate.
 */
export function selectDiverseComments(
  candidates: WriterComment[],
  maxCount: number,
): WriterComment[] {
  const REDUNDANCY_PENALTY_WEIGHT = 0.35;
  const MIN_EFFECTIVE_SCORE = 0.10;

  const selected: WriterComment[] = [];

  for (const candidate of candidates) {
    if (selected.length >= maxCount) break;

    const redundancy = commentRedundancyScore(candidate, selected);
    const effectiveScore = candidate.impactScore - REDUNDANCY_PENALTY_WEIGHT * redundancy;

    // Always include the first candidate; thereafter require a minimum effective score.
    if (selected.length === 0 || effectiveScore > MIN_EFFECTIVE_SCORE) {
      selected.push(candidate);
    }
  }

  return selected;
}
