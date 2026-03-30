import type { FilterContext, KeywordFilterRule, FilterAction } from '../lib/contentFilters/types.js';
type NewFilterRule = {
    phrase: string;
    wholeWord?: boolean;
    contexts?: FilterContext[];
    action?: FilterAction;
    enabled?: boolean;
    expiresAt?: string | null;
    semantic?: boolean;
    semanticThreshold?: number;
};
interface ContentFilterState {
    rules: KeywordFilterRule[];
    addRule: (rule: NewFilterRule) => void;
    removeRule: (id: string) => void;
    updateRule: (id: string, patch: Partial<KeywordFilterRule>) => void;
    toggleRule: (id: string, enabled: boolean) => void;
}
export declare const useContentFilterStore: import("zustand").UseBoundStore<Omit<import("zustand").StoreApi<ContentFilterState>, "setState" | "persist"> & {
    setState(partial: ContentFilterState | Partial<ContentFilterState> | ((state: ContentFilterState) => ContentFilterState | Partial<ContentFilterState>), replace?: false | undefined): unknown;
    setState(state: ContentFilterState | ((state: ContentFilterState) => ContentFilterState), replace: true): unknown;
    persist: {
        setOptions: (options: Partial<import("zustand/middleware").PersistOptions<ContentFilterState, unknown, unknown>>) => void;
        clearStorage: () => void;
        rehydrate: () => Promise<void> | void;
        hasHydrated: () => boolean;
        onHydrate: (fn: (state: ContentFilterState) => void) => () => void;
        onFinishHydration: (fn: (state: ContentFilterState) => void) => () => void;
        getOptions: () => Partial<import("zustand/middleware").PersistOptions<ContentFilterState, unknown, unknown>>;
    };
}>;
export {};
//# sourceMappingURL=contentFilterStore.d.ts.map