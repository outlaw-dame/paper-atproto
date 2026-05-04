import { beforeEach, describe, expect, it } from 'vitest';

let diagnosticsModule: typeof import('./writerDiagnostics.js');

describe('writerDiagnostics', () => {
  beforeEach(async () => {
    diagnosticsModule = await import(`./writerDiagnostics.js?test=${Date.now()}`);
    diagnosticsModule.resetWriterDiagnostics();
  });

  it('derives enhancer rates and bounded issue labels without storing raw content', () => {
    const {
      getWriterDiagnostics,
      recordWriterClientOutcome,
      recordWriterEnhancerFailure,
      recordWriterEnhancerInvocation,
      recordWriterEnhancerRejectedReplacement,
      recordWriterEnhancerReview,
      recordWriterEnhancerSkip,
      recordWriterEnhancerTakeoverApplied,
    } = diagnosticsModule;

    recordWriterClientOutcome({ outcome: 'model', reason: 'success' });

    recordWriterEnhancerInvocation();
    recordWriterEnhancerReview({
      source: 'candidate',
      decision: 'replace',
      latencyMs: 120.7,
      provider: 'gemini',
      model: 'gemini-3-flash-preview',
      issues: ['Generic Reply Pattern', 'Root text leaked: @someone said X'],
    });
    recordWriterEnhancerTakeoverApplied('candidate', 'gemini');

    recordWriterEnhancerInvocation();
    recordWriterEnhancerFailure({
      failureClass: 'timeout',
      latencyMs: 210.2,
      source: 'candidate',
      provider: 'gemini',
      model: 'gemini-3-flash-preview',
      message: 'provider overloaded',
      retryable: true,
      requestId: 'req-123',
      status: 503,
      retryAfterMs: 1500,
    });

    recordWriterEnhancerInvocation();
    recordWriterEnhancerSkip('disabled');

    recordWriterEnhancerInvocation();
    recordWriterEnhancerReview({
      source: 'qwen_failure',
      decision: 'replace',
      latencyMs: 90,
      provider: 'openai',
      model: 'gpt-5.4',
      issues: ['base-writer-failed', 'contributor_blurbs_missing'],
    });
    recordWriterEnhancerRejectedReplacement('invalid-response');

    recordWriterEnhancerInvocation();
    recordWriterEnhancerReview({
      source: 'candidate',
      decision: 'accept',
      latencyMs: 40,
      provider: 'openai',
      model: 'gpt-5.4',
      issues: ['contributorblurbs_missing', 'mode_constraint_violation'],
    });

    const diagnostics = getWriterDiagnostics() as {
      enhancer?: {
        invocations?: number;
        reviews?: number;
        reviewAttemptRate?: number;
        skips?: { disabled?: number; unavailable?: number; total?: number; skipRate?: number };
        appliedTakeovers?: { candidate?: number; rescue?: number; total?: number; candidateReplacementRate?: number; rescueRate?: number };
        rejectedReplacements?: { ['invalid-response']?: number; total?: number };
        failures?: { total?: number; timeout?: number; failureRate?: number };
        providers?: Record<string, {
          reviews?: number;
          failures?: number;
          appliedTakeovers?: { total?: number };
          failureRate?: number;
          lastModel?: string;
        }>;
        lastFailure?: {
          source?: string;
          provider?: string;
          model?: string;
          message?: string;
          retryable?: boolean;
          requestId?: string;
          status?: number;
          retryAfterMs?: number;
        };
        latencyMs?: { total?: number; max?: number; last?: number; average?: number };
        issueDistribution?: Record<string, number>;
      };
    };

    expect(diagnostics.enhancer?.invocations).toBe(5);
    expect(diagnostics.enhancer?.reviews).toBe(3);
    expect(diagnostics.enhancer?.reviewAttemptRate).toBe(0.6);
    expect(diagnostics.enhancer?.skips?.disabled).toBe(1);
    expect(diagnostics.enhancer?.skips?.unavailable).toBe(0);
    expect(diagnostics.enhancer?.skips?.total).toBe(1);
    expect(diagnostics.enhancer?.skips?.skipRate).toBe(0.2);
    expect(diagnostics.enhancer?.appliedTakeovers?.candidate).toBe(1);
    expect(diagnostics.enhancer?.appliedTakeovers?.rescue).toBe(0);
    expect(diagnostics.enhancer?.appliedTakeovers?.total).toBe(1);
    expect(diagnostics.enhancer?.appliedTakeovers?.candidateReplacementRate).toBe(0.5);
    expect(diagnostics.enhancer?.appliedTakeovers?.rescueRate).toBe(0);
    expect(diagnostics.enhancer?.rejectedReplacements?.['invalid-response']).toBe(1);
    expect(diagnostics.enhancer?.rejectedReplacements?.total).toBe(1);
    expect(diagnostics.enhancer?.failures?.total).toBe(1);
    expect(diagnostics.enhancer?.failures?.timeout).toBe(1);
    expect(diagnostics.enhancer?.failures?.failureRate).toBe(0.2);
    expect(diagnostics.enhancer?.lastFailure?.source).toBe('candidate');
    expect(diagnostics.enhancer?.lastFailure?.provider).toBe('gemini');
    expect(diagnostics.enhancer?.lastFailure?.model).toBe('gemini-3-flash-preview');
    expect(diagnostics.enhancer?.lastFailure?.message).toBe('provider overloaded');
    expect(diagnostics.enhancer?.lastFailure?.retryable).toBe(true);
    expect(diagnostics.enhancer?.lastFailure?.requestId).toBe('req-123');
    expect(diagnostics.enhancer?.lastFailure?.status).toBe(503);
    expect(diagnostics.enhancer?.lastFailure?.retryAfterMs).toBe(1500);
    expect(diagnostics.enhancer?.latencyMs?.total).toBe(460);
    expect(diagnostics.enhancer?.latencyMs?.max).toBe(210);
    expect(diagnostics.enhancer?.latencyMs?.last).toBe(40);
    expect(diagnostics.enhancer?.latencyMs?.average).toBe(115);
    expect(diagnostics.enhancer?.issueDistribution?.['generic-reply-pattern']).toBe(1);
    expect(diagnostics.enhancer?.issueDistribution?.['base-writer-failed']).toBe(1);
    expect(diagnostics.enhancer?.issueDistribution?.['contributor-blurbs-missing']).toBe(2);
    expect(diagnostics.enhancer?.issueDistribution?.['mode-constraint-violation']).toBe(1);
    expect(diagnostics.enhancer?.issueDistribution?.['root-text-leaked-someone-said-x']).toBe(1);
    expect(diagnostics.enhancer?.providers?.gemini?.reviews).toBe(1);
    expect(diagnostics.enhancer?.providers?.gemini?.failures).toBe(1);
    expect(diagnostics.enhancer?.providers?.gemini?.appliedTakeovers?.total).toBe(1);
    expect(diagnostics.enhancer?.providers?.openai?.reviews).toBe(2);
    expect(diagnostics.enhancer?.providers?.openai?.failureRate).toBe(0);
    expect(diagnostics.enhancer?.providers?.openai?.lastModel).toBe('gpt-5.4');
  });

  it('caps enhancer issue cardinality and aggregates overflow into other', () => {
    const {
      getWriterDiagnostics,
      recordWriterEnhancerInvocation,
      recordWriterEnhancerReview,
    } = diagnosticsModule;

    for (let index = 0; index < 35; index += 1) {
      recordWriterEnhancerInvocation();
      recordWriterEnhancerReview({
        source: 'candidate',
        decision: 'accept',
        latencyMs: 10,
        provider: 'gemini',
        model: 'gemini-3-flash-preview',
        issues: [`issue-${index}`],
      });
    }

    const diagnostics = getWriterDiagnostics() as {
      enhancer?: {
        issueDistribution?: Record<string, number>;
      };
    };

    expect(diagnostics.enhancer?.issueDistribution?.other).toBe(3);
    expect(diagnostics.enhancer?.issueDistribution?.uniqueLabels).toBe(33);
  });
});
