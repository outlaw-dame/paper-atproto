import type { ComposerContext } from './types';

function hashComposerKey(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function normalizeKeyText(value: string | undefined, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

export function createComposerDraftId(surfaceId: string, context: ComposerContext): string {
  const identity = {
    surfaceId: normalizeKeyText(surfaceId, 64) ?? surfaceId,
    mode: context.mode,
    draftText: normalizeKeyText(context.draftText, 600) ?? '',
    directParentUri: normalizeKeyText(context.directParent?.uri, 240),
    directParentText: context.directParent?.uri
      ? undefined
      : normalizeKeyText(context.directParent?.text, 180),
    hostedThreadSource: normalizeKeyText(context.hostedThread?.source, 160),
  };

  return `${surfaceId}:${hashComposerKey(JSON.stringify(identity))}`;
}

export function createComposerContextFingerprint(context: ComposerContext): string {
  const fingerprint = {
    mode: context.mode,
    draftText: normalizeKeyText(context.draftText, 600) ?? '',
    directParent: context.directParent
      ? {
          uri: normalizeKeyText(context.directParent.uri, 240),
          text: normalizeKeyText(context.directParent.text, 220),
          authorHandle: normalizeKeyText(context.directParent.authorHandle, 80),
        }
      : undefined,
    threadContext: context.threadContext
      ? {
          rootText: normalizeKeyText(context.threadContext.rootText, 260),
          ancestorTexts: context.threadContext.ancestorTexts
            .map((value) => normalizeKeyText(value, 220))
            .filter((value): value is string => Boolean(value)),
          branchTexts: context.threadContext.branchTexts
            .map((value) => normalizeKeyText(value, 220))
            .filter((value): value is string => Boolean(value)),
        }
      : undefined,
    replyContext: context.replyContext
      ? {
          siblingReplyTexts: context.replyContext.siblingReplyTexts
            .map((value) => normalizeKeyText(value, 220))
            .filter((value): value is string => Boolean(value)),
          selectedCommentTexts: context.replyContext.selectedCommentTexts
            .map((value) => normalizeKeyText(value, 220))
            .filter((value): value is string => Boolean(value)),
          totalReplyCount: context.replyContext.totalReplyCount,
          totalCommentCount: context.replyContext.totalCommentCount,
          totalThreadCount: context.replyContext.totalThreadCount,
        }
      : undefined,
    hostedThread: context.hostedThread
      ? {
          prompt: normalizeKeyText(context.hostedThread.prompt, 320),
          description: normalizeKeyText(context.hostedThread.description, 320),
          source: normalizeKeyText(context.hostedThread.source, 200),
          topics: context.hostedThread.topics
            .map((value) => normalizeKeyText(value, 64))
            .filter((value): value is string => Boolean(value)),
          audience: normalizeKeyText(context.hostedThread.audience, 80),
        }
      : undefined,
    summaries: context.summaries
      ? {
          directParentSummary: normalizeKeyText(context.summaries.directParentSummary, 220),
          threadSummary: normalizeKeyText(context.summaries.threadSummary, 220),
          replyContextSummary: normalizeKeyText(context.summaries.replyContextSummary, 220),
          conversationHeatSummary: normalizeKeyText(context.summaries.conversationHeatSummary, 180),
          epistemicSummary: context.summaries.epistemicSummary
            ? {
                disagreementType: context.summaries.epistemicSummary.disagreementType,
                missingContextHints: context.summaries.epistemicSummary.missingContextHints
                  .map((value) => normalizeKeyText(value, 120))
                  .filter((value): value is string => Boolean(value)),
                confidenceWarnings: context.summaries.epistemicSummary.confidenceWarnings
                  .map((value) => normalizeKeyText(value, 120))
                  .filter((value): value is string => Boolean(value)),
              }
            : undefined,
          premiumContext: context.summaries.premiumContext
            ? {
                deepSummary: normalizeKeyText(context.summaries.premiumContext.deepSummary, 220),
                groundedContext: normalizeKeyText(context.summaries.premiumContext.groundedContext, 200),
                perspectiveGaps: context.summaries.premiumContext.perspectiveGaps
                  .map((value) => normalizeKeyText(value, 120))
                  .filter((value): value is string => Boolean(value)),
                followUpQuestions: context.summaries.premiumContext.followUpQuestions
                  .map((value) => normalizeKeyText(value, 120))
                  .filter((value): value is string => Boolean(value)),
                confidence: context.summaries.premiumContext.confidence,
              }
            : undefined,
          mediaContext: context.summaries.mediaContext
            ? {
                summary: normalizeKeyText(context.summaries.mediaContext.summary, 220),
                primaryKind: context.summaries.mediaContext.primaryKind,
                cautionFlags: context.summaries.mediaContext.cautionFlags
                  .map((value) => normalizeKeyText(value, 80))
                  .filter((value): value is string => Boolean(value)),
                confidence: context.summaries.mediaContext.confidence,
                analysisStatus: context.summaries.mediaContext.analysisStatus,
                moderationStatus: context.summaries.mediaContext.moderationStatus,
              }
            : undefined,
        }
      : undefined,
    threadState: context.threadState
      ? {
          dominantTone: context.threadState.dominantTone,
          conversationPhase: context.threadState.conversationPhase,
          heatLevel: context.threadState.heatLevel,
          repetitionLevel: context.threadState.repetitionLevel,
          sourceSupportPresent: context.threadState.sourceSupportPresent,
          factualSignalPresent: context.threadState.factualSignalPresent,
        }
      : undefined,
  };

  return hashComposerKey(JSON.stringify(fingerprint));
}
