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
} from '../intelligence/llmContracts';

export type ConversationSessionId = AtUri;

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

export interface SessionInterpretationState {
  interpolator: ThreadInterpolatorState | null;
  scoresByUri: Record<AtUri, ContributionScores>;
  writerResult: InterpolatorWriteResult | null;
  confidence: ConfidenceState | null;
  summaryMode: SummaryMode | null;
  threadState: ThreadStateSignal | null;
  interpretiveExplanation: InterpretiveConfidenceExplanation | null;
  lastComputedAt?: string;
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
}

export interface ConversationSession {
  id: ConversationSessionId;
  graph: SessionGraph;
  structure: SessionStructureState;
  interpretation: SessionInterpretationState;
  evidence: SessionEvidenceState;
  entities: SessionEntityState;
  contributors: SessionContributorState;
  translations: SessionTranslationState;
  trajectory: SessionTrajectoryState;
  meta: {
    status: 'idle' | 'loading' | 'ready' | 'error';
    error?: string | null;
    lastHydratedAt?: string;
  };
}
