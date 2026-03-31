import type { SummaryMode } from '../../intelligence/llmContracts';
import type {
  ConversationSession,
  InterpolatorConfidence,
  MentalHealthCrisisCategory,
} from '../sessionTypes';
import { humanizeInterpretiveReason } from '../interpretive/interpretiveExplanation';
import { useInterpolatorSettingsStore } from '../../store/interpolatorSettingsStore';

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
  hasMentalHealthCrisis: boolean;
  mentalHealthCategory?: MentalHealthCrisisCategory;
}

type SessionReplyBehaviorCounts = {
  sourcing: number;
  clarification: number;
  disagreement: number;
  newInfo: number;
  comparison: number;
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
    const candidate = interpolator?.summaryText?.trim();
    if (candidate && !STALE_INTERPOLATOR_SUMMARY_RE.test(candidate)) {
      return candidate;
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
  const topic = buildRootLead(root?.text);
  const behaviorCounts = computeSessionReplyBehaviorCounts(visibleReplies);
  const behaviorSummary = describeSessionReplyBehavior(behaviorCounts);

  if (replyCount === 0) {
    return 'The post is visible, but there are no replies yet.';
  }

  if (summaryMode === 'descriptive_fallback') {
    return `${topic} ${behaviorSummary} ${replyCount >= 6
      ? 'Visible replies are still too split for a stronger read.'
      : 'There is not enough visible thread signal yet for a stronger read.'}`;
  }

  if (summaryMode === 'minimal_fallback') {
    return `${topic} ${behaviorSummary}`;
  }

  const concludingSentence = evidenceCount > 0
    ? disagreementCount > 0
      ? 'Some replies bring source support into the disagreement.'
      : 'Some replies bring source support into the thread.'
    : clarificationCount > 0 && disagreementCount > 0
      ? 'The thread is splitting between clarification and dispute.'
      : clarificationCount > 0
        ? 'The thread is starting to settle around clarification.'
        : disagreementCount > 0
          ? 'The thread is still split on how to read the claim.'
          : behaviorCounts.escalation > 0
            ? 'Source support remains thin so far.'
            : '';

  return `${topic} ${behaviorSummary}${concludingSentence ? ` ${concludingSentence}` : ''}`.trim();
}

function computeSessionReplyBehaviorCounts(
  replies: Array<ConversationSession['graph']['nodesByUri'][string]>,
): SessionReplyBehaviorCounts {
  const counts: SessionReplyBehaviorCounts = {
    sourcing: 0,
    clarification: 0,
    disagreement: 0,
    newInfo: 0,
    comparison: 0,
    escalation: 0,
    repetition: 0,
    question: 0,
    total: replies.length,
  };

  for (const reply of replies) {
    const role = reply.contributionSignal?.role ?? 'unknown';
    const text = reply.text.toLowerCase();

    if (
      role === 'evidence'
      || reply.contributionSignal?.evidencePresent
      || /\b(source|sourcing|link|memo|document|report|paper|article|citation|cited|evidence)\b/.test(text)
    ) {
      counts.sourcing += 1;
    }
    if (role === 'clarification' || /\b(clarif|explain|timeline|specifics)\b/.test(text)) {
      counts.clarification += 1;
    }
    if (role === 'disagreement' || /\b(disagree|doubt|push back|skeptic|contest)\b/.test(text)) {
      counts.disagreement += 1;
    }
    if (
      role === 'new_information'
      || role === 'context_setter'
      || /\b(new|another|additional|context)\b/.test(text)
    ) {
      counts.newInfo += 1;
    }
    if (/\b(compare|comparison|similar|earlier|prior|before|pattern)\b/.test(text)) {
      counts.comparison += 1;
    }
    if (role === 'escalation') {
      counts.escalation += 1;
    }
    if (role === 'repetition' || /\b(same point|again|repeating)\b/.test(text)) {
      counts.repetition += 1;
    }
    if (role === 'question' || /\?/.test(text) || /\b(ask|asks|asking|whether)\b/.test(text)) {
      counts.question += 1;
    }
  }

  return counts;
}

function joinBehaviorPhrases(phrases: string[]): string {
  if (phrases.length === 0) return 'stay brief and hard to characterize';
  if (phrases.length === 1) return phrases[0]!;
  if (phrases.length === 2) return `${phrases[0]!} and ${phrases[1]!}`;
  return `${phrases.slice(0, -1).join(', ')}, and ${phrases[phrases.length - 1]!}`;
}

function describeSessionReplyBehavior(counts: SessionReplyBehaviorCounts): string {
  if (counts.total === 0) {
    return 'There are no visible replies yet.';
  }

  const phrases: string[] = [];

  if (counts.sourcing > 0) phrases.push('ask for sourcing');
  if (counts.clarification > 0) phrases.push('add clarification');
  if (counts.disagreement > 0) phrases.push('push back on the claim');
  if (counts.comparison > 0) phrases.push('compare it to earlier incidents');
  if (counts.newInfo > 0) phrases.push('add context');

  if (phrases.length === 0 && counts.question > 0) phrases.push('press for specifics');
  if (phrases.length === 0 && counts.repetition > 0) phrases.push('repeat the same point');
  if (phrases.length === 0 && counts.escalation > 0) phrases.push('turn heated quickly');

  const subject = counts.total >= 8
    ? `Across ${counts.total} visible replies, the thread mostly`
    : counts.total === 1
      ? 'The visible reply mostly'
      : 'Visible replies mostly';

  return `${subject} ${joinBehaviorPhrases(phrases.slice(0, 3))}.`;
}

function ensureSentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
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
