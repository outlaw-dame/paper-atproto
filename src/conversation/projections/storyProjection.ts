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

export interface StoryProjection {
  query: string;
  resultCount: number;
  sessionBackedCount: number;
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
  const sessionEntities = toSessionEntityLists(
    Object.values(sessionsByRootUri).filter(
      (session): session is ConversationSession => session != null,
    ),
  );

  return {
    query,
    resultCount: posts.length,
    sessionBackedCount: projectedPosts.filter((post) => post.isSessionBacked).length,
    overview,
    bestSource: overview,
    relatedEntities: {
      topics: mergeEntityLists(sessionEntities.topics, fallbackEntities.topics, 12),
      actors: mergeEntityLists(sessionEntities.actors, fallbackEntities.actors, 8),
    },
    relatedConversations: projectedPosts.slice(1, 6),
  };
}
