import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppBskyActorDefs } from '@atproto/api';
import { atpMutate } from '../../lib/atproto/client';
import { recordSearchCorrectionSignal } from '../../lib/searchHardNegativeMining';
import {
  recordRecommendationAction,
  recordRecommendationImpression,
} from '../../perf/recommendationTelemetry';
import type { ExploreSuggestedActorRecommendation } from './exploreDiscovery';

const DISMISSED_SUGGESTED_ACTORS_STORAGE_KEY = 'glympse.explore.dismissed-suggested-actors.v1';
const MAX_DISMISSED_SUGGESTED_ACTORS = 300;
const MAX_DISMISSED_DID_LENGTH = 256;

export function sanitizeDismissedDid(rawDid: string): string {
  return rawDid
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, MAX_DISMISSED_DID_LENGTH);
}

export function readDismissedSuggestedActors(): Set<string> {
  if (typeof window === 'undefined') return new Set<string>();
  try {
    const raw = window.localStorage.getItem(DISMISSED_SUGGESTED_ACTORS_STORAGE_KEY);
    if (!raw) return new Set<string>();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set<string>();

    const out = new Set<string>();
    for (const entry of parsed) {
      if (typeof entry !== 'string') continue;
      const did = sanitizeDismissedDid(entry);
      if (!did.startsWith('did:')) continue;
      out.add(did);
    }
    return out;
  } catch {
    return new Set<string>();
  }
}

export function writeDismissedSuggestedActors(dids: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    const sanitized = Array.from(dids)
      .map(sanitizeDismissedDid)
      .filter((did) => did.startsWith('did:'))
      .slice(-MAX_DISMISSED_SUGGESTED_ACTORS);

    window.localStorage.setItem(
      DISMISSED_SUGGESTED_ACTORS_STORAGE_KEY,
      JSON.stringify(sanitized),
    );
  } catch {
    // Best-effort local persistence only.
  }
}

export function filterVisibleSuggestedActorRecommendations(
  recommendations: ExploreSuggestedActorRecommendation[],
  dismissedSuggestedActorDids: Set<string>,
): ExploreSuggestedActorRecommendation[] {
  return recommendations.filter((recommendation) => {
    const didKey = sanitizeDismissedDid(recommendation.actor.did);
    return !dismissedSuggestedActorDids.has(didKey);
  });
}

export function resolveVisibleSuggestedActors(params: {
  suggestedActors: AppBskyActorDefs.ProfileView[];
  suggestedActorRecommendations: ExploreSuggestedActorRecommendation[];
  dismissedSuggestedActorDids: Set<string>;
}): AppBskyActorDefs.ProfileView[] {
  const visibleRecommendations = filterVisibleSuggestedActorRecommendations(
    params.suggestedActorRecommendations,
    params.dismissedSuggestedActorDids,
  );

  if (visibleRecommendations.length > 0) {
    return visibleRecommendations.map((recommendation) => recommendation.actor);
  }

  return params.suggestedActors.filter((actor) => !params.dismissedSuggestedActorDids.has(sanitizeDismissedDid(actor.did)));
}

export function useExploreActorRecommendations(params: {
  agent: any;
  sessionDid: string | null | undefined;
  suggestedActors: AppBskyActorDefs.ProfileView[];
  suggestedActorRecommendations: ExploreSuggestedActorRecommendation[];
}) {
  const { agent, sessionDid, suggestedActors, suggestedActorRecommendations } = params;
  const [dismissedSuggestedActorDids, setDismissedSuggestedActorDids] = useState<Set<string>>(
    () => readDismissedSuggestedActors(),
  );

  const visibleSuggestedActorRecommendations = useMemo(
    () => filterVisibleSuggestedActorRecommendations(
      suggestedActorRecommendations,
      dismissedSuggestedActorDids,
    ),
    [dismissedSuggestedActorDids, suggestedActorRecommendations],
  );

  const visibleSuggestedActors = useMemo(
    () => resolveVisibleSuggestedActors({
      suggestedActors,
      suggestedActorRecommendations,
      dismissedSuggestedActorDids,
    }),
    [dismissedSuggestedActorDids, suggestedActors, suggestedActorRecommendations],
  );

  const recommendationByDid = useMemo(() => {
    const out = new Map<string, ExploreSuggestedActorRecommendation>();
    for (const recommendation of visibleSuggestedActorRecommendations) {
      out.set(sanitizeDismissedDid(recommendation.actor.did), recommendation);
    }
    return out;
  }, [visibleSuggestedActorRecommendations]);

  useEffect(() => {
    for (const recommendation of visibleSuggestedActorRecommendations.slice(0, 12)) {
      recordRecommendationImpression({
        actorDid: recommendation.actor.did,
        confidence: recommendation.confidence,
        reasons: recommendation.reasons,
        source: 'explore-suggested-accounts',
      });
    }
  }, [visibleSuggestedActorRecommendations]);

  const followSuggestedActor = useCallback(async (did: string) => {
    if (!sessionDid || !agent) return false;

    const normalizedDid = sanitizeDismissedDid(did);
    if (!normalizedDid.startsWith('did:')) return false;

    const result = await atpMutate(() => agent.follow(normalizedDid));
    if (!result) return false;

    const recommendation = recommendationByDid.get(normalizedDid);
    if (recommendation) {
      recordRecommendationAction('follow', {
        actorDid: recommendation.actor.did,
        confidence: recommendation.confidence,
        reasons: recommendation.reasons,
        source: 'explore-suggested-accounts',
      });
    }

    recordSearchCorrectionSignal({
      query: 'explore:suggested-accounts',
      resultId: normalizedDid,
      relevance: 'relevant',
      confidenceScore: 0.9,
    });
    return true;
  }, [agent, recommendationByDid, sessionDid]);

  const dismissSuggestedActor = useCallback((did: string, confidence = 0.5) => {
    const didKey = sanitizeDismissedDid(did);
    if (!didKey.startsWith('did:')) return;

    const recommendation = recommendationByDid.get(didKey);
    recordRecommendationAction('dismiss', {
      actorDid: didKey,
      confidence: recommendation?.confidence ?? confidence,
      reasons: recommendation?.reasons ?? [],
      source: 'explore-suggested-accounts',
    });

    setDismissedSuggestedActorDids((previous) => {
      const next = new Set(previous);
      next.add(didKey);
      writeDismissedSuggestedActors(next);
      return next;
    });

    recordSearchCorrectionSignal({
      query: 'explore:suggested-accounts',
      resultId: didKey,
      relevance: 'irrelevant',
      confidenceScore: confidence,
    });
  }, [recommendationByDid]);

  return {
    dismissedSuggestedActorDids,
    visibleSuggestedActorRecommendations,
    visibleSuggestedActors,
    followSuggestedActor,
    dismissSuggestedActor,
  };
}
