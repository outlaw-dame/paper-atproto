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
    caches: Record<string, FeedCacheEntry>;
    currentAccountDid: string | null;
    currentMode: string;
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
export declare const useFeedCacheStore: import("zustand").UseBoundStore<Omit<import("zustand").StoreApi<FeedCacheState>, "setState" | "persist"> & {
    setState(partial: FeedCacheState | Partial<FeedCacheState> | ((state: FeedCacheState) => FeedCacheState | Partial<FeedCacheState>), replace?: false | undefined): unknown;
    setState(state: FeedCacheState | ((state: FeedCacheState) => FeedCacheState), replace: true): unknown;
    persist: {
        setOptions: (options: Partial<import("zustand/middleware").PersistOptions<FeedCacheState, any, unknown>>) => void;
        clearStorage: () => void;
        rehydrate: () => Promise<void> | void;
        hasHydrated: () => boolean;
        onHydrate: (fn: (state: FeedCacheState) => void) => () => void;
        onFinishHydration: (fn: (state: FeedCacheState) => void) => () => void;
        getOptions: () => Partial<import("zustand/middleware").PersistOptions<FeedCacheState, any, unknown>>;
    };
}>;
export {};
//# sourceMappingURL=feedCacheStore.d.ts.map