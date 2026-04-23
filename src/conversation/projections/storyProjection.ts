import type { MockPost } from '../../data/mockData';
import type { EntityImpact } from '../../intelligence/interpolatorTypes';
import { summarizeStoryEntities } from '../../intelligence/entityLinking';
import { buildStandardProfileCardData } from '../../lib/profileCardData';
import type { ProfileCardData } from '../../types/profileCard';
import type { ConversationSession } from '../sessionTypes';
import {
  projectTimelineConversationHint,
  type TimelineConversationHint,
} from './timelineProjection';
import { buildInterpolatorSurfaceProjection } from '../adapters/interpolatorAdapter';
import type { CoverageGapSignal } from '../discovery/coverageGap';
import {
  canonicalStoryIdentityFromCluster,
  type StoryProtocol,
} from '../discovery/canonicalStory';
import { buildStoryClustersFromPosts } from '../discovery/storyClustering';
import {
  selectDiscoveryPresentationMode,
  type DiscoveryPresentationMode,
  type DiscoveryPresentationPolicyInput,
} from './discoveryModePolicy';

export type StoryProjectionBadge = 'divergent-coverage' | 'high-divergence';

export interface StoryProjectedPost {
  post: MockPost;
  rootUri: string;
  text: string;
  profileCardData: ProfileCardData | null;
  synopsisText?: string;
  conversationHint?: TimelineConversationHint;
  direction?: string;
  sourceSupportPresent?: boolean;
  factualSignalPresent?: boolean;
  isSessionBacked: boolean;
  domain?: string;
  imageUrl?: string;
}

export interface StoryEntityProjection {
  canonicalId: string;
  label: string;
  entityKind: string;
  mentionCount: number;
  aliasCount: number;
}

export interface CanonicalStoryProjection {
  id: string;
  protocols: StoryProtocol[];
  sourceThreadCount: number;
  confidence: number;
  signalCounts: {
    externalUrls: number;
    entityIds: number;
    quotedUris: number;
    rootUris: number;
  };
}

export interface StoryProjection {
  query: string;
  resultCount: number;
  sessionBackedCount: number;
  presentationMode: DiscoveryPresentationMode;
  clusterConfidence: number;
  coverageGap?: number;
  divergenceIndicator?: CoverageGapSignal['kind'];
  badges: StoryProjectionBadge[];
  canonicalStory: CanonicalStoryProjection | null;
  overview: StoryProjectedPost | null;
  bestSource: StoryProjectedPost | null;
  relatedEntities: {
    topics: StoryEntityProjection[];
    actors: StoryEntityProjection[];
  };
  relatedConversations: StoryProjectedPost[];
}

type StoryEntityAccumulator = StoryEntityProjection & {
  aliasSet: Set<string>;
};

function extractDomain(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

function normalizeEntityKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function toFallbackEntityLists(params: {
  posts: MockPost[];
  getTranslatedText: (post: MockPost) => string;
}): StoryProjection['relatedEntities'] {
  const entities = summarizeStoryEntities(
    params.posts.map((post) => params.getTranslatedText(post)),
  );

  return {
    topics: entities
      .filter((entity) => entity.entityKind === 'concept' || entity.entityKind === 'claim')
      .slice(0, 12),
    actors: entities
      .filter((entity) => entity.entityKind === 'person' || entity.entityKind === 'org')
      .slice(0, 8),
  };
}

function accumulateSessionEntity(
  bucket: Map<string, StoryEntityAccumulator>,
  entity: EntityImpact,
): void {
  const label = (entity.canonicalLabel ?? entity.entityText).trim();
  if (!label) return;

  const key = `${entity.entityKind}:${entity.canonicalEntityId ?? normalizeEntityKey(label)}`;
  const existing = bucket.get(key);
  if (existing) {
    existing.mentionCount += entity.mentionCount;
    existing.aliasSet.add(entity.entityText);
    if (entity.canonicalLabel) existing.aliasSet.add(entity.canonicalLabel);
    return;
  }

  bucket.set(key, {
    canonicalId: entity.canonicalEntityId ?? normalizeEntityKey(label),
    label,
    entityKind: entity.entityKind,
    mentionCount: entity.mentionCount,
    aliasCount: 1,
    aliasSet: new Set(
      [entity.entityText, entity.canonicalLabel].filter(
        (value): value is string => typeof value === 'string' && value.trim().length > 0,
      ),
    ),
  });
}

function toSessionEntityLists(
  sessions: ConversationSession[],
): StoryProjection['relatedEntities'] {
  const topics = new Map<string, StoryEntityAccumulator>();
  const actors = new Map<string, StoryEntityAccumulator>();

  for (const session of sessions) {
    for (const entity of session.entities.entityLandscape) {
      if (entity.entityKind === 'concept' || entity.entityKind === 'claim') {
        accumulateSessionEntity(topics, entity);
      } else if (entity.entityKind === 'person' || entity.entityKind === 'org') {
        accumulateSessionEntity(actors, entity);
      }
    }
  }

  const finalize = (
    bucket: Map<string, StoryEntityAccumulator>,
  ): StoryEntityProjection[] => [...bucket.values()]
    .map((entity) => ({
      canonicalId: entity.canonicalId,
      label: entity.label,
      entityKind: entity.entityKind,
      mentionCount: entity.mentionCount,
      aliasCount: Math.max(1, entity.aliasSet.size),
    }))
    .sort((left, right) => right.mentionCount - left.mentionCount);

  return {
    topics: finalize(topics).slice(0, 12),
    actors: finalize(actors).slice(0, 8),
  };
}

function mergeEntityLists(
  preferred: StoryEntityProjection[],
  fallback: StoryEntityProjection[],
  limit: number,
): StoryEntityProjection[] {
  const merged: StoryEntityProjection[] = [];
  const seen = new Set<string>();

  for (const entity of preferred) {
    const key = `${entity.entityKind}:${entity.canonicalId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entity);
    if (merged.length >= limit) return merged;
  }

  for (const entity of fallback) {
    const key = `${entity.entityKind}:${entity.canonicalId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entity);
    if (merged.length >= limit) break;
  }

  return merged;
}

function clusterSizeBucket(count: number): DiscoveryPresentationPolicyInput['clusterSize'] {
  if (count <= 1) return 'single';
  if (count <= 3) return 'small';
  if (count <= 8) return 'medium';
  return 'large';
}

function computeClusterConfidence(params: {
  posts: StoryProjectedPost[];
  sessions: ConversationSession[];
  clusterSignalConfidence: number;
}): number {
  const sessionConfidence = average(
    params.sessions
      .map((session) => session.interpretation.confidence?.interpretiveConfidence)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value)),
    0,
  );
  const sessionBackedRatio = ratio(
    params.posts.filter((post) => post.isSessionBacked).length,
    params.posts.length,
    0,
  );
  const resultDepth = Math.min(1, params.posts.length / 5);

  return clamp01(
    sessionConfidence > 0
      ? 0.60 * sessionConfidence
        + 0.15 * sessionBackedRatio
        + 0.15 * resultDepth
        + 0.10 * params.clusterSignalConfidence
      : 0.45 * params.clusterSignalConfidence + 0.35 * resultDepth,
  );
}

function buildCoverageBadges(coverageGapMagnitude: number): StoryProjectionBadge[] {
  if (coverageGapMagnitude > 0.7) return ['high-divergence'];
  if (coverageGapMagnitude > 0.5) return ['divergent-coverage'];
  return [];
}

function projectCanonicalStory(
  cluster: ReturnType<typeof buildStoryClustersFromPosts>[number] | undefined,
): CanonicalStoryProjection | null {
  if (!cluster) return null;
  const identity = canonicalStoryIdentityFromCluster(cluster);

  return {
    id: identity.id,
    protocols: identity.protocols,
    sourceThreadCount: identity.sourceThreads.length,
    confidence: identity.confidence,
    signalCounts: {
      externalUrls: identity.rootSignals.externalUrls.length,
      entityIds: identity.rootSignals.entityIds.length,
      quotedUris: identity.rootSignals.quotedUris.length,
      rootUris: identity.rootSignals.rootUris.length,
    },
  };
}

export function rootUriForStoryPost(post: MockPost): string {
  return post.threadRoot?.id ?? post.id;
}

function projectStoryPost(
  post: MockPost,
  getTranslatedText: (post: MockPost) => string,
  session?: ConversationSession | null,
): StoryProjectedPost {
  const mediaEmbed = post.embed?.type === 'external' || post.embed?.type === 'video'
    ? post.embed
    : null;
  const domain = mediaEmbed?.url ? extractDomain(mediaEmbed.url) : undefined;
  const imageUrl = post.images?.[0] ?? mediaEmbed?.thumb;
  const rootUri = rootUriForStoryPost(post);
  const interpolatorSurface = session ? buildInterpolatorSurfaceProjection(session) : null;
  const conversationHint = session
    ? (
        projectTimelineConversationHint(session, post.id)
        ?? projectTimelineConversationHint(session, session.graph.rootUri)
      )
    : null;
  const synopsisText = conversationHint?.compactSummary
    ?? interpolatorSurface?.writerSummary
    ?? interpolatorSurface?.summaryText;

  return {
    post,
    rootUri,
    text: getTranslatedText(post),
    profileCardData: buildStandardProfileCardData(post),
    ...(synopsisText ? { synopsisText } : {}),
    ...(conversationHint ? { conversationHint } : {}),
    ...(conversationHint?.direction ? { direction: conversationHint.direction } : {}),
    ...(conversationHint
      ? {
          sourceSupportPresent: conversationHint.sourceSupportPresent,
          factualSignalPresent: conversationHint.factualSignalPresent,
        }
      : {}),
    isSessionBacked: Boolean(session),
    ...(domain ? { domain } : {}),
    ...(imageUrl ? { imageUrl } : {}),
  };
}

export function projectStoryView(params: {
  query: string;
  posts: MockPost[];
  getTranslatedText: (post: MockPost) => string;
  sessionsByRootUri?: Record<string, ConversationSession | null | undefined>;
  coverageGapSignal?: CoverageGapSignal;
  userPresentationPreference?: DiscoveryPresentationPolicyInput['userPreference'];
  surface?: DiscoveryPresentationPolicyInput['surface'];
}): StoryProjection {
  const { query, posts, getTranslatedText, sessionsByRootUri = {} } = params;
  const projectedPosts = posts.map((post) =>
    projectStoryPost(
      post,
      getTranslatedText,
      sessionsByRootUri[rootUriForStoryPost(post)] ?? null,
    ));
  const overview = projectedPosts[0] ?? null;
  const fallbackEntities = toFallbackEntityLists({
    posts,
    getTranslatedText,
  });
  const sessions = Object.values(sessionsByRootUri).filter(
    (session): session is ConversationSession => session != null,
  );
  const sessionEntities = toSessionEntityLists(sessions);
  const coverageGapMagnitude = params.coverageGapSignal?.magnitude ?? 0;
  const storyClusters = buildStoryClustersFromPosts(posts);
  const primaryCluster = storyClusters.find(
    (cluster) => overview?.post.id && cluster.postUris.includes(overview.post.id),
  ) ?? storyClusters[0];
  const clusterSignalConfidence = storyClusters.reduce(
    (max, cluster) => Math.max(max, cluster.confidence),
    0,
  );
  const clusterConfidence = computeClusterConfidence({
    posts: projectedPosts,
    sessions,
    clusterSignalConfidence,
  });
  const presentationMode = selectDiscoveryPresentationMode({
    clusterConfidence,
    clusterSize: clusterSizeBucket(posts.length),
    coverageGapMagnitude,
    userPreference: params.userPresentationPreference ?? 'auto',
    surface: params.surface ?? 'explore_home',
  });

  return {
    query,
    resultCount: posts.length,
    sessionBackedCount: projectedPosts.filter((post) => post.isSessionBacked).length,
    presentationMode,
    clusterConfidence,
    ...(params.coverageGapSignal ? { coverageGap: coverageGapMagnitude } : {}),
    ...(params.coverageGapSignal && params.coverageGapSignal.kind !== 'none'
      ? { divergenceIndicator: params.coverageGapSignal.kind }
      : {}),
    badges: buildCoverageBadges(coverageGapMagnitude),
    canonicalStory: projectCanonicalStory(primaryCluster),
    overview,
    bestSource: overview,
    relatedEntities: {
      topics: mergeEntityLists(sessionEntities.topics, fallbackEntities.topics, 12),
      actors: mergeEntityLists(sessionEntities.actors, fallbackEntities.actors, 8),
    },
    relatedConversations: projectedPosts.slice(1, 6),
  };
}

function average(values: number[], fallback = 0): number {
  if (values.length === 0) return fallback;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function ratio(numerator: number, denominator: number, fallback = 0): number {
  if (denominator <= 0) return fallback;
  return clamp01(numerator / denominator);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
