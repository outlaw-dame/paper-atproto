/**
 * Client-side post sentiment and content analysis.
 *
 * Purpose: surface actionable pre-publish nudges to the author — not to
 * censor or block, but to give a moment of reflection before sending.
 *
 * Three levels:
 *   alert — potentially harmful language (slurs, self-harm encouragement)
 *   warn  — heated/aggressive tone or posts that may land better with context
 *   positive — constructive, supportive, or empathy-first framing
 *   ok    — nothing notable detected
 *
 * Reply-aware: when parentText is supplied (the post being replied to) the
 * analysis also considers the conversation context:
 *   - a heated parent post lowers the threshold for surfacing reply warnings
 *   - signals from the parent that explain the author's emotional state are
 *     surfaced so the author can see why the nudge appeared
 *
 * Entirely local; no network calls, no telemetry.
 */

export type SentimentLevel = 'ok' | 'positive' | 'warn' | 'alert';

export interface SentimentResult {
  level: SentimentLevel;
  /** Human-readable nudges to surface in the UI. Empty when level is 'ok'. */
  signals: string[];
  /** Positive-signal architecture: constructive framing detected in draft. */
  constructiveSignals: string[];
  /** Positive-signal architecture: supportive reply language detected in draft. */
  supportiveReplySignals: string[];
  /**
   * When analysing a reply, signals about the parent post that informed the
   * result. Shown to give the author context for why the notice appeared.
   */
  parentSignals: string[];
  /** True when the result was informed by the parent post content. */
  isReplyContext: boolean;
  /** Detected mental health crisis language. If true, show support resources. */
  hasMentalHealthCrisis: boolean;
  /** Specific mental health concern detected (e.g., 'self-harm', 'suicidal', 'severe-depression'). */
  mentalHealthCategory?: 'self-harm' | 'suicidal' | 'severe-depression' | 'hopelessness' | 'isolation';
}

// ─── Alert-level: harmful language ────────────────────────────────────────
const HARMFUL_PATTERNS: Array<{ re: RegExp; signal: string }> = [
  {
    re: /\b(kill\s+your?self|kys)\b/i,
    signal: 'Contains language that could encourage self-harm.',
  },
  {
    re: /\b(go\s+die|drop\s+dead)\b/i,
    signal: 'Contains language directing harm at others.',
  },
  {
    re: /\bf[a4*]gg?[o0*]t(s)?\b/i,
    signal: 'Contains a homophobic slur.',
  },
  {
    re: /\bn[i1!*][g9][g9][ae3*]r?(s)?\b/i,
    signal: 'Contains a racial slur.',
  },
  {
    re: /\br[e3*]t[a4*]rd(ed)?\b/i,
    signal: 'Contains ableist language.',
  },
  {
    re: /\bc[u*][n][t]\b/i,
    signal: 'Contains highly offensive language.',
  },
];

// ─── Mental Health Crisis Detection ────────────────────────────────────────
// Patterns that indicate the poster may be experiencing a mental health crisis
// These trigger supportive resource recommendations

const MENTAL_HEALTH_CRISIS_PATTERNS: Array<{
  re: RegExp;
  signal: string;
  category: 'self-harm' | 'suicidal' | 'severe-depression' | 'hopelessness' | 'isolation';
}> = [
  // Self-harm indicators
  {
    re: /\b(cut\s+(myself|my|arms?|wrists?)|cutting|self.?harm(ing)?|slash\s+my|hurt\s+myself)\b/i,
    signal: 'Mentions self-harm behaviors.',
    category: 'self-harm',
  },
  {
    re: /\b(im\s+going\s+to\s+hurt|want\s+to\s+hurt|urge\s+to\s+(cut|harm))\b/i,
    signal: 'Expresses intent to self-harm.',
    category: 'self-harm',
  },

  // Suicidal ideation indicators
  {
    re: /\b(want\s+to\s+die|wanna\s+die|wish\s+i\s+(was\s+)?dead|want\s+to\s+end\s+it|suicide|suicidal|kill\s+myself)\b/i,
    signal: 'Mentions suicidal thoughts.',
    category: 'suicidal',
  },
  {
    re: /\b(no\s+point|no\s+reason\s+to\s+live|better\s+off\s+dead|nobody\s+cares|not\s+worth\s+it)\b/i,
    signal: 'Expresses hopelessness about life.',
    category: 'hopelessness',
  },

  // Severe depression / despair
  {
    re: /\b(everything\s+is\s+hopeless|can't\s+take\s+this\s+anymore|unbearable\s+pain|empty\s+inside|numb\s+all\s+the\s+time)\b/i,
    signal: 'Describes severe emotional distress.',
    category: 'severe-depression',
  },
  {
    re: /\b(darkest\s+(place|time)|rock\s+bottom|drowning|suffocating)\b/i,
    signal: 'Uses language suggesting intense emotional crisis.',
    category: 'severe-depression',
  },

  // Isolation & loneliness
  {
    re: /\b(completely\s+alone|no\s+one\s+(cares|understands|will\s+help)|isolation|totally\s+isolated)\b/i,
    signal: 'Expresses severe isolation or alienation.',
    category: 'isolation',
  },
];

// ─── Warn-level: aggressive tone or strong negative framing ───────────────
const HEATED_PATTERNS: Array<{ re: RegExp; signal: string }> = [
  {
    re: /\b(kill|destroy|annihilate|obliterate)\b.{0,40}(you|him|her|them|these\s+people|those\s+people)/i,
    signal: 'Aggressive framing directed at people — readers may react strongly.',
  },
  {
    re: /\b(i\s+hate|i\s+despise|i\s+loathe)\s+(you|him|her|them|everyone|you\s+all)\b/i,
    signal: 'Intense negative feelings directed at people.',
  },
  {
    re: /\b(shut\s+up|stfu|go\s+f[*u][*c][*k])\b/i,
    signal: 'Dismissive or vulgar language directed at others.',
  },
  {
    re: /\b(stupid|idiotic|moronic|brainless)\s+(people|person|everyone|anyone|liberals|conservatives|women|men)\b/i,
    signal: 'Broad negative characterisation of a group — consider being more specific.',
  },
  {
    re: /\b(this|that|it|you|they|he|she|these|those)\s+(is|are|was|were)\s+(stupid|idiotic|moronic|pathetic|garbage|trash)\b/i,
    signal: 'Blunt negative framing can escalate a reply quickly — consider adding a little more context.',
  },
];

// ─── Positive-level: constructive / supportive framing ────────────────────
const SUPPORTIVE_REPLY_PATTERNS: Array<{ re: RegExp; signal: string }> = [
  {
    re: /\b(i\s+can\s+relate|i\s+hear\s+you|i\s+understand|that\s+sounds\s+really\s+hard)\b/i,
    signal: 'Empathy-first framing can help the other person feel heard.',
  },
  {
    re: /\b((i'?m|i\s+am)\s+sorry\s+(you'?re|you\s+are)|sorry\s+you'?re\s+dealing\s+with|sorry\s+you\s+are\s+going\s+through)\b/i,
    signal: 'Your wording acknowledges what the other person is going through.',
  },
  {
    re: /\b(no\s+pressure|if\s+it\s+helps|if\s+you\s+want|only\s+if\s+you\s+want|take\s+your\s+time)\b/i,
    signal: 'Low-pressure language keeps suggestions supportive instead of pushy.',
  },
  {
    re: /\b(you'?re\s+not\s+alone|sending\s+love|rooting\s+for\s+you|wishing\s+you\s+well|here\s+for\s+you)\b/i,
    signal: 'Supportive reassurance is likely to land positively.',
  },
];

const CONSTRUCTIVE_SIGNAL_PATTERNS: Array<{ re: RegExp; signal: string }> = [
  {
    re: /\b(here'?s\s+(a\s+)?(resource|book|idea|suggestion)|you\s+might\s+find\s+this\s+helpful|what\s+helped\s+me\s+was)\b/i,
    signal: 'Offering concrete help in a gentle way is constructive.',
  },
  {
    re: /\b(in\s+my\s+experience|from\s+my\s+experience|when\s+i\s+was\s+dealing\s+with|i\s+went\s+through\s+something\s+similar)\b/i,
    signal: 'Adding personal context can make a reply feel more grounded and sincere.',
  },
  {
    re: /\b(i\s+learned\s+that|what\s+worked\s+for\s+me|one\s+thing\s+that\s+helped\s+me)\b/i,
    signal: 'Sharing what helped you adds practical context for the other person.',
  },
];

// ─── Parent-post heat detection ────────────────────────────────────────────
// Patterns that indicate the post being replied to is already heated.
// When any match, the reply gets a lower threshold for surfacing warnings.

const PARENT_HEAT_PATTERNS: Array<{ re: RegExp; signal: string }> = [
  {
    re: /\b(you\s+are|you're|ur)\s+(wrong|lying|a\s+liar|delusional|an\s+idiot|stupid)\b/i,
    signal: "The original post directly challenges someone's position aggressively.",
  },
  {
    re: /\b(shut\s+up|get\s+lost|f[*u][ck][ck]\s+off|go\s+away)\b/i,
    signal: 'The original post uses dismissive or hostile language.',
  },
  {
    re: /\b(everyone\s+who|people\s+who|anyone\s+who).{0,40}(deserves?|should\s+be|is\s+an?\s+(idiot|moron|loser))\b/i,
    signal: 'The original post makes sweeping negative judgements about groups.',
  },
  {
    re: /\b(cancel|ratio|dragged|destroyed|owned|rekt)\b/i,
    signal: 'The original post uses combative social-media language.',
  },
  {
    re: /\b(fight\s+me|come\s+at\s+me|i\s+dare\s+you)\b/i,
    signal: 'The original post is inviting confrontation.',
  },
];

// Topics that are commonly heated in social-media discourse.
// When the parent mentions these, even a mildly negative reply gets a nudge.
const CONTENTIOUS_TOPIC_RE =
  /\b(abortion|gun\s+control|immigration|trans\s+rights|critical\s+race|election\s+(fraud|integrity)|vaccine|antivaxx?|climate\s+(change|denial)|roe\s+v\s+wade|blm|antifa|proud\s+boys|qanon)\b/i;

// ─── Structural / context signals ─────────────────────────────────────────

function detectStructuralSignals(text: string): string[] {
  const signals: string[] = [];

  // Heavy ALL-CAPS (> 55 % of alpha chars, text long enough to matter)
  const letters = text.replace(/[^a-zA-Z]/g, '');
  if (letters.length > 24) {
    const upperCount = (text.match(/[A-Z]/g) ?? []).length;
    if (upperCount / letters.length > 0.55) {
      signals.push('Heavy caps usage can come across as shouting — is that the intent?');
    }
  }

  // Excessive exclamation marks
  if ((text.match(/!/g) ?? []).length >= 3) {
    signals.push('Lots of exclamation marks — the emotional intensity may overshadow the message.');
  }

  // Short assertive take with negative framing
  const words = text.trim().split(/\s+/);
  const CONTEXT_TRIGGERS = [
    'wrong', 'liar', 'lies', 'lying', 'fake', 'fraud', 'corrupt',
    'evil', 'garbage', 'trash', 'stupid', 'idiot', 'pathetic', 'disgusting',
    'always', 'never', 'everyone', 'nobody',
  ];
  if (words.length <= 14) {
    const lower = text.toLowerCase();
    const hit = CONTEXT_TRIGGERS.find(w => new RegExp(`\\b${w}\\b`).test(lower));
    if (hit) {
      signals.push('Short takes with strong claims sometimes land better with a bit more context.');
    }
  }

  return signals;
}

/** Returns heat signals from the parent post (shown to the reply author). */
function analyzeParent(parentText: string): { heatSignals: string[]; isContentious: boolean } {
  const heatSignals: string[] = [];
  for (const { re, signal } of PARENT_HEAT_PATTERNS) {
    if (re.test(parentText)) {
      heatSignals.push(signal);
    }
  }
  const isContentious = CONTENTIOUS_TOPIC_RE.test(parentText);
  return { heatSignals, isContentious };
}

/** Detects mental health crisis language in text. */
function detectMentalHealthCrisis(
  text: string,
): { hasCrisis: boolean; category?: 'self-harm' | 'suicidal' | 'severe-depression' | 'hopelessness' | 'isolation' } {
  for (const { re, category } of MENTAL_HEALTH_CRISIS_PATTERNS) {
    if (re.test(text)) {
      return { hasCrisis: true, category };
    }
  }
  return { hasCrisis: false };
}

// ─── Public API ────────────────────────────────────────────────────────────

export interface AnalyzeOptions {
  /**
   * The text of the post being replied to. When provided the analysis becomes
   * context-aware: parent heat lowers the reply's warning threshold.
   */
  parentText?: string;
  /** Approximate number of replies on the parent post. */
  parentReplyCount?: number;
  /** Approximate size/depth signal of the related thread. */
  parentThreadCount?: number;
  /** Full thread post texts (including root and major threaded posts). */
  threadTexts?: string[];
  /** Comment/reply texts seen in the thread. */
  commentTexts?: string[];
  /** Aggregate comments/replies count if available. */
  totalCommentCount?: number;
}

export function analyzeSentiment(text: string, options: AnalyzeOptions = {}): SentimentResult {
  const trimmed = text.trim();
  const {
    parentText,
    parentReplyCount = 0,
    parentThreadCount = 0,
    threadTexts = [],
    commentTexts = [],
    totalCommentCount = 0,
  } = options;

  // Check for mental health crisis language immediately
  const mentalHealthCrisis = detectMentalHealthCrisis(trimmed);

  const isMediumActivityThread =
    parentReplyCount >= 25 ||
    parentThreadCount >= 10 ||
    totalCommentCount >= 25;
  const isLargeActivityThread =
    parentReplyCount >= 100 ||
    parentThreadCount >= 20 ||
    totalCommentCount >= 100;
  const isHighActivityThread = isMediumActivityThread || isLargeActivityThread;

  // Analyse the parent post independently of draft length.
  const parentAnalysis = parentText ? analyzeParent(parentText) : null;
  const parentSignals = parentAnalysis?.heatSignals ?? [];
  const parentIsHot = (parentAnalysis?.heatSignals.length ?? 0) > 0;
  const parentIsContentious = parentAnalysis?.isContentious ?? false;

  const threadContextTexts = [...threadTexts, ...commentTexts]
    .map(t => t.trim())
    .filter(Boolean)
    .slice(0, 20);
  let contextHeatHits = 0;
  let contextContentiousHits = 0;
  for (const contextText of threadContextTexts) {
    const contextAnalysis = analyzeParent(contextText);
    if (contextAnalysis.heatSignals.length > 0) {
      contextHeatHits += 1;
    }
    if (contextAnalysis.isContentious) {
      contextContentiousHits += 1;
    }
  }

  const threadContextIsHot = contextHeatHits >= 2;
  const threadContextIsContentious = contextContentiousHits >= 2;
  const conversationIsHot = parentIsHot || threadContextIsHot;
  const conversationIsContentious = parentIsContentious || threadContextIsContentious;

  if (isHighActivityThread) {
    parentSignals.push('This is a high-activity thread — supportive and specific replies tend to help the original poster most.');
  }
  if (threadContextIsHot) {
    parentSignals.push('Multiple replies in this thread are already heated — a calm tone is more likely to help.');
  }
  if (threadContextIsContentious) {
    parentSignals.push('Thread comments show recurring contentious themes — context-rich replies tend to land better.');
  }

  // In reply context, lower the baseline threshold because short replies are
  // often the sharpest ones and should still receive a tone nudge.
  const minLength = conversationIsHot || conversationIsContentious
    ? 5
    : isLargeActivityThread
      ? 4
      : isHighActivityThread
      ? 6
      : parentText
        ? 8
        : 20;

  // Alert: harmful language always takes priority.
  for (const { re, signal } of HARMFUL_PATTERNS) {
    if (re.test(trimmed)) {
      return {
        level: 'alert',
        signals: [signal],
        constructiveSignals: [],
        supportiveReplySignals: [],
        parentSignals,
        isReplyContext: !!parentText,
        hasMentalHealthCrisis: mentalHealthCrisis.hasCrisis,
        mentalHealthCategory: mentalHealthCrisis.category,
      };
    }
  }

  // Warn: heated tone patterns in the reply draft.
  const warnSignals: string[] = [];
  for (const { re, signal } of HEATED_PATTERNS) {
    if (re.test(trimmed)) {
      warnSignals.push(signal);
    }
  }

  // Warn: structural nudges.
  const structuralSignals = detectStructuralSignals(trimmed);

  // Positive: supportive and constructive framing in the draft.
  const supportiveReplySignals: string[] = [];
  const constructiveSignals: string[] = [];
  for (const { re, signal } of SUPPORTIVE_REPLY_PATTERNS) {
    if (re.test(trimmed)) {
      supportiveReplySignals.push(signal);
    }
  }
  for (const { re, signal } of CONSTRUCTIVE_SIGNAL_PATTERNS) {
    if (re.test(trimmed)) {
      constructiveSignals.push(signal);
    }
  }

  if (
    trimmed.length < minLength
    && warnSignals.length === 0
    && structuralSignals.length === 0
    && supportiveReplySignals.length === 0
    && constructiveSignals.length === 0
    && !conversationIsHot
    && !conversationIsContentious
  ) {
    return {
      level: 'ok',
      signals: [],
      constructiveSignals: [],
      supportiveReplySignals: [],
      parentSignals,
      isReplyContext: !!parentText,
      hasMentalHealthCrisis: mentalHealthCrisis.hasCrisis,
      mentalHealthCategory: mentalHealthCrisis.category,
    };
  }

  // Extra nudge when replying into a heated or contentious thread.
  if (conversationIsHot) {
    warnSignals.push("You're replying to a heated post — take a breath before sending.");
  } else if (conversationIsContentious && trimmed.length > 5) {
    warnSignals.push("This thread touches a contentious topic — replies tend to attract strong reactions.");
  }

  if (isLargeActivityThread && (warnSignals.length > 0 || structuralSignals.length > 0)) {
    warnSignals.push('Large threads can amplify tone quickly — adding a little care or context can prevent pile-ons.');
  }

  const allWarn = [...warnSignals, ...structuralSignals];
  if (allWarn.length > 0) {
    return {
      level: 'warn',
      signals: allWarn,
      constructiveSignals: [],
      supportiveReplySignals: [],
      parentSignals,
      isReplyContext: !!parentText,
      hasMentalHealthCrisis: mentalHealthCrisis.hasCrisis,
      mentalHealthCategory: mentalHealthCrisis.category,
    };
  }

  const allPositiveSignals = [...supportiveReplySignals, ...constructiveSignals];
  if (allPositiveSignals.length > 0) {
    return {
      level: 'positive',
      signals: Array.from(new Set(allPositiveSignals)).slice(0, 3),
      constructiveSignals: Array.from(new Set(constructiveSignals)).slice(0, 3),
      supportiveReplySignals: Array.from(new Set(supportiveReplySignals)).slice(0, 3),
      parentSignals,
      isReplyContext: !!parentText,
      hasMentalHealthCrisis: mentalHealthCrisis.hasCrisis,
      mentalHealthCategory: mentalHealthCrisis.category,
    };
  }

  return {
    level: 'ok',
    signals: [],
    constructiveSignals: [],
    supportiveReplySignals: [],
    parentSignals,
    isReplyContext: !!parentText,
    hasMentalHealthCrisis: mentalHealthCrisis.hasCrisis,
    mentalHealthCategory: mentalHealthCrisis.category,
  };
}
