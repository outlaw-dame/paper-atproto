import { describe, expect, it } from 'vitest';

import {
  deriveConversationOsHealth,
  deriveConversationSupervisorSummary,
  deriveConversationOsTrendSummary,
  deriveConversationDeltaAlerts,
  derivePremiumDiagnosticsAlerts,
  derivePremiumProviderAvailabilityAlerts,
  deriveConversationWatchAlerts,
  deriveWriterProviderTrendSummaries,
  formatRelativeAge,
  deriveWriterDiagnosticsAlerts,
  humanizeIssueLabel,
  type PremiumDiagnosticsSnapshot,
  type PremiumProviderAvailabilitySnapshot,
  topWriterEnhancerIssues,
  type WriterDiagnosticsSnapshot,
} from './localAiRuntimeDiagnostics';

function createSnapshot(): WriterDiagnosticsSnapshot {
  return {
    startedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    telemetryEvents: 12,
    clientOutcomes: {
      model: 10,
      fallback: 4,
      total: 14,
      modelToFallbackRatio: 2.5,
      fallbackRate: 4 / 14,
    },
    fallbackReasonDistribution: {
      'abstained-response-fallback': 1,
      'root-only-response-fallback': 2,
      'failure-fallback': 1,
      totalFallbacks: 4,
    },
    safetyFilter: {
      runs: 14,
      mutated: 4,
      blocked: 0,
      mutationRate: 4 / 14,
      blockRate: 0,
    },
    enhancer: {
      invocations: 10,
      reviews: 8,
      reviewAttemptRate: 0.8,
      skips: {
        disabled: 2,
        unconfigured: 0,
        unavailable: 0,
        total: 2,
        skipRate: 0.2,
      },
      sourceCounts: {
        candidate: 6,
        qwen_failure: 2,
      },
      decisionCounts: {
        accept: 3,
        replace: 5,
        total: 8,
      },
      appliedTakeovers: {
        candidate: 3,
        rescue: 1,
        total: 4,
        candidateReplacementRate: 0.5,
        rescueRate: 0.5,
      },
      rejectedReplacements: {
        'invalid-response': 1,
        'abstained-replacement': 0,
        total: 1,
      },
      failures: {
        total: 2,
        failureRate: 0.2,
        timeout: 1,
        rate_limited: 0,
        provider_5xx: 1,
        provider_4xx: 0,
        invalid_json: 0,
        invalid_decision: 0,
        empty_response: 0,
        unknown: 0,
      },
      issueDistribution: {
        'generic-reply-pattern': 4,
        'base-writer-failed': 2,
        'invalid-response-shape': 1,
        uniqueLabels: 3,
      },
      latencyMs: {
        total: 1200,
        max: 350,
        last: 120,
        average: 120,
      },
      providers: {
        gemini: {
          reviews: 4,
          failures: 1,
          sourceCounts: {
            candidate: 3,
            qwen_failure: 1,
          },
          decisionCounts: {
            accept: 1,
            replace: 3,
            total: 4,
          },
          appliedTakeovers: {
            candidate: 2,
            rescue: 1,
            total: 3,
            takeoverRate: 0.75,
            rescueRate: 1,
          },
          failuresByClass: {
            timeout: 1,
            rate_limited: 0,
            provider_5xx: 0,
            provider_4xx: 0,
            invalid_json: 0,
            invalid_decision: 0,
            empty_response: 0,
            unknown: 0,
          },
          failureRate: 0.2,
          latencyMs: {
            total: 700,
            max: 350,
            last: 120,
            average: 140,
          },
          lastModel: 'gemini-3-flash-preview',
        },
        openai: {
          reviews: 4,
          failures: 1,
          sourceCounts: {
            candidate: 3,
            qwen_failure: 1,
          },
          decisionCounts: {
            accept: 2,
            replace: 2,
            total: 4,
          },
          appliedTakeovers: {
            candidate: 1,
            rescue: 0,
            total: 1,
            takeoverRate: 0.25,
            rescueRate: 0,
          },
          failuresByClass: {
            timeout: 0,
            rate_limited: 0,
            provider_5xx: 1,
            provider_4xx: 0,
            invalid_json: 0,
            invalid_decision: 0,
            empty_response: 0,
            unknown: 0,
          },
          failureRate: 0.2,
          latencyMs: {
            total: 500,
            max: 240,
            last: 90,
            average: 100,
          },
          lastModel: 'gpt-5.4',
        },
      },
    },
  };
}

function createPremiumSnapshot(): PremiumDiagnosticsSnapshot {
  return {
    startedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    telemetryEvents: 9,
    route: {
      invocations: 10,
      successes: 7,
      failures: 3,
      successRate: 0.7,
      failureRate: 0.3,
      failovers: {
        attempted: 3,
        succeeded: 2,
        failed: 1,
        successRate: 2 / 3,
      },
      safetyFilter: {
        runs: 7,
        mutated: 2,
        blocked: 1,
        mutationRate: 2 / 7,
        blockRate: 1 / 7,
      },
      qualityRejects: {
        nonAdditive: 1,
        lowSignal: 1,
        total: 2,
        rejectionRate: 0.2,
      },
    },
    providers: {
      gemini: {
        attempts: 5,
        primaryAttempts: 4,
        fallbackAttempts: 1,
        successes: 3,
        failures: 2,
        successRate: 0.6,
        failureRate: 0.4,
        failoversFrom: 1,
        failoversTo: 1,
        qualityRejects: {
          nonAdditive: 1,
          lowSignal: 0,
          total: 1,
          rejectionRate: 0.2,
        },
        failureClasses: {
          insufficient_quota: 0,
          auth_unavailable: 0,
          rate_limited: 1,
          timeout: 0,
          model_unavailable: 0,
          quality_unavailable: 1,
          provider_unavailable: 0,
          invalid_output: 0,
          bad_request: 0,
          safety_blocked: 0,
          unknown: 0,
        },
        latencyMs: {
          total: 1500,
          max: 420,
          last: 210,
          average: 300,
        },
      },
      openai: {
        attempts: 5,
        primaryAttempts: 4,
        fallbackAttempts: 1,
        successes: 4,
        failures: 1,
        successRate: 0.8,
        failureRate: 0.2,
        failoversFrom: 2,
        failoversTo: 0,
        qualityRejects: {
          nonAdditive: 0,
          lowSignal: 1,
          total: 1,
          rejectionRate: 0.2,
        },
        failureClasses: {
          insufficient_quota: 0,
          auth_unavailable: 0,
          rate_limited: 0,
          timeout: 1,
          model_unavailable: 0,
          quality_unavailable: 0,
          provider_unavailable: 0,
          invalid_output: 0,
          bad_request: 0,
          safety_blocked: 0,
          unknown: 0,
        },
        latencyMs: {
          total: 1200,
          max: 380,
          last: 140,
          average: 240,
        },
      },
    },
    lastFailure: {
      at: new Date().toISOString(),
      provider: 'gemini',
      attemptKind: 'primary',
      failureClass: 'quality_unavailable',
      message: 'Deep interpolator returned a non-additive summary',
      retryable: false,
      code: 'deep_interpolator_non_additive_output',
      status: 502,
    },
  };
}

function createPremiumProviderAvailabilitySnapshot(): PremiumProviderAvailabilitySnapshot {
  return {
    health: {
      gemini: {
        operational: false,
        reason: 'auth_unavailable',
        unavailableUntil: new Date(Date.now() + 5 * 60_000).toISOString(),
      },
      openai: {
        operational: true,
        reason: null,
        unavailableUntil: null,
      },
    },
    readiness: {
      gemini: {
        checkedAt: new Date().toISOString(),
        inFlight: false,
        lastOutcome: 'persistent_failure',
        lastFailureReason: 'auth_unavailable',
        lastFailureStatus: 403,
        lastFailureCode: null,
        lastFailureMessage: 'permission denied',
      },
      openai: {
        checkedAt: new Date().toISOString(),
        inFlight: false,
        lastOutcome: 'success',
        lastFailureReason: null,
        lastFailureStatus: null,
        lastFailureCode: null,
        lastFailureMessage: null,
      },
    },
  };
}

describe('localAiRuntimeDiagnostics', () => {
  it('derives high-signal alerts for writer and enhancer health', () => {
    const alerts = deriveWriterDiagnosticsAlerts(createSnapshot());

    expect(alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'medium',
        message: 'Fallback rate is elevated. Review prompt quality and reply grounding.',
      }),
      expect.objectContaining({
        severity: 'high',
        message: 'The remote reviewer is replacing many valid Qwen drafts. Base writer quality is likely drifting.',
      }),
      expect.objectContaining({
        severity: 'high',
        message: 'The remote reviewer is frequently rescuing Qwen failures. Investigate base writer reliability.',
      }),
      expect.objectContaining({
        severity: 'high',
        message: 'Remote reviewer failures are high. Audit provider health, timeouts, and quota.',
      }),
      expect.objectContaining({
        severity: 'medium',
        message: 'Some remote reviewer replacements were rejected by the canonical validator. Check for contract drift.',
      }),
    ]));
  });

  it('sorts and humanizes top enhancer issue labels', () => {
    const issues = topWriterEnhancerIssues(createSnapshot(), 2);

    expect(issues).toEqual([
      ['generic-reply-pattern', 4],
      ['base-writer-failed', 2],
    ]);
    expect(humanizeIssueLabel('generic-reply-pattern')).toBe('generic reply pattern');
    expect(humanizeIssueLabel('uniqueLabels')).toBe('unique labels');
  });

  it('derives premium deep alerts for quality rejects, failovers, and safety blocks', () => {
    const alerts = derivePremiumDiagnosticsAlerts(createPremiumSnapshot());

    expect(alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'high',
        message: 'Premium deep quality rejects are high. Remote providers are returning too many non-additive or low-signal passes.',
      }),
      expect.objectContaining({
        severity: 'high',
        message: 'Premium deep failover rate is high. One remote provider is unstable enough to disrupt the routed deep pass.',
      }),
      expect.objectContaining({
        severity: 'high',
        message: 'Premium deep failures are high. Quality gates or upstream provider health are degrading the deep pass.',
      }),
      expect.objectContaining({
        severity: 'high',
        message: 'Premium deep safety blocks are elevated. Deep synthesis may be producing unsafe or empty summaries.',
      }),
      expect.objectContaining({
        severity: 'high',
        message: 'Premium deep safety mutation rate is high. Remote summaries may be drifting too close to safety boundaries.',
      }),
    ]));
  });

  it('derives provider-availability alerts for suppressed premium providers', () => {
    const alerts = derivePremiumProviderAvailabilityAlerts(createPremiumProviderAvailabilitySnapshot());

    expect(alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'high',
        message: 'Premium provider gemini is currently suppressed: auth_unavailable (403).',
      }),
    ]));
  });

  it('derives provider-specific enhancer drift summaries from longitudinal history', () => {
    const trends = deriveWriterProviderTrendSummaries([
      {
        recordedAt: '2026-04-08T20:00:00.000Z',
        providers: {
          gemini: {
            reviews: 10,
            failures: 0,
            candidateTakeovers: 2,
            rescueTakeovers: 0,
            latencyTotalMs: 900,
          },
          openai: {
            reviews: 8,
            failures: 0,
            candidateTakeovers: 1,
            rescueTakeovers: 0,
            latencyTotalMs: 720,
          },
        },
      },
      {
        recordedAt: '2026-04-08T20:30:00.000Z',
        providers: {
          gemini: {
            reviews: 18,
            failures: 3,
            candidateTakeovers: 6,
            rescueTakeovers: 2,
            latencyTotalMs: 2_100,
          },
          openai: {
            reviews: 14,
            failures: 0,
            candidateTakeovers: 2,
            rescueTakeovers: 0,
            latencyTotalMs: 1_260,
          },
        },
      },
    ]);

    expect(trends).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider: 'gemini',
        status: 'degraded',
      }),
      expect.objectContaining({
        provider: 'openai',
        status: 'healthy',
      }),
    ]));
  });

  it('derives high-signal alerts for delta drift and fallback overuse', () => {
    const alerts = deriveConversationDeltaAlerts({
      resolutionCount: 20,
      storedReuseCount: 4,
      rebuiltCount: 16,
      selfHealCount: 3,
      storedReuseRate: 0.2,
      rebuildRate: 0.8,
      selfHealRate: 0.15,
      summaryFallbackCount: 5,
    });

    expect(alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'medium',
        message: 'Delta decisions are rebuilding often instead of reusing stored state. Watch for cache drift or recompute churn.',
      }),
      expect.objectContaining({
        severity: 'high',
        message: 'Stored delta decisions are self-healing frequently. Session state may be drifting stale before reconciliation.',
      }),
      expect.objectContaining({
        severity: 'high',
        message: 'Interpolator surface summaries are falling back often. Users may be seeing weaker phrasing than the canonical state supports.',
      }),
    ]));
  });

  it('derives watch alerts and a degraded Conversation OS health summary when live freshness regresses', () => {
    const watchAlerts = deriveConversationWatchAlerts({
      watch: {
        currentState: 'retrying',
        connectionAttempts: 6,
        readyCount: 1,
        invalidationCount: 2,
        degradedCount: 2,
        reconnectCount: 3,
        closedCount: 0,
        lastReadyAt: '2026-04-08T18:00:00.000Z',
        lastInvalidationAt: '2026-04-08T18:01:00.000Z',
        lastStatusCode: 'upstream_5xx',
      },
      hydration: {
        phases: {
          initial: { attempts: 1, successes: 1, failures: 0 },
          event: { attempts: 1, successes: 1, failures: 0 },
          poll: { attempts: 5, successes: 3, failures: 2 },
        },
        totalAttempts: 7,
        totalSuccesses: 5,
        totalFailures: 2,
        successRate: 5 / 7,
        eventShare: 1 / 7,
        pollShare: 5 / 7,
        lastPhase: 'poll',
        lastOutcome: 'failure',
      },
    });

    expect(watchAlerts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'high',
        message: 'Watch reconnect churn is high. The live invalidation stream may be unstable.',
      }),
      expect.objectContaining({
        severity: 'high',
        message: 'Hydration is leaning heavily on polling instead of live invalidation. The Conversation OS still feels refresh-driven.',
      }),
    ]));

    const health = deriveConversationOsHealth({
      writer: createSnapshot(),
      premium: createPremiumSnapshot(),
      premiumProviders: createPremiumProviderAvailabilitySnapshot(),
      metrics: {
        modes: {
          normal: { count: 4, modelRate: 0.75, fallbackRate: 0.25, avgSurfaceConfidence: 0.7, avgInterpretiveConfidence: 0.66 },
          descriptive_fallback: { count: 3, modelRate: 0.4, fallbackRate: 0.6, avgSurfaceConfidence: 0.58, avgInterpretiveConfidence: 0.45 },
          minimal_fallback: { count: 1, modelRate: 0, fallbackRate: 1, avgSurfaceConfidence: 0.2, avgInterpretiveConfidence: 0.1 },
        },
        gate: { passed: 6, skipped: 2 },
        delta: {
          resolutionCount: 20,
          storedReuseCount: 4,
          rebuiltCount: 16,
          selfHealCount: 3,
          storedReuseRate: 0.2,
          rebuildRate: 0.8,
          selfHealRate: 0.15,
          summaryFallbackCount: 5,
        },
        watch: {
          currentState: 'retrying',
          connectionAttempts: 6,
          readyCount: 1,
          invalidationCount: 2,
          degradedCount: 2,
          reconnectCount: 3,
          closedCount: 0,
          lastReadyAt: '2026-04-08T18:00:00.000Z',
          lastInvalidationAt: '2026-04-08T18:01:00.000Z',
          lastStatusCode: 'upstream_5xx',
        },
        hydration: {
          phases: {
            initial: { attempts: 1, successes: 1, failures: 0 },
            event: { attempts: 1, successes: 1, failures: 0 },
            poll: { attempts: 5, successes: 3, failures: 2 },
          },
          totalAttempts: 7,
          totalSuccesses: 5,
          totalFailures: 2,
          successRate: 5 / 7,
          eventShare: 1 / 7,
          pollShare: 5 / 7,
          lastPhase: 'poll',
          lastOutcome: 'failure',
        },
        totalWriterAttempts: 14,
        overallModelSuccessRate: 10 / 14,
        overallFallbackRate: 4 / 14,
        stageTimings: {},
      },
    });

    expect(health.status).toBe('degraded');
    expect(health.headline).toContain('degraded');
    expect(health.details.some((detail) => detail.includes('Premium provider gemini unavailable'))).toBe(true);
  });

  it('derives longitudinal Conversation OS trend summaries from bounded history', () => {
    const trend = deriveConversationOsTrendSummary([
      {
        recordedAt: '2026-04-08T18:00:00.000Z',
        delta: {
          resolutionCount: 10,
          storedReuseCount: 7,
          rebuiltCount: 3,
          selfHealCount: 0,
          summaryFallbackCount: 1,
        },
        watch: {
          currentState: 'ready',
          connectionAttempts: 2,
          readyCount: 2,
          invalidationCount: 4,
          degradedCount: 0,
          reconnectCount: 0,
          closedCount: 0,
        },
        hydration: {
          totalAttempts: 5,
          totalSuccesses: 5,
          totalFailures: 0,
          eventShare: 0.6,
          pollShare: 0.2,
        },
        modes: {
          normal: 8,
          descriptive_fallback: 2,
          minimal_fallback: 0,
        },
      },
      {
        recordedAt: '2026-04-08T18:30:00.000Z',
        delta: {
          resolutionCount: 20,
          storedReuseCount: 10,
          rebuiltCount: 10,
          selfHealCount: 3,
          summaryFallbackCount: 3,
        },
        watch: {
          currentState: 'retrying',
          connectionAttempts: 6,
          readyCount: 3,
          invalidationCount: 7,
          degradedCount: 2,
          reconnectCount: 2,
          closedCount: 0,
        },
        hydration: {
          totalAttempts: 10,
          totalSuccesses: 8,
          totalFailures: 2,
          eventShare: 0.25,
          pollShare: 0.55,
        },
        modes: {
          normal: 11,
          descriptive_fallback: 7,
          minimal_fallback: 2,
        },
      },
    ]);

    expect(trend.status).toBe('degraded');
    expect(trend.headline).toContain('trends show churn');
    expect(trend.details[0]).toContain('self-heal 30.0%');
    expect(trend.details[2]).toContain('descriptive 5');
  });

  it('derives a shadow supervisor summary from recommendation telemetry', () => {
    const summary = deriveConversationSupervisorSummary({
      mode: 'shadow',
      decisionsEvaluated: 8,
      noActionDecisions: 3,
      recommendationsIssued: 5,
      cooldownSuppressions: 2,
      triggerCounts: {
        session_hydrated: 2,
        writer_completed: 2,
        multimodal_completed: 1,
        premium_completed: 3,
      },
      actionCounts: {
        hold_premium_until_fresh: 1,
        rerun_writer_with_safe_fallback: 1,
        skip_premium_for_cycle: 1,
        stabilize_composer_context: 1,
        treat_multimodal_as_low_authority: 1,
      },
      traceCounts: {
        writer_error: 1,
        writer_stale_discard: 0,
        multimodal_degraded: 1,
        multimodal_error: 0,
        premium_error: 2,
        premium_low_signal_cycle: 1,
        mutation_churn: 1,
        premium_waiting_on_freshness: 0,
      },
      lastDecision: {
        trigger: 'premium_completed',
        evaluatedAt: '2026-04-09T13:10:00.000Z',
        actionTypes: ['skip_premium_for_cycle'],
        traceCodes: ['premium_error', 'premium_low_signal_cycle'],
        summaryMode: 'minimal_fallback',
        activeTasks: [],
        premiumStatus: 'error',
        multimodalAuthority: 'low_authority',
        cooldownSuppressed: false,
      },
    });

    expect(summary.status).toBe('degraded');
    expect(summary.headline).toContain('shadow supervisor');
    expect(summary.details[0]).toContain('recommendations 5');
    expect(summary.details[2]).toContain('skip_premium_for_cycle');
  });

  it('formats relative timestamp ages for the operator view', () => {
    expect(formatRelativeAge('2026-04-08T18:00:00.000Z', Date.parse('2026-04-08T18:00:30.000Z'))).toBe('30s ago');
    expect(formatRelativeAge('2026-04-08T18:00:00.000Z', Date.parse('2026-04-08T18:03:00.000Z'))).toBe('3m ago');
  });
});
