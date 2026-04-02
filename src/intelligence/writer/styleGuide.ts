// ─── Writer — Style Guide ─────────────────────────────────────────────────
// Shared style constants and rules for all writer surfaces.
// Keeps wording stable across StoryMode, Search Story, Explore synopsis,
// and future explanation surfaces.
//
// Design constraints:
//   • Constants only — no functions, no side effects.
//   • All string values are safe for direct interpolation into prompts and UI.

// ─── Length caps (characters) ─────────────────────────────────────────────

export const STYLE = {
  // Collapsed summary: shown in collapsed/preview state.
  COLLAPSED_SUMMARY_MAX_LEN: 320,
  // Expanded summary: shown when the user expands the Interpolator.
  EXPANDED_SUMMARY_MAX_LEN: 520,
  // Contributor blurb: one sentence per contributor.
  BLURB_MAX_LEN: 160,
  // "What changed" signal: each item in the whatChanged array.
  WHAT_CHANGED_ITEM_MAX_LEN: 90,
  // Explore synopsis (collapsed): short card text.
  EXPLORE_SYNOPSIS_MAX_LEN: 280,
  // Explore synopsis (short): used in dense list views.
  EXPLORE_SHORT_SYNOPSIS_MAX_LEN: 120,
  // Maximum number of contributor blurbs.
  MAX_BLURBS: 4,
  // Maximum number of whatChanged items.
  MAX_WHAT_CHANGED: 5,
} as const;

// ─── Tone guidelines ──────────────────────────────────────────────────────

/** Verbs to use when attributing statements to users. Prefer these over direct quotes. */
export const ATTRIBUTION_VERBS = [
  'writes that',
  'argues that',
  'notes that',
  'asks',
  'reflects that',
  'suggests that',
  'observes that',
  'claims that',
  'announces that',
  'shares that',
] as const;

/** Phrases used when the thread is still forming / low confidence. */
export const FORMING_PHRASES = [
  'This thread is still developing.',
  'Early responses are still forming.',
  'Discussion is just starting.',
  'Replies are beginning to shape the conversation.',
] as const;

/** Phrases used to signal partial interpretive confidence. */
export const UNCERTAINTY_PHRASES = [
  'This is an early or developing thread.',
  'Limited thread data is available.',
  'The conversation is still evolving.',
  'Context may be incomplete at this point.',
] as const;

// ─── Role → blurb role label ──────────────────────────────────────────────

export const ROLE_LABELS: Record<string, string> = {
  op: 'posted this',
  clarifier: 'added clarification',
  'source-bringer': 'brought a source',
  counterpoint: 'offered a counterpoint',
  'context-setter': 'added context',
  'emotional-reaction': 'reacted strongly',
  'rule-source': 'cited a rule or policy',
  'question-raiser': 'raised a question',
} as const;

// ─── Prohibited output patterns ───────────────────────────────────────────

/**
 * Patterns that should never appear in writer output.
 * Used by outputValidator to reject or sanitize model responses.
 */
export const PROHIBITED_OUTPUT_PATTERNS: RegExp[] = [
  // Over-generalized reply activity
  /\b(?:replies are active|people are reacting|the discussion continues|early voices are shaping|the conversation continues)\b/i,
  // Unsupported confident stance claims
  /\b(?:everyone agrees|the consensus is|it'?s clear that|obviously|undeniably|indisputably)\b/i,
  // Direct advice to the user
  /\b(?:you should|you must|you need to|i recommend|i suggest|my advice is|here'?s how to)\b/i,
];

/**
 * Patterns that indicate the model simply regurgitated the root post.
 * When matched, the output should be replaced with the deterministic fallback.
 */
export const REGURGITATION_PATTERNS: RegExp[] = [
  /^@\w+ (?:writes?|says?|states?):?\s+.{100,}$/i,
];
