import { beforeEach, describe, expect, it } from 'vitest';
import {
  getRecommendationTelemetrySnapshot,
  recordRecommendationAction,
  recordRecommendationImpression,
  resetRecommendationTelemetryForTests,
} from './recommendationTelemetry';

describe('recommendationTelemetry', () => {
  beforeEach(() => {
    resetRecommendationTelemetryForTests();
  });

  it('tracks impressions, follows, and dismisses with reason counts', () => {
    recordRecommendationImpression({
      actorDid: 'did:plc:one',
      confidence: 0.84,
      reasons: ['Topic match', 'Similar follows'],
      source: 'explore-suggested-accounts',
    });
    recordRecommendationImpression({
      actorDid: 'did:plc:two',
      confidence: 0.31,
      reasons: ['Topic match'],
      source: 'explore-suggested-accounts',
    });

    recordRecommendationAction('follow', {
      actorDid: 'did:plc:one',
      confidence: 0.84,
      reasons: ['Topic match'],
      source: 'explore-suggested-accounts',
    });
    recordRecommendationAction('dismiss', {
      actorDid: 'did:plc:two',
      confidence: 0.31,
      reasons: ['Topic match'],
      source: 'explore-suggested-accounts',
    });

    const snapshot = getRecommendationTelemetrySnapshot();

    expect(snapshot.impressionCount).toBe(2);
    expect(snapshot.followCount).toBe(1);
    expect(snapshot.dismissCount).toBe(1);
    expect(snapshot.followConversionRate).toBe(0.5);
    expect(snapshot.dismissRate).toBe(0.5);
    expect(snapshot.reasonImpressions['Topic match']).toBe(2);
    expect(snapshot.reasonImpressions['Similar follows']).toBe(1);
    expect(snapshot.reasonFollows['Topic match']).toBe(1);
    expect(snapshot.reasonDismisses['Topic match']).toBe(1);
    expect(snapshot.confidenceBuckets.find((row) => row.bucket === '80-100')?.impressions).toBe(1);
    expect(snapshot.confidenceBuckets.find((row) => row.bucket === '20-40')?.dismisses).toBe(1);
  });

  it('deduplicates impressions per actor/source', () => {
    recordRecommendationImpression({
      actorDid: 'did:plc:one',
      confidence: 0.72,
      reasons: ['Topic match'],
      source: 'explore-suggested-accounts',
    });
    recordRecommendationImpression({
      actorDid: 'did:plc:one',
      confidence: 0.72,
      reasons: ['Topic match'],
      source: 'explore-suggested-accounts',
    });

    const snapshot = getRecommendationTelemetrySnapshot();
    expect(snapshot.impressionCount).toBe(1);
  });
});
