import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppBskyActorDefs } from '@atproto/api';
import { atpCall } from '../../lib/atproto/client';
import type { MockPost } from '../../data/mockData';
import { hasDisplayableRecordContent, mapFeedViewPost } from '../../atproto/mappers';
import { normalizeAtprotoSearchQuery } from '../../lib/searchQuery';
import { hybridSearch } from '../../search';
import { searchPodcastIndex } from '../../lib/podcastIndexClient';
import {
  dedupeExploreSearchPosts,
  mapFeedRowToExploreFeedResult,
  mapHybridPostRowToMockPost,
  mapPodcastFeedToExploreFeedResult,
  resolveExploreSearchResults,
  type ExploreFeedResult,
} from '../../lib/exploreSearchResults';
import { mergePeopleCandidates, searchSemanticPeople } from '../../lib/semanticPeople';

type ExploreSearchAgent = any;

const DEFAULT_QUERY_MAX_CHARS = 160;

export interface ExploreSearchPage {
  posts: MockPost[];
  actors: AppBskyActorDefs.ProfileView[];
  feedItems: ExploreFeedResult[];
  postCursor: string | null;
  tagPostCursor: string | null;
  actorCursor: string | null;
  semanticActorDids: Set<string>;
  keywordActorDids: Set<string>;
  hasMorePosts: boolean;
  hasMoreActors: boolean;
}

export interface ExploreSearchState extends ExploreSearchPage {
  loading: boolean;
  loadingMorePosts: boolean;
  loadingMoreActors: boolean;
  loadMorePosts: () => void;
  loadMoreActors: () => void;
}

function emptyDidSet(): Set<string> {
  return new Set<string>();
}

function emptyExploreSearchPage(): ExploreSearchPage {
  return {
    posts: [],
    actors: [],
    feedItems: [],
    postCursor: null,
    tagPostCursor: null,
    actorCursor: null,
    semanticActorDids: emptyDidSet(),
    keywordActorDids: emptyDidSet(),
    hasMorePosts: false,
    hasMoreActors: false,
  };
}

function toDidSet(actors: AppBskyActorDefs.ProfileView[]): Set<string> {
  return new Set(
    actors
      .map((actor) => actor?.did?.trim().toLowerCase())
      .filter((did): did is string => Boolean(did)),
  );
}

function actorArrayFromUnknown(
  input: unknown,
): AppBskyActorDefs.ProfileView[] {
  return Array.isArray(input)
    ? input.filter((actor): actor is AppBskyActorDefs.ProfileView => Boolean(actor?.did && actor?.handle))
    : [];
}

function mapStandalonePostView(postView: any): MockPost {
  return mapFeedViewPost({ post: postView } as any);
}

export function sanitizeExploreSearchQuery(
  rawQuery: string,
  maxChars = DEFAULT_QUERY_MAX_CHARS,
): string {
  return rawQuery
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, Math.max(0, maxChars));
}

export function resolveExploreSearchPage(params: {
  postsRes?: any;
  tagPostsRes?: any;
  localHybridPostRows?: unknown;
  actorsRes?: any;
  semanticActors?: unknown;
  feedRes?: any;
  podcastIndexFeeds?: unknown;
  searchSort: 'top' | 'latest';
  isHashtagQuery: boolean;
}): ExploreSearchPage {
  const resolved = resolveExploreSearchResults({
    postsRes: params.postsRes,
    tagPostsRes: params.tagPostsRes,
    localHybridPostRows: params.localHybridPostRows,
    actorsRes: params.actorsRes,
    feedRes: params.feedRes,
    podcastIndexFeeds: params.podcastIndexFeeds,
    hasDisplayableRecordContent,
    mapPost: mapStandalonePostView,
    mapLocalHybridPost: mapHybridPostRowToMockPost,
    mapFeedRow: mapFeedRowToExploreFeedResult,
    mapPodcastFeed: mapPodcastFeedToExploreFeedResult,
  });

  const semanticActors = actorArrayFromUnknown(params.semanticActors);
  const blendedActors = params.searchSort === 'top'
    ? mergePeopleCandidates(semanticActors, resolved.actors)
    : mergePeopleCandidates(resolved.actors, semanticActors);

  const postCursor = params.postsRes?.data?.cursor ?? null;
  const tagPostCursor = params.isHashtagQuery
    ? (params.tagPostsRes?.data?.cursor ?? null)
    : null;
  const actorCursor = params.actorsRes?.data?.cursor ?? null;

  return {
    posts: dedupeExploreSearchPosts(resolved.posts),
    actors: blendedActors,
    feedItems: resolved.feedItems,
    postCursor,
    tagPostCursor,
    actorCursor,
    semanticActorDids: toDidSet(semanticActors),
    keywordActorDids: toDidSet(resolved.actors),
    hasMorePosts: Boolean(postCursor || tagPostCursor),
    hasMoreActors: Boolean(actorCursor),
  };
}

export function mergeExploreSearchPostPage(params: {
  currentPage: ExploreSearchPage;
  postsRes?: any;
  tagPostsRes?: any;
  isHashtagQuery: boolean;
}): ExploreSearchPage {
  const resolved = resolveExploreSearchResults({
    postsRes: params.postsRes,
    tagPostsRes: params.tagPostsRes,
    localHybridPostRows: null,
    actorsRes: null,
    feedRes: null,
    podcastIndexFeeds: null,
    hasDisplayableRecordContent,
    mapPost: mapStandalonePostView,
    mapLocalHybridPost: mapHybridPostRowToMockPost,
    mapFeedRow: mapFeedRowToExploreFeedResult,
    mapPodcastFeed: mapPodcastFeedToExploreFeedResult,
  });

  const postCursor = params.postsRes?.data?.cursor ?? null;
  const tagPostCursor = params.isHashtagQuery
    ? (params.tagPostsRes?.data?.cursor ?? null)
    : null;

  return {
    ...params.currentPage,
    posts: dedupeExploreSearchPosts([
      ...params.currentPage.posts,
      ...resolved.posts,
    ]),
    postCursor,
    tagPostCursor,
    hasMorePosts: Boolean(postCursor || tagPostCursor),
  };
}

export function mergeExploreSearchActorPage(params: {
  currentPage: ExploreSearchPage;
  actorsRes?: any;
}): ExploreSearchPage {
  const nextActors = actorArrayFromUnknown(params.actorsRes?.data?.actors);
  const mergedActors = mergePeopleCandidates(params.currentPage.actors, nextActors);
  const actorCursor = params.actorsRes?.data?.cursor ?? null;
  const keywordActorDids = new Set(params.currentPage.keywordActorDids);
  nextActors.forEach((actor) => {
    const didKey = actor.did.trim().toLowerCase();
    if (didKey) {
      keywordActorDids.add(didKey);
    }
  });

  return {
    ...params.currentPage,
    actors: mergedActors,
    actorCursor,
    keywordActorDids,
    hasMoreActors: Boolean(actorCursor),
  };
}

export function useExploreSearchResults(params: {
  query: string;
  searchSort: 'top' | 'latest';
  agent: ExploreSearchAgent | null | undefined;
  enabled: boolean;
}): ExploreSearchState {
  const {
    query,
    searchSort,
    agent,
    enabled,
  } = params;
  const sanitizedQuery = useMemo(
    () => sanitizeExploreSearchQuery(query),
    [query],
  );
  const [page, setPage] = useState<ExploreSearchPage>(emptyExploreSearchPage);
  const [loading, setLoading] = useState(false);
  const [loadingMorePosts, setLoadingMorePosts] = useState(false);
  const [loadingMoreActors, setLoadingMoreActors] = useState(false);
  const requestVersionRef = useRef(0);

  useEffect(() => {
    if (!enabled || !agent) {
      requestVersionRef.current += 1;
      setPage(emptyExploreSearchPage());
      setLoading(false);
      setLoadingMorePosts(false);
      setLoadingMoreActors(false);
      return;
    }

    if (!sanitizedQuery) {
      requestVersionRef.current += 1;
      setPage(emptyExploreSearchPage());
      setLoading(false);
      setLoadingMorePosts(false);
      setLoadingMoreActors(false);
      return;
    }

    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    const normalizedQuery = normalizeAtprotoSearchQuery(sanitizedQuery);
    const isHashtagQuery = sanitizedQuery.startsWith('#');
    let disposed = false;

    setLoading(true);
    setLoadingMorePosts(false);
    setLoadingMoreActors(false);
    void Promise.all([
      atpCall(() => agent.app.bsky.feed.searchPosts({
        q: normalizedQuery,
        sort: searchSort,
        limit: 40,
      })).catch(() => null),
      isHashtagQuery
        ? atpCall(() => (agent.app.bsky.feed as any).searchPosts({
          tag: normalizedQuery,
          sort: searchSort,
          limit: 30,
        })).catch(() => null)
        : Promise.resolve(null),
      hybridSearch.search(normalizedQuery, 20).catch(() => null),
      atpCall(() => agent.searchActors({ q: normalizedQuery, limit: 12 })).catch(() => null),
      searchSemanticPeople(agent, normalizedQuery, { rowLimit: 36, maxProfiles: 8 }).catch(() => []),
      hybridSearch.searchFeedItems(normalizedQuery, 12).catch(() => null),
      searchPodcastIndex(normalizedQuery, 8).catch(() => []),
    ])
      .then(([
        postsRes,
        tagPostsRes,
        localHybridPostsRes,
        actorsRes,
        semanticActors,
        feedRes,
        podcastIndexFeeds,
      ]) => {
        if (disposed || requestVersion !== requestVersionRef.current) return;
        setPage(resolveExploreSearchPage({
          postsRes,
          tagPostsRes,
          localHybridPostRows: localHybridPostsRes?.rows,
          actorsRes,
          semanticActors,
          feedRes,
          podcastIndexFeeds,
          searchSort,
          isHashtagQuery,
        }));
      })
      .catch(() => {
        if (disposed || requestVersion !== requestVersionRef.current) return;
        setPage(emptyExploreSearchPage());
      })
      .finally(() => {
        if (disposed || requestVersion !== requestVersionRef.current) return;
        setLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [agent, enabled, sanitizedQuery, searchSort]);

  const loadMorePosts = useCallback(() => {
    if (!enabled || !agent) return;
    if (!sanitizedQuery || loadingMorePosts || (!page.postCursor && !page.tagPostCursor)) return;

    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    const normalizedQuery = normalizeAtprotoSearchQuery(sanitizedQuery);
    const isHashtagQuery = sanitizedQuery.startsWith('#');
    setLoadingMorePosts(true);

    void Promise.all([
      page.postCursor
        ? atpCall(() => agent.app.bsky.feed.searchPosts({
          q: normalizedQuery,
          sort: searchSort,
          limit: 30,
          cursor: page.postCursor,
        })).catch(() => null)
        : Promise.resolve(null),
      isHashtagQuery && page.tagPostCursor
        ? atpCall(() => (agent.app.bsky.feed as any).searchPosts({
          tag: normalizedQuery,
          sort: searchSort,
          limit: 20,
          cursor: page.tagPostCursor,
        })).catch(() => null)
        : Promise.resolve(null),
    ])
      .then(([postsRes, tagPostsRes]) => {
        if (requestVersion !== requestVersionRef.current) return;
        setPage((current) => mergeExploreSearchPostPage({
          currentPage: current,
          postsRes,
          tagPostsRes,
          isHashtagQuery,
        }));
      })
      .catch(() => {
        // Pagination failures are non-fatal; leave existing results intact.
      })
      .finally(() => {
        if (requestVersion !== requestVersionRef.current) return;
        setLoadingMorePosts(false);
      });
  }, [
    agent,
    enabled,
    loadingMorePosts,
    page.postCursor,
    page.tagPostCursor,
    sanitizedQuery,
    searchSort,
  ]);

  const loadMoreActors = useCallback(() => {
    if (!enabled || !agent) return;
    if (!sanitizedQuery || loadingMoreActors || !page.actorCursor) return;

    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    const normalizedQuery = normalizeAtprotoSearchQuery(sanitizedQuery);
    setLoadingMoreActors(true);

    void atpCall(() => agent.searchActors({
      q: normalizedQuery,
      limit: 12,
      cursor: page.actorCursor,
    }))
      .then((actorsRes) => {
        if (requestVersion !== requestVersionRef.current) return;
        setPage((current) => mergeExploreSearchActorPage({
          currentPage: current,
          actorsRes,
        }));
      })
      .catch(() => {
        if (requestVersion !== requestVersionRef.current) return;
        setPage((current) => ({
          ...current,
          hasMoreActors: false,
          actorCursor: null,
        }));
      })
      .finally(() => {
        if (requestVersion !== requestVersionRef.current) return;
        setLoadingMoreActors(false);
      });
  }, [
    agent,
    enabled,
    loadingMoreActors,
    page.actorCursor,
    sanitizedQuery,
  ]);

  return {
    ...page,
    loading,
    loadingMorePosts,
    loadingMoreActors,
    loadMorePosts,
    loadMoreActors,
  };
}
