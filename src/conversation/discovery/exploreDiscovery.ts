import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppBskyActorDefs, AppBskyFeedDefs } from '@atproto/api';
import { atpCall } from '../../lib/atproto/client';
import type { MockPost } from '../../data/mockData';
import { hasDisplayableRecordContent, mapFeedViewPost } from '../../atproto/mappers';
import { feedService } from '../../feeds';
import { mapFeedRowToExploreFeedResult, type ExploreFeedResult } from '../../lib/exploreSearchResults';
import { normalizeAtprotoSearchQuery } from '../../lib/searchQuery';
import { searchSemanticPeople } from '../../lib/semanticPeople';

type ExploreDiscoveryAgent = any;

const DISCOVER_FEED_URI = 'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot';
const QUIET_FEED_URI = 'at://did:plc:vpkhqolt662uhesyj6nxm7ys/app.bsky.feed.generator/infreq';
const DEFAULT_TOPIC_LABEL_LIMIT = 80;
const DEFAULT_ACTOR_RECOMMENDATION_LIMIT = 18;
const DEFAULT_FEED_RECOMMENDATION_LIMIT = 12;

type SourceKind = 'server' | 'graph' | 'semantic';

type ActorRecommendationAccumulator = {
  actor: AppBskyActorDefs.ProfileView;
  score: number;
  sourceKinds: Set<SourceKind>;
  reasons: Set<string>;
};

export interface ExploreSuggestedActorRecommendation {
  actor: AppBskyActorDefs.ProfileView;
  score: number;
  confidence: number;
  reasons: string[];
  semanticMatch: boolean;
  graphMatch: boolean;
  serverMatch: boolean;
}

export interface ExploreDiscoverState {
  suggestedFeeds: AppBskyFeedDefs.GeneratorView[];
  suggestedActors: AppBskyActorDefs.ProfileView[];
  suggestedActorRecommendations: ExploreSuggestedActorRecommendation[];
  featuredPost: MockPost | null;
  linkPosts: MockPost[];
  trendingPosts: MockPost[];
  sidePosts: MockPost[];
  recentFeedItems: ExploreFeedResult[];
  loading: boolean;
}

interface BuildExploreDiscoverStateParams {
  suggestedFeeds?: AppBskyFeedDefs.GeneratorView[];
  suggestedActors?: AppBskyActorDefs.ProfileView[];
  suggestedActorRecommendations?: ExploreSuggestedActorRecommendation[];
  whatsHotPosts?: MockPost[];
  trendingTopicPosts?: MockPost[];
  quietPosts?: MockPost[];
  recentFeedItems?: ExploreFeedResult[];
}

function emptyDiscoverState(): ExploreDiscoverState {
  return {
    suggestedFeeds: [],
    suggestedActors: [],
    suggestedActorRecommendations: [],
    featuredPost: null,
    linkPosts: [],
    trendingPosts: [],
    sidePosts: [],
    recentFeedItems: [],
    loading: false,
  };
}

function mapStandalonePostView(postView: any): MockPost {
  return mapFeedViewPost({ post: postView } as any);
}

function normalizeDid(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeLabelValue(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

function sanitizeSemanticSeedText(raw: string): string {
  return raw
    .replace(/[^\p{L}\p{N}\s#._-]+/gu, ' ')
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

function extractHashtagTokens(input: string): string[] {
  const matches = input.match(/#\w+/g) ?? [];
  return matches.map((token) => token.trim()).filter(Boolean);
}

function createSemanticSeedQueries(params: {
  whatsHotPosts: MockPost[];
  trendingTopicQueries: string[];
  maxQueries?: number;
}): string[] {
  const maxQueries = Math.max(1, params.maxQueries ?? 3);
  const seeds: string[] = [];

  for (const topic of params.trendingTopicQueries) {
    const cleaned = sanitizeSemanticSeedText(topic);
    if (!cleaned) continue;
    seeds.push(cleaned);
    if (seeds.length >= maxQueries) return Array.from(new Set(seeds));
  }

  for (const post of params.whatsHotPosts.slice(0, 10)) {
    const base = getPrimaryPostText(post);
    if (!base) continue;
    const hashTags = extractHashtagTokens(base).slice(0, 3).join(' ');
    const cleaned = sanitizeSemanticSeedText(`${hashTags} ${base}`);
    if (!cleaned) continue;
    seeds.push(cleaned);
    if (seeds.length >= maxQueries) break;
  }

  return Array.from(new Set(seeds)).slice(0, maxQueries);
}

function parseSubscribedLabelerDids(moderationPrefs: any): Set<string> {
  const subscribed = new Set<string>();
  const entries = Array.isArray(moderationPrefs?.labelers) ? moderationPrefs.labelers : [];
  for (const entry of entries) {
    const did = normalizeDid(entry?.did ?? entry?.src ?? entry?.labeler ?? entry?.uri);
    if (did.startsWith('did:')) {
      subscribed.add(did);
    }
  }
  return subscribed;
}

function parseContentLabelPrefs(moderationPrefs: any): Map<string, 'hide' | 'warn' | 'ignore'> {
  const out = new Map<string, 'hide' | 'warn' | 'ignore'>();
  const labels = moderationPrefs?.labels;
  if (!labels || typeof labels !== 'object') {
    return out;
  }

  for (const [rawKey, rawValue] of Object.entries(labels as Record<string, unknown>)) {
    const key = normalizeLabelValue(rawKey);
    if (!key) continue;
    if (rawValue !== 'hide' && rawValue !== 'warn' && rawValue !== 'ignore') continue;
    out.set(key, rawValue);
  }

  return out;
}

function extractLabelSourceDid(rawLabel: any): string {
  const candidates = [rawLabel?.src, rawLabel?.uri, rawLabel?.cid];
  for (const rawCandidate of candidates) {
    const candidate = String(rawCandidate ?? '').trim();
    if (!candidate) continue;
    if (candidate.startsWith('did:')) {
      const parts = candidate.split('/');
      return normalizeDid(parts[0]);
    }
    if (candidate.startsWith('at://')) {
      const match = candidate.match(/^at:\/\/(did:[^/]+)/i);
      if (match?.[1]) return normalizeDid(match[1]);
    }
  }
  return '';
}

function resolveLabelVisibility(params: {
  labelValue: string;
  labelSourceDid: string;
  contentLabelPrefs: Map<string, 'hide' | 'warn' | 'ignore'>;
}): 'hide' | 'warn' | 'ignore' {
  const { labelValue, labelSourceDid, contentLabelPrefs } = params;
  const candidates = [
    labelValue,
    `${labelSourceDid}:${labelValue}`,
    `${labelSourceDid}|${labelValue}`,
    `${labelSourceDid}/${labelValue}`,
  ].map((candidate) => normalizeLabelValue(candidate));

  for (const candidate of candidates) {
    const value = contentLabelPrefs.get(candidate);
    if (value) return value;
  }

  return 'ignore';
}

function createActorClusterKey(actor: AppBskyActorDefs.ProfileView): string {
  const description = String(actor.description ?? '').toLowerCase();
  const keyword = description
    .replace(/[^\p{L}\p{N}\s#._-]+/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 4)
    .slice(0, 2)
    .join('|');
  if (keyword) return `bio:${keyword}`;
  const handleRoot = String(actor.handle ?? '').toLowerCase().split('.').slice(0, 1).join('.');
  return `handle:${handleRoot}`;
}

function finalizeRecommendations(params: {
  accumulators: Map<string, ActorRecommendationAccumulator>;
  moderationPrefs: any;
  selfDid: string | null;
  maxResults?: number;
}): ExploreSuggestedActorRecommendation[] {
  const { accumulators, moderationPrefs, selfDid } = params;
  const maxResults = Math.max(1, params.maxResults ?? DEFAULT_ACTOR_RECOMMENDATION_LIMIT);
  const contentLabelPrefs = parseContentLabelPrefs(moderationPrefs);
  const subscribedLabelerDids = parseSubscribedLabelerDids(moderationPrefs);

  const scored: ExploreSuggestedActorRecommendation[] = [];

  for (const accumulator of accumulators.values()) {
    const actor = accumulator.actor;
    const didKey = normalizeDid(actor.did);
    if (!didKey || didKey === selfDid) continue;
    if (actor.viewer?.following || actor.viewer?.blocking || actor.viewer?.blockedBy) continue;

    let score = accumulator.score;
    const reasons = new Set(accumulator.reasons);
    let hardHiddenByLabels = false;

    const labels = Array.isArray((actor as any)?.labels) ? (actor as any).labels : [];
    for (const rawLabel of labels) {
      const labelValue = normalizeLabelValue(rawLabel?.val);
      if (!labelValue) continue;
      const labelSourceDid = extractLabelSourceDid(rawLabel);
      const visibility = resolveLabelVisibility({ labelValue, labelSourceDid, contentLabelPrefs });
      const fromSubscribedLabeler = labelSourceDid ? subscribedLabelerDids.has(labelSourceDid) : false;

      if (visibility === 'hide') {
        hardHiddenByLabels = true;
        reasons.add('Safety filtered');
        break;
      }

      if (visibility === 'warn' || fromSubscribedLabeler) {
        score -= 1.1;
        reasons.add('Sensitive content');
      }
    }

    if (hardHiddenByLabels) continue;

    if (actor.viewer?.muted) {
      score -= 1.25;
      reasons.add('Muted profile');
    }

    if (actor.viewer?.followedBy) {
      score += 0.4;
      reasons.add('Follows you');
    }

    const followersCount = Number((actor as any)?.followersCount ?? 0);
    if (Number.isFinite(followersCount) && followersCount > 0) {
      score += Math.min(0.35, Math.log10(Math.max(1, followersCount)) / 8);
    }

    const semanticMatch = accumulator.sourceKinds.has('semantic');
    const graphMatch = accumulator.sourceKinds.has('graph');
    const serverMatch = accumulator.sourceKinds.has('server');

    if (semanticMatch) reasons.add('Topic match');
    if (graphMatch) reasons.add('Similar follows');
    if (serverMatch) reasons.add('Popular on Bluesky');

    const confidence = Math.max(0, Math.min(1, score / 4.5));
    scored.push({
      actor,
      score,
      confidence,
      reasons: Array.from(reasons).slice(0, 3),
      semanticMatch,
      graphMatch,
      serverMatch,
    });
  }

  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    const leftFollowers = Number((left.actor as any)?.followersCount ?? 0);
    const rightFollowers = Number((right.actor as any)?.followersCount ?? 0);
    if (rightFollowers !== leftFollowers) return rightFollowers - leftFollowers;
    return (left.actor.handle ?? '').localeCompare(right.actor.handle ?? '');
  });

  const selected: ExploreSuggestedActorRecommendation[] = [];
  const clusterCounts = new Map<string, number>();

  for (const recommendation of scored) {
    const clusterKey = createActorClusterKey(recommendation.actor);
    const clusterCount = clusterCounts.get(clusterKey) ?? 0;
    if (clusterCount >= 2) continue;
    selected.push(recommendation);
    clusterCounts.set(clusterKey, clusterCount + 1);
    if (selected.length >= maxResults) break;
  }

  if (selected.length < maxResults) {
    const selectedDids = new Set(selected.map((entry) => normalizeDid(entry.actor.did)));
    for (const recommendation of scored) {
      const didKey = normalizeDid(recommendation.actor.did);
      if (selectedDids.has(didKey)) continue;
      selected.push(recommendation);
      selectedDids.add(didKey);
      if (selected.length >= maxResults) break;
    }
  }

  return selected;
}

function accumulateActorSource(
  accumulators: Map<string, ActorRecommendationAccumulator>,
  sourceActors: AppBskyActorDefs.ProfileView[],
  sourceKind: SourceKind,
  sourceWeight: number,
): void {
  for (const actor of sourceActors) {
    const didKey = normalizeDid(actor.did);
    if (!didKey || !actor.handle) continue;

    const existing = accumulators.get(didKey);
    if (existing) {
      existing.score += sourceWeight;
      existing.sourceKinds.add(sourceKind);
      continue;
    }

    accumulators.set(didKey, {
      actor,
      score: sourceWeight,
      sourceKinds: new Set([sourceKind]),
      reasons: new Set<string>(),
    });
  }
}

function tokenizeSemanticTerms(raw: string): string[] {
  return raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s#._-]+/gu, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .slice(0, 40);
}

function collectFeedRecommendationSignals(params: {
  interestTags: string[];
  trendingTopicQueries: string[];
  whatsHotPosts: MockPost[];
}): Set<string> {
  const out = new Set<string>();
  for (const tag of params.interestTags) {
    tokenizeSemanticTerms(tag).forEach((token) => out.add(token));
  }
  for (const topic of params.trendingTopicQueries) {
    tokenizeSemanticTerms(topic).forEach((token) => out.add(token));
  }
  for (const post of params.whatsHotPosts.slice(0, 8)) {
    tokenizeSemanticTerms(getPrimaryPostText(post)).forEach((token) => out.add(token));
  }
  return out;
}

function scoreSuggestedFeed(
  feed: AppBskyFeedDefs.GeneratorView,
  semanticSignals: Set<string>,
): number {
  const corpus = `${feed.displayName ?? ''} ${feed.description ?? ''} ${feed.creator?.handle ?? ''}`;
  const tokens = tokenizeSemanticTerms(corpus);
  let overlap = 0;
  for (const token of tokens) {
    if (semanticSignals.has(token)) overlap += 1;
  }

  const popularity = Number((feed as any)?.likeCount ?? 0);
  const popularityBoost = Number.isFinite(popularity)
    ? Math.min(0.7, Math.log10(Math.max(1, popularity)) / 6)
    : 0;
  const overlapBoost = overlap > 0
    ? Math.min(2.2, overlap * 0.45)
    : 0;
  const followingPenalty = feed.viewer?.like ? -0.6 : 0;

  return overlapBoost + popularityBoost + followingPenalty;
}

export function rankSuggestedFeeds(params: {
  feeds: AppBskyFeedDefs.GeneratorView[];
  interestTags: string[];
  trendingTopicQueries: string[];
  whatsHotPosts: MockPost[];
  maxResults?: number;
}): AppBskyFeedDefs.GeneratorView[] {
  const maxResults = Math.max(1, params.maxResults ?? DEFAULT_FEED_RECOMMENDATION_LIMIT);
  const semanticSignals = collectFeedRecommendationSignals({
    interestTags: params.interestTags,
    trendingTopicQueries: params.trendingTopicQueries,
    whatsHotPosts: params.whatsHotPosts,
  });

  const ranked = [...params.feeds]
    .map((feed, index) => ({
      feed,
      index,
      score: scoreSuggestedFeed(feed, semanticSignals),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      const leftLikes = Number((left.feed as any)?.likeCount ?? 0);
      const rightLikes = Number((right.feed as any)?.likeCount ?? 0);
      if (rightLikes !== leftLikes) return rightLikes - leftLikes;
      return left.index - right.index;
    });

  const selected: AppBskyFeedDefs.GeneratorView[] = [];
  const perCreatorCount = new Map<string, number>();
  for (const entry of ranked) {
    const creatorDid = normalizeDid(entry.feed.creator?.did);
    const currentCount = perCreatorCount.get(creatorDid) ?? 0;
    if (creatorDid && currentCount >= 2) continue;
    selected.push(entry.feed);
    if (creatorDid) {
      perCreatorCount.set(creatorDid, currentCount + 1);
    }
    if (selected.length >= maxResults) break;
  }

  return selected;
}

async function loadSemanticSuggestedActors(params: {
  agent: ExploreDiscoveryAgent;
  semanticQueries: string[];
}): Promise<AppBskyActorDefs.ProfileView[]> {
  const { agent, semanticQueries } = params;
  if (semanticQueries.length === 0) return [];

  const settled = await Promise.allSettled(
    semanticQueries.map((query) => searchSemanticPeople(agent, query, { rowLimit: 28, maxProfiles: 8 })),
  );

  const merged: AppBskyActorDefs.ProfileView[] = [];
  const seen = new Set<string>();
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    for (const actor of result.value) {
      const didKey = normalizeDid(actor.did);
      if (!didKey || seen.has(didKey)) continue;
      seen.add(didKey);
      merged.push(actor);
    }
  }

  return merged;
}

export function getPrimaryPostText(post: MockPost): string {
  const articleBody = post.article?.body?.trim();
  if (articleBody) return articleBody;
  return post.content.trim();
}

export function scorePostEngagement(post: MockPost): number {
  const quoteCount = post.embed?.type === 'quote' ? 1 : 0;
  return post.likeCount + post.repostCount * 2 + post.replyCount * 1.5 + quoteCount * 1.5;
}

export function sanitizeDiscoverTopicLabel(
  rawTopic: string,
  maxChars = DEFAULT_TOPIC_LABEL_LIMIT,
): string {
  return rawTopic
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, Math.max(0, maxChars));
}

export function dedupeDiscoverPosts(posts: MockPost[]): MockPost[] {
  const byUri = new Map<string, MockPost>();
  for (const post of posts) {
    const key = post.id.trim().toLowerCase();
    if (!key) continue;
    if (!byUri.has(key)) {
      byUri.set(key, post);
    }
  }
  return [...byUri.values()];
}

export function collectTrendingTopicQueries(
  topics: unknown,
  maxTopics = 3,
): string[] {
  if (!Array.isArray(topics)) {
    return [];
  }

  return Array.from(new Set(
    topics
      .map((topic) => sanitizeDiscoverTopicLabel(String((topic as any)?.topic || (topic as any)?.tag || '')))
      .filter(Boolean)
      .map((topic) => normalizeAtprotoSearchQuery(topic)),
  )).slice(0, Math.max(0, maxTopics));
}

export function buildExploreDiscoverState(
  params: BuildExploreDiscoverStateParams,
): Omit<ExploreDiscoverState, 'loading'> {
  const combinedPosts = dedupeDiscoverPosts([
    ...(params.whatsHotPosts ?? []),
    ...(params.trendingTopicPosts ?? []),
  ]);
  const byEngagement = [...combinedPosts].sort(
    (left, right) => scorePostEngagement(right) - scorePostEngagement(left),
  );

  const linkPosts = byEngagement
    .filter((post) => post.embed?.type === 'external' || !!post.article)
    .slice(0, 6);

  const featuredPost = linkPosts[0] ?? byEngagement[0] ?? null;
  const trendingPosts = byEngagement.slice(0, 10);
  const topIds = new Set(linkPosts.map((post) => post.id));

  const midTier = byEngagement
    .filter((post) => !topIds.has(post.id))
    .slice(0, 6);

  const secondaryLinks = byEngagement
    .filter((post) => (post.embed?.type === 'external' || !!post.article) && !topIds.has(post.id))
    .sort((left, right) => scorePostEngagement(right) - scorePostEngagement(left))
    .slice(0, 4);

  const quietPosts = (params.quietPosts ?? [])
    .filter((post) => getPrimaryPostText(post).length > 40)
    .slice(0, 3);

  const underdogs = byEngagement
    .filter((post) => !topIds.has(post.id) && scorePostEngagement(post) > 5)
    .sort((left, right) => scorePostEngagement(left) - scorePostEngagement(right))
    .slice(0, 3);

  const seen = new Set(topIds);
  const sidePosts: MockPost[] = [];
  for (const post of [...secondaryLinks, ...midTier, ...quietPosts, ...underdogs]) {
    if (seen.has(post.id)) continue;
    seen.add(post.id);
    sidePosts.push(post);
    if (sidePosts.length >= 10) break;
  }

  const suggestedActorRecommendations = params.suggestedActorRecommendations ?? [];
  const suggestedActors = suggestedActorRecommendations.length > 0
    ? suggestedActorRecommendations.map((entry) => entry.actor)
    : (params.suggestedActors ?? []);

  return {
    suggestedFeeds: params.suggestedFeeds ?? [],
    suggestedActors,
    suggestedActorRecommendations,
    featuredPost,
    linkPosts,
    trendingPosts,
    sidePosts,
    recentFeedItems: params.recentFeedItems ?? [],
  };
}

function logDiscoverFailure(label: string, error: unknown): null {
  const normalized = error as any;
  console.warn(
    `[ExploreDiscovery] ${label} failed — status: ${normalized?.status ?? '?'}, error: ${normalized?.error ?? normalized?.message ?? String(error)}`,
    error,
  );
  return null;
}

function safeAtpCall<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  return atpCall(() => fn()).catch((error) => logDiscoverFailure(label, error));
}

function safePromise<T>(label: string, promise: Promise<T>): Promise<T | null> {
  return promise.catch((error) => logDiscoverFailure(label, error));
}

function mapFeedViewItems(feedItems: unknown): MockPost[] {
  if (!Array.isArray(feedItems)) return [];
  return feedItems
    .filter((item: any) => hasDisplayableRecordContent(item.post?.record))
    .map((item: any) => mapFeedViewPost(item));
}

async function loadTrendingTopicPosts(
  agent: ExploreDiscoveryAgent,
  rawTopics: unknown,
): Promise<MockPost[]> {
  const topics = collectTrendingTopicQueries(rawTopics);
  if (topics.length === 0) {
    return [];
  }

  const searchResults = await Promise.all(
    topics.map((topic) => safeAtpCall(
      `searchPosts:${topic}`,
      () => agent.app.bsky.feed.searchPosts({ q: topic, limit: 8 }),
    )),
  );

  return searchResults
    .filter((result: any) => result?.data?.posts?.length)
    .flatMap((result: any) => result.data.posts.filter((post: any) => hasDisplayableRecordContent(post?.record)).slice(0, 2))
    .map((post: any) => mapStandalonePostView(post));
}

export function useExploreDiscoverContent(params: {
  agent: ExploreDiscoveryAgent | null | undefined;
  sessionDid?: string | null;
  enabled: boolean;
}): ExploreDiscoverState {
  const { agent, sessionDid, enabled } = params;
  const [state, setState] = useState<ExploreDiscoverState>(emptyDiscoverState);
  const requestVersionRef = useRef(0);

  useEffect(() => {
    if (!enabled || !agent) {
      requestVersionRef.current += 1;
      setState(emptyDiscoverState());
      return;
    }

    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    let disposed = false;

    setState((current) => ({ ...current, loading: true }));

    void Promise.all([
      safeAtpCall('getSuggestedFeeds', () => agent.app.bsky.feed.getSuggestedFeeds({ limit: 10 })),
      sessionDid
        ? safeAtpCall('getSuggestions', () => (agent.getSuggestions as any)({ limit: 10, relativeToDid: sessionDid }))
        : Promise.resolve(null),
      sessionDid
        ? safeAtpCall('getSuggestedFollowsByActor', () => (agent.app.bsky.graph as any).getSuggestedFollowsByActor({ actor: sessionDid }))
        : Promise.resolve(null),
      safeAtpCall('getPreferences', () => (agent as any).getPreferences()),
      safeAtpCall('getFeed:whats-hot', () => agent.app.bsky.feed.getFeed({ feed: DISCOVER_FEED_URI, limit: 50 })),
      safeAtpCall('getTrendingTopics', () => (agent.app.bsky.unspecced as any).getTrendingTopics({ limit: 5 })),
      safeAtpCall('getFeed:quiet-posters', () => agent.app.bsky.feed.getFeed({ feed: QUIET_FEED_URI, limit: 20 })),
      safePromise('getRecentFeedItems', feedService.getRecentFeedItems(12)),
    ])
      .then(async (results) => {
        const [
          feedsRes,
          actorsRes,
          graphSuggestedRes,
          preferencesRes,
          whatsHotRes,
          trendingTopicsRes,
          quietRes,
          recentFeedRows,
        ] = results;

        const feedsData = (feedsRes as any)?.data;
        const actorsData = (actorsRes as any)?.data;
        const graphSuggestedData = (graphSuggestedRes as any)?.data;
        const preferencesData = (preferencesRes as any)?.data;
        const whatsHotData = (whatsHotRes as any)?.data;
        const trendingTopicsData = (trendingTopicsRes as any)?.data;
        const quietData = (quietRes as any)?.data;

        const whatsHotPosts = mapFeedViewItems(whatsHotData?.feed);
        const trendingTopicQueries = collectTrendingTopicQueries(trendingTopicsData?.topics, 5);

        const rawInterestTags = Array.isArray((preferencesRes as any)?.interests?.tags)
          ? (preferencesRes as any).interests.tags
          : Array.isArray(preferencesData?.interests?.tags)
            ? preferencesData.interests.tags
            : [];
        const interestTags = rawInterestTags
          .map((tag: unknown) => String(tag ?? '').trim())
          .filter(Boolean)
          .slice(0, 24);

        const rankedSuggestedFeeds = rankSuggestedFeeds({
          feeds: Array.isArray(feedsData?.feeds) ? feedsData.feeds : [],
          interestTags,
          trendingTopicQueries,
          whatsHotPosts,
        });

        const serverSuggestedActors = Array.isArray(actorsData?.actors)
          ? actorsData.actors as AppBskyActorDefs.ProfileView[]
          : [];
        const graphSuggestedActors = Array.isArray(graphSuggestedData?.suggestions)
          ? graphSuggestedData.suggestions as AppBskyActorDefs.ProfileView[]
          : [];

        const moderationPrefs = (preferencesRes as any)?.moderationPrefs ?? preferencesData?.moderationPrefs;
        const quietPosts = mapFeedViewItems(quietData?.feed);
        const recentFeedItems = Array.isArray(recentFeedRows)
          ? recentFeedRows.map(mapFeedRowToExploreFeedResult)
          : [];

        // First commit: render Explore as soon as the parallel fan-out
        // completes. Trending-topic posts and semantic actor suggestions
        // are best-effort enrichments and must not block the initial paint.
        if (disposed || requestVersion !== requestVersionRef.current) return;

        const initialAccumulators = new Map<string, ActorRecommendationAccumulator>();
        accumulateActorSource(initialAccumulators, serverSuggestedActors, 'server', 1.0);
        accumulateActorSource(initialAccumulators, graphSuggestedActors, 'graph', 0.9);
        const initialRecommendations = finalizeRecommendations({
          accumulators: initialAccumulators,
          moderationPrefs,
          selfDid: sessionDid ? normalizeDid(sessionDid) : null,
          maxResults: DEFAULT_ACTOR_RECOMMENDATION_LIMIT,
        });

        setState({
          ...buildExploreDiscoverState({
            suggestedFeeds: rankedSuggestedFeeds,
            suggestedActors: serverSuggestedActors,
            suggestedActorRecommendations: initialRecommendations,
            whatsHotPosts,
            trendingTopicPosts: [],
            quietPosts,
            recentFeedItems,
          }),
          loading: false,
        });

        // Second commit (best-effort): enrich with trending topic posts and
        // semantic actor suggestions once the additional fetches finish.
        const [trendingTopicPosts, semanticActors] = await Promise.all([
          loadTrendingTopicPosts(agent, trendingTopicsData?.topics).catch(() => [] as MockPost[]),
          loadSemanticSuggestedActors({
            agent,
            semanticQueries: createSemanticSeedQueries({
              whatsHotPosts,
              trendingTopicQueries: collectTrendingTopicQueries(trendingTopicsData?.topics, 3),
              maxQueries: 3,
            }),
          }).catch(() => [] as AppBskyActorDefs.ProfileView[]),
        ]);

        if (disposed || requestVersion !== requestVersionRef.current) return;

        const accumulators = new Map<string, ActorRecommendationAccumulator>();
        accumulateActorSource(accumulators, serverSuggestedActors, 'server', 1.0);
        accumulateActorSource(accumulators, graphSuggestedActors, 'graph', 0.9);
        accumulateActorSource(accumulators, semanticActors, 'semantic', 1.2);

        const recommendedActors = finalizeRecommendations({
          accumulators,
          moderationPrefs,
          selfDid: sessionDid ? normalizeDid(sessionDid) : null,
          maxResults: DEFAULT_ACTOR_RECOMMENDATION_LIMIT,
        });

        setState({
          ...buildExploreDiscoverState({
            suggestedFeeds: rankedSuggestedFeeds,
            suggestedActors: serverSuggestedActors,
            suggestedActorRecommendations: recommendedActors,
            whatsHotPosts,
            trendingTopicPosts,
            quietPosts,
            recentFeedItems,
          }),
          loading: false,
        });
      })
      .catch((error) => {
        if (disposed || requestVersion !== requestVersionRef.current) return;
        logDiscoverFailure('discover:aggregate', error);
        setState((current) => ({
          ...current,
          loading: false,
        }));
      });

    return () => {
      disposed = true;
    };
  }, [agent, enabled, sessionDid]);

  return useMemo(() => state, [state]);
}
