export type AtpErrorKind = 'auth' | 'forbidden' | 'not_found' | 'rate_limit' | 'server' | 'network' | 'cancelled' | 'unknown';
export interface AtpError {
    kind: AtpErrorKind;
    message: string;
    status?: number;
    retryAfterMs?: number;
    original: unknown;
}
export declare const RETRYABLE_STATUSES: Set<number>;
export declare const FATAL_STATUSES: Set<number>;
export declare function normalizeError(err: unknown): AtpError;
export declare function isRetryable(err: AtpError): boolean;
//# sourceMappingURL=errors.d.ts.map