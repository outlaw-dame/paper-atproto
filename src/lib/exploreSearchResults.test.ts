import { describe, expect, it } from 'vitest';
import {
  getLocalHybridPostUri,
  mapFeedRowToExploreFeedResult,
  mapHybridPostRowToMockPost,
  resolveExploreSearchResults,
  type ExploreFeedResult,
} from './exploreSearchResults';
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
  it('prefers canonical local post uris and preserves image embeds from local rows', () => {
    const mapped = mapHybridPostRowToMockPost({
      id: 'bafy-local-cid',
      uri: 'at://did:plc:local/app.bsky.feed.post/abc',
      author_did: 'did:plc:local',
      content: 'Look at this chart',
      created_at: '2026-04-01T12:00:00.000Z',
      embed: JSON.stringify({
        $type: 'app.bsky.embed.recordWithMedia',
        record: { uri: 'at://did:plc:quoted/app.bsky.feed.post/xyz' },
        media: {
          images: [
            {
              image: {
                ref: { $link: 'bafkreiimagecid' },
              },
              alt: 'Quarterly growth chart',
              aspectRatio: { width: 16, height: 9 },
            },
          ],
        },
      }),
      has_link: 1,
    });

    expect(mapped.id).toBe('at://did:plc:local/app.bsky.feed.post/abc');
    expect(mapped.cid).toBe('bafy-local-cid');
    expect(mapped.media?.[0]).toMatchObject({
      type: 'image',
      alt: 'Quarterly growth chart',
      aspectRatio: 16 / 9,
    });
    expect(mapped.media?.[0]?.url).toContain('bafkreiimagecid');
    expect(getLocalHybridPostUri({
      id: 'bafy-local-cid',
      uri: 'at://did:plc:local/app.bsky.feed.post/abc',
    })).toBe('at://did:plc:local/app.bsky.feed.post/abc');
  });

  it('builds richer local quote previews when sync stored resolved embed metadata', () => {
    const mapped = mapHybridPostRowToMockPost({
      id: 'bafy-quoted-parent',
      uri: 'at://did:plc:local/app.bsky.feed.post/with-quote',
      author_did: 'did:plc:local',
      content: 'This quote matters',
      created_at: '2026-04-01T12:00:00.000Z',
      embed: JSON.stringify({
        $type: 'app.bsky.embed.record',
        record: { uri: 'at://did:plc:quoted/app.bsky.feed.post/xyz' },
        _preview: {
          kind: 'record',
          quotedUri: 'at://did:plc:quoted/app.bsky.feed.post/xyz',
          quotedAuthorDid: 'did:plc:quoted',
          quotedAuthorHandle: 'quoted.bsky.social',
          quotedAuthorDisplayName: 'Quoted Person',
          quotedText: 'Quoted preview text',
          quotedExternal: {
            uri: 'https://example.com/context',
            domain: 'example.com',
            title: 'Context Link',
            description: 'Extra context',
          },
        },
      }),
      has_link: 1,
    });

    expect(mapped.embed?.type).toBe('quote');
    if (mapped.embed?.type === 'quote') {
      expect(mapped.embed.post.author.handle).toBe('quoted.bsky.social');
      expect(mapped.embed.post.content).toBe('Quoted preview text');
      expect(mapped.embed.post.embed?.type).toBe('external');
    }
  });

  it('restores richer local video previews from stored resolved embed metadata', () => {
    const mapped = mapHybridPostRowToMockPost({
      id: 'bafy-video-parent',
      uri: 'at://did:plc:local/app.bsky.feed.post/with-video',
      author_did: 'did:plc:local',
      content: 'Watch this clip',
      created_at: '2026-04-01T12:00:00.000Z',
      embed: JSON.stringify({
        $type: 'app.bsky.embed.recordWithMedia',
        record: { uri: 'at://did:plc:quoted/app.bsky.feed.post/xyz' },
        media: {
          $type: 'app.bsky.embed.video',
          video: { ref: { $link: 'bafkreivideocid' } },
        },
        _preview: {
          kind: 'recordWithMedia',
          quotedUri: 'at://did:plc:quoted/app.bsky.feed.post/xyz',
          mediaVideo: {
            uri: 'https://video.bsky.app/watch/playlist.m3u8',
            domain: 'video.bsky.app',
            thumb: 'https://video.bsky.app/thumb.jpg',
            alt: 'Launch clip',
            aspectRatio: { width: 9, height: 16 },
          },
        },
      }),
    });

    expect(mapped.embed?.type).toBe('quote');
    if (mapped.embed?.type === 'quote') {
      expect(mapped.embed.post.content).toBe('Quoted post preview unavailable offline.');
      expect(mapped.embed.post.embed?.type).toBe('video');
      if (mapped.embed.post.embed?.type === 'video') {
        expect(mapped.embed.post.embed.url).toBe('https://video.bsky.app/watch/playlist.m3u8');
        expect(mapped.embed.post.embed.thumb).toBe('https://video.bsky.app/thumb.jpg');
        expect(mapped.embed.post.embed.aspectRatio).toBe(9 / 16);
      }
    }
  });

  it('drops unsafe preview urls from stored local embed metadata', () => {
    const mapped = mapHybridPostRowToMockPost({
      id: 'bafy-unsafe-preview',
      uri: 'at://did:plc:local/app.bsky.feed.post/unsafe',
      author_did: 'did:plc:local',
      content: 'Unsafe preview should not render',
      created_at: '2026-04-01T12:00:00.000Z',
      embed: JSON.stringify({
        $type: 'app.bsky.embed.record',
        record: { uri: 'at://did:plc:quoted/app.bsky.feed.post/xyz' },
        _preview: {
          kind: 'record',
          quotedUri: 'at://did:plc:quoted/app.bsky.feed.post/xyz',
          quotedText: 'Quoted preview text',
          quotedExternal: {
            uri: 'javascript:alert(1)',
            domain: 'evil.invalid',
            title: 'Bad link',
          },
        },
      }),
    });

    expect(mapped.embed?.type).toBe('quote');
    if (mapped.embed?.type === 'quote') {
      expect(mapped.embed.post.embed).toBeUndefined();
      expect(mapped.embed.externalLink).toBeUndefined();
    }
  });

  it('prefers fused feed scores when post-processing adjusted local ranking', () => {
    const mapped = mapFeedRowToExploreFeedResult({
      id: 'feed-1',
      title: 'Visual podcast',
      link: 'https://example.com/episode',
      rrf_score: 0.4,
      fused_score: 0.58,
    });

    expect(mapped.score).toBe(0.58);
  });

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
            { uri: 'at://did:plc:remote/app.bsky.feed.post/a', record: { text: 'remote a' } },
            { uri: 'at://did:plc:shared/app.bsky.feed.post/shared', record: { text: 'shared from remote' } },
          ],
        },
      },
      tagPostsRes: {
        data: {
          posts: [
            { uri: 'at://did:plc:tag/app.bsky.feed.post/tag-a', record: { text: 'tag a' } },
            { uri: 'at://did:plc:shared/app.bsky.feed.post/shared', record: { text: 'shared from tag' } },
          ],
        },
      },
      localHybridPostRows: [
        { id: 'bafy-local-a', uri: 'at://did:plc:local/app.bsky.feed.post/local-a', content: 'local a' },
        { id: 'bafy-remote-a', uri: 'at://did:plc:remote/app.bsky.feed.post/a', content: 'duplicate of remote' },
      ],
      actorsRes: null,
      feedRes: null,
      podcastIndexFeeds: null,
      hasDisplayableRecordContent: (record) => Boolean((record as any)?.text),
      mapPost: (postView) => makeMockPost(postView.uri),
      mapLocalHybridPost: (row) => makeMockPost(row.uri ?? row.id),
      mapFeedRow: () => ({ id: 'unused', title: 'unused', link: 'https://unused' }),
      mapPodcastFeed: () => ({ id: 'unused', title: 'unused', link: 'https://unused' }),
    });

    expect(result.posts.map((p) => p.id)).toEqual([
      'at://did:plc:remote/app.bsky.feed.post/a',
      'at://did:plc:shared/app.bsky.feed.post/shared',
      'at://did:plc:tag/app.bsky.feed.post/tag-a',
      'at://did:plc:local/app.bsky.feed.post/local-a',
    ]);
  });

  it('blends strong local hybrid posts ahead of weaker lower-ranked remote results', () => {
    const result = resolveExploreSearchResults({
      postsRes: {
        data: {
          posts: [
            { uri: 'at://did:plc:remote/app.bsky.feed.post/top', record: { text: 'remote top' } },
            { uri: 'at://did:plc:remote/app.bsky.feed.post/lower', record: { text: 'remote lower' } },
          ],
        },
      },
      tagPostsRes: null,
      localHybridPostRows: [
        {
          id: 'bafy-local-hero',
          uri: 'at://did:plc:local/app.bsky.feed.post/hero',
          content: 'local hero',
          fused_score: 0.72,
          confidence_score: 0.94,
        },
      ],
      actorsRes: null,
      feedRes: null,
      podcastIndexFeeds: null,
      hasDisplayableRecordContent: (record) => Boolean((record as any)?.text),
      mapPost: (postView) => makeMockPost(postView.uri),
      mapLocalHybridPost: mapHybridPostRowToMockPost,
      mapFeedRow: () => ({ id: 'unused', title: 'unused', link: 'https://unused' }),
      mapPodcastFeed: () => ({ id: 'unused', title: 'unused', link: 'https://unused' }),
    });

    expect(result.posts.map((post) => post.id)).toEqual([
      'at://did:plc:remote/app.bsky.feed.post/top',
      'at://did:plc:local/app.bsky.feed.post/hero',
      'at://did:plc:remote/app.bsky.feed.post/lower',
    ]);
  });
});
