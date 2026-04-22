import type { AnalyzeOptions } from '../../lib/sentiment';
import type { ComposerContext } from './types';

interface BuildReplyComposerContextInput {
  draftText: string;
  parentText?: string;
  parentUri?: string;
  parentAuthorHandle?: string;
  threadTexts?: string[];
  commentTexts?: string[];
  totalCommentCount?: number;
  parentReplyCount?: number;
  parentThreadCount?: number;
}

interface BuildHostedThreadComposerContextInput {
  prompt: string;
  description?: string;
  source?: string;
  topics?: string[];
  audience?: string;
}

function uniqTrimmed(values: Array<string | undefined | null>, limit: number): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value))
    )
  ).slice(0, limit);
}

function sanitizeContextSignal(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

function buildTargetText(context: ComposerContext): string | undefined {
  const authorHandle = context.directParent?.authorHandle?.trim();
  if (authorHandle) {
    return authorHandle.startsWith('@') ? authorHandle : `@${authorHandle}`;
  }

  const parentText = context.directParent?.text?.trim();
  if (!parentText) return undefined;

  const sentence = parentText.split(/[\n.!?]/)[0]?.trim() ?? '';
  if (!sentence) return undefined;

  return sentence.slice(0, 96);
}

function buildContextSignals(context: ComposerContext): string[] {
  const premiumContext = context.summaries?.premiumContext;
  const mediaContext = context.summaries?.mediaContext;
  const epistemicSummary = context.summaries?.epistemicSummary;
  const threadState = context.threadState;

  return uniqTrimmed(
    [
      premiumContext?.groundedContext
        ? `Deep context: ${sanitizeContextSignal(premiumContext.groundedContext, 140)}`
        : premiumContext?.deepSummary
          ? `Deep summary: ${sanitizeContextSignal(premiumContext.deepSummary, 140)}`
          : undefined,
      premiumContext?.perspectiveGaps[0]
        ? `Missing context: ${sanitizeContextSignal(premiumContext.perspectiveGaps[0], 120)}`
        : undefined,
      premiumContext?.followUpQuestions[0]
        ? `Open question: ${sanitizeContextSignal(premiumContext.followUpQuestions[0], 120)}`
        : undefined,
      mediaContext?.summary
        ? `Media context: ${sanitizeContextSignal(mediaContext.summary, 140)}${mediaContext.analysisStatus === 'degraded' ? ' (low-authority hint)' : ''}`
        : mediaContext?.primaryKind
          ? `Media context: key media appears to be a ${mediaContext.primaryKind}${mediaContext.analysisStatus === 'degraded' ? ' (low-authority hint)' : ''}`
          : undefined,
      mediaContext?.cautionFlags[0]
        ? `Media caution: ${sanitizeContextSignal(mediaContext.cautionFlags[0], 96)}`
        : undefined,
      epistemicSummary?.missingContextHints[0]
        ? `Context gap: ${sanitizeContextSignal(epistemicSummary.missingContextHints[0], 120)}`
        : undefined,
      threadState?.conversationPhase && threadState?.dominantTone
        ? `Thread state: ${threadState.conversationPhase} / ${threadState.dominantTone}`
        : threadState?.conversationPhase
          ? `Thread phase: ${threadState.conversationPhase}`
          : undefined,
    ],
    6,
  );
}

export function buildPostComposerContext(draftText: string): ComposerContext {
  return {
    mode: 'post',
    draftText,
  };
}

export function buildReplyComposerContext(input: BuildReplyComposerContextInput): ComposerContext {
  const threadTexts = uniqTrimmed(input.threadTexts ?? [], 8);
  const commentTexts = uniqTrimmed(input.commentTexts ?? [], 32);

  return {
    mode: 'reply',
    draftText: input.draftText,
    ...(input.parentText
      ? {
          directParent: {
            ...(input.parentUri ? { uri: input.parentUri } : {}),
            text: input.parentText,
            ...(input.parentAuthorHandle ? { authorHandle: input.parentAuthorHandle } : {}),
          },
        }
      : {}),
    threadContext: {
      ...(threadTexts[0] ? { rootText: threadTexts[0] } : {}),
      ancestorTexts: threadTexts.slice(1, 4),
      branchTexts: threadTexts.slice(4),
    },
    replyContext: {
      siblingReplyTexts: commentTexts.slice(0, 16),
      selectedCommentTexts: commentTexts.slice(16),
      ...(typeof input.parentReplyCount === 'number' ? { totalReplyCount: input.parentReplyCount } : {}),
      ...(typeof input.totalCommentCount === 'number' ? { totalCommentCount: input.totalCommentCount } : {}),
      ...(typeof input.parentThreadCount === 'number' ? { totalThreadCount: input.parentThreadCount } : {}),
    },
  };
}

export function buildHostedThreadComposerContext(
  input: BuildHostedThreadComposerContextInput,
): ComposerContext {
  const prompt = input.prompt.trim();
  const description = input.description?.trim();
  const topics = uniqTrimmed(input.topics ?? [], 12);

  return {
    mode: 'hosted_thread',
    draftText: [prompt, description].filter(Boolean).join('\n\n'),
    hostedThread: {
      prompt: input.prompt,
      ...(input.description ? { description: input.description } : {}),
      ...(input.source ? { source: input.source } : {}),
      topics,
      ...(input.audience ? { audience: input.audience } : {}),
    },
  };
}

export function toAnalyzeOptions(context: ComposerContext): AnalyzeOptions {
  const threadTexts = uniqTrimmed(
    [
      context.threadContext?.rootText,
      ...(context.threadContext?.ancestorTexts ?? []),
      ...(context.threadContext?.branchTexts ?? []),
    ],
    8,
  );

  const commentTexts = uniqTrimmed(
    [
      ...(context.replyContext?.siblingReplyTexts ?? []),
      ...(context.replyContext?.selectedCommentTexts ?? []),
    ],
    32,
  );
  const targetText = buildTargetText(context);
  const contextSignals = buildContextSignals(context);

  return {
    ...(context.directParent?.text ? { parentText: context.directParent.text } : {}),
    ...(targetText ? { targetText } : {}),
    ...(typeof context.replyContext?.totalReplyCount === 'number'
      ? { parentReplyCount: context.replyContext.totalReplyCount }
      : {}),
    ...(typeof context.replyContext?.totalThreadCount === 'number'
      ? { parentThreadCount: context.replyContext.totalThreadCount }
      : {}),
    threadTexts,
    commentTexts,
    ...(contextSignals.length > 0 ? { contextSignals } : {}),
    ...(typeof context.replyContext?.totalCommentCount === 'number'
      ? { totalCommentCount: context.replyContext.totalCommentCount }
      : {}),
  };
}
