import type {
  DeepInterpolatorResult,
  PremiumAiEntitlements,
  PremiumAiProvider,
  PremiumAiSafetyMetadata,
  PremiumInterpolatorRequest,
} from '../intelligence/premiumContracts';

export const CONVERSATION_COORDINATOR_PREMIUM_STAGE_VERSION = 1 as const;

export type ConversationCoordinatorPremiumStatus = 'ready' | 'not_entitled' | 'skipped' | 'error';

export type ConversationCoordinatorPremiumReasonCode =
  | 'premium_entitlement_allowed'
  | 'premium_provider_unavailable'
  | 'premium_capability_missing'
  | 'premium_redaction_required'
  | 'premium_result_ready'
  | 'premium_result_invalid'
  | 'premium_result_missing_summary'
  | 'premium_result_normalized'
  | 'premium_execution_failed'
  | 'premium_retry_attempted';

export interface ConversationCoordinatorPremiumRetryPolicy {
  maxAttempts: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
}

export interface ConversationCoordinatorPremiumExecutionContext {
  provider: PremiumAiProvider;
  attempt: number;
  signal?: AbortSignal;
}

export type ConversationCoordinatorPremiumFunction = (
  request: PremiumInterpolatorRequest,
  context: ConversationCoordinatorPremiumExecutionContext,
) => Promise<unknown>;

export type ConversationCoordinatorPremiumSleep = (
  delayMs: number,
  signal?: AbortSignal,
) => Promise<void>;

export type ConversationCoordinatorNowIso = () => string;

export type ConversationCoordinatorPremiumOutcome =
  | {
      schemaVersion: typeof CONVERSATION_COORDINATOR_PREMIUM_STAGE_VERSION;
      status: 'ready';
      result: DeepInterpolatorResult;
      provider: PremiumAiProvider;
      durationMs: number;
      attempts: number;
      reasonCodes: ConversationCoordinatorPremiumReasonCode[];
      diagnostics: {
        redactionVerified: true;
        normalized: boolean;
        safetyFlagged: boolean;
      };
    }
  | {
      schemaVersion: typeof CONVERSATION_COORDINATOR_PREMIUM_STAGE_VERSION;
      status: 'not_entitled' | 'skipped' | 'error';
      error: string;
      provider: PremiumAiProvider | null;
      durationMs: number;
      attempts: number;
      reasonCodes: ConversationCoordinatorPremiumReasonCode[];
      diagnostics: {
        redactionVerified: boolean;
        normalized: false;
        safetyFlagged: false;
      };
    };

export interface ConversationCoordinatorPremiumExecutionInput {
  request: PremiumInterpolatorRequest;
  entitlements: PremiumAiEntitlements;
  executePremium: ConversationCoordinatorPremiumFunction;
  redactionVerified: boolean;
  signal?: AbortSignal;
  retryPolicy?: ConversationCoordinatorPremiumRetryPolicy;
  sleep?: ConversationCoordinatorPremiumSleep;
  nowMs?: () => number;
  nowIso?: ConversationCoordinatorNowIso;
  random?: () => number;
}

interface NormalizedPremiumResult {
  result: DeepInterpolatorResult;
  normalized: boolean;
}

const DEFAULT_RETRY_BASE_MS = 300;
const DEFAULT_RETRY_MAX_MS = 4_000;
const DEFAULT_JITTER_RATIO = 0.25;
const MAX_RETRY_ATTEMPTS = 4;

export async function executeConversationCoordinatorPremiumStage(
  input: ConversationCoordinatorPremiumExecutionInput,
): Promise<ConversationCoordinatorPremiumOutcome> {
  const now = input.nowMs ?? defaultNowMs;
  const getNowIso = input.nowIso ?? defaultNowIso;
  const startedAt = now();
  const provider = selectProvider(input.entitlements);

  assertNotAborted(input.signal);

  if (!input.redactionVerified) {
    return buildNonReadyOutcome({
      status: 'skipped',
      error: 'Premium request redaction was not verified before provider execution.',
      provider,
      durationMs: elapsedMs(startedAt, now()),
      attempts: 0,
      redactionVerified: false,
      reasonCodes: ['premium_redaction_required'],
    });
  }

  if (!input.entitlements.providerAvailable || !provider) {
    return buildNonReadyOutcome({
      status: 'not_entitled',
      error: 'Premium AI provider is unavailable for this account.',
      provider,
      durationMs: elapsedMs(startedAt, now()),
      attempts: 0,
      redactionVerified: true,
      reasonCodes: ['premium_provider_unavailable'],
    });
  }

  if (!input.entitlements.capabilities.includes('deep_interpolator')) {
    return buildNonReadyOutcome({
      status: 'not_entitled',
      error: 'Premium deep interpolator capability is not enabled for this account.',
      provider,
      durationMs: elapsedMs(startedAt, now()),
      attempts: 0,
      redactionVerified: true,
      reasonCodes: ['premium_capability_missing'],
    });
  }

  const retryPolicy = normalizeRetryPolicy(input.retryPolicy);
  const sleep = input.sleep ?? sleepWithAbort;
  const random = input.random ?? Math.random;
  const reasonCodes: ConversationCoordinatorPremiumReasonCode[] = ['premium_entitlement_allowed'];
  let attempts = 0;
  let lastError: unknown = null;

  for (let attemptIndex = 0; attemptIndex < retryPolicy.maxAttempts; attemptIndex += 1) {
    attempts = attemptIndex + 1;
    assertNotAborted(input.signal);

    try {
      const rawResult = await input.executePremium(input.request, {
        provider,
        attempt: attempts,
        ...(input.signal ? { signal: input.signal } : {}),
      });
      assertNotAborted(input.signal);

      const normalized = normalizePremiumResult(rawResult, provider, getNowIso());
      if (!normalized) {
        return buildNonReadyOutcome({
          status: 'error',
          error: 'Premium deep interpolator returned an invalid result.',
          provider,
          durationMs: elapsedMs(startedAt, now()),
          attempts,
          redactionVerified: true,
          reasonCodes: unique([...reasonCodes, 'premium_result_invalid']),
        });
      }

      if (normalized.result.summary.length === 0) {
        return buildNonReadyOutcome({
          status: 'error',
          error: 'Premium deep interpolator returned an empty summary.',
          provider,
          durationMs: elapsedMs(startedAt, now()),
          attempts,
          redactionVerified: true,
          reasonCodes: unique([...reasonCodes, 'premium_result_missing_summary']),
        });
      }

      return {
        schemaVersion: CONVERSATION_COORDINATOR_PREMIUM_STAGE_VERSION,
        status: 'ready',
        result: normalized.result,
        provider,
        durationMs: elapsedMs(startedAt, now()),
        attempts,
        reasonCodes: unique([
          ...reasonCodes,
          'premium_result_ready',
          ...(attempts > 1 ? ['premium_retry_attempted' as const] : []),
          ...(normalized.normalized ? ['premium_result_normalized' as const] : []),
        ]),
        diagnostics: {
          redactionVerified: true,
          normalized: normalized.normalized,
          safetyFlagged: Boolean(normalized.result.safety?.flagged),
        },
      };
    } catch (error) {
      if (isAbortError(error)) throw error;
      lastError = error;

      const canRetry = attemptIndex < retryPolicy.maxAttempts - 1 && isRetryableError(error);
      if (!canRetry) break;

      reasonCodes.push('premium_retry_attempted');
      const delayMs = computeBackoffDelayMs(attemptIndex, retryPolicy, random);
      await sleep(delayMs, input.signal);
    }
  }

  return buildNonReadyOutcome({
    status: 'error',
    error: sanitizeErrorMessage(lastError, 'Premium deep interpolator failed.'),
    provider,
    durationMs: elapsedMs(startedAt, now()),
    attempts,
    redactionVerified: true,
    reasonCodes: unique([...reasonCodes, 'premium_execution_failed']),
  });
}

function normalizePremiumResult(
  raw: unknown,
  fallbackProvider: PremiumAiProvider,
  fallbackUpdatedAt: string,
): NormalizedPremiumResult | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.summary !== 'string') return null;
  if (!Array.isArray(raw.perspectiveGaps)) return null;
  if (!Array.isArray(raw.followUpQuestions)) return null;
  if (typeof raw.confidence !== 'number') return null;

  let normalized = false;
  const summary = normalizeText(raw.summary, 2_000);
  if (summary !== raw.summary) normalized = true;

  const groundedContext = typeof raw.groundedContext === 'string'
    ? normalizeText(raw.groundedContext, 2_000)
    : undefined;
  if (groundedContext !== undefined && groundedContext !== raw.groundedContext) normalized = true;

  const perspectiveGaps = normalizeStringArray(raw.perspectiveGaps, 8, 280);
  if (arrayWasNormalized(raw.perspectiveGaps, perspectiveGaps)) normalized = true;

  const followUpQuestions = normalizeStringArray(raw.followUpQuestions, 6, 260);
  if (arrayWasNormalized(raw.followUpQuestions, followUpQuestions)) normalized = true;

  const confidence = clampUnit(raw.confidence);
  if (confidence !== raw.confidence) normalized = true;

  const provider = normalizeProvider(raw.provider, fallbackProvider);
  if (provider !== raw.provider) normalized = true;

  const updatedAt = typeof raw.updatedAt === 'string' && raw.updatedAt.trim().length > 0
    ? raw.updatedAt.trim()
    : fallbackUpdatedAt;
  if (updatedAt !== raw.updatedAt) normalized = true;

  const sourceComputedAt = typeof raw.sourceComputedAt === 'string' && raw.sourceComputedAt.trim().length > 0
    ? raw.sourceComputedAt.trim()
    : undefined;
  if (sourceComputedAt !== undefined && sourceComputedAt !== raw.sourceComputedAt) normalized = true;

  const safety = normalizeSafety(raw.safety);
  if (raw.safety !== undefined && !safety) normalized = true;

  return {
    result: {
      summary,
      ...(groundedContext ? { groundedContext } : {}),
      perspectiveGaps,
      followUpQuestions,
      confidence,
      provider,
      updatedAt,
      ...(sourceComputedAt ? { sourceComputedAt } : {}),
      ...(safety ? { safety } : {}),
    },
    normalized,
  };
}

function normalizeSafety(value: unknown): PremiumAiSafetyMetadata | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.flagged !== 'boolean') return undefined;
  if (!Array.isArray(value.categories)) return undefined;

  const severity = value.severity === 'none'
    || value.severity === 'low'
    || value.severity === 'medium'
    || value.severity === 'high'
    ? value.severity
    : 'none';

  return {
    flagged: value.flagged,
    severity,
    categories: normalizeStringArray(value.categories, 12, 80),
  };
}

function selectProvider(entitlements: PremiumAiEntitlements): PremiumAiProvider | null {
  if (entitlements.provider) return entitlements.provider;
  return entitlements.availableProviders?.[0] ?? null;
}

function normalizeProvider(value: unknown, fallbackProvider: PremiumAiProvider): PremiumAiProvider {
  return value === 'gemini' || value === 'openai' ? value : fallbackProvider;
}

function normalizeRetryPolicy(policy: ConversationCoordinatorPremiumRetryPolicy | undefined): Required<ConversationCoordinatorPremiumRetryPolicy> {
  const maxAttempts = sanitizeInteger(policy?.maxAttempts ?? 1, 1, MAX_RETRY_ATTEMPTS);
  return {
    maxAttempts,
    baseDelayMs: sanitizeInteger(policy?.baseDelayMs ?? DEFAULT_RETRY_BASE_MS, 0, 60_000),
    maxDelayMs: sanitizeInteger(policy?.maxDelayMs ?? DEFAULT_RETRY_MAX_MS, 0, 60_000),
    jitterRatio: clamp(policy?.jitterRatio ?? DEFAULT_JITTER_RATIO, 0, 1),
  };
}

function computeBackoffDelayMs(
  attemptIndex: number,
  policy: Required<ConversationCoordinatorPremiumRetryPolicy>,
  random: () => number,
): number {
  const exponential = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** attemptIndex);
  const jitter = exponential * policy.jitterRatio;
  const rawRandom = random();
  const boundedRandom = Number.isFinite(rawRandom) ? clamp(rawRandom, 0, 1) : 0.5;
  return Math.max(0, Math.round(exponential - jitter + boundedRandom * jitter * 2));
}

async function sleepWithAbort(delayMs: number, signal: AbortSignal | undefined): Promise<void> {
  if (delayMs <= 0) {
    assertNotAborted(signal);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }

    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);

    const onAbort = () => {
      cleanup();
      reject(createAbortError());
    };

    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function isRetryableError(error: unknown): boolean {
  if (isRecord(error)) {
    if (error.retryable === true) return true;
    const status = typeof error.status === 'number' ? error.status : undefined;
    if (status === 408 || status === 409 || status === 425 || status === 429) return true;
    if (status !== undefined && status >= 500) return true;
  }

  return error instanceof TypeError && isNetworkTypeErrorMessage(error.message);
}

function isNetworkTypeErrorMessage(message: string): boolean {
  const lower = message.toLowerCase();
  if (isLikelyPropertyAccessTypeError(lower)) return false;

  return lower.includes('failed to fetch')
    || lower.includes('networkerror')
    || lower.includes('network error')
    || lower.includes('load failed')
    || lower.includes('connection')
    || lower.includes('timed out')
    || lower.includes('timeout')
    || lower.includes('socket')
    || lower.includes('econnreset')
    || lower.includes('fetch failed');
}

function isLikelyPropertyAccessTypeError(lowerMessage: string): boolean {
  return lowerMessage.includes('cannot read')
    || lowerMessage.includes('cannot set')
    || lowerMessage.includes('read properties')
    || lowerMessage.includes('reading ')
    || lowerMessage.includes('setting ')
    || lowerMessage.includes('property ')
    || lowerMessage.includes('is not a function');
}

function buildNonReadyOutcome(params: {
  status: 'not_entitled' | 'skipped' | 'error';
  error: string;
  provider: PremiumAiProvider | null;
  durationMs: number;
  attempts: number;
  redactionVerified: boolean;
  reasonCodes: readonly ConversationCoordinatorPremiumReasonCode[];
}): ConversationCoordinatorPremiumOutcome {
  return {
    schemaVersion: CONVERSATION_COORDINATOR_PREMIUM_STAGE_VERSION,
    status: params.status,
    error: params.error,
    provider: params.provider,
    durationMs: params.durationMs,
    attempts: params.attempts,
    reasonCodes: unique(params.reasonCodes),
    diagnostics: {
      redactionVerified: params.redactionVerified,
      normalized: false,
      safetyFlagged: false,
    },
  };
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw createAbortError();
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function createAbortError(): Error {
  const error = new Error('Premium execution aborted.');
  error.name = 'AbortError';
  return error;
}

function sanitizeErrorMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : String(error ?? fallback);
  const sanitized = raw.replace(/[\u0000-\u001F\u007F]+/g, ' ').trim();
  return (sanitized || fallback).slice(0, 240);
}

function normalizeText(value: string, maxChars: number): string {
  return value
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars)
    .trim();
}

function normalizeStringArray(value: unknown[], maxItems: number, maxChars: number): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (typeof item !== 'string') continue;
    const text = normalizeText(item, maxChars);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(text);
    if (normalized.length >= maxItems) break;
  }

  return normalized;
}

function arrayWasNormalized(raw: unknown[], normalized: string[]): boolean {
  return normalized.length !== raw.length
    || normalized.some((value, index) => value !== raw[index]);
}

function clampUnit(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function sanitizeInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function elapsedMs(startedAt: number, endedAt: number): number {
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) return 0;
  return Math.max(0, Math.round(endedAt - startedAt));
}

function defaultNowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function defaultNowIso(): string {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unique<T>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}
