export function projectThreadScopedProfileCard(session, did) {
    const posts = Object.values(session.graph.nodesByUri).filter((node) => node.authorDid === did);
    if (posts.length === 0)
        return null;
    const first = posts[0];
    const clarificationCount = posts.filter((p) => p.contributionSignal?.role === 'clarification').length;
    const sourceContributionCount = posts.filter((p) => p.isSourceBringer).length;
    const roleSummary = Array.from(new Set(posts
        .map((p) => p.contributionSignal?.role)
        .filter((role) => role !== undefined)));
    return {
        did,
        ...(first?.authorHandle ? { handle: first.authorHandle } : {}),
        ...(first?.authorName ? { displayName: first.authorName } : {}),
        postsInThread: posts.map((p) => ({
            uri: p.uri,
            text: p.text,
            ...(p.contributionRole ? { contributionRole: p.contributionRole } : {}),
            ...(p.contributionSignal?.role ? { conversationalRole: p.contributionSignal.role } : {}),
            ...(p.contributionSignal?.qualityScore !== undefined
                ? { qualityScore: p.contributionSignal.qualityScore }
                : {}),
        })),
        roleSummary,
        ...(sourceContributionCount > 0
            ? { notableAction: 'Introduced a source or evidence' }
            : clarificationCount > 0
                ? {
                    notableAction: `Added ${clarificationCount} clarification${clarificationCount > 1 ? 's' : ''}`,
                }
                : {}),
        clarificationCount,
        sourceContributionCount,
    };
}
//# sourceMappingURL=profileCardProjection.js.map