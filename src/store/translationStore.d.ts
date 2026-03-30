import type { TranslationResult } from '../lib/i18n/types.js';
import { type TranslationPolicy } from '../lib/i18n/policy.js';
type TranslationStoreState = {
    policy: TranslationPolicy;
    byId: Record<string, TranslationResult>;
    setPolicy: (partial: Partial<TranslationPolicy>) => void;
    upsertTranslation: (result: TranslationResult) => void;
    clearTranslation: (id: string) => void;
};
export declare const useTranslationStore: import("zustand").UseBoundStore<Omit<import("zustand").StoreApi<TranslationStoreState>, "setState" | "persist"> & {
    setState(partial: TranslationStoreState | Partial<TranslationStoreState> | ((state: TranslationStoreState) => TranslationStoreState | Partial<TranslationStoreState>), replace?: false | undefined): unknown;
    setState(state: TranslationStoreState | ((state: TranslationStoreState) => TranslationStoreState), replace: true): unknown;
    persist: {
        setOptions: (options: Partial<import("zustand/middleware").PersistOptions<TranslationStoreState, unknown, unknown>>) => void;
        clearStorage: () => void;
        rehydrate: () => Promise<void> | void;
        hasHydrated: () => boolean;
        onHydrate: (fn: (state: TranslationStoreState) => void) => () => void;
        onFinishHydration: (fn: (state: TranslationStoreState) => void) => () => void;
        getOptions: () => Partial<import("zustand/middleware").PersistOptions<TranslationStoreState, unknown, unknown>>;
    };
}>;
export {};
//# sourceMappingURL=translationStore.d.ts.map