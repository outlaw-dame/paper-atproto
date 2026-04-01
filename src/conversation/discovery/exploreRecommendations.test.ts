import { describe, expect, it } from 'vitest';
import type { AppBskyActorDefs } from '@atproto/api';
import type { ExploreSuggestedActorRecommendation } from './exploreDiscovery';
import {
  filterVisibleSuggestedActorRecommendations,
  resolveVisibleSuggestedActors,
  sanitizeDismissedDid,
} from './exploreRecommendations';

function createActor(overrides: Partial<AppBskyActorDefs.ProfileView>): AppBskyActorDefs.ProfileView {
  return {
    did: 'did:plc:default',
    handle: 'default.test',
    ...overrides,
  } as AppBskyActorDefs.ProfileView;
}

function createRecommendation(
  actor: AppBskyActorDefs.ProfileView,
  overrides: Partial<ExploreSuggestedActorRecommendation> = {},
): ExploreSuggestedActorRecommendation {
  return {
    actor,
    score: 1,
    confidence: 0.8,
    reasons: ['Topic match'],
    semanticMatch: true,
    graphMatch: false,
    serverMatch: false,
    ...overrides,
  };
}

describe('exploreRecommendations', () => {
  it('sanitizes dismissed did values conservatively', () => {
    expect(sanitizeDismissedDid('  DID:PLC:ABC\u0000 ')).toBe('did:plc:abc');
  });

  it('filters dismissed recommendations by did', () => {
    const kept = createRecommendation(createActor({ did: 'did:plc:keep', handle: 'keep.test' }));
    const dismissed = createRecommendation(createActor({ did: 'did:plc:dismiss', handle: 'dismiss.test' }));

    const result = filterVisibleSuggestedActorRecommendations(
      [kept, dismissed],
      new Set(['did:plc:dismiss']),
    );

    expect(result).toEqual([kept]);
  });

  it('prefers recommendation-backed actors when visible recommendations exist', () => {
    const recommendedActor = createActor({ did: 'did:plc:recommended', handle: 'recommended.test' });
    const plainActor = createActor({ did: 'did:plc:plain', handle: 'plain.test' });

    const result = resolveVisibleSuggestedActors({
      suggestedActors: [plainActor],
      suggestedActorRecommendations: [createRecommendation(recommendedActor)],
      dismissedSuggestedActorDids: new Set<string>(),
    });

    expect(result).toEqual([recommendedActor]);
  });

  it('falls back to filtered suggested actors when all recommendations are dismissed', () => {
    const keptActor = createActor({ did: 'did:plc:keep', handle: 'keep.test' });
    const dismissedActor = createActor({ did: 'did:plc:dismiss', handle: 'dismiss.test' });

    const result = resolveVisibleSuggestedActors({
      suggestedActors: [keptActor, dismissedActor],
      suggestedActorRecommendations: [createRecommendation(dismissedActor)],
      dismissedSuggestedActorDids: new Set(['did:plc:dismiss']),
    });

    expect(result).toEqual([keptActor]);
  });
});
