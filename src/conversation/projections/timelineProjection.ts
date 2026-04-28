import type { MockPost } from '../../data/mockData';
import type { ConversationSession } from '../sessionTypes';
import { buildInterpolatorSurfaceProjection } from '../adapters/interpolatorAdapter';
import {
  resolveCurrentContinuitySnapshot,
} from '../continuitySnapshots';

export interface TimelineConversationHint {
  rootUri: string;
  postUri: string;
  isReply: boolean;
  parentHandle?: string;
  branchDepth: number;
  direction: string;
  dominantTone?: string;
  conversationPhase?: string;
  sourceSupportPresent: boolean;
  factualSignalPresent: boolean;
  hasThreadContext: boolean;
  compactSummary?: string;
  continuityLabel?: string;
  whatChanged: string[];
}

function truncateHintText(value: string, maxLength = 96): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

export function projectTimelineConversationHint(
  session: ConversationSession,
  postUri: string,
): TimelineConversationHint | null {
  const node = session.graph.nodesByUri[postUri];
  if (!node) return null;

  const interpolatorSurface = buildInterpolatorSurfaceProjection(session);
  const continuity = resolveCurrentContinuitySnapshot(session);

  return {
    rootUri: session.graph.rootUri,
    postUri,
    isReply: node.uri !== session.graph.rootUri,
    ...(node.parentAuthorHandle ? { parentHandle: node.parentAuthorHandle } : {}),
    branchDepth: node.branchDepth,
    direction: continuity?.direction ?? session.trajectory.direction,
    ...(continuity?.dominantTone ? { dominantTone: continuity.dominantTone } : {}),
    ...(continuity?.conversationPhase ? { conversationPhase: continuity.conversationPhase } : {}),
    sourceSupportPresent: continuity?.sourceSupportPresent
      ?? session.interpretation.interpolator?.sourceSupportPresent
      ?? false,
    factualSignalPresent: continuity?.factualSignalPresent
      ?? session.interpretation.interpolator?.factualSignalPresent
      ?? false,
    hasThreadContext: !!session.interpretation.interpolator,
    ...(interpolatorSurface.summaryText
      ? {
          compactSummary: truncateHintText(
            interpolatorSurface.writerSummary ?? interpolatorSurface.summaryText,
          ),
        }
      : {}),
    ...(continuity?.continuityLabel ? { continuityLabel: continuity.continuityLabel } : {}),
    whatChanged: continuity?.whatChanged.slice(0, 2) ?? [],
  };
}

export function projectTimelineConversationHints(params: {
  posts: MockPost[];
  sessionsByRootUri: Record<string, ConversationSession | null | undefined>;
}): Record<string, TimelineConversationHint> {
  const hints: Record<string, TimelineConversationHint> = {};

  for (const post of params.posts) {
    const rootUri = post.threadRoot?.id ?? post.id;
    if (!rootUri) continue;
    const session = params.sessionsByRootUri[rootUri];
    if (!session) continue;
    const hint = projectTimelineConversationHint(session, post.id);
    if (hint) hints[post.id] = hint;
  }

  return hints;
}
