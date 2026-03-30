import type { AppleEnhancementAvailability } from '../apple/types.js';
type CloudKitSyncState = 'idle' | 'syncing' | 'error' | 'unavailable';
interface AppleEnhancementState {
    availability: AppleEnhancementAvailability | null;
    /** User opted in to Apple-only convenience sync. */
    cloudKitEnabled: boolean;
    cloudKitSyncState: CloudKitSyncState;
    cloudKitLastSyncAt: string | null;
    cloudKitErrorMessage: string | null;
    setAvailability: (a: AppleEnhancementAvailability) => void;
    setCloudKitEnabled: (value: boolean) => void;
    setCloudKitSyncState: (state: CloudKitSyncState, errorMessage?: string) => void;
    recordCloudKitSync: () => void;
}
export declare const useAppleEnhancementStore: import("zustand").UseBoundStore<Omit<import("zustand").StoreApi<AppleEnhancementState>, "setState" | "persist"> & {
    setState(partial: AppleEnhancementState | Partial<AppleEnhancementState> | ((state: AppleEnhancementState) => AppleEnhancementState | Partial<AppleEnhancementState>), replace?: false | undefined): unknown;
    setState(state: AppleEnhancementState | ((state: AppleEnhancementState) => AppleEnhancementState), replace: true): unknown;
    persist: {
        setOptions: (options: Partial<import("zustand/middleware").PersistOptions<AppleEnhancementState, {
            cloudKitEnabled: boolean;
        }, unknown>>) => void;
        clearStorage: () => void;
        rehydrate: () => Promise<void> | void;
        hasHydrated: () => boolean;
        onHydrate: (fn: (state: AppleEnhancementState) => void) => () => void;
        onFinishHydration: (fn: (state: AppleEnhancementState) => void) => () => void;
        getOptions: () => Partial<import("zustand/middleware").PersistOptions<AppleEnhancementState, {
            cloudKitEnabled: boolean;
        }, unknown>>;
    };
}>;
export {};
//# sourceMappingURL=appleEnhancementStore.d.ts.map