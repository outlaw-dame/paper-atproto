import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useConversationSessionStore } from './sessionStore';
import {
  defaultAnchorLinearPolicy,
} from './sessionPolicies';
import {
  resolveCurrentContinuitySnapshot,
} from './continuitySnapshots';
import { createSessionAiDiagnostics } from './modelExecution';
import { usePostFilterResults } from '../lib/contentFilters/usePostFilterResults';
import type { PostFilterMatch } from '../lib/contentFilters/types';
import type { MockPost } from '../data/mockData';
import { projectThreadView, type ThreadFilter } from './projections/threadProjection';
import { projectComposerContext } from './projections/composerProjection';
import type { ComposerContext } from './projections/composerProjection';
import {
  projectStoryView,
  rootUriForStoryPost,
  type StoryProjection,
} from './projections/storyProjection';
import {
  projectTimelineConversationHints,
  type TimelineConversationHint,
} from './projections/timelineProjection';
import type {
  ConversationContinuitySnapshot,
  ConversationSession,
  InterpretiveConfidenceExplanation,
} from './sessionTypes';
import type { SummaryMode } from '../intelligence/llmContracts';
import { useInterpolatorSettingsStore } from '../store/interpolatorSettingsStore';
import type { DeepInterpolatorResult, PremiumAiEntitlements } from '../intelligence/premiumContracts';

export function useConversationSession(sessionId: string) {
  return useConversationSessionStore((state) => state.byId[sessionId] ?? null);
}

export function selectConversationSessionsByRootUris(
  byId: Record<string, ConversationSession>,
  rootUris: string[],
): Record<string, ConversationSession | null> {
  const selected: Record<string, ConversationSession | null> = {};
  for (const rootUri of new Set(rootUris.filter((uri) => uri.trim().length > 0))) {
    selected[rootUri] = byId[rootUri] ?? null;
  }
  return selected;
}

export function useConversationSessionsByRootUris(
  rootUris: string[],
): Record<string, ConversationSession | null> {
  const uniqueRootUris = useMemo(
    () => [...new Set(rootUris.filter((uri) => uri.trim().length > 0))],
    [rootUris],
  );

  return useConversationSessionStore(
    useShallow((state) => selectConversationSessionsByRootUris(state.byId, uniqueRootUris)),
  );
}

export function useThreadProjection(
  sessionId: string,
  activeFilter: ThreadFilter = 'Top',
) {
  const session = useConversationSession(sessionId);
  const interpolatorEnabled = useInterpolatorSettingsStore((state) => state.enabled);

  return useMemo(() => {
    if (!session) return null;
    return projectThreadView(session, defaultAnchorLinearPolicy, activeFilter);
  }, [session, activeFilter, interpolatorEnabled]);
}

export function useTimelineConversationHintsProjection(
  posts: MockPost[],
): Record<string, TimelineConversationHint> {
  const rootUris = useMemo(
    () => posts.map((post) => post.threadRoot?.id ?? post.id),
    [posts],
  );
  const sessionsByRootUri = useConversationSessionsByRootUris(rootUris);

  return useMemo(() => projectTimelineConversationHints({
    posts,
    sessionsByRootUri,
  }), [posts, sessionsByRootUri]);
}

export function useStoryProjection(params: {
  query: string;
  posts: MockPost[];
  getTranslatedText: (post: MockPost) => string;
}): StoryProjection {
  const { query, posts, getTranslatedText } = params;
  const rootUris = useMemo(
    () => posts.map((post) => rootUriForStoryPost(post)),
    [posts],
  );
  const sessionsByRootUri = useConversationSessionsByRootUris(rootUris);

  return useMemo(() => projectStoryView({
    query,
    posts,
    getTranslatedText,
    sessionsByRootUri,
  }), [getTranslatedText, posts, query, sessionsByRootUri]);
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
        interpretiveExplanation: session.interpretation.interpretiveExplanation,
        aiDiagnostics: session.interpretation.aiDiagnostics ?? createSessionAiDiagnostics(),
        premium: session.interpretation.premium,
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

export function useConversationAiDiagnostics(sessionId: string) {
  return useConversationSessionStore((state) => (
    state.byId[sessionId]?.interpretation.aiDiagnostics ?? createSessionAiDiagnostics()
  ));
}

export function useComposerProjection(params: {
  sessionId: string;
  replyToUri?: string;
  draftText: string;
}): ComposerContext | null {
  const { sessionId, replyToUri, draftText } = params;
  const session = useConversationSession(sessionId);
  const interpolatorEnabled = useInterpolatorSettingsStore((state) => state.enabled);

  return useMemo(() => {
    if (!session) return null;
    return projectComposerContext({
      session,
      ...(replyToUri ? { replyToUri } : {}),
      draftText,
    });
  }, [session, replyToUri, draftText, interpolatorEnabled]);
}

export function useComposerContextProjection(
  sessionId: string,
  replyToUri?: string,
  draftText = '',
): ComposerContext | null {
  const session = useConversationSession(sessionId);
  const interpolatorEnabled = useInterpolatorSettingsStore((state) => state.enabled);

  return useMemo(() => {
    if (!session) return null;
    return projectComposerContext({
      session,
      ...(replyToUri ? { replyToUri } : {}),
      draftText,
    });
  }, [session, replyToUri, draftText, interpolatorEnabled]);
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
    ...(params.facets ? { facets: params.facets } : {}),
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

export function selectInterpretiveConfidence(sessionId: string): number | null {
  return useConversationSessionStore.getState().byId[sessionId]
    ?.interpretation.confidence?.interpretiveConfidence ?? null;
}

export function selectInterpretiveExplanation(
  sessionId: string,
): InterpretiveConfidenceExplanation | null {
  return useConversationSessionStore.getState().byId[sessionId]
    ?.interpretation.interpretiveExplanation ?? null;
}

export function selectSummaryMode(sessionId: string): SummaryMode | null {
  return useConversationSessionStore.getState().byId[sessionId]
    ?.interpretation.summaryMode ?? null;
}

export function selectPremiumDeepInterpolator(
  sessionId: string,
): DeepInterpolatorResult | null {
  return useConversationSessionStore.getState().byId[sessionId]
    ?.interpretation.premium.deepInterpolator ?? null;
}

export function selectConversationAiDiagnostics(
  sessionId: string,
) {
  return useConversationSessionStore.getState().byId[sessionId]?.interpretation.aiDiagnostics
    ?? createSessionAiDiagnostics();
}

export function selectPremiumEntitlements(
  sessionId: string,
): PremiumAiEntitlements | null {
  return useConversationSessionStore.getState().byId[sessionId]
    ?.interpretation.premium.entitlements ?? null;
}

export function selectLatestContinuitySnapshot(
  sessionId: string,
): ConversationContinuitySnapshot | null {
  const session = useConversationSessionStore.getState().byId[sessionId];
  if (!session) return null;
  return resolveCurrentContinuitySnapshot(session);
}
