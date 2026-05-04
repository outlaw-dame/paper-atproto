import { describe, expect, it } from 'vitest';
import { evaluateConversationOsProjection } from './conversationOsEval';
import { CONVERSATION_OS_FIXTURES, CONVERSATION_OS_SCORECARD } from './conversationOsFixtures';

describe('conversation OS scorecard extension', () => {
  it('publishes the extended rubric IDs with unique entries', () => {
    const ids = CONVERSATION_OS_SCORECARD.map((item) => item.id);
    expect(ids).toContain('confidence_mode_coherence');
    expect(ids).toContain('contributor_signal_diversity');
    expect(ids).toContain('evidence_to_signal_alignment');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('emits extension checks in automated evaluation output', () => {
    const fixture = CONVERSATION_OS_FIXTURES[0];
    const projection = {
      pipeline: {
        summaryMode: fixture.expectations.summaryMode,
        deltaDecision: {
          changeReasons: ['source cited: primary memo'],
        },
      },
      writerInput: {
        safeEntities: [
          { label: `@${fixture.request.rootPost.handle}` },
        ],
        topContributors: fixture.request.topContributors.map((entry) => ({
          handle: entry.handle,
          role: entry.role,
        })),
        whatChangedSignals: fixture.request.whatChangedSignals,
        perspectiveGaps: ['follow-up needed on enforcement scope'],
        factualHighlights: fixture.request.factualHighlights,
        threadSignalSummary: {
          sourceBackedCount: fixture.expectations.minSourceBackedCount,
          clarificationsCount: fixture.expectations.minClarificationsCount,
        },
      },
    };

    const result = evaluateConversationOsProjection(fixture, projection);
    const checkIds = result.checks.map((check) => check.id);

    expect(checkIds).toContain('confidence_mode_coherence');
    expect(checkIds).toContain('contributor_signal_diversity');
    expect(checkIds).toContain('evidence_to_signal_alignment');
    expect(result.weightedTotal).toBeGreaterThan(result.total);
  });
});
