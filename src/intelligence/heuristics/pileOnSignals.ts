// ─── Heuristics — Pile-On Detection ──────────────────────────────────────
// Detects pile-on dynamics: when many replies adopt the same hostile stance
// toward a specific target, adding heat but not information.
//
// Pile-on detection looks at both individual post signals AND the aggregate
// pattern across a set of replies to the same parent.
//
// Design constraints:
//   • Pure functions — no I/O.
//   • Fail-closed on any error.
//   • No raw text in logs — only counts and flags.

import { clamp01 } from '../context/limits';

// ─── Types ────────────────────────────────────────────────────────────────

export interface PileOnSignalResult {
  /** Likelihood this post is part of a pile-on [0, 1]. */
  pileOnScore: number;
  /** True if the post targets a specific person by handle or name. */
  targetsIndividual: boolean;
  /** True if the post uses collective "everyone agrees" framing. */
  collectiveFraming: boolean;
  /** True if the post has high heat AND no new evidence. */
  heatWithoutSubstance: boolean;
}

export interface AggregatedPileOnResult {
  /** Fraction of replies [0, 1] that show pile-on signals. */
  pileOnFraction: number;
  /** True if thread shows systemic pile-on dynamics. */
  isPileOn: boolean;
  /** Handle being targeted most, if detectable. */
  mostTargetedHandle?: string;
}

// ─── Patterns ─────────────────────────────────────────────────────────────

const HANDLE_MENTION_RE = /@([a-z0-9._-]{1,50})/gi;

const COLLECTIVE_FRAMING_PATTERNS = [
  /\b(?:everyone|everybody|we all|literally everyone|people) (?:knows?|can see|agrees?|is saying|thinks?|sees?)\b/i,
  /\b(?:join the club|not alone|you'?re not the only one|same (?:here|experience|thing) (?:lol|lmao|smh)?)\b/i,
  /\b(?:we'?ve been saying this|been saying this for|told you so|i knew (?:it|this would happen))\b/i,
];

const HEAT_WITHOUT_SUBSTANCE_PATTERNS = [
  /\b(?:ratio[d]?|owned|destroyed|demolished|embarrassed|clowned|exposed)\b/i,
  /\b(?:cope|seethe|mald|touch grass|log off|stay mad|skill issue)\b/i,
  /\b(?:lol[l]?|lmao|💀|😂|🤡|🤣){2,}/i,
];

// ─── computePileOnSignals ─────────────────────────────────────────────────

/**
 * Compute pile-on signals for a single post.
 *
 * @param text — the post text
 * @param evidenceSignalCount — how many evidence signals were extracted for this post
 *
 * Never throws — returns zero-score result on error.
 */
export function computePileOnSignals(
  text: string,
  evidenceSignalCount = 0,
): PileOnSignalResult {
  const zero: PileOnSignalResult = {
    pileOnScore: 0,
    targetsIndividual: false,
    collectiveFraming: false,
    heatWithoutSubstance: false,
  };

  if (!text || typeof text !== 'string') return zero;

  try {
    const t = text.slice(0, 1_000);

    const handleMatches = [...t.matchAll(HANDLE_MENTION_RE)];
    const targetsIndividual = handleMatches.length > 0;

    const collectiveFraming = COLLECTIVE_FRAMING_PATTERNS.some(p => p.test(t));
    const heatWithoutSubstance =
      HEAT_WITHOUT_SUBSTANCE_PATTERNS.some(p => p.test(t)) &&
      evidenceSignalCount === 0;

    const pileOnScore = clamp01(
      (targetsIndividual ? 0.20 : 0) +
      (collectiveFraming ? 0.30 : 0) +
      (heatWithoutSubstance ? 0.45 : 0),
    );

    return { pileOnScore, targetsIndividual, collectiveFraming, heatWithoutSubstance };
  } catch {
    return zero;
  }
}

/**
 * Aggregate pile-on signals across a set of replies.
 * Identifies the most-targeted handle if detectable.
 *
 * @param texts — reply texts in thread order
 * @param evidenceCounts — parallel array of evidence signal counts per text
 */
export function aggregatePileOnSignals(
  texts: string[],
  evidenceCounts?: number[],
): AggregatedPileOnResult {
  if (!texts?.length) {
    return { pileOnFraction: 0, isPileOn: false };
  }

  try {
    const results = texts.map((t, i) =>
      computePileOnSignals(t, evidenceCounts?.[i] ?? 0),
    );

    const pileOnCount = results.filter(r => r.pileOnScore >= 0.40).length;
    const pileOnFraction = clamp01(pileOnCount / texts.length);
    const isPileOn = pileOnFraction >= 0.35;

    // Find most targeted handle
    const handleCounts = new Map<string, number>();
    for (const text of texts) {
      const t = text.slice(0, 1_000);
      for (const match of t.matchAll(HANDLE_MENTION_RE)) {
        const h = match[1]!.toLowerCase();
        handleCounts.set(h, (handleCounts.get(h) ?? 0) + 1);
      }
    }

    let mostTargetedHandle: string | undefined;
    let maxCount = 1; // require at least 2 mentions to be "targeted"
    for (const [handle, count] of handleCounts) {
      if (count > maxCount) {
        maxCount = count;
        mostTargetedHandle = handle;
      }
    }

    const result: AggregatedPileOnResult = { pileOnFraction, isPileOn };
    if (mostTargetedHandle !== undefined) result.mostTargetedHandle = mostTargetedHandle;
    return result;
  } catch {
    return { pileOnFraction: 0, isPileOn: false };
  }
}
