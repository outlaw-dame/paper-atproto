import type { ComposerGuidanceResult } from '../intelligence/composer/types.js';
interface ComposerGuidanceStore {
    byDraftId: Record<string, ComposerGuidanceResult>;
    dismissedByDraftId: Record<string, number>;
    setGuidance: (draftId: string, result: ComposerGuidanceResult) => void;
    dismissGuidance: (draftId: string) => void;
    clearGuidance: (draftId: string) => void;
}
export declare const useComposerGuidanceStore: import("zustand").UseBoundStore<import("zustand").StoreApi<ComposerGuidanceStore>>;
export {};
//# sourceMappingURL=composerGuidanceStore.d.ts.map