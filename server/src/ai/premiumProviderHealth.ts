import { extractRetryAfterMs } from '../lib/retry.js';

export type PremiumAiProviderName = 'gemini' | 'openai';

type ProviderOutageReason =
  | 'insufficient_quota'
  | 'auth_unavailable'
  | 'rate_limited'
  | 'timeout'
  | 'provider_unavailable';

type ProviderHealthState = {
  unavailableUntil?: number;
  reason?: ProviderOutageReason;
};

const PROVIDER_HEALTH: Record<PremiumAiProviderName, ProviderHealthState> = {
  gemini: {},
  openai: {},
};

const PROVIDER_OUTAGE_COOLDOWN_MS: Record<ProviderOutageReason, number> = {
  insufficient_quota: 30 * 60 * 1000,
  auth_unavailable: 30 * 60 * 1000,
  rate_limited: 90 * 1000,
  timeout: 60 * 1000,
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

function classifyProviderOutage(error: unknown): ProviderOutageReason | null {
  const code = normalizeErrorCode(error);
  if (code === 'insufficient_quota' || code === 'billing_hard_limit_reached') {
    return 'insufficient_quota';
  }

  const status = normalizeErrorStatus(error);
  if (status === 401 || status === 403) {
    return 'auth_unavailable';
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
  if (message.includes('rate limit')) return 'rate_limited';
  if (message.includes('deadline exceeded') || message.includes('timed out') || message.includes('timeout')) {
    return 'timeout';
  }
  if (message.includes('service unavailable') || message.includes('temporarily unavailable')) {
    return 'provider_unavailable';
  }

  return null;
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
  const outageReason = classifyProviderOutage(error);
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
  return classifyProviderOutage(error) !== null;
}

export function resetPremiumAiProviderHealthForTests(): void {
  PROVIDER_HEALTH.gemini = {};
  PROVIDER_HEALTH.openai = {};
}
