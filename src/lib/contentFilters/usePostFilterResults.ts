import { useEffect, useMemo, useRef, useState } from 'react';
import type { MockPost } from '../../data/mockData';
import { useContentFilterStore } from '../../store/contentFilterStore';
import { useContentFilterMetricsStore } from '../../store/contentFilterMetricsStore';
import { useSessionStore } from '../../store/sessionStore';
import type { FilterContext, PostFilterMatch } from './types';
import { activeRulesForContext, getKeywordMatches, getSemanticMatches, searchableTextForPost } from './match';

type ResultByPostId = Record<string, PostFilterMatch[]>;
const FOLLOW_CACHE_TTL_MS = 60_000;

let followedDidCache: {
  did: string;
  expiresAt: number;
  set: Set<string>;
} | null = null;

let followedDidCachePromise: Promise<Set<string>> | null = null;

export async function fetchFollowedDidsForFilters(
  agent: { getFollows: (params: { actor: string; limit?: number; cursor?: string }) => Promise<any> },
  did: string,
): Promise<Set<string>> {
  const now = Date.now();
  if (followedDidCache && followedDidCache.did === did && followedDidCache.expiresAt > now) {
    return followedDidCache.set;
  }

  if (followedDidCachePromise) {
    return followedDidCachePromise;
  }

  followedDidCachePromise = (async () => {
    const next = new Set<string>();
    let cursor: string | undefined;

    for (let page = 0; page < 10; page += 1) {
      const response = await agent.getFollows({ actor: did, limit: 100, ...(cursor ? { cursor } : {}) });
      const follows = Array.isArray(response?.data?.follows) ? response.data.follows : [];
      for (const follow of follows) {
        const followDid = typeof follow?.did === 'string' ? follow.did : null;
        if (followDid) next.add(followDid);
      }
      cursor = typeof response?.data?.cursor === 'string' ? response.data.cursor : undefined;
      if (!cursor) break;
    }

    followedDidCache = {
      did,
      expiresAt: Date.now() + FOLLOW_CACHE_TTL_MS,
      set: next,
    };

    return next;
  })().finally(() => {
    followedDidCachePromise = null;
  });

  return followedDidCachePromise;
}

export function isFollowedAuthorPostForFilters(post: MockPost, followedDids: Set<string>): boolean {
  const author = (post as MockPost & { author?: { did?: string; viewer?: { following?: string | null } } }).author;
  if (!author) return false;
  if (typeof author.viewer?.following === 'string' && author.viewer.following.length > 0) return true;
  const did = typeof author.did === 'string' ? author.did : '';
  return did.length > 0 && followedDids.has(did);
}

export function resetFollowedDidCacheForTests(): void {
  followedDidCache = null;
  followedDidCachePromise = null;
}

function resultMapEquals(a: ResultByPostId, b: ResultByPostId): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    const aMatches = a[key] ?? [];
    const bMatches = b[key] ?? [];
    if (aMatches.length !== bMatches.length) return false;
    for (let i = 0; i < aMatches.length; i += 1) {
      const am = aMatches[i];
      const bm = bMatches[i];
      if (!am || !bm) return false;
      if (
        am.ruleId !== bm.ruleId ||
        am.phrase !== bm.phrase ||
        am.action !== bm.action ||
        am.matchType !== bm.matchType ||
        am.score !== bm.score
      ) {
        return false;
      }
    }
  }
  return true;
}

export function usePostFilterResults(posts: MockPost[], context: FilterContext) {
  const rules = useContentFilterStore((state) => state.rules);
  const excludeFollowingFromFilters = useContentFilterStore((state) => state.excludeFollowingFromFilters);
  const sessionDid = useSessionStore((state) => state.session?.did ?? null);
  const sessionReady = useSessionStore((state) => state.sessionReady);
  const agent = useSessionStore((state) => state.agent);
  const [resultByPostId, setResultByPostId] = useState<ResultByPostId>({});
  const [followedDids, setFollowedDids] = useState<Set<string>>(new Set());
  const evalTokenRef = useRef(0);

  const activeRules = useMemo(() => activeRulesForContext(rules, context), [rules, context]);

  useEffect(() => {
    let cancelled = false;

    if (!excludeFollowingFromFilters || !sessionReady || !sessionDid) {
      setFollowedDids((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }

    fetchFollowedDidsForFilters(agent as any, sessionDid)
      .then((next) => {
        if (cancelled) return;
        setFollowedDids(next);
      })
      .catch(() => {
        if (cancelled) return;
        setFollowedDids(new Set());
      });

    return () => {
      cancelled = true;
    };
  }, [agent, excludeFollowingFromFilters, sessionDid, sessionReady]);

  useEffect(() => {
    let isCancelled = false;
    evalTokenRef.current += 1;
    const token = evalTokenRef.current;

    if (activeRules.length === 0 || posts.length === 0) {
      setResultByPostId((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }

    const run = async () => {
      const next: ResultByPostId = {};

      for (const post of posts) {
        if (excludeFollowingFromFilters && isFollowedAuthorPostForFilters(post, followedDids)) {
          continue;
        }
        const text = searchableTextForPost(post);
        // Keyword and semantic matches are independent — evaluate both
        const keywordMatches = getKeywordMatches(text, activeRules);
        const semanticMatches = await getSemanticMatches(text, activeRules);

        const merged = [...keywordMatches, ...semanticMatches];
        if (merged.length > 0) next[post.id] = merged;
      }

      if (!isCancelled && token === evalTokenRef.current) {
        useContentFilterMetricsStore.getState().recordMatches(context, next);
        setResultByPostId((prev) => (resultMapEquals(prev, next) ? prev : next));
      }
    };

    run().catch(() => {
      if (!isCancelled && token === evalTokenRef.current) {
        setResultByPostId((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [activeRules, excludeFollowingFromFilters, followedDids, posts]);

  return resultByPostId;
}
