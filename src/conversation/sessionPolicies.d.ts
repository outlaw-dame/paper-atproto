import type { ConversationSession, ThreadStateSignal } from './sessionTypes.js';
export type ThreadViewPolicy = 'anchor_linear' | 'anchor_tree' | 'root_tree' | 'focused_branch';
export interface ProjectionPolicy {
    threadView: ThreadViewPolicy;
    maxInlineChildrenPerBranch: number;
    deferLowPriorityBranches: boolean;
    showModerationWarningsInline: boolean;
}
export declare const defaultAnchorLinearPolicy: ProjectionPolicy;
export declare function annotateConversationQuality(session: ConversationSession): ConversationSession;
export declare function assignDeferredReasons(session: ConversationSession, policy: ProjectionPolicy): ConversationSession;
export declare function deriveThreadStateSignal(session: ConversationSession): ThreadStateSignal;
//# sourceMappingURL=sessionPolicies.d.ts.map