import { describe, expect, it } from 'vitest';

import { isFollowedAuthorPostForFilters } from './usePostFilterResults';

describe('isFollowedAuthorPostForFilters', () => {
  it('returns true when viewer.following is present', () => {
    const post = {
      author: {
        did: 'did:plc:abc',
        viewer: { following: 'at://did:plc:me/app.bsky.graph.follow/123' },
      },
    } as any;

    const result = isFollowedAuthorPostForFilters(post, new Set<string>());
    expect(result).toBe(true);
  });

  it('returns true when author DID is in followed set', () => {
    const post = {
      author: {
        did: 'did:plc:followed',
        viewer: { following: null },
      },
    } as any;

    const result = isFollowedAuthorPostForFilters(post, new Set<string>(['did:plc:followed']));
    expect(result).toBe(true);
  });

  it('returns false for non-followed author', () => {
    const post = {
      author: {
        did: 'did:plc:not-followed',
        viewer: { following: null },
      },
    } as any;

    const result = isFollowedAuthorPostForFilters(post, new Set<string>(['did:plc:someone-else']));
    expect(result).toBe(false);
  });
});
