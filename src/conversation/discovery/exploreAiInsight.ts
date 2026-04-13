import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExploreSearchPage, ExploreSearchIntentSummary } from './exploreSearch';
import { callExploreInsight } from '../../intelligence/modelClient';
import type { ExploreInsightResult, PremiumAiProvider } from '../../intelligence/premiumContracts';

export interface ExploreAiInsightState {
  insight: string | null;
  shortInsight: string | null;
  provider: PremiumAiProvider | null;
  abstained: boolean;
  loading: boolean;
  error: boolean;
}

const DEBOUNCE_MS = 600;
const MIN_POSTS_FOR_INSIGHT = 2;
const MAX_CANDIDATE_POSTS = 8;
const MAX_FACTUAL_HIGHLIGHTS = 4;
const MAX_SAFE_ENTITIES = 6;

function emptyInsightState(): ExploreAiInsightState {
  return {
    insight: null,
    shortInsight: null,
    provider: null,
    abstained: false,
    loading: false,
    error: false,
  };
}

function deriveStoryId(query: string, intent: ExploreSearchIntentSummary): string {
  return `explore::${intent.kind}::${query.trim().toLowerCase().slice(0, 80)}`;
}

function deriveTitleHint(query: string, intent: ExploreSearchIntentSummary): string {
  return `${intent.label}: ${query.trim()}`;
}

/**
 * Derives a ConfidenceState from the intent signal.
 * - surfaceConfidence: how many results we have (proxied from page.posts.length)
 * - entityConfidence: intent classification confidence
 * - interpretiveConfidence: whether the intent is well-defined (not 'general')
 */
function deriveConfidence(
  page: ExploreSearchPage,
  intent: ExploreSearchIntentSummary,
): { surfaceConfidence: number; entityConfidence: number; interpretiveConfidence: number } {
  const postCount = page.posts.length;
  const surfaceConfidence = Math.min(1, postCount / 12);
  const entityConfidence = Math.min(1, page.actors.length > 0 ? intent.confidence : intent.confidence * 0.7);
  const interpretiveConfidence = intent.kind === 'general'
    ? Math.min(0.55, intent.confidence)
    : intent.confidence;
  return { surfaceConfidence, entityConfidence, interpretiveConfidence };
}

/**
 * useExploreAiInsight — optional premium AI synthesis of explore search results.
 *
 * When enabled (and the user has the explore_insight entitlement), this hook
 * watches the resolved ExploreSearchPage and generates an AI insight using the
 * Gemini/OpenAI pipeline via POST /api/premium-ai/explore/insight.
 *
 * The hook debounces so it doesn't fire on every keystroke during typing.
 * It is fully non-blocking — loading/error states are exposed for graceful
 * degradation in the UI.
 *
 * @param params.page - Resolved explore search page (from useExploreSearchResults)
 * @param params.query - Raw search query string
 * @param params.actorDid - Authenticated user DID (required for entitlement check)
 * @param params.enabled - Master on/off switch (set false when search results are empty)
 */
export function useExploreAiInsight(params: {
  page: ExploreSearchPage;
  query: string;
  actorDid: string | null | undefined;
  enabled: boolean;
}): ExploreAiInsightState {
  const { page, query, actorDid, enabled } = params;

  const [state, setState] = useState<ExploreAiInsightState>(emptyInsightState);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestVersionRef = useRef(0);

  const runInsight = useCallback(async (
    currentPage: ExploreSearchPage,
    currentQuery: string,
    currentActorDid: string,
    requestVersion: number,
  ) => {
    const intent = currentPage.intent;
    const posts = currentPage.posts.slice(0, MAX_CANDIDATE_POSTS);

    if (posts.length < MIN_POSTS_FOR_INSIGHT) return;

    const storyId = deriveStoryId(currentQuery, intent);
    const titleHint = deriveTitleHint(currentQuery, intent);
    const confidence = deriveConfidence(currentPage, intent);

    // Derive factual highlights from feed item titles as proxies for factual signals.
    const factualHighlights = currentPage.feedItems
      .slice(0, MAX_FACTUAL_HIGHLIGHTS)
      .map((item) => item.title ?? item.content ?? '')
      .filter(Boolean);

    // Derive safe entities from the top post text (word-frequency fallback).
    // In a full integration, these would come from the entity extraction pipeline.
    const safeEntities = currentPage.actors
      .slice(0, MAX_SAFE_ENTITIES)
      .map((actor, i) => ({
        id: actor.did,
        label: actor.displayName ?? actor.handle,
        type: 'person' as const,
        confidence: Math.max(0.4, 1 - i * 0.1),
        impact: Math.max(0.3, 1 - i * 0.15),
      }));

    const request = {
      query: currentQuery.trim().slice(0, 160),
      intentKind: intent.kind,
      intentConfidence: intent.confidence,
      storyId,
      titleHint,
      candidatePosts: posts.map((post, i) => ({
        uri: post.id,
        handle: post.author?.handle ?? 'unknown',
        text: (post.content ?? '').slice(0, 300),
        impactScore: Math.max(0.1, 1 - i * 0.1),
      })),
      safeEntities,
      factualHighlights,
      confidence,
    };

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState((prev) => ({ ...prev, loading: true, error: false }));

    try {
      const result: ExploreInsightResult = await callExploreInsight(
        request,
        currentActorDid,
        controller.signal,
      );

      if (requestVersion !== requestVersionRef.current) return;

      setState({
        insight: result.abstained ? null : result.insight,
        shortInsight: result.shortInsight ?? null,
        provider: result.provider,
        abstained: result.abstained,
        loading: false,
        error: false,
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      if (requestVersion !== requestVersionRef.current) return;
      setState((prev) => ({ ...prev, loading: false, error: true }));
    }
  }, []);

  useEffect(() => {
    if (!enabled || !actorDid || !query.trim() || page.posts.length < MIN_POSTS_FOR_INSIGHT) {
      setState(emptyInsightState());
      return;
    }

    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      void runInsight(page, query, actorDid, requestVersion);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [enabled, actorDid, query, page, runInsight]);

  // Abort in-flight request on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  return state;
}
