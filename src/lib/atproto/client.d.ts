import { type RetryOptions } from './retry.js';
import { type AtpError } from './errors.js';
export type { AtpError };
export declare const ATP_AUTH_EXPIRED_EVENT = "paper:atproto-auth-expired";
export interface CallOptions extends RetryOptions {
    /** Milliseconds before the request is automatically cancelled. Default: 15 000 ms */
    timeoutMs?: number;
}
/**
 * Wraps any ATProto agent call with retry, error normalization, and timeout.
 * Throws a normalized `AtpError`-shaped object on failure.
 */
export declare function atpCall<T>(fn: (signal: AbortSignal) => Promise<T>, opts?: CallOptions): Promise<T>;
/**
 * Convenience: fire-and-forget with no retry (e.g. like/repost mutations).
 * Returns null on failure instead of throwing, so UI can handle it gracefully.
 */
export declare function atpMutate<T>(fn: (signal: AbortSignal) => Promise<T>, opts?: Omit<CallOptions, 'maxAttempts'>): Promise<T | null>;
//# sourceMappingURL=client.d.ts.map