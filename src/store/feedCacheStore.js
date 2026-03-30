import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
const CACHE_KEY = 'feed-cache';
const CACHE_TTL = 1000 * 60 * 60; // Keep cache for 1 hour
const MAX_CACHED_MODES = 6; // Keep only 6 mode caches per account
export const useFeedCacheStore = create()(persist((set, get) => ({
    caches: {},
    currentAccountDid: null,
    currentMode: 'Following',
    saveCache: (accountDid, mode, cache) => {
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
    getCache: (accountDid, mode) => {
        const state = get();
        const key = `${accountDid}:${mode}`;
        const cache = state.caches[key];
        if (!cache)
            return undefined;
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
    clearCache: (accountDid, mode) => {
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
    setContext: (accountDid, mode) => {
        set({ currentAccountDid: accountDid, currentMode: mode });
    },
    incrementUnreadCount: (accountDid, mode, count) => {
        set((state) => {
            const key = `${accountDid}:${mode}`;
            const cache = state.caches[key];
            if (!cache)
                return state;
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
    resetUnreadCount: (accountDid, mode) => {
        set((state) => {
            const key = `${accountDid}:${mode}`;
            const cache = state.caches[key];
            if (!cache)
                return state;
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
    updateScrollPosition: (accountDid, mode, scrollPosition, topVisibleIndex) => {
        set((state) => {
            const key = `${accountDid}:${mode}`;
            const cache = state.caches[key];
            if (!cache)
                return state;
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
    invalidateCache: (accountDid, mode) => {
        set((state) => {
            const key = `${accountDid}:${mode}`;
            const cache = state.caches[key];
            if (!cache)
                return state;
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
}), {
    name: CACHE_KEY,
    storage: createJSONStorage(() => localStorage),
    version: 1,
    migrate: (state, version) => {
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
                const c = cache;
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
}));
//# sourceMappingURL=feedCacheStore.js.map