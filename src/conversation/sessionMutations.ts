import type { AtUri, ContributionScores } from '../intelligence/interpolatorTypes';
import type { ThreadNode } from '../lib/resolver/atproto';
import { useConversationSessionStore } from './sessionStore';
import type { ConversationNode, SessionGraph } from './sessionTypes';
import {
  annotateConversationQuality,
  assignDeferredReasons,
  defaultAnchorLinearPolicy,
  deriveConversationDirection,
  deriveThreadStateSignal,
} from './sessionPolicies';
import { applyInterpretiveConfidence } from './interpretive/interpretiveScoring';
import { updateConversationContinuitySnapshots } from './continuitySnapshots';
import { appendConversationMutation } from './mutationLedger';

function adjustReplyCount(node: ConversationNode | undefined, delta: number): ConversationNode | undefined {
  if (!node) return undefined;
  return {
    ...node,
    replyCount: Math.max(0, (node.replyCount ?? 0) + delta),
  };
}

function bumpVisibleReplyCounters(
  nodesByUri: Record<AtUri, ConversationNode>,
  parentUri: AtUri,
  rootUri: AtUri,
  delta: number,
): void {
  const parent = adjustReplyCount(nodesByUri[parentUri], delta);
  if (parent) {
    nodesByUri[parentUri] = parent;
  }

  if (rootUri !== parentUri) {
    const root = adjustReplyCount(nodesByUri[rootUri], delta);
    if (root) {
      nodesByUri[rootUri] = root;
    }
  }
}

function toConversationNode(
  node: ThreadNode,
  overrides: {
    branchDepth: number;
    siblingIndex: number;
    descendantCount: number;
    isOriginalPoster?: boolean;
    isOptimistic?: boolean;
    optimisticClientId?: string;
  },
): ConversationNode {
  return {
    uri: node.uri,
    cid: node.cid,
    authorDid: node.authorDid,
    authorHandle: node.authorHandle,
    ...(node.authorName ? { authorName: node.authorName } : {}),
    ...(node.authorAvatar ? { authorAvatar: node.authorAvatar } : {}),
    text: node.text,
    createdAt: node.createdAt,
    likeCount: node.likeCount,
    replyCount: node.replyCount,
    repostCount: node.repostCount,
    facets: node.facets,
    embed: node.embed,
    labels: node.labels,
    depth: node.depth,
    replies: node.replies ?? [],
    branchDepth: overrides.branchDepth,
    siblingIndex: overrides.siblingIndex,
    descendantCount: overrides.descendantCount,
    ...(node.parentUri ? { parentUri: node.parentUri } : {}),
    ...(node.parentAuthorHandle ? { parentAuthorHandle: node.parentAuthorHandle } : {}),
    ...(overrides.isOriginalPoster !== undefined
      ? { isOriginalPoster: overrides.isOriginalPoster }
      : {}),
    ...(overrides.isOptimistic ? { isOptimistic: true } : {}),
    ...(overrides.optimisticClientId ? { optimisticClientId: overrides.optimisticClientId } : {}),
  };
}

function rebuildConversationGraph(graph: SessionGraph): SessionGraph {
  const nextNodesByUri: Record<AtUri, ConversationNode> = { ...graph.nodesByUri };
  const nextSubtreeEndHints: Record<AtUri, AtUri | undefined> = {};

  const root = nextNodesByUri[graph.rootUri];
  if (!root) {
    return graph;
  }

  const visit = (
    uri: AtUri,
    parentUri: AtUri | undefined,
    branchDepth: number,
    siblingIndex: number,
    rootAuthorDid: string,
  ): ConversationNode | null => {
    const current = nextNodesByUri[uri];
    if (!current) return null;

    const childUris = graph.childUrisByParent[uri] ?? [];
    const replies: ConversationNode[] = [];
    let descendantCount = 0;
    let lastDescendantUri: AtUri | undefined;

    childUris.forEach((childUri, index) => {
      const child = visit(childUri, uri, branchDepth + 1, index, rootAuthorDid);
      if (!child) return;
      replies.push(child);
      descendantCount += 1 + child.descendantCount;
      lastDescendantUri = child.uri;
    });

    const updated: ConversationNode = {
      ...current,
      ...(parentUri !== undefined ? { parentUri } : {}),
      branchDepth,
      siblingIndex,
      descendantCount,
      replies,
      isOriginalPoster: current.authorDid === rootAuthorDid,
    };

    nextNodesByUri[uri] = updated;
    nextSubtreeEndHints[uri] = lastDescendantUri;
    return updated;
  };

  visit(graph.rootUri, undefined, 0, 0, root.authorDid);

  return {
    ...graph,
    nodesByUri: nextNodesByUri,
    subtreeEndHints: nextSubtreeEndHints,
  };
}

function recomputeSessionDerivedState(sessionId: string): void {
  const store = useConversationSessionStore.getState();
  const session = store.getSession(sessionId);
  if (!session) return;

  const recomputedAt = new Date().toISOString();
  let next = annotateConversationQuality(session);
  next = applyInterpretiveConfidence(next);
  next = {
    ...next,
    interpretation: {
      ...next.interpretation,
      threadState: deriveThreadStateSignal(next),
      lastComputedAt: recomputedAt,
    },
  };
  next = assignDeferredReasons(next, defaultAnchorLinearPolicy);
  next = {
    ...next,
    trajectory: {
      ...next.trajectory,
      direction: deriveConversationDirection(next),
    },
  };
  next = updateConversationContinuitySnapshots(next);

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

    return appendConversationMutation({
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
    }, {
      kind: 'user_feedback_set',
      targetUri: replyUri,
      ...(feedback !== undefined ? { userFeedback: feedback } : {}),
    });
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

    return appendConversationMutation({
      ...current,
      structure: {
        ...current.structure,
        revealedWarnUris: [...current.structure.revealedWarnUris, postUri],
      },
    }, {
      kind: 'warned_post_revealed',
      targetUri: postUri,
    });
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

    return appendConversationMutation({
      ...current,
      structure: nextStructure,
    }, {
      kind: 'focused_branch_changed',
      ...(branchUri ? { targetUri: branchUri } : {}),
      branchFocused: branchUri !== undefined,
    });
  });

  recomputeSessionDerivedState(sessionId);
}

export function insertOptimisticReply(params: {
  sessionId: string;
  parentUri: AtUri;
  replyNode: ThreadNode;
  optimisticClientId?: string;
}): void {
  const { sessionId, parentUri, replyNode, optimisticClientId } = params;
  const store = useConversationSessionStore.getState();

  store.updateSession(sessionId, (current) => {
    const parent = current.graph.nodesByUri[parentUri];
    if (!parent) return current;
    if (current.graph.nodesByUri[replyNode.uri]) return current;

    const rootAuthorDid = current.graph.nodesByUri[current.graph.rootUri]?.authorDid;
    const nextNodes = { ...current.graph.nodesByUri };
    const nextChildren = { ...current.graph.childUrisByParent };
    const nextParents = { ...current.graph.parentUriByChild };

    nextNodes[replyNode.uri] = toConversationNode(replyNode, {
      branchDepth: 0,
      siblingIndex: 0,
      descendantCount: 0,
      isOriginalPoster: replyNode.authorDid === rootAuthorDid,
      isOptimistic: true,
      ...(optimisticClientId ? { optimisticClientId } : {}),
    });

    nextChildren[parentUri] = [...(nextChildren[parentUri] ?? []), replyNode.uri];
    nextChildren[replyNode.uri] = [];
    nextParents[replyNode.uri] = parentUri;
    bumpVisibleReplyCounters(nextNodes, parentUri, current.graph.rootUri, 1);
    const nextGraph = rebuildConversationGraph({
      ...current.graph,
      nodesByUri: nextNodes,
      childUrisByParent: nextChildren,
      parentUriByChild: nextParents,
      subtreeEndHints: current.graph.subtreeEndHints,
    });

    return appendConversationMutation({
      ...current,
      graph: nextGraph,
      meta: {
        ...current.meta,
        lastHydratedAt: new Date().toISOString(),
      },
    }, {
      kind: 'optimistic_reply_inserted',
      targetUri: replyNode.uri,
      relatedUri: parentUri,
    });
  });

  recomputeSessionDerivedState(sessionId);
}

export function reconcileOptimisticReply(params: {
  sessionId: string;
  optimisticUri: AtUri;
  persistedNode: ThreadNode;
}): void {
  const { sessionId, optimisticUri, persistedNode } = params;
  const store = useConversationSessionStore.getState();

  store.updateSession(sessionId, (current) => {
    const optimisticNode = current.graph.nodesByUri[optimisticUri];
    if (!optimisticNode?.isOptimistic) return current;

    const parentUri = current.graph.parentUriByChild[optimisticUri];
    if (!parentUri) return current;

    const nextNodes = { ...current.graph.nodesByUri };
    const nextChildren = { ...current.graph.childUrisByParent };
    const nextParents = { ...current.graph.parentUriByChild };
    const existingPersisted = nextNodes[persistedNode.uri];
    const nextParentChildren = [...(nextChildren[parentUri] ?? [])];
    const optimisticIndex = nextParentChildren.indexOf(optimisticUri);
    const persistedIndex = nextParentChildren.indexOf(persistedNode.uri);

    if (optimisticIndex >= 0 && persistedIndex === -1) {
      nextParentChildren.splice(optimisticIndex, 1, persistedNode.uri);
    } else {
      if (optimisticIndex >= 0) {
        nextParentChildren.splice(optimisticIndex, 1);
      }
      if (persistedIndex === -1) {
        nextParentChildren.push(persistedNode.uri);
      }
    }

    nextChildren[parentUri] = nextParentChildren;
    delete nextChildren[optimisticUri];
    delete nextParents[optimisticUri];
    delete nextNodes[optimisticUri];

    nextNodes[persistedNode.uri] = existingPersisted
      ? (() => {
          const { isOptimistic: _omitOptimistic, ...persistedExisting } = existingPersisted;
          return {
            ...persistedExisting,
            ...(optimisticNode.optimisticClientId
              ? { optimisticClientId: optimisticNode.optimisticClientId }
              : {}),
          };
        })()
      : {
          ...toConversationNode(
            { ...persistedNode, replies: [] },
            {
              branchDepth: optimisticNode.branchDepth,
              siblingIndex: optimisticNode.siblingIndex,
              descendantCount: 0,
              ...(optimisticNode.isOriginalPoster !== undefined
                ? { isOriginalPoster: optimisticNode.isOriginalPoster }
                : {}),
              ...(optimisticNode.optimisticClientId
                ? { optimisticClientId: optimisticNode.optimisticClientId }
                : {}),
            },
          ),
        };
    nextChildren[persistedNode.uri] = nextChildren[persistedNode.uri] ?? [];
    nextParents[persistedNode.uri] = parentUri;

    const nextGraph = rebuildConversationGraph({
      ...current.graph,
      nodesByUri: nextNodes,
      childUrisByParent: nextChildren,
      parentUriByChild: nextParents,
      subtreeEndHints: current.graph.subtreeEndHints,
    });

    return appendConversationMutation({
      ...current,
      graph: nextGraph,
      meta: {
        ...current.meta,
        lastHydratedAt: new Date().toISOString(),
      },
    }, {
      kind: 'optimistic_reply_reconciled',
      targetUri: persistedNode.uri,
      relatedUri: parentUri,
    });
  });

  recomputeSessionDerivedState(sessionId);
}

export function rollbackOptimisticReply(params: {
  sessionId: string;
  optimisticUri: AtUri;
}): void {
  const { sessionId, optimisticUri } = params;
  const store = useConversationSessionStore.getState();

  store.updateSession(sessionId, (current) => {
    const optimisticNode = current.graph.nodesByUri[optimisticUri];
    if (!optimisticNode?.isOptimistic) return current;

    const parentUri = current.graph.parentUriByChild[optimisticUri];
    if (!parentUri) return current;

    const nextNodes = { ...current.graph.nodesByUri };
    const nextChildren = { ...current.graph.childUrisByParent };
    const nextParents = { ...current.graph.parentUriByChild };

    nextChildren[parentUri] = (nextChildren[parentUri] ?? []).filter((uri) => uri !== optimisticUri);
    delete nextChildren[optimisticUri];
    delete nextParents[optimisticUri];
    delete nextNodes[optimisticUri];

    bumpVisibleReplyCounters(nextNodes, parentUri, current.graph.rootUri, -1);
    const nextGraph = rebuildConversationGraph({
      ...current.graph,
      nodesByUri: nextNodes,
      childUrisByParent: nextChildren,
      parentUriByChild: nextParents,
      subtreeEndHints: current.graph.subtreeEndHints,
    });

    return appendConversationMutation({
      ...current,
      graph: nextGraph,
      meta: {
        ...current.meta,
        lastHydratedAt: new Date().toISOString(),
      },
    }, {
      kind: 'optimistic_reply_rolled_back',
      targetUri: optimisticUri,
      relatedUri: parentUri,
    });
  });

  recomputeSessionDerivedState(sessionId);
}
