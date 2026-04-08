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
  };
};

export type WriterDiagnosticsAlert = {
  severity: 'high' | 'medium';
  message: string;
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

export const WRITER_DIAGNOSTICS_WATCH_INTERVAL_MS = 5_000;

export function formatRate(value: number): string {
  return `${(Math.max(0, Math.min(1, value)) * 100).toFixed(1)}%`;
}

export function formatLatency(value: number): string {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  return `${safeValue.toFixed(1)}ms`;
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
    alerts.push({ severity: 'high', message: 'Gemini is replacing many valid Qwen drafts. Base writer quality is likely drifting.' });
  } else if (enhancerCandidateReplacementRate >= WRITER_ALERT_THRESHOLDS.enhancerCandidateReplacementMedium) {
    alerts.push({ severity: 'medium', message: 'Gemini candidate takeover rate is elevated. Review base writer prompt quality.' });
  }

  if (enhancerRescueRate >= WRITER_ALERT_THRESHOLDS.enhancerRescueHigh) {
    alerts.push({ severity: 'high', message: 'Gemini is frequently rescuing Qwen failures. Investigate base writer reliability.' });
  } else if (enhancerRescueRate >= WRITER_ALERT_THRESHOLDS.enhancerRescueMedium) {
    alerts.push({ severity: 'medium', message: 'Gemini rescue rate is rising. Watch for Qwen instability or malformed responses.' });
  }

  if (enhancerFailureRate >= WRITER_ALERT_THRESHOLDS.enhancerFailureHigh) {
    alerts.push({ severity: 'high', message: 'Gemini reviewer failures are high. Audit API health, timeouts, and quota.' });
  } else if (enhancerFailureRate >= WRITER_ALERT_THRESHOLDS.enhancerFailureMedium) {
    alerts.push({ severity: 'medium', message: 'Gemini reviewer failures are elevated. Watch latency and upstream errors.' });
  }

  if (enhancerRejectedReplacements > 0) {
    alerts.push({ severity: 'medium', message: 'Some Gemini replacements were rejected by the canonical validator. Check for contract drift.' });
  }

  if (snapshot.enhancer.invocations > 0 && enhancerSkipRate >= 0.5) {
    alerts.push({ severity: 'medium', message: 'The Gemini reviewer is being skipped often. Verify local enablement and API-key configuration.' });
  }

  return alerts;
}
