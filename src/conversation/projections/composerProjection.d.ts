import type { ConversationSession } from '../sessionTypes.js';
export type ComposerContext = {
    mode: 'post' | 'reply' | 'hosted_thread';
    draftText: string;
    directParent?: {
        uri: string;
        text: string;
        authorHandle?: string;
    };
    threadContext?: {
        rootText?: string;
        ancestorTexts: string[];
        branchTexts: string[];
    };
    replyContext?: {
        siblingReplyTexts: string[];
        selectedCommentTexts: string[];
        totalReplyCount?: number;
        totalCommentCount?: number;
    };
    summaries?: {
        directParentSummary?: string;
        threadSummary?: string;
        replyContextSummary?: string;
        conversationHeatSummary?: string;
    };
    threadState?: {
        dominantTone?: string;
        conversationPhase?: string;
        heatLevel?: number;
        repetitionLevel?: number;
        sourceSupportPresent?: boolean;
        factualSignalPresent?: boolean;
    };
};
export declare function projectComposerContext(params: {
    session: ConversationSession;
    replyToUri?: string;
    draftText: string;
}): ComposerContext;
//# sourceMappingURL=composerProjection.d.ts.map