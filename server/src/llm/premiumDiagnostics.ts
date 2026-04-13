import {
  classifyPremiumAiProviderOutage,
  type PremiumAiProviderName,
  type PremiumAiProviderOutageReason,
} from '../ai/premiumProviderHealth.js';
import { extractRetryAfterMs } from '../lib/retry.js';

type PremiumProviderAttemptKind = 'primary' | 'fallback';

type PremiumProviderModelDiagnosticsState = {
  attempts: number;
  successes: number;
  failures: number;
  lastUsedAt: string | null;
};

export type PremiumDiagnosticsFailureClass =
  | PremiumAiProviderOutageReason
  | 'invalid_output'
  | 'bad_request'
  | 'safety_blocked'
  | 'unknown';

type PremiumRouteFailureDetail = {
  at: string;
  provider?: PremiumAiProviderName;
  attemptKind?: PremiumProviderAttemptKind;
  failureClass: PremiumDiagnosticsFailureClass;
  message: string;
  retryable: boolean;
  requestId?: string;
  status?: number;
  code?: string;
  retryAfterMs?: number;
};

type PremiumProviderDiagnosticsState = {
  attempts: number;
  primaryAttempts: number;
  fallbackAttempts: number;
  successes: number;
  failures: number;
  failoversFrom: number;
  failoversTo: number;
  qualityRejects: {
    nonAdditive: number;
    lowSignal: number;
  };
  failureClassCounts: Record<PremiumDiagnosticsFailureClass, number>;
  latencyMs: {
    total: number;
    max: number;
    last: number;
  };
  lastModel: string | null;
  models: Record<string, PremiumProviderModelDiagnosticsState>;
};

type PremiumDiagnosticsState = {
  startedAt: string;
  lastUpdatedAt: string;
  telemetryEvents: number;
  route: {
    invocations: number;
    successes: number;
    failures: number;
    failovers: {
      attempted: number;
      succeeded: number;
      failed: number;
    };
    safetyFilter: {
      runs: number;
      mutated: number;
      blocked: number;
    };
  };
  providers: Record<PremiumAiProviderName, PremiumProviderDiagnosticsState>;
  lastFailure: PremiumRouteFailureDetail | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

function createInitialProviderState(): PremiumProviderDiagnosticsState {
  return {
    attempts: 0,
    primaryAttempts: 0,
    fallbackAttempts: 0,
    successes: 0,
    failures: 0,
    failoversFrom: 0,
    failoversTo: 0,
    qualityRejects: {
      nonAdditive: 0,
      lowSignal: 0,
    },
    failureClassCounts: {
      insufficient_quota: 0,
      auth_unavailable: 0,
      rate_limited: 0,
      timeout: 0,
      model_unavailable: 0,
      quality_unavailable: 0,
      provider_unavailable: 0,
      invalid_output: 0,
      bad_request: 0,
      safety_blocked: 0,
      unknown: 0,
    },
    latencyMs: {
      total: 0,
      max: 0,
      last: 0,
    },
    lastModel: null,
    models: {},
  };
}

function createInitialProviderModelState(): PremiumProviderModelDiagnosticsState {
  return {
    attempts: 0,
    successes: 0,
    failures: 0,
    lastUsedAt: null,
  };
}

function normalizeModelName(model: string): string | null {
  const normalized = model.trim();
  return normalized.length > 0 ? normalized : null;
}

function getOrCreateProviderModelState(
  provider: PremiumAiProviderName,
  model: string,
): PremiumProviderModelDiagnosticsState | null {
  const normalizedModel = normalizeModelName(model);
  if (!normalizedModel) return null;

  const providerState = state.providers[provider];
  providerState.models[normalizedModel] ??= createInitialProviderModelState();
  return providerState.models[normalizedModel]!;
}

function createInitialState(): PremiumDiagnosticsState {
  const timestamp = nowIso();
  return {
    startedAt: timestamp,
    lastUpdatedAt: timestamp,
    telemetryEvents: 0,
    route: {
      invocations: 0,
      successes: 0,
      failures: 0,
      failovers: {
        attempted: 0,
        succeeded: 0,
        failed: 0,
      },
      safetyFilter: {
        runs: 0,
        mutated: 0,
        blocked: 0,
      },
    },
    providers: {
      gemini: createInitialProviderState(),
      openai: createInitialProviderState(),
    },
    lastFailure: null,
  };
}

let state: PremiumDiagnosticsState = createInitialState();

function safeRatio(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return Number((numerator / denominator).toFixed(4));
}

function normalizeStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown })?.status;
  return typeof status === 'number' && Number.isFinite(status) ? Math.trunc(status) : undefined;
}

function normalizeCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown })?.code;
  if (typeof code !== 'string') return undefined;
  const normalized = code.trim().toLowerCase();
  return normalized || undefined;
}

function sanitizeMessage(message: string): string {
  return message
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function isRetryableFailure(status: number | undefined, failureClass: PremiumDiagnosticsFailureClass): boolean {
  if (failureClass === 'bad_request' || failureClass === 'invalid_output') return false;
  if (failureClass === 'auth_unavailable' || failureClass === 'insufficient_quota') return false;
  if (typeof status !== 'number') return true;
  return [408, 425, 429, 500, 502, 503, 504].includes(status);
}

function classifyPremiumDiagnosticsFailure(error: unknown): PremiumDiagnosticsFailureClass {
  const code = normalizeCode(error);
  if (code === 'premium_ai_safety_blocked') {
    return 'safety_blocked';
  }
  if (code === 'openai_empty_structured_output' || code === 'openai_invalid_structured_output') {
    return 'invalid_output';
  }
  if (code === 'gemini_empty_structured_output' || code === 'gemini_invalid_structured_output') {
    return 'invalid_output';
  }

  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('safety validation') || message.includes('unsafe')) {
    return 'safety_blocked';
  }
  if (message.includes('structured output') || message.includes('invalid json')) {
    return 'invalid_output';
  }

  const outage = classifyPremiumAiProviderOutage(error);
  if (outage) return outage;

  const status = normalizeStatus(error);
  if (status === 400 || status === 413 || status === 422) {
    return 'bad_request';
  }

  return 'unknown';
}

function recordProviderLatency(provider: PremiumAiProviderName, latencyMs: number): void {
  const providerState = state.providers[provider];
  const safeLatency = Number.isFinite(latencyMs)
    ? Math.max(0, Math.floor(latencyMs))
    : 0;
  providerState.latencyMs.total += safeLatency;
  providerState.latencyMs.last = safeLatency;
  providerState.latencyMs.max = Math.max(providerState.latencyMs.max, safeLatency);
}

export function recordPremiumRouteInvocation(): void {
  state.telemetryEvents += 1;
  state.lastUpdatedAt = nowIso();
  state.route.invocations += 1;
}

export function recordPremiumRouteSuccess(): void {
  state.telemetryEvents += 1;
  state.lastUpdatedAt = nowIso();
  state.route.successes += 1;
}

export function recordPremiumRouteFailure(params: {
  error: unknown;
  requestId?: string;
  provider?: PremiumAiProviderName;
  attemptKind?: PremiumProviderAttemptKind;
}): void {
  const failureClass = classifyPremiumDiagnosticsFailure(params.error);
  const status = normalizeStatus(params.error);
  const code = normalizeCode(params.error);
  const retryAfterMs = extractRetryAfterMs(params.error);
  const rawMessage = params.error instanceof Error ? params.error.message : 'Premium AI failed';
  const provider = params.provider ?? ((params.error as { premiumProvider?: unknown })?.premiumProvider as PremiumAiProviderName | undefined);
  const attemptKind = params.attemptKind ?? ((params.error as { premiumAttemptKind?: unknown })?.premiumAttemptKind as PremiumProviderAttemptKind | undefined);

  state.telemetryEvents += 1;
  state.lastUpdatedAt = nowIso();
  state.route.failures += 1;
  state.lastFailure = {
    at: state.lastUpdatedAt,
    failureClass,
    message: sanitizeMessage(rawMessage),
    retryable: isRetryableFailure(status, failureClass),
    ...(provider ? { provider } : {}),
    ...(attemptKind ? { attemptKind } : {}),
    ...(params.requestId ? { requestId: params.requestId } : {}),
    ...(typeof status === 'number' ? { status } : {}),
    ...(code ? { code } : {}),
    ...(typeof retryAfterMs === 'number' ? { retryAfterMs } : {}),
  };
}

export function recordPremiumRouteSafetyFilter(params: {
  mutated: boolean;
  blocked: boolean;
}): void {
  state.telemetryEvents += 1;
  state.lastUpdatedAt = nowIso();
  state.route.safetyFilter.runs += 1;
  if (params.mutated) state.route.safetyFilter.mutated += 1;
  if (params.blocked) state.route.safetyFilter.blocked += 1;
}

export function recordPremiumProviderAttempt(params: {
  provider: PremiumAiProviderName;
  attemptKind: PremiumProviderAttemptKind;
}): void {
  state.telemetryEvents += 1;
  state.lastUpdatedAt = nowIso();
  const providerState = state.providers[params.provider];
  providerState.attempts += 1;
  if (params.attemptKind === 'fallback') {
    providerState.fallbackAttempts += 1;
  } else {
    providerState.primaryAttempts += 1;
  }
}

export function recordPremiumProviderModelAttempt(params: {
  provider: PremiumAiProviderName;
  model: string;
}): void {
  const modelState = getOrCreateProviderModelState(params.provider, params.model);
  if (!modelState) return;

  state.telemetryEvents += 1;
  state.lastUpdatedAt = nowIso();
  modelState.attempts += 1;
}

export function recordPremiumProviderModelSuccess(params: {
  provider: PremiumAiProviderName;
  model: string;
}): void {
  const modelState = getOrCreateProviderModelState(params.provider, params.model);
  const normalizedModel = normalizeModelName(params.model);
  if (!modelState || !normalizedModel) return;

  state.telemetryEvents += 1;
  state.lastUpdatedAt = nowIso();
  modelState.successes += 1;
  modelState.lastUsedAt = state.lastUpdatedAt;
  state.providers[params.provider].lastModel = normalizedModel;
}

export function recordPremiumProviderModelFailure(params: {
  provider: PremiumAiProviderName;
  model: string;
}): void {
  const modelState = getOrCreateProviderModelState(params.provider, params.model);
  if (!modelState) return;

  state.telemetryEvents += 1;
  state.lastUpdatedAt = nowIso();
  modelState.failures += 1;
}

export function recordPremiumProviderSuccess(params: {
  provider: PremiumAiProviderName;
  attemptKind: PremiumProviderAttemptKind;
  latencyMs: number;
}): void {
  state.telemetryEvents += 1;
  state.lastUpdatedAt = nowIso();
  const providerState = state.providers[params.provider];
  providerState.successes += 1;
  recordProviderLatency(params.provider, params.latencyMs);
  if (params.attemptKind === 'fallback') {
    state.route.failovers.succeeded += 1;
  }
}

export function recordPremiumProviderFailure(params: {
  provider: PremiumAiProviderName;
  attemptKind: PremiumProviderAttemptKind;
  latencyMs: number;
  error: unknown;
  requestId?: string;
}): void {
  const failureClass = classifyPremiumDiagnosticsFailure(params.error);
  const status = normalizeStatus(params.error);
  const code = normalizeCode(params.error);
  const retryAfterMs = extractRetryAfterMs(params.error);
  const rawMessage = params.error instanceof Error ? params.error.message : 'Premium AI failed';

  state.telemetryEvents += 1;
  state.lastUpdatedAt = nowIso();
  const providerState = state.providers[params.provider];
  providerState.failures += 1;
  providerState.failureClassCounts[failureClass] += 1;
  recordProviderLatency(params.provider, params.latencyMs);

  if (code === 'deep_interpolator_non_additive_output') {
    providerState.qualityRejects.nonAdditive += 1;
  } else if (code === 'deep_interpolator_low_signal_output') {
    providerState.qualityRejects.lowSignal += 1;
  }

  if (params.attemptKind === 'fallback') {
    state.route.failovers.failed += 1;
  }

  state.lastFailure = {
    at: state.lastUpdatedAt,
    provider: params.provider,
    attemptKind: params.attemptKind,
    failureClass,
    message: sanitizeMessage(rawMessage),
    retryable: isRetryableFailure(status, failureClass),
    ...(params.requestId ? { requestId: params.requestId } : {}),
    ...(typeof status === 'number' ? { status } : {}),
    ...(code ? { code } : {}),
    ...(typeof retryAfterMs === 'number' ? { retryAfterMs } : {}),
  };
}

export function recordPremiumProviderFailover(params: {
  fromProvider: PremiumAiProviderName;
  toProvider: PremiumAiProviderName;
}): void {
  state.telemetryEvents += 1;
  state.lastUpdatedAt = nowIso();
  state.route.failovers.attempted += 1;
  state.providers[params.fromProvider].failoversFrom += 1;
  state.providers[params.toProvider].failoversTo += 1;
}

export function getPremiumDiagnostics(): Record<string, unknown> {
  const providerEntries = Object.entries(state.providers).map(([provider, providerState]) => {
    const totalOutcomes = providerState.successes + providerState.failures;
    const qualityRejectTotal = providerState.qualityRejects.nonAdditive + providerState.qualityRejects.lowSignal;

    return [
      provider,
      {
        attempts: providerState.attempts,
        primaryAttempts: providerState.primaryAttempts,
        fallbackAttempts: providerState.fallbackAttempts,
        successes: providerState.successes,
        failures: providerState.failures,
        successRate: safeRatio(providerState.successes, totalOutcomes),
        failureRate: safeRatio(providerState.failures, providerState.attempts),
        failoversFrom: providerState.failoversFrom,
        failoversTo: providerState.failoversTo,
        qualityRejects: {
          nonAdditive: providerState.qualityRejects.nonAdditive,
          lowSignal: providerState.qualityRejects.lowSignal,
          total: qualityRejectTotal,
          rejectionRate: safeRatio(qualityRejectTotal, providerState.attempts),
        },
        lastModel: providerState.lastModel,
        models: Object.fromEntries(
          Object.entries(providerState.models).map(([model, modelState]) => {
            const totalOutcomesForModel = modelState.successes + modelState.failures;
            return [
              model,
              {
                attempts: modelState.attempts,
                successes: modelState.successes,
                failures: modelState.failures,
                successRate: safeRatio(modelState.successes, totalOutcomesForModel),
                failureRate: safeRatio(modelState.failures, modelState.attempts),
                lastUsedAt: modelState.lastUsedAt,
              },
            ];
          }),
        ),
        failureClasses: {
          ...providerState.failureClassCounts,
        },
        latencyMs: {
          total: providerState.latencyMs.total,
          max: providerState.latencyMs.max,
          last: providerState.latencyMs.last,
          average: totalOutcomes > 0
            ? Number((providerState.latencyMs.total / totalOutcomes).toFixed(2))
            : 0,
        },
      },
    ];
  });

  const qualityRejects = Object.values(state.providers).reduce(
    (acc, providerState) => {
      acc.nonAdditive += providerState.qualityRejects.nonAdditive;
      acc.lowSignal += providerState.qualityRejects.lowSignal;
      return acc;
    },
    { nonAdditive: 0, lowSignal: 0 },
  );
  const qualityRejectTotal = qualityRejects.nonAdditive + qualityRejects.lowSignal;
  const safetyRuns = state.route.safetyFilter.runs;

  return {
    startedAt: state.startedAt,
    lastUpdatedAt: state.lastUpdatedAt,
    telemetryEvents: state.telemetryEvents,
    route: {
      invocations: state.route.invocations,
      successes: state.route.successes,
      failures: state.route.failures,
      successRate: safeRatio(state.route.successes, state.route.invocations),
      failureRate: safeRatio(state.route.failures, state.route.invocations),
      failovers: {
        ...state.route.failovers,
        successRate: safeRatio(state.route.failovers.succeeded, state.route.failovers.attempted),
      },
      safetyFilter: {
        ...state.route.safetyFilter,
        mutationRate: safeRatio(state.route.safetyFilter.mutated, safetyRuns),
        blockRate: safeRatio(state.route.safetyFilter.blocked, safetyRuns),
      },
      qualityRejects: {
        nonAdditive: qualityRejects.nonAdditive,
        lowSignal: qualityRejects.lowSignal,
        total: qualityRejectTotal,
        rejectionRate: safeRatio(qualityRejectTotal, state.route.invocations),
      },
    },
    providers: Object.fromEntries(providerEntries),
    ...(state.lastFailure ? { lastFailure: { ...state.lastFailure } } : {}),
  };
}

export function resetPremiumDiagnostics(): void {
  state = createInitialState();
}
