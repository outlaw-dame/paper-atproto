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
    filtered = filtered.replace(/\b(porn|xxx|explicit|nude)\b/gi, '[redacted]');
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
      if (result.severity === 'high') overallSeverity = 'high';
      else if (result.severity === 'medium' && overallSeverity !== 'high') overallSeverity = 'medium';
      else if (result.severity === 'low' && overallSeverity === 'none') overallSeverity = 'low';
    }
  }

  // Filter arrays of strings
  if (Array.isArray(filtered.whatChanged)) {
    filtered.whatChanged = filtered.whatChanged.map((item: string) => {
      const result = filterTextContent(item);
      result.categories.forEach(c => allFlags.add(c));
      return result.filtered;
    });
  }

  if (Array.isArray(filtered.contributorBlurbs)) {
    filtered.contributorBlurbs = filtered.contributorBlurbs.map((item: string) => {
      const result = filterTextContent(item);
      result.categories.forEach(c => allFlags.add(c));
      return result.filtered;
    });
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
      if (result.severity === 'high') overallSeverity = 'high';
      else if (result.severity === 'medium' && overallSeverity !== 'high') overallSeverity = 'medium';
    }
  }

  // Filter caution flags if they contain inappropriate content
  if (Array.isArray(filtered.cautionFlags)) {
    filtered.cautionFlags = filtered.cautionFlags.filter((flag: string) => {
      const result = filterTextContent(flag);
      return result.passed;
    });
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

function replaceProfanity(text: string): string {
  let result = text;
  PROFANITY_PATTERNS.forEach(pattern => {
    result = result.replace(pattern, '[redacted]');
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
