import { describe, expect, it } from 'vitest';
import type { MockPost } from '../../data/mockData';
import { projectStoryView } from './storyProjection';

function createPost(overrides: Partial<MockPost>): MockPost {
  return {
    id: overrides.id ?? 'at://did:plc:one/app.bsky.feed.post/1',
    author: {
      did: overrides.author?.did ?? 'did:plc:one',
      handle: overrides.author?.handle ?? 'one.test',
      displayName: overrides.author?.displayName ?? 'One Test',
      ...(overrides.author?.avatar ? { avatar: overrides.author.avatar } : {}),
    },
    content: overrides.content ?? 'AI policy update from @janedoe #AI',
    ...(overrides.facets ? { facets: overrides.facets } : {}),
    createdAt: overrides.createdAt ?? new Date('2026-03-30T12:00:00.000Z').toISOString(),
    likeCount: overrides.likeCount ?? 12,
    replyCount: overrides.replyCount ?? 4,
    repostCount: overrides.repostCount ?? 1,
    bookmarkCount: overrides.bookmarkCount ?? 0,
    chips: overrides.chips ?? [],
    ...(overrides.images ? { images: overrides.images } : {}),
    ...(overrides.embed ? { embed: overrides.embed } : {}),
    ...(overrides.media ? { media: overrides.media } : {}),
    timestamp: overrides.timestamp ?? '2m',
    ...(overrides.threadRoot ? { threadRoot: overrides.threadRoot } : {}),
    ...(overrides.replyTo ? { replyTo: overrides.replyTo } : {}),
    ...(overrides.viewer ? { viewer: overrides.viewer } : {}),
  };
}

describe('story projection', () => {
  it('extracts reusable discovery card view models from search results', () => {
    const posts = [
      createPost({
        embed: {
          type: 'external',
          url: 'https://time.com/story/example',
          title: 'Time reporting',
          description: 'A reported overview of the policy story.',
          thumb: 'https://example.com/thumb.jpg',
          domain: 'time.com',
        },
      }),
      createPost({
        id: 'at://did:plc:two/app.bsky.feed.post/2',
        author: {
          did: 'did:plc:two',
          handle: 'two.test',
          displayName: 'Two Test',
        },
        content: 'Critics say @janedoe still has open #AI transparency questions.',
      }),
    ];

    const projection = projectStoryView({
      query: 'ai policy',
      posts,
      getTranslatedText: (post) => `${post.content} [translated]`,
    });

    expect(projection.query).toBe('ai policy');
    expect(projection.resultCount).toBe(2);
    expect(projection.overview?.text).toContain('[translated]');
    expect(projection.overview?.domain).toBe('time.com');
    expect(projection.bestSource?.profileCardData?.variant).toBe('standard');
    expect(projection.relatedConversations).toHaveLength(1);
    expect(projection.relatedEntities.topics.length).toBeGreaterThan(0);
    expect(projection.relatedEntities.actors.length).toBeGreaterThan(0);
  });
});
