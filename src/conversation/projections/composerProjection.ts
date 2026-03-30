import type { AtUri } from '../../intelligence/interpolatorTypes';
import type { ConversationSession } from '../sessionTypes';

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
  };
  summaries?: {
    directParentSummary?: string;
    threadSummary?: string;
    replyContextSummary?: string;
    conversationHeatSummary?: string;
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

  const threadSummary =
    session.interpretation.writerResult?.collapsedSummary
    ?? session.interpretation.interpolator?.summaryText;

  const directParentSummary = parent
    ? summarizeParentForComposer(parent.text)
    : undefined;

  const replyContextSummary = buildReplyContextSummary(
    siblingTexts,
    selectedCommentTexts,
  );

  return {
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
    },
    summaries: {
      ...(directParentSummary ? { directParentSummary } : {}),
      ...(threadSummary ? { threadSummary } : {}),
      ...(replyContextSummary ? { replyContextSummary } : {}),
      conversationHeatSummary:
        `Tone: ${session.interpretation.threadState?.dominantTone ?? 'forming'}, phase: ${session.interpretation.threadState?.conversationPhase ?? 'active'}, heat: ${Math.round((session.trajectory.heatLevel ?? 0) * 100)}%`,
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
