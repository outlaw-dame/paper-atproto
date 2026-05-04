import { afterEach, describe, expect, it } from 'vitest';
import {
  __DECISION_FEED_INTERNALS,
  __resetDecisionFeedForTesting,
  getDecisionFeedSnapshot,
  publishComposerWriterPreflightDecision,
  publishPremiumVerificationDecision,
  publishSupervisorNextStepDecision,
  subscribeToDecisionFeed,
  type DecisionFeedRecord,
} from './decisionFeed';
import type { ThinkingResult } from './thinkingLane';
import type { PremiumVerificationResult } from '../verification/premiumVerificationLane';
import type { SupervisorNextStepPlannerResult } from '../../conversation/supervisorNextStepPlanner';

afterEach(() => {
  __resetDecisionFeedForTesting();
});

function fakeThinking(overrides: Partial<ThinkingResult> = {}): ThinkingResult {
  return {
    ok: true,
    value: undefined,
    degraded: false,
    budgetExceeded: false,
    aborted: false,
    reasonCodes: ['lane_clean'],
    steps: [],
    totalDurationMs: 12,
    ...overrides,
  };
}

function fakePremiumResult(): PremiumVerificationResult {
  return {
    verdict: {
      trust: 'verified',
      suggestedConfidenceCap: 0.7,
      holdPremiumUntilFresh: false,
      reasonCodes: ['premium_verification_clean'],
    },
    thinking: fakeThinking({ reasonCodes: ['premium_verification_clean'], totalDurationMs: 25 }),
  } as PremiumVerificationResult;
}

function fakeSupervisorResult(): SupervisorNextStepPlannerResult {
  return {
    plan: {
      nextStep: {
        type: 'rerun_writer_with_safe_fallback',
        priority: 'high',
        reason: 'writer error',
        target: 'writer',
      },
      prioritizedActionTypes: ['rerun_writer_with_safe_fallback'],
      holdAll: false,
      reasonCodes: ['supervisor_plan_escalate_writer'],
    },
    thinking: fakeThinking({ reasonCodes: ['supervisor_plan_escalate_writer'], totalDurationMs: 50 }),
  } as SupervisorNextStepPlannerResult;
}

describe('decisionFeed', () => {
  it('publishes a frozen composer pre-flight decision and notifies subscribers', () => {
    const seen: DecisionFeedRecord[] = [];
    const unsubscribe = subscribeToDecisionFeed((r) => seen.push(r));
    const record = publishComposerWriterPreflightDecision({
      thinking: fakeThinking(),
      safeToWrite: true,
      sessionId: 'session-1',
      sourceToken: 'src-1',
    });
    unsubscribe();

    expect(Object.isFrozen(record)).toBe(true);
    expect(record.surface).toBe('composer_writer_preflight');
    expect(record.summary).toEqual({ kind: 'composer_writer_preflight', safeToWrite: true });
    expect(record.sessionId).toBe('session-1');
    expect(record.sourceToken).toBe('src-1');
    expect(seen.length).toBe(1);
    expect(seen[0]?.decisionId).toBe(record.decisionId);
  });

  it('publishes a premium verification decision with clamped confidence', () => {
    const result = fakePremiumResult();
    result.verdict = { ...result.verdict, suggestedConfidenceCap: 5 };
    const record = publishPremiumVerificationDecision({ result });
    expect(record.surface).toBe('premium_verification');
    if (record.summary.kind !== 'premium_verification') throw new Error('wrong kind');
    expect(record.summary.suggestedConfidenceCap).toBe(1);
    expect(record.summary.trust).toBe('verified');
    expect(record.reasonCodes).toContain('premium_verification_clean');
  });

  it('publishes a supervisor next-step decision', () => {
    const record = publishSupervisorNextStepDecision({ result: fakeSupervisorResult() });
    if (record.summary.kind !== 'supervisor_next_step') throw new Error('wrong kind');
    expect(record.summary.nextStepType).toBe('rerun_writer_with_safe_fallback');
    expect(record.summary.holdAll).toBe(false);
    expect(record.summary.prioritizedActionTypes).toEqual(['rerun_writer_with_safe_fallback']);
  });

  it('caps the buffer at MAX_RECORDS and counts dropped entries', () => {
    const cap = __DECISION_FEED_INTERNALS.MAX_RECORDS;
    for (let i = 0; i < cap + 5; i += 1) {
      publishComposerWriterPreflightDecision({
        thinking: fakeThinking({ totalDurationMs: i }),
        safeToWrite: true,
      });
    }
    const snap = getDecisionFeedSnapshot();
    expect(snap.records.length).toBe(cap);
    expect(snap.droppedSinceReset).toBe(5);
    expect(snap.records[0]?.durationMs).toBe(5);
    expect(snap.records[snap.records.length - 1]?.durationMs).toBe(cap + 4);
  });

  it('isolates a throwing subscriber from later subscribers and from the publisher', () => {
    const after: DecisionFeedRecord[] = [];
    subscribeToDecisionFeed(() => {
      throw new Error('subscriber boom');
    });
    subscribeToDecisionFeed((r) => after.push(r));
    expect(() =>
      publishComposerWriterPreflightDecision({ thinking: fakeThinking(), safeToWrite: false }),
    ).not.toThrow();
    expect(after.length).toBe(1);
  });

  it('drops malformed reason codes, control characters, and duplicates', () => {
    const record = publishComposerWriterPreflightDecision({
      thinking: fakeThinking({
        reasonCodes: ['ok', 'ok', '', '\u0000\u0001', 'a'.repeat(200), 42 as unknown as string],
      }),
      safeToWrite: true,
    });
    expect(record.reasonCodes).toContain('ok');
    expect(record.reasonCodes).not.toContain('');
    expect(record.reasonCodes.filter((c) => c === 'ok').length).toBe(1);
    expect(record.reasonCodes.every((c) => c.length <= __DECISION_FEED_INTERNALS.MAX_REASON_CODE_LENGTH)).toBe(true);
  });

  it('omits sessionId and sourceToken when not provided or after sanitization removes them', () => {
    const record = publishComposerWriterPreflightDecision({
      thinking: fakeThinking(),
      safeToWrite: true,
      sessionId: '   ',
      sourceToken: '\u0000',
    });
    expect(record.sessionId).toBeUndefined();
    expect(record.sourceToken).toBeUndefined();
  });

  it('subscribe returns an unsubscribe function that stops further dispatch', () => {
    const seen: DecisionFeedRecord[] = [];
    const unsubscribe = subscribeToDecisionFeed((r) => seen.push(r));
    publishComposerWriterPreflightDecision({ thinking: fakeThinking(), safeToWrite: true });
    unsubscribe();
    publishComposerWriterPreflightDecision({ thinking: fakeThinking(), safeToWrite: true });
    expect(seen.length).toBe(1);
  });

  it('clamps non-finite or negative durations to 0', () => {
    const record = publishComposerWriterPreflightDecision({
      thinking: fakeThinking({ totalDurationMs: -5 }),
      safeToWrite: true,
    });
    expect(record.durationMs).toBe(0);
  });
});
