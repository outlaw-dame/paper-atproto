import { describe, expect, it } from 'vitest';

import {
  createHumanReviewPack,
  scoreHumanReviewPack,
} from './conversation_os_human_review_lib.mjs';

describe('conversation_os_human_review_lib', () => {
  it('creates a blank human review pack from an eval report', () => {
    const pack = createHumanReviewPack({
      fixtures: [
        {
          id: 'sparse-skeptical-claim',
          description: 'Sparse skeptical thread',
          summaryMode: 'descriptive_fallback',
          changeReasons: ['clarification'],
          writerInput: {
            topContributors: [{ handle: '@reply.one', role: 'clarifier', impactScore: 0.8 }],
            whatChangedSignals: ['clarification: asks for a source'],
            perspectiveGaps: ['The visible thread still lacks direct sourcing.'],
            factualHighlights: ['No public order is visible yet.'],
          },
          evaluation: {
            passed: 7,
            total: 8,
            weightedPassed: 10,
            weightedTotal: 12,
            checks: [
              { id: 'summary_mode_match', pass: true, detail: 'descriptive_fallback vs descriptive_fallback' },
            ],
          },
        },
      ],
    }, { reviewerId: 'editor.test' });

    expect(pack.meta.reviewerId).toBe('editor.test');
    expect(pack.reviews).toHaveLength(1);
    expect(pack.reviews[0]?.humanReview.verdicts).toHaveLength(pack.scorecard.length);
    expect(pack.reviews[0]?.systemProjection.whatChanged).toEqual(['clarification: asks for a source']);
  });

  it('scores pass, partial, and fail verdicts with weighted totals', () => {
    const pack = createHumanReviewPack({
      fixtures: [
        {
          id: 'sparse-skeptical-claim',
          description: 'Sparse skeptical thread',
          summaryMode: 'descriptive_fallback',
          changeReasons: ['clarification'],
          writerInput: {
            topContributors: [],
            whatChangedSignals: [],
            perspectiveGaps: [],
            factualHighlights: [],
          },
          evaluation: {
            passed: 0,
            total: 8,
            weightedPassed: 0,
            weightedTotal: 12,
            checks: [],
          },
        },
      ],
    });

    pack.reviews[0].humanReview.reviewerId = 'editor.test';
    pack.reviews[0].humanReview.reviewedAt = '2026-04-08T20:00:00.000Z';
    pack.reviews[0].humanReview.notes = 'Needs tighter contributor anchoring.';
    pack.reviews[0].humanReview.verdicts[0].rating = 'pass';
    pack.reviews[0].humanReview.verdicts[1].rating = 'partial';
    pack.reviews[0].humanReview.verdicts[2].rating = 'fail';

    const scored = scoreHumanReviewPack(pack);

    expect(scored.overall.raw.score).toBe(1.5);
    expect(scored.overall.completedVerdicts).toBe(3);
    expect(scored.reviews[0]?.reviewedAt).toBe('2026-04-08T20:00:00.000Z');
    expect(scored.reviews[0]?.weighted.score).toBe(2.5);
    expect(scored.reviews[0]?.completionRate).toBe(3 / pack.scorecard.length);
  });
});
