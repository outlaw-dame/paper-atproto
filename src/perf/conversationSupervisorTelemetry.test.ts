import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getConversationSupervisorTelemetrySnapshot,
  recordConversationSupervisorDecision,
  resetConversationSupervisorTelemetryForTests,
  subscribeConversationSupervisorTelemetry,
} from './conversationSupervisorTelemetry';

describe('conversationSupervisorTelemetry', () => {
  beforeEach(() => {
    resetConversationSupervisorTelemetryForTests();
  });

  it('tracks decisions, actions, traces, and cooldown suppressions without user content', () => {
    recordConversationSupervisorDecision({
      trigger: 'premium_completed',
      actionTypes: ['hold_premium_until_fresh', 'stabilize_composer_context'],
      traceCodes: ['premium_error', 'mutation_churn'],
      evaluatedAt: '2026-04-09T13:00:00.000Z',
      summaryMode: 'descriptive_fallback',
      activeTasks: ['premium'],
      premiumStatus: 'error',
      multimodalAuthority: 'low_authority',
      cooldownSuppressed: true,
    });

    const snapshot = getConversationSupervisorTelemetrySnapshot();
    expect(snapshot.decisionsEvaluated).toBe(1);
    expect(snapshot.recommendationsIssued).toBe(2);
    expect(snapshot.cooldownSuppressions).toBe(1);
    expect(snapshot.actionCounts.hold_premium_until_fresh).toBe(1);
    expect(snapshot.traceCounts.premium_error).toBe(1);
    expect(snapshot.lastDecision).toEqual(expect.objectContaining({
      trigger: 'premium_completed',
      actionTypes: ['hold_premium_until_fresh', 'stabilize_composer_context'],
      traceCodes: ['premium_error', 'mutation_churn'],
      premiumStatus: 'error',
      multimodalAuthority: 'low_authority',
      cooldownSuppressed: true,
    }));
  });

  it('publishes snapshot updates to subscribers', () => {
    vi.stubGlobal('window', Object.assign(new EventTarget(), {}));

    let captured = getConversationSupervisorTelemetrySnapshot();
    const unsubscribe = subscribeConversationSupervisorTelemetry((snapshot) => {
      captured = snapshot;
    });

    recordConversationSupervisorDecision({
      trigger: 'writer_completed',
      actionTypes: ['rerun_writer_with_safe_fallback'],
      traceCodes: ['writer_error'],
      evaluatedAt: '2026-04-09T13:05:00.000Z',
      summaryMode: 'normal',
      activeTasks: [],
      premiumStatus: 'idle',
      multimodalAuthority: 'none',
    });

    unsubscribe();

    expect(captured.decisionsEvaluated).toBe(1);
    expect(captured.actionCounts.rerun_writer_with_safe_fallback).toBe(1);
    expect(captured.traceCounts.writer_error).toBe(1);
  });
});
