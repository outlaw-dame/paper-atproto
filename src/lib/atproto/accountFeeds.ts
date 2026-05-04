import type { Agent, AppBskyActorDefs, AppBskyFeedDefs } from '@atproto/api';
import { atpCall } from './client';

export type AccountFeedKind = 'feed' | 'list' | 'timeline';

export interface AccountFeedSource {
  id: string;
  kind: AccountFeedKind;
  value: string;
  pinned: boolean;
  title: string;
  description?: string;
  avatar?: string;
}

const MAX_FEED_ID_LENGTH = 128;
const MAX_FEED_VALUE_LENGTH = 1024;
const MAX_FEED_TITLE_LENGTH = 160;
const MAX_FEED_DESCRIPTION_LENGTH = 280;
const FEED_GENERATOR_BATCH_SIZE = 25;

function sanitizeBoundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/[\u0000-\u001f\u007f]/g, ' ');
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function isSupportedKind(value: unknown): value is AccountFeedKind {
  return value === 'feed' || value === 'list' || value === 'timeline';
}

function titleFromTimelineValue(value: string): string {
  if (value === 'following') return 'Following';
  if (value === 'discover') return 'Discover';
  return `Timeline: ${value}`;
}

export function sanitizeSavedFeed(value: unknown): AppBskyActorDefs.SavedFeed | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<AppBskyActorDefs.SavedFeed>;

  const id = sanitizeBoundedString(candidate.id, MAX_FEED_ID_LENGTH);
  const kind = candidate.type;
  const feedValue = sanitizeBoundedString(candidate.value, MAX_FEED_VALUE_LENGTH);
  if (!id || !feedValue || !isSupportedKind(kind)) {
    return null;
  }

  return {
    id,
    type: kind,
    value: feedValue,
    pinned: candidate.pinned === true,
  };
}

export function normalizeSavedFeeds(items: unknown): AppBskyActorDefs.SavedFeed[] {
  if (!Array.isArray(items)) {
    return [];
  }

  const dedupedById = new Map<string, AppBskyActorDefs.SavedFeed>();
  for (const item of items) {
    const sanitized = sanitizeSavedFeed(item);
    if (!sanitized) continue;
    dedupedById.set(sanitized.id, sanitized);
  }

  return [...dedupedById.values()].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return 0;
  });
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

async function loadFeedGeneratorMetadata(
  agent: Agent,
  uris: string[],
): Promise<Map<string, AppBskyFeedDefs.GeneratorView>> {
  const dedupedUris = [...new Set(uris)];
  if (dedupedUris.length === 0) {
    return new Map();
  }

  const metadata = new Map<string, AppBskyFeedDefs.GeneratorView>();
  const batches = chunk(dedupedUris, FEED_GENERATOR_BATCH_SIZE);
  for (const batch of batches) {
    const response = await atpCall(
      () => agent.app.bsky.feed.getFeedGenerators({ feeds: batch }),
      { maxAttempts: 4, baseDelayMs: 250, capDelayMs: 8_000 },
    );
    for (const feed of response.data.feeds ?? []) {
      metadata.set(feed.uri, feed);
    }
  }

  return metadata;
}

interface ListMetadata {
  title: string;
  avatar?: string;
  description?: string;
}

async function loadListMetadata(
  agent: Agent,
  uris: string[],
): Promise<Map<string, ListMetadata>> {
  const dedupedUris = [...new Set(uris)];
  if (dedupedUris.length === 0) {
    return new Map();
  }

  const metadata = new Map<string, ListMetadata>();
  await Promise.all(
    dedupedUris.map(async (uri) => {
      try {
        const response = await atpCall(
          () => agent.app.bsky.graph.getList({ list: uri, limit: 1 }),
          { maxAttempts: 3, baseDelayMs: 200, capDelayMs: 4_000 },
        );
        const list = response.data.list;
        if (list?.name) {
          metadata.set(uri, {
            title: list.name,
            ...(list.avatar ? { avatar: list.avatar } : {}),
            ...(list.description ? { description: list.description } : {}),
          });
        }
      } catch {
        // Silently fall back to default title for lists that can't be resolved.
      }
    }),
  );

  return metadata;
}

function mapSavedFeedToSource(
  savedFeed: AppBskyActorDefs.SavedFeed,
  generatorMetadata: Map<string, AppBskyFeedDefs.GeneratorView>,
  listMetadata: Map<string, ListMetadata>,
): AccountFeedSource {
  if (savedFeed.type === 'timeline') {
    const timelineTitle = titleFromTimelineValue(savedFeed.value);
    return {
      id: savedFeed.id,
      kind: 'timeline',
      value: savedFeed.value,
      pinned: savedFeed.pinned,
      title: timelineTitle,
    };
  }

  const kind: AccountFeedKind = savedFeed.type === 'feed' ? 'feed' : 'list';
  const matchedGenerator = kind === 'feed'
    ? generatorMetadata.get(savedFeed.value)
    : undefined;
  const matchedList = kind === 'list'
    ? listMetadata.get(savedFeed.value)
    : undefined;

  const defaultTitle = kind === 'feed' ? 'Custom Feed' : 'Saved List';
  const title = sanitizeBoundedString(
    matchedGenerator?.displayName ?? matchedGenerator?.did ?? matchedList?.title ?? defaultTitle,
    MAX_FEED_TITLE_LENGTH,
  ) ?? defaultTitle;
  const description = sanitizeBoundedString(
    matchedGenerator?.description ?? matchedList?.description,
    MAX_FEED_DESCRIPTION_LENGTH,
  ) ?? undefined;
  const avatar = sanitizeBoundedString(
    matchedGenerator?.avatar ?? matchedList?.avatar,
    MAX_FEED_VALUE_LENGTH,
  ) ?? undefined;

  return {
    id: savedFeed.id,
    kind,
    value: savedFeed.value,
    pinned: savedFeed.pinned,
    title,
    ...(description ? { description } : {}),
    ...(avatar ? { avatar } : {}),
  };
}

export async function loadAccountFeedSources(agent: Agent): Promise<AccountFeedSource[]> {
  const preferences = await atpCall(
    () => agent.getPreferences(),
    { maxAttempts: 4, baseDelayMs: 250, capDelayMs: 8_000 },
  );

  const normalizedSavedFeeds = normalizeSavedFeeds(preferences.savedFeeds ?? []);

  const feedUris = normalizedSavedFeeds
    .filter((entry) => entry.type === 'feed')
    .map((entry) => entry.value);

  const listUris = normalizedSavedFeeds
    .filter((entry) => entry.type === 'list')
    .map((entry) => entry.value);

  const [generatorMetadata, listMetadata] = await Promise.all([
    loadFeedGeneratorMetadata(agent, feedUris),
    loadListMetadata(agent, listUris),
  ]);

  return normalizedSavedFeeds.map((entry) => mapSavedFeedToSource(entry, generatorMetadata, listMetadata));
}
