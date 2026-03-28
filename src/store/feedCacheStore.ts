import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { MockPost } from '../data/mockData.js';

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
  updateScrollPosition: (accountDid: string, mode: string, scrollPosition: number, topVisibleIndex: number) => void;
  invalidateCache: (accountDid: string, mode: string) => void;
}

const CACHE_KEY = 'feed-cache';
const CACHE_TTL = 1000 * 60 * 60; // Keep cache for 1 hour
const MAX_CACHED_MODES = 6; // Keep only 6 mode caches per account

export const useFeedCacheStore = create<FeedCacheState>()(
  persist(
    (set, get) => ({
      caches: {},
      currentAccountDid: null,
      currentMode: 'Following',

      saveCache: (accountDid: string, mode: string, cache: FeedCacheEntry) => {
        set((state) => {
          const key = `${accountDid}:${mode}`;
          const updated = {
            ...state.caches,
            [key]: {
              ...cache,
              savedAt: Date.now(),
              isInvalidated: false,
            },
          };

          // Cleanup old caches for this account (keep only recent modes)
          const accountCaches = Object.entries(updated)
            .filter(([k]) => k.startsWith(`${accountDid}:`))
            .sort((a, b) => (updated[b[0]]?.savedAt ?? 0) - (updated[a[0]]?.savedAt ?? 0));

          if (accountCaches.length > MAX_CACHED_MODES) {
            accountCaches.slice(MAX_CACHED_MODES).forEach(([k]) => {
              delete updated[k];
            });
          }

          return { caches: updated };
        });
      },

      getCache: (accountDid: string, mode: string) => {
        const state = get();
        const key = `${accountDid}:${mode}`;
        const cache = state.caches[key];

        if (!cache) return undefined;

        // Check if cache has expired
        const age = Date.now() - (cache.savedAt ?? 0);
        if (age > CACHE_TTL) {
          // Don't return expired cache, but keep it for metrics
          return undefined;
        }

        // Return cache only if not invalidated
        if (cache.isInvalidated) {
          return undefined;
        }

        return cache;
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
                unreadCount: Math.max(0, cache.unreadCount + count),
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
      ) => {
        set((state) => {
          const key = `${accountDid}:${mode}`;
          const cache = state.caches[key];
          if (!cache) return state;

          return {
            caches: {
              ...state.caches,
              [key]: {
                ...cache,
                scrollPosition,
                topVisibleIndex,
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
              },
            },
          };
        });
      },
    }),
    {
      name: CACHE_KEY,
      storage: createJSONStorage(() => localStorage),
      version: 1,
      migrate: (state: any, version: number) => {
        if (version === 0) {
          return { caches: {}, currentAccountDid: null, currentMode: 'Following' };
        }
        return state;
      },
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.warn('[FeedCache] Rehydration error:', error);
        }
        if (state && typeof state.caches === 'object') {
          // Validate cache structure
          const now = Date.now();
          for (const [key, cache] of Object.entries(state.caches)) {
            const c = cache as any;
            if (!Array.isArray(c.posts) || !Number.isFinite(c.scrollPosition)) {
              delete state.caches[key];
              continue;
            }
            // Clear very old caches (>1 hour)
            if (now - (c.savedAt ?? 0) > CACHE_TTL) {
              delete state.caches[key];
            }
          }
        }
      },
    },
  ),
);
