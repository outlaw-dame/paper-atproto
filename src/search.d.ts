export declare class HybridSearch {
    /**
     * Generate a semantic embedding for a given text via the inference worker.
     */
    generateEmbedding(text: string): Promise<number[]>;
    /**
     * Perform a hybrid search using Reciprocal Rank Fusion (RRF).
     * RRF score = sum(1 / (k + rank)) across FTS and semantic rankings.
     */
    search(query: string, limit?: number): Promise<import("@electric-sql/pglite").Results<unknown>>;
    /**
     * Search across both posts and feed items using hybrid search.
     */
    searchAll(query: string, limit?: number): Promise<import("@electric-sql/pglite").Results<unknown>>;
    /**
     * Search local feed items (including podcasts) with hybrid ranking.
     */
    searchFeedItems(query: string, limit?: number): Promise<import("@electric-sql/pglite").Results<unknown>>;
}
export declare const hybridSearch: HybridSearch;
//# sourceMappingURL=search.d.ts.map