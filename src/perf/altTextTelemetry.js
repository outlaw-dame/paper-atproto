const metrics = {
    postsWithMedia: 0,
    postsWithFullAlt: 0,
    postsWithMissingAlt: 0,
    totalPostedMediaItems: 0,
    totalPostedDescribedItems: 0,
    bulkRuns: 0,
    bulkRequestedItems: 0,
    bulkGeneratedItems: 0,
    bulkFailedItems: 0,
};
function toRate(numerator, denominator) {
    if (denominator <= 0)
        return 0;
    return numerator / denominator;
}
function snapshot() {
    return {
        ...metrics,
        completionRate: toRate(metrics.totalPostedDescribedItems, metrics.totalPostedMediaItems),
        bulkSuccessRate: toRate(metrics.bulkGeneratedItems, metrics.bulkRequestedItems),
    };
}
function publishSnapshot() {
    if (typeof window === 'undefined')
        return;
    window.__GLYMPSE_ALT_METRICS__ = snapshot();
}
export function recordAltPostCoverage(mediaItems, describedItems) {
    if (mediaItems <= 0)
        return;
    metrics.postsWithMedia += 1;
    metrics.totalPostedMediaItems += mediaItems;
    metrics.totalPostedDescribedItems += Math.max(0, Math.min(mediaItems, describedItems));
    if (describedItems >= mediaItems) {
        metrics.postsWithFullAlt += 1;
    }
    else {
        metrics.postsWithMissingAlt += 1;
    }
    publishSnapshot();
}
export function recordBulkAltRun(requestedItems, generatedItems, failedItems) {
    const requested = Math.max(0, requestedItems);
    const generated = Math.max(0, Math.min(requested, generatedItems));
    const failed = Math.max(0, Math.min(requested, failedItems));
    metrics.bulkRuns += 1;
    metrics.bulkRequestedItems += requested;
    metrics.bulkGeneratedItems += generated;
    metrics.bulkFailedItems += failed;
    publishSnapshot();
}
export function getAltTextMetricsSnapshot() {
    return snapshot();
}
//# sourceMappingURL=altTextTelemetry.js.map