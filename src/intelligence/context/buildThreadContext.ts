// ─── Deterministic Context — Thread Context Builder ───────────────────────
// Assembles a stable, reusable ThreadContext from a normalized thread graph
// before any scoring or model layers act on it.
//
// ThreadContext is the canonical pre-computed context object. Every scoring
// and writer function should read from it rather than re-deriving from raw nodes.
//
// Design constraints:
//   • Pure function — no I/O, no randomness.
//   • Fail-closed: on any error, return a minimal valid context.
//   • All text fields are already sanitized by callers (NormalizedPost uses
//     sanitized text from normalizeThreadGraph).

import type { NormalizedPost, NormalizedThreadGraph } from './normalizeThreadGraph';
import type { DeterministicEvidence } from './extractDeterministicEvidence';
import type { CanonicalSource } from './canonicalizeSources';
import { extractDeterministicEvidence, evidenceSources } from './extractDeterministicEvidence';
import { deduplicateSources } from './canonicalizeSources';
import { clamp01, clampCount, MAX_CONTEXT_SUMMARY_LEN } from './limits';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface PostContext {
  post: NormalizedPost;
  evidence: DeterministicEvidence[];
  sources: CanonicalSource[];
  /** Estimated heat contribution: [0, 1]. */
  heatWeight: number;
  /** True if this post introduces evidence not seen earlier in the thread. */
  introducesNewEvidence: boolean;
}

export interface ThreadHeatSummary {
  /** Overall thread heat [0, 1]. */
  overall: number;
  /** Fraction of replies that are high-heat (>= 0.6). */
  highHeatFraction: number;
  /** True if thread is escalating over time (later replies hotter than earlier). */
  escalating: boolean;
}

export interface ThreadContext {
  /** Canonical normalized graph used to derive this context. */
  graph: NormalizedThreadGraph;
  /** Per-post contexts, in branch order. */
  replyContexts: PostContext[];
  /** All canonical sources found across the thread, deduplicated. */
  allSources: CanonicalSource[];
  /** Thread-level heat summary. */
  heat: ThreadHeatSummary;
  /** True if any reply has strong evidence (confidence >= 0.60). */
  hasStrongEvidence: boolean;
  /** True if the root post has embedded media. */
  rootHasMedia: boolean;
  /** Deterministic description of the thread engagement pattern. */
  engagementSummary: string;
}

// ─── Heat computation ─────────────────────────────────────────────────────

const HEAT_PATTERNS = [
  // Exclamation storms
  /!{2,}/,
  // All-caps words (2+ consecutive)
  /\b[A-Z]{4,}\b/,
  // Second-person attack markers
  /\b(?:you(?:'re| are) (?:wrong|lying|stupid|an idiot|a liar|delusional)|you(?:'re| are) (?:just|clearly|obviously))\b/i,
  // Insult clusters
  /\b(?:idiot|moron|stupid|pathetic|ignorant|delusional|clown|bot|shill|troll)\b/i,
  // Hostile rhetorical questions
  /\bdo you (?:even|actually|seriously) (?:understand|know|read|think)\b/i,
];

function computeHeatWeight(text: string): number {
  let score = 0;
  for (const pattern of HEAT_PATTERNS) {
    if (pattern.test(text)) score += 0.20;
  }
  // Exclamation density boost
  const exclamations = (text.match(/!/g) ?? []).length;
  score += Math.min(0.20, exclamations * 0.04);
  return clamp01(score);
}

function buildHeatSummary(contexts: PostContext[]): ThreadHeatSummary {
  if (contexts.length === 0) {
    return { overall: 0, highHeatFraction: 0, escalating: false };
  }
  const weights = contexts.map(c => c.heatWeight);
  const overall = clamp01(weights.reduce((s, w) => s + w, 0) / weights.length);
  const highHeat = weights.filter(w => w >= 0.60).length;
  const highHeatFraction = clamp01(highHeat / weights.length);

  // Escalating: compare average heat of first half vs second half.
  const mid = Math.floor(weights.length / 2);
  const earlyAvg = weights.slice(0, mid).reduce((s, w) => s + w, 0) / Math.max(1, mid);
  const lateAvg = weights.slice(mid).reduce((s, w) => s + w, 0) / Math.max(1, weights.length - mid);
  const escalating = lateAvg > earlyAvg + 0.15;

  return { overall, highHeatFraction, escalating };
}

// ─── Engagement summary ───────────────────────────────────────────────────

function buildEngagementSummary(
  graph: NormalizedThreadGraph,
  heat: ThreadHeatSummary,
  hasStrongEvidence: boolean,
): string {
  const replyCount = clampCount(graph.totalReplyCount);
  const branchCount = graph.branch.length;

  if (replyCount === 0) return 'No replies yet.';

  const replyPhrase = replyCount === 1 ? '1 reply' : `${replyCount} replies`;
  const sourcePart = hasStrongEvidence ? ' Source citations present.' : '';
  const heatPart = heat.overall >= 0.60
    ? ' Thread is running hot.'
    : heat.overall >= 0.35
    ? ' Some contention visible.'
    : '';
  const escalatingPart = heat.escalating ? ' Escalating.' : '';
  const branchPart = branchCount > 0 && branchCount < replyCount
    ? ` (${branchCount} shown)`
    : '';

  const summary = `${replyPhrase}${branchPart}.${sourcePart}${heatPart}${escalatingPart}`;
  return summary.length <= MAX_CONTEXT_SUMMARY_LEN
    ? summary
    : summary.slice(0, MAX_CONTEXT_SUMMARY_LEN - 1) + '…';
}

// ─── buildThreadContext ───────────────────────────────────────────────────

/**
 * Build a ThreadContext from a NormalizedThreadGraph.
 *
 * This is the main entry point for the deterministic context substrate.
 * Call this once per thread resolution, then pass the result to all
 * scoring and writer stages.
 *
 * Never throws — returns a minimal valid context on any error.
 */
export function buildThreadContext(graph: NormalizedThreadGraph): ThreadContext {
  try {
    const seenEvidenceExcerpts = new Set<string>();
    const allSourcesRaw: CanonicalSource[] = [];

    // Compute root evidence
    const rootEvidence = extractDeterministicEvidence(graph.root.text);
    for (const src of evidenceSources(rootEvidence)) {
      allSourcesRaw.push(src);
    }
    for (const e of rootEvidence) {
      seenEvidenceExcerpts.add(e.excerpt);
    }

    // Compute per-reply contexts
    const replyContexts: PostContext[] = graph.branch.map(post => {
      const evidence = extractDeterministicEvidence(post.text);
      const sources = evidenceSources(evidence);

      for (const src of sources) {
        allSourcesRaw.push(src);
      }

      const introducesNewEvidence = evidence.some(
        e => e.confidence >= 0.50 && !seenEvidenceExcerpts.has(e.excerpt),
      );
      for (const e of evidence) {
        seenEvidenceExcerpts.add(e.excerpt);
      }

      return {
        post,
        evidence,
        sources,
        heatWeight: computeHeatWeight(post.text),
        introducesNewEvidence,
      };
    });

    const allSources = deduplicateSources(allSourcesRaw);
    const heat = buildHeatSummary(replyContexts);
    const hasStrongEvidence = replyContexts.some(c =>
      c.evidence.some(e => e.confidence >= 0.60),
    );

    return {
      graph,
      replyContexts,
      allSources,
      heat,
      hasStrongEvidence,
      rootHasMedia: graph.root.hasMedia,
      engagementSummary: buildEngagementSummary(graph, heat, hasStrongEvidence),
    };
  } catch {
    // Fail-closed
    return {
      graph,
      replyContexts: [],
      allSources: [],
      heat: { overall: 0, highHeatFraction: 0, escalating: false },
      hasStrongEvidence: false,
      rootHasMedia: false,
      engagementSummary: '',
    };
  }
}
