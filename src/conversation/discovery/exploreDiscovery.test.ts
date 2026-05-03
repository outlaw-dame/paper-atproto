import { describe, expect, it, vi } from 'vitest';
import type { MockPost } from '../../data/mockData';

vi.mock('../../feeds', () => ({
  feedService: {
    getRecentFeedItems: vi.fn(),
  },
}));

import {
  buildExploreDiscoverState,
  collectTrendingTopicQueries,
  getPrimaryPostText,
  rankSuggestedFeeds,
} from './exploreDiscovery';

function makePost(id: string, options?: {
  articleBody?: string;
  external?: boolean;
  likes?: number;
  replies?: number;
  reposts?: number;
  content?: string;
}): MockPost {
  return {
    id,
    cid: `cid-${id}`,
    content: options?.content ?? `content ${id}`,
    createdAt: '2026-03-31T00:00:00.000Z',
    timestamp: '2026-03-31T00:00:00.000Z',
    author: {
      did: 'did:plc:test',
      handle: 'tester.bsky.social',
      displayName: 'Tester',
    },
    likeCount: options?.likes ?? 0,
    replyCount: options?.replies ?? 0,
    repostCount: options?.reposts ?? 0,
    bookmarkCount: 0,
    chips: [],
    ...(options?.external ? {
      embed: {
        type: 'external' as const,
        url: `https://example.com/${id}`,
        title: `Title ${id}`,
        description: `Description ${id}`,
        domain: 'example.com',
      },
    } : {}),
    ...(options?.articleBody ? {
      article: {
        title: `Article ${id}`,
        body: options.articleBody,
      },
    } : {}),
  };
}

describe('exploreDiscovery helpers', () => {
  it('sanitizes, normalizes, dedupes, and limits trending topic queries', () => {
    expect(collectTrendingTopicQueries([
      { topic: '  #AI  ' },
      { tag: 'AI' },
      { topic: 'policy\u0000watch' },
      { topic: '' },
      { topic: 'x'.repeat(200) },
    ], 3)).toEqual([
      'AI',
      'policy watch',
      'x'.repeat(80),
    ]);
  });

  it('uses article body as the primary post text when available', () => {
    expect(getPrimaryPostText(makePost('article', {
      content: 'short root text',
      articleBody: 'long form body',
    }))).toBe('long form body');
  });

  it('builds ranked discovery state with featured links, trending posts, and side-strip content', () => {
    const linkTop = makePost('link-top', { external: true, likes: 100, reposts: 10, replies: 5 });
    const linkTwo = makePost('link-two', { external: true, likes: 70, reposts: 5, replies: 4 });
    const textHot = makePost('text-hot', { likes: 60, reposts: 2, replies: 8 });
    const linkThree = makePost('link-three', { external: true, likes: 30, reposts: 1, replies: 3 });
    const quietLong = makePost('quiet-long', { content: 'q'.repeat(90) });
    const quietShort = makePost('quiet-short', { content: 'too short' });

    const result = buildExploreDiscoverState({
      suggestedFeeds: [{ uri: 'at://feed/one' } as any],
      suggestedActors: [{ did: 'did:plc:actor', handle: 'actor.bsky.social' } as any],
      whatsHotPosts: [linkTop, textHot],
      trendingTopicPosts: [linkTwo, linkThree, linkTop],
      quietPosts: [quietLong, quietShort],
      recentFeedItems: [{ id: 'feed-item', title: 'Feed Item', link: 'https://example.com/feed' }],
    });

    expect(result.suggestedFeeds).toHaveLength(1);
    expect(result.suggestedActors).toHaveLength(1);
    expect(result.featuredPost?.id).toBe('link-top');
    expect(result.linkPosts.map((post) => post.id)).toEqual([
      'link-top',
      'link-two',
      'link-three',
    ]);
    expect(result.trendingPosts.map((post) => post.id)).toEqual([
      'link-top',
      'link-two',
      'text-hot',
      'link-three',
    ]);
    expect(result.sidePosts.map((post) => post.id)).toEqual([
      'text-hot',
      'quiet-long',
    ]);
    expect(result.recentFeedItems).toEqual([
      { id: 'feed-item', title: 'Feed Item', link: 'https://example.com/feed' },
    ]);
  });

  it('ranks suggested feeds using semantic overlap with interests and trends', () => {
    const ranked = rankSuggestedFeeds({
      feeds: [
        {
          uri: 'at://did:plc:feed/app.bsky.feed.generator/ai-topics',
          displayName: 'AI & ML Pulse',
          description: 'Deep learning, AI policy, and model releases',
          creator: { did: 'did:plc:feed', handle: 'feeds.bsky.social' },
          likeCount: 120,
        } as any,
        {
          uri: 'at://did:plc:feed/app.bsky.feed.generator/sports',
          displayName: 'Sports Recap',
          description: 'Daily sports scores and highlights',
          creator: { did: 'did:plc:feed', handle: 'feeds.bsky.social' },
          likeCount: 500,
        } as any,
      ],
      interestTags: ['artificial intelligence', 'machine learning'],
      trendingTopicQueries: ['AI safety', 'model benchmarks'],
      whatsHotPosts: [
        makePost('trend-ai', { content: 'Latest AI model benchmark discussion' }),
      ],
      maxResults: 2,
    });

    expect(ranked[0]?.uri).toBe('at://did:plc:feed/app.bsky.feed.generator/ai-topics');
    expect(ranked).toHaveLength(2);
  });
});
