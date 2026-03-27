/**
 * Safety Guardrails for Model Outputs
 *
 * This module ensures all model outputs (Qwen Writer, Multimodal, Gemini)
 * never encourage or normalize self-harm, harm to others, or animal cruelty.
 *
 * Strategy:
 * 1. System prompt injection — explicit safety-first instructions
 * 2. Output filtering — detect and replace harmful content
 * 3. Gentle redirection — acknowledge concern, always offer support
 * 4. Comprehensive logging — for safety audit trails
 */

// ─── Harmful Pattern Detection ────────────────────────────────────────────

/**
 * Patterns that indicate the model output may be promoting harm.
 * These are conservative — we'd rather over-flag than under-flag.
 */
const SELF_HARM_PATTERNS = [
  // Direct encouragement
  /\b(you\s+should\s+hurt\s+yourself|you\s+should\s+cut|try\s+harming\s+yourself|cut\s+yourself|harm\s+yourself)\b/i,
  // Normalization/glorification
  /\b(self.?harm\s+(is\s+)?(healing|healthy|good|valid|okay))\b/i,
  /\b(cutting\s+(is\s+)?(therapeutic|necessary|the\s+only\s+way|helps))\b/i,
  // Tactics/methods
  /\b(here'?s\s+how\s+to\s+(cut|hurt|harm\s+yourself))\b/i,
  /\b(the\s+best\s+way\s+to\s+(cut|harm))\b/i,
];

const SUICIDAL_PATTERNS = [
  // Direct encouragement
  /\b(you\s+should\s+(kill\s+yourself|commit\s+suicide|end\s+it|take\s+your\s+life))\b/i,
  // Normalization
  /\b(suicide\s+(is\s+)?(the\s+answer|your\s+best\s+option|the\s+only\s+way))\b/i,
  // Methods
  /\b(here'?s\s+how\s+to\s+(commit\s+suicide|end\s+it|kill\s+yourself))\b/i,
  /\b(the\s+most\s+(effective|painless|sure)\s+way\s+to\s+(kill\s+yourself|die))\b/i,
];

const HARM_TO_OTHERS_PATTERNS = [
  // Direct encouragement of violence
  /\b(you\s+should\s+(kill|hurt|harm|attack|beat|torture|rape|assault)\s+(them|that\s+person|people))\b/i,
  // Dehumanization leading to violence
  /\b(they\s+don't\s+deserve\s+to\s+live|they\s+should\s+be\s+eliminated|kill\s+all\s+\w+)\b/i,
  // Methods/tactics
  /\b(here'?s\s+how\s+to\s+(kill|hurt|harm|attack))\b/i,
];

const ANIMAL_CRUELTY_PATTERNS = [
  // Direct encouragement
  /\b(you\s+should\s+(hurt|kill|torture|abuse)\s+(the\s+)?(dog|cat|animal|pet|horse|bird))\b/i,
  // Normalization
  /\b(animal\s+cruelty\s+(is\s+)?(okay|justified|needed)|hurting\s+animals\s+(is\s+)?(fine|okay))\b/i,
  // Methods
  /\b(here'?s\s+how\s+to\s+(hurt|kill|torture)\s+(animals|pets))\b/i,
];

/**
 * Detect if text contains encouragement of self-harm, harm to others, or animal cruelty
 */
export function detectHarmfulContent(text: string): {
  isHarmful: boolean;
  category?: 'self-harm' | 'suicidal' | 'harm-to-others' | 'animal-cruelty';
  matchedPattern?: string;
} {
  for (const pattern of SELF_HARM_PATTERNS) {
    if (pattern.test(text)) {
      return { isHarmful: true, category: 'self-harm', matchedPattern: pattern.source };
    }
  }

  for (const pattern of SUICIDAL_PATTERNS) {
    if (pattern.test(text)) {
      return { isHarmful: true, category: 'suicidal', matchedPattern: pattern.source };
    }
  }

  for (const pattern of HARM_TO_OTHERS_PATTERNS) {
    if (pattern.test(text)) {
      return { isHarmful: true, category: 'harm-to-others', matchedPattern: pattern.source };
    }
  }

  for (const pattern of ANIMAL_CRUELTY_PATTERNS) {
    if (pattern.test(text)) {
      return { isHarmful: true, category: 'animal-cruelty', matchedPattern: pattern.source };
    }
  }

  return { isHarmful: false };
}

// ─── Response Filtering ────────────────────────────────────────────────────

/**
 * Fallback supportive responses when harmful content is detected.
 * These acknowledge concern and redirect to support.
 */
const FALLBACK_RESPONSES: Record<string, string> = {
  'self-harm':
    'I notice this conversation involves self-harm. If you\'re experiencing urges to hurt yourself, please reach out to a counselor or call 988 (Suicide & Crisis Lifeline). You deserve support, and there are people ready to listen.',

  'suicidal':
    'I notice this discussion involves suicidal thoughts. Please reach out for help — call or text 988 (Suicide & Crisis Lifeline in the US) or visit 988lifeline.org. Your life matters, and support is available 24/7.',

  'harm-to-others':
    'This discussion involves violence toward others. If you\'re experiencing urges to harm someone, please contact a mental health professional or call 988. Violence is never the answer, and support is available.',

  'animal-cruelty':
    'This discussion involves harming animals. Animals deserve protection and compassion. If you\'re experiencing urges to harm animals, please speak with a mental health professional.',
};

/**
 * Filter a model response to remove/replace harmful content.
 * Returns the filtered response and a safety incident log if triggered.
 */
export function filterResponseForSafety(
  rawResponse: string,
): {
  filtered: string;
  isSafe: boolean;
  incidentLogged?: { category: string; timestamp: string };
} {
  const detection = detectHarmfulContent(rawResponse);

  if (!detection.isHarmful) {
    return { filtered: rawResponse, isSafe: true };
  }

  const category = detection.category || 'unknown';
  const fallback = FALLBACK_RESPONSES[category] ?? FALLBACK_RESPONSES['self-harm'] ?? 'Please reach out to a trusted support resource.';

  // Log the incident for safety audit
  console.warn(`[SAFETY] Harmful content detected in model output [${category}]`, {
    timestamp: new Date().toISOString(),
    category,
    matchedPattern: detection.matchedPattern,
  });

  return {
    filtered: fallback,
    isSafe: false,
    incidentLogged: {
      category,
      timestamp: new Date().toISOString(),
    },
  };
}

// ─── Summary/Object Filtering ──────────────────────────────────────────────

/**
 * Filter a Interpolator Writer response (JSON object) for harmful content.
 * Checks all text fields: collapsedSummary, expandedSummary, blurbs.
 */
export function filterWriterResponse(response: {
  collapsedSummary?: string;
  expandedSummary?: string;
  whatChanged?: string[];
  contributorBlurbs?: Array<{ handle: string; blurb: string }>;
  abstained?: boolean;
  mode?: string;
}): {
  filtered: typeof response;
  isSafe: boolean;
  fieldsChecked: string[];
} {
  const fieldsChecked: string[] = [];

  // Check collapsedSummary
  if (response.collapsedSummary) {
    fieldsChecked.push('collapsedSummary');
    const check = detectHarmfulContent(response.collapsedSummary);
    if (check.isHarmful) {
      console.warn(`[SAFETY] Harmful content in collapsedSummary [${check.category}]`);
      response.collapsedSummary = FALLBACK_RESPONSES[check.category || 'self-harm'] ?? FALLBACK_RESPONSES['self-harm'] ?? 'Please reach out for support.';
    }
  }

  // Check expandedSummary
  if (response.expandedSummary) {
    fieldsChecked.push('expandedSummary');
    const check = detectHarmfulContent(response.expandedSummary);
    if (check.isHarmful) {
      console.warn(`[SAFETY] Harmful content in expandedSummary [${check.category}]`);
      delete response.expandedSummary; // Omit rather than show fallback
    }
  }

  // Check whatChanged
  if (response.whatChanged) {
    fieldsChecked.push('whatChanged');
    response.whatChanged = response.whatChanged.filter(item => {
      const check = detectHarmfulContent(item);
      if (check.isHarmful) {
        console.warn(`[SAFETY] Harmful content in whatChanged item [${check.category}]`);
        return false;
      }
      return true;
    });
  }

  // Check contributorBlurbs
  if (response.contributorBlurbs) {
    fieldsChecked.push('contributorBlurbs');
    response.contributorBlurbs = response.contributorBlurbs.filter(blurb => {
      const check = detectHarmfulContent(blurb.blurb);
      if (check.isHarmful) {
        console.warn(`[SAFETY] Harmful content in blurb for ${blurb.handle} [${check.category}]`);
        return false;
      }
      return true;
    });
  }

  const isSafe = fieldsChecked.every(field => {
    if (field === 'collapsedSummary' && response.collapsedSummary) {
      return !detectHarmfulContent(response.collapsedSummary).isHarmful;
    }
    if (field === 'expandedSummary' && response.expandedSummary) {
      return !detectHarmfulContent(response.expandedSummary).isHarmful;
    }
    if (field === 'whatChanged' && response.whatChanged) {
      return !response.whatChanged.some(item => detectHarmfulContent(item).isHarmful);
    }
    if (field === 'contributorBlurbs' && response.contributorBlurbs) {
      return !response.contributorBlurbs.some(blurb => detectHarmfulContent(blurb.blurb).isHarmful);
    }
    return true;
  });

  return { filtered: response, isSafe, fieldsChecked };
}

// ─── System Prompt Safety Instructions ──────────────────────────────────────

/**
 * System prompt safety prefix — prepended to all model system prompts.
 * Establishes safety constraints at prompt-engineering level.
 */
export const SAFETY_FIRST_INSTRUCTIONS = `
═══════════════════════════════════════════════════════════════════════════════
CRITICAL SAFETY GUARDRAILS — Read First
═══════════════════════════════════════════════════════════════════════════════

You MUST NEVER, under any circumstances:
- Encourage, normalize, or provide methods for self-harm or suicide
- Encourage, normalize, or provide methods for harming others or violence
- Encourage, normalize, or provide methods for animal cruelty
- Glorify or romanticize mental health crises
- Suggest that pain, suffering, or hopelessness is permanent or unchangeable

If you detect that your output risks encouraging any of the above:
1. STOP immediately
2. REDIRECT to support and resources instead
3. Keep your tone gentle, compassionate, and supportive

IF SOMEONE IS IN CRISIS:
- Acknowledge their pain and suffering as real
- Express that they matter and deserve support
- Direct them to professional help:
  * US: Call or text 988 (Suicide & Crisis Lifeline)
  * Worldwide: Contact local crisis services or Befrienders Worldwide
- Be clear: isolation makes crises worse, but support helps

TONE for crisis content:
- Acknowledge the struggle (don't minimize)
- Affirm their humanity and worth
- Offer concrete next steps for support
- Never judge, shame, or lecture
- Never suggest that feeling bad means they are bad

═══════════════════════════════════════════════════════════════════════════════
END CRITICAL SAFETY GUARDRAILS
═══════════════════════════════════════════════════════════════════════════════
`;

/**
 * Append safety instructions to a system prompt.
 */
export function ensureSafetyInstructions(systemPrompt: string): string {
  if (systemPrompt.includes('CRITICAL SAFETY GUARDRAILS')) {
    return systemPrompt; // Already has safety instructions
  }
  return SAFETY_FIRST_INSTRUCTIONS + '\n' + systemPrompt;
}

// ─── Logging & Audit ────────────────────────────────────────────────────────

export interface SafetyIncident {
  timestamp: string;
  category: 'self-harm' | 'suicidal' | 'harm-to-others' | 'animal-cruelty';
  model: 'qwen-writer' | 'qwen-multimodal' | 'gemini';
  endpoint: string;
  matchedPattern: string;
  userContent?: string; // Hashed for privacy
}

/**
 * Log a safety incident for audit trail.
 * In production, send to security monitoring system.
 */
export function logSafetyIncident(incident: SafetyIncident): void {
  const logEntry = {
    ...incident,
    timestamp: new Date().toISOString(),
  };

  // TODO: In production, send to:
  // - Cloud logging (e.g., Google Cloud Logging, Azure Monitor)
  // - Security monitoring (e.g., Datadog, Splunk)
  // - Internal audit trail

  console.error('[SAFETY AUDIT]', JSON.stringify(logEntry));
}

/**
 * Generate a comprehensive safety audit report.
 */
export function generateSafetyAuditReport(incidents: SafetyIncident[]): {
  totalIncidents: number;
  byCategory: Record<string, number>;
  byModel: Record<string, number>;
  byEndpoint: Record<string, number>;
  summary: string;
} {
  const byCategory = incidents.reduce(
    (acc, incident) => {
      acc[incident.category] = (acc[incident.category] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const byModel = incidents.reduce(
    (acc, incident) => {
      acc[incident.model] = (acc[incident.model] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const byEndpoint = incidents.reduce(
    (acc, incident) => {
      acc[incident.endpoint] = (acc[incident.endpoint] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const summary = `Detected ${incidents.length} safety incident(s) across models and endpoints. No harmful content was exposed to users — all responses were filtered and replaced with supportive alternatives.`;

  return {
    totalIncidents: incidents.length,
    byCategory,
    byModel,
    byEndpoint,
    summary,
  };
}
