import type { ClaimExtractionResult, ClaimExtractorProvider, FactCheckProvider, FactCheckResult, GroundingProvider, GroundingResult, MediaVerificationProvider, MediaVerificationResult, VerificationRequest } from './types.js';
export declare class HeuristicClaimExtractorProvider implements ClaimExtractorProvider {
    extractClaim(input: VerificationRequest): Promise<ClaimExtractionResult>;
}
export declare class NoopFactCheckProvider implements FactCheckProvider {
    lookup(): Promise<FactCheckResult>;
}
export declare class NoopGroundingProvider implements GroundingProvider {
    ground(): Promise<GroundingResult>;
}
export declare class NoopMediaVerificationProvider implements MediaVerificationProvider {
    inspect(): Promise<MediaVerificationResult>;
}
//# sourceMappingURL=noopProviders.d.ts.map