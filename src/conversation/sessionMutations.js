import { useConversationSessionStore } from './sessionStore.js';
import { annotateConversationQuality, assignDeferredReasons, defaultAnchorLinearPolicy, deriveThreadStateSignal, } from './sessionPolicies.js';
function recomputeSessionDerivedState(sessionId) {
    const store = useConversationSessionStore.getState();
    const session = store.getSession(sessionId);
    if (!session)
        return;
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
export function setConversationUserFeedback(params) {
    const { sessionId, replyUri, feedback } = params;
    const store = useConversationSessionStore.getState();
    store.updateSession(sessionId, (current) => {
        const existing = current.interpretation.scoresByUri[replyUri];
        if (!existing)
            return current;
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
export function revealModeratedPost(params) {
    const { sessionId, postUri } = params;
    const store = useConversationSessionStore.getState();
    store.updateSession(sessionId, (current) => {
        const node = current.graph.nodesByUri[postUri];
        if (!node)
            return current;
        return {
            ...current,
            graph: {
                ...current.graph,
                nodesByUri: {
                    ...current.graph.nodesByUri,
                    [postUri]: {
                        ...node,
                        hiddenByModeration: false,
                        warnedByModeration: false,
                    },
                },
            },
            structure: {
                ...current.structure,
                hiddenUris: current.structure.hiddenUris.filter((uri) => uri !== postUri),
                deferredUris: current.structure.deferredUris.filter((uri) => uri !== postUri),
            },
        };
    });
    recomputeSessionDerivedState(sessionId);
}
export function setFocusedBranch(params) {
    const { sessionId, branchUri } = params;
    const store = useConversationSessionStore.getState();
    store.updateSession(sessionId, (current) => {
        const nextStructure = { ...current.structure };
        if (branchUri === undefined) {
            delete nextStructure.focusedBranchUri;
        }
        else {
            nextStructure.focusedBranchUri = branchUri;
        }
        return {
            ...current,
            structure: nextStructure,
        };
    });
    recomputeSessionDerivedState(sessionId);
}
export function insertOptimisticReply(params) {
    const { sessionId, parentUri, replyNode } = params;
    const store = useConversationSessionStore.getState();
    store.updateSession(sessionId, (current) => {
        const parent = current.graph.nodesByUri[parentUri];
        if (!parent)
            return current;
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
//# sourceMappingURL=sessionMutations.js.map