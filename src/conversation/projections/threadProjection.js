export function projectThreadView(session, _policy, activeFilter = 'Top') {
    const root = session.graph.nodesByUri[session.graph.rootUri];
    const rootAuthorDid = root?.authorDid;
    const allContributions = Object.values(session.graph.nodesByUri)
        .filter((node) => node.uri !== session.graph.rootUri)
        .map((node) => ({
        uri: node.uri,
        text: node.text,
        authorDid: node.authorDid,
        authorHandle: node.authorHandle,
        ...(node.authorName ? { authorName: node.authorName } : {}),
        ...(node.authorAvatar ? { authorAvatar: node.authorAvatar } : {}),
        createdAt: node.createdAt,
        likeCount: node.likeCount,
        replyCount: node.replyCount,
        repostCount: node.repostCount,
        depth: node.branchDepth,
        facets: node.facets,
        embed: node.embed,
        replies: node.replies,
        ...(node.parentAuthorHandle ? { parentAuthorHandle: node.parentAuthorHandle } : {}),
        isDeferred: session.structure.deferredUris.includes(node.uri),
        ...(node.deferredReason ? { deferredReason: node.deferredReason } : {}),
        isHidden: !!node.hiddenByModeration,
        isWarned: !!node.warnedByModeration,
        isOp: node.authorDid === rootAuthorDid,
        ...(node.contributionRole ? { contributionRole: node.contributionRole } : {}),
        ...(node.contributionSignal?.role ? { conversationalRole: node.contributionSignal.role } : {}),
        ...(node.contributionSignal?.qualityScore !== undefined
            ? { qualityScore: node.contributionSignal.qualityScore }
            : {}),
        ...(node.contributionSignal?.evidencePresent !== undefined
            ? { evidencePresent: node.contributionSignal.evidencePresent }
            : {}),
        ...(node.contributionScores?.finalInfluenceScore !== undefined
            ? { finalInfluenceScore: node.contributionScores.finalInfluenceScore }
            : {}),
        ...(node.contributionScores?.usefulnessScore !== undefined
            ? { usefulnessScore: node.contributionScores.usefulnessScore }
            : {}),
        ...(node.contributionScores?.factual?.factualContributionScore !== undefined
            ? { factualContributionScore: node.contributionScores.factual.factualContributionScore }
            : {}),
    }));
    const hiddenContributionCount = allContributions.filter((contribution) => contribution.isHidden).length;
    const warnedContributionCount = allContributions.filter((contribution) => contribution.isWarned).length;
    const moderationVisible = allContributions.filter((contribution) => !contribution.isHidden);
    const filtered = applyThreadFilter(moderationVisible, activeFilter);
    const featuredContribution = activeFilter === 'Top'
        ? pickFeaturedContribution(filtered)
        : null;
    const visibleContributions = featuredContribution
        ? filtered.filter((contribution) => contribution.uri !== featuredContribution.uri)
        : filtered;
    return {
        hero: {
            rootUri: session.graph.rootUri,
            participantCount: allContributions.length,
            rootVerificationPresent: !!session.evidence.rootVerification,
            rootNode: root
                ? {
                    uri: root.uri,
                    text: root.text,
                    authorDid: root.authorDid,
                    authorHandle: root.authorHandle,
                    ...(root.authorName ? { authorName: root.authorName } : {}),
                    ...(root.authorAvatar ? { authorAvatar: root.authorAvatar } : {}),
                    createdAt: root.createdAt,
                    likeCount: root.likeCount,
                    replyCount: root.replyCount,
                    repostCount: root.repostCount,
                    facets: root.facets,
                    embed: root.embed,
                }
                : null,
        },
        interpolator: {
            summaryText: session.interpretation.interpolator?.summaryText ?? '',
            ...(session.interpretation.writerResult?.collapsedSummary
                ? { writerSummary: session.interpretation.writerResult.collapsedSummary }
                : {}),
            ...(session.interpretation.summaryMode !== null
                ? { summaryMode: session.interpretation.summaryMode }
                : {}),
            heatLevel: session.trajectory.heatLevel,
            repetitionLevel: session.trajectory.repetitionLevel,
            direction: session.trajectory.direction,
            threadState: session.interpretation.threadState?.dominantTone ?? 'forming',
            sourceSupportPresent: session.interpretation.interpolator?.sourceSupportPresent ?? false,
            factualSignalPresent: session.interpretation.interpolator?.factualSignalPresent ?? false,
            topContributors: session.contributors.contributors,
            entityLandscape: session.entities.entityLandscape,
            writerEntities: session.entities.writerEntities,
        },
        filters: {
            active: activeFilter,
            available: ['Top', 'Latest', 'Clarifying', 'New angles', 'Source-backed'],
        },
        featuredContribution,
        visibleContributions,
        hiddenContributionCount,
        warnedContributionCount,
        contributions: allContributions,
    };
}
function applyThreadFilter(contributions, activeFilter) {
    const next = [...contributions];
    switch (activeFilter) {
        case 'Top':
            return next.sort((a, b) => {
                const bScore = b.finalInfluenceScore ?? b.qualityScore ?? 0;
                const aScore = a.finalInfluenceScore ?? a.qualityScore ?? 0;
                return bScore - aScore;
            });
        case 'Latest':
            return next.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        case 'Clarifying':
            return next.filter((contribution) => contribution.contributionRole === 'clarifying'
                || contribution.conversationalRole === 'clarification');
        case 'New angles':
            return next.filter((contribution) => contribution.contributionRole === 'new_information'
                || contribution.contributionRole === 'useful_counterpoint'
                || contribution.conversationalRole === 'new_information');
        case 'Source-backed':
            return next.filter((contribution) => contribution.evidencePresent === true
                || (contribution.factualContributionScore ?? 0) > 0.4);
        default:
            return next;
    }
}
function pickFeaturedContribution(contributions) {
    const featured = contributions.find((contribution) => {
        const influence = contribution.finalInfluenceScore ?? 0;
        return influence > 0.75 && !contribution.isWarned;
    });
    return featured ?? null;
}
//# sourceMappingURL=threadProjection.js.map