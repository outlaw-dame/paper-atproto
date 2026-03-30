import type { SummaryMode } from '../../intelligence/llmContracts';
import type {
  ConversationSession,
  InterpolatorConfidence,
} from '../sessionTypes';
import { humanizeInterpretiveReason } from '../interpretive/interpretiveExplanation';

export interface InterpolatorProjectionExplanation {
  interpretiveMode: SummaryMode;
  primarySupports: string[];
  primaryLimits: string[];
}

export interface InterpolatorSurfaceProjection {
  shouldRender: boolean;
  summaryText: string;
  writerSummary?: string;
  summaryMode?: SummaryMode | null;
  confidence: InterpolatorConfidence | null;
  explanation?: InterpolatorProjectionExplanation;
}

export function buildInterpolatorSurfaceProjection(
  session: ConversationSession,
): InterpolatorSurfaceProjection {
  const writerSummary = session.interpretation.writerResult?.collapsedSummary;
  const summaryMode = session.interpretation.summaryMode;
  const localSummary = buildSafeInterpolatorSummary(session, summaryMode);
  const interpolator = session.interpretation.interpolator;
  const replyCount = Math.max(0, Object.keys(session.graph.nodesByUri).length - 1);
  const surfaceConfidence = session.interpretation.confidence?.surfaceConfidence ?? 0;
  const hasObservableSignal = surfaceConfidence >= 0.52
    || replyCount >= 3
    || (interpolator?.sourceSupportPresent ?? false)
    || (interpolator?.factualSignalPresent ?? false)
    || Boolean(writerSummary);

  return {
    shouldRender: Boolean(interpolator) && (
      summaryMode !== 'minimal_fallback'
      || hasObservableSignal
    ),
    summaryText: localSummary,
    ...(writerSummary ? { writerSummary } : {}),
    ...(summaryMode !== null ? { summaryMode } : {}),
    confidence: session.interpretation.confidence,
    ...(session.interpretation.interpretiveExplanation
      ? {
          explanation: {
            interpretiveMode: session.interpretation.interpretiveExplanation.mode,
            primarySupports: session.interpretation.interpretiveExplanation.boostedBy
              .slice(0, 3)
              .map(humanizeInterpretiveReason),
            primaryLimits: session.interpretation.interpretiveExplanation.degradedBy
              .slice(0, 3)
              .map(humanizeInterpretiveReason),
          },
        }
      : {}),
  };
}

function buildSafeInterpolatorSummary(
  session: ConversationSession,
  summaryMode: SummaryMode | null,
): string {
  const interpolator = session.interpretation.interpolator;
  const root = session.graph.nodesByUri[session.graph.rootUri];

  if (summaryMode === 'normal' || summaryMode == null) {
    if (interpolator?.summaryText?.trim()) {
      return interpolator.summaryText.trim();
    }
  }

  const visibleReplies = Object.values(session.graph.nodesByUri)
    .filter((node) => node.uri !== session.graph.rootUri && !node.hiddenByModeration);
  const replyCount = visibleReplies.length;
  const clarificationCount = visibleReplies.filter(
    (node) => node.contributionSignal?.role === 'clarification',
  ).length;
  const disagreementCount = visibleReplies.filter(
    (node) => node.contributionSignal?.role === 'disagreement',
  ).length;
  const evidenceCount = visibleReplies.filter(
    (node) => node.contributionSignal?.evidencePresent,
  ).length;
  const topic = root?.text ? extractTopic(root.text) : 'the original post';

  if (replyCount === 0) {
    return 'This discussion is just beginning.';
  }

  if (summaryMode === 'descriptive_fallback') {
    const descriptors: string[] = [];
    if (disagreementCount > 0) {
      descriptors.push(`${disagreementCount} disagreement${disagreementCount > 1 ? 's' : ''}`);
    }
    if (clarificationCount > 0) {
      descriptors.push(`${clarificationCount} clarification${clarificationCount > 1 ? 's' : ''}`);
    }
    if (evidenceCount > 0) {
      descriptors.push(`${evidenceCount} source-backed repl${evidenceCount > 1 ? 'ies' : 'y'}`);
    }

    const activitySummary = descriptors.length > 0
      ? descriptors.join(', ')
      : `${replyCount} visible repl${replyCount > 1 ? 'ies' : 'y'}`;

    return `The thread is focused on reactions to "${topic}" and includes ${activitySummary}.`;
  }

  return `This thread includes ${replyCount} visible repl${replyCount > 1 ? 'ies' : 'y'}, mostly ${dominantActivityLabel(visibleReplies)}, with ${evidenceCount > 0 ? `${evidenceCount} source-backed contribution${evidenceCount > 1 ? 's' : ''}` : 'limited source support'}.`;
}

function dominantActivityLabel(
  replies: Array<ConversationSession['graph']['nodesByUri'][string]>,
): string {
  const counts = replies.reduce<Record<string, number>>((acc, reply) => {
    const role = reply.contributionSignal?.role ?? 'response';
    acc[role] = (acc[role] ?? 0) + 1;
    return acc;
  }, {});

  const dominantRole = Object.entries(counts)
    .sort((left, right) => right[1] - left[1])[0]?.[0];

  switch (dominantRole) {
    case 'clarification':
      return 'clarification';
    case 'disagreement':
      return 'disagreement';
    case 'evidence':
      return 'evidence-sharing';
    case 'repetition':
      return 'repetition';
    case 'escalation':
      return 'heated replies';
    default:
      return 'visible reply activity';
  }
}

function extractTopic(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return 'the original post';

  const sentenceEnd = normalized.search(/[.!?\n]/);
  const base = sentenceEnd > 20 && sentenceEnd < 120
    ? normalized.slice(0, sentenceEnd)
    : normalized.slice(0, 96);
  const trimmed = base.length < normalized.length ? `${base.trim()}...` : base.trim();

  return trimmed.length > 0 ? trimmed : 'the original post';
}
