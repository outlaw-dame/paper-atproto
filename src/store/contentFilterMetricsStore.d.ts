import type { PostFilterMatch } from '../lib/contentFilters/types.js';
type ResultByPostId = Record<string, PostFilterMatch[]>;
type ContentFilterMetricsState = {
    filteredCountByRuleId: Record<string, number>;
    seenRulePostKeys: Record<string, true>;
    recordMatches: (context: string, results: ResultByPostId) => void;
    resetCounts: () => void;
};
export declare const useContentFilterMetricsStore: import("zustand").UseBoundStore<import("zustand").StoreApi<ContentFilterMetricsState>>;
export {};
//# sourceMappingURL=contentFilterMetricsStore.d.ts.map