import type { AtUri, ContributionScores } from '../intelligence/interpolatorTypes';
import type { ThreadNode } from '../lib/resolver/atproto';
import { useConversationSessionStore } from './sessionStore';
import {
  annotateConversationQuality,
  assignDeferredReasons,
  defaultAnchorLinearPolicy,
  deriveThreadStateSignal,
} from './sessionPolicies';

function recomputeSessionDerivedState(sessionId: string): void {
  const store = useConversationSessionStore.getState();
  const session = store.getSession(sessionId);
  if (!session) return;

  let next = annotateConversationQuality(session);
  next = {
    ...next,
    interpretation: {
      ...next.interpretation,
      threadState: deriveThreadStateSignal(next),
    },
  };
  next = assignDeferredReasons(next, defaultAnchorLinearPolicy);

  store.updateSession(sessionId, () => next);
}

export function setConversationUserFeedback(params: {
  sessionId: string;
  replyUri: AtUri;
  feedback: ContributionScores['userFeedback'];
}): void {
  const { sessionId, replyUri, feedback } = params;
  const store = useConversationSessionStore.getState();

  store.updateSession(sessionId, (current) => {
    const existing = current.interpretation.scoresByUri[replyUri];
    if (!existing) return current;

    return {
      ...current,
      interpretation: {
        ...current.interpretation,
        scoresByUri: {
          ...current.interpretation.scoresByUri,
          [replyUri]: {
            ...existing,
            ...(feedback !== undefined ? { userFeedback: feedback } : {}),
          },
        },
      },
    };
  });

  recomputeSessionDerivedState(sessionId);
}

export function revealWarnedPost(params: {
  sessionId: string;
  postUri: AtUri;
}): void {
  const { sessionId, postUri } = params;
  const store = useConversationSessionStore.getState();

  store.updateSession(sessionId, (current) => {
    if (!current.graph.nodesByUri[postUri]) return current;
    if (current.structure.revealedWarnUris.includes(postUri)) return current;

    return {
      ...current,
      structure: {
        ...current.structure,
        revealedWarnUris: [...current.structure.revealedWarnUris, postUri],
      },
    };
  });
}

// Backward-compatible alias while callers migrate.
export const revealModeratedPost = revealWarnedPost;

export function setFocusedBranch(params: {
  sessionId: string;
  branchUri?: AtUri;
}): void {
  const { sessionId, branchUri } = params;
  const store = useConversationSessionStore.getState();

  store.updateSession(sessionId, (current) => {
    const nextStructure = { ...current.structure };
    if (branchUri === undefined) {
      delete nextStructure.focusedBranchUri;
    } else {
      nextStructure.focusedBranchUri = branchUri;
    }

    return {
      ...current,
      structure: nextStructure,
    };
  });

  recomputeSessionDerivedState(sessionId);
}

export function insertOptimisticReply(params: {
  sessionId: string;
  parentUri: AtUri;
  replyNode: ThreadNode;
}): void {
  const { sessionId, parentUri, replyNode } = params;
  const store = useConversationSessionStore.getState();

  store.updateSession(sessionId, (current) => {
    const parent = current.graph.nodesByUri[parentUri];
    if (!parent) return current;

    const rootAuthorDid = current.graph.nodesByUri[current.graph.rootUri]?.authorDid;
    const nextNodes = { ...current.graph.nodesByUri };
    const nextChildren = { ...current.graph.childUrisByParent };
    const nextParents = { ...current.graph.parentUriByChild };
    const nextSubtreeHints = { ...current.graph.subtreeEndHints };

    nextNodes[replyNode.uri] = {
      ...replyNode,
      branchDepth: (parent.branchDepth ?? 0) + 1,
      siblingIndex: nextChildren[parentUri]?.length ?? 0,
      descendantCount: 0,
      isOriginalPoster: replyNode.authorDid === rootAuthorDid,
    };

    nextChildren[parentUri] = [...(nextChildren[parentUri] ?? []), replyNode.uri];
    nextParents[replyNode.uri] = parentUri;
    nextSubtreeHints[parentUri] = replyNode.uri;

    return {
      ...current,
      graph: {
        ...current.graph,
        nodesByUri: nextNodes,
        childUrisByParent: nextChildren,
        parentUriByChild: nextParents,
        subtreeEndHints: nextSubtreeHints,
      },
      meta: {
        ...current.meta,
        lastHydratedAt: new Date().toISOString(),
      },
    };
  });

  recomputeSessionDerivedState(sessionId);
}
