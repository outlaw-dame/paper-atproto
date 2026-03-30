export declare const MUTE_DURATIONS: readonly [{
    readonly label: "Indefinite";
    readonly valueMs: null;
}, {
    readonly label: "1 hour";
    readonly valueMs: number;
}, {
    readonly label: "8 hours";
    readonly valueMs: number;
}, {
    readonly label: "1 day";
    readonly valueMs: number;
}, {
    readonly label: "3 days";
    readonly valueMs: number;
}, {
    readonly label: "7 days";
    readonly valueMs: number;
}, {
    readonly label: "30 days";
    readonly valueMs: number;
}];
export type MuteDuration = typeof MUTE_DURATIONS[number]['valueMs'];
interface ModerationState {
    /** DID → expiry timestamp ms (0 = indefinite/no-expiry) */
    timedMutes: Record<string, number>;
    /** DID → rkey of app.bsky.graph.block record */
    blockRkeys: Record<string, string>;
    addTimedMute: (did: string, durationMs: number | null) => void;
    removeTimedMute: (did: string) => void;
    /** Returns DIDs whose timed mute has expired */
    getExpiredMutes: () => string[];
    setBlockRkey: (did: string, rkey: string) => void;
    deleteBlockRkey: (did: string) => void;
}
export declare const useModerationStore: import("zustand").UseBoundStore<import("zustand").StoreApi<ModerationState>>;
/** Format ms-until-expiry as a human-readable string. */
export declare function formatMuteExpiry(expiresAt: number): string;
export {};
//# sourceMappingURL=moderationStore.d.ts.map