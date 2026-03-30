import type { SourceType, VerificationClaimType, VerificationEntityHint, VerificationReason, VerificationRequest } from './types.js';
export declare function clamp01(value: number): number;
export declare function sanitizeVerificationRequest(input: VerificationRequest, maxTextLength?: number): VerificationRequest;
export declare function inferClaimType(text: string): VerificationClaimType;
export declare function computeSourceTypeFromUrls(urls: string[]): SourceType;
export declare function sourceTypeQuality(sourceType: SourceType): number;
export declare function checkabilityScore(text: string, claimType: VerificationClaimType): number;
export declare function specificityScore(text: string): number;
export declare function entityGroundingScore(entities?: VerificationEntityHint[]): number;
export declare function buildReasons(input: {
    sourceType: SourceType;
    checkability: number;
    specificity: number;
    quoteFidelity: number;
    entityGrounding: number;
    correctionValue: number;
    contextValue: number;
    corroborationLevel: number;
    contradictionLevel: number;
    mediaContextWarning: boolean;
}): VerificationReason[];
//# sourceMappingURL=utils.d.ts.map