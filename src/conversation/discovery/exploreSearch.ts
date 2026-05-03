import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppBskyActorDefs } from '@atproto/api';
import { atpCall } from '../../lib/atproto/client';
import type { MockPost } from '../../data/mockData';
import { hasDisplayableRecordContent, mapFeedViewPost } from '../../atproto/mappers';
import { normalizeAtprotoSearchQuery } from '../../lib/searchQuery';
import { hybridSearch } from '../../search';
import { searchPodcastIndex } from '../../lib/podcastIndexClient';
import { classifyDiscoveryIntent, type DiscoveryIntentKind } from './discoveryIntent';
import {
  dedupeExploreSearchPosts,
  mapBskyFeedToExploreFeedResult,
  mapClipRowToPodcastClipResult,
  mapFeedRowToExploreFeedResult,
  mapHybridPostRowToMockPost,
  mapPodcastFeedToExploreFeedResult,
  resolveExploreSearchResults,
  type ExploreFeedResult,
  type PodcastClipResult,
} from '../../lib/exploreSearchResults';
import { mergePeopleCandidates, searchSemanticPeople } from '../../lib/semanticPeople';
import { recordDiscoveryIntentTelemetry, recordDiscoveryRetryTelemetry } from '../../perf/searchTelemetry';

type ExploreSearchAgent = any;

const DEFAULT_QUERY_MAX_CHARS = 160;
const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

export interface ExploreSearchIntentSummary {
  kind: DiscoveryIntentKind;
  label: string;
  confidence: number;
  reasons: string[];
  queryHasVisualIntent: boolean;
}

interface ExploreSearchPlan {
  normalizedQuery: string;
  isHashtagQuery: boolean;
  postLimit: number;
  tagPostLimit: number;
  actorLimit: number;
  semanticRowLimit: number;
  semanticMaxProfiles: number;
  feedLimit: number;
  podcastLimit: number;
  clipLimit: number;
  intent: ExploreSearchIntentSummary;
}

export interface ExploreSearchPage {
  posts: MockPost[];
  actors: AppBskyActorDefs.ProfileView[];
  feedItems: ExploreFeedResult[];
  podcastClips: PodcastClipResult[];
  intent: ExploreSearchIntentSummary;
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

// Maps intent classification to hybrid search weight overrides.
// The defaults (RRF 0.45 / lexical 0.30 / semantic 0.25) are calibrated for
// general queries. Intent-specific tuning shifts the balance toward the signal
// most likely to surface relevant results for that query shape.
function intentToSearchWeights(kind: DiscoveryIntentKind): {
  rrfWeight?: number;
  lexicalWeight?: number;
  semanticWeight?: number;
} {
  switch (kind) {
    // Hashtag queries need exact token matching — boost lexical, reduce semantic.
    case 'hashtag':
      return { lexicalWeight: 0.50, semanticWeight: 0.12 };
    // People queries surface better via semantic profile similarity.
    case 'people':
      return { semanticWeight: 0.45, lexicalWeight: 0.18 };
    // Domain/URL queries benefit from lexical substring matching.
    case 'source':
      return { lexicalWeight: 0.45, semanticWeight: 0.18 };
    // Feed/podcast queries want semantic topic proximity.
    case 'feed':
      return { semanticWeight: 0.40, lexicalWeight: 0.22 };
    // Visual intent: media boost already handles this via queryHasVisualIntent.
    // General: use defaults.
    default:
      return {};
  }
}

function toIntentLabel(kind: DiscoveryIntentKind): string {
  switch (kind) {
    case 'hashtag':
      return 'Hashtag focus';
    case 'people':
      return 'People focus';
    case 'source':
      return 'Source focus';
    case 'feed':
      return 'Feed focus';
    case 'visual':
      return 'Visual focus';
    default:
      return 'General discovery';
  }
}

function summarizeIntent(query: string): ExploreSearchIntentSummary {
  const intent = classifyDiscoveryIntent(query);
  return {
    kind: intent.kind,
    label: toIntentLabel(intent.kind),
    confidence: intent.confidence,
    reasons: intent.reasons,
    queryHasVisualIntent: intent.queryHasVisualIntent,
  };
}

function defaultIntentSummary(): ExploreSearchIntentSummary {
  return summarizeIntent('');
}

function classifyRetryReason(error: unknown): {
  retryable: boolean;
  statusCode: number | null;
  reasonCategory: 'status' | 'network' | 'timeout' | 'temporary' | 'unknown';
} {
  const status = Number((error as any)?.status ?? (error as any)?.response?.status ?? NaN);
  if (Number.isFinite(status) && (RETRYABLE_STATUS_CODES.has(status) || status >= 500)) {
    return {
      retryable: true,
      statusCode: status,
      reasonCategory: 'status',
    };
  }

  const message = String((error as any)?.message ?? '').toLowerCase();
  if (message.includes('network')) {
    return {
      retryable: true,
      statusCode: Number.isFinite(status) ? status : null,
      reasonCategory: 'network',
    };
  }
  if (message.includes('timeout')) {
    return {
      retryable: true,
      statusCode: Number.isFinite(status) ? status : null,
      reasonCategory: 'timeout',
    };
  }
  if (message.includes('temporar')) {
    return {
      retryable: true,
      statusCode: Number.isFinite(status) ? status : null,
      reasonCategory: 'temporary',
    };
  }

  return {
    retryable: false,
    statusCode: Number.isFinite(status) ? status : null,
    reasonCategory: 'unknown',
  };
}

async function retryWithBackoff<T>(operation: () => Promise<T>, options: { operationName: string; maxAttempts?: number }): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  let attempt = 0;
  let lastError: unknown = null;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const classification = classifyRetryReason(error);
      const exhausted = attempt >= maxAttempts || !classification.retryable;
      recordDiscoveryRetryTelemetry({
        operation: options.operationName,
        attempt,
        maxAttempts,
        statusCode: classification.statusCode,
        reasonCategory: classification.reasonCategory,
        exhausted,
      });

      if (exhausted) {
        throw error;
      }
      const baseDelay = Math.min(900, 100 * (2 ** (attempt - 1)));
      const jitter = Math.floor(Math.random() * 120);
      await new Promise((resolve) => setTimeout(resolve, baseDelay + jitter));
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Retry failed for unknown reason');
}

export function buildExploreSearchPlan(rawQuery: string, _searchSort: 'top' | 'latest'): ExploreSearchPlan {
  const intent = summarizeIntent(rawQuery);
  const normalizedQuery = normalizeAtprotoSearchQuery(rawQuery);
  const isHashtagQuery = rawQuery.startsWith('#') || intent.kind === 'hashtag';

  const basePlan: ExploreSearchPlan = {
    normalizedQuery,
    isHashtagQuery,
    postLimit: 40,
    tagPostLimit: 30,
    actorLimit: 12,
    semanticRowLimit: 36,
    semanticMaxProfiles: 8,
    feedLimit: 12,
    podcastLimit: 8,
    clipLimit: 6,
    intent,
  };

  switch (intent.kind) {
    case 'people':
      return {
        ...basePlan,
        postLimit: 24,
        actorLimit: 20,
        semanticRowLimit: 48,
        semanticMaxProfiles: 12,
        clipLimit: 3,
      };
    case 'feed':
      return {
        ...basePlan,
        postLimit: 20,
        actorLimit: 8,
        feedLimit: 18,
        podcastLimit: 12,
        clipLimit: 8,
      };
    case 'source':
      return {
        ...basePlan,
        postLimit: 36,
        feedLimit: 14,
        clipLimit: 6,
      };
    case 'visual':
      return {
        ...basePlan,
        postLimit: 44,
        clipLimit: 3,
      };
    default:
      return basePlan;
  }
}

function emptyDidSet(): Set<string> {
  return new Set<string>();
}

function emptyExploreSearchPage(): ExploreSearchPage {
  return {
    posts: [],
    actors: [],
    feedItems: [],
    podcastClips: [],
    intent: defaultIntentSummary(),
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
  bskyFeedSearchRes?: any;
  semanticActors?: unknown;
  feedRes?: any;
  podcastIndexFeeds?: unknown;
  podcastClipsRes?: any;
  searchSort: 'top' | 'latest';
  isHashtagQuery: boolean;
  intentSummary?: ExploreSearchIntentSummary;
}): ExploreSearchPage {
  const resolved = resolveExploreSearchResults({
    postsRes: params.postsRes,
    tagPostsRes: params.tagPostsRes,
    localHybridPostRows: params.localHybridPostRows,
    actorsRes: params.actorsRes,
    bskyFeedSearchRes: params.bskyFeedSearchRes,
    feedRes: params.feedRes,
    podcastIndexFeeds: params.podcastIndexFeeds,
    podcastClipsRes: params.podcastClipsRes,
    hasDisplayableRecordContent,
    mapPost: mapStandalonePostView,
    mapLocalHybridPost: mapHybridPostRowToMockPost,
    mapFeedRow: mapFeedRowToExploreFeedResult,
    mapBskyFeed: mapBskyFeedToExploreFeedResult,
    mapPodcastFeed: mapPodcastFeedToExploreFeedResult,
    mapClipRow: mapClipRowToPodcastClipResult,
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
    podcastClips: resolved.podcastClips,
    intent: params.intentSummary ?? defaultIntentSummary(),
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
    podcastClipsRes: null,
    hasDisplayableRecordContent,
    mapPost: mapStandalonePostView,
    mapLocalHybridPost: mapHybridPostRowToMockPost,
    mapFeedRow: mapFeedRowToExploreFeedResult,
    mapBskyFeed: mapBskyFeedToExploreFeedResult,
    mapPodcastFeed: mapPodcastFeedToExploreFeedResult,
    mapClipRow: mapClipRowToPodcastClipResult,
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
    const plan = buildExploreSearchPlan(sanitizedQuery, searchSort);
    recordDiscoveryIntentTelemetry(plan.intent.kind);
    const normalizedQuery = plan.normalizedQuery;
    const isHashtagQuery = plan.isHashtagQuery;
    let disposed = false;

    setLoading(true);
    setLoadingMorePosts(false);
    setLoadingMoreActors(false);
    void Promise.all([
      retryWithBackoff(() => atpCall(() => agent.app.bsky.feed.searchPosts({
        q: normalizedQuery,
        sort: searchSort,
        limit: plan.postLimit,
      })), { operationName: 'searchPosts' }).catch(() => null),
      isHashtagQuery
        ? retryWithBackoff(() => atpCall(() => (agent.app.bsky.feed as any).searchPosts({
          tag: normalizedQuery,
          sort: searchSort,
          limit: plan.tagPostLimit,
        })), { operationName: 'searchPostsByTag' }).catch(() => null)
        : Promise.resolve(null),
      hybridSearch.search(normalizedQuery, 20, {
        queryHasVisualIntent: plan.intent.queryHasVisualIntent,
        ...intentToSearchWeights(plan.intent.kind),
      }).catch(() => null),
      retryWithBackoff(() => atpCall(() => agent.searchActors({
        q: normalizedQuery,
        limit: plan.actorLimit,
      })), { operationName: 'searchActors' }).catch(() => null),
      retryWithBackoff(() => atpCall(() => (agent.app.bsky.feed as any).searchFeeds({
        q: normalizedQuery,
        limit: plan.feedLimit,
      })), { operationName: 'searchFeeds' }).catch(() => null),
      retryWithBackoff(() => searchSemanticPeople(agent, normalizedQuery, {
        rowLimit: plan.semanticRowLimit,
        maxProfiles: plan.semanticMaxProfiles,
      }), { operationName: 'semanticPeople' }).catch(() => []),
      hybridSearch.searchFeedItems(normalizedQuery, plan.feedLimit, {
        queryHasVisualIntent: plan.intent.queryHasVisualIntent,
        ...intentToSearchWeights(plan.intent.kind),
      }).catch(() => null),
      retryWithBackoff(() => searchPodcastIndex(normalizedQuery, plan.podcastLimit), {
        operationName: 'searchPodcastIndex',
      }).catch(() => []),
      hybridSearch.searchTranscriptSegments(normalizedQuery, plan.clipLimit, {
        queryHasVisualIntent: plan.intent.queryHasVisualIntent,
        ...intentToSearchWeights(plan.intent.kind),
      }).catch(() => null),
    ])
      .then(([
        postsRes,
        tagPostsRes,
        localHybridPostsRes,
        actorsRes,
        bskyFeedSearchRes,
        semanticActors,
        feedRes,
        podcastIndexFeeds,
        podcastClipsRes,
      ]) => {
        if (disposed || requestVersion !== requestVersionRef.current) return;
        setPage(resolveExploreSearchPage({
          postsRes,
          tagPostsRes,
          localHybridPostRows: localHybridPostsRes?.rows,
          actorsRes,
          bskyFeedSearchRes,
          semanticActors,
          feedRes,
          podcastIndexFeeds,
          podcastClipsRes,
          searchSort,
          isHashtagQuery,
          intentSummary: plan.intent,
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
    const plan = buildExploreSearchPlan(sanitizedQuery, searchSort);
    const normalizedQuery = plan.normalizedQuery;
    const isHashtagQuery = plan.isHashtagQuery;
    setLoadingMorePosts(true);

    void Promise.all([
      page.postCursor
        ? retryWithBackoff(() => atpCall(() => agent.app.bsky.feed.searchPosts({
          q: normalizedQuery,
          sort: searchSort,
          limit: plan.tagPostLimit,
          cursor: page.postCursor,
        })), { operationName: 'searchPostsPage' }).catch(() => null)
        : Promise.resolve(null),
      isHashtagQuery && page.tagPostCursor
        ? retryWithBackoff(() => atpCall(() => (agent.app.bsky.feed as any).searchPosts({
          tag: normalizedQuery,
          sort: searchSort,
          limit: Math.max(20, Math.trunc(plan.tagPostLimit / 2)),
          cursor: page.tagPostCursor,
        })), { operationName: 'searchPostsByTagPage' }).catch(() => null)
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
    const plan = buildExploreSearchPlan(sanitizedQuery, searchSort);
    const normalizedQuery = plan.normalizedQuery;
    setLoadingMoreActors(true);

    void retryWithBackoff(() => atpCall(() => agent.searchActors({
      q: normalizedQuery,
      limit: plan.actorLimit,
      cursor: page.actorCursor,
    })), { operationName: 'searchActorsPage' })
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
    searchSort,
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
