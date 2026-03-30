interface SensitiveMediaPolicy {
    blurSensitiveMedia: boolean;
    allowReveal: boolean;
    telemetryOptIn: boolean;
}
interface SensitiveMediaState {
    policy: SensitiveMediaPolicy;
    revealedPostIds: Record<string, true>;
    setPolicy: (patch: Partial<SensitiveMediaPolicy>) => void;
    revealPost: (postId: string) => void;
    hidePost: (postId: string) => void;
    clearReveals: () => void;
}
export declare const useSensitiveMediaStore: import("zustand").UseBoundStore<Omit<import("zustand").StoreApi<SensitiveMediaState>, "setState" | "persist"> & {
    setState(partial: SensitiveMediaState | Partial<SensitiveMediaState> | ((state: SensitiveMediaState) => SensitiveMediaState | Partial<SensitiveMediaState>), replace?: false | undefined): unknown;
    setState(state: SensitiveMediaState | ((state: SensitiveMediaState) => SensitiveMediaState), replace: true): unknown;
    persist: {
        setOptions: (options: Partial<import("zustand/middleware").PersistOptions<SensitiveMediaState, unknown, unknown>>) => void;
        clearStorage: () => void;
        rehydrate: () => Promise<void> | void;
        hasHydrated: () => boolean;
        onHydrate: (fn: (state: SensitiveMediaState) => void) => () => void;
        onFinishHydration: (fn: (state: SensitiveMediaState) => void) => () => void;
        getOptions: () => Partial<import("zustand/middleware").PersistOptions<SensitiveMediaState, unknown, unknown>>;
    };
}>;
export {};
//# sourceMappingURL=sensitiveMediaStore.d.ts.map