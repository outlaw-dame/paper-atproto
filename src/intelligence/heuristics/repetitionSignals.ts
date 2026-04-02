// ─── Heuristics — Repetition Signals ─────────────────────────────────────
// Detects repeated claims, stances, sources, and entities across a set of
// reply texts without model calls.
//
// Repetition detection does not mean "bad" — it means the reply adds little
// new information relative to the existing discussion. High repetition is used
// to downweight impact scores and suppress redundant comments.
//
// Design constraints:
//   • Pure functions — no I/O.
//   • Fail-closed on any error.
//   • Tokenization uses the same stop-word filter as redundancy.ts.
//   • No raw text in logs — only counts and ratios.

import { clamp01 } from '../context/limits';

// ─── Types ────────────────────────────────────────────────────────────────

export interface RepetitionSignalResult {
  /** Fraction [0, 1] of tokens in this text that overlap with the reference corpus. */
  tokenOverlap: number;
  /** True if the same URL appears more than once in the reference corpus. */
  repeatedUrl: boolean;
  /** True if an explicit "as [someone] said/mentioned" marker is found. */
  explicitRepetitionMarker: boolean;
  /** Combined repetition score [0, 1]. */
  repetitionScore: number;
}

// ─── Stop words ───────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'the', 'and', 'that', 'this', 'with', 'from', 'into', 'have', 'has',
  'been', 'were', 'their', 'they', 'them', 'over', 'about', 'after',
  'under', 'order', 'would', 'could', 'should', 'while', 'only', 'just',
  'still', 'than', 'then', 'also', 'more', 'most', 'some', 'many',
  'much', 'very', 'your', 'ours', 'hers', 'his', 'its', 'for', 'you',
  'our', 'out', 'are', 'was', 'did', 'not', 'but', 'say', 'says',
  'said', 'get', 'got', 'can', 'will', 'all', 'one', 'two', 'new',
  'now', 'see', 'way', 'what', 'when', 'who', 'how', 'why', 'which',
]);

// ─── Tokenization ─────────────────────────────────────────────────────────

function tokenize(text: string): Set<string> {
  try {
    return new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length >= 3 && !STOP_WORDS.has(t)),
    );
  } catch {
    return new Set();
  }
}

// ─── URL extraction ────────────────────────────────────────────────────────

const URL_RE = /https?:\/\/[^\s<>"')]{6,}/gi;

function extractUrls(text: string): string[] {
  try {
    return [...text.matchAll(URL_RE)].map(m => m[0]!.replace(/[.,;:!?)\]]+$/, '').toLowerCase());
  } catch {
    return [];
  }
}

// ─── Explicit repetition markers ──────────────────────────────────────────

const REPETITION_MARKER_RE =
  /\b(?:as (?:i |(?:he|she|they|someone|everyone|people) )?(?:said|mentioned|noted|pointed out|argued|stated)|same (?:thing|point|argument|claim)|we'?ve (?:heard|seen|been over) this|been said (?:a thousand|many|so many) times|(?:again|once more|once again)[,\s])\b/i;

// ─── computeRepetitionSignals ─────────────────────────────────────────────

/**
 * Compute repetition signals for `candidate` text relative to a corpus of
 * `reference` texts (typically already-selected comments).
 *
 * Returns a RepetitionSignalResult. Never throws.
 */
export function computeRepetitionSignals(
  candidate: string,
  references: string[],
): RepetitionSignalResult {
  const zero: RepetitionSignalResult = {
    tokenOverlap: 0,
    repeatedUrl: false,
    explicitRepetitionMarker: false,
    repetitionScore: 0,
  };

  if (!candidate || typeof candidate !== 'string') return zero;

  try {
    const candText = candidate.slice(0, 1_000);
    const candTokens = tokenize(candText);
    const explicitRepetitionMarker = REPETITION_MARKER_RE.test(candText);

    if (!references?.length) {
      return {
        ...zero,
        explicitRepetitionMarker,
        repetitionScore: explicitRepetitionMarker ? 0.30 : 0,
      };
    }

    // Build reference corpus token set
    const corpusTokens = new Set<string>();
    const corpusUrls = new Set<string>();
    for (const ref of references) {
      if (typeof ref !== 'string') continue;
      for (const t of tokenize(ref.slice(0, 1_000))) {
        corpusTokens.add(t);
      }
      for (const u of extractUrls(ref)) {
        corpusUrls.add(u);
      }
    }

    // Token overlap: fraction of candidate tokens already in corpus
    const candArray = [...candTokens];
    const overlap = candTokens.size === 0
      ? 0
      : candArray.filter(t => corpusTokens.has(t)).length / candTokens.size;
    const tokenOverlap = clamp01(overlap);

    // URL repetition: any candidate URL already in corpus
    const candUrls = extractUrls(candText);
    const repeatedUrl = candUrls.some(u => corpusUrls.has(u));

    // Combined repetition score
    const repetitionScore = clamp01(
      tokenOverlap * 0.60 +
      (repeatedUrl ? 0.25 : 0) +
      (explicitRepetitionMarker ? 0.20 : 0),
    );

    return { tokenOverlap, repeatedUrl, explicitRepetitionMarker, repetitionScore };
  } catch {
    return zero;
  }
}

/**
 * Compute repetition score for each text in `corpus` relative to the texts
 * that precede it. Returns an array of scores in corpus order.
 */
export function computeCorpusRepetition(corpus: string[]): number[] {
  if (!corpus?.length) return [];
  const scores: number[] = [];
  for (let i = 0; i < corpus.length; i++) {
    const refs = corpus.slice(0, i);
    const result = computeRepetitionSignals(corpus[i]!, refs);
    scores.push(result.repetitionScore);
  }
  return scores;
}
