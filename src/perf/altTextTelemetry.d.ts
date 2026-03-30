interface AltTextMetricsSnapshot {
    postsWithMedia: number;
    postsWithFullAlt: number;
    postsWithMissingAlt: number;
    totalPostedMediaItems: number;
    totalPostedDescribedItems: number;
    bulkRuns: number;
    bulkRequestedItems: number;
    bulkGeneratedItems: number;
    bulkFailedItems: number;
    completionRate: number;
    bulkSuccessRate: number;
}
export declare function recordAltPostCoverage(mediaItems: number, describedItems: number): void;
export declare function recordBulkAltRun(requestedItems: number, generatedItems: number, failedItems: number): void;
export declare function getAltTextMetricsSnapshot(): AltTextMetricsSnapshot;
export {};
//# sourceMappingURL=altTextTelemetry.d.ts.map