import type { ConversationSession } from '../sessionTypes';
import { buildInterpolatorSurfaceProjection } from '../adapters/interpolatorAdapter';

export interface TimelineConversationHint {
  rootUri: string;
  postUri: string;
  isReply: boolean;
  parentHandle?: string;
  branchDepth: number;
  direction: string;
  sourceSupportPresent: boolean;
  factualSignalPresent: boolean;
  hasThreadContext: boolean;
  compactSummary?: string;
}

export function projectTimelineConversationHint(
  session: ConversationSession,
  postUri: string,
): TimelineConversationHint | null {
  const node = session.graph.nodesByUri[postUri];
  if (!node) return null;
  const interpolatorSurface = buildInterpolatorSurfaceProjection(session);

  return {
    rootUri: session.graph.rootUri,
    postUri,
    isReply: node.uri !== session.graph.rootUri,
    ...(node.parentAuthorHandle ? { parentHandle: node.parentAuthorHandle } : {}),
    branchDepth: node.branchDepth,
    direction: session.trajectory.direction,
    sourceSupportPresent: session.interpretation.interpolator?.sourceSupportPresent ?? false,
    factualSignalPresent: session.interpretation.interpolator?.factualSignalPresent ?? false,
    hasThreadContext: !!session.interpretation.interpolator,
    ...(interpolatorSurface.summaryText
      ? {
          compactSummary: interpolatorSurface.writerSummary ?? interpolatorSurface.summaryText,
        }
      : {}),
  };
}
