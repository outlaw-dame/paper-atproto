import type { AtUri, ContributionScores } from '../intelligence/interpolatorTypes.js';
import type { ThreadNode } from '../lib/resolver/atproto.js';
export declare function setConversationUserFeedback(params: {
    sessionId: string;
    replyUri: AtUri;
    feedback: ContributionScores['userFeedback'];
}): void;
export declare function revealModeratedPost(params: {
    sessionId: string;
    postUri: AtUri;
}): void;
export declare function setFocusedBranch(params: {
    sessionId: string;
    branchUri?: AtUri;
}): void;
export declare function insertOptimisticReply(params: {
    sessionId: string;
    parentUri: AtUri;
    replyNode: ThreadNode;
}): void;
//# sourceMappingURL=sessionMutations.d.ts.map