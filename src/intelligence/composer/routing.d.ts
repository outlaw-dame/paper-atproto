import type { ComposerGuidanceResult, ComposerMode } from './types.js';
export declare function getComposerModelDebounceMs(mode: ComposerMode, overrideMs?: number): number;
export declare function getComposerWriterDebounceMs(mode: ComposerMode): number;
export declare function hasComposerModelCoverage(guidance: ComposerGuidanceResult): boolean;
export declare function hasComposerWriterCoverage(guidance: ComposerGuidanceResult): boolean;
export declare function shouldRunComposerModelStageForDraft(mode: ComposerMode, draftText: string, guidance: ComposerGuidanceResult): boolean;
export declare function shouldRunComposerWriterStage(mode: ComposerMode, draftText: string, guidance: ComposerGuidanceResult, dismissedAt: number | null): boolean;
export declare function shouldReuseCachedComposerGuidance(mode: ComposerMode, draftText: string, guidance: ComposerGuidanceResult | undefined, dismissedAt: number | null): boolean;
//# sourceMappingURL=routing.d.ts.map