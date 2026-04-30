import { describe, expect, it } from 'vitest';
import type { InterpolatorWriterEvalFixture } from './interpolatorWriterEvalContract';
import type { InterpolatorWriterExecutionResult } from './interpolatorWriterExecutionFinalizer';
import { finalizeInterpolatorWriterCandidate } from './interpolatorWriterExecutionFinalizer';
import type { InterpolatorWriterRouteCandidate } from './interpolatorWriterRoutingPolicy';
import { selectInterpolatorWriterFallback } from './interpolatorWriterFallbackController';

type TrustedWriterRoute = Pick<InterpolatorWriterRouteCandidate, 'provider' | 'executionClass' | 'remote' | 'requiresExplicitConsent'>;

function fixture(overrides: Partial<InterpolatorWriterEvalFixture> = {}): InterpolatorWriterEvalFixture {
  return {
    schemaVersion: 1,
    id: 'fixture-thread-1',
    mode: 'normal',
    title: 'writer fallback controller fixture',
    allowedEntities: [
      { id: 'user:alice.example', label: 'Alice', source: 'post_author', required: true },
      { id: 'user:bob.example', label: 'Bob', source: 'reply_author', required: false },
    ],
    allowedClaims: [
      { id: 'claim:root-launch-delay', evidenceIds: ['evidence:root-post'], required: true },
      { id: 'claim:reply-cost-concern', evidenceIds: ['evidence:reply-1'], required: false },
    ],
    allowedEvidence: [
      { id: 'evidence:root-post', sourceType: 'post', required: true },
      { id: 'evidence:reply-1', sourceType: 'reply', required: false },
    ],
    policy: {
      allowProviderHiddenThinking: false,
      requireClaimEvidence: true,
      requireRequiredEntityCoverage: true,
      maxUnsupportedClaims: 0,
      maxInventedEntities: 0,
    },
    ...overrides,
  };
}

function route(overrides: Partial<TrustedWriterRoute> = {}): TrustedWriterRoute {
  return {
    provider: 'qwen3_4b_ollama',
    executionClass: 'local_ollama',
    remote: false,
    requiresExplicitConsent: false,
    ...overrides,
  };
}

function rawOutput(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    fixtureId: 'fixture-thread-1',
    text: 'Alice says the launch is delayed, grounded in the root post.',
    usedEntityIds: ['user:alice.example'],
    usedClaimIds: ['claim:root-launch-delay'],
    citedEvidenceIds: ['evidence:root-post'],
    selfReportedQuality: 0.84,
    ...overrides,
  };
}

function finalize(raw: unknown): InterpolatorWriterExecutionResult {
  return finalizeInterpolatorWriterCandidate({
    fixture: fixture(),
    rawOutput: raw,
    route: route(),
    thinkingMode: 'off',
    latencyMs: 700,
    outputTokens: 70,
  });
}

function decide(
  execution: InterpolatorWriterExecutionResult,
  overrides: Partial<{
    previousAttempts: number;
    maxRetries: number;
    allowHumanReview: boolean;
  }> = {},
) {
  return selectInterpolatorWriterFallback({
    execution,
    previousAttempts: overrides.previousAttempts ?? 0,
    maxRetries: overrides.maxRetries ?? 1,
    ...(overrides.allowHumanReview === undefined ? {} : { allowHumanReview: overrides.allowHumanReview }),
  });
}

function makeUnknownFailure(): InterpolatorWriterExecutionResult {
  const accepted = finalize(rawOutput());
  return {
    ...accepted,
    status: 'fallback_required',
    acceptedText: null,
    adaptedOutput: {
      ...accepted.adaptedOutput,
      status: 'contract_rejected',
      evalResult: {
        ...accepted.adaptedOutput.evalResult,
        passed: false,
        violations: [
          {
            code: 'missing_required_entity_id',
            severity: 'warning',
            message: 'Required entity was omitted.',
            id: 'user:alice.example',
          },
        ],
      },
    },
    diagnostics: {
      ...accepted.diagnostics,
      fallbackRequired: true,
      contractAccepted: false,
    },
  };
}

describe('selectInterpolatorWriterFallback', () => {
  it('continues when writer execution is accepted', () => {
    const decision = decide(finalize(rawOutput()));

    expect(decision.action).toBe('continue');
    expect(decision.retryAllowed).toBe(false);
    expect(decision.final).toBe(true);
    expect(decision.nextAttempt).toBeNull();
    expect(decision.reasonCodes).toContain('writer_accepted');
    expect(decision.diagnostics.violationCodes).toEqual([]);
  });

  it('retries schema failures when retry budget remains', () => {
    const decision = decide(finalize({ invalid: 'shape' }), { previousAttempts: 0, maxRetries: 1 });

    expect(decision.action).toBe('retry_with_stricter_schema');
    expect(decision.retryAllowed).toBe(true);
    expect(decision.final).toBe(false);
    expect(decision.nextAttempt).toBe(1);
    expect(decision.reasonCodes).toEqual(expect.arrayContaining([
      'empty_output_retry_available',
      'retry_budget_available',
    ]));
  });

  it('falls back to minimal output when schema retry budget is exhausted', () => {
    const decision = decide(finalize({ invalid: 'shape' }), { previousAttempts: 1, maxRetries: 1 });

    expect(decision.action).toBe('fallback_to_minimal');
    expect(decision.retryAllowed).toBe(false);
    expect(decision.final).toBe(true);
    expect(decision.nextAttempt).toBeNull();
    expect(decision.reasonCodes).toEqual(expect.arrayContaining([
      'empty_output_retry_exhausted',
      'retry_budget_exhausted',
    ]));
  });

  it('does not retry fixture mismatches', () => {
    const decision = decide(finalize(rawOutput({ fixtureId: 'different-fixture' })), {
      previousAttempts: 0,
      maxRetries: 2,
    });

    expect(decision.action).toBe('fallback_to_deterministic_projection');
    expect(decision.retryAllowed).toBe(false);
    expect(decision.final).toBe(true);
    expect(decision.reasonCodes).toContain('fixture_mismatch_no_retry');
    expect(decision.diagnostics.violationCodes).toContain('fixture_id_mismatch');
  });

  it('retries grounding failures when budget remains', () => {
    const decision = decide(finalize(rawOutput({
      usedEntityIds: ['user:alice.example', 'user:invented.example'],
    })), {
      previousAttempts: 0,
      maxRetries: 1,
    });

    expect(decision.action).toBe('retry_with_stricter_grounding');
    expect(decision.retryAllowed).toBe(true);
    expect(decision.reasonCodes).toEqual(expect.arrayContaining([
      'grounding_retry_available',
      'retry_budget_available',
    ]));
  });

  it('falls back to descriptive output when grounding retry budget is exhausted', () => {
    const decision = decide(finalize(rawOutput({
      usedClaimIds: ['claim:root-launch-delay', 'claim:invented'],
    })), {
      previousAttempts: 1,
      maxRetries: 1,
    });

    expect(decision.action).toBe('fallback_to_descriptive');
    expect(decision.retryAllowed).toBe(false);
    expect(decision.reasonCodes).toEqual(expect.arrayContaining([
      'grounding_retry_exhausted',
      'retry_budget_exhausted',
    ]));
  });

  it('routes unknown failures to human review when allowed', () => {
    const decision = decide(makeUnknownFailure(), { allowHumanReview: true });

    expect(decision.action).toBe('human_review_required');
    expect(decision.retryAllowed).toBe(false);
    expect(decision.final).toBe(true);
    expect(decision.reasonCodes).toContain('unknown_failure_review_required');
  });

  it('routes unknown failures to deterministic fallback when review is not allowed', () => {
    const decision = decide(makeUnknownFailure(), { allowHumanReview: false });

    expect(decision.action).toBe('fallback_to_deterministic_projection');
    expect(decision.retryAllowed).toBe(false);
    expect(decision.final).toBe(true);
    expect(decision.reasonCodes).toContain('unknown_failure_deterministic_fallback');
  });

  it('sanitizes retry counters and clamps max retries', () => {
    const decision = decide(finalize({ invalid: 'shape' }), {
      previousAttempts: -10,
      maxRetries: 99,
    });

    expect(decision.action).toBe('retry_with_stricter_schema');
    expect(decision.retryAllowed).toBe(true);
    expect(decision.nextAttempt).toBe(1);
    expect(decision.diagnostics.previousAttempts).toBe(0);
    expect(decision.diagnostics.maxRetries).toBe(2);
    expect(decision.diagnostics.remainingRetries).toBe(2);
  });
});
