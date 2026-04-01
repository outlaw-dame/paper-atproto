import { describe, expect, it } from 'vitest';
import type { MockPost } from '../../data/mockData';
import { projectExploreDiscoverView } from './exploreProjection';

function makePost(id: string, options?: {
  content?: string;
  articleBody?: string;
  embed?: MockPost['embed'];
}): MockPost {
  return {
    id,
    cid: `cid-${id}`,
    content: options?.content ?? '',
    createdAt: '2026-03-31T00:00:00.000Z',
    timestamp: '2026-03-31T00:00:00.000Z',
    author: {
      did: 'did:plc:test',
      handle: 'tester.bsky.social',
      displayName: 'Tester',
    },
    likeCount: 0,
    replyCount: 0,
    repostCount: 0,
    bookmarkCount: 0,
    chips: [],
    ...(options?.articleBody ? {
      article: {
        title: `Article ${id}`,
        body: options.articleBody,
      },
    } : {}),
    ...(options?.embed ? { embed: options.embed } : {}),
  };
}

describe('projectExploreDiscoverView', () => {
  it('derives stable discovery view-model state from shared discovery inputs', () => {
    const projection = projectExploreDiscoverView({
      trendingPosts: [
        makePost('one', {
          content: 'Talking about #alpha and #beta',
          embed: {
            type: 'external',
            url: 'https://www.example.com/story',
            title: 'Example Story',
            description: 'desc',
            domain: 'example.com',
          },
        }),
        makePost('two', {
          articleBody: 'Long form write-up with #gamma',
          embed: {
            type: 'video',
            url: 'https://video.example.com/watch',
            title: 'Video Story',
            domain: 'video.example.com',
          },
        }),
      ],
      suggestedActors: [
        { did: 'did:plc:actor-a', handle: 'actor-a.bsky.social', displayName: 'Actor A' } as any,
        { did: 'did:plc:actor-b', handle: 'actor-b.bsky.social', displayName: 'Actor B' } as any,
      ],
      visibleDiscoverSections: new Set(['trending-topics', 'live-clusters', 'sources']),
      sportsPulsePostCount: 0,
      recentFeedItemCount: 0,
      filteredLinkPostCount: 0,
      suggestedFeedCount: 0,
    });

    expect(projection.trendingTopics).toEqual(['#alpha', '#beta', '#gamma']);
    expect(projection.liveClusters).toHaveLength(2);
    expect(projection.liveClusters[0]?.count).toBe(projectExploreDiscoverView({
      trendingPosts: [],
      suggestedActors: [{ did: 'did:plc:actor-a', handle: 'actor-a.bsky.social' } as any],
      visibleDiscoverSections: null,
      sportsPulsePostCount: 0,
      recentFeedItemCount: 0,
      filteredLinkPostCount: 0,
      suggestedFeedCount: 0,
    }).liveClusters[0]?.count);
    expect(projection.domains).toEqual([
      { domain: 'example.com', description: 'Example Story' },
      { domain: 'video.example.com', description: 'Video Story' },
    ]);
    expect(projection.hasVisibleDiscoverContent).toBe(true);
  });

  it('reports no visible discover content when the active section set is empty in practice', () => {
    const projection = projectExploreDiscoverView({
      trendingPosts: [],
      suggestedActors: [],
      visibleDiscoverSections: new Set(['feed-items', 'sources']),
      sportsPulsePostCount: 0,
      recentFeedItemCount: 0,
      filteredLinkPostCount: 0,
      suggestedFeedCount: 0,
    });

    expect(projection.hasVisibleDiscoverContent).toBe(false);
  });
});
