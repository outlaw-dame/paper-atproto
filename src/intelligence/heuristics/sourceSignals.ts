// ─── Heuristics — Source Quality Signals ─────────────────────────────────
// Deterministic source quality and citation style detection.
// Rewards comments that:
//   • Cite rules/policies/docs
//   • Link to first-party or authoritative sources
//   • Clearly distinguish opinion from citation
//
// Design constraints:
//   • Pure functions — no I/O.
//   • Fail-closed on any error.
//   • Uses canonicalizeSources for URL quality scoring.

import { buildCanonicalSource, type CanonicalSource, type SourceType } from '../context/canonicalizeSources';
import { clamp01 } from '../context/limits';

// ─── Types ────────────────────────────────────────────────────────────────

export interface SourceSignalResult {
  /**
   * Best source quality found [0, 1].
   * 0 if no URLs detected. Matches canonicalizeSources.quality scale.
   */
  bestSourceQuality: number;
  /** Dominant source type if a URL is present. */
  dominantSourceType: SourceType | 'none';
  /** True if the post explicitly distinguishes opinion from citation. */
  distinctionPresent: boolean;
  /** True if this looks like a policy/official-rule cite (vs casual opinion). */
  isOfficialCite: boolean;
  /** All canonical sources found in this text (deduped by hostname). */
  sources: CanonicalSource[];
  /** Combined source signal score [0, 1]. */
  sourceScore: number;
}

// ─── Patterns ─────────────────────────────────────────────────────────────

const URL_RE = /https?:\/\/[^\s<>"')]{8,}/gi;

// Opinion-vs-citation distinction markers
const DISTINCTION_PATTERNS = [
  /\b(?:in my (?:opinion|view|experience)|from my perspective|i (?:think|believe|feel)|imo|imho|personally)\b/i,
  /\b(?:objectively|the (?:data|evidence|record|source|rule) (?:shows?|states?|says?|indicates?)|per (?:the|official)|according to)\b/i,
];

const OFFICIAL_CITE_PATTERNS = [
  /\b(?:section|§)\s*\d/i,
  /\b(?:the (?:regulation|statute|rule|law|policy|code|ordinance) (?:says?|states?|provides?|requires?))\b/i,
  /\b(?:per (?:the|our|their) (?:terms|tos|policy|guidelines?|rules?|agreement|contract))\b/i,
  /\b(?:official (?:statement|release|announcement|guidance|document))\b/i,
];

// ─── extractSourcesFromText ────────────────────────────────────────────────

function extractSourcesFromText(text: string): CanonicalSource[] {
  const seen = new Set<string>();
  const sources: CanonicalSource[] = [];

  try {
    for (const match of text.matchAll(URL_RE)) {
      const raw = match[0]!.replace(/[.,;:!?)\]]+$/, '');
      if (seen.has(raw)) continue;
      seen.add(raw);
      const src = buildCanonicalSource(raw);
      if (src) sources.push(src);
    }
  } catch {
    // Fail closed
  }

  // Deduplicate by hostname
  const byHost = new Map<string, CanonicalSource>();
  for (const src of sources) {
    const existing = byHost.get(src.hostname);
    if (!existing || src.quality > existing.quality) {
      byHost.set(src.hostname, src);
    }
  }

  return [...byHost.values()].sort((a, b) => b.quality - a.quality);
}

// ─── computeSourceSignals ─────────────────────────────────────────────────

/**
 * Compute source quality signals for a post text.
 *
 * Never throws — returns zero-signal result on error.
 */
export function computeSourceSignals(text: string): SourceSignalResult {
  const zero: SourceSignalResult = {
    bestSourceQuality: 0,
    dominantSourceType: 'none',
    distinctionPresent: false,
    isOfficialCite: false,
    sources: [],
    sourceScore: 0,
  };

  if (!text || typeof text !== 'string') return zero;

  try {
    const t = text.slice(0, 2_000);
    const sources = extractSourcesFromText(t);

    const bestSourceQuality = sources.length > 0 ? sources[0]!.quality : 0;
    const dominantSourceType: SourceType | 'none' = sources.length > 0
      ? sources[0]!.type
      : 'none';

    const distinctionPresent = DISTINCTION_PATTERNS.some(p => p.test(t));
    const isOfficialCite = OFFICIAL_CITE_PATTERNS.some(p => p.test(t)) ||
      (dominantSourceType === 'official');

    // Score formula:
    //   best source quality (0–0.70 mapped to 0–0.70)
    //   official cite bonus  +0.20
    //   distinction present  +0.10
    const sourceScore = clamp01(
      bestSourceQuality * 0.70 +
      (isOfficialCite ? 0.20 : 0) +
      (distinctionPresent ? 0.10 : 0),
    );

    return {
      bestSourceQuality: clamp01(bestSourceQuality),
      dominantSourceType,
      distinctionPresent,
      isOfficialCite,
      sources,
      sourceScore,
    };
  } catch {
    return zero;
  }
}
