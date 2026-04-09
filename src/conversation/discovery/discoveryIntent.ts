import { detectVisualIntent } from '../../lib/searchIntent';

export type DiscoveryIntentKind = 'general' | 'hashtag' | 'people' | 'source' | 'feed' | 'visual';

export interface DiscoveryIntent {
  kind: DiscoveryIntentKind;
  confidence: number;
  reasons: string[];
  queryHasVisualIntent: boolean;
  normalizedQuery: string;
}

const HANDLE_PATTERN = /(^|\s)@[a-z0-9._-]{2,}|[a-z0-9._-]+\.bsky\.social/iu;
const DOMAIN_PATTERN = /(^|\s)(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?/iu;
const HASHTAG_PATTERN = /(^|\s)#[\p{L}\p{N}_-]{2,}/u;

function normalizeQuery(rawQuery: string): string {
  return rawQuery
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function hasAnyKeyword(query: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => query.includes(keyword));
}

export function classifyDiscoveryIntent(rawQuery: string): DiscoveryIntent {
  const normalizedQuery = normalizeQuery(rawQuery);
  const lowerQuery = normalizedQuery.toLowerCase();
  const reasons: string[] = [];
  const queryHasVisualIntent = detectVisualIntent(normalizedQuery);

  if (!normalizedQuery) {
    return {
      kind: 'general',
      confidence: 0,
      reasons: ['empty_query'],
      queryHasVisualIntent,
      normalizedQuery,
    };
  }

  if (HASHTAG_PATTERN.test(normalizedQuery)) {
    reasons.push('hashtag_query');
    return {
      kind: 'hashtag',
      confidence: 0.95,
      reasons,
      queryHasVisualIntent,
      normalizedQuery,
    };
  }

  if (HANDLE_PATTERN.test(normalizedQuery) || hasAnyKeyword(lowerQuery, ['people', 'person', 'profile', 'follow', 'creator', 'journalist'])) {
    reasons.push('people_signal');
    return {
      kind: 'people',
      confidence: clampConfidence(HANDLE_PATTERN.test(normalizedQuery) ? 0.9 : 0.75),
      reasons,
      queryHasVisualIntent,
      normalizedQuery,
    };
  }

  if (hasAnyKeyword(lowerQuery, ['podcast', 'episode', 'rss', 'feed', 'listen', 'newsletter'])) {
    reasons.push('feed_signal');
    return {
      kind: 'feed',
      confidence: 0.82,
      reasons,
      queryHasVisualIntent,
      normalizedQuery,
    };
  }

  if (DOMAIN_PATTERN.test(normalizedQuery) || hasAnyKeyword(lowerQuery, ['source', 'site', 'domain', 'from:', 'url'])) {
    reasons.push('source_signal');
    return {
      kind: 'source',
      confidence: clampConfidence(DOMAIN_PATTERN.test(normalizedQuery) ? 0.86 : 0.72),
      reasons,
      queryHasVisualIntent,
      normalizedQuery,
    };
  }

  if (queryHasVisualIntent) {
    reasons.push('visual_signal');
    return {
      kind: 'visual',
      confidence: 0.78,
      reasons,
      queryHasVisualIntent,
      normalizedQuery,
    };
  }

  return {
    kind: 'general',
    confidence: 0.6,
    reasons: ['default_general'],
    queryHasVisualIntent,
    normalizedQuery,
  };
}
