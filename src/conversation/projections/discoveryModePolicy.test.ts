import { describe, expect, it } from 'vitest';

import { selectDiscoveryPresentationMode } from './discoveryModePolicy';

describe('selectDiscoveryPresentationMode', () => {
  it('keeps single or low-confidence clusters glanceable', () => {
    expect(selectDiscoveryPresentationMode({
      clusterConfidence: 0.9,
      clusterSize: 'single',
      coverageGapMagnitude: 0,
    })).toBe('glanceable');

    expect(selectDiscoveryPresentationMode({
      clusterConfidence: 0.25,
      clusterSize: 'medium',
      coverageGapMagnitude: 0,
    })).toBe('glanceable');
  });

  it('selects narrative only for confident low-gap clusters and demotes conservative surfaces', () => {
    expect(selectDiscoveryPresentationMode({
      clusterConfidence: 0.82,
      clusterSize: 'medium',
      coverageGapMagnitude: 0.1,
      surface: 'explore_home',
    })).toBe('narrative');

    expect(selectDiscoveryPresentationMode({
      clusterConfidence: 0.82,
      clusterSize: 'medium',
      coverageGapMagnitude: 0.1,
      surface: 'search_results',
    })).toBe('descriptive');
  });

  it('lets user preference override automatic mode selection', () => {
    expect(selectDiscoveryPresentationMode({
      clusterConfidence: 0.2,
      clusterSize: 'large',
      coverageGapMagnitude: 0.9,
      userPreference: 'always_narrative',
    })).toBe('narrative');

    expect(selectDiscoveryPresentationMode({
      clusterConfidence: 0.95,
      clusterSize: 'large',
      coverageGapMagnitude: 0,
      userPreference: 'always_glanceable',
    })).toBe('glanceable');
  });
});
