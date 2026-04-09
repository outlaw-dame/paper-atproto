import type { InterpolatorMetricsSnapshot } from '../perf/interpolatorTelemetry';
import type { ConversationOsHealthHistoryEntry } from '../perf/conversationOsHealthHistory';
import type { WriterEnhancerProviderHistoryEntry } from '../perf/writerEnhancerProviderHistory';

export type WriterEnhancerProviderSnapshot = {
  reviews: number;
  failures: number;
  sourceCounts: {
    candidate: number;
    qwen_failure: number;
  };
  decisionCounts: {
    accept: number;
    replace: number;
    total: number;
  };
  appliedTakeovers: {
    candidate: number;
    rescue: number;
    total: number;
    takeoverRate: number;
    rescueRate: number;
  };
  failuresByClass: {
    timeout: number;
    rate_limited: number;
    provider_5xx: number;
    provider_4xx: number;
    invalid_json: number;
    invalid_decision: number;
    empty_response: number;
    unknown: number;
  };
  failureRate: number;
  latencyMs: {
    total: number;
    max: number;
    last: number;
    average: number;
  };
  lastModel?: string;
};

export type WriterDiagnosticsSnapshot = {
  startedAt: string;
  lastUpdatedAt: string;
  telemetryEvents: number;
  clientOutcomes: {
    model: number;
    fallback: number;
    total: number;
    modelToFallbackRatio: number | null;
    fallbackRate: number;
  };
  fallbackReasonDistribution: {
    'abstained-response-fallback': number;
    'root-only-response-fallback': number;
    'failure-fallback': number;
    totalFallbacks: number;
  };
  safetyFilter: {
    runs: number;
    mutated: number;
    blocked: number;
    mutationRate: number;
    blockRate: number;
  };
  enhancer: {
    invocations: number;
    reviews: number;
    reviewAttemptRate: number;
    skips: {
      disabled: number;
      unconfigured: number;
      unavailable: number;
      total: number;
      skipRate: number;
    };
    sourceCounts: {
      candidate: number;
      qwen_failure: number;
    };
    decisionCounts: {
      accept: number;
      replace: number;
      total: number;
    };
    appliedTakeovers: {
      candidate: number;
      rescue: number;
      total: number;
      candidateReplacementRate: number;
      rescueRate: number;
    };
    rejectedReplacements: {
      'invalid-response': number;
      'abstained-replacement': number;
      total: number;
    };
    failures: {
      total: number;
      failureRate: number;
      timeout: number;
      rate_limited: number;
      provider_5xx: number;
      provider_4xx: number;
      invalid_json: number;
      invalid_decision: number;
      empty_response: number;
      unknown: number;
    };
    issueDistribution: Record<string, number>;
    latencyMs: {
      total: number;
      max: number;
      last: number;
      average: number;
    };
    providers: Record<string, WriterEnhancerProviderSnapshot>;
    lastFailure?: {
      at: string;
      source: 'candidate' | 'qwen_failure';
      failureClass: 'timeout' | 'rate_limited' | 'provider_5xx' | 'provider_4xx' | 'invalid_json' | 'invalid_decision' | 'empty_response' | 'unknown';
      provider: string;
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
  };
};

export type WriterDiagnosticsAlert = {
  severity: 'high' | 'medium';
  message: string;
};

export type ConversationDeltaDiagnosticsSnapshot = InterpolatorMetricsSnapshot['delta'];
export type ConversationWatchDiagnosticsSnapshot = InterpolatorMetricsSnapshot['watch'];
export type ConversationHydrationDiagnosticsSnapshot = InterpolatorMetricsSnapshot['hydration'];

export type ConversationOsHealthSummary = {
  status: 'healthy' | 'watch' | 'degraded';
  headline: string;
  details: string[];
};

export type ConversationOsTrendSummary = {
  status: 'healthy' | 'watch' | 'degraded';
  headline: string;
  details: string[];
};

export type WriterProviderTrendSummary = {
  provider: 'gemini' | 'openai';
  status: 'healthy' | 'watch' | 'degraded';
  headline: string;
  details: string[];
};

const WRITER_ALERT_THRESHOLDS = {
  fallbackRateHigh: 0.45,
  fallbackRateMedium: 0.25,
  rootOnlyFallbackRateHigh: 0.30,
  rootOnlyFallbackRateMedium: 0.15,
  failureFallbackRateHigh: 0.15,
  mutationRateHigh: 0.35,
  mutationRateMedium: 0.20,
  blockRateHigh: 0.05,
  enhancerCandidateReplacementHigh: 0.35,
  enhancerCandidateReplacementMedium: 0.20,
  enhancerRescueHigh: 0.10,
  enhancerRescueMedium: 0.03,
  enhancerFailureHigh: 0.10,
  enhancerFailureMedium: 0.04,
} as const;

const DELTA_ALERT_THRESHOLDS = {
  minResolutionsForDrift: 8,
  lowStoredReuseRate: 0.35,
  highSelfHealRate: 0.12,
  mediumSelfHealRate: 0.05,
  highFallbackRate: 0.18,
  mediumFallbackRate: 0.08,
} as const;

const WATCH_ALERT_THRESHOLDS = {
  minConnectionAttempts: 2,
  minHydrationAttempts: 4,
  highReconnectRate: 0.4,
  mediumReconnectRate: 0.18,
  highDegradedRate: 0.25,
  mediumDegradedRate: 0.1,
  highPollShare: 0.55,
  mediumPollShare: 0.35,
  lowEventShare: 0.15,
} as const;

const HISTORY_ALERT_THRESHOLDS = {
  minSamples: 2,
  highWatchIssueRate: 0.35,
  mediumWatchIssueRate: 0.15,
  highSelfHealRate: 0.12,
  mediumSelfHealRate: 0.05,
  highFallbackModeShare: 0.45,
  mediumFallbackModeShare: 0.25,
  highMinimalModeShare: 0.15,
} as const;

const PROVIDER_HISTORY_THRESHOLDS = {
  minSamples: 2,
  highFailureRate: 0.18,
  mediumFailureRate: 0.08,
  highTakeoverRate: 0.45,
  mediumTakeoverRate: 0.25,
  highRescueRate: 0.12,
  mediumRescueRate: 0.05,
} as const;

export const WRITER_DIAGNOSTICS_WATCH_INTERVAL_MS = 5_000;

export function formatRate(value: number): string {
  return `${(Math.max(0, Math.min(1, value)) * 100).toFixed(1)}%`;
}

export function formatLatency(value: number): string {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  return `${safeValue.toFixed(1)}ms`;
}

export function formatRelativeAge(isoTimestamp: string | null | undefined, nowMs: number = Date.now()): string {
  if (typeof isoTimestamp !== 'string' || !isoTimestamp.trim()) return 'never';
  const parsed = Date.parse(isoTimestamp);
  if (!Number.isFinite(parsed)) return 'unknown';
  const ageMs = Math.max(0, nowMs - parsed);
  if (ageMs < 1_000) return 'just now';
  if (ageMs < 60_000) return `${Math.round(ageMs / 1_000)}s ago`;
  if (ageMs < 60 * 60_000) return `${Math.round(ageMs / 60_000)}m ago`;
  return `${Math.round(ageMs / (60 * 60_000))}h ago`;
}

export function humanizeIssueLabel(label: string): string {
  if (label === 'other') return 'other';
  if (label === 'uniqueLabels') return 'unique labels';
  return label.replace(/[-_]+/g, ' ');
}

export function topWriterEnhancerIssues(snapshot: WriterDiagnosticsSnapshot, limit = 4): Array<[string, number]> {
  return Object.entries(snapshot.enhancer.issueDistribution)
    .filter(([label]) => label !== 'uniqueLabels')
    .sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1];
      return left[0].localeCompare(right[0]);
    })
    .slice(0, limit);
}

export function deriveWriterDiagnosticsAlerts(snapshot: WriterDiagnosticsSnapshot): WriterDiagnosticsAlert[] {
  const alerts: WriterDiagnosticsAlert[] = [];
  const fallbackRate = snapshot.clientOutcomes.fallbackRate;
  const totalFallbacks = Math.max(1, snapshot.fallbackReasonDistribution.totalFallbacks);
  const rootOnlyRate = snapshot.fallbackReasonDistribution['root-only-response-fallback'] / totalFallbacks;
  const failureRate = snapshot.fallbackReasonDistribution['failure-fallback'] / totalFallbacks;
  const mutationRate = snapshot.safetyFilter.mutationRate;
  const blockRate = snapshot.safetyFilter.blockRate;
  const enhancerCandidateReplacementRate = snapshot.enhancer.appliedTakeovers.candidateReplacementRate;
  const enhancerRescueRate = snapshot.enhancer.appliedTakeovers.rescueRate;
  const enhancerFailureRate = snapshot.enhancer.failures.failureRate;
  const enhancerRejectedReplacements = snapshot.enhancer.rejectedReplacements.total;
  const enhancerSkipRate = snapshot.enhancer.skips.skipRate;

  if (fallbackRate >= WRITER_ALERT_THRESHOLDS.fallbackRateHigh) {
    alerts.push({ severity: 'high', message: 'High fallback rate detected. Model outputs are being replaced too often.' });
  } else if (fallbackRate >= WRITER_ALERT_THRESHOLDS.fallbackRateMedium) {
    alerts.push({ severity: 'medium', message: 'Fallback rate is elevated. Review prompt quality and reply grounding.' });
  }

  if (rootOnlyRate >= WRITER_ALERT_THRESHOLDS.rootOnlyFallbackRateHigh) {
    alerts.push({ severity: 'high', message: 'Root-only fallback is dominating fallback traffic. Replies may be under-utilized.' });
  } else if (rootOnlyRate >= WRITER_ALERT_THRESHOLDS.rootOnlyFallbackRateMedium) {
    alerts.push({ severity: 'medium', message: 'Root-only fallback is rising. Verify summary-reply grounding behavior.' });
  }

  if (failureRate >= WRITER_ALERT_THRESHOLDS.failureFallbackRateHigh) {
    alerts.push({ severity: 'high', message: 'Provider failure fallback is elevated. Investigate upstream reliability and latency.' });
  }

  if (mutationRate >= WRITER_ALERT_THRESHOLDS.mutationRateHigh) {
    alerts.push({ severity: 'high', message: 'Safety mutation rate is high. Writer outputs may be too close to safety boundaries.' });
  } else if (mutationRate >= WRITER_ALERT_THRESHOLDS.mutationRateMedium) {
    alerts.push({ severity: 'medium', message: 'Safety mutation rate is elevated. Monitor for readability degradation.' });
  }

  if (blockRate >= WRITER_ALERT_THRESHOLDS.blockRateHigh) {
    alerts.push({ severity: 'high', message: 'Safety block rate is high. Some outputs are being fully suppressed.' });
  }

  if (enhancerCandidateReplacementRate >= WRITER_ALERT_THRESHOLDS.enhancerCandidateReplacementHigh) {
    alerts.push({ severity: 'high', message: 'The remote reviewer is replacing many valid Qwen drafts. Base writer quality is likely drifting.' });
  } else if (enhancerCandidateReplacementRate >= WRITER_ALERT_THRESHOLDS.enhancerCandidateReplacementMedium) {
    alerts.push({ severity: 'medium', message: 'Remote reviewer takeover rate is elevated. Review base writer prompt quality.' });
  }

  if (enhancerRescueRate >= WRITER_ALERT_THRESHOLDS.enhancerRescueHigh) {
    alerts.push({ severity: 'high', message: 'The remote reviewer is frequently rescuing Qwen failures. Investigate base writer reliability.' });
  } else if (enhancerRescueRate >= WRITER_ALERT_THRESHOLDS.enhancerRescueMedium) {
    alerts.push({ severity: 'medium', message: 'Remote reviewer rescue rate is rising. Watch for Qwen instability or malformed responses.' });
  }

  if (enhancerFailureRate >= WRITER_ALERT_THRESHOLDS.enhancerFailureHigh) {
    alerts.push({ severity: 'high', message: 'Remote reviewer failures are high. Audit provider health, timeouts, and quota.' });
  } else if (enhancerFailureRate >= WRITER_ALERT_THRESHOLDS.enhancerFailureMedium) {
    alerts.push({ severity: 'medium', message: 'Remote reviewer failures are elevated. Watch latency and upstream errors.' });
  }

  if (enhancerRejectedReplacements > 0) {
    alerts.push({ severity: 'medium', message: 'Some remote reviewer replacements were rejected by the canonical validator. Check for contract drift.' });
  }

  if (snapshot.enhancer.invocations > 0 && enhancerSkipRate >= 0.5) {
    alerts.push({ severity: 'medium', message: 'The remote reviewer is being skipped often. Verify provider availability, enablement, and API configuration.' });
  }

  return alerts;
}

export function deriveConversationDeltaAlerts(
  snapshot: ConversationDeltaDiagnosticsSnapshot,
): WriterDiagnosticsAlert[] {
  const alerts: WriterDiagnosticsAlert[] = [];
  const fallbackRate = snapshot.resolutionCount > 0
    ? snapshot.summaryFallbackCount / snapshot.resolutionCount
    : 0;

  if (
    snapshot.resolutionCount >= DELTA_ALERT_THRESHOLDS.minResolutionsForDrift
    && snapshot.storedReuseRate < DELTA_ALERT_THRESHOLDS.lowStoredReuseRate
  ) {
    alerts.push({
      severity: 'medium',
      message: 'Delta decisions are rebuilding often instead of reusing stored state. Watch for cache drift or recompute churn.',
    });
  }

  if (snapshot.selfHealRate >= DELTA_ALERT_THRESHOLDS.highSelfHealRate) {
    alerts.push({
      severity: 'high',
      message: 'Stored delta decisions are self-healing frequently. Session state may be drifting stale before reconciliation.',
    });
  } else if (snapshot.selfHealRate >= DELTA_ALERT_THRESHOLDS.mediumSelfHealRate) {
    alerts.push({
      severity: 'medium',
      message: 'Delta self-heal rate is elevated. Watch for stale session snapshots or mode recompute mismatches.',
    });
  }

  if (fallbackRate >= DELTA_ALERT_THRESHOLDS.highFallbackRate) {
    alerts.push({
      severity: 'high',
      message: 'Interpolator surface summaries are falling back often. Users may be seeing weaker phrasing than the canonical state supports.',
    });
  } else if (fallbackRate >= DELTA_ALERT_THRESHOLDS.mediumFallbackRate) {
    alerts.push({
      severity: 'medium',
      message: 'Interpolator fallback summaries are rising. Check whether the authoritative summary is staying fresh enough to render directly.',
    });
  }

  return alerts;
}

export function deriveConversationWatchAlerts(params: {
  watch: ConversationWatchDiagnosticsSnapshot;
  hydration: ConversationHydrationDiagnosticsSnapshot;
}): WriterDiagnosticsAlert[] {
  const { watch, hydration } = params;
  const alerts: WriterDiagnosticsAlert[] = [];
  const reconnectRate = watch.connectionAttempts > 0
    ? watch.reconnectCount / watch.connectionAttempts
    : 0;
  const degradedRate = watch.connectionAttempts > 0
    ? watch.degradedCount / watch.connectionAttempts
    : 0;

  if (
    watch.connectionAttempts >= WATCH_ALERT_THRESHOLDS.minConnectionAttempts
    && watch.readyCount === 0
  ) {
    alerts.push({
      severity: 'high',
      message: 'The live thread watch has not reached a ready state. Conversation freshness is likely falling back to polling only.',
    });
  }

  if (reconnectRate >= WATCH_ALERT_THRESHOLDS.highReconnectRate) {
    alerts.push({
      severity: 'high',
      message: 'Watch reconnect churn is high. The live invalidation stream may be unstable.',
    });
  } else if (reconnectRate >= WATCH_ALERT_THRESHOLDS.mediumReconnectRate) {
    alerts.push({
      severity: 'medium',
      message: 'Watch reconnects are elevated. Monitor SSE stability and upstream retry behavior.',
    });
  }

  if (degradedRate >= WATCH_ALERT_THRESHOLDS.highDegradedRate) {
    alerts.push({
      severity: 'high',
      message: 'The watch stream is entering degraded mode often. Remote thread freshness may be inconsistent.',
    });
  } else if (degradedRate >= WATCH_ALERT_THRESHOLDS.mediumDegradedRate) {
    alerts.push({
      severity: 'medium',
      message: 'The watch stream is reporting degraded status more often than expected.',
    });
  }

  if (
    hydration.totalAttempts >= WATCH_ALERT_THRESHOLDS.minHydrationAttempts
    && hydration.eventShare <= WATCH_ALERT_THRESHOLDS.lowEventShare
    && hydration.pollShare >= WATCH_ALERT_THRESHOLDS.highPollShare
  ) {
    alerts.push({
      severity: 'high',
      message: 'Hydration is leaning heavily on polling instead of live invalidation. The Conversation OS still feels refresh-driven.',
    });
  } else if (
    hydration.totalAttempts >= WATCH_ALERT_THRESHOLDS.minHydrationAttempts
    && hydration.pollShare >= WATCH_ALERT_THRESHOLDS.mediumPollShare
  ) {
    alerts.push({
      severity: 'medium',
      message: 'Polling is still carrying a noticeable share of hydration work. Watch whether event-driven refreshes are landing reliably.',
    });
  }

  return alerts;
}

export function deriveConversationOsHealth(params: {
  writer?: WriterDiagnosticsSnapshot | null;
  metrics?: InterpolatorMetricsSnapshot | null;
}): ConversationOsHealthSummary {
  const writerAlerts = params.writer ? deriveWriterDiagnosticsAlerts(params.writer) : [];
  const deltaAlerts = params.metrics ? deriveConversationDeltaAlerts(params.metrics.delta) : [];
  const watchAlerts = params.metrics
    ? deriveConversationWatchAlerts({
        watch: params.metrics.watch,
        hydration: params.metrics.hydration,
      })
    : [];
  const alerts = [...writerAlerts, ...deltaAlerts, ...watchAlerts];
  const highAlerts = alerts.filter((alert) => alert.severity === 'high');
  const metrics = params.metrics;

  if (!metrics) {
    return {
      status: 'watch',
      headline: 'Conversation OS health is waiting for local telemetry.',
      details: ['Open a live thread in local development to populate watch, delta, and hydration health.'],
    };
  }

  const details = [
    `Watch state ${metrics.watch.currentState}; invalidations ${metrics.watch.invalidationCount}; last live change ${formatRelativeAge(metrics.watch.lastInvalidationAt)}.`,
    `Delta reuse ${formatRate(metrics.delta.storedReuseRate)}; self-heal ${formatRate(metrics.delta.selfHealRate)}; summary fallback ${metrics.delta.summaryFallbackCount}.`,
    `Hydration success ${formatRate(metrics.hydration.successRate)}; event share ${formatRate(metrics.hydration.eventShare)}; poll share ${formatRate(metrics.hydration.pollShare)}.`,
  ];

  if (highAlerts.length > 0) {
    return {
      status: 'degraded',
      headline: 'Conversation OS health is degraded. Live freshness or canonical thread state is drifting.',
      details: [...details, ...highAlerts.slice(0, 2).map((alert) => alert.message)],
    };
  }

  if (alerts.length > 0) {
    return {
      status: 'watch',
      headline: 'Conversation OS health is functional, but a few live-state signals need watching.',
      details: [...details, ...alerts.slice(0, 2).map((alert) => alert.message)],
    };
  }

  return {
    status: 'healthy',
    headline: 'Conversation OS health looks stable. Live invalidation and canonical delta state are aligned.',
    details,
  };
}

export function deriveConversationOsTrendSummary(
  history: ConversationOsHealthHistoryEntry[],
): ConversationOsTrendSummary {
  if (history.length < HISTORY_ALERT_THRESHOLDS.minSamples) {
    return {
      status: 'watch',
      headline: 'Longitudinal Conversation OS history is still warming up.',
      details: ['Keep the runtime panel open long enough to capture at least two bounded health samples.'],
    };
  }

  const first = history[0]!;
  const last = history.at(-1)!;
  const windowMinutes = Math.max(1, Math.round((Date.parse(last.recordedAt) - Date.parse(first.recordedAt)) / 60_000));
  const resolutionDelta = Math.max(0, last.delta.resolutionCount - first.delta.resolutionCount);
  const selfHealDelta = Math.max(0, last.delta.selfHealCount - first.delta.selfHealCount);
  const summaryFallbackDelta = Math.max(0, last.delta.summaryFallbackCount - first.delta.summaryFallbackCount);
  const connectionDelta = Math.max(0, last.watch.connectionAttempts - first.watch.connectionAttempts);
  const reconnectDelta = Math.max(0, last.watch.reconnectCount - first.watch.reconnectCount);
  const degradedDelta = Math.max(0, last.watch.degradedCount - first.watch.degradedCount);
  const invalidationDelta = Math.max(0, last.watch.invalidationCount - first.watch.invalidationCount);
  const modeDelta = {
    normal: Math.max(0, last.modes.normal - first.modes.normal),
    descriptive_fallback: Math.max(0, last.modes.descriptive_fallback - first.modes.descriptive_fallback),
    minimal_fallback: Math.max(0, last.modes.minimal_fallback - first.modes.minimal_fallback),
  };
  const modeTotal = modeDelta.normal + modeDelta.descriptive_fallback + modeDelta.minimal_fallback;
  const watchIssueRate = connectionDelta > 0
    ? (reconnectDelta + degradedDelta) / connectionDelta
    : 0;
  const selfHealRate = resolutionDelta > 0
    ? selfHealDelta / resolutionDelta
    : 0;
  const fallbackModeShare = modeTotal > 0
    ? (modeDelta.descriptive_fallback + modeDelta.minimal_fallback) / modeTotal
    : 0;
  const minimalModeShare = modeTotal > 0
    ? modeDelta.minimal_fallback / modeTotal
    : 0;

  const details = [
    `Window ${windowMinutes}m • delta decisions ${resolutionDelta} • self-heal ${formatRate(selfHealRate)} • summary fallback +${summaryFallbackDelta}.`,
    `Watch connects ${connectionDelta} • reconnect/degraded ${(reconnectDelta + degradedDelta)} • invalidations +${invalidationDelta} • issue rate ${formatRate(watchIssueRate)}.`,
    `Mode drift: normal ${modeDelta.normal} • descriptive ${modeDelta.descriptive_fallback} • minimal ${modeDelta.minimal_fallback}.`,
  ];

  if (
    watchIssueRate >= HISTORY_ALERT_THRESHOLDS.highWatchIssueRate
    || selfHealRate >= HISTORY_ALERT_THRESHOLDS.highSelfHealRate
    || fallbackModeShare >= HISTORY_ALERT_THRESHOLDS.highFallbackModeShare
    || minimalModeShare >= HISTORY_ALERT_THRESHOLDS.highMinimalModeShare
  ) {
    return {
      status: 'degraded',
      headline: 'Recent Conversation OS trends show churn or fallback drift.',
      details,
    };
  }

  if (
    watchIssueRate >= HISTORY_ALERT_THRESHOLDS.mediumWatchIssueRate
    || selfHealRate >= HISTORY_ALERT_THRESHOLDS.mediumSelfHealRate
    || fallbackModeShare >= HISTORY_ALERT_THRESHOLDS.mediumFallbackModeShare
  ) {
    return {
      status: 'watch',
      headline: 'Recent Conversation OS trends are usable, but drift is worth watching.',
      details,
    };
  }

  return {
    status: 'healthy',
    headline: 'Recent Conversation OS trends look steady.',
    details,
  };
}

export function deriveWriterProviderTrendSummaries(
  history: WriterEnhancerProviderHistoryEntry[],
): WriterProviderTrendSummary[] {
  return (['gemini', 'openai'] as const).map((provider) => {
    if (history.length < PROVIDER_HISTORY_THRESHOLDS.minSamples) {
      return {
        provider,
        status: 'watch',
        headline: `${provider} reviewer trend is still warming up.`,
        details: ['Keep the runtime panel open long enough to capture at least two provider history samples.'],
      };
    }

    const first = history[0]!;
    const last = history.at(-1)!;
    const windowMinutes = Math.max(1, Math.round((Date.parse(last.recordedAt) - Date.parse(first.recordedAt)) / 60_000));
    const firstProvider = first.providers[provider];
    const lastProvider = last.providers[provider];
    const reviewDelta = Math.max(0, lastProvider.reviews - firstProvider.reviews);
    const failureDelta = Math.max(0, lastProvider.failures - firstProvider.failures);
    const candidateTakeoverDelta = Math.max(0, lastProvider.candidateTakeovers - firstProvider.candidateTakeovers);
    const rescueTakeoverDelta = Math.max(0, lastProvider.rescueTakeovers - firstProvider.rescueTakeovers);
    const attemptDelta = reviewDelta + failureDelta;
    const takeoverDelta = candidateTakeoverDelta + rescueTakeoverDelta;
    const latencyTotalDelta = Math.max(0, lastProvider.latencyTotalMs - firstProvider.latencyTotalMs);
    const failureRate = attemptDelta > 0 ? failureDelta / attemptDelta : 0;
    const takeoverRate = reviewDelta > 0 ? takeoverDelta / reviewDelta : 0;
    const rescueRate = reviewDelta > 0 ? rescueTakeoverDelta / reviewDelta : 0;
    const averageLatency = attemptDelta > 0 ? latencyTotalDelta / attemptDelta : 0;

    const details = [
      `Window ${windowMinutes}m • reviews +${reviewDelta} • failures +${failureDelta} • failure rate ${formatRate(failureRate)}.`,
      `Takeovers +${takeoverDelta} • candidate +${candidateTakeoverDelta} • rescue +${rescueTakeoverDelta} • takeover rate ${formatRate(takeoverRate)}.`,
      `Average latency ${formatLatency(averageLatency)} across new provider attempts.`,
    ];

    if (
      failureRate >= PROVIDER_HISTORY_THRESHOLDS.highFailureRate
      || takeoverRate >= PROVIDER_HISTORY_THRESHOLDS.highTakeoverRate
      || rescueRate >= PROVIDER_HISTORY_THRESHOLDS.highRescueRate
    ) {
      return {
        provider,
        status: 'degraded',
        headline: `${provider} reviewer drift is degraded.`,
        details,
      };
    }

    if (
      failureRate >= PROVIDER_HISTORY_THRESHOLDS.mediumFailureRate
      || takeoverRate >= PROVIDER_HISTORY_THRESHOLDS.mediumTakeoverRate
      || rescueRate >= PROVIDER_HISTORY_THRESHOLDS.mediumRescueRate
    ) {
      return {
        provider,
        status: 'watch',
        headline: `${provider} reviewer trend is usable, but drift is rising.`,
        details,
      };
    }

    return {
      provider,
      status: 'healthy',
      headline: `${provider} reviewer trend looks steady.`,
      details,
    };
  });
}
