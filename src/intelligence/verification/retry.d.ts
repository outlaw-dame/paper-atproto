export interface RetryOptions {
    retries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    jitter?: boolean;
    signal?: AbortSignal;
}
export declare function withRetry<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T>;
//# sourceMappingURL=retry.d.ts.map