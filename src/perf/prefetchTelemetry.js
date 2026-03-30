const moduleMetrics = {
    'tab-explore': { attempts: 0, successes: 0, failures: 0, totalDurationMs: 0, lastDurationMs: null },
    'tab-profile': { attempts: 0, successes: 0, failures: 0, totalDurationMs: 0, lastDurationMs: null },
    'overlay-host': { attempts: 0, successes: 0, failures: 0, totalDurationMs: 0, lastDurationMs: null },
    'compose-sheet': { attempts: 0, successes: 0, failures: 0, totalDurationMs: 0, lastDurationMs: null },
    'prompt-composer': { attempts: 0, successes: 0, failures: 0, totalDurationMs: 0, lastDurationMs: null },
    'story-mode': { attempts: 0, successes: 0, failures: 0, totalDurationMs: 0, lastDurationMs: null },
    'search-story': { attempts: 0, successes: 0, failures: 0, totalDurationMs: 0, lastDurationMs: null },
    'atproto-queries': { attempts: 0, successes: 0, failures: 0, totalDurationMs: 0, lastDurationMs: null },
};
const featureMetrics = {
    compose: { opens: 0, mounts: 0, pendingStartMs: null, firstOpenLatencyMs: null, firstOpenUsedPrefetch: null },
    promptComposer: { opens: 0, mounts: 0, pendingStartMs: null, firstOpenLatencyMs: null, firstOpenUsedPrefetch: null },
    storyMode: { opens: 0, mounts: 0, pendingStartMs: null, firstOpenLatencyMs: null, firstOpenUsedPrefetch: null },
    searchStory: { opens: 0, mounts: 0, pendingStartMs: null, firstOpenLatencyMs: null, firstOpenUsedPrefetch: null },
};
const prefetchedModules = new Set();
function now() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
    }
    return Date.now();
}
function computeFirstOpenHitRate() {
    const values = Object.values(featureMetrics).filter((m) => m.firstOpenUsedPrefetch !== null);
    if (!values.length)
        return 0;
    const hits = values.filter((m) => m.firstOpenUsedPrefetch === true).length;
    return hits / values.length;
}
function publishSnapshot() {
    if (typeof window === 'undefined')
        return;
    const snapshot = {
        modules: moduleMetrics,
        features: featureMetrics,
        prefetchedModules: [...prefetchedModules],
        firstOpenPrefetchHitRate: computeFirstOpenHitRate(),
    };
    window.__GLYMPSE_PREFETCH_METRICS__ = snapshot;
}
export function markPrefetchStart(moduleKey) {
    moduleMetrics[moduleKey].attempts += 1;
    publishSnapshot();
    return now();
}
export function markPrefetchEnd(moduleKey, startedAt, success) {
    const durationMs = Math.max(0, now() - startedAt);
    const metric = moduleMetrics[moduleKey];
    if (success) {
        metric.successes += 1;
        prefetchedModules.add(moduleKey);
    }
    else {
        metric.failures += 1;
    }
    metric.totalDurationMs += durationMs;
    metric.lastDurationMs = durationMs;
    publishSnapshot();
}
export function markFeatureOpen(feature) {
    const metric = featureMetrics[feature];
    metric.opens += 1;
    if (metric.firstOpenLatencyMs === null && metric.pendingStartMs === null) {
        metric.pendingStartMs = now();
    }
    publishSnapshot();
}
export function markFeatureMounted(feature, moduleKey) {
    const metric = featureMetrics[feature];
    metric.mounts += 1;
    if (metric.firstOpenLatencyMs === null && metric.pendingStartMs !== null) {
        metric.firstOpenLatencyMs = Math.max(0, now() - metric.pendingStartMs);
        metric.firstOpenUsedPrefetch = prefetchedModules.has(moduleKey);
        metric.pendingStartMs = null;
    }
    publishSnapshot();
}
export function getPrefetchMetricsSnapshot() {
    return {
        modules: moduleMetrics,
        features: featureMetrics,
        prefetchedModules: [...prefetchedModules],
        firstOpenPrefetchHitRate: computeFirstOpenHitRate(),
    };
}
//# sourceMappingURL=prefetchTelemetry.js.map