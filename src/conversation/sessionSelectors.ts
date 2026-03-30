import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useConversationSessionStore } from './sessionStore.js';
import {
  defaultAnchorLinearPolicy,
} from './sessionPolicies.js';
import { usePostFilterResults } from '../lib/contentFilters/usePostFilterResults.js';
import type { PostFilterMatch } from '../lib/contentFilters/types.js';
import type { MockPost } from '../data/mockData.js';
import { projectThreadView, type ThreadFilter } from './projections/threadProjection.js';
import { projectComposerContext } from './projections/composerProjection.js';
import type { ComposerContext } from './projections/composerProjection.js';

export function useConversationSession(sessionId: string) {
  return useConversationSessionStore((state) => state.byId[sessionId] ?? null);
}

export function useThreadProjection(
  sessionId: string,
  activeFilter: ThreadFilter = 'Top',
) {
  const session = useConversationSession(sessionId);

  return useMemo(() => {
    if (!session) return null;
    return projectThreadView(session, defaultAnchorLinearPolicy, activeFilter);
  }, [session, activeFilter]);
}

export function useConversationMeta(sessionId: string) {
  return useConversationSessionStore((state) => {
    const session = state.byId[sessionId];
    if (!session) return null;
    return session.meta;
  });
}

export function useConversationInterpolatedState(sessionId: string) {
  return useConversationSessionStore(
    useShallow((state) => {
      const session = state.byId[sessionId];
      if (!session) return null;
      return {
        interpolator: session.interpretation.interpolator,
        writerResult: session.interpretation.writerResult,
        summaryMode: session.interpretation.summaryMode,
        confidence: session.interpretation.confidence,
        threadState: session.interpretation.threadState,
        rootVerification: session.evidence.rootVerification,
        scoresByUri: session.interpretation.scoresByUri,
        verificationByUri: session.evidence.verificationByUri,
        entityLandscape: session.entities.entityLandscape,
        writerEntities: session.entities.writerEntities,
        contributors: session.contributors.contributors,
        translations: session.translations.byUri,
        heatLevel: session.trajectory.heatLevel,
        repetitionLevel: session.trajectory.repetitionLevel,
        direction: session.trajectory.direction,
      };
    }),
  );
}

export function useComposerProjection(params: {
  sessionId: string;
  replyToUri?: string;
  draftText: string;
}): ComposerContext | null {
  const { sessionId, replyToUri, draftText } = params;
  const session = useConversationSession(sessionId);

  return useMemo(() => {
    if (!session) return null;
    return projectComposerContext({
      session,
      ...(replyToUri ? { replyToUri } : {}),
      draftText,
    });
  }, [session, replyToUri, draftText]);
}

export function useComposerContextProjection(
  sessionId: string,
  replyToUri?: string,
  draftText = '',
): ComposerContext | null {
  const session = useConversationSession(sessionId);

  return useMemo(() => {
    if (!session) return null;
    return projectComposerContext({
      session,
      ...(replyToUri ? { replyToUri } : {}),
      draftText,
    });
  }, [session, replyToUri, draftText]);
}

function toFilterablePost(params: {
  uri: string;
  did: string;
  handle: string;
  displayName: string;
  avatar?: string;
  text: string;
  facets?: MockPost['facets'];
  createdAt: string;
  likeCount: number;
  replyCount: number;
  repostCount: number;
}): MockPost {
  return {
    id: params.uri,
    author: {
      did: params.did,
      handle: params.handle,
      displayName: params.displayName,
      ...(params.avatar ? { avatar: params.avatar } : {}),
    },
    content: params.text,
    facets: params.facets,
    createdAt: params.createdAt,
    likeCount: params.likeCount,
    replyCount: params.replyCount,
    repostCount: params.repostCount,
    bookmarkCount: 0,
    chips: [],
  };
}

export function useThreadModerationProjection(sessionId: string): {
  byUri: Record<string, { matches: PostFilterMatch[]; hidden: boolean; warned: boolean }>;
} {
  const session = useConversationSession(sessionId);

  const moderationPool = useMemo(() => {
    if (!session) return [] as MockPost[];

    const root = session.graph.nodesByUri[session.graph.rootUri];
    if (!root) return [] as MockPost[];

    const topLevelUris = session.graph.childUrisByParent[root.uri] ?? [];

    const rootAndTopLevel = [root.uri, ...topLevelUris]
      .map((uri) => session.graph.nodesByUri[uri])
      .filter((node): node is NonNullable<typeof node> => !!node);

    return rootAndTopLevel.map((node) => toFilterablePost({
      uri: node.uri,
      did: node.authorDid,
      handle: node.authorHandle,
      displayName: node.authorName ?? node.authorHandle,
      ...(node.authorAvatar ? { avatar: node.authorAvatar } : {}),
      text: node.text,
      facets: node.facets,
      createdAt: node.createdAt,
      likeCount: node.likeCount,
      replyCount: node.replyCount,
      repostCount: node.repostCount,
    }));
  }, [session]);

  const matchesByUri = usePostFilterResults(moderationPool, 'thread');

  return useMemo(() => {
    const byUri: Record<string, { matches: PostFilterMatch[]; hidden: boolean; warned: boolean }> = {};
    for (const [uri, matches] of Object.entries(matchesByUri)) {
      byUri[uri] = {
        matches,
        hidden: matches.some((match) => match.action === 'hide'),
        warned: matches.some((match) => match.action === 'warn'),
      };
    }
    return { byUri };
  }, [matchesByUri]);
}
