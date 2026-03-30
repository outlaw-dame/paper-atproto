type PrefetchModuleKey = 'tab-explore' | 'tab-profile' | 'overlay-host' | 'compose-sheet' | 'prompt-composer' | 'story-mode' | 'search-story' | 'atproto-queries';
type FeatureKey = 'compose' | 'promptComposer' | 'storyMode' | 'searchStory';
interface ModuleMetric {
    attempts: number;
    successes: number;
    failures: number;
    totalDurationMs: number;
    lastDurationMs: number | null;
}
interface FeatureMetric {
    opens: number;
    mounts: number;
    pendingStartMs: number | null;
    firstOpenLatencyMs: number | null;
    firstOpenUsedPrefetch: boolean | null;
}
interface PrefetchMetricsSnapshot {
    modules: Record<PrefetchModuleKey, ModuleMetric>;
    features: Record<FeatureKey, FeatureMetric>;
    prefetchedModules: PrefetchModuleKey[];
    firstOpenPrefetchHitRate: number;
}
export declare function markPrefetchStart(moduleKey: PrefetchModuleKey): number;
export declare function markPrefetchEnd(moduleKey: PrefetchModuleKey, startedAt: number, success: boolean): void;
export declare function markFeatureOpen(feature: FeatureKey): void;
export declare function markFeatureMounted(feature: FeatureKey, moduleKey: PrefetchModuleKey): void;
export declare function getPrefetchMetricsSnapshot(): PrefetchMetricsSnapshot;
export {};
//# sourceMappingURL=prefetchTelemetry.d.ts.map