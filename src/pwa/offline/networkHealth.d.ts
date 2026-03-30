import type { NetworkState } from '../types.js';
export interface NetworkHealthResult {
    state: NetworkState;
    checkedAt: string;
    latencyMs?: number;
}
export declare function probeNetworkHealth(): Promise<NetworkHealthResult>;
/** Schedule periodic health probes with bounded exponential backoff. */
export declare function startNetworkHealthPolling(): () => void;
//# sourceMappingURL=networkHealth.d.ts.map