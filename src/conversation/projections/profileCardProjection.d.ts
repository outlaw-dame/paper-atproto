import type { ConversationSession } from '../sessionTypes.js';
export type ProfileCardContext = {
    type: 'global';
} | {
    type: 'thread';
    threadUri: string;
};
export interface ThreadScopedProfileProjection {
    did: string;
    handle?: string;
    displayName?: string;
    postsInThread: Array<{
        uri: string;
        text: string;
        contributionRole?: string;
        conversationalRole?: string;
        qualityScore?: number;
    }>;
    roleSummary: string[];
    notableAction?: string;
    clarificationCount: number;
    sourceContributionCount: number;
}
export declare function projectThreadScopedProfileCard(session: ConversationSession, did: string): ThreadScopedProfileProjection | null;
//# sourceMappingURL=profileCardProjection.d.ts.map