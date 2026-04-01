import { describe, expect, it } from 'vitest';
import { resolveExploreSearchResults, type ExploreFeedResult } from './exploreSearchResults';
import type { MockPost } from '../data/mockData';

function makeMockPost(id: string): MockPost {
  return {
    id,
    cid: `cid-${id}`,
    content: `post ${id}`,
    createdAt: new Date().toISOString(),
    timestamp: new Date().toISOString(),
    author: {
      did: 'did:plc:test',
      handle: 'tester.bsky.social',
      displayName: 'Tester',
    },
    repostCount: 0,
    replyCount: 0,
    likeCount: 0,
    bookmarkCount: 0,
    chips: [],
  };
}

describe('resolveExploreSearchResults', () => {
  it('maps posts, actors, and deduped feed items from successful payloads', () => {
    const postsRes = {
      data: {
        posts: [
          { uri: 'at://post/1', record: { text: 'one' } },
          { uri: 'at://post/2', record: { text: '' } },
        ],
      },
    };
    const actorsRes = {
      data: {
        actors: [{ did: 'did:plc:a', handle: 'a.bsky.social', displayName: 'A' }],
      },
    };
    const feedRes = {
      rows: [
        { id: 'local-1', title: 'Local', link: 'https://example.com/one' },
        { id: 'local-2', title: 'Dup', link: 'https://example.com/dup' },
      ],
    };
    const podcast = [
      { id: 'pod-1', title: 'Pod', url: 'https://example.com/dup' },
      { id: 'pod-2', title: 'Pod2', url: 'https://example.com/two' },
    ];

    const result = resolveExploreSearchResults({
      postsRes,
      actorsRes,
      feedRes,
      podcastIndexFeeds: podcast,
      hasDisplayableRecordContent: (record) => Boolean((record as any)?.text),
      mapPost: (postView) => makeMockPost(postView.uri),
      mapFeedRow: (row): ExploreFeedResult => ({
        id: row.id,
        title: row.title,
        link: row.link,
        source: 'local',
      }),
      mapPodcastFeed: (feed): ExploreFeedResult => ({
        id: feed.id,
        title: feed.title,
        link: feed.url,
        source: 'podcast-index',
      }),
    });

    expect(result.posts.map((p) => p.id)).toEqual(['at://post/1']);
    expect(result.actors).toHaveLength(1);
    expect(result.feedItems.map((i) => i.link)).toEqual([
      'https://example.com/one',
      'https://example.com/dup',
      'https://example.com/two',
    ]);
  });

  it('returns empty arrays for empty or failed payloads', () => {
    const result = resolveExploreSearchResults({
      postsRes: null,
      actorsRes: null,
      feedRes: null,
      podcastIndexFeeds: null,
      hasDisplayableRecordContent: () => true,
      mapPost: () => makeMockPost('unused'),
      mapFeedRow: () => ({ id: 'unused', title: 'unused', link: 'https://unused' }),
      mapPodcastFeed: () => ({ id: 'unused', title: 'unused', link: 'https://unused' }),
    });

    expect(result.posts).toEqual([]);
    expect(result.actors).toEqual([]);
    expect(result.feedItems).toEqual([]);
  });

  it('merges remote, tag, and local hybrid posts with stable dedupe', () => {
    const result = resolveExploreSearchResults({
      postsRes: {
        data: {
          posts: [
            { uri: 'remote-a', record: { text: 'remote a' } },
            { uri: 'shared', record: { text: 'shared from remote' } },
          ],
        },
      },
      tagPostsRes: {
        data: {
          posts: [
            { uri: 'tag-a', record: { text: 'tag a' } },
            { uri: 'shared', record: { text: 'shared from tag' } },
          ],
        },
      },
      localHybridPostRows: [
        { id: 'local-a', content: 'local a' },
        { id: 'remote-a', content: 'duplicate of remote' },
      ],
      actorsRes: null,
      feedRes: null,
      podcastIndexFeeds: null,
      hasDisplayableRecordContent: (record) => Boolean((record as any)?.text),
      mapPost: (postView) => makeMockPost(postView.uri),
      mapLocalHybridPost: (row) => makeMockPost(row.id),
      mapFeedRow: () => ({ id: 'unused', title: 'unused', link: 'https://unused' }),
      mapPodcastFeed: () => ({ id: 'unused', title: 'unused', link: 'https://unused' }),
    });

    expect(result.posts.map((p) => p.id)).toEqual([
      'remote-a',
      'shared',
      'tag-a',
      'local-a',
    ]);
  });
});
