import type { AtUri } from '../../intelligence/interpolatorTypes';
import type { MockPost } from '../../data/mockData';
import type { ConversationSession } from '../sessionTypes';
import { buildInterpolatorSurfaceProjection } from '../adapters/interpolatorAdapter';
import {
  humanizeInterpretiveReason,
} from '../interpretive/interpretiveExplanation';
import {
  deriveDisagreementType,
} from '../interpretive/interpretiveScoring';
import type { DeepInterpolatorResult } from '../../intelligence/premiumContracts';

export type ComposerContext = {
  mode: 'post' | 'reply' | 'hosted_thread';
  draftText: string;
  directParent?: {
    uri: string;
    text: string;
    authorHandle?: string;
  };
  threadContext?: {
    rootText?: string;
    ancestorTexts: string[];
    branchTexts: string[];
  };
  replyContext?: {
    siblingReplyTexts: string[];
    selectedCommentTexts: string[];
    totalReplyCount?: number;
    totalCommentCount?: number;
    totalThreadCount?: number;
  };
  hostedThread?: {
    prompt: string;
    description?: string;
    source?: string;
    topics: string[];
    audience?: string;
  };
  summaries?: {
    directParentSummary?: string;
    threadSummary?: string;
    replyContextSummary?: string;
    conversationHeatSummary?: string;
    epistemicSummary?: {
      disagreementType: 'factual' | 'interpretive' | 'value-based';
      missingContextHints: string[];
      confidenceWarnings: string[];
    };
    premiumContext?: {
      deepSummary?: string;
      groundedContext?: string;
      perspectiveGaps: string[];
      followUpQuestions: string[];
      confidence: number;
    };
  };
  threadState?: {
    dominantTone?: string;
    conversationPhase?: string;
    heatLevel?: number;
    repetitionLevel?: number;
    sourceSupportPresent?: boolean;
    factualSignalPresent?: boolean;
  };
};

const MAX_DRAFT_TEXT_CHARS = 1_200;
const MAX_PARENT_TEXT_CHARS = 320;
const MAX_THREAD_TEXT_CHARS = 260;
const MAX_COMMENT_TEXT_CHARS = 220;
const MAX_HOSTED_PROMPT_CHARS = 320;
const MAX_HOSTED_DESCRIPTION_CHARS = 320;
const MAX_HOSTED_SOURCE_CHARS = 200;
const MAX_HOSTED_TOPIC_CHARS = 48;

function sanitizeComposerText(value: string, maxChars: number): string {
  const sanitized = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (sanitized.length <= maxChars) {
    return sanitized;
  }

  return `${sanitized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function uniqComposerTexts(
  values: Array<string | undefined | null>,
  limit: number,
  maxChars: number,
): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === 'string' ? sanitizeComposerText(value, maxChars) : ''))
        .filter((value): value is string => value.length > 0),
    ),
  ).slice(0, Math.max(0, limit));
}

function sanitizeComposerProjectionContext(context: ComposerContext): ComposerContext {
  return {
    ...context,
    draftText: sanitizeComposerText(context.draftText, MAX_DRAFT_TEXT_CHARS),
    ...(context.directParent
      ? {
          directParent: {
            ...context.directParent,
            text: sanitizeComposerText(context.directParent.text, MAX_PARENT_TEXT_CHARS),
            ...(context.directParent.authorHandle
              ? { authorHandle: sanitizeComposerText(context.directParent.authorHandle, 64) }
              : {}),
          },
        }
      : {}),
    ...(context.threadContext
      ? {
          threadContext: {
            ...(context.threadContext.rootText
              ? { rootText: sanitizeComposerText(context.threadContext.rootText, MAX_THREAD_TEXT_CHARS) }
              : {}),
            ancestorTexts: uniqComposerTexts(context.threadContext.ancestorTexts, 5, MAX_THREAD_TEXT_CHARS),
            branchTexts: uniqComposerTexts(context.threadContext.branchTexts, 8, MAX_THREAD_TEXT_CHARS),
          },
        }
      : {}),
    ...(context.replyContext
      ? {
          replyContext: {
            ...context.replyContext,
            siblingReplyTexts: uniqComposerTexts(context.replyContext.siblingReplyTexts, 16, MAX_COMMENT_TEXT_CHARS),
            selectedCommentTexts: uniqComposerTexts(context.replyContext.selectedCommentTexts, 16, MAX_COMMENT_TEXT_CHARS),
          },
        }
      : {}),
    ...(context.hostedThread
      ? {
          hostedThread: {
            prompt: sanitizeComposerText(context.hostedThread.prompt, MAX_HOSTED_PROMPT_CHARS),
            ...(context.hostedThread.description
              ? { description: sanitizeComposerText(context.hostedThread.description, MAX_HOSTED_DESCRIPTION_CHARS) }
              : {}),
            ...(context.hostedThread.source
              ? { source: sanitizeComposerText(context.hostedThread.source, MAX_HOSTED_SOURCE_CHARS) }
              : {}),
            topics: uniqComposerTexts(context.hostedThread.topics, 12, MAX_HOSTED_TOPIC_CHARS),
            ...(context.hostedThread.audience
              ? { audience: sanitizeComposerText(context.hostedThread.audience, 48) }
              : {}),
          },
        }
      : {}),
  };
}

export function projectComposeSheetComposerContext(params: {
  draftText: string;
  replyTarget?: MockPost | null;
  projectedContext?: ComposerContext | null;
}): ComposerContext {
  const { draftText, replyTarget, projectedContext } = params;

  if (projectedContext) {
    const merged: ComposerContext = {
      ...projectedContext,
      draftText,
      ...(replyTarget && !projectedContext.directParent
        ? {
            directParent: {
              uri: replyTarget.id,
              text: replyTarget.content,
              authorHandle: replyTarget.author.handle,
            },
          }
        : {}),
      ...(replyTarget && !projectedContext.replyContext
        ? {
            replyContext: {
              siblingReplyTexts: [],
              selectedCommentTexts: uniqComposerTexts([replyTarget.replyTo?.content], 4, MAX_COMMENT_TEXT_CHARS),
              ...(typeof replyTarget.replyCount === 'number' ? { totalReplyCount: replyTarget.replyCount } : {}),
              ...(typeof replyTarget.replyCount === 'number' ? { totalCommentCount: replyTarget.replyCount } : {}),
              ...(typeof replyTarget.threadCount === 'number' ? { totalThreadCount: replyTarget.threadCount } : {}),
            },
          }
        : {}),
    };

    return sanitizeComposerProjectionContext(merged);
  }

  if (!replyTarget) {
    return sanitizeComposerProjectionContext({
      mode: 'post',
      draftText,
    });
  }

  return sanitizeComposerProjectionContext({
    mode: 'reply',
    draftText,
    directParent: {
      uri: replyTarget.id,
      text: replyTarget.content,
      authorHandle: replyTarget.author.handle,
    },
    threadContext: {
      ...(replyTarget.threadRoot?.content
        ? { rootText: replyTarget.threadRoot.content }
        : {}),
      ancestorTexts: [],
      branchTexts: uniqComposerTexts(
        [replyTarget.content, replyTarget.replyTo?.content],
        4,
        MAX_THREAD_TEXT_CHARS,
      ),
    },
    replyContext: {
      siblingReplyTexts: [],
      selectedCommentTexts: uniqComposerTexts(
        [replyTarget.replyTo?.content],
        4,
        MAX_COMMENT_TEXT_CHARS,
      ),
      ...(typeof replyTarget.replyCount === 'number' ? { totalReplyCount: replyTarget.replyCount } : {}),
      ...(typeof replyTarget.replyCount === 'number' ? { totalCommentCount: replyTarget.replyCount } : {}),
      ...(typeof replyTarget.threadCount === 'number' ? { totalThreadCount: replyTarget.threadCount } : {}),
    },
  });
}

export function projectComposerContext(params: {
  session: ConversationSession;
  replyToUri?: string;
  draftText: string;
}): ComposerContext {
  const { session, replyToUri, draftText } = params;
  const root = session.graph.nodesByUri[session.graph.rootUri];
  const parent = replyToUri ? session.graph.nodesByUri[replyToUri] : undefined;
  const parentUri = parent?.uri;

  const parentOfParentUri = parentUri ? session.graph.parentUriByChild[parentUri] : undefined;
  const siblingTexts = parentOfParentUri
    ? (session.graph.childUrisByParent[parentOfParentUri] ?? [])
      .filter((uri) => uri !== parentUri)
      .map((uri) => session.graph.nodesByUri[uri]?.text)
      .filter((text): text is string => typeof text === 'string' && text.length > 0)
    : [];

  const selectedCommentTexts = parent
    ? (parent.replies ?? []).map((reply) => reply.text).slice(0, 8)
    : [];

  const interpolatorSurface = buildInterpolatorSurfaceProjection(session);
  const threadSummary =
    interpolatorSurface.writerSummary
    ?? interpolatorSurface.summaryText;
  const interpretiveExplanation = session.interpretation.interpretiveExplanation;

  const directParentSummary = parent
    ? summarizeParentForComposer(parent.text)
    : undefined;

  const replyContextSummary = buildReplyContextSummary(
    siblingTexts,
    selectedCommentTexts,
  );

  return sanitizeComposerProjectionContext({
    mode: replyToUri ? 'reply' : 'post',
    draftText,
    ...(parent
      ? {
          directParent: {
            uri: parent.uri,
            text: parent.text,
            ...(parent.authorHandle ? { authorHandle: parent.authorHandle } : {}),
          },
        }
      : {}),
    threadContext: {
      ...(root?.text ? { rootText: root.text } : {}),
      ancestorTexts: parent ? collectAncestorTexts(session, parent.uri) : [],
      branchTexts: parent ? collectBranchTexts(session, parent.uri) : [],
    },
    replyContext: {
      siblingReplyTexts: siblingTexts.slice(0, 8),
      selectedCommentTexts,
      ...(root ? { totalReplyCount: root.replyCount } : {}),
      totalCommentCount: Math.max(0, Object.keys(session.graph.nodesByUri).length - 1),
      totalThreadCount: Math.max(1, Object.keys(session.graph.nodesByUri).length),
    },
    summaries: {
      ...(directParentSummary ? { directParentSummary } : {}),
      ...(threadSummary ? { threadSummary } : {}),
      ...(replyContextSummary ? { replyContextSummary } : {}),
      conversationHeatSummary:
        `Tone: ${session.interpretation.threadState?.dominantTone ?? 'forming'}, phase: ${session.interpretation.threadState?.conversationPhase ?? 'active'}, heat: ${Math.round((session.trajectory.heatLevel ?? 0) * 100)}%`,
      ...(interpretiveExplanation
        ? {
            epistemicSummary: {
              disagreementType: deriveDisagreementType(interpretiveExplanation),
              missingContextHints: interpretiveExplanation.degradedBy
                .filter((reason) => {
                  return reason === 'missing_context'
                    || reason === 'coverage_gap'
                    || reason === 'narrow_perspective'
                    || reason === 'shallow_thread';
                })
                .slice(0, 3)
                .map(humanizeInterpretiveReason),
              confidenceWarnings: buildComposerWarnings(interpretiveExplanation),
            },
          }
        : {}),
      ...(session.interpretation.premium.deepInterpolator
        ? {
            premiumContext: projectPremiumComposerContext(
              session.interpretation.premium.deepInterpolator,
            ),
          }
        : {}),
    },
    threadState: {
      ...(session.interpretation.threadState?.dominantTone
        ? { dominantTone: session.interpretation.threadState.dominantTone }
        : {}),
      ...(session.interpretation.threadState?.conversationPhase
        ? { conversationPhase: session.interpretation.threadState.conversationPhase }
        : {}),
      heatLevel: session.trajectory.heatLevel,
      repetitionLevel: session.trajectory.repetitionLevel,
      sourceSupportPresent: session.interpretation.interpolator?.sourceSupportPresent ?? false,
      factualSignalPresent: session.interpretation.interpolator?.factualSignalPresent ?? false,
    },
  });
}

export function projectHostedThreadComposerContext(params: {
  draftText: string;
  prompt: string;
  description?: string;
  source?: string;
  topics?: string[];
  audience?: string;
}): ComposerContext {
  const prompt = params.prompt.trim();
  const description = params.description?.trim();
  const topics = Array.from(
    new Set(
      (params.topics ?? [])
        .map((topic) => topic.trim())
        .filter((topic) => topic.length > 0),
    ),
  ).slice(0, 12);

  return sanitizeComposerProjectionContext({
    mode: 'hosted_thread',
    draftText: params.draftText,
    hostedThread: {
      prompt: params.prompt,
      ...(params.description ? { description: params.description } : {}),
      ...(params.source ? { source: params.source } : {}),
      topics,
      ...(params.audience ? { audience: params.audience } : {}),
    },
    summaries: {
      ...(prompt ? { threadSummary: prompt } : {}),
      ...(description
        ? { replyContextSummary: description.length <= 180 ? description : `${description.slice(0, 177)}...` }
        : {}),
    },
  });
}

function projectPremiumComposerContext(
  result: DeepInterpolatorResult,
): NonNullable<NonNullable<ComposerContext['summaries']>['premiumContext']> {
  return {
    ...(result.summary ? { deepSummary: result.summary } : {}),
    ...(result.groundedContext ? { groundedContext: result.groundedContext } : {}),
    perspectiveGaps: result.perspectiveGaps.slice(0, 3),
    followUpQuestions: result.followUpQuestions.slice(0, 3),
    confidence: result.confidence,
  };
}

function collectAncestorTexts(session: ConversationSession, startUri: AtUri): string[] {
  const texts: string[] = [];
  let cursor = session.graph.parentUriByChild[startUri];

  while (cursor) {
    const node = session.graph.nodesByUri[cursor];
    if (!node) break;
    texts.unshift(node.text);
    cursor = session.graph.parentUriByChild[cursor];
  }

  return texts.slice(-5);
}

function collectBranchTexts(session: ConversationSession, startUri: AtUri): string[] {
  const node = session.graph.nodesByUri[startUri];
  if (!node) return [];

  const texts = [node.text, ...(node.replies ?? []).map((reply) => reply.text)];
  return texts.slice(0, 8);
}

function summarizeParentForComposer(text: string): string {
  const normalized = text.trim().replace(/\s+/g, ' ');
  return normalized.length <= 220 ? normalized : `${normalized.slice(0, 217)}...`;
}

function buildReplyContextSummary(
  siblingReplyTexts: string[],
  selectedCommentTexts: string[],
): string | undefined {
  const total = siblingReplyTexts.length + selectedCommentTexts.length;
  if (total === 0) return undefined;
  if (total <= 2) return 'Only light nearby reply activity.';
  if (total <= 6) return 'There is moderate nearby reply activity.';
  return 'There is active nearby reply traffic, so clarity and tone matter more.';
}

function buildComposerWarnings(
  explanation: NonNullable<ConversationSession['interpretation']['interpretiveExplanation']>,
): string[] {
  const warnings: string[] = [];

  if (explanation.mode !== 'normal') {
    warnings.push(
      explanation.mode === 'descriptive_fallback'
        ? 'Stay close to observable claims and avoid broad causal framing.'
        : 'Keep the reply grounded in visible facts because thread understanding is still limited.',
    );
  }

  warnings.push(
    ...explanation.degradedBy
      .filter((reason) => {
        return reason === 'limited_evidence'
          || reason === 'high_ambiguity'
          || reason === 'unresolved_contradiction'
          || reason === 'coverage_gap';
      })
      .slice(0, 2)
      .map(humanizeInterpretiveReason),
  );

  return warnings;
}
