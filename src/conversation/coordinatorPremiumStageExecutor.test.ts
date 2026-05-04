import { describe, expect, it } from 'vitest';
import type {
  DeepInterpolatorResult,
  PremiumAiEntitlements,
  PremiumInterpolatorRequest,
} from '../intelligence/premiumContracts';
import {
  executeConversationCoordinatorPremiumStage,
  type ConversationCoordinatorPremiumExecutionContext,
} from './coordinatorPremiumStageExecutor';
import {
  __resetDecisionFeedForTesting,
  getDecisionFeedSnapshot,
} from '../intelligence/coordinator/decisionFeed';

const BASE_ENTITLEMENTS: PremiumAiEntitlements = {
  tier: 'pro',
  capabilities: ['deep_interpolator'],
  providerAvailable: true,
  provider: 'gemini',
  availableProviders: ['gemini'],
};

const REQUEST: PremiumInterpolatorRequest = {
  actorDid: 'did:plc:viewer',
  threadId: 'at://did:plc:test/app.bsky.feed.post/root',
  summaryMode: 'normal',
  confidence: {
    surfaceConfidence: 0.8,
    entityConfidence: 0.7,
    interpretiveConfidence: 0.6,
  },
  visibleReplyCount: 3,
  rootPost: {
    uri: 'at://did:plc:test/app.bsky.feed.post/root',
    handle: 'root.example',
    text: 'Root post text.',
    createdAt: '2026-05-01T20:00:00.000Z',
  },
  selectedComments: [],
  topContributors: [],
  safeEntities: [],
  factualHighlights: [],
  whatChangedSignals: [],
  interpretiveBrief: {
    summaryMode: 'normal',
    baseSummary: 'Safe redacted summary.',
    supports: ['visible replies add context'],
    limits: ['not enough evidence for a strong claim'],
  },
};

function createResult(overrides: Partial<DeepInterpolatorResult> = {}): DeepInterpolatorResult {
  return {
    summary: 'Premium synthesis adds deeper but bounded context.',
    groundedContext: 'Grounded context from visible replies.',
    perspectiveGaps: ['One missing perspective.'],
    followUpQuestions: ['What evidence would resolve the dispute?'],
    confidence: 0.76,
    provider: 'gemini',
    updatedAt: '2026-05-01T20:05:00.000Z',
    sourceComputedAt: '2026-05-01T20:00:00.000Z',
    safety: {
      flagged: false,
      severity: 'none',
      categories: [],
    },
    ...overrides,
  };
}

describe('coordinator premium stage executor', () => {
  it('publishes premium verification decisions when decision-feed instrumentation is enabled', async () => {
    __resetDecisionFeedForTesting();
    await executeConversationCoordinatorPremiumStage({
      request: REQUEST,
      entitlements: BASE_ENTITLEMENTS,
      redactionVerified: true,
      executePremium: async () => createResult(),
      verify: async () => ({
        verdict: Object.freeze({
          trust: 'verified' as const,
          suggestedConfidenceCap: 0.76,
          holdPremiumUntilFresh: false,
          reasonCodes: Object.freeze(['premium_verification_clean']),
        }),
        thinking: {
          ok: true,
          degraded: false,
          budgetExceeded: false,
          aborted: false,
          reasonCodes: ['premium_verification_clean'],
          steps: [],
          totalDurationMs: 4,
        },
      }),
      decisionFeed: {
        enabled: true,
        sessionId: 'session-premium-1',
        sourceToken: 'src-premium-1',
      },
    });

    const snapshot = getDecisionFeedSnapshot();
    expect(snapshot.records.length).toBe(1);
    expect(snapshot.records[0]?.surface).toBe('premium_verification');
    expect(snapshot.records[0]?.sessionId).toBe('session-premium-1');
    expect(snapshot.records[0]?.sourceToken).toBe('src-premium-1');
    if (snapshot.records[0]?.summary.kind !== 'premium_verification') {
      throw new Error('wrong summary kind');
    }
    expect(snapshot.records[0].summary.trust).toBe('verified');
  });

  it('skips provider execution when redaction has not been verified', async () => {
    let called = false;
    const outcome = await executeConversationCoordinatorPremiumStage({
      request: REQUEST,
      entitlements: BASE_ENTITLEMENTS,
      redactionVerified: false,
      executePremium: async () => {
        called = true;
        return createResult();
      },
      nowMs: createClock([0, 2]),
    });

    expect(called).toBe(false);
    expect(outcome).toEqual({
      schemaVersion: 1,
      status: 'skipped',
      error: 'Premium request redaction was not verified before provider execution.',
      provider: 'gemini',
      durationMs: 2,
      attempts: 0,
      reasonCodes: ['premium_redaction_required'],
      diagnostics: {
        redactionVerified: false,
        normalized: false,
        safetyFlagged: false,
      },
    });
  });

  it('returns not_entitled when the premium provider is unavailable', async () => {
    const outcome = await executeConversationCoordinatorPremiumStage({
      request: REQUEST,
      entitlements: {
        ...BASE_ENTITLEMENTS,
        providerAvailable: false,
      },
      redactionVerified: true,
      executePremium: async () => createResult(),
      nowMs: createClock([10, 15]),
    });

    expect(outcome).toEqual({
      schemaVersion: 1,
      status: 'not_entitled',
      error: 'Premium AI provider is unavailable for this account.',
      provider: 'gemini',
      durationMs: 5,
      attempts: 0,
      reasonCodes: ['premium_provider_unavailable'],
      diagnostics: {
        redactionVerified: true,
        normalized: false,
        safetyFlagged: false,
      },
    });
  });

  it('returns not_entitled when the deep interpolator capability is missing', async () => {
    const outcome = await executeConversationCoordinatorPremiumStage({
      request: REQUEST,
      entitlements: {
        ...BASE_ENTITLEMENTS,
        capabilities: ['explore_insight'],
      },
      redactionVerified: true,
      executePremium: async () => createResult(),
      nowMs: createClock([1, 3]),
    });

    expect(outcome).toMatchObject({
      schemaVersion: 1,
      status: 'not_entitled',
      error: 'Premium deep interpolator capability is not enabled for this account.',
      provider: 'gemini',
      durationMs: 2,
      attempts: 0,
      reasonCodes: ['premium_capability_missing'],
    });
  });

  it('executes an entitled premium provider call and returns a ready outcome', async () => {
    const controller = new AbortController();
    const contexts: ConversationCoordinatorPremiumExecutionContext[] = [];
    const outcome = await executeConversationCoordinatorPremiumStage({
      request: REQUEST,
      entitlements: BASE_ENTITLEMENTS,
      redactionVerified: true,
      signal: controller.signal,
      nowMs: createClock([0, 9]),
      executePremium: async (request, context) => {
        expect(request).toBe(REQUEST);
        expect(context.signal).toBe(controller.signal);
        contexts.push(context);
        return createResult();
      },
    });

    expect(contexts).toEqual([
      {
        provider: 'gemini',
        attempt: 1,
        signal: controller.signal,
      },
    ]);
    expect(outcome).toEqual({
      schemaVersion: 1,
      status: 'ready',
      result: createResult(),
      provider: 'gemini',
      durationMs: 9,
      attempts: 1,
      reasonCodes: ['premium_entitlement_allowed', 'premium_result_ready'],
      diagnostics: {
        redactionVerified: true,
        normalized: false,
        safetyFlagged: false,
      },
    });
  });

  it('uses injected wall-clock ISO time for missing updatedAt fallback', async () => {
    const outcome = await executeConversationCoordinatorPremiumStage({
      request: REQUEST,
      entitlements: BASE_ENTITLEMENTS,
      redactionVerified: true,
      nowMs: createClock([0, 1]),
      nowIso: () => '2026-05-02T17:45:00.000Z',
      executePremium: async () => ({
        summary: 'Premium summary without provider timestamp.',
        perspectiveGaps: [],
        followUpQuestions: [],
        confidence: 0.5,
        provider: 'gemini',
      }),
    });

    expect(outcome).toMatchObject({
      status: 'ready',
      result: {
        updatedAt: '2026-05-02T17:45:00.000Z',
      },
      diagnostics: {
        normalized: true,
      },
    });
    expect(outcome.reasonCodes).toContain('premium_result_normalized');
  });

  it('normalizes noisy premium results and flags safety metadata', async () => {
    const outcome = await executeConversationCoordinatorPremiumStage({
      request: REQUEST,
      entitlements: BASE_ENTITLEMENTS,
      redactionVerified: true,
      nowMs: createClock([0, 5]),
      executePremium: async () => ({
        summary: '  Premium\u0000 summary. ',
        groundedContext: ' Context\nline. ',
        perspectiveGaps: [' gap ', 'gap', 3, ''],
        followUpQuestions: [' question? ', 'question?', null],
        confidence: 1.7,
        provider: 'unknown-provider',
        updatedAt: ' 2026-05-01T20:05:00.000Z ',
        sourceComputedAt: ' 2026-05-01T20:00:00.000Z ',
        safety: {
          flagged: true,
          severity: 'critical',
          categories: [' harassment ', 'harassment'],
        },
      }),
    });

    expect(outcome).toMatchObject({
      schemaVersion: 1,
      status: 'ready',
      result: {
        summary: 'Premium summary.',
        groundedContext: 'Context line.',
        perspectiveGaps: ['gap'],
        followUpQuestions: ['question?'],
        confidence: 1,
        provider: 'gemini',
        updatedAt: '2026-05-01T20:05:00.000Z',
        sourceComputedAt: '2026-05-01T20:00:00.000Z',
        safety: {
          flagged: true,
          severity: 'none',
          categories: ['harassment'],
        },
      },
      diagnostics: {
        redactionVerified: true,
        normalized: true,
        safetyFlagged: true,
      },
    });
    expect(outcome.reasonCodes).toEqual([
      'premium_entitlement_allowed',
      'premium_result_ready',
      'premium_result_normalized',
    ]);
  });

  it('returns an error for invalid premium output', async () => {
    const outcome = await executeConversationCoordinatorPremiumStage({
      request: REQUEST,
      entitlements: BASE_ENTITLEMENTS,
      redactionVerified: true,
      executePremium: async () => ({ summary: 'missing arrays' }),
      nowMs: createClock([0, 1]),
    });

    expect(outcome).toEqual({
      schemaVersion: 1,
      status: 'error',
      error: 'Premium deep interpolator returned an invalid result.',
      provider: 'gemini',
      durationMs: 1,
      attempts: 1,
      reasonCodes: ['premium_entitlement_allowed', 'premium_result_invalid'],
      diagnostics: {
        redactionVerified: true,
        normalized: false,
        safetyFlagged: false,
      },
    });
  });

  it('returns an error for an empty premium summary', async () => {
    const outcome = await executeConversationCoordinatorPremiumStage({
      request: REQUEST,
      entitlements: BASE_ENTITLEMENTS,
      redactionVerified: true,
      executePremium: async () => createResult({ summary: '   ' }),
      nowMs: createClock([0, 1]),
    });

    expect(outcome).toMatchObject({
      status: 'error',
      error: 'Premium deep interpolator returned an empty summary.',
      attempts: 1,
      reasonCodes: ['premium_entitlement_allowed', 'premium_result_missing_summary'],
    });
  });

  it('retries retryable failures with bounded exponential backoff and jitter', async () => {
    const sleeps: number[] = [];
    let attempts = 0;
    const outcome = await executeConversationCoordinatorPremiumStage({
      request: REQUEST,
      entitlements: BASE_ENTITLEMENTS,
      redactionVerified: true,
      retryPolicy: {
        maxAttempts: 3,
        baseDelayMs: 100,
        maxDelayMs: 1_000,
        jitterRatio: 0.25,
      },
      random: () => 0.5,
      sleep: async (delayMs) => {
        sleeps.push(delayMs);
      },
      nowMs: createClock([0, 4]),
      executePremium: async () => {
        attempts += 1;
        if (attempts < 2) {
          const error = new Error('temporarily unavailable') as Error & { status?: number; retryable?: boolean };
          error.status = 503;
          error.retryable = true;
          throw error;
        }
        return createResult();
      },
    });

    expect(sleeps).toEqual([100]);
    expect(outcome).toMatchObject({
      status: 'ready',
      attempts: 2,
      reasonCodes: ['premium_entitlement_allowed', 'premium_retry_attempted', 'premium_result_ready'],
    });
  });

  it('retries network-shaped TypeError failures', async () => {
    const sleeps: number[] = [];
    let attempts = 0;
    const outcome = await executeConversationCoordinatorPremiumStage({
      request: REQUEST,
      entitlements: BASE_ENTITLEMENTS,
      redactionVerified: true,
      retryPolicy: {
        maxAttempts: 2,
        baseDelayMs: 10,
        jitterRatio: 0,
      },
      sleep: async (delayMs) => {
        sleeps.push(delayMs);
      },
      nowMs: createClock([0, 2]),
      executePremium: async () => {
        attempts += 1;
        if (attempts === 1) throw new TypeError('fetch failed');
        return createResult();
      },
    });

    expect(sleeps).toEqual([10]);
    expect(outcome).toMatchObject({
      status: 'ready',
      attempts: 2,
      reasonCodes: ['premium_entitlement_allowed', 'premium_retry_attempted', 'premium_result_ready'],
    });
  });

  it('does not retry plain TypeError logic failures', async () => {
    let attempts = 0;
    const outcome = await executeConversationCoordinatorPremiumStage({
      request: REQUEST,
      entitlements: BASE_ENTITLEMENTS,
      redactionVerified: true,
      retryPolicy: {
        maxAttempts: 3,
      },
      nowMs: createClock([0, 4]),
      executePremium: async () => {
        attempts += 1;
        throw new TypeError('Cannot read properties of undefined');
      },
    });

    expect(attempts).toBe(1);
    expect(outcome).toMatchObject({
      status: 'error',
      error: 'Cannot read properties of undefined',
      attempts: 1,
      reasonCodes: ['premium_entitlement_allowed', 'premium_execution_failed'],
    });
  });

  it('does not retry property-access TypeErrors that mention socket or connection', async () => {
    for (const message of [
      "Cannot read properties of undefined (reading 'socket')",
      "Cannot read properties of undefined (reading 'connection')",
      "undefined is not an object (evaluating 'req.socket')",
      'req.connection is undefined',
      'socket is not a constructor',
      'connection is null',
      'socket is not iterable',
      "Cannot use 'in' operator to search for 'socket' in undefined",
    ]) {
      let attempts = 0;
      const outcome = await executeConversationCoordinatorPremiumStage({
        request: REQUEST,
        entitlements: BASE_ENTITLEMENTS,
        redactionVerified: true,
        retryPolicy: {
          maxAttempts: 3,
        },
        nowMs: createClock([0, 4]),
        executePremium: async () => {
          attempts += 1;
          throw new TypeError(message);
        },
      });

      expect(attempts).toBe(1);
      expect(outcome).toMatchObject({
        status: 'error',
        error: message,
        attempts: 1,
        reasonCodes: ['premium_entitlement_allowed', 'premium_execution_failed'],
      });
    }
  });

  it('does not retry non-retryable provider errors', async () => {
    let attempts = 0;
    const outcome = await executeConversationCoordinatorPremiumStage({
      request: REQUEST,
      entitlements: BASE_ENTITLEMENTS,
      redactionVerified: true,
      retryPolicy: {
        maxAttempts: 3,
      },
      nowMs: createClock([0, 4]),
      executePremium: async () => {
        attempts += 1;
        const error = new Error('bad request\u0000details') as Error & { status?: number };
        error.status = 400;
        throw error;
      },
    });

    expect(attempts).toBe(1);
    expect(outcome).toEqual({
      schemaVersion: 1,
      status: 'error',
      error: 'bad request details',
      provider: 'gemini',
      durationMs: 4,
      attempts: 1,
      reasonCodes: ['premium_entitlement_allowed', 'premium_execution_failed'],
      diagnostics: {
        redactionVerified: true,
        normalized: false,
        safetyFlagged: false,
      },
    });
  });

  it('propagates aborts before execution and during provider calls', async () => {
    const preAborted = new AbortController();
    preAborted.abort();

    await expect(executeConversationCoordinatorPremiumStage({
      request: REQUEST,
      entitlements: BASE_ENTITLEMENTS,
      redactionVerified: true,
      signal: preAborted.signal,
      executePremium: async () => createResult(),
    })).rejects.toMatchObject({ name: 'AbortError' });

    const abortError = new Error('aborted');
    abortError.name = 'AbortError';

    await expect(executeConversationCoordinatorPremiumStage({
      request: REQUEST,
      entitlements: BASE_ENTITLEMENTS,
      redactionVerified: true,
      executePremium: async () => {
        throw abortError;
      },
    })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('attaches the verification verdict when a verify hook is supplied', async () => {
    const outcome = await executeConversationCoordinatorPremiumStage({
      request: REQUEST,
      entitlements: BASE_ENTITLEMENTS,
      redactionVerified: true,
      nowMs: createClock([0, 7]),
      executePremium: async () => createResult(),
      verify: async (result, request) => {
        expect(result.summary).toContain('Premium synthesis');
        expect(request).toBe(REQUEST);
        return {
          verdict: Object.freeze({
            trust: 'verified' as const,
            suggestedConfidenceCap: 0.76,
            holdPremiumUntilFresh: false,
            reasonCodes: Object.freeze(['premium_verification_clean']),
          }),
          // Minimal ThinkingResult-shaped stub; executor only reads `verdict`.
          thinking: {} as never,
        };
      },
    });

    expect(outcome.status).toBe('ready');
    if (outcome.status !== 'ready') throw new Error('expected ready');
    expect(outcome.verification).toEqual({
      trust: 'verified',
      suggestedConfidenceCap: 0.76,
      holdPremiumUntilFresh: false,
      reasonCodes: ['premium_verification_clean'],
    });
    expect(outcome.reasonCodes).toEqual([
      'premium_entitlement_allowed',
      'premium_result_ready',
    ]);
  });

  it('records premium_verification_failed and omits verdict when verify throws', async () => {
    const outcome = await executeConversationCoordinatorPremiumStage({
      request: REQUEST,
      entitlements: BASE_ENTITLEMENTS,
      redactionVerified: true,
      nowMs: createClock([0, 4]),
      executePremium: async () => createResult(),
      verify: async () => {
        throw new Error('verifier blew up');
      },
    });

    expect(outcome.status).toBe('ready');
    if (outcome.status !== 'ready') throw new Error('expected ready');
    expect(outcome.verification).toBeUndefined();
    expect(outcome.reasonCodes).toContain('premium_verification_failed');
  });

  it('still propagates AbortError raised inside the verify hook', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    await expect(
      executeConversationCoordinatorPremiumStage({
        request: REQUEST,
        entitlements: BASE_ENTITLEMENTS,
        redactionVerified: true,
        executePremium: async () => createResult(),
        verify: async () => {
          throw abortError;
        },
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

function createClock(values: number[]): () => number {
  const queue = [...values];
  return () => queue.shift() ?? values[values.length - 1] ?? 0;
}
