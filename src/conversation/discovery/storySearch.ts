import { useCallback, useEffect, useRef, useState } from 'react';
import { mapPostViewToMockPost, hasDisplayableRecordContent } from '../../atproto/mappers';
import type { MockPost } from '../../data/mockData';
import { atpCall } from '../../lib/atproto/client';
import { isAtUri } from '../../lib/resolver/atproto';
import { normalizeAtprotoSearchQuery } from '../../lib/searchQuery';
import {
  getLocalHybridPostUri,
  mapHybridPostRowToMockPost,
} from '../../lib/exploreSearchResults';
import { hybridSearch } from '../../search';

type StorySearchAgent = any;

export interface StorySearchPage {
  posts: MockPost[];
  postCursor: string | null;
  tagPostCursor: string | null;
  hasMorePosts: boolean;
}

export interface StorySearchState extends StorySearchPage {
  loading: boolean;
  loadingMorePosts: boolean;
  loadMorePosts: () => void;
}

export function dedupeStorySearchPosts(input: MockPost[]): MockPost[] {
  const seen = new Set<string>();
  return input.filter((post) => {
    const key = post.id.trim().toLowerCase();
    if (!key) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function collectStorySearchHydrationUris(
  localHybridRows: unknown,
  maxUris = 25,
): string[] {
  if (!Array.isArray(localHybridRows)) {
    return [];
  }

  return Array.from(
    new Set(
      localHybridRows
        .map((row) => getLocalHybridPostUri(row))
        .filter((id): id is string => typeof id === 'string' && isAtUri(id)),
    ),
  ).slice(0, Math.max(0, maxUris));
}

export function mergeHydratedLocalStoryPosts(
  localHybridRows: unknown,
  hydratedLocalPosts: MockPost[],
): MockPost[] {
  if (!Array.isArray(localHybridRows)) {
    return hydratedLocalPosts;
  }

  const hydratedById = new Map(
    hydratedLocalPosts.map((post) => [post.id.trim().toLowerCase(), post] as const),
  );
  const merged: MockPost[] = [];

  for (const row of localHybridRows) {
    const uri = getLocalHybridPostUri(row);
    const hydrated = uri ? hydratedById.get(uri.trim().toLowerCase()) : undefined;
    if (hydrated) {
      merged.push(hydrated);
      hydratedById.delete(uri!.trim().toLowerCase());
      continue;
    }
    merged.push(mapHybridPostRowToMockPost(row));
  }

  merged.push(...hydratedById.values());
  return dedupeStorySearchPosts(merged);
}

export function resolveStorySearchPage(params: {
  postsRes?: any;
  tagPostsRes?: any;
  hydratedLocalPosts?: MockPost[];
  existingPosts?: MockPost[];
  isHashtagQuery: boolean;
}): StorySearchPage {
  const remotePosts = [
    ...(params.postsRes?.data?.posts ?? []),
    ...(params.tagPostsRes?.data?.posts ?? []),
  ]
    .filter((post: any) => hasDisplayableRecordContent(post?.record))
    .map((post: any) => mapPostViewToMockPost(post));

  const mergedPosts = dedupeStorySearchPosts([
    ...(params.existingPosts ?? []),
    ...remotePosts,
    ...(params.hydratedLocalPosts ?? []),
  ]);

  const postCursor = params.postsRes?.data?.cursor ?? null;
  const tagPostCursor = params.isHashtagQuery
    ? (params.tagPostsRes?.data?.cursor ?? null)
    : null;

  return {
    posts: mergedPosts,
    postCursor,
    tagPostCursor,
    hasMorePosts: Boolean(postCursor || tagPostCursor),
  };
}

async function hydrateLocalHybridStoryPosts(
  agent: StorySearchAgent,
  localHybridRows: unknown,
): Promise<MockPost[]> {
  const localUris = collectStorySearchHydrationUris(localHybridRows);
  if (localUris.length === 0) {
    return [];
  }

  const hydrateRes = await atpCall(
    () => agent.getPosts({ uris: localUris }),
  ).catch(() => null) as any;

  const hydratedLocalPosts = (hydrateRes?.data?.posts ?? [])
    .filter((post: any) => hasDisplayableRecordContent(post?.record))
    .map((post: any) => mapPostViewToMockPost(post));

  return mergeHydratedLocalStoryPosts(localHybridRows, hydratedLocalPosts);
}

function emptyStorySearchPage(): StorySearchPage {
  return {
    posts: [],
    postCursor: null,
    tagPostCursor: null,
    hasMorePosts: false,
  };
}

export function useStorySearchResults(params: {
  query: string;
  searchSort: 'top' | 'latest';
  agent: StorySearchAgent | null | undefined;
  enabled: boolean;
}): StorySearchState {
  const { query, searchSort, agent, enabled } = params;
  const [page, setPage] = useState<StorySearchPage>(emptyStorySearchPage);
  const [loading, setLoading] = useState(false);
  const [loadingMorePosts, setLoadingMorePosts] = useState(false);
  const requestVersionRef = useRef(0);

  useEffect(() => {
    const rawQuery = query.trim();
    if (!enabled || !agent) {
      requestVersionRef.current += 1;
      setPage(emptyStorySearchPage());
      setLoading(false);
      return;
    }
    if (!rawQuery) {
      requestVersionRef.current += 1;
      setPage(emptyStorySearchPage());
      setLoading(false);
      return;
    }

    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    const normalizedQuery = normalizeAtprotoSearchQuery(rawQuery);
    const isHashtagQuery = rawQuery.startsWith('#');
    let disposed = false;
    setLoading(true);

    void Promise.all([
      atpCall(() => agent.app.bsky.feed.searchPosts({
        q: normalizedQuery,
        sort: searchSort,
        limit: 40,
      })).catch(() => null),
      isHashtagQuery
        ? atpCall(() => agent.app.bsky.feed.searchPosts({
          tag: normalizedQuery,
          sort: searchSort,
          limit: 20,
        })).catch(() => null)
        : Promise.resolve(null),
      hybridSearch.search(normalizedQuery, 15).catch(() => null),
    ])
      .then(async ([postsRes, tagPostsRes, localHybridRes]) => {
        const hydratedLocalPosts = await hydrateLocalHybridStoryPosts(
          agent,
          localHybridRes?.rows,
        );
        if (disposed || requestVersion !== requestVersionRef.current) return;
        setPage(resolveStorySearchPage({
          postsRes,
          tagPostsRes,
          hydratedLocalPosts,
          isHashtagQuery,
        }));
      })
      .catch(() => {
        if (disposed || requestVersion !== requestVersionRef.current) return;
        setPage(emptyStorySearchPage());
      })
      .finally(() => {
        if (disposed || requestVersion !== requestVersionRef.current) return;
        setLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [agent, enabled, query, searchSort]);

  const loadMorePosts = useCallback(() => {
    const rawQuery = query.trim();
    if (!enabled || !agent) return;
    if (!rawQuery || loadingMorePosts || (!page.postCursor && !page.tagPostCursor)) return;

    const normalizedQuery = normalizeAtprotoSearchQuery(rawQuery);
    const isHashtagQuery = rawQuery.startsWith('#');
    setLoadingMorePosts(true);

    const paginationVersion = requestVersionRef.current;
    void Promise.all([
      page.postCursor
        ? atpCall(() => agent.app.bsky.feed.searchPosts({
          q: normalizedQuery,
          sort: searchSort,
          limit: 25,
          cursor: page.postCursor,
        })).catch(() => null)
        : Promise.resolve(null),
      isHashtagQuery && page.tagPostCursor
        ? atpCall(() => agent.app.bsky.feed.searchPosts({
          tag: normalizedQuery,
          sort: searchSort,
          limit: 20,
          cursor: page.tagPostCursor,
        })).catch(() => null)
        : Promise.resolve(null),
    ])
      .then(([postsRes, tagPostsRes]) => {
        if (paginationVersion !== requestVersionRef.current) return;
        setPage((current) => resolveStorySearchPage({
          postsRes,
          tagPostsRes,
          existingPosts: current.posts,
          isHashtagQuery,
        }));
      })
      .catch(() => {
        // Pagination failures are non-fatal; leave existing results intact.
      })
      .finally(() => {
        if (paginationVersion !== requestVersionRef.current) return;
        setLoadingMorePosts(false);
      });
  }, [
    agent,
    enabled,
    loadingMorePosts,
    page.postCursor,
    page.tagPostCursor,
    query,
    searchSort,
  ]);

  return {
    ...page,
    loading,
    loadingMorePosts,
    loadMorePosts,
  };
}
