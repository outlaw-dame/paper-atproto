import { describe, expect, it } from 'vitest';
import {
  canonicalStoryIdentityFromCluster,
  detectStoryProtocol,
  generateCanonicalStoryId,
  type CanonicalStorySignals,
} from './canonicalStory';
import type { StoryCluster } from './storyClustering';

function createCluster(overrides: Partial<StoryCluster>): StoryCluster {
  return {
    id: overrides.id ?? 'cluster:one',
    rootUris: overrides.rootUris ?? ['at://did:plc:one/app.bsky.feed.post/root'],
    quotedUris: overrides.quotedUris ?? [],
    externalUrls: overrides.externalUrls ?? [],
    entityIds: overrides.entityIds ?? [],
    domains: overrides.domains ?? [],
    postUris: overrides.postUris ?? ['at://did:plc:one/app.bsky.feed.post/root'],
    confidence: overrides.confidence ?? 0.5,
  };
}

describe('canonical story identity', () => {
  it('generates stable ids independent of signal ordering', () => {
    const left: CanonicalStorySignals = {
      externalUrls: ['https://example.com/b', 'https://example.com/a'],
      entityIds: ['wikidata:q2', 'wikidata:q1'],
      quotedUris: ['at://did:plc:two/app.bsky.feed.post/two'],
      rootUris: ['at://did:plc:one/app.bsky.feed.post/one'],
    };
    const right: CanonicalStorySignals = {
      externalUrls: ['https://example.com/a', 'https://example.com/b'],
      entityIds: ['wikidata:q1', 'wikidata:q2'],
      quotedUris: ['at://did:plc:two/app.bsky.feed.post/two'],
      rootUris: ['at://did:plc:one/app.bsky.feed.post/one'],
    };

    expect(generateCanonicalStoryId(left)).toBe(generateCanonicalStoryId(right));
  });

  it('derives protocol metadata without changing cluster membership', () => {
    const identity = canonicalStoryIdentityFromCluster(createCluster({
      externalUrls: ['https://news.example/report'],
      entityIds: ['wikidata:q42'],
      postUris: [
        'at://did:plc:one/app.bsky.feed.post/one',
        'https://mastodon.example/@alice/111',
      ],
      confidence: 0.72,
    }));

    expect(identity.id).toMatch(/^story:[0-9a-f]{8}$/);
    expect(identity.protocols).toEqual(['activitypub', 'atproto']);
    expect(identity.sourceThreads).toEqual([
      'at://did:plc:one/app.bsky.feed.post/one',
      'https://mastodon.example/@alice/111',
    ]);
    expect(identity.rootSignals.externalUrls).toEqual(['https://news.example/report']);
    expect(identity.rootSignals.entityIds).toEqual(['wikidata:q42']);
    expect(identity.confidence).toBe(0.72);
  });

  it('falls back to source threads only when no root signals exist', () => {
    const left = canonicalStoryIdentityFromCluster(createCluster({
      rootUris: [],
      postUris: ['at://did:plc:one/app.bsky.feed.post/one'],
    }));
    const right = canonicalStoryIdentityFromCluster(createCluster({
      rootUris: [],
      postUris: ['at://did:plc:two/app.bsky.feed.post/two'],
    }));

    expect(left.id).not.toBe(right.id);
  });

  it('detects only protocol family from source URI shape', () => {
    expect(detectStoryProtocol('at://did:plc:one/app.bsky.feed.post/one')).toBe('atproto');
    expect(detectStoryProtocol('https://mastodon.example/@alice/111')).toBe('activitypub');
    expect(detectStoryProtocol('local:one')).toBe('unknown');
  });
});
