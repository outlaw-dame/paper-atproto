import { describe, expect, it } from 'vitest';
import type { MockPost } from '../../data/mockData';
import {
  buildStoryClusters,
  buildStoryClustersFromPosts,
  storyClusterInputFromMockPost,
} from './storyClustering';

function createPost(overrides: Partial<MockPost>): MockPost {
  return {
    id: overrides.id ?? 'at://did:plc:one/app.bsky.feed.post/one',
    ...(overrides.cid ? { cid: overrides.cid } : {}),
    author: {
      did: overrides.author?.did ?? 'did:plc:one',
      handle: overrides.author?.handle ?? 'one.test',
      displayName: overrides.author?.displayName ?? 'One Test',
      ...(overrides.author?.avatar ? { avatar: overrides.author.avatar } : {}),
    },
    content: overrides.content ?? 'A story post',
    ...(overrides.facets ? { facets: overrides.facets } : {}),
    createdAt: overrides.createdAt ?? new Date('2026-04-01T12:00:00.000Z').toISOString(),
    likeCount: overrides.likeCount ?? 1,
    replyCount: overrides.replyCount ?? 0,
    repostCount: overrides.repostCount ?? 0,
    bookmarkCount: overrides.bookmarkCount ?? 0,
    chips: overrides.chips ?? [],
    ...(overrides.embed ? { embed: overrides.embed } : {}),
    ...(overrides.threadRoot ? { threadRoot: overrides.threadRoot } : {}),
    ...(overrides.images ? { images: overrides.images } : {}),
    ...(overrides.media ? { media: overrides.media } : {}),
  };
}

describe('story clustering', () => {
  it('clusters posts that share an exact canonical external link', () => {
    const clusters = buildStoryClusters([
      {
        uri: 'at://did:plc:one/app.bsky.feed.post/one',
        externalUrls: ['https://www.example.com/report#section'],
        domains: ['example.com'],
      },
      {
        uri: 'at://did:plc:two/app.bsky.feed.post/two',
        externalUrls: ['https://example.com/report'],
        domains: ['example.com'],
      },
      {
        uri: 'at://did:plc:three/app.bsky.feed.post/three',
        externalUrls: ['https://example.net/other'],
        domains: ['example.net'],
      },
    ]);

    expect(clusters).toHaveLength(2);
    expect(clusters[0]?.postUris).toEqual([
      'at://did:plc:one/app.bsky.feed.post/one',
      'at://did:plc:two/app.bsky.feed.post/two',
    ]);
    expect(clusters[0]?.externalUrls).toEqual(['https://example.com/report']);
    expect(clusters[0]?.confidence).toBeGreaterThan(0.15);
  });

  it('does not cluster posts on shared domain alone', () => {
    const clusters = buildStoryClusters([
      {
        uri: 'at://did:plc:one/app.bsky.feed.post/one',
        externalUrls: ['https://example.com/report-a'],
        domains: ['example.com'],
      },
      {
        uri: 'at://did:plc:two/app.bsky.feed.post/two',
        externalUrls: ['https://example.com/report-b'],
        domains: ['example.com'],
      },
    ]);

    expect(clusters).toHaveLength(2);
    expect(clusters.map((cluster) => cluster.postUris)).toEqual([
      ['at://did:plc:one/app.bsky.feed.post/one'],
      ['at://did:plc:two/app.bsky.feed.post/two'],
    ]);
  });

  it('clusters posts that share entity identifiers without using raw text', () => {
    const clusters = buildStoryClusters([
      {
        uri: 'at://did:plc:one/app.bsky.feed.post/one',
        canonicalEntityIds: ['wikidata:Q42'],
      },
      {
        uri: 'at://did:plc:two/app.bsky.feed.post/two',
        canonicalEntityIds: ['wikidata:Q42'],
      },
    ]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.entityIds).toEqual(['wikidata:q42']);
    expect(clusters[0]?.postUris).toHaveLength(2);
  });

  it('clusters cross-protocol posts only when strong anchors match', () => {
    const clusters = buildStoryClusters([
      {
        uri: 'at://did:plc:one/app.bsky.feed.post/one',
        externalUrls: ['https://example.com/report'],
      },
      {
        uri: 'https://mastodon.example/@alice/111',
        externalUrls: ['https://example.com/report#section'],
      },
    ]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.postUris).toEqual([
      'at://did:plc:one/app.bsky.feed.post/one',
      'https://mastodon.example/@alice/111',
    ]);
  });

  it('adapts MockPost ATProto primitives into clustering signals', () => {
    const quoted = createPost({
      id: 'at://did:plc:root/app.bsky.feed.post/root',
      content: 'Quoted story root',
    });
    const post = createPost({
      id: 'at://did:plc:one/app.bsky.feed.post/one',
      facets: [
        {
          kind: 'link',
          byteStart: 0,
          byteEnd: 18,
          uri: 'https://news.example/story',
          domain: 'news.example',
        },
      ],
      embed: {
        type: 'quote',
        post: quoted,
        externalLink: {
          url: 'https://news.example/story',
          domain: 'news.example',
        },
      },
    });

    const input = storyClusterInputFromMockPost(post);
    expect(input.quotedPostUri).toBe('at://did:plc:root/app.bsky.feed.post/root');
    expect(input.externalUrls).toEqual(['https://news.example/story']);
    expect(input.domains).toEqual(['news.example']);

    const clusters = buildStoryClusters([input]);
    expect(clusters[0]?.quotedUris).toEqual(['at://did:plc:root/app.bsky.feed.post/root']);
  });

  it('builds deterministic clusters from MockPost thread roots', () => {
    const root = createPost({
      id: 'at://did:plc:root/app.bsky.feed.post/root',
      content: 'Story root',
    });
    const reply = createPost({
      id: 'at://did:plc:two/app.bsky.feed.post/two',
      threadRoot: root,
    });

    const clusters = buildStoryClustersFromPosts([root, reply]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.postUris).toEqual([
      'at://did:plc:root/app.bsky.feed.post/root',
      'at://did:plc:two/app.bsky.feed.post/two',
    ]);
    expect(clusters[0]?.confidence).toBeGreaterThan(0);
  });
});
