interface SensitiveMediaMetricsSnapshot {
    impressions: number;
    reveals: number;
    reHides: number;
    droppedEvents: number;
    queuedEvents: number;
    lastFlushAt: number | null;
}
export declare function recordSensitiveMediaImpression(reasonCount: number, optedIn: boolean): void;
export declare function recordSensitiveMediaReveal(reasonCount: number, optedIn: boolean): void;
export declare function recordSensitiveMediaRehide(reasonCount: number, optedIn: boolean): void;
export declare function getSensitiveMediaMetricsSnapshot(): SensitiveMediaMetricsSnapshot;
export {};
//# sourceMappingURL=sensitiveMediaTelemetry.d.ts.map