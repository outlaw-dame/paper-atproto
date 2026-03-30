import type { AtUri, ContributionScores } from '../intelligence/interpolatorTypes.js';
import type { ThreadNode } from '../lib/resolver/atproto.js';
export declare function useConversationActions(sessionId: string): {
    onUserFeedback: (replyUri: AtUri, feedback: ContributionScores["userFeedback"]) => void;
    onRevealModeratedPost: (postUri: AtUri) => void;
    onFocusBranch: (branchUri?: AtUri) => void;
    onInsertOptimisticReply: (parentUri: AtUri, replyNode: ThreadNode) => void;
};
//# sourceMappingURL=sessionActions.d.ts.map