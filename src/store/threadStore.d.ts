import type { AtUri, ContributionScores, ThreadInterpolatorState } from '../intelligence/interpolatorTypes';
import type { VerificationOutcome } from '../intelligence/verification';
import type { ConfidenceState, SummaryMode, InterpolatorWriteResult } from '../intelligence/llmContracts';
type ThreadSlice = {
    interpolator: ThreadInterpolatorState | null;
    scores: Record<AtUri, ContributionScores>;
    verificationByPost: Record<AtUri, VerificationOutcome>;
    rootVerification: VerificationOutcome | null;
    /** Three-axis confidence computed after Phase 1/3 pipeline. */
    confidence: ConfidenceState | null;
    /** Summary mode chosen from confidence — normal / descriptive_fallback / minimal_fallback. */
    summaryMode: SummaryMode | null;
    /** Final writer result from Qwen3-4B. null until writer has responded. */
    writerResult: InterpolatorWriteResult | null;
    lastComputedAt?: string | undefined;
    error?: string | null | undefined;
    isLoading: boolean;
};
type ThreadStore = {
    byThread: Record<string, ThreadSlice>;
    ensureThread: (threadId: string) => void;
    setLoading: (threadId: string, isLoading: boolean) => void;
    setError: (threadId: string, error: string | null) => void;
    upsertThreadResult: (threadId: string, payload: {
        interpolator: ThreadInterpolatorState;
        scores: Record<AtUri, ContributionScores>;
        verificationByPost?: Record<AtUri, VerificationOutcome>;
        rootVerification?: VerificationOutcome | null;
        confidence?: ConfidenceState;
        summaryMode?: SummaryMode;
    }) => void;
    setWriterResult: (threadId: string, writerResult: InterpolatorWriteResult) => void;
    setUserFeedback: (threadId: string, replyUri: AtUri, feedback: ContributionScores['userFeedback']) => void;
    getThread: (threadId: string) => ThreadSlice | null;
};
export declare const useThreadStore: import("zustand").UseBoundStore<import("zustand").StoreApi<ThreadStore>>;
export {};
//# sourceMappingURL=threadStore.d.ts.map