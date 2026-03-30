export type ISODate = string;
export type UrlString = string;
export type VerificationClaimType = 'factual_assertion' | 'source_citation' | 'quote' | 'rule_interpretation' | 'statistical_claim' | 'timeline_claim' | 'image_claim' | 'video_claim' | 'mixed' | 'opinion' | 'unclear';
export type SourceType = 'none' | 'primary_document' | 'official_rule' | 'official_statement' | 'government_record' | 'court_record' | 'standards_body' | 'reputable_reporting' | 'secondary_summary' | 'user_screenshot' | 'reverse_image_match' | 'unknown';
export type FactualState = 'none' | 'known-fact-check-match' | 'well-supported' | 'partially-supported' | 'source-backed-clarification' | 'contested' | 'unsupported-so-far' | 'media-context-warning';
export type VerificationReason = 'known-fact-check-match' | 'primary-source-cited' | 'official-rule-cited' | 'official-statement-cited' | 'document-quoted' | 'direct-quote-present' | 'claim-is-checkable' | 'specific-date-or-number' | 'entity-grounded' | 'corrective-context' | 'clarifies-ambiguity' | 'source-quality-high' | 'quote-fidelity-high' | 'multiple-reputable-sources' | 'conflicting-reputable-sources' | 'media-recontextualized' | 'image-earlier-than-claimed' | 'timestamp-mismatch' | 'no-strong-evidence-yet';
export interface VerificationEntityHint {
    id: string;
    label: string;
    type: 'actor' | 'topic' | 'event' | 'team' | 'person' | 'organization' | 'rule' | 'source' | 'location' | 'concept';
    confidence: number;
}
export interface VerificationEmbed {
    url: UrlString;
    domain?: string;
    title?: string;
    description?: string;
    mimeType?: string;
}
export interface VerificationMediaItem {
    url: UrlString;
    mimeType?: string;
    alt?: string;
    width?: number;
    height?: number;
}
export interface VerificationRequest {
    postUri: string;
    text: string;
    createdAt?: ISODate;
    facets?: Array<{
        type: 'link' | 'mention' | 'tag';
        text: string;
        uri?: string;
    }>;
    embeds?: VerificationEmbed[];
    media?: VerificationMediaItem[];
    entities?: VerificationEntityHint[];
    locale?: string;
    signal?: AbortSignal;
}
export interface ExtractedClaim {
    text: string;
    claimType: VerificationClaimType;
    checkability: number;
    quotedTextSpans?: string[];
    normalizedSubject?: string;
    normalizedPredicate?: string;
    normalizedObject?: string;
}
export interface ClaimExtractionResult {
    claims: ExtractedClaim[];
    model?: string;
    latencyMs?: number;
}
export interface FactCheckHit {
    claimant?: string;
    claimReviewTitle?: string;
    publisher?: string;
    url: UrlString;
    reviewDate?: ISODate;
    textualRating?: string;
    languageCode?: string;
    matchConfidence: number;
}
export interface FactCheckResult {
    matched: boolean;
    hits: FactCheckHit[];
    model?: string;
    latencyMs?: number;
}
export interface GroundingSource {
    url: UrlString;
    title?: string;
    domain: string;
    sourceType: SourceType;
    sourceQuality: number;
    supports: boolean;
    contradicts: boolean;
    excerpt?: string;
    publishedAt?: ISODate;
}
export interface GroundingResult {
    sources: GroundingSource[];
    summary?: string;
    corroborationLevel: number;
    contradictionLevel: number;
    model?: string;
    latencyMs?: number;
}
export interface MediaVerificationMatch {
    originalUrl?: UrlString;
    domain?: string;
    publishedAt?: ISODate;
    contextTitle?: string;
    confidence: number;
    notes?: string;
}
export interface MediaVerificationResult {
    matches: MediaVerificationMatch[];
    mediaContextConfidence: number;
    mediaContextWarning: boolean;
    model?: string;
    latencyMs?: number;
}
export interface VerificationOutcome {
    request: VerificationRequest;
    extractedClaims: ClaimExtractionResult;
    factCheck: FactCheckResult | null;
    grounding: GroundingResult | null;
    media: MediaVerificationResult | null;
    claimType: VerificationClaimType;
    sourceType: SourceType;
    sourceDomain?: string;
    citedUrls: UrlString[];
    quotedTextSpans: string[];
    checkability: number;
    sourcePresence: number;
    sourceQuality: number;
    quoteFidelity: number;
    specificity: number;
    contextValue: number;
    entityGrounding: number;
    correctionValue: number;
    corroborationLevel: number;
    contradictionLevel: number;
    mediaContextConfidence: number;
    factualContributionScore: number;
    factualConfidence: number;
    factualState: FactualState;
    reasons: VerificationReason[];
    diagnostics: {
        providerFailures: string[];
        latencyMs: number;
    };
}
export interface VerificationOptions {
    maxTextLength?: number;
    maxClaims?: number;
    timeoutMs?: number;
    useFactCheck?: boolean;
    useGrounding?: boolean;
    useMediaVerification?: boolean;
}
export interface ClaimExtractorProvider {
    extractClaim(input: VerificationRequest): Promise<ClaimExtractionResult>;
}
export interface FactCheckProvider {
    lookup(input: {
        request: VerificationRequest;
        claims: ExtractedClaim[];
        signal?: AbortSignal;
    }): Promise<FactCheckResult>;
}
export interface GroundingProvider {
    ground(input: {
        request: VerificationRequest;
        claims: ExtractedClaim[];
        signal?: AbortSignal;
    }): Promise<GroundingResult>;
}
export interface MediaVerificationProvider {
    inspect(input: {
        request: VerificationRequest;
        claims: ExtractedClaim[];
        signal?: AbortSignal;
    }): Promise<MediaVerificationResult>;
}
export interface VerificationProviders {
    claimExtractor?: ClaimExtractorProvider;
    factCheck?: FactCheckProvider;
    grounding?: GroundingProvider;
    media?: MediaVerificationProvider;
}
//# sourceMappingURL=types.d.ts.map