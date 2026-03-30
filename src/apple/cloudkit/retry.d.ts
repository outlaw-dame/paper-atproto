export interface RetryPolicy {
    baseDelayMs: number;
    maxDelayMs: number;
    maxAttempts: number;
}
type BreakerState = 'closed' | 'open' | 'half-open';
export declare function retryWithFullJitter<T>(fn: () => Promise<T>, policy?: RetryPolicy): Promise<T>;
export declare function getBreakerState(): BreakerState;
export {};
//# sourceMappingURL=retry.d.ts.map