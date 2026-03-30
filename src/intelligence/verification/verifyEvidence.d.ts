import type { VerificationOptions, VerificationOutcome, VerificationProviders, VerificationRequest } from './types.js';
import { type VerificationCache } from './cache.js';
export interface VerifyEvidenceContext {
    cache?: VerificationCache;
    cacheTtlMs?: number;
}
export declare function verifyEvidence(requestInput: VerificationRequest, providers: VerificationProviders, options?: VerificationOptions, context?: VerifyEvidenceContext): Promise<VerificationOutcome>;
//# sourceMappingURL=verifyEvidence.d.ts.map