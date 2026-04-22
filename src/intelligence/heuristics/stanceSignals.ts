// ─── Heuristics — Stance Signals ─────────────────────────────────────────
// Deterministic stance/opinion detection for replies.
// Identifies whether a reply is broadly supportive, oppositional, neutral,
// or introducing a new angle.
//
// Used to ensure stance diversity is preserved in comment selection.
//
// Design constraints:
//   • Pure functions — no I/O.
//   • Fail-closed on any error.
//   • Returns typed feature objects, not UI strings.

import { clamp01 } from '../context/limits';

// ─── Types ────────────────────────────────────────────────────────────────

export type StanceKind =
  | 'supportive'    // agrees with or amplifies the root post
  | 'oppositional'  // disagrees with or challenges the root post
  | 'clarifying'    // seeks to add context without taking a side
  | 'new_angle'     // introduces a distinct perspective not in the root
  | 'neutral'       // observable / descriptive, no clear stance
  | 'unknown';

export interface StanceSignalResult {
  stance: StanceKind;
  confidence: number;
  /** Per-stance scores [0, 1]. */
  scores: Partial<Record<StanceKind, number>>;
}

// ─── Patterns ─────────────────────────────────────────────────────────────

const SUPPORTIVE_PATTERNS = [
  /\b(?:exactly|absolutely|this[!.,]?(?:\s|$)|yes[!.,]?(?:\s|$)|agreed?[!.,]?(?:\s|$)|correct[!.,]?(?:\s|$)|100%|same (?:here|experience|problem|situation)|me too|truth|facts[!.,]?(?:\s|$)|so true|well said|couldn'?t agree more|couldn'?t have said it better|thank you for (?:saying|sharing|this))\b/i,
  /\b(?:confirmed|i can confirm|this happened to me|i'?ve seen this|same thing happened|this is (?:so|very|really) (?:true|real|accurate|important))\b/i,
];

const OPPOSITIONAL_PATTERNS = [
  /\b(?:actually[,\s]|that'?s (?:not|wrong|incorrect|misleading|inaccurate|false)|disagree|push back|counter|on the contrary|however[,\s]|but (?:actually|wait|that)'?s?\b|not necessarily|i don'?t (?:agree|buy|think so)|skeptical|that'?s not (?:right|accurate|how it works))\b/i,
  /\b(?:you'?re missing|that ignores|this (?:forgets|omits|ignores|misses|doesn'?t mention)|the real (?:issue|problem|question|point)|wait[,\s]|hold on[,\s]|not quite|not so fast)\b/i,
];

const CLARIFYING_PATTERNS = [
  /\b(?:to clarify|for (?:context|reference|clarity|what it'?s worth)|background:|timeline:|what this means|in other words|to explain|just to add|worth noting|fyi[,\s]|heads up[,\s]|the (?:full|real|complete|actual) (?:story|picture|context|situation))\b/i,
];

const NEW_ANGLE_PATTERNS = [
  /\b(?:another (?:perspective|angle|way to (?:look at|think about|consider|frame) this|consideration)|also worth (?:considering|noting|mentioning)|speaking of|on a (?:related|separate|different) note|this also|what about|have (?:we|you|anyone) (?:considered|thought about|looked at))\b/i,
  /\b(?:related(?:ly)?[,\s]|separately[,\s]|on top of (?:that|this)|additionally[,\s]|furthermore[,\s]|moreover[,\s]|beyond (?:this|that)[,\s])\b/i,
];

// ─── computeStanceSignals ─────────────────────────────────────────────────

function score(text: string, patterns: RegExp[]): number {
  let hits = 0;
  for (const p of patterns) {
    if (p.test(text)) hits += 1;
  }
  return clamp01(hits / Math.max(1, patterns.length) * 2);
}

/**
 * Detect the dominant stance of a reply text.
 * Returns a StanceSignalResult. Never throws.
 */
export function computeStanceSignals(text: string): StanceSignalResult {
  const unknown: StanceSignalResult = { stance: 'unknown', confidence: 0, scores: {} };

  if (!text || typeof text !== 'string') return unknown;

  try {
    const t = text.slice(0, 1_000);

    const supportive = score(t, SUPPORTIVE_PATTERNS);
    const oppositional = score(t, OPPOSITIONAL_PATTERNS);
    const clarifying = score(t, CLARIFYING_PATTERNS);
    const new_angle = score(t, NEW_ANGLE_PATTERNS);

    const scores: Partial<Record<StanceKind, number>> = {
      supportive,
      oppositional,
      clarifying,
      new_angle,
    };

    let stance: StanceKind = 'neutral';
    let maxScore = 0.10; // threshold to classify away from neutral

    for (const [k, v] of Object.entries(scores) as [StanceKind, number][]) {
      if (v > maxScore) {
        maxScore = v;
        stance = k;
      }
    }

    return { stance, confidence: clamp01(maxScore), scores };
  } catch {
    return unknown;
  }
}

/**
 * Given a set of stance results, compute coverage:
 * how many distinct stance kinds are represented?
 */
export function stanceCoverageCount(results: StanceSignalResult[]): number {
  const seen = new Set(results.map(r => r.stance).filter(s => s !== 'unknown'));
  return seen.size;
}

/**
 * True if adding the `candidate` stance would increase stance diversity
 * relative to the `selected` set.
 */
export function addsStanceDiversity(
  candidate: StanceSignalResult,
  selected: StanceSignalResult[],
): boolean {
  if (candidate.stance === 'unknown' || candidate.stance === 'neutral') return false;
  return !selected.some(s => s.stance === candidate.stance);
}
