import { extractClusterSignals } from '../../lib/resolver/atproto';
import { getExplicitContributionFeedback } from '../../intelligence/interpolatorTypes';
import type { VerificationOutcome } from '../../intelligence/verification/types';
import type {
  ConversationNode,
  ConversationSession,
  InterpretiveConfidenceFactors,
} from '../sessionTypes';

const STOPWORDS = new Set([
  'about', 'after', 'again', 'also', 'and', 'because', 'been', 'before', 'being',
  'between', 'could', 'from', 'have', 'into', 'just', 'more', 'most', 'only',
  'other', 'over', 'some', 'such', 'than', 'that', 'their', 'there', 'these',
  'they', 'this', 'those', 'very', 'were', 'what', 'when', 'with', 'would',
  'your',
]);

const REFERENCE_PRONOUN_RE = /\b(this|that|it|they|them|those|these|he|she|we|you)\b/i;

const TRANSPARENT_SOURCE_TYPES = new Set<VerificationOutcome['sourceType']>([
  'primary_document',
  'official_rule',
  'official_statement',
  'government_record',
  'court_record',
  'standards_body',
  'reputable_reporting',
]);

type SignalCollections = ReturnType<typeof extractClusterSignals>;

export interface InterpretiveFactorDiagnostics {
  hasRoot: boolean;
  visibleContributionCount: number;
  totalContributionCount: number;
  hiddenContributionCount: number;
  evidenceContributionCount: number;
  disagreementCount: number;
  clarificationCount: number;
  uniquePerspectiveCount: number;
  resolvedQuoteRatio: number;
}

export interface InterpretiveFactorComputation {
  factors: InterpretiveConfidenceFactors;
  diagnostics: InterpretiveFactorDiagnostics;
}

export function computeInterpretiveFactors(
  session: ConversationSession,
): InterpretiveFactorComputation {
  const root = session.graph.nodesByUri[session.graph.rootUri];
  const allContributions = Object.values(session.graph.nodesByUri)
    .filter((node) => node.uri !== session.graph.rootUri);
  const visibleContributions = allContributions.filter((node) => !node.hiddenByModeration);
  const relevantContributions = visibleContributions.filter(
    (node) => !node.contributionSignal?.isRepetitive,
  );
  const rootTokens = tokenize(root?.text ?? '');
  const rootSignals = root
    ? extractClusterSignals(root.text, root.facets, root.embed, root.labels)
    : emptySignals();
  const topEntityLabels = session.entities.entityLandscape
    .slice(0, 5)
    .flatMap((entity) => [entity.canonicalLabel, entity.entityText])
    .filter((label): label is string => typeof label === 'string' && label.trim().length > 0);

  const verificationByUri = session.evidence.verificationByUri;
  const hiddenContributionCount = allContributions.length - visibleContributions.length;
  const unresolvedChildCount = Object.values(session.structure.unresolvedChildCountsByUri)
    .reduce((sum, value) => sum + Math.max(0, value), 0);

  const visibleSignals = visibleContributions.map((node) => ({
    node,
    verification: verificationByUri[node.uri],
    clusterSignals: extractClusterSignals(node.text, node.facets, node.embed, node.labels),
  }));

  const replyTokenOverlap = average(
    visibleSignals.map(({ node }) => jaccardSimilarity(rootTokens, tokenize(node.text))),
    root ? 0.35 : 0,
  );
  const entityContinuity = topEntityLabels.length === 0
    ? clamp01(replyTokenOverlap + 0.2)
    : ratio(
      visibleSignals.filter(({ node }) => mentionsEntity(node.text, topEntityLabels)).length,
      visibleSignals.length,
      0.4,
    );
  const sharedSignalOverlap = root
    ? average(
      visibleSignals.map(({ clusterSignals }) => hasSharedSignal(rootSignals, clusterSignals) ? 1 : 0),
      hasAnySignal(rootSignals) ? 0.35 : 0.6,
    )
    : 0;
  const driftRatio = ratio(
    visibleSignals.filter(({ node }) => isDriftRole(node)).length,
    visibleSignals.length,
    0,
  );
  const semanticCoherence = clamp01(
    0.45 * replyTokenOverlap
    + 0.25 * entityContinuity
    + 0.20 * (1 - driftRatio)
    + 0.10 * sharedSignalOverlap,
  );

  const evidenceNodes = visibleSignals.filter(({ node, verification }) => {
    return isEvidenceLike(node) || (verification?.factualContributionScore ?? 0) > 0.35;
  });
  const evidenceContributionCount = evidenceNodes.length;
  const averageEvidenceStrength = average(
    evidenceNodes.map(({ node, verification }) => clamp01(
      0.20 * (node.contributionSignal?.qualityScore ?? 0)
      + 0.25 * (node.contributionSignal?.evidencePresent ? 1 : 0)
      + 0.20 * (verification?.sourcePresence ?? 0)
      + 0.20 * (verification?.factualContributionScore ?? 0)
      + 0.15 * (verification?.sourceQuality ?? 0)
    )),
    0,
  );
  const independentEvidenceAuthors = evidenceNodes.length === 0
    ? 0
    : clamp01(new Set(evidenceNodes.map(({ node }) => node.authorDid)).size / Math.max(2, evidenceNodes.length));
  const rootEvidenceSupport = session.evidence.rootVerification
    ? clamp01(
      0.5 * (session.evidence.rootVerification.sourcePresence ?? 0)
      + 0.5 * (session.evidence.rootVerification.sourceQuality ?? 0),
    )
    : 0;
  const evidenceAdequacy = clamp01(
    0.40 * ratio(evidenceNodes.length, visibleSignals.length, 0)
    + 0.35 * averageEvidenceStrength
    + 0.15 * independentEvidenceAuthors
    + 0.10 * rootEvidenceSupport,
  );

  const quotedNodes = visibleSignals.filter(({ node }) => hasQuotedContext(node));
  const resolvedQuoteRatio = quotedNodes.length === 0
    ? 1
    : ratio(
      quotedNodes.filter(({ node }) => hasResolvedQuoteContext(node)).length,
      quotedNodes.length,
      0,
    );
  const hiddenRatio = ratio(hiddenContributionCount, Math.max(allContributions.length, 1), 0);
  const unresolvedRatio = ratio(unresolvedChildCount, Math.max(allContributions.length, 1), 0);
  const visibleCoverage = allContributions.length === 0
    ? 1
    : clamp01(1 - hiddenRatio * 0.8 - unresolvedRatio * 0.6);
  const contextCompleteness = clamp01(
    0.45 * (root ? 1 : 0)
    + 0.25 * visibleCoverage
    + 0.20 * resolvedQuoteRatio
    + 0.10 * ratio(visibleSignals.length, Math.max(allContributions.length, 1), 1),
  );

  const perspectiveNodes = relevantContributions.filter(
    (node) => (node.contributionSignal?.interpretiveWeight ?? 0) >= 0.2,
  );
  const perspectiveClusterCounts = countBy(
    perspectiveNodes,
    (node) => node.contributionSignal?.viewpointClusterId ?? `author:${node.authorDid}`,
  );
  const uniquePerspectiveCount = Object.keys(perspectiveClusterCounts).length;
  const clusterBreadth = uniquePerspectiveCount <= 1
    ? Math.min(0.45, new Set(perspectiveNodes.map((node) => node.authorDid)).size / 4)
    : normalizedEntropy(Object.values(perspectiveClusterCounts));
  const roleBreadth = normalizedEntropy(
    Object.values(
      countBy(perspectiveNodes, (node) => breadthRoleBucket(node)),
    ),
  );
  const disagreementCount = visibleContributions.filter((node) => isDisagreementLike(node)).length;
  const clarificationCount = visibleContributions.filter(
    (node) => node.contributionSignal?.role === 'clarification',
  ).length;
  const counterpointPresence = disagreementCount > 0 ? 1 : 0;
  const authorBreadth = clamp01(new Set(perspectiveNodes.map((node) => node.authorDid)).size / 4);
  const perspectiveBreadth = clamp01(
    0.35 * clusterBreadth
    + 0.25 * roleBreadth
    + 0.25 * counterpointPresence
    + 0.15 * authorBreadth,
  );

  const ambiguityPenalty = clamp01(
    0.35 * ratio(visibleContributions.filter((node) => isShortReactive(node.text)).length, visibleContributions.length, 0)
    + 0.25 * ratio(visibleContributions.filter((node) => isPronounHeavy(node.text)).length, visibleContributions.length, 0)
    + 0.20 * ratio(visibleContributions.filter((node) => (node.contributionSignal?.role ?? 'unknown') === 'unknown').length, visibleContributions.length, 0)
    + 0.20 * ratio(visibleContributions.filter((node) => isQuestionDominated(node)).length, visibleContributions.length, 0),
  );

  const visibleVerification = visibleSignals
    .map(({ verification }) => verification)
    .filter((verification): verification is VerificationOutcome => verification !== undefined);
  const contradictionPenalty = clamp01(
    0.50 * average(visibleVerification.map((verification) => verification.contradictionLevel), 0)
    + 0.30 * ratio(
      visibleContributions.filter((node) => {
        if (!isDisagreementLike(node)) return false;
        const verification = verificationByUri[node.uri];
        return !node.contributionSignal?.evidencePresent
          && (verification?.factualContributionScore ?? 0) < 0.35;
      }).length,
      Math.max(disagreementCount, 1),
      0,
    )
    + 0.20 * ratio(
      visibleVerification.filter((verification) => {
        return verification.factualState === 'contested'
          || verification.factualState === 'unsupported-so-far';
      }).length,
      visibleVerification.length,
      0,
    ),
  );

  const repetitionPenalty = clamp01(
    0.60 * (session.trajectory.repetitionLevel ?? 0)
    + 0.40 * ratio(
      visibleContributions.filter((node) => node.contributionSignal?.isRepetitive).length,
      visibleContributions.length,
      0,
    ),
  );

  const rawHeatPenalty = clamp01(
    0.75 * (session.trajectory.heatLevel ?? 0)
    + 0.25 * ratio(
      visibleContributions.filter((node) => node.contributionSignal?.heatContribution ?? 0 > 0.35).length,
      visibleContributions.length,
      0,
    ),
  );
  const heatPenalty = clamp01(rawHeatPenalty * (1 - evidenceAdequacy * 0.35));

  const sourceDomainCounts = countBy(
    evidenceNodes.flatMap(({ clusterSignals }) => clusterSignals.domains),
    (domain) => domain,
  );
  const sourceDomainTotal = Object.values(sourceDomainCounts).reduce((sum, count) => sum + count, 0);
  const singleSourceDominance = sourceDomainTotal === 0
    ? 0
    : Math.max(...Object.values(sourceDomainCounts)) / sourceDomainTotal;
  const coverageGapPenalty = clamp01(
    0.45 * (1 - perspectiveBreadth)
    + 0.30 * singleSourceDominance
    + 0.15 * (counterpointPresence > 0 ? 0 : Math.min(1, evidenceNodes.length / 2))
    + 0.10 * (1 - resolvedQuoteRatio),
  );

  const timestamps = [root?.createdAt, ...visibleContributions.map((node) => node.createdAt)]
    .map((createdAt) => Date.parse(createdAt ?? ''))
    .filter((value) => Number.isFinite(value));
  const earliestTimestamp = timestamps.length > 0 ? Math.min(...timestamps) : undefined;
  const latestTimestamp = timestamps.length > 0 ? Math.max(...timestamps) : undefined;
  const timelineSpanMs = earliestTimestamp !== undefined && latestTimestamp !== undefined
    ? Math.max(0, latestTimestamp - earliestTimestamp)
    : 0;
  const compressedTimelinePenalty = timestamps.length <= 1
    ? 1
    : timelineSpanMs <= 60 * 60 * 1000
      ? 1 - (timelineSpanMs / (60 * 60 * 1000))
      : timelineSpanMs <= 4 * 60 * 60 * 1000
        ? 0.25
        : 0;
  const freshnessPenalty = clamp01(
    0.60 * clamp01(1 - Math.min(visibleContributions.length / 4, 1))
    + 0.40 * compressedTimelinePenalty,
  );

  const allVerification = [
    ...visibleVerification,
    ...(session.evidence.rootVerification ? [session.evidence.rootVerification] : []),
  ];
  const sourceIntegritySupport = clamp01(
    0.45 * average(allVerification.map((verification) => verification.sourceQuality), 0)
    + 0.25 * ratio(
      allVerification.filter((verification) => TRANSPARENT_SOURCE_TYPES.has(verification.sourceType)).length,
      allVerification.length,
      0,
    )
    + 0.20 * average(allVerification.map((verification) => verification.corroborationLevel), 0)
    + 0.10 * average(allVerification.map((verification) => verification.correctionValue), 0),
  );

  const feedbackNodes = visibleContributions.filter((node) => {
    return getExplicitContributionFeedback(session.interpretation.scoresByUri[node.uri]) !== undefined;
  });
  const userLabelSupport = feedbackNodes.length === 0
    ? 0.5
    : clamp01(
      0.55 * average(
        feedbackNodes.map((node) => feedbackScore(
          getExplicitContributionFeedback(session.interpretation.scoresByUri[node.uri]),
        )),
        0.5,
      )
      + 0.25 * average(
        feedbackNodes.map((node) => feedbackAlignment(
          getExplicitContributionFeedback(session.interpretation.scoresByUri[node.uri]),
          node,
        )),
        0.5,
      )
      + 0.20 * clamp01((feedbackNodes.length / Math.max(visibleContributions.length, 1)) * 2),
    );

  const evidenceAgreement = average(
    visibleContributions.map((node) => {
      const verification = verificationByUri[node.uri];
      const heuristicEvidence = isEvidenceLike(node);
      const verificationEvidence = (verification?.factualContributionScore ?? 0) >= 0.35
        || (verification?.sourcePresence ?? 0) >= 0.35;

      if (verification === undefined) {
        return heuristicEvidence ? 0.55 : 0.7;
      }

      if (heuristicEvidence === verificationEvidence) {
        return 1;
      }

      return verificationEvidence ? 0.6 : 0.35;
    }),
    0.55,
  );
  const heatAgreement = clamp01(
    1 - Math.abs(
      (session.trajectory.heatLevel ?? 0)
      - average(visibleContributions.map((node) => node.contributionSignal?.heatContribution ?? 0), 0),
    ),
  );
  const repetitionAgreement = clamp01(
    1 - Math.abs(
      (session.trajectory.repetitionLevel ?? 0)
      - ratio(
        visibleContributions.filter((node) => node.contributionSignal?.isRepetitive).length,
        visibleContributions.length,
        0,
      ),
    ),
  );
  const modelAgreement = clamp01(
    0.45 * evidenceAgreement
    + 0.30 * heatAgreement
    + 0.25 * repetitionAgreement,
  );

  return {
    factors: {
      semanticCoherence,
      evidenceAdequacy,
      contextCompleteness,
      perspectiveBreadth,
      ambiguityPenalty,
      contradictionPenalty,
      repetitionPenalty,
      heatPenalty,
      coverageGapPenalty,
      freshnessPenalty,
      sourceIntegritySupport,
      userLabelSupport,
      modelAgreement,
    },
    diagnostics: {
      hasRoot: Boolean(root),
      visibleContributionCount: visibleContributions.length,
      totalContributionCount: allContributions.length,
      hiddenContributionCount,
      evidenceContributionCount,
      disagreementCount,
      clarificationCount,
      uniquePerspectiveCount,
      resolvedQuoteRatio,
    },
  };
}

function tokenize(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[@#][\w.]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ');

  return [...new Set(
    normalized
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 2 && !STOPWORDS.has(token)),
  )];
}

function mentionsEntity(text: string, labels: string[]): boolean {
  const normalized = ` ${text.toLowerCase()} `;
  return labels.some((label) => normalized.includes(` ${label.toLowerCase()} `));
}

function hasSharedSignal(rootSignals: SignalCollections, nodeSignals: SignalCollections): boolean {
  return intersects(rootSignals.domains, nodeSignals.domains)
    || intersects(rootSignals.quotedUris, nodeSignals.quotedUris)
    || intersects(rootSignals.hashtags, nodeSignals.hashtags)
    || intersects(rootSignals.mentionedDids, nodeSignals.mentionedDids)
    || intersects(rootSignals.labelValues, nodeSignals.labelValues);
}

function hasAnySignal(signals: SignalCollections): boolean {
  return signals.domains.length > 0
    || signals.quotedUris.length > 0
    || signals.hashtags.length > 0
    || signals.mentionedDids.length > 0
    || signals.labelValues.length > 0;
}

function emptySignals(): SignalCollections {
  return {
    quotedUris: [],
    domains: [],
    mentionedDids: [],
    hashtags: [],
    labelValues: [],
  };
}

function isDriftRole(node: ConversationNode): boolean {
  const role = node.contributionSignal?.role ?? 'unknown';
  return role === 'repetition' || role === 'tangent' || role === 'unknown';
}

function isEvidenceLike(node: ConversationNode): boolean {
  return Boolean(
    node.contributionSignal?.evidencePresent
    || node.contributionRole === 'source_bringer'
    || node.contributionRole === 'rule_source',
  );
}

function isDisagreementLike(node: ConversationNode): boolean {
  return node.contributionSignal?.role === 'disagreement'
    || node.contributionRole === 'useful_counterpoint';
}

function breadthRoleBucket(node: ConversationNode): string {
  const role = node.contributionSignal?.role ?? 'unknown';
  switch (role) {
    case 'disagreement':
      return 'counterpoint';
    case 'clarification':
      return 'clarification';
    case 'evidence':
      return 'evidence';
    case 'new_information':
    case 'context_setter':
      return 'new_information';
    case 'question':
      return 'question';
    default:
      return 'response';
  }
}

function hasQuotedContext(node: ConversationNode): boolean {
  return node.embed?.kind === 'record' || node.embed?.kind === 'recordWithMedia';
}

function hasResolvedQuoteContext(node: ConversationNode): boolean {
  if (!hasQuotedContext(node)) return false;
  return Boolean(node.embed?.quotedText || node.embed?.quotedAuthorHandle || node.embed?.quotedExternal);
}

function isShortReactive(text: string): boolean {
  const normalized = text.trim();
  if (normalized.length === 0) return true;
  if (normalized.length <= 32) return true;
  return normalized.length <= 56 && tokenize(normalized).length <= 5;
}

function isPronounHeavy(text: string): boolean {
  return tokenize(text).length <= 8 && REFERENCE_PRONOUN_RE.test(text);
}

function isQuestionDominated(node: ConversationNode): boolean {
  const text = node.text.trim();
  const questionMarks = (text.match(/\?/g) ?? []).length;
  return questionMarks > 0
    && (node.contributionSignal?.role === 'question' || tokenize(text).length <= 6);
}

function feedbackScore(feedback: ConversationSession['interpretation']['scoresByUri'][string]['userFeedback']): number {
  switch (feedback) {
    case 'clarifying':
      return 0.82;
    case 'new_to_me':
      return 0.76;
    case 'aha':
      return 0.92;
    case 'provocative':
      return 0.18;
    default:
      return 0.5;
  }
}

function feedbackAlignment(
  feedback: ConversationSession['interpretation']['scoresByUri'][string]['userFeedback'],
  node: ConversationNode,
): number {
  switch (feedback) {
    case 'clarifying':
      return node.contributionSignal?.role === 'clarification' ? 1 : 0.4;
    case 'new_to_me':
    case 'aha':
      return node.contributionSignal?.addedInformation || node.contributionSignal?.evidencePresent
        ? 1
        : 0.45;
    case 'provocative':
      return (node.contributionSignal?.heatContribution ?? 0) > 0.35 ? 1 : 0.35;
    default:
      return 0.5;
  }
}

function average(values: number[], fallback = 0): number {
  if (values.length === 0) return fallback;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function ratio(numerator: number, denominator: number, fallback = 0): number {
  if (denominator <= 0) return fallback;
  return clamp01(numerator / denominator);
}

function normalizedEntropy(counts: number[]): number {
  const filtered = counts.filter((count) => count > 0);
  if (filtered.length <= 1) return filtered.length === 1 ? 0.35 : 0;

  const total = filtered.reduce((sum, count) => sum + count, 0);
  if (total <= 0) return 0;

  const entropy = filtered.reduce((sum, count) => {
    const probability = count / total;
    return sum - (probability * Math.log(probability));
  }, 0);

  return clamp01(entropy / Math.log(filtered.length));
}

function countBy<T>(
  values: T[],
  keyOf: (value: T) => string,
): Record<string, number> {
  return values.reduce<Record<string, number>>((acc, value) => {
    const key = keyOf(value);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function intersects(left: string[], right: string[]): boolean {
  if (left.length === 0 || right.length === 0) return false;
  const rightSet = new Set(right);
  return left.some((value) => rightSet.has(value));
}

function jaccardSimilarity(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let intersection = 0;

  for (const value of leftSet) {
    if (rightSet.has(value)) {
      intersection += 1;
    }
  }

  const union = new Set([...leftSet, ...rightSet]).size;
  return union === 0 ? 0 : intersection / union;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
