import type { PostFilterMatch } from '../lib/contentFilters/types.js';
import { type ThreadFilter } from './projections/threadProjection.js';
import type { ComposerContext } from './projections/composerProjection.js';
export declare function useConversationSession(sessionId: string): import("./sessionTypes.js").ConversationSession | null;
export declare function useThreadProjection(sessionId: string, activeFilter?: ThreadFilter): import("./projections/threadProjection.js").ThreadProjection | null;
export declare function useConversationMeta(sessionId: string): {
    status: "idle" | "loading" | "ready" | "error";
    error?: string | null;
    lastHydratedAt?: string;
} | null;
export declare function useConversationInterpolatedState(sessionId: string): {
    interpolator: import("../intelligence/interpolatorTypes.js").InterpolatorState | null;
    writerResult: import("../intelligence/llmContracts.js").InterpolatorWriteResult | null;
    summaryMode: import("../intelligence/llmContracts.js").SummaryMode | null;
    confidence: import("../intelligence/llmContracts.js").ConfidenceState | null;
    threadState: import("./sessionTypes.js").ThreadStateSignal | null;
    rootVerification: import("../intelligence/index.js").VerificationOutcome | null;
    scoresByUri: Record<string, import("../intelligence/interpolatorTypes.js").ContributionScores>;
    verificationByUri: Record<string, import("../intelligence/index.js").VerificationOutcome>;
    entityLandscape: import("../intelligence/interpolatorTypes.js").EntityImpact[];
    writerEntities: import("../intelligence/llmContracts.js").WriterEntity[];
    contributors: import("../intelligence/interpolatorTypes.js").ContributorImpact[];
    translations: Record<string, {
        translatedText?: string;
        sourceLang?: string;
        targetLang?: string;
    }>;
    heatLevel: number;
    repetitionLevel: number;
    direction: import("./sessionTypes.js").ConversationDirection;
} | null;
export declare function useComposerProjection(params: {
    sessionId: string;
    replyToUri?: string;
    draftText: string;
}): ComposerContext | null;
export declare function useComposerContextProjection(sessionId: string, replyToUri?: string, draftText?: string): ComposerContext | null;
export declare function useThreadModerationProjection(sessionId: string): {
    byUri: Record<string, {
        matches: PostFilterMatch[];
        hidden: boolean;
        warned: boolean;
    }>;
};
//# sourceMappingURL=sessionSelectors.d.ts.map