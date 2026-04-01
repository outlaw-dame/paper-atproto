import { describe, expect, it } from 'vitest';
import type { MockPost } from '../../data/mockData';
import {
  collectStorySearchHydrationUris,
  dedupeStorySearchPosts,
  resolveStorySearchPage,
} from './storySearch';

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

describe('storySearch helpers', () => {
  it('dedupes story posts by normalized id', () => {
    const result = dedupeStorySearchPosts([
      makeMockPost('at://one'),
      makeMockPost('AT://ONE'),
      makeMockPost(''),
      makeMockPost('at://two'),
    ]);

    expect(result.map((post) => post.id)).toEqual(['at://one', 'at://two']);
  });

  it('collects unique ATProto hydration uris with a limit', () => {
    const uris = collectStorySearchHydrationUris([
      { id: 'at://did:plc:one/app.bsky.feed.post/one' },
      { id: 'at://did:plc:two/app.bsky.feed.post/two' },
      { id: 'https://example.com/not-atproto' },
      { id: 'at://did:plc:one/app.bsky.feed.post/one' },
    ], 2);

    expect(uris).toEqual([
      'at://did:plc:one/app.bsky.feed.post/one',
      'at://did:plc:two/app.bsky.feed.post/two',
    ]);
  });

  it('resolves an initial story page with remote, tag, and hydrated local posts', () => {
    const result = resolveStorySearchPage({
      postsRes: {
        data: {
          posts: [
            makeRawPostView('at://remote-a', 'remote a'),
            makeRawPostView('at://shared', 'shared from remote'),
          ],
          cursor: 'remote-cursor',
        },
      },
      tagPostsRes: {
        data: {
          posts: [
            makeRawPostView('at://tag-a', 'tag a'),
            makeRawPostView('at://shared', 'shared from tag'),
          ],
          cursor: 'tag-cursor',
        },
      },
      hydratedLocalPosts: [
        makeMockPost('at://local-a'),
        makeMockPost('at://remote-a'),
      ],
      isHashtagQuery: true,
    });

    expect(result.posts.map((post) => post.id)).toEqual([
      'at://remote-a',
      'at://shared',
      'at://tag-a',
      'at://local-a',
    ]);
    expect(result.postCursor).toBe('remote-cursor');
    expect(result.tagPostCursor).toBe('tag-cursor');
    expect(result.hasMorePosts).toBe(true);
  });

  it('merges additional pages onto the existing story results', () => {
    const result = resolveStorySearchPage({
      existingPosts: [makeMockPost('at://existing')],
      postsRes: {
        data: {
          posts: [
            makeRawPostView('at://existing', 'existing duplicate'),
            makeRawPostView('at://next', 'next'),
          ],
        },
      },
      tagPostsRes: null,
      isHashtagQuery: false,
    });

    expect(result.posts.map((post) => post.id)).toEqual([
      'at://existing',
      'at://next',
    ]);
    expect(result.tagPostCursor).toBeNull();
    expect(result.hasMorePosts).toBe(false);
  });
});
