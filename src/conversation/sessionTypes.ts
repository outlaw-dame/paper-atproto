import type { ThreadNode } from '../lib/resolver/atproto';
import type {
  AtUri,
  ContributionRole,
  ContributionScores,
  ThreadInterpolatorState,
  ContributorImpact,
  EntityImpact,
} from '../intelligence/interpolatorTypes';
import type { VerificationOutcome } from '../intelligence/verification/index';
import type {
  ConfidenceState,
  SummaryMode,
  InterpolatorWriteResult,
  WriterEntity,
  WriterMediaFinding,
} from '../intelligence/llmContracts';
import type { ConversationDeltaDecision } from '../intelligence/conversationDelta';
import type {
  DeepInterpolatorResult,
  PremiumAiEntitlements,
} from '../intelligence/premiumContracts';
import type { ConversationSupervisorState } from './supervisorTypes';

export type ConversationSessionId = AtUri;
export type ConversationSessionMode = 'thread' | 'story' | 'profile_slice';

export type DeferredReason =
  | 'outside_focused_branch'
  | 'collapsed_for_readability'
  | 'moderation_hidden'
  | 'unresolved_fetch_depth'
  | 'manual_collapse';

export type ConversationDirection =
  | 'forming'
  | 'clarifying'
  | 'escalating'
  | 'stalled'
  | 'fragmenting';

export type ConversationalRole =
  | 'anchor'
  | 'context_setter'
  | 'new_information'
  | 'clarification'
  | 'agreement'
  | 'disagreement'
  | 'question'
  | 'evidence'
  | 'escalation'
  | 'repetition'
  | 'tangent'
  | 'op_continuation'
  | 'unknown';

export interface ContributionSignal {
  role: ConversationalRole;
  roleConfidence: number;
  addedInformation: boolean;
  evidencePresent: boolean;
  isRepetitive: boolean;
  heatContribution: number;
  qualityScore: number;
  interpretiveWeight?: number;
  viewpointClusterId?: string;
  claimDensity?: number;
}

export type InterpolatorConfidence = ConfidenceState;

export interface InterpretiveConfidenceFactors {
  semanticCoherence: number;
  evidenceAdequacy: number;
  contextCompleteness: number;
  perspectiveBreadth: number;
  ambiguityPenalty: number;
  contradictionPenalty: number;
  repetitionPenalty: number;
  heatPenalty: number;
  coverageGapPenalty: number;
  freshnessPenalty: number;
  sourceIntegritySupport: number;
  userLabelSupport: number;
  modelAgreement: number;
}

export interface InterpretiveConfidenceExplanation {
  score: number;
  mode: SummaryMode;
  factors: InterpretiveConfidenceFactors;
  rationale: string[];
  boostedBy: string[];
  degradedBy: string[];
}

export interface InterpretiveState {
  semanticCoherence: 'high' | 'medium' | 'low';
  contextCompleteness: 'high' | 'medium' | 'low';
  perspectiveBreadth: 'broad' | 'moderate' | 'narrow';
  ambiguity: 'low' | 'medium' | 'high';
  coverageCompleteness: 'high' | 'medium' | 'low';
}

export interface ConversationNode extends ThreadNode {
  branchDepth: number;
  siblingIndex: number;
  descendantCount: number;
  isOptimistic?: boolean;
  optimisticClientId?: string;

  hiddenByModeration?: boolean;
  warnedByModeration?: boolean;
  deferredReason?: DeferredReason;

  contributionRole?: ContributionRole;
  contributionScores?: ContributionScores;
  contributionSignal?: ContributionSignal;

  isOriginalPoster?: boolean;
  isHighImpactContributor?: boolean;
  isSourceBringer?: boolean;
}

export interface SessionGraph {
  rootUri: AtUri;
  nodesByUri: Record<AtUri, ConversationNode>;
  childUrisByParent: Record<AtUri, AtUri[]>;
  parentUriByChild: Record<AtUri, AtUri | undefined>;
  subtreeEndHints: Record<AtUri, AtUri | undefined>;
}

export interface ThreadStateSignal {
  dominantTone: 'constructive' | 'contested' | 'repetitive' | 'heated' | 'mixed' | 'forming';
  informationDensity: 'high' | 'medium' | 'low';
  evidencePresence: boolean;
  topContributors: string[];
  conversationPhase: 'active' | 'resolving' | 'stalled' | 'escalating';
  interpolatorConfidence: InterpolatorConfidence;
  interpretiveState?: InterpretiveState;
}

export interface SessionStructureState {
  focusedAnchorUri: AtUri;
  focusedBranchUri?: AtUri;
  visibleUris: AtUri[];
  deferredUris: AtUri[];
  hiddenUris: AtUri[];
  revealedWarnUris: AtUri[];
  unresolvedChildCountsByUri: Record<AtUri, number>;
}

export type MentalHealthCrisisCategory =
  | 'self-harm'
  | 'suicidal'
  | 'severe-depression'
  | 'hopelessness'
  | 'isolation';

export interface SessionInterpretationState {
  interpolator: ThreadInterpolatorState | null;
  scoresByUri: Record<AtUri, ContributionScores>;
  writerResult: InterpolatorWriteResult | null;
  mediaFindings?: WriterMediaFinding[];
  confidence: ConfidenceState | null;
  summaryMode: SummaryMode | null;
  deltaDecision?: ConversationDeltaDecision | null;
  threadState: ThreadStateSignal | null;
  interpretiveExplanation: InterpretiveConfidenceExplanation | null;
  lastComputedAt?: string;
  mentalHealthSignal?: {
    detected: boolean;
    category?: MentalHealthCrisisCategory;
  };
  aiDiagnostics?: SessionAiDiagnostics;
  supervisor?: ConversationSupervisorState;
  premium: {
    status: 'idle' | 'loading' | 'ready' | 'error' | 'not_entitled';
    entitlements?: PremiumAiEntitlements;
    deepInterpolator?: DeepInterpolatorResult;
    lastError?: string;
  };
}

export interface SessionEvidenceState {
  verificationByUri: Record<AtUri, VerificationOutcome>;
  rootVerification: VerificationOutcome | null;
}

export interface SessionEntityState {
  writerEntities: WriterEntity[];
  canonicalEntities: Array<{
    id: string;
    label: string;
    type: string;
    confidence: number;
    mentionCount: number;
  }>;
  entityLandscape: EntityImpact[];
}

export interface SessionContributorState {
  contributors: ContributorImpact[];
  topContributorDids: string[];
}

export interface SessionTranslationState {
  byUri: Record<AtUri, {
    translatedText?: string;
    sourceLang?: string;
    targetLang?: string;
  }>;
}

export interface ConversationContinuitySnapshot {
  recordedAt: string;
  summaryMode?: SummaryMode | null;
  direction: ConversationDirection;
  dominantTone?: ThreadStateSignal['dominantTone'];
  conversationPhase?: ThreadStateSignal['conversationPhase'];
  heatLevel: number;
  repetitionLevel: number;
  sourceSupportPresent: boolean;
  factualSignalPresent: boolean;
  continuityLabel?: string;
  whatChanged: string[];
}

export type ConversationMutationKind =
  | 'optimistic_reply_inserted'
  | 'optimistic_reply_reconciled'
  | 'optimistic_reply_rolled_back'
  | 'user_feedback_set'
  | 'warned_post_revealed'
  | 'focused_branch_changed';

export interface ConversationMutationDelta {
  revision: number;
  at: string;
  kind: ConversationMutationKind;
  summary: string;
  targetUri?: AtUri;
  relatedUri?: AtUri;
}

export interface SessionMutationState {
  revision: number;
  lastMutationAt?: string;
  recent: ConversationMutationDelta[];
}

export type ConversationModelRunStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'error'
  | 'skipped';

export type ConversationModelRunSkipReason =
  | 'interpolator_disabled'
  | 'minimal_fallback'
  | 'insufficient_signal'
  | 'no_meaningful_change'
  | 'multimodal_not_needed'
  | 'no_media_candidates'
  | 'privacy_restricted'
  | 'not_entitled'
  | 'premium_ineligible';

export interface ConversationModelRunDiagnostics {
  provider: 'interpolator_writer' | 'qwen_multimodal' | 'gemini';
  status: ConversationModelRunStatus;
  sourceToken?: string;
  lastRequestedAt?: string;
  lastCompletedAt?: string;
  lastDurationMs?: number;
  lastError?: string;
  lastSkipReason?: ConversationModelRunSkipReason;
  staleDiscardCount: number;
  lastDiscardedAt?: string;
}

export interface SessionAiDiagnostics {
  writer: ConversationModelRunDiagnostics;
  multimodal: ConversationModelRunDiagnostics;
  premium: ConversationModelRunDiagnostics;
}

export interface SessionTrajectoryState {
  direction: ConversationDirection;
  heatLevel: number;
  repetitionLevel: number;
  activityVelocity: number;
  turningPoints: Array<{
    at: string;
    kind: 'new_evidence' | 'new_entity' | 'heat_spike' | 'branch_split';
    uri?: AtUri;
  }>;
  snapshots: ConversationContinuitySnapshot[];
}

export interface ConversationSession {
  id: ConversationSessionId;
  mode: ConversationSessionMode;
  graph: SessionGraph;
  structure: SessionStructureState;
  interpretation: SessionInterpretationState;
  evidence: SessionEvidenceState;
  entities: SessionEntityState;
  contributors: SessionContributorState;
  translations: SessionTranslationState;
  trajectory: SessionTrajectoryState;
  mutations: SessionMutationState;
  meta: {
    status: 'idle' | 'loading' | 'ready' | 'error';
    error?: string | null;
    lastHydratedAt?: string;
  };
}
