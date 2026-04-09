// ─── Safety Filters for LLM Responses ─────────────────────────────────────
// Applies content moderation filters to writer and analyzer outputs.
// Implements profanity filtering, hate speech detection, and sensitive content removal.

// ─── Profanity & Offensive Content Dictionary ──────────────────────────────

const PROFANITY_PATTERNS = [
  // Common profanities (asterisked and full forms)
  /\b(f[u\*]ck|sh[i\*]t|damn|hell|crap)\w*/gi,
  /\b(a[ss\*]+hole|b[i\*]tch|bastard)\b/gi,
  // Slurs and hateful terms (intentionally sparse to avoid accidental triggers)
  /\b(fagg?[o\*]t|n[i\*]gg[ae\*]r|r[e\*]tard)\b/gi,
  // Common racist/discriminatory terms
  /\b(k[i\*]ke|cr[a\*]cker|ch[i\*]nk)\b/gi,
];

// ─── Hate Speech Keywords ─────────────────────────────────────────────────

const HATE_SPEECH_INDICATORS = [
  'should be eradicated',
  'subhuman',
  'deserve to die',
  'go back to',
  'illegal invader',
  'race traitor',
  'cultural replacement',
  'white genocide',
  'gas chamber',
  'lynch',
];

// ─── Sexual Content Patterns ──────────────────────────────────────────────

const SEXUAL_CONTENT_PATTERNS = [
  /\b(porn|xxx|18\+|nude|sex tape|explicit)\b/gi,
  /\b(cum|semen|orgasm|masturbat(e|ion))\b/gi,
  /\b(prostitut|escort service|call girl)\b/gi,
  /\b(nsfw|smut|erotic|fetish|kink|hook\s?up|one[-\s]?night stand)\b/gi,
  /\b(horny|turned\s+on|thirsty\s+for)\b/gi,
];

const FORMAL_SEXUAL_REPLACEMENTS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\b(porn|xxx|smut)\b/gi, replacement: 'explicit sexual content' },
  { pattern: /\b(nsfw)\b/gi, replacement: 'adult content' },
  { pattern: /\b(nude)\b/gi, replacement: 'nudity' },
  { pattern: /\b(sex tape)\b/gi, replacement: 'sexually explicit recording' },
  { pattern: /\b(cum|semen)\b/gi, replacement: 'sexual fluid' },
  { pattern: /\b(orgasm)\b/gi, replacement: 'sexual climax' },
  { pattern: /\b(masturbat(e|ion))\b/gi, replacement: 'self-stimulation' },
  { pattern: /\b(prostitut|escort service|call girl)\b/gi, replacement: 'commercial sexual services' },
  { pattern: /\b(hook\s?up|one[-\s]?night stand)\b/gi, replacement: 'casual sexual encounter' },
  { pattern: /\b(horny|turned\s+on|thirsty\s+for)\b/gi, replacement: 'sexually aroused' },
  { pattern: /\b(fetish|kink)\b/gi, replacement: 'sexual preference' },
  { pattern: /\b(explicit)\b/gi, replacement: 'graphic' },
];

// ─── Violence & Harm Patterns ──────────────────────────────────────────────

const VIOLENCE_PATTERNS = [
  /\b(bomb|explosive|attack|kill|murder|dismember)\b/gi,
  /\b(shoot|stab|strangle|poison|overdose)\b/gi,
  /\b(kidnap|torture|rape|assault)\b/gi,
];

// ─── Misinformation Keywords ──────────────────────────────────────────────

const MISINFORMATION_TRIGGERS = [
  'unverified',
  'alleged conspiracy',
  'no credible evidence',
  'debunked claim',
  'false narrative',
];

// ─── Out-of-scope Advice Patterns ────────────────────────────────────────

const OUT_OF_SCOPE_ADVICE_PATTERNS = [
  /\b(you should|you must|you need to|you ought to)\b/gi,
  /\b(i recommend|i suggest|my advice is)\b/gi,
  /\b(here'?s how to|steps to|best way to)\b/gi,
];

// ─── Safety Filter Result Type ────────────────────────────────────────────

export interface SafetyFilterResult {
  passed: boolean;
  flagged: boolean;
  categories: string[];
  severity: 'none' | 'low' | 'medium' | 'high';
  reason?: string;
  filtered: string;
}

const SEVERITY_RANK: Record<SafetyFilterResult['severity'], number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

function bumpSeverity(
  current: SafetyFilterResult['severity'],
  next: SafetyFilterResult['severity']
): SafetyFilterResult['severity'] {
  return SEVERITY_RANK[next] > SEVERITY_RANK[current] ? next : current;
}

function mergeSeverity(
  current: SafetyFilterResult['severity'],
  result: SafetyFilterResult
): SafetyFilterResult['severity'] {
  return bumpSeverity(current, result.severity);
}

// ─── Main Filter Functions ────────────────────────────────────────────────

/**
 * Apply comprehensive safety filters to text content.
 * Returns filtered text and safety classification.
 */
export function filterTextContent(text: string): SafetyFilterResult {
  if (!text || typeof text !== 'string') {
    return {
      passed: true,
      flagged: false,
      categories: [],
      severity: 'none',
      filtered: text || '',
    };
  }

  const flags: string[] = [];
  let severity: 'none' | 'low' | 'medium' | 'high' = 'none';
  let filtered = text;

  // Check for profanity
  if (hasProfanity(text)) {
    flags.push('profanity');
    severity = 'low';
    filtered = replaceProfanity(filtered);
  }

  // Check for hate speech
  if (hasHateSpeech(text)) {
    flags.push('hate_speech');
    severity = 'high';
    return {
      passed: false,
      flagged: true,
      categories: flags,
      severity,
      reason: 'Hate speech detected',
      filtered: '',
    };
  }

  // Check for sexual content
  if (hasSexualContent(text)) {
    flags.push('sexual_content');
    severity = bumpSeverity(severity, 'medium');
    filtered = normalizeSexualLanguage(filtered);
  }

  // Check for violence/harm
  if (hasViolenceContent(text)) {
    flags.push('violence');
    severity = 'medium';
  }

  // Check for misinformation flags
  if (hasMisinformationFlag(text)) {
    flags.push('potential_misinformation');
    severity = bumpSeverity(severity, 'low');
  }

  // The interpolator should summarize, not prescribe actions.
  if (hasOutOfScopeAdvice(text)) {
    flags.push('out_of_scope_advice');
    severity = bumpSeverity(severity, 'low');
    OUT_OF_SCOPE_ADVICE_PATTERNS.forEach((pattern) => {
      filtered = filtered.replace(pattern, '[redacted]');
    });
  }

  return {
    passed: severity !== 'high',
    flagged: flags.length > 0,
    categories: flags,
    severity,
    filtered,
  };
}

/**
 * Filter an object containing text fields (e.g., writer response).
 */
export function filterWriterResponse(response: Record<string, any>): { filtered: Record<string, any>; safetyMetadata: SafetyFilterResult } {
  const textFields = [
    'collapsedSummary',
    'expandedSummary',
    'whatChanged',
    'contributorBlurbs',
    'synopsis',
    'shortSynopsis',
  ];

  let overallSeverity: 'none' | 'low' | 'medium' | 'high' = 'none';
  const allFlags = new Set<string>();
  const filtered = { ...response };

  for (const field of textFields) {
    if (field in filtered && typeof filtered[field] === 'string') {
      const result = filterTextContent(filtered[field]);
      filtered[field] = result.filtered;

      // Aggregate safety metadata
      result.categories.forEach(c => allFlags.add(c));
      overallSeverity = mergeSeverity(overallSeverity, result);
    }
  }

  // Filter arrays of strings
  if (Array.isArray(filtered.whatChanged)) {
    filtered.whatChanged = filtered.whatChanged.map((item: string) => {
      const result = filterTextContent(item);
      result.categories.forEach(c => allFlags.add(c));
      overallSeverity = mergeSeverity(overallSeverity, result);
      return result.filtered;
    });
  }

  if (Array.isArray(filtered.contributorBlurbs)) {
    filtered.contributorBlurbs = filtered.contributorBlurbs
      .map((item: unknown) => {
        if (typeof item === 'string') {
          const result = filterTextContent(item);
          result.categories.forEach(c => allFlags.add(c));
          overallSeverity = mergeSeverity(overallSeverity, result);
          return result.filtered;
        }

        if (typeof item === 'object' && item !== null) {
          const entry = item as { handle?: unknown; blurb?: unknown };
          const handleText = typeof entry.handle === 'string' ? entry.handle : '';
          const blurbText = typeof entry.blurb === 'string' ? entry.blurb : '';
          const handleResult = filterTextContent(handleText);
          const blurbResult = filterTextContent(blurbText);
          handleResult.categories.forEach(c => allFlags.add(c));
          blurbResult.categories.forEach(c => allFlags.add(c));
          overallSeverity = mergeSeverity(overallSeverity, handleResult);
          overallSeverity = mergeSeverity(overallSeverity, blurbResult);
          return {
            handle: handleResult.filtered,
            blurb: blurbResult.filtered,
          };
        }

        return null;
      })
      .filter((item: unknown) => item !== null);
  }

  return {
    filtered,
    safetyMetadata: {
      passed: overallSeverity !== 'high',
      flagged: allFlags.size > 0,
      categories: Array.from(allFlags),
      severity: overallSeverity,
      filtered: '',
    },
  };
}

/**
 * Filter a premium deep interpolator response.
 * Premium output is additive, so fail closed if the primary summary becomes unsafe.
 */
export function filterPremiumDeepInterpolatorResponse(
  response: Record<string, any>
): { filtered: Record<string, any>; safetyMetadata: SafetyFilterResult } {
  let overallSeverity: 'none' | 'low' | 'medium' | 'high' = 'none';
  let blocked = false;
  const allFlags = new Set<string>();
  const filtered = { ...response };

  const applyTextField = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    const result = filterTextContent(value);
    result.categories.forEach((category) => allFlags.add(category));
    overallSeverity = mergeSeverity(overallSeverity, result);
    if (!result.passed) blocked = true;
    return result.filtered;
  };

  filtered.summary = applyTextField(filtered.summary);

  if (typeof filtered.groundedContext === 'string') {
    filtered.groundedContext = applyTextField(filtered.groundedContext);
    if (!filtered.groundedContext.trim()) {
      delete filtered.groundedContext;
    }
  }

  if (Array.isArray(filtered.perspectiveGaps)) {
    filtered.perspectiveGaps = filtered.perspectiveGaps
      .map((value: unknown) => applyTextField(value))
      .filter((value: string) => value.trim().length > 0);
  }

  if (Array.isArray(filtered.followUpQuestions)) {
    filtered.followUpQuestions = filtered.followUpQuestions
      .map((value: unknown) => applyTextField(value))
      .filter((value: string) => value.trim().length > 0);
  }

  const hasSummary = typeof filtered.summary === 'string' && filtered.summary.trim().length > 0;
  const passed = !blocked && hasSummary;

  return {
    filtered,
    safetyMetadata: {
      passed,
      flagged: allFlags.size > 0,
      categories: Array.from(allFlags),
      severity: overallSeverity,
      filtered: hasSummary ? filtered.summary : '',
      ...(!passed ? { reason: 'Premium deep interpolator output failed safety filtering' } : {}),
    },
  };
}

/**
 * Filter media analyzer response.
 */
export function filterMediaAnalyzerResponse(response: Record<string, any>): { filtered: Record<string, any>; safetyMetadata: SafetyFilterResult } {
  const textFields = ['mediaSummary', 'description'];
  let overallSeverity: 'none' | 'low' | 'medium' | 'high' = 'none';
  const allFlags = new Set<string>();
  const filtered = { ...response };

  for (const field of textFields) {
    if (field in filtered && typeof filtered[field] === 'string') {
      const result = filterTextContent(filtered[field]);
      filtered[field] = result.filtered;

      result.categories.forEach(c => allFlags.add(c));
      overallSeverity = mergeSeverity(overallSeverity, result);
    }
  }

  // Filter caution flags if they contain inappropriate content
  if (Array.isArray(filtered.cautionFlags)) {
    filtered.cautionFlags = filtered.cautionFlags.filter((flag: string) => {
      const result = filterTextContent(flag);
      result.categories.forEach(c => allFlags.add(c));
      overallSeverity = mergeSeverity(overallSeverity, result);
      return result.passed;
    });
  }

  if (filtered.moderation && typeof filtered.moderation === 'object') {
    const moderation = { ...filtered.moderation };
    if (typeof moderation.rationale === 'string') {
      const result = filterTextContent(moderation.rationale);
      moderation.rationale = result.filtered;
      result.categories.forEach(c => allFlags.add(c));
      overallSeverity = mergeSeverity(overallSeverity, result);
      if (!moderation.rationale.trim()) {
        delete moderation.rationale;
      }
    }
    filtered.moderation = moderation;
  }

  return {
    filtered,
    safetyMetadata: {
      passed: overallSeverity !== 'high',
      flagged: allFlags.size > 0,
      categories: Array.from(allFlags),
      severity: overallSeverity,
      filtered: '',
    },
  };
}

/**
 * Filter composer-guidance output.
 * The primary guidance message is required, so fail closed if it becomes unsafe.
 * Optional suggestion/badges are dropped when they do not pass filtering.
 */
export function filterComposerGuidanceResponse(
  response: Record<string, any>,
): { filtered: Record<string, any>; safetyMetadata: SafetyFilterResult } {
  let overallSeverity: 'none' | 'low' | 'medium' | 'high' = 'none';
  let blocked = false;
  const allFlags = new Set<string>();
  const filtered = { ...response };

  const applyTextField = (value: unknown, required = false): string => {
    if (typeof value !== 'string') {
      if (required) blocked = true;
      return '';
    }

    const result = filterTextContent(value);
    result.categories.forEach((category) => allFlags.add(category));
    overallSeverity = mergeSeverity(overallSeverity, result);

    if (!result.passed && required) {
      blocked = true;
    }

    return result.filtered.trim();
  };

  filtered.message = applyTextField(filtered.message, true);

  if (typeof filtered.suggestion === 'string') {
    const nextSuggestion = applyTextField(filtered.suggestion);
    if (nextSuggestion) {
      filtered.suggestion = nextSuggestion;
    } else {
      delete filtered.suggestion;
    }
  }

  if (Array.isArray(filtered.badges)) {
    filtered.badges = filtered.badges
      .map((value: unknown) => applyTextField(value))
      .filter((value: string) => value.length > 0)
      .slice(0, 3);
  }

  const hasMessage = typeof filtered.message === 'string' && filtered.message.length > 0;
  const passed = !blocked && hasMessage;

  return {
    filtered,
    safetyMetadata: {
      passed,
      flagged: allFlags.size > 0,
      categories: Array.from(allFlags),
      severity: overallSeverity,
      filtered: hasMessage ? filtered.message : '',
      ...(!passed ? { reason: 'Composer guidance output failed safety filtering' } : {}),
    },
  };
}

// ─── Detection Helper Functions ────────────────────────────────────────────

function hasProfanity(text: string): boolean {
  return matchesAnyPattern(PROFANITY_PATTERNS, text);
}

function hasHateSpeech(text: string): boolean {
  const lowerText = text.toLowerCase();
  return HATE_SPEECH_INDICATORS.some(indicator =>
    lowerText.includes(indicator.toLowerCase())
  );
}

function hasSexualContent(text: string): boolean {
  return matchesAnyPattern(SEXUAL_CONTENT_PATTERNS, text);
}

function hasViolenceContent(text: string): boolean {
  return matchesAnyPattern(VIOLENCE_PATTERNS, text);
}

function matchesAnyPattern(patterns: RegExp[], text: string): boolean {
  return patterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}

function hasMisinformationFlag(text: string): boolean {
  const lowerText = text.toLowerCase();
  return MISINFORMATION_TRIGGERS.some(trigger =>
    lowerText.includes(trigger.toLowerCase())
  );
}

function hasOutOfScopeAdvice(text: string): boolean {
  return matchesAnyPattern(OUT_OF_SCOPE_ADVICE_PATTERNS, text);
}

function replaceProfanity(text: string): string {
  let result = text;
  PROFANITY_PATTERNS.forEach(pattern => {
    result = result.replace(pattern, '[redacted]');
  });
  return result;
}

function normalizeSexualLanguage(text: string): string {
  let result = text;
  FORMAL_SEXUAL_REPLACEMENTS.forEach(({ pattern, replacement }) => {
    result = result.replace(pattern, replacement);
  });
  return result;
}

// ─── Logging Helper ───────────────────────────────────────────────────────

export function logSafetyFlag(
  context: string,
  result: SafetyFilterResult
): void {
  if (result.flagged) {
    console.warn(`[SAFETY] ${context}`, {
      severity: result.severity,
      categories: result.categories,
      reason: result.reason,
    });
  }
}
