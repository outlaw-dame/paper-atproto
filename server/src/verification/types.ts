export type ClaimType =
  | 'none'
  | 'factual_assertion'
  | 'rule_interpretation'
  | 'timeline_claim'
  | 'statistical_claim'
  | 'media_claim'
  | 'quote_claim'
  | 'mixed';

export type SourceType =
  | 'none'
  | 'primary_document'
  | 'official_rule'
  | 'official_statement'
  | 'government_record'
  | 'court_record'
  | 'standards_body'
  | 'reputable_reporting'
  | 'secondary_summary'
  | 'user_screenshot'
  | 'unknown';

export type FactualState =
  | 'none'
  | 'known_fact_check_match'
  | 'source_backed_clarification'
  | 'well_supported'
  | 'partially_supported'
  | 'contested'
  | 'unsupported_so_far'
  | 'media_context_warning';

export type FactualContributionReason =
  | 'primary-source-cited'
  | 'official-rule-cited'
  | 'official-statement-cited'
  | 'document-quoted'
  | 'direct-quote-present'
  | 'claim-is-checkable'
  | 'specific-date-or-number'
  | 'entity-grounded'
  | 'corrective-context'
  | 'clarifies-ambiguity'
  | 'source-quality-high'
  | 'quote-fidelity-high'
  | 'known-fact-check-match'
  | 'media-context-match'
  | 'media-context-mismatch-risk'
  | 'multi-source-corroboration';

export type VerificationInput = {
  postUri?: string;
  text: string;
  urls?: string[];
  imageUrls?: string[];
  languageCode?: string;
  topicHints?: string[];
};

export type FactCheckMatch = {
  claimText: string;
  claimant?: string;
  claimDate?: string;
  reviewUrl: string;
  reviewTitle?: string;
  publisherName?: string;
  publisherSite?: string;
  textualRating?: string;
  languageCode?: string;
  reviewDate?: string;
  matchConfidence: number;
};

export type GroundingSource = {
  uri: string;
  title?: string;
  domain: string;
  sourceType: SourceType;
};

export type GroundingResult = {
  summary: string | null;
  sources: GroundingSource[];
  corroborationLevel: number;
  contradictionLevel: number;
  quoteFidelity: number;
  contextValue: number;
  correctionValue: number;
};

export type MediaVerificationResult = {
  bestGuessLabels: string[];
  webEntities: Array<{ description?: string; score?: number }>;
  pagesWithMatchingImages: string[];
  fullMatchingImages: string[];
  mediaContextConfidence: number;
  mismatchRisk: number;
};

export type VerificationResult = {
  claimType: ClaimType;
  extractedClaim: string | null;

  knownFactCheckMatch: boolean;
  factCheckMatches: FactCheckMatch[];

  sourcePresence: number;
  sourceType: SourceType;
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
  factualState: FactualState;
  reasons: FactualContributionReason[];
  /** Wikidata/DBpedia canonical entities (confidence ≥ 0.55) resolved from this reply's text.
   *  Always returned so the client can upgrade locally-generated entity IDs. */
  canonicalEntities?: Array<{
    mention: string;
    canonicalId: string;
    canonicalLabel: string;
    confidence: number;
    provider: string;
  }>;
  /** Debug-only: full entity linking diagnostic output. */
  entityLinking?: {
    provider: 'heuristic' | 'rel' | 'dbpedia' | 'wikidata' | 'hybrid';
    endpoint?: string;
  };
};
