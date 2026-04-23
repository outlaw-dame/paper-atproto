import type { SummaryMode } from '../../intelligence/llmContracts';
import type { ConversationDeltaDecision } from '../../intelligence/conversationDelta';
import type {
  ConversationSession,
  InterpolatorConfidence,
  InterpretiveFactorId,
  MentalHealthCrisisCategory,
} from '../sessionTypes';
import {
  humanizeInterpretiveFactorId,
  humanizeInterpretiveReason,
} from '../interpretive/interpretiveExplanation';
import { useInterpolatorSettingsStore } from '../../store/interpolatorSettingsStore';
import { resolveConversationDeltaDecision } from '../deltaDecision';
import { recordInterpolatorSummaryProjectionFallback } from '../../perf/interpolatorTelemetry';

export interface InterpolatorProjectionExplanation {
  interpretiveMode: SummaryMode;
  primarySupports: string[];
  primaryLimits: string[];
  primaryReasons: InterpretiveFactorId[];
  primaryReasonLabels: string[];
}

export interface InterpolatorSurfaceProjection {
  shouldRender: boolean;
  summaryText: string;
  writerSummary?: string;
  summaryMode?: SummaryMode | null;
  confidence: InterpolatorConfidence | null;
  explanation?: InterpolatorProjectionExplanation;
  hasMentalHealthCrisis: boolean;
  mentalHealthCategory?: MentalHealthCrisisCategory;
}

type SessionReplyBehaviorCounts = {
  sourcing: number;
  clarification: number;
  disagreement: number;
  newInfo: number;
  escalation: number;
  repetition: number;
  question: number;
  total: number;
};

const STALE_INTERPOLATOR_SUMMARY_RE =
  /^(The thread (?:centres|centers) on|The discussion focuses on|The thread is focused on)\b/i;

export function buildInterpolatorSurfaceProjection(
  session: ConversationSession,
): InterpolatorSurfaceProjection {
  const interpolatorEnabled = useInterpolatorSettingsStore.getState().enabled;
  const showPrimaryReasons = useInterpolatorSettingsStore.getState().showPrimaryReasons;
  const mhSignal = session.interpretation.mentalHealthSignal;
  const hasMentalHealthCrisis = mhSignal?.detected ?? false;
  const mentalHealthCategory = mhSignal?.category;

  if (!interpolatorEnabled) {
    return {
      shouldRender: false,
      summaryText: '',
      confidence: session.interpretation.confidence,
      hasMentalHealthCrisis,
      ...(mentalHealthCategory ? { mentalHealthCategory } : {}),
    };
  }

  const writerSummary = session.interpretation.writerResult?.collapsedSummary;
  const deltaDecision = resolveConversationDeltaDecision(session);
  const summaryMode = deltaDecision?.summaryMode ?? session.interpretation.summaryMode;
  const { summaryText: localSummary, usedFallback } = buildAuthoritativeInterpolatorSummary(
    session,
    deltaDecision,
    summaryMode,
  );
  if (usedFallback) {
    const fallbackKey = `${session.id}:${deltaDecision?.computedAt ?? session.interpretation.lastComputedAt ?? session.meta.lastHydratedAt ?? 'unknown'}`;
    recordInterpolatorSummaryProjectionFallback(fallbackKey);
  }
  const interpolator = session.interpretation.interpolator;
  const replyCount = Math.max(0, Object.keys(session.graph.nodesByUri).length - 1);
  const confidence = deltaDecision?.confidence ?? session.interpretation.confidence;
  const surfaceConfidence = confidence?.surfaceConfidence ?? 0;
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
    confidence,
    hasMentalHealthCrisis,
    ...(mentalHealthCategory ? { mentalHealthCategory } : {}),
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
            primaryReasons: showPrimaryReasons
              ? session.interpretation.interpretiveExplanation.v2?.primaryReasons.slice(0, 3) ?? []
              : [],
            primaryReasonLabels: showPrimaryReasons
              ? session.interpretation.interpretiveExplanation.v2?.primaryReasons
                .slice(0, 3)
                .map(humanizeInterpretiveFactorId) ?? []
              : [],
          },
        }
      : {}),
  };
}

function buildAuthoritativeInterpolatorSummary(
  session: ConversationSession,
  deltaDecision: ConversationDeltaDecision | null,
  summaryMode: SummaryMode | null,
): {
  summaryText: string;
  usedFallback: boolean;
} {
  const interpolator = session.interpretation.interpolator;
  const root = session.graph.nodesByUri[session.graph.rootUri];

  if (summaryMode === 'normal' || summaryMode == null) {
    const candidate = interpolator?.summaryText?.trim();
    if (candidate && !STALE_INTERPOLATOR_SUMMARY_RE.test(candidate)) {
      return {
        summaryText: candidate,
        usedFallback: false,
      };
    }
  }

  const visibleReplies = Object.values(session.graph.nodesByUri)
    .filter((node) => node.uri !== session.graph.rootUri && !node.hiddenByModeration);
  const replyCount = visibleReplies.length;
  const topic = buildRootLead(root?.text);
  const behaviorCounts = computeStructuredReplyBehaviorCounts(visibleReplies);

  if (replyCount === 0) {
    return {
      summaryText: 'The post is visible, but there are no replies yet.',
      usedFallback: true,
    };
  }

  if (summaryMode === 'descriptive_fallback') {
    const activity = buildDeltaActivitySentence(session, deltaDecision, behaviorCounts);
    return {
      summaryText: `${topic} ${activity} ${buildFallbackGuardrailSentence(replyCount, deltaDecision)}`.trim(),
      usedFallback: true,
    };
  }

  if (summaryMode === 'minimal_fallback') {
    return {
      summaryText: `${topic} ${buildMinimalActivitySentence(deltaDecision, behaviorCounts)}`.trim(),
      usedFallback: true,
    };
  }

  return {
    summaryText: `${topic} ${buildDeltaActivitySentence(session, deltaDecision, behaviorCounts)}`.trim(),
    usedFallback: true,
  };
}

function computeStructuredReplyBehaviorCounts(
  replies: Array<ConversationSession['graph']['nodesByUri'][string]>,
): SessionReplyBehaviorCounts {
  const counts: SessionReplyBehaviorCounts = {
    sourcing: 0,
    clarification: 0,
    disagreement: 0,
    newInfo: 0,
    escalation: 0,
    repetition: 0,
    question: 0,
    total: replies.length,
  };

  for (const reply of replies) {
    const role = reply.contributionSignal?.role ?? 'unknown';
    const text = reply.text.toLowerCase();
    if (role === 'evidence' || reply.contributionSignal?.evidencePresent) {
      counts.sourcing += 1;
    }
    if (role === 'clarification') {
      counts.clarification += 1;
    }
    if (role === 'disagreement') {
      counts.disagreement += 1;
    }
    if (role === 'new_information' || role === 'context_setter') {
      counts.newInfo += 1;
    }
    if (role === 'escalation') {
      counts.escalation += 1;
    }
    if (role === 'repetition') {
      counts.repetition += 1;
    }
    if (role === 'question') {
      counts.question += 1;
    }

    if (role === 'unknown') {
      if (/\?/.test(text) || /\b(what|why|how|which|whether)\b/.test(text)) {
        counts.question += 1;
      }
      if (/\b(source|link|citation|report|memo|document)\b/.test(text)) {
        counts.sourcing += 1;
      }
    }
  }

  return counts;
}

function formatHandleList(handles: string[]): string {
  if (handles.length === 0) return '';
  if (handles.length === 1) return handles[0]!;
  return `${handles[0]!} and ${handles[1]!}`;
}

function getShapingContributorHandles(session: ConversationSession): string[] {
  return session.contributors.topContributorDids
    .slice(0, 2)
    .map((did) => session.contributors.contributors.find((contributor) => contributor.did === did)?.handle)
    .filter((handle): handle is string => typeof handle === 'string' && handle.trim().length > 0)
    .map((handle) => handle.startsWith('@') ? handle : `@${handle}`);
}

function buildContributorLead(session: ConversationSession): string {
  const handles = getShapingContributorHandles(session);
  if (handles.length === 0) return 'Replies';
  return `Replies from ${formatHandleList(handles)}`;
}

function buildDeltaActivitySentence(
  session: ConversationSession,
  deltaDecision: ConversationDeltaDecision | null,
  counts: SessionReplyBehaviorCounts,
): string {
  const interpolator = session.interpretation.interpolator;
  const contributorLead = buildContributorLead(session);
  const reasons = deltaDecision?.changeReasons ?? [];

  if (reasons.includes('source_backed_clarification')) {
    return `${contributorLead} add source-backed clarification.`;
  }
  if (reasons.includes('thread_direction_reversed')) {
    return `${contributorLead} are pushing the thread toward a different read.`;
  }
  if (reasons.includes('new_angle_introduced') || reasons.includes('new_stance_appeared')) {
    return `${contributorLead} introduce a distinct new angle.`;
  }
  if (reasons.includes('major_contributor_entered')) {
    return `${contributorLead} are shaping the thread more than before.`;
  }
  if (reasons.includes('factual_highlight_added')) {
    return `${contributorLead} add a concrete factual point.`;
  }
  if (reasons.includes('central_entity_changed')) {
    return 'The thread focus is shifting toward a different actor or topic.';
  }
  if (reasons.includes('heat_shift')) {
    return 'The tone is becoming more heated.';
  }

  const firstClarification = normalizeSignalExcerpt(interpolator?.clarificationsAdded[0]);
  if (firstClarification) {
    return `Replies add clarification around ${firstClarification}.`;
  }
  const firstAngle = normalizeSignalExcerpt(interpolator?.newAnglesAdded[0]);
  if (firstAngle) {
    return `Replies add a new angle around ${firstAngle}.`;
  }

  if ((interpolator?.sourceSupportPresent ?? false) || counts.sourcing > 0) {
    return `${contributorLead} are bringing sourcing into the thread.`;
  }
  if (counts.clarification > 0 && counts.disagreement > 0) {
    return `${contributorLead} split between clarification and pushback.`;
  }
  if (counts.clarification > 0) {
    return `${contributorLead} are adding clarification.`;
  }
  if (counts.disagreement > 0) {
    return `${contributorLead} are pushing back on the claim.`;
  }
  if (counts.newInfo > 0 || (interpolator?.newAnglesAdded.length ?? 0) > 0) {
    return `${contributorLead} are adding context.`;
  }
  if (counts.question > 0) {
    return `${contributorLead} are pressing for specifics.`;
  }
  if (counts.repetition > 0 || (interpolator?.repetitionLevel ?? 0) >= 0.35) {
    return 'Replies mostly repeat the same point.';
  }
  if (counts.escalation > 0 || (interpolator?.heatLevel ?? 0) >= 0.45) {
    return 'Replies are raising the temperature without adding much signal.';
  }

  if (counts.total === 1) {
    return 'There is one visible reply so far.';
  }
  return `There are ${counts.total} visible replies so far.`;
}

function buildFallbackGuardrailSentence(
  replyCount: number,
  deltaDecision: ConversationDeltaDecision | null,
): string {
  const reasons = deltaDecision?.changeReasons ?? [];
  if (reasons.includes('source_backed_clarification') || reasons.includes('factual_highlight_added')) {
    return 'The thread is still early enough that the safest read stays descriptive.';
  }
  return replyCount >= 6
    ? 'The visible thread is still too split for a stronger interpretive read.'
    : 'There is not enough grounded thread signal yet for a stronger interpretive read.';
}

function buildMinimalActivitySentence(
  deltaDecision: ConversationDeltaDecision | null,
  counts: SessionReplyBehaviorCounts,
): string {
  const reasons = deltaDecision?.changeReasons ?? [];
  if (reasons.includes('source_backed_clarification')) {
    return 'A visible reply adds source-backed clarification.';
  }
  if (reasons.includes('thread_direction_reversed')) {
    return 'Visible replies are pushing the thread toward a different read.';
  }
  if (reasons.includes('new_angle_introduced') || reasons.includes('new_stance_appeared')) {
    return 'Visible replies introduce a new angle.';
  }
  if (counts.question > 0) {
    return counts.total <= 2
      ? 'Visible replies mostly press for specifics.'
      : 'Visible replies are pressing for specifics.';
  }
  if (counts.disagreement > 0) {
    return 'Visible replies mainly push back on the claim.';
  }
  if (counts.clarification > 0) {
    return 'Visible replies are adding clarification.';
  }
  if (counts.newInfo > 0) {
    return 'Visible replies are adding context.';
  }
  if (counts.total === 1) {
    return 'There is one visible reply so far.';
  }
  return `There are ${counts.total} visible replies so far.`;
}

function ensureSentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function normalizeSignalExcerpt(value?: string): string {
  if (!value) return '';
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.!?…]+$/g, '')
    .slice(0, 120);
}

function buildRootLead(text?: string): string {
  if (!text) return 'The post is visible.';
  return ensureSentence(extractTopic(text));
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
