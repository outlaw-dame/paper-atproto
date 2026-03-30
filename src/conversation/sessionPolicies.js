export const defaultAnchorLinearPolicy = {
    threadView: 'anchor_linear',
    maxInlineChildrenPerBranch: 3,
    deferLowPriorityBranches: true,
    showModerationWarningsInline: true,
};
export function annotateConversationQuality(session) {
    const nextNodes = { ...session.graph.nodesByUri };
    for (const node of Object.values(nextNodes)) {
        const scores = session.interpretation.scoresByUri[node.uri];
        const verification = session.evidence.verificationByUri[node.uri];
        const contributionSignal = {
            role: mapContributionRoleToConversationalRole(scores?.role),
            roleConfidence: inferRoleConfidence(scores),
            addedInformation: scores?.role === 'new_information'
                || (scores?.factual?.factualContributionScore ?? 0) > 0.45,
            evidencePresent: (verification?.sourcePresence ?? 0) > 0.3
                || scores?.role === 'source_bringer'
                || scores?.role === 'rule_source',
            isRepetitive: scores?.role === 'repetitive',
            heatContribution: scores?.role === 'provocative'
                ? Math.max(0.5, scores?.abuseScore ?? 0)
                : 0,
            qualityScore: computeQualityScore(scores, verification),
        };
        nextNodes[node.uri] = {
            ...node,
            ...(scores?.role ? { contributionRole: scores.role } : {}),
            ...(scores ? { contributionScores: scores } : {}),
            contributionSignal,
            isHighImpactContributor: (scores?.finalInfluenceScore ?? 0) > 0.75,
            isSourceBringer: scores?.role === 'source_bringer'
                || scores?.role === 'rule_source'
                || (verification?.sourcePresence ?? 0) > 0.5,
        };
    }
    return {
        ...session,
        graph: {
            ...session.graph,
            nodesByUri: nextNodes,
        },
    };
}
export function assignDeferredReasons(session, policy) {
    const nextNodes = { ...session.graph.nodesByUri };
    const deferredUris = [];
    const hiddenUris = [];
    for (const node of Object.values(nextNodes)) {
        if (node.uri === session.graph.rootUri) {
            continue;
        }
        if (node.hiddenByModeration) {
            nextNodes[node.uri] = { ...node, deferredReason: 'moderation_hidden' };
            hiddenUris.push(node.uri);
            continue;
        }
        if (policy.threadView === 'focused_branch'
            && session.structure.focusedBranchUri
            && !isInFocusedBranch(session, node.uri, session.structure.focusedBranchUri)) {
            nextNodes[node.uri] = { ...node, deferredReason: 'outside_focused_branch' };
            deferredUris.push(node.uri);
            continue;
        }
        if (policy.deferLowPriorityBranches
            && (node.contributionSignal?.isRepetitive
                || (node.contributionSignal?.qualityScore ?? 0) < 0.2)) {
            nextNodes[node.uri] = { ...node, deferredReason: 'collapsed_for_readability' };
            deferredUris.push(node.uri);
        }
    }
    return {
        ...session,
        graph: {
            ...session.graph,
            nodesByUri: nextNodes,
        },
        structure: {
            ...session.structure,
            deferredUris,
            hiddenUris,
        },
    };
}
export function deriveThreadStateSignal(session) {
    const interpolator = session.interpretation.interpolator;
    const confidence = session.interpretation.confidence;
    return {
        dominantTone: (interpolator?.heatLevel ?? 0) > 0.7
            ? 'heated'
            : (interpolator?.repetitionLevel ?? 0) > 0.7
                ? 'repetitive'
                : (interpolator?.clarificationsAdded?.length ?? 0) > 0
                    ? 'constructive'
                    : 'forming',
        informationDensity: interpolator?.factualSignalPresent
            ? 'high'
            : (interpolator?.entityLandscape?.length ?? 0) > 2
                ? 'medium'
                : 'low',
        evidencePresence: interpolator?.sourceSupportPresent ?? false,
        topContributors: (interpolator?.topContributors ?? []).map((c) => c.did),
        conversationPhase: (interpolator?.heatLevel ?? 0) > 0.7
            ? 'escalating'
            : (interpolator?.repetitionLevel ?? 0) > 0.7
                ? 'stalled'
                : 'active',
        interpolatorConfidence: {
            surfaceConfidence: confidence?.surfaceConfidence ?? 0,
            entityConfidence: confidence?.entityConfidence ?? 0,
            interpretiveConfidence: confidence?.interpretiveConfidence ?? 0,
        },
    };
}
function mapContributionRoleToConversationalRole(role) {
    switch (role) {
        case 'clarifying':
            return 'clarification';
        case 'new_information':
            return 'new_information';
        case 'source_bringer':
        case 'rule_source':
            return 'evidence';
        case 'provocative':
            return 'escalation';
        case 'repetitive':
            return 'repetition';
        case 'direct_response':
            return 'agreement';
        case 'useful_counterpoint':
            return 'disagreement';
        case 'story_worthy':
            return 'context_setter';
        default:
            return 'unknown';
    }
}
function inferRoleConfidence(scores) {
    if (!scores)
        return 0;
    return Math.max(0.2, Math.min(1, (scores.usefulnessScore ?? 0) * 0.35
        + (scores.factual?.factualConfidence ?? 0) * 0.25
        + (scores.finalInfluenceScore ?? 0) * 0.4));
}
function computeQualityScore(scores, verification) {
    if (!scores)
        return 0;
    const novelty = scores.role === 'new_information' ? 0.25 : 0;
    const evidence = verification ? (verification.factualContributionScore ?? 0) * 0.25 : 0;
    const usefulness = (scores.usefulnessScore ?? 0) * 0.3;
    const influence = (scores.finalInfluenceScore ?? 0) * 0.2;
    return Math.min(1, usefulness + influence + novelty + evidence);
}
function isInFocusedBranch(session, uri, branchUri) {
    if (uri === branchUri)
        return true;
    let cursor = session.graph.parentUriByChild[uri];
    while (cursor) {
        if (cursor === branchUri)
            return true;
        cursor = session.graph.parentUriByChild[cursor];
    }
    return false;
}
//# sourceMappingURL=sessionPolicies.js.map