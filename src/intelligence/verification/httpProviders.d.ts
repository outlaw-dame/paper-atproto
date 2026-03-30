import type { ClaimExtractionResult, ClaimExtractorProvider, FactCheckProvider, FactCheckResult, GroundingProvider, GroundingResult, MediaVerificationProvider, MediaVerificationResult, VerificationRequest } from './types.js';
export interface HttpProviderOptions {
    baseUrl: string;
    timeoutMs?: number;
    retries?: number;
    headers?: Record<string, string>;
}
export declare class HttpClaimExtractorProvider implements ClaimExtractorProvider {
    private readonly options;
    constructor(options: HttpProviderOptions);
    extractClaim(input: VerificationRequest): Promise<ClaimExtractionResult>;
}
export declare class HttpFactCheckProvider implements FactCheckProvider {
    private readonly options;
    constructor(options: HttpProviderOptions);
    lookup(input: {
        request: VerificationRequest;
        claims: any[];
        signal?: AbortSignal;
    }): Promise<FactCheckResult>;
}
export declare class HttpGroundingProvider implements GroundingProvider {
    private readonly options;
    constructor(options: HttpProviderOptions);
    ground(input: {
        request: VerificationRequest;
        claims: any[];
        signal?: AbortSignal;
    }): Promise<GroundingResult>;
}
export declare class HttpMediaVerificationProvider implements MediaVerificationProvider {
    private readonly options;
    constructor(options: HttpProviderOptions);
    inspect(input: {
        request: VerificationRequest;
        claims: any[];
        signal?: AbortSignal;
    }): Promise<MediaVerificationResult>;
}
/** Matches the VerificationResult shape returned by the verify-server. */
export interface ServerVerificationResult {
    claimType: string;
    extractedClaim: string | null;
    knownFactCheckMatch: boolean;
    factCheckMatches: Array<{
        claimText: string;
        reviewUrl: string;
        matchConfidence: number;
        textualRating?: string;
        publisherName?: string;
    }>;
    sourcePresence: number;
    sourceType: string;
    sourceDomain?: string;
    citedUrls: string[];
    quoteFidelity: number;
    corroborationLevel: number;
    contradictionLevel: number;
    mediaContextConfidence: number;
    entityGrounding: number;
    contextValue: number;
    correctionValue: number;
    checkability: number;
    specificity: number;
    factualContributionScore: number;
    factualConfidence: number;
    factualState: string;
    reasons: string[];
}
export interface VerificationClientInput {
    postUri?: string;
    text: string;
    urls?: string[];
    imageUrls?: string[];
    languageCode?: string;
    topicHints?: string[];
}
export declare class VerificationHttpClient {
    private readonly baseUrl;
    private readonly sharedSecret?;
    constructor(baseUrl: string, sharedSecret?: string | undefined);
    verifyEvidence(input: VerificationClientInput): Promise<ServerVerificationResult>;
}
/** Computes the factual contribution boost to add to an existing score. */
export declare function computeVerificationBoost(verification: {
    factualContributionScore: number;
    factualConfidence: number;
}): number;
//# sourceMappingURL=httpProviders.d.ts.map