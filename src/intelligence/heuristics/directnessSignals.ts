// ─── Heuristics — Directness / Targeting Signals ─────────────────────────
// Distinguishes replies that engage a specific person's argument (point-
// addressing) from those that attack the person themselves (person-targeting).
//
// Point-addressing is healthy debate; person-targeting is a toxicity signal.
//
// Design constraints:
//   • Pure functions — no I/O.
//   • Fail-closed on any error.
//   • Returns typed feature objects only.

import { clamp01 } from '../context/limits';

// ─── Types ────────────────────────────────────────────────────────────────

export interface DirectnessSignalResult {
  /**
   * 'point' — engages the argument (healthy)
   * 'person' — targets the individual (unhealthy)
   * 'mixed' — both signals present
   * 'neutral' — neither strong signal
   */
  directnessKind: 'point' | 'person' | 'mixed' | 'neutral';
  /** Confidence that the directness classification is correct [0, 1]. */
  confidence: number;
  /** True if the reply contains constructive engagement signals. */
  constructive: boolean;
  /** True if the reply contains personal-targeting signals. */
  personalTargeting: boolean;
}

// ─── Patterns ─────────────────────────────────────────────────────────────

const POINT_ADDRESSING_PATTERNS = [
  // Engages the claim/argument rather than the person
  /\b(?:the (?:claim|argument|point|premise|assumption|logic|statement|reasoning|evidence|data) (?:that|you made|in (?:the|your) (?:post|reply|comment|tweet)))\b/i,
  /\b(?:your (?:argument|claim|point|reasoning|logic|position|premise) (?:is|isn'?t|seems?|doesn'?t|can'?t|doesn'?t hold))\b/i,
  /\b(?:this (?:article|post|claim|study|report|evidence|source) (?:says?|shows?|suggests?|doesn'?t))\b/i,
  /\b(?:the (?:source|evidence|data|report|study|research) (?:you|they|he|she) (?:cited|linked|shared|referenced))\b/i,
  /\b(?:that'?s (?:not what|not how|a mischaracterization of|missing (?:the point|context)|conflating))\b/i,
  /\b(?:the (?:actual|real|correct) (?:fact|number|data|figure|rule|policy) is)\b/i,
];

const PERSON_TARGETING_PATTERNS = [
  // Attacks the person rather than the argument
  /\b(?:you'?re (?:always|never|constantly|obviously|clearly|just|literally) (?:wrong|lying|dishonest|bad faith|trolling|a bot|a liar|a fraud))\b/i,
  /\b(?:you (?:people|lot|all) (?:always|never|just|are all))\b/i,
  /\b(?:someone like you|people like you|your (?:type|kind|sort)|you'?re that (?:type|kind|sort) of person)\b/i,
  /\b(?:you'?ve always|you?re never|you consistently|you habitually) \b/i,
  /\b(?:this is so (?:you|typical of you)|classic (?:you|behavior))\b/i,
];

const CONSTRUCTIVE_PATTERNS = [
  /\b(?:to (?:add|clarify|explain|expand|be fair|be honest)|fair point|good (?:point|question|observation)|that'?s (?:fair|valid|reasonable|a good point)|you'?re (?:right|correct|onto something))\b/i,
  /\b(?:i (?:understand|get|see|appreciate|respect) (?:your|that|the|this)|thanks? for (?:the|sharing|clarifying|the context))\b/i,
  /\b(?:let me (?:address|respond to|engage with) (?:that|your|this)|to (?:respond|address|engage with) (?:your|the|this))\b/i,
];

// ─── computeDirectnessSignals ─────────────────────────────────────────────

/**
 * Classify how a reply engages with the discussion — point vs person.
 *
 * Never throws — returns neutral result on error.
 */
export function computeDirectnessSignals(text: string): DirectnessSignalResult {
  const neutral: DirectnessSignalResult = {
    directnessKind: 'neutral',
    confidence: 0,
    constructive: false,
    personalTargeting: false,
  };

  if (!text || typeof text !== 'string') return neutral;

  try {
    const t = text.slice(0, 1_000);

    const pointCount = POINT_ADDRESSING_PATTERNS.filter(p => p.test(t)).length;
    const personCount = PERSON_TARGETING_PATTERNS.filter(p => p.test(t)).length;
    const constructive = CONSTRUCTIVE_PATTERNS.some(p => p.test(t));
    const personalTargeting = personCount > 0;

    const pointStrength = clamp01(pointCount * 0.35);
    const personStrength = clamp01(personCount * 0.40);

    let directnessKind: DirectnessSignalResult['directnessKind'] = 'neutral';
    let confidence = 0;

    if (pointStrength >= 0.30 && personStrength >= 0.30) {
      directnessKind = 'mixed';
      confidence = Math.max(pointStrength, personStrength);
    } else if (pointStrength >= 0.30) {
      directnessKind = 'point';
      confidence = pointStrength;
    } else if (personStrength >= 0.30) {
      directnessKind = 'person';
      confidence = personStrength;
    } else if (constructive) {
      directnessKind = 'point';
      confidence = 0.25;
    }

    return { directnessKind, confidence: clamp01(confidence), constructive, personalTargeting };
  } catch {
    return neutral;
  }
}
