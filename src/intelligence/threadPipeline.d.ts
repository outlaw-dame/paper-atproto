import type { AtUri, ContributionScores, ThreadInterpolatorState, ThreadPost } from './interpolatorTypes.js';
import type { VerificationOutcome, VerificationProviders } from './verification/types.js';
import type { ThreadNode } from '../lib/resolver/atproto.js';
import type { ConfidenceState, SummaryMode } from './llmContracts.js';
import { type VerificationCache } from './verification/cache.js';
export interface ThreadPipelineResult {
    interpolator: ThreadInterpolatorState;
    scores: Record<AtUri, ContributionScores>;
    verificationByPost: Record<AtUri, VerificationOutcome>;
    rootVerification: VerificationOutcome | null;
    didMeaningfullyChange: boolean;
    /** Three-axis confidence state computed after scoring and verification. */
    confidence: ConfidenceState;
    /** Summary mode derived from confidence — used to build writer input and choose fallback. */
    summaryMode: SummaryMode;
}
export interface RunThreadPipelineOptions {
    input: {
        rootUri: string;
        rootText: string;
        rootPost?: ThreadPost;
        replies: ThreadNode[];
    };
    previous?: ThreadInterpolatorState | null;
    providers: VerificationProviders;
    cache?: VerificationCache;
    signal?: AbortSignal;
    verificationLimit?: number;
    verificationConcurrency?: number;
}
export declare function runVerifiedThreadPipeline(options: RunThreadPipelineOptions): Promise<ThreadPipelineResult>;
//# sourceMappingURL=threadPipeline.d.ts.map