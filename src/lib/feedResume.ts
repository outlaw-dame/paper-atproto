type PostLike = {
  id: string;
};

function collectPostIds(posts: PostLike[]): Set<string> {
  return new Set(
    posts
      .map((post) => (typeof post.id === 'string' ? post.id.trim() : ''))
      .filter(Boolean),
  );
}

export function countNewPostsAboveAnchor(
  nextPosts: PostLike[],
  previousPosts: PostLike[],
  anchorPostId?: string,
): number {
  if (!Array.isArray(nextPosts) || nextPosts.length === 0 || !Array.isArray(previousPosts) || previousPosts.length === 0) {
    return 0;
  }

  const previousIds = collectPostIds(previousPosts);
  if (previousIds.size === 0) return 0;

  const trimmedAnchorId = typeof anchorPostId === 'string' ? anchorPostId.trim() : '';
  if (trimmedAnchorId) {
    const anchorIndex = nextPosts.findIndex((post) => post.id === trimmedAnchorId);
    if (anchorIndex > 0) {
      let count = 0;
      for (const post of nextPosts.slice(0, anchorIndex)) {
        if (!previousIds.has(post.id)) {
          count += 1;
        }
      }
      return count;
    }
    if (anchorIndex === 0) {
      return 0;
    }
  }

  let count = 0;
  for (const post of nextPosts) {
    if (previousIds.has(post.id)) {
      break;
    }
    count += 1;
  }

  return count;
}