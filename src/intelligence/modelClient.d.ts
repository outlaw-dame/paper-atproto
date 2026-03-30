import type { ThreadStateForWriter, InterpolatorWriteResult, MediaAnalysisRequest, MediaAnalysisResult, ExploreSynopsisRequest, ExploreSynopsisResult } from './llmContracts.js';
import type { ComposerGuidanceWriteRequest, ComposerGuidanceWriteResult } from './composer/llmWriterContracts.js';
/**
 * Calls the writer model to produce the Interpolator summary.
 * Falls back gracefully — callers should catch and use deterministic summary on failure.
 */
export declare function callInterpolatorWriter(input: ThreadStateForWriter, signal?: AbortSignal): Promise<InterpolatorWriteResult>;
/**
 * Calls the multimodal analyzer (Qwen3-VL).
 * Only call when shouldRunMultimodal() returns true.
 */
export declare function callMediaAnalyzer(input: MediaAnalysisRequest, signal?: AbortSignal): Promise<MediaAnalysisResult>;
/**
 * Calls the writer for Explore / Search Story synopsis.
 */
export declare function callExploreWriter(input: ExploreSynopsisRequest, signal?: AbortSignal): Promise<ExploreSynopsisResult>;
/**
 * Calls the selective composer-guidance writer. This is advisory polish only;
 * callers should always have local fallback copy ready.
 */
export declare function callComposerGuidanceWriter(input: ComposerGuidanceWriteRequest, signal?: AbortSignal): Promise<ComposerGuidanceWriteResult>;
//# sourceMappingURL=modelClient.d.ts.map