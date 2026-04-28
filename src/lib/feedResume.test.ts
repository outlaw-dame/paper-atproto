import { describe, expect, it } from 'vitest';
import { countNewPostsAboveAnchor } from './feedResume';

describe('countNewPostsAboveAnchor', () => {
  it('counts only actually new posts before the saved anchor', () => {
    const previousPosts = [
      { id: 'p1' },
      { id: 'p2' },
      { id: 'p3' },
    ];
    const nextPosts = [
      { id: 'n1' },
      { id: 'n2' },
      { id: 'p1' },
      { id: 'p2' },
      { id: 'p3' },
    ];

    expect(countNewPostsAboveAnchor(nextPosts, previousPosts, 'p1')).toBe(2);
  });

  it('does not overcount posts that were already in the cached feed above the anchor', () => {
    const previousPosts = [
      { id: 'p1' },
      { id: 'p2' },
      { id: 'p3' },
    ];
    const nextPosts = [
      { id: 'p2' },
      { id: 'n1' },
      { id: 'p1' },
      { id: 'p3' },
    ];

    expect(countNewPostsAboveAnchor(nextPosts, previousPosts, 'p1')).toBe(1);
  });

  it('falls back to the first previous overlap when the anchor is missing', () => {
    const previousPosts = [
      { id: 'p1' },
      { id: 'p2' },
      { id: 'p3' },
    ];
    const nextPosts = [
      { id: 'n1' },
      { id: 'n2' },
      { id: 'p2' },
      { id: 'p3' },
    ];

    expect(countNewPostsAboveAnchor(nextPosts, previousPosts, 'missing-anchor')).toBe(2);
  });
});