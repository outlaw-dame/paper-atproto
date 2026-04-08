import { describe, expect, it } from 'vitest';

import {
  deriveWriterDiagnosticsAlerts,
  humanizeIssueLabel,
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
        message: 'Gemini is replacing many valid Qwen drafts. Base writer quality is likely drifting.',
      }),
      expect.objectContaining({
        severity: 'high',
        message: 'Gemini is frequently rescuing Qwen failures. Investigate base writer reliability.',
      }),
      expect.objectContaining({
        severity: 'high',
        message: 'Gemini reviewer failures are high. Audit API health, timeouts, and quota.',
      }),
      expect.objectContaining({
        severity: 'medium',
        message: 'Some Gemini replacements were rejected by the canonical validator. Check for contract drift.',
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
});
