import type {
  ConversationContinuitySnapshot,
  ConversationSession,
} from '../sessionTypes';
import type { ProjectionPolicy } from '../sessionPolicies';
import { buildInterpolatorSurfaceProjection } from '../adapters/interpolatorAdapter';
import type { PremiumThreadProjection } from '../../intelligence/premiumContracts';
import {
  resolveCurrentContinuitySnapshot,
} from '../continuitySnapshots';

export type ThreadFilter =
  | 'Top'
  | 'Latest'
  | 'Clarifying'
  | 'New angles'
  | 'Source-backed';

export interface ThreadProjectionContribution {
  uri: string;
  text: string;
  authorDid: string;
  authorHandle: string;
  authorName?: string;
  authorAvatar?: string;
  createdAt: string;
  likeCount: number;
  replyCount: number;
  repostCount: number;
  depth: number;
  facets: any[];
  embed: any;
  replies: any[];
  parentAuthorHandle?: string;

  isDeferred: boolean;
  deferredReason?: string;
  isHidden: boolean;
  isWarned: boolean;
  isRevealedWarn: boolean;
  isOp: boolean;
  isOptimistic: boolean;

  contributionRole?: string;
  conversationalRole?: string;
  qualityScore?: number;
  evidencePresent?: boolean;
  finalInfluenceScore?: number;
  usefulnessScore?: number;
  factualContributionScore?: number;
}

export interface ThreadProjection {
  hero: {
    rootUri: string;
    participantCount: number;
    rootVerificationPresent: boolean;
    rootNode: {
      uri: string;
      text: string;
      authorDid: string;
      authorHandle: string;
      authorName?: string;
      authorAvatar?: string;
      createdAt: string;
      likeCount: number;
      replyCount: number;
      repostCount: number;
      facets: any[];
      embed: any;
    } | null;
  };
  interpolator: {
    shouldRender: boolean;
    summaryText: string;
    writerSummary?: string;
    summaryMode?: string | null;
    confidence?: {
      surfaceConfidence: number;
      entityConfidence: number;
      interpretiveConfidence: number;
    } | null;
    explanation?: {
      interpretiveMode: string;
      primarySupports: string[];
      primaryLimits: string[];
    };
    heatLevel: number;
    repetitionLevel: number;
    direction: string;
    threadState: string;
    sourceSupportPresent: boolean;
    factualSignalPresent: boolean;
    topContributors: any[];
    entityLandscape: any[];
    writerEntities: any[];
    hasMentalHealthCrisis: boolean;
    mentalHealthCategory?: string;
    latestContinuity: ConversationContinuitySnapshot | null;
    premium: PremiumThreadProjection;
  };
  filters: {
    active: ThreadFilter;
    available: ThreadFilter[];
  };
  featuredContribution: ThreadProjectionContribution | null;
  visibleContributions: ThreadProjectionContribution[];
  hiddenContributionCount: number;
  warnedContributionCount: number;
  contributions: ThreadProjectionContribution[];
}

export function projectThreadView(
  session: ConversationSession,
  _policy: ProjectionPolicy,
  activeFilter: ThreadFilter = 'Top',
): ThreadProjection {
  const root = session.graph.nodesByUri[session.graph.rootUri];
  const rootAuthorDid = root?.authorDid;
  const interpolatorSurface = buildInterpolatorSurfaceProjection(session);
  const continuity = resolveCurrentContinuitySnapshot(session);

  const allContributions: ThreadProjectionContribution[] = Object.values(session.graph.nodesByUri)
    .filter((node) => node.uri !== session.graph.rootUri)
    .map((node) => ({
      uri: node.uri,
      text: node.text,
      authorDid: node.authorDid,
      authorHandle: node.authorHandle,
      ...(node.authorName ? { authorName: node.authorName } : {}),
      ...(node.authorAvatar ? { authorAvatar: node.authorAvatar } : {}),
      createdAt: node.createdAt,
      likeCount: node.likeCount,
      replyCount: node.replyCount,
      repostCount: node.repostCount,
      depth: node.branchDepth,
      facets: node.facets,
      embed: node.embed,
      replies: node.replies,
      ...(node.parentAuthorHandle ? { parentAuthorHandle: node.parentAuthorHandle } : {}),
      isDeferred: session.structure.deferredUris.includes(node.uri),
      ...(node.deferredReason ? { deferredReason: node.deferredReason } : {}),
      isHidden: !!node.hiddenByModeration,
      isWarned: !!node.warnedByModeration,
      isRevealedWarn: session.structure.revealedWarnUris.includes(node.uri),
      isOp: node.authorDid === rootAuthorDid,
      isOptimistic: !!node.isOptimistic,
      ...(node.contributionRole ? { contributionRole: node.contributionRole } : {}),
      ...(node.contributionSignal?.role ? { conversationalRole: node.contributionSignal.role } : {}),
      ...(node.contributionSignal?.qualityScore !== undefined
        ? { qualityScore: node.contributionSignal.qualityScore }
        : {}),
      ...(node.contributionSignal?.evidencePresent !== undefined
        ? { evidencePresent: node.contributionSignal.evidencePresent }
        : {}),
      ...(node.contributionScores?.finalInfluenceScore !== undefined
        ? { finalInfluenceScore: node.contributionScores.finalInfluenceScore }
        : {}),
      ...(node.contributionScores?.usefulnessScore !== undefined
        ? { usefulnessScore: node.contributionScores.usefulnessScore }
        : {}),
      ...(node.contributionScores?.factual?.factualContributionScore !== undefined
        ? { factualContributionScore: node.contributionScores.factual.factualContributionScore }
        : {}),
    }));

  const hiddenContributionCount = allContributions.filter((contribution) => contribution.isHidden).length;
  const warnedContributionCount = allContributions.filter((contribution) => contribution.isWarned).length;
  const moderationVisible = allContributions.filter((contribution) => !contribution.isHidden);
  const filtered = applyThreadFilter(moderationVisible, activeFilter);
  const featuredContribution = activeFilter === 'Top'
    ? pickFeaturedContribution(filtered)
    : null;
  const visibleContributions = featuredContribution
    ? filtered.filter((contribution) => contribution.uri !== featuredContribution.uri)
    : filtered;

  return {
    hero: {
      rootUri: session.graph.rootUri,
      participantCount: allContributions.length,
      rootVerificationPresent: !!session.evidence.rootVerification,
      rootNode: root
        ? {
            uri: root.uri,
            text: root.text,
            authorDid: root.authorDid,
            authorHandle: root.authorHandle,
            ...(root.authorName ? { authorName: root.authorName } : {}),
            ...(root.authorAvatar ? { authorAvatar: root.authorAvatar } : {}),
            createdAt: root.createdAt,
            likeCount: root.likeCount,
            replyCount: root.replyCount,
            repostCount: root.repostCount,
            facets: root.facets,
            embed: root.embed,
          }
        : null,
    },
    interpolator: {
      shouldRender: interpolatorSurface.shouldRender,
      summaryText: interpolatorSurface.summaryText,
      ...(interpolatorSurface.writerSummary
        ? { writerSummary: interpolatorSurface.writerSummary }
        : {}),
      ...(interpolatorSurface.summaryMode !== undefined
        ? { summaryMode: interpolatorSurface.summaryMode }
        : {}),
      ...(interpolatorSurface.confidence
        ? { confidence: interpolatorSurface.confidence }
        : {}),
      ...(interpolatorSurface.explanation
        ? { explanation: interpolatorSurface.explanation }
        : {}),
      heatLevel: session.trajectory.heatLevel,
      repetitionLevel: session.trajectory.repetitionLevel,
      direction: session.trajectory.direction,
      threadState: session.interpretation.threadState?.dominantTone ?? 'forming',
      sourceSupportPresent: session.interpretation.interpolator?.sourceSupportPresent ?? false,
      factualSignalPresent: session.interpretation.interpolator?.factualSignalPresent ?? false,
      topContributors: session.contributors.contributors,
      entityLandscape: session.entities.entityLandscape,
      writerEntities: session.entities.writerEntities,
      hasMentalHealthCrisis: interpolatorSurface.hasMentalHealthCrisis,
      ...(interpolatorSurface.mentalHealthCategory
        ? { mentalHealthCategory: interpolatorSurface.mentalHealthCategory }
        : {}),
      latestContinuity: continuity,
      premium: {
        status: session.interpretation.premium.status,
        isEntitled: (session.interpretation.premium.entitlements?.capabilities ?? [])
          .includes('deep_interpolator'),
        ...(session.interpretation.premium.entitlements
          ? { entitlements: session.interpretation.premium.entitlements }
          : {}),
        ...(session.interpretation.premium.deepInterpolator
          ? { deepInterpolator: session.interpretation.premium.deepInterpolator }
          : {}),
        ...(session.interpretation.premium.lastError
          ? { lastError: session.interpretation.premium.lastError }
          : {}),
      },
    },
    filters: {
      active: activeFilter,
      available: ['Top', 'Latest', 'Clarifying', 'New angles', 'Source-backed'],
    },
    featuredContribution,
    visibleContributions,
    hiddenContributionCount,
    warnedContributionCount,
    contributions: allContributions,
  };
}

function applyThreadFilter(
  contributions: ThreadProjectionContribution[],
  activeFilter: ThreadFilter,
): ThreadProjectionContribution[] {
  const next = [...contributions];
  const prependOptimistic = (
    filtered: ThreadProjectionContribution[],
  ): ThreadProjectionContribution[] => {
    const optimistic = next.filter((contribution) => contribution.isOptimistic);
    if (optimistic.length === 0) return filtered;

    const merged: ThreadProjectionContribution[] = [];
    const seen = new Set<string>();
    for (const contribution of [...optimistic, ...filtered]) {
      if (seen.has(contribution.uri)) continue;
      seen.add(contribution.uri);
      merged.push(contribution);
    }
    return merged;
  };

  switch (activeFilter) {
    case 'Top':
      return prependOptimistic(next.sort((a, b) => {
        const optimisticDelta = Number(b.isOptimistic) - Number(a.isOptimistic);
        if (optimisticDelta !== 0) return optimisticDelta;
        const bScore = b.finalInfluenceScore ?? b.qualityScore ?? 0;
        const aScore = a.finalInfluenceScore ?? a.qualityScore ?? 0;
        return bScore - aScore;
      }));

    case 'Latest':
      return prependOptimistic(next.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ));

    case 'Clarifying':
      return prependOptimistic(next.filter(
        (contribution) => contribution.contributionRole === 'clarifying'
          || contribution.conversationalRole === 'clarification',
      ));

    case 'New angles':
      return prependOptimistic(next.filter(
        (contribution) => contribution.contributionRole === 'new_information'
          || contribution.contributionRole === 'useful_counterpoint'
          || contribution.conversationalRole === 'new_information',
      ));

    case 'Source-backed':
      return prependOptimistic(next.filter(
        (contribution) => contribution.evidencePresent === true
          || (contribution.factualContributionScore ?? 0) > 0.4,
      ));

    default:
      return prependOptimistic(next);
  }
}

function pickFeaturedContribution(
  contributions: ThreadProjectionContribution[],
): ThreadProjectionContribution | null {
  const featured = contributions.find((contribution) => {
    const influence = contribution.finalInfluenceScore ?? 0;
    return influence > 0.75 && !contribution.isWarned;
  });

  return featured ?? null;
}
