// ─── mapVisibleChips ──────────────────────────────────────────────────────
// Derives UI chips from a VerificationOutcome, merging into any existing chips
// (existing chips take priority; new chips are de-duplicated by kind).
function mapVisibleChips(verification, existing) {
    const chips = new Map(existing.map(c => [c.kind, c]));
    if (verification.factCheck?.matched) {
        chips.set('fact-checked', { kind: 'fact-checked', label: 'Fact-checked', confidence: 1 });
    }
    if (verification.sourcePresence > 0.3 && verification.sourceQuality > 0.4) {
        chips.set('source-backed', {
            kind: 'source-backed',
            label: 'Source-backed',
            confidence: verification.sourceQuality,
        });
    }
    if (verification.quoteFidelity >= 0.65) {
        chips.set('direct-quote', {
            kind: 'direct-quote',
            label: 'Direct quote',
            confidence: verification.quoteFidelity,
        });
    }
    if (verification.mediaContextConfidence > 0.3) {
        chips.set('media-verified', {
            kind: 'media-verified',
            label: 'Media verified',
            confidence: verification.mediaContextConfidence,
        });
    }
    if (verification.contradictionLevel >= 0.45) {
        chips.set('contested', {
            kind: 'contested',
            label: 'Contested',
            confidence: verification.contradictionLevel,
        });
    }
    if (verification.correctionValue >= 0.60) {
        chips.set('clarification', {
            kind: 'clarification',
            label: 'Clarification',
            confidence: verification.correctionValue,
        });
    }
    if (verification.factualState === 'well-supported') {
        chips.set('well-supported', { kind: 'well-supported', label: 'Well-supported' });
    }
    else if (verification.factualState === 'partially-supported') {
        chips.set('partially-supported', { kind: 'partially-supported', label: 'Partially supported' });
    }
    else if (verification.factualState === 'source-backed-clarification') {
        chips.set('corrective-context', { kind: 'corrective-context', label: 'Corrective context' });
    }
    return Array.from(chips.values());
}
// ─── mergeVerificationIntoContributionScore ───────────────────────────────
// Enriches a ContributionScores with the full 18-field FactualEvidence from a
// completed VerificationOutcome. finalInfluenceScore is boosted by
// 0.20 × factualContributionScore × factualConfidence (capped at 1).
// visibleChips are recalculated and merged with any previously set chips.
export function mergeVerificationIntoContributionScore(score, verification) {
    const boost = 0.20 * verification.factualContributionScore * verification.factualConfidence;
    const finalInfluenceScore = Math.max(0, Math.min(1, score.finalInfluenceScore + boost));
    const factual = {
        claimPresent: verification.claimType !== 'opinion' && verification.claimType !== 'unclear',
        claimType: verification.claimType,
        knownFactCheckMatch: verification.factCheck?.matched ?? false,
        factCheckMatchConfidence: verification.factCheck?.hits?.[0]?.matchConfidence ?? 0,
        sourcePresence: verification.sourcePresence,
        sourceType: verification.sourceType,
        ...(verification.sourceDomain !== undefined ? { sourceDomain: verification.sourceDomain } : {}),
        sourceQuality: verification.sourceQuality,
        quoteFidelity: verification.quoteFidelity,
        corroborationLevel: verification.corroborationLevel,
        contradictionLevel: verification.contradictionLevel,
        mediaContextConfidence: verification.mediaContextConfidence,
        entityGrounding: verification.entityGrounding,
        contextValue: verification.contextValue,
        correctionValue: verification.correctionValue,
        citedUrls: verification.citedUrls,
        quotedTextSpans: verification.quotedTextSpans,
        factualContributionScore: verification.factualContributionScore,
        factualConfidence: verification.factualConfidence,
        factualState: verification.factualState,
        reasons: verification.reasons,
    };
    return {
        ...score,
        factual,
        finalInfluenceScore,
        visibleChips: mapVisibleChips(verification, score.visibleChips),
    };
}
//# sourceMappingURL=mergeVerificationIntoScore.js.map