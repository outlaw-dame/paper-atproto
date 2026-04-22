// ─── Heuristics — Heat / Escalation Signals ───────────────────────────────
// Deterministic thread-heat and escalation signal detection.
// "Heat" = emotional temperature, not sentiment valence.
//
// Heat can be present in positive enthusiasm just as much as hostile arguments.
// The key signals are intensity markers, not polarity.
//
// Design constraints:
//   • Pure functions — no I/O.
//   • Fail-closed on any error.
//   • Safe for adversarial strings (empty, repeated punctuation, emoji spam).

import { clamp01 } from '../context/limits';

// ─── Types ────────────────────────────────────────────────────────────────

export interface HeatSignalResult {
  /** Overall heat score [0, 1]. */
  heat: number;
  /** True if this reply contains a direct personal attack. */
  personalAttack: boolean;
  /** True if pile-on dynamics are detectable (see pileOnSignals for full detection). */
  indicatesPileOn: boolean;
  /** True if this reply escalates rather than resolves tension. */
  escalating: boolean;
  /** True if this reply de-escalates or validates. */
  deEscalating: boolean;
  /** Number of exclamation marks (capped). */
  exclamationCount: number;
  /** True if ALL-CAPS words are present. */
  hasCapsWords: boolean;
}

// ─── Patterns ─────────────────────────────────────────────────────────────

const PERSONAL_ATTACK_PATTERNS = [
  /\b(?:you'?re (?:wrong|lying|a liar|an idiot|delusional|pathetic|stupid|clueless|a bot|a shill|a troll))\b/i,
  /\b(?:you (?:don'?t|can'?t) (?:understand|read|think)|you (?:obviously|clearly|just) (?:don'?t|can'?t|won'?t))\b/i,
  /\b(?:idiot|moron|stupid|pathetic|clueless|delusional|clown|imbecile|dumbass|dimwit)\b/i,
  /\b(?:shut up|go away|block me|get a (?:life|clue)|touch grass)\b/i,
];

const ESCALATING_PATTERNS = [
  /\b(?:this is (?:unacceptable|outrageous|disgusting|absurd|ridiculous)|i'?m done|enough is enough|final warning|last time)\b/i,
  /\b(?:wake up|grow up|learn to (?:read|think|listen)|you people)\b/i,
  /[!]{3,}/,
  /\b(?:cope|seethe|mald|ratio[d]?|owned|destroyed|demolished|ratioed)\b/i,
];

const DE_ESCALATING_PATTERNS = [
  /\b(?:i (?:understand|get it|can see (?:that|why|how)|appreciate)|fair (?:point|enough)|that'?s (?:fair|a good point|valid|reasonable))\b/i,
  /\b(?:i (?:don'?t mean to|didn'?t mean to|wasn'?t trying to)|to be fair|to be honest|honestly though|no hard feelings)\b/i,
  /\b(?:let'?s (?:take a step back|calm down|be civil|agree to disagree))\b/i,
  /\b(?:thanks for (?:sharing|the context|clarifying|the response|the reply)|good point|well said)\b/i,
];

const PILE_ON_INDICATORS = [
  /\b(?:everyone|everyone'?s|everybody|literally everyone) (?:knows?|can see|agrees?|is saying)\b/i,
  /\b(?:join the club|not alone|we all|you'?re not the only)\b/i,
  /\b(?:ratio|ratioed|ratioing)\b/i,
];

// ALL-CAPS words (4+ consecutive uppercase letters, not acronyms like URL/CNN)
const CAPS_WORD_RE = /\b[A-Z]{4,}\b/;

// ─── computeHeatSignals ───────────────────────────────────────────────────

/**
 * Compute heat/escalation signals for a single reply text.
 *
 * Never throws — returns a zero-heat result on error.
 */
export function computeHeatSignals(text: string): HeatSignalResult {
  const zero: HeatSignalResult = {
    heat: 0,
    personalAttack: false,
    indicatesPileOn: false,
    escalating: false,
    deEscalating: false,
    exclamationCount: 0,
    hasCapsWords: false,
  };

  if (!text || typeof text !== 'string') return zero;

  try {
    const t = text.slice(0, 1_000);

    const personalAttack = PERSONAL_ATTACK_PATTERNS.some(p => p.test(t));
    const escalating = ESCALATING_PATTERNS.some(p => p.test(t));
    const deEscalating = DE_ESCALATING_PATTERNS.some(p => p.test(t));
    const indicatesPileOn = PILE_ON_INDICATORS.some(p => p.test(t));
    const hasCapsWords = CAPS_WORD_RE.test(t);
    const exclamationCount = Math.min(20, (t.match(/!/g) ?? []).length);

    // Heat formula:
    //   personal attack   → +0.45 (strongest single signal)
    //   escalating        → +0.30
    //   de-escalating     → -0.25 (lowers heat)
    //   caps words        → +0.10
    //   exclamation count → +0.025 per (capped at +0.20)
    //   pile-on           → +0.15
    let heat = 0;
    if (personalAttack) heat += 0.45;
    if (escalating) heat += 0.30;
    if (deEscalating) heat -= 0.25;
    if (hasCapsWords) heat += 0.10;
    heat += Math.min(0.20, exclamationCount * 0.025);
    if (indicatesPileOn) heat += 0.15;

    return {
      heat: clamp01(heat),
      personalAttack,
      indicatesPileOn,
      escalating,
      deEscalating,
      exclamationCount,
      hasCapsWords,
    };
  } catch {
    return zero;
  }
}

/**
 * Aggregate heat signal across a list of texts.
 * Returns the average heat and the fraction of posts that are high-heat (>= 0.6).
 */
export function aggregateHeatSignals(texts: string[]): {
  averageHeat: number;
  highHeatFraction: number;
  hasPersonalAttack: boolean;
} {
  if (!texts?.length) return { averageHeat: 0, highHeatFraction: 0, hasPersonalAttack: false };

  try {
    const results = texts.map(computeHeatSignals);
    const avg = results.reduce((s, r) => s + r.heat, 0) / results.length;
    const highCount = results.filter(r => r.heat >= 0.60).length;
    const hasPersonalAttack = results.some(r => r.personalAttack);
    return {
      averageHeat: clamp01(avg),
      highHeatFraction: clamp01(highCount / results.length),
      hasPersonalAttack,
    };
  } catch {
    return { averageHeat: 0, highHeatFraction: 0, hasPersonalAttack: false };
  }
}
