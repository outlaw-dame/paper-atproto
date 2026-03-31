// ─── Model Client — Narwhal v3 ────────────────────────────────────────────
// Client-side fetch wrappers for the server-side LLM endpoints.
// All model calls are server-side only — this client calls the backend.
// Includes timeout, exponential backoff + jitter, typed response validation.

import type {
  ThreadStateForWriter,
  InterpolatorWriteResult,
  MediaAnalysisRequest,
  MediaAnalysisResult,
  ExploreSynopsisRequest,
  ExploreSynopsisResult,
} from './llmContracts';
import type {
  ComposerGuidanceWriteRequest,
  ComposerGuidanceWriteResult,
} from './composer/llmWriterContracts';
import { getConfiguredApiBaseUrl, resolveApiUrl } from '../lib/apiBase';
import type {
  DeepInterpolatorResult,
  PremiumAiEntitlements,
  PremiumAiSafetyMetadata,
  PremiumInterpolatorRequest,
} from './premiumContracts';

// ─── Config ───────────────────────────────────────────────────────────────
const BASE_URL = getConfiguredApiBaseUrl(
  (import.meta as any).env?.VITE_GLYMPSE_LLM_BASE_URL,
  (import.meta as any).env?.VITE_GLYMPSE_API_BASE_URL,
);

const RETRY_BASE_MS = 300;
const RETRY_MAX_MS = 4000;
const RETRY_ATTEMPTS = 3;
const RETRY_JITTER = 0.30;
const DEFAULT_TIMEOUT_MS = 30_000;
const PREMIUM_ENTITLEMENT_TTL_MS = 5 * 60_000;

const PROHIBITED_PROFANITY_PATTERNS = [
  /\b(fuck|shit|bitch|asshole|bastard|damn|crap)\b/gi,
];

const OUT_OF_SCOPE_ADVICE_PATTERNS = [
  /\b(you should|you must|you need to|you ought to)\b/gi,
  /\b(i recommend|i suggest|my advice is)\b/gi,
  /\b(here'?s how to|steps to|best way to)\b/gi,
];

const EXPLICIT_SEXUAL_REPLACEMENTS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\b(porn|xxx|smut)\b/gi, replacement: 'explicit sexual content' },
  { pattern: /\b(nsfw)\b/gi, replacement: 'adult content' },
  { pattern: /\b(nude)\b/gi, replacement: 'nudity' },
  { pattern: /\b(sex tape)\b/gi, replacement: 'sexually explicit recording' },
  { pattern: /\b(cum|semen)\b/gi, replacement: 'sexual fluid' },
  { pattern: /\b(orgasm)\b/gi, replacement: 'sexual climax' },
  { pattern: /\b(masturbat(e|ion))\b/gi, replacement: 'self-stimulation' },
  { pattern: /\b(hook\s?up|one[-\s]?night stand)\b/gi, replacement: 'casual sexual encounter' },
  { pattern: /\b(horny|turned\s+on|thirsty\s+for)\b/gi, replacement: 'sexually aroused' },
  { pattern: /\b(fetish|kink)\b/gi, replacement: 'sexual preference' },
  { pattern: /\b(blowjob|handjob)\b/gi, replacement: 'explicit sexual act' },
];

const URLISH_REFERENCE_PATTERN = String.raw`(?:https?:\/\/|www\.)[^\s<>"')]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"')]+)?`;

const NARRATED_LINK_PATTERNS = [
  new RegExp(`\\bwith\\s+(?:an?\\s+)?link\\s+to\\s+(${URLISH_REFERENCE_PATTERN})`, 'gi'),
  new RegExp(`\\bwith\\s+links?\\s+to\\s+(${URLISH_REFERENCE_PATTERN})`, 'gi'),
  new RegExp(`\\blink(?:ing|ed)?\\s+to\\s+(${URLISH_REFERENCE_PATTERN})`, 'gi'),
  new RegExp(`\\bwith\\s+(?:an?\\s+)?(?:article|report|story|source)\\s+at\\s+(${URLISH_REFERENCE_PATTERN})`, 'gi'),
  new RegExp(`\\baccording\\s+to\\s+(${URLISH_REFERENCE_PATTERN})`, 'gi'),
  new RegExp(`\\bciting\\s+(${URLISH_REFERENCE_PATTERN})`, 'gi'),
  new RegExp(`\\bbased\\s+on\\s+(${URLISH_REFERENCE_PATTERN})`, 'gi'),
];

const PUBLICATION_HOST_ALIASES: Record<string, string> = {
  'time.com': 'Time',
  'nytimes.com': 'The New York Times',
  'washingtonpost.com': 'The Washington Post',
  'wsj.com': 'The Wall Street Journal',
  'reuters.com': 'Reuters',
  'apnews.com': 'AP News',
  'politico.com': 'Politico',
  'axios.com': 'Axios',
  'bloomberg.com': 'Bloomberg',
  'cnn.com': 'CNN',
  'nbcnews.com': 'NBC News',
  'abcnews.go.com': 'ABC News',
  'cbsnews.com': 'CBS News',
  'foxnews.com': 'Fox News',
  'theguardian.com': 'The Guardian',
  'bbc.com': 'BBC',
  'bbc.co.uk': 'BBC',
  'propublica.org': 'ProPublica',
  'npr.org': 'NPR',
  'theatlantic.com': 'The Atlantic',
};

function formatPublicationAwareReference(hostname: string): string {
  const normalizedHost = hostname.replace(/^www\./i, '').toLowerCase();
  const matchedHost = Object.keys(PUBLICATION_HOST_ALIASES).find((candidate) => (
    normalizedHost === candidate || normalizedHost.endsWith(`.${candidate}`)
  ));
  if (matchedHost) {
    return `${PUBLICATION_HOST_ALIASES[matchedHost]} reporting`;
  }
  return `reporting from ${normalizedHost}`;
}

function normalizeSummaryLinkTarget(raw: string): string {
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return formatPublicationAwareReference(new URL(candidate).hostname);
  } catch {
    return 'outside reporting';
  }
}

type InterpolatorTelemetrySnapshot = {
  attempted: number;
  succeeded: number;
  abstained: number;
  failed: number;
};

type PremiumEntitlementCacheEntry = {
  value: PremiumAiEntitlements;
  expiresAt: number;
};

const premiumEntitlementCache = new Map<string, PremiumEntitlementCacheEntry>();

const interpolatorTelemetry: InterpolatorTelemetrySnapshot = {
  attempted: 0,
  succeeded: 0,
  abstained: 0,
  failed: 0,
};

function logInterpolatorTelemetry(reason: string): void {
  console.info('[interpolator/telemetry]', reason, { ...interpolatorTelemetry });
}

export function getInterpolatorTelemetrySnapshot(): InterpolatorTelemetrySnapshot {
  return { ...interpolatorTelemetry };
}

function truncateAtWordBoundary(value: string, maxLen: number): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= maxLen) return trimmed;
  const slice = trimmed.slice(0, maxLen);
  const lastSpace = slice.lastIndexOf(' ');
  if (lastSpace >= Math.floor(maxLen * 0.55)) {
    return `${slice.slice(0, lastSpace)}...`;
  }
  return `${slice}...`;
}

function sanitizeSafeSummaryText(value: string): string {
  let next = value;
  for (const pattern of PROHIBITED_PROFANITY_PATTERNS) {
    next = next.replace(pattern, '[redacted]');
  }
  for (const pattern of OUT_OF_SCOPE_ADVICE_PATTERNS) {
    next = next.replace(pattern, '[redacted]');
  }
  for (const { pattern, replacement } of EXPLICIT_SEXUAL_REPLACEMENTS) {
    next = next.replace(pattern, replacement);
  }
  for (const pattern of NARRATED_LINK_PATTERNS) {
    next = next.replace(pattern, (_, ref: string) => `citing ${normalizeSummaryLinkTarget(ref)}`);
  }
  return next.replace(/\s+/g, ' ').trim();
}

function sentenceLead(value: string, maxLen: number): string {
  const cleaned = value.trim().replace(/\s+/g, ' ');
  if (!cleaned) return '';
  const sentenceBreak = cleaned.search(/[.!?]/);
  const base = sentenceBreak > 0 ? cleaned.slice(0, sentenceBreak + 1) : cleaned;
  return sanitizeSafeSummaryText(truncateAtWordBoundary(base, maxLen));
}

function ensureSentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

type ReplyBehaviorCounts = {
  sourcing: number;
  clarification: number;
  disagreement: number;
  newInfo: number;
  comparison: number;
  escalation: number;
  repetition: number;
  question: number;
  total: number;
};

function computeReplyBehaviorCounts(input: ThreadStateForWriter): ReplyBehaviorCounts {
  const counts: ReplyBehaviorCounts = {
    sourcing: 0,
    clarification: 0,
    disagreement: 0,
    newInfo: 0,
    comparison: 0,
    escalation: 0,
    repetition: 0,
    question: 0,
    total: input.visibleReplyCount ?? input.selectedComments.length,
  };

  for (const comment of input.selectedComments) {
    const role = comment.role?.toLowerCase() ?? '';
    const text = comment.text.toLowerCase();

    if (
      role === 'source_bringer'
      || role === 'rule_source'
      || /\b(source|sourcing|link|memo|document|report|paper|article|citation|cited|evidence)\b/.test(text)
    ) {
      counts.sourcing += 1;
    }
    if (role === 'clarifying' || role === 'clarifier' || /\b(clarif|explain|timeline|specifics)\b/.test(text)) {
      counts.clarification += 1;
    }
    if (
      role === 'useful_counterpoint'
      || role === 'counterpoint'
      || role === 'disagreement'
      || /\b(disagree|question|doubt|push back|skeptic|contest)\b/.test(text)
    ) {
      counts.disagreement += 1;
    }
    if (role === 'new_information' || role === 'context-setter' || /\b(new|another|additional|context)\b/.test(text)) {
      counts.newInfo += 1;
    }
    if (/\b(compare|comparison|similar|earlier|prior|before|pattern)\b/.test(text)) {
      counts.comparison += 1;
    }
    if (role === 'provocative' || role === 'emotional-reaction' || role === 'escalation') {
      counts.escalation += 1;
    }
    if (role === 'repetitive' || /\b(same point|again|repeating)\b/.test(text)) {
      counts.repetition += 1;
    }
    if (/\?/.test(text) || /\b(ask|asks|asking|whether)\b/.test(text)) {
      counts.question += 1;
    }
  }

  for (const signal of input.whatChangedSignals) {
    const normalized = signal.toLowerCase();
    if (normalized.startsWith('source cited:')) counts.sourcing += 1;
    if (normalized.startsWith('clarification:')) counts.clarification += 1;
    if (normalized.startsWith('counterpoint:')) counts.disagreement += 1;
    if (normalized.startsWith('new angle:') || normalized.startsWith('new info:')) counts.newInfo += 1;
  }

  return counts;
}

function joinBehaviorPhrases(phrases: string[]): string {
  if (phrases.length === 0) return 'break in several directions';
  if (phrases.length === 1) return phrases[0]!;
  if (phrases.length === 2) return `${phrases[0]!} and ${phrases[1]!}`;
  return `${phrases.slice(0, -1).join(', ')}, and ${phrases[phrases.length - 1]!}`;
}

function describeReplyBehavior(input: ThreadStateForWriter): string {
  const counts = computeReplyBehaviorCounts(input);
  if (counts.total === 0) {
    return 'Visible replies are still too sparse to characterize.';
  }

  const phrases: string[] = [];

  if (counts.sourcing > 0) phrases.push('ask for sourcing');
  if (counts.clarification > 0) phrases.push('add clarification');
  if (counts.disagreement > 0) phrases.push('push back on the claim');
  if (counts.comparison > 0) phrases.push('compare it to earlier incidents');
  if (counts.newInfo > 0) phrases.push('add context');

  if (phrases.length === 0 && counts.question > 0) phrases.push('press for specifics');
  if (phrases.length === 0 && counts.repetition > 0) phrases.push('repeat the same point');
  if (phrases.length === 0 && counts.escalation > 0) phrases.push('turn heated quickly');

  const subject = counts.total >= 8
    ? `Across ${counts.total} visible replies, the thread mostly`
    : 'Visible replies mostly';

  return `${subject} ${joinBehaviorPhrases(phrases.slice(0, 3))}.`;
}

function contributorFallbackBlurb(role: string, handle: string): string {
  switch (role) {
    case 'source-bringer':
    case 'rule-source':
      return `${handle} brings in source material that grounds the thread.`;
    case 'counterpoint':
      return `${handle} pushes back with a specific counterpoint.`;
    case 'clarifier':
      return `${handle} adds clarification to the main claim.`;
    case 'context-setter':
      return `${handle} adds context that changes how the thread reads.`;
    case 'question-raiser':
      return `${handle} presses for specifics in the replies.`;
    case 'emotional-reaction':
      return `${handle} raises the temperature more than the signal level.`;
    default:
      return `${handle} adds a distinct thread signal.`;
  }
}

function deterministicWriterFallback(input: ThreadStateForWriter): InterpolatorWriteResult {
  const rootTopic = sentenceLead(input.rootPost.text, 150);
  const hasRootTopic = rootTopic.length > 0;
  const replyLine = describeReplyBehavior(input);
  const visibleReplyCount = input.visibleReplyCount ?? input.selectedComments.length;

  let collapsedSummary: string;
  if (input.summaryMode === 'minimal_fallback') {
    const first = hasRootTopic ? ensureSentence(rootTopic) : 'The post makes a specific claim.';
    collapsedSummary = truncateAtWordBoundary(`${first} ${replyLine}`, 240);
  } else if (input.summaryMode === 'descriptive_fallback') {
    const first = hasRootTopic ? ensureSentence(rootTopic) : 'The post raises an early claim.';
    const limitation = visibleReplyCount >= 6
      ? 'Visible replies are still too split for a stronger read.'
      : 'There is not enough visible thread signal yet for a stronger read.';
    collapsedSummary = truncateAtWordBoundary(`${first} ${replyLine} ${limitation}`, 300);
  } else {
    const first = hasRootTopic ? ensureSentence(rootTopic) : 'The post introduces a claim and draws visible responses.';
    collapsedSummary = truncateAtWordBoundary(`${first} ${replyLine}`, 320);
  }

  const contributorBlurbs = input.topContributors
    .slice(0, input.summaryMode === 'normal' ? 3 : 2)
    .map((c) => ({
      handle: sanitizeSafeSummaryText(c.handle),
      blurb: sanitizeSafeSummaryText(
        truncateAtWordBoundary(contributorFallbackBlurb(c.role, c.handle), 160),
      ),
    }));

  const whatChanged = input.summaryMode === 'minimal_fallback'
    ? []
    : input.whatChangedSignals
        .slice(0, 4)
        .map((signal) => sanitizeSafeSummaryText(truncateAtWordBoundary(signal, 90)));

  return {
    collapsedSummary: sanitizeSafeSummaryText(collapsedSummary),
    ...(input.summaryMode === 'normal'
      ? { expandedSummary: sanitizeSafeSummaryText(truncateAtWordBoundary(`${collapsedSummary} Confidence is reduced, so this summary remains conservative.`, 520)) }
      : {}),
    whatChanged,
    contributorBlurbs,
    abstained: false,
    mode: input.summaryMode,
  };
}

const ROOT_ONLY_REPLY_ACTIVITY_RE =
  /\b(repl(?:y|ies)|responses?|discussion|thread|commenters?|debate|question(?:s|ed|ing)?|clarif(?:y|ies|ication)|add(?:s|ed|ing)?|context|counterpoint|source(?:s|d)?|link(?:s|ed)?|evidence)\b/i;

const GENERIC_REPLY_ACTIVITY_RE =
  /\b(replies are active|people are reacting|the discussion continues|early voices are shaping the conversation|the conversation continues)\b/i;

const ROOT_ONLY_STOP_WORDS = new Set([
  'the',
  'and',
  'that',
  'this',
  'with',
  'from',
  'into',
  'have',
  'has',
  'been',
  'were',
  'their',
  'they',
  'them',
  'over',
  'about',
  'after',
  'under',
  'order',
  'would',
  'could',
  'should',
  'while',
  'only',
  'just',
  'still',
  'than',
  'then',
  'also',
  'more',
  'most',
  'some',
  'many',
  'much',
  'very',
  'into',
  'onto',
  'your',
  'ours',
  'hers',
  'his',
  'its',
  'for',
  'you',
  'our',
  'out',
  'are',
  'was',
  'did',
  'not',
  'but',
  'say',
  'says',
  'said',
]);

function sentenceCount(value: string): number {
  return value
    .split(/[.!?]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .length;
}

function normalizedContentTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !ROOT_ONLY_STOP_WORDS.has(token));
}

function tokenOverlapRatio(summary: string, root: string): number {
  const summaryTokens = new Set(normalizedContentTokens(summary));
  const rootTokens = new Set(normalizedContentTokens(root));
  if (summaryTokens.size === 0 || rootTokens.size === 0) return 0;

  let overlap = 0;
  for (const token of summaryTokens) {
    if (rootTokens.has(token)) overlap += 1;
  }
  return overlap / summaryTokens.size;
}

function shouldPreferDeterministicFallback(
  input: ThreadStateForWriter,
  result: InterpolatorWriteResult,
): boolean {
  const summary = result.collapsedSummary?.trim() ?? '';
  if (!summary) return false;
  if (input.selectedComments.length < 3 && input.whatChangedSignals.length < 2) return false;
  if (GENERIC_REPLY_ACTIVITY_RE.test(summary)) return true;
  if (ROOT_ONLY_REPLY_ACTIVITY_RE.test(summary)) return false;

  return sentenceCount(summary) <= 1
    && tokenOverlapRatio(summary, input.rootPost.text) >= 0.72;
}

// ─── Retry helpers ────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(res => setTimeout(res, ms));
}

function backoffMs(attempt: number): number {
  const exp = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt);
  const jitter = exp * RETRY_JITTER;
  return Math.floor(exp - jitter + Math.random() * jitter * 2);
}

function isRetryable(status: number): boolean {
  return [408, 429, 500, 502, 503, 504].includes(status);
}

async function fetchWithRetry<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
  options?: {
    attempts?: number;
    retryOnStatuses?: number[];
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
  },
): Promise<T> {
  let lastError: unknown;
  const attempts = Math.max(1, options?.attempts ?? RETRY_ATTEMPTS);
  const retryableStatuses = options?.retryOnStatuses ?? [408, 429, 500, 502, 503, 504];

  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    const combinedSignal = signal ?? controller.signal;

    try {
      const endpoint = resolveApiUrl(path, BASE_URL);
      const res = await fetch(endpoint, {
        method: options?.method ?? 'POST',
        headers: {
          ...(options?.method === 'GET' ? {} : { 'Content-Type': 'application/json' }),
          ...(options?.headers ?? {}),
        },
        ...(options?.method === 'GET' ? {} : { body: JSON.stringify(body) }),
        signal: combinedSignal,
      });

      if (!res.ok) {
        const canRetryStatus = retryableStatuses.includes(res.status) || isRetryable(res.status);
        if (!canRetryStatus || attempt === attempts - 1) {
          throw new Error(`LLM endpoint ${path} responded ${res.status}`);
        }
        lastError = new Error(`LLM endpoint ${path} responded ${res.status}`);
        await sleep(backoffMs(attempt));
        continue;
      }

      return (await res.json()) as T;
    } catch (err: unknown) {
      lastError = err;
      const isAbort = err instanceof Error && err.name === 'AbortError';
      if (isAbort || attempt === attempts - 1) throw err;
      await sleep(backoffMs(attempt));
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError;
}

function sanitizeArray(values: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => sanitizeSafeSummaryText(truncateAtWordBoundary(value, maxLen)))
    .filter((value) => value.trim().length > 0)
    .slice(0, maxItems);
}

function sanitizeDeepInterpolatorResult(
  value: DeepInterpolatorResult,
): DeepInterpolatorResult {
  const safety: PremiumAiSafetyMetadata | undefined = value.safety
    ? {
        flagged: value.safety.flagged === true,
        severity: ['none', 'low', 'medium', 'high'].includes(value.safety.severity)
          ? value.safety.severity
          : 'none',
        categories: sanitizeArray(value.safety.categories, 8, 48),
      }
    : undefined;

  return {
    summary: sanitizeSafeSummaryText(truncateAtWordBoundary(value.summary, 360)),
    ...(value.groundedContext
      ? {
          groundedContext: sanitizeSafeSummaryText(
            truncateAtWordBoundary(value.groundedContext, 260),
          ),
        }
      : {}),
    perspectiveGaps: sanitizeArray(value.perspectiveGaps, 3, 120),
    followUpQuestions: sanitizeArray(value.followUpQuestions, 3, 120),
    confidence: Math.max(0, Math.min(1, Number.isFinite(value.confidence) ? value.confidence : 0)),
    provider: 'gemini',
    updatedAt: value.updatedAt,
    ...(value.sourceComputedAt ? { sourceComputedAt: value.sourceComputedAt } : {}),
    ...(safety ? { safety } : {}),
  };
}

function premiumEntitlementCacheKey(actorDid: string): string {
  return actorDid.trim().toLowerCase();
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Calls the writer model to produce the Interpolator summary.
 * Falls back gracefully — callers should catch and use deterministic summary on failure.
 */
export async function callInterpolatorWriter(
  input: ThreadStateForWriter,
  signal?: AbortSignal,
): Promise<InterpolatorWriteResult> {
  try {
    interpolatorTelemetry.attempted += 1;
    const result = await fetchWithRetry<InterpolatorWriteResult>(
      '/api/llm/write/interpolator',
      input,
      signal,
      {
        attempts: 2,
        retryOnStatuses: [408, 429, 500, 502, 503, 504],
      },
    );

    if (result.abstained || !result.collapsedSummary?.trim()) {
      interpolatorTelemetry.abstained += 1;
      const fallback = deterministicWriterFallback(input);
      logInterpolatorTelemetry('abstained-response-fallback');
      return fallback;
    }

    if (shouldPreferDeterministicFallback(input, result)) {
      interpolatorTelemetry.abstained += 1;
      const fallback = deterministicWriterFallback(input);
      logInterpolatorTelemetry('root-only-response-fallback');
      return fallback;
    }

    interpolatorTelemetry.succeeded += 1;
    logInterpolatorTelemetry('success');

    // Sanitize the LLM result through the same content safety pass that the
    // deterministic fallback uses (profanity, out-of-scope advice, explicit sexual).
    return {
      ...result,
      collapsedSummary: sanitizeSafeSummaryText(result.collapsedSummary),
      ...(result.expandedSummary
        ? { expandedSummary: sanitizeSafeSummaryText(result.expandedSummary) }
        : {}),
      whatChanged: (result.whatChanged ?? []).map((signal) => sanitizeSafeSummaryText(signal)),
      contributorBlurbs: (result.contributorBlurbs ?? []).map((entry) => ({
        ...entry,
        blurb: sanitizeSafeSummaryText(entry.blurb),
      })),
    };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw err;
    }

    interpolatorTelemetry.failed += 1;
    const fallback = deterministicWriterFallback(input);
    logInterpolatorTelemetry('failure-fallback');
    return fallback;
  }
}

/**
 * Calls the multimodal analyzer (Qwen3-VL).
 * Only call when shouldRunMultimodal() returns true.
 */
export async function callMediaAnalyzer(
  input: MediaAnalysisRequest,
  signal?: AbortSignal,
): Promise<MediaAnalysisResult> {
  return fetchWithRetry<MediaAnalysisResult>(
    '/api/llm/analyze/media',
    input,
    signal,
  );
}

/**
 * Calls the writer for Explore / Search Story synopsis.
 */
export async function callExploreWriter(
  input: ExploreSynopsisRequest,
  signal?: AbortSignal,
): Promise<ExploreSynopsisResult> {
  return fetchWithRetry<ExploreSynopsisResult>(
    '/api/llm/write/search-story',
    input,
    signal,
  );
}

/**
 * Calls the selective composer-guidance writer. This is advisory polish only;
 * callers should always have local fallback copy ready.
 */
export async function callComposerGuidanceWriter(
  input: ComposerGuidanceWriteRequest,
  signal?: AbortSignal,
): Promise<ComposerGuidanceWriteResult> {
  return fetchWithRetry<ComposerGuidanceWriteResult>(
    '/api/llm/write/composer-guidance',
    input,
    signal,
  );
}

export async function getPremiumAiEntitlements(
  actorDid: string,
  signal?: AbortSignal,
): Promise<PremiumAiEntitlements> {
  const normalizedDid = actorDid.trim();
  if (!normalizedDid) {
    return {
      tier: 'free',
      capabilities: [],
      providerAvailable: false,
    };
  }

  const cacheKey = premiumEntitlementCacheKey(normalizedDid);
  const cached = premiumEntitlementCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const result = await fetchWithRetry<PremiumAiEntitlements>(
    '/api/premium-ai/entitlements',
    undefined,
    signal,
    {
      method: 'GET',
      attempts: 2,
      retryOnStatuses: [408, 429, 500, 502, 503, 504],
      headers: {
        'X-Glympse-User-Did': normalizedDid,
      },
    },
  );

  premiumEntitlementCache.set(cacheKey, {
    value: result,
    expiresAt: Date.now() + PREMIUM_ENTITLEMENT_TTL_MS,
  });

  return result;
}

export async function callPremiumDeepInterpolator(
  input: PremiumInterpolatorRequest,
  signal?: AbortSignal,
): Promise<DeepInterpolatorResult> {
  const result = await fetchWithRetry<DeepInterpolatorResult>(
    '/api/premium-ai/interpolator/deep',
    input,
    signal,
    {
      attempts: 2,
      retryOnStatuses: [408, 429, 500, 502, 503, 504],
      headers: {
        'X-Glympse-User-Did': input.actorDid,
      },
    },
  );

  return sanitizeDeepInterpolatorResult(result);
}
