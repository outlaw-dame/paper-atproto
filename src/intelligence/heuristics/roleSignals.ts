// ─── Heuristics — Role Signals ────────────────────────────────────────────
// Deterministic role classification from post text.
// Returns a RoleSignalResult — a typed feature object, never raw UI strings.
//
// Design constraints:
//   • Pure functions — no I/O, no side effects.
//   • Fail-closed: on any error, return an 'unknown' result.
//   • No raw text in logs — only counts.
//   • Adversarial inputs (empty, very long, emoji-heavy, repeated punctuation)
//     must not crash or produce nonsense scores.

import type { ContributionRole } from '../interpolatorTypes';

// ─── Types ────────────────────────────────────────────────────────────────

export interface RoleSignalResult {
  /** Dominant inferred role. */
  role: ContributionRole;
  /** Per-role confidence scores [0, 1]. */
  scores: Partial<Record<ContributionRole, number>>;
  /** Evidence strength for the dominant role [0, 1]. */
  confidence: number;
  /** True if any rule/policy citation was detected. */
  citesRule: boolean;
  /** True if any primary source was cited (URL present and not social). */
  citesSource: boolean;
  /** True if the reply directly addresses the root post author. */
  directsAtOp: boolean;
}

// ─── Patterns ─────────────────────────────────────────────────────────────

// -- clarifying
const CLARIFYING_PATTERNS = [
  /\b(?:to clarify|clarifying|for clarity|to be clear|let me explain|what this means|in other words|more specifically|to put it simply|the point is|what (?:he|she|they|this) (?:means|said|meant)|i (?:think|believe) (?:the question|the issue|the point) is)\b/i,
  /\b(?:timeline|context|background|full picture|for context|the (?:real|actual) story|what (?:actually|really) happened)\b/i,
];

// -- new_information
const NEW_INFO_PATTERNS = [
  /\b(?:just (?:learned|found|saw|heard)|breaking|update:|new (?:info|data|report|study|evidence|numbers?)|according to|citing|citing (?:a|an|the)|here'?s (?:a|the|an) (?:link|source|article|report|paper|study))\b/i,
  /\b(?:i can (?:confirm|add|share)|fyi|heads up|worth noting|for (?:reference|what it'?s worth)|data (?:shows?|indicates?|suggests?))\b/i,
];

// -- useful_counterpoint
const COUNTERPOINT_PATTERNS = [
  /\b(?:disagree|that'?s (?:not right|wrong|incorrect|misleading|unfair)|push back|counterpoint|however|on the other hand|that said|but (?:actually|wait|consider|also)|not necessarily|i (?:don'?t|wouldn'?t|can'?t) (?:agree|buy that)|skeptical|doubt that)\b/i,
  /\b(?:but (?:the (?:data|evidence|research|numbers?|facts?) (?:show|suggest|indicate)|wait)|that ignores|missing (?:the point|context|the fact)|this (?:forgets|omits|ignores|misses))\b/i,
];

// -- direct_response
const DIRECT_RESPONSE_PATTERNS = [
  /\b(?:replying to|in response to|to answer your question|yes[,!]?(?:\s|$)|no[,!]?(?:\s|$)|correct[,!]?(?:\s|$)|exactly[,!]?(?:\s|$)|agreed[,!]?(?:\s|$)|fair point)\b/i,
];

// -- rule_source
const RULE_SOURCE_PATTERNS = [
  /\b(?:section|§)\s*\d[\d.a-z]*/i,
  /\b(?:article|rule|regulation|statute|law|act|code|policy|bylaw|ordinance)\s+\d/i,
  /\b(?:the (?:rule|law|policy|regulation|code|statute|ordinance|bylaw) (?:says?|states?|provides?|requires?|mandates?|specifies?))\b/i,
  /\b(?:per (?:the|our|their) (?:terms|tos|policy|guidelines?|rules?|agreement|contract))\b/i,
  /\b(?:executive order|federal register|cfr|u\.?s\.?c\.?)\b/i,
];

// -- source_bringer
const SOURCE_URL_RE = /https?:\/\/[^\s<>"')]{8,}/i;
const SOURCE_BRINGER_PATTERNS = [
  /\b(?:here(?:'s| is) (?:a |an |the )?(?:link|source|article|report|paper|study|evidence|proof|document))\b/i,
  /\b(?:see (?:this|the) (?:link|source|article|report|paper|thread|post)|archived here|full (?:report|document|article|text) at)\b/i,
];

// -- story_worthy
const STORY_WORTHY_PATTERNS = [
  /\b(?:this is (?:huge|massive|major|significant|a big deal|historic|unprecedented|landmark)|breaking:|developing:|this changes everything|this just happened|confirmed:|just confirmed)\b/i,
];

// -- repetitive
const REPETITIVE_PATTERNS = [
  /\b(?:as (?:i |everyone|people|he|she|they) (?:said|mentioned|noted|pointed out|argued|stated)|same (?:thing|point|argument|claim) again|we'?ve (?:heard|seen|been over) this|(?:again|once more|once again)[,\s]|been said (?:a thousand|many|so many) times)\b/i,
];

// -- provocative
const PROVOCATIVE_PATTERNS = [
  /\b(?:idiot|moron|stupid|pathetic|clueless|delusional|clown|bot|shill|troll|you'?re (?:wrong|lying|a liar|an idiot|delusional|pathetic))\b/i,
  /!{3,}/,
  /\b(?:shut up|get out|go away|block me|you people|grow up|wake up|cope|seethe|mald)\b/i,
];

// ─── Score helpers ─────────────────────────────────────────────────────────

function scorePatterns(text: string, patterns: RegExp[]): number {
  let hits = 0;
  for (const pattern of patterns) {
    if (pattern.test(text)) hits += 1;
  }
  return Math.min(1, hits * (1 / patterns.length));
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

// ─── detectRoleSignals ────────────────────────────────────────────────────

/**
 * Infer the most likely ContributionRole for a reply text using deterministic
 * pattern matching. Returns a RoleSignalResult with per-role confidence scores.
 *
 * Safe for adversarial input — never throws.
 */
export function detectRoleSignals(
  text: string,
  opHandle?: string,
): RoleSignalResult {
  const empty: RoleSignalResult = {
    role: 'unknown',
    scores: {},
    confidence: 0,
    citesRule: false,
    citesSource: false,
    directsAtOp: false,
  };

  if (!text || typeof text !== 'string') return empty;

  try {
    const t = text.slice(0, 1_000); // guard against pathologically long strings

    const citesRule = RULE_SOURCE_PATTERNS.some(p => p.test(t));
    const citesSource = SOURCE_URL_RE.test(t) || SOURCE_BRINGER_PATTERNS.some(p => p.test(t));
    const directsAtOp = !!(opHandle && t.toLowerCase().includes(`@${opHandle.toLowerCase().replace(/^@/, '')}`));

    const scores: Partial<Record<ContributionRole, number>> = {
      clarifying: clamp01(scorePatterns(t, CLARIFYING_PATTERNS)),
      new_information: clamp01(scorePatterns(t, NEW_INFO_PATTERNS) + (citesSource ? 0.35 : 0)),
      useful_counterpoint: clamp01(scorePatterns(t, COUNTERPOINT_PATTERNS)),
      direct_response: clamp01(scorePatterns(t, DIRECT_RESPONSE_PATTERNS) + (directsAtOp ? 0.30 : 0)),
      rule_source: clamp01(citesRule ? 0.85 : 0),
      source_bringer: clamp01(citesSource ? 0.75 : 0),
      story_worthy: clamp01(scorePatterns(t, STORY_WORTHY_PATTERNS)),
      repetitive: clamp01(scorePatterns(t, REPETITIVE_PATTERNS)),
      provocative: clamp01(scorePatterns(t, PROVOCATIVE_PATTERNS)),
    };

    // Determine dominant role by highest score.
    let dominantRole: ContributionRole = 'unknown';
    let maxScore = 0;
    for (const [role, score] of Object.entries(scores) as [ContributionRole, number][]) {
      if (score > maxScore) {
        maxScore = score;
        dominantRole = role;
      }
    }

    return {
      role: dominantRole,
      scores,
      confidence: clamp01(maxScore),
      citesRule,
      citesSource,
      directsAtOp,
    };
  } catch {
    return empty;
  }
}

/**
 * Merge two RoleSignalResults, averaging overlapping scores and taking the
 * max confidence dominant role. Used to combine heuristic with model outputs.
 */
export function mergeRoleSignals(
  a: RoleSignalResult,
  b: RoleSignalResult,
): RoleSignalResult {
  const allRoles = new Set([
    ...Object.keys(a.scores),
    ...Object.keys(b.scores),
  ]) as Set<ContributionRole>;

  const merged: Partial<Record<ContributionRole, number>> = {};
  for (const role of allRoles) {
    const sa = a.scores[role] ?? 0;
    const sb = b.scores[role] ?? 0;
    merged[role] = clamp01((sa + sb) / 2);
  }

  let dominantRole: ContributionRole = 'unknown';
  let maxScore = 0;
  for (const [role, score] of Object.entries(merged) as [ContributionRole, number][]) {
    if (score > maxScore) {
      maxScore = score;
      dominantRole = role;
    }
  }

  return {
    role: dominantRole,
    scores: merged,
    confidence: clamp01(maxScore),
    citesRule: a.citesRule || b.citesRule,
    citesSource: a.citesSource || b.citesSource,
    directsAtOp: a.directsAtOp || b.directsAtOp,
  };
}
