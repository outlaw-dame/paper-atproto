import { describe, expect, it, vi } from 'vitest';
import type { AppBskyActorDefs } from '@atproto/api';

vi.mock('../../search', () => ({
  hybridSearch: {
    search: vi.fn(),
    searchFeedItems: vi.fn(),
  },
}));

vi.mock('../../lib/podcastIndexClient', () => ({
  searchPodcastIndex: vi.fn(),
}));

import {
  mergeExploreSearchActorPage,
  mergeExploreSearchPostPage,
  resolveExploreSearchPage,
  sanitizeExploreSearchQuery,
} from './exploreSearch';

function makeRawPostView(uri: string, text: string) {
  return {
    uri,
    cid: `cid-${uri}`,
    author: {
      did: 'did:plc:test',
      handle: 'tester.bsky.social',
      displayName: 'Tester',
    },
    record: {
      text,
      createdAt: '2026-03-30T00:00:00.000Z',
    },
    likeCount: 0,
    replyCount: 0,
    repostCount: 0,
  };
}

function makeActor(did: string, handle = 'tester.bsky.social'): AppBskyActorDefs.ProfileView {
  return {
    did,
    handle,
    displayName: handle,
  } as AppBskyActorDefs.ProfileView;
}

describe('exploreSearch helpers', () => {
  it('sanitizes and bounds search queries before remote use', () => {
    expect(
      sanitizeExploreSearchQuery('  #topic\u0000\u0007   with   spaces  '),
    ).toBe('#topic with spaces');

    expect(
      sanitizeExploreSearchQuery('x'.repeat(300), 24),
    ).toBe('x'.repeat(24));
  });

  it('resolves an initial explore page with blended posts, people, and feed items', () => {
    const page = resolveExploreSearchPage({
      postsRes: {
        data: {
          posts: [
            makeRawPostView('at://remote-a', 'remote a'),
            makeRawPostView('at://shared', 'shared remote'),
          ],
          cursor: 'remote-cursor',
        },
      },
      tagPostsRes: {
        data: {
          posts: [
            makeRawPostView('at://tag-a', 'tag a'),
            makeRawPostView('at://shared', 'shared tag'),
          ],
          cursor: 'tag-cursor',
        },
      },
      localHybridPostRows: [
        { id: 'at://local-a', content: 'local a', author_did: 'did:plc:local-a' },
        { id: 'at://remote-a', content: 'duplicate remote a', author_did: 'did:plc:local-b' },
      ],
      actorsRes: {
        data: {
          actors: [
            makeActor('did:plc:keyword-a', 'keyword-a.bsky.social'),
          ],
          cursor: 'actor-cursor',
        },
      },
      semanticActors: [
        makeActor('did:plc:semantic-a', 'semantic-a.bsky.social'),
        makeActor('did:plc:keyword-a', 'keyword-a.bsky.social'),
      ],
      feedRes: {
        rows: [
          { id: 'feed-1', title: 'Feed one', link: 'https://example.com/feed-1', feed_title: 'Feed One' },
        ],
      },
      podcastIndexFeeds: [
        { id: 1, title: 'Podcast one', url: 'https://pod.example.com/feed', description: 'podcast', categories: { a: 'News' } },
      ],
      searchSort: 'top',
      isHashtagQuery: true,
    });

    expect(page.posts.map((post) => post.id)).toEqual([
      'at://remote-a',
      'at://shared',
      'at://tag-a',
      'at://local-a',
    ]);
    expect(page.actors.map((actor) => actor.did)).toEqual([
      'did:plc:semantic-a',
      'did:plc:keyword-a',
    ]);
    expect(page.feedItems.map((item) => item.title)).toEqual([
      'Feed one',
      'Podcast one',
    ]);
    expect(page.semanticActorDids.has('did:plc:semantic-a')).toBe(true);
    expect(page.keywordActorDids.has('did:plc:keyword-a')).toBe(true);
    expect(page.postCursor).toBe('remote-cursor');
    expect(page.tagPostCursor).toBe('tag-cursor');
    expect(page.actorCursor).toBe('actor-cursor');
    expect(page.hasMorePosts).toBe(true);
    expect(page.hasMoreActors).toBe(true);
  });

  it('merges additional post pages without disturbing non-post search state', () => {
    const initial = resolveExploreSearchPage({
      postsRes: {
        data: {
          posts: [makeRawPostView('at://existing', 'existing')],
        },
      },
      actorsRes: {
        data: {
          actors: [makeActor('did:plc:keyword-a', 'keyword-a.bsky.social')],
        },
      },
      semanticActors: [makeActor('did:plc:semantic-a', 'semantic-a.bsky.social')],
      feedRes: null,
      podcastIndexFeeds: null,
      searchSort: 'top',
      isHashtagQuery: false,
    });

    const merged = mergeExploreSearchPostPage({
      currentPage: initial,
      postsRes: {
        data: {
          posts: [
            makeRawPostView('at://existing', 'duplicate existing'),
            makeRawPostView('at://next', 'next'),
          ],
          cursor: 'next-cursor',
        },
      },
      tagPostsRes: null,
      isHashtagQuery: false,
    });

    expect(merged.posts.map((post) => post.id)).toEqual([
      'at://existing',
      'at://next',
    ]);
    expect(merged.actors.map((actor) => actor.did)).toEqual(initial.actors.map((actor) => actor.did));
    expect(merged.keywordActorDids).toEqual(initial.keywordActorDids);
    expect(merged.postCursor).toBe('next-cursor');
    expect(merged.hasMorePosts).toBe(true);
  });

  it('merges actor pagination and expands keyword-match dids', () => {
    const initial = resolveExploreSearchPage({
      postsRes: null,
      actorsRes: {
        data: {
          actors: [makeActor('did:plc:keyword-a', 'keyword-a.bsky.social')],
          cursor: 'actor-cursor-a',
        },
      },
      semanticActors: [makeActor('did:plc:semantic-a', 'semantic-a.bsky.social')],
      feedRes: null,
      podcastIndexFeeds: null,
      searchSort: 'top',
      isHashtagQuery: false,
    });

    const merged = mergeExploreSearchActorPage({
      currentPage: initial,
      actorsRes: {
        data: {
          actors: [
            makeActor('did:plc:keyword-a', 'keyword-a.bsky.social'),
            makeActor('did:plc:keyword-b', 'keyword-b.bsky.social'),
          ],
          cursor: 'actor-cursor-b',
        },
      },
    });

    expect(merged.actors.map((actor) => actor.did)).toEqual([
      'did:plc:semantic-a',
      'did:plc:keyword-a',
      'did:plc:keyword-b',
    ]);
    expect(merged.keywordActorDids.has('did:plc:keyword-b')).toBe(true);
    expect(merged.actorCursor).toBe('actor-cursor-b');
    expect(merged.hasMoreActors).toBe(true);
  });

  it('preserves empty or exhausted actor pagination state on failure fallback', () => {
    const initial = resolveExploreSearchPage({
      postsRes: null,
      actorsRes: null,
      semanticActors: [],
      feedRes: null,
      podcastIndexFeeds: null,
      searchSort: 'top',
      isHashtagQuery: false,
    });

    expect(initial).toEqual({
      posts: [],
      actors: [],
      feedItems: [],
      postCursor: null,
      tagPostCursor: null,
      actorCursor: null,
      semanticActorDids: new Set(),
      keywordActorDids: new Set(),
      hasMorePosts: false,
      hasMoreActors: false,
    });
  });
});
