import { describe, expect, it } from 'vitest';
import {
  LOCAL_PERSONALIZATION_STORAGE_KEY,
  computeLocalPersonalizationAdjustment,
  computeLocallyPersonalizedRankingScore,
  createLocalPersonalizationProfile,
  loadLocalPersonalizationProfile,
  resetLocalPersonalizationProfile,
  saveLocalPersonalizationProfile,
  updateLocalPersonalizationProfile,
  type LocalPersonalizationStorage,
} from './localPersonalization';

describe('local personalization', () => {
  it('persists only local preference weights and controls', () => {
    const storage = createMemoryStorage();
    const profile = createLocalPersonalizationProfile({
      depth: 0.8,
      breadth: 0.7,
      recency: 0.2,
      sampleCount: 4,
      updatedAt: '2026-04-23T12:00:00.000Z',
    });

    expect(saveLocalPersonalizationProfile(profile, storage)).toBe(true);

    const raw = storage.getItem(LOCAL_PERSONALIZATION_STORAGE_KEY);
    const parsed = JSON.parse(raw ?? '{}') as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual([
      'breadth',
      'depth',
      'enabled',
      'recency',
      'sampleCount',
      'schemaVersion',
      'updatedAt',
    ]);
    expect(raw).not.toMatch(/did:|at:\/\/|https?:|left|right|ideolog|partisan|political/i);
    expect(loadLocalPersonalizationProfile(storage)).toEqual(profile);
  });

  it('can be disabled and reset without remote state', () => {
    const storage = createMemoryStorage();
    const disabled = createLocalPersonalizationProfile({ enabled: false, depth: 1 });
    saveLocalPersonalizationProfile(disabled, storage);

    const adjustment = computeLocalPersonalizationAdjustment({
      profile: loadLocalPersonalizationProfile(storage),
      contentSignals: { depth: 1, breadth: 1, recency: 1 },
      interpretiveConfidence: 1,
    });
    const reset = resetLocalPersonalizationProfile(storage);

    expect(adjustment.adjustment).toBe(0);
    expect(adjustment.enabled).toBe(false);
    expect(storage.getItem(LOCAL_PERSONALIZATION_STORAGE_KEY)).toBeNull();
    expect(reset).toEqual(createLocalPersonalizationProfile());
  });

  it('bounds local personalization by interpretive confidence', () => {
    const profile = createLocalPersonalizationProfile({
      depth: 1,
      breadth: 1,
      recency: 1,
      sampleCount: 20,
    });
    const adjustment = computeLocalPersonalizationAdjustment({
      profile,
      contentSignals: { depth: 1, breadth: 1, recency: 1 },
      interpretiveConfidence: 0.35,
    });

    expect(adjustment.adjustment).toBeLessThanOrEqual(adjustment.maxInfluence);
    expect(adjustment.maxInfluence).toBeCloseTo(0.035);
    expect(adjustment.dimensions).toEqual({
      depth: 'high',
      breadth: 'high',
      recency: 'high',
    });
  });

  it('learns from local interactions while weak content has smaller effect', () => {
    const base = createLocalPersonalizationProfile({ depth: 0.5, breadth: 0.5, recency: 0.5 });
    const highConfidenceUpdate = updateLocalPersonalizationProfile({
      profile: base,
      signal: 'expand',
      contentSignals: { depth: 1, breadth: 0.8, recency: 0.2 },
      interpretiveConfidence: 0.9,
      now: '2026-04-23T12:00:00.000Z',
    });
    const weakConfidenceUpdate = updateLocalPersonalizationProfile({
      profile: base,
      signal: 'expand',
      contentSignals: { depth: 1, breadth: 0.8, recency: 0.2 },
      interpretiveConfidence: 0.1,
      now: '2026-04-23T12:00:00.000Z',
    });

    expect(highConfidenceUpdate.depth - base.depth).toBeGreaterThan(weakConfidenceUpdate.depth - base.depth);
    expect(highConfidenceUpdate.sampleCount).toBe(1);
    expect(weakConfidenceUpdate.sampleCount).toBe(1);
  });

  it('keeps local personalization secondary to interpretive quality', () => {
    const depthPreference = createLocalPersonalizationProfile({
      depth: 1,
      breadth: 1,
      recency: 1,
      sampleCount: 30,
    });
    const highQualityPoorFit = computeLocallyPersonalizedRankingScore({
      interpretiveConfidence: 0.72,
      recency: 0.5,
      engagement: 0,
      coverageGap: 0.1,
      diversityScore: 0.9,
      personalization: depthPreference,
      contentSignals: { depth: 0, breadth: 0, recency: 0 },
    });
    const lowQualityStrongFit = computeLocallyPersonalizedRankingScore({
      interpretiveConfidence: 0.36,
      recency: 0.5,
      engagement: 1,
      coverageGap: 0.1,
      diversityScore: 0.9,
      personalization: depthPreference,
      contentSignals: { depth: 1, breadth: 1, recency: 1 },
    });

    expect(highQualityPoorFit.score).toBeGreaterThan(lowQualityStrongFit.score);
    expect(Math.abs(lowQualityStrongFit.personalization.adjustment)).toBeLessThanOrEqual(
      lowQualityStrongFit.personalization.maxInfluence,
    );
  });
});

function createMemoryStorage(): LocalPersonalizationStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}
