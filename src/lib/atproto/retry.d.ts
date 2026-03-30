export interface RetryOptions {
    maxAttempts?: number;
    baseDelayMs?: number;
    capDelayMs?: number;
    signal?: AbortSignal;
}
export declare function withRetry<T>(fn: (attempt: number, signal?: AbortSignal) => Promise<T>, opts?: RetryOptions): Promise<T>;
//# sourceMappingURL=retry.d.ts.map