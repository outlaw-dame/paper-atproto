import { describe, expect, it } from 'vitest';
import {
  ETHICAL_RANKING_POLICY,
  clampEngagementEffect,
  computeBaseRankingScore,
  computeEngagementScore,
  computeEthicalRankingScore,
  createRankingFeedbackState,
  recordRankingImpression,
  recordRankingInteraction,
} from './ethicalRanking';

describe('ethical ranking', () => {
  it('bounds adaptive engagement by interpretive confidence', () => {
    for (const confidence of [0, 0.1, 0.5, 1]) {
      const positiveEffect = clampEngagementEffect(1, confidence);
      const negativeEffect = clampEngagementEffect(0, confidence);
      const maxInfluence = ETHICAL_RANKING_POLICY.maxEngagementInfluenceRate * confidence;

      expect(Math.abs(positiveEffect)).toBeLessThanOrEqual(maxInfluence + Number.EPSILON);
      expect(Math.abs(negativeEffect)).toBeLessThanOrEqual(maxInfluence + Number.EPSILON);
    }
  });

  it('does not let engagement dominate comparable interpretive quality', () => {
    const highConfidenceLowEngagement = computeEthicalRankingScore({
      interpretiveConfidence: 0.72,
      recency: 0.5,
      engagement: 0,
      coverageGap: 0.1,
      diversityScore: 0.9,
    });
    const lowConfidenceHighEngagement = computeEthicalRankingScore({
      interpretiveConfidence: 0.36,
      recency: 0.5,
      engagement: 1,
      coverageGap: 0.1,
      diversityScore: 0.9,
    });

    expect(highConfidenceLowEngagement.score).toBeGreaterThan(lowConfidenceHighEngagement.score);
    expect(lowConfidenceHighEngagement.explanation.engagementEffect).toBeCloseTo(
      ETHICAL_RANKING_POLICY.maxEngagementInfluenceRate * 0.36,
    );
    expect(highConfidenceLowEngagement.explanation.interpretiveContribution).toBeGreaterThan(
      lowConfidenceHighEngagement.explanation.interpretiveContribution,
    );
  });

  it('keeps engagement as ranking-only evidence and never changes confidence', () => {
    const input = {
      interpretiveConfidence: 0.44,
      recency: 0.5,
      engagement: 1,
      coverageGap: 0.1,
      diversityScore: 0.9,
    };
    const result = computeEthicalRankingScore(input);

    expect(result.explanation.interpretiveContribution).toBeCloseTo(
      ETHICAL_RANKING_POLICY.interpretiveWeight * input.interpretiveConfidence,
    );
    expect(input.interpretiveConfidence).toBe(0.44);
    expect(result.explanation).not.toHaveProperty('interpretiveConfidence');
  });

  it('applies structural guardrails for coverage gaps, low diversity, and weak confidence', () => {
    const base = computeBaseRankingScore({
      interpretiveConfidence: 0.35,
      recency: 1,
      engagement: 1,
    });
    const guarded = computeEthicalRankingScore({
      interpretiveConfidence: 0.35,
      recency: 1,
      engagement: 1,
      coverageGap: 0.75,
      diversityScore: 0.2,
    });

    expect(guarded.score).toBeLessThan(base.score);
    expect(guarded.explanation.appliedGuardrails).toEqual([
      'low_diversity',
      'coverage_gap',
      'confidence_floor',
    ]);
    expect(guarded.explanation.diversityAdjustment).toBeLessThan(0);
    expect(guarded.explanation.coverageGapAdjustment).toBeLessThan(0);
    expect(guarded.explanation.confidenceFloorAdjustment).toBeLessThan(0);
  });

  it('records only explicit, stateless ranking feedback signals', () => {
    const initial = createRankingFeedbackState();
    const withImpression = recordRankingImpression(initial);
    const withExpand = recordRankingInteraction(withImpression, 'expand');
    const withDwell = recordRankingInteraction(withExpand, 'dwell', { dwellSeconds: 12.5 });
    const final = recordRankingInteraction(withDwell, 'skip');

    expect(initial).toEqual({
      impressions: 0,
      expansions: 0,
      dwellSeconds: 0,
      skips: 0,
    });
    expect(final).toEqual({
      impressions: 1,
      expansions: 1,
      dwellSeconds: 12.5,
      skips: 1,
    });
    expect(Object.keys(final).sort()).toEqual([
      'dwellSeconds',
      'expansions',
      'impressions',
      'skips',
    ]);
  });

  it('scores expand and dwell feedback above skip-heavy feedback', () => {
    const positive = createRankingFeedbackState({
      impressions: 4,
      expansions: 3,
      dwellSeconds: 32,
      skips: 0,
    });
    const skipped = createRankingFeedbackState({
      impressions: 4,
      expansions: 0,
      dwellSeconds: 0,
      skips: 3,
    });

    expect(computeEngagementScore(positive)).toBeGreaterThan(0.8);
    expect(computeEngagementScore(skipped)).toBeLessThan(0.2);
  });
});
