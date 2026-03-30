import type { NetworkState } from '../types.js';
export interface OfflineState {
    network: NetworkState;
    lastOnlineAt?: string;
    lastOfflineAt?: string;
}
export declare function getOfflineState(): OfflineState;
export declare function subscribeOfflineState(listener: (state: OfflineState) => void): () => void;
/** Called by networkHealth probe to update degraded/online status. */
export declare function applyNetworkHealthResult(result: NetworkState): void;
//# sourceMappingURL=offlineState.d.ts.map