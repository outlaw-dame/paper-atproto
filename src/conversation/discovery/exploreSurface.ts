import { sanitizeExploreSearchQuery } from './exploreSearch';

const DEFAULT_STORY_QUERY_MAX_CHARS = 160;
const DEFAULT_PEOPLE_QUERY_MAX_CHARS = 120;
const DEFAULT_HASHTAG_QUERY_MAX_CHARS = 80;
const DEFAULT_STORY_TITLE_MAX_CHARS = 80;

export const QUICK_FILTERS = ['Live', 'Topics', 'Conversations', 'Feeds', 'Sources'] as const;
export type QuickFilter = typeof QUICK_FILTERS[number];

export type DiscoverSectionKey =
  | 'live-sports'
  | 'sports-pulse'
  | 'feed-items'
  | 'top-stories'
  | 'trending-topics'
  | 'live-clusters'
  | 'feeds-to-follow'
  | 'sources';

export const QUICK_FILTER_SECTION_MAP: Record<QuickFilter, readonly DiscoverSectionKey[]> = {
  Live: ['live-sports', 'sports-pulse', 'live-clusters'],
  Topics: ['top-stories', 'trending-topics'],
  Conversations: ['top-stories', 'live-clusters'],
  Feeds: ['feed-items', 'feeds-to-follow'],
  Sources: ['sources', 'top-stories'],
} as const;

function sanitizeInlineQuery(rawQuery: string, maxChars: number): string {
  return rawQuery
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, Math.max(0, maxChars));
}

export function resolveVisibleDiscoverSections(
  activeFilter: QuickFilter | null,
): Set<DiscoverSectionKey> | null {
  return activeFilter ? new Set<DiscoverSectionKey>(QUICK_FILTER_SECTION_MAP[activeFilter]) : null;
}

export function shouldShowDiscoverSection(
  visibleDiscoverSections: Set<DiscoverSectionKey> | null,
  section: DiscoverSectionKey,
): boolean {
  return visibleDiscoverSections == null || visibleDiscoverSections.has(section);
}

export function normalizeSearchStoryNavigationQuery(
  rawQuery: string,
  maxChars = DEFAULT_STORY_QUERY_MAX_CHARS,
): string | null {
  const sanitized = sanitizeExploreSearchQuery(rawQuery, maxChars);
  return sanitized || null;
}

export function normalizeExternalExploreSearchQuery(
  rawQuery: string,
): string | null {
  const sanitized = sanitizeExploreSearchQuery(rawQuery, DEFAULT_HASHTAG_QUERY_MAX_CHARS);
  if (!sanitized) return null;

  const normalized = sanitized.replace(/^#+/, '').trim();
  return normalized ? `#${normalized}` : sanitized;
}

export function normalizeHashtagFeedNavigationQuery(
  rawTag: string,
  maxChars = DEFAULT_HASHTAG_QUERY_MAX_CHARS,
): string | null {
  const sanitized = sanitizeInlineQuery(rawTag, maxChars).replace(/^#+/, '');
  const normalized = sanitized.replace(/[^\p{L}\p{N}_-]+/gu, '');
  return normalized ? `#${normalized}` : null;
}

export function normalizePeopleFeedNavigationQuery(
  rawQuery: string,
  maxChars = DEFAULT_PEOPLE_QUERY_MAX_CHARS,
): string | null {
  const sanitized = sanitizeInlineQuery(rawQuery, maxChars);
  return sanitized || null;
}

export function getExploreStoryTitle(
  rawText: string,
  maxChars = DEFAULT_STORY_TITLE_MAX_CHARS,
): string {
  return sanitizeInlineQuery(rawText, maxChars);
}
