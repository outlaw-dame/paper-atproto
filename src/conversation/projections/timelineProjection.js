export function projectTimelineConversationHint(session, postUri) {
    const node = session.graph.nodesByUri[postUri];
    if (!node)
        return null;
    return {
        rootUri: session.graph.rootUri,
        postUri,
        isReply: node.uri !== session.graph.rootUri,
        ...(node.parentAuthorHandle ? { parentHandle: node.parentAuthorHandle } : {}),
        branchDepth: node.branchDepth,
        direction: session.trajectory.direction,
        sourceSupportPresent: session.interpretation.interpolator?.sourceSupportPresent ?? false,
        factualSignalPresent: session.interpretation.interpolator?.factualSignalPresent ?? false,
        hasThreadContext: !!session.interpretation.interpolator,
        ...((session.interpretation.writerResult?.collapsedSummary
            ?? session.interpretation.interpolator?.summaryText)
            ? {
                compactSummary: session.interpretation.writerResult?.collapsedSummary
                    ?? session.interpretation.interpolator?.summaryText,
            }
            : {}),
    };
}
//# sourceMappingURL=timelineProjection.js.map