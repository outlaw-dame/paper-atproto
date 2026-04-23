export type DiscoveryPresentationMode = 'glanceable' | 'descriptive' | 'narrative';

export interface DiscoveryPresentationPolicyInput {
  clusterConfidence: number;
  clusterSize: 'single' | 'small' | 'medium' | 'large';
  coverageGapMagnitude: number;
  userPreference?: 'auto' | 'always_glanceable' | 'always_narrative';
  surface?: 'explore_home' | 'search_results' | 'topic_page' | 'feed_detail';
}

export function selectDiscoveryPresentationMode(
  input: DiscoveryPresentationPolicyInput,
): DiscoveryPresentationMode {
  if (input.userPreference === 'always_glanceable') return 'glanceable';
  if (input.userPreference === 'always_narrative') return 'narrative';

  const confidence = clamp01(input.clusterConfidence);
  const coverageGap = clamp01(input.coverageGapMagnitude);
  const conservativeSurface = input.surface === 'search_results';

  let mode: DiscoveryPresentationMode;
  if (input.clusterSize === 'single') {
    mode = 'glanceable';
  } else if (confidence >= 0.7) {
    mode = coverageGap >= 0.5 ? 'descriptive' : 'narrative';
  } else if (confidence >= 0.4) {
    mode = 'descriptive';
  } else {
    mode = 'glanceable';
  }

  if (coverageGap >= 0.65) {
    mode = demote(mode);
  }

  if (conservativeSurface && mode === 'narrative') {
    mode = 'descriptive';
  }

  return mode;
}

function demote(mode: DiscoveryPresentationMode): DiscoveryPresentationMode {
  if (mode === 'narrative') return 'descriptive';
  if (mode === 'descriptive') return 'glanceable';
  return 'glanceable';
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
