export interface PushPreferencesState {
    enabled: boolean;
    mentions: boolean;
    replies: boolean;
    follows: boolean;
    dms: boolean;
    moderation: boolean;
    digest: boolean;
    setEnabled: (value: boolean) => void;
    setMentions: (value: boolean) => void;
    setReplies: (value: boolean) => void;
    setFollows: (value: boolean) => void;
    setDms: (value: boolean) => void;
    setModeration: (value: boolean) => void;
    setDigest: (value: boolean) => void;
}
export declare const usePushPreferencesStore: import("zustand").UseBoundStore<Omit<import("zustand").StoreApi<PushPreferencesState>, "setState" | "persist"> & {
    setState(partial: PushPreferencesState | Partial<PushPreferencesState> | ((state: PushPreferencesState) => PushPreferencesState | Partial<PushPreferencesState>), replace?: false | undefined): unknown;
    setState(state: PushPreferencesState | ((state: PushPreferencesState) => PushPreferencesState), replace: true): unknown;
    persist: {
        setOptions: (options: Partial<import("zustand/middleware").PersistOptions<PushPreferencesState, PushPreferencesState, unknown>>) => void;
        clearStorage: () => void;
        rehydrate: () => Promise<void> | void;
        hasHydrated: () => boolean;
        onHydrate: (fn: (state: PushPreferencesState) => void) => () => void;
        onFinishHydration: (fn: (state: PushPreferencesState) => void) => () => void;
        getOptions: () => Partial<import("zustand/middleware").PersistOptions<PushPreferencesState, PushPreferencesState, unknown>>;
    };
}>;
//# sourceMappingURL=pushPreferencesStore.d.ts.map