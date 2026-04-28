import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { MockPost } from '../data/mockData';

/**
 * Feed Cache Store — Implements Ice Cubes-like feed position persistence.
 *
 * Features:
 * - Saves feed posts, cursor, and scroll position per mode + account
 * - Restores to last known position on app/account switch
 * - Tracks unread posts fetched after saved position
 * - Automatic cleanup of old cached feeds
 * - Error recovery with fallback to empty cache
 */

interface FeedCacheEntry {
  /** Posts in this feed cache */
  posts: MockPost[];
  /** Pagination cursor for fetching next posts */
  cursor?: string;
  /** Scroll position (pixels from top) */
  scrollPosition: number;
  /** Index of topmost visible post (for unread tracking) */
  topVisibleIndex: number;
  /** Stable id for topmost visible post when known */
  topVisiblePostId?: string;
  /** Count of unread posts fetched above topVisibleIndex */
  unreadCount: number;
  /** Timestamp when cache was last saved */
  savedAt: number;
  /** Whether this cache has been invalidated (e.g., due to feed refresh) */
  isInvalidated: boolean;
}

interface FeedCacheState {
  // Key: `${accountDid}:${mode}` (e.g., "did:plc:abc123:Following")
  caches: Record<string, FeedCacheEntry>;

  // Current feed context
  currentAccountDid: string | null;
  currentMode: string;

  // Actions
  saveCache: (accountDid: string, mode: string, cache: FeedCacheEntry) => void;
  getCache: (accountDid: string, mode: string) => FeedCacheEntry | undefined;
  clearCache: (accountDid: string, mode: string) => void;
  clearAllCaches: () => void;
  setContext: (accountDid: string, mode: string) => void;
  incrementUnreadCount: (accountDid: string, mode: string, count: number) => void;
  resetUnreadCount: (accountDid: string, mode: string) => void;
  setUnreadCount: (accountDid: string, mode: string, count: number) => void;
  updateScrollPosition: (
    accountDid: string,
    mode: string,
    scrollPosition: number,
    topVisibleIndex: number,
    topVisiblePostId?: string,
  ) => void;
  invalidateCache: (accountDid: string, mode: string) => void;
}

const CACHE_KEY = 'feed-cache';
const CACHE_TTL = 1000 * 60 * 60; // Keep cache for 1 hour
const MAX_CACHED_MODES = 6; // Keep only 6 mode caches per account
const MAX_CURSOR_LENGTH = 1024;
const MAX_TOP_VISIBLE_POST_ID_LENGTH = 512;
const MAX_MODE_LENGTH = 64;
const MAX_ACCOUNT_DID_LENGTH = 190;
const MAX_SCROLL_POSITION = 5_000_000;
const MAX_UNREAD_COUNT = 10_000;

type PersistedFeedCacheState = Pick<FeedCacheState, 'caches' | 'currentAccountDid' | 'currentMode'>;

function clampNonNegativeInteger(value: unknown, max: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Math.min(max, Math.floor(numeric));
}

function sanitizeBoundedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/[\u0000-\u001f\u007f]/g, ' ');
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

function extractAccountDidFromCacheKey(key: string): string {
  const separatorIndex = key.lastIndexOf(':');
  if (separatorIndex <= 0) return key;
  return key.slice(0, separatorIndex);
}

export function sanitizeFeedCacheEntry(value: unknown, now = Date.now()): FeedCacheEntry | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<FeedCacheEntry>;
  if (!Array.isArray(candidate.posts)) return null;

  const savedAt = Number(candidate.savedAt ?? NaN);
  if (!Number.isFinite(savedAt) || savedAt <= 0 || now - savedAt > CACHE_TTL) {
    return null;
  }

  const sanitizedCursor = sanitizeBoundedString(candidate.cursor, MAX_CURSOR_LENGTH);
  const sanitizedTopVisiblePostId = sanitizeBoundedString(candidate.topVisiblePostId, MAX_TOP_VISIBLE_POST_ID_LENGTH);

  return {
    posts: candidate.posts,
    ...(sanitizedCursor ? { cursor: sanitizedCursor } : {}),
    scrollPosition: clampNonNegativeInteger(candidate.scrollPosition, MAX_SCROLL_POSITION),
    topVisibleIndex: clampNonNegativeInteger(candidate.topVisibleIndex, Number.MAX_SAFE_INTEGER),
    ...(sanitizedTopVisiblePostId
      ? { topVisiblePostId: sanitizedTopVisiblePostId }
      : {}),
    unreadCount: clampNonNegativeInteger(candidate.unreadCount, MAX_UNREAD_COUNT),
    savedAt,
    isInvalidated: candidate.isInvalidated === true,
  };
}

function pruneCaches(caches: Record<string, FeedCacheEntry>, now = Date.now()): Record<string, FeedCacheEntry> {
  const validEntries = Object.entries(caches)
    .flatMap(([key, value]) => {
      const entry = sanitizeFeedCacheEntry(value, now);
      if (!entry) return [];
      return [[key, entry] as const];
    });

  const grouped = new Map<string, Array<readonly [string, FeedCacheEntry]>>();
  for (const entry of validEntries) {
    const [key] = entry;
    const accountDid = extractAccountDidFromCacheKey(key);
    const bucket = grouped.get(accountDid) ?? [];
    bucket.push(entry);
    grouped.set(accountDid, bucket);
  }

  const next: Record<string, FeedCacheEntry> = {};
  for (const bucket of grouped.values()) {
    bucket
      .sort((a, b) => b[1].savedAt - a[1].savedAt)
      .slice(0, MAX_CACHED_MODES)
      .forEach(([key, entry]) => {
        next[key] = entry;
      });
  }

  return next;
}

export function sanitizePersistedFeedCacheState(value: unknown, now = Date.now()): PersistedFeedCacheState {
  const source = value && typeof value === 'object' ? value as Partial<PersistedFeedCacheState> : {};
  return {
    caches: pruneCaches(source.caches && typeof source.caches === 'object' ? source.caches as Record<string, FeedCacheEntry> : {}, now),
    currentAccountDid: sanitizeBoundedString(source.currentAccountDid, MAX_ACCOUNT_DID_LENGTH) ?? null,
    currentMode: sanitizeBoundedString(source.currentMode, MAX_MODE_LENGTH) ?? 'Following',
  };
}

export const useFeedCacheStore = create<FeedCacheState>()(
  persist(
    (set, get) => ({
      caches: {},
      currentAccountDid: null,
      currentMode: 'Following',

      saveCache: (accountDid: string, mode: string, cache: FeedCacheEntry) => {
        set((state) => {
          const key = `${accountDid}:${mode}`;
          const sanitizedCache = sanitizeFeedCacheEntry({
            ...cache,
            savedAt: Date.now(),
            isInvalidated: false,
          });
          if (!sanitizedCache) return state;

          const updated = {
            ...pruneCaches(state.caches),
            [key]: sanitizedCache,
          };

          return { caches: pruneCaches(updated) };
        });
      },

      getCache: (accountDid: string, mode: string) => {
        const state = get();
        const key = `${accountDid}:${mode}`;
        const cache = state.caches[key];

        if (!cache) return undefined;

        const sanitizedCache = sanitizeFeedCacheEntry(cache);
        if (!sanitizedCache || sanitizedCache.isInvalidated) {
          return undefined;
        }

        return sanitizedCache;
      },

      clearCache: (accountDid: string, mode: string) => {
        set((state) => {
          const key = `${accountDid}:${mode}`;
          const updated = { ...state.caches };
          delete updated[key];
          return { caches: updated };
        });
      },

      clearAllCaches: () => {
        set({ caches: {} });
      },

      setContext: (accountDid: string, mode: string) => {
        set({ currentAccountDid: accountDid, currentMode: mode });
      },

      incrementUnreadCount: (accountDid: string, mode: string, count: number) => {
        set((state) => {
          const key = `${accountDid}:${mode}`;
          const cache = state.caches[key];
          if (!cache) return state;

          return {
            caches: {
              ...state.caches,
              [key]: {
                ...cache,
                unreadCount: Math.min(MAX_UNREAD_COUNT, Math.max(0, cache.unreadCount + count)),
                savedAt: Date.now(),
              },
            },
          };
        });
      },

      resetUnreadCount: (accountDid: string, mode: string) => {
        set((state) => {
          const key = `${accountDid}:${mode}`;
          const cache = state.caches[key];
          if (!cache) return state;

          return {
            caches: {
              ...state.caches,
              [key]: {
                ...cache,
                unreadCount: 0,
                savedAt: Date.now(),
              },
            },
          };
        });
      },

      setUnreadCount: (accountDid: string, mode: string, count: number) => {
        set((state) => {
          const key = `${accountDid}:${mode}`;
          const cache = state.caches[key];
          if (!cache) return state;

          return {
            caches: {
              ...state.caches,
              [key]: {
                ...cache,
                unreadCount: clampNonNegativeInteger(count, MAX_UNREAD_COUNT),
                savedAt: Date.now(),
              },
            },
          };
        });
      },

      updateScrollPosition: (
        accountDid: string,
        mode: string,
        scrollPosition: number,
        topVisibleIndex: number,
        topVisiblePostId?: string,
      ) => {
        set((state) => {
          const key = `${accountDid}:${mode}`;
          const cache = state.caches[key];
          if (!cache) return state;
          const { topVisiblePostId: _previousTopVisiblePostId, ...cacheWithoutTopVisiblePostId } = cache;
          const sanitizedTopVisiblePostId = sanitizeBoundedString(topVisiblePostId, MAX_TOP_VISIBLE_POST_ID_LENGTH);

          return {
            caches: {
              ...state.caches,
              [key]: {
                ...cacheWithoutTopVisiblePostId,
                scrollPosition: clampNonNegativeInteger(scrollPosition, MAX_SCROLL_POSITION),
                topVisibleIndex: clampNonNegativeInteger(topVisibleIndex, Number.MAX_SAFE_INTEGER),
                ...(sanitizedTopVisiblePostId ? { topVisiblePostId: sanitizedTopVisiblePostId } : {}),
                savedAt: Date.now(),
              },
            },
          };
        });
      },

      invalidateCache: (accountDid: string, mode: string) => {
        set((state) => {
          const key = `${accountDid}:${mode}`;
          const cache = state.caches[key];
          if (!cache) return state;

          return {
            caches: {
              ...state.caches,
              [key]: {
                ...cache,
                isInvalidated: true,
                savedAt: Date.now(),
              },
            },
          };
        });
      },
    }),
    {
      name: CACHE_KEY,
      storage: createJSONStorage(() => localStorage),
      version: 2,
      migrate: (persistedState) => sanitizePersistedFeedCacheState(persistedState),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.warn('[FeedCache] Rehydration error:', error);
        }
        if (state) {
          Object.assign(state, sanitizePersistedFeedCacheState(state));
        }
      },
    },
  ),
);
