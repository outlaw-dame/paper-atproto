type WriterClientOutcome = 'model' | 'fallback';
type WriterEnhancerSource = 'candidate' | 'qwen_failure';
type WriterEnhancerDecision = 'accept' | 'replace';
type WriterEnhancerSkipReason = 'disabled' | 'unconfigured' | 'unavailable';
type WriterEnhancerRejectedReason = 'invalid-response' | 'abstained-replacement';
type WriterEnhancerProvider = 'gemini' | 'openai' | 'unknown';

export type WriterEnhancerFailureClass =
  | 'timeout'
  | 'rate_limited'
  | 'provider_5xx'
  | 'provider_4xx'
  | 'invalid_json'
  | 'invalid_decision'
  | 'empty_response'
  | 'unknown';

type WriterEnhancerFailureDetail = {
  at: string;
  source: WriterEnhancerSource;
  failureClass: WriterEnhancerFailureClass;
  provider: WriterEnhancerProvider;
  model: string;
  message: string;
  retryable: boolean;
  requestId?: string;
  status?: number;
  code?: string;
  retryAfterMs?: number;
  preview?: string;
  responseChars?: number;
};

type WriterEnhancerProviderState = {
  reviews: number;
  failures: number;
  sourceCounts: Record<WriterEnhancerSource, number>;
  decisionCounts: Record<WriterEnhancerDecision, number>;
  appliedTakeovers: {
    candidate: number;
    rescue: number;
  };
  failureClassCounts: Record<WriterEnhancerFailureClass, number>;
  latencyMs: {
    total: number;
    max: number;
    last: number;
  };
  lastModel: string | null;
};

export type WriterClientReason =
  | 'success'
  | 'abstained-response-fallback'
  | 'root-only-response-fallback'
  | 'failure-fallback';

type WriterDiagnosticsState = {
  startedAt: string;
  lastUpdatedAt: string;
  telemetryEvents: number;
  clientOutcomeCounts: Record<WriterClientOutcome, number>;
  fallbackReasonCounts: Record<Exclude<WriterClientReason, 'success'>, number>;
  safetyFilter: {
    runs: number;
    mutated: number;
    blocked: number;
  };
  enhancer: {
    invocations: number;
    reviews: number;
    skips: Record<WriterEnhancerSkipReason, number>;
    sourceCounts: Record<WriterEnhancerSource, number>;
    decisionCounts: Record<WriterEnhancerDecision, number>;
    appliedTakeovers: {
      candidate: number;
      rescue: number;
    };
    rejectedReplacements: Record<WriterEnhancerRejectedReason, number>;
    failures: number;
    failureClassCounts: Record<WriterEnhancerFailureClass, number>;
    lastFailure: WriterEnhancerFailureDetail | null;
    issueCounts: Record<string, number>;
    latencyMs: {
      total: number;
      max: number;
      last: number;
    };
    providers: Record<WriterEnhancerProvider, WriterEnhancerProviderState>;
  };
};

const MAX_ENHANCER_ISSUE_LABELS = 32;
const FALLBACK_ENHANCER_ISSUE_LABEL = 'other';
const ENHANCER_ISSUE_LABEL_ALIASES: Record<string, string> = {
  basewriterfailed: 'base-writer-failed',
  contributorblurbsmissing: 'contributor-blurbs-missing',
  genericreplypattern: 'generic-reply-pattern',
  modeconstraintviolation: 'mode-constraint-violation',
  roottextleaked: 'root-text-leaked',
};

function nowIso(): string {
  return new Date().toISOString();
}

function createInitialProviderState(): WriterEnhancerProviderState {
  return {
    reviews: 0,
    failures: 0,
    sourceCounts: {
      candidate: 0,
      qwen_failure: 0,
    },
    decisionCounts: {
      accept: 0,
      replace: 0,
    },
    appliedTakeovers: {
      candidate: 0,
      rescue: 0,
    },
    failureClassCounts: {
      timeout: 0,
      rate_limited: 0,
      provider_5xx: 0,
      provider_4xx: 0,
      invalid_json: 0,
      invalid_decision: 0,
      empty_response: 0,
      unknown: 0,
    },
    latencyMs: {
      total: 0,
      max: 0,
      last: 0,
    },
    lastModel: null,
  };
}

function createInitialState(): WriterDiagnosticsState {
  const timestamp = nowIso();
  return {
    startedAt: timestamp,
    lastUpdatedAt: timestamp,
    telemetryEvents: 0,
    clientOutcomeCounts: {
      model: 0,
      fallback: 0,
    },
    fallbackReasonCounts: {
      'abstained-response-fallback': 0,
      'root-only-response-fallback': 0,
      'failure-fallback': 0,
    },
    safetyFilter: {
      runs: 0,
      mutated: 0,
      blocked: 0,
    },
    enhancer: {
      invocations: 0,
      reviews: 0,
      skips: {
        disabled: 0,
        unconfigured: 0,
        unavailable: 0,
      },
      sourceCounts: {
        candidate: 0,
        qwen_failure: 0,
      },
      decisionCounts: {
        accept: 0,
        replace: 0,
      },
      appliedTakeovers: {
        candidate: 0,
        rescue: 0,
      },
      rejectedReplacements: {
        'invalid-response': 0,
        'abstained-replacement': 0,
      },
      failures: 0,
      failureClassCounts: {
        timeout: 0,
        rate_limited: 0,
        provider_5xx: 0,
        provider_4xx: 0,
        invalid_json: 0,
        invalid_decision: 0,
        empty_response: 0,
        unknown: 0,
      },
      lastFailure: null,
      issueCounts: {},
      latencyMs: {
        total: 0,
        max: 0,
        last: 0,
      },
      providers: {
        gemini: createInitialProviderState(),
        openai: createInitialProviderState(),
        unknown: createInitialProviderState(),
      },
    },
  };
}

let state: WriterDiagnosticsState = createInitialState();

function safeRatio(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return Number((numerator / denominator).toFixed(4));
}

function normalizeEnhancerIssueLabel(value: string): string {
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  if (!normalized) return 'unknown';

  const collapsed = normalized.replace(/-/g, '');
  return ENHANCER_ISSUE_LABEL_ALIASES[collapsed] ?? normalized;
}

function recordEnhancerLatency(latencyMs: number): void {
  const safeLatency = Number.isFinite(latencyMs)
    ? Math.max(0, Math.floor(latencyMs))
    : 0;
  state.enhancer.latencyMs.total += safeLatency;
  state.enhancer.latencyMs.last = safeLatency;
  state.enhancer.latencyMs.max = Math.max(state.enhancer.latencyMs.max, safeLatency);
}

function resolveEnhancerProvider(provider: string | undefined): WriterEnhancerProvider {
  if (provider === 'gemini' || provider === 'openai') return provider;
  return 'unknown';
}

function recordProviderEnhancerLatency(provider: WriterEnhancerProvider, latencyMs: number): void {
  const providerState = state.enhancer.providers[provider];
  const safeLatency = Number.isFinite(latencyMs)
    ? Math.max(0, Math.floor(latencyMs))
    : 0;
  providerState.latencyMs.total += safeLatency;
  providerState.latencyMs.last = safeLatency;
  providerState.latencyMs.max = Math.max(providerState.latencyMs.max, safeLatency);
}

function recordEnhancerIssues(issues: string[]): void {
  for (const issue of issues) {
    const normalized = normalizeEnhancerIssueLabel(issue);
    const currentKeys = Object.keys(state.enhancer.issueCounts);
    if (normalized in state.enhancer.issueCounts || currentKeys.length < MAX_ENHANCER_ISSUE_LABELS) {
      state.enhancer.issueCounts[normalized] = (state.enhancer.issueCounts[normalized] ?? 0) + 1;
      continue;
    }
    state.enhancer.issueCounts[FALLBACK_ENHANCER_ISSUE_LABEL] = (state.enhancer.issueCounts[FALLBACK_ENHANCER_ISSUE_LABEL] ?? 0) + 1;
  }
}

export function recordWriterClientOutcome(params: {
  outcome: WriterClientOutcome;
  reason: WriterClientReason;
}): void {
  state.telemetryEvents += 1;
  state.lastUpdatedAt = nowIso();
  state.clientOutcomeCounts[params.outcome] += 1;

  if (params.reason !== 'success') {
    state.fallbackReasonCounts[params.reason] += 1;
  }
}

export function recordWriterEnhancerInvocation(): void {
  state.telemetryEvents += 1;
  state.lastUpdatedAt = nowIso();
  state.enhancer.invocations += 1;
}

export function recordWriterEnhancerSkip(reason: WriterEnhancerSkipReason): void {
  state.telemetryEvents += 1;
  state.lastUpdatedAt = nowIso();
  state.enhancer.skips[reason] += 1;
}

export function recordWriterEnhancerReview(params: {
  source: WriterEnhancerSource;
  decision: WriterEnhancerDecision;
  latencyMs: number;
  provider?: string;
  model: string;
  issues?: string[];
}): void {
  state.telemetryEvents += 1;
  state.lastUpdatedAt = nowIso();
  state.enhancer.reviews += 1;
  state.enhancer.sourceCounts[params.source] += 1;
  state.enhancer.decisionCounts[params.decision] += 1;
  recordEnhancerLatency(params.latencyMs);
  const provider = resolveEnhancerProvider(params.provider);
  const providerState = state.enhancer.providers[provider];
  providerState.reviews += 1;
  providerState.sourceCounts[params.source] += 1;
  providerState.decisionCounts[params.decision] += 1;
  providerState.lastModel = params.model;
  recordProviderEnhancerLatency(provider, params.latencyMs);
  if (params.issues?.length) {
    recordEnhancerIssues(params.issues);
  }
}

export function recordWriterEnhancerTakeoverApplied(
  source: WriterEnhancerSource,
  provider?: string,
): void {
  state.telemetryEvents += 1;
  state.lastUpdatedAt = nowIso();
  const providerState = state.enhancer.providers[resolveEnhancerProvider(provider)];
  if (source === 'candidate') {
    state.enhancer.appliedTakeovers.candidate += 1;
    providerState.appliedTakeovers.candidate += 1;
    return;
  }
  state.enhancer.appliedTakeovers.rescue += 1;
  providerState.appliedTakeovers.rescue += 1;
}

export function recordWriterEnhancerRejectedReplacement(
  reason: WriterEnhancerRejectedReason,
): void {
  state.telemetryEvents += 1;
  state.lastUpdatedAt = nowIso();
  state.enhancer.rejectedReplacements[reason] += 1;
}

export function recordWriterEnhancerFailure(params: {
  failureClass: WriterEnhancerFailureClass;
  latencyMs: number;
  source: WriterEnhancerSource;
  provider?: string;
  model: string;
  message: string;
  retryable: boolean;
  requestId?: string;
  status?: number;
  code?: string;
  retryAfterMs?: number;
  preview?: string;
  responseChars?: number;
}): void {
  state.telemetryEvents += 1;
  state.lastUpdatedAt = nowIso();
  state.enhancer.failures += 1;
  state.enhancer.failureClassCounts[params.failureClass] += 1;
  const provider = resolveEnhancerProvider(params.provider);
  const providerState = state.enhancer.providers[provider];
  providerState.failures += 1;
  providerState.failureClassCounts[params.failureClass] += 1;
  providerState.lastModel = params.model;
  state.enhancer.lastFailure = {
    at: state.lastUpdatedAt,
    source: params.source,
    failureClass: params.failureClass,
    provider,
    model: params.model,
    message: params.message,
    retryable: params.retryable,
    ...(params.requestId ? { requestId: params.requestId } : {}),
    ...(typeof params.status === 'number' ? { status: params.status } : {}),
    ...(params.code ? { code: params.code } : {}),
    ...(typeof params.retryAfterMs === 'number' ? { retryAfterMs: params.retryAfterMs } : {}),
    ...(params.preview ? { preview: params.preview } : {}),
    ...(typeof params.responseChars === 'number' ? { responseChars: params.responseChars } : {}),
  };
  recordEnhancerLatency(params.latencyMs);
  recordProviderEnhancerLatency(provider, params.latencyMs);
}

export function recordWriterSafetyFilterRun(params: {
  mutated: boolean;
  blocked: boolean;
}): void {
  state.lastUpdatedAt = nowIso();
  state.safetyFilter.runs += 1;
  if (params.mutated) state.safetyFilter.mutated += 1;
  if (params.blocked) state.safetyFilter.blocked += 1;
}

export function getWriterDiagnostics(): Record<string, unknown> {
  const modelCount = state.clientOutcomeCounts.model;
  const fallbackCount = state.clientOutcomeCounts.fallback;
  const totalOutcomeCount = modelCount + fallbackCount;
  const safetyRuns = state.safetyFilter.runs;
  const enhancerReviews = state.enhancer.reviews;
  const enhancerInvocations = state.enhancer.invocations;
  const enhancerCandidateReviews = state.enhancer.sourceCounts.candidate;
  const enhancerFailureReviews = state.enhancer.sourceCounts.qwen_failure;
  const appliedTakeoversTotal = state.enhancer.appliedTakeovers.candidate + state.enhancer.appliedTakeovers.rescue;
  const rejectedReplacementsTotal = Object.values(state.enhancer.rejectedReplacements).reduce((sum, value) => sum + value, 0);
  const enhancerSkipsTotal = state.enhancer.skips.disabled + state.enhancer.skips.unconfigured + state.enhancer.skips.unavailable;
  const providerEntries = Object.entries(state.enhancer.providers).map(([provider, providerState]) => {
    const providerAttempts = providerState.reviews + providerState.failures;
    const providerTakeovers = providerState.appliedTakeovers.candidate + providerState.appliedTakeovers.rescue;

    return [
      provider,
      {
        reviews: providerState.reviews,
        failures: providerState.failures,
        sourceCounts: {
          ...providerState.sourceCounts,
        },
        decisionCounts: {
          ...providerState.decisionCounts,
          total: providerState.decisionCounts.accept + providerState.decisionCounts.replace,
        },
        appliedTakeovers: {
          candidate: providerState.appliedTakeovers.candidate,
          rescue: providerState.appliedTakeovers.rescue,
          total: providerTakeovers,
          takeoverRate: safeRatio(providerTakeovers, providerState.reviews),
          rescueRate: safeRatio(providerState.appliedTakeovers.rescue, providerState.sourceCounts.qwen_failure),
        },
        failuresByClass: {
          ...providerState.failureClassCounts,
        },
        failureRate: safeRatio(providerState.failures, providerAttempts),
        latencyMs: {
          total: providerState.latencyMs.total,
          max: providerState.latencyMs.max,
          last: providerState.latencyMs.last,
          average: providerAttempts > 0
            ? Number((providerState.latencyMs.total / providerAttempts).toFixed(2))
            : 0,
        },
        ...(providerState.lastModel ? { lastModel: providerState.lastModel } : {}),
      },
    ];
  });

  return {
    startedAt: state.startedAt,
    lastUpdatedAt: state.lastUpdatedAt,
    telemetryEvents: state.telemetryEvents,
    clientOutcomes: {
      model: modelCount,
      fallback: fallbackCount,
      total: totalOutcomeCount,
      modelToFallbackRatio: fallbackCount > 0
        ? Number((modelCount / fallbackCount).toFixed(4))
        : modelCount > 0 ? Number.POSITIVE_INFINITY : 0,
      fallbackRate: safeRatio(fallbackCount, totalOutcomeCount),
    },
    fallbackReasonDistribution: {
      ...state.fallbackReasonCounts,
      totalFallbacks: fallbackCount,
    },
    safetyFilter: {
      ...state.safetyFilter,
      mutationRate: safeRatio(state.safetyFilter.mutated, safetyRuns),
      blockRate: safeRatio(state.safetyFilter.blocked, safetyRuns),
    },
    enhancer: {
      invocations: enhancerInvocations,
      reviews: enhancerReviews,
      reviewAttemptRate: safeRatio(enhancerReviews, enhancerInvocations),
      skips: {
        ...state.enhancer.skips,
        total: enhancerSkipsTotal,
        skipRate: safeRatio(enhancerSkipsTotal, enhancerInvocations),
      },
      sourceCounts: {
        ...state.enhancer.sourceCounts,
      },
      decisionCounts: {
        ...state.enhancer.decisionCounts,
        total: state.enhancer.decisionCounts.accept + state.enhancer.decisionCounts.replace,
      },
      appliedTakeovers: {
        candidate: state.enhancer.appliedTakeovers.candidate,
        rescue: state.enhancer.appliedTakeovers.rescue,
        total: appliedTakeoversTotal,
        candidateReplacementRate: safeRatio(state.enhancer.appliedTakeovers.candidate, enhancerCandidateReviews),
        rescueRate: safeRatio(state.enhancer.appliedTakeovers.rescue, enhancerFailureReviews),
      },
      rejectedReplacements: {
        ...state.enhancer.rejectedReplacements,
        total: rejectedReplacementsTotal,
      },
      failures: {
        total: state.enhancer.failures,
        failureRate: safeRatio(state.enhancer.failures, enhancerInvocations),
        ...state.enhancer.failureClassCounts,
      },
      ...(state.enhancer.lastFailure
        ? {
            lastFailure: {
              ...state.enhancer.lastFailure,
            },
          }
        : {}),
      issueDistribution: {
        ...state.enhancer.issueCounts,
        uniqueLabels: Object.keys(state.enhancer.issueCounts).length,
      },
      latencyMs: {
        total: state.enhancer.latencyMs.total,
        max: state.enhancer.latencyMs.max,
        last: state.enhancer.latencyMs.last,
        average: enhancerReviews + state.enhancer.failures > 0
          ? Number((state.enhancer.latencyMs.total / (enhancerReviews + state.enhancer.failures)).toFixed(2))
          : 0,
      },
      providers: Object.fromEntries(providerEntries),
    },
  };
}

export function resetWriterDiagnostics(): void {
  state = createInitialState();
}
