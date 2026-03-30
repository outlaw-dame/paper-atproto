import type { ConversationSession } from '../sessionTypes.js';
export interface TimelineConversationHint {
    rootUri: string;
    postUri: string;
    isReply: boolean;
    parentHandle?: string;
    branchDepth: number;
    direction: string;
    sourceSupportPresent: boolean;
    factualSignalPresent: boolean;
    hasThreadContext: boolean;
    compactSummary?: string;
}
export declare function projectTimelineConversationHint(session: ConversationSession, postUri: string): TimelineConversationHint | null;
//# sourceMappingURL=timelineProjection.d.ts.map