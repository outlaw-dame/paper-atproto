import { useCallback } from 'react';
import type { AtUri, ContributionScores } from '../intelligence/interpolatorTypes.js';
import type { ThreadNode } from '../lib/resolver/atproto.js';
import {
  insertOptimisticReply,
  revealWarnedPost,
  setConversationUserFeedback,
  setFocusedBranch,
} from './sessionMutations.js';

export function useConversationActions(sessionId: string) {
  const onUserFeedback = useCallback((replyUri: AtUri, feedback: ContributionScores['userFeedback']) => {
    setConversationUserFeedback({
      sessionId,
      replyUri,
      feedback,
    });
  }, [sessionId]);

  const onRevealWarnedPost = useCallback((postUri: AtUri) => {
    revealWarnedPost({
      sessionId,
      postUri,
    });
  }, [sessionId]);

  const onFocusBranch = useCallback((branchUri?: AtUri) => {
    setFocusedBranch({
      sessionId,
      ...(branchUri ? { branchUri } : {}),
    });
  }, [sessionId]);

  const onInsertOptimisticReply = useCallback((parentUri: AtUri, replyNode: ThreadNode) => {
    insertOptimisticReply({
      sessionId,
      parentUri,
      replyNode,
    });
  }, [sessionId]);

  return {
    onUserFeedback,
    onRevealWarnedPost,
    // Backward-compatible action alias.
    onRevealModeratedPost: onRevealWarnedPost,
    onFocusBranch,
    onInsertOptimisticReply,
  };
}
