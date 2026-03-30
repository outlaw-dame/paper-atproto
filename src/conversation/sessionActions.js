import { useCallback } from 'react';
import { insertOptimisticReply, revealModeratedPost, setConversationUserFeedback, setFocusedBranch, } from './sessionMutations.js';
export function useConversationActions(sessionId) {
    const onUserFeedback = useCallback((replyUri, feedback) => {
        setConversationUserFeedback({
            sessionId,
            replyUri,
            feedback,
        });
    }, [sessionId]);
    const onRevealModeratedPost = useCallback((postUri) => {
        revealModeratedPost({
            sessionId,
            postUri,
        });
    }, [sessionId]);
    const onFocusBranch = useCallback((branchUri) => {
        setFocusedBranch({
            sessionId,
            ...(branchUri ? { branchUri } : {}),
        });
    }, [sessionId]);
    const onInsertOptimisticReply = useCallback((parentUri, replyNode) => {
        insertOptimisticReply({
            sessionId,
            parentUri,
            replyNode,
        });
    }, [sessionId]);
    return {
        onUserFeedback,
        onRevealModeratedPost,
        onFocusBranch,
        onInsertOptimisticReply,
    };
}
//# sourceMappingURL=sessionActions.js.map