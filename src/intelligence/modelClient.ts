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
import { composeAbortSignals, sleepWithAbort } from '../lib/abortSignals';
import { sanitizeUrlForProcessing } from '../lib/safety/externalUrl';
import {
  recordInterpolatorWriterOutcome,
} from '../perf/interpolatorTelemetry';
import { inferenceClient } from '../workers/InferenceClient';
import { useInterpolatorSettingsStore } from '../store/interpolatorSettingsStore';
import type {
  DeepInterpolatorResult,
  PremiumAiEntitlements,
  PremiumAiProviderPreference,
  PremiumAiSafetyMetadata,
  PremiumInterpolatorRequest,
} from './premiumContracts';
import {
  buildCaptionFallbackMediaAnalysis,
  refineMediaAnalysisResult,
} from './multimodal/mediaAnalysisRefinement';

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

type InterpolatorTelemetryReason =
  | 'success'
  | 'abstained-response-fallback'
  | 'root-only-response-fallback'
  | 'failure-fallback';

type PremiumEntitlementCacheEntry = {
  value: PremiumAiEntitlements;
  expiresAt: number;
};

type ModelClientRequestError = Error & {
  status?: number;
  retryable?: boolean;
};

const premiumEntitlementCache = new Map<string, PremiumEntitlementCacheEntry>();

const interpolatorTelemetry: InterpolatorTelemetrySnapshot = {
  attempted: 0,
  succeeded: 0,
  abstained: 0,
  failed: 0,
};

const WRITER_OUTCOME_TELEMETRY_PATH = '/api/llm/telemetry/writer-outcome';
const WRITER_OUTCOME_TELEMETRY_MAX_ATTEMPTS = 2;
const PREMIUM_AI_PROVIDER_HEADER = 'X-Glympse-AI-Provider';

function backoffWithJitterMs(attempt: number, baseMs = 200, maxMs = 1_500): number {
  const exp = Math.min(maxMs, baseMs * 2 ** attempt);
  const jitter = exp * 0.25;
  return Math.max(100, Math.floor(exp - jitter + Math.random() * jitter * 2));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function postWriterOutcomeTelemetry(reason: InterpolatorTelemetryReason): Promise<void> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return;

  const outcome = reason === 'success' ? 'model' : 'fallback';
  const endpoint = resolveApiUrl(WRITER_OUTCOME_TELEMETRY_PATH, BASE_URL);
  const payload = {
    outcome,
    reason,
    telemetry: { ...interpolatorTelemetry },
  };

  for (let attempt = 0; attempt < WRITER_OUTCOME_TELEMETRY_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
        credentials: 'same-origin',
      });

      if (response.ok || response.status === 204 || response.status === 403) {
        return;
      }

      if (response.status < 500 && response.status !== 429) {
        return;
      }
    } catch {
      // Best-effort telemetry only. Fail silently.
    }

    if (attempt < WRITER_OUTCOME_TELEMETRY_MAX_ATTEMPTS - 1) {
      await sleep(backoffWithJitterMs(attempt));
    }
  }
}

function logInterpolatorTelemetry(reason: InterpolatorTelemetryReason): void {
  console.info('[interpolator/telemetry]', reason, { ...interpolatorTelemetry });
  void postWriterOutcomeTelemetry(reason);
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

function normalizeSignalExcerpt(value: string, maxLen: number): string {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
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
    if (
      role === 'new_information'
      || role === 'context-setter'
      || /\b(adds?|added|adding|context|background|timeline|details?|update)\b/.test(text)
    ) {
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

function toBehaviorContinuation(phrase: string): string {
  switch (phrase) {
    case 'ask for sourcing':
      return 'asking for sourcing';
    case 'add clarification':
      return 'adding clarification';
    case 'push back on the claim':
      return 'pushing back on the claim';
    case 'compare it to earlier incidents':
      return 'comparing it to earlier incidents';
    case 'add context':
      return 'adding context';
    case 'press for specifics':
      return 'pressing for specifics';
    case 'repeat the same point':
      return 'repeating the same point';
    case 'turn heated quickly':
      return 'heating up quickly';
    default:
      return phrase;
  }
}

type ParsedWhatChangedSignal = {
  kind: string;
  detail: string;
};

function parseWhatChangedSignal(signal: string): ParsedWhatChangedSignal | null {
  const normalized = signal.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;

  const separatorIndex = normalized.indexOf(':');
  if (separatorIndex <= 0) {
    return {
      kind: 'signal',
      detail: normalized,
    };
  }

  const kind = normalized.slice(0, separatorIndex).trim().toLowerCase();
  const detail = normalized.slice(separatorIndex + 1).trim();
  if (!detail) return null;

  return { kind, detail };
}

function buildSpecificReplyPhrases(input: ThreadStateForWriter): string[] {
  const phrases: string[] = [];

  for (const rawSignal of input.whatChangedSignals) {
    const parsed = parseWhatChangedSignal(rawSignal);
    if (!parsed) continue;

    const detail = normalizeSignalExcerpt(parsed.detail, 72);
    if (!detail) continue;

    let phrase = '';
    switch (parsed.kind) {
      case 'source cited':
        phrase = `bring in ${detail}`;
        break;
      case 'clarification':
        phrase = `surface ${detail}`;
        break;
      case 'counterpoint':
        phrase = `push back with ${detail}`;
        break;
      case 'new angle':
      case 'new info':
        phrase = `add ${detail}`;
        break;
      default:
        phrase = detail;
        break;
    }

    if (!phrase) continue;
    if (phrases.some((existing) => existing.toLowerCase() === phrase.toLowerCase())) continue;
    phrases.push(phrase);
    if (phrases.length >= 3) break;
  }

  if (phrases.length > 0) {
    return phrases;
  }

  const factualLead = sentenceLead(input.factualHighlights[0] ?? '', 88);
  if (factualLead) {
    return [`bring in ${normalizeSignalExcerpt(factualLead.toLowerCase(), 72)}`];
  }

  return [];
}

function describeReplyBehavior(input: ThreadStateForWriter): string {
  const counts = computeReplyBehaviorCounts(input);
  if (counts.total === 0) {
    return 'There are no replies yet.';
  }

  const specificPhrases = buildSpecificReplyPhrases(input);
  if (specificPhrases.length > 0) {
    const subject = counts.total >= 8
      ? `Across ${counts.total} visible replies, people`
      : 'Visible replies';
    return `${subject} ${joinBehaviorPhrases(specificPhrases.slice(0, 3))}.`;
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

  const prioritizedPhrases = phrases.length > 1
    ? phrases.filter((phrase) => phrase !== 'add context')
    : phrases;

  if (counts.total <= 4) {
    const continuations = prioritizedPhrases.slice(0, 2).map(toBehaviorContinuation);
    if (continuations.length === 0) {
      return 'Replies add little beyond brief reaction.';
    }
    return `Replies add little beyond ${joinBehaviorPhrases(continuations)}.`;
  }

  const subject = counts.total >= 8
    ? `Across ${counts.total} visible replies, the thread mostly`
    : 'Replies mostly';

  return `${subject} ${joinBehaviorPhrases(prioritizedPhrases.slice(0, 3))}.`;
}

/**
 * Describes what a specific reply is DOING based on its algorithmic role tag.
 * Used in descriptive_fallback to produce synthesis rather than direct quotation.
 */
function describeReplyRoleAction(role?: string): string {
  const r = (role ?? '').toLowerCase();
  if (r === 'source_bringer' || r === 'rule_source') return 'provides a source for the claim';
  if (r === 'clarifying' || r === 'clarifier') return 'clarifies a key point';
  if (r === 'useful_counterpoint' || r === 'counterpoint') return 'offers a counterpoint';
  if (r === 'new_information' || r === 'context-setter') return 'adds relevant context';
  if (r === 'provocative' || r === 'emotional-reaction') return 'responds with a strong reaction';
  if (r === 'direct_response') return 'responds directly to the post';
  if (r === 'story_worthy') return 'shapes the direction of the thread';
  return 'joins the discussion';
}

function normalizedHandle(handle: string): string {
  return handle.trim().replace(/^@+/, '').toLowerCase();
}

function formatHandle(handle: string): string {
  const normalized = normalizedHandle(handle);
  return normalized ? `@${normalized}` : '@unknown';
}

function contributorRoleAction(role?: string): string {
  const normalized = (role ?? '').toLowerCase();
  if (normalized === 'source-bringer' || normalized === 'source_bringer') return 'brings in sourcing';
  if (normalized === 'rule-source' || normalized === 'rule_source') return 'cites an official source';
  if (normalized === 'clarifier' || normalized === 'clarifying') return 'clarifies a key point';
  if (normalized === 'counterpoint' || normalized === 'useful_counterpoint') return 'offers a counterpoint';
  if (normalized === 'question-raiser') return 'presses for specifics';
  if (normalized === 'emotional-reaction' || normalized === 'provocative') return 'reacts strongly';
  if (normalized === 'op') return 'keeps shaping the thread';
  return 'adds context';
}

function isStrongContributor(
  contributor: ThreadStateForWriter['topContributors'][number],
): boolean {
  if (contributor.impactScore >= 0.62) return true;
  return contributor.role === 'source-bringer'
    || contributor.role === 'rule-source'
    || contributor.role === 'clarifier'
    || contributor.role === 'counterpoint';
}

type FallbackContributorMention = {
  handle: string;
  action: string;
  impactScore: number;
};

function buildFallbackContributorMentions(
  input: ThreadStateForWriter,
): FallbackContributorMention[] {
  const mentions: FallbackContributorMention[] = [];
  const seen = new Set<string>();
  const rootHandle = normalizedHandle(input.rootPost.handle);

  const addMention = (handle: string, action: string, impactScore: number): void => {
    const normalized = normalizedHandle(handle);
    if (!normalized || normalized === rootHandle || seen.has(normalized)) return;
    seen.add(normalized);
    mentions.push({ handle: normalized, action, impactScore });
  };

  input.topContributors
    .filter((contributor) => isStrongContributor(contributor))
    .sort((left, right) => right.impactScore - left.impactScore)
    .forEach((contributor) => {
      addMention(contributor.handle, contributorRoleAction(contributor.role), contributor.impactScore);
    });

  if (mentions.length >= 2) {
    return mentions.slice(0, 2);
  }

  input.selectedComments
    .filter((comment) => (
      comment.handle !== input.rootPost.handle
      && comment.impactScore >= 0.62
    ))
    .sort((left, right) => right.impactScore - left.impactScore)
    .forEach((comment) => {
      addMention(comment.handle, describeReplyRoleAction(comment.role), comment.impactScore);
    });

  return mentions
    .sort((left, right) => right.impactScore - left.impactScore)
    .slice(0, 2);
}

function formatContributorSentence(mentions: FallbackContributorMention[]): string {
  if (mentions.length === 0) return '';

  if (mentions.length === 1) {
    const first = mentions[0]!;
    return ensureSentence(`${formatHandle(first.handle)} ${first.action}`);
  }

  const first = mentions[0]!;
  const second = mentions[1]!;
  return ensureSentence(
    `${formatHandle(first.handle)} ${first.action}, while ${formatHandle(second.handle)} ${second.action}`,
  );
}

function normalizeTopicLabel(value: string): string {
  return value
    .replace(/[@#][\w.-]+/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function rootTopicHint(input: ThreadStateForWriter): string | null {
  const entityTheme = input.entityThemes?.find((theme) => theme.trim().length >= 3);
  if (entityTheme) return normalizeTopicLabel(entityTheme);

  const entityLabels = input.safeEntities
    .map((entity) => normalizeTopicLabel(entity.label))
    .filter((label) => label.length >= 3)
    .slice(0, 2);
  if (entityLabels.length > 0) {
    return entityLabels.join(' and ');
  }

  const factualLead = sentenceLead(input.factualHighlights[0] ?? '', 120);
  if (factualLead) return normalizeTopicLabel(factualLead);

  return null;
}

function buildRootParaphraseSentence(input: ThreadStateForWriter): string {
  const { handle, text } = input.rootPost;
  const topicHint = rootTopicHint(input);
  const lower = text.toLowerCase().trimStart();

  if (/^(what|why|how|when|where|who|which|is|are|do|does|can|could|would|should|did|has|have)\b/.test(lower)) {
    return ensureSentence(
      sanitizeSafeSummaryText(
        topicHint
          ? `@${handle} opens a question-driven post about ${topicHint}`
          : `@${handle} opens a question-driven post that sets up the thread`,
      ),
    );
  }

  if (/\b(announcing|launching|releasing|introducing|excited to announce|proud to announce)\b/.test(lower)) {
    return ensureSentence(
      sanitizeSafeSummaryText(
        topicHint
          ? `@${handle} announces an update about ${topicHint}`
          : `@${handle} announces an update that draws immediate responses`,
      ),
    );
  }

  if (/\b(but |however |actually |in fact |that'?s wrong|you'?re wrong|this is (wrong|false)|disagree)\b/.test(lower)) {
    return ensureSentence(
      sanitizeSafeSummaryText(
        topicHint
          ? `@${handle} challenges a claim around ${topicHint}`
          : `@${handle} challenges a claim and pushes the thread into debate`,
      ),
    );
  }

  return ensureSentence(
    sanitizeSafeSummaryText(
      topicHint
        ? `@${handle} makes a claim about ${topicHint}`
        : `@${handle} makes a claim that sets the thread's direction`,
    ),
  );
}

function normalizedWordSequence(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function hasVerbatimWordSpan(summary: string, rootText: string, minWords = 8): boolean {
  const summaryTokens = normalizedWordSequence(summary);
  const rootTokens = normalizedWordSequence(rootText);
  if (summaryTokens.length < minWords || rootTokens.length < minWords) return false;

  const summarySlices = new Set<string>();
  for (let i = 0; i <= summaryTokens.length - minWords; i += 1) {
    summarySlices.add(summaryTokens.slice(i, i + minWords).join(' '));
  }

  for (let i = 0; i <= rootTokens.length - minWords; i += 1) {
    const rootSlice = rootTokens.slice(i, i + minWords).join(' ');
    if (summarySlices.has(rootSlice)) return true;
  }

  return false;
}

function deterministicWriterFallback(input: ThreadStateForWriter): InterpolatorWriteResult {
  const { handle } = input.rootPost;
  const visibleReplyCount = input.visibleReplyCount ?? input.selectedComments.length;

  // Root sentence is intentionally paraphrased to avoid echoing the author's
  // exact wording when the model output is unreliable.
  const rootSentence = buildRootParaphraseSentence(input);

  // Reply engagement line
  const replyLine = visibleReplyCount > 0 ? describeReplyBehavior(input) : '';
  const contributorMentions = buildFallbackContributorMentions(input);
  const contributorSentence = input.summaryMode === 'minimal_fallback'
    ? ''
    : formatContributorSentence(contributorMentions);

  // Most-notable reply: synthesize from role for descriptive_fallback (avoids verbatim copy),
  // use actual text excerpt for normal mode, omit entirely for minimal_fallback.
  const topReply = input.selectedComments
    .filter((c) => c.impactScore >= 0.35 && c.text.trim().length >= 30 && c.handle !== handle)
    .sort((a, b) => b.impactScore - a.impactScore)[0];
  let notableSentence = '';
  const topReplyAlreadyMentioned = contributorMentions.some(
    (mention) => mention.handle === normalizedHandle(topReply?.handle ?? ''),
  );
  if (topReply && !topReplyAlreadyMentioned && input.summaryMode === 'descriptive_fallback') {
    // Role-based synthesis: describes what the reply IS DOING, not what it says verbatim.
    const roleAction = describeReplyRoleAction(topReply.role);
    notableSentence = ensureSentence(sanitizeSafeSummaryText(`@${topReply.handle} ${roleAction}`));
  } else if (topReply && !topReplyAlreadyMentioned && input.summaryMode !== 'minimal_fallback') {
    notableSentence = ensureSentence(sanitizeSafeSummaryText(
      `@${topReply.handle} adds: ${truncateAtWordBoundary(topReply.text.trim(), 130)}`,
    ));
  }

  const maxLen = input.summaryMode === 'minimal_fallback' ? 240 : 420;
  const collapsedSummary = sanitizeSafeSummaryText(
    truncateAtWordBoundary(
      [rootSentence, replyLine, contributorSentence, notableSentence].filter(Boolean).join(' '),
      maxLen,
    ),
  );

  // Contributor blurbs from actual comment text — never from canned role phrases
  const blurbCandidates = input.selectedComments
    .filter((c) => c.impactScore >= 0.35 && c.text.trim().length >= 20)
    .slice(0, input.summaryMode === 'normal' ? 3 : 2);
  const contributorBlurbs = blurbCandidates.map((c) => ({
    handle: sanitizeSafeSummaryText(c.handle),
    blurb: sanitizeSafeSummaryText(truncateAtWordBoundary(c.text.trim(), 160)),
  }));

  const whatChanged = input.summaryMode === 'minimal_fallback'
    ? []
    : input.whatChangedSignals
        .slice(0, 4)
        .map((signal) => sanitizeSafeSummaryText(truncateAtWordBoundary(signal, 90)));

  return {
    collapsedSummary,
    ...(input.summaryMode === 'normal'
      ? {
          expandedSummary: sanitizeSafeSummaryText(
            truncateAtWordBoundary(`${collapsedSummary} This summary is based on thread data only.`, 520),
          ),
        }
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

function hasReplyGroundingSignal(result: InterpolatorWriteResult): boolean {
  const summary = (result.collapsedSummary ?? '').toLowerCase();
  const expanded = (result.expandedSummary ?? '').toLowerCase();

  if (ROOT_ONLY_REPLY_ACTIVITY_RE.test(summary) || ROOT_ONLY_REPLY_ACTIVITY_RE.test(expanded)) {
    return true;
  }

  if ((result.whatChanged ?? []).length > 0) return true;

  const specificContributorBlurbs = (result.contributorBlurbs ?? []).filter((entry) => {
    const blurb = entry.blurb?.trim() ?? '';
    return blurb.length >= 24 && !/\b(is contributing|responded to the post)\b/i.test(blurb);
  });

  return specificContributorBlurbs.length > 0;
}

function summaryMentionsHandle(summary: string, handle: string): boolean {
  const normalized = normalizedHandle(handle);
  if (!normalized) return false;
  return summary.toLowerCase().includes(`@${normalized}`);
}

function shouldPreferDeterministicFallback(
  input: ThreadStateForWriter,
  result: InterpolatorWriteResult,
): boolean {
  const summary = result.collapsedSummary?.trim() ?? '';
  if (!summary) return false;
  if (input.selectedComments.length < 3 && input.whatChangedSignals.length < 2) return false;
  const hasReplyGrounding = hasReplyGroundingSignal(result);

  if (hasVerbatimWordSpan(summary, input.rootPost.text, 8)) {
    return true;
  }

  if (GENERIC_REPLY_ACTIVITY_RE.test(summary)) return true;
  if (input.summaryMode === 'descriptive_fallback') {
    const strongMentions = buildFallbackContributorMentions(input);
    const mentionsRoot = summaryMentionsHandle(summary, input.rootPost.handle);
    const mentionsContributor = strongMentions.length === 0
      || strongMentions.some((mention) => summaryMentionsHandle(summary, mention.handle));
    if (!mentionsRoot || !mentionsContributor) {
      return true;
    }
  }
  if (hasReplyGrounding) return false;

  if (sentenceCount(summary) <= 1 && tokenOverlapRatio(summary, input.rootPost.text) >= 0.88) {
    return true;
  }

  // Catch the descriptive_fallback verbatim-copy pattern: first sentence is a
  // near-verbatim reproduction of the root post regardless of total sentence count.
  const firstSentence = (summary.split(/[.!?]+/)[0] ?? '').trim();
  if (
    firstSentence.length >= 40
    && input.rootPost.text.length >= 60
    && tokenOverlapRatio(firstSentence, input.rootPost.text) >= 0.90
  ) {
    return true;
  }

  return false;
}

// ─── Retry helpers ────────────────────────────────────────────────────────

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
    const combinedSignal = signal
      ? composeAbortSignals([signal, controller.signal])
      : controller.signal;

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
        const error = new Error(`LLM endpoint ${path} responded ${res.status}`) as ModelClientRequestError;
        error.status = res.status;
        error.retryable = canRetryStatus;
        if (!canRetryStatus || attempt === attempts - 1) {
          throw error;
        }
        lastError = error;
        await sleepWithAbort(backoffMs(attempt), combinedSignal);
        continue;
      }

      return (await res.json()) as T;
    } catch (err: unknown) {
      lastError = err;
      const isAbort = err instanceof Error && err.name === 'AbortError';
      const retryable = (err as ModelClientRequestError)?.retryable;
      if (isAbort || retryable === false || attempt === attempts - 1) throw err;
      await sleepWithAbort(backoffMs(attempt), combinedSignal);
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

function sanitizeProcessingText(value: string | undefined, maxLen: number): string {
  return (value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function sanitizeMediaAnalysisRequest(input: MediaAnalysisRequest): MediaAnalysisRequest {
  const mediaUrl = sanitizeUrlForProcessing(input.mediaUrl);
  if (!mediaUrl) {
    throw new Error('Unsafe media URL for remote multimodal processing.');
  }

  return {
    threadId: sanitizeProcessingText(input.threadId, 300),
    mediaUrl,
    nearbyText: sanitizeProcessingText(input.nearbyText, 400),
    candidateEntities: sanitizeArray(input.candidateEntities, 10, 80),
    factualHints: sanitizeArray(input.factualHints, 5, 120),
    ...(input.mediaAlt
      ? { mediaAlt: sanitizeProcessingText(input.mediaAlt, 300) }
      : {}),
  };
}

function sanitizeMediaAnalysisResult(value: MediaAnalysisResult): MediaAnalysisResult {
  const raw = typeof value === 'object' && value !== null
    ? (value as unknown as Record<string, unknown>)
    : {};
  const mediaType = ['screenshot', 'chart', 'document', 'photo', 'meme', 'unknown'].includes(raw.mediaType as string)
    ? raw.mediaType as MediaAnalysisResult['mediaType']
    : 'unknown';
  const mediaSummary = sanitizeSafeSummaryText(
    truncateAtWordBoundary(
      typeof raw.mediaSummary === 'string' ? raw.mediaSummary : '',
      280,
    ),
  );
  const extractedText = typeof raw.extractedText === 'string'
    ? sanitizeProcessingText(raw.extractedText, 500)
    : '';
  const rawModeration = typeof raw.moderation === 'object' && raw.moderation !== null
    ? raw.moderation as Record<string, unknown>
    : null;
  const moderationAction = rawModeration && ['none', 'warn', 'blur', 'drop'].includes(rawModeration.action as string)
    ? rawModeration.action as NonNullable<MediaAnalysisResult['moderation']>['action']
    : 'none';
  const moderationCategories = sanitizeArray(rawModeration?.categories, 4, 40).filter((value) => (
    ['sexual-content', 'nudity', 'graphic-violence', 'extreme-graphic-violence', 'self-harm', 'hate-symbols', 'hate-speech', 'child-safety'].includes(value)
  )) as NonNullable<MediaAnalysisResult['moderation']>['categories'];
  const moderationConfidence = Math.max(
    0,
    Math.min(1, Number.isFinite(rawModeration?.confidence) ? Number(rawModeration?.confidence) : 0),
  );
  const moderationRationale = typeof rawModeration?.rationale === 'string'
    ? sanitizeSafeSummaryText(truncateAtWordBoundary(rawModeration.rationale, 180))
    : '';

  return {
    mediaCentrality: Math.max(0, Math.min(1, Number.isFinite(raw.mediaCentrality) ? Number(raw.mediaCentrality) : 0)),
    mediaType,
    mediaSummary,
    candidateEntities: sanitizeArray(raw.candidateEntities, 5, 80),
    confidence: Math.max(0, Math.min(1, Number.isFinite(raw.confidence) ? Number(raw.confidence) : 0)),
    cautionFlags: sanitizeArray(raw.cautionFlags, 6, 80),
    ...(moderationAction !== 'none' && moderationCategories.length > 0
      ? {
          moderation: {
            action: moderationAction,
            categories: moderationCategories,
            confidence: moderationConfidence,
            allowReveal: rawModeration?.allowReveal !== false,
            ...(moderationRationale ? { rationale: moderationRationale } : {}),
          },
        }
      : {}),
    ...(extractedText ? { extractedText } : {}),
  };
}

function createAbortError(): Error {
  try {
    return new DOMException('Aborted', 'AbortError');
  } catch {
    const error = new Error('Aborted');
    error.name = 'AbortError';
    return error;
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw createAbortError();
}

function shouldAttemptLocalMediaFallback(error: unknown): boolean {
  if (error instanceof Error && error.name === 'AbortError') {
    return false;
  }

  const status = (error as ModelClientRequestError | undefined)?.status;
  if (typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 429) {
    return false;
  }

  return true;
}

async function tryLocalCaptionMediaFallback(
  input: MediaAnalysisRequest,
  signal?: AbortSignal,
): Promise<MediaAnalysisResult | null> {
  try {
    throwIfAborted(signal);
    const caption = await inferenceClient.captionImage(input.mediaUrl);
    throwIfAborted(signal);

    const normalizedCaption = sanitizeSafeSummaryText(
      truncateAtWordBoundary(
        typeof caption === 'string' ? caption : '',
        240,
      ),
    );
    if (!normalizedCaption) return null;

    return buildCaptionFallbackMediaAnalysis(input, normalizedCaption);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    return null;
  }
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
    provider: value.provider === 'openai' ? 'openai' : 'gemini',
    updatedAt: value.updatedAt,
    ...(value.sourceComputedAt ? { sourceComputedAt: value.sourceComputedAt } : {}),
    ...(safety ? { safety } : {}),
  };
}

function premiumEntitlementCacheKey(actorDid: string): string {
  const preferredProvider = getPremiumAiProviderPreference();
  return `${actorDid.trim().toLowerCase()}::${preferredProvider}`;
}

function getPremiumAiProviderPreference(): PremiumAiProviderPreference {
  const preferredProvider = useInterpolatorSettingsStore.getState().premiumProviderPreference;
  if (preferredProvider === 'gemini' || preferredProvider === 'openai') {
    return preferredProvider;
  }
  return 'auto';
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
        headers: {
          [PREMIUM_AI_PROVIDER_HEADER]: getPremiumAiProviderPreference(),
        },
      },
    );

    if (result.abstained || !result.collapsedSummary?.trim()) {
      interpolatorTelemetry.abstained += 1;
      const fallback = deterministicWriterFallback(input);
      logInterpolatorTelemetry('abstained-response-fallback');
      recordInterpolatorWriterOutcome(input.summaryMode, 'fallback');
      return fallback;
    }

    if (shouldPreferDeterministicFallback(input, result)) {
      interpolatorTelemetry.abstained += 1;
      const fallback = deterministicWriterFallback(input);
      logInterpolatorTelemetry('root-only-response-fallback');
      recordInterpolatorWriterOutcome(input.summaryMode, 'fallback');
      return fallback;
    }

    interpolatorTelemetry.succeeded += 1;
    logInterpolatorTelemetry('success');
    recordInterpolatorWriterOutcome(input.summaryMode, 'model');

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
    recordInterpolatorWriterOutcome(input.summaryMode, 'fallback');
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
  const request = sanitizeMediaAnalysisRequest(input);

  try {
    const result = await fetchWithRetry<MediaAnalysisResult>(
      '/api/llm/analyze/media',
      request,
      signal,
    );
    return refineMediaAnalysisResult(request, sanitizeMediaAnalysisResult(result));
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }

    if (shouldAttemptLocalMediaFallback(error)) {
      const localFallback = await tryLocalCaptionMediaFallback(request, signal);
      if (localFallback) {
        return localFallback;
      }
    }

    throw error;
  }
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
      availableProviders: [],
    };
  }

  const preferredProvider = getPremiumAiProviderPreference();
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
        [PREMIUM_AI_PROVIDER_HEADER]: preferredProvider,
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
  const preferredProvider = getPremiumAiProviderPreference();
  const result = await fetchWithRetry<DeepInterpolatorResult>(
    '/api/premium-ai/interpolator/deep',
    input,
    signal,
    {
      attempts: 2,
      retryOnStatuses: [408, 429, 500, 502, 503, 504],
      headers: {
        'X-Glympse-User-Did': input.actorDid,
        [PREMIUM_AI_PROVIDER_HEADER]: preferredProvider,
      },
    },
  );

  return sanitizeDeepInterpolatorResult(result);
}
