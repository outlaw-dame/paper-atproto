export type PremiumAiProviderName = 'gemini' | 'openai';

type ProviderOutageReason = 'insufficient_quota' | 'auth_unavailable';

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

  if (code === 'invalid_api_key' || code === 'authentication_error') {
    return 'auth_unavailable';
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

  PROVIDER_HEALTH[provider] = {
    reason: outageReason,
    unavailableUntil: Date.now() + PROVIDER_OUTAGE_COOLDOWN_MS[outageReason],
  };
}

export function isPremiumAiProviderUnavailableError(error: unknown): boolean {
  return classifyProviderOutage(error) !== null;
}

export function resetPremiumAiProviderHealthForTests(): void {
  PROVIDER_HEALTH.gemini = {};
  PROVIDER_HEALTH.openai = {};
}
