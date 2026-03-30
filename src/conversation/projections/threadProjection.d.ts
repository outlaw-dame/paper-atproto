import type { ConversationSession } from '../sessionTypes.js';
import type { ProjectionPolicy } from '../sessionPolicies.js';
export type ThreadFilter = 'Top' | 'Latest' | 'Clarifying' | 'New angles' | 'Source-backed';
export interface ThreadProjectionContribution {
    uri: string;
    text: string;
    authorDid: string;
    authorHandle: string;
    authorName?: string;
    authorAvatar?: string;
    createdAt: string;
    likeCount: number;
    replyCount: number;
    repostCount: number;
    depth: number;
    facets: any[];
    embed: any;
    replies: any[];
    parentAuthorHandle?: string;
    isDeferred: boolean;
    deferredReason?: string;
    isHidden: boolean;
    isWarned: boolean;
    isOp: boolean;
    contributionRole?: string;
    conversationalRole?: string;
    qualityScore?: number;
    evidencePresent?: boolean;
    finalInfluenceScore?: number;
    usefulnessScore?: number;
    factualContributionScore?: number;
}
export interface ThreadProjection {
    hero: {
        rootUri: string;
        participantCount: number;
        rootVerificationPresent: boolean;
        rootNode: {
            uri: string;
            text: string;
            authorDid: string;
            authorHandle: string;
            authorName?: string;
            authorAvatar?: string;
            createdAt: string;
            likeCount: number;
            replyCount: number;
            repostCount: number;
            facets: any[];
            embed: any;
        } | null;
    };
    interpolator: {
        summaryText: string;
        writerSummary?: string;
        summaryMode?: string | null;
        heatLevel: number;
        repetitionLevel: number;
        direction: string;
        threadState: string;
        sourceSupportPresent: boolean;
        factualSignalPresent: boolean;
        topContributors: any[];
        entityLandscape: any[];
        writerEntities: any[];
    };
    filters: {
        active: ThreadFilter;
        available: ThreadFilter[];
    };
    featuredContribution: ThreadProjectionContribution | null;
    visibleContributions: ThreadProjectionContribution[];
    hiddenContributionCount: number;
    warnedContributionCount: number;
    contributions: ThreadProjectionContribution[];
}
export declare function projectThreadView(session: ConversationSession, _policy: ProjectionPolicy, activeFilter?: ThreadFilter): ThreadProjection;
//# sourceMappingURL=threadProjection.d.ts.map