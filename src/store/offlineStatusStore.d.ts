import type { NetworkState, CacheProvenance } from '../pwa/types.js';
interface OfflineStatusState {
    network: NetworkState;
    lastOnlineAt: string | null;
    lastOfflineAt: string | null;
    /** UI hint for feed cards — set by feed/sync layer, not this store. */
    feedProvenance: CacheProvenance;
    setNetwork: (state: NetworkState, timestamps?: {
        onlineAt?: string | undefined;
        offlineAt?: string | undefined;
    }) => void;
    setFeedProvenance: (p: CacheProvenance) => void;
}
export declare const useOfflineStatusStore: import("zustand").UseBoundStore<import("zustand").StoreApi<OfflineStatusState>>;
export {};
//# sourceMappingURL=offlineStatusStore.d.ts.map