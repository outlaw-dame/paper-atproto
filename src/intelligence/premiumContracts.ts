import type {
  ConfidenceState,
  SummaryMode,
  ThreadStateForWriter,
} from './llmContracts';

export type PremiumAiTier = 'free' | 'plus' | 'pro';
export type PremiumAiProvider = 'gemini' | 'openai';
export type PremiumAiProviderPreference = PremiumAiProvider | 'auto';

export type PremiumAiCapability = 'deep_interpolator' | 'explore_insight';

export type ExploreIntentKind = 'general' | 'hashtag' | 'people' | 'source' | 'feed' | 'visual';

export interface ExploreInsightRequest {
  query: string;
  intentKind: ExploreIntentKind;
  intentConfidence: number;
  storyId: string;
  titleHint?: string | undefined;
  candidatePosts: Array<{
    uri: string;
    handle: string;
    text: string;
    impactScore: number;
  }>;
  safeEntities: Array<{
    id: string;
    label: string;
    type: string;
    confidence: number;
    impact: number;
  }>;
  factualHighlights: string[];
  confidence: ConfidenceState;
}

export interface ExploreInsightResult {
  insight: string;
  shortInsight?: string | undefined;
  provider: PremiumAiProvider;
  abstained: boolean;
  safety?: PremiumAiSafetyMetadata | undefined;
}

export interface PremiumAiEntitlements {
  tier: PremiumAiTier;
  capabilities: PremiumAiCapability[];
  providerAvailable: boolean;
  availableProviders?: PremiumAiProvider[] | undefined;
  provider?: PremiumAiProvider;
}

export interface PremiumAiSafetyMetadata {
  flagged: boolean;
  severity: 'none' | 'low' | 'medium' | 'high';
  categories: string[];
}

export interface PremiumInterpretiveBrief {
  summaryMode: SummaryMode;
  baseSummary?: string | undefined;
  dominantTone?: string | undefined;
  conversationPhase?: string | undefined;
  supports: string[];
  limits: string[];
}

export interface PremiumInterpolatorRequest extends ThreadStateForWriter {
  actorDid: string;
  interpretiveBrief: PremiumInterpretiveBrief;
}

export interface DeepInterpolatorResult {
  summary: string;
  groundedContext?: string | undefined;
  perspectiveGaps: string[];
  followUpQuestions: string[];
  confidence: number;
  provider: PremiumAiProvider;
  updatedAt: string;
  sourceComputedAt?: string | undefined;
  safety?: PremiumAiSafetyMetadata | undefined;
}

export interface PremiumThreadProjection {
  status: 'idle' | 'loading' | 'ready' | 'error' | 'not_entitled';
  isEntitled: boolean;
  entitlements?: PremiumAiEntitlements | undefined;
  deepInterpolator?: DeepInterpolatorResult | undefined;
  lastError?: string | undefined;
}

export interface PremiumEntitlementRequest {
  actorDid: string;
}

export interface PremiumThreadSummaryInput {
  summaryMode: SummaryMode;
  confidence: ConfidenceState;
  visibleReplyCount?: number | undefined;
  rootPost: ThreadStateForWriter['rootPost'];
  selectedComments: ThreadStateForWriter['selectedComments'];
  safeEntities: ThreadStateForWriter['safeEntities'];
  factualHighlights: ThreadStateForWriter['factualHighlights'];
  whatChangedSignals: ThreadStateForWriter['whatChangedSignals'];
}
