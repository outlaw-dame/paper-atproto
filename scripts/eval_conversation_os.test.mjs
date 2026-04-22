import { describe, expect, it } from 'vitest';

import {
  CONVERSATION_OS_EXPECTATIONS,
  evaluateConversationOsProjection,
  normalizeFixtureIds,
} from './eval_conversation_os.mjs';

describe('eval conversation os helpers', () => {
  it('normalizes fixture ids and falls back to the full set', () => {
    expect(normalizeFixtureIds('memo-closure-correction,policy-pause-with-counterpoint,memo-closure-correction')).toEqual([
      'memo-closure-correction',
      'policy-pause-with-counterpoint',
    ]);
    expect(normalizeFixtureIds('')).toEqual(Object.keys(CONVERSATION_OS_EXPECTATIONS));
  });

  it('scores a healthy substrate projection against fixture expectations', () => {
    const evaluation = evaluateConversationOsProjection(
      {
        id: 'memo-closure-correction',
        request: {
          rootPost: { handle: 'memo.author' },
        },
      },
      {
        pipeline: {
          summaryMode: 'normal',
          deltaDecision: {
            changeReasons: ['source_backed_clarification'],
          },
        },
        writerInput: {
          safeEntities: [
            { label: '@memo.author' },
            { label: '@source.one' },
            { label: '@clarify.two' },
          ],
          topContributors: [
            { handle: '@source.one' },
            { handle: '@clarify.two' },
          ],
          whatChangedSignals: [
            'source cited: building notice posted',
            'clarification: access restrictions may be narrower than a closure',
          ],
          threadSignalSummary: {
            sourceBackedCount: 1,
            clarificationsCount: 1,
          },
          factualHighlights: ['A memo header and building notice were posted.'],
          perspectiveGaps: [],
        },
      },
    );

    expect(evaluation.passed).toBe(evaluation.total);
    expect(evaluation.weightedPassed).toBe(evaluation.weightedTotal);
  });
});
