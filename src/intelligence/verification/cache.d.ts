import type { VerificationOutcome } from './types.js';
export interface VerificationCache {
    get(key: string): Promise<VerificationOutcome | null>;
    set(key: string, value: VerificationOutcome, ttlMs?: number): Promise<void>;
}
export declare class InMemoryVerificationCache implements VerificationCache {
    private readonly map;
    get(key: string): Promise<VerificationOutcome | null>;
    set(key: string, value: VerificationOutcome, ttlMs?: number): Promise<void>;
}
export declare function verificationCacheKey(postUri: string, text: string): string;
//# sourceMappingURL=cache.d.ts.map