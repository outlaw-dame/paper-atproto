import type { ComposerContext, ComposerGuidanceResult } from '../intelligence/composer/types.js';
interface UseComposerGuidanceOptions {
    surfaceId: string;
    context: ComposerContext;
    debounceMs?: number;
}
export declare function useComposerGuidance({ surfaceId, context, debounceMs, }: UseComposerGuidanceOptions): {
    draftId: string;
    guidance: ComposerGuidanceResult;
    dismissedAt: number | null;
    isDismissed: boolean;
    dismissGuidance: () => void;
    clearGuidance: () => void;
};
export {};
//# sourceMappingURL=useComposerGuidance.d.ts.map