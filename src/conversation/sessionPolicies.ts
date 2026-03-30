import type {
  AtUri,
  ContributionRole,
  ContributionScores,
} from '../intelligence/interpolatorTypes';
import type { VerificationOutcome } from '../intelligence/verification/index';
import { extractClusterSignals } from '../lib/resolver/atproto';
import type {
  ConversationNode,
  ConversationSession,
  ContributionSignal,
  InterpretiveConfidenceExplanation,
  InterpretiveState,
  ThreadStateSignal,
} from './sessionTypes';

export type ThreadViewPolicy =
  | 'anchor_linear'
  | 'anchor_tree'
  | 'root_tree'
  | 'focused_branch';

export interface ProjectionPolicy {
  threadView: ThreadViewPolicy;
  maxInlineChildrenPerBranch: number;
  deferLowPriorityBranches: boolean;
  showModerationWarningsInline: boolean;
}

export const defaultAnchorLinearPolicy: ProjectionPolicy = {
  threadView: 'anchor_linear',
  maxInlineChildrenPerBranch: 3,
  deferLowPriorityBranches: true,
  showModerationWarningsInline: true,
};

export const INTERPRETIVE_CONFIDENCE_WEIGHTS = {
  semanticCoherence: 0.22,
  evidenceAdequacy: 0.18,
  contextCompleteness: 0.14,
  perspectiveBreadth: 0.12,
  sourceIntegritySupport: 0.10,
  userLabelSupport: 0.08,
  modelAgreement: 0.06,
  ambiguityPenalty: 0.04,
  contradictionPenalty: 0.03,
  repetitionPenalty: 0.01,
  heatPenalty: 0.01,
  coverageGapPenalty: 0.008,
  freshnessPenalty: 0.002,
} as const;

export const INTERPRETIVE_SUMMARY_MODE_THRESHOLDS = {
  normal: 0.72,
  descriptiveFallback: 0.42,
} as const;

export const INTERPRETIVE_CONFIDENCE_GATES = {
  insufficientContextCap: 0.42,
  lowEvidenceHighAmbiguityCap: 0.35,
  rapidContradictionCap: 0.30,
  shallowThreadCap: 0.45,
  contextCompletenessFloor: 0.45,
  evidenceAdequacyFloor: 0.25,
  ambiguityCeiling: 0.70,
  contradictionCeiling: 0.75,
  modelAgreementFloor: 0.30,
  shallowThreadNodeCount: 4,
} as const;

export function annotateConversationQuality(
  session: ConversationSession,
): ConversationSession {
  const nextNodes: Record<AtUri, ConversationNode> = { ...session.graph.nodesByUri };

  for (const node of Object.values(nextNodes)) {
    const scores = session.interpretation.scoresByUri[node.uri];
    const verification = session.evidence.verificationByUri[node.uri];

    const contributionSignal: ContributionSignal = {
      role: mapContributionRoleToConversationalRole(scores?.role),
      roleConfidence: inferRoleConfidence(scores),
      addedInformation:
        scores?.role === 'new_information'
        || (scores?.factual?.factualContributionScore ?? 0) > 0.45,
      evidencePresent:
        (verification?.sourcePresence ?? 0) > 0.3
        || scores?.role === 'source_bringer'
        || scores?.role === 'rule_source',
      isRepetitive: scores?.role === 'repetitive',
      heatContribution:
        scores?.role === 'provocative'
          ? Math.max(0.5, scores?.abuseScore ?? 0)
          : 0,
      qualityScore: computeQualityScore(scores, verification),
      claimDensity: inferClaimDensity(node.text, scores, verification),
      viewpointClusterId: inferViewpointClusterId(node, scores, verification),
    };

    contributionSignal.interpretiveWeight = inferInterpretiveWeight(contributionSignal);

    nextNodes[node.uri] = {
      ...node,
      ...(scores?.role ? { contributionRole: scores.role } : {}),
      ...(scores ? { contributionScores: scores } : {}),
      contributionSignal,
      isHighImpactContributor: (scores?.finalInfluenceScore ?? 0) > 0.75,
      isSourceBringer:
        scores?.role === 'source_bringer'
        || scores?.role === 'rule_source'
        || (verification?.sourcePresence ?? 0) > 0.5,
    };
  }

  return {
    ...session,
    graph: {
      ...session.graph,
      nodesByUri: nextNodes,
    },
  };
}

export function assignDeferredReasons(
  session: ConversationSession,
  policy: ProjectionPolicy,
): ConversationSession {
  const nextNodes: Record<AtUri, ConversationNode> = { ...session.graph.nodesByUri };
  const deferredUris: AtUri[] = [];
  const hiddenUris: AtUri[] = [];

  for (const node of Object.values(nextNodes)) {
    if (node.uri === session.graph.rootUri) {
      continue;
    }

    if (node.hiddenByModeration) {
      nextNodes[node.uri] = { ...node, deferredReason: 'moderation_hidden' };
      hiddenUris.push(node.uri);
      continue;
    }

    if (
      policy.threadView === 'focused_branch'
      && session.structure.focusedBranchUri
      && !isInFocusedBranch(session, node.uri, session.structure.focusedBranchUri)
    ) {
      nextNodes[node.uri] = { ...node, deferredReason: 'outside_focused_branch' };
      deferredUris.push(node.uri);
      continue;
    }

    if (
      policy.deferLowPriorityBranches
      && (node.contributionSignal?.isRepetitive
      || (node.contributionSignal?.qualityScore ?? 0) < 0.2)
    ) {
      nextNodes[node.uri] = { ...node, deferredReason: 'collapsed_for_readability' };
      deferredUris.push(node.uri);
    }
  }

  return {
    ...session,
    graph: {
      ...session.graph,
      nodesByUri: nextNodes,
    },
    structure: {
      ...session.structure,
      deferredUris,
      hiddenUris,
    },
  };
}

export function deriveThreadStateSignal(session: ConversationSession): ThreadStateSignal {
  const interpolator = session.interpretation.interpolator;
  const confidence = session.interpretation.confidence;
  const explanation = session.interpretation.interpretiveExplanation;
  const interpretiveState = explanation
    ? deriveInterpretiveState(explanation)
    : undefined;
  const contradictionPenalty = explanation?.factors.contradictionPenalty ?? 0;
  const heatPenalty = explanation?.factors.heatPenalty ?? 0;
  const repetitionPenalty = explanation?.factors.repetitionPenalty ?? 0;
  const evidenceAdequacy = explanation?.factors.evidenceAdequacy ?? 0;

  return {
    dominantTone:
      heatPenalty > 0.72 || (interpolator?.heatLevel ?? 0) > 0.7
        ? 'heated'
        : repetitionPenalty > 0.7 || (interpolator?.repetitionLevel ?? 0) > 0.7
          ? 'repetitive'
          : contradictionPenalty > 0.5
            ? 'contested'
            : (interpolator?.clarificationsAdded?.length ?? 0) > 0
            ? 'constructive'
            : 'forming',
    informationDensity:
      interpolator?.factualSignalPresent
        ? 'high'
        : (interpolator?.entityLandscape?.length ?? 0) > 2
          ? 'medium'
          : 'low',
    evidencePresence: interpolator?.sourceSupportPresent ?? false,
    topContributors: (interpolator?.topContributors ?? []).map((c) => c.did),
    conversationPhase:
      heatPenalty > 0.72 || (interpolator?.heatLevel ?? 0) > 0.7
        ? 'escalating'
        : contradictionPenalty > 0.55 && evidenceAdequacy >= 0.55
          ? 'resolving'
          : repetitionPenalty > 0.7 || (interpolator?.repetitionLevel ?? 0) > 0.7
          ? 'stalled'
          : 'active',
    interpolatorConfidence: {
      surfaceConfidence: confidence?.surfaceConfidence ?? 0,
      entityConfidence: confidence?.entityConfidence ?? 0,
      interpretiveConfidence: confidence?.interpretiveConfidence ?? 0,
    },
    ...(interpretiveState ? { interpretiveState } : {}),
  };
}

function mapContributionRoleToConversationalRole(
  role?: ContributionRole,
): ContributionSignal['role'] {
  switch (role) {
    case 'clarifying':
      return 'clarification';
    case 'new_information':
      return 'new_information';
    case 'source_bringer':
    case 'rule_source':
      return 'evidence';
    case 'provocative':
      return 'escalation';
    case 'repetitive':
      return 'repetition';
    case 'direct_response':
      return 'agreement';
    case 'useful_counterpoint':
      return 'disagreement';
    case 'story_worthy':
      return 'context_setter';
    default:
      return 'unknown';
  }
}

function inferRoleConfidence(scores?: ContributionScores): number {
  if (!scores) return 0;

  return Math.max(
    0.2,
    Math.min(
      1,
      (scores.usefulnessScore ?? 0) * 0.35
      + (scores.factual?.factualConfidence ?? 0) * 0.25
      + (scores.finalInfluenceScore ?? 0) * 0.4,
    ),
  );
}

function computeQualityScore(
  scores?: ContributionScores,
  verification?: VerificationOutcome,
): number {
  if (!scores) return 0;

  const novelty = scores.role === 'new_information' ? 0.25 : 0;
  const evidence = verification ? (verification.factualContributionScore ?? 0) * 0.25 : 0;
  const usefulness = (scores.usefulnessScore ?? 0) * 0.3;
  const influence = (scores.finalInfluenceScore ?? 0) * 0.2;

  return Math.min(1, usefulness + influence + novelty + evidence);
}

function inferClaimDensity(
  text: string,
  scores?: ContributionScores,
  verification?: VerificationOutcome,
): number {
  const normalizedLength = Math.min(1, text.trim().length / 220);
  const evidenceDensity = Math.min(
    1,
    (scores?.evidenceSignals.filter((signal) => signal.kind !== 'speculation').length ?? 0) / 3,
  );
  const checkability = verification?.checkability ?? 0;
  const specificity = verification?.specificity ?? 0;

  return clamp01(
    0.30 * normalizedLength
    + 0.25 * evidenceDensity
    + 0.25 * checkability
    + 0.20 * specificity,
  );
}

function inferViewpointClusterId(
  node: ConversationNode,
  scores?: ContributionScores,
  verification?: VerificationOutcome,
): string {
  const clusterSignals = extractClusterSignals(node.text, node.facets, node.embed, node.labels);
  const roleBucket = scores?.role === 'useful_counterpoint'
    ? 'counterpoint'
    : scores?.role === 'direct_response'
      ? 'response'
      : scores?.role === 'clarifying'
        ? 'clarification'
        : scores?.role === 'source_bringer' || scores?.role === 'rule_source'
          ? 'evidence'
          : 'general';
  const domainKey = clusterSignals.domains[0];
  const quoteKey = clusterSignals.quotedUris[0];
  const tagKey = clusterSignals.hashtags[0];
  const evidenceKey = (verification?.sourceType ?? 'none') !== 'none'
    ? `source:${verification?.sourceType ?? 'none'}`
    : undefined;

  return [
    roleBucket,
    domainKey ? `domain:${domainKey}` : undefined,
    quoteKey ? `quote:${quoteKey.slice(-16)}` : undefined,
    tagKey ? `tag:${tagKey}` : undefined,
    evidenceKey,
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('|') || `author:${node.authorDid}`;
}

function inferInterpretiveWeight(signal: ContributionSignal): number {
  return clamp01(
    0.40 * signal.qualityScore
    + 0.25 * (signal.addedInformation ? 1 : 0)
    + 0.20 * (signal.evidencePresent ? 1 : 0)
    + 0.15 * (signal.claimDensity ?? 0),
  );
}

function deriveInterpretiveState(
  explanation: InterpretiveConfidenceExplanation,
): InterpretiveState {
  return {
    semanticCoherence: toLevel(explanation.factors.semanticCoherence),
    contextCompleteness: toLevel(explanation.factors.contextCompleteness),
    perspectiveBreadth:
      explanation.factors.perspectiveBreadth >= 0.7
        ? 'broad'
        : explanation.factors.perspectiveBreadth >= 0.4
          ? 'moderate'
          : 'narrow',
    ambiguity:
      explanation.factors.ambiguityPenalty >= 0.66
        ? 'high'
        : explanation.factors.ambiguityPenalty >= 0.33
          ? 'medium'
          : 'low',
    coverageCompleteness: toLevel(1 - explanation.factors.coverageGapPenalty),
  };
}

function toLevel(value: number): 'high' | 'medium' | 'low' {
  if (value >= 0.7) return 'high';
  if (value >= 0.4) return 'medium';
  return 'low';
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function isInFocusedBranch(
  session: ConversationSession,
  uri: AtUri,
  branchUri: AtUri,
): boolean {
  if (uri === branchUri) return true;

  let cursor = session.graph.parentUriByChild[uri];
  while (cursor) {
    if (cursor === branchUri) return true;
    cursor = session.graph.parentUriByChild[cursor];
  }

  return false;
}
