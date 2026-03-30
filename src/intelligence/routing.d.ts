import type { SummaryMode } from './llmContracts.js';
export interface MultimodalSignals {
    /** 1 if root post or high-impact reply has image/screenshot/chart/document, else 0. */
    hasMedia: number;
    /** Estimated fraction of media that is OCR-heavy or screenshot-heavy (0–1). */
    mediaTextDensity: number;
    /** Fraction of replies that reference "this screenshot", "the image", etc. (0–1). */
    mediaReferenceDensity: number;
    /** 1 if text-only understanding would miss the core claim, else 0. */
    mediaClaimDependency: number;
    /** 1 if verification system flagged media-context risk or provenance ambiguity, else 0. */
    mediaVerificationFlag: number;
    /** How much text-only confidence is reduced by missing visual context (0–1). */
    nonTextSignalGap: number;
}
export declare function computeMultimodalScore(s: MultimodalSignals): number;
/** Returns true when Qwen3-VL should run for this thread. */
export declare function shouldRunMultimodal(s: MultimodalSignals): boolean;
/**
 * Selects the appropriate summary mode for the writer.
 *
 * normal             → full structured summary
 * descriptive_fallback → root post + observable replies + high-confidence
 *                        contributors/entities + uncertainty sentence
 * minimal_fallback   → minimal root-post summary + limited reply activity
 */
export declare function chooseSummaryMode(input: {
    surfaceConfidence: number;
    interpretiveConfidence: number;
}): SummaryMode;
/**
 * Whether a contributor may be named in the summary.
 * OP may always be named. Non-OP thresholds tighten in fallback mode.
 */
export declare function contributorMayBeNamed(impactScore: number, isOp: boolean, summaryMode: SummaryMode): boolean;
/**
 * Whether an entity may be named in the summary.
 * Thresholds tighten significantly in fallback mode.
 */
export declare function entityMayBeNamed(entityConfidence: number, entityImpact: number, summaryMode: SummaryMode): boolean;
/**
 * Returns the top N comments by impact score for the writer.
 * Comment count is capped tightly in fallback modes to prevent over-interpretation.
 */
export declare function selectTopCommentsForWriter<T extends {
    impactScore: number;
}>(comments: T[], mode: SummaryMode): T[];
//# sourceMappingURL=routing.d.ts.map