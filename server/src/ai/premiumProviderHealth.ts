import { extractRetryAfterMs } from '../lib/retry.js';

export type PremiumAiProviderName = 'gemini' | 'openai';

export type PremiumAiProviderOutageReason =
  | 'insufficient_quota'
  | 'auth_unavailable'
  | 'rate_limited'
  | 'timeout'
  | 'model_unavailable'
  | 'quality_unavailable'
  | 'provider_unavailable';

const PERSISTENT_PROVIDER_OUTAGE_REASONS = new Set<PremiumAiProviderOutageReason>([
  'insufficient_quota',
  'auth_unavailable',
  'model_unavailable',
]);

type ProviderHealthState = {
  unavailableUntil?: number;
  reason?: PremiumAiProviderOutageReason;
};

const PROVIDER_HEALTH: Record<PremiumAiProviderName, ProviderHealthState> = {
  gemini: {},
  openai: {},
};

const PROVIDER_OUTAGE_COOLDOWN_MS: Record<PremiumAiProviderOutageReason, number> = {
  insufficient_quota: 30 * 60 * 1000,
  auth_unavailable: 30 * 60 * 1000,
  rate_limited: 90 * 1000,
  timeout: 60 * 1000,
  model_unavailable: 2 * 60 * 1000,
  quality_unavailable: 60 * 1000,
  provider_unavailable: 2 * 60 * 1000,
};

function normalizeErrorCode(error: unknown): string {
  const rawCode = (error as { code?: unknown })?.code;
  return typeof rawCode === 'string' ? rawCode.trim().toLowerCase() : '';
}

function normalizeErrorStatus(error: unknown): number | undefined {
  const rawStatus = (error as { status?: unknown })?.status;
  return typeof rawStatus === 'number' && Number.isFinite(rawStatus)
    ? Math.trunc(rawStatus)
    : undefined;
}

export function classifyPremiumAiProviderOutage(error: unknown): PremiumAiProviderOutageReason | null {
  const code = normalizeErrorCode(error);
  if (code === 'insufficient_quota' || code === 'billing_hard_limit_reached') {
    return 'insufficient_quota';
  }
  if (code === 'deep_interpolator_non_additive_output' || code === 'deep_interpolator_low_signal_output') {
    return 'quality_unavailable';
  }
  if (
    code === 'openai_empty_structured_output'
    || code === 'openai_invalid_structured_output'
    || code === 'deep_interpolator_empty_structured_output'
    || code === 'deep_interpolator_invalid_structured_output'
  ) {
    return 'quality_unavailable';
  }
  if (
    code === 'model_not_found'
    || code === 'not_found'
    || code === 'resource_not_found'
    || code === 'unsupported_model'
    || code === 'gemini_model_fallback_exhausted'
  ) {
    return 'model_unavailable';
  }

  const status = normalizeErrorStatus(error);
  if (status === 401 || status === 403) {
    return 'auth_unavailable';
  }
  if (status === 404) {
    return 'model_unavailable';
  }
  if (status === 429) {
    return 'rate_limited';
  }
  if (status === 408 || status === 504) {
    return 'timeout';
  }
  if (status === 500 || status === 502 || status === 503) {
    return 'provider_unavailable';
  }

  if (code === 'invalid_api_key' || code === 'authentication_error') {
    return 'auth_unavailable';
  }
  if (code === 'rate_limit_exceeded' || code === 'resource_exhausted' || code === 'too_many_requests') {
    return 'rate_limited';
  }
  if (code === 'deadline_exceeded' || code === 'timeout' || code === 'etimedout') {
    return 'timeout';
  }

  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('model unavailable') || message.includes('model not found') || message.includes('unsupported model')) {
    return 'model_unavailable';
  }
  if (
    message.includes('non-additive summary')
    || message.includes('low-signal output')
    || message.includes('invalid structured output')
    || message.includes('empty structured output')
  ) {
    return 'quality_unavailable';
  }
  if (message.includes('rate limit')) return 'rate_limited';
  if (message.includes('deadline exceeded') || message.includes('timed out') || message.includes('timeout')) {
    return 'timeout';
  }
  if (message.includes('service unavailable') || message.includes('temporarily unavailable')) {
    return 'provider_unavailable';
  }

  return null;
}

export function isPersistentPremiumAiProviderOutageReason(
  reason: PremiumAiProviderOutageReason | null | undefined,
): boolean {
  return typeof reason === 'string' && PERSISTENT_PROVIDER_OUTAGE_REASONS.has(reason);
}

function activeOutage(provider: PremiumAiProviderName, now = Date.now()): ProviderHealthState | null {
  const current = PROVIDER_HEALTH[provider];
  if (!current.unavailableUntil || current.unavailableUntil <= now) {
    if (current.unavailableUntil) {
      PROVIDER_HEALTH[provider] = {};
    }
    return null;
  }
  return current;
}

export function isPremiumAiProviderOperational(provider: PremiumAiProviderName, now = Date.now()): boolean {
  return activeOutage(provider, now) === null;
}

export function recordPremiumAiProviderSuccess(provider: PremiumAiProviderName): void {
  PROVIDER_HEALTH[provider] = {};
}

export function recordPremiumAiProviderFailure(provider: PremiumAiProviderName, error: unknown): void {
  const outageReason = classifyPremiumAiProviderOutage(error);
  if (!outageReason) return;
  const retryAfterMs = extractRetryAfterMs(error);
  const cooldownMs = typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs > 0
    ? Math.min(5 * 60 * 1000, Math.max(5_000, retryAfterMs))
    : PROVIDER_OUTAGE_COOLDOWN_MS[outageReason];

  PROVIDER_HEALTH[provider] = {
    reason: outageReason,
    unavailableUntil: Date.now() + cooldownMs,
  };
}

export function isPremiumAiProviderUnavailableError(error: unknown): boolean {
  return classifyPremiumAiProviderOutage(error) !== null;
}

export function getPremiumAiProviderHealthSnapshot(now = Date.now()): Record<PremiumAiProviderName, {
  operational: boolean;
  reason: PremiumAiProviderOutageReason | null;
  unavailableUntil: string | null;
}> {
  return {
    gemini: {
      operational: isPremiumAiProviderOperational('gemini', now),
      reason: PROVIDER_HEALTH.gemini.reason ?? null,
      unavailableUntil: PROVIDER_HEALTH.gemini.unavailableUntil
        ? new Date(PROVIDER_HEALTH.gemini.unavailableUntil).toISOString()
        : null,
    },
    openai: {
      operational: isPremiumAiProviderOperational('openai', now),
      reason: PROVIDER_HEALTH.openai.reason ?? null,
      unavailableUntil: PROVIDER_HEALTH.openai.unavailableUntil
        ? new Date(PROVIDER_HEALTH.openai.unavailableUntil).toISOString()
        : null,
    },
  };
}

export function resetPremiumAiProviderHealthForTests(): void {
  PROVIDER_HEALTH.gemini = {};
  PROVIDER_HEALTH.openai = {};
}

export function resetPremiumAiProviderHealth(): void {
  resetPremiumAiProviderHealthForTests();
}
