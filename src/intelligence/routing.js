// ─── Routing — Narwhal v3 ─────────────────────────────────────────────────
// Multimodal score, summary mode routing, and inclusion threshold helpers.
// All functions are pure and synchronous.
export function computeMultimodalScore(s) {
    return Math.max(0, Math.min(1, 0.20 * s.hasMedia +
        0.20 * s.mediaTextDensity +
        0.20 * s.mediaReferenceDensity +
        0.20 * s.mediaClaimDependency +
        0.10 * s.mediaVerificationFlag +
        0.10 * s.nonTextSignalGap));
}
/** Returns true when Qwen3-VL should run for this thread. */
export function shouldRunMultimodal(s) {
    return computeMultimodalScore(s) >= 0.55;
}
// ─── Summary mode ─────────────────────────────────────────────────────────
/**
 * Selects the appropriate summary mode for the writer.
 *
 * normal             → full structured summary
 * descriptive_fallback → root post + observable replies + high-confidence
 *                        contributors/entities + uncertainty sentence
 * minimal_fallback   → minimal root-post summary + limited reply activity
 */
export function chooseSummaryMode(input) {
    if (input.interpretiveConfidence < 0.45 && input.surfaceConfidence >= 0.60) {
        return 'descriptive_fallback';
    }
    if (input.interpretiveConfidence < 0.45 && input.surfaceConfidence < 0.60) {
        return 'minimal_fallback';
    }
    return 'normal';
}
// ─── Inclusion thresholds ─────────────────────────────────────────────────
/**
 * Whether a contributor may be named in the summary.
 * OP may always be named. Non-OP thresholds tighten in fallback mode.
 */
export function contributorMayBeNamed(impactScore, isOp, summaryMode) {
    if (isOp)
        return true;
    if (summaryMode === 'normal')
        return impactScore >= 0.50;
    return impactScore >= 0.68;
}
/**
 * Whether an entity may be named in the summary.
 * Thresholds tighten significantly in fallback mode.
 */
export function entityMayBeNamed(entityConfidence, entityImpact, summaryMode) {
    if (summaryMode === 'normal')
        return entityConfidence >= 0.50 && entityImpact >= 0.30;
    return entityConfidence >= 0.78 && entityImpact >= 0.60;
}
// ─── Comment selection ────────────────────────────────────────────────────
/**
 * Returns the top N comments by impact score for the writer.
 * Comment count is capped tightly in fallback modes to prevent over-interpretation.
 */
export function selectTopCommentsForWriter(comments, mode) {
    const sorted = [...comments].sort((a, b) => b.impactScore - a.impactScore);
    if (mode === 'normal')
        return sorted.slice(0, 10);
    if (mode === 'descriptive_fallback')
        return sorted.slice(0, 5);
    return sorted.slice(0, 3);
}
//# sourceMappingURL=routing.js.map