import type { MockPost } from '../../data/mockData';
import { summarizeStoryEntities } from '../../intelligence/entityLinking';
import { buildStandardProfileCardData } from '../../lib/profileCardData';
import type { ProfileCardData } from '../../types/profileCard';

export interface StoryProjectedPost {
  post: MockPost;
  text: string;
  profileCardData: ProfileCardData | null;
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
  overview: StoryProjectedPost | null;
  bestSource: StoryProjectedPost | null;
  relatedEntities: {
    topics: StoryEntityProjection[];
    actors: StoryEntityProjection[];
  };
  relatedConversations: StoryProjectedPost[];
}

function extractDomain(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

function projectStoryPost(
  post: MockPost,
  getTranslatedText: (post: MockPost) => string,
): StoryProjectedPost {
  const mediaEmbed = post.embed?.type === 'external' || post.embed?.type === 'video'
    ? post.embed
    : null;
  const domain = mediaEmbed?.url ? extractDomain(mediaEmbed.url) : undefined;
  const imageUrl = post.images?.[0] ?? mediaEmbed?.thumb;

  return {
    post,
    text: getTranslatedText(post),
    profileCardData: buildStandardProfileCardData(post),
    ...(domain ? { domain } : {}),
    ...(imageUrl ? { imageUrl } : {}),
  };
}

export function projectStoryView(params: {
  query: string;
  posts: MockPost[];
  getTranslatedText: (post: MockPost) => string;
}): StoryProjection {
  const { query, posts, getTranslatedText } = params;
  const overview = posts[0] ? projectStoryPost(posts[0], getTranslatedText) : null;
  const entities = summarizeStoryEntities(
    posts.map((post) => getTranslatedText(post)),
  );

  return {
    query,
    resultCount: posts.length,
    overview,
    bestSource: overview,
    relatedEntities: {
      topics: entities
        .filter((entity) => entity.entityKind === 'concept' || entity.entityKind === 'claim')
        .slice(0, 12),
      actors: entities
        .filter((entity) => entity.entityKind === 'person' || entity.entityKind === 'org')
        .slice(0, 8),
    },
    relatedConversations: posts
      .slice(1, 6)
      .map((post) => projectStoryPost(post, getTranslatedText)),
  };
}
