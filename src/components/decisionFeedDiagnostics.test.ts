import { describe, expect, it } from 'vitest';
import { deriveDecisionFeedHealth } from './decisionFeedDiagnostics';
import type { DecisionFeedSnapshot } from '../intelligence/coordinator/decisionFeed';

function makeSnapshot(overrides: Partial<DecisionFeedSnapshot> = {}): DecisionFeedSnapshot {
  return {
    records: [],
    droppedSinceReset: 0,
    sequence: 0,
    ...overrides,
  };
}

describe('deriveDecisionFeedHealth', () => {
  it('returns idle when the feed is empty', () => {
    const summary = deriveDecisionFeedHealth(makeSnapshot());
    expect(summary.status).toBe('idle');
    expect(summary.totals.records).toBe(0);
  });

  it('returns healthy when all surfaces are covered without degraded signals', () => {
    const snapshot = makeSnapshot({
      records: [
        {
          decisionId: 'a',
          surface: 'composer_writer_preflight',
          publishedAt: new Date().toISOString(),
          durationMs: 10,
          degraded: false,
          ok: true,
          reasonCodes: ['signals_present'],
          summary: { kind: 'composer_writer_preflight', safeToWrite: true },
        },
        {
          decisionId: 'b',
          surface: 'premium_verification',
          publishedAt: new Date().toISOString(),
          durationMs: 20,
          degraded: false,
          ok: true,
          reasonCodes: ['premium_verification_clean'],
          summary: {
            kind: 'premium_verification',
            trust: 'verified',
            suggestedConfidenceCap: 0.7,
            holdPremiumUntilFresh: false,
          },
        },
        {
          decisionId: 'c',
          surface: 'supervisor_next_step',
          publishedAt: new Date().toISOString(),
          durationMs: 30,
          degraded: false,
          ok: true,
          reasonCodes: ['supervisor_plan_clean'],
          summary: {
            kind: 'supervisor_next_step',
            nextStepType: 'rerun_writer_with_safe_fallback',
            holdAll: false,
            prioritizedActionTypes: ['rerun_writer_with_safe_fallback'],
          },
        },
      ],
    });

    const summary = deriveDecisionFeedHealth(snapshot);
    expect(summary.status).toBe('healthy');
    expect(summary.totals.coverageCount).toBe(3);
    expect(summary.totals.degradedCount).toBe(0);
  });

  it('returns degraded when hold-all and unverified premium signals accumulate', () => {
    const snapshot = makeSnapshot({
      records: [
        {
          decisionId: 'a',
          surface: 'premium_verification',
          publishedAt: new Date().toISOString(),
          durationMs: 25,
          degraded: true,
          ok: false,
          reasonCodes: ['premium_verification_unavailable'],
          summary: {
            kind: 'premium_verification',
            trust: 'unverified',
            suggestedConfidenceCap: 0.4,
            holdPremiumUntilFresh: true,
          },
        },
        {
          decisionId: 'b',
          surface: 'supervisor_next_step',
          publishedAt: new Date().toISOString(),
          durationMs: 40,
          degraded: false,
          ok: true,
          reasonCodes: ['supervisor_plan_hold_all'],
          summary: {
            kind: 'supervisor_next_step',
            nextStepType: null,
            holdAll: true,
            prioritizedActionTypes: [],
          },
        },
      ],
    });

    const summary = deriveDecisionFeedHealth(snapshot);
    expect(summary.status).toBe('degraded');
    expect(summary.totals.supervisorHoldAllCount).toBe(1);
    expect(summary.totals.premiumUnverifiedCount).toBe(1);
  });
});
